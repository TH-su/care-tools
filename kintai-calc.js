/* kintai-calc.js — 勤怠管理の純関数（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1）
 * ════════════════════════════════════════════════════════════════
 * ・シフト（勤務表の記号）→ 予定の行、打刻の組み、予定との突き合わせ、丸め、集計、給与向け CSV を作る
 * ・画面（kintai.html）とは通信も DOM も持たない。試験は check/unit/kintai_calc_test.js
 * ・時刻は全部「1970年からのミリ秒」で扱い、日付・深夜の判定は日本時間（+09:00 固定・夏時間なし）
 * ・生の打刻は変えない。丸めは「数えた時刻」として別に出す（画面は生の打刻と並べて見せる）
 * ・丸めの決まり（代表者の依頼 2026-11-18）:
 *     予定より早い出勤 → 予定の開始から数える（早出を認めた日は打刻どおり）
 *     予定より遅い退勤 → 予定の終わりまで数える（残業を認めた日は打刻どおり）
 *     遅刻・早退・予定の無い勤務は打刻どおり（1日単位の切り捨てはしない・基発150号）
 *     境目（既定30分）以上ずれた打刻は「要確認」に出し、事務所が早出・残業を認めるかを決める
 *     ＝終業後・始業前に実際に働いた時間を黙って切り捨てないための口（厚労省ガイドライン）
 * ・氏名・番号などの個人情報をこのファイルに書かない（試験も架空の職員だけ）
 */
(function (root) {
  'use strict';
  var Sym = (typeof require !== 'undefined' && typeof window === 'undefined')
    ? require('./shift-symbols.js') : root.ShiftSymbols;

  var MIN = 60000, HOUR = 3600000, DAY = 86400000, JST = 9 * HOUR, DUP_MS = 10 * MIN, FIT_MS = 4 * HOUR;

  var DEFAULTS = {
    breakThresholdH: 6, breakH: 1, nightBreakH: 2,
    earlyAlertMin: 30, overtimeAlertMin: 30,
    noScheduleUnit: 1,
    variableMonth: true,
    monthRound30: false,
    overtimeMonthWarnH: 45,
    weekStartDow: 0,        // 週40時間を数える週の始まり（0=日曜・就業規則に定めが無ければ日曜）
    csvTime: 'hmm'
  };
  /* noScheduleUnit は 1 に固定（15分などで丸めると1日ごとの切り捨てになり基発150号に反する・反証レビュー指摘10） */
  var NUM_KEYS = { breakThresholdH: [0, 24], breakH: [0, 8], nightBreakH: [0, 8], earlyAlertMin: [0, 600],
    overtimeAlertMin: [0, 600], overtimeMonthWarnH: [0, 200], weekStartDow: [0, 6] };

  /* 設定を既定で埋める（壊れた値・範囲外は既定へ戻す＝起動不能にしない） */
  function fillConfig(c) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (!c || typeof c !== 'object') return out;
    for (k in NUM_KEYS) {
      var v = c[k];
      if (typeof v === 'number' && isFinite(v) && v >= NUM_KEYS[k][0] && v <= NUM_KEYS[k][1]) out[k] = v;
    }
    out.weekStartDow = Math.round(out.weekStartDow);
    if (typeof c.variableMonth === 'boolean') out.variableMonth = c.variableMonth;
    if (typeof c.monthRound30 === 'boolean') out.monthRound30 = c.monthRound30;
    if (c.csvTime === 'hmm' || c.csvTime === 'dec') out.csvTime = c.csvTime;
    return out;
  }

  /* ── 日付と時刻 ── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isYm(ym) { return typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym); }
  function daysIn(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function nextYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + pad(m); }
  function prevYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m < 1) { m = 12; y--; } return y + '-' + pad(m); }
  function dateOf(ym, d) { return ym + '-' + pad(d); }
  /* その日（日本時間）の 0:00 から min 分後のミリ秒 */
  function jstMs(date, min) { return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - JST + (min || 0) * MIN; }
  function jstDate(ms) { var d = new Date(ms + JST); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function jstHM(ms) { if (ms == null) return ''; var d = new Date(ms + JST); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function addDays(date, n) { return jstDate(jstMs(date, 0) + n * DAY + HOUR); }
  function iso(ms) { var d = new Date(ms + JST); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00+09:00'; }
  function toMs(v) { if (v == null || v === '') return null; if (typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? null : t; }
  function fmtMin(m, mode) {
    m = Math.round(m || 0);
    if (mode === 'dec') return (m / 60).toFixed(2);
    var neg = m < 0; m = Math.abs(m);
    return (neg ? '-' : '') + Math.floor(m / 60) + ':' + pad(m % 60);
  }
  function overlap(a0, a1, b0, b1) { var s = Math.max(a0, b0), e = Math.min(a1, b1); return e > s ? e - s : 0; }
  /* 22:00〜翌5:00 と [s,e) の重なり（分） */
  function nightMinutes(s, e) {
    if (s == null || e == null || e <= s) return 0;
    var total = 0, d = addDays(jstDate(s), -1), last = jstDate(e);
    for (var i = 0; i < 4; i++) {
      total += overlap(s, e, jstMs(d, 22 * 60), jstMs(d, 29 * 60));
      if (d === last) break;
      d = addDays(d, 1);
    }
    return Math.round(total / MIN);
  }

  var DIV_OFFICE = { '施設': 'facility', '訪問': 'visit', '通所': 'day' };
  var OFFICE_DIV = { facility: '施設', visit: '訪問', day: '通所' };

  /* シフトの職員を勤怠の名簿に出すか（勤務表・ワークスケジュールと同じ条件） */
  function staffVisible(st, ym) {
    if (!st || typeof st.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(st.id)) return false;
    if (st.active === false) return false;
    if (st.status === '休職' || st.status === '非表示') return false;
    if (st.retireMonth && isYm(st.retireMonth) && ym > st.retireMonth) return false;
    return true;
  }

  function cellOf(cells, d) {
    if (!cells) return '';
    var v = cells[String(d)];
    if (v == null) v = cells[pad(d)];
    return v == null ? '' : String(v);
  }

  /* ── 1. シフト → 予定の行 ──
   * opts: { ym, plan, nextPlan, staff:[シフトの職員], symbols, settings:シフトの settings }
   * 返す: { rows:[kintai_schedule の行], staff:[kintai_staff_sync の行], warnings:[{staff_id,date,msg}] } */
  function buildSchedule(opts) {
    var ym = opts.ym;
    if (!isYm(ym)) throw new Error('月の形が違います');
    var plan = opts.plan || {}, next = opts.nextPlan || {};
    var symbols = (opts.symbols && opts.symbols.length) ? opts.symbols : Sym.DEFAULT_SYMBOLS;
    var ss = opts.settings || {};
    var th = typeof ss.breakThresholdH === 'number' ? ss.breakThresholdH : DEFAULTS.breakThresholdH;
    var bh = typeof ss.breakH === 'number' ? ss.breakH : DEFAULTS.breakH;
    var nbh = typeof ss.nightBreakH === 'number' ? ss.nightBreakH : DEFAULTS.nightBreakH;
    var nd = daysIn(ym), rows = [], staffOut = [], warnings = [];
    var list = opts.staff || [];
    for (var i = 0; i < list.length; i++) {
      var st = list[i];
      if (!staffVisible(st, ym)) continue;
      var mainDiv = DIV_OFFICE[st.mainDivision] ? st.mainDivision : '施設';
      staffOut.push({ staff_id: st.id, name: String(st.name || '').slice(0, 60) || st.id, office: DIV_OFFICE[mainDiv],
        emp_code: st.empCode ? String(st.empCode).slice(0, 20) : null,
        employment: st.employment ? String(st.employment).slice(0, 20) : null, active: true });
      var sources = [{ div: mainDiv, cells: (plan.cells || {})[st.id], nextCells: (next.cells || {})[st.id] }];
      var subs = (plan.subCells || {})[st.id] || {}, nsubs = (next.subCells || {})[st.id] || {};
      for (var dv in subs) if (DIV_OFFICE[dv]) sources.push({ div: dv, cells: subs[dv], nextCells: nsubs[dv] });
      var seqOf = {};
      for (var d = 1; d <= nd; d++) {
        var date = dateOf(ym, d);
        for (var si = 0; si < sources.length; si++) {
          var src = sources[si], raw = cellOf(src.cells, d);
          if (!raw) continue;
          var p = Sym.parseCell(raw, symbols);
          if (p.error) warnings.push({ staff_id: st.id, date: date, msg: p.error });
          for (var k = 0; k < p.parts.length; k++) {
            var part = p.parts[k], row = null;
            if (part.kind === 'work' && part.startMin != null && part.endMin != null && part.endMin > part.startMin) {
              var bound = part.endMin - part.startMin;
              row = { kind: 'work', start_at: iso(jstMs(date, part.startMin)), end_at: iso(jstMs(date, part.endMin)),
                break_min: bound >= th * 60 ? Math.round(bh * 60) : 0, paid_min: 0 };
            } else if (part.kind === 'nightIn' && part.startMin != null) {
              var nraw = d < nd ? cellOf(src.cells, d + 1) : cellOf(src.nextCells, 1);
              var endMin = null;
              if (nraw) {
                var np = Sym.parseCell(nraw, symbols);
                for (var j = 0; j < np.parts.length; j++) if (np.parts[j].kind === 'nightOut' && np.parts[j].endMin != null) { endMin = np.parts[j].endMin; break; }
              }
              if (endMin == null) {
                endMin = part.pairEndMin;
                warnings.push({ staff_id: st.id, date: date, msg: '翌日の夜勤上がりが見つからないため定時の上がりで仮に置きました' });
              }
              if (endMin == null) { warnings.push({ staff_id: st.id, date: date, msg: '夜勤の上がりの時刻が分かりません' }); continue; }
              row = { kind: 'night', start_at: iso(jstMs(date, part.startMin)), end_at: iso(jstMs(date, 1440 + endMin)),
                break_min: Math.round(nbh * 60), paid_min: 0 };
            } else if (part.kind === 'paidOff') {
              row = { kind: 'paid', start_at: null, end_at: null, break_min: 0, paid_min: Math.round((part.fixedWork || 8) * 60) };
            }
            if (!row) continue;
            seqOf[date] = (seqOf[date] || 0) + 1;
            row.staff_id = st.id; row.work_date = date; row.seq = seqOf[date];
            row.office = DIV_OFFICE[src.div]; row.symbol = String(p.norm || raw).slice(0, 40);
            rows.push(row);
          }
        }
      }
    }
    return { rows: rows, staff: staffOut, warnings: warnings };
  }

  /* ── 2. 予定の行 → 勤務の塊（同じ人・同じ日で重なる・接する勤務を1つに） ── */
  function blocksOf(schedRows, cfg) {
    cfg = cfg || DEFAULTS;
    var by = {}, out = [], i, k;
    for (i = 0; i < schedRows.length; i++) {
      var r = schedRows[i];
      if (r.kind !== 'work' && r.kind !== 'night') continue;
      var s = toMs(r.start_at), e = toMs(r.end_at);
      if (s == null || e == null || e <= s) continue;
      var key = r.staff_id + '|' + r.work_date;
      (by[key] = by[key] || []).push({ s: s, e: e, br: Math.max(0, r.break_min || 0), office: r.office || null, night: r.kind === 'night', symbol: r.symbol || '', seq: r.seq || 0 });
    }
    for (k in by) {
      var parts = by[k].sort(function (a, b) { return a.s - b.s || a.seq - b.seq; });
      var cur = null, sid = k.split('|')[0], wd = k.split('|')[1];
      for (i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (cur && p.s <= cur.end) {
          cur.end = Math.max(cur.end, p.e); cur.breakMin = Math.max(cur.breakMin, p.br); cur.night = cur.night || p.night;
          cur.members.push(p);
        } else {
          cur = { staff_id: sid, work_date: wd, start: p.s, end: p.e, breakMin: p.br, night: p.night, members: [p] };
          out.push(cur);
        }
      }
    }
    for (i = 0; i < out.length; i++) {
      var b = out[i], share = {}, sum = 0, syms = [];
      for (k = 0; k < b.members.length; k++) {
        var m = b.members[k], w = Math.max(0, (m.e - m.s) / MIN - m.br);
        if (m.office) { share[m.office] = (share[m.office] || 0) + w; sum += w; }
        if (m.symbol && syms.indexOf(m.symbol) < 0) syms.push(m.symbol);
      }
      /* 2つ以上の行をまとめた塊は、まとめた拘束で休憩を決め直す（5h＋5h が休憩0のまま・6h＋6h が120分になるのを防ぐ・指摘8） */
      if (b.members.length > 1 && !b.night && (b.end - b.start) / MIN > cfg.breakThresholdH * 60) b.breakMin = Math.max(b.breakMin, Math.round(cfg.breakH * 60));
      b.schedWork = Math.max(0, Math.round((b.end - b.start) / MIN) - b.breakMin);
      b.office = b.members[0].office;
      b.officeShare = {};
      for (var o in share) b.officeShare[o] = sum > 0 ? share[o] / sum : 0;
      b.symbol = syms.join(' ');
      delete b.members;
    }
    out.sort(function (a, b) { return a.staff_id < b.staff_id ? -1 : a.staff_id > b.staff_id ? 1 : a.start - b.start; });
    return out;
  }

  /* ── 3. 打刻の組み ──
   * 取り消していない打刻を時刻順に: in で開く／開いているのに in → 前の組は退勤漏れ／開いていないのに out → 出勤漏れ
   * 開いた組から24時間を超える out は前の組に結ばない（前の組は退勤漏れ・この out は出勤漏れ） */
  function pairsOf(punches) {
    var list = [], i;
    for (i = 0; i < punches.length; i++) {
      var p = punches[i];
      if (p.voided_at) continue;
      var at = toMs(p.at);
      if (at == null || (p.kind !== 'in' && p.kind !== 'out')) continue;
      at = Math.floor(at / MIN) * MIN;   /* 秒は数えない（7:00:30 の出勤を遅刻1分にしない・指摘7） */
      list.push({ id: p.id, kind: p.kind, at: at, source: p.source || 'tablet' });
    }
    list.sort(function (a, b) { return a.at - b.at; });
    var pairs = [], open = null;
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      var lastP = pairs.length ? pairs[pairs.length - 1] : null;
      if (q.kind === 'in') {
        if (open && q.at - open.at <= DUP_MS) continue;          /* 10分以内の二度押しの出勤は前の方だけ（指摘6） */
        if (open) pairs.push({ in: open, out: null });
        open = q;
      } else if (open && q.at - open.at <= 24 * HOUR) {
        pairs.push({ in: open, out: q }); open = null;
      } else if (!open && lastP && lastP.out && q.at - lastP.out.at <= DUP_MS) {
        lastP.out = q;                                              /* 10分以内の二度押しの退勤は後の方 */
      } else {
        if (open) { pairs.push({ in: open, out: null }); open = null; }
        pairs.push({ in: null, out: q });
      }
    }
    if (open) pairs.push({ in: open, out: null });
    return pairs;
  }

  /* 組 → いちばん合う塊（[開始-3h, 終了+3h] に入るもののうち重なり最大・片方だけの組は近い方） */
  function matchPairs(pairs, blocks) {
    var free = [], i, work = [];
    for (i = 0; i < pairs.length; i++) {
      var pp = pairs[i];
      if (pp.in && pp.out && blocks.length) {
        var fits = false;
        for (var jj = 0; jj < blocks.length; jj++) {
          var bb = blocks[jj];
          if (pp.in.at >= bb.start - FIT_MS && pp.in.at <= bb.end + FIT_MS && pp.out.at >= bb.start - FIT_MS && pp.out.at <= bb.end + FIT_MS) { fits = true; break; }
        }
        /* どの塊にも両端が入らないのに、どちらかの端は塊に近い＝退勤漏れの次の日の出勤漏れ（指摘5）。分けて合わせる */
        var near = false;
        for (jj = 0; jj < blocks.length && !fits; jj++) {
          var bc = blocks[jj];
          if ((pp.in.at >= bc.start - 3 * HOUR && pp.in.at <= bc.end + 3 * HOUR) || (pp.out.at >= bc.start - 3 * HOUR && pp.out.at <= bc.end + 3 * HOUR)) near = true;
        }
        if (!fits && near) { work.push({ in: pp.in, out: null }); work.push({ in: null, out: pp.out }); continue; }
      }
      work.push(pp);
    }
    pairs = work;
    for (i = 0; i < pairs.length; i++) {
      var pr = pairs[i], best = null, bestScore = -Infinity;
      var a = pr.in ? pr.in.at : null, z = pr.out ? pr.out.at : null;
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j], w0 = b.start - 3 * HOUR, w1 = b.end + 3 * HOUR, score;
        var inWin = (a != null && a >= w0 && a <= w1) || (z != null && z >= w0 && z <= w1);
        if (!inWin) continue;
        if (a != null && z != null) score = overlap(a, z, b.start, b.end) - Math.abs(a - b.start) / 1000;
        else if (a != null) score = -Math.abs(a - b.start);
        else score = -Math.abs(z - b.end);
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (best) best.pairs.push(pr); else free.push(pr);
    }
    return free;
  }

  var FLAG_LABEL = {
    early: '始業前の打刻（早出の確認）', overtime: '終業後の打刻（残業の確認）',
    missing_out: '退勤の打刻がありません', missing_in: '出勤の打刻がありません',
    no_punch: '打刻がありません（欠勤か打刻漏れ）', no_schedule: '予定の無い勤務',
    offline: '通信できない時の打刻（端末の時刻）', office: '事務所が足した打刻',
    late: '遅刻', early_leave: '早退', after_lock: '締めた後の打刻'
  };
  var REVIEW = { early: 1, overtime: 1, missing_out: 1, missing_in: 1, no_punch: 1, no_schedule: 1, offline: 1, after_lock: 1 };


  /* 塊1つを数える */
  function countBlock(b, day, cfg, nowMs) {
    var r = { staff_id: b.staff_id, work_date: b.work_date, sched: b.start != null,
      schedStart: b.start, schedEnd: b.end, schedBreak: b.breakMin || 0, schedWork: b.schedWork || 0,
      symbol: b.symbol || '', office: b.office || null, officeShare: b.officeShare || {}, night: !!b.night,
      punches: [], countStart: null, countEnd: null, breakMin: 0, workMin: 0, nightMin: 0,
      overtimeMin: 0, lateMin: 0, earlyLeaveMin: 0, flags: [] };
    var pairs = (b.pairs || []).slice().sort(function (x, y) { return ((x.in || x.out).at) - ((y.in || y.out).at); });
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].in) r.punches.push(pairs[i].in);
      if (pairs[i].out) r.punches.push(pairs[i].out);
      if (!pairs[i].in) r.flags.push('missing_in');
      if (!pairs[i].out) r.flags.push('missing_out');
    }
    for (i = 0; i < r.punches.length; i++) {
      if (r.punches[i].source === 'offline' && r.flags.indexOf('offline') < 0) r.flags.push('offline');
      if (r.punches[i].source === 'office' && r.flags.indexOf('office') < 0) r.flags.push('office');
    }
    if (!pairs.length) {
      if (r.sched && b.end < nowMs) r.flags.push('no_punch');
      return r;
    }
    var full = [];
    for (i = 0; i < pairs.length; i++) if (pairs[i].in && pairs[i].out) full.push([pairs[i].in.at, pairs[i].out.at]);
    if (!full.length) return r;
    var first = full[0], last = full[full.length - 1];
    var cs = first[0], ce = last[1];
    if (r.sched) {
      if (cs < b.start) {
        if ((b.start - cs) / MIN >= cfg.earlyAlertMin && !(day && day.early_ok)) r.flags.push('early');
        if (!(day && day.early_ok)) cs = b.start;
      } else if (cs > b.start) { r.lateMin = Math.round((cs - b.start) / MIN); r.flags.push('late'); }
      if (ce > b.end) {
        if ((ce - b.end) / MIN >= cfg.overtimeAlertMin && !(day && day.overtime_ok)) r.flags.push('overtime');
        if (!(day && day.overtime_ok)) ce = b.end;
      } else if (ce < b.end) { r.earlyLeaveMin = Math.round((b.end - ce) / MIN); r.flags.push('early_leave'); }
    } else {
      r.flags.push('no_schedule');
    }
    /* 数えた区間（最初の組の頭と最後の組の尻だけを丸める・間の組は打刻どおり） */
    var segs = [];
    for (i = 0; i < full.length; i++) {
      var s = i === 0 ? cs : full[i][0], e = i === full.length - 1 ? ce : full[i][1];
      if (full.length === 1) { s = cs; e = ce; }
      if (e > s) segs.push([s, e]);
    }
    var bound = 0, night = 0, gap = 0;
    for (i = 0; i < segs.length; i++) {
      bound += (segs[i][1] - segs[i][0]) / MIN; night += nightMinutes(segs[i][0], segs[i][1]);
      if (i > 0) gap += (segs[i][0] - segs[i - 1][1]) / MIN;
    }
    bound = Math.round(bound); gap = Math.round(gap);
    var span = bound + gap, br;   /* span＝最初の出勤から最後の退勤まで（打刻した昼休みを含む） */
    /* 休憩は「6時間を超える時」だけ（労基法34条・ちょうど6時間は引かない・夜勤を途中で帰った日も同じ・指摘2・14）。
       昼休みを打刻した日は、打刻の間の時間がもう休憩なので、予定の休憩からその分を引く（二重に引かない・指摘1） */
    if (day && typeof day.break_min === 'number') br = Math.max(0, day.break_min - gap);
    else if (r.sched) br = span > cfg.breakThresholdH * 60 ? Math.max(0, r.schedBreak - gap) : 0;
    else br = span > cfg.breakThresholdH * 60 ? Math.max(0, Math.round(cfg.breakH * 60) - gap) : 0;
    br = Math.min(br, bound);
    r.countStart = segs.length ? segs[0][0] : null;
    r.countEnd = segs.length ? segs[segs.length - 1][1] : null;
    r.breakMin = br;
    r.workMin = Math.max(0, bound - br);
    r.nightMin = b.night ? Math.max(0, night - br) : night;
    r.overtimeMin = r.sched ? Math.max(0, r.workMin - r.schedWork) : r.workMin;
    return r;
  }

  /* ── 4. 月の計算 ──
   * opts: { ym, staff:[kintai_staff], schedule:[kintai_schedule], punches:[kintai_punches], days:[kintai_days],
   *         config, now(ミリ秒・省略は今), lockedAt(締めた時刻・省略可) }
   * 返す: { ym, config, people:[{ staff, days:[{date, blocks, paidMin, workMin, legalOverMin, flags}], sum }], totals } */
  function computeMonth(opts) {
    var ym = opts.ym;
    if (!isYm(ym)) throw new Error('月の形が違います');
    var cfg = fillConfig(opts.config);
    var nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    var lockedMs = toMs(opts.lockedAt);
    var first = dateOf(ym, 1), lastD = dateOf(ym, daysIn(ym));
    var staff = opts.staff || [], i, j;
    var schedBy = {}, punchBy = {}, dayBy = {}, paidBy = {};
    (opts.schedule || []).forEach(function (r) {
      (schedBy[r.staff_id] = schedBy[r.staff_id] || []).push(r);
      if (r.kind === 'paid' && r.work_date >= first && r.work_date <= lastD) {
        var k = r.staff_id + '|' + r.work_date; paidBy[k] = (paidBy[k] || 0) + (r.paid_min || 0);
      }
    });
    (opts.punches || []).forEach(function (p) { (punchBy[p.staff_id] = punchBy[p.staff_id] || []).push(p); });
    (opts.days || []).forEach(function (d) { dayBy[d.staff_id + '|' + d.work_date] = d; });
    var people = [];
    var known = {};
    for (i = 0; i < staff.length; i++) known[staff[i].staff_id] = 1;
    /* 名簿に無いのに打刻・予定がある人も落とさない（名簿から外れた人の打刻を黙って消さない） */
    var extra = [];
    for (var sid in punchBy) if (!known[sid]) { known[sid] = 1; extra.push({ staff_id: sid, name: sid, office: null, emp_code: null, active: false, missingStaff: true }); }
    for (sid in schedBy) if (!known[sid]) { known[sid] = 1; extra.push({ staff_id: sid, name: sid, office: null, emp_code: null, active: false, missingStaff: true }); }
    var all = staff.concat(extra);
    for (i = 0; i < all.length; i++) {
      var st = all[i];
      var blocks = blocksOf(schedBy[st.staff_id] || [], cfg);
      /* 塊の事業所は主区分（名簿の主事業所）の行があればそれ（開始の早い副区分の行にしない・指摘9） */
      for (j = 0; j < blocks.length; j++) if (st.office && blocks[j].officeShare[st.office] != null) blocks[j].office = st.office;
      for (j = 0; j < blocks.length; j++) blocks[j].pairs = [];
      var free = matchPairs(pairsOf(punchBy[st.staff_id] || []), blocks);
      for (j = 0; j < free.length; j++) {
        var f = free[j], at = (f.in || f.out).at;
        blocks.push({ staff_id: st.staff_id, work_date: jstDate(at), start: null, end: null, breakMin: 0, schedWork: 0, office: st.office || null, officeShare: {}, night: false, symbol: '', pairs: [f] });
      }
      var byDate = {}, rawBy = {};
      for (j = 0; j < blocks.length; j++) {
        if (blocks[j].work_date < first || blocks[j].work_date > lastD) continue;
        (rawBy[blocks[j].work_date] = rawBy[blocks[j].work_date] || []).push(blocks[j]);
      }
      /* 休憩を直した日に塊が2つ以上ある時は、打刻のある最初の塊にだけ直した休憩を当てる（ほかは予定どおり・指摘13） */
      var target = {};
      for (var rd in rawBy) {
        var dn0 = dayBy[st.staff_id + '|' + rd];
        if (!dn0 || typeof dn0.break_min !== 'number') continue;
        var cand = rawBy[rd].slice().sort(function (x, y) { return (x.start || ((x.pairs[0].in || x.pairs[0].out).at)) - (y.start || ((y.pairs[0].in || y.pairs[0].out).at)); });
        target[rd] = cand[0];
        for (var ci = 0; ci < cand.length; ci++) if (cand[ci].pairs.some(function (pp) { return pp.in && pp.out; })) { target[rd] = cand[ci]; break; }
      }
      for (j = 0; j < blocks.length; j++) {
        var b = blocks[j];
        if (b.work_date < first || b.work_date > lastD) continue;
        var dnB = dayBy[st.staff_id + '|' + b.work_date];
        if (dnB && typeof dnB.break_min === 'number' && target[b.work_date] !== b) dnB = { early_ok: dnB.early_ok, overtime_ok: dnB.overtime_ok };
        var cb = countBlock(b, dnB, cfg, nowMs);
        if (!b.start && cb.office === null) cb.office = st.office || null;
        if (!b.start && cb.office) { cb.officeShare = {}; cb.officeShare[cb.office] = 1; }
        if (lockedMs != null) for (var q = 0; q < cb.punches.length; q++) {
          var src = (punchBy[st.staff_id] || []).filter(function (p) { return p.id === cb.punches[q].id; })[0];
          if (src && toMs(src.created_at) > lockedMs && cb.flags.indexOf('after_lock') < 0) cb.flags.push('after_lock');
        }
        (byDate[b.work_date] = byDate[b.work_date] || []).push(cb);
      }
      for (var pk in paidBy) if (pk.indexOf(st.staff_id + '|') === 0) { var pd = pk.split('|')[1]; byDate[pd] = byDate[pd] || []; }
      var dates = Object.keys(byDate).sort(), days = [];
      var sum = { workDays: 0, paidDays: 0, paidMin: 0, workMin: 0, schedInMin: 0, overtimeMin: 0, legalOverMin: 0, nightMin: 0,
        lateCount: 0, lateMin: 0, earlyLeaveCount: 0, earlyLeaveMin: 0, noPunchDays: 0, reviewCount: 0, byOffice: {}, warnings: [] };
      for (j = 0; j < dates.length; j++) {
        var date = dates[j], bl = byDate[date].sort(function (x, y) { return (x.schedStart || x.countStart || 0) - (y.schedStart || y.countStart || 0); });
        var dw = 0, dsw = 0, dflags = [], noPunchAll = bl.length > 0, dnote = dayBy[st.staff_id + '|' + date];
        for (var x = 0; x < bl.length; x++) {
          var c = bl[x];
          dw += c.workMin; dsw += c.schedWork;
          if (c.flags.indexOf('no_punch') < 0) noPunchAll = false;
          sum.nightMin += c.nightMin; sum.overtimeMin += c.overtimeMin;
          if (c.lateMin > 0) { sum.lateCount++; sum.lateMin += c.lateMin; }
          if (c.earlyLeaveMin > 0) { sum.earlyLeaveCount++; sum.earlyLeaveMin += c.earlyLeaveMin; }
          var rv = false;
          for (var fl = 0; fl < c.flags.length; fl++) {
            if (dflags.indexOf(c.flags[fl]) < 0) dflags.push(c.flags[fl]);
            if (REVIEW[c.flags[fl]]) rv = true;
          }
          if (rv) sum.reviewCount++;   /* 要確認は勤務（塊）ごとに1件（印の数で数えない・指摘15） */
          for (var of in c.officeShare) sum.byOffice[of] = (sum.byOffice[of] || 0) + c.workMin * c.officeShare[of];
        }
        var paidMin = paidBy[st.staff_id + '|' + date] || 0;
        var legal = Math.max(0, dw - (cfg.variableMonth ? Math.max(480, dsw) : 480));
        sum.legalOverMin += legal; sum.workMin += dw;
        if (dw > 0) sum.workDays++;
        if (paidMin > 0) { sum.paidDays++; sum.paidMin += paidMin; }
        if (noPunchAll && bl.length && paidMin === 0) sum.noPunchDays++;
        days.push({ date: date, blocks: bl, paidMin: paidMin, workMin: dw, schedWorkMin: dsw, legalOverMin: legal, flags: dflags, note: dnote || null });
      }
      /* 週・月の枠を超えた分も法定外（労基法32条・指摘11）。日の法定外として数えた分は二重に数えない。
         変形なし: 週（weekStartDow 始まり）の実働−日の法定外 が40時間を超えた分。月をまたぐ週はこの月の日だけで数える（仮置き）
         変形あり: 月の実働−日の法定外 が 40時間×月の日数÷7 を超えた分（週ごとの枠の判定は仮置きで行わない） */
      var dailyLegal = sum.legalOverMin;
      if (!cfg.variableMonth) {
        var weeks = {};
        for (var wi = 0; wi < days.length; wi++) {
          var dd = days[wi], dow = new Date(jstMs(dd.date, 12 * 60)).getUTCDay();
          var wkey = addDays(dd.date, -((dow - cfg.weekStartDow + 7) % 7));
          weeks[wkey] = (weeks[wkey] || 0) + dd.workMin - dd.legalOverMin;
        }
        for (var wk in weeks) sum.legalOverMin += Math.max(0, weeks[wk] - 2400);
      } else {
        var frame = Math.floor(2400 * daysIn(ym) / 7);
        sum.legalOverMin += Math.max(0, sum.workMin - dailyLegal - frame);
      }
      for (var ko in sum.byOffice) sum.byOffice[ko] = Math.round(sum.byOffice[ko]);
      if (cfg.monthRound30) { sum.overtimeMin = round30(sum.overtimeMin); sum.legalOverMin = round30(sum.legalOverMin); sum.nightMin = round30(sum.nightMin); }
      sum.schedInMin = Math.max(0, sum.workMin - sum.overtimeMin);   /* 端数を丸めた後で出す＝所定内＋残業＝総労働（指摘12） */
      if (sum.legalOverMin >= cfg.overtimeMonthWarnH * 60 && cfg.overtimeMonthWarnH > 0) sum.warnings.push('法定外の時間が月' + cfg.overtimeMonthWarnH + '時間以上です（36協定の確認）');
      if (st.missingStaff) sum.warnings.push('職員の名簿に無い番号の記録です（シフトから外れた職員）');
      people.push({ staff: st, days: days, sum: sum });
    }
    return { ym: ym, config: cfg, people: people };
  }
  /* 1か月の合計の1時間未満を 30分未満は切り捨て・30分以上は切り上げ（基発150号の範囲） */
  function round30(m) { var r = m % 60; return r >= 30 ? m - r + 60 : m - r; }

  /* ── 5. CSV ── */
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   /* 表計算ソフトで式として読まれないように */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvLine(arr) { return arr.map(csvCell).join(','); }
  function officeLabel(code, nameOf) { if (!code) return ''; var d = OFFICE_DIV[code] || code; return nameOf ? (nameOf(d) || d) : d; }

  var SUMMARY_HEAD = ['従業員コード', '氏名', '主事業所', '出勤日数', '有休日数', '総労働時間', '所定内', '残業', '法定外', '深夜', '遅刻回数', '遅刻時間', '早退回数', '早退時間', '打刻なし日数', '要確認件数'];
  var DAILY_HEAD = ['従業員コード', '勤務日', '出勤時刻', '退勤時刻', '休憩分', '実働', '深夜', '事業所', 'シフト記号', '備考'];

  /* opts: { month: computeMonth の結果, nameOf: 区分→事業所名（省略可） }
   * 返す: { summary, daily, warnings:[文] } （どちらも CRLF・先頭に見出し） */
  function buildCsv(month, opts) {
    opts = opts || {};
    var mode = month.config.csvTime, nameOf = opts.nameOf, warnings = [];
    var S = [csvLine(SUMMARY_HEAD)], D = [csvLine(DAILY_HEAD)];
    for (var i = 0; i < month.people.length; i++) {
      var p = month.people[i], st = p.staff, s = p.sum;
      var has = s.workMin > 0 || s.paidMin > 0 || s.noPunchDays > 0 || s.reviewCount > 0;   /* 欠けた打刻だけの人も落とさない（指摘4） */
      if (!st.emp_code) { if (has) warnings.push((st.name || st.staff_id) + ' さんは従業員コードが無いので出していません'); continue; }
      if (!has) continue;
      S.push(csvLine([st.emp_code, st.name, officeLabel(st.office, nameOf), s.workDays, s.paidDays, fmtMin(s.workMin, mode), fmtMin(s.schedInMin, mode),
        fmtMin(s.overtimeMin, mode), fmtMin(s.legalOverMin, mode), fmtMin(s.nightMin, mode), s.lateCount, fmtMin(s.lateMin, mode),
        s.earlyLeaveCount, fmtMin(s.earlyLeaveMin, mode), s.noPunchDays, s.reviewCount]));
      for (var j = 0; j < p.days.length; j++) {
        var d = p.days[j];
        if (d.paidMin > 0 && !d.blocks.some(function (b) { return b.workMin > 0; })) {
          D.push(csvLine([st.emp_code, d.date, '', '', 0, fmtMin(0, mode), fmtMin(0, mode), '', '有', '有休 ' + fmtMin(d.paidMin, 'hmm')]));
          continue;
        }
        for (var k = 0; k < d.blocks.length; k++) {
          var b = d.blocks[k];
          if (b.countStart == null && !b.flags.some(function (fx) { return REVIEW[fx]; })) continue;   /* 打刻の欠けた日も行に出す（指摘3） */
          var notes = [];
          for (var f = 0; f < b.flags.length; f++) if (REVIEW[b.flags[f]]) notes.push(FLAG_LABEL[b.flags[f]]);
          D.push(csvLine([st.emp_code, d.date, jstHM(b.countStart), jstHM(b.countEnd), b.breakMin, fmtMin(b.workMin, mode), fmtMin(b.nightMin, mode),
            officeLabel(b.office, nameOf), b.symbol, notes.join('・')]));
        }
      }
    }
    return { summary: S.join('\r\n') + '\r\n', daily: D.join('\r\n') + '\r\n', warnings: warnings };
  }

  /* ── 6. Shift_JIS（cp932）へ ──
   * 表を埋め込まず、TextDecoder('shift_jis') の逆引きをその場で作る（全部の漢字に対応）。
   * 表に無い文字は '?' にして unknown に返す（画面で知らせる） */
  var sjisMap = null;
  function sjisTable(Dec) {
    if (sjisMap) return sjisMap;
    var D = Dec || (typeof TextDecoder !== 'undefined' ? TextDecoder : null);
    if (!D) throw new Error('この端末では Shift_JIS に変えられません');
    var dec = new D('shift_jis'), map = {}, b = new Uint8Array(2), one = new Uint8Array(1);
    for (var c = 0xA1; c <= 0xDF; c++) { one[0] = c; var h = dec.decode(one); if (h.length === 1 && h !== '�' && !(h in map)) map[h] = [c]; }
    var leads = [];
    for (c = 0x81; c <= 0x9F; c++) leads.push(c);
    for (c = 0xE0; c <= 0xFC; c++) leads.push(c);
    for (var i = 0; i < leads.length; i++) {
      for (var t = 0x40; t <= 0xFC; t++) {
        if (t === 0x7F) continue;
        b[0] = leads[i]; b[1] = t;
        var ch = dec.decode(b);
        if (ch.length === 1 && ch !== '�' && !(ch in map)) map[ch] = [leads[i], t];
      }
    }
    sjisMap = map;
    return map;
  }
  function encodeSjis(str, Dec) {
    var map = sjisTable(Dec), out = [], unknown = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i), code = str.charCodeAt(i);
      if (code < 0x80) { out.push(code); continue; }
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) { ch = str.slice(i, i + 2); i++; }   /* 絵文字など2つで1文字 */
      var m = map[ch];
      if (m) { for (var k = 0; k < m.length; k++) out.push(m[k]); }
      else { out.push(0x3F); if (unknown.indexOf(ch) < 0) unknown.push(ch); }
    }
    return { bytes: new Uint8Array(out), unknown: unknown };
  }

  /* ── 7. 打刻番号（画面の入力の確かめ・DB も同じ形で断る） ── */
  function isCode(s) { return typeof s === 'string' && /^[0-9]{4,6}$/.test(s); }

  /* 月の締めの snapshot（集計だけ・氏名は入れない） */
  function snapshotOf(month) {
    var rows = [];
    for (var i = 0; i < month.people.length; i++) {
      var p = month.people[i], s = p.sum;
      rows.push({ staff_id: p.staff.staff_id, emp_code: p.staff.emp_code || null, workDays: s.workDays, paidDays: s.paidDays,
        workMin: s.workMin, schedInMin: s.schedInMin, overtimeMin: s.overtimeMin, legalOverMin: s.legalOverMin, nightMin: s.nightMin,
        lateCount: s.lateCount, lateMin: s.lateMin, earlyLeaveCount: s.earlyLeaveCount, earlyLeaveMin: s.earlyLeaveMin,
        noPunchDays: s.noPunchDays, reviewCount: s.reviewCount, byOffice: s.byOffice });
    }
    return { v: 1, ym: month.ym, config: month.config, rows: rows };
  }

  var api = {
    DEFAULTS: DEFAULTS, FLAG_LABEL: FLAG_LABEL, REVIEW: REVIEW, DIV_OFFICE: DIV_OFFICE, OFFICE_DIV: OFFICE_DIV,
    SUMMARY_HEAD: SUMMARY_HEAD, DAILY_HEAD: DAILY_HEAD,
    fillConfig: fillConfig, isYm: isYm, daysIn: daysIn, nextYm: nextYm, prevYm: prevYm, jstMs: jstMs, jstDate: jstDate, jstHM: jstHM,
    addDays: addDays, iso: iso, fmtMin: fmtMin, nightMinutes: nightMinutes, staffVisible: staffVisible,
    buildSchedule: buildSchedule, blocksOf: blocksOf, pairsOf: pairsOf, computeMonth: computeMonth, round30: round30,
    buildCsv: buildCsv, csvCell: csvCell, encodeSjis: encodeSjis, isCode: isCode, snapshotOf: snapshotOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiCalc = api;
})(typeof window !== 'undefined' ? window : this);
