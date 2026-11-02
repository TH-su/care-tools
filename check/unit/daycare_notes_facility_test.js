/* デイ利用表の昼食場所・デイの場所の呼び名を施設情報（facility-profile.json の daycareNotes）から差し替える試験（2026-11-02 新設・品質改善 第3期 便10）
   実行: node check/unit/daycare_notes_facility_test.js
        （DCR_HTML で対象ファイルを差し替えられる＝直す前の版・条件を抜いた版を試す時に使う）

   何を守るか:
     1. 塊が無い・読む前・部品が無い・section の無い部品の時は、今の文字と一字一句同じ
        （デイ休み（２階で昼食）・２階合計・週間名簿の見出し ２階・備考の「…利用者分は1階へ」「それ以外は2階へ」・
         薬用の備考・凡例2つ・訪問診療の案内の「２階ホール」）。訪問診療の案内（HTML に書いた文）には触らない
     2. daycareNotes が { lunchPlace, dayPlace } で、どちらも1〜4字の時だけ、上の各所の呼び名だけが替わる（文の組み立ては替えない）
     3. 崩れた塊（知らないキー・1つ欠け・文字でない・5字・空・空白だけ・前後の空白・改行・{ }・配列・文字の塊・例外）は塊ごと捨てて既定
     4. 施設情報が後から届いて呼び名が変わった時だけ1回描き直す（階の名前と同じ控え dcrFloorSig_ に入る）
     5. 居室の階（floors・便8）と昼食場所は別々に替わる（片方を替えても、もう片方は既定のまま）
   ★画面の本物の関数（dcrDaycareNotes_・dcrFill・renderDaylist・weeklyTable・renderLegend ほか）と本物の su-facility.js を vm で動かす。
     偽物にするのは document（要素の入れ物）・表の幅の採寸・枠線の仕上げだけ。呼び名・利用者は架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = fs.readFileSync(process.env.DCR_HTML || path.join(ROOT, 'daycare-roster.html'), 'utf8');
const FAC_SRC = read('su-facility.js');
const SAMPLE = JSON.parse(read('facility-profile.sample.json'));

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
const J = JSON.stringify;
function done() {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
}

/* ── 切り出し（daycare_facility_test.js と同じ方式：文字列・コメントを飛ばして括弧の対を数える）── */
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
  const start = SRC.indexOf('\nfunction ' + name + '(');
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
    return SRC.slice(m.index, j + 1).replace(/^(?:const|let)\s/, 'var ');
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol < 0 ? SRC.length : eol).replace(/^(?:const|let)\s/, 'var ');
}

/* ── 偽の document（要素の入れ物だけ）── */
function makeEl(tag) {
  const n = {
    tag, className: '', children: [], dataset: {}, style: { setProperty() {} }, title: '', rowSpan: 1, colSpan: 1, _t: '',
    appendChild(c) { n.children.push(c); return c; },
    setAttribute() {},
    classList: { add(c) { n.className = (n.className ? n.className + ' ' : '') + c; }, toggle() {}, contains: c => (' ' + n.className + ' ').indexOf(' ' + c + ' ') >= 0 },
    querySelectorAll: () => []
  };
  Object.defineProperty(n, 'textContent', {
    get() { return n._t + n.children.map(c => c.textContent).join(''); },
    set(v) { n._t = String(v); n.children = []; }
  });
  return n;
}
function walk(n, fn) { fn(n); (n.children || []).forEach(c => walk(c, fn)); }
function textsOf(root, cls) {
  const out = [];
  walk(root, n => { if ((' ' + (n.className || '') + ' ').indexOf(' ' + cls + ' ') >= 0) out.push(n.textContent); });
  return out;
}

/* HTML に書いた訪問診療の案内（☆ の後ろの文）。画面の DOM と同じく、☆ の span の後ろの文字の節（nodeType 3）を偽で作る */
const HTML_VISIT = (/<div class="visit-note" id="visitNoteDaylist"><span class="star">☆<\/span>([^<]*)<\/div>/.exec(SRC) || [])[1] || null;
function visitNoteEl() {
  const box = makeEl('div');
  const txt = { nodeType: 3, _v: HTML_VISIT, writes: 0 };
  Object.defineProperty(txt, 'nodeValue', { get() { return txt._v; }, set(v) { txt.writes++; txt._v = String(v); } });
  box.lastChild = txt;
  box.txt = txt;
  return box;
}

/* 本物の su-facility.js（端末の控えに profile を入れた状態で起動。profile が null なら控え無し＝読む前） */
function facility(profile) {
  const box = { console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' && profile ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(FAC_SRC, box);
  return box.SUFacility;
}
const withNotes = notes => { const p = JSON.parse(J(SAMPLE)); delete p.daycareNotes; if (notes !== undefined) p.daycareNotes = notes; return p; };
/* section('daycareNotes') がそのまま返す偽の施設情報（su-facility.js が整える前の形も試すため）。階は既定の１階・２階 */
const fakeFac = (secFn, floorsFn) => ({
  ready: () => true, onReady() {},
  floors: floorsFn || (() => [{ no: 1, label: '１階' }, { no: 2, label: '２階' }]),
  section: n => (n === 'daycareNotes' ? secFn() : null)
});

/* ── 画面の関数を1つの砂場に入れる ── */
let GRAB_ERR = null;
function makeBox(fac) {
  const els = { visitNoteDaylist: visitNoteEl() };
  const $ = id => (els[id] = els[id] || makeEl('div'));
  const calls = { render: 0 };
  const box = {
    console, JSON, String, Object, Array, Number, Math, Set, parseInt, isFinite,
    document: { createElement: makeEl, createTextNode: s => ({ textContent: String(s), children: [] }) },
    $, els, calls,
    dcrName: s => '見本' + s, dcrOfficeName: () => '見本', dcrClinicLabel_: () => '見本クリニック', frameDaylist_() {}, setRosterPrintCols_() {},
    stampPrintDate_() {}, MODEL: [], floorSrcCount: { room: 0, plan: 0 }, dupCount: 0, hiddenNowCount: 0, preAdmittedNowCount: 0, preAdmittedHiddenCount: 0,
    renderAll: () => { calls.render++; }
  };
  box.window = box;
  if (fac) box.SUFacility = fac;
  vm.createContext(box);
  vm.runInContext([
    grabDecl('DAYS_JA'), grabDecl('NDAY'), 'var DB = null;',
    grabDecl('FLOOR_ORDER'), grabDecl('FLOOR_LABEL'), grabDecl('DCR_FLOOR_NAME_MAX'), grabDecl('WK_FLR_LABEL'),
    grabDecl('dcrFloorSigUsed'),
    grabFn('dcrFloorNames_'), grabFn('dcrFloorLabel_'), grabFn('dcrFloorSecLabel_'), grabFn('dcrFloorSig_'), grabFn('dcrRefreshFloorsIfStale_'),
    grabDecl('DCR_NOTES_KEYS'), grabDecl('DCR_NOTES_WORD_MAX'), grabFn('dcrDaycareNotes_'), grabFn('dcrNotesWord_'),
    grabDecl('onDay'), grabDecl('offDay'), grabDecl('countOn'), grabDecl('countOff'), 'var TBL_W = { daylist: 1000, allweek: 1000, day: 1000 };',
    grabDecl('DCR_VISIT_NOTE'), grabDecl('DAYLIST_NOTES'), grabDecl('MED_NOTES'),
    grabFn('toMin'), grabFn('minToLabel'), grabFn('el'),
    grabFn('setupSheet').replace(/\n\s*table\.appendChild\(colgroupFor\(kind\)\);/, ''),   // 列幅の宣言（colgroup）はこの試験の外
    grabFn('dayHeaderRows'), grabFn('dayHeader'), grabFn('deiCells'), grabFn('sectionRows'), grabFn('sumRow'), grabFn('renderDaylist'),
    grabFn('weeklyByFloor'), grabFn('wkNameSpaced'), grabFn('weeklyTable'), grabFn('renderWeekly'),
    grabFn('dcrFill'), grabDecl('LEGENDS'), grabFn('renderLegend')
  ].join('\n'), box);
  return box;
}

/* 帳票タブが読む形（buildModel の結果の形）の架空の利用者。２階1名・１階1名・階未設定1名 */
function model() {
  const day = { s: 540, e: 900, bath: false };
  const p = (pid, floor, days) => ({ pid, name: '見本 ' + pid, kana: String(pid), floor, hosp: false, days, visitingMed: '' });
  return [p(1, 2, [day, null, day, null, null, null]), p(2, 1, [null, day, null, day, null, null]), p(3, 0, [day, null, null, null, null, null])];
}
/* 昼食場所・デイの場所の呼び名が出る所を全部集める */
function words(box) {
  box.renderDaylist(model());
  box.renderWeekly(model());
  const leg = sc => (box.renderLegend(sc), box.els.legend.textContent);
  return {
    title: textsOf(box.els.tblDaylist, 'cut-title'),
    sums: (() => { const o = []; walk(box.els.tblDaylist, n => { if (n.tag === 'tr' && (' ' + n.className + ' ').indexOf(' sum ') >= 0) o.push(n.children[2].textContent); }); return o; })(),   // 合計の行の最初の曜日のラベル
    notes: box.els.noteDaylist.children.map(c => c.textContent),
    med: box.MED_NOTES.map(x => box.dcrFill(x)),
    weekly: textsOf(box.els.weeklyPages, 'wk-h'),
    legDaylist: leg('sc-daylist'),
    legWeekly: leg('sc-weekly'),
    visit: box.els.visitNoteDaylist.txt.nodeValue,
    visitWrites: box.els.visitNoteDaylist.txt.writes
  };
}

/* 今の文字（直す前の版と同じ）。備考は {{通所名}} を「見本」で組んだ形 */
const NOW = {
  title: ['デイ休み（２階で昼食）'],
  sum: '２階合計',
  notes: ['備考', '★昼食後の薬', '・見本利用者分は1階へ', 'それ以外は2階へ', '分けてセットしておきます', '★祝日', '営業します',
    '★黄色で色付けしている方は入浴ありの方です', '裏側に訪問診療一覧表をつけています', '施設職員は1階の方の誘導もお願いします'],
  med: ['☆昼食後の薬', '・見本利用者分は1階へ', 'それ以外は2階へ', '分けてセットしておきます', '☆祝日', '営業します'],
  weekly: ['２階', '２階', '２階', '２階', '２階', '２階'],
  legDaylist: '黄＝入浴あり☆＝その曜日に見本クリニックの訪問診療がある方上段＝デイ利用者／下段＝デイ休み（２階で昼食）',
  legWeekly: '２階＝その日デイに行かない方（2階食堂で昼食）／☆＝同姓の方がいます（右上「同姓の目印」で設定）。印刷は6曜日を一括で6枚出します',
  visit: '印の方は２週間に一度の訪問診療がありますので、２階ホールに居ていただいてください。'
};
function sameAsNow(label, w) {
  t(label + ': デイ休みの見出しは今と同じ', J(w.title) === J(NOW.title), w.title);
  t(label + ': 合計の行は 見本合計・２階合計・昼食合計', J(w.sums) === J(['見本合計', NOW.sum, '昼食合計']), w.sums);
  t(label + ': 一覧表の備考は今と同じ（1階へ・2階へ は半角の数字のまま）', J(w.notes) === J(NOW.notes), w.notes);
  t(label + ': 薬用の備考は今と同じ', J(w.med) === J(NOW.med), w.med);
  t(label + ': 週間名簿の右列の見出しは ２階（6枚とも）', J(w.weekly) === J(NOW.weekly), w.weekly);
  t(label + ': 一覧表の凡例は今と同じ', w.legDaylist === NOW.legDaylist, w.legDaylist);
  t(label + ': 週間名簿の凡例は今と同じ（「2階食堂」は半角の数字のまま）', w.legWeekly === NOW.legWeekly, w.legWeekly);
  t(label + ': 訪問診療の案内は HTML の文のまま・書き換えない', w.visit === NOW.visit && w.visitWrites === 0, [w.visit, w.visitWrites]);
}

try {
  makeBox(null);
} catch (e) {
  GRAB_ERR = e;
}
t('画面に昼食場所の呼び名の関数（dcrDaycareNotes_・dcrNotesWord_）と既定の文がある', !GRAB_ERR, GRAB_ERR && GRAB_ERR.message);
t('HTML の訪問診療の案内が読める（試験の前提）', HTML_VISIT === NOW.visit, HTML_VISIT);
if (GRAB_ERR) done();

console.log('— 1. 塊が無い・読む前・崩れた部品の時は今と一字一句同じ —');
{
  const cases = [
    ['施設情報の部品が無い', null],
    ['部品はあるが読む前（控え無し）', facility(null)],
    ['見本の施設情報（daycareNotes を書いていない）', facility(withNotes(undefined))],
    ['section の無い古い部品', { ready: () => true, onReady() {}, floors: () => [{ no: 1, label: '１階' }, { no: 2, label: '２階' }] }]
  ];
  for (const [label, fac] of cases) {
    const box = makeBox(fac);
    t(label + ': 呼び名は無し（null）', box.dcrDaycareNotes_() === null, box.dcrDaycareNotes_());
    sameAsNow(label, words(box));
  }
  const box = makeBox(null);
  t('既定の訪問診療の案内を既定の呼び名で組むと HTML の文に戻る', box.dcrFill(box.DCR_VISIT_NOTE) === HTML_VISIT, box.dcrFill(box.DCR_VISIT_NOTE));
  t('見本の施設情報に daycareNotes の書き方の説明（_noteDaycareNotes）がある', typeof SAMPLE._noteDaycareNotes === 'string' && /lunchPlace/.test(SAMPLE._noteDaycareNotes) && /dayPlace/.test(SAMPLE._noteDaycareNotes));
  t('見本の施設情報には daycareNotes そのものは書かない（撮影・画素の見比べで見本が配られても紙が変わらない）', !Object.prototype.hasOwnProperty.call(SAMPLE, 'daycareNotes'));
}

console.log('— 2. 正しい塊だと呼び名だけが替わる —');
{
  const box = makeBox(facility(withNotes({ lunchPlace: '東館', dayPlace: '本館' })));
  t('呼び名を読む', J(box.dcrDaycareNotes_()) === J({ lunchPlace: '東館', dayPlace: '本館' }), box.dcrDaycareNotes_());
  const w = words(box);
  t('デイ休み（東館で昼食）', J(w.title) === J(['デイ休み（東館で昼食）']), w.title);
  t('東館合計（通所合計・昼食合計はそのまま）', J(w.sums) === J(['見本合計', '東館合計', '昼食合計']), w.sums);
  t('一覧表の備考は2行だけ替わる（「施設職員は1階の方の誘導」は替えない）',
    J(w.notes) === J(NOW.notes.map(s => s === '・見本利用者分は1階へ' ? '・見本利用者分は本館へ' : s === 'それ以外は2階へ' ? 'それ以外は東館へ' : s)), w.notes);
  t('薬用の備考も同じ2行だけ替わる', J(w.med) === J(['☆昼食後の薬', '・見本利用者分は本館へ', 'それ以外は東館へ', '分けてセットしておきます', '☆祝日', '営業します']), w.med);
  t('週間名簿の右列の見出しは 東館（6枚とも）', J(w.weekly) === J(Array(6).fill('東館')), w.weekly);
  t('一覧表の凡例', w.legDaylist === NOW.legDaylist.replace('（２階で昼食）', '（東館で昼食）'), w.legDaylist);
  t('週間名簿の凡例（見出しの語と「〜食堂で昼食」）', w.legWeekly === NOW.legWeekly.replace('２階＝', '東館＝').replace('2階食堂', '東館食堂'), w.legWeekly);
  t('訪問診療の案内は「東館ホール」に替わる（文の残りは同じ）', w.visit === NOW.visit.replace('２階ホール', '東館ホール') && w.visitWrites === 1, [w.visit, w.visitWrites]);
  /* 2回目の描画は同じ文なので書かない */
  box.renderDaylist(model());
  t('同じ文なら2回目は書き換えない', box.els.visitNoteDaylist.txt.writes === 1, box.els.visitNoteDaylist.txt.writes);

  const w4 = words(makeBox(fakeFac(() => ({ dayPlace: 'Ａ', lunchPlace: '西館食堂' }))));
  t('4字ちょうど・1字は使う・キーの順は問わない', J(w4.title) === J(['デイ休み（西館食堂で昼食）']) && w4.notes.indexOf('・見本利用者分はＡへ') >= 0, [w4.title, w4.notes]);
  const wS = words(makeBox(fakeFac(() => ({ lunchPlace: '同じ', dayPlace: '同じ' }))));
  t('2つが同じ呼び名でも使う（デイと昼食が同じ場所の施設）', wS.notes.indexOf('それ以外は同じへ') >= 0 && wS.notes.indexOf('・見本利用者分は同じへ') >= 0, wS.notes);
  const boxE = makeBox(fakeFac(() => ({ lunchPlace: '<b>', dayPlace: '$&' })));
  const wE = words(boxE);
  let noTag = true;
  walk(boxE.els.tblDaylist, n => { if (n.tag === 'b') noTag = false; });
  walk(boxE.els.weeklyPages, n => { if (n.tag === 'b') noTag = false; });
  t('記号の呼び名も文字のまま入る（要素にならない・置き換えの $ 記号として読まない）',
    J(wE.title) === J(['デイ休み（<b>で昼食）']) && wE.notes.indexOf('・見本利用者分は$&へ') >= 0 && J(wE.weekly) === J(Array(6).fill('<b>')) && noTag, [wE.title, wE.notes]);
}

console.log('— 3. 崩れた塊は塊ごと捨てて既定 —');
{
  const broken = [
    ['知らないキーがある', { lunchPlace: '東館', dayPlace: '本館', note: 'x' }],
    ['_ で始まる説明のキーも知らないキー', { lunchPlace: '東館', dayPlace: '本館', _note: 'x' }],
    ['dayPlace が無い', { lunchPlace: '東館' }],
    ['lunchPlace が無い', { dayPlace: '本館' }],
    ['キーは2つだが片方が違う名前', { lunchPlace: '東館', dayplace: '本館' }],
    ['文字でない（数）', { lunchPlace: 2, dayPlace: '本館' }],
    ['文字でない（null）', { lunchPlace: '東館', dayPlace: null }],
    ['5字', { lunchPlace: '東館の食堂', dayPlace: '本館' }],
    ['空', { lunchPlace: '', dayPlace: '本館' }],
    ['空白だけ', { lunchPlace: '東館', dayPlace: '　' }],
    ['前後の空白', { lunchPlace: ' 東館', dayPlace: '本館' }],
    ['改行入り', { lunchPlace: '東\n館', dayPlace: '本館' }],
    ['タブ入り', { lunchPlace: '東館', dayPlace: '本\t館' }],
    ['{ } 入り（差し込みの印を作らない）', { lunchPlace: '{{通所名}', dayPlace: '本館' }],
    ['空の塊', {}],
    ['配列', ['東館', '本館']],
    ['文字の塊', '東館']
  ];
  for (const [label, v] of broken) {
    const box = makeBox(fakeFac(() => JSON.parse(J(v))));
    t(label + ' → 既定', box.dcrDaycareNotes_() === null, box.dcrDaycareNotes_());
  }
  t('受け継いだだけのキー（自分のキーでない lunchPlace）は数えない → 既定',
    makeBox(fakeFac(() => Object.assign(Object.create({ lunchPlace: '東館' }), { dayPlace: '本館', other: 'x' }))).dcrDaycareNotes_() === null);
  t('section が例外を出す → 既定', makeBox(fakeFac(() => { throw new Error('x'); })).dcrDaycareNotes_() === null);
  t('上限は4字', makeBox(null).DCR_NOTES_WORD_MAX === 4);
  t('本物の部品で 5字 → 既定', makeBox(facility(withNotes({ lunchPlace: '東館の食堂', dayPlace: '本館' }))).dcrDaycareNotes_() === null);
  t('本物の部品で知らないキー → 既定', makeBox(facility(withNotes({ lunchPlace: '東館', dayPlace: '本館', extra: '1' }))).dcrDaycareNotes_() === null);
  sameAsNow('崩れている時の紙と画面', words(makeBox(fakeFac(() => ({ lunchPlace: '東館' })))));
}

console.log('— 4. 施設情報が後から届いた時の描き直し —');
{
  let notes = null;
  const box = makeBox(fakeFac(() => notes));
  vm.runInContext('dcrFloorSigUsed = dcrFloorSig_(); DB = { residents: [] };', box);
  t('呼び名が変わっていなければ描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 0, box.calls);
  notes = { lunchPlace: '東館', dayPlace: '本館' };
  t('呼び名が届いて変わったら1回描き直す（階の名前と同じ控え）', box.dcrRefreshFloorsIfStale_() === true && box.calls.render === 1, box.calls);
  vm.runInContext('dcrFloorSigUsed = dcrFloorSig_();', box);
  t('描いた後は同じ呼び名なら描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 1, box.calls);
  notes = { lunchPlace: '東館' };
  t('崩れた塊に変わった（既定へ戻る）時も1回描き直す', box.dcrRefreshFloorsIfStale_() === true && box.calls.render === 2, box.calls);
}

console.log('— 5. 居室の階と昼食場所は別々に替わる —');
{
  const fl = () => [{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }];
  const wF = words(makeBox(fakeFac(() => null, fl)));
  t('階の名前だけ替えた時、昼食場所の語は今のまま', J(wF.title) === J(NOW.title) && J(wF.weekly) === J(NOW.weekly) && wF.legWeekly === NOW.legWeekly && wF.visit === NOW.visit, [wF.title, wF.weekly]);
  const boxN = makeBox(fakeFac(() => ({ lunchPlace: '東館', dayPlace: '本館' })));
  const wN = words(boxN);
  const secN = textsOf(boxN.els.tblDaylist, 'c-sec').filter(s => s);
  t('昼食場所だけ替えた時、階の見出し（２階入居者・１階入居者）は今のまま', J(secN) === J(['２階入居者', '１階入居者', '階未設定', '２階入居者', '１階入居者', '階未設定']) && wN.title[0] === 'デイ休み（東館で昼食）', secN);
  t('週間名簿の短い階の印（2F／1F／未）は替えない', J(boxN.WK_FLR_LABEL) === J({ 2: '2F', 1: '1F', 0: '未' }));
  t('weeklyTable は見出しを渡さなければ今の「２階」', textsOf(boxN.weeklyTable(model(), 0), 'wk-h')[0] === '２階');
}

console.log('— 6. 置き場の確かめ（呼び名の語を直接書いた所が残っていない） —');
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  t('「デイ休み（２階で昼食）」「２階合計」を直接書いていない', !/'デイ休み（２階で昼食）'/.test(code) && !/'２階合計'/.test(code));
  t('備考の「1階へ」「2階へ」を直接書いていない', !/'[^']*[12]階へ'/.test(code));
  t('凡例の「（２階で昼食）」「2階食堂」を直接書いていない', !/（２階で昼食）/.test(code) && !/2階食堂/.test(code));
  t('週間名簿の2か所の呼び出しは昼食場所の呼び名を渡す', (SRC.match(/weeklyTable\(ppl, d, dcrFill\('\{\{昼食場所:２階\}\}'\)\)/g) || []).length === 2);
  t('差し込みの印は dcrFill で置き換える（差し込んだ語をもう一度置き換えない＝{{通所名}} などの後）', /\.replace\(\/\\\{\\\{\(昼食場所\|デイの場所\):\(\[\^\{\}\]\*\)\\\}\\\}\/g, \(a, k, d\) => dcrNotesWord_\(k, d\)\)\.replace\(\/\\\{\\\{居室の1階:/.test(grabFn('dcrFill')));
}


console.log('— 7. 備考「施設職員は1階の方の誘導」の1階は居室の階（floors の1階の名前・代表者の決定 2026-11-02） —');
{
  const LAST = '施設職員は1階の方の誘導もお願いします';
  const lastOf = box => { box.renderDaylist(model()); const c = box.els.noteDaylist.children; return c[c.length - 1].textContent; };
  t('部品が無い時は今の文字（半角の 1階）', lastOf(makeBox(null)) === LAST, lastOf(makeBox(null)));
  t('見本の施設情報（１階・２階）でも今の文字（全角に変えない）', lastOf(makeBox(facility(withNotes(undefined)))) === LAST);
  const fl = () => [{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }];
  const boxF = makeBox(fakeFac(() => null, fl));
  const wF = words(boxF);
  t('架空の floors（一の階・二の階）で「一の階の方の誘導」になる', wF.notes[wF.notes.length - 1] === '施設職員は一の階の方の誘導もお願いします', wF.notes);
  t('ほかの備考は替わらない（「利用者分は1階へ」「それ以外は2階へ」は昼食場所の呼び名の方）', J(wF.notes.slice(0, -1)) === J(NOW.notes.slice(0, -1)), wF.notes);
  t('薬用の備考には誘導の行が無い＝替わらない', J(wF.med) === J(NOW.med), wF.med);
  const wN = words(makeBox(fakeFac(() => ({ lunchPlace: '東館', dayPlace: '本館' }))));
  t('daycareNotes を書いても誘導の行の 1階 は変わらない', wN.notes[wN.notes.length - 1] === LAST, wN.notes);
  const wB = words(makeBox(fakeFac(() => ({ lunchPlace: '東館', dayPlace: '本館' }), fl)));
  t('floors と daycareNotes の両方を書いた時は、誘導は floors・ほかの2行は daycareNotes',
    wB.notes[wB.notes.length - 1] === '施設職員は一の階の方の誘導もお願いします' && wB.notes.indexOf('それ以外は東館へ') >= 0 && wB.notes.indexOf('・見本利用者分は本館へ') >= 0, wB.notes);
  t('崩れた floors（２階が無い）は今の文字', lastOf(makeBox(fakeFac(() => null, () => [{ no: 1, label: '一の階' }]))) === LAST);
  t('崩れた floors（5字）は今の文字', lastOf(makeBox(fakeFac(() => null, () => [{ no: 1, label: '東棟の一階' }, { no: 2, label: '二の階' }]))) === LAST);
  t('１階の名前が既定の「１階」のままなら（２階だけ替えても）今の文字', lastOf(makeBox(fakeFac(() => null, () => [{ no: 1, label: '１階' }, { no: 2, label: '屋上階' }]))) === LAST);
  t('記号の名前も文字のまま（置き換えの $ 記号として読まない）', lastOf(makeBox(fakeFac(() => null, () => [{ no: 1, label: '$&' }, { no: 2, label: '二の階' }]))) === '施設職員は$&の方の誘導もお願いします');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  t('誘導の行の「1階」を直接書いていない', !/'施設職員は1階の方/.test(code));
}

done();
