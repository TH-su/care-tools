/* xss_weight_record_test.js — 体重管理の innerHTML の全数点検の守り（2026-10-25・本人指示）
 *
 * 体重管理（weight-record.html）の HTML の代入を全部洗った（innerHTML 54か所。insertAdjacentHTML・outerHTML・
 * document.write・srcdoc は0か所）。入る値の出どころは 固定文／名簿（氏名・居室・身長・車椅子）／記録（体重・測定日・
 * 主食量・メモ・記録した人）／サーバーの値（しきい値）／画面の入力欄（日付・月）。
 * 氏名・居室・メモ・記録した人・確認の文などは前から escapeHtml を通っていた。通っていなかったのは次の9か所で、
 * どれも esc を通した（正しい値では表示は1文字も変わらない）:
 *   1 一覧の測定日（renderList。cur.measuredOn）
 *   2 まとめて入力の「前回」の日付（renderBulkList。latestAny.measuredOn）
 *   3 まとめて入力の「◯ に既存記録あり」（renderBulkList。測定日の入力欄の値）
 *   4 入力画面の「前回（◯ …kg）比」（updateWeightHint。prevRec.measuredOn）
 *   5 入力済み記録の測定日（renderInputExistingList。r.measuredOn）
 *   6 履歴の「入力 ◯」（drawHist。入力日時が無い記録は measuredOn をそのまま出していた）
 *   7 履歴の主食量（drawHist。r.stapleAmount）
 *   8 アラートの主食量（renderAlerts。a.cur.stapleAmount）
 *   9 しきい値の入力欄の value 属性（renderThrEditor。サーバー・端末の控えから来た値を型を直さずに入れていた）
 * 1〜8 は受け取った時の正規化（normalizeRecord）で日付・数に直るので今まで実害は無かったが、正規化の外れた経路が
 * 1本でもあると素通しになるため、出す所でも守る。9 は正規化が無かった。
 *
 * 固定する約束（利用者・職員の入力やサーバーの値に <img src=x onerror=…>・"><script>・属性を抜ける " onmouseover=" を
 * 入れても、出来上がった HTML に img・script 要素や属性を抜けた onmouseover が入らない。値は文字として残る＝黙って落とさない）:
 *   W1 入居者の選択肢（populateResidentSelect）   W2 印刷の用紙（openPrintSheet）   W3 一覧（renderList）
 *   W4 集計の表（renderGrid）と氏名のメニュー（wrOpenGridMenu）   W5 まとめて入力（renderBulkList）
 *   W6 入力画面の前回比（updateWeightHint）・入力済み記録（renderInputExistingList）・食事の表示（renderInputMealDisplay）
 *   W7 個別の数字（drawStats）・履歴（drawHist）   W8 アラート（renderAlerts）
 *   W9 重複の整理（wrRenderDupCheck）   W10 入居者の設定の一覧（renderCfg）・しきい値（renderThrEditor）・検知ルール（renderRuleDesc）
 *   W11 車椅子の変更履歴（renderMdChairLog）   W12 入居者マスタから来た時のバー（wrSetFromMasterBar）
 *   W13 HTML の代入の数（54か所）が増えたら落ちる＝足した所をこの表に足すまで通さない
 * 実物の画面のソースから関数を切り出して動かす（写経しない）。WEIGHT_HTML で差し替えるのは、直す前の版・わざと壊した版で
 * 落ちるかの確認用。固定値の氏名・記録はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const W = fs.readFileSync(process.env.WEIGHT_HTML || path.join(ROOT, 'weight-record.html'), 'utf8');

/* { } の対応を数えて関数の終わりを探す（文字列・コメントは飛ばす） */
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
  /* 引数の既定値に {} がある関数（opts={}）があるので、引数の ( ) を先に飛ばしてから本体の { } を数える */
  const pe = scanBlock(src, m.index + m[0].length - 1, '(', ')');
  const end = pe < 0 ? -1 : scanBlock(src, pe);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
/* const X = …; の文（括弧の深さ0の ; まで）。表や小さな矢印関数を本物のまま使う */
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
/* escapeHtml は正規表現の中に引用符を含み簡易スキャナで切り出せないので、行の形で取る */
function grabLine(src, re) { const m = re.exec(src); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }

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

/* ── W13 HTML の代入の数 ── */
console.log('— 体重管理：HTML の代入の数 —');
{
  const n = (W.match(/\.innerHTML\s*\+?=(?!=)/g) || []).length;   /* += も数える（10/25 反証レビュー指摘3） */
  const other = (W.match(/insertAdjacentHTML|\.outerHTML\s*=|document\.write|srcdoc|createContextualFragment|parseFromString/g) || []).length;
  t('W13 innerHTML への代入は点検した54か所のまま（増えたらこの試験の表に足してから通す）', n === 54, n);
  t('W13 insertAdjacentHTML・outerHTML・document.write・srcdoc は0か所', other === 0, other);
}

/* ── 偽の画面（$ で取る箱・document.createElement の箱）。innerHTML を受けて覚えるだけ ── */
function fakeEl(tag) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), innerHTML: '', textContent: '', value: '', className: '', id: '', type: '',
    hidden: false, disabled: false, checked: false, scrollTop: 0, scrollLeft: 0, scrollWidth: 0, offsetWidth: 0, offsetHeight: 0,
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {}, appendChild(c) { this.children.push(c); return c; }, remove() {}, focus() {},
    querySelector() { return fakeEl('div'); }, querySelectorAll() { return []; }, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
  return e;
}
/* 箱とその子の innerHTML を全部つなぐ（tr を作って innerHTML を入れ、body に足す描き方があるため） */
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
  _ensurePrintSheetStyle() {}, closePrintSheet() {}
};
vm.createContext(box);
const code = [
  /* 画面の状態（外から入れ替えるので var で置く） */
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
  /* 名簿・記録を引く・並べる・判定する本物の関数 */
  ...['bmiOf', 'bmiCat', 'wrYmOk', 'wrWeightOk', '_toSafeStr', '_toYearMonth', '_toIsoDate', 'normalizeRecord', 'normalizeResident',
      'isDischarged', 'isWeightTarget', 'residentById', 'sortedResidents', 'getRecordsOf', 'getAllRecordsOf', 'getRecord', 'getRecordById',
      'getRecordByDate', 'getLatestRecordAny', 'getLatestRecordBefore', 'wrCmpNote', 'wrCmpLabel', 'analyze', 'alertDir', 'wrAlertDirs',
      'wrNutritionRisk', 'wrRiskChip', 'wrSparkSvg', 'wrMissAgoHtml', 'monthSeq', 'ymGridLabel', 'prevMonthDiff', 'diffHtml',
      'wcLogClean_', 'wcKgOn_', 'wcLatestKg_', 'wrHistOf_', 'wrHistVal_', 'wrHistHtml_', '_histSortKey',
      'collectAlerts', 'wrAckMap', 'wrAckOf', 'wrAckText', 'wrHasMid', 'wrRecCountOf', 'wrLatestYmOf', 'wrFindDupGroups',
      'wrOrphanRecordGroups', 'wrLoadSrvResIds', 'wrDefaultKeep', 'suNormName', 'wcLogDerived_', 'wcLogStored_', 'wcLogOf', 'recDateKey',
      /* 描く関数（点検の対象） */
      'populateResidentSelect', 'openPrintSheet', 'renderList', 'renderGrid', 'wrCloseGridMenu', 'wrOpenGridMenu', 'renderBulkList',
      'updateBulkSummary', 'updateWeightHint', 'renderInputExistingList', 'renderInputMealDisplay', 'drawStats', 'drawHist',
      'renderRuleDesc', 'renderAlerts', 'wrRenderDupCheck', 'renderCfg', 'renderThrEditor', 'renderMdChairLog', 'wrSetFromMasterBar'
     ].map((n) => grabFn(W, n))
].join('\n');
vm.runInContext(code, box);

/* 架空の名簿と記録。氏名・居室・身長・車椅子・メモ・記録した人に悪い値を入れる。
   記録は画面の入口と同じく normalizeRecord を通す（9か所の直しは、通っても通らなくても守れることを見る） */
function seed(normalize) {
  const r1 = { id: 'r1' + ATTR, name: EVIL, room: BREAK, heightCm: 150, wheelchairKg: 5, kana: 'かくう', stapleForm: 'normal', stapleAmount: 150, createdAt: '2026-01-01' + EVIL };
  const r2 = { id: 'r2', name: '架空 花子', room: '201', heightCm: 155, wheelchairKg: null };
  const recs = [];
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  months.forEach((ym, i) => {
    const w = 50 - i * 1.2;   /* 6か月で約14%減る＝警告と高リスクが出る */
    recs.push({ id: 'x' + i + ATTR, residentId: r1.id, yearMonth: ym, weight: w, measuredOn: ym + '-05' + EVIL, measureMode: 'chair', rawWeight: w + 5, wheelchairKg: 5,
                stapleForm: 'normal', stapleAmount: EVIL, sideForm: 'normal', soupThick: true, note: EVIL, recordedBy: BREAK, updatedBy: ATTR, recheck: 'confirmed' });
  });
  /* 持ち主のいない記録（重複の整理に出る） */
  recs.push({ id: 'o1', residentId: 'gone' + ATTR, yearMonth: '2026-09', weight: 40, measuredOn: '2026-09-01' + EVIL, note: EVIL, createdAt: '2026-09-02' + EVIL });
  if (normalize) recs.forEach((x) => box.normalizeRecord(x));
  box.DB = { residents: [r1, r2], records: recs };
  return { r1, r2 };
}

for (const normalize of [false, true]) {
  console.log('\n— 体重管理（記録を正規化' + (normalize ? 'してから' : 'せずに') + '描く） —');
  const { r1 } = seed(normalize);
  const tag = normalize ? '（正規化後）' : '（正規化なし）';
  const take = (sel) => { const e = els[sel]; const h = allHtml(e); delete els[sel]; return h; };

  /* W1 入居者の選択肢 */
  const sel = fakeEl('select');
  box.populateResidentSelect(sel, { includeDischarged: true });
  t('W1 入居者の選択肢：氏名・居室・番号に入れても実行される形にならない' + tag, !unsafe(sel.innerHTML) && kept(sel.innerHTML), sel.innerHTML);

  /* W2 印刷の用紙 */
  box.listMonth = '2026-10';
  box.openPrintSheet();
  const ps = take('#printOverlay');
  t('W2 印刷の用紙：氏名・居室に入れても実行される形にならない' + tag, ps.includes('体重測定記録用紙') && !unsafe(ps) && kept(ps), ps);

  /* W3 一覧 */
  box.renderList();
  const ls = take('#listBody');
  t('W3 一覧：氏名・居室・測定日・主食に入れても実行される形にならない' + tag, ls.includes('wt-cell') && !unsafe(ls) && kept(ls), ls);

  /* W4 集計の表と氏名のメニュー */
  box.renderGrid();
  const gr = take('#gridTable');
  t('W4 集計の表：氏名・居室・記録の番号に入れても実行される形にならない' + tag, gr.includes('gr-wt') && !unsafe(gr) && kept(gr), gr);
  const cell = fakeEl('td'); cell.dataset.goRid = r1.id;
  box.wrOpenGridMenu(cell, null);
  const gm = allHtml(fakeDocument.body.children.find((c) => c.id === 'grMenu'));
  fakeDocument.body.children.length = 0;
  t('W4 集計の氏名のメニュー：氏名に入れても実行される形にならない' + tag, !unsafe(gm) && kept(gm), gm);

  /* W5 まとめて入力（★測定日の入力欄の値・前回の日付） */
  els['#bulkDate'] = Object.assign(fakeEl('input'), { value: '2026-10-05' + EVIL });
  els['#bulkMonth'] = Object.assign(fakeEl('input'), { value: '2026-10' });
  box.DB.records.push({ id: 'b1', residentId: 'r2', yearMonth: '2026-10', weight: 45, measuredOn: '2026-10-05' + EVIL });
  box.renderBulkList();
  box.DB.records.pop();
  const bk = take('#bulkList');
  t('W5 まとめて入力：氏名・居室・前回の日付・測定日の欄に入れても実行される形にならない（★直した所）' + tag, bk.includes('bk-row') && !unsafe(bk) && kept(bk), bk);
  delete els['#bulkDate']; delete els['#bulkMonth'];

  /* W6 入力画面 */
  els['#inResident'] = Object.assign(fakeEl('select'), { value: r1.id });
  els['#inMonth'] = Object.assign(fakeEl('input'), { value: '2026-11' });
  els['#inDate'] = Object.assign(fakeEl('input'), { value: '' });
  els['#inWeight'] = Object.assign(fakeEl('input'), { value: '40' });
  box.updateWeightHint();
  const hint = take('#inWeightHint');
  t('W6 入力画面の前回比：前回の測定日に入れても実行される形にならない（★直した所）' + tag, hint.includes('前回（') && !unsafe(hint) && (normalize || kept(hint)), hint);
  box.renderInputExistingList();
  const iex = take('#inExistingList');
  t('W6 入力済み記録：測定日・記録の番号に入れても実行される形にならない（★直した所）' + tag, iex.includes('iex-row') && !unsafe(iex) && (normalize || kept(iex)), iex);
  box.renderInputMealDisplay();
  const meal = take('#inMealTbl');
  t('W6 食事の表示：主食・副食・量に入れても実行される形にならない' + tag, meal.includes('主食') && !unsafe(meal), meal);
  ['#inResident', '#inMonth', '#inDate', '#inWeight'].forEach((k) => delete els[k]);

  /* W7 個別の数字と履歴（★入力日時が無い記録の「入力 ◯」・主食量） */
  box.drawStats(r1.id);
  const st = take('#ivStats');
  t('W7 個別の数字：身長・低栄養の理由に入れても実行される形にならない' + tag, st.includes('最新体重') && !unsafe(st), st);
  box.drawHist(r1.id);
  const hs = take('#ivHistBody');
  t('W7 履歴：測定日・主食量・メモ・記録した人・直した人に入れても実行される形にならない（★直した所）' + tag, hs.includes('hist-act') && !unsafe(hs) && kept(hs), hs);

  /* W8 アラート（★主食量） */
  box.renderAlerts();
  const al = take('#alList');
  t('W8 アラート：氏名・居室・主食量に入れても実行される形にならない（★直した所）' + tag, al.includes('al-nm') && !unsafe(al) && kept(al), al);

  /* W9 重複の整理（持ち主のいない記録・登録を見送った人） */
  box.wrSkippedMaster = [{ masterId: 'm9', name: EVIL, room: BREAK }];
  box.DB.residents.push({ id: 'r3', name: EVIL, room: '301' });
  box.wrRenderDupCheck();
  box.DB.residents.pop(); box.wrSkippedMaster = [];
  const dp = take('#dupList');
  t('W9 重複の整理：氏名・居室・メモ・作成日に入れても実行される形にならない' + tag, dp.includes('dup-g') && !unsafe(dp) && kept(dp), dp);

  /* W10 入居者の設定の一覧・しきい値（★サーバーから来た値）・検知ルール */
  box.DB.residents.push({ id: 'r4' + ATTR, name: EVIL, room: BREAK, heightCm: EVIL, wheelchairKg: BREAK, dischargedAt: '2026-01-01' + EVIL });
  box.renderCfg();
  box.DB.residents.pop();
  const cf = take('#cfgList');
  t('W10 入居者の設定の一覧：氏名・居室・身長・車椅子・退去日に入れても実行される形にならない' + tag, cf.includes('rli-n') && !unsafe(cf) && kept(cf), cf);
  box.THR = { m1: { wKg: ATTR, wPct: BREAK, ngKg: EVIL, ngPct: 3 }, m3: { wKg: 2, wPct: 3, ngKg: 3, ngPct: 5 }, m6: { wKg: 3, wPct: 5, ngKg: 5, ngPct: 7 } };
  box.renderThrEditor();
  const th = take('#thrBody');
  t('W10 しきい値の入力欄：サーバーから来た値で value 属性を抜けない（★直した所）' + tag, th.includes('data-thr') && !unsafe(th) && kept(th), th);
  const rd = take('#alRuleDesc');
  t('W10 検知ルール：同じ値でも実行される形にならない' + tag, rd.includes('検知ルール') && !unsafe(rd), rd);
  vm.runInContext('THR = cloneThr(DEFAULT_THR);', box);
  t('W10 しきい値の入力欄：正しい値では今までと同じ文字列（value="1.5"）' + tag,
    (box.renderThrEditor(), take('#thrBody')).includes('data-thr="m1.wKg" value="1.5"'), '');
  delete els['#alRuleDesc'];

  /* W11 車椅子の変更履歴 */
  box.mdChairLog = [{ on: '2026-09-01' + ATTR, kg: 5 }, { on: BREAK, kg: EVIL }];
  box.renderMdChairLog();
  const wc = take('#mdChairLogRows');
  t('W11 車椅子の変更履歴：日付・重さに入れても value 属性を抜けない' + tag, wc.includes('wc-log-row') && !unsafe(wc), wc);

  /* W12 入居者マスタから来た時のバー */
  box.wrSetFromMasterBar('ok', EVIL);
  const fm = take('#fromMaster');
  box.wrSetFromMasterBar('nontarget', BREAK);
  const fm2 = take('#fromMaster');
  t('W12 マスタから来た時のバー：氏名に入れても実行される形にならない' + tag, !unsafe(fm) && kept(fm) && !unsafe(fm2), fm + fm2);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
