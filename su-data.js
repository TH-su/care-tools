/* su-data.js — 介護ツール共通のデータアクセス契約（Phase 0）
 *
 * 目的: 各アプリに散らばっている fetch を1つの契約の内側へ寄せ、後からバックエンドを
 *       差し替えられるようにする。Phase 0 では中身は現行GASのまま＝挙動は完全に同一。
 *
 * ★Phase 0 の不変条件（統合設計書 §8 / Phase0-1実装設計書 §3.1）
 *   1. HTML・印刷CSS・DOM構築ロジックは1行も変えない。変更はI/O関数の内側に閉じる
 *   2. ビルドツールを入れない。素の <script src> 1本で読み込む
 *   3. rev 楽観ロックは現行の統合KVストアGASの仕様をそのまま踏襲する
 *
 * ★線引き（設計書 §3.4）
 *   「どこへ書くか」＝このアダプタ。「書いてよいか」＝アプリ側。
 *   試算モードの遮断・サンプル上書き拒否・書込検証などの安全装置は
 *   ドメイン知識なのでアプリ側に残す。ここには持ち込まない。
 *
 * 読み込み方: <script src="su-data.js"></script><script src="su-data-gas.js"></script>
 *             （契約→ドライバの順。ドライバは自分を register する）
 */
(function (global) {
  'use strict';

  /* 二重読み込み対策。'su-data.js' と 'su-data.js?v=…' の両方が読まれると、後から評価された方が
     drivers 空の新インスタンスで上書きし、登録済みドライバが消える（＝全通信が失敗する）。
     先に居る方を正として2回目は何もしない。 */
  if (global.SU && global.SU.data) return;

  var LS_BACKEND_KEY = 'su_backend';     // 'gas'（既定） | 'supabase'（Phase 1で追加）
  var drivers = {};
  var cfg = {
    appId: '',              // ログ・監査用のアプリ識別子
    resolveTarget: null,    // function() -> {endpoint, token}
    gasAuth: false          // resolveTarget の GAS が読み取りでログインの証明を確かめるか（init の gasAuth:true・2026-10-29）
  };

  /* ドライバ登録。ドライバ側ファイルが読み込まれた時点で自分を差し込む。 */
  function register(name, impl) { drivers[name] = impl; }

  /* いま使うドライバ名。端末ごとに localStorage で切り替えられる＝アプリ単位・端末単位で
     ロールバックできる（これが移行の安全弁）。未知の値・未登録なら既定の gas へ落とす。
     ★2026-10-27（M1 段0）: supabase の道は名前付きの入口（下の training 等）からだけ使う。
       端末の su_backend が 'supabase' でも、入口を通らない呼び出し（kvGet・kvPut・kvRaw・入居者の4つ・context 等）は
       gas のまま＝入居者マスタの GAS 宛ての呼び出しが巻き込まれない（設計 v3 2.2 の2）。 */
  function driverName() {
    try {
      var v = global.localStorage && localStorage.getItem(LS_BACKEND_KEY);
      if (v && v !== 'supabase' && drivers[v]) return v;
    } catch (e) { /* localStorage が使えない環境でも既定で動く */ }
    return 'gas';
  }

  /* ── 名前付きの入口の道（2026-10-27・M1 段0 の設計 v3 2.2 の2〜4）──
     入口ごとに切り替えスイッチ su-backend.json の supabase.<キー>（例 training）を見て道を決める。
     true の時だけ supabase の道。false・無い・一度も読めていない・supabase の道が読み込まれていない時は gas の道。
     スイッチの値は su-kv.js・su-patch-sync.js と同じ控え（localStorage su_backend_flags）を同期で読む＝呼び出しを待たせない。
     読み直しは supabase の道が読み込まれているページで入口が呼ばれた時だけ・1分に1回（読み込んだだけでは通信しない）。
     ★スイッチが入なのに supabase の道で断られた時は Google へ流さない（CLAUDE.md §4）。 */
  var FLAGS_URL = 'su-backend.json', FLAGS_LS = 'su_backend_flags';
  var flagsTriedAt = 0, flagsBusy = false;
  function readFlags() {
    try { var j = JSON.parse(global.localStorage.getItem(FLAGS_LS) || 'null'); return (j && j.supabase && typeof j.supabase === 'object') ? j.supabase : null; }
    catch (e) { return null; }
  }
  function refreshFlags() {
    if (flagsBusy || (flagsTriedAt && Date.now() - flagsTriedAt < 60000)) return;
    if (typeof global.fetch !== 'function') return;
    flagsTriedAt = Date.now(); flagsBusy = true;
    try {
      global.fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.supabase && typeof j.supabase === 'object') {
            try { global.localStorage.setItem(FLAGS_LS, JSON.stringify({ supabase: j.supabase })); } catch (e) { /* 何もしない */ }
          }
        })
        .catch(function () { /* 読めない時は最後に読めた値のまま */ })
        .then(function () { flagsBusy = false; });
    } catch (e) { flagsBusy = false; }
  }
  function entryRoute(flag) {
    if (!drivers.supabase) return 'gas';
    refreshFlags();
    var f = readFlags();
    return (f && f[flag] === true) ? 'supabase' : 'gas';
  }
  /* supabase の道へは「入口の名前・関数の名前・引数」をそのまま渡す（道の側で表と関数に読み替える） */
  function entryCall(flag, group, method, args, gasFn) {
    if (entryRoute(flag) === 'supabase') {
      var s = drivers.supabase;
      try { return Promise.resolve(s.entry(group, method, args)); }
      catch (e) { return Promise.reject(e); }
    }
    return gasFn();
  }

  function driverError() {
    return new Error('データ層を読み込めていません（su-data-gas.js）。ページを再読み込みしてください。'
                   + '直らない場合は管理者へ連絡してください。');
  }
  function driver() {
    var d = drivers[driverName()];
    if (!d) throw driverError();
    return d;
  }
  /* 非同期APIは「同期 throw」しないで必ず Promise を返す。
     ★ここが要点: 呼び出し側は `busy = true; api().then(...).catch(...)` の形で書かれており、
       同期に throw すると .catch が付く前に抜けて busy フラグが立ちっぱなしになる
       （＝その機能がセッション中ずっと止まる）。改修前の fetch は同期 throw しなかったので、
       ここで throw すると新しい壊れ方を増やすことになる。 */
  function call(method, args) {
    var d = drivers[driverName()];
    if (!d) return Promise.reject(driverError());
    try { return Promise.resolve(d[method].apply(d, args)); }
    catch (e) { return Promise.reject(e); }
  }

  /* 接続先の解決はアプリが持つ（アプリごとに設定の置き場所も、切替の作法も違うため）。
     毎回呼ぶ＝呼び出しの途中で接続先が切り替わる既存挙動（healStaleTarget 等）を壊さない。 */
  /* 接続先が明示されているのに空だった場合は、既定の接続先へ落とさない。
     落とすと「入居者マスタへ送るつもりの要求が、統合KVストアの接続先へ合言葉ごと飛ぶ」ことになり、
     GET経路では合言葉がURLのクエリに載る（URLはログに残りうる）。混ぜずにエラーにする。 */
  var MISSING_TARGET = '__su_missing_target__';
  function target(opts) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'endpoint')) {
      if (!opts.endpoint) return { endpoint: MISSING_TARGET, token: '' };
      return { endpoint: opts.endpoint, token: opts.token || '' };
    }
    if (typeof cfg.resolveTarget === 'function') {
      var t = cfg.resolveTarget() || {};
      return { endpoint: t.endpoint || '', token: t.token || '' };
    }
    return { endpoint: '', token: '' };
  }
  function badTarget(t) { return !t || t.endpoint === MISSING_TARGET; }
  /* ドライバへ渡す opts（2026-10-29・代表者の決定）。ログインの証明を添えてよい宛先の時だけ gasAuth:true の印を付ける。
     印を付けるのは、呼び手が opts.gasAuth:true を渡した時と、接続先を明示せず resolveTarget を使い、そのアプリが init で gasAuth:true を宣言した時だけ。
     統合 KV など、印の無い宛先には何も添えない（宛先は URL の文字で推し量らない）。印は本文には入らない */
  function drvOpts(opts) {
    var o = {}, k;
    if (opts && typeof opts === 'object') for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    var explicit = !!(opts && Object.prototype.hasOwnProperty.call(opts, 'endpoint'));
    if (o.gasAuth !== true && !explicit && cfg.gasAuth === true) o.gasAuth = true;
    return o;
  }
  /* 名前付きの入口（訓練計画書）から送る時の印。宛先は訓練計画書の GAS と決まっている */
  function authed(opts) {
    var o = {}, k;
    if (opts && typeof opts === 'object') for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.gasAuth = true;
    return o;
  }

  var SU_DATA = {
    /* ── 初期化 ──
       opts.appId        … アプリ識別子（'care-schedule' 等）
       opts.resolveTarget… function() -> {endpoint, token} */
    init: function (opts) {
      opts = opts || {};
      if (opts.appId) cfg.appId = String(opts.appId);
      if (typeof opts.resolveTarget === 'function') cfg.resolveTarget = opts.resolveTarget;
      if (opts.gasAuth === true) cfg.gasAuth = true;
      return this;
    },

    register: register,
    driverName: driverName,
    _target: target,
    _cfg: function () { return cfg; },

    /* ── 汎用KV（統合KVストアGAS の後継）──
       care-schedule / work-schedule / weight-record / daycare-roster 等が使う。
       戻り値は現行GASの応答をそのまま返す: {ok, data, rev, error} */
    kvGet: function (key, opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('kvGet', [key, t, drvOpts(opts)]); },

    /* rev 不一致はGASが競合を返す。既存の競合UIをそのまま使えるよう応答は素通しする。 */
    kvPut: function (key, value, rev, opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('kvPut', [key, value, rev, t, drvOpts(opts)]); },

    /* ページを閉じる直前の最終送信（ベストエフォート）。
       fetch は unload で中断されるため sendBeacon を使う経路が既にあり、これも契約へ含める。
       ★戻り値は「ブラウザが送信を受け付けたか」だけ。応答は受け取れないので rev 不一致の判定は
         できない（サーバ側が rev で拒否するのが安全弁）。呼び出し側はこれを唯一の保存手段にしない。 */
    kvPutBeacon: function (key, value, rev, opts) {
      var t = target(opts);
      if (badTarget(t)) return false;
      try { return drivers[driverName()].kvPutBeacon(key, value, rev, t, opts || {}); }
      catch (e) { return false; }   /* 閉じる直前の処理を例外で止めない */
    },

    /* 移行期間の逃げ道。head/list/ping など名前付き契約に無い action をそのまま通す。
       ★新しい呼び出しをこれで増やさない（増やすほど後のドライバ差し替えが重くなる）。 */
    kvRaw: function (payload, opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('kvRaw', [payload || {}, t, drvOpts(opts)]); },

    /* ── 入居者（master.gs の後継）── */
    listResidents: function (opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('listResidents', [t, opts || {}]); },
    getResident:   function (id, opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('getResident', [id, t, opts || {}]); },
    saveResident:  function (id, patch, opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('saveResident', [id, patch, t, opts || {}]); },
    getRoster:     function (opts) { var t = target(opts); return badTarget(t)
      ? Promise.reject(new Error('同期先が未設定です')) : call('getRoster', [t, opts || {}]); },

    /* ── 認可コンテキスト ──
       Phase 0 では現行の端末ロールをそのまま返すだけ＝画面の出し分けは変わらない。
       ★UIの出し分け用であって、強制はサーバ側（Phase 1 で RLS が担う）。 */
    context: function () { return driver().context(); },
    can: function (action, entity) { return driver().can(action, entity); },

    /* ── 監査 ──
       Phase 0 は no-op。統合KVストアGAS が action/key/rev を Cloud Logging に記録しており、
       クライアントから二重に送ると要配慮情報の第二のコピーを増やすだけになるため。
       Phase 1 で audit_log テーブルへ書く実装に差し替える。 */
    audit: function (action, entity, entityId, fields) {
      return call('audit', [action, entity, entityId, fields]);
    },

    /* ── 訓練計画書（個別機能訓練計画書の専用GAS）の名前付きの入口（2026-10-27・M1 段0）──
       スイッチのキーは training（AI の中継だけは training_ai）。gas の道では今までと同じ action を同じ本文で送る
       （本文のキーの並びも同じ＝GAS に届く文字列は置き換え前と一字一句同じ。check/unit/su_data_entry_test.js が確かめる）。
       入居者マスタ宛ての呼び出し（getRoster・getResident・getBulk・getSection）はここに入れない（kvRaw に入居者マスタの接続先を渡す形のまま）。 */
    training: {
      /* 計画書・索引の読み取り {action:'get', key} */
      get: function (key, opts) {
        return entryCall('training', 'training', 'get', [key, opts], function () { return SU_DATA.kvGet(key, authed(opts)); });
      },
      /* 保存 {action:'put', key, data, rev[, allowDrop:true][, accessToken]}。extra.allowDrop は「完全に削除」の1回だけ。
         extra.accessToken はログインの証明（ある時だけ本文に添える） */
      put: function (key, data, rev, extra, opts) {
        return entryCall('training', 'training', 'put', [key, data, rev, extra, opts], function () {
          var body = { action: 'put', key: key, data: data, rev: rev };
          if (extra && extra.allowDrop === true) body.allowDrop = true;
          if (extra && extra.accessToken) body.accessToken = extra.accessToken;
          return SU_DATA.kvRaw(body, authed(opts));
        });
      },
      /* ページを閉じる直前の最終送信。戻り値は送信を受け付けたかだけ。supabase の道では送らない（false） */
      putBeacon: function (key, value, rev, opts) {
        if (entryRoute('training') === 'supabase') return false;
        return SU_DATA.kvPutBeacon(key, value, rev, opts);
      },
      /* 接続の確かめ・守り一覧 {action:'ping'} */
      ping: function (opts) {
        return entryCall('training', 'training', 'ping', [opts], function () { return SU_DATA.kvRaw({ action: 'ping' }, authed(opts)); });
      },
      /* AI の中継 {action:'ai', body} */
      ai: function (body, opts) {
        return entryCall('training_ai', 'training', 'ai', [body, opts], function () { return SU_DATA.kvRaw({ action: 'ai', body: body }, authed(opts)); });
      }
    },
    _entryRoute: entryRoute,

    /* Phase 1 で実装。未実装であることを黙って隠さない。 */
    getAttachmentUrl: function () {
      return Promise.reject(new Error('添付の署名URLは未実装です（Phase 1 で対応）'));
    }
  };

  global.SU = global.SU || {};
  global.SU.data = SU_DATA;
})(window);
