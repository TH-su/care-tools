/* moushiokuri_staff_words_test.js — 申送ビューア：職員に見える文から技術の言葉を減らす（2026-11-02 品質改善 便6）
 *
 * 確かめること
 *   1. 言い換えた文の古い形（GAS・デプロイ・/exec を職員に見せる形）が残っていない
 *   2. 言い換えた後の文があり、技術の言葉を含まない
 *   3. apiErrMsg を vm で動かす: 印（NO_CFG・GAS_LOGIN・GAS_BAD_RESPONSE・API:）ごとに新しい文を返し、技術の言葉を出さない
 *      （印の名前そのものは送り直しの試験 msk_api_retry_test が照合しているので変えていない）
 *   4. 接続が無い時の案内: 設定タブの「はじめて使う時」に接続設定（connection-settings.html）へのリンクがあり、
 *      未設定の時の断り（NO_CFG）がその案内を指している。現場の端末は画面全体の覆い（#block）で止まる
 *   5. 排便記録の接続が無い時の案内（excCfgNotice）に接続設定へのリンクがある（前からある・消されないように）
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html');
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
const TECH = /GAS|トークン|token|JSON|Supabase|HTTP|API|Apps Script|デプロイ|スクリプトプロパティ|Web App|ウェブアプリ|\/exec|undefined|null/;

console.log('\n【1】古い形が残っていない');
[
  '下の欄に GAS の URL と合言葉を入れて',
  '<label for="cfgUrl">GAS ウェブアプリ URL</label>',
  "'接続先が未設定です。「設定」タブで登録してください'",
  'GAS のアクセス権が「全員」になっていない可能性があります',
  'GAS から想定外の応答が返りました。デプロイURLを確認してください',
  "'サーバー側でエラーが発生しました'",
  'GAS を新しい版で再デプロイしてください',
  '（/exec で終わる必要があります）'
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));

console.log('\n【2】言い換えた後の文がある（技術の言葉を含まない）');
const NEW = [
  ['はじめて使う時の手順2', '控えが無い時は、下の欄に Google の受け口の URL と合言葉を入れて「保存」を押します。'],
  ['設定タブの URL 欄の見出し', '<label for="cfgUrl">接続先の URL（Google の受け口）</label>'],
  ['接続先が無い時', '接続先と合言葉が入っていません。「設定」タブの「はじめて使う時」の手順で入れてください'],
  ['ログインを求められた時', '申し送りの Google の受け口から、ログインを求める画面が返りました。受け口の公開の設定が「全員」になっているか、管理者に確かめてもらってください'],
  ['思っていた形と違う返事', '申し送りの Google の受け口から、思っていた形と違う返事が届きました。「設定」タブの URL が正しいか確かめてください'],
  ['受け口で問題が起きた時', '申し送りの Google の受け口で問題が起きました。しばらくしてからもう一度お試しください'],
  ['取込状況を返さない古い版', '申し送りの Google の受け口が古い版のため、取り込みの状況が分かりません。管理者に受け口の更新を頼んでください'],
  ['URL の形が違う時', 'URL の形が違います。管理者から受け取った Google の受け口の URL を、最後まで貼ってください']
];
NEW.forEach(([name, w]) => {
  t(name + ': 文がある', S.indexOf(w) >= 0, w);
  /* 見出しのタグ・例の URL の形は文の一部ではないので外して見る */
  const words = w.replace(/<[^>]+>/g, '').replace(/https:\/\/script\.google\.com\/macros\/s\//g, '');
  t(name + ': 技術の言葉が無い', !TECH.test(words), words);
});

console.log('\n【3】apiErrMsg を動かす');
const fnSrc = grabFn(S, 'apiErrMsg');
t('apiErrMsg がある', !!fnSrc);
const box = {};
vm.createContext(box);
vm.runInContext(fnSrc, box);
const call = m => box.apiErrMsg(new Error(m));
const cases = [
  ['NO_CFG', NEW[2][1]],
  ['GAS_LOGIN', NEW[3][1]],
  ['GAS_BAD_RESPONSE', NEW[4][1]],
  ['API:何かの断り', NEW[5][1]],
  ['API:認証エラー', '合言葉が違います。「設定」タブで確認してください']
];
cases.forEach(([m, want]) => {
  const got = call(m);
  t(m + ' → 職員向けの文', got === want, got);
  t(m + ' → 技術の言葉を出さない', !TECH.test(got), got);
});
/* 後ろに「「読み込み」をもう一度押してください」が付く所（rgStaleInto）へ埋め込むので、文の終わりに「。」を付けない */
cases.forEach(([m]) => { const got = call(m); t(m + ' → 文の終わりに「。」を付けない', !/。$/.test(got), got); });
t('印の名前は変えていない（送り直しの試験が照合している）',
  ["throw new Error('GAS_LOGIN')", "throw new Error('GAS_BAD_RESPONSE')", "new Error('API:' + o.error)", "new Error('NO_CFG')"].every(w => S.indexOf(w) >= 0));

console.log('\n【4】接続が無い時の案内');
const gm = /<div[^>]*id="cfgGuide"[^>]*>([\s\S]*?)<\/ol>\s*<\/div>/.exec(S);
const guide = gm ? gm[1] : '';
t('はじめて使う時の案内に接続設定へのリンクがある', /<a\s+href="connection-settings\.html">接続設定<\/a>/.test(guide));
t('案内の見出しの名前が、断りの文が指す名前と同じ（「はじめて使う時」）', S.indexOf('はじめて使う時（3ステップ）') >= 0 && NEW[2][1].indexOf('「はじめて使う時」') >= 0);
t('未設定で開いた時は設定タブへ移り、案内を出す', /if\(!cfg\.url \|\| !cfg\.token\)\{\s*goto\('scr-cfg', false\);/.test(S) && S.indexOf('mskGuide_();') >= 0);
t('現場の端末は画面全体を覆って止める（接続設定へは案内しない）',
  S.indexOf("var blocked = (lsGet(ROLE_KEY) === 'field');") >= 0 && S.indexOf('申送ビューアは事務所端末専用です。') >= 0);

console.log('\n【5】排便記録の接続が無い時の案内（前からある）');
const exc = grabFn(S, 'excCfgNotice');
t('excCfgNotice に接続設定へのリンクがある', exc.indexOf("a.href = 'connection-settings.html'") >= 0 && exc.indexOf("'接続設定を開く'") >= 0);

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格・' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
