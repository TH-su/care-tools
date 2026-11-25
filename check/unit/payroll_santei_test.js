/* 定時決定（payroll-santei.js）と、厚生年金の上限の引き上げ（payroll-rates.js の grade・isStd の ym）の試験（2026-11-26 新設・設計 ROOT-santei.md）
   実行: node check/unit/payroll_santei_test.js
   守りたいこと（決まりは 日本年金機構「算定基礎届の記入・提出ガイドブック 令和8年度」）:
     1. 一般の3か月平均・17日未満の月を外す・3か月とも17日未満なら従前
     2. パートの15日の決まり・短時間労働者の11日の決まり（特定適用の入の時だけ）
     3. 途中入社の月を外す・6月1日以降の取得・7月1日より前の退職・健保なしは対象外
     4. 遡及の額を除いた修正平均（ガイドブック p.19 の例）・円未満の切り捨て
     5. 等級の境目の1円の上下・厚年の上限（2027-08 は 65万・2027-09 は 68万）・ym なしは今のまま
     6. 回数の手当を除いた等級と「あと少し」（倍率の境目）
     7. 明細から報酬を作る: social_ins が false の手当・非課税の調整を除く・マイナスの支給は入る・定義の無い手当は要確認
     8. 支給日で月を選ぶ・下書きは未確定・CSV の頭と式の無害化
   ★期待値は実装の式から作らず、等級表とガイドブックの数字を直に書く。人と金額は架空 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const ST = require(path.join(ROOT, 'payroll-santei.js'));
const R = require(path.join(ROOT, 'payroll-rates.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + JSON.stringify(b) + '）', JSON.stringify(a) === JSON.stringify(b), a); }

function mon(ym, days, pay, o) { return Object.assign({ ym: ym, confirmed: true, days: days, pay: pay, countPay: 0, retro: 0 }, o || {}); }
function P(months, o) { return Object.assign({ staff_id: 'x1', code: 'T001', name: '架空一郎', pay_type: 'monthly', cur: { health: 200000, pension: 200000 }, ins: { on: true, from: '2020-04-01' }, months: months }, o || {}); }
const Y = { mode: 'teiji', year: 2027 };
function run(p, o) { return ST.person(p, Object.assign({}, Y, o || {})); }

console.log('1. 一般（17日）');
let r = run(P([mon('2027-04', 31, 210000), mon('2027-05', 30, 220000), mon('2027-06', 31, 230001)]));
eq('3か月の平均（円未満切り捨て）', r.avg, 220000);
eq('健保 等級18（210,000〜230,000 未満）', r.next.health, { grade: 18, std: 220000 });
eq('厚年 等級15', r.next.pension, { grade: 15, std: 220000 });
eq('今 17等級 → 差 +1', [r.cur.health.grade, r.diff, r.big, r.change], [17, 1, false, true]);
r = run(P([mon('2027-04', 16, 100000), mon('2027-05', 30, 300000), mon('2027-06', 31, 300000)], { pay_type: 'hourly' }));
eq('17日未満の月（16日）を外して2か月で平均', [r.used, r.avg], [['2027-05', '2027-06'], 300000]);
r = run(P([mon('2027-04', 16, 100000), mon('2027-05', 12, 300000), mon('2027-06', 14, 300000)], { pay_type: 'monthly' }));
eq('一般で3か月とも17日未満は従前のまま（変えない）', [r.status, r.change, r.next.health.std], ['keep', false, 200000]);
r = run(P([mon('2027-04', 31, 450000), mon('2027-05', 30, 450000), mon('2027-06', 31, 450000)], { cur: { health: 300000, pension: 300000 } }));
eq('2等級以上の差の印（22→28）', [r.cur.health.grade, r.next.health.grade, r.diff, r.big], [22, 28, 6, true]);

console.log('2. パート（15日）・短時間労働者（11日）');
r = run(P([mon('2027-04', 16, 150000), mon('2027-05', 15, 160000), mon('2027-06', 14, 170000)], { pay_type: 'hourly' }));
eq('パート: 17日以上が無ければ15日以上の月（16・15日）で平均', [r.kind, r.rule, r.used, r.avg], ['part', 15, ['2027-04', '2027-05'], 155000]);
r = run(P([mon('2027-04', 14, 150000), mon('2027-05', 13, 160000), mon('2027-06', 12, 170000)], { pay_type: 'hourly' }));
eq('パート: 3か月とも15日未満は従前', r.status, 'keep');
r = run(P([mon('2027-04', 12, 120000), mon('2027-05', 10, 100000), mon('2027-06', 11, 110000)], { pay_type: 'hourly', short: true }), { special: true });
eq('短時間労働者（特定適用の入）: 11日以上の月（12・11日）で平均', [r.kind, r.rule, r.used, r.avg], ['short', 11, ['2027-04', '2027-06'], 115000]);
r = run(P([mon('2027-04', 12, 120000), mon('2027-05', 10, 100000), mon('2027-06', 11, 110000)], { pay_type: 'hourly', short: true }));
eq('特定適用が切なら短時間労働者の印は効かない（パートで従前）', [r.kind, r.status], ['part', 'keep']);
r = run(P([mon('2027-04', 17, 180000), mon('2027-05', 16, 170000), mon('2027-06', 15, 160000)], { pay_type: 'hourly' }));
eq('パートでも17日以上の月があれば17日の決まり（4月だけ）', [r.rule, r.used], [17, ['2027-04']]);

console.log('3. 除く月・対象外');
r = run(P([mon('2027-04', 31, 90000, { partial: true }), mon('2027-05', 30, 200000), mon('2027-06', 31, 200000)]));
eq('途中入社の月を外す', [r.used, r.avg, r.months[0].why], [['2027-05', '2027-06'], 200000, '途中入社の月']);
eq('6月1日以降の資格取得は届けない', run(P([], { ins: { on: true, from: '2027-06-01' } })).status, 'out');
eq('5月31日の資格取得は届ける', run(P([mon('2027-06', 31, 200000)], { ins: { on: true, from: '2027-05-31' } })).status, 'ok');
eq('6月30日の退職は届けない', run(P([], { retire_date: '2027-06-30' })).status, 'out');
eq('7月1日の退職は届ける', run(P([mon('2027-06', 31, 200000)], { retire_date: '2027-07-01' })).status, 'ok');
eq('健保に入っていない人は対象外', run(P([], { ins: { on: false } })).status, 'out');
r = run(P([mon('2027-04', 31, 200000), mon('2027-05', 30, 200000, { confirmed: false }), { ym: '2027-06', missing: true }]));
eq('下書きの月は未確定で外し要確認・支給なしの月も外す', [r.used, r.status, r.months[1].why, r.months[2].why], [['2027-04'], 'review', '未確定', '支給なし']);
r = run(P([mon('2027-04', 31, 200000, { excluded: true }), mon('2027-05', 30, 210000), mon('2027-06', 31, 220000)]));
eq('手で外した月（休職給など）', [r.used, r.avg], [['2027-05', '2027-06'], 215000]);
eq('見込みでは6月1日以降の取得の決まりを使わない', ST.person(P([mon('2027-01', 31, 200000)], { ins: { on: true, from: '2027-06-01' } }), { mode: 'forecast', applyYm: '2027-09' }).status, 'ok');

console.log('4. 遡及（修正平均）');
/* ガイドブック p.19 の例: (287,000−20,000＋267,000＋267,000)÷3＝267,000 */
r = run(P([mon('2027-04', 30, 287000, { retro: 20000 }), mon('2027-05', 31, 267000), mon('2027-06', 30, 267000)]));
eq('修正平均＝ガイドブックの例 267,000・平均額（遡及を含む）は 273,666', [r.avgMod, r.avgRaw, r.avg, r.totalRetro], [267000, 273666, 267000, 20000]);
eq('修正平均 267,000 で等級を引く（健保 20等級 260,000＝250,000〜270,000 未満）', r.next.health, { grade: 20, std: 260000 });
r = run(P([mon('2027-04', 17, 100000), mon('2027-05', 17, 100000), mon('2027-06', 17, 100001)]));
eq('円未満は切り捨て（300,001÷3）', r.avg, 100000);

console.log('5. 等級の境目・厚年の上限');
eq('209,999 は 17等級（200,000）', R.grade(209999).health, { grade: 17, std: 200000 });
eq('210,000 は 18等級（220,000）', R.grade(210000).health, { grade: 18, std: 220000 });
eq('92,999 の厚年は 1等級（88,000）', R.grade(92999).pension, { grade: 1, std: 88000 });
eq('ym なしは今のまま（700,000 の厚年は 32等級 650,000）', R.grade(700000).pension, { grade: 32, std: 650000 });
eq('2027-08 分の厚年の上限は 650,000', R.grade(700000, '2027-08').pension, { grade: 32, std: 650000 });
eq('2027-09 分から厚年の上限は 680,000（33等級）', R.grade(700000, '2027-09').pension, { grade: 33, std: 680000 });
eq('2027-09 分: 664,999 は 32等級', R.grade(664999, '2027-09').pension, { grade: 32, std: 650000 });
eq('2027-09 分: 665,000 は 33等級', R.grade(665000, '2027-09').pension, { grade: 33, std: 680000 });
eq('2028-09 分は 710,000（34等級）・2029-09 分は 750,000（35等級）', [R.grade(2000000, '2028-09').pension, R.grade(2000000, '2029-09').pension], [{ grade: 34, std: 710000 }, { grade: 35, std: 750000 }]);
eq('健保は ym で変わらない', R.grade(2000000, '2029-09').health, { grade: 50, std: 1390000 });
eq('isStd: 680,000 の厚年は ym なしでは表に無い・2027-09 からある', [R.isStd('pension', 680000), R.isStd('pension', 680000, '2027-08'), R.isStd('pension', 680000, '2027-09')], [false, false, true]);
r = run(P([mon('2027-04', 31, 700000), mon('2027-05', 30, 700000), mon('2027-06', 31, 700000)], { cur: { health: 710000, pension: 650000 } }));
eq('定時決定は9月分の上限で引く（厚年 650,000 → 680,000 は変わる）', [r.next.pension.std, r.change], [680000, true]);

console.log('6. 回数の手当・あと少し');
/* 手当なし 173,700・手当 1,080（月平均）: 14等級（165,000〜175,000）・次の境目 175,000 まで 1,300 ≤ 1,080×2 → あと少し */
r = run(P([mon('2027-04', 20, 174780, { countPay: 1080 }), mon('2027-05', 20, 174780, { countPay: 1080 }), mon('2027-06', 20, 174780, { countPay: 1080 })], { pay_type: 'hourly', cur: { health: 170000, pension: 170000 } }));
eq('手当ありの平均と等級', [r.avg, r.next.health.grade], [174780, 14]);
eq('手当なしの平均と等級', [r.noCount.avg, r.noCount.health.grade, r.noCount.differs, r.noCount.countAvg], [173700, 14, false, 1080]);
eq('境目まで（手当あり 220・手当なし 1,300）とあと少し', [r.edge.toNext, r.edge.ncToNext, r.edge.near], [220, 1300, true]);
eq('倍率 1 ならあと少しにならない（1,300 > 1,080）', run(P(r.months.map(function (m) { return mon(m.ym, 20, 174780, { countPay: 1080 }); }), { pay_type: 'hourly' }), { nearK: 1 }).edge.near, false);
r = run(P([mon('2027-04', 20, 176000, { countPay: 3000 }), mon('2027-05', 20, 176000, { countPay: 3000 }), mon('2027-06', 20, 176000, { countPay: 3000 })], { pay_type: 'hourly', cur: { health: 170000, pension: 170000 } }));
eq('手当で境目を越えた人（手当あり15等級・手当なし14等級）', [r.next.health.grade, r.noCount.health.grade, r.noCount.differs, r.edge.near], [15, 14, true, false]);
let c = ST.compute(Object.assign({ people: [P([mon('2027-04', 20, 176000, { countPay: 3000 })]), P([mon('2027-04', 20, 200000)], { staff_id: 'x2', ins: { on: false } })] }, Y));
eq('件数（対象外1・手当で変わる1）', [c.counts.all, c.counts.out, c.counts.byCount, c.applyYm], [2, 1, 1, '2027-09']);

console.log('7. 明細から作る（fromItems）');
const defs = [
  { code: 'sun', def: { name: '日曜出勤手当', sec: 'pay', calc: 'count', attrs: {} } },
  { code: 'dc', def: { name: '選択制の掛金（本人選択）', sec: 'pay', calc: 'fixed', attrs: {} } },
  { code: 'gift', def: { name: '祝い金', sec: 'pay', calc: 'fixed', attrs: { social_ins: false } } },
  { code: 'night', def: { name: '夜勤手当', sec: 'pay', calc: 'night_shift', attrs: {} } }
];
function item(pay, att) {
  return { lines: pay.map(function (x) { return { sec: 'pay', code: x[0], name: x[0], amount: x[1] }; }).concat(Object.keys(att).map(function (k) { return { sec: 'att', code: k, name: k, qty: att[k], amount: 0 }; })) };
}
function boot(ym, status, payDate, items, prof) {
  return { ok: true, ym: ym, period: { from: ST.ymAdd(ym, -1) + '-16', to: ym + '-15' }, run: status ? { status: status, pay_date: payDate } : null, allowances: defs,
    staff: [{ staff_id: 's1', emp_code: 'T101' }, { staff_id: 's2', emp_code: 'T102' }],
    profiles: prof || [{ staff_id: 's1', name: '架空花子', data: { pay_type: 'monthly', entry_date: '2020-04-01', ins: { health: { on: true, std: 220000 }, pension: { on: true, std: 220000 } } } },
      { staff_id: 's2', name: '架空次郎', data: { pay_type: 'hourly', entry_date: '2027-04-01', ins: { health: { on: true, from: '2027-04-01', std: 180000 }, pension: { on: true, std: 180000 } } } }],
    items: items.map(function (x) { return { staff_id: x[0], name: x[0], item: x[1], frozen: status === 'confirmed' || status === 'exported' ? { pay_date: payDate, period: { from: ST.ymAdd(ym, -1) + '-16', to: ym + '-15' } } : null }; }) };
}
const s1 = item([['basic', 200000], ['fsun', 3000], ['fdc', -10000], ['fgift', 5000], ['commute', 8000], ['ot_out', 4000], ['adj_nontax:0', 2000], ['absence', -1500]], { workDays: 20, paidDays: 1 });
const boots = [
  boot('2027-03', 'confirmed', '2027-03-26', [['s1', s1]]),
  boot('2027-04', 'confirmed', '2027-04-27', [['s1', s1], ['s2', item([['basic', 90000], ['fnight', 6000]], { workDays: 10, paidDays: 0 })]]),
  boot('2027-05', 'exported', '2027-05-27', [['s1', s1], ['s2', item([['basic', 180000], ['fnight', 6000], ['fzzz', 1000]], { workDays: 18, paidDays: 1 })]]),
  boot('2027-06', 'draft', null, [['s1', s1], ['s2', item([['basic', 180000]], { workDays: 19, paidDays: 0 })]])
];
let src = ST.fromItems({ payMonths: ST.teijiMonths(2027), boots: boots });
let a = src.people.filter(function (p) { return p.staff_id === 's1'; })[0], b = src.people.filter(function (p) { return p.staff_id === 's2'; })[0];
eq('3月に支給した分は入らない（支給の月は4・5・6）', a.months.map(function (m) { return m.ym; }), ['2027-04', '2027-05', '2027-06']);
/* 報酬＝200,000＋3,000−10,000＋8,000＋4,000−1,500＝203,500（祝い金 social_ins false と非課税の調整を除く・マイナスの支給は入る） */
eq('報酬（社保の対象だけ・マイナスの支給は入る）', a.months[0].pay, 203500);
eq('回数の手当（calc count・night_shift・hour）', a.months[0].countPay, 3000);
eq('月給・欠勤なしは期間の暦日数（3/16〜4/15＝31日）', [a.months[0].days, a.months[0].daysNote], [31, '暦日数']);
eq('下書きの月は未確定', [a.months[2].confirmed, b.months[2].confirmed], [false, false]);
eq('番号・今の標準報酬は bootstrap から', [a.code, a.cur, b.code], ['T101', { health: 220000, pension: 220000 }, 'T102']);
eq('時給の日数は出勤＋有休（18＋1）', b.months[1].days, 19);
eq('入社日が期間の途中（3/16〜4/15 に 4/1）の月は途中入社', [b.months[0].partial, b.months[1].partial], [true, false]);
eq('定義の無い手当の行は要確認', b.months[1].warns.map(function (w) { return w.code; }), ['def_missing']);
r = ST.compute({ mode: 'teiji', year: 2027, people: src.people }).people.filter(function (p) { return p.staff_id === 's2'; })[0];
eq('s2: 途中入社の4月と下書きの6月を外し、5月だけで平均・要確認', [r.used, r.avg, r.status], [['2027-05'], 187000, 'review']);
const abs = item([['basic', 200000], ['absence', -9000]], { workDays: 17, paidDays: 1, absentDays: 2 });
src = ST.fromItems({ payMonths: ['2027-04'], boots: [boot('2027-04', 'confirmed', '2027-04-27', [['s1', abs]])] });
eq('欠勤のある月給の月は出勤＋有休で数え、要確認の印', [src.people[0].months[0].days, src.people[0].months[0].warns.map(function (w) { return w.code; })], [18, ['days_absent']]);
src = ST.fromItems({ payMonths: ['2027-04'], boots: [boot('2027-04', 'confirmed', '2027-04-27', [['s1', abs]])], overrides: { s1: { months: { '2027-04': { days: 19, retro: 5000 } } } } });
eq('手直し: 日数 19・遡及 5,000 で要確認の印が消える', [src.people[0].months[0].days, src.people[0].months[0].retro, src.people[0].months[0].warns.length], [19, 5000, 0]);
src = ST.fromItems({ payMonths: ['2027-04'], boots: [boot('2027-04', 'confirmed', '2027-04-27', [['s1', item([['basic', 200000], ['adj:0', 3000]], { workDays: 20 })]])] });
eq('その月だけの支給の調整は報酬に入れ、遡及かを確かめる印', [src.people[0].months[0].pay, src.people[0].months[0].warns.map(function (w) { return w.code; })], [203000, ['retro_hint']]);
src = ST.fromItems({ payMonths: ['2027-04'], boots: [boot('2027-04', 'confirmed', '2027-04-27', [['s1', s1]])], countCodes: { night: true } });
eq('外す手当を画面で選ぶと定義の calc より優先（日曜は外さない）', src.people[0].months[0].countPay, 0);
src = ST.fromItems({ payMonths: ['2027-04'], boots: [boot('2027-04', 'confirmed', '2027-05-01', [['s1', s1]])] });
eq('支給日が5月なら4月の分に入らない（支給日で選ぶ）', src.people.filter(function (p) { return p.staff_id === 's1'; })[0].months[0].missing, true);

console.log('8. 窓の月・CSV');
eq('見込みの窓（2027-03 まで確定 → 1・2・3月・9月分から）', [ST.forecastMonths('2027-03'), ST.forecastApplyYm('2027-03')], [['2027-01', '2027-02', '2027-03'], '2027-09']);
eq('見込みの窓（2027-10 → 翌年の9月分）', ST.forecastApplyYm('2027-10'), '2028-09');
eq('版を置く月分（翌月徴収は10月分・当月徴収は9月分）', [ST.applyRunYm('2027-09', 'next'), ST.applyRunYm('2027-09', 'current')], ['2027-10', '2027-09']);
c = ST.compute({ mode: 'teiji', year: 2027, people: [P([mon('2027-04', 31, 210000), mon('2027-05', 30, 220000), mon('2027-06', 31, 230001)], { name: '=架空' })] });
const csv = ST.csv(c).split('\r\n');
t('CSV の頭に支払基礎日数・修正平均額・健保 標準報酬', /4月 支払基礎日数/.test(csv[0]) && /修正平均額/.test(csv[0]) && /健保 標準報酬/.test(csv[0]), csv[0]);
t('CSV の行（番号・平均 220000・新 220000）と式の無害化（=架空 → \'=架空）', /^T001,'=架空,一般,17日,200000,200000,31,210000,,○/.test(csv[1]) && /,660001,220000,,18,220000,15,220000,1,/.test(csv[1]), csv[1]);
eq('今の標準報酬が等級表に無い時は要確認', run(P([mon('2027-04', 31, 200000)], { cur: { health: 123456, pension: 0 } })).status, 'review');

console.log('\n' + (fail ? '✗ ' + fail + ' 件 失敗（' + pass + ' 件 合格）' : '✓ ' + pass + ' 件 合格'));
process.exit(fail ? 1 : 0);
