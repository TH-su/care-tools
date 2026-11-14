/*
 * su-stf.js — 職員マスタの保存先の切り替え（統合 0045・2026-11-02 代表者「全て進めて」案2・大事な順・添付は Google ドライブのまま）
 * ════════════════════════════════════════════════════════════════
 * 職員マスタ（staff-master.html）と採用管理（ats.html）が職員マスタの GAS へ送る1回の送信（fetch）だけを、ここに通す。
 *   SUStf.send(本文, Google へ送る関数, { screen, url, timeoutMs }) は、fetch と同じ形（ok・status・text()）の答えを返す。
 * ・スイッチ su-backend.json の supabase.staff が切・読めない・現場の端末の時は、Google へ送る関数をそのまま呼ぶ
 *   ＝本文も送り方も1バイトも変わらない（CLAUDE.md §2-3）。
 * ・スイッチが入の時は、データベースの印（stf_mode_get）が「切り替えた後」の時だけ、受け口 stf-write へ同じ本文を送る
 *   （職員マスタの合言葉 token とログインの証明 accessToken は送らない。受け口がログインから役割と直した人を決める）。
 *   印が写しの期間・0045 の前（関数が無い）時は Google。
 * ・添付の出し入れ（uploadFile・removeFile）は、いつも Google へ送る（ファイルは Google ドライブに置いたまま・目録だけを Google の GAS が新しい保存先に書く）。
 * ・スイッチが入の間は、ログインしていない・断られた・届かない時に Google へ流さない（CLAUDE.md §4）。
 *   断りは GAS と同じ形（{ok:false, error}）で返し、届かない・時間切れは送信の失敗（画面は「書けたか分からない」として扱う）。
 * ・新しい保存先で保存できたら、Google の職員マスタへ写し返しを頼む（stfMirror・待たない・失敗しても保存の結果は変えない）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUStf が無ければ Google へ送る）・例外を外に出さない
 *   （外へ出すのは、新しい保存先へ送った時の「届かない・時間切れ」だけ＝画面の今までの通信の失敗と同じ扱い）。
 */
(function (root) {
  'use strict';
  if (root.SUStf) return;
  var FLAG = 'staff';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var FILE_ACTIONS = { uploadFile: 1, removeFile: 1 };
  var WRITE_ACTIONS = { bulkSave: 1, importRows: 1, setEnums: 1, setCommittees: 1, setCorp: 1 };
  var CALL_MS = 90000;
  var MODE_MS = 60000;

  /* 本番の健康（統合 0088）: 新しい保存先へ送った書く操作の失敗だけを、種類と理由で数える（su-health.js が無ければ何もしない） */
  function health(body, info) {
    try { if (WRITE_ACTIONS[body && body.action] && root.SUHealth) root.SUHealth.fail('stf', info); } catch (e) { /* 数えられなくても止めない */ }
  }
  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('保存・同期の失敗', e, 'stf:' + where); } catch (x) { /* 記録できなくても止めない */ }
  }

  /* ── スイッチ（su-res-read.js と同じ読み方。su-kv.js があればその値、無ければ最後に読めた値・1分ごとに読み直す）── */
  var ownFlags = null, flagsAt = 0, flagsP = null;
  function flags() {
    try { if (root.SUKv && typeof root.SUKv._flags === 'function') return root.SUKv._flags(); } catch (e) { /* 何もしない */ }
    if (ownFlags) return ownFlags;
    try { return JSON.parse(root.localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { return null; }
  }
  function switchOn() { var f = flags(); return !!(f && f.supabase && typeof f.supabase === 'object' && f.supabase[FLAG] === true); }
  function refreshFlags() {
    if (root.SUKv && typeof root.SUKv._flags === 'function') return Promise.resolve();
    if (flagsP) return flagsP;
    if (flagsAt && Date.now() - flagsAt < 60000) return Promise.resolve();
    flagsAt = Date.now();
    flagsP = Promise.race([
      Promise.resolve().then(function () { return root.fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' }); })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.supabase && typeof j.supabase === 'object') ownFlags = { supabase: j.supabase }; }, function () {}),
      new Promise(function (ok) { setTimeout(ok, 3000); })
    ]).then(function () { flagsP = null; }, function () { flagsP = null; });
    return flagsP;
  }
  function fieldDevice() { try { return String(root.localStorage.getItem('su_device_role') || '') === 'field'; } catch (e) { return false; } }

  /* ── ログインの部品を必要な時だけ読む ── */
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = root.document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      root.document.head.appendChild(s);
    });
  }
  function loadAuth() {
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    var p = root.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return root.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return root.SUAuth || null; });
  }

  /* fetch と同じ形の答え（画面は res.ok・res.status・res.text() で読む） */
  function asResponse(d) {
    var t = JSON.stringify(d);
    return { ok: true, status: 200, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(JSON.parse(t)); } };
  }
  function refusal(text) { return asResponse({ ok: false, error: text }); }
  var MSG = {
    login: 'この端末はログインしていません。ログインしてから、もう一度お試しください（職員マスタは新しい保存先に切り替わっています）。',
    denied: 'このアカウントでは職員マスタを使えません。管理者へ連絡してください。',
    noauth: 'ログインの部品を読み込めませんでした。ページを読み込み直してください。',
    mode: '新しい保存先の状態を確かめられませんでした。少し待ってから、もう一度お試しください。'
  };
  function aborted() { var e = new Error('時間切れ'); e.name = 'AbortError'; return e; }

  /* データベースの印（stf_mode_get）。1分は覚える。関数が無い（0045 の前）時は 'shadow'。ログインの断りは 'denied'、届かない時は例外 */
  var modeCache = null, modeAt = 0;
  function mode(A) {
    if (modeCache && Date.now() - modeAt < MODE_MS) return Promise.resolve(modeCache);
    return Promise.resolve(A.client().rpc('stf_mode_get')).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
      if (r && r.error && c === '42501') return 'denied';
      if (!r || r.error || !r.data) throw new Error('mode');
      modeCache = r.data.mode === 'live' ? 'live' : 'shadow'; modeAt = Date.now();
      return modeCache;
    });
  }

  /* 受け口へ送る。断り（{error, code}）は GAS と同じ形（ok:false）にして返す。届かない・時間切れは例外 */
  function invoke(A, body, ms) {
    var send = {};
    Object.keys(body).forEach(function (k) { if (k !== 'token' && k !== 'accessToken') send[k] = body[k]; });
    var tm = null;
    var call = Promise.resolve(A.client().functions.invoke('stf-write', { body: send }));
    var timer = new Promise(function (ok) { tm = setTimeout(function () { ok({ timeout: true }); }, ms); });
    return Promise.race([call, timer]).then(function (r) {
      clearTimeout(tm);
      if (r && r.timeout) throw aborted();
      if (r && r.error) {
        var ctx = r.error.context;
        return Promise.resolve(ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null).then(function (d) {
          if (d && typeof d === 'object' && typeof d.error === 'string') return Object.assign({ ok: false }, d);
          throw new Error('network');
        });
      }
      return r ? r.data : null;
    });
  }

  /* ── Google への写し返しを頼む（新しい保存先で保存できた後・待たない・1本ずつ・続けて保存があればもう1回）── */
  var mirroring = null, mirrorAgain = false;
  function mirrorPost(A, url, token) {
    if (!url || !token) return Promise.resolve(null);
    return Promise.resolve(A.client().auth.getSession()).then(function (s) {
      var at = s && s.data && s.data.session && s.data.session.access_token;
      if (!at) return null;
      return root.fetch(url, { method: 'POST', body: JSON.stringify({ action: 'stfMirror', token: token, accessToken: at }), redirect: 'follow' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j || j.ok !== true) note('写し返し', new Error(String(j && j.error || 'refused').slice(0, 60))); return j; });
    });
  }
  function mirrorSoon(A, url, token) {
    if (mirroring) { mirrorAgain = true; return mirroring; }
    mirroring = mirrorPost(A, url, token).catch(function (e) { note('写し返し', e); return null; }).then(function (j) {
      mirroring = null;
      if (mirrorAgain) { mirrorAgain = false; return mirrorSoon(A, url, token); }
      return j;
    });
    return mirroring;
  }

  /* 同じ受付番号（reqId）を、前と違う道へ送らない（2026-11-02 反証レビューの指摘 A）。
   * Google へ送って答えが分からなかった保存を、切り替えた後に同じ番号で送り直すと、新しい保存先はその番号を知らないので2回書いてしまう
   * （職員が2人分できる）。番号ごとに送った道をこのページの間だけ覚え（メモリだけ・端末に残さない）、道が変わっていたら送らずに断る */
  var routeOf = {};
  var MSG_ROUTE = '保存できたか確かめられません。画面を読み込み直して、一覧で確かめてください';
  function sameRoute(body, route) {
    var id = body && typeof body.reqId === 'string' ? body.reqId : '';
    if (!id) return true;
    if (routeOf[id] && routeOf[id] !== route) return false;
    routeOf[id] = route;
    return true;
  }
  function viaGas(body, gasSend) { return sameRoute(body, 'gas') ? gasSend() : refusal(MSG_ROUTE); }

  /* 画面の入口。gasSend() は今までどおり Google へ送る関数（この部品は中身に触らない）。
   * opts: { screen, url（職員マスタの GAS・写し返しを頼む先）, timeoutMs } */
  function send(body, gasSend, opts) {
    opts = opts || {};
    try {
      if (!body || typeof body.action !== 'string') return gasSend();
      if (FILE_ACTIONS[body.action] || fieldDevice()) return Promise.resolve(viaGas(body, gasSend));
    } catch (e) { return gasSend(); }
    return refreshFlags().then(function () {
      if (!switchOn()) return viaGas(body, gasSend);
      return loadAuth().then(function (A) {
        if (!A) return refusal(MSG.noauth);
        return Promise.resolve(A.check()).then(function (st) {
          if (!st || st.status !== A.STATUS.OK) { health(body, { code: st && st.status === 'signed_out' ? 'login' : 'denied' }); return refusal(st && st.status === 'signed_out' ? MSG.login : MSG.denied); }
          return mode(A).then(function (m) {
            if (m === 'denied') { health(body, { code: 'denied' }); return refusal(MSG.denied); }
            if (m !== 'live') return Promise.resolve(viaGas(body, gasSend)).then(function (res) { return watchSwitched(res); });
            if (!sameRoute(body, 'stf')) return refusal(MSG_ROUTE);
            var ms = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : CALL_MS;
            return invoke(A, body, ms).then(function (d) {
              // 数えるのは受け口の断り（code がある）だけ。項目の確かめで中止した保存（入力の誤り）は code が無いので数えない（反証レビュー指摘3）
              if (d && typeof d === 'object' && d.ok === false && typeof d.code === 'string' && d.code !== 'shadow') health(body, { code: d.code });
              if (d && d.code === 'shadow') { modeCache = null; if (body.reqId) delete routeOf[body.reqId]; return viaGas(body, gasSend); }   // 印が写しの期間へ戻った＝Google が正本（受け口は書く前に断るので、この番号はまだどこにも書いていない）
              if (d && (d.ok === true || d.partial === true) && WRITE_ACTIONS[body.action]) mirrorSoon(A, opts.url, body.token);
              return asResponse(d && typeof d === 'object' ? d : { ok: false, error: '新しい保存先の応答が空でした。' });
            }, function (e) { health(body, { timeout: true }); throw e; });
          }, function (e) { note('印', e); health(body, { network: true }); return refusal(MSG.mode); });
        });
      }, function (e) { note('ログインの部品', e); return refusal(MSG.noauth); });
    });
  }
  /* Google が「切り替えた後」と断った時は、覚えている印を捨てる（次の送信で読み直す）。答えはそのまま返す */
  function watchSwitched(res) {
    try {
      if (res && typeof res.clone === 'function') {
        res.clone().text().then(function (t) { if (/"code"\s*:\s*"stf_switched"/.test(t)) modeCache = null; }, function () {});
      }
    } catch (e) { /* 何もしない */ }
    return res;
  }

  /* この端末が「職員マスタの接続先・合言葉なしで、ログインだけで」職員マスタ・採用管理を使えるか（2026-11-08 代表者「端末ごとの設定を極限までなくす」）。
   * スイッチが入・現場の端末でない・ログインが確かめられた（OK）・役割が事務所か管理者・印が「切り替えた後」の5つがそろう時だけ true。
   * それ以外・分からない・時間切れ（8秒）は false（false の時、画面は今までどおり接続先の設定を求める）。
   * 読むだけで、端末には何も書かない。例外は外へ出さない */
  function liveReady() {
    try {
      if (fieldDevice()) return Promise.resolve(false);
      var tm = null;
      var late = new Promise(function (ok) { tm = setTimeout(function () { ok(false); }, 8000); });
      var probe = refreshFlags().then(function () {
        if (!switchOn()) return false;
        return loadAuth().then(function (A) {
          if (!A) return false;
          return Promise.resolve().then(function () { return A.check(); }).then(function (st) {
            if (!st || st.status !== (A.STATUS || {}).OK) return false;
            if (st.role !== 'admin' && st.role !== 'office') return false;
            return mode(A).then(function (m) { return m === 'live'; });
          });
        });
      }).then(function (v) { return v === true; }, function (e) { note('使える状態', e); return false; });
      return Promise.race([probe, late]).then(function (v) { clearTimeout(tm); return v === true; });
    } catch (e) { return Promise.resolve(false); }
  }

  root.SUStf = { send: send, liveReady: liveReady, refreshFlags: refreshFlags, _forgetMode: function () { modeCache = null; modeAt = 0; }, _reset: function () { modeCache = null; modeAt = 0; ownFlags = null; flagsAt = 0; flagsP = null; mirroring = null; mirrorAgain = false; routeOf = {}; } };
})(typeof window !== 'undefined' ? window : this);
