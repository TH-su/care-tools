/* 画素の見比べで「直す前を撮れなかった画面・帳票」を「新しい画面」と取り違えないことの試験（2026-11-17 新設）。
   守りたいこと（check/compare-calc.mjs の baseMissingKind・baseShotReason）:
     A 直す前の metrics.json にその画面の記録がある＝撮ろうとして絵が残らなかった → 'unshot'（失敗にする側）
     B 直す前の記録に無い画面 → 'new'（本当に新しく足した画面＝今までどおり比べない）
     C 帳票: 直す前の記録に無い・直す前の木に材料が無い（inDir:false）→ 'new'。inDir:true・記録が無い（古い道具）→ 'unshot'
     D 直す前の metrics.json が読めない（null・形が違う）→ 'unshot'（新しいとは言えない）
     E 報告の理由は撮影の失敗の文（開けない・撮影・PDF・帳票）の頭だけ。印刷の失敗は pc の errors からも拾う
     F compare.mjs がこの判定を使い、撮れなかった分を pc・印刷・帳票で失敗に数える（文面の確かめ）
   実行: node check/unit/compare_base_missing_test.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

(async () => {
  const { baseMissingKind: k, baseShotReason: why } = await import(path.join(ROOT, 'check', 'compare-calc.mjs'));
  const mb = {
    pages: {
      'a.html': { errors: { pc: ['撮影: Target closed'], ph100: [], ph200: [] } },
      'b.html': { errors: { pc: ['PDF: printing failed', 'x is not defined'], ph100: [], ph200: ['開けない: timeout'] } },
      'c.html': { errors: { pc: [], ph100: [], ph200: [] } },
    },
    sheets: {
      'a__s1': { errors: ['帳票: 印刷の準備ができない（s1）'], inDir: true },
      'a__s2': { errors: ['帳票: setView is not a function'], inDir: false },
      'a__s3': { errors: [] },
    },
  };
  console.log('A 直す前に記録のある画面');
  t('撮影の失敗の記録がある画面は unshot', k('a', false, mb) === 'unshot');
  t('失敗の記録が無くても記録のある画面は unshot', k('c', false, mb) === 'unshot');
  console.log('B 新しい画面');
  t('直す前の記録に無い画面は new', k('z', false, mb) === 'new');
  console.log('C 帳票');
  t('記録に無い帳票は new', k('a__s9', true, mb) === 'new');
  t('直す前の木に材料が無い帳票（inDir:false）は new', k('a__s2', true, mb) === 'new');
  t('直す前の木に材料がある帳票（inDir:true）は unshot', k('a__s1', true, mb) === 'unshot');
  t('inDir の記録が無い帳票（古い道具の記録）は unshot', k('a__s3', true, mb) === 'unshot');
  t('材料を読めなかった帳票（inDir:null）は unshot', k('a__s4', true, { pages: {}, sheets: { 'a__s4': { inDir: null } } }) === 'unshot');
  t('sheets が無い記録の帳票は new', k('a__s1', true, { pages: {} }) === 'new');
  console.log('D 直す前の記録が読めない');
  for (const bad of [null, undefined, {}, { pages: null }, 'x', 3]) {
    t(`記録 ${JSON.stringify(bad)} は画面も帳票も unshot`, k('z', false, bad) === 'unshot' && k('z__s', true, bad) === 'unshot');
  }
  console.log('E 理由の文');
  t('印刷の失敗は pc の記録から拾う', why('a', false, 'print', mb) === '撮影: Target closed');
  t('表示ごとの失敗を先に出す', why('b', false, 'ph200', mb) === '開けない: timeout');
  t('画面のエラー（pageerror）は理由にしない', why('b', false, 'pc', mb) === 'PDF: printing failed');
  t('失敗の文が無い時は「記録なし」', why('c', false, 'pc', mb) === '撮影の失敗の記録なし');
  t('帳票は帳票の記録から', why('a__s1', true, 'print', mb) === '帳票: 印刷の準備ができない（s1）');
  t('記録が読めない時', why('a', false, 'pc', null) === '直す前の記録が読めない');
  t('理由は60字まで・1行目だけ', why('q', false, 'pc', { pages: { 'q.html': { errors: { pc: ['撮影: ' + 'あ'.repeat(100) + '\n二行目'] } } } }).length === 60);
  console.log('F compare.mjs の使い方');
  const cmp = fs.readFileSync(path.join(ROOT, 'check', 'compare.mjs'), 'utf8');
  t('compare-calc.mjs を読む', /from '\.\/compare-calc\.mjs'/.test(cmp));
  t('直す前の記録が読めない時は null のまま判定に渡す', /readJson\(path\.join\(baseDir, 'metrics\.json'\), null\)/.test(cmp) && /baseMissingKind\([^)]*mbRaw\)/.test(cmp));
  t('撮れなかった行は「一致」以外＝pc・印刷・帳票で失敗に数える', /r\.status = '直す前を撮れなかった'/.test(cmp) && /if \(v === 'pc' \|\| v === 'print' \|\| v === 'sheet'\) fail \+= changed\.filter\(\(r\) => !allowed\(r\.name\)\)\.length/.test(cmp));
  t('「新しい画面」は new の分だけ（撮れなかった行は base無し のままにしない）', /baseMissingKind\(k, true, mbRaw\) === 'new'/.test(cmp));
  const snap = fs.readFileSync(path.join(ROOT, 'check', 'snap.mjs'), 'utf8');
  t('snap.mjs が帳票ごとに inDir を残す', /inDir: await fixtureInDir\(name, sh\.key\)/.test(snap));
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  t('compare-calc.mjs が公開の許可に載っている', /^!\/check\/compare-calc\.mjs$/m.test(gi));
  console.log(`\n${pass} 合格 / ${fail} 不合格`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('✗ 例外: ' + e.message); process.exit(1); });
