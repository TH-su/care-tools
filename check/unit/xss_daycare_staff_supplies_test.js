/* xss_daycare_staff_supplies_test.js — デイ利用表・職員マスタ・消耗品管理の「HTML の文字列を入れない」組み立ての守り（2026-10-25・本人指示）
 *
 * 3つの画面（daycare-roster.html・staff-master.html と staff-master-calc.js・supplies.html と supplies-calc.js）を全数点検した。
 * innerHTML・outerHTML・insertAdjacentHTML・document.write・srcdoc は5本とも0か所。画面は createElement と textContent・
 * createTextNode で組み立てていて、氏名・かな・メモ・品目名・書類名・サーバーの文は文字として入る。
 * 属性に入れる所（setAttribute の aria-label・title・data-*・value）は文字のまま入り、HTML として読まれない。
 * URL を入れる所は2か所で、どちらも形を確かめてから入れている:
 *   職員マスタの書類の「開く」… 書類の番号が英数字・_・- だけの時（FID_RE）にだけ drive.google.com の URL を作る
 *   職員マスタの委員会の「要件を確認できるページ」… http:// か https:// で始まる時（cmtUrlNg）だけ href に入れる
 * 直す所は無かった。
 *
 * 固定する約束（利用者・職員の入力やサーバーの値に <img src=x onerror=…>・"><script>・属性を抜ける " onmouseover=" を入れても、
 * 出来上がった画面の部品に img・script の要素や on〜 の属性・javascript: の URL が入らない。値は文字として残る＝黙って落とさない）:
 *   Z  5本のファイルで innerHTML・outerHTML・insertAdjacentHTML・document.write・srcdoc・createContextualFragment・
 *      DOMParser が0か所のまま（今後足されたら落ちる。足すなら esc を通して別の点検表を作る）
 *   D  デイ利用表：組み立ての小道具（el）／利用表と昼食の区画の行（sectionRows・deiCells）／週の名簿（weeklyTable）／
 *      非表示と☆の設定の一覧（renderHideList・renderStarList）
 *   S  職員マスタ：組み立ての小道具（h）／一覧の行（buildRow。見るだけの時と一括編集の時）／書類の一覧（renderFiles）／
 *      委員会の URL の門（cmtUrlNg。javascript: 等は href に入れない）
 *   P  消耗品管理：組み立ての小道具（h・svgEl）／入出庫の表（renderMoveTable）／種別の編集（renderCats）
 * 実物の画面のソースから関数を切り出して、最小の偽の document（createElement・textContent・appendChild・setAttribute を
 * 記録するだけ。innerHTML に入れようとしたら例外）で動かす。DAYCARE_HTML・STAFF_HTML・SUPPLIES_HTML（と STAFF_CALC_JS・
 * SUPPLIES_CALC_JS）で差し替えるのは、わざと壊した版で落ちるかの確認用。固定値の氏名・品目はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const rd = (env, name) => fs.readFileSync(process.env[env] || path.join(ROOT, name), 'utf8');
const DC = rd('DAYCARE_HTML', 'daycare-roster.html');
const SM = rd('STAFF_HTML', 'staff-master.html');
const SMC = rd('STAFF_CALC_JS', 'staff-master-calc.js');
const SP = rd('SUPPLIES_HTML', 'supplies.html');
const SPC = rd('SUPPLIES_CALC_JS', 'supplies-calc.js');

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
  const pe = scanBlock(src, m.index + m[0].length - 1, '(', ')');
  const end = pe < 0 ? -1 : scanBlock(src, pe);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
/* const/var X = …; の文（括弧の深さ0の ; まで）。表や小さな矢印関数を本物のまま使う */
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
/* 正規表現の中に引用符を含む行は、行の形で取る */
function grabLine(src, re) { const m = re.exec(src); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(String(info).slice(0, 400))); }
}
const EVIL = '<img src=x onerror=alert(1)>';
const BREAK = '"><script>alert(1)</script>';
const ATTR = '" onmouseover="alert(1)';

/* ══════════════ Z HTML の文字列を入れる書き方が0か所 ══════════════ */
console.log('— HTML の文字列を入れる書き方の数 —');
const SINK = /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\bsrcdoc\b|createContextualFragment|DOMParser|parseFromString/g;
[['デイ利用表', DC], ['職員マスタ', SM], ['職員マスタの計算部品', SMC], ['消耗品管理', SP], ['消耗品管理の計算部品', SPC]].forEach(([nm, src]) => {
  const hit = src.match(SINK) || [];
  t('Z ' + nm + '：innerHTML・outerHTML・insertAdjacentHTML・document.write・srcdoc 等は0か所', hit.length === 0, hit.join(','));
});

/* ══════════════ 偽の document（作った部品を記録するだけ） ══════════════ */
const textNode = (s) => ({ nodeType: 3, textContent: String(s) });
function FNode(tag) {
  this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.attrs = {}; this.childNodes = []; this.dataset = {};
  this.style = { setProperty() {}, removeProperty() {}, cssText: '' }; this.className = ''; this.hidden = false;
  this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
FNode.prototype = {
  setAttribute(k, v) { this.attrs[String(k)] = String(v); },
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
  removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
  appendChild(c) { if (c && c.isFrag) { this.childNodes.push(...c.childNodes); c.childNodes = []; } else this.childNodes.push(c); return c; },
  append(...cs) { cs.forEach((c) => this.appendChild(typeof c === 'object' ? c : textNode(c))); },
  replaceChildren(...cs) { this.childNodes = []; this.append(...cs); },
  insertBefore(c) { return this.appendChild(c); },
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
  get firstChild() { return this.childNodes[0] || null; },
  get options() { return this.children.filter((c) => c.tagName === 'OPTION').map((o) => ({ value: o.getAttribute('value') != null ? o.getAttribute('value') : o.textContent })); },
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); },
  set textContent(v) { this.childNodes = (v === '' || v == null) ? [] : [textNode(v)]; },
  /* HTML の文字列は受け付けない＝画面のコードが innerHTML 等に替わったら、ここで落ちる */
  get innerHTML() { throw new Error('innerHTML を読もうとした'); },
  set innerHTML(v) { throw new Error('innerHTML に入れようとした: ' + String(v).slice(0, 80)); },
  set outerHTML(v) { throw new Error('outerHTML に入れようとした'); },
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML を使った'); },
  addEventListener() {}, removeEventListener() {}, remove() {}, focus() {}, click() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
};
function fakeDoc() {
  const byId = {};
  const doc = {
    createElement: (tag) => new FNode(tag),
    createElementNS: (ns, tag) => new FNode(tag),
    createTextNode: (s) => textNode(s),
    createDocumentFragment: () => Object.assign(new FNode('#frag'), { isFrag: true }),
    getElementById: (id) => (byId[id] = byId[id] || Object.assign(new FNode('div'), { id })),
    querySelector: () => null, querySelectorAll: () => [],
    write() { throw new Error('document.write を使った'); },
    byId
  };
  doc.body = new FNode('body'); doc.head = new FNode('head'); doc.documentElement = new FNode('html');
  return doc;
}

/* 作った部品の木を歩いて、実行される形が無いかを調べる */
const INTERNAL = new Set(['tagName', 'nodeType', 'attrs', 'childNodes', 'dataset', 'style', 'className', 'classList', 'isFrag']);
function audit(root) {
  const bad = [], strs = [];
  (function walk(n) {
    if (!n) return;
    if (n.nodeType === 3) { strs.push(n.textContent); return; }
    if (/^(IMG|SCRIPT|IFRAME|OBJECT|EMBED|SVG:SCRIPT)$/.test(n.tagName)) bad.push('要素 ' + n.tagName);
    Object.keys(n.attrs || {}).forEach((k) => {
      if (/^on/i.test(k)) bad.push('属性 ' + k);
      if (/^(href|src|action|formaction|xlink:href)$/i.test(k) && /^\s*javascript:/i.test(n.attrs[k])) bad.push('URL ' + k);
      strs.push(n.attrs[k]);
    });
    Object.keys(n).forEach((k) => {
      if (INTERNAL.has(k)) return;
      const v = n[k];
      if (/^on/i.test(k) && typeof v === 'string') bad.push('プロパティ ' + k);
      if (/^(href|src|action)$/i.test(k) && typeof v === 'string' && /^\s*javascript:/i.test(v)) bad.push('URL ' + k);
      if (typeof v === 'string') strs.push(v);
    });
    Object.keys(n.dataset || {}).forEach((k) => strs.push(String(n.dataset[k])));
    (n.childNodes || []).forEach(walk);
  })(root);
  return { bad, strs };
}
/* 部品に実行される形が無く、悪い値が文字のまま（崩れず・落とされず）残っていること */
function safeAndKept(root, values) {
  const a = audit(root);
  const lost = values.filter((v) => !a.strs.some((s) => s.includes(v)));
  return { ok: a.bad.length === 0 && lost.length === 0, info: a.bad.concat(lost.map((v) => '文字として残っていない: ' + v)).join(' / ') };
}

/* ══════════════ D デイ利用表 ══════════════ */
console.log('\n— デイ利用表 —');
/* 部品が innerHTML 等に替わると偽の document が例外を出す。例外も失敗として数え、続きの画面も調べる */
try {
  const document = fakeDoc();
  const box = { document, console: { log() {}, warn() {}, error() {} }, setTimeout() { return 0; }, clearTimeout() {} };
  vm.createContext(box);
  vm.runInContext([
    'function $(id) { return document.getElementById(id); }',
    'function dcrIsField_() { return false; } function dcrClinicLabel_() { return "架空クリニック"; }',
    'var HIDE_CANDIDATES = [];',
    grabConst(DC, 'DAYS_JA'), grabConst(DC, 'NDAY'), grabConst(DC, 'DCR_FIELD_MSG'), grabConst(DC, 'onDay'), grabConst(DC, 'offDay'),
    grabConst(DC, 'countOff'), grabConst(DC, 'FLOOR_ORDER'), grabConst(DC, 'WK_FLR_LABEL'),
    grabFn(DC, 'el'), grabFn(DC, 'minToLabel'), grabFn(DC, 'deiCells'), grabFn(DC, 'sectionRows'),
    grabFn(DC, 'weeklyByFloor'), grabFn(DC, 'wkNameSpaced'), grabFn(DC, 'weeklyTable'),
    grabFn(DC, 'renderHideList'), grabFn(DC, 'renderStarList')
  ].join('\n'), box);

  /* D0 el：文字は textContent に入る */
  const e0 = box.el('td', 'c-nm', EVIL);
  const r0 = safeAndKept(e0, [EVIL]);
  t('D0 el：文字は要素にならず文字として入る', r0.ok && e0.childNodes.length === 1 && e0.childNodes[0].nodeType === 3, r0.info);

  /* 架空の利用者。氏名に悪い値を入れる（月〜土に通所・入浴あり・入院あり・訪問診療の曜日あり） */
  const day = { s: 600, e: 960, bath: true };
  const ppl = [
    { pid: 1, name: EVIL, floor: 2, hosp: false, days: [day, day, null, day, null, day], visitingMed: '水', star: true, nameCut: 2 },
    { pid: 2, name: BREAK, floor: 1, hosp: true, days: [null, day, day, null, day, null], visitingMed: '月' },
    { pid: 3, name: ATTR, floor: 0, hosp: false, days: [day, null, null, null, null, null] }
  ];
  /* D1 利用表（通所の区画）と昼食の区画 */
  const tb1 = new FNode('tbody');
  box.sectionRows(tb1, ppl, '２階入居者' + EVIL, true, true, false, 2);
  const r1 = safeAndKept(tb1, [EVIL, BREAK, ATTR]);
  t('D1 利用表の区画（sectionRows・deiCells）：氏名・区画名に入れても要素や on〜 にならず文字として残る', r1.ok && tb1.children.length > 0, r1.info);
  const tb2 = new FNode('tbody');
  box.sectionRows(tb2, ppl, '昼食', false, false, true, 2);
  const r2 = safeAndKept(tb2, [EVIL, BREAK, ATTR]);
  t('D1 昼食の区画（☆の欄つき）：氏名に入れても要素や on〜 にならず文字として残る', r2.ok && tb2.children.length > 0, r2.info);

  /* D2 週の名簿 */
  const wk = box.weeklyTable(ppl, 0);
  const r3 = safeAndKept(wk, [BREAK]);
  t('D2 週の名簿（weeklyTable）：氏名に入れても要素や on〜 にならず文字として残る', r3.ok, r3.info);
  /* 姓と名のあいだに全角の空白を入れる人（切れ目つき・空白入り）は文字が割れるので、実行される形が無いことだけ見る */
  const wk2 = box.weeklyTable(ppl, 2);
  const a3 = audit(wk2);
  t('D2 週の名簿：姓と名を割る氏名でも要素や on〜 にならない', a3.bad.length === 0 && a3.strs.some((s) => s.includes('<img')), a3.bad.join(','));

  /* D3 非表示と☆の設定の一覧（氏名・かな・番号。aria-label にも氏名が入る） */
  box.HIDE_CANDIDATES = [{ name: EVIL, kana: BREAK, hidden: true, star: false, rid: ATTR, masterId: 'm1' + ATTR },
                         { name: ATTR, kana: '', hidden: false, star: true, rid: 'r2', masterId: null }];
  box.renderHideList();
  const r4 = safeAndKept(document.byId.hideList, [EVIL, BREAK, ATTR]);
  t('D3 非表示の設定の一覧（renderHideList）：氏名・かな・番号に入れても要素や on〜 にならず文字として残る', r4.ok, r4.info);
  box.renderStarList();
  const r5 = safeAndKept(document.byId.starList, [EVIL, BREAK, ATTR]);
  t('D3 ☆の設定の一覧（renderStarList）：同じ', r5.ok, r5.info);
} catch (e) { t('デイ利用表：描く関数が例外なく動く（innerHTML 等に替わっていない）', false, e && e.message); }

/* 職員マスタと消耗品管理の組み立ての小道具 h は同じ形。共通の確かめ */
function checkH(nm, box) {
  const n = box.h('div', { text: EVIL, title: BREAK, 'aria-label': ATTR, 'data-x': EVIL, val: BREAK, cls: ATTR },
    [EVIL, box.h('span', { text: BREAK })]);
  const r = safeAndKept(n, [EVIL, BREAK, ATTR]);
  t(nm + '：h の text・title・aria-label・data-*・value・子の文字に入れても要素や on〜 にならず文字として残る', r.ok, r.info);
  const b = box.h('button', { onclick: () => {} });
  t(nm + '：h の on〜 は関数の時だけ動きとして付く（属性にはならない）', !Object.keys(b.attrs).some((k) => /^on/i.test(k)), JSON.stringify(b.attrs));
}

/* ══════════════ S 職員マスタ ══════════════ */
console.log('\n— 職員マスタ —');
try {
  const document = fakeDoc();
  const window = {};
  const box = { document, window, console: { log() {}, warn() {}, error() {} }, setTimeout() { return 0; }, clearTimeout() {},
                localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  vm.createContext(box);
  vm.runInContext(SMC, box);   /* 計算部品（StaffCalc）は本物を読む */
  vm.runInContext([
    grabFn(SM, '\\$'), grabFn(SM, 'txt'), grabFn(SM, 'h'), grabFn(SM, 'clearNode'), grabFn(SM, 'SC'),
    grabConst(SM, 'DATE_RE'), grabConst(SM, 'ST'), grabConst(SM, 'FILE_KINDS'), grabConst(SM, 'FID_RE'),
    grabConst(SM, 'LIST_COLS'), grabConst(SM, 'CMT_URL_MAX'), grabConst(SM, 'CMT_URL_RE'), grabConst(SM, 'CMT_URL_NG_MSG'), grabConst(SM, 'CMT_URL_LONG_MSG'),
    grabFn(SM, 'cmtUrlNg'),
    'function openDetail() {} function removeFileEntry() {} function cmtRowText(row) { return String(row.cmtText || ""); }',
    'var DETAIL_FILES = []; function detailFiles() { return DETAIL_FILES; }',
    ...['asOfDate', 'jpDate', 'statusInfo', 'labelOf', 'toArr', 'visibleCols', 'cellValue', 'qualsText', 'tenureText', 'buildRow',
        'viewText', 'buildCellEditor', 'setCellDateTitle', 'warekiOf', 'mergedRow', 'rowErrors', 'markRowState',
        'fileKindLabel', 'fmtBytes', 'fmtAdded', 'renderFiles', 'addKeptOption', 'enumPairs', 'isManagedEnum', 'choicePairs', 'serverEnumList', 'serverEnumLabel'].map((n) => grabFn(SM, n))
  ].join('\n'), box);

  checkH('S0 職員マスタ', box);

  /* S1 一覧の行。氏名・かな・職名・メモ・番号など、文字の列すべてに悪い値を入れる */
  const row = { id: 's1' + ATTR, name: EVIL, kana: BREAK, jobTitle: ATTR, legacyNo: EVIL, hireDate: '2020-04-01', note: EVIL,
                primarySite: BREAK, cmtText: EVIL, qualsJson: JSON.stringify([{ code: EVIL }]) };
  vm.runInContext('ST.byId = {}; ST.byId[' + JSON.stringify(row.id) + '] = ' + JSON.stringify(row) + '; ST.cmtCol = true; ST.bulk = false;', box);
  const tr = box.buildRow(row);
  const r1 = safeAndKept(tr, [EVIL, BREAK]);
  t('S1 一覧の行（見るだけ）：氏名・かな・職名・番号・事業所に入れても要素や on〜 にならず文字として残る', r1.ok && tr.children.length > 3, r1.info);
  vm.runInContext('ST.bulk = true;', box);
  const tr2 = box.buildRow(row);
  const r2 = safeAndKept(tr2, [EVIL, BREAK]);
  t('S1 一覧の行（一括編集の入力欄）：入力欄の値・aria-label に入れても要素や on〜 にならず文字として残る', r2.ok && tr2.children.length > 3, r2.info);
  vm.runInContext('ST.bulk = false;', box);

  /* S2 書類の一覧（書類名・ファイル名はサーバーの文）。番号が形に合わない時は「開く」の URL を作らない */
  box.DETAIL_FILES = [{ fid: 'abc_DEF-123', kind: 'license', title: EVIL, name: BREAK, size: 2048, addedAt: '2026-10-01T00:00:00Z' },
                      { fid: 'javascript:alert(1)', kind: EVIL, title: ATTR, name: EVIL, size: EVIL, addedAt: EVIL },
                      { fid: '"><img src=x onerror=alert(1)>', title: '', name: '' }];
  vm.runInContext('DETAIL_FILES = this.DETAIL_FILES;', box);
  box.renderFiles();
  const fb = document.byId.fdBody;
  const r3 = safeAndKept(fb, [EVIL, BREAK, ATTR]);
  const hrefs = [];
  (function walk(n) { if (n && n.nodeType === 1) { if (n.attrs.href) hrefs.push(n.attrs.href); n.childNodes.forEach(walk); } })(fb);
  t('S2 書類の一覧（renderFiles）：書類名・ファイル名・種類に入れても要素や on〜 にならず文字として残る', r3.ok, r3.info);
  t('S2 書類の「開く」は形の正しい番号の1件だけ・drive.google.com の URL だけ', hrefs.length === 1 && hrefs[0] === 'https://drive.google.com/file/d/abc_DEF-123/view', JSON.stringify(hrefs));

  /* S3 委員会の「要件を確認できるページ」。打った URL を href に入れるのは cmtUrlNg が空（＝http(s):// で始まる）の時だけ */
  const ngs = ['javascript:alert(1)', ' javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,' + EVIL, ATTR, '//example.invalid/' + EVIL];
  t('S3 委員会の URL：javascript:・data:・属性を抜ける形・// で始まる形は差し戻す（href に入らない）', ngs.every((v) => box.cmtUrlNg(v) !== ''), ngs.filter((v) => box.cmtUrlNg(v) === '').join(' / '));
  t('S3 委員会の URL：https:// で始まる形は通す', box.cmtUrlNg('https://example.invalid/page') === '' && box.cmtUrlNg('http://example.invalid/') === '', '');
} catch (e) { t('職員マスタ：描く関数が例外なく動く（innerHTML 等に替わっていない）', false, e && e.message); }

/* ══════════════ P 消耗品管理 ══════════════ */
console.log('\n— 消耗品管理 —');
try {
  const document = fakeDoc();
  const window = {};
  const box = { document, window, console: { log() {}, warn() {}, error() {} }, setTimeout() { return 0; }, clearTimeout() {},
                localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  vm.createContext(box);
  vm.runInContext(SPC, box);   /* 計算部品（SuppliesCalc）は本物を読む */
  vm.runInContext([
    grabFn(SP, '\\$'), grabFn(SP, 'txt'), grabFn(SP, 'h'), grabFn(SP, 'clearNode'), grabFn(SP, 'svgEl'), grabFn(SP, 'SPL'),
    grabConst(SP, 'DATE_RE'), grabConst(SP, 'ST'), grabConst(SP, 'TYPE_LABEL'), grabConst(SP, 'MODES'), grabConst(SP, 'MODE_LABEL'),
    'function askVoidMove() {} function nameOf(id) { return (ST.roster.find(function (r) { return r.id === id; }) || {}).name || ""; }',
    ...['setState', 'fmtInt', 'yen', 'jpDate', 'ymOf', 'clip', 'isFieldDevice', 'isAdmin', 'residentLabel', 'itemById', 'unitsOf',
        'unitName', 'minIdxOf', 'billIdxOf', 'isClosed', 'moveQtyText', 'canVoid', 'renderMoveTable',
        'catM1000', 'dec1', 'catUsedCount', 'renderCats'].map((n) => grabFn(SP, n))
  ].join('\n'), box);

  checkH('P0 消耗品管理', box);
  const sv = box.svgEl('text', { x: EVIL, 'aria-label': BREAK });
  t('P0 消耗品管理：svgEl の属性に入れても on〜 にならず文字として残る', safeAndKept(sv, [EVIL, BREAK]).ok, JSON.stringify(sv.attrs));

  /* P1 入出庫の表（品目名・単位名・入居者の氏名・メモ・種類はサーバーの文） */
  vm.runInContext('ST.role = "admin"; ST.closed = []; ST.roster = [{ id: "R1", name: ' + JSON.stringify(EVIL) + ' }];'
    + 'ST.byId = { i1: { id: "i1", name: ' + JSON.stringify(BREAK) + ', billType: "unit", billIdx: 0, units: [{ name: ' + JSON.stringify(ATTR) + ', per: 1 }] } };', box);
  const body = new FNode('tbody'), wrap = new FNode('div');
  box.renderMoveTable(body, wrap, 'mvState', [
    { id: 'm1', date: '2026-10-01', itemId: 'i1', type: 'out', qty: 2, qtyBill: 2, residentId: 'R1', amount: 300, note: EVIL },
    { id: 'm2', date: EVIL, itemId: 'nope' + ATTR, type: EVIL, qty: EVIL, residentId: BREAK, note: ATTR, voided: true }
  ], true);
  const r1 = safeAndKept(body, [EVIL, BREAK, ATTR]);
  t('P1 入出庫の表（renderMoveTable）：品目名・単位・入居者・メモ・日付・種類に入れても要素や on〜 にならず文字として残る', r1.ok && body.children.length === 2, r1.info);

  /* P2 種別の編集（種別名は入力欄の値として入る） */
  vm.runInContext('ST.catDraft = null; ST.items = []; ST.cats = [{ id: "c1' + ATTR.replace(/"/g, '\\"') + '", name: ' + JSON.stringify(EVIL) + ', order: 1, mode: ' + JSON.stringify(BREAK) + ' }];', box);
  box.renderCats();
  const r2 = safeAndKept(document.byId.catBody, [EVIL]);
  t('P2 種別の編集（renderCats）：種別名に入れても要素や on〜 にならず入力欄の値として残る', r2.ok && document.byId.catBody.children.length === 1, r2.info);
} catch (e) { t('消耗品管理：描く関数が例外なく動く（innerHTML 等に替わっていない）', false, e && e.message); }

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
