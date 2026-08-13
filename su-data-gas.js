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

  /* GET 取得（キャッシュを踏まない読み取り。既存の no-store 指定をそのまま維持）。
     入居者マスタ(master.gs)は GET + クエリ文字列の形で叩かれている経路があるため、
     payload をクエリへ組み立てる。token は接続先に入っている時だけ載せる
     （stateRev のように合言葉不要＝個人情報を返さない口があるため、無条件には付けない）。
     ★改修前との差（意図的・2026-08-13）: 移設前の GET 2箇所は res.ok を見ずに r.json() へ流していた。
       ここでは POST 側と同じく res.ok を判定する。500 等が返ったとき、移設前は JSON 解析の失敗、
       移設後は 'HTTP 500' の例外になる。どちらも呼び出し側の同じ .catch に入るため画面の挙動は
       変わらないが、「完全同一」ではないので記録に残す。POST と GET で判定が食い違う方が危うい。 */
  function getWithQuery(t, payload) {
    if (!t || !t.endpoint) return Promise.reject(new Error('同期先が未設定です'));
    var qs = [];
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      if (payload[k] === undefined || payload[k] === null) continue;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]));
    }
    if (t.token) qs.push('token=' + encodeURIComponent(t.token));
    var url = t.endpoint + (t.endpoint.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
    return fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

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

    /* transport:'GET' を渡すと GET+クエリ形式で送る（入居者マスタの一部経路がこの形）。 */
    kvRaw: function (payload, t, opts) {
      if (opts && opts.transport === 'GET') return getWithQuery(t, payload);
      return post(payload, t);
    },

    // ── 入居者マスタ（master.gs）──
    listResidents: function (t, opts) {
      return post({ action: (opts && opts.scope === 'safe') ? 'getRoster' : 'list' }, t);
    },
    getResident: function (id, t, opts) { return post({ action: 'get', id: id }, t, opts); },
    saveResident: function (id, patch, t, opts) { return post({ action: 'save', id: id, patch: patch }, t, opts); },
    getRoster: function (t, opts) {
      if (opts && opts.transport === 'GET') return getWithQuery(t, { action: 'getRoster' });
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
