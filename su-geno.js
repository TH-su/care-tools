/*
 * su-geno.js — 家族構成図のクラウド同期の保存先の切り替え（統合 0053・0054・2026-11-03 代表者の決定:
 *   管理者と事務所が保存・現場は見るだけ・利用者No には名簿の1名にだけ一致した時だけ結び付ける・手で結び付ける画面は作らない）
 * ════════════════════════════════════════════════════════════════
 * 家族構成図（genogram.html）のクラウド同期（CloudSync の gasCall）の1回の送信だけを、ここに通す。
 *   SUGeno.call(操作, 引数, Google へ送る関数, {residentId}) は、Google の GAS が返すのと同じ形の答え（JSON のもの）を返す。
 *   Google へ送る関数は、今までの gasCall の送信（fetchWithRetry と res.json()）のまま（この部品は中身に触らない）。
 * ・スイッチ su-backend.json の supabase.genogram が切・読めない時は、Google へ送る関数をそのまま呼ぶ
 *   ＝本文も送り方も1バイトも変わらない（CLAUDE.md §2-3）。
 * ・スイッチが入の時は、データベースの印（geno_mode_get）が「切り替えた後」の時だけ、データベースの関数
 *   （geno_ping・geno_list・geno_get・geno_save・geno_delete）を呼ぶ（合言葉は送らない。データベースがログインの役割で決める）。
 *   印が写しの期間・0054 の前（関数が無い）時は Google。
 * ・利用者No（residentId）は、入居者マスタから ?resident= で開いた方の図の時だけ画面が渡す。読込・保存・削除の全部に p_resident_id として添える
 *   （ほかの方の図・同姓同名の方の図に書かないための守りはデータベースが行う・反証レビュー 2026-11-03 指摘1・3）。
 * ・スイッチが入の間は、断られた・届かない・印を確かめられない時に Google へ流さない（CLAUDE.md §4）。
 *   断りは GAS と同じ形（{ok:false, error:文, code}）で返す。code が su_ で始まり keep が真の断り（確かめられない・通信）は、画面が保留に残す。
 *   それ以外の code の付いた断り（ログイン・役割・データベースの断り geno_*）は「書いていない」ので、画面は保留から外して文を出す。
 *   データベースが「写しの期間」（geno_not_live）と答えた時だけ Google へ送る（データベースは何も書いていない）。
 * ・ログインしていない端末・使える人に無いアカウントは、印だけの口（geno_mode_public・{ok, mode} だけ）を読み、
 *   切り替えた後なら Google へ送らずに断る（止める印を知らない古い GAS のデプロイが残っていても、図を読み書きしない）。
 *   印が分からない時は、保存・削除は送らず、読み取りは Google へ送る（切り替えた後の Google は読み取りも geno_switched で断る。
 *   その断りも同じ文に置き換え、中身は渡さない）。
 * ・現場の端末（su_device_role が field）・現場のアカウントは見るだけ（保存・削除は送らずに断る。読み取りは新しい保存先から）。
 * ・2段階認証がまだの管理者はログインしているとみなし、断られた時だけ「2段階認証を済ませて」と出す。
 * ・読み取りの前は印をいつも読み直す（切り替えた直後に古い印で Google から読まない）。保存・削除は1分覚える。
 * ・Google への写し返しは、家族構成図同期の GAS の自動（1時間ごと・写し返し専用のアカウント）に任せる（画面からは頼まない）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUGeno が無ければ Google へ送る）・例外を外に出さない
 *   （外へ出すのは、新しい保存先へ届かない・時間切れの時だけ＝画面の今までの通信の失敗と同じ扱い）。
 *   端末に書くのは、su-kv.js と同じスイッチの控え（su_backend_flags）だけ。図・氏名・利用者No は端末に残さない。
 */
(function (root) {
  'use strict';
  if (root.SUGeno) return;
  var FLAG = 'genogram';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var CALL_MS = 45000;
  var MODE_MS = 60000;
  var WRITES = { save: 1, 'delete': 1 };
  var READS = { ping: 1, list: 1, get: 1 };
  function fieldDevice() { try { return root.localStorage.getItem('su_device_role') === 'field'; } catch (e) { note('端末の用途', e); return false; } }

  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('保存・同期の失敗', e, 'geno:' + where); } catch (x) { /* 記録できなくても止めない */ }
  }

  /* ── スイッチ（su-sa.js と同じ読み方。su-kv.js があればその値、無ければ最後に読めた値・1分ごとに読み直す）── */
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
            try { root.localStorage.setItem(FLAGS_LS, JSON.stringify(ownFlags)); } catch (e) { note('スイッチの控え', e); }
          }
        }, function (e) { note('スイッチの読み込み', e); }),
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
    login: 'この端末はログインしていません。ログインしてから、もう一度お試しください（家族構成図のクラウド保存は新しい保存先に切り替わっています）',
    role: 'このアカウントでは家族構成図を使えません。事務所か管理者のアカウントでログインしてください',
    view: 'このアカウント・この端末では家族構成図を見ることだけができます。直す時は、事務所か管理者のアカウントで事務所のパソコンから保存してください',
    noauth: 'ログインの部品を読み込めませんでした。ページを読み込み直してください',
    mode: '新しい保存先の状態を確かめられませんでした。少し待ってから、もう一度お試しください',
    mfa: '2段階認証を済ませてください。ログインの画面で6桁を入れてから、もう一度お試しください',
    net: '新しい保存先に届きませんでした。通信を確かめて、もう一度お試しください',
    timeout: '新しい保存先の応答が時間切れになりました。もう一度お試しください（保存は、読み込み直して確かめてください）',
    db: '新しい保存先が受け付けませんでした。この保存は入っていません。少し待ってから、もう一度お試しください（続く時は管理者へ連絡してください）',
    empty: '新しい保存先の応答が空でした。読み込み直して、入っているか確かめてください'
  };
  // keep … 書いたか分からない・確かめられないだけ（画面は保留に残す）。それ以外は「書いていない」断り（保留から外す）
  var KEEP = { mode: 1, noauth: 1 };
  function refusal(code) { return { ok: false, error: MSG[code], code: 'su_' + code, keep: !!KEEP[code] }; }

  /* データベースの印（geno_mode_get・ログインした使える人なら誰でも）。1分は覚える。関数が無い（0054 の前）時は 'shadow'。
     断り（使える人に無い）は 'denied'、届かない時は例外 */
  var modeCache = null, modeAt = 0;
  function mode(A, fresh) {
    if (!fresh && modeCache && Date.now() - modeAt < MODE_MS) return Promise.resolve(modeCache);
    return Promise.resolve(A.client().rpc('geno_mode_get')).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
      if (r && r.error && c === '42501') return 'denied';
      if (!r || r.error || !r.data) throw new Error('mode');
      modeCache = r.data.mode === 'live' ? 'live' : 'shadow'; modeAt = Date.now();
      return modeCache;
    });
  }

  /* 印だけの口（geno_mode_public・誰でも・{ok, mode} だけ）。'live'・'shadow'・'missing'・'unknown' を返す（例外は外へ出さない） */
  function publicMode(A) {
    return Promise.resolve().then(function () { return A.client().rpc('geno_mode_public'); }).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'missing';
      if (!r || r.error || !r.data) { note('印だけの口', c || 'empty'); return 'unknown'; }
      return r.data.mode === 'live' ? 'live' : 'shadow';
    }, function (e) { note('印だけの口', e); return 'unknown'; });
  }

  function rid(ctx) {
    var v = ctx && ctx.residentId;
    v = (v === undefined || v === null) ? '' : String(v).trim();
    return v ? v : null;
  }
  /* 画面の操作と引数を、データベースの関数と引数に置き換える。知らない操作は null（GAS と同じ unknown action を返す）。
     base は画面が付けた時だけ添える（付けない時は今までどおり無条件・GAS と同じ） */
  function rpcOf(action, p, ctx) {
    p = p || {};
    var r = rid(ctx);
    if (action === 'ping') return { fn: 'geno_ping', args: {} };
    if (action === 'list') return { fn: 'geno_list', args: {} };
    if (action === 'get') return { fn: 'geno_get', args: { p_name: p.name == null ? null : String(p.name), p_resident_id: r } };
    if (action === 'save') {
      var a = { p_doc: p.doc === undefined ? null : p.doc, p_resident_id: r };
      if (p.base !== undefined && p.base !== null) a.p_base = String(p.base);
      return { fn: 'geno_save', args: a };
    }
    if (action === 'delete') {
      var d = { p_name: p.name == null ? null : String(p.name), p_resident_id: r };
      if (p.base !== undefined && p.base !== null) d.p_base = String(p.base);
      return { fn: 'geno_delete', args: d };
    }
    return null;
  }

  /* データベースの関数を呼ぶ。答え（GAS と同じ形）か、断り（{ok:false, error:文, code}）を返す。届かない・時間切れは例外（文は職員向け） */
  function callDb(A, action, p, ctx, ms, mfa, view) {
    var q = rpcOf(action, p, ctx);
    if (!q) return Promise.resolve({ ok: false, error: 'unknown action: ' + action });
    var tm = null;
    var call = Promise.resolve(A.client().rpc(q.fn, q.args));
    var timer = new Promise(function (ok) { tm = setTimeout(function () { ok({ timeout: true }); }, ms); });
    return Promise.race([call, timer]).then(function (r) {
      clearTimeout(tm);
      if (r && r.timeout) throw new Error(MSG.timeout);
      if (r && r.error) {
        var c = String(r.error.code || '');
        if (c === '42501') return refusal(mfa ? 'mfa' : (WRITES[action] || view ? 'view' : 'role'));
        if (/PGRST202|42883/.test(c)) { modeCache = null; return refusal('mode'); }
        note(q.fn, c || 'error');
        if (c) return refusal('db');   // データベースが番号つきで断った（届いてはいる）
        throw new Error(MSG.net);      // 番号の無い失敗（届かない）
      }
      var d = r ? r.data : null;
      if (!d || typeof d !== 'object') return refusal('empty');
      return d;   // geno_* の断りは職員向けの文が error・code に入っている・geno_not_live は呼び手が Google へ回す
    }, function (e) { clearTimeout(tm); note(q.fn, e); throw new Error(MSG.net); });
  }

  /* 送る前の確かめ（ログイン・印）。返すのは道: gas（Google）・outside（ログインしていない・使える人に無い＝印だけの口で決める）・
     refuse（断り）・live（データベース） */
  function plan(action) {
    return loadAuth().then(function (A) {
      if (!A) return { kind: 'refuse', code: 'noauth' };
      return Promise.resolve().then(function () { return A.check(); }).then(function (st) {
        var S = A.STATUS || {}, s0 = st && st.status;
        if (s0 === S.SIGNED_OUT) return { kind: 'outside', A: A, code: 'login' };
        if (s0 === S.DENIED) return { kind: 'outside', A: A, code: 'role' };
        var mfa = s0 === S.MFA_VERIFY || s0 === S.MFA_ENROLL;
        if (s0 !== S.OK && !mfa) return { kind: 'refuse', code: 'mode' };   // 通信などで確かめられない＝もう一度
        var view = !!(st && st.role === 'field');
        return mode(A, !!READS[action]).then(function (m) {
          if (m === 'denied') return mfa ? { kind: 'refuse', code: 'mfa' } : { kind: 'outside', A: A, code: 'role' };
          if (m !== 'live') return { kind: 'gas' };
          return { kind: 'live', A: A, mfa: mfa, view: view };
        }, function (e) { note('印', e); return { kind: 'refuse', code: 'mode' }; });
      }, function (e) { note('確かめ', e); return { kind: 'refuse', code: 'mode' }; });
    }, function (e) { note('ログインの部品', e); return { kind: 'refuse', code: 'noauth' }; });
  }

  function isSwitched(j) { return !!(j && typeof j === 'object' && j.code === 'geno_switched'); }

  /* 画面の入口。gasCall() は今までどおり Google へ送り、GAS の答え（JSON のもの）を返す関数（この部品は中身に触らない） */
  function call(action, params, gasCall, ctx) {
    if (typeof action !== 'string') return gasCall();
    var t0 = Date.now();
    return refreshFlags().then(function () {
      if (!switchOn()) return gasCall();
      if (WRITES[action] && fieldDevice()) return refusal('view');   // 現場の端末は見るだけ（Google へも送らない）
      var tm = null;
      var late = new Promise(function (ok, ng) { tm = setTimeout(function () { ng(new Error(MSG.mode)); }, CALL_MS); });
      return Promise.race([plan(action), late]).then(function (p) {
        clearTimeout(tm);
        if (p.kind === 'refuse') return refusal(p.code);
        if (p.kind === 'outside') {
          return publicMode(p.A).then(function (pm) {
            if (pm === 'live') return refusal(p.code);                          // 切り替えた後＝Google へ送らない（古いデプロイにも読み書きさせない）
            if (pm === 'unknown' && WRITES[action]) return refusal('mode');     // 分からない時は保存・削除を送らない（読み取りは Google が決める）
            return Promise.resolve(gasCall()).then(function (j) {
              if (isSwitched(j)) return refusal(p.code);                        // 切り替えた後の Google の断り（読み取りも）＝中身は渡さない
              return j;
            });
          });
        }
        if (p.kind === 'gas') {
          return Promise.resolve(gasCall()).then(function (j) { if (isSwitched(j)) modeCache = null; return j; });
        }
        if (WRITES[action] && p.view) return refusal('view');               // 現場のアカウントは見るだけ（データベースも断る）
        var left = Math.max(1000, CALL_MS - (Date.now() - t0));
        return callDb(p.A, action, params, ctx, left, p.mfa, p.view).then(function (d) {
          if (d && d.ok === false && d.error === 'geno_not_live') { modeCache = null; modeAt = 0; return gasCall(); }   // 写しの期間へ戻った＝Google が正本
          return d;
        });
      }, function (e) { clearTimeout(tm); throw e; });
    });
  }

  /* 切り替えた後は、端末に URL・合言葉が無くても同期してよいか（最後に確かめた印が live で、スイッチが入）。画面の「設定済みか」の判定に足す */
  function liveHint() { return switchOn() && modeCache === 'live'; }
  /* 起動の時に1回: スイッチが入で、ログインしていて印が live なら true。例外は外へ出さない */
  function probe() {
    return refreshFlags().then(function () {
      if (!switchOn()) return false;
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
  /* 切り替えた後か（スイッチが入で、最後に確かめた印が live）。画面の「GAS のコードをコピー」を出さない判定に使う */
  function isLive() { return switchOn() && modeCache === 'live'; }

  root.SUGeno = { call: call, liveHint: liveHint, probe: probe, isLive: isLive, refreshFlags: refreshFlags,
    _forgetMode: function () { modeCache = null; modeAt = 0; },
    _reset: function () { modeCache = null; modeAt = 0; ownFlags = null; flagsAt = 0; flagsP = null; authP = null; } };
})(typeof window !== 'undefined' ? window : this);
