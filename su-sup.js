/*
 * su-sup.js — 消耗品管理（備品）の保存先の切り替え（統合 0047・2026-11-02 代表者「全て進めて」案2・大事な順で職員マスタの次）
 * ════════════════════════════════════════════════════════════════
 * 消耗品管理（supplies.html）が消耗品管理の GAS へ送る1回の送信（fetch）だけを、ここに通す。
 *   SUSup.send(本文, Google へ送る関数, { screen, timeoutMs }) は、fetch と同じ形（ok・status・text()）の答えを返す。
 * ・スイッチ su-backend.json の supabase.supplies が切・読めない時は、Google へ送る関数をそのまま呼ぶ
 *   ＝本文も送り方も1バイトも変わらない（CLAUDE.md §2-3）。
 * ・スイッチが入の時は、データベースの印（sup_mode_get）が「切り替えた後」の時だけ、受け口 sup-write へ同じ本文を送る
 *   （合言葉 token とログインの証明 accessToken は送らない。受け口がログインの役割から合言葉と直した人を決める）。
 *   印が写しの期間・0047 の前（関数が無い）時は Google。
 * ・職員マスタ（su-stf.js）と違い、現場の端末も新しい保存先へ送る（入出庫を記録するため・受け口は現場のアカウントも受ける）。
 *   読み取り（list・listPrices・listMoves）も、切り替えた後は新しい保存先から読む（Google は1時間ごとの写し返しで追いつく）。
 * ・スイッチが入の間は、断られた・届かない・印を確かめられない時に Google へ流さない（CLAUDE.md §4）。
 *   断りは消耗品管理の GAS と同じ形（{ok:false, error:種類, hint:文}）で返し、届かない・時間切れは送信の失敗にする。
 * ・ログインしていない端末は印を読めないので Google へ送る（切り替えた後は Google が保存を断り、それを「ログインしてください」に置き換える。
 *   読み取りは Google の写し返し（1時間ごと）の中身になる）。2段階認証がまだの管理者はログインしているとみなし、断られた時だけ知らせる。
 * ・読み取りの前は印をいつも読み直す（切り替えた直後に古い印で Google から読まない）。書き込みは1分覚える。
 * ・Google への写し返しは、消耗品管理の GAS の自動（1時間ごと・写し返し専用のアカウント）に任せる（画面からは頼まない。
 *   写し返しの口は管理者と写し返し専用のアカウントだけが使えるため）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUSup が無ければ Google へ送る）・例外を外に出さない
 *   （外へ出すのは、新しい保存先へ送った時の「届かない・時間切れ」と、送る前に時間が切れた時だけ＝画面の今までの通信の失敗と同じ扱い）。
 *   端末に書くのは、su-kv.js と同じスイッチの控え（su_backend_flags）だけ。
 */
(function (root) {
  'use strict';
  if (root.SUSup) return;
  var FLAG = 'supplies';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var CALL_MS = 45000;
  var MODE_MS = 60000;

  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('保存・同期の失敗', e, 'sup:' + where); } catch (x) { /* 記録できなくても止めない */ }
  }

  /* ── スイッチ（su-stf.js と同じ読み方。su-kv.js があればその値、無ければ最後に読めた値・1分ごとに読み直す）── */
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
        .then(function (j) {
          if (j && j.supabase && typeof j.supabase === 'object') {
            ownFlags = { supabase: j.supabase };
            try { root.localStorage.setItem(FLAGS_LS, JSON.stringify(ownFlags)); } catch (e) { /* 何もしない */ }   // su-kv.js と同じく、最後に読めた値を残す（読めない時はこれを使う）
          }
        }, function () {}),
      new Promise(function (ok) { setTimeout(ok, 3000); })
    ]).then(function () { flagsP = null; }, function () { flagsP = null; });
    return flagsP;
  }

  /* ── ログインの部品を必要な時だけ読む ── */
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = root.document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      root.document.head.appendChild(s);
    });
  }
  var authP = null;   // 読み込みは1回だけ（同時に何度送っても script を1本ずつしか足さない）。失敗した時だけ次の送信で読み直す
  function loadAuth() {
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    if (authP) return authP;
    var p = root.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    authP = p.then(function () { return root.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return root.SUAuth || null; });
    authP.then(function (A) { if (!A) authP = null; }, function () { authP = null; });
    return authP;
  }

  /* fetch と同じ形の答え（画面は res.ok・res.status・res.text() で読む） */
  function asResponse(d) {
    var t = JSON.stringify(d);
    return { ok: true, status: 200, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(JSON.parse(t)); } };
  }
  function refusal(code) { return asResponse({ ok: false, error: code, hint: MSG[code] }); }
  var MSG = {
    login: 'この端末はログインしていません。ログインしてから、もう一度お試しください（消耗品管理は新しい保存先に切り替わっています）。',
    role: 'このアカウントでは消耗品管理を使えません。管理者へ連絡してください。',
    noauth: 'ログインの部品を読み込めませんでした。ページを読み込み直してください。',
    mode: '新しい保存先の状態を確かめられませんでした。少し待ってから、もう一度お試しください。',
    mfa: '2段階認証を済ませてください。ログインの画面で6桁を入れてから、もう一度お試しください。',
    forbidden: 'このアカウントではこの操作はできません。事務所か管理者のアカウントでログインしてから行ってください。'
  };
  function aborted() { var e = new Error('時間切れ'); e.name = 'AbortError'; return e; }

  /* データベースの印（sup_mode_get）。1分は覚える。関数が無い（0047 の前）時は 'shadow'。ログインの断りは 'denied'、届かない時は例外 */
  var modeCache = null, modeAt = 0;
  var READS = { list: 1, listPrices: 1, listMoves: 1 };
  function mode(A, fresh) {
    if (!fresh && modeCache && Date.now() - modeAt < MODE_MS) return Promise.resolve(modeCache);
    return Promise.resolve(A.client().rpc('sup_mode_get')).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
      if (r && r.error && c === '42501') return 'denied';
      if (!r || r.error || !r.data) throw new Error('mode');
      modeCache = r.data.mode === 'live' ? 'live' : 'shadow'; modeAt = Date.now();
      return modeCache;
    });
  }

  /* 受け口へ送る。断り（{error, hint, code}）は GAS と同じ形（ok:false）にして返す。届かない・時間切れは例外 */
  function invoke(A, body, ms) {
    var send = {};
    Object.keys(body).forEach(function (k) { if (k !== 'token' && k !== 'accessToken') send[k] = body[k]; });
    var tm = null;
    var call = Promise.resolve(A.client().functions.invoke('sup-write', { body: send }));
    var timer = new Promise(function (ok) { tm = setTimeout(function () { ok({ timeout: true }); }, ms); });
    return Promise.race([call, timer]).then(function (r) {
      clearTimeout(tm);
      if (r && r.timeout) throw aborted();
      if (r && r.error) {
        var ctx = r.error.context;
        return Promise.resolve(ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : null).then(function (d) {
          if (d && typeof d === 'object' && typeof d.error === 'string') return Object.assign({}, d, { ok: false });
          if (ctx && Number(ctx.status) === 401) return { ok: false, error: 'login', hint: MSG.login, code: 'login' };   // 受け口の手前（入口）がログインの証明を断った
          throw new Error('network');
        });
      }
      return r ? r.data : null;
    });
  }

  /* 送る前の確かめ（ログイン・印）。返すのは道: gas（Google）・signedOut（ログインしていない端末＝Google が決める）・refuse（断り）・live（受け口）。
   * ログインしていない端末は、印を読めない（データベースが答えない）ので Google へ送る。切り替えた後なら Google が保存を sup_switched で断り、
   * それを「ログインしてください」に置き換える（スイッチを入れただけ・まだ写しの期間の間は、今までどおり使える・反証レビュー指摘1）。
   * 2段階認証がまだの状態（mfa_verify・mfa_enroll）はログインしているとみなし、断られた時だけ「2段階認証を済ませて」と出す（指摘2） */
  function plan(body) {
    return loadAuth().then(function (A) {
      if (!A) return { kind: 'refuse', code: 'noauth' };
      return Promise.resolve().then(function () { return A.check(); }).then(function (st) {
        var S = A.STATUS || {}, s0 = st && st.status;
        if (s0 === S.SIGNED_OUT) return modeCache === 'live' && Date.now() - modeAt < MODE_MS ? { kind: 'refuse', code: 'login' } : { kind: 'signedOut' };
        if (s0 === S.DENIED) return { kind: 'refuse', code: 'role' };
        var mfa = s0 === S.MFA_VERIFY || s0 === S.MFA_ENROLL;
        if (s0 !== S.OK && !mfa) return { kind: 'refuse', code: 'mode' };   // 通信などで確かめられない＝もう一度
        return mode(A, !!READS[body.action]).then(function (m) {
          if (m === 'denied') return { kind: 'refuse', code: mfa ? 'mfa' : 'role' };
          if (m !== 'live') return { kind: 'gas' };
          return { kind: 'live', A: A, mfa: mfa };
        }, function (e) { note('印', e); return { kind: 'refuse', code: 'mode' }; });
      }, function (e) { note('確かめ', e); return { kind: 'refuse', code: 'mode' }; });
    }, function (e) { note('ログインの部品', e); return { kind: 'refuse', code: 'noauth' }; });
  }

  /* 画面の入口。gasSend() は今までどおり Google へ送る関数（この部品は中身に触らない）。opts: { screen, timeoutMs }
   * timeoutMs は送る前の確かめも含めた全体の時間。送る前に時間が切れた時は、時間切れ（AbortError）ではなく通信の失敗にする
   * （まだ何も送っていないので、画面に「入っていることがある」と言わせない・指摘4） */
  function send(body, gasSend, opts) {
    opts = opts || {};
    try {
      if (!body || typeof body.action !== 'string') return gasSend();
    } catch (e) { return gasSend(); }
    var total = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : CALL_MS, t0 = Date.now();
    return refreshFlags().then(function () {
      if (!switchOn()) return gasSend();
      var tm = null;
      var late = new Promise(function (ok, ng) { tm = setTimeout(function () { ng(new Error('送る前に時間切れ')); }, Math.max(0, total - (Date.now() - t0))); });
      return Promise.race([plan(body), late]).then(function (p) {
        clearTimeout(tm);
        if (p.kind === 'refuse') return refusal(p.code);
        if (p.kind === 'signedOut') return Promise.resolve(gasSend()).then(function (res) { return switchedToLogin(res); });
        if (p.kind === 'gas') return Promise.resolve(gasSend()).then(function (res) { return watchSwitched(res); });
        var left = Math.max(1000, total - (Date.now() - t0));
        return invoke(p.A, body, left).then(function (d) {
          if (d && d.code === 'shadow') { modeCache = null; return gasSend(); }   // 印が写しの期間へ戻った＝Google が正本（受け口は書く前に断る）
          if (d && d.ok !== true && p.mfa && (d.error === 'role' || d.error === 'login')) return refusal('mfa');
          if (d && d.ok !== true && d.error === 'forbidden') d = Object.assign({}, d, { hint: MSG.forbidden });   // 合言葉の話（管理者の合言葉で開き直す）を出さない・指摘7
          return asResponse(d && typeof d === 'object' ? d : { ok: false, error: 'db', hint: '新しい保存先の応答が空でした。一覧を取り直して、入っているか確かめてください。' });
        });
      }, function (e) { clearTimeout(tm); throw e; });
    });
  }
  /* ログインしていない端末で Google が「切り替えた後」と断った時は、ログインを頼む断りに置き換える。ほかの答えはそのまま返す */
  function switchedToLogin(res) {
    try {
      if (!res || typeof res.clone !== 'function') return res;
      return res.clone().text().then(function (t) {
        if (/"error"\s*:\s*"sup_switched"/.test(t)) { modeCache = 'live'; modeAt = Date.now(); return refusal('login'); }
        return res;
      }, function () { return res; });
    } catch (e) { return res; }
  }
  /* Google が「切り替えた後」と断った時は、覚えている印を捨てる（次の送信で読み直す）。答えはそのまま返す */
  function watchSwitched(res) {
    try {
      if (res && typeof res.clone === 'function') {
        res.clone().text().then(function (t) { if (/"error"\s*:\s*"sup_switched"/.test(t)) modeCache = null; }, function () {});
      }
    } catch (e) { /* 何もしない */ }
    return res;
  }

  /* この端末が「接続先・合言葉なしで、ログインだけで」消耗品管理を使えるか（2026-11-08 代表者「端末ごとの設定を極限までなくす」）。
   * スイッチが入・ログインが確かめられた（OK）・印が「切り替えた後」の3つがそろう時だけ true。それ以外・分からない・時間切れは false
   * （false の時、画面は今までどおり接続先の設定を求める）。読むだけで、端末には何も書かない（スイッチの控えは refreshFlags と同じ）。例外は外へ出さない */
  function liveReady() {
    try {
      var tm = null;
      var late = new Promise(function (ok) { tm = setTimeout(function () { ok(false); }, 8000); });
      var probe = refreshFlags().then(function () {
        if (!switchOn()) return false;
        return loadAuth().then(function (A) {
          if (!A) return false;
          return Promise.resolve().then(function () { return A.check(); }).then(function (st) {
            if (!st || st.status !== (A.STATUS || {}).OK) return false;
            return mode(A, true).then(function (m) { return m === 'live'; });
          });
        });
      }).then(function (v) { return v === true; }, function (e) { note('使える状態', e); return false; });
      return Promise.race([probe, late]).then(function (v) { clearTimeout(tm); return v === true; });
    } catch (e) { return Promise.resolve(false); }
  }

  root.SUSup = { send: send, liveReady: liveReady, refreshFlags: refreshFlags, _forgetMode: function () { modeCache = null; modeAt = 0; }, _reset: function () { modeCache = null; modeAt = 0; ownFlags = null; flagsAt = 0; flagsP = null; authP = null; } };
})(typeof window !== 'undefined' ? window : this);
