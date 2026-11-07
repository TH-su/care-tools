/*
 * su-ho-read.js — 申送ビューアの出来事・バイタル・食事量を、新しい保存先の写しから読む入口
 *   （申し送りの移行・段1・代表者の決定 2026-11-05 案C）
 * ════════════════════════════════════════════════════════════════
 * 使い方（画面）:
 *   SUHoRead.call(action, params, gasFn)
 *   ・gasFn は「今までの Google への読み取り」をそのまま包んだ関数（引数なし・Promise を返す）。
 *     この部品は本文にも送り方にも触らない（CLAUDE.md §2-3・text/plain・redirect:'follow' は画面のまま）。
 *   ・返すのは GAS の応答を読んだ後（res.json() 後）と同じ形の物（Promise）。
 *
 * 新しい保存先（共通 DB の ho_events・ho_measures・care-backend 統合 0067・0070）から読むのは、次の全部がそろう時だけ:
 *   1. スイッチ su-backend.json の supabase.moushi_read が true
 *      （終わりの時刻 moushi_read_until があれば、su-data.js と同じ決まりで、過ぎた・読めない時は切）
 *   2. この端末の用途が現場（su_device_role=field）でない
 *   3. 事務所・管理者としてログインしている（現場・ログインなし・写し返し専用のアカウントはデータベースが 42501 で断る）
 *   4. action が 'events' か 'measures'。events は要約を返さない指定（noLedger）が付いている時だけ
 *      （要約は写していない。要約を出す設定の時は Google から読む）
 *   5. 送る引数が from・to・noLedger だけ（ほかの引数が付いた読み取りは Google）
 * それ以外の時は gasFn() をそのまま呼ぶ（スイッチが切の今は、今までと1バイトも変わらない）。
 * 新しい保存先で読めない時（通信の失敗・時間切れ・ok:false＝写しが2時間を超えて古い・42501・形の違い）も
 *   gasFn() を呼ぶ。Google が正本で、ここは写しを読むだけなので、Google へ戻してよい
 *   （CLAUDE.md §4 の「切り替えた後に Google へ流さない」は正本を切り替えた後の話）。
 * 遅れて届いた答えは、画面が今までどおり出した時の世代で捨てる（この部品は時間切れの後に届いた写しの答えを捨てる）。
 * 読んだ中身は端末に保存しない（localStorage へは書かない）。
 * 記録: 想定外の失敗（通信・時間切れ・データベースの断り・形の違い）で Google へ戻した時だけ、
 *   SUErrors.note('保存・同期の失敗', 例外, 'ho:理由') を理由ごとに1画面1回残す。予想どおりの戻り
 *   （スイッチ切・現場・ログインなし・役割が違う・写しが古い・42501）は記録しない。
 *
 * ケアログの道（申し送りの移行・段2の準備・2026-11-07。スイッチ moushi_carelog は切のまま置く）:
 *   スイッチ su-backend.json の supabase.moushi_carelog が true（終わりの時刻 moushi_carelog_until の決まりは moushi_read と同じ）で、
 *   上の 2〜5 がそろう時は、ho_events_cl・ho_measures_cl（care-backend 統合 0071）から読む。
 *   書き始めの日（施設ごと・種類ごと）より前の日は写し、後の日はケアログの記録（写しにしか無い行も1回だけ）を、GAS と同じ形で返す。
 *   moushi_read が切でも、moushi_carelog が入ならこの道を使う（ケアログの道の方が先）。
 *   ★この道で読めない時（通信の失敗・時間切れ・写しが古い・データベースの断り・形の違い・ログインしていない・使えないアカウント・
 *     ログインを確かめられない）は Google へ戻さず、失敗にする
 *     （書き始めの日から後のケアログの記録は Google に無いので、戻すと記録が抜けたまま「読めた」ように見えるため・CLAUDE.md §4）。
 *     画面は「読み込めませんでした。しばらくしてからもう一度お試しください」と出す（apiErrMsg の今の文）。
 *   現場のアカウント・現場の端末・42501（読めない役割）の時だけは、今までどおり Google から読む（申送ビューアは事務所の画面）。
 *   スイッチの確かめ: 端末の控え・自分で読んだ値のどちらかでケアログの道が入なのに1分以内に確かめていない時は、su-backend.json を読み直して
 *     から決める（この時だけ待つ。確かめずに Google から読むと記録が抜けて見えるため・反証レビュー 高1）。また、su-kv.js の無いこの画面でも
 *     ページを開いて最初の読み取りの時に1回だけ裏で su-backend.json を読む（待たない。ほかの画面を開かない端末もスイッチを知るため）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUHoRead が無ければ Google へ送る）・例外を外に出さない
 *   （ケアログの道の失敗は、画面が受け取る Promise の失敗として返す。投げはしない）。
 */
(function (root) {
  'use strict';
  if (root.SUHoRead) return;
  var FLAG = 'moushi_read';
  var FLAG_CL = 'moushi_carelog';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var FLAGS_FRESH_MS = 60000;    // スイッチを読み直す間隔（su-kv.js と同じ1分）
  var READ_MS = 12000;           // 新しい保存先の読み取り全体（ログインの確かめ・部品の読み込みを含む）の打ち切り
  var NOTE_KIND = '保存・同期の失敗';
  var RPC = { events: 'ho_events', measures: 'ho_measures' };
  var RPC_CL = { events: 'ho_events_cl', measures: 'ho_measures_cl' };
  var ARGS = { from: 1, to: 1, noLedger: 1 };
  var noted = {};

  /* ── スイッチ（su-roster.js・su-res-read.js と同じ読み方。su-kv.js があればその値）── */
  var ownFlags = null, ownAt = 0, ownPromise = null;
  function hasKv() { try { return !!(root.SUKv && typeof root.SUKv._flags === 'function'); } catch (e) { return false; } }
  var UNTIL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
  /* 純関数: su-data.js の flagOn と同じ決まり（_until の無いキーは true だけを見る）。key を省くと moushi_read */
  function flagOn(f, now, key) {
    var K = key || FLAG;
    var s = f && f.supabase;
    if (!s || typeof s !== 'object' || s[K] !== true) return false;
    if (!Object.prototype.hasOwnProperty.call(s, K + '_until')) return true;
    var u = s[K + '_until'];
    if (typeof u !== 'string' || !UNTIL_RE.test(u)) return false;
    var end = Date.parse(u);
    return typeof now === 'number' && isFinite(end) && now < end;
  }
  function refreshFlags() {
    if (hasKv()) return Promise.resolve();
    if (!ownPromise) {
      ownPromise = Promise.resolve().then(function () {
        return root.fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' });
      }).then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.supabase && typeof j.supabase === 'object') { ownFlags = { supabase: j.supabase }; ownAt = Date.now(); } })
        .catch(function () { /* 読めない時は確かめた印を付けない（入と確かめられない間は Google から読む） */ })
        .then(function () { ownPromise = null; });
    }
    return ownPromise;
  }
  function isField() { try { return root.localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; } }

  /* ── ログインの部品を必要な時だけ読む（su-res-read.js と同じ）── */
  function hasTag(name) {
    try {
      var ss = root.document.getElementsByTagName('script');
      for (var i = 0; i < ss.length; i++) if (String(ss[i].getAttribute('src') || '').split('?')[0].split('/').pop() === name) return true;
    } catch (e) { /* 何もしない */ }
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
      var s = root.document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(named('NetworkError', 'load')); };
      root.document.head.appendChild(s);
    });
  }
  function loadAuth() {
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    if (hasTag('su-auth.js')) return waitFor(function () { return !!root.SUAuth; }, 8000).then(function () { return root.SUAuth; });
    var p = root.supabase ? Promise.resolve()
      : (hasTag('supabase-js-2.112.4.js') ? waitFor(function () { return !!root.supabase; }, 8000) : loadScript('supabase-js-2.112.4.js'));
    return p.then(function () {
      if (root.SUAuth) return null;
      if (hasTag('su-auth.js')) return waitFor(function () { return !!root.SUAuth; }, 8000);
      return loadScript('su-auth.js?v=2026-10-28');
    }).then(function () { return root.SUAuth || null; });
  }

  function named(name, msg) { var e = new Error(String(msg || '-')); e.name = name; return e; }
  function note(reason, err) {
    if (noted[reason]) return;
    noted[reason] = true;
    try {
      if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note(NOTE_KIND, err, 'ho:' + reason);
    } catch (e) { /* 記録できなくても動きは止めない */ }
  }

  /* ── 形の確かめ（GAS の apiEvents（noLedger）・apiMeasures と同じキー）── */
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function rowsOk(a) { if (!isArr(a)) return false; for (var i = 0; i < a.length; i++) if (!a[i] || typeof a[i] !== 'object' || isArr(a[i])) return false; return true; }
  function datesOk(a) { if (!isArr(a)) return false; for (var i = 0; i < a.length; i++) if (typeof a[i] !== 'string') return false; return true; }
  function shapeOk(action, d) {
    if (!d || typeof d !== 'object' || isArr(d) || d.ok !== true || d.error) return false;
    if (typeof d.from !== 'string' || typeof d.to !== 'string') return false;
    if (action === 'events') return rowsOk(d.events) && datesOk(d.ingestedDates);
    return rowsOk(d.vitals) && rowsOk(d.meals) && datesOk(d.vitalDates) && datesOk(d.mealDates);
  }

  /* 写しを読む条件（スイッチ以外）がそろうか */
  function eligible(action, params) {
    if (!Object.prototype.hasOwnProperty.call(RPC, action)) return false;
    if (params != null && typeof params !== 'object') return false;
    var p = params || {};
    for (var k in p) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      if (p[k] == null || p[k] === '') continue;          // 画面も送らない値
      if (!ARGS[k]) return false;
    }
    if (action === 'events') {
      var nl = p.noLedger;
      if (!(nl === 1 || nl === true || nl === '1')) return false;   // 要約を出す時は Google（要約は写していない）
    }
    if (isField()) return false;
    return true;
  }
  function arg(v) { return (v == null || v === '') ? null : String(v); }

  /* 新しい保存先から読む。読めた時は答え・予想どおり読まない時は null・写しが古い時は STALE・想定外は例外。
     rpc は呼ぶ関数の組（RPC＝写しの道・RPC_CL＝ケアログの道） */
  var STALE = { stale: true };
  var NOLOGIN = { nologin: true };   // ログインしていない・使えないアカウント（写しの道は Google・ケアログの道は失敗）
  function readDb(action, params, rpc) {
    return loadAuth().then(function (A) {
      if (!A) throw named('NetworkError', 'noauth');
      return Promise.resolve(A.check()).then(null, function () { throw named('AuthError', 'check'); }).then(function (st) {
        var S = A.STATUS || {};
        if (!st || st.status !== S.OK) return NOLOGIN;
        if (st.role !== 'office' && st.role !== 'admin') return null;
        if (isField()) return null;   // 確かめている間に用途が現場へ変わった
        var p = params || {};
        return Promise.resolve(A.client().rpc((rpc || RPC)[action], { p_from: arg(p.from), p_to: arg(p.to) })).then(function (r) {
          if (r && r.error) {
            if (String(r.error.code || '') === '42501') return null;
            if (/fetch|network|load failed/i.test(String(r.error.message || ''))) throw named('NetworkError', 'rpc');   // supabase-js は通信の失敗を中身で返す
            throw named('DataError', String(r.error.code || 'db'));
          }
          if (isField()) return null;   // 読んでいる間に用途が現場へ変わった（届いた写しは使わない）
          var d = r && r.data;
          if (d && typeof d === 'object' && d.ok === false) return STALE;  // 写しが古い・日付が読めない（GAS と同じ断り）
          if (!shapeOk(action, d)) throw named('ShapeError', action);
          return d;
        });
      });
    });
  }
  function errName(e) {
    var n = String(e && e.name || '');
    if (/^(TimeoutError|NetworkError|AuthError|DataError|ShapeError)$/.test(n)) return n;
    if (/fetch|network|load failed/i.test(String(e && e.message || ''))) return 'NetworkError';
    return 'DataError';
  }
  /* strict（ケアログの道）: 読めない時は Google へ戻さず失敗にする。予想どおり読まない時（ログインなし・役割が違う・42501）だけ Google */
  var FAIL = { fail: true };
  function viaDb(action, params, gasFn, strict) {
    return new Promise(function (ok) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true; ok(strict ? FAIL : null);   // 遅れて届いた写しの答えは捨てる。通信の遅れは記録しない（圏外の端末で報告の種を増やさない・apiErrMsg と同じ）
      }, READ_MS);
      var p;
      try { p = readDb(action, params, strict ? RPC_CL : RPC); } catch (e) { p = Promise.reject(e); }
      p.then(function (d) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (d === STALE) { if (strict) note(action + '.cl.Stale', named('DataError', 'stale')); ok(strict ? FAIL : null); return; }
        if (d === NOLOGIN) { ok(strict ? FAIL : null); return; }   // 予想どおりの戻り（記録しない）
        ok(d);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(timer);
        var n = errName(e);
        if (n !== 'NetworkError') note(action + (strict ? '.cl.' : '.') + n, named(n, e && e.message));   // 通信の失敗は記録しない（apiErrMsg と同じ）
        ok(strict ? FAIL : null);
      });
    }).then(function (d) {
      if (d === FAIL) throw named('Error', 'carelog');   // 画面の apiErrMsg が「読み込めませんでした。…」と出す
      return d ? d : gasFn();
    });
  }

  /* スイッチの決め方（待たない。申送ビューアは読み込みの速さを優先する・CLAUDE.md §3。ケアログの道だけは確かめるまで待つ）:
   *   ・su-kv.js がある画面はその値（1分ごとに読み直されている）
   *   ・無い画面（申送ビューア）は、端末の控え（ほかの画面の su-kv.js が書く su_backend_flags）と自分で読んだ値の
   *     どちらも切なら切＝Google（その場で決める。su-backend.json はページごとに1回だけ裏で読む・2026-11-07）
   *   ・どちらかが入なら、自分で1分以内に su-backend.json を読んで入と確かめた時だけ入。確かめていない時は裏で読み直し、
   *     この回は Google から読む（切に戻した後の古い「入」の控えで写しを読まない） */
  function on(key) {
    try {
      var now = Date.now();
      if (hasKv()) return flagOn(root.SUKv._flags(), now, key);
      var cached = null;
      try { cached = JSON.parse(root.localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { cached = null; }
      if (!flagOn(cached, now, key) && !flagOn(ownFlags, now, key)) return false;
      if (!(ownAt > 0 && now - ownAt < FLAGS_FRESH_MS)) { refreshFlags(); return 'wait'; }
      return flagOn(ownFlags, now, key);
    } catch (e) { return false; }
  }
  /* GAS の合言葉（接続先）の有無はここでは見ない。画面が読み取りの前に確かめて止める（load・vmLoad） */
  var pageAsked = false;
  /* on() の答え: true・false・'wait'（入かもしれないが確かめていない）。写しの道は待たずに Google（今までどおり）、
     ケアログの道は読み直してから決める */
  function pick(again) {
    var cl = on(FLAG_CL);
    if (cl === 'wait') return again ? '' : 'wait';
    if (cl === true) return 'cl';
    return on(FLAG) === true ? 'ho' : '';
  }
  function go(way, action, params, gasFn) { return way ? viaDb(action, params, gasFn, way === 'cl') : gasFn(); }
  function call(action, params, gasFn) {
    var way = '';
    try {
      if (!pageAsked && !hasKv()) { pageAsked = true; refreshFlags(); }   // ページごとに1回だけ裏で読む（待たない）
      if (eligible(action, params)) way = pick(false);
    } catch (e) { way = ''; }
    if (way === 'wait') {
      return refreshFlags().then(function () {
        var w = '';
        try { w = pick(true); } catch (e) { w = ''; }
        return go(w, action, params, gasFn);
      });
    }
    return go(way, action, params, gasFn);
  }

  root.SUHoRead = {
    call: call,
    _flagOn: flagOn,
    _refresh: refreshFlags,   // 試験用（スイッチを読み直して待つ）
    _reset: function () { ownFlags = null; ownAt = 0; ownPromise = null; noted = {}; pageAsked = false; }
  };
})(typeof window !== 'undefined' ? window : this);
