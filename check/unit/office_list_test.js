/* 給与明細一覧・賞与明細一覧（payroll-list.js）と勤怠一覧・シフト表（kintai-list.js）の試験（2026-11-28 本人指示）
   実行: node check/unit/office_list_test.js
   守りたいこと:
     1. 純関数: 前月比の文字・納付の期限（翌月10日）・住民税と所得税の合計・絞り込み・ページ・勤怠一覧の数字（法定内＝所定内＋所定超の法定内）・シフトの升
     2. 部品が無くても今の画面のまま（payroll.js・kintai.js は部品があるか確かめてから使う）
     3. 端末に残さない（localStorage・sessionStorage を使わない）・console を使わない・innerHTML を使わない（画面の HTML は payroll.js・kintai.js が入れる）
     4. 画面の読み込み（.gitignore の公開・?v=・payroll-list.js は payroll.js より前・kintai-list.js は kintai.js より前） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }
function load(f) { const w = {}; vm.runInNewContext(read(f), { window: w, document: { addEventListener() {} }, Blob: function () {}, URL: {}, setTimeout }); return w; }
const PL = load('payroll-list.js').PayrollList, KL = load('kintai-list.js').KintaiList;

console.log('\n— 1. 給与明細一覧の純関数 —');
t('前月比: 0 は ±0・増は +・減は -・前月なしは空', PL.diffText(0) === '±0' && PL.diffText(3571) === '+3,571' && PL.diffText(-39430) === '-39,430' && PL.diffText(null) === '');
t('納付の期限: 支給日の翌月10日（12月は翌年1月）', PL.dueDate('2026-11-27') === '2026-12-10' && PL.dueDate('2026-12-25') === '2027-01-10' && PL.dueDate('x') === null);
const ts = PL.taxSums([{ gross: 300000, lines: [{ sec: 'deduct', code: 'income_tax', amount: 5000 }, { sec: 'deduct', code: 'tax_adjust', amount: -1000 }, { sec: 'deduct', code: 'resident_tax', amount: 9000 }, { sec: 'pay', code: 'resident_tax', amount: 1 }] }, { gross: 100000, lines: [] }]);
const tc = PL.taxSums([{ staff_id: 'a', gross: 1, lines: [{ sec: 'deduct', code: 'resident_tax', amount: 9000 }] }, { staff_id: 'b', gross: 1, lines: [{ sec: 'deduct', code: 'resident_tax', amount: 3000 }] }, { staff_id: 'c', gross: 1, lines: [{ sec: 'deduct', code: 'resident_tax', amount: 1000 }] }, { staff_id: 'd', gross: 1, lines: [] }], (sid) => ({ a: { name: '見本市', code: '999999' }, b: { name: '見本市', code: '999999' } })[sid] || null);
t('住民税の市町村ごとの内訳: 同じ納め先は1行に足す・未設定は鍵 ""・住民税の無い人は数えない（統合 0143）', tc.byCity['見本市\u0000999999'].n === 2 && tc.byCity['見本市\u0000999999'].amount === 12000 && tc.byCity[''].n === 1 && tc.byCity[''].amount === 1000 && Object.keys(tc.byCity).length === 2, tc.byCity);
t('住民税・所得税の合計（精算を足す・支給の行は数えない）・人数', ts.resident === 9000 && ts.residentN === 1 && ts.income === 4000 && ts.incomeN === 1 && ts.gross === 400000 && ts.n === 2, ts);
const rows = [{ name: '見本 一郎', code: 'A001', pt: 'monthly', of: 'f', warn: 0 }, { name: '見本 二子', code: 'A002', pt: 'hourly', of: 'v', warn: 2 }];
t('絞り込み: 氏名の一部（空白を無視）・従業員番号・給与形態・事業所・警告', PL.filterRows(rows, { q: '本一' }).length === 1 && PL.filterRows(rows, { q: 'a002' })[0].code === 'A002' && PL.filterRows(rows, { pt: 'hourly' }).length === 1 && PL.filterRows(rows, { of: 'f' }).length === 1 && PL.filterRows(rows, { warnOnly: true }).length === 1 && PL.filterRows(rows, {}).length === 2);
t('ページ: 34件を50件で 1 - 34 / 34・120件を50件の3ページ目は 101 - 120・全件・0件', PL.pageOf(34, 50, 0).label === '1 - 34 / 34' && PL.pageOf(120, 50, 2).label === '101 - 120 / 120' && PL.pageOf(120, 50, 9).page === 2 && PL.pageOf(120, 0, 0).label === '1 - 120 / 120' && PL.pageOf(0, 50, 0).label === '0 - 0 / 0');

console.log('\n— 2. 勤怠一覧・シフト表の純関数 —');
const r = KL.rowOf({ workDays: 20, workMin: 10000, schedInMin: 8000, legalInOverMin: 500, legalOverMin: 900, holidayMin: 600, nightMin: 30, absentDays: 1, lateMin: 10, earlyLeaveMin: 5, reviewCount: 2 });
t('勤怠一覧: 法定内＝所定内＋所定超の法定内・時間外＝法定外・法定内＋時間外＋法定休日＝総勤務・遅刻早退は和', r.inMin === 8500 && r.overMin === 900 && r.holMin === 600 && r.inMin + r.overMin + r.holMin === r.workMin && r.lateEarlyMin === 15 && r.review === 2, r);
t('勤怠一覧: 壊れた集計でも 0 で止まらない', KL.rowOf(null).workMin === 0 && KL.rowOf({ workMin: 'x' }).workMin === 0);
const hm = (v) => String(v);
t('シフトの升: 予定は時刻・2つはつなぐ・予定の分を足す・有休・所定休日', KL.shiftCell({ blocks: [{ schedStart: '9:00', schedEnd: '18:00', schedWork: 480 }] }, hm).text === '9:00-18:00' && KL.shiftCell({ blocks: [{ schedStart: 'a', schedEnd: 'b', schedWork: 60 }, { schedStart: 'c', schedEnd: 'd', schedWork: 60 }] }, hm).min === 120 && KL.shiftCell({ blocks: [], paidMin: 480 }, hm).kind === 'paid' && KL.shiftCell(null, hm).text === '所定休日');
t('タブは勤怠一覧（list）とシフト表（shift）だけ', KL.isTab('list') && KL.isTab('shift') && !KL.isTab('grid'));

console.log('\n— 3. 守り —');
const PJ = read('payroll-list.js'), KJ = read('kintai-list.js');
for (const [f, j] of [['payroll-list.js', PJ], ['kintai-list.js', KJ]]) {
  t(f + ': 端末に残さない・console を使わない・innerHTML を使わない', !/localStorage|sessionStorage|console\.|innerHTML/.test(j.replace(/\/\*[\s\S]*?\*\//g, '')));
}
const PAY = read('payroll.js'), KIN = read('kintai.js');
t('payroll.js: 部品が無い時は今の一覧（PLI() で確かめてから使う）', /function PLI\(\) \{ var u = window\.PayrollList; return u && typeof u\.listHtml === 'function' \? u : null; \}/.test(PAY) && /if \(pli\) return h \+ pli\.listHtml/.test(PAY));
t('kintai.js: 部品が無い時はタブを足さず、開こうとしたらホーム', /window\.KintaiList \|\| null/.test(KIN) && /else if \(tab === 'list' \|\| tab === 'shift'\) \{ tab = 'home'; paintTabs\(\); \}/.test(KIN));
const GI = read('.gitignore'), PH = read('payroll.html'), KH = read('kintai.html');
t('公開の許可（.gitignore）に3つ', ['!/payroll-list.js', '!/kintai-list.js', '!/office-list.css'].every((x) => GI.split('\n').indexOf(x) >= 0));
t('payroll.html: office-list.css と payroll-list.js（payroll.js より前）を ?v= つきで読む', /office-list\.css\?v=\d{4}-\d{2}-\d{2}/.test(PH) && PH.indexOf('payroll-list.js?v=') > 0 && PH.indexOf('payroll-list.js?v=') < PH.indexOf('payroll.js?v='));
t('kintai.html: office-list.css と kintai-list.js（kintai.js より前）を ?v= つきで読む', /office-list\.css\?v=\d{4}-\d{2}-\d{2}/.test(KH) && KH.indexOf('kintai-list.js?v=') > 0 && KH.indexOf('kintai-list.js?v=') < KH.indexOf('kintai.js?v='));
t('office-list.css は全部 @media screen の中（印刷の紙を変えない）', read('office-list.css').replace(/\/\*[\s\S]*?\*\//g, '').split(/@media screen[^{]*\{/).slice(1).length >= 4 && !/^\s*[.#a-z][^@{]*\{/m.test(read('office-list.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media screen[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')));

console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
