/* 失敗を起こして数える道具（check/fail-inject/）の台本エンジンの試験（2026-10-31 新設）
   実行: node check/unit/fail_inject_script_test.js
   守ること:
     1 台本の行（entry・nth・times）どおりの回だけ失敗を起こし、それ以外の回・ほかの入口は素通しする
       （台本の回数 times と、起きた回数 fired が一致する）
     2 壊れた台本（入口の無い行・起こせない種類・0回）は黙って素通しにせず、例外で止める
     3 配信サーバー（serve.mjs）に本当に POST を送り、台本の回数どおりに断り・接続切れ・時間切れが起き、
       素通しの回だけ見本に書けたこと・HTTP の成否と本文の ok を別々に記録することを確かめる
     4 試験用 Supabase の中継は手元（127.0.0.1・localhost）だけ。su-auth.js の差し替えはメモリの中だけで、行が無ければ配らない
   ★GAS・.gs・試験用 Supabase・ブラウザが無くても走る（ネットへ出ない）。データは架空。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'check', 'fail-inject');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { fail++; process.stdout.write('  ✗ ' + name + '  → ' + String(e && e.message || e) + '\n'); }
}

async function main() {
  const G = await import(pathToFileURL(path.join(DIR, 'gas-script.mjs')).href);
  const S = await import(pathToFileURL(path.join(DIR, 'serve.mjs')).href);

  process.stdout.write('1 台本の回数どおりに起こし、ほかは素通しする\n');
  await t('nth=2・times=3 なら 2〜4回目だけ起こす（起きた回数＝times）', () => {
    const e = G.createEngine([{ entry: 'put', nth: 2, kind: 'conflict', times: 3 }]);
    const hit = [];
    for (let i = 1; i <= 7; i++) hit.push(e.decide('put').step ? i : 0);
    assert.deepStrictEqual(hit, [0, 2, 3, 4, 0, 0, 0]);
    const r = e.report()[0];
    assert.strictEqual(r.fired, r.times);
    assert.strictEqual(r.times, 3);
  });
  await t('ほかの入口（get）は数えるが起こさない', () => {
    const e = G.createEngine([{ entry: 'put', nth: 1, kind: 'deny', times: 1 }]);
    for (let i = 0; i < 5; i++) assert.strictEqual(e.decide('get').step, null);
    assert.strictEqual(e.calls('get'), 5);
    assert.strictEqual(e.report()[0].fired, 0);
  });
  await t('複数の行・times の既定は1・入口ごとに別に数える', () => {
    const e = G.createEngine([{ entry: 'put', nth: 1, kind: 'nores' }, { entry: 'sb:rpc/kv_put', nth: 2, kind: 'slow', times: 2, ms: 5 }]);
    const a = [e.decide('put'), e.decide('put'), e.decide('sb:rpc/kv_put'), e.decide('sb:rpc/kv_put'), e.decide('sb:rpc/kv_put'), e.decide('sb:rpc/kv_put')];
    assert.deepStrictEqual(a.map((d) => d.step ? d.step.kind : null), ['nores', null, null, 'slow', 'slow', null]);
    assert.deepStrictEqual(e.report().map((r) => [r.times, r.fired]), [[1, 1], [2, 2]]);
  });
  await t('台本が空なら全部素通し', () => {
    const e = G.createEngine([]);
    for (let i = 0; i < 3; i++) assert.strictEqual(e.decide('put').step, null);
  });

  process.stdout.write('2 壊れた台本は止める\n');
  await t('入口の無い行・GAS で起こせない種類・Supabase で起こせない種類・0回は例外', () => {
    assert.throws(() => G.createEngine([{ kind: 'deny' }]));
    assert.throws(() => G.createEngine([{ entry: 'put', kind: 'unreachable' }]));
    assert.throws(() => G.createEngine([{ entry: 'sb:rpc/kv_put', kind: 'conflict' }]));
    assert.throws(() => G.createEngine([{ entry: 'put', kind: 'deny', times: 0 }]));
    assert.throws(() => G.createEngine({ entry: 'put' }));
  });
  await t('起こせる失敗の種類は7つ（GAS 4・Supabase 3）で重ならない', () => {
    assert.strictEqual(G.FAILURE_KINDS.length, 7);
    assert.strictEqual(new Set(G.FAILURE_KINDS).size, 7);
    assert.strictEqual(G.KINDS_GAS.length + G.KINDS_SB.length, 7);
  });

  process.stdout.write('3 配信サーバーに POST を送って、台本の回数どおりに起きる\n');
  const kv = G.createKvBackend({ wsday_2026_test: { meta: {}, notes: [] } });
  const script = [
    { entry: 'put', nth: 1, kind: 'deny', times: 2 },
    { entry: 'put', nth: 4, kind: 'nores', times: 1 },
    { entry: 'put', nth: 5, kind: 'timeout', times: 1, ms: 30 },
    { entry: 'put', nth: 7, kind: 'conflict', times: 1 },
  ];
  const srv = await S.startFailInjectServer({ root: ROOT, script, backends: { kv } });
  const results = [];
  try {
    let rev = 1;
    for (let i = 1; i <= 8; i++) {
      const body = JSON.stringify({ action: 'put', key: 'wsday_2026_test', rev, data: { meta: {}, notes: [{ id: 'n' + i }] }, token: 'check-dummy' });
      try {
        const r = await fetch(srv.url + '/__fake-gas/kv', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
        const j = await r.json();
        if (j && j.ok && typeof j.rev === 'number') rev = j.rev;
        results.push({ i, http: r.status, j });
      } catch (e) { results.push({ i, http: 0, j: null }); }
    }
  } finally { await srv.close(); }
  const rep = srv.engine().report();
  await t('台本の行ごとに、指定の回数（times）と起きた回数（fired）が一致する', () => {
    for (const r of rep) assert.strictEqual(r.fired, r.times, JSON.stringify(r));
  });
  await t('記録の injected の数が台本の times の合計と一致する', () => {
    const inj = srv.log.filter((e) => e.injected).length;
    assert.strictEqual(inj, script.reduce((a, s) => a + s.times, 0));
  });
  await t('断り（deny）は HTTP 200 で本文が ok:false・unauthorized（HTTP と本文を別に記録）', () => {
    assert.strictEqual(results[0].http, 200);
    assert.deepStrictEqual(results[0].j, { ok: false, error: 'unauthorized' });
    const e0 = srv.log[0];
    assert.strictEqual(e0.http, 200); assert.strictEqual(e0.bodyOk, false); assert.strictEqual(e0.injected, 'deny');
  });
  await t('素通しの3回目は見本に書けた（landed）', () => {
    assert.strictEqual(results[2].j && results[2].j.ok, true);
    assert.strictEqual(srv.log[2].landed, true);
    assert.strictEqual(srv.log[2].injected, null);
  });
  await t('応答なし（nores）は接続が切れ、見本に届かない', () => {
    assert.strictEqual(results[3].http, 0);
    assert.strictEqual(srv.log[3].landed, false);
    assert.strictEqual(srv.log[3].name, 'destroyed');
  });
  await t('時間切れ（timeout）は遅れてから見本に届く', () => {
    assert.strictEqual(srv.log[4].injected, 'timeout');
    assert.strictEqual(srv.log[4].landed, true);
  });
  await t('競合（conflict）は見本の今の版を入れた Code.gs の形で返し、見本は書かない', () => {
    const j = results[6].j;
    assert.strictEqual(j.ok, false); assert.strictEqual(j.conflict, true); assert.strictEqual(typeof j.rev, 'number');
    assert.strictEqual(srv.log[6].landed, false);
    assert.strictEqual(results[7].j.ok, true);
  });
  await t('見本に書けた回数＝素通しで版が合った回（3・5・6・8回目）', () => {
    assert.strictEqual(kv.history.length, 4);
  });

  process.stdout.write('4 試験用 Supabase の中継の守り\n');
  await t('中継先は手元だけ（本番の形の住所は止める）', () => {
    assert.throws(() => S.assertLocalTarget('https://example.supabase.co'));
    assert.throws(() => S.assertLocalTarget('http://10.0.0.1:55421'));
    assert.strictEqual(S.assertLocalTarget('http://127.0.0.1:55421'), 'http://127.0.0.1:55421');
  });
  await t('su-auth.js の差し替えはメモリの中だけで、接続先の行が無ければ配らない', () => {
    const src = fs.readFileSync(path.join(ROOT, 'su-auth.js'), 'utf8');
    const out = S.rewriteAuth(src, 'test-key');
    assert.ok(/var URL_ = location\.origin \+ '\/__sb';/.test(out));
    assert.ok(!/var URL_ = 'https:/.test(out));
    assert.ok(out.includes('var KEY = "test-key";'));
    assert.strictEqual(fs.readFileSync(path.join(ROOT, 'su-auth.js'), 'utf8'), src);
    assert.throws(() => S.rewriteAuth('var x = 1;', 'k'));
  });

  process.stdout.write(`\n成功 ${pass}／失敗 ${fail}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { process.stdout.write('✗ 試験が走りません: ' + String(e && e.stack || e) + '\n'); process.exit(1); });
