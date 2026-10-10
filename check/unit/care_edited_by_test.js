/* 週間計画（care-schedule.html）── 入居者ごとの「週間計画で最後に直した人・日時」の試験（2026-10-10 新設・監査10月版 第2版 7）
   実行: node check/unit/care_edited_by_test.js

   守ること:
     ①保存のたびに、この端末が最後に保存・読込した姿と見比べ、変わった利用者だけに editedBy・editedAt を付ける
     ②付けない: 単位数（ev.units）だけの変化・印そのものの違い・予定の並び順だけの違い・基準が無い時
     ③保存の出口では、別タブの取り込みより前に見る（相手の変更を自分が直したことにしない）。
       取得・取り込み（saveLocalOnly）と読込（loadDB）は基準を取り直すだけで印を付けない
     ④競合の解消（csRebaseEdits・csMergeEventsFrom_）では、2項目を組で新しい方を採る
     ⑤誰が＝ログイン中ならアカウント、ログアウト・未ログインは「事務所PC」、確かめられない時は前のまま
     ⑥ワークスケジュール（masterToCareDb）・デイ利用表（dcrOverlayMaster・applyPendingFlag_）が書いても項目が消えない
   ★氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');
const WS = fs.readFileSync(path.join(ROOT, 'work-schedule.html'), 'utf8');
const DCR = fs.readFileSync(path.join(ROOT, 'daycare-roster.html'), 'utf8');

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
function grabFn(src, name) {
  const m = new RegExp('\\n[ \\t]*function ' + name + '\\(').exec(src);
  if (!m) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(src, m.index, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
function lineOf(src, re) {
  const m = re.exec(src);
  if (!m) throw new Error('行が見つかりません: ' + re);
  return m[0].replace(/^(?:const|let)\s/, 'var ');
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

function makeBox(extra) {
  const store = {};
  const box = Object.assign({
    DB: { residents: [] },
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    window: {}, document: { scripts: [] }, console, setTimeout, Promise, Date, JSON, Object, String, Array, isNaN
  }, extra || {});
  vm.createContext(box);
  const code = [
    lineOf(SRC, /var csEditBase_ = [^\n]*/),
    lineOf(SRC, /var CS_SESSION_KEY = [^\n]*/),
    lineOf(SRC, /var csWhoAcct_ = [^\n]*/),
    lineOf(SRC, /var csWhoGen_ = [^\n]*/),
    lineOf(SRC, /var csBathRestored_ = [^\n]*/),
    'var csFieldsKept_ = 0; var csFieldChanges_ = [];',
    ['csEditFp_', 'csEditBaseline_', 'csStampEdits_', 'csTakeNewerEdit_', 'csEditedText_',
     'csWho_', 'csWhoLabel_', 'csAuthLoad_', 'csResolveWho_', 'csRebaseEdits', 'csMergeEventsFrom_'].map(n => grabFn(SRC, n)).join('\n')
  ].join('\n');
  vm.runInContext(code, box);
  return box;
}
function res(id, name, events, extra) {
  return Object.assign({ id, name, careLevel: '要介護2', events: events || [] }, extra || {});
}
function ev(id, extra) { return Object.assign({ id, dayOfWeek: 1, startTime: '10:00', endTime: '10:30', category: '身体1', detail: '入浴介助', units: 250 }, extra || {}); }
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

console.log('\n— 1. 保存の時に、変わった利用者だけに印を付ける —');
{
  const b = makeBox();
  b.DB.residents = [res('r1', '架空 一郎', [ev('e1')]), res('r2', '架空 花子', [ev('e2')])];
  let n = b.csStampEdits_();
  t('基準が無い時は印を付けない（全員に付くのを防ぐ）・基準だけ取る', n === 0 && !b.DB.residents[0].editedAt && b.csEditBase_ && b.csEditBase_.r1, n);
  b.DB.residents[0].events[0].detail = '入浴介助（シャワー浴）';
  n = b.csStampEdits_();
  const r1 = b.DB.residents[0], r2 = b.DB.residents[1];
  t('予定の中身を直した利用者だけに印が付く', n === 1 && r1.editedBy === '事務所PC' && ISO.test(r1.editedAt) && !r2.editedAt, [n, r1.editedBy, r1.editedAt, r2.editedAt]);
  b.csEditBaseline_();
  b.DB.residents[1].careLevel = '要介護3';
  b.csStampEdits_();
  t('利用者直下の項目（介護度）を直しても付く', !!b.DB.residents[1].editedAt, b.DB.residents[1]);
  b.csEditBaseline_();
  b.DB.residents[1].events.push(ev('e3', { dayOfWeek: 3 }));
  b.csStampEdits_();
  const at2 = b.DB.residents[1].editedAt;
  t('予定を足しても付く', !!at2, at2);
}
{
  const b = makeBox();
  b.DB.residents = [res('r1', '架空 一郎', [ev('e1'), ev('e2', { dayOfWeek: 2 })])];
  b.csEditBaseline_();
  b.DB.residents[0].events[0].units = 999;
  t('単位数（ev.units）だけの変化では付かない', b.csStampEdits_() === 0 && !b.DB.residents[0].editedAt, b.DB.residents[0]);
  b.DB.residents[0].events.reverse();
  t('予定の並び順だけの違いでは付かない', b.csStampEdits_() === 0, '');
  b.DB.residents[0].editedBy = '別の人'; b.DB.residents[0].editedAt = '2026-10-01T00:00:00.000Z';
  t('印そのもの（editedBy・editedAt）の違いでは付かない（付けるたびに付け直さない）', b.csStampEdits_() === 0 && b.DB.residents[0].editedBy === '別の人', b.DB.residents[0]);
  b.DB.residents.push(res('r9', '架空 次郎', []));
  b.csStampEdits_();
  t('新しく足した利用者にも付く', !!b.DB.residents[1].editedAt, b.DB.residents[1]);
  b.csWhoAcct_ = 'staff-a';
  b.csEditBaseline_();
  b.DB.residents[0].room = '201';
  b.csStampEdits_();
  t('ログイン中はアカウントの名前で付く', b.DB.residents[0].editedBy === 'staff-a', b.DB.residents[0].editedBy);
}

console.log('\n— 2. 保存の出口の順番と、印を付けない経路 —');
{
  const body = n => grabFn(SRC, n);
  const sdb = body('saveDB');
  const iSim = sdb.indexOf('if (SIM_ON)'), iStamp = sdb.indexOf('csStampEdits_()'), iAbs = sdb.indexOf('csAbsorbForeignWrite_()');
  t('saveDB: 試算の早期終了より後・別タブの取り込みより前に印を付ける', iSim >= 0 && iStamp > iSim && iAbs > iStamp, [iSim, iStamp, iAbs]);
  t('saveDB: 書けたと確かめた後で基準を取り直す', /if \(verify === json\) \{ csRememberLocalFp_\(json\); try \{ csEditBaseline_\(\);/.test(sdb), '');
  const slo = body('saveLocalOnly');
  t('saveLocalOnly（取得・取り込み）: 基準を取り直し、印は付けない', slo.indexOf('csEditBaseline_()') > 0 && slo.indexOf('csStampEdits_') < 0, '');
  t('loadDB: 読み込んだ姿を基準にする', body('loadDB').indexOf('csEditBaseline_()') > 0, '');
  t('利用者の段の注記に出す（textContent＝文字として入れる）', /edEl\.textContent = csEditedText_\(res\);/.test(body('renderSummaryBar')), '');
  t('印刷では利用者の段（.summary-bar）ごと出さない', /\.summary-bar \{ display: none !important; \}/.test(SRC) && SRC.indexOf('id="cs-edited-note"') > SRC.indexOf('class="summary-bar'), '');
}

console.log('\n— 3. 競合の解消では、直した人・日時の新しい方を採る —');
{
  const b = makeBox();
  const server = { residents: [res('r1', '架空 一郎', [ev('e1')], { editedBy: 'staff-b', editedAt: '2026-10-10T01:00:00.000Z' }),
                               res('r2', '架空 花子', [ev('e2')], { editedBy: 'staff-b', editedAt: '2026-10-10T05:00:00.000Z' }),
                               res('r3', '架空 三郎', [ev('e3')], { editedBy: 'staff-b', editedAt: '2026-10-10T02:00:00.000Z' })] };
  const mine = { residents: [res('r1', '架空 一郎', [ev('e1', { detail: '更衣' })], { editedBy: 'staff-a', editedAt: '2026-10-10T03:00:00.000Z' }),
                             res('r2', '架空 花子', [ev('e2')], { editedBy: 'staff-a', editedAt: '2026-10-10T04:00:00.000Z' }),
                             res('r3', '架空 三郎', [ev('e3')])] };
  const out = b.csRebaseEdits(server, mine);
  const by = id => out.residents.find(r => r.id === id);
  t('csRebaseEdits: 自分の方が新しければ自分の印', by('r1').editedBy === 'staff-a' && by('r1').editedAt === '2026-10-10T03:00:00.000Z', by('r1'));
  t('csRebaseEdits: 相手の方が新しければ相手の印', by('r2').editedBy === 'staff-b' && by('r2').editedAt === '2026-10-10T05:00:00.000Z', by('r2'));
  t('csRebaseEdits: 自分に印が無ければ相手の印を残す', by('r3').editedBy === 'staff-b', by('r3'));
  t('csRebaseEdits: 予定は従来どおり自分の編集が残る', by('r1').events[0].detail === '更衣', by('r1').events[0]);
  const m2 = b.csMergeEventsFrom_(server, mine);
  const by2 = id => m2.residents.find(r => r.id === id);
  t('csMergeEventsFrom_（別タブの取り込み）: 相手の方が新しければ相手の印', by2('r2').editedBy === 'staff-b' && by2('r1').editedBy === 'staff-a' && by2('r3').editedBy === 'staff-b', [by2('r1'), by2('r2'), by2('r3')]);
}

console.log('\n— 4. 表示の文 —');
{
  const b = makeBox();
  const d = new Date(2026, 9, 10, 9, 5);
  const s = b.csEditedText_({ editedBy: 'staff-a', editedAt: d.toISOString() });
  t('「週間計画で最後に直した人：誰（月/日 時:分）」', s === '週間計画で最後に直した人：staff-a（10/10 09:05）', s);
  t('印が無い・日時が壊れている時は空（枠ごと出ない）', b.csEditedText_({}) === '' && b.csEditedText_({ editedAt: 'x' }) === '' && b.csEditedText_(null) === '', '');
  t('誰が空なら「不明」', b.csEditedText_({ editedAt: d.toISOString() }).indexOf('不明') > 0, '');
}

console.log('\n— 5. 誰が（ログイン・ログアウト・確かめられない時）—');
(async () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function run(sessionVal, check, pre) {
    const resolvers = [];
    const b = makeBox();
    b.window.SUAuth = { check: () => (check === 'pending' ? new Promise(r => { resolvers.push(r); }) : Promise.resolve(check)) };
    b.SUAuth = b.window.SUAuth;
    if (sessionVal) b.localStorage.setItem(b.CS_SESSION_KEY, sessionVal);
    if (pre) b.csWhoAcct_ = pre;
    b.csResolveWho_();
    for (let i = 0; i < 5; i++) await tick();
    return { b, resolvers };
  }
  let r = await run('tok', { status: 'ok', email: 'staff-a@example.test', label: '' });
  t('ログイン中＝アカウント（@ より前）', r.b.csWho_() === 'staff-a', r.b.csWho_());
  r = await run(null, null, 'staff-a');
  t('ログアウト（控えが無い）＝「事務所PC」へ戻す', r.b.csWho_() === '事務所PC', r.b.csWho_());
  r = await run('tok', { status: 'error' }, 'staff-a');
  t('通信で確かめられない時は前の名前のまま', r.b.csWho_() === 'staff-a', r.b.csWho_());
  r = await run('tok', { status: 'denied', email: 'x@example.test' }, 'staff-a');
  t('許可リスト外は「事務所PC」', r.b.csWho_() === '事務所PC', r.b.csWho_());
  r = await run('tok', 'pending');
  r.b.csResolveWho_();   // もう一度呼ぶ＝世代が進む
  for (let i = 0; i < 5; i++) await tick();
  r.resolvers[0]({ status: 'ok', email: 'old@example.test' });
  for (let i = 0; i < 5; i++) await tick();
  const afterOld = r.b.csWho_();
  r.resolvers[1]({ status: 'ok', email: 'staff-new@example.test' });
  for (let i = 0; i < 5; i++) await tick();
  t('遅れて届いた古い確認の結果は捨て、新しい確認の結果を採る（世代番号）', r.resolvers.length === 2 && afterOld === '事務所PC' && r.b.csWho_() === 'staff-new', [r.resolvers.length, afterOld, r.b.csWho_()]);
  t('起動時と storage・visibilitychange で取り直す', /csResolveWho_\(\);[\s\S]{0,40}\n[^\n]*addEventListener\('storage'[^\n]*CS_SESSION_KEY[^\n]*csResolveWho_\(\)[^\n]*\n[^\n]*visibilitychange[^\n]*csResolveWho_\(\)/.test(SRC), '');

  console.log('\n— 6. ほかの書き手が項目を消さない —');
  {
    const box = { M: { genId: p => p + '_new' }, console };
    vm.createContext(box);
    vm.runInContext(lineOf(WS, /var DOW_KEYS = [^\n]*/) + '\n' + grabFn(WS, 'masterVisitNames_') + '\n' + grabFn(WS, 'masterToCareDb'), box);
    const existing = { residents: [res('r1', '架空 一郎', [ev('e1', { serviceType: 'visit' })], { editedBy: 'staff-a', editedAt: '2026-10-10T03:00:00.000Z' })] };
    const master = { weekdays: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } };
    let out = null, err = null;
    try { out = box.masterToCareDb(master, existing); } catch (e) { err = e.message; }
    const r1 = out && out.residents.find(x => x.id === 'r1');
    t('ワークスケジュール（masterToCareDb）: 直した人・日時が残る', !!r1 && r1.editedBy === 'staff-a' && r1.editedAt === '2026-10-10T03:00:00.000Z', err || r1);
  }
  {
    const box = { dcrHospMap: { m1: true }, dcrVmedMap: null, dcrRoomMap: null, console };
    vm.createContext(box);
    vm.runInContext(grabFn(DCR, 'dcrOverlayMaster'), box);
    const db = { residents: [res('r1', '架空 一郎', [], { masterId: 'm1', hospitalized: false, editedBy: 'staff-a', editedAt: '2026-10-10T03:00:00.000Z' })] };
    let out = null, err = null;
    try { out = box.dcrOverlayMaster(db); } catch (e) { err = e.message; }
    const r1 = out && out.residents[0];
    t('デイ利用表（dcrOverlayMaster の写し）: 直した人・日時が残る', !!r1 && r1.hospitalized === true && r1.editedBy === 'staff-a' && r1.editedAt === '2026-10-10T03:00:00.000Z', err || r1);
  }
  {
    const box = { console };
    vm.createContext(box);
    vm.runInContext('function findServerResident_(rs, p){ return rs.find(r => r.id === p.id) || null; }\nfunction dcrAddLog_(){}\n' + grabFn(DCR, 'applyPendingFlag_'), box);
    const residents = [res('r1', '架空 一郎', [], { editedBy: 'staff-a', editedAt: '2026-10-10T03:00:00.000Z' })];
    box.applyPendingFlag_(residents, { id: 'r1', field: 'dcrBathOff', value: true, logs: [] });
    const snap = JSON.parse(JSON.stringify({ residents }));
    t('デイ利用表（applyPendingFlag_ → 送る写し）: 直した人・日時が残る', snap.residents[0].editedBy === 'staff-a' && snap.residents[0].dcrBathOff === true, snap.residents[0]);
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
