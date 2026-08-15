// REST API — クライアント(public/)が呼ぶすべてのエンドポイント
import express from 'express';
import net from 'node:net';
import tls from 'node:tls';
import {
  listAccounts, publicAccount, saveAccount, deleteAccount, getAccount, getSettings, saveSettings,
  getPassword,
} from './store.js';
import { ops, formatMessage } from './mail-service.js';
import { testImap } from './imap.js';
import { testSmtp } from './smtp.js';
import { DEMO_ACCOUNTS, resetDemo } from './demo.js';

export const api = express.Router();

// 非同期ハンドラのエラーを一元処理
const h = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch(err => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'サーバーエラーが発生しました', authFailed: Boolean(err.authFailed) });
  });
};

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
  res.json({ accounts: listAccounts().map(publicAccount), settings: getSettings() });
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
