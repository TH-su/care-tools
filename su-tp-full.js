/* su-tp-full.js — 個別機能訓練計画書の写し（統合 0037・2026-10-29 代表者の決定「入居者マスタと同じ作り方で進める」）
 *
 * 正本は今までどおり個別機能訓練計画書の GAS（Drive の JSON）。この部品は「写し」を取って見比べるだけで、GAS へは読む操作（get）だけを送る。
 *   1. 写すキーを決める: GAS の索引（training_plan:index）の行と、入居者マスタの名簿の全員の利用者No の和（索引に無い計画書も拾う）
 *   2. GAS から1件ずつ読む（同時に3本まで）。中身の無いキーは写さない。1件でも読めなければ写し始めない
 *   3. Supabase へ50件ずつ写す（tp_import_begin → tp_import_chunk → tp_import_finish）
 *   4. 写しを読み直して（tp_get・画面の名前つき）、版と中身を1件ずつ見比べる
 * 出すのは件数・キーの番号・違いの種類だけ（氏名・中身は出さない）。読んだ中身は端末に残さない（localStorage・sessionStorage を使わない）。
 * 自動（auto）: 管理者（2段階認証）が事務所PCで個別機能訓練計画書を開いた時、その日（日本時間）まだ写していなければ写す。
 *   前の試みから1時間は試さない。管理者でない・データベースに 0037 が無い時は何もしない。例外は外へ出さない。
 */
(function (root) {
  'use strict';
  var KEY_RE = /^training_plan:(index|[0-9A-Za-z_-]{1,32})$/;
  var IDX_KEY = 'training_plan:index';
  var ROW_MAX = 50, CHUNK_BYTES = 3 * 1024 * 1024, ROW_BYTES = 590 * 1024, GET_MAX = 300, POOL = 3;
  var AUTO_GAP_MS = 60 * 60 * 1000;
  var RETRY_WAIT = [1000, 3000];    // Google へ読みに行って届かなかった・時間切れの時に待ってから読み直す間（ミリ秒・2回まで）

  function bytes(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return String(s).length * 3; } }
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  /* 写すキー: 索引のキー＋索引の行の利用者No＋名簿の利用者No（形の合わない番号は外して数える） */
  function keysOf(idxData, rosterIds) {
    var seen = {}, keys = [IDX_KEY], bad = 0;
    seen[IDX_KEY] = true;
    var rows = idxData && typeof idxData === 'object' && idxData.rows && typeof idxData.rows === 'object' && !Array.isArray(idxData.rows) ? Object.keys(idxData.rows) : [];
    rows.concat(Array.isArray(rosterIds) ? rosterIds : []).forEach(function (id) {
      var k = 'training_plan:' + String(id == null ? '' : id).trim();
      if (!KEY_RE.test(k) || k === IDX_KEY) { bad++; return; }
      if (!seen[k]) { seen[k] = true; keys.push(k); }
    });
    return { keys: keys, bad: bad };
  }
  function chunk(items) {
    var out = [], cur = [], size = 0, big = [];
    items.forEach(function (it) {
      var b = bytes(JSON.stringify(it));
      if (b > ROW_BYTES) { big.push(it.key); return; }
      if (cur.length && (cur.length >= ROW_MAX || size + b > CHUNK_BYTES)) { out.push(cur); cur = []; size = 0; }
      cur.push(it); size += b;
    });
    if (cur.length) out.push(cur);
    return { chunks: out, big: big };
  }
  function compare(src, copyRows) {
    var byKey = {};
    (Array.isArray(copyRows) ? copyRows : []).forEach(function (r) { if (r && r.key) byKey[r.key] = r; });
    var same = 0, diff = [], notInCopy = [];
    src.forEach(function (it) {
      var c = byKey[it.key];
      if (!c) { notInCopy.push(it.key); return; }
      var why = [];
      if (Number(c.rev) !== Number(it.rev)) why.push('版');
      if (canon(c.data) !== canon(it.data)) why.push('中身');
      if (String(c.updatedAt || '') !== String(it.updatedAt || '')) why.push('更新の時刻');
      if (why.length) diff.push({ key: it.key, why: why }); else same++;
    });
    return { same: same, diff: diff, notInCopy: notInCopy };
  }
  function dbWhy(e) {
    var c = String(e && (e.code || e.error || e.message) || e || '');
    if (c === '42501' || /not allowed/.test(c)) return '管理者（二段階認証済み）のアカウントで開いてください。';
    if (/PGRST202|42883|PGRST205|42P01/.test(c)) return 'データベースの準備（0037）がまだです。';
    if (c === 'incomplete') return '全部を写しきれませんでした。もう一度押してください。';
    if (c === 'shrink') return '写す件数が前回の半分より少なかったので、写しを止めました（読み込みの途中切れの可能性）。もう一度押してください。';
    if (c === 'norun') return '別の端末で写しが始まったため、この写しは止めました。';
    if (c === 'badrow') return '形の合わない計画書がありました。';
    if (c === 'toolarge') return '大きすぎる計画書がありました。';
    if (c === 'stale') return '15分以内の写しがありません。もう一度押してください。';
    if (c === 'notfrozen') return 'Google の保存を止めた後の写しではありません。もう一度押してください。';
    if (c === 'noop') return '切り替えの操作が時間切れになりました。もう一度押してください。';
    if (c === 'live') return 'もう切り替わっています。';
    if (c === 'mirror') return 'Google への写し返しが済んでいません。先に「写しの期間に戻す」を最後まで済ませてください。';
    if (c === 'busy') return '別の画面で「切り替える」か「写しの期間に戻す」が動いています。終わるのを待ってから押してください（30分たつと押せます）。';
    if (c === 'pending') return 'Google への写し返しが残っています。もう一度押してください。';
    return 'データベースが受け付けませんでした（' + c + '）。';
  }
  function pool(items, n, fn) {
    return new Promise(function (resolve, reject) {
      var i = 0, running = 0, done = 0, failed = false, out = new Array(items.length);
      if (!items.length) { resolve(out); return; }
      function next() {
        while (!failed && running < n && i < items.length) {
          (function (k) {
            running++;
            Promise.resolve().then(function () { return fn(items[k], k); }).then(function (v) {
              out[k] = v; running--; done++;
              if (done === items.length) resolve(out); else next();
            }, function (e) { if (!failed) { failed = true; reject(e); } });
          })(i++);
        }
      }
      next();
    });
  }

  /* Google へ読む操作（索引・名簿・計画書の get）だけ、届かなかった・時間切れの時に少し待って2回まで読み直す
   * （1回の通信の途切れで写し・切り替えの全体を止めない・入居者マスタの su-res-full.js と同じ・2026-10-30 入居者マスタの切り替えで判明）。
   * Google が答えた断りは読み直さない。止める・外す（gasAdmin）はここを通さない */
  function isTransient(e) {
    var m = String(e && e.message || '');
    return m === 'Google に届きませんでした' || m === 'Google の応答がありません（時間切れ）';
  }
  async function gasRead(io, fn) {
    var waits = Array.isArray(io.retryWait) ? io.retryWait : RETRY_WAIT;
    for (var k = 0; ; k++) {
      try { return await fn(); }
      catch (e) {
        if (!isTransient(e) || k >= waits.length) throw e;
        await new Promise(function (ok) { setTimeout(ok, waits[k]); });
      }
    }
  }

  /* io = { gas(body) → Promise<GAS の応答>, rosterIds() → Promise<[利用者No]>, rpc(name, args) → Promise<{data, error}>, progress?(text) } */
  async function run(io) {
    var say = io.progress || function () {};
    var runId = null;
    function fail(why) { return { ok: false, why: why }; }
    async function stop(why) {
      if (runId != null) { try { await io.rpc('tp_import_abort', { p_run: runId }); } catch (e) { /* 次に始めると取り消される */ } }
      return fail(why + (runId != null ? '途中まで写した計画書があります（消えた印は付けていません。次に写すと最初から写し直します）。' : ''));
    }
    async function rpc(name, args) {
      var r = await io.rpc(name, args || {});
      if (r && r.error) throw { db: r.error };
      return r ? r.data : null;
    }
    try {
      say('Google から索引を読んでいます…');
      var ij = await gasRead(io, function () { return io.gas({ action: 'get', key: IDX_KEY }); });
      if (!ij || ij.ok !== true) return fail('Google が索引を返しませんでした（この端末の計画書の接続先を確かめてください）。');
      var ids = [];
      try { ids = await gasRead(io, function () { return io.rosterIds(); }); } catch (e) { return fail('入居者マスタの名簿を読めませんでした。写しは始めていません。'); }
      var kk = keysOf(ij.data, ids);
      var items = [], n = 0;
      await pool(kk.keys, POOL, async function (key) {
        var j = key === IDX_KEY ? ij : await gasRead(io, function () { return io.gas({ action: 'get', key: key }); });
        if (!j || j.ok !== true) throw new Error('Google が計画書を返しませんでした');
        if (j.data && typeof j.data === 'object') items.push({ key: key, rev: Number(j.rev) || 0, data: j.data, updatedAt: String(j.updatedAt || '') });
        n++;
        say('Google から読んでいます… ' + n + ' / ' + kk.keys.length + '件');
      });
      items.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
      var ck = chunk(items);
      if (ck.big.length) return fail('大きすぎる計画書があります（' + ck.big.join('・') + '）。写しは始めていません。');
      say('Supabase へ写しています…');
      var b = await rpc('tp_import_begin');
      if (!b || !b.ok) return fail(dbWhy(b && b.error));
      runId = b.run;
      if (io.frozen) {   // 切り替えの時は「Google の保存を止めた後の写し」の印を付ける（tp_set_mode が確かめる）
        var fz = await rpc('tp_import_mark_frozen', { p_run: runId });
        if (!fz || !fz.ok) return stop('止めた後の写しの印を付けられませんでした。');
      }
      var tot = { inserted: 0, updated: 0, unchanged: 0 };
      for (var i = 0; i < ck.chunks.length; i++) {
        var r = await rpc('tp_import_chunk', { p_run: runId, p_rows: ck.chunks[i] });
        if (!r || !r.ok) return stop(dbWhy(r && r.error));
        tot.inserted += r.inserted || 0; tot.updated += r.updated || 0; tot.unchanged += r.unchanged || 0;
        say('Supabase へ写しています… ' + (i + 1) + ' / ' + ck.chunks.length);
      }
      var f = await rpc('tp_import_finish', { p_run: runId, p_keys: items.map(function (x) { return x.key; }) });
      if (!f || !f.ok) return stop(dbWhy(f && f.error));
      runId = null;
      say('写しを読み直して見比べています…');
      var copy = [];
      for (var j2 = 0; j2 < items.length; j2 += GET_MAX) {
        var g;
        try { g = await rpc('tp_get', { p_keys: items.slice(j2, j2 + GET_MAX).map(function (x) { return x.key; }), p_screen: io.screen || 'shadow-check' }); }
        catch (e) { g = { ok: false, error: e && e.db }; }
        if (!g || !g.ok) return fail('写しは終わりましたが、読み直せませんでした: ' + dbWhy(g && g.error));
        copy = copy.concat(g.rows || []);
      }
      return { ok: true, docs: items.length, keys: kk.keys.length, badIds: kk.bad,
               run: { inserted: tot.inserted, updated: tot.updated, unchanged: tot.unchanged, missing: f.missing || 0 }, cmp: compare(items, copy) };
    } catch (e) {
      if (e && e.db) return stop(dbWhy(e.db));
      return stop(String(e && e.message || e) + '。写しは止めました。');
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
  /* io = { gas, rosterIds, auth?(), now? }。返す: { skip:'理由' } か run の結果 */
  async function auto(io) {
    try {
      var A = await (io.auth ? io.auth() : loadAuth());
      if (!A) return { skip: 'noauth' };
      var st = await A.check();
      if (!st || st.status !== A.STATUS.OK || st.role !== 'admin') return { skip: 'role' };
      var sb = A.client();
      // 切り替えた後は写さない（写しの始まりが断るので、毎回 Google の全件を読んでから失敗しないように先に確かめる・計画書の反証レビュー 指摘11）
      var md = null;
      try { md = await sb.rpc('tp_mode_get'); } catch (e) { md = null; }
      if (md && md.data && md.data.mode === 'live') return { skip: 'live' };
      var q = await sb.from('tp_sync_runs').select('at,status').order('at', { ascending: false }).limit(10);
      if (q.error) return { skip: 'nodb' };
      var now = io.now || Date.now(), rows = Array.isArray(q.data) ? q.data : [];
      if (rows.some(function (r) { return r.status === 'done' && jstDay(r.at) === jstDay(now); })) return { skip: 'today' };
      if (rows.length && now - new Date(rows[0].at).getTime() < AUTO_GAP_MS) return { skip: 'recent' };
      // 切り替える・戻すの操作が動いている間は写さない（その写しが切り替えの写しを取り消すため）
      var busy = null;
      try { busy = await sb.rpc('tp_op_busy'); } catch (e) { busy = null; }   // 0038 の前（関数が無い）は今までどおり
      if (busy && busy.data === true) return { skip: 'op' };
      return await run({ gas: io.gas, rosterIds: io.rosterIds, screen: 'training-plan', rpc: function (name, args) { return sb.rpc(name, args); }, progress: function () {} });
    } catch (e) { return { skip: 'error' }; }
  }
  /* 自動で写した結果を、職員向けの1文にする。知らせなくてよい時（全件一致・試さなかった）は '' */
  function autoNote(res) {
    if (!res || res.skip) return '';
    if (!res.ok) return '個別機能訓練計画書の写し（自動）が取れませんでした: ' + res.why + '　写しの見比べの画面で確かめてください。';
    var bad = res.cmp.diff.length + res.cmp.notInCopy.length;
    if (bad) return '個別機能訓練計画書の写し（自動）で、Google と違う計画書が ' + bad + '件ありました。写しの見比べの画面で「計画書を全部写す」を押して確かめてください。';
    return '';
  }

  /* ── 切り替える・戻す（統合 0038・入居者マスタの su-res-full.js と同じ手順）──
   * io = run と同じ（gas・rosterIds・rpc・progress）＋ token()（ログインの証明を返す）
   * 切り替える: 札 → 計画書の GAS の保存を止める → 止めた後の写し（全件一致の時だけ）→ 切り替える → 札を返す。途中で止まったら GAS の保存を戻す
   * 戻す: 札 → 写しの期間に戻す → Google へ最後まで写し返して止める印を外す → 札を返す */
  async function gasAdmin(io, body) {
    var at = await io.token();
    if (!at) throw new Error('ログインしてからもう一度押してください');
    var j = await io.gas(Object.assign({}, body, { accessToken: at }));
    if (!j || j.ok !== true) throw new Error(String(j && j.error || 'Google が受け付けませんでした').replace(/^Error: (refused: )?/, ''));
    return j;
  }
  async function opBegin(io, op) {
    var r = await io.rpc('tp_op_begin', { p_op: op });
    if (!r || r.error || !r.data || r.data.ok !== true) throw new Error(dbWhy(r && (r.error || r.data && r.data.error)));
    return r.data.token;
  }
  async function opEnd(io, tok) { try { await io.rpc('tp_op_end', { p_token: tok }); } catch (e) { /* 30分で失効する */ } }
  async function cutover(io) {
    var say = io.progress || function () {};
    var frozen = false, tok = null;
    async function undo(why) {
      if (frozen) { try { await gasAdmin(io, { action: 'tpCutover', on: false, opToken: tok }); } catch (e) { why += '（Google の保存を止めたままの可能性があります。もう一度「切り替える」か「写しの期間に戻す」を押してください）'; } }
      return { ok: false, why: why };
    }
    try {
      try { tok = await opBegin(io, 'cutover'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      say('計画書の Google への直接の保存を止めています…');
      frozen = true;
      await gasAdmin(io, { action: 'tpCutover', on: true, opToken: tok });
      var r = await run(Object.assign({}, io, { frozen: true }));
      if (!r.ok) return await undo(r.why);
      var bad = r.cmp.diff.length + r.cmp.notInCopy.length;
      if (bad) return await undo('写しが Google と違う計画書が ' + bad + '件あったので、切り替えを止めました。');
      say('切り替えています…');
      var m = await io.rpc('tp_set_mode', { p_mode: 'live' });
      if (!m || m.error || !m.data || m.data.ok !== true) {
        var g = null;
        try { g = await io.rpc('tp_mode_get', {}); } catch (e) { g = null; }
        if (!(g && g.data && g.data.mode === 'live')) return await undo(dbWhy(m && (m.error || m.data && m.data.error)));
      }
      return { ok: true, docs: r.docs };
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
      var m = await io.rpc('tp_set_mode', { p_mode: 'shadow' });
      if (!m || m.error || !m.data || m.data.ok !== true) return { ok: false, why: dbWhy(m && (m.error || m.data && m.data.error)) };
      say('Google へ写し返しています…');
      var last = null;
      for (var i = 0; i < 5; i++) {
        try { last = await gasAdmin(io, { action: 'tpCutover', on: false, opToken: tok }); break; }
        catch (e) { last = e; if (!/残っています/.test(String(e && e.message))) break; }
      }
      if (!last || last instanceof Error) return { ok: false, why: '写しの期間には戻しました。Google への写し返しが終わっていません: ' + String(last && last.message || '') + '　もう一度「写しの期間に戻す」を押してください。' };
      return { ok: true, docs: last.docs || 0 };
    } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
    finally { if (tok) await opEnd(io, tok); }
  }

  root.SUTpFull = { run: run, auto: auto, autoNote: autoNote, cutover: cutover, back: back, _keysOf: keysOf, _chunk: chunk, _compare: compare, _dbWhy: dbWhy, _jstDay: jstDay };
})(typeof window !== 'undefined' ? window : this);
