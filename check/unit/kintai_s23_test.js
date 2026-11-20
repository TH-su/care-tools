/* 勤怠管理 v5 の段2・3（ホーム・36協定）と「段2・3 に足す直し」の試験（2026-11-20 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md）
   実行: node check/unit/kintai_s23_test.js（環境変数 KINTAI_CALC で別の版の kintai-calc.js を当てられる）
   守りたいこと:
     1. 締めた月を今の版で数え直しても控え（snapshotOf の rows）が直す前と同じ（月の30分丸めの切・入・変形の有無の4通り。下の GOLDEN は直す前の版で作った値）
     2. 丸める前の法定外・休日労働（legalOverRawMin・holidayRawMin）。丸めない時は今の値と同じ・丸める時は丸める前の値
     3. A5: 予定の終わりから4時間を超える残業（・始まりの4時間より前の早出）で出勤と退勤を2つの組に割らない
     4. A6: 同じ日にシフトの有休と手入力の半日がある時は、手入力を正にする（台帳・計算・給与の日数をそろえる）
     5. 36協定の設定（agreement36）を計算の設定（fillConfig）で落とさない
     6. 画面（kintai.js の関数を取り出して偽の部品で動かす）: 設定の保存で agreement36 とほかの鍵を消さない・範囲の外は送らない／
        締めの止め（勤務中・まだ出勤していない）／個人の月の警告の帯（今の文を残し、判定の同じ文を重ねない）／締めの控えと比べる鍵／
        有給の窓で保存していない入力を戻す／設定タブの入力を確かめなしに捨てない／ホームのタブ・30秒の読み直し・説明文
   ★職員は架空（試験 甲・試験 乙）。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.KINTAI_CALC || path.join(ROOT, 'kintai-calc.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
const L = require(path.join(ROOT, 'kintai-leave.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const YM = '2026-12', NOW = Date.parse('2027-01-10T12:00:00+09:00');
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() });
const STAFF = [{ id: 'sT01', name: '試験 甲', mainDivision: '施設', empCode: '9001', active: true }, { id: 'sT02', name: '試験 乙', mainDivision: '訪問', empCode: '9002', active: true }];
const K_STAFF = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }, { staff_id: 'sT02', name: '試験 乙', office: 'visit', emp_code: '9002' }];
const build = (cells) => C.buildSchedule({ ym: YM, plan: { cells }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;

console.log('\n— 1. 締めた月を今の版で数え直しても控えと同じ（A5・A6 の場面を含まない月）—');
/* 直す前の版（kintai-calc.js ?v=2026-11-20.1）で作った控えの行。新しく足した鍵（丸める前の値）は比べに混ぜない */
const GOLDEN = {"raw_v":[{"staff_id":"sT01","emp_code":"9001","workDays":28,"paidDays":0,"workMin":13225,"schedInMin":10628,"overtimeMin":505,"legalOverMin":2280,"nightMin":0,"lateCount":6,"lateMin":72,"earlyLeaveCount":6,"earlyLeaveMin":180,"noPunchDays":0,"reviewCount":17,"byOffice":{"facility":13225},"holidayMin":317,"absentDays":0,"paidMin":0,"uncountedMin":960,"legalInOverMin":0,"over60Min":0,"nightShiftCount":0,"schedDays":27,"counts":{"早":22,"遅":5}},{"staff_id":"sT02","emp_code":"9002","workDays":3,"paidDays":1,"workMin":1440,"schedInMin":960,"overtimeMin":0,"legalOverMin":0,"nightMin":600,"lateCount":0,"lateMin":0,"earlyLeaveCount":0,"earlyLeaveMin":0,"noPunchDays":1,"reviewCount":1,"byOffice":{"visit":1440},"holidayMin":480,"absentDays":0,"paidMin":480,"uncountedMin":30,"legalInOverMin":0,"over60Min":0,"nightShiftCount":2,"schedDays":5,"counts":{"(22":2,"有":1,"早":1}}],"raw_n":[{"staff_id":"sT01","emp_code":"9001","workDays":28,"paidDays":0,"workMin":13225,"schedInMin":11448,"overtimeMin":505,"legalOverMin":1460,"nightMin":0,"lateCount":6,"lateMin":72,"earlyLeaveCount":6,"earlyLeaveMin":180,"noPunchDays":0,"reviewCount":17,"byOffice":{"facility":13225},"holidayMin":317,"absentDays":0,"paidMin":0,"uncountedMin":960,"legalInOverMin":0,"over60Min":0,"nightShiftCount":0,"schedDays":27,"counts":{"早":22,"遅":5}},{"staff_id":"sT02","emp_code":"9002","workDays":3,"paidDays":1,"workMin":1440,"schedInMin":960,"overtimeMin":0,"legalOverMin":0,"nightMin":600,"lateCount":0,"lateMin":0,"earlyLeaveCount":0,"earlyLeaveMin":0,"noPunchDays":1,"reviewCount":1,"byOffice":{"visit":1440},"holidayMin":480,"absentDays":0,"paidMin":480,"uncountedMin":30,"legalInOverMin":0,"over60Min":0,"nightShiftCount":2,"schedDays":5,"counts":{"(22":2,"有":1,"早":1}}],"r30_v":[{"staff_id":"sT01","emp_code":"9001","workDays":28,"paidDays":0,"workMin":13225,"schedInMin":10628,"overtimeMin":480,"legalOverMin":2280,"nightMin":0,"lateCount":6,"lateMin":72,"earlyLeaveCount":6,"earlyLeaveMin":180,"noPunchDays":0,"reviewCount":17,"byOffice":{"facility":13225},"holidayMin":317,"absentDays":0,"paidMin":0,"uncountedMin":960,"legalInOverMin":0,"over60Min":0,"nightShiftCount":0,"schedDays":27,"counts":{"早":22,"遅":5}},{"staff_id":"sT02","emp_code":"9002","workDays":3,"paidDays":1,"workMin":1440,"schedInMin":960,"overtimeMin":0,"legalOverMin":0,"nightMin":600,"lateCount":0,"lateMin":0,"earlyLeaveCount":0,"earlyLeaveMin":0,"noPunchDays":1,"reviewCount":1,"byOffice":{"visit":1440},"holidayMin":480,"absentDays":0,"paidMin":480,"uncountedMin":30,"legalInOverMin":0,"over60Min":0,"nightShiftCount":2,"schedDays":5,"counts":{"(22":2,"有":1,"早":1}}],"r30_n":[{"staff_id":"sT01","emp_code":"9001","workDays":28,"paidDays":0,"workMin":13225,"schedInMin":11468,"overtimeMin":480,"legalOverMin":1440,"nightMin":0,"lateCount":6,"lateMin":72,"earlyLeaveCount":6,"earlyLeaveMin":180,"noPunchDays":0,"reviewCount":17,"byOffice":{"facility":13225},"holidayMin":317,"absentDays":0,"paidMin":0,"uncountedMin":960,"legalInOverMin":0,"over60Min":0,"nightShiftCount":0,"schedDays":27,"counts":{"早":22,"遅":5}},{"staff_id":"sT02","emp_code":"9002","workDays":3,"paidDays":1,"workMin":1440,"schedInMin":960,"overtimeMin":0,"legalOverMin":0,"nightMin":600,"lateCount":0,"lateMin":0,"earlyLeaveCount":0,"earlyLeaveMin":0,"noPunchDays":1,"reviewCount":1,"byOffice":{"visit":1440},"holidayMin":480,"absentDays":0,"paidMin":480,"uncountedMin":30,"legalInOverMin":0,"over60Min":0,"nightShiftCount":2,"schedDays":5,"counts":{"(22":2,"有":1,"早":1}}]};
const c1 = {}, c2 = {};
for (let d = 1; d <= 31; d++) { const w = new Date(Date.UTC(2026, 11, d)).getUTCDay(); if (w !== 0) c1[d] = d % 5 === 0 ? '遅' : '早'; }
c2[2] = '(22'; c2[3] = '8)'; c2[9] = '(22'; c2[10] = '8)'; c2[16] = '有'; c2[20] = '早'; c2[21] = '早';
const gSched = build({ sT01: c1, sT02: c2 });
const gPun = [], gDays = [];
pid = 0;
for (let d = 1; d <= 31; d++) {
  const ds = '2026-12-' + String(d).padStart(2, '0'), s = c1[d];
  if (!s) { if (d === 6) gPun.push(P('sT01', 'in', ds, '9:00'), P('sT01', 'out', ds, '15:17')); continue; }
  if (s === '早') { gPun.push(P('sT01', 'in', ds, d % 3 ? '6:50' : '7:12'), P('sT01', 'out', ds, d % 4 ? '16:40' : '15:30')); if (d % 4) gDays.push({ staff_id: 'sT01', work_date: ds, overtime_ok: d % 2 === 0, rev: 1 }); }
  else gPun.push(P('sT01', 'in', ds, '11:55'), P('sT01', 'out', ds, '22:07'));
}
gPun.push(P('sT02', 'in', '2026-12-02', '21:50'), P('sT02', 'out', '2026-12-03', '8:20'), P('sT02', 'in', '2026-12-09', '22:00'), P('sT02', 'out', '2026-12-10', '8:00'), P('sT02', 'in', '2026-12-20', '7:00'), P('sT02', 'out', '2026-12-20', '16:00'));
const gMonth = (r30, vm) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: gSched, punches: gPun, days: gDays, config: { monthRound30: r30, variableMonth: vm, legal_holiday: 0 }, now: NOW });
for (const r30 of [false, true]) for (const vm of [true, false]) {
  const key = (r30 ? 'r30' : 'raw') + (vm ? '_v' : '_n'), rows = C.snapshotOf(gMonth(r30, vm)).rows, old = GOLDEN[key];
  const same = rows.length === old.length && rows.every((r, i) => Object.keys(old[i]).every((k) => JSON.stringify(r[k]) === JSON.stringify(old[i][k])));
  t('控えの行が直す前と同じ（' + (r30 ? '月の30分丸め' : '丸めなし') + '・' + (vm ? '変形あり' : '変形なし') + '・前からある鍵の全部）', same, same ? undefined : rows);
}

console.log('\n— 3. A5 予定の終わりから4時間を超える残業 —');
const a5Sched = build({ sT01: { 1: '早', 2: '早', 3: '早', 4: '早', 7: '(22', 8: '8)' } });
pid = 100;
const a5Pun = [P('sT01', 'in', '2026-12-01', '7:00'), P('sT01', 'out', '2026-12-01', '20:30'),
  P('sT01', 'in', '2026-12-02', '7:00'), P('sT01', 'out', '2026-12-02', '20:00'),
  P('sT01', 'in', '2026-12-03', '2:30'), P('sT01', 'out', '2026-12-03', '16:00'),
  P('sT01', 'in', '2026-12-04', '7:00'), P('sT01', 'out', '2026-12-04', '21:00'),
  P('sT01', 'in', '2026-12-07', '22:00'), P('sT01', 'out', '2026-12-08', '13:00')];
const a5 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: a5Sched, punches: a5Pun, days: [{ staff_id: 'sT01', work_date: '2026-12-04', overtime_ok: true, rev: 1 }], config: {}, now: NOW });
const a5d = (d) => a5.people[0].days.find((x) => x.date === d);
const a5f = (d) => a5d(d) ? a5d(d).blocks.map((b) => (b.sched ? 'S' : '-') + b.workMin + ':' + b.flags.join('|')).join(' / ') : '';
/* ★直す前の版（kintai-calc.js ?v=2026-11-20.1）で固めた動き: 12/1・12/3・12/4・12/7〜8 は出勤と退勤が2つの組に割れて実働0（出勤漏れ・退勤漏れが2件ずつ）・
   月の合計は実働480分・要確認9件だった（同じ材料で先に試験を通してから直した）。12/2（ちょうど4時間）は直す前も後も1組・実働480分・残業の確認。
   直した後（反証A5）: 片方の端だけが予定の塊の ±4時間に入る組は割らず、その塊の早出・残業として数える（数えるのは予定までで、確認の印が出る） */
t('A5: 4時間ちょうど（12/2 16:00 終わり→20:00 退勤）は1組・実働480分・残業の確認（直す前と同じ）', a5f('2026-12-02') === 'S480:overtime', a5f('2026-12-02'));
t('A5: 4時間を超えた退勤（12/1 20:30）も1組・実働480分（予定の終わりまで）・残業の確認（直す前は割れて実働0）', a5f('2026-12-01') === 'S480:overtime', a5f('2026-12-01'));
t('A5: 始まりの4時間より前の出勤（12/3 2:30）も1組・実働480分（予定の開始から）・早出の確認（直す前は割れて実働0）', a5f('2026-12-03') === 'S480:early', a5f('2026-12-03'));
t('A5: 残業を全部認めた日（12/4 7:00〜21:00）は打刻どおり実働780分（直す前は割れて実働0）', a5f('2026-12-04') === 'S780:', a5f('2026-12-04'));
t('A5: 夜勤（22→翌8）の後に5時間残った日は夜勤の1組・実働480分・残業の確認（翌日の出勤漏れにしない・直す前は割れて実働0）', a5f('2026-12-07') === 'S480:overtime' && a5f('2026-12-08') === '', [a5f('2026-12-07'), a5f('2026-12-08')]);
const a5s = a5.people[0].sum;
t('A5: 月の合計 実働2700分・残業300分・法定外300分・深夜300分・夜勤1回・要確認4件（直す前は実働480分・要確認9件・夜勤0回）', a5s.workMin === 2700 && a5s.overtimeMin === 300 && a5s.legalOverMin === 300 && a5s.nightMin === 300 && a5s.nightShiftCount === 1 && a5s.reviewCount === 4, a5s);
/* 指摘5（遅番の退勤漏れと翌日の出勤漏れを1組にしない）は kintai_calc_test.js の 4b が期待を変えずに確かめる。ここでも同じ形を1つ確かめる */
{
  const s5 = build({ sT01: { 5: '13-22', 6: '9-12' } });
  const m5 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: s5, punches: [P('sT01', 'in', '2026-12-05', '12:55'), P('sT01', 'out', '2026-12-06', '12:00')], days: [], config: {}, now: NOW });
  const f5 = (d) => m5.people[0].days.find((x) => x.date === d).blocks.map((b) => b.flags.join('|')).join(' / ');
  t('A5 の直しの後も、出勤と退勤が別の日の予定に入る組は割る（指摘5: 12/5 退勤漏れ・12/6 出勤漏れ）', /missing_out/.test(f5('2026-12-05')) && /missing_in/.test(f5('2026-12-06')), [f5('2026-12-05'), f5('2026-12-06')]);
}

console.log('\n— 4. A6 同じ日にシフトの有休と手入力の半日 —');
const a6Sched = build({ sT01: { 11: '有', 14: '有' } });
const a6Uses = [{ id: 'u1', staff_id: 'sT01', use_date: '2026-12-11', days: 0.5 }, { id: 'u2', staff_id: 'sT01', use_date: '2026-12-14', days: 1 }];
const a6 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: a6Sched, punches: [], days: [], leave_uses: a6Uses, config: {}, now: NOW });
const a6d = (d) => a6.people[0].days.find((x) => x.date === d);
const a6u = L.usesFromMonth(a6, a6Uses);
/* ★直す前の版で固めた動き: 12/11（シフトの有＋手入力の半日）は計算が1日・480分、台帳は0.5日（食い違い）・月の有休 2日・960分だった。
   直した後（反証A6）: 手入力を正にする（画面の文「同じ日に両方ある時は手入力の方」にそろえる）。シフトと手入力がどちらも1日の日（12/14）は直す前と同じ値 */
t('A6: 12/11（シフトの有＋手入力の半日）は計算も台帳も0.5日・240分（直す前は計算が1日・480分）', a6d('2026-12-11').paidDays === 0.5 && a6d('2026-12-11').paidMin === 240 && a6u.find((u) => u.use_date === '2026-12-11').days === 0.5, [a6d('2026-12-11'), a6u]);
t('A6: 12/14（シフトの有＋手入力の1日）は計算も台帳も1日・480分（直す前と同じ）', a6d('2026-12-14').paidDays === 1 && a6d('2026-12-14').paidMin === 480 && a6u.find((u) => u.use_date === '2026-12-14').days === 1);
t('A6: 台帳は「シフトの有休もある日・手入力を数える」のまま（alsoShift）・シフトの行もある日は leaveUse の印を付けない', a6u.every((u) => u.src === 'manual' && u.alsoShift === true) && !('leaveUse' in a6d('2026-12-11')) && !('leaveUse' in a6d('2026-12-14')), a6u);
t('A6: 月の有休 1.5日・720分（直す前は 2日・960分）・締めの控えも同じ（給与へ渡る）', a6.people[0].sum.paidDays === 1.5 && a6.people[0].sum.paidMin === 720 && C.snapshotOf(a6).rows[0].paidDays === 1.5 && C.snapshotOf(a6).rows[0].paidMin === 720, a6.people[0].sum);
{
  /* シフトの有休の時間が480分でない日（記号の所定の時間が6時間など）で手入力が1日の時は、シフトの時間のまま（直す前と同じ）。半日はその半分 */
  const pr = (d, min) => ({ staff_id: 'sT01', work_date: '2026-12-' + d, seq: 9, kind: 'paid', start_at: null, end_at: null, break_min: 0, paid_min: min, office: 'facility', symbol: '有' });
  const m6 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: [pr('17', 360), pr('18', 360)], punches: [], days: [], leave_uses: [{ id: 'v1', staff_id: 'sT01', use_date: '2026-12-17', days: 1 }, { id: 'v2', staff_id: 'sT01', use_date: '2026-12-18', days: 0.5 }], config: {}, now: NOW });
  const d6 = (d) => m6.people[0].days.find((x) => x.date === d);
  t('A6: シフトの有休が360分の日の手入力1日は360分・1日（直す前と同じ）・半日は180分・0.5日（直す前は360分・1日）', d6('2026-12-17').paidMin === 360 && d6('2026-12-17').paidDays === 1 && d6('2026-12-18').paidMin === 180 && d6('2026-12-18').paidDays === 0.5, [d6('2026-12-17'), d6('2026-12-18')]);
  /* シフトの有休が240分（比の式でシフトは半日）の日: 手入力の半日は直す前と同じ（240分・0.5日）。手入力の1日は日数だけ1日（直す前は0.5日）で、時間は増やさず240分のまま（1日の時間の基準は A7 の判断待ち） */
  const m7 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: [pr('21', 240), pr('22', 240)], punches: [], days: [], leave_uses: [{ id: 'w1', staff_id: 'sT01', use_date: '2026-12-21', days: 0.5 }, { id: 'w2', staff_id: 'sT01', use_date: '2026-12-22', days: 1 }], config: {}, now: NOW });
  const d7 = (d) => m7.people[0].days.find((x) => x.date === d);
  t('A6: シフトの有休が240分の日の手入力の半日は240分・0.5日（直す前と同じ）・1日は240分・1日（直す前は0.5日・時間は増やさない）', d7('2026-12-21').paidMin === 240 && d7('2026-12-21').paidDays === 0.5 && d7('2026-12-22').paidMin === 240 && d7('2026-12-22').paidDays === 1, [d7('2026-12-21'), d7('2026-12-22')]);
  /* 働く予定もある日（早 7-16・実働480分）にシフトの有休240分（比の式で半日）と手入力の半日: 日数も時間も直す前と同じ */
  const m8 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: build({ sT01: { 23: '早' } }).concat([pr('23', 240)]), punches: [P('sT01', 'in', '2026-12-23', '7:00'), P('sT01', 'out', '2026-12-23', '16:00')], days: [], leave_uses: [{ id: 'x1', staff_id: 'sT01', use_date: '2026-12-23', days: 0.5 }], config: {}, now: NOW });
  const m8b = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 1), schedule: build({ sT01: { 23: '早' } }).concat([pr('23', 240)]), punches: [P('sT01', 'in', '2026-12-23', '7:00'), P('sT01', 'out', '2026-12-23', '16:00')], days: [], config: {}, now: NOW });
  const d8 = m8.people[0].days.find((x) => x.date === '2026-12-23'), d8b = m8b.people[0].days.find((x) => x.date === '2026-12-23');
  t('A6: 働く予定もある日にシフトの有休と手入力の日数が同じ時は、手入力が無い時と同じ値', d8.paidMin === d8b.paidMin && d8.paidDays === d8b.paidDays && d8.paidDays === 0.5, [d8.paidMin, d8.paidDays, d8b.paidMin, d8b.paidDays]);
}

console.log('\n— 2. 丸める前の法定外・休日労働 —');
for (const vm of [true, false]) {
  const raw = gMonth(false, vm), r30 = gMonth(true, vm);
  const ok0 = raw.people.every((p) => p.sum.legalOverRawMin === p.sum.legalOverMin && p.sum.holidayRawMin === p.sum.holidayMin);
  const ok1 = r30.people.every((p, i) => p.sum.legalOverRawMin === raw.people[i].sum.legalOverMin && p.sum.holidayRawMin === raw.people[i].sum.holidayMin);
  t('丸めない時は今の値と同じ・丸める時は丸めない時の値（' + (vm ? '変形あり' : '変形なし') + '）', ok0 && ok1, r30.people.map((p) => [p.sum.legalOverMin, p.sum.legalOverRawMin]));
  const sn = C.snapshotOf(r30).rows;
  t('締めの控えの行にも丸める前の値が入る（' + (vm ? '変形あり' : '変形なし') + '）', sn.every((r, i) => r.legalOverRawMin === r30.people[i].sum.legalOverRawMin && r.holidayRawMin === r30.people[i].sum.holidayRawMin));
}
t('変形なし・丸める月の甲は 丸めた法定外 1440分・丸める前 1460分（違いが出る材料）', gMonth(true, false).people[0].sum.legalOverMin === 1440 && gMonth(true, false).people[0].sum.legalOverRawMin === 1460);

console.log('\n— 5. 36協定の設定を計算の設定で落とさない —');
{
  const a = { startMonth: 10, monthLimitH: 40 };
  const f = C.fillConfig({ agreement36: a, overtimeMonthWarnH: 30 });
  t('fillConfig は agreement36 を写す（中身は変えない・元の物と別の物）', JSON.stringify(f.agreement36) === JSON.stringify(a) && f.agreement36 !== a);
  t('agreement36 が無い・形の違う時は鍵を作らない（今の出力と同じ）', JSON.stringify(C.fillConfig({})) === JSON.stringify(C.fillConfig({ agreement36: null })) && !('agreement36' in C.fillConfig({ agreement36: [1] })) && !('agreement36' in C.fillConfig({ agreement36: 'x' })) && !('agreement36' in C.fillConfig({})));
  const m = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: gSched, punches: gPun, days: gDays, config: { agreement36: a, legal_holiday: 0 }, now: NOW });
  t('agreement36 を入れても数えた値は同じ', JSON.stringify(C.snapshotOf(m).rows) === JSON.stringify(C.snapshotOf(gMonth(false, true)).rows));
}


console.log('\n— 6. 画面（kintai.js の関数を取り出して動かす）—');
{
  const fs = require('fs');
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8'), H = fs.readFileSync(path.join(ROOT, 'kintai.html'), 'utf8');
  const fnSrc = (name) => { const i = K.indexOf('  function ' + name + '('); if (i < 0) return ''; const j = K.indexOf('\n  }\n', i); return K.slice(i, j + 4); };
  const between = (a, b) => { const i = K.indexOf(a), j = K.indexOf(b, i + 1); return i >= 0 && j > i ? K.slice(i, j) : ''; };
  const A36 = require(path.join(ROOT, 'kintai-36.js'));
  /* 6-1 設定の保存: 欄に無い今の設定の鍵（agreement36・ほかの鍵）を残して送る・36協定の欄が範囲の外なら送らない */
  {
    const a36Fields = between('  var A36_FIELDS = [', '  function a36Form(');
    const run = (cur, vals, a36vals) => {
      const sent = [], alerts = [];
      const el = (v, checked) => ({ value: v, checked: !!checked });
      const els = { 's-earlyAlertMin': el('30'), 's-overtimeAlertMin': el('30'), 's-overtimeMonthWarnH': el('45'), 's-weekStartDow': el('0'), 's-closeDay': el('0'), 's-variableMonth': el('', true), 's-monthRound30': el('', false), 's-csvTime': el('hmm'), 's-legal': el('') };
      Object.assign(els, vals || {});
      if (a36vals) { els['g-a36'] = {}; for (const k in a36vals) els['a-' + k] = typeof a36vals[k] === 'boolean' ? el('', a36vals[k]) : el(String(a36vals[k])); }
      const f = new Function('C', 'K36', 'CUR', 'ELS', 'SENT', 'ALERTS', `
        var busy = false, data = { settings: { config: CUR, rev: 3 } };
        function isAdmin() { return true; } function $(id) { return ELS[id] || null; } function alert(m) { ALERTS.push(m); }
        function pressBusy() { return function () {}; } function sync() {} function toast() {} function load() {} function note() {} function msgOf() { return ''; }
        function okOr(r) { return r; } function rawCfg() { return (data && data.settings && data.settings.config) || {}; }
        function rpc(n, a) { SENT.push([n, a]); return new Promise(function () {}); }
        ${between('  var SET_FIELDS = [', '  function paintSettings(')}
        ${a36Fields}
        ${fnSrc('readA36')}
        ${fnSrc('saveSettings')}
        saveSettings({});`);
      f(C, A36, cur, els, sent, alerts);
      return { sent, alerts };
    };
    const cur = { foo: 'keep', earlyAlertMin: 20, agreement36: { startMonth: 10, monthLimitH: 40, monthWarnH: 30 } };
    const r1 = run(cur, null, { startMonth: 10, monthLimitH: 40, yearLimitH: 360, yearWarnH: 288, special: false, specialMonthMaxH: 100, specialAvgH: 80, specialYearH: 720, specialCountMax: 6 });
    const cfg1 = r1.sent[0] && r1.sent[0][1].p_config;
    t('設定の保存: 欄に無い今の鍵（foo）と agreement36 の欄に無い鍵（monthWarnH）を残し、欄の値で上書きして送る', !!cfg1 && cfg1.foo === 'keep' && cfg1.earlyAlertMin === 30 && cfg1.agreement36.monthLimitH === 40 && cfg1.agreement36.startMonth === 10 && cfg1.agreement36.monthWarnH === 30 && r1.sent[0][1].p_rev === 3, r1);
    const r2 = run(cur, null, null);
    t('設定の保存: 36協定の欄が無い画面（部品が読めない時）でも、今の agreement36 を消さない', r2.sent.length === 1 && JSON.stringify(r2.sent[0][1].p_config.agreement36) === JSON.stringify(cur.agreement36), r2);
    const r3 = run(cur, null, { startMonth: 4, monthLimitH: 50, yearLimitH: 360, yearWarnH: 288, special: false, specialMonthMaxH: 100, specialAvgH: 80, specialYearH: 720, specialCountMax: 6 });
    t('設定の保存: 36協定の月の上限が範囲の外（50時間）なら送らずに知らせる', r3.sent.length === 0 && /36協定の欄に範囲の外の値があります/.test(r3.alerts[0] || ''), r3);
    const D = A36.DEFAULTS;
    const r4 = run({ earlyAlertMin: 30 }, null, { startMonth: D.startMonth, monthLimitH: D.monthLimitH, yearLimitH: D.yearLimitH, yearWarnH: D.yearWarnH, special: D.special, specialMonthMaxH: D.specialMonthMaxH, specialAvgH: D.specialAvgH, specialYearH: D.specialYearH, specialCountMax: D.specialCountMax });
    t('設定の保存: 今の設定に agreement36 が無く欄が既定のままなら、鍵を作らない（無い時と同じ動き）', r4.sent.length === 1 && !('agreement36' in r4.sent[0][1].p_config), r4.sent);
    const r5 = run({ earlyAlertMin: 30 }, null, { startMonth: 1, monthLimitH: D.monthLimitH, yearLimitH: D.yearLimitH, yearWarnH: D.yearWarnH, special: true, specialMonthMaxH: 90, specialAvgH: D.specialAvgH, specialYearH: D.specialYearH, specialCountMax: 3 });
    const a5 = r5.sent[0] && r5.sent[0][1].p_config.agreement36;
    t('設定の保存: 変えた欄（起算月1月・特別条項あり・月90時間・3回）が agreement36 に入り、読み直すと同じ値で埋まる', !!a5 && A36.fillAgreement({ agreement36: a5 }).startMonth === 1 && A36.fillAgreement({ agreement36: a5 }).special === true && A36.fillAgreement({ agreement36: a5 }).specialMonthMaxH === 90 && A36.fillAgreement({ agreement36: a5 }).specialCountMax === 3, a5);
    const r6 = run({ earlyAlertMin: 20, foo: 1 }, { 's-earlyAlertMin': { value: '' } }, null);
    t('設定の保存: 空にした欄は今までどおり送らない（今の値を写して残さない＝既定に戻る）・欄に無い鍵は残す', r6.sent.length === 1 && !('earlyAlertMin' in r6.sent[0][1].p_config) && r6.sent[0][1].p_config.foo === 1, r6.sent);
    t('読み込み: 月の計算の設定（fillConfig）を通っても agreement36 が残る（締めの控えの config にも残る）', JSON.stringify(C.fillConfig(r1.sent[0][1].p_config).agreement36) === JSON.stringify(cfg1.agreement36));
    t('36協定の欄は今の設定から出す（締めた月分の控えから出さない）・保存は「設定を保存する」と同じボタン（管理者だけ）', /var a = K36\.fillAgreement\(rawCfg\(\)\);/.test(K) && /'<\/form>' \+ a36Form\(\) \+ '<div class="row"><button type="button" class="btn pri" data-act="save-set"' \+ \(isAdmin\(\) \? '' : ' disabled'\)/.test(K));
  }
  /* 6-2 締めの止め（A2＝C2・仮置き） */
  {
    const src = fnSrc('lockBlockers');
    const blk = (m) => new Function('M', `var month = M; function dispName(s) { return s.name; }\n${src}\nreturn lockBlockers();`)(m);
    const s7 = build({ sT01: { 31: '(22' }, sT02: { 31: '早' } });
    const nowNight = Date.parse('2027-01-01T03:00:00+09:00');
    const mk = (pun, now) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: s7, punches: pun, days: [], config: {}, now });
    const b1 = blk(mk([P('sT01', 'in', '2026-12-31', '22:00')], nowNight));
    t('締めの止め: 期間の翌朝・夜勤の途中（勤務中）の人を名前と日付で返す', b1.length === 1 && b1[0].name === '試験 甲' && b1[0].date === '2026-12-31' && b1[0].kind === '勤務中', b1);
    const b2 = blk(mk([], Date.parse('2026-12-31T08:00:00+09:00')));
    t('締めの止め: 予定の開始から15分を過ぎてまだ出勤していない人も返す', b2.some((x) => x.name === '試験 乙' && x.kind === 'まだ出勤していない'), b2);
    const b3 = blk(mk([P('sT01', 'in', '2026-12-31', '22:00'), P('sT01', 'out', '2027-01-01', '8:00'), P('sT02', 'in', '2026-12-31', '7:00'), P('sT02', 'out', '2026-12-31', '16:00')], NOW));
    t('締めの止め: 退勤まで済んだ月は止めない（0件）', b3.length === 0, b3);
    const goFn = between('function lockGo(', 'function unlockMonth(');
    t('締める前（窓を開く時）と「締める」を押して読み直した後の両方で止める・止めた窓には「締める」を出さない（文は仮置き）',
      /openLock\(lockFigures\(\), null, lockBlockers\(\)\);/.test(K) && goFn.indexOf('lockBlockers()') > goFn.indexOf('recompute()') && goFn.indexOf('lockBlockers()') < goFn.indexOf('sameFigures(shown, now)') && /if \(blk\.length\) \{ busy = false; openLock\(now, null, blk\); return; \}/.test(goFn) &&
      /, bl\.length > 0, '締める', 'lock-go'\);/.test(K) && /勤務中か、まだ出勤していない人がいるため、締められません/.test(K) && goFn.indexOf("rpc('kintai_month_lock'") > goFn.indexOf('lockBlockers()'));
  }
  /* 6-3 個人の月の警告の帯 */
  {
    const src = fnSrc('warnLines') + '\n' + fnSrc('oldNote');
    const run = (warns, th, j) => new Function('W', 'TH', 'J', `var month = { config: { overtimeMonthWarnH: TH } };\n${src}\nreturn warnLines({ staff: { staff_id: 'sT01' }, sum: { warnings: W } }, J ? { sT01: J } : null);`)(warns, th, j);
    const calcW = '法定外の時間が月45時間以上です（36協定の確認）';
    t('帯: 判定がまだ無い時は今の警告のまま', JSON.stringify(run([calcW], 45, null)) === JSON.stringify([calcW]));
    const j1 = { agreement: { monthWarnH: 45 }, items: [{ code: 'month_warn', text: calcW }, { code: 'year_warn', text: '法定外の今年度の累計が 300時間です' }], old: [] };
    const w1 = run([calcW], 45, j1);
    t('帯: 月の目安が同じ値の時は今の文をそのまま出し、判定の同じ文（month_warn）は重ねない・ほかの判定は足す', w1[0] === calcW && w1.length === 2 && w1[1] === '36協定: 法定外の今年度の累計が 300時間です', w1);
    const j2 = { agreement: { monthWarnH: 36 }, items: [{ code: 'month_warn', text: '法定外の時間が月36時間以上です（36協定の確認）' }], old: ['2026-10'] };
    const w2 = run([calcW, 'ほかの警告'], 45, j2);
    t('帯: 36協定で月の目安を変えた時は計算の文を出さず判定の文を出す・ほかの警告は残す・古い控えの注記', w2.indexOf(calcW) < 0 && w2.indexOf('ほかの警告') >= 0 && w2.indexOf('36協定: 法定外の時間が月36時間以上です（36協定の確認）') >= 0 && /10月分/.test(w2[w2.length - 1]), w2);
    t('計算の部品の警告の文は変えていない（月の法定外が目安以上）', /sum\.warnings\.push\('法定外の時間が月' \+ cfg\.overtimeMonthWarnH \+ '時間以上です（36協定の確認）'\)/.test(fs.readFileSync(path.join(ROOT, 'kintai-calc.js'), 'utf8')));
  }
  /* 6-4 36協定の月の列（締めた月分は控えの丸める前の値・古い控えは丸めた値と印・締めていない月分は数えた値） */
  {
    const src = fnSrc('row36');
    const run = (mm) => { const old = []; const r = new Function('C', 'MM', 'OLD', `${src}\nreturn row36(MM, 'sT01', '2026-10', OLD);`)(C, mm, old); return { r, old }; };
    const lockedNew = run({ k36: { locked: true, rows: [{ staff_id: 'sT01', legalOverMin: 1440, legalOverRawMin: 1460, holidayMin: 60, holidayRawMin: 60 }], snapCfg: { monthRound30: true, legal_holiday: 0 } } });
    t('列: 締めた月分は控えの丸める前の値（1460分）・法定休日を決めた月', lockedNew.r.legalOverMin === 1460 && lockedNew.r.holidayMin === 60 && lockedNew.r.locked && lockedNew.r.holidayKnown && !lockedNew.old.length, lockedNew);
    const lockedOld = run({ k36: { locked: true, rows: [{ staff_id: 'sT01', legalOverMin: 1440, holidayMin: 0 }], snapCfg: { monthRound30: true, legal_holiday: null } } });
    t('列: 丸める前の値の無い古い控えで丸めた月は、丸めた値（1440分）で読み、注記の印・法定休日なし', lockedOld.r.legalOverMin === 1440 && lockedOld.old.join() === '2026-10' && lockedOld.r.holidayKnown === false, lockedOld);
    const lockedOld2 = run({ k36: { locked: true, rows: [{ staff_id: 'sT01', legalOverMin: 1440, holidayMin: 0 }], snapCfg: { monthRound30: false } } });
    t('列: 丸めていない古い控えは注記を出さない（丸めた値と丸める前が同じ）', lockedOld2.r.legalOverMin === 1440 && !lockedOld2.old.length);
    const live = gMonth(true, false); live.k36 = { locked: false };
    const lv = new Function('C', 'MM', `${src}\nreturn row36(MM, 'sT01', '2026-12', []);`)(C, live);
    t('列: 締めていない月分は数えた丸める前の値（丸めた 1440 でなく 1460）', lv.legalOverMin === 1460 && lv.holidayKnown === true && lv.locked === false, lv);
    t('列は有給のタブと同じ読み込みの月分（loadLeaveMonths の本文は変えず、monthFor で締めの様子を付ける）・入職日より前の月は記録0の月', /m\.k36 = k36Info\(d\);/.test(between('function monthFor(', 'function leaveFloorYm(')) && /if \(!r && \(\(hire && y < hire\.slice\(0, 7\)\) \|\| \(zeroBelow && y < oldest\)\)\) r = \{ ym: y, legalOverMin: 0, holidayMin: 0, locked: true, holidayKnown: true \};/.test(K) && !/kintai_month_get/.test(between('function a36Map(', 'function oldNote(')));
  }

  /* 6-4b 36協定の月の列: 使い始めたばかりの施設（記録は今月分だけ）で、全員に「確かめられません」を出さない */
  {
    const src = ['rawCfg', 'k36Info', 'monthsBy', 'hireOfStaff', 'row36', 'a36Map'].map(fnSrc).join('\n');
    const L2 = require(path.join(ROOT, 'kintai-leave.js'));
    const mkm = (ym, withRec) => {
      const nd = C.daysIn(ym), cells = {};
      if (withRec) for (let d = 1; d <= nd; d++) if (new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, d)).getUTCDay() % 6) cells[d] = '早';
      const sc = C.buildSchedule({ ym, plan: { cells: { sT01: cells } }, nextPlan: {}, staff: STAFF.slice(0, 1), symbols: Sym.DEFAULT_SYMBOLS, settings: {} }).rows;
      const m = C.computeMonth({ ym, staff: K_STAFF.slice(0, 1), schedule: sc, punches: [], days: [], config: {}, now: Date.parse('2026-11-20T10:00:00+09:00') });
      m.k36 = { locked: false, rows: null, snapCfg: null };
      return m;
    };
    /* 有給の読み込みは 今月分（11月）・来月分（12月）と、空が3つ続いた 10・9・8月分まで（それより前は読まない） */
    const loaded = [mkm('2026-12', false), mkm('2026-11', true), mkm('2026-10', false), mkm('2026-09', false), mkm('2026-08', false)];
    const judge = (ymx, months) => new Function('C', 'L', 'K36', 'LS', 'CUR', 'YM', `
      var leaveSt = LS, monthCache = {}, month = CUR, ym = YM, data = { settings: { config: {} } };
      function today() { return '2026-11-20'; } function dispName(s) { return s.name; } function masterOf() { return null; }
      ${src}
      return a36Map(YM);`)(C, L2, A36, { months: months, profiles: {} }, months.find((m) => m.ym === ymx) || mkm(ymx, false), ymx);
    const j1 = judge('2026-11', loaded);
    t('36協定の列: 読み込みが止まった所（8月分）より前の月は記録0の月として渡す＝入職日の分からない人にも「確かめられません」を出さない', j1 && j1.sT01 && !j1.sT01.items.some((it) => it.code === 'avg_unknown'), j1 && j1.sT01 && j1.sT01.items);
    const j2 = judge('2026-06', loaded);
    t('36協定の列: 読んだ範囲より古い月分（6月分）を見ている時は、読んでいない月を0にしない（「確かめられません」）', j2 && j2.sT01 && j2.sT01.items.some((it) => it.code === 'avg_unknown'), j2 && j2.sT01 && j2.sT01.items);
    const j3 = new Function('C', 'L', 'K36', `var leaveSt = null, monthCache = {}, month = {}, ym = '2026-11', data = null; function today() { return '2026-11-20'; }\n${src}\nreturn a36Map('2026-11');`)(C, L2, A36);
    t('36協定の列: 有給の読み込みがまだ・読めない時は判定しない（null・帯は今の計算の警告のまま）', j3 === null);
  }
  /* 6-5 締めの控えと今の数字を比べる鍵 */
  {
    const keys = new Function(between('  var SNAP_KEYS = [', '  var SNAP_FILL') + '\nreturn SNAP_KEYS;')();
    t('比べる鍵に legalInOverMin・over60Min・nightShiftCount・schedDays を足した（丸める前の値は入れない）', ['legalInOverMin', 'over60Min', 'nightShiftCount', 'schedDays', 'workMin', 'legalOverMin'].every((k) => keys.includes(k)) && !keys.includes('legalOverRawMin') && !keys.includes('holidayRawMin'), keys);
    const sc = new Function(fnSrc('countsOf') + '\n' + fnSrc('sameCounts') + '\nreturn sameCounts;')();
    t('記号ごとの回数（counts）も比べる（0 は無いのと同じ・違う回数・違う記号は違う）', sc({ 早: 2, 遅: 0 }, { 早: 2 }) && !sc({ 早: 2 }, { 早: 3 }) && !sc({ 早: 2 }, { 遅: 2 }) && sc({}, null), null);
    t('控えに counts が無い古い控えは counts を比べない', /\(r\.counts && typeof r\.counts === 'object' && !sameCounts\(r\.counts, p\.sum\.counts\)\)/.test(K));
  }
  /* 6-6 有給の窓（C3）: 保存の後の読み直しで開き直す時、保存していない入力（今の保存に使った欄を除く）を戻す */
  {
    const keepSrc = between('  var LV_USED = {', '  /* その日の実働（分）');
    const run = (init, now, act) => new Function('INIT', 'NOW', 'ACT', `function dlgMap() { return NOW; }\n${keepSrc}\nreturn keepOf({ initMap: INIT }, ACT);`)(init, now, act);
    const init = { 'lv-p-hire': '', 'lv-p-wd': '', 'skip:2026-04-01': '0', 'lv-u-date': '', 'lv-u-note': '', 'lv-reason': '', 'lv-g-date': '' };
    const now = { 'lv-p-hire': '2020-04-01', 'lv-p-wd': '3', 'skip:2026-04-01': '1', 'lv-u-date': '2026-12-01', 'lv-u-note': 'x', 'lv-reason': 'r', 'lv-g-date': '2026-12-02' };
    const k1 = run(init, now, 'lv-use-add');
    t('使用を足した時: 設定の欄（入職日・週の所定・付与しない日）と付与の欄は戻し、使った使用の欄は戻さない', k1['lv-p-hire'] === '2020-04-01' && k1['lv-p-wd'] === '3' && k1['skip:2026-04-01'] === '1' && k1['lv-g-date'] === '2026-12-02' && !('lv-u-date' in k1) && !('lv-u-note' in k1), k1);
    const k2 = run(init, now, 'lv-prof-save');
    t('設定を保存した時: 設定の欄と理由は戻さない（保存した値で開き直す）・ほかの入力は戻す', !('lv-p-hire' in k2) && !('skip:2026-04-01' in k2) && !('lv-reason' in k2) && k2['lv-u-date'] === '2026-12-01', k2);
    t('何も変えていなければ戻さない', run(init, init, 'lv-use-add') === null);
    t('読み直しで窓を開き直した後に戻す（loadLeave の終わり）・保存の前に控える（leaveAct）', /var kp = dlgCtx\.keep \|\| null; openLeave\(dlgCtx\.sid\); if \(kp\) dlgPut\(kp\);/.test(K) && /ctx\.keep = keepOf\(ctx, act\);\s*busy = true; msg\.textContent = '保存しています…';/.test(K) && /dlgCtx\.init = formState\(\); dlgCtx\.initMap = dlgMap\(\);/.test(K));
  }
  /* 6-7 設定タブ（C4）: タブ・月の切り替え・読み直し・取り込み・閉じる時に、保存していない設定の変更を確かめる（窓の dirty とは別） */
  {
    t('設定タブの確かめ: タブ（setTab）・前の月／次の月・月の欄（やめたら欄を戻す）・読み直す・シフトの取り込み（2か所）・閉じる・門番', /if \(!settingsLeaveOk\(\)\) return; tab = t;/.test(K) &&
      /\$\('g-prev'\)\.addEventListener\('click', function \(\) \{ if \(settingsLeaveOk\(\)\) setYm\(C\.prevYm\(ym\)\); \}\);/.test(K) && /\$\('g-next'\)\.addEventListener\('click', function \(\) \{ if \(settingsLeaveOk\(\)\) setYm\(C\.nextYm\(ym\)\); \}\);/.test(K) &&
      /else if \(id === 'g-ym'\) \{ if \(settingsLeaveOk\(\)\) setYm\(e\.target\.value\); else e\.target\.value = ym; \}/.test(K) && /\$\('g-reload'\)\.addEventListener\('click', function \(\) \{ if \(settingsLeaveOk\(\)\) load\(false\); \}\);/.test(K) &&
      (K.match(/else if \(settingsLeaveOk\(\)\) load\(true\);/g) || []).length === 2 && /if \(dirty\(\) \|\| settingsDirty\(\)\) \{ e\.preventDefault\(\);/.test(K) && /SUAppGate\.run\('kintai', \{ dirty: function \(\) \{ return dirty\(\) \|\| settingsDirty\(\); \} \}\)/.test(K));
    t('窓の確かめ（dirty）は今までどおり窓だけを見る（設定タブを混ぜない）', /function dirty\(\) \{\s*if \(!dlgCtx \|\| !DIRTY_MODES\[dlgCtx\.mode\] \|\| dlgCtx\.init == null\) return false;\s*return formState\(\) !== dlgCtx\.init;\s*\}/.test(K));
    const stSrc = fnSrc('settingsState');
    t('設定の入力の控えは、設定と36協定の欄だけ（勤怠の管理者の欄は数えない）・描いた時に控える', /'#g-set input,#g-set select,#g-a36 input,#g-a36 select'/.test(stSrc) && !/g-mgr/.test(stSrc) && /setInit = tab === 'settings' && \$\('g-set'\) \? settingsState\(\) : null;/.test(K));
    const els = [{ type: 'number', value: '30' }, { type: 'checkbox', checked: true }];
    const f = new Function('ELS', `var document = { querySelectorAll: function () { return ELS; } }, view = 'app', tab = 'settings', setInit = null;
      function $() { return {}; } var confirmed = 0; function confirm() { confirmed++; return false; }
      ${stSrc}\n${fnSrc('settingsDirty')}\n${fnSrc('settingsLeaveOk')}
      setInit = settingsState(); var a = settingsLeaveOk(); ELS[0].value = '40'; var b = settingsLeaveOk(); tab = 'day'; var c = settingsLeaveOk();
      return [a, b, c, confirmed];`);
    t('設定の入力を変えていなければ確かめない・変えたら確かめて、やめたら移らない・設定タブ以外では確かめない', JSON.stringify(f(els)) === JSON.stringify([true, false, true, 1]), f([{ type: 'number', value: '30' }, { type: 'checkbox', checked: true }]));
  }
  /* 6-8 ホーム */
  {
    t('ホームのタブは先頭・既定のタブ・箱は KintaiMonitor.boxes（申請の箱は出さない＝requests: null）・勤務の決まりは KintaiRules.checkMonth', /var TABS = \['home', 'day'/.test(K) && /tab = TABS\.indexOf\(t\) >= 0 \? t : 'home';/.test(K) && /data-tab="home">ホーム<\/button>/.test(H) &&
      /var input = \{ today: td, month: month, reviewList: C\.reviewList\(month\), requests: null \};/.test(K) && /input\.rules = RUL\.checkMonth\(month, rawCfg\(\)\);/.test(K) && /var bx = MON\.boxes\(input\)/.test(K));
    t('ホームは画面だけ（no-print）・有給と36協定は最初の描画の後に裏で読む（読めない時は「読み直す」・30秒ごとに試し直さない）', /function paintHome\(\) \{\s*var h = '<div class="cd no-print">';/.test(K) && /if \(L && !leaveSt && !leaveBusy\) loadLeave\(false\);   \/\* 重い読み込み/.test(K) && /waitBox\('36協定', t0, lv === 'err'\)/.test(K));
    t('新しい部品の読み込み（kintai-calc.js の後・kintai.js の前）と公開の許可（.gitignore）', ['kintai-36.js', 'kintai-monitor.js', 'kintai-rules.js'].every((f) => H.indexOf('<script src="' + f + '?v=2026-11-20"></script>') > H.indexOf('kintai-calc.js?v=') && H.indexOf(f + '?v=') < H.indexOf('kintai.js?v=') && new RegExp('^!/' + f.replace('.', '\\.') + '$', 'm').test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'))));
    t('日ごとの説明文は実際（30秒ごとに読み直す）に合わせた', /この画面は30秒ごとに読み直して数え直します。/.test(K) && !/1分ごとに数え直します/.test(K));
    t('ホームの箱・行の名前と文は esc を通す（innerHTML の代入は増やしていない＝paint の1か所で入る）', /'<b>' \+ esc\(r\.name\) \+ '<\/b> ' : ''\) \+ esc\(r\.text\)/.test(K) && /esc\(b\.title\)/.test(K) && /esc\(b\.note\)/.test(K) && !/innerHTML/.test(between('  /* ── v5 段2・3: ホーム', '  /* 要確認の一覧（v2・C-2）')));
    const lvTxt = /シフトに有休の記号がある日に入れた時も、勤怠の計算と残りは、こちらの日数（1日・半日）で数えます/.test(K) && !/勤怠の計算はシフトの方を数えます/.test(K);
    t('有給の窓の文を、手入力を正にした計算（A6）に合わせた', lvTxt);
  }
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
