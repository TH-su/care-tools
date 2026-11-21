/* 画素の見比べの「揺れの確かめ」で、許した画面（--allow）を撮り直さないことの試験（2026-11-21 新設）。
   守りたいこと（check/compare-calc.mjs の recheckPages・makeAllowed）:
     A 許した画面に違いが出ても撮り直さない（skipped に回す）
     B 許していない画面に違いが出たら今までどおり撮り直す（targets に残す）
     C 帳票（<画面>__<帳票>）の違いは画面ごとに数え、その画面を許していれば撮り直さない
     D PDF のページごとの違い（pageRows）も画面ごとに数える
     E 一致・撮り方が違う・読めない・直す前が無い等、違い以外の結果は撮り直さない（拾うのは「違いあり」「大きさが違う」だけ）
     F 1回目の結果が読めない（null）時は何も撮り直さない・許す一覧が空なら全部撮り直す
     G makeAllowed は compare.mjs の今までの見分けと同じ（.html の有無・前後の空白・帳票は画面で許す・名前の一部では許さない）
     H run.mjs と compare.mjs がこの関数を使っている（文面の確かめ）
   実行: node check/unit/pixel_recheck_allowed_test.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

(async () => {
  const { recheckPages: rp, makeAllowed: ma } = await import(path.join(ROOT, 'check', 'compare-calc.mjs'));
  const first = {
    results: [
      { name: 'a', status: '違いあり' },
      { name: 'b', status: '違いあり' },
      { name: 'c', status: '一致' },
      { name: 'c2', status: '撮り方が違う' },
      { name: 'c3', status: '読めない' },
      { name: 'c4', status: '直す前を撮れなかった' },
      { name: 'd', status: 'base無し' },
      { name: 'e', status: '大きさが違う' },
      { name: 'f__紙', status: '違いあり' },
      { name: 'g__紙', status: '違いあり' },
    ],
    pageRows: [{ name: 'h__帳票', page: 2, status: '違いあり' }, { name: 'i__帳票', page: 1, status: '一致' }],
  };
  let r = rp(first, 'a.html, f.html,h');
  t('A 許した画面 a は撮り直さない', r.skipped.includes('a.html') && !r.targets.includes('a.html'), r);
  t('B 許していない b・e は撮り直す', r.targets.includes('b.html') && r.targets.includes('e.html'), r);
  t('C 帳票: 画面を許した f は撮り直さず・許していない g は撮り直す', r.skipped.includes('f.html') && r.targets.includes('g.html'), r);
  t('D PDF のページの違い h を画面ごとに数える（許したので撮り直さない）', r.skipped.includes('h.html'), r);
  t('E 一致・撮り方が違う・読めない・直す前を撮れなかった・base無しの c〜c4・d・i は撮り直しにも外す側にも入らない', !['c.html', 'c2.html', 'c3.html', 'c4.html', 'd.html', 'i.html'].some((p) => r.targets.includes(p) || r.skipped.includes(p)), r);
  t('全体: targets は b・e・g、skipped は a・f・h', same(r.targets, ['b.html', 'e.html', 'g.html']) && same(r.skipped, ['a.html', 'f.html', 'h.html']), r);
  t('F 結果が読めない時は空', same(rp(null, 'a.html').targets, []) && same(rp(null, '').skipped, []));
  r = rp(first, '');
  t('F 許す一覧が空なら違いの出た画面を全部撮り直す（今までと同じ）', same(r.targets, ['a.html', 'b.html', 'e.html', 'f.html', 'g.html', 'h.html']) && r.skipped.length === 0, r);
  r = rp({ results: [{ name: 'f__紙', status: '違いあり' }, { name: 'f', status: '違いあり' }] }, '');
  t('同じ画面の画面と帳票の違いは1つにまとめる', same(r.targets, ['f.html']), r);

  const al = ma(' app-access.html ,ats');
  t('G .html つき・なし・前後の空白とも許す', al('app-access') && al('ats') && al('app-access.html'));
  t('G 帳票は画面を許していれば許す', al('ats__紙') && al('app-access__表'));
  t('G 名前の一部では許さない', !al('app') && !al('ats2') && !al('access'));
  t('G 帳票の名前だけを許しても、画面そのものは許さない', !ma('ats__紙')('ats.html') && !ma('ats__紙')('ats'));
  r = rp({ results: [{ name: 'x', status: '違いあり' }, { name: 'x__紙', status: '違いあり' }] }, 'x__紙');
  t('C 帳票の名前だけを許した時、その画面は撮り直す', same(r.targets, ['x.html']) && r.skipped.length === 0, r);
  t('G 空の一覧は何も許さない', !ma('')('a') && !ma(undefined)('a') && !ma(',,')(''));

  const run = fs.readFileSync(path.join(ROOT, 'check', 'run.mjs'), 'utf8');
  const cmp = fs.readFileSync(path.join(ROOT, 'check', 'compare.mjs'), 'utf8');
  t('H run.mjs は recheckPages で撮り直す画面を決め、その画面だけを snap.mjs に渡す', /recheckPages\(first, args\.allow\)/.test(run) && /--pages', diffPages\.join/.test(run));
  t('H run.mjs は撮り直さなかった許した画面を報告に書く', /skippedAllowed\.length/.test(run) && /撮り直していない/.test(run) && /許していない \$\{diffPages\.length\}画面（\$\{diffPages\.join\('、'\)\}）も撮り直していない/.test(run));
  t('H compare.mjs の合否は makeAllowed の見分けを使う', /const allowed = makeAllowed\(args\.allow\)/.test(cmp));

  console.log(`\n${pass} 件成功・${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
