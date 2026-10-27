/* ワークスケジュールの「黙って捨てていた失敗」を記録する置き換えと、速さの記録での数え方の試験（2026-10-27・本人指示・代表者の決定 2026-10-27）。
   実物の work-schedule.html・su-errors.js・su-perf.js・perf-report.js を読んで、vm で動かす。架空の値だけを流す。

   守りたいこと:
   1. 置き換えた catch（16か所）は wsNote_ を呼ぶだけで、続きの動き（戻り値・後の処理）は置き換える前と同じ
      - 置き換える前の形は、置き換えた catch を空の {} に戻して作る（同じ偽物で前と後を動かし、呼ばれた順と戻り値を比べる）
      - su-errors.js が無い端末でも例外を外に出さない
   2. 数える部品（su-perf.js）は note だけを、アプリと場所（where）ごとに数える
      - report（帯を出す方）は数えない。例外の文・種類（氏名らしい値を含めた架空の文）は残さない。決まりに合わない場所は「その他」
   3. perf-report.js の「黙って失敗した回数」の表の行の組み立て
   4. 空の catch の数: 置き換えた数＋残った数＝元の数。置き換えた関数の中に残した空の catch は、表示だけのもの（決まった一覧）
   実行: node check/unit/ws_silent_note_test.js */
'use strict';
process.env.TZ = 'Asia/Tokyo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WS = read('work-schedule.html');
const SRC_ERR = read('su-errors.js');
const SRC_PERF = read('su-perf.js');
const SRC_REPORT = read('perf-report.js');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 20); i++) await tick(); }

/* 文字列・コメント・正規表現の中のかっこを数えない切り出し（sukv_routed_test.js と同じ） */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grab(src, name) {
  const start = src.indexOf('\n  function ' + name + '(');
  if (start < 0) throw new Error('見つかりません: ' + name);
  const end = scanBlock(src, start);
  return src.slice(start + 1, end + 1);
}

/* 置き換えた catch の一覧（関数・場所の名前・catch の変数）。場所の名前は wsNote_ が頭に 'ws:' を付ける */
const SITES = [
  ['flushAll_', 'flushAll.save', 'e'], ['flushAll_', 'flushAll.alt', 'eA'], ['flushAll_', 'flushAll.day', 'e2'], ['flushAll_', 'flushAll.care', 'e3'],
  ['pushDayNow', 'pushDay.altRev', 'eLp'], ['pushDayNow', 'pushDay.verify', 'eV'],
  ['pushCareNow', 'pushCare.read', 'e'],
  ['altClient_', 'altClient', 'e'],
  ['gas', 'gas.syncResult', 'eN'],
  ['withAppVer_', 'appVer', 'eF'],
  ['unlockIntentSet_', 'unlockIntent', 'e'],
  ['noteSyncSuccess_', 'syncOk.retry', 'eR2'],
  ['verifyPutLanded_', 'verify.meta', 'eM'], ['verifyPutLanded_', 'verify.ls', 'eL'], ['verifyPutLanded_', 'verify.after', 'eVc'],
  ['schedulePushDay', 'schedulePush.seeded', 'eSu']
];
const siteText = (w, v) => 'catch (' + v + ') { wsNote_(\'' + w + '\', ' + v + '); }';
/* 置き換える前の形（catch の中を空に戻す） */
function original(src) { let s = src; SITES.forEach(([, w, v]) => { s = s.split(siteText(w, v)).join('catch (' + v + ') {}'); }); return s; }
const EMPTY_RE = /catch\s*(\([^)]*\))?\s*\{\s*(\/\*[^*]*\*\/\s*)?\}/g;
const countEmpty = (s) => (s.match(EMPTY_RE) || []).length;

/* 本物の wsNote_ と、記録を控える偽の SUErrors */
const WS_NOTE = grab(WS, 'wsNote_');
function noteBox(extra, withErrors) {
  const notes = [];
  const box = Object.assign({ console, JSON, Math, Date, Number, String, Array, Object, Promise, Error, isFinite }, extra || {});
  box.window = withErrors === false ? {} : { SUErrors: { note: (kind, e, where) => notes.push({ kind, where, name: e && e.name }) } };
  box.notes = notes;
  return box;
}
function run(names, box, after) {
  vm.createContext(box);
  vm.runInContext(WS_NOTE + '\n' + names.map((n) => (after ? grab(WS, n) : original(grab(WS, n)))).join('\n'), box);
  return box;
}
const boom = (log, name) => function () { log.push(name); throw new TypeError('架空の失敗'); };

(async () => {
  console.log('\n— 1. 置き換えた catch: 記録するだけで、続きの動きは前と同じ —');
  {
    const missing = SITES.filter(([fn, w, v]) => grab(WS, fn).split(siteText(w, v)).length !== 2);
    t('16か所とも、その関数の中で wsNote_(場所, 捕まえた例外) を1回だけ呼ぶ', missing.length === 0, missing);
    const dup = SITES.filter(([, w]) => WS.split("wsNote_('" + w + "'").length !== 2);
    t('場所の名前は画面の中で1つずつ（ほかの catch と区別できる）', dup.length === 0, dup);
    t('場所の名前は短い英字（日付・キー・名前を入れない）', SITES.every(([, w]) => /^[A-Za-z][A-Za-z.]{1,30}$/.test(w)), SITES.map((s) => s[1]));
  }

  /* flushAll_: 4つの送り・保存がすべて例外でも、4つとも試し、タイマーを片付ける */
  for (const mode of ['throw', 'ok']) {
    const res = {};
    for (const after of [false, true]) {
      const log = [];
      const f = (n) => (mode === 'throw' ? boom(log, n) : function () { log.push(n); });
      const box = run(['flushAll_'], noteBox({ saveTimer: 1, pushDayTimer: 2, pushCareTimer: 3, clearTimeout: (x) => log.push('clear' + x),
        doSave: f('doSave'), altPushNow_: f('altPushNow_'), pushDayNow: f('pushDayNow'), pushCareNow: f('pushCareNow') }), after);
      let threw = null;
      try { box.flushAll_(); } catch (e) { threw = e; }
      res[after] = { log, threw, timers: [box.saveTimer, box.pushDayTimer, box.pushCareTimer], notes: box.notes };
    }
    t('flushAll_（' + mode + '）: 呼ぶ順・タイマーの片付け・例外を外に出さないことが前と同じ',
      JSON.stringify(res[true].log) === JSON.stringify(res[false].log) && JSON.stringify(res[true].timers) === JSON.stringify(res[false].timers) &&
      res[true].threw === null && res[false].threw === null, { before: res[false].log, after: res[true].log });
    if (mode === 'throw') {
      t('flushAll_: 4つの失敗をそれぞれの場所で記録する（種類は「保存・同期の失敗」・例外の名前つき）',
        JSON.stringify(res[true].notes.map((n) => n.where)) === JSON.stringify(['ws:flushAll.save', 'ws:flushAll.alt', 'ws:flushAll.day', 'ws:flushAll.care'])
        && res[true].notes.every((n) => n.kind === '保存・同期の失敗' && n.name === 'TypeError'), res[true].notes);
    } else {
      t('flushAll_: 失敗が無ければ何も記録しない', res[true].notes.length === 0, res[true].notes);
    }
  }
  {
    const box = run(['flushAll_'], noteBox({ saveTimer: 1, pushDayTimer: 0, pushCareTimer: 0, clearTimeout() {}, doSave: boom([], 'x'), altPushNow_() {} }, false), true);
    let threw = null;
    try { box.flushAll_(); } catch (e) { threw = e; }
    t('su-errors.js が無い端末（SUErrors 無し）でも例外を外に出さない', threw === null, String(threw));
  }

  /* pushDayNow: 案を表示中に返ってきた成功で端末の控えに書けない／時間切れの確かめが例外、でも後の処理は前と同じ */
  async function runDay(after, opt) {
    const calls = [];
    const rec = (name) => function () { calls.push(name); };
    const day = { meta: { date: '2026-10-10', rev: 5 }, staff: [{ name: '架空 職員' }], tasks: [] };
    let cb = null;
    const box = noteBox({
      ui: { altId: null }, syncOn: () => true, dayPushBusy_: false, dayPushAgain_: false, lastPushed: {}, unlockForceDates_: {}, conflictN_: {},
      store: { get: () => day, dispatch: rec('dispatch') }, daySig: () => 'SIG', dayKey: (d) => 'wsday_' + d,
      isRefetchHeld_: () => false, staffWipeBlocked_: () => false,
      notePush_: (d, kind) => calls.push('notePush:' + kind), markDayDirty_: rec('markDayDirty'), clearDayDirty_: rec('clearDayDirty'),
      clearSeeded_: rec('clearSeeded'), updateSyncBadge_: rec('badge'), saveBase_: rec('saveBase'), setSyncState: (s) => calls.push('state:' + s.slice(0, 3)),
      pad2: (n) => ('0' + n).slice(-2), noteSyncSuccess_: rec('syncSuccess'), showOfflineIfPersistent_: rec('offline'), scheduleRetry_: rec('retry'),
      failReason_: (e) => String(e || ''), friendlyErr: (e) => String(e || ''), unlockIntentSet_: rec('unlockIntent'),
      verifyPutLanded_: opt.verifyThrows ? boom(calls, 'verify') : rec('verify'),
      loadDayData: () => ({ meta: { date: '2026-10-10', rev: 5 }, staff: [], tasks: [] }),
      lsSetDay_: opt.lsThrows ? boom(calls, 'lsSetDay') : rec('lsSetDay'),
      handleLockedReject_: rec('locked'), handleDayConflict_: rec('conflict'), schedulePushDay: rec('again'),
      $: () => ({ set textContent(v) { calls.push('result:' + v.slice(0, 4)); } }),
      isAuthBlockErr_: () => false, noteAuthBlock_: rec('authBlock'), authBlockText_: String,
      gas: (p, c) => { calls.push('gas:' + p.action); cb = c; }
    });
    run(['pushDayNow'], box, after);
    let ret = box.pushDayNow(true);
    if (opt.altDuring) box.ui.altId = 'aaaa1111';   /* 送っている間に案を開いた */
    let threw = null;
    try { cb(opt.reply); } catch (e) { threw = e; }
    await settle(2);
    return { calls, ret, threw, notes: box.notes, busy: box.dayPushBusy_ };
  }
  for (const [label, opt, where] of [
    ['案を表示中に成功が返り、本番の端末の控えに版を書けない', { altDuring: true, lsThrows: true, reply: { ok: true, rev: 6 } }, 'ws:pushDay.altRev'],
    ['時間切れ（応答なし）で、届いたかの確かめが例外', { verifyThrows: true, reply: null }, 'ws:pushDay.verify']
  ]) {
    const b = await runDay(false, opt), a = await runDay(true, opt);
    t('pushDayNow: ' + label + ' — 後の処理・戻り値・例外を外に出さないことが前と同じ',
      JSON.stringify(a.calls) === JSON.stringify(b.calls) && a.ret === b.ret && a.threw === null && b.threw === null && a.busy === b.busy,
      { before: b.calls, after: a.calls });
    t('pushDayNow: ' + label + ' — ' + where + ' に記録する', a.notes.length === 1 && a.notes[0].where === where && b.notes.length === 0, a.notes);
  }

  /* verifyPutLanded_: 届いていた時の後始末の3か所が例外でも、成功の知らせ・トーストまで進む */
  async function runVerify(after, cur) {
    const calls = [];
    const rec = (name) => function () { calls.push(name); };
    const box = noteBox({
      syncOn: () => true, net: { lastFailKind: 'timeout' }, verifyBusy_: {}, dayKey: (d) => 'wsday_' + d, daySig: () => 'SIG',
      lastPushed: {}, conflictN_: {}, saveBase_: rec('saveBase'), clearDayDirty_: rec('clearDayDirty'),
      ui: { currentDate: cur ? '2026-10-10' : '2026-10-11', altId: null },
      store: { get: () => ({ meta: { date: '2026-10-10' } }), dispatch: boom(calls, 'dispatch') },
      loadDayData: () => ({ meta: { date: '2026-10-10' } }), lsSetDay_: boom(calls, 'lsSetDay'),
      clearSeeded_: boom(calls, 'clearSeeded'), unlockIntentSet_: rec('unlockIntent'),
      notePush_: (d, k) => calls.push('notePush:' + k), noteSyncSuccess_: rec('syncSuccess'), toast: rec('toast'),
      gas: (p, c) => { calls.push('gas:' + p.action); c({ ok: true, rev: 9, data: { meta: {} } }); }
    });
    run(['verifyPutLanded_'], box, after);
    let threw = null;
    try { box.verifyPutLanded_('2026-10-10', 'SIG'); } catch (e) { threw = e; }
    return { calls, threw, notes: box.notes.map((n) => n.where) };
  }
  for (const cur of [true, false]) {
    const b = await runVerify(false, cur), a = await runVerify(true, cur);
    t('verifyPutLanded_（' + (cur ? '開いている日' : '開いていない日') + '）: 後の処理が前と同じ・例外を外に出さない',
      JSON.stringify(a.calls) === JSON.stringify(b.calls) && a.threw === null && b.threw === null && a.calls.indexOf('toast') > 0, { before: b.calls, after: a.calls });
    t('verifyPutLanded_（' + (cur ? '開いている日' : '開いていない日') + '）: 場所ごとに記録する',
      JSON.stringify(a.notes) === JSON.stringify(cur ? ['ws:verify.meta', 'ws:verify.after'] : ['ws:verify.ls', 'ws:verify.after']), a.notes);
  }

  /* 小さな補助: 戻り値と後の処理が前と同じ */
  async function both(names, mk, call) {
    const out = {};
    for (const after of [false, true]) {
      const log = [];
      const box = run(names, noteBox(mk(log)), after);
      let ret, threw = null;
      try { ret = await call(box, log); } catch (e) { threw = e; }
      out[after] = { log, ret: JSON.stringify(ret), threw, notes: box.notes.map((n) => n.where) };
    }
    return out;
  }
  const same = (r) => JSON.stringify(r[true].log) === JSON.stringify(r[false].log) && r[true].ret === r[false].ret && r[true].threw === null && r[false].threw === null;
  {
    const r = await both(['unlockIntentSet_', 'unlockIntentGet_'], (log) => ({ UNLOCK_LS: 'k', localStorage: { getItem: () => '{}', setItem: boom(log, 'setItem') } }),
      (b) => b.unlockIntentSet_('2026-10-10', true));
    t('unlockIntentSet_: 端末に書けなくても戻り値・後の処理が前と同じ', same(r), r);
    t('unlockIntentSet_: ws:unlockIntent に記録する', JSON.stringify(r[true].notes) === '["ws:unlockIntent"]', r[true].notes);
  }
  {
    const r = await both(['pushCareNow'], (log) => ({ carePushQueued_: true, carePushBusy_: false, syncOn: () => true, CARE_KEY: 'care_schedule_v2',
      localStorage: { getItem: boom(log, 'getItem') }, gas: () => log.push('gas') }), (b) => [b.pushCareNow(), b.carePushBusy_, b.carePushQueued_]);
    t('pushCareNow: 端末の控えを読めない時は前と同じく送らずに戻る', same(r) && r[true].log.indexOf('gas') < 0, r);
    t('pushCareNow: ws:pushCare.read に記録する', JSON.stringify(r[true].notes) === '["ws:pushCare.read"]', r[true].notes);
  }
  {
    const r = await both(['withAppVer_'], (log) => ({ WS_APP_VER: 'v-test', ui: { currentDate: '2026-10-10' }, dayKey: (d) => 'wsday_' + d,
      window: null }), (b) => { b.window.SUKv = { marksOnlyFor: boom([], 'marksOnlyFor') }; return b.withAppVer_({ meta: { date: '2026-10-10', rev: 3 }, tasks: [] }); });
    t('withAppVer_: 送り先の判定が例外でも、前と同じく版の印を付けた写しを返す', same(r) && /"appVer":"v-test"/.test(r[true].ret), r);
    t('withAppVer_: ws:appVer に記録する', JSON.stringify(r[true].notes) === '["ws:appVer"]', r[true].notes);
  }
  {
    const r = await both(['gas'], (log) => ({ getInFlight_: {}, noteSyncResult_: boom(log, 'noteSyncResult'),
      gasCall: (p, cb) => { log.push('call:' + p.action); cb({ ok: true }); } }), (b, log) => {
      b.gas({ action: 'get', key: 'wsday_2026-10-10' }, (j) => log.push('cb:' + !!(j && j.ok)));
      return null;
    });
    t('gas: 同期の結果の控えが例外でも、呼び出し元への応答は前と同じ', same(r) && r[true].log.indexOf('cb:true') > 0, r);
    t('gas: ws:gas.syncResult に記録する', JSON.stringify(r[true].notes) === '["ws:gas.syncResult"]', r[true].notes);
  }
  {
    const r = await both(['noteSyncSuccess_'], (log) => ({ syncOn: () => true, dirtyDayList_: () => ['2026-10-10'], refetchList_: () => [],
      loadCareOps_: () => ({ ops: [] }), masterUnsent_: () => false, scheduleRetry_: boom(log, 'retry'), clearRetry_: () => log.push('clearRetry'),
      pad2: (n) => ('0' + n).slice(-2), $: () => ({ get textContent() { log.push('read'); return '⚠ x'; }, set textContent(v) { log.push('write'); } }) }),
      (b) => b.noteSyncSuccess_());
    t('noteSyncSuccess_: 回収の予約が例外でも、表示の戻しまで前と同じ', same(r) && r[true].log.indexOf('write') > 0, r);
    t('noteSyncSuccess_: ws:syncOk.retry に記録する', JSON.stringify(r[true].notes) === '["ws:syncOk.retry"]', r[true].notes);
  }
  {
    const r = await both(['schedulePushDay'], (log) => ({ ui: { altId: null }, store: { get: () => ({ meta: { date: '2026-10-10' } }) },
      seededUntouched_: boom(log, 'seeded'), releaseRefetchIfEdited_: () => log.push('release'), syncOn: () => true, isRefetchHeld_: () => false,
      daySig: () => 'A', lastPushed: { day: 'B' }, markDayDirty_: () => log.push('dirty'), noteHumanEdit_: () => log.push('human'),
      pushDayTimer: null, clearTimeout() {}, setTimeout: () => { log.push('timer'); return 7; } }), (b) => [b.schedulePushDay(), b.pushDayTimer]);
    t('schedulePushDay: 仮の盤面の印の片付けが例外でも、送る予約まで前と同じ', same(r) && r[true].log.indexOf('timer') > 0, r);
    t('schedulePushDay: ws:schedulePush.seeded に記録する', JSON.stringify(r[true].notes) === '["ws:schedulePush.seeded"]', r[true].notes);
  }
  {
    const r = await both(['altClient_'], (log) => {
      let n = 0;
      const timers = [];
      return { timers, setTimeout: (fn) => { timers.push(fn); return timers.length; },
        window: null, _client: () => { n++; log.push('client' + n); if (n === 1) throw new TypeError('架空'); return { id: 'c' }; } };
    }, async (b) => {
      b.window.SUAuth = { client: b._client };
      const p = b.altClient_();
      while (b.timers.length) b.timers.shift()();
      return p;
    });
    t('altClient_: ログインの部品が1回例外でも、前と同じく待って次の回に受け取る', same(r) && r[true].ret === '{"id":"c"}', r);
    t('altClient_: ws:altClient に記録する', JSON.stringify(r[true].notes) === '["ws:altClient"]', r[true].notes);
  }

  console.log('\n— 2. 数える部品（su-errors.js → su-perf.js）—');
  function bootPerf(opt) {
    opt = opt || {};
    const rows = new Map();
    const silentStore = {
      get(k) { const req = {}; Promise.resolve().then(() => { req.result = rows.has(k) ? JSON.parse(JSON.stringify(rows.get(k))) : undefined; req.onsuccess && req.onsuccess(); }); return req; },
      put(v) { rows.set(v.k, JSON.parse(JSON.stringify(v))); }
    };
    const viewStore = { put() {}, count() { return {}; } };
    const created = [];
    const db = {
      objectStoreNames: { contains: (n) => created.indexOf(n) >= 0 },
      createObjectStore: (n) => { created.push(n); },
      transaction: (n) => ({ objectStore: (m) => (m === 'silent' ? silentStore : viewStore) })
    };
    let openVer = null;
    const warn = [];
    const ctx = {
      console: { warn: (m) => warn.push(m), error() {}, log() {} },
      localStorage: { getItem: () => null },
      performance: { now: () => 0, getEntriesByType: () => [] },
      indexedDB: { open(name, ver) { openVer = ver; const req = { result: db }; Promise.resolve().then(() => { req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); }); return req; } },
      location: { origin: 'https://tools.example.test', pathname: '/' + (opt.app || 'work-schedule.html') },
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 },
      document: { readyState: 'loading', visibilityState: 'visible', addEventListener() {}, body: { appendChild() {} }, head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, remove() {} }), querySelector: () => null },
      addEventListener() {}, setTimeout: () => 1, clearTimeout() {}, Date: opt.Date || Date, URL
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    if (!opt.noErrors) vm.runInContext(SRC_ERR, ctx, { filename: 'su-errors.js' });
    vm.runInContext(SRC_PERF, ctx, { filename: 'su-perf.js' });
    return { ctx, rows, created, warn, get openVer() { return openVer; } };
  }
  {
    let clock = Date.UTC(2026, 9, 27, 1, 0, 0);
    class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
    const P = bootPerf({ Date: FakeDate });
    const E = P.ctx.SUErrors;
    const NAME_LIKE = '甲山 乙子';   /* 氏名らしい値（架空）を例外の文と種類に入れて流す */
    const err = (msg) => { const e = new Error(msg); e.name = 'QuotaExceededError'; return e; };
    E.note('保存・同期の失敗', err('"' + NAME_LIKE + '" 101号'), 'ws:flushAll.save');
    clock += 31000;
    E.note('保存・同期の失敗', err('"' + NAME_LIKE + '" 101号'), 'ws:flushAll.save');
    E.note('保存・同期の失敗', err('x'), 'ws:flushAll.save');            /* 文が違う＝別の組み合わせとして su-errors が通す */
    E.note(NAME_LIKE, err('y'), 'ws:pushDay.verify');
    E.note('保存・同期の失敗', err('z'), 'ws:日の保存');                 /* 既存の日本語の場所の名前はそのまま数える */
    E.note('保存・同期の失敗', err('w'), 'ws:' + NAME_LIKE);              /* 空白の入った場所は「その他」 */
    E.note('保存・同期の失敗', err('v'), 'Unexpected token "{" at 3');
    E.note('保存・同期の失敗', err('x'), 'ws:flushAll.save');               /* 30秒以内の同じ組み合わせ＝間引かれて数えない */
    E.report('スクリプトエラー', err('r'), 'work-schedule.html:10');   /* report は数えない */
    await settle(30);
    const all = [...P.rows.values()];
    const by = (w) => all.find((r) => r.where === w) || null;
    t('IndexedDB su_perf を版 2 で開き、入れ物 silent を足す', P.openVer === 2 && P.created.indexOf('silent') >= 0 && P.created.indexOf('views') >= 0, { v: P.openVer, c: P.created });
    t('場所ごとに数える（同じ場所の別の失敗は足す・30秒以内の同じ組み合わせは数えない）',
      by('ws:flushAll.save') && by('ws:flushAll.save').n === 3 && by('ws:pushDay.verify') && by('ws:pushDay.verify').n === 1, all);
    t('最後の時刻を残す', by('ws:flushAll.save').last === clock, by('ws:flushAll.save'));
    t('既存の日本語の場所の名前はそのまま・空白や引用符の入った場所は「その他」にまとめる',
      by('ws:日の保存') && by('ws:日の保存').n === 1 && by('その他') && by('その他').n === 2 && !by('ws:' + NAME_LIKE), all.map((r) => r.where));
    t('report（帯を出す方）は数えない', !all.some((r) => /work-schedule\.html:10/.test(r.where)) && all.reduce((s, r) => s + r.n, 0) === 7, all);
    t('記録の項目は k・app・where・n・last だけ（例外の文・種類を残さない）',
      all.every((r) => Object.keys(r).sort().join() === 'app,k,last,n,where') && all.every((r) => r.app === 'work-schedule.html' && r.k === r.app + '|' + r.where), all);
    t('氏名らしい値・例外の文が記録に残らない', !JSON.stringify(all).includes('乙子') && !JSON.stringify(all).includes('101') && !JSON.stringify(all).includes('Quota'), all);
    t('画面に帯・トーストを出さない（note は console.warn だけ）', P.warn.length > 0, P.warn.length);
  }
  {
    const P = bootPerf({ noErrors: true });
    t('su-errors.js が無い画面でも su-perf.js は読み込める（数えないだけ）', !!P.ctx.SUPerf && typeof P.ctx.SUPerf.ready === 'function', null);
  }
  {
    const B = SRC_PERF.indexOf('/* SILENT_PURE_BEGIN'), E2 = SRC_PERF.indexOf('/* SILENT_PURE_END */');
    const box = {};
    vm.createContext(box);
    vm.runInContext(SRC_PERF.slice(B, E2) + '\nthis.F = { silentWhere, silentBump };', box);
    const F = box.F;
    t('場所の名前の決まり: 英字の名前・画面:処理 は残し、空白・引用符・区切り・49字以上・文字列でないものは「その他」',
      F.silentWhere('ws:flushAll.save') === 'ws:flushAll.save' && F.silentWhere('index.html') === 'index.html' && F.silentWhere('care-meeting:保存') === 'care-meeting:保存'
      && ['ws:a b', 'ws:"x"', "ws:'x'", 'ws:a:b', 'ws:a/b', 'x'.repeat(49), '', null, 12, 'a b'].every((w) => F.silentWhere(w) === 'その他'), null);
    const r1 = F.silentBump({ k: 'old', n: 4, last: 1, brief: '架空の文', extra: 1 }, 'a.html', 'ws:x', 99);
    t('1回分を足す時、前の記録のほかの項目を引き継がない', JSON.stringify(r1) === JSON.stringify({ k: 'a.html|ws:x', app: 'a.html', where: 'ws:x', n: 5, last: 99 }), r1);
    t('壊れた回数は0から数え直す', F.silentBump({ n: 'x' }, 'a', 'b', 1).n === 1 && F.silentBump(null, 'a', 'b', 1).n === 1 && F.silentBump({ n: -3 }, 'a', 'b', 1).n === 1, null);
  }
  {
    const hook = SRC_ERR.match(/hooks\[i\]\(kind, brief, where(, 'note')?\)/g) || [];
    t('su-errors.js: note の時だけ記録先に4つ目の \'note\' を渡し、report の時は渡さない',
      hook.length === 2 && hook.filter((h) => /'note'/.test(h)).length === 1 && /fn\(recentNotes\[j\]\[0\], recentNotes\[j\]\[1\], recentNotes\[j\]\[2\], 'note'\)/.test(SRC_ERR)
      && /fn\(recent\[i\]\[0\], recent\[i\]\[1\], recent\[i\]\[2\]\)/.test(SRC_ERR), hook);
  }

  console.log('\n— 3. perf-report.js の表の組み立て —');
  {
    const B = SRC_REPORT.indexOf('/* SILENT_REPORT_BEGIN'), E2 = SRC_REPORT.indexOf('/* SILENT_REPORT_END */');
    const box = { Date, Object, Array, Math, String, isFinite };
    vm.createContext(box);
    vm.runInContext(SRC_REPORT.slice(B, E2) + '\nthis.F = { silentRows, silentTime };', box);
    const F = box.F;
    const at = Date.UTC(2026, 9, 27, 0, 5);   /* 日本時間 10/27 09:05 */
    const rows = F.silentRows([
      { k: 'work-schedule.html|ws:flushAll.save', app: 'work-schedule.html', where: 'ws:flushAll.save', n: 2, last: at },
      { k: 'work-schedule.html|ws:altClient', app: 'work-schedule.html', where: 'ws:altClient', n: 5, last: at - 60000 },
      { k: 'care-schedule.html|care:x', app: 'care-schedule.html', where: 'care:x', n: 1, last: at },
      { app: 'work-schedule.html', where: 'ws:bad', n: 'x' }, null, { app: 1 },
      { k: 'z.html|__proto__', app: '__proto__', where: '__proto__', n: 1, last: null }
    ], { 'work-schedule.html': 'ワークスケジュール', 'care-schedule.html': '週間計画' });
    t('行は [アプリ, 場所, 回数, 最後の時刻]。アプリの名前順・回数の多い順。形の合わない記録は飛ばす',
      JSON.stringify(rows) === JSON.stringify([
        ['__proto__', '__proto__', '1', '—'],
        ['ワークスケジュール', 'ws:altClient', '5', '10/27 09:04'],
        ['ワークスケジュール', 'ws:flushAll.save', '2', '10/27 09:05'],
        ['週間計画', 'care:x', '1', '10/27 09:05']
      ]), rows);
    t('記録が無い・配列でない時は空', F.silentRows([], {}).length === 0 && F.silentRows(null, {}).length === 0, null);
    t('表は textContent で入れる（innerHTML を使わない）・「この端末の記録を消す」は silent も消す・版 2 で開く',
      /function renderSilent\(\) \{[\s\S]*?c\.textContent = text;[\s\S]*?\n  \}/.test(SRC_REPORT) && !/function renderSilent\(\) \{[^]*?innerHTML[^]*?\n  \}/.test(SRC_REPORT.slice(SRC_REPORT.indexOf('function renderSilent'), SRC_REPORT.indexOf('function kpi')))
      && /names\.push\(SILENT\)/.test(SRC_REPORT) && /indexedDB\.open\(DB, DB_VER\)/.test(SRC_REPORT) && /DB_VER = 2/.test(SRC_REPORT), null);
    const html = read('perf-report.html');
    t('perf-report.html に表（tSilent）と、間引いた分は数えない旨の説明がある',
      /<table id="tSilent"><\/table>/.test(html) && /30秒に1回しか数えていない/.test(html) && /黙って失敗した回数（この端末）/.test(html), null);
  }

  console.log('\n— 4. 空の catch の数 —');
  {
    const now = countEmpty(WS), before = countEmpty(original(WS));
    t('置き換えた数＋残った数＝元の数（' + SITES.length + ' ＋ ' + now + ' ＝ ' + before + '）', before === now + SITES.length, { now, before });
    /* 置き換えた関数の中に残した空の catch＝表示だけ（同期の表示・保存の表示の書き換え）・送らない読み込みの整形 */
    const KEEP = {
      flushAll_: [], pushDayNow: ['updateSyncBadge_(); } catch (eSb0) {}', 'updateSyncBadge_(); } catch (eSb1) {}'],
      pushCareNow: ['updateSyncBadge_(); } catch (eSb) {}'], altClient_: [], gas: ['riders[k](copies[k]); } catch (eR) {}'], withAppVer_: [], unlockIntentSet_: [],
      noteSyncSuccess_: [], verifyPutLanded_: [], schedulePushDay: []
    };
    const left = {};
    Object.keys(KEEP).forEach((fn) => { left[fn] = (grab(WS, fn).match(EMPTY_RE) || []).length; });
    const want = {};
    Object.keys(KEEP).forEach((fn) => { want[fn] = KEEP[fn].length + (fn === 'noteSyncSuccess_' ? 1 : 0); });   /* noteSyncSuccess_ の最後は表示（✓同期）の書き換え */
    t('置き換えた関数に残した空の catch は、表示だけのもの（決まった一覧）', JSON.stringify(left) === JSON.stringify(want)
      && Object.keys(KEEP).every((fn) => KEEP[fn].every((s) => grab(WS, fn).indexOf(s) >= 0)), { left, want });
    t('altPushNow_・pushDayNow・flushAll_ の中に空の catch が残っていない（表示の2つを除く）',
      (grab(WS, 'altPushNow_').match(EMPTY_RE) || []).length === 0 && left.flushAll_ === 0 && left.pushDayNow === 2, null);
  }

  console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : e)); process.exit(1); });
