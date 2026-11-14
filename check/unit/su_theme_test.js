/* 見た目の共通の型（su-theme.css・つむぐケアの型）の試験（代表者の決定 2026-11-02 案E・推奨どおり）
   実行: node check/unit/su_theme_test.js
   守ること:
     1 型の決まりは全部 @media screen の中（印刷の紙を変えない）
     2 読み込むだけでは効かない（<html data-su-theme> の画面だけ）
     3 文字の色は白地・生成り・淡い藍・各帯の地で 7:1 以上
     4 iPad 縦と iPhone（899px 以下）だけ、押す所 44px 以上・入力の文字 16px
     5 当てた画面は data-su-theme と su-theme.css の読み込みをそろえて持ち、版はどの画面も1種類
     6 担当者会議のページには当てない（自分の濃い色を持つ決まり）
   画面のコードは書き換えず、ソースを読むだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'su-theme.css'), 'utf8');
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
/* 一番外の塊を「頭 { 中身 }」で取り出す */
function blocks(s) {
  const out = []; let d = 0, start = 0, head = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '{') { if (!d) { head = s.slice(start, k).trim(); start = k + 1; } d++; }
    else if (s[k] === '}') { d--; if (!d) { out.push({ head, body: s.slice(start, k) }); start = k + 1; } }
  }
  return { out, rest: s.slice(start).trim() };
}
const top = blocks(css);

console.log('1 印刷を変えない');
t('1a 一番外は @media screen の塊だけ', top.out.length > 0 && top.out.every((b) => /^@media screen\b/.test(b.head)) && top.rest === '', top.out.map((b) => b.head));
t('1b print の指定を持たない', !/print/.test(css), '');

console.log('2 当てた画面だけに効く');
const sels = [];
for (const b of top.out) for (const r of blocks(b.body).out) sels.push(...r.head.split(',').map((x) => x.trim()));
t('2a どの決まりも :root[data-su-theme] から始まる', sels.length > 0 && sels.every((x) => x.startsWith(':root[data-su-theme]')), sels.filter((x) => !x.startsWith(':root[data-su-theme]')));

console.log('3 文字の濃さ（7:1 以上）');
function lum(h) { const c = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const v = (n) => ((new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})')).exec(css) || [])[1];
const pairs = [
  ['su-ink', '#FFFFFF'], ['su-ink', v('su-paper')], ['su-ink', v('su-ink-l')],
  ['su-ink2', '#FFFFFF'], ['su-ink2', v('su-paper')], ['su-ink2', v('su-ink-l')],
  ['g5', '#FFFFFF'], ['g5', v('g0')], ['g7', v('g0')], ['g9', v('g0')],
  ['ok', '#FFFFFF'], ['ok', v('ok-l')], ['ng', '#FFFFFF'], ['ng', v('ng-l')],
  ['warn-tx', v('warn-bg')], ['warn-tx', '#FFFFFF'],
];
for (const [fg, bg] of pairs) {
  const r = v(fg) && bg ? ratio(v(fg), bg) : 0;
  t('3 ' + fg + ' の字は ' + bg + ' の地で 7:1 以上（' + r.toFixed(2) + '）', r >= 7, { fg: v(fg), bg });
}
t('3 主なボタン（藍の地）の白い字は 7:1 以上', ratio('#FFFFFF', v('pri')) >= 7, v('pri'));
for (const k of ['role\\.field', 'sync\\.ok', 'sync\\.err']) {
  const m = new RegExp('\\.hdr \\.' + k + ' \\{ background: (#[0-9A-Fa-f]{6}); color: #fff; \\}').exec(css);
  const r = m ? ratio('#FFFFFF', m[1]) : 0;
  t('3 見出しの札 ' + k.replace('\\', '') + ' の白い字は 7:1 以上（' + r.toFixed(2) + '）', r >= 7, m && m[1]);
}
t('3 補助の字の濃さに段差が残る（g5 より g7 が濃い）', lum(v('g7')) < lum(v('g5')), [v('g5'), v('g7')]);

console.log('4 iPad 縦と iPhone の押しやすさ');
const narrow = top.out.find((b) => /^@media screen and \(max-width: 899px\)$/.test(b.head));
t('4a 899px 以下の塊がある', !!narrow, top.out.map((b) => b.head));
t('4b 押す所は 44px 以上', !!narrow && /min-height:\s*44px/.test(narrow.body), '');
t('4e 画面の指摘の番号の札は伸ばさない', !!narrow && /\.sua-badge \{ min-height: 0; \}/.test(narrow.body), '');
t('4c 入力の文字は 16px', !!narrow && /font-size:\s*16px/.test(narrow.body), '');
const wideish = top.out.filter((b) => b !== narrow).map((b) => b.body).join('\n');
t('4d 900px 以上（PC・MacBook）では押す所の高さを変えない', !/min-height/.test(wideish), '');

console.log('5 当てた画面');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const using = [], vers = new Set();
for (const f of pages) {
  const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const attr = /<html\b[^>]*\bdata-su-theme\b/.test(h);
  const m = h.match(/<link rel="stylesheet" href="su-theme\.css\?v=([0-9.-]+)">/g) || [];
  if (attr || m.length) using.push(f);
  t('5 ' + f + ': 印と読み込みがそろっている', attr === (m.length === 1), { attr, links: m.length });
  for (const x of m) vers.add(x.replace(/^.*\?v=([0-9.-]+).*$/, '$1'));
}
t('5a 当てた画面が1つ以上ある', using.length > 0, using);
t('5b 版はどの画面も1種類', vers.size <= 1, [...vers]);

console.log('6 担当者会議のページ');
t('6 担当者会議のページには当てない', !using.includes('care-meeting.html'), using);

console.log('7 別の型（data-ds="ops"）の画面');
const opsBlk = top.out.find((b) => /^@media screen and \(not \(prefers-color-scheme: dark\)\)$/.test(b.head));
t('7a ops の置き換えは明るい表示の時だけの塊にある', !!opsBlk && /\[data-ds="ops"\]:not\(\[data-mode="dark"\]\)/.test(opsBlk.body), top.out.map((b) => b.head));
t('7b 共通の色の名前の置き換えは ops の画面を外す', /:root\[data-su-theme\]:not\(\[data-ds="ops"\]\) \{[^}]*--pri:/.test(css), '');
t('7c ops の見出しの字は地に対して 7:1 以上', !!opsBlk && ratio((/--c-hero-ink: (#[0-9A-Fa-f]{6})/.exec(opsBlk.body) || [])[1] || '#FFFFFF', (/--c-hero: (#[0-9A-Fa-f]{6})/.exec(opsBlk.body) || [])[1] || '#FFFFFF') >= 7, '');
for (const f of pages) {
  const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/<html\b[^>]*data-ds="ops"[^>]*data-su-theme/.test(h)) t('7d ' + f + ': ops の画面は見出しを keep-hdr にする', /data-su-theme="[^"]*\bkeep-hdr\b/.test(h), '');
}

console.log('8 見出しが .topbar の画面（data-su-theme="topbar"）');
const tb = (/:root\[data-su-theme\]\[data-su-theme~="topbar"\] \{([^}]*)\}/.exec(css) || [])[1] || '';
const tv = (n) => ((new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})')).exec(tb) || [])[1];
t('8a 色の名前の置き換えは topbar の印の画面だけ', !!tb && !/:root\[data-su-theme\]\s*\{[^}]*--mut:/.test(css), '');
for (const [fg, bg] of [['mut', '#FFFFFF'], ['mut', '#FAFBFC'], ['mut', tv('bg')], ['ink', '#FFFFFF'], ['err', '#FFFFFF']]) {
  const r = tv(fg) && bg ? ratio(tv(fg), bg) : 0;
  t('8b ' + fg + ' の字は ' + bg + ' の地で 7:1 以上（' + r.toFixed(2) + '）', r >= 7, { fg: tv(fg), bg });
}
t('8c 主なボタン（--accent の地）の白い字は 7:1 以上', !!tv('accent') && ratio('#FFFFFF', tv('accent')) >= 7, tv('accent'));
for (const k of ['badge', 'tag']) {
  const m = new RegExp(':root\\[data-su-theme\\]\\[data-su-theme~="topbar"\\] \\.' + k + ' \\{ background: (#[0-9A-Fa-f]{6}); \\}').exec(css);
  t('8d 札 .' + k + ' の白い字は 7:1 以上', !!m && ratio('#FFFFFF', m[1]) >= 7, m && m[1]);
}
t('8e 体重管理（.topbar を持つ別の画面）には topbar の印を付けない', !/data-su-theme="[^"]*\btopbar\b/.test(fs.readFileSync(path.join(ROOT, 'weight-record.html'), 'utf8')), '');

console.log('9 画面の書体で測って紙の列幅を決める画面（keep-font）');
/* デイ利用表は、印刷の直前に「利用時間」の欄の文字を画面の書体（getComputedStyle の fontFamily）で測り、紙の列の幅を決める。
   型の書体（画面だけ）に替えると、紙（元の書体）より狭く測って「10:00～16…」と時刻が欠けた（2026-11-02 dca7de6 から・11-13 に印刷比較で特定）。
   家族構成図と同じく keep-font で書体を残す */
{
  const dr = fs.readFileSync(path.join(ROOT, 'daycare-roster.html'), 'utf8');
  const fnAt = dr.indexOf('function rosterTimeColW_(');
  const fnBody = fnAt < 0 ? '' : dr.slice(fnAt, dr.indexOf('\n}', fnAt) + 2);   // 関数の中だけを見る（後ろの関数の同じ字面に当てない）
  t('9a デイ利用表は時刻の列を画面の書体で測っている（前提）', /'font-family:' \+ cs\.fontFamily/.test(fnBody), '');
  t('9b デイ利用表は keep-font で書体を残す', /<html\b[^>]*data-su-theme="[^"]*\bkeep-font\b/.test(dr), '');
  t('9c 型の書体の置き換えは keep-font の画面を外す（CSS の側）', /:root\[data-su-theme\]:not\(\[data-su-theme~="keep-font"\]\) body \{ font-family: var\(--su-font\); \}/.test(css), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
