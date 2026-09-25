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
 *
 * 残す場所:
 *   IndexedDB（su_perf）。localStorage は容量の上限に近いツールがあり（週間計画の世代の控え等）、
 *   ここで食うと本業の保存が失敗しうるため使わない。新しい方から 1500 件まで。
 *
 * 見る場所: perf-report.html（端末ごとに集計・コピー・CSV）。
 * 止める: localStorage に su_perf_off = '1' を入れる（その端末だけ記録しない）。
 *
 * ツール側からの追加（任意・今は誰も呼ばない）:
 *   window.SUPerf.ready() … 「画面が使えるようになった」時に呼ぶと、開いてからの時間を残す。
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
    gasN: 0, gasMs: 0, gas: [],                   /* GAS: 起動時の分だけ明細、合計は画面を閉じるまで */
    ext: []                                       /* CDN 等の外部ファイル（起動時のみ） */
  };
  var seen = {};                                  /* 同じ entry を二重に数えない */
  var tbt = 0, hasLongTask = false;

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

  function takeResource(e) {
    try {
      var key = e.name + '|' + e.startTime;
      if (seen[key]) return;
      seen[key] = 1;
      var cross = e.name.indexOf(location.origin) !== 0;
      if (!cross) return;                         /* 同じサイトのファイルは navigation 側で見る */
      if (isGas(e.name)) {
        rec.gasN++;
        rec.gasMs += r(e.duration) || 0;
        if (e.startTime <= STARTUP_MS && rec.gas.length < MAX_LIST) {
          rec.gas.push({ s: r(e.startTime), d: r(e.duration), ep: gasLabel(e.name) });
          saveSoon();
        }
      } else if (e.startTime <= STARTUP_MS && rec.ext.length < 10) {
        var host = '';
        try { host = new URL(e.name).host; } catch (e2) {}
        rec.ext.push({ h: host.slice(0, 40), d: r(e.duration), kb: r((e.transferSize || 0) / 1024) });
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
  function finishStats() {
    try {
      var last = 0;
      for (var i = 0; i < rec.gas.length; i++) {
        var end = rec.gas[i].s + rec.gas[i].d;
        if (end > last) last = end;
      }
      rec.gasDone = rec.gas.length ? last : null;
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

  /* 取りこぼし防止: バッファ（既定250件）が埋まった後の通信も数えるため、届いた時点で拾う */
  try {
    if (window.PerformanceObserver) {
      new PerformanceObserver(function (l) {
        var es = l.getEntries();
        for (var i = 0; i < es.length; i++) takeResource(es[i]);
      }).observe({ type: 'resource', buffered: true });
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
    if (document.visibilityState === 'hidden') save();
  });

  window.SUPerf = {
    ready: function () {
      try { if (rec.ready == null) rec.ready = r(performance.now()); } catch (e) {}
    }
  };
})();
