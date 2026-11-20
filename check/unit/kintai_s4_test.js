/* 勤怠 v5 段4（休暇の種類と丸めの単位）の試験（2026-11-20 契約 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md「段4」・統合 0113）
   実行: node check/unit/kintai_s4_test.js
   守りたいこと:
     1. 休暇の種類を使わない時（absences なし・空・期間の外・取り消した行・丸めの単位1）は、月の結果が今と1バイトも変わらない
        （paidDays・paidMin・workMin・legalOverMin・holidayMin など全部）。締めた月を締めた時の設定で数え直すと、控えの前からある鍵が同じ
     2. 時間単位の有休: 分を paidMin に足す（給与へ今の鍵で渡る）・paidDays と所定日数は変えない・hourlyPaidMin・締めの控えに入る
     3. 特別休暇（有給は specialPaidMin・specialPaidDays／無給は specialUnpaidDays）・代休（compDays）。1日の休みの日は打刻なしにしない・半日はそのまま
     4. 振替休日: 休む日の勤務の予定を数えない（欠勤・打刻なしに出さない・所定日数に入れない）・法定休日の曜日の日と入れ替えると、
        法定休日の判定は入れ替えた後の日で数える（働く日は休日労働にならず、休む日が法定休日）
     5. 丸めの単位: 働いた人に有利な向きだけ（遅刻の出勤は切り捨て・早退の退勤と認めた残業の終わりは切り上げ・認めた時刻を超えない）。
        認めていない早出・残業・予定の無い勤務は丸めない。単位1は今と同じ
     6. 設定（fillConfig）: roundUnitMin は 1・5・10・15・30 だけ・dayHours は1〜24 の時間に切り上げ・hourlyPaidLeave は真偽・
        leaveTypes は確かめた行だけを写す（無い時は鍵を作らない）・36協定の設定と一緒でも落とさない
     7. 有給の残り（kintai-leave.js）: 時間単位を1日＝所定の時間で引く・年5日の取得義務に数えない・時間単位が無い時は今と同じ・年の上限（5日分）・日数の文字
     8. 年次有給休暇管理簿（kintai-ledger.js）: 時間単位は同じ日の1日・半日と別の行・取得日数に入れず時間の列に数える
     9. 画面（kintai.js・kintai.html）: 月の計算に absences を渡す・休暇の断りの語の文・直しの履歴の言い方・設定の欄・管理簿の印刷（su-print の門）・部品の読み込み
    10. 積み残しの直し: ホームの箱の期限の近い残りを有給の画面と同じ書き方に・締めの比べる鍵に休暇の種類の鍵（古い控えは比べない）・振替の働く日に予定が無い時の注意（止めない・A＝予定は手で入れる・仮置き）
   ★職員は架空（試験 甲・試験 乙）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'kintai-calc.js'));
const L = require(path.join(ROOT, 'kintai-leave.js'));
const G = require(path.join(ROOT, 'kintai-ledger.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

const YM = '2026-12';
const NOW = Date.parse('2027-01-10T12:00:00+09:00');
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() });
const S = (sid, d, s0, e0, br, sym) => ({ staff_id: sid, work_date: d, seq: 1, office: 'facility', kind: 'work', start_at: C.iso(at(d, s0)), end_at: C.iso(at(d, e0)), break_min: br == null ? 60 : br, paid_min: 0, symbol: sym || '日' });
const K_STAFF = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }, { staff_id: 'sT02', name: '試験 乙', office: 'facility', emp_code: '9002' }];
const ds = (d) => '2026-12-' + String(d).padStart(2, '0');
const dow = (d) => new Date(Date.UTC(2026, 11, d)).getUTCDay();
/* 架空の月: 甲は平日 9:00〜18:00（休憩60分）で打刻はばらつく・乙は平日 7:00〜16:00 で毎日きっちり。12/13（日）に甲が休日に働く */
const sched = [], pun = [], days = [];
for (let d = 1; d <= 31; d++) {
  const w = dow(d);
  if (w === 0 || w === 6) continue;
  sched.push(S('sT01', ds(d), '9:00', '18:00'), S('sT02', ds(d), '7:00', '16:00'));
  if (d === 18) continue;   /* 甲の 12/18 は打刻なし（欠勤か打刻漏れ） */
  pun.push(P('sT01', 'in', ds(d), d % 3 ? '8:50' : '9:07'), P('sT01', 'out', ds(d), d % 4 ? '18:20' : '17:50'));
  pun.push(P('sT02', 'in', ds(d), '7:00'), P('sT02', 'out', ds(d), '16:00'));
  if (d % 5 === 0) days.push({ staff_id: 'sT01', work_date: ds(d), overtime_ok: true, rev: 1 });
}
pun.push(P('sT01', 'in', ds(13), '9:00'), P('sT01', 'out', ds(13), '15:00'));
const month = (extra, config) => C.computeMonth(Object.assign({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun, days, config: config || { legal_holiday: 0 }, now: NOW }, extra || {}));
const NEW_SUM_KEYS = ['hourlyPaidMin', 'specialPaidMin', 'specialPaidDays', 'specialUnpaidDays', 'compDays'];
const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); return c; };
const sumOf = (m, sid) => m.people.find((p) => p.staff.staff_id === sid).sum;
const dayOf = (m, sid, d) => m.people.find((p) => p.staff.staff_id === sid).days.find((x) => x.date === d);

console.log('\n— 1. 休暇の種類を使わない時は今と同じ —');
{
  const m0 = month();
  const same = (m) => JSON.stringify(strip(m.people)) === JSON.stringify(strip(m0.people)) && JSON.stringify(m.totals) === JSON.stringify(m0.totals);
  t('absences が空・期間の外・取り消した行・形の違う行・ほかの月分の振替だけの時は、人ごとの結果が全部同じ', same(month({ absences: [] })) &&
    same(month({ absences: [{ staff_id: 'sT01', date: '2026-11-30', kind: 'special', paid: true, type_code: 'keicho' }, { staff_id: 'sT01', date: ds(3), kind: 'hourly_paid', minutes: 120, voided_at: '2026-12-04T00:00:00Z' },
      { staff_id: 'sT01', date: ds(3), kind: 'paid' }, { staff_id: 'sT01', date: ds(3), kind: 'hourly_paid', minutes: 90 }, { staff_id: 'sT01', date: '2027-01-05', kind: 'swap', link_date: '2027-01-10' }] })));
  t('丸めの単位1は鍵の無い時と同じ（設定の写しの鍵だけが違う）', JSON.stringify(month(null, { legal_holiday: 0, roundUnitMin: 1 }).people) === JSON.stringify(m0.people));
  const s1 = sumOf(m0, 'sT01');
  t('新しい合計の鍵は休暇が無い時 0', NEW_SUM_KEYS.every((k) => s1[k] === 0), s1);
  t('締めの控えの行に新しい鍵が入る（無い時 0）・前からある鍵は今の値のまま', NEW_SUM_KEYS.every((k) => C.snapshotOf(m0).rows[0][k] === 0) && C.snapshotOf(m0).rows[0].paidMin === s1.paidMin && C.snapshotOf(m0).rows[0].legalOverMin === s1.legalOverMin);
  /* 締めた月を、締めた時の設定（控えの config）で数え直すと控えと同じ（休暇の種類と丸めの単位を入れた月も） */
  const abs = [{ id: 'a1', staff_id: 'sT01', date: ds(3), kind: 'hourly_paid', minutes: 120, paid: true }, { id: 'a2', staff_id: 'sT02', date: ds(9), kind: 'swap', link_date: ds(13) }];
  const mL = month({ absences: abs }, { legal_holiday: 0, roundUnitMin: 15, hourlyPaidLeave: true }), snap = C.snapshotOf(mL);
  const again = C.snapshotOf(C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun, days, absences: abs, config: snap.config, now: NOW + 86400000 }));
  t('締めた月を控えの設定で数え直すと控えの行と同じ（休暇・丸めありの月も）', JSON.stringify(again.rows) === JSON.stringify(snap.rows));
  const oldCfg = JSON.parse(JSON.stringify(C.snapshotOf(m0).config)); delete oldCfg.roundUnitMin; delete oldCfg.hourlyPaidLeave; delete oldCfg.dayHours;
  const old = C.snapshotOf(C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun, days, config: oldCfg, now: NOW }));
  t('段4 より前の控えの設定（新しい鍵が無い）で数え直しても、前からある鍵は今の控えと同じ', old.rows.every((r, i) => Object.keys(r).filter((k) => NEW_SUM_KEYS.indexOf(k) < 0).every((k) => JSON.stringify(r[k]) === JSON.stringify(C.snapshotOf(m0).rows[i][k]))));
}

console.log('\n— 2. 時間単位の有休 —');
{
  const m0 = month(), m1 = month({ absences: [{ id: 'h1', staff_id: 'sT02', date: ds(3), kind: 'hourly_paid', minutes: 120, paid: true }, { id: 'h2', staff_id: 'sT02', date: ds(10), kind: 'hourly_paid', minutes: 60, paid: true }] });
  const a = sumOf(m0, 'sT02'), b = sumOf(m1, 'sT02');
  t('paidMin に 180分を足す・hourlyPaidMin 180', b.paidMin === a.paidMin + 180 && b.hourlyPaidMin === 180, [a.paidMin, b.paidMin, b.hourlyPaidMin]);
  t('paidDays・所定日数・出勤日数・総労働・法定外・打刻なしは変えない', b.paidDays === a.paidDays && b.schedDays === a.schedDays && b.workDays === a.workDays && b.workMin === a.workMin && b.legalOverMin === a.legalOverMin && b.noPunchDays === a.noPunchDays);
  t('日の行に時間単位の有休（hourlyPaidMin と印）・日の paidMin は今のまま', dayOf(m1, 'sT02', ds(3)).hourlyPaidMin === 120 && dayOf(m1, 'sT02', ds(3)).absences[0].kind === 'hourly_paid' && dayOf(m1, 'sT02', ds(3)).paidMin === dayOf(m0, 'sT02', ds(3)).paidMin);
  t('締めの控えに paidMin（時間単位を含む）と hourlyPaidMin が入る（給与へ今の鍵で渡る）', C.snapshotOf(m1).rows[1].paidMin === b.paidMin && C.snapshotOf(m1).rows[1].hourlyPaidMin === 180);
  const csv = C.buildCsv(m1, { extraCols: true });
  t('CSV の集計の「有休時間」と日ごとの「有休時間」に時間単位を含める', /,3:00,/.test(csv.summary.split('\r\n')[2]) && csv.daily.split('\r\n').some((l) => l.indexOf('9002,2026-12-03') === 0 && /,2:00,[^,]*$/.test(l)), csv.summary.split('\r\n')[2]);
  t('同じ人・同じ日・同じ種類の2行目は数えない', sumOf(month({ absences: [{ staff_id: 'sT02', date: ds(3), kind: 'hourly_paid', minutes: 120 }, { staff_id: 'sT02', date: ds(3), kind: 'hourly_paid', minutes: 240 }] }), 'sT02').hourlyPaidMin === 120);
}

console.log('\n— 3. 特別休暇・代休 —');
{
  const m0 = month();
  const m1 = month({ absences: [{ id: 's1', staff_id: 'sT01', date: ds(18), kind: 'special', paid: true, type_code: 'keicho' },
    { id: 's2', staff_id: 'sT02', date: ds(22), kind: 'special', paid: false, type_code: 'other', minutes: 240 },
    { id: 'c1', staff_id: 'sT02', date: ds(23), kind: 'comp', link_date: ds(13) }, { id: 'c2', staff_id: 'sT02', date: ds(24), kind: 'comp', link_date: ds(20), minutes: 240 }] });
  const a = sumOf(m0, 'sT01'), b = sumOf(m1, 'sT01'), c = sumOf(m1, 'sT02');
  t('特別休暇（有給・1日）: specialPaidDays 1・specialPaidMin はその日の予定の実働（480分）・paidMin と paidDays は変えない', b.specialPaidDays === 1 && b.specialPaidMin === 480 && b.paidMin === a.paidMin && b.paidDays === a.paidDays, b);
  t('1日の特別休暇の日（打刻の無い予定の日）は打刻なし・要確認にしない', a.noPunchDays === 1 && b.noPunchDays === 0 && b.reviewCount === a.reviewCount - 1 && dayOf(m1, 'sT01', ds(18)).flags.indexOf('no_punch') < 0, [a.noPunchDays, b.noPunchDays, a.reviewCount, b.reviewCount]);
  t('特別休暇（無給・半日）は specialUnpaidDays 0.5・代休は compDays 1.5（1日＋半日）', c.specialUnpaidDays === 0.5 && c.specialPaidDays === 0 && c.compDays === 1.5, c);
  t('休暇の日の行に印（種類・印の code・結ぶ日）', dayOf(m1, 'sT02', ds(23)).absences[0].kind === 'comp' && dayOf(m1, 'sT02', ds(23)).absences[0].link_date === ds(13) && dayOf(m1, 'sT01', ds(18)).absences[0].type_code === 'keicho');
  const half = month({ absences: [{ staff_id: 'sT01', date: ds(18), kind: 'special', paid: true, type_code: 'keicho', minutes: 240 }] });
  t('半日の特別休暇の日は打刻なしの印を残す（もう半分は働く日）・有給の分は入れた分（240分）', sumOf(half, 'sT01').noPunchDays === 1 && sumOf(half, 'sT01').specialPaidMin === 240 && sumOf(half, 'sT01').specialPaidDays === 0.5);
  const noSched = month({ absences: [{ staff_id: 'sT01', date: ds(26), kind: 'special', paid: true, type_code: 'keicho' }] }, { legal_holiday: 0, dayHours: 7.5 });
  t('予定の無い日の1日の特別休暇は1日の所定の時間（dayHours 7.5 は8時間に切り上げ＝480分）・日の行ができる', sumOf(noSched, 'sT01').specialPaidMin === 480 && !!dayOf(noSched, 'sT01', ds(26)));
}

console.log('\n— 4. 振替休日 —');
{
  const m0 = month();
  /* 乙: 12/9（水）を休みにして 12/13（日・法定休日の曜日）に働く。13日の打刻を足す */
  const pun2 = pun.concat([P('sT02', 'in', ds(13), '7:00'), P('sT02', 'out', ds(13), '16:00')]);
  const base = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun2.filter((p) => !(p.staff_id === 'sT02' && p.at.slice(0, 10) === '2026-12-09' && false)), days, config: { legal_holiday: 0 }, now: NOW });
  const pun3 = pun2.filter((p) => !(p.staff_id === 'sT02' && new Date(Date.parse(p.at) + 9 * 3600000).toISOString().slice(0, 10) === ds(9)));
  const noSwap = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun3, days, config: { legal_holiday: 0 }, now: NOW });
  const sw = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun3, days, absences: [{ id: 'w1', staff_id: 'sT02', date: ds(9), kind: 'swap', link_date: ds(13) }], config: { legal_holiday: 0 }, now: NOW });
  const a = sumOf(noSwap, 'sT02'), b = sumOf(sw, 'sT02');
  /* 乙は 12/18 も打刻が無い（材料の共通の欠け）。9日の打刻を外した月と比べる */
  t('振替なし: 9日と18日は打刻なし・13日（日曜）の実働は休日労働', a.noPunchDays === 2 && a.holidayMin === 480, a);
  t('振替あり: 休む日（9日）は打刻なしにしない・要確認にしない・所定日数に入れない', b.noPunchDays === a.noPunchDays - 1 && dayOf(sw, 'sT02', ds(9)).blocks.length === 0 && b.reviewCount === a.reviewCount - 1 && b.schedDays === a.schedDays - 1, [a.reviewCount, b.reviewCount, a.schedDays, b.schedDays]);
  t('振替あり: 働く日（13日・日曜）は休日労働にしない（法定休日の判定は入れ替えた後の日）', b.holidayMin === 0 && b.workMin === a.workMin, b);
  t('日の行に振替の印（休む日は働く日を・働く日は休む日を指す）', dayOf(sw, 'sT02', ds(9)).absences[0].role === 'off' && dayOf(sw, 'sT02', ds(9)).absences[0].link_date === ds(13) && dayOf(sw, 'sT02', ds(13)).absences[0].role === 'work');
  /* 休む日（水曜）に働いたら、その日が法定休日 */
  const sw2 = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun2, days, absences: [{ staff_id: 'sT02', date: ds(9), kind: 'swap', link_date: ds(13) }], config: { legal_holiday: 0 }, now: NOW });
  t('休む日（9日・水曜）に働いた時は、その日の実働（7:00〜16:00・休憩60分＝480分）を休日労働に数え、日曜の13日は数えない（予定は数えない）',
    sumOf(sw2, 'sT02').holidayMin === 480 && dayOf(sw2, 'sT02', ds(9)).holidayMin === 480 && dayOf(sw2, 'sT02', ds(13)).holidayMin === 0 && dayOf(sw2, 'sT02', ds(9)).blocks.every((x) => !x.sched) && !!base, sumOf(sw2, 'sT02'));
  const sw3 = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun3, days, absences: [{ staff_id: 'sT02', date: ds(9), kind: 'swap', link_date: ds(13) }], config: {}, now: NOW });
  t('法定休日を決めていない時は、休日の入れ替えはせず予定だけを外す', sumOf(sw3, 'sT02').holidayMin === 0 && sumOf(sw3, 'sT02').noPunchDays === a.noPunchDays - 1 && dayOf(sw3, 'sT02', ds(9)).blocks.length === 0);
  t('振替の休む日だけが期間の外（働く日が期間の中）の時は、働く日の印だけを付ける', !!dayOf(C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun3, days, absences: [{ staff_id: 'sT02', date: '2026-11-25', kind: 'swap', link_date: ds(13) }], config: { legal_holiday: 0 }, now: NOW }), 'sT02', ds(13)).absences);
  t('使わない時（振替なし）の乙の結果は前と同じ', JSON.stringify(sumOf(m0, 'sT02')) === JSON.stringify(sumOf(month({ absences: [] }), 'sT02')));
}

console.log('\n— 5. 丸めの単位 —');
{
  const one = (inHm, outHm, day, unit, schedOn) => {
    const sc = schedOn === false ? [] : [S('sT01', ds(1), '9:00', '18:00')];
    const m = C.computeMonth({ ym: YM, staff: [K_STAFF[0]], schedule: sc, punches: [P('sT01', 'in', ds(1), inHm), P('sT01', 'out', ds(1), outHm)], days: day ? [Object.assign({ staff_id: 'sT01', work_date: ds(1), rev: 1 }, day)] : [], config: { roundUnitMin: unit }, now: NOW });
    return m.people[0].days[0].blocks[0];
  };
  const hm = (ms) => C.jstHM(ms);
  let b = one('9:07', '18:00', null, 15);
  t('15分: 9:07 の出勤は 9:00 から数える（遅刻にしない）', hm(b.countStart) === '09:00' && b.lateMin === 0 && b.flags.indexOf('late') < 0, b);
  b = one('9:20', '18:00', null, 15);
  t('15分: 9:20 の出勤は 9:15 から（遅刻 15分）', hm(b.countStart) === '09:15' && b.lateMin === 15 && b.flags.indexOf('late') >= 0, b);
  b = one('9:20', '18:00', null, 1);
  t('1分: 9:20 は打刻どおり（今と同じ）', hm(b.countStart) === '09:20' && b.lateMin === 20);
  b = one('9:00', '17:50', null, 15);
  t('15分: 17:50 の退勤は 18:00 まで数える（早退にしない）', hm(b.countEnd) === '18:00' && b.earlyLeaveMin === 0 && b.flags.indexOf('early_leave') < 0, b);
  b = one('9:00', '17:40', null, 15);
  t('15分: 17:40 の退勤は 17:45 まで（早退 15分）', hm(b.countEnd) === '17:45' && b.earlyLeaveMin === 15, b);
  b = one('9:00', '18:52', { overtime_ok: true }, 15);
  t('15分: 残業を全部認めた日の 18:52 の退勤は 19:00 まで', hm(b.countEnd) === '19:00' && b.workMin === 540, b);
  b = one('9:00', '19:20', { ot_until: C.iso(at(ds(1), '19:00')) }, 15);
  t('15分: 19:00 まで認めた日の 19:20 の退勤は 19:00 まで（認めた時刻を超えない）', hm(b.countEnd) === '19:00');
  b = one('9:00', '18:52', { ot_until: C.iso(at(ds(1), '19:30')) }, 15);
  t('15分: 19:30 まで認めた日の 18:52 の退勤は 19:00 まで（切り上げ・認めた時刻の内）', hm(b.countEnd) === '19:00');
  b = one('9:00', '18:52', { ot_until: C.iso(at(ds(1), '18:55')) }, 15);
  t('15分: 18:55 まで認めた日の 18:52 の退勤は 18:55 まで（切り上げても認めた時刻まで）', hm(b.countEnd) === '18:55');
  b = one('9:00', '18:40', null, 15);
  t('15分: 認めていない残業は今までどおり予定の終わり（18:00）まで', hm(b.countEnd) === '18:00' && b.flags.indexOf('overtime') >= 0);
  b = one('8:20', '18:00', null, 15);
  t('15分: 認めていない早出は今までどおり予定の開始から', hm(b.countStart) === '09:00');
  b = one('8:20', '18:00', { early_ok: true }, 15);
  t('15分: 早出を認めた日の出勤は打刻どおり（丸めない）', hm(b.countStart) === '08:20');
  b = one('9:07', '17:52', null, 15, false);
  t('15分: 予定の無い勤務は丸めない（打刻どおり）', hm(b.countStart) === '09:07' && hm(b.countEnd) === '17:52');
  const m30 = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun, days, config: { legal_holiday: 0, roundUnitMin: 30 }, now: NOW }), m1 = month();
  t('30分: どの人の総労働も丸めない時より短くならない（不利な向きに丸めない）', K_STAFF.every((s) => sumOf(m30, s.staff_id).workMin >= sumOf(m1, s.staff_id).workMin) && sumOf(m30, 'sT01').workMin > sumOf(m1, 'sT01').workMin, [sumOf(m30, 'sT01').workMin, sumOf(m1, 'sT01').workMin]);
}

console.log('\n— 6. 設定 —');
{
  t('roundUnitMin は 1・5・10・15・30 だけ（ほかは 1）', [1, 5, 10, 15, 30].every((u) => C.fillConfig({ roundUnitMin: u }).roundUnitMin === u) && [0, 7, 60, '15', null].every((u) => C.fillConfig({ roundUnitMin: u }).roundUnitMin === 1));
  t('dayHours は1〜24 の数を時間に切り上げ（7.5→8・6.2→7）・範囲の外は 8', C.fillConfig({ dayHours: 7.5 }).dayHours === 8 && C.fillConfig({ dayHours: 6.2 }).dayHours === 7 && C.fillConfig({ dayHours: 0 }).dayHours === 8 && C.fillConfig({ dayHours: 25 }).dayHours === 8 && C.fillConfig({}).dayHours === 8);
  t('hourlyPaidLeave は真偽だけ（既定は使わない）', C.fillConfig({}).hourlyPaidLeave === false && C.fillConfig({ hourlyPaidLeave: true }).hourlyPaidLeave === true && C.fillConfig({ hourlyPaidLeave: 'yes' }).hourlyPaidLeave === false);
  const lt = [{ code: 'keicho', name: '慶弔', paid: true }, { code: 'bad code', name: 'x', paid: true }, { code: 'summer', name: '', paid: true }, { code: 'keicho', name: '重なり', paid: false }, { code: 'vol', name: 'ボランティア', paid: false }, { code: 'p', name: '有給か無い', paid: 'yes' }];
  const f = C.fillConfig({ leaveTypes: lt, agreement36: { monthLimitH: 40 } });
  t('leaveTypes は確かめた行だけを写す（印の形・名前・有給か・重なり）・36協定の設定と一緒でも落とさない', JSON.stringify(f.leaveTypes) === JSON.stringify([{ code: 'keicho', name: '慶弔', paid: true }, { code: 'vol', name: 'ボランティア', paid: false }]) && f.agreement36.monthLimitH === 40, f.leaveTypes);
  t('leaveTypes が無い・配列でない時は鍵を作らない・使う一覧は初めの3種類（慶弔・夏季は有給・その他は無給）', !('leaveTypes' in C.fillConfig({})) && !('leaveTypes' in C.fillConfig({ leaveTypes: 'x' })) &&
    JSON.stringify(C.leaveTypesOf(C.fillConfig({}))) === JSON.stringify(C.LEAVE_TYPES_DEFAULT) && C.LEAVE_TYPES_DEFAULT.map((x) => x.name + x.paid).join() === '慶弔true,夏季true,その他false');
  t('leaveTypes は20種類まで', C.cleanLeaveTypes(Array.from({ length: 30 }, (_, i) => ({ code: 'c' + i, name: '種類' + i, paid: false }))).length === 20);
  t('空の配列は「種類なし」として残す', JSON.stringify(C.leaveTypesOf(C.fillConfig({ leaveTypes: [] }))) === '[]');
}

console.log('\n— 7. 有給の残り（時間単位） —');
{
  const asOf = '2026-11-20';
  const dayUses = [{ staff_id: 'sT01', use_date: '2026-10-20', days: 1, src: 'manual' }, { staff_id: 'sT01', use_date: '2026-10-21', days: 0.5, src: 'shift' }];
  const hu = L.hourlyUses([{ id: 'h1', staff_id: 'sT01', date: '2026-11-02', kind: 'hourly_paid', minutes: 120 }, { id: 'h1', staff_id: 'sT01', date: '2026-11-02', kind: 'hourly_paid', minutes: 120 },
    { id: 'h2', staff_id: 'sT01', date: '2026-11-05', kind: 'hourly_paid', minutes: 60, voided_at: '2026-11-06' }, { id: 'h3', staff_id: 'sT01', date: '2026-11-06', kind: 'special', minutes: null }, { id: 'h4', staff_id: 'sT01', date: '2026-11-09', kind: 'hourly_paid', minutes: 180 }], 480);
  t('hourlyUses: 時間単位の有休だけ・取り消した行と同じ id の2つ目は入れない・日数＝分÷480', hu.length === 2 && hu[0].days === 0.25 && hu[1].days === 0.375 && hu.every((u) => u.src === 'hourly'), hu);
  const sm0 = L.summary({ hireDate: '2024-04-01', profile: {}, grants: [], uses: dayUses, asOf });
  const sm1 = L.summary({ hireDate: '2024-04-01', profile: {}, grants: [], uses: dayUses.concat(hu), asOf });
  t('残りから時間単位の分（5時間＝0.625日）を引く', Math.abs(sm0.balance.remain - sm1.balance.remain - 0.625) < 1e-9, [sm0.balance.remain, sm1.balance.remain]);
  t('年5日の取得義務には時間単位を数えない', sm1.obligation.used === sm0.obligation.used && sm1.obligation.state === sm0.obligation.state);
  /* 入職 2024-04-01: 2024-10-01 の10日は期限切れ・2025-10-01 の11日と 2026-10-01 の12日が使える。使用 1.5日は古い方から → 残り 21.5日（時間単位が無い時は半日きざみ） */
  t('時間単位が無い時は半日きざみの数え（11−1.5＋12＝21.5日・使った日数・付与ごとの残りも半日きざみ）', sm0.balance.remain === 21.5 && sm0.balance.used === 1.5 && sm0.balance.lots.every((l) => l.remain * 2 === Math.round(l.remain * 2)), sm0.balance);
  t('日数の文字: 半日きざみは「10.5 日」・時間の端数は「9 日 3 時間」', L.daysHm(10.5, 480) === '10.5 日' && L.daysHm(9.375, 480) === '9 日 3 時間' && L.daysHm(0.25, 420) === '0 日 1 時間 45 分');
  const yr = L.hourlyYear(sm1.lots, dayUses.concat(hu), '2026-11-20', 480);
  t('年の上限: その日を含む付与日からの1年（2026-10-01〜2027-09-30）の時間単位の分・上限は5日分（2400分）', yr.from === '2026-10-01' && yr.to === '2027-09-30' && yr.usedMin === 300 && yr.capMin === 2400, yr);
  t('付与が無い時はその年の1月1日から', L.hourlyYear([], hu, '2026-11-20', 480).from === '2026-01-01');
  const fut = L.hourlyYear(sm1.lots, dayUses.concat(hu), '2027-10-05', 480);
  t('先の日付（今の1年の後）は付与日から1年ずつ進めた年（2027-10-01〜2028-09-30）で数える（今の年の使用を数えない）', fut.from === '2027-10-01' && fut.to === '2028-09-30' && fut.usedMin === 0, fut);
  const yb = L.hourlyYear([], [], '2027-03-01', 480), yb2 = L.hourlyYear([], [], '2026-01-01', 480);
  t('付与が無い時の先の日付はその日の年（1月1日から）', yb.from === '2027-01-01' && yb2.from === '2026-01-01');
}

console.log('\n— 8. 年次有給休暇管理簿（時間単位） —');
{
  const asOf = '2026-11-20';
  const uses = [{ staff_id: 'sT01', use_date: '2026-11-02', days: 1, src: 'manual' }, { staff_id: 'sT01', use_date: '2026-11-02', days: 0.25, minutes: 120, src: 'hourly' }, { staff_id: 'sT01', use_date: '2026-11-03', days: 0.125, minutes: 60, src: 'hourly' }];
  const sm = L.summary({ hireDate: '2024-04-01', profile: {}, grants: [], uses, asOf });
  const g = G.ledgerOf({ lots: sm.lots, uses, asOf, openingDate: null });
  const r = g.rows[g.rows.length - 1];
  t('同じ日の1日と時間単位は別の行（上書きし合わない）・時間単位の行は hourly と分を持つ', r.taken.length === 3 && r.taken.filter((u) => u.hourly).map((u) => u.minutes).join() === '120,60', r.taken);
  t('取得日数は1日・半日だけ（1日）・時間単位は takenHourMin（180分）', r.takenDays === 1 && r.takenHourMin === 180 && g.takenTotal === 1 && g.takenHourTotal === 180);
  t('残りは有給のタブと同じ（時間単位を引いた値）', r.remain === sm.balance.remain);
}

console.log('\n— 9. 画面 —');
{
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8'), H = fs.readFileSync(path.join(ROOT, 'kintai.html'), 'utf8');
  t('今の月分と有給のさかのぼりの月分の計算に absences を渡す', /C\.computeMonth\(\{ ym: ym, [^}]*absences: data\.absences/.test(K) && /C\.computeMonth\(\{ ym: y, [^}]*absences: d\.absences/.test(K));
  t('休暇の断りの語の文（locked・dup・badkind・badvalue・baddate・notfound・already・reason）がある', ['locked', 'dup', 'badkind', 'badvalue', 'baddate', 'notfound', 'already', 'reason'].every((k) => new RegExp('var NG_ABS = \\{[\\s\\S]*?\\b' + k + ':').test(K)));
  t('休暇の関数は kintai_absence_add（8つの引数）と kintai_absence_void', /\['kintai_absence_add', args\]/.test(K) && /p_staff_id: ctx\.sid, p_date: ad, p_kind: ak, p_minutes: null, p_paid: null, p_type_code: null, p_link_date: null, p_note:/.test(K) && /'kintai_absence_void', \{ p_id: btn\.getAttribute\('data-id'\), p_reason: reason \}/.test(K));
  t('取り消しは理由が必ず（needR）', /act === 'lv-abs-void'\) \{\s*if \(!needR\(\)\) return;/.test(K));
  t('直しの履歴の言い方（absence_add・absence_void）', /absence_add: '休暇を入れた', absence_void: '休暇を取り消した'/.test(K));
  t('設定タブ: 丸めの単位の説明「働いた人に不利な向きには丸めません」・時間単位の有休・1日の所定の時間・特別休暇の種類', /働いた人に不利な向きには丸めません/.test(K) && /id="l-roundUnitMin"/.test(K) && /id="l-hourly"/.test(K) && /id="l-dayHours"/.test(K) && /id="lt-code-'/.test(K));
  t('設定の欄は今の設定（rawCfg）から出し、保存は欄の無い画面では今の設定のまま', /function lvSetHtml\(\) \{\s*var c = C\.fillConfig\(rawCfg\(\)\)/.test(K) && /var lvs = typeof readLvSet === 'function' \? readLvSet\(\) : null;/.test(K) && /if \(!\$\('l-roundUnitMin'\)\) return null;/.test(K));
  t('管理簿の印刷: su-print の define（A4 縦・文字の大きさで収める・Cmd/Ctrl+P では準備しない）と facGate', /SUPrint\.define\('ledger', \{ label: '年次有給休暇管理簿', paper: 'A4 portrait'/.test(K) && /cssVar: '--lg-fs'/.test(K) && /when: function \(\) \{ return ledgerOn && view === 'app'; \}/.test(K) && /window\.SUPrint\.facGate\(run0,/.test(K) && !/\.style\.zoom|zoom\s*:|transform\s*:\s*scale/.test(K.slice(K.indexOf('v5 段4: 年次有給休暇管理簿の印刷'), K.indexOf('/* ── 操作 ── */'))));
  t('管理簿の紙の見出しに施設名と印刷日（data-su-print-head）', /data-su-print-head="name date"/.test(K));
  const ver = (f, html) => { const m = new RegExp(f.replace('.', '\\.') + '\\?v=([0-9.-]+)"').exec(html); return m ? m[1] : null; };
  const others = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'kintai.html').map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const pjs = others.map((h) => ver('su-print.js', h)).filter(Boolean), pcss = others.map((h) => ver('su-print.css', h)).filter(Boolean);
  t('kintai.html は su-print.js・su-print.css をほかの画面と同じ版で読む', pjs.length > 0 && pjs.every((v) => v === ver('su-print.js', H)) && pcss.every((v) => v === ver('su-print.css', H)), [ver('su-print.js', H), pjs[0]]);
  t('kintai-ledger.js は kintai-leave.js の後・kintai.js の前に読む', H.indexOf('kintai-ledger.js?v=') > H.indexOf('kintai-leave.js?v=') && H.indexOf('kintai-ledger.js?v=') < H.indexOf('kintai.js?v='));
  t('管理簿の紙の根（#k-ledger）は画面では出さない・印刷の時だけ', /#k-ledger\{display:none\}/.test(H) && /body\.su-print-ledger #k-ledger\{display:block;font-size:var\(--lg-fs,11px\)/.test(H) && /<div id="k-ledger" aria-hidden="true"><\/div>/.test(H));
  t('kintai-calc.js の版は勤怠・打刻・給与の3画面で同じ', ['kintai.html', 'kintai-clock.html', 'payroll.html'].map((f) => ver('kintai-calc.js', fs.readFileSync(path.join(ROOT, f), 'utf8'))).every((v, i, a) => v && v === a[0]));
  t('隠した休暇の欄は出さない（.row > label[hidden]）', /\.row > label\[hidden\]\{display:none\}/.test(H));
}

console.log('\n— 10. 段4 の積み残しの直し（ホームの期限の近い残り・締めの比べる鍵・振替の働く日の注意） —');
{
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  const between = (a0, b0) => { const i = K.indexOf(a0), j = K.indexOf(b0, i + 1); return i >= 0 && j > i ? K.slice(i, j) : ''; };
  const fnSrc = (name) => { const i = K.indexOf('  function ' + name + '('); if (i < 0) return ''; const j = K.indexOf('\n  }\n', i); return K.slice(i, j + 4); };
  const Mo = require(path.join(ROOT, 'kintai-monitor.js'));
  const g = [{ grant_date: '2026-04-01', days: 10, kind: 'auto' }], ok = L.obligation5(g, [1, 2, 3, 4, 5].map((d) => ({ use_date: '2026-06-0' + d, days: 1 })), '2026-12-15');
  const lb = Mo.boxes({ leaveRows: [{ staff_id: 'a', name: '試験 甲', ob: ok, expiringDays: 12.625, expiringText: L.daysHm(12.625, 480), expires: '2027-03-31' }, { staff_id: 'b', name: '試験 乙', ob: ok, expiringDays: 2.5, expires: '2027-03-31' }] }).filter((x) => x.key === 'leave')[0];
  t('ホームの箱: 時間単位の端数は有給の画面と同じ「12 日 5 時間」・文を渡さない時は今までどおり「2.5 日」', lb.rows[0].text === '期限の近い残り 12 日 5 時間（2027年3/31 まで）' && lb.rows[1].text === '期限の近い残り 2.5 日（2027年3/31 まで）', lb.rows);
  t('画面はホームの箱へ有給の画面と同じ書き方（dTxt）の文を渡す', /expiringText: near \? dTxt\(soon\.days, s\.staff_id\) : ''/.test(K));
  /* 締めの比べる鍵: 新しい鍵を足し、古い控え（鍵が無い）は比べない */
  const keys = new Function(between('  var SNAP_KEYS = [', '  var SNAP_FILL') + '\nreturn SNAP_KEYS;')();
  t('締めの比べる鍵に休暇の種類の鍵（hourlyPaidMin・specialPaidMin・specialPaidDays・specialUnpaidDays・compDays）を足した', NEW_SUM_KEYS.every((k) => keys.includes(k)), keys);
  const diff = (rows, people) => new Function('ROWS', 'PEOPLE', between('  var SNAP_KEYS = [', '  var SNAP_FILL') + fnSrc('countsOf') + '\n' + fnSrc('sameCounts') + `
    function snapRows() { return ROWS; } function dispName(s) { return s.staff_id; } var month = { people: PEOPLE };
    ${fnSrc('snapDiff')}
    return snapDiff();`)(rows, people);
  const mA = month({ absences: [{ id: 'h1', staff_id: 'sT01', date: ds(3), kind: 'hourly_paid', minutes: 120 }, { id: 's1', staff_id: 'sT02', date: ds(18), kind: 'special', paid: true, type_code: 'keicho' }] });
  const snapNew = C.snapshotOf(mA).rows, snapOld = snapNew.map((r) => { const o = Object.assign({}, r); NEW_SUM_KEYS.forEach((k) => delete o[k]); return o; });
  t('今の控えと今の数字は「違う人」なし', diff(snapNew, mA.people).length === 0);
  t('段4 より前の控え（新しい鍵が無い）と比べても「違う」と出さない', diff(snapOld, mA.people).length === 0);
  const bad = snapNew.map((r) => Object.assign({}, r, r.staff_id === 'sT01' ? { hourlyPaidMin: 60 } : {}));
  t('控えの新しい鍵が今の数字と違えば「違う人」に出す（時間単位の分が変わった人）', diff(bad, mA.people).join() === 'sT01', diff(bad, mA.people));
  /* 振替の働く日に予定が無い時の注意（止めない） */
  const sod = (sid, d) => new Function('M', 'LS', 'SID', 'D', 'var month = M, leaveSt = LS;\n' + fnSrc('schedOnDay') + '\nreturn schedOnDay(SID, D);')(month(), null, sid, d);
  t('予定の有無: 平日（予定あり）は true・日曜（予定なし）は false・読んでいない月は null', sod('sT01', ds(14)) === true && sod('sT01', ds(13)) === false && sod('sT01', '2027-02-01') === null);
  t('振替の働く日に予定が無い時は注意の文を出し、送るのは止めない（return しない）',
    /if \(schedOnDay\(ctx\.sid, sl\) === false\) warnAfter = '働く日に予定がありません。出勤予定を「予定を直す」で入れてください。';\s*\} else \{ msg\.textContent = '休暇の種類を選んでください。'; return; \}[\s\S]{0,400}?call = \['kintai_absence_add', args\];/.test(K)
    && /toast\('保存しました（' \+ nameOf\(ctx\.sid\) \+ ' さんの有給）' \+ \(warnAfter \? '。' \+ warnAfter : ''\)\)/.test(K)
    && /if \(warnAfter\) p2 = p2\.then\(function \(\) \{ if \(\$\('g-dlg'\)\.open && dlgCtx && dlgCtx\.mode === 'leave' && \$\('e-msg'\)\) \$\('e-msg'\)\.textContent = warnAfter; \}\);/.test(K));
}

console.log('\n— 11. 反証レビュー（2026-11-20）の直し —');
{
  /* 1（high）丸めで実働が短くならない: 休憩を引くかと休憩の分は丸める前の区間で決め、どの日も丸めた値 ≧ 丸めない値 */
  const blk = (s0, e0, i0, o0, unit, extra) => {
    const d = ds(1), sc = !s0 ? [] : extra && extra.night ? [{ staff_id: 'sT01', work_date: d, seq: 1, office: 'facility', kind: 'night', start_at: C.iso(at(d, s0)), end_at: C.iso(at(ds(2), '8:00')), break_min: 120, paid_min: 0, symbol: '夜' }] : [S('sT01', d, s0, e0)];
    const pu = [P('sT01', 'in', d, i0), Object.assign(P('sT01', 'out', d, o0), extra && extra.nextDay ? { at: new Date(at(ds(2), o0)).toISOString() } : {})];
    const m = C.computeMonth({ ym: YM, staff: [K_STAFF[0]], schedule: sc, punches: pu, days: extra && extra.day ? [Object.assign({ staff_id: 'sT01', work_date: d, rev: 1 }, extra.day)] : [], config: { roundUnitMin: unit, legal_holiday: extra && extra.lh != null ? extra.lh : null }, now: NOW });
    return { b: m.people[0].days[0].blocks[0], s: m.people[0].sum };
  };
  let e1 = blk('8:50', '17:50', '11:52', '17:50', 1), e15 = blk('8:50', '17:50', '11:52', '17:50', 15);
  t('例1: 予定 8:50〜17:50・11:52 出勤・17:50 退勤 → 1分 358分・休憩0／15分でも休憩0で 358分以上（前は305分・休憩60分）', e1.b.workMin === 358 && e1.b.breakMin === 0 && e15.b.breakMin === 0 && e15.b.workMin >= 358, [e1.b.workMin, e15.b.workMin, e15.b.breakMin]);
  e1 = blk('8:50', '17:50', '8:50', '14:47', 1); e15 = blk('8:50', '17:50', '8:50', '14:47', 15);
  t('例2: 早退（8:50 出勤・14:47 退勤）も 15分で休憩を引かず実働が短くならない', e15.b.breakMin === e1.b.breakMin && e15.b.workMin >= e1.b.workMin, [e1.b, e15.b].map((x) => [x.workMin, x.breakMin]));
  /* 境目: 拘束6時間ちょうど・6時間1分（遅刻・早退の両方）、夜勤、認めた残業、法定休日 */
  const cases = [];
  for (const i0 of ['9:00', '9:01', '9:07', '11:52', '11:59', '12:00', '12:01', '12:14']) cases.push(['9:00', '18:00', i0, '18:00']);
  for (const o0 of ['15:00', '15:01', '14:59', '14:47', '15:14', '17:59']) cases.push(['9:00', '18:00', '9:00', o0]);
  for (const io0 of [['11:59', '17:58'], ['12:01', '18:00'], ['9:13', '15:14'], ['10:58', '16:59']]) cases.push(['9:00', '18:00', io0[0], io0[1]]);
  let bad = [];
  for (const unit of [5, 10, 15, 30]) {
    for (const c of cases) for (const ex of [null, { day: { overtime_ok: true } }, { lh: 2 }]) {
      const a0 = blk(c[0], c[1], c[2], c[3], 1, ex), a1 = blk(c[0], c[1], c[2], c[3], unit, ex);
      if (!(a1.b.workMin >= a0.b.workMin && a1.b.breakMin === a0.b.breakMin && a1.b.nightMin >= a0.b.nightMin && a1.b.holidayMin >= a0.b.holidayMin &&
            a1.s.legalOverMin >= a0.s.legalOverMin && a1.s.nightMin >= a0.s.nightMin && a1.s.workMin >= a0.s.workMin && a1.s.holidayMin >= a0.s.holidayMin)) bad.push([unit, c, ex, a0.b.workMin, a1.b.workMin, a0.b.breakMin, a1.b.breakMin]);
    }
    for (const io0 of [['22:07', '7:52'], ['23:50', '5:10'], ['22:00', '8:00']]) {
      const a0 = blk('22:00', null, io0[0], io0[1], 1, { night: true, nextDay: true }), a1 = blk('22:00', null, io0[0], io0[1], unit, { night: true, nextDay: true });
      if (a0 && a1 && !(a1.b.workMin >= a0.b.workMin && a1.b.nightMin >= a0.b.nightMin && a1.b.breakMin === a0.b.breakMin)) bad.push([unit, 'night', io0]);
    }
  }
  t('単位 5・10・15・30 × 境目（拘束6時間ちょうど・6時間1分）・認めた残業・法定休日: 実働・休憩・深夜・休日労働・月の法定外が丸めない時以上（休憩は同じ）', bad.length === 0, bad.slice(0, 5));
  const g0 = month(null, { legal_holiday: 0 });
  t('架空の月全体でも、どの単位でも人ごとの総労働・法定外・深夜・休日労働が丸めない時以上', [5, 10, 15, 30].every((u) => { const g1 = month(null, { legal_holiday: 0, roundUnitMin: u }); return K_STAFF.every((st) => ['workMin', 'legalOverMin', 'nightMin', 'holidayMin', 'schedInMin'].filter((k) => k !== 'schedInMin').every((k) => sumOf(g1, st.staff_id)[k] >= sumOf(g0, st.staff_id)[k])); }));

  /* 2 年の上限の1年の起点は自動の付与日だけ（手で足した付与では始まり直さない）・管理簿の基準日の行も同じ */
  const asOf = '2026-11-20';
  const grants = [{ id: 'm1', grant_date: '2026-11-01', days: 3, kind: 'manual' }];
  const sm = L.summary({ hireDate: '2024-04-01', profile: {}, grants, uses: [], asOf });
  const hu = [{ staff_id: 'sT01', use_date: '2026-10-15', days: 4, minutes: 1920, src: 'hourly' }];
  const yr = L.hourlyYear(sm.lots, hu, '2026-11-20', 480);
  t('手で足した付与（11/1）の後でも、1年の起点は自動の付与日（2026-10-01）のまま・10/15 の32時間を数える（上限を超えられない）', yr.from === '2026-10-01' && yr.usedMin === 1920 && yr.usedMin + 480 + 60 > yr.capMin, yr);
  const yo = L.hourlyYear([{ grant_date: '2026-04-01', days: 8, kind: 'opening' }, { grant_date: '2026-06-01', days: 2, kind: 'manual' }], [], '2026-07-01', 480);
  t('自動の付与が無い人は移行の残りの付与日が起点（手で足した付与では始まり直さない）', yo.from === '2026-04-01', yo);
  const led = G.ledgerOf({ lots: sm.lots, uses: [], asOf, openingDate: null });
  t('管理簿: 手で足した付与は基準日の行にせず、前の基準日（2026-10-01）の付与日数に足す', led.rows.map((r) => r.base).join() === '2024-10-01,2025-10-01,2026-10-01' && led.rows[2].days === 15, led.rows.map((r) => [r.base, r.days]));

  /* 6 1日の時間は人ごと */
  t('1日の時間: 週19時間÷4日→5時間（切り上げ）・週の所定が片方だけ・無い人は設定（7.5→8時間）・既定8時間', L.dayMinOf({ weekly_days: 4, weekly_hours: 19 }, 8) === 300 && L.dayMinOf({ weekly_days: 4 }, 7) === 420 && L.dayMinOf(null, 7.5) === 480 && L.dayMinOf(null, null) === 480 && L.dayMinOf({ weekly_days: 5, weekly_hours: 40 }, 6) === 480);
  const hu2 = L.hourlyUses([{ id: 'a', staff_id: 'p5', date: '2026-11-02', kind: 'hourly_paid', minutes: 60 }, { id: 'b', staff_id: 'p8', date: '2026-11-02', kind: 'hourly_paid', minutes: 60 }], (sid) => (sid === 'p5' ? 300 : 480));
  t('時間単位の日数への換算は人ごとの1日の時間（5時間の人は1時間＝0.2日・8時間の人は0.125日）', hu2.find((u) => u.staff_id === 'p5').days === 0.2 && hu2.find((u) => u.staff_id === 'p8').days === 0.125);

  /* 3・4・6 画面: 先の日付の線・同じ日の有給の重ね・人ごとの時間 */
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  const fnSrc = (name) => { const i = K.indexOf('  function ' + name + '('); if (i < 0) return ''; const j = K.indexOf('\n  }\n', i); return K.slice(i, j + 4); };
  const amax = (td, months, cfg) => new Function('C', 'MS', 'TD', 'CFG', 'var month = null, leaveSt = { months: MS }; function today() { return TD; } function lvCfg() { return CFG; }\n' + fnSrc('absMaxDate') + '\nreturn absMaxDate();')(C, months, td, cfg);
  t('休暇を入れられる最後の日: 読んだ来月分の期間の終わり・読んでいない時は締め日（月末・15日）から数える', amax('2026-11-20', [{ ym: '2026-11', period: { from: '2026-11-01', to: '2026-11-30' } }, { ym: '2026-12', period: { from: '2026-12-01', to: '2026-12-31' } }], { close_day: 0 }) === '2026-12-31' &&
    amax('2026-11-20', [], { close_day: 0 }) === '2026-12-31' && amax('2026-11-20', [], { close_day: 15 }) === '2027-01-15' && amax('2026-11-10', [], { close_day: 15 }) === '2026-12-15');
  const pmo = new Function('LS', 'var leaveSt = LS;\n' + fnSrc('paidMinOn') + '\nreturn paidMinOn;')({ manual: [{ staff_id: 'x', use_date: '2026-11-02', days: 0.5 }, { staff_id: 'x', use_date: '2026-11-02', days: 1, voided_at: 'z' }],
    absences: [{ staff_id: 'x', date: '2026-11-02', kind: 'hourly_paid', minutes: 60 }, { staff_id: 'x', date: '2026-11-02', kind: 'special', paid: true, minutes: null }, { staff_id: 'x', date: '2026-11-02', kind: 'special', paid: false, minutes: null }, { staff_id: 'x', date: '2026-11-02', kind: 'comp', minutes: null }] });
  t('同じ日の有給の休みの分: 手入力の有休 半日（240）＋時間単位 60＋有給の特別休暇1日（480）＝780（無給・代休・取り消しは数えない）', pmo('x', '2026-11-02', 480) === 780 && pmo('x', '2026-11-03', 480) === 0);
  t('休暇の足し・有休の使用の前に、同じ日の重ねと来月分より先の日付を画面で止める（DB と同じ文の考え）',
    /if \(\(ak === 'hourly_paid' \|\| \(ak === 'special' && args\.p_paid\)\) && paidMinOn\(ctx\.sid, ad, dmin\) \+ \(args\.p_minutes != null \? args\.p_minutes : dmin\) > dmin\) \{ msg\.textContent = ABS_OVER; return; \}/.test(K) &&
    /if \(!hasU && paidMinOn\(ctx\.sid, ud, dmU\) \+ Math\.round\(\(un === 0\.5 \? 0\.5 : 1\) \* dmU\) > dmU\) \{ msg\.textContent = ABS_OVER; return; \}/.test(K) &&
    /if \(ad > amax\) \{ msg\.textContent = ABS_LATE; return; \}/.test(K) && /if \(sl > amax\) \{ msg\.textContent = ABS_LATE; return; \}/.test(K) && /var ABS_LATE = '休暇は来月分までの日付で入れてください。';/.test(K));
  t('時間単位の上限・1日の時間の欄・半日の分は人ごとの1日の時間（staffDayMin）', /dmin = staffDayMin\(ctx\.sid\), dhP = dmin \/ 60;/.test(K) && /dh = staffDayMin\(sid\) \/ 60/.test(K) && /L\.hourlyUses\(abs, function \(sid0\) \{ return L\.dayMinOf \? L\.dayMinOf\(prof\[sid0\], dh0\)/.test(K));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
