// SilverMail アプリ本体 — 状態管理と3ペインの統括
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from './api.js';
import { rowKey, displayFrom, replySubject, forwardSubject, quoteBody, forwardBody } from './util.js';
import { Icon } from './icons.jsx';
import { useToast, ContextMenu, Spinner } from './common.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { MessageList } from './components/MessageList.jsx';
import { MessageView } from './components/MessageView.jsx';
import { Compose } from './components/Compose.jsx';
import { AccountModal } from './components/AccountModal.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { Onboarding } from './components/Onboarding.jsx';

const PAGE = 50;

function applyTheme(theme) {
  const dark = theme === 'dark'
    || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('silvermail-theme', theme); } catch { /* private mode */ }
  return dark;
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function App() {
  const toast = useToast();

  // ── 基本状態 ──
  const [boot, setBoot] = useState({ loading: true, error: null });
  const [accounts, setAccounts] = useState([]);
  const [settings, setSettings] = useState({ theme: 'auto', checkIntervalMin: 3, remoteImages: 'block' });
  const [mailboxes, setMailboxes] = useState({});
  const [counts, setCounts] = useState({});
  const [collapsed, setCollapsed] = useState(() => loadJson('silvermail-collapsed', {}));

  // ── 表示中ビュー・一覧 ──
  const [sel, setSel] = useState({ kind: 'unified' });
  const [list, setList] = useState({ rows: [], total: 0, loading: false, loadingMore: false, error: null, errors: [] });
  const [previews, setPreviews] = useState({});
  const [search, setSearch] = useState('');
  const [unseenFilter, setUnseenFilter] = useState(false);
  const [selKeys, setSelKeys] = useState([]);
  const [open, setOpen] = useState({ loading: false, message: null, error: null, imagesAllowed: false });
  const [refreshing, setRefreshing] = useState(false);

  // ── モーダル類 ──
  const [compose, setCompose] = useState(null);
  const [modal, setModal] = useState(null); // {type:'account',...} | {type:'settings'}
  const [ctxMenu, setCtxMenu] = useState(null);

  // ── ペイン幅 ──
  const [paneW, setPaneW] = useState(() => loadJson('silvermail-panes', { sidebar: 232, list: 368 }));
  const dragRef = useRef(null);

  const searchRef = useRef(null);
  const accountsById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);
  const knownUnseenRef = useRef(new Set());
  const selRef = useRef(sel);
  selRef.current = sel;

  const isDark = document.documentElement.dataset.theme === 'dark';

  // ── テーマ ──
  useEffect(() => { applyTheme(settings.theme); }, [settings.theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => { if (settings.theme === 'auto') applyTheme('auto'); };
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [settings.theme]);

  // ── 起動 ──
  const loadMailboxesFor = useCallback(async (accts) => {
    const entries = await Promise.all(accts.map(async (a) => {
      try {
        const r = await api.mailboxes(a.id);
        return [a.id, r.mailboxes];
      } catch {
        return [a.id, []];
      }
    }));
    setMailboxes(m => ({ ...m, ...Object.fromEntries(entries) }));
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const r = await api.counts();
      setCounts(r.counts);
    } catch { /* バッジは装飾なので静かに失敗 */ }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const r = await api.bootstrap();
      setAccounts(r.accounts);
      setSettings(r.settings);
      applyTheme(r.settings.theme);
      setBoot({ loading: false, error: null });
      if (r.accounts.length > 0) {
        loadMailboxesFor(r.accounts);
        refreshCounts();
      }
      return r.accounts;
    } catch (err) {
      setBoot({ loading: false, error: err.message });
      return [];
    }
  }, [loadMailboxesFor, refreshCounts]);

  useEffect(() => { bootstrap(); }, []); // eslint-disable-line

  // アカウントが1つならそのINBOXを初期表示
  useEffect(() => {
    if (accounts.length === 1 && sel.kind === 'unified') {
      const a = accounts[0];
      const inbox = (mailboxes[a.id] || []).find(b => b.specialUse === '\\Inbox');
      if (inbox) setSel({ kind: 'box', accountId: a.id, path: inbox.path });
    }
  }, [accounts, mailboxes]); // eslint-disable-line

  // ── メッセージ一覧の読み込み ──
  const buildParams = useCallback((offset) => {
    const params = { limit: PAGE, offset, search: search || undefined, unseen: unseenFilter ? '1' : undefined };
    if (sel.kind === 'unified') params.account = 'all';
    else if (sel.kind === 'flagged') { params.account = 'all'; params.virtual = 'flagged'; }
    else { params.account = sel.accountId; params.mailbox = sel.path; }
    return params;
  }, [sel, search, unseenFilter]);

  const fetchPreviewsFor = useCallback(async (rows) => {
    const missing = rows.filter(r => previews[rowKey(r)] === undefined);
    if (missing.length === 0) return;
    const groups = new Map();
    for (const r of missing) {
      const gk = `${r.accountId}:${r.mailbox}`;
      if (!groups.has(gk)) groups.set(gk, { account: r.accountId, mailbox: r.mailbox, uids: [] });
      groups.get(gk).uids.push(r.uid);
    }
    try {
      const res = await api.previews([...groups.values()]);
      setPreviews(p => {
        const next = { ...p };
        for (const [k, v] of Object.entries(res.previews)) {
          const [acct, mbox, uid] = k.split(':');
          next[`${acct}|${mbox}|${uid}`] = v;
        }
        for (const r of missing) if (next[rowKey(r)] === undefined) next[rowKey(r)] = '';
        return next;
      });
    } catch { /* プレビュー失敗は無視 */ }
  }, [previews]);

  const loadList = useCallback(async ({ more = false, silent = false } = {}) => {
    if (accounts.length === 0) return;
    const offset = more ? list.rows.length : 0;
    if (!silent && !more) setList(l => ({ ...l, loading: true, error: null }));
    if (more) setList(l => ({ ...l, loadingMore: true }));
    try {
      const r = await api.messages(buildParams(offset));
      setList(l => ({
        rows: more ? [...l.rows, ...r.rows] : r.rows,
        total: r.total,
        loading: false, loadingMore: false, error: null,
        errors: r.errors || [],
      }));
      fetchPreviewsFor(r.rows);
      return r;
    } catch (err) {
      setList(l => ({ ...l, loading: false, loadingMore: false, error: more ? l.error : err.message }));
      return null;
    }
  }, [accounts.length, buildParams, fetchPreviewsFor, list.rows.length]);

  // ビュー・検索・フィルタが変わったら再読み込み
  useEffect(() => {
    setSelKeys([]);
    setOpen({ loading: false, message: null, error: null, imagesAllowed: false });
    loadList();
  }, [sel, search, unseenFilter, accounts.length]); // eslint-disable-line

  // ── ポーリング（新着チェック） ──
  useEffect(() => {
    if (accounts.length === 0) return undefined;
    const ms = Math.max(1, settings.checkIntervalMin || 3) * 60 * 1000;
    const t = setInterval(async () => {
      refreshCounts();
      const s = selRef.current;
      const inInbox = s.kind === 'unified'
        || (s.kind === 'box' && (mailboxes[s.accountId] || []).find(b => b.path === s.path)?.specialUse === '\\Inbox');
      if (inInbox && !search && !unseenFilter) {
        const r = await loadList({ silent: true });
        if (r) notifyNew(r.rows);
      }
    }, ms);
    return () => clearInterval(t);
  }, [accounts.length, settings.checkIntervalMin, mailboxes, search, unseenFilter, loadList, refreshCounts]); // eslint-disable-line

  const notifyNew = (rows) => {
    const known = knownUnseenRef.current;
    const fresh = rows.filter(r => !r.seen && !known.has(rowKey(r)));
    rows.forEach(r => { if (!r.seen) known.add(rowKey(r)); });
    if (fresh.length > 0 && settings.notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      fresh.slice(0, 3).forEach(r => {
        try {
          new Notification(displayFrom(r.from), { body: r.subject || '（件名なし）', tag: rowKey(r) });
        } catch { /* 通知不可の環境 */ }
      });
    }
  };
  useEffect(() => {
    const known = knownUnseenRef.current;
    list.rows.forEach(r => { if (!r.seen) known.add(rowKey(r)); });
  }, [list.rows]);

  // ── 手動更新 ──
  const manualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshCounts(), loadList({ silent: true })]);
    setRefreshing(false);
  };

  // ── 行選択・メッセージ表示 ──
  const openMessage = useCallback(async (row) => {
    setOpen({ loading: true, message: null, error: null, imagesAllowed: settings.remoteImages === 'allow' });
    try {
      const r = await api.message(row.accountId, row.mailbox, row.uid);
      setOpen(o => ({ ...o, loading: false, message: r.message }));
      // 開封済みへ（サーバー側で \Seen 付与済み）
      if (!row.seen) {
        setList(l => ({ ...l, rows: l.rows.map(x => (rowKey(x) === rowKey(row) ? { ...x, seen: true } : x)) }));
        setCounts(c => {
          const cur = c[row.accountId];
          if (!cur) return c;
          return { ...c, [row.accountId]: { ...cur, unseen: Math.max(0, cur.unseen - 1) } };
        });
      }
    } catch (err) {
      setOpen({ loading: false, message: null, error: err.message, imagesAllowed: false });
    }
  }, [settings.remoteImages]);

  const handleRowClick = (row, e) => {
    const key = rowKey(row);
    if (e.metaKey || e.ctrlKey) {
      setSelKeys(ks => (ks.includes(key) ? ks.filter(k => k !== key) : [...ks, key]));
      return;
    }
    if (e.shiftKey && selKeys.length > 0) {
      const keys = list.rows.map(rowKey);
      const a = keys.indexOf(selKeys[0]);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelKeys([selKeys[0], ...keys.slice(lo, hi + 1).filter(k => k !== selKeys[0])]);
      }
      return;
    }
    setSelKeys([key]);
    openMessage(row);
  };

  const allowImages = async () => {
    const m = open.message;
    if (!m) return;
    setOpen(o => ({ ...o, loading: true }));
    try {
      const r = await api.message(m.accountId, m.mailbox, m.uid, 'allow');
      setOpen(o => ({ ...o, loading: false, message: r.message, imagesAllowed: true }));
    } catch (err) {
      setOpen(o => ({ ...o, loading: false }));
      toast(err.message, 'error');
    }
  };

  // ── アクション ──
  const rowsForKeys = (keys) => list.rows.filter(r => keys.includes(rowKey(r)));

  const selectedRows = () => {
    if (selKeys.length > 0) return rowsForKeys(selKeys);
    return [];
  };

  const doAction = useCallback(async (rows, op, moveTo) => {
    if (rows.length === 0) return;
    const keys = new Set(rows.map(rowKey));
    const removing = ['delete', 'archive', 'junk', 'notjunk', 'move'].includes(op);

    // 楽観的更新
    if (removing) {
      setList(l => ({ ...l, rows: l.rows.filter(r => !keys.has(rowKey(r))), total: Math.max(0, l.total - rows.length) }));
      setSelKeys(ks => ks.filter(k => !keys.has(k)));
      if (open.message && keys.has(`${open.message.accountId}|${open.message.mailbox}|${open.message.uid}`)) {
        setOpen({ loading: false, message: null, error: null, imagesAllowed: false });
      }
    } else {
      const mut = {
        read: r => ({ ...r, seen: true }),
        unread: r => ({ ...r, seen: false }),
        flag: r => ({ ...r, flagged: true }),
        unflag: r => ({ ...r, flagged: false }),
      }[op];
      if (mut) setList(l => ({ ...l, rows: l.rows.map(r => (keys.has(rowKey(r)) ? mut(r) : r)) }));
    }

    // アカウント×メールボックスでグループ化してAPIへ
    const groups = new Map();
    for (const r of rows) {
      const gk = `${r.accountId}:${r.mailbox}`;
      if (!groups.has(gk)) groups.set(gk, { account: r.accountId, mailbox: r.mailbox, uids: [] });
      groups.get(gk).uids.push(r.uid);
    }
    try {
      const res = await api.action([...groups.values()], op, moveTo);
      if (!res.ok) {
        const msg = res.results.find(x => !x.ok)?.error || '一部の操作に失敗しました';
        toast(msg, 'error');
        loadList({ silent: true });
      } else {
        const labels = {
          delete: 'ゴミ箱に移動しました', archive: 'アーカイブしました', junk: '迷惑メールに移動しました',
          notjunk: '受信に移動しました', move: '移動しました',
        };
        if (labels[op]) toast(labels[op], 'success', 2200);
      }
      if (removing || op === 'read' || op === 'unread') refreshCounts();
    } catch (err) {
      toast(err.message, 'error');
      loadList({ silent: true });
    }
  }, [open.message, toast, loadList, refreshCounts]);

  // 閲覧中メッセージへのアクション（ツールバー）
  const actOnOpen = (op) => {
    const m = open.message;
    if (!m) {
      const rows = selectedRows();
      if (rows.length > 0) doAction(rows, op);
      return;
    }
    const row = list.rows.find(r => rowKey(r) === `${m.accountId}|${m.mailbox}|${m.uid}`)
      || { accountId: m.accountId, mailbox: m.mailbox, uid: m.uid, seen: true, flagged: m.flagged };
    const targets = selKeys.length > 1 ? selectedRows() : [row];
    doAction(targets, op);
    if (!['delete', 'archive', 'junk', 'move'].includes(op) && open.message) {
      // フラグ・未読トグルの表示反映
      if (op === 'flag' || op === 'unflag') setOpen(o => o.message ? { ...o, message: { ...o.message, flagged: op === 'flag' } } : o);
      if (op === 'unread') {
        setSelKeys([]);
        setOpen({ loading: false, message: null, error: null, imagesAllowed: false });
      }
    }
  };

  // ── 移動メニュー ──
  const openMoveMenu = (e, rows) => {
    if (rows.length === 0) return;
    const accountIds = [...new Set(rows.map(r => r.accountId))];
    if (accountIds.length > 1) {
      toast('複数アカウントのメールはまとめて移動できません', 'error');
      return;
    }
    const boxes = (mailboxes[accountIds[0]] || []).filter(b => b.path !== rows[0].mailbox);
    const rect = e.currentTarget?.getBoundingClientRect?.();
    setCtxMenu({
      x: rect ? rect.left : e.clientX,
      y: rect ? rect.bottom + 4 : e.clientY,
      items: [
        { header: true, label: '移動先を選択' },
        ...boxes.map(b => ({
          label: b.name === b.path ? b.path : b.name,
          icon: 'folder',
          onClick: () => doAction(rows, 'move', b.path),
        })),
      ],
    });
  };

  // ── コンテキストメニュー ──
  const handleRowContext = (e, row) => {
    e.preventDefault();
    const key = rowKey(row);
    let rows;
    if (selKeys.includes(key) && selKeys.length > 1) rows = selectedRows();
    else { setSelKeys([key]); rows = [row]; }
    const anyUnseen = rows.some(r => !r.seen);
    const anyUnflagged = rows.some(r => !r.flagged);
    const inJunk = rows.every(r => (mailboxes[r.accountId] || []).find(b => b.path === r.mailbox)?.specialUse === '\\Junk');
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        ...(rows.length === 1 ? [
          { label: '返信', icon: 'reply', onClick: () => startReply('reply', rows[0]) },
          { label: '転送', icon: 'forward', onClick: () => startReply('forward', rows[0]) },
          'sep',
        ] : []),
        { label: anyUnseen ? '開封済みにする' : '未開封にする', icon: anyUnseen ? 'mailOpen' : 'mail', onClick: () => doAction(rows, anyUnseen ? 'read' : 'unread') },
        { label: anyUnflagged ? 'フラグを付ける' : 'フラグを外す', icon: 'flag', onClick: () => doAction(rows, anyUnflagged ? 'flag' : 'unflag') },
        'sep',
        { label: 'アーカイブ', icon: 'archive', onClick: () => doAction(rows, 'archive') },
        inJunk
          ? { label: '迷惑メールではない', icon: 'inbox', onClick: () => doAction(rows, 'notjunk') }
          : { label: '迷惑メールに移動', icon: 'junk', onClick: () => doAction(rows, 'junk') },
        { label: 'フォルダへ移動…', icon: 'move', onClick: () => setTimeout(() => openMoveMenu(e, rows), 0) },
        'sep',
        { label: rows.length > 1 ? `${rows.length}件を削除` : '削除', icon: 'trash', danger: true, onClick: () => doAction(rows, 'delete') },
      ],
    });
  };

  // ── 作成・返信・転送 ──
  const realAccounts = accounts;
  const composeAccounts = realAccounts.length > 0 ? realAccounts : [];

  const startCompose = (prefill = {}) => {
    if (composeAccounts.length === 0) {
      setModal({ type: 'account', mode: 'add' });
      return;
    }
    const defaultId = settings.defaultAccountId && accountsById[settings.defaultAccountId]
      ? settings.defaultAccountId
      : (sel.kind === 'box' && accountsById[sel.accountId] ? sel.accountId : composeAccounts[0].id);
    setCompose({ fromId: defaultId, ...prefill });
  };

  const startReply = async (mode, rowOrNull) => {
    let m = open.message;
    const row = rowOrNull;
    if (row && (!m || rowKey(row) !== `${m.accountId}|${m.mailbox}|${m.uid}`)) {
      try {
        const r = await api.message(row.accountId, row.mailbox, row.uid);
        m = r.message;
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
    }
    if (!m) return;
    const self = accountsById[m.accountId]?.email;
    const fromId = accountsById[m.accountId] ? m.accountId : composeAccounts[0]?.id;
    const replyTarget = (m.replyTo?.length ? m.replyTo : [m.from]).filter(Boolean);
    if (mode === 'reply') {
      setCompose({
        fromId, title: `返信: ${m.subject || ''}`,
        to: replyTarget, subject: replySubject(m.subject),
        body: quoteBody(m), focusBody: true,
        inReplyTo: m.messageId, references: [...(m.references || []), m.messageId].filter(Boolean),
      });
    } else if (mode === 'replyAll') {
      const others = (m.to || []).filter(a => a.address !== self);
      const ccOthers = (m.cc || []).filter(a => a.address !== self);
      setCompose({
        fromId, title: `全員に返信: ${m.subject || ''}`,
        to: [...replyTarget, ...others], cc: ccOthers,
        subject: replySubject(m.subject),
        body: quoteBody(m), focusBody: true,
        inReplyTo: m.messageId, references: [...(m.references || []), m.messageId].filter(Boolean),
      });
    } else {
      setCompose({
        fromId, title: `転送: ${m.subject || ''}`,
        subject: forwardSubject(m.subject),
        body: forwardBody(m),
        forwardOf: m.attachments?.length ? { account: m.accountId, mailbox: m.mailbox, uid: m.uid } : undefined,
      });
    }
  };

  // ── キーボードショートカット ──
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
      if (compose || modal || ctxMenu) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault(); startCompose(); return;
      }
      if (typing) return;
      const rows = list.rows;
      const currentIdx = selKeys.length > 0 ? rows.findIndex(r => rowKey(r) === selKeys[selKeys.length - 1]) : -1;
      switch (e.key) {
        case 'ArrowDown': case 'j': {
          e.preventDefault();
          const next = rows[Math.min(rows.length - 1, currentIdx + 1)];
          if (next) { setSelKeys([rowKey(next)]); openMessage(next); scrollRowIntoView(next); }
          break;
        }
        case 'ArrowUp': case 'k': {
          e.preventDefault();
          const prev = rows[Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1)];
          if (prev) { setSelKeys([rowKey(prev)]); openMessage(prev); scrollRowIntoView(prev); }
          break;
        }
        case 'e': actOnOpen('archive'); break;
        case 'Backspace': case 'Delete': e.preventDefault(); actOnOpen('delete'); break;
        case 'f': { const r = selectedRows(); if (r.length) doAction(r, r.some(x => !x.flagged) ? 'flag' : 'unflag'); break; }
        case 'u': { const r = selectedRows(); if (r.length) doAction(r, r.some(x => !x.seen) ? 'read' : 'unread'); break; }
        case 'r': if (open.message) { e.preventDefault(); startReply('reply', null); } break;
        case 'c': e.preventDefault(); startCompose(); break;
        case '/': e.preventDefault(); searchRef.current?.focus(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const scrollRowIntoView = (row) => {
    requestAnimationFrame(() => {
      document.querySelector(`[data-rowkey="${CSS.escape(rowKey(row))}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  // ── ペイン幅ドラッグ ──
  const startDrag = (which) => (e) => {
    e.preventDefault();
    dragRef.current = { which, startX: e.clientX, start: paneW[which] };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = ev.clientX - d.startX;
      setPaneW(w => {
        const next = { ...w, [d.which]: Math.round(d.start + delta) };
        next.sidebar = Math.min(340, Math.max(180, next.sidebar));
        next.list = Math.min(560, Math.max(260, next.list));
        return next;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setPaneW(w => { try { localStorage.setItem('silvermail-panes', JSON.stringify(w)); } catch { /* noop */ } return w; });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── タイトル ──
  const viewTitle = useMemo(() => {
    if (sel.kind === 'unified') return { title: 'すべての受信', subtitle: `${accounts.length}アカウント` };
    if (sel.kind === 'flagged') return { title: 'フラグ付き', subtitle: '' };
    const a = accountsById[sel.accountId];
    const box = (mailboxes[sel.accountId] || []).find(b => b.path === sel.path);
    return { title: box?.name || sel.path, subtitle: a?.name || a?.email || '' };
  }, [sel, accounts.length, accountsById, mailboxes]);

  useEffect(() => {
    const unseen = Object.values(counts).reduce((s, c) => s + (c?.unseen || 0), 0);
    document.title = unseen > 0 ? `SilverMail（${unseen}）` : 'SilverMail';
  }, [counts]);

  // ── レンダリング ──
  if (boot.loading) {
    return <div className="center-fill" style={{ height: '100%' }}><Spinner /></div>;
  }
  if (boot.error) {
    return (
      <div className="error-screen">
        <Icon name="warn" size={40} style={{ color: 'var(--flag)' }} />
        <h2>SilverMailサーバーに接続できません</h2>
        <p>{boot.error}</p>
        <button className="btn primary" onClick={() => { setBoot({ loading: true, error: null }); bootstrap(); }}>再試行</button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <>
        <Onboarding
          onAddAccount={() => setModal({ type: 'account', mode: 'add' })}
          onDemoAdded={async () => { await bootstrap(); setSel({ kind: 'unified' }); }}
        />
        {modal?.type === 'account' && (
          <AccountModal
            mode="add" accountCount={0}
            onClose={() => setModal(null)}
            onSaved={async () => { setModal(null); await bootstrap(); }}
          />
        )}
      </>
    );
  }

  const showRail = sel.kind === 'unified' || sel.kind === 'flagged';
  const authErrors = list.errors?.filter(e => e.authFailed || e.error) || [];

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        mailboxes={mailboxes}
        counts={counts}
        sel={sel}
        collapsed={collapsed}
        onToggleCollapse={(id) => setCollapsed(c => {
          const next = { ...c, [id]: !c[id] };
          try { localStorage.setItem('silvermail-collapsed', JSON.stringify(next)); } catch { /* noop */ }
          return next;
        })}
        onSelect={(s) => { setSel(s); setSearch(''); setUnseenFilter(false); }}
        onCompose={() => startCompose()}
        onAddAccount={() => setModal({ type: 'account', mode: 'add' })}
        onSettings={() => setModal({ type: 'settings' })}
        onRefresh={manualRefresh}
        refreshing={refreshing}
        themeMode={settings.theme}
        onCycleTheme={() => {
          const order = ['auto', 'light', 'dark'];
          const next = order[(order.indexOf(settings.theme) + 1) % order.length];
          setSettings(s => ({ ...s, theme: next }));
          api.saveSettings({ theme: next }).catch(() => {});
        }}
      />
      <div className="resizer" onMouseDown={startDrag('sidebar')} />
      <MessageList
        title={viewTitle.title}
        subtitle={viewTitle.subtitle}
        rows={list.rows}
        total={list.total}
        loading={list.loading}
        loadingMore={list.loadingMore}
        error={list.error}
        authErrors={authErrors}
        previews={previews}
        selKeys={selKeys}
        showRail={showRail}
        accountsById={accountsById}
        search={search}
        onSearch={setSearch}
        unseenFilter={unseenFilter}
        onToggleUnseen={() => setUnseenFilter(v => !v)}
        onRowClick={handleRowClick}
        onRowContext={handleRowContext}
        onQuickAction={(row, op) => doAction([row], op)}
        onLoadMore={() => loadList({ more: true })}
        onOpenSettings={() => setModal({ type: 'settings' })}
        searchRef={searchRef}
      />
      <div className="resizer" onMouseDown={startDrag('list')} />
      <MessageView
        open={open}
        row={list.rows.find(r => selKeys.includes(rowKey(r))) || (open.message ? { accountId: open.message.accountId, mailbox: open.message.mailbox, uid: open.message.uid, seen: true, flagged: open.message.flagged } : null)}
        dark={isDark}
        onReply={(mode) => startReply(mode, null)}
        onAction={actOnOpen}
        onAllowImages={allowImages}
        onMoveMenu={(e) => {
          const m = open.message;
          const row = m && list.rows.find(r => rowKey(r) === `${m.accountId}|${m.mailbox}|${m.uid}`);
          openMoveMenu(e, row ? [row] : selectedRows());
        }}
        onFromClick={(from) => startCompose({ to: [from] })}
      />

      {ctxMenu && <ContextMenu {...ctxMenu} onClose={() => setCtxMenu(null)} />}

      {compose && (
        <Compose
          accounts={composeAccounts}
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => {
            const box = sel.kind === 'box' && (mailboxes[sel.accountId] || []).find(b => b.path === sel.path);
            if (box?.specialUse === '\\Sent' || box?.specialUse === '\\Drafts') loadList({ silent: true });
          }}
        />
      )}

      {modal?.type === 'account' && (
        <AccountModal
          mode={modal.mode}
          account={modal.account}
          accountCount={accounts.length}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await bootstrap(); }}
          onDeleted={async () => {
            setModal(null);
            const accts = await bootstrap();
            if (accts.length > 0) setSel({ kind: accts.length > 1 ? 'unified' : 'unified' });
          }}
        />
      )}

      {modal?.type === 'settings' && (
        <SettingsModal
          accounts={accounts}
          settings={settings}
          onChangeSettings={setSettings}
          onEditAccount={(a) => setModal({ type: 'account', mode: 'edit', account: a })}
          onAddAccount={() => setModal({ type: 'account', mode: 'add' })}
          onClose={() => setModal(null)}
          onAccountsChanged={bootstrap}
        />
      )}

      <style>{`
        .sidebar { width: ${paneW.sidebar}px; }
        .list-pane { width: ${paneW.list}px; }
      `}</style>
    </div>
  );
}
