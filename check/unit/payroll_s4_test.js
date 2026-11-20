/* 給与の画面と計算の、勤怠 v5 段4（休暇の種類・統合 0113）の受け方の試験（2026-11-20 新設）
   実行: node check/unit/payroll_s4_test.js
   守りたいこと:
     1. 締めの控えの確かめ（verifyKintai）は kintai_month_get の absences を computeMonth に渡す＝休暇を入れた月でも控えと同じで止まらない
     2. 勤怠の受け口（attFromKintai）: 休暇の鍵を受ける（日数は半日きざみのまま）・段4 より前の控え（鍵が無い）は 0 で missing にしない・attSame で比べる
     3. 払い方（仮置き）: 時給＝時間単位は今の paidMin のまま・有給の特別休暇は時給×分。日給＝時間単位は日給×分÷1日の所定時間・有給の特別休暇は日給×日数。
        月給＝有給の休みは控除しない・無給の特別休暇と代休は欠勤と同じに日数で控除。無給の休み（時給・日給）は何も足さない
     4. 休暇を使わない月は、休暇の鍵が無い時と同じ明細（行・額・警告）
     5. 勤怠の計算: 時間単位の有休で休んだ時間は、その日の遅刻・早退に数えない（月給の遅刻早退の控除に入らない）
   ★職員は架空。期待値は手で数えた数字。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PC = require(path.join(ROOT, 'payroll-calc.js'));
const KC = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

const PERIOD = { from: '2026-12-01', to: '2026-12-31' };
const run = (profile, att) => PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2027-01-25', settings: {}, profile, allowanceDefs: [], att, adjustments: [] });
const L = (it, code) => { const l = it.lines.find((x) => x.code === code && x.sec !== 'att'); return l ? l.amount : undefined; };
const LA = (it, code) => { const l = it.lines.find((x) => x.code === code && x.sec === 'att'); return l ? l.qty : undefined; };
const INS = { emp: { on: true } }, TAX = { col: 'kou', dependents: 0 };
const HOURLY = { pay_type: 'hourly', base: 1100, ins: INS, tax: TAX };
const DAILY = { pay_type: 'daily', base: 10000, day_hours: 8, ins: INS, tax: TAX };
const MONTHLY = { pay_type: 'monthly', base: 300000, day_hours: 8, ins: INS, tax: TAX };
const BASE_ATT = { workDays: 20, paidDays: 1, paidMin: 480, workMin: 9600, schedInMin: 9600, absentDays: 0, lateMin: 30, earlyLeaveMin: 0, schedDays: 21 };
const ZERO = { hourlyPaidMin: 0, specialPaidMin: 0, specialPaidDays: 0, specialUnpaidDays: 0, compDays: 0 };

console.log('\n— 4. 休暇を使わない月は今と同じ —');
for (const [nm, pf] of [['時給', HOURLY], ['日給', DAILY], ['月給', MONTHLY]]) {
  const a = run(pf, Object.assign({}, BASE_ATT)), b = run(pf, Object.assign({}, BASE_ATT, ZERO));
  t(nm + ': 休暇の鍵が0の月は、鍵が無い時と明細（行・額・警告）が同じ', JSON.stringify(a) === JSON.stringify(b) && a.gross > 0, [a.gross, b.gross]);
}

console.log('\n— 3. 払い方 —');
{
  const h = run(HOURLY, Object.assign({}, BASE_ATT, { paidMin: 480 + 120, hourlyPaidMin: 120, specialPaidMin: 480, specialPaidDays: 1, specialUnpaidDays: 1, compDays: 0.5 }));
  t('時給: 基本給は（所定内＋有休）＝ 時間単位の有休を含む paidMin で払う（1100×(9600+600)÷60＝187000）', L(h, 'basic') === 187000, L(h, 'basic'));
  t('時給: 有給の特別休暇は時給×分（1100×480÷60＝8800）・無給の特別休暇と代休は何も足さない（控除の行も無い）', L(h, 'special_paid') === 8800 && L(h, 'leave_unpaid') === undefined && L(h, 'paid_leave_hour') === undefined, h.lines.filter((l) => l.sec === 'pay'));
  /* ★反証レビュー（2026-11-20・4）: 日給は働いた日をもう満額払っているので、働いていない日の分（hourlyPaidOffMin・specialPaidOffDays）だけ払うことにした。材料に働いていない日の分を足し、働いた日の分だけの時は払わないことも見る */
  const d = run(DAILY, Object.assign({}, BASE_ATT, { hourlyPaidMin: 180, hourlyPaidEffMin: 120, hourlyPaidOffMin: 120, specialPaidDays: 2, specialPaidOffDays: 1.5, specialUnpaidDays: 1, compDays: 1 }));
  t('日給: 働いていない日の時間単位の有休は日給×効く分÷1日の所定時間（10000×120÷480＝2500）', L(d, 'paid_leave_hour') === 2500, L(d, 'paid_leave_hour'));
  t('日給: 働いていない日の有給の特別休暇は日給×日数（半日きざみのまま・10000×1.5＝15000）・無給の休みは何も足さない', L(d, 'special_paid') === 15000 && L(d, 'leave_unpaid') === undefined);
  const dw = run(DAILY, Object.assign({}, BASE_ATT, { hourlyPaidMin: 120, hourlyPaidEffMin: 120, hourlyPaidOffMin: 0, specialPaidDays: 0.5, specialPaidOffDays: 0 }));
  t('日給: 働いた日の時間単位の有休・半日の有給の特別休暇は上乗せしない（行が無い）', L(dw, 'paid_leave_hour') === undefined && L(dw, 'special_paid') === undefined);
  t('日給: 今の有休（日給×有休の日数）はそのまま', L(d, 'paid_leave') === 10000);
  const m0 = run(MONTHLY, Object.assign({}, BASE_ATT));
  const m1 = run(MONTHLY, Object.assign({}, BASE_ATT, { hourlyPaidMin: 120, specialPaidMin: 480, specialPaidDays: 1 }));
  t('月給: 時間単位の有休・有給の特別休暇は控除しない（総支給が同じ・控除の行なし）', m1.gross === m0.gross && L(m1, 'leave_unpaid') === undefined && L(m1, 'special_paid') === undefined, [m0.gross, m1.gross]);
  const m2 = run(MONTHLY, Object.assign({}, BASE_ATT, { specialUnpaidDays: 1, compDays: 0.5 }));
  t('月給: 無給の特別休暇と代休は欠勤と同じに控除（単価 300000÷172＝1744 ×8h×1.5日＝20928）', L(m2, 'leave_unpaid') === -20928 && m2.gross === m0.gross - 20928, L(m2, 'leave_unpaid'));
  const m3 = PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2027-01-25', settings: { absence_deduct: false }, profile: MONTHLY, allowanceDefs: [], att: Object.assign({}, BASE_ATT, { specialUnpaidDays: 1 }), adjustments: [] });
  t('月給: 欠勤控除をしない設定では、無給の休みも控除しない', L(m3, 'leave_unpaid') === undefined);
  t('勤怠の行: 休暇の種類はある時だけ出す（時間単位の分・日数は半日きざみ）・無い月は出さない', LA(d, 'hourlyPaidMin') === 180 && LA(d, 'specialPaidDays') === 2 && LA(d, 'compDays') === 1 && LA(m0, 'compDays') === undefined && LA(m0, 'hourlyPaidMin') === undefined);
}

console.log('\n— 5. 勤怠の計算: 時間単位の有休の時間を遅刻・早退に数えない —');
{
  const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
  const D = '2026-12-01', D2 = '2026-12-02';
  const S = (d) => ({ staff_id: 'x', work_date: d, seq: 1, office: 'facility', kind: 'work', start_at: KC.iso(at(d, '9:00')), end_at: KC.iso(at(d, '18:00')), break_min: 60, paid_min: 0, symbol: '日' });
  const P = (d, k, hm) => ({ id: d + k + hm, staff_id: 'x', kind: k, at: new Date(at(d, hm)).toISOString(), source: 'tablet' });
  const mon = (abs) => KC.computeMonth({ ym: '2026-12', staff: [{ staff_id: 'x', office: 'facility' }], schedule: [S(D), S(D2)], punches: [P(D, 'in', '11:00'), P(D, 'out', '18:00'), P(D2, 'in', '9:00'), P(D2, 'out', '17:00')], days: [], absences: abs, config: {}, now: Date.parse('2027-01-10') }).people[0];
  const p0 = mon([]), p1 = mon([{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 120 }, { staff_id: 'x', date: D2, kind: 'hourly_paid', minutes: 60 }]);
  t('休暇なし: 遅刻 120分（1回）・早退 60分（1回）', p0.sum.lateMin === 120 && p0.sum.lateCount === 1 && p0.sum.earlyLeaveMin === 60 && p0.sum.earlyLeaveCount === 1, p0.sum);
  t('時間単位の有休（遅刻の日 2時間・早退の日 1時間）: 遅刻・早退とも 0分・0回（日の行に差し引いた分）', p1.sum.lateMin === 0 && p1.sum.lateCount === 0 && p1.sum.earlyLeaveMin === 0 && p1.sum.earlyLeaveCount === 0 && p1.days[0].hourlyOffsetMin === 120, p1.sum);
  const p2 = mon([{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 60 }]);
  t('時間単位の有休が遅刻より短い（1時間）: 遅刻は残り 60分・1回のまま', p2.sum.lateMin === 60 && p2.sum.lateCount === 1, p2.sum);
  t('実働・paidMin は時間単位で変わらない所は今のまま（実働は同じ・paidMin は時間単位の分だけ増える）', p1.sum.workMin === p0.sum.workMin && p1.sum.paidMin === p0.sum.paidMin + 180);
  const mo = run(MONTHLY, Object.assign({}, BASE_ATT, { lateMin: p1.sum.lateMin, earlyLeaveMin: p1.sum.earlyLeaveMin, hourlyPaidMin: 180 }));
  t('月給: 時間単位の有休で休んだ遅刻・早退は遅刻早退の控除に入らない', L(mo, 'late') === undefined, mo.lines.filter((l) => l.sec === 'pay'));
}

console.log('\n— 6. 反証レビュー（2026-11-20）の場面: 勤怠の計算から給与の額まで —');
{
  /* 架空の職員: 月給30万（1日8時間・時間単価1744円）・日給1万円（1日8時間）・時給1100円。予定 9〜18時（休憩60分） */
  const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
  const D = '2026-12-01', D2 = '2026-12-02';
  const S9 = (d) => ({ staff_id: 'x', work_date: d, seq: 1, office: 'facility', kind: 'work', start_at: KC.iso(at(d, '9:00')), end_at: KC.iso(at(d, '18:00')), break_min: 60, paid_min: 0, symbol: '日' });
  const PU = (d, k, hm) => ({ id: d + k + hm, staff_id: 'x', kind: k, at: new Date(at(d, hm)).toISOString() });
  const row = (o) => KC.snapshotOf(KC.computeMonth(Object.assign({ ym: '2026-12', staff: [{ staff_id: 'x', office: 'facility' }], schedule: [S9(D)], punches: [], days: [], config: {}, now: Date.parse('2027-01-10') }, o))).rows[0];
  const amt = (pf, r) => { const it = run(pf, Object.assign({}, r, { reviewCount: 0 })); return it.lines.filter((l) => l.sec === 'pay').map((l) => l.code + ':' + l.amount).join(' '); };
  const all = (r) => [amt(MONTHLY, r), amt(DAILY, r), amt(HOURLY, r)];
  const eq3 = (nm, r, exp) => { const got = all(r); t(nm + ' → 月給「' + exp[0] + '」日給「' + exp[1] + '」時給「' + exp[2] + '」', got[0] === exp[0] && got[1] === exp[1] && got[2] === exp[2], got); };
  const full = [PU(D, 'in', '9:00'), PU(D, 'out', '18:00')], am = [PU(D, 'in', '9:00'), PU(D, 'out', '13:00')];
  /* 働いた日＋休暇 */
  eq3('満額働いた日＋時間単位2時間（効かない）', row({ punches: full, absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 120 }] }), ['basic:300000', 'basic:10000', 'basic:8800']);
  eq3('11時に出勤（遅刻2時間）＋時間単位2時間', row({ punches: [PU(D, 'in', '11:00'), PU(D, 'out', '18:00')], absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 120 }] }), ['basic:300000', 'basic:10000', 'basic:8800']);
  /* 欠勤の印＋休暇（欠勤に数えず休暇として1回だけ） */
  const ab = [{ staff_id: 'x', work_date: D, day_mark: 'absent' }];
  eq3('欠勤の印＋無給の特別休暇', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: false }] }), ['basic:300000 leave_unpaid:-13952', 'basic:0', 'basic:0']);
  eq3('欠勤の印＋代休', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'comp', link_date: '2026-11-29' }] }), ['basic:300000 leave_unpaid:-13952', 'basic:0', 'basic:0']);
  eq3('欠勤の印＋有給の特別休暇', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: true }] }), ['basic:300000', 'basic:0 special_paid:10000', 'basic:0 special_paid:8800']);
  eq3('欠勤の印＋時間単位8時間', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 480 }] }), ['basic:300000', 'basic:0 paid_leave_hour:10000', 'basic:8800']);
  t('欠勤の印＋休暇の日は欠勤に数えない（absentDays 0）', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: false }] }).absentDays === 0 && row({ days: ab }).absentDays === 1);
  /* 再確認の反証（2026-11-20）: 欠勤の印の日に休暇が半日・数時間分だけの時は、休暇で埋まらない残りを欠勤に数える（半日ちょうどは 0.5 日・それ以外は分） */
  eq3('欠勤の印だけ（休暇なし・今と同じ額）', row({ days: ab }), ['basic:300000 absence:-13952', 'basic:0', 'basic:0']);
  eq3('欠勤の印＋時間単位4時間（残り半日を欠勤）', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 240 }] }), ['basic:300000 absence:-6976', 'basic:0 paid_leave_hour:5000', 'basic:4400']);
  eq3('欠勤の印＋半日の無給の特別休暇（休暇の控除＋残り半日の欠勤）', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: false, minutes: 240 }] }), ['basic:300000 absence:-6976 leave_unpaid:-6976', 'basic:0', 'basic:0']);
  eq3('欠勤の印＋半日の有給の特別休暇（残り半日を欠勤）', row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: true, minutes: 240 }] }), ['basic:300000 absence:-6976', 'basic:0 special_paid:5000', 'basic:0 special_paid:4400']);
  const r3h = row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 180 }] });
  eq3('欠勤の印＋時間単位3時間（残り5時間を欠勤の分で数える＝1744×300÷60）', r3h, ['basic:300000 absence:-8720', 'basic:0 paid_leave_hour:3750', 'basic:3300']);
  t('欠勤の分は控えの absentPartMin（300分）・日数は 0・半日ちょうどは absentDays 0.5', r3h.absentPartMin === 300 && r3h.absentDays === 0 && row({ days: ab, absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 240 }] }).absentDays === 0.5);
  const noDed = PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2027-01-25', settings: { absence_deduct: false }, profile: MONTHLY, allowanceDefs: [], att: Object.assign({}, r3h, { reviewCount: 0 }), adjustments: [] });
  t('欠勤控除を切る設定では欠勤の分も引かない', !noDed.lines.some((l) => l.code === 'absence'));
  /* 半日の休暇＋早退（午前だけ 9〜13時） */
  eq3('半日の無給の特別休暇＋午前だけ', row({ punches: am, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: false, minutes: 240 }] }), ['basic:300000 leave_unpaid:-6976', 'basic:10000', 'basic:4400']);
  eq3('半日の代休＋午前だけ', row({ punches: am, absences: [{ staff_id: 'x', date: D, kind: 'comp', minutes: 240, link_date: '2026-11-29' }] }), ['basic:300000 leave_unpaid:-6976', 'basic:10000', 'basic:4400']);
  eq3('半日の有給の特別休暇＋午前だけ', row({ punches: am, absences: [{ staff_id: 'x', date: D, kind: 'special', paid: true, minutes: 240 }] }), ['basic:300000', 'basic:10000', 'basic:4400 special_paid:4400']);
  /* 給与の額の直し（代表者の決定 2026-11-20・2）: 半日有休の日の早退は有休の分を差し引く（前は 早退300分→late:-8720 を控除していた）。
     2026-11-21: 日給の半日有休は日給×0.5日（前は整数に丸めて 10000円） */
  eq3('手入力の半日有休＋午前だけ（早退は有休の分で埋まる＝控除なし・日給の有休は半日分）', row({ punches: am, leave_uses: [{ id: 'u', staff_id: 'x', use_date: D, days: 0.5 }] }), ['basic:300000', 'basic:10000 paid_leave:5000', 'basic:8800']);
  /* 日給の働いた日＋時間単位・働いていない日 */
  eq3('打刻なしの日に時間単位8時間（働いていない日）', row({ absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 480 }] }), ['basic:300000', 'basic:0 paid_leave_hour:10000', 'basic:8800']);
  /* 夜勤（22時〜翌7時・休憩60分）を翌5時に早退して時間単位2時間。始めた日でも終わった日で入れても、その夜勤の早退から差し引く */
  const nsch = [{ staff_id: 'x', work_date: D, seq: 1, office: 'facility', kind: 'night', start_at: KC.iso(at(D, '22:00')), end_at: KC.iso(at(D2, '7:00')), break_min: 60, paid_min: 0, symbol: '夜' }];
  const npun = [PU(D, 'in', '22:00'), { id: 'no', staff_id: 'x', kind: 'out', at: new Date(at(D2, '5:00')).toISOString() }];
  const n0 = row({ schedule: nsch, punches: npun }), n1 = row({ schedule: nsch, punches: npun, absences: [{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 120 }] }), n2 = row({ schedule: nsch, punches: npun, absences: [{ staff_id: 'x', date: D2, kind: 'hourly_paid', minutes: 120 }] });
  t('夜勤＋時間単位2時間: 休暇なしは早退120分・始めた日で入れても終わった日で入れても早退0分・効く分120分', n0.earlyLeaveMin === 120 && n1.earlyLeaveMin === 0 && n2.earlyLeaveMin === 0 && n1.hourlyPaidEffMin === 120 && n2.hourlyPaidEffMin === 120, [n0.earlyLeaveMin, n1.earlyLeaveMin, n2.earlyLeaveMin]);
  const mN0 = amt(MONTHLY, n0), mN2 = amt(MONTHLY, n2);
  t('夜勤＋時間単位: 月給は休暇なしなら遅刻早退の控除があり、時間単位を入れると控除が無い（深夜の割増はそのまま）', /late:-3488/.test(mN0) && !/late:/.test(mN2) && /ot_night:2618/.test(mN2), [mN0, mN2]);
  /* 振替の働く日に予定なし（画面で止める）は kintai_s4_test の 10 で、送らないこと（return）を確かめる */
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  t('振替の働く日に予定が無い時は止める（送らない）・夜勤の日は勤務を始めた日で入れる注記', /if \(schedOnDay\(ctx\.sid, sl\) === false\) \{ msg\.textContent = '振替の働く日に出勤予定がありません。先に『予定を直す』で働く日の予定を入れてください。'; return; \}/.test(K) && /夜勤の日は勤務を始めた日で入れてください。/.test(K));
}

console.log('\n— 1・2. 締めの控えの確かめと勤怠の受け口 —');
{
  const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
  const between = (a, b) => { const i = J.indexOf(a), j = J.indexOf(b, i + 1); return i >= 0 && j > i ? J.slice(i, j) : ''; };
  const src = between('  function arr(v)', '  function kintaiBlock()');
  t('給与の画面の部品を切り出せた', /function verifyKintai\(/.test(src) && /absences: arr\(d\.absences\)/.test(src));
  const make = (raw) => new Function('KC', 'RAW', `var window = { KintaiCalc: KC }; function note() {}
    function rpc(name, args) { return Promise.resolve(RAW(args.p_ym)); }
    ${src}
    return { verifyKintai: verifyKintai, attFromKintai: attFromKintai, attSame: attSame };`)(KC, raw);
  /* ★反証レビュー（2026-11-20・8）: 控えを数え直しと同じ関数・同じ材料で作らない。架空の1人・3日の月の控えを手で数えた値で書き、
     新しい版の数え直し（休暇を渡す）と比べて ok、休暇を渡さない数え直し（直す前の版と同じ道）で作った控えと比べて ng になることを見る。
     12/1 9〜18時を満額・12/2 無給の特別休暇（予定あり・打刻なし）・12/3 11時に出勤（遅刻2時間）して時間単位の有休2時間 */
  const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
  const D1 = '2026-12-01', D2 = '2026-12-02', D3 = '2026-12-03';
  const S9 = (d) => ({ staff_id: 'k1', work_date: d, seq: 1, office: 'facility', kind: 'work', start_at: KC.iso(at(d, '9:00')), end_at: KC.iso(at(d, '18:00')), break_min: 60, paid_min: 0, symbol: '日' });
  const PU = (d, k, hm) => ({ id: d + k, staff_id: 'k1', kind: k, at: new Date(at(d, hm)).toISOString() });
  const sched = [S9(D1), S9(D2), S9(D3)], pun = [PU(D1, 'in', '9:00'), PU(D1, 'out', '18:00'), PU(D3, 'in', '11:00'), PU(D3, 'out', '18:00')];
  const staff = [{ staff_id: 'k1', office: 'facility' }];
  const absences = [{ id: 'a1', staff_id: 'k1', date: D2, kind: 'special', paid: false, type_code: 'other' }, { id: 'a2', staff_id: 'k1', date: D3, kind: 'hourly_paid', minutes: 120, paid: true }];
  const period = { from: '2026-12-01', to: '2026-12-31' };
  /* 手で数えた控えの1行（実働 480＋360・時間単位の有休は働かなかった2時間に効き、遅刻2時間を差し引く・無給の特別休暇の日は打刻なし・要確認にしない） */
  const handRow = { staff_id: 'k1', emp_code: null, workDays: 2, paidDays: 0, paidMin: 120, workMin: 840, schedInMin: 840, legalInOverMin: 0, legalOverMin: 0, over60Min: 0, nightMin: 0, holidayMin: 0,
    absentDays: 0, lateMin: 0, earlyLeaveMin: 0, nightShiftCount: 0, schedDays: 3, reviewCount: 0, counts: { '日': 2 },
    hourlyPaidMin: 120, hourlyPaidEffMin: 120, hourlyPaidOffMin: 0, specialPaidMin: 0, specialPaidDays: 0, specialUnpaidDays: 1, specialPaidOffDays: 0, compDays: 0 };
  const cfg0 = KC.fillConfig({});
  const rawWith = (snapRows) => () => ({ ok: true, period, staff, schedule: sched, punches: pun, days: [], leave_uses: [], absences, month: { ym: '2026-12', locked_at: '2027-01-05T00:00:00Z', snapshot: { v: 1, ym: '2026-12', period, config: cfg0, rows: snapRows } } });
  const boot = { kintai: { locked: true }, profiles: [{ staff_id: 'k1', name: '架空 一', data: {} }] };
  const F = make(rawWith([handRow]));
  /* 直す前の版と同じ道（休暇を渡さない数え直し）で作った控え */
  const oldSnap = KC.snapshotOf(KC.computeMonth({ ym: '2026-12', period, staff, schedule: sched, punches: pun, days: [], config: {}, now: Date.parse('2027-01-05') })).rows;
  F.verifyKintai('2026-12', boot).then((r) => {
    t('手で数えた控え（休暇あり）と、新しい版の数え直し（休暇を渡す）は同じ＝止まらない（ok）', r.state === 'ok' && r.names.length === 0, r);
    return make(rawWith(oldSnap)).verifyKintai('2026-12', boot);
  }).then((r2) => {
    t('休暇を渡さない数え直し（直す前の版の道）で作った控えとは食い違って止まる（ng）', r2.state === 'ng' && r2.names.length === 1, r2);
    t('材料の確かめ: 直す前の道の控えは遅刻2時間・要確認1件・有休0分（手の控えと違う所）', oldSnap[0].lateMin === 120 && oldSnap[0].reviewCount === 1 && oldSnap[0].paidMin === 0, oldSnap[0]);
    return make(() => Object.assign(rawWith([handRow])(), { absences: [] })).verifyKintai('2026-12', boot);
  }).then((r3) => {
    t('（比べ）休暇の行が届かない数え直しは、手の控えと食い違って止まる（ng）', r3.state === 'ng', r3);
    const a = F.attFromKintai({ workDays: 1, paidDays: 0.5, paidMin: 0, specialPaidDays: 1.5, compDays: 0.5, hourlyPaidMin: 120.4 });
    t('受け口: 休暇の日数は半日きざみのまま（1.5・0.5）・分は整数', a.specialPaidDays === 1.5 && a.compDays === 0.5 && a.hourlyPaidMin === 120);
    const old = F.attFromKintai(Object.assign({}, handRow, { hourlyPaidMin: undefined, hourlyPaidEffMin: undefined, hourlyPaidOffMin: undefined, specialPaidMin: undefined, specialPaidDays: undefined, specialUnpaidDays: undefined, specialPaidOffDays: undefined, compDays: undefined }));
    t('受け口: 段4 より前の控え（休暇の鍵が無い）は 0 で、missing（古い控えの警告）に入れない', ['hourlyPaidMin', 'hourlyPaidEffMin', 'hourlyPaidOffMin', 'specialPaidMin', 'specialPaidDays', 'specialPaidOffDays', 'specialUnpaidDays', 'compDays'].every((k) => old[k] === 0 && old.missing.indexOf(k) < 0));
    t('受け口: 欠勤の日数は半日きざみのまま（0.5）・整数の日は今と同じ・古い控えに無い欠勤の分は 0（missing にしない）', F.attFromKintai({ absentDays: 0.5 }).absentDays === 0.5 && F.attFromKintai({ absentDays: 2 }).absentDays === 2 && F.attFromKintai({}).absentPartMin === 0 && F.attFromKintai({}).missing.indexOf('absentPartMin') < 0);
    const x3 = F.attFromKintai(Object.assign({}, handRow, { absentPartMin: 300 }));
    t('attSame: 欠勤の分が違えば違う（照合で止まる）', !F.attSame(F.attFromKintai(handRow), x3));
    const x0 = F.attFromKintai(handRow), x1 = F.attFromKintai(Object.assign({}, handRow, { compDays: 0.5 })), x2 = F.attFromKintai(Object.assign({}, handRow, { hourlyPaidOffMin: 60 }));
    t('attSame: 休暇の鍵（代休・働いていない日の時間単位の分）が違えば違う・同じなら同じ', F.attSame(x0, F.attFromKintai(handRow)) && !F.attSame(x0, x1) && !F.attSame(x0, x2));
  }).then(() => {
    console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
    process.exit(fail ? 1 : 0);
  }, (e) => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
}
