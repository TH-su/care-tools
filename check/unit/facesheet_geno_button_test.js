/* フェイスシート（facesheet.html）の「家族構成図の枠を本物のボタンにする」のテスト。
   対象: 詳細の帳票の家族構成図の枠（.geno-box）の組み立て・見た目の打ち消し・押した時の配線
   実行: node "…/check/unit/facesheet_geno_button_test.js"
         FACESHEET_HTML=<別の版>/facesheet.html node "…/check/unit/facesheet_geno_button_test.js"
   直す前の版を渡すと落ちる（直す前は role="button" の div と、div 用のキー操作）。

   実データは含まない。
   ★出力に console を使わない（個人情報を出力に流さないための決まり）。 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML_PATH = process.env.FACESHEET_HTML || path.join(__dirname, '..', '..', 'facesheet.html');
const SRC = fs.readFileSync(HTML_PATH, 'utf8');

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label); } }

group('A. 枠の組み立て');
t('A1 枠は <button type="button" class="geno-box"> で作る', /<button type="button" class="geno-box" aria-label="家族構成図を作成・編集する"/.test(SRC));
t('A2 role="button" の div の枠が残っていない', !/<div[^>]*class="geno-box"[^>]*role="button"/.test(SRC) && !/<div class="geno-box"/.test(SRC));
t('A3 ボタンの中に div を入れない（案内は span）', /'<span class="geno-hint"[^']*'/.test(SRC) && !/<div class="geno-hint"/.test(SRC));
t('A4 枠を閉じるのは </button>', /'\+genoInner\+'<\/button><\/div>'/.test(SRC));
t('A5 印刷しない設定の印 data-nop-of="geno" は外の欄に残っている', /<div class="cell" data-nop-of="geno"[^>]*><span class="lab">家族構成図<\/span><button /.test(SRC));

group('B. 見た目の打ち消し（画面と紙は前の div のまま）');
const css = (SRC.match(/button\.geno-box\{[^}]*\}/) || [''])[0];
t('B1 button.geno-box の打ち消しがある', css !== '');
['width:100%', 'margin:0', 'padding:0', 'font:inherit', 'color:inherit', 'line-height:inherit', 'text-align:inherit', 'appearance:none']
  .forEach((k, i) => t('B' + (i + 2) + ' 打ち消しに ' + k, css.indexOf(k) >= 0));
t('B10 案内の span を塊として並べる', /\.geno-hint,\.geno-hint-ic\{display:block\}/.test(SRC));
t('B12 幅899px以下でも枠の高さ320px（共通の見た目のボタン44pxに負けない強さ）', /#viewBox button\.geno-box\{min-height:320px\}/.test(SRC));
t('B11 紙では枠の線と指の形を消す指定が残っている', /\.geno-box\{border:none !important; cursor:default !important\}/.test(SRC));

group('C. 押した時の配線');
const wire = (SRC.match(/querySelectorAll\('\.geno-box'\),function\(gb\)\{[\s\S]*?\n  \}\);/) || [''])[0];
t('C1 全部の枠に click を配線している', /gb\.addEventListener\('click',go\)/.test(wire));
t('C2 div 用のキー操作（keydown）は無い（ボタンの既定と二重にならない）', wire !== '' && !/keydown/.test(wire));

say('\n合計: 成功 ' + ok + ' / 失敗 ' + ng);
process.exit(ng ? 1 : 0);
