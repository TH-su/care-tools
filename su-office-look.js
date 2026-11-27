/* su-office-look.js — 事務所の管理画面（勤怠管理・給与）の PC の見た目の部品（2026-11-27 本人指示・su-office-look.css と組み）
 *
 * 足すのは2つだけで、どちらも見た目の部品（画面の動き・保存・通信には触れない）:
 *   1. パンくず（メニュー › 勤怠管理 › 今のタブ）… 「メニュー」は index.html へ、真ん中はホームのタブ（給与は最初のタブ）のボタンを押すのと同じ
 *   2. 丸い月の並び（← 2026年 1月…12月 →）… 押すと今の月分の欄（#g-ym・#p-ym）に値を入れ、change を送るだけ。
 *      月分を変えるかどうか（保存していない設定・賞与の確かめなど）は今までどおり画面が決め、欄の値が戻ればこの並びも戻る（0.4 秒ごとに欄を見て合わせる）
 * ほかに、左に立てたメニュー（PC）では上下の矢印でタブを移れるようにする（給与は今の左右の矢印と同じ道へ渡す）。
 * 読み込めなくても画面は今のまま動く。例外は外に出さず su-errors の記録に残す。文字は textContent で入れる。端末には何も残さない。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.__suOfficeLook) return;
  window.__suOfficeLook = true;
  function note(e, where) { try { if (window.SUErrors && window.SUErrors.note) window.SUErrors.note('見た目の部品', String(e && e.message || e), 'su-office-look ' + where); } catch (x) { /* 記録できなくても止めない */ } }
  function el(tag, cls, txt) { var x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }
  function isYm(v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || '')); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function start() {
    var app = document.getElementById('g-app') || document.getElementById('p-app');
    if (!app) return;
    var isK = app.id === 'g-app';
    var ym = document.getElementById(isK ? 'g-ym' : 'p-ym');
    var bar = app.querySelector(':scope > .bar');
    var tabs = app.querySelector(':scope > .tabs');
    var h1 = document.querySelector('.hdr h1');
    var wide = window.matchMedia ? window.matchMedia('(min-width: 900px)') : { matches: true };

    /* ── 1. パンくず ── */
    var crumb = el('nav', 'sul-crumb no-print'), ol = el('ol'), liMenu = el('li'), aMenu = el('a', '', 'メニュー'), liApp = el('li'), bApp = el('button', '', h1 ? h1.textContent : ''), liNow = el('li'), sNow = el('span', '');
    crumb.setAttribute('aria-label', '今いる場所');
    aMenu.href = 'index.html';
    bApp.type = 'button';
    sNow.setAttribute('aria-current', 'page');
    liMenu.appendChild(aMenu); liApp.appendChild(bApp); liNow.appendChild(sNow);
    ol.appendChild(liMenu); ol.appendChild(liApp); ol.appendChild(liNow); crumb.appendChild(ol);
    app.insertBefore(crumb, app.firstChild);
    function visTabs() { return tabs ? Array.prototype.filter.call(tabs.querySelectorAll(':scope > button[role="tab"]'), function (b) { return !b.hidden; }) : []; }
    function tabName(b) {   /* ボタンの中の文字のうち、件数の札（.tab-n）を除いた名前 */
      var s = ''; if (!b) return s;
      Array.prototype.forEach.call(b.childNodes, function (n) { if (n.nodeType === 3) s += n.nodeValue; });
      return s.trim();
    }
    bApp.addEventListener('click', function () {
      try { var all = visTabs(), first = isK ? tabs.querySelector('button[data-tab="home"]') : all[0]; if (first && first.getAttribute('aria-selected') !== 'true') first.click(); } catch (e) { note(e, 'crumb'); }
    });

    /* ── 2. 丸い月の並び ── */
    var box = null, shownY = 0, lastVal = '', lastNow = '';
    if (ym && bar) {
      box = el('div', 'sul-months no-print');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', '月分を選ぶ');
      bar.insertBefore(box, bar.firstChild);
      box.addEventListener('click', function (e) {
        try {
          var b = e.target && e.target.closest ? e.target.closest('button') : null;
          if (!b || b.disabled || !box.contains(b)) return;
          if (b.hasAttribute('data-sul-y')) { shownY += Number(b.getAttribute('data-sul-y')); paintMonths(true); return; }
          var v = b.getAttribute('data-sul-ym');
          if (!isYm(v) || v === ym.value || ym.disabled) return;
          ym.value = v;
          ym.dispatchEvent(new Event('change', { bubbles: true }));
          setTimeout(sync, 0);
        } catch (x) { note(x, 'months'); }
      });
    }
    function inRange(v) { return (!ym.min || !isYm(ym.min) || v >= ym.min) && (!ym.max || !isYm(ym.max) || v <= ym.max); }
    function paintMonths(keepFocusY) {
      if (!box) return;
      var cur = isYm(ym.value) ? ym.value : '';
      if (!shownY) shownY = cur ? Number(cur.slice(0, 4)) : new Date().getFullYear();
      var focusY = keepFocusY && document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-sul-y') : null;
      while (box.firstChild) box.removeChild(box.firstChild);
      var prev = el('button', 'sul-yb', '←'), next = el('button', 'sul-yb', '→'), yr = el('span', 'sul-yr', String(shownY));
      prev.type = next.type = 'button';
      prev.setAttribute('data-sul-y', '-1'); next.setAttribute('data-sul-y', '1');
      prev.setAttribute('aria-label', (shownY - 1) + '年の月を出す'); next.setAttribute('aria-label', (shownY + 1) + '年の月を出す');
      prev.disabled = !!(ym.min && isYm(ym.min) && Number(ym.min.slice(0, 4)) >= shownY);
      next.disabled = !!(ym.max && isYm(ym.max) && Number(ym.max.slice(0, 4)) <= shownY);
      yr.appendChild(el('small', '', '年'));
      box.appendChild(prev); box.appendChild(yr);
      for (var m = 1; m <= 12; m++) {
        var v = shownY + '-' + pad(m), b = el('button', 'sul-m', String(m));
        b.type = 'button';
        b.setAttribute('data-sul-ym', v);
        b.setAttribute('aria-label', shownY + '年' + m + '月分');
        b.setAttribute('aria-pressed', v === cur ? 'true' : 'false');
        b.disabled = !inRange(v) || !!ym.disabled;
        b.appendChild(el('small', '', '月'));
        box.appendChild(b);
      }
      box.appendChild(next);
      if (focusY) { var f = box.querySelector('[data-sul-y="' + focusY + '"]'); if (f && !f.disabled) f.focus(); }
    }

    /* ── 欄の値・今のタブに合わせる（画面が欄の値を直に書き換えても追いつく） ── */
    function sync() {
      try {
        if (box && ym.value !== lastVal) { lastVal = ym.value; shownY = isYm(lastVal) ? Number(lastVal.slice(0, 4)) : shownY; paintMonths(false); }
        var sel = tabs && tabs.querySelector(':scope > button[aria-selected="true"]'), now = tabName(sel);
        if (now !== lastNow) { lastNow = now; sNow.textContent = now; liNow.hidden = !now; }
        if (tabs) tabs.setAttribute('aria-orientation', wide.matches ? 'vertical' : 'horizontal');
      } catch (e) { note(e, 'sync'); }
    }
    sync();
    setInterval(function () { if (!document.hidden) sync(); }, 400);
    document.addEventListener('click', function () { setTimeout(sync, 0); }, true);

    /* ── 左に立てたメニューの上下の矢印 ── */
    if (tabs) tabs.addEventListener('keydown', function (e) {
      try {
        if (!wide.matches || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        if (!isK) { (e.target || tabs).dispatchEvent(new KeyboardEvent('keydown', { key: e.key === 'ArrowDown' ? 'ArrowRight' : 'ArrowLeft', bubbles: true })); setTimeout(focusSel, 0); return; }
        var all = visTabs(), i = all.indexOf(document.activeElement);
        if (i < 0) i = all.indexOf(tabs.querySelector(':scope > button[aria-selected="true"]'));
        var to = all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
        if (to) { to.click(); setTimeout(function () { var s = tabs.querySelector(':scope > button[aria-selected="true"]'); if (s) s.focus(); }, 0); }
      } catch (x) { note(x, 'keys'); }
    });
    function focusSel() { var s = tabs.querySelector(':scope > button[aria-selected="true"]'); if (s) s.focus(); }
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { try { start(); } catch (e) { note(e, 'start'); } });
    else start();
  } catch (e) { note(e, 'start'); }
})();
