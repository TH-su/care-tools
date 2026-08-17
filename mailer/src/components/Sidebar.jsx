// サイドバー — スマートメールボックス＋アカウント別フォルダツリー
import React from 'react';
import { Icon, MAILBOX_ICONS } from '../icons.jsx';
import { cx } from '../util.js';

function selEq(a, b) {
  if (!a || !b) return false;
  return a.kind === b.kind && a.accountId === b.accountId && a.path === b.path;
}

function boxDepth(box) {
  if (box.specialUse) return 0;
  const d = box.delimiter || '/';
  const parts = box.path.split(d);
  return Math.min(parts.length - 1, 2);
}

export function Sidebar({
  accounts, mailboxes, counts, sel, collapsed,
  onToggleCollapse, onSelect, onCompose, onAddAccount, onSettings,
  onRefresh, refreshing, themeMode, onCycleTheme,
}) {
  const totalUnseen = accounts.reduce((s, a) => s + (counts[a.id]?.unseen || 0), 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark"><Icon name="mail" size={15} /></div>
        <span className="brand-name">SilverMail</span>
        <span className="spacer" />
        <button className="iconbtn accent" title="新規メッセージ（⌘N / C）" onClick={() => onCompose()}>
          <Icon name="compose" size={19} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="side-section">
          {accounts.length > 1 && (
            <button
              className={cx('side-item', sel.kind === 'unified' && 'active')}
              onClick={() => onSelect({ kind: 'unified' })}
            >
              <Icon name="inboxes" size={17} className="icon" />
              <span className="label">すべての受信</span>
              {totalUnseen > 0 && <span className="count">{totalUnseen}</span>}
            </button>
          )}
          <button
            className={cx('side-item', sel.kind === 'flagged' && 'active')}
            onClick={() => onSelect({ kind: 'flagged' })}
          >
            <Icon name="flag" size={17} className="icon" style={{ color: 'var(--flag)' }} />
            <span className="label">フラグ付き</span>
          </button>
        </div>

        {accounts.map(account => {
          const boxes = mailboxes[account.id] || [];
          const isOpen = !collapsed[account.id];
          const unseen = counts[account.id]?.unseen || 0;
          return (
            <div className="side-section" key={account.id}>
              <button className="side-heading" onClick={() => onToggleCollapse(account.id)}>
                <Icon name="chevR" size={11} className={cx('chev', isOpen && 'open')} />
                <span className="dot" style={{ background: account.color }} />
                <span className="label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                  {account.name || account.email}
                </span>
                {!isOpen && unseen > 0 && <span className="count">{unseen}</span>}
              </button>
              {isOpen && boxes.map(box => {
                const active = selEq(sel, { kind: 'box', accountId: account.id, path: box.path });
                const depth = boxDepth(box);
                const showCount = box.specialUse === '\\Inbox' && unseen > 0;
                return (
                  <button
                    key={box.path}
                    className={cx('side-item', active && 'active', depth === 1 && 'nested', depth >= 2 && 'nested-2')}
                    onClick={() => onSelect({ kind: 'box', accountId: account.id, path: box.path })}
                    title={box.path}
                  >
                    <Icon name={MAILBOX_ICONS[box.specialUse] || 'folder'} size={16} className="icon" />
                    <span className="label">{depth > 0 ? box.path.split(box.delimiter || '/').pop() : box.name}</span>
                    {showCount && <span className="count">{unseen}</span>}
                  </button>
                );
              })}
              {isOpen && boxes.length === 0 && (
                <div className="side-item" style={{ color: 'var(--text-3)', pointerEvents: 'none' }}>
                  <span className="label">読み込み中…</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button className="side-item" onClick={onAddAccount}>
          <Icon name="plus" size={15} className="icon" />
          <span className="label">アカウントを追加</span>
        </button>
        <div className="row">
          <button className="side-item" onClick={onSettings} title="設定">
            <Icon name="gear" size={15} className="icon" />
            <span>設定</span>
          </button>
          <button className="side-item" onClick={onCycleTheme} title={`テーマ: ${themeMode === 'auto' ? '自動' : themeMode === 'dark' ? 'ダーク' : 'ライト'}`}>
            <Icon name={themeMode === 'dark' ? 'moon' : themeMode === 'light' ? 'sun' : 'sparkle'} size={15} className="icon" />
            <span>{themeMode === 'auto' ? '自動' : themeMode === 'dark' ? 'ダーク' : 'ライト'}</span>
          </button>
          <button className={cx('side-item', refreshing && 'spinning')} onClick={onRefresh} title="今すぐ受信">
            <Icon name="refresh" size={15} className={cx('icon')} style={refreshing ? { animation: 'spin 0.9s linear infinite' } : undefined} />
            <span>受信</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
