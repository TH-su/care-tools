/* 画面が外部の配信元からスクリプトを読む時は、改ざんの検知（integrity）を付けるか、テーマに同梱して自前で配る（2026-10-10 新設・監査10月版 体重管理 第3手）
   実行: node check/unit/external_scripts_test.js
   守ること:
     ①どの画面も、http(s):// のスクリプトを integrity なしで読まない
     ②体重管理のグラフ部品は、同梱した chart-js-4.4.1.umd.js（npm の原本）を読む */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));
const bad = [];
for (const f of pages) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/[^"']+["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) if (!/\bintegrity\s*=/.test(m[0])) bad.push(f + ': ' + m[0].slice(0, 120));
}
t('外部の配信元のスクリプトを integrity なしで読む画面が無い（' + pages.length + '画面）', pages.length > 10 && bad.length === 0, bad);

const W = fs.readFileSync(path.join(ROOT, 'weight-record.html'), 'utf8');
t('体重管理は同梱したグラフ部品を読む', /<script src="chart-js-4\.4\.1\.umd\.js"><\/script>/.test(W) && W.indexOf('cdn.jsdelivr.net') < 0, '');
const C = fs.readFileSync(path.join(ROOT, 'chart-js-4.4.1.umd.js'), 'utf8');
t('同梱したグラフ部品は Chart.js v4.4.1 の原本（版の札がある）', /\* Chart\.js v4\.4\.1\n/.test(C) && C.length > 200000, C.length);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
