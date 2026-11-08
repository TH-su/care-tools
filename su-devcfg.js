/*
 * su-devcfg.js — 管理者が1回入れた接続先と合言葉を、ログインした端末が役割ごとに受け取って使う共通部品（統合 0080・代表者の決定 2026-11-08）
 * ════════════════════════════════════════════════════════════════
 * 決まり:
 *   ・ログインしている時だけ、共通ログインのデータベースの device_config_get を呼ぶ（自分の役割に渡す系統だけが返る）。
 *     受け取った値は【同じタブの sessionStorage にだけ】短く控える。localStorage には書かない（端末に合言葉を新しく残さない）。
 *   ・使う順は「配った値が先、配っていない系統だけ端末に入れた値」。この部品は配った値を返すだけで、
 *     端末に入れた値（localStorage）を読むのは今までどおり各画面。画面は get() が null の時に今の読み方へ戻る。
 *   ・端末の用途が現場（su_device_role が field）の時は、ws_field・master_field・haiben 以外を使わない・控えない。
 *     現場の端末で get('ws') は ws_field を、get('master') は master_field を返す（現場用の合言葉の系統）。
 *     事務所の端末で get('ws_field')・get('master_field') は使わない（null）。
 *   ・控えはアカウントの指紋（利用者 id を戻せない短い要約）と一緒に置き、今のログインの指紋と違えば使わず捨てる。
 *     ログインの印（sb-…-auth-token）が無い端末では何も返さない。30分ごと・ログインが変わった時に読み直す
 *     （1画面ごとには呼ばない＝受け取りの記録 audit_log を増やしすぎない）。
 *   ・読めない時（通信の失敗）は、同じアカウントの前の値を使い続ける。関数が無い・断られた時は何も返さない（端末に入れた値で動く）。
 *   ・GAS へ送る形（POST・text/plain・redirect:'follow'）には触らない。この部品は接続先と合言葉を返すだけ。
 *   ・値を console に出さない。不具合の報告・エラーの自動報告・接続設定の控え（SUCFG1:）に入れない。
 * ★読み込むだけで効く・読み込めなくても動く・例外を外に出さない（CLAUDE.md §2-6）。
 *   画面は (window.SUDevCfg && SUDevCfg.get('master')) の形で呼び、部品が無い・null の時は今までどおり端末の値を読む。
 * 使い方:
 *   SUDevCfg.get(系統)     → {url, token} | null（同期・すぐ返る）
 *   SUDevCfg.ready(ms)     → 受け取り（または諦め）が済んだら解決する Promise（ms で打ち切り・既定 8秒・失敗しない）
 *   SUDevCfg.onChange(fn)  → 受け取った値が変わった時に呼ぶ（画面が控えた接続先を作り直す時）
 *   SUDevCfg.refresh()     → 控えを使わず読み直す（接続設定で配った・止めた後）
 *   SUDevCfg.forget()      → このタブの控えを捨てる
 */
(function () {
  'use strict';
  if (window.SUDevCfg) return;

  var MEMO_KEY = 'su_devcfg_v1';
  var TTL_MS = 30 * 60 * 1000;
  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var V_AUTH = 'su-auth.js?v=2026-10-28';
  var V_SB = 'supabase-js-2.112.4.js';
  var KEYS = ['ws', 'ws_field', 'master', 'master_field', 'haiben', 'moushi', 'weight', 'med',
              'admission', 'training', 'staff', 'genogram', 'analyzer'];
  var FIELD_KEYS = ['ws_field', 'master_field', 'haiben'];
  /* 受け取る接続先の形（データベースの device_config_set と同じ: GAS のウェブアプリの /exec だけ） */
  var URL_RE = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[A-Za-z0-9.-]+)\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;
  var TOKEN_RE = /^[^\s\u0000-\u001f\u007f]{8,256}$/;

  var mem = { f: '', at: 0, items: {} };     // 今のタブで使う値（指紋・受け取った時刻・系統ごとの {url, token}）
  var inflight = null, gen = 0, listeners = [];
  var lastRaw = null, lastFp = '';

  function note(where, e) {
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('端末設定の受け取り: ' + where, e && e.code || 'error'); } catch (x) { /* 記録できなくても止めない */ }
  }
  function has(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
  function isField() {
    try { return localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; }
  }
  function hash(s) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + '.' + (h1 >>> 0).toString(16);
  }
  /* 今のログインの指紋。ログインの印が無い・読めない時は ''（＝何も使わない） */
  function curFp() {
    try {
      var raw = null;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        if (SESSION_RE.test(k)) { raw = localStorage.getItem(k); break; }
      }
      if (!raw) { lastRaw = null; lastFp = ''; return ''; }
      if (raw === lastRaw) return lastFp;
      var o = JSON.parse(raw);
      var id = o && o.user && typeof o.user.id === 'string' ? o.user.id : '';
      lastRaw = raw; lastFp = id ? hash('su-devcfg|' + id) : '';
      return lastFp;
    } catch (e) { return ''; }
  }
  /* 受け取った値を確かめて写す（形の違う系統・用途に合わない系統は落とす） */
  function clean(items, field) {
    var out = {};
    if (!items || typeof items !== 'object' || Array.isArray(items)) return out;
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], it = items[k];
      if (!Object.prototype.hasOwnProperty.call(items, k) || !it || typeof it !== 'object') continue;
      if (field && !has(FIELD_KEYS, k)) continue;
      var u = typeof it.url === 'string' ? it.url.trim() : '';
      var t = typeof it.token === 'string' ? it.token.trim() : '';
      if (!URL_RE.test(u) || !TOKEN_RE.test(t)) continue;
      out[k] = { url: u, token: t };
    }
    return out;
  }
  function same(a, b) {
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join('|') !== kb.join('|')) return false;
    for (var i = 0; i < ka.length; i++) if (a[ka[i]].url !== b[ka[i]].url || a[ka[i]].token !== b[ka[i]].token) return false;
    return true;
  }
  function fire() {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) { note('知らせ', e); } }
  }
  function setMem(f, at, items) {
    var before = mem.items;
    mem = { f: f, at: at, items: items };
    if (!same(before, items)) fire();
  }
  function memoForget() {
    try { sessionStorage.removeItem(MEMO_KEY); } catch (e) { /* 使えない端末では控えも無い */ }
  }
  function memoRead(f) {
    try {
      var o = JSON.parse(sessionStorage.getItem(MEMO_KEY) || 'null');
      if (!o || o.v !== 1 || !f || o.f !== f || typeof o.at !== 'number') return null;
      return { at: o.at, items: clean(o.items, isField()) };
    } catch (e) { return null; }
  }
  function memoWrite(f, at, items) {
    try { sessionStorage.setItem(MEMO_KEY, JSON.stringify({ v: 1, f: f, at: at, items: items })); } catch (e) { /* 書けなくても毎回受け取るだけ */ }
  }
  function forget() { gen++; inflight = null; memoForget(); setMem('', 0, {}); }

  function authLoad() {
    if (window.SUAuth) return Promise.resolve();
    function tag(re) { return Array.prototype.some.call(document.scripts, function (s) { return re.test(s.getAttribute('src') || ''); }); }
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
    var p = window.supabase ? Promise.resolve() : (tag(/^supabase-js-/) ? wait(function () { return !!window.supabase; }) : load(V_SB));
    return p.then(function () {
      if (window.SUAuth) return null;
      return tag(/^su-auth\.js/) ? wait(function () { return !!window.SUAuth; }) : load(V_AUTH);
    });
  }

  /* 受け取る（同時の呼び出しは1本にまとめる）。失敗しない Promise */
  function fetchNow() {
    if (inflight) return inflight;
    var my = ++gen, f = curFp();
    if (!f) { forget(); return Promise.resolve(); }
    var field = isField();
    inflight = authLoad().then(function () {
      var c = window.SUAuth && typeof window.SUAuth.client === 'function' ? window.SUAuth.client() : null;
      if (!c) throw { code: 'noauth' };
      return c.auth.getSession().then(function (s) {
        if (!(s && s.data && s.data.session)) return { gone: true };
        return c.rpc('device_config_get');
      });
    }).then(function (r) {
      if (my !== gen) return;                           // 出した後に捨てた・ログインが変わった答えは使わない
      if (curFp() !== f || isField() !== field) return;  // 出した時と今でアカウント・端末の用途が違えば捨てる
      if (r && r.gone) { forget(); return; }
      if (r && r.error) {
        var code = String(r.error.code || '');
        /* 関数が無い・断られた（ログインしていない・許可リストに無い）は何も使わない。ほかの失敗（通信）は前の値のまま */
        if (code === '42501' || code === 'PGRST202' || code === '42883' || /^PGRST3/.test(code)) { memoForget(); setMem(f, 0, {}); }
        else note('受け取り', r.error);
        return;
      }
      var d = r && r.data;
      if (!d || d.ok !== true) { memoForget(); setMem(f, 0, {}); return; }
      var items = clean(d.items, field), at = Date.now();
      memoWrite(f, at, items);
      setMem(f, at, items);
    })['catch'](function (e) { note('受け取り', e); })
      .then(function () { if (my === gen) inflight = null; });
    return inflight;
  }

  /* 今の控えを使えるか見て、要るなら読み直す */
  function tick() {
    try {
      var f = curFp();
      if (!f) { if (mem.f || Object.keys(mem.items).length) forget(); return Promise.resolve(); }
      if (mem.f !== f) {
        var m = memoRead(f);
        if (m) { setMem(f, m.at, m.items); if (isField()) memoWrite(f, m.at, m.items); }   // 現場の端末では現場用の系統だけを控え直す
        else setMem(f, 0, {});
      }
      var now = Date.now();
      if (!mem.at || now - mem.at > TTL_MS || now < mem.at) return fetchNow();
      return Promise.resolve();
    } catch (e) { note('確かめ', e); return Promise.resolve(); }
  }

  function get(key) {
    try {
      var field = isField(), k = String(key || '');
      if (field) {
        if (k === 'ws') k = 'ws_field';
        else if (k === 'master') k = 'master_field';
        if (!has(FIELD_KEYS, k)) return null;
      } else if (k === 'ws_field' || k === 'master_field') {
        return null;
      }
      var f = curFp();
      if (!f || f !== mem.f) return null;
      var it = mem.items[k];
      if (!it || !URL_RE.test(it.url) || !TOKEN_RE.test(it.token)) return null;
      return { url: it.url, token: it.token };
    } catch (e) { return null; }
  }
  var first = null;
  function ready(ms) {
    try {
      var wait = typeof ms === 'number' && ms >= 0 ? ms : 8000;
      var p = first || Promise.resolve();
      return Promise.race([p, new Promise(function (ok) { setTimeout(ok, wait); })]).then(function () { return undefined; }, function () { return undefined; });
    } catch (e) { return Promise.resolve(); }
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function refresh() {
    try { gen++; inflight = null; memoForget(); mem.at = 0; return fetchNow(); } catch (e) { return Promise.resolve(); }
  }

  try {
    /* 端末の用途が現場の端末では、事務所の分の控えを最初から持たない（読み込んだ時に落とす） */
    first = tick();
    /* ほかのタブでログイン・ログアウトした時（ログインの印が変わった時）は控えを確かめ直す */
    window.addEventListener('storage', function (e) {
      try {
        if (!e || e.key === null || SESSION_RE.test(e.key || '') || e.key === 'su_device_role') {
          if (curFp() !== mem.f) { gen++; inflight = null; }
          if (e && e.key === 'su_device_role' && isField()) {        // 現場の端末になった時は、事務所の分をすぐ捨てる
            var fi = clean(mem.items, true);
            if (mem.f) memoWrite(mem.f, mem.at, fi);
            setMem(mem.f, mem.at, fi);
          }
          tick();
        }
      } catch (x) { /* 止めない */ }
    });
    /* 30分ごとに読み直す。画面が隠れている間は休む */
    setInterval(function () {
      try { if (!document.hidden) tick(); } catch (x) { /* 止めない */ }
    }, 5 * 60 * 1000);
  } catch (e) { note('起動', e); }

  window.SUDevCfg = { get: get, ready: ready, onChange: onChange, refresh: refresh, forget: forget };
})();
