/*
 * su-kv.js — 同期データの保存先の切り替え（統合 0005・切り替え本番用・2026-09-26）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-09-26）: 週間計画は塊ごと移す。写しで確かめてから、全端末一斉に切り替える。
 *   ワークスケジュール（週の型 ws_weekly_master_v1・日ごと wsday_YYYY-MM-DD）も、週間計画と同じ夜に一緒に切り替える（統合 0007）。
 *   勤務表（シフト系）は別の入口 SUKv.handlesShift / SUKv.callShift で扱う（統合 0009・2026-09-27 代表者の決定 B）。
 *   通信の形（pull / push / 編集権 lock* / shiftStatus）と編集できる端末を1台に絞る仕組みがワークスケジュールと違うため。
 *   スイッチは su-backend.json の "shift"（切り替えは週間計画・ワークスケジュールとは別の夜に、別に決める）。
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
  // このファイルが扱えるキーと、そのスイッチの名前（増やす時は 0005/0007 のキーの範囲内で）。
  // 勤務表のキーは 'shift'（0007 の private.kv_family と同じ範囲）。勤務表は handlesShift / callShift だけが扱う
  var SHIFT_KEY_RE = /^(staff|symbols|settings|freee|sched:\d{4}-\d{2}:[A-Za-z0-9_.:-]{1,80}|req:\d{4}-\d{2}|drafts:\d{4}-\d{2})$/;
  function flagOf(key) {
    if (key === 'care_schedule_v2' || key === 'ws_weekly_master_v1') return key;
    if (typeof key === 'string' && /^wsday_\d{4}-\d{2}-\d{2}$/.test(key)) return 'wsday';
    if (typeof key === 'string' && SHIFT_KEY_RE.test(key)) return 'shift';
    return '';
  }
  // 週間計画・ワークスケジュールの入口（handles / call / readRouted）が扱うキー（勤務表は混ぜない）
  function kvFlagOf(key) { var f = flagOf(key); return f === 'shift' ? '' : f; }
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
  function kvRouted(key) { return !!kvFlagOf(key) && routed(key); }

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
    if (payload.key && kvFlagOf(payload.key)) return true;
    if (Array.isArray(payload.keys)) return payload.keys.some(function (k) { return !!kvFlagOf(k); });
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
        var mine = payload.keys.filter(kvRouted), rest = payload.keys.filter(function (k) { return !kvRouted(k); });
        if (!mine.length) return rawGas(payload);
        var restP = rest.length ? rawGas(Object.assign({}, payload, { keys: rest })) : Promise.resolve({ ok: true, revs: {} });
        return Promise.all([viaSupabase({ action: 'head', keys: mine }, rawGas), restP]).then(function (both) {
          var a = both[0], b = both[1];
          if (!a || !a.ok) return a;
          if (!b || !b.ok) return b;
          return { ok: true, revs: Object.assign({}, b.revs || {}, a.revs || {}) };
        });
      }
      if (!kvRouted(payload.key)) return rawGas(payload);
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

  /* ── 見るだけの画面の読み取り（2026-09-27 代表者の決定 A）──
   * 週間計画俯瞰・支援俯瞰・入居者マスタ／フェイスシートの「デイ利用日」は、書かずに読むだけ。
   * スイッチが入ったキーは Supabase から読む（速い）。ただし次の時は null を返し、呼び手は今までどおり Google を読む
   * （切り替え後も Supabase から Google へ写し返しているので、Google の中身も最新に追いつく）:
   *   スイッチが切・ログインの控えが無い（現場のタブレット等）・ログインが確かめられない・通信の失敗。
   * ★帯（ログインしてください）は出さない＝見るだけの画面の使い勝手を変えない。
   * payload: {action:'get', key} → {ok, rev, data, updatedAt}／{action:'pull', keys:[…]} → {ok, entries:{key:{key,rev,data,updatedAt}}}
   *   pull はキーが全部スイッチ入りの時だけ受け持つ（混ざっていれば null＝全部 Google）。 */
  var SESSION_LS = 'sb-jhbernqawjrzqwrmqrih-auth-token';
  function hasSession() { try { return !!localStorage.getItem(SESSION_LS); } catch (e) { return false; } }
  function readRouted(payload) {
    return ensureFlags().then(function () {
      if (!payload || !hasSession()) return null;
      var keys = payload.action === 'get' ? [payload.key] : payload.action === 'pull' && Array.isArray(payload.keys) ? payload.keys : null;
      if (!keys || !keys.length || !keys.every(kvRouted)) return null;
      return authState().then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK) return null;
        var sb = window.SUAuth.client();
        if (payload.action === 'get') {
          return rpc('kv_get', { p_key: payload.key }).then(function (r) {
            if (r.error || !r.data || r.data.ok !== true) return null;
            return { ok: true, rev: r.data.rev || 0, data: r.data.data == null ? null : r.data.data, updatedAt: r.data.updatedAt || '' };
          });
        }
        return sb.from('kv_entries').select('key,rev,data,updated_at').in('key', keys).then(function (r) {
          if (r.error || !Array.isArray(r.data)) return null;
          var entries = {};
          r.data.forEach(function (e) { if (e && e.data != null) entries[e.key] = { key: e.key, rev: e.rev, data: e.data, updatedAt: e.updated_at }; });
          return { ok: true, entries: entries };
        });
      });
    }).catch(function () { return null; });
  }

  /* ── 勤務表（シフト）の保存先の切り替え（統合 0009・2026-09-27 代表者の決定 B）──
   * 勤務表アプリの通信関数 Store.api の入口で SUKv.handlesShift(payload) が真なら SUKv.callShift(payload, rawGas) に任せる。
   * スイッチ "shift" が切なら rawGas（これまでの Google）へそのまま流す＝切り替え前は何も変わらない。
   * スイッチが入ったら Supabase の関数（shift_pull / shift_push / shift_lock_* / shift_status）で読み書きし、
   * Google と同じ形の応答を返す（conflict・serverRev・editlock・schedwipe 等も同じ名前）＝勤務表アプリの処理は変えない。
   *   ・編集できる端末を1台に絞る仕組み（編集権・券・epoch・厳格モード）もデータベースが同じ約束で受け持つ。
   *   ・現場のアカウントは読むだけ（pull の応答に role:'ro'＝勤務表アプリは閲覧モード）。書けるのは事務所・管理者。
   *   ・保存できたら、少し待って最新版を Google へも写し返す（force）。勤務表を Google から読む画面
   *     （ワークスケジュールの勤務の取り込み等）が古いままにならないように。写し返しの失敗は本番に影響させない。
   *   ・合言葉（Google の token）と券の控えは Supabase へは送らない（送るのは関数の引数だけ）。 */
  var SHIFT_ACTIONS = { pull: 1, push: 1, head: 1, lockStatus: 1, lockAcquire: 1, lockRenew: 1, lockRelease: 1, shiftStatus: 1 };
  function isShiftKey(k) { return flagOf(k) === 'shift'; }
  function shiftOn() { return !!(flags && flags.supabase && flags.supabase.shift === true); }

  /** 勤務表アプリの通信のうち、SUKv が受け持てる形か（同期で答える）。受け持っても、スイッチが切なら Google へ流す */
  function handlesShift(payload) {
    if (!payload || !SHIFT_ACTIONS[payload.action]) return false;
    var a = payload.action;
    if (a === 'push') return isShiftKey(payload.key);
    if (a === 'head') return Array.isArray(payload.keys) && payload.keys.length > 0 && payload.keys.every(isShiftKey);
    if (a === 'pull') return !Array.isArray(payload.keys) || !payload.keys.length || payload.keys.every(isShiftKey);
    return true;   // 編集権・版の確かめ（キーを持たない）
  }

  function callShift(payload, rawGas) {
    return ensureFlags().then(function () {
      if (!shiftOn()) return rawGas(payload);
      return viaSupabaseShift(payload, rawGas);
    });
  }

  var shiftMirrorTimers = {};
  function scheduleShiftMirror(key, rawGas) {
    clearTimeout(shiftMirrorTimers[key]);
    shiftMirrorTimers[key] = setTimeout(function () {
      var sb = window.SUAuth && window.SUAuth.client();
      if (!sb) return;
      sb.rpc('shift_pull', { p_keys: [key] }).then(function (r) {
        var e = r && !r.error && r.data && r.data.entries && r.data.entries[key];
        if (!e || e.data == null) return;
        // 最新版で上書き（force）。版番号は Google 側で独自に進む＝読む側は「変わった」ことだけ分かればよい
        return rawGas({ action: 'push', key: key, baseRev: 0, data: e.data, force: true });
      }).catch(function () { /* 写し返しの失敗は本番に影響させない（次の保存でまた写す） */ });
    }, MIRROR_WAIT_MS);
  }

  function str(v, max) { var s = v == null ? '' : String(v); return s.length > max ? s.substring(0, max) : s; }

  function viaSupabaseShift(payload, rawGas) {
    return authState().then(function (st) {
      var S = window.SUAuth.STATUS;
      if (st.status !== S.OK) {
        if (st.status === S.SIGNED_OUT || st.status === S.DENIED || st.status === S.MFA_VERIFY || st.status === S.MFA_ENROLL) {
          showLoginBanner();
          return { ok: false, error: 'login' };
        }
        return { ok: false, error: '通信失敗' };
      }
      var writer = st.role === 'office' || st.role === 'admin';
      var keys = Array.isArray(payload.keys) ? payload.keys.filter(isShiftKey) : null;
      var pass = function (r) { return r.error ? fail(r) : (r.data || { ok: false, error: '通信失敗' }); };
      switch (payload.action) {
        case 'pull':
          return rpc('shift_pull', { p_keys: keys && keys.length ? keys : null }).then(pass);
        case 'shiftStatus':
        case 'head':
          return rpc('shift_status', { p_keys: keys || [] }).then(function (r) {
            var d = pass(r);
            return payload.action === 'head' && d.ok ? { ok: true, revs: d.revs || {} } : d;
          });
        case 'lockStatus':
          return rpc('shift_lock_status', {}).then(pass);
        case 'push':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_push', {
            p_key: payload.key,
            p_base_rev: (typeof payload.baseRev === 'number' && isFinite(payload.baseRev)) ? payload.baseRev : 0,
            p_data: payload.data === undefined ? null : payload.data,
            p_force: payload.force === true,
            p_edit_token: payload.editToken ? String(payload.editToken) : null,
            p_defaults_init: payload.defaultsInit === true,
            p_restore_backup: payload.restoreFromBackup === true
          }).then(function (r) {
            var d = pass(r);
            if (d.ok === true && rawGas) scheduleShiftMirror(payload.key, rawGas);
            return d;
          });
        case 'lockAcquire':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_lock_acquire', { p_device: str(payload.deviceId, 64), p_name: str(payload.name, 40), p_takeover: payload.takeover === true }).then(pass);
        case 'lockRenew':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_lock_renew', { p_device: str(payload.deviceId, 64), p_token: str(payload.editToken, 64) }).then(pass);
        case 'lockRelease':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_lock_release', { p_device: str(payload.deviceId, 64), p_token: str(payload.editToken, 64) }).then(pass);
        default:
          return rawGas(payload);
      }
    }).catch(function () { return { ok: false, error: '通信失敗' }; });
  }

  // 起動時に一度スイッチを読み、以後1分ごとに読み直す（開いたままの画面も一斉に切り替わる）
  fetchFlags();
  setInterval(fetchFlags, 60000);

  window.SUKv = { handles: handles, call: call, routed: routed, flagOf: flagOf, readRouted: readRouted,
                  handlesShift: handlesShift, callShift: callShift, _flags: function () { return flags; } };
})();
