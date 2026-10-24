/* su-perf.js — 介護ツール共通 ── 「どこで待たされているか」を端末ごとに記録する（2026-09-24 新設・統合 Phase 0）
 *
 * なぜ要るか:
 *   「開くのが遅い・切り替えが遅い・保存が遅い」の原因が、画面ファイルの読み込みなのか、
 *   GAS との通信なのか、端末の処理なのかを、推測でなく実測で切り分けるため。
 *   Supabase へ移す順番と、移した後に本当に速くなったかの比較もこの記録で行う。
 *
 * ここでやるのは【ブラウザが自動で取っている時刻を読んで残すだけ】。
 *   fetch を横取りしない・画面に何も出さない・待たせない。読み込むだけで有効になり、
 *   読み込めなくても各ツールの動きは何も変わらない。
 *
 * 個人情報を残さない:
 *   残すのはアプリのファイル名・時間・回数・端末の種類（iPad/Android/Windows 等）と、
 *   GAS の接続先を見分けるための URL 末尾4文字だけ。氏名・記録・合言葉・URL の全体・
 *   クエリ文字列は一切残さない（通信の中身はそもそも読めない）。
 *   Supabase は呼んだ関数の名前（kv_get・token 等の URL の最後の区切り）だけ、同じサイトの通信は
 *   JSON のファイル名（su-backend.json 等）だけを残す（2026-10-17。どちらもクエリと鍵は残さない）。
 *
 * 見えている時／裏にある時（2026-10-24・記録の版 3）:
 *   画面が裏にあった時間帯（ほかのタブ・アプリに切り替えていた間）を visibilitychange で控え、
 *   通信の開始時刻がその時間帯に入るかで「見えている時」「裏にある時」に分けて、画面を閉じるまでの合計を数える
 *   （GAS・Supabase・同じサイトの JSON・CDN 等ごとの回数と ms、JSON はファイル名ごとの回数も）。
 *   GAS の呼び出しの種類は、GET なら URL のクエリの action の値だけを読み、POST ならデータ層（su-data-gas.js）が
 *   送る直前に付ける印（performance.mark 'su:gas:<action>'）を数える。英数字と _ の24字までの名前だけを残し、
 *   合わない名前は「その他」。ほかのクエリ・URL の全体は残さない。起動20秒の明細は今までどおり。
 *
 * 残す場所:
 *   IndexedDB（su_perf）。localStorage は容量の上限に近いツールがあり（週間計画の世代の控え等）、
 *   ここで食うと本業の保存が失敗しうるため使わない。新しい方から 1500 件まで。
 *
 * 見る場所: perf-report.html（端末ごとに集計・コピー・CSV）。
 * 止める: localStorage に su_perf_off = '1' を入れる（その端末だけ記録しない）。
 *
 * ツール側からの追加（任意）:
 *   window.SUPerf.ready() … 「画面が使えるようになった」時に呼ぶと、開いてからの時間を残す（最初の1回だけ）。
 *   2026-10-17 から8画面（週間計画・入居者マスタ・フェイスシート・申送ビューア・体重・通所利用表・
 *   ワークスケジュール・シフト作成）が呼ぶ。2026-10-24 からメニュー・入居調整・接続設定・貼り薬カレンダー・
 *   週間計画俯瞰も、最初の画面を描いた直後に呼ぶ。
 */
(function () {
  'use strict';
  if (window.SUPerf) return;                      /* 二重読み込み対策 */
  var noop = { ready: function () {} };
  try {
    if (localStorage.getItem('su_perf_off') === '1') { window.SUPerf = noop; return; }
  } catch (e) { /* localStorage が使えなくても記録は続ける */ }
  if (!window.performance || !performance.getEntriesByType || !window.indexedDB) {
    window.SUPerf = noop; return;
  }

  var DB = 'su_perf', STORE = 'views', KEEP = 1500;
  var STARTUP_MS = 20000;                         /* 開いてから20秒以内に始まった通信＝「起動時の通信」 */
  var FIRST_SAVE_MS = 25000;                      /* 起動時の通信が出そろう頃に一度保存する */
  var MAX_LIST = 40;                              /* 1画面あたりに細かく残す通信の上限 */

  var t0 = Date.now() - Math.round(performance.now());
  var rec = {
    id: String(t0) + '-' + Math.random().toString(36).slice(2, 8),
    t: t0,
    app: appName(),
    dev: deviceKind(),
    role: role(),
    conn: conn(),
    ready: null,
    tbt: null,
    v: 3,                                         /* 記録の版（2＝Supabase・JSON も数える・2026-10-17／3＝見えている時・裏にある時も数える・2026-10-24） */
    gasN: 0, gasMs: 0, gas: [],                   /* GAS: 起動時の分だけ明細、合計は画面を閉じるまで */
    sbN: 0, sbMs: 0, sb: [],                      /* Supabase: 同上 */
    jsonN: 0, jsonMs: 0, json: [],                /* 同じサイトの JSON（su-backend.json 等）: 同上 */
    ext: [],                                      /* CDN 等の外部ファイル（起動時のみ） */
    /* 画面を閉じるまでの合計を、見えている時（vN・vMs）／裏にある時（hN・hMs）に分けて（2026-10-24） */
    vis: { gas: visTotal(), sb: visTotal(), json: visTotal(), ext: visTotal() },
    gasAct: [],                                   /* GAS の種類ごとの回数 [{a: 種類, v: 見えている時, h: 裏にある時}] */
    jsonF: []                                     /* 同じサイトの JSON のファイルごとの回数 [{f: ファイル名, v, h}] */
  };
  var seen = {};                                  /* 同じ entry を二重に数えない */
  var tbt = 0, hasLongTask = false;
  var MAX_KIND = 30;                              /* 種類・ファイルを数え分ける上限（超えた分は「その他」へまとめる） */

  /* PERF_PURE_BEGIN 純関数（check/unit/su_perf_visibility_test.js が印の間を切り出して試す） */
  function visTotal() { return { vN: 0, vMs: 0, hN: 0, hMs: 0 }; }
  /* t（performance.now() の目盛り）が裏にあった時間帯 [始まり, 終わり) のどれかに入るか。終わりが null＝今も裏 */
  function inHidden(spans, t) {
    if (typeof t !== 'number' || !isFinite(t)) return false;
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (t >= sp[0] && (sp[1] == null || t < sp[1])) return true;
    }
    return false;
  }
  /* GAS の種類の名前。英数字と _ の24字までだけを残し、合わなければ「その他」 */
  function actName(a) { return (typeof a === 'string' && /^[A-Za-z0-9_]{1,24}$/.test(a)) ? a : 'その他'; }
  /* GET の GAS の URL から、クエリの action の値だけを取り出す。action が無ければ null（POST は印で数える）。
     ほかのクエリ（合言葉など）は読まない・残さない */
  function gasActionFromUrl(url) {
    var q = String(url).split('#')[0];
    var at = q.indexOf('?');
    if (at < 0) return null;
    var ps = q.slice(at + 1).split('&');
    for (var i = 0; i < ps.length; i++) {
      var eq = ps[i].indexOf('=');
      if ((eq < 0 ? ps[i] : ps[i].slice(0, eq)) !== 'action') continue;
      var val = eq < 0 ? '' : ps[i].slice(eq + 1);
      try { val = decodeURIComponent(val.replace(/\+/g, ' ')); } catch (e) { val = ''; }
      return actName(val);
    }
    return null;
  }
  /* データ層が GAS へ送る直前に付ける印（'su:gas:<action>'）から種類を取り出す。印でなければ null */
  function gasActionFromMark(name) {
    if (typeof name !== 'string' || name.indexOf('su:gas:') !== 0) return null;
    return actName(name.slice(7));
  }
  /* 種類・ファイルの一覧 list（[{<key>: 名前, v, h}]）の name を1つ数える。上限を超えた新しい名前は「その他」へ */
  function bumpKind(list, key, name, hidden, max) {
    var hit = null, i;
    for (i = 0; i < list.length; i++) if (list[i][key] === name) { hit = list[i]; break; }
    if (!hit && list.length >= max && name !== 'その他') {
      name = 'その他';
      for (i = 0; i < list.length; i++) if (list[i][key] === name) { hit = list[i]; break; }
    }
    if (!hit) { hit = { v: 0, h: 0 }; hit[key] = name; list.push(hit); }
    if (hidden) hit.h++; else hit.v++;
  }
  /* PERF_PURE_END */

  /* 画面が裏にあった時間帯 [始まり, 終わり]（performance.now() の目盛り）。開いた時に裏なら 0 から裏とみなす。
     時間帯そのものは記録に残さない（回数と ms を分けるのに使うだけ） */
  var hiddenSpans = [];
  try { if (document.visibilityState === 'hidden') hiddenSpans.push([0, null]); } catch (e) {}
  function noteVisibility() {
    try {
      var now = performance.now(), last = hiddenSpans[hiddenSpans.length - 1];
      if (document.visibilityState === 'hidden') { if (!last || last[1] != null) hiddenSpans.push([now, null]); }
      else if (last && last[1] == null) last[1] = now;
    } catch (e) {}
  }
  /* 合計を見えている時／裏にある時に分けて数える。裏で数えた時は早めに保存する
     （裏のタブは、閉じる時の保存が走らないまま端末に捨てられることがあるため） */
  function countVis(cat, startTime, ms) {
    var hid = inHidden(hiddenSpans, startTime), o = rec.vis[cat];
    if (hid) { o.hN++; o.hMs += ms; } else { o.vN++; o.vMs += ms; }
    try { if (hid || document.visibilityState === 'hidden') saveSoon(); } catch (e) {}
    return hid;
  }

  function appName() {
    try {
      var p = location.pathname.split('/').pop() || 'index.html';
      return p.slice(0, 60);
    } catch (e) { return '?'; }
  }
  function role() {
    try { return localStorage.getItem('su_device_role') === 'field' ? 'field' : 'office'; }
    catch (e) { return '?'; }
  }
  function deviceKind() {
    try {
      var ua = navigator.userAgent || '';
      /* iPadOS 13 以降の Safari は Mac を名乗るので、タッチ点数で見分ける */
      if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
      if (/iPhone/.test(ua)) return 'iPhone';
      if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android(スマホ)' : 'Android(タブレット)';
      if (/Windows/.test(ua)) return 'Windows';
      if (/Macintosh/.test(ua)) return 'Mac';
      if (/CrOS/.test(ua)) return 'Chromebook';
    } catch (e) {}
    return 'その他';
  }
  function conn() {
    try { var c = navigator.connection; return c && c.effectiveType ? String(c.effectiveType) : ''; }
    catch (e) { return ''; }
  }
  function r(n) { return typeof n === 'number' && isFinite(n) ? Math.round(n) : null; }

  /* GAS の接続先を見分ける短い印。URL 全体は残さない（/macros/s/<配備ID>/exec の末尾4文字）。 */
  function gasLabel(url) {
    try {
      var m = /\/macros\/s\/([^/]+)\//.exec(url);
      if (m) return '…' + m[1].slice(-4);
      if (/googleusercontent\.com/.test(url)) return '転送先';
    } catch (e) {}
    return '?';
  }
  function isGas(url) { return /^https:\/\/script\.(google|googleusercontent)\.com\//.test(url); }
  function isSupabase(url) { return /^https:\/\/[a-z0-9-]+\.supabase\.co\//.test(url); }
  /* クエリ（? 以降）と # 以降を落とした URL */
  function noQuery(url) { return String(url).split('#')[0].split('?')[0]; }
  function isSameOriginJson(url) {
    try { return url.indexOf(location.origin) === 0 && /\.json$/i.test(noQuery(url)); } catch (e) { return false; }
  }
  /* Supabase の呼び先の印＝パスの最後の空でない区切り（例 kv_get・token・user）。URL 全体・クエリ・鍵は残さない */
  function sbLabel(url) {
    try {
      var parts = new URL(url).pathname.split('/');
      for (var i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i].slice(0, 24);
    } catch (e) {}
    return '?';
  }
  /* 同じサイトの JSON の印＝ファイル名だけ（フォルダとクエリは残さない） */
  function jsonLabel(url) {
    try { return noQuery(url).split('/').pop().slice(0, 40) || '?'; } catch (e) { return '?'; }
  }

  function takeResource(e) {
    try {
      var key = e.name + '|' + e.startTime;
      if (seen[key]) return;
      seen[key] = 1;
      var cross = e.name.indexOf(location.origin) !== 0;
      if (!cross) {                               /* 同じサイトのファイルは navigation 側で見る。JSON の読み込みだけ数える */
        if (!isSameOriginJson(e.name)) return;
        rec.jsonN++;
        rec.jsonMs += r(e.duration) || 0;
        var jh = countVis('json', e.startTime, r(e.duration) || 0);
        bumpKind(rec.jsonF, 'f', jsonLabel(e.name), jh, MAX_KIND);
        if (e.startTime <= STARTUP_MS && rec.json.length < MAX_LIST) {
          rec.json.push({ s: r(e.startTime), d: r(e.duration), f: jsonLabel(e.name) });
          saveSoon();
        }
        return;
      }
      if (isGas(e.name)) {
        rec.gasN++;
        rec.gasMs += r(e.duration) || 0;
        var gh = countVis('gas', e.startTime, r(e.duration) || 0);
        var act = gasActionFromUrl(e.name);   /* GET の action だけ。無い＝POST は印（takeMark）で数える */
        if (act != null) bumpKind(rec.gasAct, 'a', act, gh, MAX_KIND);
        if (e.startTime <= STARTUP_MS && rec.gas.length < MAX_LIST) {
          rec.gas.push({ s: r(e.startTime), d: r(e.duration), ep: gasLabel(e.name) });
          saveSoon();
        }
      } else if (isSupabase(e.name)) {
        rec.sbN++;
        rec.sbMs += r(e.duration) || 0;
        countVis('sb', e.startTime, r(e.duration) || 0);
        if (e.startTime <= STARTUP_MS && rec.sb.length < MAX_LIST) {
          rec.sb.push({ s: r(e.startTime), d: r(e.duration), ep: sbLabel(e.name) });
          saveSoon();
        }
      } else {
        countVis('ext', e.startTime, r(e.duration) || 0);
        if (e.startTime <= STARTUP_MS && rec.ext.length < 10) {
          var host = '';
          try { host = new URL(e.name).host; } catch (e2) {}
          rec.ext.push({ h: host.slice(0, 40), d: r(e.duration), kb: r((e.transferSize || 0) / 1024) });
        }
      }
    } catch (err) {}
  }

  function takeNavigation() {
    try {
      var n = performance.getEntriesByType('navigation')[0];
      if (!n) return;
      rec.nav = n.type || '';
      rec.htmlKB = r((n.decodedBodySize || 0) / 1024);
      /* 画面ファイルを毎回取り直しているか: 0＝端末のキャッシュ、小さい＝変わっていない確認だけ（304）、
         本体の大きさ程度＝丸ごと取り直し。Safari は transferSize を返さないので空のままにする。 */
      if (typeof n.transferSize === 'number' && n.decodedBodySize) {
        rec.xfer = n.transferSize === 0 ? 'cache' : (n.transferSize < 2048 ? '304' : 'full');
      }
      rec.ttfb = r(n.responseStart);
      rec.dcl = r(n.domContentLoadedEventEnd) || null;
      rec.load = r(n.loadEventEnd) || null;
    } catch (e) {}
  }

  /* 起動時の同期が終わった時刻＝起動時に始まった GAS 通信の最後の終わり */
  function lastEnd(list) {
    var last = 0;
    for (var i = 0; i < list.length; i++) {
      var end = list[i].s + list[i].d;
      if (end > last) last = end;
    }
    return last;
  }
  function finishStats() {
    try {
      rec.gasDone = rec.gas.length ? lastEnd(rec.gas) : null;
      /* 起動時の通信（GAS・Supabase・JSON）すべての最後の終わり（2026-10-17） */
      rec.netDone = (rec.gas.length || rec.sb.length || rec.json.length)
        ? Math.max(lastEnd(rec.gas), lastEnd(rec.sb), lastEnd(rec.json)) : null;
      rec.tbt = hasLongTask ? r(tbt) : null;
    } catch (e) {}
  }

  /* ── IndexedDB ── */
  var dbp = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
    return dbp;
  }
  var pruned = false;
  function save() {
    try {
      takeNavigation();
      pollResources();
      pollMarks();
      finishStats();
      var copy = JSON.parse(JSON.stringify(rec));
      openDb().then(function (db) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        st.put(copy);
        if (!pruned) {                          /* 1画面につき1回だけ古い分を詰める */
          pruned = true;
          var cr = st.count();
          cr.onsuccess = function () {
            var over = cr.result - KEEP;
            if (over <= 0) return;
            st.openCursor().onsuccess = function (ev) {   /* id は時刻始まり＝古い順 */
              var c = ev.target.result;
              if (!c || over <= 0) return;
              c['delete'](); over--; c['continue']();
            };
          };
        }
      })['catch'](function () {});
    } catch (e) {}
  }

  function pollResources() {
    try {
      var list = performance.getEntriesByType('resource');
      for (var i = 0; i < list.length; i++) {
        var it = list[i].initiatorType;
        if (it === 'fetch' || it === 'xmlhttprequest' || it === 'script' || it === 'link' || it === 'css') takeResource(list[i]);
      }
    } catch (e) {}
  }

  /* GAS の種類の印（データ層が POST の直前に付ける 'su:gas:<action>'）を数える。印は消さない（ほかの処理の状態に触らない） */
  function takeMark(m) {
    try {
      var act = gasActionFromMark(m.name);
      if (act == null) return;
      var key = 'mark|' + m.name + '|' + m.startTime;
      if (seen[key]) return;
      seen[key] = 1;
      var hid = inHidden(hiddenSpans, m.startTime);
      bumpKind(rec.gasAct, 'a', act, hid, MAX_KIND);
      try { if (hid || document.visibilityState === 'hidden') saveSoon(); } catch (e2) {}
    } catch (e) {}
  }
  function pollMarks() {
    try {
      var list = performance.getEntriesByType('mark');
      for (var i = 0; i < list.length; i++) takeMark(list[i]);
    } catch (e) {}
  }

  /* 取りこぼし防止: バッファ（既定250件）が埋まった後の通信も数えるため、届いた時点で拾う */
  try {
    if (window.PerformanceObserver) {
      new PerformanceObserver(function (l) {
        var es = l.getEntries();
        for (var i = 0; i < es.length; i++) takeResource(es[i]);
      }).observe({ type: 'resource', buffered: true });
    }
  } catch (e) {}
  /* GAS の種類の印も届いた時点で拾う（保存の時にも pollMarks で拾い直す。二重には数えない） */
  try {
    if (window.PerformanceObserver && (!PerformanceObserver.supportedEntryTypes ||
        PerformanceObserver.supportedEntryTypes.indexOf('mark') >= 0)) {
      new PerformanceObserver(function (l) {
        var es = l.getEntries();
        for (var i = 0; i < es.length; i++) takeMark(es[i]);
      }).observe({ type: 'mark', buffered: true });
    }
  } catch (e) {}
  /* 端末の処理で固まった時間（50ms を超えた分の合計）。Chrome 系だけが対応。 */
  try {
    if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes &&
        PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0) {
      hasLongTask = true;
      new PerformanceObserver(function (l) {
        var es = l.getEntries();
        for (var i = 0; i < es.length; i++) {
          if (es[i].startTime <= STARTUP_MS && es[i].duration > 50) tbt += es[i].duration - 50;
        }
      }).observe({ type: 'longtask', buffered: true });
    }
  } catch (e) {}

  /* 保存の時機: 閉じる瞬間の保存は、すぐ別の画面へ移ると書き終わる前に打ち切られることがある。
     そのため「開き終わった直後」「起動時の通信が1本終わるたび（1.5秒まとめ）」「25秒後」にも保存し、
     同じ id へ上書きしていく（どこで閉じられても、そこまでの記録は残る）。 */
  var firstTimer = null, soonTimer = null;
  function saveSoon() {
    clearTimeout(soonTimer);
    soonTimer = setTimeout(save, 1500);
  }
  function arm() {
    if (firstTimer) return;
    saveSoon();
    firstTimer = setTimeout(save, FIRST_SAVE_MS);
  }
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () {
    noteVisibility();                             /* 裏にあった時間帯の控えを先に更新してから保存する（2026-10-24） */
    if (document.visibilityState === 'hidden') save();
  });

  window.SUPerf = {
    ready: function () {
      try { if (rec.ready == null) rec.ready = r(performance.now()); } catch (e) {}
    }
  };
})();
