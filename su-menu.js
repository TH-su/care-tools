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
 *   { ver:1, order:{区分id:[ボタンの鍵…]}, hide:{admin|office|field:[ボタンの鍵…]}, secs:[区分id…],
 *     sdef:{区分id:{mk, title}}, gone:[区分id…], mv:{ボタンの鍵:区分id}, ball:'asanoha' }
 *     ← sdef・gone・mv は 0023（2026-10-26 本人指示）。ball は 0025（施設の既定の毬の柄・2026-10-26 代表者の決定）
 *   ボタンの鍵はリンク先（href）。設定に無いボタン（後から足したもの）は既定の位置関係のまま末尾・全員に出す。
 *   sdef  最初からある区分の名前・絵文字の上書き、または管理者が作った区分（id がページの定義に無いもの）
 *   gone  消した最初からある区分。中にボタンが残る時（後から足したボタン・移し先が消えた等）は消さずに出す＝ボタンを失わない
 *   mv    既定と違う区分へ移したボタン。移し先が無い・消した区分なら既定の区分に出す。
 *         事務所専用の区分（officeOnly）から移したボタンは、移した先でも事務所専用のまま（現場端末で出さない仕組みを外さない）
 *   設定に無い区分（後から足した区分）は、既定で前にある区分の直後に置く（末尾に回さない）。
 *   ball  施設の既定の毬の柄。'asanoha' の時だけ書く（無い＝菊かがり）。'kiku' やほかの値は捨てる
 *
 * 毬の柄（2026-10-26 代表者の決定）:
 *   ★端末に書いてよいのは鍵 su_menu_ball だけ、値は 'kiku'・'asanoha' だけ。書くのはここの setBall だけ（メニューの画面は書かない）。
 *   柄の決め方: 端末の選択 → 施設の既定（ログインして読めた設定の控えだけ）→ 菊かがり。
 *   選んだ柄が施設の既定と同じ時は鍵を消す（端末の選択を解いて、施設の既定に従う状態に戻す）。
 *
 * 使い方:
 *   SUMenu.arrange(def, config, role) → 並べ替え・非表示を当てた定義（元の def は変えない）。純関数（check/unit/menu_arrange_test.js）
 *   SUMenu.layout(def, cleaned)        → 非表示を当てる前の区分とボタンの配置（メニューの設定の画面が使う）。空の区分も残す
 *   SUMenu.readCache()                → 端末の控え {role, config} か null
 *   SUMenu.startSync(onChange)        → ページの読み込みが終わってから設定を読み、控えと違えば onChange(config, role) を呼ぶ
 *   SUMenu.ball()                     → 今の毬の柄 'kiku' | 'asanoha'（端末の選択 → 施設の既定 → 菊かがり）
 *   SUMenu.getBall() / setBall(kind)  → 端末の選択（無い・壊れている時は null）／端末の選択を残す（成功で true）
 *   SUMenu.chooseBall(device, config) → 柄の決め方の純関数（config は clean() を通したもの）
 *   SUMenu.hasLogin() / loadAuth()    → この端末にログインの記録があるか／ログインの部品を読み込む（二重に入れない）。
 *                                       写しが止まっている時の札（su-sync-stale.js）が使う（2026-10-26 本人指示）
 */
(function () {
  'use strict';
  if (window.SUMenu) return;

  var CACHE_KEY = 'su_menu_v1';
  var BALL_KEY = 'su_menu_ball';
  var BALLS = ['kiku', 'asanoha'];
  var ROLES = ['admin', 'office', 'field'];
  var KEY_RE = /^[A-Za-z0-9_.:\/?=&#%~-]{1,200}$/;
  var SEC_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var CTRL_RE = /[\u0000-\u001f\u007f-\u009f]/;
  // 隠せないボタン（全部を隠してもメニューが空にならないよう、困った時の入口だけは必ず残す）
  var KEEP = { 'help.html': 1 };
  // ログインの部品。各画面が読む時と同じ版を書く（su-auth.js を直して ?v= を上げたら、ここも上げる・su-report.js と同じ）
  var AUTH_SRC = ['supabase-js-2.112.4.js', 'su-auth.js?v=2026-10-28'];

  function strArr(a, re) {
    if (!Array.isArray(a)) return null;
    for (var i = 0; i < a.length; i++) if (typeof a[i] !== 'string' || !re.test(a[i])) return null;
    return a;
  }

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  /* 名前・絵文字の字数はコードポイントで数える（データベースの char_length と同じ。ふつうの絵文字は1字、肌色つき・結合の絵文字は数字になる）。
     制御文字の範囲もデータベース（0023）と同じ U+0000〜001F・U+007F〜009F */
  function textOk(t, min, max) {
    if (typeof t !== 'string' || CTRL_RE.test(t)) return false;
    var n = Array.from(t).length;
    return n >= min && n <= max;
  }
  function copy(o) { var n = {}; Object.keys(o).forEach(function (k) { n[k] = o[k]; }); return n; }

  /* 形の合わない設定は「設定なし」として扱う（壊れた設定でメニューが出なくなるのを防ぐ）。データベースの検査と同じ規則 */
  function clean(cfg) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || cfg.ver !== 1) return null;
    var out = { ver: 1, order: {}, hide: {}, secs: null, sdef: {}, gone: [], mv: {} };
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
    // 0023 のキーは1件ずつ確かめ、形の違う1件だけを捨てる（ほかの並び・非表示は効かせる）
    if (isObj(cfg.sdef)) Object.keys(cfg.sdef).forEach(function (k) {
      var v = cfg.sdef[k];
      if (SEC_RE.test(k) && isObj(v) && textOk(v.title, 1, 20) && textOk(v.mk, 0, 8)) out.sdef[k] = { mk: v.mk, title: v.title };
    });
    out.gone = strArr(cfg.gone, SEC_RE) || [];
    if (isObj(cfg.mv)) Object.keys(cfg.mv).forEach(function (k) {
      if (KEY_RE.test(k) && typeof cfg.mv[k] === 'string' && SEC_RE.test(cfg.mv[k])) out.mv[k] = cfg.mv[k];
    });
    // 0025 の施設の既定の毬の柄。'asanoha' の時だけ持つ（'kiku'・ほかの値は捨てる＝無い時は菊かがり）
    if (cfg.ball === 'asanoha') out.ball = 'asanoha';
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

  /* 区分の並び: 先に list の順。list に無い区分（後から足したもの）は、既定で前にある区分の直後へ置く
     （例: 入居者の直後に足した区分は、前の定義で保存した並びでも入居者の直後に出る） */
  function reorderAnchored(items, keyOf, list) {
    var out = reorder(items.filter(function (it) { var k = keyOf(it); return k != null && list.indexOf(k) >= 0; }), keyOf, list);
    var prev = null;
    items.forEach(function (it) {
      if (out.indexOf(it) >= 0) { prev = it; return; }
      out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, it);
      prev = it;
    });
    return out;
  }

  function hrefOf(t) { return t && typeof t.href === 'string' ? t.href : null; }

  /* 非表示を当てる前の配置。cfg は clean() を通したもの */
  function layout(def, cfg) {
    var gone = {};
    cfg.gone.forEach(function (id) { gone[id] = 1; });
    var defIds = {};
    var shells = def.sections.map(function (s) {
      if (!s || typeof s.id !== 'string' || !Array.isArray(s.tiles)) return s;   // 壊れた区分はそのまま（組み立ての側で数える）
      defIds[s.id] = 1;
      var ns = copy(s);
      var d = cfg.sdef[s.id];
      if (d) { ns.mk = d.mk; ns.title = d.title; }
      ns.tiles = [];
      return ns;
    });
    Object.keys(cfg.sdef).forEach(function (id) {
      if (defIds[id] || gone[id]) return;
      shells.push({ id: id, mk: cfg.sdef[id].mk, title: cfg.sdef[id].title, tiles: [], custom: true });
    });
    var byId = {};
    shells.forEach(function (s, i) { if (s && s !== def.sections[i] && !(s.id in byId)) byId[s.id] = s; });
    var moved = [];   // 既定と違う区分へ移すボタン（既定の区分のボタンを先に並べ、移してきたボタンはその後ろ）
    def.sections.forEach(function (s, i) {
      var home = shells[i];
      if (home === s) return;
      s.tiles.forEach(function (t) {
        var h = hrefOf(t), to = h != null ? cfg.mv[h] : null;
        var dest = (to && byId[to] && !gone[to]) ? byId[to] : home;
        // 隠せないボタン（使い方・困った時）は事務所専用の区分へ移さない（現場端末から消えないように）
        if (dest !== home && KEEP[h] && dest.officeOnly) dest = home;
        if (dest === home) { home.tiles.push(t); return; }
        if (s.officeOnly && t && !t.officeOnly) { t = copy(t); t.officeOnly = true; }
        moved.push([dest, t]);
      });
    });
    moved.forEach(function (m) { m[0].tiles.push(m[1]); });
    var out = [];
    shells.forEach(function (ns, i) {
      if (!ns || !Array.isArray(ns.tiles) || ns === def.sections[i]) { out.push(ns); return; }
      if (gone[ns.id] && !ns.tiles.length) return;   // 消した区分は、ボタンが残っていなければ出さない
      var orig = i < def.sections.length ? def.sections[i].tiles : [];
      var tiles = reorder(ns.tiles, hrefOf, cfg.order[ns.id]);
      // 並びを変えた区分・ボタンが出入りした区分では「新しい行から始める（newrow）」を効かせない（指定のペアの行割りは既定の並びにだけ意味がある）
      var changed = tiles.length !== orig.length || tiles.some(function (t, j) { return t !== orig[j]; });
      ns.tiles = !changed ? tiles : tiles.map(function (t) {
        if (!t || !t.newrow) return t;
        var nt = copy(t); delete nt.newrow; return nt;
      });
      out.push(ns);
    });
    return cfg.secs ? reorderAnchored(out, function (s) { return s && typeof s.id === 'string' ? s.id : null; }, cfg.secs) : out;
  }

  function arrange(def, config, role) {
    if (!def || typeof def !== 'object' || !Array.isArray(def.sections)) return def;
    var cfg = clean(config);
    if (!cfg) return def;
    var hide = {};
    if (ROLES.indexOf(role) >= 0) (cfg.hide[role] || []).forEach(function (k) { if (!KEEP[k]) hide[k] = 1; });
    var out = copy(def);
    out.sections = layout(def, cfg).map(function (s) {
      if (!s || !Array.isArray(s.tiles)) return s;
      var ns = copy(s);
      ns.tiles = s.tiles.filter(function (t) { return !(t && hide[t.href]); });
      return ns;
    });
    return out;
  }

  /* 控えはログインの記録がある時だけ使う（ログアウトした端末で前の人の並びを出さない）。
     ログアウト・ログインのし直しでは login.js が控えを消す（SUMenu.clearCache）。 */
  function readCache() {
    if (!hasLogin()) return null;
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
          // 42501＝使えない人。PGRST202（関数が無い＝移行 0020 を戻した・まだ流していない）も「設定なし」として既定に戻す
          // （控えを残すと、戻した後も前に隠した並びのまま固まるため・2026-10-23 反証レビュー）
          if (r.error) return { kind: (r.error.code === '42501' || r.error.code === 'PGRST202') ? 'out' : 'error' };
          var d = r.data;
          if (!d || d.ok !== true || ROLES.indexOf(d.role) < 0) return { kind: 'error' };
          return { kind: 'ok', role: d.role, config: clean(d.config) };
        });
      });
    });
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ── 毬の柄（2026-10-26 代表者の決定）── */
  function chooseBall(device, config) {
    if (BALLS.indexOf(device) >= 0) return device;
    return (config && typeof config === 'object' && config.ball === 'asanoha') ? 'asanoha' : 'kiku';
  }
  function getBall() {
    try { var v = localStorage.getItem(BALL_KEY); return BALLS.indexOf(v) >= 0 ? v : null; } catch (e) { return null; }
  }
  /* 施設の既定（ログインして読めた設定の控えだけ。ログインしていない端末は菊かがり） */
  function cachedConfig() {
    try { var c = readCache(); return c && c.config; } catch (e) { return null; }
  }
  function ball() { return chooseBall(getBall(), cachedConfig()); }
  function setBall(kind) {
    if (BALLS.indexOf(kind) < 0) return false;
    try {
      // 鍵を消すのは施設の既定が分かっている時だけ（ログイン直後・電波が無い間は控えが無く、既定を菊かがりと決めつけると最後に選んだ柄が残らない）
      var c = cachedConfig();
      if (c && kind === chooseBall(null, c)) localStorage.removeItem(BALL_KEY);
      else localStorage.setItem(BALL_KEY, kind);
      return true;
    } catch (e) { return false; }
  }

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
    // 「戻る」でそのまま戻った時（bfcache）は load が来ないので、その時だけ読み直す（ログアウトの後に戻った時に前の並びを残さない）
    window.addEventListener('pageshow', function (e) { if (e.persisted) run(); });
  }

  window.SUMenu = { arrange: arrange, layout: layout, clean: clean, readCache: readCache, clearCache: clearCache, startSync: startSync, ROLES: ROLES, KEEP: KEEP,
    ball: ball, getBall: getBall, setBall: setBall, chooseBall: chooseBall, BALLS: BALLS.slice(),
    // 写しが止まっている時の札（su-sync-stale.js・2026-10-26 本人指示）が、同じログインの部品を二重に読み込まないために使う
    hasLogin: hasLogin, loadAuth: loadAuth };
})();
