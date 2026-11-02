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
t('一覧の帯から出す', /if \(!CFG\.url\) noCfgGuide\(host, 'list'\);/.test(grabFn(S, 'renderBanners')));
t('設定の画面から出す（描き直しのたびに消してから）', /clear\(\$\('cfgMissing'\)\);\n  if \(!CFG\.url\) noCfgGuide\(\$\('cfgMissing'\), 'settings'\);/.test(grabFn(S, 'renderSettings')));
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

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
