/* デイ利用表（daycare-roster.html）：職員に見える文から技術用語を減らし、接続先が無い時の案内と、色の凡例を出す（品質改善 第3期 便7）。
   実物の HTML を読み、変えた文ごとに「前の技術用語が無い」「新しい文がある」を確かめる。
   案内の文・リンクの出し分け・断りの言い換え・凡例は、実物の関数を切り出して動かす（写経しない）。
   対象 HTML は環境変数 DAYCARE_ROSTER_HTML で差し替えられる（直す前の版で落ちることを確かめるため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = process.env.DAYCARE_ROSTER_HTML || path.join(ROOT, 'daycare-roster.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const has = (s) => src.indexOf(s) >= 0;
const count = (s) => src.split(s).length - 1;

/* 関数を名前で切り出す（async 付きは async ごと） */
function cut(name) {
  let head = src.indexOf('\nfunction ' + name + '(');
  if (head < 0) { head = src.indexOf('\nasync function ' + name + '('); if (head < 0) return null; }
  head += 1;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  return null;
}
/* const NAME = { ... }; を切り出す（var に替えて vm で使う） */
function cutObj(name) {
  const head = src.indexOf('\nconst ' + name + ' = {');
  if (head < 0) return null;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return 'var ' + name + ' = ' + src.slice(src.indexOf('{', head), i + 1) + ';'; }
  }
  return null;
}

/* 試験用の小さな DOM（el が使う分だけ） */
function fakeDoc() {
  function node(tag) {
    return {
      tagName: tag, className: '', children: [], attrs: {}, _text: '', hidden: false,
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      querySelector() { return null; },
      set textContent(v) { this._text = String(v); this.children = []; },
      get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    };
  }
  return {
    createElement: node,
    createTextNode(s) { return { textContent: String(s), children: [], className: '' }; }
  };
}
function walk(n, f) { f(n); (n.children || []).forEach(c => walk(c, f)); }

const TECH = /Supabase|GAS|トークン|token|JSON|API|localStorage|HTTP|fetch|\.js\b/i;
const CS = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');
const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
const HINT = fs.readFileSync(path.join(ROOT, 'su-cfg-hint.js'), 'utf8');

console.log('— 1. 部品のファイル名を出さない —');
t('1-1 「データ層を読み込めていません（su-data.js）」を出さない', !has('データ層を読み込めていません（su-data.js）'));
t('1-2 代わりに「共通の部品を読み込めていません。同期できません。ページを再読み込みしてください」',
  count("toast('共通の部品を読み込めていません。同期できません。ページを再読み込みしてください');") === 1);
t('1-3 「印刷モジュール（su-print.js）」を出さない（2か所とも）', !has('印刷モジュール（su-print.js）'));
t('1-4 代わりに「印刷の部品を読み込めていません。ページを再読み込みしてください」（2か所）',
  count("toast('印刷の部品を読み込めていません。ページを再読み込みしてください', true);") === 2);

console.log('— 2. 保存の断りに英語の例外文をそのまま出さない —');
const fRunSaver = cut('runSaver') || '';
t('2-1 保存の失敗の知らせに e.message をそのまま入れない', !!fRunSaver && !/e && e\.message \? e\.message/.test(fRunSaver));
t('2-2 保存の失敗の知らせは dcrSaveErrWords_ を通す', /を保存できませんでした（' \+ dcrSaveErrWords_\(e\) \+ '）。変更を取り消しました'/.test(fRunSaver));
const fText = cut('dcrSaveErrText_') || '';
t('2-3 本人指示の言い換え（login・forbidden・shadow）はそのまま',
  fText.indexOf("'Google のログインが切れています。ログインしてから、もう一度押してください'") >= 0 &&
  fText.indexOf("'このアカウントでは保存できません。事務所の端末・事務所のアカウントで操作してください'") >= 0 &&
  fText.indexOf("'保存先の切り替えがまだ終わっていません。少し待ってから、もう一度押してください'") >= 0);
const fWords = cut('dcrSaveErrWords_');
t('2-4 言い換えの関数がある', !!fWords);
function runWords(e) {
  const notes = [];
  const ctx = { window: { SUErrors: { note: (k, m, w) => notes.push([k, m, w]) } }, SUErrors: null };
  ctx.SUErrors = ctx.window.SUErrors;
  vm.createContext(ctx);
  ctx.__e = e;
  vm.runInContext(fWords + '\nthis.__r = dcrSaveErrWords_(this.__e);', ctx);
  return { r: ctx.__r, notes };
}
if (fWords) {
  const mk = (name, msg) => { const x = new Error(msg); x.name = name; return x; };
  let o = runWords(mk('TypeError', 'Failed to fetch'));
  t('2-5 通信の失敗（Failed to fetch）＝「通信がうまくいきませんでした」・記録しない', o.r === '通信がうまくいきませんでした' && o.notes.length === 0, o);
  o = runWords(mk('Error', 'HTTP 503'));
  t('2-6 HTTP 5xx も通信の失敗・記録しない', o.r === '通信がうまくいきませんでした' && o.notes.length === 0, o);
  o = runWords(mk('Error', 'HTTP 403'));
  t('2-7 HTTP 4xx＝「接続先の設定を確かめてください（管理者に伝えてください）」・記録しない',
    o.r === '接続先の設定を確かめてください（管理者に伝えてください）' && o.notes.length === 0, o);
  o = runWords(mk('SyntaxError', 'Unexpected token < in JSON at position 0'));
  t('2-8 応答が読めない（JSON）＝設定の誤り・記録しない', o.r === '接続先の設定を確かめてください（管理者に伝えてください）' && o.notes.length === 0, o);
  o = runWords(mk('TypeError', "Cannot read properties of undefined (reading 'x')"));
  t('2-9 画面の中のエラー（TypeError）＝「画面の中で思わぬエラーが起きました（画面を読み込み直してください）」・記録する',
    o.r === '画面の中で思わぬエラーが起きました（画面を読み込み直してください）' && o.notes.length === 1 && o.notes[0][2] === 'daycare-roster', o);
  o = runWords(mk('Error', 'no such generation'));
  t('2-10 ほかの英語の符号＝「サーバーから思わぬ返事がありました」・元の文は記録に残す',
    o.r === 'サーバーから思わぬ返事がありました' && o.notes.length === 1 && o.notes[0][1] === 'no such generation', o);
  o = runWords(mk('Error', 'この端末の週間計画が古いため拒否されました'));
  t('2-11 日本語の断り（bathwipe の言い換え等）はそのまま・記録しない', o.r === 'この端末の週間計画が古いため拒否されました' && o.notes.length === 0, o);
  o = runWords(mk('Error', '共通の部品を読み込めていません（su-kv.js）'));
  t('2-12 日本語の断りの括弧の中のファイル名だけ外す', o.r === '共通の部品を読み込めていません' && o.notes.length === 0, o);
  o = runWords(mk('Error', 'badtoken'));
  t('2-13 合言葉の誤り＝接続設定の「週間計画・ワースケ・シフト」を確かめる・記録しない',
    o.r === '合言葉が合っていません。接続設定の「週間計画・ワースケ・シフト」を確かめてください' && o.notes.length === 0, o);
  o = runWords(mk('Error', ''));
  t('2-14 空の時＝「原因が分かりませんでした」（括弧が空にならない）', o.r === '原因が分かりませんでした' && o.notes.length === 0, o);
  o = runWords(mk('Error', 'Load failed'));
  t('2-15 iPhone の通信の失敗（Load failed）も記録しない', o.r === '通信がうまくいきませんでした' && o.notes.length === 0, o);
} else { t('2-5〜2-15 言い換えの関数を動かせる', false); }

console.log('— 3. 週間計画の接続先が無い時の案内 —');
t('3-1 「同期先が未設定です（週間計画アプリで設定してください）」を出さない', !has('同期先が未設定です（週間計画アプリで設定してください）'));
t('3-2 接続先が無い時の知らせは dcrNoCfgToast_ を通す（取得・保存の2か所）', count('toast(dcrNoCfgToast_(), true);') === 2);
const fField = cut('dcrIsField_'), fToast = cut('dcrNoCfgToast_'), fGuide = cut('dcrNoCfgGuide_'), fEl = cut('el');
t('3-3 案内の関数がある', !!fField && !!fToast && !!fGuide && !!fEl);
function ctxFor(role) {
  const ctx = { document: fakeDoc(), localStorage: { getItem: (k) => (k === 'su_device_role' ? role : null) } };
  vm.createContext(ctx);
  vm.runInContext("var DCR_DEVICE_KEY = 'su_device_role';\n" + fField + '\n' + fEl + '\n' + fToast + '\n' + fGuide, ctx);
  return ctx;
}
const csTitleOk = CS.indexOf("title:'週間計画・ワースケ・シフト'") >= 0 && CS.indexOf("field('接続先のURL'") >= 0 && CS.indexOf("field('合言葉'") >= 0;
t('3-4 接続設定の実物に「週間計画・ワースケ・シフト」「接続先のURL」「合言葉」の欄がある（案内の言い方と合う）', csTitleOk);
t('3-5 入居者マスタの実物に「管理者の方（端末設定を変更）」がある（現場の案内の言い方と合う）', RM.indexOf('管理者の方（端末設定を変更）') >= 0);
if (fField && fToast && fGuide && fEl) {
  const off = ctxFor('office'), none = ctxFor(null), fld = ctxFor('field');
  const tOff = vm.runInContext('dcrNoCfgToast_()', off), tNone = vm.runInContext('dcrNoCfgToast_()', none), tFld = vm.runInContext('dcrNoCfgToast_()', fld);
  t('3-6 事務所PCの知らせ: 何が足りないかと、接続設定のどの欄に何を入れるか',
    tOff === '週間計画の接続先が入っていません。「設定の控え」があれば接続設定の「控えから戻す」で戻し、無ければ接続設定の「週間計画・ワースケ・シフト」に、接続先のURLと合言葉を入れてください', tOff);
  t('3-7 用途の印が無い端末も事務所PCと同じ', tNone === tOff, tNone);
  t('3-8 現場端末の知らせ: 接続設定を案内せず、画面下の帯と同じ「事務所に連絡」', tFld === 'この端末には週間計画の接続先が入っていません。事務所に連絡してください', tFld);
  function guide(ctx) {
    const host = ctx.document.createElement('div');
    host._text = '古い文';
    ctx.__h = host;
    vm.runInContext('dcrNoCfgGuide_(this.__h)', ctx);
    const links = [];
    walk(host, n => { if (n.tagName === 'a') links.push(n); });
    return { text: host.textContent, links };
  }
  const gOff = guide(off), gFld = guide(fld);
  t('3-9 事務所PCの案内: 何が足りないか（週間計画の接続先＝URLと合言葉）', gOff.text.indexOf('この端末には、週間計画の接続先（Google の受け口の URL と合言葉）がまだ入っていません。') === 0, gOff.text);
  t('3-10 事務所PCの案内: 帯と同じく「控えから戻す」が先、無ければ欄の名前に手で入れる、その後に押すボタン',
    gOff.text.indexOf('「設定の控え」があれば、接続設定の「控えから戻す」で全部のアプリの設定を一括で戻せます。控えが無い時は、接続設定の画面の「週間計画・ワースケ・シフト」の欄に「接続先のURL」と「合言葉」を入れて保存します。どちらの後も、この画面の「クラウドから取得」を押してください。') >= 0, gOff.text);
  t('3-11 事務所PCの案内: 接続設定はログインが先に要ること', gOff.text.indexOf('接続設定を開くには、事務所か管理者のアカウントでのログインが先に要ります。') >= 0, gOff.text);
  t('3-12 事務所PCの案内: 接続設定へのリンク（connection-settings.html）が1つ',
    gOff.links.length === 1 && gOff.links[0].attrs.href === 'connection-settings.html#restore' && gOff.links[0].textContent === '接続設定の画面を開く', gOff.links.map(a => a.attrs));
  t('3-13 古い中身を消してから組み立てる', gOff.text.indexOf('古い文') < 0);
  t('3-14 現場端末の案内: リンクを出さない', gFld.links.length === 0, gFld.links.map(a => a.attrs));
  t('3-15 現場端末の案内: 事務所に連絡・管理者が用途を切り替えて入れ、入れた後に現場用に戻す（果たせる頼み・CLAUDE.md §2-5）',
    gFld.text.indexOf('この端末（現場用）では入れられません。事務所に連絡してください（管理者が入居者マスタの「管理者の方（端末設定を変更）」でこの端末を事務所用に切り替えて接続設定で入れ、入れた後に現場用に戻します）。') >= 0, gFld.text);
  t('3-15b 画面下の帯（su-cfg-hint.js）の実物と言い方が合う（現場「事務所に連絡」・事務所「控えから戻す」と #restore）',
    HINT.indexOf('事務所に連絡してください') >= 0 && HINT.indexOf('「設定の控え」があれば、接続設定の「控えから戻す」で全部のアプリの設定を一括で戻せます。') >= 0 &&
    HINT.indexOf("connection-settings.html#restore") >= 0 && CS.indexOf('id="restore"') >= 0);
  t('3-16 案内の文に技術用語が無い', !TECH.test(gOff.text) && !TECH.test(gFld.text) && !TECH.test(tOff) && !TECH.test(tFld));
} else { t('3-6〜3-16 案内の関数を動かせる', false); }
t('3-17 空の画面に案内の箱がある（画面だけ noprint・最初は隠れている）',
  /<div id="emptyMsg">週間計画のデータが見つかりません。<\/div>\s*<div class="cfg-guide noprint" id="emptyCfg" role="status" hidden><\/div>/.test(src));
t('3-18 hidden の箱は必ず隠れる', /\.cfg-guide\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(src));
t('3-19 印刷では noprint を消す（既存の規則）', /@media print[\s\S]*\.noprint\s*\{\s*display:\s*none\s*!important;\s*\}/.test(src));
const fRenderAll = cut('renderAll') || '';
t('3-20 空の時、接続先が無ければ案内を出し、あれば隠す',
  /if \(!syncTarget\(\)\.endpoint\) \{ dcrNoCfgGuide_\(cfgBox\); cfgBox\.hidden = false; \}\s*else \{ cfgBox\.textContent = ''; cfgBox\.hidden = true; \}/.test(fRenderAll));

console.log('— 4. 階が分からない方の色の凡例（画面だけ） —');
const fLegend = cut('renderLegend'), legDecl = cutObj('LEGENDS');
t('4-1 凡例の関数と定義がある', !!fLegend && !!legDecl);
t('4-2 色見本は .nofloor と同じ地の色・縁はほかの見本と同じ（独自の縁の色を付けない）',
  /\.nofloor \{ background: #fff3e0; \}/.test(src) && /\.lg-sw\.lg-nofloor \{ background: #fff3e0; \}/.test(src) && /\.lg-sw \{[^}]*border: 1px solid var\(--bath-b\)/.test(src));
t('4-2c 入浴の日（td.nm.bath）と昼食薬（td.med-hl）は .nofloor より強い指定で塗る＝凡例の「その色が優先」と合う',
  /table\.sheet td\.nm\.bath \{ background: var\(--bath-bg\); \}/.test(src) && /table\.sheet td\.med-hl \{ background: #ffe0b2; \}/.test(src));
t('4-2b .nofloor は地の色だけ（枠線は付けない）＝凡例の「地」と合う', !/\.nofloor\s*\{[^}]*border/.test(src));
function runLegend(sc, nf) {
  const doc = fakeDoc();
  const box = doc.createElement('div');
  const ctx = {
    document: doc, $: () => box, dcrFill: s => s, stampPrintDate_() {},
    MODEL: Array.from({ length: 3 }, (_, i) => ({ floor: i < nf ? 0 : 2 })),
    floorSrcCount: { room: 0, plan: 0 }, dupCount: 0, hiddenNowCount: 0, preAdmittedNowCount: 0, preAdmittedHiddenCount: 0
  };
  vm.createContext(ctx);
  vm.runInContext(fEl + '\n' + legDecl + '\n' + fLegend + '\nrenderLegend(' + JSON.stringify(sc) + ');', ctx);
  const items = [];
  walk(box, n => { if (/\blg-nofloor\b/.test(n.className || '')) items.push(n); });
  const holders = box.children.filter(c => { let f = false; walk(c, n => { if (/\blg-nofloor\b/.test(n.className || '')) f = true; }); return f; });
  return { items, holders, text: box.textContent };
}
if (fLegend && legDecl && fEl) {
  for (const sc of ['sc-daylist', 'sc-allweek', 'sc-med']) {
    const r = runLegend(sc, 1);
    t('4-3 ' + sc + ': 階未設定の方がいる時は色の意味を出す',
      r.holders.length === 1 && r.text.indexOf('ごく淡い橙の地＝階が分からない方（入居者マスタで居室を確かめてください）。入浴の日・昼食薬の色が付いた日は、その色が優先されます') >= 0, r.text);
    t('4-4 ' + sc + ': 凡例は画面だけ（noprint）', r.holders.length === 1 && /\bnoprint\b/.test(r.holders[0].className), r.holders.map(h => h.className));
    t('4-5 ' + sc + ': 階未設定の方がいない時は出さない', runLegend(sc, 0).holders.length === 0);
  }
  t('4-6 週間名簿・利用表（色を付けないタブ）には出さない', runLegend('sc-weekly', 1).holders.length === 0 && runLegend('sc-roster', 1).holders.length === 0);
  t('4-7 既存の「⚠ 階未設定 N名（マスタ未登録）」はそのまま', runLegend('sc-daylist', 1).text.indexOf('⚠ 階未設定 1名（マスタ未登録）') >= 0);
} else { t('4-3〜4-7 凡例の関数を動かせる', false); }

console.log('— 5. 画面に出る文に技術用語が残っていない —');
const shown = [];
src.replace(/(?:textContent = |toast\(|setSyncState\(|el\('[a-z]+', (?:null|'[^']*'), )'([^']*)'/g, function (_, s) { shown.push(s); return _; });
const bad = shown.filter(function (s) { return TECH.test(s); });
t('5-1 textContent・toast・状態・el の文に技術用語が無い', shown.length > 0 && bad.length === 0, bad);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
