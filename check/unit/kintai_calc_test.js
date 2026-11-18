/* 勤怠管理（kintai-calc.js）の純関数の試験（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1）
   実行: node check/unit/kintai_calc_test.js（環境変数 KINTAI_CALC で別の版を当てられる）
   守りたいこと:
     1. 予定より早い出勤は予定の開始（6:50→7:00）、予定より遅い退勤は予定の終わり（16:10→16:00）
     2. 遅刻・早退は打刻どおり。境目（30分）以上ずれた打刻は要確認。早出・残業を認めた日は打刻どおり
     3. 夜勤（22→翌8）の実働・深夜、月末の夜勤（翌月の上がり）
     4. 退勤漏れ・出勤漏れ・打刻なし・予定なし・分割勤務・有休・取り消した打刻
     5. 法定外（変形あり/なし）・月の30分の四捨五入・36協定の警告
     6. CSV の列・従業員コードの無い人の警告・式として読まれない
     7. shift-symbols.js がシフトアプリの原本と1字も違わない（原本の無い環境は省略）
   ★職員は架空（試験 甲・試験 乙）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.KINTAI_CALC || path.join(ROOT, 'kintai-calc.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const YM = '2026-12';
const NOW = Date.parse('2027-01-10T12:00:00+09:00');
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm, extra) => Object.assign({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() }, extra || {});
const STAFF = [
  { id: 'sT01', name: '試験 甲', mainDivision: '施設', empCode: '9001', employment: '正社員', active: true },
  { id: 'sT02', name: '試験 乙', mainDivision: '訪問', empCode: '', employment: 'パート', active: true }
];
const K_STAFF = [
  { staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' },
  { staff_id: 'sT02', name: '試験 乙', office: 'visit', emp_code: null }
];
function sched(cells1, cells2, sub, next) {
  return C.buildSchedule({ ym: YM, plan: { cells: { sT01: cells1 || {}, sT02: cells2 || {} }, subCells: sub || {} }, nextPlan: next || {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } });
}
function month(schedRows, punches, days, config) {
  return C.computeMonth({ ym: YM, staff: K_STAFF, schedule: schedRows, punches, days: days || [], config: config || {}, now: NOW });
}
function dayOf(m, sid, date) { const p = m.people.find((x) => x.staff.staff_id === sid); return p && p.days.find((d) => d.date === date); }
function sumOf(m, sid) { return m.people.find((x) => x.staff.staff_id === sid).sum; }

console.log('\n— 0. シフト → 予定 —');
{
  const s = sched({ 1: '早', 2: '(22', 3: '8)', 5: '有', 6: '休' });
  const r = s.rows.filter((x) => x.staff_id === 'sT01');
  t('早 → 7:00〜16:00・休憩60分・施設', r[0].work_date === '2026-12-01' && r[0].start_at === '2026-12-01T07:00:00+09:00' && r[0].end_at === '2026-12-01T16:00:00+09:00' && r[0].break_min === 60 && r[0].office === 'facility', r[0]);
  t('(22 と翌日 8) → 22:00〜翌8:00・夜勤の休憩120分', r[1].kind === 'night' && r[1].end_at === '2026-12-03T08:00:00+09:00' && r[1].break_min === 120, r[1]);
  t('8) の日は行を作らない・休は行なし・有は paid 480分', r.length === 3 && r[2].kind === 'paid' && r[2].paid_min === 480, r.map((x) => x.kind));
  t('名簿: 従業員コード・主事業所', s.staff[0].emp_code === '9001' && s.staff[0].office === 'facility' && s.staff[1].emp_code === null && s.staff[1].office === 'visit');
  const m = sched({ 31: '(22' }, {}, {}, { cells: { sT01: { 1: '8)' } } });
  t('月末の夜勤は翌月の1日の上がりで終わる', m.rows[0].end_at === '2027-01-01T08:00:00+09:00', m.rows[0]);
  const m2 = sched({ 31: '(21' });
  t('翌日の上がりが無い夜勤は定時の上がりで置いて警告', m2.rows[0].end_at === '2027-01-01T07:00:00+09:00' && m2.warnings.length === 1, m2.warnings);
  const v = C.buildSchedule({ ym: YM, plan: { cells: { sX: { 1: '早' }, sY: { 1: '早' }, sZ: { 1: '早' } } }, staff: [
    { id: 'sX', name: 'x', active: false }, { id: 'sY', name: 'y', status: '休職' }, { id: 'sZ', name: 'z', retireMonth: '2026-11' }], symbols: Sym.DEFAULT_SYMBOLS });
  t('在籍していない・休職・退職月の後の職員は出さない', v.rows.length === 0 && v.staff.length === 0);
  const sp = sched({ 4: '7-9 17-21' });
  t('分割勤務 7-9 17-21 は2行（休憩なし）', sp.rows.length === 2 && sp.rows.every((x) => x.break_min === 0), sp.rows);
  const sub = sched({ 7: '早' }, {}, { sT01: { '通所': { 7: '9-12' } } });
  const blocks = C.blocksOf(sub.rows);
  t('同じ日に重なる副区分の勤務は1つの塊（7-16・事業所の割合）', blocks.length === 1 && Math.abs(blocks[0].officeShare.day - 180 / 660) < 1e-9 && blocks[0].office === 'facility', blocks[0]);
  const bad = sched({ 8: '謎' });
  t('解釈できない記号は警告に出す', bad.rows.length === 0 && bad.warnings.some((w) => /解釈できない/.test(w.msg)));
}

console.log('\n— 1. 丸め（代表者の例）—');
{
  const s = sched({ 1: '早', 2: '早', 3: '早', 4: '早' }).rows;
  const m = month(s, [
    P('sT01', 'in', '2026-12-01', '6:50'), P('sT01', 'out', '2026-12-01', '16:10'),
    P('sT01', 'in', '2026-12-02', '7:20'), P('sT01', 'out', '2026-12-02', '15:30'),
    P('sT01', 'in', '2026-12-03', '6:20'), P('sT01', 'out', '2026-12-03', '16:40'),
    P('sT01', 'in', '2026-12-04', '6:20'), P('sT01', 'out', '2026-12-04', '16:40')
  ], [{ staff_id: 'sT01', work_date: '2026-12-04', early_ok: true, overtime_ok: true }]);
  const b1 = dayOf(m, 'sT01', '2026-12-01').blocks[0];
  t('6:50 出勤 → 7:00 から数える', C.jstHM(b1.countStart) === '07:00', C.jstHM(b1.countStart));
  t('16:10 退勤 → 16:00 まで数える', C.jstHM(b1.countEnd) === '16:00', C.jstHM(b1.countEnd));
  t('実働 8時間（9h−休憩1h）・残業0・要確認なし', b1.workMin === 480 && b1.overtimeMin === 0 && !b1.flags.some((f) => C.REVIEW[f]), b1);
  const b2 = dayOf(m, 'sT01', '2026-12-02').blocks[0];
  t('7:20 出勤は遅刻20分・15:30 退勤は早退30分（打刻どおり）', b2.lateMin === 20 && b2.earlyLeaveMin === 30 && b2.workMin === 490 - 60 && C.jstHM(b2.countStart) === '07:20', b2);
  const b3 = dayOf(m, 'sT01', '2026-12-03').blocks[0];
  t('40分早い出勤・40分遅い退勤は要確認（数えるのは予定どおり）', b3.flags.includes('early') && b3.flags.includes('overtime') && b3.workMin === 480, b3.flags);
  const b4 = dayOf(m, 'sT01', '2026-12-04').blocks[0];
  t('早出・残業を認めた日は打刻どおり（6:20〜16:40・残業80分）', C.jstHM(b4.countStart) === '06:20' && C.jstHM(b4.countEnd) === '16:40' && b4.overtimeMin === 80 && !b4.flags.includes('early'), b4);
  const sm = sumOf(m, 'sT01');
  t('月: 出勤4日・遅刻1回20分・早退1回30分・残業80分', sm.workDays === 4 && sm.lateCount === 1 && sm.lateMin === 20 && sm.earlyLeaveCount === 1 && sm.earlyLeaveMin === 30 && sm.overtimeMin === 80, sm);
  const m2 = month(s.slice(0, 1), [P('sT01', 'in', '2026-12-01', '6:50'), P('sT01', 'out', '2026-12-01', '16:10')], [], { earlyAlertMin: 5, overtimeAlertMin: 5 });
  t('境目を5分にすると10分のずれも要確認', dayOf(m2, 'sT01', '2026-12-01').blocks[0].flags.includes('overtime'));
}

console.log('\n— 2. 夜勤 —');
{
  const s = sched({ 10: '(22', 11: '8)', 31: '(22' }, {}, {}, { cells: { sT01: { 1: '8)' } } }).rows;
  const m = month(s, [P('sT01', 'in', '2026-12-10', '21:45'), P('sT01', 'out', '2026-12-11', '8:05'), P('sT01', 'in', '2026-12-31', '21:58'), P('sT01', 'out', '2027-01-01', '8:00')]);
  const b = dayOf(m, 'sT01', '2026-12-10').blocks[0];
  t('22:00〜翌8:00・実働8h（休憩2h）', C.jstHM(b.countStart) === '22:00' && C.jstHM(b.countEnd) === '08:00' && b.workMin === 480, b);
  t('深夜 22-5 の7h から休憩2hを引いて5h', b.nightMin === 300, b.nightMin);
  t('夜勤の日の翌日（明け）に塊は無い', !dayOf(m, 'sT01', '2026-12-11'));
  const e = dayOf(m, 'sT01', '2026-12-31');
  t('月末の夜勤は12月に数える（翌月1日の上がりで）', e && e.blocks[0].workMin === 480, e && e.blocks[0]);
  t('変形労働（既定）では夜勤8hに法定外なし', sumOf(m, 'sT01').legalOverMin === 0);
  t('深夜の計算: 21:00〜翌7:00 は 7時間', C.nightMinutes(at('2026-12-10', '21:00'), at('2026-12-11', '7:00')) === 420);
}

console.log('\n— 3. 打刻の漏れ・予定なし・分割・有休・取り消し —');
{
  const s = sched({ 1: '早', 2: '早', 3: '早', 4: '7-9 17-21', 5: '有' }).rows;
  const m = month(s, [
    P('sT01', 'in', '2026-12-01', '6:55'),
    P('sT01', 'out', '2026-12-02', '16:00'),
    P('sT01', 'in', '2026-12-04', '6:58'), P('sT01', 'out', '2026-12-04', '9:01'),
    P('sT01', 'in', '2026-12-04', '16:59'), P('sT01', 'out', '2026-12-04', '21:00'),
    P('sT01', 'in', '2026-12-06', '9:03'), P('sT01', 'out', '2026-12-06', '12:00'),
    P('sT01', 'in', '2026-12-07', '7:00', { voided_at: '2026-12-07T10:00:00+09:00' })
  ]);
  t('出勤だけの日は「退勤の打刻がありません」で実働0', dayOf(m, 'sT01', '2026-12-01').blocks[0].flags.includes('missing_out') && dayOf(m, 'sT01', '2026-12-01').workMin === 0);
  t('退勤だけの日は「出勤の打刻がありません」', dayOf(m, 'sT01', '2026-12-02').blocks[0].flags.includes('missing_in'));
  t('予定があって打刻が無い過ぎた日は「打刻なし」', dayOf(m, 'sT01', '2026-12-03').blocks[0].flags.includes('no_punch'));
  const d4 = dayOf(m, 'sT01', '2026-12-04');
  t('分割勤務は塊2つ・2h＋4h', d4.blocks.length === 2 && d4.blocks[0].workMin === 120 && d4.blocks[1].workMin === 240, d4.blocks.map((b) => b.workMin));
  t('有休の日は paid 480分・有休日数1', dayOf(m, 'sT01', '2026-12-05').paidMin === 480 && sumOf(m, 'sT01').paidDays === 1);
  const d6 = dayOf(m, 'sT01', '2026-12-06');
  t('予定の無い日の打刻は「予定の無い勤務」で打刻どおり3h（休憩なし）', d6.blocks[0].flags.includes('no_schedule') && d6.workMin === 177, d6.workMin);
  t('取り消した打刻は数えない', !dayOf(m, 'sT01', '2026-12-07'));
  t('打刻なし日数1・要確認は数える', sumOf(m, 'sT01').noPunchDays === 1 && sumOf(m, 'sT01').reviewCount >= 4, sumOf(m, 'sT01'));
  const f = month([], [P('sT01', 'in', '2026-12-08', '7:00'), P('sT01', 'in', '2026-12-08', '7:30'), P('sT01', 'out', '2026-12-08', '16:00')]);
  t('10分を超えて離れた二重の出勤は前の方を退勤漏れにし、後の方と退勤を組む', dayOf(f, 'sT01', '2026-12-08').blocks.length === 2);
  const g = month([], [P('sT01', 'in', '2026-12-08', '7:00'), P('sT01', 'out', '2026-12-09', '9:00')]);
  t('24時間を超える出勤と退勤は組まない', dayOf(g, 'sT01', '2026-12-08').blocks[0].flags.includes('missing_out') && dayOf(g, 'sT01', '2026-12-09').blocks[0].flags.includes('missing_in'));
  const o = month(sched({ 9: '早' }).rows, [P('sT01', 'in', '2026-12-09', '7:00', { source: 'offline' }), P('sT01', 'out', '2026-12-09', '16:00', { source: 'office' })]);
  t('通信できない時の打刻・事務所が足した打刻に印', dayOf(o, 'sT01', '2026-12-09').blocks[0].flags.includes('offline') && dayOf(o, 'sT01', '2026-12-09').blocks[0].flags.includes('office'));
  const brk = month(sched({ 9: '早' }).rows, [P('sT01', 'in', '2026-12-09', '7:00'), P('sT01', 'out', '2026-12-09', '16:00')], [{ staff_id: 'sT01', work_date: '2026-12-09', break_min: 45 }]);
  t('休憩を直した日は直した分（45分）', dayOf(brk, 'sT01', '2026-12-09').blocks[0].breakMin === 45 && dayOf(brk, 'sT01', '2026-12-09').workMin === 495);
  const short = month(sched({ 9: '早' }).rows, [P('sT01', 'in', '2026-12-09', '7:00'), P('sT01', 'out', '2026-12-09', '11:00')]);
  t('早退で6時間未満になった昼の勤務は休憩0', dayOf(short, 'sT01', '2026-12-09').blocks[0].breakMin === 0 && dayOf(short, 'sT01', '2026-12-09').workMin === 240);
  const ghost = month([], [P('sZZ', 'in', '2026-12-09', '7:00'), P('sZZ', 'out', '2026-12-09', '16:00')]);
  t('名簿に無い人の打刻も落とさず警告', ghost.people.some((p) => p.staff.staff_id === 'sZZ' && p.sum.warnings.length));
  const lock = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched({ 9: '早' }).rows, punches: [P('sT01', 'in', '2026-12-09', '7:00'), P('sT01', 'out', '2026-12-09', '16:00', { created_at: '2027-01-05T09:00:00+09:00' })], now: NOW, lockedAt: '2027-01-03T09:00:00+09:00' });
  t('締めた後に足された打刻に印', dayOf(lock, 'sT01', '2026-12-09').blocks[0].flags.includes('after_lock'));
}

console.log('\n— 4. 法定外・月の端数・警告 —');
{
  const s = sched({ 1: '7-18' }).rows;   /* 拘束11h・休憩1h・実働10h */
  const ps = [P('sT01', 'in', '2026-12-01', '7:00'), P('sT01', 'out', '2026-12-01', '18:00')];
  t('変形あり: 予定の実働10hは法定外0', sumOf(month(s, ps), 'sT01').legalOverMin === 0);
  t('変形なし: 8h を超えた2hが法定外', sumOf(month(s, ps, [], { variableMonth: false }), 'sT01').legalOverMin === 120);
  t('30分の四捨五入: 89分→60分・90分→120分', C.round30(89) === 60 && C.round30(90) === 120 && C.round30(29) === 0);
  const many = [];
  const cells = {};
  for (let d = 1; d <= 23; d++) { cells[d] = '早'; many.push(P('sT01', 'in', C.iso(at('2026-12-' + String(d).padStart(2, '0'), '7:00')).slice(0, 10), '7:00')); many.push(P('sT01', 'out', '2026-12-' + String(d).padStart(2, '0'), '18:00')); }
  const mm = month(sched(cells).rows, many, Object.keys(cells).map((d) => ({ staff_id: 'sT01', work_date: '2026-12-' + String(d).padStart(2, '0'), overtime_ok: true })));
  /* 日の法定外 23×2h＋月の枠（40h×31÷7＝10628分）を超えた分（23×10h−46h＝11040分 → 412分） */
  t('月の法定外（日の分＋変形の月の枠を超えた分）が45h以上で36協定の警告', sumOf(mm, 'sT01').legalOverMin === 23 * 120 + 412 && sumOf(mm, 'sT01').warnings.some((w) => /36協定/.test(w)), sumOf(mm, 'sT01').legalOverMin);
  const bad = C.fillConfig({ breakH: -3, earlyAlertMin: 'x', variableMonth: 'yes', csvTime: 'zz' });
  t('壊れた設定は既定へ戻す', bad.breakH === 1 && bad.earlyAlertMin === 30 && bad.variableMonth === true && bad.csvTime === 'hmm');
}

console.log('\n— 4b. 反証レビュー（2026-11-18）の指摘の再発防止 —');
{
  const H = sched({ 1: '早', 2: '(22', 3: '8)', 4: '早', 5: '13-22', 6: '9-12', 8: '早', 9: '早' }).rows;
  const m = month(H, [
    P('sT01', 'in', '2026-12-01', '7:00'), P('sT01', 'out', '2026-12-01', '12:00'), P('sT01', 'in', '2026-12-01', '13:00'), P('sT01', 'out', '2026-12-01', '16:00'),
    P('sT01', 'in', '2026-12-02', '21:55'), P('sT01', 'out', '2026-12-03', '0:30'),
    P('sT01', 'in', '2026-12-04', '7:00'), P('sT01', 'out', '2026-12-04', '13:00'),
    P('sT01', 'in', '2026-12-05', '12:55'), P('sT01', 'out', '2026-12-06', '12:00'),
    P('sT01', 'in', '2026-12-08', '7:00'), P('sT01', 'in', '2026-12-08', '7:02'), P('sT01', 'out', '2026-12-08', '16:00'),
    { id: 'sec', staff_id: 'sT01', kind: 'in', at: '2026-12-09T07:00:30+09:00', source: 'tablet' }, P('sT01', 'out', '2026-12-09', '16:00')
  ]);
  const d1 = dayOf(m, 'sT01', '2026-12-01').blocks[0];
  t('指摘1: 昼休みを打刻した日は休憩を二重に引かない（実働8h）', d1.workMin === 480 && d1.breakMin === 0, d1);
  const d2 = dayOf(m, 'sT01', '2026-12-02').blocks[0];
  t('指摘2: 夜勤を2時間半で帰った日は休憩を引かない（実働2.5h・深夜2.5h）', d2.workMin === 150 && d2.nightMin === 150, d2);
  t('指摘14: ちょうど6時間は休憩を引かない', dayOf(m, 'sT01', '2026-12-04').blocks[0].workMin === 360);
  t('指摘5: 遅番の退勤漏れと翌日の出勤漏れを1組にしない', dayOf(m, 'sT01', '2026-12-05').blocks[0].flags.includes('missing_out') && dayOf(m, 'sT01', '2026-12-06').blocks[0].flags.includes('missing_in'), [dayOf(m, 'sT01', '2026-12-05').blocks[0].flags, dayOf(m, 'sT01', '2026-12-06').blocks[0].flags]);
  const d8 = dayOf(m, 'sT01', '2026-12-08').blocks[0];
  t('指摘6: 10分以内の二度押しの出勤は1つ（遅刻0・実働8h）', d8.lateMin === 0 && d8.workMin === 480 && !d8.flags.includes('missing_out'), d8);
  const d9 = dayOf(m, 'sT01', '2026-12-09').blocks[0];
  t('指摘7: 秒は数えない（7:00:30 は遅刻にしない）', d9.lateMin === 0 && !d9.flags.includes('late'), d9.flags);
  const j = C.blocksOf(sched({ 10: '7-12' }, {}, { sT01: { '通所': { 10: '12-17' } } }).rows, C.fillConfig({}));
  t('指摘8: 5h＋5h の接する勤務は塊の拘束10hで休憩60分', j[0].breakMin === 60 && j[0].schedWork === 540, j[0]);
  const k = C.blocksOf(sched({ 10: '7-13' }, {}, { sT01: { '通所': { 10: '13-19' } } }).rows, C.fillConfig({}));
  t('指摘8: 6h＋6h は休憩120分にしない（60分）', k[0].breakMin === 60, k[0].breakMin);
  const o = month(sched({ 11: '9-18' }, {}, { sT01: { '通所': { 11: '7-9' } } }).rows, [P('sT01', 'in', '2026-12-11', '7:00'), P('sT01', 'out', '2026-12-11', '18:00')]);
  t('指摘9: 塊の事業所は主区分（施設）', dayOf(o, 'sT01', '2026-12-11').blocks[0].office === 'facility');
  t('指摘10: 予定なしの丸め単位は設定できない（1分固定）', C.fillConfig({ noScheduleUnit: 15 }).noScheduleUnit === 1);
  const w = [];
  for (let d = 6; d <= 11; d++) { const ds = '2026-12-' + String(d).padStart(2, '0'); w.push(P('sT01', 'in', ds, '9:00'), P('sT01', 'out', ds, '17:00'));   /* 拘束8h−休憩1h＝実働7h */ }
  t('指摘11: 変形なしで週6日×7h（日曜始まり）は週40hを超えた2hが法定外', sumOf(month([], w, [], { variableMonth: false }), 'sT01').legalOverMin === 120, sumOf(month([], w, [], { variableMonth: false }), 'sT01').legalOverMin);
  const r30 = month(sched({ 12: '早' }).rows, [P('sT01', 'in', '2026-12-12', '7:00'), P('sT01', 'out', '2026-12-12', '16:40')], [{ staff_id: 'sT01', work_date: '2026-12-12', overtime_ok: true }], { monthRound30: true });
  const s30 = sumOf(r30, 'sT01');
  t('指摘12: 30分の四捨五入でも 所定内＋残業＝総労働', s30.schedInMin + s30.overtimeMin === s30.workMin, s30);
  const sp = month(sched({ 13: '7-9 17-21' }).rows, [P('sT01', 'in', '2026-12-13', '17:00'), P('sT01', 'out', '2026-12-13', '21:00')], [{ staff_id: 'sT01', work_date: '2026-12-13', break_min: 30 }]);
  t('指摘13: 分割勤務で前の塊に打刻が無くても、直した休憩は打刻のある塊に当たる', dayOf(sp, 'sT01', '2026-12-13').workMin === 210, dayOf(sp, 'sT01', '2026-12-13').blocks.map((b) => [b.breakMin, b.workMin]));
  const rv = month(sched({ 14: '早' }).rows, [P('sT01', 'in', '2026-12-14', '6:20', { source: 'offline' }), P('sT01', 'in', '2026-12-14', '6:25'), P('sT01', 'out', '2026-12-14', '16:40')]);
  t('指摘15: 要確認は勤務ごとに1件（印の数で数えない）', sumOf(rv, 'sT01').reviewCount === 1, sumOf(rv, 'sT01').reviewCount);
  const mi = month([], [P('sT01', 'in', '2026-12-03', '7:00')]);
  const cs = C.buildCsv(mi);
  t('指摘3・4: 出勤だけの人も集計と日ごとの CSV に出る', cs.summary.split('\r\n')[1].startsWith('9001,') && /退勤の打刻がありません/.test(cs.daily), cs);
}

console.log('\n— 5. CSV —');
{
  const s = sched({ 1: '早', 5: '有' }, { 1: '早' }).rows;
  const m = month(s, [P('sT01', 'in', '2026-12-01', '6:50'), P('sT01', 'out', '2026-12-01', '16:10'), P('sT02', 'in', '2026-12-01', '7:00'), P('sT02', 'out', '2026-12-01', '16:00')]);
  const csv = C.buildCsv(m, { nameOf: (d) => d + '事業所' });
  const sl = csv.summary.split('\r\n');
  t('集計の見出し', sl[0] === C.SUMMARY_HEAD.join(','), sl[0]);
  t('集計の行（コード・出勤1日・有休1日・総労働8:00）', sl[1].startsWith('9001,試験 甲,施設事業所,1,1,8:00,8:00,0:00,0:00,0:00,0,0:00,0,0:00,0,0'), sl[1]);
  t('従業員コードの無い人は出さずに警告', sl.length === 3 && csv.warnings.length === 1 && /試験 乙/.test(csv.warnings[0]), csv.warnings);
  const dl = csv.daily.split('\r\n');
  t('日ごとの行（数えた時刻 07:00〜16:00・休憩60・実働8:00）', dl[1] === '9001,2026-12-01,07:00,16:00,60,8:00,0:00,施設事業所,早,', dl[1]);
  t('有休の日の行', /^9001,2026-12-05,,,0,0:00,0:00,,有,有休 8:00$/.test(dl[2]), dl[2]);
  const dec = C.buildCsv(C.computeMonth({ ym: YM, staff: K_STAFF, schedule: s, punches: [P('sT01', 'in', '2026-12-01', '7:00'), P('sT01', 'out', '2026-12-01', '16:00')], config: { csvTime: 'dec' }, now: NOW }));
  t('時間を10進（8.00）で書ける', dec.summary.split('\r\n')[1].indexOf(',8.00,') > 0);
  t('式として読まれる文字の頭に引用符・カンマは囲む', C.csvCell('=1+1') === "'=1+1" && C.csvCell('a,b') === '"a,b"' && C.csvCell('-5') === "'-5");
  const sj = C.encodeSjis('9001,試験 甲,髙\r\n');
  t('Shift_JIS に変える（「試」は 0x8E 0x8E）', sj.bytes[5] === 0x8E && sj.bytes[6] === 0x8E && sj.unknown.length === 0, Array.from(sj.bytes.slice(0, 8)));
  t('Shift_JIS に無い文字は ? にして知らせる', C.encodeSjis('a😀').unknown.length === 1);
  const snap = C.snapshotOf(m);
  t('締めの凍結に氏名を入れない', JSON.stringify(snap).indexOf('試験') < 0 && snap.rows.length === 2);
}

console.log('\n— 6. 記号パーサの写しが原本と同じ —');
{
  const orig = path.join(process.env.HOME || '', 'Claude', 'Projects', 'シフト作成・管理アプリ', 'src', 'logic', 'symbols.js');
  if (fs.existsSync(orig)) t('shift-symbols.js はシフトアプリの symbols.js と1字も違わない', fs.readFileSync(orig, 'utf8') === fs.readFileSync(path.join(ROOT, 'shift-symbols.js'), 'utf8'));
  else console.log('  ⏸ 省略（シフトアプリの原本が無い環境）');
  t('番号の形（4〜6桁の数字）', C.isCode('1234') && C.isCode('123456') && !C.isCode('123') && !C.isCode('12a4') && !C.isCode(1234));
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
