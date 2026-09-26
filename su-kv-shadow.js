/*
 * su-kv-shadow.js — 同期データ（週間計画など）の「写し」を Supabase に作る（統合 0005・写しの期間・2026-09-26）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-09-26）: 週間計画は塊ごと移す。写しで確かめてから、全端末一斉に切り替える。
 *   この部品は「写しの期間」専用。正本は Google（統合同期バックエンド）のまま。
 *   アプリが Google から受け取った版（読み込み）と、Google が受け付けた版（保存）を、そのまま Supabase の kv_entries へ写す。
 *
 * ★書くのは「事務所・管理者として Google でログインしている」時だけ。判定はデータベースが最終（kv_import）。
 *   ログインしていない・現場の端末では何もしない＝アプリの動きは一切変えない。
 * ★Google への送信文には合言葉（token）が入っている。写すのは data だけ（合言葉は Supabase へ送らない）。
 * ★同じキーは最後の版だけを、少し待ってからまとめて写す（保存が続いても 146KB を毎回送らない）。
 * ★失敗しても何も表示しない・例外を外へ出さない。supabase-js は写す時にだけ読み込む。
 * ★切り替え後（live）は kv_import が 'live' を返す＝この部品は自然に止まる（その時は別の部品が本番の書き込みを担う）。
 */
(function () {
  'use strict';
  var KEY_RE = /^(wsday_\d{4}-\d{2}-\d{2}|ws_weekly_master_v1|care_schedule_v2)$/;
  var WAIT_MS = 8000;              // 最後の変化からこの時間待ってまとめて写す
  var pending = {};                // key -> {rev, get: function() -> data}
  var sent = {};                   // key -> 写し終えた rev（同じ版を二度送らない）
  var timer = 0, busy = false, stopped = false;

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

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, WAIT_MS);
  }

  function flush() {
    if (busy || stopped) return;
    var keys = Object.keys(pending);
    if (!keys.length) return;
    busy = true;
    ensureAuth()
      .then(function () { return window.SUAuth.check(); })
      .then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
          pending = {};                 // 写せない端末では溜めない
          return null;
        }
        var sb = window.SUAuth.client();
        var chain = Promise.resolve();
        keys.forEach(function (key) {
          var item = pending[key];
          delete pending[key];
          if (!item || sent[key] === item.rev) return;
          chain = chain.then(function () {
            var data;
            try { data = item.get(); } catch (e) { return null; }
            if (!data || typeof data !== 'object') return null;
            return sb.rpc('kv_import', { p_key: key, p_rev: item.rev, p_data: data }).then(function (r) {
              if (r.error) return;
              if (r.data && r.data.error === 'live') { stopped = true; return; }   // 切り替え後は写さない
              if (r.data && r.data.ok) sent[key] = item.rev;
            });
          });
        });
        return chain;
      })
      .catch(function () { /* 写しの失敗はアプリに影響させない */ })
      .then(function () {
        busy = false;
        if (Object.keys(pending).length && !stopped) schedule();
      });
  }

  /**
   * アプリの通信関数から呼ぶ。action='get' なら応答の data を、action='put' なら送信文の data を写す。
   * 例外は投げない。
   */
  function fromGas(action, key, json, bodyStr) {
    try {
      if (stopped || !key || !KEY_RE.test(key) || !json || !json.ok) return;
      var rev = Number(json.rev);
      if (!isFinite(rev) || rev < 1) return;
      var get = null;
      if (action === 'get' && json.data && typeof json.data === 'object') {
        var d = json.data;
        get = function () { return d; };
      } else if (action === 'put' && typeof bodyStr === 'string') {
        // 送信文には合言葉が入っているので、写す直前に data だけを取り出す
        get = function () { var o = JSON.parse(bodyStr); return o && o.data; };
      }
      if (!get) return;
      var cur = pending[key];
      if (cur && cur.rev > rev) return;
      pending[key] = { rev: rev, get: get };
      schedule();
    } catch (e) { /* 何もしない */ }
  }

  window.SUKvShadow = { fromGas: fromGas, _flushNow: function () { clearTimeout(timer); flush(); } };
})();
