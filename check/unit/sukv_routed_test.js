/* 保存先を Supabase に切り替えた後（su-backend.json のスイッチが入った後）の経路の試験（2026-10-10 新設）。
   10/09 朝に週間計画・ワークスケジュールのスイッチが入った（e7c4ae2）。切り替え後は su-kv.js の SUKv.call が
   Supabase の関数で読み書きし、Google と同じ形の応答を返す。その「断り」を各画面が正しく受け止めるかを確かめる。
   守りたいこと:
     A su-kv.js: 未ログイン（login）・現場のアカウントの保存（forbidden）・切り替え前（shadow）・競合（conflict）・通信の失敗を
       そのまま返し、Google へは流さない（流すと、保存先が2つに割れる）。ログインの帯を出す。成功した時だけ Google へ写し返す
     B 週間計画（care-schedule.html の SYNC.push）: 断られても「同期OK」にせず、未送信の印を残す＝入力は端末に残る
     C ワークスケジュール（work-schedule.html の pushDayNow）: 断られても未送信の印を残し、時間をおいて送り直す
     D デイ利用表（daycare-roster.html の runSaver）: 断られたら切り替えを元に戻して知らせる（2026-10-10 代表者の決定）。
       偽の「保存しました」を出さない
   ★画面の本物の関数を切り出して動かす。偽物にするのは、ログインの状態・データベースの応答・Google への送信だけ。
   実行: node check/unit/sukv_routed_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const clone = o => JSON.parse(JSON.stringify(o));
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 30); i++) await tick(); }

/* 文字列・コメントの中のかっこを数えない切り出し */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      /* 正規表現リテラル（/…/）の中のかっこを数えない */
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grab(src, header, from) {
  const start = src.indexOf(header, from || 0);
  if (start < 0) throw new Error('見つかりません: ' + header.trim());
  const end = scanBlock(src, start);
  if (end < 0) throw new Error('終わりが見つかりません: ' + header.trim());
  return src.slice(start, end + 1);
}

/* ══ 砂場: su-kv.js（本物）＋偽のログイン・データベース ══ */
const SUKV_SRC = read('su-kv.js');
const STATUS = { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' };
function makeKv(o) {
  o = o || {};
  const ls = new Map();
  ls.set('su_backend_flags', JSON.stringify({ supabase: o.flags || { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false } }));
  const banners = [], rpcs = [], raws = [], timers = [];
  const db = Object.assign({ rev: 5, data: { residents: [] } }, o.db || {});
  const sb = {
    rpc(name, args) {
      rpcs.push({ name, args: clone(args) });
      if (o.rpcThrowOnce && !sb._thrown) { sb._thrown = true; return Promise.resolve({ error: { message: 'Failed to fetch' } }); }
      if (o.rpcError) return Promise.resolve({ error: o.rpcError });
      if (name === 'kv_get') return Promise.resolve({ data: { ok: true, rev: db.rev, data: clone(db.data), updatedAt: 'x' } });
      if (name === 'kv_head') { const revs = {}; (args.p_keys || []).forEach(k => { revs[k] = db.rev; }); return Promise.resolve({ data: { revs } }); }
      if (name === 'kv_put') {
        if (o.putReply) return Promise.resolve({ data: o.putReply });
        if (args.p_rev !== db.rev) return Promise.resolve({ data: { ok: false, conflict: true, rev: db.rev } });
        db.rev++; db.data = clone(args.p_data);
        return Promise.resolve({ data: { ok: true, rev: db.rev } });
      }
      return Promise.resolve({ data: null });
    }
  };
  const body = { children: [], appendChild(el) { this.children.push(el); banners.push(el); } };
  const box = {
    console, JSON, Math, Date, Number, String, Array, Object, Promise, Error,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), key: () => null, length: 0 },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: o.flags || { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false } }) }),
    setTimeout: (f, ms) => { if (ms === 3000) return 0; timers.push(f); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/care-tools/care-schedule.html' },
    document: {
      body, head: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, textContent: '' })
    }
  };
  box.window = box;
  box.SUAuth = {
    STATUS,
    check: () => o.checkThrows ? Promise.reject(new Error('net')) : Promise.resolve({ status: o.status || STATUS.OK, role: o.role || 'office' }),
    client: () => sb
  };
  vm.createContext(box);
  vm.runInContext(SUKV_SRC, box, { filename: 'su-kv.js' });
  const raw = p => { raws.push(clone(p)); return Promise.resolve({ ok: true, rev: 99, revs: { other: 3 }, data: null }); };
  return { kv: box.SUKv, box, banners, rpcs, raws, timers, db, raw, ls };
}

(async () => {
  console.log('\n— A. su-kv.js が切り替え後の断りをそのまま返し、Google へ流さない —');
  {
    const put = { action: 'put', key: 'care_schedule_v2', rev: 5, data: { residents: [{ id: 'r1' }] } };
    let k = makeKv({ status: STATUS.SIGNED_OUT });
    t('週間計画のキーは SUKv が受け持つ', k.kv.handles(put) === true && k.kv.handles({ action: 'put', key: 'wsday_2026-10-10' }) === true);
    t('受け持たないキー（勤務表・ほかのアプリ）は受け持たない', k.kv.handles({ action: 'put', key: 'staff' }) === false && k.kv.handles({ action: 'put', key: 'genogram_x' }) === false);
    let r = await k.kv.call(put, k.raw);
    t('★未ログインの保存は login で断る', r && r.ok === false && r.error === 'login', r);
    t('★未ログインの時は Google へ流さない', k.raws.length === 0, k.raws);
    t('★「ログインしてください」の帯を出す（1回だけ）', k.banners.length === 1);
    await k.kv.call({ action: 'get', key: 'care_schedule_v2' }, k.raw);
    t('読み込みも login で断り、帯は増やさない', k.banners.length === 1 && k.raws.length === 0);
    for (const st of [STATUS.DENIED, STATUS.MFA_VERIFY, STATUS.MFA_ENROLL]) {
      k = makeKv({ status: st });
      r = await k.kv.call(put, k.raw);
      t('許可リスト外・2段階認証の途中（' + st + '）も login で断る', r.error === 'login' && k.raws.length === 0);
    }
    k = makeKv({ checkThrows: true });
    r = await k.kv.call(put, k.raw);
    t('★ログインの確認が通信で失敗したら「通信失敗」（Google へ流さない）', r.ok === false && r.error === '通信失敗' && k.raws.length === 0, r);

    k = makeKv({ role: 'field' });
    r = await k.kv.call(put, k.raw);
    t('★現場のアカウントの保存は forbidden で断る（データベースへ送らない）', r.error === 'forbidden' && !k.rpcs.some(x => x.name === 'kv_put') && k.raws.length === 0, r);
    r = await k.kv.call({ action: 'get', key: 'care_schedule_v2' }, k.raw);
    t('現場のアカウントでも読み込みはできる', r.ok === true && r.rev === 5);

    k = makeKv({ putReply: { ok: false, error: 'shadow', rev: 0 } });
    r = await k.kv.call(put, k.raw);
    t('★切り替え前（管理者の「切り替える」がまだ）の保存は shadow をそのまま返す', r.ok === false && r.error === 'shadow', r);
    t('★shadow の時は Google へ流さず、写し返しも予約しない', k.raws.length === 0 && k.timers.length === 0);

    k = makeKv();
    r = await k.kv.call(Object.assign({}, put, { rev: 3 }), k.raw);
    t('★版が古い保存は conflict をそのまま返す（画面の競合の取り込みに乗る）', r.ok === false && r.conflict === true && r.rev === 5, r);
    t('競合の時も Google へ流さない', k.raws.length === 0);

    k = makeKv({ rpcError: { code: '42501', message: 'permission denied' } });
    r = await k.kv.call(put, k.raw);
    t('データベースの権限の断り（42501）は forbidden', r.error === 'forbidden' && k.raws.length === 0, r);
    k = makeKv({ rpcError: { message: 'something' } });
    r = await k.kv.call(put, k.raw);
    t('そのほかのデータベースの失敗は「通信失敗」（Google へ流さない）', r.error === '通信失敗' && k.raws.length === 0, r);
    k = makeKv({ rpcThrowOnce: true });
    r = await k.kv.call(put, k.raw);
    t('通信の失敗は1回だけやり直し、通れば保存できる', r.ok === true && k.rpcs.filter(x => x.name === 'kv_put').length === 2, k.rpcs.map(x => x.name));

    k = makeKv();
    r = await k.kv.call(put, k.raw);
    t('ログイン済み・事務所の保存は通る', r.ok === true && r.rev === 6 && k.db.rev === 6);
    t('保存の直後は Google へ流さない（写し返しは少し待ってから）', k.raws.length === 0 && k.timers.length === 1);
    k.timers[0](); await settle();
    t('★写し返しは、データベースの最新版を force で Google へ送る（読むだけの画面のため）',
      k.raws.length === 1 && k.raws[0].action === 'put' && k.raws[0].force === true && k.raws[0].key === 'care_schedule_v2' && Array.isArray(k.raws[0].data.residents), k.raws);

    k = makeKv();
    r = await k.kv.call({ action: 'head', keys: ['care_schedule_v2', 'wsday_2026-10-10', 'other'] }, k.raw);
    t('版の問い合わせは、切り替えたキーをデータベース・残りを Google に聞いてまとめる',
      r.ok === true && r.revs.care_schedule_v2 === 5 && r.revs['wsday_2026-10-10'] === 5 && r.revs.other === 3 && k.raws.length === 1 && JSON.stringify(k.raws[0].keys) === '["other"]', r);
    k = makeKv({ status: STATUS.SIGNED_OUT });
    r = await k.kv.call({ action: 'head', keys: ['care_schedule_v2', 'other'] }, k.raw);
    t('★未ログインなら、まとめた答えを作らず login を返す（古い版を新しいと見せない）', r.ok === false && r.error === 'login', r);

    k = makeKv({ flags: { care_schedule_v2: false, ws_weekly_master_v1: false, wsday: false, shift: false }, status: STATUS.SIGNED_OUT });
    r = await k.kv.call(put, k.raw);
    t('（対照）スイッチが切なら今までどおり Google へ送る', k.raws.length === 1 && r.ok === true && k.banners.length === 0);
  }

  console.log('\n— B. 週間計画（SYNC.push）: 断られても入力を端末に残す —');
  {
    const CS = read('care-schedule.html');
    const method = name => { const s = CS.indexOf('\n  ' + name + '('); const s2 = CS.indexOf('\n  async ' + name + '('); const st = s2 >= 0 && (s < 0 || s2 < s) ? s2 : s; if (st < 0) throw new Error('メソッドなし ' + name); return CS.slice(st + 1, scanBlock(CS, st) + 1); };
    async function runPush(kvOpt) {
      const k = makeKv(kvOpt);
      const ls = new Map(); ls.set('ws_sync_revs', JSON.stringify({ care: 5 }));
      const logs = [], states = [];
      const box = {
        console, JSON, Math, Date, Number, String, Array, Object, Promise, Error, isFinite,
        SIM_ON: false, CS_DIRTY_KEY: 'care_schedule_dirty_v1',
        DB: { residents: [{ id: 'r1', name: '架空 一郎', events: [] }] },
        localStorage: { getItem: x => (ls.has(x) ? ls.get(x) : null), setItem: (x, v) => ls.set(x, String(v)), removeItem: x => ls.delete(x) },
        csMergeLocalBeforePush_() {}, ensureServiceDict_() {}, csFieldBaseBuild_: () => ({}), csFieldBaseSet_() {}, csNote_() {},
        SUKV: k.kv, RAW: k.raw
      };
      vm.createContext(box);
      vm.runInContext('var SYNC = {\n _dirty:false, _baseRev:null, _busy:false, _healPushing:false, _rebasing:false, _statusBefore:"同期", config:{},\n'
        + [method('push'), method('markDirty'), method('clearDirty'), method('loadCareRev'), method('friendlyErr'),
           method('isWrongEndpointErr'), method('isConfirmedEndpointFailMsg')].join(',\n')
        + ',\n saveCareRev(r){ var o=JSON.parse(localStorage.getItem("ws_sync_revs")||"{}"); o.care=r; localStorage.setItem("ws_sync_revs", JSON.stringify(o)); },'
        + '\n save(){}, log(m){ LOGS.push(m); }, updateStatusUI(s){ STATES.push(s); }, updateStatusUIFail(s){ STATES.push("fail:"+s); },'
        + '\n hasTarget(){ return true; }, async healStaleTarget(){ return false; },'
        + '\n gas(p){ return SUKV.handles(p) ? SUKV.call(p, RAW) : RAW(p); }\n};', Object.assign(box, { LOGS: logs, STATES: states }));
      const S = box.SYNC;
      S.markDirty();
      const before = JSON.stringify(box.DB);
      const ok = await S.push();
      return { ok, S, box, ls, logs, states, k, before };
    }
    for (const [label, opt] of [['未ログイン（login）', { status: STATUS.SIGNED_OUT }], ['現場のアカウント（forbidden）', { role: 'field' }], ['切り替え前（shadow）', { putReply: { ok: false, error: 'shadow', rev: 0 } }], ['通信の失敗', { rpcError: { message: 'x' } }]]) {
      const x = await runPush(opt);
      t('★' + label + ': 「同期OK」にしない', x.ok === false && x.states.indexOf('同期OK') < 0, x.states);
      t('★' + label + ': 未送信の印（端末に保存する印も）を残す', x.S._dirty === true && x.ls.get('care_schedule_dirty_v1') === '1');
      t(label + ': 画面のデータは書き換えない・Google へ流さない', JSON.stringify(x.box.DB) === x.before && x.k.raws.length === 0);
      t(label + ': 失敗を記録に出す', x.logs.some(m => /保存失敗/.test(m)), x.logs);
    }
    const ok = await runPush({});
    t('（対照）ログイン済みなら保存でき、未送信の印が降りる', ok.ok === true && ok.S._dirty === false && !ok.ls.has('care_schedule_dirty_v1') && ok.states.indexOf('同期OK') >= 0, ok.states);
  }

  console.log('\n— C. ワークスケジュール（pushDayNow）: 断られても未送信の印を残し、送り直す —');
  {
    const WS = read('work-schedule.html');
    const FN = grab(WS, 'function pushDayNow(');
    async function runDay(kvOpt) {
      const k = makeKv(kvOpt);
      const calls = [];
      const rec = name => function () { calls.push(name); };
      const day = { meta: { date: '2026-10-10', rev: 5 }, staff: [{ name: '架空 職員' }] };
      const box = {
        console, JSON, Math, Date, Number, String, Array, Object, Promise, Error,
        syncOn: () => true, dayPushBusy_: false, dayPushAgain_: false, lastPushed: {}, unlockForceDates_: {}, conflictN_: {},
        store: { get: () => day, dispatch: rec('dispatch') }, daySig: () => 'SIG', dayKey: d => 'wsday_' + d,
        isRefetchHeld_: () => false, staffWipeBlocked_: () => false,
        notePush_: function (d, kind) { calls.push('notePush:' + kind); }, markDayDirty_: rec('markDayDirty'), clearDayDirty_: rec('clearDayDirty'),
        updateSyncBadge_() {}, saveBase_: rec('saveBase'), setSyncState: s => calls.push('state:' + s), pad2: n => ('0' + n).slice(-2),
        noteSyncSuccess_: rec('syncSuccess'), showOfflineIfPersistent_: rec('offline'), scheduleRetry_: rec('retry'),
        failReason_: e => String(e || ''), verifyPutLanded_: rec('verify'), friendlyErr: e => String(e || ''),
        handleLockedReject_: rec('locked'), handleDayConflict_: rec('conflict'), schedulePushDay: rec('again'), $: () => ({}),
        gas: (p, cb) => { (k.kv.handles(p) ? k.kv.call(p, k.raw) : k.raw(p)).then(cb); }
      };
      vm.createContext(box);
      vm.runInContext(FN, box, { filename: 'work-schedule(pushDayNow)' });
      box.pushDayNow(false);
      await settle();
      return { calls, k };
    }
    for (const [label, opt] of [['未ログイン（login）', { status: STATUS.SIGNED_OUT }], ['現場のアカウント（forbidden）', { role: 'field' }], ['切り替え前（shadow）', { putReply: { ok: false, error: 'shadow', rev: 0 } }]]) {
      const x = await runDay(opt);
      t('★' + label + ': 未送信の印を付け、降ろさない', x.calls.indexOf('markDayDirty') >= 0 && x.calls.indexOf('clearDayDirty') < 0, x.calls);
      t('★' + label + ': 時間をおいて送り直す（オフライン表示）', x.calls.indexOf('retry') >= 0 && x.calls.indexOf('offline') >= 0);
      t(label + ': 送った盤面を「確定した土台」にしない・「✓同期」にしない', x.calls.indexOf('saveBase') < 0 && !x.calls.some(c => /^state:✓同期/.test(c)));
      t(label + ': Google へ流さない', x.k.raws.length === 0);
    }
    const c = await runDay({ db: { rev: 7 } });
    t('★版が古い時は競合の取り込み（3方向のマージ）へ進む', c.calls.indexOf('conflict') >= 0 && c.calls.indexOf('clearDayDirty') < 0, c.calls);
    const ok = await runDay({});
    t('（対照）ログイン済みなら保存でき、未送信の印が降り、土台を確定する', ok.calls.indexOf('clearDayDirty') >= 0 && ok.calls.indexOf('saveBase') >= 0 && ok.calls.some(x => /^state:✓同期/.test(x)), ok.calls);
  }

  console.log('\n— D. デイ利用表（runSaver）: 断られたら元に戻して知らせる・偽の保存OKを出さない —');
  {
    const DCR = read('daycare-roster.html');
    const dFn = name => grab(DCR, '\n' + (DCR.indexOf('\nasync function ' + name + '(') >= 0 ? 'async ' : '') + 'function ' + name + '(').trim();
    const dDecl = name => { const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*(.+)$', 'm').exec(DCR); if (!m) throw new Error('宣言なし ' + name); return 'var ' + name + ' = ' + m[1].replace(/\s*\/\/.*$/, ''); };
    async function runDcr(kvOpt) {
      const k = makeKv(Object.assign({ db: { rev: 5, data: { residents: [{ id: 'r1', masterId: 101, name: '架空 一郎', lunchMed: false, events: [] }] } } }, kvOpt));
      const toasts = [];
      const box = {
        JSON, Math, Date, Number, String, Array, Object, Map, Promise, Error, console,
        setTimeout: (f) => { f(); return 1; }, clearTimeout() {},
        localStorage: { getItem: () => null, setItem() {} },
        toast(m, ng) { toasts.push({ m, ng: !!ng }); }, renderAll() {}, setSyncState() {}, scheduleSaverRetry_() {},
        syncTarget() { return { endpoint: 'x', token: '' }; },
        gasCall: q => (k.kv.handles(q) ? k.kv.call(q, k.raw) : k.raw(q))
      };
      vm.createContext(box);
      vm.runInContext([
        "var LS_KEY = 'care_schedule_v2';", 'var busy = false;', 'var DB = null;',
        'var careRev = 0, saveDirty = false, saverRunning = false, flagSeq = 0, saverRetry_ = null;',
        'var pendingFlags = new Map();',
        dDecl('DCR_DEVICE_KEY'), dDecl('DCR_FIELD_MSG'), dDecl('DCR_LOG_MAX'), dDecl('DCR_LOG_FIELDS'),
        'var dcrLogSeq_ = 0, dcrWhoAcct_ = "";',
        ...['suNormName_', 'findServerResident_', 'pendingKey_', 'dcrIsField_', 'dcrWho_', 'dcrStamp_', 'dcrMakeLog_',
            'dcrAddLog_', 'dcrRemoveLogs_', 'applyPendingFlag_', 'getRemoteWithRev', 'queueFlags', 'runSaver', 'writeResidentFlag', 'writeLunchMed'].map(dFn)
      ].join('\n'), box, { filename: 'daycare-roster(切り出し)' });
      box.DB = clone(k.db.data); box.careRev = 5;
      box.writeLunchMed([{ rid: 'r1', masterId: 101, name: '架空 一郎' }], true);
      for (let i = 0; i < 200 && (box.saverRunning || box.pendingFlags.size); i++) await tick();
      return { box, toasts, k };
    }
    for (const [label, opt] of [['未ログイン（login）', { status: STATUS.SIGNED_OUT }], ['現場のアカウント（forbidden）', { role: 'field' }], ['切り替え前（shadow）', { putReply: { ok: false, error: 'shadow', rev: 0 } }]]) {
      const x = await runDcr(opt);
      t('★' + label + ': 偽の「保存しました」を出さない', !x.toasts.some(o => /保存しました/.test(o.m)), x.toasts);
      t('★' + label + ': 「変更を取り消しました」と知らせ、昼食薬を元に戻す', x.toasts.some(o => /取り消しました/.test(o.m) && o.ng) && x.box.DB.residents[0].lunchMed === false, x.toasts);
      t(label + ': 未確定の変更は残さない（画面とサーバーが食い違わない）・Google へ流さない', x.box.pendingFlags.size === 0 && x.k.raws.length === 0 && x.k.db.data.residents[0].lunchMed === false);
    }
    const ok = await runDcr({});
    t('（対照）ログイン済みなら保存でき、サーバーの昼食薬が変わる', ok.k.db.data.residents[0].lunchMed === true && ok.toasts.some(o => /保存しました/.test(o.m)), ok.toasts);
  }

  console.log('\n— E. 現場への案内 —');
  {
    const idx = read('index.html'), help = read('help.html');
    t('メニューのログインの表記から「試験中」を外した（10/09 から事務所PCの保存に必須）', /<a href="login\.html">ログイン（Google）<\/a>/.test(idx) && !/ログイン（Google・試験中）/.test(idx));
    t('ヘルプに「ログインが必要です」の帯が出た時の節がある（帯のボタンの文言と同じ「ログインする」）', /id="h-login"/.test(help) && /<span class="key">ログインする<\/span>/.test(help) && /ログインする/.test(SUKV_SRC));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
