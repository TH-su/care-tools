/* 勤怠管理の管理者のホーム（kintai-monitor.js）の純関数の試験（2026-11-20 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md の段2）
   実行: node check/unit/kintai_monitor_test.js（環境変数 KINTAI_MONITOR で別の版を当てられる）
   守りたいこと:
     1. 箱の順（今日・要確認・36協定・有給・締め・申請）と、入力が null の箱は出さない（申請の箱は null の間は無い）
     2. 今日: 架空の5人の computeMonth（kintai-calc.js で実際に作る）から 出勤予定・出勤済み・まだ出勤していない・勤務中 を塊ごとに数える
        （日ごとの画面のチップと同じ数え方・有休だけの日は数えない・予定の無い打刻は出勤予定に入れない）
     3. 要確認: reviewList の件数と行（氏名は月の名簿から・日付と印の名前）
     4. 36協定（kintai-36.js の判定から）・有給（kintai-leave.js の年5日から）・締め・申請の件数と色
     5. 箱を押した先のタブ
   ★職員は架空（試験 甲〜戊）。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Mo = require(process.env.KINTAI_MONITOR || path.join(ROOT, 'kintai-monitor.js'));
const C = require(path.join(ROOT, 'kintai-calc.js'));
const A = require(path.join(ROOT, 'kintai-36.js'));
const L = require(path.join(ROOT, 'kintai-leave.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const YM = '2026-12', TODAY = '2026-12-15';
const NOW = Date.parse('2026-12-15T10:00:00+09:00');
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() });
const IDS = ['sT01', 'sT02', 'sT03', 'sT04', 'sT05'], NAMES = ['試験 甲', '試験 乙', '試験 丙', '試験 丁', '試験 戊'];
const STAFF = IDS.map((id, i) => ({ id, name: NAMES[i], mainDivision: '施設', empCode: '900' + (i + 1), employment: '正社員', active: true }));
const K_STAFF = IDS.map((id, i) => ({ staff_id: id, name: NAMES[i], office: 'facility', emp_code: '900' + (i + 1) }));
/* 甲: 早番で 7:00 に出勤（勤務中）・10日は退勤漏れ／乙: 早番で打刻なし（まだ出勤していない）・14日は打刻なし／
   丙: 早番で 7:00〜9:00（退勤済み・早退）／丁: 有休（塊なし）／戊: 予定なしで 8:00 に出勤（勤務中） */
const cells = { sT01: { 10: '早', 15: '早' }, sT02: { 14: '早', 15: '早' }, sT03: { 15: '早' }, sT04: { 15: '有' }, sT05: {} };
const sched = C.buildSchedule({ ym: YM, plan: { cells, subCells: {} }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
const punches = [P('sT01', 'in', '2026-12-10', '7:00'), P('sT01', 'in', TODAY, '7:00'), P('sT03', 'in', TODAY, '7:00'), P('sT03', 'out', TODAY, '9:00'), P('sT05', 'in', TODAY, '8:00')];
const month = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches, days: [], config: {}, now: NOW });
const review = C.reviewList(month);
const box = (list, key) => list.find((b) => b.key === key);

console.log('\n— 1. 箱の順と null の箱 —');
{
  const all = Mo.boxes({ today: TODAY, month, reviewList: review, leaveRows: [], a36Rows: [], unlockedPast: [], requests: 0 });
  t('順は 今日・要確認・36協定・有給・締め・申請', all.map((b) => b.key).join(',') === 'today,review,a36,leave,close,requests', all.map((b) => b.key));
  t('押した先のタブ day・review・grid・leave・close・requests', all.map((b) => b.tab).join(',') === 'day,review,grid,leave,close,requests', all.map((b) => b.tab));
  t('どの箱も key・title・count・level・tab・rows を持つ', all.every((b) => typeof b.key === 'string' && typeof b.title === 'string' && typeof b.count === 'number' && /^(ok|warn|alert)$/.test(b.level) && Array.isArray(b.rows)));
  const noReq = Mo.boxes({ today: TODAY, month, reviewList: review, leaveRows: null, a36Rows: null, unlockedPast: null, requests: null });
  t('null の入力の箱は出さない（申請・有給・36協定・締め）', noReq.map((b) => b.key).join(',') === 'today,review', noReq.map((b) => b.key));
  t('申請が 0 件の時は箱を出し ok', box(all, 'requests').count === 0 && box(all, 'requests').level === 'ok');
  t('入力が空・null でも例外を出さず箱なし', Mo.boxes({}).length === 0 && Mo.boxes(null).length === 0);
}

console.log('\n— 2. 今日（架空の5人の computeMonth） —');
{
  const b = box(Mo.boxes({ today: TODAY, month }), 'today');
  t('出勤予定 3（甲・乙・丙。有休の丁・予定なしの戊は入れない）', b.counts.scheduled === 3, b.counts);
  t('出勤済み 3（甲・丙・戊）', b.counts.clockedIn === 3, b.counts);
  t('まだ出勤していない 1（乙）＝箱の件数・warn', b.counts.notInYet === 1 && b.count === 1 && b.level === 'warn', b);
  t('勤務中 2（甲・戊）', b.counts.working === 2, b.counts);
  t('行はまだ出勤していない人（氏名と予定の開始）', b.rows.length === 1 && b.rows[0].staff_id === 'sT02' && b.rows[0].name === '試験 乙' && b.rows[0].text === 'まだ出勤していません（予定 7:00〜）', b.rows);
  /* 日ごとの画面（kintai.js の kindsOf）と同じ数え方: 塊ごとに working・not_in_yet */
  let wk = 0, ni = 0;
  month.people.forEach((p) => (p.days.find((d) => d.date === TODAY) || { blocks: [] }).blocks.forEach((x) => { if (x.working) wk++; if (x.flags.indexOf('not_in_yet') >= 0) ni++; }));
  t('日ごとの画面のチップ（出勤中・まだ出勤していない）と同じ数', wk === b.counts.working && ni === b.counts.notInYet, [wk, ni]);
  const later = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: punches.concat([P('sT02', 'in', TODAY, '10:30')]), days: [], config: {}, now: Date.parse('2026-12-15T11:00:00+09:00') });
  const b2 = box(Mo.boxes({ today: TODAY, month: later }), 'today');
  t('乙が出勤したら まだ出勤していない 0・ok・出勤済み 4・勤務中 3', b2.counts.notInYet === 0 && b2.level === 'ok' && b2.counts.clockedIn === 4 && b2.counts.working === 3, b2.counts);
  const ab = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches, days: [{ staff_id: 'sT02', work_date: TODAY, day_mark: 'absent' }], config: {}, now: NOW });
  t('欠勤にした塊は まだ出勤していない に入れない', box(Mo.boxes({ today: TODAY, month: ab }), 'today').counts.notInYet === 0);
  const out = box(Mo.boxes({ today: '2027-02-01', month }), 'today');
  t('今日が月分の期間の外なら全部 0（仮置き）', out.counts.scheduled === 0 && out.counts.clockedIn === 0 && out.count === 0 && out.level === 'ok', out.counts);
}

console.log('\n— 3. 打刻漏れ・要確認 —');
{
  const b = box(Mo.boxes({ today: TODAY, month, reviewList: review }), 'review');
  t('件数は reviewList と同じ（甲 12/10 の退勤漏れ・乙 12/14 の打刻なし）・warn', b.count === review.length && review.length === 2 && b.level === 'warn', review);
  t('行は日付順・氏名は月の名簿から・印の名前', b.rows[0].staff_id === 'sT01' && b.rows[0].name === '試験 甲' && b.rows[0].text === '12/10 退勤の打刻がありません' &&
    b.rows[1].staff_id === 'sT02' && b.rows[1].text === '12/14 打刻がありません（欠勤か打刻漏れ）', b.rows);
  const z = box(Mo.boxes({ reviewList: [] }), 'review');
  t('要確認が 0 件なら ok', z.count === 0 && z.level === 'ok');
}

console.log('\n— 4. 36協定・有給・締め・申請 —');
{
  const BASE = { legal_holiday: 0, agreement36: { monthWarnH: 36 } };
  const j = (legal) => A.judge([{ ym: YM, legalOverMin: legal, holidayMin: 0, locked: false, partial: false }], YM, BASE, { holidayKnown: true });
  const rows36 = [['sT01', 46 * 60], ['sT02', 36 * 60], ['sT03', 0], ['sT04', 0], ['sT05', 10 * 60]].map(([id, m]) => ({ staff_id: id, name: NAMES[IDS.indexOf(id)], items: j(m).items }));
  const b = box(Mo.boxes({ a36Rows: rows36 }), 'a36');
  t('36協定: 警告・超過の人 2（甲 over・乙 warn）・超過がいるので alert', b.count === 2 && b.level === 'alert' && b.rows[0].staff_id === 'sT01' && b.rows[1].staff_id === 'sT02', b);
  t('36協定: 行の文は判定の文', b.rows[0].text === '法定外が今月 46時間で、36協定の月の上限 45時間を超えています' && b.rows[1].text === '法定外の時間が月36時間以上です（36協定の確認）', b.rows);
  t('36協定: 警告だけなら warn・誰もいなければ ok', box(Mo.boxes({ a36Rows: rows36.slice(1) }), 'a36').level === 'warn' && box(Mo.boxes({ a36Rows: rows36.slice(2) }), 'a36').level === 'ok');

  /* 有給: kintai-leave.js の年5日の判定で黄・赤を作る（付与 2026-04-01 に10日・期間の終わり 2027-03-31） */
  const g = [{ grant_date: '2026-04-01', days: 10, kind: 'auto' }];
  const red = L.obligation5(g, [{ use_date: '2026-06-01', days: 2 }], '2027-02-15');
  const yel = L.obligation5(g, [], '2026-12-15');
  const ok = L.obligation5(g, [1, 2, 3, 4, 5].map((d) => ({ use_date: '2026-06-0' + d, days: 1 })), '2026-12-15');
  t('有給の材料: 赤・黄・届いた', red.state === 'red' && yel.state === 'yellow' && ok.state === 'ok', [red.state, yel.state, ok.state]);
  const lv = [
    { staff_id: 'sT01', name: '試験 甲', ob: red, expiringDays: 0 },
    { staff_id: 'sT02', name: '試験 乙', ob: yel, expiringDays: 0 },
    { staff_id: 'sT03', name: '試験 丙', ob: ok, expiringDays: 2 },
    { staff_id: 'sT04', name: '試験 丁', ob: ok, expiringDays: 0 },
    { staff_id: 'sT05', name: '試験 戊', ob: { state: 'none' }, expiringDays: null }
  ];
  const lb = box(Mo.boxes({ leaveRows: lv }), 'leave');
  t('有給: 赤・黄・期限の近い残りの人 3・赤がいるので alert', lb.count === 3 && lb.level === 'alert' && lb.rows.map((r) => r.staff_id).join() === 'sT01,sT02,sT03', lb);
  t('有給: 文（あと何日・いつまで／期限の近い残り）', lb.rows[0].text === '年5日に届いていません（あと 3 日・2027年3/31 まで）' && lb.rows[2].text === '期限の近い残り 2 日', lb.rows);
  t('有給: ob.level でも読む（level:red）', box(Mo.boxes({ leaveRows: [{ staff_id: 'x', name: '試験 甲', ob: { level: 'red' } }] }), 'leave').level === 'alert');
  t('有給: 黄だけなら warn・誰もいなければ ok', box(Mo.boxes({ leaveRows: lv.slice(1) }), 'leave').level === 'warn' && box(Mo.boxes({ leaveRows: lv.slice(3) }), 'leave').level === 'ok');

  const cb = box(Mo.boxes({ unlockedPast: ['2026-11', '2026-10', '2026-11', 'x'] }), 'close');
  t('締め: 締めていない過去の月分 2（重なりと形の違う値は数えない）・alert・古い順', cb.count === 2 && cb.level === 'alert' && cb.rows[0].text === '2026年10月分が締まっていません' && cb.rows[1].text === '2026年11月分が締まっていません', cb);
  t('締め: 0 件なら ok', box(Mo.boxes({ unlockedPast: [] }), 'close').level === 'ok');
  const rb = box(Mo.boxes({ requests: 3 }), 'requests');
  t('申請: 3 件・warn・行なし', rb.count === 3 && rb.level === 'warn' && rb.rows.length === 0 && rb.tab === 'requests');
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
