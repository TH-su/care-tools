/*
 * su-gas-auth.js — 事務所用の合言葉で GAS へ読みに行く要求に、ログインしている時だけログインの証明（accessToken）を添える共通部品
 * ════════════════════════════════════════════════════════════════
 * 決まり（代表者の決定 2026-10-29「推奨どおり」）:
 *   ・GAS（入居者マスタ・職員マスタ・入居調整・個別機能訓練計画書）は、スクリプトプロパティ READ_ROLE_CHECK が on の時だけ、
 *     事務所用の合言葉の読み取りで本文の accessToken（Supabase のログインの証明）を使って役割を確かめる。
 *   ・画面は本文を作った後に SUGasAuth.addTo(本文) を通してから JSON にして送る。足すのは accessToken の1項目だけで、
 *     送り方（POST・Content-Type・redirect・応答の読み方・ほかの項目と順番）は1バイトも変えない（CLAUDE.md §2-3）。
 *   ・ログインしていない端末（sb-…-auth-token の鍵が無い）・端末の用途が現場の端末では何も足さず、ログインの部品も読み込まない。
 *   ・本文がもう accessToken を持っている時（保存などで画面が自分で添えた時）は、その本文をそのまま返す（上書きしない）。
 *   ・3秒で証明が取れない・失敗した時は何も足さずに送る（読み取りを止めない。断るかどうかは GAS が決める）。
 *   ・証明は端末に保存しない（この部品は変数にも残さない。毎回ログインの部品に聞く）。
 * ★読み込むだけで効く・読み込めなくても動く・例外を外に出さない（CLAUDE.md §2-6）。
 *   画面は (window.SUGasAuth ? SUGasAuth.addTo(b) : Promise.resolve(b)) の形で呼び、部品が無い時は今までどおり送る。
 * ★ログインの部品の後からの読み込みは su-app-gate.js の authLoad と同じ作法（読み込み済みの script タグがあれば待つ）。
 */
(function () {
  'use strict';
  if (window.SUGasAuth) return;

  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var V_AUTH = 'su-auth.js?v=2026-10-28';
  var V_SB = 'supabase-js-2.112.4.js';
  var WAIT_MS = 3000;

  function hasSession() {
    try { for (var i = 0; i < localStorage.length; i++) if (SESSION_RE.test(localStorage.key(i) || '')) return true; } catch (e) { /* 読めない端末はログインなし */ }
    return false;
  }
  /* 端末の用途は毎回読み直す（用途が変わった後に古い値で足さない） */
  function isField() {
    try { return localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; }
  }
  function authLoad() {
    if (window.SUAuth) return Promise.resolve();
    function has(re) { return Array.prototype.some.call(document.scripts, function (s) { return re.test(s.getAttribute('src') || ''); }); }
    function load(src) {
      return new Promise(function (ok, ng) {
        var s = document.createElement('script'); s.src = src; s.async = true;
        s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
        document.head.appendChild(s);
      });
    }
    function wait(ready) {
      return new Promise(function (ok, ng) { var n = 0; (function tick() { if (ready()) return ok(); if (++n > 100) return ng(new Error('timeout')); setTimeout(tick, 100); })(); });
    }
    var p = window.supabase ? Promise.resolve() : (has(/^supabase-js-/) ? wait(function () { return !!window.supabase; }) : load(V_SB));
    return p.then(function () {
      if (window.SUAuth) return null;
      return has(/^su-auth\.js/) ? wait(function () { return !!window.SUAuth; }) : load(V_AUTH);
    });
  }

  /* ログインの証明（access_token）。ログインしていない・現場の端末・3秒で返らない・失敗は '' */
  function token() {
    try {
      if (!hasSession() || isField()) return Promise.resolve('');
      var get = authLoad().then(function () {
        return (window.SUAuth && typeof window.SUAuth.client === 'function') ? window.SUAuth.client().auth.getSession() : null;
      }).then(function (r) {
        var t = r && r.data && r.data.session && r.data.session.access_token;
        return typeof t === 'string' ? t : '';
      })['catch'](function () { return ''; });
      return Promise.race([get, new Promise(function (ok) { setTimeout(function () { ok(''); }, WAIT_MS); })]);
    } catch (e) { return Promise.resolve(''); }
  }

  /* 本文に証明を添える。証明がある時は浅い写しの最後に accessToken を足して返す（元の本文は書き換えない）。
     証明が無い・本文が object でない・もう accessToken を持っている・失敗の時は本文をそのまま返す */
  function addTo(body) {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Promise.resolve(body);
      if (body.accessToken) return Promise.resolve(body);
      return token().then(function (at) {
        if (!at) return body;
        var out = {};
        for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
        out.accessToken = at;
        return out;
      })['catch'](function () { return body; });
    } catch (e) { return Promise.resolve(body); }
  }

  window.SUGasAuth = { token: token, addTo: addTo };
})();
