/* 勤怠管理の管理者のホーム（kintai-monitor.js）の純関数の試験（2026-11-20 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md の段2）
   実行: node check/unit/kintai_monitor_test.js（環境変数 KINTAI_MONITOR で別の版を当てられる）
   守りたいこと:
     1. 箱の順（今日・要確認・36協定・有給・締め・申請）と、入力が null の箱は出さない（申請の箱は null の間は無い）
     2. 今日: 架空の5人の computeMonth（kintai-calc.js で実際に作る）から 出勤予定・出勤済み・まだ出勤していない・勤務中 を塊ごとに数える
        （日ごとの画面のチップと同じ数え方・有休だけの日は数えない・予定の無い打刻は出勤予定に入れない）
     3. 要確認: reviewList の件数と行（氏名は月の名簿から・日付と印の名前）
     4. 36協定（kintai-36.js の判定から）・有給（kintai-leave.js の年5日から）・締め・申請の件数と色
     5. 箱を押した先のタブ
     6. 勤務の決まりの箱（2026-11-20 足した・kintai-rules.js の checkMonth の結果をそのまま渡す）: 人ごとの行・色・注記・押した先は月の一覧
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
  /* 前の日に始まった夜勤（12/14 22:00→12/15 8:00）を 12/15 2:00 に見る（反証レビュー 2026-11-20） */
  const nS = C.buildSchedule({ ym: YM, plan: { cells: { sT03: { 14: '(22', 15: '8)' } }, subCells: {} }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
  const nP = [P('sT03', 'in', '2026-12-14', '21:55')];
  const night = (iso) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: nS, punches: nP, days: [], config: {}, now: Date.parse(iso) });
  const n2 = night('2026-12-15T02:00:00+09:00');
  const nb = n2.people.find((p) => p.staff.staff_id === 'sT03').days.find((d) => d.date === '2026-12-14').blocks[0];
  t('夜勤の材料: 12/14 の塊が 12/15 2:00 に勤務中', nb && nb.working === true, nb && nb.flags);
  const bn = box(Mo.boxes({ today: TODAY, month: n2 }), 'today');
  t('前の日に始まり今も勤務中の夜勤は 勤務中 1・出勤済み 1（出勤予定・まだ出勤していないには入れない）', bn.counts.working === 1 && bn.counts.clockedIn === 1 && bn.counts.scheduled === 0 && bn.counts.notInYet === 0, bn.counts);
  const bn2 = box(Mo.boxes({ today: TODAY, month: night('2026-12-15T08:31:00+09:00') }), 'today');
  t('上がり＋猶予を過ぎた（8:31）前の日の夜勤は数えない', bn2.counts.working === 0 && bn2.counts.clockedIn === 0, bn2.counts);
  t('前の日の夜勤は今日の箱に入るが、前の前の日の塊は入れない（12/16 に見ると 0）', box(Mo.boxes({ today: '2026-12-16', month: n2 }), 'today').counts.working === 0);
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
  /* 平均の窓（7〜11月）は0の記録で埋める（記録の無い月の警告を混ぜず、箱のまとめ方だけを見る） */
  const j = (legal) => A.judge(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((ym) => ({ ym, legalOverMin: 0, holidayMin: 0, locked: true })).concat([{ ym: YM, legalOverMin: legal, holidayMin: 0, locked: false, partial: false }]), YM, BASE, { holidayKnown: true });
  const rows36 = [['sT01', 46 * 60], ['sT02', 36 * 60], ['sT03', 0], ['sT04', 0], ['sT05', 10 * 60]].map(([id, m]) => ({ staff_id: id, name: NAMES[IDS.indexOf(id)], items: j(m).items }));
  const b = box(Mo.boxes({ a36Rows: rows36 }), 'a36');
  t('36協定: 警告・超過の人 2（甲 over・乙 warn）・超過がいるので alert', b.count === 2 && b.level === 'alert' && b.rows[0].staff_id === 'sT01' && b.rows[1].staff_id === 'sT02', b);
  t('36協定: 行の文は判定の文', b.rows[0].text === '法定外が今月 46時間で、36協定の月の上限 45時間を超えています' && b.rows[1].text === '法定外の時間が月36時間以上です（36協定の確認）', b.rows);
  const hu = box(Mo.boxes({ a36Rows: [{ staff_id: 'sT03', name: '試験 丙', items: [], holidayUnknown: true }, { staff_id: 'sT04', name: '試験 丁', items: [], holidayUnknown: false }] }), 'a36');
  t('36協定: 判定が holidayUnknown の人がいれば、件数0でも箱を出し warn・注意の1行', hu.count === 0 && hu.level === 'warn' && hu.note === '法定休日を決めていないため、休日労働を含む上限は少なく出ています' && hu.rows.length === 0, hu);
  const hu2 = box(Mo.boxes({ a36Rows: rows36.concat([{ staff_id: 'sT05', name: '試験 戊', items: [], holidayUnknown: true }]) }), 'a36');
  t('36協定: 超過がいる時は alert のまま・注意も出す', hu2.level === 'alert' && !!hu2.note && hu2.count === 2);
  t('36協定: holidayUnknown が誰にも無ければ注意なし', box(Mo.boxes({ a36Rows: rows36 }), 'a36').note === undefined);
  const real = A.judge([{ ym: YM, legalOverMin: 0, holidayMin: 0 }], YM, {}, {});
  t('36協定: kintai-36.js の判定（法定休日を決めていない設定）をそのまま渡すと注意が出る', box(Mo.boxes({ a36Rows: [{ staff_id: 'sT01', name: '試験 甲', items: [], holidayUnknown: real.holidayUnknown }] }), 'a36').note !== undefined && real.holidayUnknown === true);
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


console.log('\n— 6. 勤務の決まりの箱（kintai-rules.js）—');
{
  const R = require(path.join(ROOT, 'kintai-rules.js'));
  /* 甲: 12/1 遅番（12-21）の翌日 12/2 早番（7-16）＝勤務の間10時間・12/3 は休憩0分で9時間／乙: 12/1〜12/7 の7日続けて早番／丙: 何も無し */
  const c6 = { sT01: { 1: '遅', 2: '早', 3: '早' }, sT02: { 1: '早', 2: '早', 3: '早', 4: '早', 5: '早', 6: '早', 7: '早' }, sT03: {} };
  const s6 = C.buildSchedule({ ym: YM, plan: { cells: c6, subCells: {} }, nextPlan: {}, staff: STAFF.slice(0, 3), symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
  const p6 = [P('sT01', 'in', '2026-12-01', '12:00'), P('sT01', 'out', '2026-12-01', '21:00'), P('sT01', 'in', '2026-12-02', '7:00'), P('sT01', 'out', '2026-12-02', '16:00'), P('sT01', 'in', '2026-12-03', '7:00'), P('sT01', 'out', '2026-12-03', '16:00')];
  for (let d = 1; d <= 7; d++) p6.push(P('sT02', 'in', '2026-12-0' + d, '7:00'), P('sT02', 'out', '2026-12-0' + d, '16:00'));
  const m6 = C.computeMonth({ ym: YM, staff: K_STAFF.slice(0, 3), schedule: s6, punches: p6, days: [{ staff_id: 'sT01', work_date: '2026-12-03', break_min: 0, rev: 1 }], config: {}, now: NOW });
  const res = R.checkMonth(m6, {});
  const rb = box(Mo.boxes({ month: m6, rules: res }), 'rules');
  t('勤務の決まり: 甲と乙の2人・月の名簿の順・押した先は月の一覧（grid）', rb.count === 2 && rb.rows.map((r) => r.staff_id).join() === 'sT01,sT02' && rb.tab === 'grid' && rb.title === '勤務の決まり', rb);
  t('勤務の決まり: 甲は「休憩が足りない日 1 件／勤務の間が短い日 1 件」・乙は「続けて 7 日働いています（12/1〜12/7）」', rb.rows[0].text === '休憩が足りない日 1 件／勤務の間が短い日 1 件' && rb.rows[1].text === '続けて 7 日働いています（12/1〜12/7）' && rb.rows[0].name === '試験 甲', rb.rows);
  t('勤務の決まり: 7日（目安の warn）だけなら warn・注記あり', rb.level === 'warn' && rb.rows.every((r) => r.level === 'warn') && typeof rb.note === 'string');
  const over = box(Mo.boxes({ month: m6, rules: R.checkMonth(m6, { consecWarnDays: 3, consecOverDays: 5 }) }), 'rules');
  t('勤務の決まり: 続けて働いた日が上の目安（over）の人がいれば alert', over.level === 'alert' && over.rows.find((r) => r.staff_id === 'sT02').level === 'alert', over);
  const none = box(Mo.boxes({ month: m6, rules: { byStaff: {}, totals: {} } }), 'rules');
  t('勤務の決まり: 誰もいなければ 0 件・ok・注記なし', none.count === 0 && none.level === 'ok' && none.note === undefined);
  const all2 = Mo.boxes({ today: TODAY, month, reviewList: review, leaveRows: [], a36Rows: [], unlockedPast: [], rules: { byStaff: {} }, requests: null });
  t('順は 今日・要確認・36協定・有給・締め・勤務の決まり（申請は null で出さない）', all2.map((b) => b.key).join(',') === 'today,review,a36,leave,close,rules', all2.map((b) => b.key));
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
