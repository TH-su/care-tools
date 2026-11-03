/*
 * su-sa.js — 過去シフト・アナライザ（シフト分析）のクラウド同期の保存先の切り替え（統合 0050・0051・2026-11-03 代表者の決定: アナライザを先に・管理者と事務所が編集）
 * ════════════════════════════════════════════════════════════════
 * 過去シフト・アナライザ（shift-analyzer.html）のクラウド同期（cloudApi）の1回の送信だけを、ここに通す。
 *   SUSa.call(本文, Google へ送る関数) は、Google の GAS が返すのと同じ形の答え（JSON のもの）を返す。
 *   Google へ送る関数は、今までの cloudApi の中身（URL と合言葉の確かめ・fetch・res.json()）のまま（この部品は中身に触らない）。
 * ・スイッチ su-backend.json の supabase.analyzer が切・読めない時は、Google へ送る関数をそのまま呼ぶ
 *   ＝本文も送り方も1バイトも変わらない（CLAUDE.md §2-3）。
 * ・スイッチが入の時は、データベースの印（sa_mode_get）が「切り替えた後」の時だけ、データベースの関数（sa_ping・sa_pull・sa_head・sa_push）を呼ぶ
 *   （合言葉は送らない。データベースがログインの役割で決める＝管理者と事務所。答えの形は GAS と同じ・role はいつも rw）。
 *   印が写しの期間・0051 の前（関数が無い）時は Google。
 * ・スイッチが入の間は、断られた・届かない・印を確かめられない時に Google へ流さない（CLAUDE.md §4）。断りは GAS と同じ形（{error:文}）で返す
 *   （画面は error の文をそのまま出す）。データベースが「写しの期間」（sa_not_live）と答えた時だけ Google へ送る（データベースは何も書いていない）。
 * ・ログインしていない端末・現場のアカウント・使える人に無いアカウントは、印だけの口（sa_mode_public・{ok, mode} だけ）を読み、
 *   切り替えた後なら Google へ送らずに断る（「ログインしてください」「このアカウントでは使えません」）。止める印を知らない古い GAS のデプロイが
 *   残っていても、保存を送らない（反証レビュー 2026-11-03 指摘2）。印が分からない時は、保存は断り（送らない）、読み取りは Google へ送る
 *   （切り替えた後の Google は読み取りも sa_switched で断る＝資格の一覧を出さない・指摘1。その断りも同じ文に置き換え、中身は渡さない）。
 * ・現場の端末（su_device_role が field）は、スイッチが入の間はクラウド同期を使わない（CLAUDE.md §2-5・probe も偽・自動同期もしない・指摘3）。
 * ・2段階認証がまだの管理者はログインしているとみなし、断られた時だけ「2段階認証を済ませて」と出す。
 * ・読み取り（ping・pull・head）の前は印をいつも読み直す（切り替えた直後に古い印で Google から読まない）。保存は1分覚える。
 * ・切り替えた後は、端末に URL・合言葉が無くても同期できる（liveHint・probe）。切り替えた時にデータベースが rev を 1000 進めるので、
 *   切り替えた後の最初の同期では、どの端末も全部を読み直して統合する（画面の今までの動きのまま）。
 * ・Google への写し返しは、アナライザ同期の GAS の自動（1時間ごと・写し返し専用のアカウント）に任せる（画面からは頼まない）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUSa が無ければ Google へ送る）・例外を外に出さない
 *   （外へ出すのは、新しい保存先へ届かない・時間切れの時だけ＝画面の今までの通信の失敗と同じ扱い）。
 *   端末に書くのは、su-kv.js と同じスイッチの控え（su_backend_flags）だけ。
 */
(function (root) {
  'use strict';
  if (root.SUSa) return;
  var FLAG = 'analyzer';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var CALL_MS = 45000;
  var MODE_MS = 60000;
  var KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
  var WRITES = { push: 1 };
  function fieldDevice() { try { return root.localStorage.getItem('su_device_role') === 'field'; } catch (e) { note('端末の用途', e); return false; } }

  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('保存・同期の失敗', e, 'sa:' + where); } catch (x) { /* 記録できなくても止めない */ }
  }

  /* ── スイッチ（su-sup.js と同じ読み方。su-kv.js があればその値、無ければ最後に読めた値・1分ごとに読み直す）── */
  var ownFlags = null, flagsAt = 0, flagsP = null;
  function flags() {
    try { if (root.SUKv && typeof root.SUKv._flags === 'function') return root.SUKv._flags(); } catch (e) { note('スイッチ', e); }
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
            try { root.localStorage.setItem(FLAGS_LS, JSON.stringify(ownFlags)); } catch (e) { note('スイッチの控え', e); }   // su-kv.js と同じく、最後に読めた値を残す
          }
        }, function () {}),
      new Promise(function (ok) { setTimeout(ok, 3000); })
    ]).then(function () { flagsP = null; }, function () { flagsP = null; });
    return flagsP;
  }

  /* ── ログインの部品を必要な時だけ読む（1回だけ。失敗した時だけ次の送信で読み直す）── */
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = root.document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      root.document.head.appendChild(s);
    });
  }
  var authP = null;
  function loadAuth() {
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    if (authP) return authP;
    var p = root.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    authP = p.then(function () { return root.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return root.SUAuth || null; });
    authP.then(function (A) { if (!A) authP = null; }, function () { authP = null; });
    return authP;
  }

  var MSG = {
    login: 'この端末はログインしていません。ログインしてから、もう一度お試しください（アナライザのクラウド保存は新しい保存先に切り替わっています）',
    role: 'このアカウントではアナライザのクラウド保存を使えません。事務所か管理者のアカウントでログインしてください',
    noauth: 'ログインの部品を読み込めませんでした。ページを読み込み直してください',
    mode: '新しい保存先の状態を確かめられませんでした。少し待ってから、もう一度お試しください',
    mfa: '2段階認証を済ませてください。ログインの画面で6桁を入れてから、もう一度お試しください',
    net: '新しい保存先に届きませんでした。通信を確かめて、もう一度お試しください',
    timeout: '新しい保存先の応答が時間切れになりました。もう一度お試しください（保存は、取得してから確かめてください）',
    toolarge: '記録が多くなり、新しい保存先に入りきらなくなりました。この保存は入っていません。管理者へ連絡してください',
    badreq: '新しい保存先が受け付けない形でした。この保存は入っていません。画面を読み込み直してください',
    db: '新しい保存先が受け付けませんでした。この保存は入っていません。少し待ってから、もう一度お試しください（続く時は管理者へ連絡してください）',
    field: 'この端末は「現場」のため、アナライザのクラウド保存は使えません。事務所のパソコンで使ってください',
    empty: '新しい保存先の応答が空でした。取得して、入っているか確かめてください'
  };
  function refusal(code) { return { error: MSG[code] }; }

  /* データベースの印（sa_mode_get）。1分は覚える。関数が無い（0051 の前）時は 'shadow'。断り（現場・使える人に無い）は 'denied'、届かない時は例外 */
  var modeCache = null, modeAt = 0;
  var READS = { ping: 1, pull: 1, head: 1 };
  function mode(A, fresh) {
    if (!fresh && modeCache && Date.now() - modeAt < MODE_MS) return Promise.resolve(modeCache);
    return Promise.resolve(A.client().rpc('sa_mode_get')).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
      if (r && r.error && c === '42501') return 'denied';
      if (!r || r.error || !r.data) throw new Error('mode');
      modeCache = r.data.mode === 'live' ? 'live' : 'shadow'; modeAt = Date.now();
      return modeCache;
    });
  }

  /* 印だけの口（sa_mode_public・誰でも・{ok, mode} だけ）。ログインしていない端末・現場のアカウントでも読める。
     'live'・'shadow'・'missing'（0051 の前）・'unknown'（届かない・読めない）を返す（例外は外へ出さない） */
  function publicMode(A) {
    return Promise.resolve().then(function () { return A.client().rpc('sa_mode_public'); }).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'missing';
      if (!r || r.error || !r.data) { note('印だけの口', c || 'empty'); return 'unknown'; }
      return r.data.mode === 'live' ? 'live' : 'shadow';
    }, function (e) { note('印だけの口', e); return 'unknown'; });
  }

  /* 画面の本文（GAS へ送る形）を、データベースの関数と引数に置き換える。知らない操作は null（GAS と同じ unknown action を返す） */
  function rpcOf(body) {
    var keys = Array.isArray(body.keys) ? body.keys.filter(function (k) { return typeof k === 'string' && KEY_RE.test(k); }) : null;
    // キーを渡したのに全部が形の違うキーだった時は、空の答え（全部を返す p_keys=[] を送らない・指摘8）
    if (keys && !keys.length && body.keys.length) {
      if (body.action === 'pull') return { empty: { ok: true, entries: {}, role: 'rw' } };
      if (body.action === 'head') return { empty: { ok: true, revs: {}, role: 'rw' } };
    }
    if (body.action === 'ping') return { fn: 'sa_ping', args: {} };
    if (body.action === 'pull') return { fn: 'sa_pull', args: { p_keys: keys } };
    if (body.action === 'head') return { fn: 'sa_head', args: { p_keys: keys } };
    if (body.action === 'push') {
      var base = Number(body.baseRev);
      return { fn: 'sa_push', args: { p_key: body.key, p_data: body.data === undefined ? null : body.data, p_base_rev: isFinite(base) ? Math.floor(base) : 0, p_force: !!body.force } };
    }
    return null;
  }

  /* データベースの関数を呼ぶ。答え（GAS と同じ形）か、断り（{error:文}）を返す。届かない・時間切れは例外（文は職員向け） */
  function callDb(A, body, ms, mfa) {
    var q = rpcOf(body);
    if (!q) return Promise.resolve({ error: 'unknown action' });
    if (q.empty) return Promise.resolve(q.empty);
    var tm = null;
    var call = Promise.resolve(A.client().rpc(q.fn, q.args));
    var timer = new Promise(function (ok) { tm = setTimeout(function () { ok({ timeout: true }); }, ms); });
    return Promise.race([call, timer]).then(function (r) {
      clearTimeout(tm);
      if (r && r.timeout) throw new Error(MSG.timeout);
      if (r && r.error) {
        var c = String(r.error.code || '');
        if (c === '42501') return refusal(mfa ? 'mfa' : 'role');
        if (/PGRST202|42883/.test(c)) { modeCache = null; return refusal('mode'); }
        note(q.fn, c || 'error');
        if (c) return refusal('db');   // データベースが番号つきで断った（届いてはいる）＝「受け付けませんでした」（指摘7）
        throw new Error(MSG.net);      // 番号の無い失敗（届かない）
      }
      var d = r ? r.data : null;
      if (!d || typeof d !== 'object') return refusal('empty');
      if (d.error === 'toolarge') return refusal('toolarge');
      if (d.error === 'bad-request') return refusal('badreq');
      return d;   // sa_badchar は職員向けの文が error に入っている・sa_not_live は呼び手が Google へ回す
    }, function (e) { clearTimeout(tm); note(q.fn, e); throw new Error(MSG.net); });
  }

  /* 送る前の確かめ（ログイン・印）。返すのは道: gas（Google）・outside（ログインしていない・現場のアカウントなど＝印だけの口で決める）・
     refuse（断り）・live（データベース） */
  function plan(body) {
    return loadAuth().then(function (A) {
      if (!A) return { kind: 'refuse', code: 'noauth' };
      return Promise.resolve().then(function () { return A.check(); }).then(function (st) {
        var S = A.STATUS || {}, s0 = st && st.status;
        if (s0 === S.SIGNED_OUT) return { kind: 'outside', A: A, code: 'login' };
        if (s0 === S.DENIED) return { kind: 'outside', A: A, code: 'role' };
        var mfa = s0 === S.MFA_VERIFY || s0 === S.MFA_ENROLL;
        if (s0 !== S.OK && !mfa) return { kind: 'refuse', code: 'mode' };   // 通信などで確かめられない＝もう一度
        return mode(A, !!READS[body.action]).then(function (m) {
          if (m === 'denied') return mfa ? { kind: 'refuse', code: 'mfa' } : { kind: 'outside', A: A, code: 'role' };   // 現場のアカウント
          if (m !== 'live') return { kind: 'gas' };
          return { kind: 'live', A: A, mfa: mfa };
        }, function (e) { note('印', e); return { kind: 'refuse', code: 'mode' }; });
      }, function (e) { note('確かめ', e); return { kind: 'refuse', code: 'mode' }; });
    }, function (e) { note('ログインの部品', e); return { kind: 'refuse', code: 'noauth' }; });
  }

  function isSwitched(j) { return !!(j && typeof j === 'object' && j.code === 'sa_switched'); }

  /* 画面の入口。gasCall() は今までどおり Google へ送り、GAS の答え（JSON のもの）を返す関数（この部品は中身に触らない） */
  function call(body, gasCall) {
    try {
      if (!body || typeof body !== 'object' || typeof body.action !== 'string') return gasCall();
    } catch (e) { return gasCall(); }
    var t0 = Date.now();
    return refreshFlags().then(function () {
      if (!switchOn()) return gasCall();
      if (fieldDevice()) return refusal('field');   // 現場の端末は使わない（Google へも送らない・指摘3）
      var tm = null;
      var late = new Promise(function (ok, ng) { tm = setTimeout(function () { ng(new Error(MSG.mode)); }, CALL_MS); });
      return Promise.race([plan(body), late]).then(function (p) {
        clearTimeout(tm);
        if (p.kind === 'refuse') return refusal(p.code);
        if (p.kind === 'outside') {
          return publicMode(p.A).then(function (pm) {
            if (pm === 'live') return refusal(p.code);                          // 切り替えた後＝Google へ送らない（古いデプロイにも保存させない）
            if (pm === 'unknown' && WRITES[body.action]) return refusal('mode');   // 分からない時は保存を送らない（読み取りは Google が決める）
            return Promise.resolve(gasCall()).then(function (j) {
              if (isSwitched(j)) return refusal(p.code);                        // 切り替えた後の Google の断り（読み取りも）＝中身は渡さない
              return j;
            });
          });
        }
        if (p.kind === 'gas') {
          return Promise.resolve(gasCall()).then(function (j) { if (isSwitched(j)) modeCache = null; return j; });
        }
        var left = Math.max(1000, CALL_MS - (Date.now() - t0));
        return callDb(p.A, body, left, p.mfa).then(function (d) {
          if (d && d.error === 'sa_not_live') { modeCache = null; modeAt = 0; return gasCall(); }   // 写しの期間へ戻った＝Google が正本（データベースは書いていない）
          return d;
        });
      }, function (e) { clearTimeout(tm); throw e; });
    });
  }

  /* 切り替えた後は、端末に URL・合言葉が無くても同期してよいか（最後に確かめた印が live で、スイッチが入）。画面の「設定済みか」の判定に足す */
  function liveHint() { return switchOn() && !fieldDevice() && modeCache === 'live'; }
  /* 現場の端末でスイッチが入＝クラウド同期を使わない（画面は自動同期を始めない） */
  function blocked() { return switchOn() && fieldDevice(); }
  /* 起動の時に1回: スイッチが入で、ログインしていて印が live なら true（URL・合言葉の無い端末でも自動同期を始めるため）。例外は外へ出さない */
  function probe() {
    return refreshFlags().then(function () {
      if (!switchOn() || fieldDevice()) return false;
      return loadAuth().then(function (A) {
        if (!A) return false;
        return Promise.resolve(A.check()).then(function (st) {
          var S = A.STATUS || {}, s0 = st && st.status;
          if (s0 !== S.OK && s0 !== S.MFA_VERIFY && s0 !== S.MFA_ENROLL) return false;
          return mode(A, true).then(function (m) { return m === 'live'; });
        });
      });
    }).then(function (v) { return !!v; }, function (e) { note('起動の確かめ', e); return false; });
  }

  root.SUSa = { call: call, liveHint: liveHint, blocked: blocked, probe: probe, refreshFlags: refreshFlags,
    _forgetMode: function () { modeCache = null; modeAt = 0; },
    _reset: function () { modeCache = null; modeAt = 0; ownFlags = null; flagsAt = 0; flagsP = null; authP = null; } };
})(typeof window !== 'undefined' ? window : this);
