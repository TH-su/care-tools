/* 「不具合を報告」と画面の指摘の見た目を外の CSS（su-report.css）から付ける決まり（2026-10-27 代表者の決定「共通部品を直す」）。
   守りたいこと:
     A su-report.js・su-annot.js は <style> を差し込まない（CSP の style-src 'self' の画面で止まるため）
     B 両方が読む su-report.css の版が同じ（片方だけ古い版を読むと、古い CSS に画面の指摘の見た目が無いことがある）
     C su-report.css に、ボタン・報告の枠・画面の指摘の板の見た目がある。公開のホワイトリストに入っている
     D 画面の指摘は、見た目が効いていない時に始めない（押下が裏の画面のボタンに届かないように）。板と root の位置は要素に直接付ける
     E 「不具合を報告」のボタンは、CSS が読めない時も右下に固定し、印刷では隠す
   実行: node check/unit/su_report_css_test.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const REP = read('su-report.js'), ANN = read('su-annot.js'), CSS = read('su-report.css'), GI = read('.gitignore');

console.log('— A <style> を差し込まない —');
t('su-report.js に createElement(\'style\') が無い', !/createElement\(\s*['"]style['"]\s*\)/.test(code(REP)));
t('su-annot.js に createElement(\'style\') が無い', !/createElement\(\s*['"]style['"]\s*\)/.test(code(ANN)));

console.log('— B 版がそろっている —');
const vr = (/var CSS_HREF = '(su-report\.css\?v=[^']+)'/.exec(REP) || [])[1];
const va = (/var CSS_HREF = '(su-report\.css\?v=[^']+)'/.exec(ANN) || [])[1];
t('su-report.js と su-annot.js の CSS_HREF が同じ', !!vr && vr === va, [vr, va]);

console.log('— C CSS の中身と公開 —');
t('ボタン（.sur-fab）が右下の固定', /\.sur-fab\{position:fixed;right:14px;bottom:14px;z-index:30;/.test(CSS));
t('印刷ではボタンと枠を出さない', /@media print\{\.sur-fab,\.sur-dlg\{display:none!important\}\}/.test(CSS));
t('画面の指摘の root と板が画面全体の固定', /\.sua-root\{position:fixed;inset:0;z-index:2147483000;pointer-events:none;/.test(CSS) && /\.sua-board\{position:fixed;inset:0;pointer-events:auto;/.test(CSS));
t('.gitignore に !/su-report.css がある', /^!\/su-report\.css$/m.test(GI));

console.log('— D 画面の指摘は見た目が効いていない時に始めない —');
const A = code(ANN);
t('始める前に .sua-root の計算後の position を確かめる', /probe\.className = 'sua-root'/.test(A) && /getComputedStyle\(probe\)\.position === 'fixed'/.test(A));
t('効いていなければ su-report.css の <link> を足して待ち、それでも効かなければ始めない', /if \(cssOk\(\)\) return begin\(opt\);/.test(A) && /ensureCss\(function \(\) \{[\s\S]*?if \(!\(cssOk\(\) && begin\(opt\)\)\) unavailable\(opt\);/.test(A));
t('板と root の位置・全面・前面を要素に直接付ける', /root\.style\.position = 'fixed'/.test(A) && /root\.style\.zIndex = '2147483000'/.test(A) && /board\.style\.position = 'fixed'/.test(A) && /board\.style\.pointerEvents = 'auto'/.test(A));
t('su-report.js は「今は使えません」を受け取る口を渡す', /onUnavailable: function \(\) \{/.test(code(REP)));

console.log('— E ボタンは CSS が無くても右下に固定・印刷で隠す —');
const R = code(REP);
t('ボタンに position:fixed と右下を直接付ける', /fab\.style\.position = 'fixed'; fab\.style\.right = '14px'; fab\.style\.bottom = '14px'; fab\.style\.zIndex = '30';/.test(R));
t('beforeprint で隠し afterprint で戻す', /addEventListener\('beforeprint', function \(\) \{ fab\.style\.display = 'none'; dlg\.style\.display = 'none'; \}\)/.test(R) && /addEventListener\('afterprint', function \(\) \{ fab\.style\.display = ''; dlg\.style\.display = ''; \}\)/.test(R));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
