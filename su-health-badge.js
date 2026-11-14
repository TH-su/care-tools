/*
 * su-health-badge.js — メニューの業務のタイルに、本番の健康の「要確認」の札を出す（2026-11-14 代表者の依頼・統合 0088）
 * ════════════════════════════════════════════════════════════════
 * 札の文の例: 「本番：保存の失敗7件（24時間）」「本番：写し返しが3時間遅れ」（両方の時は「・」でつなぐ）。
 *   切り替え済みの種類で、直近24時間の保存の失敗が5件以上か、Google への写し返しが2時間以上遅れている時だけ、その種類の画面のタイルに出す
 *   （添付書類は職員マスタ・入居調整のタイル）。判定は su-health-calc.js（SUHealthCalc.judge・tileBadges）。詳しくは写しの見比べの「本番の健康」。
 * ★出すのは、管理者（Google＋2段階認証）でログインしている事務所の端末だけ（su-sync-stale.js と同じ確かめ方）。
 *   現場端末では何も読まない（ログインの部品を読み込まない・通信しない）。遅れて届いた応答・用途が現場へ変わった後の応答は世代で捨てる。
 * ★読むのは save_health（種類・数・時刻だけ）。氏名・中身は答えにも無い。札に出すのは数と時間だけ（textContent）。端末には何も残さない。
 * ★メニューの表示は待たせない（読み込みが終わってから裏で確かめる）。読めない・形が違う時は札を出さない。例外を外に出さない。
 *   使い方（index.html）: SUHealthBadge.start(root) / SUHealthBadge.apply(root)（組み立て直した後に付け直すだけ・通信しない）
 */
(function () {
  'use strict';
  if (window.SUHealthBadge) return;

  var TIMEOUT_MS = 15000;
  var gen = 0, shown = {}, root = null;

  function deviceRole() {
    try {
      if (document.documentElement.classList.contains('is-field')) return 'field';
      return localStorage.getItem('su_device_role') === 'field' ? 'field' : 'office';
    } catch (e) { return 'field'; }
  }

  function apply(r) {
    try {
      if (r) root = r;
      if (!root) return;
      var olds = root.querySelectorAll('a.tile .hlbad');
      for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
      if (deviceRole() === 'field') return;
      var tiles = root.querySelectorAll('a.tile');
      for (var j = 0; j < tiles.length; j++) {
        var href = tiles[j].getAttribute('href');
        if (!href || !Object.prototype.hasOwnProperty.call(shown, href)) continue;
        var s = document.createElement('span');
        s.className = 'hlbad';
        s.textContent = '本番：' + shown[href];
        tiles[j].appendChild(s);
      }
    } catch (e) { /* 付けられなくてもメニューは動く */ }
  }

  function fetchBadges(my) {
    return window.SUMenu.loadAuth().then(function () {
      if (my !== gen || deviceRole() === 'field' || !window.SUAuth || !window.SUHealthCalc) return null;
      var A = window.SUAuth;
      return A.check().then(function (st) {
        if (my !== gen || deviceRole() === 'field') return null;
        if (!(st && st.status === (A.STATUS && A.STATUS.OK) && st.role === 'admin')) return null;
        return A.client().rpc('save_health').then(function (res) {
          if (my !== gen || !res || res.error) return null;
          return window.SUHealthCalc.tileBadges(window.SUHealthCalc.judge(res.data));
        });
      });
    });
  }

  function run() {
    var my = ++gen;
    function off() { shown = {}; apply(); }
    try {
      if (typeof Promise === 'undefined' || deviceRole() === 'field') return off();
      var M = window.SUMenu;
      if (!M || typeof M.hasLogin !== 'function' || typeof M.loadAuth !== 'function' || !M.hasLogin()) return off();
      var t = new Promise(function (ok) { setTimeout(function () { ok(null); }, TIMEOUT_MS); });
      Promise.race([fetchBadges(my), t]).catch(function () { return null; }).then(function (b) {
        if (my !== gen || deviceRole() === 'field') return;
        shown = b && typeof b === 'object' ? b : {};
        apply();
      });
    } catch (e) { off(); }
  }

  function start(r) {
    try {
      root = r || root;
      if (document.readyState === 'complete') run();
      else window.addEventListener('load', run);
      window.addEventListener('pageshow', function (e) { if (e.persisted) run(); });
      window.addEventListener('storage', function (e) {
        if (!e || e.key === null || e.key === 'su_device_role' || /^sb-[a-z0-9]+-auth-token$/.test(String(e.key))) run();
      });
    } catch (e) { /* 何もしない */ }
  }

  window.SUHealthBadge = { start: start, apply: apply };
})();
