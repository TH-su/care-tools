/* 職員マスタの事業所の区分の名前を施設情報（corpSettings.siteLabels）から差し替える試験（2026-11-14 新設・第6段 SM-02・代表者の決定 2026-11-14）
   実行: node check/unit/staff_site_labels_test.js

   守ること:
     (1) 施設情報に書いていない・崩れている時は、今の4つの名前（施設・訪問・通所・居宅）のまま・false を返す（画面を描き直さない）
     (2) 4つ全部が 1〜6 字・互いに別・「厨房」と別の時だけ差し替え、1つでも崩れていれば丸ごと今の名前に戻す
     (3) 差し替えるのは名前だけ。コード・保存の列（真偽の4列）・使う事業所・厨房の兼務の既定・保存済みの値の読み方は変えない
     (4) 施設情報の読み口（su-facility.js）が siteLabels を通す（書いていなければ null）
     (5) 画面が起動時に当て、変わった時だけ描き直す。CSV の取り込みは今の名前・旧い名前の両方の見出しを読む
   ★このファイルは公開リポジトリの check/unit にある。氏名・施設名は使わない（架空の区分名だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CALC_PATH = path.join(ROOT, 'staff-master-calc.js');
const FAC_PATH = path.join(ROOT, 'su-facility.js');
const JS = fs.readFileSync(path.join(ROOT, 'staff-master.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'staff-master.html'), 'utf8');
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'facility-profile.sample.json'), 'utf8'));

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : '')); }
}
function fresh() { delete require.cache[require.resolve(CALC_PATH)]; return require(CALC_PATH); }
const DEF = { facility: '施設', visit: '訪問', day: '通所', cm: '居宅' };
const NEW = { facility: 'ホーム', visit: '訪問介護', day: 'デイ', cm: '居宅支援' };
function snap(C) {
  return JSON.stringify([C.SITE_LABEL, C.LABELS.siteFacility, C.LABELS.siteVisit, C.LABELS.siteDay, C.LABELS.siteCm, C.ENUMS.primarySite]);
}

console.log('\n— (1) 書いていない・崩れている時は今の名前のまま —');
{
  const C = fresh();
  const base = snap(C);
  t('今の名前は施設・訪問・通所・居宅', JSON.stringify(C.SITE_LABEL) === JSON.stringify(DEF));
  [null, undefined, {}, [], '施設', 1].forEach(function (v) {
    t('値 ' + JSON.stringify(v) + ' → false・変えない', C.setSiteLabels(v) === false && snap(C) === base);
  });
}

console.log('\n— (2) 4つ全部がそろった時だけ差し替える —');
{
  const C = fresh();
  t('4つそろえば true', C.setSiteLabels(NEW) === true);
  t('区分の名前（SITE_LABEL）', JSON.stringify(C.SITE_LABEL) === JSON.stringify(NEW), C.SITE_LABEL);
  t('列の名前（LABELS の真偽4列）', C.LABELS.siteFacility === 'ホーム' && C.LABELS.siteVisit === '訪問介護' && C.LABELS.siteDay === 'デイ' && C.LABELS.siteCm === '居宅支援');
  t('主たる事業所の選択肢（厨房は今のまま）', C.ENUMS.primarySite.facility === 'ホーム' && C.ENUMS.primarySite.day === 'デイ' && C.ENUMS.primarySite.kitchen === '厨房');
  t('同じ値をもう一度 → false（描き直さない）', C.setSiteLabels(JSON.parse(JSON.stringify(NEW))) === false);
  t('前後の空白は落とす', C.setSiteLabels({ facility: ' ホーム ', visit: '訪問介護', day: 'デイ', cm: '居宅支援' }) === false && C.SITE_LABEL.facility === 'ホーム');
  t('自分の区分の今の名前はそのまま使える', fresh().normSiteLabels(Object.assign({}, NEW, { day: '通所' })) !== null);
  t('崩れた値を受けたら丸ごと今の名前へ戻す（true）', C.setSiteLabels({ facility: 'ホーム' }) === true && JSON.stringify(C.SITE_LABEL) === JSON.stringify(DEF));
  const bad = [
    { facility: 'ホーム', visit: '訪問介護', day: 'デイ' },                                        /* 足りない */
    Object.assign({}, NEW, { extra: 'x' }),                                                   /* 余計な鍵 */
    Object.assign({}, NEW, { day: '' }),                                                      /* 空 */
    Object.assign({}, NEW, { day: '   ' }),                                                   /* 空白だけ */
    Object.assign({}, NEW, { day: 'とても長い区分名' }),                                          /* 7字 */
    Object.assign({}, NEW, { day: 'ホーム' }),                                                 /* 重なり */
    Object.assign({}, NEW, { day: '厨房' }),                                                   /* 厨房と同じ */
    Object.assign({}, NEW, { day: 3 }),                                                       /* 文字でない */
    Object.assign({}, NEW, { day: '<b>' }),                                                   /* 記号 */
    Object.assign({}, NEW, { day: 'デ,イ' }),                                                 /* CSV の区切り */
    Object.assign({}, NEW, { day: 'デ イ' }),                                                 /* 間の空白 */
    Object.assign({}, NEW, { facility: '事業所' }),                                           /* CSV の見出しの語（主たる事業所の別名） */
    Object.assign({}, NEW, { day: '備考' }),                                                  /* CSV の見出しの語 */
    Object.assign({}, NEW, { visit: 'ＩＤ' }),                                                /* 全角でも見出しの語と同じ */
    Object.assign({}, NEW, { facility: '通所' }),                                             /* ほかの区分の今の名前 */
    Object.assign({}, NEW, { cm: '施設' })                                                    /* ほかの区分の今の名前 */
  ];
  bad.forEach(function (v, i) {
    const D = fresh();
    const base = snap(D);
    t('崩れた例 ' + (i + 1) + ' → false・今の名前のまま', D.normSiteLabels(v) === null && D.setSiteLabels(v) === false && snap(D) === base, v);
  });
}

console.log('\n— (3) 名前のほかは変えない —');
{
  const C = fresh();
  const codes = JSON.stringify(C.SITE_CODES), cols = JSON.stringify(C.SITE_COL), act = JSON.stringify(C.SITE_ACTIVE), kit = JSON.stringify(C.KITCHEN_SITES), corp = JSON.stringify(C.corp());
  const row = { siteFacility: true, siteVisit: false, siteDay: true, siteCm: false, siteRatiosJson: '{"facility":40,"day":60}', primarySite: 'day' };
  const before = JSON.stringify([C.belongsTo(row, 'facility'), C.belongsTo(row, 'day'), C.belongsTo(row, 'visit'), C.siteRatios(row)]);
  C.setSiteLabels(NEW);
  t('コード・保存の列・使う事業所・厨房の既定・法人設定は同じ', JSON.stringify(C.SITE_CODES) === codes && JSON.stringify(C.SITE_COL) === cols && JSON.stringify(C.SITE_ACTIVE) === act && JSON.stringify(C.KITCHEN_SITES) === kit && JSON.stringify(C.corp()) === corp);
  t('保存済みの値の読み方（所属・兼務比率）は同じ', JSON.stringify([C.belongsTo(row, 'facility'), C.belongsTo(row, 'day'), C.belongsTo(row, 'visit'), C.siteRatios(row)]) === before);
  const st = C.siteStats([{ id: 'x1', name: '架空 一', hireDate: '2020-04-01', siteFacility: true }], '2026-04-01', '2026-10-31');
  t('事業所別の集計の見出しは今の名前で出す', Array.isArray(st) ? st.some(function (r) { return r && r.label === 'ホーム'; }) : JSON.stringify(st).indexOf('ホーム') >= 0, st);
  const legacy = C.mapLegacyRow(['氏名', '施設', '訪問', '通所', '居宅'], ['架空 一', '○', '', '○', '']);
  t('旧い表の取り込み（mapLegacyRow）は今までの見出しのまま読む', legacy && legacy.fields && legacy.fields.siteFacility === true && legacy.fields.siteDay === true && legacy.fields.siteVisit === false, legacy && legacy.fields);
}

console.log('\n— (4) 施設情報の読み口 —');
function loadFacility(profile) {
  const store = { su_facility_json_v1: JSON.stringify(profile) };
  const sb = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: () => new Promise(() => {}), console
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(FAC_PATH, 'utf8'), sb);
  return sb.window.SUFacility;
}
{
  const base = JSON.parse(JSON.stringify(PROFILE));
  t('公開している見本には書いていない（null＝今の名前）', loadFacility(base).section('siteLabels') === null);
  base.corpSettings = Object.assign({}, base.corpSettings || {}, { siteLabels: NEW });
  const F = loadFacility(base);
  t('corpSettings.siteLabels を通す', JSON.stringify(F.section('siteLabels')) === JSON.stringify(NEW), F.section('siteLabels'));
  const C = fresh();
  t('読んだ値をそのまま計算部品へ当てられる', C.setSiteLabels(F.section('siteLabels')) === true && C.SITE_LABEL.visit === '訪問介護');
  const SEC = fs.readFileSync(path.join(ROOT, 'check', 'facility-secret-check.mjs'), 'utf8');
  t('貼る前の確かめ（facility-secret-check）も同じ判定（normSiteLabels）で崩れを止める', /normSiteLabels\(p\.corpSettings\.siteLabels\)/.test(SEC) && /ng\('corpSettings\.siteLabels'/.test(SEC));
}

console.log('\n— (5) 画面のつなぎ —');
{
  const C = fresh();
  const vc = /staff-master-calc\.js\?v=([0-9.\-]+)/.exec(HTML);
  t('計算部品の ?v= と VERSION がそろう', vc && vc[1] === C.VERSION, [vc && vc[1], C.VERSION]);
  const loc = JS.slice(JS.indexOf('function applyLocalityNow()'), JS.indexOf('function loadCommittees()'));
  t('施設情報を当てる時に区分の名前も当てる', /applySiteLabelsNow\(\);/.test(loc));
  const ap = JS.slice(JS.indexOf('function applySiteLabelsNow()'), JS.indexOf('function loadCommittees()'));
  t('施設情報の siteLabels を読む', /SUFacility\.section\('siteLabels'\)/.test(ap));
  t('変わった時だけ描き直す', /if \(!changed\) return;/.test(ap));
  t('入力欄・法人設定の欄・主たる事業所の選択肢の文字を差し替える', /label\[for="' \+ u\.chk/.test(ap) && /corpA_/.test(ap) && /f_primarySite/.test(ap));
  t('画面の今の名前（HTML）は今の4つのまま', ['施設', '訪問', '通所', '居宅'].every(function (w, i) {
    return HTML.indexOf('<label for="' + ['f_siteFacility', 'f_siteVisit', 'f_siteDay', 'f_siteCm'][i] + '">' + w + '</label>') > 0;
  }));
  const gk = JS.slice(JS.indexOf('function guessKey('), JS.indexOf('function onCsvFile('));
  t('CSV の見出しは今の名前を先に見て、旧い名前も読む', /siteLabelOf\(u\.code\)/.test(gk) && gk.indexOf('siteLabelOf(u.code)') < gk.lastIndexOf('if (HEADER_ALIAS[s]) return HEADER_ALIAS[s];'));
  const mh = JS.slice(JS.indexOf('function mappedHeader()'), JS.indexOf('function buildImportPlan()'));
  t('自動判定の区分の見出しは取り込みの規則が読む旧い見出しへ置き換える', /LEGACY_HEADER\[g\]/.test(mh));

  /* 名前に使えない語の一覧が、画面の取り込みの別名・取り込む項目の名前・書き出しの見出しを全部含む（画面の別名が増えたら計算部品にも足す） */
  {
    const C4 = fresh();
    const R = C4.SITE_LABEL_RESERVED;
    const words = [];
    const ha = /var HEADER_ALIAS = \{([\s\S]*?)\n\};/.exec(JS)[1];
    ha.replace(/'([^']+)': '([^']+)'/g, function (m, k, v) { if (!/^site/.test(v)) words.push(k); return m; });
    const ik = /var IMPORT_KEYS = \[([\s\S]*?)\n\];/.exec(JS)[1];
    ik.replace(/\['([^']+)', '([^']+)'\]/g, function (m, k, v) { if (!/^site/.test(k)) words.push(v); return m; });
    const ec = /var EXPORT_COLS = \[([\s\S]*?)\];/.exec(JS)[1].match(/'([^']+)'/g).map(function (x) { return x.slice(1, -1); });
    ec.forEach(function (k) { if (!/^site(Facility|Visit|Day|Cm)$/.test(k)) words.push(C4.LABELS[k] || ({ siteRatiosJson: '兼務比率' })[k] || k); });   /* 兼務比率は画面の FALLBACK_LABELS の名前 */
    words.push('年齢', '勤続年数', '雇用保険番号', '厨房');
    /* 旧い表の取り込み（mapLegacyRow）が見出しで読む語も、計算部品の中身から拾う（反証レビュー2回目 2026-11-14） */
    const CALC_SRC = fs.readFileSync(CALC_PATH, 'utf8');
    const ml = CALC_SRC.slice(CALC_SRC.indexOf('function mapLegacyRow('), CALC_SRC.indexOf('function mapLegacyRow(') + 20000);
    const mlWords = [];
    ml.replace(/\b(?:cell|idxOf|idxStarting)\('([^']+)'\)/g, function (m, w) { if (['施設', '訪問', '通所', '居宅'].indexOf(w) < 0) mlWords.push(w); return m; });
    t('旧い表の取り込みが読む語を拾えている（' + mlWords.length + '語）', mlWords.length >= 15 && mlWords.indexOf('介護福祉士') >= 0, mlWords);
    mlWords.forEach(function (w) { words.push(w); });
    const miss = words.filter(function (w) { return R.indexOf(C4.normName(w)) < 0; });
    t('名前に使えない語が、取り込みの別名・取り込む項目・書き出しの見出しを全部含む（' + words.length + '語）', words.length > 40 && miss.length === 0, miss);
  }

  /* guessKey と mappedHeader を切り出して、名前を変えた施設で書き出した見出しを読めるかを確かめる */
  const pick = function (name) {
    const i = JS.indexOf('function ' + name + '(');
    let d = 0, j = JS.indexOf('{', i);
    for (let k = j; k < JS.length; k++) { if (JS[k] === '{') d++; else if (JS[k] === '}') { d--; if (d === 0) return JS.slice(i, k + 1); } }
    return '';
  };
  const grab = function (name) { const m = new RegExp('var ' + name + ' = [\\s\\S]*?\\n\\};?\\n|var ' + name + ' = \\[[\\s\\S]*?\\n\\];\\n').exec(JS); return m ? m[0] : ''; };
  const C2 = fresh();
  C2.setSiteLabels(NEW);
  const sb = { window: { StaffCalc: C2 }, ST: { imp: { header: ['氏名', 'ホーム', 'デイ', '通所', '施設', '備考'], sel: [] } }, $: function () { return null; } };
  vm.createContext(sb);
  const code = [JS.slice(JS.indexOf('function SC()'), JS.indexOf('\n', JS.indexOf('function SC()')) + 1), pick('txt'), pick('fieldLabel'),
    'var FALLBACK_LABELS = {};', grab('SITE_UI'), 'var SITE_CHK_BY_COL = {}; SITE_UI.forEach(function (s) { SITE_CHK_BY_COL[s.col] = s.chk; });',
    pick('siteLabelOf'), grab('IMPORT_KEYS'), grab('LEGACY_HEADER'), grab('HEADER_ALIAS'), pick('importKeyLabel'), pick('guessKey'), pick('mappedHeader')].join('\n');
  try {
    vm.runInContext(code, sb);
    const keys = sb.ST.imp.header.map(function (hd) { return vm.runInContext('guessKey(' + JSON.stringify(hd) + ')', sb); });
    t('今の名前の見出し（ホーム・デイ）と旧い名前の見出し（通所・施設）を区分の列に結ぶ', JSON.stringify(keys) === JSON.stringify(['name', 'siteFacility', 'siteDay', 'siteDay', 'siteFacility', 'note']), keys);
    const mapped = vm.runInContext('mappedHeader()', sb);
    t('取り込みの規則へは旧い見出しで渡す', JSON.stringify(mapped) === JSON.stringify(['氏名', '施設', '通所', '通所', '施設', '備考']), mapped);
    const row = C2.mapLegacyRow(mapped, ['架空 二', '○', '○', '', '', '']);
    t('書き出した CSV を読み戻すと所属の印が残る', row && row.fields && row.fields.siteFacility === true && row.fields.siteDay === true, row && row.fields);
    const C3 = fresh();
    sb.window.StaffCalc = C3;
    const k3 = ['施設', '訪問', '通所', '居宅'].map(function (hd) { return vm.runInContext('guessKey(' + JSON.stringify(hd) + ')', sb); });
    t('今の施設（名前を書いていない）は今と同じ見出しで読む', JSON.stringify(k3) === JSON.stringify(['siteFacility', 'siteVisit', 'siteDay', 'siteCm']), k3);
    sb.ST.imp = { header: ['職員No', '氏名', ' 施設 ', '訪問', '通所', '居宅', '事業所', '主たる事業所', '備考', '不明な列'], sel: [] };
    const m3 = vm.runInContext('mappedHeader()', sb);
    t('今の施設の自動判定: 区分の列は同じ語・ほかの列は見出しのまま渡す', JSON.stringify(m3) === JSON.stringify(['職員No', '氏名', '施設', '訪問', '通所', '居宅', '事業所', '主たる事業所', '備考', '不明な列']), m3);
    const g3 = ['事業所', '主たる事業所', '備考'].map(function (hd) { return vm.runInContext('guessKey(' + JSON.stringify(hd) + ')', sb); });
    t('区分でない別名は区分の名前より先に決まる', JSON.stringify(g3) === JSON.stringify(['primarySite', 'primarySite', 'note']), g3);
  } catch (e) {
    t('取り込みの関数を切り出して動かせる', false, String(e && e.message));
  }
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
