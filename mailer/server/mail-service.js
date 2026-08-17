// アカウント種別（実IMAP / デモ）でバックエンドを振り分け、
// APIが返す共通のJSON形へ整形する層。
import * as imapBackend from './imap.js';
import * as demoBackend from './demo.js';
import * as smtp from './smtp.js';
import { sanitizeHtml, textToHtml } from './sanitize.js';

export function backend(account) {
  return account.type === 'demo' ? demoBackend : imapBackend;
}

export const ops = {
  listMailboxes: (a, opts) => backend(a).listMailboxes(a, opts),
  findSpecial: (a, use) => backend(a).findSpecial(a, use),
  listMessages: (a, path, opts) => backend(a).listMessages(a, path, opts),
  getPreviews: (a, path, uids) => backend(a).getPreviews(a, path, uids),
  getAttachment: (a, path, uid, idx) => backend(a).getAttachment(a, path, uid, idx),
  setFlags: (a, path, uids, flags, add) => backend(a).setFlags(a, path, uids, flags, add),
  moveMessages: (a, path, uids, target) => backend(a).moveMessages(a, path, uids, target),
  deleteMessages: (a, path, uids) => backend(a).deleteMessages(a, path, uids),
  getStatus: (a, path) => backend(a).getStatus(a, path),
  sendMail: (a, msg) => (a.type === 'demo' ? demoBackend.sendMail(a, msg) : smtp.sendMail(a, msg)),
  saveDraft: (a, msg) => (a.type === 'demo' ? demoBackend.saveDraft(a, msg) : smtp.saveDraft(a, msg)),
};

const addrList = (v) => (v?.value || []).map(a => ({ name: a.name || '', address: a.address || '' }));

// mailparser の結果 → クライアントへ返すJSON
export async function formatMessage(account, path, uid, { blockRemote = true } = {}) {
  const { parsed, flags } = await backend(account).getMessage(account, path, uid);

  const attachments = (parsed.attachments || []).map((a, index) => ({
    index,
    filename: a.filename || `添付ファイル${index + 1}`,
    contentType: a.contentType || 'application/octet-stream',
    size: a.size || a.content?.length || 0,
    cid: a.cid || null,
    inline: a.contentDisposition === 'inline' && Boolean(a.cid),
  }));

  let html = null;
  let hadRemoteImages = false;
  if (parsed.html) {
    const res = sanitizeHtml(parsed.html, { attachments: parsed.attachments || [], blockRemote });
    html = res.html;
    hadRemoteImages = res.hadRemoteImages;
  } else if (parsed.text) {
    html = textToHtml(parsed.text);
  }

  return {
    accountId: account.id,
    mailbox: path,
    uid: Number(uid),
    subject: parsed.subject || '',
    from: addrList(parsed.from)[0] || { name: '', address: '' },
    to: addrList(parsed.to),
    cc: addrList(parsed.cc),
    replyTo: addrList(parsed.replyTo),
    date: (parsed.date || new Date()).toISOString(),
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []),
    html,
    isHtml: Boolean(parsed.html),
    text: parsed.text || '',
    hadRemoteImages,
    flagged: flags?.has?.('\\Flagged') ?? false,
    attachments: attachments.filter(a => !a.inline || !a.cid),
  };
}
