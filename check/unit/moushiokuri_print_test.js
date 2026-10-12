/* 申送ビューア（moushiokuri-viewer.html）の印刷を共通部品（su-print.js）へ移した試験（2026-10-12・監査10月版 v2 申送ビューア 第1手）。
   守ること:
     1. 入居者別は A4 縦・バイタル・食事は A4 横。余白は従来の 10mm
     2. タブを切り替えると印刷の対象も切り替わる。日付別・検索・設定は対象なし（従来どおりの A4 縦の印刷）
     3. その画面を出していない時は準備しない（when）＝別のタブにいる時に前のタブの用紙が乗らない
     4. 印刷ボタンは共通部品を通す。共通部品を読めなかった時は従来どおり window.print
     5. 共通部品が読めない時の受け皿として、従来の @media print の @page（A4 縦・10mm）は残す
   画面の本物の関数（msPrintSetup_・msPrint_・goto）を切り出して、SUPrint と画面の部品だけを偽物にする。
   実行: node check/unit/moushiokuri_print_test.js（MSK_HTML で別の moushiokuri-viewer.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.MSK_HTML || path.join(__dirname, '..', '..', 'moushiokuri-viewer.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}
const SCREENS = ['scr-resident', 'scr-date', 'scr-vm', 'scr-cfg', 'scr-search'];
function makeBox(withSUPrint) {
  const els = {}; SCREENS.forEach(id => { const on = new Set(); els[id] = { classList: { toggle: (c, v) => { if (v) on.add(c); else on.delete(c); }, contains: c => on.has(c) } }; });
  const calls = { define: {}, active: [], print: [], winPrint: 0 };
  const SUPrint = { define: (n, s) => { calls.define[n] = s; }, setActive: n => { calls.active.push(n); }, print: n => { calls.print.push(n); } };
  const box = {
    console, Object, String, JSON,
    $: id => els[id] || null,
    document: { querySelectorAll: () => [] },
    lsSet: () => {}, SCREENS,
    window: withSUPrint ? { SUPrint, print: () => { calls.winPrint++; } } : { print: () => { calls.winPrint++; } }
  };
  if (withSUPrint) box.SUPrint = SUPrint;
  vm.createContext(box);
  const decl = (/var MS_PRINT_VIEW = \{[^}]*\};/.exec(src) || [''])[0];
  vm.runInContext(decl + '\nvar msPrintReady_ = false;\n' + [cut('msPrintSetup_'), cut('msPrint_'), cut('goto')].join('\n')
    + '\nfunction __print(){ window.print(); }', box);
  /* window.print の呼び出しを数えられるよう、画面の中の window を box.window にする */
  return { box, calls, els };
}

console.log('\n— 1. 用紙・余白・範囲 —');
{
  const x = makeBox(true);
  x.box.goto('scr-resident', false);
  const r = x.calls.define.resident, v = x.calls.define.vm;
  t('★入居者別は A4 縦・余白 10mm・範囲は入居者別の画面', r && r.paper === 'A4 portrait' && r.margin === 10 && r.root === '#scr-resident', r && { paper: r.paper, margin: r.margin, root: r.root });
  t('★バイタル・食事は A4 横・余白 10mm・範囲はバイタル・食事の画面', v && v.paper === 'A4 landscape' && v.margin === 10 && v.root === '#scr-vm', v && { paper: v.paper, margin: v.margin, root: v.root });
}

console.log('\n— 2. タブの切り替えと印刷の対象 —');
{
  const x = makeBox(true);
  const seen = SCREENS.map(id => { x.box.goto(id, false); return x.calls.active[x.calls.active.length - 1]; });
  t('★入居者別→resident・バイタル食事→vm', seen[0] === 'resident' && seen[2] === 'vm', seen);
  t('★日付別・設定・検索は対象なし（null＝従来どおりの印刷）', seen[1] === null && seen[3] === null && seen[4] === null, seen);
  t('ビューの登録は1回だけ（タブを何度切り替えても登録し直さない）', Object.keys(x.calls.define).length === 2);
}

console.log('\n— 3. 出していない画面では準備しない（when）—');
{
  const x = makeBox(true);
  x.box.goto('scr-date', false);
  const r = x.calls.define.resident, v = x.calls.define.vm;
  t('★日付別にいる時、入居者別もバイタル・食事も準備しない', r.when() === false && v.when() === false);
  x.box.goto('scr-vm', false);
  t('バイタル・食事にいる時はバイタル・食事だけ準備する', v.when() === true && r.when() === false);
}

console.log('\n— 4. 印刷ボタン —');
{
  const x = makeBox(true);
  x.box.goto('scr-vm', false);
  x.box.msPrint_('vm');
  t('★印刷ボタンは共通部品を通す（window.print を直接呼ばない）', x.calls.print[0] === 'vm' && x.calls.winPrint === 0, x.calls);
  const y = makeBox(false);
  y.box.goto('scr-resident', false);
  y.box.msPrint_('resident');
  t('★共通部品を読めなかった時は従来どおり window.print', y.calls.winPrint === 1);
  t('ボタンの結線: 入居者別は resident・バイタル食事は vm', /\$\('printBtn'\)\.addEventListener\('click', function\(\)\{ msPrint_\('resident'\); \}\);/.test(src)
    && /\$\('vmPrint'\)\.addEventListener\('click', function\(\)\{ msPrint_\('vm'\); \}\);/.test(src));
  t('画面に window.print の直接呼び出しは受け皿の1か所だけ', (src.match(/window\.print\(\)/g) || []).length === 1, (src.match(/window\.print\(\)/g) || []).length);
}

console.log('\n— 5. 部品の読み込みと受け皿 —');
t('su-print.js と su-print.css を読み込む', /<script src="su-print\.js\?v=[^"]+"><\/script>/.test(src) && /<link rel="stylesheet" href="su-print\.css\?v=[^"]+">/.test(src));
t('★従来の @page（A4 縦・10mm）は受け皿として残す', /@media print \{\s*@page \{ size:A4 portrait; margin:10mm; \}/.test(src));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
