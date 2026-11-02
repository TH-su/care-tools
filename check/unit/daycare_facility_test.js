/* デイ利用表の階の見出しを施設情報（facility-profile.json の floors）から作る試験（2026-11-02 新設・品質改善 第3期 便8）
   実行: node check/unit/daycare_facility_test.js
        （DCR_HTML で対象ファイルを差し替えられる＝直す前の版・条件を抜いた版を試す時に使う）

   何を守るか:
     1. 施設情報が無い・読めない・見本（１階・２階）の時は、今の文字と一字一句同じ（２階／１階／階未設定、２階入居者／１階入居者）
     2. floors に no 1 と no 2 の両方があり、名前が1〜4字の時だけ、利用表の階の欄・一覧表・全員リスト・薬用の区画の見出しが替わる
        （区画は「（その階の名前）入居者」）。利用表の凡例の「居室階（２階→１階）」も同じ名前で組む。並び（２階が上）と「階未設定」は替えない
     3. 崩れた floors（片方が無い・5字以上・文字でない・空・空白だけ・改行・同じ階が2つ・2つが同じ名前・配列でない・例外）は両方とも既定
     4. 施設情報が後から届いて名前が変わった時だけ描き直す（変わらなければ描き直さない）
     5. 昼食場所の意味の「２階」（２階合計・デイ休み（２階で昼食）・週間名簿の見出し）と週間名簿の短い 2F／1F／未 は替えない
   ★画面の本物の関数（dcrFloorNames_ ほか・renderRoster・renderDaylist・renderAllweek）と本物の su-facility.js を vm で動かす。
     偽物にするのは document（要素の入れ物）・表の幅の採寸・枠線の仕上げだけ。利用者・階の名前は架空。 */
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

/* ── 切り出し（care_namecut_test.js と同じ方式：文字列・コメントを飛ばして括弧の対を数える）── */
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

/* 本物の su-facility.js（端末の控えに profile を入れた状態で起動。profile が null なら控え無し＝読む前） */
function facility(profile) {
  const box = { console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' && profile ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(FAC_SRC, box);
  return box.SUFacility;
}
const withFloors = floors => Object.assign(JSON.parse(J(SAMPLE)), { floors });
/* 画面の floors() がそのまま返す偽の施設情報（su-facility.js が整える前の形も試すため） */
const fakeFac = (floorsFn) => ({ ready: () => true, onReady() {}, floors: floorsFn });

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
    stampPrintDate_() {}, MODEL: [], floorSrcCount: { room: 0, plan: 0 }, dupCount: 0, hiddenNowCount: 0, preAdmittedNowCount: 0, preAdmittedHiddenCount: 0,
    renderAll: () => { calls.render++; }
  };
  box.window = box;
  if (fac) box.SUFacility = fac;
  vm.createContext(box);
  vm.runInContext([
    grabDecl('DAYS_JA'), grabDecl('NDAY'), 'var ROSTER_SUB = "";', 'var DB = null;',
    grabDecl('FLOOR_ORDER'), grabDecl('FLOOR_LABEL'), grabDecl('DCR_FLOOR_NAME_MAX'), grabDecl('WK_FLR_LABEL'),
    grabDecl('dcrFloorSigUsed'),
    grabFn('dcrFloorNames_'), grabFn('dcrFloorLabel_'), grabFn('dcrFloorSecLabel_'), grabFn('dcrFloorSig_'), grabFn('dcrRefreshFloorsIfStale_'),
    grabDecl('DCR_NOTES_KEYS'), grabDecl('DCR_NOTES_WORD_MAX'), grabFn('dcrDaycareNotes_'), grabFn('dcrNotesWord_'),   // 昼食場所の呼び名（便10・施設情報に daycareNotes が無ければ既定）
    grabDecl('byKana'), grabDecl('onDay'), grabDecl('offDay'), grabDecl('countOn'), grabDecl('countOff'), 'var TBL_W = { daylist: 1000, allweek: 1000, day: 1000 };', grabDecl('DAYLIST_NOTES'),
    grabFn('toMin'), grabFn('minToLabel'), grabFn('el'), grabFn('roomToFloor'), grabFn('collectDaycare'),
    grabFn('setupSheet').replace(/\n\s*table\.appendChild\(colgroupFor\(kind\)\);/, ''),   // 列幅の宣言（colgroup）はこの試験の外
    grabFn('dayHeaderRows'), grabFn('dayHeader'), grabFn('deiCells'), grabFn('sectionRows'), grabFn('sumRow'),
    grabFn('renderRoster'), grabFn('renderDaylist'), grabFn('allweekHeaderRow'), grabFn('renderAllweek'),
    grabFn('dcrFill'), grabDecl('LEGENDS'), grabFn('renderLegend')
  ].join('\n'), box);
  return box;
}

/* 架空の利用者（2階2名・1階2名・居室なし1名）。ev は [曜日(0=月), 始まり, 終わり] */
function rosterDb() {
  const r = (id, kana, room, dows) => ({ id: 'r' + id, name: '見本 ' + id, kana, room,
    events: dows.map(d => ({ serviceType: 'daycare', dayOfWeek: d, startTime: '09:00', endTime: '15:00', bathing: d === 0 })) });
  return { residents: [r('甲', 'あ', '201', [0, 2]), r('乙', 'い', '202', [1]), r('丙', 'う', '101', [0]), r('丁', 'え', '102', [3]), r('戊', 'お', '', [0])] };
}
/* 帳票タブ（一覧表・全員リスト）が読む形（buildModel の結果の形）の架空の利用者 */
function model() {
  const day = { s: 540, e: 900, bath: false };
  const p = (pid, floor, days) => ({ pid, name: '見本 ' + pid, kana: String(pid), floor, hosp: false, days, visitingMed: '' });
  return [p(1, 2, [day, null, day, null, null, null]), p(2, 1, [null, day, null, day, null, null]), p(3, 0, [day, null, null, null, null, null])];
}
/* 3つの帳票を描いて、階の見出しの文字を集める */
function headings(box) {
  box.renderRoster(rosterDb());
  box.renderDaylist(model());
  box.renderAllweek(model());
  return {
    roster: textsOf(box.els.roster.children[1], 'col-flr'),   // 見出しの行（「階」）を除いた本文
    daylist: textsOf(box.els.tblDaylist, 'c-sec').filter(s => s),
    allweek: textsOf(box.els.tblAllweek, 'sec-h'),
    sums: textsOf(box.els.tblDaylist, 'sum').map(s => s.replace(/\d+/g, '').slice(0, 12)),
    legend: (box.renderLegend('sc-roster'), box.els.legend.textContent)
  };
}
/* 今の文字（直す前と同じ）。昼食の区画も同じ見出しを使う */
const NOW = {
  roster: ['２階', '１階', '階未設定'],
  daylist: ['２階入居者', '１階入居者', '階未設定', '２階入居者', '１階入居者', '階未設定'],
  allweek: ['２階入居者', '１階入居者', '階未設定']
};

const NOW_LEGEND = '黄＝入浴あり（入院）＝入院中（合計には計上しない）利用時間帯ごとに居室階（２階→１階）で分け、氏名は五十音順／下段に日別の入浴合計・利用合計';

console.log('— 1. 施設情報が無い・読む前・見本の時は今と一字一句同じ —');
{
  const cases = [
    ['施設情報の部品が無い', null],
    ['部品はあるが読む前（控え無し）', facility(null)],
    ['見本の施設情報（１階・２階）', facility(SAMPLE)],
    ['floors を書いていない施設情報', facility(Object.assign(JSON.parse(J(SAMPLE)), { floors: undefined }))]
  ];
  for (const [label, fac] of cases) {
    const box = makeBox(fac);
    t(label + ': 階の名前は ２階・１階・階未設定', J(box.dcrFloorNames_()) === J({ 0: '階未設定', 1: '１階', 2: '２階' }), box.dcrFloorNames_());
    t(label + ': 区画の見出しは ２階入居者・１階入居者・階未設定', J([2, 1, 0].map(box.dcrFloorSecLabel_)) === J(['２階入居者', '１階入居者', '階未設定']), [2, 1, 0].map(box.dcrFloorSecLabel_));
    const h = headings(box);
    t(label + ': 利用表の階の欄', J(h.roster) === J(NOW.roster), h.roster);
    t(label + ': 一覧表の区画（通所・昼食）', J(h.daylist) === J(NOW.daylist), h.daylist);
    t(label + ': 全員リストの区画', J(h.allweek) === J(NOW.allweek), h.allweek);
    t(label + ': 利用表の凡例は今と同じ文', h.legend === NOW_LEGEND, h.legend);
  }
  const box = makeBox(null);
  t('既定（FLOOR_LABEL）は書き換えない', J(box.FLOOR_LABEL) === J({ 2: '２階', 1: '１階', 0: '階未設定' }), box.FLOOR_LABEL);
  t('並びは ２階 → １階 → 階未設定（FLOOR_ORDER）', J(box.FLOOR_ORDER) === J([2, 1, 0]), box.FLOOR_ORDER);
}

console.log('— 2. 正しい floors だと替わる —');
{
  const alt = [{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }];
  const box = makeBox(facility(withFloors(alt)));
  t('階の名前は施設情報の名前・0 は階未設定のまま', J(box.dcrFloorNames_()) === J({ 0: '階未設定', 1: '一の階', 2: '二の階' }), box.dcrFloorNames_());
  const h = headings(box);
  t('利用表の階の欄が替わる（２階が上のまま）', J(h.roster) === J(['二の階', '一の階', '階未設定']), h.roster);
  t('一覧表の区画は「（名前）入居者」', J(h.daylist) === J(['二の階入居者', '一の階入居者', '階未設定', '二の階入居者', '一の階入居者', '階未設定']), h.daylist);
  t('全員リストの区画も替わる', J(h.allweek) === J(['二の階入居者', '一の階入居者', '階未設定']), h.allweek);
  t('利用表の凡例の階の並びも替わる', h.legend === NOW_LEGEND.replace('２階→１階', '二の階→一の階'), h.legend);
  t('ほかのタブの凡例の文は変わらない（差し込みの印が無い）', (box.renderLegend('sc-daylist'), box.els.legend.textContent.indexOf('上段＝デイ利用者／下段＝デイ休み（２階で昼食）') >= 0 && box.els.legend.textContent.indexOf('{{') < 0));
  /* 全員リストの曜日の見出しの再掲は、名前が替わっても１階の区画の上に出る（名前ではなく階の番号で見る） */
  const reheads = box.els.tblAllweek.children[1].children.map(tr => (tr.className || '').indexOf('rehead') >= 0 ? 'R' : (tr.children[0] && (tr.children[0].className || '').indexOf('sec-h') >= 0 ? 'H:' + tr.children[0].textContent : 'd'));
  t('全員リスト: 曜日の見出しの再掲は１階の区画の直前に1回', J(reheads) === J(['H:二の階入居者', 'd', 'R', 'H:一の階入居者', 'd', 'H:階未設定', 'd']), reheads);
  t('昼食場所の合計（２階合計）は替えない', h.sums.some(s => s.indexOf('２階合計') === 0) && !h.sums.some(s => s.indexOf('二の階') >= 0), h.sums);
  const ttl = textsOf(box.els.tblDaylist, 'cut-title');
  t('「デイ休み（２階で昼食）」は替えない', J(ttl) === J(['デイ休み（２階で昼食）']), ttl);
  const box10 = makeBox(facility(withFloors([{ no: 2, label: '東棟２階' }, { no: 1, label: 'Ａ' }, { no: 3, label: '三の階' }])));
  t('4字ちょうど・1字は使う・並びの順は問わない・3階は見出しを作らない', J(box10.dcrFloorNames_()) === J({ 0: '階未設定', 1: 'Ａ', 2: '東棟２階' }), box10.dcrFloorNames_());
  const boxEvil = makeBox(facility(withFloors([{ no: 1, label: '<b>壱' }, { no: 2, label: '"弐"&' }])));
  const he = headings(boxEvil);
  t('記号の入った名前も文字のまま入る（要素にならない）', J(he.roster.slice(0, 2)) === J(['"弐"&', '<b>壱']) && boxEvil.els.roster.children.every(function chk(n) { return n.tag !== 'b' && (n.children || []).every(chk); }), he.roster);
}

console.log('— 3. 崩れた floors は両方とも既定 —');
{
  const DFLT = J({ 0: '階未設定', 1: '１階', 2: '２階' });
  const broken = [
    ['２階が無い', [{ no: 1, label: '一の階' }]],
    ['１階が無い', [{ no: 2, label: '二の階' }, { no: 3, label: '三の階' }]],
    ['5字', [{ no: 1, label: '一の階' }, { no: 2, label: '東棟の２階' }]],
    ['文字でない（数）', [{ no: 1, label: 1 }, { no: 2, label: '二の階' }]],
    ['空', [{ no: 1, label: '' }, { no: 2, label: '二の階' }]],
    ['空白だけ', [{ no: 1, label: '一の階' }, { no: 2, label: '　 ' }]],
    ['改行入り', [{ no: 1, label: '一の\n階' }, { no: 2, label: '二の階' }]],
    ['同じ階が2つ', [{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }, { no: 2, label: '別の階' }]],
    ['2つが同じ名前', [{ no: 1, label: '同じ階' }, { no: 2, label: '同じ階' }]],
    ['no が文字', [{ no: '1', label: '一の階' }, { no: 2, label: '二の階' }]],
    ['名前が無い', [{ no: 1 }, { no: 2, label: '二の階' }]]
  ];
  for (const [label, floors] of broken) {
    const box = makeBox(fakeFac(() => JSON.parse(J(floors))));
    t(label + ' → 既定', J(box.dcrFloorNames_()) === DFLT, box.dcrFloorNames_());
  }
  /* null の要素は飛ばして読む（ほかが正しければ使う）。su-facility.js はそもそも null を通さない */
  t('null の要素は飛ばす（ほかが正しければ使う）', J(makeBox(fakeFac(() => [null, { no: 1, label: '一の階' }, { no: 2, label: '二の階' }])).dcrFloorNames_()) === J({ 0: '階未設定', 1: '一の階', 2: '二の階' }));
  t('floors が配列でない → 既定', J(makeBox(fakeFac(() => ({ 1: '一の階' }))).dcrFloorNames_()) === DFLT);
  t('floors が例外を出す → 既定', J(makeBox(fakeFac(() => { throw new Error('x'); })).dcrFloorNames_()) === DFLT);
  t('floors が無い部品 → 既定', J(makeBox({ ready: () => true }).dcrFloorNames_()) === DFLT);
  /* 本物の su-facility.js を通した崩れ（11字はそのまま届く・２階が無いと既定に戻る） */
  t('本物の部品で 5字 → 既定', J(makeBox(facility(withFloors([{ no: 1, label: '一の階' }, { no: 2, label: '東棟の２階' }]))).dcrFloorNames_()) === DFLT);
  t('上限は4字', makeBox(null).DCR_FLOOR_NAME_MAX === 4);
  t('本物の部品で２階が無い → 既定（区画も ２階入居者）', makeBox(facility(withFloors([{ no: 1, label: '一の階' }]))).dcrFloorSecLabel_(2) === '２階入居者');
  const hb = headings(makeBox(fakeFac(() => [{ no: 1, label: '一の階' }])));
  t('崩れている時の紙の見出しは今と同じ', J([hb.roster, hb.daylist, hb.allweek]) === J([NOW.roster, NOW.daylist, NOW.allweek]), hb);
}

console.log('— 4. 施設情報が後から届いた時の描き直し —');
{
  let floors = [{ no: 1, label: '１階' }, { no: 2, label: '２階' }];
  const box = makeBox(fakeFac(() => floors));
  t('まだ描いていない時は描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 0, box.calls);
  vm.runInContext('dcrFloorSigUsed = dcrFloorSig_(); DB = { residents: [] };', box);
  t('名前が変わっていなければ描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 0, box.calls);
  floors = [{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }];
  t('名前が変わったら1回描き直す', box.dcrRefreshFloorsIfStale_() === true && box.calls.render === 1, box.calls);
  vm.runInContext('DB = null;', box);
  floors = [{ no: 1, label: '東' }, { no: 2, label: '西' }];
  t('名簿が無ければ描き直さない', box.dcrRefreshFloorsIfStale_() === false && box.calls.render === 1, box.calls);
  const ra = grabFn('renderAll');
  t('描くたびに使った名前を控える（renderAll の最初）', /^\s*function renderAll\(db\) \{\s*dcrFloorSigUsed = dcrFloorSig_\(\);/.test(ra), ra.slice(0, 120));
  t('施設情報が届いた時（onReady）に確かめる', /SUFacility\.onReady\(function \(\) \{ try \{ dcrRefreshFloorsIfStale_\(\); \}/.test(SRC));
}

console.log('— 5. 替えないもの —');
{
  const box = makeBox(facility(withFloors([{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }])));
  t('週間名簿の短い見出しは 2F／1F／未 のまま', J(box.WK_FLR_LABEL) === J({ 2: '2F', 1: '1F', 0: '未' }), box.WK_FLR_LABEL);
  t('週間名簿の右列の見出し「２階」（2階食堂で昼食）は階の名前で替えない（既定は２階・昼食場所の呼び名は daycareNotes だけで替わる・便10）', /hr\.appendChild\(el\('td', 'wk-h', lunchLabel == null \? '２階' : lunchLabel\)\);/.test(SRC) && (SRC.match(/weeklyTable\(ppl, d, dcrFill\('\{\{昼食場所:２階\}\}'\)\)/g) || []).length === 2);
  t('薬用・昼食薬チェックも同じ見出しの関数を通す', /sectionRows\(tbody, f2, dcrFloorSecLabel_\(2\), true, false, false, 2\);/.test(SRC) && /addGroup\(f2, dcrFloorSecLabel_\(2\)\);/.test(SRC) && /addGroup\(f1, dcrFloorSecLabel_\(1\)\);/.test(SRC));
  t('居室の階の見出しの文字（２階入居者・１階入居者）を直接書いた所が残っていない', !/'[２１]階入居者'/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
