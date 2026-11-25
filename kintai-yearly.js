/* kintai-yearly.js — 勤怠の「年別」「事業所別」の集計の純関数（2026-11-25 新設・ROOT-v7-plus-parity.md の段C「年別・事業所別の画面」）
 *
 * ・DOM に触れない・通信しない。数え方は持たない: 月の集計（kintai-calc.js の computeMonth が返す people[].sum）を読んで並べ・足すだけ。
 *   kintai-calc.js は変えない・呼ばない（月を数えるのは画面の側）。
 * ・年別: 1〜12 か月の幅で、職員ごと・月ごとに1つの項目（実働・残業・法定外・深夜・休日・有休・出勤日数・欠勤）を並べ、合計を出す。
 * ・事業所別: その月分の事業所ごとの合計と人数。
 *     実働は、人ごとの事業所の割合（sum.byOffice・小数の分）で分け、割合で分けきれない残り（予定の無い勤務など）は主の事業所へ入れる。
 *     分けた分を整数にする時は、事業所の合計が全体の合計とちょうど同じになるよう、端数の大きい順に1分ずつ配る。
 *     残業・法定外・深夜・休日・有休・出勤日数は、その人の主の事業所（staff.office）に全部入れる（仮置き・画面に書く）。
 *     主の事業所が無い人は「未設定」の行に入れる。
 *     人数: 在籍＝その月分の名簿で休止でない人（主の事業所で数える）・働いた人＝その事業所で実働が1分以上ある人（両方の事業所に数える人がいる）。
 * ★職員の名前は持たない（staff_id だけ。名前は画面が出す）。
 */
(function (root) {
  'use strict';
  var ITEMS = [
    { key: 'workMin', name: '実働', unit: 'min' },
    { key: 'overtimeMin', name: '残業', unit: 'min' },
    { key: 'legalOverMin', name: '法定外', unit: 'min' },
    { key: 'nightMin', name: '深夜', unit: 'min' },
    { key: 'holidayMin', name: '休日労働', unit: 'min' },
    { key: 'paidDays', name: '有休', unit: 'day' },
    { key: 'workDays', name: '出勤日数', unit: 'day' },
    { key: 'absentDays', name: '欠勤', unit: 'day' }
  ];
  var ITEM_KEYS = ITEMS.map(function (x) { return x.key; });
  var OFFICES = ['facility', 'visit', 'day'];
  var MAX_N = 12;
  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function prevYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5) - 1; if (m < 1) { m = 12; y--; } return y + '-' + (m < 10 ? '0' : '') + m; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function isItem(k) { return ITEM_KEYS.indexOf(k) >= 0; }
  function itemOf(k) { return ITEMS.filter(function (x) { return x.key === k; })[0] || ITEMS[0]; }
  /* 終わりの月から数えて n か月分（古い順）。n は 1〜12 に収める */
  function monthsBack(endYm, n) {
    if (!isYm(endYm)) return [];
    n = Math.max(1, Math.min(MAX_N, Math.floor(num(n)) || 1));
    var out = [endYm];
    while (out.length < n) out.unshift(prevYm(out[0]));
    return out;
  }
  /* 年別の表。months: [{ ym, month }]（month は computeMonth の結果か null＝読めなかった月）・order: 先に並べる staff_id の順（今の月の並び）。
   * 返す: { yms, rows:[{ staff_id, staff, cells:{ym: 値|null}, total }], totals:{ym: 値|null}, grand }
   *   cells の null＝その月分に名簿の行が無い（入職の前・読めない月）。0＝名簿にいて 0。staff は最後に出てきた月の名簿の行 */
  function yearTable(months, item, order) {
    var key = isItem(item) ? item : 'workMin';
    var yms = (months || []).map(function (x) { return x.ym; });
    var by = Object.create(null), seq = [];
    (months || []).forEach(function (x) {
      if (!x || !x.month || !Array.isArray(x.month.people)) return;
      x.month.people.forEach(function (p) {
        var sid = p && p.staff && p.staff.staff_id;
        if (!sid) return;
        if (!by[sid]) { by[sid] = { staff_id: sid, staff: p.staff, cells: {}, total: 0 }; seq.push(sid); }
        by[sid].staff = p.staff;
        var v = num(p.sum && p.sum[key]);
        by[sid].cells[x.ym] = v; by[sid].total += v;
      });
    });
    var ord = [], seen = Object.create(null);
    (order || []).forEach(function (sid) { if (by[sid] && !seen[sid]) { seen[sid] = 1; ord.push(sid); } });
    seq.forEach(function (sid) { if (!seen[sid]) { seen[sid] = 1; ord.push(sid); } });
    var rows = ord.map(function (sid) { var r = by[sid]; yms.forEach(function (y) { if (!(y in r.cells)) r.cells[y] = null; }); r.total = round2(r.total); return r; });
    var totals = {}, grand = 0;
    (months || []).forEach(function (x) {
      if (!x || !x.month) { totals[x.ym] = null; return; }
      var s = 0; rows.forEach(function (r) { s += num(r.cells[x.ym]); });
      totals[x.ym] = round2(s); grand += s;
    });
    return { yms: yms, item: key, rows: rows, totals: totals, grand: round2(grand) };
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  /* 端数の大きい順に配って、整数の合計を target にする（parts: { 鍵: 小数 }） */
  function apportion(parts, target) {
    var keys = Object.keys(parts), out = {}, base = 0;
    keys.forEach(function (k) { out[k] = Math.floor(parts[k] + 1e-9); base += out[k]; });
    var rest = Math.round(target - base);
    var order = keys.slice().sort(function (a, b) { var fa = parts[a] - Math.floor(parts[a] + 1e-9), fb = parts[b] - Math.floor(parts[b] + 1e-9); return fb - fa || (a < b ? -1 : 1); });
    for (var i = 0; rest > 0 && order.length; i = (i + 1) % order.length) { out[order[i]]++; rest--; }
    for (var j = 0; rest < 0 && order.length; j = (j + 1) % order.length) { if (out[order[j]] > 0) { out[order[j]]--; rest++; } }
    return out;
  }
  function officeKey(o) { return OFFICES.indexOf(o) >= 0 ? o : ''; }
  /* 事業所別の表（1か月分）。返す: { rows:[{ office:''|facility|visit|day, active, worked, workMin, overtimeMin, legalOverMin, nightMin, holidayMin, paidDays, workDays, absentDays }], total:{同じ鍵} }
   *   rows は施設・訪問・通所の順（未設定は人がいる時だけ最後） */
  function siteTable(month) {
    var acc = {}, total = { office: 'total', active: 0, worked: 0 };
    var keys = ['facility', 'visit', 'day', ''];
    keys.forEach(function (o) { acc[o] = { office: o, active: 0, worked: 0, _work: 0, _workedBy: 0 }; ITEM_KEYS.forEach(function (k) { acc[o][k] = 0; }); });
    ITEM_KEYS.forEach(function (k) { total[k] = 0; });
    var people = month && Array.isArray(month.people) ? month.people : [];
    var workParts = { facility: 0, visit: 0, day: 0, '': 0 }, workTotal = 0, usedUnset = false;
    people.forEach(function (p) {
      var st = p && p.staff || {}, s = p && p.sum || {}, main = officeKey(st.office);
      if (main === '') usedUnset = true;
      if (st.active !== false) { acc[main].active++; total.active++; }
      var w = num(s.workMin), by = s.byOffice && typeof s.byOffice === 'object' ? s.byOffice : {}, put = 0, anyWork = false;
      /* 事業所ごとの割合の値は計算の側で丸めてあるので、和が実働を少し超えることがある。その時はその人の分だけ割合で縮める（ほかの人の事業所から引かない・反証レビュー 2026-11-25） */
      var raw = 0; OFFICES.forEach(function (o) { var v = num(by[o]); if (v > 0) raw += v; });
      var scale = raw > w && raw > 0 ? w / raw : 1;
      OFFICES.forEach(function (o) { var v = num(by[o]) * scale; if (v > 0) { workParts[o] += v; put += v; if (num(by[o]) >= 1) { acc[o].worked++; anyWork = true; } } });
      var rest = w - put;
      if (rest > 1e-6) { workParts[main] += rest; if (main === '') usedUnset = true; if (rest >= 1 && !(num(by[main]) >= 1)) { acc[main].worked++; anyWork = true; } }   /* 主の事業所に入った分が1分以上なら、その事業所の働いた人に数える（審査 2026-11-25 m4） */
      if (anyWork) total.worked++;
      workTotal += w;
      ITEM_KEYS.forEach(function (k) { if (k === 'workMin') return; var v = num(s[k]); acc[main][k] += v; total[k] += v; });
    });
    var ap = apportion(workParts, workTotal);
    keys.forEach(function (o) { acc[o].workMin = ap[o] || 0; if (acc[o].workMin) { if (o === '') usedUnset = true; } });
    total.workMin = Math.round(workTotal);
    var rows = keys.filter(function (o) { return o !== '' || usedUnset; }).map(function (o) {
      var r = acc[o]; delete r._work; delete r._workedBy;
      ITEM_KEYS.forEach(function (k) { r[k] = round2(r[k]); });
      return r;
    });
    ITEM_KEYS.forEach(function (k) { total[k] = round2(total[k]); });
    return { rows: rows, total: total };
  }

  var api = { ITEMS: ITEMS, ITEM_KEYS: ITEM_KEYS, MAX_N: MAX_N, isItem: isItem, itemOf: itemOf, monthsBack: monthsBack, yearTable: yearTable, siteTable: siteTable, apportion: apportion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintaiYearly = api;
})(typeof window !== 'undefined' ? window : this);
