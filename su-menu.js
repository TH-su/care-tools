/*
 * su-menu.js — 介護ツール メニューの「役割ごとの表示・並び」（2026-10-23 代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * 目的: メニュー（index.html）のボタンを、ログインした人の役割（管理者・事務所・現場）と、
 *       管理者が「メニューの設定」（menu-settings.html）で決めた並び・非表示に合わせて出す。
 *
 * ★これは入口の整理であって守りではない。ボタンを隠しても各アプリの中身は守られない（守りは各アプリとデータベースの RLS）。
 * ★読むのは「役割」と「ボタンの並び・非表示（リンク先と区分 id だけ）」だけ。氏名・記録・合言葉は読まない・持たない。
 * ★端末の控え（localStorage の su_menu_v1）は {role, config, at} だけ。次に開いた時、通信を待たずに同じ並びで出すため
 *   （タイルが一瞬出てから消える「ちらつき」を防ぐ）。
 * ★読み込めなくても動く・例外を外に出さない。設定が読めない時は、控え→ページの中の既定の定義の順に倒す。
 * ★ログインの記録がこの端末に無ければ、ログインの部品（supabase-js）も読み込まない（重い部品を待たせない）。
 *
 * 設定（config）の形（共通 DB 0020 menu_settings と同じ）:
 *   { ver:1, order:{区分id:[ボタンの鍵…]}, hide:{admin|office|field:[ボタンの鍵…]}, secs:[区分id…] }
 *   ボタンの鍵はリンク先（href）。設定に無いボタン（後から足したもの）は既定の位置関係のまま末尾・全員に出す。
 *
 * 使い方:
 *   SUMenu.arrange(def, config, role) → 並べ替え・非表示を当てた定義（元の def は変えない）。純関数（check/unit/menu_arrange_test.js）
 *   SUMenu.readCache()                → 端末の控え {role, config} か null
 *   SUMenu.startSync(onChange)        → ページの読み込みが終わってから設定を読み、控えと違えば onChange(config, role) を呼ぶ
 */
(function () {
  'use strict';
  if (window.SUMenu) return;

  var CACHE_KEY = 'su_menu_v1';
  var ROLES = ['admin', 'office', 'field'];
  var KEY_RE = /^[A-Za-z0-9_.:\/?=&#%~-]{1,200}$/;
  var SEC_RE = /^[A-Za-z0-9_-]{1,40}$/;
  // 隠せないボタン（全部を隠してもメニューが空にならないよう、困った時の入口だけは必ず残す）
  var KEEP = { 'help.html': 1 };
  // ログインの部品。各画面が読む時と同じ版を書く（su-auth.js を直して ?v= を上げたら、ここも上げる・su-report.js と同じ）
  var AUTH_SRC = ['supabase-js-2.112.4.js', 'su-auth.js?v=2026-10-20'];

  function strArr(a, re) {
    if (!Array.isArray(a)) return null;
    for (var i = 0; i < a.length; i++) if (typeof a[i] !== 'string' || !re.test(a[i])) return null;
    return a;
  }

  /* 形の合わない設定は「設定なし」として扱う（壊れた設定でメニューが出なくなるのを防ぐ）。データベースの検査と同じ規則 */
  function clean(cfg) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || cfg.ver !== 1) return null;
    var out = { ver: 1, order: {}, hide: {}, secs: null };
    if (cfg.order && typeof cfg.order === 'object' && !Array.isArray(cfg.order)) {
      Object.keys(cfg.order).forEach(function (k) {
        var a = SEC_RE.test(k) ? strArr(cfg.order[k], KEY_RE) : null;
        if (a) out.order[k] = a;
      });
    }
    if (cfg.hide && typeof cfg.hide === 'object' && !Array.isArray(cfg.hide)) {
      ROLES.forEach(function (r) { var a = strArr(cfg.hide[r], KEY_RE); if (a) out.hide[r] = a; });
    }
    out.secs = strArr(cfg.secs, SEC_RE);
    return out;
  }

  /* 並べ替え: 先に list の順（重複・存在しないものは飛ばす）、残りは元の順のまま後ろへ */
  function reorder(items, keyOf, list) {
    if (!list) return items.slice();
    var byKey = {}, used = {}, out = [];
    items.forEach(function (it) { var k = keyOf(it); if (k != null && !(k in byKey)) byKey[k] = it; });
    list.forEach(function (k) { if (byKey.hasOwnProperty(k) && !used[k]) { used[k] = 1; out.push(byKey[k]); } });
    items.forEach(function (it) { if (out.indexOf(it) < 0) out.push(it); });
    return out;
  }

  function arrange(def, config, role) {
    if (!def || typeof def !== 'object' || !Array.isArray(def.sections)) return def;
    var cfg = clean(config);
    if (!cfg) return def;
    var hide = {};
    if (ROLES.indexOf(role) >= 0) (cfg.hide[role] || []).forEach(function (k) { if (!KEEP[k]) hide[k] = 1; });
    var secs = reorder(def.sections, function (s) { return s && typeof s.id === 'string' ? s.id : null; }, cfg.secs);
    var out = {};
    Object.keys(def).forEach(function (k) { out[k] = def[k]; });
    out.sections = secs.map(function (s) {
      if (!s || !Array.isArray(s.tiles)) return s;
      var tiles = reorder(s.tiles, function (t) { return t && typeof t.href === 'string' ? t.href : null; }, cfg.order[s.id]);
      // 並びを変えた区分では「新しい行から始める（newrow）」を効かせない（指定のペアの行割りは既定の並びにだけ意味がある）
      var moved = tiles.some(function (t, i) { return t !== s.tiles[i]; });
      var ns = {};
      Object.keys(s).forEach(function (k) { ns[k] = s[k]; });
      ns.tiles = tiles.filter(function (t) { return !(t && hide[t.href]); }).map(function (t) {
        if (!moved || !t || !t.newrow) return t;
        var nt = {};
        Object.keys(t).forEach(function (k) { if (k !== 'newrow') nt[k] = t[k]; });
        return nt;
      });
      return ns;
    });
    return out;
  }

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c || typeof c !== 'object' || ROLES.indexOf(c.role) < 0) return null;
      return { role: c.role, config: clean(c.config) };
    } catch (e) { return null; }
  }
  function writeCache(role, config) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ role: role, config: config, at: new Date().toISOString() })); } catch (e) { /* 書けなくても動く */ }
  }
  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* 何もしない */ }
  }

  /* この端末にログインの記録があるか（キーの名前だけを見る。中身は読まない・su-report.js と同じ） */
  function hasLogin() {
    try {
      for (var i = 0; i < localStorage.length; i++) if (/^sb-[a-z0-9]+-auth-token$/.test(localStorage.key(i) || '')) return true;
    } catch (e) { /* 読めなければ無いものとする */ }
    return false;
  }
  function hasTag(name) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) if (String(ss[i].getAttribute('src') || '').split('?')[0].split('/').pop() === name) return true;
    return false;
  }
  function waitFor(test, ms) {
    return new Promise(function (ok, ng) {
      var t0 = Date.now();
      (function poll() { if (test()) ok(); else if (Date.now() - t0 > ms) ng(new Error('待ちきれない')); else setTimeout(poll, 100); })();
    });
  }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { ok(); };
      s.onerror = function () { try { s.remove(); } catch (e) { /* 何もしない */ } ng(new Error('読み込めない: ' + src)); };
      document.head.appendChild(s);
    });
  }
  /* su-report.js が同じ部品を読み込み中なら、2本目を入れずに待つ（su-auth.js を二重に動かさない） */
  function loadAuth() {
    if (window.SUAuth) return Promise.resolve();
    if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
    var lib = window.supabase ? Promise.resolve()
      : (hasTag(AUTH_SRC[0]) ? waitFor(function () { return !!window.supabase; }, 8000) : loadScript(AUTH_SRC[0]));
    return lib.then(function () {
      if (window.SUAuth) return null;
      if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
      return loadScript(AUTH_SRC[1]);
    });
  }

  /* 設定を読む。結果: {kind:'ok', role, config} ／ {kind:'out'}（ログインしていない・使えない人）／ {kind:'error'}（確かめられない） */
  function fetchMenu() {
    if (!hasLogin()) return Promise.resolve({ kind: 'out' });
    return loadAuth().then(function () {
      var c = window.SUAuth.client();
      return c.auth.getSession().then(function (g) {
        if (!(g && g.data && g.data.session)) return { kind: g && g.error ? 'error' : 'out' };
        return c.rpc('menu_get').then(function (r) {
          if (r.error) return { kind: r.error.code === '42501' ? 'out' : 'error' };
          var d = r.data;
          if (!d || d.ok !== true || ROLES.indexOf(d.role) < 0) return { kind: 'error' };
          return { kind: 'ok', role: d.role, config: clean(d.config) };
        });
      });
    });
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function startSync(onChange) {
    if (typeof Promise === 'undefined') return;
    function run() {
      var before = readCache();
      var t = new Promise(function (ok) { setTimeout(function () { ok({ kind: 'error' }); }, 15000); });
      Promise.race([fetchMenu(), t]).catch(function () { return { kind: 'error' }; }).then(function (r) {
        try {
          if (r.kind === 'ok') {
            writeCache(r.role, r.config);
            if (!before || before.role !== r.role || !same(before.config, r.config)) onChange(r.config, r.role);
          } else if (r.kind === 'out') {
            // ログインしていない・使えない人は既定のメニュー（控えも消す＝前の人の並びを残さない）
            clearCache();
            if (before) onChange(null, null);
          }
          // 確かめられない（通信できない・関数がまだ無い）時は、今出している控え（または既定）のまま
        } catch (e) {
          try { if (window.SUErrors) window.SUErrors.report('メニュー', e, 'su-menu.js'); } catch (e2) { /* 何もしない */ }
        }
      });
    }
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run);
  }

  window.SUMenu = { arrange: arrange, clean: clean, readCache: readCache, startSync: startSync, ROLES: ROLES, KEEP: KEEP };
})();
