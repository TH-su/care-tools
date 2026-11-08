/*
 * su-device-role.js — 端末の用途を、管理者が Mac の画面で決めたとおりに受け取る（2026-11-08・代表者の決定 段3 案A・統合 0081）
 * ════════════════════════════════════════════════════════════════
 * 今までは端末の用途（現場／事務所・localStorage の su_device_role）を、各端末で1台ずつ入れていた。
 * これからは、管理者が「アプリの使える人」（app-access.html）の「端末の用途」で決めると、その端末がメニューを開いた時に届く。
 *
 * 流れ（メニュー index.html が読む）:
 *   1. 切り替えスイッチ su-backend.json の supabase.device_role が入の時だけ動く（切・読めない時は何もしない）
 *   2. 端末の印（su_device_key・この端末で1回だけ作る32文字の乱数＝crypto.getRandomValues の16バイト。su-login-band.js と同じ鍵・同じ作り方）と、
 *      今の用途・ログインの有無（分からない時は null）を、受け口 device-seen へ {k, role, login, want:'role'} で送る。氏名・アカウント・記録は送らない
 *   3. 受け口は管理者が決めた用途（office・field）か null を返す。
 *      ・null・読めない・断られた・形が違う → 何もしない（今の端末の設定を消さない）
 *      ・今の用途と同じ → 何もしない
 *      ・違う → su_device_role を書き換え、ページを読み込み直して起動時のガードに任せる（CLAUDE.md §2-5）。
 *        現場→事務所へ緩める変更も、届いた時だけ。未設定の端末は「事務所」と同じなので、事務所が届いても書かない
 *   4. 遅れて届いた答えは捨てる: 送った時の世代（gen）と違う・送った時と今で用途が変わっている（別のタブ・別の画面で変えた）時
 *   5. 読み込み直しは、同じタブで同じ用途へは1回だけ（書いても保存領域が戻ってしまう端末で、読み込み直しを繰り返さない）
 * 画面に番号を出す: data-mode="show" で読んだ画面（使い方・困った時）は、送らずに [data-su-device-no] へ印の頭の8文字だけを入れる
 *   （管理者が一覧の端末とその端末を突き合わせるため。印が無い端末は文言のまま・印を作らない）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても画面は今までどおり・例外を外に出さない。console に出さない。印刷には何も出さない。
 */
(function () {
  'use strict';
  if (window.SUDeviceRole) return;

  var ENDPOINT = 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/device-seen';
  var PUBLISHABLE = 'sb_publishable_D8mWQenb7E8q7q6On45HaQ_GKxAE_zI';   // su-auth.js と同じ公開用の鍵（これだけでは何も読めない）
  var ROLE_LS = 'su_device_role', KEY_LS = 'su_device_key', RELOAD_SS = 'su_device_role_reload';
  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var KEY_RE = /^[0-9a-f]{32}$/;

  var me = document.currentScript;
  var MODE = me && me.getAttribute('data-mode') === 'show' ? 'show' : 'sync';

  function note(where, e) {
    try { if (window.SUErrors && typeof SUErrors.note === 'function') SUErrors.note('端末の用途の受け取り: ' + where, e && e.message || e); } catch (x) { /* 記録できなくても止めない */ }
  }
  function rawRole() { try { return localStorage.getItem(ROLE_LS); } catch (e) { return null; } }
  function role() { return rawRole() === 'field' ? 'field' : 'office'; }
  function hasSession() {
    try { for (var i = 0; i < localStorage.length; i++) if (SESSION_RE.test(localStorage.key(i) || '')) return true; } catch (e) { /* 無いものとする */ }
    return false;
  }
  function storedKey() {
    try { var k = localStorage.getItem(KEY_LS); return k && KEY_RE.test(k) ? k : ''; } catch (e) { return ''; }
  }
  /* 印を作る（su-login-band.js の deviceKey と同じ: 16バイトの乱数を16進の32文字に）。作れない・残せない端末は ''（送らない） */
  function deviceKey() {
    var k = storedKey();
    if (k) return k;
    try {
      if (!window.crypto || !crypto.getRandomValues) return '';
      var a = new Uint8Array(16); crypto.getRandomValues(a);
      k = Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
      localStorage.setItem(KEY_LS, k);
      return localStorage.getItem(KEY_LS) === k ? k : '';
    } catch (e) { return ''; }
  }
  function shortNo(k) { return k ? k.slice(0, 4) + '-' + k.slice(4, 8) : ''; }

  /* 番号を画面に出す（印を作らない・送らない） */
  function show() {
    try {
      var k = storedKey();
      if (!k) return;
      var els = document.querySelectorAll('[data-su-device-no]');
      for (var i = 0; i < els.length; i++) els[i].textContent = shortNo(k);
    } catch (e) { /* 出せなくても文言のまま */ }
  }

  function flagOn() {
    return fetch('su-backend.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.supabase && j.supabase.device_role === true); })
      .catch(function () { return false; });
  }
  /* ログインの有無（分からない時は null。メニューがログインの部品を読み込むのを待つだけで、自分では読み込まない） */
  function loginState() {
    if (!hasSession()) return Promise.resolve(false);
    return new Promise(function (ok) {
      var n = 0;
      (function tick() {
        if (window.SUAuth && typeof SUAuth.check === 'function') {
          Promise.resolve().then(function () { return SUAuth.check(); }).then(function (st) {
            if (!st || st.status === 'error') return ok(null);
            ok(!(st.status === 'signed_out' || st.status === 'denied'));
          }, function () { ok(null); });
          return;
        }
        if (++n > 80) return ok(null);   // 8秒待っても無ければ「分からない」
        setTimeout(tick, 100);
      })();
    });
  }

  /* 届いた用途を当てる。戻り値は何をしたか（試験で見る）: 'none'・'same'・'stale'・'nowrite'・'again'・'reload' */
  function apply(want, sentRole, g) {
    if (g !== gen) return 'stale';
    if (want !== 'office' && want !== 'field') return 'none';
    var now = role();
    if (now !== sentRole) return 'stale';   // 送った後に別の所で変わった＝古い答え
    if (want === now) return 'same';
    try {
      localStorage.setItem(ROLE_LS, want);
      if (localStorage.getItem(ROLE_LS) !== want) return 'nowrite';
    } catch (e) { note('書き込み', e); return 'nowrite'; }
    try {
      if (sessionStorage.getItem(RELOAD_SS) === want) return 'again';
      sessionStorage.setItem(RELOAD_SS, want);
    } catch (e) { /* 控えられなくても1回は読み込み直す */ }
    try { location.reload(); } catch (e) { note('読み込み直し', e); }
    return 'reload';
  }

  var gen = 0;
  function sync() {
    var g = ++gen;
    return flagOn().then(function (on) {
      if (!on || g !== gen) return 'off';
      var k = deviceKey();
      if (!k) return 'nokey';
      return loginState().then(function (login) {
        if (g !== gen) return 'stale';
        var sent = role();
        return fetch(ENDPOINT, {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE },
          body: JSON.stringify({ k: k, role: sent, login: login, want: 'role' })
        }).then(function (res) {
          if (!res || !res.ok) return null;
          return res.json();
        }).then(function (j) {
          if (!j || j.ok !== true) return 'none';
          return apply(j.role, sent, g);
        });
      });
    }).catch(function () { return 'none'; });   // 届かない時は次に開いた時にもう一度（画面は止めない・今の用途のまま）
  }

  function start() {
    try {
      if (MODE === 'show') { show(); return; }
      sync();
    } catch (e) { note('起動', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  if (MODE === 'sync') window.addEventListener('pageshow', function (e) { if (e && e.persisted) start(); });

  window.SUDeviceRole = { sync: sync, short: function () { return shortNo(storedKey()); }, _apply: apply };
})();
