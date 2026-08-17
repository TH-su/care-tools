// メッセージ一覧ペイン — 検索・フィルタ・無限スクロール・ホバーアクション
import React, { useRef, useEffect, useState } from 'react';
import { Icon } from '../icons.jsx';
import { cx, formatListDate, displayFrom, rowKey } from '../util.js';
import { EmptyState } from '../common.jsx';

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div className="skel-row" key={i} style={{ opacity: 1 - i * 0.13 }}>
          <div className="skel" style={{ width: '55%' }} />
          <div className="skel" style={{ width: '85%' }} />
          <div className="skel" style={{ width: '70%', marginBottom: 0 }} />
        </div>
      ))}
    </>
  );
}

export function MessageList({
  title, subtitle, rows, total, loading, loadingMore, error, authErrors,
  previews, selKeys, showRail, accountsById,
  search, onSearch, unseenFilter, onToggleUnseen,
  onRowClick, onRowContext, onQuickAction, onLoadMore, onOpenSettings,
  searchRef,
}) {
  const scrollRef = useRef(null);
  const [searchDraft, setSearchDraft] = useState(search);

  // 検索のデバウンス
  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    const t = setTimeout(() => { if (searchDraft !== search) onSearch(searchDraft); }, 320);
    return () => clearTimeout(t);
  }, [searchDraft]); // eslint-disable-line

  // ビュー切替時にスクロールを先頭へ
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [title, subtitle]);

  const handleScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240
        && !loading && !loadingMore && rows.length < total) {
      onLoadMore();
    }
  };

  const selSet = new Set(selKeys);
  const unseenCount = rows.filter(r => !r.seen).length;

  return (
    <section className="list-pane">
      <div className="list-header">
        <div className="list-title-row">
          <span className="list-title">{title}</span>
          {subtitle && <span className="list-sub">{subtitle}</span>}
          <span className="spacer" />
          {unseenCount > 0 && <span className="list-sub">{unseenCount}件の未開封</span>}
        </div>
        <div className="search-row">
          <div className="search-box">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              placeholder="検索"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchDraft(''); onSearch(''); e.currentTarget.blur(); } }}
              aria-label="メールを検索"
            />
            {searchDraft && (
              <button className="iconbtn" style={{ width: 18, height: 18 }} onClick={() => { setSearchDraft(''); onSearch(''); }}>
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <button className={cx('filter-chip', unseenFilter && 'on')} onClick={onToggleUnseen}>未開封</button>
        </div>
      </div>

      {authErrors?.length > 0 && (
        <div className="remote-banner" style={{ margin: '10px 12px 0' }}>
          <Icon name="warn" size={15} className="ic" />
          <span className="txt">
            {authErrors.map(e => accountsById[e.accountId]?.name || accountsById[e.accountId]?.email || 'アカウント').join('・')}
            の接続に失敗しました
          </span>
          <button onClick={onOpenSettings}>設定を開く</button>
        </div>
      )}

      <div className="list-scroll" ref={scrollRef} onScroll={handleScroll}>
        {loading && <SkeletonRows />}
        {!loading && error && (
          <EmptyState icon="warn" title="読み込みに失敗しました" desc={error} />
        )}
        {!loading && !error && rows.length === 0 && (
          <EmptyState
            icon={search ? 'search' : 'mailOpen'}
            title={search ? '一致するメールがありません' : 'メールはありません'}
            desc={search ? '別のキーワードをお試しください' : unseenFilter ? '未開封のメールはありません' : ''}
          />
        )}
        {!loading && rows.map(r => {
          const key = rowKey(r);
          const selected = selSet.has(key);
          const account = accountsById[r.accountId];
          const preview = previews[key];
          return (
            <button
              key={key}
              data-rowkey={key}
              className={cx('msg-row', selected && 'selected', !r.seen && 'unseen')}
              onClick={e => onRowClick(r, e)}
              onContextMenu={e => onRowContext(e, r)}
            >
              {showRail && account && <span className="rail" style={{ background: account.color }} />}
              <span className="msg-status">
                {!r.seen && <span className="unread-dot" />}
              </span>
              <span className="msg-main">
                <span className="msg-line1">
                  <span className="msg-from">{displayFrom(r.from)}</span>
                  <span className="msg-icons">
                    {r.answered && <Icon name="reply" size={12} />}
                    {r.hasAttachment && <Icon name="paperclip" size={12} />}
                    {r.flagged && <Icon name="flagFill" size={12} className="flag-ind" />}
                  </span>
                  <span className="msg-date">{formatListDate(r.date)}</span>
                </span>
                <span className="msg-subject">{r.subject || '（件名なし）'}</span>
                <span className="msg-preview">{preview === undefined ? '…' : preview}</span>
              </span>
              <span className="row-actions" onClick={e => e.stopPropagation()}>
                <button className="iconbtn" title={r.flagged ? 'フラグを外す' : 'フラグ'} onClick={() => onQuickAction(r, r.flagged ? 'unflag' : 'flag')}>
                  <Icon name="flag" size={14} />
                </button>
                <button className="iconbtn" title="アーカイブ" onClick={() => onQuickAction(r, 'archive')}>
                  <Icon name="archive" size={14} />
                </button>
                <button className="iconbtn del" title="削除" onClick={() => onQuickAction(r, 'delete')}>
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </button>
          );
        })}
        {loadingMore && <div className="list-loadmore">読み込み中…</div>}
        {!loading && !loadingMore && rows.length > 0 && rows.length >= total && (
          <div className="list-loadmore">{total}件のメッセージ</div>
        )}
      </div>
    </section>
  );
}
