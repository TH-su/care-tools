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
     8. 0101 月を締め日で切る: 期間の名前・期間の日だけ数える・週40時間を期間をまたいで数える・変形の日→週→総枠・
        時間の区分（重ならない4つの和が総労働・60時間超・夜勤の回数・所定日数・記号ごとの回数）。回帰の例外3つは節の頭に理由
     9. v4（2026-11-20）手で入れた有休の使用（leave_uses）: シフトの有休の行がある日は足さない・所定（予定の実働か480分）×日数・
        無い時は結果が1バイトも変わらない・締めの控え（paidDays・paidMin）に入る
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
  /* 2026-11-20（統合 0109）: 従業員コードの無い人は emp_code の欄を送らない（DB の今の値のまま） */
  t('名簿: 従業員コード・主事業所（従業員コードの無い人は欄を送らない）', s.staff[0].emp_code === '9001' && s.staff[0].office === 'facility' && !('emp_code' in s.staff[1]) && s.staff[1].office === 'visit');
  /* 2026-11-20 代表者の指示・統合 0108: シフトの freee の欄の A001 の形は A を抜いた4桁で送る（ほかの形は変えない） */
  const ec = (code) => C.buildSchedule({ ym: YM, plan: { cells: {} }, nextPlan: {}, staff: [{ id: 'sT09', name: '試験 丙', mainDivision: '施設', empCode: code, active: true }], symbols: Sym.DEFAULT_SYMBOLS, settings: {} }).staff[0].emp_code;
  t('名簿: 従業員コードの A001 → 0001・A12 → 0012・E02 と B0007 と 9001 と A12345 はそのまま・空は欄なし',
    ec('A001') === '0001' && ec('A12') === '0012' && ec('E02') === 'E02' && ec('B0007') === 'B0007' && ec('9001') === '9001' && ec('A12345') === 'A12345' && ec('') === undefined, [ec('A001'), ec('A12')]);
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

console.log('\n— 7. v2（2026-11-19 凍結仕様 ROOT-v2-polish.md の B）—');
{
  const monthAt = (now, schedRows, punches, days, config) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: schedRows, punches, days: days || [], config: config || {}, now });
  const blk = (m, date, i) => dayOf(m, 'sT01', date).blocks[i || 0];
  const S15 = sched({ 15: '早' }).rows;
  const in15 = [P('sT01', 'in', '2026-12-15', '7:00')];

  /* B-1 勤務中 */
  const w1 = monthAt(at('2026-12-15', '16:29'), S15, in15);
  t('B1: 予定の終わり＋猶予30分より前（16:29）は勤務中・退勤漏れにしない・要確認0', blk(w1, '2026-12-15').working === true && blk(w1, '2026-12-15').flags.includes('working') && !blk(w1, '2026-12-15').flags.includes('missing_out') && sumOf(w1, 'sT01').reviewCount === 0, blk(w1, '2026-12-15').flags);
  const w2 = monthAt(at('2026-12-15', '16:30'), S15, in15);
  t('B1: 猶予ちょうど（16:30）は退勤漏れ・要確認1', blk(w2, '2026-12-15').working === false && blk(w2, '2026-12-15').flags.includes('missing_out') && sumOf(w2, 'sT01').reviewCount === 1, blk(w2, '2026-12-15').flags);
  const w3 = monthAt(at('2026-12-15', '16:31'), S15, in15);
  t('B1: 猶予を1分超（16:31）も退勤漏れ', blk(w3, '2026-12-15').flags.includes('missing_out') && !blk(w3, '2026-12-15').working);
  const w4 = monthAt(at('2026-12-15', '16:40'), S15, in15, [], { overtimeAlertMin: 60 });
  t('B1: 猶予は設定 overtimeAlertMin（60分なら 16:40 も勤務中）', blk(w4, '2026-12-15').working === true);
  const ns = [P('sT01', 'in', '2026-12-16', '9:00')];
  const w5 = monthAt(at('2026-12-17', '0:59'), [], ns);
  t('B1: 予定の無い日は出勤から16時間より前（15:59後）は勤務中', blk(w5, '2026-12-16').working === true && !blk(w5, '2026-12-16').flags.includes('missing_out'), blk(w5, '2026-12-16').flags);
  const w6 = monthAt(at('2026-12-17', '1:00'), [], ns);
  t('B1: 予定の無い日は出勤からちょうど16時間で退勤漏れ', blk(w6, '2026-12-16').flags.includes('missing_out') && !blk(w6, '2026-12-16').working);
  const w7 = monthAt(at('2026-12-15', '10:00'), S15, [P('sT01', 'in', '2026-12-15', '7:00'), P('sT01', 'in', '2026-12-15', '8:00')]);
  t('B1: 前の離れた出勤は退勤漏れのまま・最後の出勤だけ勤務中', blk(w7, '2026-12-15').flags.includes('missing_out') && blk(w7, '2026-12-15').working === true, blk(w7, '2026-12-15').flags);
  const w8 = monthAt(at('2026-12-15', '14:00'), S15, [P('sT01', 'in', '2026-12-15', '7:00'), P('sT01', 'out', '2026-12-15', '12:00'), P('sT01', 'in', '2026-12-15', '13:00')]);
  t('B1: 昼休みを打刻して戻った後も勤務中（早退にしない・午前の5hは数える）', blk(w8, '2026-12-15').working && !blk(w8, '2026-12-15').flags.includes('early_leave') && blk(w8, '2026-12-15').earlyLeaveMin === 0 && blk(w8, '2026-12-15').workMin === 300, blk(w8, '2026-12-15'));
  const NS = sched({ 20: '(22', 21: '8)' }).rows;
  const w9 = monthAt(at('2026-12-21', '3:00'), NS, [P('sT01', 'in', '2026-12-20', '21:55')]);
  t('B1: 夜勤の途中（翌3:00）は勤務中', blk(w9, '2026-12-20').working === true && !blk(w9, '2026-12-20').flags.includes('missing_out'));
  const w10 = monthAt(at('2026-12-21', '8:30'), NS, [P('sT01', 'in', '2026-12-20', '21:55')]);
  t('B1: 夜勤の上がり8:00＋猶予30分ちょうどで退勤漏れ', blk(w10, '2026-12-20').flags.includes('missing_out') && !blk(w10, '2026-12-20').working);

  /* B-2 未出勤 */
  const n1 = monthAt(at('2026-12-15', '7:15'), S15, []);
  t('B2: 予定の開始＋15分ちょうど（7:15）はまだ印なし', blk(n1, '2026-12-15').flags.length === 0, blk(n1, '2026-12-15').flags);
  const n2 = monthAt(at('2026-12-15', '7:16'), S15, []);
  t('B2: 予定の開始＋15分を1分超（7:16）は not_in_yet・要確認に数えない', blk(n2, '2026-12-15').flags.join() === 'not_in_yet' && sumOf(n2, 'sT01').reviewCount === 0 && sumOf(n2, 'sT01').noPunchDays === 0);
  const n3 = monthAt(at('2026-12-15', '16:00'), S15, []);
  t('B2: 予定の終わりちょうど（16:00）はまだ not_in_yet', blk(n3, '2026-12-15').flags.join() === 'not_in_yet');
  const n4 = monthAt(at('2026-12-15', '16:01'), S15, []);
  t('B2: 予定の終わりを過ぎたら従来どおり no_punch（要確認）', blk(n4, '2026-12-15').flags.join() === 'no_punch' && sumOf(n4, 'sT01').reviewCount === 1);
  t('B2: 猶予は固定15分（定数）', C.NOT_IN_GRACE_MIN === 15 && C.fillConfig({ NOT_IN_GRACE_MIN: 60 }).NOT_IN_GRACE_MIN === undefined);

  /* B-3 day_mark */
  const S16 = sched({ 16: '早', 17: '早', 18: '早' }).rows;
  const dm = month(S16, [P('sT01', 'in', '2026-12-16', '6:20'), P('sT01', 'out', '2026-12-16', '16:00')],
    [{ staff_id: 'sT01', work_date: '2026-12-16', day_mark: 'checked' }, { staff_id: 'sT01', work_date: '2026-12-17', day_mark: 'absent' }]);
  const c16 = blk(dm, '2026-12-16');
  t('B3: checked の日は印（早出）を残して checked:true・要確認に数えない', c16.checked === true && c16.flags.includes('early') && c16.flags.includes('checked'), c16.flags);
  const a17 = blk(dm, '2026-12-17');
  t('B3: absent の日は no_punch を absent に変える', a17.absent === true && a17.flags.join() === 'absent', a17.flags);
  const sdm = sumOf(dm, 'sT01');
  t('B3: 要確認は18日の打刻なしの1件だけ・欠勤1日・打刻なし1日', sdm.reviewCount === 1 && sdm.absentDays === 1 && sdm.noPunchDays === 1, sdm);
  t('B3: 日に印の値（mark）と欠勤（absent）', dayOf(dm, 'sT01', '2026-12-17').mark === 'absent' && dayOf(dm, 'sT01', '2026-12-17').absent === true && dayOf(dm, 'sT01', '2026-12-16').mark === 'checked');
  const dm2 = monthAt(at('2026-12-15', '9:00'), S15, [], [{ staff_id: 'sT01', work_date: '2026-12-15', day_mark: 'absent' }]);
  t('B3: 当日の未出勤も absent の日は欠勤', blk(dm2, '2026-12-15').flags.join() === 'absent' && sumOf(dm2, 'sT01').absentDays === 1);
  const dm3 = month(S16.slice(0, 1), [P('sT01', 'in', '2026-12-16', '7:00'), P('sT01', 'out', '2026-12-16', '16:00')], [{ staff_id: 'sT01', work_date: '2026-12-16', day_mark: 'absent' }]);
  t('B3: 打刻のある日に absent が付いていても実働は消さない（欠勤に数えない）', blk(dm3, '2026-12-16').workMin === 480 && sumOf(dm3, 'sT01').absentDays === 0);
  const dm4 = month(sched({ 13: '7-9 17-21' }).rows, [P('sT01', 'in', '2026-12-13', '17:00'), P('sT01', 'out', '2026-12-13', '21:00')], [{ staff_id: 'sT01', work_date: '2026-12-13', break_min: 30, day_mark: 'checked' }]);
  t('B3: 休憩を直した分割勤務の日も、両方の塊に checked が届く', dayOf(dm4, 'sT01', '2026-12-13').blocks.every((b) => b.checked) && sumOf(dm4, 'sT01').reviewCount === 0, dayOf(dm4, 'sT01', '2026-12-13').blocks.map((b) => b.flags));

  /* B-4 部分承認 */
  const pa = (d, extra) => month(sched({ 15: '早' }).rows, [P('sT01', 'in', '2026-12-15', d[0]), P('sT01', 'out', '2026-12-15', d[1])], [Object.assign({ staff_id: 'sT01', work_date: '2026-12-15' }, extra)]);
  const iso15 = (hm) => new Date(at('2026-12-15', hm)).toISOString();
  const p1 = blk(pa(['6:20', '16:40'], { early_from: iso15('6:40'), ot_until: iso15('16:20') }), '2026-12-15');
  t('B4: early_from 6:40・ot_until 16:20 → 6:40〜16:20 を数える・早出/残業の印は消える・残業40分', C.jstHM(p1.countStart) === '06:40' && C.jstHM(p1.countEnd) === '16:20' && !p1.flags.includes('early') && !p1.flags.includes('overtime') && p1.workMin === 520 && p1.overtimeMin === 40, p1);
  const p2 = blk(pa(['6:20', '16:40'], { early_from: iso15('7:30'), ot_until: iso15('15:30') }), '2026-12-15');
  t('B4: 予定の内側の時刻を入れても予定の開始・終わりより内に食い込まない（7:00〜16:00）', C.jstHM(p2.countStart) === '07:00' && C.jstHM(p2.countEnd) === '16:00' && p2.workMin === 480 && p2.lateMin === 0 && p2.earlyLeaveMin === 0, p2);
  const p3 = blk(pa(['6:20', '16:40'], { early_from: iso15('6:00'), ot_until: iso15('17:00') }), '2026-12-15');
  t('B4: 打刻より前の early_from・後の ot_until は打刻どおり（6:20〜16:40）', C.jstHM(p3.countStart) === '06:20' && C.jstHM(p3.countEnd) === '16:40', [C.jstHM(p3.countStart), C.jstHM(p3.countEnd)]);
  const p4 = blk(pa(['7:20', '15:30'], { early_from: iso15('6:40'), ot_until: iso15('16:30') }), '2026-12-15');
  t('B4: 遅刻・早退の日は打刻どおり（early_from・ot_until で予定へ引き戻さない）', C.jstHM(p4.countStart) === '07:20' && C.jstHM(p4.countEnd) === '15:30' && p4.lateMin === 20 && p4.earlyLeaveMin === 30, p4);
  const spl = month(sched({ 13: '7-9 17-21' }).rows, [P('sT01', 'in', '2026-12-13', '6:20'), P('sT01', 'out', '2026-12-13', '9:40'), P('sT01', 'in', '2026-12-13', '16:20'), P('sT01', 'out', '2026-12-13', '21:40')],
    [{ staff_id: 'sT01', work_date: '2026-12-13', early_from: new Date(at('2026-12-13', '6:30')).toISOString(), ot_until: new Date(at('2026-12-13', '21:30')).toISOString() }]);
  const sb = dayOf(spl, 'sT01', '2026-12-13').blocks;
  t('B4: 分割勤務の日は early_from を最初の塊・ot_until を最後の塊にだけ当てる', C.jstHM(sb[0].countStart) === '06:30' && C.jstHM(sb[0].countEnd) === '09:00' && sb[0].flags.includes('overtime') && C.jstHM(sb[1].countStart) === '17:00' && sb[1].flags.includes('early') && C.jstHM(sb[1].countEnd) === '21:30', sb.map((b) => [C.jstHM(b.countStart), C.jstHM(b.countEnd), b.flags]));

  const iso13 = (hm) => new Date(at('2026-12-13', hm)).toISOString();
  const S13 = sched({ 13: '7-9 17-21' }).rows;
  const q1 = dayOf(month(S13, [P('sT01', 'in', '2026-12-13', '16:30'), P('sT01', 'out', '2026-12-13', '21:00')], [{ staff_id: 'sT01', work_date: '2026-12-13', early_from: iso13('16:40') }]), 'sT01', '2026-12-13').blocks;
  t('B4: 分割勤務で打刻のある後ろの塊だけの日も early_from 16:40 が当たる（数える開始 16:40）', C.jstHM(q1[1].countStart) === '16:40' && !q1[1].flags.includes('early'), q1.map((b) => [C.jstHM(b.countStart), b.flags]));
  const q2 = dayOf(month(S13, [P('sT01', 'in', '2026-12-13', '7:00'), P('sT01', 'out', '2026-12-13', '9:40')], [{ staff_id: 'sT01', work_date: '2026-12-13', ot_until: iso13('9:30') }]), 'sT01', '2026-12-13').blocks;
  t('B4: 分割勤務で打刻のある前の塊だけの日も ot_until 9:30 が当たる（数える終わり 9:30）', C.jstHM(q2[0].countEnd) === '09:30' && !q2[0].flags.includes('overtime'), q2.map((b) => [C.jstHM(b.countEnd), b.flags]));

  /* B-5 数えなかった分 */
  const u = month(sched({ 15: '早', 16: '早', 17: '早' }).rows, [
    P('sT01', 'in', '2026-12-15', '6:50'), P('sT01', 'out', '2026-12-15', '16:10'),
    P('sT01', 'in', '2026-12-16', '6:50'), P('sT01', 'out', '2026-12-16', '16:10'),
    P('sT01', 'in', '2026-12-17', '7:00'), P('sT01', 'out', '2026-12-17', '12:00'), P('sT01', 'in', '2026-12-17', '13:00'), P('sT01', 'out', '2026-12-17', '16:10')
  ], [{ staff_id: 'sT01', work_date: '2026-12-16', early_ok: true, overtime_ok: true }]);
  t('B5: 6:50〜16:10 を 7:00〜16:00 で数えた日は uncountedMin 20', blk(u, '2026-12-15').uncountedMin === 20, blk(u, '2026-12-15').uncountedMin);
  t('B5: 早出・残業を認めた日は 0', blk(u, '2026-12-16').uncountedMin === 0);
  t('B5: 昼休みを打刻した日は昼休みを入れない（退勤の10分だけ）', blk(u, '2026-12-17').uncountedMin === 10, blk(u, '2026-12-17').uncountedMin);
  t('B5: 月の合計 30分・日にも出す', sumOf(u, 'sT01').uncountedMin === 30 && dayOf(u, 'sT01', '2026-12-15').uncountedMin === 20, sumOf(u, 'sT01').uncountedMin);

  /* B-6 有休日数 */
  const paidRow = (d, min) => ({ staff_id: 'sT01', work_date: '2026-12-' + d, seq: 9, kind: 'paid', start_at: null, end_at: null, break_min: 0, paid_min: min, office: 'facility', symbol: '有' });
  const pdm = month(sched({ 22: '7-11' }).rows.concat([paidRow('19', 240), paidRow('20', 480), paidRow('21', 241), paidRow('22', 240), paidRow('23', 120)]), [P('sT01', 'in', '2026-12-22', '7:00'), P('sT01', 'out', '2026-12-22', '11:00')]);
  t('B6: 予定の無い日の有休4h は 0.5 日', dayOf(pdm, 'sT01', '2026-12-19').paidDays === 0.5);
  t('B6: 8h は 1 日・4h1分（0.5超）は 1 日・2h は 0.5 日', dayOf(pdm, 'sT01', '2026-12-20').paidDays === 1 && dayOf(pdm, 'sT01', '2026-12-21').paidDays === 1 && dayOf(pdm, 'sT01', '2026-12-23').paidDays === 0.5);
  t('B6: 午前4h勤務＋有休4h の日は 0.5 日（所定＝予定の実働＋有休）', dayOf(pdm, 'sT01', '2026-12-22').paidDays === 0.5);
  t('B6: 月の有休日数 3.5・有休時間 1321分', sumOf(pdm, 'sT01').paidDays === 3.5 && sumOf(pdm, 'sT01').paidMin === 1321, [sumOf(pdm, 'sT01').paidDays, sumOf(pdm, 'sT01').paidMin]);

  /* B-7 日ごとの CSV は1人1日1行 */
  const d7 = month(sched({ 4: '7-9 17-21' }).rows, [P('sT01', 'in', '2026-12-04', '6:58'), P('sT01', 'out', '2026-12-04', '9:01'), P('sT01', 'in', '2026-12-04', '16:59'), P('sT01', 'out', '2026-12-04', '21:20')]);
  const c7 = C.buildCsv(d7, { nameOf: (d) => d + '事業所' }).daily.split('\r\n').filter((l) => l.startsWith('9001,2026-12-04'));
  t('B7: 分割勤務の日は1行（出勤は最初・退勤は最後・実働は合計6h）', c7.length === 1 && c7[0] === '9001,2026-12-04,07:00,21:00,0,6:00,0:00,施設事業所,' + blk(d7, '2026-12-04').symbol + ',' && blk(d7, '2026-12-04', 1).symbol === blk(d7, '2026-12-04').symbol, c7);
  const c7x = C.buildCsv(d7, { nameOf: (d) => d + '事業所', extraCols: true }).daily.split('\r\n').filter((l) => l.startsWith('9001,2026-12-04'));
  t('B7: 拡張の列でも1行・生の打刻は最初の出勤 6:58〜最後の退勤 21:20・予定 7:00〜21:00', c7x.length === 1 && c7x[0].split(',').slice(10, 15).join(',') === '試験 甲,07:00,21:00,06:58,21:20', c7x);

  /* B-8 CSV の列を末尾に足す */
  const m8 = month(sched({ 1: '早', 2: '早', 5: '有' }).rows, [P('sT01', 'in', '2026-12-01', '6:50'), P('sT01', 'out', '2026-12-01', '16:10')], [{ staff_id: 'sT01', work_date: '2026-12-02', day_mark: 'absent' }]);
  const plain = C.buildCsv(m8, { nameOf: (d) => d + '事業所' });
  t('B8: extraCols を付けない時は v1 の見出しのまま', plain.summary.split('\r\n')[0] === C.SUMMARY_HEAD.join(',') && plain.daily.split('\r\n')[0] === C.DAILY_HEAD.join(','));
  const x8 = C.buildCsv(m8, { nameOf: (d) => d + '事業所', extraCols: true });
  const xs = x8.summary.split('\r\n'), xd = x8.daily.split('\r\n');
  t('B8: 集計の見出し＝v1 の列のあとに 欠勤日数・有休時間・数えなかった時間・休日労働・実働_<事業所名>', xs[0] === C.SUMMARY_HEAD.concat(['欠勤日数', '有休時間', '数えなかった時間', '休日労働', '実働_施設事業所']).join(','), xs[0]);
  t('B8: 集計の行の先頭は v1 と同じ・末尾は 欠勤1・有休8:00・数えなかった0:20・休日0:00・施設8:00', xs[1].startsWith(plain.summary.split('\r\n')[1]) && xs[1].endsWith(',1,8:00,0:20,0:00,8:00'), xs[1]);
  /* 0120: 末尾に「数えなかった時間」「数えなかった理由」の2列を足した（列が増えた分だけ期待の文を延ばした・前の列は1字も変えない） */
  t('B8: 日ごとの見出し＝v1 の列のあとに 氏名〜印・数えなかった時間・数えなかった理由', xd[0] === C.DAILY_HEAD.concat(['氏名', '予定の開始', '予定の終わり', '打刻の出勤（生）', '打刻の退勤（生）', '残業', '休日労働', '有休時間', '印', '数えなかった時間', '数えなかった理由']).join(','), xd[0]);
  t('B8: 日ごとの行（先頭は v1 と同じ・生の打刻 06:50/16:10）', xd[1] === '9001,2026-12-01,07:00,16:00,60,8:00,0:00,施設事業所,早,,試験 甲,07:00,16:00,06:50,16:10,0:00,0:00,0:00,,0:20,', xd[1]);
  t('B8: 欠勤の日も行に出て、印は「欠勤」', xd[2] === '9001,2026-12-02,,,0,0:00,0:00,施設事業所,早,,試験 甲,07:00,16:00,,,0:00,0:00,0:00,欠勤,0:00,', xd[2]);
  t('B8: 有休の日の行の有休時間 8:00', /^9001,2026-12-05,,,0,0:00,0:00,,有,有休 8:00,試験 甲,,,,,0:00,0:00,8:00,,0:00,$/.test(xd[3]), xd[3]);
  const onlyAbs = C.buildCsv(month(sched({ 2: '早' }).rows, [], [{ staff_id: 'sT01', work_date: '2026-12-02', day_mark: 'absent' }]));
  t('B8: 欠勤だけの人も集計に出る', onlyAbs.summary.split('\r\n')[1].startsWith('9001,'), onlyAbs.summary);

  /* B-9 法定休日（2026-12-06 は日曜） */
  t('B9: 設定の確かめ（null・"3"・6 は可／7・1.5・"x" は不可）', C.checkLegalHoliday(null).ok && C.checkLegalHoliday(null).value === null && C.checkLegalHoliday('3').value === 3 && C.checkLegalHoliday(6).value === 6 && !C.checkLegalHoliday(7).ok && !C.checkLegalHoliday(1.5).ok && !C.checkLegalHoliday('x').ok);
  t('B9: 既定は null・壊れた値は null・0 は日曜で残る', C.fillConfig({}).legal_holiday === null && C.fillConfig({ legal_holiday: 9 }).legal_holiday === null && C.fillConfig({ legal_holiday: 0 }).legal_holiday === 0);
  const H6 = sched({ 6: '7-18' }).rows, h6p = [P('sT01', 'in', '2026-12-06', '7:00'), P('sT01', 'out', '2026-12-06', '18:00')];
  const hNone = month(H6, h6p, [], { variableMonth: false }), hSun = month(H6, h6p, [], { variableMonth: false, legal_holiday: 0 });
  t('B9: 決めない時は休日労働0・法定外は従来どおり120分', sumOf(hNone, 'sT01').holidayMin === 0 && sumOf(hNone, 'sT01').legalOverMin === 120);
  t('B9: 日曜を法定休日にすると10hが休日労働・法定外には重ねない（0）', sumOf(hSun, 'sT01').holidayMin === 600 && sumOf(hSun, 'sT01').legalOverMin === 0 && dayOf(hSun, 'sT01', '2026-12-06').holidayMin === 600, sumOf(hSun, 'sT01'));
  t('B9: ほかの曜日（土曜）を決めた時は日曜の勤務は休日労働にならない', sumOf(month(H6, h6p, [], { variableMonth: false, legal_holiday: 6 }), 'sT01').holidayMin === 0);
  const hn = month(sched({ 5: '(22', 6: '8)(22', 7: '8)' }).rows, [P('sT01', 'in', '2026-12-05', '22:00'), P('sT01', 'out', '2026-12-06', '8:00'), P('sT01', 'in', '2026-12-06', '22:00'), P('sT01', 'out', '2026-12-07', '8:00')], [], { legal_holiday: 0 });
  t('B9: 夜勤は暦日で分ける（土22→日8 は 8/10 の 384分・日22→月8 は 2/10 の 96分）', blk(hn, '2026-12-05').holidayMin === 384 && blk(hn, '2026-12-06').holidayMin === 96, [blk(hn, '2026-12-05').holidayMin, dayOf(hn, 'sT01', '2026-12-06') && blk(hn, '2026-12-06').holidayMin]);
  const wk = [];
  for (let d = 6; d <= 12; d++) { const ds = '2026-12-' + String(d).padStart(2, '0'); wk.push(P('sT01', 'in', ds, '9:00'), P('sT01', 'out', ds, '17:00')); }
  t('B9: 変形なしの週: 7日×7h は決めない時 9h・日曜を法定休日にすると残り6日の 2h が法定外', sumOf(month([], wk, [], { variableMonth: false }), 'sT01').legalOverMin === 540 && sumOf(month([], wk, [], { variableMonth: false, legal_holiday: 0 }), 'sT01').legalOverMin === 120);

  /* B-10 事業所別 */
  const o10 = month(sched({ 11: '9-18' }, { 11: '早' }, { sT01: { '通所': { 11: '7-9' } } }).rows, [P('sT01', 'in', '2026-12-11', '7:00'), P('sT01', 'out', '2026-12-11', '18:00'), P('sT02', 'in', '2026-12-11', '7:00'), P('sT02', 'out', '2026-12-11', '16:00')]);
  const bo = sumOf(o10, 'sT01').byOffice;
  t('B10: 個人の byOffice（施設＋通所＝実働）', bo.facility > 0 && bo.day > 0 && bo.facility + bo.day === sumOf(o10, 'sT01').workMin, bo);
  t('B10: 月全体の totals.byOffice・totals.workMin', o10.totals && o10.totals.workMin === sumOf(o10, 'sT01').workMin + sumOf(o10, 'sT02').workMin && o10.totals.byOffice.visit === 480 && o10.totals.byOffice.facility === bo.facility, o10.totals);

  const snapH = C.snapshotOf(hSun).rows.find((r) => r.staff_id === 'sT01');
  const snapA = C.snapshotOf(dm).rows.find((r) => r.staff_id === 'sT01');
  const snapU = C.snapshotOf(u).rows.find((r) => r.staff_id === 'sT01');
  t('B9/B10: 締めの控えに休日労働・欠勤日数・有休時間・数えなかった時間・事業所別が入る', snapH.holidayMin === 600 && snapA.absentDays === 1 && snapU.uncountedMin === 30 && C.snapshotOf(pdm).rows.find((r) => r.staff_id === 'sT01').paidMin === 1321 && snapH.byOffice.facility === 600, [snapH, snapA.absentDays, snapU.uncountedMin]);

  /* B-11 要確認の一覧 */
  const r11 = month(sched({ 3: '早', 9: '7-9 17-21', 10: '早' }, { 2: '早' }).rows, [
    P('sT01', 'in', '2026-12-03', '6:20'), P('sT01', 'out', '2026-12-03', '16:00'),
    P('sT01', 'in', '2026-12-09', '7:00'), P('sT01', 'out', '2026-12-09', '9:00'), P('sT01', 'in', '2026-12-09', '17:00'),
    P('sT01', 'in', '2026-12-10', '6:20'), P('sT01', 'out', '2026-12-10', '16:00')
  ], [{ staff_id: 'sT01', work_date: '2026-12-10', day_mark: 'checked' }]);
  const rl = C.reviewList(r11);
  t('B11: 日付順（乙の2日→甲の3日→甲の9日）・確認済み（10日）は入れない', rl.map((x) => x.staffId + '@' + x.date).join() === 'sT02@2026-12-02,sT01@2026-12-03,sT01@2026-12-09', rl);
  t('B11: 形は { staffId, date, marks, blockIndex }・marks は要確認の印だけ', JSON.stringify(rl[1]) === JSON.stringify({ staffId: 'sT01', date: '2026-12-03', marks: ['early'], blockIndex: 0 }) && rl[0].marks.join() === 'no_punch', rl);
  t('B11: 分割勤務の後ろの塊は blockIndex 1', rl[2].blockIndex === 1 && rl[2].marks.join() === 'missing_out', rl[2]);
  t('B11: 件数は reviewCount の合計と同じ', rl.length === sumOf(r11, 'sT01').reviewCount + sumOf(r11, 'sT02').reviewCount && rl.length === r11.totals.reviewCount);
  t('B11: 空の結果でも配列', Array.isArray(C.reviewList({ people: [] })) && C.reviewList({ people: [] }).length === 0);
}

console.log('\n— 0101. 月を締め日で切る（期間・週の段・時間の区分）—');
/* 凍結仕様 ROOT-payroll.md「A.」・設計検品 review-2026-11-19.md の重大6・7・中1・給与の契約 CONTRACT-payroll-v1.md §2。
   ★回帰の例外（締め日が月末＝期間がカレンダー月のままでも結果が変わる所・仕様が求める直し。下の「例外」の付いた試験が新しい期待を固定する）:
     例外1（重大7）: 変形なし・月の初日をまたぐ週は、前の月の日も積み上げて週40時間を数える（旧: その月の日だけ＝前の月の分の超過を落としていた）
     例外2（重大6）: 変形あり（1か月単位）に週の段を足す（旧: 週の枠を見ず、総枠内なら週48時間でも法定外0＝未払い側）
     例外3（給与の契約 §2）: schedInMin は「所定内の実働」（重ならない4つの1つ・法定休日と法定外を含まない）。旧は 総労働−残業 で、
            法定休日の実働と予定の中で法定外になった分（変形なしの9時間の予定など）を含んでいた。CSV の「所定内」の列は今までどおり 総労働−残業 で出す */
{
  let qid = 0;
  const Q = (d, hm0, hm1) => [hm0, hm1].map((hm, i) => ({ id: 'q' + (++qid), staff_id: 'sT01', kind: i ? 'out' : 'in', at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() }));
  const KS = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }];
  const sch = (ym, cells) => C.buildSchedule({ ym, plan: { cells: { sT01: cells } }, staff: [STAFF[0]], symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
  const run = (ym, period, schedule, dates, hm0, hm1, days, config) => {
    const punches = []; dates.forEach((d) => punches.push(...Q(d, hm0, hm1)));
    return C.computeMonth({ ym, period, staff: KS, schedule, punches, days: days || [], config: config || {}, now: Date.parse('2027-02-01T00:00:00+09:00') });
  };
  const S = (m) => m.people[0].sum;
  const parts = (s) => s.schedInMin + s.legalInOverMin + s.legalOverMin + s.holidayMin === s.workMin;
  const range = (a, n) => Array.from({ length: n }, (_, i) => C.addDays(a, i));

  t('期間の名前は「2026年12月分（11/16〜12/15）」・年をまたぐ月分・省いた時と形の違う時はその月の1日〜末日',
    C.periodLabel('2026-12', { from: '2026-11-16', to: '2026-12-15' }) === '2026年12月分（11/16〜12/15）' && C.periodLabel('2027-01', { from: '2026-12-16', to: '2027-01-15' }) === '2027年1月分（12/16〜1/15）' &&
    C.periodLabel('2026-12') === '2026年12月分（12/1〜12/31）' && C.periodLabel('2026-12', { from: 'x', to: 'y' }) === '2026年12月分（12/1〜12/31）' &&
    C.periodOf('2026-12', { from: '2026-12-15', to: '2026-12-01' }).from === '2026-12-01' && C.periodOf('2026-02', { from: '2026-02-30', to: '2026-03-01' }).to === '2026-02-28' &&
    C.periodDays({ from: '2026-11-16', to: '2026-12-15' }) === 30);
  const mb = run('2026-12', { from: '2026-11-16', to: '2026-12-15' }, [], ['2026-11-20', '2026-12-10', '2026-12-20'], '9:00', '12:00');
  t('期間の日だけを数える（11/20 と 12/10 は入り、12/20 は入らない）・結果に period', mb.people[0].days.map((d) => d.date).join() === '2026-11-20,2026-12-10' && S(mb).workMin === 360 && mb.period.from === '2026-11-16' && mb.period.to === '2026-12-15', mb.people[0].days.map((d) => d.date));
  const dates6 = ['2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18'];
  const cJan = run('2027-01', { from: '2026-12-16', to: '2027-01-15' }, [], dates6, '9:00', '17:00', [], { variableMonth: false });
  const cDec = run('2026-12', { from: '2026-11-16', to: '2026-12-15' }, [], dates6, '9:00', '17:00', [], { variableMonth: false });
  t('変形なし・期間をまたぐ週（日曜 12/13〜土曜 12/19）: 前の月分の3日21hと今の月分の3日21hで42h＝2hが今の月分の法定外・前の6日分は日の一覧に出さない',
    S(cJan).legalOverMin === 120 && S(cJan).weekOverMin === 120 && cJan.people[0].days.map((d) => d.date).join() === '2026-12-16,2026-12-17,2026-12-18' && S(cJan).workMin === 1260, S(cJan));
  t('同じ打刻を前の月分（11/16〜12/15）で数えると週は21hだけ＝法定外0（二重に数えない）', S(cDec).legalOverMin === 0 && S(cDec).workMin === 1260, S(cDec));
  const lead42 = run('2027-01', { from: '2026-12-19', to: '2027-01-18' }, [], ['2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19'], '9:00', '17:00', [], { variableMonth: false });
  t('前の6日分だけで週40hを超えた分は前の月分の物・今の月分の 12/19 の7hは全部法定外', S(lead42).legalOverMin === 420 && S(lead42).workMin === 420, S(lead42));
  const d0 = run('2026-12', null, [], ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'], '9:00', '17:00', [], { variableMonth: false });
  t('例外1: 締め日が月末でも、変形なしの月の初日をまたぐ週は前の月の 11/29・11/30 を積み上げる（旧は12月の4日28hだけで0・新は42h＝2h）', S(d0).legalOverMin === 120 && S(d0).workMin === 1680, S(d0));
  const e0 = run('2026-12', null, [], range('2026-12-06', 6), '8:00', '17:00');
  t('例外2: 変形あり・予定の無い週6日×8h（48h）は、総枠内でも週の段で8hが法定外（旧は0）', S(e0).legalOverMin === 480 && S(e0).weekOverMin === 480 && S(e0).frameOverMin === 0, S(e0));
  const e1 = run('2026-12', null, sch('2026-12', { 6: '早', 7: '早', 8: '早', 9: '早', 10: '早', 11: '早' }), range('2026-12-06', 6), '7:00', '16:00');
  t('変形あり・予定どおり週6日×8h（予定の週48h）は週の段でも法定外0（予定の週の実働と40hの長い方を超えた分だけ）', S(e1).legalOverMin === 0 && S(e1).schedInMin === 2880, S(e1));
  const e2 = run('2026-12', { from: '2026-11-16', to: '2026-12-15' }, [], range('2026-11-16', 6), '9:00', '16:00');
  t('変形あり・期間の端の6日の週（11/16 月〜11/21 土）の40hは 40h×6÷7＝2057分（切り捨て・仮置き）: 6日×6h＝2160分 → 103分が法定外', S(e2).legalOverMin === 103 && S(e2).weekOverMin === 103, S(e2));
  const fr = run('2026-12', { from: '2026-11-16', to: '2026-12-15' }, sch('2026-12', {}).concat(sch('2026-11', {})), range('2026-11-16', 30).filter((d, i) => i % 7 !== 6), '8:00', '13:00');
  t('変形あり・総枠は期間の日数で 40h×30÷7＝10285分（5h×26日＝7800分は枠の内・端の6日の週も 1500分で 2057分の内）', S(fr).frameOverMin === 0 && S(fr).legalOverMin === 0 && S(fr).workMin === 26 * 300, S(fr));
  const fr3 = run('2026-12', { from: '2026-11-16', to: '2026-12-15' }, [], range('2026-11-16', 30), '8:00', '15:00');
  t('変形あり・予定の無い 6h×30日: 週の段が 端の6日の週 103分＋7日の週3つ 各120分＋最後の3日（1028分）52分＝515分・残り 10285分はちょうど総枠で超過0', S(fr3).weekOverMin === 515 && S(fr3).frameOverMin === 0 && S(fr3).legalOverMin === 515, S(fr3));
  const every = {}; for (let d = 1; d <= 31; d++) every[d] = '早';
  const fr4 = run('2026-12', { from: '2026-11-16', to: '2026-12-15' }, sch('2026-11', every).concat(sch('2026-12', every)), range('2026-11-16', 30), '7:00', '16:00');
  t('変形あり・予定どおり毎日8h（予定の週が40hを超える）: 日・週の段は0・総枠 10285分を超えた 14400−10285＝4115分が法定外', S(fr4).weekOverMin === 0 && S(fr4).frameOverMin === 4115 && S(fr4).legalOverMin === 4115 && S(fr4).schedInMin === 14400 - 4115, S(fr4));
  const fr2 = run('2026-12', { from: '2026-12-01', to: '2026-12-07' }, [], range('2026-12-01', 7), '8:00', '15:00');
  t('変形あり・7日の短い期間（切り替えの月）は総枠 2400分・週の段（12/1〜12/5 の5日は 1714分を超えた86分・12/6〜7 の2日は 685分を超えた35分）を除いた残りが総枠の超過（2399分＝0）', S(fr2).weekOverMin === 86 + 35 && S(fr2).frameOverMin === Math.max(0, 2520 - S(fr2).weekOverMin - 2400) && S(fr2).legalOverMin === S(fr2).weekOverMin + S(fr2).frameOverMin, S(fr2));
  const g0 = run('2026-12', null, sch('2026-12', { 6: '7-18' }), ['2026-12-06'], '7:00', '18:00', [], { variableMonth: false, legal_holiday: 0 });
  t('例外3: 予定のある法定休日の10hは holidayMin だけ（所定内0・旧の所定内は 600）', S(g0).holidayMin === 600 && S(g0).schedInMin === 0 && S(g0).legalOverMin === 0 && parts(S(g0)), S(g0));
  const h0 = run('2026-12', null, sch('2026-12', { 7: '7-17' }), ['2026-12-07'], '7:00', '17:00', [], { variableMonth: false });
  t('例外3: 変形なしの9hの予定を予定どおり働いた日は 所定内8h・法定外1h（旧の所定内は 540）', S(h0).schedInMin === 480 && S(h0).legalOverMin === 60 && S(h0).legalInOverMin === 0 && parts(S(h0)), S(h0));
  const csvH = C.buildCsv(h0, {}).summary.split('\r\n')[1].split(',');
  t('例外3: CSV の「所定内」の列は今までどおり 総労働−残業（9:00）', csvH[C.SUMMARY_HEAD.indexOf('所定内')] === '9:00', csvH);
  const csvG = C.buildCsv(g0, {}).summary.split('\r\n')[1].split(',');
  t('例外3: 予定のある法定休日の10hも、CSV の「所定内」の列は今までどおり 総労働−残業（10:00・画面の所定内（法定内）は 0）', csvG[C.SUMMARY_HEAD.indexOf('所定内')] === '10:00' && csvG[C.SUMMARY_HEAD.indexOf('総労働時間')] === '10:00', csvG);
  const i0 = run('2026-12', null, sch('2026-12', { 8: '9-14' }), ['2026-12-08'], '9:00', '16:00', [{ staff_id: 'sT01', work_date: '2026-12-08', overtime_ok: true }]);
  t('法定内残業: 予定5hのパートが7h働いた日は 所定内5h・法定内残業2h・法定外0', S(i0).schedInMin === 300 && S(i0).legalInOverMin === 120 && S(i0).legalOverMin === 0 && parts(S(i0)), S(i0));
  const f0 = run('2026-12', null, [], range('2026-12-01', 20), '7:00', '20:00', [], { variableMonth: false });
  t('60時間超: 日4h×20日＋週の超過32h＝112h の法定外のうち 60h を超えた52hが over60Min（法定外に含む）', S(f0).legalOverMin === 6720 && S(f0).over60Min === 3120 && S(f0).weekOverMin === 1920 && parts(S(f0)), S(f0));
  const j0 = C.computeMonth({ ym: '2026-12', staff: KS, schedule: sch('2026-12', { 1: '早', 3: '(22', 4: '8)', 5: '有', 6: '早' }), days: [],
    punches: [...Q('2026-12-01', '7:00', '16:00'), { id: 'n1', staff_id: 'sT01', kind: 'in', at: new Date(at('2026-12-03', '22:00')).toISOString(), source: 'tablet' }, { id: 'n2', staff_id: 'sT01', kind: 'out', at: new Date(at('2026-12-04', '8:00')).toISOString(), source: 'tablet' }, ...Q('2026-12-09', '9:00', '12:00')],
    config: {}, now: Date.parse('2027-02-01T00:00:00+09:00') });
  t('夜勤の回数は実際に働いた夜勤の塊の数（1）・所定日数は予定か有休のある日（早2・夜勤1・有1＝4）・記号ごとの回数は働いた塊と有休（打刻の無い 12/6 の早は数えない）',
    S(j0).nightShiftCount === 1 && S(j0).schedDays === 4 && S(j0).counts['早'] === 1 && S(j0).counts['有'] === 1 && Object.keys(S(j0).counts).length === 3 && parts(S(j0)), S(j0));
  const k0 = C.computeMonth({ ym: '2026-12', staff: KS, schedule: sch('2026-12', { 8: '9-14', 9: '7-17' }), days: [{ staff_id: 'sT01', work_date: '2026-12-08', overtime_ok: true }],
    punches: [...Q('2026-12-08', '9:00', '16:00'), ...Q('2026-12-09', '7:00', '17:00')], config: { variableMonth: false }, now: Date.parse('2027-02-01T00:00:00+09:00') });
  t('法定内残業は日ごと: 予定5hを7h働いた日（法定内2h）と予定9hを9h働いた日（法定外1h）が同じ月でも 所定内780・法定内残業120・法定外60（月の合計どうしで引かない）',
    S(k0).schedInMin === 780 && S(k0).legalInOverMin === 120 && S(k0).legalOverMin === 60 && parts(S(k0)), S(k0));
  const sp0 = C.computeMonth({ ym: '2026-12', staff: KS, schedule: sch('2026-12', { 4: '7-9 17-21' }), days: [], punches: [...Q('2026-12-04', '7:00', '9:00'), ...Q('2026-12-04', '17:00', '21:00')], config: {}, now: Date.parse('2027-02-01T00:00:00+09:00') });
  t('記号の回数: 分割勤務の1マス（7-9 17-21）を両方働いても、その記号は1回', S(sp0).counts[sch('2026-12', { 4: '7-9 17-21' })[0].symbol] === 1 && sch('2026-12', { 4: '7-9 17-21' }).length === 2 && Object.keys(S(sp0).counts).length === 1, S(sp0).counts);
  const wk7 = {}; for (let d = 6; d <= 11; d++) wk7[d] = '9-17';
  const w7 = C.computeMonth({ ym: '2026-12', staff: KS, schedule: sch('2026-12', wk7), days: [{ staff_id: 'sT01', work_date: '2026-12-06', overtime_ok: true }],
    punches: [...Q('2026-12-06', '9:00', '18:00'), ...range('2026-12-07', 5).flatMap((d) => Q(d, '9:00', '17:00'))], config: { variableMonth: false }, now: Date.parse('2027-02-01T00:00:00+09:00') });
  t('反証レビューの指摘2: 変形なし・日〜金に7hの予定（週42h）で日曜に8h働いた週は、日曜の1hは法定内（週の頭）・金曜の予定の3hが週40hの超過＝所定内2340・法定内残業60・法定外180',
    S(w7).workMin === 2580 && S(w7).schedInMin === 2340 && S(w7).legalInOverMin === 60 && S(w7).legalOverMin === 180 && parts(S(w7)), S(w7));
  const w8 = C.computeMonth({ ym: '2026-12', staff: KS, schedule: sch('2026-12', wk7), days: [{ staff_id: 'sT01', work_date: '2026-12-11', overtime_ok: true }],
    punches: [...range('2026-12-06', 5).flatMap((d) => Q(d, '9:00', '17:00')), ...Q('2026-12-11', '9:00', '18:00')], config: { variableMonth: false }, now: Date.parse('2027-02-01T00:00:00+09:00') });
  t('同じ週で金曜の終わりに1h働いた時は、その1hも週40hの後ろ＝法定外（所定内2400・法定内残業0・法定外180）', S(w8).schedInMin === 2400 && S(w8).legalInOverMin === 0 && S(w8).legalOverMin === 180 && parts(S(w8)), S(w8));
  const mk = (cells, punches, days) => C.computeMonth({ ym: '2026-12', staff: KS, schedule: sch('2026-12', cells), days: days || [], punches, config: { variableMonth: false }, now: Date.parse('2027-02-01T00:00:00+09:00') });
  const pre39 = [...range('2026-12-06', 4).flatMap((d) => Q(d, '9:00', '18:00')), ...Q('2026-12-10', '9:00', '17:00')];   /* 予定の無い 8h×4日＋7h＝39h（日〜木） */
  const ea0 = mk({ 11: '9-17' }, [...pre39, ...Q('2026-12-11', '8:00', '17:00')], [{ staff_id: 'sT01', work_date: '2026-12-11', early_ok: true }]);
  t('見直し1: 週の累計39hの金曜に 8〜9時の早出＋9〜17時の予定（7h）→ 週の超過7hは時刻の後ろ（予定の7h）から当たり、早出の1hは法定内（所定内0・法定内残業 39h＋1h・法定外7h）',
    S(ea0).schedInMin === 0 && S(ea0).legalInOverMin === 2400 && S(ea0).legalOverMin === 420 && parts(S(ea0)), S(ea0));
  const pre36 = [...range('2026-12-06', 4).flatMap((d) => Q(d, '9:00', '18:00')), ...Q('2026-12-10', '9:00', '13:00')];   /* 32h＋4h＝36h */
  const sp1 = mk({ 11: '7-9 17-21' }, [...pre36, ...Q('2026-12-11', '6:00', '9:00'), ...Q('2026-12-11', '17:00', '21:00')], [{ staff_id: 'sT01', work_date: '2026-12-11', early_ok: true }]);
  t('見直し1: 分割勤務（7-9・17-21）の朝に1hの早出・週の累計36h → 超過3hは後ろの塊の予定から当たり、早出の1hは法定内（所定内180・法定内残業 36h＋1h・法定外180）',
    S(sp1).schedInMin === 180 && S(sp1).legalInOverMin === 2220 && S(sp1).legalOverMin === 180 && parts(S(sp1)), S(sp1));
  const sp2 = mk({ 11: '7-9 17-21' }, [...pre36, ...Q('2026-12-11', '7:00', '9:00'), ...Q('2026-12-11', '17:00', '22:00')], [{ staff_id: 'sT01', work_date: '2026-12-11', overtime_ok: true }]);
  t('見直し1: 分割勤務の夜に1hの残業・週の累計36h → 超過3hは後ろの残業1h＋予定2h（所定内240・法定内残業 36h・法定外180）',
    S(sp2).schedInMin === 240 && S(sp2).legalInOverMin === 2160 && S(sp2).legalOverMin === 180 && parts(S(sp2)), S(sp2));
  const ed0 = mk({ 11: '9-17' }, [...Q('2026-12-11', '8:00', '18:00')], [{ staff_id: 'sT01', work_date: '2026-12-11', early_ok: true, overtime_ok: true }]);
  t('見直し1: 日の8h超えも時刻の後ろから（早出1h＋予定7h＋残業1h＝9h → 後ろの残業1hが法定外・早出1hは法定内・所定内7h）',
    S(ed0).schedInMin === 420 && S(ed0).legalInOverMin === 60 && S(ed0).legalOverMin === 60 && parts(S(ed0)), S(ed0));
  const all = [ea0, sp1, sp2, ed0, w7, w8, k0, sp0, mb, cJan, cDec, lead42, d0, e0, e1, e2, fr, fr2, fr3, fr4, g0, h0, i0, f0, j0];
  t('どの場面でも 所定内＋法定内残業＋法定外＋法定休日＝総労働・どれも0以上・over60Min は法定外−60h', all.every((m) => { const s = S(m); return parts(s) && s.schedInMin >= 0 && s.legalInOverMin >= 0 && s.over60Min === Math.max(0, s.legalOverMin - 3600); }));
  const sn = C.snapshotOf(j0);
  t('締めの控えに期間と、給与の入力（法定内残業・60時間超・夜勤の回数・所定日数・記号ごとの回数）が入る', sn.period.from === '2026-12-01' && sn.rows[0].nightShiftCount === 1 && sn.rows[0].schedDays === 4 && sn.rows[0].counts['有'] === 1 && 'legalInOverMin' in sn.rows[0] && 'over60Min' in sn.rows[0]);
  t('CSV の見出しの列は変えない', C.buildCsv(j0, {}).summary.split('\r\n')[0] === C.SUMMARY_HEAD.join(','));
}

console.log('\n— 9. v4 手で入れた有休の使用（leave_uses・L8） —');
{
  const paidRow = (d, min) => ({ staff_id: 'sT01', work_date: '2026-12-' + d, seq: 9, kind: 'paid', start_at: null, end_at: null, break_min: 0, paid_min: min, office: 'facility', symbol: '有' });
  const U = (sid, d, days, extra) => Object.assign({ id: 'u-' + sid + d, staff_id: sid, use_date: '2026-12-' + d, days }, extra || {});
  const base = sched({ 2: '早', 9: '早' }).rows.concat([paidRow('05', 480)]);
  const pun = [P('sT01', 'in', '2026-12-02', '7:00'), P('sT01', 'out', '2026-12-02', '16:00')];
  const mk2 = (uses) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: base, punches: pun, days: [], config: {}, now: NOW, leave_uses: uses });
  const m0 = month(base, pun);
  t('leave_uses が無い・空の配列・形の違う値の時は、結果が1バイトも変わらない', JSON.stringify(mk2(undefined)) === JSON.stringify(m0) && JSON.stringify(mk2([])) === JSON.stringify(m0) && JSON.stringify(mk2('x')) === JSON.stringify(m0));
  const m1 = mk2([U('sT01', '05', 1), U('sT01', '12', 1), U('sT01', '13', 0.5), U('sT01', '09', 1), U('sT01', '14', 1, { voided_at: '2026-12-15T00:00:00Z' }), U('sT01', '15', 2), { id: 'x', staff_id: 'sT01', use_date: '2027-01-02', days: 1 }]);
  const s1 = sumOf(m1, 'sT01');
  t('シフトの有休の行がある日（12/5）は手入力を足さない（1日・480分のまま・印なし）', dayOf(m1, 'sT01', '2026-12-05').paidDays === 1 && dayOf(m1, 'sT01', '2026-12-05').paidMin === 480 && !dayOf(m1, 'sT01', '2026-12-05').leaveUse);
  t('予定の無い日の手入力の1日は480分・半日は240分（日数は入れたまま）', dayOf(m1, 'sT01', '2026-12-12').paidMin === 480 && dayOf(m1, 'sT01', '2026-12-12').paidDays === 1 && dayOf(m1, 'sT01', '2026-12-13').paidMin === 240 && dayOf(m1, 'sT01', '2026-12-13').paidDays === 0.5);
  t('予定（早 7-16・実働480分）のある日の手入力の1日は、その日の所定480分・1日（比の式で0.5日にしない）', dayOf(m1, 'sT01', '2026-12-09').paidMin === 480 && dayOf(m1, 'sT01', '2026-12-09').paidDays === 1, dayOf(m1, 'sT01', '2026-12-09'));
  t('手入力を数えた日にだけ leaveUse の印（id と日数）', dayOf(m1, 'sT01', '2026-12-12').leaveUse.id === 'u-sT0112' && dayOf(m1, 'sT01', '2026-12-13').leaveUse.days === 0.5 && !('leaveUse' in dayOf(m1, 'sT01', '2026-12-02')));
  t('取り消した使用・日数の形の違う使用（2日）・期間の外の使用は数えない', !dayOf(m1, 'sT01', '2026-12-14') && !dayOf(m1, 'sT01', '2026-12-15') && !m1.people[0].days.some((d) => d.date > '2026-12-31'));
  t('月の有休日数 1＋1＋0.5＋1＝3.5日・有休時間 480＋480＋240＋480＝1680分', s1.paidDays === 3.5 && s1.paidMin === 1680, [s1.paidDays, s1.paidMin]);
  t('有休の日は所定日数に入り、予定のある日の手入力の有休は欠勤・打刻なしの日に数えない', s1.schedDays === sumOf(m0, 'sT01').schedDays + 2 && s1.noPunchDays === sumOf(m0, 'sT01').noPunchDays - 1 && s1.absentDays === 0, [s1.schedDays, s1.noPunchDays]);
  const sn = C.snapshotOf(m1).rows.find((r) => r.staff_id === 'sT01');
  t('締めの控え（給与の att）に有休日数・有休時間が入る', sn.paidDays === 3.5 && sn.paidMin === 1680, sn);
  t('月の合計の有休時間にも入る', m1.totals.paidMin === m0.totals.paidMin + 1200);
  const csv = C.buildCsv(m1, { extraCols: true });
  t('CSV の見出しの列は変えない（手入力の有休が無い月と同じ見出し）', csv.summary.split('\r\n')[0] === C.buildCsv(m0, { extraCols: true }).summary.split('\r\n')[0] && csv.daily.split('\r\n')[0] === C.buildCsv(m0, { extraCols: true }).daily.split('\r\n')[0]);
  t('日ごとの明細に手入力の有休の日の行（有）が出る', csv.daily.split('\r\n').some((l) => l.indexOf('9001,2026-12-12,') === 0 && /,有,/.test(l)));
  const m2 = mk2([U('sT09', '12', 1)]);
  t('名簿に無い職員の手入力の使用も落とさない（名簿に無い記録の印）', m2.people.some((p) => p.staff.staff_id === 'sT09' && p.staff.missingStaff && p.sum.paidDays === 1));
  const m3 = mk2([U('sT01', '12', 1), U('sT01', '12', 0.5)]);
  t('同じ人・同じ日の2行目は数えない（DB も1行だけ）', dayOf(m3, 'sT01', '2026-12-12').paidDays === 1);
}

console.log('\n— 11. シフトの写し方の直し（2026-11-25・本番の勤務表と freee の予定で検証） —');
{
  const bs = (cells, opt) => C.buildSchedule({ ym: YM, plan: { cells: { sT01: cells } }, nextPlan: (opt && opt.next) || {}, staff: [Object.assign({}, STAFF[0], (opt && opt.st) || {})], symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } });
  const r1 = bs({ 1: '遅' }, { st: { rules: { break2h: true } } }).rows[0];
  t('休憩2時間の職員（rules.break2h）の「遅」は予定の休憩120分', r1.break_min === 120, r1);
  t('休憩2時間でない職員の「遅」は60分のまま', bs({ 1: '遅' }).rows[0].break_min === 60);
  t('拘束6時間ちょうど（9-15）は休憩0（6時間を超える時だけ休憩）', bs({ 1: '9-15' }).rows[0].break_min === 0);
  t('拘束6時間30分（9-15:30）は休憩60', bs({ 1: '9-15:30' }).rows[0].break_min === 60);
  const m6 = month(bs({ 2: '9-15' }).rows, [P('sT01', 'in', '2026-12-02', '8:45'), P('sT01', 'out', '2026-12-02', '15:05')]);
  t('9-15 の日に 8:45〜15:05 を打つと実働360分・残業0', dayOf(m6, 'sT01', '2026-12-02').workMin === 360 && sumOf(m6, 'sT01').legalInOverMin + sumOf(m6, 'sT01').legalOverMin === 0, dayOf(m6, 'sT01', '2026-12-02'));
  /* 夜勤の途中の休みの書き方（本番の12月の勤務表にあった並び） */
  const n1 = bs({ 20: '(', 21: '有)(21', 22: '7)' });
  t('「(」→「有)(21」→「7)」: 20日に有休の行・21日に 21:00〜翌7:00 の夜勤・警告なし',
    n1.rows.some((r) => r.work_date === '2026-12-20' && r.kind === 'paid') && n1.rows.some((r) => r.work_date === '2026-12-21' && r.kind === 'night' && /T21:00/.test(new Date(Date.parse(r.start_at) + 9 * 3600e3).toISOString()) && /2026-12-22T07:00/.test(new Date(Date.parse(r.end_at) + 9 * 3600e3).toISOString())) && n1.warnings.length === 0, n1);
  const n2 = bs({ 26: '(22', 27: '8)(', 28: '有)' });
  t('「8)(」→「有)」: 26日の夜勤は翌8時まで・27日に有休の行・警告なし',
    n2.rows.some((r) => r.work_date === '2026-12-26' && r.kind === 'night' && /2026-12-27T08:00/.test(new Date(Date.parse(r.end_at) + 9 * 3600e3).toISOString())) && n2.rows.some((r) => r.work_date === '2026-12-27' && r.kind === 'paid') && n2.warnings.length === 0, n2);
  const n3 = bs({ 5: '(', 6: '休)' });
  t('「(」→「休)」は行を作らず警告もない', n3.rows.length === 0 && n3.warnings.length === 0, n3);
  const w5 = bs({ 5: '(' }).warnings;
  t('翌日に「有)」などが無い「(」は警告を出す（入りの代わりの警告）', w5.length === 1 && /入りの代わり/.test(w5[0].msg), w5);
  const w6 = bs({ 5: '有)' }).warnings;
  t('前の日に「(」の無い「有)」は警告を出す（黙って有休を落とさない）', w6.length === 1 && /前の日/.test(w6[0].msg), w6);
  const n7 = bs({ 31: '(' }, { next: { cells: { sT01: { 1: '有)' } } } });
  t('月末の「(」と翌月1日の「有)」は31日に有休の行・警告なし', n7.rows.some((r) => r.work_date === '2026-12-31' && r.kind === 'paid') && n7.warnings.length === 0, n7);
  t('今まで読めた書き方（(22・8)(22・(有・7)(有）は今までどおり', bs({ 1: '(22', 2: '8)(22', 3: '8)' }).rows.filter((r) => r.kind === 'night').length === 2 && bs({ 1: '(有' }).warnings.length === 0 && bs({ 1: '(21', 2: '7)(有' }).rows.filter((r) => r.kind === 'night').length === 1 && bs({ 1: '(21', 2: '7)(有' }).warnings.length === 0);
  t('休憩2時間の職員でも夜勤の休憩は設定どおり（2時間）・6時間以下の勤務は休憩0', bs({ 1: '(22', 2: '8)' }, { st: { rules: { break2h: true } } }).rows[0].break_min === 120 && bs({ 1: '9-15' }, { st: { rules: { break2h: true } } }).rows[0].break_min === 0);
  t('読めない書き方（欠）は今までどおり警告', bs({ 1: '欠' }).warnings.length === 1);
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
