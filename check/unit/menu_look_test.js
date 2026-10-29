/* メニューの「つむぐケアの色味」と PC の4列の試験（2026-10-29 本人指示・代表者の決定）
   実行: node check/unit/menu_look_test.js
   守ること:
     1 4列は画面の幅900px以上だけ。それより狭い画面は今までどおり2列で、組の行割り（newrow）も効く
     2 色味と4列の決まりは全部 @media screen の中（印刷の見た目・ページ数を変えない）
     3 文字の色（藍・補助）は白地・生成りの地で 7:1 以上（介護現場の目標）
     4 絵の地の色の分野（data-fam）は業務ツールの区分で、毬の部品がある時だけ付ける。絵の四角と地の色は PC だけ（狭い画面のボタンの高さを変えない）
   画面のコードは書き換えず、ソースを読むだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
/* @media の中身（対応する } まで）を取り出す */
function mediaBody(css, head) {
  const i = css.indexOf(head); if (i < 0) return null;
  let d = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}') { d--; if (!d) return css.slice(j + 1, k); } }
  return null;
}
const css = (/<style>([\s\S]*?)<\/style>/.exec(HTML) || [])[1] || '';
const wide = mediaBody(css, '@media screen and (min-width: 900px)');
const scr = mediaBody(css, '@media screen {\n  :root { --tc-navy');
const outside = css.replace(wide || '', '').replace(scr || '', '');

console.log('1 列の数');
t('1a 既定（狭い画面）は2列のまま', /\.grid \{ display: grid; grid-template-columns: repeat\(2, 1fr\);/.test(outside), '');
t('1b 4列は幅900px以上の画面だけ', !!wide && /\.grid \{ grid-template-columns: repeat\(4, 1fr\);/.test(wide) && !/repeat\(4/.test(outside), '');
t('1c 組の行割りは狭い画面で効き、4列では左から詰める', /\.tile\.newrow \{ grid-column-start: 1; \}/.test(outside) && /\.tile\.newrow \{ grid-column-start: auto; \}/.test(wide || ''), '');

console.log('2 印刷を変えない');
t('2a 色味の決まりは @media screen の中', !!scr && /--tc-paper/.test(scr) && !/--tc-/.test(outside.replace(/\/\*[\s\S]*?\*\//g, '')), '');

console.log('3 文字の色の濃さ');
function lum(hex) { const c = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const v = (n) => ((new RegExp('--tc-' + n + ': (#[0-9A-Fa-f]{6})')).exec(scr || '') || [])[1];
for (const fg of ['navy', 'ink2']) for (const [bgName, bg] of [['白地', '#FFFFFF'], ['生成り', v('paper')]]) {
  const r = v(fg) && bg ? ratio(v(fg), bg) : 0;
  t('3 ' + fg + ' の字は' + bgName + 'で 7:1 以上（' + r.toFixed(2) + '）', r >= 7, { fg: v(fg), bg });
}

console.log('4 絵の地の色の分野');
t('4a 業務ツールの区分（設定・困った時以外）で、毬の部品がある時だけ data-fam を付ける',
  /if \(s\.id !== 'sec-setup' && s\.id !== 'sec-help' && window\.SUItomari && typeof SUItomari\.familyOf === 'function'\) \{ var fam = SUItomari\.familyOf\(t\.href\); if \(fam >= 0 && fam <= 4\) a\.setAttribute\('data-fam', String\(fam\)\); \}/.test(HTML), '');
t('4b 5つの分野それぞれに地の色がある（PC だけ）', [0, 1, 2, 3, 4].every((n) => new RegExp('\\.tile\\[data-fam="' + n + '"\\] \\.ic \\{ background: #').test(wide || '')), '');
t('4c 狭い画面では絵の箱の大きさ・地の色を変えない（ボタンの高さを今のままにする）', !/\.tile[^{]*\.ic \{/.test(scr || ''), '');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
