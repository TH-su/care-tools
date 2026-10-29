/* su-adm-full.js — 入居調整の台帳の写し（統合 0040・2026-10-29 代表者の「その他できるだけ進めていきたい」・計画書と同じ作り方）
 *
 * 正本は今までどおり入居調整の GAS（Drive の JSON admission_flow_v1）。この部品は「写し」を取って見比べるだけで、GAS へは読む操作（get）だけを送る。
 *   1. GAS から台帳を1回読む（中身が無い時は写さない）
 *   2. Supabase へ写す（adm_import・1回で送る）
 *   3. 写しを読み直して（adm_get・画面の名前つき）、版・中身・更新の時刻を見比べる
 * 出すのは件数と違いの種類だけ（氏名・中身は出さない）。読んだ中身は端末に残さない（localStorage・sessionStorage を使わない）。
 * 添付書類（PDF・目録）は写さない（Drive のまま）。
 * 自動（auto）: 管理者（2段階認証）が事務所PCで入居調整を開いた時、その日（日本時間）まだ写していなければ写す。
 *   前の試みから1時間は試さない。管理者でない・データベースに 0040 が無い・切り替えた後・切り替える／戻すの操作中は何もしない。例外は外へ出さない。
 * 切り替える・戻す（cutover・back・統合 0042・計画書の su-tp-full.js と同じ手順）:
 *   切り替える: 札 → 入居調整の GAS の台帳の保存を止める → 止めた後の写し（一致の時だけ）→ 止めた後の印 → 切り替える → 札を返す。途中で止まったら GAS の保存を戻す
 *   戻す: 札 → 写しの期間に戻す → Google へ最後まで写し返して止める印を外す → 札を返す
 *   添付書類（Drive）はどちらでも触らない（案A）。
 */
(function (root) {
  'use strict';
  var KEY = 'admission_flow_v1';
  var MAX_BYTES = 2 * 1024 * 1024;   // 0042 の上限（0040 の間は 1MB でデータベースが toolarge で断る）
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
  var BAD_RE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
  function cleanStr(t) {
    return t.replace(/\u0000/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, '\ufffd')
      .replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, function (m, p) { return p + '\ufffd'; });
  }
  function clean(v) {
    if (typeof v === 'string') return BAD_RE.test(v) ? cleanStr(v) : v;
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[clean(k)] = clean(v[k]); }); return o; }
    return v;
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
    if (c === 'live') return 'もう切り替わっています。';
    if (c === 'mirror') return 'Google への写し返しが済んでいません。先に「入居調整を写しの期間に戻す」を最後まで済ませてください。';
    if (c === 'notfrozen') return 'Google の保存を止めた後の写しではありません。もう一度押してください。';
    if (c === 'noop') return '切り替えの操作が時間切れになりました。もう一度押してください。';
    if (c === 'busy') return '別の画面で「切り替える」か「写しの期間に戻す」が動いています。終わるのを待ってから押してください（30分たつと押せます）。';
    if (c === 'pending') return 'Google への写し返しが残っています。もう一度押してください。';
    if (c === 'nodoc') return '台帳の写しがありません。先に「入居調整の台帳を写す」を押してください。';
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
      // データベースに入らない文字（NUL・対の無いサロゲート）は adm-write と同じく消す・置き換えてから写す（入居調整の反証レビュー 指摘3）
      var src = { rev: Number(j.rev) || 0, data: clean(j.data), updatedAt: String(j.updatedAt || '') };
      if (bytes(JSON.stringify(src.data)) > MAX_BYTES) return fail('台帳が大きすぎます。写しは始めていません。');
      say('Supabase へ写しています…');
      var r = await io.rpc('adm_import', { p_rev: src.rev, p_data: src.data, p_updated: src.updatedAt });
      if (!r || r.error) return fail(dbWhy(r && r.error));
      if (!r.data || r.data.ok !== true) return fail(dbWhy(r.data && r.data.error));
      if (io.frozen) {   // 切り替えの時は「Google の保存を止めた後の写し」の印を付ける（adm_set_mode が確かめる）
        var fz = await io.rpc('adm_import_mark_frozen', { p_run: r.data.run });
        if (!fz || fz.error || !fz.data || fz.data.ok !== true) return fail('止めた後の写しの印を付けられませんでした。' + (fz && fz.data && fz.data.error ? dbWhy(fz.data.error) : ''));
      }
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
      // 切り替えた後は写さない（写す口が断るので、毎回 Google を読んでから失敗しないように先に確かめる）
      var md = null;
      try { md = await sb.rpc('adm_mode_get'); } catch (e) { md = null; }
      if (md && md.data && md.data.mode === 'live') return { skip: 'live' };
      var q = await sb.from('adm_sync_runs').select('at,status').order('at', { ascending: false }).limit(10);
      if (q.error) return { skip: 'nodb' };
      var now = io.now || Date.now(), rows = Array.isArray(q.data) ? q.data : [];
      if (rows.some(function (r) { return r.status === 'done' && jstDay(r.at) === jstDay(now); })) return { skip: 'today' };
      if (rows.length && now - new Date(rows[0].at).getTime() < AUTO_GAP_MS) return { skip: 'recent' };
      // 切り替える・戻すの操作が動いている間は写さない（その写しが切り替えの写しより新しくなり、止めた後の印が付かなくなるため）
      var busy = null;
      try { busy = await sb.rpc('adm_op_busy'); } catch (e) { busy = null; }   // 0042 の前（関数が無い）は今までどおり
      if (busy && busy.data === true) return { skip: 'op' };
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

  /* ── 切り替える・戻す ──
   * io = run と同じ（gas・rpc・progress）＋ token()（ログインの証明を返す） */
  async function gasAdmin(io, body) {
    var at = await io.token();
    if (!at) throw new Error('ログインしてからもう一度押してください');
    var j = await io.gas(Object.assign({}, body, { accessToken: at }));
    if (!j || j.ok !== true) throw new Error(String(j && j.error || 'Google が受け付けませんでした').replace(/^Error: (refused: )?/, ''));
    return j;
  }
  async function opBegin(io, op) {
    var r = await io.rpc('adm_op_begin', { p_op: op });
    if (!r || r.error || !r.data || r.data.ok !== true) throw new Error(dbWhy(r && (r.error || r.data && r.data.error)));
    return r.data.token;
  }
  async function opEnd(io, tok) { try { await io.rpc('adm_op_end', { p_token: tok }); } catch (e) { /* 30分で失効する */ } }
  async function cutover(io) {
    var say = io.progress || function () {};
    var frozen = false, tok = null;
    async function undo(why) {
      if (frozen) { try { await gasAdmin(io, { action: 'admCutover', on: false, opToken: tok }); } catch (e) { why += '（Google の保存を止めたままの可能性があります。もう一度「切り替える」か「写しの期間に戻す」を押してください）'; } }
      return { ok: false, why: why };
    }
    try {
      try { tok = await opBegin(io, 'cutover'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      say('入居調整の台帳の Google への直接の保存を止めています…');
      frozen = true;
      await gasAdmin(io, { action: 'admCutover', on: true, opToken: tok });
      var r = await run(Object.assign({}, io, { frozen: true }));
      if (!r.ok) return await undo(r.why);
      if (r.diff.length) return await undo('写しが Google と違った（' + r.diff.join('・') + '）ので、切り替えを止めました。');
      say('切り替えています…');
      var m = await io.rpc('adm_set_mode', { p_mode: 'live' });
      if (!m || m.error || !m.data || m.data.ok !== true) {
        var g = null;
        try { g = await io.rpc('adm_mode_get', {}); } catch (e) { g = null; }
        if (!(g && g.data && g.data.mode === 'live')) return await undo(dbWhy(m && (m.error || m.data && m.data.error)));
      }
      return { ok: true, active: r.active };
    } catch (e) {
      return await undo(String(e && e.message || e));
    } finally {
      if (tok) await opEnd(io, tok);
    }
  }
  async function back(io) {
    var say = io.progress || function () {};
    var tok = null;
    try {
      try { tok = await opBegin(io, 'back'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      say('写しの期間に戻しています…');
      var m = await io.rpc('adm_set_mode', { p_mode: 'shadow' });
      if (!m || m.error || !m.data || m.data.ok !== true) return { ok: false, why: dbWhy(m && (m.error || m.data && m.data.error)) };
      say('Google へ写し返しています…');
      var last = null;
      for (var i = 0; i < 5; i++) {
        try { last = await gasAdmin(io, { action: 'admCutover', on: false, opToken: tok }); break; }
        catch (e) { last = e; if (!/残っています/.test(String(e && e.message))) break; }
      }
      if (!last || last instanceof Error) return { ok: false, why: '写しの期間には戻しました。Google への写し返しが終わっていません: ' + String(last && last.message || '') + '　もう一度「入居調整を写しの期間に戻す」を押してください。' };
      return { ok: true, docs: last.docs || 0 };
    } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
    finally { if (tok) await opEnd(io, tok); }
  }

  root.SUAdmFull = { _clean: clean, run: run, auto: auto, autoNote: autoNote, cutover: cutover, back: back, _compare: compare, _countActive: countActive, _dbWhy: dbWhy, _jstDay: jstDay };
})(typeof window !== 'undefined' ? window : this);
