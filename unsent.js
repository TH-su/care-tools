/* unsent.js — 未送信の一覧の画面（代表者の決定 2026-11-14【訂正】）
 * 読み取りは unsent-calc.js（SUUnsent.collect）だけ。この画面は端末に書かない・通信しない。
 * 文字はすべて textContent で入れる（控えの値をそのまま HTML にしない）。 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = String(txt);
    return e;
  }
  function note(where, e) {
    try { if (window.SUErrors && typeof SUErrors.note === 'function') SUErrors.note('unsent:' + where, e); } catch (x) { /* 記録できなくても止めない */ }
  }
  function field() {
    try { return localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; }
  }
  function sess() { try { return window.sessionStorage; } catch (e) { return null; } }
  function loc() { try { return window.localStorage; } catch (e) { return null; } }
  var U = window.SUUnsent;

  function stateText(r) {
    if (r.state === 'bad') return '確かめられません';
    if (r.state === 'unknown') return '確かめられません（そのアプリを開くと分かります）';
    return r.n + '件';
  }
  function itemText(it, now) {
    var parts = [];
    var t = U.fmt(it.at, now);
    parts.push(t ? t : '時刻なし');
    parts.push(it.label);
    if (it.day) parts.push('対象 ' + it.day);
    return parts.join('・');
  }
  function kindBox(r, isField, now) {
    var box = el('div', 'kind');
    var hd = el('div', 'hd');
    hd.appendChild(el('span', 'nm', r.app));
    hd.appendChild(el('span', 'st ' + r.state, stateText(r)));
    box.appendChild(hd);
    if (r.oldest != null) box.appendChild(el('p', 'muted why', 'いちばん古いもの: ' + U.fmt(r.oldest, now)));
    if (r.state === 'bad') box.appendChild(el('p', 'muted why', '控えの形が読めませんでした。そのアプリを開いて、画面の案内を確かめてください。'));
    box.appendChild(el('p', 'muted why', r.why));
    if (!isField && r.items.length) {
      var ul = el('ul', 'items');
      r.items.slice(0, 100).forEach(function (it) { ul.appendChild(el('li', null, itemText(it, now))); });
      if (r.items.length > 100) ul.appendChild(el('li', null, 'ほか ' + (r.items.length - 100) + '件'));
      box.appendChild(ul);
    }
    if (r.href) {
      /* 写し返しは保存がすんでいる分なので「開く」だけ。確かめられない種類・退避した編集（自動では送らない）は「確かめる」 */
      var mir = r.group === 'mirror', chk = r.state === 'unknown' || r.group === 'held';
      var txt = mir ? 'この画面を開く' : chk ? 'この画面を開いて確かめる' : 'この画面を開いて送る';
      var a = el('a', mir ? 'btn' : 'btn pri', txt);
      a.setAttribute('href', r.href);
      a.setAttribute('aria-label', r.app + (mir ? 'を開く' : chk ? 'を開いて確かめる' : 'を開いて送る'));
      var p = el('p', 'why'); p.appendChild(a); box.appendChild(p);
    }
    return box;
  }
  function draw() {
    try {
      if (!U) { $('list').textContent = '部品を読み込めませんでした。読み込み直してください。'; return; }
      var isField = field(), now = Date.now();
      var rows = U.collect({ local: loc(), session: sess(), field: isField, detail: !isField });
      var list = $('list'), mir = $('mirror'), none = $('none'), unk = $('unknown');
      list.textContent = ''; mir.textContent = ''; none.textContent = ''; unk.textContent = '';
      var nMain = 0, nMir = 0, nNone = 0, nUnk = 0;
      rows.forEach(function (r) {
        if (r.state === 'none') { none.appendChild(el('li', null, r.app)); nNone++; return; }
        if (r.state === 'unknown') { unk.appendChild(kindBox(r, isField, now)); nUnk++; return; }
        if (r.group === 'mirror') { mir.appendChild(kindBox(r, isField, now)); nMir++; return; }
        list.appendChild(kindBox(r, isField, now)); nMain++;
      });
      if (!nMain) list.appendChild(el('p', 'muted', 'この端末に送信待ちはありません。'));
      else if (isField) list.appendChild(el('p', 'muted', 'この端末は現場用のため、件数だけを出しています。'));
      $('mirrorBox').hidden = !nMir;
      $('unknownBox').hidden = !nUnk;
      $('noneBox').hidden = !nNone;
      $('when').textContent = U.fmt(now, now) + ' に読みました';
    } catch (e) {
      note('draw', e);
      try { $('list').textContent = '確かめられませんでした。読み込み直してください。'; } catch (x) { /* 何もしない */ }
    }
  }
  function start() {
    draw();
    try { $('reload').addEventListener('click', draw); } catch (e) { note('reload', e); }
    /* ほかのタブで送れた・積まれた時、「戻る」で戻った時は読み直す（書かないので何度読んでもよい） */
    window.addEventListener('storage', function () { draw(); });
    window.addEventListener('pageshow', function (ev) { if (ev && ev.persisted) draw(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
