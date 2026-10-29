/* su-data-supabase.js — 共通データ部品の Supabase の道（2026-10-27・M1 段0 の設計 v3 2.2 の1〜4／2026-10-29 計画書の道）
 *
 * ★この道を使うのは su-data.js の名前付きの入口（SU.data.training 等）だけ。入口を通らない呼び出し
 *   （kvGet・kvPut・kvRaw・入居者の4つ・context・can・audit）は端末の su_backend が何であっても gas の道のまま。
 * ★KV の箱（週間計画・ワークスケジュール・勤務表）は持たない。su-kv.js が正（Google への写し返しも su-kv.js）。
 *
 * ── 個別機能訓練計画書（入口 training の get・put・ping・2026-10-29 代表者の決定「入居者マスタと同じ作り方で進める」）──
 *   スイッチ training が入の時にここへ来る。データベースの印（tp_mode・統合 0038）を読み（1分の控え）、
 *   ・「切り替える前」（shadow）・0038 の前（関数が無い）なら、渡された gas の道の関数をそのまま呼ぶ（本文・送り方は1バイトも変えない）
 *   ・「切り替えた後」（live）なら、サーバーの小さなプログラム tp-write（計画書の GAS をそのまま動かす）へ同じ本文を送る。応答は GAS と同じ形
 *     保存できたら、計画書の GAS へ写し返し（tpMirror）を送る（待たない・送っている間の次の保存は終わった後に1回だけ）
 *   ・ログインしていない・印を読めない・届かない時は失敗にし、Google へ流さない（スイッチが入なのに Google へ流すと保存先が2つに割れる・CLAUDE.md §4）
 *   AI の中継（training_ai）はまだこの道に無い（「まだ使えません」で断る）。
 *
 * 読み込み方: su-data.js → su-data-gas.js → su-data-supabase.js の順（gas の道が先に居る＝これが読めなくても gas で動く）
 */
(function (global) {
  'use strict';
  if (!global.SU || !global.SU.data || typeof global.SU.data.register !== 'function') return;  /* 読めなくても画面は gas で動く */

  var NOT_YET = '新しい保存先（Supabase）はまだ使えません。管理者へ連絡してください。';
  var CALL_MS = 40000;

  function fail(text, code) { var e = new Error(text); e.code = code || 'supabase'; return e; }
  function note(where, e) {
    try { if (global.SUErrors && typeof global.SUErrors.note === 'function') global.SUErrors.note('計画書の新しい保存先: ' + where, e && e.message || e); } catch (x) { /* 記録できなくても止めない */ }
  }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = global.document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      global.document.head.appendChild(s);
    });
  }
  function loadAuth() {
    if (global.SUAuth) return Promise.resolve(global.SUAuth);
    if (!global.document || !global.document.head) return Promise.resolve(null);
    var p = global.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return global.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return global.SUAuth || null; });
  }

  /* データベースの印（1分の控え）。0038 の前（関数が無い）は 'shadow' */
  var modeCache = null, modeAt = 0;
  function tpMode(A) {
    if (modeCache && Date.now() - modeAt < 60000) return Promise.resolve(modeCache);
    return Promise.resolve(A.client().rpc('tp_mode_get')).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
      if (c === '42501') throw fail('計画書を開く権限がありません。ログインし直してください。', c);
      if (!r || r.error || !r.data) throw fail('新しい保存先の状態を読めませんでした。少し待ってから、もう一度お試しください。', 'db');
      modeCache = r.data.mode === 'live' ? 'live' : 'shadow'; modeAt = Date.now();
      return modeCache;
    });
  }

  /* tp-write へ送る。断り（{ok:false, error, code}）は GAS と同じ形のまま返す。届かない・時間切れは失敗 */
  function invoke(A, body) {
    var call = Promise.resolve(A.client().functions.invoke('tp-write', { body: body }));
    var timer = new Promise(function (ok) { setTimeout(function () { ok({ timeout: true }); }, CALL_MS); });
    return Promise.race([call, timer]).then(function (r) {
      if (r && r.timeout) throw fail('新しい保存先の応答がありません（時間切れ）。保存されたか、画面を開き直して確かめてください。', 'timeout');
      if (r && r.error) {
        var ctx = r.error.context;
        return Promise.resolve(ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null).then(function (d) {
          if (d && typeof d === 'object' && d.error) {
            if (d.code === 'shadow') { modeCache = null; }   // 印が変わった＝次は読み直す
            return d;
          }
          throw fail('新しい保存先に届きませんでした。保存されたか、画面を開き直して確かめてください。', 'network');
        });
      }
      return r ? r.data : null;
    });
  }

  /* Google への写し返し（保存できた後・待たない）。1本ずつ送り、送っている間の次の保存は終わった後に1回だけ */
  var mirroring = null, mirrorAgain = false;
  function mirrorSoon(A, opts) {
    if (mirroring) { mirrorAgain = true; return mirroring; }
    mirroring = Promise.resolve(A.client().auth.getSession()).then(function (s) {
      var at = s && s.data && s.data.session && s.data.session.access_token;
      if (!at || !global.SU.data || typeof global.SU.data.kvRaw !== 'function') return null;
      return global.SU.data.kvRaw({ action: 'tpMirror', accessToken: at }, opts).then(function (j) {
        if (!j || j.ok !== true) note('Google が写し返しを受け付けませんでした', j && j.error);
        else if (j.more === true) mirrorAgain = true;
        return j;
      });
    }).catch(function (e) { note('写し返しを送れませんでした', e); return null; }).then(function (j) {
      mirroring = null;
      if (mirrorAgain) { mirrorAgain = false; return mirrorSoon(A, opts); }
      return j;
    });
    return mirroring;
  }

  function trainingBody(method, args) {
    if (method === 'get') return { action: 'get', key: args[0] };
    if (method === 'ping') return { action: 'ping' };
    var body = { action: 'put', key: args[0], data: args[1], rev: args[2] };
    var extra = args[3];
    if (extra && extra.allowDrop === true) body.allowDrop = true;
    if (extra && extra.accessToken) body.accessToken = extra.accessToken;
    return body;
  }

  var SUPA = {
    /* 名前付きの入口から呼ばれる。group＝入口のまとまり（training 等）・method＝関数の名前・args＝画面が渡した引数・gasFn＝gas の道 */
    entry: function (group, method, args, gasFn) {
      if (group !== 'training' || ['get', 'put', 'ping'].indexOf(method) < 0) return Promise.reject(fail(NOT_YET, 'supabase_not_ready'));
      return loadAuth().then(function (A) {
        if (!A) throw fail('ログインの部品を読み込めませんでした。ページを読み込み直してください。', 'noauth');
        return Promise.resolve(A.check()).then(function (st) {
          if (!st || st.status !== A.STATUS.OK) throw fail('この端末はログインしていません。ログインしてから開いてください。', 'signed_out');
          return tpMode(A).then(function (m) {
            if (m !== 'live') return typeof gasFn === 'function' ? gasFn() : Promise.reject(fail(NOT_YET, 'supabase_not_ready'));
            var opts = method === 'put' ? args[4] : method === 'get' ? args[1] : args[0];
            if (method === 'get' && !caughtUp) { caughtUp = true; mirrorSoon(A, opts); }   // 開いた時に1回、写し返しの残りを追いつかせる
            return invoke(A, trainingBody(method, args)).then(function (res) {
              if (method === 'put' && res && res.ok === true) mirrorSoon(A, opts);
              // AI の中継はまだ Google（計画書の GAS）にあるので、ping の AI の状態（キーの有無・回数）は Google の ping から取る（計画書の反証レビュー 指摘2）
              if (method === 'ping' && res && res.ok === true && typeof gasFn === 'function') {
                return Promise.resolve(gasFn()).then(function (g) {
                  if (g && g.ok === true && g.ai) res.ai = g.ai; else delete res.ai;
                  return res;
                }, function () { delete res.ai; return res; });
              }
              return res;
            });
          });
        });
      });
    },
    /* 閉じる直前の送信を Google へ送ってよいか（印が「切り替える前」と1分以内に確かめてある時だけ） */
    beaconGas: function () { return modeCache === 'shadow' && Date.now() - modeAt < 60000; },
    _reset: function () { modeCache = null; modeAt = 0; mirroring = null; mirrorAgain = false; caughtUp = false; }
  };
  var caughtUp = false;

  global.SU.data.register('supabase', SUPA);
})(window);
