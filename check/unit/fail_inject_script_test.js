/* 失敗を起こして数える道具（check/fail-inject/）の台本エンジンの試験（2026-10-31 新設）
   実行: node check/unit/fail_inject_script_test.js
   守ること:
     1 台本の行（entry・nth・times）どおりの回だけ失敗を起こし、それ以外の回・ほかの入口は素通しする
       （台本の回数 times と、起きた回数 fired が一致する）
     2 壊れた台本（入口の無い行・起こせない種類・0回）は黙って素通しにせず、例外で止める
     3 配信サーバー（serve.mjs）に本当に POST を送り、台本の回数どおりに断り・接続切れ・時間切れが起き、
       素通しの回だけ見本に書けたこと・HTTP の成否と本文の ok を別々に記録することを確かめる
     4 試験用 Supabase の中継は手元（127.0.0.1・localhost）だけ。su-auth.js の差し替えはメモリの中だけで、行が無ければ配らない
     5 observe.mjs は、--run が 1・2 以外・--measure に値が無い時に、ブラウザを開く前・measure を書く前に止まる。画面に無い関数を呼ばない
     7 observe.mjs の外へ出る要求の判定は、手元・偽 GAS だけを通し、本番の Supabase・Google などの住所は止める。
       止める処理は ~/.claude の部品の「すぐ終える」を外して、閉じてから消す形にしている
     8 「届いた（landed）」は見本ごとの書く action の一覧（writeActions）で数え、key は見本の keyOf で取る
       （体重管理の saveRecord・消耗品管理の addMoves。統合KV の編集リースは書く action に数えない）。
       bodyVerdict は results[] の rejected・conflicts[] の中身を ok:false と数え、今までの形の判定は変えない
     9 --item の measure の行（アプリごと・before の --run の位置・after は [null,null]）を作る・書き足す純粋な部分と、
       --item・--only の引数の守り（ブラウザを開く前に止まる）
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

  process.stdout.write('3b 台本を後から入れる・キーで絞る・画面が先に諦めた印\n');
  await t('key のある行は、キーが合う要求だけを数えて times 回だけ起こす（ほかのキーは素通し）', () => {
    const e = G.createEngine([{ entry: 'put', key: '^wsday_', nth: 1, kind: 'deny', times: 1 }]);
    const got = ['care_schedule_v2', 'wsday_2026-01-14', 'care_schedule_v2', 'wsday_2026-01-14'].map((k) => (e.decide('put', k).step ? k : null));
    assert.deepStrictEqual(got, [null, 'wsday_2026-01-14', null, null]);
    const r = e.report()[0];
    assert.strictEqual(r.fired, r.times);
    assert.strictEqual(r.key, '^wsday_');
    assert.throws(() => G.createEngine([{ entry: 'put', key: '(', kind: 'deny' }]));
  });
  const kv2 = G.createKvBackend({ care_schedule_v2: { a: 1 }, wsday_2026_test: { meta: {}, notes: [] } });
  const srv2 = await S.startFailInjectServer({ root: ROOT, script: [], backends: { kv: kv2 } });
  const post = (key, rev, fiId) => fetch(srv2.url + '/__fake-gas/kv', { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain;charset=utf-8' }, fiId ? { 'x-fi-id': fiId } : {}),
    body: JSON.stringify({ action: 'put', key, rev, data: { n: Math.random() }, token: 'check-dummy' }), redirect: 'follow' }).then((r) => r.json());
  let rep2 = null, set2 = null, wsm = null, rep2b = null;
  try {
    await post('care_schedule_v2', 1); await post('wsday_2026_test', 1);   // 画面の読み込みの時の自動の保存に当たる2回（台本の前）
    set2 = await (await fetch(srv2.url + '/__fail-inject/script', { method: 'POST', body: JSON.stringify([{ entry: 'put', nth: 1, kind: 'deny', times: 1 }]) })).json();
    await post('wsday_2026_test', 2); await post('wsday_2026_test', 2);
    rep2 = await (await fetch(srv2.url + '/__fail-inject/report')).json();
    await fetch(srv2.url + '/__fail-inject/script', { method: 'POST', body: JSON.stringify([{ entry: 'put', nth: 1, kind: 'timeout', times: 1, ms: 30 }]) });
    await post('wsday_2026_test', 3, 'ctx-1');
    srv2.markClientGone('ctx-1');
    rep2b = srv2.engine().report();
    const r = await fetch(srv2.url + '/ws-master.json');
    wsm = { status: r.status, body: await r.text() };
  } finally { await srv2.close(); }
  await t('POST /__fail-inject/script で差し替えると回数を0から数え直し、差し替えの後の1回目にだけ起こす（times と fired が一致）', () => {
    assert.strictEqual(set2.ok, true);
    assert.strictEqual(rep2.script[0].times, 1);
    assert.strictEqual(rep2.script[0].fired, rep2.script[0].times);
    const puts = srv2.log.filter((e) => e.entry === 'put');
    assert.deepStrictEqual(puts.slice(0, 4).map((e) => e.injected), [null, null, 'deny', null]);
    assert.strictEqual(rep2b[0].fired, rep2b[0].times);
  });
  await t('壊れた台本の差し替えは 400 で断り、黙って素通しにしない', async () => {
    const s3 = await S.startFailInjectServer({ root: ROOT, script: [], backends: {} });
    try { const r = await fetch(s3.url + '/__fail-inject/script', { method: 'POST', body: '[{"entry":"put","kind":"slow"}]' }); assert.strictEqual(r.status, 400); }
    finally { await s3.close(); }
  });
  await t('画面が先に諦めた時間切れは、サーバーの記録（http 200）を残したまま、画面から見た成否（httpSeen）を client-gone にする', () => {
    const e = srv2.log.find((x) => x.fiId === 'ctx-1');
    assert.strictEqual(e.injected, 'timeout');
    assert.strictEqual(e.http, 200);
    assert.strictEqual(e.httpSeen, 'client-gone');
    assert.strictEqual(srv2.log.filter((x) => x.fiId == null).every((x) => x.httpSeen === 200), true);
  });
  await t('返事を待っている間に同じ文脈が同じキーで送り直したら、前の要求を画面が諦めた（client-gone）と記録する', async () => {
    const kv3 = G.createKvBackend({ wsday_2026_test: { meta: {}, notes: [] } });
    const s3 = await S.startFailInjectServer({ root: ROOT, script: [{ entry: 'put', nth: 1, kind: 'timeout', times: 1, ms: 300 }], backends: { kv: kv3 } });
    const send = (id) => fetch(s3.url + '/__fake-gas/kv', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', 'x-fi-id': id },
      body: JSON.stringify({ action: 'put', key: 'wsday_2026_test', rev: 1, data: { n: 1 }, token: 'check-dummy' }) }).then((r) => r.json());
    try {
      const first = send('ws-a-1');
      await new Promise((r) => setTimeout(r, 50));
      await send('ws-a-2');
      await first;
      const rep = s3.engine().report()[0];
      assert.strictEqual(rep.fired, rep.times);
      assert.deepStrictEqual(s3.log.map((x) => [x.fiId, x.http, x.httpSeen]), [['ws-a-1', 200, 'client-gone'], ['ws-a-2', 200, 200]]);
    } finally { await s3.close(); }
  });
  await t('入居者マスタの GET ?action=stateRev は本物の doGet と同じ形（ok・rev・srev）で答え、ほかの GET は断る。統合KV の GET は 404（Code.gs に doGet が無い）', async () => {
    const mb = G.createMasterBackend(null, [{ id: 'R1', name: '架空 一郎', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    const s4 = await S.startFailInjectServer({ root: ROOT, script: [], backends: { master: mb, kv: G.createKvBackend({}) } });
    try {
      const a = await (await fetch(s4.url + '/__fake-gas/master?action=stateRev', { redirect: 'follow' })).json();
      assert.deepStrictEqual(Object.keys(a).sort(), ['ok', 'rev', 'srev']); assert.strictEqual(a.ok, true);
      const b = await (await fetch(s4.url + '/__fake-gas/master?action=getRoster')).json();
      assert.ok(typeof b.error === 'string' && b.error.includes('POST でだけ'));
      assert.strictEqual((await fetch(s4.url + '/__fake-gas/kv?action=get')).status, 404);
      assert.strictEqual(s4.log[0].method, 'GET'); assert.strictEqual(s4.log[0].entry, 'stateRev'); assert.strictEqual(s4.log[0].httpSeen, 200);
    } finally { await s4.close(); }
  });
  await t('ws-master.json が無い時は {}（画面は 404 と同じ分岐に落ちる）', () => {
    if (fs.existsSync(path.join(ROOT, 'ws-master.json'))) return;   // 配信の控えがある手元では、ある物をそのまま配る
    assert.strictEqual(wsm.status, 200);
    assert.strictEqual(wsm.body, '{}');
  });

  await t('favicon.ico が配布物に無い時は 204（ブラウザが自分で取りに来る 404 をコンソールのエラーに数えない）', async () => {
    if (fs.existsSync(path.join(ROOT, 'favicon.ico'))) return;   // 配布物にある時は、ある物をそのまま配る
    const s5 = await S.startFailInjectServer({ root: ROOT, script: [], backends: {} });
    try { const r = await fetch(s5.url + '/favicon.ico'); assert.strictEqual(r.status, 204); assert.strictEqual(await r.text(), ''); }
    finally { await s5.close(); }
  });

  process.stdout.write('5 observe.mjs の引数の守り（ブラウザを開く前に止まる）\n');
  const { spawnSync } = require('child_process');
  const os = require('os');
  const obs = (extra) => spawnSync(process.execPath, [path.join(DIR, 'observe.mjs'), '--ls-keys', path.join(DIR, 'ls-keys.sample.json'), '--only', 'ws-gas'].concat(extra), { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  await t('--run が 1・2 以外なら、measure を書かずに理由を出して exit 1', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-run-'));
    const mf = path.join(tmp, 'measure.json');
    fs.writeFileSync(mf, '[]\n');
    try {
      for (const v of ['3', '0', 'x']) {
        const r = obs(['--run', v, '--measure', mf]);
        assert.strictEqual(r.status, 1, v);
        assert.ok(r.stdout.includes('--run は 1 か 2'), v);
      }
      const r2 = obs(['--measure', mf, '--run']);   // 値なし（'true'）
      assert.strictEqual(r2.status, 1);
      assert.strictEqual(fs.readFileSync(mf, 'utf8'), '[]\n');
      assert.ok(!fs.existsSync(mf + '.bak'));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
  await t('--measure に値が無ければ「--measure に measure.json の場所が要ります」で exit 2', () => {
    const r = obs(['--run', '1', '--measure']);
    assert.strictEqual(r.status, 2);
    assert.ok(r.stdout.includes('--measure に measure.json の場所が要ります'));
  });
  await t('入居者マスタの場面の後片付けで、画面に無い関数（closeEdit）を呼ばない', () => {
    const src = fs.readFileSync(path.join(DIR, 'observe.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const html = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
    assert.ok(!/function\s+closeEdit\b/.test(html), '画面に closeEdit がある時はこの試験を直す');
    assert.ok(!/closeEdit\s*\(/.test(src));
  });

  process.stdout.write('6 試験用 Supabase の中継の守り\n');
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

  process.stdout.write('7 observe.mjs の外へ出る要求の判定（印 EGRESS-BEGIN〜END の間を切り出して確かめる）\n');
  const obsSrc = fs.readFileSync(path.join(DIR, 'observe.mjs'), 'utf8');
  const eg = /\/\* EGRESS-BEGIN \*\/([\s\S]*?)\/\* EGRESS-END \*\//.exec(obsSrc);
  const isAllowedEgress = eg ? new Function(eg[1] + '\nreturn isAllowedEgress;')() : null;
  const FAKE = ['https://script.google.com/macros/s/FAIL-INJECT-KV/exec', 'https://script.google.com/macros/s/FAIL-INJECT-MASTER/exec'];
  await t('判定の関数が印の間にある', () => { assert.strictEqual(typeof isAllowedEgress, 'function'); });
  await t('手元（127.0.0.1・localhost）と偽 GAS の住所は通す', () => {
    for (const u of ['http://127.0.0.1:55421/rest/v1/rpc/kv_put', 'http://127.0.0.1:61234/work-schedule.html', 'http://localhost:8080/su-auth.js',
      'ws://127.0.0.1:55421/realtime/v1', 'https://script.google.com/macros/s/FAIL-INJECT-KV/exec', 'https://script.google.com/macros/s/FAIL-INJECT-MASTER/exec?action=stateRev',
      'about:blank', 'data:image/png;base64,AAAA']) assert.strictEqual(isAllowedEgress(u, FAKE), true, u);
  });
  await t('本番の Supabase・Google・ほかの外の住所・手元に似せた住所は止める', () => {
    for (const u of ['https://jhbernqawjrzqwrmqrih.supabase.co/rest/v1/rpc/kv_put', 'https://example.supabase.co/auth/v1/token', 'wss://example.supabase.co/realtime/v1',
      'https://script.google.com/macros/s/AKfyc-REAL-DEPLOY/exec', 'https://script.googleusercontent.com/macros/echo', 'https://fonts.googleapis.com/css2',
      'https://www.google.com/', 'http://127.0.0.1.example.invalid/x', 'http://localhost.example.invalid/x', 'http://10.0.0.1:55421/',
      'https://script.google.com/macros/s/FAIL-INJECT-KVX/exec', 'ftp://127.0.0.1/x', 'not a url']) assert.strictEqual(isAllowedEgress(u, FAKE), false, u);
  });
  await t('止める処理は部品の「すぐ終える」を外し、閉じてから終える（Playwright の止める処理も入れない）', () => {
    const src = obsSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/removeAllListeners\(sig\)/.test(src));
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.ok(src.includes("'" + s + "'"), s);
    assert.ok(/handleSIGINT:\s*false/.test(src) && /handleSIGTERM:\s*false/.test(src) && /handleSIGHUP:\s*false/.test(src));
    assert.ok(/await closeAll\(\);\s*\}\s*catch[^\n]*\n\s*process\.exit\(code\)/.test(src));
  });

  process.stdout.write('8 「届いた」は見本ごとの書く action の一覧で数える・key は見本の keyOf で取る（2026-11-01 追加）\n');
  await t('isWriteAction: 見本が writeActions を持てばそれ、持たなければ今までの put・push・saveResident', () => {
    assert.strictEqual(S.isWriteAction({ writeActions: ['saveRecord'] }, 'saveRecord'), true);
    assert.strictEqual(S.isWriteAction({ writeActions: ['saveRecord'] }, 'put'), false);
    for (const a of ['put', 'push', 'saveResident']) assert.strictEqual(S.isWriteAction({}, a), true, a);
    assert.strictEqual(S.isWriteAction({}, 'get'), false);
    assert.deepStrictEqual(G.createKvBackend({}).writeActions, ['put', 'push']);
    assert.deepStrictEqual(G.createMasterBackend(null, []).writeActions, ['saveResident']);
  });
  await t('keyOfBody: 見本が keyOf を持てばそれ（消耗品は moves[0].id）、持たなければ body.key か body.record.id', () => {
    assert.strictEqual(S.keyOfBody({}, { key: 'k1' }), 'k1');
    assert.strictEqual(S.keyOfBody({}, { record: { id: 7 } }), '7');
    assert.strictEqual(S.keyOfBody(G.createSuppliesBackend({}), { action: 'addMoves', moves: [{ id: 'mv_a' }] }), 'mv_a');
    assert.strictEqual(S.keyOfBody(G.createWeightBackend({}), { action: 'delRecord', id: 'x9' }), 'x9');
  });
  {
    const wt = G.createWeightBackend({ residents: [{ id: 'r1', name: '架空A', room: '1' }], records: [], thresholds: null });
    const spl = G.createSuppliesBackend({ role: 'staff', items: [{ id: 'it_a', name: '見本品A', status: 'active', units: [{ name: '箱' }, { name: '枚', per: 10 }], billIdx: 0, billType: 'unit' }] });
    const kvL = G.createKvBackend({ 'sched:2026-01:plan': { cells: {} } });
    const s6 = await S.startFailInjectServer({ root: ROOT, script: [{ entry: 'saveRecord', nth: 2, kind: 'deny', times: 1 }], backends: { wt, spl, kv: kvL } });
    const post = (name, body) => fetch(s6.url + '/__fake-gas/' + name, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then((r) => r.json());
    const got = {};
    try {
      got.ga = await post('wt', { action: 'getAll', token: 'check-dummy' });
      got.s1 = await post('wt', { action: 'saveRecord', token: 'check-dummy', record: { id: 'rec1', residentId: 'r1', weight: 50 } });
      got.s2 = await post('wt', { action: 'saveRecord', token: 'check-dummy', record: { id: 'rec2', residentId: 'r1', weight: 51 } });
      got.m1 = await post('spl', { action: 'addMoves', token: 'check-dummy', moves: [{ id: 'mv_one', date: '2026-01-14', itemId: 'it_a', type: 'in', qtyEntered: 1, unitIdx: 0 }] });
      got.m2 = await post('spl', { action: 'addMoves', token: 'check-dummy', moves: [{ id: 'bad', itemId: 'it_a', type: 'in', qtyEntered: 1, unitIdx: 0 }] });
      got.la = await post('kv', { action: 'lockAcquire', token: 'check-dummy', deviceId: 'devA', name: '見本端末' });
      got.pu = await post('kv', { action: 'push', token: 'check-dummy', key: 'sched:2026-01:plan', baseRev: 1, data: { cells: { s: { 1: '早' } } }, editToken: got.la.lease && got.la.lease.token });
      got.probe = await (await fetch(s6.url + '/__fake-gas/wt')).json();
      got.ping = await (await fetch(s6.url + '/__fake-gas/spl?action=ping')).json();
    } finally { await s6.close(); }
    const row = (entry, key) => s6.log.find((e) => e.entry === entry && (key === undefined || e.key === key));
    await t('体重管理: saveRecord が書けたら landed（key は record.id）・getAll は landed にならない・断られた回は landed にならない', () => {
      assert.strictEqual(row('getAll').landed, false);
      assert.strictEqual(row('saveRecord', 'rec1').landed, true);
      const r2 = row('saveRecord', 'rec2');
      assert.strictEqual(r2.injected, 'deny'); assert.strictEqual(r2.landed, false); assert.strictEqual(r2.bodyOk, false);
      assert.deepStrictEqual(got.s2, { ok: false, error: 'Error: unauthorized' });
      assert.strictEqual(wt.records.has('rec1'), true); assert.strictEqual(wt.records.has('rec2'), false);
    });
    await t('消耗品管理: addMoves の applied は landed（key は moves[0].id）・rejected だけの答えは ok:false（landed にならない）', () => {
      assert.strictEqual(row('addMoves', 'mv_one').landed, true);
      const r = row('addMoves', 'bad');
      assert.strictEqual(got.m2.ok, true); assert.strictEqual(r.bodyOk, false); assert.strictEqual(r.name, 'rejected'); assert.strictEqual(r.landed, false);
    });
    await t('統合KV: lockAcquire は書く action に数えない・券つきの push は landed', () => {
      assert.strictEqual(got.la.ok, true);
      assert.strictEqual(row('lockAcquire').landed, false);
      assert.deepStrictEqual(got.pu, { ok: true, rev: 2 });
      assert.strictEqual(row('push').landed, true);
    });
    await t('GET: 体重管理の疎通確認（action なし）は版と対応機能・消耗品管理の ping は build と caps', () => {
      assert.strictEqual(got.probe.ver, 2); assert.ok(Array.isArray(got.probe.caps) && got.probe.caps.includes('postGetAll'));
      assert.strictEqual(got.ping.app, 'supplies'); assert.ok(Array.isArray(got.ping.caps));
    });
  }
  await t('bodyVerdict: results[] に rejected がある・conflicts[] が空でない時は ok:false。今までの形の判定は変えない', () => {
    assert.deepStrictEqual(G.bodyVerdict({ ok: true, results: [{ id: 'a', status: 'applied' }, { id: 'b', status: 'rejected', reason: 'bad_qty' }] }), { ok: false, name: 'rejected' });
    assert.deepStrictEqual(G.bodyVerdict({ ok: true, results: [{ id: 'a', status: 'applied' }, { id: 'b', status: 'existing' }] }), { ok: true, name: null });
    assert.deepStrictEqual(G.bodyVerdict({ ok: true, conflicts: [{ key: 'x' }] }), { ok: false, name: 'conflict' });
    assert.deepStrictEqual(G.bodyVerdict({ ok: true, conflicts: [] }), { ok: true, name: null });
    assert.deepStrictEqual(G.bodyVerdict({ ok: true, rev: 1, unchanged: true }), { ok: true, name: 'unchanged' });
    assert.deepStrictEqual(G.bodyVerdict({ record: { id: 1 } }), { ok: true, name: null });
    assert.deepStrictEqual(G.bodyVerdict({ conflict: true, serverRev: 3 }), { ok: false, name: 'conflict' });
  });

  process.stdout.write('9 --item の measure の書き込み（印 MEASURE-ITEM-BEGIN〜END の間を切り出して確かめる・2026-11-01 追加）\n');
  const mi = /\/\* MEASURE-ITEM-BEGIN \*\/([\s\S]*?)\/\* MEASURE-ITEM-END \*\//.exec(obsSrc);
  const MI = mi ? new Function(mi[1] + '\nreturn { itemRowsFor, upsertItemRows };')() : null;
  await t('関数が印の間にある', () => { assert.ok(MI && typeof MI.itemRowsFor === 'function' && typeof MI.upsertItemRows === 'function'); });
  const SC = [
    { app: '体重管理', failureShown: 1, falseSaved: 0, deliveredLater: 1, rollback: 0, httpFail: 0, appFail: 1 },
    { app: '体重管理', failureShown: 1, falseSaved: 0, deliveredLater: 0, rollback: 0, httpFail: 1, appFail: 0 },
    { app: 'シフト作成', failureShown: 0, falseSaved: 0, deliveredLater: 0, rollback: 0, httpFail: 0, appFail: 0, waitedWithoutNotice: 60 },
    { app: 'シフト作成', failureShown: 1, falseSaved: 0, deliveredLater: 1, rollback: 0, httpFail: 1, appFail: 0, waitedWithoutNotice: 12 },
    { app: '消耗品管理', failureShown: 1, falseSaved: 0, deliveredLater: 0, rollback: 0, httpFail: 1, appFail: 0, duplicateLanded: 1 },
    { app: '消耗品管理', failureShown: 1, falseSaved: 0, deliveredLater: 0, rollback: 0, httpFail: 0, appFail: 1, duplicateLanded: 0 },
    { app: '試験用 Supabase', failureShown: null, falseSaved: null, deliveredLater: null, rollback: null, httpFail: 1, appFail: 0 },
    { app: '無効の場面', valid: false, failureShown: 5, httpFail: 5 },
  ];
  await t('itemRowsFor: アプリごとに足す・null は足さない・waitedWithoutNotice は最大・無効の場面は外す', () => {
    const rows = MI.itemRowsFor(SC);
    const get = (app, metric) => (rows.find((r) => r.app === app && r.metric === metric) || {}).value;
    assert.strictEqual(get('体重管理', '保存の失敗が画面に出た回数'), 2);
    assert.strictEqual(get('体重管理', 'HTTP の失敗の回数'), 1);
    assert.strictEqual(get('体重管理', '時間切れの間、失敗の表示なしに待った秒数（最大・道具が待たせた時間で頭打ち＝下限）'), undefined);
    assert.strictEqual(get('シフト作成', '時間切れの間、失敗の表示なしに待った秒数（最大・道具が待たせた時間で頭打ち＝下限）'), 60);
    assert.strictEqual(get('試験用 Supabase', '保存の失敗が画面に出た回数'), undefined);
    assert.strictEqual(get('試験用 Supabase', 'HTTP の失敗の回数'), 1);
    /* 押し直しの二重の登録は件数を足して行にする（見落とすと二重の登録が measure から消える） */
    assert.strictEqual(get('消耗品管理', '押し直しで同じ記録が二重に届いた件数'), 1);
    assert.strictEqual(get('体重管理', '押し直しで同じ記録が二重に届いた件数'), undefined);
    assert.ok(!rows.some((r) => r.app === '無効の場面'));
    for (const r of rows) assert.ok(typeof r.unit === 'string' && r.unit);
  });
  await t('upsertItemRows: before の --run の位置に書き、after は [null,null]。item 1 の行・ほかの item の行には触らない', () => {
    const item1 = { item: 1, app: '共通の道具（check/fail-inject・失敗を起こして数える）', metric: '保存の失敗が画面に出た回数', unit: '回', before: ['未測定', '未測定'], after: [7, 7], how: 'x' };
    const m = [JSON.parse(JSON.stringify(item1))];
    const rows = MI.itemRowsFor(SC);
    const r1 = MI.upsertItemRows(m, 3, 0, 'how-A', rows);
    assert.strictEqual(r1.ok, true);
    assert.deepStrictEqual(m[0], item1);
    const w = m.find((r) => r.item === 3 && r.app === '体重管理' && r.metric === '保存の失敗が画面に出た回数');
    assert.deepStrictEqual(w.before, [2, null]); assert.deepStrictEqual(w.after, [null, null]); assert.strictEqual(w.how, 'how-A'); assert.strictEqual(w.unit, '回');
    const r2 = MI.upsertItemRows(m, 3, 1, 'how-A', rows);
    assert.strictEqual(r2.ok, true);
    assert.deepStrictEqual(w.before, [2, 2]);
    assert.strictEqual(m.filter((r) => r.item === 3).length, rows.length);
  });
  await t('upsertItemRows: もう一方の回が条件（how）の違うまま書いてあれば、何も書かずに clash を返す', () => {
    const m = [];
    const rows = MI.itemRowsFor(SC);
    MI.upsertItemRows(m, 3, 0, 'how-A', rows);
    const snap = JSON.stringify(m);
    const r = MI.upsertItemRows(m, 3, 1, 'how-B', rows);
    assert.strictEqual(r.ok, false); assert.ok(r.clash);
    assert.strictEqual(JSON.stringify(m), snap);
  });
  await t('observe.mjs: --item に値が無ければ exit 2・知らない --only の場面は exit 2（ブラウザを開く前）', () => {
    const r1 = spawnSync(process.execPath, [path.join(DIR, 'observe.mjs'), '--ls-keys', path.join(DIR, 'ls-keys.sample.json'), '--only', 'wt-gas', '--item'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r1.status, 2); assert.ok(r1.stdout.includes('--item に番号が要ります'));
    const r2 = spawnSync(process.execPath, [path.join(DIR, 'observe.mjs'), '--ls-keys', path.join(DIR, 'ls-keys.sample.json'), '--only', 'xx-gas'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r2.status, 2); assert.ok(r2.stdout.includes('--only に知らない場面があります'));
  });
  await t('--only を付けない時は item 1 の4場面だけ（新しい3場面は名前を挙げた時だけ）', () => {
    const src = obsSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/const ITEM1_SCENARIOS = \['ws-gas', 'ws-sb', 'sb-rls', 'rm-gas'\];/.test(src));
    assert.ok(/: ITEM1_SCENARIOS\.slice\(\);/.test(src));
    for (const k of ['wt-gas', 'spl-gas', 'sh-gas']) assert.ok(src.includes("'" + k + "'"), k);
  });

  process.stdout.write(`\n成功 ${pass}／失敗 ${fail}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { process.stdout.write('✗ 試験が走りません: ' + String(e && e.stack || e) + '\n'); process.exit(1); });
