/*
 * su-roster.js — 入居者マスタの名簿の読み取り（getRoster）を、スイッチが入った時だけ Supabase の写しから読む入口
 *   （入居者マスタの Supabase 移行・段階1・改善プロンプト第4弾の6・代表者の決定 2026-10-22）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-10-22）: 正本と書き込みは入居者マスタ（GAS・シート）のまま。名簿の「読み取り」だけを、
 *   移行 0004 の写し（master_residents）から読めるようにする。スイッチを入れる PR は後で単独で出す。
 *
 * 使い方（画面）:
 *   var raw = function () { return fetch(…getRoster…).then(function (r) { return r.json(); }); };   // 今までの読み方そのまま
 *   (window.SURoster ? SURoster.getRoster(raw, { where: 'visit', masterUrl: 入居者マスタの URL }) : raw()).then(function (j) { … j.roster … });
 *   ・返すのは getRoster と同じ形の { roster: [...] }（Promise は1回だけ解決する）。
 *   ・raw は「今までの Google への要求」をそのまま包んだ関数。この部品は中身に触らない（要求の形は1バイトも変えない）。
 *
 * 写しから読む条件（どれか1つでも欠けたら raw＝今までどおり Google）:
 *   1. スイッチ su-backend.json の supabase.master_roster_read が true
 *      （読み方は su-kv.js と同じ。su-kv.js があればその値、無ければ最後に読めた値の控え su_backend_flags）
 *   2. この端末が現場（su_device_role=field）でない
 *   3. 事務所・管理者として Google でログインしている（現場のアカウントは写しの記録 master_sync_runs を読めない＝鮮度を確かめられない）
 *   4. 写しの記録の最後の1件が失敗なし（failed 0）で、24時間以内
 *   5. Google の今の版数（opts.masterUrl へ action=stateRev・合言葉なし・数値2つだけ。各画面の見張りと同じ送り方）の
 *      rev と srev が、その記録の版数（state_rev・srev・移行 0019）と同じ（2026-10-22・反証レビューの指摘）。
 *      入院・退院（setState）や排泄記録からの書き戻しで版数が進んだら、写しが書き直されるまで Google から読む。
 *      版数が読めない・記録に版数が無い・opts.masterUrl が無い時も Google
 *   6. 写しの行数が、その記録の正本の人数と同じ（写しにだけ残っている人がいる時は Google）
 *   7. 写しの行の形が正しい（利用者No・氏名・在籍などの型。重複なし）
 *   8. 全部で8秒以内（打ち切ったら Google。遅れて届いた写しの応答は捨てる）
 *   opts.since（差分の読み取り）が来た時も Google（写しは差分を出さない）。
 *
 * 写しから組み立てる名簿の形（getRoster の事務所の合言葉の応答と同じキー名・型）:
 *   id・name・kana・room・gender・careLevel・active・updatedAt・targetApps（カンマ区切りの文字列・未設定は ''）・
 *   birthDate・height・dischargeDate（退居者だけ・在籍者は ''）・hospitalized（写しに値がある人だけ・無い人はキーを作らない）
 *   ★主治医（doctor）は写しに無いので出さない。訪問日・かかりつけ病院（visitDay・hospital）は、呼び出し側が
 *     opts.care を渡した時だけ出す（下の「訪問日・かかりつけ病院」）。渡さない画面には今までどおり出さない。
 *   ★stateRev・srev は、呼び出し側が opts.withRev を渡した時だけ添える（下）。渡さない画面の応答は今までどおり { roster } だけ。
 *     id は写しでは文字列（Google は番号のこともある）。
 *   ★並びは利用者No の順（数字だけの番号どうしは数の順・ほかは文字の順）。正本のシートの並びとは違う。
 *
 * 訪問日・かかりつけ病院（移行 0022・代表者の決定 2026-10-24 の決定4・アプリ間連携と軽量化 段2b。通所 利用表の☆のため）:
 *   opts.care === true の時だけ、写しの記録・本体と同時に master_residents_care（事務所・管理者だけが読める表）も読み、
 *   利用者No で visitDay・hospital を各行の最後に重ねる（getRoster の事務所の応答と同じキー名・文字列）。
 *   ・スイッチ su-backend.json の supabase.master_care_read も true の時だけ（master_roster_read が true でも、こちらが切なら Google）
 *   ・表が無い（0022 を流す前）・読めない・名簿の誰か1人でも行が無い時は、写し全体を使わず Google へ戻す（☆が黙って消えないように）。
 *     表が無い・行が無いは予想どおりの戻りで記録しない。それ以外の失敗（データベースの断り・形の違い）は roster:画面.care で記録する
 *   ・写しの部品（su-master-shadow.js）は2項目を書けなかった時に写しの記録の failed を数えるので、上の条件4で Google へ戻る
 * 版数（opts.withRev === true の時だけ）: 写しから返す時、写しの記録の state_rev（数）と srev（数に直す）を応答の stateRev・srev として添える
 *   （画面の見張りの基準用。条件5で Google の今の版数と同じと確かめた値。数値2つだけ）。Google へ戻した時は Google の応答そのまま。
 *
 * 記録: 想定外の失敗（打ち切り・ログインの確かめの失敗・通信・データベースの断り・形の違い）で Google へ戻した時だけ、
 *   SUErrors.note('保存・同期の失敗', 例外の名前つき, 'roster:画面.理由') を理由ごとに1画面1回残す
 *   （su-report.js の「場所ごとに1件・合計3件」の扱いに入る）。予想どおりの戻り（スイッチ切・現場・未ログイン・
 *   古い写し・版数の違い・人数の違い）は記録しない（2026-10-22・反証レビューの指摘）。
 * 共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SURoster が無ければ raw を呼ぶ）・例外を外に出さない。
 */
(function () {
  'use strict';
  var FLAG = 'master_roster_read';
  var CARE_FLAG = 'master_care_read';         // 訪問日・かかりつけ病院も写しから読むスイッチ（opts.care の時だけ見る・無ければ切）
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var TIMEOUT_MS = 8000;                      // 写しの読み取り全体（ログインの確かめ・部品の読み込みを含む）の打ち切り
  var FRESH_MS = 24 * 60 * 60 * 1000;         // 写しの記録の最後の1件がこれより古ければ Google
  var NOTE_KIND = '保存・同期の失敗';         // su-report.js の NOTE_KIND と同じ（場所ごとに1件・合計3件の扱い）
  var COLS = 'source_id,name,kana,room,gender,care_level,active,hospitalized,discharge_date,birth_date,height,target_apps,source_updated_at';
  var CARE_TABLE = 'master_residents_care';
  var CARE_COLS = 'source_id,visit_day,hospital';
  var noted = {};

  /* ── スイッチ（su-kv.js と同じ読み方。su-kv.js があればその値＝1分ごとに読み直されている）── */
  var ownFlags = null, ownTriedAt = 0, ownPromise = null;
  function cachedFlags() {
    try { if (window.SUKv && typeof window.SUKv._flags === 'function') return window.SUKv._flags(); } catch (e) { /* 何もしない */ }
    if (ownFlags) return ownFlags;
    try { return JSON.parse(localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { return null; }
  }
  function flagOn(f) { return !!(f && f.supabase && typeof f.supabase === 'object' && f.supabase[FLAG] === true); }
  function careFlagOn(f) { return !!(f && f.supabase && typeof f.supabase === 'object' && f.supabase[CARE_FLAG] === true); }
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
      return loadScript('su-auth.js?v=2026-10-24');
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
    if (/^(TimeoutError|NetworkError|AuthError|DataError|ShapeError)$/.test(String(n || ''))) return n;
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
  /* 利用者No の並び: 数字だけの番号どうしは数の順、ほかは文字の順（データベースの並びは文字の順で、10 が 9 より前に来るため） */
  function byId(a, b) {
    var x = a.id, y = b.id, dx = /^\d+$/.test(x), dy = /^\d+$/.test(y);
    if (dx && dy) { var nx = Number(x), ny = Number(y); if (nx !== ny) return nx < ny ? -1 : 1; }
    else if (dx !== dy) return dx ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
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
    return out.sort(byId);
  }

  /* Google の今の版数（各画面の見張りと同じ送り方: GET・合言葉なし・応答は {ok, rev, srev} の数値だけ）。
     読めた時は { rev, srev }、形が違えば null（予想どおりの戻り）。通信の失敗は NetworkError で reject */
  function readGasRev(masterUrl) {
    var url = masterUrl + (masterUrl.indexOf('?') >= 0 ? '&' : '?') + 'action=stateRev';
    return fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' })
      .then(function (r) { return r.json(); }, function () { throw named('NetworkError', 'rev'); })
      .then(function (j) {
        if (!j || j.ok !== true || typeof j.rev !== 'number' || !isFinite(j.rev) || typeof j.srev !== 'number' || !isFinite(j.srev)) return null;
        return { rev: j.rev, srev: j.srev };
      }, function (e) { if (e && e.name === 'NetworkError') throw e; return null; });
  }
  function sameRev(run, g) {
    if (!g || typeof run.state_rev !== 'number' || run.srev == null) return false;
    return run.state_rev === g.rev && String(run.srev) === String(g.srev);
  }

  /* 訪問日・かかりつけ病院の表が無い（0022 を流す前）の断り。PostgREST の PGRST205・PGRST202 と PostgreSQL の 42P01 */
  function noCareTable(err) {
    var c = String(err && err.code || ''), m = String(err && err.message || '');
    return c === 'PGRST205' || c === 'PGRST202' || c === '42P01' || (/master_residents_care/.test(m) && /does not exist|could not find/i.test(m));
  }
  function careErr(name, msg) { var e = named(name, msg); e.suReason = 'care'; return e; }
  /* 名簿の各行に visitDay・hospital を重ねる（新しい行を作って返す）。誰か1人でも行が無ければ null（予想どおりの戻り）。
     形が違えば ShapeError（理由 care）を投げる */
  function overlayCare(roster, data) {
    if (!Array.isArray(data)) throw careErr('ShapeError', 'care');
    var by = {};
    for (var i = 0; i < data.length; i++) {
      var c = data[i];
      if (!c || typeof c.source_id !== 'string' || typeof c.visit_day !== 'string' || typeof c.hospital !== 'string' || by[c.source_id]) {
        throw careErr('ShapeError', 'care');
      }
      by[c.source_id] = c;
    }
    var out = [];
    for (var j = 0; j < roster.length; j++) {
      var c2 = by[roster[j].id];
      if (!c2) return null;
      var o = {};
      for (var k in roster[j]) if (Object.prototype.hasOwnProperty.call(roster[j], k)) o[k] = roster[j][k];
      o.visitDay = c2.visit_day;
      o.hospital = c2.hospital;
      out.push(o);
    }
    return out;
  }
  /* 写しの記録の版数を応答に添える形（数値2つ）。数に直せなければ null */
  function revOfRun(run) {
    var sv = Number(run.srev);
    if (typeof run.state_rev !== 'number' || !isFinite(run.state_rev) || !/^\d+(\.\d+)?$/.test(String(run.srev)) || !isFinite(sv)) return null;
    return { stateRev: run.state_rev, srev: sv };
  }

  /* 写しを読む。成功は { roster }（want.withRev なら stateRev・srev も）。予想どおりの戻り（ログインなし・現場のアカウント・古い写し・
     版数の違い・人数の違い・訪問日の表が無い／行が無い）は { skip: 理由 }＝記録しない。想定外の失敗は reject（理由の名前つき）＝記録する */
  function readShadow(masterUrl, want) {
    want = want || {};
    // Google の版数は、ログインの確かめと同時に聞く（待ち時間を重ねない）。結果は写しの記録と比べる時に使う
    var gasRev = readGasRev(masterUrl);
    gasRev.then(null, function () { /* 比べる時に受け取る（ここでは未処理の失敗にしない） */ });
    return ensureAuth()
      .then(function () {
        return Promise.resolve(window.SUAuth.check()).then(null, function () { throw named('AuthError', 'check'); });
      })
      .then(function (st) {
        var S = window.SUAuth.STATUS;
        if (!st || st.status !== S.OK || (st.role !== 'office' && st.role !== 'admin')) return { skip: 'login' };
        var sb = window.SUAuth.client();
        // 写しの記録と写しの本体は同時に取る（2026-10-24・アプリ間連携の見直し 段2）。判定は今までと同じ順で、
        // 記録が古い・失敗あり・版数の違いの時は本体を見ずに捨てて Google へ戻す（本体の失敗も記録しない＝今までと同じ）
        var runsP = Promise.resolve(sb.from('master_sync_runs').select('at,source_count,missing,failed,state_rev,srev').order('at', { ascending: false }).limit(1));
        var rowsP = Promise.resolve(sb.from('master_residents').select(COLS).order('source_id', { ascending: true }));
        rowsP.then(null, function () { /* 使う時に受け取る（捨てる時は未処理の失敗にしない） */ });
        // 訪問日・かかりつけ病院（opts.care の時だけ）も同時に取る。使わない時（記録が古い等）は捨てる
        var careP = want.care ? Promise.resolve(sb.from(CARE_TABLE).select(CARE_COLS)) : null;
        if (careP) careP.then(null, function () { /* 使う時に受け取る */ });
        return runsP
          .then(function (r) {
            if (r.error) throw named('DataError', r.error.code || 'runs');
            var run = Array.isArray(r.data) ? r.data[0] : null;
            var at = run ? Date.parse(run.at) : NaN;
            if (!run || !isFinite(at) || Date.now() - at > FRESH_MS) return { skip: 'old' };
            if (run.failed !== 0) return { skip: 'failed' };
            return gasRev.then(function (g) {
              if (!sameRev(run, g)) return { skip: 'rev' };
              return rowsP.then(function (m) {
                if (m.error) throw named('DataError', m.error.code || 'rows');
                var roster = toRoster(m.data);
                if (!roster) throw named('ShapeError', 'shape');
                if (roster.length !== run.source_count) return { skip: 'count' };
                var revs = null;
                if (want.withRev) { revs = revOfRun(run); if (!revs) return { skip: 'rev' }; }
                var done = function (rs) {
                  var out = { roster: rs };
                  if (revs) { out.stateRev = revs.stateRev; out.srev = revs.srev; }
                  return out;
                };
                if (!careP) return done(roster);
                return careP.then(function (c) {
                  if (c && c.error) {
                    if (noCareTable(c.error)) return { skip: 'care' };   // 0022 を流す前＝予想どおり（記録しない）
                    throw careErr('DataError', c.error.code || 'care');
                  }
                  var withCare = overlayCare(roster, c && c.data);
                  if (!withCare) return { skip: 'care' };              // 写しの行がまだ無い人がいる（入居者マスタを開く前）
                  return done(withCare);
                }, function () { throw careErr('NetworkError', 'care'); });
              });
            });
          });
      });
  }

  /**
   * 名簿を読む。gasFetch は今までの Google への読み取り（Promise で getRoster の応答を返す関数）。
   * opts.where … 記録の場所（英小文字 2〜12）・opts.masterUrl … 入居者マスタの GAS の URL（https・版数を聞く先。無ければ Google）・
   * opts.since … 差分の読み取り（来たら Google）・opts.timeoutMs … 試験用・
   * opts.care … true なら訪問日・かかりつけ病院も重ねる（スイッチ master_care_read も要る）・opts.withRev … true なら写しの版数を添える
   * 戻り値は Promise（1回だけ解決。gasFetch の失敗はそのまま失敗として返す＝今までと同じ）。
   */
  function getRoster(gasFetch, opts) {
    opts = opts || {};
    var where = /^[a-z]{2,12}$/.test(String(opts.where || '')) ? opts.where : 'page';
    // スイッチが読めていて切＝今までどおり（待ちを足さない・同じ順で呼ぶ）
    var on = false;
    var masterUrl = /^https:\/\//i.test(String(opts.masterUrl || '')) ? String(opts.masterUrl) : '';
    var want = { care: opts.care === true, withRev: opts.withRev === true };
    try { on = flagOn(cachedFlags()) && (!want.care || careFlagOn(cachedFlags())) && !opts.since && !isFieldDevice() && !!masterUrl; } catch (e) { on = false; }
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
          var f = cachedFlags();
          if (!flagOn(f) || (want.care && !careFlagOn(f))) return { skip: 'off' };   // 読み直したら切だった
          return readShadow(masterUrl, want);
        });
      } catch (e) { chain = Promise.reject(e); }
      chain.then(function (res) {
        settle(function () {
          if (res && Array.isArray(res.roster)) {
            var out = { roster: res.roster };
            if (want.withRev && typeof res.stateRev === 'number' && typeof res.srev === 'number') { out.stateRev = res.stateRev; out.srev = res.srev; }
            resolve(out);
          }
          else toGas();
        });
      }, function (e) {
        settle(function () {
          var n = errName(e);
          // 理由は決まった言葉だけ。場所の文字に空白やデータを入れない
          var reason = (e && e.suReason === 'care') ? 'care'
            : n === 'TimeoutError' ? 'timeout' : n === 'NetworkError' ? 'network' : n === 'AuthError' ? 'auth'
            : n === 'ShapeError' ? 'shape' : 'db';
          note(where, reason, named(n, reason));
          toGas();
        });
      });
    });
  }

  window.SURoster = { getRoster: getRoster, toRosterRow: toRosterRow, FLAG: FLAG, CARE_FLAG: CARE_FLAG, TIMEOUT_MS: TIMEOUT_MS, FRESH_MS: FRESH_MS };
})();
