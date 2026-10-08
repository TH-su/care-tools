/*
 * su-weight-shadow.js — 体重管理の「写し」を Supabase に作る（統合 0008・写しの期間・2026-09-27 代表者の決定 C）
 * ════════════════════════════════════════════════════════════════
 * 正本は今までどおり体重管理の GAS（スプレッドシート）。この部品は、体重管理がサーバーから全件
 * （入居者・記録・基準値）を読み終えた時、その中身をそのまま Supabase へ丸ごと写す（weight_import）。
 * 将来 care-log が体重を Google を通さずに読めるようにするための準備。
 *
 * ★写すのは「事務所・管理者として Google でログインしている」端末だけ（判定はデータベースが最終）。
 *   ログインの控えが無い端末（現場のタブレット等）では何もしない（部品も読み込まない）＝体重管理の動きは一切変えない。
 *   現場の端末で入れた記録も、次に事務所の端末が体重管理を開いた時に全件で写る。
 * ★中身が前回写したものと同じなら送らない。送るのは最短でも5分に1回。失敗しても何も表示しない。
 * ★合言葉は写さない（体重管理の応答には入っていない）。
 */
(function () {
  'use strict';
  var SESSION_KEY = 'sb-jhbernqawjrzqwrmqrih-auth-token';
  var WAIT_MS = 8000, MIN_GAP_MS = 5 * 60 * 1000, DENY_MS = 30 * 60 * 1000;
  var pending = null, lastSent = '', lastAt = 0, timer = 0, busy = false, deniedUntil = 0;

  function hasSession() { try { return !!localStorage.getItem(SESSION_KEY); } catch (e) { return false; } }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function ensureAuth() {
    if (window.SUAuth) return Promise.resolve();
    var p = window.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return window.SUAuth ? null : loadScript('su-auth.js?v=2026-09-26'); });
  }

  function flush() {
    if (busy || !pending) return;
    var snap = pending; pending = null;
    if (snap === lastSent) return;
    busy = true;
    ensureAuth()
      .then(function () { return window.SUAuth.check(); })
      .then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
          deniedUntil = Date.now() + DENY_MS;
          return null;
        }
        var o = JSON.parse(snap);
        return window.SUAuth.client().rpc('weight_import', { p_residents: o.r, p_records: o.c, p_thresholds: o.t })
          .then(function (res) {
            if (!res.error && res.data && res.data.ok) { lastSent = snap; lastAt = Date.now(); }
          });
      })
      .catch(function () { /* 写しの失敗は体重管理に影響させない */ })
      .then(function () { busy = false; });
  }

  /**
   * 体重管理がサーバーから全件を読み、手元と合わせ終えた所で呼ぶ。
   * residents・records はサーバーの行（手元で紐づけた入居者マスタの利用者No を補ったもの）。例外は投げない。
   */
  function fromGetAll(residents, records, thresholds) {
    try {
      if (!hasSession() || Date.now() < deniedUntil) return;
      if (!Array.isArray(residents) || !Array.isArray(records)) return;
      var snap = JSON.stringify({ r: residents, c: records, t: (thresholds && typeof thresholds === 'object') ? thresholds : null });
      if (snap === lastSent) return;
      pending = snap;
      clearTimeout(timer);
      var wait = Math.max(WAIT_MS, lastAt ? MIN_GAP_MS - (Date.now() - lastAt) : 0);
      timer = setTimeout(flush, wait);
    } catch (e) { /* 何もしない */ }
  }

  window.SUWeightShadow = { fromGetAll: fromGetAll, _flushNow: function () { clearTimeout(timer); flush(); } };
})();
