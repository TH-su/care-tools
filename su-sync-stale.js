/*
 * su-sync-stale.js — メニューの「入居者マスタ」のタイルに、写しが止まっている時の札を出す（2026-10-26 本人指示）
 * ════════════════════════════════════════════════════════════════
 * 札の文: 「写しが止まっています（最終 MM/DD HH:mm）」（日本時間）。成功の記録が1件も無い時は「写しが止まっています（最終 記録なし）」。
 *
 * ★出すのは、管理者（Google＋2段階認証）でログインしている時だけ。現場端末・現場／事務所のアカウント・ログインなし・
 *   確かめられない（通信の失敗・時間切れ）時は何も出さない。
 * ★現場端末では何も読まない（su-auth.js・supabase-js を読み込まない・通信しない）。用途が現場へ変わった時と、
 *   遅れて届いた応答は世代（gen）で捨てる。
 * ★読むのは写しの記録（master_sync_runs）の at と failed だけ。氏名・記録は読まない。札に出すのは時刻だけ（textContent）。
 * ★メニューの表示は待たせない。確かめるのはページの読み込みが終わってから裏で行う。例外を外に出さない。
 * ★誰が読めるかはデータベース（RLS: 事務所・管理者かつ自分の事業者）が決める。ここで管理者に絞るのは見せ方だけ。
 * ★「成功」は failed = 0 の行（care_failed は見ない＝0022 の2項目は別の判定）。その中で at がいちばん新しい行が「最終」。
 *   今から24時間より前（ちょうど24時間は含めない）の時だけ札を出す。
 *
 * ログインの部品の読み込みは su-menu.js の SUMenu.loadAuth を使う（同じ部品を二重に読み込まない）。
 *
 * 使い方（index.html）:
 *   SUSyncStale.start(root)   → 読み込みが終わってから裏で確かめ、root の中の入居者マスタのタイルに札を付ける
 *   SUSyncStale.apply(root)   → 確かめた結果を付け直すだけ（通信しない）。メニューを組み立て直した後に呼ぶ
 *   SUSyncStale.staleText(rows, nowMs) / allowed(st, deviceRole, okStatus) / jstStamp(ms) → 純関数（check/unit/menu_sync_stale_test.js）
 */
(function () {
  'use strict';
  if (window.SUSyncStale) return;

  var HREF = 'resident-master.html';      // 名前でなくリンク先で探す（?view=bday など別のタイルには付けない）
  var TIMEOUT_MS = 15000;

  /* STALE_PURE_BEGIN 判定の純関数（2026-10-26 本人指示） */
  var DAY_MS = 24 * 60 * 60 * 1000;
  var JST_MS = 9 * 60 * 60 * 1000;         // 日本時間（夏時間なし）。端末の時間帯の設定に左右されないよう足し算で出す
  var HEAD = '写しが止まっています（最終 ';
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* ms（UTC のミリ秒）→ 日本時間の MM/DD HH:mm */
  function jstStamp(ms) {
    var d = new Date(ms + JST_MS);
    return pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  /* 成功（failed が 0）の行のうち、at がいちばん新しいもの（ms）。無ければ null */
  function lastOk(rows) {
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || typeof r !== 'object' || r.failed !== 0 || typeof r.at !== 'string') continue;
      var ms = Date.parse(r.at);
      if (!isFinite(ms)) continue;
      if (best === null || ms > best) best = ms;
    }
    return best;
  }
  /* 札の文。出さない時は ''。rows は写しの記録の行の配列、nowMs は今の時刻 */
  function staleText(rows, nowMs) {
    if (!Array.isArray(rows) || typeof nowMs !== 'number' || !isFinite(nowMs)) return '';
    var ms = lastOk(rows);
    if (ms === null) return HEAD + '記録なし）';
    if (!(nowMs - ms > DAY_MS)) return '';
    return HEAD + jstStamp(ms) + '）';
  }
  /* 札を確かめてよいか。st は SUAuth.check() の結果、deviceRole は端末の用途、okStatus は SUAuth.STATUS.OK */
  function allowed(st, deviceRole, okStatus) {
    if (deviceRole === 'field') return false;
    return !!(st && typeof st === 'object' && typeof okStatus === 'string' && st.status === okStatus && st.role === 'admin');
  }
  /* STALE_PURE_END */

  var gen = 0, shown = '', root = null;

  /* 現場端末か（その時点の印と端末の用途の両方を見る。読めない時は現場として扱い、何も読まない） */
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
      var olds = root.querySelectorAll('a.tile .stale');
      for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
      if (!shown || deviceRole() === 'field') return;
      var tiles = root.querySelectorAll('a.tile');
      for (var j = 0; j < tiles.length; j++) {
        if (tiles[j].getAttribute('href') !== HREF) continue;
        var s = document.createElement('span');
        s.className = 'stale';
        s.textContent = shown;
        tiles[j].appendChild(s);
      }
    } catch (e) { /* 付けられなくてもメニューは動く */ }
  }

  function fetchText(my) {
    return window.SUMenu.loadAuth().then(function () {
      if (my !== gen || deviceRole() === 'field' || !window.SUAuth) return null;
      var A = window.SUAuth;
      return A.check().then(function (st) {
        if (my !== gen || !allowed(st, deviceRole(), A.STATUS && A.STATUS.OK)) return null;
        return A.client().from('master_sync_runs').select('at,failed').eq('failed', 0)
          .order('at', { ascending: false }).limit(1).then(function (res) {
            if (my !== gen || !res || res.error || !Array.isArray(res.data)) return null;
            return staleText(res.data, Date.now());
          });
      });
    });
  }

  function run() {
    var my = ++gen;
    function off() { shown = ''; apply(); }
    try {
      if (typeof Promise === 'undefined' || deviceRole() === 'field') return off();
      var M = window.SUMenu;
      if (!M || typeof M.hasLogin !== 'function' || typeof M.loadAuth !== 'function' || !M.hasLogin()) return off();
      // 確かめ直す間は今の札のまま（ログインの更新のたびに札が消えて出る「ちらつき」を防ぐ）。結果で付け直す
      var t = new Promise(function (ok) { setTimeout(function () { ok(null); }, TIMEOUT_MS); });
      Promise.race([fetchText(my), t]).catch(function () { return null; }).then(function (txt) {
        if (my !== gen || deviceRole() === 'field') return;   // 遅れて届いた応答・用途が現場へ変わった後の応答は捨てる
        shown = typeof txt === 'string' ? txt : '';
        apply();
      });
    } catch (e) { off(); }
  }

  function start(r) {
    try {
      root = r || root;
      if (document.readyState === 'complete') run();
      else window.addEventListener('load', run);
      // 「戻る」でそのまま戻った時は確かめ直す（ログアウトの後・用途を変えた後に前の札を残さない）
      window.addEventListener('pageshow', function (e) { if (e.persisted) run(); });
      // 別のタブで端末の用途・ログインが変わった時も確かめ直す（現場になっていれば札を外して何も読まない）
      window.addEventListener('storage', function (e) {
        if (!e || e.key === null || e.key === 'su_device_role' || /^sb-[a-z0-9]+-auth-token$/.test(String(e.key))) run();
      });
    } catch (e) { /* 何もしない */ }
  }

  window.SUSyncStale = { start: start, apply: apply, staleText: staleText, allowed: allowed, jstStamp: jstStamp };
})();
