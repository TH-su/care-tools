/*
 * su-roster.js — 入居者マスタの名簿の読み取り（getRoster）を、スイッチが入った時だけ Supabase の写しから読む入口
 *   （入居者マスタの Supabase 移行・段階1・改善プロンプト第4弾の6・代表者の決定 2026-10-22）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-10-22）: 正本と書き込みは入居者マスタ（GAS・シート）のまま。名簿の「読み取り」だけを、
 *   移行 0004 の写し（master_residents）から読めるようにする。スイッチを入れる PR は後で単独で出す。
 *
 * 使い方（画面）:
 *   var raw = function () { return fetch(…getRoster…).then(function (r) { return r.json(); }); };   // 今までの読み方そのまま
 *   (window.SURoster ? SURoster.getRoster(raw, { where: 'visit' }) : raw()).then(function (j) { … j.roster … });
 *   ・返すのは getRoster と同じ形の { roster: [...] }（Promise は1回だけ解決する）。
 *   ・raw は「今までの Google への要求」をそのまま包んだ関数。この部品は中身に触らない（要求の形は1バイトも変えない）。
 *
 * 写しから読む条件（どれか1つでも欠けたら raw＝今までどおり Google）:
 *   1. スイッチ su-backend.json の supabase.master_roster_read が true
 *      （読み方は su-kv.js と同じ。su-kv.js があればその値、無ければ最後に読めた値の控え su_backend_flags）
 *   2. この端末が現場（su_device_role=field）でない
 *   3. 事務所・管理者として Google でログインしている（現場のアカウントは写しの記録 master_sync_runs を読めない＝鮮度を確かめられない）
 *   4. 写しの記録の最後の1件が失敗なし（failed 0）で、24時間以内
 *   5. 写しの行数が、その記録の正本の人数と同じ（写しにだけ残っている人がいる時は Google）
 *   6. 写しの行の形が正しい（利用者No・氏名・在籍などの型。重複なし）
 *   7. 全部で8秒以内（打ち切ったら Google。遅れて届いた写しの応答は捨てる）
 *   opts.since（差分の読み取り）が来た時も Google（写しは差分を出さない）。
 *
 * 写しから組み立てる名簿の形（getRoster の事務所の合言葉の応答と同じキー名・型）:
 *   id・name・kana・room・gender・careLevel・active・updatedAt・targetApps（カンマ区切りの文字列・未設定は ''）・
 *   birthDate・height・dischargeDate（退居者だけ・在籍者は ''）・hospitalized（写しに値がある人だけ・無い人はキーを作らない）
 *   ★主治医・訪問日・かかりつけ病院（doctor・visitDay・hospital）は写しに無いので出さない。この3つを使う画面はこの入口を通さない。
 *   ★stateRev・srev も出さない（写しは版数を持たない）。id は写しでは文字列（Google は番号のこともある）・並びは利用者No順。
 *
 * 記録: 写しを読もうとして Google へ戻した時だけ、SUErrors.note('読み取りの切り替え', 例外の名前つき, 'roster:画面.理由') を
 *   理由ごとに1画面1回残す。スイッチ切・現場・未ログインは「失敗」ではないので残さない。
 * 共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SURoster が無ければ raw を呼ぶ）・例外を外に出さない。
 */
(function () {
  'use strict';
  var FLAG = 'master_roster_read';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var TIMEOUT_MS = 8000;                      // 写しの読み取り全体（ログインの確かめ・部品の読み込みを含む）の打ち切り
  var FRESH_MS = 24 * 60 * 60 * 1000;         // 写しの記録の最後の1件がこれより古ければ Google
  var NOTE_KIND = '読み取りの切り替え';
  var COLS = 'source_id,name,kana,room,gender,care_level,active,hospitalized,discharge_date,birth_date,height,target_apps,source_updated_at';
  var noted = {};

  /* ── スイッチ（su-kv.js と同じ読み方。su-kv.js があればその値＝1分ごとに読み直されている）── */
  var ownFlags = null, ownTriedAt = 0, ownPromise = null;
  function cachedFlags() {
    try { if (window.SUKv && typeof window.SUKv._flags === 'function') return window.SUKv._flags(); } catch (e) { /* 何もしない */ }
    if (ownFlags) return ownFlags;
    try { return JSON.parse(localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { return null; }
  }
  function flagOn(f) { return !!(f && f.supabase && typeof f.supabase === 'object' && f.supabase[FLAG] === true); }
  function freshFlags() {
    // su-kv.js が無い画面だけ自分で読み直す（1分以内に読んでいればそれを使う・3秒で見切る）
    if (window.SUKv && typeof window.SUKv._flags === 'function') return Promise.resolve();
    if (ownTriedAt && Date.now() - ownTriedAt < 60000 && !ownPromise) return Promise.resolve();
    if (!ownPromise) {
      ownTriedAt = Date.now();
      ownPromise = fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.supabase && typeof j.supabase === 'object') {
            ownFlags = { supabase: j.supabase };
            try { localStorage.setItem(FLAGS_LS, JSON.stringify(ownFlags)); } catch (e) { /* 何もしない */ }
          }
        })
        .catch(function () { /* 読めない時は最後に読めた値のまま */ })
        .then(function () { ownPromise = null; });
    }
    return Promise.race([ownPromise, new Promise(function (ok) { setTimeout(ok, 3000); })]);
  }
  function isFieldDevice() { try { return localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; } }

  /* ── ログイン（su-kv.js と同じく、画面やほかの部品が入れた札があれば2本目を入れずに待つ）── */
  function hasTag(name) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) if (String(ss[i].getAttribute('src') || '').split('?')[0].split('/').pop() === name) return true;
    return false;
  }
  function waitFor(test, ms) {
    return new Promise(function (ok, ng) {
      var t0 = Date.now();
      (function poll() { if (test()) ok(); else if (Date.now() - t0 > ms) ng(named('NetworkError', 'load')); else setTimeout(poll, 100); })();
    });
  }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(named('NetworkError', 'load')); };
      document.head.appendChild(s);
    });
  }
  function ensureAuth() {
    if (window.SUAuth) return Promise.resolve();
    if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
    var p = window.supabase ? Promise.resolve()
      : (hasTag('supabase-js-2.112.4.js') ? waitFor(function () { return !!window.supabase; }, 8000) : loadScript('supabase-js-2.112.4.js'));
    return p.then(function () {
      if (window.SUAuth) return null;
      if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
      return loadScript('su-auth.js?v=2026-10-20');
    });
  }

  function named(name, msg) { var e = new Error(String(msg || '-')); e.name = name; return e; }
  function note(where, reason, err) {
    var key = where + '.' + reason;
    if (noted[key]) return;
    noted[key] = true;
    try {
      if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note(NOTE_KIND, err, 'roster:' + key);
    } catch (e) { /* 記録できなくても動きは止めない */ }
  }
  function errName(e) {
    var n = e && e.name;
    if (/^(TimeoutError|NetworkError|AuthError|DataError|StaleError|ShapeError)$/.test(String(n || ''))) return n;
    if (/fetch|network|load failed/i.test(String(e && e.message || ''))) return 'NetworkError';
    return 'DataError';
  }

  /* ── 写しの行 → getRoster の1行（同じキー名・型）。形が違えば null ── */
  function str(v) { return v == null ? '' : String(v); }
  function toRosterRow(x) {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.source_id !== 'string' || !x.source_id) return null;
    if (typeof x.name !== 'string' || typeof x.active !== 'boolean') return null;
    if (x.hospitalized != null && typeof x.hospitalized !== 'boolean') return null;
    if (x.target_apps != null && !Array.isArray(x.target_apps)) return null;
    var o = {
      id: x.source_id, name: x.name, kana: str(x.kana), room: str(x.room), gender: str(x.gender), careLevel: str(x.care_level),
      active: x.active, updatedAt: str(x.source_updated_at),
      targetApps: Array.isArray(x.target_apps) ? x.target_apps.map(str).join(',') : ''
    };
    if (typeof x.hospitalized === 'boolean') o.hospitalized = x.hospitalized;   // 写しに値がある人だけ（無い人に false を作らない）
    o.birthDate = str(x.birth_date);
    o.height = str(x.height);
    o.dischargeDate = /^\d{4}-\d{2}-\d{2}$/.test(str(x.discharge_date)) ? str(x.discharge_date) : '';
    return o;
  }
  function toRoster(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    var out = [], seen = {};
    for (var i = 0; i < rows.length; i++) {
      var o = toRosterRow(rows[i]);
      if (!o || seen[o.id]) return null;
      seen[o.id] = true;
      out.push(o);
    }
    return out;
  }

  /* 写しを読む。成功は { roster }、Google へ戻す時は reject（理由の名前つき）。ログインなし・現場のアカウントは { skip } */
  function readShadow() {
    return ensureAuth()
      .then(function () {
        return Promise.resolve(window.SUAuth.check()).then(null, function () { throw named('AuthError', 'check'); });
      })
      .then(function (st) {
        var S = window.SUAuth.STATUS;
        if (!st || st.status !== S.OK || (st.role !== 'office' && st.role !== 'admin')) return { skip: true };
        var sb = window.SUAuth.client();
        return sb.from('master_sync_runs').select('at,source_count,missing,failed').order('at', { ascending: false }).limit(1)
          .then(function (r) {
            if (r.error) throw named('DataError', r.error.code || 'runs');
            var run = Array.isArray(r.data) ? r.data[0] : null;
            var at = run ? Date.parse(run.at) : NaN;
            if (!run || !isFinite(at) || Date.now() - at > FRESH_MS) throw named('StaleError', 'old');
            if (run.failed !== 0) throw named('StaleError', 'failed');
            return sb.from('master_residents').select(COLS).order('source_id', { ascending: true }).then(function (m) {
              if (m.error) throw named('DataError', m.error.code || 'rows');
              var roster = toRoster(m.data);
              if (!roster) throw named('ShapeError', 'shape');
              if (roster.length !== run.source_count) throw named('StaleError', 'count');
              return { roster: roster };
            });
          });
      });
  }

  /**
   * 名簿を読む。gasFetch は今までの Google への読み取り（Promise で getRoster の応答を返す関数）。
   * opts.where … 記録の場所（英小文字 2〜12）・opts.since … 差分の読み取り（来たら Google）・opts.timeoutMs … 試験用
   * 戻り値は Promise（1回だけ解決。gasFetch の失敗はそのまま失敗として返す＝今までと同じ）。
   */
  function getRoster(gasFetch, opts) {
    opts = opts || {};
    var where = /^[a-z]{2,12}$/.test(String(opts.where || '')) ? opts.where : 'page';
    // スイッチが読めていて切＝今までどおり（待ちを足さない・同じ順で呼ぶ）
    var on = false;
    try { on = flagOn(cachedFlags()) && !opts.since && !isFieldDevice(); } catch (e) { on = false; }
    if (!on) return gasFetch();
    return new Promise(function (resolve, reject) {
      var settled = false, tmr = null;
      function toGas() {
        var p;
        try { p = gasFetch(); } catch (e) { reject(e); return; }
        Promise.resolve(p).then(resolve, reject);
      }
      function settle(fn) {
        if (settled) return;
        settled = true;
        if (tmr) { clearTimeout(tmr); tmr = null; }
        fn();
      }
      tmr = setTimeout(function () {
        settle(function () { note(where, 'timeout', named('TimeoutError', 'timeout')); toGas(); });
      }, typeof opts.timeoutMs === 'number' ? opts.timeoutMs : TIMEOUT_MS);
      var chain;
      try {
        chain = freshFlags().then(function () {
          if (!flagOn(cachedFlags())) return { skip: true };   // 読み直したら切だった
          return readShadow();
        });
      } catch (e) { chain = Promise.reject(e); }
      chain.then(function (res) {
        settle(function () {
          if (res && Array.isArray(res.roster)) resolve({ roster: res.roster });
          else toGas();
        });
      }, function (e) {
        settle(function () {
          var n = errName(e);
          // 理由は決まった言葉だけ（古い old・失敗の記録 failed・人数の違い count）。場所の文字に空白やデータを入れない
          var reason = n === 'TimeoutError' ? 'timeout' : n === 'NetworkError' ? 'network' : n === 'AuthError' ? 'auth'
            : n === 'ShapeError' ? 'shape'
            : n === 'StaleError' ? (/^(old|failed|count)$/.test(String(e && e.message)) ? 'stale-' + e.message : 'stale') : 'db';
          note(where, reason, named(n, reason));
          toGas();
        });
      });
    });
  }

  window.SURoster = { getRoster: getRoster, toRosterRow: toRosterRow, FLAG: FLAG, TIMEOUT_MS: TIMEOUT_MS, FRESH_MS: FRESH_MS };
})();
