/* 勤怠管理のホームの「今日の人員配置」（kintai-staffing-calc.js）の純関数の試験（2026-11-28 新設・代表者の決定 2026-11-28）
   実行: node check/unit/kintai_staffing_test.js
   守りたいこと:
     1. 決まりの確かめ: 形の崩れた行は使わず番号と理由を出す・多すぎる・配列でない時は全部使わない・入り切りの鍵は true の時だけ入
     2. 予定の数え方: 時間帯を通していちばん少ない時刻の人数（入れ替わりの切れ目・同じ人の二重を数えない）・事業所は塊の事業所・欠勤と1日の休みは数えない
     3. 数える人: 看護師・准看護師／介護職員（看護でない人）／介護の資格／サ責の印／職種（様式1）の語・頭数に入れない人とシフトにいない人は数えない
     4. いまの数え方: 時間帯の途中だけ。打刻で勤務中の人と、始まりから15分までの打刻待ち。退勤した人は数えない
     5. 0:00 をまたぐ時間帯: 今日の夜の分と、前の日の夜から続く分（終わっていない時だけ）。夜勤の塊は始まった日にある
     6. 確かめられない時: シフトの職員が読めない・その日が月分の外 → unknown（0人と言わない）。月分の外の日の塊を数えない時は partial
     7. 足りない時だけ札: 予定で足りない＝warn・いま足りない＝alert・並びは足りない方が先
     8. 画面の読み込み（kintai.html が kintai.js の前に読む・公開の許可・CSP）
   ★職員は架空（試験 甲〜己）。施設の数字は使わない（決まりの数は試験のための架空の値）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const S = require(path.join(ROOT, 'kintai-staffing-calc.js'));
const C = require(path.join(ROOT, 'kintai-calc.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 700) : '')); } }

const YM = '2026-12', TODAY = '2026-12-15';
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: 'tablet', created_at: new Date(at(d, hm)).toISOString() });
const IDS = ['sS01', 'sS02', 'sS03', 'sS04', 'sS05', 'sS06'], NAMES = ['試験 甲', '試験 乙', '試験 丙', '試験 丁', '試験 戊', '試験 己'];
const DIV = ['施設', '施設', '施設', '通所', '通所', '訪問'], OFF = ['facility', 'facility', 'facility', 'day', 'day', 'visit'];
const QUAL = [['介護福祉士'], ['初任者研修'], ['看護師'], ['准看護師'], [], ['実務者研修']];
const STAFF = IDS.map((id, i) => ({ id, name: NAMES[i], mainDivision: DIV[i], empCode: '900' + (i + 1), employment: '正社員', active: true, qualifications: QUAL[i] }));
STAFF[4].jobTitle = '生活相談員・介護職員'; STAFF[5].serviceManager = true;
const K_STAFF = IDS.map((id, i) => ({ staff_id: id, name: NAMES[i], office: OFF[i], emp_code: '900' + (i + 1) }));
const SET = { breakThresholdH: 6, breakH: 1, nightBreakH: 2 };
const sch = (cells) => C.buildSchedule({ ym: YM, plan: { cells, subCells: {} }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: SET }).rows;
const month = (cells, punches, nowIso, days, absences) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sch(cells), punches: punches || [], days: days || [], absences: absences || [], config: {}, now: Date.parse(nowIso) });
const R = (office, label, from, to, need, who, word) => Object.assign({ office, label, from, to, need, who }, word ? { word } : {});
const cfgOf = (rules) => ({ staffCheck: true, staffRules: rules });
const PER = { from: '2026-12-01', to: '2026-12-31' };
const ev = (m, nowIso, rules, extra) => S.evaluate(Object.assign({ month: m, today: TODAY, nowMs: Date.parse(nowIso), cfg: cfgOf(rules), staff: STAFF, period: PER, office: '' }, extra || {}));

console.log('\n— 1. 決まりの確かめ —');
{
  t('入り切りは staffCheck が true の時だけ', S.on({ staffCheck: true }) && !S.on({ staffCheck: 'true' }) && !S.on({}) && !S.on(null));
  const ok = S.checkRule(R('facility', '夜間 職員', '21:00', '07:00', 2, 'all'));
  t('正しい行は通る（夜をまたぐ 21:00〜07:00）', ok.rule && ok.rule.from === '21:00' && ok.rule.need === 2, ok);
  const whys = [
    [null, 'shape'], [R('home', 'x', '09:00', '10:00', 1, 'all'), 'office'], [R('day', '', '09:00', '10:00', 1, 'all'), 'label'],
    [R('day', 'あ'.repeat(21), '09:00', '10:00', 1, 'all'), 'label'], [R('day', 'x', '9:00', '10:00', 1, 'all'), 'from'], [R('day', 'x', '09:00', '24:00', 1, 'all'), 'to'],
    [R('day', 'x', '09:00', '09:00', 1, 'all'), 'same'], [R('day', 'x', '09:00', '10:00', 0, 'all'), 'need'], [R('day', 'x', '09:00', '10:00', 1.5, 'all'), 'need'],
    [R('day', 'x', '09:00', '10:00', 21, 'all'), 'need'], [R('day', 'x', '09:00', '10:00', 1, 'boss'), 'who'], [R('day', 'x', '09:00', '10:00', 1, 'job'), 'word'],
  ];
  t('崩れた行は理由つきで断る（事業所・名前・時刻・同じ時刻・人数・数える人・職種の語）', whys.every(([x, w]) => S.checkRule(x).why === w), whys.map(([x, w]) => [w, S.checkRule(x).why]));
  t('表示名の制御文字は落とす', S.checkRule(R('day', 'a\u0001b', '09:00', '10:00', 1, 'all')).rule.label === 'ab');
  const ru = S.rulesOf(cfgOf([R('day', '看護', '09:00', '10:00', 1, 'nurse'), R('day', '', '09:00', '10:00', 1, 'nurse')]));
  t('崩れた行だけ使わず、番号（1から）と理由を出す', ru.items.length === 1 && ru.bad.length === 1 && ru.bad[0].i === 2 && ru.bad[0].why === 'label', ru);
  t('配列でない・21行以上は全部使わない', S.rulesOf({ staffRules: {} }).items.length === 0 && S.rulesOf({ staffRules: {} }).bad[0].why === 'shape' && S.rulesOf({ staffRules: Array(21).fill(R('day', 'x', '09:00', '10:00', 1, 'all')) }).items.length === 0);
  t('鍵が無い時は空（崩れとは言わない）', S.rulesOf({}).items.length === 0 && S.rulesOf({}).bad.length === 0);
  t('設定の大きさの確かめ（8KB）', S.fitsConfig({ a: 'x' }) && !S.fitsConfig({ a: 'x'.repeat(9000) }));
}

console.log('\n— 2・3. 予定の数え方と数える人 —');
{
  /* 施設: 甲（介護福祉士）早 7:00〜16:00・乙（初任者）遅 12:00〜21:00・丙（看護師）日3 9:00〜18:00。通所: 丁（准看）日2・戊（資格なし・生活相談員）日2。訪問: 己（サ責）日1 */
  const cells = { sS01: { 15: '早' }, sS02: { 15: '遅' }, sS03: { 15: '日3' }, sS04: { 15: '日2' }, sS05: { 15: '日2' }, sS06: { 15: '日1' } };
  const m = month(cells, [], '2026-12-15T06:00:00+09:00');
  const r = ev(m, '2026-12-15T06:00:00+09:00', [
    R('facility', '日中 職員', '09:00', '18:00', 2, 'all'),
    R('facility', '日中 介護職員', '09:00', '18:00', 2, 'care'),
    R('facility', '日中 看護職員', '09:00', '17:00', 1, 'nurse'),
    R('facility', '介護の資格', '13:00', '15:00', 2, 'qual'),
    R('day', '介護職員', '09:00', '16:00', 1, 'care'),
    R('day', '看護職員', '09:00', '16:00', 1, 'nurse'),
    R('day', '生活相談員', '09:00', '16:00', 1, 'job', '生活相談員'),
    R('day', '機能訓練指導員', '09:00', '16:00', 1, 'job', '機能訓練指導員'),
    R('visit', 'サ責', '09:00', '17:00', 1, 'sm'),
  ]);
  const by = {}; r.rows.forEach((x) => { by[x.label] = x; });
  t('全員: 9:00〜18:00 は甲・乙・丙が入れ替わり、いちばん少ないのは 2人', by['日中 職員'].plan === 2 && by['日中 職員'].level === 'ok', by['日中 職員']);
  t('介護職員（看護でない人）: 9:00〜12:00 は甲だけ（乙は 12:00 から）＝1人（いちばん早いその時刻 9:00）→ 予定で足りない', by['日中 介護職員'].plan === 1 && by['日中 介護職員'].planAt === at(TODAY, '09:00') && by['日中 介護職員'].level === 'warn', by['日中 介護職員']);
  t('入れ替わりの切れ目: 12:00〜16:00 は甲・乙の2人・16:00〜18:00 は乙だけ（13:00〜18:00 を見るといちばん少ないのは 16:00 の1人）', ev(m, '2026-12-15T06:00:00+09:00', [R('facility', 'x', '13:00', '18:00', 2, 'care')]).rows[0].planAt === at(TODAY, '16:00'));
  t('看護職員（看護師・准看護師）: 丙 1人で足りる', by['日中 看護職員'].plan === 1 && by['日中 看護職員'].level === 'ok');
  t('介護の資格（介護福祉士・実務者・初任者）: 13:00〜15:00 は甲・乙の2人', by['介護の資格'].plan === 2);
  t('事業所は塊の事業所で見る（通所の介護職員＝戊だけ・准看の丁は看護職員）', by['介護職員'].plan === 1 && by['看護職員'].plan === 1, [by['介護職員'], by['看護職員']]);
  t('職種（様式1）の語で数える: 生活相談員は戊・機能訓練指導員はいない＝0人で足りない', by['生活相談員'].plan === 1 && by['機能訓練指導員'].plan === 0 && by['機能訓練指導員'].level === 'warn');
  t('サ責の印: 訪問の己', by['サ責'].plan === 1 && by['サ責'].level === 'ok');
  t('時間帯の前（06:00）はいまの人数を出さない（later・now は null）', r.rows.every((x) => x.phase === 'later' && x.now === null));
  t('足りない行の数（short）と並び（足りない方が先）', r.short === 2 && r.rows[0].level === 'warn' && r.rows[1].level === 'warn' && r.rows[r.rows.length - 1].level === 'ok', r.rows.map((x) => x.label + ':' + x.level));
  /* 同じ人が分けた勤務を2つ持つ時も1人 */
  const m2 = C.computeMonth({ ym: YM, staff: K_STAFF, schedule: [
    { staff_id: 'sS01', work_date: TODAY, seq: 1, office: 'facility', start_at: new Date(at(TODAY, '09:00')).toISOString(), end_at: new Date(at(TODAY, '12:00')).toISOString(), break_min: 0, kind: 'work', symbol: '分', paid_min: 0 },
    { staff_id: 'sS01', work_date: TODAY, seq: 2, office: 'facility', start_at: new Date(at(TODAY, '11:00')).toISOString(), end_at: new Date(at(TODAY, '15:00')).toISOString(), break_min: 0, kind: 'work', symbol: '分', paid_min: 0 },
  ], punches: [], days: [], config: {}, now: Date.parse('2026-12-15T06:00:00+09:00') });
  const r2 = ev(m2, '2026-12-15T06:00:00+09:00', [R('facility', '重なり', '09:00', '15:00', 2, 'all'), R('facility', '一人', '09:00', '15:00', 1, 'all')]);
  t('同じ人の重なった2つの塊は1人と数える（2人にしない）', r2.rows.find((x) => x.label === '重なり').plan === 1 && r2.rows.find((x) => x.label === '一人').plan === 1, r2.rows);
  /* 欠勤・1日の特別休暇・頭数に入れない人・シフトにいない人 */
  const m3 = month({ sS01: { 15: '早' }, sS02: { 15: '早' }, sS03: { 15: '早' } }, [], '2026-12-15T06:00:00+09:00', [{ staff_id: 'sS01', work_date: TODAY, day_mark: 'absent' }],
    [{ id: 'a1', staff_id: 'sS02', date: TODAY, kind: 'special', minutes: null, paid: true, type_code: null, link_date: null, note: '', created_at: '2026-12-01T10:00:00+09:00' }]);
  t('欠勤の印の人と1日の特別休暇の人は予定に数えない', ev(m3, '2026-12-15T06:00:00+09:00', [R('facility', '早', '08:00', '09:00', 1, 'all')]).rows[0].plan === 1);
  const noHead = STAFF.map((s) => (s.id === 'sS03' ? Object.assign({}, s, { countInHeadcount: false }) : s));
  t('頭数に入れない人（countInHeadcount が false）は数えない', ev(m3, '2026-12-15T06:00:00+09:00', [R('facility', '早', '08:00', '09:00', 1, 'all')], { staff: noHead }).rows[0].plan === 0);
  const r3 = ev(m3, '2026-12-15T06:00:00+09:00', [R('facility', '早', '08:00', '09:00', 1, 'all')], { staff: STAFF.filter((s) => s.id !== 'sS03') });
  t('シフトの職員にいない人は数えず、いない人の数（missing）を出す', r3.rows[0].plan === 0 && r3.rows[0].missing === 1, r3.rows[0]);
  t('事業所の絞り込み（day だけ）', ev(m, '2026-12-15T06:00:00+09:00', [R('day', 'a', '09:00', '10:00', 1, 'all'), R('facility', 'b', '09:00', '10:00', 1, 'all')], { office: 'day' }).rows.map((x) => x.office).join() === 'day');
}

console.log('\n— 4. いまの数え方 —');
{
  /* 10:00。甲は 7:00 出勤で勤務中・乙は 7:00〜9:30 で退勤済み・丙は日3（9:00〜）で打刻なし（15分を過ぎた）。時間帯 9:00〜12:00 は必要2 */
  const pun = [P('sS01', 'in', TODAY, '7:00'), P('sS02', 'in', TODAY, '7:00'), P('sS02', 'out', TODAY, '9:30')];
  const m = month({ sS01: { 15: '早' }, sS02: { 15: '早' }, sS03: { 15: '日3' } }, pun, '2026-12-15T10:00:00+09:00');
  const r = ev(m, '2026-12-15T10:00:00+09:00', [R('facility', '午前', '09:00', '12:00', 2, 'all')]);
  t('予定は3人いても（いちばん少ない3）、いまは甲だけ＝1人 → いま足りない（alert）', r.rows[0].phase === 'now' && r.rows[0].plan === 3 && r.rows[0].now === 1 && r.rows[0].level === 'alert', r.rows[0]);
  /* 9:10 なら丙は始まりから15分の打刻待ち＝いる側 */
  const m2 = month({ sS01: { 15: '早' }, sS03: { 15: '日3' } }, [P('sS01', 'in', TODAY, '7:00')], '2026-12-15T09:10:00+09:00');
  const r2 = ev(m2, '2026-12-15T09:10:00+09:00', [R('facility', '午前', '09:00', '12:00', 2, 'all')]);
  t('始まりから15分までの打刻待ちはいる側（9:10 は丙を数える）', r2.rows[0].now === 2 && r2.rows[0].level === 'ok', r2.rows[0]);
  const m3 = month({ sS01: { 15: '早' }, sS03: { 15: '日3' } }, [P('sS01', 'in', TODAY, '7:00')], '2026-12-15T09:15:00+09:00');
  t('15分ちょうど（9:15）を過ぎたら数えない', ev(m3, '2026-12-15T09:15:00+09:00', [R('facility', '午前', '09:00', '12:00', 2, 'all')]).rows[0].now === 1);
  t('時間帯が終わった後（past）はいまの人数を出さず、予定だけで判定', ev(m, '2026-12-15T13:00:00+09:00', [R('facility', '午前', '09:00', '12:00', 2, 'all')]).rows[0].now === null);
  /* 予定の無い勤務（打刻だけ）はいまの人数には入る・予定には入らない */
  const m4 = month({}, [P('sS01', 'in', TODAY, '8:00')], '2026-12-15T10:00:00+09:00');
  const r4 = ev(m4, '2026-12-15T10:00:00+09:00', [R('facility', '午前', '09:00', '12:00', 1, 'all')]);
  t('予定の無い勤務中は、いまには数え・予定には数えない（予定で足りない）', r4.rows[0].now === 1 && r4.rows[0].plan === 0 && r4.rows[0].level === 'warn', r4.rows[0]);
}

console.log('\n— 5. 0:00 をまたぐ時間帯 —');
{
  /* 14日の夜に甲・乙が夜勤入り21時（翌7時上がり）。15日の夜は甲だけ */
  const cells = { sS01: { 14: '(21', 15: '7)' }, sS02: { 14: '(21', 15: '7)' } };
  const cells2 = { sS01: { 14: '(21', 15: '7)' }, sS02: { 14: '(21', 15: '7)' }, sS03: { 15: '(21', 16: '7)' } };
  const rule = [R('facility', '夜間 職員', '21:00', '07:00', 2, 'all')];
  const m = month(cells2, [P('sS01', 'in', '2026-12-14', '20:55'), P('sS02', 'in', '2026-12-14', '20:58')], '2026-12-15T03:00:00+09:00');
  const r = ev(m, '2026-12-15T03:00:00+09:00', rule);
  const y = r.rows.find((x) => x.date === '2026-12-14'), tn = r.rows.find((x) => x.date === TODAY);
  t('3:00 は前の日の夜の分（途中・2人とも勤務中）と今日の夜の分の2行', r.rows.length === 2 && y && tn && y.phase === 'now' && y.plan === 2 && y.now === 2 && y.level === 'ok' && y.overnight, r.rows);
  t('今日の夜の分は丙だけ＝予定で足りない（warn）', tn.phase === 'later' && tn.plan === 1 && tn.level === 'warn', tn);
  const m2 = month(cells, [], '2026-12-15T08:00:00+09:00');
  t('前の日の夜の分は、終わった後（8:00）は出さない', ev(m2, '2026-12-15T08:00:00+09:00', rule).rows.every((x) => x.date === TODAY));
  t('時間帯の始まりと終わりの時刻（21:00〜翌7:00）', y.startMs === at('2026-12-14', '21:00') && y.endMs === at(TODAY, '07:00'));
}

console.log('\n— 6. 確かめられない時 —');
{
  const m = month({ sS01: { 15: '早' } }, [], '2026-12-15T06:00:00+09:00');
  const r = ev(m, '2026-12-15T06:00:00+09:00', [R('facility', '早', '08:00', '09:00', 1, 'all')], { staff: null });
  t('シフトの職員が読めない時は unknown（理由 staff）・0人と言わない・足りないに数えない', r.rows[0].level === 'unknown' && r.rows[0].why === 'staff' && r.rows[0].plan === null && r.short === 0 && r.staffOk === false, r);
  const r2 = ev(m, '2026-12-01T03:00:00+09:00', [R('facility', '夜', '21:00', '07:00', 1, 'all')], { today: '2026-12-01' });
  t('月分の初日の 3:00: 前の日の夜の分は月分の外＝unknown（理由 period）', r2.rows.some((x) => x.date === '2026-11-30' && x.level === 'unknown' && x.why === 'period'), r2.rows);
  t('今日の夜の分は、月分の外の日（前の日）の塊を数えていない印 partial', r2.rows.some((x) => x.date === '2026-12-01' && x.partial === true));
  t('入力が崩れていても例外を出さない', (() => { try { S.evaluate(null); S.evaluate({}); S.evaluate({ month: {}, today: 'x', nowMs: 1, cfg: cfgOf([1, 2]) }); S.evaluate({ month: { people: [{ days: [{ date: TODAY, blocks: [{}] }] }] }, today: TODAY, nowMs: Date.now(), cfg: cfgOf([R('day', 'a', '09:00', '10:00', 1, 'all')]), staff: [null, {}] }); return true; } catch (e) { return false; } })());
}

console.log('\n— 8. 画面の読み込み —');
{
  const html = fs.readFileSync(path.join(ROOT, 'kintai.html'), 'utf8');
  const iCalc = html.indexOf('kintai-staffing-calc.js?v='), iUi = html.indexOf('kintai-staffing.js?v='), iMain = html.indexOf('kintai.js?v=');
  t('kintai.html が計算・画面の部品を kintai.js の前に読む', iCalc > 0 && iUi > iCalc && iMain > iUi, { iCalc, iUi, iMain });
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  t('公開の許可（.gitignore）に2つとも載っている', /^!\/kintai-staffing-calc\.js$/m.test(gi) && /^!\/kintai-staffing\.js$/m.test(gi));
  const js = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  t('設定の保存で鍵 staffCheck・staffRules を残す（画面の欄が持つ鍵として送る）', /STF\.readSet/.test(js) && /stfs \? stfs\.keys : \[\]/.test(js));
}

console.log('\n' + pass + ' 件合格・' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
