/* 入居者マスタ ── 医療支援経過で出さない行の判定（MEDLOG_HIDE_RE）を、公開中の画面から切り出して確かめる（2026-10-22 新設・改善プロンプト第3弾の13）
   実行: node check/unit/medlog_hide_test.js

   決まり（2026-10-20 代表者の決定）:
     ・「■処方歴■」「■処方■」「■残なし■」を含む行と、「処方:」「処方：」で始まる行は、画面と紙に出さない
     ・行の途中に「処方」の字があるだけの行（所見の文など）は出す
     ・行を除いて何も残らない記録は出さない。記録（保存の中身）は変えない
   ★文面はすべて架空。氏名・薬の実名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

const m = HTML.match(/\nvar MEDLOG_HIDE_RE=(\/.+\/[a-z]*);\n/);
t('画面に MEDLOG_HIDE_RE が1つある', !!m && HTML.split('var MEDLOG_HIDE_RE=').length === 2);
const RE = m ? new Function('return ' + m[1])() : /$^/;
const hide = ln => RE.test(ln);

/* 画面と同じ使い方（行ごとに除き、前後の空行を落とす） */
const shown = text => String(text).split('\n').filter(ln => !hide(ln)).join('\n').replace(/^\n+|\n+$/g, '');
t('画面の使い方が「行ごとに除く」形のまま', /split\('\\n'\)\.filter\(function\(ln\)\{ return !MEDLOG_HIDE_RE\.test\(ln\); \}\)/.test(HTML));

console.log('\n— 出さない行 —');
['■処方歴■ 架空薬A 1錠 朝', '■処方■ 架空薬B', '■残なし■', '処方: 架空薬C 1日2回', '処方：架空薬D', '　処方 ： 架空薬E', ' 処方:架空薬F']
  .forEach(ln => t('出さない: ' + ln, hide(ln)));

console.log('\n— 出す行（行の途中に「処方」の字があるだけ）—');
['処方どおり服薬できている', '前回処方の効果あり、眠気の訴えなし', '血圧 128/76、処方変更なしで経過観察', '本人より「処方の薬が飲みにくい」と話あり',
 '次回、処方について家族と相談予定', '所見: 咽頭発赤なし', '処方箋は薬局へ送付済み', '■所見■ 処方の見直しは不要']
  .forEach(ln => t('出す: ' + ln, !hide(ln)));

console.log('\n— 記録ひとつの見え方 —');
t('処方の行だけ消え、所見は残る',
  shown('■所見■ 体温 36.5\n処方の見直しは不要\n■処方歴■\n処方: 架空薬A 1錠 朝') === '■所見■ 体温 36.5\n処方の見直しは不要');
t('処方の行しか無い記録は空になる（画面ではその記録を出さない）', shown('■処方歴■\n処方：架空薬B\n■残なし■').trim() === '');
t('前後の空行は落ちる', shown('\n■処方歴■\n所見 変わりなし\n') === '所見 変わりなし');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
