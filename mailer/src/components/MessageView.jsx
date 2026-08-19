// 閲覧ペイン — ツールバー・ヘッダー・サンドボックス化した本文・添付
import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '../icons.jsx';
import {
  cx, formatFullDate, initialsOf, colorForString, formatBytes, addressListText, displayFrom,
} from '../util.js';
import { EmptyState, Spinner, Modal } from '../common.jsx';
import { attachmentUrl } from '../api.js';
import { eventTimeLabel, fmtDayLabel } from '../calendar-util.js';

// メール本文iframeのベーススタイル
function buildSrcdoc(message, { allowRemote, dark }) {
  const isPlain = !message.isHtml;
  const bg = isPlain ? (dark ? '#212123' : '#ffffff') : '#ffffff';
  const fg = isPlain ? (dark ? '#f5f5f7' : '#1d1d1f') : '#1d1d1f';
  const linkColor = dark && isPlain ? '#409cff' : '#0a7aff';
  const csp = [
    "default-src 'none'",
    `img-src data:${allowRemote ? ' https: http:' : ''}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
  ].join('; ');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;
    font-size:14px;line-height:1.8;color:${fg};background:${bg};
    padding:14px 14px 8px;word-wrap:break-word;overflow-wrap:break-word;}
  img{max-width:100%;height:auto}
  img[src=""]{min-width:28px;min-height:28px;background:#f2f2f4 url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2218%22 height=%2218%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a1a1a6%22 stroke-width=%221.6%22%3E%3Crect x=%223.5%22 y=%225%22 width=%2217%22 height=%2214%22 rx=%222%22/%3E%3Ccircle cx=%229%22 cy=%2210%22 r=%221.6%22/%3E%3Cpath d=%22m5 17.5 4.5-4.5 3 3 3-3 3.5 3.5%22/%3E%3C/svg%3E') center no-repeat;border:1px dashed #c7c7cc;border-radius:6px}
  pre{white-space:pre-wrap}
  a{color:${linkColor}}
  table{max-width:100%}
  .plain{white-space:pre-wrap;font-size:13.5px}
  .q{color:${linkColor}} .q2{color:#30a46c} .q3{color:#b0791d}
  blockquote{margin:6px 0;padding-left:12px;border-left:3px solid ${dark && isPlain ? '#3a3a3c' : '#d8d8dc'};color:${dark && isPlain ? '#98989d' : '#6e6e73'}}
</style></head><body>${message.html || ''}</body></html>`;
}

export function MessageView({
  open, row, dark, onReply, onAction, onAllowImages, onMoveMenu, onFromClick,
  onCreateEvent, onCreateTask,
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [preview, setPreview] = useState(null);
  const iframeRef = useRef(null);

  const message = open.message;
  useEffect(() => { setShowDetail(false); }, [message?.uid, message?.accountId]);

  if (!row) {
    return (
      <main className="read-pane">
        <div className="read-toolbar" style={{ visibility: 'hidden' }}><span className="iconbtn" /></div>
        <EmptyState icon="mailOpen" title="メッセージが選択されていません" desc="左の一覧からメールを選択してください" />
      </main>
    );
  }

  const flagged = row.flagged;
  const seen = row.seen;

  const onIframeLoad = (e) => {
    try {
      const doc = e.currentTarget.contentDocument;
      if (doc) {
        e.currentTarget.style.height = `${Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight) + 8}px`;
      }
    } catch { /* 高さ調整できない場合はデフォルト */ }
  };

  const tbtn = (icon, label, onClick, opts = {}) => (
    <button className={cx('iconbtn', opts.className)} title={label} aria-label={label} onClick={onClick} disabled={opts.disabled}>
      <Icon name={icon} size={17} />
    </button>
  );

  return (
    <main className="read-pane">
      <div className="read-toolbar">
        <div className="group">
          {tbtn('reply', '返信（R）', () => onReply('reply'), { disabled: !message })}
          {tbtn('replyAll', '全員に返信', () => onReply('replyAll'), { disabled: !message })}
          {tbtn('forward', '転送', () => onReply('forward'), { disabled: !message })}
        </div>
        <div className="sep" />
        <div className="group">
          {tbtn('archive', 'アーカイブ（E）', () => onAction('archive'))}
          {tbtn('junk', '迷惑メール', () => onAction('junk'))}
          {tbtn('trash', '削除（⌫）', () => onAction('delete'))}
        </div>
        <div className="sep" />
        <div className="group">
          {tbtn(flagged ? 'flagFill' : 'flag', flagged ? 'フラグを外す（F）' : 'フラグ（F）', () => onAction(flagged ? 'unflag' : 'flag'), { className: flagged ? 'flag-on' : '' })}
          {tbtn(seen ? 'mail' : 'mailOpen', seen ? '未開封にする（U）' : '開封済みにする', () => onAction(seen ? 'unread' : 'read'))}
          {tbtn('move', 'フォルダへ移動', (e) => onMoveMenu(e))}
        </div>
        <div className="sep" />
        <div className="group">
          {tbtn('calendarPlus', '予定を作成（S）', () => onCreateEvent?.(message), { disabled: !message })}
          {tbtn('todo', 'ToDoに追加（T）', () => onCreateTask?.(message), { disabled: !message })}
        </div>
        <span className="spacer" />
      </div>

      <div className="read-scroll">
        {open.loading && <div className="center-fill"><Spinner /></div>}
        {!open.loading && open.error && (
          <EmptyState icon="warn" title="メッセージを読み込めません" desc={open.error} />
        )}
        {!open.loading && !open.error && message && (
          <>
            <div className="read-header">
              <h1 className="read-subject">
                {flagged && <Icon name="flagFill" size={15} style={{ color: 'var(--flag)', marginRight: 6, verticalAlign: '-1px' }} />}
                {message.subject || '（件名なし）'}
              </h1>
              <div className="read-fromline">
                <div className="avatar" style={{ background: colorForString(message.from?.address || message.from?.name) }}>
                  {initialsOf(message.from?.name, message.from?.address)}
                </div>
                <div className="read-meta">
                  <div className="read-from-name">
                    <button style={{ fontWeight: 600 }} title="この差出人へ新規メール" onClick={() => onFromClick(message.from)}>
                      {displayFrom(message.from)}
                    </button>
                    {message.from?.name && <span className="read-from-addr">{message.from.address}</span>}
                  </div>
                  <div className="read-recips">
                    宛先: {addressListText(message.to) || '—'}
                    {message.cc?.length > 0 && !showDetail && '、CC…'}
                    {(message.cc?.length > 0 || message.to?.length > 1) && (
                      <button className="expand" onClick={() => setShowDetail(v => !v)}>
                        {showDetail ? '簡易表示' : '詳細'}
                      </button>
                    )}
                  </div>
                  {showDetail && message.cc?.length > 0 && (
                    <div className="read-recips">CC: {addressListText(message.cc)}</div>
                  )}
                  {showDetail && message.replyTo?.length > 0 && (
                    <div className="read-recips">返信先: {addressListText(message.replyTo)}</div>
                  )}
                </div>
                <div className="read-date">{formatFullDate(message.date)}</div>
              </div>
            </div>

            {message.attachments?.length > 0 && (
              <div className="attach-strip">
                {message.attachments.map(att => {
                  const isImage = /^image\//.test(att.contentType);
                  const url = attachmentUrl(message.accountId, message.mailbox, message.uid, att.index, isImage);
                  return (
                    <button
                      key={att.index} className="attach-chip"
                      title={isImage ? 'クリックでプレビュー' : 'クリックでダウンロード'}
                      onClick={() => {
                        if (isImage) setPreview({ url, name: att.filename });
                        else {
                          const a = document.createElement('a');
                          a.href = attachmentUrl(message.accountId, message.mailbox, message.uid, att.index);
                          a.download = att.filename;
                          a.click();
                        }
                      }}
                    >
                      <Icon name={isImage ? 'image' : 'doc'} size={17} className="ic" />
                      <span className="nm">{att.filename}</span>
                      <span className="sz">{formatBytes(att.size)}</span>
                      <Icon name="download" size={13} style={{ color: 'var(--text-3)' }} />
                    </button>
                  );
                })}
              </div>
            )}

            {message.scheduleHints?.length > 0 && (
              <div className="schedule-banner">
                <Icon name="calendarPlus" size={16} className="ic" />
                <div className="body">
                  <div className="t">このメールに日時が書かれています</div>
                  <div className="chips">
                    {message.scheduleHints.slice(0, 3).map((hint, i) => (
                      <button
                        key={i} className="chip" title={`「${hint.matched}」から`}
                        onClick={() => onCreateEvent?.(message, hint)}
                      >
                        <span className="d">{fmtDayLabel(hint.start)}</span>
                        <span className="tm">{eventTimeLabel({ start: hint.start, end: hint.end, allDay: hint.allDay })}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <button className="add" onClick={() => onCreateEvent?.(message, message.scheduleHints[0])}>
                  カレンダーに追加
                </button>
              </div>
            )}

            {message.hadRemoteImages && !open.imagesAllowed && (
              <div className="remote-banner">
                <Icon name="shield" size={15} className="ic" />
                <span className="txt">プライバシー保護のため、リモート画像を読み込んでいません。</span>
                <button onClick={onAllowImages}>画像を読み込む</button>
              </div>
            )}

            <div className="read-body">
              <iframe
                ref={iframeRef}
                title="メール本文"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                srcDoc={buildSrcdoc(message, { allowRemote: open.imagesAllowed, dark })}
                onLoad={onIframeLoad}
                style={{ height: 200 }}
              />
            </div>
          </>
        )}
      </div>

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} className="preview-modal">
          <div className="modal-body" style={{ padding: 12 }}>
            <img src={preview.url} alt={preview.name} />
          </div>
        </Modal>
      )}
    </main>
  );
}
