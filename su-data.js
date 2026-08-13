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

  var LS_BACKEND_KEY = 'su_backend';     // 'gas'（既定） | 'supabase'（Phase 1で追加）
  var drivers = {};
  var cfg = {
    appId: '',              // ログ・監査用のアプリ識別子
    resolveTarget: null,    // function() -> {endpoint, token}
  };

  /* ドライバ登録。ドライバ側ファイルが読み込まれた時点で自分を差し込む。 */
  function register(name, impl) { drivers[name] = impl; }

  /* いま使うドライバ名。端末ごとに localStorage で切り替えられる＝アプリ単位・端末単位で
     ロールバックできる（これが移行の安全弁）。未知の値・未登録なら既定の gas へ落とす。 */
  function driverName() {
    try {
      var v = global.localStorage && localStorage.getItem(LS_BACKEND_KEY);
      if (v && drivers[v]) return v;
    } catch (e) { /* localStorage が使えない環境でも既定で動く */ }
    return 'gas';
  }

  function driver() {
    var n = driverName();
    var d = drivers[n];
    if (!d) {
      throw new Error('データ層の読み込みに失敗しました（ドライバ「' + n + '」が見つかりません）。'
                    + 'ページを再読み込みしてください。直らない場合は管理者へ連絡してください。');
    }
    return d;
  }

  /* 接続先の解決はアプリが持つ（アプリごとに設定の置き場所も、切替の作法も違うため）。
     毎回呼ぶ＝呼び出しの途中で接続先が切り替わる既存挙動（healStaleTarget 等）を壊さない。 */
  function target(opts) {
    if (opts && opts.endpoint) return { endpoint: opts.endpoint, token: opts.token || '' };
    if (typeof cfg.resolveTarget === 'function') {
      var t = cfg.resolveTarget() || {};
      return { endpoint: t.endpoint || '', token: t.token || '' };
    }
    return { endpoint: '', token: '' };
  }

  var SU_DATA = {
    /* ── 初期化 ──
       opts.appId        … アプリ識別子（'care-schedule' 等）
       opts.resolveTarget… function() -> {endpoint, token} */
    init: function (opts) {
      opts = opts || {};
      if (opts.appId) cfg.appId = String(opts.appId);
      if (typeof opts.resolveTarget === 'function') cfg.resolveTarget = opts.resolveTarget;
      return this;
    },

    register: register,
    driverName: driverName,
    _target: target,
    _cfg: function () { return cfg; },

    /* ── 汎用KV（統合KVストアGAS の後継）──
       care-schedule / work-schedule / weight-record / daycare-roster 等が使う。
       戻り値は現行GASの応答をそのまま返す: {ok, data, rev, error} */
    kvGet: function (key, opts) { return driver().kvGet(key, target(opts), opts || {}); },

    /* rev 不一致はGASが競合を返す。既存の競合UIをそのまま使えるよう応答は素通しする。 */
    kvPut: function (key, value, rev, opts) { return driver().kvPut(key, value, rev, target(opts), opts || {}); },

    /* ページを閉じる直前の最終送信（ベストエフォート）。
       fetch は unload で中断されるため sendBeacon を使う経路が既にあり、これも契約へ含める。
       ★戻り値は「ブラウザが送信を受け付けたか」だけ。応答は受け取れないので rev 不一致の判定は
         できない（サーバ側が rev で拒否するのが安全弁）。呼び出し側はこれを唯一の保存手段にしない。 */
    kvPutBeacon: function (key, value, rev, opts) {
      return driver().kvPutBeacon(key, value, rev, target(opts), opts || {});
    },

    /* 移行期間の逃げ道。head/list/ping など名前付き契約に無い action をそのまま通す。
       ★新しい呼び出しをこれで増やさない（増やすほど後のドライバ差し替えが重くなる）。 */
    kvRaw: function (payload, opts) { return driver().kvRaw(payload || {}, target(opts), opts || {}); },

    /* ── 入居者（master.gs の後継）── */
    listResidents: function (opts) { return driver().listResidents(target(opts), opts || {}); },
    getResident:   function (id, opts) { return driver().getResident(id, target(opts), opts || {}); },
    saveResident:  function (id, patch, opts) { return driver().saveResident(id, patch, target(opts), opts || {}); },
    getRoster:     function (opts) { return driver().getRoster(target(opts), opts || {}); },

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
      return driver().audit(action, entity, entityId, fields);
    },

    /* Phase 1 で実装。未実装であることを黙って隠さない。 */
    getAttachmentUrl: function () {
      return Promise.reject(new Error('添付の署名URLは未実装です（Phase 1 で対応）'));
    }
  };

  global.SU = global.SU || {};
  global.SU.data = SU_DATA;
})(window);
