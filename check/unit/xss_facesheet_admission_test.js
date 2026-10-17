/* xss_facesheet_admission_test.js — フェイスシートと入居調整の innerHTML の全数点検の守り（2026-10-17・改善プロンプト第2弾の11）
 *
 * 2つの画面の innerHTML への代入（フェイスシート18か所・入居調整16か所。insertAdjacentHTML・outerHTML は0か所）を全部洗い、入る値が記録・名簿・自由記述に
 * 由来するものは esc を通っていることを確かめた。漏れは入居調整の「今日やること」の1か所だけ
 * （14日以上動いていない案件の「最後に動いたのは …」。fmtDt は日付として読めない値をそのまま返す）で、esc を通した。
 *
 * 固定する約束（利用者・職員の入力に <img src=x onerror=…> や "><script> を入れても、出来上がった HTML に
 * 実行される形＝img・script 要素や属性を抜けた onmouseover が入らない。値は文字として残る＝黙って落とさない）:
 *   F 一覧のカード（rcardHtml・secHtml）／食形態一覧（mealHtml）／詳細のセル（cell・full・fcell）・経過（logList）・
 *     介護度の履歴（careHistHtml）・既往歴とサービス（bfDiseaseServiceBody）／薬剤情報（fullMedsBody）／
 *     安全の帯（renderHlBand）／入居者マスタから来た時のバー（setFromMasterBar）
 *   A 一覧のカード（candCard）／今日やること（renderToday・直した所）／詳細の要約・次にやること・経過
 *     （vsumHtml・nudgeCardHtml・timelineHtml）／アセスメントの表示（assessViewHtml）／編集の入力欄の value 属性（fld・shFld）
 * 実物の画面のソースから関数を切り出して動かす（写経しない）。FACESHEET_HTML・ADMISSION_HTML で差し替えるのは、
 * わざと壊した版で落ちるかの確認用。固定値の氏名はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FS = fs.readFileSync(process.env.FACESHEET_HTML || path.join(ROOT, 'facesheet.html'), 'utf8');
const AF = fs.readFileSync(process.env.ADMISSION_HTML || path.join(ROOT, 'admission-flow.html'), 'utf8');

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
/* 定数の表（var X = [ … ];）。業務の入力ではないので本物をそのまま使う */
function grabVar(src, name) {
  const m = new RegExp('\\nvar ' + name + '\\s*=\\s*\\[').exec(src);
  if (!m) throw new Error('定数が見つかりません: ' + name);
  const end = scanBlock(src, m.index + m[0].length - 1, '[', ']');
  if (end < 0) throw new Error('定数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1) + ';';
}
/* esc は正規表現の中に引用符を含み簡易スキャナで切り出せないので、行の形で取る */
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
/* 画面の $() の代わり。innerHTML を受けるだけの箱 */
function fakeDom() {
  const els = {};
  return {
    els,
    $: (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', style: {}, addEventListener() {}, querySelectorAll() { return []; }, setAttribute() {} })
  };
}

/* ══════════════════════ フェイスシート ══════════════════════ */
console.log('— フェイスシート —');
const FS_ESC = grabLine(FS, /function esc\(s\)\{[^\n]*\}/);
{
  const dom = fakeDom();
  const box = { $: dom.$, ROLE: 'office', MedsEffect: undefined };
  vm.createContext(box);
  vm.runInContext([
    FS_ESC,
    'function isField(){ return ROLE === "field"; }',
    'var weightIdx = {}; var fsMdMap = null, fsMdLoading = false, fsMdErr = ""; var FS_MARK_NOTE = "＊＝薬剤師が未確認の効能";',
    'var mealRows = null, mealLoading = false, mealMsg = "", mealVia = "";',
    'function fsMedsFxOk_(){ return typeof MedsEffect !== "undefined" && typeof MedsEffect.resolveLines === "function" && typeof MedsEffect.key === "function"; }',
    'function clearMasterIdParam(){} function showScreen(){} var curRec = null;',
    grabLine(FS, /function fmtJDate\(iso\)\{[^\n]*\}/),
    grabLine(FS, /function calcAge\(birthISO\)\{[^\n]*\}/),
    grabLine(FS, /function byKana\(a,b\)\{[^\n]*\}/),
    grabVar(FS, 'ERAS'), grabVar(FS, 'MEAL_COLS'),
    grabFn(FS, 'parseIsoDate'), grabFn(FS, 'fmtWarekiJp'),
    grabFn(FS, 'mealCareLv_'), grabLine(FS, /function mealCareNum_\(v\)\{[^\n]*\}/), grabLine(FS, /function mealCopay_\(v\)\{[^\n]*\}/),
    grabFn(FS, 'rcardHtml'), grabFn(FS, 'secHtml'), grabFn(FS, 'mealHtml'),
    grabLine(FS, /function cell\(lab,val,big,sub,cls\)\{[^\n]*\n[^\n]*\}/),
    grabLine(FS, /function full\(lab,val\)\{[^\n]*\}/), grabLine(FS, /function fcell\(lab,val\)\{[^\n]*\}/),
    grabLine(FS, /function sec\(lbl,body\)\{[^\n]*\}/),
    grabFn(FS, 'logList'), grabFn(FS, 'clhNorm_'), grabFn(FS, 'clhSame_'), grabFn(FS, 'clhOf_'), grabFn(FS, 'clhEmpty_'),
    'var CLH_KEYS=["value","certStart","certEnd","certDate"];',
    grabFn(FS, 'careHistHtml'),
    grabFn(FS, 'bfStr'), grabFn(FS, 'bfObj'), grabFn(FS, 'bfCk'), grabVar(FS, 'BF_SERVICES'), grabFn(FS, 'bfDiseaseServiceBody'),
    grabFn(FS, 'fullMedsBody'), grabFn(FS, 'renderHlBand'), grabFn(FS, 'setFromMasterBar')
  ].join('\n'), box);

  /* F3 一覧（rosterBox ← rcardHtml・secHtml） */
  const r = { masterId: '1' + ATTR, name: EVIL, kana: BREAK, room: '101' + ATTR, careLevel: EVIL, height: EVIL, birthDate: '1940-04-03', active: true };
  const card = box.rcardHtml(r);
  t('F3 一覧のカード：氏名・ふりがな・居室・介護度・身長に入れても実行される形にならない', !unsafe(card), card);
  t('F3 一覧のカード：値は文字として残る', kept(card), card);
  const sh = box.secHtml(EVIL, [r]);
  t('F3 区画の見出し（secHtml）も同じ', !unsafe(sh) && kept(sh), sh);

  /* F1 食形態一覧（rosterBox ← mealHtml） */
  box.mealRows = [{ name: EVIL, kana: 'かくう', room: BREAK, careLevel: EVIL, copayRate: EVIL, birthDate: '',
                    mealStaple: EVIL, mealSide: BREAK, mealNote: EVIL, allergy: EVIL, sideEffects: BREAK }];
  const meal = box.mealHtml('');
  t('F1 食形態一覧：氏名・居室・主食・副食・備考・アレルギー・禁忌に入れても実行される形にならない', !unsafe(meal) && kept(meal), meal);
  box.mealRows = null; box.mealMsg = EVIL;
  t('F1 食形態一覧：取得失敗の理由（mealMsg）も同じ', !unsafe(box.mealHtml('')), box.mealHtml(''));

  /* F12・F14 詳細のセル（viewBox ← renderFieldView・renderOfficeView の部品） */
  const cells = box.cell(EVIL, BREAK, true, EVIL) + box.full(EVIL, EVIL) + box.fcell(BREAK, EVIL) + box.sec(EVIL, '');
  t('F12/F14 cell・full・fcell・sec：見出し・値・補足に入れても実行される形にならない', !unsafe(cells) && kept(cells), cells);
  const log = box.logList([{ date: EVIL, text: EVIL, doctor: BREAK, clinic: EVIL, hide: true }, { changedAt: '2026-10-01', value: BREAK }], true);
  t('F14 経過（logList）：日付・本文・医師・医療機関に入れても実行される形にならない', !unsafe(log) && kept(log), log);
  const ch = box.careHistHtml({ careLevel: EVIL, careCertStart: '2026-04-01', careLevelHistory: [
    { value: BREAK, certStart: EVIL, certEnd: EVIL, changedAt: EVIL, note: EVIL, changedBy: ATTR }] });
  t('F14 介護度の履歴（careHistHtml）：介護度・期間・備考・記録した人に入れても実行される形にならない', !unsafe(ch) && kept(ch), ch);
  const dis = box.bfDiseaseServiceBody({ diseases: [{ name: EVIL, onset: BREAK, hospital: EVIL }], services: { homeCare: { on: true, name: EVIL } } });
  t('F14 既往歴の表とサービスの事業所名に入れても実行される形にならない', !unsafe(dis) && kept(dis), dis);

  /* F7 薬剤情報（fullMedsBody。1列の時と、辞書の効能を並べる2列の時） */
  const m1 = box.fullMedsBody(EVIL, EVIL + '\n' + BREAK);
  t('F7 薬剤情報（1列）：薬剤名に入れても実行される形にならない', !unsafe(m1) && kept(m1), m1);
  box.MedsEffect = { key: (s) => s, resolveLines: (raw) => raw.split('\n').map(() => ({ src: 'dict', text: EVIL, mark: BREAK })) };
  box.fsMdMap = {};
  const m2 = box.fullMedsBody('薬剤情報（定期）', EVIL + '\n' + BREAK);
  t('F7 薬剤情報（2列）：薬剤名と辞書の効能に入れても実行される形にならない', !unsafe(m2) && kept(m2) && m2.includes('meds2'), m2);

  /* F8 安全の帯（hlBand ← renderHlBand） */
  box.renderHlBand({ hospitalized: true, preferredName: EVIL, allergy: BREAK, infections: EVIL, medicalCare: EVIL, mealForm: EVIL, thickener: BREAK, careHints: 'x' });
  const hl = dom.els.hlBand.innerHTML;
  t('F8 安全の帯：呼称・アレルギー・感染症・医療処置・食形態・とろみに入れても実行される形にならない', !unsafe(hl) && kept(hl), hl);

  /* F16 入居者マスタから来た時のバー（fromMaster ← setFromMasterBar） */
  box.setFromMasterBar('ok', EVIL);
  const bar = dom.els.fromMaster.innerHTML;
  t('F16 バーの氏名に入れても実行される形にならない', !unsafe(bar) && kept(bar), bar);
}

/* ══════════════════════ 入居調整 ══════════════════════ */
console.log('\n— 入居調整 —');
{
  const dom = fakeDom();
  const box = { $: dom.$, window: {}, TODAY: '2026-10-17' };
  vm.createContext(box);
  vm.runInContext([
    grabLine(AF, /function esc\(s\) \{\n[^\n]*\n[^\n]*\n[^\n]*\n\}/),
    'function todayYmd(){ return TODAY; }',
    'function openView(){} var FILES = {}; var curId = null; var DB = { candidates: [] };',
    'function dsecIsOpen(){ return true; }',
    grabFn(AF, 'asStr'), grabFn(AF, 'asArr'), grabFn(AF, 'isObj'), grabFn(AF, 'asObj'), grabFn(AF, 'fmtD'), grabFn(AF, 'fmtDt'),
    grabFn(AF, 'telHref'), grabFn(AF, 'afEditedBy_'), grabFn(AF, 'warekiOf'), grabFn(AF, 'ageText'),
    grabVar(AF, 'STAGES'), grabVar(AF, 'CATS'), grabVar(AF, 'DIRS'), grabVar(AF, 'BF_LEVELS'), grabVar(AF, 'BF_SERVICES'),
    grabVar(AF, 'BF_MOVE_AID'), grabVar(AF, 'BF_BATH_PLACE'), grabVar(AF, 'BF_EXCRETE_WAY'), grabVar(AF, 'BF_BPSD'), grabVar(AF, 'BF_NIGHT'),
    /* ご相談シートの選択肢（SH_ARIMU〜SH_GENDER）は ASSESS_TEXT が参照するので先に置く */
    grabLine(AF, /\nvar SH_ARIMU = [\s\S]*?\nvar SH_GENDER = [^\n]*/),
    grabVar(AF, 'ASSESS_TEXT'),
    'var DATE_ISO_RE = /^\\d{4}-\\d{2}-\\d{2}$/; var DATE_PH = "S15.4.3 / 2026-09-16"; var SH_WIDE_KEYS = {};',
    grabFn(AF, 'stageIdx'), grabFn(AF, 'stageLabel'), grabFn(AF, 'catLabel'), grabFn(AF, 'dirLabel'),
    grabFn(AF, 'taskStats'), grabFn(AF, 'candFiles'), grabFn(AF, 'openNudges'), grabFn(AF, 'contactsFor'),
    grabFn(AF, 'candCard'), grabFn(AF, 'daysBetween'), grabFn(AF, 'todayBuckets'), grabFn(AF, 'todayBucketsOf'),
    grabFn(AF, 'todayRow'), grabFn(AF, 'renderToday'),
    grabFn(AF, 'vsumHtml'), grabFn(AF, 'nudgeCardHtml'), grabFn(AF, 'timelineHtml'), grabFn(AF, 'assessViewHtml'),
    grabFn(AF, 'dateCellHtml'), grabFn(AF, 'fld'), grabFn(AF, 'shFld')
  ].join('\n'), box);

  /* A3 一覧のカード（list ← candCard）。A15 の KPI の案件一覧も同じ candCard */
  const c = { id: 'c1' + ATTR, name: EVIL, kana: BREAK, source: EVIL, sourceDetail: BREAK, careLevel: EVIL, desiredDate: EVIL,
              room: BREAK, stage: 'lost', lostReason: EVIL, stageDates: {}, tasks: [], nudges: [] };
  const card = box.candCard(c);
  t('A3 一覧のカード：氏名・ふりがな・経路・紹介元・介護度・希望日・居室・見送り理由に入れても実行される形にならない', !unsafe(card) && kept(card), card);

  /* A4 今日やること（todayBox ← renderToday）。★直した所＝14日以上動いていない案件の更新日時 */
  box.DB.candidates = [
    { id: 'a', name: EVIL, stage: 'applied', stageDates: { tour: '2026-10-01' }, updatedAt: '2026-10-16T00:00:00Z', log: [],
      tasks: [{ id: 't1', title: EVIL, cat: BREAK, st: 'todo', due: '2026-10-01' }, { id: 't2', title: BREAK, cat: 'family', st: 'todo', due: '2026-10-18' }],
      nudges: [{ id: 'n1', title: EVIL, why: BREAK, cats: [EVIL], done: false }] },
    { id: 'b', name: '架空 次郎', stage: 'inquiry', stageDates: {}, tasks: [], nudges: [], log: [],
      updatedAt: '2026-01-01' + EVIL }
  ];
  box.renderToday();
  const today = dom.els.todayBox.innerHTML;
  t('A4 今日やること：氏名・タスクの件名・区分・連絡の件名と理由に入れても実行される形にならない', !unsafe(today), today);
  t('A4 今日やること：14日以上動いていない案件の欄が出ている（試験の前提）', today.includes('14日以上動いていません（1）'), today);
  t('A4 ★更新日時が日付として読めない値でも実行される形にならない（2026-10-17 に直した所）',
    !/<img\b/i.test(today.slice(today.indexOf('最後に動いたのは'))), today.slice(today.indexOf('最後に動いたのは'), today.indexOf('最後に動いたのは') + 120));
  t('A4 値は文字として残る', kept(today), today);

  /* A5 詳細（viewBox ← renderView の部品） */
  const d = { id: 'd1', name: EVIL, kana: BREAK, stage: 'applied', careLevel: EVIL, source: BREAK, room: EVIL, phone: '0120' + EVIL,
              desiredDate: BREAK, updatedAt: EVIL, updatedBy: ATTR, updatedByAt: EVIL, stageDates: { applied: EVIL }, tasks: [],
              lostReason: EVIL,
              contacts: [{ id: 'k1', cat: 'family', org: EVIL, person: BREAK, tel: '096' + EVIL, fax: ATTR }],
              nudges: [{ id: 'n' + ATTR, title: EVIL, why: BREAK, cats: ['family'], done: false },
                       { id: 'n2', title: BREAK, at: '1', done: true, doneAt: EVIL }],
              log: [{ at: EVIL, partner: BREAK, method: EVIL, summary: EVIL, by: ATTR }] };
  const vs = box.vsumHtml(d);
  t('A5 詳細の要約（vsumHtml）：氏名・介護度・経路・居室・電話・直した人に入れても実行される形にならない', !unsafe(vs) && kept(vs), vs);
  const nd = box.nudgeCardHtml(d);
  t('A5 次にやること（nudgeCardHtml）：件名・理由・連携先・FAX に入れても実行される形にならない', !unsafe(nd) && kept(nd), nd);
  const tl = box.timelineHtml(d);
  t('A5 経過（timelineHtml）：連絡の日時・相手・手段・内容・記録した人に入れても実行される形にならない', !unsafe(tl) && kept(tl), tl);
  const as = box.assessViewHtml({ assess: { walking: EVIL, moveAid: { walker: true, note: BREAK },
    services: { homeCare: { on: true, name: EVIL } }, diseases: [{ name: EVIL, onset: BREAK, hospital: EVIL }], consulterName: EVIL } });
  t('A5 アセスメントの表示（assessViewHtml）：ADL・補足・事業所名・病名・自由記述に入れても実行される形にならない', !unsafe(as) && kept(as), as);

  /* A9 編集（editBox ← fld・shFld・dateCellHtml）。value="…" の属性を抜けないこと */
  const ed = box.fld('name', '氏名', ATTR) + box.fld('note', 'メモ', '</textarea>' + EVIL, 'textarea') + box.fld('gender', '性別', ATTR, 'select', ['女', '男']) +
             box.fld('birthDate', '生年月日', ATTR, 'date') + box.shFld('consulterName', 'ご相談者氏名', 'text', null, ATTR) +
             box.shFld('formNote', '備考', 'textarea', null, '</textarea>' + EVIL) + box.shFld('walking', '歩行', 'select', ['', ATTR], ATTR);
  t('A9 編集の入力欄：value 属性・textarea の中身に入れても抜けない', !unsafe(ed) && !/<\/textarea><img/i.test(ed), ed);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
