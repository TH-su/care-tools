/* 賞与の計算（payroll-calc.js の computeBonus）と賞与の算出率の表（payroll-tax-table.js の BONUS_RATE）の試験（2026-11-23 新設・賞与の計算 v1 §2・§3・§5）
   実行: node check/unit/payroll_bonus_test.js
   守りたいこと（§5 の (1)〜(10)）:
     (1) 健保の年度の累計 5,730,000円をまたぐ回  (2) 厚年の同じ月 1,500,000円ちょうどと超え  (3) 前月の給与なし
     (4) 10倍ちょうど（率）と10倍超（月額表）  (5) 40歳・65歳の境目（1日生まれを含む）  (6) 資格を失う月
     (7) 端数 50銭ちょうど  (8) 乙欄の5段の境目  (9) 令和8年分と令和9年分の切り替え
     (10) 国税庁の使用例「468,407円×2.042%＝9,564円」とタックスアンサー No.2523 の例（769,300円・前月なし・扶養0人・令和8年分→7,800円）
   ★期待値は手で数えた数字（率は payroll-rates.js の熊本の令和8年度: 健保 10.08%・介護 1.62%・支援金 0.23%・厚年 18.3%・雇保 本人 5/1000）。
     月額表の値は payroll-tax-table.js の行（239,000〜242,000円の甲欄0人 5,790円・127,000〜129,000円 1,300円）。
   ★職員は全部架空（生年月日・金額は試験のために作った値） */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'payroll-calc.js'));
const TT = require(path.join(ROOT, 'payroll-tax-table.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + JSON.stringify(b) + '）', JSON.stringify(a) === JSON.stringify(b), a); }
const has = (r, code) => r.warns.some((w) => w.code === code);
const stop = (r) => r.warns.some((w) => w.stop);

const OFF = { health: { on: false }, pension: { on: false }, emp: { on: false } };
const ON = () => ({ health: { on: true }, pension: { on: true }, emp: { on: true } });
function prof(o) { return Object.assign({ pay_type: 'monthly', birth_date: '1990-06-15', entry_date: '2020-04-01', ins: ON(), tax: { col: 'kou', dependents: 0, dependents_checked: true } }, o || {}); }
function run(amount, o) {
  o = o || {};
  return C.computeBonus(Object.assign({
    bonus: { pay_date: o.pay_date || '2026-12-24', lines: [{ code: 'bonus', amount: amount }] },
    settings: o.settings || {}, profile: o.profile || prof(), prev: o.prev || { kind: 'manual', P: 250000 },
    fyStdSum: 0, fyPriorStd: 0, monthStdSum: 0, count12: 0, count12Other: 0
  }, o.extra || {}));
}

console.log('0. 算出率の表の形');
for (const y of [2026, 2027]) {
  const Y = TT.BONUS_RATE[y];
  eq(y + ' 率の列は21段', Y.rates.length, 21);
  eq(y + ' 率の列の頭と尻', [Y.rates[0], Y.rates[1], Y.rates[20]], [0, 2.042, 45.945]);
  let incR = true; for (let i = 1; i < 21; i++) if (!(Y.rates[i] > Y.rates[i - 1])) incR = false;
  t(y + ' 率は下から上へ増える', incR);
  eq(y + ' 甲欄は扶養0〜7人以上の8列', Y.kou.length, 8);
  let ok = true, mono = true, dep = true;
  Y.kou.forEach((col, c) => {
    if (col.length !== 20) ok = false;
    for (let i = 1; i < 20; i++) if (!(col[i] > col[i - 1])) mono = false;   /* 列の中は厳密に増える */
    if (c > 0) for (let i = 0; i < 20; i++) if (col[i] < Y.kou[c - 1][i]) dep = false;   /* 扶養が増えると下限は減らない（同じ値はある） */
  });
  t(y + ' 各列は下限20個', ok);
  t(y + ' 各列の下限は増えていく（単調）', mono);
  t(y + ' 扶養が増えても下限は減らない', dep);
  eq(y + ' 乙欄は5段', Y.otsu.length, 5);
  t(y + ' 乙欄の下限は増えていく', Y.otsu.every((r, i) => i === 0 || r[0] > Y.otsu[i - 1][0]));
}
eq('令和8年分 0人の列（PDF と同じ）', TT.BONUS_RATE[2026].kou[0].map((x) => x / 1000), [82, 94, 260, 309, 342, 372, 402, 433, 520, 605, 684, 715, 752, 795, 854, 922, 1318, 1521, 2621, 3495]);
eq('令和9年分 7人以上の列（PDF と同じ）', TT.BONUS_RATE[2027].kou[7].map((x) => x / 1000), [320, 387, 466, 510, 532, 555, 580, 617, 660, 710, 847, 889, 936, 988, 1054, 1138, 1491, 1583, 2788, 3717]);
eq('表の無い年分は null', TT.bonusRate(2028, 'kou', 0, 300000), null);
eq('甲欄 0人 81,999円は 0%', TT.bonusRate(2026, 'kou', 0, 81999), 0);
eq('甲欄 0人 82,000円は 2.042%', TT.bonusRate(2026, 'kou', 0, 82000), 2.042);
eq('甲欄 0人 3,495,000円は 45.945%', TT.bonusRate(2026, 'kou', 0, 3495000), 45.945);
eq('甲欄 9人は7人以上の列', TT.bonusRate(2026, 'kou', 9, 317000), TT.bonusRate(2026, 'kou', 7, 317000));

console.log('1. 健保の年度の累計の上限（5,730,000円）');
{
  /* 1990-06-15 生まれ＝36歳（介護なし） */
  const r = run(600000, { extra: { fyStdSum: 5000000, fyPriorStd: 500000 } });
  eq('またぐ回: 健保の標準は残りの 230,000円', r.std.health, 230000);
  eq('健保 230,000×10.08%÷2', r.ins.health, 11592);
  eq('支援金 230,000×0.23%÷2＝264.5 → 264', r.ins.support, 264);
  eq('厚年は年度の上限と関係なく 600,000円', r.std.pension, 600000);
  eq('標準賞与額（千円未満切捨て前の総額は 600,000）', r.std.raw, 600000);
  const r2 = run(600000, { extra: { fyStdSum: 5730000 } });
  eq('上限に達した後の回は健保 0', [r2.std.health, r2.ins.health, r2.ins.support], [0, 0, 0]);
  t('上限の後も厚年はかかる', r2.ins.pension > 0);
  const r3 = run(600000, { extra: { fyPriorStd: null } });
  t('他で払った分が空の時は知らせ fy_prior_manual（止めない）', has(r3, 'fy_prior_manual') && !stop(r3));
  const r4 = run(600999, {});
  eq('千円未満は切り捨て', r4.std.raw, 600000);
  const r5 = run(600000, { profile: prof({ ins: Object.assign(ON(), { health: { on: true, from: '2026-07-01' } }) }) });
  t('年度の途中で資格を取った人は知らせ fy_prior_unknown', has(r5, 'fy_prior_unknown') && !stop(r5));
}

console.log('2. 厚年の同じ月の上限（1,500,000円）');
{
  eq('1回で 1,500,000円ちょうど', run(1500000).std.pension, 1500000);
  eq('1回で 1,600,000円は 1,500,000円まで', run(1600000).std.pension, 1500000);
  eq('ほかの回 1,000,000円＋この回 500,000円＝ちょうど', run(500000, { extra: { monthStdSum: 1000000 } }).std.pension, 500000);
  eq('ほかの回 1,000,000円＋この回 600,000円は 500,000円まで', run(600000, { extra: { monthStdSum: 1000000 } }).std.pension, 500000);
  const r = run(600000, { extra: { monthStdSum: 1500000 } });
  eq('ほかの回で上限に達していれば厚年 0', [r.std.pension, r.ins.pension, r.employer.childcare], [0, 0, 0]);
  eq('厚年 1,500,000×18.3%÷2', run(1600000).ins.pension, 137250);
}

console.log('3. 前月の給与なし・前月の給与の扱い');
{
  const pOff = prof({ ins: OFF });
  const r = run(500000, { profile: pOff, prev: { kind: 'none' } });
  /* 500,000÷6＝83,333 → 月額表 105,000円未満は 0 → 0円 */
  eq('前月なし（kind none）は月額表の方法', [r.taxMethod, r.tax, r.P], ['monthly_none', 0, 0]);
  const r2 = run(500000, { profile: pOff, prev: { kind: 'manual', P: 0 } });
  eq('前月の P が 0 も月額表の方法', r2.taxMethod, 'monthly_none');
  const r3 = run(500000, { profile: pOff, prev: { kind: 'manual' } });
  t('手入力なのに P が無い時は止め prev_missing（黙って前月なしにしない）', has(r3, 'prev_missing') && stop(r3) && r3.taxMethod === null && r3.tax === 0);
  const r3b = run(500000, { profile: pOff, prev: { kind: 'manual', P: 'abc' } });
  t('P が数でない時も止め prev_missing', has(r3b, 'prev_missing') && stop(r3b));
  const r4 = run(500000, { profile: pOff, prev: { kind: 'missing' } });
  t('kind missing は止め prev_missing', has(r4, 'prev_missing') && stop(r4));
  const r5 = run(500000, { profile: pOff, prev: { kind: 'unconfirmed', P: 200000 } });
  t('kind unconfirmed は止め prev_unconfirmed', has(r5, 'prev_unconfirmed') && stop(r5));
  const r6 = run(500000, { profile: pOff, extra: { prev: null } });   /* run の既定の prev を上書きして「無い」にする */
  t('prev が無い時は止め prev_missing', has(r6, 'prev_missing') && stop(r6));
  const r7 = run(500000, { profile: pOff, prev: { kind: 'db', P: 200000, manualP: 210000 } });
  t('記録の P と手入力が違えば知らせ prev_mismatch（記録の値で数える）', has(r7, 'prev_mismatch') && !stop(r7) && r7.P === 200000);
  t('kind ytd も P で数える', run(500000, { profile: pOff, prev: { kind: 'ytd', P: 200000 } }).taxMethod === 'rate');
}

console.log('4. 10倍ちょうどと10倍超');
{
  const pOff = prof({ ins: OFF });
  const r = run(900000, { profile: pOff, prev: { kind: 'manual', P: 90000 } });
  eq('T＝10P は率の方法（90,000円 0人＝2.042%）', [r.taxMethod, r.rate, r.tax], ['rate', 2.042, 18378]);
  const r2 = run(900001, { profile: pOff, prev: { kind: 'manual', P: 90000 } });
  /* a＝floor(900,001÷6)＋90,000＝240,000 → 月額表 5,790 − 月額表(90,000)＝0 → ×6 */
  eq('T＝10P＋1 は月額表の方法（(5,790−0)×6）', [r2.taxMethod, r2.rate, r2.tax], ['monthly_10x', null, 34740]);
  const r3 = run(900001, { profile: pOff, prev: { kind: 'manual', P: 90000 }, settings: { bonus_period_months: 12 } });
  /* 算定期間が6か月超は ÷12・×12: a＝75,000＋90,000＝165,000 → 月額表で数え ×12 */
  /* 月額表 165,000〜167,000円の甲欄0人＝3,120 → (3,120−0)×12 */
  eq('算定期間 12か月は ÷12・×12', [r3.taxMethod, r3.tax], ['monthly_10x', 37440]);
}

console.log('5. 介護の40歳・65歳の境目（誕生日の前日の月・支給月 2026-12）');
{
  const care = (birth) => run(500000, { profile: prof({ birth_date: birth }) }).ins.care;
  /* 介護 500,000×1.62%÷2＝4,050 */
  eq('1986-12-02 生まれ（40歳の前日 2026-12-01）は介護あり', care('1986-12-02'), 4050);
  eq('1986-12-01 生まれ（40歳の前日 2026-11-30）は介護あり', care('1986-12-01'), 4050);
  eq('1987-01-01 生まれ（40歳の前日 2026-12-31）は介護あり', care('1987-01-01'), 4050);
  eq('1987-01-02 生まれ（40歳の前日 2027-01-01）は介護なし', care('1987-01-02'), 0);
  eq('1962-01-02 生まれ（65歳の前日 2027-01-01）は介護あり', care('1962-01-02'), 4050);
  eq('1962-01-01 生まれ（65歳の前日 2026-12-31）は介護なし', care('1962-01-01'), 0);
  eq('1961-12-02 生まれ（65歳の前日 2026-12-01）は介護なし', care('1961-12-02'), 0);
  eq('介護の対象外の印があれば介護なし', run(500000, { profile: prof({ birth_date: '1980-05-10', ins: Object.assign(ON(), { care_exempt: true }) }) }).ins.care, 0);
  eq('1956-12-01 生まれ（70歳の前日 2026-11-30）は厚年なし', run(500000, { profile: prof({ birth_date: '1956-12-01' }) }).ins.pension, 0);
  eq('1957-01-02 生まれ（70歳の前日 2027-01-01）は厚年あり', run(500000, { profile: prof({ birth_date: '1957-01-02' }) }).ins.pension, 45750);
}

console.log('6. 資格を失う月');
{
  const r = run(500000, { profile: prof({ retire_date: '2026-12-25' }) });   /* 喪失 12-26・支給 12-24 */
  eq('喪失日の前日までに払った賞与は社保 0', [r.ins.health, r.ins.care, r.ins.support, r.ins.pension], [0, 0, 0, 0]);
  t('印 lost_month（知らせだけ）と標準賞与額は残す（届は出す）', has(r, 'lost_month') && !stop(r) && r.std.health === 500000 && r.std.pension === 500000);
  eq('雇用保険は在籍中に払ったのでかかる', r.ins.emp, 2500);
  const r2 = run(500000, { profile: prof({ retire_date: '2026-12-20' }) });   /* 喪失 12-21・支給 12-24 */
  t('喪失日の後に払った賞与は社保 0・印なし・標準も 0', r2.ins.health === 0 && !has(r2, 'lost_month') && r2.std.health === 0);
  /* 2026-11-23 反証レビュー（指摘4）で決まりを変えた: 退職の後に払う賞与でも、算定期間に雇用保険の資格があればかける（仮置き） */
  t('退職の後に払う賞与でも算定期間に資格があれば雇用保険をかけ、知らせ emp_after_retire', r2.ins.emp === 2500 && has(r2, 'emp_after_retire') && !stop(r2));
  const r2b = run(500000, { profile: prof({ retire_date: '2026-05-31' }) });   /* 喪失 06-01・算定期間 2026-06-01〜 には資格なし */
  t('算定期間より前に退職した人には雇用保険をかけない', r2b.ins.emp === 0 && !has(r2b, 'emp_after_retire'));
  const r2c = run(500000, { profile: prof({ retire_date: '2026-06-15' }) });
  t('算定期間の中で退職した人にはかける（社保は0のまま）', r2c.ins.emp === 2500 && r2c.ins.health === 0 && r2c.ins.pension === 0);
  const r3 = run(500000, { profile: prof({ entry_date: '2026-12-01', retire_date: '2026-12-25' }) });
  t('同じ月に取得と喪失・その間に払った賞与はかかる', r3.ins.health === 25200 && r3.ins.pension === 45750 && !has(r3, 'lost_month'));
  const r4 = run(500000, { profile: prof({ entry_date: '2026-12-25', retire_date: '2026-12-28' }) });
  t('同じ月に取得と喪失・取得日の前に払った賞与はかからない', r4.ins.health === 0 && r4.ins.pension === 0);
  const r5 = run(500000, { profile: prof({ entry_date: '2027-01-05' }) });
  t('取得月より前に払った賞与はかからない', r5.ins.health === 0 && r5.ins.pension === 0);
}

console.log('6b. 年齢で資格を失う月（反証レビュー 2026-11-23 指摘2）');
{
  /* 75歳の誕生日に健保を失う: 1951-12-26 生まれは 2026-12-26 に喪失・支給 12-24 は前 */
  const a = run(500000, { profile: prof({ birth_date: '1951-12-26' }) });
  t('75歳で健保を失う月・失う日より前に払った賞与は健保0・標準賞与額は残す・lost_month', a.ins.health === 0 && a.ins.support === 0 && a.std.health === 500000 && has(a, 'lost_month') && !stop(a));
  const a2 = run(500000, { profile: prof({ birth_date: '1951-12-20' }) });   /* 喪失 2026-12-20・支給 12-24 は後 */
  t('75歳で失った日の後に払った賞与は健保0・標準も0', a2.ins.health === 0 && a2.std.health === 0);
  const a3 = run(500000, { profile: prof({ birth_date: '1952-01-05' }) });
  eq('75歳になる前の月は健保あり', a3.ins.health, 25200);
  /* 70歳に達する日（誕生日の前日）に厚年を失う: 1956-12-27 生まれは 2026-12-26 に喪失・支給 12-24 は前 */
  const b = run(500000, { profile: prof({ birth_date: '1956-12-27' }) });
  t('70歳で厚年を失う月・失う日より前に払った賞与は厚年0・標準賞与額は残す・lost_month', b.ins.pension === 0 && b.std.pension === 500000 && has(b, 'lost_month') && b.ins.health === 25200);
  const b2 = run(500000, { profile: prof({ birth_date: '1956-12-20' }) });   /* 喪失 2026-12-19・支給 12-24 は後 */
  t('70歳で失った日の後に払った賞与は厚年0・標準も0', b2.ins.pension === 0 && b2.std.pension === 0);
}

console.log('7. 端数 50銭ちょうど（50銭以下は切り捨て・50銭超は切り上げ）');
{
  /* 1980-05-10 生まれ（46歳・介護あり）・賞与 15,000円: 厚年 15,000×18.3%÷2＝1,372.5 → 1,372 / 介護 15,000×1.62%÷2＝121.5 → 121 / 支援金 15,000×0.23%÷2＝17.25 → 17 */
  const r = run(15000, { profile: prof({ birth_date: '1980-05-10' }) });
  eq('厚年 1,372.5 → 1,372', r.ins.pension, 1372);
  eq('介護 121.5 → 121', r.ins.care, 121);
  eq('支援金 17.25 → 17', r.ins.support, 17);
  eq('健保 756', r.ins.health, 756);
  eq('会社の厚年＝全額−本人分（2,745−1,372）', r.employer.pension, 1373);
  const e = (amt) => run(amt, { profile: prof({ ins: { health: { on: false }, pension: { on: false }, emp: { on: true } } }) }).ins.emp;
  eq('雇保 300×0.5%＝1.5 → 1', e(300), 1);
  eq('雇保 301×0.5%＝1.505 → 2', e(301), 2);
  const r2 = run(16000, { profile: prof({ birth_date: '1980-05-10' }) });
  eq('16,000円: 介護 129.6 → 130・厚年 1,464', [r2.ins.care, r2.ins.pension], [130, 1464]);
}

console.log('8. 乙欄の5段の境目');
{
  const otsu = (pay, P) => run(1000000, { pay_date: pay, profile: prof({ ins: OFF, tax: { col: 'otsu', dependents: 2, dependents_checked: true } }), prev: { kind: 'manual', P: P } });
  /* 税は T 1,000,000円×率（10.21%＝102,100・20.42%＝204,200・30.63%＝306,300・38.798%＝387,980・45.945%＝459,450） */
  [[223999, 10.21, 102100], [224000, 20.42, 204200], [294999, 20.42, 204200], [295000, 30.63, 306300], [526999, 30.63, 306300], [527000, 38.798, 387980], [1117999, 38.798, 387980], [1118000, 45.945, 459450]].forEach(([P, rate, tax]) => {
    const r = otsu('2026-12-24', P);
    eq('令和8年分 P ' + P + '円', [r.taxMethod, r.rate, r.tax], ['rate', rate, tax]);
  });
  [[295999, 20.42], [296000, 30.63], [527999, 30.63], [528000, 38.798]].forEach(([P, rate]) => {
    eq('令和9年分 P ' + P + '円', otsu('2027-01-15', P).rate, rate);
  });
  const r = otsu('2026-12-24', 0);
  t('乙欄で前月なしは月額表の乙欄で数え、知らせ otsu_monthly', r.taxMethod === 'monthly_none' && has(r, 'otsu_monthly') && !stop(r) && r.tax > 0);
}

console.log('9. 令和8年分と令和9年分の切り替え（支給日の年）');
{
  const pOff = prof({ ins: OFF });
  const a = run(500000, { pay_date: '2026-12-31', profile: pOff, prev: { kind: 'manual', P: 85000 } });
  const b = run(500000, { pay_date: '2027-01-04', profile: pOff, prev: { kind: 'manual', P: 85000 } });
  eq('2026-12-31 支給・P 85,000円・0人は令和8年分の 2.042%', [a.rate, a.tax], [2.042, 10210]);
  eq('2027-01-04 支給・同じ P は令和9年分の 0%（下限 87,000円）', [b.rate, b.tax], [0, 0]);
  /* 前月なし: 769,300÷6＝128,216 → 令和8年分 1,300 ×6＝7,800 / 令和9年分 960 ×6＝5,760 */
  eq('前月なしの月額表も年分で切り替わる（令和9年分 960×6）', run(769300, { pay_date: '2027-01-15', profile: pOff, prev: { kind: 'none' } }).tax, 5760);
  const c = run(500000, { pay_date: '2028-01-14', profile: pOff, prev: { kind: 'manual', P: 200000 } });
  t('表の無い年分は止め tax_table_missing（別の年で代えない）', has(c, 'tax_table_missing') && stop(c) && c.tax === 0);
  /* 保険料の率は支給日の月（ずらさない）: 2026-03 は支援金 0・2026-04 は 0.23% */
  eq('2026-03-31 支給は3月の率（支援金 0）', run(500000, { pay_date: '2026-03-31' }).ins.support, 0);
  eq('2026-04-01 支給は4月の率（支援金 575）', run(500000, { pay_date: '2026-04-01' }).ins.support, 575);
  const d = run(500000, { pay_date: '2027-06-10' });
  t('率表に無い月は止め rate_missing', has(d, 'rate_missing') && stop(d));
  const e = run(500000, { pay_date: '2027-04-10', profile: prof({ ins: { health: { on: false }, pension: { on: false }, emp: { on: true } } }) });
  t('雇用保険の率が無い日は止め emp_rate_missing', has(e, 'emp_rate_missing') && stop(e));
}

console.log('10. 国税庁の例と1円で合わせる');
{
  const pOff = prof({ ins: OFF });
  const r = run(468407, { profile: pOff, prev: { kind: 'manual', P: 90000 } });
  eq('使用例 468,407円×2.042%＝9,564円（P 90,000円・0人）', [r.T, r.rate, r.tax], [468407, 2.042, 9564]);
  const r2 = run(769300, { profile: pOff, prev: { kind: 'none' } });
  eq('No.2523 769,300円・前月なし・0人・令和8年分＝7,800円', [r2.T, r2.taxMethod, r2.tax], [769300, 'monthly_none', 7800]);
  const r3 = run(769300, { profile: pOff, prev: { kind: 'none' }, settings: { tax_method: 'computer' } });
  eq('電算機特例の設定でも月額表で数える（7,800円・電算機なら 7,860円になる）', r3.tax, 7800);
}

console.log('11. 出す物の形・行の合計・ほかの知らせ');
{
  const r = run(500000, { profile: prof({ birth_date: '1980-05-10', tax: { col: 'kou', dependents: 1, dependents_checked: true } }), prev: { kind: 'db', P: 250000 } });
  eq('出す物のキー', Object.keys(r), ['ver', 'gross', 'taxable', 'social', 'deduct', 'net', 'T', 'tax', 'taxMethod', 'rate', 'P', 'std', 'ins', 'employer', 'lines', 'warns']);
  eq('版の印', r.ver, 'payroll-bonus-1');
  eq('social は社保と雇保の本人分の合計', r.social, 25200 + 4050 + 575 + 45750 + 2500);
  eq('T＝課税の総支給−social', r.T, 500000 - r.social);
  eq('税 floor(T×4.084%)', r.tax, Math.floor(421925 * 4084 / 100000));
  const sum = (sec) => r.lines.filter((l) => l.sec === sec).reduce((s, l) => s + l.amount, 0);
  t('支給の行の和＝総支給・控除の行の和＝総控除・差引＝総支給−総控除', sum('pay') === r.gross && sum('deduct') === r.deduct && r.net === r.gross - r.deduct);
  t('住民税の行は無い', !r.lines.some((l) => l.code === 'resident_tax'));
  eq('月の給与の版は変えていない', C.CALC_VER, 'payroll-calc-3');
  /* 2026-11-23 反証レビュー（指摘1・3）で leave_check と tax_col を止めに足した */
  eq('止めの警告の一覧', Object.keys(C.BONUS_BLOCK).sort(), ['badinput', 'calc_error', 'emp_rate_missing', 'leave_check', 'prev_missing', 'prev_unconfirmed', 'rate_missing', 'std_missing', 'tax_col', 'tax_table_missing']);
  t('過去12か月に4回目の賞与は知らせ four_times', has(run(500000, { extra: { count12: 2, count12Other: 1 } }), 'four_times'));
  t('3回目までは four_times なし', !has(run(500000, { extra: { count12: 1, count12Other: 1 } }), 'four_times'));
  const defs = [{ code: 'commute', sec: 'pay', name: '通勤手当' }, { code: 'loan', sec: 'deduct', name: '貸付の返済' }];
  const r2 = C.computeBonus({ bonus: { pay_date: '2026-12-24', lines: [{ code: 'bonus', amount: 300000 }, { code: 'commute', amount: 5000 }, { code: 'loan', amount: 10000 }, { code: 'xx', amount: 1 }] },
    allowanceDefs: defs, profile: prof({ ins: OFF }), prev: { kind: 'manual', P: 250000 }, fyPriorStd: 0 });
  t('賞与に通勤手当があれば知らせ commute_in_bonus', has(r2, 'commute_in_bonus') && !stop(r2));
  t('手当の定義の控除は控除の行に入る', r2.lines.some((l) => l.sec === 'deduct' && l.code === 'd:loan' && l.amount === 10000));
  t('定義の無い項目は入れずに知らせ def_missing', has(r2, 'def_missing') && r2.gross === 305000);
  /* 2026-11-23 反証レビュー（指摘1）で決まりを変えた（仮置き）: 2か月以上の記録は免除・支給月の1か月だけは止め */
  const ex = (list) => run(500000, { profile: prof({ birth_date: '1980-05-10', ins: Object.assign(ON(), { exempt: list }) }) });
  const r3 = ex([{ from_ym: '2026-11', to_ym: '2027-02' }]);
  t('2か月以上の免除の期間に掛かる賞与は社保を本人・会社とも0・標準賞与額は残す・知らせ leave_exempt',
    has(r3, 'leave_exempt') && !stop(r3) && [r3.ins.health, r3.ins.care, r3.ins.support, r3.ins.pension].every((v) => v === 0) &&
    [r3.employer.health, r3.employer.care, r3.employer.support, r3.employer.pension, r3.employer.childcare].every((v) => v === 0) &&
    r3.std.health === 500000 && r3.std.pension === 500000 && r3.ins.emp === 2500);
  const r3b = ex([{ from_ym: '2026-12', to_ym: '2026-12' }]);
  t('支給月の1か月だけの記録は止め leave_check（社保は引いたまま）', has(r3b, 'leave_check') && stop(r3b) && !has(r3b, 'leave_exempt') && r3b.ins.health === 25200);
  const r3c = ex([{ from_ym: '2026-10' }]);
  t('終わりが空で始まりが支給月より前の記録は免除', has(r3c, 'leave_exempt') && r3c.ins.pension === 0);
  const r3d = ex([{ from_ym: '2026-12' }]);
  t('終わりが空で始まりが支給月の記録は止め leave_check', has(r3d, 'leave_check') && stop(r3d));
  const r3e = ex([{ from_ym: '2027-01', to_ym: '2027-03' }]);
  t('支給月に掛からない記録は何もしない', !has(r3e, 'leave_exempt') && !has(r3e, 'leave_check') && r3e.ins.health === 25200);
  const r4 = C.computeBonus({ bonus: { pay_date: '2026/12/24', lines: [] } });
  t('支給日の形が違えば止め badinput', has(r4, 'badinput') && stop(r4));
  const r5 = C.computeBonus({ bonus: { pay_date: '2026-12-24', lines: [{ code: 'bonus', amount: 100000 }] }, prev: { kind: 'none' } });
  t('給与の設定が無い人は止め std_missing', has(r5, 'std_missing') && stop(r5));
  const r5b = C.computeBonus({ bonus: { pay_date: '2026-12-24', lines: [{ code: 'bonus', amount: 100000 }] }, profile: {}, prev: { kind: 'none' } });
  t('給与の設定が空（{}）の人も止め std_missing', has(r5b, 'std_missing') && stop(r5b));
  const r5c = run(500000, { profile: prof({ ins: OFF, tax: { col: 'none' } }), extra: { prev: { kind: 'missing' } } });
  t('源泉の区分が none の人は前月の給与で止めない', !has(r5c, 'prev_missing') && !stop(r5c) && r5c.tax === 0);
  const r6 = C.computeBonus(null);
  t('入力が無くても例外を外に出さない', Array.isArray(r6.warns) && stop(r6));
  const r8 = run(500000, { profile: prof({ tax: { dependents: 0, dependents_checked: true } }) });
  t('源泉の区分が決まっていない時は止め tax_col（反証レビュー 指摘3）', has(r8, 'tax_col') && stop(r8));
  const r9 = run(500000, { profile: prof({ ins: OFF, tax: { col: 'otsu', dependents: 2, dependents_checked: true } }) });
  t('乙欄で扶養の数を捨てた時は知らせ otsu_dependents（反証レビュー 指摘5）', has(r9, 'otsu_dependents') && !stop(r9) && r9.warns.find((w) => w.code === 'otsu_dependents').msg === '乙欄では扶養の数を数えていません（従たる給与の申告書を出した方は代表者へ）');
  t('乙欄で扶養0人なら otsu_dependents は出さない', !has(run(500000, { profile: prof({ ins: OFF, tax: { col: 'otsu', dependents: 0, dependents_checked: true } }) }), 'otsu_dependents'));
  const r7 = run(500000, { profile: prof({ pay_type: 'board' }) });
  t('役員は雇用保険を見ない', r7.ins.emp === 0 && r7.ins.health === 25200);
}

console.log('\n' + (fail ? '✗' : '✓') + ' payroll_bonus ' + pass + ' 件成功／' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
