// REST API — クライアント(public/)が呼ぶすべてのエンドポイント
import express from 'express';
import net from 'node:net';
import tls from 'node:tls';
import {
  listAccounts, publicAccount, saveAccount, deleteAccount, getAccount, getSettings, saveSettings,
  getPassword,
  listCalendarSources, getCalendarSource, saveCalendarSource, deleteCalendarSource,
  publicCalendarSource, getCalendarSecrets,
  saveGoogleDraft, getGoogleDraft, googleDraftPublic, clearGoogleDraft,
} from './store.js';
import * as cal from './calendar.js';
import * as tasksBackend from './tasks.js';
import * as google from './google.js';
import { extractSchedule } from './schedule-extract.js';
import { localTimeZone } from './datetime.js';
import { ops, formatMessage } from './mail-service.js';
import { testImap } from './imap.js';
import { testSmtp } from './smtp.js';
import { DEMO_ACCOUNTS, resetDemo } from './demo.js';
import { BUILD, buildLine } from './build.js';

export const api = express.Router();

// 非同期ハンドラのエラーを一元処理
const h = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch(err => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'サーバーエラーが発生しました', authFailed: Boolean(err.authFailed) });
  });
};

// 動いているサーバーの版。直したはずの不具合が残るとき、まずここを見る
api.get('/health', (req, res) => {
  res.json({ ok: true, build: BUILD });
});

function requireAccount(req) {
  const account = getAccount(req.query.account || req.body?.account);
  if (!account) { const e = new Error('アカウントが見つかりません'); e.status = 404; throw e; }
  return account;
}

// アカウントを解決（'all' = 統合ビュー対象の全アカウント）
function resolveAccounts(idParam) {
  const accounts = listAccounts();
  if (idParam === 'all' || !idParam) return accounts;
  const one = accounts.find(a => a.id === idParam);
  if (!one) { const e = new Error('アカウントが見つかりません'); e.status = 404; throw e; }
  return [one];
}

// ── アカウント管理 ────────────────────────────────────────────
api.get('/accounts', h(async (req, res) => {
  res.json({
    accounts: listAccounts().map(publicAccount),
    settings: getSettings(),
    calendarSources: cal.sourcesForClient(),
    calendarTargets: cal.writableTargets(),
    calendarRedirectUri: REDIRECT_URI,
    googleDraft: googleDraftPublic(),
    timeZone: localTimeZone(),
    build: BUILD,
  });
}));

api.post('/accounts/test', h(async (req, res) => {
  const { account, accountId } = req.body;
  let { password } = req.body;
  // 編集時にパスワード未入力なら保存済みのものを使う
  if (!password && accountId) {
    const stored = getAccount(accountId);
    if (stored) password = await getPassword(stored);
  }
  const results = { imap: null, smtp: null };
  try { await testImap(account, password); results.imap = { ok: true }; }
  catch (err) { results.imap = { ok: false, error: err.message }; }
  try { await testSmtp(account, password); results.smtp = { ok: true }; }
  catch (err) { results.smtp = { ok: false, error: err.message }; }
  res.json(results);
}));

api.post('/accounts', h(async (req, res) => {
  const { account, password } = req.body;
  if (!account?.email || !account?.imap?.host || !account?.smtp?.host) {
    const e = new Error('メールアドレス・IMAP・SMTPの設定は必須です'); e.status = 400; throw e;
  }
  const saved = await saveAccount({ ...account, type: 'imap' }, password);
  res.json({ account: publicAccount(saved) });
}));

api.put('/accounts/:id', h(async (req, res) => {
  const existing = getAccount(req.params.id);
  if (!existing) { const e = new Error('アカウントが見つかりません'); e.status = 404; throw e; }
  const { account, password } = req.body;
  const saved = await saveAccount({ ...existing, ...account, id: existing.id, type: existing.type }, password);
  res.json({ account: publicAccount(saved) });
}));

api.delete('/accounts/:id', h(async (req, res) => {
  await deleteAccount(req.params.id);
  res.json({ ok: true });
}));

// デモアカウントの追加/削除
api.post('/demo', h(async (req, res) => {
  for (const demo of DEMO_ACCOUNTS) await saveAccount(demo);
  res.json({ ok: true, accounts: listAccounts().map(publicAccount) });
}));

api.delete('/demo', h(async (req, res) => {
  for (const demo of DEMO_ACCOUNTS) await deleteAccount(demo.id);
  resetDemo();
  res.json({ ok: true, accounts: listAccounts().map(publicAccount) });
}));

// ── サーバー設定の自動検出（TLS接続の可否のみ確認・認証はしない） ──
function tryConnect(host, port, useTls, timeout = 4000) {
  return new Promise((resolve) => {
    const done = (ok) => { try { sock.destroy(); } catch { /* noop */ } resolve(ok ? { host, port } : null); };
    const sock = useTls
      ? tls.connect({ host, port, timeout, rejectUnauthorized: false }, () => done(true))
      : net.connect({ host, port, timeout }, () => done(true));
    sock.on('error', () => done(false));
    sock.on('timeout', () => done(false));
  });
}

api.post('/autodetect', h(async (req, res) => {
  const email = String(req.body.email || '');
  const domain = email.split('@')[1];
  if (!domain) { const e = new Error('メールアドレスの形式が正しくありません'); e.status = 400; throw e; }
  const hosts = [`imap.${domain}`, `mail.${domain}`, domain];
  const smtpHosts = [`smtp.${domain}`, `mail.${domain}`, domain];
  const [imapHit] = (await Promise.all(hosts.map(hst => tryConnect(hst, 993, true)))).filter(Boolean);
  let smtpHit = (await Promise.all(smtpHosts.map(hst => tryConnect(hst, 465, true)))).filter(Boolean)[0] || null;
  let smtpSecure = true;
  if (!smtpHit) {
    smtpHit = (await Promise.all(smtpHosts.map(hst => tryConnect(hst, 587, false)))).filter(Boolean)[0] || null;
    smtpSecure = false;
  }
  res.json({
    imap: imapHit ? { host: imapHit.host, port: 993, secure: true } : null,
    smtp: smtpHit ? { host: smtpHit.host, port: smtpHit.port, secure: smtpSecure } : null,
  });
}));

// ── メールボックス ────────────────────────────────────────────
api.get('/mailboxes', h(async (req, res) => {
  const account = requireAccount(req);
  const boxes = await ops.listMailboxes(account, { fresh: req.query.fresh === '1' });
  res.json({ mailboxes: boxes });
}));

// サイドバーの未読バッジ（全アカウントのINBOX）
api.get('/counts', h(async (req, res) => {
  const accounts = listAccounts();
  const counts = {};
  await Promise.all(accounts.map(async (a) => {
    try {
      const inbox = await ops.findSpecial(a, '\\Inbox') || { path: 'INBOX' };
      counts[a.id] = await ops.getStatus(a, inbox.path);
    } catch {
      counts[a.id] = { unseen: 0, total: 0, error: true };
    }
  }));
  res.json({ counts });
}));

// ── メッセージ一覧（統合ビュー対応） ───────────────────────────
api.get('/messages', h(async (req, res) => {
  const { account: accountParam, mailbox, search = '', virtual } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const unseenOnly = req.query.unseen === '1';

  const accounts = resolveAccounts(accountParam);
  if (accounts.length === 0) return res.json({ rows: [], total: 0, errors: [] });

  const flaggedOnly = virtual === 'flagged';
  const errors = [];

  // 各アカウントの対象メールボックスを解決
  const targets = (await Promise.all(accounts.map(async (a) => {
    try {
      let path = mailbox;
      if (!path || accountParam === 'all' || virtual) {
        const inbox = await ops.findSpecial(a, '\\Inbox');
        path = inbox?.path || 'INBOX';
      }
      return { account: a, path };
    } catch (err) {
      errors.push({ accountId: a.id, error: err.message });
      return null;
    }
  }))).filter(Boolean);

  // 統合ビューでは各アカウントから offset+limit 件ずつ集めてマージ
  const per = accounts.length > 1 ? offset + limit : limit;
  const perOffset = accounts.length > 1 ? 0 : offset;

  const results = await Promise.all(targets.map(async ({ account, path }) => {
    try {
      return await ops.listMessages(account, path, { limit: per, offset: perOffset, search, unseenOnly, flaggedOnly });
    } catch (err) {
      errors.push({ accountId: account.id, error: err.message, authFailed: Boolean(err.authFailed) });
      return { rows: [], total: 0 };
    }
  }));

  let rows = results.flatMap(r => r.rows);
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (accounts.length > 1) rows = rows.slice(offset, offset + limit);
  const total = results.reduce((s, r) => s + r.total, 0);

  res.json({ rows, total, errors });
}));

// プレビュー（一覧の2行抜粋・遅延読み込み）
api.post('/previews', h(async (req, res) => {
  const { items } = req.body; // [{account, mailbox, uids: []}]
  const out = {};
  await Promise.all((items || []).map(async ({ account: id, mailbox, uids }) => {
    const account = getAccount(id);
    if (!account) return;
    try {
      const previews = await ops.getPreviews(account, mailbox, uids);
      for (const [uid, text] of Object.entries(previews)) out[`${id}:${mailbox}:${uid}`] = text;
    } catch { /* プレビューは装飾なので失敗は無視 */ }
  }));
  res.json({ previews: out });
}));

// ── メッセージ本文 ────────────────────────────────────────────
api.get('/message', h(async (req, res) => {
  const account = requireAccount(req);
  const { mailbox, uid } = req.query;
  const settings = getSettings();
  const blockRemote = req.query.images === 'allow' ? false : settings.remoteImages !== 'allow';
  const message = await formatMessage(account, mailbox, uid, { blockRemote });
  res.json({ message });
}));

api.get('/attachment', h(async (req, res) => {
  const account = requireAccount(req);
  const { mailbox, uid, index } = req.query;
  const att = await ops.getAttachment(account, mailbox, uid, Number(index));
  const filename = encodeURIComponent(att.filename || 'attachment');
  res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${filename}`);
  res.send(att.content);
}));

// ── アクション ────────────────────────────────────────────────
// body: { targets: [{account, mailbox, uids: []}], op, moveTo? }
api.post('/action', h(async (req, res) => {
  const { targets, op, moveTo } = req.body;
  if (!Array.isArray(targets) || targets.length === 0) {
    const e = new Error('対象が指定されていません'); e.status = 400; throw e;
  }
  const results = [];
  for (const t of targets) {
    const account = getAccount(t.account);
    if (!account) continue;
    const uids = (t.uids || []).map(Number);
    if (uids.length === 0) continue;
    try {
      switch (op) {
        case 'read': await ops.setFlags(account, t.mailbox, uids, ['\\Seen'], true); break;
        case 'unread': await ops.setFlags(account, t.mailbox, uids, ['\\Seen'], false); break;
        case 'flag': await ops.setFlags(account, t.mailbox, uids, ['\\Flagged'], true); break;
        case 'unflag': await ops.setFlags(account, t.mailbox, uids, ['\\Flagged'], false); break;
        case 'delete': await ops.deleteMessages(account, t.mailbox, uids); break;
        case 'archive': {
          const target = await ops.findSpecial(account, '\\Archive');
          if (!target) throw new Error('アーカイブフォルダがありません');
          await ops.moveMessages(account, t.mailbox, uids, target.path);
          break;
        }
        case 'junk': {
          const target = await ops.findSpecial(account, '\\Junk');
          if (!target) throw new Error('迷惑メールフォルダがありません');
          await ops.moveMessages(account, t.mailbox, uids, target.path);
          break;
        }
        case 'notjunk': {
          const inbox = await ops.findSpecial(account, '\\Inbox');
          await ops.moveMessages(account, t.mailbox, uids, inbox?.path || 'INBOX');
          break;
        }
        case 'move': {
          if (!moveTo) throw new Error('移動先が指定されていません');
          await ops.moveMessages(account, t.mailbox, uids, moveTo);
          break;
        }
        default: throw new Error(`不明な操作: ${op}`);
      }
      results.push({ account: t.account, ok: true });
    } catch (err) {
      results.push({ account: t.account, ok: false, error: err.message });
    }
  }
  const failed = results.filter(r => !r.ok);
  res.json({ ok: failed.length === 0, results });
}));

// ── 送信・下書き ──────────────────────────────────────────────
api.post('/send', h(async (req, res) => {
  const { account: id, message } = req.body;
  const account = getAccount(id);
  if (!account) { const e = new Error('差出人アカウントが見つかりません'); e.status = 404; throw e; }
  if (!message?.to?.trim()) { const e = new Error('宛先を入力してください'); e.status = 400; throw e; }

  // 転送時: 元メッセージの添付を引き継ぐ
  if (message.forwardOf) {
    const src = getAccount(message.forwardOf.account);
    if (src) {
      const { parsed } = await (await import('./mail-service.js')).backend(src)
        .getMessage(src, message.forwardOf.mailbox, message.forwardOf.uid, { markSeen: false });
      const extra = (parsed.attachments || [])
        .filter(a => a.contentDisposition !== 'inline' || !a.cid)
        .map(a => ({
          filename: a.filename || '添付ファイル',
          contentType: a.contentType,
          contentBase64: a.content.toString('base64'),
        }));
      message.attachments = [...(message.attachments || []), ...extra];
    }
  }

  const result = await ops.sendMail(account, message);
  res.json(result);
}));

api.post('/draft', h(async (req, res) => {
  const { account: id, message } = req.body;
  const account = getAccount(id);
  if (!account) { const e = new Error('アカウントが見つかりません'); e.status = 404; throw e; }
  const result = await ops.saveDraft(account, message);
  res.json(result);
}));

// ── 設定 ─────────────────────────────────────────────────────
api.put('/settings', h(async (req, res) => {
  res.json({ settings: saveSettings(req.body || {}) });
}));

// ══════════════════════════════════════════════════════════════
//  カレンダー / ToDo
// ══════════════════════════════════════════════════════════════
const PORT = Number(process.env.PORT) || 8744;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/api/oauth/google/callback`;

function parseRange(req) {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 7 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 60 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const e = new Error('期間の指定が正しくありません'); e.status = 400; throw e;
  }
  return { from, to };
}

// ── 連携元の一覧・追加・更新・削除 ────────────────────────────
api.get('/calendar/sources', h(async (req, res) => {
  res.json({
    sources: cal.sourcesForClient(), targets: cal.writableTargets(),
    redirectUri: REDIRECT_URI, googleDraft: googleDraftPublic(), build: BUILD,
  });
}));

api.post('/calendar/sources', h(async (req, res) => {
  const { type, name, url, color } = req.body || {};
  if (type !== 'ics') { const e = new Error('この方式には対応していません'); e.status = 400; throw e; }
  if (!/^https?:\/\//i.test(String(url || ''))) {
    const e = new Error('httpsで始まるカレンダーURLを入力してください'); e.status = 400; throw e;
  }
  const saved = await saveCalendarSource({ type: 'ics', name: name || '購読カレンダー', url, color: color || '#BF5AF2' });
  // 追加時に一度読んで、URLが正しいかその場で確かめる
  try {
    cal.clearIcsCache(url);
    await cal.listEvents({ from: new Date(), to: new Date(Date.now() + 86400000) });
  } catch { /* 取得失敗は一覧側のエラー表示に任せる */ }
  res.json({ source: publicCalendarSource(saved), sources: cal.sourcesForClient() });
}));

api.put('/calendar/sources/:id', h(async (req, res) => {
  const existing = getCalendarSource(req.params.id);
  if (!existing) { const e = new Error('カレンダーが見つかりません'); e.status = 404; throw e; }
  const { name, color, enabled, calendars, defaultCalendarId } = req.body || {};
  const patch = { ...existing };
  if (name !== undefined) patch.name = name;
  if (color !== undefined) patch.color = color;
  if (enabled !== undefined) patch.enabled = Boolean(enabled);
  if (defaultCalendarId !== undefined) patch.defaultCalendarId = defaultCalendarId;
  if (Array.isArray(calendars)) {
    const sel = new Map(calendars.map(c => [c.id, c.selected !== false]));
    patch.calendars = (existing.calendars || []).map(c => (sel.has(c.id) ? { ...c, selected: sel.get(c.id) } : c));
  }
  const saved = await saveCalendarSource(patch);
  res.json({ source: publicCalendarSource(saved), sources: cal.sourcesForClient() });
}));

api.delete('/calendar/sources/:id', h(async (req, res) => {
  const source = getCalendarSource(req.params.id);
  if (source?.type === 'google') {
    const creds = await getCalendarSecrets(source);
    if (creds.refreshToken) await google.revokeToken(creds.refreshToken);
    google.forgetToken(source.id);
  }
  if (source?.url) cal.clearIcsCache(source.url);
  await deleteCalendarSource(req.params.id);
  res.json({ ok: true, sources: cal.sourcesForClient() });
}));

// Googleのカレンダー一覧を取り直す
api.post('/calendar/sources/:id/sync', h(async (req, res) => {
  const source = getCalendarSource(req.params.id);
  if (!source || source.type !== 'google') { const e = new Error('Googleカレンダーが見つかりません'); e.status = 404; throw e; }
  const saved = await cal.syncGoogleCalendars(source);
  res.json({ source: publicCalendarSource(saved), sources: cal.sourcesForClient() });
}));

// ── Google連携（OAuth 2.0 / PKCE） ────────────────────────────
// 貼り付けに紛れ込む「見えない文字」を取り除く。
// ブラウザやPDFからコピーすると、末尾の改行・全角空白・ゼロ幅文字・
// 前後の引用符が付いてくることがあり、見た目は同じなのにGoogleは別物として扱う。
export function cleanCredential(value) {
  let t = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')      // ゼロ幅文字・BOM
    .replace(/[\u00A0\u3000]/g, ' ')            // 改行なし空白・全角空白 → 半角空白
    .replace(/[\r\n\t]/g, '')                  // 途中で折り返された改行
    .trim();
  // JSONなどから引用符ごとコピーした場合
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

// 許可画面へ行く前に設定だけ確かめる（ブラウザを開かない）
// 入力欄が空のときは、前回の控えを使う（貼り直しの手間を省くため）
async function googleCreds(body) {
  const draft = await getGoogleDraft();
  const clientId = cleanCredential(body?.clientId) || draft.clientId;
  const clientSecret = cleanCredential(body?.clientSecret) || draft.clientSecret;
  if (!clientId) { const e = new Error('クライアントIDを入力してください'); e.status = 400; throw e; }
  // 掃除しても空白が残る＝2つの値をまとめて貼ってしまった等。先に気付けるようにする
  if (/\s/.test(clientId) || /\s/.test(clientSecret || '')) {
    const e = new Error('クライアントIDまたはシークレットに空白が混ざっています。もう一度コピーし直してください。');
    e.status = 400; throw e;
  }
  await saveGoogleDraft({ clientId, clientSecret });
  return { clientId, clientSecret };
}

// 控えを消して、まっさらな状態から入力し直す
api.delete('/calendar/google/draft', h(async (req, res) => {
  await clearGoogleDraft();
  res.json({ ok: true, googleDraft: googleDraftPublic() });
}));

api.post('/calendar/google/verify', h(async (req, res) => {
  const { clientId, clientSecret } = await googleCreds(req.body);
  res.json(await google.verifyClient({ clientId, clientSecret, redirectUri: REDIRECT_URI }));
}));

api.post('/calendar/google/start', h(async (req, res) => {
  const { clientId, clientSecret } = await googleCreds(req.body);

  // 通らないと分かっている設定でブラウザを開いても徒労なので、先に確かめる。
  // 判定できなかったとき（ネットワーク不調など）は止めずに進める。
  const check = await google.verifyClient({ clientId, clientSecret, redirectUri: REDIRECT_URI });
  if (!check.ok && (check.code === 'invalid_client' || check.code === 'unauthorized_client')) {
    const e = new Error(check.message); e.status = 400; e.authFailed = true; throw e;
  }

  const { authUrl, state } = google.startAuth({ clientId, clientSecret, redirectUri: REDIRECT_URI });
  res.json({ authUrl, state, redirectUri: REDIRECT_URI, check });
}));

api.get('/calendar/google/status', h(async (req, res) => {
  const p = google.getPending(String(req.query.state || ''));
  if (!p) return res.json({ status: 'expired' });
  res.json({
    status: p.status, error: p.error || null,
    source: p.sourceId ? publicCalendarSource(getCalendarSource(p.sourceId) || {}) : null,
    sources: p.status === 'done' ? cal.sourcesForClient() : undefined,
  });
}));

// Googleからのリダイレクト受け口（ブラウザが直接開く）
api.get('/oauth/google/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const p = google.getPending(state);
  // 画面に出す値は必ずエスケープする（Googleの応答をそのまま埋め込むため）
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // tone: ok=済んだ / todo=あと一手 / error=止まった。印の色を合わせないと、文章と食い違って見える
  const page = (title, body, ok, extra = '', tone = ok ? 'ok' : 'error') => `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;background:#f5f5f7;color:#1d1d1f;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#fff;border-radius:16px;padding:36px 40px;max-width:520px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12)}
.mark{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;margin:0 auto 16px;font-size:26px;
background:${tone === 'ok' ? '#e7f7ec' : tone === 'todo' ? '#fff4e0' : '#fdecea'};color:${tone === 'ok' ? '#28a745' : tone === 'todo' ? '#c77700' : '#ff3b30'}}
h1{font-size:17px;margin:0 0 8px}p{font-size:13.5px;line-height:1.75;color:#6e6e73;margin:0}
.tip{margin-top:18px;padding:12px 14px;border-radius:10px;background:#fff8e6;border:1px solid #f3d68b;
font-size:13px;line-height:1.8;color:#6b4e00;text-align:left}
.tip code{background:rgba(0,0,0,.06);border-radius:4px;padding:1px 5px;font-size:12.5px}
.tip a{color:#0a58ca;font-weight:600}
dl{margin:16px 0 0;padding-top:14px;border-top:1px solid #e8e8ed;display:grid;grid-template-columns:auto 1fr;
gap:6px 14px;font-size:12px;text-align:left;color:#8e8e93}
dt{white-space:nowrap}
dd{margin:0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#3a3a3c}
</style></head><body><div class="card"><div class="mark">${ok ? '\u2713' : '!'}</div><h1>${esc(title)}</h1>
<p>${esc(body)}</p>${extra}</div>
<script>setTimeout(function(){window.close();},${ok ? 2500 : 600000});</script></body></html>`;

  if (req.query.error) {
    google.finishAuth(state, { status: 'error', error: `Googleで許可されませんでした（${req.query.error}）` });
    return res.status(400).send(page('連携をキャンセルしました', 'SilverMailの画面に戻ってやり直せます。', false));
  }
  if (!p) return res.status(400).send(page('この連携リンクは期限切れです', 'SilverMailの画面からもう一度お試しください。', false));

  // どの段階で失敗したかを覚えておく。引き換えの後にも通信があり、
  // ひとまとめに「引き換えに失敗」と出すと、原因の見当がまるで違う方を向く。
  let step = '認可コードの引き換え';
  try {
    const tokens = await google.exchangeCode({
      clientId: p.clientId, clientSecret: p.clientSecret,
      code: String(req.query.code || ''), redirectUri: p.redirectUri, verifier: p.verifier,
    });
    if (!tokens.refresh_token) {
      throw new Error('更新用トークンを受け取れませんでした。Googleアカウントの「サードパーティアクセス」から一度SilverMailを解除して、もう一度お試しください。');
    }
    step = 'アカウント情報の取得';
    const info = await google.fetchUserinfo(tokens.access_token);
    const email = info.email || '';
    const existing = listCalendarSources().find(s => s.type === 'google' && s.email && s.email === email);
    let source = await saveCalendarSource({
      ...(existing || {}),
      type: 'google',
      name: existing?.name || (email ? `Googleカレンダー（${email}）` : 'Googleカレンダー'),
      email,
      clientId: p.clientId,
      color: existing?.color || '#0a7aff',
      enabled: true,
    }, { clientSecret: p.clientSecret, refreshToken: tokens.refresh_token });
    google.forgetToken(source.id);
    step = 'カレンダー一覧の取り込み';
    source = await cal.syncGoogleCalendars(source);
    google.finishAuth(state, { status: 'done', sourceId: source.id });
    res.send(page('Googleカレンダーに接続しました', 'このタブは閉じて、SilverMailの画面にお戻りください。', true));
  } catch (err) {
    // 端末にも残す（画面を閉じたあとでも原因を追えるように）。
    // シークレットとコードは値を出さず、長さだけを記録する。
    // 末尾4文字だけ添える。貼り間違い（別のクライアントのシークレット）は
    // 長さが同じで見分けが付かないため、これが決め手になる。
    const len = (v) => {
      const t = String(v || '');
      if (!t) return '（無し）';
      return t.length > 8 ? `${t.length}文字（末尾 ${t.slice(-4)}）` : `${t.length}文字`;
    };
    const usedPkce = Boolean(p.verifier);
    console.error('');
    console.error(`  ┌─ [Google連携] ${step}で失敗しました ──────────`);
    console.error('  │ アプリの版   :', buildLine());
    console.error('  │ 理由        :', err?.message || err);
    console.error('  │ HTTPステータス:', err?.googleStatus ?? '（不明）');
    console.error('  │ Googleの説明 :', err?.googleDescription || '（なし）');
    console.error('  │ Googleの応答 :', err?.googleBody || '（なし）');
    console.error('  │ クライアントID:', p.clientId);
    console.error('  │ シークレット  :', len(p.clientSecret));
    console.error('  │ リダイレクトURI:', p.redirectUri);
    console.error('  │ 認可コード    :', len(req.query.code));
    console.error('  │ 検証子(PKCE) :', usedPkce ? len(p.verifier) : '（使用せず）');
    console.error('  └────────────────────────────────────────');
    console.error('');

    // 画面にも手がかりを残す。失敗の報告は端末ではなく、この画面の写真で届くため。
    // シークレットは長さだけ（写真に写っても困らない範囲にとどめる）。
    const rows = [
      ['アプリの版', buildLine()],
      ['失敗した段階', step],
      // クライアントIDは秘密ではない（認可URLにも出る）ので、そのまま出して照合しやすくする
      ['クライアントID', p.clientId || '（無し）'],
      ['シークレット', p.clientSecret ? `設定あり（${String(p.clientSecret).length}文字）` : '（無し）'],
      ['PKCE', usedPkce ? '使用（S256）' : '使用せず'],
      ['リダイレクトURI', p.redirectUri || '（無し）'],
    ];
    // 原因が名指しできるときは、次にやることまで書く
    let tip = '';
    if (err?.googleError === 'invalid_client') {
      // Googleは invalid_client を「IDが無い」と「シークレットが違う」の両方で返す。
      // 説明文で読み分けて、直す場所を一つに絞る。
      const cause = google.invalidClientCause(err.googleDescription);
      if (cause === 'clientId') {
        tip = `<div class="tip"><b>クライアントIDの方です。</b><br>`
          + `${esc(google.clientIdNotFoundMessage(p.clientId))}<br>`
          + `設定画面の「入力し直す」から貼り直してください。</div>`;
      } else if (cause === 'clientSecret') {
        tip = `<div class="tip"><b>シークレットの方です。</b><br>`
          + `クライアントIDはGoogleに見つかりました。一致しないのはシークレットだけです。`
          + `認証情報の画面で「シークレットを追加」から新しく発行し、コピーアイコンで取得して貼り直してください。</div>`;
      } else {
        tip = `<div class="tip">クライアントIDかシークレットが、Google Cloud Consoleのものと一致していない可能性があります。`
          + `設定画面で「入力し直す」を押し、貼り直してからもう一度お試しください。</div>`;
      }
    } else if (err?.googleError === 'redirect_uri_mismatch') {
      tip = `<div class="tip">Google Cloud Consoleの「承認済みのリダイレクト URI」に`
        + `<code>${esc(p.redirectUri)}</code> をそのまま（末尾のスラッシュなしで）登録してください。</div>`;
    } else if (err?.apiDisabled) {
      // Google側で有効にするだけで済む。押す場所へ直接行けるようにする
      const d = err.apiDisabled;
      const project = d.project ? `?project=${encodeURIComponent(d.project)}` : '';
      const link = (svc, label) =>
        `<a href="https://console.cloud.google.com/apis/library/${svc}${project}" target="_blank" rel="noreferrer">${label}を有効にする</a>`;
      tip = `<div class="tip"><b>認証は通っています。</b>あとはGoogle側で、使うAPIを有効にするだけです。<br>`
        + `${link('calendar-json.googleapis.com', 'Google Calendar API')}<br>`
        + `${link('tasks.googleapis.com', 'Google Tasks API')}<br>`
        + `どちらも有効にしたら、数分おいてから、もう一度お試しください。</div>`;
    }
    const details = tip + '<dl>' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';

    google.finishAuth(state, { status: 'error', error: err.message });
    // APIの有効化待ちは「繋がらなかった」のではなく、Google側であと一手が要るだけ
    const title = err?.apiDisabled ? 'あと一歩です' : '接続できませんでした';
    const tone = err?.apiDisabled ? 'todo' : 'error';
    res.status(err?.apiDisabled ? 400 : 500)
      .send(page(title, String(err.message || err), false, details, tone));
  }
});

// ── 予定 ─────────────────────────────────────────────────────
api.get('/calendar/events', h(async (req, res) => {
  const { from, to } = parseRange(req);
  const r = await cal.listEvents({ from, to });
  res.json({ ...r, timeZone: localTimeZone() });
}));

api.post('/calendar/events', h(async (req, res) => {
  const { sourceId, calendarId, event } = req.body || {};
  if (!event?.title?.trim()) { const e = new Error('予定のタイトルを入力してください'); e.status = 400; throw e; }
  if (!event?.start || !event?.end) { const e = new Error('開始と終了の日時を指定してください'); e.status = 400; throw e; }
  const created = await cal.createEvent({ sourceId, calendarId, event });
  res.json({ event: created });
}));

api.put('/calendar/events', h(async (req, res) => {
  const { sourceId, calendarId, eventId, event } = req.body || {};
  if (!sourceId || !eventId) { const e = new Error('対象の予定が指定されていません'); e.status = 400; throw e; }
  const updated = await cal.updateEvent({ sourceId, calendarId, eventId, event });
  res.json({ event: updated });
}));

api.post('/calendar/events/delete', h(async (req, res) => {
  const { sourceId, calendarId, eventId } = req.body || {};
  if (!sourceId || !eventId) { const e = new Error('対象の予定が指定されていません'); e.status = 400; throw e; }
  res.json(await cal.removeEvent({ sourceId, calendarId, eventId }));
}));

// ── ToDo ─────────────────────────────────────────────────────
api.get('/tasks', h(async (req, res) => {
  res.json(await tasksBackend.listTasks({ includeDone: req.query.done !== '0' }));
}));

// 保存先が指定されなければ、設定の既定リストへ入れる（無ければこのMac）
function taskTarget(body) {
  if (body?.sourceId) return { sourceId: body.sourceId, listId: body.listId };
  const def = getSettings().defaultTaskList;
  if (def?.sourceId && def.sourceId !== tasksBackend.LOCAL_TASK_SOURCE) {
    // 連携が外れている場合に備えて、保存先がまだ生きているか確かめる
    if (getCalendarSource(def.sourceId)) return { sourceId: def.sourceId, listId: def.listId };
  }
  return { sourceId: tasksBackend.LOCAL_TASK_SOURCE, listId: tasksBackend.LOCAL_TASK_LIST };
}

api.post('/tasks', h(async (req, res) => {
  const { task } = req.body || {};
  if (!task?.title?.trim()) { const e = new Error('ToDoの内容を入力してください'); e.status = 400; throw e; }
  const target = taskTarget(req.body);
  res.json({ task: await tasksBackend.createTask({ ...target, task }) });
}));

// このMacのToDo ⇄ Google ToDo の付け替え
api.post('/tasks/move', h(async (req, res) => {
  const { from, to } = req.body || {};
  if (!from?.taskId || !to) { const e = new Error('移動元と移動先を指定してください'); e.status = 400; throw e; }
  res.json({ task: await tasksBackend.moveTask({ from, to }) });
}));

api.put('/tasks', h(async (req, res) => {
  const { sourceId, listId, taskId, patch } = req.body || {};
  if (!taskId) { const e = new Error('対象のToDoが指定されていません'); e.status = 400; throw e; }
  res.json({ task: await tasksBackend.updateTask({ sourceId, listId, taskId, patch: patch || {} }) });
}));

api.post('/tasks/delete', h(async (req, res) => {
  const { sourceId, listId, taskId } = req.body || {};
  if (!taskId) { const e = new Error('対象のToDoが指定されていません'); e.status = 400; throw e; }
  res.json(await tasksBackend.removeTask({ sourceId, listId, taskId }));
}));

// ── メール本文から日時の候補を出す ────────────────────────────
api.post('/schedule/suggest', h(async (req, res) => {
  const { subject = '', text = '', baseDate } = req.body || {};
  res.json({ hints: extractSchedule({ subject, text, baseDate }) });
}));
