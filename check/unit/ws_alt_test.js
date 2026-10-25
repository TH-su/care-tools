/* ワークスケジュールの「控えの案」（作成・切替・本番にする・未送信の控え・2つのタブ）を、架空データだけで確かめる（2026-10-25 新設・本人指示）。
   元: 非公開の正本の試験 tests/alt-absent.test.js（案の部分）と tests/alt-pending.test.js の写し。休みにする（absent）の試験は入れていない。
   対象（公開中の work-schedule.html の本物の関数）:
     部品 WSModel・WSStore  … 即時関数をそのまま切り出して vm で動かす（ws_swap_test.js と同じ作法）
     app.js の関数           … 「src/ui/app.js」の区間から名前で切り出し（extractFn）、最小の偽物（ui・localStorage・サーバー・画面）と一緒に vm で動かす
   ★必ず確かめること: 案を本番にした時、元の本番にあった実施の印・チェック・札のコメントが、本番にした後の盤面の同じ札に残る。
   読む画面は環境変数 WS_HTML で差し替えられる（わざと壊した版で落ちるかを見る時）:
     WS_HTML=<壊した版>/work-schedule.html node check/unit/ws_alt_test.js
   職員・利用者は記号的な架空の名前（見本甲・利用者c1 など）、日付は 2099-01-01。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.WS_HTML || path.join(ROOT, 'work-schedule.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const clone = (o) => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const flush = () => new Promise((r) => setImmediate(r));
async function settle(cond, n) { for (let i = 0; i < (n || 50); i++) { if (cond()) return true; await flush(); } return !!cond(); }

/* ══ 砂場1: 部品（WSTime・WSModel・WSStore）をそのまま動かす ══ */
const EXPORT_LINE = "  if (typeof module !== 'undefined' && module.exports) module.exports = api;";
function moduleSrc(marker) {
  const m = SRC.indexOf(marker);
  if (m < 0) throw new Error('部品が見つかりません: ' + marker);
  const start = SRC.lastIndexOf("(function () {\n  'use strict';", m);
  const end = SRC.indexOf('})();', m) + 5;
  if (start < 0 || end < 5) throw new Error('部品の切れ目が見つかりません: ' + marker);
  return SRC.slice(start, end);
}
const box = { console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN, isFinite, Infinity };
box.window = box;
vm.createContext(box);
vm.runInContext(moduleSrc('window.WSTime = api;'), box);
vm.runInContext(moduleSrc('window.WSModel = api;'), box);
vm.runInContext(moduleSrc('window.WSStore = api;'), box);
const M = box.WSModel, S = box.WSStore;

/* ══ 砂場2: app.js の区間から関数・変数を名前で切り出す ══ */
const APP_AT = SRC.indexOf('/* ===== src/ui/app.js ===== */');
if (APP_AT < 0) throw new Error('app.js の区間が見つかりません');
const APP = SRC.slice(APP_AT);
function extractFn(src, name) {
  const head = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (!head) throw new Error(name + ' が app.js の区間に見つかりません');
  let i = src.indexOf('{', head.index), depth = 0, inS = null, inLine = false, inBlock = false, prev = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (inLine) { if (c === '\n') inLine = false; prev = c; continue; }
    if (inBlock) { if (prev === '*' && c === '/') inBlock = false; prev = c; continue; }
    if (inS) { if (c === '\\') { i++; prev = ''; continue; } if (c === inS) inS = null; prev = c; continue; }
    if (c === '/' && src[i + 1] === '/') { inLine = true; i++; prev = ''; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlock = true; i++; prev = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; prev = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(head.index, i + 1); }
    prev = c;
  }
  throw new Error(name + ' の終端を特定できません');
}
const lineOf = (re) => { const m = re.exec(APP); if (!m) throw new Error(re + ' が見つかりません'); return m[0]; };
/* 案の変数（本物の宣言をそのまま使う＝上限の数・端末の控えのキーを書き写さない） */
const ALT_VARS = [/var ALT_MAX = [^;]+;/, /var ALT_PENDING_LS = [^;]+;/, /var altStates_ = [^;]+;/, /var altPushTimer_ = [^;]+;/,
  /var altPendMem_ = [^;]+;/, /var ALT_NO_LS_MSG = [^;]+;/].map(lineOf).join('\n');
const ALT_FNS = ['shownDay_', 'altKey_', 'altIdOk_', 'altNorm_', 'altList_', 'findAlt_', 'loadAlts_', 'altWrite_', 'altSnapshot_',
  'altPendKey_', 'altPendLs_', 'altPendAll_', 'altPendWrite_', 'altPendSave_', 'altPendHas_', 'altPendDel_', 'altPendNextKey_',
  'altSaveLocal_', 'altPushNow_', 'altPushRetry_', 'leaveAltCore_', 'altBoardFor_', 'enterAlt_', 'newAltId_', 'createAlt_',
  'carryMarks_', 'promoteAlt_', 'daySig'];

/* 架空のサーバー（案のキー wsalt_<日付> の kv_get / kv_put。版が違えば conflict）。beforePut で「ほかの PC の書き込み」を差し込める */
function fakeServer(init) {
  const sv = Object.assign({ rev: 0, data: null, puts: 0, keys: [], log: [] }, init || {});
  sv.rpc = async (name, args) => {
    sv.keys.push(args.p_key);
    if (name === 'kv_get') return { ok: true, rev: sv.rev, data: clone(sv.data) };
    if (name === 'kv_put') {
      if (sv.beforePut) { const f = sv.beforePut; sv.beforePut = null; f(); }
      if (args.p_rev !== sv.rev) return { ok: false, conflict: true, rev: sv.rev };
      sv.rev++; sv.data = clone(args.p_data); sv.puts++; sv.log.push('put');
      return { ok: true, rev: sv.rev };
    }
    throw new Error('未知の呼び出し ' + name);
  };
  return sv;
}

/* 画面の中を最小の偽物で作り、本物の関数を入れる。opt で偽物を差し替える */
function makeEnv(opt) {
  opt = opt || {};
  const ls = opt.lsRef || Object.assign({}, opt.ls || {});
  const timers = [], toasts = [], calls = [];
  const sv = opt.server || fakeServer();
  const ctx = {
    console, JSON, Object, String, Number, Array, Math, Date, Promise, RegExp, Error,
    M,
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => { if (ctx.full) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; },
    },
    full: !!opt.full,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    saveText: '',
    newName: { value: '入力中' },
    $: (id) => {
      if (id === 'altNewName') return ctx.newName;
      return { set textContent(v) { if (id === 'saveState') ctx.saveText = v; }, get textContent() { return ctx.saveText; } };
    },
    document: { body: { classList: { add: () => {}, remove: () => {} } } },
    location: { hash: '' },
    window: { confirm: () => (opt.confirm !== undefined ? opt.confirm : true) },
    ui: { currentDate: '2099-01-01', altId: opt.altId === undefined ? null : opt.altId, selectedIds: [] },
    store: S.createStore(opt.day || emptyBoard()),
    pad2: (n) => ('0' + n).slice(-2),
    toast: (m) => { toasts.push(String(m)); },
    altRpc_: (n, a) => sv.rpc(n, a),
    saveTimer: null, pushDayTimer: null, hashNavigating_: false, dayPullOk_: {},
    doSave: () => { calls.push('doSave:' + (ctx.ui.altId || '本番')); },
    pushDayNow: () => { calls.push('pushDayNow:' + (ctx.ui.altId || '本番')); },
    switchDate: (d) => { calls.push('switchDate:' + d); },
    leaveAlt_: () => { calls.push('leaveAlt_'); },
    renderAll: () => {}, renderAltModal_: () => {}, hideModals: () => {},
    loadDayData: () => null, dayLocked_: () => false,
    /* 本番の最新を取り直す（偽物）: サーバーの本番の盤面を INIT_DAY で盤面に入れ、取れた印を付ける */
    pullDayNow: (date, a, b, cb) => {
      calls.push('pullDayNow');
      if (opt.prod) { ctx.store.dispatch({ type: 'INIT_DAY', day: clone(opt.prod) }); ctx.dayPullOk_[date] = true; }
      cb();
    },
  };
  Object.assign(ctx, opt.over || {});
  vm.createContext(ctx);
  vm.runInContext(ALT_VARS + '\nvar altBusy_ = false, altEditSeq_ = 0, altLastSig_ = \'\', altLeaving_ = false;\n' +
    'var altPendGone_ = {}, altPendLsFail_ = false, altTryAt_ = {};\n' +
    ALT_FNS.map((n) => extractFn(APP, n)).join('\n') +
    '\nthis.__f = {' + ALT_FNS.join(',') + '};' +
    '\nthis.__v = function () { return { ALT_MAX: ALT_MAX, ALT_PENDING_LS: ALT_PENDING_LS, altPendMem_: altPendMem_, altLastSig_: altLastSig_ }; };', ctx);
  const runTimers = async () => { for (let n = 0; n < 20; n++) { const i = timers.findIndex((x) => x.ms < 20000); if (i < 0) break; const x = timers.splice(i, 1)[0]; x.fn(); await flush(); await flush(); } };
  return { ctx, f: ctx.__f, v: ctx.__v, ls, timers, toasts, calls, sv, runTimers };
}

/* 架空の盤面 */
const STAFF = [
  { id: 's1', name: '見本甲', zone: 'visit', col: 0, workStart: 480, workEnd: 1080 },
  { id: 's2', name: '見本乙', zone: 'visit', col: 1, workStart: 480, workEnd: 1080 },
  { id: 's3', name: '見本丙', zone: 'visit', col: 2, workStart: 480, workEnd: 1080 },
];
const COLS = STAFF.map((s) => ({ col: s.col, zone: s.zone, staffIds: [s.id] }));
/* 札は本物の newTask で作る（コメントは {text,…}・チェックは内容の番号ごと {番号:true} の形に整う） */
const care = (id, start, end, staffId, extra) => M.newTask(Object.assign({ id, kind: 'care', residentId: 'r_' + id, residentName: '利用者' + id, svcCode: '身体０１', contents: ['見本の内容1', '見本の内容2'], start, end, staffId }, extra || {}));
const cm = (text) => ({ text });
const ctext = (t) => (t && t.comment ? t.comment.text : null);
function emptyBoard(meta) { return { meta: Object.assign({ date: '2099-01-01', rev: 3 }, meta || {}), staff: clone(STAFF), columns: clone(COLS), tasks: [] }; }
function board(tasks, meta) { const b = emptyBoard(meta); b.tasks = tasks; return b; }
const altObj = (id, name, tasks, meta) => ({ id, name, board: { meta: meta || {}, staff: clone(STAFF), columns: clone(COLS), tasks: tasks || [] } });

(async () => {
  /* ═══════════════ 0. 砂場 ═══════════════ */
  console.log('\n— 0. 砂場 —');
  {
    const E = makeEnv();
    t('本物の関数を ' + ALT_FNS.length + ' 本取り出せる', ALT_FNS.every((n) => typeof E.f[n] === 'function'));
    t('部品（WSModel・WSStore）を本物のまま取り出せる', typeof M.newTask === 'function' && typeof S.createStore === 'function' && typeof M.absentNameKey === 'function');
  }

  /* ═══════════════ 1. 作成 ═══════════════ */
  console.log('\n— 1. 作成（1日に5つまで・本番とは別のキー wsalt_<日付>）—');
  {
    const E = makeEnv();
    t('案の数の上限は 5（ALT_MAX）', E.v().ALT_MAX === 5, E.v().ALT_MAX);
    t('案の保存先は wsalt_<日付>（本番 wsday_ とは別のキー）', E.f.altKey_('2099-01-01') === 'wsalt_2099-01-01');
    t('案の id は英小文字・数字 4〜16 字だけ', E.f.altIdOk_('abcd1234') && !E.f.altIdOk_('ABCD') && !E.f.altIdOk_('ab') && !E.f.altIdOk_(12345));
    const n = E.f.altNorm_('2099-01-01', { alts: [altObj('aaaa1111', '案A'), { id: 'BAD!', board: {} }, { id: 'nobd1234' }, null] });
    t('読み込んだ案は、形の正しい id と盤面のあるものだけ残す', same(n.alts.map((a) => a.id), ['aaaa1111']) && n.v === 1 && n.date === '2099-01-01', n.alts.map((a) => a.id));
    const b = E.f.altSnapshot_({ meta: { date: 'x', rev: 9, locked: true, lockedAt: 'T', appVer: 1, updatedAt: 'U', notes: [{ id: 'n' }] }, staff: [], columns: [], tasks: [] });
    t('案の写しは 版・ロック・版の印・保存時刻を持たない（本番の守りや版と混ざらない）', same(b.meta, { date: 'x', notes: [{ id: 'n' }] }), b.meta);
  }
  {
    const sv = fakeServer({ rev: 2, data: { alts: [1, 2, 3, 4].map((k) => altObj('alt0000' + k, '案' + k)) } });
    const E = makeEnv({ server: sv, day: board([care('c1', 600, 630, 's1')], { locked: true, lockedAt: 'T' }) });
    E.ctx.enterAlt_ = (id) => { E.calls.push('enterAlt_:' + id); return true; };   /* 開く処理は「切替」で別に試す */
    vm.runInContext('enterAlt_ = this.enterAlt_;', E.ctx);
    E.f.createAlt_('見本の案');
    await settle(() => E.toasts.length);
    const made = sv.data.alts[4];
    t('4つある日に5つ目を作れる（今の盤面の写し・ロックと版は持たない）', sv.data.alts.length === 5 && made && made.name === '見本の案' &&
      same(made.board.tasks.map((x) => x.id), ['c1']) && !('locked' in made.board.meta) && !('rev' in made.board.meta), made && made.board.meta);
    t('作った案の id は形の決まりどおり・作った後はその案を開く', made && E.f.altIdOk_(made.id) && E.calls.includes('enterAlt_:' + made.id), E.calls);
    t('保存したのは wsalt_2099-01-01 だけ（本番のキーへは書かない）', sv.keys.every((k) => k === 'wsalt_2099-01-01'), sv.keys);
    const puts0 = sv.puts; E.toasts.length = 0;
    E.f.createAlt_('6つ目');
    await settle(() => E.toasts.length);
    t('5つある日は作らない（サーバーへ書かず「5つまで」と出す）', sv.puts === puts0 && sv.data.alts.length === 5 && /5つまで/.test(E.toasts[0] || ''), E.toasts);
    E.toasts.length = 0;
    const puts1 = sv.puts;
    E.f.createAlt_('   ');
    t('名前が空なら作らない', sv.puts === puts1 && /名前/.test(E.toasts[0] || ''), E.toasts);
  }
  {
    const sv = fakeServer({ rev: 4, data: { v: 1, date: '2099-01-01', alts: [altObj('aaaa1111', '案A'), altObj('bbbb2222', '案B')] } });
    const E = makeEnv({ server: sv });
    await E.f.loadAlts_('2099-01-01');
    sv.beforePut = () => { sv.rev = 5; sv.data.alts.push(altObj('cccc3333', 'ほかのPCの案C')); };
    const j = await E.f.altWrite_('2099-01-01', (d) => { d.alts.find((a) => a.id === 'aaaa1111').name = '案A2'; return true; });
    t('案の保存は 読んで・変えて・書く。版の競合は取り直してほかの案を残したまま書き直す（案ごとの後勝ち）',
      j.ok && same(sv.data.alts.map((a) => a.id + ':' + a.name), ['aaaa1111:案A2', 'bbbb2222:案B', 'cccc3333:ほかのPCの案C']), sv.data.alts.map((a) => a.name));
    const p0 = sv.puts;
    const j2 = await E.f.altWrite_('2099-01-01', (d) => !!d.alts.find((a) => a.id === 'gone0000'));
    t('消された案へは書かない（mutate が false＝書かない・aborted）', j2.aborted === true && sv.puts === p0, j2);
  }

  /* ═══════════════ 2. 切替 ═══════════════ */
  console.log('\n— 2. 切替（案を開く・本番へ戻る・「表示中の日」の判定）—');
  {
    const E = makeEnv();
    E.ctx.ui.altId = null;
    const a = E.f.shownDay_('2099-01-01');
    E.ctx.ui.altId = 'aaaa1111';
    const b = E.f.shownDay_('2099-01-01');
    E.ctx.ui.altId = null;
    const c = E.f.shownDay_('2099-01-02');
    t('「表示中の日」は 本番を表示中の同じ日だけ真（案を表示中は偽＝ui.currentDate === 日付 && !ui.altId）', a === true && b === false && c === false, [a, b, c]);
  }
  {
    const isCur = 'var isCur = (ui.currentDate === date && !ui.altId);';
    t('サーバーの本番を受け取る所（adoptServerDay_）も 案を表示中は「表示していない日」として受け取る', extractFn(APP, 'adoptServerDay_').indexOf(isCur) > 0);
    /* app.js の区間全体で「表示中の日」を見る所を数える。!ui.altId を見ずに本番を表示中とみなす行が無いこと（許す行は正本の試験と同じ） */
    const allow = [/lockedShiftChg_\.date === ui\.currentDate/, /weeklyChg_\.date === ui\.currentDate/, /R\.next\.date === ui\.currentDate/,
      /sending: \(dayPushBusy_ && date === ui\.currentDate\)/, /function shownDay_\(date\)/,
      /ui\.altId === e\.id && ui\.currentDate === e\.date/,
      /listSavedDates\(\)\.filter\(function \(d\) \{ return d !== ui\.currentDate; \}\)/, /if \(d && d !== ui\.currentDate\) \{ try \{ switchDate\(d\)/,
      /if \(date !== ui\.currentDate \|\| ui\.altId\) return;/];
    const bad = [];
    APP.split('\n').forEach((l, i) => {
      if (!/ui\.currentDate ===|=== ui\.currentDate|!== ui\.currentDate/.test(l)) return;
      if (/&& !ui\.altId/.test(l)) return;
      if (allow.some((re) => re.test(l))) return;
      bad.push('app.js区間 ' + (i + 1) + '行: ' + l.trim().slice(0, 100));
    });
    t('同期で「表示中の日」を見る所はすべて 案を表示中かも見る（app.js 区間の全行）', bad.length === 0, bad);
  }
  {
    t('案を表示中: 保存は案へ（doSave → altSaveLocal_）', extractFn(APP, 'doSave').indexOf("if (typeof ui !== 'undefined' && ui.altId) { altSaveLocal_(); return; }") > 0);
    t('案を表示中: 本番の送信は止める（schedulePushDay・pushDayNow）',
      /function schedulePushDay\(\) \{\n\s+if \(typeof ui !== 'undefined' && ui\.altId\) return;/.test(APP) && /function pushDayNow\(report\) \{\n\s+if \(typeof ui !== 'undefined' && ui\.altId\) return;/.test(APP));
    t('案を表示中: 自動の組み直し・支援マスタからの自動の敷き込みは止める（手で押した反映は通す）',
      /function autoHeld_\(\) \{\n\s+if \(typeof ui !== 'undefined' && ui\.altId && manualDepth_ === 0\) return true;/.test(APP) && /function seedFromMaster\(\) \{\n\s+if \(typeof ui !== 'undefined' && ui\.altId\) return;/.test(APP));
    t('日付を移る前に案を抜ける（switchDate の最初で leaveAltCore_）', /function switchDate\(date\) \{\n\s+if \(typeof ui !== 'undefined' && ui\.altId\) leaveAltCore_\(\);/.test(APP));
  }
  {
    const sv = fakeServer({ rev: 1, data: { alts: [altObj('aaaa1111', '案A', [care('c9', 660, 690, 's2')], { date: '2099-01-01', notes: [] })] } });
    const E = makeEnv({ server: sv, day: board([care('c1', 600, 630, 's1')], { locked: true, lockedAt: 'T', rev: 7 }) });
    await E.f.loadAlts_('2099-01-01');
    E.ctx.saveTimer = 1; E.ctx.pushDayTimer = 1;
    vm.runInContext('saveTimer = this.saveTimer; pushDayTimer = this.pushDayTimer;', E.ctx);
    const ok = E.f.enterAlt_('aaaa1111');
    const d = E.ctx.store.get();
    t('案を開く前に 本番の保存と送信を確定する（本番のまま doSave・pushDayNow を呼んでから ui.altId を変える）',
      ok === true && same(E.calls.slice(0, 2), ['doSave:本番', 'pushDayNow:本番']) && E.ctx.ui.altId === 'aaaa1111', E.calls);
    t('案を開くと盤面は案の中身・版 0・ロックの印を持たない（凍結しない）',
      same(d.tasks.map((x) => x.id), ['c9']) && d.meta.rev === 0 && !d.meta.locked && !d.meta.lockedAt && d.meta.date === '2099-01-01', d.meta);
    t('案を開くと URL は #日付~alt-<id>（再読み込みで同じ案へ戻る）', E.ctx.location.hash === '#2099-01-01~alt-aaaa1111', E.ctx.location.hash);
    t('無い案は開かない（ui.altId を変えない）', E.f.enterAlt_('zzzz9999') === false && E.ctx.ui.altId === 'aaaa1111');
    E.calls.length = 0;
    vm.runInContext('saveTimer = 1;', E.ctx);
    E.f.leaveAltCore_();
    t('案を抜ける時は 案の保存を確定してから（案を表示中のまま doSave）本番へ戻す', E.calls[0] === 'doSave:aaaa1111' && E.ctx.ui.altId === null, E.calls);
  }
  {
    const sv = fakeServer({ rev: 1, data: { alts: [altObj('aaaa1111', '案A', [care('c9', 660, 690, 's2')])] } });
    const pend = { '2099-01-01|aaaa1111': { date: '2099-01-01', id: 'aaaa1111', seq: 1, at: '2099-01-01T00:00:00.000Z', board: { meta: {}, staff: clone(STAFF), columns: clone(COLS), tasks: [care('c8', 700, 730, 's3')] } } };
    const E = makeEnv({ server: sv, ls: { ws_alt_pending_v2: JSON.stringify(pend) } });
    await E.f.loadAlts_('2099-01-01');
    E.f.enterAlt_('aaaa1111');
    t('送れていない控えがある案は 控えの盤面（新しい方）から開き、送る段取りをする',
      same(E.ctx.store.get().tasks.map((x) => x.id), ['c8']) && E.timers.some((x) => x.ms === 500) && E.toasts.some((m) => /送れていなかった/.test(m)), E.ctx.store.get().tasks.map((x) => x.id));
  }

  {
    /* 正本の試験（alt-absent）の 案の画面まわりの確かめを写す（文字列で確かめる所は正本と同じ文） */
    const parse = new Function(extractFn(APP, 'parseDateHash_') + '\nreturn parseDateHash_;')();
    const altH = new Function(extractFn(APP, 'parseAltHash_') + '\nreturn parseAltHash_;')();
    t('URL: #日付~alt-<id> は日付としても読め、案の id を取り出せる（形の違う印は日付ごと読まない）',
      parse('#2099-01-02~alt-abcd1234') === '2099-01-02' && parse('#2099-01-02') === '2099-01-02' && parse('#2099-01-02~alt-ABCD') === null &&
      altH('#2099-01-02~alt-abcd1234') === 'abcd1234' && altH('#2099-01-02') === null);
    t('再読み込みで見ていた案へ戻る（restoreAltFromHash_ を待って呼ぶ・現場の端末では戻さない）',
      APP.indexOf('setTimeout(function () { try { restoreAltFromHash_(); } catch (eRa) {} }, 1500);') > 0 &&
      extractFn(APP, 'restoreAltFromHash_').indexOf('if (tries < 20 && !wsIsFieldDevice_()) { setTimeout(function () { restoreAltFromHash_(tries + 1); }, 1000); return; }') > 0);
    const av = extractFn(APP, 'altAvailable_'), pb = extractFn(APP, 'paintAltBadge_');
    t('案の印刷は見出しに「（案：名前）」。現場の端末では案を出さない。案ではロックの欄を隠す',
      APP.indexOf("if (ui.altId) { var pa_ = findAlt_(ui.altId); headName += '（案：' + (pa_ ? pa_.name : '') + '）'; }") > 0 &&
      av.indexOf('if (wsIsFieldDevice_()) return false;') > 0 && av.indexOf('fieldMarksOnly_(ui.currentDate)') > 0 &&
      pb.indexOf('if (btn) btn.hidden = !altAvailable_();') > 0 && pb.indexOf('if (lk) lk.hidden = !!ui.altId;') > 0);
    t('案を表示中は ロックしない・翌週へコピーしない',
      APP.indexOf("if (ui.altId) { $('chkLock').checked = false; toast('案ではロックを使いません") > 0 &&
      extractFn(APP, 'copyCareToNextWeek').indexOf("if (ui.altId) { toast('案を表示中は翌週へコピーできません") > 0);
    const pn = extractFn(APP, 'pushDayNow');
    t('案を表示中に本番を送る時は 端末の本番の控えから送る（盤面＝案を本番として送らない）・確かめの版も本番の控えで取る',
      pn.indexOf("var altNowP_ = (typeof ui !== 'undefined' && !!ui.altId);") > 0 && pn.indexOf('var cur = altNowP_ ? (loadDayData(date) || store.get()) : store.get();') > 0 &&
      pn.indexOf('} else if (store.get().meta.date === date) {') > 0 &&
      APP.indexOf('try { var d0 = ui.altId ? loadDayData(ui.currentDate) : store.get(); dayRev =') > 0);
    const push = extractFn(APP, 'altPushNow_');
    t('控えの案は 控えの日・案・盤面で送る（今の盤面 store.get() から送らない・消された案はその案の控えだけ捨てる）',
      push.indexOf('altWrite_(e.date,') > 0 && push.indexOf('d.alts[i].id === e.id') > 0 && push.indexOf('d.alts[i].board = e.board') > 0 &&
      push.indexOf('store.get()') < 0 && /altPendDel_\(key\);   \/\* その案だけを捨てる/.test(push));
    t('アプリの版の印は 案を知っている版（2026101703）以上', Number((/var WS_APP_VER = (\d+);/.exec(APP) || [])[1]) >= 2026101703);
  }

  /* ═══════════════ 3. 本番にする（昇格）═══════════════ */
  console.log('\n— 3. 本番にする（実施・チェック・札のコメントを本番から消さない）—');
  {
    const E = makeEnv();
    /* 本番: 実施(a)・チェックとコメント(b)・メモだけ(m)・実施で案に無い(gone)・コメントで案に無い(gone2)・印の無い札(plain)・担当違い(x) */
    const cur = [care('a', 540, 570, 's1', { done: true }), care('b', 600, 630, 's1', { checks: { 0: true, 1: false }, comment: cm('本番のコメント') }),
      care('m', 660, 690, 's1', { memo: '本番のメモ' }), care('gone', 720, 750, 's1', { done: true }), care('gone2', 780, 810, 's1', { comment: cm('案に無い札のコメント') }),
      care('mo', 840, 870, 's1', { memo: 'メモだけ' }), care('plain', 900, 930, 's1'), care('x', 960, 990, 's1', { done: true })];
    const alt = [care('a', 540, 570, 's1'), care('b2', 600, 630, 's3', { residentId: 'r_b', comment: cm('案のコメント') }), care('m', 660, 690, 's1', { memo: '案のメモ' }),
      care('plain', 900, 930, 's1'), care('x', 960, 990, 's2')];
    const info = {};
    const lost = E.f.carryMarks_(cur, alt, info, clone(STAFF), clone(STAFF));
    const by = Object.fromEntries(alt.map((x) => [x.id, x]));
    t('同じ id の札へ 実施の印を移す', by.a.done === true);
    t('id が違っても 同じ利用者・同じ開始の札へ チェックを移す（偽のチェックは移さない）', same(by.b2.checks, { 0: true }), by.b2.checks);
    t('札のコメントは 案の札にコメントが無い時だけ移す（案に既にあれば案のまま）', ctext(by.b2) === '案のコメント', by.b2.comment);
    t('札のメモも 案の札にメモが無い時だけ移す（案に既にあれば案のまま）', by.m.memo === '案のメモ', by.m.memo);
    t('印の無い札には何も付けない', !by.plain.done && same(by.plain.checks, {}) && by.plain.comment === null && by.plain.memo === '', by.plain);
    t('案に同じ札（id も 利用者・開始も）が無い札の 実施・チェック・コメントは移さず 数を返す（メモだけの札は数えない）', lost === 2, lost);
    t('担当（氏名）が違う札へ移した 実施・チェックは info.moved に数える（b2: 甲→丙、x: 甲→乙）', info.moved === 2 && by.x.done === true, info);
    const alt2 = [care('c', 540, 570, 's2')];
    const lost2 = E.f.carryMarks_([care('c', 540, 570, 's1', { comment: cm('コメント') })], alt2, {});
    t('コメントだけの札も同じ札へ移す', ctext(alt2[0]) === 'コメント' && lost2 === 0, alt2[0].comment);
  }
  {
    const st = S.createStore(board([care('c1', 600, 630, 's1')], { locked: true, lockedAt: 'T', routineDone: ['x'], shiftStamp: 'stamp', skipRefs: [{ r: 'A' }], notes: [{ id: 'n1', text: '本番' }] }));
    st.dispatch({ type: 'REPLACE_BOARD', staff: clone(STAFF), columns: clone(COLS), tasks: [care('c9', 660, 690, 's2')], fromAlt: true, shiftStamp: 'altStamp',
      skipRefs: [{ r: 'A' }, { r: 'B' }], notes: [{ id: 'n1', text: '案' }, { id: 'n2', text: '案2' }] });
    const d = st.get();
    t('REPLACE_BOARD: 盤面の中身だけ入れ替え meta（ロック・印）は本番のまま', same(d.tasks.map((x) => x.id), ['c9']) && d.meta.locked === true && d.meta.lockedAt === 'T' && same(d.meta.routineDone, ['x']), d.meta);
    t('REPLACE_BOARD: 案の「本日のみ削除」と全体コメントは本番に足す（同じ id のコメントは本番のまま）',
      same(d.meta.skipRefs, [{ r: 'A' }, { r: 'B' }]) && same(d.meta.notes.map((n) => n.id + ':' + n.text), ['n1:本番', 'n2:案2']), d.meta);
    t('REPLACE_BOARD: 案から本番にした印（fromAlt）と案の勤務表の印を付ける', d.meta.fromAlt === true && d.meta.shiftStamp === 'altStamp', d.meta);
    t('REPLACE_BOARD: 取り消し1回で元の本番へ戻る', st.undo() && same(st.get().tasks.map((x) => x.id), ['c1']));
  }
  /* 案を本番にする手順を通しで動かす（本物の store・偽のサーバー） */
  async function promote(opt) {
    const prod = board(opt.prodTasks, Object.assign({ locked: true, lockedAt: 'T', routineDone: ['r1'], notes: [{ id: 'n1', text: '本番の全体コメント' }] }, opt.prodMeta || {}));
    const alts = (opt.others || []).concat([altObj('aaaa1111', '案A', opt.altTasks, { notes: [{ id: 'n2', text: '案の全体コメント' }], skipRefs: [] })]);
    const sv = fakeServer({ rev: 3, data: { alts } });
    const E = makeEnv({ server: sv, prod, day: board([], { rev: 1 }) });
    let atReplace = null;
    const real = E.ctx.store.dispatch;
    E.ctx.store.dispatch = (a) => { if (a.type === 'REPLACE_BOARD') atReplace = { puts: sv.puts, alts: clone(sv.data.alts) }; return real(a); };
    await E.f.loadAlts_('2099-01-01');
    E.f.promoteAlt_('aaaa1111');
    await settle(() => E.toasts.length, 100);
    return { E, sv, atReplace, d: E.ctx.store.get() };
  }
  {
    const prodTasks = [care('a', 540, 570, 's1', { done: true }), care('b', 600, 630, 's1', { checks: { 0: true } }), care('c', 660, 690, 's1', { comment: cm('本番の札のコメント') }),
      care('d', 720, 750, 's2', { done: true, checks: { 1: true }, comment: cm('別の id の札') }), care('gone', 900, 930, 's1', { done: true, comment: cm('案に無い札') })];
    const altTasks = [care('a', 540, 570, 's2'), care('b', 600, 630, 's2'), care('c', 660, 690, 's3'), care('d2', 720, 750, 's3', { residentId: 'r_d' }), care('new', 960, 990, 's1')];
    const R = await promote({ prodTasks, altTasks });
    const by = Object.fromEntries(R.d.tasks.map((x) => [x.id, x]));
    t('本番にした後の盤面は 案の札（a・b・c・d2・new）', same(R.d.tasks.map((x) => x.id).sort(), ['a', 'b', 'c', 'd2', 'new']), R.d.tasks.map((x) => x.id));
    t('元の本番の実施の印が 本番にした後の同じ札に残る（a）', by.a && by.a.done === true, by.a);
    t('元の本番のチェックが 本番にした後の同じ札に残る（b）', by.b && same(by.b.checks, { 0: true }), by.b && by.b.checks);
    t('元の本番の札のコメントが 本番にした後の同じ札に残る（c）', by.c && ctext(by.c) === '本番の札のコメント', by.c);
    t('id が違っても同じ利用者・同じ開始の札へ 実施・チェック・コメントが残る（d → d2）',
      by.d2 && by.d2.done === true && same(by.d2.checks, { 1: true }) && ctext(by.d2) === '別の id の札', by.d2);
    t('元の本番に無かった札（new）には 印を付けない', by.new && !by.new.done && same(by.new.checks, {}) && by.new.comment === null, by.new);
    t('本番のロック・ロックの時刻・並びの印・全体コメントはそのまま、案の全体コメントは足し、fromAlt の印を付ける',
      R.d.meta.locked === true && R.d.meta.lockedAt === 'T' && same(R.d.meta.routineDone, ['r1']) && R.d.meta.fromAlt === true &&
      same((R.d.meta.notes || []).map((n) => n.id), ['n1', 'n2']), R.d.meta);
    const keep = R.atReplace && R.atReplace.alts.find((a) => /^元の本番 /.test(a.name));
    t('元の本番を「元の本番 …」の案として サーバーに残せてから 盤面を入れ替えた', !!(R.atReplace && R.atReplace.puts === 1 && keep), R.atReplace && R.atReplace.alts.map((a) => a.name));
    const kg = keep && keep.board.tasks.find((x) => x.id === 'gone');
    t('案に同じ札が無い札（gone）の実施・コメントは本番から消え、元の本番の案に残る（決まり: 移さず数を知らせる）',
      !by.gone && kg && kg.done === true && ctext(kg) === '案に無い札' && R.E.toasts.some((m) => /1件は、案に同じ札が無く移せませんでした/.test(m)), R.E.toasts);
    t('担当（氏名）が違う札へ移した印は知らせる（a 甲→乙・b 甲→乙・d→d2 乙→丙 の3件）', R.E.toasts.some((m) => /3件は、案では担当が違う札へ印を移しました/.test(m)), R.E.toasts);
    t('元の本番の案には ロック・版を持たない', keep && !('locked' in keep.board.meta) && !('rev' in keep.board.meta), keep && keep.board.meta);
    t('本番の最新を取り直してから入れ替える（pullDayNow を呼んだ）', R.E.calls.includes('pullDayNow'), R.E.calls);
  }
  {
    const prodTasks = [care('a', 540, 570, 's1', { done: true })];
    const others = [1, 2, 3, 4].map((k) => altObj('alt0000' + k, '案' + k));
    const R = await promote({ prodTasks, altTasks: [care('z', 600, 630, 's2')], others });
    t('案が5つある日は 元の本番を残せないので入れ替えない（盤面は本番のまま・実施の印も残る）',
      R.atReplace === null && R.sv.puts === 0 && same(R.d.tasks.map((x) => x.id), ['a']) && R.d.tasks[0].done === true && R.E.toasts.some((m) => /5つあるため/.test(m)), R.E.toasts);
  }
  {
    const prod = board([care('a', 540, 570, 's1', { done: true })]);
    const sv = fakeServer({ rev: 3, data: { alts: [altObj('aaaa1111', '案A', [care('z', 600, 630, 's2')])] } });
    const E = makeEnv({ server: sv, prod, day: board([], { rev: 1 }) });
    E.ctx.pullDayNow = (date, a, b, cb) => { E.calls.push('pullDayNow'); cb(); };   /* 取り直しに失敗（dayPullOk_ が立たない） */
    vm.runInContext('pullDayNow = this.pullDayNow;', E.ctx);
    await E.f.loadAlts_('2099-01-01');
    E.f.promoteAlt_('aaaa1111');
    await settle(() => E.toasts.length, 100);
    t('本番の最新を確かめられない時は 本番にしない（元の本番の案も作らない）', sv.puts === 0 && E.toasts.some((m) => /最新を確かめられなかった/.test(m)), E.toasts);
  }
  {
    const prod = board([care('a', 540, 570, 's1', { done: true })]);
    const sv = fakeServer({ rev: 3, data: { alts: [altObj('aaaa1111', '案A', [care('a', 540, 570, 's2')])] } });
    const E = makeEnv({ server: sv, prod, day: board([], { rev: 1 }) });
    let replaced = false;
    const real = E.ctx.store.dispatch;
    E.ctx.store.dispatch = (a) => { if (a.type === 'REPLACE_BOARD') replaced = true; return real(a); };
    const rpc = sv.rpc;
    sv.rpc = async (n, a) => (n === 'kv_put' ? { ok: false } : rpc(n, a));
    await E.f.loadAlts_('2099-01-01');
    E.f.promoteAlt_('aaaa1111');
    await settle(() => E.toasts.length, 100);
    t('元の本番を案に残せなかった時は 入れ替えない', !replaced && E.toasts.some((m) => /元の本番を案に残せなかった/.test(m)), E.toasts);
  }

  {
    /* 案を表示中に「本番にする」: 表示中の盤面（まだサーバーへ送っていない直し）を本番にし、本番の印も残る */
    const prod = board([care('a', 540, 570, 's1', { done: true, comment: cm('本番の札のコメント') })]);
    const sv = fakeServer({ rev: 3, data: { alts: [altObj('aaaa1111', '案A', [care('a', 540, 570, 's2')])] } });
    const E = makeEnv({ server: sv, prod, altId: 'aaaa1111', day: board([care('a', 540, 570, 's3'), care('edit', 600, 630, 's3')], { rev: 0 }) });
    vm.runInContext('saveTimer = 1;', E.ctx);
    await E.f.loadAlts_('2099-01-01');
    E.f.promoteAlt_('aaaa1111');
    await settle(() => E.toasts.length, 100);
    const d = E.ctx.store.get(), a = d.tasks.find((x) => x.id === 'a');
    t('案を表示中に本番にする時は 案の保存を確定し（doSave）案を抜けてから、表示中の盤面（未送信の直しを含む）で入れ替える',
      E.calls[0] === 'doSave:aaaa1111' && E.ctx.ui.altId === null && same(d.tasks.map((x) => x.id).sort(), ['a', 'edit']) && a.staffId === 's3', { calls: E.calls, ids: d.tasks.map((x) => x.id) });
    t('案を表示中に本番にしても 元の本番の実施の印と札のコメントが残る', a && a.done === true && ctext(a) === '本番の札のコメント', a);
  }

  /* ═══════════════ 4. 未送信の控え ═══════════════ */
  console.log('\n— 4. 未送信の控え（端末が正本・画面の中は書けない時だけ・seq と at の両方で消す）—');
  const altSv = (opt) => fakeServer({ rev: 1, data: { alts: [altObj('a1aa', 'a1'), altObj('a2aa', 'a2'), altObj('badd', 'bad')] } });
  /* 案の id は altIdOk_ の形に合わせて a1aa・a2aa・badd を使う。sent に送った盤面を残し、result で結果を差し替える */
  function pendEnv(opt) {
    opt = opt || {};
    const sent = [];
    const write = opt.write || ((date, mutate) => {
      const d = { alts: [{ id: 'a1aa', board: null }, { id: 'a2aa', board: null }, { id: 'badd', board: null }] };
      if (mutate(d) === false) return Promise.resolve({ ok: false, aborted: true });
      const hit = d.alts.find((a) => a.board);
      sent.push({ date, id: hit && hit.id, board: hit && hit.board });
      return Promise.resolve(opt.result ? opt.result(date, hit && hit.id) : { ok: true });
    });
    const E = makeEnv({ ls: opt.ls, lsRef: opt.lsRef, full: opt.full, altId: opt.altId || 'a1aa', server: altSv(),
      day: board([care('t1', opt.start === undefined ? 600 : opt.start, (opt.start === undefined ? 600 : opt.start) + 30, 's1')]) });
    E.ctx.altWrite_ = write;
    vm.runInContext('altWrite_ = this.altWrite_;', E.ctx);
    E.sent = sent;
    return E;
  }
  const tasksOf = (b) => (b && b.tasks ? b.tasks.map((x) => x.id + '@' + x.start) : null);
  {
    const E = pendEnv();
    E.f.altSaveLocal_();
    const ls = JSON.parse(E.ls.ws_alt_pending_v2 || '{}');
    t('案の保存は 端末（ws_alt_pending_v2）に 日と案ごとに控える（seq と at つき）', ls['2099-01-01|a1aa'] && ls['2099-01-01|a1aa'].seq === 1 && !!ls['2099-01-01|a1aa'].at && same(E.v().altPendMem_, {}), Object.keys(ls));
    t('控えたら 少し待って送る段取り（1.5秒）', E.timers.some((x) => x.ms === 1500));
  }
  {
    const E = pendEnv({ full: true });
    E.f.altSaveLocal_();
    t('(A) 端末に書けない時は 書けないことを画面に出す', /この端末に控えを残せません/.test(E.ctx.saveText) && E.ls.ws_alt_pending_v2 === undefined, E.ctx.saveText);
    E.f.altPushNow_(); await flush(); await flush();
    t('(A) 端末に書けない時も 画面の中の控えから送る', E.sent.length === 1 && same(tasksOf(E.sent[0].board), ['t1@600']), E.sent.length);
    t('(A) 送れたら「案を保存 時:分」と出し 控えは消える', /案を保存 \d\d:\d\d/.test(E.ctx.saveText) && Object.keys(E.f.altPendAll_()).length === 0, E.ctx.saveText);
  }
  {
    const old = { '2099-01-01|a1aa': { date: '2099-01-01', id: 'a1aa', seq: 9, at: '2000-01-01T00:00:00.000Z', board: { tasks: [{ id: 't1', start: 0 }] } } };
    const E = pendEnv({ full: true, ls: { ws_alt_pending_v2: JSON.stringify(old) } });
    E.f.altSaveLocal_();
    E.f.altPushNow_(); await flush(); await flush();
    t('(A) 端末に古い控えが残っていて新しい控えを書けない時は 新しい方（画面の中）を送る', E.sent.length === 1 && same(tasksOf(E.sent[0].board), ['t1@600']), E.sent.map((x) => tasksOf(x.board)));
  }
  {
    const pend = {
      '2099-01-01|badd': { date: '2099-01-01', id: 'badd', seq: 1, at: '2099-01-01T00:00:00.000Z', board: { tasks: [] } },
      '2099-01-01|a2aa': { date: '2099-01-01', id: 'a2aa', seq: 2, at: '2099-01-01T00:00:01.000Z', board: { tasks: [{ id: 'x', start: 1 }] } },
    };
    const E = pendEnv({ ls: { ws_alt_pending_v2: JSON.stringify(pend) }, result: (d, id) => (id === 'badd' ? { ok: false } : { ok: true }) });
    E.f.altPushNow_(); await flush(); await flush();
    await E.runTimers();
    const left = E.f.altPendAll_();
    t('(B) 先頭の案が送れないままでも ほかの案を先に送る', E.sent.some((x) => x.id === 'a2aa') && !left['2099-01-01|a2aa'], E.sent.map((x) => x.id));
    t('(B) 送れない案の控えは残す（あとで試し直す）', !!left['2099-01-01|badd']);
  }
  {
    const pend = { '2099-01-01|badd': { date: '2099-01-01', id: 'badd', seq: 1, at: '2099-01-01T00:00:00.000Z', board: { tasks: [] } } };
    const E = pendEnv({ ls: { ws_alt_pending_v2: JSON.stringify(pend) }, result: () => ({ ok: false }) });
    E.f.altPushNow_(); await flush(); await flush();
    t('(B) 送れない案しか残っていない時は 20秒あけて試し直す（すぐに繰り返さない）', E.timers.length === 1 && E.timers[0].ms === 20000, E.timers.map((x) => x.ms));
  }
  {
    const pend = { '2099-01-01|a2aa': { date: '2099-01-01', id: 'a2aa', seq: 5, at: '2099-01-01T00:00:01.000Z', board: { tasks: [{ id: 'x' }] } } };
    const E = pendEnv({ ls: { ws_alt_pending_v2: JSON.stringify(pend) }, result: (d, id) => (id === 'a2aa' ? { ok: false } : { ok: true }) });
    E.f.altSaveLocal_();
    const pre = !!JSON.parse(E.ls.ws_alt_pending_v2)['2099-01-01|a1aa'];
    E.ctx.full = true;
    E.f.altPushNow_(); await flush(); await flush();
    await E.runTimers();
    const left = E.f.altPendAll_();
    t('(C) 端末がいっぱいのまま送れた控えは消え、送れない控えは残す', pre && !left['2099-01-01|a1aa'] && !!left['2099-01-01|a2aa'], Object.keys(left));
    const R = pendEnv({ lsRef: E.ls, full: true });
    t('(C) 再読み込みしても 送れた控えは生き返らない（端末の古い控えも消してある）', !R.f.altPendAll_()['2099-01-01|a1aa'], Object.keys(R.f.altPendAll_()));
  }
  {
    const old = { '2099-01-01|a1aa': { date: '2099-01-01', id: 'a1aa', seq: 1, at: '2000-01-01T00:00:00.000Z', board: { tasks: [{ id: 't1', start: 0 }] } } };
    let resolve;
    const E = pendEnv({ ls: { ws_alt_pending_v2: JSON.stringify(old) }, write: (date, mutate) => { const d = { alts: [{ id: 'a1aa', board: null }] }; mutate(d); return new Promise((r) => { resolve = r; }); } });
    E.f.altPushNow_(); await flush();
    E.f.altSaveLocal_();
    const pre = E.f.altPendAll_()['2099-01-01|a1aa'].seq === 1;
    resolve({ ok: true }); await flush(); await flush();
    const left = E.f.altPendAll_()['2099-01-01|a1aa'];
    t('(F) 送れた控えを消すのは seq と at の両方が一致する時だけ（再読み込みで seq が同じでも 送っている間に直した控えは残す）',
      pre && left && same(tasksOf(left.board), ['t1@600']), left && tasksOf(left.board));
  }
  {
    const E = pendEnv({ full: true, result: () => ({ ok: false }) });
    E.f.altSaveLocal_();
    E.f.altPushNow_(); await flush(); await flush();
    t('(G) 端末に書けない時の失敗の表示にも「閉じないでください」を付ける', /案の保存失敗.*閉じないでください/.test(E.ctx.saveText), E.ctx.saveText);
  }
  {
    const pend = {
      '2099-01-01|gone': { date: '2099-01-01', id: 'gone', seq: 1, at: '2099-01-01T00:00:00.000Z', board: { tasks: [] } },
      '2099-01-01|a2aa': { date: '2099-01-01', id: 'a2aa', seq: 2, at: '2099-01-01T00:00:01.000Z', board: { tasks: [] } },
    };
    const E = pendEnv({ ls: { ws_alt_pending_v2: JSON.stringify(pend) }, result: () => ({ ok: false }) });
    E.f.altPushNow_(); await flush(); await flush();
    await E.runTimers();
    const left = Object.keys(E.f.altPendAll_());
    t('(D) 消された案（aborted）は その案の控えだけを捨て、ほかの案の控えは残す', !left.includes('2099-01-01|gone') && left.includes('2099-01-01|a2aa'), left);
  }

  /* ═══════════════ 5. 2つのタブ ═══════════════ */
  console.log('\n— 5. 2つのタブ（別のタブの控えを覚えて送り直さない）—');
  {
    const shared = {}, server = {};
    const write = (sent) => (date, mutate) => { const d = { alts: [{ id: 'a1aa', board: null }, { id: 'a2aa', board: null }] }; mutate(d); const h = d.alts.find((a) => a.board); server[h.id] = h.board; sent.push(h.id); return Promise.resolve({ ok: true }); };
    const sentA = [], sentB = [];
    const B = pendEnv({ lsRef: shared, altId: 'a1aa', start: 1, write: write(sentB) });
    const A = pendEnv({ lsRef: shared, altId: 'a2aa', start: 9, write: write(sentA) });
    B.f.altSaveLocal_();
    A.f.altSaveLocal_();
    B.ctx.store.dispatch({ type: 'INIT_DAY', day: board([care('t1', 2, 32, 's1')]) });
    B.f.altSaveLocal_();
    B.f.altPushNow_(); await flush(); await flush(); await B.runTimers();
    A.f.altPushNow_(); await flush(); await flush(); await A.runTimers();
    t('(E) 別のタブが送り終えた控えを もう一方のタブが送り直さない（a1aa は後の直しのまま）',
      same(tasksOf(server.a1aa), ['t1@2']) && !sentA.includes('a1aa'), { a1: tasksOf(server.a1aa), sentA });
  }
  {
    /* 端末がいっぱいのタブ（B）は 自分が書いた控えだけを画面の中に持つ。別のタブ（A）の控えを写して覚えると、
       A が送り終えて端末から消した後も B が古い盤面を送り直す */
    const shared = {};
    const A = pendEnv({ lsRef: shared, altId: 'a2aa', start: 9 });
    A.f.altSaveLocal_();
    const B = pendEnv({ lsRef: shared, altId: 'a1aa', start: 1, full: true });
    B.f.altSaveLocal_();
    const mem = Object.keys(B.v().altPendMem_);
    t('端末に書けないタブは 自分の控えだけを画面の中に持つ（別のタブの控えを写さない）', same(mem, ['2099-01-01|a1aa']), mem);
    delete shared.ws_alt_pending_v2;   /* A が送り終えて端末の控えを消した */
    const left = Object.keys(B.f.altPendAll_());
    t('別のタブが端末から消した控えは こちらにも残らない', same(left, ['2099-01-01|a1aa']), left);
    B.ctx.full = false;
    B.ctx.store.dispatch({ type: 'INIT_DAY', day: board([care('t1', 3, 33, 's1')]) });
    B.f.altSaveLocal_();
    t('端末に書けるようになったら 画面の中の控えは捨てる（端末が正本）', same(B.v().altPendMem_, {}) && !!JSON.parse(shared.ws_alt_pending_v2)['2099-01-01|a1aa'], B.v().altPendMem_);
  }
})().catch((e) => { fail++; console.log('  ✗ 例外: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e)); })
  .finally(() => {
    console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
    process.exit(fail ? 1 : 0);
  });
