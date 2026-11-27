/* 随時改定（payroll-zuiji.js）の試験（2026-11-28 新設）
   実行: node check/unit/payroll_zuiji_test.js
   守りたいこと（決まりは 日本年金機構「随時改定（月額変更届）」と厚労省「標準報酬月額の定時決定及び随時改定の事務取扱いに関する事例集」）:
     1. 固定的賃金が変わった月分を見つける（確定した月分は払った明細の行・下書きは版）。標準報酬そのものの変更は数えない
     2. 変わった固定的賃金を初めて払った月から3か月・3か月とも17日以上（短時間労働者は11日）・2等級以上の差・4か月目の分から
     3. 向きが逆（上がったのに等級が下がる）は対象外・上がった物と下がった物が同時・給与の形の変更・調整の行・端の1等級は要確認
     4. 3か月がまだそろわない時は「待ち」・時給の人の1日の所定時間の変更も変動（事例集 問1-3）
   ★期待値は等級表の数字を直に書く。人と金額は架空 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Z = require(path.join(ROOT, 'payroll-zuiji.js'));
const ST = require(path.join(ROOT, 'payroll-santei.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + JSON.stringify(b) + '）', JSON.stringify(a) === JSON.stringify(b), a); }

const defs = [
  { code: 'pos', def: { name: '役職手当', sec: 'pay', calc: 'fixed', attrs: { fixed_wage: true } } },
  { code: 'sun', def: { name: '日曜出勤手当', sec: 'pay', calc: 'count', attrs: { fixed_wage: true } } },
  { code: 'gift', def: { name: '祝い金', sec: 'pay', calc: 'fixed', attrs: { fixed_wage: true, social_ins: false } } },
  { code: 'bon', def: { name: '業績の手当', sec: 'pay', calc: 'fixed', attrs: { fixed_wage: false } } }
];
/* lines: [[code, amount, unit]] */
function item(lines, att) {
  return { lines: lines.map(function (x) { return { sec: 'pay', code: x[0], name: x[0], amount: x[1], unit: x.length > 2 ? x[2] : x[1] }; })
    .concat(Object.keys(att || {}).map(function (k) { return { sec: 'att', code: k, name: k, qty: att[k], amount: 0 }; })) };
}
function prof(sid, data) {
  return { staff_id: sid, name: '架空' + sid, data: Object.assign({ pay_type: 'monthly', entry_date: '2020-04-01', ins: { health: { on: true, std: 220000 }, pension: { on: true, std: 220000 } } }, data) };
}
/* 月分 ym・支給は同じ月の 25 日（期間は前の月の16日〜その月の15日） */
function boot(ym, status, items, profs) {
  const pd = ym + '-25', conf = status === 'confirmed' || status === 'exported';
  return { ok: true, ym: ym, period: { from: ST.ymAdd(ym, -1) + '-16', to: ym + '-15' }, run: status ? { status: status, pay_date: pd } : null, allowances: defs,
    staff: profs.map(function (p) { return { staff_id: p.staff_id, emp_code: 'T' + p.staff_id }; }), profiles: profs,
    items: items.map(function (x) { return { staff_id: x[0], name: x[0], item: x[1], frozen: conf ? { pay_date: pd, period: { from: ST.ymAdd(ym, -1) + '-16', to: ym + '-15' } } : null }; }) };
}
function one(res, sid) { return res.people.filter(function (p) { return p.staff_id === sid; }); }

console.log('1. 月給の昇給で2等級上がる（220,000 → 260,000）');
const P0 = prof('a', { base: 220000 }), P1 = prof('a', { base: 260000 });
let boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 260000]])]], [P1]),
  boot('2027-05', 'confirmed', [['a', item([['basic', 260000]])]], [P1]),
  boot('2027-06', 'confirmed', [['a', item([['basic', 260000]])]], [P1])
];
let r = one(Z.judge({ boots: boots }), 'a');
eq('見つかるのは1件（4月分）', r.map(function (x) { return x.changeYm; }), ['2027-04']);
r = r[0];
eq('起算の月・3か月・4か月目の分から', [r.start, r.months.map(function (m) { return m.ym; }), r.applyYm], ['2027-04', ['2027-04', '2027-05', '2027-06'], '2027-07']);
eq('平均・健保 18→20（250,000〜270,000 未満は 20等級 260,000）', [r.avg, r.cur.health.grade, r.next.health.grade, r.next.health.std, r.diffH], [260000, 18, 20, 260000, 2]);
eq('随時改定・上がる', [r.status, r.dir], ['hit', 'up']);
t('7月分から改定は算定基礎届が要らない知らせ', r.warns.some(function (w) { return w.code === 'teiji_skip' && /7月分/.test(w.msg); }), r.warns);
eq('変わった物の一覧', r.changes, [{ label: '基本給', from: 220000, to: 260000 }]);

console.log('2. 1等級だけ・3か月そろわない・日数が足りない');
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 240000]])]], [prof('a', { base: 240000 })]),
  boot('2027-05', 'confirmed', [['a', item([['basic', 240000]])]], [prof('a', { base: 240000 })]),
  boot('2027-06', 'confirmed', [['a', item([['basic', 240000]])]], [prof('a', { base: 240000 })])
];
r = one(Z.judge({ boots: boots }), 'a')[0];
eq('240,000 は 19等級（1等級差）＝対象外', [r.status, r.diffH, r.reason], ['no', 1, '2等級以上の差がありません']);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 260000]])]], [P1]),
  boot('2027-05', 'draft', [['a', item([['basic', 260000]])]], [P1])
];
r = one(Z.judge({ boots: boots }), 'a')[0];
eq('5月は下書き・6月は無い＝待ち', [r.status, r.months.map(function (m) { return m.why; })], ['wait', ['', '未確定', '支給なし']]);
const H0 = prof('h', { pay_type: 'hourly', base: 1100 }), H1 = prof('h', { pay_type: 'hourly', base: 1500 });
boots = [
  boot('2027-03', 'confirmed', [['h', item([['basic', 176000, 1100]], { workDays: 20 })]], [H0]),
  boot('2027-04', 'confirmed', [['h', item([['basic', 260000, 1500]], { workDays: 20 })]], [H1]),
  boot('2027-05', 'confirmed', [['h', item([['basic', 260000, 1500]], { workDays: 16 })]], [H1]),
  boot('2027-06', 'confirmed', [['h', item([['basic', 260000, 1500]], { workDays: 20 })]], [H1])
];
r = one(Z.judge({ boots: boots }), 'h')[0];
eq('時給の単価の変更を見つける', [r.changeYm, r.changes], ['2027-04', [{ label: '時給', from: 1100, to: 1500 }]]);
eq('16日の月があれば対象外（15日の救済は随時改定に無い）', [r.status, /16日|17日未満/.test(r.reason)], ['no', true]);
r = one(Z.judge({ boots: boots, opts: { special: true }, overrides: { h: { short: true } } }), 'h')[0];
eq('特定適用事業所の短時間労働者は11日以上で数える', [r.rule, r.status], [11, 'hit']);

console.log('3. 向き・要確認');
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000], ['ot_out', 80000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 230000]])]], [prof('a', { base: 230000 })]),
  boot('2027-05', 'confirmed', [['a', item([['basic', 230000]])]], [prof('a', { base: 230000 })]),
  boot('2027-06', 'confirmed', [['a', item([['basic', 230000]])]], [prof('a', { base: 230000 })])
];
r = one(Z.judge({ boots: boots, overrides: {} }), 'a')[0];
/* 今 300,000（22等級）・昇給したが残業が無くなり平均 230,000（19等級）＝3等級下がる → 向きが逆 */
boots.forEach(function (b) { b.profiles = b.profiles.map(function (p) { const q = JSON.parse(JSON.stringify(p)); q.data.ins.health.std = 300000; q.data.ins.pension.std = 300000; return q; }); });
r = one(Z.judge({ boots: boots }), 'a')[0];
eq('昇給したのに等級が下がる＝対象外', [r.dir, r.diffH, r.status], ['up', -3, 'no']);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000], ['commute', 20000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 280000], ['commute', 5000]])]], [P1]),
  boot('2027-05', 'confirmed', [['a', item([['basic', 280000], ['commute', 5000]])]], [P1]),
  boot('2027-06', 'confirmed', [['a', item([['basic', 280000], ['commute', 5000]])]], [P1])
];
r = one(Z.judge({ boots: boots }), 'a')[0];
eq('月の額は合計で見る（基本給 +60,000・通勤 −15,000 ＝上がる）', [r.dir, r.status], ['up', 'hit']);
boots = [
  boot('2027-03', 'confirmed', [['h', item([['basic', 176000, 1100], ['fsun', 6000, 2000]], { workDays: 20 })]], [H0]),
  boot('2027-04', 'confirmed', [['h', item([['basic', 260000, 1500], ['fsun', 3000, 1000]], { workDays: 20 })]], [H1]),
  boot('2027-05', 'confirmed', [['h', item([['basic', 260000, 1500], ['fsun', 3000, 1000]], { workDays: 20 })]], [H1]),
  boot('2027-06', 'confirmed', [['h', item([['basic', 260000, 1500], ['fsun', 3000, 1000]], { workDays: 20 })]], [H1])
];
r = one(Z.judge({ boots: boots }), 'h')[0];
eq('時給は上がり日曜の単価は下がった＝要確認', [r.dir, r.status], ['mixed', 'review']);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 260000], ['adj:0', 40000]])]], [P1]),
  boot('2027-05', 'confirmed', [['a', item([['basic', 260000]])]], [P1]),
  boot('2027-06', 'confirmed', [['a', item([['basic', 260000]])]], [P1])
];
r = one(Z.judge({ boots: boots }), 'a')[0];
eq('その月だけの支給の調整（遡及の差額かも）は要確認', [r.status, r.warns.some(function (w) { return w.code === 'retro_hint'; })], ['review', true]);
r = one(Z.judge({ boots: boots, overrides: { a: { months: { '2027-04': { retro: 40000 } } } } }), 'a')[0];
eq('遡及の額を入れると差額を除いた平均で随時改定', [r.avg, r.status], [260000, 'hit']);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [prof('a', { pay_type: 'hourly', base: 1100 })]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 260000]])]], [P1])
];
r = one(Z.judge({ boots: boots }), 'a')[0];
eq('給与の形の変更（時給→月給）は要確認の印', [r.dir, r.warns.some(function (w) { return w.code === 'type_change'; })], ['type', true]);

console.log('4. 何を変動に数えるか');
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 220000]])]], [prof('a', { base: 220000, ins: { health: { on: true, std: 300000 }, pension: { on: true, std: 300000 } } })])
];
eq('標準報酬だけが変わった月は数えない', Z.judge({ boots: boots }).people.length, 0);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000], ['fbon', 10000], ['fgift', 5000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 220000], ['fbon', 50000], ['fgift', 0]])]], [P0])
];
eq('固定的賃金の印の無い手当・社保の対象外の手当の変更は数えない', Z.judge({ boots: boots }).people.length, 0);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P1]),   /* 版は後から 260,000 に直された（遡って） */
  boot('2027-04', 'confirmed', [['a', item([['basic', 260000]])]], [P1])
];
eq('確定した月分は払った明細の行で比べる（版を後から直しても見つける）', one(Z.judge({ boots: boots }), 'a').map(function (x) { return x.changeYm; }), ['2027-04']);
boots = [
  boot('2027-03', 'draft', [], [prof('h', { pay_type: 'hourly', base: 1500, day_hours: 8 })]),
  boot('2027-04', 'draft', [], [prof('h', { pay_type: 'hourly', base: 1500, day_hours: 6.5 })])
];
r = one(Z.judge({ boots: boots }), 'h')[0];
eq('時給の人の1日の所定時間の変更も変動（下がる）', [r.changes, r.dir], [[{ label: '1日の所定時間', from: 8, to: 6.5 }], 'down']);
boots = [
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 220000], ['fpos', 30000]])]], [P0])
];
eq('固定の手当を足した月を見つける', one(Z.judge({ boots: boots }), 'a').map(function (x) { return [x.changeYm, x.dir]; }), [['2027-04', 'up']]);

console.log('5. 等級表の端');
const E0 = prof('e', { base: 1350000, ins: { health: { on: true, std: 1330000 }, pension: { on: true, std: 650000 } } }), E1 = prof('e', { base: 1450000, ins: { health: { on: true, std: 1330000 }, pension: { on: true, std: 650000 } } });
boots = [
  boot('2027-03', 'confirmed', [['e', item([['basic', 1350000]])]], [E0]),
  boot('2027-04', 'confirmed', [['e', item([['basic', 1450000]])]], [E1]),
  boot('2027-05', 'confirmed', [['e', item([['basic', 1450000]])]], [E1]),
  boot('2027-06', 'confirmed', [['e', item([['basic', 1450000]])]], [E1])
];
r = one(Z.judge({ boots: boots }), 'e')[0];
eq('健保 49→50 の1等級は要確認（上限の特例）', [r.cur.health.grade, r.next.health.grade, r.status, r.warns.some(function (w) { return w.code === 'edge1'; })], [49, 50, 'review', true]);

console.log('6. 窓の絞り込みと数');
boots = [
  boot('2027-01', 'confirmed', [['a', item([['basic', 200000]])]], [prof('a', { base: 200000 })]),
  boot('2027-02', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-03', 'confirmed', [['a', item([['basic', 220000]])]], [P0]),
  boot('2027-04', 'confirmed', [['a', item([['basic', 260000]])]], [P1])
];
let res = Z.judge({ boots: boots, fromYm: '2027-03' });
eq('fromYm より前の変動は出さない', res.people.map(function (x) { return x.changeYm; }), ['2027-04']);
eq('数', [res.counts.all, res.counts.wait], [1, 1]);
eq('月分が1つだけなら比べられない', Z.judge({ boots: boots.slice(0, 1) }).warns.map(function (w) { return w.code; }), ['no_data']);

console.log('\n' + pass + ' 件合格・' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
