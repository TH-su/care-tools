/*
 * su-kv-shadow.js — 同期データ（週間計画・ワークスケジュール・勤務表）の「写し」を Supabase に作る（統合 0005/0007・写しの期間）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-09-26）: 週間計画は塊ごと移す。写しで確かめてから、全端末一斉に切り替える。
 *   ワークスケジュール・勤務表も同じ進め方（ワークスケジュールは週間計画と同じ夜に切り替える）。
 *   この部品は「写しの期間」専用。正本は Google（統合同期バックエンド）のまま。
 *   アプリが Google から受け取った版（読み込み）と、Google が受け付けた版（保存）を、そのまま Supabase の kv_entries へ写す。
 *
 * ★書くのは「事務所・管理者として Google でログインしている」時だけ。判定はデータベースが最終（kv_import）。
 *   ログインしていない・現場の端末では何もしない＝アプリの動きは一切変えない。
 *   ログインの控え（sb-…-auth-token）が端末に無ければ、写す準備（中身の控え・部品の読み込み）もしない。
 * ★Google への送信文には合言葉（token）と編集券（editToken）が入っている。写すのは data だけ（Supabase へ送らない）。
 * ★同じキーは最後の版だけを、少し待ってからまとめて写す（保存が続いても 146KB を毎回送らない）。
 * ★失敗しても何も表示しない・例外を外へ出さない。supabase-js は写す時にだけ読み込む。
 * ★切り替え後（live）は kv_import が 'live' を返す＝その種類（週間計画・ワースケの日ごと 等）だけ写すのをやめる。
 *   勤務表のように、まだ切り替えていない種類はそのまま写し続ける。
 *
 * 呼び方:
 *   fromGas(action, key, json, bodyStr) … 週間計画（care-schedule）。0005 からの形のまま。
 *   fromSync(payload, json)             … ワークスケジュール・勤務表。Google へ送った要求と応答をそのまま渡す。
 *     get → 応答の data／put → 送った data（応答の版で）／pull → 応答の entries（勤務表のキーだけ）／push → 送った data（勤務表のキーだけ）
 *     中身はこの時点で控える（アプリがあとで書き換えても、Google が持っている版と同じものを写す）。
 */
(function () {
  'use strict';
  var WS_RE = /^(wsday_\d{4}-\d{2}-\d{2}|ws_weekly_master_v1|care_schedule_v2)$/;
  var SHIFT_RE = /^(staff|symbols|settings|freee|sched:\d{4}-\d{2}:[A-Za-z0-9_.:-]{1,80}|req:\d{4}-\d{2}|drafts:\d{4}-\d{2})$/;
  var SESSION_KEY = 'sb-jhbernqawjrzqwrmqrih-auth-token';
  var WAIT_MS = 8000;              // 最後の変化からこの時間待ってまとめて写す
  var DENY_MS = 30 * 60 * 1000;    // 写せない端末（現場・未登録）と分かったら、30分は控えもしない（役割は途中で変わらない）
  var pending = {};                // key -> {rev, get: function() -> data}
  var sent = {};                   // key -> 写し終えた rev（同じ版を二度送らない）
  var stoppedFam = {};             // 種類 -> true（切り替え後の種類は写さない）
  var timer = 0, busy = false, deniedUntil = 0;

  /** 種類（0007 の private.kv_family と同じ分け方）。知らないキーは '' */
  function family(key) {
    if (typeof key !== 'string') return '';
    if (key === 'care_schedule_v2') return 'care';
    if (key === 'ws_weekly_master_v1') return 'ws_master';
    if (/^wsday_\d{4}-\d{2}-\d{2}$/.test(key)) return 'wsday';
    if (SHIFT_RE.test(key)) return 'shift';
    return '';
  }
  function hasSession() {
    try { return !!localStorage.getItem(SESSION_KEY); } catch (e) { return false; }
  }
  function worthKeeping(key) {
    var fam = family(key);
    if (!fam || stoppedFam[fam]) return false;
    if (Date.now() < deniedUntil) return false;
    // 切り替えたキーは Google を通らない（su-kv.js が受け持つ）。念のためここでも写さない
    if (window.SUKv && typeof window.SUKv.routed === 'function' && window.SUKv.routed(key)) return false;
    return hasSession();
  }

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
    if (busy) return;
    var keys = Object.keys(pending);
    if (!keys.length) return;
    busy = true;
    ensureAuth()
      .then(function () { return window.SUAuth.check(); })
      .then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
          pending = {};                 // 写せない端末では溜めない
          deniedUntil = Date.now() + DENY_MS;
          return null;
        }
        var sb = window.SUAuth.client();
        var chain = Promise.resolve();
        keys.forEach(function (key) {
          var item = pending[key];
          delete pending[key];
          if (!item || sent[key] === item.rev || stoppedFam[family(key)]) return;
          chain = chain.then(function () {
            if (stoppedFam[family(key)]) return null;
            var data;
            try { data = item.get(); } catch (e) { return null; }
            if (!data || typeof data !== 'object') return null;
            return sb.rpc('kv_import', { p_key: key, p_rev: item.rev, p_data: data }).then(function (r) {
              if (r.error) return;
              if (r.data && r.data.error === 'live') { stoppedFam[family(key)] = true; return; }   // 切り替え後の種類は写さない
              if (r.data && r.data.ok) sent[key] = item.rev;
            });
          });
        });
        return chain;
      })
      .catch(function () { /* 写しの失敗はアプリに影響させない */ })
      .then(function () {
        busy = false;
        if (Object.keys(pending).length) schedule();
      });
  }

  function keep(key, rev, get) {
    var cur = pending[key];
    if (cur && cur.rev > rev) return;
    pending[key] = { rev: rev, get: get };
    schedule();
  }

  /** 中身をこの時点で文字列に控えて、写す予定に入れる。例外は投げない */
  function fromData(key, rev, data) {
    try {
      rev = Number(rev);
      if (!isFinite(rev) || rev < 1 || !data || typeof data !== 'object') return;
      if (!worthKeeping(key) || sent[key] === rev) return;
      var cur = pending[key];
      if (cur && cur.rev > rev) return;
      var snap = JSON.stringify(data);
      keep(key, rev, function () { return JSON.parse(snap); });
    } catch (e) { /* 何もしない */ }
  }

  /**
   * 週間計画（care-schedule）から呼ぶ。action='get' なら応答の data を、action='put' なら送信文の data を写す。
   * 例外は投げない。
   */
  function fromGas(action, key, json, bodyStr) {
    try {
      if (!key || !WS_RE.test(key) || !json || !json.ok || !worthKeeping(key)) return;
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
      keep(key, rev, get);
    } catch (e) { /* 何もしない */ }
  }

  /**
   * ワークスケジュール・勤務表から呼ぶ。Google へ送った要求（payload）と、Google の応答（json）をそのまま渡す。
   * 例外は投げない。応答が成功（ok）の時だけ写す。
   */
  function fromSync(payload, json) {
    try {
      if (!payload || !json || typeof json !== 'object' || !hasSession() || Date.now() < deniedUntil) return;
      var a = payload.action;
      if (a === 'get') {
        if (json.ok === true && WS_RE.test(String(payload.key))) fromData(payload.key, json.rev, json.data);
      } else if (a === 'put') {
        if (json.ok === true && WS_RE.test(String(payload.key))) fromData(payload.key, json.rev, payload.data);
      } else if (a === 'push') {
        if (json.ok === true && family(payload.key) === 'shift') fromData(payload.key, json.rev, payload.data);
      } else if (a === 'pull') {
        var ents = json.ok === true && json.entries && typeof json.entries === 'object' ? json.entries : null;
        if (!ents) return;
        Object.keys(ents).forEach(function (k) {
          var e = ents[k];
          if (family(k) === 'shift' && e && typeof e === 'object') fromData(k, e.rev, e.data);
        });
      }
    } catch (e) { /* 何もしない */ }
  }

  window.SUKvShadow = {
    fromGas: fromGas, fromSync: fromSync, family: family,
    _flushNow: function () { clearTimeout(timer); flush(); }
  };
})();
