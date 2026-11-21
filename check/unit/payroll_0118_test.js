/* 給与の画面と統合 0118 の受け渡しの試験（総点検 2026-11-21 の積み残し・架空の値だけ）
   実行: node check/unit/payroll_0118_test.js
   守りたいこと:
     1. 確定できない警告の印は4つ（rate_missing・emp_rate_missing・tax_table_missing・std_missing）。DB の payroll_run_confirm も同じ4つで断る
        （care-backend の 99pq-4b が同じ4つを確かめる。片方だけ増やすと画面と DB で止める物が食い違う）
     2. DB の新しい断り（blockwarn・exported・notexported）に職員向けの文がある
     3. 書き出し済みの月の振込データは、確かめの窓で「はい」の時だけ zengin_again を記録してから受け取る。ほかの書き出しは今までどおり
     4. 職員の給与設定に駐車場の料金の欄（commute.parking_monthly）があり、保存で送る。整数でなければ止める */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const fnBody = (name, next) => J.slice(J.indexOf('function ' + name + '('), J.indexOf(next, J.indexOf('function ' + name + '(') + 1));

console.log('\n— 1. 確定できない警告の印 —');
const bw = /var BLOCK_WARN = \{([^}]*)\}/.exec(J);
const codes = bw ? bw[1].split(',').map((x) => x.split(':')[0].trim()).sort() : [];
t('BLOCK_WARN は DB と同じ4つ', JSON.stringify(codes) === JSON.stringify(['emp_rate_missing', 'rate_missing', 'std_missing', 'tax_table_missing']), codes);

console.log('\n— 2. 断りの文 —');
const ng = J.slice(J.indexOf('var NG = {'), J.indexOf('function friendly('));
['blockwarn', 'exported', 'notexported'].forEach((k) => t('NG に ' + k + ' の文', new RegExp('\\b' + k + ": '[^']{10,}'").test(ng)));

console.log('\n— 3. もう一度の書き出し —');
const ex = fnBody('exportGo', 'function missingOf(');
const iAsk = ex.indexOf("again ? ask("), iLog = ex.indexOf("rpc('payroll_export_log'"), iBank = ex.indexOf("rpc('payroll_bank_export'");
t('前に書き出した月（書き出し済み・取り消して確定し直した月）の振込データの時だけ確かめる', /var again = kind === 'zengin' && \(status\(\) === 'exported' \|\| !!\(bs\.run && bs\.run\.exported_at\)\);/.test(ex));
t('確かめ → 記録 → 口座の受け取り の順', iAsk > 0 && iLog > iAsk && iBank > iLog, [iAsk, iLog, iBank]);
t('「いいえ」なら何も送らない', /if \(!go\) return;/.test(ex.slice(iAsk, iLog)));
t('確かめた時の記録は zengin_again・ほかは今の種類', /p_kind: again \? 'zengin_again' : EXP_LOG\[kind\]/.test(ex));
t('DB の exported の断りは文を出して読み直す（次に押すと確かめの窓が出る）', /r\.error === 'exported'\) \{ done\(\); say\(NG\.exported\); return load\(true\)/.test(ex));
t('確かめの窓の間は二度押しを止め、閉じたら戻す', ex.indexOf('if (again) busy = true;') > 0 && ex.indexOf('busy = false;') > iAsk && ex.indexOf('busy = false;') < iLog);
t('操作の記録の名前に2つを足した', /export_zengin_again: '[^']+'/.test(J) && /bank_export_again_ng: '[^']+'/.test(J));

console.log('\n— 4. 駐車場の料金 —');
const op = fnBody('openProfile', 'function v(');
const pg = fnBody('profGo', 'function openBank(');
t('職員の給与設定に駐車場の料金の欄', /inp\('f-cmp', '[^']*駐車場[^']*', cm\.parking_monthly, NUMA\)/.test(op));
t('通勤のほかの項目は今までどおり', /monthly: n\('f-cm', '通勤手当'\), means: v\('f-cmm'\) \|\| null, distance_km: n\('f-cmd', '片道の距離'\) \}\);/.test(pg));
t('駐車場の料金は入れた時と前に値があった時だけ commute.parking_monthly に入れる（空の人に鍵を足さない）', /var pkv = n\('f-cmp', '駐車場の料金'\);\s*if \(pkv != null \|\| 'parking_monthly' in obj\(p\.data\.commute\)\) d\.commute\.parking_monthly = pkv;/.test(pg));
t('整数でなければ止める', /parking_monthly % 1\) bad\.push\('駐車場の料金（円・整数）'\)/.test(pg));

console.log('\n— 5. 取り込みの読めた項目（2026-11-21）—');
const os = fnBody('orderStaff', 'function orderBs(');
t('入職順の並べ直しでも、取り込みの「見出しから読めた項目」（cols）を残す', /if \(list\.cols\) out\.cols = list\.cols;\s*return out;/.test(os));

console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
process.exit(fail ? 1 : 0);
