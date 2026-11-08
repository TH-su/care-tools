/* 共通データ部品の入居調整の台帳の入口（SU.data.admission・2026-10-29・統合 0042）の試験。
   守りたいこと:
     A 入居調整の専用GASへ送る中身が、入口へ置き換える前（kvGet・kvRaw・kvPutBeacon を直接呼んでいた形）と一字一句同じ
       （get・put・put＋force・put＋証明・ping・閉じる直前の送信。宛先・送り方・本文）
     B スイッチ admission が切・無い・Supabase の道が無い時は gas の道
     C スイッチが入でも、データベースの印が切り替える前（shadow）・0042 の前なら gas の道を同じ本文で
     D 切り替えた後（live）は adm-write へ（合言葉なし）。保存できたら Google へ写し返し（admMirror・ログインの証明つき）。
       Google が「切り替えた後」（switched）と返した読み取りは使わない。ログインしていない時は断り、Google へ流さない
     E 画面: 台帳の読み書き・閉じる直前の送信・ping は入口を通る。添付書類の操作は kvRaw（Google）。書類の正本を切り替えた後だけ su-doc-live.js の道（統合 0065）
     L 接続先・合言葉の無い端末でも、ログインだけで使える時（2026-11-08）の判定（SU.data.admission.liveReady）と画面の分け方
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
    t('添付書類の操作は kvRaw（Google）・切り替えた後だけ su-doc-live.js が新しい保存先へ（統合 0065）', /function apiFiles\(payload\) \{[\s\S]{0,700}if \(window\.SUDocLive\) return window\.SUDocLive\.adm\(payload, function \(\) \{ return SU\.data\.kvRaw\(payload\); \}\);\s*return SU\.data\.kvRaw\(payload\);/.test(H)
      && /<script src="su-doc-live\.js\?v=/.test(H));
    t('中身が同じかの見比べは項目の並びを問わない（反証レビュー 指摘6）', (H.match(/var same = afCanon_\(/g) || []).length === 2 && /function afCanon_\(v\)/.test(H));
    t('送れていない変更があり、閉じる直前の送信もできなかった時は閉じる前に止める（反証レビュー 指摘11）', /if \(dirty && afBeaconLost_\) \{ ev\.preventDefault\(\);/.test(H)
      && /afBeaconLost_ = SU\.data\.admission\.putBeacon\(KV_KEY, DB, kvRev\) === false;/.test(H));
    t('Supabase の道を読み込む（gas の道の後）', H.indexOf('su-data-supabase.js?v=') > H.indexOf('su-data-gas.js?v=') && H.indexOf('su-data-gas.js?v=') > 0);
  }

  console.log('L ログインだけで使える（接続先・合言葉の無い端末・2026-11-08 代表者「端末ごとの設定を極限までなくす」）');
  {
    /* 接続先の無い端末を作る（resolveTarget が空を返す）。fetch・受け口・端末の書き込みを数える */
    function lbox(o) {
      o = o || {};
      const store = {};
      if (o.cached) store.su_backend_flags = JSON.stringify(o.cached);
      if (o.field) store.su_device_role = 'field';
      const writes = [], posts = [], rpcs = [], invokes = [];
      const A = {
        STATUS: { OK: 'ok' },
        check: async () => { if (o.checkReject) throw new Error('net'); return { status: o.status || 'ok', role: o.role || 'office' }; },
        client: () => ({
          rpc: async (n) => { rpcs.push(n); if (o.modeErr) return { data: null, error: o.modeErr }; return { data: { ok: true, mode: o.mode || 'live' }, error: null }; },
          functions: { invoke: async (fn, opt) => { invokes.push({ fn, body: JSON.parse(JSON.stringify(opt.body)) }); return { data: { ok: true, rev: 5, data: DB }, error: null }; } },
          auth: { getSession: async () => ({ data: { session: { access_token: 'h.p.s' } } }) }
        })
      };
      const w = {
        localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = String(v); }, removeItem: k => { writes.push(k); delete store[k]; } },
        performance: { mark() {} },
        navigator: { sendBeacon: () => { posts.push('beacon'); return true; } },
        fetch: (url, init) => {
          if (/^su-backend\.json\?t=/.test(url)) {
            if (o.flagsFail) return Promise.reject(new Error('net'));
            if (o.flagsHang) return new Promise(() => {});
            return Promise.resolve({ ok: true, json: () => Promise.resolve(o.flags) });
          }
          posts.push(url);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        },
        Blob: function (parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; },
        Promise, JSON, Object, Array, String, Number, Error, Date, setTimeout: o.fastTimer ? ((f, ms) => setTimeout(f, ms >= 8000 ? 20 : ms)) : setTimeout, clearTimeout
      };
      if (!o.noAuth) w.SUAuth = o.authHang ? { STATUS: { OK: 'ok' }, check: () => new Promise(() => {}), client: A.client } : A;
      w.window = w;
      vm.createContext(w);
      vm.runInContext(read('su-data.js'), w);
      vm.runInContext(read('su-data-gas.js'), w);
      if (o.supa !== false) vm.runInContext(read('su-data-supabase.js'), w);
      w.SU.data.init({ appId: 'admission-flow', resolveTarget: () => ({ endpoint: '', token: '' }), gasAuth: true });
      return { w, writes, posts, rpcs, invokes };
    }
    const ON = { supabase: { admission: true } };
    const cases = [
      ['スイッチが入・事務所としてログイン・印が切り替えた後', { flags: ON }, true],
      ['管理者としてログイン', { flags: ON, role: 'admin' }, true],
      ['スイッチが切', { flags: { supabase: { admission: false } } }, false],
      ['スイッチの終わりの時刻を過ぎた', { flags: { supabase: { admission: true, admission_until: '2026-01-01T00:00:00+09:00' } } }, false],
      ['写しの期間（shadow）', { flags: ON, mode: 'shadow' }, false],
      ['印を読む関数が無い（0042 の前）', { flags: ON, modeErr: { code: 'PGRST202' } }, false],
      ['印を読めない', { flags: ON, modeErr: { code: 'XX000' } }, false],
      ['権限で断られた', { flags: ON, modeErr: { code: '42501' } }, false],
      ['ログインしていない', { flags: ON, status: 'signed_out' }, false],
      ['2段階認証がまだ', { flags: ON, status: 'mfa_verify' }, false],
      ['使えないアカウント', { flags: ON, status: 'denied' }, false],
      ['現場のアカウント', { flags: ON, role: 'field' }, false],
      ['現場の端末', { flags: ON, field: true }, false],
      ['ログインの確かめが失敗', { flags: ON, checkReject: true }, false],
      ['ログインの部品が無い（読み込めない）', { flags: ON, noAuth: true }, false],
      ['Supabase の道が読み込まれていない', { flags: ON, supa: false }, false],
      ['スイッチを読めない（控えも無い）', { flagsFail: true }, false],
      ['スイッチを読めない時は控えの値（控えが入）', { flagsFail: true, cached: ON }, true]
    ];
    for (const [label, o, want] of cases) {
      const b = lbox(o);
      let v, threw = false;
      try { v = await b.w.SU.data.admission.liveReady(); } catch (e) { threw = true; }
      await settle();
      t('L ' + label + ' → ' + want + '（例外を出さない・受け口も Google も呼ばない・端末にはスイッチの控えしか書かない）',
        !threw && v === want && b.invokes.length === 0 && b.posts.length === 0 && b.writes.every(k => k === 'su_backend_flags'), { v, threw, inv: b.invokes, posts: b.posts, writes: b.writes });
    }
    {
      const b = lbox({ flags: ON, authHang: true, fastTimer: true });
      const t0 = Date.now(); const v = await b.w.SU.data.admission.liveReady();
      t('L ログインの確かめが返らない時は時間切れ（8秒）で false', v === false && Date.now() - t0 < 2000);
    }
    {
      const b = lbox({ flags: ON });
      const v = await b.w.SU.data.admission.liveReady();
      const g = await b.w.SU.data.admission.get(KEY);
      const p = await b.w.SU.data.admission.put(KEY, DB, 3, { accessToken: 'h.p.s' });
      await settle();
      t('L 使える端末の読み書きは adm-write へ・Google へは何も送らない（写し返しも送らない＝送る先が無い）',
        v === true && g.ok === true && p.ok === true && b.invokes.length === 2 && b.invokes.every(x => x.fn === 'adm-write') && b.posts.length === 0, [b.invokes.map(x => x.fn), b.posts]);
      t('L 使える端末の閉じる直前の送信は Google へ送らない', b.w.SU.data.admission.putBeacon(KEY, DB, 3) === false && b.posts.length === 0);
    }
    {
      const b = lbox({ flags: ON, mode: 'shadow' });
      let err = null;
      try { await b.w.SU.data.admission.get(KEY); } catch (e) { err = e; }
      t('L 接続先の無い端末で印が写しの期間なら、今までと同じ「同期先が未設定です」（Google へ送らない）', err && /同期先が未設定です/.test(err.message) && b.posts.length === 0);
    }
    {
      const SUPA = read('su-data-supabase.js');
      t('L 接続先のある端末は今までどおり写し返しを送る（入居調整だけ・接続先が無い時だけ省く）',
        /if \(group === 'admission' && !gasTargetOf\(opts\)\) return Promise\.resolve\(null\);/.test(SUPA));
    }
    const H = read('admission-flow.html');
    t('L 画面: 接続先の無い端末は起動の時に1回だけ確かめる（afLiveTried_）・使える時（AF_LIVE）だけ台帳を読み書きする',
      /if \(!t\.endpoint && !AF_LIVE && !afLiveTried_\) return afProbeLive_\(\)\.then\(function \(\) \{ return startupPull\(\); \}\);/.test(H)
      && (H.match(/if \(!t\.endpoint && !AF_LIVE\) \{ setSync\('未接続'\);/g) || []).length === 3);
    t('L 画面: 書類は、接続先が無い時は使える時だけ su-doc-live.js へ。Google へ送る関数は渡さない（今までと同じ断り）',
      /if \(!\(AF_LIVE && window\.SUDocLive\)\) return Promise\.reject\(new Error\(AF_NOCFG_MSG\)\);\s*return window\.SUDocLive\.adm\(payload, function \(\) \{ return Promise\.reject\(new Error\(AF_NOCFG_MSG\)\); \}\);/.test(H)
      && H.indexOf('return window.SUDocLive.adm(payload, function () { return Promise.reject(') < H.indexOf('return window.SUDocLive.adm(payload, function () { return SU.data.kvRaw(payload); });'));
    t('L 画面: 台帳の写し（Google から読む）は接続先がある時だけ（今までどおり）', /admFullBlocked_\(\) \|\| !syncTarget\(\)\.endpoint\) return;/.test(H));
    t('L 画面: 使える端末では接続先の帯（su-cfg-hint.js）を出さない', /if \(AF_LIVE\) \{ try \{ if \(window\.SUCfgHint && typeof window\.SUCfgHint\.quiet === 'function'\) window\.SUCfgHint\.quiet\(\);/.test(H)
      && /function quiet\(\) \{/.test(read('su-cfg-hint.js')) && /setTimeout\(function \(\) \{ if \(!quieted && empty\(MAP\[p\]\)\) show\(\); \}, WAIT_MS\);/.test(read('su-cfg-hint.js')));
    t('L 画面: 入居者マスタへの登録・登録確認は、接続先が無い時に1回だけ SUResRead.liveReady で確かめ、使えない時は今までと同じ断り',
      /if \(!cfg\.url && !AF_MLIVE && !afMLiveTried_\) \{ afProbeMasterLive_\(\)\.then\(function \(\) \{ openMasterModal\(c\); \}\); return; \}\s*if \(!cfg\.url && !AF_MLIVE\) \{/.test(H)
      && /if \(!masterCfg\(\)\.url && !AF_MLIVE && !afMLiveTried_\) \{ afProbeMasterLive_\(\)\.then\(function \(\) \{ verifyMaster\(c\); \}\); return; \}/.test(H)
      && /typeof window\.SUResRead\.liveReady === 'function'/.test(H));
    t('L 画面: Google へ送る関数（masterPostGas_・masterGetGas_）は接続先が無ければ今までどおり送らない', /function masterPost\(body, timeoutMs\) \{\s*var cfg = masterCfg\(\);\s*if \(!cfg\.url\) return Promise\.reject\(new Error\('NO_URL'\)\);/.test(H)
      && /function masterGet\(params, timeoutMs\) \{\s*var cfg = masterCfg\(\);\s*if \(!cfg\.url\) return Promise\.reject\(new Error\('NO_URL'\)\);/.test(H));
    t('L 画面: 使える端末の設定の窓は「未設定」を赤で出さない（新しい文言は足さない）', /AF_LIVE \? '—' : '<span style="color:var\(--err\)">未設定<\/span>'/.test(H) && /AF_MLIVE \? '—' : '<span style="color:var\(--err\)">未設定<\/span>'/.test(H));
    t('L 画面: 守り（su-app-gate.js の確かめ）が通ってから確かめる（afStart_ の中の startupPull）', H.indexOf('window.SUAppGate.run(') < H.indexOf("startupPull().then(function (ok) { if (ok) admFullAuto_();"));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
