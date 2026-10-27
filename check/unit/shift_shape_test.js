/* 勤務表の応答の形と「最終更新：誰・いつ」の試験（2026-10-27 本人指示・代表者の決定）。
   守りたいこと:
     G 応答の形: 勤務表アプリの通信（callShift）の各動作 pull・push・head・lockStatus・lockAcquire・lockRenew・lockRelease・
       shiftStatus について、Supabase 版の応答のキーの集まりと型が Google 版（統合 GAS）と同じであること。
       conflict・schedwipe・編集権の断り（他の人が編集中）・閲覧の役割（現場など保存できない役割）を含める。
       ・Google 版の見本は、勤務表を実際に受け持つ統合 GAS（ワークスケジュールの正本の gas/Code.gs の actionPull・actionPush・
         wsHead・actionLock*・actionShiftStatus と doPost）の返す形を、架空の値で写したもの。
         （シフトの正本の gas/Code.gs は push・pull・list・ping だけの旧版で、編集権の動作が無いため見本にしない）
       ・Supabase 版の見本は care-backend 0009（shift_pull / shift_push / shift_lock_* / shift_status）の返す形を架空の値で写し、
         偽のデータベースから su-kv.js（本物）の callShift を通して受け取る。
       ・意図した違いは「違う」と固定する（変わったら気づけるように）:
           pull … 現場のアカウントには Supabase が role:'ro' を足す（統合 GAS の応答には role が無い）
           閲覧の役割の書き込み … 統合 GAS（閲覧専用の合言葉）は error:'unauthorized'、Supabase は error:'forbidden'（形は同じ）
     H SUKv.shiftLastUpdate: スイッチ切・未ログイン・関数がまだ無い（PGRST202）・失敗で null、正常で items を返す、
       メールらしい値を返さない、勤務表のキーだけ・最大 20 を送る、ログインの帯を出さない、Google へは何も送らない
     I 画面の表示の組み立て（shift-app.html の本物の lastUpdateText_）: 日本時間・「名前なし」・置き場と印刷に出さないこと
   実行: node check/unit/shift_shape_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const clone = o => JSON.parse(JSON.stringify(o));

/* ══ 砂場: su-kv.js（本物）＋偽のログイン・データベース（sukv_routed_test.js の makeKv と同じ作り） ══ */
const SUKV_SRC = read('su-kv.js');
const STATUS = { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' };
const SESSION_LS = 'sb-jhbernqawjrzqwrmqrih-auth-token';
const ON = { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: true };
const OFF = { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false };
function makeKv(o) {
  o = o || {};
  const ls = new Map();
  const flags = o.flags || ON;
  ls.set('su_backend_flags', JSON.stringify({ supabase: flags }));
  if (o.session !== false) ls.set(SESSION_LS, '{"x":1}');
  const banners = [], rpcs = [], raws = [], checks = [];
  const sb = {
    rpc(name, args) {
      rpcs.push({ name, args: clone(args) });
      if (o.rpcThrows) throw new Error('boom');
      return Promise.resolve(o.rpc ? o.rpc(name, args) : { data: null });
    }
  };
  const body = { children: [], appendChild(el) { this.children.push(el); banners.push(el); } };
  const box = {
    console, JSON, Math, Date, Number, String, Array, Object, Promise, Error,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), key: () => null, length: 0 },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: flags }) }),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/care-tools/shift-app.html' },
    document: {
      body, head: { appendChild() {} }, visibilityState: 'visible', addEventListener() {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' })
    }
  };
  box.window = box;
  box.SUAuth = {
    STATUS,
    check: () => { checks.push(1); return o.checkThrows ? Promise.reject(new Error('net')) : Promise.resolve({ status: o.status || STATUS.OK, role: o.role || 'office' }); },
    client: () => sb
  };
  vm.createContext(box);
  vm.runInContext(SUKV_SRC, box, { filename: 'su-kv.js' });
  const raw = p => { raws.push(clone(p)); return Promise.resolve({ ok: true }); };
  return { kv: box.SUKv, banners, rpcs, raws, checks, raw };
}

/* 形＝キーの集まりと型（入れ子も見る）。data（勤務表の中身）は中身の形が利用者ごとに違うので型だけ見る */
function shape(v, depth) {
  depth = depth || 0;
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v !== 'object') return typeof v;
  if (depth >= 3) return 'object';
  const out = {};
  Object.keys(v).sort().forEach(k => { out[k] = k === 'data' ? (v[k] === null ? 'null' : typeof v[k]) : shape(v[k], depth + 1); });
  return out;
}
const same = (a, b) => JSON.stringify(shape(a)) === JSON.stringify(shape(b));

(async () => {
  console.log('\n— G. 勤務表の応答の形: Supabase 版（callShift 経由）が Google 版（統合 GAS の見本）と同じ —');
  {
    const T0 = 1793000000000;            /* 架空の時刻（エポックのミリ秒） */
    const ISO = '2026-10-27T01:00:00.000Z';
    /* 各場面: [名前, 動作の要求, Google 版の見本, Supabase 関数の名前, Supabase 関数の応答（0009 の形・架空の値）, 役割] */
    const cases = [
      ['pull（キー指定）', { action: 'pull', keys: ['staff', 'sched:2026-10:plan'] },
        { ok: true, entries: { staff: { key: 'staff', rev: 3, updatedAt: ISO, data: [{ id: 's1', name: '架空 一' }] }, 'sched:2026-10:plan': { key: 'sched:2026-10:plan', rev: 7, updatedAt: ISO, data: { cells: {} } } } },
        'shift_pull', { ok: true, entries: { staff: { key: 'staff', rev: 3, data: [{ id: 's1', name: '架空 一' }], updatedAt: '2026-10-27T01:00:00.123456+00:00' }, 'sched:2026-10:plan': { key: 'sched:2026-10:plan', rev: 7, data: { cells: {} }, updatedAt: '2026-10-27T01:00:00+00:00' } } }],
      ['pull（全部・記録なし）', { action: 'pull' }, { ok: true, entries: {} }, 'shift_pull', { ok: true, entries: {} }],
      ['push 成功', { action: 'push', key: 'sched:2026-10:plan', baseRev: 7, data: { cells: {} } }, { ok: true, rev: 8 }, 'shift_push', { ok: true, rev: 8 }],
      ['push conflict（版が古い）', { action: 'push', key: 'sched:2026-10:plan', baseRev: 5, data: { cells: {} } }, { conflict: true, serverRev: 7 }, 'shift_push', { conflict: true, serverRev: 7 }],
      ['push schedwipe（勤務表の一括消失）', { action: 'push', key: 'sched:2026-10:plan', baseRev: 7, data: { cells: {} } }, { ok: false, error: 'schedwipe', was: 120, now: 3, serverRev: 7 }, 'shift_push', { ok: false, error: 'schedwipe', was: 120, now: 3, serverRev: 7 }],
      ['push staffshrink（名簿の大幅減）', { action: 'push', key: 'staff', baseRev: 3, data: [] }, { ok: false, error: 'staffshrink', was: 16, now: 2, serverRev: 3 }, 'shift_push', { ok: false, error: 'staffshrink', was: 16, now: 2, serverRev: 3 }],
      ['push defaultsoverwrite（既定値で上書き）', { action: 'push', key: 'symbols', baseRev: 0, data: [], defaultsInit: true }, { ok: false, error: 'defaultsoverwrite', serverRev: 2 }, 'shift_push', { ok: false, error: 'defaultsoverwrite', serverRev: 2 }],
      ['push editlock（他の人が編集中）', { action: 'push', key: 'sched:2026-10:plan', baseRev: 7, data: { cells: {} } }, { ok: false, error: 'editlock', name: '架空 事務', expiresAt: T0 }, 'shift_push', { ok: false, error: 'editlock', name: '架空 事務', expiresAt: T0 }],
      ['push editlock-required（厳格モードで券なし）', { action: 'push', key: 'sched:2026-10:plan', baseRev: 7, data: { cells: {} } }, { ok: false, error: 'editlock-required' }, 'shift_push', { ok: false, error: 'editlock-required' }],
      ['head', { action: 'head', keys: ['staff', 'req:2026-10'] }, { ok: true, revs: { staff: 3, 'req:2026-10': 0 } }, 'shift_status', { ok: true, revs: { staff: 3, 'req:2026-10': 0 }, lock: { name: '架空 事務', acquiredAt: T0, expiresAt: T0 + 1 } }],
      ['lockStatus（誰も編集していない）', { action: 'lockStatus' }, { ok: true, lock: null }, 'shift_lock_status', { ok: true, lock: null }],
      ['lockStatus（編集中）', { action: 'lockStatus' }, { ok: true, lock: { name: '架空 事務', acquiredAt: T0, expiresAt: T0 + 1 } }, 'shift_lock_status', { ok: true, lock: { name: '架空 事務', acquiredAt: T0, expiresAt: T0 + 1 } }],
      ['lockAcquire 成功', { action: 'lockAcquire', deviceId: 'dev-a', name: '事務PC' }, { ok: true, lease: { token: 'tok-x', epoch: 4, expiresAt: T0 } }, 'shift_lock_acquire', { ok: true, lease: { token: 'tok-x', epoch: 4, expiresAt: T0 } }],
      ['lockAcquire lockheld（他の人が編集中）', { action: 'lockAcquire', deviceId: 'dev-a', name: '事務PC' }, { ok: false, error: 'lockheld', name: '架空 事務', expiresAt: T0 }, 'shift_lock_acquire', { ok: false, error: 'lockheld', name: '架空 事務', expiresAt: T0 }],
      ['lockAcquire nodevice', { action: 'lockAcquire', deviceId: '', name: '' }, { ok: false, error: 'nodevice' }, 'shift_lock_acquire', { ok: false, error: 'nodevice' }],
      ['lockRenew 成功', { action: 'lockRenew', deviceId: 'dev-a', editToken: 'tok-x' }, { ok: true, lease: { expiresAt: T0 } }, 'shift_lock_renew', { ok: true, lease: { expiresAt: T0 } }],
      ['lockRenew locklost（引き継がれた）', { action: 'lockRenew', deviceId: 'dev-a', editToken: 'tok-x' }, { ok: false, error: 'locklost', name: '架空 事務' }, 'shift_lock_renew', { ok: false, error: 'locklost', name: '架空 事務' }],
      ['lockRenew locklost（失効・保持者なし）', { action: 'lockRenew', deviceId: 'dev-a', editToken: 'tok-x' }, { ok: false, error: 'locklost', name: '' }, 'shift_lock_renew', { ok: false, error: 'locklost', name: '' }],
      ['lockRelease 成功', { action: 'lockRelease', deviceId: 'dev-a', editToken: 'tok-x' }, { ok: true }, 'shift_lock_release', { ok: true }],
      ['lockRelease locklost（他の端末の編集権）', { action: 'lockRelease', deviceId: 'dev-a', editToken: 'tok-y' }, { ok: false, error: 'locklost' }, 'shift_lock_release', { ok: false, error: 'locklost' }],
      ['shiftStatus（編集中）', { action: 'shiftStatus', keys: ['staff'] }, { ok: true, revs: { staff: 3 }, lock: { name: '架空 事務', acquiredAt: T0, expiresAt: T0 + 1 } }, 'shift_status', { ok: true, revs: { staff: 3 }, lock: { name: '架空 事務', acquiredAt: T0, expiresAt: T0 + 1 } }],
      ['shiftStatus（誰も編集していない）', { action: 'shiftStatus', keys: ['staff'] }, { ok: true, revs: { staff: 3 }, lock: null }, 'shift_status', { ok: true, revs: { staff: 3 }, lock: null }]
    ];
    const seen = {};
    for (const [nm, req, gas, fn, sbReply, role] of cases) {
      const k = makeKv({ role: role || 'office', rpc: (name) => (name === fn ? { data: clone(sbReply) } : { data: null }) });
      const r = await k.kv.callShift(clone(req), k.raw);
      seen[req.action] = 1;
      t('★G ' + req.action + ' ' + nm + ': キーの集まりと型が Google 版と同じ', same(r, gas) && k.rpcs.some(x => x.name === fn) && k.raws.length === 0,
        { supabase: shape(r), google: shape(gas) });
    }
    t('G 8つの動作をすべて見た（pull・push・head・lockStatus・lockAcquire・lockRenew・lockRelease・shiftStatus）',
      ['pull', 'push', 'head', 'lockStatus', 'lockAcquire', 'lockRenew', 'lockRelease', 'shiftStatus'].every(a => seen[a]), Object.keys(seen));

    /* 意図した違い 1: 現場のアカウントの pull には role:'ro' が付く（勤務表アプリはこれで閲覧モードになる） */
    const gasPull = { ok: true, entries: { staff: { key: 'staff', rev: 3, updatedAt: ISO, data: [] } } };
    let k = makeKv({ role: 'field', rpc: () => ({ data: { ok: true, entries: { staff: { key: 'staff', rev: 3, data: [], updatedAt: ISO } }, role: 'ro' } }) });
    let r = await k.kv.callShift({ action: 'pull', keys: ['staff'] }, k.raw);
    const extra = Object.keys(r).filter(x => !(x in gasPull));
    t('★G 意図した違い: 現場のアカウントの pull は Google 版のキーに role（\'ro\'）だけを足した形（ほかのキー・型は同じ）',
      JSON.stringify(extra) === '["role"]' && r.role === 'ro' && same((({ role, ...rest }) => rest)(r), gasPull), { extra, r });

    /* 閲覧の役割: 現場・閲覧のアカウントは読む動作（pull・head・lockStatus・shiftStatus）が Google 版と同じ形で通る */
    for (const role of ['field', 'viewer']) {
      const okRead = [];
      for (const [req, fn, rep, gas] of [
        [{ action: 'head', keys: ['staff'] }, 'shift_status', { ok: true, revs: { staff: 3 }, lock: null }, { ok: true, revs: { staff: 3 } }],
        [{ action: 'lockStatus' }, 'shift_lock_status', { ok: true, lock: null }, { ok: true, lock: null }],
        [{ action: 'shiftStatus', keys: ['staff'] }, 'shift_status', { ok: true, revs: { staff: 3 }, lock: null }, { ok: true, revs: { staff: 3 }, lock: null }]
      ]) {
        k = makeKv({ role, rpc: (name) => (name === fn ? { data: clone(rep) } : { data: null }) });
        r = await k.kv.callShift(req, k.raw);
        okRead.push(same(r, gas));
      }
      t('G 閲覧の役割（' + role + '）でも head・lockStatus・shiftStatus は Google 版（閲覧専用の合言葉でも読める）と同じ形', okRead.every(Boolean), okRead);
    }
    /* 意図した違い 2: 閲覧の役割の書き込みは、形は同じ・値が違う（unauthorized / forbidden） */
    const gasRo = { ok: false, error: 'unauthorized' };   /* 統合 GAS の doPost: 閲覧専用の合言葉で isWriteAction_ が真 */
    for (const role of ['field', 'viewer']) {
      const res = [];
      for (const req of [{ action: 'push', key: 'staff', baseRev: 3, data: [] }, { action: 'lockAcquire', deviceId: 'd', name: 'n' },
        { action: 'lockRenew', deviceId: 'd', editToken: 't' }, { action: 'lockRelease', deviceId: 'd', editToken: 't' }]) {
        k = makeKv({ role, rpc: () => ({ data: { ok: true } }) });
        res.push(await k.kv.callShift(req, k.raw));
        if (k.rpcs.length || k.raws.length) res.push('送ってしまった');
      }
      t('★G 意図した違い: 閲覧の役割（' + role + '）の push・編集権の取得/延長/返却は Google 版と同じ形 {ok:false, error} で、値は forbidden（Google は unauthorized）',
        res.length === 4 && res.every(x => typeof x === 'object' && same(x, gasRo) && x.error === 'forbidden'), res);
    }
    /* Supabase にだけある断り（badkey・nodata・toolarge・shadow）も {ok:false, error:文字, …} の形 */
    const sbOnly = [{ ok: false, error: 'badkey' }, { ok: false, error: 'nodata' }, { ok: false, error: 'toolarge' }, { ok: false, error: 'shadow', serverRev: 2 }];
    const onlyOk = [];
    for (const rep of sbOnly) {
      k = makeKv({ rpc: () => ({ data: clone(rep) }) });
      r = await k.kv.callShift({ action: 'push', key: 'staff', baseRev: 3, data: [] }, k.raw);
      onlyOk.push(r.ok === false && typeof r.error === 'string' && JSON.stringify(r) === JSON.stringify(rep));
    }
    t('G Supabase にだけある断り（badkey・nodata・toolarge・shadow）も {ok:false, error, …} のまま返す', onlyOk.every(Boolean), onlyOk);
  }

  console.log('\n— H. SUKv.shiftLastUpdate（最終更新：誰・いつ） —');
  {
    const ITEMS = { 'sched:2026-10:plan': { at: '2026-10-27T01:30:00.123456+00:00', by: '架空 事務' }, 'req:2026-10': { at: '2026-10-20T00:00:00+00:00', by: '' } };
    const okRpc = (items) => (name) => (name === 'shift_last_update' ? { data: { ok: true, items: clone(items || ITEMS) } } : { data: null });
    const KEYS = ['sched:2026-10:plan', 'sched:2026-10:actual', 'req:2026-10'];
    let k = makeKv({ rpc: okRpc() });
    t('H SUKv.shiftLastUpdate がある', typeof k.kv.shiftLastUpdate === 'function');
    let r = await k.kv.shiftLastUpdate(KEYS);
    const a = (k.rpcs[0] || {}).args;
    t('★H 正常: items を返す（記録のあるキーだけ・at と by）', r && JSON.stringify(r) === JSON.stringify(ITEMS), r);
    t('H 関数 shift_last_update へ勤務表のキーをそのまま渡す（p_keys）', k.rpcs.length === 1 && k.rpcs[0].name === 'shift_last_update' && JSON.stringify(a.p_keys) === JSON.stringify(KEYS), k.rpcs);
    t('H Google（rawGas）へは何も送らない・帯を出さない', k.raws.length === 0 && k.banners.length === 0);

    k = makeKv({ flags: OFF, rpc: okRpc() });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('★H スイッチ（shift）が切なら null（データベース・ログインに触れない）', r === null && k.rpcs.length === 0 && k.checks.length === 0, r);
    k = makeKv({ session: false, rpc: okRpc() });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('★H ログインの控えが無い（未ログイン）なら null（ログインを確かめない・帯を出さない）', r === null && k.rpcs.length === 0 && k.checks.length === 0 && k.banners.length === 0, r);
    for (const st of [STATUS.SIGNED_OUT, STATUS.DENIED, STATUS.MFA_VERIFY, STATUS.MFA_ENROLL, STATUS.ERROR]) {
      k = makeKv({ status: st, rpc: okRpc() });
      r = await k.kv.shiftLastUpdate(KEYS);
      t('H ログインが確かめられない（' + st + '）なら null・帯を出さない', r === null && k.rpcs.length === 0 && k.banners.length === 0, r);
    }
    k = makeKv({ checkThrows: true, rpc: okRpc() });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('H ログインの確認が通信で失敗したら null（例外を外に出さない）', r === null, r);
    k = makeKv({ rpc: () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.shift_last_update(p_keys) in the schema cache' } }) });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('★H 関数がまだ無い（PGRST202）なら null（やり直さない）', r === null && k.rpcs.length === 1, { r, n: k.rpcs.length });
    k = makeKv({ rpc: () => ({ error: { code: '42501', message: 'not allowed' } }) });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('H 権限の断り（42501）なら null', r === null, r);
    for (const [nm, rep] of [['ok:false', { data: { ok: false, error: 'badkey' } }], ['空', { data: null }], ['items 無し', { data: { ok: true } }], ['items が文字', { data: { ok: true, items: 'x' } }]]) {
      k = makeKv({ rpc: () => rep });
      r = await k.kv.shiftLastUpdate(KEYS);
      t('H 応答が ' + nm + ' なら null', r === null, r);
    }
    k = makeKv({ rpcThrows: true });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('H データベースの呼び出しが例外を投げても null（外に出さない）', r === null, r);
    let n = 0;
    k = makeKv({ rpc: (name) => (++n === 1 ? { error: { message: 'Failed to fetch' } } : okRpc()(name)) });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('H 通信の失敗は1回だけやり直す（su-kv の rpc と同じ）', r && k.rpcs.length === 2, { r, n: k.rpcs.length });

    k = makeKv({ rpc: okRpc({ staff: { at: '2026-10-27T00:00:00Z', by: 'taro@example.invalid' }, settings: { at: '2026-10-27T00:00:00Z', by: '架空 管理' } }) });
    r = await k.kv.shiftLastUpdate(['staff', 'settings']);
    t('★H by にメールらしい値（@ を含む）が来ても返さない（空にする＝画面は「名前なし」）', r && r.staff.by === '' && r.settings.by === '架空 管理' && !/@/.test(JSON.stringify(r)), r);
    k = makeKv({ rpc: okRpc({ staff: { at: '2026-10-27T00:00:00Z', by: 'A', email: 'x@example.invalid', uid: 'u-1' }, freee: { at: '', by: 'B' }, symbols: { by: 'C' }, other: { at: '2026-10-27T00:00:00Z', by: 'D' } }) });
    r = await k.kv.shiftLastUpdate(['staff', 'freee', 'symbols']);
    t('H 返すのは頼んだキーの at・by だけ（ほかの項目・頼んでいないキー・時刻の無い記録は捨てる）', r && JSON.stringify(r) === '{"staff":{"at":"2026-10-27T00:00:00Z","by":"A"}}', r);

    k = makeKv({ rpc: okRpc({}) });
    r = await k.kv.shiftLastUpdate(['staff', 'care_schedule_v2', 'wsday_2026-10-10', 'genogram_x', 'sched:2026-1:plan', '_shift_editlock']);
    t('H 勤務表のキーだけを送る（週間計画・日ごと・ほかのアプリ・形の違う月・内部の名前は送らない）', JSON.stringify(k.rpcs[0].args.p_keys) === '["staff"]', k.rpcs[0].args);
    k = makeKv({ rpc: okRpc({}) });
    r = await k.kv.shiftLastUpdate(Array.from({ length: 30 }, (_, i) => 'sched:2026-10:draft:d' + i));
    t('H 送るのは最大 20 キー', k.rpcs[0].args.p_keys.length === 20, k.rpcs[0].args.p_keys.length);
    for (const bad of [[], ['care_schedule_v2'], null, undefined, 'staff']) {
      k = makeKv({ rpc: okRpc() });
      r = await k.kv.shiftLastUpdate(bad);
      t('H 勤務表のキーが1つも無い（' + JSON.stringify(bad) + '）なら null（データベースに聞かない）', r === null && k.rpcs.length === 0, r);
    }
    k = makeKv({ role: 'field', rpc: okRpc() });
    r = await k.kv.shiftLastUpdate(KEYS);
    t('H 現場のアカウントでも読める（権限はデータベースが shift_pull と同じに決める）', r && r['req:2026-10'] && k.rpcs.length === 1, r);
    t('H 勤務表の通信の入口（handlesShift）は shift_last_update を受け持たない（Google との通信の形は変えない）',
      k.kv.handlesShift({ action: 'lastUpdate', keys: KEYS }) === false && k.kv.handlesShift({ action: 'shiftLastUpdate' }) === false);
  }

  console.log('\n— I. 画面の表示の組み立て（shift-app.html の本物） —');
  {
    const HTML = read('shift-app.html');
    const start = HTML.indexOf('    lastUpdateText_: function');
    let fn = null;
    if (start >= 0) {
      /* 終わりは「次のメソッドの手前の },」まで（中にかっこを持つ正規表現があるため行で切る） */
      const end = HTML.indexOf('\n    },', start);
      try { fn = new Function('return {' + HTML.slice(start, end + 6) + '};')().lastUpdateText_; } catch (e) { fn = null; }
    }
    t('I 画面に lastUpdateText_ がある', typeof fn === 'function');
    if (fn) {
      const K = ['sched:2026-10:plan', 'req:2026-10'];
      t('★I 時刻は日本時間の M/D HH:mm（UTC 15:05 → 翌日 00:05）', fn({ 'sched:2026-10:plan': { at: '2026-10-26T15:05:00.123456+00:00', by: '架空 事務' } }, K) === '最終更新：架空 事務・10/27 00:05',
        fn({ 'sched:2026-10:plan': { at: '2026-10-26T15:05:00.123456+00:00', by: '架空 事務' } }, K));
      t('I 年をまたぐ時刻も日本時間で数える（UTC 12/31 20:00 → 1/1 05:00）', fn({ 'req:2026-10': { at: '2026-12-31T20:00:00Z', by: 'テスト' } }, K) === '最終更新：テスト・1/1 05:00');
      t('★I 表示名が空なら「名前なし」', fn({ 'req:2026-10': { at: '2026-10-01T00:00:00Z', by: '' } }, K) === '最終更新：名前なし・10/1 09:00');
      t('I いちばん新しい保存を出す', fn({ 'sched:2026-10:plan': { at: '2026-10-01T00:00:00Z', by: '古' }, 'req:2026-10': { at: '2026-10-02T00:00:00Z', by: '新' } }, K) === '最終更新：新・10/2 09:00');
      t('I null・空・読めない時刻は何も出さない（空の文字）', fn(null, K) === '' && fn({}, K) === '' && fn({ 'req:2026-10': { at: 'x', by: 'A' } }, K) === '');
    }
    t('★I 置き場はツールバーの同期の札（#syncBadge）の直後・noprint・最初は hidden・data-k なし',
      /<span id="syncBadge"[^\n]*<\/span>\n[^\n]*\n\s*<span id="lastUpdate" class="noprint" hidden><\/span>/.test(HTML) && !/id="lastUpdate"[^>]*data-k/.test(HTML));
    t('I 印刷ではツールバーと noprint を消す（@media print）', /@media print \{[\s\S]{0,200}#toolbar,[^}]*\.noprint[^}]*display: none !important/.test(HTML));
    t('I 表示は textContent で入れる（innerHTML を使わない）', /showLastUpdate_: function \(el, text\) \{\n\s*el\.textContent = text \|\| '';\n\s*el\.hidden = !text;/.test(HTML));
    t('I 読み込んだ時（loadMonth の終わり）と、同期中→同期済みの時に読み直す',
      /this\.maybePullDraftBody_\(\);\n\s*this\.refreshLastUpdate_\(\);/.test(HTML) && /if \(status === 'synced' && prevStatus === 'syncing'\) self\.refreshLastUpdate_\(\);/.test(HTML));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
