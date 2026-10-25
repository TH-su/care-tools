/* xss_shift_test.js — シフト作成とシフト分析の innerHTML の全数点検の守り（2026-10-25・本人指示）
 *
 * 2つの画面の innerHTML・insertAdjacentHTML・outerHTML・document.write への代入を全部洗い、入る値が職員・記号・
 * 希望休・取り込んだ貼り付け・サーバー（同期先）・端末の保存に由来するものは esc を通っていることを確かめた。
 * outerHTML・document.write は2画面とも0か所。
 *
 * 点検表（シフト作成 27か所。場所は正本 src/ のファイル・関数）
 *   grid.js     render・renderSplit（buildSheet）… 職員の氏名・ID・勤務条件メモ・今月の連絡・セルの記号・希望休・祝日名・印刷の題・グループの色 → esc 済み
 *               renderMetrics … 計算した数字だけ（固定文＋数値）
 *               showPalette   … 記号のコード・名称・色・最近使った記号 → esc 済み／★色の履歴（端末に残る色）→ esc が無かった。直した
 *   app.js      renderLayerBar … 編集用タブの名前・ID → esc 済み（escText）
 *               showHistory    … 変更履歴の日時・月・レイヤ・内容 → esc 済み（escText）
 *               起動の失敗の帯（insertAdjacentHTML）… ★エラー文（同期先から届いた文が混ざりうる）→ esc が無かった。直した
 *   master.js   renderRescueList（2か所）… 退避データの対象・目安 → esc 済み（無い時は固定文）
 *               renderStaff … 氏名・資格・freee コード・許可パターン・メモ・退職月 → esc 済み
 *               editStaff（openDrawer）… 氏名・職種・兼務・雇用形態・勤務形態・起算日・freee コード・メモ・退職月 → esc 済み／
 *                 ★遅番回数上限（同期先・バックアップから来る保存値）→ esc が無かった。直した
 *               edSymFromShift（symCheckboxHtml）… 記号のコード → esc 済み
 *               renderSymbols … 記号のコード・名称・時刻・色 → esc 済み
 *               parseStaffPaste（2か所）… 貼り付けた氏名・区分・資格・メモ・除外・形式外 → esc 済み（取り込み後は件数だけ）
 *               renderSettings … 除外する姓・夜勤の休憩・分母・グループの色 → esc 済み
 *   requests.js render … 氏名・ID → esc 済み（希望の印は固定文）
 *               parse（2か所）… 貼り付けた回答の氏名・日の一覧 → esc 済み（登録後は件数だけ）
 *   official.js 勤務表の読み込み中（固定文＋月数）・特定事業所加算（tokuteiHtml_）… 氏名・資格・起算日・読んだ先・理由・
 *                 サーバーの失敗の文 → esc 済み・数えられなかった時のエラー文 → esc 済み・月を変えた時に空にする（固定文）
 *               render … 職種・雇用形態・資格・氏名・セルの記号・兼務・事業所名・利用者数・知らせ・記号表 → esc 済み
 *   freee_ui.js renderEmpList … 氏名・ID・従業員コード → esc 済み
 *               renderMapList … 記号・名称・パターンコード・休暇名 → esc 済み
 *   facility.js renderWizard … 施設名・事業所の表示名・職員名の一括入力 → esc 済み
 *
 * 点検表（シフト分析 12か所。正本 src/analyzer-ui.js）
 *   run（4か所）… 貼り付けが空（固定文）・読み取りの失敗の文・読めない理由・集計の失敗の文 → esc 済み
 *   render … 氏名・資格・メモ・検算の氏名と区分・読み取りメモ・読めなかった人・日の見出し・セルの記号 → esc 済み（ほかは数値）
 *   loadSaved（insertAdjacentHTML）… 旧い数え方の知らせ（固定文）
 *   renderMonths（2か所）… 保存した月のラベル → esc 済み（時間・割合は数値に直してから出す）・無い時は固定文
 *   renderCombined（2か所）… 件数と割合（数値に直してから出す）・空
 *   renderMaster … 資格マスタの氏名・キー → esc 済み
 *   集計を消す（clearBtn）… 空
 *
 * 固定する約束（職員の氏名やメモ・貼り付け・同期先の値に <img src=x onerror=…> や "><script> や " onmouseover=" を入れても、
 * 出来上がった HTML に img・script 要素や属性を抜けた on〜 が入らない。値は文字として残る＝黙って落とさない）。
 * ★の3か所は 2026-10-25 に直した所。今の画面（直す前）では★の試験だけが落ちる。
 * 実物の画面のソースから部品・関数を切り出して動かす（写経しない）。SHIFT_APP_HTML・SHIFT_ANALYZER_HTML で読む画面を差し替えられる
 * （直した版・わざと壊した版で落ちるかの確認用）。氏名はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const APP = fs.readFileSync(process.env.SHIFT_APP_HTML || path.join(ROOT, 'shift-app.html'), 'utf8');
const ANA = fs.readFileSync(process.env.SHIFT_ANALYZER_HTML || path.join(ROOT, 'shift-analyzer.html'), 'utf8');

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
  const end = scanBlock(src, m.index);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
/* オブジェクトの中のメソッド（名前: function (…) { … }）。「名前: function …」の形のまま返す */
function grabMethod(src, name) {
  const m = new RegExp('\\n[ \\t]*' + name + ': function \\(').exec(src);
  if (!m) throw new Error('メソッドが見つかりません: ' + name);
  const end = scanBlock(src, m.index);
  if (end < 0) throw new Error('メソッドの終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
function grabLine(src, re) { const m = re.exec(src); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }
/* 画面の中の部品（/* ===== src/…/名前.js ===== *\/ の区切りから次の区切りまで）。業務の入力ではないので本物をそのまま使う */
function section(src, file) {
  const mark = '/* ===== ' + file + ' ===== */';
  const s = src.indexOf(mark);
  if (s < 0) throw new Error('部品が見つかりません: ' + file);
  let e = src.indexOf('\n/* ===== src/', s + mark.length);
  const e2 = src.indexOf('</script>', s);
  if (e < 0 || (e2 >= 0 && e2 < e)) e = e2;
  return src.slice(s, e);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(String(info).slice(0, 400))); }
}
const EVIL = '<img src=x onerror=alert(1)>';
const BREAK = '"><script>alert(1)</script>';
const ATTR = '" onmouseover="alert(1)';
/* 実行される形が入っていないこと。esc を通った値は &lt;img … の文字になり、ここには当たらない */
function unsafe(h) { return /<img\b/i.test(h) || /<script\b/i.test(h) || /["']\s*onmouseover\s*=/i.test(h); }
const kept = (h) => h.includes('&lt;img src=x onerror=alert(1)&gt;');
const keptAttr = (h) => h.includes('&quot; onmouseover=&quot;alert(1)');

/* 画面の document・localStorage の代わり。innerHTML を受けるだけの箱 */
function mkEl(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, disabled: false, hidden: false, open: false,
    style: {}, _l: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); },
    fire(type) { const l = this._l[type] || []; if (l.length) l[l.length - 1].call(this, { target: this, preventDefault() {} }); },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    appendChild() {}, removeChild() {}, insertBefore() {}, scrollIntoView() {}, showModal() {}, close() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    insertAdjacentHTML(pos, h) { this.innerHTML = pos === 'afterbegin' ? h + this.innerHTML : this.innerHTML + h; }
  };
}
function fakeBrowser(storage) {
  /* 画面の部品の箱。初めて触った id もその場で作る（画面の HTML には全部の id がある） */
  const els = new Proxy({}, { get: (o, k) => (typeof k !== 'string' ? o[k] : (o[k] = o[k] || mkEl(k))) });
  const data = Object.assign({}, storage || {});
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); }, removeItem(k) { delete data[k]; },
    key(i) { return Object.keys(data)[i]; }, get length() { return Object.keys(data).length; }
  };
  const document = {
    readyState: 'complete', documentElement: { clientWidth: 1200 },
    getElementById: (id) => els[id],
    querySelector: () => mkEl(), querySelectorAll: () => [], createElement: () => mkEl(), addEventListener() {}
  };
  document.body = mkEl('body');
  const win = { document, localStorage: ls, pageXOffset: 0, pageYOffset: 0, addEventListener() {}, setTimeout, clearTimeout,
                alert() {}, confirm() { return true; }, prompt() { return null; }, console: { log() {}, warn() {}, error() {} } };
  win.window = win;
  vm.createContext(win);
  return { win, els, document };
}

/* ══════════════════════ シフト作成 ══════════════════════ */
console.log('— シフト作成 —');
{
  const fac = JSON.stringify({ version: 1, facilityName: '見本ホーム' + EVIL, setupDone: true,
    offices: [{ key: '施設', label: ATTR, enabled: true, closedWeekdays: [] }, { key: '訪問', label: EVIL, enabled: true, closedWeekdays: [] }] });
  const B = fakeBrowser({ su_facility_profile_v1: fac, ['shiftapp:v1:local:conflictRescue:sched:' + EVIL + ':1700000000000']: '{}' });
  const { win, els } = B;
  /* 同期の部品（store.js）は読み込むと端末の保存に触れるので、読むだけの代わりを置く */
  const STORE = { freee: null };
  win.ShiftStore = {
    get(k, d) { return Object.prototype.hasOwnProperty.call(STORE, k) && STORE[k] !== null ? STORE[k] : d; },
    getLocal(k, d) { return /^(conflictRescue|importRescue):/.test(k) ? { savedAt: 1700000000000, data: { cells: {} } } : d; },
    set() {}, setLocal() {}, getSyncConfig() { return null; }, api() { return Promise.resolve({}); }, editMode: false
  };
  ['src/logic/esc.js', 'src/logic/ids.js', 'src/logic/symbols.js', 'src/logic/timecalc.js', 'src/logic/aggregate.js',
   'src/logic/importers.js', 'src/logic/freee.js',
   'src/ui/grid.js', 'src/ui/master.js', 'src/ui/requests.js', 'src/ui/official.js', 'src/ui/freee_ui.js', 'src/ui/facility.js']
    .forEach((f) => vm.runInContext(section(APP, f), win, { filename: f }));
  const Sym = win.ShiftSymbols, IM = win.ShiftImporters, AG = win.ShiftAggregate;

  /* ── G シフト表（gridWrap ← render・renderSplit の buildSheet） ── */
  const G = win.ShiftGrid;
  const syms = [{ code: EVIL, label: BREAK, type: 'work', start: '9:00', end: '18:00', cat: 'mid', color: ATTR },
                { code: BREAK, label: EVIL, type: 'off', cat: 'off' }];
  const st1 = { id: 's1' + ATTR, name: '見本甲' + EVIL, group: 'visit', mainDivision: '訪問', qualifications: [], rules: { note: EVIL }, active: true };
  const ctx = {
    year: 2026, month: 10, days: 3, settings: { weekStartDow: 0, groupColors: { visit: { bg: ATTR, text: EVIL } } },
    staff: [st1], symbols: syms, results: {}, counts: {}, holidays: { 2: EVIL }, printTitle: BREAK, revealHidden: true,
    requests: { [IM.normalizeName(st1.name)]: { 3: EVIL } },
    sched: { cells: { [st1.id]: { 1: EVIL, 2: BREAK } }, subCells: { [st1.id]: { 施設: { 1: ATTR } } }, notes: { [st1.id]: BREAK },
             colors: { [st1.id + '|訪問|1']: ATTR }, bold: {}, dailyNeeds: {}, monthNeeds: {} },
    metrics: { visitTotalMin: 0, visitKaifukuMin: 0, visitKaifukuJitsumuMin: 0, kaifukuPctVisit: 0, kaifukuJitsumuPctVisit: 0, fteByDivision: {}, fteStd: {} }
  };
  G.ctx = ctx; G.visibleRows = [];
  const sheet = G.buildSheet(ctx, false, 52, null, '');
  t('G1 シフト表（画面）：氏名・ID・勤務条件メモ・今月の連絡・セルの記号・希望休・祝日名・グループの色に入れても実行される形にならない', !unsafe(sheet), sheet);
  t('G1 値は文字として残る', kept(sheet) && keptAttr(sheet), sheet);
  G.renderSplit(ctx, 40);
  const split = els.gridWrap.innerHTML;
  t('G2 シフト表（A3縦の分割印刷 renderSplit）：印刷の題・氏名・記号に入れても実行される形にならない', !unsafe(split) && kept(split), split);

  /* G4 入力パレット（palette ← showPalette） */
  B.document.querySelector = () => mkEl('td');
  G.sel = [{ sid: st1.id, div: '訪問', day: 1 }];
  G.recentSyms = { [st1.id]: [EVIL, BREAK] };
  ctx.recentColors = ['#ffcc00'];
  G.showPalette();
  const pal1 = els.palette.innerHTML;
  t('G4 入力パレット：記号のコード・名称・色・最近使った記号に入れても実行される形にならない', !unsafe(pal1) && kept(pal1), pal1);
  ctx.recentColors = [ATTR, EVIL];
  G.showPalette();
  const pal2 = els.palette.innerHTML;
  t('G4 ★色の履歴（端末に残る色）に入れても属性を抜けない（2026-10-25 に直した所）', !unsafe(pal2) && keptAttr(pal2), pal2);

  /* ── M 職員マスタ ── */
  const M = win.ShiftMaster;
  const stM = { id: 'm1' + ATTR, name: '見本乙' + EVIL, group: 'visit', mainDivision: '訪問', qualifications: ['介護福祉士', BREAK],
    allowedSymbols: [EVIL, ATTR], empCode: ATTR, employment: EVIL, workForm: ATTR, jobTitle: BREAK, kenmuNote: ATTR, careExpSince: ATTR,
    status: '退職', retireMonth: EVIL, rules: { note: EVIL, monthlyTarget: ATTR } };
  const appM = { ym: '2026-10', settings: { fteBaseHours: 160, excludeSurnames: [EVIL], nightBreakH: ATTR, groupColors: { visit: { bg: ATTR, text: BREAK } } },
    symbols: [{ code: EVIL, label: BREAK, type: 'off', start: ATTR, end: EVIL, color: ATTR, textColor: BREAK }, { code: ATTR, type: 'off' }],
    staff: [], findStaff(id) { return id === stM.id ? stM : null; }, masterSorted() { return [stM]; }, keyLabel_(k) { return k; } };
  M.app = appM;
  M.renderStaff();
  const mst = els.staffTable.innerHTML;
  t('M1 職員一覧（renderStaff）：氏名・資格・freee コード・許可パターン・メモ・退職月に入れても実行される形にならない', !unsafe(mst) && kept(mst), mst);
  M.editStaff(stM.id);
  const ed1 = els.drawer.innerHTML;
  t('M2 職員の編集（editStaff）：氏名・資格・職種・兼務・雇用形態・勤務形態・起算日・freee コード・メモ・退職月の value 属性を抜けない', !unsafe(ed1) && keptAttr(ed1), ed1);
  t('M2 許可パターンの記号（symCheckboxHtml）も同じ', !unsafe(M.symCheckboxHtml({})) && kept(M.symCheckboxHtml({})), M.symCheckboxHtml({}));
  stM.rules = { note: '', lateMax: ATTR };
  M.editStaff(stM.id);
  const ed2 = els.drawer.innerHTML;
  const late = (/<input type="number" id="edLateMax"[^>]*>/.exec(ed2) || [''])[0];   /* 遅番回数上限の入力欄だけを見る */
  t('M2 ★遅番回数上限（同期先・バックアップから来る保存値）に入れても value 属性を抜けない（2026-10-25 に直した所）', late !== '' && !unsafe(late) && keptAttr(late), late || ed2);
  M.renderSymbols();
  const msy = els.symTable.innerHTML;
  t('M3 記号の一覧（renderSymbols）：コード・名称・時刻・色の value 属性を抜けない', !unsafe(msy) && keptAttr(msy), msy);
  M.renderSettings();
  const mse = els.settingsForm.innerHTML;
  t('M4 設定（renderSettings）：除外する姓・夜勤の休憩・グループの色の value 属性を抜けない', !unsafe(mse) && keptAttr(mse), mse);
  els.staffPaste.value = '氏名\t区分\tメモ\t介護福祉士\n見本丙\t訪問\t' + EVIL + '\t有\n' + EVIL + '\t施設\t\t\n';
  M.parseStaffPaste();
  const mim = els.staffImportPreview.innerHTML;
  t('M5 職員の貼り付け取り込みの確認（parseStaffPaste）：メモ・形式外の氏名に入れても実行される形にならない', !unsafe(mim) && kept(mim), mim);
  M.renderRescueList();
  const mre = els.rescueList.innerHTML;
  t('M6 退避データの一覧（renderRescueList）：退避の対象の名前に入れても実行される形にならない', !unsafe(mre) && kept(mre), mre);

  /* ── R 希望休 ── */
  const R = win.ShiftRequests;
  const stR = { id: 'r1' + ATTR, name: '見本丁' + EVIL, active: true };
  R.app = { days: 3, staff: [stR], requests: { [IM.normalizeName(stR.name)]: { 1: '希', 2: '有' } }, requestsSorted() { return [stR]; } };
  R.render();
  const rg = els.reqGrid.innerHTML;
  t('R1 希望休の表（render）：氏名・ID に入れても実行される形にならない', !unsafe(rg) && kept(rg), rg);
  els.reqPaste.value = '2026/10/01\t' + EVIL + '\t希\t\t有\n2026/10/01\t見本戊<script>alert(1)</script>\t\t希\n';
  R.parse();
  const rp = els.reqPreview.innerHTML;
  t('R2 希望休の貼り付け取り込みの確認（parse）：回答の氏名に入れても実行される形にならない', !unsafe(rp) && kept(rp), rp);

  /* ── O 行政提出 ── */
  const O = win.ShiftOfficial;
  O.app = { year: 2026, month: 10, ym: '2026-10', settings: { fteBaseHours: 160 } };
  const prev3 = AG.prev3('2026-10');
  O.buildData = () => ({
    division: '訪問', layer: 'actual', cellMode: 'symbol', period: 'weeks4', days: 2,
    rows: [{ sid: 'o1' + ATTR, job: EVIL, employment: BREAK, quals: EVIL, name: '見本己' + EVIL, cells: [EVIL, ATTR], hourCells: ['', ''],
             weekMin: {}, totalMin: 60, weekAvgH: 1, fte: 1, kenmu: ATTR }],
    std: { full: 1, weekAvgH: 1, conv: 1, total: 1 }, kaifukuPct: 1, kaifukuJitsumuPct: 1,
    formSum: { A: { n: 1, totalMin: 0, convMin: 0, full: 1 }, B: { n: 0, totalMin: 0, convMin: 0, full: 0 }, C: { n: 0, totalMin: 0, convMin: 0, full: 0 },
               D: { n: 0, totalMin: 0, convMin: 0, full: 0 }, '': { n: 0, totalMin: 0, convMin: 0, full: 0 } },
    svcUsers: { months: prev3, kaigo: [ATTR, 1, 1], shien: [EVIL, 1, 1], tsuin: [0, 0, 0] }, svcCount: 1, svcFull: 1,
    warns: [EVIL], snapDiff: 0,
    symTable: [{ code: EVIL, start: BREAK, end: ATTR, breakH: EVIL, hours: EVIL, note: EVIL }]
  });
  O.render();
  const ot = els.officialTable.innerHTML;
  t('O1 勤務形態一覧（render）：職種・雇用形態・資格・氏名・セル・兼務・事業所名・利用者数・知らせ・記号表に入れても実行される形にならない', !unsafe(ot) && kept(ot) && keptAttr(ot), ot);
  const W = AG.tokuteiWindows('2026-10');
  O.tokuteiMonth_ = () => ({ layer: '実績', src: EVIL, persons: 1, den: { fte: 1 }, kf: { fte: 1 }, g50: { fte: 1 }, g50j: { fte: 1 },
    svc: [{ sid: 'o1', years: 3, need: 3, fullTime: true, ok: false, reason: EVIL, noWork: false }], svcOk: 0, svcFull: 1, asOf: BREAK,
    nameOf: { o1: { name: '見本己' + EVIL, quals: BREAK, exp: ATTR } } });
  const tk = O.tokuteiHtml_('2026-10', W, W.months, { failed: EVIL, entries: {} });
  t('O2 特定事業所加算（tokuteiHtml_）：読んだ先・氏名・資格・起算日・理由・サーバーの失敗の文に入れても実行される形にならない', !unsafe(tk) && kept(tk), tk);

  /* ── F freee 出力 ── */
  const F = win.ShiftFreeeUI;
  const wsym = { code: '9-18', label: EVIL, type: 'work', start: '9:00', end: '18:00', cat: 'mid' };
  F.app = { ym: '2026-10', staff: [{ id: 'f1' + ATTR, name: '見本庚' + EVIL, empCode: ATTR, active: true }],
            symbols: [wsym, { code: '休', label: BREAK, type: 'off', cat: 'off' }] };
  STORE.freee = { patternMap: { [Sym.normalizeCell('9-18')]: ATTR }, offNames: { [Sym.normalizeCell('休')]: EVIL } };
  F.renderEmpList();
  const fe = els.frEmpList.innerHTML;
  t('F1 従業員コードの表（renderEmpList）：氏名・ID・コードに入れても実行される形にならない', !unsafe(fe) && kept(fe) && keptAttr(fe), fe);
  F.renderMapList();
  const fm = els.frMapList.innerHTML;
  t('F2 勤務パターンの対応（renderMapList）：記号の名称・パターンコード・休暇名に入れても実行される形にならない', !unsafe(fm) && kept(fm) && keptAttr(fm), fm);

  /* ── W 施設情報の初期設定 ── */
  win.ShiftFacility.openWizard();
  const w1 = els.dlgFacility.innerHTML;
  t('W1 初期設定 1/3：施設名の value 属性を抜けない', !unsafe(w1) && kept(w1), w1);
  els.wizFacName.value = '見本ホーム';
  els.wizNext.fire('click');
  const w2 = els.dlgFacility.innerHTML;
  t('W1 初期設定 2/3：事業所の表示名の value 属性を抜けない', !unsafe(w2) && keptAttr(w2), w2);
  els.wizNext.fire('click');
  els.wizNames.value = '見本辛\n</textarea>' + EVIL;
  els.wizBack.fire('click');
  els.wizNext.fire('click');
  const w3 = els.dlgFacility.innerHTML;
  t('W1 初期設定 3/3：職員名の一括入力で textarea を抜けない', !unsafe(w3) && !/<\/textarea><img/i.test(w3) && kept(w3), w3);
}

/* ── A 画面の本体（app.js）。読み込むと起動するので、メソッドと起動の部分だけ切り出す ── */
{
  const B = fakeBrowser();
  const { win, els } = B;
  const appSrc = section(APP, 'src/ui/app.js');
  vm.runInContext(section(APP, 'src/logic/esc.js'), win);
  vm.runInContext([
    grabLine(appSrc, /function escText\(t\) \{[^\n]*\}/),
    'function fmtDateTime(){ return ""; }',
    'var M = {' + grabMethod(appSrc, 'renderLayerBar') + ',' + grabMethod(appSrc, 'showHistory') + '};'
  ].join('\n'), win);
  const M = win.M;
  M.layer = 'draft:x';
  M.getDrafts = () => [{ id: 'd1' + ATTR, label: '見本の案' + EVIL, auto: false }, { id: BREAK, label: ATTR, auto: true }];
  M.renderLayerBar();
  const dt = els.draftTabs.innerHTML;
  t('A1 編集用タブ（renderLayerBar）：タブの名前・ID に入れても実行される形にならない', !unsafe(dt) && kept(dt) && keptAttr(dt), dt);
  M._undo = [{ at: EVIL, ym: BREAK, layer: ATTR, label: '見本の変更' + EVIL }];
  M.showHistory();
  const hi = els.drawer.innerHTML;
  t('A2 変更履歴（showHistory）：日時・月・レイヤ・内容に入れても実行される形にならない', !unsafe(hi) && kept(hi), hi);

  /* A3 起動の失敗の帯（document.body ← insertAdjacentHTML）。エラー文に同期先から届いた文が混ざっても実行される形にならない */
  const boot = grabLine(appSrc, /\/\* 旧Safari対策[\s\S]*?catch \(e2\) \{\}\n\s*\}/);
  vm.runInContext('var App = { boot: function () { throw new Error(' + JSON.stringify('Unexpected token ' + EVIL) + '); } };\n' + boot, win);
  const bb = B.document.body.innerHTML;
  t('A3 起動の失敗の帯：前提＝帯が出ている', bb.includes('初期化エラー'), bb);
  t('A3 ★起動の失敗の帯：エラー文に入れても実行される形にならない（2026-10-25 に直した所）', !unsafe(bb) && kept(bb), bb);
}

/* ══════════════════════ シフト分析 ══════════════════════ */
console.log('\n— シフト分析 —');
{
  const months = [{ label: '2026-09' + ATTR, visitTotalMin: EVIL, visitKaifukuMin: 60, visitKaifukuJitsumuMin: BREAK, rawText: 'x' },
                  { label: EVIL, visitTotalMin: 600, visitKaifukuMin: 60, visitKaifukuJitsumuMin: 60 }];
  const master = { [ATTR]: { name: '見本壬' + EVIL, quals: ['介護福祉士'] }, k2: { quals: [] } };
  const B = fakeBrowser({ 'shiftanalyzer:v1:months': JSON.stringify(months), 'shiftanalyzer:v1:qualmaster': JSON.stringify(master) });
  const { win, els } = B;
  vm.runInContext(section(ANA, 'src/logic/symbols.js'), win);
  const ui = section(ANA, 'src/analyzer-ui.js');
  vm.runInContext([
    'function $(id) { return document.getElementById(id); }',
    grabLine(ui, /function esc\(s\) \{[^\n]*\n[^\n]*\n[^\n]*/),
    grabLine(ui, /var LS_KEY = [^\n]*/), grabLine(ui, /var MASTER_KEY = [^\n]*/), grabLine(ui, /var QUAL_LIST = [^\n]*/),
    'var dataCorrupt = { months: false, master: false }; var lastAnalysis = null, lastParsed = null; var AI = null;',
    'function scheduleAutoSync(){} function loadSaved(){} function saveMaster(){ return true; } function saveMonths(){ return true; }',
    ['h1', 'pct', 'markCorrupt', 'showCorruptWarning', 'loadMaster', 'settings', 'run', 'render', 'formInfoHTML', 'cell', 'numH',
     'cellStyle', 'renderGridHTML', 'loadMonths', 'renderMonths', 'renderCombined', 'renderMaster', 'oldMethodNoticeHTML']
      .map((n) => grabFn(ui, n)).join('\n')
  ].join('\n'), win);

  /* S1 集計の失敗（results ← run の4か所） */
  els.pasteArea.value = 'x'; els.fteBase.value = '160';
  const runWith = (ai) => { win.AI = ai; vm.runInContext('AI = this.AI;', win); win.run(); return els.results.innerHTML; };
  const r1 = runWith({ parseGrid() { throw new Error(EVIL); } });
  const r2 = runWith({ parseGrid() { return { ok: false, error: BREAK + EVIL }; } });
  const r3 = runWith({ parseGrid() { return { ok: true, staff: [], days: 1 }; }, ymFromLabel() { return ''; }, readShiftStaffForms() { return null; },
                       analyze() { throw new Error(EVIL); } });
  t('S1 集計の失敗：読み取りの失敗・読めない理由・集計の失敗の文に入れても実行される形にならない', [r1, r2, r3].every((h) => !unsafe(h) && kept(h)), r1 + r2 + r3);

  /* S2 集計の結果（results ← render） */
  const r = {
    metrics: { visitTotalMin: 60, visitKaifukuMin: 0, visitKaifukuJitsumuMin: 0, kaifukuPctVisit: 0, kaifukuJitsumuPctVisit: 0 },
    fteVisit: { all: 1, kaifuku: 1, base: 160 },
    perStaff: [{ name: '見本癸' + EVIL, qualifications: [BREAK], qualSource: 'sheet', divHours: { 訪問: 1 }, totalHours: 1, note: EVIL, excluded: true, attendDays: 1, offDays: 0 }],
    crossCheck: [{ name: EVIL, division: BREAK, recomputed: 1, sheet: 2, diff: -1 }],
    warnings: ['⚠ ' + EVIL],
    formInfo: { available: true, matched: 0, unmatchedNames: [EVIL], source: 'cur' }
  };
  const parsed = { days: 2, dayLabels: [EVIL, ATTR], staff: [{ name: '見本癸' + EVIL, excluded: true, rows: [{ division: BREAK, cells: { 1: EVIL, 2: ATTR } }] }] };
  win.render(r, parsed);
  const res = els.results.innerHTML;
  t('S2 集計の結果：氏名・資格・メモ・検算・読み取りメモ・読めなかった人・日の見出し・セルの記号に入れても実行される形にならない', !unsafe(res) && kept(res) && keptAttr(res), res);

  /* S3 保存した月（savedMonths ← renderMonths・combined ← renderCombined） */
  win.renderMonths();
  const sm = els.savedMonths.innerHTML;
  t('S3 保存した月の一覧：月のラベルに入れても実行される形にならない（同期先・書き出しから読んだ値）', !unsafe(sm) && kept(sm) && keptAttr(sm), sm);
  B.document.querySelectorAll = (sel) => sel === '.mchk' ? months.map((m) => ({ checked: true, getAttribute: () => m.label })) : [];
  win.renderCombined();
  const cb = els.combined.innerHTML;
  t('S3 期間平均：保存した時間に文字が入っていても実行される形にならない（数値に直して出す）', !unsafe(cb) && cb.includes('選択 2 月'), cb);

  /* S4 資格マスタ（masterBox ← renderMaster） */
  win.renderMaster();
  const mb = els.masterBox.innerHTML;
  t('S4 資格マスタ：氏名・キーに入れても実行される形にならない', !unsafe(mb) && kept(mb) && keptAttr(mb), mb);

  /* S5 旧い数え方の知らせ（insertAdjacentHTML）は固定文だけ */
  t('S5 旧い数え方の知らせは固定文だけ（値を差し込まない）', /function oldMethodNoticeHTML\(\) \{\n\s*return '[^'+]*' \+ esc\('[^'+]*'\) \+ '[^'+]*';\n\s*\}/.test(grabFn(ui, 'oldMethodNoticeHTML')), grabFn(ui, 'oldMethodNoticeHTML'));
}

/* 点検した数のまま（増えたら点検して表に足してから通す・10/25 反証レビュー指摘3） */
{
  const cnt = (src) => (src.match(/\.innerHTML\s*\+?=(?!=)/g) || []).length + (src.match(/insertAdjacentHTML\(/g) || []).length;
  t('Z シフト作成の HTML の代入は点検した27か所のまま', cnt(APP) === 27, cnt(APP));
  t('Z シフト分析の HTML の代入は点検した12か所のまま', cnt(ANA) === 12, cnt(ANA));
  t('Z 2画面とも outerHTML への代入・document.write は使っていない', !/\.outerHTML\s*\+?=|document\.write/.test(APP + ANA));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
