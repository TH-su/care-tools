/* su-adm-full.js — 入居調整の台帳の写し（統合 0040・2026-10-29 代表者の「その他できるだけ進めていきたい」・計画書と同じ作り方）
 *
 * 正本は今までどおり入居調整の GAS（Drive の JSON admission_flow_v1）。この部品は「写し」を取って見比べるだけで、GAS へは読む操作（get）だけを送る。
 *   1. GAS から台帳を1回読む（中身が無い時は写さない）
 *   2. Supabase へ写す（adm_import・1回で送る）
 *   3. 写しを読み直して（adm_get・画面の名前つき）、版・中身・更新の時刻を見比べる
 * 出すのは件数と違いの種類だけ（氏名・中身は出さない）。読んだ中身は端末に残さない（localStorage・sessionStorage を使わない）。
 * 添付書類（PDF・目録）は写さない（Drive のまま）。
 * 自動（auto）: 管理者（2段階認証）が事務所PCで入居調整を開いた時、その日（日本時間）まだ写していなければ写す。
 *   前の試みから1時間は試さない。管理者でない・データベースに 0040 が無い時は何もしない。例外は外へ出さない。
 */
(function (root) {
  'use strict';
  var KEY = 'admission_flow_v1';
  var MAX_BYTES = 1024 * 1024;
  var AUTO_GAP_MS = 60 * 60 * 1000;

  function bytes(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return String(s).length * 3; } }
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  /* 生きている案件（deleted が真でないもの）の件数。GAS の admCountActive_ と同じ数え方 */
  function countActive(d) {
    var list = d && typeof d === 'object' ? d.candidates : null;
    if (!Array.isArray(list)) return 0;
    return list.filter(function (c) { return c && typeof c === 'object' && !c.deleted; }).length;
  }
  function compare(src, copy) {
    var why = [];
    if (!copy || copy.data == null) return ['写しにありません'];
    if (Number(copy.rev) !== Number(src.rev)) why.push('版');
    if (canon(copy.data) !== canon(src.data)) why.push('中身');
    if (String(copy.updatedAt || '') !== String(src.updatedAt || '').slice(0, 40)) why.push('更新の時刻');
    return why;
  }
  function dbWhy(e) {
    var c = String(e && (e.code || e.error || e.message) || e || '');
    if (c === '42501' || /not allowed/.test(c)) return '管理者（二段階認証済み）のアカウントで開いてください。';
    if (/PGRST202|42883|PGRST205|42P01/.test(c)) return 'データベースの準備（0040）がまだです。';
    if (c === 'stale') return '写しの方が新しい版でした（Google の台帳が古い版に戻っている可能性）。写しは変えていません。開発の担当へ知らせてください。';
    if (c === 'shrink') return '生きている案件が前回の写しの半分より少なかったので、写しを止めました。Google の台帳を確かめてください。';
    if (c === 'nodata') return '台帳の形が違いました。';
    if (c === 'toolarge') return '台帳が大きすぎました。';
    if (c === 'badrow') return '画面の名前の形が違いました。';
    return 'データベースが受け付けませんでした（' + c + '）。';
  }

  /* io = { gas(body) → Promise<GAS の応答>, rpc(name, args) → Promise<{data, error}>, screen?, progress?(text) } */
  async function run(io) {
    var say = io.progress || function () {};
    function fail(why) { return { ok: false, why: why }; }
    try {
      say('Google から台帳を読んでいます…');
      var j = await io.gas({ action: 'get', key: KEY });
      if (!j || j.ok !== true) return fail('Google が台帳を返しませんでした（この端末の入居調整の接続先を確かめてください）。');
      if (!j.data || typeof j.data !== 'object' || Array.isArray(j.data)) return fail('Google にまだ台帳がありません。写しは始めていません。');
      var src = { rev: Number(j.rev) || 0, data: j.data, updatedAt: String(j.updatedAt || '') };
      if (bytes(JSON.stringify(src.data)) > MAX_BYTES) return fail('台帳が大きすぎます。写しは始めていません。');
      say('Supabase へ写しています…');
      var r = await io.rpc('adm_import', { p_rev: src.rev, p_data: src.data, p_updated: src.updatedAt });
      if (!r || r.error) return fail(dbWhy(r && r.error));
      if (!r.data || r.data.ok !== true) return fail(dbWhy(r.data && r.data.error));
      say('写しを読み直して見比べています…');
      var g = await io.rpc('adm_get', { p_screen: io.screen || 'shadow-check' });
      if (!g || g.error || !g.data || g.data.ok !== true) return fail('写しは終わりましたが、読み直せませんでした: ' + dbWhy(g && (g.error || g.data && g.data.error)));
      return { ok: true, result: r.data.result, rev: src.rev, active: countActive(src.data), diff: compare(src, g.data) };
    } catch (e) {
      return fail(String(e && e.message || e) + '。写しは止めました。');
    }
  }

  function jstDay(t) { return new Date(new Date(t).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function loadAuth() {
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    var p = root.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return root.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return root.SUAuth || null; });
  }
  /* io = { gas, auth?(), now? }。返す: { skip:'理由' } か run の結果 */
  async function auto(io) {
    try {
      var A = await (io.auth ? io.auth() : loadAuth());
      if (!A) return { skip: 'noauth' };
      var st = await A.check();
      if (!st || st.status !== A.STATUS.OK || st.role !== 'admin') return { skip: 'role' };
      var sb = A.client();
      var q = await sb.from('adm_sync_runs').select('at,status').order('at', { ascending: false }).limit(10);
      if (q.error) return { skip: 'nodb' };
      var now = io.now || Date.now(), rows = Array.isArray(q.data) ? q.data : [];
      if (rows.some(function (r) { return r.status === 'done' && jstDay(r.at) === jstDay(now); })) return { skip: 'today' };
      if (rows.length && now - new Date(rows[0].at).getTime() < AUTO_GAP_MS) return { skip: 'recent' };
      return await run({ gas: io.gas, screen: 'admission-flow', rpc: function (name, args) { return sb.rpc(name, args); }, progress: function () {} });
    } catch (e) { return { skip: 'error' }; }
  }
  /* 自動で写した結果を、職員向けの1文にする。知らせなくてよい時（一致・試さなかった）は '' */
  function autoNote(res) {
    if (!res || res.skip) return '';
    if (!res.ok) return '入居調整の台帳の写し（自動）が取れませんでした: ' + res.why + '　写しの見比べの画面で確かめてください。';
    if (res.diff.length) return '入居調整の台帳の写し（自動）で、Google と違う所がありました（' + res.diff.join('・') + '）。写しの見比べの画面で「入居調整の台帳を写す」を押して確かめてください。';
    return '';
  }

  root.SUAdmFull = { run: run, auto: auto, autoNote: autoNote, _compare: compare, _countActive: countActive, _dbWhy: dbWhy, _jstDay: jstDay };
})(typeof window !== 'undefined' ? window : this);
