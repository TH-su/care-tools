/*
 * shadow-check.js — 入居者マスタの写し（shadow-check.html）の動き。
 * 正本＝この端末の共有名簿（localStorage su_residents_common。入居者マスタが一覧を読むたびに書く）。
 * 写し＝Supabase の master_residents。読むだけで、どちらにも書かない。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var COMMON_KEY = 'su_residents_common';
  // 共有名簿に載っている項目だけを見比べる（生年月日・更新日時は共有名簿に無いので対象外）
  var CMP = [
    ['name', '氏名'], ['kana', 'かな'], ['room', '居室'], ['gender', '性別'], ['care_level', '介護度'],
    ['active', '在籍'], ['hospitalized', '入院中'], ['discharge_date', '退居日'], ['height', '身長'],
    ['target_apps', '対象アプリ']
  ];

  function msg(text, kind) { var m = $('msg'); m.className = 'msg ' + (kind || 'ng'); m.textContent = text || ''; }
  function view(name) {
    $('v-loading').hidden = name !== 'loading';
    $('v-gate').hidden = name !== 'gate';
    $('v-main').hidden = name !== 'main';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ymd(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)) ? String(v) : null; }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 共有名簿の1人 → 見比べ用の形（写しと同じ決まり: 入院中は配られた時だけ・退居日は退居者だけ） */
  function fromCommon(r) {
    return {
      source_id: String(r.masterId == null ? '' : r.masterId).trim(),
      name: String(r.name || ''), kana: String(r.kana || ''), room: String(r.room || ''),
      gender: String(r.gender || ''), care_level: String(r.careLevel || ''),
      active: r.active !== false,
      hospitalized: Object.prototype.hasOwnProperty.call(r, 'hospitalized') ? !!r.hospitalized : null,
      discharge_date: r.active === false ? ymd(r.dischargeDate) : null,
      height: String(r.height || ''),
      target_apps: Array.isArray(r.targetApps) ? r.targetApps.map(String) : null
    };
  }
  function eq(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || null) === JSON.stringify(b || null);
    return (a == null ? null : a) === (b == null ? null : b);
  }

  function readCommon() {
    try {
      var o = JSON.parse(localStorage.getItem(COMMON_KEY) || 'null');
      return o && Array.isArray(o.residents) ? o : null;
    } catch (e) { return null; }
  }

  function kpi(label, value, unit) {
    var d = el('div', 'kpi');
    d.appendChild(el('div', 'lb', label));
    var v = el('div', 'v', String(value));
    if (unit) v.appendChild(el('span', 'u', unit));
    d.appendChild(v);
    return d;
  }

  function renderCompare(copy) {
    var common = readCommon();
    var list = $('cmp-list'), kpis = $('cmp-kpis'), verdict = $('cmp-verdict');
    list.replaceChildren(); kpis.replaceChildren();
    if (!common) {
      $('cmp-src').textContent = 'この端末には入居者マスタの一覧がまだありません。この端末で入居者マスタを開くと見比べられます。';
      kpis.appendChild(kpi('写しの人数', copy.length, '人'));
      verdict.className = 'msg warn';
      verdict.textContent = '見比べる正本がこの端末にありません。';
      return;
    }
    $('cmp-src').textContent = '正本＝この端末の入居者マスタが ' + fmtTime(common.updatedAt) + ' に読んだ一覧';
    var byId = {};
    copy.forEach(function (c) { byId[c.source_id] = c; });
    var same = 0, diff = [], notInCopy = [], seen = {};
    common.residents.forEach(function (r) {
      var s = fromCommon(r);
      if (!s.source_id) return;
      seen[s.source_id] = true;
      var c = byId[s.source_id];
      if (!c) { notInCopy.push(s); return; }
      var fields = CMP.filter(function (f) { return !eq(s[f[0]], c[f[0]]); }).map(function (f) { return f[1]; });
      if (fields.length) diff.push({ s: s, fields: fields }); else same++;
    });
    var notInSource = copy.filter(function (c) { return !seen[c.source_id]; });

    kpis.appendChild(kpi('一致', same, '人'));
    kpis.appendChild(kpi('違いあり', diff.length, '人'));
    kpis.appendChild(kpi('写しに無い', notInCopy.length, '人'));
    kpis.appendChild(kpi('正本に無い', notInSource.length, '人'));

    var bad = diff.length + notInCopy.length + notInSource.length;
    verdict.className = 'msg ' + (bad ? 'warn' : 'ok');
    verdict.textContent = bad
      ? '違いがあります。入居者マスタを開き直すと写しが最新になります。開き直しても残る違いは、下の一覧を確かめてください。'
      : '正本と写しは一致しています。';

    diff.forEach(function (d) { list.appendChild(item(d.s, '違う項目: ' + d.fields.join('・'))); });
    notInCopy.forEach(function (s) { list.appendChild(item(s, '写しにまだありません')); });
    notInSource.forEach(function (c) { list.appendChild(item(c, '正本（この端末の一覧）にいません')); });
  }
  function item(r, note) {
    var li = el('li');
    var left = el('div');
    left.appendChild(el('div', 'nm', (r.room ? r.room + '　' : '') + (r.name || '（氏名なし）')));
    left.appendChild(el('div', 'em', '利用者No ' + r.source_id + '　' + note));
    li.appendChild(left);
    return li;
  }

  function renderRuns(runs) {
    var ul = $('runs');
    ul.replaceChildren();
    if (!runs.length) { ul.appendChild(el('li', 'muted', 'まだ記録がありません。事務所・管理者として入居者マスタを開くと記録されます。')); return; }
    runs.forEach(function (r) {
      var li = el('li');
      var left = el('div');
      left.appendChild(el('div', 'nm', fmtTime(r.at) + (r.device_label ? '　' + r.device_label : '')));
      left.appendChild(el('div', 'em', '正本 ' + r.source_count + '人／新規 ' + r.inserted + '・更新 ' + r.updated +
        '・変化なし ' + r.unchanged + '・正本に無い ' + r.missing + (r.failed ? '・失敗 ' + r.failed : '')));
      li.appendChild(left);
      if (r.failed) { var t = el('div', 'ops'); t.appendChild(el('span', 'tag', '要確認')); li.appendChild(t); }
      ul.appendChild(li);
    });
  }

  /* 並びに左右されない比べ方（オブジェクトのキーを並べ替えてから文字列にする） */
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  function countEvents(d) {
    var n = 0;
    ((d && d.residents) || []).forEach(function (r) { n += (r && Array.isArray(r.events)) ? r.events.length : 0; });
    return n;
  }
  async function loadKv(sb) {
    var kk = $('kv-kpis'), kv = $('kv-verdict');
    kk.replaceChildren();
    var t0 = performance.now();
    var r = await sb.rpc('kv_get', { p_key: 'care_schedule_v2' });
    var ms = Math.round(performance.now() - t0);
    if (r.error) throw r.error;
    var remote = r.data || {};
    var local = null, localRev = 0, dirty = false;
    try { local = JSON.parse(localStorage.getItem('care_schedule_v2') || 'null'); } catch (e) { local = null; }
    try { localRev = (JSON.parse(localStorage.getItem('ws_sync_revs') || '{}').care) || 0; } catch (e) { localRev = 0; }
    try { dirty = !!localStorage.getItem('care_schedule_dirty_v1'); } catch (e) { dirty = false; }
    var rd = remote.data;
    kk.appendChild(kpi('写しの版', remote.rev || 0));
    kk.appendChild(kpi('この端末の版', localRev));
    kk.appendChild(kpi('写しの人数・予定', (rd && rd.residents ? rd.residents.length : 0) + '人・' + countEvents(rd), '件'));
    kk.appendChild(kpi('写しを読む時間', ms, 'ミリ秒'));
    if (!rd) {
      kv.className = 'msg warn';
      kv.textContent = 'まだ写しがありません。事務所・管理者として週間計画を開くと、数秒後に写されます。';
    } else if (!local) {
      kv.className = 'msg warn';
      kv.textContent = 'この端末には週間計画のデータがありません。この端末で週間計画を開くと見比べられます。';
    } else if (dirty) {
      kv.className = 'msg warn';
      kv.textContent = 'この端末の週間計画に未送信の変更があるため、正しく見比べられません。週間計画で保存してから見比べ直してください。';
    } else if (localRev === remote.rev && JSON.stringify(canon(local)) === JSON.stringify(canon(rd))) {
      kv.className = 'msg ok';
      kv.textContent = '週間計画の写しは、この端末の最新の版と一致しています。';
    } else if (localRev === remote.rev) {
      kv.className = 'msg warn';
      kv.textContent = '版は同じですが中身に違いがあります（この端末だけの表示用の値の可能性があります）。続く場合は管理者に知らせてください。';
    } else {
      kv.className = 'msg warn';
      kv.textContent = '版が違います（写し ' + (remote.rev || 0) + '／この端末 ' + localRev + '）。週間計画を開き直すと、数秒後に写しが最新になります。';
    }
  }

  async function load() {
    var sb = SUAuth.client();
    var cols = 'source_id,' + SUMasterShadow.FIELDS.join(',');
    var a = await sb.from('master_residents').select(cols).order('room', { ascending: true });
    if (a.error) throw a.error;
    var b = await sb.from('master_sync_runs').select('at,device_label,source_count,inserted,updated,unchanged,missing,failed')
      .order('at', { ascending: false }).limit(20);
    if (b.error) throw b.error;
    renderCompare(a.data || []);
    renderRuns(b.data || []);
    try { await loadKv(sb); }
    catch (e) {
      // 週間計画の写しの表（0005）がまだ無い時も、入居者マスタの見比べは使えるようにする
      $('kv-verdict').className = 'msg warn';
      $('kv-verdict').textContent = '週間計画の写しはまだ読めません（データベースの準備 0005 が未適用の可能性）。';
    }
  }

  async function start() {
    view('loading');
    var st;
    try { st = await SUAuth.check(); } catch (e) { st = { status: 'error', message: String(e && e.message || e) }; }
    if (st.status !== SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
      if (st.status === SUAuth.STATUS.OK) $('gate-why').textContent = 'このアカウント（現場）では開けません。事務所または管理者のアカウントでログインしてください。';
      else if (st.status === SUAuth.STATUS.ERROR) $('gate-why').textContent = st.message || '確かめられませんでした。';
      view('gate');
      return;
    }
    try {
      await load();
      view('main');
    } catch (e) {
      $('gate-why').textContent = '読み込めませんでした: ' + String(e && e.message || e);
      view('gate');
    }
  }
  $('b-reload').addEventListener('click', function () { msg(''); load().catch(function (e) { msg(String(e && e.message || e)); }); });
  start();
})();
