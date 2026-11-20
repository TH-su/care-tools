/* 勤怠の決まりの見張り（kintai-rules.js）の試験（2026-11-20 新設）
   実行: node check/unit/kintai_rules_test.js
   守りたいこと:
     1. 休憩: 6時間ちょうどは足りている・6時間を超えて45分未満は足りない・8時間を超えて60分未満は足りない・打刻した昼休みも休憩に数える
     2. 勤務の間: 遅番の後の早番（10時間）は 11時間未満で拾う・同じ日の分割勤務は拾わない・設定 0 で止まる
     3. 続けて働いた日: 7日で warn・13日で over・夜勤の明けの日も働いた日・休みで切れる
     4. 数えた時間（computeMonth の結果）を変えない（入れる前と後で JSON が同じ）
   ★職員は架空（試験 甲・試験 乙）。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'kintai-calc.js'));
const R = require(path.join(ROOT, 'kintai-rules.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const YM = '2026-12';
const NOW = Date.parse('2027-01-10T12:00:00+09:00');
const STAFF = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }, { staff_id: 'sT02', name: '試験 乙', office: 'visit', emp_code: null }];
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
const addD = (d, n) => C.addDays(d, n);
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(Date.parse(iso(d, hm))).toISOString(), source: 'tablet', created_at: new Date(Date.parse(iso(d, hm))).toISOString() });
const W = (sid, d, s, e, br, opt) => Object.assign({ staff_id: sid, work_date: d, kind: 'work', start_at: iso(d, s), end_at: e.indexOf('T') > 0 ? e : iso(d, e), break_min: br, paid_min: 0, office: 'facility', symbol: '早' }, opt || {});
function month(schedule, punches, days) { return C.computeMonth({ ym: YM, staff: STAFF, schedule, punches, days: days || [], config: { closeDay: 0 }, now: NOW }); }
const person = (m, sid) => m.people.find((p) => p.staff.staff_id === sid);

console.log('\n— 1. 休憩（労基法34条） —');
{
  /* 6時間ちょうど（9:00〜15:00・予定の休憩0）＝足りている */
  const m1 = month([W('sT01', '2026-12-01', '09:00', '15:00', 0)], [P('sT01', 'in', '2026-12-01', '09:00'), P('sT01', 'out', '2026-12-01', '15:00')]);
  t('6時間ちょうど・休憩0分は拾わない', R.checkPerson(person(m1, 'sT01')).breaks.length === 0, R.checkPerson(person(m1, 'sT01')));
  /* 予定 9:00〜14:00（休憩0）を残業で 17:00 まで（認めた残業）＝8時間・休憩0分 → 45分が要る… 8時間ちょうどなので 45分 */
  const m2 = month([W('sT01', '2026-12-02', '09:00', '14:00', 0)], [P('sT01', 'in', '2026-12-02', '09:00'), P('sT01', 'out', '2026-12-02', '17:00')],
    [{ staff_id: 'sT01', work_date: '2026-12-02', overtime_ok: true, ot_until: iso('2026-12-02', '17:00') }]);
  const b2 = R.checkPerson(person(m2, 'sT01')).breaks;
  t('短い予定を残業で8時間に延ばした日（休憩0分）は「45分要る」で拾う', b2.length === 1 && b2[0].needMin === 45 && b2[0].breakMin === 0 && b2[0].date === '2026-12-02', b2);
  /* 早番 7:00〜16:00・予定の休憩60分＝実働8時間・休憩60分 → 足りている */
  const m3 = month([W('sT01', '2026-12-03', '07:00', '16:00', 60)], [P('sT01', 'in', '2026-12-03', '07:00'), P('sT01', 'out', '2026-12-03', '16:00')]);
  t('早番（実働8時間・休憩60分）は拾わない', R.checkPerson(person(m3, 'sT01')).breaks.length === 0, R.checkPerson(person(m3, 'sT01')));
  /* 7:00〜17:00・休憩45分（日の直しで 45 に）＝実働9時間15分 → 60分が要る */
  const m4 = month([W('sT01', '2026-12-04', '07:00', '17:00', 60)], [P('sT01', 'in', '2026-12-04', '07:00'), P('sT01', 'out', '2026-12-04', '17:00')],
    [{ staff_id: 'sT01', work_date: '2026-12-04', break_min: 45 }]);
  const b4 = R.checkPerson(person(m4, 'sT01')).breaks;
  t('8時間を超えて休憩45分は「60分要る」で拾う', b4.length === 1 && b4[0].needMin === 60 && b4[0].breakMin === 45, b4);
  /* 昼休みを打刻（12:00〜13:00）した日は打刻の間も休憩 */
  const m5 = month([W('sT01', '2026-12-07', '08:00', '17:00', 60)], [P('sT01', 'in', '2026-12-07', '08:00'), P('sT01', 'out', '2026-12-07', '12:00'), P('sT01', 'in', '2026-12-07', '13:00'), P('sT01', 'out', '2026-12-07', '17:00')]);
  t('打刻した昼休み（60分）は休憩に数え、拾わない', R.checkPerson(person(m5, 'sT01')).breaks.length === 0, R.checkPerson(person(m5, 'sT01')));
}

console.log('\n— 2. 勤務の間（インターバル） —');
{
  /* 遅番 12:00〜21:00 → 翌日 早番 7:00〜16:00 ＝ 10時間 */
  const s = [W('sT01', '2026-12-08', '12:00', '21:00', 60), W('sT01', '2026-12-09', '07:00', '16:00', 60)];
  const pu = [P('sT01', 'in', '2026-12-08', '12:00'), P('sT01', 'out', '2026-12-08', '21:00'), P('sT01', 'in', '2026-12-09', '07:00'), P('sT01', 'out', '2026-12-09', '16:00')];
  const m = month(s, pu);
  const iv = R.checkPerson(person(m, 'sT01')).intervals;
  t('遅番 21:00 → 翌日 早番 7:00（10時間）は 11時間未満で拾う', iv.length === 1 && iv[0].restMin === 600 && iv[0].date === '2026-12-09' && iv[0].prevDate === '2026-12-08', iv);
  t('設定 intervalH 9 なら拾わない', R.checkPerson(person(m, 'sT01'), { intervalH: 9 }).intervals.length === 0);
  t('設定 intervalH 0 で止まる', R.checkPerson(person(m, 'sT01'), { intervalH: 0 }).intervals.length === 0);
  /* 同じ日の分割勤務 7:00〜9:00・17:00〜21:00 */
  const sp = month([W('sT02', '2026-12-10', '07:00', '09:00', 0), W('sT02', '2026-12-10', '17:00', '21:00', 0, { seq: 1 })],
    [P('sT02', 'in', '2026-12-10', '07:00'), P('sT02', 'out', '2026-12-10', '09:00'), P('sT02', 'in', '2026-12-10', '17:00'), P('sT02', 'out', '2026-12-10', '21:00')]);
  t('同じ日の分割勤務は勤務の間に数えない', R.checkPerson(person(sp, 'sT02')).intervals.length === 0, R.checkPerson(person(sp, 'sT02')));
}

console.log('\n— 3. 続けて働いた日 —');
{
  const mk = (n, start) => {
    const s = [], pu = [];
    for (let i = 0; i < n; i++) { const d = addD(start, i); s.push(W('sT01', d, '07:00', '16:00', 60)); pu.push(P('sT01', 'in', d, '07:00'), P('sT01', 'out', d, '16:00')); }
    return month(s, pu);
  };
  const r6 = R.checkPerson(person(mk(6, '2026-12-01'), 'sT01')).runs;
  t('6日続けては拾わない', r6.length === 0, r6);
  const r7 = R.checkPerson(person(mk(7, '2026-12-01'), 'sT01')).runs;
  t('7日続けては warn', r7.length === 1 && r7[0].days === 7 && r7[0].level === 'warn' && r7[0].from === '2026-12-01' && r7[0].to === '2026-12-07', r7);
  const r13 = R.checkPerson(person(mk(13, '2026-12-01'), 'sT01'));
  t('13日続けては over', r13.runs.length === 1 && r13.runs[0].level === 'over' && r13.over === true, r13.runs);
  /* 夜勤 22:00〜翌 8:00 を1日おき（入り・明け・入り・明け…）＝暦日は毎日かかる */
  const s = [], pu = [];
  for (let i = 0; i < 4; i++) {
    const d = addD('2026-12-01', i * 2);
    s.push({ staff_id: 'sT01', work_date: d, kind: 'night', start_at: iso(d, '22:00'), end_at: iso(addD(d, 1), '08:00'), break_min: 120, paid_min: 0, office: 'facility', symbol: '(22' });
    pu.push(P('sT01', 'in', d, '22:00'), P('sT01', 'out', addD(d, 1), '08:00'));
  }
  const rn = R.checkPerson(person(month(s, pu), 'sT01')).runs;
  t('夜勤の入りと明けが続く8暦日は warn（明けの日も働いた日）', rn.length === 1 && rn[0].days === 8, rn);
  /* 休みで切れる: 5日 → 休み → 5日 */
  const s2 = [], p2 = [];
  [0, 1, 2, 3, 4, 6, 7, 8, 9, 10].forEach((i) => { const d = addD('2026-12-01', i); s2.push(W('sT01', d, '07:00', '16:00', 60)); p2.push(P('sT01', 'in', d, '07:00'), P('sT01', 'out', d, '16:00')); });
  t('休みの日で切れる（5日＋5日は拾わない）', R.checkPerson(person(month(s2, p2), 'sT01')).runs.length === 0);
}

console.log('\n— 4. 数えた時間を変えない・月の集計 —');
{
  const s = [W('sT01', '2026-12-02', '09:00', '14:00', 0), W('sT02', '2026-12-02', '07:00', '16:00', 60)];
  const pu = [P('sT01', 'in', '2026-12-02', '09:00'), P('sT01', 'out', '2026-12-02', '17:00'), P('sT02', 'in', '2026-12-02', '07:00'), P('sT02', 'out', '2026-12-02', '16:00')];
  const days = [{ staff_id: 'sT01', work_date: '2026-12-02', overtime_ok: true, ot_until: iso('2026-12-02', '17:00') }];
  const m = month(s, pu, days), before = JSON.stringify(m);
  const all = R.checkMonth(m);
  t('checkMonth は計算の結果を書き換えない', JSON.stringify(m) === before);
  t('月の集計: 拾った人だけ・件数', Object.keys(all.byStaff).join() === 'sT01' && all.totals.breaks === 1 && all.totals.people === 1, all.totals);
  t('空の月・壊れた入力でも例外を出さない', R.checkMonth(null).totals.people === 0 && R.checkMonth({ people: [{}] }).totals.people === 0);
  t('設定の範囲外は既定に戻す', R.fill({ intervalH: 99, consecWarnDays: 'x', consecOverDays: 1 }).intervalH === 11 && R.fill({}).consecWarnDays === 7 && R.fill({ consecWarnDays: 10, consecOverDays: 8 }).consecOverDays === 10);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
