/* 勤怠管理のホームの「今日の出勤状況」（kintai-today.js）の純関数の試験（2026-11-27 新設・代表者の決定 2026-11-27）
   実行: node check/unit/kintai_today_test.js（環境変数 KINTAI_TODAY で別の版を当てられる）
   守りたいこと:
     1. 人数と行の数の一致: 事業所が「全部」の時、ホームの「今日」の箱（kintai-monitor.js）の人数と、行の数（予定のある行・打刻のある行・遅れの行・勤務中の行）が合う。
        状態ごとの行の数の合計が行の数と合う（どの塊も必ず1つの状態に入る）
     2. 並び順: 遅れ → 打刻なし → まだ → 勤務中 → 退勤の打刻なし → 退勤済み → 欠勤、その中は予定の開始の順
     3. 遅れの判定の境目: 予定の開始＋15分ちょうどは「まだ」、それを過ぎたら「遅れ」（箱の「まだ出勤していない」と同じ）
     4. 日付をまたぐ夜勤: 前の日に始まって今も勤務中の塊は「勤務中」の行（前の日から・予定は翌の時刻）。今日の夜勤の予定は「翌」
     5. 事業所の絞り込み: 塊の事業所で絞る・事業所ごとの行の合計が全部と合う・絞った時の人数も行から数える
     6. 0人の日・入力が崩れていても例外を出さない
     7. 画面の読み込み（kintai.html が kintai-calc.js の後・kintai.js の前に読む・公開の許可）
   ★職員は架空（試験 甲〜庚）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const T = require(process.env.KINTAI_TODAY || path.join(ROOT, 'kintai-today.js'));
const Mo = require(path.join(ROOT, 'kintai-monitor.js'));
const C = require(path.join(ROOT, 'kintai-calc.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

const YM = '2026-12', TODAY = '2026-12-15';
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() });
const IDS = ['sT01', 'sT02', 'sT03', 'sT04', 'sT05', 'sT06', 'sT07'], NAMES = ['試験 甲', '試験 乙', '試験 丙', '試験 丁', '試験 戊', '試験 己', '試験 庚'];
const DIV = ['施設', '施設', '施設', '施設', '施設', '訪問', '施設'], OFF = ['facility', 'facility', 'facility', 'facility', 'facility', 'visit', 'facility'];
const STAFF = IDS.map((id, i) => ({ id, name: NAMES[i], mainDivision: DIV[i], empCode: '900' + (i + 1), employment: '正社員', active: true }));
const K_STAFF = IDS.map((id, i) => ({ staff_id: id, name: NAMES[i], office: OFF[i], emp_code: '900' + (i + 1) }));
const SET = { breakThresholdH: 6, breakH: 1, nightBreakH: 2 };
const sch = (cells) => C.buildSchedule({ ym: YM, plan: { cells, subCells: {} }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: SET }).rows;
const month = (cells, punches, nowIso, days) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sch(cells), punches, days: days || [], config: {}, now: Date.parse(nowIso) });
const boxOf = (m, d) => Mo.boxes({ today: d || TODAY, month: m }).find((b) => b.key === 'today');
/* 箱の人数と行の数が合うか（事業所が全部の時） */
function agrees(name, m, d) {
  const bx = boxOf(m, d).counts, r = T.board(m, d || TODAY, '');
  const sc = r.rows.filter((x) => x.scheduled && !x.prevDay).length, ci = r.rows.filter((x) => x.punched).length;
  const ni = r.rows.filter((x) => x.status === 'late').length, wk = r.rows.filter((x) => x.status === 'working').length;
  const sum = Object.keys(r.tally).reduce((a, k) => a + r.tally[k], 0);
  t(name + ': 箱の人数と行の数が合う（出勤予定・出勤済み・まだ出勤していない＝遅れ・勤務中）', bx.scheduled === sc && bx.clockedIn === ci && bx.notInYet === ni && bx.working === wk, { box: bx, rows: { sc, ci, ni, wk } });
  t(name + ': 返す人数（counts）も箱と同じ・状態ごとの数の合計＝行の数＝total', JSON.stringify(r.counts) === JSON.stringify(bx) && sum === r.rows.length && r.total === r.rows.length, { counts: r.counts, box: bx, sum, n: r.rows.length });
  return r;
}

/* 架空の今日（12/15 10:00）:
   甲: 早番 7:00〜 に 6:58 出勤（勤務中）／乙: 早番で打刻なし（遅れ）／丙: 早番 7:00〜9:00 打刻（退勤済み）／丁: 有休（塊なし＝出さない）／
   戊: 予定なしで 8:00 出勤（勤務中・予定なし）／己（訪問）: 日勤3 9:00〜 に打刻なし（9:15 を過ぎたので遅れ）／庚: 遅番 で打刻なし（まだ） */
const CELLS = { sT01: { 15: '早' }, sT02: { 15: '早' }, sT03: { 15: '早' }, sT04: { 15: '有' }, sT05: {}, sT06: { 15: '日3' }, sT07: { 15: '遅' } };
const PUN = [P('sT01', 'in', TODAY, '6:58'), P('sT03', 'in', TODAY, '7:00'), P('sT03', 'out', TODAY, '9:00'), P('sT05', 'in', TODAY, '8:00')];
const M1 = month(CELLS, PUN, '2026-12-15T10:00:00+09:00');

console.log('\n— 1. 人数と行の数の一致 —');
const R1 = agrees('架空の7人（10:00）', M1);
{
  t('有休だけの丁は行に出さない（箱でも数えない）', !R1.rows.some((r) => r.staff_id === 'sT04'), R1.rows.map((r) => r.staff_id));
  const by = {}; R1.rows.forEach((r) => { by[r.staff_id] = r; });
  t('甲は勤務中・出勤 6:58・退勤なし', by.sT01 && by.sT01.status === 'working' && by.sT01.inAt === at(TODAY, '6:58') && by.sT01.outAt === null, by.sT01);
  t('乙は遅れ（札にする）', by.sT02 && by.sT02.status === 'late' && by.sT02.label === '遅れ' && by.sT02.unusual === true, by.sT02);
  t('丙は退勤済み・出勤 7:00・退勤 9:00（札にしない）', by.sT03 && by.sT03.status === 'done' && by.sT03.inAt === at(TODAY, '7:00') && by.sT03.outAt === at(TODAY, '9:00') && by.sT03.unusual === false, by.sT03);
  t('戊は予定なしの勤務中（予定の時刻なし）', by.sT05 && by.sT05.status === 'working' && by.sT05.scheduled === false && by.sT05.schedStart === null, by.sT05);
  t('要確認の札（review）は kintai-calc.js の needsReview と同じ（勤務中の予定なしは退勤までは要確認にしない）', R1.rows.every((r) => { const p = M1.people.find((x) => x.staff.staff_id === r.staff_id), b = p.days.find((d) => d.date === r.date).blocks[r.blockIndex]; return r.review === C.needsReview(b); }));
  t('庚は まだ（札にしない）', by.sT07 && by.sT07.status === 'before' && by.sT07.label === 'まだ' && by.sT07.unusual === false, by.sT07);
  t('名前は勤怠の表示名（display_name）があればそれを使う', T.board(C.computeMonth({ ym: YM, staff: K_STAFF.map((s) => Object.assign({}, s, s.staff_id === 'sT02' ? { display_name: '表示 乙' } : {})), schedule: sch(CELLS), punches: PUN, days: [], config: {}, now: Date.parse('2026-12-15T10:00:00+09:00') }), TODAY, '').rows.find((r) => r.staff_id === 'sT02').name === '表示 乙');
  /* 欠勤・予定の終わりを過ぎて打刻なし・退勤の打刻なし も、どれかの状態に入る */
  const M2 = month({ sT01: { 15: '早' }, sT02: { 15: '早' }, sT03: { 15: '早' } }, [P('sT01', 'in', TODAY, '7:00')], '2026-12-15T23:00:00+09:00', [{ staff_id: 'sT03', work_date: TODAY, day_mark: 'absent' }]);
  const R2 = agrees('夜 23:00（打刻なし・退勤の打刻なし・欠勤）', M2);
  const s2 = {}; R2.rows.forEach((r) => { s2[r.staff_id] = r.status; });
  t('終わりを過ぎて打刻なしは「打刻なし」・出勤だけで終わりを過ぎたら「退勤の打刻なし」・欠勤の印は「欠勤」', s2.sT02 === 'nopunch' && s2.sT01 === 'noout' && s2.sT03 === 'absent', s2);
  t('打刻なし・退勤の打刻なしは札（要確認）・欠勤は札にしない', R2.rows.find((r) => r.staff_id === 'sT02').unusual && R2.rows.find((r) => r.staff_id === 'sT01').unusual && !R2.rows.find((r) => r.staff_id === 'sT03').unusual);
  t('欠勤の行は箱の「まだ出勤していない」に入らない（遅れにしない）', boxOf(M2).counts.notInYet === 0 && R2.tally.late === 0);
  /* 1日の特別休暇の日（予定はあるが打刻なし）: 箱では出勤予定に数え、打刻なし・まだ出勤していないにしない → 行は「休み」（札なし・行は消さない） */
  const SPC = [{ id: 'a1', staff_id: 'sT02', date: TODAY, kind: 'special', minutes: null, paid: true, type_code: null, link_date: null, note: '', created_at: '2026-12-01T10:00:00+09:00' }];
  const M4 = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sch({ sT02: { 15: '早' } }), punches: [], days: [], absences: SPC, config: {}, now: Date.parse('2026-12-15T23:00:00+09:00') });
  const R4 = agrees('1日の特別休暇の日（23:00）', M4);
  t('特別休暇の日の予定の塊は「休み」（まだ・打刻なしにしない・札にしない）', R4.rows.length === 1 && R4.rows[0].status === 'leave' && R4.rows[0].label === '休み' && R4.rows[0].unusual === false, R4.rows);
  /* 確認済み（事務所が確認済みにした）の塊は、打刻なし・退勤の打刻なしでも札にしない */
  const M5 = month({ sT01: { 15: '早' }, sT02: { 15: '早' } }, [P('sT01', 'in', TODAY, '7:00')], '2026-12-15T23:00:00+09:00', [{ staff_id: 'sT01', work_date: TODAY, day_mark: 'checked' }, { staff_id: 'sT02', work_date: TODAY, day_mark: 'checked' }]);
  const R5 = agrees('確認済みの日（23:00）', M5);
  t('確認済みの塊は 打刻なし・退勤の打刻なし のままでも札にしない・要確認にもしない', R5.rows.length === 2 && R5.rows.every((r) => !r.unusual && !r.review), R5.rows.map((r) => [r.status, r.unusual, r.review]));
  /* 分けた勤務で前の組は退勤済み・後の組は退勤の打刻なし: 退勤の時刻は出さない */
  const M6 = month({ sT01: { 15: '早' } }, [P('sT01', 'in', TODAY, '7:00'), P('sT01', 'out', TODAY, '11:00'), P('sT01', 'in', TODAY, '12:00')], '2026-12-15T23:00:00+09:00');
  const r6 = T.board(M6, TODAY, '').rows[0];
  t('退勤の打刻なしの行には、前の組の退勤の時刻を出さない', r6 && r6.status === 'noout' && r6.outAt === null && r6.inAt === at(TODAY, '7:00'), r6);
}

console.log('\n— 2. 並び順 —');
{
  const order = R1.rows.map((r) => r.status);
  const rank = order.map((s) => T.ORDER.indexOf(s));
  t('遅れ → まだ → 勤務中 → 退勤済み の順（状態の順に並ぶ）', rank.every((v, i) => i === 0 || rank[i - 1] <= v), order);
  t('先頭は遅れ・最後は退勤済み', order[0] === 'late' && order[order.length - 1] === 'done', order);
  const late = R1.rows.filter((r) => r.status === 'late').map((r) => r.staff_id);
  t('遅れの中は予定の開始の順（乙 7:00 → 己 9:00）', late.join(',') === 'sT02,sT06', late);
  const wk = R1.rows.filter((r) => r.status === 'working').map((r) => r.staff_id);
  t('勤務中の中も予定の開始の順・予定なしは最初の打刻で並べる（甲 予定7:00 → 戊 打刻8:00）', wk.join(',') === 'sT01,sT05', wk);
  t('ORDER の並びは 遅れ・打刻なし・まだ・勤務中・退勤の打刻なし・退勤済み・休み・欠勤', T.ORDER.join(',') === 'late,nopunch,before,working,noout,done,leave,absent', T.ORDER);
}

console.log('\n— 2b. 同じ人の行は隣り合わせ（反証レビュー 2026-11-27） —');
{
  const adjacent = (rows) => { const seen = {}; let prev = null; for (const r of rows) { if (r.staff_id !== prev && seen[r.staff_id]) return false; seen[r.staff_id] = 1; prev = r.staff_id; } return true; };
  const contOk = (rows) => rows.every((r, i) => r.cont === (i > 0 && rows[i - 1].staff_id === r.staff_id));
  /* 遅番 12:00〜 の乙が 8:00 に早く来た（12:30 に見る）: 予定の塊は遅れ・早く来た分は予定なしの勤務中の塊。ほかの人の行を間に挟まない */
  const cE = { sT01: { 15: '早' }, sT02: { 15: '遅' }, sT03: { 15: '日3' }, sT07: { 15: '日1' } };
  const pE = [P('sT01', 'in', TODAY, '6:58'), P('sT02', 'in', TODAY, '8:00'), P('sT07', 'in', TODAY, '7:55')];
  const mE = month(cE, pE, '2026-12-15T12:30:00+09:00');
  const rE = agrees('遅番の前に早く来た人（12:30）', mE);
  const iL = rE.rows.findIndex((r) => r.staff_id === 'sT02' && r.status === 'late');
  t('早く来た乙は「遅れ」の行のすぐ下に、乙の「勤務中」の行が並ぶ（続きの行の印）', iL >= 0 && rE.rows[iL + 1] && rE.rows[iL + 1].staff_id === 'sT02' && rE.rows[iL + 1].status === 'working' && rE.rows[iL + 1].cont === true, rE.rows.map((r) => [r.staff_id, r.status, r.cont]));
  t('同じ人の行は離れない・2行目から cont', adjacent(rE.rows) && contOk(rE.rows), rE.rows.map((r) => [r.staff_id, r.status, r.cont]));
  t('その人のいちばん急ぐ行（遅れ）の位置にまとめる（乙のまとまりは遅れの並び＝勤務中の甲・戊より前・頭は cont なし）', iL >= 0 && rE.rows[iL].cont === false && rE.rows.slice(0, iL).every((r) => r.status === 'late') && rE.rows.findIndex((r) => r.staff_id === 'sT01') > iL + 1, rE.rows.map((r) => [r.staff_id, r.status, r.cont]));
  /* 分けた勤務（甲の予定が 8:00〜11:00 と 17:00〜21:00 の2つ・18:00 に見る）: 前の塊は退勤済み・後の塊は勤務中。
     状態の順だけで並べると、甲の2行の間に庚（早番 7:00〜 の退勤済み）が入る */
  const SR = (sid, s1, e1, seq, sym) => ({ kind: 'work', start_at: TODAY + 'T' + s1 + ':00+09:00', end_at: TODAY + 'T' + e1 + ':00+09:00', break_min: 0, paid_min: 0, staff_id: sid, work_date: TODAY, seq, office: 'facility', symbol: sym });
  const schS = [SR('sT01', '08:00', '11:00', 1, '分1'), SR('sT01', '17:00', '21:00', 2, '分2'), SR('sT07', '07:00', '16:00', 1, '早'), SR('sT03', '09:00', '18:00', 1, '日3')];
  const pS = [P('sT01', 'in', TODAY, '7:58'), P('sT01', 'out', TODAY, '11:00'), P('sT01', 'in', TODAY, '16:58'), P('sT07', 'in', TODAY, '6:58'), P('sT07', 'out', TODAY, '16:00'), P('sT03', 'in', TODAY, '8:55')];
  const mS = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: schS, punches: pS, days: [], config: {}, now: Date.parse('2026-12-15T16:59:00+09:00') });
  const rS = agrees('分けた勤務（16:59）', mS);
  const s01 = rS.rows.filter((r) => r.staff_id === 'sT01');
  t('（材料）甲は2行（勤務中と退勤済み）', s01.length === 2 && s01.some((r) => r.status === 'working') && s01.some((r) => r.status === 'done'), rS.rows.map((r) => [r.staff_id, r.status]));
  t('分けた勤務の人の2行は隣り合わせ（勤務中の位置にまとめ、退勤済みの行が続く）', adjacent(rS.rows) && contOk(rS.rows) && s01[0].status === 'working' && s01[1].cont === true, rS.rows.map((r) => [r.staff_id, r.status, r.cont]));
  t('1人1行の日は cont がどれも false', R1.rows.every((r) => r.cont === false));
}

console.log('\n— 3. 遅れの判定の境目（予定の開始＋15分） —');
{
  const c = { sT02: { 15: '早' } };
  const st = (iso) => { const m = month(c, [], iso), r = T.board(m, TODAY, '').rows[0]; return { s: r && r.status, box: boxOf(m).counts.notInYet }; };
  const a = st('2026-12-15T06:59:00+09:00'), b = st('2026-12-15T07:15:00+09:00'), d = st('2026-12-15T07:15:01+09:00'), e = st('2026-12-15T07:16:00+09:00');
  t('開始の前（6:59）は まだ', a.s === 'before' && a.box === 0, a);
  t('開始＋15分ちょうど（7:15:00）は まだ（箱も 0）', b.s === 'before' && b.box === 0, b);
  t('開始＋15分を過ぎた（7:15:01）は 遅れ（箱も 1）', d.s === 'late' && d.box === 1, d);
  t('7:16 は 遅れ', e.s === 'late' && e.box === 1, e);
  const m = month(c, [P('sT02', 'in', TODAY, '7:20')], '2026-12-15T07:30:00+09:00');
  t('遅れて出勤したら 勤務中（遅れの行から外れる）', T.board(m, TODAY, '').rows[0].status === 'working' && boxOf(m).counts.notInYet === 0);
}

console.log('\n— 4. 日付をまたぐ夜勤 —');
{
  /* 丙: 12/14 22:00 →12/15 8:00 の夜勤（21:55 に出勤）。己（訪問）: 12/15 の夜勤 (22 → 12/16 8) */
  const c = { sT03: { 14: '(22', 15: '8)' }, sT06: { 15: '(22', 16: '8)' } };
  const nP = [P('sT03', 'in', '2026-12-14', '21:55')];
  const m = month(c, nP, '2026-12-15T02:00:00+09:00');
  const r = agrees('夜勤（12/15 2:00）', m);
  const n = r.rows.find((x) => x.staff_id === 'sT03');
  t('前の日に始まった夜勤は 勤務中の行・前の日から・塊の日は 12/14', n && n.status === 'working' && n.prevDay === true && n.date === '2026-12-14', n);
  t('その行の予定は 22:00〜翌8:00（終わりが次の日＝nextDay）', n && n.schedStart === at('2026-12-14', '22:00') && n.schedEnd === at(TODAY, '8:00') && n.nextDay === true, n);
  t('その行は出勤予定に数えない（前の日の予定）が出勤済みには数える', r.counts.scheduled === 1 && r.counts.clockedIn === 1 && r.counts.working === 1, r.counts);
  const g = r.rows.find((x) => x.staff_id === 'sT06');
  t('今日の夜勤の予定（22:00〜翌8:00）は まだ・翌', g && g.status === 'before' && g.nextDay === true && g.prevDay === false, g);
  const late = month(c, nP, '2026-12-15T08:31:00+09:00');
  agrees('夜勤の上がり＋猶予を過ぎた（8:31）', late);
  t('上がり＋猶予を過ぎた前の日の夜勤は行に出さない（箱でも数えない）', !T.board(late, TODAY, '').rows.some((x) => x.staff_id === 'sT03'));
  t('前の前の日の塊は出さない（12/16 に見ると 12/14 の夜勤は無い）', !T.board(m, '2026-12-16', '').rows.some((x) => x.date === '2026-12-14'));
  t('日勤の予定は nextDay にしない', R1.rows.filter((x) => x.scheduled).every((x) => x.nextDay === false));
}

console.log('\n— 5. 事業所の絞り込み —');
{
  const f = T.board(M1, TODAY, 'facility'), v = T.board(M1, TODAY, 'visit'), d = T.board(M1, TODAY, 'day');
  t('施設で絞ると訪問の己が出ない', !f.rows.some((r) => r.staff_id === 'sT06') && f.rows.every((r) => r.office === 'facility'), f.rows.map((r) => [r.staff_id, r.office]));
  t('訪問で絞ると己だけ（遅れ）', v.rows.length === 1 && v.rows[0].staff_id === 'sT06' && v.rows[0].status === 'late', v.rows);
  t('通所で絞ると 0 行（total 0）', d.rows.length === 0 && d.total === 0);
  t('事業所ごとの行の合計＝全部の行（塊の事業所が決まっている時）', f.total + v.total + d.total === R1.total, [f.total, v.total, d.total, R1.total]);
  t('絞った時の人数は絞った行から数える（訪問: 予定1・遅れ1・出勤済み0）', v.counts.scheduled === 1 && v.counts.notInYet === 1 && v.counts.clockedIn === 0 && v.counts.working === 0, v.counts);
  t('施設の人数＋訪問の人数＝全部の人数', ['scheduled', 'clockedIn', 'notInYet', 'working'].every((k) => f.counts[k] + v.counts[k] === R1.counts[k]), [f.counts, v.counts, R1.counts]);
  t('日ごとの画面と同じく塊の事業所で見る（予定なしの戊は主の事業所＝施設）', f.rows.some((r) => r.staff_id === 'sT05'));
  t('決まっていない事業所の値では 0 行', T.board(M1, TODAY, 'nowhere').total === 0);
  /* 主の事業所と違う事業所で働いた塊（甲が今日は通所で働く）: 塊の事業所で絞る */
  const M3 = JSON.parse(JSON.stringify(M1));
  M3.people.find((p) => p.staff.staff_id === 'sT01').days.find((x) => x.date === TODAY).blocks[0].office = 'day';
  const d3 = T.board(M3, TODAY, 'day'), f3 = T.board(M3, TODAY, 'facility');
  t('主の事業所（施設）と違う通所で働いた塊は、通所で絞ると出て施設で絞ると出ない', d3.rows.some((r) => r.staff_id === 'sT01') && !f3.rows.some((r) => r.staff_id === 'sT01'), [d3.rows.map((r) => r.staff_id), f3.rows.map((r) => r.staff_id)]);
}

console.log('\n— 6. 0人の日・崩れた入力 —');
{
  const m0 = month({}, [], '2026-12-15T10:00:00+09:00');
  const r0 = agrees('予定も打刻も無い日', m0);
  t('0 行・状態ごとの数は全部 0', r0.total === 0 && Object.keys(r0.tally).every((k) => r0.tally[k] === 0));
  let ok = true; try { T.board(null, TODAY, ''); T.board({}, 'x', null); T.board({ people: [{ days: [{ date: TODAY, blocks: [{ flags: [] }] }] }] }, TODAY); } catch (e) { ok = false; }
  t('null・崩れた入力でも例外を出さない', ok);
  t('日付が崩れている時は 0 行', T.board(M1, '2026/12/15', '').total === 0);
}

console.log('\n— 7. 画面の読み込み —');
{
  const H = fs.readFileSync(path.join(ROOT, 'kintai.html'), 'utf8');
  const i = H.indexOf('<script src="kintai-today.js?v=');
  t('kintai.html は kintai-today.js を kintai-calc.js の後・kintai.js の前に ?v= つきで読む', i > H.indexOf('kintai-calc.js?v=') && i < H.indexOf('<script src="kintai.js?v='), i);
  t('公開の許可（.gitignore に !/kintai-today.js）', /^!\/kintai-today\.js$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  const fnS = K.indexOf('function todayBoardHtml('), fnE = K.indexOf('\n  }\n', fnS);
  const body = fnS >= 0 ? K.slice(fnS, fnE) : '';
  t('画面は KintaiToday.board の行を出す・名前と事業所の名前は esc を通す', fnS >= 0 && /\.board\(/.test(body) && /esc\(r\.name\)/.test(body) && /esc\(officeName\(/.test(body), fnS);
  t('一覧は画面だけ（no-print）・端末に残さない（localStorage を使わない）', /no-print/.test(body) && !/localStorage/.test(body));
  t('一覧の行は印 data-tdr を持ち、続きの行は class tdc', /data-tdr="1"/.test(body) && /r\.cont \? ' tdc'/.test(body));
  t('一覧の行から移る時だけ日ごとの札の絞り込みを外す（data-tdr のある data-tab のボタン）', /if \(t && b\.hasAttribute\('data-tdr'\)\) dayFilter = null;/.test(K) && K.indexOf("if (t && b.hasAttribute('data-tdr')) dayFilter = null;") < K.indexOf("if (t) { var td0 = b.getAttribute('data-date');"));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格・' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
