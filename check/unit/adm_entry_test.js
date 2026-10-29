/* 共通データ部品の入居調整の台帳の入口（SU.data.admission・2026-10-29・統合 0042）の試験。
   守りたいこと:
     A 入居調整の専用GASへ送る中身が、入口へ置き換える前（kvGet・kvRaw・kvPutBeacon を直接呼んでいた形）と一字一句同じ
       （get・put・put＋force・put＋証明・ping・閉じる直前の送信。宛先・送り方・本文）
     B スイッチ admission が切・無い・Supabase の道が無い時は gas の道
     C スイッチが入でも、データベースの印が切り替える前（shadow）・0042 の前なら gas の道を同じ本文で
     D 切り替えた後（live）は adm-write へ（合言葉なし）。保存できたら Google へ写し返し（admMirror・ログインの証明つき）。
       Google が「切り替えた後」（switched）と返した読み取りは使わない。ログインしていない時は断り、Google へ流さない
     E 画面: 台帳の読み書き・閉じる直前の送信・ping は入口を通る。添付書類の操作は今までどおり kvRaw（Google）
   実行: node check/unit/adm_entry_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 30); i++) await tick(); }

const URL_ = 'https://script.google.com/macros/s/EXAMPLE_ADM/exec';
const KEY = 'admission_flow_v1';
const DB = { v: 1, updatedAt: '2026-10-29T00:00:00.000Z', candidates: [{ id: 'c1', name: '見本 一郎' }] };

function authOf(o) {
  o = o || {};
  const rpcs = [], invokes = [];
  return { rpcs, invokes, A: {
    STATUS: { OK: 'ok' },
    check: async () => ({ status: o.signedOut ? 'signed_out' : 'ok', role: 'office' }),
    client: () => ({
      rpc: async (n) => { rpcs.push(n); if (o.noFn) return { data: null, error: { code: 'PGRST202' } }; return { data: { ok: true, mode: o.mode || 'live' }, error: null }; },
      functions: { invoke: async (fn, opt) => { invokes.push({ fn, body: JSON.parse(JSON.stringify(opt.body)) }); return { data: o.resp || { ok: true, rev: 9 }, error: null }; } },
      auth: { getSession: async () => ({ data: { session: { access_token: 'h.p.s' } } }) }
    })
  } };
}
function box(o) {
  o = o || {};
  const store = {};
  if (o.flags !== undefined) store.su_backend_flags = JSON.stringify(o.flags);
  const posts = [], beacons = [];
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    performance: { mark() {} },
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, text: blob.text, type: blob.type }); return true; } },
    fetch: (url, init) => {
      if (/^su-backend\.json\?t=/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(o.flags || { supabase: {} }) });
      posts.push({ url, method: init.method, ct: init.headers['Content-Type'], redirect: init.redirect, body: init.body, keys: Object.keys(init).join(',') });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(o.gasResp || { ok: true, rev: 4, data: null }) });
    },
    Blob: function (parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; },
    Promise, JSON, Object, Array, String, Number, Error, Date, setTimeout, clearTimeout
  };
  if (o.auth) w.SUAuth = o.auth;
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('su-data.js'), w);
  vm.runInContext(read('su-data-gas.js'), w);
  if (o.supa !== false) vm.runInContext(read('su-data-supabase.js'), w);
  w.SU.data.init({ appId: 'admission-flow', resolveTarget: () => ({ endpoint: URL_, token: 'tok-adm' }), gasAuth: true });
  return { w, posts, beacons };
}
/* 置き換える前の呼び方（画面が直接呼んでいた形）と入口の呼び方で、Google へ届くものを比べる */
async function both(oldFn, newFn, o) {
  const a = box(o), b = box(o);
  await oldFn(a.w.SU.data); await newFn(b.w.SU.data); await settle();
  return { a: JSON.stringify([a.posts, a.beacons]), b: JSON.stringify([b.posts, b.beacons]), n: a.posts.length + a.beacons.length };
}

(async () => {
  console.log('A 置き換える前と一字一句同じ（スイッチ切）');
  const cases = [
    ['get', d => d.kvGet(KEY), d => d.admission.get(KEY)],
    ['put', d => d.kvRaw({ action: 'put', key: KEY, data: DB, rev: 3 }), d => d.admission.put(KEY, DB, 3, {})],
    ['put＋force', d => d.kvRaw({ action: 'put', key: KEY, data: DB, rev: 3, force: true }), d => d.admission.put(KEY, DB, 3, { force: true })],
    ['put＋証明', d => d.kvRaw({ action: 'put', key: KEY, data: DB, rev: 3, accessToken: 'h.p.s' }), d => d.admission.put(KEY, DB, 3, { accessToken: 'h.p.s' })],
    ['put＋force＋証明', d => d.kvRaw({ action: 'put', key: KEY, data: DB, rev: 3, force: true, accessToken: 'h.p.s' }), d => d.admission.put(KEY, DB, 3, { force: true, accessToken: 'h.p.s' })],
    ['ping', d => d.kvRaw({ action: 'ping' }), d => d.admission.ping()],
    ['閉じる直前の送信', d => d.kvPutBeacon(KEY, DB, 3), d => d.admission.putBeacon(KEY, DB, 3)]
  ];
  for (const [label, o1, n1] of cases) {
    for (const flags of [undefined, { supabase: { admission: false } }]) {
      const r = await both(o1, n1, { flags });
      t(label + (flags ? '（スイッチ false）' : '（スイッチ無し）') + ' は同じ中身を送る', r.n === 1 && r.a === r.b, r);
    }
  }
  console.log('B・C スイッチが入でも、切り替える前は gas の道を同じ本文で');
  for (const [label, o1, n1] of cases.slice(0, 6)) {
    const au = authOf({ mode: 'shadow' });
    const r = await both(o1, n1, { flags: { supabase: { admission: true } }, auth: au.A });
    t(label + '（印 shadow）は同じ中身を送る・adm-write へは送らない', r.n === 1 && r.a === r.b && au.invokes.length === 0, r);
  }
  {
    const au = authOf({ noFn: true });
    const r = await both(d => d.kvGet(KEY), d => d.admission.get(KEY), { flags: { supabase: { admission: true } }, auth: au.A });
    t('0042 の前（印を読む関数が無い）は gas の道', r.a === r.b && au.invokes.length === 0, r);
  }
  {
    const r = await both(d => d.kvGet(KEY), d => d.admission.get(KEY), { flags: { supabase: { admission: true } }, supa: false });
    t('Supabase の道が読み込まれていない時は gas の道', r.a === r.b, r);
  }
  console.log('D 切り替えた後');
  {
    const au = authOf({ mode: 'live' });
    const b = box({ flags: { supabase: { admission: true } }, auth: au.A });
    const g = await b.w.SU.data.admission.get(KEY);
    await settle();
    t('読み取りは adm-write へ（合言葉なし）・開いた時に1回 Google へ写し返しを追いつかせる', au.invokes.length === 1 && au.invokes[0].fn === 'adm-write'
      && JSON.stringify(au.invokes[0].body) === '{"action":"get","key":"admission_flow_v1"}' && g.ok === true
      && b.posts.length === 1 && JSON.parse(b.posts[0].body).action === 'admMirror' && JSON.parse(b.posts[0].body).accessToken === 'h.p.s', [au.invokes, b.posts]);
    const p = await b.w.SU.data.admission.put(KEY, DB, 3, { force: true, accessToken: 'h.p.s' });
    await settle();
    t('保存は adm-write へ同じ本文（合言葉なし）・保存できたら写し返し', p.ok === true && JSON.stringify(au.invokes[1].body) === JSON.stringify({ action: 'put', key: KEY, data: DB, rev: 3, force: true, accessToken: 'h.p.s' })
      && b.posts.length === 2 && JSON.parse(b.posts[1].body).action === 'admMirror', [au.invokes, b.posts.map(x => JSON.parse(x.body).action)]);
    t('Google へ送るのは写し返しだけ（台帳の get・put を Google へ送らない）', b.posts.every(x => JSON.parse(x.body).action === 'admMirror'));
    t('切り替えた後は閉じる直前の送信を Google へ送らない', b.w.SU.data.admission.putBeacon(KEY, DB, 3) === false && b.beacons.length === 0);
    const tp = authOf({ mode: 'shadow' });
    t('計画書の印とは別に覚える（入居調整が live でも計画書は shadow のまま）', b.w.SU.data._entryRoute('training') === 'gas');
    void tp;
  }
  {
    const au = authOf({ signedOut: true });
    const b = box({ flags: { supabase: { admission: true } }, auth: au.A });
    let err = null;
    try { await b.w.SU.data.admission.put(KEY, DB, 3, {}); } catch (e) { err = e; }
    await settle();
    t('ログインしていない時は断り、Google へ流さない', err && /ログインしていません/.test(err.message) && b.posts.length === 0 && au.invokes.length === 0, err && err.message);
  }
  {
    const b = box({ gasResp: { ok: true, rev: 2, data: DB, switched: true } });
    let err = null;
    try { await b.w.SU.data.admission.get(KEY); } catch (e) { err = e; }
    t('Google が「切り替えた後」と返した読み取りは使わない', err && /切り替えている最中か、切り替えた後/.test(err.message));
  }
  console.log('E 画面');
  {
    const H = read('admission-flow.html');
    t('台帳の読み取りは入口（kvGet(KV_KEY) を直接呼ばない）', !/SU\.data\.kvGet\(KV_KEY\)/.test(H) && (H.match(/SU\.data\.admission\.get\(KV_KEY\)/g) || []).length === 4);
    t('台帳の保存は入口（force・証明は extra で渡す）', /return SU\.data\.admission\.put\(KV_KEY, snap, rev, ex\);/.test(H) && !/action: 'put', key: KV_KEY/.test(H));
    t('閉じる直前の送信・ping は入口', /SU\.data\.admission\.putBeacon\(KV_KEY, DB, kvRev\)/.test(H) && /SU\.data\.admission\.ping\(\)/.test(H) && !/SU\.data\.kvPutBeacon/.test(H));
    t('添付書類の操作は今までどおり kvRaw（Google）', /function apiFiles\(payload\) \{[\s\S]{0,300}return SU\.data\.kvRaw\(payload\);/.test(H));
    t('Supabase の道を読み込む（gas の道の後）', H.indexOf('su-data-supabase.js?v=') > H.indexOf('su-data-gas.js?v=') && H.indexOf('su-data-gas.js?v=') > 0);
  }

  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
