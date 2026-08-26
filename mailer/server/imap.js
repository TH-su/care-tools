// IMAP接続層 — imapflow による実サーバー通信
// アカウントごとに1接続を保持し、無操作5分で切断。操作は getMailboxLock で直列化。
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getPassword } from './store.js';

const pool = new Map();           // accountId -> { client, timer, connecting }
const mailboxCache = new Map();   // accountId -> { list, at }
const previewCache = new Map();   // `${accountId}:${path}:${uid}` -> string
const IDLE_CLOSE_MS = 5 * 60 * 1000;
const MAILBOX_CACHE_MS = 60 * 1000;
// プレビューは冒頭だけ読めればよい。base64は約4/3に膨らむので余裕を見た値。
const PREVIEW_FETCH_BYTES = 4096;
// これ以下のパートは丸ごと取る。部分取得（BODY[1]<0.4096>）は空を返すサーバーが
// あるため、小さい本文では使わず、大きいHTMLメールにだけ使う。
const PREVIEW_FULL_MAX = 32 * 1024;
// 本文表示で読み込む上限。これを超える本文は先頭だけ表示する。
const MESSAGE_TEXT_MAX = 2 * 1024 * 1024;
// HTMLに埋め込むインライン画像の上限（sanitize.js側の制限と揃える）
const INLINE_IMAGE_MAX = 2 * 1024 * 1024;
const INLINE_TOTAL_MAX = 10 * 1024 * 1024;

function touch(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => closeConnection(accountId), IDLE_CLOSE_MS);
  entry.timer.unref?.();
}

async function closeConnection(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return;
  pool.delete(accountId);
  clearTimeout(entry.timer);
  try { await entry.client.logout(); } catch { /* 切断済みは無視 */ }
}

export function buildClient(account, password) {
  const client = new ImapFlow({
    host: account.imap.host,
    port: Number(account.imap.port) || 993,
    secure: account.imap.secure !== false,
    auth: { user: account.user || account.email, pass: password },
    logger: false,
    socketTimeout: 60 * 1000,
    greetingTimeout: 15 * 1000,
  });
  // ImapFlowは失敗を Promise の reject に加えて 'error' イベントでも通知する。
  // リスナーが無いとNodeが未捕捉例外としてプロセスごと終了させるため、生成時点で必ず付ける。
  // （認証失敗の直後にサーバー側から接続を切られた場合などに非同期で発火する）
  client.on('error', () => { /* 実際の失敗は呼び出し側がrejectで受け取る */ });
  return client;
}

async function getClient(account) {
  const existing = pool.get(account.id);
  if (existing) {
    if (existing.connecting) await existing.connecting;
    if (existing.client.usable) { touch(account.id); return existing.client; }
    await closeConnection(account.id);
  }
  const password = await getPassword(account);
  const client = buildClient(account, password);
  const entry = { client, timer: null, connecting: null };
  pool.set(account.id, entry);
  entry.connecting = client.connect();
  try {
    await entry.connecting;
  } catch (err) {
    pool.delete(account.id);
    throw classifyError(err);
  }
  entry.connecting = null;
  client.on('close', () => {
    if (pool.get(account.id)?.client === client) pool.delete(account.id);
  });
  client.on('error', () => { /* closeイベント側で回収 */ });
  touch(account.id);
  return client;
}

function classifyError(err) {
  const e = new Error(friendlyMessage(err));
  e.cause = err;
  e.authFailed = Boolean(err?.authenticationFailed);
  return e;
}

function friendlyMessage(err) {
  if (err?.authenticationFailed) {
    return 'ログインを拒否されました。ユーザー名とパスワードを確認してください。'
      + 'Gmail・iCloudでは通常のパスワードではなく「アプリパスワード」が必要です。'
      + 'また、そのメールアドレスが本当にそのサーバー（例: imap.gmail.com）のアカウントかもご確認ください。';
  }
  const msg = String(err?.message || err);
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'サーバーが見つかりません。ホスト名を確認してください。';
  if (/ECONNREFUSED/.test(msg)) return '接続が拒否されました。ポート番号とSSL設定を確認してください。';
  if (/ETIMEDOUT|timed?.?out/i.test(msg)) return '接続がタイムアウトしました。ネットワークとサーバー設定を確認してください。';
  if (/certificate|TLS|SSL/i.test(msg)) return 'SSL/TLS証明書の検証に失敗しました。';
  return `サーバーエラー: ${msg}`;
}

async function withLock(account, path, fn) {
  const client = await getClient(account);
  const lock = await client.getMailboxLock(path);
  try {
    return await fn(client);
  } catch (err) {
    throw err.friendly ? err : classifyError(err);
  } finally {
    lock.release();
    touch(account.id);
  }
}

// ── メールボックス一覧 ────────────────────────────────────────
const SPECIAL_ORDER = ['\\Inbox', '\\Flagged', '\\Drafts', '\\Sent', '\\Junk', '\\Trash', '\\Archive', '\\All'];
const SPECIAL_NAMES = {
  '\\Inbox': '受信', '\\Drafts': '下書き', '\\Sent': '送信済み',
  '\\Junk': '迷惑メール', '\\Trash': 'ゴミ箱', '\\Archive': 'アーカイブ', '\\All': 'すべてのメール',
};

export async function listMailboxes(account, { fresh = false } = {}) {
  const cached = mailboxCache.get(account.id);
  if (!fresh && cached && Date.now() - cached.at < MAILBOX_CACHE_MS) return cached.list;

  const client = await getClient(account);
  const raw = await client.list();
  touch(account.id);

  const boxes = raw
    .filter(b => !b.flags?.has('\\Noselect') && !b.flags?.has('\\NonExistent'))
    .map(b => {
      const specialUse = b.path.toUpperCase() === 'INBOX' ? '\\Inbox' : (b.specialUse || null);
      return {
        path: b.path,
        delimiter: b.delimiter || '/',
        specialUse,
        name: SPECIAL_NAMES[specialUse] || b.name || b.path,
        parent: b.parentPath || null,
      };
    })
    // Gmailのコンテナ表示名 [Gmail] 直下は specialUse で拾えるため、コンテナ自体は除外済み
    .sort((a, b) => {
      const ai = a.specialUse ? SPECIAL_ORDER.indexOf(a.specialUse) : 99;
      const bi = b.specialUse ? SPECIAL_ORDER.indexOf(b.specialUse) : 99;
      if (ai !== bi) return ai - bi;
      return a.path.localeCompare(b.path, 'ja');
    });

  mailboxCache.set(account.id, { list: boxes, at: Date.now() });
  return boxes;
}

export async function findSpecial(account, use) {
  const boxes = await listMailboxes(account);
  return boxes.find(b => b.specialUse === use)
    || (use === '\\Archive' ? boxes.find(b => b.specialUse === '\\All') : null)
    || null;
}

// ── メッセージ一覧 ────────────────────────────────────────────
function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  if (node.dispositionParameters?.filename || node.parameters?.name) {
    if (!/^text\//i.test(`${node.type}/${node.subtype || ''}`) && node.disposition !== 'inline') return true;
    if (node.disposition === 'attachment') return true;
  }
  return (node.childNodes || []).some(hasAttachment);
}

function addr(list) {
  const a = list?.[0];
  if (!a) return { name: '', address: '' };
  return { name: a.name || '', address: a.address || '' };
}

function envelopeToRow(account, path, msg) {
  return {
    accountId: account.id,
    mailbox: path,
    uid: msg.uid,
    subject: msg.envelope?.subject || '',
    from: addr(msg.envelope?.from),
    to: (msg.envelope?.to || []).map(a => ({ name: a.name || '', address: a.address || '' })),
    date: (msg.envelope?.date || msg.internalDate || new Date()).toISOString?.()
      || new Date(msg.envelope?.date || msg.internalDate).toISOString(),
    seen: msg.flags?.has('\\Seen') ?? false,
    flagged: msg.flags?.has('\\Flagged') ?? false,
    answered: msg.flags?.has('\\Answered') ?? false,
    draft: msg.flags?.has('\\Draft') ?? false,
    hasAttachment: hasAttachment(msg.bodyStructure),
    size: msg.size || 0,
    messageId: msg.envelope?.messageId || null,
  };
}

export async function listMessages(account, path, { limit = 50, offset = 0, search = '', unseenOnly = false, flaggedOnly = false } = {}) {
  return withLock(account, path, async (client) => {
    const total = client.mailbox.exists || 0;
    let rows = [];
    let matchedTotal = total;

    if (search || unseenOnly || flaggedOnly) {
      const query = {};
      if (unseenOnly) query.seen = false;
      if (flaggedOnly) query.flagged = true;
      if (search) query.or = [{ subject: search }, { from: search }, { to: search }, { body: search }];
      let uids = total > 0 ? await client.search(query, { uid: true }) : [];
      if (!Array.isArray(uids)) uids = [];
      matchedTotal = uids.length;
      const page = uids.sort((a, b) => a - b).slice(Math.max(0, uids.length - offset - limit), uids.length - offset);
      if (page.length > 0) {
        for await (const msg of client.fetch(page.join(','), { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true, size: true }, { uid: true })) {
          rows.push(envelopeToRow(account, path, msg));
        }
      }
    } else if (total > 0 && offset < total) {
      const end = total - offset;
      const start = Math.max(1, end - limit + 1);
      for await (const msg of client.fetch(`${start}:${end}`, { envelope: true, flags: true, bodyStructure: true, internalDate: true, size: true, uid: true })) {
        rows.push(envelopeToRow(account, path, msg));
      }
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { rows, total: matchedTotal };
  });
}

// プレビュー（本文冒頭の抜粋）— 一覧とは別に遅延取得
export async function getPreviews(account, path, uids) {
  const result = {};
  const missing = [];
  for (const uid of uids) {
    const key = `${account.id}:${path}:${uid}`;
    if (previewCache.has(key)) result[uid] = previewCache.get(key);
    else missing.push(uid);
  }
  if (missing.length === 0) return result;

  await withLock(account, path, async (client) => {
    // ① 構造をまとめて1コマンドで取得（1通ずつ取ると往復が件数分かかり非常に遅い）
    const parts = new Map();   // uid -> テキストパートの情報
    try {
      for await (const msg of client.fetch(missing.join(','), { uid: true, bodyStructure: true }, { uid: true })) {
        const part = findTextPart(msg.bodyStructure);
        if (part) parts.set(msg.uid, part);
        else result[msg.uid] = '';
      }
    } catch {
      for (const uid of missing) result[uid] = '';
      return;
    }

    // ② 同じ取得方法ごとにまとめて本文を取る
    //    （FETCHは1コマンドで1組のパートしか指定できないため、パート番号でグループ化する）
    const store = (uid, part, buf, binary) => {
      if (!buf || buf.length === 0) return false;
      let text = decodePart(buf, part, binary);
      if (part.isHtml) text = htmlToPreview(text);
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 140);
      previewCache.set(`${account.id}:${path}:${uid}`, preview);
      result[uid] = preview;
      return true;
    };

    const fetchGroup = async (partKey, groupUids, partial) => {
      const failed = [];
      const query = {
        uid: true,
        bodyParts: [partial ? { key: partKey, start: 0, maxLength: PREVIEW_FETCH_BYTES } : partKey],
      };
      try {
        for await (const msg of client.fetch(groupUids.join(','), query, { uid: true })) {
          const part = parts.get(msg.uid);
          // BINARY拡張で取得できた場合はサーバー側で転送符号化が解かれている
          if (!part || !store(msg.uid, part, msg.bodyParts?.get(partKey), msg.binaryParts?.has(partKey))) {
            failed.push(msg.uid);
          }
        }
      } catch {
        failed.push(...groupUids.filter(u => result[u] === undefined));
      }
      return failed;
    };

    const groups = new Map();   // `${パート番号}|${取得方法}` -> uid配列
    for (const [uid, part] of parts) {
      const partial = part.size > PREVIEW_FULL_MAX;
      const key = `${part.part}|${partial ? 'partial' : 'full'}`;
      if (!groups.has(key)) groups.set(key, { partKey: part.part, partial, uids: [] });
      groups.get(key).uids.push(uid);
    }

    const retryFull = new Map();
    for (const { partKey, partial, uids: groupUids } of groups.values()) {
      const failed = await fetchGroup(partKey, groupUids, partial);
      // 部分取得に対応しないサーバーでは空が返るため、まとめて全体取得で取り直す
      if (partial && failed.length > 0) {
        if (!retryFull.has(partKey)) retryFull.set(partKey, []);
        retryFull.get(partKey).push(...failed);
      }
    }
    for (const [partKey, retryUids] of retryFull) {
      await fetchGroup(partKey, retryUids, false);
    }

    for (const uid of missing) if (result[uid] === undefined) result[uid] = '';
  });
  if (previewCache.size > 5000) {
    // 素朴なLRU代替: 古い半分を捨てる
    const keys = [...previewCache.keys()].slice(0, 2500);
    for (const k of keys) previewCache.delete(k);
  }
  return result;
}

function findTextPart(node, prefer = 'plain') {
  const { textParts } = collectParts(node);
  return textParts.find(p => p.subtype === prefer) || textParts[0] || null;
}

// base64は元データの約4/3の大きさになる（改行分を差し引いた概算）
function decodedSize(size, encoding) {
  if (String(encoding || '').toLowerCase() === 'base64') return Math.round(size * 0.73);
  return size;
}

// BODYSTRUCTURE を歩いて「本文パート」と「添付・インライン画像」に仕分ける。
// これにより、巨大な添付を落とさずに本文だけを取得できる。
function collectParts(root) {
  const textParts = [];
  const attachments = [];
  const walk = (n) => {
    if (!n) return;
    const type = String(n.type || '').toLowerCase();
    if (Array.isArray(n.childNodes) && n.childNodes.length > 0 && type.startsWith('multipart/')) {
      n.childNodes.forEach(walk);
      return;
    }
    const disposition = String(n.disposition || '').toLowerCase();
    const filename = n.dispositionParameters?.filename || n.parameters?.name || null;
    const cid = n.id ? String(n.id).replace(/[<>]/g, '') : null;
    const subtype = String(type.split('/')[1] || '').toLowerCase();
    // 添付として送られたテキスト（notes.txt 等）は本文ではない
    const isBody = /^text\/(plain|html)$/.test(type) && disposition !== 'attachment';
    if (isBody) {
      textParts.push({
        part: n.part || '1', subtype, isHtml: subtype === 'html',
        encoding: n.encoding, charset: n.parameters?.charset, size: n.size || 0,
      });
      return;
    }
    attachments.push({
      part: n.part || '1',
      filename,
      contentType: type || 'application/octet-stream',
      // BODYSTRUCTUREのサイズは符号化後の値。利用者に見せるのは復号後の目安サイズ。
      size: decodedSize(n.size || 0, n.encoding),
      encodedSize: n.size || 0,
      encoding: n.encoding,
      cid,
      inline: disposition === 'inline' && Boolean(cid),
    });
  };
  walk(root);
  return { textParts, attachments };
}

// 指定したパートをまとめて1コマンドで取得する。
// 大きいパートは先頭だけ取り、部分取得に対応しないサーバー向けに全体取得で取り直す。
async function fetchPartBuffers(client, uid, specs) {
  const out = new Map();
  if (specs.length === 0) return out;

  const run = async (list, partial) => {
    const failed = [];
    const bodyParts = list.map(s => (partial ? { key: s.key, start: 0, maxLength: s.maxBytes } : s.key));
    try {
      for await (const msg of client.fetch(String(uid), { uid: true, bodyParts }, { uid: true })) {
        for (const s of list) {
          const buf = msg.bodyParts?.get(s.key);
          if (buf && buf.length > 0) out.set(s.key, { buf, binary: Boolean(msg.binaryParts?.has(s.key)) });
          else failed.push(s);
        }
      }
    } catch {
      failed.push(...list.filter(s => !out.has(s.key)));
    }
    return failed;
  };

  const partialSpecs = specs.filter(s => s.maxBytes && s.size > s.maxBytes);
  const fullSpecs = specs.filter(s => !partialSpecs.includes(s));
  if (fullSpecs.length > 0) await run(fullSpecs, false);
  if (partialSpecs.length > 0) {
    const failed = await run(partialSpecs, true);
    if (failed.length > 0) await run(failed, false);
  }
  return out;
}

// 文字コード名の揺れを TextDecoder が解釈できる名前へ寄せる
// （日本語メールは iso-2022-jp / shift_jis / euc-jp が今も多く使われる）
const CHARSET_ALIASES = {
  'jis': 'iso-2022-jp',
  'iso2022jp': 'iso-2022-jp',
  'x-sjis': 'shift_jis',
  'sjis': 'shift_jis',
  'shift-jis': 'shift_jis',
  'ms_kanji': 'shift_jis',
  'windows-932': 'shift_jis',
  'cp932': 'windows-31j',
  'x-euc-jp': 'euc-jp',
  'eucjp': 'euc-jp',
  'unicode-1-1-utf-8': 'utf-8',
  'utf8': 'utf-8',
};

// us-ascii と宣言しつつ実体はUTF-8、というメールが実際には多い。
// 厳密にUTF-8として読めればUTF-8、読めなければ西欧圏の文字コードとして扱う。
const ASCII_LABELS = new Set(['us-ascii', 'ascii', 'ansi_x3.4-1968', '', 'unknown-8bit', 'x-unknown']);

function decodeText(data, charset) {
  const raw = String(charset || '').trim().toLowerCase().replace(/^"|"$/g, '');
  if (ASCII_LABELS.has(raw)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      return new TextDecoder('windows-1252').decode(data);
    }
  }
  const name = CHARSET_ALIASES[raw] || raw;
  for (const candidate of [name, 'utf-8']) {
    try {
      return new TextDecoder(candidate).decode(data);
    } catch { /* 未対応の文字コード名なら次を試す */ }
  }
  return data.toString('utf8');
}

// 生のパート（転送符号化されたまま）を元のバイト列に戻す。
// alreadyDecoded は BINARY 拡張などでサーバー側が符号化を解いて返した場合。
function decodeBinaryPart(buf, encoding, alreadyDecoded = false) {
  if (alreadyDecoded) return buf;
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc === 'base64') {
      // 途中で切り取った本文でも壊れないよう4文字単位に丸める
      const b64 = buf.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '');
      return Buffer.from(b64.slice(0, b64.length - (b64.length % 4)), 'base64');
    }
    if (enc === 'quoted-printable') {
      return Buffer.from(buf.toString('latin1')
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    }
  } catch { /* 壊れた符号化はそのまま扱う */ }
  return buf;
}

function decodePart(buf, part, alreadyDecoded = false) {
  return decodeText(decodeBinaryPart(buf, part.encoding, alreadyDecoded), part.charset);
}

// HTML本文 → 引用に使えるプレーンテキスト（改行を保つ）
function htmlToPlain(html) {
  return String(html)
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToPreview(html) {
  return String(html)
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)));
}

// ── メッセージ本文 ────────────────────────────────────────────
const addrValue = (list) => ({ value: (list || []).map(a => ({ name: a.name || '', address: a.address || '' })) });

// mailparser を通さず、必要なパートだけ取得して同じ形に組み立てる。
// 添付は中身を落とさずメタ情報だけ返すので、巨大な添付があっても本文表示は速い。
function buildParsed(msg, texts, inlineContents) {
  const env = msg.envelope || {};
  const headerText = msg.headers ? msg.headers.toString('utf8') : '';
  const refLine = headerText.match(/^references:\s*([\s\S]*?)(?:\r?\n(?![ \t])|$)/im);
  const references = refLine ? (refLine[1].match(/<[^>]+>/g) || []) : [];

  return {
    subject: env.subject || '',
    from: addrValue(env.from),
    to: addrValue(env.to),
    cc: addrValue(env.cc),
    replyTo: addrValue(env.replyTo),
    date: env.date || msg.internalDate || new Date(),
    messageId: env.messageId || null,
    inReplyTo: env.inReplyTo || null,
    references,
    text: texts.plain || '',
    html: texts.html || false,
    attachments: inlineContents,
  };
}

export async function getMessage(account, path, uid, { markSeen = true } = {}) {
  return withLock(account, path, async (client) => {
    const msg = await client.fetchOne(String(uid), {
      uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true,
      headers: ['references'],
    }, { uid: true });
    if (!msg) { const e = new Error('メッセージが見つかりません（削除された可能性があります）'); e.status = 404; throw e; }
    if (markSeen && !msg.flags?.has('\\Seen')) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }

    const { textParts, attachments } = collectParts(msg.bodyStructure);
    // 構造が読めない特殊なメールは、従来どおり全体を取得して解析する
    if (textParts.length === 0 && attachments.length === 0) {
      const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!full?.source) { const e = new Error('メッセージが見つかりません'); e.status = 404; throw e; }
      const parsed = await simpleParser(full.source, { skipImageLinks: false });
      return { parsed, flags: msg.flags };
    }

    // ① 本文パート（プレーンとHTML）をまとめて取得
    const plainPart = textParts.find(p => !p.isHtml);
    const htmlPart = textParts.find(p => p.isHtml);
    const specs = [];
    for (const p of [plainPart, htmlPart]) {
      if (p) specs.push({ key: p.part, size: p.size, maxBytes: MESSAGE_TEXT_MAX });
    }
    const bufs = await fetchPartBuffers(client, uid, specs);
    const readText = (p) => {
      const hit = p && bufs.get(p.part);
      return hit ? decodePart(hit.buf, p, hit.binary) : '';
    };
    const texts = { plain: readText(plainPart), html: readText(htmlPart) };
    // HTMLしかないメールでも返信時に引用できるよう、本文テキストを起こしておく
    if (!texts.plain && texts.html) texts.plain = htmlToPlain(texts.html);

    // ② HTMLが参照しているインライン画像だけを取得（添付本体は取得しない）
    const inlineContents = attachments.map(a => ({
      filename: a.filename, contentType: a.contentType, size: a.size,
      cid: a.cid, contentDisposition: a.inline ? 'inline' : 'attachment',
    }));
    if (texts.html) {
      const referenced = new Set([...texts.html.matchAll(/cid:([^"'\s>)]+)/gi)]
        .map(m => m[1].replace(/[<>]/g, '')));
      let budget = INLINE_TOTAL_MAX;
      const wanted = [];
      attachments.forEach((a, i) => {
        if (!a.cid || !referenced.has(a.cid) || a.size > INLINE_IMAGE_MAX || a.size > budget) return;
        budget -= a.size;
        wanted.push({ index: i, key: a.part, size: a.size, maxBytes: 0 });
      });
      if (wanted.length > 0) {
        const imgs = await fetchPartBuffers(client, uid, wanted);
        for (const w of wanted) {
          const hit = imgs.get(w.key);
          if (hit) {
            inlineContents[w.index].content = decodeBinaryPart(hit.buf, attachments[w.index].encoding, hit.binary);
          }
        }
      }
    }

    return { parsed: buildParsed(msg, texts, inlineContents), flags: msg.flags };
  });
}

export async function getAttachment(account, path, uid, index) {
  return withLock(account, path, async (client) => {
    const msg = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
    if (!msg) { const e = new Error('メッセージが見つかりません'); e.status = 404; throw e; }
    const { attachments } = collectParts(msg.bodyStructure);
    const att = attachments[index];
    if (!att) { const e = new Error('添付ファイルが見つかりません'); e.status = 404; throw e; }
    // 該当パートだけを取り出す（メッセージ全体は読み込まない）
    const dl = await client.download(String(uid), att.part, { uid: true });
    if (!dl?.content) { const e = new Error('添付ファイルを取得できませんでした'); e.status = 404; throw e; }
    const chunks = [];
    for await (const c of dl.content) chunks.push(c);
    return {
      filename: att.filename || dl.meta?.filename || `添付ファイル${index + 1}`,
      contentType: att.contentType || dl.meta?.contentType || 'application/octet-stream',
      content: Buffer.concat(chunks),
    };
  });
}

// ── アクション ────────────────────────────────────────────────
export async function setFlags(account, path, uids, flags, add) {
  return withLock(account, path, async (client) => {
    const range = uids.join(',');
    if (add) await client.messageFlagsAdd(range, flags, { uid: true });
    else await client.messageFlagsRemove(range, flags, { uid: true });
    return { ok: true };
  });
}

// 移した先での新しいUIDを拾う。これが無いと「元に戻す」で対象を指し示せない。
// サーバーがUIDPLUSに対応していない場合は uidMap が返らないので、そのときは戻せない。
function undoInfo(from, to, res) {
  const map = res?.uidMap;
  const uids = map ? [...(map instanceof Map ? map.values() : Object.values(map))].map(Number) : [];
  if (uids.length === 0) return null;
  return { from, to, uids };
}

export async function moveMessages(account, path, uids, targetPath) {
  return withLock(account, path, async (client) => {
    const res = await client.messageMove(uids.join(','), targetPath, { uid: true });
    return { ok: true, undo: undoInfo(path, targetPath, res) };
  });
}

export async function deleteMessages(account, path, uids) {
  const trash = await findSpecial(account, '\\Trash');
  const inTrash = trash && trash.path === path;
  return withLock(account, path, async (client) => {
    if (inTrash || !trash) {
      // ゴミ箱の中での削除は本当に消える。戻せないので undo は付けない
      await client.messageDelete(uids.join(','), { uid: true });
      return { ok: true, undo: null };
    }
    const res = await client.messageMove(uids.join(','), trash.path, { uid: true });
    return { ok: true, undo: undoInfo(path, trash.path, res) };
  });
}

export async function appendMessage(account, path, raw, flags = []) {
  const client = await getClient(account);
  await client.append(path, raw, flags);
  touch(account.id);
  return { ok: true };
}

// ── 未読数 ───────────────────────────────────────────────────
export async function getStatus(account, path) {
  const client = await getClient(account);
  const st = await client.status(path, { unseen: true, messages: true });
  touch(account.id);
  return { unseen: st.unseen || 0, total: st.messages || 0 };
}

// ── 接続テスト（アカウント追加時） ─────────────────────────────
export async function testImap(account, password) {
  const client = buildClient(account, password);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    throw classifyError(err);
  } finally {
    // 失敗時はソケットが残るため必ず後始末する（成功時のlogout後は既に閉じている）
    try { client.close(); } catch { /* 既に切断済み */ }
  }
}

export async function closeAll() {
  await Promise.allSettled([...pool.keys()].map(closeConnection));
}
