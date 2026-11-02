/* admission_staff_words_test.js — 入居調整：職員に見える文から技術の言葉を減らす（2026-11-02 品質改善 第3期 便5）
 *
 * 確かめること
 *   1. 言い換えた文の古い形（JSON・GAS・入居調整データAPI・/exec・su-data.js・e.message をそのまま出す形）が残っていない
 *   2. 言い換えた後の文がある（控えのファイルの書き出し・取り込み・書類の受け口が古い時・接続先の取り違え・部品が読めない時）
 *   3. afErrWords_ を vm で動かす: 英語だけの例外文は出さずに記録へ回す・通信の失敗（HTTP 5xx・429 を含む）と合言葉違いは記録に流さない・
 *      かな・漢字を含む断りはそのまま（括弧の中のファイル名だけ外す）
 *   4. 例外の文（e.message）・サーバーの断り（r.error）を画面へ出す所は、すべて afErrWords_ を通っている
 *   5. 接続先が無い時の案内（前からある2か所）が、接続設定へのリンク・入れる欄の名前つきで残っている
 *   6. 管理者向けとして残す文（サーバーの防御の手順）が、そのまま残っている
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = process.env.ADMISSION_HTML || path.join(ROOT, 'admission-flow.html');
const S = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(JSON.stringify(info)).slice(0, 600))); }
}
function count(s, w) { let n = 0, i = 0; while ((i = s.indexOf(w, i)) >= 0) { n++; i += w.length; } return n; }
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
const TECH = /GAS|トークン|token|JSON|Supabase|HTTP|Apps Script|API|\/exec|su-data|データ層|undefined|null/;

console.log('\n【1】古い形が残っていない');
[
  '⬇️ 書き出し（JSON）',
  '⬆️ 取り込み（JSON）',
  '「⬇️ 書き出し（JSON）」',
  '（JSONではありません）',
  'サーバー（入居調整データAPI）が添付書類に未対応です',
  'GAS を新しい版に更新してください',
  '入居調整データAPI の /exec URL',
  'データ層を読み込めていません',
  "'データ層エラー'",
  "toast('読み込めませんでした: ' + (e && e.message || e))",
  "toast('確認できませんでした: ' + (e && e.message || e))",
  "'書類の一覧を取れませんでした（' + asStr(e && e.message)",
  "err('保存できませんでした（' + asStr(e && e.message)",
  "toast('取り出せませんでした（' + asStr(e && e.message)",
  "toast('削除できませんでした（' + asStr(e && e.message)",
  "toast(asStr(r && r.error) ||",
  "err(asStr(r && r.error) +"
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));

console.log('\n【2】言い換えた後の文がある');
const NEW = [
  ['書き出しのボタン', '<button class="btn sm" id="syExport" type="button">⬇️ 控えのファイルに書き出す</button>'],
  ['取り込みのボタン', '<button class="btn sm" id="syImport" type="button">⬆️ 控えのファイルから取り込む</button>'],
  ['台帳が大きすぎる時の案内（ボタンの名前と合わせる）', '右上のバッジ →「⬇️ 控えのファイルに書き出す」でファイルに残したうえで、'],
  ['取り込んだファイルが読めない時', "toast('読み込めませんでした（控えのファイルの形ではありません）')"],
  ['書類の受け口が古い時（職員がすること＝管理者に連絡）', "'入居調整の Google の受け口が古い版のため、書類を使えません。管理者に連絡してください（Google の受け口の更新が必要です）。'"],
  ['接続先の取り違え', "'入居調整用に作った Google の受け口の URL が入っているか確認してください。"],
  ['部品が読めない時（起動）', "toast('共通の部品を読み込めませんでした。同期はできませんが、この端末内では使えます')"],
  ['部品が読めない時（版の確認）', "toast('共通の部品を読み込めませんでした。画面を読み込み直してください')"],
  ['部品が読めない時（書類）', "new Error('共通の部品を読み込めませんでした')"],
  ['同期の札', "setSync('部品の読み込みエラー', 'err')"]
];
NEW.forEach(([n, w]) => {
  t(n + ': 新しい文がある', S.indexOf(w) >= 0, w);
  t(n + ': 技術の言葉が無い', !TECH.test(w.replace(/id="sy(Export|Import)" type="button"|class="btn sm"|setSync|toast|new Error/g, '')), w);
});
t('同期の札は2か所とも言い換えた', count(S, "setSync('部品の読み込みエラー', 'err')") === 2);

console.log('\n【3】afErrWords_ を動かす');
{
  const src = grabFn(S, 'afErrWords_') + '\n' + grabFn(S, 'asStr');
  t('afErrWords_ がある', /function afErrWords_\(/.test(src));
  const notes = [];
  const sb = { afNote_: (w, e) => notes.push({ w, e }) };
  vm.createContext(sb);
  let ok = true;
  try { vm.runInContext(src, sb); } catch (e) { ok = false; }
  t('vm で読める', ok && typeof sb.afErrWords_ === 'function');
  if (ok && typeof sb.afErrWords_ === 'function') {
    const W = sb.afErrWords_;
    notes.length = 0;
    const a = W(new Error('TypeError: Cannot read properties of undefined'), '書類の一覧');
    t('英語の例外文は出さない', a === '通信がうまくいきませんでした', a);
    t('英語の例外文は記録に回す（場所つき）', notes.length === 1 && notes[0].w === '書類の一覧', notes.map(n => n.w));
    notes.length = 0;
    const b = W(new TypeError('Failed to fetch'), '読み込み');
    t('通信の失敗も職員向けの文にする', b === '通信がうまくいきませんでした', b);
    t('通信の失敗は記録に流さない', notes.length === 0, notes.length);
    notes.length = 0;
    ['Load failed', 'The operation was aborted', 'timeout', 'NetworkError when attempting to fetch resource.'].forEach(m => W(new Error(m), 'x'));
    t('Load failed・中断・時間切れも記録に流さない', notes.length === 0, notes.length);
    notes.length = 0;
    const c = W(new Error('同期してから書類を上げてください'), 'x');
    t('日本語の断りはそのまま出す', c === '同期してから書類を上げてください', c);
    t('日本語の断りは記録に流さない', notes.length === 0, notes.length);
    const d = W(new Error('Google にログインしていません'), 'x');
    t('Google・Drive・URL・ID だけのラテン文字は日本語の断りとして出す', d === 'Google にログインしていません', d);
    notes.length = 0;
    const e = W('badkey', 'x');
    t('サーバーの英語の断り（文字だけ）も出さない', e === '通信がうまくいきませんでした' && notes.length === 1, e);
    notes.length = 0;
    const f5 = ['HTTP 500', 'HTTP 502', 'HTTP 503', 'HTTP 429'].map(m => W(new Error(m), 'x'));
    t('Google の一時的な HTTP 5xx・429 は職員向けの文にする', f5.every(v => v === '通信がうまくいきませんでした'), f5);
    t('HTTP 5xx・429 は通信の失敗として記録に流さない', notes.length === 0, notes.length);
    notes.length = 0;
    const f4 = W(new Error('HTTP 404'), 'x');
    t('HTTP 404（接続先の誤り）は職員向けの文にして記録には残す', f4 === '通信がうまくいきませんでした' && notes.length === 1, [f4, notes.length]);
    notes.length = 0;
    const u = W(new Error('unauthorized'), 'x');
    t('合言葉違い（unauthorized）は合言葉を確かめる文にする', u === '合言葉が通りませんでした。接続設定の「入居調整」の合言葉を確かめてください', u);
    t('合言葉違いは設定の誤りなので記録に流さない', notes.length === 0, notes.length);
    W('unauthorized', 'x');
    t('合言葉違い（文字だけ）も記録に流さない', notes.length === 0, notes.length);
    notes.length = 0;
    const dl = W(new Error('データ層を読み込めていません（su-data-gas.js）。ページを再読み込みしてください。直らない場合は管理者へ連絡してください。'), 'x');
    t('日本語の断りの中の括弧のファイル名だけを外して出す', dl === 'データ層を読み込めていません。ページを再読み込みしてください。直らない場合は管理者へ連絡してください。', dl);
    const big = W(new Error('ファイルが大きすぎます（1つ 10MB まで・PDF・JPEG・PNG）'), 'x');
    t('英字の単位・PDF などを含む日本語の断りはそのまま出す', big === 'ファイルが大きすぎます（1つ 10MB まで・PDF・JPEG・PNG）', big);
    const mix = W(new Error('HTTP 500 応答エラー'), 'x');
    t('かな・漢字を含む文はそのまま出す（英語だけの時だけ替える）', mix === 'HTTP 500 応答エラー', mix);
    t('日本語の断りは記録に流さない（ファイル名つきも）', notes.length === 0, notes.length);
    const k = W(new Error('サーバ未設定: ADMISSION_TOKEN がありません'), 'x');
    t('受け口の合言葉の設定漏れは管理者に連絡する文にする（日本語を含んでも言い換える）', k === '入居調整の Google の受け口の設定が済んでいません。管理者に連絡してください', k);
    t('その2つの文に技術の言葉が無い', !TECH.test(u) && !TECH.test(k));
    const dv = W(new Error('このファイルはアプリ経由では大きすぎます。「開く」から Drive でご覧ください'), 'x');
    t('Drive を含む日本語の断りはそのまま出す', dv === 'このファイルはアプリ経由では大きすぎます。「開く」から Drive でご覧ください', dv);
    const id = W(new Error('案件IDが不正です'), 'x');
    t('ID を含む日本語の断りはそのまま出す', id === '案件IDが不正です', id);
    const g = W(null, 'x'); const h = W(undefined, 'x'); const i = W(new Error(''), 'x');
    t('空・null・undefined でも職員向けの文になる', [g, h, i].every(v => v === '通信がうまくいきませんでした'), [g, h, i]);
    t('返す文に技術の言葉が無い', !TECH.test(a) && !TECH.test(b));
  }
}

console.log('\n【4】例外の文・サーバーの断りを出す所は全部 afErrWords_ を通る');
{
  const lines = S.split('\n');
  const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) =>
    /(toast|err|alert|confirm)\(/.test(l) && /e\.message|e2\.message|r\.error\b|j\.error\b/.test(l) &&
    !/afErrWords_\(/.test(l) && !/j\.error === '/.test(l));
  t('toast・err・alert・confirm に e.message・r.error をそのまま入れていない', bad.length === 0, bad.map(([n]) => n));
  const why = lines.filter(l => l.indexOf("why: '書類の一覧を取れませんでした（") >= 0);
  t('書類の一覧の断り（why）も afErrWords_ を通る', why.length === 2 && why.every(l => /afErrWords_\(/.test(l)), why);
  t('afErrWords_ を使う所は12か所（定義を除く）', count(S, 'afErrWords_(') === 13, count(S, 'afErrWords_('));   /* 定義1＋呼び出し12 */
}

console.log('\n【5】接続先が無い時の案内（前からある）が残っている');
t('書類: 接続設定ページの「入居調整」に入れる案内', S.indexOf("why: '接続先が未設定です。接続設定ページで「入居調整」の接続先を入れてください。'") >= 0);
t('マスタ登録: 接続設定へのリンクと「入居者マスタ」の欄', S.indexOf('入居者マスタの接続先が未設定です。<a href="connection-settings.html">接続設定</a>で「入居者マスタ」のURL・合言葉を設定してください。') >= 0);
t('同期設定の窓: 接続設定へのリンク', S.indexOf('接続先の設定は <a href="connection-settings.html">接続設定</a> で行います') >= 0);
{
  const cs = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');
  t('接続設定に「入居調整」の欄がある（案内の欄の名前が実物と合う）', /title:'入居調整'/.test(cs));
}

console.log('\n【6】管理者向けとして残す文');
t('サーバーの防御が無い時の手順（管理者向け・同期設定の窓の中）', S.indexOf('サーバー側の消失ガード（admwipe）が有効になっていません。') >= 0);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
