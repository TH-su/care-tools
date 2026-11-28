/* 給与の画面：暗証番号を開けた時に「前に開けてから n 回、暗証番号が違えられていました」を帯で出す（統合 0144・2026-11-28 代表者の決定）の試験
   実行: node check/unit/payroll_pin_miss_test.js
   守りたいこと:
     1. payroll_pin_unlock の答えの missed が1以上の整数の時だけ帯を出す。0・無い（0144 の前の DB）・形の違う値では何も出さない
     2. 帯の文は決めた文（仮置き）のまま・エスケープを通す
     3. 帯は開いた直後の描き直しで消えない（paint の頭で出す・賞与のタブでも出す）・鍵の画面に戻ったら消す
     4. 数は端末に残さない（localStorage に書かない） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const fnSrc = (name) => { const i = J.indexOf('  function ' + name + '('); return i < 0 ? '' : J.slice(i, J.indexOf('\n', i)); };

console.log('— 暗証番号を違えられた回数の帯（0144） —');
const escSrc = fnSrc('esc'), ofSrc = fnSrc('pinMissOf'), htmlSrc = fnSrc('pinMissHtml');
t('部品の関数がある（esc・pinMissOf・pinMissHtml）', !!(escSrc && ofSrc && htmlSrc));
const ctx = {};
vm.createContext(ctx);
vm.runInContext('var pinMissN = 0;\n' + escSrc + '\n' + ofSrc + '\n' + htmlSrc + '\nthis.of = pinMissOf; this.html = function (n) { pinMissN = n; return pinMissHtml(); };', ctx);
const MSG = '前に開けてから 3 回、暗証番号が違えられていました。心当たりがなければ管理者に知らせてください。';

/* 場面: missed が 3 */
t('missed が 3: 数は 3', ctx.of({ ok: true, until: 'x', missed: 3 }) === 3);
t('missed が 3: 帯に決めた文がそのまま出る（警告の帯・読み上げは status）',
  ctx.html(ctx.of({ ok: true, missed: 3 })) === '<div class="band warn" role="status">' + MSG + '</div>', ctx.html(3));
t('missed が 1: 「1 回」', ctx.html(ctx.of({ ok: true, missed: 1 })).indexOf('前に開けてから 1 回、') > 0);
/* 場面: missed が 0 */
t('missed が 0: 帯は出ない', ctx.of({ ok: true, missed: 0 }) === 0 && ctx.html(ctx.of({ ok: true, missed: 0 })) === '');
/* 場面: missed が無い（0144 の前の DB） */
t('missed が無い（古い DB）: 帯は出ない', ctx.of({ ok: true, until: 'x' }) === 0 && ctx.html(ctx.of({ ok: true, until: 'x' })) === '');
t('答えが null・空: 帯は出ない', ctx.of(null) === 0 && ctx.of(undefined) === 0 && ctx.of({}) === 0);
/* 形の違う値 */
t('形の違う値（文字・小数・負・NaN・無限・真偽・配列・文字の混ざった物）は 0',
  [' 3', '3', 2.5, -1, NaN, Infinity, true, [3], { n: 3 }, '<b>3</b>'].every((v) => ctx.of({ ok: true, missed: v }) === 0));

/* 画面の流れ */
const unlockBody = J.slice(J.indexOf('  function pinOpenGo('), J.indexOf('  function pinFail('));
t('開けた答えの missed を数に取ってから開く（失敗の答えでは取らない）',
  /if \(!r \|\| r\.ok !== true\) \{ pinSay\(pinErr\(r\)\); return null; \}\n\s+pinMissN = pinMissOf\(r\);[^\n]*\n\s+return pinOpened\(\);/.test(unlockBody));
t('鍵の画面に戻ったら数を消す（showLock の中）', /function showLock\(msg\) \{[\s\S]*?pinMsg = msg \|\| ''; pinMissN = 0;[\s\S]*?put\(g, h\);/.test(J));
t('帯は描き直しの頭で出す（賞与のタブでも出す・ほかの帯の前）',
  /put\(\$\('p-main'\), pinMissHtml\(\) \+ \(tab === 'bonus' \? '' : bandsHtml\(\)\) \+ h\);/.test(J));
t('帯の数は端末に残さない（pinMissN を localStorage・sessionStorage に書かない）',
  !/(localStorage|sessionStorage)[^\n]*pinMiss/.test(J) && !/pinMiss[^\n]*(localStorage|sessionStorage)/.test(J));
t('数を置くのは開けた時と鍵の画面だけ（宣言のほかに書き換えは2か所）', /var pinMissN = 0;/.test(J) && (J.match(/(?<!var )pinMissN = /g) || []).length === 2);

console.log(`\n${pass} 件成功／${fail} 件失敗`);
process.exit(fail ? 1 : 0);
