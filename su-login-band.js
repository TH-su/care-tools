/*
 * su-login-band.js — ログインしていない端末の帯（入居者マスタを読む画面・2026-11-02 代表者の依頼）
 * ════════════════════════════════════════════════════════════════
 * 入居者マスタを新しい保存先（Supabase）へ切り替えた後は、ログインしていない端末は入居者の情報を読めない（su-res-read.js）。
 * その端末にだけ、見出しの下（画面の <div id="suLoginBand">）に帯とログインの画面へのボタンを出す。
 * 使う画面: フェイスシート・入居者マスタ・入居調整・担当者会議の記録・個別機能訓練計画書。
 *
 * 帯を出す・消す決まり（体重管理の帯 wrNoLoginBand_ と同じ・2026-10-28 本人指示）:
 *   ・ログインの控え（sb-…-auth-token）が無い → 出す（ログインの部品は読み込まない）
 *   ・控えがあれば su-auth.js で確かめる。「ログインしていない」「使えないアカウント」と分かった時だけ出す
 *   ・ログイン中（2段階認証の6桁がまだの管理者も含む）は出さない
 *   ・通信の失敗などで確かめられない時は消す（ログインしている端末に誤って残さない）
 *   ・起動時のほか、戻るボタンで戻った時（pageshow）・画面に戻った時（visibilitychange）・別のタブでログイン／ログアウトした時（storage）も確かめ直す
 *   ・世代の番号で、遅れて届いた古い確かめの結果を捨てる
 *
 * 記録（分かった時だけ・確かめられない時は何も残さない）:
 *   ・速さの記録（su-perf.js）に「ログインの有無」を渡す（SUPerf.login）。端末の用途と開いた日は su-perf.js が自分で持つ
 *   ・切り替えスイッチ su-backend.json の supabase.device_seen が入の時だけ、受け口 device-seen（care-backend 0048）へ
 *     「端末の印・端末の用途・ログインの有無」の3つだけを送る。最後に開いた日はデータベースが日本時間の日付で決める。
 *     送るのは1日1回と、用途かログインの有無が変わった時だけ（su_seen_sent に「日付|用途|有無」を控える）
 *   ・端末の印は、この端末で1回だけ作る32文字の乱数（su_device_key）。人・名前・メール・機種と結びつかない
 *   ・氏名・記録・メール・トークンは残さない・送らない
 *
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても画面は今までどおり・例外を外に出さない。印刷には出さない。
 */
(function () {
  'use strict';
  if (window.SULoginBand) return;

  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var ENDPOINT = 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/device-seen';
  var PUBLISHABLE = 'sb_publishable_D8mWQenb7E8q7q6On45HaQ_GKxAE_zI';   // su-auth.js と同じ公開用の鍵（これだけでは何も読めない）
  var KEY_LS = 'su_device_key', SENT_LS = 'su_seen_sent';
  var TEXT = 'この端末はログインしていないため、入居者の情報を表示できません。ログインしてください';

  function hasSession() {
    try { for (var i = 0; i < localStorage.length; i++) if (SESSION_RE.test(localStorage.key(i) || '')) return true; } catch (e) {}
    return false;
  }
  function role() {
    try { return localStorage.getItem('su_device_role') === 'field' ? 'field' : 'office'; } catch (e) { return 'office'; }
  }
  function nextName() { var m = /([a-z0-9][a-z0-9-]*\.html)$/.exec(location.pathname || ''); return m ? m[1] : ''; }

  /* ── 帯 ── */
  function ensureCss() {
    if (document.getElementById('su-login-band-css')) return;
    var s = document.createElement('style');
    s.id = 'su-login-band-css';
    s.textContent =
      '.su-login-band{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:#fff8c5;color:#4d3d00;' +
      'border-bottom:1px solid #e0c200;padding:8px 16px;font-size:0.9375rem;font-weight:700;line-height:1.5}' +
      '.su-login-band[hidden]{display:none}' +
      '.su-login-band a{display:inline-flex;align-items:center;min-height:44px;padding:6px 14px;border:1px solid #8a6d00;' +
      'border-radius:6px;background:#fff;color:#4d3d00;text-decoration:none;font-weight:700}' +
      '.su-login-band a:focus-visible{outline:2px solid #4d3d00;outline-offset:1px}' +
      '@media print{.su-login-band{display:none !important}}';
    (document.head || document.documentElement).appendChild(s);
  }
  function box() {
    var el = document.getElementById('suLoginBand');
    if (!el) return null;
    if (!el.firstChild) {
      ensureCss();
      el.classList.add('su-login-band');
      var p = document.createElement('span');
      p.textContent = TEXT;
      var a = document.createElement('a');
      var nx = nextName();
      a.href = 'login.html' + (nx ? '?next=' + encodeURIComponent(nx) : '');
      a.textContent = 'ログインの画面へ';
      el.appendChild(p);
      el.appendChild(a);
    }
    return el;
  }
  function band(show) {
    try { var el = box(); if (el) el.hidden = !show; } catch (e) {}
  }

  /* ── ログインの部品を読み込む（体重管理の wrAuthLoad_ と同じ）── */
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
    var p = window.supabase ? Promise.resolve()
      : (has(/^supabase-js-/) ? wait(function () { return !!window.supabase; }) : load('supabase-js-2.112.4.js'));
    return p.then(function () {
      if (window.SUAuth) return null;
      return has(/^su-auth\.js/) ? wait(function () { return !!window.SUAuth; }) : load('su-auth.js?v=2026-10-28');
    });
  }

  /* ── 記録 ── */
  function today() {   // 日本時間の日付（送るかどうかの控えにだけ使う。残す日付はデータベースが決める）
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function deviceKey() {
    try {
      var k = localStorage.getItem(KEY_LS);
      if (k && /^[0-9a-f]{32}$/.test(k)) return k;
      if (!window.crypto || !crypto.getRandomValues) return '';
      var a = new Uint8Array(16); crypto.getRandomValues(a);
      k = Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
      localStorage.setItem(KEY_LS, k);
      return localStorage.getItem(KEY_LS) === k ? k : '';
    } catch (e) { return ''; }
  }
  var flagP = null;
  function sendOn() {
    if (!flagP) {
      flagP = fetch('su-backend.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return !!(j && j.supabase && j.supabase.device_seen === true); })
        .catch(function () { return false; });
    }
    return flagP;
  }
  function record(login) {
    try { if (window.SUPerf && typeof SUPerf.login === 'function') SUPerf.login(login); } catch (e) {}
    var r = role(), mark = today() + '|' + r + '|' + (login ? '1' : '0');
    try { if (localStorage.getItem(SENT_LS) === mark) return; } catch (e) { return; }
    sendOn().then(function (on) {
      if (!on) return;
      var k = deviceKey();
      if (!k) return;
      return fetch(ENDPOINT, {
        method: 'POST', credentials: 'omit',   // keepalive は付けない（事前の確かめと併せると古い端末で断られることがある・開いた時に送るので要らない）
        headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE },
        body: JSON.stringify({ k: k, role: r, login: !!login })
      }).then(function (res) {
        if (res && res.ok) { try { localStorage.setItem(SENT_LS, mark); } catch (e) {} }
      });
    }).catch(function () {});   // 届かない時は次に開いた時にもう一度送る（画面は止めない）
  }

  /* ── 確かめる ── */
  var gen = 0;
  function resolve() {
    var g = ++gen;
    if (!hasSession()) { band(true); record(false); return; }
    authLoad().then(function () { return window.SUAuth ? SUAuth.check() : null; }).then(function (st) {
      if (g !== gen) return;
      if (!st || st.status === 'error') { band(false); return; }   // 確かめられなかった＝帯は消す・記録しない
      var out = st.status === 'signed_out' || st.status === 'denied';
      band(out);
      record(!out);
    }).catch(function () { if (g === gen) band(false); });
  }

  function start() { try { resolve(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) start(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
  window.addEventListener('storage', function (e) { if (!e || e.key === null || SESSION_RE.test(String(e.key))) start(); });

  window.SULoginBand = { recheck: start };
})();
