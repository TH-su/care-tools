/* 訪問／全支援 左右比較（overview-compare.html）の、幅700px以下のタブの試験（2026-11-13 新設・代表者の指示）
   実行: node check/unit/overview_compare_tabs_test.js
   ★画面の本物のタブの処理（tabVisit を探す <script> の中身）を、偽物の部品で動かす。氏名は扱わない。
   守ること:
     1. 形: タブは role=tablist／tab・aria-selected・aria-controls を持ち、訪問が既定で選ばれている。
        タブは 700px 以下（@media screen）の中でだけ出し、既定は出さない。隠す方は visibility で隠し、display:none にしない
        （中の幅が 0 になると連動の倍率そろえが進まない）。使い方の1行は画面だけで、印刷では出さない
     2. 押す: 押した方を .panes の data-tab に書き、aria-selected と tabIndex を移す。枠（iframe）の src には触れない（読み込み直さない）
     3. キーボード: 左右の矢印・Home・End で移り、移った方へフォーカスする
     4. 保存: 端末に残すのは ocmp_tab の 'visit'／'support' だけ。読み込み直したら戻し、決まった値以外は既定の訪問。
        保存領域が使えなくても止まらない（エラーの記録へ残す） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.OC_HTML || path.join(ROOT, 'overview-compare.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

const at = HTML.indexOf("document.getElementById('tabVisit')");
const SRC = HTML.slice(HTML.lastIndexOf('<script>', at) + '<script>'.length, HTML.indexOf('</script>', at));

function el(id, attrs) {
  const a = Object.assign({}, attrs || {});
  const ls = {};
  return {
    id, tabIndex: a.tabindex != null ? Number(a.tabindex) : 0,
    getAttribute: k => (k in a ? a[k] : null),
    setAttribute(k, v) { a[k] = String(v); },
    removeAttribute(k) { delete a[k]; },
    addEventListener(ev, fn) { (ls[ev] = ls[ev] || []).push(fn); },
    fire(ev, obj) { (ls[ev] || []).forEach(fn => fn.call(this, obj || {})); },
    focus() { doc.activeElement = this; },
    _a: a
  };
}
let doc;
function boot(store, opt) {
  opt = opt || {};
  const ops = [];
  const notes = [];
  const els = {
    cmpPanes: el('cmpPanes', { 'data-tab': 'visit' }),
    tabVisit: el('tabVisit', { 'data-tab': 'visit', 'aria-selected': 'true', tabindex: 0 }),
    tabSupport: el('tabSupport', { 'data-tab': 'support', 'aria-selected': 'false', tabindex: -1 }),
    paneVisit: el('paneVisit'), paneSupport: el('paneSupport')
  };
  doc = { activeElement: null, getElementById: id => els[id] || null };
  const localStorage = opt.broken ? {
    getItem() { ops.push('get'); throw new Error('denied'); },
    setItem() { ops.push('set'); throw new Error('denied'); }
  } : {
    getItem(k) { ops.push('get:' + k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { ops.push('set:' + k + '=' + v); store[k] = String(v); }
  };
  const mq = { matches: !!opt.narrow, addEventListener(ev, fn) { mq._fn = fn; } };
  const win = { SUErrors: { note: (kind, e, where) => notes.push(where) }, matchMedia: () => mq };
  vm.runInNewContext(SRC, { window: win, document: doc, localStorage, Object });
  return { els, ops, notes, mq };
}
const state = r => ({ tab: r.els.cmpPanes._a['data-tab'], sel: [r.els.tabVisit._a['aria-selected'], r.els.tabSupport._a['aria-selected']], ti: [r.els.tabVisit.tabIndex, r.els.tabSupport.tabIndex] });

console.log('— 1. 形 —');
{
  t('タブの並びは role=tablist・各タブは role=tab と aria-controls', /id="cmpTabs" role="tablist"/.test(HTML) && /id="tabVisit"[^>]*role="tab"[^>]*aria-controls="paneVisit"/.test(HTML) && /id="tabSupport"[^>]*role="tab"[^>]*aria-controls="paneSupport"/.test(HTML), '');
  t('既定は訪問（aria-selected と .panes の data-tab）', /id="tabVisit"[^>]*aria-selected="true"/.test(HTML) && /id="cmpPanes" data-tab="visit"/.test(HTML), '');
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  const m = css.match(/@media screen and \(max-width: 700px\) \{([\s\S]*?)\n\}/);
  t('タブは既定で出さず、700px 以下（画面だけ）の中で出す', /\.cmp-tabs \{ display: none; \}/.test(css) && !!m && /\.cmp-tabs \{[^}]*display: flex/.test(m[1]), '');
  t('隠す方は visibility で隠し、display:none にしない', !!m && /\.panes\[data-tab="visit"\] \.pane\.right,\s*\.panes\[data-tab="support"\] \.pane\.left \{ visibility: hidden; \}/.test(m[1]) && !/\.pane[^{]*\{[^}]*display: none/.test(m[1].replace(/\.pane-tag \{ display: none; \}/, '')), m && m[1]);
  t('タブは押す所 44px 以上', !!m && /\.cmp-tab \{[^}]*min-height: 44px/.test(m[1]), '');
  t('使い方の1行は既定で出さず、@media screen の中でだけ出す（印刷しない）', /\.hdr-usage \{ display: none; \}\n@media screen \{\n  \.hdr-usage \{\n    display: block;/.test(css), '');
}

console.log('\n— 2. 押す —');
{
  const store = {};
  const r = boot(store);
  t('起動時は訪問', JSON.stringify(state(r)) === JSON.stringify({ tab: 'visit', sel: ['true', 'false'], ti: [0, -1] }), state(r));
  r.els.tabSupport.fire('click');
  t('全支援を押すと全支援を選ぶ（aria-selected・tabIndex も移る）', JSON.stringify(state(r)) === JSON.stringify({ tab: 'support', sel: ['false', 'true'], ti: [-1, 0] }), state(r));
  t('押した方を ocmp_tab に残す', store.ocmp_tab === 'support', store);
  t('枠の読み込み・src には触れない（処理の中に iframe・src・reload が無い）', !/iframe|\.src\b|reload|contentWindow/.test(SRC), '');
}

console.log('\n— 3. キーボード —');
{
  const store = {};
  const r = boot(store);
  r.els.tabVisit.fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  t('右の矢印で全支援へ・フォーカスも移る', state(r).tab === 'support' && doc.activeElement === r.els.tabSupport && store.ocmp_tab === 'support', state(r));
  r.els.tabSupport.fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  t('端で右の矢印を押すと先頭（訪問）へ回る', state(r).tab === 'visit' && doc.activeElement === r.els.tabVisit, state(r));
  r.els.tabVisit.fire('keydown', { key: 'ArrowLeft', preventDefault() {} });
  t('左の矢印で前へ（訪問→全支援に回る）', state(r).tab === 'support', state(r));
  r.els.tabSupport.fire('keydown', { key: 'Home', preventDefault() {} });
  t('Home で訪問', state(r).tab === 'visit', state(r));
  r.els.tabVisit.fire('keydown', { key: 'End', preventDefault() {} });
  t('End で全支援', state(r).tab === 'support', state(r));
  let prevented = false;
  r.els.tabSupport.fire('keydown', { key: 'a', preventDefault() { prevented = true; } });
  t('ほかのキーは何もしない', state(r).tab === 'support' && !prevented, state(r));
}

console.log('\n— 4. 保存 —');
{
  const r1 = boot({ ocmp_tab: 'support' });
  t('読み込み直すと保存した全支援のまま', state(r1).tab === 'support', state(r1));
  t('起動時は読むだけ（書かない）', r1.ops.join() === 'get:ocmp_tab', r1.ops);
  for (const bad of ['', 'Support', '<x>', 'visit ', 'null', '__proto__', 'toString']) {
    const r = boot({ ocmp_tab: bad });
    t('決まった値以外は既定の訪問: ' + JSON.stringify(bad), state(r).tab === 'visit', state(r));
  }
  const store = {};
  const r2 = boot(store);
  r2.els.tabSupport.fire('click'); r2.els.tabVisit.fire('click');
  t('残すキーは ocmp_tab だけ・値は visit／support だけ', Object.keys(store).join() === 'ocmp_tab' && r2.ops.filter(o => o.startsWith('set:')).every(o => /^set:ocmp_tab=(visit|support)$/.test(o)), r2.ops);
  let err = null, r3;
  try { r3 = boot({}, { broken: true }); r3.els.tabSupport.fire('click'); } catch (e) { err = e.message; }
  t('保存領域が使えなくても止まらず、切り替えは効く', err === null && state(r3).tab === 'support', err);
  t('使えなかったことはエラーの記録へ残す（黙って捨てない）', r3 && r3.notes.join() === 'ovcmp:load,ovcmp:save', r3 && r3.notes);
}

console.log('\n— 5. 読み上げの役割 —');
{
  const wide = boot({});
  t('701px 以上ではパネルに tabpanel の役割を付けない', wide.els.paneVisit.getAttribute('role') === null && wide.els.paneSupport.getAttribute('role') === null, '');
  const narrow = boot({}, { narrow: true });
  t('700px 以下ではパネルを tabpanel にし、タブの名前で読む', narrow.els.paneVisit.getAttribute('role') === 'tabpanel' && narrow.els.paneVisit.getAttribute('aria-labelledby') === 'tabVisit' && narrow.els.paneSupport.getAttribute('aria-labelledby') === 'tabSupport', '');
  narrow.mq.matches = false; narrow.mq._fn();
  t('幅が広がったら役割を外す', narrow.els.paneVisit.getAttribute('role') === null, '');
}

console.log(`\n────────── 合計: ${pass} 件成功 / ${fail} 件失敗 ──────────`);
if (fail) process.exit(1);
