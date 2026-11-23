/* 年末調整の計算（payroll-yearend.js）と令和8年分の定数（payroll-yearend-rates.js）の試験（2026-11-23 新設・凍結仕様 ROOT-yearend.md の B2）
   実行: node check/unit/payroll_yearend_test.js
   守りたいこと:
     1. 冊子「令和8年分 年末調整のしかた」p.57〜59 の〔参考〕設例を1円で再現する（途中の値も1つずつ）
     2. 給与所得控除後の金額が、冊子 p.47〜54 の表の見本の行と一致する（行は PDF の頁を開いて拾った数字）
     3. 各区分の端（基礎控除・配偶者・特定親族・扶養の年齢・生命保険料・地震保険料・所得金額調整控除・切り捨て・住宅ローン控除）
     4. 対象外（乙欄・2,000万円超・定数の無い年・確かめていない定数）は eligible=false で年税額を出さない
   ★期待値は実装の式から作らず、冊子の表・例の数字と手計算の数字を直に書く。人と金額は架空 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Y = require(path.join(ROOT, 'payroll-yearend.js'));
const RT = require(path.join(ROOT, 'payroll-yearend-rates.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + b + '）', a === b, a); }
const R = RT.forYear(2026);

/* 架空の人の1年分の行（毎月の給与 m 円・社保 s 円・税 x 円の12か月） */
function monthly(m, s, x, year) {
  year = year || 2026;
  const out = [];
  for (let i = 1; i <= 12; i++) out.push({ pay_date: year + '-' + String(i).padStart(2, '0') + '-25', kind: 'salary', data: { gross: m, taxable: m, si_health: s, income_tax: x } });
  return out;
}
/* 年の合計がちょうど pay 円になる1行（境目の試験用） */
function oneRow(pay, si, tax) { return [{ pay_date: '2026-12-25', kind: 'salary', data: { gross: pay, taxable: pay, si_health: si || 0, income_tax: tax || 0 } }]; }
function calc(pay, decl, extra) { return Y.computeYearEnd(Object.assign({ year: 2026, rows: oneRow(pay, (extra && extra.si) || 0, (extra && extra.tax) || 0), decl: Object.assign({ kou: true }, decl || {}) }, extra && extra.input || {})); }

console.log('1. 定数の年');
t('令和8年分（2026）の定数がある', R && R.year === 2026);
t('2025年は null', RT.forYear(2025) === null);
t('2027年は null', RT.forYear(2027) === null);
t('forYear は写しを返す（書き換えても元は変わらない）', (() => { const a = RT.forYear(2026); a.basic[0].amount = 1; return RT.forYear(2026).basic[0].amount === 1040000; })());

console.log('2. 〔参考〕設例（冊子 p.57〜59・本年最後の給与の税額計算を省略して年末調整を行う場合）');
const exRows = [];
['01-20', '02-20', '03-19', '04-20', '05-20', '06-19', '07-17', '08-20', '09-18', '10-20', '11-20', '12-18'].forEach((d, i) => {
  const g = i < 3 ? 590000 : 600000;
  exRows.push({ pay_date: '2026-' + d, kind: 'salary', data: { gross: g, taxable: g, si_health: i < 3 ? 90712 : 92454, income_tax: i < 3 ? 6320 : 6690 } });
});
exRows.push({ pay_date: '2026-06-10', kind: 'bonus', data: { gross: 900000, taxable: 900000, si_health: 140940, income_tax: 77500 } });
exRows.push({ pay_date: '2026-12-25', kind: 'bonus', data: { gross: 900000, taxable: 900000, si_health: 140940, income_tax: 0 } });
const exDecl = {
  kou: true,
  spouse: { name: '架空 配偶者', birth: '1985-05-05', income: 500000 },
  dependents: [
    { name: '架空 一般', birth: '2009-05-01', income: 0, relation: '子' },
    { name: '架空 特定', birth: '2006-04-01', income: 0, relation: '子' },
    { name: '架空 老親', birth: '1950-03-03', income: 0, relation: '父', live_together: true, disability: 'general' },
    { name: '架空 特親', birth: '2005-07-07', income: 1000000, relation: '子' }
  ],
  insurance: { life_new_general: 80000, life_old_general: 35000, life_new_care: 80000, life_new_pension: 30000, life_old_pension: 90000, quake: 42000, old_long_fire: 14800 },
  housing_loan: { amount: 76500, start_date: '2020-04-01', count: 1, income_limit: 30000000 }
};
const ex = Y.computeYearEnd({ year: 2026, rows: exRows, decl: exDecl });
eq('対象', ex.eligible, true);
eq('年間給与総額 8,970,000', ex.pay_total, 8970000);
eq('徴収税額の合計 156,670', ex.withheld_total, 156670);
eq('社会保険料等 1,386,102', ex.si_total, 1386102);
eq('給与所得控除後 7,020,000', ex.kyuyo_shotoku, 7020000);
eq('所得金額調整控除 47,000', ex.income_adjust, 47000);
eq('調整控除後 6,973,000', ex.kyuyo_after_adjust, 6973000);
eq('一般の生命保険料の控除額 60,000', ex.deductions.life_detail.general, 60000);
eq('介護医療保険料の控除額 40,000', ex.deductions.life_detail.care, 40000);
eq('個人年金保険料の控除額 47,500', ex.deductions.life_detail.pension, 47500);
eq('生命保険料の控除額 120,000', ex.deductions.life, 120000);
eq('地震保険料の控除額 50,000', ex.deductions.quake, 50000);
eq('配偶者控除 380,000', ex.deductions.spouse, 380000);
eq('特定親族特別控除 410,000', ex.deductions.tokutei, 410000);
eq('扶養控除額及び障害者等の控除額の合計 1,860,000', ex.deductions.fuyo_etc, 1860000);
eq('基礎控除 620,000', ex.deductions.basic, 620000);
eq('所得控除額の合計 4,826,102', ex.deductions_total, 4826102);
eq('差引課税給与所得金額 2,146,000', ex.taxable, 2146000);
eq('算出所得税額 117,100', ex.tax_calc, 117100);
eq('住宅借入金等特別控除 76,500', ex.housing_applied, 76500);
eq('年調所得税額 40,600', ex.nenzei_before_fukko, 40600);
eq('年調年税額 41,400', ex.nenzei, 41400);
eq('差引超過額 −115,270', ex.balance, -115270);
eq('精算に入れる額 −115,270', ex.balance_settle, -115270);
eq('源泉徴収票の支払金額', ex.lines.pay, 8970000);
eq('源泉徴収票の源泉徴収税額＝年調年税額', ex.lines.tax, 41400);
eq('源泉徴収票の特定の数', ex.lines.dep_specific, 1);
eq('源泉徴収票の老人の数', ex.lines.dep_elderly, 1);
eq('源泉徴収票の老人のうち同居', ex.lines.dep_elderly_cohabit, 1);
eq('源泉徴収票のその他の数', ex.lines.dep_other, 1);
eq('源泉徴収票の特親の数', ex.lines.dep_tokutei, 1);
eq('源泉徴収票の障害者（その他）の数', ex.lines.disabled_other, 1);
eq('源泉徴収票の配偶者の合計所得', ex.lines.spouse_income, 500000);
t('生命保険料の特例の摘要が要る', ex.lines.life_u23_applied === true);
eq('警告なし', ex.warnings.length, 0);

console.log('3. 給与所得控除後の給与等の金額（冊子 p.47〜54 の表の行）');
const K = x => Y.kyuyoAfter(x, R);
[
  [0, 0], [740999, 0], [741000, 1000], [1360000, 620000], [2190999, 1450999],                      /* p.47 の 741,000円未満と1行目 */
  [2191000, 1451000], [2192999, 1451000], [2193000, 1453000], [2195999, 1453000], [2196000, 1456000], [2199999, 1456000],  /* p.47 */
  [2200000, 1460000], [2203999, 1460000], [2204000, 1462800], [2384000, 1588800], [2580000, 1726000], [2583999, 1726000],  /* p.47 */
  [2584000, 1728800], [2796000, 1877200], [3000000, 2020000], [3180000, 2146000],                  /* p.48 */
  [3184000, 2148800], [3596000, 2437200], [3599999, 2437200], [3600000, 2440000], [3604000, 2443200], [3780000, 2584000], /* p.49 */
  [3784000, 2587200], [4000000, 2760000], [4380000, 3064000],                                      /* p.50 */
  [4384000, 3067200], [4800000, 3400000], [4980000, 3544000],                                      /* p.51 */
  [4984000, 3547200], [5384000, 3867200], [5580000, 4024000],                                      /* p.52 */
  [5584000, 4027200], [5996000, 4356800], [6180000, 4504000],                                      /* p.53 */
  [6184000, 4507200], [6500000, 4760000], [6596000, 4836800], [6599999, 4836800],                  /* p.54 */
  [6600000, 4840000], [7654321, 5788888], [8499999, 6549999], [8500000, 6550000], [8970000, 7020000], [20000000, 18050000] /* p.54 の式・p.36 の例・p.58 */
].forEach(([x, v]) => eq(x.toLocaleString() + '円', K(x), v));
(() => {
  let ok = true, bad = null;
  for (let x = 2200000; x < 6600000; x += 4000) {
    const a = K(x), b = K(x + 3999), c = K(x + 4000);
    const step = x < 3600000 ? 2800 : 3200;
    if (a !== b || (x + 4000 < 6600000 && c - a !== (x + 4000 === 3600000 ? c - a : step))) { ok = false; bad = x; break; }
  }
  t('2,200,000〜6,599,999円は4,000円刻みの行で同じ値・行ごとに 2,800円（360万円から 3,200円）ずつ増える', ok, bad);
})();

console.log('4. 基礎控除（冊子 p.56・合計所得金額で）');
const B = x => Y.basicDeduction(x, R);
[[0, 1040000], [4890000, 1040000], [4890001, 670000], [6550000, 670000], [6550001, 620000], [23500000, 620000], [23500001, 480000],
  [24000000, 480000], [24000001, 320000], [24500000, 320000], [24500001, 160000], [25000000, 160000], [25000001, 0]].forEach(([x, v]) => eq(x.toLocaleString() + '円', B(x), v));
eq('給与だけ 6,655,556円（合計所得 489万円ちょうど＝104万）', B(K(6655556)), 1040000);
eq('給与だけ 6,655,560円（合計所得 489万円超＝67万）', B(K(6655560)), 670000);

console.log('5. 配偶者控除・配偶者特別控除（冊子 p.55）');
const S = (self, sp, old) => Y.spouseDeduction(self, sp, !!old, R).amount;
eq('本人900万・配偶者62万 → 38万', S(9000000, 620000), 380000);
eq('本人900万超・配偶者62万 → 26万', S(9000001, 620000), 260000);
eq('本人950万・配偶者62万 → 26万', S(9500000, 620000), 260000);
eq('本人950万超 → 13万', S(9500001, 0), 130000);
eq('本人1,000万 → 13万', S(10000000, 0), 130000);
eq('本人1,000万超 → 0', S(10000001, 0), 0);
eq('老人・本人900万以下 → 48万', S(5000000, 0, true), 480000);
eq('老人・本人900万超 → 32万', S(9200000, 0, true), 320000);
eq('老人・本人950万超 → 16万', S(9800000, 0, true), 160000);
eq('配偶者 62万超（620,001）は特別控除 38万', S(5000000, 620001), 380000);
t('配偶者 620,001 は特別控除の区分', Y.spouseDeduction(5000000, 620001, false, R).kind === 'special');
eq('配偶者 95万 → 38万', S(5000000, 950000), 380000);
eq('配偶者 95万超 → 36万', S(5000000, 950001), 360000);
eq('配偶者 100万 → 36万', S(5000000, 1000000), 360000);
eq('配偶者 100万超 → 31万', S(5000000, 1000001), 310000);
eq('配偶者 110万超・本人900万超 → 14万', S(9100000, 1100001), 140000);
eq('配偶者 120万超・本人950万超 → 4万', S(9600000, 1200001), 40000);
eq('配偶者 130万超 → 3万', S(5000000, 1300001), 30000);
eq('配偶者 133万 → 3万', S(5000000, 1330000), 30000);
eq('配偶者 133万・本人950万超 → 1万', S(9600000, 1330000), 10000);
eq('配偶者 133万超 → 0', S(5000000, 1330001), 0);

console.log('6. 特定親族特別控除（冊子 p.56）');
const TK = x => Y.tokuteiDeduction(x, R);
[[620000, 0], [620001, 630000], [850000, 630000], [850001, 610000], [950000, 510000], [1000000, 410000], [1000001, 310000],
  [1150000, 110000], [1200000, 60000], [1200001, 30000], [1230000, 30000], [1230001, 0]].forEach(([x, v]) => eq(x.toLocaleString() + '円', TK(x), v));

console.log('7. 年齢の区切り（冊子 p.11・p.56 の生年月日と照らす・12月31日現在）');
const age = b => Y.ageAt(b, '2026-12-31');
const P = R.age.printed;
eq('平成23年1月1日生まれは16歳（控除対象）', age(P.dependent_on_or_before), 16);
eq('平成23年1月2日生まれは15歳（16歳未満）', age('2011-01-02'), 15);
eq('平成20年1月1日生まれは19歳（特定）', age(P.specific_to), 19);
eq('平成20年1月2日生まれは18歳', age('2008-01-02'), 18);
eq('平成16年1月2日生まれは22歳（特定・23歳未満）', age(P.specific_from), 22);
eq('平成16年1月1日生まれは23歳', age('2004-01-01'), 23);
eq('昭和32年1月1日生まれは70歳（老人）', age(P.elderly_on_or_before), 70);
eq('昭和32年1月2日生まれは69歳', age('1957-01-02'), 69);
eq('平成9年1月1日生まれは30歳（非居住者の区切り）', age(P.nonres_to), 30);
eq('平成9年1月2日生まれは29歳', age('1997-01-02'), 29);
const depOf = (birth, inc, extra) => calc(3000000, { dependents: [Object.assign({ name: '架空', birth, income: inc }, extra || {})] });
eq('15歳（平成23年1月2日生）は扶養控除なし', depOf('2011-01-02', 0).deductions.dependents, 0);
eq('15歳は16歳未満の数に入る', depOf('2011-01-02', 0).lines.under16, 1);
eq('16歳（平成23年1月1日生）は一般 38万', depOf('2011-01-01', 0).deductions.dependents, 380000);
eq('18歳（平成20年1月2日生）は一般 38万', depOf('2008-01-02', 0).deductions.dependents, 380000);
eq('19歳（平成20年1月1日生）は特定 63万', depOf('2008-01-01', 0).deductions.dependents, 630000);
eq('22歳（平成16年1月2日生）は特定 63万', depOf('2004-01-02', 0).deductions.dependents, 630000);
eq('23歳（平成16年1月1日生）は一般 38万', depOf('2004-01-01', 0).deductions.dependents, 380000);
eq('69歳（昭和32年1月2日生）は一般 38万', depOf('1957-01-02', 0).deductions.dependents, 380000);
eq('70歳（昭和32年1月1日生）・別居は老人 48万', depOf('1957-01-01', 0).deductions.dependents, 480000);
eq('70歳・同居の母は同居老親等 58万', depOf('1957-01-01', 0, { relation: '母', live_together: true }).deductions.dependents, 580000);
eq('70歳・同居のおじは老人 48万（直系尊属でない）', depOf('1957-01-01', 0, { relation: 'おじ', live_together: true }).deductions.dependents, 480000);
t('70歳・同居のおじは警告', depOf('1957-01-01', 0, { relation: 'おじ', live_together: true }).warnings.some(w => w.code === 'cohabit_relation_check'));
eq('所得 62万は扶養控除あり', depOf('2000-01-01', 620000).deductions.dependents, 380000);
eq('所得 62万超（26歳）は扶養控除なし', depOf('2000-01-01', 620001).deductions.dependents, 0);
eq('所得 62万超（20歳）は特定親族特別控除 63万', depOf('2006-06-06', 620001).deductions.tokutei, 630000);
eq('所得 62万超（20歳）は特定扶養にしない', depOf('2006-06-06', 620001).deductions.dependents, 0);
eq('所得 123万超（20歳）は特定親族特別控除なし', depOf('2006-06-06', 1230001).deductions.tokutei, 0);
eq('所得 62万超（18歳）は特定親族にならない', depOf('2008-01-02', 700000).deductions.tokutei, 0);
eq('非居住者で40歳は扶養控除しない（仮置き）', depOf('1986-01-01', 0, { nonresident: true }).deductions.dependents, 0);
t('非居住者で40歳は警告', depOf('1986-01-01', 0, { nonresident: true }).warnings.some(w => w.code === 'nonresident_30_69'));
eq('非居住者で25歳は一般 38万', depOf('2001-01-01', 0, { nonresident: true }).deductions.dependents, 380000);
eq('非居住者で25歳は非居住者の数に入る', depOf('2001-01-01', 0, { nonresident: true }).lines.nonresident, 1);
eq('誕生日の前日に年齢が1つ増える（2011-06-30 生まれは 2027-06-29 に16歳）', Y.ageAt('2011-06-30', '2027-06-29'), 16);
eq('その前の日はまだ15歳', Y.ageAt('2011-06-30', '2027-06-28'), 15);
t('生年月日の無い扶養は控除せず警告', (() => { const r = calc(3000000, { dependents: [{ name: '架空', income: 0 }] }); return r.deductions.dependents === 0 && r.warnings.some(w => w.code === 'dep_birth_missing'); })());

console.log('8. 障害者控除の対象（冊子 p.12〜13）');
eq('16歳未満の扶養親族の特別障害者 40万', depOf('2015-05-05', 0, { disability: 'special' }).deductions.disability, 400000);
eq('同居特別障害者 75万', depOf('1990-05-05', 0, { disability: 'special_cohabit' }).deductions.disability, 750000);
eq('同居特別障害者は特別の数と同居の数', depOf('1990-05-05', 0, { disability: 'special_cohabit' }).lines.disabled_special_cohabit, 1);
eq('特定親族（所得62万超）の障害者控除はなし', depOf('2006-06-06', 700000, { disability: 'general' }).deductions.disability, 0);
eq('本人 1,000万超でも同一生計配偶者の障害者控除はある', calc(13000000, { spouse: { name: '架空', birth: '1980-01-01', income: 0, disability: 'general' } }).deductions.disability, 270000);
eq('本人 1,000万超は配偶者控除なし', calc(13000000, { spouse: { name: '架空', birth: '1980-01-01', income: 0 } }).deductions.spouse, 0);
eq('所得 62万超の配偶者の障害者控除はなし', calc(5000000, { spouse: { name: '架空', birth: '1980-01-01', income: 700000, disability: 'general' } }).deductions.disability, 0);
eq('本人が特別障害者 40万', calc(3000000, { self: { disability: 'special' } }).deductions.disability, 400000);
eq('寡婦 27万（合計所得500万以下）', calc(3000000, { self: { widow: 'widow' } }).deductions.widow, 270000);
eq('ひとり親 35万', calc(3000000, { self: { widow: 'single_parent' } }).deductions.single_parent, 350000);
eq('給与 6,777,778円（合計所得500万以下）は寡婦あり', calc(6777778, { self: { widow: 'widow' } }).deductions.widow, 270000);
eq('給与 6,780,000円（合計所得500万超）は寡婦なし', calc(6780000, { self: { widow: 'widow' } }).deductions.widow, 0);
eq('勤労学生 給与 163万（合計所得89万）は 27万', calc(1630000, { self: { working_student: true } }).deductions.working_student, 270000);
eq('勤労学生 給与 163万＋他の所得 1円 は合計所得89万超で 0', calc(1630000, { self: { working_student: true }, other_income: 1 }).deductions.working_student, 0);

console.log('9. 生命保険料控除（冊子 p.24・p.4）');
const F = (x, f) => Y.stepFormula(x, R.life[f]);
[[20000, 'new', 20000], [20001, 'new', 20001], [40000, 'new', 30000], [40001, 'new', 30001], [80000, 'new', 40000], [80001, 'new', 40000],
  [30000, 'new_u23', 30000], [30001, 'new_u23', 30001], [60000, 'new_u23', 45000], [60001, 'new_u23', 45001], [120000, 'new_u23', 60000], [120001, 'new_u23', 60000],
  [25000, 'old', 25000], [25001, 'old', 25001], [50000, 'old', 37500], [50001, 'old', 37501], [100000, 'old', 50000], [100001, 'old', 50000]].forEach(([x, f, v]) => eq(f + ' ' + x.toLocaleString() + '円', F(x, f), v));
eq('新 20,001円 の 1/2 の端数は切り上げ（新 40,001→30,001）', F(40001, 'new'), 30001);
eq('旧 25,003円 → 25,003×1/2＋12,500＝25,001.5 → 25,002', F(25003, 'old'), 25002);
const LD = (ins, u23) => Y.lifeDeduction(ins, !!u23, R);
eq('新だけ 10万 → 4万', LD({ life_new_general: 100000 }).general, 40000);
eq('旧だけ 10万 → 5万（旧が勝つ）', LD({ life_old_general: 100000 }).general, 50000);
eq('新 10万＋旧 10万 → 5万（旧だけが大きい）', LD({ life_new_general: 100000, life_old_general: 100000 }).general, 50000);
eq('新 3万＋旧 3万 → min(25,000＋27,500, 4万)＝4万', LD({ life_new_general: 30000, life_old_general: 30000 }).general, 40000);
eq('23歳未満の扶養あり 新 12万 → 6万', LD({ life_new_general: 120000 }, true).general, 60000);
eq('23歳未満の扶養あり 新 8万＋旧 3.5万 → 6万（設例）', LD({ life_new_general: 80000, life_old_general: 35000 }, true).general, 60000);
eq('23歳未満の扶養あり 旧だけ 10万 → 5万（特例は新だけ）', LD({ life_old_general: 100000 }, true).general, 50000);
t('23歳未満の扶養あり 旧だけは特例の摘要なし', LD({ life_old_general: 100000 }, true).u23_applied === false);
eq('個人年金 新3万＋旧9万 → 47,500（設例）', LD({ life_new_pension: 30000, life_old_pension: 90000 }).pension, 47500);
eq('個人年金 新1万＋旧1万 → 2万', LD({ life_new_pension: 10000, life_old_pension: 10000 }).pension, 20000);
eq('合計の上限 12万', LD({ life_new_general: 200000, life_new_care: 200000, life_new_pension: 200000 }).total, 120000);
eq('23歳未満の扶養ありで 6万＋4万＋4万 → 12万', LD({ life_new_general: 200000, life_new_care: 200000, life_new_pension: 200000 }, true).total, 120000);
eq('介護医療 5万 → 32,500', LD({ life_new_care: 50000 }).care, 32500);
eq('16歳未満の扶養親族だけでも生命保険料の特例（6万）', calc(3000000, { dependents: [{ name: '架空', birth: '2018-01-01', income: 0 }], insurance: { life_new_general: 120000 } }).deductions.life, 60000);
eq('特定親族（所得62万超）だけなら特例なし（4万）', calc(3000000, { dependents: [{ name: '架空', birth: '2006-06-06', income: 700000 }], insurance: { life_new_general: 120000 } }).deductions.life, 40000);

console.log('10. 地震保険料控除（冊子 p.26）');
const QD = (q, l) => Y.quakeDeduction(q, l, R);
eq('地震 5万 → 5万', QD(50000, 0), 50000);
eq('地震 6万 → 5万', QD(60000, 0), 50000);
eq('旧長期 1万 → 1万', QD(0, 10000), 10000);
eq('旧長期 10,001 → 10,001', QD(0, 10001), 10001);
eq('旧長期 15,001 → 12,501（切り上げ）', QD(0, 15001), 12501);
eq('旧長期 2万 → 15,000', QD(0, 20000), 15000);
eq('旧長期 20,001 → 15,000', QD(0, 20001), 15000);
eq('地震 4.2万＋旧長期 1.48万 → 5万（設例）', QD(42000, 14800), 50000);
eq('地震 3万＋旧長期 1万 → 4万', QD(30000, 10000), 40000);

console.log('11. 所得金額調整控除（冊子 p.19・p.37）');
const IA = x => Y.incomeAdjust(x, R);
eq('850万ちょうどは 0', IA(8500000), 0);
eq('850万＋1円 → 1円（切り上げ）', IA(8500001), 1);
eq('8,765,432 → 26,544（p.37 の例）', IA(8765432), 26544);
eq('1,000万 → 15万', IA(10000000), 150000);
eq('1,200万 → 15万（1,000万が上限）', IA(12000000), 150000);
const u16 = [{ name: '架空', birth: '2018-01-01', income: 0 }];
eq('16歳未満の扶養親族がいて給与 900万 → 5万', calc(9000000, { dependents: u16 }).income_adjust, 50000);
eq('特定親族だけで給与 900万 → 0', calc(9000000, { dependents: [{ name: '架空', birth: '2006-06-06', income: 700000 }] }).income_adjust, 0);
eq('23歳の扶養親族だけで給与 900万 → 0', calc(9000000, { dependents: [{ name: '架空', birth: '2004-01-01', income: 0 }] }).income_adjust, 0);
eq('本人が特別障害者で給与 900万 → 5万', calc(9000000, { self: { disability: 'special' } }).income_adjust, 50000);
eq('本人が一般の障害者で給与 900万 → 0', calc(9000000, { self: { disability: 'general' } }).income_adjust, 0);
eq('同一生計配偶者が特別障害者 → 5万', calc(9000000, { spouse: { name: '架空', birth: '1980-01-01', income: 0, disability: 'special' } }).income_adjust, 50000);
eq('扶養親族（30歳）が特別障害者 → 5万', calc(9000000, { dependents: [{ name: '架空', birth: '1996-01-01', income: 0, disability: 'special' }] }).income_adjust, 50000);

console.log('12. 税額と切り捨て（冊子 p.55・p.38〜39）');
const TC = x => Y.taxCalc(x, R);
eq('1,950,000 → 97,500', TC(1950000), 97500);
eq('1,951,000 → 97,600', TC(1951000), 97600);
eq('2,696,000 → 172,100（p.38 の例）', TC(2696000), 172100);
eq('3,300,000 → 232,500', TC(3300000), 232500);
eq('3,301,000 → 232,700', TC(3301000), 232700);
eq('6,950,000 → 962,500', TC(6950000), 962500);
eq('9,000,000 → 1,434,000', TC(9000000), 1434000);
eq('18,000,000 → 4,404,000', TC(18000000), 4404000);
eq('18,050,000 → 4,424,000', TC(18050000), 4424000);
eq('18,051,000 は速算表の外（null）', TC(18051000), null);
/* 給与 3,000,000・社保 0・扶養なし: 2,020,000−1,040,000＝980,000 → 49,000 → ×102.1%＝50,029 → 50,000 */
const r3 = calc(3000000);
eq('給与 300万 課税給与所得 980,000', r3.taxable, 980000);
eq('給与 300万 算出 49,000', r3.tax_calc, 49000);
eq('給与 300万 年税額 50,000（100円未満切り捨て）', r3.nenzei, 50000);
/* 社保 123,456: 2,020,000−123,456−1,040,000＝856,544 → 856,000 → 42,800 → 43,698.8 → 43,600 */
const r4 = calc(3000000, {}, { si: 123456 });
eq('課税給与所得の1,000円未満切り捨て 856,544→856,000', r4.taxable, 856000);
eq('年税額 42,800×102.1%＝43,698 → 43,600', r4.nenzei, 43600);
eq('源泉 50,000 を引いて 不足 −6,400', calc(3000000, {}, { si: 123456, tax: 50000 }).balance, -6400);
eq('源泉 40,000 なら 不足額 3,600（徴収）', calc(3000000, {}, { si: 123456, tax: 40000 }).balance, 3600);
eq('給与 100万 → 課税 0・年税額 0', calc(1000000).nenzei, 0);
eq('給与 100万・源泉 3,000 → 還付 −3,000', calc(1000000, {}, { tax: 3000 }).balance, -3000);

console.log('13. 住宅借入金等特別控除（冊子 p.30・p.38〜39）');
const h1 = calc(3000000, { housing_loan: { amount: 200000, start_date: '2023-04-01', count: 1 } });
eq('控除額が算出税額を超える時は算出税額まで（49,000）', h1.housing_applied, 49000);
eq('年税額 0', h1.nenzei, 0);
eq('可能額 200,000 を源泉徴収票に', h1.lines.housing_possible, 200000);
t('超える時は警告', h1.warnings.some(w => w.code === 'housing_over_tax'));
const h2 = calc(3000000, { housing_loan: { amount: 30000, start_date: '2023-04-01' } });
eq('引ききれる時は全額 30,000', h2.housing_applied, 30000);
eq('年税額 (49,000−30,000)×102.1%＝19,399 → 19,300', h2.nenzei, 19300);
eq('令和4年以後の居住で合計所得 2,000万超は控除なし', calc(9000000, { other_income: 14000000, housing_loan: { amount: 100000, start_date: '2023-04-01' } }).housing_applied, 0);
eq('令和3年以前の居住は 3,000万以下なら控除あり', calc(9000000, { other_income: 14000000, housing_loan: { amount: 100000, start_date: '2021-04-01', income_limit: 30000000 } }).housing_applied, 100000);

console.log('14. 対象外（冊子 p.5・仕様 B2）');
const o1 = calc(3000000, { kou: false }, { tax: 12345 });
eq('乙欄は対象外', o1.eligible, false);
t('乙欄の理由 not_kou', o1.reasons.indexOf('not_kou') >= 0);
eq('乙欄は年税額を出さない', o1.nenzei, null);
eq('乙欄の源泉徴収票は徴収済みの合計', o1.lines.tax, 12345);
eq('乙欄は精算しない（0）', o1.balance_settle, 0);
eq('給与 2,000万ちょうどは対象', calc(20000000).eligible, true);
eq('給与 2,000万ちょうど 給与所得控除後 18,050,000', calc(20000000).kyuyo_shotoku, 18050000);
const o2 = calc(20000001, {}, { tax: 999 });
eq('給与 2,000万超は対象外', o2.eligible, false);
t('理由 over_20m', o2.reasons.indexOf('over_20m') >= 0);
eq('2,000万超の源泉徴収票の支払金額', o2.lines.pay, 20000001);
eq('前職と合わせて 2,000万超も対象外', Y.computeYearEnd({ year: 2026, rows: oneRow(15000000), prevJobs: [{ pay: 5000001, si: 0, tax: 0 }], decl: { kou: true } }).eligible, false);
const o3 = Y.computeYearEnd({ year: 2025, rows: [{ pay_date: '2025-12-25', kind: 'salary', data: { gross: 300000, taxable: 300000, income_tax: 1000 } }], decl: { kou: true } });
eq('2025年は定数が無いので対象外', o3.eligible, false);
t('理由 rates_missing', o3.reasons.indexOf('rates_missing') >= 0);
t('警告 rates_missing', o3.warnings.some(w => w.code === 'rates_missing'));
eq('2027年も対象外', Y.computeYearEnd({ year: 2027, rows: [], decl: { kou: true } }).eligible, false);
const nullRates = RT.forYear(2026); nullRates.basic[2].amount = null;
const o4 = Y.computeYearEnd({ year: 2026, rows: oneRow(3000000), decl: { kou: true }, rates: nullRates });
eq('定数に null があれば対象外', o4.eligible, false);
t('null の場所を警告に書く', o4.warnings.some(w => w.code === 'rates_missing' && (w.paths || []).indexOf('basic.2.amount') >= 0));
eq('定数の部品そのものを rates に渡しても年で引く', Y.computeYearEnd({ year: 2026, rows: oneRow(3000000), decl: { kou: true }, rates: RT }).nenzei, 50000);
eq('定数の部品を渡して 2025年なら対象外', Y.computeYearEnd({ year: 2025, rows: [], decl: { kou: true }, rates: RT }).eligible, false);
t('kou が無い時は甲欄として計算して警告', (() => { const r = Y.computeYearEnd({ year: 2026, rows: oneRow(3000000), decl: {} }); return r.eligible && r.warnings.some(w => w.code === 'kou_unset'); })());
t('金額が小数なら対象外（bad_input）', Y.computeYearEnd({ year: 2026, rows: [{ pay_date: '2026-01-25', kind: 'salary', data: { gross: 1000.5 } }], decl: { kou: true } }).reasons.indexOf('bad_input') >= 0);
t('金額が負なら対象外', Y.computeYearEnd({ year: 2026, rows: [{ pay_date: '2026-01-25', kind: 'salary', data: { income_tax: -1 } }], decl: { kou: true } }).eligible === false);
t('保険料が負なら対象外', calc(3000000, { insurance: { quake: -5 } }).eligible === false);
t('種類が違う行は対象外', Y.computeYearEnd({ year: 2026, rows: [{ pay_date: '2026-01-25', kind: 'other', data: {} }], decl: { kou: true } }).eligible === false);
t('年の違う行は数えず警告', (() => { const r = Y.computeYearEnd({ year: 2026, rows: oneRow(3000000).concat([{ pay_date: '2025-12-25', kind: 'salary', data: { gross: 100000, taxable: 100000 } }]), decl: { kou: true } }); return r.pay_total === 3000000 && r.warnings.some(w => w.code === 'row_other_year'); })());

console.log('15. 前職の合算（冊子 p.36 の 4）');
const pj = Y.computeYearEnd({ year: 2026, rows: monthly(250000, 30000, 4000).slice(6), prevJobs: [{ payer: '架空の前職', pay: 1500000, si: 180000, tax: 24000, left_on: '2026-06-30' }], decl: { kou: true } });
eq('支払金額は前職を合わせて 3,000,000', pj.pay_total, 3000000);
eq('社保は前職を合わせて 360,000', pj.si_total, 360000);
eq('徴収済みは前職を合わせて 48,000', pj.withheld_total, 48000);
/* 2,020,000−360,000−1,040,000＝620,000 → 31,000 → 31,651 → 31,600 */
eq('年税額 31,600', pj.nenzei, 31600);
eq('過不足 −16,400', pj.balance, -16400);
eq('自社の分の源泉徴収税額（合計表用）31,600−24,000＝7,600', pj.lines.own_tax, 7600);
eq('自社の支払金額 1,500,000', pj.lines.own_pay, 1500000);
eq('申告の prev_jobs も読める', Y.computeYearEnd({ year: 2026, rows: oneRow(1500000), decl: { kou: true, prev_jobs: [{ payer: '架空', pay: 1500000, si: 0, tax: 0 }] } }).pay_total, 3000000);
eq('prevJobs と申告の両方がある時は二重に足さない', Y.computeYearEnd({ year: 2026, rows: oneRow(1500000), prevJobs: [{ pay: 1500000, si: 0, tax: 0 }], decl: { kou: true, prev_jobs: [{ pay: 1500000, si: 0, tax: 0 }] } }).pay_total, 3000000);
eq('対象外の人の源泉徴収票は前職を合わせない', Y.computeYearEnd({ year: 2026, rows: oneRow(1500000, 0, 5000), prevJobs: [{ pay: 1500000, si: 0, tax: 3000 }], decl: { kou: false } }).lines.pay, 1500000);

console.log('16. 課税支給の扱い');
eq('taxable が無い行は 総支給−非課税', Y.computeYearEnd({ year: 2026, rows: [{ pay_date: '2026-01-25', kind: 'salary', data: { gross: 230000, nontax: 10000 } }], decl: { kou: true } }).pay_total, 220000);
eq('非課税の通勤手当は支払金額に入れない', Y.computeYearEnd({ year: 2026, rows: [{ pay_date: '2026-01-25', kind: 'salary', data: { gross: 230000, taxable: 220000, nontax: 10000 } }], decl: { kou: true } }).lines.pay, 220000);
eq('社保は健保・介護・支援金・厚年・雇保・その他の合計', Y.computeYearEnd({ year: 2026, rows: [{ pay_date: '2026-01-25', kind: 'salary', data: { gross: 300000, taxable: 300000, si_health: 1, si_care: 2, si_support: 3, si_pension: 4, si_emp: 5, si_other: 6 } }], decl: { kou: true } }).si_total, 21);
eq('本人が払った社保と小規模企業共済も引く', calc(3000000, { insurance: { social_extra: 100000, small_biz: 23000 } }).deductions_total, 1040000 + 123000);

console.log('17. 反証レビューの指摘の場面（2026-11-23）');
/* 指摘1: 配偶者の扶養に入れている23歳未満の子（冊子 p.20・p.22: 夫婦の両方が受けられる） */
const o23 = calc(9000000, { under23_others: [{ birth: '2015-01-01' }], insurance: { life_new_general: 120000 } });
eq('under23_others の子で所得金額調整控除 5万', o23.income_adjust, 50000);
eq('under23_others の子で生命保険料の特例 6万', o23.deductions.life, 60000);
eq('under23_others は扶養控除をしない', o23.deductions.dependents, 0);
eq('under23_others は16歳未満の欄に出さない', o23.lines.under16, 0);
eq('under23_others は扶養の欄に出さない', o23.lines.dependents.length, 0);
eq('under23_others の特別障害者（30歳）で調整控除 5万', calc(9000000, { under23_others: [{ birth: '1996-01-01', special_disabled: true }] }).income_adjust, 50000);
eq('under23_others の23歳で特別障害者でない → 調整控除 0', calc(9000000, { under23_others: [{ birth: '2004-01-01' }] }).income_adjust, 0);
t('under23_others の生年月日が無い時は数えず警告', (() => { const r = calc(9000000, { under23_others: [{}] }); return r.income_adjust === 0 && r.warnings.some(w => w.code === 'under23_others_birth'); })());
/* 指摘2: 非居住者で30〜69歳（手引 p.9 欄22 の区分 02・03・04） */
const nrS = depOf('1986-01-01', 0, { nonresident: true, student: true });
eq('非居住者40歳・留学は一般 38万', nrS.deductions.dependents, 380000);
eq('非居住者40歳・留学は区分 02', nrS.lines.dependents[0].nonres_code, '02');
eq('非居住者40歳・留学は非居住者の数 1', nrS.lines.nonresident, 1);
const nrD = depOf('1986-01-01', 0, { nonresident: true, disability: 'general' });
eq('非居住者40歳・障害者は扶養 38万', nrD.deductions.dependents, 380000);
eq('非居住者40歳・障害者は障害者控除 27万', nrD.deductions.disability, 270000);
eq('非居住者40歳・障害者は区分 03', nrD.lines.dependents[0].nonres_code, '03');
t('非居住者40歳・障害者は非居住者の数と障害者の数がどちらも 1', nrD.lines.nonresident === 1 && nrD.lines.disabled_other === 1);
const nrR = depOf('1986-01-01', 0, { nonresident: true, remit38: true });
eq('非居住者40歳・38万以上の送金は 38万', nrR.deductions.dependents, 380000);
eq('非居住者40歳・38万以上の送金は区分 04', nrR.lines.dependents[0].nonres_code, '04');
eq('非居住者40歳・どれでもない時は非居住者の数に入れない', depOf('1986-01-01', 0, { nonresident: true }).lines.nonresident, 0);
eq('非居住者25歳は区分 01', depOf('2001-01-01', 0, { nonresident: true }).lines.dependents[0].nonres_code, '01');
/* 指摘3: 年末調整をしない人の票の家族の欄（手引 p.5-6 欄8・p.10 欄22 注2・欄24 注1・p.12 用語(1)(5)） */
const gDecl = { kou: false, spouse: { name: '架空 配', birth: '1980-01-01', income: 900000 },
  dependents: [{ name: '架空 年少', birth: '2016-01-01', income: 0 }, { name: '架空 特定', birth: '2006-01-01', income: 0 },
    { name: '架空 特親', birth: '2005-05-05', income: 1000000 }, { name: '架空 特親超', birth: '2005-05-05', income: 1000001 }] };
const g1 = Y.computeYearEnd({ year: 2026, rows: oneRow(400000, 0, 2000), decl: gDecl });
eq('対象外', g1.eligible, false);
eq('源泉控除対象配偶者（95万以下）は 有', g1.lines.spouse_has, true);
eq('源泉控除対象配偶者の氏名', g1.lines.spouse_name, '架空 配');
eq('特定の数', g1.lines.dep_specific, 1);
eq('特親は見積額100万以下だけ（1人）', g1.lines.dep_tokutei, 1);
eq('16歳未満の数', g1.lines.under16, 1);
eq('16歳未満の氏名', g1.lines.under16_names[0].name, '架空 年少');
eq('源泉徴収税額は徴収済み', g1.lines.tax, 2000);
eq('配偶者 95万超は源泉控除対象配偶者でない', Y.computeYearEnd({ year: 2026, rows: oneRow(400000), decl: Object.assign({}, gDecl, { spouse: { name: '架空', birth: '1980-01-01', income: 950001 } }) }).lines.spouse_has, false);
eq('本人の見積額 900万超は源泉控除対象配偶者でない', Y.computeYearEnd({ year: 2026, rows: oneRow(9000000), decl: Object.assign({}, gDecl, { other_income: 2500000 }) }).lines.spouse_has, false);
eq('2,000万超で対象外の人も家族の欄を書く', Y.computeYearEnd({ year: 2026, rows: oneRow(20000001), decl: { kou: true, dependents: [{ name: '架空', birth: '2016-01-01', income: 0 }] } }).lines.under16, 1);
/* 指摘4: 国民年金保険料等（手引 p.7 欄18） */
const np = calc(3000000, { insurance: { national_pension: 200000 } });
eq('国民年金保険料等は社会保険料控除に入る', np.si_total, 200000);
eq('国民年金保険料等の欄', np.lines.national_pension, 200000);
/* 2,020,000−200,000−1,040,000＝780,000 → 39,000 → 39,819 → 39,800 */
eq('国民年金保険料等を引いた年税額 39,800', np.nenzei, 39800);
/* 指摘5: 可能額がある時は算出税額 0 でも内訳（手引 p.7 欄19） */
const h0 = calc(1000000, { housing_loan: { amount: 50000, start_date: '2023-04-01', count: 1, kind: '住', income_limit: 20000000 } });
eq('算出税額 0', h0.tax_calc, 0);
eq('可能額 50,000', h0.lines.housing_possible, 50000);
eq('適用数 1', h0.lines.housing_count, 1);
eq('居住開始年月日', h0.lines.housing_start, '2023-04-01');
eq('区分', h0.lines.housing_kind, '住');
/* 指摘6: 所得要件 income_limit（冊子 p.30） */
eq('所得要件 1,000万で合計所得 1,010万は控除なし', calc(9000000, { other_income: 3100000, housing_loan: { amount: 100000, start_date: '2024-04-01', income_limit: 10000000 } }).housing_applied, 0);
eq('所得要件 2,000万なら同じ人は控除あり', calc(9000000, { other_income: 3100000, housing_loan: { amount: 100000, start_date: '2024-04-01', income_limit: 20000000 } }).housing_applied, 100000);
t('所得要件が無い時は 2,000万で警告', calc(3000000, { housing_loan: { amount: 10000, start_date: '2024-04-01' } }).warnings.some(w => w.code === 'housing_income_limit_unset'));
eq('所得要件が一覧に無い値なら対象外（bad_input）', calc(3000000, { housing_loan: { amount: 10000, income_limit: 15000000 } }).eligible, false);
/* 指摘8: 所得金額調整控除の前後で区分をまたぐ */
/* 給与 11,050,000: 控除後 9,100,000（900万超）→ 調整控除 15万で 8,950,000（900万以下） */
eq('調整控除で本人の合計所得が900万以下になり配偶者控除 38万', calc(11050000, { spouse: { name: '架空', birth: '1980-01-01', income: 0 }, dependents: u16 }).deductions.spouse, 380000);
eq('調整控除が無ければ同じ給与で 26万', calc(11050000, { spouse: { name: '架空', birth: '1980-01-01', income: 0 } }).deductions.spouse, 260000);
/* 給与 1,000万（控除後 8,050,000）＋他の所得 15,500,000: 調整控除 15万で 23,400,000（2,350万以下）→ 62万、無ければ 23,550,000 → 48万 */
eq('調整控除で合計所得が2,350万以下になり基礎控除 62万', calc(10000000, { other_income: 15500000, dependents: u16 }).deductions.basic, 620000);
eq('調整控除が無ければ基礎控除 48万', calc(10000000, { other_income: 15500000 }).deductions.basic, 480000);

console.log('\n' + (fail ? '✗' : '✓') + ' payroll_yearend ' + pass + ' 件成功／' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
