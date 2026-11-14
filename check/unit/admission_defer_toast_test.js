/* 入居調整（admission-flow.html）の起動の待ちを減らす試験（商用化の点検 2026-11-08）。
   守ること:
     1. 日付の和暦⇔西暦の計算部品（staff-master-calc.js）は defer で読む（起動を待たせない）
     2. その部品を使う4つの関数（normDateStr・warekiOf・ageText・birthSub）は、起動（init）と
        ログインの確かめの後の始まり（afStart_）・全体の描き直し（renderAll の一覧の部分）から直接呼ばない
        ＝部品がまだ読めていない間に呼ばれる道を作らない
     3. 部品がまだ無い時も例外を出さず、西暦の形だけ通す（今までの逃げ道のまま）
     4. 知らせるだけの言葉は画面の知らせ（#toast・role=status）で出す。alert は止めて見せる必要のある4件だけ
        （台帳が大きく減った・保存できない・お名前が無く登録できない・バックアップから復旧した）で、増やさない
   実行: node check/unit/admission_defer_toast_test.js（ADMISSION_HTML で別の admission-flow.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.ADMISSION_HTML || path.join(__dirname, '..', '..', 'admission-flow.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name, head) {
  const h = src.indexOf(head || ('function ' + name + '('));
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}
const WRAP = ['normDateStr', 'warekiOf', 'ageText', 'birthSub'];
const callsWrap = (body) => WRAP.filter((n) => new RegExp('\\b' + n + '\\(').test(body));

console.log('\n— 1. 計算部品は defer で読む —');
{
  const tags = src.match(/<script[^>]*src="staff-master-calc\.js[^"]*"[^>]*>/g) || [];
  t('計算部品の読み込みは1か所', tags.length === 1, tags);
  t('defer が付いている', tags.length === 1 && /\sdefer(\s|>)/.test(tags[0]), tags);
  t('async ではない（読む順を崩さない）', tags.length === 1 && !/\sasync(\s|>)/.test(tags[0]), tags);
}

console.log('\n— 2. 部品がまだ無い間に呼ぶ道が無い —');
{
  const init = cut('init', '(function init()');
  t('起動（init）は4つの関数を呼ばない', callsWrap(init).length === 0, callsWrap(init));
  const start = cut('afStart_');
  t('ログインの確かめの後の始まり（afStart_）は4つの関数を呼ばない', callsWrap(start).length === 0, callsWrap(start));
  for (const n of ['renderList', 'renderToday', 'renderKpi', 'loadCache', 'normalizeDb']) {
    let body = '';
    try { body = cut(n); } catch (e) { body = ''; }
    t(n + ' は4つの関数を呼ばない', body !== '' && callsWrap(body).length === 0, callsWrap(body));
  }
  const all = cut('renderAll');
  t('renderAll が詳細を描くのは詳細の画面が開いている時だけ', /if \(\$\('sc-view'\)\.classList\.contains\('on'\)\)/.test(all));
}

console.log('\n— 3. 部品が無い時の逃げ道 —');
{
  const sb = { window: {}, String, asStr: (v) => (v == null ? '' : String(v)), esc: (s) => String(s) };
  vm.createContext(sb);
  vm.runInContext('var DATE_ISO_RE = /^\\d{4}-\\d{2}-\\d{2}$/; var DATE_AHEAD_YEARS = 10;', sb);
  for (const n of WRAP) vm.runInContext(cut(n), sb);
  t('西暦はそのまま通す', vm.runInContext("normDateStr('2026-09-16')", sb) === '2026-09-16');
  t('和暦は空（例外を出さない）', vm.runInContext("normDateStr('S15.4.3')", sb) === '');
  t('和暦の表示は空', vm.runInContext("warekiOf('1940-04-03')", sb) === '');
  t('年齢は空', vm.runInContext("ageText('1940-04-03')", sb) === '');
  t('添え書きは空', vm.runInContext("birthSub('1940-04-03')", sb) === '');
  sb.window.StaffCalc = require(path.join(__dirname, '..', '..', 'staff-master-calc.js'));
  t('部品が届いた後は和暦を読む', vm.runInContext("normDateStr('S15.4.3')", sb) === '1940-04-03');
}

console.log('\n— 4. 知らせるだけの言葉は画面の知らせで出す —');
{
  t('画面の知らせの枠は role=status', /<div id="toast" role="status"><\/div>/.test(src));
  const sb = { el: { textContent: '', classList: { on: false, add() { this.on = true; }, remove() { this.on = false; } } }, setTimeout: () => 1, clearTimeout: () => {} };
  sb.$ = () => sb.el;
  vm.createContext(sb);
  vm.runInContext(cut('toast'), sb);
  vm.runInContext("toast('この案件は見つかりません')", sb);
  t('toast は文言をそのまま #toast に出す', sb.el.textContent === 'この案件は見つかりません' && sb.el.classList.on === true);
  const KEEP = [
    "alert('⚠️ サーバー側の台帳が大きく減っています。",
    "alert(j.error === 'toolarge'",
    "alert('お名前が入っていないため、入居者マスタへは登録できません。",
    "alert('⚠️ この端末の保存データが読めなかったため、バックアップ（"
  ];
  /* 2026-11-13 第6段 AF-02: 止めて見せる4件は画面の中の窓（SUDialog.alert）で出す。su-dialog.js が読めない時の受け口だけがブラウザの窓（window.alert）を1回呼ぶ。
     数は前より厳しく見る（画面の中の窓が4件ちょうど・受け口が1件ちょうど・そのほかの alert( は0件） */
  const found = (src.match(/\balert\(/g) || []).length;
  const viaDlg = (src.match(/SUDialog\.alert\(/g) || []).length;
  const viaNative = (src.match(/window\.alert\(/g) || []).length;
  t('alert は止めて見せる4件だけ（画面の中の窓で4件・読めない時の受け口で1件・ほかは0件）', viaDlg === KEEP.length && viaNative === 1 && found === KEEP.length + 1, [found, viaDlg, viaNative]);
  for (const k of KEEP) t('残す alert: ' + k.slice(7, 30), src.indexOf(k) >= 0);
  for (const m of ['この案件は見つかりません', 'そのバックアップは見つかりませんでした', 'バックアップから復元しました', '元に戻せる操作はありません', '最新を読み込みました']) {
    t('知らせは toast: ' + m, src.indexOf("toast('" + m + "')") >= 0 && src.indexOf("alert('" + m) < 0);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
