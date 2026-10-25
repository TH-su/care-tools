/* xss_work_schedule_test.js — ワークスケジュールの innerHTML の全数点検の守り（2026-10-25・本人指示）
 *
 * 公開の work-schedule.html の innerHTML への代入（41か所。insertAdjacentHTML・outerHTML・document.write は0か所）を全部洗った。
 * 形は4つで、利用者・職員の入力（氏名・自由枠の名前・ケア内容・案の名前・サーバーの盤面）が HTML として入る所は無かった＝直す所なし。
 *   1. 空にするだけ（= ''）… 20か所
 *   2. 固定の骨組み（'<span class="am"></span>…' や「なし 🎉」「読み込み中…」）を入れ、値は後から querySelector(…).textContent で入れる … 17か所
 *      未配置トレイ（renderTray）・控えの案（renderAltModal_・openAltModal_）・休みにする（renderAbsentModal_）・アラート一覧（openAlerts）
 *   3. 文字列を組み立てて入れる … 3か所。どれも固定文と数字だけ（業務の値は入らない）
 *      施設情報の定休日（renderFcDow: 曜日の番号と固定の曜日名）／カレンダー（renderCal: 年月日の数字）／
 *      同一建物減算の表（sameBldRender_: 人数・割合・日付。利用者名は数えるだけで表に出さない）
 *   4. 盤面の部品（board.js の el(tag, cls, html)）の第3引数 … 盤面の中では一度も3引数で呼ばれていない（外へも出していない）
 *
 * 固定する約束（利用者・職員の入力に <img src=x onerror=…> や "><script> を入れても、HTML として入る文字列
 * （innerHTML へ入れた文字列）に実行される形＝img・script 要素や属性を抜けた onmouseover が入らない。値は文字として残る＝黙って落とさない）:
 *   W1 未配置トレイ（renderTray）  W2 控えの案（renderAltModal_）  W3 休みにする（renderAbsentModal_）
 *   W4 アラート一覧（openAlerts: 未配置・休憩なし・退避・勤務時間外・重なり）  W5 編集の選択肢（staffOptions・residentDatalist・renderContentChips）
 *   W6 出力タブの昼食後薬（renderExportPane）  W7 カレンダー（renderCal）  W8 施設情報の定休日（renderFcDow）
 *   W9 同一建物減算の表（sameBldRender_）  W10 innerHTML へ組み立てた値を入れる所は上の3か所と el の第3引数だけ（増えたら点検し直す）
 * 実物の画面のソースから関数を切り出して動かす（写経しない）。timescale・model は画面の中の本物をそのまま動かす。
 * WS_HTML で差し替えるのは、ワークスケジュールの正本から作った版・わざと壊した版で確かめる時。固定値の氏名はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const WS = fs.readFileSync(process.env.WS_HTML || path.join(ROOT, 'work-schedule.html'), 'utf8');

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
  const m = new RegExp('\\n[ \\t]*function ' + name + '\\(').exec(src);
  if (!m) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(src, m.index);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
/* 画面の中の部品の区切り（build.sh が入れる「/* ===== src/… ===== *\/」の行） */
function section(src, from, to) {
  const a = src.indexOf('/* ===== ' + from + ' ===== */'), b = src.indexOf('/* ===== ' + to + ' ===== */');
  if (a < 0 || b < 0 || b < a) throw new Error('部品の区切りが見つかりません: ' + from + ' 〜 ' + to);
  return src.slice(a, b);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(String(info).slice(0, 400))); }
}
const EVIL = '<img src=x onerror=alert(1)>';
const BREAK = '"><script>alert(1)</script>';
const ATTR = '" onmouseover="alert(1)';
/* 実行される形が入っていないこと */
function unsafe(h) { return /<img\b/i.test(h) || /<script\b/i.test(h) || /["']\s*onmouseover\s*=/i.test(h); }

/* ── 記録式の偽の DOM ──
 * この画面は「innerHTML に固定の骨組み → querySelector(…).textContent に値」の形がほとんど。
 * innerHTML へ入れた文字列（HTML として解釈される）を LOG.html に、textContent へ入れた文字列（文字のまま）を LOG.text に積む。
 * 合否は「LOG.html のどれにも実行される形が無い」「LOG.text のどれかに入れた値がそのまま残る」 */
const LOG = { html: [], text: [] };
function resetLog() { LOG.html.length = 0; LOG.text.length = 0; }
const htmlAll = () => LOG.html.join('\n');
const textAll = () => LOG.text.join('\n');
function makeEl(tag) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), className: '', title: '', value: '', type: '', disabled: false, hidden: false, selected: false,
    style: {}, children: [], _q: {}, _attrs: {},
    set innerHTML(v) { LOG.html.push(String(v)); this._html = String(v); this.children = []; this._q = {}; },
    get innerHTML() { return this._html || ''; },
    set textContent(v) { LOG.text.push(String(v)); this._text = String(v); this.children = []; },
    get textContent() { return this._text || ''; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeAttribute() {}, focus() {},
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl(sel === 'button' ? 'button' : 'span')); },
    querySelectorAll() { return []; },
    closest() { return null; }
  };
  return e;
}
function fakeDoc() {
  const els = {};
  return {
    els,
    $: (id) => (els[id] = els[id] || makeEl('div')),
    document: {
      createElement: makeEl,
      createTextNode: (s) => { LOG.text.push(String(s)); return { nodeType: 3, data: String(s) }; },
      querySelectorAll: () => [],
      getElementById: (id) => (els[id] = els[id] || makeEl('div'))
    }
  };
}

/* ── 画面の中の本物の timescale・model を動かす ── */
const LOGIC = section(WS, 'src/logic/timescale.js', 'src/logic/shiftbridge.js');
const APP = WS.slice(WS.indexOf('/* ===== src/ui/app.js ===== */'));
const BOARD = section(WS, 'src/ui/board.js', 'src/ui/drag.js');

const dom = fakeDoc();
const box = { $: dom.$, document: dom.document, Date, Math, JSON, String, Number, Object, Array, RegExp };
box.window = box;
vm.createContext(box);
vm.runInContext(LOGIC, box);
vm.runInContext([
  'var M = window.WSModel, TS = window.WSTime;',
  'var B = { kindClass: function (t) { return "k-" + (t && t.kind); } };',
  /* 画面の閉包の中にある値と関数の代わり（描画の外の動き＝保存・通信・切り替えはここでは呼ばれない） */
  'var DAY = null; var store = { get: function () { return DAY; }, dispatch: function () {} };',
  'var settings = { breakMinHours: 7, medColor: "yellow" };',
  'var ui = { currentDate: "2026-10-25", altId: null, editContents: [] };',
  'var calView = null; var ALT_MAX = 5; var ALTS = []; var CARE_DB = null; var USERS = [];',
  'var LUNCH_FIELD_MSG = "この端末（現場用）では変えられません。事務所PCで変えてください";',
  'function todayKey() { return "2026-10-25"; }',
  'function pad2(n) { return n < 10 ? "0" + n : String(n); }',
  grabFn(APP, 'dateObj'),
  'function altList_() { return ALTS; } function altPendHas_() { return false; }',
  'function leaveAlt_() {} function enterAlt_() {} function renameAlt_() {} function promoteAlt_() {} function deleteAlt_() {}',
  'function fieldBlock_() { return false; } function toast() {} function showModal() {} function openEditor() {} function autoPlaceBreak() {}',
  'function planMultiMoves_() { return { ok: true, splits: [] }; } function nightBand_(s, e) { return (s >= 0 && e <= 540) || (s >= 1260 && e <= 1440); }',
  'function careMaskSets_() { return {}; } function loadCareDb() { return CARE_DB; } function wsHospEffective_() { return false; }',
  'function wsIsFieldDevice_() { return false; } function toggleLunchMed_() {} function renderMedColorName_() {}',
  'window.WSExport = { collectDaycare: function () { return USERS; }, MED_COLORS: [] };',
  (APP.match(/\n[ \t]*var FC_DOW_JA = \[[^\]\n]*\];/) || [''])[0],   /* 定休日の曜日名（固定の表）は本物 */
  grabFn(APP, 'oohShown_'),
  grabFn(APP, 'renderTray'), grabFn(APP, 'renderAltModal_'), grabFn(APP, 'renderAbsentModal_'), grabFn(APP, 'openAlerts'),
  grabFn(APP, 'staffOptions'), grabFn(APP, 'residentDatalist'), grabFn(APP, 'renderContentChips'),
  grabFn(APP, 'renderExportPane'), grabFn(APP, 'renderCal'), grabFn(APP, 'renderFcDow'), grabFn(APP, 'sameBldRender_')
].join('\n'), box);

/* 架空の1日。職員の氏名・利用者名・自由枠の名前・ケア内容に入れる */
function evilDay() {
  return {
    meta: { date: '2026-10-25' },
    columns: [{ col: 0, staffIds: ['s1'] }, { col: 1, staffIds: ['s2'] }],
    staff: [
      { id: 's1', name: EVIL, zone: 'visit', workStart: 480, workEnd: 1020 },        /* 8:00-17:00・休憩なし＝休憩のアラートに出る */
      { id: 's2', name: BREAK + ATTR, zone: 'facility', workStart: 540, workEnd: 720, absent: true }
    ],
    tasks: [
      { id: 't1', kind: 'care', residentName: EVIL, svcCode: '身体1', contents: [BREAK, '排泄'], staffId: null, start: 600, end: 630 },
      { id: 't2', kind: 'free', label: ATTR + EVIL, contents: [], staffId: null, start: 660, end: 690, bumped: { from: 's1' } },
      { id: 't3', kind: 'care', residentName: BREAK, svcCode: 'x' + ATTR, contents: [EVIL], staffId: 's1', start: 1080, end: 1110 },   /* 勤務時間外 */
      { id: 't4', kind: 'care', residentName: '見本甲' + EVIL, contents: [], staffId: 's1', start: 600, end: 660 },
      { id: 't5', kind: 'facility', label: BREAK, contents: [], staffId: 's1', start: 630, end: 700 }                                  /* t4 と重なる */
    ]
  };
}

console.log('— ワークスケジュール —');

/* W1 未配置トレイ（trayItems ← renderTray） */
resetLog(); box.DAY = evilDay();
box.renderTray(box.DAY);
t('W1 未配置トレイ：利用者名・自由枠の名前・ケア内容に入れても実行される形にならない', !unsafe(htmlAll()), htmlAll());
t('W1 値は文字として残る', textAll().includes(EVIL) && textAll().includes(BREAK), textAll());

/* W2 控えの案（altList ← renderAltModal_） */
resetLog(); box.ALTS = [{ id: 'a1' + ATTR, name: EVIL, updatedAt: '2026-10-25T09:00:00' }, { id: 'a2', name: BREAK }];
box.renderAltModal_();
t('W2 控えの案：案の名前に入れても実行される形にならない', !unsafe(htmlAll()), htmlAll());
t('W2 値は文字として残る', textAll().includes(EVIL) && textAll().includes(BREAK), textAll());

/* W3 休みにする（absStaff・absCand ← renderAbsentModal_） */
resetLog(); box.DAY = evilDay();
box.renderAbsentModal_();
t('W3 休みにする：職員の氏名・未配置の利用者名・候補の職員名に入れても実行される形にならない', !unsafe(htmlAll()), htmlAll());
t('W3 値は文字として残る', textAll().includes(EVIL) && textAll().includes(BREAK + ATTR), textAll());

/* W4 アラート一覧（alUn・alBr・alBump・alOoh・alOv ← openAlerts） */
resetLog(); box.DAY = evilDay();
box.openAlerts();
const al = textAll();
t('W4 アラート一覧：未配置・休憩なし・退避・勤務時間外・重なりの名前に入れても実行される形にならない', !unsafe(htmlAll()), htmlAll());
t('W4 5つの一覧が全部出ている（試験の前提）',
  ['alUn', 'alBr', 'alBump', 'alOoh', 'alOv'].every((id) => dom.els[id] && dom.els[id].children.length > 0),
  ['alUn', 'alBr', 'alBump', 'alOoh', 'alOv'].map((id) => id + ':' + (dom.els[id] ? dom.els[id].children.length : '-')).join(' '));
t('W4 値は文字として残る（職員の氏名・利用者名・自由枠の名前）', al.includes(EVIL) && al.includes(BREAK) && al.includes(ATTR + EVIL), al);

/* W5 編集の選択肢（edStaff・dlResidents・edContents） */
resetLog(); box.DAY = evilDay(); box.ui.editContents = [EVIL, BREAK];
box.staffOptions('s1'); box.residentDatalist(); box.renderContentChips();
t('W5 編集の選択肢：職員の氏名・利用者名の候補・自分で足したケア内容に入れても実行される形にならない', !unsafe(htmlAll()), htmlAll());
t('W5 値は文字として残る', textAll().includes(EVIL) && textAll().includes(BREAK), textAll());

/* W6 出力タブの昼食後薬（exMedList ← renderExportPane） */
resetLog(); box.CARE_DB = { residents: [] }; box.USERS = [{ name: EVIL, lunchMed: true }, { name: BREAK, lunchMed: false }];
box.renderExportPane();
t('W6 昼食後薬のボタン：デイ利用者の氏名に入れても実行される形にならない', !unsafe(htmlAll()), htmlAll());
t('W6 値は文字として残る', textAll().includes(EVIL) && textAll().includes(BREAK), textAll());

/* W7 カレンダー（calGrid ← renderCal）。表示中の日付（URL の #日付 から来る）が日付でなくても数字しか入らない */
resetLog(); box.ui.currentDate = '2026-10-25' + ATTR;
box.calView = { y: 2026, m: 9 };
box.renderCal();
t('W7 カレンダー：表示中の日付が壊れていても実行される形にならない', !unsafe(htmlAll()) && /data-date="2026-10-01"/.test(htmlAll()), htmlAll());
resetLog(); box.calView = (function () { const d = box.dateObj(EVIL); return { y: d.getFullYear(), m: d.getMonth() }; })();
box.renderCal();
t('W7 カレンダー：日付として読めない値から月を作っても実行される形にならない', !unsafe(htmlAll()), htmlAll());
box.ui.currentDate = '2026-10-25';

/* W8 施設情報の定休日（fcClosedDay ← renderFcDow）。保存された定休日の値は印に使うだけで HTML に入らない */
resetLog();
box.renderFcDow([0, EVIL, ATTR, BREAK]);
t('W8 定休日：保存された値が壊れていても実行される形にならない', !unsafe(htmlAll()) && htmlAll().includes('data-dow="0" checked'), htmlAll());

/* W9 同一建物減算の表（stSameBldOut ← sameBldRender_ の html）。数字と日付だけで、利用者名は出さない */
{
  const periods = box.WSModel.sameBuildingPeriods('2026-10-25');
  const days = [
    { date: '2026-10-01', tasks: [{ kind: 'care', residentName: EVIL, staffId: 's1', start: 600, end: 630, svcCode: BREAK }] },
    { date: '2026-10-02', tasks: [{ kind: 'care', residentName: BREAK, staffId: 's1', start: 600, end: 630, label: ATTR }] }
  ];
  const ext = (nm) => (nm === EVIL ? false : (nm === BREAK ? true : undefined));
  const kind = (nm) => (nm === EVIL || nm === BREAK ? 'kaigo' : undefined);
  const res = box.sameBldRender_({ days, missing: [], failed: [], failedKeys: 0, fromGoogle: 0 }, ext, kind, periods, '2026-10-25');
  t('W9 同一建物減算の表：利用者名・サービスコードに入れても表に実行される形が入らない', !unsafe(res.html), res.html);
  t('W9 表に利用者名を出さない（数えるだけ）', !res.html.includes('alert(1)') && /<td>2026-10<\/td>/.test(res.html), res.html.slice(0, 400));
}

/* W10 innerHTML へ組み立てた値を入れる所が増えていない（増えたら点検し直してここを足す） */
{
  const re = /([A-Za-z_$][\w$.]*(?:\([^()]*\))?)\.innerHTML\s*(\+?=)\s*([^;\n]*)/g;
  const built = [];
  let m, n = 0;
  while ((m = re.exec(WS))) {
    n++;
    const rhs = m[3].trim();
    if (m[2] === '=' && /^'[^']*'$/.test(rhs)) continue;   /* 空・固定文 */
    built.push(m[1] + '.innerHTML ' + m[2] + ' ' + rhs);
  }
  const known = ['e.innerHTML = html', 'host.innerHTML = html', "$('calGrid').innerHTML = h", 'outEl.innerHTML = res.html'];
  const extra = built.filter((s) => !known.some((k) => s.endsWith(k)));   /* 既知の右辺に値を足した形も「増えた」とみなす（10/25 反証レビュー指摘2） */
  const total = (WS.match(/\.innerHTML\s*\+?=(?!=)/g) || []).length;   /* 受け手の書き方（arr[0].innerHTML など）を問わず全部数える */
  t('W10 innerHTML への代入は点検した41か所のまま（増えたら点検して表に足してから通す）', total === 41, total);
  t('W10 組み立てた値を入れる所は el・renderFcDow・renderCal・sameBldRender_ の4か所だけ（全 ' + n + ' か所）', extra.length === 0 && built.length === 4, built.join(' / '));
  t('W10 insertAdjacentHTML・outerHTML への代入・document.write は使っていない',
    !/insertAdjacentHTML|\.outerHTML\s*\+?=|document\.write/.test(WS), (WS.match(/insertAdjacentHTML|\.outerHTML\s*\+?=|document\.write/) || [''])[0]);
  /* el(tag, cls, html) の第3引数は盤面の中で使っていない＝固定文すら入らない */
  const calls = BOARD.replace(/function\s+el\(/g, 'function _def_(').match(/(?:^|[^\w.$])el\(([^()]|\([^()]*\))*\)/g) || [];
  const three = calls.filter((c) => { const s = c.slice(c.indexOf('el(') + 3, -1); let d = 0, k = 0; for (const ch of s) { if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--; else if (ch === ',' && d === 0) k++; } return k >= 2; });
  t('W10 盤面の el(tag, cls, html) は第3引数（HTML）で呼ばれていない・外へ出していない',
    calls.length > 10 && three.length === 0 && !/window\.WSBoard\s*=\s*\{[^}]*\bel\s*:/.test(BOARD),
    three.join(' / '));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
