/* 勤怠の計算と給与の計算で、給与の額が誤る5件の直しの試験（代表者の決定 2026-11-20・推奨どおり）
   実行: node check/unit/payroll_fix5_test.js
   守りたいこと:
     1. 予定も前提も無い勤務のある月給の人に警告（no_sched_monthly）を出す。数え方は変えない。勤怠で「確認済み」にしても消えない。古い控え（鍵が無い）は出さない
     2. 半日有休（手入力の 0.5 日・シフトの有休の行）の日に働いた時、遅刻・早退の控除から有休の分を差し引く
     3. 遅刻・早退の控除は「足りない実働」まで（休憩を含む時計の時間で数えない・遅刻して残業を認めて所定どおり働いた日は0）。日の塊の分と印は今のまま
     4. 時給の人の日で数える有休は「有休の日数×1日の所定時間」で払う。1日の所定時間が空の時は今の値のまま払い警告
     5. 日給の人の法定休日の労働は、基本給の日数から除き休日労働で払う（勤怠の月の合計と控えに holidayWorkDays）。古い控えは今の警告
   ★職員は架空。期待値は手で数えた数字。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PC = require(path.join(ROOT, 'payroll-calc.js'));
const KC = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

/* 給与の画面の勤怠の受け口（attFromKintai）を切り出す（控えの1行 → 計算の入力） */
const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
const between = (a, b) => { const i = J.indexOf(a), j = J.indexOf(b, i + 1); return i >= 0 && j > i ? J.slice(i, j) : ''; };
const src = between('  var ATT_KEYS', '  /* 締めの控えの確かめ');
const attFrom = new Function('function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }\n' + src + '\nreturn attFromKintai;')();

const PERIOD = { from: '2026-12-01', to: '2026-12-31' };
const run = (profile, att) => PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2027-01-25', settings: {}, profile, allowanceDefs: [], att, adjustments: [] });
const L = (it, code) => { const l = it.lines.find((x) => x.code === code && x.sec !== 'att'); return l ? l.amount : undefined; };
const LN = (it, code) => it.lines.find((x) => x.code === code && x.sec !== 'att');
const W = (it, code) => it.warnings.some((w) => w.code === code);
const INS = { emp: { on: true } }, TAX = { col: 'kou', dependents: 0 };
const MONTHLY = { pay_type: 'monthly', base: 300000, day_hours: 8, ins: INS, tax: TAX };   /* 時間単価 1744円 */
const DAILY = { pay_type: 'daily', base: 10000, day_hours: 8, ins: INS, tax: TAX };
const HOURLY4 = { pay_type: 'hourly', base: 1100, day_hours: 4, ins: INS, tax: TAX };
const HOURLY_NODH = { pay_type: 'hourly', base: 1100, ins: INS, tax: TAX };

const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
const D = '2026-12-01', D2 = '2026-12-02', SUN = '2026-12-06';
const S9 = (d) => ({ staff_id: 'x', work_date: d, seq: 1, office: 'facility', kind: 'work', start_at: KC.iso(at(d, '9:00')), end_at: KC.iso(at(d, '18:00')), break_min: 60, paid_min: 0, symbol: '日' });
let pid = 0;
const PU = (d, k, hm) => ({ id: 'p' + (++pid), staff_id: 'x', kind: k, at: new Date(at(d, hm)).toISOString(), source: 'tablet' });
const mon = (o) => KC.computeMonth(Object.assign({ ym: '2026-12', staff: [{ staff_id: 'x', office: 'facility' }], schedule: [S9(D)], punches: [], days: [], config: {}, now: Date.parse('2027-01-10') }, o)).people[0];
const snap = (o) => KC.snapshotOf(KC.computeMonth(Object.assign({ ym: '2026-12', staff: [{ staff_id: 'x', office: 'facility' }], schedule: [S9(D)], punches: [], days: [], config: {}, now: Date.parse('2027-01-10') }, o))).rows[0];
const att = (r) => Object.assign(attFrom(r), { reviewCount: 0 });
const day = (p, d) => p.days.find((x) => x.date === d);

console.log('\n— 3. 遅刻・早退の控除は足りない実働まで —');
{
  const p13 = mon({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '13:00')] });
  t('9〜18時（休憩60分）を 13:00 に退勤: 月の早退は 240分・1回（前は時計の 300分）・日の塊の早退は 300分と印のまま', p13.sum.earlyLeaveMin === 240 && p13.sum.earlyLeaveCount === 1 && day(p13, D).blocks[0].earlyLeaveMin === 300 && day(p13, D).blocks[0].flags.indexOf('early_leave') >= 0, [p13.sum.earlyLeaveMin, day(p13, D).blocks[0].earlyLeaveMin]);
  t('休暇の無い日の日の行に差し引いた分（hourlyOffsetMin）を書かない（日の行の形は今のまま）', day(p13, D).hourlyOffsetMin === undefined);
  const r13 = snap({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '13:00')] });
  t('月給: 遅刻早退の控除は 1744×240÷60＝6976円（前は 1744×300÷60＝8720円）', L(run(MONTHLY, att(r13)), 'late') === -6976, L(run(MONTHLY, att(r13)), 'late'));
  const p15 = mon({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '15:00')] }), p1501 = mon({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '15:01')] });
  t('境目: 15:00 退勤（拘束6時間ちょうど＝休憩なし・実働360分）は早退 120分（時計は180分）', p15.sum.earlyLeaveMin === 120 && day(p15, D).blocks[0].earlyLeaveMin === 180, p15.sum.earlyLeaveMin);
  t('境目: 15:01 退勤（休憩60分を引く・実働301分）は早退 179分（時計どおり・今と同じ）', p1501.sum.earlyLeaveMin === 179, p1501.sum.earlyLeaveMin);
  const pOt = mon({ punches: [PU(D, 'in', '9:30'), PU(D, 'out', '18:30')], days: [{ staff_id: 'x', work_date: D, overtime_ok: true }] });
  t('30分遅刻＋残業を認めて 18:30 退勤（実働480分＝所定どおり）: 月の遅刻 0分・0回・日の塊の遅刻 30分と印のまま', pOt.sum.lateMin === 0 && pOt.sum.lateCount === 0 && day(pOt, D).blocks[0].lateMin === 30 && day(pOt, D).blocks[0].flags.indexOf('late') >= 0, pOt.sum);
  t('月給: その月は遅刻早退の控除なし（前は 1744×30÷60＝872円）', L(run(MONTHLY, att(snap({ punches: [PU(D, 'in', '9:30'), PU(D, 'out', '18:30')], days: [{ staff_id: 'x', work_date: D, overtime_ok: true }] }))), 'late') === undefined);
  const pOt2 = mon({ punches: [PU(D, 'in', '9:30'), PU(D, 'out', '18:20')], days: [{ staff_id: 'x', work_date: D, overtime_ok: true }] });
  t('境目: 30分遅刻＋残業を認めて 18:20 退勤（実働470分）は遅刻 10分・1回', pOt2.sum.lateMin === 10 && pOt2.sum.lateCount === 1, pOt2.sum);
  const pNo = mon({ punches: [PU(D, 'in', '9:30'), PU(D, 'out', '18:30')] });
  t('残業を認めない日は今のまま遅刻 30分（18時で切る＝実働450分）', pNo.sum.lateMin === 30 && pNo.sum.lateCount === 1, pNo.sum);
  const pBoth = mon({ punches: [PU(D, 'in', '9:30'), PU(D, 'out', '17:00')] });
  t('遅刻30分＋早退60分（実働390分・足りない90分）は今のまま 遅刻30分・早退60分', pBoth.sum.lateMin === 30 && pBoth.sum.earlyLeaveMin === 60, pBoth.sum);
}

console.log('\n— 2. 半日有休の日の早退・遅刻 —');
{
  const lu = [{ id: 'u', staff_id: 'x', use_date: D, days: 0.5 }];
  const am = mon({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '13:00')], leave_uses: lu });
  t('手入力の半日有休＋午前だけ（9〜13時）: 早退 0分・0回（前は 300分）・有休 240分・0.5日', am.sum.earlyLeaveMin === 0 && am.sum.earlyLeaveCount === 0 && am.sum.paidMin === 240 && am.sum.paidDays === 0.5 && day(am, D).hourlyOffsetMin === 300, am.sum);
  const pm = mon({ punches: [PU(D, 'in', '13:00'), PU(D, 'out', '18:00')], leave_uses: lu });
  t('手入力の半日有休（午前）＋午後勤務（13〜18時）: 遅刻 0分・0回（前は 240分）', pm.sum.lateMin === 0 && pm.sum.lateCount === 0, pm.sum);
  const pm2 = mon({ punches: [PU(D, 'in', '14:30'), PU(D, 'out', '18:00')], leave_uses: lu });
  t('境目: 半日有休＋14:30 出勤（実働210分＋有休240分で足りない30分）: 遅刻 30分・1回（時計は330分）', pm2.sum.lateMin === 30 && pm2.sum.lateCount === 1, pm2.sum);
  /* シフトのマス「有 13-18」は有休の行と 13〜18時の勤務の行になる（遅刻は 13時から数える）。有休の分を引くと本当の遅刻が消えるので引かない（仮置き） */
  const Sym = require(path.join(ROOT, 'shift-symbols.js'));
  const sh = KC.buildSchedule({ ym: '2026-12', plan: { cells: { x: { 1: '有 13-18' } } }, nextPlan: {}, staff: [{ id: 'x', name: '試験 甲', mainDivision: '施設', active: true }], symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
  t('シフトのマス「有 13-18」は有休の行と 13〜18時の勤務の行', sh.length === 2 && sh.some((r) => r.kind === 'paid') && sh.some((r) => r.kind === 'work' && r.start_at === KC.iso(at(D, '13:00'))), sh);
  const sp0 = mon({ schedule: sh, punches: [PU(D, 'in', '13:00'), PU(D, 'out', '18:00')] }), sp1 = mon({ schedule: sh, punches: [PU(D, 'in', '13:30'), PU(D, 'out', '18:00')] });
  t('シフトの「有 13-18」で 13:00 出勤は遅刻 0分・13:30 出勤は遅刻 30分のまま（有休の分で消さない・今と同じ）', sp0.sum.lateMin === 0 && sp1.sum.lateMin === 30 && sp1.sum.lateCount === 1, [sp0.sum.lateMin, sp1.sum.lateMin]);
  const r = snap({ punches: [PU(D, 'in', '13:00'), PU(D, 'out', '18:00')], leave_uses: lu });
  t('月給: 半日有休＋午後勤務の月は遅刻早退の控除なし（前は 1744×240÷60＝6976円）', L(run(MONTHLY, att(r)), 'late') === undefined && run(MONTHLY, att(r)).gross === 300000, run(MONTHLY, att(r)).lines.filter((l) => l.sec === 'pay'));
}

console.log('\n— 4. 時給の人の有休を1日の所定時間で払う（予定の無い日の有休だけ）—');
{
  /* 反証レビュー（2026-11-21・高）で直した: 1日の所定時間で置き換えるのは予定の無い日の有休（paidNoSchedDays・paidNoSchedMin）だけ。予定のある日の有休はその日の予定の実働のまま。
     下の材料は予定の無い日に有休1日（勤怠が480分と数えた日）の形。前の版（25ae641）は予定のある日の有休まで置き換えていた */
  const base = { workDays: 0, paidDays: 1, paidMin: 480, workMin: 0, schedInMin: 0, schedDays: 1, paidNoSchedDays: 1, paidNoSchedMin: 480 };
  const h1 = run(HOURLY4, Object.assign({}, base));
  t('1日4時間の時給1100円のパートの予定の無い日の有休1日: 基本給 4400円（前は8時間分の 8800円）・警告なし', L(h1, 'basic') === 4400 && !W(h1, 'day_hours_missing'), [L(h1, 'basic'), h1.warnings]);
  t('根拠の文は式に合わせる（予定の無い日の有休1日×1日の所定時間4時間）', /予定の無い日の有休1日×1日の所定時間4時間/.test(LN(h1, 'basic').basis) && LN(h1, 'basic').qty === 240, LN(h1, 'basic'));
  const h2 = run(HOURLY4, Object.assign({}, base, { schedInMin: 1200, paidDays: 2, paidMin: 480 + 480 + 60, hourlyPaidEffMin: 60, hourlyPaidMin: 60 }));
  t('所定内1200分＋予定のある日の有休480分＋時間単位60分＋予定の無い日の有休1日: 1100×(1200＋540＋240)÷60＝36300円（前は 1100×2220÷60＝40700円）', L(h2, 'basic') === 36300, L(h2, 'basic'));
  const h3 = run(HOURLY4, Object.assign({}, base, { paidDays: 0.5, paidMin: 240, paidNoSchedDays: 0.5, paidNoSchedMin: 240 }));
  t('予定の無い日の半日の有休（0.5日）: 1100×120÷60＝2200円', L(h3, 'basic') === 2200, L(h3, 'basic'));
  const h4 = run(HOURLY_NODH, Object.assign({}, base));
  t('1日の所定時間が空: 今の値のまま 8800円・警告 day_hours_missing', L(h4, 'basic') === 8800 && W(h4, 'day_hours_missing'), [L(h4, 'basic'), h4.warnings]);
  const h4b = run(HOURLY4, Object.assign({}, base, { paidNoSchedDays: undefined, paidNoSchedMin: undefined }));
  t('鍵の無い古い控え: 今までどおり paidMin で 8800円', L(h4b, 'basic') === 8800 && !W(h4b, 'day_hours_missing'), L(h4b, 'basic'));
  const h4c = run(HOURLY4, Object.assign({}, base, { paidNoSchedDays: 0, paidNoSchedMin: 0 }));
  t('予定のある日の有休1日（予定の無い日の有休0日）: 今までどおり 480分の 8800円', L(h4c, 'basic') === 8800, L(h4c, 'basic'));
  const h5 = run(HOURLY_NODH, Object.assign({}, base, { paidDays: 0, paidMin: 0, schedInMin: 600, paidNoSchedDays: 0, paidNoSchedMin: 0 }));
  t('有休の無い月は1日の所定時間が空でも警告を足さない（今のまま）', L(h5, 'basic') === 11000 && !W(h5, 'day_hours_missing'));
  const h6 = run(HOURLY4, Object.assign({}, base, { paidDays: 0, paidMin: 120, hourlyPaidEffMin: 120, hourlyPaidMin: 120, schedInMin: 600, paidNoSchedDays: 0, paidNoSchedMin: 0 }));
  t('時間単位の有休だけの月は今のまま（1100×720÷60＝13200円）', L(h6, 'basic') === 13200 && /所定内＋有休/.test(LN(h6, 'basic').basis), L(h6, 'basic'));
  /* 勤怠の計算から: 所定4時間の人が予定 9〜18時の日に有休1日 → 480分のまま／予定の無い日に有休1日 → 240分 */
  const onSched = snap({ schedule: [S9(D)], leave_uses: [{ id: 'u1', staff_id: 'x', use_date: D, days: 1 }] });
  const offSched = snap({ schedule: [S9(D)], leave_uses: [{ id: 'u2', staff_id: 'x', use_date: D2, days: 1 }] });
  t('勤怠: 予定のある日の有休は予定の無い日の有休に数えない・予定の無い日は1日・480分', onSched.paidNoSchedDays === 0 && offSched.paidNoSchedDays === 1 && offSched.paidNoSchedMin === 480, [onSched.paidNoSchedDays, offSched.paidNoSchedDays, offSched.paidNoSchedMin]);
  const sOn = run(HOURLY4, att(onSched)), sOff = run(HOURLY4, att(offSched));
  t('時給: 予定 9〜18時の日の有休1日は 480分（8800円のまま）・予定の無い日の有休1日は 240分（4400円）', LN(sOn, 'basic').qty === 480 && L(sOn, 'basic') === 8800 && LN(sOff, 'basic').qty === 240 && L(sOff, 'basic') === 4400, [LN(sOn, 'basic'), LN(sOff, 'basic')]);
  t('受け口: 控えの有休日数は半日きざみのまま（0.5 → 0.5）', attFrom({ paidDays: 0.5 }).paidDays === 0.5 && attFrom({ paidDays: 2 }).paidDays === 2);
  const dl = run(DAILY, Object.assign({}, base, { workDays: 3, paidDays: 0.5, paidMin: 240 }));
  t('日給の半日有休は日給×0.5日＝5000円（鍵の無い古い控えの道・2026-11-21・前は整数に丸めて 10000円）・1日は10000円・1.5日は15000円', L(dl, 'paid_leave') === 5000 && L(run(DAILY, Object.assign({}, base, { workDays: 3 })), 'paid_leave') === 10000 && L(run(DAILY, Object.assign({}, base, { workDays: 3, paidDays: 1.5, paidMin: 720 })), 'paid_leave') === 15000, L(dl, 'paid_leave'));
  /* 反証レビュー（2026-11-21）: 日給は働いていない日の有休（paidOffDays）だけ払う */
  t('日給: 働いた日の半日有休は上乗せしない（paidOffDays 0）・働いていない日の半日有休は 5000円', L(run(DAILY, Object.assign({}, base, { workDays: 3, paidDays: 0.5, paidMin: 240, paidOffDays: 0 })), 'paid_leave') === undefined && L(run(DAILY, Object.assign({}, base, { workDays: 3, paidDays: 1.5, paidMin: 720, paidOffDays: 0.5 })), 'paid_leave') === 5000);
}

console.log('\n— 5. 日給の人の法定休日の労働 —');
{
  const cfg = { legal_holiday: 0 };   /* 日曜が法定休日 */
  const o = { schedule: [S9(D)], punches: [PU(D, 'in', '9:00'), PU(D, 'out', '18:00'), PU(SUN, 'in', '9:00'), PU(SUN, 'out', '18:00')], config: cfg };
  const p = mon(o), r = snap(o);
  t('勤怠: 出勤2日・法定休日に働いた日 1日・法定休日の実働 480分', p.sum.workDays === 2 && p.sum.holidayWorkDays === 1 && p.sum.holidayMin === 480 && r.holidayWorkDays === 1, p.sum);
  const it = run(DAILY, att(r));
  t('日給: 基本給は 10000×1日（法定休日の1日を除く・前は2日の 20000円）・休日労働 1250×1.35×480÷60＝13500円・警告なし', L(it, 'basic') === 10000 && L(it, 'ot_holiday') === 13500 && !W(it, 'holiday_days_unknown'), it.lines.filter((l) => l.sec === 'pay'));
  const old = Object.assign({}, r); delete old.holidayWorkDays;
  const it0 = run(DAILY, att(old));
  t('古い控え（holidayWorkDays が無い）: 今と同じ 基本給 20000円・警告 holiday_days_unknown', L(it0, 'basic') === 20000 && W(it0, 'holiday_days_unknown'), it0.lines.filter((l) => l.sec === 'pay'));
  const n = mon({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '18:00')], config: cfg });
  t('法定休日に働かない月は 0日（基本給は今と同じ 10000円）', n.sum.holidayWorkDays === 0 && L(run(DAILY, att(snap({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '18:00')], config: cfg }))), 'basic') === 10000);
  t('法定休日の設定が無い月は 0日', mon(Object.assign({}, o, { config: {} })).sum.holidayWorkDays === 0);
}

console.log('\n— 1. 予定の無い勤務のある月給の人の警告 —');
{
  const o = { punches: [PU(D, 'in', '9:00'), PU(D, 'out', '18:00'), PU(D2, 'in', '9:00'), PU(D2, 'out', '13:00')] };   /* 12/2 は予定なし */
  const p = mon(o), r = snap(o);
  t('勤怠: 予定の無い勤務の実働 240分（数え方は今のまま＝予定を超えた分 240分）', p.sum.noSchedWorkMin === 240 && r.noSchedWorkMin === 240 && p.sum.overtimeMin === 240, p.sum);
  const it = run(MONTHLY, att(r));
  t('月給: 警告 no_sched_monthly（文に分を入れる）・基本給と法定内残業の額は今のまま', W(it, 'no_sched_monthly') && /予定の無い勤務が240分あり、全部を残業として数えています。勤怠の「職員と番号」で固定時間の前提を入れてください/.test(it.warnings.find((w) => w.code === 'no_sched_monthly').msg) && L(it, 'basic') === 300000 && L(it, 'ot_in') > 0, it.warnings);
  const ck = snap(Object.assign({}, o, { days: [{ staff_id: 'x', work_date: D2, day_mark: 'checked' }] }));
  t('勤怠で「確認済み」にしても給与の警告は消えない', ck.noSchedWorkMin === 240 && W(run(MONTHLY, att(ck)), 'no_sched_monthly'));
  t('時給・日給には出さない', !W(run(HOURLY4, att(r)), 'no_sched_monthly') && !W(run(DAILY, att(r)), 'no_sched_monthly'));
  const ok = snap({ punches: [PU(D, 'in', '9:00'), PU(D, 'out', '18:00')] });
  t('予定どおりの月（0分）は出さない', ok.noSchedWorkMin === 0 && !W(run(MONTHLY, att(ok)), 'no_sched_monthly'));
  const old = Object.assign({}, r); delete old.noSchedWorkMin;
  t('古い控え（noSchedWorkMin が無い）は出さない（今のまま）', !W(run(MONTHLY, att(old)), 'no_sched_monthly') && attFrom(old).noSchedWorkMin === undefined);
}

console.log('\n— 控えの比べ（勤怠の画面） —');
{
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  const keys = (K.match(/var SNAP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
  t('締めた時の控えと今の数字を比べる鍵に noSchedWorkMin・holidayWorkDays がある（無い控えは比べない）', /'noSchedWorkMin'/.test(keys) && /'holidayWorkDays'/.test(keys));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
