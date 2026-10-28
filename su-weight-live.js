/*
 * su-weight-live.js — 体重管理の保存先の切り替え（統合 0032・2026-10-28 代表者の依頼「体重を作って」）
 * ════════════════════════════════════════════════════════════════
 * 体重管理（weight-record.html）の通信の入口（apiGet・apiPost）だけから呼ぶ。画面の表示・入力・印刷には触れない。
 *
 * 決めごと:
 *   ・スイッチは su-backend.json の supabase.weight。無い・true 以外・一度も読めていない＝切＝今までどおり Google（何も変わらない）。
 *   ・スイッチが入でも、データベースの印（weight_mode）が「写しの期間（shadow）」の間は、データベースが 'shadow' と答えるので
 *     今までどおり Google で読み書きする（写しも今までどおり）。管理者が写しの見比べで「切り替える」と、その次の通信から Supabase。
 *     どちらへ書くかは、書く度にデータベースが答える（印を読む・書くを同じ関数の中で行う）＝端末ごとに食い違わない。
 *   ・切り替えた後は Supabase で読み書きし、Google と同じ形の応答を返す（{ok, ver:2, residents, records, thresholds}・{ok, ver:2}）。
 *     ★Supabase に断られた時（ログインしていない・権限が無い・消しすぎ・形の違い）は Google へ流さない。
 *       失敗として返す（画面は未送信に残して後で送り直す＝「保存しました」と出さない）。
 *     ★Supabase に保存できたら、同じ書き込みを Google へも写し返す（戻せるように）。写し返しは端末の送信待ち
 *       （wtmgr_mirror_q）に積んで1件ずつ送り、Google が受け取った時だけ外す。スイッチを切った後・写しの期間に戻った後は、
 *       Google へ直接送る前に、残っている写し返しを先に送る（順番を入れ替えない）。
 *   ・ログインの控えが無い端末でスイッチが入っている時は、読み書きとも「ログインしてください」の失敗にする
 *     （切り替え済みかどうかを確かめられないため、Google へは流さない）。
 *   ・読み込み・書き込みとも、データベースに関数が無い（0032 を流す前）時は、写しの期間と同じく Google。
 * 読み込めなくても体重管理は今までどおり動く（画面は window.SUWeightLive が無ければ Google）。例外は外へ出さない
 * （ネットの失敗だけは、今までの Google の通信と同じく画面の失敗の扱いへ渡す）。
 */
(function () {
  'use strict';
  if (window.SUWeightLive) return;
  var FLAGS_URL = 'su-backend.json', FLAGS_LS = 'su_backend_flags', SWITCH = 'weight';
  var MIRROR_LS = 'wtmgr_mirror_q', MIRROR_MAX = 2000, MIRROR_RETRY_MS = 60000;
  var RPC_TIMEOUT_MS = 15000;
  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var NO_FUNC = { PGRST202: 1, '42883': 1 };
  var MSG = {
    login: 'ログインしていないため、体重をサーバーへ送れません（記録はこの端末に残っています）。ログインの画面でログインしてから、体重管理を開き直してください',
    denied: 'このアカウントでは体重を保存できません（記録はこの端末に残っています）。事務所に連絡してください',
    toomany: '短い間に消す操作が多すぎるため、いったん止めました（記録はこの端末に残っています）。しばらくしてから自動で送り直します',
    badrow: 'この記録の形が正しくないため、サーバーに保存できませんでした（記録はこの端末に残っています）。事務所に連絡してください',
    toolarge: 'この記録が大きすぎるため、サーバーに保存できませんでした（記録はこの端末に残っています）。事務所に連絡してください',
    timeout: 'サーバーの応答が時間内にありませんでした（記録はこの端末に残っています）。通信を確かめてください'
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsJson(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function note(where, e) { try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('保存・同期の失敗', e, 'weight-live:' + where); } catch (e2) { /* 記録できなくても動きは変えない */ } }

  // ── スイッチ（su-kv.js と同じ読み方: 1分以内なら読み直さない・3秒で見切って最後に読めた値・?t= は外さない）──
  var flags = lsJson(FLAGS_LS), flagsTriedAt = 0, flagsPromise = null;
  function fetchFlags() {
    if (flagsPromise) return flagsPromise;
    flagsTriedAt = Date.now();
    flagsPromise = fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && isObj(j.supabase)) {
          flags = { supabase: j.supabase };
          try { localStorage.setItem(FLAGS_LS, JSON.stringify(flags)); } catch (e) { /* 控えを残せなくても次に読む */ }
        }
      })
      .catch(function () { /* 読めない時は最後に読めた値のまま */ })
      .then(function () { flagsPromise = null; });
    return flagsPromise;
  }
  function ensureFlags() {
    if (flagsTriedAt && Date.now() - flagsTriedAt < 60000 && !flagsPromise) return Promise.resolve();
    return Promise.race([fetchFlags(), new Promise(function (ok) { setTimeout(ok, 3000); })]);
  }
  function switchOn() { return !!(flags && isObj(flags.supabase) && flags.supabase[SWITCH] === true); }

  // ── ログイン（su-kv.js の ensureAuth と同じ: すでに札がある部品は入れ直さず、読み終わるのを待つ）──
  function hasSession() {
    try { for (var i = 0; i < localStorage.length; i++) if (SESSION_RE.test(localStorage.key(i) || '')) return true; } catch (e) { /* 読めない＝無い */ }
    return false;
  }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function hasTag(name) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) if (String(ss[i].getAttribute('src') || '').split('?')[0].split('/').pop() === name) return true;
    return false;
  }
  function waitFor(test, ms) {
    return new Promise(function (ok, ng) {
      var t0 = Date.now();
      (function poll() { if (test()) ok(); else if (Date.now() - t0 > ms) ng(new Error('load')); else setTimeout(poll, 100); })();
    });
  }
  function ensureAuth() {
    if (window.SUAuth) return Promise.resolve();
    if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
    var p = window.supabase ? Promise.resolve()
      : (hasTag('supabase-js-2.112.4.js') ? waitFor(function () { return !!window.supabase; }, 8000) : loadScript('supabase-js-2.112.4.js'));
    return p.then(function () {
      if (window.SUAuth) return null;
      if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
      return loadScript('su-auth.js?v=2026-10-24');
    });
  }
  /* データベースの関数を呼ぶ。{data} か {error:{code,message}}。時間切れ・ネットの失敗は例外（画面の失敗の扱いへ） */
  function rpc(name, args) {
    var call = ensureAuth().then(function () { return window.SUAuth.client().rpc(name, args); });
    var limit = new Promise(function (ok, ng) { setTimeout(function () { ng(new Error(MSG.timeout)); }, RPC_TIMEOUT_MS); });
    return Promise.race([call, limit]);
  }
  function errCode(r) { return String((r && r.error && (r.error.code || r.error.message)) || ''); }

  // ── Google へ写し返す送信待ち（端末に積み、1件ずつ・受け取った時だけ外す）──
  function mirrorLoad() { var q = lsJson(MIRROR_LS); return Array.isArray(q) ? q : []; }
  function mirrorSave(q) {
    try { if (q.length) localStorage.setItem(MIRROR_LS, JSON.stringify(q)); else localStorage.removeItem(MIRROR_LS); }
    catch (e) { note('写し返しの控え', e); }
  }
  function mirrorPush(action, data) {
    var q = mirrorLoad();
    q.push({ action: action, data: data, at: Date.now() });
    if (q.length > MIRROR_MAX) { note('写し返しの送信待ちがあふれた', new Error(String(q.length - MIRROR_MAX))); q = q.slice(-MIRROR_MAX); }
    mirrorSave(q);
  }
  var gasPost = null, draining = null, retryTimer = 0;
  /* 残っている写し返しを先頭から送る。失敗したらそこで止める（順番を入れ替えない）。同時に2本は走らせない */
  function drainMirror(post) {
    if (post) gasPost = post;
    if (draining) return draining;
    if (!gasPost || !mirrorLoad().length) return Promise.resolve(true);
    draining = (function next() {
      var q = mirrorLoad();
      if (!q.length) return Promise.resolve(true);
      var it = q[0];
      return Promise.resolve()
        .then(function () { return gasPost(it.action, it.data || {}); })
        .then(function (r) {
          if (!(r && r.ok !== false)) return false;
          var cur = mirrorLoad();
          if (cur.length && cur[0].at === it.at && cur[0].action === it.action) { cur.shift(); mirrorSave(cur); }
          return next();
        }, function () { return false; });
    })().then(function (done) {
      draining = null;
      if (!done) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { if (!document.hidden) drainMirror(); }, MIRROR_RETRY_MS);
      }
      return done;
    }, function (e) { draining = null; note('写し返し', e); return false; });
    return draining;
  }

  // ── 読む ──
  /* GAS の getAll はシートの列を全部の行に出す（無い値は null）。同じ形にそろえる（画面の合わせ方を変えないため） */
  function fillKeys(rows) {
    if (!Array.isArray(rows)) return [];
    var keys = {};
    rows.forEach(function (r) { if (isObj(r)) Object.keys(r).forEach(function (k) { keys[k] = 1; }); });
    var ks = Object.keys(keys);
    return rows.filter(isObj).map(function (r) {
      var o = {};
      ks.forEach(function (k) { o[k] = Object.prototype.hasOwnProperty.call(r, k) ? r[k] : null; });
      return o;
    });
  }
  var lastFrom = '';   // 'supabase'＝最後の読み込みは Supabase から（写しの部品はその時に写さない）
  /**
   * 全件を読む。null＝Google で読む（スイッチが切・写しの期間・関数がまだ無い）。それ以外は GAS の getAll と同じ形
   * （断られた時は {error: 職員向けの文}）。post は Google へ送る関数（写し返しの残りを先に送るため）
   */
  function getAll(post) {
    if (post) gasPost = post;
    return ensureFlags().then(function () {
      if (!switchOn()) { lastFrom = ''; return drainMirror().then(function () { return null; }); }
      if (!hasSession()) { lastFrom = ''; return { error: MSG.login }; }
      return rpc('weight_get_all', {}).then(function (r) {
        var code = errCode(r);
        if (NO_FUNC[code] || (!r.error && r.data && r.data.error === 'shadow')) {
          lastFrom = '';
          return drainMirror().then(function () { return null; });
        }
        if (r.error) { lastFrom = ''; return { error: code === '42501' ? MSG.denied : MSG.login }; }
        var d = r.data || {};
        if (!d.ok) { lastFrom = ''; return { error: String(d.error || '') || MSG.denied }; }
        lastFrom = 'supabase';
        drainMirror();
        return { ok: true, ver: 2, residents: fillKeys(d.residents), records: fillKeys(d.records),
                 thresholds: isObj(d.thresholds) ? d.thresholds : null };
      });
    });
  }

  // ── 書く ──
  /**
   * 1件を書く。null＝Google へ送る（スイッチが切・写しの期間・関数がまだ無い。写し返しの残りは先に送ってある）。
   * それ以外は GAS と同じ形の応答（{ok:true, ver:2} か {ok:false, error: 職員向けの文}）。
   * payload＝データベースへ送る中身（画面が GAS へ送る resident・record・id・thresholds と同じもの）。
   * data＝画面の書き込みの元（Google へ写し返す時に post(action, data) でそのまま送る）。
   */
  function post(action, payload, data, postFn) {
    if (postFn) gasPost = postFn;
    return ensureFlags().then(function () {
      if (!switchOn()) return drainMirror().then(function () { return null; });
      if (!hasSession()) return { ok: false, error: MSG.login };
      return rpc('weight_write', { p_action: action, p_payload: payload || {} }).then(function (r) {
        var code = errCode(r);
        if (NO_FUNC[code] || (!r.error && r.data && r.data.error === 'shadow')) return drainMirror().then(function () { return null; });
        if (r.error) return { ok: false, error: code === '42501' ? MSG.denied : MSG.login };
        var d = r.data || {};
        if (!d.ok) return { ok: false, error: MSG[d.error] || String(d.error || '') || MSG.denied };
        try { mirrorPush(action, JSON.parse(JSON.stringify(data || {}))); } catch (e) { note('写し返しの積み込み', e); }
        drainMirror();
        return { ok: true, ver: 2 };
      });
    });
  }

  try {
    document.addEventListener('visibilitychange', function () { if (!document.hidden && mirrorLoad().length) drainMirror(); });
  } catch (e) { /* 何もしない */ }

  window.SUWeightLive = {
    getAll: getAll,
    post: post,
    readFromSupabase: function () { return lastFrom === 'supabase'; },
    mirrorPending: function () { return mirrorLoad().length; },
    _drainMirror: drainMirror
  };
})();
