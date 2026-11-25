/* 勤怠管理 ⇄ 給与 の行き来（2026-11-25 本人指示「お互いの画面に移れるボタンと連携」）の試験
   実行: node check/unit/kintai_payroll_hop_test.js
   守りたいこと:
     1. 頭のボタン: 勤怠管理に「給与へ」（管理者だけ出す・今の月分を渡す）、給与に「勤怠管理へ」（今の月分の締めと出力のタブ）
     2. 受け取り: ?ym は形で、?tab は決まったタブ（home・close）だけで確かめ、違う値は捨てる。読んだら URL から消す
     3. 給与は月分を端末に残さない（URL から読むだけ）。勤怠管理は今までどおり kintai_ym・kintai_tab に入れる（再読み込みで同じ所）
     4. 連携: 勤怠管理の締めた月に「給与の画面でこの月分を計算する」、給与の未締めの知らせに「勤怠管理でこの月分を締める」
     5. 受け取りの関数を架空の URL で動かして確かめる */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const KJ = read('kintai.js'), KH = read('kintai.html'), PJ = read('payroll.js'), PH = read('payroll.html');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };

console.log('\n— 1. 頭のボタン —');
t('勤怠管理の頭に「給与へ」（初めは隠す・印刷に出さない）', /<a class="hdr-btn no-print" id="g-to-pay" href="payroll\.html" hidden>💴 給与へ<\/a>/.test(KH));
t('給与の頭に「勤怠管理へ」', /<a class="hdr-btn" id="p-to-kin" href="kintai\.html">🕒 勤怠管理へ<\/a>/.test(PH));
const kHop = fn(KJ, 'paintHop');
t('「給与へ」は管理者だけに出し、今の月分を渡す', /a\.hidden = !isAdmin\(\)/.test(kHop) && /'payroll\.html\?ym=' \+ encodeURIComponent\(ym/.test(kHop));
t('勤怠管理はログインの役割が分かった時と月分を変えた時に描き直す', /st\.role : null; paintHop\(\); \}, function \(\) \{ role = null; paintHop\(\); \}/.test(KJ) && /function paintPer\(\) \{[^\n]*paintHop\(\); \}/.test(KJ) && /function setYm\(v, keepAuto\) \{[^\n]*paintPer\(\)/.test(KJ));
t('給与の「勤怠管理へ」は今の月分の締めと出力のタブ', /'kintai\.html\?ym=' \+ encodeURIComponent\(ym \|\| ''\) \+ '&tab=close'/.test(fn(PJ, 'kintaiHref')));
t('給与は起動の時と月分を変えた時に描き直す', /ym = hopYm\(\) \|\| todayYm\(\); \$\('p-ym'\)\.value = ym; paintHop\(\);/.test(PJ) && /ym = nv; \$\('p-ym'\)\.value = nv; paintHop\(\);/.test(PJ));

console.log('\n— 3. 端末に残す物 —');
t('給与は月分を localStorage に入れない', !/lsSet\([^)]*ym/i.test(PJ));
t('勤怠管理は来た月分・タブを今までの鍵に入れてから読む（再読み込みで同じ所）', /var hp = hopIn\(\);[\s\S]{0,200}if \(hp\.ym\) lsSet\(LS_YM, hp\.ym\); if \(hp\.tab\) lsSet\(LS_TAB, hp\.tab\);\s*var t = lsGet\(LS_TAB\)/.test(KJ));

console.log('\n— 4. 連携の案内 —');
t('勤怠管理の締めた月に「給与の画面でこの月分を計算する」（管理者だけ・印刷に出さない）', /isAdmin\(\) \? '<p class="no-print"><a class="btn pri" href="payroll\.html\?ym=' \+ esc\(encodeURIComponent\(ym\)\) \+ '">💴 給与の画面でこの月分を計算する<\/a><\/p>' : ''/.test(fn(KJ, 'paintClose')));
t('給与の未締めの知らせに「勤怠管理でこの月分を締める」', /<a class="btn" href="' \+ esc\(kintaiHref\(\)\) \+ '">🕒 勤怠管理でこの月分を締める<\/a>/.test(fn(PJ, 'runHtml')));

console.log('\n— 2・5. 受け取りを動かす —');
function run(src, names, search, extra) {
  const calls = [];
  const ctx = Object.assign({ URLSearchParams, location: { search, pathname: '/kintai.html', hash: '' }, history: { replaceState: (a, b, u) => calls.push(u) } }, extra);
  vm.createContext(ctx);
  vm.runInContext(names.map((n) => (n.startsWith('var ') ? n : fn(src, n))).join('\n'), ctx);
  return { ctx, calls };
}
const isYm = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const kTabs = /var HOP_TABS = (\[[^\]]*\]);/.exec(KJ);
t('勤怠管理が受けるタブは home と close だけ', !!kTabs && kTabs[1] === "['home', 'close']", kTabs && kTabs[1]);
const K = (s) => { const x = run(KJ, ['var HOP_TABS = ' + (kTabs ? kTabs[1] : '[]') + ';', 'hopIn'], s, { C: { isYm } }); return { v: x.ctx.hopIn(), calls: x.calls }; };
let r = K('?ym=2026-11&tab=close');
t('正しい月分とタブは受ける・URL から消す', r.v.ym === '2026-11' && r.v.tab === 'close' && r.calls.length === 1 && r.calls[0] === '/kintai.html', r);
r = K('?ym=2026-13&tab=settings');
t('形の違う月分・決まっていないタブは捨てる（URL は消す）', r.v.ym === null && r.v.tab === null && r.calls.length === 1, r);
r = K('?ym=%3Cscript%3E&tab=close%22');
t('おかしな値も捨てる', r.v.ym === null && r.v.tab === null, r);
r = K('');
t('何も無ければ何もしない（URL も触らない）', r.v.ym === undefined && r.calls.length === 0, r);
const P = (s) => { const x = run(PJ, ['isYm', 'hopYm'], s, {}); return { v: x.ctx.hopYm(), calls: x.calls }; };
r = P('?ym=2026-10');
t('給与: 正しい月分は受ける・URL から消す', r.v === '2026-10' && r.calls.length === 1, r);
r = P('?ym=2026-1');
t('給与: 形の違う月分は捨てる（今月で開く）', r.v === null, r);
r = P('?tab=run');
t('給与: 月分が無ければ何もしない', r.v === null && r.calls.length === 0, r);

console.log('\n結果: ' + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
