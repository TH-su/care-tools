/* 失敗を起こして数える道具（check/fail-inject/）の、偽の応答の形の試験（2026-10-31 新設）
   実行: node check/unit/fail_inject_shapes_test.js
   守ること:
     1 偽 GAS の応答の形は本物の .gs から写した語（unauthorized・conflict・unchanged・参照専用の合言葉・Error: conflict）を使う
     2 版の競合は put と push で形が違う（put は ok:false・rev、push は ok の鍵が無く serverRev）。見本の今の版を入れる
     3 確かめていない組み合わせ（入居者マスタの put の競合・GAS の「届かない」・Supabase の競合）は作らずに例外にする
     4 試験用 Supabase の断りは本物の 403・42501 の本文
     5 .gs の場所を環境変数（SU_GAS_SRC＝統合KV の Code.gs・SU_GAS_SRC_MASTER＝入居者マスタの master.gs）で渡された時だけ、
       写した行の文字列が今もその行にあるか確かめる（無い時はこの段だけ省く。公開リポジトリには .gs を置かない）
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
    for (const app of ['kv', 'master']) for (const k of Object.keys(S[app])) {
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

  process.stdout.write('5 写した行が今も .gs にあるか（環境変数がある時だけ）\n');
  const srcs = { 'Code.gs': process.env.SU_GAS_SRC, 'master.gs': process.env.SU_GAS_SRC_MASTER };
  let checked = 0;
  for (const app of ['kv', 'master']) for (const k of Object.keys(S[app])) for (const s of S[app][k].src) {
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
