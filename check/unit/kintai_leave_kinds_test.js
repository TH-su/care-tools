/* 勤怠の休暇の種類を足した分・休業の期間・エラー勤務の残り3種・振替の知らせ（kintai-leave-kinds.js）の試験（2026-11-25 新設・段B）
   実行: node check/unit/kintai_leave_kinds_test.js
   守りたいこと:
     1. 種類の表（8種類・名前・単位）と入れる時の形の確かめ（DB 0131 の kintai_absence_add と同じ決まり）
     2. 月の計算（computeMonth）と締めの控え（snapshotOf）は、足した種類の行と休業の期間を渡しても渡さなくても1字も変わらない（給与の数え直しが今のまま一致する）
     3. 予定も実績も無い（在籍の人だけ・休業の期間の人は出さない）
     4. 休暇の残り不足（子の看護等休暇・介護休暇の1年 5日／設定で10日・4月1日で切り替わる・時間単位は1日の時間で日数に直す・有給の付与の無い使用）
     5. 休業中の勤務（期間の中の打刻・1日の休暇の日の打刻）・締めた月分は締めた時にあった期間だけ
     6. 振替の知らせ（法定休日に働いた日に振替・代休が無い・振替の休む日が別の月分）・法定休日を決めていない時は出さない
     7. 期間の一覧と入れる時の確かめ（重なり・長さ・種類）
   ★職員は架空（試験 甲・試験 乙・試験 丙）。 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'kintai-calc.js'));
const K = require(path.join(ROOT, 'kintai-leave-kinds.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const YM = '2026-12';
const NOW = Date.parse('2027-01-10T12:00:00+09:00');
const STAFF = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }, { staff_id: 'sT02', name: '試験 乙', office: 'visit', emp_code: '9002' },
  { staff_id: 'sT03', name: '試験 丙', office: 'facility', emp_code: '9003' }, { staff_id: 'sT04', name: '試験 丁', office: 'facility', emp_code: '9004', active: false }];
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(Date.parse(iso(d, hm))).toISOString(), source: 'tablet', created_at: new Date(Date.parse(iso(d, hm))).toISOString() });
const W = (sid, d) => ({ staff_id: sid, work_date: d, kind: 'work', start_at: iso(d, '09:00'), end_at: iso(d, '18:00'), break_min: 60, paid_min: 0, office: 'facility', symbol: '日' });
function month(o) { return C.computeMonth(Object.assign({ ym: YM, staff: STAFF, schedule: [], punches: [], days: [], config: { closeDay: 0 }, now: NOW }, o || {})); }

console.log('\n— 1. 種類の表と形の確かめ —');
{
  t('8種類（子の看護等休暇・介護休暇・産前産後・育休・産後パパ育休・介護休業・公休・労災の休業）', K.KINDS.map((k) => k.code).join() === 'child_care,family_care,maternity,childcare,papa,care_leave,public_off,injury');
  t('今の4種類（kintai-calc.js の ABS_KINDS）と重ならない', K.KINDS.every((k) => C.ABS_KINDS.indexOf(k.code) < 0));
  t('期間で持つのは5種類（公休・子の看護・介護休暇は持たない）', K.TERM_KINDS.join() === 'maternity,childcare,papa,care_leave,injury');
  t('1日（分なし）は全部の種類で通る', K.KINDS.every((k) => K.checkAdd({ kind: k.code, minutes: null }, 480) === null));
  t('子の看護等休暇・介護休暇は1時間単位で1日の時間まで', K.checkAdd({ kind: 'child_care', minutes: 60 }, 480) === null && K.checkAdd({ kind: 'family_care', minutes: 480 }, 480) === null &&
    K.checkAdd({ kind: 'child_care', minutes: 90 }, 480) === 'badvalue' && K.checkAdd({ kind: 'child_care', minutes: 540 }, 480) === 'badvalue' && K.checkAdd({ kind: 'child_care', minutes: 0 }, 480) === 'badvalue');
  t('1日単位の種類に分は入らない・有給・種類の印・結ぶ日は入らない・知らない種類は badkind',
    K.checkAdd({ kind: 'childcare', minutes: 240 }, 480) === 'badvalue' && K.checkAdd({ kind: 'public_off', paid: true }, 480) === 'badvalue' &&
    K.checkAdd({ kind: 'injury', type_code: 'x' }, 480) === 'badvalue' && K.checkAdd({ kind: 'papa', link_date: '2026-12-01' }, 480) === 'badvalue' && K.checkAdd({ kind: 'special' }, 480) === 'badkind');
  t('1年の上限は既定5日・設定で10日・ほかの値は5日・上限の無い種類は null', K.capOf({}, 'child_care') === 5 && K.capOf({ familyCareDays: 10 }, 'family_care') === 10 &&
    K.capOf({ childCareDays: 7 }, 'child_care') === 5 && K.capOf({}, 'papa') === null);
  t('1年は4月1日から（既定）', JSON.stringify(K.yearOf('2026-03-31', {})) === '{"from":"2025-04-01","to":"2026-03-31"}' && JSON.stringify(K.yearOf('2026-04-01', {})) === '{"from":"2026-04-01","to":"2027-03-31"}');
}

console.log('\n— 2. 月の計算と締めの控えは変わらない —');
{
  const sched = [W('sT01', '2026-12-01'), W('sT01', '2026-12-02'), W('sT02', '2026-12-01')];
  const pun = [P('sT01', 'in', '2026-12-01', '09:00'), P('sT01', 'out', '2026-12-01', '18:00')];
  const oldAbs = [{ id: 'a1', staff_id: 'sT02', date: '2026-12-03', kind: 'comp', minutes: null, paid: false, link_date: '2026-11-29' }];
  const newAbs = oldAbs.concat([{ id: 'a2', staff_id: 'sT01', date: '2026-12-02', kind: 'childcare', minutes: null, paid: false },
    { id: 'a3', staff_id: 'sT02', date: '2026-12-01', kind: 'child_care', minutes: 120, paid: false }, { id: 'a4', staff_id: 'sT03', date: '2026-12-05', kind: 'public_off', minutes: null, paid: false }]);
  const m0 = month({ schedule: sched, punches: pun, absences: oldAbs }), m1 = month({ schedule: sched, punches: pun, absences: newAbs });
  t('computeMonth の結果が同じ（足した種類の行は読み飛ばす）', JSON.stringify(m0) === JSON.stringify(m1));
  t('締めの控え（snapshotOf）が同じ＝給与の数え直しの照合は今のまま', JSON.stringify(C.snapshotOf(m0)) === JSON.stringify(C.snapshotOf(m1)));
  t('予定のある日の育休は今までどおり「打刻なし」の要確認（事務所が欠勤にすれば欠勤）', m1.people[0].days.filter((d) => d.date === '2026-12-02')[0].flags.indexOf('no_punch') >= 0);
  const r = K.checkMonth({ month: m1, absences: newAbs, yearAbs: [], terms: [], config: {} });
  t('checkMonth は month を書き換えない', JSON.stringify(m1) === JSON.stringify(m0));
  t('kintai-calc.js の中身は変えていない（ABS_KINDS は今の4種類のまま）', C.ABS_KINDS.join() === 'hourly_paid,special,comp,swap' && Array.isArray(r.review));
}

console.log('\n— 3. 予定も実績も無い —');
{
  const m = month({ schedule: [W('sT01', '2026-12-01')], punches: [P('sT02', 'in', '2026-12-02', '09:00'), P('sT02', 'out', '2026-12-02', '17:00')] });
  const r = K.checkMonth({ month: m, absences: [], yearAbs: [], terms: [], config: {} });
  const none = r.review.filter((x) => x.code === 'none_day').map((x) => x.staff_id);
  t('予定がある人・打刻がある人は出さない・何も無い在籍の人だけ出す・在籍でない人は出さない', none.join() === 'sT03', none);
  const r2 = K.checkMonth({ month: m, absences: [{ staff_id: 'sT03', date: '2026-12-10', kind: 'public_off' }], yearAbs: [], terms: [], config: {} });
  t('休暇（足した種類も）が1つでもあれば出さない', !r2.review.some((x) => x.code === 'none_day'));
  const r3 = K.checkMonth({ month: m, absences: [], yearAbs: [], terms: [{ id: 'x', staff_id: 'sT03', kind: 'childcare', date_from: '2026-04-01', date_to: '2027-03-31' }], config: {} });
  t('休業の期間が月分にかかる人は出さない', !r3.review.some((x) => x.code === 'none_day'));
  const r4 = K.checkMonth({ month: m, absences: [{ staff_id: 'sT03', date: '2026-12-10', kind: 'child_care', voided_at: '2026-12-11T00:00:00Z' }], yearAbs: [], terms: [], config: {} });
  t('取り消した休暇は数えない（出す）', r4.review.some((x) => x.code === 'none_day' && x.staff_id === 'sT03'));
}

console.log('\n— 4. 休暇の残り不足 —');
{
  const m = month({ schedule: [W('sT01', '2026-12-01'), W('sT02', '2026-12-01'), W('sT03', '2026-12-01')] });
  const mk = (sid, d, kind, mins) => ({ id: sid + d + kind, staff_id: sid, date: d, kind, minutes: mins == null ? null : mins });
  const yearAbs = [mk('sT01', '2026-05-01', 'child_care'), mk('sT01', '2026-06-01', 'child_care'), mk('sT01', '2026-07-01', 'child_care'), mk('sT01', '2026-08-01', 'child_care'),
    mk('sT01', '2026-12-03', 'child_care', 240), mk('sT01', '2026-12-04', 'child_care', 240), mk('sT01', '2026-12-07', 'child_care'),
    mk('sT02', '2026-03-01', 'family_care'), mk('sT02', '2026-03-02', 'family_care'), mk('sT02', '2026-03-03', 'family_care'), mk('sT02', '2026-03-04', 'family_care'), mk('sT02', '2026-03-05', 'family_care'),
    mk('sT02', '2026-12-08', 'family_care')];
  const r = K.checkMonth({ month: m, absences: [], yearAbs: yearAbs, terms: [], config: {} });
  const sh = r.review.filter((x) => x.code === 'leave_short');
  t('5日を超えた日だけ出す（4日＋半日×2＝5日ちょうどは出さず、次の1日で出す）', sh.filter((x) => x.staff_id === 'sT01').map((x) => x.date).join() === '2026-12-07', sh);
  t('前の年（3月まで）の使用は4月で切り替わる', !sh.some((x) => x.staff_id === 'sT02'));
  const r10 = K.checkMonth({ month: m, absences: [], yearAbs: yearAbs, terms: [], config: { childCareDays: 10 } });
  t('設定で10日にすると出さない', !r10.review.some((x) => x.code === 'leave_short'));
  const rDay = K.checkMonth({ month: m, absences: [], yearAbs: yearAbs, terms: [], config: {}, dayMin: { sT01: 240 } });
  t('時間単位は1日の時間で日数に直す（1日4時間の人は4時間＝1日）', rDay.review.filter((x) => x.code === 'leave_short' && x.staff_id === 'sT01').map((x) => x.date).join() === '2026-12-04,2026-12-07');
  const rP = K.checkMonth({ month: m, absences: [], yearAbs: [], terms: [], config: {}, paidOver: { sT03: 1.5 } });
  t('有給の付与の無い使用がある人は出す', rP.review.some((x) => x.code === 'leave_short' && x.staff_id === 'sT03' && /1\.5 日/.test(x.text)));
  const rN = K.checkMonth({ month: m, absences: [], yearAbs: null, terms: [], config: {} });
  t('1年分を読めない時は子の看護等休暇・介護休暇を確かめない（yearOk false）', rN.yearOk === false && !rN.review.some((x) => x.code === 'leave_short'));
}

console.log('\n— 5. 休業中の勤務 —');
{
  const pun = [P('sT01', 'in', '2026-12-10', '09:00'), P('sT01', 'out', '2026-12-10', '12:00'), P('sT02', 'in', '2026-12-11', '09:00'), P('sT02', 'out', '2026-12-11', '12:00'),
    P('sT03', 'in', '2026-12-12', '09:00'), P('sT03', 'out', '2026-12-12', '12:00')];
  const m = month({ punches: pun });
  const terms = [{ id: 'T1', staff_id: 'sT01', kind: 'childcare', date_from: '2026-12-01', date_to: '2027-03-31', created_at: '2026-11-20T00:00:00Z' },
    { id: 'T2', staff_id: 'sT03', kind: 'care_leave', date_from: '2026-12-13', date_to: '2026-12-31', created_at: '2026-11-20T00:00:00Z' }];
  const abs = [{ id: 'b1', staff_id: 'sT02', date: '2026-12-11', kind: 'public_off', minutes: null }];
  const r = K.checkMonth({ month: m, absences: abs, yearAbs: [], terms: terms, config: {} });
  const tw = r.review.filter((x) => x.code === 'term_work');
  t('期間の中の日の打刻を出す・期間の外の日は出さない', tw.some((x) => x.staff_id === 'sT01' && x.date === '2026-12-10') && !tw.some((x) => x.staff_id === 'sT03'), tw);
  t('1日の休暇（足した種類）の日の打刻を出す', tw.some((x) => x.staff_id === 'sT02' && x.date === '2026-12-11'));
  const lockAt = '2026-11-25T00:00:00Z';
  const later = [{ id: 'T3', staff_id: 'sT01', kind: 'childcare', date_from: '2026-12-01', date_to: '2027-03-31', created_at: '2026-12-20T00:00:00Z' }];
  const rl = K.checkMonth({ month: m, absences: [], yearAbs: [], terms: later, config: {}, lockedAt: lockAt });
  t('締めた月分は、締めた後に足した期間を使わない', !rl.review.some((x) => x.code === 'term_work'));
  const voidedLater = [{ id: 'T4', staff_id: 'sT01', kind: 'childcare', date_from: '2026-12-01', date_to: '2027-03-31', created_at: '2026-11-20T00:00:00Z', voided_at: '2026-12-20T00:00:00Z' }];
  t('締めた月分は、締めた後に取り消した期間を締めた時のまま使う', K.checkMonth({ month: m, absences: [], yearAbs: [], terms: voidedLater, config: {}, lockedAt: lockAt }).review.some((x) => x.code === 'term_work'));
  t('締めていない月分は取り消した期間を使わない', !K.checkMonth({ month: m, absences: [], yearAbs: [], terms: voidedLater, config: {} }).review.some((x) => x.code === 'term_work'));
}

console.log('\n— 6. 振替休日の知らせ —');
{
  /* 2026-12-06 は日曜。法定休日＝日曜 */
  const pun = [P('sT01', 'in', '2026-12-06', '09:00'), P('sT01', 'out', '2026-12-06', '18:00'), P('sT02', 'in', '2026-12-06', '09:00'), P('sT02', 'out', '2026-12-06', '18:00')];
  const sched = [W('sT01', '2026-12-06'), W('sT02', '2026-12-06')];
  const cfg = { closeDay: 0, legal_holiday: 0 };
  const m = month({ schedule: sched, punches: pun, config: cfg });
  const abs = [{ id: 'c1', staff_id: 'sT02', date: '2026-12-09', kind: 'comp', minutes: null, link_date: '2026-12-06' }];
  const r = K.checkMonth({ month: m, absences: abs, yearAbs: [], terms: [], config: cfg });
  t('法定休日に働いて振替・代休の無い人だけ出す', r.notice.filter((x) => x.code === 'no_swap').map((x) => x.staff_id).join() === 'sT01', r.notice);
  const sw = [{ id: 's1', staff_id: 'sT03', date: '2027-01-05', kind: 'swap', link_date: '2026-12-20' }];
  const r2 = K.checkMonth({ month: month({ config: cfg }), absences: sw, yearAbs: [], terms: [], config: cfg });
  t('振替の働く日がこの月分で、休む日が別の月分なら出す', r2.notice.some((x) => x.code === 'swap_out' && x.date === '2026-12-20'));
  const r3 = K.checkMonth({ month: month({ schedule: sched, punches: pun }), absences: [], yearAbs: [], terms: [], config: { closeDay: 0 } });
  t('法定休日を決めていない時は no_swap を出さない（legalHoliday false）', r3.legalHoliday === false && !r3.notice.some((x) => x.code === 'no_swap'));
}

console.log('\n— 7. 期間の一覧と入れる時の確かめ —');
{
  const ex = [{ id: 'T1', staff_id: 'sT01', kind: 'childcare', date_from: '2026-04-01', date_to: '2026-09-30' }, { id: 'T0', staff_id: 'sT01', kind: 'papa', date_from: '2026-01-01', date_to: '2026-01-10', voided_at: 'x' }];
  t('重なれば overlap・次の日からは通る・別の種類は重なってよい・取り消した期間とは重なってよい',
    K.checkTerm({ staff_id: 'sT01', kind: 'childcare', date_from: '2026-09-30', date_to: '2026-10-31' }, ex) === 'overlap' &&
    K.checkTerm({ staff_id: 'sT01', kind: 'childcare', date_from: '2026-10-01', date_to: '2026-10-31' }, ex) === null &&
    K.checkTerm({ staff_id: 'sT01', kind: 'papa', date_from: '2026-04-10', date_to: '2026-04-20' }, ex) === null &&
    K.checkTerm({ staff_id: 'sT01', kind: 'papa', date_from: '2026-01-01', date_to: '2026-01-10' }, ex) === null);
  t('終わりが前・長すぎ（1098日）・種類違い・メモ201字は断る（DB 0131 と同じ）',
    K.checkTerm({ staff_id: 'sT01', kind: 'papa', date_from: '2026-02-10', date_to: '2026-02-01' }, []) === 'baddate' &&
    K.checkTerm({ staff_id: 'sT01', kind: 'childcare', date_from: '2023-01-01', date_to: '2026-01-03' }, []) === 'baddate' &&
    K.checkTerm({ staff_id: 'sT01', kind: 'childcare', date_from: '2023-01-01', date_to: '2026-01-02' }, []) === null &&
    K.checkTerm({ staff_id: 'sT01', kind: 'public_off', date_from: '2026-02-01', date_to: '2026-02-02' }, []) === 'badkind' &&
    K.checkTerm({ staff_id: 'sT01', kind: 'papa', date_from: '2026-02-01', date_to: '2026-02-02', note: 'a'.repeat(201) }, []) === 'badvalue');
  const L = K.termList(ex.concat([{ id: 'T2', staff_id: 'sT02', kind: 'care_leave', date_from: '2026-12-01', date_to: '2026-12-31' }]), '2026-11-25');
  t('一覧は取り消していない期間だけ・新しい順・日数・今の状態', L.map((x) => x.id + ':' + x.state + ':' + x.days).join() === 'T2:future:31,T1:past:183');
}

console.log('\n— 8. 画面への読み込みと公開の許可 —');
{
  const H = fs.readFileSync(path.join(ROOT, 'kintai.html'), 'utf8'), G = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), J = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  t('kintai-calc.js の後・kintai.js の前で読む', H.indexOf('kintai-leave-kinds.js?v=') > H.indexOf('kintai-calc.js?v=') && H.indexOf('kintai-leave-kinds.js?v=') < H.indexOf('kintai.js?v='));
  t('公開の許可（.gitignore）', /^!\/kintai-leave-kinds\.js$/m.test(G));
  t('給与の画面は読まない（給与の数え方に入らない）', fs.readFileSync(path.join(ROOT, 'payroll.html'), 'utf8').indexOf('kintai-leave-kinds.js') < 0);
  t('管理画面は月の計算に足した種類を渡さない（computeMonth の呼び方は今のまま）', !/computeMonth\([^)]*leave_terms/.test(J) && J.indexOf("rpc('kintai_leave_extra_get'") > 0);
  t('DB に関数が無い時は「準備中」と出す', /noDb\(e\)\) \{ lkSt = \{ ym: atYm, noDb: true/.test(J) && J.indexOf('データベースの準備中') > 0);
}

console.log('\n' + (fail ? '✗ ' + fail + ' 件 失敗 / ' : '✓ ') + pass + ' 件 合格');
process.exit(fail ? 1 : 0);
