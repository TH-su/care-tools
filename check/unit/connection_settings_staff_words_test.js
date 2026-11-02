/* connection_settings_staff_words_test.js — 接続設定：職員にも見える文から技術の言葉を減らす（2026-11-02 品質改善 第3期 便6）
 *
 * 確かめること
 *   1. 言い換えた文の古い形（トークン・GAS・HTML・Google Apps Script・facility-profile.json・丸囲み数字・e.message をそのまま出す形）が残っていない
 *   2. 言い換えた後の文がある（合言葉の欄名・取り違えの断り・確かめている時の文・初回の案内の段名と印の説明）
 *   3. bkErrText_ を vm で動かす: 日本語の断りはそのまま・英語の例外文や 'shape' は職員向けの一文に替えて記録（SUErrors.note）へ回す
 *   4. 控えの作成・戻すの失敗は、すべて bkErrText_ を通っている
 *   5. 管理者向けとして残す文（URL の形の説明・デプロイの公開範囲・3画面で同じ断りの文）が、そのまま残っている
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 * 対象の HTML は環境変数 CONN_HTML で差し替えられる（直す前の版・抜いた版で落ちることを確かめるため）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = process.env.CONN_HTML || path.join(ROOT, 'connection-settings.html');
const S = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(JSON.stringify(info)).slice(0, 400))); }
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

console.log('\n【1】古い形が残っていない');
[
  '<p><b>合言葉（トークン）を扱う画面です。</b>',
  "field('合言葉（トークン）'",
  'Google Apps Script の /exec で終わるURL',
  '（別のアプリのGASです）',
  '合言葉が一致しないか、別のアプリのGASです',
  'ページ（HTML）が返りました',
  'エラーページ（HTML）が返りました',
  '入居者マスタのGASか確かめています',
  '入居者マスタのGASかは確かめられませんでした',
  '入居者マスタのGASと確認',
  '施設の名前と事業所（facility-profile.json）',
  "title:'専用GAS（その他のアプリ）'",
  'そのアプリの GAS かは',
  "say('ng', String(e && e.message || e))"
].forEach((w) => t('無い: ' + w, S.indexOf(w) < 0));
/* 画面の文言に丸囲み数字を使わない（読みにくい・本人指示） */
// コードの注記（HTML の注記と JS の囲みの注記）は職員に見えないので外して数える
const VIS = S.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
t('画面の文に丸囲み数字が無い', !/[①-⑳]/.test(VIS), (VIS.match(/[①-⑳]/g) || []).join(''));

console.log('\n【2】言い換えた後の文がある');
[
  '<p><b>合言葉を扱う画面です。</b>',
  "cd.appendChild(field('合言葉', '（空欄なら今の設定のまま）', tokIn));",
  "'Google の受け口の URL（終わりが /exec のもの）を貼ってください（例: https://script.google.com/macros/s/…/exec）。'",
  "（別のアプリの接続先です）';",
  "return '合言葉が一致しないか、別のアプリの接続先です';",
  "msg:'ふつうのページが返りました。同期用のURLではない可能性があります。'",
  "msg:'ログイン画面かエラーのページが返りました。(1) URLが正しいか (2) デプロイの「アクセスできるユーザー」が「全員」か、の順にご確認ください。'",
  "msg:'つながりませんでした。(1) URLの打ち間違い (2) デプロイの「アクセスできるユーザー」が「全員」になっていない (3) ネットワーク、の順にご確認ください。'",
  "setRes(res,'inf','入居者マスタの接続先か確かめています…（最長30秒）');",
  "'保存しました（通信できず、入居者マスタの接続先かは確かめられませんでした。つながる状態で［接続を確認］を押してください）。'",
  "return commit(v, '入居者マスタの接続先と確認して保存しました。');",
  "setRes(res,'ok','つながりました（入居者マスタの接続先と確認しました）。');",
  "setRes(res,'ok',out.msg+'（入居者マスタの接続先かは確かめられませんでした）');",
  "note:'施設の名前と事業所（施設情報のファイル）。この画面の説明文にも使います'",
  "{ id:'own', title:'その他のアプリ（アプリごとの専用の接続先）',",
  '合言葉が正しいか・そのアプリの接続先かは、各アプリの保存や接続テストで確かめてください。',
  '✕ は「まだ入っていない・つながらなかった・思った応答が返らなかった・施設情報を読めなかった・別のアプリの接続先だった」、・ は「入っているが、まだ確かめていない」という印です。'
].forEach((w) => t('有る: ' + w.slice(0, 60), S.indexOf(w) >= 0));

console.log('\n【3】控えの失敗の文（bkErrText_ を動かす）');
{
  const fn = grabFn(S, 'bkErrText_');
  t('bkErrText_ がある', !!fn);
  if (fn) {
    const notes = [];
    const box = { String, window: { SUErrors: { note: (k, m, w) => notes.push([k, m && m.message, w]) } } };
    box.SUErrors = box.window.SUErrors;
    vm.createContext(box);
    vm.runInContext(fn + '\nthis.bkErrText_ = bkErrText_;', box);
    const F = 'かわりの文';
    const ja = '暗証番号が違うか、控えが壊れています。';
    t('日本語の断りはそのまま出す', box.bkErrText_(new Error(ja), F) === ja);
    t('日本語の断りは記録に流さない', notes.length === 0, notes);
    t("中身の形の崩れ（'shape'）は職員向けの一文に替える", box.bkErrText_(new Error('shape'), F) === F);
    t('英語の例外文は職員向けの一文に替える', box.bkErrText_(new Error('The operation failed for an operation-specific reason'), F) === F);
    t('空・文字列の失敗も職員向けの一文に替える', box.bkErrText_(null, F) === F && box.bkErrText_('x', F) === F);
    t('替えた時は元の文を記録へ残す（SUErrors.note）', notes.length === 4 && notes[0][1] === 'shape' && notes[0][2] === 'connection-settings:bk', notes);
    /* su-errors.js が読めない時も止まらない */
    const box2 = { String, window: {} }; vm.createContext(box2);
    vm.runInContext(fn + '\nthis.bkErrText_ = bkErrText_;', box2);
    let ok2 = false; try { ok2 = box2.bkErrText_(new Error('x'), F) === F; } catch (e) { ok2 = false; }
    t('記録の部品が無くても例外を出さない', ok2);
  }
}

console.log('\n【4】控えの作成・戻すの失敗は bkErrText_ を通す');
{
  const setup = grabFn(S, 'setupBackup');
  t('setupBackup がある', !!setup);
  t('作成の失敗', setup.indexOf("say('ng', bkErrText_(e, '控えを作れませんでした。ページを読み込み直して、もう一度お試しください。'))") >= 0);
  t('戻すの失敗', setup.indexOf("say('ng', bkErrText_(e, '控えから戻せませんでした。控えを全部コピーし直して、もう一度お試しください。'))") >= 0);
  t('e.message を画面へ直接出す所が無い', !/say\([^)]*e\.message/.test(setup) && !/setRes\([^)]*e\.message/.test(S));
}

console.log('\n【5】管理者向けとして残す文・他の画面とそろえている文');
[
  ['/dev の断り（URL の形の説明・管理者向け）', "'末尾が /dev のURLは本人しか使えません。デプロイの /exec で終わるURLを貼ってください。'"],
  ['入力欄の見本（URL の形・管理者向け）', "input('u_'+sys.id,'url','https://script.google.com/macros/…/exec')"],
  ['取り違えの断り（入居者マスタ・フェイスシートと3画面で一字一句同じ・非公開の試験が確かめる）', "var MASTER_WRONG_MSG='このURLは入居者マスタのGASではありません（薬学管理・申送など別のアプリのGASの可能性があります）';"],
  ['控えの形の断り（貼る文字の並びの頭）', "'控えの形ではありません（SUCFG1: で始まる文字の並びを、全部貼ってください）。'"],
  ['目的の1行（見出しの下）', '<p class="lead">新しい端末を使い始める時に、各アプリの接続先をここでまとめて設定できます。</p>']
].forEach(([n, w]) => t(n, S.indexOf(w) >= 0, w));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
if (fail) process.exit(1);
