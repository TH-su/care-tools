/* デイ利用表の外部の利用者の区画の試験（2026-11-17 新設・D-02・代表者の決定 2026-11-17・文言と位置は仮置き）
   実行: node check/unit/daycare_outside_test.js
        （DCR_HTML で対象ファイルを差し替えられる＝直す前の版・条件を抜いた版を試す時に使う）
   守ること:
     1. 印なし（施設情報なし・見本・daycareOutside を書いていない）の時は、週間計画で「外部」の方も今のまま
        （階未設定の区画・橙の地・⚠ の人数・デイ休み・昼食場所の合計・週間名簿に入る）
     2. 印が崩れている時（知らないキー・label が無い・5字・空・前後の空白・改行・{ }・文字でない・配列・文字の塊）は、
        印なしと描いた中身が1つも違わない
     3. 混在（印あり）: external が true で階 0 の方だけ「（label）利用者」の区画（階の区画の後・階未設定の前・緑・橙と⚠なし）。
        外部でも居室で階が決まる方は階の区画・外部でない階 0 の方は階未設定のまま。利用表の階の欄は「外部」（緑の f2）
     4. 全員が外部（印あり）: 空の「２階入居者」「１階入居者」を描かない・一覧表の下半分を描かない・全員リストの合計行は「利用者」
     5. 一覧の系統（buildModel）と利用表の系統（collectDaycare）で、外部かどうか・階の判定が一致する
     6. 施設情報が後から届いて印が変わった時だけ1回描き直す（dcrFloorSig_ の控え）
     7. 第2段の食数: 外部の方はデイに行かない日の「デイ休み」・昼食場所の合計・週間名簿に入れない（来る日の通所合計・昼食合計には入る）
     8. 貼る前の確かめ（check/facility-secret-check.mjs）は、画面と同じ事例で OK と NG を分け、値を出さない
   ★画面の本物の関数と本物の su-facility.js を vm で動かす。偽物にするのは document（要素の入れ物）・枠線の仕上げ・保存の口だけ。利用者は架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = fs.readFileSync(process.env.DCR_HTML || path.join(ROOT, 'daycare-roster.html'), 'utf8');
const FAC_SRC = read('su-facility.js');
const SAMPLE_SRC = read('facility-profile.sample.json');
const SAMPLE = JSON.parse(SAMPLE_SRC);

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
const J = JSON.stringify;

/* ── 切り出し（daycare_k5_test.js と同じ方式：文字列・コメントを飛ばして括弧の対を数える）── */
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
const hasCls = (n, cls) => (' ' + (n.className || '') + ' ').indexOf(' ' + cls + ' ') >= 0;
function textsOf(root, cls) { const out = []; walk(root, n => { if (hasCls(n, cls)) out.push(n.textContent); }); return out; }
/* 描いた中身を文字にする（要素の名前・class・文字・行と列の結合）＝2つの描き方が1つも違わないかを比べる */
function ser(n) {
  if (!n || typeof n !== 'object') return '';
  if (!n.tag) return '#' + n.textContent;
  return '<' + n.tag + ' c="' + n.className + '" r=' + n.rowSpan + ' s=' + n.colSpan + ' d=' + J(n.dataset) + '>' + n._t + (n.children || []).map(ser).join('') + '</>';
}

/* 本物の su-facility.js（端末の控えに profile を入れた状態で起動。profile が null なら控え無し＝読む前） */
function facility(profile) {
  const box = { console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' && profile ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(FAC_SRC, box);
  return box.SUFacility;
}
const prof = (outside) => { const p = JSON.parse(SAMPLE_SRC); if (outside !== undefined) p.daycareOutside = outside; return p; };

/* ── 画面の関数を1つの砂場に入れる ── */
function makeBox(fac) {
  const els = {};
  const $ = id => (els[id] = els[id] || makeEl('div'));
  const calls = { render: 0 };
  const box = {
    console, JSON, String, Object, Array, Number, Math, Set, parseInt, isFinite,
    document: { createElement: makeEl, createTextNode: s => ({ textContent: String(s), children: [] }) },
    $, els, calls,
    dcrName: s => '見本' + s, dcrOfficeName: () => '見本', dcrClinicLabel_: () => '見本クリニック', frameDaylist_() {}, setRosterPrintCols_() {},
    stampPrintDate_() {}, MODEL: [], hiddenNowCount: 0, preAdmittedNowCount: 0, preAdmittedHiddenCount: 0,
    dcrIsField_: () => false, DCR_FIELD_MSG: '', dcrRecentLogs_: () => [], dcrLogText_: () => ({ when: '', what: '' }), writeLunchMed() {}, toast() {},
    renderAll: () => { calls.render++; }
  };
  box.window = box;
  if (fac) box.SUFacility = fac;
  vm.createContext(box);
  vm.runInContext([
    grabDecl('DAYS_JA'), grabDecl('NDAY'), 'var ROSTER_SUB = "";', 'var DB = null;', grabDecl('dupCount'), grabDecl('floorSrcCount'), 'var dcrNameCutMap = null;',
    grabDecl('FLOOR_ORDER'), grabDecl('FLOOR_LABEL'), grabDecl('DCR_FLOOR_NAME_MAX'), grabDecl('WK_FLR_LABEL'),
    grabDecl('dcrFloorSigUsed'),
    grabDecl('DCR_DAYS_DEFAULT'), grabDecl('DCR_COLS'), grabDecl('DCR_W7'), grabFn('dcrDays_'), grabFn('dcrLastDay_'), grabFn('dcrSheetW_'),
    grabFn('dcrFloorExtra_'), grabFn('dcrFloorNos_'), grabFn('dcrFloorOrder_'), grabFn('dcrFloorKey_'),
    grabDecl('DCR_OUT_WORD_MAX'), grabFn('dcrOutside_'), grabFn('dcrFloorOf_'), grabFn('dcrSecLists_'),
    grabFn('dcrFloorNames_'), grabFn('dcrFloorLabel_'), grabFn('dcrFloorSecLabel_'), grabFn('dcrFloorSig_'), grabFn('dcrRefreshFloorsIfStale_'),
    grabDecl('DCR_NOTES_KEYS'), grabDecl('DCR_NOTES_WORD_MAX'), grabFn('dcrDaycareNotes_'), grabFn('dcrNotesWord_'),
    grabDecl('byKana'), grabDecl('onDay'), grabDecl('offDay'), grabDecl('countOn'), grabDecl('countOff'), grabDecl('W'), grabDecl('TBL_W'), grabFn('colgroupFor'),
    grabDecl('DAYLIST_NOTES'), grabDecl('DCR_VISIT_NOTE'), grabDecl('MED_NOTES'), grabFn('wkFlrLabel_'), grabFn('weeklyByFloor'), grabFn('wkNameSpaced'), grabFn('weeklyTable'), grabFn('renderWeekly'),
    grabFn('toMin'), grabFn('minToLabel'), grabFn('el'), grabFn('roomToFloor'), grabFn('buildModel'), grabFn('collectDaycare'),
    grabFn('setupSheet'),
    grabFn('dayHeaderRows'), grabFn('dayHeader'), grabFn('deiCells'), grabFn('sectionRows'), grabFn('sumRow'),
    grabFn('renderRoster'), grabFn('renderDaylist'), grabFn('allweekHeaderRow'), grabFn('renderAllweek'), grabFn('renderMed'),
    grabFn('dcrFill'), grabDecl('LEGENDS'), grabFn('renderLegend')
  ].join('\n'), box);
  return box;
}

/* 架空の利用者（週間計画の利用者の形）。ev は [曜日(0=月), 入浴] の並び */
function res(id, room, external, evs, extra) {
  return Object.assign({ id: 'r' + id, name: '見本 ' + id, kana: 'か' + String(id).padStart(2, '0'), room: room, external: external,
    events: evs.map(e => ({ serviceType: 'daycare', dayOfWeek: e[0], startTime: '09:30', endTime: '16:00', bathing: !!e[1] })) }, extra || {});
}
/* 混在: ２階 2名・１階 1名・外部（居室なし）2名（1名は入院中）・外部でも居室 201 の方・外部でない階未設定の方 */
function mixedDb() {
  return { residents: [
    res(1, '201', false, [[0, true], [2]]), res(2, '202', false, [[1]]), res(3, '101', false, [[0], [3]]),
    res(4, '', true, [[0, true], [4]]), res(5, '', true, [[1]], { hospitalized: true }),
    res(6, '203', true, [[2]]), res(7, '', false, [[3]])
  ] };
}
/* 単独のデイ: 全員が外部（居室なし）。週間計画の旧い floor も無い */
function soloDb(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(res(100 + i, '', true, [[i % 6], [(i + 2) % 6, i % 2 === 0]]));
  return { residents: out };
}
/* 1つの砂場で5つの帳票と凡例を描き、描いた中身を文字で返す */
function renderAllTabs(box, db) {
  const ppl = box.buildModel(db);
  box.MODEL = ppl;
  box.renderRoster(db);
  box.renderDaylist(ppl);
  box.renderAllweek(ppl);
  box.renderMed(ppl);
  box.renderWeekly(ppl);
  const lg = {};
  for (const sc of ['sc-roster', 'sc-daylist', 'sc-allweek', 'sc-med', 'sc-weekly']) { box.renderLegend(sc); lg[sc] = box.els.legend.textContent; }
  return { ppl, dom: ['roster', 'tblDaylist', 'tblAllweek', 'tblMed', 'chkMed', 'weeklyPages', 'noteDaylist'].map(id => ser(box.els[id])).join('\n'), lg };
}
const secs = tbl => textsOf(tbl, 'c-sec').filter(s => s);

console.log('— 1. 印なしは今のまま（外部の方も階未設定・橙・⚠・デイ休み・週間名簿）—');
const BASE = {};
for (const [label, fac] of [['施設情報の部品が無い', null], ['読む前（控え無し）', facility(null)], ['見本の施設情報（印を書いていない）', facility(prof())]]) {
  const box = makeBox(fac);
  t(label + ': 印は無い', box.dcrOutside_() === null, box.dcrOutside_());
  const r = renderAllTabs(box, mixedDb());
  BASE[label] = r;
  const p4 = r.ppl.find(p => p.name === '見本 4');
  t(label + ': 外部で居室の無い方も floor 0・out は false', p4 && p4.floor === 0 && p4.out === false, p4);
  t(label + ': 一覧表の区画は今と同じ（２階・１階・階未設定 ×上下）', J(secs(box.els.tblDaylist)) === J(['２階入居者', '１階入居者', '階未設定', '２階入居者', '１階入居者', '階未設定']), secs(box.els.tblDaylist));
  t(label + ': ⚠ 階未設定は外部の方も数える（3名）', r.lg['sc-daylist'].indexOf('⚠ 階未設定 3名（マスタ未登録）') >= 0, r.lg['sc-daylist']);
  t(label + ': 外部の方の氏名のマスも橙（nofloor）', textsOf(box.els.tblDaylist, 'nofloor').some(s => s.indexOf('見本 4') === 0), textsOf(box.els.tblDaylist, 'nofloor'));
  t(label + ': 利用表の階の欄は ２階・１階・階未設定（「外部」は出ない）', J(textsOf(box.els.roster.children[1], 'col-flr')) === J(['２階', '１階', '階未設定']), textsOf(box.els.roster.children[1], 'col-flr'));
  t(label + ': 外部の方もデイに行かない日のデイ休みに入る（火の offDay に 見本 4）', box.offDay(r.ppl, 1).some(p => p.name === '見本 4'));
  t(label + ': 全員リストの合計行は「入居者」', textsOf(box.els.tblAllweek, 'c-sum-lb')[0] === '入居者', textsOf(box.els.tblAllweek, 'c-sum-lb'));
}
t('印なしの3つの場合は、描いた中身が同じ', BASE['施設情報の部品が無い'].dom === BASE['読む前（控え無し）'].dom && BASE['読む前（控え無し）'].dom === BASE['見本の施設情報（印を書いていない）'].dom);

console.log('— 2. 印が崩れている時は、印なしと1つも違わない —');
const BAD = [
  ['知らないキーがある', { label: '外部', color: '緑' }], ['label が無い', { name: '外部' }], ['5字', { label: '外部の利用' }], ['空', { label: '' }],
  ['前の空白', { label: ' 外部' }], ['後ろの空白', { label: '外部　' }], ['改行', { label: '外\n部' }], ['{ }', { label: '{外}' }],
  ['文字でない', { label: 4 }], ['配列', ['外部']], ['文字の塊', '外部'], ['null', null], ['空の塊', {}]
];
for (const [label, v] of BAD) {
  const box = makeBox(facility(prof(v)));
  t(label + ' → 印は無い', box.dcrOutside_() === null, box.dcrOutside_());
  const r = renderAllTabs(box, mixedDb());
  t(label + ' → 描いた中身と凡例は印なしと同じ', r.dom === BASE['見本の施設情報（印を書いていない）'].dom && J(r.lg) === J(BASE['見本の施設情報（印を書いていない）'].lg));
}
{
  const box = makeBox({ ready: () => true, onReady() {}, floors: () => [{ no: 1, label: '１階' }, { no: 2, label: '２階' }], section() { throw new Error('見本の失敗'); } });
  t('section が例外を出しても印は無い（止めない）', box.dcrOutside_() === null);
}

console.log('— 3. 混在（印あり）—');
for (const [lab, word] of [['「外部」', '外部'], ['4字', '外来の方']]) {
  const box = makeBox(facility(prof({ label: word })));
  t(lab + ': 印の名前を読む', box.dcrOutside_() === word, box.dcrOutside_());
  const r = renderAllTabs(box, mixedDb());
  const by = n => r.ppl.find(p => p.name === '見本 ' + n);
  t(lab + ': 外部で階 0 の方だけ out（floor は 0 のまま）', by(4).out === true && by(4).floor === 0 && by(5).out === true && by(6).out === false && by(6).floor === 2 && by(7).out === false && by(7).floor === 0 && by(1).out === false,
    r.ppl.map(p => [p.name, p.floor, p.out]));
  t(lab + ': 一覧表の区画は ２階・１階・（印）利用者・階未設定／下段は ２階・１階・階未設定（外部は載せない）',
    J(secs(box.els.tblDaylist)) === J(['２階入居者', '１階入居者', word + '利用者', '階未設定', '２階入居者', '１階入居者', '階未設定']), secs(box.els.tblDaylist));
  let outColor = null;
  walk(box.els.tblDaylist, n => { if (hasCls(n, 'c-sec') && n.textContent === word + '利用者') outColor = n.className; });
  t(lab + ': 外部の区画の見出しは２階と同じ緑（sese）', outColor && hasCls({ className: outColor }, 'sese') && !hasCls({ className: outColor }, 'flr1'), outColor);
  const nof = textsOf(box.els.tblDaylist, 'nofloor').concat(textsOf(box.els.tblAllweek, 'nofloor'), textsOf(box.els.tblMed, 'nofloor'));
  t(lab + ': 橙（nofloor）は外部でない階未設定の方（見本 7）だけ', nof.length > 0 && nof.every(s => s.indexOf('見本 7') === 0), nof);
  t(lab + ': ⚠ 階未設定は外部の方を数えない（1名）', r.lg['sc-daylist'].indexOf('⚠ 階未設定 1名（マスタ未登録）') >= 0, r.lg['sc-daylist']);
  const rf = textsOf(box.els.roster.children[1], 'col-flr');
  t(lab + ': 利用表の階の欄は ２階・１階・（印）・階未設定', J(rf) === J(['２階', '１階', word, '階未設定']), rf);
  let rosterOutCls = null;
  walk(box.els.roster, n => { if (hasCls(n, 'col-flr') && n.textContent === word) rosterOutCls = n.className; });
  t(lab + ': 利用表の外部の欄は緑（f2・橙の f0 にしない）', rosterOutCls === 'col-flr f2', rosterOutCls);
  const aw = box.els.tblAllweek.children[2].children.filter(tr => tr.children[0] && hasCls(tr.children[0], 'sec-h')).map(tr => tr.children[0].textContent);
  t(lab + ': 全員リストの区画は ２階・１階・（印）利用者・階未設定', J(aw) === J(['２階入居者', '１階入居者', word + '利用者', '階未設定']), aw);
  /* 2026-11-17 差分の審査 低2: 合計の人数は外部の方も含むので、外部の方がいる時は「利用者」（前は入居者がいれば「入居者」と決めていた） */
  t(lab + ': 全員リストの合計行は、外部の方を数に含むので「利用者」', textsOf(box.els.tblAllweek, 'c-sum-lb')[0] === '利用者', textsOf(box.els.tblAllweek, 'c-sum-lb'));
  t(lab + ': 一覧表の凡例の「下段＝デイ休み」は残る（下半分を描く）', r.lg['sc-daylist'].indexOf('下段＝デイ休み') >= 0, r.lg['sc-daylist']);
  t(lab + ': 薬用の区画も同じ並び', J(secs(box.els.tblMed)) === J(['２階入居者', '１階入居者', word + '利用者', '階未設定']), secs(box.els.tblMed));
  t(lab + ': 昼食薬チェックに外部の方の組がある（チェック欄から消さない）', textsOf(box.els.chkMed, 'chk-flr').indexOf(word + '利用者') >= 0 && textsOf(box.els.chkMed, 'chk-item').indexOf('見本 4') >= 0, textsOf(box.els.chkMed, 'chk-flr'));
  t(lab + ': 一覧表の下半分（デイ休み）は描く', textsOf(box.els.tblDaylist, 'cut-title').length === 1);
}

console.log('— 4. 全員が外部（印あり・単独のデイ・架空30名）—');
{
  const box = makeBox(facility(prof({ label: '外部' })));
  const r = renderAllTabs(box, soloDb(30));
  t('30名とも out', r.ppl.length === 30 && r.ppl.every(p => p.out && p.floor === 0));
  t('一覧表は「外部利用者」の区画だけ（空の２階・１階を描かない・下半分を描かない）', J(secs(box.els.tblDaylist)) === J(['外部利用者']), secs(box.els.tblDaylist));
  t('一覧表にデイ休みの見出し・曜日の再掲・昼食場所の合計・昼食合計が無い', textsOf(box.els.tblDaylist, 'cut-title').length === 0 && textsOf(box.els.tblDaylist, 'cut-gap').length === 0 && textsOf(box.els.tblDaylist, 'rehead').length === 0
    && textsOf(box.els.tblDaylist, 'sum').every(s => s.indexOf('昼食') < 0 && s.indexOf('２階合計') < 0));
  t('一覧表の通所合計は残る', textsOf(box.els.tblDaylist, 'sum').some(s => s.indexOf('見本合計') >= 0), textsOf(box.els.tblDaylist, 'sum'));
  t('一覧表の備考・訪問診療の案内の文は今のまま（備考は9行）', box.els.noteDaylist.children.length === 10 && box.els.noteDaylist.children[9].textContent === '施設職員は1階の方の誘導もお願いします', box.els.noteDaylist.children.length);
  const aw = box.els.tblAllweek.children[2].children.filter(tr => tr.children[0] && hasCls(tr.children[0], 'sec-h')).map(tr => tr.children[0].textContent);
  t('全員リストは「外部利用者」の区画だけ', J(aw) === J(['外部利用者']), aw);
  t('全員リストの合計行は「利用者」・人数は30名', textsOf(box.els.tblAllweek, 'c-sum-lb')[0] === '利用者' && textsOf(box.els.tblAllweek, 'sum')[0].indexOf('30名') >= 0, textsOf(box.els.tblAllweek, 'c-sum-lb'));
  t('薬用は「外部利用者」の区画だけ', J(secs(box.els.tblMed)) === J(['外部利用者']), secs(box.els.tblMed));
  t('一覧表の凡例に、描いていない「下段＝デイ休み」を出さない（2026-11-17 差分の審査 低1）', r.lg['sc-daylist'].indexOf('下段') < 0 && r.lg['sc-daylist'].indexOf('黄＝入浴あり') >= 0, r.lg['sc-daylist']);
  t('橙・⚠・橙の説明が出ない', textsOf(box.els.tblDaylist, 'nofloor').length === 0 && Object.values(r.lg).every(s => s.indexOf('階未設定') < 0 && s.indexOf('淡い橙') < 0), r.lg);
  const wk = box.els.weeklyPages.children.map(pg => textsOf(pg, 'wk-sum')[0]);
  t('週間名簿は各曜日0名の今の形（6枚・氏名なし）', wk.length === 6 && wk.every(s => s === '0名') && textsOf(box.els.weeklyPages, 'wk-nmtx').length === 0, wk);
  const rf = textsOf(box.els.roster.children[1], 'col-flr');
  t('利用表の階の欄は「外部」だけ', rf.length > 0 && rf.every(s => s === '外部'), rf);
}
{
  /* 印があっても入居者がいる時（外部でない階未設定の方だけ）は下半分を描く・合計行は「入居者」 */
  const box = makeBox(facility(prof({ label: '外部' })));
  const db = soloDb(3); db.residents.push(res(9, '', false, [[0]]));
  renderAllTabs(box, db);
  t('外部と階未設定だけ: 階の区画は描かず、下半分は階未設定だけ', J(secs(box.els.tblDaylist)) === J(['外部利用者', '階未設定', '階未設定']), secs(box.els.tblDaylist));
  /* 2026-11-17 差分の審査 低2: 外部の方を数に含むので「利用者」 */
  t('外部と階未設定だけ: 合計行は外部の方を数に含むので「利用者」', textsOf(box.els.tblAllweek, 'c-sum-lb')[0] === '利用者', textsOf(box.els.tblAllweek, 'c-sum-lb'));
}
{
  /* 印があり外部の方がいない（入居者だけ）時は、今の紙と同じ（空の階の区画も描く） */
  const db = { residents: [res(1, '201', false, [[0]]), res(2, '', false, [[1]])] };
  const a = renderAllTabs(makeBox(facility(prof())), db), b = renderAllTabs(makeBox(facility(prof({ label: '外部' }))), db);
  t('印あり・外部の方0名・１階0名: 描いた中身は印なしと同じ（空の１階入居者も描く）', a.dom === b.dom && J(a.lg) === J(b.lg));
}

console.log('— 5. 一覧の系統と利用表の系統で判定が一致する —');
for (const [label, v] of [['印なし', undefined], ['印あり', { label: '外部' }]]) {
  const box = makeBox(facility(prof(v)));
  const db = mixedDb();
  db.residents.push(res(8, '', true, [[0]], { floor: 1 }));   // 外部でも週間計画の旧い floor で階が決まる方は階の区画
  db.residents.push(res(10, '301', true, [[5]]));               // 区画の無い3階の居室＝階 0（外部なら外部の区画）
  const ppl = box.buildModel(db);
  const data = box.collectDaycare(db);
  const fromRoster = {};
  data.plans.forEach(pl => pl.blocks.forEach(b => { for (let d = 0; d <= 6; d++) b.days[d].forEach(u => { fromRoster[u.name] = [b.floor, !!b.out]; }); }));
  const fromModel = {};
  ppl.forEach(p => { fromModel[p.name] = [p.floor, !!p.out]; });
  t(label + ': 全員の（階・外部）が2つの系統で同じ', J(fromRoster) === J(Object.fromEntries(Object.keys(fromRoster).map(k => [k, fromModel[k]]))) && Object.keys(fromRoster).length === ppl.length, { fromRoster, fromModel });
  t(label + ': 週間計画の旧い floor の外部の方は １階', J(fromModel['見本 8']) === J([1, false]));
  t(label + ': 3階の居室（区画なし）の外部の方は ' + (v ? '外部' : '階未設定'), J(fromModel['見本 10']) === J([0, !!v]));
  t(label + ': 判定は1つの関数（buildModel と collectDaycare の両方が dcrFloorOf_ を呼ぶ）', /dcrFloorOf_\(r, outL\)/.test(grabFn('buildModel')) && /dcrFloorOf_\(r, outL\)/.test(grabFn('collectDaycare')));
}

console.log('— 6. 施設情報が後から届いて印が変わった時だけ1回描き直す —');
{
  let prof0 = null;
  const fac = facility(null);   // 読む前（控え無し）
  const box = makeBox({ ready: () => true, onReady() {}, floors: () => fac.floors(), section: n => (n === 'daycareOutside' ? prof0 : fac.section(n)) });
  vm.runInContext('dcrFloorSigUsed = dcrFloorSig_(); DB = { residents: [] };', box);
  t('印が変わらなければ描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 0);
  prof0 = { label: '外部' };
  t('印が届いたら描き直す（1回）', box.dcrRefreshFloorsIfStale_() === true && box.calls.render === 1, box.calls.render);
  vm.runInContext('dcrFloorSigUsed = dcrFloorSig_();', box);
  t('同じ印のままなら2回目は描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 1);
}

console.log('— 7. 第2段の食数（外部の方はデイに行かない日に数えない）—');
{
  const box = makeBox(facility(prof({ label: '外部' })));
  const ppl = box.buildModel(mixedDb());
  /* 月: デイ＝見本1・3・4（入院なし）→ 通所合計 3。行かない＝見本2・6・7（外部の4・5は自宅）→ 昼食場所の合計 3。昼食合計 6 */
  t('月: 通所合計は外部の方も数える（3）', box.countOn(ppl, 0) === 3, box.countOn(ppl, 0));
  t('月: 昼食場所の合計は外部の方を数えない（3）', box.countOff(ppl, 0) === 3, box.offDay(ppl, 0).map(p => p.name));
  t('火: 外部で入院中の方（見本 5）は通所合計に数えず、昼食場所の合計にも入らない', box.countOn(ppl, 1) === 1 && box.offDay(ppl, 1).every(p => !p.out), [box.countOn(ppl, 1), box.offDay(ppl, 1).map(p => p.name)]);
  box.renderDaylist(ppl);
  const sums = textsOf(box.els.tblDaylist, 'sum');
  t('一覧表の合計行は 見本合計・２階合計・昼食合計 の3行', sums.length === 3 && sums[1].indexOf('２階合計') === 0 && sums[2].indexOf('昼食合計') === 0, sums);
  box.renderWeekly(ppl);
  const wk0 = box.els.weeklyPages.children[0];
  t('週間名簿（月）に外部の方が載らない・人数は3名', textsOf(wk0, 'wk-nmtx').every(s => s.indexOf('見本 4') < 0 && s.indexOf('見本 5') < 0) && textsOf(wk0, 'wk-sum')[0] === '3名', [textsOf(wk0, 'wk-nmtx'), textsOf(wk0, 'wk-sum')]);
  const boxN = makeBox(facility(prof()));
  const pplN = boxN.buildModel(mixedDb());
  t('印なしなら火の昼食場所の合計は今どおり外部の方（見本 4）も数える（5）・印ありは数えない（4）', boxN.countOff(pplN, 1) === 5 && boxN.offDay(pplN, 1).some(p => p.name === '見本 4') && box.countOff(ppl, 1) === 4,
    [boxN.offDay(pplN, 1).map(p => p.name), box.offDay(ppl, 1).map(p => p.name)]);
  t('昼食合計が定数でなくなることを注記に書いた（1802〜1805 の注記の書き直し）', /外部の利用者がいる時（D-02）は[^]*昼食合計は曜日ごとに動く/.test(SRC));
}

console.log('— 8. 貼る前の確かめ（facility-secret-check）は画面と同じ事例で分ける —');
(async () => {
  const { checkFacilityProfile: check } = await import(path.join(ROOT, 'check', 'facility-secret-check.mjs'));
  const good = () => {
    const p = JSON.parse(SAMPLE_SRC);
    p.corpName = '試験の谷株式会社'; p.facilityName = '試験の谷ホーム';
    p.offices.forEach((o, i) => { o.name = '試験の谷' + o.kind; o.tel = i === 1 ? '' : '096-000-33' + (10 + i); });
    delete p.support;   // 見本の問い合わせ先（000-000-0000）は NG になるので外す（無くても OK の項目）
    return p;
  };
  const run = v => { const p = good(); if (v !== undefined) p.daycareOutside = v; return check(JSON.stringify(p, null, 2), SAMPLE_SRC); };
  t('印を書いていない時は OK', run(undefined).ok, run(undefined).errors);
  for (const w of ['外部', '外来の方']) {
    const box = makeBox(facility(prof({ label: w })));
    t('「' + w + '」: 確かめは OK・画面も印として読む', run({ label: w }).ok && box.dcrOutside_() === w, run({ label: w }).errors);
  }
  for (const [label, v] of BAD) {
    const r = run(v);
    const box = makeBox(facility(prof(v)));
    t(label + ': 確かめは NG（daycareOutside の項目だけ）・画面も印として読まない', !r.ok && r.errors.some(e => /^daycareOutside：/.test(e)) && box.dcrOutside_() === null, r.errors);
    t(label + ': NG の文に値を出さない', r.errors.every(e => e.indexOf('試験の谷') < 0 && e.indexOf('096-000-33') < 0));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
