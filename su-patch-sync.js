/*
 * su-patch-sync.js — 貼り薬カレンダーの入居者ごとの設定を Supabase へ送る（段階2「送るだけ」・2026-10-17 代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * 送るだけの期間の約束:
 *   ・表示・印刷は今までどおり端末の控え（localStorage apc2_res）から出す。この部品は控えを読むだけで、書き換えない
 *     （サーバーの値を表示へ取り込むのは段階3）。
 *   ・スイッチは su-backend.json の supabase.patch_push。true の時だけ送る。読めない時は最後に読めた値
 *     （localStorage su_backend_flags・su-kv.js と同じ形）。一度も読めていなければ送らない。
 *   ・送るのは入居者ごとに patch_put(入居者ID, 開始日, 場所, 前日の場所, 設定した人, 設定した日時) だけ。氏名は送らない。
 *     日時（at）を持たない古い設定は送らない（その方の設定を次に保存し直した時から送る）。
 *     手入力の設定（apc2_start/no/prev/setby）と移し済みの印（apc2_res_moved）は入居者IDを持たないので送らない。
 *   ・送る時機は画面が決める: 設定を保存した後（pushOne）と、画面を開いた後（pushAll・控えの全員分を1回）。
 *   ・ログインの控えが無い・ログインが確かめられない端末は、帯を出さず黙って送らない（入力は端末に残る）。
 *   ・送れなかった分は送信待ち（apc2_sync_q・入居者IDと日時だけ）に残し、次の起動・次の保存で送り直す。
 *     外すのはサーバーの応答（ok: 書いた・作った・同じ・サーバーの方が新しい）を受け取った時だけ（多端末同期の規約6）。
 *     形の断り（bad*・futureat）は待っても直らないので送信待ちから外し、記録（apc2_sync_ng）だけ残す。
 *     同じ日時の設定は送り直さない（無限に送らない）。設定を直して日時が変われば、また送る。
 *   ・ok を受け取った設定は（入居者ID → 日時）を送信済みの控え（apc2_sync_sent・氏名なし）に残し、開いた後の送信（pushAll）では
 *     日時が同じ方を送らない（載ったのを確かめたら止める・多端末同期の規約6）。保存の後の送信（pushOne）は今までどおり送る。
 *     控えが無い・読めない・壊れている時は全員分を送る（安全側）。
 *   ・この部品は読み込んだだけでは何もしない（写しの見比べの画面も読むが、そこからは送らない）。
 *   ・現場の端末（su_device_role が field）では、開いた後の全員分の送信（pushAll）をせず、送信待ちに残っている方だけを送る
 *     （2026-10-22 代表者の決定「保存した方だけ送る」・CLAUDE.md §2-5 現場の端末は全件を扱わない）。保存の後の送信（pushOne）は送る。
 *     用途は送る時に読み直す（途中で現場へ変わっても、次の送信から効く）。
 *   ・権限で断られた時（データベースの 42501）は、送信待ちに残したまま記録（apc2_sync_ng・denied・日時つき）を付ける。
 *     保存のたびの送り直しはしない（同じ日時の denied は pushOne では送らない）。画面を開いた時（pushAll・現場の端末も事務所PCも）は
 *     送信待ちの denied を1回ずつ送り直す（許可が戻った後・ログインし直した後に載るように・回数は開いた回数まで）。
 *     ログインが切れた呼び出しも 42501 になりうるが、送信待ちから外さないので消えない。載ったら denied の記録を外す（2026-10-22・反証レビュー）。
 */
(function () {
  'use strict';
  var FLAGS_URL = 'su-backend.json', FLAGS_LS = 'su_backend_flags', SWITCH = 'patch_push';
  var RES_LS = 'apc2_res', QUEUE_LS = 'apc2_sync_q', NG_LS = 'apc2_sync_ng', SENT_LS = 'apc2_sync_sent';
  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var REFUSALS = { badid: 1, badstart: 1, badno: 1, badprev: 1, badby: 1, badat: 1, futureat: 1 };
  var NG_MAX = 50;
  var DENIED = '42501';   // データベースの「権限が無い」（patch_put の役の確かめ・RLS）
  var AUTH_TTL_MS = 5 * 60 * 1000;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsJson(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) { /* 控えを残せなくても次の起動で全員分を送る */ } }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isField() { return lsGet('su_device_role') === 'field'; }
  function atMs(at) { var t = typeof at === 'string' && at ? Date.parse(at) : NaN; return isFinite(t) ? t : NaN; }

  // ── スイッチ（su-kv.js と同じ読み方: 起動後に読み、1分以内なら読み直さない・3秒で見切って最後に読めた値）──
  var flags = lsJson(FLAGS_LS), flagsTriedAt = 0, flagsPromise = null;
  function fetchFlags() {
    if (flagsPromise) return flagsPromise;
    flagsTriedAt = Date.now();
    flagsPromise = fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && isObj(j.supabase)) { flags = { supabase: j.supabase }; lsSet(FLAGS_LS, flags); }
      })
      .catch(function () { /* 読めない時は最後に読めた値のまま */ })
      .then(function () { flagsPromise = null; });
    return flagsPromise;
  }
  function ensureFlags() {
    if (flagsTriedAt && Date.now() - flagsTriedAt < 60000 && !flagsPromise) return Promise.resolve();
    return Promise.race([fetchFlags(), new Promise(function (ok) { setTimeout(ok, 3000); })]);
  }
  function pushOn() { return !!(flags && isObj(flags.supabase) && flags.supabase[SWITCH] === true); }

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
      return loadScript('su-auth.js?v=2026-10-20');
    });
  }
  var authOkAt = 0;
  /* 送ってよいか（ログインの控えがあり、使える状態か）。だめな時は false＝黙って送らない（帯は出さない） */
  function authReady() {
    if (!hasSession()) return Promise.resolve(false);
    if (authOkAt && Date.now() - authOkAt < AUTH_TTL_MS && window.SUAuth) return Promise.resolve(true);
    return ensureAuth().then(function () { return window.SUAuth.check(); }).then(function (st) {
      var ok = !!(st && st.status === window.SUAuth.STATUS.OK);
      authOkAt = ok ? Date.now() : 0;
      return ok;
    }).catch(function () { return false; });
  }

  // ── 端末の控え（読むだけ）──
  /* apc2_res の入居者ごとの欄を返す（壊れていれば {}）。手入力の設定・移し済みの印は読まない */
  function readLocal() {
    var o = lsJson(RES_LS);
    var r = o && isObj(o.r) ? o.r : {}, out = {};
    Object.keys(r).forEach(function (k) { if (isObj(r[k])) out[k] = r[k]; });
    return out;
  }
  /* 1人分の送る中身（6つだけ）。日時の無い設定は null＝送らない */
  function payloadOf(rid, v) {
    if (!isObj(v) || !isFinite(atMs(v.at))) return null;
    var no = Number(v.no), prev = (v.prev == null || v.prev === '') ? 0 : Number(v.prev);
    return {
      p_resident_id: String(rid),
      p_start: typeof v.start === 'string' ? v.start : String(v.start == null ? '' : v.start),
      p_no: isFinite(no) ? no : null,
      p_prev: isFinite(prev) ? prev : null,
      p_by: typeof v.by === 'string' ? v.by.trim().slice(0, 60) : '',
      p_at: v.at
    };
  }

  // ── 送信待ち・断りの記録（入居者IDと日時だけ）──
  function queue() { var o = lsJson(QUEUE_LS); return o && isObj(o.q) ? o.q : {}; }
  function queueSave(q) { if (Object.keys(q).length) lsSet(QUEUE_LS, { v: 1, q: q }); else { try { localStorage.removeItem(QUEUE_LS); } catch (e) { /* 次に上書き */ } } }
  function queueAdd(rid, at) {
    var q = queue();
    if (!(rid in q) || !(atMs(q[rid]) >= atMs(at))) { q[rid] = at; queueSave(q); }
  }
  // 送った日時より後に保存し直された分は外さない（まだ届いていない）
  function queueDone(rid, at) {
    var q = queue();
    if (!(rid in q)) return;
    if (!isFinite(atMs(q[rid])) || atMs(q[rid]) <= atMs(at)) { delete q[rid]; queueSave(q); }
  }
  // 控えから消えた・日時の無い設定は送らない約束なので、送信待ちからも外す
  function queueDrop(rid) { var q = queue(); if (rid in q) { delete q[rid]; queueSave(q); } }
  function refused() { var o = lsJson(NG_LS); return o && isObj(o.r) ? o.r : {}; }
  function refusedAdd(rid, err, at) {
    var r = refused();
    r[rid] = { e: String(err), at: at, t: new Date().toISOString() };
    var ks = Object.keys(r);
    if (ks.length > NG_MAX) ks.sort(function (a, b) { return String(r[a].t) < String(r[b].t) ? -1 : 1; }).slice(0, ks.length - NG_MAX).forEach(function (k) { delete r[k]; });
    lsSet(NG_LS, { v: 1, r: r });
  }
  function refusedSame(rid, at) { var r = refused()[rid]; return !!(r && r.at === at); }
  function deniedSame(rid, at) { var r = refused()[rid]; return !!(r && r.at === at && r.e === 'denied'); }
  function refusedDrop(rid) { var r = refused(); if (rid in r) { delete r[rid]; lsSet(NG_LS, { v: 1, r: r }); } }
  // 送信済みの控え（入居者ID → ok を受け取った日時）。読めない・壊れている時は null＝全員分を送る
  function sentRead() { var o = lsJson(SENT_LS); return o && isObj(o.s) ? o.s : null; }
  function sentAdd(rid, at) {
    var s = sentRead() || {}, local = readLocal();
    s[rid] = at;
    Object.keys(s).forEach(function (k) { if (!(k in local)) delete s[k]; });   // 控えから消えた方は持たない（膨らませない）
    lsSet(SENT_LS, { v: 1, s: s });
  }

  // ── 送る ──
  function sendOne(sb, rid, retryDenied) {
    var p = payloadOf(rid, readLocal()[rid]);   // 送る直前に控えを読み直す（待っている間に保存し直された値を送る）
    if (!p) { queueDrop(rid); return Promise.resolve('skip'); }
    if (deniedSame(rid, p.p_at)) { if (!retryDenied) return Promise.resolve('denied'); }   // 送信待ちには残す
    else if (refusedSame(rid, p.p_at)) { queueDone(rid, p.p_at); return Promise.resolve('refused'); }
    return Promise.resolve().then(function () { return sb.rpc('patch_put', p); }).then(function (r) {
      var d = r && !r.error ? r.data : null;
      if (d && d.ok === true) { queueDone(rid, p.p_at); sentAdd(rid, p.p_at); if (deniedSame(rid, p.p_at)) refusedDrop(rid); return 'done'; }   // 書いた・作った・同じ・サーバーの方が新しい
      if (d && d.ok === false && REFUSALS[d.error]) { queueDone(rid, p.p_at); refusedAdd(rid, d.error, p.p_at); return 'refused'; }
      if (r && r.error && String(r.error.code || '') === DENIED) { queueAdd(rid, p.p_at); refusedAdd(rid, 'denied', p.p_at); return 'denied'; }
      queueAdd(rid, p.p_at); return 'fail';
    }, function () { queueAdd(rid, p.p_at); return 'fail'; });
  }
  var chain = Promise.resolve();
  /* rids を順に送る。スイッチが切なら何もしない（送信待ちにも残さない＝スイッチを入れた後の起動で全員分を送る） */
  function run(rids, retryDenied) {
    var job = chain.then(function () {
      return ensureFlags().then(function () {
        if (!pushOn() || !rids.length) return { sent: 0, skipped: 'off' };
        var local = readLocal();
        rids = rids.filter(function (k) {
          var p = payloadOf(k, local[k]);
          if (!p) { queueDrop(k); return false; }                                  // 日時の無い古い設定は送らない
          if (deniedSame(k, p.p_at)) return !!retryDenied;                         // 権限の断りは開いた時だけ送り直す（送信待ちには残す）
          if (refusedSame(k, p.p_at)) { queueDone(k, p.p_at); return false; }      // 同じ日時で形を断られた設定は送り直さない
          return true;
        });
        if (!rids.length) return { sent: 0 };
        return authReady().then(function (ok) {
          if (!ok) { rids.forEach(function (k) { queueAdd(k, local[k].at); }); return { sent: 0, skipped: 'login' }; }
          var sb = window.SUAuth.client(), res = {};
          return rids.reduce(function (p, k) {
            return p.then(function () { return sendOne(sb, k, retryDenied).then(function (x) { res[k] = x; }); });
          }, Promise.resolve()).then(function () { return { sent: rids.length, result: res }; });
        });
      });
    }).catch(function () { return { sent: 0, skipped: 'error' }; });
    chain = job;
    return job;
  }
  /** 設定を保存した後: その方と、送信待ちに残っている方を送る */
  function pushOne(rid) {
    var ks = Object.keys(queue());
    if (rid && ks.indexOf(String(rid)) < 0) ks.unshift(String(rid));
    return run(ks);
  }
  /** 画面を開いた後: 端末の控えの全員分を1回送る（読むだけ・控えも表示も書き換えない）。
   *  送信済みの控えと日時が同じ方は送らない（送信待ちに残っている方は下で足すので送る）。控えが壊れていれば全員分 */
  function pushAll() {
    var local = readLocal(), sent = sentRead(), qd = queue();
    if (isField()) return run(Object.keys(qd), true);   // 現場の端末は送信待ちの方だけ（全員分は送らない）
    var ks = Object.keys(local).filter(function (k) {
      return !(sent && typeof local[k].at === 'string' && sent[k] === local[k].at);
    });
    Object.keys(qd).forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); });
    return run(ks, true);
  }

  // ── 写しの見比べの画面用（読むだけ）──
  function sameValue(v, s) {
    var p = payloadOf('x', v);
    return !!p && isObj(s) && p.p_start === String(s.start) && p.p_no === Number(s.no) && p.p_prev === Number(s.prev);
  }
  /** 端末の控えとサーバーの行を比べる。返すのは入居者IDの一覧だけ（氏名は持たない）。
   *  日時の無い古い設定は送らない約束なので、差には数えず noAt に分ける。
   *  中身が違う方は日時で分ける: 端末の方が新しい＝differLocal（未送信）／サーバーの方が新しい・同じ日時＝differServer
   *  （patch_put は同じ日時を stale で受け付けないので、送っても変わらない＝ほかの端末の設定。段階3で取り込む）。differ は両方。
   *  今の日時のまま形で断られた方（断りの記録と日時が同じ）は差に数えず refused（{id, error}）にだけ出す（二重に数えない） */
  function diff(local, rows) {
    local = isObj(local) ? local : {}; rows = isObj(rows) ? rows : {};
    var ngs = refused();
    var out = { onlyLocal: [], onlyServer: [], differ: [], differLocal: [], differServer: [], same: [], noAt: [], refused: [] };
    Object.keys(local).sort().forEach(function (k) {
      var p = payloadOf(k, local[k]);
      if (!p) { out.noAt.push(k); return; }
      var has = Object.prototype.hasOwnProperty.call(rows, k);
      if (has && sameValue(local[k], rows[k])) { out.same.push(k); return; }
      if (isObj(ngs[k]) && ngs[k].at === p.p_at) { out.refused.push({ id: k, error: String(ngs[k].e || '') }); return; }
      if (!has) { out.onlyLocal.push(k); return; }
      out.differ.push(k);
      var sAt = atMs(isObj(rows[k]) ? rows[k].at : null);
      // サーバーの日時が読めない時は「未送信」側に出す（差を隠さない）
      if (!isFinite(sAt) || atMs(p.p_at) > sAt) out.differLocal.push(k); else out.differServer.push(k);
    });
    Object.keys(rows).sort().forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(local, k)) out.onlyServer.push(k); });
    return out;
  }

  window.SUPatchSync = {
    pushOne: pushOne, pushAll: pushAll, readLocal: readLocal, diff: diff, switchOn: pushOn,
    pending: function () { return Object.keys(queue()).sort(); },
    refused: function () { var r = refused(); return Object.keys(r).sort().map(function (k) { return { id: k, error: String(r[k].e || '') }; }); }
  };
})();
