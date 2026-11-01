/* 失敗を起こして数える道具（check/fail-inject/）の、偽の応答の形の試験（2026-10-31 新設）
   実行: node check/unit/fail_inject_shapes_test.js
   守ること:
     1 偽 GAS の応答の形は本物の .gs から写した語（unauthorized・conflict・unchanged・参照専用の合言葉・Error: conflict）を使う
     2 版の競合は put と push で形が違う（put は ok:false・rev、push は ok の鍵が無く serverRev）。見本の今の版を入れる
     3 確かめていない組み合わせ（入居者マスタの put の競合・GAS の「届かない」・Supabase の競合）は作らずに例外にする
     4 試験用 Supabase の断りは本物の 403・42501 の本文
     5 .gs の場所を環境変数（SU_GAS_SRC＝統合KV の Code.gs・SU_GAS_SRC_MASTER＝入居者マスタの master.gs・
       SU_GAS_SRC_WEIGHT＝体重管理の weight-api.gs・SU_GAS_SRC_SUPPLIES＝消耗品管理の supplies-api.gs）で渡された時だけ、
       写した行の文字列が今もその行にあるか確かめる（無い時はこの段だけ省く。公開リポジトリには .gs を置かない）
     6 体重管理・消耗品管理の断りの形（2026-11-01 追加）: 体重は "Error: unauthorized" の形（safeError_ → errText_）、
       消耗品は {ok:false, error:'unauthorized', hint}。どちらも版の競合の形は .gs に無いので作らない（例外）
     7 統合KV の編集リース（2026-11-01 追加）: lockStatus・lockAcquire（付与・保持中・端末ID なし）・lockRenew・lockRelease・shiftStatus を
       Code.gs と同じ形で答え、リースが有効な間だけシフト系のキーへの券の無い push を editlock で断る。
       ワークスケジュールのキー（wsday_）・リースの無い間の push・put は今までと同じ答え
   ★ネット・GAS・ブラウザが無くても走る。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { fail++; process.stdout.write('  ✗ ' + name + '  → ' + String(e && e.message || e) + '\n'); }
}

async function main() {
  const G = await import(pathToFileURL(path.join(ROOT, 'check', 'fail-inject', 'gas-script.mjs')).href);
  const S = G.SHAPES;

  process.stdout.write('1 本物の語を使う\n');
  t('統合KV の断りは unauthorized', () => assert.deepStrictEqual(S.kv.deny.body(), { ok: false, error: 'unauthorized' }));
  t('統合KV の中身が同じ時は unchanged', () => assert.deepStrictEqual(S.kv.unchanged.body(3), { ok: true, rev: 3, unchanged: true }));
  t('入居者マスタの断りは参照専用の合言葉の文', () => assert.ok(S.master.deny.body().error.includes('参照専用の合言葉')));
  t('入居者マスタの競合は "Error: conflict"（画面は conflict の文字で読み分ける）', () => assert.deepStrictEqual(S.master.conflict.body(), { error: 'Error: conflict' }));
  t('写した行の注釈がすべての形にある', () => {
    for (const app of ['kv', 'master', 'wt', 'spl']) for (const k of Object.keys(S[app])) {
      assert.ok(Array.isArray(S[app][k].src) && S[app][k].src.length, app + '.' + k);
      for (const s of S[app][k].src) assert.ok(s.file && s.line > 0 && s.text, app + '.' + k);
    }
  });

  process.stdout.write('2 競合の形\n');
  t('put の競合は {ok:false, conflict:true, rev}', () => assert.deepStrictEqual(G.gasFailure('kv', 'conflict', 'put', 7).body, { ok: false, conflict: true, rev: 7 }));
  t('push の競合は ok の鍵が無い {conflict:true, serverRev}', () => {
    const b = G.gasFailure('kv', 'conflict', 'push', 7).body;
    assert.deepStrictEqual(b, { conflict: true, serverRev: 7 });
    assert.ok(!('ok' in b));
  });
  t('断り・競合は HTTP 200（本物の GAS は断りも 200 で返す）', () => {
    assert.strictEqual(G.gasFailure('kv', 'deny', 'put', 0).status, 200);
    assert.strictEqual(G.gasFailure('master', 'conflict', 'saveResident', 0).status, 200);
  });

  process.stdout.write('3 確かめていない形は作らない\n');
  t('入居者マスタの put の競合・統合KV の saveResident の競合は例外', () => {
    assert.throws(() => G.gasFailure('master', 'conflict', 'put', 0));
    assert.throws(() => G.gasFailure('kv', 'conflict', 'saveResident', 0));
  });
  t('GAS の「届かない・遅い」・Supabase の「競合・時間切れ」は例外', () => {
    assert.throws(() => G.gasFailure('kv', 'unreachable', 'put', 0));
    assert.throws(() => G.gasFailure('kv', 'slow', 'put', 0));
    assert.throws(() => G.sbFailure('conflict'));
    assert.throws(() => G.sbFailure('timeout'));
  });
  t('知らない偽 GAS の名前は例外', () => assert.throws(() => G.gasFailure('weight', 'deny', 'put', 0)));

  process.stdout.write('4 試験用 Supabase の断り\n');
  t('403 と 42501・not allowed', () => {
    const f = G.sbFailure('deny');
    assert.strictEqual(f.status, 403);
    assert.deepStrictEqual(f.body, { code: '42501', details: null, hint: null, message: 'not allowed' });
    assert.deepStrictEqual(G.bodyVerdict(f.body), { ok: false, name: '42501' });
  });
  t('アプリの成否の読み方（HTTP とは別）', () => {
    assert.strictEqual(G.bodyVerdict({ ok: true, rev: 2 }).ok, true);
    assert.strictEqual(G.bodyVerdict({ ok: false, conflict: true, rev: 2 }).name, 'conflict');
    assert.strictEqual(G.bodyVerdict({ conflict: true, serverRev: 2 }).ok, false);
    assert.strictEqual(G.bodyVerdict({ error: 'Error: conflict' }).ok, false);
    assert.strictEqual(G.bodyVerdict(null).ok, null);
  });

  process.stdout.write('6 体重管理・消耗品管理の断りの形\n');
  t('体重管理の断りは "Error: unauthorized"（画面は /unauthorized/ で読み分ける）・HTTP 200', () => {
    const f = G.gasFailure('wt', 'deny', 'saveRecord', 0);
    assert.strictEqual(f.status, 200);
    assert.deepStrictEqual(f.body, { ok: false, error: 'Error: unauthorized' });
    assert.deepStrictEqual(G.bodyVerdict(f.body), { ok: false, name: 'Error: unauthorized' });
  });
  t('体重管理の read_only・定型文・flush_fail・書けた時・疎通確認の版と対応機能', () => {
    assert.deepStrictEqual(S.wt.readOnly.body(), { ok: false, error: 'Error: read_only' });
    assert.ok(S.wt.serverErr.body().error.startsWith('サーバーで処理できませんでした'));
    assert.deepStrictEqual(S.wt.flushFail.body(), { ok: false, error: 'flush_fail' });
    assert.deepStrictEqual(S.wt.saved.body(), { ok: true, ver: 2 });
    const p = S.wt.probe.body();
    assert.strictEqual(p.ver, 2);
    assert.deepStrictEqual(p.caps, ['fieldMerge', 'lock', 'auth', 'postGetAll', 'readRole']);
    assert.strictEqual(p.authRequired, true);
  });
  t('消耗品管理の断りは {ok:false, error:"unauthorized", hint}・forbidden・busy・flush_fail', () => {
    assert.deepStrictEqual(G.gasFailure('spl', 'deny', 'addMoves', 0).body, { ok: false, error: 'unauthorized', hint: '合言葉が違います' });
    assert.strictEqual(S.spl.forbidden.body().error, 'forbidden');
    assert.strictEqual(S.spl.busy.body().error, 'busy');
    assert.strictEqual(S.spl.flushFail.body().error, 'flush_fail');
    assert.ok(S.spl.flushFail.body().hint.includes('一覧を取り直して'));
  });
  t('体重管理・消耗品管理の競合は作らない（.gs に形が無い）', () => {
    assert.throws(() => G.gasFailure('wt', 'conflict', 'saveRecord', 0));
    assert.throws(() => G.gasFailure('spl', 'conflict', 'addMoves', 0));
  });
  t('見本の体重管理: getAll・saveRecord（id で上書き）・GET の疎通確認と getAll の断り', () => {
    const be = G.createWeightBackend({ residents: [{ id: 'r1', name: '架空A', room: '1' }], records: [], thresholds: null });
    assert.deepStrictEqual(be.respond({ action: 'saveRecord', record: { id: 'x1', residentId: 'r1', weight: 50 } }), { ok: true, ver: 2 });
    be.respond({ action: 'saveRecord', record: { id: 'x1', residentId: 'r1', weight: 51 } });
    const g = be.respond({ action: 'getAll' });
    assert.strictEqual(g.ok, true); assert.strictEqual(g.records.length, 1); assert.strictEqual(g.records[0].weight, 51);
    assert.deepStrictEqual(Object.keys(g).sort(), ['ok', 'records', 'residents', 'thresholds', 'ver']);
    assert.strictEqual(be.respondGet('').msg, 'API ready');
    assert.ok(be.respondGet('getAll').error.includes('POST でだけ'));
    assert.strictEqual(be.keyOf({ action: 'saveRecord', record: { id: 'x1' } }), 'x1');
  });
  t('見本の消耗品管理: addMoves は id で冪等（同じ id は existing・在庫は1回だけ動く）・list の形', () => {
    const be = G.createSuppliesBackend({ role: 'staff', items: [{ id: 'it_a', name: '見本品A', status: 'active', units: [{ name: '箱' }, { name: '枚', per: 10 }], billIdx: 0, billType: 'unit' }], stock: { it_a: { qty: 0 } } });
    const mv = { id: 'mv_test1', date: '2026-01-14', itemId: 'it_a', type: 'in', qtyEntered: 2, unitIdx: 0 };
    const r1 = be.respond({ action: 'addMoves', moves: [mv] });
    assert.strictEqual(r1.ok, true); assert.strictEqual(r1.results[0].status, 'applied'); assert.strictEqual(r1.stock.it_a.qty, 20);
    const r2 = be.respond({ action: 'addMoves', moves: [mv] });
    assert.strictEqual(r2.results[0].status, 'existing'); assert.strictEqual(be.stock.it_a.qty, 20);
    const r3 = be.respond({ action: 'addMoves', moves: [{ id: 'bad id', itemId: 'it_a', type: 'in', qtyEntered: 1, unitIdx: 0 }] });
    assert.strictEqual(r3.results[0].status, 'rejected'); assert.strictEqual(G.bodyVerdict(r3).ok, false);
    const l = be.respond({ action: 'list' });
    assert.deepStrictEqual(Object.keys(l).sort(), ['categories', 'closedMonths', 'defaults', 'items', 'ok', 'prices', 'profiles', 'role', 'settingsAt', 'stock']);
    assert.strictEqual(l.role, 'staff'); assert.strictEqual(l.stock.it_a.qty, 20);
    assert.strictEqual(be.respondGet('ping').app, 'supplies');
    assert.strictEqual(be.respondGet('list').error, 'post_only');
    assert.strictEqual(be.keyOf({ action: 'addMoves', moves: [mv] }), 'mv_test1');
  });

  process.stdout.write('7 統合KV の編集リース\n');
  t('lockStatus は空なら lock:null・lockAcquire は付与（token・epoch・expiresAt）', () => {
    let now = 1000000;
    const be = G.createKvBackend({ 'sched:2026-01:plan': { cells: {} } }, { now: () => now });
    assert.deepStrictEqual(be.respond({ action: 'lockStatus' }), { ok: true, lock: null });
    const a = be.respond({ action: 'lockAcquire', deviceId: 'devA', name: '見本端末' });
    assert.strictEqual(a.ok, true);
    assert.deepStrictEqual(Object.keys(a.lease).sort(), ['epoch', 'expiresAt', 'token']);
    assert.strictEqual(a.lease.epoch, 1); assert.strictEqual(a.lease.expiresAt, now + 30 * 60 * 1000);
    const st = be.respond({ action: 'lockStatus' });
    assert.deepStrictEqual(st.lock, { name: '見本端末', acquiredAt: now, expiresAt: now + 30 * 60 * 1000 });
  });
  t('他の端末が持っている間は lockheld（名前と期限）・端末ID なしは nodevice・takeover は世代を進めて付与', () => {
    const be = G.createKvBackend({});
    const a = be.respond({ action: 'lockAcquire', deviceId: 'devA', name: '見本A' });
    const b = be.respond({ action: 'lockAcquire', deviceId: 'devB', name: '見本B' });
    assert.deepStrictEqual(b, { ok: false, error: 'lockheld', name: '見本A', expiresAt: a.lease.expiresAt });
    assert.deepStrictEqual(be.respond({ action: 'lockAcquire', name: 'x' }), { ok: false, error: 'nodevice' });
    const c = be.respond({ action: 'lockAcquire', deviceId: 'devB', name: '見本B', takeover: true });
    assert.strictEqual(c.ok, true); assert.strictEqual(c.lease.epoch, 2);
  });
  t('リースが有効な間、シフト系のキーへの券の無い・違う push は editlock。券が合えば書ける。wsday_ は券を見ない', () => {
    const be = G.createKvBackend({ 'sched:2026-01:plan': { cells: {} }, 'wsday_2026-01-14': { meta: {} } });
    const a = be.respond({ action: 'lockAcquire', deviceId: 'devA', name: '見本A' });
    const no = be.respond({ action: 'push', key: 'sched:2026-01:plan', baseRev: 1, data: { cells: { s: { 1: '早' } } } });
    assert.deepStrictEqual(no, { ok: false, error: 'editlock', name: '見本A', expiresAt: a.lease.expiresAt });
    assert.strictEqual(G.bodyVerdict(no).ok, false);
    const ok = be.respond({ action: 'push', key: 'sched:2026-01:plan', baseRev: 1, data: { cells: { s: { 1: '早' } } }, editToken: a.lease.token });
    assert.deepStrictEqual(ok, { ok: true, rev: 2 });
    assert.deepStrictEqual(be.respond({ action: 'push', key: 'wsday_2026-01-14', baseRev: 1, data: { meta: { x: 1 } } }), { ok: true, rev: 2 });
  });
  t('リースの無い間の push・put は今までと同じ答え（競合の形も同じ）', () => {
    const be = G.createKvBackend({ 'sched:2026-01:plan': { cells: {} } });
    assert.deepStrictEqual(be.respond({ action: 'push', key: 'sched:2026-01:plan', baseRev: 0, data: {} }), { conflict: true, serverRev: 1 });
    assert.deepStrictEqual(be.respond({ action: 'push', key: 'sched:2026-01:plan', baseRev: 1, data: { a: 1 } }), { ok: true, rev: 2 });
    assert.deepStrictEqual(be.respond({ action: 'put', key: 'x', rev: 0, data: { a: 1 } }), { ok: true, rev: 1 });
  });
  t('lockRenew は券が合えば期限だけ・違えば locklost。lockRelease は空でも ok・他端末の券は locklost', () => {
    let now = 5000;
    const be = G.createKvBackend({}, { now: () => now });
    const a = be.respond({ action: 'lockAcquire', deviceId: 'devA', name: '見本A' });
    now += 1000;
    assert.deepStrictEqual(be.respond({ action: 'lockRenew', deviceId: 'devA', editToken: a.lease.token }), { ok: true, lease: { expiresAt: now + 30 * 60 * 1000 } });
    assert.deepStrictEqual(be.respond({ action: 'lockRenew', deviceId: 'devA', editToken: 'other' }), { ok: false, error: 'locklost', name: '見本A' });
    assert.deepStrictEqual(be.respond({ action: 'lockRelease', deviceId: 'devB', editToken: a.lease.token }), { ok: false, error: 'locklost' });
    assert.deepStrictEqual(be.respond({ action: 'lockRelease', deviceId: 'devA', editToken: a.lease.token }), { ok: true });
    assert.deepStrictEqual(be.respond({ action: 'lockRelease', deviceId: 'devA', editToken: a.lease.token }), { ok: true });
    assert.deepStrictEqual(be.respond({ action: 'lockStatus' }), { ok: true, lock: null });
    assert.deepStrictEqual(be.respond({ action: 'lockRenew', deviceId: 'devA', editToken: a.lease.token }), { ok: false, error: 'locklost', name: '' });
  });
  t('shiftStatus はシフト系のキーの版だけ（内部・ほかのキーは出さない）と保持者', () => {
    const be = G.createKvBackend({ staff: [], 'sched:2026-01:plan': {}, 'wsday_2026-01-14': {} });
    const r = be.respond({ action: 'shiftStatus', keys: ['staff', 'sched:2026-01:plan', 'sched:2026-02:plan', 'wsday_2026-01-14', '_shift_editlock.json'] });
    assert.deepStrictEqual(r, { ok: true, revs: { staff: 1, 'sched:2026-01:plan': 1, 'sched:2026-02:plan': 0 }, lock: null });
  });

  process.stdout.write('5 写した行が今も .gs にあるか（環境変数がある時だけ）\n');
  const srcs = { 'Code.gs': process.env.SU_GAS_SRC, 'master.gs': process.env.SU_GAS_SRC_MASTER,
    'weight-api.gs': process.env.SU_GAS_SRC_WEIGHT, 'supplies-api.gs': process.env.SU_GAS_SRC_SUPPLIES };
  let checked = 0;
  for (const app of ['kv', 'master', 'wt', 'spl']) for (const k of Object.keys(S[app])) for (const s of S[app][k].src) {
    const f = srcs[s.file];
    if (!f || !fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    checked++;
    t(`${s.file}:${s.line} に写した行がある（${app}.${k}）`, () => assert.ok((lines[s.line - 1] || '').includes(s.text), (lines[s.line - 1] || '').trim().slice(0, 80)));
  }
  if (!checked) process.stdout.write('  （.gs の場所が渡されていないので、この段は省きました）\n');

  process.stdout.write(`\n成功 ${pass}／失敗 ${fail}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { process.stdout.write('✗ 試験が走りません: ' + String(e && e.stack || e) + '\n'); process.exit(1); });
