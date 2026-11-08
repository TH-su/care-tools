/* 画面の版数の見張りを、入居者マスタを切り替えた後は新しい保存先の版数から読む口（su-res-read.js の SUResRead.stateRev）の試験
   （2026-11-08 新設・写し返しを止める計画の入居者マスタの順2・代表者の決定 2026-11-07 問い6=A）
   実行: node check/unit/res_staterev_test.js
   対象を差し替える: RES_READ_JS=/tmp/変異版.js node check/unit/res_staterev_test.js

   守ること:
     A スイッチ master_live が切・読めない時は、Google へ聞く関数をそのまま呼ぶ（データベースを呼ばない）
     B 現場の端末・ログインしていない・ログインの部品が無い・確かめられない・現場のアカウントは Google（データベースを呼ばない）
     C 事務所・管理者のログインで印が「切り替えた後」の時だけ、新しい保存先の版数を { ok:true, rev, srev:0 } で返し、Google を呼ばない。
       呼ぶのは res_mode_get だけ。応答は fetch と同じく json()・text() で読める（as:'json' なら読んだ形）
     D 写しの期間・0036 の前（関数が無い）は Google
     E ログインした後の断り・通信の失敗・時間切れ・形の違いは Google へ流さずに失敗にする
     F 遅れて届いた答えは捨てる: 同じ key で後から出した問い合わせがある・答えの前に端末の用途が現場へ変わった時は失敗
     G 見張りの動き: 読み先が Google から新しい保存先へ替わった時に名簿の読み直しは1回だけ。その後は版数が動いた時だけ読み直す
       （名簿を新しい保存先から読む時は版数を同梱しないので、基準が食い違って読み直しが続くことはない）
     H 画面のつなぎ: 版数を見張る7画面は SUResRead.stateRev を通し、Google への照会はその中の関数に今の形のまま残る。
       週間計画の名簿の読み取りも officeOnly を通す（見張りと名簿の読み先をそろえる）。SURoster を呼ぶ画面はどれも officeOnly の内側
     I 端末に保存しない（localStorage へ書かない）
   ★架空データのみ（数字だけ・氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.RES_READ_JS || path.join(ROOT, 'su-res-read.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });

const ON = { supabase: { master_live: true } };
function load(o) {
  o = o || {};
  const writes = [];
  const store = Object.assign({ su_backend_flags: o.flags === undefined ? JSON.stringify(ON) : JSON.stringify(o.flags) }, o.store || {});
  const ctx = {
    window: {}, JSON, Object, Array, String, Number, Math, Error, Promise, Date, RegExp, isNaN, isFinite, parseInt, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = v; }, removeItem: k => { writes.push(k); } },
    fetch: () => Promise.reject(new Error('no network'))
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUResRead, writes, store };
}
/* 架空のログインとデータベース。db.mode・db.rev を後から変えられる */
function auth(o) {
  const calls = [];
  const db = { mode: o.mode || 'shadow', rev: o.rev == null ? 7 : o.rev };
  const A = { STATUS: { OK: 'ok' },
    check: async () => { if (o.checkThrows) throw new Error('x'); return o.signedOut ? { status: 'signed_out' } : { status: 'ok', role: o.role || 'office' }; },
    client: () => ({ rpc: (n, a) => {
      calls.push(n);
      if (o.hang) return new Promise(() => {});
      if (o.reject) return Promise.reject(new Error('network'));
      if (n === 'res_mode_get') {
        if (o.modeErr) return Promise.resolve({ error: o.modeErr });
        const data = o.badShape ? { ok: true, mode: db.mode, stateRev: 'x' } : { ok: true, mode: db.mode, stateRev: db.rev };
        return o.delay ? new Promise(ok => setTimeout(() => ok({ data }), o.delay)) : Promise.resolve({ data });
      }
      if (n === 'res_roster') return Promise.resolve({ data: { ok: true, rows: [{ id: 'r1', name: '見本 甲', active: true, hospitalized: db.hosp === true }] } });
      return Promise.resolve({ error: { code: 'PGRST202' } });
    } }) };
  return { io: { auth: async () => A }, calls, db };
}
/* Google の stateRev の応答（fetch の応答と同じ形）。呼ばれた回数を数える */
function gasRevFn(rev, srev) {
  const f = () => { f.n++; return Promise.resolve({ ok: true, json: async () => ({ ok: true, rev: f.rev, srev: f.srev }), text: async () => JSON.stringify({ ok: true, rev: f.rev, srev: f.srev }) }); };
  f.n = 0; f.rev = rev; f.srev = srev;
  return f;
}
async function run(R, a, opts, gas) {
  gas = gas || gasRevFn(100, 1730000000000);
  let r = null, err = null;
  try { r = await R.stateRev(gas, opts || {}, a.io); } catch (e) { err = e; }
  let j = null;
  try { j = r && typeof r.json === 'function' ? await r.json() : r; } catch (e) { j = null; }
  return { r, j, err, gas: gas.n, rpc: a.calls.slice() };
}

(async () => {
  console.log('A スイッチが切');
  for (const [label, flags] of [['スイッチが無い', null], ['master_live が切', { supabase: { master_live: false } }], ['形の違うスイッチ', { supabase: 'x' }]]) {
    const { R } = load({ flags });
    const a = auth({ mode: 'live', role: 'office' });
    const x = await run(R, a);
    t(label + ' → Google へ聞き、データベースを呼ばない', x.gas === 1 && x.rpc.length === 0 && x.j && x.j.rev === 100, x);
  }

  console.log('B 事務所PCの事務所・管理者のログインでない時は Google');
  {
    let x = await run(load({ store: { su_device_role: 'field' } }).R, auth({ mode: 'live', role: 'office' }));
    t('現場の端末 → Google（データベースを呼ばない）', x.gas === 1 && x.rpc.length === 0, x);
    x = await run(load().R, auth({ mode: 'live', signedOut: true }));
    t('ログインしていない → Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await run(load().R, { io: { auth: async () => null }, calls: [] });
    t('ログインの部品が読めない → Google', x.gas === 1, x);
    x = await run(load().R, auth({ mode: 'live', checkThrows: true }));
    t('ログインを確かめられない → Google', x.gas === 1 && x.rpc.length === 0, x);
    x = await run(load().R, auth({ mode: 'live', role: 'field' }));
    t('現場のアカウント → Google（データベースを呼ばない）', x.gas === 1 && x.rpc.length === 0, x);
  }

  console.log('C 事務所・管理者のログイン・切り替えた後');
  {
    const { R } = load();
    const a = auth({ mode: 'live', role: 'office', rev: 512 });
    const x = await run(R, a);
    t('新しい保存先の版数を {ok, rev, srev:0} で返し、Google を呼ばない', x.gas === 0 && x.j && x.j.ok === true && x.j.rev === 512 && x.j.srev === 0 && Object.keys(x.j).join() === 'ok,rev,srev', x);
    t('呼ぶのは res_mode_get だけ（名簿は読まない）', x.rpc.join() === 'res_mode_get', x.rpc);
    t('fetch の応答と同じく ok・text() で読める', x.r.ok === true && JSON.parse(await x.r.text()).rev === 512);
    const y = await run(load().R, auth({ mode: 'live', role: 'admin', rev: 3 }));
    t('管理者も同じ', y.gas === 0 && y.j.rev === 3, y);
    const z = await run(load().R, auth({ mode: 'live', role: 'office', rev: 9 }), { as: 'json' });
    t("as:'json' は読んだ形のまま", z.r && typeof z.r.json !== 'function' && z.r.rev === 9 && z.r.srev === 0, z);
    /* 名簿の読み取り（call）と同じ印で動く: 見張りが読んだ印を使い、名簿の読み取りで印を読み直さない */
    a.calls.length = 0;
    const rr = await R.call({ action: 'getRoster' }, () => Promise.resolve({ via: 'gas' }), { screen: 'care-schedule' }, a.io);
    t('見張りが読んだ印を名簿の読み取りも使う（印を2回読まない）', Array.isArray(rr.roster) && a.calls.join() === 'res_roster', a.calls);
  }

  console.log('D 写しの期間・0036 の前');
  {
    let x = await run(load().R, auth({ mode: 'shadow', role: 'office' }));
    t('写しの期間 → Google', x.gas === 1 && x.j.rev === 100 && x.rpc.join() === 'res_mode_get', x);
    x = await run(load().R, auth({ mode: 'live', role: 'office', modeErr: { code: 'PGRST202' } }));
    t('関数が無い → Google', x.gas === 1, x);
  }

  console.log('E ログインした後の断り・失敗は Google へ流さない');
  for (const [label, o, re] of [
    ['断られた（42501）', { modeErr: { code: '42501' } }, /権限/],
    ['データベースの失敗', { modeErr: { code: 'XX000', message: 'x' } }, /読めませんでした/],
    ['通信の失敗', { reject: true }, /読めませんでした/],
    ['形が違う', { badShape: true }, /形/]]) {
    const x = await run(load().R, auth(Object.assign({ mode: 'live', role: 'office' }, o)));
    t(label + ' → 失敗（Google を呼ばない）', x.gas === 0 && x.err && re.test(x.err.message), { gas: x.gas, err: x.err && x.err.message });
  }
  {
    const x = await run(load().R, auth({ mode: 'live', role: 'office', hang: true }), { timeoutMs: 30 });
    t('時間切れ → 失敗（Google を呼ばない）', x.gas === 0 && x.err && x.err.code === 'timeout', { gas: x.gas, err: x.err && x.err.code });
  }

  console.log('F 遅れて届いた答えは捨てる');
  {
    const { R } = load();
    const slow = auth({ mode: 'live', role: 'office', rev: 1, delay: 60 });
    const fast = auth({ mode: 'live', role: 'office', rev: 2 });
    const g = gasRevFn(100, 1);
    const p1 = R.stateRev(g, { key: 'k' }, slow.io).then(r => r.json(), e => ({ err: e.code }));
    await new Promise(ok => setTimeout(ok, 5));
    const p2 = R.stateRev(g, { key: 'k' }, fast.io).then(r => r.json(), e => ({ err: e.code }));
    const [a1, a2] = await Promise.all([p1, p2]);
    t('後から出した問い合わせがあれば、先の答えは捨てる', a1.err === 'stale' && a2.rev === 2 && g.n === 0, [a1, a2]);
    const p3 = R.stateRev(g, { key: 'other' }, auth({ mode: 'live', role: 'office', rev: 5 }).io).then(r => r.json());
    t('別の key は互いに捨てない', (await p3).rev === 5);
  }
  {
    const L = load();
    const a = auth({ mode: 'live', role: 'office', rev: 1, delay: 40 });
    const p = L.R.stateRev(gasRevFn(1, 1), {}, a.io).then(r => r.json(), e => ({ err: e.code }));
    await new Promise(ok => setTimeout(ok, 5));
    L.store.su_device_role = 'field';
    t('答えの前に端末の用途が現場へ変わった → 捨てる', (await p).err === 'stale');
  }

  console.log('G 見張りの動き（画面の見張りと同じ比べ方の見本）');
  {
    /* 画面の見本: 版数が前回と違えば名簿を読み直し、名簿に版数が同梱されていればそれを基準にする（全支援俯瞰・ワークスケジュール等と同じ） */
    const L = load({ flags: { supabase: { master_live: true } } });
    const R = L.R;
    const a = auth({ mode: 'shadow', role: 'office', rev: 40 });
    const gas = gasRevFn(40, 1730000000000);
    const gasRoster = () => Promise.resolve({ roster: [{ id: 'r1', active: true }], stateRev: gas.rev, srev: gas.srev });
    let base = null, rereads = 0;
    async function tick() {
      let j;
      try { const r = await R.stateRev(gas, { key: 'sim' }, a.io); j = await r.json(); } catch (e) { return; }
      if (!j || j.ok !== true) return;
      const ch = !base || j.rev !== base.rev || j.srev !== base.srev;
      base = { rev: j.rev, srev: j.srev };
      if (!ch) return;
      rereads++;
      const d = await R.call({ action: 'getRoster' }, gasRoster, { screen: 'sim', officeOnly: true }, a.io);
      if (typeof d.stateRev === 'number' || typeof d.srev === 'number') base = { rev: d.stateRev, srev: d.srev };
    }
    await tick(); rereads = 0;   // 開いた時の基準
    for (let i = 0; i < 3; i++) await tick();
    t('切り替える前: 版数が動かなければ読み直さない', rereads === 0, rereads);
    a.db.mode = 'live'; a.db.rev = 41; R._reset();
    for (let i = 0; i < 5; i++) await tick();
    t('切り替えた後: 読み先が替わった時に1回だけ読み直し、その後は続かない', rereads === 1, rereads);
    const n0 = gas.n; await tick(); await tick();
    t('切り替えた後の見張りで Google を呼ばない', gas.n === n0, gas.n - n0);
    gas.rev = 99;   // Google の版数が写し返しで動いても
    await tick();
    t('Google の版数が動いても読み直さない（新しい保存先の版数だけを見る）', rereads === 1, rereads);
    a.db.rev = 42;
    await tick(); await tick();
    t('新しい保存先の版数が動いた時は1回読み直す', rereads === 2, rereads);
  }

  console.log('H 画面のつなぎ');
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const SCREENS = [
    ['resident-master.html', /var gasRev=function\(\)\{return fetchWithTimeout\(url,\{method:'GET',cache:'no-store',redirect:'follow'\},10000\)\};[\s\S]{0,200}SUResRead\.stateRev\(gasRev,\{key:'srev'\}\)/],
    ['care-schedule.html', /var csRevGas_ = function\(\)\{ return csFetchTimeout_\(cfg\.url \+ sep \+ 'action=stateRev', \{ method: 'GET', redirect: 'follow' \}, CS_STATEREV_PROBE_TIMEOUT_MS\); \};[\s\S]{0,200}SUResRead\.stateRev\(csRevGas_, \{ key: 'care' \}\)/],
    ['weight-record.html', /var gasRev = function\(\)\{ return fetchTO\(url, \{ cache:'no-store' \}, WR_SREV_TIMEOUT_MS\); \};[\s\S]{0,200}SUResRead\.stateRev\(gasRev, \{ key:'weight' \}\)/],
    ['support-overview.html', /var gasRev = function \(\) \{ return fetch\(c\.url \+ \(c\.url\.indexOf\('\?'\)>=0\?'&':'\?'\) \+ 'action=stateRev',\s*\{method:'GET',cache:'no-store',redirect:'follow'\}\); \};[\s\S]{0,200}SUResRead\.stateRev\(gasRev, \{ key: 'support' \}\)/],
    ['visit-overview.html', /var gasRev = function \(\) \{ return fetch\(c\.url \+ \(c\.url\.indexOf\('\?'\)>=0\?'&':'\?'\) \+ 'action=stateRev',\s*\{method:'GET',cache:'no-store',redirect:'follow'\}\); \};[\s\S]{0,200}SUResRead\.stateRev\(gasRev, \{ key: 'visit' \}\)/],
    ['daycare-roster.html', /var gasRev = function\(\)\{ return SU\.data\.kvRaw\(\{ action: 'stateRev' \}, \{ endpoint: cfg\.url \}\); \};[\s\S]{0,200}SUResRead\.stateRev\(gasRev, \{ key: 'daycare', as: 'json' \}\)/]
  ];
  /* 今までの見張りの形（照会の直後に .then で応答を読む）。入口に通した後は残らない */
  const OLD = [
    /fetchWithTimeout\(url,\{method:'GET',cache:'no-store',redirect:'follow'\},10000\)\s*\.then/,
    /csFetchTimeout_\(cfg\.url \+ sep \+ 'action=stateRev'[^;]*\)\s*\.then/,
    /await fetchTO\(url, \{ cache:'no-store' \}, WR_SREV_TIMEOUT_MS\);/,
    /'action=stateRev',\s*\{ ?method: ?'GET', ?cache: ?'no-store', ?redirect: ?'follow' ?\}\)\s*\.then/,
    /SU\.data\.kvRaw\(\{ action: 'stateRev' \}, \{ endpoint: cfg\.url \}\)\s*\.then/
  ];
  for (const [f, re] of SCREENS) {
    const H = read(f);
    t(f + ': 見張りは SUResRead.stateRev を通し、Google への照会は今の形のまま中の関数に残る', re.test(H));
    t(f + ': su-res-read.js を読み込む（版は 2026-11-08.2）', /<script src="su-res-read\.js\?v=2026-11-08\.2"><\/script>/.test(H));
    t(f + ': 入口を通らない見張りの照会（照会のすぐ後に応答を読む今までの形）が残っていない', !OLD.some(o => o.test(H)));
  }
  {
    const H = read('care-schedule.html');
    t('週間計画: 名簿の読み取りは officeOnly を通し、写し→Google の今の読み方はその内側', /SUResRead\.call\(\{ action: 'getRoster' \}, csRosterOld_, \{ screen: 'care-schedule', officeOnly: true \}\)/.test(H)
      && /var csRosterOld_ = function\(\)\{\s*try\{ return window\.SURoster \? window\.SURoster\.getRoster\(csRosterRaw_, \{ where: 'care', masterUrl: cfg\.url, withRev: true \}\) : csRosterRaw_\(\); \}/.test(H));
  }
  for (const f of fs.readdirSync(ROOT).filter(n => /\.html$/.test(n))) {
    const H = read(f);
    const n = (H.match(/SURoster\.getRoster\(/g) || []).length;
    if (!n) continue;
    t(f + ': SURoster を呼ぶ名簿の読み取りは officeOnly の内側', (H.match(/officeOnly: ?true/g) || []).length >= n);
  }

  console.log('I 端末に保存しない');
  {
    const L = load();
    await run(L.R, auth({ mode: 'live', role: 'office' }));
    await run(L.R, auth({ mode: 'shadow', role: 'office' }));
    t('localStorage へ書かない', L.writes.length === 0 && !/setItem/.test(SRC));
  }

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
