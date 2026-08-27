// 新規メッセージ / 返信 / 転送 の作成ウインドウ
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '../icons.jsx';
import { cx, EMAIL_RE, formatBytes } from '../util.js';
import { Modal, Spinner, useToast } from '../common.jsx';
import { api } from '../api.js';

const MAX_ATTACH_TOTAL = 25 * 1024 * 1024;

// 宛先のトークン入力（チップ化・バリデーション付き）
function TokenInput({ tokens, onChange, autoFocus, placeholder }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const commit = useCallback((text) => {
    const parts = String(text).split(/[,;、]/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    onChange([...tokens, ...parts.map(p => {
      const m = p.match(/^(.*?)\s*<([^>]+)>$/);
      const address = (m ? m[2] : p).trim();
      return { address, name: m ? m[1].replace(/^"|"$/g, '') : '', valid: EMAIL_RE.test(address) };
    })]);
    setDraft('');
  }, [tokens, onChange]);

  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && tokens.length > 0) {
      onChange(tokens.slice(0, -1));
    }
  };

  return (
    <div className="tokens" onClick={() => inputRef.current?.focus()}>
      {tokens.map((t, i) => (
        <span key={i} className={cx('token', !t.valid && 'invalid')} title={t.valid ? t.address : 'メールアドレスの形式が正しくありません'}>
          {t.name ? `${t.name}` : t.address}
          <button onClick={() => onChange(tokens.filter((_, j) => j !== i))} aria-label="削除">
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        placeholder={tokens.length === 0 ? placeholder : ''}
        autoFocus={autoFocus}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}

const toTokens = (list) => (list || []).map(a => ({ address: a.address, name: a.name || '', valid: EMAIL_RE.test(a.address || '') }));
const joinTokens = (tokens) => tokens.map(t => (t.name ? `"${t.name}" <${t.address}>` : t.address)).join(', ');

export function Compose({ accounts, initial, onClose, onSent, onDeferredSend }) {
  const toast = useToast();
  const [fromId, setFromId] = useState(initial.fromId || accounts[0]?.id);
  const [to, setTo] = useState(toTokens(initial.to));
  const [cc, setCc] = useState(toTokens(initial.cc));
  const [bcc, setBcc] = useState(toTokens(initial.bcc));
  const [showCc, setShowCc] = useState((initial.cc || []).length > 0);
  const [subject, setSubject] = useState(initial.subject || '');
  const [body, setBody] = useState(initial.body || '');
  const [attachments, setAttachments] = useState(initial.attachments || []);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [fromMenu, setFromMenu] = useState(false);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);

  const from = accounts.find(a => a.id === fromId) || accounts[0];
  const dirty = to.length > 0 || subject.trim() !== (initial.subject || '').trim() || body.trim() !== (initial.body || '').trim() || attachments.length > 0;

  useEffect(() => {
    if (initial.focusBody) bodyRef.current?.focus();
  }, [initial.focusBody]);

  const addFiles = async (files) => {
    const list = [...files];
    const current = attachments.reduce((s, a) => s + a.size, 0);
    let total = current;
    const added = [];
    for (const f of list) {
      total += f.size;
      if (total > MAX_ATTACH_TOTAL) {
        toast(`添付の合計サイズが上限（${formatBytes(MAX_ATTACH_TOTAL)}）を超えます`, 'error');
        break;
      }
      const contentBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(f);
      }).catch(() => null);
      if (contentBase64 === null) {
        toast(`${f.name} を読み込めませんでした`, 'error');
        continue;
      }
      added.push({ filename: f.name, contentType: f.type || 'application/octet-stream', size: f.size, contentBase64 });
    }
    if (added.length) setAttachments(a => [...a, ...added]);
  };

  const validate = () => {
    if (to.length === 0) return '宛先を入力してください';
    const bad = [...to, ...cc, ...bcc].find(t => !t.valid);
    if (bad) return `宛先「${bad.address}」の形式が正しくありません`;
    return null;
  };

  const send = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);

    const message = {
      to: joinTokens(to),
      cc: cc.length ? joinTokens(cc) : undefined,
      bcc: bcc.length ? joinTokens(bcc) : undefined,
      subject,
      text: body,
      attachments: attachments.map(({ filename, contentType, contentBase64 }) => ({ filename, contentType, contentBase64 })),
      inReplyTo: initial.inReplyTo,
      references: initial.references,
      forwardOf: initial.forwardOf,
    };

    // 送信を少しのあいだ保留して、取り消せるようにする。
    // 宛先違いや書き忘れは押した直後に気付くので、その数秒を親に預ける。
    if (onDeferredSend) {
      onDeferredSend({
        fromId: from.id,
        message,
        // 取り消したら、書きかけをそのままの状態で開き直す
        restore: {
          fromId: from.id,
          to: to.map(t => ({ address: t.address, name: t.name })),
          cc: cc.map(t => ({ address: t.address, name: t.name })),
          bcc: bcc.map(t => ({ address: t.address, name: t.name })),
          subject, body, attachments,
          inReplyTo: initial.inReplyTo,
          references: initial.references,
          forwardOf: initial.forwardOf,
        },
      });
      onClose();
      return;
    }

    setSending(true);
    try {
      const result = await api.send(from.id, message);
      toast(result.demo ? '送信しました（デモ: 送信済みに保存）' : '送信しました', 'success');
      onSent?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      await api.saveDraft(from.id, {
        to: joinTokens(to), cc: joinTokens(cc), subject, text: body,
        inReplyTo: initial.inReplyTo, references: initial.references,
      });
      toast('下書きを保存しました', 'success');
      onClose();
    } catch (err) {
      toast(`下書きの保存に失敗: ${err.message}`, 'error');
      setSavingDraft(false);
    }
  };

  const tryClose = () => {
    if (dirty && !sending) setConfirmClose(true);
    else onClose();
  };

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  };

  return (
    <Modal onClose={tryClose} className={cx('compose', dropping && 'dropping')} noEscClose={false}>
      <div
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        onKeyDown={onKeyDown}
        onDragOver={e => { e.preventDefault(); setDropping(true); }}
        onDragLeave={e => { if (e.target === e.currentTarget) setDropping(false); }}
        onDrop={e => { e.preventDefault(); setDropping(false); addFiles(e.dataTransfer.files); }}
      >
        <div className="modal-title">
          <Icon name="compose" size={16} style={{ color: 'var(--accent)' }} />
          <span>{initial.title || '新規メッセージ'}</span>
          <span className="spacer" />
          <button className="iconbtn" onClick={tryClose} aria-label="閉じる"><Icon name="x" size={16} /></button>
        </div>

        <div className="compose-head">
          <div className="compose-row" style={{ position: 'relative' }}>
            <label>差出人</label>
            <button className="from-select" onClick={() => setFromMenu(v => !v)}>
              <span className="dot" style={{ background: from?.color }} />
              <span>{from?.name}</span>
              <span className="em">&lt;{from?.email}&gt;</span>
              {accounts.length > 1 && <Icon name="chevD" size={12} style={{ color: 'var(--text-3)' }} />}
            </button>
            {fromMenu && accounts.length > 1 && (
              <div className="ctx-menu" style={{ position: 'absolute', left: 60, top: 36 }}>
                {accounts.map(a => (
                  <button key={a.id} className="ctx-item" onClick={() => { setFromId(a.id); setFromMenu(false); }}>
                    <span className="dot" style={{ background: a.color }} />
                    <span>{a.name} &lt;{a.email}&gt;</span>
                    {a.id === fromId && <Icon name="check" size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="compose-row">
            <label>宛先</label>
            <TokenInput tokens={to} onChange={setTo} autoFocus={!initial.focusBody} placeholder="name@example.com" />
            {!showCc && <button className="link" onClick={() => setShowCc(true)}>Cc/Bcc</button>}
          </div>
          {showCc && (
            <>
              <div className="compose-row">
                <label>Cc</label>
                <TokenInput tokens={cc} onChange={setCc} placeholder="" />
              </div>
              <div className="compose-row">
                <label>Bcc</label>
                <TokenInput tokens={bcc} onChange={setBcc} placeholder="" />
              </div>
            </>
          )}
          <div className="compose-row">
            <label>件名</label>
            <input className="subject-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="" />
          </div>
        </div>

        <textarea
          ref={bodyRef}
          className="compose-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="本文を入力…"
        />

        {attachments.length > 0 && (
          <div className="compose-attach">
            {attachments.map((a, i) => (
              <span key={i} className="attach-chip" style={{ padding: '5px 10px' }}>
                <Icon name={/^image\//.test(a.contentType) ? 'image' : 'doc'} size={15} className="ic" />
                <span className="nm">{a.filename}</span>
                <span className="sz">{formatBytes(a.size)}</span>
                <button className="iconbtn" style={{ width: 18, height: 18 }} onClick={() => setAttachments(x => x.filter((_, j) => j !== i))}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className="remote-banner" style={{ margin: '0 18px 10px' }}>
            <Icon name="warn" size={15} className="ic" />
            <span className="txt">{error}</span>
          </div>
        )}

        <div className="compose-foot">
          <button className="btn primary" onClick={send} disabled={sending}>
            {sending ? <Spinner small /> : <Icon name="sent" size={15} />}
            {sending ? '送信中…' : '送信'}
          </button>
          <button className="iconbtn" title="ファイルを添付" onClick={() => fileRef.current?.click()}>
            <Icon name="paperclip" size={17} />
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          <span className="spacer" />
          <span className="note">⌘Enter で送信・ファイルはドラッグ＆ドロップでも添付できます</span>
        </div>
      </div>

      {confirmClose && (
        <div className="modal-backdrop" style={{ borderRadius: 'var(--radius-lg)' }}>
          <div className="modal" style={{ width: 340 }}>
            <div className="modal-body" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              このメッセージを保存しますか？<br />
              <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>保存しない場合、入力した内容は失われます。</span>
            </div>
            <div className="modal-foot" style={{ flexWrap: 'wrap' }}>
              <button className="btn danger-ghost" onClick={onClose}>保存しない</button>
              <span className="spacer" />
              <button className="btn secondary" onClick={() => setConfirmClose(false)}>キャンセル</button>
              <button className="btn primary" onClick={saveDraft} disabled={savingDraft}>
                {savingDraft ? '保存中…' : '下書きを保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
