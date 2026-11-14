/* unsent.js — 未送信の一覧の画面（代表者の決定 2026-11-14【訂正】）
 * 読み取りは unsent-calc.js（SUUnsent.collect）だけ。通信しない。各画面の控えは書き換えない・消さない。
 * 端末に書くのは、メニューの札のための件数の鍵（unsent_menu_due・件数と数えた日だけ）1つだけ。事務所の端末で数え終えた時に書き、
 * 読めない・壊れた時（SUUnsent.menuDue が null）は書かない。現場の端末では書かない（メニューの札はほかの札と同じく現場では読まない）
 * （代表者の決定 2026-11-14）。
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
  function ymd(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  /* メニューの札の件数の鍵を書く（同じ値なら書かない）。書けなくても画面は動く */
  function writeMenuDue(rows, now) {
    try {
      var v = U.menuDue(rows, ymd(now));
      if (v == null) return;
      var st = loc();
      if (!st) return;
      if (st.getItem(U.MENU_DUE_KEY) !== v) st.setItem(U.MENU_DUE_KEY, v);
    } catch (e) { note('メニューの札の件数', e); }
  }

  function stateText(r) {
    if (r.state === 'bad') return '確かめられません';
    if (r.state === 'unknown') return '確かめられません（そのアプリを開くと分かります）';
    if (r.conflict > 0) return r.n + '件（うち食い違い' + r.conflict + '件は、どちらを残すか人が選ぶ必要があります）';
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
      var mir = r.group === 'mirror', chk = r.state === 'unknown' || r.group === 'held' || r.check === true;
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
      var rows = U.collect({ local: loc(), session: sess(), field: isField, detail: !isField, admission: !isField && authOk });
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
      /* 事務所PCでは、ログインの確かめの答え（使える・使えない・確かめられない）が出てから書く。答えの前の件数は入居調整を
         含まないので、書くと札の数が一度だけ少なく出る（反証レビュー 2026-11-14 低2） */
      if (!isField && authDone) writeMenuDue(rows, now);
      /* 数え終えた印（確かめの答えの後・現場の端末はすぐ）。試験が「件数の控えまで書き終えた」ことを待つのに使う。画面の見た目は変えない */
      if (isField || authDone) $('when').setAttribute('data-done', '1'); else $('when').removeAttribute('data-done');
    } catch (e) {
      note('draw', e);
      try { $('list').textContent = '確かめられませんでした。読み込み直してください。'; } catch (x) { /* 何もしない */ }
    }
  }
  /* 入居調整の控えは、事務所PCで事務所・管理者としてログインしていると確かめられた時だけ読む（§2.7・反証レビュー 2026-11-14）。
     確かめは su-auth.js の強制でない確かめ（SUAuth.check）。ログインしていない・確かめられない・現場のアカウント・2段階認証の前は読まない */
  /* authDone: 確かめの答えが出たか（出るまで件数の鍵を書かない）。確かめ直す時は authOk も authDone も下ろしてから描く */
  /* 確かめの答えが AUTH_WAIT_MS の内に出ない時は「確かめられない」として入居調整を除いた件数で1回書き、後で答えが出れば書き直す
     （ログインの確かめが返らない・遅い端末で、札が古い数のまま残らないように・4秒は仮置き） */
  var AUTH_WAIT_MS = 4000;
  var authOk = false, authDone = false, authGen = 0, authTimer = null;
  function askAuth() {
    var my = ++authGen;
    authOk = false; authDone = false;
    try { clearTimeout(authTimer); } catch (e0) { /* 何もしない */ }
    try {
      if (field() || !window.SUAuth || typeof SUAuth.check !== 'function') { authDone = true; return; }   // 確かめられない＝答えが出た
      authTimer = setTimeout(function () {
        if (my !== authGen || authDone) return;
        authOk = false; authDone = true;
        draw();
      }, AUTH_WAIT_MS);
      Promise.resolve(SUAuth.check()).then(function (r) {
        if (my !== authGen) return;
        authOk = !field() && !!(r && SUAuth.STATUS && r.status === SUAuth.STATUS.OK && (r.role === 'office' || r.role === 'admin'));
        authDone = true;
        draw();
      }, function (e) {
        if (my !== authGen) return;
        note('ログインの確かめ', e);
        authOk = false; authDone = true;
        draw();
      });
    } catch (e) { note('ログインの確かめ', e); authOk = false; authDone = true; }
  }
  function start() {
    askAuth();   // 先に確かめを始めて前の答えを下ろしてから描く
    draw();
    try { $('reload').addEventListener('click', draw); } catch (e) { note('reload', e); }
    /* ほかのタブで送れた・積まれた時、「戻る」で戻った時は読み直す（書かないので何度読んでもよい） */
    window.addEventListener('storage', function (ev) {
      /* ログインの控え・端末の用途が変わった時は、役割を確かめ直す（確かめ直すまで入居調整は読まない） */
      if (ev && (ev.key === null || ev.key === 'su_device_role' || /^sb-[a-z0-9]+-auth-token$/.test(String(ev.key)))) askAuth();
      /* 札の件数の鍵は一覧の画面が書く物なので、ほかのタブの一覧が書いた時は読み直さない（2つのタブで数が違うと書き合いが止まらないため・反証レビュー 2026-11-14 中1） */
      if (ev && U && ev.key === U.MENU_DUE_KEY) return;
      draw();
    });
    /* 「戻る」で前の表示のまま戻った時は、前の確かめの答えを使わない（先に下ろしてから描く・反証レビュー 2026-11-14 低1） */
    window.addEventListener('pageshow', function (ev) { if (ev && ev.persisted) { askAuth(); draw(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
