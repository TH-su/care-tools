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

console.log('\n— 処方の変更の印（2026-10-25 本人指示・複数の医療機関に対応）—');
const vm = require('vm');
function cutFn(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) return null;
  let d = 0, i = src.indexOf('{', h), q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(h, i + 1); }
  }
  return null;
}
const cx = { String, Array, Object };
vm.createContext(cx);
vm.runInContext('var MEDLOG_HIDE_RE=' + (m ? m[1] : '/$^/') + ';\n' + cutFn(HTML, 'medlogClinicKey_') + '\n' + cutFn(HTML, 'medlogRxChanged_'), cx);
const ch = list => cx.medlogRxChanged_(list).changed;
const R = (date, rx, extra, clinic) => ({ date, clinic: clinic === undefined ? '架空クリニックA' : clinic, text: '■所見■ 変わりなし\n' + (rx || []).map(x => '■処方歴■ ' + x).join('\n') + (extra ? '\n' + extra : '') });
const RX1 = ['架空薬A 1錠 朝', '架空薬B 2錠 朝夕'], RX2 = ['架空薬A 1錠 朝', '架空薬B 1錠 朝夕'];

t('★処方の行の中身が変わった時だけ印が立つ（前回と比べて）', JSON.stringify(ch([R('2026-09-01', RX1), R('2026-09-15', RX2)])) === '[false,true]');
t('★同じ処方の時は立たない', JSON.stringify(ch([R('2026-09-01', RX1), R('2026-09-15', RX1)])) === '[false,false]');
t('いちばん古い処方には立たない（比べる相手が無い）', ch([R('2026-09-01', RX1)])[0] === false);
t('空白の違い（全角・連続）と行の並びの違いは同じとみなす', JSON.stringify(ch([R('2026-09-01', RX1), R('2026-09-15', ['架空薬B　2錠  朝夕', '架空薬A 1錠 朝'])])) === '[false,false]');
t('処方の行が無い記録には立たず、その次は処方の行がある直前の記録と比べる',
  JSON.stringify(ch([R('2026-09-01', RX1), R('2026-09-08', []), R('2026-09-15', RX1), R('2026-09-22', RX2)])) === '[false,false,false,true]');
t('保存の並びが新しい順でも、日付で比べる', JSON.stringify(ch([R('2026-09-15', RX2), R('2026-09-01', RX1)])) === '[true,false]');
t('「処方:」で始まる行も比べる', JSON.stringify(ch([{ date: '2026-09-01', clinic: 'X', text: '処方: 架空薬C 1錠' }, { date: '2026-09-15', clinic: 'X', text: '処方: 架空薬C 2錠' }])) === '[false,true]');
t('所見だけが変わっても立たない', JSON.stringify(ch([R('2026-09-01', RX1, '血圧 120'), R('2026-09-15', RX1, '血圧 140')])) === '[false,false]');
/* 複数の医療機関 */
const A = '架空クリニックA', B = '架空病院B';
const multi = [R('2026-09-01', RX1, '', A), R('2026-09-03', ['架空薬Z 1錠 眠前'], '', B), R('2026-09-15', RX1, '', A), R('2026-09-17', ['架空薬Z 1錠 眠前'], '', B)];
t('★医療機関が交互に並んでも、同じ医療機関の前回と同じなら立たない（入れ替わりだけでは立てない）', JSON.stringify(ch(multi)) === '[false,true,false,false]', ch(multi));
t('★2つ目の医療機関の最初の処方には立つ（処方元が増えた）', ch(multi)[1] === true);
const multi2 = multi.concat([R('2026-09-29', ['架空薬Z 2錠 眠前'], '', B), R('2026-10-01', RX1, '', A)]);
t('★変わった医療機関の記録だけに立つ（B が変わり A は同じ）', JSON.stringify(ch(multi2)) === '[false,true,false,false,true,false]', ch(multi2));
t('医療機関名の全角半角・空白の違いは同じ医療機関とみなす', JSON.stringify(ch([R('2026-09-01', RX1, '', 'ABC クリニック'), R('2026-09-15', RX1, '', 'ＡＢＣクリニック')])) === '[false,false]');
t('医療機関が空欄の記録は空欄どうしで比べる', JSON.stringify(ch([R('2026-09-01', RX1, '', ''), R('2026-09-15', RX2, '', '')])) === '[false,true]');
t('処方の行がある記録の医療機関の数を返す（空欄は数えない）', cx.medlogRxChanged_(multi).clinics === 2 && cx.medlogRxChanged_([R('2026-09-01', RX1, '', '')]).clinics === 0);
/* 10/25 反証レビューの指摘への守り */
const sameDay = [R('2026-09-15', RX1, '', A), R('2026-09-15', RX1.concat(['架空薬Q 1錠 頓用']), '', A), R('2026-09-01', RX1, '', A)];
/* 画面と同じく新しい順に並べた後の並び（同じ日付は保存の並びのまま）。保存の並びで先の方が新しい */
const sameDayNewFirst = [sameDay[1], sameDay[0], sameDay[2]];
t('★同じ日付の記録は、保存の並びで先の方を新しいとみなす（変わっていない方に印を立てない）', JSON.stringify(ch(sameDayNewFirst)) === '[true,false,false]', ch(sameDayNewFirst));
t('★「■残なし■」の増減だけでは立たない（残薬の知らせで処方の中身ではない）', JSON.stringify(ch([R('2026-09-01', RX1, '■残なし■', A), R('2026-09-15', RX1, '', A)])) === '[false,false]');
t('★行の頭の書き方の違い（処方: と ■処方歴■）だけでは立たない',
  JSON.stringify(ch([{ date: '2026-09-01', clinic: A, text: '処方: 架空薬A 1錠 朝' }, { date: '2026-09-15', clinic: A, text: '■処方歴■ 架空薬A 1錠 朝' }])) === '[false,false]');
t('★空欄（手入力）の後に医療機関名つきが初めて来ても、薬が同じなら立たない',
  JSON.stringify(ch([R('2026-09-01', ['架空薬A 1錠 朝'], '', ''), R('2026-10-20', ['架空薬A 1錠 朝'], '', A)])) === '[false,false]');
t('空欄（手入力）の後に医療機関名つきが来て、薬が違えば立つ',
  JSON.stringify(ch([R('2026-09-01', ['架空薬A 1錠 朝'], '', ''), R('2026-10-20', ['架空薬A 2錠 朝'], '', A)])) === '[false,true]');
const alias = [R('2026-09-01', RX1, '', '架空クリニックA'), R('2026-09-15', RX1, '', '医療法人架空会 架空クリニックA')];
t('★医療機関名の書き方の違い（片方がもう片方を含む）は同じ医療機関とみなす', JSON.stringify(ch(alias)) === '[false,false]' && cx.medlogRxChanged_(alias).clinics === 1, cx.medlogRxChanged_(alias));
t('短すぎる名前（4文字未満）は含むだけでは同じにしない', cx.medlogRxChanged_([R('2026-09-01', RX1, '', '架空A'), R('2026-09-15', RX1, '', '架空A病院')]).clinics === 2);
t('空・配列でない時も止まらない', ch([]).length === 0 && ch(null).length === 0);

/* 画面への配線 */
const RV = cutFn(HTML, 'renderView') || '';
t('★文言は指定どおり「処方の変更あり（薬剤情報を確認）」', /var MEDLOG_RX_NOTE='処方の変更あり（薬剤情報を確認）';/.test(HTML));
t('★処方の行を消す前に比べる（medlogRxChanged_ を消す処理より前で呼ぶ）', RV.indexOf('medlogRxChanged_(mlog)') > 0 && RV.indexOf('medlogRxChanged_(mlog)') < RV.indexOf('!MEDLOG_HIDE_RE.test(ln)'));
t('★印は記録の先頭（本文の前）に1行', /if\(s\.rxChanged\) body='<div class="ml-l ml-rx">'\+esc\(MEDLOG_RX_NOTE\)\+\(s\.rxClinic\?'〔'\+esc\(s\.rxClinic\)\+'〕':''\)\+'<\/div>'\+body;/.test(RV));
t('★医療機関名を添えるのは医療機関が2つ以上の方だけ', /rxMulti=rxRes\.clinics>=2/.test(RV) && /o\.rxClinic=rxMulti\?/.test(RV));
t('★処方の行しか無くても、変わった記録は印だけで出す', /String\(s\.text\|\|''\)\.trim\(\)!=='' \|\| s\.rxChanged/.test(RV));
/* @media print の中身を、括弧の対応で全部取り出して見る（最初の } で止まらない・指摘5） */
const printBlocks = (() => { const out = []; let p = 0; while ((p = HTML.indexOf('@media print', p)) >= 0) { let i = HTML.indexOf('{', p), d = 0, j = i; for (; j < HTML.length; j++) { if (HTML[j] === '{') d++; else if (HTML[j] === '}') { d--; if (d === 0) break; } } out.push(HTML.slice(i, j + 1)); p = j; } return out; })();
t('★印は紙にも出す（どの @media print の中でも ml-rx を消さない）', printBlocks.length > 3 && printBlocks.every(b => !/ml-rx/.test(b)), printBlocks.length);
t('★印の付け方は、並べ替えた後の同じ番号（rxCh[i]）を使う', /var rxRes=medlogRxChanged_\(mlog\)/.test(RV) && /mlog=mlog\.map\(function\(s,i\)\{/.test(RV) && /o\.rxChanged=!!rxCh\[i\];/.test(RV));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
