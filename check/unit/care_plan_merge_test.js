/* 週間計画（care-schedule.html）── 計画の版（予約・切替・版ごとの介護度）の統合の守りの試験（2026-11-27 新設）
   実行: node check/unit/care_plan_merge_test.js（環境変数 CS_HTML・CARE_PLAN_CALC で別の版を当てられる）

   守りたいこと（ROOT.md の受入条件 A1〜A3 と 段2-3 の指示 A）:
     1. 2台が同じ予約を別々に切り替えた結果を統合しても、予定が二重にならず一字一句同じ
     2. サーバーで切り替わった後、古い端末（planGen が小さい・未送信の予定の編集あり）が統合しても、
        サーバーの新しい計画が残り、古い予定が戻らない。知らせの件数は未送信の変更がある時だけ出る
     3. 自分が足した予約と相手が足した予約は両方残る。相手が取り消した予約は戻らない
     4. 版の項目の無いデータでは、部品（care-plan-calc.js）を読んでも読まなくても結果が1バイトも同じ
     5. 端末の控えからの復元（足す・丸ごと）とマスタ取込の介護度（hold・mismatch）
     6. 予約だけ直した時も「最後に直した人」が動く（直した人の印の指紋に版の項目が入る）
   ★実物の関数を HTML から切り出して動かす（care_field_merge_test.js と同じ型）。氏名・予定はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');
const CALC_PATH = process.env.CARE_PLAN_CALC || path.join(ROOT, 'care-plan-calc.js');
const CALC_SRC = fs.readFileSync(CALC_PATH, 'utf8');

/* ── 切り出し（care_field_merge_test.js と同じ方式）── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  let start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = SRC.indexOf('\nasync function ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}
function grabDecl(name) {
  const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  const vpos = m.index + m[0].length;
  const open = SRC[vpos];
  if (open === '{' || open === '[') {
    const end = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']');
    let j = end + 1;
    while (j < SRC.length && SRC[j] !== ';') j++;
    return SRC.slice(m.index, j + 1);
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol < 0 ? SRC.length : eol);
}
function grabDeclAsVar(name) { return grabDecl(name).replace(/^(?:const|let)\s/, 'var '); }

let ok = 0, ng = 0;
function t(label, cond, got) {
  if (cond) { ok++; process.stdout.write('  ✓ ' + label + '\n'); }
  else { ng++; process.stdout.write('  ✗ ' + label + (got !== undefined ? '\n    実際: ' + JSON.stringify(got) : '') + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }
const J = (x) => JSON.stringify(x);
const cp = (x) => JSON.parse(JSON.stringify(x));

/* ── 砂場（withCalc=false の時は部品が読めなかった端末と同じ）── */
function makeBox(withCalc) {
  const store = {};
  const fakeLS = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const box = {
    JSON, Math, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat, console, Promise,
    localStorage: fakeLS, __store: store,
    LS_KEY: 'care_schedule_v2',
    SIM_ON: false,
    DB: { residents: [] },
    toasts: [], logs: [],
    SYNC: { _dirty: false, log: (m) => { box.logs.push(String(m)); }, hasTarget: () => false, push: () => {}, markDirty: () => {} },
    showToast: (m) => { box.toasts.push(String(m)); },
    csNote_: () => {},
    pushUndo: () => {}, recalcAllEventUnits: () => {}, populateResidentSelect: () => {}, renderAll: () => {},
    closeRestoreModal: () => {}, saveDB: () => true, saveLocalOnly: () => { box.__savedLocal = (box.__savedLocal || 0) + 1; },
    suGetDeviceRole: () => 'office',
    csLooksLikeSampleOnly: (rs) => !Array.isArray(rs) || rs.length === 0,
    csRealResidentCount: (rs) => (Array.isArray(rs) ? rs.length : 0),
    csApplyMasterHospitalized: () => 0, csApplyMasterNameCut: () => 0,
    csStateRevCommon_: null, csGetMasterCfg: () => null,
    ruid: () => 'r_new',
    csWho_: () => '架空 花子',
    document: { body: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } } },
  };
  vm.createContext(box);
  if (withCalc) {
    const mod = { exports: {} };
    vm.runInContext('(function(module){' + CALC_SRC + '\n})', box)(mod);
    box.CarePlanCalc = mod.exports;
  }
  vm.runInContext([
    'var SOGO_VISIT_CODES = {};',
    grabDeclAsVar('CS_LOCAL_FP_KEY'),
    grabDeclAsVar('CS_FIELD_BASE_KEY'),
    grabDeclAsVar('CS_MERGE_FIELDS'),
    'var CS_FIELD_BASE = null;',
    grabFn('csFingerprint_'),
    grabFn('csFieldBaseBuild_'),
    grabFn('csFieldBaseSet_'),
    grabFn('csFieldBaseLoad_'),
    grabFn('csFieldBaseRec_'),
    grabFn('csPickField_'),
    "var DAYS_JA = ['月','火','水','木','金','土','日'];",
    grabDeclAsVar('CS_STAMP_AT'),
    grabDeclAsVar('CS_STAMP_FP'),
    grabFn('csAuthorFp_'),
    grabFn('csAuthoredAt_'),
    grabFn('csPickFieldStamped_'),
    'var csFieldsKept_ = 0;',
    'var csFieldChanges_ = [];',
    grabFn('csFieldChangeText_'),
    grabFn('csTakeNewerEdit_'),
    grabDeclAsVar('csBathRestored_'),
    grabDeclAsVar('csPlanDropped_'),
    grabDeclAsVar('csPlanTook_'),
    grabFn('csRebaseEdits'),
    grabFn('csPlanDroppedNotify_'),
    grabFn('csMergeEventsFrom_'),
    grabDeclAsVar('csRestoreSkipped_'),
    grabFn('csPlanGenOf_'),
    grabFn('csRestoreAddOnly_'),
    'var csRestoreKeptPlan_ = 0;',
    grabFn('csPlanKeepOnWhole_'),
    grabFn('csEventIdSet_'),
    grabFn('csGenDiff_'),
    grabFn('csApplyRestore_'),
    grabDeclAsVar('CS_RESIDENT_BACKUP_KEY'),
    grabFn('csRestoreResidentsIfLost'),
    grabDeclAsVar('SU_COMMON_KEY'),
    grabFn('suNormName'),
    'var csPlanLvNotice_ = Object.create(null);',
    grabFn('mergeCommonSchedule'),
    'var csEditBase_ = null;',
    'var csUnconfirmed_ = Object.create(null);',
    grabFn('csEditFp_'),
    grabFn('csEditBaseline_'),
    grabFn('csStampEdits_'),
  ].join('\n'), box);
  return box;
}
const B = makeBox(true);
const C = B.CarePlanCalc;

const ev = (id, dow, st, en, o) => Object.assign({ id, dayOfWeek: dow, serviceType: 'visit', category: '身体１',
  startTime: st, endTime: en, detail: '', notes: '', bathing: false, units: 0 }, o || {});
function resBase() {
  return { id: 'r1', name: '架空 一郎', careLevel: '要介護2', masterId: 'm1',
    events: [ev('e1', 1, '09:00', '09:30'), ev('e2', 3, '14:00', '14:30')],
    planFrom: '2026-04-01', planGen: 3, planLevel: '', planNote: '',
    nextPlans: [
      { id: 'pl_a', from: '2026-12-01', careLevel: '要介護3', baseLevel: '要介護2', note: '架空のメモ',
        events: [ev('e1', 1, '09:00', '10:00'), ev('e2', 3, '14:00', '14:30'), ev('e5', 5, '10:00', '10:30')],
        createdAt: '2026-11-01T00:00:00.000Z', createdBy: '架空 花子', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: '架空 花子' },
      { id: 'pl_b', from: '2027-01-15', careLevel: '', baseLevel: '要介護3', note: '',
        events: [ev('e1', 2, '09:00', '09:30')],
        createdAt: '2026-11-02T00:00:00.000Z', createdBy: '架空 花子', updatedAt: '2026-11-02T00:00:00.000Z', updatedBy: '架空 花子' },
    ],
    planGone: [] };
}
const other = () => ({ id: 'r2', name: '見本 甲', careLevel: '要支援1', events: [ev('x1', 2, '10:00', '10:30')] });
const db = (...rs) => ({ residents: rs });

group('1. 2台が同じ予約を別々に切り替えた');
{
  const base = resBase();
  const A = C.applyDue(cp(base), '2026-12-01', '2026-12-01T00:05:00.000Z').res;
  const Bv = C.applyDue(cp(base), '2026-12-01', '2026-12-01T00:40:00.000Z').res;
  t('1-1 2台の切替の結果が一字一句同じ（時刻は中身に書かない）', J(A) === J(Bv));
  const out = B.csRebaseEdits(db(A, other()), db(Bv, other()));
  const r = out.residents.find((x) => x.id === 'r1');
  t('1-2 統合しても予定が二重にならない（3件・id は予約のまま）', r.events.length === 3 && r.events.map((e) => e.id).join(',') === 'e1,e2,e5', r.events.map((e) => e.id));
  t('1-3 統合の結果がサーバーの切替の結果と一字一句同じ', J(r) === J(A), r);
  t('1-4 知らせの件数は0', B.csPlanDropped_ === 0 && B.csPlanDroppedNotify_() === false);
}

group('2. サーバーで切り替わった後、古い端末が統合する');
{
  const old = resBase();
  const server = C.applyDue(cp(old), '2026-12-01').res;           // gen 4・予定は pl_a の中身・介護度 要介護3
  /* 古い端末: 最後にサーバーと一致した時の土台は old。予定を1件直し・1件足した（未送信） */
  B.CS_FIELD_BASE = null; B.__store.cs_field_base_v1 = undefined; delete B.__store.cs_field_base_v1;
  B.csFieldBaseSet_(B.csFieldBaseBuild_(db(old)));
  const mine = cp(old); mine.events[1].startTime = '15:00'; mine.events.push(ev('e_new', 6, '11:00', '11:30'));
  B.toasts.length = 0; B.logs.length = 0;
  const out = B.csRebaseEdits(db(server, other()), db(mine, other()));
  const r = out.residents.find((x) => x.id === 'r1');
  t('2-1 サーバーの新しい計画（予定・世代・開始日・介護度）が残る', J(r.events) === J(server.events) && r.planGen === 4 && r.planFrom === '2026-12-01' && r.careLevel === '要介護3');
  t('2-2 古い予定（直した e2・足した e_new）が戻らない', !r.events.some((e) => e.id === 'e_new') && r.events.find((e) => e.id === 'e2').startTime === '14:00');
  t('2-3 切り替え済みの予約（pl_a）が生き返らない', r.nextPlans.map((p) => p.id).join(',') === 'pl_b', r.nextPlans.map((p) => p.id));
  t('2-4 知らせの件数（未送信の変更 2件）', B.csPlanDropped_ === 2, B.csPlanDropped_);
  t('2-5 知らせの文（トーストと同期の記録）', B.csPlanDroppedNotify_() === true
    && B.toasts[0] === 'ほかの端末で計画が切り替わったため、この端末の未送信の変更 2件は反映していません'
    && B.logs[0].indexOf('未送信の変更 2件は反映していません') >= 0, B.toasts);
  t('2-6 ほかの利用者はそのまま', J(out.residents.find((x) => x.id === 'r2')) === J(other()));
  /* 切り替わっただけの端末（自分は何も直していない）では知らせない */
  const untouched = cp(old);
  B.csRebaseEdits(db(server), db(untouched));
  t('2-7 切り替わっただけの端末では知らせの件数0', B.csPlanDropped_ === 0, B.csPlanDropped_);
  /* 土台を持たない端末は未送信の印で決める（仮置き） */
  B.CS_FIELD_BASE = null; delete B.__store.cs_field_base_v1;
  B.SYNC._dirty = false; B.csRebaseEdits(db(server), db(mine));
  const n0 = B.csPlanDropped_;
  B.SYNC._dirty = true; B.csRebaseEdits(db(server), db(mine));
  const n1 = B.csPlanDropped_;
  B.SYNC._dirty = false;
  /* 土台が無いと「どれを自分が直したか」は分からないので、サーバーと違う自分の予定を全部数える（e1 は計画の違い・e2 と e_new は直し＝3件・仮置き） */
  /* 2026-11-27 決まりの変更（反証レビュー B3）: 相手にあって自分に無い予定（消した）も候補に数える＝ e1・e2・e_new と e5 の4件 */
  t('2-8 土台が無い端末: 未送信の印が無ければ0・あれば サーバーと違う自分の予定の数（足した・変えた・消した）', n0 === 0 && n1 === 4, [n0, n1]);
  /* 他タブの取り込み（csMergeEventsFrom_）: 相手（新しい計画）の予定・版の項目・介護度を取り込む */
  B.csFieldBaseSet_(B.csFieldBaseBuild_(db(old)));
  const mineDb = db(cp(mine), other()); mineDb.office = { name: '架空の事業所' };
  const otherDb = db(cp(server), other()); otherDb.office = { name: '別の値' };
  const m2 = B.csMergeEventsFrom_(otherDb, mineDb);
  const r2 = m2.residents.find((x) => x.id === 'r1');
  t('2-9 他タブの取り込み: 新しい計画の予定・世代・開始日・介護度・予約を取り込む', J(r2.events) === J(server.events) && r2.planGen === 4 && r2.planFrom === '2026-12-01'
    && r2.careLevel === '要介護3' && r2.planLevel === '要介護3' && r2.nextPlans.map((p) => p.id).join(',') === 'pl_b');
  t('2-10 他タブの取り込み: 利用者の外の項目（事業所情報）は自分のまま', m2.office.name === '架空の事業所');
  t('2-11 他タブの取り込みでも知らせの件数が出る', B.csPlanDropped_ === 2, B.csPlanDropped_);
  /* 自分（手で切り替えた端末）の方が世代が大きい: 自分の計画を採る */
  const m3 = B.csRebaseEdits(db(cp(old)), db(cp(server)));
  t('2-12 自分の方が世代が大きい時は自分の予定・版の項目・介護度', J(m3.residents[0].events) === J(server.events) && m3.residents[0].planGen === 4 && m3.residents[0].careLevel === '要介護3' && B.csPlanDropped_ === 0);
}

group('3. 予約の和と取り消し（世代が同じ）');
{
  const base = resBase();
  const S = cp(base), M = cp(base);
  S.nextPlans.push({ id: 'pl_s', from: '2027-03-01', careLevel: '要介護1', baseLevel: '要介護2', events: [], note: '', updatedAt: '2026-11-20T00:00:00.000Z' });
  M.nextPlans.push({ id: 'pl_m', from: '2027-04-01', careLevel: '要介護4', baseLevel: '要介護2', events: [], note: '', updatedAt: '2026-11-21T00:00:00.000Z' });
  /* 相手（サーバー）は pl_b を取り消した。自分はまだ pl_b を持っている */
  S.nextPlans = S.nextPlans.filter((p) => p.id !== 'pl_b'); S.planGone = [{ id: 'pl_b', at: '2026-11-22T00:00:00.000Z' }];
  /* 自分は現行の予定 e1 を直した（世代が同じ＝今までどおり id 単位で自分が勝つ） */
  M.events[0].endTime = '09:45';
  const out = B.csRebaseEdits(db(S), db(M));
  const r = out.residents[0];
  t('3-1 自分が足した予約と相手が足した予約の両方が残る', ['pl_a', 'pl_s', 'pl_m'].every((id) => r.nextPlans.some((p) => p.id === id)), r.nextPlans.map((p) => p.id));
  t('3-2 相手が取り消した予約は戻らない', !r.nextPlans.some((p) => p.id === 'pl_b') && r.planGone.some((g) => g.id === 'pl_b'));
  t('3-3 世代が同じ時の現行の予定は今までどおり id 単位の統合（自分の直しが残る）', r.events.find((e) => e.id === 'e1').endTime === '09:45' && r.events.length === 2);
  t('3-4 予約の並びは開始日の昇順', r.nextPlans.map((p) => p.from).join(',') === '2026-12-01,2027-03-01,2027-04-01');
  const back = B.csRebaseEdits(db(M), db(S));
  t('3-5 逆向き（取り消した側が自分）でも生き返らない', !back.residents[0].nextPlans.some((p) => p.id === 'pl_b'));
}

group('4. 版の項目の無いデータは、部品を読んでも読まなくても1バイトも同じ（A1）');
{
  const N = makeBox(false);
  const cases = [];
  const r1 = () => ({ id: 'r1', name: '架空 一郎', careLevel: '要介護2', events: [ev('e1', 1, '08:00', '08:30'), ev('e2', 2, '09:00', '09:30', { bathing: true })] });
  { const s = db(r1(), other()), m = db(r1(), other()); m.residents[0].events[0].startTime = '08:15'; cases.push(['自分が時刻を直した', s, m]); }
  { const s = db(r1()), m = db(r1()); s.residents[0].events.push(ev('e3', 4, '10:00', '10:30')); m.residents[0].events.pop(); cases.push(['相手が足し・自分が消した', s, m]); }
  { const s = db(r1()), m = db(r1()); m.residents[0].events[1].bathing = false; s.residents[0].careLevel = '要介護3'; cases.push(['入浴の和・介護度は相手', s, m]); }
  { const s = db(r1()), m = db(r1(), other()); cases.push(['自分にだけ居る利用者', s, m]); }
  { const s = db(r1()), m = db(r1()); s.residents[0].events[0].category = '身体２'; cases.push(['相手が区分を直した（3-way）', s, m]); }
  cases.forEach(([name, s, m]) => {
    [B, N].forEach((bx) => { bx.CS_FIELD_BASE = null; delete bx.__store.cs_field_base_v1; bx.csFieldBaseSet_(bx.csFieldBaseBuild_(db(r1(), other()))); });
    const a = J(B.csRebaseEdits(cp(s), cp(m))), b = J(N.csRebaseEdits(cp(s), cp(m)));
    t('4 csRebaseEdits: ' + name, a === b && B.csPlanDropped_ === 0 && J(B.csPlanTook_) === '{}', a === b ? undefined : [a, b]);
    const c1 = J(B.csMergeEventsFrom_(cp(s), cp(m))), c2 = J(N.csMergeEventsFrom_(cp(s), cp(m)));
    t('4 csMergeEventsFrom_: ' + name, c1 === c2);
  });
  /* 既存の試験の入力をそのまま流す（care_field_merge_test.js の withEvents の形） */
  const fixed = { residents: [{ id: 'r1', name: '架空 一郎', events: [ev('a', 1, '08:00', '08:30', { detail: '架空の支援' })] }] };
  t('4 版の項目を足さない（統合の結果に planGen 等が現れない）', J(B.csRebaseEdits(cp(fixed), cp(fixed))) === J(fixed));
  const cur = [r1()], gen = [Object.assign(r1(), { events: [ev('e9', 5, '10:00', '10:30')] })];
  t('4 足す復元: 部品の有無で同じ', J(B.csRestoreAddOnly_(cp(cur), cp(gen))) === J(N.csRestoreAddOnly_(cp(cur), cp(gen))) && B.csRestoreSkipped_ === 0);
  t('4 丸ごとの復元の印の保ち: 版の無い方は控えのまま', J(B.csPlanKeepOnWhole_(cp(gen), cp(cur))) === J(gen));
  const master = { residents: [{ masterId: 'm1', name: '架空 一郎', careLevel: '要介護4', room: '101' }] };
  [B, N].forEach((bx) => { bx.DB = { residents: [Object.assign(r1(), { masterId: 'm1' })] }; bx.mergeCommonSchedule(cp(master)); });
  t('4 マスタ取込: 部品の有無で同じ（マスタが入っていればマスタ）', J(B.DB) === J(N.DB) && B.DB.residents[0].careLevel === '要介護4');
  const masterEmpty = { residents: [{ masterId: 'm1', name: '架空 一郎', careLevel: '', room: '101' }] };
  [B, N].forEach((bx) => { bx.DB = { residents: [Object.assign(r1(), { masterId: 'm1' })] }; bx.mergeCommonSchedule(cp(masterEmpty)); });
  t('4 マスタ取込: マスタが空の時は今の値（部品の有無で同じ）', J(B.DB) === J(N.DB) && B.DB.residents[0].careLevel === '要介護2');
}

group('5. 端末の控えからの復元');
{
  const curR = C.applyDue(resBase(), '2026-12-01').res;            // 今は gen 4（切り替え後）
  const oldR = resBase(); oldR.events.push(ev('e_old', 6, '16:00', '16:30'));   // 控えは gen 3（前の計画）
  const added = B.csRestoreAddOnly_([cp(curR), other()], [cp(oldR), Object.assign(other(), { events: [ev('x1', 2, '10:00', '10:30'), ev('x2', 4, '11:00', '11:30')] })]);
  t('5-1 足す: 控えの世代が今より小さい方には予定を足さない', !added[0].events.some((e) => e.id === 'e_old') && J(added[0]) === J(curR));
  t('5-2 足す: 飛ばした人数を数える（1名）・ほかの方は今までどおり足す', B.csRestoreSkipped_ === 1 && added[1].events.length === 2, B.csRestoreSkipped_);
  const sameGen = cp(curR); sameGen.events.push(ev('e_ok', 6, '16:00', '16:30'));
  const added2 = B.csRestoreAddOnly_([cp(curR)], [sameGen]);
  t('5-3 足す: 同じ計画（世代・開始日が同じ）の控えからは足す', added2[0].events.some((e) => e.id === 'e_ok') && B.csRestoreSkipped_ === 0);
  /* 丸ごと: 今の世代・開始日・予約・取り消した印を保つ */
  B.toasts.length = 0;
  const cur2 = cp(curR); cur2.nextPlans.push({ id: 'pl_n', from: '2027-05-01', careLevel: '', baseLevel: '', events: [], note: '' }); cur2.planGone = [{ id: 'pl_x', at: '2026-11-25T00:00:00.000Z' }];
  B.DB = { residents: [cur2] };
  B.toasts.length = 0;
  const okW = B.csApplyRestore_([cp(oldR)], true, '架空の時刻');
  const w = B.DB.residents[0];
  /* 2026-11-27 決まりの変更（反証レビュー B7）: 控えの計画が今より前の方は、予定を戻さず今の計画のまま。知らせる */
  t('5-4 丸ごと: 控えの計画が今より前の方は予定を戻さない（今の計画のまま）', okW === true && !w.events.some((e) => e.id === 'e_old') && J(w.events) === J(cur2.events));
  t('5-4b 丸ごと: 「計画が切り替わった後の方 1名は、今の計画のままにしました」と知らせる', B.toasts.some((m) => m === '計画が切り替わった後の方 1名は、今の計画のままにしました'), B.toasts);
  const sameW = cp(cur2); sameW.events = sameW.events.concat([ev('e_back', 6, '16:00', '16:30')]); sameW.nextPlans = []; delete sameW.planGone;
  B.DB = { residents: [cp(cur2)] };
  B.csApplyRestore_([sameW], true, '架空の時刻');
  t('5-4c 丸ごと: 同じ計画の控えからは予定を戻し、予約と取り消した印は今の物', B.DB.residents[0].events.some((e) => e.id === 'e_back') && B.DB.residents[0].nextPlans.length === 2 && J(B.DB.residents[0].planGone) === J(cur2.planGone));
  B.DB = { residents: [cur2] }; B.csApplyRestore_([cp(oldR)], true, '架空の時刻');
  t('5-5 丸ごと: 世代を今より小さくしない（4のまま）・開始日も今の物', w.planGen === 4 && w.planFrom === '2026-12-01' && w.planLevel === '要介護3');
  t('5-6 丸ごと: 予約と取り消した印は今の物', w.nextPlans.map((p) => p.id).join(',') === 'pl_b,pl_n' && J(w.planGone) === J(cur2.planGone), w.nextPlans.map((p) => p.id));
  /* 足すの知らせ */
  B.toasts.length = 0;
  B.DB = { residents: [cp(curR)] };
  const extra = cp(oldR);
  B.csApplyRestore_([extra], false, '架空の時刻');
  t('5-7 足す: 飛ばした時は知らせる', B.toasts.some((m) => m.indexOf('前の計画の予定を足していません') >= 0), B.toasts);
  /* 起動時の自動復元（今が空・サンプル）: 今に居ない方は控えのまま */
  B.DB = { residents: [] };
  B.__store.care_schedule_residents_backup_v1 = undefined;
  const bkKey = vm.runInContext('CS_RESIDENT_BACKUP_KEY', B);
  B.__store[bkKey] = JSON.stringify({ residents: [cp(oldR)] });
  B.csRestoreResidentsIfLost();
  t('5-8 起動時の自動復元: 今に居ない方は控えの版の項目のまま', B.DB.residents[0].planGen === 3 && B.DB.residents[0].nextPlans.length === 2);
}

group('6. マスタ取込の介護度（hold・mismatch）');
{
  const far = '2099-01-01';
  const mk = (o) => Object.assign({ id: 'r1', name: '架空 一郎', masterId: 'm1', careLevel: '要介護2', events: [] }, o || {});
  const master = (lv) => ({ residents: [{ masterId: 'm1', name: '架空 一郎', careLevel: lv, room: '101' }] });
  /* hold: マスタが先に次の予約の介護度に変わっても、切替日までは今の介護度 */
  B.DB = { residents: [mk({ nextPlans: [{ id: 'pl_h', from: far, careLevel: '要介護4', baseLevel: '要介護2', events: [] }] })] };
  B.mergeCommonSchedule(master('要介護4'));
  t('6-1 hold: 切替日までは今の介護度（要介護2）のまま', B.DB.residents[0].careLevel === '要介護2');
  const nh = B.csPlanLvNotice_.r1;
  t('6-2 hold: 知らせ（hold・マスタ 要介護4・予約の開始日）', !!nh && nh.kind === 'hold' && nh.master === '要介護4' && nh.from === far, nh);
  /* mismatch: 予約として作った介護度とマスタが違う → マスタに合わせて知らせる */
  B.DB = { residents: [mk({ careLevel: '要介護4', planLevel: '要介護4', planFrom: '2026-10-01' })] };
  B.mergeCommonSchedule(master('要介護2'));
  t('6-3 mismatch: マスタの介護度に合わせる（要介護2）', B.DB.residents[0].careLevel === '要介護2');
  const nm = B.csPlanLvNotice_.r1;
  t('6-4 mismatch: 知らせ（作った時の 要介護4・マスタ 要介護2）', !!nm && nm.kind === 'mismatch' && nm.planned === '要介護4' && nm.master === '要介護2', nm);
  /* 同じになったら知らせを消す */
  B.DB = { residents: [mk({ careLevel: '要介護2', planLevel: '要介護2' })] };
  B.mergeCommonSchedule(master('要介護2'));
  t('6-5 同じなら知らせを消す', !B.csPlanLvNotice_.r1);
}

group('6b. マスタの介護度が文字でない時は直す前と同じ代入（2026-11-27 データ保護の反証レビュー）');
{
  const N = makeBox(false);
  const mk = () => ({ id: 'r1', name: '架空 一郎', masterId: 'm1', careLevel: '要介護2', events: [] });
  [B, N].forEach((bx) => { bx.DB = { residents: [mk()] }; bx.mergeCommonSchedule({ residents: [{ masterId: 'm1', name: '架空 一郎', careLevel: 3, room: '101' }] }); });
  t('6b-1 部品の有無で同じ答え（数の 3 がそのまま入る＝直す前と同じ）', J(B.DB) === J(N.DB) && B.DB.residents[0].careLevel === 3, B.DB.residents[0].careLevel);
  [B, N].forEach((bx) => { bx.DB = { residents: [mk()] }; bx.mergeCommonSchedule({ residents: [{ masterId: 'm1', name: '架空 一郎', careLevel: null, room: '101' }] }); });
  t('6b-2 null の時も部品の有無で同じ（今の値のまま）', J(B.DB) === J(N.DB) && B.DB.residents[0].careLevel === '要介護2');
}

group('7. 予約だけ直した時も「最後に直した人」が動く');
{
  B.DB = { residents: [resBase()] };
  B.csEditBaseline_();
  t('7-1 何も変えなければ印は付かない', B.csStampEdits_() === 0 && !B.DB.residents[0].editedBy);
  B.DB.residents[0].nextPlans[0].note = '架空の直し';
  t('7-2 予約のメモだけ直した → 直した人の印が付く', B.csStampEdits_() === 1 && B.DB.residents[0].editedBy === '架空 花子');
  B.csEditBaseline_();
  B.DB.residents[0].planGone = [{ id: 'pl_q', at: '2026-11-27T00:00:00.000Z' }];
  t('7-3 取り消した印だけ変えた → 印が付く', B.csStampEdits_() === 1);
}

group('8. 決まりの変更（2026-11-27 反証レビュー B2・B3）');
{
  /* B2: 世代が違う統合でも予約は両方の和 − 両方の planGone */
  const base0 = { id: 'r1', name: '架空 一郎', careLevel: '要介護2', masterId: 'm1', events: [ev('e1', 1, '09:00', '09:30')], planGen: 0, planFrom: '',
    nextPlans: [{ id: 'pl_a', from: '2026-12-01', careLevel: '要介護3', baseLevel: '要介護2', note: '', events: [ev('e1', 1, '09:00', '10:00')], updatedAt: '2026-11-01T00:00:00.000Z' }] };
  const server = C.applyDue(cp(base0), '2026-12-01').res;
  const mine = cp(base0); mine.nextPlans.push({ id: 'pl_b', from: '2027-02-01', careLevel: '要介護4', baseLevel: '要介護2', note: '', events: [], updatedAt: '2026-11-25T00:00:00.000Z' });
  B.CS_FIELD_BASE = null; delete B.__store.cs_field_base_v1; B.csFieldBaseSet_(B.csFieldBaseBuild_(db(base0)));
  const o1 = B.csRebaseEdits(db(server), db(mine)).residents[0];
  t('8-1 サーバー gen1（予約なし）× 自分 gen0 [切替済み pl_a・新しい pl_b] → pl_b だけ残る（予定はサーバーの新しい計画）', o1.nextPlans.map((p) => p.id).join(',') === 'pl_b' && o1.planGen === 1 && o1.events[0].endTime === '10:00', o1.nextPlans.map((p) => p.id));
  const mo = B.csMergeEventsFrom_(db(server), db(mine)).residents[0];
  t('8-2 他タブの取り込みでも同じ（pl_b が残り pl_a は生き返らない）', mo.nextPlans.map((p) => p.id).join(',') === 'pl_b');
  const sv = cp(base0); sv.nextPlans.push({ id: 'pl_s', from: '2027-03-01', careLevel: '要介護1', baseLevel: '要介護2', note: '', events: [], updatedAt: '2026-11-20T00:00:00.000Z' });
  const mineSw = C.applyDue(cp(base0), '2026-12-01').res;   /* 自分が「今すぐ切り替える」で世代を上げた */
  const o2 = B.csRebaseEdits(db(sv), db(mineSw)).residents[0];
  t('8-3 自分が切り替えて世代を上げた × サーバーにほかの端末の予約 pl_s → pl_s が残る・自分の計画', o2.nextPlans.map((p) => p.id).join(',') === 'pl_s' && o2.planGen === 1 && o2.careLevel === '要介護3', o2.nextPlans.map((p) => p.id));
  t('8-4 「今すぐ切り替える」の applyDue は使った予約を planGone に載せる', mineSw.planGone.some((g) => g.id === 'pl_a' && g.at === '2026-12-01'));

  /* B3: 捨てた件数は削除・入浴だけの違いも数える */
  const old = { id: 'r1', name: '架空 一郎', careLevel: '要介護2', events: [ev('e1', 1, '09:00', '09:30'), ev('e2', 3, '14:00', '14:30')], planGen: 1, planFrom: '2026-04-01',
    nextPlans: [{ id: 'pl_k', from: '2026-12-01', careLevel: '', baseLevel: '', note: '', events: [ev('e1', 1, '09:00', '09:30'), ev('e2', 3, '14:00', '14:30'), ev('e3', 5, '10:00', '10:30')], updatedAt: '2026-11-01T00:00:00.000Z' }] };
  const srv = C.applyDue(cp(old), '2026-12-01').res;
  B.CS_FIELD_BASE = null; delete B.__store.cs_field_base_v1; B.csFieldBaseSet_(B.csFieldBaseBuild_(db(old)));
  const del = cp(old); del.events = del.events.filter((e) => e.id !== 'e2');
  B.SYNC._dirty = true;
  B.csRebaseEdits(db(srv), db(del));
  t('8-5 削除だけの未送信（e2 を消した）も数える（1件）', B.csPlanDropped_ === 1, B.csPlanDropped_);
  const bath = cp(old); bath.events[0].bathing = true;
  B.csRebaseEdits(db(srv), db(bath));
  t('8-6 入浴だけの未送信も数える（1件・入浴は土台に無いので未送信の印で決める）', B.csPlanDropped_ === 1, B.csPlanDropped_);
  B.SYNC._dirty = false;
  B.csRebaseEdits(db(srv), db(bath));
  t('8-7 （対照）未送信の印が無ければ入浴だけの違いは数えない', B.csPlanDropped_ === 0);
  B.csRebaseEdits(db(srv), db(cp(old)));
  t('8-8 （対照）切り替わっただけ（自分は何もしていない）は0件', B.csPlanDropped_ === 0);
}

process.stdout.write('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────\n');
process.exit(ng ? 1 : 0);
