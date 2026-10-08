/* perf-report.html の処理（2026-10-09 に HTML から分けた・監査10月版 #16）。中身は分ける前と同じ */
(function () {
  'use strict';
  var DB = 'su_perf', STORE = 'views';
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

  var all = [];
  var $ = function (id) { return document.getElementById(id); };

  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('on'); }, 3000);
  }
  function load() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve([]);
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onerror = function () { resolve([]); };
      req.onsuccess = function () {
        try {
          var g = req.result.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          g.onsuccess = function () { resolve(g.result || []); };
          g.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      };
    });
  }
  function clearAll() {
    return new Promise(function (resolve) {
      var req = indexedDB.open(DB, 1);
      req.onsuccess = function () {
        try {
          var tx = req.result.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      };
      req.onerror = function () { resolve(); };
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

  function filtered() {
    var days = Number($('range').value);
    if (!days) return all.slice();
    var from = Date.now() - days * 86400000;
    return all.filter(function (r) { return r.t >= from; });
  }

  function summarize(rows) {
    var by = {};
    rows.forEach(function (r) { (by[r.app] = by[r.app] || []).push(r); });
    var apps = Object.keys(by).map(function (app) {
      var rs = by[app];
      var withGas = rs.filter(function (r) { return r.gas && r.gas.length; });
      var ones = [];
      rs.forEach(function (r) { (r.gas || []).forEach(function (g) { ones.push(g.d); }); });
      var xf = rs.filter(function (r) { return r.xfer; });
      return {
        app: app, name: NAMES[app] || app, n: rs.length,
        dcl50: sec(q(rs.map(function (r) { return r.dcl; }), 0.5)),
        dcl90: sec(q(rs.map(function (r) { return r.dcl; }), 0.9)),
        gasCnt: q(rs.map(function (r) { return (r.gas || []).length; }), 0.5),
        done50: sec(q(withGas.map(function (r) { return r.gasDone; }), 0.5)),
        done90: sec(q(withGas.map(function (r) { return r.gasDone; }), 0.9)),
        one50: sec(q(ones, 0.5)),
        tbt50: sec(q(rs.map(function (r) { return r.tbt; }), 0.5)),
        kb: q(rs.map(function (r) { return r.htmlKB; }), 0.5),
        full: xf.length ? pct(xf.filter(function (r) { return r.xfer === 'full'; }).length, xf.length) : '—',
        worst: Math.max(q(withGas.map(function (r) { return r.gasDone; }), 0.5) || 0, q(rs.map(function (r) { return r.dcl; }), 0.5) || 0)
      };
    }).sort(function (a, b) { return b.worst - a.worst; });

    var eps = {};
    rows.forEach(function (r) { (r.gas || []).forEach(function (g) { (eps[g.ep] = eps[g.ep] || []).push(g.d); }); });
    var epList = Object.keys(eps).map(function (ep) {
      var d = eps[ep];
      return { ep: ep, n: d.length, p50: sec(q(d, 0.5)), p90: sec(q(d, 0.9)), max: sec(Math.max.apply(null, d)) };
    }).sort(function (a, b) { return (b.p50 || 0) - (a.p50 || 0); });

    var allOnes = [];
    rows.forEach(function (r) { (r.gas || []).forEach(function (g) { allOnes.push(g.d); }); });
    return {
      apps: apps, eps: epList, n: rows.length,
      dcl50: sec(q(rows.map(function (r) { return r.dcl; }), 0.5)),
      done50: sec(q(rows.filter(function (r) { return r.gas && r.gas.length; }).map(function (r) { return r.gasDone; }), 0.5)),
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
      $('tApp').innerHTML = '<tr><td class="empty" colspan="11">記録がありません</td></tr>';
    } else {
      $('tApp').innerHTML =
        '<thead><tr><th>アプリ</th><th>回数</th><th>画面が出るまで<br>中央値</th><th>遅い時</th>' +
        '<th>起動時の<br>通信回数</th><th>読み込み完了<br>中央値</th><th>遅い時</th><th>通信1回<br>中央値</th>' +
        '<th>固まり<br>中央値</th><th>画面ファイル<br>大きさ(KB)</th><th>丸ごと<br>取り直し</th></tr></thead><tbody>' +
        s.apps.map(function (a) {
          return '<tr><td>' + esc(a.name) + '</td><td>' + a.n + '</td>' +
            cell(a.dcl50, TH.dcl) + cell(a.dcl90, TH.dcl) +
            '<td>' + (a.gasCnt == null ? '—' : Math.round(a.gasCnt)) + '</td>' +
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
    return s;
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
    L.push(['アプリ', '回数', '画面50%', '画面90%', '起動通信数', '読込50%', '読込90%', '通信1回', '固まり', 'KB', '丸ごと'].join('\t'));
    s.apps.forEach(function (a) {
      L.push([a.name, a.n, fmt(a.dcl50), fmt(a.dcl90), a.gasCnt == null ? '' : Math.round(a.gasCnt),
        fmt(a.done50), fmt(a.done90), fmt(a.one50), fmt(a.tbt50), a.kb == null ? '' : Math.round(a.kb), a.full].join('\t'));
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
      '起動時通信数', '通信合計回数', '通信合計ms', '固まりms', '使えるまでms', '通信明細(開始ms:所要ms:接続先)'];
    var out = [head.join(',')];
    rows.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (r) {
      var d = new Date(r.t);
      var ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      var det = (r.gas || []).map(function (g) { return g.s + ':' + g.d + ':' + g.ep; }).join(' ');
      out.push([ts, NAMES[r.app] || r.app, r.dev, roleName(r.role), r.conn || '', r.nav || '', v(r.htmlKB), r.xfer || '',
        v(r.ttfb), v(r.dcl), v(r.gasDone), (r.gas || []).length, v(r.gasN), v(r.gasMs), v(r.tbt), v(r.ready), det]
        .map(csvCell).join(','));
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
    clearAll().then(function () { all = []; render(); toast('記録を消しました'); });
  });

  load().then(function (rows) { all = rows; render(); });
})();
