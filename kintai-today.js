/* kintai-today.js — 勤怠管理のホームの「今日の出勤状況」（予定・勤務の1つごとに1行・同じ人は隣り合わせ）を作る純関数（2026-11-27 新設・代表者の決定 2026-11-27「推奨で進めて」）
 * ════════════════════════════════════════════════════════════════
 * ・画面（kintai.js）とは通信も DOM も持たない。試験は check/unit/kintai_today_test.js
 * ・新しい判定は作らない。ホームの「今日」の箱（kintai-monitor.js の todayBox）と同じ塊を同じ読み方で拾い、行に分けるだけ。
 *   事業所が「全部」の時は、行の数が箱の人数と次のように必ず合う（試験で確かめる）:
 *     予定のある今日の行 ＝ 出勤予定・打刻のある行（前の日からの勤務中を含む）＝ 出勤済み・遅れの行 ＝ まだ出勤していない・勤務中の行 ＝ 勤務中
 * ・状態（どの塊も必ず1つ）: 欠勤（absent）→ 勤務中（working・前の日に始まって今も勤務中の夜勤も）→ 遅れ（not_in_yet＝予定の開始＋15分を過ぎて打刻なし）
 *   → 打刻なし（no_punch＝予定の終わりを過ぎて打刻なし）→ まだ（予定はあるが打刻なし・上のどれでもない）
 *   → 退勤の打刻なし（打刻はあるが勤務中でなく missing_out）→ 退勤済み（ほかの打刻のある塊）。打刻の無い塊でその日に1日の特別休暇・代休があれば 休み
 *   確認済み（checked・freee の取り込みを含む）の塊は、打刻なし・退勤の打刻なしでも札にしない
 * ・並びは 遅れ → 打刻なし → まだ → 勤務中 → 退勤の打刻なし → 退勤済み → 休み → 欠勤、その中は予定の開始（予定が無い時は最初の打刻）の順。
 *   行は予定・勤務の1つ（塊）ごとに1行で、同じ人の行は、その人のいちばん急ぐ行の位置に隣り合わせにまとめる（2行目から cont）
 * ・事業所の絞り込みは日ごとの画面（kintai.js の paintDay）と同じく塊の事業所（b.office）で見る
 * ・氏名などの業務データを端末に残さない（このファイルは計算だけ）。試験も架空の職員だけ
 */
(function (root) {
  'use strict';
  var C = root && root.KintaiCalc ? root.KintaiCalc : (typeof require === 'function' ? safeRequire('./kintai-calc.js') : null);
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }
  /* kintai-calc.js が読めない時の要確認の印（kintai-calc.js の REVIEW と同じ） */
  var REVIEW_FB = { early: 1, overtime: 1, missing_out: 1, missing_in: 1, no_punch: 1, no_schedule: 1, offline: 1, after_lock: 1 };
  var ORDER = ['late', 'nopunch', 'before', 'working', 'noout', 'done', 'leave', 'absent'];
  var LABEL = { late: '遅れ', nopunch: '打刻なし', before: 'まだ', working: '勤務中', noout: '退勤の打刻なし', done: '退勤済み', leave: '休み', absent: '欠勤' };
  /* 普段と違う状態（札にする）。ほかは札にしない */
  var UNUSUAL = { late: 1, nopunch: 1, noout: 1 };
  var JST = 9 * 3600000;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function prevDate(d) {
    var t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 86400000, x = new Date(t);
    return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  }
  function jstDate(ms) { var d = new Date(ms + JST); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function msOf(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var t = Date.parse(v); return isNaN(t) ? null : t; }
  function dispName(s) { return s ? String(s.display_name || s.name || s.staff_id || '') : ''; }
  function has(b, f) { return (b.flags || []).indexOf(f) >= 0; }
  function needsReview(b) {
    if (C && C.needsReview) return C.needsReview({ checked: b.checked, flags: b.flags || [] });
    if (b.checked) return false;
    for (var i = 0; i < (b.flags || []).length; i++) if (REVIEW_FB[b.flags[i]]) return true;
    return false;
  }
  /* その日に1日の特別休暇・代休がある（kintai-calc.js が打刻の無い予定の塊を打刻なし・まだ出勤していないにしない日と同じ決まり） */
  function dayOff(day) { return ((day && day.absences) || []).some(function (x) { return x && (x.kind === 'special' || x.kind === 'comp') && x.minutes == null; }); }
  function statusOf(b, prev, day) {
    if (prev) return 'working';
    if (b.absent) return 'absent';
    if (!(b.punches || []).length && dayOff(day)) return 'leave';
    if (b.working) return 'working';
    if (has(b, 'not_in_yet')) return 'late';
    if (!(b.punches || []).length) return has(b, 'no_punch') ? 'nopunch' : 'before';
    return has(b, 'missing_out') ? 'noout' : 'done';
  }
  function rowOf(p, st, date, b, bi, prev, seq, day) {
    var ps = b.punches || [], inAt = null, outAt = null;
    for (var i = 0; i < ps.length; i++) {
      var t = msOf(ps[i] && ps[i].at);
      if (t == null) continue;
      if (ps[i].kind === 'in' && inAt == null) inAt = t;
      if (ps[i].kind === 'out') outAt = t;
    }
    var status = statusOf(b, prev, day);
    if (status !== 'done') outAt = null;   /* 退勤の時刻は退勤済みの行だけ（勤務中・退勤の打刻なしの行に、分けた勤務の前の組の退勤を出さない） */
    var sched = !!b.sched;   /* 箱（todayBox）と同じ読み方 */
    var ss = sched && typeof b.schedStart === 'number' ? b.schedStart : null, se = sched && typeof b.schedEnd === 'number' ? b.schedEnd : null;
    return {
      staff_id: st.staff_id, name: dispName(st), office: b.office || null, date: date, blockIndex: bi, prevDay: !!prev,
      status: status, label: LABEL[status], unusual: !!UNUSUAL[status] && !b.checked, review: needsReview(b),
      scheduled: sched, symbol: b.symbol || '', schedStart: ss, schedEnd: se, nextDay: ss != null && se != null && jstDate(se) !== date,
      inAt: inAt, outAt: outAt, punched: ps.length > 0, _k: ss != null ? ss : (inAt != null ? inAt : Infinity), _s: seq
    };
  }

  /* 今日の出勤状況。month は kintai-calc.js の computeMonth の結果・today は 'YYYY-MM-DD'（日本時間）・office は '' か 'facility'・'visit'・'day'
     返す: { rows: [行], counts: { scheduled, clockedIn, notInYet, working }（箱と同じ名前・絞り込んだ行だけで数える）, tally: { 状態: 行の数 }, total }
     行: { staff_id, name, office, date（塊の日）, blockIndex, prevDay, cont（同じ人の2行目から）, status, label, unusual, review, scheduled, symbol, schedStart, schedEnd, nextDay, inAt, outAt, punched } */
  function board(month, today, office) {
    var rows = [], seq = 0, of = typeof office === 'string' ? office : '';
    var people = (month && month.people) || [], td = isDate(today) ? today : '', yday = td ? prevDate(td) : '';
    for (var i = 0; i < people.length; i++) {
      var p = people[i], st = p.staff || {}, days = p.days || [];
      for (var j = 0; j < days.length; j++) {
        var dd = days[j], bl = dd.blocks || [];
        var isT = !!td && dd.date === td, isY = !!yday && dd.date === yday;
        if (!isT && !isY) continue;
        for (var k = 0; k < bl.length; k++) {
          var b = bl[k];
          if (isY && !b.working) continue;   /* 前の日の塊は、今も勤務中の分だけ（箱と同じ） */
          if (of && b.office !== of) continue;
          rows.push(rowOf(p, st, dd.date, b, k, isY, seq++, dd));
        }
      }
    }
    /* 並び: 塊の行を状態の順・予定の開始の順に並べた後、同じ人の行を隣り合わせにまとめる（反証レビュー 2026-11-27）。
       その人の行のうちいちばん急ぐ（並びの早い）行の位置に、その人の行をまとめて置く。2行目からは cont（続きの行）を付ける */
    var cmp = function (a, b) { return (ORDER.indexOf(a.status) - ORDER.indexOf(b.status)) || (a._k - b._k) || (a._s - b._s); };
    rows.sort(cmp);
    var lead = {}, gi = 0;
    rows.forEach(function (r) { var id = String(r.staff_id); if (!(id in lead)) lead[id] = gi++; r._g = lead[id]; });
    rows.sort(function (a, b) { return (a._g - b._g) || cmp(a, b); });
    rows.forEach(function (r, i) { r.cont = i > 0 && rows[i - 1]._g === r._g; });
    var counts = { scheduled: 0, clockedIn: 0, notInYet: 0, working: 0 }, tally = {};
    ORDER.forEach(function (s) { tally[s] = 0; });
    rows.forEach(function (r) {
      if (r.scheduled && !r.prevDay) counts.scheduled++;
      if (r.punched) counts.clockedIn++;
      if (r.status === 'late') counts.notInYet++;
      if (r.status === 'working') counts.working++;
      tally[r.status]++;
      delete r._k; delete r._s; delete r._g;
    });
    return { rows: rows, counts: counts, tally: tally, total: rows.length };
  }

  var api = { board: board, ORDER: ORDER, LABEL: LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiToday = api;
})(typeof window !== 'undefined' ? window : this);
