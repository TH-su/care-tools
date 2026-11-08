/* 現場の端末で、現場のアカウントとしてログインしている時だけ、名簿・版数・予定を新しい保存先から読む試験
   （2026-11-08 新設・代表者の決定 2026-11-08 A・写し返しを止める計画の 3-2 と 5-2 の 7〜8・棚卸し B5）
   実行: node check/unit/res_field_read_test.js
   対象を差し替える: RES_READ_JS=/tmp/変異版.js SUKV_JS=/tmp/変異版.js node check/unit/res_field_read_test.js

   守ること:
     A 名簿（su-res-read.js の officeOnly）: 現場の端末＋現場のアカウント＋印が「切り替えた後」の時だけ新しい保存先から読む。
       呼ぶのは res_mode_get と res_roster だけ（1人ずつの記録 res_get＝C 医療・D 家族は呼ばない）。応答は Google が現場の合言葉に
       返す形（getRosterSafe・在籍者の7項目だけ）と同じで、データベースが余分な項目・退去の方を返しても7項目・在籍者に絞る
     B 名簿: ログインしていない・ログインの部品が無い・確かめられない・現場の端末の事務所・管理者のアカウント・事務所PCの現場のアカウント・
       写しの期間・0036 の前・スイッチが切・名簿でない読み取り・ワークスケジュールは、今までどおり Google（データベースを呼ばない／印だけ）
     C 名簿: ログインした後の断り・通信の失敗は Google へ流さずに失敗にする
     D 名簿: 遅れて届いた答えは捨てる（出した時と答えの時で端末の用途が違う。現場→事務所PC・事務所PC→現場の両方）
     E 版数（stateRev）: 現場の端末＋現場のアカウント＋切り替えた後だけ新しい保存先の版数。それ以外は Google。用途が変われば捨てる
     F 予定（su-kv.js）: 現場のアカウントのログインでは、見るだけの読み取り（readRouted）も画面の通信の入口（call の get）も
       新しい保存先から読む（Google を呼ばない）。ログインしていない・確かめられない・失敗は readRouted が null＝呼び手が Google。
       現場のアカウントは週間計画・週の型を書かない（kv_put を呼ばない）
     G 端末に保存しない・Google へ写し返さない（名簿・版数の読み取りで localStorage へ書かない・resMirror を送らない）
   ★架空データのみ（番号と「見本」の仮の名前だけ）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.RES_READ_JS || path.join(ROOT, 'su-res-read.js'), 'utf8');
const SUKV_SRC = fs.readFileSync(process.env.SUKV_JS || path.join(ROOT, 'su-kv.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });
const clone = o => JSON.parse(JSON.stringify(o));

/* ══ 砂場1: su-res-read.js ══ */
const ON = { supabase: { master_live: true } };
function load(o) {
  o = o || {};
  const writes = [], fetches = [];
  const store = Object.assign({ su_backend_flags: o.flags === undefined ? JSON.stringify(ON) : JSON.stringify(o.flags), su_device_role: 'field' }, o.store || {});
  if (o.store && o.store.su_device_role === null) delete store.su_device_role;
  const ctx = {
    window: {}, JSON, Object, Array, String, Number, Math, Error, Promise, Date, RegExp, isNaN, isFinite, parseInt, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = v; }, removeItem: k => { writes.push(k); delete store[k]; } },
    fetch: (u, b) => { fetches.push([u, b]); return Promise.reject(new Error('no network')); }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUResRead, writes, store, fetches };
}
/* 架空の名簿（データベースの res_roster が現場のアカウントに返す形。余分な項目・退去の方も混ぜて絞り込みを確かめる） */
const SAFE_ROWS = [
  { id: 'r1', name: '見本 甲', kana: 'みほん こう', room: '101', gender: '女', careLevel: '要介護1', active: true },
  { id: 'r2', name: '見本 乙', kana: 'みほん おつ', room: '102', gender: '男', careLevel: '要介護3', active: true }
];
const LEAKY_ROWS = SAFE_ROWS.concat([{ id: 'r9', name: '見本 丙', room: '103', active: false }]).map((r, i) => i === 0
  ? Object.assign({}, r, { birthDate: '1930-01-01', hospitalized: true, visitDay: '月', hospital: '見本医院', doctor: '見本', medsRegular: '見本錠', family: [{ name: '見本' }] }) : r);
function auth(o) {
  const calls = [];
  const db = { mode: o.mode || 'live', rev: o.rev == null ? 7 : o.rev };
  const A = { STATUS: { OK: 'ok' },
    check: async () => { if (o.checkThrows) throw new Error('x'); return o.signedOut ? { status: 'signed_out' } : { status: 'ok', role: o.role || 'field' }; },
    client: () => ({ rpc: (n, a) => {
      calls.push(n);
      if (o.reject && n !== 'res_mode_get') return Promise.reject(new Error('network'));
      if (n === 'res_mode_get') {
        if (o.modeErr) return Promise.resolve({ error: o.modeErr });
        const data = { ok: true, mode: db.mode, stateRev: db.rev };
        return o.delay ? new Promise(ok => setTimeout(() => ok({ data }), o.delay)) : Promise.resolve({ data });
      }
      if (n === 'res_roster') {
        if (o.rosterErr) return Promise.resolve({ error: o.rosterErr });
        const data = { ok: true, safe: true, rows: clone(o.rows || SAFE_ROWS) };
        return o.rosterDelay ? new Promise(ok => setTimeout(() => ok({ data }), o.rosterDelay)) : Promise.resolve({ data });
      }
      if (n === 'res_get') return Promise.resolve({ data: { ok: true, rows: [] } });
      return Promise.resolve({ error: { code: 'PGRST202' } });
    }, auth: { getSession: async () => ({ data: { session: { access_token: 'x' } } }) } }) };
  return { io: { auth: async () => A, cfg: () => ({ url: 'https://example.invalid/exec', token: 't' }) }, calls, db };
}
const gasCalls = [];
const gasFn = b => { gasCalls.push(b); return Promise.resolve({ via: 'gas', roster: [] }); };
async function roster(L, a, body, opts) {
  const before = gasCalls.length;
  let r = null, err = null;
  try { r = await L.R.call(body || { action: 'getRoster' }, gasFn, Object.assign({ screen: 'daycare-roster', officeOnly: true }, opts || {}), a.io); } catch (e) { err = e; }
  return { r, err, gas: gasCalls.length - before, rpc: a.calls.slice() };
}
function gasRevFn(rev) {
  const f = () => { f.n++; return Promise.resolve({ ok: true, json: async () => ({ ok: true, rev: rev, srev: 1 }), text: async () => '{}' }); };
  f.n = 0; return f;
}
async function rev(L, a, opts, gas) {
  gas = gas || gasRevFn(100);
  let r = null, err = null;
  try { r = await L.R.stateRev(gas, opts || {}, a.io); } catch (e) { err = e; }
  let j = null;
  try { j = r && typeof r.json === 'function' ? await r.json() : r; } catch (e) { j = null; }
  return { j, err, gas: gas.n, rpc: a.calls.slice() };
}

(async () => {
  /* Google が現場の合言葉に返す形（入居者マスタの GAS の getRosterSafe の写し）を、同じ架空の名簿から作る */
  const want = (() => {
    const L = load();
    L.R._gas.setRows(SAFE_ROWS.map(L.R._toRow));
    const o = clone({ roster: L.R._gas.getRosterSafe() });
    L.R._gas.setRows([]);
    return o;
  })();

  console.log('A 名簿: 現場の端末＋現場のアカウント＋切り替えた後');
  {
    const L = load();
    const a = auth({ role: 'field' });
    const x = await roster(L, a);
    t('新しい保存先の名簿を返し、Google を呼ばない', x.gas === 0 && x.r && Array.isArray(x.r.roster) && x.r.roster.length === 2, x);
    t('呼ぶのは res_mode_get と res_roster だけ（res_get＝1人ずつの記録は呼ばない）', x.rpc.join() === 'res_mode_get,res_roster', x.rpc);
    t('応答は Google が現場の合言葉に返す形（getRosterSafe）と同じ', JSON.stringify(x.r) === JSON.stringify(want), [x.r, want]);
    t('1人分の項目は7つだけ（id・氏名・かな・居室・性別・介護度・在籍）', x.r.roster.every(e => Object.keys(e).join() === 'id,name,kana,room,gender,careLevel,active'), x.r.roster[0]);
    t('版数は同梱しない（Google の現場の応答と同じ）', !('stateRev' in x.r) && !('srev' in x.r));
  }
  {
    const L = load();
    const x = await roster(L, auth({ role: 'field', rows: LEAKY_ROWS }));
    const flat = JSON.stringify(x.r);
    t('★データベースが余分な項目を返しても、生年月日・入院・訪問日・病院・薬・家族は出さない', x.r && !/birthDate|hospitalized|visitDay|hospital|doctor|medsRegular|family/.test(flat), x.r);
    t('★退去の方（active が false）は出さない', x.r && x.r.roster.length === 2 && !x.r.roster.some(e => e.id === 'r9'), x.r);
  }

  console.log('B 名簿: それ以外は今までどおり Google');
  for (const [label, o, store] of [
    ['ログインしていない', { signedOut: true }, null],
    ['ログインを確かめられない', { checkThrows: true }, null],
    ['現場の端末の事務所のアカウント', { role: 'office' }, null],
    ['現場の端末の管理者のアカウント', { role: 'admin' }, null]]) {
    const x = await roster(load({ store }), auth(o));
    t(label + ' → Google（データベースを呼ばない）', x.gas === 1 && x.r.via === 'gas' && x.rpc.length === 0, x);
  }
  {
    let x = await roster(load(), { io: { auth: async () => null }, calls: [] });
    t('ログインの部品が読めない → Google', x.gas === 1 && x.r.via === 'gas', x);
    x = await roster(load({ store: { su_device_role: 'office' } }), auth({ role: 'field' }));
    t('事務所PCの現場のアカウント → Google（今までどおり）', x.gas === 1 && x.rpc.length === 0, x);
    x = await roster(load({ store: { su_device_role: null } }), auth({ role: 'field' }));
    t('用途を決めていない端末（既定は事務所PC）の現場のアカウント → Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await roster(load(), auth({ role: 'field', mode: 'shadow' }));
    t('写しの期間 → Google（印だけ読む）', x.gas === 1 && x.rpc.join() === 'res_mode_get', x);
    x = await roster(load(), auth({ role: 'field', modeErr: { code: 'PGRST202' } }));
    t('0036 の前（関数が無い） → Google', x.gas === 1, x);
    x = await roster(load({ flags: { supabase: { master_live: false } } }), auth({ role: 'field' }));
    t('スイッチが切 → Google（データベースを呼ばない）', x.gas === 1 && x.rpc.length === 0, x);
    x = await roster(load({ flags: null }), auth({ role: 'field' }));
    t('スイッチを読めていない → Google', x.gas === 1 && x.rpc.length === 0, x);
    for (const body of [{ action: 'getResident', id: 'r1' }, { action: 'getSection', id: 'r1', section: 'facesheet_safe' }, { action: 'getBulk' }, { action: 'getListFull' }]) {
      x = await roster(load(), auth({ role: 'field' }), body);
      t('現場の端末の名簿でない読み取り（' + body.action + '） → Google（res_get を呼ばない）', x.gas === 1 && x.rpc.length === 0, x);
    }
    x = await roster(load(), auth({ role: 'field' }), null, { screen: 'work-schedule' });
    t('ワークスケジュール（別の正本から配る画面） → 現場の端末では今までどおり Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await roster(load({ store: { su_device_role: 'office' } }), auth({ role: 'office' }), null, { screen: 'work-schedule' });
    t('ワークスケジュールの事務所PCの事務所のアカウントは今までどおり新しい保存先', x.gas === 0 && x.rpc.join() === 'res_mode_get,res_roster', x);
  }

  console.log('C 名簿: ログインした後の断り・失敗は Google へ流さない');
  for (const [label, o, re] of [['断られた（42501）', { rosterErr: { code: '42501' } }, /権限/], ['データベースの失敗', { rosterErr: { code: 'XX000' } }, /読めませんでした/],
                                ['通信の失敗', { reject: true }, /読めませんでした|network/], ['印を断られた', { modeErr: { code: '42501' } }, /権限/]]) {
    const x = await roster(load(), auth(Object.assign({ role: 'field' }, o)));
    t(label + ' → 失敗（Google を呼ばない）', x.gas === 0 && x.err && re.test(x.err.message), { gas: x.gas, err: x.err && x.err.message });
  }

  console.log('D 名簿: 遅れて届いた答えは捨てる');
  {
    const L = load();
    const p = roster(L, auth({ role: 'field', rosterDelay: 40 }));
    await new Promise(ok => setTimeout(ok, 5));
    L.store.su_device_role = 'office';
    const x = await p;
    t('現場の端末で出した後に用途が事務所PCへ変わった → 捨てる', x.err && x.err.code === 'stale' && x.gas === 0, { err: x.err && x.err.code });
  }
  {
    const L = load({ store: { su_device_role: 'office' } });
    const p = roster(L, auth({ role: 'office', rosterDelay: 40 }));
    await new Promise(ok => setTimeout(ok, 5));
    L.store.su_device_role = 'field';
    const x = await p;
    t('★事務所PCで出した後に用途が現場へ変わった → 捨てる（事務所の名簿を現場の画面へ渡さない）', x.err && x.err.code === 'stale', { err: x.err && x.err.code, r: x.r && x.r.roster && x.r.roster.length });
  }

  console.log('E 版数の見張り（stateRev）');
  {
    let x = await rev(load(), auth({ role: 'field', rev: 321 }));
    t('現場の端末＋現場のアカウント＋切り替えた後 → 新しい保存先の版数・Google を呼ばない', x.gas === 0 && x.j && x.j.ok === true && x.j.rev === 321 && x.j.srev === 0 && x.rpc.join() === 'res_mode_get', x);
    x = await rev(load(), auth({ role: 'office' }));
    t('現場の端末の事務所のアカウント → Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await rev(load(), auth({ signedOut: true }));
    t('現場の端末でログインしていない → Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await rev(load(), auth({ checkThrows: true }));
    t('現場の端末でログインを確かめられない → Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await rev(load(), auth({ role: 'field', mode: 'shadow' }));
    t('写しの期間 → Google', x.gas === 1, x);
    x = await rev(load({ store: { su_device_role: 'office' } }), auth({ role: 'field' }));
    t('事務所PCの現場のアカウント → Google（今までどおり）', x.gas === 1 && x.rpc.length === 0, x);
    x = await rev(load(), auth({ role: 'field', modeErr: { code: '42501' } }));
    t('現場のアカウントで断られた → 失敗（Google へ流さない）', x.gas === 0 && x.err && /権限/.test(x.err.message), { gas: x.gas, err: x.err && x.err.message });
    const L = load();
    const p = rev(L, auth({ role: 'field', delay: 40 }));
    await new Promise(ok => setTimeout(ok, 5));
    L.store.su_device_role = 'office';
    x = await p;
    t('答えの前に用途が事務所PCへ変わった → 捨てる', x.err && x.err.code === 'stale', { err: x.err && x.err.code });
  }

  console.log('G 端末に保存しない・Google へ写し返さない（名簿・版数）');
  {
    const L = load();
    const a = auth({ role: 'field' });
    await roster(L, a); await roster(L, a); await rev(L, a);
    t('localStorage へ書かない', L.writes.length === 0, L.writes);
    await new Promise(ok => setTimeout(ok, 10));
    t('Google への写し返し（resMirror）も、ほかの通信も送らない', L.fetches.length === 0, L.fetches.map(f => f[0]));
  }

  /* ══ 砂場2: su-kv.js（本物）＋偽のログイン・データベース ══ */
  console.log('F 予定（週間計画・ワークスケジュールの日ごと）: 現場のアカウントのログイン');
  const STATUS = { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' };
  function makeKv(o) {
    o = o || {};
    const ls = new Map();
    ls.set('su_backend_flags', JSON.stringify({ supabase: { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true } }));
    ls.set('su_device_role', 'field');
    if (o.session !== false) ls.set('sb-jhbernqawjrzqwrmqrih-auth-token', '{}');
    const rpcs = [], froms = [], raws = [], writes = [];
    const sb = {
      rpc(name, args) {
        rpcs.push(name);
        if (o.rpcError) return Promise.resolve({ error: o.rpcError });
        if (name === 'kv_get') return Promise.resolve({ data: { ok: true, rev: 4, data: { residents: [{ id: 'r1' }] }, updatedAt: 'x', mode: 'live' } });
        return Promise.resolve({ data: { ok: true } });
      },
      from(tb) {
        froms.push(tb);
        const q = { select: () => q, in: (c, keys) => Promise.resolve(o.rpcError ? { error: o.rpcError } : { data: keys.map(k => ({ key: k, rev: 2, data: { tasks: [] }, updated_at: 'x' })) }) };
        return q;
      }
    };
    const box = {
      console, JSON, Math, Date, Number, String, Array, Object, Promise, Error,
      localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { writes.push(k); ls.set(k, String(v)); }, removeItem: k => { writes.push(k); ls.delete(k); }, key: () => null, length: 0 },
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true } }) }),
      setTimeout: (f, ms) => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
      location: { pathname: '/care-tools/support-overview.html' },
      document: { body: { appendChild() {} }, head: { appendChild() {} }, visibilityState: 'visible', addEventListener() {}, getElementsByTagName: () => [],
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' }) },
      addEventListener() {}
    };
    box.window = box;
    box.SUAuth = { STATUS, client: () => sb,
      check: () => o.checkThrows ? Promise.reject(new Error('net')) : Promise.resolve({ status: o.status || STATUS.OK, role: o.role || 'field' }) };
    vm.createContext(box);
    vm.runInContext(SUKV_SRC, box, { filename: 'su-kv.js' });
    const raw = p => { raws.push(clone(p)); return Promise.resolve({ ok: true, rev: 99, data: null }); };
    return { kv: box.SUKv, rpcs, froms, raws, raw, writes };
  }
  {
    let k = makeKv();
    let v = await k.kv.readRouted({ action: 'get', key: 'care_schedule_v2' });
    t('見るだけの読み取り（週間計画）: 新しい保存先から読む（kv_get）', v && v.ok === true && v.rev === 4 && k.rpcs.join() === 'kv_get', { v, rpcs: k.rpcs });
    k = makeKv();
    v = await k.kv.readRouted({ action: 'pull', keys: ['wsday_2026-11-09', 'wsday_2026-11-10'] });
    t('見るだけの読み取り（ワークスケジュールの日ごと）: 新しい保存先から読む', v && v.ok === true && Object.keys(v.entries).length === 2 && k.froms.join() === 'kv_entries', v);
    k = makeKv();
    const r = await k.kv.call({ action: 'get', key: 'care_schedule_v2' }, k.raw);
    t('画面の通信の入口（週間計画の get）: 新しい保存先から読み、Google を呼ばない', r && r.ok === true && r.rev === 4 && k.raws.length === 0, { r, raws: k.raws });
    k = makeKv();
    const w = await k.kv.call({ action: 'put', key: 'care_schedule_v2', rev: 4, data: { residents: [] } }, k.raw);
    t('★現場のアカウントは週間計画を書かない（kv_put を呼ばない・Google へも送らない）', w && w.ok === false && w.error === 'forbidden' && k.rpcs.indexOf('kv_put') < 0 && k.raws.length === 0, { w, rpcs: k.rpcs });
    k = makeKv();
    const w2 = await k.kv.call({ action: 'put', key: 'ws_weekly_master_v1', rev: 1, data: {} }, k.raw);
    t('★現場のアカウントは週の型も書かない', w2 && w2.error === 'forbidden' && k.rpcs.indexOf('kv_put') < 0, w2);
    k = makeKv({ session: false });
    v = await k.kv.readRouted({ action: 'get', key: 'care_schedule_v2' });
    t('ログインしていない（控えが無い） → null＝呼び手が今までどおり Google', v === null && k.rpcs.length === 0, v);
    k = makeKv({ status: STATUS.SIGNED_OUT });
    v = await k.kv.readRouted({ action: 'get', key: 'care_schedule_v2' });
    t('ログインが切れている → null（Google）', v === null && k.rpcs.length === 0, v);
    k = makeKv({ checkThrows: true });
    v = await k.kv.readRouted({ action: 'get', key: 'care_schedule_v2' });
    t('ログインを確かめられない → null（Google）', v === null, v);
    k = makeKv({ rpcError: { code: 'XX000' } });
    v = await k.kv.readRouted({ action: 'get', key: 'care_schedule_v2' });
    t('読めなかった → null（Google）', v === null, v);
    k = makeKv();
    await k.kv.readRouted({ action: 'get', key: 'care_schedule_v2' });
    t('読んだ予定を端末に書かない（スイッチの控えのほかは書かない）', k.writes.every(x => x === 'su_backend_flags'), k.writes);
  }

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
