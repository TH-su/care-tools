/* シフト作成・シフト分析 ── 常勤換算と特定事業所加算の判定の写しが、2つの画面で一字一句同じこと（2026-10-22 新設・改善プロンプト第3弾の13）
   実行: node check/unit/shift_fte_copy_same_test.js

   shift-app.html（シフト作成）と shift-analyzer.html（シフト分析）は、行政に出す数字（常勤換算・特定事業所加算の人の要件・サービス提供責任者の経験年数）を
   同じ関数の写しで計算している。片方だけ直すと、2つの画面で数字が食い違う。
   守ること:
     1 floor1 から svcMgrCheck までのひとかたまりが、2つの画面で一字一句同じ
     2 その中の関数（floor1・fteStdByDivision・tkFinishDen・fullYears・svcMgrCheck ほか）が、それぞれ一字一句同じで、各画面に1回だけある
   ★片方を直したら、もう片方も同じ文面に戻す（CLAUDE.md §3「逐語同一の共有モジュール」）。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'shift-app.html'), 'utf8');
const ANA = fs.readFileSync(path.join(ROOT, 'shift-analyzer.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

/* 関数の本体を、文字列・コメントの中の括弧を数えずに切り出す */
function cut(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) return null;
  let d = 0, i = src.indexOf('{', h), q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(h, i + 1); }
  }
  return null;
}
function block(src) {
  const st = src.indexOf('function floor1(');
  const last = cut(src, 'svcMgrCheck');
  if (st < 0 || !last) return null;
  return src.slice(st, src.indexOf(last) + last.length);
}
const count = (src, name) => src.split('function ' + name + '(').length - 1;

const A = block(APP), B = block(ANA);
t('2つの画面に floor1〜svcMgrCheck のひとかたまりがある', !!A && !!B && A.length > 5000);
t('ひとかたまりが一字一句同じ（シフト作成とシフト分析）', A !== null && A === B, A && B ? { app: A.length, analyzer: B.length } : null);

const MUST = ['floor1', 'fteStdByDivision', 'tkFinishDen', 'fullYears', 'svcMgrCheck'];
const inBlock = A ? [...A.matchAll(/(?:^|\n)\s*function (\w+)\(/g)].map(m => m[1]) : [];
t('かたまりの中に、決めた5つの関数がそろっている', MUST.every(n => inBlock.includes(n)), inBlock);
for (const n of inBlock) {
  t(n + ': 各画面に1回だけあり、一字一句同じ', count(APP, n) === 1 && count(ANA, n) === 1 && cut(APP, n) === cut(ANA, n),
    { app: count(APP, n), analyzer: count(ANA, n) });
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
