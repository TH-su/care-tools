/* 週間計画（care-schedule.html）── onclick などを data-on-○○ と受け口の表に置き換えた（2026-10-15・CSP の導入）
   実行: node check/unit/cs_csp_actions_test.js

   守ること:
     1 画面に書いた data-on-click / data-on-change / data-on-input の名前は、全部が受け口の表（CS_ACTIONS）にある
     2 表の1行は、画面の中で定義された関数（または SIM の関数）を呼ぶ
     3 受け口（csRunAction_）: 引数は data-args（JSON の配列）、data-this="1" は要素を先頭に渡す。表に無い名前・壊れた引数は呼ばずに記録へ
     4 受け口は click・change・input を文書の1か所で受ける
   ★実際のブラウザで押して動くこと（利用者の管理・事業所情報の見出し・試算の開始と終了・警告を消す）は手元のヘッドレス Chrome で確かめた */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'care-schedule.html'), 'utf8');

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

const tableSrc = /const CS_ACTIONS = \{([\s\S]*?)\n\};/.exec(SRC);
const keys = tableSrc ? [...tableSrc[1].matchAll(/^\s*'([\w$.]+)': \(a\) => ([\w$.]+)\(\.\.\.a\),$/gm)].map(m => [m[1], m[2]]) : [];
const used = [...new Set([...SRC.matchAll(/data-on-(?:click|change|input)=\\?["']([\w$.]+)\\?["']/g)].map(m => m[1]))];

console.log('\n— 1. 画面の名前は全部が表にある —');
t('受け口の表がある（70行以上）', keys.length >= 70, keys.length);
const missing = used.filter(n => !keys.some(k => k[0] === n));
t('data-on-○○ の名前（' + used.length + '種）は全部が表にある', missing.length === 0, missing);
t('表の1行は、名前と同じ関数を呼ぶ（別の関数へすり替えない）', keys.every(k => k[0] === k[1]), keys.filter(k => k[0] !== k[1]));

console.log('\n— 2. 表の関数は画面の中で定義されている —');
const undefinedFns = keys.map(k => k[1]).filter(n => {
  if (n.startsWith('SIM.')) return !new RegExp('\\n   ' + n.slice(4).replace('$', '\\$') + '\\(').test(SRC) && !new RegExp('\\n  ' + n.slice(4) + '\\(').test(SRC);
  return !new RegExp('\\n(?:async )?function ' + n.replace('$', '\\$') + '\\(').test(SRC);
});
t('表の関数は全部定義がある', undefinedFns.length === 0, undefinedFns);

console.log('\n— 3. 受け口の動き —');
function grabFn(name) {
  const m = new RegExp('\\nfunction ' + name + '\\(').exec(SRC);
  let i = SRC.indexOf('{', m.index), d = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(m.index, i + 1); } }
}
const calls = [], notes = [];
const box = { JSON, Object, Array, Error, calls, notes, csNote_: (w, e) => notes.push(w + ':' + e.message) };
vm.createContext(box);
vm.runInContext("var CS_ACTIONS = { 'f': (a, e) => calls.push(a), 'g': (a) => calls.push(['g'].concat(a)) };\n" + grabFn('csRunAction_'), box);
const el = (attrs) => ({ getAttribute: k => (k in attrs ? attrs[k] : null) });
box.csRunAction_(el({ 'data-on-click': 'f' }), 'click', {});
box.csRunAction_(el({ 'data-on-click': 'f', 'data-args': '["oi-visit-body"]' }), 'click', {});
box.csRunAction_(el({ 'data-on-click': 'f', 'data-args': '[3,true]' }), 'click', {});
const self = el({ 'data-on-change': 'g', 'data-this': '1' });
box.csRunAction_(self, 'change', {});
t('引数なし・文字・数と真偽・要素を先頭に、で呼ぶ',
  JSON.stringify(calls.slice(0, 3)) === JSON.stringify([[], ['oi-visit-body'], [3, true]]) && calls[3][0] === 'g' && calls[3][1] === self, calls);
const n0 = calls.length;
box.csRunAction_(el({ 'data-on-click': 'evilFn' }), 'click', {});
box.csRunAction_(el({ 'data-on-click': 'toString' }), 'click', {});
box.csRunAction_(el({ 'data-on-click': 'f', 'data-args': '[oops' }), 'click', {});
t('表に無い名前・継いだ名前（toString）・壊れた引数は呼ばずに記録へ', calls.length === n0 && notes.length === 3, notes);

console.log('\n— 4. 文書の1か所で受ける —');
t('click・change・input を document で受け、近い data-on-○○ の要素に渡す',
  /\['click', 'change', 'input'\]\.forEach\(function \(type\) \{\n  document\.addEventListener\(type, function \(e\) \{\n    const t = e\.target && e\.target\.closest \? e\.target\.closest\('\[data-on-' \+ type \+ '\]'\) : null;\n    if \(t\) csRunAction_\(t, type, e\);/.test(SRC));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
