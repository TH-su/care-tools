/* デイ利用表の階の区画・曜日の列を施設情報から作る試験（2026-11-14 新設・第6段 K5・代表者の決定 2026-11-13）
   実行: node check/unit/daycare_k5_test.js
   守ること:
     1. 施設情報が無い・見本（2階建て・月〜土）の時は、曜日は月〜土の6列・階は ２階→１階・帳票の幅は今の値（TBL_W）のまま
     2. floors に3階以上があり名前が使える時だけ、上の階から区画を作る（３階→２階→１階→階未設定）。名前が崩れていれば今の２階・１階だけで、その階の方は階未設定に出す
     3. 通所の事業所の days（「月」〜「日」）から曜日の列を作る（日曜営業・土曜休み など）。崩れていれば月〜土。最後の曜日に右の太線
     4. 7日の時は曜日ごとの列幅を縮めて、表の幅を A3縦・A4横の印字幅（1062px）に収める。6日以下は列幅を変えない
     5. 凡例の枚数（週間名簿）と階の並び（利用表）は施設情報の曜日・階で組み、既定では今の文と一字一句同じ
   ★画面の本物の関数と本物の su-facility.js を vm で動かす。利用者・階の名前は架空。 */
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
    grabDecl('DCR_DAYS_DEFAULT'), grabDecl('DCR_COLS'), grabDecl('DCR_W7'), grabFn('dcrDays_'), grabFn('dcrLastDay_'), grabFn('dcrSheetW_'),
    grabFn('dcrFloorExtra_'), grabFn('dcrFloorNos_'), grabFn('dcrFloorOrder_'), grabFn('dcrFloorKey_'),   // 曜日の列と3階以上の階の部品（2026-11-14 第6段 K5）
    grabFn('dcrFloorNames_'), grabFn('dcrFloorLabel_'), grabFn('dcrFloorSecLabel_'), grabFn('dcrFloorSig_'), grabFn('dcrRefreshFloorsIfStale_'),
    grabDecl('DCR_NOTES_KEYS'), grabDecl('DCR_NOTES_WORD_MAX'), grabFn('dcrDaycareNotes_'), grabFn('dcrNotesWord_'),   // 昼食場所の呼び名（便10・施設情報に daycareNotes が無ければ既定）
    grabDecl('byKana'), grabDecl('onDay'), grabDecl('offDay'), grabDecl('countOn'), grabDecl('countOff'), grabDecl('W'), grabDecl('TBL_W'), grabFn('colgroupFor'), grabDecl('DAYLIST_NOTES'), grabFn('wkFlrLabel_'), grabFn('weeklyByFloor'),
    grabFn('toMin'), grabFn('minToLabel'), grabFn('el'), grabFn('roomToFloor'), grabFn('collectDaycare'),
    grabFn('setupSheet'),
    grabFn('dayHeaderRows'), grabFn('dayHeader'), grabFn('deiCells'), grabFn('sectionRows'), grabFn('sumRow'),
    grabFn('renderRoster'), grabFn('renderDaylist'), grabFn('allweekHeaderRow'), grabFn('renderAllweek'),
    grabFn('dcrFill'), grabDecl('LEGENDS'), grabFn('renderLegend')
  ].join('\n'), box);
  return box;
}


/* 架空の施設情報: 3階建て（名前つき）・通所の営業曜日 */
function prof(floors, days) {
  const p = JSON.parse(J(SAMPLE));
  if (floors) p.floors = floors;
  if (days !== undefined) p.offices.forEach(o => { if (o.kind === '通所') o.days = days; });
  return p;
}
const F3 = [{ no: 1, label: '１階' }, { no: 2, label: '２階' }, { no: 3, label: '３階' }];
const day = { s: 540, e: 900, bath: false };
/* 帳票タブが読む形の架空の利用者（days は 0=月 … 6=日 の7つ） */
function model() {
  const p = (pid, floor, ds) => ({ pid, name: '見本 ' + pid, kana: String(pid), floor, hosp: false, days: ds, visitingMed: '' });
  return [p(1, 3, [day, null, null, null, null, null, day]), p(2, 2, [null, day, null, null, null, null, null]), p(3, 1, [day, null, null, null, null, null, null]), p(4, 0, [null, null, day, null, null, null, null])];
}
function rosterDb() {
  const r = (id, room, dows) => ({ id: 'r' + id, name: '見本 ' + id, kana: String(id), room, events: dows.map(d => ({ serviceType: 'daycare', dayOfWeek: d, startTime: '09:00', endTime: '15:00' })) });
  return { residents: [r(1, '301', [0]), r(2, '201', [1]), r(3, '101', [2]), r(4, '', [3])] };
}
const dayTexts = tbl => textsOf(tbl, 'th-day');
const endIdx = tbl => { const out = []; walk(tbl, n => { if ((' ' + n.className + ' ').indexOf(' th-day ') >= 0 && (' ' + n.className + ' ').indexOf(' dend ') >= 0) out.push(n.textContent); }); return out; };

console.log('— 1. 既定（施設情報なし・見本）は今と同じ —');
for (const [label, fac] of [['施設情報の部品が無い', null], ['見本の施設情報', facility(SAMPLE)]]) {
  const box = makeBox(fac);
  t(label + ': 曜日は月〜土', J(box.dcrDays_()) === J([0, 1, 2, 3, 4, 5]), box.dcrDays_());
  t(label + ': 階は ２階→１階→階未設定', J(box.dcrFloorOrder_()) === J([2, 1, 0]), box.dcrFloorOrder_());
  t(label + ': 帳票の幅は今の値（一覧表1058・全員リスト1052・薬用1052）', box.dcrSheetW_('daylist') === 1058 && box.dcrSheetW_('allweek') === 1052 && box.dcrSheetW_('day') === 1052, [box.dcrSheetW_('daylist'), box.dcrSheetW_('allweek'), box.dcrSheetW_('day')]);
  box.renderDaylist(model());
  const dt = dayTexts(box.els.tblDaylist);
  t(label + ': 一覧表の曜日の見出しは 月〜土（上段と下段の再掲）', J(dt) === J(['月', '火', '水', '木', '金', '土', '月', '火', '水', '木', '金', '土']), dt);
  t(label + ': 3階の方（floor 3）は区画が無い（既定の並びに3階は無い）', J(textsOf(box.els.tblDaylist, 'c-sec').filter(s => s)) === J(['２階入居者', '１階入居者', '階未設定', '２階入居者', '１階入居者', '階未設定']), textsOf(box.els.tblDaylist, 'c-sec').filter(s => s));
  box.renderLegend('sc-weekly');
  t(label + ': 週間名簿の凡例は「6曜日を一括で6枚」', box.els.legend.textContent.indexOf('印刷は6曜日を一括で6枚出します') >= 0, box.els.legend.textContent);
  box.renderLegend('sc-roster');
  t(label + ': 利用表の凡例は「２階→１階」', box.els.legend.textContent.indexOf('居室階（２階→１階）') >= 0, box.els.legend.textContent);
}

console.log('— 2. 3階建て —');
{
  const box = makeBox(facility(prof(F3)));
  t('階は ３階→２階→１階→階未設定', J(box.dcrFloorOrder_()) === J([3, 2, 1, 0]), box.dcrFloorOrder_());
  t('居室 301 は 3階', box.dcrFloorKey_(box.roomToFloor('301')) === 3);
  box.renderRoster(rosterDb());
  const rf = textsOf(box.els.roster.children[1], 'col-flr');
  t('利用表の階の欄は ３階・２階・１階・階未設定', J(rf) === J(['３階', '２階', '１階', '階未設定']), rf);
  box.renderDaylist(model());
  const secs = textsOf(box.els.tblDaylist, 'c-sec').filter(s => s);
  t('一覧表の区画は ３階入居者 から（通所・昼食とも）', J(secs) === J(['３階入居者', '２階入居者', '１階入居者', '階未設定', '３階入居者', '２階入居者', '１階入居者', '階未設定']), secs);
  box.renderAllweek(model());
  const rows = box.els.tblAllweek.children[2].children.map(tr => (tr.className || '').indexOf('rehead') >= 0 ? 'R' : (tr.children[0] && (tr.children[0].className || '').indexOf('sec-h') >= 0 ? 'H:' + tr.children[0].textContent : 'd'));
  t('全員リストは ３階 → ２階 → １階 → 階未設定・曜日の見出しの再掲は2つ目の階から', J(rows) === J(['H:３階入居者', 'd', 'R', 'H:２階入居者', 'd', 'R', 'H:１階入居者', 'd', 'H:階未設定', 'd']), rows);
  box.renderLegend('sc-roster');
  t('利用表の凡例は「３階→２階→１階」', box.els.legend.textContent.indexOf('居室階（３階→２階→１階）') >= 0, box.els.legend.textContent);
  const wk = box.weeklyByFloor(model()).map(x => x.flr == null ? '-' : box.wkFlrLabel_(x.flr));
  t('週間名簿の階の印は 3F → 2F → 1F → 未', J(wk) === J(['3F', '2F', '1F', '未']), wk);
}
{
  const bad = [['3階の名前が5字', [...F3.slice(0, 2), { no: 3, label: '東棟の３階' }]], ['3階が２階と同じ名前', [...F3.slice(0, 2), { no: 3, label: '２階' }]], ['3階が2つ', [...F3, { no: 3, label: '別の階' }]]];
  for (const [label, fl] of bad) {
    const box = makeBox(facility(prof(fl)));
    t(label + ' → 今の ２階・１階 だけ（3階の方は階未設定）', J(box.dcrFloorOrder_()) === J([2, 1, 0]) && box.dcrFloorKey_(3) === 0, box.dcrFloorOrder_());
  }
  const box1 = makeBox(facility(prof([{ no: 1, label: '一の階' }, { no: 3, label: '三の階' }])));
  t('２階が無い施設情報 → 今の既定（3階も作らない）', J(box1.dcrFloorOrder_()) === J([2, 1, 0]), box1.dcrFloorOrder_());
}

console.log('— 3. 営業曜日 —');
{
  const box = makeBox(facility(prof(null, ['月', '火', '水', '木', '金', '日'])));
  t('日曜営業・土曜休み → 月火水木金日', J(box.dcrDays_()) === J([0, 1, 2, 3, 4, 6]), box.dcrDays_());
  box.renderDaylist(model());
  const dt = dayTexts(box.els.tblDaylist);
  t('一覧表の曜日の見出しは 月火水木金日', J(dt.slice(0, 6)) === J(['月', '火', '水', '木', '金', '日']) && dt.length === 12, dt);
  t('右の太線は最後の曜日（日）', J(endIdx(box.els.tblDaylist)) === J(['日', '日']), endIdx(box.els.tblDaylist));
  t('6日なので帳票の幅は今の値', box.dcrSheetW_('daylist') === 1058);
  box.renderLegend('sc-weekly');
  t('週間名簿の凡例は 6枚のまま', box.els.legend.textContent.indexOf('印刷は6曜日を一括で6枚出します') >= 0);
}
{
  const box = makeBox(facility(prof(null, ['金', '月', '水'])));
  t('並びの順は問わない（月水金）', J(box.dcrDays_()) === J([0, 2, 4]), box.dcrDays_());
  box.renderDaylist(model());
  box.renderLegend('sc-weekly');
  t('3日なら「3曜日を一括で3枚」', box.els.legend.textContent.indexOf('印刷は3曜日を一括で3枚出します') >= 0, box.els.legend.textContent);
  t('3日の表の幅は曜日の数だけ（24+26+3×168）', box.dcrSheetW_('daylist') === 24 + 26 + 3 * 168, box.dcrSheetW_('daylist'));
}
{
  const box = makeBox(facility(prof(null, ['月', '火', '水', '木', '金', '土', '日'])));
  t('7日', box.dcrDays_().length === 7);
  box.renderDaylist(model());
  t('7日の表の幅は 1062px 以内（一覧表・全員リスト・薬用）', ['daylist', 'allweek', 'day'].every(k => box.dcrSheetW_(k) <= 1062), ['daylist', 'allweek', 'day'].map(k => box.dcrSheetW_(k)));
  const cg = box.els.tblDaylist.children[0];
  const widths = cg.children.slice(2).map(c => c.style.width);
  t('7日の列は氏名66・時刻39 を書き込む', widths.length === 21 && widths.every((w, i) => w === (i % 3 === 0 ? '66px' : '39px')), widths);
}
{
  const box6 = makeBox(facility(SAMPLE));
  box6.renderDaylist(model());
  t('6日の列には幅を書き込まない（CSS の幅のまま）', box6.els.tblDaylist.children[0].children.every(c => !c.style.width), '');
  for (const [label, d] of [['知らない曜日', ['月', '祝']], ['同じ曜日が2つ', ['月', '月']], ['空', []], ['文字でない', [1, 2]], ['配列でない', '月火水']]) {
    const box = makeBox(facility(prof(null, d)));
    t(label + ' → 月〜土', J(box.dcrDays_()) === J([0, 1, 2, 3, 4, 5]), box.dcrDays_());
  }
}

console.log(`\n────────── 合計: ${pass} 件成功 / ${fail} 件失敗 ──────────`);
process.exit(fail ? 1 : 0);
