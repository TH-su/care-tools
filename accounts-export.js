/*
 * accounts-export.js — 使える人の管理（accounts.html）の「全データの書き出し」（2026-10-26 新設・代表者の依頼）
 * ════════════════════════════════════════════════════════════════
 * 1回の書き出し:
 *   1. データベース: export_begin（表の一覧・件数・記録の1行）→ 表ごとに export_page を 2000 行ずつ
 *   2. Google（GAS）: この端末の接続設定（connection-settings.html と同じキー）にある系統だけを、今ある読み口で読む
 *   3. ZIP（README.txt・manifest.json・db/*.json・db/*.csv・gas/*.json・gas/*.csv）を作って、この端末に保存させる
 *   4. export_finish に、画面が受け取った件数・GAS の分の件数・ファイル名を書く（データベースの件数と違えば知らせる）
 * ★できる人の判定はデータベース（管理者＋2段階認証＝aal2 でなければ 42501）。この画面は見せ方を整えるだけ。
 * ★現場の端末（su_device_role = field）では書き出さない（全件データを取りに行かない決まり）。
 * ★中身は端末に残さない（メモリで ZIP を作り、保存の後に URL を捨てる）。GAS の合言葉は画面に出さない・記録に書かない。
 * ★GAS への送り方は su-data-gas.js の post と同じ形（text/plain・redirect:'follow'・res.json()・合言葉は本文の token）。
 * ★表示はすべて textContent。
 * ★暗号化（2026-10-26 本人指示・代表者の決定）: 既定は「暗号化する」。ZIP を su-export-crypt.js（接続設定の控えと同じ方式）で
 *   暗号化して「元の名前.suenc」で保存する。暗号化しない時は理由（5〜200文字）を export_begin に渡し、データベースの記録に残す（0025）。
 *   0024 の決定「ZIP に鍵はかけない」は、この決定で置き換わった。
 *   パスフレーズは保存しない（localStorage・sessionStorage・記録・送信のどれにも入れない）。使い終えたら（成功・失敗とも）入力欄を空にし、変数も手放す。
 * ★「暗号化した書き出しを開く」: .suenc とパスフレーズから元の ZIP をこの端末に保存する。データベース・GAS には触らない。事務所 PC だけ。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 2000;
  var GAS_TIMEOUT_MS = 90000;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function note(text, kind) {
    var m = $('ex-msg');
    m.className = 'msg ' + (kind || 'ng');
    m.textContent = text || '';
  }
  function prog(text) { $('ex-prog').textContent = text || ''; }

  function friendly(err) {
    var code = err && err.code;
    var m = String(err && err.message || err || '');
    if (code === '42501' || /permission denied/i.test(m)) {
      return '書き出せませんでした。管理者として2段階認証まで済んでいるか確かめて、ログインし直してからもう一度試してください。';
    }
    if (code === 'PGRST202' || /could not find the function/i.test(m)) {
      return '書き出しの準備（データベースの 0025）がまだできていません。';
    }
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return 'うまくいきませんでした。もう一度試してください。';
  }

  /* ── この端末の接続設定（connection-settings.html の SYSTEMS と同じキー・同じ形）── */
  function lsObj(k) { try { var s = localStorage.getItem(k); var o = s ? JSON.parse(s) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
  function lsStr(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  var RE_GAS = /^https:\/\/script\.google\.com\/.*\/exec(\?|#|$)/;
  function cfg(id) {
    var o;
    switch (id) {
      case 'ws':       o = lsObj('su_sync_common'); return { url: o.endpoint, token: o.token };
      /* readAuth: 読み取りでログインの証明を確かめる GAS（入居調整・訓練計画書・入居者マスタ）。この3つにだけ証明を添える（2026-10-29） */
      case 'adm':      o = lsObj('adm_cfg'); return { url: o.url, token: o.token, readAuth: true };
      case 'tp':       o = lsObj('tp_cfg'); return { url: o.url, token: o.token, readAuth: true };
      case 'master':   o = lsObj('rmaster_cfg'); return { url: o.url, token: o.token, readAuth: true };
      case 'haiben':   return { url: lsStr('hbcr_api_url'), token: lsStr('hbcr_api_token') };
      case 'weight':   return { url: lsStr('wtmgr_api_url'), token: lsStr('wtmgr_api_token'), tokenOptional: true };
      case 'geno':     o = lsObj('genogram:cloudCfg'); return { url: o.gasUrl, token: o.gasToken };
      case 'analyzer': o = lsObj('shiftanalyzer:v1:cloud'); return { url: o.url, token: o.token };
    }
    return {};
  }

  /* GAS への POST（su-data-gas.js の post と同じ形。合言葉は本文の token・URL に載せない） */
  function post(t, payload) {
    var body = {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    body.token = t.token;
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    /* 読み取りで証明を確かめる GAS（t.readAuth）にだけ、ログインしている時に証明を添える（su-gas-auth.js・代表者の決定 2026-10-29）。
       排泄・体重・家族構成図・シフト分析・統合同期には添えない。打ち切りの時計は証明を取った後に始める（待ち時間を減らさない） */
    var ga = (t && t.readAuth === true && window.SUGasAuth) ? window.SUGasAuth : null;
    return (ga ? ga.addTo(body) : Promise.resolve(body)).then(function (b) {
      timer = ac ? setTimeout(function () { ac.abort(); }, GAS_TIMEOUT_MS) : null;
      return fetch(t.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(b),
        redirect: 'follow',
        signal: ac ? ac.signal : undefined
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  /* GAS の断り（形はアプリごとに違う）。断りの文は記録に写さない（個人情報が混ざりうる） */
  function refused(j) { return !j || typeof j !== 'object' || j.ok === false || (j.error != null && j.error !== ''); }
  function Refused() { var e = new Error('refused'); e.refused = true; return e; }
  function need(j) { if (refused(j)) throw Refused(); return j; }

  /* 少しずつ並べて読む（GAS の同時実行の枠を塞がない） */
  async function each(list, n, fn) {
    var out = new Array(list.length), i = 0;
    async function worker() { while (i < list.length) { var k = i++; out[k] = await fn(list[k], k); } }
    var ws = [];
    for (var w = 0; w < Math.min(n, list.length); w++) ws.push(worker());
    await Promise.all(ws);
    return out;
  }

  /* 1件ずつ読む系統: 1件が読めなくても残りは残す（読めなかった数だけ返す。全部だめなら系統ごと「入っていない」） */
  async function missCount(list, n, fn) {
    var miss = 0;
    await each(list, n, async function (x) { try { await fn(x); } catch (e) { miss++; } });
    if (list.length && miss === list.length) throw Refused();
    return miss;
  }
  function missNote(miss) { return miss ? miss + ' 件は読めなかった（もう一度書き出すと読めることがある）' : ''; }

  /* 系統ごとの読み方。parts は {部分の名前: 値}。count は「件」として数えるもの */
  var GAS = [
    { id: 'ws', title: '週間計画・ワースケ・勤務表（統合同期）',
      read: async function (t) {
        var j = need(await post(t, { action: 'pull' }));
        var e = (j.entries && typeof j.entries === 'object') ? j.entries : {};
        return { parts: { entries: e }, count: Object.keys(e).length, unit: 'キー' };
      } },
    { id: 'adm', title: '入居調整',
      read: async function (t) {
        var j = need(await post(t, { action: 'get', key: 'admission_flow_v1' }));
        // 入居調整を新しい保存先へ切り替えた後（GAS の応答に switched）は、Google の台帳は写し返しの分だけ遅れていることがある（入居調整の反証レビュー 指摘4）
        var lag = j.switched === true ? '。新しい保存先へ切り替えた後のため、Google の台帳は写し返しの分だけ遅れていることがあります（正本は新しい保存先）' : '';
        return { parts: { ledger: j.data == null ? null : j.data }, count: j.data == null ? 0 : 1, unit: '台帳', note: '添付ファイルは入っていません' + lag };
      } },
    { id: 'tp', title: '個別機能訓練計画書',
      read: async function (t) {
        var idx = need(await post(t, { action: 'get', key: 'training_plan:index' }));
        var rows = (idx.data && idx.data.rows && typeof idx.data.rows === 'object') ? idx.data.rows : {};
        var ids = Object.keys(rows).filter(function (k) { return /^[0-9A-Za-z_-]{1,32}$/.test(k); });
        var docs = {};
        var miss = await missCount(ids, 3, async function (id) {
          var j = need(await post(t, { action: 'get', key: 'training_plan:' + id }));
          docs[id] = j.data == null ? null : j.data;
        });
        // 計画書を新しい保存先へ切り替えた後（GAS の応答に switched）は、Google の中身は写し返しの分だけ遅れていることがある（計画書の反証レビュー 指摘6）
        var lag = idx.switched === true ? '新しい保存先へ切り替えた後のため、Google の計画書は写し返しの分だけ遅れていることがあります（正本は新しい保存先）' : '';
        return { parts: { index: idx.data == null ? null : idx.data, plans: docs }, count: ids.length - miss, unit: '人分', note: [missNote(miss), lag].filter(Boolean).join('・') };
      } },
    { id: 'master', title: '入居者マスタ',
      read: async function (t) {
        var j = need(await post(t, { action: 'getRoster' }));
        var roster = Array.isArray(j.roster) ? j.roster : [];
        var recs = [];
        var miss = await missCount(roster, 4, async function (r) {
          var g = need(await post(t, { action: 'getResident', id: r.id }));
          if (g.record != null) recs.push(g.record);
        });
        return { parts: { roster: roster, residents: recs }, count: roster.length - miss, unit: '人', note: missNote(miss) };
      } },
    { id: 'haiben', title: '排泄ケア記録',
      read: async function (t) {
        var j = need(await post(t, { action: 'getAll' }));
        var parts = {}, n = 0;
        Object.keys(j).forEach(function (k) { if (k !== 'ok') parts[k] = j[k]; });
        if (Array.isArray(j.records)) n = j.records.length;
        /* 控えのシートへ移した古い記録（2026-10-28・排泄ケア記録の GAS が約200日より前の記録を RecordsArchive へ移す）も入れる。
           getAll は Records だけを返すので、getArchive をページ分けで読み、parts.archive に入れる。
           ★その口を知らない旧い GAS（'unknown action'）は控えのシートを持たない＝何も足さない。ほかの断りは系統ごと「入っていない」 */
        /* ★getAll と同じ id の記録が控えにもある時（読む間に移した・移している途中）は、getAll の方を残し控えの分は入れない。
           ★控えを読めなかった時（getAll は読めたのに断られた・通信の失敗）は、getAll の分だけを入れ「控えの分は入っていない」と書く */
        var arc = [], before = '', off = 0, total = 0, guard = 0, arcNote = '';
        var seenId = {};
        (Array.isArray(j.records) ? j.records : []).forEach(function (r) { if (r && r.id != null) seenId[String(r.id)] = 1; });
        try {
          do {
            var a = await post(t, { action: 'getArchive', offset: off, limit: 5000 });
            if (a && a.ok === false && typeof a.error === 'string' && a.error.indexOf('unknown action') === 0) { arc = null; break; }
            need(a);
            total = Number(a.total) || 0; before = a.archivedBefore || '';
            (Array.isArray(a.records) ? a.records : []).forEach(function (r) {
              if (!r || r.id == null || seenId[String(r.id)]) return;
              seenId[String(r.id)] = 1; arc.push(r);
            });
            off += 5000;
          } while (off < total && ++guard < 200);
        } catch (e) {
          arc = null; arcNote = '古い記録（控えのシート）は読めなかった（もう一度書き出すと読めることがある）';
        }
        if (arc) { parts.archive = arc; parts.archivedBefore = before; n += arc.length; }
        return { parts: parts, count: n, unit: '記録', note: arcNote };
      } },
    { id: 'weight', title: '体重管理',
      read: async function (t) {
        var j = need(await post(t, { action: 'getAll' }));
        var parts = {};   // 応答は ok の印のほかは全部残す（決め打ちの項目だけ拾うと、版の番号などを取りこぼす）
        Object.keys(j).forEach(function (k) { if (k !== 'ok') parts[k] = j[k]; });
        return { parts: parts, count: Array.isArray(j.records) ? j.records.length : 0, unit: '記録' };
      } },
    { id: 'geno', title: 'ジェノグラム（家族構成図）',
      read: async function (t) {
        var j = need(await post(t, { action: 'list' }));
        var items = Array.isArray(j.items) ? j.items : [];
        var docs = [];
        var miss = await missCount(items, 3, async function (it) {
          var g = need(await post(t, { action: 'get', name: it.name }));
          docs.push({ name: it.name, updatedAt: it.updatedAt, doc: g.doc == null ? null : g.doc });
        });
        return { parts: { list: items, docs: docs }, count: docs.length, unit: '枚', note: missNote(miss) };
      } },
    { id: 'analyzer', title: '過去シフト分析',
      read: async function (t) {
        var j = need(await post(t, { action: 'pull' }));
        var e = (j.entries && typeof j.entries === 'object') ? j.entries : {};
        return { parts: { entries: e }, count: Object.keys(e).length, unit: 'キー' };
      } }
  ];
  /* 読み口が無い・この画面から読まないもの（説明書きに載せる） */
  var NOT_INCLUDED = [
    '申送ビューア（申し送りの正本は Google のスプレッドシート。入居者ごとに抜き出す読み口だけで、全部を読む口が無い）',
    '薬学管理・職員マスタ・消耗品管理（接続設定に無い系統。それぞれの画面の書き出しを使う）',
    '入居調整の添付ファイル・不具合の報告先（受け付けるだけ）・タイミー通知・申送抽出・決裁箱（介護の記録ではない）',
    '統合同期・過去シフト分析の過去の版（今の版だけ。過去の版は Google ドライブの history に残っている）'
  ];

  async function readGas(onStep) {
    var out = [];
    for (var i = 0; i < GAS.length; i++) {
      var g = GAS[i], t = cfg(g.id);
      onStep(i + 1, GAS.length, g.title);
      if (!t.url || !RE_GAS.test(String(t.url)) || (!t.token && !t.tokenOptional)) {
        out.push({ id: g.id, title: g.title, ok: false, count: 0, note: 'この端末の接続設定に無い' });
        continue;
      }
      try {
        var r = await g.read(t);
        out.push({ id: g.id, title: g.title, ok: true, count: r.count, unit: r.unit, note: r.note || '', parts: r.parts });
      } catch (e) {
        out.push({ id: g.id, title: g.title, ok: false, count: 0,
                   note: e && e.refused ? '断られた（合言葉が違う・閲覧用の合言葉・サーバーの設定）' :
                         (e && e.name === 'AbortError' ? '時間切れ' : '通信できなかった') });
      }
    }
    return out;
  }

  function stamp(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* ZIP に入れるファイルを組む（純粋に組み立てるだけ。試験は check/unit/export_zip_test.js） */
  function buildFiles(b, data, gas, release) {
    var X = window.SUExport;
    var enc = new TextEncoder();
    var files = [];
    var tables = b.tables || [];
    var manifest = {
      kind: 'care-tools-export', version: 1,
      run_id: b.run_id, started_at: b.started_at, tenant_id: b.tenant_id, tenant_name: b.tenant_name, actor_email: b.actor_email,
      db: tables.map(function (t) { return { table: t.name, scope: t.scope, count: (data[t.name] || []).length, columns: (t.columns || []).map(function (c) { return c.name; }), hidden: t.hidden || [] }; }),
      gas: gas.map(function (g) { return { id: g.id, title: g.title, ok: g.ok, count: g.count, note: g.note || '' }; })
    };
    files.push({ name: 'README.txt', data: X.readme({
      tenantName: b.tenant_name, tenantId: b.tenant_id, startedAt: b.started_at, actorEmail: b.actor_email, runId: b.run_id,
      dbTotal: tables.reduce(function (s, t) { return s + (data[t.name] || []).length; }, 0),
      tables: tables.map(function (t) { return Object.assign({}, t, { count: (data[t.name] || []).length }); }),
      gas: gas.map(function (g) { return { title: g.title, ok: g.ok, count: g.count + (g.unit ? ' ' + g.unit : ''), note: g.note }; }),
      notIncluded: NOT_INCLUDED
    }) });
    files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
    tables.forEach(function (t) {
      var rows = data[t.name] || [];
      /* その場でバイト列にして文字列を手放す。release の時は行も手放す（本番の目安 約340MB の表で、持つ物を減らす） */
      files.push({ name: 'db/' + t.name + '.json', data: enc.encode(JSON.stringify(rows)) });
      files.push({ name: 'db/' + t.name + '.csv', data: enc.encode(X.csv(rows, (t.columns || []).map(function (c) { return c.name; }))) });
      if (release) data[t.name] = null;
    });
    gas.forEach(function (g) {
      if (!g.ok) return;
      files.push({ name: 'gas/' + g.id + '.json', data: JSON.stringify(g.parts) });
      Object.keys(g.parts).forEach(function (k) {
        if (!/^[A-Za-z0-9_-]+$/.test(k)) return;
        var rows = X.tableOf(g.parts[k]);
        if (rows && rows.length) files.push({ name: 'gas/' + g.id + '__' + k + '.csv', data: X.csv(rows) });
      });
    });
    return files;
  }

  function save(parts, name, type) {
    var url = URL.createObjectURL(new Blob(parts, { type: type || 'application/zip' }));
    var a = el('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function isField() {
    var role = 'office';
    try { role = localStorage.getItem('su_device_role') || 'office'; } catch (e) {}
    return role === 'field';
  }
  function encOn() { return !$('ex-enc-off').checked; }
  /* パスフレーズの欄を空にする（成功・失敗・取りやめのどれでも） */
  function clearPass() { $('ex-pass').value = ''; $('ex-pass2').value = ''; }
  function showMode() {
    var on = encOn();
    $('ex-enc-box').hidden = !on;
    $('ex-plain-box').hidden = on;
    if (!on) clearPass();
  }
  /* 合わせて 200 文字・前後の空白を除いて 5 文字以上（データベースの btrim と同じ数え方） */
  function reasonOf(v) {
    var r = String(v || '').replace(/^\s+|\s+$/g, '');
    var n = Array.from(r).length;
    return (n >= 5 && n <= 200) ? r : null;
  }
  /* 暗号の部品（su-export-crypt.js）とこの端末の crypto.subtle が使えるか。使えなければ null（例外を外に出さない） */
  function cryptOk() {
    try {
      var XC = window.SUExportCrypt;
      return (XC && typeof XC.available === 'function' && XC.available() && XC.MIN_PASS >= 8) ? XC : null;
    } catch (e) { return null; }
  }
  var NO_CRYPT = 'この端末のブラウザでは暗号化を扱えません（https で開いているか、ブラウザが新しいかを確かめてください）。';

  var busy = false;
  async function run() {
    if (busy) return;
    note('');
    if (isField()) {
      clearPass();
      note('この端末は「現場」の端末として設定されているため、書き出せません。事務所の PC で開いてください。');
      return;
    }
    var enc = encOn(), pass = null, reason = null, XC = null;
    if (enc) {
      /* 暗号の部品が使えるかは、データベースに何か頼む前に確かめる（読み込めていない・crypto.subtle が無い端末では始めない） */
      XC = cryptOk();
      if (!XC) { clearPass(); note(NO_CRYPT); return; }
      pass = $('ex-pass').value;
      var pass2 = $('ex-pass2').value;
      if (pass.length < XC.MIN_PASS) {
        pass = pass2 = null; clearPass();
        note('パスフレーズは ' + XC.MIN_PASS + ' 文字以上にしてください。');
        return;
      }
      if (pass !== pass2) {
        pass = pass2 = null; clearPass();
        note('2つのパスフレーズが一致しません。もう一度、両方に入れてください。');
        return;
      }
      pass2 = null;
    } else {
      reason = reasonOf($('ex-reason').value);
      if (reason == null) { note('暗号化しない理由を 5〜200 文字で書いてください（記録に残ります）。'); return; }
    }
    if (!confirm(enc ?
                 ('この事業者の全部のデータを、1つの ZIP にして暗号化し、この端末に保存します。\n\n' +
                  '中には入居者・ご家族・職員の個人情報が入ります。開くにはパスフレーズが要ります（忘れると開けません）。\n' +
                  '共有フォルダ・メール・チャットに置かず、使い終わったら消してください。\n\n書き出しますか？') :
                 ('この事業者の全部のデータを、1つの ZIP にしてこの端末に保存します。\n\n' +
                  'ZIP には入居者・ご家族・職員の個人情報がそのまま入り、鍵はかかりません。\n' +
                  '共有フォルダ・メール・チャットに置かず、使い終わったら消してください。\n\n書き出しますか？'))) {
      pass = null; clearPass();
      return;
    }
    busy = true;
    var btn = $('b-export');
    btn.disabled = true;
    try {
      var c = SUAuth.client();
      prog('データベースの表を数えています…');
      var rb = await c.rpc('export_begin', enc ? { p_encrypted: true } : { p_encrypted: false, p_plain_reason: reason });
      if (rb.error) {
        if (rb.error.code === '22023') throw new Error('reason');
        throw rb.error;
      }
      var b = rb.data, data = {}, tables = b.tables || [];
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i], rows = [], after = null;
        /* 続きは「最後に読んだ行の後」から（データベースが次の印 next を返す。1回は最大 2000 行・約 8MB） */
        for (var guard = 0; guard < 100000; guard++) {
          prog('データベース ' + (i + 1) + ' / ' + tables.length + ' 表（' + t.name + '・' + rows.length + ' / ' + t.count + ' 行）');
          var rp = await c.rpc('export_page', { p_run: b.run_id, p_table: t.name, p_after: after, p_limit: PAGE });
          if (rp.error) throw rp.error;
          var part = (rp.data && Array.isArray(rp.data.rows)) ? rp.data.rows : [];
          for (var q = 0; q < part.length; q++) rows.push(part[q]);
          after = rp.data ? rp.data.next : null;
          if (after == null) break;
        }
        data[t.name] = rows;
      }
      var gas = await readGas(function (n, all, title) { prog('Google ' + n + ' / ' + all + '（' + title + '）'); });
      prog('ZIP を作っています…');
      var started = new Date(b.started_at);
      var name = '全データ_' + stamp(isNaN(started) ? new Date() : started) + '.zip';
      /* ZIP は部分の並びのまま Blob にする（最後に1つの大きな配列へ写さない＝メモリを2倍にしない）。
         暗号化する時も、部品の並びを区切り（4MiB）ごとに暗号にして、暗号文の並びのまま Blob にする（全体をつながない）。
         su-export-crypt.js は読み終えた部品を手放すので、持つのはおよそ ZIP 1つ分＋区切り1つ分 */
      var got = window.SUExport.counts(data);   // 行を手放す前に数える
      var parts = window.SUExport.zipParts(buildFiles(b, data, gas, true), isNaN(started) ? new Date() : started);
      data = null;
      var size;
      if (enc) {
        prog('暗号化しています…');
        var sealed = await XC.encrypt(parts, pass);
        pass = null; parts = null;
        name = name + '.suenc';
        size = sealed.reduce(function (s2, p2) { return s2 + p2.length; }, 0);
        save(sealed, name, 'application/octet-stream');
        sealed = null;
      } else {
        size = parts.reduce(function (s2, p2) { return s2 + p2.length; }, 0);
        save(parts, name);
        parts = null;
      }
      var gasRec = {};
      gas.forEach(function (g) { gasRec[g.title] = { ok: g.ok, count: g.count, note: g.note || '' }; });
      var rf = await c.rpc('export_finish', { p_run: b.run_id, p_got: got, p_gas: gasRec, p_file: name });
      var gasOk = gas.filter(function (g) { return g.ok; }).length;
      var sum = 'データベース ' + tables.length + ' 表・' + Object.keys(got).reduce(function (s, k) { return s + got[k]; }, 0) + ' 行、Google ' +
                gasOk + ' / ' + gas.length + ' 系統（' + Math.round(size / 1024) + ' KB）';
      if (rf.error) {
        note('ZIP は保存しましたが、書き出しの記録の仕上げに失敗しました（始めた日時・人・件数は残っています）。' + sum, 'warn');
      } else if (rf.data && rf.data.match === false) {
        var diff = Object.keys(got).filter(function (k) { return b.tables.some(function (x) { return x.name === k && x.count !== got[k]; }); });
        note('「' + name + '」を保存しました。' + sum + '。書き出している間に増えた・減った行があります（' + diff.join('・') +
             '）。ZIP はそれぞれの表を読んだ時点の中身です。', 'warn');
      } else {
        note('「' + name + '」を保存しました。' + sum + (gasOk < gas.length ? '。入っていない Google の系統は ZIP の README.txt に理由があります' : ''), 'ok');
      }
    } catch (e) {
      note(e && e.message === 'reason' ? '暗号化しない理由を 5〜200 文字で書いてください（記録に残ります）。' : friendly(e));
    } finally {
      pass = null;
      clearPass();
      prog('');
      busy = false;
      btn.disabled = false;
      loadRuns();
    }
  }

  /* 暗号化した書き出しを開く（.suenc → 元の ZIP をこの端末に保存。データベース・GAS には触らない） */
  var dxBusy = false;
  function dxNote(text, kind) { var m = $('dx-msg'); m.className = 'msg ' + (kind || 'ng'); m.textContent = text || ''; }
  async function openSealed() {
    if (dxBusy) return;
    dxNote('');
    var passEl = $('dx-pass'), btn = $('b-decrypt');
    if (isField()) {
      passEl.value = '';
      dxNote('この端末は「現場」の端末として設定されているため、開けません。事務所の PC で開いてください。');
      return;
    }
    var XC = cryptOk();
    if (!XC) { passEl.value = ''; dxNote(NO_CRYPT); return; }
    var f = $('dx-file').files && $('dx-file').files[0];
    if (!f) { passEl.value = ''; dxNote('暗号化した書き出し（.suenc）のファイルを選んでください。'); return; }
    dxBusy = true;
    btn.disabled = true;
    var pass = passEl.value;
    try {
      /* 区切りごとに File.slice で読み、復号した区切りの並びのまま Blob にする（全体を一度に読まない・つながない） */
      var plain = await XC.decrypt(XC.fromBlob(f), pass);
      pass = null;
      var out = /\.suenc$/i.test(f.name) ? f.name.replace(/\.suenc$/i, '') : f.name + '.zip';
      save(plain, out);
      plain = null;
      dxNote('「' + out + '」を保存しました。使い終わったら消してください。', 'ok');
    } catch (e) {
      /* 文は su-export-crypt.js の決まった文だけ（値・パスフレーズは入らない） */
      var known = e && (e.code === 'magic' || e.code === 'short' || e.code === 'auth' || e.code === 'nocrypto');
      dxNote(known ? (/。$/.test(e.message) ? e.message : e.message + '。') : '開けませんでした。もう一度試してください。');
    } finally {
      pass = null;
      passEl.value = '';
      dxBusy = false;
      btn.disabled = false;
    }
  }

  /* これまでの書き出し（直近10回）。読めるのは管理者（aal2）だけ＝RLS */
  async function loadRuns() {
    var ul = $('ex-runs');
    var r = await SUAuth.client().from('export_runs')
      .select('id,started_at,actor_email,db_total,finished_at,gas_counts,file_name')
      .order('started_at', { ascending: false }).limit(10);
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    if (r.error) { ul.appendChild(el('li', 'muted', 'これまでの記録を読めませんでした。')); return; }
    if (!r.data || !r.data.length) { ul.appendChild(el('li', 'muted', 'まだ書き出していません。')); return; }
    r.data.forEach(function (x) {
      var li = el('li');
      var left = el('div');
      left.appendChild(el('div', 'nm', new Date(x.started_at).toLocaleString('ja-JP')));
      left.appendChild(el('div', 'em', x.actor_email));
      var g = x.gas_counts || {}, keys = Object.keys(g);
      var gOk = keys.filter(function (k) { return g[k] && g[k].ok; });
      left.appendChild(el('div', 'em', 'データベース ' + x.db_total + ' 行' +
        (x.finished_at ? '・Google ' + gOk.length + ' / ' + keys.length + ' 系統（' +
          gOk.reduce(function (s, k) { return s + (Number(g[k].count) || 0); }, 0) + ' 件）' : '')));
      li.appendChild(left);
      var tags = el('div', 'tags');
      tags.appendChild(el('span', 'tag', x.finished_at ? '保存まで済み' : '途中で止まった'));
      li.appendChild(tags);
      ul.appendChild(li);
    });
  }

  window.SUAccountsExport = {
    show: function () {
      $('sec-export').hidden = false;
      $('sec-decrypt').hidden = false;
      $('ex-enc-on').addEventListener('change', showMode);
      $('ex-enc-off').addEventListener('change', showMode);
      showMode();
      $('b-export').addEventListener('click', run);
      $('b-decrypt').addEventListener('click', openSealed);
      loadRuns();
    },
    _buildFiles: buildFiles, _GAS: GAS, _cfg: cfg
  };
})();
