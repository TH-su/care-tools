/* 給与の計算（payroll-calc.js）の純関数の試験（2026-11-19 新設・給与 v1 の契約 CONTRACT-payroll-v1.md §2〜§3）
   実行: node check/unit/payroll_calc_test.js
   守りたいこと:
     1. 架空の職員10人（月給・時給・日給・中途入社・退職・40歳到達・70歳・乙欄・夜勤手当・役員）が、手で数えた額と1円単位で一致する
     2. 社保・雇保の 50銭ちょうど／50銭超、月給の時間単価の円未満切上げ、時給の時間外は単価を先に丸めない
     3. 40・65・70歳は誕生日の前日で到達（1日生まれは前月）、75歳は誕生日の前月まで。保険料の対象月（翌月・当月徴収）
     4. 資格取得月・喪失月・同月得喪、日割り、マイナスの支給が課税と雇保の基礎を減らす、通勤の非課税の超過、
        最低賃金割れ・差引マイナス・前月±20%の警告、役員（雇保なし・割増なし）、時給者の割増の基礎に月額の手当
   ★期待値は試験の中で関数を使って作り直さず、手で数えた数字を書いている。職員は架空。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'payroll-calc.js'));
const Rates = require(path.join(ROOT, 'payroll-rates.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + b + '）', a === b, a); }

const PERIOD = { from: '2026-11-16', to: '2026-12-15' };
function run(profile, att, extra) {
  return C.computeItem(Object.assign({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: {}, profile, allowanceDefs: [], att: att === undefined ? {} : att, adjustments: [] }, extra || {}));
}
const L = (it, code) => { const l = it.lines.find((x) => x.code === code); return l ? l.amount : undefined; };
const W = (it, code) => it.warnings.some((w) => w.code === code);
const INS = (h, p) => ({ health: { on: h != null, std: h }, pension: { on: p != null, std: p }, emp: { on: true } });
/* 率を差し替える（最低賃金・通勤の非課税限度は出荷の率表が null なので、架空の値を入れて試す） */
function ratesWith(o) { return Object.assign({}, Rates, o); }

console.log('1. 架空の職員10人（手で数えた額と1円単位）');
const QUAL = { code: 'q', name: '資格手当', sec: 'pay', calc: 'fixed', order: 1, attrs: { overtime_base: true } };
{ /* 1 月給・資格手当（割増の基礎）・時間外5時間・扶養1・通勤・住民税 */
  const it = run({ pay_type: 'monthly', base: 220000, allowances: [{ code: 'q', amount: 10000 }], birth_date: '1990-04-10', ins: INS(230000, 230000),
    tax: { col: 'kou', dependents: 1 }, commute: { monthly: 8000 }, resident_tax: { '2026-12': 9000 } }, { legalOverMin: 300 }, { allowanceDefs: [QUAL] });
  eq('職員1 時間外（単価1338×1.25×5h＝8362.5→8363）', L(it, 'ot_out'), 8363);
  eq('職員1 総支給', it.gross, 246363);
  eq('職員1 健保', L(it, 'health'), 11592);
  eq('職員1 支援金（264.5 は50銭ちょうど→切捨て）', L(it, 'support'), 264);
  eq('職員1 介護なし（36歳）', L(it, 'care'), undefined);
  eq('職員1 厚年', L(it, 'pension'), 21045);
  eq('職員1 雇保（1231.815→1232）', L(it, 'emp'), 1232);
  eq('職員1 課税対象', it.tax_base, 204230);
  eq('職員1 所得税（甲・扶養1）', L(it, 'income_tax'), 2870);
  eq('職員1 住民税', L(it, 'resident_tax'), 9000);
  eq('職員1 差引', it.net, 200360);
  eq('職員1 手当の行の code', L(it, 'fq'), 10000);
}
{ /* 2 月給・1日生まれで40歳到達（対象月11月に介護あり）・欠勤1日 */
  const it = run({ pay_type: 'monthly', base: 300000, birth_date: '1986-12-01', ins: INS(300000, 300000), tax: { col: 'kou', dependents: 0 } }, { absentDays: 1 });
  eq('職員2 欠勤控除（単価 300000÷172＝1744.18→1744 ×8h×1日）', L(it, 'absence'), -13952);
  eq('職員2 総支給', it.gross, 286048);
  eq('職員2 介護（12/1 生まれは 11/30 到達＝11月分から）', L(it, 'care'), 2430);
  eq('職員2 支援金', L(it, 'support'), 345);
  eq('職員2 雇保（欠勤控除の後の 286048×5/1000）', L(it, 'emp'), 1430);
  eq('職員2 所得税', L(it, 'income_tax'), 5790);
  eq('職員2 差引', it.net, 233483);
}
{ /* 3 時給・有休8h・法定内残業1h・時間外1.5h・社保なし・通勤 */
  const it = run({ pay_type: 'hourly', base: 1100, ins: { emp: { on: true } }, tax: { col: 'kou', dependents: 0 }, commute: { monthly: 4000 } },
    { schedInMin: 7200, paidMin: 480, legalInOverMin: 60, legalOverMin: 90 });
  eq('職員3 基本給（1100×(7200+480)÷60）', L(it, 'basic'), 140800);
  eq('職員3 法定内残業×1.00', L(it, 'ot_in'), 1100);
  eq('職員3 時間外（2062.5→2063）', L(it, 'ot_out'), 2063);
  eq('職員3 総支給', it.gross, 147963);
  eq('職員3 雇保（通勤を含む 147963×5/1000＝739.815→740）', L(it, 'emp'), 740);
  eq('職員3 所得税', L(it, 'income_tax'), 2110);
  eq('職員3 差引', it.net, 145113);
  eq('職員3 健保の行なし', L(it, 'health'), undefined);
}
{ /* 4 時給・端数の多い分・深夜を払う設定・法定休日・56歳（介護）・扶養2（未確認） */
  const it = run({ pay_type: 'hourly', base: 1073, birth_date: '1970-03-15', ins: INS(118000, 118000), tax: { col: 'kou', dependents: 2, dependents_checked: false } },
    { schedInMin: 6547, legalOverMin: 47, nightMin: 120, holidayMin: 30 }, { settings: { night_premium: 'pay' } });
  eq('職員4 基本給（117082.18→117083 切上げ）', L(it, 'basic'), 117083);
  eq('職員4 時間外（1073×1.25×47分÷60＝1050.65→1051・単価を先に丸めない）', L(it, 'ot_out'), 1051);
  eq('職員4 深夜（1073×0.25×2h＝536.5→537）', L(it, 'ot_night'), 537);
  eq('職員4 法定休日（1073×1.35×0.5h＝724.28→725）', L(it, 'ot_holiday'), 725);
  eq('職員4 総支給', it.gross, 119396);
  eq('職員4 健保（5947.2→5947）', L(it, 'health'), 5947);
  eq('職員4 介護（955.8→956）', L(it, 'care'), 956);
  eq('職員4 支援金（135.7→136）', L(it, 'support'), 136);
  eq('職員4 厚年', L(it, 'pension'), 10797);
  eq('職員4 雇保（596.98→597）', L(it, 'emp'), 597);
  eq('職員4 所得税（105,000円未満は0）', L(it, 'income_tax'), 0);
  eq('職員4 差引', it.net, 100963);
  t('職員4 扶養の数が未確認の警告', W(it, 'dependents_unchecked'));
}
{ /* 5 日給・有休1日・時間外2h・乙欄 */
  const it = run({ pay_type: 'daily', base: 9000, day_hours: 8, ins: { emp: { on: true } }, tax: { col: 'otsu', dependents: 0 } }, { workDays: 15, paidDays: 1, legalOverMin: 120 });
  eq('職員5 基本給（日給×15日）', L(it, 'basic'), 135000);
  eq('職員5 有休（日給×1日）', L(it, 'paid_leave'), 9000);
  eq('職員5 時間外（9000÷8＝1125×1.25×2h＝2812.5→2813）', L(it, 'ot_out'), 2813);
  eq('職員5 雇保', L(it, 'emp'), 734);
  eq('職員5 所得税（乙欄）', L(it, 'income_tax'), 7700);
  eq('職員5 差引', it.net, 138379);
}
{ /* 6 中途入社（12/1）・日割り・社保は取得月の翌月分から（翌月徴収なので今月は引かない） */
  const it = run({ pay_type: 'monthly', base: 210000, entry_date: '2026-12-01', birth_date: '1995-01-20', ins: { health: { on: true, from: '2026-12-01', std: 220000 }, pension: { on: true, from: '2026-12-01', std: 220000 }, emp: { on: true } },
    tax: { col: 'kou', dependents: 0 } }, { schedDays: 11 });
  eq('職員6 日割り（210000÷21.75×11＝106206.9→106206）', L(it, 'basic'), 106206);
  eq('職員6 健保なし（対象月11月は取得月12月より前）', L(it, 'health'), undefined);
  eq('職員6 雇保（531.03→531）', L(it, 'emp'), 531);
  eq('職員6 所得税（105,000〜107,000 の行）', L(it, 'income_tax'), 170);
  eq('職員6 差引', it.net, 105505);
}
{ /* 7 退職（12/10）・日割り・喪失月12月の前月11月分は引く・66歳（介護なし） */
  const it = run({ pay_type: 'monthly', base: 200000, retire_date: '2026-12-10', birth_date: '1960-06-20', ins: INS(200000, 200000), tax: { col: 'kou', dependents: 0 } }, { schedDays: 17 });
  eq('職員7 日割り（200000÷21.75×17＝156321.8→156321）', L(it, 'basic'), 156321);
  eq('職員7 健保（11月分）', L(it, 'health'), 10080);
  eq('職員7 介護なし（65歳到達の後）', L(it, 'care'), undefined);
  eq('職員7 厚年', L(it, 'pension'), 18300);
  eq('職員7 雇保', L(it, 'emp'), 782);
  eq('職員7 所得税', L(it, 'income_tax'), 1190);
  eq('職員7 差引', it.net, 125739);
}
{ /* 8 12/1 生まれの70歳（11/30 到達＝11月分から厚年なし） */
  const it = run({ pay_type: 'monthly', base: 180000, birth_date: '1956-12-01', ins: INS(180000, 180000), tax: { col: 'kou', dependents: 0 } }, {});
  eq('職員8 厚年なし', L(it, 'pension'), undefined);
  eq('職員8 健保', L(it, 'health'), 9072);
  eq('職員8 支援金', L(it, 'support'), 207);
  eq('職員8 雇保', L(it, 'emp'), 900);
  eq('職員8 所得税', L(it, 'income_tax'), 3270);
  eq('職員8 差引', it.net, 166551);
}
{ /* 9 乙欄の時給・夜勤手当（深夜の割増を含む定額）3回 */
  const NS = { code: 'ns', name: '夜勤手当', sec: 'pay', calc: 'night_shift', order: 2, attrs: { includes_night_premium: true, overtime_base: false } };
  const it = run({ pay_type: 'hourly', base: 1200, allowances: [{ code: 'ns', amount: 6000 }], ins: { emp: { on: true } }, tax: { col: 'otsu', dependents: 0 } },
    { schedInMin: 3000, nightMin: 1200, nightShiftCount: 3 }, { allowanceDefs: [NS] });
  eq('職員9 夜勤手当（6000×3回）', L(it, 'fns'), 18000);
  eq('職員9 深夜の行なし（夜勤手当に含む）', L(it, 'ot_night'), undefined);
  t('職員9 深夜の不足の警告なし（6000円 ≦ 18000円）', !W(it, 'night_shortfall'));
  eq('職員9 雇保', L(it, 'emp'), 390);
  eq('職員9 所得税（乙欄 77610×3.063%＝2377.19→2377）', L(it, 'income_tax'), 2377);
  eq('職員9 差引', it.net, 75233);
}
{ /* 10 役員・61歳（介護あり）・扶養2 */
  const it = run({ pay_type: 'board', board_pay: 500000, birth_date: '1965-04-04', ins: INS(500000, 500000), tax: { col: 'kou', dependents: 2 }, no_attendance: true }, null);
  eq('役員 役員報酬', L(it, 'board'), 500000);
  eq('役員 健保', L(it, 'health'), 25200);
  eq('役員 介護', L(it, 'care'), 4050);
  eq('役員 支援金', L(it, 'support'), 575);
  eq('役員 厚年', L(it, 'pension'), 45750);
  eq('役員 雇保なし', L(it, 'emp'), undefined);
  eq('役員 雇保の基礎0', it.emp_ins_base, 0);
  eq('役員 所得税', L(it, 'income_tax'), 11150);
  eq('役員 差引', it.net, 413275);
  t('役員 勤怠なしの警告を出さない', !W(it, 'no_att'));
}
{ /* 役員に時間外の勤怠があっても割増を払わない */
  const it = run({ pay_type: 'board', board_pay: 500000, ins: {}, tax: { col: 'none' } }, { legalOverMin: 600, holidayMin: 120 });
  eq('役員 割増なし（時間外の行が無い）', L(it, 'ot_out'), undefined);
  eq('役員 法定休日の行も無い', L(it, 'ot_holiday'), undefined);
}

console.log('2. 50銭の境目');
eq('round50 0.5 は切捨て', C.round50(C._q.Q(1, 2)), 0);
eq('round50 0.501 は切上げ', C.round50(C._q.Q(501, 1000)), 1);
eq('round50 264.5→264', C.round50(C._q.Q(5290, 20)), 264);
eq('round50 100.4999→100', C.round50(C._q.Q(1004999, 10000)), 100);
eq('round50 負は0', C.round50(C._q.Q(-3, 2)), 0);
{ /* 雇保: 賃金 100100 ×5/1000＝500.5（50銭ちょうど→切捨て）／100101→500.505（50銭5厘→切上げ） */
  const a = run({ pay_type: 'monthly', base: 100100, ins: { emp: { on: true } }, tax: { col: 'none' } }, {});
  const b = run({ pay_type: 'monthly', base: 100101, ins: { emp: { on: true } }, tax: { col: 'none' } }, {});
  eq('雇保 500.5 → 500', L(a, 'emp'), 500);
  eq('雇保 500.505 → 501', L(b, 'emp'), 501);
}
{ /* 健保: 標準報酬 58000 × 0.1008 ÷2 ＝ 2923.2 → 2923、支援金 58000×0.0023÷2＝66.7 → 67 */
  const it = run({ pay_type: 'monthly', base: 60000, ins: INS(58000, 88000), tax: { col: 'none' } }, {});
  eq('健保 等級1 2923.2→2923', L(it, 'health'), 2923);
  eq('支援金 等級1 66.7→67', L(it, 'support'), 67);
  eq('厚年 88000×0.183÷2＝8052', L(it, 'pension'), 8052);
  const er = it.lines.find((x) => x.code === 'er_support');
  t('会社の支援金は丸めずに 133.4−67＝66.4', er && Math.abs(er.amount - 66.4) < 1e-9, er && er.amount);
  const ch = it.lines.find((x) => x.code === 'er_child');
  t('拠出金は会社だけ（88000×0.36%＝316.8）', ch && Math.abs(ch.amount - 316.8) < 1e-9, ch && ch.amount);
}

console.log('3. 時間単価の円未満切上げ・時給の割増');
{
  const a = run({ pay_type: 'monthly', base: 172000, ins: {}, tax: { col: 'none' } }, { legalOverMin: 60 });
  eq('月給 172000÷172＝1000 ちょうど×1.25＝1250', L(a, 'ot_out'), 1250);
  const b = run({ pay_type: 'monthly', base: 172001, ins: {}, tax: { col: 'none' } }, { legalOverMin: 60 });
  eq('月給 172001÷172＝1000.006→単価1001×1.25＝1251.25→1252', L(b, 'ot_out'), 1252);
  const c = run({ pay_type: 'monthly', base: 200000, avg_month_hours: 160, ins: {}, tax: { col: 'none' } }, { legalOverMin: 60 });
  eq('職員ごとの月平均所定労働時間（160）を使う 1250×1.25', L(c, 'ot_out'), 1563);
  const d = run({ pay_type: 'monthly', base: 172000, ins: {}, tax: { col: 'none' } }, { legalOverMin: 1 });
  eq('時間外1分（1000×1.25÷60＝20.83→21）', L(d, 'ot_out'), 21);
}
{ /* 時給者の割増の基礎に月額の手当を足す（検品の3）: 1000＋17200÷172＝1100 */
  const it = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'q', amount: 17200 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 6000, legalOverMin: 60 }, { allowanceDefs: [QUAL] });
  eq('時給＋月額手当÷172＝1100 ×1.25×1h', L(it, 'ot_out'), 1375);
  const it2 = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'q', amount: 17200 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 6000, legalOverMin: 60 },
    { allowanceDefs: [Object.assign({}, QUAL, { attrs: { overtime_base: false } })] });
  eq('割増の基礎に入れない手当なら 1000×1.25', L(it2, 'ot_out'), 1250);
}
{ /* 月給: 割増の基礎に入る手当／入らない手当 */
  const DEF2 = { code: 'k', name: '家族手当', sec: 'pay', calc: 'fixed', order: 2, attrs: { overtime_base: false } };
  const it = run({ pay_type: 'monthly', base: 160000, allowances: [{ code: 'q', amount: 12000 }, { code: 'k', amount: 10000 }], ins: {}, tax: { col: 'none' } }, { legalOverMin: 60 },
    { allowanceDefs: [QUAL, DEF2] });
  eq('月給の単価（160000＋12000）÷172＝1000 ×1.25', L(it, 'ot_out'), 1250);
  eq('手当の並び（定義の order）', it.lines.filter((l) => l.sec === 'pay').map((l) => l.code).join(','), 'basic,fq,fk,ot_out');
}

console.log('4. 60時間超・深夜・法定休日');
{
  const base = { pay_type: 'monthly', base: 172000, ins: {}, tax: { col: 'none' } };
  const a = run(base, { legalOverMin: 3600, over60Min: 0 });
  eq('60時間ちょうど: 時間外 1000×1.25×60＝75000', L(a, 'ot_out'), 75000);
  eq('60時間ちょうど: 上乗せの行なし', L(a, 'ot_over60'), undefined);
  const b = run(base, { legalOverMin: 3601, over60Min: 1 });
  eq('60時間1分: 時間外 1000×1.25×3601分÷60＝75020.83→75021', L(b, 'ot_out'), 75021);
  eq('60時間1分: 上乗せ 1000×0.25÷60＝4.17→5', L(b, 'ot_over60'), 5);
  const c = run(base, { legalOverMin: 4200, over60Min: 600 });
  eq('70時間: 上乗せ 1000×0.25×10h＝2500', L(c, 'ot_over60'), 2500);
  const d = run(base, { nightMin: 60 }, { settings: { night_premium: 'pay' } });
  eq('深夜を払う設定: 1000×0.25×1h＝250', L(d, 'ot_night'), 250);
  /* 期待を変えた（反証レビュー 3・2026-11-19）: 前は「深夜の行なし＋不足の警告」だった。
     深夜の割増を含む手当が無い人は含めようがないので、既定（included）でも上乗せを払う */
  const e = run(base, { nightMin: 60 });
  eq('既定（夜勤手当に含む）でも、含む手当の無い人は深夜の上乗せを払う（250）', L(e, 'ot_night'), 250);
  t('含む手当の無い人に不足の警告は出さない', !W(e, 'night_shortfall'));
  const f = run(base, { holidayMin: 90 });
  eq('法定休日 1000×1.35×1.5h＝2025', L(f, 'ot_holiday'), 2025);
  const g = run(base, { legalInOverMin: 30 });
  eq('法定内残業 1000×1.00×0.5h＝500', L(g, 'ot_in'), 500);
  const h = run(base, { legalOverMin: 60 }, { settings: { ot_rates: { out: 1.3 } } });
  eq('割増率を設定で 1.3 に', L(h, 'ot_out'), 1300);
}

console.log('5. 年齢の到達（誕生日の前日）');
eq('40歳到達日（1986-12-01 生）＝2026-11-30', C.reachDate('1986-12-01', 40), '2026-11-30');
eq('40歳到達日（1986-12-02 生）＝2026-12-01', C.reachDate('1986-12-02', 40), '2026-12-01');
eq('40歳到達月（1986-01-01 生）＝2025-12', C.reachYm('1986-01-01', 40), '2025-12');
eq('2/29 生まれの平年の誕生日は 3/1（前日 2/28 に到達）', C.reachDate('1988-02-29', 39), '2027-02-28');
function careOf(birth, settings, ym) {
  return L(C.computeItem({ ym: ym || '2026-12', period: PERIOD, payDate: '2026-12-25', settings: settings || {}, profile: { pay_type: 'monthly', base: 300000, birth_date: birth, ins: INS(300000, 300000), tax: { col: 'none' } }, att: {} }), 'care');
}
eq('介護: 12/2 生まれは 12/1 到達＝11月分は無し', careOf('1986-12-02'), undefined);
eq('介護: 11/2 生まれは 11/1 到達＝11月分から', careOf('1986-11-02'), 2430);
eq('介護: 当月徴収なら 12/2 生まれは12月分から引く', careOf('1986-12-02', { si_month: 'current' }), 2430);
eq('介護: 65歳 12/1 生まれ（11/30 到達＝11月分から無し）', careOf('1961-12-01'), undefined);
eq('介護: 65歳 12/2 生まれ（12/1 到達＝11月分はまだ引く）', careOf('1961-12-02'), 2430);
eq('介護: 免除の印', L(run({ pay_type: 'monthly', base: 300000, birth_date: '1980-01-01', ins: Object.assign(INS(300000, 300000), { care_exempt: true }), tax: { col: 'none' } }, {}), 'care'), undefined);
function pensionOf(birth) { return L(run({ pay_type: 'monthly', base: 300000, birth_date: birth, ins: INS(300000, 300000), tax: { col: 'none' } }, {}), 'pension'); }
eq('厚年: 70歳 12/2 生まれ（12/1 到達）は11月分を引く', pensionOf('1956-12-02'), 27450);
eq('厚年: 70歳 12/1 生まれ（11/30 到達）は11月分から無し', pensionOf('1956-12-01'), undefined);
function healthOf(birth) { return L(run({ pay_type: 'monthly', base: 300000, birth_date: birth, ins: INS(300000, 300000), tax: { col: 'none' } }, {}), 'health'); }
eq('健保: 75歳の誕生日が12/1（11月分は引く・誕生日の前月まで）', healthOf('1951-12-01'), 15120);
eq('健保: 75歳の誕生日が11/1（11月分から無し・1日生まれ）', healthOf('1951-11-01'), undefined);
eq('健保: 75歳の誕生日が11/30（11月分から無し）', healthOf('1951-11-30'), undefined);
eq('健保: 75歳の誕生日が12/15（11月分は引く）', healthOf('1951-12-15'), 15120);
t('生年月日が空の警告', W(run({ pay_type: 'monthly', base: 300000, ins: INS(300000, 300000), tax: { col: 'none' } }, {}), 'birth_missing'));

console.log('6. 翌月・当月徴収と資格の取得・喪失');
function hp(ins, si) { return L(C.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: { si_month: si || 'next' }, profile: { pay_type: 'monthly', base: 300000, birth_date: '1990-01-01', ins: Object.assign({ emp: { on: false } }, ins), tax: { col: 'none' } }, att: {} }), 'health'); }
eq('翌月徴収: 11月取得 → 12月分の明細で11月分を引く', hp({ health: { on: true, from: '2026-11-20', std: 300000 } }), 15120);
eq('翌月徴収: 12月取得 → 引かない', hp({ health: { on: true, from: '2026-12-01', std: 300000 } }), undefined);
eq('当月徴収: 12月取得 → 12月分を引く', hp({ health: { on: true, from: '2026-12-01', std: 300000 } }, 'current'), 15120);
eq('喪失日 12/1（11/30 退職）→ 11月分は引く', hp({ health: { on: true, from: '2020-04-01', to: '2026-12-01', std: 300000 } }), 15120);
eq('喪失日 11/30（11/29 退職）→ 11月分は無し', hp({ health: { on: true, from: '2020-04-01', to: '2026-11-30', std: 300000 } }), undefined);
eq('当月徴収で喪失日 12/1 → 12月分は無し', hp({ health: { on: true, from: '2020-04-01', to: '2026-12-01', std: 300000 } }, 'current'), undefined);
eq('同月得喪（11/5 取得・11/20 喪失）→ 11月分は1か月分', hp({ health: { on: true, from: '2026-11-05', to: '2026-11-20', std: 300000 } }), 15120);
eq('同月得喪（10月）→ 11月分は無し', hp({ health: { on: true, from: '2026-10-05', to: '2026-10-20', std: 300000 } }), undefined);
eq('ins.to が無い時は退職日の翌日を喪失日とする（11/30 退職→11月分あり）', L(C.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: {},
  profile: { pay_type: 'monthly', base: 300000, birth_date: '1990-01-01', retire_date: '2026-11-30', ins: { health: { on: true, from: '2020-04-01', std: 300000 } }, tax: { col: 'none' } }, att: {} }), 'health'), 15120);
t('insCovered 取得月の前は false', C.insCovered({ from: '2026-12-01' }, {}, '2026-11') === false);
t('insCovered 取得月は true', C.insCovered({ from: '2026-12-31' }, {}, '2026-12') === true);
t('標準報酬が空の警告', W(run({ pay_type: 'monthly', base: 300000, birth_date: '1990-01-01', ins: { health: { on: true }, pension: { on: true }, emp: { on: false } }, tax: { col: 'none' } }, {}), 'std_missing'));
t('等級表に無い標準報酬の警告', W(run({ pay_type: 'monthly', base: 300000, birth_date: '1990-01-01', ins: INS(301000, 300000), tax: { col: 'none' } }, {}), 'std_bad'));

console.log('7. 率表の境目（対象月・締め日）');
{
  const mk = (ym, si) => C.computeItem({ ym, period: { from: C.addDays(ym + '-15', -29), to: ym + '-15' }, payDate: ym + '-25', settings: { si_month: si || 'next' }, profile: { pay_type: 'monthly', base: 300000, birth_date: '1990-01-01', ins: INS(300000, 300000), tax: { col: 'none' } }, att: {} });
  eq('4月分の明細（対象月3月）: 支援金なし', L(mk('2026-04'), 'support'), undefined);
  eq('4月分の明細（対象月3月）: 健保は令和8年度の率', L(mk('2026-04'), 'health'), 15120);
  eq('5月分の明細（対象月4月）: 支援金あり', L(mk('2026-05'), 'support'), 345);
  eq('当月徴収 4月分: 支援金あり', L(mk('2026-04', 'current'), 'support'), 345);
  const old = mk('2026-03');
  t('3月分の明細（対象月2月）は率が無い → 警告', W(old, 'rate_missing'));
  eq('率が無い月は健保を引かない', L(old, 'health'), undefined);
  t('3月分（締め 3/15）は雇保の率が無い → 警告', W(old, 'emp_rate_missing'));
  eq('4月分（締め 4/15）は雇保の新しい率', L(mk('2026-04'), 'emp'), 1500);
}
t('率表: 締め日 2026-03-31 は雇保の率なし', Rates.employment('2026-03-31') === null);
t('率表: 締め日 2026-04-01 は 5/1000', Rates.employment('2026-04-01').worker === 0.005);
t('率表: 締め日 2027-04-01 は確かめていない → null', Rates.employment('2027-04-01') === null);
t('率表: 健保 2026-02 は null', Rates.health('43', '2026-02') === null);
t('率表: 健保 2027-03 は確かめていない → null', Rates.health('43', '2027-03') === null);
t('率表: ほかの県は null', Rates.health('13', '2026-06') === null);
/* 2026-11-23: 熊本の最低賃金を一次資料（熊本労働局の推移の表・厚労省の全国一覧）で入れたので、前の「null」の場面を発効日の境目に置き換えた */
eq('率表: 最低賃金 熊本 2024-10-04 は表の前 → null', Rates.minWage('43', '2024-10-04'), null);
eq('率表: 最低賃金 熊本 2024-10-05 は 952', Rates.minWage('43', '2024-10-05'), 952);
eq('率表: 最低賃金 熊本 2025-12-31 は 952', Rates.minWage('43', '2025-12-31'), 952);
eq('率表: 最低賃金 熊本 2026-01-01 は 1034', Rates.minWage('43', '2026-01-01'), 1034);
eq('率表: 最低賃金 熊本 2026-11-30 は 1034', Rates.minWage('43', '2026-11-30'), 1034);
eq('率表: 最低賃金 熊本 2026-12-01 は 1092', Rates.minWage('43', '2026-12-01'), 1092);
eq('率表: 最低賃金 ほかの県は null', Rates.minWage('13', '2026-12-01'), null);
eq('率表: 最低賃金 日付の形が違えば null', Rates.minWage('43', '2026/12/01'), null);
t('率表: 通勤の非課税限度は確かめていない → null', Rates.commuteLimit('2026-12-25', 'transit', 10) === null);
eq('等級: 62999 → 健保1（58000）', Rates.grade(62999).health.std, 58000);
eq('等級: 63000 → 健保2（68000）', Rates.grade(63000).health.std, 68000);
eq('等級: 92999 → 厚年1（88000）', Rates.grade(92999).pension.std, 88000);
eq('等級: 50000 → 厚年1（下限 88000）', Rates.grade(50000).pension.grade, 1);
eq('等級: 635000 → 厚年32（650000）', Rates.grade(635000).pension.std, 650000);
eq('等級: 2000000 → 厚年32', Rates.grade(2000000).pension.grade, 32);
eq('等級: 1355000 → 健保50', Rates.grade(1355000).health.grade, 50);
eq('等級: 1354999 → 健保49', Rates.grade(1354999).health.grade, 49);
t('等級: 厚年に 58000 は無い', Rates.isStd('pension', 58000) === false);
t('等級: 健保に 58000 はある', Rates.isStd('health', 58000) === true);

console.log('8. マイナスの支給・調整・通勤');
{
  const NEG = { code: 'dc', name: '選択制DC', sec: 'pay', calc: 'fixed', order: 5, attrs: { income_tax: true, labor_ins: true } };
  const it = run({ pay_type: 'monthly', base: 200000, allowances: [{ code: 'dc', amount: -10000 }], ins: { emp: { on: true } }, tax: { col: 'kou', dependents: 0 } }, {}, { allowanceDefs: [NEG] });
  eq('マイナスの支給で総支給が減る', it.gross, 190000);
  eq('マイナスの支給で課税が減る', it.taxable, 190000);
  eq('マイナスの支給で雇保の基礎が減る（950）', L(it, 'emp'), 950);
  eq('課税対象 190000−950＝189050', it.tax_base, 189050);
}
{
  const it = run({ pay_type: 'monthly', base: 200000, ins: { emp: { on: true } }, tax: { col: 'none' } }, {},
    { adjustments: [{ kind: 'pay', name: '前月の差額', amount: 3000, reason: '架空' }, { kind: 'pay_nontax', name: '立替の精算', amount: 2000 },
      { kind: 'deduct', name: '親睦会費', amount: 1000 }, { kind: 'deduct_si', name: '社会保険料差額返金', amount: -500 }] });
  eq('調整: 総支給 200000＋3000＋2000', it.gross, 205000);
  eq('調整: 非課税の支給は課税に入らない', it.taxable, 203000);
  eq('調整: 雇保の基礎は課税の支給まで（203000）', it.emp_ins_base, 203000);
  eq('調整: 社会保険料として扱う返金は社保等を減らす（1015−500）', it.si_total, 515);
  eq('調整: 控除の合計（雇保1015＋1000−500）', it.deduct, 1515);
  eq('調整: 差引', it.net, 203485);
}
{
  const it = run({ pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 } }, {}, { adjustments: [{ kind: 'tax_adjust', name: '年調の精算', amount: -2000 }] });
  eq('税の精算は別の行（所得税は税額表の 7930 のまま）', L(it, 'income_tax'), 7930);
  eq('税の精算の行 −2000', L(it, 'tax_adjust'), -2000);
  eq('税の精算: 差引 300000−7930＋2000', it.net, 294070);
  const it2 = run({ pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 } }, {}, { adjustments: [{ kind: 'tax_adjust', name: '年調の還付', amount: -10000 }] });
  eq('還付がその月の税額を超えても消さない（−10000 のまま）', L(it2, 'tax_adjust'), -10000);
  eq('還付が税額を超える: 差引 300000−7930＋10000', it2.net, 302070);
  const it3 = run({ pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'none' } }, {}, { adjustments: [{ kind: 'tax_adjust', name: '年調の精算', amount: 1500 }] });
  eq('源泉の区分 none でも精算の行を出す', L(it3, 'tax_adjust'), 1500);
}
{ /* 定額の控除: 社会保険料として扱う（定義の social_ins が true）は税の基礎から引く */
  const DSI = { code: 'si2', name: '社会保険料の追加', sec: 'deduct', calc: 'fixed', order: 10, attrs: { social_ins: true } };
  const DNO = { code: 'rent', name: '寮費', sec: 'deduct', calc: 'fixed', order: 11 };
  const a = run({ pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 }, deductions: [{ code: 'si2', amount: 20000 }] }, {}, { allowanceDefs: [DSI] });
  eq('社会保険料として扱う控除: 社保等 20000', a.si_total, 20000);
  eq('社会保険料として扱う控除: 課税対象 280000', a.tax_base, 280000);
  eq('社会保険料として扱う控除: 所得税（280,000円の行 7180）', L(a, 'income_tax'), 7180);
  eq('社会保険料として扱う控除の行', L(a, 'd:si2'), 20000);
  eq('差引 300000−20000−7180', a.net, 272820);
  const b = run({ pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 }, deductions: [{ code: 'rent', amount: 20000 }] }, {}, { allowanceDefs: [DNO] });
  eq('社会保険料として扱わない控除（既定）は税の基礎を変えない', b.tax_base, 300000);
  eq('扱わない控除: 所得税 7930', L(b, 'income_tax'), 7930);
}
{ /* 定義の無い code */
  const it = run({ pay_type: 'monthly', base: 200000, allowances: [{ code: 'nodef', amount: 5000 }], deductions: [{ code: 'nodef2', amount: 100 }], ins: {}, tax: { col: 'none' } }, {});
  t('定義の無い手当・控除は警告（黙って落とさない）', W(it, 'def_missing'));
  eq('定義の無い手当は総支給に入れない', it.gross, 200000);
}
{ /* 期間の外の退職・入社 */
  t('期間の前に退職した人は警告', W(run({ pay_type: 'monthly', base: 200000, retire_date: '2026-11-10', ins: {}, tax: { col: 'none' } }, {}), 'out_of_period'));
  t('期間の後に入社する人は警告', W(run({ pay_type: 'monthly', base: 200000, entry_date: '2026-12-20', ins: {}, tax: { col: 'none' } }, {}), 'out_of_period'));
  t('期間の中の退職は警告なし', !W(run({ pay_type: 'monthly', base: 200000, retire_date: '2026-12-10', ins: {}, tax: { col: 'none' } }, { schedDays: 17 }), 'out_of_period'));
}
{
  const R1 = ratesWith({ commuteLimit: () => 4200 });
  const it = run({ pay_type: 'monthly', base: 200000, ins: { emp: { on: true } }, tax: { col: 'none' }, commute: { monthly: 10000, means: 'car', distance_km: 8 } }, {}, { rates: R1 });
  eq('通勤の超過: 課税に 10000−4200 を入れる', it.taxable, 205800);
  eq('通勤の超過: 非課税の区分は 4200', it.buckets.nontax, 4200);
  eq('通勤は雇保の基礎に入る（210000×5/1000）', L(it, 'emp'), 1050);
  const it2 = run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' }, commute: { monthly: 10000 } }, {});
  t('通勤の非課税限度が無い → 警告して全額非課税', W(it2, 'commute_limit_unknown') && it2.taxable === 200000);
  const it3 = run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' }, commute: { monthly: 3000 } }, {}, { rates: R1 });
  eq('限度の内なら全額非課税', it3.taxable, 200000);
}
{
  const NT = { code: 'nt', name: '非課税の手当', sec: 'pay', calc: 'fixed', order: 3, attrs: { income_tax: false, labor_ins: false } };
  const it = run({ pay_type: 'monthly', base: 200000, allowances: [{ code: 'nt', amount: 5000 }], ins: { emp: { on: true } }, tax: { col: 'none' } }, {}, { allowanceDefs: [NT] });
  eq('非課税・労働保険に含めない手当: 課税 200000', it.taxable, 200000);
  eq('非課税・労働保険に含めない手当: 雇保の基礎 200000', it.emp_ins_base, 200000);
}

console.log('9. 欠勤・遅刻早退・日割り');
{
  const ATTB = { code: 'ab', name: '職務手当', sec: 'pay', calc: 'fixed', order: 1, attrs: { attendance_base: true } };
  const it = run({ pay_type: 'monthly', base: 200000, allowances: [{ code: 'ab', amount: 6000 }], ins: {}, tax: { col: 'none' } }, { lateMin: 30, earlyLeaveMin: 15 }, { allowanceDefs: [ATTB] });
  eq('遅刻早退: 単価 206000÷172＝1197.67→1197 ×45分÷60＝897.75→897', L(it, 'late'), -897);
  const it2 = run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' } }, { lateMin: 30 }, { settings: { late_deduct: false } });
  eq('遅刻早退の控除をしない設定', L(it2, 'late'), undefined);
  const it3 = run({ pay_type: 'hourly', base: 1100, ins: {}, tax: { col: 'none' } }, { schedInMin: 600, absentDays: 2, lateMin: 30 });
  t('時給者は欠勤・遅刻の控除をしない', L(it3, 'absence') === undefined && L(it3, 'late') === undefined);
  const it4 = run({ pay_type: 'monthly', base: 200000, day_hours: 7.5, ins: {}, tax: { col: 'none' } }, { absentDays: 2 });
  eq('欠勤: 1日の所定7.5h（1162×7.5×2＝17430）', L(it4, 'absence'), -17430);
  const it5 = run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' } }, { absentDays: 40 });
  eq('全欠でも基本給を超えて引かない', it5.gross, 0);
  const it6 = run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' } }, { absentDays: 1 }, { settings: { absence_deduct: false } });
  eq('欠勤控除をしない設定', L(it6, 'absence'), undefined);
}
{
  const PR = { code: 'pr', name: '役職手当', sec: 'pay', calc: 'fixed', order: 1, attrs: { prorate: true } };
  const it = run({ pay_type: 'monthly', base: 217500, allowances: [{ code: 'pr', amount: 21750 }, { code: 'q', amount: 10000 }], entry_date: '2026-12-01', ins: {}, tax: { col: 'none' }, commute: { monthly: 6000 } },
    { schedDays: 10 }, { allowanceDefs: [PR, Object.assign({}, QUAL, { order: 2 })] });
  eq('日割り: 217500÷21.75×10＝100000', L(it, 'basic'), 100000);
  eq('日割りの印のある手当も日割り（10000）', L(it, 'fpr'), 10000);
  eq('日割りの印の無い手当は満額', L(it, 'fq'), 10000);
  eq('通勤は日割りしない', L(it, 'commute'), 6000);
  const it2 = run({ pay_type: 'monthly', base: 200000, entry_date: '2026-11-16', ins: {}, tax: { col: 'none' } }, { schedDays: 21 });
  eq('期間の初日の入社は日割りしない', L(it2, 'basic'), 200000);
  const it3 = run({ pay_type: 'monthly', base: 200000, retire_date: '2026-12-15', ins: {}, tax: { col: 'none' } }, { schedDays: 21 });
  eq('期間の末日の退職は日割りしない', L(it3, 'basic'), 200000);
  const it4 = run({ pay_type: 'monthly', base: 200000, entry_date: '2026-11-20', ins: {}, tax: { col: 'none' } }, { schedDays: 30 });
  eq('日割りは満額を超えない', L(it4, 'basic'), 200000);
  const it5 = C.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: { holidays: ['2026-12-14'] },
    profile: { pay_type: 'monthly', base: 217500, entry_date: '2026-12-01', no_attendance: true, ins: {}, tax: { col: 'none' } }, att: null });
  eq('勤怠が無い時は平日−祝日で数える（12/1〜15 の平日11日−祝日1日＝10日）', L(it5, 'basic'), 100000);
  const it6 = run({ pay_type: 'board', board_pay: 300000, entry_date: '2026-12-01', ins: {}, tax: { col: 'none' } }, null);
  eq('役員報酬は日割りしない', L(it6, 'board'), 300000);
}

console.log('10. 回数で払う手当');
{
  const D = [{ code: 'es', name: '早出手当', sec: 'pay', calc: 'count', order: 1 }, { code: 'dy', name: '日額手当', sec: 'pay', calc: 'day', order: 2 },
    { code: 'hr', name: '時間手当', sec: 'pay', calc: 'hour', order: 3 }];
  const it = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'es', amount: 500, count_source: '早' }, { code: 'dy', amount: 100 }, { code: 'hr', amount: 50 }], ins: {}, tax: { col: 'none' } },
    { schedInMin: 600, workMin: 610, workDays: 3, counts: { '早': 4 } }, { allowanceDefs: D });
  eq('回数×単価（4×500）', L(it, 'fes'), 2000);
  eq('出勤日数×単価', L(it, 'fdy'), 300);
  eq('時間×単価（50×610分÷60＝508.3→509）', L(it, 'fhr'), 509);
  const it2 = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'es', amount: 500, count_source: 'manual', count: 2 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 600 }, { allowanceDefs: D });
  eq('手入力の回数', L(it2, 'fes'), 1000);
}

console.log('11. 警告');
{
  const R2 = ratesWith({ minWage: () => 1000 });
  t('最賃割れ（時給 999）', W(run({ pay_type: 'hourly', base: 999, ins: {}, tax: { col: 'none' } }, { schedInMin: 600 }, { rates: R2 }), 'min_wage'));
  t('最賃ちょうど（時給 1000）は警告なし', !W(run({ pay_type: 'hourly', base: 1000, ins: {}, tax: { col: 'none' } }, { schedInMin: 600 }, { rates: R2 }), 'min_wage'));
  t('月給 171999÷172＜1000 は最賃割れ', W(run({ pay_type: 'monthly', base: 171999, ins: {}, tax: { col: 'none' } }, {}, { rates: R2 }), 'min_wage'));
  t('月給 172000 は警告なし', !W(run({ pay_type: 'monthly', base: 172000, ins: {}, tax: { col: 'none' } }, {}, { rates: R2 }), 'min_wage'));
  t('最賃に入る手当を足して判定（171000＋1000）', !W(run({ pay_type: 'monthly', base: 171000, allowances: [{ code: 'q', amount: 1000 }], ins: {}, tax: { col: 'none' } }, {}, { rates: R2, allowanceDefs: [QUAL] }), 'min_wage'));
  /* 2026-11-23: 出荷の率表に熊本の最低賃金を入れたので、「率表に無い」場面は表に無い県（'13'）で試す */
  t('最賃が率表に無い（表に無い県） → 判定できない警告', W(run({ pay_type: 'hourly', base: 1100, ins: {}, tax: { col: 'none' } }, { schedInMin: 600 }, { settings: { prefecture: '13' } }), 'min_wage_unknown'));
  t('出荷の率表: 締め 2026-12-15 の熊本は 1092 円・時給 1091 は最賃割れ', W(run({ pay_type: 'hourly', base: 1091, ins: {}, tax: { col: 'none' } }, { schedInMin: 600 }), 'min_wage'));
  t('出荷の率表: 時給 1092 は警告なし・判定できない警告も出ない', (function (it) { return !W(it, 'min_wage') && !W(it, 'min_wage_unknown'); })(run({ pay_type: 'hourly', base: 1092, ins: {}, tax: { col: 'none' } }, { schedInMin: 600 })));
  t('出荷の率表: 締め 2026-11-15 は 1034 円・時給 1034 は警告なし', !W(run({ pay_type: 'hourly', base: 1034, ins: {}, tax: { col: 'none' } }, { schedInMin: 600 }, { ym: '2026-11', period: { from: '2026-10-16', to: '2026-11-15' }, payDate: '2026-11-25' }), 'min_wage'));
  t('役員は最賃を見ない', !W(run({ pay_type: 'board', board_pay: 100, ins: {}, tax: { col: 'none' } }, null, { rates: R2 }), 'min_wage'));
}
{
  const it = run({ pay_type: 'monthly', base: 50000, ins: {}, tax: { col: 'none' } }, {}, { adjustments: [{ kind: 'deduct', name: '寮費', amount: 60000 }] });
  t('差引マイナスの警告', W(it, 'net_negative') && it.net === -10000, it.net);
  t('前月から20%増の警告', W(run({ pay_type: 'monthly', base: 240000, ins: {}, tax: { col: 'none' } }, {}, { prevItem: { gross: 200000, net: 180000 } }), 'prev_change'));
  t('前月から19.9%増は警告なし', !W(run({ pay_type: 'monthly', base: 239800, ins: {}, tax: { col: 'none' } }, {}, { prevItem: { gross: 200000, net: 180000 } }), 'prev_change'));
  t('前月から20%減の警告', W(run({ pay_type: 'monthly', base: 160000, ins: {}, tax: { col: 'none' } }, {}, { prevItem: { gross: 200000, net: 180000 } }), 'prev_change'));
  t('勤怠の要確認の残り', W(run({ pay_type: 'hourly', base: 1100, ins: {}, tax: { col: 'none' } }, { schedInMin: 60, reviewCount: 2 }), 'review_left'));
  t('勤怠が未締め', W(run({ pay_type: 'hourly', base: 1100, ins: {}, tax: { col: 'none' } }, { schedInMin: 60, locked: false }), 'kintai_unlocked'));
  t('勤怠が無い時給者の警告', W(run({ pay_type: 'hourly', base: 1100, ins: {}, tax: { col: 'none' } }, null), 'no_att'));
  t('源泉の区分が無い警告', W(run({ pay_type: 'monthly', base: 200000, ins: {} }, {}), 'tax_col'));
  const ex = run({ pay_type: 'monthly', base: 200000, exclude: true }, {});
  t('計算から外す人は行なし', ex.lines.length === 0 && W(ex, 'excluded'));
  t('給与形態が無い', W(run({ base: 200000 }, {}), 'pay_type'));
  t('支給日の形が違う', W(C.computeItem({ ym: '2026-12', period: PERIOD, payDate: '12/25', profile: { pay_type: 'monthly', base: 1 } }), 'badinput'));
  t('支給日の年の税額表が無い（2028年）', W(C.computeItem({ ym: '2028-01', period: { from: '2027-12-16', to: '2028-01-15' }, payDate: '2028-01-25', profile: { pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 } }, att: {} }), 'tax_table_missing'));
}

console.log('12. 源泉（令和8年と9年の切り替え・乙欄・扶養7人超・電算機特例）');
{
  const mk = (payDate, ym, tax, base) => C.computeItem({ ym, period: { from: ym === '2027-01' ? '2026-12-16' : '2026-11-16', to: ym === '2027-01' ? '2027-01-15' : '2026-12-15' }, payDate,
    settings: {}, profile: { pay_type: 'monthly', base: base || 300000, ins: {}, tax }, att: {} });
  eq('2026-12-25 支給・30万・甲0人（令和8年分 299,000〜302,000＝7930）', L(mk('2026-12-25', '2026-12', { col: 'kou', dependents: 0 }), 'income_tax'), 7930);
  eq('2027-01-25 支給・30万・甲0人（令和9年分＝7760）', L(mk('2027-01-25', '2027-01', { col: 'kou', dependents: 0 }), 'income_tax'), 7760);
  eq('2026-12-25 支給・30万・乙欄（53600）', L(mk('2026-12-25', '2026-12', { col: 'otsu', dependents: 0 }), 'income_tax'), 53600);
  eq('2027-01-25 支給・30万・乙欄（53200）', L(mk('2027-01-25', '2027-01', { col: 'otsu', dependents: 0 }), 'income_tax'), 53200);
  /* 2026-11-21（給与の反証の直し・仮置き）: 乙欄では扶養の数を引かない（甲から乙へ変えた人の数が残るため）。前は 53600−1610×2＝50380 にしていた。扶養の数が1以上なら警告 */
  eq('乙欄・扶養の数2は引かない（53600のまま）', L(mk('2026-12-25', '2026-12', { col: 'otsu', dependents: 2 }), 'income_tax'), 53600);
  t('乙欄・扶養の数が1以上は警告 otsu_dependents・0は出さない', W(mk('2026-12-25', '2026-12', { col: 'otsu', dependents: 2 }), 'otsu_dependents') && !W(mk('2026-12-25', '2026-12', { col: 'otsu', dependents: 0 }), 'otsu_dependents') && !W(mk('2026-12-25', '2026-12', { col: 'kou', dependents: 2 }), 'otsu_dependents'));
  eq('甲・扶養9人（50万の7人 4830−1610×2＝1610）', L(mk('2026-12-25', '2026-12', { col: 'kou', dependents: 9 }, 500000), 'income_tax'), 1610);
  eq('甲・扶養10人は0円より下げない', L(mk('2026-12-25', '2026-12', { col: 'kou', dependents: 10 }, 500000), 'income_tax'), 0);
  eq('区分 none は0円・行も無い', L(mk('2026-12-25', '2026-12', { col: 'none' }), 'income_tax'), undefined);
  eq('電算機特例の検算例（A=175000・扶養2＝210円）', C.taxComputerR8(175000, 2), 210);
  eq('電算機特例: 設定で選ぶ', L(C.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: { tax_method: 'computer' }, profile: { pay_type: 'monthly', base: 175000, ins: {}, tax: { col: 'kou', dependents: 2 } }, att: {} }), 'income_tax'), 210);
  const c9 = C.computeItem({ ym: '2027-01', period: { from: '2026-12-16', to: '2027-01-15' }, payDate: '2027-01-25', settings: { tax_method: 'computer' }, profile: { pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 } }, att: {} });
  /* 2026-11-23: 令和9年分の式を足したので、前の「式が無い → 税額表」の場面は 2028 年の支給へ移した */
  t('電算機特例 2027-01-25 支給は令和9年分の式（警告なし）', !W(c9, 'tax_computer_unavailable') && L(c9, 'income_tax') === 7740);   /* (300,000−96,667−51,667)×5.105%＝7,742.5→7,740（税額表なら 7,760） */
  const c10 = C.computeItem({ ym: '2028-01', period: { from: '2027-12-16', to: '2028-01-15' }, payDate: '2028-01-25', settings: { tax_method: 'computer' }, profile: { pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'kou', dependents: 0 } }, att: {} });
  t('電算機特例 2028 年の支給は式が無い → 警告', W(c10, 'tax_computer_unavailable'));
  /* 国税庁 denshi_01.pdf の計算例（令和8年分・令和9年分）。扶養の数は配偶者を含めた源泉控除対象の人数 */
  eq('令和8年分の例2（446,000・配偶者＋7人＝940）', C.taxComputer(446000, 8, 2026), 940);
  eq('令和8年分の例3（775,200・配偶者＋2人＝59,470）', C.taxComputer(775200, 3, 2026), 59470);
  eq('令和9年分の例1（177,000・配偶者＋1人＝110）', C.taxComputer(177000, 2, 2027), 110);
  eq('令和9年分の例2（446,000・配偶者＋7人＝770）', C.taxComputer(446000, 8, 2027), 770);
  eq('令和9年分の例3（775,200・配偶者＋2人＝58,790）', C.taxComputer(775200, 3, 2027), 58790);
  /* 境目（手で数えた額）: 令和9年は 169,444 以下の給与所得控除が 57,500・2,120,833 以下の基礎控除が 51,667 */
  eq('令和9年分 A=160,000（(160,000−57,500−51,667)×5.105%＝2,595→2,600）', C.taxComputer(160000, 0, 2027), 2600);
  eq('令和8年分 A=160,000（控除 160,000×30%+6,667＝54,667・(160,000−54,667−48,334)×5.105%＝2,909.8→2,910）', C.taxComputer(160000, 0, 2026), 2910);
  eq('令和9年分 A=169,444（(169,444−57,500−51,667)×5.105%＝3,077.1→3,080）', C.taxComputer(169444, 0, 2027), 3080);
  eq('令和8年分 A=169,444（控除 ceil(57,500.2)＝57,501・(169,444−57,501−48,334)×5.105%＝3,247.2→3,250）', C.taxComputer(169444, 0, 2026), 3250);
  eq('令和9年分 A=2,120,833（基礎控除 51,667・(2,120,833−162,500−51,667)×40.84%−237,893＝540,789.4→540,790）', C.taxComputer(2120833, 0, 2027), 540790);
  eq('令和8年分 A=2,120,833（基礎控除 48,334・→542,150）', C.taxComputer(2120833, 0, 2026), 542150);
  eq('令和9年分 A=2,120,834（基礎控除 40,000・両年同じ 545,550）', C.taxComputer(2120834, 0, 2027), 545550);
  eq('式の無い年は null', C.taxComputer(300000, 0, 2028), null);
  eq('前の呼び名 taxComputerR8 は令和8年分', C.taxComputerR8(446000, 8), 940);
  eq('電算機特例 B が0以下は0円', C.taxComputerR8(100000, 3), 0);
}

console.log('12b. 固定残業代（含む分を時間外から先に引く）');
{
  const FOT = { code: 'fot', name: '裁量手当', sec: 'pay', calc: 'fixed', order: 3, attrs: { overtime_base: false } };
  const P0 = { pay_type: 'monthly', base: 172000, allowances: [{ code: 'fot', amount: 30000 }], fixed_ot: { allowance_code: 'fot', covered_min: 330 }, ins: {}, tax: { col: 'none' } };
  const go = (att, prof) => run(Object.assign({}, P0, prof || {}), att, { allowanceDefs: [FOT] });
  const a = go({ legalOverMin: 0 });
  eq('時間外0分: 固定残業の手当は満額', L(a, 'ffot'), 30000);
  eq('時間外0分: 残業代の行なし', L(a, 'ot_out'), undefined);
  eq('時間外0分: 総支給 172000＋30000', a.gross, 202000);
  t('含む時間を確かめていない（checked なし）→ fixed_ot_unchecked・金額は同じ', W(a, 'fixed_ot_unchecked'));
  const ac = go({ legalOverMin: 0 }, { fixed_ot: { allowance_code: 'fot', covered_min: 330, checked: true } });
  t('checked が true → fixed_ot_unchecked を出さない・金額は同じ', !W(ac, 'fixed_ot_unchecked') && ac.gross === a.gross);
  t('checked が "true"（文字）は確かめたと見なさない', W(go({ legalOverMin: 0 }, { fixed_ot: { allowance_code: 'fot', covered_min: 330, checked: 'true' } }), 'fixed_ot_unchecked'));
  const b = go({ legalOverMin: 200 });
  eq('時間外200分（含む分330分より少ない）: 残業代の行なし', L(b, 'ot_out'), undefined);
  eq('時間外200分: 手当は満額', L(b, 'ffot'), 30000);
  const c = go({ legalOverMin: 330 });
  eq('時間外330分ちょうど: 残業代の行なし（0円の行も出さない）', c.lines.filter((l) => l.code === 'ot_out').length, 0);
  const d = go({ legalOverMin: 400 });
  eq('時間外400分（多い）: 残業代＝1000×1.25×70分÷60＝1458.33→1459', L(d, 'ot_out'), 1459);
  eq('時間外400分: 行の名前は「残業代」', (d.lines.find((l) => l.code === 'ot_out') || {}).name, '残業代');
  eq('時間外400分: 行の数量は超えた70分', (d.lines.find((l) => l.code === 'ot_out') || {}).qty, 70);
  eq('時間外400分: 総支給 172000＋30000＋1459', d.gross, 203459);
  const e = go({ legalInOverMin: 60, legalOverMin: 100 });
  eq('法定内残業からは引かない（1000×1.00×1h）', L(e, 'ot_in'), 1000);
  eq('法定内残業があっても時間外100分は含む分の内', L(e, 'ot_out'), undefined);
  const f = go({ legalOverMin: 3700, over60Min: 100, nightMin: 60 }, {});
  eq('60時間超: 残業代は (3700−330)分 ×1000×1.25÷60＝70208.33→70209', L(f, 'ot_out'), 70209);
  eq('60時間超の上乗せは今のまま（100分→417）', L(f, 'ot_over60'), 417);
  const f2 = run(Object.assign({}, P0), { nightMin: 60 }, { allowanceDefs: [FOT], settings: { night_premium: 'pay' } });
  eq('深夜の上乗せは今のまま（250）', L(f2, 'ot_night'), 250);
  const g = run({ pay_type: 'hourly', base: 1200, allowances: [{ code: 'fot', amount: 10000 }], fixed_ot: { allowance_code: 'fot', covered_min: 330 }, ins: {}, tax: { col: 'none' } },
    { schedInMin: 6000, legalOverMin: 400 }, { allowanceDefs: [FOT] });
  eq('時給者: 1200×1.25×70分÷60＝1750', L(g, 'ot_out'), 1750);
  const h = run(Object.assign({}, P0, { allowances: [] }), { legalOverMin: 400 }, { allowanceDefs: [FOT] });
  t('固定残業の手当が設定に無い → 警告して含む分を引かない', W(h, 'fixed_ot_allowance') && L(h, 'ot_out') === 8334, L(h, 'ot_out'));
  const i = run({ pay_type: 'monthly', base: 172000, ins: {}, tax: { col: 'none' } }, { legalOverMin: 400 });
  eq('固定残業代の無い人は今の動き（時間外労働 8334）', L(i, 'ot_out'), 8334);
  eq('固定残業代の無い人の行の名前は今のまま', (i.lines.find((l) => l.code === 'ot_out') || {}).name, '時間外労働');
}

console.log('14. 反証レビューの直し（2026-11-19）');
{ /* 1 割増の基礎: 種類を問わず overtime_base の手当を足す */
  const CNT = { code: 'c', name: '早出手当', sec: 'pay', calc: 'count', order: 1 };
  const HR = { code: 'h', name: '時間手当', sec: 'pay', calc: 'hour', order: 1 };
  const DY = { code: 'd', name: '日額手当', sec: 'pay', calc: 'day', order: 1 };
  const NS = { code: 'n', name: '夜勤手当', sec: 'pay', calc: 'night_shift', order: 1 };
  const mo = (allow, def, att) => run({ pay_type: 'monthly', base: 172000, allowances: [allow], ins: {}, tax: { col: 'none' } }, Object.assign({ legalOverMin: 60 }, att), { allowanceDefs: [def] });
  eq('回数の手当 4×500 を足す: 単価 1000＋2000÷172＝1011.6→1012 ×1.25', L(mo({ code: 'c', amount: 500, count_source: '早' }, CNT, { counts: { '早': 4 } }), 'ot_out'), 1265);
  eq('時間の手当は時間あたりの額を直接足す: 1000＋50＝1050 ×1.25＝1312.5→1313', L(mo({ code: 'h', amount: 50 }, HR, { workMin: 600 }), 'ot_out'), 1313);
  eq('日の手当 100×20日 を足す: 1012 ×1.25', L(mo({ code: 'd', amount: 100 }, DY, { workDays: 20 }), 'ot_out'), 1265);
  eq('夜勤の手当 6000×3回 を足す: 1000＋18000÷172＝1104.7→1105 ×1.25＝1381.25→1382', L(mo({ code: 'n', amount: 6000 }, NS, { nightShiftCount: 3 }), 'ot_out'), 1382);
  eq('割増の基礎に入れない回数の手当は足さない', L(mo({ code: 'c', amount: 500, count_source: '早' }, Object.assign({}, CNT, { attrs: { overtime_base: false } }), { counts: { '早': 4 } }), 'ot_out'), 1250);
  const hh = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'c', amount: 500, count_source: '早' }], ins: {}, tax: { col: 'none' } }, { schedInMin: 600, legalOverMin: 60, counts: { '早': 4 } }, { allowanceDefs: [CNT] });
  eq('時給者: 1000＋2000÷172 を丸めずに ×1.25＝1264.5→1265', L(hh, 'ot_out'), 1265);
  const add = C.otBaseAdd([{ calc: 'fixed', month: 17200 }, { calc: 'hour', perHour: 30 }], C._q.Q(172));
  t('足し方の関数: 17200÷172＋30＝130', add.n === 130n * add.d);
}
{ /* 2 1日の所定時間が空 */
  const a = run({ pay_type: 'monthly', base: 165000, avg_month_hours: 165, avg_month_days: 22, ins: {}, tax: { col: 'none' } }, { absentDays: 1 });
  eq('空なら 165÷22＝7.5時間（単価1000×7.5）', L(a, 'absence'), -7500);
  t('1日の所定時間が空の警告', W(a, 'day_hours_missing'));
  const b = run({ pay_type: 'monthly', base: 172000, ins: {}, tax: { col: 'none' } }, { absentDays: 1 });
  eq('月平均の時間・日数も明示していなければ8時間', L(b, 'absence'), -8000);
  t('8時間の時も警告', W(b, 'day_hours_missing'));
  const c = run({ pay_type: 'daily', base: 8000, ins: {}, tax: { col: 'none' } }, { workDays: 5, legalOverMin: 60 });
  eq('日給の単価も 8000÷8 ×1.25', L(c, 'ot_out'), 1250);
  t('日給で1日の所定時間が空の警告', W(c, 'day_hours_missing'));
  t('1日の所定時間がある人は警告なし', !W(run({ pay_type: 'monthly', base: 172000, day_hours: 8, ins: {}, tax: { col: 'none' } }, { absentDays: 1 }), 'day_hours_missing'));
}
{ /* 3 深夜: 含む手当が0円の月は上乗せを払う */
  const NS0 = { code: 'ns', name: '夜勤手当', sec: 'pay', calc: 'night_shift', order: 2, attrs: { includes_night_premium: true, overtime_base: false } };
  const z = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'ns', amount: 6000 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 600, nightMin: 60, nightShiftCount: 0 }, { allowanceDefs: [NS0] });
  eq('夜勤手当がその月0円なら深夜の上乗せ 1000×0.25×1h', L(z, 'ot_night'), 250);
  const y = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'ns', amount: 6000 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 600, nightMin: 60, nightShiftCount: 1 }, { allowanceDefs: [NS0] });
  eq('夜勤手当がある月は今のまま（深夜の行なし）', L(y, 'ot_night'), undefined);
}
{ /* 4 日給: 法定休日に働いた日を基本給の日数から除く */
  const a = run({ pay_type: 'daily', base: 9000, day_hours: 8, ins: {}, tax: { col: 'none' } }, { workDays: 10, holidayWorkDays: 1, holidayMin: 480 });
  eq('基本給は 9日分', L(a, 'basic'), 81000);
  eq('法定休日 1125×1.35×8h', L(a, 'ot_holiday'), 12150);
  const b = run({ pay_type: 'daily', base: 9000, day_hours: 8, ins: {}, tax: { col: 'none' } }, { workDays: 10, holidayMin: 480 });
  t('法定休日の日数が無ければ警告（基本給は10日のまま）', W(b, 'holiday_days_unknown') && L(b, 'basic') === 90000);
  t('法定休日の勤務が無ければ警告なし', !W(run({ pay_type: 'daily', base: 9000, day_hours: 8, ins: {}, tax: { col: 'none' } }, { workDays: 10 }), 'holiday_days_unknown'));
}
{ /* 5 当月徴収の資格を取った月の取りこぼし */
  const mk = (from, si) => C.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: { si_month: si },
    profile: { pay_type: 'monthly', base: 300000, birth_date: '1990-01-01', entry_date: from, ins: { health: { on: true, from, std: 300000 }, pension: { on: true, from, std: 300000 } }, tax: { col: 'none' } }, att: { schedDays: 15 } });
  t('当月徴収で 11/20 取得（11月分を引く明細が無い）→ 警告', W(mk('2026-11-20', 'current'), 'si_first_month_missed'));
  t('当月徴収で 12/1 取得 → 警告なし', !W(mk('2026-12-01', 'current'), 'si_first_month_missed'));
  t('翌月徴収なら警告なし', !W(mk('2026-11-20', 'next'), 'si_first_month_missed'));
  t('当月徴収で 11/10 取得（前の期間に入る）→ 警告なし', !W(mk('2026-11-10', 'current'), 'si_first_month_missed'));
}
{ /* 6 回数×単価を手当の round で円に */
  const D1 = { code: 'c', name: '回数手当', sec: 'pay', calc: 'count', order: 1 };
  const a = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'c', amount: 333, count_source: 'manual', count: 1.5 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 60 }, { allowanceDefs: [D1] });
  eq('333×1.5＝499.5 → 既定は切上げ 500', L(a, 'fc'), 500);
  const b = run({ pay_type: 'hourly', base: 1000, allowances: [{ code: 'c', amount: 333, count_source: 'manual', count: 1.5 }], ins: {}, tax: { col: 'none' } }, { schedInMin: 60 }, { allowanceDefs: [Object.assign({}, D1, { round: 'floor' })] });
  eq('手当の round が floor なら 499', L(b, 'fc'), 499);
  t('金額の行は整数', a.lines.filter((l) => l.sec !== 'employer').every((l) => Number.isInteger(l.amount)));
}
{ /* 8 有限でない値 */
  const a = run({ pay_type: 'monthly', base: 'abc', ins: {}, tax: { col: 'none' } }, {});
  t('数でない基本給は0にして警告', W(a, 'bad_number') && L(a, 'basic') === 0);
  const b = run({ pay_type: 'monthly', base: 200000, ins: INS(Infinity, 200000), tax: { col: 'none' } }, {});
  t('無限の標準報酬でも例外を出さず警告', W(b, 'bad_number'));
  const c = run({ pay_type: 'monthly', base: 200000, avg_month_hours: 'x', ins: {}, tax: { col: 'none' } }, { legalOverMin: 60 });
  t('数でない月平均所定労働時間は既定へ・警告', W(c, 'bad_number') && L(c, 'ot_out') === 1454);
  t('空の値（undefined）は警告しない', !W(run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' } }, {}), 'bad_number'));
  let threw = false, r;
  try { r = run({ pay_type: 'monthly', base: 200000, allowances: [{ code: 'q', get amount() { throw new Error('x'); } }], ins: {}, tax: { col: 'none' } }, {}, { allowanceDefs: [QUAL] }); } catch (e) { threw = true; }
  t('中で例外が起きても外に出さず calc_error', !threw && W(r, 'calc_error'));
}
{ /* 9 雇用保険の資格の期間 */
  const emp = (e) => L(run({ pay_type: 'monthly', base: 200000, ins: { emp: Object.assign({ on: true }, e) }, tax: { col: 'none' } }, {}), 'emp');
  eq('期間の後（12/20）に取得 → 雇保なし', emp({ from: '2026-12-20' }), undefined);
  eq('期間の中（12/1）に取得 → 雇保あり', emp({ from: '2026-12-01' }), 1000);
  eq('喪失日が期間の初日（11/16）→ 雇保なし', emp({ to: '2026-11-16' }), undefined);
  eq('喪失日が期間の中（12/1）→ 雇保あり', emp({ to: '2026-12-01' }), 1000);
  t('empCovered 退職日の翌日を喪失日とする（期間の前日に退職→なし）', C.empCovered({}, { retire_date: '2026-11-15' }, PERIOD) === false);
}
{ /* 11 産休・育休の免除 */
  const ex = (list) => run({ pay_type: 'monthly', base: 300000, birth_date: '1980-01-01', ins: Object.assign(INS(300000, 300000), { exempt: list }), tax: { col: 'none' } }, {});
  const a = ex([{ from_ym: '2026-11', to_ym: '2027-03' }]);
  t('免除の月（11月分）は健保・介護・支援金・厚年が0', ['health', 'care', 'support', 'pension'].every((k) => L(a, k) === undefined));
  eq('免除の月も雇保は賃金で数える', L(a, 'emp'), 1500);
  t('免除の月は会社負担も無い', !a.lines.some((l) => l.sec === 'employer' && l.code !== 'er_emp'));
  eq('免除が10月までなら11月分は引く', L(ex([{ from_ym: '2026-08', to_ym: '2026-10' }]), 'health'), 15120);
  eq('免除の終わりが空なら続いている', L(ex([{ from_ym: '2026-10' }]), 'health'), undefined);
}

console.log('13. 区分別の合計と指紋');
{
  const it = run({ pay_type: 'monthly', base: 200000, birth_date: '1990-01-01', ins: INS(200000, 200000), tax: { col: 'kou', dependents: 0 }, commute: { monthly: 5000 } }, {}, { profile_rev: 3, settings_rev: 7 });
  eq('buckets.taxable', it.buckets.taxable, 200000);
  eq('buckets.nontax', it.buckets.nontax, 5000);
  eq('buckets.emp_ins_base', it.buckets.emp_ins_base, 205000);
  eq('buckets.labor_ins_base', it.buckets.labor_ins_base, 205000);
  eq('buckets.fixed_wage（基本給＋通勤）', it.buckets.fixed_wage, 205000);
  eq('buckets.si_by_kind.health', it.buckets.si_by_kind.health, 10080);
  eq('si_total（健保＋支援金＋厚年＋雇保）', it.si_total, 10080 + 230 + 18300 + 1025);
  t('差引＝総支給−控除', it.net === it.gross - it.deduct);
  t('金額の行は円の整数（会社負担を除く）', it.lines.filter((l) => l.sec !== 'employer').every((l) => Number.isInteger(l.amount)));
  t('指紋の材料', it.fingerprint_inputs.profile_rev === 3 && it.fingerprint_inputs.settings_rev === 7 && it.fingerprint_inputs.rates_ver === Rates.VERSION && it.fingerprint_inputs.calc_ver === C.CALC_VER);
  t('勤怠の行がある', it.lines.some((l) => l.sec === 'att' && l.code === 'workDays'));
}
{
  const s = C.fillSettings({ round: { premium: 'bogus' }, ot_rates: { out: 99 }, avg_month_hours_default: -1 });
  t('壊れた設定は既定へ戻す', s.round.premium === 'ceil' && s.ot_rates.out === 1.25 && s.avg_month_hours_default === 172);
  t('欠勤・遅刻の単価の既定は切捨て', s.round.deduct_unit === 'floor' && s.round.deduct === 'floor');
}

/* 保険の加入の印（ins.*.on）が真偽で入っていない人は ins_unset で知らせる（2026-11-19・取り込みで作った設定の守り） */
{
  const pr = (ins, type) => ({ pay_type: type || 'monthly', base: 200000, board_pay: type === 'board' ? 300000 : undefined, birth_date: '1990-01-01', ins, tax: { col: 'none' } });
  const u1 = run(pr(undefined));
  t('ins が無い → ins_unset（健康保険・厚生年金・雇用保険）・保険料は引かない', W(u1, 'ins_unset') && /健康保険・厚生年金・雇用保険/.test(u1.warnings.find((w) => w.code === 'ins_unset').msg) && L(u1, 'health') === undefined && L(u1, 'emp') === undefined);
  const u2 = run(pr({ health: { on: true, std: 200000 }, pension: { std: 200000 }, emp: { on: false } }));
  t('厚生年金の on だけ無い → ins_unset に厚生年金だけ・健保は引く', W(u2, 'ins_unset') && /（厚生年金・/.test(u2.warnings.find((w) => w.code === 'ins_unset').msg) && L(u2, 'health') === 10080 && L(u2, 'pension') === undefined);
  t('3つとも on が真偽で入っている（未加入の false を含む）→ ins_unset を出さない', !W(run(pr({ health: { on: false }, pension: { on: false }, emp: { on: false } })), 'ins_unset') && !W(run(pr(INS(200000, 200000))), 'ins_unset'));
  t('役員は雇用保険の on が無くても ins_unset にしない', !W(run(pr({ health: { on: true, std: 300000 }, pension: { on: true, std: 300000 } }, 'board')), 'ins_unset'));
}

/* 甲乙・扶養の数を確かめたか（代表者の決定 2026-11-19）: 源泉の対象（甲・乙）で dependents_checked が true でない人に dependents_unchecked */
{
  const pr = (tax) => ({ pay_type: 'monthly', base: 200000, birth_date: '1990-01-01', ins: { health: { on: false }, pension: { on: false }, emp: { on: false } }, tax });
  t('甲で dependents_checked が無い → 警告', W(run(pr({ col: 'kou', dependents: 0 })), 'dependents_unchecked'));
  t('乙で dependents_checked が false → 警告', W(run(pr({ col: 'otsu', dependents: 0, dependents_checked: false })), 'dependents_unchecked'));
  t('甲で dependents_checked が true → 警告なし', !W(run(pr({ col: 'kou', dependents: 1, dependents_checked: true })), 'dependents_unchecked'));
  t('源泉の対象外（none）は警告なし', !W(run(pr({ col: 'none' })), 'dependents_unchecked'));
}

{ /* 手当の月の上限（a.cap・統合 0146・2026-11-28）: 日数×単価の通勤手当を月の上限で止める */
  const CM = { code: 'cmd', name: '通勤手当（日額）', sec: 'pay', calc: 'day', order: 1, attrs: { income_tax: false, overtime_base: false } };
  const cm = (allow, days) => run({ pay_type: 'hourly', base: 1000, allowances: [allow], ins: {}, tax: { col: 'none' } }, { schedInMin: 600, workDays: days }, { allowanceDefs: [CM] });
  eq('上限なし: 580×22日＝12760', L(cm({ code: 'cmd', amount: 580 }, 22), 'fcmd'), 12760);
  eq('上限1万円: 580×22日＝12760 → 10000', L(cm({ code: 'cmd', amount: 580, cap: 10000 }, 22), 'fcmd'), 10000);
  eq('上限1万円でも下回る月はそのまま: 580×11日＝6380', L(cm({ code: 'cmd', amount: 580, cap: 10000 }, 11), 'fcmd'), 6380);
  eq('上限ちょうど: 500×20日＝10000', L(cm({ code: 'cmd', amount: 500, cap: 10000 }, 20), 'fcmd'), 10000);
  eq('上限が空・null は上限なし', L(cm({ code: 'cmd', amount: 580, cap: null }, 22), 'fcmd') + L(cm({ code: 'cmd', amount: 580, cap: '' }, 22), 'fcmd'), 25520);
  eq('上限0は0円', L(cm({ code: 'cmd', amount: 580, cap: 0 }, 22), 'fcmd'), 0);
  const ln = cm({ code: 'cmd', amount: 580, cap: 10000 }, 22).lines.filter((l) => l.code === 'fcmd')[0];
  t('止めた時は根拠に「月の上限」を出す', ln && /月の上限 10000円/.test(ln.basis));
  const fx = run({ pay_type: 'monthly', base: 200000, allowances: [{ code: 'q', amount: 15000, cap: 10000 }], ins: {}, tax: { col: 'none' } }, {}, { allowanceDefs: [{ code: 'q', name: '資格手当', sec: 'pay', calc: 'fixed', order: 1 }] });
  eq('定額の手当には上限を当てない（定額は月の額そのもの）', L(fx, 'fq'), 15000);
}
/* 画面向けの口（2026-11-19 結びの段）。支給日の期待値は暦を手で確かめた値 */
{
  t('VERSION は計算の版と同じ', C.VERSION === C.CALC_VER && typeof C.VERSION === 'string' && C.VERSION.length > 0);
  t('支給日: 2026年12月分・27日・土日は前へ → 12/25（12/27 は日曜・12/26 は土曜）', C.payDate('2026-12', { pay_day: 27, pay_day_shift: 'before' }) === '2026-12-25');
  t('支給日: 既定（pay_day 無し）は27日・前へ（2026-11-27 は金曜）', C.payDate('2026-11', {}) === '2026-11-27');
  t('支給日: 後へ寄せる（2026-12-27 日曜 → 12/28 月曜）', C.payDate('2026-12', { pay_day: 27, pay_day_shift: 'after' }) === '2026-12-28');
  t('支給日: 休みの日も寄せる（12/25 を休みにすると 12/24）', C.payDate('2026-12', { pay_day: 27, holidays: ['2026-12-25'] }) === '2026-12-24');
  t('支給日: 寄せない（none）は土日でもそのまま', C.payDate('2026-12', { pay_day: 27, pay_day_shift: 'none' }) === '2026-12-27');
  t('支給日: 月の日数を超えた日は月末（2026年2月・31日・寄せない → 2/28）', C.payDate('2026-02', { pay_day: 31, pay_day_shift: 'none' }) === '2026-02-28');
  t('支給日: 月分の形が違えば null', C.payDate('2026-13', {}) === null && C.payDate(null, {}) === null);
}

console.log('\n' + (fail ? '✗' : '✓') + ' payroll_calc ' + pass + ' 件成功／' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
