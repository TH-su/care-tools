/* revenue-calc.js — 入居者マスタの「💴 収支の見通し」の純関数（2026-11-07 新設・本人指示「ゴール：」2026-11-07）
 *
 * 画面（resident-master.html の収支タブ）と試験（check/unit/revenue_calc_test.js）が使う。
 * 通信・端末への保存・画面の部品には触らない（localStorage も読まない・書かない）。
 *
 * 約束（本人指示 2026-11-07 の流れ。数字は全部呼び出し側が渡す・ここに施設の値を書かない）:
 *   1. 介護報酬の見込み（1か月まるごと居た月）＝（介護度の区分支給限度基準額 − 差し引く単位（既定 2000））× 1単位の円
 *      限度額と1単位の円は週間計画の報酬マスタ（careLimits・feePerUnit）から渡す
 *   2. 入居した月は日割り。入居日が「差し引きをやめる日」（既定 5日）以降なら、その月は差し引かない（限度額 × 日割り）
 *   3. 介護報酬は提供した月の lag か月後（既定 2）の月末に入る（8/10 入居 → 8月分の日割りが10月末）
 *   4. 入院の日と退去の後の日は、その月の介護報酬を日割りで減らす（減った分は lag か月後の入金に出る）
 *      入院は from（入院した日）から to（戻った日）の前の日まで。to が空＝戻っていない（ずっと入院）
 *      退去は退去日まで居たとして数える
 *   5. 施設の利用料は前払い。入居した月に「その月の日割り＋翌月1か月分」、以後は毎月「翌月分」を受け取る
 *      退去した月は退去日までの日割りで、前の月に受け取る扱い（返金の時期のずれは見ない・仮置き）
 *      入院中も施設の利用料は変えない（仮置き）
 *   6. 円は1人・1か月ごとに四捨五入してから足す（合計と内訳の合計を一致させる）
 *   7. 介護報酬を訪問と通所に分ける時は、その方の週間計画の予定の基本単位の割合（visitShare＝訪問÷（訪問＋通所））で按分する。
 *      訪問＝四捨五入、通所＝残り（足すと介護報酬に一致）。割合が分からない方（予定が無い・入居予定）は「分けられない分」に入れる（2026-11-07 本人指示・割合の出し方は仮置き）
 */
(function (root) {
  'use strict';

  var VERSION = '2026-11-07';
  var LEVELS = ['要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))) && +s.slice(5, 7) >= 1 && +s.slice(5, 7) <= 12 && +s.slice(8, 10) >= 1 && +s.slice(8, 10) <= daysIn(s.slice(0, 7)); }
  function isYm(s) { return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) && +s.slice(5, 7) >= 1 && +s.slice(5, 7) <= 12; }
  function daysIn(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addMonths(ym, k) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }
  function monthDiff(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
  function num(v, d) { if (v === '' || v == null) return d; var n = Number(v); return (isFinite(n) && n >= 0) ? n : d; }

  /* 「要介護3」「介護3」「3」→「要介護3」。「要支援1」→そのまま。分からない時は ''（推測しない） */
  function normLevel(s) {
    var t = String(s == null ? '' : s).replace(/[\s　]/g, '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    var m = t.match(/^(?:要)?介護([1-5])$/) || t.match(/^([1-5])$/);
    if (m) return '要介護' + m[1];
    m = t.match(/^(?:要)?支援([12])$/);
    if (m) return '要支援' + m[1];
    return '';
  }

  /* ISO の時刻（UTC）→ 日本の日付 YYYY-MM-DD。読めなければ '' */
  function jstDate(iso) {
    var t = Date.parse(String(iso || ''));
    if (!isFinite(t)) return '';
    var d = new Date(t + 9 * 3600000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /* 入居者マスタの stateLog（新しい順・{ts, field:'hospitalized', val}）から入院の期間を作る。
     返すのは古い順の [{from, to}]（to＝戻った日・戻っていなければ ''）。
     ★同じ向きが続いた時（入院→入院）は最初の入院の日を残す。戻ったの記録だけがある時は捨てる */
  function absencesFromStateLog(log) {
    var a = Array.isArray(log) ? log.filter(function (e) { return e && e.field === 'hospitalized' && jstDate(e.ts); }) : [];
    a = a.slice().sort(function (x, y) { return Date.parse(x.ts) - Date.parse(y.ts); });
    var out = [], open = null;
    a.forEach(function (e) {
      var d = jstDate(e.ts);
      if (e.val === true) { if (!open) open = { from: d, to: '' }; }
      else if (e.val === false) { if (open) { open.to = d; if (open.to > open.from) out.push(open); open = null; } }
    });
    if (open) out.push(open);
    return out;
  }

  /* その月のうち、居た日（入居日〜退去日）と入院で居なかった日を数える */
  function daysOf(r, ym) {
    var md = daysIn(ym), first = ym + '-01', last = ym + '-' + pad2(md);
    var s = (r.admit && r.admit > first) ? r.admit : first;
    var e = (r.leave && r.leave < last) ? r.leave : last;
    if (s > e) return { stay: 0, absent: 0, md: md };
    var sd = +s.slice(8, 10), ed = +e.slice(8, 10), absent = 0;
    for (var d = sd; d <= ed; d++) {
      var ds = ym + '-' + pad2(d), out = false;
      for (var i = 0; i < r.absences.length; i++) {
        var ab = r.absences[i];
        if (ds >= ab.from && (!ab.to || ds < ab.to)) { out = true; break; }
      }
      if (out) absent++;
    }
    return { stay: ed - sd + 1, absent: absent, md: md };
  }

  /* 入力を確かめて整える（崩れた値は捨てて、知らせる文を warnings に足す） */
  function normResident(x, warnings) {
    var r = { key: String(x && x.key != null ? x.key : ''), name: String((x && x.name) || ''), level: normLevel(x && x.careLevel),
              admit: (x && isYmd(x.admit)) ? x.admit : '', leave: (x && isYmd(x.leave)) ? x.leave : '',
              planned: !!(x && x.planned), absences: [], notes: [],
              share: (x && typeof x.visitShare === 'number' && isFinite(x.visitShare) && x.visitShare >= 0 && x.visitShare <= 1) ? x.visitShare : null };
    if (x && x.admit && !r.admit) r.notes.push('入居日の形が読めません（入居した月の日割りを数えていません）');
    else if (!r.admit) r.notes.push('入居日が入っていません（入居した月の日割りを数えていません）');
    if (!r.level) r.notes.push('介護度が分かりません（介護報酬0円で数えています）');
    (Array.isArray(x && x.absences) ? x.absences : []).forEach(function (a) {
      if (!a || !isYmd(a.from)) return;
      var to = isYmd(a.to) ? a.to : '';
      if (to && to <= a.from) return;
      r.absences.push({ from: a.from, to: to });
    });
    if (r.admit && r.leave && r.leave < r.admit) { r.notes.push('退去日が入居日より前です（退去日を使いません）'); r.leave = ''; }
    if (r.notes.length && warnings) warnings.push({ key: r.key, name: r.name, notes: r.notes.slice() });
    return r;
  }

  /* 1人・1か月の数字 */
  function oneMonth(r, ym, p) {
    var dd = daysOf(r, ym), ratioStay = dd.stay / dd.md, ratioCare = (dd.stay - dd.absent) / dd.md;
    var admitHere = !!(r.admit && r.admit.slice(0, 7) === ym);
    var leaveHere = !!(r.leave && r.leave.slice(0, 7) === ym);
    var limit = r.level ? num(p.limits[r.level], 0) : 0;
    var deduct = (admitHere && +r.admit.slice(8, 10) >= p.cutoffDay) ? 0 : p.deductUnits;
    var fullUnits = Math.max(0, limit - deduct);
    var care = dd.stay ? Math.round(fullUnits * ratioCare * p.feePerUnit) : 0;
    var careFull = dd.stay ? Math.round(fullUnits * ratioStay * p.feePerUnit) : 0;
    var fee = r.level ? num(p.fees[r.level], 0) : 0;
    var fac = dd.stay ? Math.round(fee * ratioStay) : 0;
    return { stay: dd.stay, absent: dd.absent, md: dd.md, admitHere: admitHere, leaveHere: leaveHere,
             deducted: deduct > 0, care: care, careLostAbsent: careFull - care, facility: fac,
             limit: limit, units: fullUnits };
  }

  /* 本体。返すのは months（start から months か月）と、人ごとの内訳・前提・知らせる文 */
  function compute(input) {
    input = input || {};
    var warnings = [];
    var start = isYm(input.start) ? input.start : '';
    if (!start) return { ok: false, error: '始めの月が読めません', months: [], warnings: warnings };
    var n = Math.max(1, Math.min(36, Math.floor(num(input.months, 12)) || 12));
    var p = {
      limits: (input.limits && typeof input.limits === 'object') ? input.limits : {},
      fees: (input.fees && typeof input.fees === 'object') ? input.fees : {},
      feePerUnit: num(input.feePerUnit, 10),
      deductUnits: num(input.deductUnits, 2000),
      cutoffDay: Math.max(1, Math.min(31, Math.floor(num(input.cutoffDay, 5)) || 5)),
      lag: Math.max(0, Math.min(6, Math.floor(num(input.lagMonths, 2))))
    };
    var res = (Array.isArray(input.residents) ? input.residents : []).map(function (x) { return normResident(x, warnings); });
    var first = addMonths(start, -p.lag - 1), lastYm = addMonths(start, n);   /* 介護報酬は lag か月前の提供分・施設費は翌月分も要る */
    var span = monthDiff(first, lastYm) + 1;
    var months = [];
    for (var i = 0; i < n; i++) months.push({ ym: addMonths(start, i), facility: 0, facilityAccrual: 0, care: 0, careAccrual: 0, careLostAbsent: 0, total: 0, rows: [],
                                    careVisit: 0, careDay: 0, careOther: 0, careVisitAccrual: 0, careDayAccrual: 0, careOtherAccrual: 0 });

    res.forEach(function (r) {
      var per = {};
      for (var j = 0; j < span; j++) {
        var ym = addMonths(first, j);
        per[ym] = oneMonth(r, ym, p);
      }
      months.forEach(function (M) {
        var ym = M.ym, cur = per[ym], nx = per[addMonths(ym, 1)], svcYm = addMonths(ym, -p.lag), svc = per[svcYm];
        /* 施設費の入金: 入居した月はその月の分＋翌月分、それ以外は翌月分（翌月が入居した月なら翌月には入れない） */
        var facCash = 0;
        if (cur.admitHere) facCash += cur.facility;
        if (nx && !nx.admitHere) facCash += nx.facility;
        var row = { key: r.key, name: r.name, level: r.level, planned: r.planned,
                    facilityAccrual: cur.facility, facility: facCash,
                    careAccrual: cur.care, care: svc ? svc.care : 0, careFor: svcYm,
                    careLostAbsent: svc ? svc.careLostAbsent : 0,
                    stay: cur.stay, absent: cur.absent, md: cur.md,
                    svcStay: svc ? svc.stay : 0, svcAbsent: svc ? svc.absent : 0, svcMd: svc ? svc.md : 0,
                    svcAdmit: svc ? svc.admitHere : false, svcDeducted: svc ? svc.deducted : false,
                    admitHere: cur.admitHere, leaveHere: cur.leaveHere, notes: r.notes.slice() };
        if (!row.facility && !row.facilityAccrual && !row.care && !row.careAccrual && !row.stay && !row.svcStay) return;
        M.rows.push(row);
        M.facility += row.facility; M.facilityAccrual += row.facilityAccrual;
        M.care += row.care; M.careAccrual += row.careAccrual; M.careLostAbsent += row.careLostAbsent;
        var sc = splitCare(row.care, r.share), sa = splitCare(row.careAccrual, r.share);
        row.careVisit = sc.v; row.careDay = sc.d; row.careOther = sc.o; row.careVisitAccrual = sa.v; row.careDayAccrual = sa.d; row.careOtherAccrual = sa.o; row.visitShare = r.share;
        M.careVisit += sc.v; M.careDay += sc.d; M.careOther += sc.o; M.careVisitAccrual += sa.v; M.careDayAccrual += sa.d; M.careOtherAccrual += sa.o;
      });
    });
    months.forEach(function (M) { M.total = M.facility + M.care; M.totalAccrual = M.facilityAccrual + M.careAccrual; M.people = M.rows.filter(function (r) { return r.stay > 0; }).length; });
    return { ok: true, version: VERSION, start: start, months: months, warnings: warnings, params: p };
  }

  /* 介護報酬を訪問・通所・分けられない分に分ける（足すと元の額に一致） */
  function splitCare(yenAmt, share) {
    if (share == null) return { v: 0, d: 0, o: yenAmt };
    var v = Math.round(yenAmt * share);
    return { v: v, d: yenAmt - v, o: 0 };
  }

  /* 週間計画の1人分の予定から、訪問と通所の基本単位（1か月に直した値）を数え、訪問の割合を返す。
     rm＝週間計画の報酬マスタ（visitBase・sogoVisit・daycareBase）。数えられない時は null（推測しない）。
     ・予定に週間計画が数えた単位（ev.units・加算と減算を含む）があればそれを使う（週間計画の集計と同じ向きの割合になる）
     ・無い予定だけ基本単位で数える: 訪問＝visitBase[区分]、通所＝daycareBase[介護度][時間区分]（時間区分は週間計画と同じ決め方）
     ・週ごとの予定は × 4.3週（週間計画の月の換算と同じ）。総合事業の区分（sogoVisit）は月の単位を1回だけ数える */
  var WEEKS_PER_MONTH = 4.3;
  function dcTimeKey(st, et) {
    var a = String(st || '').split(':'), b = String(et || '').split(':');
    var m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]);
    if (!isFinite(m) || m <= 0) return '';
    if (m <= 240) return '3h'; if (m < 300) return '4h'; if (m < 360) return '5h'; if (m < 420) return '6h'; if (m < 480) return '7h';
    return '8h';
  }
  function serviceShare(events, careLevel, rm) {
    rm = rm || {};
    var vb = rm.visitBase || {}, sg = rm.sogoVisit || {}, db = rm.daycareBase || {}, lv = normLevel(careLevel);
    var v = 0, d = 0, seenSogo = {};
    (Array.isArray(events) ? events : []).forEach(function (ev) {
      if (!ev) return;
      var own = (typeof ev.units === 'number' && isFinite(ev.units) && ev.units > 0) ? ev.units : NaN;
      if (ev.serviceType === 'daycare') {
        var map = db[lv], k = dcTimeKey(ev.startTime, ev.endTime), u = isFinite(own) ? own : (map && Number(map[k]));
        if (isFinite(u) && u > 0) d += u * WEEKS_PER_MONTH;
        return;
      }
      var cat = String(ev.category || '');
      if (Object.prototype.hasOwnProperty.call(sg, cat)) {
        var su = isFinite(own) ? own : (sg[cat] && Number(sg[cat].units));
        if (!seenSogo[cat] && isFinite(su) && su > 0) { v += su; seenSogo[cat] = 1; }
        return;
      }
      var vu = isFinite(own) ? own : (Object.prototype.hasOwnProperty.call(vb, cat) ? Number(vb[cat]) : NaN);
      if (isFinite(vu) && vu > 0) v += vu * WEEKS_PER_MONTH;
    });
    if (v + d <= 0) return null;
    return v / (v + d);
  }

  /* 施設費の表（介護度 → 円）を確かめる。整数で 0〜1000000 の値だけを残す */
  function normFees(o) {
    var out = {};
    if (!o || typeof o !== 'object') return out;
    LEVELS.forEach(function (lv) {
      var v = o[lv];
      if (typeof v === 'string') v = v.replace(/[,，円\s]/g, '');
      var n = Number(v);
      if (v !== '' && v != null && isFinite(n) && n >= 0 && n <= 1000000 && Math.floor(n) === n) out[lv] = n;
    });
    return out;
  }

  /* 円の表示（3桁ごとの区切り）。負の数は「−」 */
  function yen(n) {
    var v = Math.round(Number(n) || 0), s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '−' : '') + s;
  }
  function ymLabel(ym) { return isYm(ym) ? (+ym.slice(0, 4)) + '年' + (+ym.slice(5, 7)) + '月' : ''; }

  var api = { VERSION: VERSION, LEVELS: LEVELS, compute: compute, normLevel: normLevel, jstDate: jstDate,
              absencesFromStateLog: absencesFromStateLog, daysIn: daysIn, addMonths: addMonths, isYmd: isYmd, isYm: isYm,
              normFees: normFees, yen: yen, ymLabel: ymLabel, serviceShare: serviceShare, splitCare: splitCare };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RevenueCalc = api;
})(typeof window !== 'undefined' ? window : this);
