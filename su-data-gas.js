/* su-data-gas.js — 現行GASを叩くドライバ（Phase 0）
 *
 * ★ここは「既存コードの切り出し」であって新規実装ではない。
 *   care-schedule.html の SYNC.gas / daycare-roster.html の gasCall と
 *   同じ形（text/plain で CORS preflight 回避・redirect:'follow'・res.json()）を保つ。
 *   1バイトでも形を変えると、GAS 側のリダイレクト挙動や CORS の扱いが変わりうる。
 *
 * 対応するGASは2系統:
 *   ① 統合KVストア（ワークスケジュールアプリ/gas/Code.gs）… {action:'get'|'put', key, rev, data, token}
 *   ② 入居者マスタ（テーマ gas/master.gs）           … {action:'list'|'getRoster'|'save', token, ...}
 */
(function (global) {
  'use strict';
  if (!global.SU || !global.SU.data) {
    throw new Error('su-data.js を先に読み込んでください（su-data-gas.js は契約に登録する側です）');
  }

  /* GAS への POST。全アプリで同一の形にする。
     text/plain にするのは CORS preflight を発生させないため（GAS は OPTIONS に応答しない）。 */
  function post(payload, t, opts) {   // opts は現状未使用（契約の形を揃えるため受ける）
    if (!t || !t.endpoint) return Promise.reject(new Error('同期先が未設定です'));
    var body = {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    body.token = t.token;          // 接続先の合言葉を正とする（payload 側の token では上書きさせない）
    return fetch(t.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /* ★2026-09-23: GET＋クエリの経路（getWithQuery）を廃止した。合言葉（token）が URL に載ると
     ブラウザ履歴・アクセスログ・Referer に残るため、読み取りも全部 post() の本文で送る。
     GAS の doPost は読み取り action（getRoster・getResident・getSection・stateRev 等）を受ける（gas/README.md）。
     合言葉を渡さない呼び出し（stateRev）は body.token が空のまま届き、GAS 側は認証前に応答する。
     旧呼び出しが opts.transport:'GET' を渡しても無視する（落とさない）。
     （移設時 2026-08-13 の記録: 旧 GET も res.ok を判定していた。post() も同じ判定なので画面の挙動は変わらない） */

  var GAS = {
    // ── 汎用KV ──
    kvGet: function (key, t, opts) { return post({ action: 'get', key: key }, t, opts); },

    /* rev を送って楽観ロック。GAS が競合を返したらそのまま返す（判定はアプリ側の既存UIが行う）。 */
    kvPut: function (key, value, rev, t, opts) {
      return post({ action: 'put', key: key, data: value, rev: rev }, t, opts);
    },

    /* ページを閉じる直前の最終送信。fetch は unload で中断されるため sendBeacon を使う。
       Blob の type を text/plain にするのは POST と同じ理由（CORS preflight を起こさない）。
       戻り値はブラウザが送信キューに積めたかどうかだけ＝応答は受け取れない。 */
    kvPutBeacon: function (key, value, rev, t, opts) {
      if (!t || !t.endpoint) return false;
      if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
      var body = JSON.stringify({ action: 'put', key: key, token: t.token, rev: rev, data: value });
      try {
        return navigator.sendBeacon(t.endpoint, new Blob([body], { type: 'text/plain;charset=utf-8' }));
      } catch (e) { return false; }
    },

    /* ★2026-09-23: transport:'GET' は廃止＝渡されても無視して常に POST 本文で送る（合言葉を URL に載せない）。 */
    kvRaw: function (payload, t, opts) {
      return post(payload, t);
    },

    // ── 入居者マスタ（master.gs）──
    listResidents: function (t, opts) {
      return post({ action: (opts && opts.scope === 'safe') ? 'getRoster' : 'list' }, t);
    },
    getResident: function (id, t, opts) { return post({ action: 'get', id: id }, t, opts); },
    saveResident: function (id, patch, t, opts) { return post({ action: 'save', id: id, patch: patch }, t, opts); },
    /* ★2026-09-23: transport:'GET' は廃止＝渡されても無視して常に POST 本文で送る（合言葉を URL に載せない）。 */
    getRoster: function (t, opts) {
      return post({ action: 'getRoster' }, t);
    },

    /* ── 認可コンテキスト ──
       Phase 0 は現行の端末ロール（su_device_role）をそのまま映すだけ。
       ★この値はブラウザ側にあり詐称できる。画面の出し分けにだけ使い、権限の強制には使わない
         （強制は GAS 側の合言葉判定が担っている。master.gs の _role がそれ）。 */
    context: function () {
      var role = 'office';
      try { role = localStorage.getItem('su_device_role') || 'office'; } catch (e) {}
      return {
        userRole: null,                 // Phase 1 で職員アカウントのロールが入る
        deviceTrust: (role === 'field') ? 'shared' : 'managed',
        effective: (role === 'field') ? 'safe' : 'full',
        tenantId: null,                 // Phase 1
        userId: null                    // Phase 1
      };
    },

    /* UIの出し分け用。Phase 0 は現行と同じ「現場端末は保存不可」だけを表す。 */
    can: function (action, entity) {
      var ctx = GAS.context();
      if (ctx.effective === 'safe') return action === 'view';
      return true;
    },

    /* Phase 0 は no-op。GAS 側が action/key/rev を Cloud Logging に記録済みで、
       クライアントから重ねて送っても監査の質は上がらず、通信と保存だけ増える。 */
    audit: function () { return Promise.resolve({ ok: true, skipped: 'phase0' }); }
  };

  global.SU.data.register('gas', GAS);
})(window);
