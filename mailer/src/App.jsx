// SilverMail アプリ本体 — 状態管理と3ペインの統括
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from './api.js';
import { rowKey, displayFrom, replySubject, forwardSubject, quoteBody, forwardBody } from './util.js';
import { Icon } from './icons.jsx';
import { useToast, ContextMenu, Spinner, ConfirmDialog, PromptDialog } from './common.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { MessageList } from './components/MessageList.jsx';
import { MessageView } from './components/MessageView.jsx';
import { Compose } from './components/Compose.jsx';
import { AccountModal } from './components/AccountModal.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { Onboarding } from './components/Onboarding.jsx';
import { SidePanel } from './components/SidePanel.jsx';
import { CalendarView } from './components/CalendarView.jsx';
import { EventModal } from './components/EventModal.jsx';
import { TaskModal } from './components/TaskModal.jsx';
import { CalendarSourceModal } from './components/CalendarSourceModal.jsx';
import {
  startOfDay, addDays, startOfWeek, monthGrid, eventOnDay, fmtDayLabel,
} from './calendar-util.js';

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
  const [taskModal, setTaskModal] = useState(null);   // ToDoの詳細
  const [confirm, setConfirm] = useState(null);       // 取り返しのつかない操作の確認
  const [prompt, setPrompt] = useState(null);         // 名前の入力
  // 並び順。Googleに合わせて既定は「自分の順序」
  const [taskSort, setTaskSort] = useState(() => {
    try { return localStorage.getItem('silvermail-tasksort') === 'date' ? 'date' : 'manual'; }
    catch { return 'manual'; }
  });
  const [taskBusy, setTaskBusy] = useState(false);
  const [open, setOpen] = useState({ loading: false, message: null, error: null, imagesAllowed: false });
  const [refreshing, setRefreshing] = useState(false);

  // ── モーダル類 ──
  const [compose, setCompose] = useState(null);
  const [modal, setModal] = useState(null); // {type:'account',...} | {type:'settings'}
  const [ctxMenu, setCtxMenu] = useState(null);

  // ── カレンダー / ToDo ──
  const [view, setView] = useState('mail');            // 'mail' | 'calendar'
  const [calView, setCalView] = useState(() => loadJson('silvermail-calview', 'month'));
  const [calAnchor, setCalAnchor] = useState(() => new Date());
  const [calSources, setCalSources] = useState([]);
  const [calTargets, setCalTargets] = useState([]);
  const [redirectUri, setRedirectUri] = useState('');
  const [googleDraft, setGoogleDraft] = useState({ clientId: '', hasSecret: false });
  const [build, setBuild] = useState(null);   // 動いているサーバーの版
  const [events, setEvents] = useState({ items: [], loading: false, errors: [] });
  const [tasks, setTasks] = useState({ items: [], lists: [], loading: false, errors: [] });
  const [taskDest, setTaskDest] = useState(null);      // ToDoの保存先 {sourceId, listId}
  const [taskFilter, setTaskFilter] = useState('all'); // パネルの絞り込み
  const [panel, setPanel] = useState(() => loadJson('silvermail-panel', { open: true, tab: 'calendar' }));
  const [eventModal, setEventModal] = useState(null);  // {initial, hints, busy}
  const [sourceModal, setSourceModal] = useState(false);

  // ── ペイン幅 ──
  const [paneW, setPaneW] = useState(() => loadJson('silvermail-panes', { sidebar: 232, list: 368, panel: 316 }));
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
      setCalSources(r.calendarSources || []);
      setCalTargets(r.calendarTargets || []);
      setRedirectUri(r.calendarRedirectUri || '');
      if (r.googleDraft) setGoogleDraft(r.googleDraft);
      if (r.build) setBuild(r.build);
      if (r.settings.defaultTaskList) setTaskDest(r.settings.defaultTaskList);
      setPanel(p => ({ open: r.settings.panelOpen !== false, tab: r.settings.panelTab || p.tab }));
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

  // 取り消せる時間。短すぎると気付く前に消え、長すぎると画面に居座る
  const UNDO_MS = 8000;

  // 送信を押してから実際に送るまでの猶予。宛先違いや書き忘れは、押した直後に気付く
  const SEND_DELAY_MS = 5000;
  const pendingSend = useRef(null);

  // 移した先から、元の場所へ戻す。移動でUIDが変わるので、戻し先は必ずサーバーの返答を使う
  const undoAction = useCallback(async (results, groups) => {
    const byAccount = new Map([...groups.values()].map(g => [g.account, g]));
    try {
      for (const r of results) {
        if (!r.ok || !r.undo) continue;
        const g = byAccount.get(r.account);
        await api.action(
          [{ account: r.account, mailbox: r.undo.to, uids: r.undo.uids }],
          'move',
          r.undo.from || g?.mailbox,
        );
      }
      toast('元に戻しました', 'success', 2200);
    } catch (err) {
      toast(`元に戻せませんでした: ${err.message}`, 'error');
    }
    loadList({ silent: true });
    refreshCounts();
  }, [toast, loadList, refreshCounts]);

  // 送信済み・下書きを開いていたら、送ったあとに一覧を取り直す
  const afterSent = useCallback(() => {
    const box = sel.kind === 'box' && (mailboxes[sel.accountId] || []).find(b => b.path === sel.path);
    if (box?.specialUse === '\\Sent' || box?.specialUse === '\\Drafts') loadList({ silent: true });
  }, [sel, mailboxes, loadList]);

  // 送信を SEND_DELAY_MS だけ保留する。その間は「送信を取り消す」で書きかけに戻せる
  const deferSend = useCallback(({ fromId, message, restore }) => {
    const timer = setTimeout(async () => {
      pendingSend.current = null;
      try {
        const result = await api.send(fromId, message);
        toast(result.demo ? '送信しました（デモ: 送信済みに保存）' : '送信しました', 'success', 2600);
        afterSent();
      } catch (err) {
        // 送れなかった中身を失わせない。書きかけに戻せる形で知らせる
        toast(`送信できませんでした: ${err.message}`, 'error', 12000, {
          label: '書きかけに戻す',
          onClick: () => setCompose(restore),
        });
      }
    }, SEND_DELAY_MS);

    pendingSend.current = { timer, restore };
    toast('送信します', 'info', SEND_DELAY_MS, {
      label: '送信を取り消す',
      countdown: true,
      onClick: () => {
        clearTimeout(timer);
        pendingSend.current = null;
        setCompose(restore);
        toast('送信を取り消しました', 'info', 2400);
      },
    });
  }, [toast, afterSent]);

  // 猶予の途中で閉じられると、送ったつもりのメールが消える
  useEffect(() => {
    const warn = (e) => {
      if (!pendingSend.current) return undefined;
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

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
        // 押し間違いはすぐ気付く。気付いてから探し回らずに済むよう、その場で戻せるようにする。
        // 戻し先のUIDが分かるときだけ（サーバーがUIDPLUSに対応しているとき）出す
        const undos = res.results.map(r => r.undo).filter(Boolean);
        if (labels[op] && undos.length > 0) {
          toast(labels[op], 'success', UNDO_MS, {
            label: '元に戻す',
            onClick: () => undoAction(res.results, groups),
          });
        } else if (labels[op]) {
          toast(labels[op], 'success', 2200);
        }
      }
      if (removing || op === 'read' || op === 'unread') refreshCounts();
    } catch (err) {
      toast(err.message, 'error');
      loadList({ silent: true });
    }
  }, [open.message, toast, loadList, refreshCounts, undoAction]);

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

  // ── カレンダー: 取得する期間 ──
  // 画面の表示範囲に加えて、右パネルの「これから2週間」も必ず含める
  const calRange = useMemo(() => {
    const today = startOfDay(new Date());
    let from = addDays(today, -7);
    let to = addDays(today, 28);
    if (view === 'calendar') {
      if (calView === 'month') {
        const grid = monthGrid(calAnchor, settings.weekStart || 0);
        from = new Date(Math.min(from, addDays(grid[0], -1)));
        to = new Date(Math.max(to, addDays(grid[41], 2)));
      } else if (calView === 'week') {
        const ws = startOfWeek(calAnchor, settings.weekStart || 0);
        from = new Date(Math.min(from, addDays(ws, -1)));
        to = new Date(Math.max(to, addDays(ws, 9)));
      } else {
        to = new Date(Math.max(to, addDays(startOfDay(calAnchor), 64)));
      }
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }, [view, calView, calAnchor, settings.weekStart]);

  const loadEvents = useCallback(async (range) => {
    const r = range || calRange;
    setEvents(e => ({ ...e, loading: true }));
    try {
      const res = await api.events(r.from, r.to);
      setEvents({ items: res.events || [], loading: false, errors: res.errors || [] });
    } catch (err) {
      setEvents(e => ({ ...e, loading: false, errors: [{ sourceId: 'api', name: 'カレンダー', error: err.message }] }));
    }
  }, [calRange]);

  const loadTasks = useCallback(async () => {
    setTasks(t => ({ ...t, loading: true }));
    try {
      const res = await api.tasks(taskSort);
      setTasks({ items: res.tasks || [], lists: res.lists || [], loading: false, errors: res.errors || [] });
      // 保存先が未設定、または連携解除で消えたリストを指している場合は先頭へ戻す
      setTaskDest((cur) => {
        const lists = res.lists || [];
        if (cur && lists.some(l => l.sourceId === cur.sourceId && l.listId === cur.listId)) return cur;
        return lists[0] ? { sourceId: lists[0].sourceId, listId: lists[0].listId } : null;
      });
    } catch (err) {
      setTasks(t => ({ ...t, loading: false, errors: [{ sourceId: 'api', name: 'ToDo', error: err.message }] }));
    }
  }, [taskSort]);

  useEffect(() => { loadEvents(calRange); }, [calRange]); // eslint-disable-line
  useEffect(() => { loadTasks(); }, [loadTasks]);

  // 連携先が変わったら予定も取り直す
  const applySources = useCallback((next) => {
    if (Array.isArray(next)) setCalSources(next);
    api.calendarSources()
      .then(r => {
        setCalSources(r.sources); setCalTargets(r.targets); setRedirectUri(r.redirectUri);
        if (r.googleDraft) setGoogleDraft(r.googleDraft);
        if (r.build) setBuild(r.build);
      })
      .catch(() => {});
    loadEvents();
    loadTasks();
  }, [loadEvents, loadTasks]);

  const savePanel = (next) => {
    setPanel(next);
    try { localStorage.setItem('silvermail-panel', JSON.stringify(next)); } catch { /* noop */ }
    api.saveSettings({ panelOpen: next.open, panelTab: next.tab }).catch(() => {});
  };

  const togglePanel = (tab) => {
    savePanel(panel.open && panel.tab === tab ? { ...panel, open: false } : { open: true, tab });
  };

  // ── 予定の作成・編集 ──
  const openNewEvent = (at, opts = {}) => {
    const base = at ? new Date(at) : new Date();
    if (!opts.withTime && !(at instanceof Date && (base.getHours() || base.getMinutes()))) {
      base.setHours(10, 0, 0, 0);
    }
    const start = base.toISOString();
    setEventModal({
      initial: { start, end: new Date(base.getTime() + 3600000).toISOString(), allDay: false },
      hints: [],
    });
  };

  const openEvent = (ev) => {
    if (ev.editable === false) {
      toast(`${ev.calendarName} は購読しているカレンダーのため編集できません`, 'info');
      return;
    }
    setEventModal({ initial: { ...ev }, hints: [] });
  };

  const saveEvent = async ({ sourceId, calendarId, eventId, event }) => {
    setEventModal(m => ({ ...m, busy: true }));
    try {
      if (eventId) await api.updateEvent(sourceId, calendarId, eventId, event);
      else await api.createEvent(sourceId, calendarId, event);
      setEventModal(null);
      toast(eventId ? '予定を更新しました' : `${fmtDayLabel(event.start)} に予定を追加しました`, 'success');
      loadEvents();
      if (!panel.open) savePanel({ open: true, tab: 'calendar' });
    } catch (err) {
      setEventModal(m => ({ ...m, busy: false }));
      toast(err.message, 'error');
    }
  };

  const deleteEventNow = async () => {
    const init = eventModal?.initial;
    if (!init?.eventId) return;
    setEventModal(m => ({ ...m, busy: true }));
    try {
      await api.deleteEvent(init.sourceId, init.calendarId, init.eventId);
      setEventModal(null);
      toast('予定を削除しました', 'success');
      loadEvents();
    } catch (err) {
      setEventModal(m => ({ ...m, busy: false }));
      toast(err.message, 'error');
    }
  };

  // ── メール → 予定 / ToDo ──
  const mailRef = (m) => ({
    accountId: m.accountId, mailbox: m.mailbox, uid: m.uid,
    subject: m.subject || '',
    // ToDo側で「誰からの、いつのメールか」が開かずに分かるようにする
    from: m.from?.name ? `${m.from.name} <${m.from.address}>` : (m.from?.address || ''),
    date: m.date || null,
  });

  const mailNote = (m) => {
    const who = m.from?.name ? `${m.from.name} <${m.from.address}>` : (m.from?.address || '');
    const body = (m.text || '').trim().replace(/\n{3,}/g, '\n\n').slice(0, 600);
    return [`メール「${m.subject || '（件名なし）'}」より`, `差出人: ${who}`, '', body].join('\n');
  };

  const createEventFromMail = (m, hint) => {
    if (!m) return;
    const pick = hint || m.scheduleHints?.[0];
    const start = pick?.start || (() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d.toISOString(); })();
    const end = pick?.end || new Date(new Date(start).getTime() + 3600000).toISOString();
    setEventModal({
      initial: {
        title: (m.subject || '').replace(/^\s*(re|fwd?)\s*:\s*/i, '').trim() || '（件名なし）',
        start, end, allDay: Boolean(pick?.allDay),
        description: mailNote(m),
        attendees: m.from?.address ? [{ email: m.from.address, name: m.from.name || '' }] : [],
        sourceMail: mailRef(m),
      },
      hints: m.scheduleHints || [],
    });
  };

  const createTaskFromMail = async (m) => {
    if (!m) return;
    const hint = m.scheduleHints?.[0];
    try {
      await api.createTask(taskDest?.sourceId || null, taskDest?.listId || null, {
        title: (m.subject || '（件名なし）').replace(/^\s*(re|fwd?)\s*:\s*/i, '').trim(),
        notes: mailNote(m),
        due: hint?.start || null,
        sourceMail: mailRef(m),
      });
      toast(`${listLabel(taskDest)} に追加しました`, 'success');
      savePanel({ open: true, tab: 'tasks' });
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // ── ToDo 操作 ──
  const listLabel = (t) => tasks.lists.find(l => l.sourceId === t?.sourceId && l.listId === t?.listId)?.name || 'ToDo';

  const chooseTaskDest = (next) => {
    setTaskDest(next);
    api.saveSettings({ defaultTaskList: next }).catch(() => {});
  };

  const taskDestMenu = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setCtxMenu({
      x: Math.max(8, rect.right - 240), y: rect.bottom + 4,
      items: [
        { header: true, label: '新しいToDoの保存先' },
        ...tasks.lists.map(l => ({
          label: l.name,
          icon: (taskDest?.sourceId === l.sourceId && taskDest?.listId === l.listId) ? 'check' : (l.sourceType === 'google' ? 'google' : 'todo'),
          onClick: () => chooseTaskDest({ sourceId: l.sourceId, listId: l.listId }),
        })),
      ],
    });
  };

  const toggleTask = async (t) => {
    const next = !t.done;
    // 親を完了にしたら、その下も一緒に完了にする（Gmailのタスクと同じ）
    const kidIds = tasks.items
      .filter(x => x.parent === t.taskId && x.sourceId === t.sourceId && x.listId === t.listId)
      .map(x => x.id);
    const affected = new Set([t.id, ...kidIds]);
    setTasks(s => ({ ...s, items: s.items.map(x => (affected.has(x.id) ? { ...x, done: next } : x)) }));
    try {
      await api.setTaskDone(t.sourceId, t.listId, t.taskId, next);
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
      loadTasks();
    }
  };

  const addTask = async (title) => {
    try {
      await api.createTask(taskDest?.sourceId || null, taskDest?.listId || null, { title });
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const openMailRef = useCallback(async (ref) => {
    if (!ref?.accountId || !accountsById[ref.accountId]) {
      toast('元のメールのアカウントが見つかりません', 'error');
      return;
    }
    setView('mail');
    setSel({ kind: 'box', accountId: ref.accountId, path: ref.mailbox });
    setOpen({ loading: true, message: null, error: null, imagesAllowed: settings.remoteImages === 'allow' });
    try {
      const r = await api.message(ref.accountId, ref.mailbox, ref.uid);
      setOpen(o => ({ ...o, loading: false, message: r.message }));
      setSelKeys([`${ref.accountId}|${ref.mailbox}|${ref.uid}`]);
    } catch (err) {
      setOpen({ loading: false, message: null, error: err.message, imagesAllowed: false });
    }
  }, [accountsById, settings.remoteImages, toast]);

  // 押したら詳細を開く。中身を見て直せないと、ただの一覧で終わってしまう
  const openTask = (t) => setTaskModal({ task: t });

  const saveTask = async ({ title, notes, due, done, list }) => {
    const t = taskModal?.task;
    setTaskBusy(true);
    try {
      if (!t?.taskId) {
        await api.createTask(list?.sourceId || null, list?.listId || null, { title, notes, due, done });
      } else {
        await api.updateTask(t.sourceId, t.listId, t.taskId, { title, notes, due, done });
        // リストを変えたときは、保存のあとに付け替える
        if (list && (list.sourceId !== t.sourceId || list.listId !== t.listId)) {
          await api.moveTask(
            { sourceId: t.sourceId, listId: t.listId, taskId: t.taskId },
            { sourceId: list.sourceId, listId: list.listId },
          );
        }
      }
      setTaskModal(null);
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTaskBusy(false);
    }
  };

  // 開いているToDoの下に足す
  const addSubtask = async (title) => {
    const t = taskModal?.task;
    if (!t?.taskId) return;
    try {
      await api.createTask(t.sourceId, t.listId, { title, parent: t.taskId });
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // ToDoの削除は、どこから消しても同じように取り消せるようにする。
  // 子を持つ親を消すと子も道連れになるため、子も一緒に作り直す。
  const deleteTaskWithUndo = useCallback(async (t) => {
    if (!t?.taskId) return;
    const kids = tasks.items.filter(x =>
      x.parent === t.taskId && x.sourceId === t.sourceId && x.listId === t.listId);
    await api.deleteTask(t.sourceId, t.listId, t.taskId);
    loadTasks();
    toast(
      kids.length ? `ToDoとサブタスク${kids.length}件を削除しました` : 'ToDoを削除しました',
      'success', UNDO_MS,
      {
        label: '元に戻す',
        onClick: async () => {
          try {
            const back = await api.createTask(t.sourceId, t.listId, {
              title: t.title, notes: t.notes, due: t.due, done: t.done, sourceMail: t.sourceMail,
            });
            // 子は、作り直した親の下に戻す
            for (const k of kids) {
              await api.createTask(k.sourceId, k.listId, {
                title: k.title, notes: k.notes, due: k.due, done: k.done,
                sourceMail: k.sourceMail, parent: back.task.taskId,
              });
            }
            loadTasks();
          } catch (err) { toast(err.message, 'error'); }
        },
      },
    );
  }, [tasks.items, toast, loadTasks]);

  // リストの管理メニュー。Googleのリストだけが対象（このMacのToDoは1つきり）
  const taskListMenu = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const googleLists = tasks.lists.filter(l => l.sourceType === 'google');
    const googleSources = [...new Map(
      googleLists.map(l => [l.sourceId, l]),
    ).values()];

    setCtxMenu({
      x: Math.max(8, rect.right - 240), y: rect.bottom + 4,
      items: [
        ...googleSources.map(src => ({
          label: googleSources.length > 1 ? `リストを作る（${src.name.replace(/^[^（]*/, '').replace(/[（）]/g, '')}）` : 'リストを作る',
          icon: 'plus',
          onClick: () => setPrompt({
            title: 'リストを作る', label: 'リスト名', value: '', confirmLabel: '作る',
            onConfirm: (title) => { setPrompt(null); createTaskList(src.sourceId, title); },
          }),
        })),
        ...(googleLists.length ? ['sep'] : []),
        ...googleLists.map(l => ({
          label: `「${l.name}」の名前を変える`,
          icon: 'edit',
          onClick: () => setPrompt({
            title: 'リスト名を変える', label: 'リスト名', value: l.name.replace(/（[^（）]*）\s*$/, ''), confirmLabel: '変える',
            onConfirm: (title) => { setPrompt(null); renameTaskList(l, title); },
          }),
        })),
        ...(googleLists.length ? ['sep'] : []),
        ...googleLists.map(l => ({
          label: `「${l.name}」を削除`,
          icon: 'trash', danger: true,
          onClick: () => deleteTaskList(l),
        })),
        ...(googleLists.length === 0
          ? [{ label: 'Googleと連携すると、リストを作れます', icon: 'google', onClick: () => setSourceModal(true) }]
          : []),
      ],
    });
  };

  const changeTaskSort = (next) => {
    setTaskSort(next);
    try { localStorage.setItem('silvermail-tasksort', next); } catch { /* 保存できなくても動く */ }
  };

  // ドラッグで並べ替える。previousId の後ろへ動かす（先頭なら null）
  const reorderTask = async (moving, previousId) => {
    try {
      await api.reorderTask(moving.sourceId, moving.listId, moving.taskId, previousId);
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
      loadTasks();
    }
  };

  // 完了済みをまとめて片付ける。件数が分からないまま消すと不安なので、先に数えて尋ねる
  const clearCompleted = (list) => {
    const target = list || taskDest;
    if (!target) return;
    const count = tasks.items.filter(t =>
      t.done && t.sourceId === target.sourceId && t.listId === target.listId).length;
    if (count === 0) { toast('完了済みのToDoはありません', 'info', 2200); return; }
    const name = listLabel(target);
    setConfirm({
      title: '完了済みをまとめて削除しますか？',
      message: `${name} の完了済み ${count} 件を削除します。この操作は取り消せません。`,
      danger: true, confirmLabel: `${count}件を削除`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          const r = await api.clearCompleted(target.sourceId, target.listId);
          toast(`${r.removed} 件を削除しました`, 'success', 2600);
          loadTasks();
        } catch (err) { toast(err.message, 'error'); }
      },
    });
  };

  // ── リストそのものの管理 ──
  const createTaskList = async (sourceId, title) => {
    try {
      const r = await api.createTaskList(sourceId, title);
      toast(`「${title}」を作りました`, 'success', 2600);
      await loadTasks();
      setTaskDest({ sourceId: r.list.sourceId, listId: r.list.listId });
    } catch (err) { toast(err.message, 'error'); }
  };

  const renameTaskList = async (list, title) => {
    try {
      await api.renameTaskList(list.sourceId, list.listId, title);
      toast('リスト名を変えました', 'success', 2200);
      loadTasks();
    } catch (err) { toast(err.message, 'error'); }
  };

  const deleteTaskList = (list) => {
    const count = tasks.items.filter(t => t.sourceId === list.sourceId && t.listId === list.listId).length;
    setConfirm({
      title: 'リストを削除しますか？',
      message: count > 0
        ? `「${list.name}」と、その中の ${count} 件のToDoが消えます。この操作は取り消せません。`
        : `「${list.name}」を削除します。`,
      danger: true, confirmLabel: '削除',
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.deleteTaskList(list.sourceId, list.listId);
          toast('リストを削除しました', 'success', 2600);
          setTaskFilter('all');
          loadTasks();
        } catch (err) { toast(err.message, 'error'); }
      },
    });
  };

  const removeTask = async () => {
    const t = taskModal?.task;
    if (!t?.taskId) { setTaskModal(null); return; }
    setTaskBusy(true);
    try {
      setTaskModal(null);
      await deleteTaskWithUndo(t);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTaskBusy(false);
    }
  };

  // 親にできるのは、同じリストにあって・自分ではなく・それ自身が子でないToDo。
  // Google ToDo の入れ子は1段だけなので、孫を作らせない
  const subtaskParents = (t) => tasks.items.filter(x =>
    x.sourceId === t.sourceId && x.listId === t.listId
    && x.taskId !== t.taskId && !x.parent && !x.done);

  const taskMenu = (e, t) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setCtxMenu({
      x: rect.left - 150, y: rect.bottom + 4,
      items: [
        ...(t.sourceMail ? [{ label: '元のメールを開く', icon: 'mail', onClick: () => openMailRef(t.sourceMail) }] : []),
        { label: t.done ? '未完了に戻す' : '完了にする', icon: t.done ? 'circle' : 'checkCircle', onClick: () => toggleTask(t) },
        ...(t.parent
          ? [{ label: '一段上げる（親から外す）', icon: 'chevL', onClick: async () => {
            try { await api.setTaskParent(t.sourceId, t.listId, t.taskId, null); loadTasks(); }
            catch (err) { toast(err.message, 'error'); }
          } }]
          : subtaskParents(t).slice(0, 6).map(p => ({
            label: `「${p.title.slice(0, 14)}${p.title.length > 14 ? '…' : ''}」のサブタスクにする`,
            icon: 'list',
            onClick: async () => {
              try { await api.setTaskParent(t.sourceId, t.listId, t.taskId, p.taskId); loadTasks(); }
              catch (err) { toast(err.message, 'error'); }
            },
          }))),
        { label: '今日を期限にする', icon: 'today', onClick: async () => {
          try {
            await api.updateTask(t.sourceId, t.listId, t.taskId, { due: startOfDay(new Date()).toISOString() });
            loadTasks();
          } catch (err) { toast(err.message, 'error'); }
        } },
        ...tasks.lists
          .filter(l => !(l.sourceId === t.sourceId && l.listId === t.listId))
          .map(l => ({
            label: `${l.name} へ移動`,
            icon: l.sourceType === 'google' ? 'google' : 'todo',
            onClick: async () => {
              try {
                await api.moveTask(
                  { sourceId: t.sourceId, listId: t.listId, taskId: t.taskId },
                  { sourceId: l.sourceId, listId: l.listId },
                );
                toast(`${l.name} へ移動しました`, 'success');
                loadTasks();
              } catch (err) { toast(err.message, 'error'); }
            },
          })),
        { label: '予定にする', icon: 'calendarPlus', onClick: () => setEventModal({
          initial: {
            title: t.title,
            start: t.due || new Date().toISOString(),
            end: new Date(new Date(t.due || Date.now()).getTime() + 3600000).toISOString(),
            description: t.notes || '', sourceMail: t.sourceMail || undefined,
          },
          hints: [],
        }) },
        'sep',
        { label: '削除', icon: 'trash', danger: true, onClick: async () => {
          try { await deleteTaskWithUndo(t); }
          catch (err) { toast(err.message, 'error'); }
        } },
      ],
    });
  };

  // ── キーボードショートカット ──
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
      if (compose || modal || ctxMenu || eventModal || sourceModal) return;
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
        case 's': if (open.message) { e.preventDefault(); createEventFromMail(open.message); } break;
        case 't': if (open.message) { e.preventDefault(); createTaskFromMail(open.message); } break;
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
    dragRef.current = { which, startX: e.clientX, start: paneW[which] ?? 316 };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      // 右パネルは左端をつかむので、動かす向きが逆になる
      const delta = (ev.clientX - d.startX) * (d.which === 'panel' ? -1 : 1);
      setPaneW(w => {
        const next = { ...w, [d.which]: Math.round(d.start + delta) };
        next.sidebar = Math.min(340, Math.max(180, next.sidebar));
        next.list = Math.min(560, Math.max(260, next.list));
        next.panel = Math.min(460, Math.max(260, next.panel ?? 316));
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
        onSelect={(s) => { setView('mail'); setSel(s); setSearch(''); setUnseenFilter(false); }}
        view={view}
        onOpenCalendar={() => setView('calendar')}
        onOpenTasks={() => savePanel({ open: true, tab: 'tasks' })}
        todayEvents={events.items.filter(ev => eventOnDay(ev, new Date())).length}
        openTasks={tasks.items.filter(t => !t.done).length}
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
      {view === 'calendar' ? (
        <CalendarView
          events={events.items}
          loading={events.loading}
          errors={events.errors}
          sources={calSources}
          anchor={calAnchor}
          view={calView}
          weekStart={settings.weekStart || 0}
          onAnchor={setCalAnchor}
          onView={(v) => {
            setCalView(v);
            try { localStorage.setItem('silvermail-calview', JSON.stringify(v)); } catch { /* noop */ }
          }}
          onNew={openNewEvent}
          onOpen={openEvent}
          onRefresh={() => loadEvents()}
          onManageSources={() => setSourceModal(true)}
          onToggleSource={async (id, enabled) => {
            try { applySources((await api.updateSource(id, { enabled })).sources); }
            catch (err) { toast(err.message, 'error'); }
          }}
        />
      ) : (
      <>
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
        onCreateEvent={createEventFromMail}
        onCreateTask={createTaskFromMail}
      />
      </>
      )}

      {panel.open && <div className="resizer" onMouseDown={startDrag('panel')} />}
      <SidePanel
        open={panel.open}
        tab={panel.tab}
        width={paneW.panel ?? 316}
        onToggle={togglePanel}
        events={events.items}
        eventsLoading={events.loading}
        eventErrors={events.errors}
        tasks={tasks.items}
        tasksLoading={tasks.loading}
        taskErrors={tasks.errors}
        hasSources={calSources.some(s => s.type !== 'local') || events.items.length > 0}
        onNewEvent={openNewEvent}
        onOpenEvent={openEvent}
        onOpenCalendar={() => setView('calendar')}
        onManageSources={() => setSourceModal(true)}
        onToggleTask={toggleTask}
        onAddTask={addTask}
        onOpenTask={openTask}
        onOpenTaskMail={openMailRef}
        taskSort={taskSort}
        onTaskSort={changeTaskSort}
        onReorderTask={reorderTask}
        onClearCompleted={() => clearCompleted(taskFilter === 'all' ? taskDest : {
          sourceId: taskFilter.split('|')[0], listId: taskFilter.split('|')[1],
        })}
        onTaskListMenu={taskListMenu}
        onTaskMenu={taskMenu}
        taskLists={tasks.lists}
        taskDest={taskDest}
        taskFilter={taskFilter}
        onTaskFilter={setTaskFilter}
        onTaskDestMenu={taskDestMenu}
        onRefresh={() => { loadEvents(); loadTasks(); }}
      />

      {ctxMenu && <ContextMenu {...ctxMenu} onClose={() => setCtxMenu(null)} />}

      {compose && (
        <Compose
          accounts={composeAccounts}
          initial={compose}
          onClose={() => setCompose(null)}
          onDeferredSend={deferSend}
          onSent={afterSent}
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

      {eventModal && (
        <EventModal
          initial={eventModal.initial}
          hints={eventModal.hints}
          targets={calTargets}
          busy={eventModal.busy}
          onSave={saveEvent}
          onDelete={deleteEventNow}
          onClose={() => setEventModal(null)}
          onOpenMail={(ref) => { setEventModal(null); openMailRef(ref); }}
        />
      )}

      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          value={prompt.value}
          confirmLabel={prompt.confirmLabel}
          onConfirm={prompt.onConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {taskModal && (
        <TaskModal
          task={taskModal.task}
          lists={tasks.lists}
          subtasks={tasks.items
            .filter(x => x.parent === taskModal.task?.taskId
              && x.sourceId === taskModal.task?.sourceId
              && x.listId === taskModal.task?.listId)
            .sort((a, b) => String(a.position).localeCompare(String(b.position)))}
          busy={taskBusy}
          onSave={saveTask}
          onDelete={removeTask}
          onClose={() => setTaskModal(null)}
          onOpenMail={(ref) => { setTaskModal(null); openMailRef(ref); }}
          onAddSubtask={addSubtask}
          onToggleSubtask={toggleTask}
          onOpenSubtask={(st) => setTaskModal({ task: st })}
        />
      )}

      {sourceModal && (
        <CalendarSourceModal
          sources={calSources}
          redirectUri={redirectUri}
          googleDraft={googleDraft}
          build={build}
          toast={toast}
          onChanged={applySources}
          onClose={() => setSourceModal(false)}
        />
      )}

      <style>{`
        .sidebar { width: ${paneW.sidebar}px; }
        .list-pane { width: ${paneW.list}px; }
      `}</style>
    </div>
  );
}
