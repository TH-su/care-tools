/* 体重管理「食事形態の表示名」を施設情報（facility-profile.json の mealForms）から読む試験（2026-11-02 便8 新設）
   実行: node check/unit/weight_facility_test.js
        （WEIGHT_HTML で対象ファイルを差し替えられる＝直す前の版・条件を抜いた版を試す時に使う）

   何を守るか:
     A 施設情報に mealForms が無い時（部品が無い・読み口が無い・null・例外）は、今の既定の名前と一字一句同じ。量・印も同じ
     B 偽の塊（架空の名前）を書くと、書いた印の名前だけ差し替わる。v（保存の印）・min・max・step・def・旧い値の表示（LEGACY_*）は変わらない。
       main・side はそれぞれ省略してよい（省略した方は既定）
     C 崩れた塊（知らない印・空・空白だけ・8字を超える・文字でない値・塊でない main/side・同じ組の中で名前が重なる）は、その方だけ全部既定に戻る（もう一方は効く）
     D 施設情報から消えたら既定へ戻る（毎回既定から組む）
     E 画面に出す所（選択肢のボタン・一覧・履歴・アラート・入力画面の食事）で名前が escapeHtml を通る
     F 施設情報が後から届いた時、名前が変わった時だけ、選択肢の文字（textContent）と今の画面を描き直す。変わらなければ何もしない
   ★公開リポジトリの試験。名前・氏名は全て架空（見本）にすること。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const W = fs.readFileSync(process.env.WEIGHT_HTML || path.join(ROOT, 'weight-record.html'), 'utf8');

/* ── 切り出し（xss_weight_record_test.js と同じ方式）── */
function scanBlock(src, from, open, close) {
  open = open || '{'; close = close || '}';
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
  const m = new RegExp('\\n[ \\t]*function ' + name.replace(/\$/g, '\\$') + '\\(').exec(src);
  if (!m) throw new Error('関数が見つかりません: ' + name);
  const pe = scanBlock(src, m.index + m[0].length - 1, '(', ')');
  const end = pe < 0 ? -1 : scanBlock(src, pe);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
function grabConst(src, name) {
  const m = new RegExp('\\n(?:const|let|var) ' + name + '\\s*=').exec(src);
  if (!m) throw new Error('定数が見つかりません: ' + name);
  let d = 0, q = null;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) return src.slice(m.index, i + 1);
  }
  throw new Error('定数の終わりが見つかりません: ' + name);
}
function grabLine(src, re) { const m = re.exec(src); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }
/* 施設情報が届いた時の登録（if(... SUFacility.onReady(()=>{ … });）の文 */
function grabOnReady(src) {
  const fnAt = src.indexOf('\nfunction wrApplyMealForms_(');
  const at = fnAt < 0 ? -1 : src.indexOf('SUFacility.onReady(()=>{', fnAt);
  if (at < 0) throw new Error('施設情報が届いた時の描き直しが見つかりません');
  const st = src.lastIndexOf('\n', at) + 1;
  const pe = scanBlock(src, src.indexOf('(', at), '(', ')');
  if (pe < 0) throw new Error('描き直しの終わりが見つかりません');
  return src.slice(st, pe + 2);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(String(info).slice(0, 400)))); }
}
function eq(name, got, want) { const g = JSON.stringify(got), w = JSON.stringify(want); t(name, g === w, '期待 ' + w + ' / 実際 ' + g); }

const EVIL = '<img src=x onerror=alert(1)>';
const unsafe = (h) => /<img\b/i.test(h) || /<script\b/i.test(h);
const SHORT_EVIL = '<b>x</b>';   /* 8字以内の悪い形（確かめの規則を通る） */
const kept = (h) => h.includes('&lt;img src=x onerror=alert(1)&gt;');

/* ── 偽の画面（xss_weight_record_test.js と同じ形）── */
function fakeEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), innerHTML: '', textContent: '', value: '', className: '', id: '', type: '',
    hidden: false, disabled: false, checked: false, scrollTop: 0, scrollLeft: 0, scrollWidth: 0, offsetWidth: 0, offsetHeight: 0,
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {}, appendChild(c) { this.children.push(c); return c; }, remove() {}, focus() {},
    querySelector() { return fakeEl('div'); }, querySelectorAll() { return this.children.filter((c) => c.dataset && c.dataset.v); }, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
}
function allHtml(e) { return e ? (e.innerHTML || '') + (e.children || []).map(allHtml).join('') : ''; }
const els = {};
const $ = (s) => (els[s] = els[s] || fakeEl('div'));
const fakeDocument = {
  createElement: fakeEl, createDocumentFragment: () => fakeEl('frag'), createTextNode: (s) => ({ textContent: String(s), children: [] }),
  getElementById: (id) => $('#' + id), querySelector: (s) => $(s), querySelectorAll: () => [],
  head: fakeEl('head'), body: fakeEl('body'), documentElement: fakeEl('html'), scripts: []
};
const box = {
  document: fakeDocument, $, $$: () => [], console: { log() {}, warn() {}, error() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout() { return 0; }, clearTimeout() {}, innerWidth: 1280, innerHeight: 800, getComputedStyle: () => ({ position: 'static' }),
  toast() {}, saveUI() {}, goto() {}, openResident() {}, openIndivFor() {}, openGrid3y() {}, applyStickyTopOffset() {},
  wrDropMasterPending() {}, wrSyncDeny() { return false; }, wrFieldDeny() { return false; }, saveThr() {}, apiPush() {},
  updateAlertBadge() {}, wrPaintMissingCount() {}, loadRecordIntoForm() {}, deleteRecordById() {}, wrSetAck() {}, wrWho_() { return ''; },
  _ensurePrintSheetStyle() {}, closePrintSheet() {}, setStapleAmountUI() {}, setMdStapleAmountUI() {},
  inStaple: null, inSide: null, mdStaple: null, mdSide: null
};
box.window = box;
vm.createContext(box);

/* 画面の本物の定数・関数を組む。直す前の版には新しい関数が無いので、無い物は落として先へ進む（無いこと自体を不合格に数える） */
const base = [
  'var DB = { residents: [], records: [] }; var UI = {};',
  'var listMonth = "2026-10", listSearch = "", listFilter = "all", gridMonth = "2026-10", alFilter = "all";',
  'var inMode = "normal", editingRecordId = null, wrSkippedMaster = [], wrGridScrolledFor = null, wrGridMenuAt = 0;',
  'var mdChairLog = [], mdChairAuto = null, wrShowNonTargets = false;',
  grabLine(W, /function escapeHtml\(s\)\{[^\n]*\}/),
  grabConst(W, 'DEFAULT_THR'), grabFn(W, 'cloneThr'), 'var THR = cloneThr(DEFAULT_THR);', grabConst(W, 'THR_ROWS'),
  grabConst(W, 'MAIN_FORMS'), grabConst(W, 'SIDE_FORMS'), grabConst(W, 'LEGACY_MAIN'), grabConst(W, 'LEGACY_SIDE'),
  grabConst(W, 'mainMap'), grabConst(W, 'sideMap'), grabConst(W, 'mainLabel'), grabConst(W, 'sideLabel'), grabConst(W, 'TOGGLES'),
  grabConst(W, 'ymNow'), grabConst(W, 'dNow'), grabConst(W, 'ymPrev'), grabConst(W, 'ymFmt'),
  grabConst(W, 'WR_ACK_ACTIONS'), grabConst(W, 'WR_HIST_LABEL'),
  ...['bmiOf', 'bmiCat', 'wrYmOk', 'wrWeightOk', '_toSafeStr', '_toYearMonth', '_toIsoDate', 'normalizeRecord', 'normalizeResident',
      'isDischarged', 'isWeightTarget', 'residentById', 'sortedResidents', 'getRecordsOf', 'getAllRecordsOf', 'getRecord', 'getRecordById',
      'getRecordByDate', 'getLatestRecordAny', 'getLatestRecordBefore', 'wrCmpNote', 'wrCmpLabel', 'analyze', 'alertDir', 'wrAlertDirs',
      'wrNutritionRisk', 'wrRiskChip', 'wrSparkSvg', 'wrMissAgoHtml', 'monthSeq', 'ymGridLabel', 'prevMonthDiff', 'diffHtml',
      'wcLogClean_', 'wcKgOn_', 'wcLatestKg_', 'wrHistOf_', 'wrHistVal_', 'wrHistHtml_', '_histSortKey',
      'collectAlerts', 'wrAckMap', 'wrAckOf', 'wrAckText', 'wrHasMid', 'wrRecCountOf', 'wrLatestYmOf', 'suNormName',
      'wcLogDerived_', 'wcLogStored_', 'wcLogOf', 'recDateKey',
      'renderRuleDesc', 'renderList', 'renderInputMealDisplay', 'drawHist', 'renderAlerts', 'buildFormButtons', 'buildMdFormButtons'
     ].map((n) => grabFn(W, n))
].join('\n');
vm.runInContext(base, box);
const run = (s) => vm.runInContext(s, box);

let hasNew = true;
for (const piece of [() => grabConst(W, 'MEAL_FORM_DEF_N'), () => grabFn(W, 'wrMealFormNames_'), () => grabFn(W, 'wrApplyMealForms_')]) {
  try { run(piece()); } catch (e) { hasNew = false; t('切り出し: ' + e.message, false); }
}

/* 今の既定（この施設の画面の名前・量）。ここが変わったら落とす */
const DEF_MAIN = [
  { v: 'normal', n: '普通', min: 60, max: 240, step: 10, def: 140 },
  { v: 'twice', n: '二度炊き', min: 100, max: 300, step: 10, def: 200 },
  { v: 'full_porr', n: '全粥', min: 100, max: 400, step: 10, def: 240 },
  { v: 'mix', n: 'ミキサー食', min: 100, max: 400, step: 10, def: 240 },
];
const DEF_SIDE = [{ v: 'normal', n: '常食' }, { v: 'bite', n: '一口大' }, { v: 'chop', n: '刻み' }, { v: 'fine', n: '極刻み' }, { v: 'mix', n: 'ミキサー食' }];
const DEF_LEGACY = { main: { rice: '普通', soft_rice: '二度炊き', half_porr: '全粥', thin_porr: '全粥', mix_porr: 'ミキサー食' }, side: { rough: '刻み', soft: '極刻み', paste: 'ミキサー食' } };
const forms = () => ({ main: JSON.parse(JSON.stringify(run('MAIN_FORMS'))), side: JSON.parse(JSON.stringify(run('SIDE_FORMS'))) });
const names = () => ({ main: run('MAIN_FORMS').map((x) => x.n), side: run('SIDE_FORMS').map((x) => x.n) });
const DEF_NAMES = { main: DEF_MAIN.map((x) => x.n), side: DEF_SIDE.map((x) => x.n) };
const withN = (list, map) => list.map((x) => Object.assign({}, x, map[x.v] !== undefined ? { n: map[x.v] } : {}));

/* 施設情報の偽物。section('mealForms') が返す値を差し替える */
function setFacility(sec, opts) {
  opts = opts || {};
  if (opts.none) { delete box.SUFacility; return; }
  box.SUFacility = {
    section: opts.noSection ? undefined : (n) => { if (opts.throws) throw new Error('読めない'); return n === 'mealForms' ? (sec == null ? null : JSON.parse(JSON.stringify(sec))) : null; },
    onReady: (fn) => { box.__ready = fn; }
  };
}
function apply(sec, opts) {
  setFacility(sec, opts);
  if (!hasNew) return null;
  try { return run('wrApplyMealForms_()'); } catch (e) { return 'throw:' + e.message; }
}

/* ══ A 塊が無い時は今と同じ ══ */
console.log('\n■ A 施設情報に食事形態の名前が無い時は今の既定と同じ');
eq('A 起動直後の MAIN_FORMS は今の既定（名前・量・印）', forms().main, DEF_MAIN);
eq('A 起動直後の SIDE_FORMS は今の既定', forms().side, DEF_SIDE);
for (const [label, sec, opts] of [['部品が無い', null, { none: true }], ['読み口が無い', null, { noSection: true }], ['null', null, {}], ['例外', null, { throws: true }]]) {
  const r = apply(sec, opts);
  t('A ' + label + '：当てても変わらない（false）', r === false, r);
  eq('A ' + label + '：名前は既定', names(), DEF_NAMES);
}
eq('A 表示の名前（mainLabel/sideLabel）は既定・旧い値も既定', [run("mainLabel('normal')"), run("sideLabel('mix')"), run("mainLabel('rice')"), run("sideLabel('paste')"), run("mainLabel('nope')")],
  ['普通', 'ミキサー食', '普通', 'ミキサー食', '—']);
if (hasNew) eq('A 名前を作る関数に塊でない値を渡すと既定', ['x', 1, [], null, undefined, true].map((v) => { try { return run('wrMealFormNames_')(v); } catch (e) { return 'throw:' + e.message; } }),
  Array(6).fill({ main: Object.fromEntries(DEF_MAIN.map((x) => [x.v, x.n])), side: Object.fromEntries(DEF_SIDE.map((x) => [x.v, x.n])) }));

/* ══ B 偽の塊で差し替わる ══ */
console.log('\n■ B 偽の塊（架空の名前）で書いた印だけ差し替わる');
const FAKE = { main: { normal: '見本の主食A', twice: '見本の主食B', full_porr: '見本の主食C', mix: '見本の主食D' },
               side: { normal: '見本の副食A', bite: '見本の副食B', chop: '見本の副食C', fine: '見本の副食D', mix: '見本の副食E' } };
t('B 当てると変わった（true）', apply(FAKE) === true);
eq('B MAIN_FORMS は n だけ差し替わり、v・min・max・step・def は今のまま', forms().main, withN(DEF_MAIN, FAKE.main));
eq('B SIDE_FORMS は n だけ差し替わる', forms().side, withN(DEF_SIDE, FAKE.side));
eq('B 表示の名前も差し替わる（mainMap・sideMap は同じ物を指す）', [run("mainLabel('normal')"), run("sideLabel('fine')")], ['見本の主食A', '見本の副食D']);
eq('B 旧い値の表示（LEGACY_*）は変わらない', { main: run('LEGACY_MAIN'), side: run('LEGACY_SIDE') }, DEF_LEGACY);
eq('B 旧い値の名前は既定のまま', [run("mainLabel('rice')"), run("sideLabel('rough')")], ['普通', '刻み']);
t('B 同じ塊を2回当てても変わらない（false）', apply(FAKE) === false);
apply({ main: { twice: '見本の二度' } });
eq('B main の一部の印だけ書く→その印だけ差し替わり、side は省略＝既定', names(), { main: ['普通', '見本の二度', '全粥', 'ミキサー食'], side: DEF_NAMES.side });
apply({ side: { chop: '見本の刻み', mix: '見本のミキサー' } });
eq('B side だけ書く→main は既定', names(), { main: DEF_NAMES.main, side: ['常食', '一口大', '見本の刻み', '極刻み', '見本のミキサー'] });
apply({ main: {}, side: {} });
eq('B 空の塊 {} は差し替え0件＝既定', names(), DEF_NAMES);
apply({ main: { normal: '  見本の前後空白  ' } });
eq('B 前後の空白は落として使う', names().main[0], '見本の前後空白');
apply({ main: { normal: 'あ'.repeat(8) } });
eq('B 8字ちょうどは使える', names().main[0], 'あ'.repeat(8));
apply({ main: { normal: '二度炊き', twice: '普通' } });
eq('B 名前を入れ替えるだけ（重ならない）は使える', names().main, ['二度炊き', '普通', '全粥', 'ミキサー食']);
apply({ main: { mix: '見本の流動' }, side: { mix: '見本の流動' } });
eq('B 主食と副食の組をまたいで同じ名前は使える（組ごとに見る）', [names().main[3], names().side[4]], ['見本の流動', '見本の流動']);

/* ══ C 崩れた塊は、その方だけ全部既定 ══ */
console.log('\n■ C 崩れた塊は、その方だけ全部既定（もう一方は効く）');
const GOOD_SIDE = { normal: '見本の副食A' };
const sideApplied = ['見本の副食A', '一口大', '刻み', '極刻み', 'ミキサー食'];
const BAD_MAIN = [
  ['知らない印', { normal: '見本の主食A', rice: '見本の主食X' }],
  ['知らない印（先頭）', { zzz: '見本', normal: '見本の主食A' }],
  ['__proto__ の印', JSON.parse('{"normal":"見本の主食A","__proto__":"見本"}')],
  ['toString の印', { normal: '見本の主食A', toString: '見本' }],
  ['空の名前', { normal: '見本の主食A', twice: '' }],
  ['空白だけの名前', { normal: '見本の主食A', twice: '　 ' }],
  ['9字の名前', { normal: '見本の主食A', twice: 'あ'.repeat(9) }],
  ['13字の名前', { normal: '見本の主食A', twice: 'あ'.repeat(13) }],
  ['41字の名前', { normal: '見本の主食A', twice: 'あ'.repeat(41) }],
  ['書いた印どうしで同じ名前', { normal: '見本の主食A', twice: '見本の主食A' }],
  ['既定の名前と重なる名前', { normal: '見本の主食A', twice: '全粥' }],
  ['前後の空白を落とすと重なる名前', { normal: '見本の主食A', twice: ' 見本の主食A ' }],
  ['数の値', { normal: '見本の主食A', twice: 1 }],
  ['null の値', { normal: '見本の主食A', twice: null }],
  ['配列の値', { normal: '見本の主食A', twice: ['見本'] }],
  ['塊の値', { normal: '見本の主食A', twice: { n: '見本' } }],
  ['真偽の値', { normal: '見本の主食A', twice: true }],
];
for (const [label, m] of BAD_MAIN) {
  const r = apply({ main: m, side: GOOD_SIDE });
  t('C main に' + label + '：例外を出さない', typeof r !== 'string', r);
  eq('C main に' + label + '→ main は全部既定・side は効く', names(), { main: DEF_NAMES.main, side: sideApplied });
}
for (const [label, m] of [['null', null], ['配列', ['見本']], ['文字', '見本'], ['数', 3], ['真偽', true]]) {
  const r = apply({ main: m, side: GOOD_SIDE });
  t('C main が' + label + '：例外を出さない', typeof r !== 'string', r);
  eq('C main が' + label + '→ main は既定・side は効く', names(), { main: DEF_NAMES.main, side: sideApplied });
}
apply({ main: { normal: '見本の主食A' }, side: { normal: '見本の副食A', zzz: '見本' } });
eq('C side に知らない印→ side は全部既定・main は効く', names(), { main: ['見本の主食A', '二度炊き', '全粥', 'ミキサー食'], side: DEF_NAMES.side });
apply({ main: { normal: '見本の主食A' }, side: { bite: '常食' } });
eq('C side で既定の名前と重なる→ side は全部既定・main は効く', names(), { main: ['見本の主食A', '二度炊き', '全粥', 'ミキサー食'], side: DEF_NAMES.side });
apply({ main: { normal: '見本の主食A' }, side: null });
eq('C side が null → side は既定・main は効く', names(), { main: ['見本の主食A', '二度炊き', '全粥', 'ミキサー食'], side: DEF_NAMES.side });
eq('C 崩れても量・印は今のまま', forms().main.map((x) => [x.v, x.min, x.max, x.step, x.def]), DEF_MAIN.map((x) => [x.v, x.min, x.max, x.step, x.def]));
for (const [label, sec] of [['塊が配列', [FAKE]], ['塊が文字', 'main']]) {
  apply(sec);
  eq('C ' + label + '→ 両方既定', names(), DEF_NAMES);
}

/* ══ D 消えたら既定へ戻る ══ */
console.log('\n■ D 施設情報から消えたら既定へ戻る');
apply(FAKE);
const back = apply(null);
t('D 差し替えた後に塊が無くなると、変わった（true）', back === true, back);
eq('D 名前は既定へ戻る', names(), DEF_NAMES);
apply(FAKE);
apply({ main: { normal: '見本の主食A', rice: '見本' }, side: FAKE.side });
eq('D 差し替えた後に main が崩れると main は既定へ戻る', names(), { main: DEF_NAMES.main, side: Object.values(FAKE.side) });
apply(null);

/* ══ E 画面に出す所で escapeHtml を通る ══ */
console.log('\n■ E 名前は画面に出す所で escapeHtml を通る');
function seed() {
  const r1 = { id: 'r1', name: '架空 太郎', room: '101', heightCm: 150, stapleForm: 'normal', stapleAmount: 150, sideForm: 'bite' };
  const recs = [];
  ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((ym, i) => {
    recs.push({ id: 'x' + i, residentId: 'r1', yearMonth: ym, weight: 50 - i * 1.2, measuredOn: ym + '-05', measureMode: 'normal',
                stapleForm: 'normal', stapleAmount: 150, sideForm: 'bite', note: '' });
  });
  box.DB = { residents: [r1], records: recs };
}
const take = (sel) => { const h = allHtml(els[sel]); delete els[sel]; return h; };
function screens() {
  seed();
  const out = {};
  run('buildFormButtons')('#mfMain', run('MAIN_FORMS'), 'm'); out.btn = take('#mfMain');
  run('buildMdFormButtons')('#mdMfSide', run('SIDE_FORMS'), 's'); out.mdBtn = take('#mdMfSide');
  box.listMonth = '2026-10'; run('renderList()'); out.list = take('#listBody');
  run('drawHist')('r1'); out.hist = take('#ivHistBody');
  run('renderAlerts()'); out.alert = take('#alList');
  els['#inResident'] = Object.assign(fakeEl('select'), { value: 'r1' });
  run('renderInputMealDisplay()'); out.meal = take('#inMealTbl');
  delete els['#inResident'];
  return out;
}
apply(null);
const dflt = screens();
t('E 既定の名前のまま：選択肢のボタンに「普通」', dflt.btn.includes('普通') && dflt.btn.includes('ミキサー食'), dflt.btn);
t('E 既定の名前のまま：一覧・履歴・アラート・入力画面に「普通」「一口大」', ['list', 'hist', 'alert', 'meal'].every((k) => dflt[k].includes('普通') && dflt[k].includes('一口大')),
  JSON.stringify(dflt).slice(0, 300));
/* 名前に悪い値を入れる（この値は28字で確かめの規則では弾かれるが、出す所の守りを別に見るため）。直す前の版では関数が無いので、ここでは直接 n を差し替える */
run('MAIN_FORMS').forEach((x) => { x.n = EVIL; });
run('SIDE_FORMS').forEach((x) => { x.n = EVIL; });
const evil = screens();
for (const [k, label] of [['btn', '選択肢のボタン（入力画面）'], ['mdBtn', '選択肢のボタン（入居者の食事の窓）'], ['list', '一覧'], ['hist', '履歴'], ['alert', 'アラート'], ['meal', '入力画面の食事']]) {
  t('E ' + label + '：名前に入れても実行される形にならず、文字として残る', !unsafe(evil[k]) && kept(evil[k]), evil[k]);
}
apply(null);
eq('E 当て直すと名前は既定へ戻る', names(), DEF_NAMES);

/* ══ F 施設情報が後から届いた時 ══ */
console.log('\n■ F 施設情報が後から届いた時の描き直し');
let onReadySrc = null;
try { onReadySrc = grabOnReady(W); } catch (e) { t('F 切り出し: ' + e.message, false); }
if (onReadySrc && hasNew) {
  const calls = [];
  const saved = {};
  for (const n of ['renderList', 'renderIndiv', 'renderAlerts', 'renderInputMealDisplay']) { saved[n] = box[n]; box[n] = () => calls.push(n); }
  const mkBtns = (list) => { const c = fakeEl('div'); list.forEach((x) => { const b = fakeEl('button'); b.dataset.v = x.v; b.textContent = x.n; c.children.push(b); }); return c; };
  function arm(sc) {
    calls.length = 0;
    els['#mfMain'] = mkBtns(DEF_MAIN); els['#mdMfMain'] = mkBtns(DEF_MAIN);
    els['#mfSide'] = mkBtns(DEF_SIDE); els['#mdMfSide'] = mkBtns(DEF_SIDE);
    els['.scr.on'] = Object.assign(fakeEl('section'), { dataset: { sc } });
  }
  const btnText = (sel) => els[sel].children.map((b) => b.textContent);
  setFacility(null);
  box.__ready = null;
  run(onReadySrc);
  t('F 施設情報の部品に「届いたら呼ぶ」を登録する', typeof box.__ready === 'function');
  arm('list');
  box.__ready();
  eq('F 名前が変わらない時は何も描き直さない', calls, []);
  eq('F 名前が変わらない時は選択肢の文字も触らない', btnText('#mfMain'), DEF_NAMES.main);
  setFacility(FAKE);
  arm('list');
  box.__ready();
  eq('F 名前が変わった時：入力画面の選択肢の文字が変わる', [btnText('#mfMain'), btnText('#mfSide')], [Object.values(FAKE.main), Object.values(FAKE.side)]);
  eq('F 名前が変わった時：入居者の食事の窓の選択肢の文字も変わる', [btnText('#mdMfMain'), btnText('#mdMfSide')], [Object.values(FAKE.main), Object.values(FAKE.side)]);
  eq('F 一覧を開いている時は一覧と入力画面の食事を描き直す', calls, ['renderList', 'renderInputMealDisplay']);
  setFacility(null);
  arm('alert');
  box.__ready();
  eq('F アラートを開いている時はアラートを描き直す（既定へ戻る）', calls, ['renderAlerts', 'renderInputMealDisplay']);
  eq('F 既定へ戻った時は選択肢の文字も既定', btnText('#mfMain'), DEF_NAMES.main);
  setFacility({ main: { normal: SHORT_EVIL } });
  arm('indiv');
  box.__ready();
  eq('F 個別を開いている時は個別を描き直す', calls, ['renderIndiv', 'renderInputMealDisplay']);
  t('F 選択肢の文字は textContent で入れる（innerHTML は空のまま）', btnText('#mfMain')[0] === SHORT_EVIL && els['#mfMain'].children[0].innerHTML === '');
  setFacility(null); box.__ready();
  for (const n of Object.keys(saved)) box[n] = saved[n];
  delete els['.scr.on'];
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
