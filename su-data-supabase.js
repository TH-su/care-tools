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
 *   AI の中継（入口 training の ai・スイッチ training_ai・2026-10-30 代表者「両方」）は、データベースの印に関わらず、
 *   AI の中継の受け口 su-ai（統合 0028）へ {purpose:'training_plan', body} を送る。応答は GAS の ai と同じ形（{ok, status, data|detail} か {ok:false, error}）。
 *   ログインしていない時は {ok:false, error:'login'} を返し、Google へ流さない。ping の AI の状態はこの道では「使える」とだけ返す（鍵の有無は送った時に分かる）。
 *
 * ── 入居調整の台帳（入口 admission の get・put・ping・2026-10-29 代表者「入居調整の切り替えの土台に進む」）──
 *   計画書と同じ流れ。印は adm_mode（統合 0042）、受け口は adm-write、写し返しは入居調整の GAS の admMirror。
 *   添付書類の操作はこの道に来ない（Drive のまま＝案A・画面は今までどおり kvRaw で Google へ送る）。
 *
 * 読み込み方: su-data.js → su-data-gas.js → su-data-supabase.js の順（gas の道が先に居る＝これが読めなくても gas で動く）
 */
(function (global) {
  'use strict';
  if (!global.SU || !global.SU.data || typeof global.SU.data.register !== 'function') return;  /* 読めなくても画面は gas で動く */

  var NOT_YET = '新しい保存先（Supabase）はまだ使えません。管理者へ連絡してください。';
  var CALL_MS = 40000;
  var AI_MS = 150000;
  var AI_RETRY_MS = 2000;   /* 受け口に届く前に切れた時、送り直すまで待つ間（ミリ秒） */   /* su-ai は Anthropic を最長 140 秒待つ。画面の側にも別の時間切れがある */

  function fail(text, code) { var e = new Error(text); e.code = code || 'supabase'; return e; }
  /* 入口のまとまりごとの決まり（印を読む関数・受け口・Google への写し返しの action・名前） */
  var GROUPS = {
    training:  { modeFn: 'tp_mode_get',  fn: 'tp-write',  mirror: 'tpMirror',  label: '計画書',   noRight: '計画書を開く権限がありません。ログインし直してください。' },
    admission: { modeFn: 'adm_mode_get', fn: 'adm-write', mirror: 'admMirror', label: '入居調整', noRight: '入居調整を開く権限がありません。ログインし直してください。' }
  };
  var state = {};
  function st(group) {
    return state[group] || (state[group] = { modeCache: null, modeAt: 0, mirroring: null, mirrorAgain: false, caughtUp: false });
  }
  function note(group, where, e) {
    try { if (global.SUErrors && typeof global.SUErrors.note === 'function') global.SUErrors.note(GROUPS[group].label + 'の新しい保存先: ' + where, e && e.message || e); } catch (x) { /* 記録できなくても止めない */ }
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

  /* データベースの印（1分の控え）。0038・0042 の前（関数が無い）は 'shadow' */
  function readMode(group, A) {
    var S = st(group);
    if (S.modeCache && Date.now() - S.modeAt < 60000) return Promise.resolve(S.modeCache);
    return Promise.resolve(A.client().rpc(GROUPS[group].modeFn)).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
      if (c === '42501') throw fail(GROUPS[group].noRight, c);
      if (!r || r.error || !r.data) throw fail('新しい保存先の状態を読めませんでした。少し待ってから、もう一度お試しください。', 'db');
      S.modeCache = r.data.mode === 'live' ? 'live' : 'shadow'; S.modeAt = Date.now();
      return S.modeCache;
    });
  }

  /* 受け口（tp-write・adm-write）へ送る。断り（{ok:false, error, code}）は GAS と同じ形のまま返す。届かない・時間切れは失敗 */
  function invoke(group, A, body) {
    var call = Promise.resolve(A.client().functions.invoke(GROUPS[group].fn, { body: body }));
    var timer = new Promise(function (ok) { setTimeout(function () { ok({ timeout: true }); }, CALL_MS); });
    return Promise.race([call, timer]).then(function (r) {
      if (r && r.timeout) throw fail('新しい保存先の応答がありません（時間切れ）。保存されたか、画面を開き直して確かめてください。', 'timeout');
      if (r && r.error) {
        var ctx = r.error.context;
        return Promise.resolve(ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null).then(function (d) {
          if (d && typeof d === 'object' && d.error) {
            if (d.code === 'shadow') { st(group).modeCache = null; }   // 印が変わった＝次は読み直す
            return d;
          }
          throw fail('新しい保存先に届きませんでした。保存されたか、画面を開き直して確かめてください。', 'network');
        });
      }
      return r ? r.data : null;
    });
  }

  /* Google への写し返し（保存できた後・待たない）。1本ずつ送り、送っている間の次の保存は終わった後に1回だけ */
  function mirrorSoon(group, A, opts) {
    var S = st(group);
    if (S.mirroring) { S.mirrorAgain = true; return S.mirroring; }
    S.mirroring = Promise.resolve(A.client().auth.getSession()).then(function (s) {
      var at = s && s.data && s.data.session && s.data.session.access_token;
      if (!at || !global.SU.data || typeof global.SU.data.kvRaw !== 'function') return null;
      return global.SU.data.kvRaw({ action: GROUPS[group].mirror, accessToken: at }, opts).then(function (j) {
        if (!j || j.ok !== true) note(group, 'Google が写し返しを受け付けませんでした', j && j.error);
        else if (j.more === true) S.mirrorAgain = true;
        return j;
      });
    }).catch(function (e) { note(group, '写し返しを送れませんでした', e); return null; }).then(function (j) {
      S.mirroring = null;
      if (S.mirrorAgain) { S.mirrorAgain = false; return mirrorSoon(group, A, opts); }
      return j;
    });
    return S.mirroring;
  }

  function bodyOf(group, method, args) {
    if (method === 'get') return { action: 'get', key: args[0] };
    if (method === 'ping') return { action: 'ping' };
    var body = { action: 'put', key: args[0], data: args[1], rev: args[2] };
    var extra = args[3];
    if (group === 'training' && extra && extra.allowDrop === true) body.allowDrop = true;
    if (group === 'admission' && extra && extra.force === true) body.force = true;
    if (extra && extra.accessToken) body.accessToken = extra.accessToken;
    return body;
  }

  /* AI の中継（su-ai）。断り（{ok:false, error}）は GAS と同じ形のまま返す。届かない・時間切れは失敗（画面は「通信の失敗」と出す） */
  /* 失敗の時は、どの段で止まったかの短い印（code）を付けて記録に残す（画面の文の末尾にも出す・2026-10-30 代表者「入れてよい」。文の中身・氏名は持たない） */
  function aiFail(code, e) {
    var x = fail('AI の中継に届きませんでした。', code);
    note('training', 'AI の中継（' + code + '）', e || x);
    return x;
  }
  function aiEntry(body) {
    return aiEntry0(body).catch(function (e) {
      if (e && /^ai_/.test(String(e.code || ''))) throw e;
      if (e instanceof Error) { e.code = 'ai_' + String(e.code || 'error'); note('training', 'AI の中継（' + e.code + '）', e); throw e; }
      throw aiFail('ai_error', e);
    });
  }
  function aiEntry0(body) {
    return loadAuth().then(function (A) {
      if (!A) throw fail('ログインの部品を読み込めませんでした。ページを読み込み直してください。', 'noauth');
      return Promise.resolve(A.check()).then(function (s0) {
        if (!s0 || s0.status !== A.STATUS.OK) return { ok: false, error: 'login' };
        /* 受け口に届く前に通信が切れた時（ai_fetch）だけ、少し待って1回だけ送り直す（携帯の回線などで一瞬切れても止めない・2026-11-01 代表者「3の直しを入れて」）。
           受け口が答えた断り・時間切れ・手前の中継の止まりは送り直さない（届いていれば回数を二重に使うため） */
        function once() {
          var call = Promise.resolve(A.client().functions.invoke('su-ai', { body: { purpose: 'training_plan', body: body } }));
          var tm = null;
          var timer = new Promise(function (ok) { tm = setTimeout(function () { ok({ timeout: true }); }, AI_MS); });
          return Promise.race([call, timer]).then(function (r) {
            clearTimeout(tm);
            if (r && r.timeout) throw fail('AI の中継の応答がありません（時間切れ）。', 'timeout');
            if (r && r.error) {
              var ctx = r.error.context, nm = String(r.error.name || '');
              return Promise.resolve(ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null).then(function (d) {
                if (d && typeof d === 'object' && d.ok === false && typeof d.error === 'string') return d;
                throw aiFail(ctx && typeof ctx.status === 'number' ? 'ai_' + ctx.status : nm === 'FunctionsRelayError' ? 'ai_relay' : 'ai_fetch', r.error);
              });
            }
            return r ? r.data : null;
          });
        }
        return once().catch(function (e) {
          if (!e || e.code !== 'ai_fetch') throw e;
          return new Promise(function (ok) { setTimeout(ok, AI_RETRY_MS); }).then(once);
        });
      });
    });
  }
  function aiViaSupabase() {
    try { return global.SU.data._entryRoute('training_ai') === 'supabase'; } catch (e) { return false; }
  }

  var SUPA = {
    /* 名前付きの入口から呼ばれる。group＝入口のまとまり（training 等）・method＝関数の名前・args＝画面が渡した引数・gasFn＝gas の道 */
    entry: function (group, method, args, gasFn) {
      if (group === 'training' && method === 'ai') return aiEntry(args[0]);
      if (!Object.prototype.hasOwnProperty.call(GROUPS, group) || ['get', 'put', 'ping'].indexOf(method) < 0) return Promise.reject(fail(NOT_YET, 'supabase_not_ready'));
      var S = st(group);
      return loadAuth().then(function (A) {
        if (!A) throw fail('ログインの部品を読み込めませんでした。ページを読み込み直してください。', 'noauth');
        return Promise.resolve(A.check()).then(function (st) {
          if (!st || st.status !== A.STATUS.OK) throw fail('この端末はログインしていません。ログインしてから開いてください。', 'signed_out');
          return readMode(group, A).then(function (m) {
            if (m !== 'live') return typeof gasFn === 'function' ? gasFn() : Promise.reject(fail(NOT_YET, 'supabase_not_ready'));
            var opts = method === 'put' ? args[4] : method === 'get' ? args[1] : args[0];
            if (method === 'get' && !S.caughtUp) { S.caughtUp = true; mirrorSoon(group, A, opts); }   // 開いた時に1回、写し返しの残りを追いつかせる
            return invoke(group, A, bodyOf(group, method, args)).then(function (res) {
              if (method === 'put' && res && res.ok === true) mirrorSoon(group, A, opts);
              // AI の中継が新しい受け口（su-ai）の時は「使える」とだけ返す（鍵が無ければ送った時に ai_no_key で分かる）
              if (group === 'training' && method === 'ping' && res && res.ok === true && aiViaSupabase()) { res.ai = { key: true }; return res; }
              // AI の中継が Google（計画書の GAS）の間は、ping の AI の状態（キーの有無・回数）は Google の ping から取る（計画書の反証レビュー 指摘2）
              if (group === 'training' && method === 'ping' && res && res.ok === true && typeof gasFn === 'function') {
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
    /* 閉じる直前の送信を Google へ送ってよいか（印が「切り替える前」と1分以内に確かめてある時だけ）。group を省くと計画書 */
    beaconGas: function (group) { var S = st(GROUPS[group] ? group : 'training'); return S.modeCache === 'shadow' && Date.now() - S.modeAt < 60000; },
    _reset: function () { state = {}; }
  };

  global.SU.data.register('supabase', SUPA);
})(window);
