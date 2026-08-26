// 共通部品 — ErrorBoundary / Toast / Modal / メニュー / 各種小物
import React, { useState, useCallback, useContext, useEffect, useRef, createContext } from 'react';
import { Icon } from './icons.jsx';
import { cx } from './util.js';

// ── ErrorBoundary（最外殻・クラッシュ防止） ──
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen">
          <Icon name="warn" size={40} style={{ color: 'var(--flag)' }} />
          <h2>エラーが発生しました</h2>
          <p>{String(this.state.error?.message || this.state.error || '不明なエラー')}</p>
          <button className="btn primary" onClick={() => this.setState({ hasError: false, error: null })}>
            再試行
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── トースト通知 ──
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), []);

  // action: { label, onClick } を渡すと、その場で取り消せるボタンが出る。
  // countdown: true なら残り秒数も出す（送信の取り消しのように、締切がある操作向け）
  const addToast = useCallback((message, type = 'info', duration = 3600, action = null) => {
    const id = `${Date.now()}-${Math.random()}`;
    const until = Date.now() + duration;
    setToasts(t => [...t, { id, message, type, action, until }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
    return id;
  }, []);

  // 取り消しの締切が来る前に、外から片付けたいことがある（送信が済んだときなど）
  addToast.dismiss = dismiss;

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(({ id, message, type, action, until }) => (
          <div key={id} className={cxToast(type, action)}>
            {type === 'success' && <Icon name="check" size={16} className="ic-ok" />}
            {type === 'error' && <Icon name="warn" size={16} className="ic-err" />}
            {type === 'info' && <Icon name="mail" size={16} className="ic-info" />}
            <span className="msg">{message}</span>
            {action && (
              <button
                className="toast-action"
                onClick={() => { dismiss(id); action.onClick(); }}
              >
                {action.label}
                {action.countdown && <Countdown until={until} />}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const cxToast = (type, action) => `toast${action ? ' has-action' : ''}${type === 'error' ? ' err' : ''}`;

// 残り秒数。締切があると分かるだけで、慌てずに押せる
function Countdown({ until }) {
  const [left, setLeft] = useState(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [until]);
  return <span className="cd">{left}</span>;
}

// ── モーダル ──
export function Modal({ title, icon, onClose, children, footer, className, noEscClose }) {
  useEffect(() => {
    if (noEscClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, noEscClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={cx('modal', className)} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-title">
            {icon && <Icon name={icon} size={17} style={{ color: 'var(--accent)' }} />}
            <span>{title}</span>
            <span className="spacer" />
            <button className="iconbtn" onClick={onClose} aria-label="閉じる"><Icon name="x" size={16} /></button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = '実行', danger, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="modal-body" style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)' }}>{message}</div>
      <div className="modal-foot">
        <span className="spacer" />
        <button className="btn secondary" onClick={onCancel}>キャンセル</button>
        <button
          className="btn primary" autoFocus
          style={danger ? { background: 'var(--danger)' } : undefined}
          onClick={onConfirm}
        >{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// ── コンテキストメニュー ──
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth - 8) el.style.left = `${Math.max(8, innerWidth - r.width - 8)}px`;
      if (r.bottom > innerHeight - 8) el.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
    }
    const close = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        if (item === 'sep') return <div key={i} className="ctx-sep" />;
        if (item.label && !item.onClick && !item.danger && item.header) {
          return <div key={i} className="ctx-label">{item.label}</div>;
        }
        return (
          <button
            key={i}
            className={cx('ctx-item', item.danger && 'danger')}
            onClick={() => { onClose(); item.onClick?.(); }}
          >
            {item.icon && <Icon name={item.icon} size={15} className="icon" />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 小物 ──
export function Spinner({ small }) {
  return <div className={cx('spinner', small && 'sm')} role="status" aria-label="読み込み中" />;
}

export function EmptyState({ icon = 'mail', title, desc, children }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={44} className="ic" />
      {title && <div className="t">{title}</div>}
      {desc && <div className="d">{desc}</div>}
      {children}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segment" role="radiogroup">
      {options.map(o => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange }) {
  return (
    <button
      className={cx('switch', on && 'on')} role="switch" aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}
