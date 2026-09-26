/*
 * su-kv.js — 同期データの保存先の切り替え（統合 0005・切り替え本番用・2026-09-26）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-09-26）: 週間計画は塊ごと移す。写しで確かめてから、全端末一斉に切り替える。
 *   ワークスケジュール（週の型 ws_weekly_master_v1・日ごと wsday_YYYY-MM-DD）も、週間計画と同じ夜に一緒に切り替える（統合 0007）。
 *   勤務表（シフト系）はこのファイルの対象外（別の通信の形・編集できる端末を1台に絞る仕組みがあるため、後の移行で扱う）。
 *
 * 仕組み:
 *   ・切り替えのスイッチは公開ファイル su-backend.json（{"supabase": {"care_schedule_v2": true, "ws_weekly_master_v1": true, "wsday": true}}）。
 *     wsday は日ごとのキー（wsday_YYYY-MM-DD）すべてをまとめた1つのスイッチ。
 *     全端末が起動時と1分ごとに読む＝ PR を1つ取り込むだけで全端末が一斉に切り替わる／戻る。
 *   ・各アプリの通信関数の入口で SUKv.handles(payload) が真なら SUKv.call(payload, rawGas) に任せる。
 *     スイッチが入っていないキーは rawGas（これまでの Google）へそのまま流す＝切り替え前は何も変わらない。
 *   ・スイッチが入ったキーは Supabase の関数（kv_get / kv_head / kv_put / kv_history_*）で読み書きし、
 *     Google と同じ形の応答を返す（conflict・unchanged・bathwipe・visitwipe 等も同じ名前）＝アプリ側の処理は変えない。
 *   ・Supabase に保存できたら、少し待って最新版を Google へも写し返す（force）。まだ Google を読んでいる画面
 *     （週間計画俯瞰・支援俯瞰・入居者マスタのデイ利用日・フェイスシート・訓練計画）が古いままにならないように。
 *   ・Supabase へ書けるのは事務所・管理者として Google でログインしている時だけ（最終判定はデータベース）。
 *     ログインしていなければ、画面下に「ログインしてください」の帯を出し、通信は失敗として返す（入力は端末に残る）。
 *
 * ★スイッチが読めない時（圏外など）は、最後に読めた値を使う（localStorage su_backend_flags）。
 *   一度も読めていない端末は Google のまま＝切り替え前と同じ。
 * ★切り替え当日の順番（割れないように）: ①写しの見比べ画面の「切り替え前の点検」が全部そろっていることを確かめる
 *   ②スイッチを入れる PR を取り込む（この間の保存は 'shadow' で断られ、入力は端末に残る）
 *   ③管理者が写しの見比べ画面で「切り替える」（kv_set_family_mode live・週間計画とワークスケジュールをまとめて）。
 *   戻す時は逆順: ①スイッチを切る PR ②「戻す」（shadow）。
 */
(function () {
  'use strict';
  // このファイルが扱えるキーと、そのスイッチの名前（増やす時は 0005/0007 のキーの範囲内で。勤務表は入れない）
  function flagOf(key) {
    if (key === 'care_schedule_v2' || key === 'ws_weekly_master_v1') return key;
    if (typeof key === 'string' && /^wsday_\d{4}-\d{2}-\d{2}$/.test(key)) return 'wsday';
    return '';
  }
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var ROUTED_ACTIONS = { get: 1, put: 1, head: 1, history: 1 };
  var MIRROR_WAIT_MS = 20000;
  var AUTH_TTL_MS = 5 * 60 * 1000;

  var flags = null, flagsTriedAt = 0, flagsPromise = null;
  try { flags = JSON.parse(localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { flags = null; }

  function fetchFlags() {
    if (flagsPromise) return flagsPromise;
    flagsTriedAt = Date.now();
    flagsPromise = fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.supabase && typeof j.supabase === 'object') {
          flags = { supabase: j.supabase };
          try { localStorage.setItem(FLAGS_LS, JSON.stringify(flags)); } catch (e) { /* 何もしない */ }
        }
      })
      .catch(function () { /* 読めない時は最後に読めた値のまま */ })
      .then(function () { flagsPromise = null; });
    return flagsPromise;
  }
  function ensureFlags() {
    // 1分以内に読みに行っていれば、その結果（圏外なら最後に読めた値）を使う
    if (flagsTriedAt && Date.now() - flagsTriedAt < 60000 && !flagsPromise) return Promise.resolve();
    // 3秒で見切る（圏外で起動が止まらないように。見切った時は最後に読めた値）
    return Promise.race([fetchFlags(), new Promise(function (ok) { setTimeout(ok, 3000); })]);
  }
  function routed(key) { var f = flagOf(key); return !!(f && flags && flags.supabase && flags.supabase[f] === true); }

  // ── ログイン（supabase-js と su-auth.js は使う時にだけ読み込む）──
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
  var authCache = null, authAt = 0;
  function authState() {
    if (authCache && Date.now() - authAt < AUTH_TTL_MS) return Promise.resolve(authCache);
    return ensureAuth().then(function () { return window.SUAuth.check(); }).then(function (st) {
      authCache = st; authAt = Date.now();
      return st;
    });
  }

  var bannerShown = false;
  function showLoginBanner() {
    if (bannerShown || !document.body) return;
    bannerShown = true;
    var page = (location.pathname.split('/').pop() || 'index.html');
    if (!/^[a-z0-9][a-z0-9-]*\.html$/.test(page)) page = 'index.html';
    var bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#b3261e;color:#fff;' +
      'padding:12px 16px;font:700 15px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;' +
      'display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
    var t = document.createElement('span');
    t.textContent = '保存先が新しくなりました。保存・読み込みには Google でのログインが必要です（入力した内容は端末に残っています）。';
    var a = document.createElement('a');
    a.href = 'login.html?next=' + page;
    a.textContent = 'ログインする';
    a.style.cssText = 'background:#fff;color:#b3261e;border-radius:8px;padding:8px 14px;text-decoration:none;min-height:40px;display:inline-flex;align-items:center';
    bar.appendChild(t); bar.appendChild(a);
    document.body.appendChild(bar);
  }

  // ── Google への写し返し（読むだけの画面のため）──
  var mirrorTimers = {};
  function scheduleMirror(key, rawGas) {
    clearTimeout(mirrorTimers[key]);
    mirrorTimers[key] = setTimeout(function () {
      var sb = window.SUAuth && window.SUAuth.client();
      if (!sb) return;
      sb.rpc('kv_get', { p_key: key }).then(function (r) {
        if (r.error || !r.data || !r.data.data) return;
        // 最新版で上書き（force）。版番号は Google 側で独自に進む＝読む側は「変わった」ことだけ分かればよい
        return rawGas({ action: 'put', key: key, rev: 0, data: r.data.data, force: true });
      }).catch(function () { /* 写し返しの失敗は本番に影響させない（次の保存でまた写す） */ });
    }, MIRROR_WAIT_MS);
  }

  function rpc(name, args) {
    var sb = window.SUAuth.client();
    var once = function () { return sb.rpc(name, args); };
    return once().then(function (r) {
      // 通信の失敗だけ1回やり直す（断り＝データベースの判定はやり直さない）
      if (r.error && /fetch|network|load failed/i.test(String(r.error.message || ''))) return once();
      return r;
    });
  }
  function fail(r) {
    var m = String((r && r.error && (r.error.code || r.error.message)) || '');
    if (m === '42501' || /not allowed/i.test(m)) return { ok: false, error: 'forbidden' };
    return { ok: false, error: '通信失敗' };
  }

  /** この通信を SUKv が受け持つか（同期で答える）。キーが候補に入っている時だけ真＝それ以外は今までどおり */
  function handles(payload) {
    if (!payload || !ROUTED_ACTIONS[payload.action]) return false;
    if (payload.key && flagOf(payload.key)) return true;
    if (Array.isArray(payload.keys)) return payload.keys.some(function (k) { return !!flagOf(k); });
    return false;
  }

  /**
   * 受け持った通信を処理する。rawGas(p) は「これまでの Google への送信」（Promise を返す）。
   * スイッチが入っていなければ rawGas へそのまま流す。
   */
  function call(payload, rawGas) {
    return ensureFlags().then(function () {
      var action = payload.action;
      // 複数キーの版の問い合わせ（ワークスケジュール・週間計画の巡回）: 切り替えたキーだけ Supabase、残りは Google
      if (action === 'head' && Array.isArray(payload.keys)) {
        var mine = payload.keys.filter(routed), rest = payload.keys.filter(function (k) { return !routed(k); });
        if (!mine.length) return rawGas(payload);
        var restP = rest.length ? rawGas(Object.assign({}, payload, { keys: rest })) : Promise.resolve({ ok: true, revs: {} });
        return Promise.all([viaSupabase({ action: 'head', keys: mine }, rawGas), restP]).then(function (both) {
          var a = both[0], b = both[1];
          if (!a || !a.ok) return a;
          if (!b || !b.ok) return b;
          return { ok: true, revs: Object.assign({}, b.revs || {}, a.revs || {}) };
        });
      }
      if (!routed(payload.key)) return rawGas(payload);
      return viaSupabase(payload, rawGas);
    });
  }

  function viaSupabase(payload, rawGas) {
    return authState().then(function (st) {
      var S = window.SUAuth.STATUS;
      if (st.status !== S.OK) {
        if (st.status === S.SIGNED_OUT || st.status === S.DENIED || st.status === S.MFA_VERIFY || st.status === S.MFA_ENROLL) {
          showLoginBanner();
          return { ok: false, error: 'login' };
        }
        return { ok: false, error: '通信失敗' };
      }
      var key = payload.key;
      switch (payload.action) {
        case 'get':
          return rpc('kv_get', { p_key: key }).then(function (r) {
            if (r.error) return fail(r);
            var d = r.data || {};
            return { ok: true, rev: d.rev || 0, data: d.data == null ? null : d.data, updatedAt: d.updatedAt || '' };
          });
        case 'head': {
          var keys = Array.isArray(payload.keys) ? payload.keys : [key];
          return rpc('kv_head', { p_keys: keys }).then(function (r) {
            if (r.error) return fail(r);
            var revs = (r.data && r.data.revs) || {};
            if (Array.isArray(payload.keys)) return { ok: true, revs: revs };
            return { ok: true, rev: revs[key] || 0 };
          });
        }
        case 'put':
          if (st.role !== 'office' && st.role !== 'admin') return { ok: false, error: 'forbidden' };
          return rpc('kv_put', {
            p_key: key, p_rev: Number(payload.rev) || 0, p_data: payload.data,
            p_force: !!payload.force, p_lock_override: !!payload.lockOverride
          }).then(function (r) {
            if (r.error) return fail(r);
            var d = r.data || { ok: false, error: '通信失敗' };
            if (d.ok && !d.unchanged && rawGas) scheduleMirror(key, rawGas);
            return d;
          });
        case 'history':
          if (payload.day != null) return { ok: false, error: 'no such generation' };   // 日次の世代は版番号の一覧に含まれる
          if (payload.rev != null) {
            return rpc('kv_history_get', { p_key: key, p_rev: Number(payload.rev) || 0 }).then(function (r) {
              return r.error ? fail(r) : r.data;
            });
          }
          return rpc('kv_history_list', { p_key: key }).then(function (r) { return r.error ? fail(r) : r.data; });
        default:
          return rawGas(payload);
      }
    }).catch(function () { return { ok: false, error: '通信失敗' }; });
  }

  // 起動時に一度スイッチを読み、以後1分ごとに読み直す（開いたままの画面も一斉に切り替わる）
  fetchFlags();
  setInterval(fetchFlags, 60000);

  window.SUKv = { handles: handles, call: call, routed: routed, flagOf: flagOf, _flags: function () { return flags; } };
})();
