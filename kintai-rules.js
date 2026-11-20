/* kintai-rules.js — 勤怠の決まりの見張り（純関数・DOM に触れない・2026-11-20 新設）
 *
 * 勤怠の計算（kintai-calc.js の computeMonth）の結果から、働き方の決まりに外れていそうな所を拾う。
 * 数えた時間・給与へ渡す値は一切変えない（知らせだけ）。
 *   1. 休憩が足りない（労基法34条）: 労働が6時間を超えるのに休憩が45分未満、8時間を超えるのに60分未満の勤務
 *      休憩は「数えた区間の長さ − 実働」（予定の休憩と、打刻した昼休みの両方を含む）。勤務（塊）ごとに見る
 *   2. 勤務の間が短い（勤務間インターバル・労働時間等設定改善法の努力義務）: 前の勤務の終わりから次の勤務の始まりまでが
 *      intervalH 時間（既定 11）未満
 *   3. 続けて働いている日が多い（労基法35条の週1日の休日の目安）: 働いた時間がかかる暦日（日本時間 0〜24時）が続いた日数が
 *      consecWarnDays（既定 7）以上で warn、consecOverDays（既定 13＝週1日の休日がどう区切っても取れない日数）以上で over
 *      夜勤の明けの日も働いた日に数える（休日は暦日で丸1日の休み）
 * 期間の外（前の月分）の勤務は見ないので、期間の頭の続きの日数・勤務の間は少なく出ることがある（画面で注記する）。
 * ★職員の名前は持たない（staff_id だけ）。
 */
(function (root) {
  'use strict';
  var MIN = 60000, DAY = 86400000, JST = 9 * 3600000;
  var DEFAULTS = { intervalH: 11, consecWarnDays: 7, consecOverDays: 13 };
  var RANGE = { intervalH: [0, 24], consecWarnDays: [2, 31], consecOverDays: [2, 31] };

  function fill(cfg) {
    var out = {}, k, src = cfg && typeof cfg === 'object' ? cfg : {};
    for (k in DEFAULTS) {
      var v = src[k], r = RANGE[k];
      out[k] = typeof v === 'number' && isFinite(v) && v >= r[0] && v <= r[1] ? v : DEFAULTS[k];
    }
    if (out.consecOverDays < out.consecWarnDays) out.consecOverDays = out.consecWarnDays;
    return out;
  }
  function jstDate(ms) { return new Date(ms + JST).toISOString().slice(0, 10); }
  function dayIndex(ms) { return Math.floor((ms + JST) / DAY); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* 働いた勤務（塊）を時刻の順に並べる（数えた区間と実働がある塊だけ） */
  function workedBlocks(person) {
    var out = [];
    (person && person.days || []).forEach(function (d) {
      (d.blocks || []).forEach(function (b) {
        if (isNum(b.countStart) && isNum(b.countEnd) && b.countEnd > b.countStart && (b.workMin || 0) > 0) out.push({ date: d.date, b: b });
      });
    });
    return out.sort(function (x, y) { return x.b.countStart - y.b.countStart; });
  }

  function breakShort(list) {
    var out = [];
    list.forEach(function (x) {
      var b = x.b, span = Math.round((b.countEnd - b.countStart) / MIN), work = b.workMin, taken = Math.max(0, span - work);
      var need = work > 480 ? 60 : work > 360 ? 45 : 0;
      if (need && taken < need) out.push({ kind: 'break_short', date: x.date, workMin: work, breakMin: taken, needMin: need });
    });
    return out;
  }

  function intervalShort(list, cfg) {
    var out = [], lim = cfg.intervalH * 60;
    if (!(lim > 0)) return out;
    for (var i = 1; i < list.length; i++) {
      var prev = list[i - 1].b, cur = list[i].b, rest = Math.round((cur.countStart - prev.countEnd) / MIN);
      /* 同じ日の分割勤務（間が短い・同じ日の続き）は「勤務の間」に数えない＝日をまたいで次の勤務に入る時だけ見る */
      if (rest < 0 || jstDate(prev.countEnd - 1) === jstDate(cur.countStart) && list[i - 1].date === list[i].date) continue;
      if (rest < lim) out.push({ kind: 'interval_short', date: list[i].date, prevDate: list[i - 1].date, restMin: rest, limitMin: lim });
    }
    return out;
  }

  function consecutive(list, cfg) {
    var set = {}, keys, out = [];
    list.forEach(function (x) {
      var a = dayIndex(x.b.countStart), z = dayIndex(x.b.countEnd - 1);
      for (var d = a; d <= z; d++) set[d] = 1;
    });
    keys = Object.keys(set).map(Number).sort(function (p, q) { return p - q; });
    var i = 0;
    while (i < keys.length) {
      var j = i;
      while (j + 1 < keys.length && keys[j + 1] === keys[j] + 1) j++;
      var n = j - i + 1;
      if (n >= cfg.consecWarnDays) {
        out.push({ kind: 'consecutive', from: jstDate(keys[i] * DAY), to: jstDate(keys[j] * DAY), days: n, level: n >= cfg.consecOverDays ? 'over' : 'warn' });
      }
      i = j + 1;
    }
    return out;
  }

  /* 1人分: { breaks:[…], intervals:[…], runs:[…], count } */
  function checkPerson(person, config) {
    var cfg = fill(config), list = workedBlocks(person);
    var r = { breaks: breakShort(list), intervals: intervalShort(list, cfg), runs: consecutive(list, cfg) };
    r.count = r.breaks.length + r.intervals.length + r.runs.length;
    r.over = r.runs.some(function (x) { return x.level === 'over'; });
    return r;
  }

  /* 月の全員: { byStaff: { staff_id: checkPerson の結果（1件以上ある人だけ） }, totals: { breaks, intervals, runs, people } } */
  function checkMonth(month, config) {
    var byStaff = {}, t = { breaks: 0, intervals: 0, runs: 0, people: 0 };
    (month && month.people || []).forEach(function (p) {
      var sid = p && p.staff && p.staff.staff_id;
      if (!sid) return;
      var r = checkPerson(p, config);
      if (!r.count) return;
      byStaff[sid] = r;
      t.breaks += r.breaks.length; t.intervals += r.intervals.length; t.runs += r.runs.length; t.people++;
    });
    return { byStaff: byStaff, totals: t };
  }

  var api = { DEFAULTS: DEFAULTS, fill: fill, checkPerson: checkPerson, checkMonth: checkMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiRules = api;
})(this);
