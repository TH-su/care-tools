/* perf-report.html の処理（2026-10-09 に HTML から分けた・監査10月版 #16）。中身は分ける前と同じ
   2026-10-17: Supabase と JSON の通信も数える（su-perf.js の記録の版 2）。「使えるまで」の列と通信回数の内訳を足した
   2026-10-24: 見えている時／裏にある時の回数（記録の版 3）。GAS の種類ごと・JSON のファイルごと・分類ごとの合計の表と、CSV の末尾の列を足した。
               既存の表・列・目安は変えていない。版 3 より前の記録は新しい表に数えない（項目が無いため）
   2026-10-27: 「黙って失敗した回数（この端末）」の表を足した（su-perf.js が入れ物 silent に数えた分・本人指示）。
               入れ物を足すため IndexedDB を版 2 で開く（su-perf.js と同じ版）。「この端末の記録を消す」は silent も消す。
               期間の選択・コピー・CSV には入れていない（最初に数え始めてからの累計を表に出すだけ） */
(function () {
  'use strict';
  var DB = 'su_perf', STORE = 'views', DB_VER = 2, SILENT = 'silent';
  var NAMES = {
    'index.html': 'メニュー', 'shift-app.html': 'シフト', 'work-schedule.html': 'ワークスケジュール',
    'shift-analyzer.html': '過去シフト分析', 'staff-master.html': '職員マスタ', 'weight-record.html': '体重管理',
    'care-schedule.html': '週間計画', 'daycare-roster.html': 'デイ利用表', 'visit-overview.html': '週間計画俯瞰',
    'support-overview.html': '全支援俯瞰', 'overview-compare.html': '左右比較', 'facesheet.html': 'フェイスシート',
    'genogram.html': 'ジェノグラム', 'resident-master.html': '入居者マスタ', 'patch-calendar.html': '貼り薬カレンダー',
    'moushiokuri-viewer.html': '申送ビューア', 'admission-flow.html': '入居調整', 'training-plan.html': '個別機能訓練計画書',
    'supplies.html': '消耗品管理', 'connection-settings.html': '接続設定'
  };
  /* 目安（秒）。画面が出るまで 2秒／通信が終わるまで 3秒を超えると「待たされている」と感じやすい */
  var TH = { dcl: [1.0, 2.0], done: [1.5, 3.0], one: [1.0, 2.0], tbt: [0.3, 1.0] };

  var all = [], silentAll = [], dbBlocked = false;
  var $ = function (id) { return document.getElementById(id); };

  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('on'); }, 3000);
  }
  /* 版 2 で開く（2026-10-27）。版を上げる時は入れ物を足すだけ（views の記録は消えない）。
     古い版で開いたままのタブがあって待たされた時は、空の結果で描き、その旨を出す（閉じてから開き直せば読める） */
  function openDb(cb, fail) {
    var req = indexedDB.open(DB, DB_VER);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SILENT)) db.createObjectStore(SILENT, { keyPath: 'k' });
    };
    req.onblocked = function () { dbBlocked = true; fail(); };
    req.onerror = function () { fail(); };
    req.onsuccess = function () {
      var db = req.result;
      try { db.onversionchange = function () { try { db.close(); } catch (e) {} }; } catch (e) {}
      cb(db);
    };
  }
  function getAll(db, name) {
    return new Promise(function (resolve) {
      try {
        if (!db.objectStoreNames.contains(name)) return resolve([]);
        var g = db.transaction(name, 'readonly').objectStore(name).getAll();
        g.onsuccess = function () { resolve(g.result || []); };
        g.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }
  function load() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve({ rows: [], silent: [] });
      var done = false;
      var fin = function (v) { if (!done) { done = true; resolve(v); } };
      openDb(function (db) {
        Promise.all([getAll(db, STORE), getAll(db, SILENT)]).then(function (r) { fin({ rows: r[0], silent: r[1] }); });
      }, function () { fin({ rows: [], silent: [] }); });
    });
  }
  function clearAll() {
    return new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (!done) { done = true; resolve(); } };
      openDb(function (db) {
        try {
          var names = [STORE];
          if (db.objectStoreNames.contains(SILENT)) names.push(SILENT);
          var tx = db.transaction(names, 'readwrite');
          names.forEach(function (n) { tx.objectStore(n).clear(); });
          tx.oncomplete = fin;
          tx.onerror = fin;
        } catch (e) { fin(); }
      }, fin);
    });
  }

  function q(arr, p) {                        /* 分位点（p=0.5 中央値, 0.9 遅い時） */
    var a = arr.filter(function (v) { return typeof v === 'number' && isFinite(v); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }
  function sec(ms) { return ms == null ? null : ms / 1000; }
  function fmt(v, d) { return v == null ? '—' : v.toFixed(d == null ? 1 : d); }
  function level(v, th) { if (v == null || !th) return ''; return v >= th[1] ? 'ng' : (v >= th[0] ? 'warn' : ''); }
  function cell(v, th, d) {
    var lv = level(v, th);
    var tag = lv === 'ng' ? '<span class="tag">遅</span>' : (lv === 'warn' ? '<span class="tag">注</span>' : '');
    return '<td' + (lv ? ' class="lv-' + lv + '"' : '') + '>' + fmt(v, d) + tag + '</td>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function pct(n, d) { return d ? Math.round(n * 100 / d) + '%' : '—'; }
  function mode(arr) {
    var c = {}, best = '', n = 0;
    arr.forEach(function (v) { if (!v) return; c[v] = (c[v] || 0) + 1; if (c[v] > n) { n = c[v]; best = v; } });
    return best;
  }

  /* 読み込み完了＝起動時の通信すべての最後（netDone）。それが無い旧記録（2026-10-17 より前）は GAS だけの gasDone */
  function doneOf(r) { return r.netDone != null ? r.netDone : r.gasDone; }
  /* 起動時の通信の回数。Supabase・JSON は数え始める前の記録（明細の欄が無い）では null＝内訳を空にする */
  function cntOf(list) { return Array.isArray(list) ? list.length : null; }
  function cntText(a) {
    if (a.netCnt == null) return '—';
    var part = function (v) { return v == null ? '—' : Math.round(v); };
    return Math.round(a.netCnt) + '（' + part(a.gasCnt) + '/' + part(a.sbCnt) + '/' + part(a.jsonCnt) + '）';
  }

  function filtered() {
    var days = Number($('range').value);
    if (!days) return all.slice();
    var from = Date.now() - days * 86400000;
    return all.filter(function (r) { return r.t >= from; });
  }

  /* ── 見えている時／裏にある時（記録の版 3・2026-10-24）──
     画面を閉じるまでの合計（vis）・GAS の種類ごと（gasAct）・JSON のファイルごと（jsonF）を、アプリごとに足し合わせる。
     名前（アプリ・種類・ファイル）を鍵にするので、Object.create(null) の入れ物で数える（__proto__ などの名前でも壊れない） */
  var CATS = [['gas', 'GAS'], ['sb', 'Supabase'], ['json', '同じサイトの JSON'], ['ext', 'CDN など']];
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }
  function hasVis(r) { return !!(r && r.vis && typeof r.vis === 'object'); }
  function visSummary(rows) {
    var apps = Object.create(null), kinds = Object.create(null), files = Object.create(null);
    function addKind(box, app, name, k) {
      if (typeof name !== 'string' || !name) return;
      var key = app + '\u0001' + name;
      var o = box[key] || (box[key] = { app: app, name: NAMES[app] || app, k: name, v: 0, h: 0 });
      o.v += num(k.v); o.h += num(k.h);
    }
    rows.forEach(function (r) {
      if (!hasVis(r)) return;
      var a = apps[r.app] || (apps[r.app] = { app: r.app, name: NAMES[r.app] || r.app, n: 0, cats: {} });
      a.n++;
      CATS.forEach(function (c) {
        var o = r.vis[c[0]] || {};
        var t = a.cats[c[0]] || (a.cats[c[0]] = { vN: 0, vMs: 0, hN: 0, hMs: 0 });
        t.vN += num(o.vN); t.vMs += num(o.vMs); t.hN += num(o.hN); t.hMs += num(o.hMs);
      });
      (Array.isArray(r.gasAct) ? r.gasAct : []).forEach(function (k) { if (k) addKind(kinds, r.app, k.a, k); });
      (Array.isArray(r.jsonF) ? r.jsonF : []).forEach(function (k) { if (k) addKind(files, r.app, k.f, k); });
    });
    function list(box) {
      return Object.keys(box).map(function (k) { return box[k]; })
        .sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : (y.v + y.h) - (x.v + x.h); });
    }
    var appList = Object.keys(apps).map(function (k) { return apps[k]; })
      .sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
    return { n: appList.reduce(function (s, a) { return s + a.n; }, 0), apps: appList, kinds: list(kinds), files: list(files) };
  }

  /* SILENT_REPORT_BEGIN 「黙って失敗した回数」の表の行（check/unit/ws_silent_note_test.js が印の間を切り出して試す）。
     入れ物 silent の記録 [{k, app, where, n, last}] を、アプリの名前・回数の多い順に並べ、表に出す文字にする。
     形の合わない記録は飛ばす。表示は textContent で入れる（ここでは文字を作るだけ） */
  function silentTime(t) {
    if (typeof t !== 'number' || !isFinite(t)) return '—';
    var d = new Date(t), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function silentRows(list, names) {
    names = names || {};
    return (Array.isArray(list) ? list : []).filter(function (r) {
      return r && typeof r.app === 'string' && typeof r.where === 'string' && typeof r.n === 'number' && isFinite(r.n) && r.n > 0;
    }).map(function (r) {
      var nm = Object.prototype.hasOwnProperty.call(names, r.app) ? names[r.app] : r.app;
      return { app: nm, where: r.where, n: Math.floor(r.n), last: silentTime(r.last), t: typeof r.last === 'number' ? r.last : 0 };
    }).sort(function (a, b) {
      return a.app < b.app ? -1 : a.app > b.app ? 1 : (b.n - a.n) || (b.t - a.t);
    }).map(function (r) { return [r.app, r.where, String(r.n), r.last]; });
  }
  /* SILENT_REPORT_END */

  function summarize(rows) {
    var by = {};
    rows.forEach(function (r) { (by[r.app] = by[r.app] || []).push(r); });
    var apps = Object.keys(by).map(function (app) {
      var rs = by[app];
      var ones = [];
      rs.forEach(function (r) { (r.gas || []).forEach(function (g) { ones.push(g.d); }); });
      var xf = rs.filter(function (r) { return r.xfer; });
      return {
        app: app, name: NAMES[app] || app, n: rs.length,
        dcl50: sec(q(rs.map(function (r) { return r.dcl; }), 0.5)),
        dcl90: sec(q(rs.map(function (r) { return r.dcl; }), 0.9)),
        ready50: sec(q(rs.map(function (r) { return r.ready; }), 0.5)),
        netCnt: q(rs.map(function (r) { return (r.gas || []).length + (r.sb || []).length + (r.json || []).length; }), 0.5),
        gasCnt: q(rs.map(function (r) { return (r.gas || []).length; }), 0.5),
        sbCnt: q(rs.map(function (r) { return cntOf(r.sb); }), 0.5),
        jsonCnt: q(rs.map(function (r) { return cntOf(r.json); }), 0.5),
        done50: sec(q(rs.map(doneOf), 0.5)),
        done90: sec(q(rs.map(doneOf), 0.9)),
        one50: sec(q(ones, 0.5)),
        tbt50: sec(q(rs.map(function (r) { return r.tbt; }), 0.5)),
        kb: q(rs.map(function (r) { return r.htmlKB; }), 0.5),
        full: xf.length ? pct(xf.filter(function (r) { return r.xfer === 'full'; }).length, xf.length) : '—',
        worst: Math.max(q(rs.map(doneOf), 0.5) || 0, q(rs.map(function (r) { return r.dcl; }), 0.5) || 0)
      };
    }).sort(function (a, b) { return b.worst - a.worst; });

    var eps = {};
    rows.forEach(function (r) { (r.gas || []).forEach(function (g) { (eps[g.ep] = eps[g.ep] || []).push(g.d); }); });
    /* Supabase は呼んだ関数の名前、同じサイトの JSON はファイル名で並べる（2026-10-17） */
    rows.forEach(function (r) { (r.sb || []).forEach(function (g) { var k = 'SB:' + g.ep; (eps[k] = eps[k] || []).push(g.d); }); });
    rows.forEach(function (r) { (r.json || []).forEach(function (g) { var k = 'JSON:' + g.f; (eps[k] = eps[k] || []).push(g.d); }); });
    var epList = Object.keys(eps).map(function (ep) {
      var d = eps[ep];
      return { ep: ep, n: d.length, p50: sec(q(d, 0.5)), p90: sec(q(d, 0.9)), max: sec(Math.max.apply(null, d)) };
    }).sort(function (a, b) { return (b.p50 || 0) - (a.p50 || 0); });

    var allOnes = [];
    rows.forEach(function (r) { (r.gas || []).forEach(function (g) { allOnes.push(g.d); }); });
    return {
      apps: apps, eps: epList, n: rows.length, vis: visSummary(rows),
      dcl50: sec(q(rows.map(function (r) { return r.dcl; }), 0.5)),
      done50: sec(q(rows.map(doneOf), 0.5)),
      one50: sec(q(allOnes, 0.5)),
      dev: mode(rows.map(function (r) { return r.dev; })),
      role: mode(rows.map(function (r) { return r.role; })),
      conn: mode(rows.map(function (r) { return r.conn; })),
      from: rows.length ? Math.min.apply(null, rows.map(function (r) { return r.t; })) : null,
      to: rows.length ? Math.max.apply(null, rows.map(function (r) { return r.t; })) : null
    };
  }

  function d8(t) {
    if (!t) return '';
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function roleName(r) { return r === 'field' ? '現場用' : (r === 'office' ? '事務所用' : '不明'); }

  function render() {
    var rows = filtered();
    var s = summarize(rows);
    $('kpis').innerHTML =
      kpi('記録した回数', s.n, '回') +
      kpi('画面が出るまで（中央値）', fmt(s.dcl50), '秒') +
      kpi('読み込みが終わるまで（中央値）', fmt(s.done50), '秒') +
      kpi('通信1回（中央値）', fmt(s.one50), '秒');
    $('meta').textContent = s.n
      ? '端末: ' + (s.dev || '不明') + '（' + roleName(s.role) + '）' + (s.conn ? '・回線の目安: ' + s.conn : '') +
        '　期間: ' + d8(s.from) + '〜' + d8(s.to)
      : 'まだ記録がありません。アプリを何回か開いてから、もう一度この画面を開いてください。';

    if (!s.apps.length) {
      $('tApp').innerHTML = '<tr><td class="empty" colspan="12">記録がありません</td></tr>';
    } else {
      $('tApp').innerHTML =
        '<thead><tr><th>アプリ</th><th>回数</th><th>画面が出るまで<br>中央値</th><th>遅い時</th>' +
        '<th>使えるまで<br>中央値</th>' +
        '<th>起動時の<br>通信回数<br>(GAS/SB/JSON)</th><th>読み込み完了<br>中央値</th><th>遅い時</th><th>通信1回<br>中央値</th>' +
        '<th>固まり<br>中央値</th><th>画面ファイル<br>大きさ(KB)</th><th>丸ごと<br>取り直し</th></tr></thead><tbody>' +
        s.apps.map(function (a) {
          return '<tr><td>' + esc(a.name) + '</td><td>' + a.n + '</td>' +
            cell(a.dcl50, TH.dcl) + cell(a.dcl90, TH.dcl) + cell(a.ready50, null) +
            '<td>' + cntText(a) + '</td>' +
            cell(a.done50, TH.done) + cell(a.done90, TH.done) + cell(a.one50, TH.one) +
            cell(a.tbt50, TH.tbt) +
            '<td>' + (a.kb == null ? '—' : Math.round(a.kb)) + '</td><td>' + a.full + '</td></tr>';
        }).join('') + '</tbody>';
    }
    $('tEp').innerHTML = s.eps.length
      ? '<thead><tr><th>接続先</th><th>回数</th><th>中央値</th><th>遅い時</th><th>最長</th></tr></thead><tbody>' +
        s.eps.map(function (e) {
          return '<tr><td>' + esc(e.ep) + '</td><td>' + e.n + '</td>' + cell(e.p50, TH.one) + cell(e.p90, TH.one) + cell(e.max, null) + '</tr>';
        }).join('') + '</tbody>'
      : '<tr><td class="empty">記録がありません</td></tr>';
    renderVis(s.vis);
    renderSilent();
    return s;
  }
  /* 見えている時／裏にある時の3つの表（2026-10-24） */
  function renderVis(vs) {
    var none = '<tr><td class="empty">記録がありません（2026-10-24 の更新より後に記録した分だけを数えます）</td></tr>';
    $('tKind').innerHTML = vs.kinds.length
      ? '<thead><tr><th>アプリ</th><th>GAS の種類</th><th>見えている時<br>回数</th><th>裏にある時<br>回数</th></tr></thead><tbody>' +
        vs.kinds.map(function (k) {
          return '<tr><td>' + esc(k.name) + '</td><td>' + esc(k.k) + '</td><td>' + k.v + '</td><td>' + k.h + '</td></tr>';
        }).join('') + '</tbody>'
      : none;
    $('tFile').innerHTML = vs.files.length
      ? '<thead><tr><th>アプリ</th><th>ファイル</th><th>見えている時<br>回数</th><th>裏にある時<br>回数</th></tr></thead><tbody>' +
        vs.files.map(function (k) {
          return '<tr><td>' + esc(k.name) + '</td><td>' + esc(k.k) + '</td><td>' + k.v + '</td><td>' + k.h + '</td></tr>';
        }).join('') + '</tbody>'
      : none;
    var catRows = [];
    vs.apps.forEach(function (a) {
      CATS.forEach(function (c) {
        var t = a.cats[c[0]];
        if (!t || (!t.vN && !t.hN)) return;          /* 1回も無い分類は行を出さない */
        catRows.push('<tr><td>' + esc(a.name) + '</td><td>' + a.n + '</td><td>' + esc(c[1]) + '</td>' +
          '<td>' + t.vN + '</td><td>' + fmt(sec(t.vMs)) + '</td><td>' + t.hN + '</td><td>' + fmt(sec(t.hMs)) + '</td></tr>');
      });
    });
    $('tVis').innerHTML = catRows.length
      ? '<thead><tr><th>アプリ</th><th>記録した<br>回数</th><th>分類</th><th>見えている時<br>回数</th><th>見えている時<br>合計秒</th>' +
        '<th>裏にある時<br>回数</th><th>裏にある時<br>合計秒</th></tr></thead><tbody>' + catRows.join('') + '</tbody>'
      : none;
  }
  /* 黙って失敗した回数の表（2026-10-27）。文字はすべて textContent で入れる */
  function renderSilent() {
    var tb = $('tSilent');
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    var rows = silentRows(silentAll, NAMES);
    var td = function (tr, tag, text) { var c = document.createElement(tag); c.textContent = text; tr.appendChild(c); return c; };
    if (!rows.length) {
      var tr0 = document.createElement('tr');
      var c0 = td(tr0, 'td', dbBlocked ? 'ほかのタブで開いている画面があるため読めませんでした。ほかのタブを閉じてから、この画面を開き直してください'
        : '記録がありません（2026-10-27 の更新より後に数えた分だけを出します）');
      c0.className = 'empty';
      tb.appendChild(tr0);
      return;
    }
    var th = document.createElement('thead'), hr = document.createElement('tr');
    ['アプリ', '場所', '回数', '最後の時刻'].forEach(function (h) { td(hr, 'th', h); });
    th.appendChild(hr); tb.appendChild(th);
    var body = document.createElement('tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      r.forEach(function (v) { td(tr, 'td', v); });
      body.appendChild(tr);
    });
    tb.appendChild(body);
  }
  function kpi(lb, v, u) {
    return '<div class="kpi"><div class="lb">' + esc(lb) + '</div><div class="v">' + esc(v) + '<span class="u">' + esc(u) + '</span></div></div>';
  }

  /* 送ってもらう文章。表計算に貼っても崩れないようタブ区切りにする */
  function asText(s) {
    var L = [];
    L.push('【動作の速さの記録】端末: ' + (s.dev || '不明') + '（' + roleName(s.role) + '）' +
      (s.conn ? ' 回線:' + s.conn : '') + ' 期間: ' + d8(s.from) + '〜' + d8(s.to) + ' 記録' + s.n + '回');
    L.push('全体 中央値: 画面' + fmt(s.dcl50) + '秒 / 読込完了' + fmt(s.done50) + '秒 / 通信1回' + fmt(s.one50) + '秒');
    L.push(['アプリ', '回数', '画面50%', '画面90%', '起動通信数(GAS/SB/JSON)', '読込50%', '読込90%', '通信1回', '固まり', 'KB', '丸ごと', '使える50%'].join('\t'));
    s.apps.forEach(function (a) {
      L.push([a.name, a.n, fmt(a.dcl50), fmt(a.dcl90), a.netCnt == null ? '' : cntText(a),
        fmt(a.done50), fmt(a.done90), fmt(a.one50), fmt(a.tbt50), a.kb == null ? '' : Math.round(a.kb), a.full, fmt(a.ready50)].join('\t'));
    });
    L.push(['接続先', '回数', '50%', '90%', '最長'].join('\t'));
    s.eps.forEach(function (e) { L.push([e.ep, e.n, fmt(e.p50), fmt(e.p90), fmt(e.max)].join('\t')); });
    return L.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function csv(rows) {
    var head = ['日時', 'アプリ', '端末', '用途', '回線', '開き方', '画面KB', '取得', '応答開始ms', '画面ms', '読込完了ms',
      '起動時通信数', '通信合計回数', '通信合計ms', '固まりms', '使えるまでms', '通信明細(開始ms:所要ms:接続先)',
      'Supabase合計回数', 'Supabase合計ms', 'JSON合計回数', 'JSON合計ms', '全通信の読込完了ms', '記録の版'];
    /* 2026-10-24: 見えている時／裏にある時の列を末尾に足す（既存の列の位置は変えない）。版 3 より前の記録は空欄 */
    var CSV_CAT = { gas: 'GAS', sb: 'Supabase', json: 'JSON', ext: 'CDN等' };
    CATS.forEach(function (c) {
      var p = CSV_CAT[c[0]];
      head.push(p + '見えている時回数', p + '見えている時ms', p + '裏にある時回数', p + '裏にある時ms');
    });
    head.push('GASの種類(種類:見えている時:裏にある時)', 'JSONのファイル(ファイル:見えている時:裏にある時)');
    var out = [head.join(',')];
    rows.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (r) {
      var d = new Date(r.t);
      var ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      var det = (r.gas || []).map(function (g) { return g.s + ':' + g.d + ':' + g.ep; }).join(' ');
      var cols = [ts, NAMES[r.app] || r.app, r.dev, roleName(r.role), r.conn || '', r.nav || '', v(r.htmlKB), r.xfer || '',
        v(r.ttfb), v(r.dcl), v(r.gasDone), (r.gas || []).length, v(r.gasN), v(r.gasMs), v(r.tbt), v(r.ready), det,
        v(r.sbN), v(r.sbMs), v(r.jsonN), v(r.jsonMs), v(r.netDone), v(r.v)];
      CATS.forEach(function (c) {
        var o = hasVis(r) ? (r.vis[c[0]] || {}) : null;
        cols.push(o ? num(o.vN) : '', o ? num(o.vMs) : '', o ? num(o.hN) : '', o ? num(o.hMs) : '');
      });
      var kindText = function (arr, key) {
        return Array.isArray(arr) ? arr.filter(function (k) { return k && typeof k[key] === 'string'; })
          .map(function (k) { return k[key] + ':' + num(k.v) + ':' + num(k.h); }).join(' ') : '';
      };
      cols.push(hasVis(r) ? kindText(r.gasAct, 'a') : '', hasVis(r) ? kindText(r.jsonF, 'f') : '');
      out.push(cols.map(csvCell).join(','));
    });
    return '﻿' + out.join('\r\n');     /* BOM 付き＝Excel で文字化けしない */
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function v(x) { return x == null ? '' : x; }
  /* 表計算が数式として実行する先頭文字を無害化する（職員マスタ・消耗品の CSV と同じ扱い） */
  function csvCell(x) {
    var s = String(x == null ? '' : x);
    if (/^[=+\-@\t\r＝＋－＠]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $('range').addEventListener('change', render);
  $('copy').addEventListener('click', function () {
    var s = summarize(filtered());
    if (!s.n) { toast('まだ記録がありません'); return; }
    copyText(asText(s)).then(function () { toast('コピーしました。LINE やメールに貼り付けて送ってください'); },
      function () { toast('コピーできませんでした。「明細をCSVで保存」をお使いください'); });
  });
  $('csv').addEventListener('click', function () {
    var rows = filtered();
    if (!rows.length) { toast('まだ記録がありません'); return; }
    var blob = new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = '動作の速さ_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });
  $('clear').addEventListener('click', function () {
    if (!confirm('この端末の「動作の速さの記録」を消します。アプリのデータ（記録・名簿など）は消えません。よろしいですか？')) return;
    clearAll().then(function () { all = []; silentAll = []; render(); toast('記録を消しました'); });
  });

  load().then(function (r) { all = r.rows; silentAll = r.silent; render(); });
})();
