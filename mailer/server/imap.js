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
  return new ImapFlow({
    host: account.imap.host,
    port: Number(account.imap.port) || 993,
    secure: account.imap.secure !== false,
    auth: { user: account.user || account.email, pass: password },
    logger: false,
    socketTimeout: 60 * 1000,
    greetingTimeout: 15 * 1000,
  });
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
  e.authFailed = String(err?.authenticationFailed || err?.response || err?.message || '')
    .match(/auth|login|credential|password/i) != null && err?.authenticationFailed !== false
    ? Boolean(err?.authenticationFailed) : false;
  if (err?.authenticationFailed) e.authFailed = true;
  return e;
}

function friendlyMessage(err) {
  if (err?.authenticationFailed) return '認証に失敗しました。メールアドレスとパスワード（アプリパスワード）を確認してください。';
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
    for (const uid of missing) {
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
        const part = findTextPart(msg?.bodyStructure);
        if (!part) { result[uid] = ''; continue; }
        const dl = await client.download(String(uid), part.part, { uid: true, maxBytes: 16 * 1024 });
        const chunks = [];
        for await (const c of dl.content) chunks.push(c);
        let text = decodePart(Buffer.concat(chunks), dl.meta, part);
        if (part.isHtml) text = htmlToPreview(text);
        const preview = text.replace(/\s+/g, ' ').trim().slice(0, 140);
        previewCache.set(`${account.id}:${path}:${uid}`, preview);
        result[uid] = preview;
      } catch {
        result[uid] = '';
      }
    }
  });
  if (previewCache.size > 5000) {
    // 素朴なLRU代替: 古い半分を捨てる
    const keys = [...previewCache.keys()].slice(0, 2500);
    for (const k of keys) previewCache.delete(k);
  }
  return result;
}

function findTextPart(node, prefer = 'plain') {
  if (!node) return null;
  const walk = (n) => {
    if (!n) return [];
    if (n.type === 'text' || /^text\//i.test(n.type || '')) {
      const subtype = (n.subtype || String(n.type).split('/')[1] || '').toLowerCase();
      return [{ part: n.part || '1', subtype, isHtml: subtype === 'html', encoding: n.encoding, charset: n.parameters?.charset }];
    }
    return (n.childNodes || []).flatMap(walk);
  };
  const parts = walk(node);
  return parts.find(p => p.subtype === prefer) || parts[0] || null;
}

function decodePart(buf, meta, part) {
  const encoding = (part.encoding || '').toLowerCase();
  let data = buf;
  try {
    if (encoding === 'base64') data = Buffer.from(buf.toString('ascii').replace(/\s+/g, ''), 'base64');
    else if (encoding === 'quoted-printable') {
      data = Buffer.from(buf.toString('ascii')
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
    }
  } catch { data = buf; }
  const charset = (part.charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return data.toString('utf8');
  }
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
export async function getMessage(account, path, uid, { markSeen = true } = {}) {
  return withLock(account, path, async (client) => {
    const msg = await client.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
    if (!msg?.source) { const e = new Error('メッセージが見つかりません（削除された可能性があります）'); e.status = 404; throw e; }
    if (markSeen && !msg.flags?.has('\\Seen')) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
    const parsed = await simpleParser(msg.source, { skipImageLinks: false });
    return { parsed, flags: msg.flags };
  });
}

export async function getAttachment(account, path, uid, index) {
  return withLock(account, path, async (client) => {
    const msg = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    if (!msg?.source) { const e = new Error('メッセージが見つかりません'); e.status = 404; throw e; }
    const parsed = await simpleParser(msg.source);
    const att = (parsed.attachments || [])[index];
    if (!att) { const e = new Error('添付ファイルが見つかりません'); e.status = 404; throw e; }
    return att;
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

export async function moveMessages(account, path, uids, targetPath) {
  return withLock(account, path, async (client) => {
    await client.messageMove(uids.join(','), targetPath, { uid: true });
    return { ok: true };
  });
}

export async function deleteMessages(account, path, uids) {
  const trash = await findSpecial(account, '\\Trash');
  const inTrash = trash && trash.path === path;
  return withLock(account, path, async (client) => {
    if (inTrash || !trash) {
      await client.messageDelete(uids.join(','), { uid: true });
    } else {
      await client.messageMove(uids.join(','), trash.path, { uid: true });
    }
    return { ok: true };
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
  }
}

export async function closeAll() {
  await Promise.allSettled([...pool.keys()].map(closeConnection));
}
