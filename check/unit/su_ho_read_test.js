/* 申送ビューアの出来事・バイタル・食事量を新しい保存先の写しから読む入口（su-ho-read.js・SUHoRead）の試験（2026-11-05 新設）
   実行: node check/unit/su_ho_read_test.js
   対象を差し替える: HO_READ_JS=/tmp/変異版.js MSK_HTML=/tmp/変異版.html node check/unit/su_ho_read_test.js

   守ること（代表者の決定 2026-11-05 案C・段1）:
     A スイッチ moushi_read が切・無い・終わりの時刻を過ぎた時は、Google へ送る関数をそのまま呼ぶ（データベースもログインも見ない）
     B 現場の端末・ログインなし・現場のアカウント・ログインの確かめの失敗は Google
     C 入（事務所PC・事務所/管理者）の時は ho_events / ho_measures の答えを返し、Google を呼ばない
     D 失敗（通信・データベースの断り・42501）・ok:false（写しが古い）・形の違いは Google へ戻す
     E ping・ほかの読み取りは、スイッチが入でも常に Google
     F 要約を出す時（events に noLedger が付かない）・知らない引数が付いた時は Google
     G 画面（moushiokuri-viewer.html の apiRead）: 入口を通っても通らなくても、GAS へ送る形（POST・text/plain・redirect follow・本文）は同じ
       ／送り直しは今までどおり／入口から戻った呼び出しは入口を2回通らない
     H 端末に保存しない（localStorage へ書かない）・例外を外に出さない
     J ケアログの道（スイッチ moushi_carelog・2026-11-07 段2の準備）: 入（事務所PC・事務所/管理者）なら ho_events_cl / ho_measures_cl を読む
       （moushi_read より先）。読めない時（通信・断り・写しが古い・形の違い・ログインなし・使えないアカウント・確かめの失敗）は Google へ戻さず
       失敗にし、画面は「読み込めませんでした。…」と出す。現場の端末・現場のアカウント・42501 は今までどおり Google。切・終わりの時刻を過ぎた時は
       今までの道。控えでケアログの道が入なのに確かめていない時は su-backend.json を読み直してから決める（Google から読まない）
     L 接続先・合言葉の無い端末（代表者の決定 2026-11-08「端末ごとの設定を極限までなくす」段1）: liveReady はスイッチ（自分で読んだ値）・
       現場の端末でない・事務所/管理者のログインの3つがそろう時だけ真・時間切れ（8秒）と分からない時は偽・端末に書かない。
       画面は接続先が無い時 noGas を付け、写しの道もスイッチを確かめてから読む（Google へは送らない）。読めない時は今までの断り。
       起動は確かめてから1回だけ進み、使える時だけ帯と初回の案内を止める。ping・排泄は今までどおり接続先がある時だけ
   ★架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.HO_READ_JS || path.join(ROOT, 'su-ho-read.js'), 'utf8');
const HTML = fs.readFileSync(process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });

const ON = { supabase: { moushi_read: true } };
const OFF = { supabase: { moushi_read: false } };
const EV_OK = { ok: true, from: '2026-10-01', to: '2026-10-03',
  events: [{ key: 'k1', date: '2026-10-01', facility: '見本', shift: '日勤', row: 3, name: '見本 甲', kind: '体調', time: '10:00', body: '見本の記録', reporter: '見本' }],
  ingestedDates: ['2026-10-01', '2026-10-02'], lastTick: '', lastFails: '' };
const MS_OK = { ok: true, from: '2026-10-01', to: '2026-10-03',
  vitals: [{ date: '2026-10-01', name: '見本 甲', room: '101', tab: '', temp: 36.5, sysBP: 120, diaBP: 70, pulse: 70, spo2: 98, flags: '' }],
  meals: [{ date: '2026-10-01', name: '見本 甲', room: '101', bMain: 10, bSide: 10, lMain: 8, lSide: 8, dMain: 10, dSide: 9, flags: '' }],
  vitalDates: ['2026-10-01'], mealDates: ['2026-10-01'], thresholdNotes: '', lastTick: '', lastFails: '' };
const STALE = { ok: false, error: 'サーバーで処理できませんでした。時間をおいてもう一度お試しください' };

/* o: { flags, role, auth: {status, role} | 'throw' | null, rpc: (name,args)=>結果, noFetch } */
function load(o) {
  o = o || {};
  const writes = [], rpcs = [], notes = [];
  const store = { su_backend_flags: o.flags === undefined ? null : JSON.stringify(o.flags) };
  if (o.role) store.su_device_role = o.role;
  const win = {};
  const ctx = {
    window: win, JSON, Object, Array, String, Number, Math, Error, Promise, Date, RegExp, isFinite,
    setTimeout: o.fastTimers ? (f, ms) => setTimeout(f, ms >= 8000 ? 30 : ms) : setTimeout, clearTimeout
  };
  win.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = v; }, removeItem: k => { writes.push(k); } };
  const server = o.flagsJson !== undefined ? o.flagsJson : o.flags;   // 既定では su-backend.json も端末の控えと同じ値
  const counts = { fetch: 0, check: 0, script: 0 };
  win.fetch = () => { counts.fetch++; return server !== undefined ? Promise.resolve({ ok: true, json: () => Promise.resolve(server) }) : Promise.reject(new Error('no network')); };
  win.SUErrors = { note: (k, e, w) => notes.push(w) };
  if (o.auth !== null) {
    const a = o.auth || { status: 'ok', role: 'office' };
    win.SUAuth = {
      STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out' },
      check: () => { counts.check++; if (a === 'hang') return new Promise(() => {}); if (a === 'late') return new Promise(ok => setTimeout(() => ok({ status: 'ok', role: 'office' }), 120)); return a === 'throw' ? Promise.reject(new Error('net')) : Promise.resolve(a); },
      client: () => ({ rpc: (name, args) => { rpcs.push({ name, args }); return o.rpc ? o.rpc(name, args) : Promise.resolve({ data: name.indexOf('ho_events') === 0 ? EV_OK : MS_OK, error: null }); } })
    };
  }
  win.document = { getElementsByTagName: () => [], createElement: () => ({}), head: { appendChild: (s) => { counts.script++; setTimeout(() => s.onerror && s.onerror(), 0); } } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  // 入の控えがある時は、画面を開いてから1回 su-backend.json を読んで確かめた後の状態で試す（o.noWarm の時はそのまま）
  const H0 = win.SUHoRead;
  let ready = Promise.resolve();
  if (!o.noWarm && H0 && (H0._flagOn(o.flags, Date.now()) || H0._flagOn(o.flags, Date.now(), 'moushi_carelog'))) ready = H0._refresh();
  const H = o.noWarm ? H0 : Object.assign({}, H0, { call: (a, p, f, x) => ready.then(() => H0.call(a, p, f, x)) });
  return { H, win, writes, rpcs, notes, store, counts };
}
function gas(tag) {
  const g = { n: 0 };
  g.fn = () => { g.n++; return Promise.resolve({ ok: true, from: 'x', to: 'x', events: [], ingestedDates: [], fromGas: tag || true }); };
  return g;
}
const EVP = { from: '2026-10-01', to: '2026-10-03', noLedger: 1 };
const MSP = { from: '2026-10-01', to: '2026-10-03' };

(async () => {
  console.log('— A. スイッチが切・無い・終わりの時刻を過ぎた時は Google');
  for (const [label, flags] of [['切', OFF], ['キーが無い', { supabase: {} }], ['読めない', undefined],
    ['終わりの時刻を過ぎた', { supabase: { moushi_read: true, moushi_read_until: '2020-01-01T00:00:00+09:00' } }],
    ['終わりの時刻が読めない', { supabase: { moushi_read: true, moushi_read_until: '2099-01-01' } }],
    ['true でない値', { supabase: { moushi_read: 'true' } }]]) {
    const L = load({ flags });
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn);
    t('スイッチ' + label + ': Google を1回呼ぶ', g.n === 1 && r.fromGas === true, { n: g.n, r });
    t('スイッチ' + label + ': データベースを呼ばない', L.rpcs.length === 0, L.rpcs);
  }
  {
    const L = load({ flags: { supabase: { moushi_read: true, moushi_read_until: '2099-01-01T00:00:00+09:00' } } });
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn);
    t('終わりの時刻の前なら写しから読む', g.n === 0 && r.events && r.events[0].key === 'k1', r);
  }
  {
    // 端末の控えが切なら、su-backend.json を読みに行かずに Google（スイッチが切の間は通信を1本も増やさない）
    const L = load({ flags: OFF, flagsJson: ON, noWarm: true });
    const g = gas();
    const r = await L.H.call('measures', MSP, g.fn);
    t('控えが切: その場で Google（su-backend.json はページごとに1回だけ裏で読む・待たない）', g.n === 1 && r.fromGas === true && L.counts.fetch <= 1, { n: g.n, f: L.counts.fetch });
  }
  {
    // 控えが入でもまだ確かめていない1回目は Google（裏で読み直す）。読み直して切なら、その後も Google（切に戻した後の古い控えで写しを読まない）
    const L = load({ flags: ON, flagsJson: OFF, noWarm: true });
    const g = gas();
    await L.H.call('events', EVP, g.fn);
    t('控えが入・まだ確かめていない1回目は Google・裏で1本読む', g.n === 1 && L.rpcs.length === 0 && L.counts.fetch === 1, { n: g.n, f: L.counts.fetch });
    await L.H._refresh();
    await L.H.call('events', EVP, g.fn);
    t('su-backend.json が切なら、控えが入でも Google', g.n === 2 && L.rpcs.length === 0, { n: g.n, r: L.rpcs.length });
  }
  {
    // 控えが入で、su-backend.json を読めない（通信の失敗）時は、入と確かめられないので Google
    const L = load({ flags: ON, flagsJson: undefined, noWarm: true });
    L.win.fetch = () => { L.counts.fetch++; return Promise.reject(new Error('no network')); };
    const g = gas();
    await L.H.call('events', EVP, g.fn);
    await L.H._refresh();
    await L.H.call('events', EVP, g.fn);
    t('su-backend.json を読めない間は Google', g.n === 2 && L.rpcs.length === 0, { n: g.n });
  }

  console.log('— B. 現場の端末・ログインなし・現場のアカウントは Google');
  for (const [label, o] of [
    ['現場の端末', { flags: ON, role: 'field' }],
    ['ログインしていない', { flags: ON, auth: { status: 'signed_out' } }],
    ['現場のアカウント', { flags: ON, auth: { status: 'ok', role: 'field' } }],
    ['使えないアカウント', { flags: ON, auth: { status: 'not_allowed', role: 'office' } }],
    ['ログインの確かめが失敗', { flags: ON, auth: 'throw' }],
    ['ログインの部品が無い', { flags: ON, auth: null }]]) {
    const L = load(o);
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn);
    t(label + ': Google を1回呼ぶ', g.n === 1 && r.fromGas === true, { n: g.n });
    t(label + ': データベースを呼ばない', L.rpcs.length === 0, L.rpcs);
  }

  console.log('— C. 入（事務所PC・事務所/管理者）の時は写しの答えを返す');
  for (const role of ['office', 'admin']) {
    const L = load({ flags: ON, auth: { status: 'ok', role } });
    const g = gas();
    const ev = await L.H.call('events', EVP, g.fn);
    const ms = await L.H.call('measures', MSP, g.fn);
    t(role + ': Google を呼ばない', g.n === 0, g.n);
    t(role + ': events は ho_events の答えそのまま', JSON.stringify(ev) === JSON.stringify(EV_OK), ev);
    t(role + ': measures は ho_measures の答えそのまま', JSON.stringify(ms) === JSON.stringify(MS_OK), ms);
    t(role + ': 期間を文字で渡す', L.rpcs.length === 2 && L.rpcs[0].name === 'ho_events' && L.rpcs[0].args.p_from === '2026-10-01' && L.rpcs[0].args.p_to === '2026-10-03'
      && L.rpcs[1].name === 'ho_measures', L.rpcs);
    t(role + ': noLedger の答えに要約（ledger）の欄が無い', !('ledger' in ev), Object.keys(ev));
  }
  {
    const L = load({ flags: ON });
    await L.H.call('events', { from: '', to: null, noLedger: '1' }, gas().fn);
    t('空の期間は null で渡す（GAS も空は送らない）', L.rpcs[0] && L.rpcs[0].args.p_from === null && L.rpcs[0].args.p_to === null, L.rpcs);
  }

  console.log('— D. 失敗・ok:false・形の違いは Google へ戻す');
  const cases = [
    ['データベースの断り', () => Promise.resolve({ data: null, error: { code: 'PGRST500', message: 'x' } }), true],
    ['42501（読めない役割）', () => Promise.resolve({ data: null, error: { code: '42501', message: 'not allowed' } }), false],
    ['通信の失敗', () => Promise.reject(new TypeError('Failed to fetch')), false],
    ['通信の失敗（中身で返る）', () => Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }), false],
    ['rpc がその場で例外', () => { throw new Error('boom'); }, true],
    ['ok:false（写しが2時間を超えて古い）', () => Promise.resolve({ data: STALE, error: null }), false],
    ['events の欄が無い', () => Promise.resolve({ data: { ok: true, from: 'a', to: 'b', ingestedDates: [] }, error: null }), true],
    ['events の行が配列でない', () => Promise.resolve({ data: { ok: true, from: 'a', to: 'b', events: 'x', ingestedDates: [] }, error: null }), true],
    ['events の行に文字が混ざる', () => Promise.resolve({ data: { ok: true, from: 'a', to: 'b', events: ['x'], ingestedDates: [] }, error: null }), true],
    ['from が無い', () => Promise.resolve({ data: { ok: true, to: 'b', events: [], ingestedDates: [] }, error: null }), true],
    ['答えが空', () => Promise.resolve({ data: null, error: null }), true],
    ['答えに error がある', () => Promise.resolve({ data: Object.assign({}, EV_OK, { error: 'x' }), error: null }), true]
  ];
  for (const [label, rpc, noteIt] of cases) {
    const L = load({ flags: ON, rpc });
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn);
    t(label + ': Google を1回呼んでその答えを返す', g.n === 1 && r.fromGas === true, { n: g.n, r });
    t(label + (noteIt ? ': 記録を1件残す' : ': 記録しない（予想どおりの戻り）'), noteIt ? L.notes.length === 1 && /^ho:/.test(L.notes[0]) : L.notes.length === 0, L.notes);
  }
  {
    const L = load({ flags: ON, rpc: () => Promise.resolve({ data: { ok: true, from: 'a', to: 'b', vitals: [], meals: [], vitalDates: [] }, error: null }) });
    const g = gas();
    await L.H.call('measures', MSP, g.fn);
    t('measures の mealDates が無い時は Google', g.n === 1, g.n);
  }
  {
    const L = load({ flags: ON, rpc: () => Promise.resolve({ data: null, error: { code: 'X' } }) });
    const g = gas();
    await L.H.call('events', EVP, g.fn); await L.H.call('events', EVP, g.fn);
    t('同じ理由の記録は1画面1回', L.notes.length === 1 && g.n === 2, L.notes);
  }
  {
    // Google へ戻した時の失敗は、そのまま画面へ返す（今までどおり画面が断りの文を出す）
    const L = load({ flags: ON, rpc: () => Promise.resolve({ data: STALE, error: null }) });
    const r = await L.H.call('events', EVP, () => Promise.reject(new Error('API:認証エラー'))).then(() => 'ok', e => e.message);
    t('戻した先の Google の失敗はそのまま返す', r === 'API:認証エラー', r);
  }

  console.log('— E. ping・ほかの読み取りは常に Google');
  for (const act of ['ping', 'search', 'getDay', '']) {
    const L = load({ flags: ON });
    const g = gas();
    await L.H.call(act, {}, g.fn);
    t(JSON.stringify(act) + ': Google を呼び、データベースを呼ばない', g.n === 1 && L.rpcs.length === 0, { n: g.n, r: L.rpcs });
  }

  console.log('— F. 要約を出す時・知らない引数が付いた時は Google');
  for (const [label, act, p] of [
    ['events に noLedger が無い（要約を出す）', 'events', { from: '2026-10-01', to: '2026-10-03' }],
    ['noLedger が 0', 'events', { from: '2026-10-01', to: '2026-10-03', noLedger: 0 }],
    ['知らない引数（events）', 'events', { from: '2026-10-01', to: '2026-10-03', noLedger: 1, name: 'x' }],
    ['知らない引数（measures）', 'measures', { from: '2026-10-01', since: 'x' }],
    ['引数が文字', 'measures', 'x']]) {
    const L = load({ flags: ON });
    const g = gas();
    await L.H.call(act, p, g.fn);
    t(label + ': Google', g.n === 1 && L.rpcs.length === 0, { n: g.n, r: L.rpcs });
  }
  {
    // 画面の evParams は SHOW_AI_SUMMARY が偽の時だけ noLedger を付ける（要約を出す設定なら付かない＝Google）
    t('画面の evParams は要約を出さない時だけ noLedger を付ける', /function evParams\(o\)\{ if\(!SHOW_AI_SUMMARY\) o\.noLedger = 1; return o; \}/.test(HTML));
  }

  console.log('— G. 画面（apiRead）: GAS へ送る形は入口を通っても同じ');
  {
    function scanBlock(src, from) {
      let depth = 0, seen = false, q = null;
      for (let i = from; i < src.length; i++) {
        const c = src[i], n = src[i + 1], p = src[i - 1];
        if (q) { if (c === q && p !== '\\') q = null; continue; }
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (c === "'" || c === '"' || c === '`') { q = c; continue; }
        if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return i; }
      }
      return -1;
    }
    const grab = (name) => { const s = HTML.indexOf('\nfunction ' + name + '('); return HTML.slice(s, scanBlock(HTML, s) + 1); };
    const code = [HTML.match(/\nvar API_GET_RETRY = [^;]+;/)[0], grab('fetchTO'), grab('parseJson'), grab('apiRead'), grab('apiReadOnce'), grab('mskCfgOk_')].join('\n');
    function box(withHo, answers, flags) {
      const sent = [];
      const sb = {
        JSON, String, Object, Date, Error, Promise, setTimeout, clearTimeout,
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        loadCfg: () => ({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'tok-example' }),
        fetch: (url, opt) => {
          sent.push({ url, method: opt.method, headers: JSON.stringify(opt.headers), redirect: opt.redirect, body: opt.body, keys: Object.keys(opt).sort().join(',') });
          const a = answers.shift();
          return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(a)) });
        }
      };
      vm.createContext(sb);
      vm.runInContext(code, sb);
      let L = null;
      if (withHo) { L = load({ flags }); sb.SUHoRead = L.H; }
      return { sb, sent, L };
    }
    const A = box(false, [{ ok: true, events: [] }, { ok: true, vitals: [] }, { ok: true, pong: 1 }]);
    await A.sb.apiRead('events', { from: '2026-10-01', to: '2026-10-03', noLedger: 1 });
    await A.sb.apiRead('measures', { from: '2026-10-01', to: '2026-10-03' });
    await A.sb.apiRead('ping', {});
    const B = box(true, [{ ok: true, events: [] }, { ok: true, vitals: [] }, { ok: true, pong: 1 }], OFF);
    await B.sb.apiRead('events', { from: '2026-10-01', to: '2026-10-03', noLedger: 1 });
    await B.sb.apiRead('measures', { from: '2026-10-01', to: '2026-10-03' });
    await B.sb.apiRead('ping', {});
    t('入口が無い時と、入口あり（スイッチ切）で GAS へ送った物が1バイトも同じ', A.sent.length === 3 && JSON.stringify(A.sent) === JSON.stringify(B.sent), { a: A.sent, b: B.sent });
    const s0 = A.sent[0];
    t('送り方は POST・text/plain・redirect follow', s0.method === 'POST' && s0.headers === '{"Content-Type":"text/plain;charset=utf-8"}' && s0.redirect === 'follow', s0);
    t('本文は action・期間・noLedger・合言葉（文字）', s0.body === JSON.stringify({ action: 'events', from: '2026-10-01', to: '2026-10-03', noLedger: '1', token: 'tok-example' }), s0.body);

    const C = box(true, [{ ok: true, pong: 1 }], ON);
    const ce = await C.sb.apiRead('events', { from: '2026-10-01', to: '2026-10-03', noLedger: 1 });
    t('スイッチ入（事務所）: events は写しの答え・GAS へ送らない', C.sent.length === 0 && ce.events && ce.events[0].key === 'k1', { sent: C.sent, ce });
    await C.sb.apiRead('ping', {});
    t('スイッチ入でも ping は GAS へ同じ形で送る', C.sent.length === 1 && C.sent[0].body === A.sent[2].body && C.sent[0].headers === A.sent[2].headers, C.sent);

    // 写しが古い（ok:false）→ Google へ戻した時の送り方も同じ
    const D = box(true, [{ ok: true, events: [] }], ON);
    D.L.H._reset();
    const Lstale = load({ flags: ON, rpc: () => Promise.resolve({ data: STALE, error: null }) });
    D.sb.SUHoRead = Lstale.H;
    await D.sb.apiRead('events', { from: '2026-10-01', to: '2026-10-03', noLedger: 1 });
    t('写しが古い時は GAS へ今までと同じ本文・送り方で1回送る', D.sent.length === 1 && JSON.stringify(D.sent[0]) === JSON.stringify(A.sent[0]), D.sent);

    // 送り直し（POST でだけ の断り）は入口を2回通らず、今までどおり最大2回
    const REFUSE = { error: 'この読み取りは POST でだけ受け付けます。もう一度お試しください' };
    let hoCalls = 0;
    const E = box(false, [REFUSE, REFUSE, { ok: true, events: [] }]);
    E.sb.SUHoRead = { call: (a, p, fn) => { hoCalls++; return fn(); } };
    const er = await E.sb.apiRead('events', { from: '2026-10-01', to: '2026-10-03', noLedger: 1 });
    t('送り直しは今までどおり（3回目で読める）', E.sent.length === 3 && er.ok === true, E.sent.length);
    t('送り直しは入口を通らない（入口は1回だけ）', hoCalls === 1, hoCalls);
    t('送り直しの本文は1回目と同じ', E.sent.every(s => s.body === E.sent[0].body), E.sent);
  }
  {
    t('画面は su-ho-read.js を ?v= 付きで1回読む', (HTML.match(/<script src="su-ho-read\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/g) || []).length === 1);
    t('画面は su-errors.js を su-ho-read.js より前に読む', HTML.indexOf('src="su-errors.js') >= 0 && HTML.indexOf('src="su-errors.js') < HTML.indexOf('src="su-ho-read.js'));
    t('画面は SUHoRead が無くても読める（typeof で確かめる）', /typeof SUHoRead !== 'undefined' && SUHoRead && typeof SUHoRead\.call === 'function'/.test(HTML));
  }

  console.log('— H. 端末に保存しない・例外を外に出さない');
  {
    const L = load({ flags: ON });
    await L.H.call('events', EVP, gas().fn);
    await L.H.call('measures', MSP, gas().fn);
    t('localStorage へ書かない', L.writes.length === 0, L.writes);
    const L2 = load({ flags: ON, noWarm: true });   // まだ確かめていない状態で、端末の控えが読めない
    L2.win.localStorage.getItem = () => { throw new Error('blocked'); };
    const g = gas();
    let threw = false;
    try { await L2.H.call('events', EVP, g.fn); } catch (e) { threw = true; }
    t('localStorage が読めなくても例外を出さず Google', !threw && g.n === 1, g.n);
    const L3 = load({ flags: ON, auth: { status: 'ok', role: 'office' } });
    L3.win.SUAuth.client = () => { throw new Error('no client'); };
    const g3 = gas();
    let threw3 = false;
    try { await L3.H.call('events', EVP, g3.fn); } catch (e) { threw3 = true; }
    t('ログインの部品が壊れていても例外を出さず Google', !threw3 && g3.n === 1, g3.n);
    t('部品の中に console.log が無い', SRC.indexOf('console.log') < 0);
  }

  console.log('— I. スイッチを読み直している間も待たない（申送ビューアは読み込みの速さを優先する）');
  {
    // スイッチの読み直しが返ってこない（su-backend.json の取りに時間がかかる）時も、最後に読めた値（切）でその場で Google を呼ぶ
    const L = load({ flags: OFF, noWarm: true });
    L.win.fetch = () => { L.counts.fetch++; return new Promise(() => {}); };
    const g = gas();
    const p = L.H.call('events', EVP, g.fn);
    t('その場で Google を1回呼ぶ', g.n === 1);
    await p;
    await L.H.call('measures', MSP, g.fn);
    t('スイッチが切の間は、ログインの確かめ・部品の読み込みを1回も呼ばない・su-backend.json はページごとに1回だけ',
      L.counts.fetch === 1 && L.counts.check === 0 && L.counts.script === 0 && L.rpcs.length === 0, L.counts);
    // まだ何も読めていない（端末に控えも無い）時は切として扱い、Google から読む
    const L2 = load({ noWarm: true });
    L2.win.fetch = () => new Promise(() => {});
    const g2 = gas();
    L2.H.call('measures', MSP, g2.fn);
    t('スイッチがまだ読めていない時は待たずに Google', g2.n === 1 && L2.rpcs.length === 0);
  }

  console.log('— J. ケアログの道（スイッチ moushi_carelog）');
  const CL = { supabase: { moushi_carelog: true } };
  const CLR = { supabase: { moushi_read: true, moushi_carelog: true } };
  for (const [label, flags] of [['ケアログだけ入', CL], ['写しとケアログの両方が入', CLR]]) {
    for (const role of ['office', 'admin']) {
      const L = load({ flags, auth: { status: 'ok', role } });
      const g = gas();
      const ev = await L.H.call('events', EVP, g.fn);
      const ms = await L.H.call('measures', MSP, g.fn);
      t(label + '・' + role + ': ho_events_cl・ho_measures_cl を呼び、Google を呼ばない', g.n === 0 && L.rpcs.length === 2
        && L.rpcs[0].name === 'ho_events_cl' && L.rpcs[1].name === 'ho_measures_cl', { n: g.n, r: L.rpcs });
      t(label + '・' + role + ': 答えはそのまま・期間は文字で渡す', JSON.stringify(ev) === JSON.stringify(EV_OK) && JSON.stringify(ms) === JSON.stringify(MS_OK)
        && L.rpcs[0].args.p_from === '2026-10-01' && L.rpcs[0].args.p_to === '2026-10-03', L.rpcs);
    }
  }
  for (const [label, o] of [
    ['現場の端末', { flags: CL, role: 'field' }],
    ['現場のアカウント', { flags: CL, auth: { status: 'ok', role: 'field' } }],
    ['42501（読めない役割）', { flags: CL, rpc: () => Promise.resolve({ data: null, error: { code: '42501', message: 'not allowed' } }) }]]) {
    const L = load(o);
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn);
    t('ケアログの道・' + label + ': 今までどおり Google', g.n === 1 && r.fromGas === true && L.notes.length === 0, { n: g.n, notes: L.notes });
  }
  const clFails = [
    ['ログインしていない', null, false, { status: 'signed_out' }],
    ['使えないアカウント', null, false, { status: 'not_allowed', role: 'office' }],
    ['ログインの確かめが失敗', null, true, 'throw'],
    ['データベースの断り', () => Promise.resolve({ data: null, error: { code: 'PGRST500', message: 'x' } }), true],
    ['通信の失敗', () => Promise.reject(new TypeError('Failed to fetch')), false],
    ['通信の失敗（中身で返る）', () => Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }), false],
    ['ok:false（写しが古い）', () => Promise.resolve({ data: STALE, error: null }), true],
    ['形の違い', () => Promise.resolve({ data: { ok: true, from: 'a', to: 'b', ingestedDates: [] }, error: null }), true],
    ['rpc がその場で例外', () => { throw new Error('boom'); }, true]];
  for (const [label, rpc, noteIt, auth] of clFails) {
    const L = load(Object.assign({ flags: CLR }, rpc ? { rpc } : {}, auth ? { auth } : {}));
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn).then(v => ({ ok: v }), e => ({ err: e }));
    t('ケアログの道・' + label + ': Google へ戻さず失敗にする', g.n === 0 && r.err && r.err.name === 'Error' && r.err.message === 'carelog', { n: g.n, r: r.err && r.err.message });
    t('ケアログの道・' + label + (noteIt ? ': 記録を1件残す' : ': 記録しない（通信の失敗）'), noteIt ? L.notes.length === 1 && /^ho:events\.cl\./.test(L.notes[0]) : L.notes.length === 0, L.notes);
  }
  {
    // 終わりの時刻を過ぎたケアログの道は使わない（写しの道が入ならそちら）
    const L = load({ flags: { supabase: { moushi_read: true, moushi_carelog: true, moushi_carelog_until: '2020-01-01T00:00:00+09:00' } } });
    const g = gas();
    await L.H.call('events', EVP, g.fn);
    t('ケアログの道の終わりの時刻を過ぎたら写しの道', g.n === 0 && L.rpcs.length === 1 && L.rpcs[0].name === 'ho_events', L.rpcs);
    const L2 = load({ flags: { supabase: { moushi_carelog: false } } });
    const g2 = gas();
    await L2.H.call('events', EVP, g2.fn);
    t('ケアログの道が切・写しの道も切なら Google（データベースを呼ばない）', g2.n === 1 && L2.rpcs.length === 0, L2.rpcs);
    const L3 = load({ flags: CL });
    const g3 = gas();
    await L3.H.call('events', { from: '2026-10-01', to: '2026-10-03' }, g3.fn);
    await L3.H.call('ping', {}, g3.fn);
    t('ケアログの道でも、要約を出す読み取り・ping は Google', g3.n === 2 && L3.rpcs.length === 0, L3.rpcs);
  }
  {
    // 画面: 失敗は apiErrMsg の今の文（職員向け）になる。GAS へは送らない
    const grabFn = (name) => { const st = HTML.indexOf('\nfunction ' + name + '('); const en = HTML.indexOf('\n}\n', st); return HTML.slice(st, en + 2); };
    const sb = { String, RegExp, SUErrors: { note: () => {} } };
    vm.createContext(sb);
    vm.runInContext(grabFn('apiErrMsg'), sb);
    const L = load({ flags: CLR, rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST500' } }) });
    const g = gas();
    const e = await L.H.call('measures', MSP, g.fn).then(() => null, x => x);
    t('ケアログの道の失敗は、画面で「読み込めませんでした。しばらくしてからもう一度お試しください」になる',
      e && sb.apiErrMsg(e) === '読み込めませんでした。しばらくしてからもう一度お試しください' && g.n === 0, e && sb.apiErrMsg(e));
  }
  {
    const L = load({ flags: CL });
    await L.H.call('events', EVP, gas().fn);
    t('ケアログの道でも localStorage へ書かない', L.writes.length === 0, L.writes);
  }
  {
    // 控えがケアログの道を入と言うが、まだ確かめていない1回目: 読み直してからケアログの道で読む（Google から読まない・反証レビュー 高1）
    const L = load({ flags: CL, noWarm: true });
    const g = gas();
    const r = await L.H.call('events', EVP, g.fn);
    t('控えが入・まだ確かめていない1回目も、読み直してケアログの道（Google を呼ばない）', g.n === 0 && L.rpcs.length === 1 && L.rpcs[0].name === 'ho_events_cl' && r.events, { n: g.n, r: L.rpcs });
    // 読み直したら切だった → Google
    const L2 = load({ flags: CL, flagsJson: { supabase: { moushi_carelog: false } }, noWarm: true });
    const g2 = gas();
    await L2.H.call('events', EVP, g2.fn);
    t('読み直して切なら Google', g2.n === 1 && L2.rpcs.length === 0, L2.rpcs);
    // 控えが空の端末（ほかの画面を開かない事務所PC）でも、ページの最初の読み取りで裏で読んだ後はケアログの道
    const L3 = load({ flagsJson: CL, noWarm: true });
    const g3 = gas();
    await L3.H.call('events', EVP, g3.fn);
    await L3.H._refresh();
    await L3.H.call('events', EVP, g3.fn);
    t('控えが空でも、ページの最初の読み取りで裏で読み、次の読み取りからケアログの道', g3.n === 1 && L3.rpcs.length === 1 && L3.rpcs[0].name === 'ho_events_cl', { n: g3.n, r: L3.rpcs });
  }

  console.log('— L. 接続先・合言葉の無い端末（ログインだけで読む・2026-11-08）');
  {
    const CL = { supabase: { moushi_carelog: true } };
    const okCases = [['ケアログの道が入・事務所', { flagsJson: CL }], ['ケアログの道が入・管理者', { flagsJson: CL, auth: { status: 'ok', role: 'admin' } }],
      ['写しの道だけ入・事務所', { flagsJson: ON }]];
    for (const [label, o] of okCases) {
      const L = load(Object.assign({ noWarm: true }, o));
      const v = await L.H.liveReady();
      t('liveReady 真: ' + label, v === true, v);
      t('liveReady 真: ' + label + '・端末に書かない・データベースは読まない', L.writes.length === 0 && L.rpcs.length === 0, { w: L.writes, r: L.rpcs });
    }
    const ngCases = [
      ['現場の端末', { flagsJson: CL, role: 'field' }],
      ['ログインしていない', { flagsJson: CL, auth: { status: 'signed_out' } }],
      ['現場のアカウント', { flagsJson: CL, auth: { status: 'ok', role: 'field' } }],
      ['使えないアカウント', { flagsJson: CL, auth: { status: 'not_allowed', role: 'office' } }],
      ['ログインの確かめが失敗', { flagsJson: CL, auth: 'throw' }],
      ['ログインの部品が読めない', { flagsJson: CL, auth: null }],
      ['スイッチが両方切', { flagsJson: { supabase: { moushi_read: false, moushi_carelog: false } } }],
      ['スイッチの終わりの時刻を過ぎた', { flagsJson: { supabase: { moushi_carelog: true, moushi_carelog_until: '2020-01-01T00:00:00+09:00' } } }],
      ['su-backend.json が読めない（控えは入）', { flags: CL, flagsJson: undefined, netFail: true }]];
    for (const [label, o] of ngCases) {
      const L = load(Object.assign({ noWarm: true }, o));
      if (o.netFail) L.win.fetch = () => { L.counts.fetch++; return Promise.reject(new Error('no network')); };
      let threw = false, v;
      try { v = await L.H.liveReady(); } catch (e) { threw = true; }
      t('liveReady 偽: ' + label + '（例外を出さない）', v === false && !threw, v);
      t('liveReady 偽: ' + label + '・端末に書かない', L.writes.length === 0, L.writes);
    }
    {
      const L2 = load({ noWarm: true, flagsJson: { supabase: {} } });
      await L2.H.liveReady();
      t('スイッチが切の時はログインの確かめも部品の読み込みも呼ばない', L2.counts.check === 0 && L2.counts.script === 0, L2.counts);
      const L3 = load({ noWarm: true, flagsJson: CL, role: 'field' });
      await L3.H.liveReady();
      t('現場の端末は su-backend.json もログインも確かめない', L3.counts.fetch === 0 && L3.counts.check === 0, L3.counts);
    }
    {
      const L = load({ noWarm: true, flagsJson: CL, auth: 'hang', fastTimers: true });
      const v = await L.H.liveReady();
      t('ログインの確かめが返らない時は時間切れ（8秒）で偽', v === false, v);
      const L2 = load({ noWarm: true, flagsJson: CL, auth: 'late', fastTimers: true });
      const v2 = await L2.H.liveReady();
      await new Promise(r => setTimeout(r, 200));
      t('時間切れの後にログインの答えが届いても偽のまま', v2 === false, v2);
    }
    {
      const L = load({ noWarm: true, flagsJson: CL });
      L.win.SUAuth.check = () => { L.store.su_device_role = 'field'; return Promise.resolve({ status: 'ok', role: 'office' }); };
      t('確かめている間に現場の端末へ変わったら偽', (await L.H.liveReady()) === false);
    }

    // noGas: 接続先の無い端末は、写しの道もスイッチを確かめてから読む
    {
      const L = load({ noWarm: true, flagsJson: ON });
      const g = gas();
      const r = await L.H.call('events', EVP, g.fn, { noGas: true });
      t('noGas・写しの道: まだ確かめていない1回目も読み直して写しから読む（Google を呼ばない）', g.n === 0 && L.rpcs.length === 1 && L.rpcs[0].name === 'ho_events' && !!r.events, { n: g.n, r: L.rpcs });
      const Lb = load({ noWarm: true, flagsJson: ON });
      const gb = gas();
      await Lb.H.call('events', EVP, gb.fn);
      t('noGas が無い時は今までどおり1回目は Google（待たない）', gb.n === 1 && Lb.rpcs.length === 0, { n: gb.n });
      const L2 = load({ noWarm: true, flagsJson: CL });
      const g2 = gas();
      await L2.H.call('measures', MSP, g2.fn, { noGas: true });
      t('noGas・ケアログの道: 読み直してケアログの道', g2.n === 0 && L2.rpcs.length === 1 && L2.rpcs[0].name === 'ho_measures_cl', L2.rpcs);
      const L3 = load({ noWarm: true, flagsJson: OFF });
      const g3 = gas();
      await L3.H.call('events', EVP, g3.fn, { noGas: true });
      t('noGas・スイッチ切: 読み直した後、今までどおり画面の関数（接続先なしの断り）', g3.n === 1 && L3.rpcs.length === 0);
      const L4 = load({ noWarm: true, flagsJson: ON, rpc: () => Promise.resolve({ data: STALE, error: null }) });
      const g4 = gas();
      await L4.H.call('events', EVP, g4.fn, { noGas: true });
      t('noGas・写しが古い: 今までどおり画面の関数へ戻す（画面は接続先なしの断り）', g4.n === 1);
      const L5 = load({ noWarm: true, flagsJson: ON });
      L5.win.fetch = () => { L5.counts.fetch++; return Promise.reject(new Error('no network')); };
      const g5 = gas();
      await L5.H.call('events', EVP, g5.fn, { noGas: true });
      t('noGas・su-backend.json が読めない: 画面の関数・データベースを呼ばない', g5.n === 1 && L5.rpcs.length === 0);
      const L6 = load({ noWarm: true, flagsJson: ON });
      const g6 = gas();
      await L6.H.call('ping', {}, g6.fn, { noGas: true });
      t('noGas でも ping は画面の関数（今までどおり）', g6.n === 1 && L6.rpcs.length === 0);
      const L7 = load({ noWarm: true, flagsJson: ON, role: 'field' });
      const g7 = gas();
      await L7.H.call('events', EVP, g7.fn, { noGas: true });
      t('noGas でも現場の端末はデータベースを読まない', g7.n === 1 && L7.rpcs.length === 0);
      const L8 = load({ noWarm: true, flagsJson: CL });
      await L8.H.call('events', EVP, gas().fn, { noGas: true });
      t('noGas でも localStorage へ書かない', L8.writes.length === 0, L8.writes);
    }

    // 画面: 接続先の無い端末の apiRead は noGas を付け、新しい保存先だけへ届く
    {
      function scanBlock(src, from) {
        let depth = 0, seen = false, q = null;
        for (let i = from; i < src.length; i++) {
          const c = src[i], n = src[i + 1], p = src[i - 1];
          if (q) { if (c === q && p !== '\\') q = null; continue; }
          if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
          if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
          if (c === "'" || c === '"' || c === '`') { q = c; continue; }
          if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return i; }
        }
        return -1;
      }
      const grab = (name) => { const s = HTML.indexOf('\nfunction ' + name + '('); return HTML.slice(s, scanBlock(HTML, s) + 1); };
      const code = [HTML.match(/\nvar API_GET_RETRY = [^;]+;/)[0], 'var MSK_LIVE = false;', grab('fetchTO'), grab('parseJson'), grab('apiRead'), grab('apiReadOnce'),
        grab('mskCfgOk_'), grab('mskOn_'), grab('ensureBaseData'), grab('ensureVmData'), grab('pfSteps'), grab('apiErrMsg')].join('\n');
      function box(cfg, flagsJson) {
        const sent = [], calls = [];
        const sb = {
          JSON, String, Object, Date, Error, Promise, setTimeout, clearTimeout, RegExp,
          AbortController: class { constructor() { this.signal = {}; } abort() {} },
          loadCfg: () => cfg,
          fetch: (url, opt) => { sent.push(opt.body); return Promise.resolve({ text: () => Promise.resolve('{"ok":true}') }); },
          baseStale: () => true, dataLoaded: () => false, LOADING: false, rgClearBase: () => calls.push('clearBase'), load: () => { calls.push('load'); return null; },
          vmStale: () => true, vmLoaded: () => false, VM_LOADING: false, rgClearVm: () => calls.push('clearVm'), vmLoad: () => { calls.push('vmLoad'); return null; },
          excReadCfg: () => null, excLoaded: () => false, excStale: () => true, EXC_LOADING: false, excLoad: () => null
        };
        vm.createContext(sb);
        vm.runInContext(code, sb);
        let L = null;
        if (flagsJson !== undefined) { L = load({ noWarm: true, flagsJson }); sb.SUHoRead = L.H; }
        return { sb, sent, calls, L };
      }
      const NOC = { url: '', token: '' };
      const A = box(NOC, ON);
      const ev = await A.sb.apiRead('events', EVP);
      const ms = await A.sb.apiRead('measures', MSP);
      t('画面・接続先なし: 出来事・バイタル食事は新しい保存先だけへ届き Google へ0件', A.sent.length === 0 && A.L.rpcs.length === 2 && !!ev.events && !!ms.vitals, { s: A.sent.length, r: A.L.rpcs });
      const e1 = await A.sb.apiRead('ping', {}).then(() => null, e => e);
      t('画面・接続先なし: ping は今までどおり「接続先と合言葉が入っていません」', !!e1 && A.sb.apiErrMsg(e1).indexOf('接続先と合言葉が入っていません') === 0 && A.sent.length === 0);
      const B = box(NOC, ON);
      const origB = B.L.H.call;
      B.L.H.call = (a, p, f, x) => { B.seen = x; return origB(a, p, f, x); };
      await B.sb.apiRead('events', EVP);
      t('画面・接続先なし: 入口へ noGas を渡す', !!B.seen && B.seen.noGas === true, B.seen);
      const C = box({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'tok-example' }, OFF);
      const origC = C.L.H.call;
      C.L.H.call = (a, p, f, x) => { C.seen = x; return origC(a, p, f, x); };
      await C.sb.apiRead('events', EVP);
      t('画面・接続先あり: noGas は偽（今までどおり）・Google へ今までの本文で1回', !!C.seen && C.seen.noGas === false && C.sent.length === 1
        && C.sent[0] === JSON.stringify({ action: 'events', from: '2026-10-01', to: '2026-10-03', noLedger: '1', token: 'tok-example' }), { seen: C.seen, sent: C.sent });
      const D = box(NOC, ON);
      D.L.H.call = (a, p, f) => f();   // 新しい保存先で読めず画面の関数へ戻った時
      const e2 = await D.sb.apiRead('events', EVP).then(() => null, e => e);
      t('画面・接続先なし・読めずに戻った時: 今までの断り（NO_CFG）で Google へ0件', !!e2 && e2.message === 'NO_CFG' && D.sent.length === 0);

      // 読み始めの門（ensureBaseData・ensureVmData・pfSteps）
      const E = box(NOC, undefined);
      E.sb.ensureBaseData(); E.sb.ensureVmData();
      t('接続先なし・使える印なし: 今までどおり読まない・先読みもしない', E.calls.join(',') === 'clearBase,clearVm' && E.sb.pfSteps().length === 0, E.calls);
      const F = box(NOC, undefined);
      vm.runInContext('MSK_LIVE = true;', F.sb);
      F.sb.ensureBaseData(); F.sb.ensureVmData();
      t('接続先なし・使える印あり: 出来事とバイタル食事を読む・先読みも2つ', F.calls.join(',') === 'load,vmLoad' && F.sb.pfSteps().length === 2, F.calls);
    }

    // 画面の起動: 接続先の無い事務所PCは確かめてから1回だけ進む
    {
      const st = HTML.indexOf('  function mskNoCfg_(){');
      const en = HTML.indexOf('\n})();', st);
      const startCode = 'function boot(){\n' + HTML.slice(st, en) + '\n}';
      async function run(o) {
        const calls = [];
        const ls = { su_device_role: o.role || null };
        const sb = {
          cfg: o.cfg, opened: o.opened || 'scr-resident', MSK_LIVE: false, ROLE_KEY: 'su_device_role',
          lsGet: k => ls[k], mskCfgOk_: () => !!(o.cfg.url && o.cfg.token),
          goto: (s) => calls.push('goto:' + s), $: () => ({ textContent: '' }), sqSyncScope: () => {}, renderSearch: () => {},
          ensureBaseData: () => calls.push('base'), ensureVmData: () => calls.push('vm'), ensureExcData: () => calls.push('exc'),
          mskGuide_: () => calls.push('guide'), pfAfterFirst: () => calls.push('pf'),
          window: { SUCfgHint: { quiet: () => calls.push('quiet') } },
          Promise
        };
        if (!o.noHo) sb.SUHoRead = { liveReady: () => { calls.push('probe'); if (o.flipField) ls.su_device_role = 'field'; return o.probe; } };
        sb.SUCfgHint = sb.window.SUCfgHint;
        vm.createContext(sb);
        vm.runInContext(startCode, sb);
        sb.boot();
        await new Promise(r => setTimeout(r, 10));
        return { calls, live: sb.MSK_LIVE };
      }
      const NOC = { url: '', token: '' }, HAS = { url: 'u', token: 't' };
      let r = await run({ cfg: NOC, probe: Promise.resolve(true) });
      t('起動・接続先なし・使える: 帯と案内を止めて最初のタブを1回だけ読み、先読みへ', r.live === true && r.calls.join(',') === 'probe,quiet,guide,base,pf', r.calls);
      r = await run({ cfg: NOC, probe: Promise.resolve(true), opened: 'scr-vm' });
      t('起動・接続先なし・使える・バイタルのタブ: バイタルだけ読む', r.calls.join(',') === 'probe,quiet,guide,vm,pf', r.calls);
      r = await run({ cfg: NOC, probe: Promise.resolve(false) });
      t('起動・接続先なし・使えない: 今までどおり設定の画面へ（帯は止めない・読まない）', r.live === false && r.calls.join(',') === 'probe,goto:scr-cfg,pf', r.calls);
      r = await run({ cfg: NOC, probe: Promise.reject(new Error('x')) });
      t('起動・確かめが失敗: 設定の画面へ', r.calls.join(',') === 'probe,goto:scr-cfg,pf', r.calls);
      r = await run({ cfg: NOC, noHo: true });
      t('起動・部品が無い: その場で設定の画面へ', r.calls.join(',') === 'goto:scr-cfg,pf', r.calls);
      r = await run({ cfg: NOC, probe: Promise.resolve(true), flipField: true });
      t('起動・確かめている間に現場の端末へ変わった: 使える印を立てず読まない', r.live === false && r.calls.indexOf('base') < 0 && r.calls.indexOf('quiet') < 0, r.calls);
      r = await run({ cfg: HAS });
      t('起動・接続先あり: 確かめず今までどおり', r.calls.join(',') === 'base,pf', r.calls);
      r = await run({ cfg: HAS, opened: 'scr-exc' });
      t('起動・接続先あり・排泄のタブ: 今までどおり排泄だけ', r.calls.join(',') === 'exc,pf', r.calls);
    }
    t('画面: 起動の確かめは SUHoRead が無くても動く（typeof で確かめる）', /typeof SUHoRead !== 'undefined' && SUHoRead && typeof SUHoRead\.liveReady === 'function'/.test(HTML));
    {
      const s0 = HTML.indexOf('\nfunction ensureExcData(');
      t('画面: 排泄の読み込み（排便記録アプリ）は使える印を見ない（今のまま）', s0 > 0 && !/MSK_LIVE|mskOn_/.test(HTML.slice(s0, HTML.indexOf('\n}\n', s0))));
    }
  }

  finished = true;
  console.log(`\n${pass} 件合格 / ${fail} 件失敗`);
  if (fail) process.exitCode = 1;
})().catch(e => { finished = true; console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exitCode = 1; });
