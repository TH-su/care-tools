/* training_plan_staff_words_test.js — 個別機能訓練計画書：職員に見える文から技術の言葉を減らし、接続先が無い時の案内を出す
 * （2026-11-02 品質改善 第3期 便6）
 *
 * 確かめること
 *   1. 言い換えた文の古い形（専用GAS・APIキー・JSON・GAS側・データ層・ファイル名・e.message をそのまま出す形）が残っていない
 *   2. 言い換えた後の文がある（技術の言葉が無い）
 *   3. tpErrWords_ を vm で動かす: 英語の符号はサーバーの返事・画面側のエラー（TypeError 等）は画面の文で、どちらも記録へ回す・
 *      通信の失敗（HTTP 5xx・429 を含む）と設定の誤り（HTTP 4xx・応答が読めない）は記録に流さない・
 *      かな・漢字を含む断りはそのまま（括弧の中のファイル名だけ外す）・errText と staffErrText の最後がここを通る
 *   4. 接続先が無い時の案内（noCfgGuide）を vm で動かす: 何が足りないか・次にすること・接続設定へのリンク・現場端末ではリンクを出さない
 *   5. 一覧の帯と設定の画面の両方から案内を出す
 *   6. 管理者向けとして残す文（URL の形・AI のキーの設定名）がそのまま残っている・通信の符号は変えていない
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = process.env.TRAINING_PLAN_HTML || path.join(ROOT, 'training-plan.html');
const S = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(JSON.stringify(info)).slice(0, 600))); }
}
function grabFn(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) return '';
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const TECH = /GAS|トークン|token|JSON|Supabase|HTTP|API|\/exec|su-data|データ層|training-plan-form|undefined|null/;

console.log('\n【1】古い形が残っていない');
[
  '<h2>接続（個別機能訓練計画書の専用GAS）</h2>',
  '（計画書の専用GASに保存します）',
  'AIのキー（APIキー）は',
  '<strong>サーバー（計画書の専用GAS）</strong>',
  '計画書の専用GASが代わりに送ります',
  "'JSONの形が違います（オブジェクトではありません）'",
  '名簿の氏名と subject.nameNorm が一致しません',
  "'データ層（su-data.js）を読み込めていません'",
  'データ層（su-data.js）を読み込めていません。ページを再読み込み',
  '印刷様式（training-plan-form.js）を読み込めていません',
  '印刷様式（training-plan-form.js）を読み込めていないため',
  '下の「設定」で接続先を入れてください（管理者の作業です）',
  'GAS側に直前10世代の控えは残ります',
  'AIのキーはサーバー（計画書の専用GAS）に置く方式です',
  "'接続できませんでした（' + s_(r && r.error)",
  "'接続できませんでした（' + s_(e && e.message)",
  'サーバーにキーがありません（管理者がスクリプトプロパティ',
  "'AIから正しい応答がありませんでした（HTTP '",
  "'JSONとして読めませんでした（形を確かめてください）'",
  "reason: 'JSONとして読めませんでした'",
  "'読めません（除外）：JSONの形が違います'",
  "'⚠ 別のGAS（'",
  "setSync('データ層エラー'",
  "return m || '不明なエラー';",
  "return m || '原因不明';"
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));

console.log('\n【2】言い換えた後の文がある');
const NEW = [
  ['設定の見出し', '<h2>接続（個別機能訓練計画書の専用の Google の受け口）</h2>'],
  ['職員の一覧の保存先', '<p class="muted">全端末で共通です（計画書の専用の Google の受け口に保存します）。</p>'],
  ['AI のキーの置き場（説明）', 'AIのキーは<strong>サーバー（計画書の専用の Google の受け口）</strong>にだけ置き、端末には置きません。'],
  ['AI の依頼の送り手', 'AIへの依頼は、計画書の専用の Google の受け口が代わりに送ります'],
  ['取り込みの形が違う時', "'控えのファイルの形ではありません（計画書の控えのファイルを選んでください）'"],
  ['取り込みの氏名の不一致', "'名簿の氏名とファイルの氏名が一致しません（取り違えを防ぐため取り込みません）'"],
  ['部品が読めない時（断り）', "'共通の部品を読み込めていません（画面を読み込み直してください）'"],
  ['印刷様式が読めない時（様式比較）', "'印刷様式の部品を読み込めていないため、様式比較は出せません。"],
  ['印刷様式が読めない時（プレビュー）', "'印刷様式の部品を読み込めていません。ページを再読み込みしてください。'"],
  ['部品が読めない時（帯）', "'共通の部品を読み込めていません。ページを再読み込みしてください。直らない場合は管理者へ連絡してください。'"],
  ['印刷様式が読めない時', "'印刷様式の部品を読み込めていません。印刷とプレビューはできません。'"],
  ['担当者をまとめて直す時の確認', 'この操作は元に戻せません（Google の受け口に直前10世代の控えは残ります）。'],
  ['AI のキーの置き場（状態）', "'AIのキーはサーバー（計画書の専用の Google の受け口）に置く方式です。"],
  ['AI の状態の断り（応答）', "'接続できませんでした（' + errText(s_(r && r.error)) + '）'"],
  ['AI の状態の断り（例外）', "'接続できませんでした（' + errText(e) + '）'"],
  ['AI のキーが無い時（短い案内が先）', "'サーバーにAIのキーがありません。管理者に伝えてください（管理者向け："],
  ['AI の状態の番号', "'AIから正しい応答がありませんでした（状態 ' + m.slice(8)"],
  ['ファイルが読めない時（1件）', "'控えのファイルとして読めませんでした（計画書の控えのファイルか確かめてください）'"],
  ['ファイルが読めない時（まとめて）', "reason: '控えのファイルとして読めませんでした'"],
  ['まとめて取り込みの除外', "'読めません（除外）：控えのファイルの形ではありません'"],
  ['接続先の取り違え', "'⚠ 別の Google の受け口（' + name + '）に繋がっています。計画書【専用】のURLを入れてください'"],
  ['同期の札', "setSync('部品の読み込みエラー', 'err')"]
];
NEW.forEach(([n, w]) => {
  t(n + ': 新しい文がある', S.indexOf(w) >= 0, w);
  t(n + ': 技術の言葉が無い', !TECH.test(w.replace(/setSync|errText\([^)]*\)|s_\([^)]*\)|ANTHROPIC_API_KEY/g, '')), w);
});

console.log('\n【3】断りの文の言い換え（tpErrWords_・errText・staffErrText を vm で動かす）');
const notes = [];
const sb = {
  window: {}, SUErrors: null, notes: notes, out: null,
  s_: (v) => String(v == null ? '' : v)
};
sb.window.SUErrors = { note: (k, m, w) => notes.push([k, m, w]) };
sb.SUErrors = sb.window.SUErrors;
vm.createContext(sb);
const SRC = grabFn(S, 'tpErrWords_') + '\n' + grabFn(S, 'errText') + '\n' + grabFn(S, 'staffErrText');
t('3つの関数を切り出せた', /function tpErrWords_/.test(SRC) && /function errText/.test(SRC) && /function staffErrText/.test(SRC));
try { vm.runInContext(SRC, sb); } catch (e) { t('vm で読み込めた', false, e.message); }
function run(fn, msg) { notes.length = 0; sb.arg = msg; return vm.runInContext(fn + '(arg)', sb); }
const E = (m) => ({ message: m });
if (typeof sb.errText === 'function') {
  let r = run('errText', E('ai_unknown_code'));
  t('英語の符号は出さない（サーバーの返事）', r === 'サーバーから思わぬ返事がありました', r);
  t('英語の符号は記録に残す', notes.length === 1 && notes[0][1] === 'ai_unknown_code', notes);
  const SCREEN = '画面の中で思わぬエラーが起きました（画面を読み込み直してください）';
  ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].forEach((nm) => {
    const er = new Error(nm === 'SyntaxError' ? 'Invalid regular expression: missing /' : "Cannot read properties of undefined (reading 'x')");
    er.name = nm;
    const x = run('errText', er);
    t('画面側のエラー（' + nm + '）はサーバーのせいにしない', x === SCREEN, x);
    t('画面側のエラー（' + nm + '）は記録に残す', notes.length === 1, notes);
  });
  const CFGW = '接続先の設定を確かめてください（管理者に伝えてください）';
  [["SyntaxError", "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"], ['SyntaxError', 'JSON Parse error: Unrecognized token \'<\''],
   ['Error', 'Unexpected token < in JSON at position 0'], ['', 'HTTP 404'], ['', 'HTTP 403']].forEach(([nm, msg]) => {
    const er = nm ? Object.assign(new Error(msg), { name: nm }) : E(msg);
    const x = run('errText', er);
    t('設定の誤り「' + msg + '」は設定を確かめる文', x === CFGW, x);
    t('設定の誤り「' + msg + '」は記録に流さない', notes.length === 0, notes);
  });
  ['Failed to fetch', 'Load failed', 'NetworkError when attempting', 'The operation was aborted', 'HTTP 503', 'HTTP 429'].forEach((m) => {
    const x = run('errText', E(m));
    t('通信の失敗「' + m + '」は職員向けの文', x === '通信がうまくいきませんでした', x);
    t('通信の失敗「' + m + '」は記録に流さない', notes.length === 0, notes);
  });
  r = run('errText', E('名簿を取得できませんでした（su-roster.js）'));
  t('かな・漢字の断りはそのまま（ファイル名だけ外す）', r === '名簿を取得できませんでした', r);
  t('かな・漢字の断りは記録に流さない', notes.length === 0, notes);
  r = run('errText', E('この端末はログインしていません'));
  t('もともと日本語の断りは一字も変えない', r === 'この端末はログインしていません', r);
  r = run('errText', E('badtoken'));
  t('合言葉違い（badtoken）は言葉にする・記録しない', /合言葉/.test(r) && notes.length === 0, [r, notes]);
  r = run('errText', '');
  t('空の時', r === '原因が分かりませんでした', r);
  t('前からある符号は今までどおり（同期先が未設定です）', run('errText', E('同期先が未設定です')) === '計画書の接続先が未設定です（設定画面で入れてください）');
  t('前からある符号は今までどおり（unauthorized）', run('errText', E('unauthorized')) === '合言葉が違います（設定画面で確かめてください）');
  t('NO_DATA_LAYER は職員向けの文', run('errText', E('NO_DATA_LAYER')) === '共通の部品を読み込めていません（画面を読み込み直してください）');
  r = run('staffErrText', Object.assign(new Error('x is not a function'), { name: 'TypeError' }));
  t('職員の一覧の断りも英語を出さない', r === SCREEN && notes.length === 1, [r, notes]);
  r = run('staffErrText', E('weird_code'));
  t('職員の一覧の英語の符号もサーバーの返事の文', r === 'サーバーから思わぬ返事がありました' && notes.length === 1, [r, notes]);
  t('職員の一覧の断りの前からある言葉は今までどおり', /サーバーが受け付けませんでした/.test(run('staffErrText', E('countdrop'))));
}
t('errText の最後は tpErrWords_ を通る', /return tpErrWords_\(e, m\);\n\}\n\/\* 上で言葉にしていない/.test(S));
t('staffErrText の最後は tpErrWords_ を通る', /'接続先が未設定です（設定の接続先を入れてください）';\n  return tpErrWords_\(e, m\);/.test(grabFn(S, 'staffErrText')));
t('画面の状態の欄に例外の文をそのまま出す所が残っていない', !/textContent = [^\n;]*'（' \+ s_\((e|r) && (e|r)\.(message|error)\)/.test(S));

console.log('\n【4】接続先が無い時の案内（noCfgGuide を vm で動かす）');
function fakeDoc() {
  function node(tag) {
    return { tag: tag, children: [], attrs: {}, className: '', textContent: '',
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); } };
  }
  return { createElement: node };
}
function allText(n) { return (n.textContent || '') + n.children.map(allText).join(''); }
function findTag(n, tag) { if (n.tag === tag) return n; for (const c of n.children) { const f = findTag(c, tag); if (f) return f; } return null; }
const GSRC = grabFn(S, 'el') + '\n' + grabFn(S, 'noCfgGuide');
t('noCfgGuide を切り出せた', /function noCfgGuide/.test(GSRC) && /function el\(/.test(GSRC));
t('innerHTML を使わない', /function noCfgGuide/.test(GSRC) && GSRC.indexOf('innerHTML') < 0);
function guide(role, where) {
  const g = { document: fakeDoc(), isFieldDevice: () => role === 'field' };
  vm.createContext(g);
  vm.runInContext(GSRC, g);
  const host = g.document.createElement('div');
  g.noCfgGuide(host, where);
  return host;
}
if (/function noCfgGuide/.test(GSRC)) {
  const h = guide('office', 'list');
  const txt = allText(h);
  const a = findTag(h, 'a');
  t('何が足りないかを言う', txt.indexOf('計画書の接続先（専用の Google の受け口の URL と合言葉）が、この端末にまだ入っていません。') >= 0, txt);
  t('次にすること（一覧では画面下の「設定」→「接続」と接続設定の欄の名前）',
    txt.indexOf('画面下の「設定」→「接続」か、接続設定の画面の「個別機能訓練計画書」の欄に URL と合言葉を入れて、保存してください（管理者の作業です）。') >= 0, txt);
  t('接続設定へのリンク', !!a && a.attrs.href === 'connection-settings.html' && a.textContent === '接続設定の画面を開く', a);
  t('案内に技術の言葉が無い', !TECH.test(txt), txt);
  const s2 = allText(guide('office', 'settings'));
  t('設定の画面では「この下の欄」', s2.indexOf('この下の欄か、接続設定の画面の「個別機能訓練計画書」の欄に') >= 0, s2);
  const f = guide('field', 'list');
  t('現場端末ではリンクを出さない', !findTag(f, 'a'), f);
  t('現場端末では事務所に知らせる', allText(f).indexOf('事務所に知らせてください') >= 0, allText(f));
}
const CS = (() => { try { return fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8'); } catch (e) { return ''; } })();
t('接続設定の欄の名前が実物と同じ（個別機能訓練計画書・tp_cfg）', /title:'個別機能訓練計画書'[\s\S]{0,200}key:'tp_cfg'/.test(CS));

console.log('\n【5】一覧の帯と設定の画面から案内を出す');
t('一覧の帯から出す', /if \(tpNoCfg_\(\)\) noCfgGuide\(host, 'list'\);/.test(grabFn(S, 'renderBanners')));
t('設定の画面から出す（描き直しのたびに消してから）', /clear\(\$\('cfgMissing'\)\);\n  if \(tpNoCfg_\(\)\) noCfgGuide\(\$\('cfgMissing'\), 'settings'\);/.test(grabFn(S, 'renderSettings')));
/* 出すのは計画書の接続先が無く、ログインだけでも使えないと確かめ終わった時だけ（2026-11-08） */
t('案内を出すのは接続先が無く・使えず・確かめ終わった時だけ', /function tpNoCfg_\(\) \{ return !CFG\.url && !TP_LIVE && !tpProbing_; \}/.test(S));
t('設定の画面に置き場がある', S.indexOf('<div id="cfgMissing"></div>') >= 0);

console.log('\n【6】管理者向けとして残す文・通信の符号');
[
  '<label for="cfgUrl">ウェブアプリのURL（/exec で終わるもの）</label>',
  "'URLの形が違います（https://script.google.com/… で /exec で終わるもの）'",
  '（管理者向け：サーバーのスクリプトプロパティ ANTHROPIC_API_KEY が空です）',
  '（管理者向け：上限はサーバーの AI_DAILY_LIMIT で変えられます）',
  "'入居者マスタの接続先が、入居者マスタ以外のGAS",
  "localStorage.setItem('tp_cfg', JSON.stringify({ url: url, token: token }))",
  "if (m === 'NO_DATA_LAYER')",
  "if (m === '同期先が未設定です')"
].forEach(w => t('残す: ' + w, S.indexOf(w) >= 0, w));

let sec7 = null;   // 【7】の動きの試験（窓の答えは約束なので待つ）
console.log('\n【7】止めて知らせる窓（confirm）は画面の中の窓（su-dialog.js）で出す（2026-11-13 第6段 TP-02）');
{
  const MAIN = S.slice(S.indexOf('<script>\n/* ═══'));
  t('7-1 ブラウザの確かめの窓（confirm(…)）を直接呼ばない（読めない時の受け口の window.confirm だけ）',
    (S.match(/(?<![\w.])confirm\(/g) || []).length === 0 && (S.match(/window\.confirm\(/g) || []).length === 1, (S.match(/.{30}(?<![\w.])confirm\(.{20}/g) || []).slice(0, 3));
  t('7-2 画面の中の窓で聞く所は23か所', (S.match(/SUDialog\.confirm\(/g) || []).length === 23, (S.match(/SUDialog\.confirm\(/g) || []).length);
  const iDlg = S.indexOf('<script src="su-dialog.js?v=2026-11-14"></script>');
  t('7-3 su-dialog.js を画面のスクリプトより前で読む（版は他画面と同じ）', iDlg > 0 && iDlg < S.indexOf('<script>\n/* ═══'), iDlg);
  t('7-4 読めない時はブラウザの窓に落とす受け口がある', /if \(!window\.SUDialog\) window\.SUDialog = \{\n  alert:[^\n]*\n  confirm: function \(m\) \{ var r = false; try \{ r = !!window\.confirm\(m\); \} catch \(_\) \{\} return Promise\.resolve\(r\); \},/.test(MAIN));
  const sn = grabFn(S, 'saveNow');
  t('7-5 窓が出ている間は、タイマーから来る保存（saveNow(false)）を窓が全部閉じた後へ1回だけ回す',
    /if \(!explicit && tpDlgBusy_\(\)\) \{\n    clearTimeout\(saveTimer\);\n    if \(!tpDlgWait_\) \{ tpDlgWait_ = true; SUDialog\.idle\(\)\.then\(function \(\) \{ tpDlgWait_ = false; saveNow\(false\); \}\); \}\n    return;\n  \}/.test(sn), sn.slice(0, 400));

  /* 実物の clearStop を動かす: OK で取り消し・キャンセルで何もしない・窓の間に別の方へ移ったら何もしない */
  const src = [grabFn(S, 'tpHold_'), grabFn(S, 'tpSame_'), grabFn(S, 'clearStop')].join('\n');
  function env(answer, swap) {
    const log = [];
    const sb = { TP: { normalizeStop: (x) => x || null }, dirty: false, noTouchOnce: false, stopFormDirty: true,
      markDirty: () => log.push('dirty'), renderStopCard: () => {}, renderTimeline: () => {}, toast: (m) => log.push(m) };
    sb.SUDialog = { confirm: () => new Promise((res) => setTimeout(() => {
      if (swap) vm.runInContext('DOC = { stop: { reason: "x" } }; curMasterId = "B2";', sb);
      res(answer);
    }, 0)) };
    vm.createContext(sb);
    vm.runInContext('var DOC = { stop: { reason: "discharge" } }, curMasterId = "A1";\n' + src, sb);
    return { sb, log };
  }
  const flush = () => new Promise((r) => setTimeout(r, 5));
  sec7 = (async () => {
    let e = env(true, false); e.sb.clearStop(); await flush();
    t('7-6 OK で通知を止める指定を取り消す（答えを待ってから）', vm.runInContext('DOC.stop', e.sb) === null && e.log.indexOf('dirty') >= 0, e.log);
    e = env(false, false); e.sb.clearStop(); await flush();
    t('7-7 キャンセルなら何も変えない', !!vm.runInContext('DOC.stop', e.sb) && e.log.length === 0, e.log);
    e = env(true, true); e.sb.clearStop(); await flush();
    t('7-8 窓の間に別の方の計画書へ替わったら、OK でも何もしない（別の方の指定を消さない）', vm.runInContext('DOC.stop && DOC.stop.reason', e.sb) === 'x' && e.log.length === 0, e.log);
  })();
  const ap = grabFn(S, 'addPlanAt');
  t('7-9 期を足す関数は、同じ作成日がある時だけ窓の答えの約束を返し、無い時は今までどおりその場で作る',
    /return SUDialog\.confirm\('同じ作成日（' \+ d \+ '）の計画が既にあります。もう1つ作りますか？'\)\.then\(function \(ok\) \{\n        return \(ok && tpSame_\(h0\)\) \? go\(\) : null;/.test(ap) && /\n  return go\(\);\n  function go\(\) \{/.test(ap), ap.slice(0, 300));
  t('7-10 期を足す関数を呼ぶ3か所（ボタン・一括・次の期）は約束でもその場でも受ける',
    /tpThen_\(addPlanAt\(d\), function \(p\) \{ if \(p\) \{ addAtTouched = false; refreshAddAtDate\(\); \} \}\);/.test(S)
    && /return tpThen_\(addPlanAt\(date, \{ silent: true \}\), function \(p\) \{ return stepWith\(i, date, p\); \}\);/.test(S)
    && /if \(ok && tpSame_\(h0\)\) addPlanAt\(d\);/.test(S));
  t('7-11 番号で掴む取り消し・完全に削除は、答えの後に期そのものが同じかを1段ごとに確かめる',
    /function same\(\) \{ return tpSame_\(h0\) && DOC\.plans\[idx\] === p; \}/.test(grabFn(S, 'deletePlan'))
    && /function same\(\) \{ return tpSame_\(h0\) && DOC\.trash && DOC\.trash\[idx\] === item; \}/.test(grabFn(S, 'permanentlyDeleteTrash'))
    && (grabFn(S, 'permanentlyDeleteTrash').match(/same\(\)\)/g) || []).length === 2);
}

console.log('\n【8】AI のキーが無い時の（管理者向け：…）は管理者のログインの時だけ出す（2026-11-13 第6段 TP-03）');
{
  const sb = { s_: (v) => String(v == null ? '' : v), TP_IS_ADMIN: false };
  vm.createContext(sb);
  vm.runInContext(grabFn(S, 'aiErrText'), sb);
  const e = new Error('AI_NO_KEY');
  t('8-1 職員: 括弧を出さない', sb.aiErrText(e) === 'いまはAIを使えません。管理者に伝えてください', sb.aiErrText(e));
  sb.TP_IS_ADMIN = true;
  t('8-2 管理者: 今までの文のまま', sb.aiErrText(e) === 'いまはAIを使えません。管理者に伝えてください（管理者向け：サーバーのスクリプトプロパティ ANTHROPIC_API_KEY が空です）', sb.aiErrText(e));
  t('8-3 設定の画面の AI の状態も、括弧は管理者の時だけ', /: \(TP_IS_ADMIN \? 'サーバーにAIのキーがありません。管理者に伝えてください（管理者向け：スクリプトプロパティ ANTHROPIC_API_KEY に入れる）'\n        : 'サーバーにAIのキーがありません。管理者に伝えてください'\);/.test(S));
  const ca = grabFn(S, 'tpCheckAdmin_');
  t('8-4 管理者の見分けは SUAuth.check の ok・admin だけ・確かめられない時は管理者ではない', /TP_IS_ADMIN = !!\(st && st\.status === 'ok' && st\.role === 'admin'\);/.test(ca) && /function \(\) \{ TP_IS_ADMIN = false; \}/.test(ca) && /var TP_IS_ADMIN = false;/.test(S), ca);
  t('8-5 起動の時に確かめる', /function startApp_\(\) \{\n  tpCheckAdmin_\(\);/.test(S));
  /* 8-6: 2回目の反証レビューで、文を決める時ではなく表示の時に TP_IS_ADMIN を見る形にした（管理者と分かるのが名簿の失敗より後でも直し方の文になる） */
  {
    const mb = { TP_IS_ADMIN: false, MASTER_MSG: '' };
    vm.createContext(mb);
    vm.runInContext((S.match(/var MASTER_WRONG_MSG = '[^']*';/) || [''])[0] + '\n' + grabFn(S, 'masterMsg_'), mb);
    vm.runInContext('MASTER_MSG = MASTER_WRONG_MSG;', mb);
    t('8-6 入居者マスタの接続先の取り違え: 職員には直し方を出さない（名簿の失敗では職員向けの文を控える）', mb.masterMsg_() === '入居者マスタの接続先が違うため、引継ぎはできません。管理者に伝えてください。'
      && /=== '不明なaction'\)\n\s*\? MASTER_WRONG_MSG\n/.test(S), mb.masterMsg_());
    mb.TP_IS_ADMIN = true;   // 名簿の失敗の後で管理者と分かった
    t('8-7 管理者と分かった後の表示は今の直し方の文（文を決めた時がその前でも）', /^入居者マスタの接続先が、入居者マスタ以外のGAS（薬学管理・申送など）になっています。/.test(mb.masterMsg_()), mb.masterMsg_());
    vm.runInContext("MASTER_MSG = '入居者マスタの接続先が未設定です。';", mb);
    t('8-8 ほかの知らせは管理者でもそのまま', mb.masterMsg_() === '入居者マスタの接続先が未設定です。');
    t('8-9 表示の3か所（一覧の帯・編集の帯・引継ぎの知らせ）は masterMsg_ を通す', !/banner\(host, 'warn', MASTER_MSG\)|\(MASTER_MSG \|\| '入居者マスタを参照できません'\)/.test(S)
      && S.replace(/function masterMsg_\(\)/, '').match(/masterMsg_\(\)/g).length === 3
      && /if \(MASTER_MSG\) banner\(host, 'warn', masterMsg_\(\)\);/.test(grabFn(S, 'renderBanners'))
      && /if \(!MASTER_OK\) banner\(host, 'warn', '引継ぎ不可：' \+ \(masterMsg_\(\) \|\| '入居者マスタを参照できません'\)/.test(grabFn(S, 'renderEdit'))
      && /if \(!MASTER_OK\) \{ toast\('引継ぎ不可：' \+ \(masterMsg_\(\) \|\| '入居者マスタを参照できません'\)\); return; \}/.test(grabFn(S, 'pullMaster')));
    t('8-10 管理者と分かった時に取り違えの帯が出ていれば一覧の帯を描き直す', /if \(TP_IS_ADMIN && MASTER_MSG === MASTER_WRONG_MSG\) \{ try \{ renderBanners\(\); \}/.test(grabFn(S, 'tpCheckAdmin_')));
  }
}

console.log('\n【9】AI のキー・上限・サーバーの版の（管理者向け：…）も管理者のログインの時だけ出す（2026-11-13 第6段 TP-03 の残り）');
{
  const sb = { s_: (v) => String(v == null ? '' : v), TP_IS_ADMIN: false, AI_SRV: { key: false }, CFG: { url: 'u', token: 't' } };
  vm.createContext(sb);
  vm.runInContext(grabFn(S, 'aiErrText') + '\n' + grabFn(S, 'aiUnreadyWhy'), sb);
  const lim = new Error('AI_LIMIT');
  t('9-1 職員: AI を使えない理由に括弧（サーバーのキー・中継の版）を出さない', sb.aiUnreadyWhy() === 'いまはAIを使えません。管理者に伝えてください。', sb.aiUnreadyWhy());
  t('9-2 職員: 回数の上限の文に設定の名前（AI_DAILY_LIMIT）を出さない', sb.aiErrText(lim) === '今日のAIの利用回数の上限に達しました。明日もう一度お試しください', sb.aiErrText(lim));
  sb.TP_IS_ADMIN = true;
  t('9-3 管理者: AI を使えない理由は今までの文のまま', sb.aiUnreadyWhy() === 'いまはAIを使えません。管理者に伝えてください（管理者向け：サーバーにAIのキーが無いか、中継の無い古い版です。設定の「AIの接続を確かめる」で詳しく分かります）。', sb.aiUnreadyWhy());
  t('9-4 管理者: 回数の上限の文は今までの文のまま', sb.aiErrText(lim) === '今日のAIの利用回数の上限に達しました。明日もう一度お試しください（管理者向け：上限はサーバーの AI_DAILY_LIMIT で変えられます）', sb.aiErrText(lim));
  /* PR #566 の反証: 中継の版・合言葉・キーの断り（401/403）も括弧は管理者の時だけ */
  const H401 = new Error('AI_HTTP_401'); H401.detail = 'invalid x-api-key';
  const H403 = new Error('AI_HTTP_403');
  const ADM = {
    AI_PROXY_OLD: 'いまはAIを使えません。管理者に伝えてください（管理者向け：サーバーが古い版で、AIの中継が入っていません）',
    AI_PROXY_AUTH: 'サーバーの合言葉が通りませんでした。管理者に伝えてください（管理者向け：設定画面の「接続」を確かめる）'
  };
  t('9-10 管理者: 中継の版・合言葉の断りは今までの文のまま', sb.aiErrText(new Error('AI_PROXY_OLD')) === ADM.AI_PROXY_OLD && sb.aiErrText(new Error('AI_PROXY_AUTH')) === ADM.AI_PROXY_AUTH);
  t('9-11 管理者: キーの断り（401）は今までの文のまま（番号と AI の返答つき）', sb.aiErrText(H401) === 'いまはAIを使えません。管理者に伝えてください（管理者向け：サーバーのAIのキーが受け付けられませんでした・401）　AIの返答: invalid x-api-key', sb.aiErrText(H401));
  sb.TP_IS_ADMIN = false;
  t('9-12 職員: 中継の版の断りに括弧を出さない', sb.aiErrText(new Error('AI_PROXY_OLD')) === 'いまはAIを使えません。管理者に伝えてください', sb.aiErrText(new Error('AI_PROXY_OLD')));
  t('9-13 職員: 合言葉の断りに括弧を出さない', sb.aiErrText(new Error('AI_PROXY_AUTH')) === 'サーバーの合言葉が通りませんでした。管理者に伝えてください', sb.aiErrText(new Error('AI_PROXY_AUTH')));
  t('9-14 職員: キーの断り（401・403）に括弧と AI の返答（英語）を出さない', sb.aiErrText(H401) === 'いまはAIを使えません。管理者に伝えてください' && sb.aiErrText(H403) === 'いまはAIを使えません。管理者に伝えてください', sb.aiErrText(H401));
  sb.TP_IS_ADMIN = true;
  sb.AI_SRV = null; sb.TP_IS_ADMIN = false; sb.CFG = { url: '', token: '' };
  t('9-5 キーの無いことが分かっていない時の文は変えない', sb.aiUnreadyWhy() === '計画書の接続先が未設定のため、AIを使えません。', sb.aiUnreadyWhy());
  /* サーバーの版が古い時の3か所（期の取り消し・一括で作る2つ）。括弧の中は TP_IS_ADMIN の時だけ足す */
  const OLD = "'（管理者向け：版 2026-09-04.1 以降が必要）'";
  t('9-6 版の括弧は3か所とも「TP_IS_ADMIN の時だけ」の形で残る', (S.split("(TP_IS_ADMIN ? " + OLD + " : '')").length - 1) === 3 && (S.split('（管理者向け：版 2026-09-04.1 以降が必要）').length - 1) === 3);
  t('9-7 期の取り消しの断り（deletePlan）は職員向けの文＋管理者の時だけ括弧',
    grabFn(S, 'deletePlan').indexOf("toast('サーバーが古い版のため、期の取り消しはできません。管理者に更新を頼んでください' + (TP_IS_ADMIN ? " + OLD + " : ''));") >= 0);
  t('9-8 全員の一括（runBatchAiAllResidents）も同じ形',
    grabFn(S, 'runBatchAiAllResidents').indexOf("toast('サーバーが古い版のため、一括では作れません。管理者に更新を頼んでください' + (TP_IS_ADMIN ? " + OLD + " : ''));") >= 0);
  const tb = { TP_IS_ADMIN: false, out: [] };
  vm.createContext(tb);
  tb.toast = (m) => tb.out.push(m);
  vm.runInContext("function f(){ toast('サーバーが古い版のため、一括では作れません。管理者に更新を頼んでください' + (TP_IS_ADMIN ? " + OLD + " : '')); }", tb);
  tb.f(); tb.TP_IS_ADMIN = true; tb.f();
  t('9-9 職員には括弧の前の文だけ・管理者には今までの文', tb.out[0] === 'サーバーが古い版のため、一括では作れません。管理者に更新を頼んでください'
    && tb.out[1] === 'サーバーが古い版のため、一括では作れません。管理者に更新を頼んでください（管理者向け：版 2026-09-04.1 以降が必要）', tb.out);
}

Promise.resolve(sec7).catch((e) => t('【7】の動きの試験が最後まで動く', false, String(e && e.stack))).then(() => {
  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
});
