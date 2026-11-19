/* kintai-leave.js — 勤怠管理の有給（年次有給休暇）の純関数（2026-11-20 新設・凍結した仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v4-master-leave.md の L1〜L9）
 * ════════════════════════════════════════════════════════════════
 * ・画面（kintai.js の「有給」のタブ）とは通信も DOM も持たない。試験は check/unit/kintai_leave_test.js
 * ・日付は全部 'YYYY-MM-DD' の文字で扱い、足し引きは Date.UTC だけで行う（端末の時刻帯で日がずれない）
 * ・付与（L1・L2）: 入職日の6か月後の同じ日（その月に無い日は月末）に10日、以後1年ごと 11・12・14・16・18・20日。
 *   付与日は毎回「入職日から 6＋12×n か月」で出す（月末に丸めた日を次の起点にしない）
 *   比例付与は「週の所定日数」(4日以下) と「週の所定時間」(30時間未満) がそろった時だけ（労基則24条の3の表）
 * ・出勤率8割の判定はしない（L3）。付与しない年は profile.skip_grants に付与日を入れる
 * ・期限は付与日から2年（2年後の前日まで・L4）。使う時は、その使用の日に使える付与のうち古いものから減らす（FIFO）
 * ・移行（L6）: profile.opening_date より前の自動の付与は数えない（今の残りは手で入れた付与 kind='opening' で持つ）
 * ・使用（L5）: シフトの有休の日と手で入れた使用を合わせる。同じ人・同じ日に両方ある時は手入力を正にし、二重に数えない
 * ・氏名・日数などの業務データを端末に残さない（このファイルは計算だけ）。試験も架空の職員だけ
 */
(function (root) {
  'use strict';
  var DAY = 86400000;
  /* L1 通常の付与（6か月・1年6か月・…・6年6か月以降） */
  var NORMAL = [10, 11, 12, 14, 16, 18, 20];
  /* L2 比例付与（週の所定日数 4・3・2・1 日）。労基則24条の3の表 */
  var PROP = { 4: [7, 8, 9, 10, 12, 13, 15], 3: [5, 6, 6, 8, 9, 10, 11], 2: [3, 4, 4, 5, 6, 6, 7], 1: [1, 2, 2, 2, 3, 3, 3] };
  var MAX_GRANTS = 80;   /* 自動の付与を数える回数の上限（入職日が壊れていても回り続けない） */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m);
  }
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function fmt(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function ms(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function addDays(s, n) { return fmt(ms(s) + n * DAY); }
  /* n か月後の同じ日（その月に無い日は月末） */
  function addMonths(s, n) {
    var y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n, d = +s.slice(8, 10);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12 + 1;
    return y + '-' + pad(m) + '-' + pad(Math.min(d, dim(y, m)));
  }
  function diffDays(a, b) { return Math.round((ms(b) - ms(a)) / DAY); }
  /* 期限（使える最後の日）＝付与日の2年後の前日 */
  function expiresOf(grantDate) { return addDays(addMonths(grantDate, 24), -1); }
  function num(v) { return v == null || v === '' ? null : (isFinite(+v) ? +v : null); }
  function half(v) { return Math.round(v * 2) / 2; }

  /* 入職日: 有給の設定の上書き（profile.hire_date）があればそちら、無ければ職員マスタの入職日 */
  function hireOf(masterHire, profile) {
    if (profile && isDate(profile.hire_date)) return profile.hire_date;
    return isDate(masterHire) ? masterHire : null;
  }
  /* 比例付与の表の行（週の所定日数・時間がそろい、4日以下・30時間未満の時だけ）。null は通常の付与 */
  function propRow(profile) {
    var wd = num(profile && profile.weekly_days), wh = num(profile && profile.weekly_hours);
    if (wd == null || wh == null) return null;
    if (!(wd > 0 && wd <= 4 && wh < 30)) return null;
    /* 週4.5日などの端は通常の付与（4日を超える）。週1日未満（0.5日）は表の1日の行で数える（多く付ける側・仮置き） */
    return PROP[Math.min(4, Math.max(1, Math.ceil(wd)))];
  }
  /* 自動の付与の一覧（untilDate までの付与日）。status: 'ok' 数える／'skip' 付与しない日に選んだ／'opening' 移行日より前で数えない */
  function autoGrants(hireDate, profile, untilDate) {
    var p = profile || {}, hire = hireOf(hireDate, p), out = [];
    if (!hire || !isDate(untilDate)) return out;
    var row = propRow(p) || NORMAL, skip = {}, open = isDate(p.opening_date) ? p.opening_date : null;
    (Array.isArray(p.skip_grants) ? p.skip_grants : []).forEach(function (d) { if (isDate(d)) skip[d] = 1; });
    for (var n = 0; n < MAX_GRANTS; n++) {
      var gd = addMonths(hire, 6 + 12 * n);
      if (gd > untilDate) break;
      var st = open && gd < open ? 'opening' : (skip[gd] ? 'skip' : 'ok');
      out.push({ grant_date: gd, days: row[Math.min(n, row.length - 1)], kind: 'auto', expires: expiresOf(gd), n: n, status: st, proportional: row !== NORMAL });
    }
    return out;
  }
  /* 次の自動の付与（asOf より後の最初の付与日）。無ければ null */
  function nextGrant(hireDate, profile, asOf) {
    if (!isDate(asOf)) return null;
    var list = autoGrants(hireDate, profile, addMonths(asOf, 13));
    for (var i = 0; i < list.length; i++) if (list[i].grant_date > asOf) return list[i];
    return null;
  }
  var KIND_ORDER = { opening: 0, manual: 1, auto: 2 };
  /* 数える付与（自動の 'ok' と、取り消していない手入力の付与）を付与日の順に並べる */
  function lotsOf(auto, dbGrants, untilDate) {
    var out = [];
    (auto || []).forEach(function (g) { if (g && g.status === 'ok') out.push({ grant_date: g.grant_date, days: g.days, kind: 'auto', expires: g.expires, id: null }); });
    (dbGrants || []).forEach(function (g) {
      if (!g || g.voided_at || !isDate(g.grant_date)) return;
      var d = num(g.days); if (d == null || d <= 0) return;
      if (isDate(untilDate) && g.grant_date > untilDate) return;
      out.push({ grant_date: g.grant_date, days: d, kind: g.kind === 'opening' ? 'opening' : 'manual', expires: expiresOf(g.grant_date), id: g.id || null, note: g.note || '' });
    });
    out.sort(function (a, b) { return a.grant_date < b.grant_date ? -1 : a.grant_date > b.grant_date ? 1 : (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]); });
    return out;
  }
  function cleanUses(uses) {
    var out = [];
    (uses || []).forEach(function (u) {
      if (!u || u.voided_at || !isDate(u.use_date)) return;
      var d = num(u.days); if (d == null || d <= 0) return;
      out.push({ use_date: u.use_date, days: d, src: u.src || 'manual', id: u.id || null });
    });
    out.sort(function (a, b) { return a.use_date < b.use_date ? -1 : a.use_date > b.use_date ? 1 : 0; });
    return out;
  }
  /* 残り（L4）: asOf までの使用を、使用の日に使える付与（付与日〜期限）の古い方から減らす。
     返す: { remain 今使える残り, lots[{…, used, remain, state:'valid'|'expired'|'future'}], soon 期限のいちばん近い残り {days, expires} か null,
             used asOf までに使った日数, planned asOf より後の使用, over 使える付与が無かった使用の日数 } */
  function balance(grants, uses, asOf) {
    var lots = (grants || []).filter(function (g) { return g && !g.voided_at && (g.status == null || g.status === 'ok') && isDate(g.grant_date) && num(g.days) > 0; })
      .map(function (g) { return { grant_date: g.grant_date, days: +g.days, kind: g.kind || 'manual', expires: g.expires || expiresOf(g.grant_date), id: g.id || null, note: g.note || '', used: 0 }; });
    lots.sort(function (a, b) { return a.grant_date < b.grant_date ? -1 : a.grant_date > b.grant_date ? 1 : (a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : (KIND_ORDER[a.kind] || 0) - (KIND_ORDER[b.kind] || 0)); });
    var us = cleanUses(uses), used = 0, planned = 0, over = 0;
    us.forEach(function (u) {
      if (u.use_date > asOf) { planned += u.days; return; }
      used += u.days;
      var need = u.days;
      for (var i = 0; i < lots.length && need > 0; i++) {
        var l = lots[i];
        if (l.grant_date > u.use_date || u.use_date > l.expires) continue;
        var take = Math.min(need, l.days - l.used);
        if (take > 0) { l.used = half(l.used + take); need = half(need - take); }
      }
      if (need > 0) over = half(over + need);
    });
    var remain = 0, soon = null;
    lots.forEach(function (l) {
      l.remain = half(l.days - l.used);
      l.state = l.grant_date > asOf ? 'future' : (asOf > l.expires ? 'expired' : 'valid');
      if (l.state !== 'valid') return;
      remain = half(remain + l.remain);
      if (l.remain > 0 && (!soon || l.expires < soon.expires)) soon = { days: l.remain, expires: l.expires };
      else if (l.remain > 0 && soon && l.expires === soon.expires) soon.days = half(soon.days + l.remain);
    });
    return { asOf: asOf, remain: remain, lots: lots, soon: soon, used: half(used), planned: half(planned), over: over };
  }
  /* 年5日の取得義務（L7）: 10日以上を付与した日（移行の残りは除く）のうち asOf までで最も新しい日から1年の間の使用。
     state: 'ok' 5日に届いた／'red' 届かず期限まで60日以内（または期間が終わった）／'yellow' 届いていない／'none' 対象の付与が無い */
  function obligation5(grants, uses, asOf) {
    var cand = (grants || []).filter(function (g) { return g && !g.voided_at && (g.status == null || g.status === 'ok') && g.kind !== 'opening' && num(g.days) >= 10 && isDate(g.grant_date) && g.grant_date <= asOf; });
    if (!cand.length) return { state: 'none', used: 0, planned: 0, need: 5 };
    cand.sort(function (a, b) { return a.grant_date < b.grant_date ? -1 : a.grant_date > b.grant_date ? 1 : 0; });
    var gd = cand[cand.length - 1].grant_date, end = addDays(addMonths(gd, 12), -1);
    var used = 0, planned = 0;
    cleanUses(uses).forEach(function (u) {
      if (u.use_date < gd || u.use_date > end) return;
      if (u.use_date <= asOf) used += u.days; else planned += u.days;
    });
    used = half(used); planned = half(planned);
    var left = diffDays(asOf, end), ended = asOf > end;
    var state = used >= 5 ? 'ok' : (ended || left <= 60 ? 'red' : 'yellow');
    return { state: state, grant_date: gd, end: end, used: used, planned: planned, need: Math.max(0, half(5 - used)), daysLeft: left, ended: ended };
  }
  /* 使用の合成（L5）: 月の計算（KintaiCalc.computeMonth の結果・1つか配列）のシフトの有休の日と、手で入れた使用を合わせる。
     シフトの日＝期間の中で paidDays が 0 より大きく、手入力の印（leaveUse）の無い日（半日の判定は computeMonth と同じ 0.5/1）。
     同じ人・同じ日に手入力があれば手入力を正にし（alsoShift の印を付ける）、シフトの方は数えない。取り消した手入力は入れない。
     返す: [{ staff_id, use_date, days, src:'shift'|'manual', id, note, alsoShift }]（職員・日付の順） */
  function usesFromMonth(months, manualUses) {
    var list = Array.isArray(months) ? months : (months ? [months] : []), by = {}, k;
    list.forEach(function (m) {
      if (!m || !Array.isArray(m.people)) return;
      var from = m.period && m.period.from, to = m.period && m.period.to;
      m.people.forEach(function (p) {
        var sid = p && p.staff && p.staff.staff_id;
        if (!sid) return;
        (p.days || []).forEach(function (d) {
          if (!d || !(d.paidDays > 0) || d.leaveUse || !isDate(d.date)) return;
          if (from && (d.date < from || d.date > to)) return;
          by[sid + '|' + d.date] = { staff_id: sid, use_date: d.date, days: d.paidDays, src: 'shift', id: null, note: '' };
        });
      });
    });
    (manualUses || []).forEach(function (u) {
      if (!u || u.voided_at || !u.staff_id || !isDate(u.use_date)) return;
      var d = num(u.days); if (d !== 0.5 && d !== 1) return;
      k = u.staff_id + '|' + u.use_date;
      by[k] = { staff_id: u.staff_id, use_date: u.use_date, days: d, src: 'manual', id: u.id || null, note: u.note || '', alsoShift: !!(by[k] && (by[k].src === 'shift' || by[k].alsoShift)) };
    });
    var out = [];
    for (k in by) out.push(by[k]);
    out.sort(function (a, b) { return a.staff_id < b.staff_id ? -1 : a.staff_id > b.staff_id ? 1 : (a.use_date < b.use_date ? -1 : a.use_date > b.use_date ? 1 : 0); });
    return out;
  }
  /* 1人分のまとめ（画面の1行と開いた窓に使う）。uses はその人の合成済みの使用（usesFromMonth の結果をその人で絞ったもの） */
  function summary(o) {
    var asOf = o.asOf, profile = o.profile || {}, hire = hireOf(o.hireDate, profile);
    var auto = hire ? autoGrants(hire, profile, asOf) : [];
    var lots = lotsOf(auto, o.grants, null);
    var bal = balance(lots, o.uses, asOf);
    return { hire: hire, auto: auto, lots: lots, balance: bal, obligation: obligation5(lots, o.uses, asOf), next: hire ? nextGrant(hire, profile, asOf) : null, proportional: !!propRow(profile) };
  }
  /* L2 の注意: 雇用形態がパート・臨時なのに週の所定日数が入っていない */
  function needsWeekly(employmentType, profile) {
    var t = String(employmentType || '').toLowerCase();
    if (!/^(part|temp)/.test(t) && !/パート|アルバイト|臨時/.test(t)) return false;
    return num(profile && profile.weekly_days) == null;
  }

  var api = {
    NORMAL: NORMAL, PROP: PROP, isDate: isDate, addDays: addDays, addMonths: addMonths, diffDays: diffDays, expiresOf: expiresOf,
    hireOf: hireOf, autoGrants: autoGrants, nextGrant: nextGrant, lotsOf: lotsOf, balance: balance, obligation5: obligation5,
    usesFromMonth: usesFromMonth, summary: summary, needsWeekly: needsWeekly
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiLeave = api;
})(typeof window !== 'undefined' ? window : this);
