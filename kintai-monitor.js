/* kintai-monitor.js — 勤怠管理の管理者のホーム（勤怠モニター）の箱を作る純関数（2026-11-20 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md の段2）
 * ════════════════════════════════════════════════════════════════
 * ・画面（kintai.js）とは通信も DOM も持たない。試験は check/unit/kintai_monitor_test.js
 * ・箱の順は 今日・打刻漏れと要確認・36協定・有給・締め・申請。入力が null の箱は出さない（申請は段5の後まで null＝箱なし）
 * ・「今日」は日ごとの画面（kintai.js の paintDay・kindsOf）と同じく塊ごとに数える（押した先のチップの数とそろえる）
 * ・氏名などの業務データを端末に残さない（このファイルは計算だけ）。試験も架空の職員だけ
 */
(function (root) {
  'use strict';
  var C = root && root.KintaiCalc ? root.KintaiCalc : (typeof require === 'function' ? safeRequire('./kintai-calc.js') : null);
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }
  var LEVEL_RANK = { ok: 0, warn: 1, alert: 2 };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function isYm(s) { return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) && +s.slice(5, 7) >= 1 && +s.slice(5, 7) <= 12; }
  function md(d) { return +d.slice(5, 7) + '/' + +d.slice(8, 10); }
  function ymJa(ym) { return ym.slice(0, 4) + '年' + +ym.slice(5, 7) + '月分'; }
  /* 日本時間の時:分（kintai-calc.js の jstHM と同じ見え方） */
  function hm(ms) { var d = new Date(ms + 9 * 3600000); return d.getUTCHours() + ':' + pad(d.getUTCMinutes()); }
  function dispName(s) { return s ? String(s.display_name || s.name || s.staff_id || '') : ''; }
  function labelOf(f) { return C && C.FLAG_LABEL && C.FLAG_LABEL[f] ? C.FLAG_LABEL[f] : String(f); }
  function top(a, b) { return LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a; }

  /* 今日: 出勤予定（予定のある塊）・出勤済み（打刻のある塊）・まだ出勤していない（not_in_yet）・勤務中（working）。
     有休だけの日（塊が無い）は数えない。予定の無い打刻は出勤済みには入るが出勤予定には入らない。欠勤の塊は「まだ出勤していない」に入れない */
  function todayBox(month, today) {
    var counts = { scheduled: 0, clockedIn: 0, notInYet: 0, working: 0 }, rows = [];
    var people = (month && month.people) || [];
    for (var i = 0; i < people.length; i++) {
      var p = people[i], st = p.staff || {};
      var d = null;
      for (var j = 0; j < (p.days || []).length; j++) if (p.days[j].date === today) { d = p.days[j]; break; }
      if (!d) continue;
      var bl = d.blocks || [];
      for (var k = 0; k < bl.length; k++) {
        var b = bl[k], fl = b.flags || [];
        if (b.sched) counts.scheduled++;
        if ((b.punches || []).length) counts.clockedIn++;
        if (b.working) counts.working++;
        if (fl.indexOf('not_in_yet') >= 0) {
          counts.notInYet++;
          rows.push({ staff_id: st.staff_id, name: dispName(st), text: 'まだ出勤していません' + (typeof b.schedStart === 'number' ? '（予定 ' + hm(b.schedStart) + '〜）' : '') });
        }
      }
    }
    return { key: 'today', title: '今日', count: counts.notInYet, level: counts.notInYet ? 'warn' : 'ok', tab: 'day', rows: rows, counts: counts };
  }

  /* 打刻漏れ・要確認（今月分）: reviewList の1行（塊）ごとに1行 */
  function reviewBox(list, month) {
    var names = {};
    ((month && month.people) || []).forEach(function (p) { if (p.staff) names[p.staff.staff_id] = dispName(p.staff); });
    var rows = (list || []).map(function (r) {
      return { staff_id: r.staffId, name: names[r.staffId] != null ? names[r.staffId] : String(r.staffId || ''), text: (isDate(r.date) ? md(r.date) + ' ' : '') + (r.marks || []).map(labelOf).join('・') };
    });
    return { key: 'review', title: '打刻漏れ・要確認', count: rows.length, level: rows.length ? 'warn' : 'ok', tab: 'review', rows: rows };
  }

  /* 36協定: 項目（Kintai36.judge の items）のある人。超過が1人でもいれば alert、警告だけなら warn */
  function a36Box(list) {
    var rows = [], level = 'ok';
    (list || []).forEach(function (r) {
      var its = (r && r.items) || [];
      if (!its.length) return;
      var lv = 'warn';
      for (var i = 0; i < its.length; i++) if (its[i] && its[i].level === 'over') lv = 'alert';
      level = top(level, lv);
      rows.push({ staff_id: r.staff_id, name: r.name || '', text: its.map(function (x) { return x && x.text ? x.text : ''; }).filter(Boolean).join('／'), level: lv });
    });
    return { key: 'a36', title: '36協定', count: rows.length, level: level, tab: 'grid', rows: rows };
  }

  /* 有給: 年5日の赤・黄（kintai-leave.js の obligation5 の state。level でも読む）と期限の近い残り。赤がいれば alert */
  function leaveBox(list) {
    var rows = [], level = 'ok';
    (list || []).forEach(function (r) {
      if (!r) return;
      var ob = r.ob || {}, st = ob.level != null ? ob.level : ob.state, parts = [], lv = null;
      if (st === 'red' || st === 'yellow') {
        lv = st === 'red' ? 'alert' : 'warn';
        parts.push('年5日に届いていません' + (typeof ob.need === 'number' ? '（あと ' + ob.need + ' 日' + (isDate(ob.end) ? '・' + ob.end.slice(0, 4) + '年' + md(ob.end) + ' まで' : '') + '）' : ''));
      }
      if (typeof r.expiringDays === 'number' && r.expiringDays > 0) {
        lv = lv || 'warn';
        parts.push('期限の近い残り ' + r.expiringDays + ' 日' + (isDate(r.expires) ? '（' + r.expires.slice(0, 4) + '年' + md(r.expires) + ' まで）' : ''));
      }
      if (!lv) return;
      level = top(level, lv);
      rows.push({ staff_id: r.staff_id, name: r.name || '', text: parts.join('／'), level: lv });
    });
    return { key: 'leave', title: '有給（年5日・期限の近い残り）', count: rows.length, level: level, tab: 'leave', rows: rows };
  }

  /* 締めていない過去の月分: 1つでもあれば alert（過ぎた月分が締まっていない＝赤・仮置き） */
  function closeBox(list) {
    var seen = {}, rows = [];
    (list || []).filter(isYm).sort().forEach(function (ym) {
      if (seen[ym]) return; seen[ym] = 1;
      rows.push({ staff_id: null, name: '', text: ymJa(ym) + 'が締まっていません' });
    });
    return { key: 'close', title: '締めていない月分', count: rows.length, level: rows.length ? 'alert' : 'ok', tab: 'close', rows: rows };
  }

  /* 申請の承認待ち（段5の後）: 件数だけ */
  function requestsBox(n) {
    var c = typeof n === 'number' && isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return { key: 'requests', title: '申請の承認待ち', count: c, level: c ? 'warn' : 'ok', tab: 'requests', rows: [] };
  }

  /* 箱の一覧。input: { today, month, reviewList, leaveRows, a36Rows, unlockedPast, requests }
     返す: [{ key, title, count, level:'ok'|'warn'|'alert', tab, rows:[{ staff_id, name, text }] }]（今日の箱だけ counts も持つ） */
  function boxes(input) {
    var o = input || {}, out = [];
    if (o.month != null) out.push(todayBox(o.month, isDate(o.today) ? o.today : ''));
    if (o.reviewList != null) out.push(reviewBox(o.reviewList, o.month));
    if (o.a36Rows != null) out.push(a36Box(o.a36Rows));
    if (o.leaveRows != null) out.push(leaveBox(o.leaveRows));
    if (o.unlockedPast != null) out.push(closeBox(o.unlockedPast));
    if (o.requests != null) out.push(requestsBox(o.requests));
    return out;
  }

  var api = { boxes: boxes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiMonitor = api;
})(typeof window !== 'undefined' ? window : this);
