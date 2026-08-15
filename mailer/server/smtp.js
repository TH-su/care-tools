// SMTP送信層 — nodemailer
// MIMEを一度だけ構築し、送信と「送信済み」フォルダへのIMAP APPENDで同一バイトを使う。
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { getPassword } from './store.js';
import { appendMessage, findSpecial } from './imap.js';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// プレーンテキスト本文から簡易HTMLパートを生成（受信側での見栄え向上）
function composeHtml(text) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<>"')\]]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>\n');
  return `<div style="font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; font-size: 14px; line-height: 1.75; color: #1d1d1f;">${body}</div>`;
}

async function buildTransport(account) {
  const password = await getPassword(account);
  const port = Number(account.smtp.port) || 465;
  return nodemailer.createTransport({
    host: account.smtp.host,
    port,
    secure: account.smtp.secure !== undefined ? account.smtp.secure !== false : port === 465,
    auth: { user: account.smtp.user || account.user || account.email, pass: password },
    connectionTimeout: 20 * 1000,
    greetingTimeout: 20 * 1000,
  });
}

export async function testSmtp(account, password) {
  const port = Number(account.smtp.port) || 465;
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port,
    secure: account.smtp.secure !== undefined ? account.smtp.secure !== false : port === 465,
    auth: { user: account.smtp.user || account.user || account.email, pass: password },
    connectionTimeout: 15 * 1000,
    greetingTimeout: 15 * 1000,
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    const e = new Error(smtpFriendly(err));
    e.cause = err;
    throw e;
  } finally {
    transport.close();
  }
}

function smtpFriendly(err) {
  const msg = String(err?.message || err);
  if (err?.code === 'EAUTH' || /auth|535/i.test(msg)) return 'SMTP認証に失敗しました。パスワード（アプリパスワード）を確認してください。';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'SMTPサーバーが見つかりません。ホスト名を確認してください。';
  if (/ECONNREFUSED/.test(msg)) return 'SMTP接続が拒否されました。ポート番号とSSL設定を確認してください。';
  if (/ETIMEDOUT|timed?.?out/i.test(msg)) return 'SMTP接続がタイムアウトしました。';
  return `送信サーバーエラー: ${msg}`;
}

// message: { to, cc, bcc, subject, text, attachments:[{filename, contentType, contentBase64}],
//            inReplyTo, references }
export async function sendMail(account, message) {
  const fromName = account.name || '';
  const signature = account.signature ? `\n\n${account.signature}` : '';
  const text = `${message.text || ''}${message.appendSignature === false ? '' : signature}`;

  const mail = {
    from: fromName ? { name: fromName, address: account.email } : account.email,
    to: message.to,
    cc: message.cc || undefined,
    bcc: message.bcc || undefined,
    subject: message.subject || '',
    text,
    html: composeHtml(text),
    inReplyTo: message.inReplyTo || undefined,
    references: message.references || undefined,
    attachments: (message.attachments || []).map(a => ({
      filename: a.filename,
      contentType: a.contentType || undefined,
      content: Buffer.from(a.contentBase64, 'base64'),
    })),
    date: new Date(),
  };

  // MIMEを構築（送信とAPPENDで共通利用）
  const composer = new MailComposer(mail);
  const compiled = composer.compile();
  compiled.keepBcc = false; // 送信バイトにBccヘッダを含めない
  const raw = await compiled.build();
  const envelope = compiled.getEnvelope();

  const transport = await buildTransport(account);
  try {
    const info = await transport.sendMail({ envelope, raw });

    // 送信済みフォルダへ保存（Gmail等サーバー側で自動保存するプロバイダは除く）
    let savedToSent = false;
    if (!account.skipSentAppend) {
      try {
        const sent = await findSpecial(account, '\\Sent');
        if (sent) {
          await appendMessage(account, sent.path, raw, ['\\Seen']);
          savedToSent = true;
        }
      } catch {
        // 送信自体は成功しているため、保存失敗は致命的でない
      }
    }
    return { ok: true, messageId: info.messageId, savedToSent };
  } catch (err) {
    const e = new Error(smtpFriendly(err));
    e.cause = err;
    throw e;
  } finally {
    transport.close();
  }
}

// 下書き保存（IMAP APPENDのみ）
export async function saveDraft(account, message) {
  const signature = ''; // 下書きには署名を足さない（送信時に付与）
  const mail = {
    from: account.name ? { name: account.name, address: account.email } : account.email,
    to: message.to || undefined,
    cc: message.cc || undefined,
    bcc: message.bcc || undefined,
    subject: message.subject || '',
    text: `${message.text || ''}${signature}`,
    inReplyTo: message.inReplyTo || undefined,
    references: message.references || undefined,
    attachments: (message.attachments || []).map(a => ({
      filename: a.filename,
      contentType: a.contentType || undefined,
      content: Buffer.from(a.contentBase64, 'base64'),
    })),
    date: new Date(),
  };
  const compiled = new MailComposer(mail).compile();
  const raw = await compiled.build();
  const drafts = await findSpecial(account, '\\Drafts');
  if (!drafts) throw new Error('下書きフォルダが見つかりません');
  await appendMessage(account, drafts.path, raw, ['\\Draft', '\\Seen']);
  return { ok: true, mailbox: drafts.path };
}
