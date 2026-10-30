/*
 * su-res-full.js — 入居者マスタの全項目の写し（統合 0034・2026-10-29 代表者の決定5）
 * ════════════════════════════════════════════════════════════════
 * 写しの見比べ画面（shadow-check.html）の「入居者マスタを全部写す」だけが使う。ほかの画面は読み込まない。
 *   1. Google（入居者マスタの GAS）から名簿を読み、1人ずつ全項目（getResident）と担当者会議の記録（meeting の list）を読む
 *      （同時に3本まで）。薬の変更候補の判断（medCand の list）も読む
 *   2. Supabase へ数十人ずつ写す（res_import_begin → res_import_chunk → res_import_finish）。
 *      全員分を読めなかった時は写しを終えない（データベースも、渡した方が全員写っていなければ断る）
 *   3. 写した後に Supabase から読み直し（res_get・画面の名前 shadow-check）、Google から読んだ中身と1項目ずつ比べる
 * ★使えるのは管理者（Google＋2段階認証）だけ。最終の判定はデータベース（0034 の関数）。
 * ★Google へ送る形は各画面の入居者マスタの読み方と同じ（POST・text/plain・合言葉は本文）。合言葉は Google へだけ送る。
 * ★読んだ中身はメモリにだけ持ち、端末に保存しない。画面に出すのは人数・件数・利用者No・項目名だけ（値・氏名は出さない）。
 * ★正本は今までどおり Google。この部品は Google へは読むだけで、書かない。
 */
(function (root) {
  'use strict';
  var ROW_MAX = 50;                 // データベースの1塊の上限（res_import_chunk の 50 名）
  var CHUNK_BYTES = 3 * 1024 * 1024; // 1塊の目安（データベースの上限 4MB より小さく）
  var ROW_BYTES = 300 * 1024;       // 1名の上限（データベースは 400KB。データベース側の数え方は小さな項目が多いと2割ほど増えるので小さめに）
  var ITEM_MAX = 200;               // 会議・判断の1塊の件数
  var GET_MAX = 200;                // 読み直しの1回の人数（データベースの上限 500 より小さく）
  var POOL = 3;                     // Google へ同時に読みに行く本数
  var MED_LIST_MAX = 3000;          // Google の薬の変更候補の一覧が返す上限（med-cand.gs の MEDCAND_LIST_MAX）
  var RETRY_WAIT = [1000, 3000];    // Google へ読みに行って届かなかった・時間切れの時に待ってから読み直す間（ミリ秒・2回まで）

  function bytes(s) {
    try { return new TextEncoder().encode(s).length; } catch (e) { return String(s).length * 3; }
  }
  function str(v) { return String(v == null ? '' : v).trim(); }

  /* 名簿から利用者No を取り出す（並びは名簿のまま）。前後に空白がある・41字以上・空・重なりの方がいれば bad に入れて返す
   * （黙って外すと、その方だけ写しから抜けて「消えた印」が付くため。写しは止める） */
  function rosterIds(roster) {
    var seen = {}, out = [], bad = [];
    (Array.isArray(roster) ? roster : []).forEach(function (r, i) {
      var raw = r && typeof r === 'object' && r.id != null ? String(r.id) : '';
      var id = raw.trim();
      if (!id || id !== raw || id.length > 40 || seen[id]) { bad.push(id || '（' + (i + 2) + '行目）'); return; }
      seen[id] = true; out.push(id);
    });
    return { ids: out, bad: bad };
  }
  /* 文字の中の NUL（データベースが受け付けない）を探し、項目名を返す */
  function nulKeys(rec) {
    return Object.keys(rec || {}).filter(function (k) { return JSON.stringify(rec[k] === undefined ? null : rec[k]).indexOf('\\u0000') >= 0; });
  }

  /* 塊に分ける（件数と大きさの両方で区切る）。1件で上限を超える物は big に入れて返す */
  function chunk(items, maxN, maxBytes, oneMax) {
    var out = [], cur = [], size = 2, big = [];
    items.forEach(function (it) {
      var n = bytes(JSON.stringify(it)) + 1;
      if (oneMax && n > oneMax) { big.push(it); return; }
      if (cur.length && (cur.length >= maxN || size + n > maxBytes)) { out.push(cur); cur = []; size = 2; }
      cur.push(it); size += n;
    });
    if (cur.length) out.push(cur);
    return { chunks: out, big: big };
  }

  /* 形をそろえて比べる（キーの並びの違いは同じとみなす） */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  /* Google の記録と写しの記録を1項目ずつ比べ、違う項目の名前だけを返す（値は返さない） */
  function diffKeys(a, b) {
    a = a || {}; b = b || {};
    var keys = {}, out = [];
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) {
      var ha = Object.prototype.hasOwnProperty.call(a, k), hb = Object.prototype.hasOwnProperty.call(b, k);
      if (ha !== hb || canon(a[k]) !== canon(b[k])) out.push(k);
    });
    return out;
  }
  /* 全員分を比べる: { same, diff:[{id, keys}], notInCopy:[id] } */
  function compare(gasById, ids, copyRows) {
    var byId = {};
    (Array.isArray(copyRows) ? copyRows : []).forEach(function (r) { if (r && r.id != null) byId[String(r.id)] = r; });
    var same = 0, diff = [], notInCopy = [];
    ids.forEach(function (id) {
      if (!byId[id]) { notInCopy.push(id); return; }
      var k = diffKeys(gasById[id], byId[id]);
      if (k.length) diff.push({ id: id, keys: k }); else same++;
    });
    return { same: same, diff: diff, notInCopy: notInCopy };
  }

  /* データベースの断りを職員に分かる言葉にする */
  function dbWhy(e) {
    var c = String(e && (e.code || e.error || e.message) || e || '');
    if (c === '42501' || /not allowed/.test(c)) return '管理者（二段階認証済み）のアカウントで開いてください。';
    if (/PGRST202|42883|PGRST205|42P01/.test(c)) return 'データベースの準備（0034）がまだです。';
    if (c === 'incomplete') return '全員分を写しきれませんでした（読み込みの途中で名簿が変わった可能性）。もう一度押してください。';
    if (c === 'shrink') return '写す人数が前回の半分より少なかったので、写しを止めました（読み込みの途中切れの可能性）。もう一度押してください。';
    if (c === 'norun') return '別の端末で写しが始まったため、この写しは止めました。';
    if (c === 'badrow') return '形の合わない記録がありました（利用者No の無い方・同じ方の重なりなど）。';
    if (c === 'toolarge') return '記録が大きすぎる方がいました。';
    if (c === '23505') return '別の写しが同時に始まりました。少し待ってから押し直してください。';
    if (c === 'stale') return '15分以内の写しがありません。もう一度押してください。';
    if (c === 'notfrozen') return 'Google の保存を止めた後の写しではありません。もう一度押してください。';
    if (c === 'notabs') return 'ほかのタブ（担当者会議・薬の判断など）が写しの後にそろっていません。もう一度押してください。';
    if (c === 'live') return 'もう切り替わっています。';
    if (c === 'mirror') return 'Google への写し返しが済んでいません。先に「写しの期間に戻す」を最後まで済ませてください。';
    if (c === 'busy') return '別の画面で「切り替える」か「写しの期間に戻す」が動いています。終わるのを待ってから押してください（30分たつと押せます）。';
    if (c === 'noop') return '切り替えの操作が時間切れになりました。もう一度押してください。';
    if (c === 'pending') return 'Google への写し返しが残っています。もう一度押してください。';
    return 'データベースが受け付けませんでした（' + c + '）。';
  }

  /* 同時に n 本まで動かす。1本でも失敗したら残りを始めずに失敗を返す */
  /* Google へ読む操作だけを送る（名簿・記録・担当者会議の一覧・薬の変更候補の一覧）。届かなかった・時間切れの時だけ、
   * 少し待って2回まで読み直す（約300回読むうちの1回の通信の途切れで全体を止めない・2026-10-30 切り替えが途中で止まって判明）。
   * Google が答えた断り（JSON の error 等）は読み直さない。止める・外す・タブを写す（gasAdmin）はここを通さない */
  function isTransient(e) {
    var m = String(e && e.message || '');
    return m === 'Google に届きませんでした' || m === 'Google の応答がありません（時間切れ）';
  }
  async function gasRead(io, body) {
    var waits = Array.isArray(io.retryWait) ? io.retryWait : RETRY_WAIT;
    for (var k = 0; ; k++) {
      try { return await io.gas(body); }
      catch (e) {
        if (!isTransient(e) || k >= waits.length) throw e;
        await new Promise(function (ok) { setTimeout(ok, waits[k]); });
      }
    }
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

  /* 全部写す。io = { gas(body) → Promise<応答の JSON>, rpc(name, args) → Promise<{data, error}>, progress(text) }
   * 返す: { ok:true, residents, meetings, medDecisions, run:{inserted, updated, unchanged, missing, unknown}, cmp, big:[id] }
   *       断った時は { ok:false, why（職員向けの文）} */
  async function run(io) {
    var say = io.progress || function () {};
    function fail(why) { return { ok: false, why: why }; }
    var runId = null;
    async function abort() {   // 途中で止めた写しを「断られた」にする（途中まで書いた分はそのまま・消えた印は付けない）
      if (runId == null) return;
      try { await io.rpc('res_import_abort', { p_run: runId }); } catch (e) { /* 次に押すと始まりで取り消される */ }
    }
    var PART = '途中まで写した方がいます（消えた印は付けていません。次に押すと最初から写し直します）。';
    async function stop(why) { var started = runId != null; await abort(); return fail(why + (started ? PART : '')); }
    async function rpc(name, args) {
      var r = await io.rpc(name, args || {});
      if (r && r.error) throw { db: r.error };
      return r ? r.data : null;
    }
    try {
      say('Google から名簿を読んでいます…');
      var rj = await gasRead(io, { action: 'getRoster' });
      if (!rj || rj.error || !Array.isArray(rj.roster)) return fail('Google が名簿を返しませんでした（この端末の入居者マスタの接続先を確かめてください）。');
      var ri = rosterIds(rj.roster), ids = ri.ids, rosterN = rj.roster.length;
      if (ri.bad.length) return fail('名簿の利用者No に、前後の空白・41字以上・空・重なりの方がいます（' + ri.bad.slice(0, 10).join('・') + '）。入居者マスタで利用者No を直してから押し直してください。写しは始めていません。');
      if (!ids.length) return fail('名簿が空でした。写しは始めていません。');

      var recs = {}, meetings = [], gone = [], n = 0;
      await pool(ids, POOL, async function (id) {
        var a = await gasRead(io, { action: 'getResident', id: id });
        if (!a || a.error) throw new Error('Google が記録を返しませんでした');
        var m = await gasRead(io, { action: 'meeting', op: 'list', id: id });
        // 利用者No が担当者会議の決まった形でない方は、会議を作れないので「会議なし」として扱う
        if (m && m.ok === false && m.code === 'bad_input') m = { ok: true, rows: [] };
        if (!m || m.ok !== true || !Array.isArray(m.rows)) throw new Error(m && m.error && !m.code
          ? '入居者マスタの GAS が担当者会議の記録に対応していません（GAS が古い可能性）'
          : 'Google が担当者会議の記録を返しませんでした');
        if (!a.record || typeof a.record !== 'object') { gone.push(id); }
        else {
          var rec = Object.assign({}, a.record);
          rec.id = id;   // 利用者No は文字にそろえる（シートの数字の列でも同じ方を指す）
          recs[id] = rec;
          m.rows.forEach(function (x) { if (x && str(x.meetingId)) meetings.push(Object.assign({}, x, { meetingId: str(x.meetingId), residentId: id })); });
        }
        n++;
        say('Google から読んでいます… ' + n + ' / ' + ids.length + '人');
      });
      if (gone.length) return fail('名簿にいるのに記録を読めなかった方がいます（利用者No ' + gone.slice(0, 10).join('・') + '）。読んでいる間に入居者マスタが直された可能性があります。少し待って押し直してください。写しは始めていません。');
      say('Google から薬の変更候補の判断を読んでいます…');
      var mc = await gasRead(io, { action: 'medCand', op: 'list' });
      if (!mc || mc.ok !== true || !Array.isArray(mc.rows)) return fail('Google が薬の変更候補の判断を返しませんでした。写しは始めていません。');
      if (mc.rows.length >= MED_LIST_MAX) return fail('薬の変更候補の判断が ' + MED_LIST_MAX + '件以上あり、Google が全部を返しません。写しは始めていません（開発の担当へ知らせてください）。');
      var seenMc = {}, meds = [];
      mc.rows.forEach(function (x) {
        var k = x && str(x.srcKey), rid = x && str(x.id);
        if (!k || !rid || k.length > 120 || rid.length > 40 || seenMc[k]) return;
        seenMc[k] = true; meds.push(Object.assign({}, x, { srcKey: k, id: rid }));
      });
      var seenMt = {};
      meetings = meetings.filter(function (x) { if (seenMt[x.meetingId] || x.meetingId.length > 60) return false; seenMt[x.meetingId] = true; return true; });

      var rows = ids.map(function (id) { return recs[id]; });
      var nul = [];
      rows.forEach(function (r) { var k = nulKeys(r); if (k.length) nul.push(r.id + '（' + k.join('・') + '）'); });
      if (nul.length) return fail('読めない文字（NUL）が入っている方がいます（利用者No ' + nul.slice(0, 10).join('・') + '）。入居者マスタでその項目を直してから押し直してください。写しは始めていません。');
      var rc = chunk(rows, ROW_MAX, CHUNK_BYTES, ROW_BYTES);
      if (rc.big.length) return fail('記録が大きすぎる方がいます（利用者No ' + rc.big.map(function (r) { return r.id; }).join('・') + '）。写しは始めていません。');
      var mt = chunk(meetings, ITEM_MAX, CHUNK_BYTES).chunks, md = chunk(meds, ITEM_MAX, CHUNK_BYTES).chunks;

      say('Supabase へ写しています…');
      var b = await rpc('res_import_begin');
      if (!b || !b.ok) return fail(dbWhy(b && b.error));
      runId = b.run;
      if (io.frozen) {   // 切り替えの時は「Google の保存を止めた後の写し」の印を付ける（res_set_mode が確かめる）
        var fz = await rpc('res_import_mark_frozen', { p_run: runId });
        if (!fz || !fz.ok) return stop('止めた後の写しの印を付けられませんでした。');
      }
      var tot = { inserted: 0, updated: 0, unchanged: 0 };
      var parts = rc.chunks.map(function (c) { return [c, [], []]; })
        .concat(mt.map(function (c) { return [[], c, []]; }), md.map(function (c) { return [[], [], c]; }));
      for (var i = 0; i < parts.length; i++) {
        var r = await rpc('res_import_chunk', { p_run: runId, p_rows: parts[i][0], p_meetings: parts[i][1], p_med: parts[i][2] });
        if (!r || !r.ok) return stop(dbWhy(r && r.error));
        tot.inserted += r.inserted || 0; tot.updated += r.updated || 0; tot.unchanged += r.unchanged || 0;
        say('Supabase へ写しています… ' + (i + 1) + ' / ' + parts.length);
      }
      var f = await rpc('res_import_finish', { p_run: runId, p_ids: ids,
        p_meeting_ids: meetings.map(function (x) { return x.meetingId; }), p_med_keys: meds.map(function (x) { return x.srcKey; }) });
      if (!f || !f.ok) return stop(dbWhy(f && f.error));
      runId = null;   // 写しは終わった（この先で止まっても取り消さない）

      say('写しを読み直して見比べています…');
      var copy = [];
      for (var j = 0; j < ids.length; j += GET_MAX) {
        var g;
        try { g = await rpc('res_get', { p_ids: ids.slice(j, j + GET_MAX), p_screen: 'shadow-check' }); }
        catch (e) { g = { ok: false, error: e && e.db }; }
        if (!g || !g.ok) return fail('写しは終わりましたが、読み直せませんでした: ' + dbWhy(g && g.error));
        copy = copy.concat(g.rows || []);
      }
      var runRow = null;
      try { runRow = await io.lastRun(runId); } catch (e) { runRow = null; }
      return { ok: true, residents: ids.length, rosterN: rosterN, meetings: meetings.length, medDecisions: meds.length,
               run: { inserted: tot.inserted, updated: tot.updated, unchanged: tot.unchanged, missing: f.missing || 0,
                      unknown: runRow && Array.isArray(runRow.unknown_keys) ? runRow.unknown_keys : [] },
               cmp: compare(recs, ids, copy) };
    } catch (e) {
      if (e && e.db) return stop(dbWhy(e.db));
      return stop(String(e && e.message || e) + '。写しは止めました。');
    }
  }

  /* ── 自動で写す（代表者の決定 2026-10-29「自動で写す」）──
   * 管理者が事務所PCで入居者マスタを開いた時に、その日（日本時間）まだ写していなければ写す（1日1回）。
   * 前の試みから1時間たっていない時（止まった・走っている途中を含む）は試さない（失敗の繰り返しで Google を混ませない）。
   * 管理者（2段階認証）でない・データベースに 0034 が無い時は何もしない。例外は外へ出さない。
   * io = { gas(body), auth?() → Promise<SUAuth>, now? }。返す: { skip:'理由' } か run の結果 */
  var AUTO_GAP_MS = 60 * 60 * 1000;
  function jstDay(t) { return new Date(new Date(t).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function loadAuth() {   // supabase-js と su-auth.js を必要な時だけ読む（入居者マスタの写しの部品と同じ版）
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    var p = root.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return root.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return root.SUAuth || null; });
  }
  async function auto(io) {
    try {
      var A = await (io.auth ? io.auth() : loadAuth());
      if (!A) return { skip: 'noauth' };
      var st = await A.check();
      if (!st || st.status !== A.STATUS.OK || st.role !== 'admin') return { skip: 'role' };
      var sb = A.client();
      // 切り替えた後は写さない（写しの始まりが断るので、毎回 Google の全件を読んでから失敗しないように先に確かめる・計画書の反証レビュー 指摘11）
      var md = null;
      try { md = await sb.rpc('res_mode_get'); } catch (e) { md = null; }
      if (md && md.data && md.data.mode === 'live') return { skip: 'live' };
      var q = await sb.from('res_sync_runs').select('at,status').order('at', { ascending: false }).limit(10);
      if (q.error) return { skip: 'nodb' };
      var now = io.now || Date.now(), rows = Array.isArray(q.data) ? q.data : [];
      if (rows.some(function (r) { return r.status === 'done' && jstDay(r.at) === jstDay(now); })) return { skip: 'today' };
      if (rows.length && now - new Date(rows[0].at).getTime() < AUTO_GAP_MS) return { skip: 'recent' };
      // 切り替える・戻すの操作が動いている間は写さない（その写しが切り替えの写しを取り消すため・指摘15）
      var busy = null;
      try { busy = await sb.rpc('res_op_busy'); } catch (e) { busy = null; }   // 0036 の前（関数が無い）は今までどおり
      if (busy && busy.data === true) return { skip: 'op' };
      return await run({
        gas: io.gas,
        rpc: function (name, args) { return sb.rpc(name, args); },
        lastRun: async function (id) { var r = await sb.from('res_sync_runs').select('unknown_keys').eq('id', id).limit(1); return r.error ? null : (r.data || [])[0]; },
        progress: function () {}
      });
    } catch (e) { return { skip: 'error' }; }
  }
  /* 自動で写した結果を、職員向けの1文にする。何も知らせなくてよい時（全項目一致・試さなかった）は '' */
  function autoNote(res) {
    if (!res || res.skip) return '';
    if (!res.ok) return '入居者マスタの写し（自動）が取れませんでした: ' + res.why + '　写しの見比べの画面で確かめてください。';
    var bad = res.cmp.diff.length + res.cmp.notInCopy.length;
    if (bad) return '入居者マスタの写し（自動）で、Google と違う方が ' + bad + '人いました。写しの見比べの画面で「入居者マスタを全部写す」を押して確かめてください。';
    if (res.run.unknown.length) return '入居者マスタの写し（自動）に、区分の決まっていない項目がありました（' + res.run.unknown.join('・') + '）。開発の担当へ知らせてください。';
    return '';
  }

  /* ── 切り替える・戻す（2026-10-29 代表者の決定 案1。設計書 §10）──
   * io = run と同じ（gas・rpc・lastRun・progress）＋ token()（ログインの証明を返す）
   * 切り替える: ① Google への直接の保存を止める → ② 止めた後の全項目の写し（全員一致の時だけ進む）→ ③ ほかのタブを写す → ④ 切り替える。
   *   ②〜④で止まった時は①を戻す（まだ切り替えていないので、写し返す分は無い）
   * 戻す: ① 写しの期間に戻す（新しい保存先で保存しなくなる）→ ② Google へ最後まで写し返し、直接の保存を止める印を外す */
  var TABS = ['med_cand', 'master_meeting', 'master_meeting_hist', 'master_yakujo_log', 'master_dataJson_bak', 'med_dict', 'meta'];
  async function gasAdmin(io, body) {
    var at = await io.token();
    if (!at) throw new Error('ログインしてからもう一度押してください');
    var j = await io.gas(Object.assign({}, body, { accessToken: at }));
    if (!j || j.ok !== true) throw new Error(String(j && j.error || 'Google が受け付けませんでした').replace(/^Error: (refused: )?/, ''));
    return j;
  }
  async function opBegin(io, op) {
    var r = await io.rpc('res_op_begin', { p_op: op });
    if (!r || r.error || !r.data || r.data.ok !== true) throw new Error(dbWhy(r && (r.error || r.data && r.data.error)));
    return r.data.token;
  }
  /* 後片付け（止める印を外す・操作の札を返す）は、届かなかった時に少し待って3回まで送り直す
   * （1回きりだと通信の途切れで Google の保存が止まったまま・札が30分残り、戻すも切り替えるも押せなくなる・2026-10-30 計画書の切り替えで判明） */
  var UNDO_WAIT = [2000, 5000, 10000];
  async function again(io, fn) {
    var waits = Array.isArray(io.undoWait) ? io.undoWait : UNDO_WAIT;
    for (var k = 0; ; k++) {
      try { return await fn(); }
      catch (e) {
        if (k >= waits.length) throw e;
        await new Promise(function (ok) { setTimeout(ok, waits[k]); });
      }
    }
  }
  async function opEnd(io, tok) {
    try {
      await again(io, async function () {
        var r = await io.rpc('res_op_end', { p_token: tok });
        if (r && r.error) throw new Error('op_end');
      });
    } catch (e) { /* 30分で失効する */ }
  }
  async function cutover(io) {
    var say = io.progress || function () {};
    var frozen = false, tok = null;
    async function undo(why) {
      // 止める指示を送った後（応答が届かなかった時も）は、必ず外す指示を試す（止めたまま放置しない・指摘8）
      if (frozen) { try { await again(io, function () { return gasAdmin(io, { action: 'resCutover', on: false, opToken: tok }); }); } catch (e) { why += '（Google の保存を止めたままの可能性があります。もう一度「切り替える」か「写しの期間に戻す」を押してください）'; } }
      return { ok: false, why: why };
    }
    try {
      try { tok = await opBegin(io, 'cutover'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      say('Google への直接の保存を止めています…');
      frozen = true;
      await gasAdmin(io, { action: 'resCutover', on: true, opToken: tok });
      var r = await run(Object.assign({}, io, { frozen: true }));
      if (!r.ok) return await undo(r.why);
      var bad = r.cmp.diff.length + r.cmp.notInCopy.length;
      if (bad) return await undo('写しが Google と違う方が ' + bad + '人いたので、切り替えを止めました。');
      say('ほかのタブを写しています…');
      var ex = await gasAdmin(io, { action: 'exportTabs', opToken: tok });
      for (var i = 0; i < TABS.length; i++) {
        var t = await io.rpc('res_tabs_import', { p_name: TABS[i], p_rows: Array.isArray(ex.tabs && ex.tabs[TABS[i]]) ? ex.tabs[TABS[i]] : [] });
        if (!t || t.error || !t.data || t.data.ok !== true) return await undo(dbWhy(t && (t.error || t.data && t.data.error)));
      }
      say('切り替えています…');
      var m = await io.rpc('res_set_mode', { p_mode: 'live' });
      if (!m || m.error || !m.data || m.data.ok !== true) {
        // 応答が届かなかっただけで切り替わっていることがある。読み直して確かめる（指摘9）
        var g = null;
        try { g = await io.rpc('res_mode_get', {}); } catch (e) { g = null; }
        if (!(g && g.data && g.data.mode === 'live')) return await undo(dbWhy(m && (m.error || m.data && m.data.error)));
      }
      return { ok: true, residents: r.residents };
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
      var m = await io.rpc('res_set_mode', { p_mode: 'shadow' });
      if (!m || m.error || !m.data || m.data.ok !== true) return { ok: false, why: dbWhy(m && (m.error || m.data && m.data.error)) };
      say('Google へ写し返しています…');
      var last = null;
      for (var i = 0; i < 5; i++) {
        try { last = await gasAdmin(io, { action: 'resCutover', on: false, opToken: tok }); break; }
        catch (e) { last = e; if (!/残っています/.test(String(e && e.message))) break; }
      }
      if (!last || last instanceof Error) return { ok: false, why: '写しの期間には戻しました。Google への写し返しが終わっていません: ' + String(last && last.message || '') + '　もう一度「写しの期間に戻す」を押してください。' };
      return { ok: true, records: last.records || 0 };
    } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
    finally { if (tok) await opEnd(io, tok); }
  }

  root.SUResFull = { run: run, auto: auto, autoNote: autoNote, cutover: cutover, back: back, _jstDay: jstDay, _rosterIds: rosterIds, _nulKeys: nulKeys, _chunk: chunk, _diffKeys: diffKeys, _compare: compare, _dbWhy: dbWhy, _pool: pool };
})(typeof window !== 'undefined' ? window : this);
