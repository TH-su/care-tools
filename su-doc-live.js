/*
 * su-doc-live.js — 職員マスタ・入居調整の添付書類の正本の切り替え（統合 0065・2026-11-05 代表者の決定: 移す準備ができるものから次々に進める）
 * ════════════════════════════════════════════════════════════════
 * 職員マスタ（staff-master.html）と入居調整（admission-flow.html）が書類のために GAS へ送る1回の送信だけを、ここに通す。
 *   SUDocLive.staff(本文, Google へ送る関数) … fetch と同じ形（ok・status・text()）の答え（職員マスタ）
 *   SUDocLive.adm(本文, Google へ送る関数)   … GAS の応答と同じ形の物（入居調整）
 * ・スイッチ su-backend.json の supabase.docs が切・読めない・現場の端末・ログインしていない・書類の本文でない時は、Google へ送る関数をそのまま呼ぶ
 *   ＝本文も送り方も1バイトも変わらない（CLAUDE.md §2-3）。
 * ・スイッチが入で、事務所・管理者のログインがあり、データベースの印（doc_mode_get）がその種類を「切り替えた後」と答えた時だけ、新しい保存先で置く・開く・消す・一覧を作る。
 *     置く: 端末の中で指紋（SHA-256）を数え、置き場 doc-files の「事業者 id/種類/持ち主/書類の id/指紋の頭16字」へ置いてから doc_put で台帳へ足す
 *           （台帳へ足せなかった時は、置いた物を消す）
 *     一覧: 職員マスタは Google の一覧（list）の各職員の目録（filesJson）を、入居調整は目録（filesGet）を、台帳（doc_list）の今の中身に置き換える
 *     開く: 置き場から読む（入居調整は今の downloadFile と同じ形で返す・職員マスタは SUDocLive.open）
 *     消す: doc_del（台帳に消した印。ドライブの「削除済み」へは Google が1時間ごとに写し返す）
 * ・Google が「切り替えた後」と断った時（code doc_switched）は、覚えている印を捨てて1回だけ道を選び直す（Google は書いていないので送り直してよい）。
 * ・印を確かめられない時は Google へ送る（Google は切り替えた後の書類の出し入れを自分で断るので、正本が2つに分かれない）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUDocLive が無ければ今までどおり Google へ送る）・例外を外に出さない
 *   （外へ出すのは、新しい保存先へ送った時の「届かない・時間切れ」だけ＝画面の今までの通信の失敗と同じ扱い）。
 * ★書類の中身・氏名・ファイル名を端末に残さない（覚えるのはこのページの間だけ・書類の id と置き場の名前の対応だけ）。
 */
(function (root) {
  'use strict';
  if (root.SUDocLive) return;
  var FLAG = 'docs';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var BUCKET = 'doc-files';
  var MODE_MS = 60000;
  var CALL_MS = 120000;
  var MODE_CALL_MS = 15000;
  var NAME_MAX = 120;   // ファイル名の上限（今の GAS と同じ。長い名前を切ると、画面の「入っていたか」の照合が合わなくなる・指摘13）
  var MAX_BYTES = 10 * 1024 * 1024;
  var MIMES = {
    stf: ['application/pdf', 'image/jpeg', 'image/png'],
    adm: ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  };
  var OWNER_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var TENANT_RE = /^[0-9a-f-]{36}$/;

  /* 本番の健康（統合 0088）: 新しい保存先への書類の置く・消すの失敗だけを、種類（doc_stf・doc_adm）と理由で数える（su-health.js が無ければ何もしない）。
     入力の誤り（形式・大きさ・名前の長さ）と、切り替え・戻しの途中の断り（doc_not_live・doc_frozen）は数えない */
  function health(kind, info) {
    try { if (root.SUHealth) root.SUHealth.fail('doc_' + kind, info); } catch (e) { /* 数えられなくても止めない */ }
  }
  function healthOf(kind, r) {
    var c = String(r && r.error || '');
    if (c === 'doc_not_live' || c === 'doc_frozen') return;
    health(kind, { code: c === 'denied' ? 'denied' : (/^[a-z_]{1,40}$/.test(c) ? c : '') });
  }
  function healthThrown(kind) {
    return function (e) { health(kind, e && e.name === 'AbortError' ? { timeout: true } : { network: true }); throw e; };
  }
  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('保存・同期の失敗', e, 'doc-live:' + where); } catch (x) { /* 記録できなくても止めない */ }
  }

  /* ── スイッチ（su-stf.js と同じ読み方）── */
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
  function hasLoginRecord() {
    try {
      var ls = root.localStorage;
      for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (/^sb-[a-z0-9]+-auth-token$/.test(String(k))) return true; }
    } catch (e) { /* 何もしない */ }
    return false;
  }

  /* ── ログインの部品を必要な時だけ読む（su-stf.js と同じ）── */
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

  /* ── 印（doc_mode_get）。1分は覚える。→ {stf, adm, tenant} / 'none'（0065 の前）/ 'denied'。届かない時は例外 ── */
  var modeCache = null, modeAt = 0, liveSeen = { stf: false, adm: false };
  /* 新しい保存先への1回の通信に時計を付ける（返らない時に画面が「送信中」のまま止まらないように・画面の反証レビュー 指摘1）。時間切れは AbortError */
  function withTime(p, ms) {
    var tm = null;
    var timer = new Promise(function (ok) { tm = setTimeout(function () { ok({ __timeout: true }); }, ms); });
    return Promise.race([Promise.resolve(p), timer]).then(function (r) {
      clearTimeout(tm);
      if (r && r.__timeout) { var e = new Error('時間切れ'); e.name = 'AbortError'; throw e; }
      return r;
    }, function (e) { clearTimeout(tm); throw e; });
  }
  function modeOf(A) {
    if (modeCache && Date.now() - modeAt < MODE_MS) return Promise.resolve(modeCache);
    return withTime(A.client().rpc('doc_mode_get'), MODE_CALL_MS).then(function (r) {
      var c = String(r && r.error && (r.error.code || '') || '');
      if (r && r.error && /PGRST202|42883/.test(c)) return 'none';
      if (r && r.error && c === '42501') return 'denied';
      if (!r || r.error || !r.data || r.data.ok !== true) throw new Error('mode');
      modeCache = { stf: r.data.stf && r.data.stf.mode === 'live', adm: r.data.adm && r.data.adm.mode === 'live', tenant: String(r.data.tenant || '') };
      modeAt = Date.now();
      return modeCache;
    });
  }
  function forget() { modeCache = null; modeAt = 0; }

  /* その種類をこの送信でどこへ送るか → { A }（新しい保存先）/ { gas: true, why }（Google へ・why は login・denied・空）/ { err: 文 }（どちらへも送らない）。
   * スイッチが入なのにログインしていない・使えないアカウントの時は Google へ送り（Google は切り替えた後の出し入れを自分で断る）、その理由を覚えて断りの文に使う（指摘6）。
   * 確かめられない（届かない）時は、前に切り替えた後だと分かっていたなら Google の古い中身を返さずに失敗にする（指摘5）。分からなかったなら Google へ */
  function route(kind) {
    if (fieldDevice()) return Promise.resolve({ gas: true, why: '' });
    return refreshFlags().then(function () {
      if (!switchOn()) { liveSeen[kind] = false; return { gas: true, why: '', off: true }; }
      if (!hasLoginRecord()) { liveSeen[kind] = false; return { gas: true, why: 'login' }; }
      return loadAuth().then(function (A) {
        if (!A) throw new Error('auth');
        return Promise.resolve(A.check()).then(function (st) {
          if (!st || st.status !== A.STATUS.OK) { liveSeen[kind] = false; return { gas: true, why: st && st.status === 'signed_out' ? 'login' : 'denied' }; }
          return modeOf(A).then(function (m) {
            if (m === 'denied') { liveSeen[kind] = false; return { gas: true, why: 'denied' }; }
            var on = !!(m && typeof m === 'object' && m[kind] === true && TENANT_RE.test(m.tenant));
            liveSeen[kind] = on;
            return on ? { A: A } : { gas: true, why: '' };
          });
        });
      });
    }).catch(function (e) {
      note('印', e);
      if (liveSeen[kind]) return { err: MSG.mode };
      return { gas: true, why: '' };
    });
  }

  /* ── 新しい保存先の口 ── */
  function rpc(A, fn, args, ms) {
    return withTime(A.client().rpc(fn, args), Number(ms) > 0 ? Number(ms) : CALL_MS).then(function (r) {
      if (r && r.error) {
        var c = String(r.error.code || '');
        if (c === '42501') return { ok: false, error: 'denied' };
        throw new Error('rpc ' + fn + ' ' + c);
      }
      return r ? r.data : null;
    });
  }
  var MSG = {
    denied: 'このアカウントでは書類を扱えません。管理者へ連絡してください。',
    toomany: 'この方の書類は上限に達しています。古い書類を削除してください。',
    toolarge: 'ファイルが大きすぎます（1つ 10MB まで）。',
    badtype: 'この形式は保存できません。',
    badrow: '書類の情報が正しくありません。画面を読み込み直してから、もう一度お試しください。',
    doc_frozen: '書類の保存先を戻している最中です。少し待ってから、画面を読み込み直してもう一度お試しください。',
    doc_not_live: '書類の保存先を切り替えている最中です。少し待ってから、画面を読み込み直してもう一度お試しください。',
    notfound: 'その書類は見つかりません（一覧を取り直してください）。',
    dup: '書類を新しい保存先に置けませんでした。もう一度お試しください。',
    noobject: '書類を置き場に置けたか確かめられませんでした。もう一度お試しください。',
    mismatch: 'ファイルの中身が、選んだ時と違いました。ファイルを選び直してください。',
    busy: 'ほかの操作が終わるのを待っています。少し待ってから、もう一度お試しください。',
    login: 'この端末はログインしていないか、ログインが切れています。ログインしてから、もう一度お試しください（書類は新しい保存先に切り替わっています）。',
    mode: '新しい保存先の状態を確かめられませんでした。少し待ってから、もう一度お試しください。',
    longname: 'ファイル名が長すぎます（上限 120字）。名前を短くしてから選び直してください。',
    put: '書類を新しい保存先に置けませんでした。もう一度お試しください。',
    read: '書類を新しい保存先から取り出せませんでした。もう一度お試しください。',
    list: '書類の一覧を新しい保存先から読めませんでした。少し待ってから、もう一度お試しください。'
  };
  function why(code) { return MSG[String(code || '')] || MSG.put; }

  /* 書類の id と置き場の名前の対応（このページの間だけ）。種類/持ち主/書類の id → 置き場の名前 */
  var keyOf = {};
  function remember(kind, owner, list) {
    (Array.isArray(list) ? list : []).forEach(function (f) { if (f && f.fid && f.key) keyOf[kind + '/' + owner + '/' + f.fid] = String(f.key); });
  }
  /* 目録の1件（GAS の fileElem_ と同じキー・型。置き場の名前は持たせない） */
  function elemOf(f) {
    return { fid: String(f.fid || ''), name: String(f.name == null ? '' : f.name), kind: String(f.kind == null ? '' : f.kind), title: String(f.title == null ? '' : f.title),
             size: Number(f.size) || 0, mime: String(f.mime || ''), addedAt: String(f.addedAt == null ? '' : f.addedAt), by: String(f.by == null ? '' : f.by) };
  }
  function list(A, kind, owner, ms) {
    var args = { p_kind: kind };
    if (owner) args.p_owner = owner;
    return rpc(A, 'doc_list', args, ms).then(function (d) {
      if (!d || d.ok !== true || !d.files || typeof d.files !== 'object') {
        if (d && d.error === 'doc_not_live') forget();
        var e = new Error(String(d && d.error || 'list')); e.refused = d && d.error ? why(d.error) : MSG.list; throw e;
      }
      var out = {};
      Object.keys(d.files).forEach(function (o) {
        if (!OWNER_RE.test(o) || !Array.isArray(d.files[o])) return;
        remember(kind, o, d.files[o]);
        out[o] = d.files[o].map(elemOf);
      });
      return out;
    });
  }

  function b64ToBytes(b64) {
    var bin = root.atob(String(b64 || '').replace(/\s+/g, ''));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(u) {
    var s = '', step = 0x8000;
    for (var i = 0; i < u.length; i += step) s += String.fromCharCode.apply(null, u.subarray(i, i + step));
    return root.btoa(s);
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function newFid() {
    var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', r = new Uint8Array(24), s = '';
    root.crypto.getRandomValues(r);
    for (var i = 0; i < r.length; i++) s += abc.charAt(r[i] % abc.length);
    return 'd' + s;
  }

  /* 置く → {ok:true, file} / {ok:false, error}。届かない・時間切れは例外（台帳へ足せたか分からない） */
  function put(A, kind, owner, b) {
    var mime = String(b.mime || '').toLowerCase();
    if (!OWNER_RE.test(owner)) return Promise.resolve({ ok: false, error: MSG.badrow });
    if (MIMES[kind].indexOf(mime) < 0) return Promise.resolve({ ok: false, error: MSG.badtype });
    if (String(b.name == null ? '' : b.name).length > NAME_MAX) return Promise.resolve({ ok: false, error: MSG.longname });
    var bytes;
    try { bytes = b64ToBytes(b.dataB64); } catch (e) { return Promise.resolve({ ok: false, error: 'ファイルの中身を読めませんでした。選び直してください。' }); }
    if (!bytes.length) return Promise.resolve({ ok: false, error: 'ファイルの中身がありません' });
    if (bytes.length > MAX_BYTES) return Promise.resolve({ ok: false, error: MSG.toolarge });
    var tenant = modeCache && modeCache.tenant, fid = newFid(), key = '', sha = '';
    if (!TENANT_RE.test(String(tenant || ''))) return Promise.resolve({ ok: false, error: MSG.doc_not_live });
    var store = A.client().storage.from(BUCKET);
    return Promise.resolve(root.crypto.subtle.digest('SHA-256', bytes)).then(function (d) {
      sha = hex(d);
      key = tenant + '/' + kind + '/' + owner + '/' + fid + '/' + sha.slice(0, 16);
      return withTime(store.upload(key, new root.Blob([bytes], { type: mime }), { contentType: mime, upsert: false, cacheControl: '0' }), CALL_MS).then(null, healthThrown(kind));
    }).then(function (u) {
      if (u && u.error) {
        // 置き場で断られた（戻した直後など）時は、覚えている印を捨てる（次の送信で読み直す・指摘8）
        if (/^40[13]$/.test(String(u.error.statusCode || ''))) forget();
        note('置く', new Error(String(u.error.statusCode || u.error.message || 'upload').slice(0, 40)));
        health(kind, { status: Number(u.error.statusCode) || 0 });
        return { ok: false, error: MSG.put };
      }
      var meta = { name: String(b.name == null ? '' : b.name), kind: String(b.kind == null ? '' : b.kind).slice(0, 40),
                   title: String(b.title == null ? '' : b.title).slice(0, 200), size: bytes.length, mime: mime };
      return rpc(A, 'doc_put', { p_kind: kind, p_owner: owner, p_fid: fid, p_meta: meta, p_sha256: sha }).then(null, healthThrown(kind)).then(function (r) {
        if (r && r.ok === true && r.file) {
          keyOf[kind + '/' + owner + '/' + fid] = key;
          return { ok: true, file: elemOf(r.file) };
        }
        if (r && r.error === 'doc_not_live') forget();
        healthOf(kind, r);
        // 台帳へ足せなかった（断られた）時は、置いた物を消す（自分で置いて台帳に無い物だけ消せる決まり）
        return Promise.resolve(store.remove([key])).catch(function (e) { note('置いた物を消す', e); }).then(function () { return { ok: false, error: why(r && r.error) }; });
      });
    });
  }
  function del(A, kind, owner, fid) {
    if (!OWNER_RE.test(owner) || !fid) return Promise.resolve({ ok: false, error: MSG.notfound });
    return rpc(A, 'doc_del', { p_kind: kind, p_owner: owner, p_fid: String(fid) }).then(null, healthThrown(kind)).then(function (r) {
      if (r && r.ok === true) return { ok: true, warnings: [] };
      if (r && r.error === 'doc_not_live') forget();
      healthOf(kind, r);
      return { ok: false, error: why(r && r.error) };
    });
  }
  /* 置き場から読む → {ok:true, blob, name, mime, size} / {ok:false, error} */
  function read(A, kind, owner, fid) {
    var k = keyOf[kind + '/' + owner + '/' + fid];
    var got = k ? Promise.resolve(k) : list(A, kind, owner).then(function () { return keyOf[kind + '/' + owner + '/' + fid] || ''; });
    return got.then(function (key) {
      if (!key) return { ok: false, error: MSG.notfound };
      return withTime(A.client().storage.from(BUCKET).download(key), CALL_MS).then(function (r) {
        if (!r || r.error || !r.data) { note('開く', new Error('download')); return { ok: false, error: MSG.read }; }
        return { ok: true, blob: r.data, size: r.data.size };
      });
    });
  }

  /* fetch と同じ形の答え（職員マスタは res.ok・res.status・res.text() で読む） */
  function asResponse(d) {
    var t = JSON.stringify(d);
    return { ok: true, status: 200, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(JSON.parse(t)); } };
  }
  /* Google の答えに「切り替えた後」の断りがあるか（fetch の答え・物のどちらでも） */
  function switchedText(t) { return /"code"\s*:\s*"doc_switched"/.test(String(t || '')); }

  /* ── 職員マスタ: list・uploadFile・removeFile。opts.timeoutMs … 画面の待ち時間（一覧の台帳の読み取りもこれに合わせる・指摘2）── */
  function staff(p, gasSend, opts) {
    var a = p && typeof p.action === 'string' ? p.action : '';
    if (a !== 'list' && a !== 'uploadFile' && a !== 'removeFile') return gasSend();
    var waitMs = Math.min(CALL_MS, Number(opts && opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : CALL_MS);
    var tries = 0;
    function viaGas(rt) {
      return Promise.resolve(gasSend()).then(function (res) {
        // スイッチが切の時は、Google の答えをそのまま返す（今までと同じ・指摘10）
        if (!res || typeof res.clone !== 'function' || a === 'list' || rt.off) return res;
        return res.clone().text().then(function (t) {
          if (!switchedText(t)) return res;
          if (tries++ > 0) { if (rt.why) health('stf', { code: rt.why }); return rt.why ? asResponse({ ok: false, error: MSG[rt.why] }) : res; }   // 選び直しても Google: ログインの理由を伝える
          forget();
          return go();   // Google は書いていない＝道を選び直して送ってよい
        }, function () { return res; });
      });
    }
    function go() {
      return route('stf').then(function (rt) {
        if (rt.err) { if (a !== 'list') health('stf', { network: true }); return asResponse({ ok: false, error: rt.err }); }
        if (!rt.A) return viaGas(rt);
        var A = rt.A;
        if (a === 'list') {
          return Promise.resolve(gasSend()).then(function (res) {
            if (!res || !res.ok || typeof res.text !== 'function') return res;
            return res.text().then(function (t) {
              var d = null;
              try { d = JSON.parse(t); } catch (e) { return asResponseText(t); }
              if (!d || d.ok !== true || !Array.isArray(d.rows)) return asResponseText(t);
              return list(A, 'stf', null, waitMs).then(function (files) {
                d.rows.forEach(function (row) { if (row && typeof row === 'object') row.filesJson = files[String(row.id || '')] || []; });
                return asResponse(d);
              }, function (e) {
                // 台帳を読めない時は、古い書類の欄で「入っていない」と言わないよう、一覧ごと失敗にする（指摘5）
                note('一覧', e);
                if (e && e.name === 'AbortError') throw e;
                return asResponse({ ok: false, error: e && e.refused ? e.refused : MSG.list });
              });
            });
          });
        }
        var owner = String(p.id == null ? '' : p.id).trim();
        var job = a === 'uploadFile' ? put(A, 'stf', owner, p) : del(A, 'stf', owner, String(p.fid == null ? '' : p.fid).trim());
        return job.then(asResponse);
      });
    }
    try { return go(); } catch (e) { note('職員マスタ', e); return gasSend(); }
  }
  function asResponseText(t) {
    return { ok: true, status: 200, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(JSON.parse(t)); } };
  }

  /* ── 入居調整: filesGet・uploadFile・removeFile・downloadFile ── */
  function adm(p, gasCall) {
    var a = p && typeof p.action === 'string' ? p.action : '';
    if (a !== 'filesGet' && a !== 'uploadFile' && a !== 'removeFile' && a !== 'downloadFile') return gasCall();
    var tries = 0;
    function viaGas(rt) {
      return Promise.resolve(gasCall()).then(function (r) {
        if (!(r && r.code === 'doc_switched') || rt.off) return r;
        if (tries++ > 0) { if (rt.why && a !== 'filesGet' && a !== 'downloadFile') health('adm', { code: rt.why }); return rt.why ? { ok: false, error: MSG[rt.why] } : r; }
        forget();
        return go();
      });
    }
    function go() {
      return route('adm').then(function (rt) {
        if (rt.err) { if (a === 'uploadFile' || a === 'removeFile') health('adm', { network: true }); return { ok: false, error: rt.err }; }
        if (!rt.A) return viaGas(rt);
        var A = rt.A;
        var cid = String(p.cid == null ? '' : p.cid).trim();
        if (a === 'filesGet') {
          return list(A, 'adm', null).then(function (files) { return { ok: true, filesRev: 0, files: files, updatedAt: '' }; },
            function (e) { note('一覧', e); if (e && e.name === 'AbortError') throw e; return { ok: false, error: e && e.refused ? e.refused : MSG.list }; });
        }
        if (a === 'uploadFile') return put(A, 'adm', cid, p).then(function (r) { return r.ok ? { ok: true, file: r.file, filesRev: 0 } : r; });
        if (a === 'removeFile') return del(A, 'adm', cid, String(p.fid == null ? '' : p.fid).trim()).then(function (r) { return r.ok ? { ok: true, filesRev: 0, warnings: [] } : r; });
        var fid = String(p.fid == null ? '' : p.fid).trim();
        return read(A, 'adm', cid, fid).then(function (r) {
          if (!r.ok) return r;
          return r.blob.arrayBuffer().then(function (buf) {
            return { ok: true, mime: String(r.blob.type || ''), size: buf.byteLength, dataB64: bytesToB64(new Uint8Array(buf)) };
          });
        }, function (e) { note('開く', e); return { ok: false, error: e && e.refused ? e.refused : MSG.read }; });
      });
    }
    try { return go(); } catch (e) { note('入居調整', e); return gasCall(); }
  }

  /* ── 職員マスタの「開く」: 切り替えた後だけ使う（liveNow が true の時）。→ {ok, blob} / {ok:false, error} ── */
  function open(kind, owner, fid) {
    return route(kind).then(function (rt) {
      if (rt.err) return { ok: false, error: rt.err };
      if (!rt.A) return { ok: false, error: rt.why ? MSG[rt.why] : MSG.doc_not_live };
      return read(rt.A, kind, String(owner || ''), String(fid || ''));
    }).catch(function (e) { note('開く', e); return { ok: false, error: MSG.read }; });
  }
  /* 直前の道の選び方で、その種類が新しい保存先だったか（画面の描き分けに使う・通信しない） */
  function liveNow(kind) { return !!liveSeen[kind]; }

  root.SUDocLive = {
    staff: staff, adm: adm, open: open, liveNow: liveNow, refreshFlags: refreshFlags,
    _times: function (ms) { CALL_MS = ms; MODE_CALL_MS = ms; },   // 試験だけが使う（時計を短くする）
    _reset: function () { forget(); ownFlags = null; flagsAt = 0; flagsP = null; keyOf = {}; liveSeen = { stf: false, adm: false }; }
  };
})(typeof window !== 'undefined' ? window : this);
