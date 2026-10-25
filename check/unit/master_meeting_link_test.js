/* master_meeting_link_test.js — 入居者マスタの詳細画面の「担当者会議」の欄の配線（2026-10-25 本人指示）
 *
 * 固定する約束:
 *   1 欄は詳細画面（renderView）の「意向・人生会議（ACP）」の欄の直後に置く。編集画面（openEdit）には足さない
 *   2 中身は「📋 担当者会議の記録を開く」のリンクだけ。行き先は care-meeting.html?resident=利用者No で、渡すのは resident だけ
 *     （氏名・居室などほかの値は付けない）。ほかの画面へのリンク（この方を各アプリで開く）と同じく別タブ（target=_blank・rel=noopener）
 *   3 見た目はボタン（.rlink・高さ44px以上）
 *   4 現場端末（su_device_role が field）では欄ごと出さない
 *   5 印刷しない（@media print で消す・PRINT_SECS に入れない・data-k を付けない）
 * 実物の画面のソースから関数を切り出して vm で動かす（写経しない）。MASTER_HTML で差し替えるのは、わざと壊した版で落ちるかの確認用。
 * 値はすべて架空。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.MASTER_HTML || path.join(ROOT, 'resident-master.html'), 'utf8');

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(String(info).slice(0, 400)) : '')); }
}
/* 関数を名前で切り出す（行頭の function だけ・引用符の中の括弧は数えない） */
function grabFn(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
function grabLine(src, re) { const m = re.exec(src); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }

const box = { ROLE: 'office', encodeURIComponent, String };
vm.createContext(box);
vm.runInContext([
  'var DEVICE_KEY = "su_device_role";',
  'var localStorage = { getItem: function(k){ return k === DEVICE_KEY ? ROLE : null; } };',
  grabLine(HTML, /function getDeviceRole\(\)\{[^\n]*\}/),
  grabLine(HTML, /function esc\(s\)\{[^\n]*\}/),
  grabFn(HTML, 'meetingLinkHtml_')
].join('\n'), box);

say('— 1. 置き場所 —');
const view = grabFn(HTML, 'renderView');
const iAcp = view.indexOf("<div class=\"sec-lbl\">意向・人生会議（ACP）</div>");
const iLink = view.indexOf('h+=meetingLinkHtml_(r);');
const iSup = view.indexOf('// 支援経過（新しい順）');
t('詳細画面（renderView）が欄を1回だけ置く', iLink > 0 && view.indexOf('meetingLinkHtml_(') === view.lastIndexOf('meetingLinkHtml_('), iLink);
t('置く所は「意向・人生会議（ACP）」の欄の直後（その間にほかの欄を挟まない）', iAcp > 0 && iAcp < iLink && iLink < iSup &&
  (view.slice(iAcp, iLink).match(/h\+=/g) || []).length === 0, view.slice(iAcp, iLink).length);
t('編集画面（openEdit）には足さない', grabFn(HTML, 'openEdit').indexOf('care-meeting') < 0 && grabFn(HTML, 'openEdit').indexOf('meetingLinkHtml_') < 0);
t('リンクを組むのはこの関数だけ（ほかの所から care-meeting.html へ飛ばない）', (HTML.match(/care-meeting\.html/g) || []).length === 1);

say('\n— 2. 中身とリンク先 —');
const h = box.meetingLinkHtml_({ id: 1234, name: '架空 一郎', room: '101', kana: 'かくう いちろう' });
const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
t('リンクは1つだけ', hrefs.length === 1 && (h.match(/<a\b/g) || []).length === 1, h);
t('行き先は care-meeting.html?resident=利用者No（resident だけ）', hrefs[0] === 'care-meeting.html?resident=1234', hrefs[0]);
const q = new URLSearchParams(hrefs[0].split('?')[1].replace(/&amp;/g, '&'));
t('付ける引数は resident の1つだけ（氏名・居室・かな・masterId を付けない）', [...q.keys()].join() === 'resident' && h.indexOf('架空') < 0 && h.indexOf('101') < 0 && h.indexOf('かくう') < 0 && h.indexOf('masterId') < 0, [...q.keys()]);
t('文言は「📋 担当者会議の記録を開く」、欄の見出しは「担当者会議」', />📋 担当者会議の記録を開く<\/a>/.test(h) && /<div class="sec-lbl">担当者会議<\/div>/.test(h), h);
t('ほかの画面へのリンクと同じく別タブ（target="_blank" rel="noopener"）', /<a class="rlink" target="_blank" rel="noopener" href=/.test(h) && /<a class="rlink" target="_blank" rel="noopener" href="'\+esc\(residentLink/.test(HTML), h);
const odd = box.meetingLinkHtml_({ id: 'a"&b<c' });
t('利用者No に記号が入っても URL の中で符号化され、属性を抜けない', /href="care-meeting\.html\?resident=a%22%26b%3Cc"/.test(odd) && !/<c/.test(odd), odd);
t('利用者No が無い方には欄を出さない', box.meetingLinkHtml_({ id: '' }) === '' && box.meetingLinkHtml_({}) === '' && box.meetingLinkHtml_(null) === '');

say('\n— 3. 見た目（ボタン・44px） —');
const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
t('.rlink は高さ44px以上の枠つきのボタンの見た目', /\.rlink\{[^}]*min-height:44px[^}]*border:1px solid/.test(css));

say('\n— 4. 現場端末では出さない —');
box.ROLE = 'field';
t('現場端末（field）では欄ごと出さない（空の文字）', box.meetingLinkHtml_({ id: 1234 }) === '');
box.ROLE = 'office';
t('事務所PC（office）では出す', box.meetingLinkHtml_({ id: 1234 }).indexOf('sec-cmeet') >= 0);

say('\n— 5. 印刷しない —');
t('@media print で欄（.sec-cmeet）ごと消す', /@media print\{\.sec-cmeet\{display:none !important\}\}/.test(css));
t('欄に .sec-cmeet が付く', /^<div class="sec sec-cmeet">/.test(h), h);
const ps = grabLine(HTML, /\nvar PRINT_SECS=\[[\s\S]*?\];/);
t('「印刷しない欄」の表（PRINT_SECS）に入れない', ps.indexOf('担当者会議') < 0);
t('data-k を付けない', h.indexOf('data-k') < 0);

say('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
