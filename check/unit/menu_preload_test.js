/* メニューの同時読み込みの指示の試験（2026-10-29 本人指示）
   実行: node check/unit/menu_preload_test.js
   守ること: メニュー（index.html）の頭の同時読み込みの指示（preload）は、メニューの <script src> と1本ずつ同じ住所（?v= まで同じ）・同じ並び。
     部品の版を上げて片方だけ直すと、同じ部品を二重に読む・先読みが無駄になるので落とす。指示は最初のスクリプトより前に置く。
   画面のコードは書き換えず、ソースを読むだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

const h = INDEX.replace(/<!--[\s\S]*?-->/g, '');   // コメントの中は数えない
const srcs = [...h.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
const pre = [...h.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((m) => ({ tag: m[0], href: (/\shref="([^"]+)"/.exec(m[0]) || [])[1] }));
console.log('メニューの同時読み込みの指示');
t('1 部品が8本以上ある', srcs.length >= 8, srcs);
t('2 指示はどれもスクリプトとして読む形（as="script"・crossorigin なし＝下の読み込みと同じものとして使い回される）',
  pre.length > 0 && pre.every((p) => /\sas="script"/.test(p.tag) && !/crossorigin/.test(p.tag)), pre.map((p) => p.tag));
t('3 指示とスクリプトが同じ住所・同じ並び', JSON.stringify(pre.map((p) => p.href)) === JSON.stringify(srcs), { pre: pre.map((p) => p.href), srcs });
t('4 指示は最初のスクリプトより前', h.indexOf('rel="preload"') >= 0 && h.indexOf('rel="preload"') < h.search(/<script\b/), '');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
