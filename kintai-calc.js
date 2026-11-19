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
  /* v2: 予定の開始からこの分を過ぎて打刻が無ければ「まだ出勤していません」（設定にしない固定値）。
     予定の無い勤務は出勤からこの時間までを「勤務中」とみなす */
  var NOT_IN_GRACE_MIN = 15, WORKING_NO_SCHED_MS = 16 * HOUR;

  var DEFAULTS = {
    breakThresholdH: 6, breakH: 1, nightBreakH: 2,
    earlyAlertMin: 30, overtimeAlertMin: 30,
    noScheduleUnit: 1,
    variableMonth: true,
    monthRound30: false,
    overtimeMonthWarnH: 45,
    weekStartDow: 0,        // 週40時間を数える週の始まり（0=日曜・就業規則に定めが無ければ日曜）
    csvTime: 'hmm',
    legal_holiday: null,    // 法定休日の曜日（null＝決めない／0=日曜〜6=土曜・v2 2026-11-19。キーは凍結仕様どおりの名前）
    close_day: 0            // 締め日（0＝月末・1〜28・0101）。期間そのものは DB が決める（計算は渡された期間を使う）。設定の保存でこの値を落とさないために持つ
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
    var lh = checkLegalHoliday(c.legal_holiday);
    if (lh.ok) out.legal_holiday = lh.value;
    if (typeof c.close_day === 'number' && c.close_day >= 0 && c.close_day <= 28 && Math.floor(c.close_day) === c.close_day) out.close_day = c.close_day;
    return out;
  }
  /* 法定休日の設定の確かめ（v2）: null・undefined・'' は「決めない」、0〜6 の整数（または '0'〜'6'）は曜日。
   * 返す: { ok, value:null|0〜6 } （ok=false の時 value は null＝決めないに戻す） */
  function checkLegalHoliday(v) {
    if (v == null || v === '') return { ok: true, value: null };
    if (typeof v === 'string' && /^[0-6]$/.test(v)) return { ok: true, value: +v };
    if (typeof v === 'number' && v >= 0 && v <= 6 && Math.floor(v) === v) return { ok: true, value: v };
    return { ok: false, value: null };
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
    if (open) pairs.push({ in: open, out: null, open: true });   /* 最後に開いたままの組＝まだ勤務中かもしれない（v2） */
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
    late: '遅刻', early_leave: '早退', after_lock: '締めた後の打刻',
    working: '勤務中', not_in_yet: 'まだ出勤していません', checked: '確認済み', absent: '欠勤'
  };
  var REVIEW = { early: 1, overtime: 1, missing_out: 1, missing_in: 1, no_punch: 1, no_schedule: 1, offline: 1, after_lock: 1 };


  /* 塊1つを数える
   * day: kintai_days の行（早出・残業の承認・休憩の直し・v2 の day_mark / early_from / ot_until）
   * v2 で足したキー: working・checked・absent（真偽）、uncountedMin（打刻のうち数えなかった分）、holidayMin（法定休日の暦日に入る実働）
   * v2 で足した印（flags）: working・not_in_yet・checked・absent（どれも要確認ではない） */
  function countBlock(b, day, cfg, nowMs) {
    var r = { staff_id: b.staff_id, work_date: b.work_date, sched: b.start != null,
      schedStart: b.start, schedEnd: b.end, schedBreak: b.breakMin || 0, schedWork: b.schedWork || 0,
      symbol: b.symbol || '', office: b.office || null, officeShare: b.officeShare || {}, night: !!b.night,
      punches: [], countStart: null, countEnd: null, breakMin: 0, workMin: 0, nightMin: 0,
      overtimeMin: 0, lateMin: 0, earlyLeaveMin: 0, flags: [],
      working: false, checked: false, absent: false, uncountedMin: 0, holidayMin: 0 };
    var pairs = (b.pairs || []).slice().sort(function (x, y) { return ((x.in || x.out).at) - ((y.in || y.out).at); });
    var lastPair = pairs.length ? pairs[pairs.length - 1] : null;
    /* 勤務中: 最後の組が開いたまま（そのあとに打刻が無い）で、予定の終わり＋猶予（overtimeAlertMin）が今より後。
       予定が無い時は出勤から16時間より前。退勤漏れにせず、要確認にも数えない（v2-1） */
    if (lastPair && lastPair.open && lastPair.in && nowMs != null) {
      var until = r.sched ? b.end + cfg.overtimeAlertMin * MIN : lastPair.in.at + WORKING_NO_SCHED_MS;
      if (until > nowMs) r.working = true;
    }
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].in) r.punches.push(pairs[i].in);
      if (pairs[i].out) r.punches.push(pairs[i].out);
      if (!pairs[i].in) r.flags.push('missing_in');
      if (!pairs[i].out && !(r.working && pairs[i] === lastPair)) r.flags.push('missing_out');
    }
    if (r.working) r.flags.push('working');
    for (i = 0; i < r.punches.length; i++) {
      if (r.punches[i].source === 'offline' && r.flags.indexOf('offline') < 0) r.flags.push('offline');
      if (r.punches[i].source === 'office' && r.flags.indexOf('office') < 0) r.flags.push('office');
    }
    if (!pairs.length) {
      if (r.sched && b.end < nowMs) r.flags.push('no_punch');
      else if (r.sched && b.start + NOT_IN_GRACE_MIN * MIN < nowMs) r.flags.push('not_in_yet');   /* 予定の開始＋15分を過ぎて終わりはまだ（v2-2） */
      return markDay(r, day);
    }
    var full = [];
    for (i = 0; i < pairs.length; i++) if (pairs[i].in && pairs[i].out) full.push([pairs[i].in.at, pairs[i].out.at]);
    if (!full.length) return markDay(r, day);
    var first = full[0], last = full[full.length - 1];
    var cs = first[0], ce = last[1];
    var earlyFrom = day ? toMs(day.early_from) : null, otUntil = day ? toMs(day.ot_until) : null;
    if (r.sched) {
      if (cs < b.start) {
        if (day && day.early_ok) { /* 早出を全部認めた日は打刻どおり */ }
        else if (earlyFrom != null) cs = Math.max(cs, Math.min(earlyFrom, b.start));   /* この時刻から認める（予定の開始より後にはしない・v2-4） */
        else {
          if ((b.start - cs) / MIN >= cfg.earlyAlertMin) r.flags.push('early');
          cs = b.start;
        }
      } else if (cs > b.start) { r.lateMin = Math.round((cs - b.start) / MIN); r.flags.push('late'); }
      if (ce > b.end) {
        if (day && day.overtime_ok) { /* 残業を全部認めた日は打刻どおり */ }
        else if (otUntil != null) ce = Math.max(b.end, Math.min(ce, otUntil));   /* この時刻まで認める（予定の終わりより前にはしない・v2-4） */
        else {
          if ((ce - b.end) / MIN >= cfg.overtimeAlertMin) r.flags.push('overtime');
          ce = b.end;
        }
      } else if (ce < b.end && !r.working) { r.earlyLeaveMin = Math.round((b.end - ce) / MIN); r.flags.push('early_leave'); }   /* 勤務中の途中の退勤は早退にしない */
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
    var bound = 0, night = 0, gap = 0, raw = 0, hol = 0;
    for (i = 0; i < full.length; i++) raw += (full[i][1] - full[i][0]) / MIN;
    for (i = 0; i < segs.length; i++) {
      bound += (segs[i][1] - segs[i][0]) / MIN; night += nightMinutes(segs[i][0], segs[i][1]);
      if (i > 0) gap += (segs[i][0] - segs[i - 1][1]) / MIN;
      if (cfg.legal_holiday != null) hol += holidayMinutes(segs[i][0], segs[i][1], cfg.legal_holiday);
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
    /* 丸めで数えなかった分＝打刻の出勤〜退勤（組ごと）のうち数えた区間の外（休憩は数えた区間の内なので入れない・v2-5） */
    r.uncountedMin = Math.max(0, Math.round(raw) - bound);
    /* 法定休日は暦日（その曜日の 0:00〜24:00）。休憩は区間の長さの割合で按分（仮置き・v2-9） */
    r.holidayMin = bound > 0 ? Math.round(r.workMin * Math.round(hol) / bound) : 0;
    return markDay(r, day);
  }
  /* day_mark を当てる（v2-3）: checked＝印は残して要確認に数えない／absent＝打刻なし・未出勤を欠勤に変える */
  function markDay(r, day) {
    var mk = day && day.day_mark;
    if (mk === 'checked') { r.checked = true; r.flags.push('checked'); }
    else if (mk === 'absent') {
      var ix = r.flags.indexOf('no_punch');
      if (ix < 0) ix = r.flags.indexOf('not_in_yet');
      if (ix >= 0) { r.flags.splice(ix, 1, 'absent'); r.absent = true; }
    }
    return r;
  }
  /* その曜日（日本時間の暦日）と [s,e) の重なり（分） */
  function holidayMinutes(s, e, dow) {
    if (s == null || e == null || e <= s) return 0;
    var total = 0, d = jstDate(s), last = jstDate(e - 1);
    for (var i = 0; i < 4; i++) {
      if (new Date(jstMs(d, 12 * 60)).getUTCDay() === dow) total += overlap(s, e, jstMs(d, 0), jstMs(d, 1440));
      if (d === last) break;
      d = addDays(d, 1);
    }
    return total / MIN;
  }
  /* 1日の実働を時刻の順の並びにする（0101・反証レビュー）: 塊ごとに 早出（予定の開始より前・法定内残業の候補 li）→ 予定の中（si）→ 後ろの残業（li）、
   * 予定の無い塊は全部 li。法定休日の分は li の後ろから（足りなければ si の後ろから）除き、日の法定外（8時間・予定の長い方を超えた分）は時刻の後ろから除く。
   * 返す: 残った並び [[種類, 分], …]（週40時間の超過も、この並びの後ろから当てる） */
  function daySeq(bl, dhol, legal) {
    var seq = [], bs = bl.slice().sort(function (x, y) { return (x.countStart || x.schedStart || 0) - (y.countStart || y.schedStart || 0); });
    for (var i = 0; i < bs.length; i++) {
      var c = bs[i];
      if (!(c.workMin > 0)) continue;
      if (c.sched) {
        var ot = Math.max(0, c.overtimeMin || 0), ea = 0;
        if (c.countStart != null && c.schedStart != null && c.countStart < c.schedStart) ea = Math.min(ot, Math.round((c.schedStart - c.countStart) / MIN));
        seq.push(['li', ea], ['si', c.workMin - ot], ['li', ot - ea]);
      } else seq.push(['li', c.workMin]);
    }
    var cut = function (n, kind) {
      for (var k = seq.length - 1; k >= 0 && n > 0; k--) {
        if (kind && seq[k][0] !== kind) continue;
        var m = Math.min(n, seq[k][1]); seq[k][1] -= m; n -= m;
      }
      return n;
    };
    cut(cut(dhol || 0, 'li'), 'si');
    cut(legal || 0, null);
    return seq;
  }
  function seqLi(seq) { var n = 0; for (var i = 0; i < seq.length; i++) if (seq[i][0] === 'li') n += seq[i][1]; return n; }
  /* 並びの後ろから n 分を取った時、そのうちの li の分 */
  function tailLi(seq, n) {
    var li = 0;
    for (var k = seq.length - 1; k >= 0 && n > 0; k--) { var m = Math.min(n, seq[k][1]); if (seq[k][0] === 'li') li += m; n -= m; }
    return li;
  }

  /* 要確認か（要確認の印があって、確認済みでない） */
  function needsReview(c) {
    if (c.checked) return false;
    for (var i = 0; i < c.flags.length; i++) if (REVIEW[c.flags[i]]) return true;
    return false;
  }

  /* 月分の期間（0101・締め日で切る）: { from, to }（どちらも 'YYYY-MM-DD'・from ≦ to・長さ 1〜62日）。
   * 形が違う・省いた時はその月の1日〜末日（＝締め日が月末の時と同じ）。期間は DB（kintai_month_get の period）が決めた値を渡す
   * （切り替えの月の短い期間は DB しか知らない）。 */
  function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && jstDate(jstMs(v, 12 * 60)) === v; }
  function periodOf(ym, period) {
    if (period && isDate(period.from) && isDate(period.to) && period.from <= period.to && (jstMs(period.to, 0) - jstMs(period.from, 0)) / DAY < 62) return { from: period.from, to: period.to };
    return { from: dateOf(ym, 1), to: dateOf(ym, daysIn(ym)) };
  }
  function periodDays(p) { return Math.round((jstMs(p.to, 0) - jstMs(p.from, 0)) / DAY) + 1; }
  function mdOf(date) { return (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)); }
  /* 表示の名前「2026年12月分（11/16〜12/15）」 */
  function periodLabel(ym, period) {
    var p = periodOf(ym, period);
    return ym.slice(0, 4) + '年' + (+ym.slice(5, 7)) + '月分（' + mdOf(p.from) + '〜' + mdOf(p.to) + '）';
  }

  /* ── 4. 月の計算 ──
   * opts: { ym, period:{from,to}（月分の期間・省略はその月の1日〜末日）, staff:[kintai_staff], schedule:[kintai_schedule], punches:[kintai_punches], days:[kintai_days],
   *         config, now(ミリ秒・省略は今), lockedAt(締めた時刻・省略可),
   *         leave_uses(手で入れた有休の使用 [{id, staff_id, use_date, days:0.5|1}]・省略可・v4 2026-11-20 の L8) }
   *   期間の初日の前の6日分の打刻・予定・日の行も渡すと、週40時間の週を期間をまたいで数える（前の6日分は日の一覧・合計・要確認に入れない）
   * 返す: { ym, period, config, people:[{ staff, days:[{date, blocks, paidMin, workMin, legalOverMin, flags}], sum }], totals }
   * sum の時間の区分（0101・給与の契約 CONTRACT-payroll-v1.md §2）:
   *   重ならない4つ（和が workMin）: schedInMin 所定内の実働（有休を含まない）／legalInOverMin 所定を超え法定内／
   *     legalOverMin 法定外（60時間超を含み・法定休日を含まない）／holidayMin 法定休日の実働
   *   重なる2つ: over60Min（legalOverMin のうち月60時間を超えた分）／nightMin（深夜）
   *   ほかに overtimeMin（予定を超えた実働・今までどおり）・nightShiftCount（実際に働いた夜勤の塊の数）・schedDays（所定日数）・counts（シフトの記号ごとの回数） */
  function computeMonth(opts) {
    var ym = opts.ym;
    if (!isYm(ym)) throw new Error('月の形が違います');
    var cfg = fillConfig(opts.config);
    var nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
    var lockedMs = toMs(opts.lockedAt);
    var per = periodOf(ym, opts.period);
    var first = per.from, lastD = per.to, leadFirst = addDays(first, -6);
    var staff = opts.staff || [], i, j;
    var schedBy = {}, punchBy = {}, dayBy = {}, paidBy = {}, paidSym = {}, workSym = {};
    (opts.schedule || []).forEach(function (r) {
      (schedBy[r.staff_id] = schedBy[r.staff_id] || []).push(r);
      if ((r.kind === 'work' || r.kind === 'night') && r.symbol && r.work_date >= first && r.work_date <= lastD) {
        var kw = r.staff_id + '|' + r.work_date, ws0 = workSym[kw] = workSym[kw] || [];
        if (ws0.indexOf(String(r.symbol)) < 0) ws0.push(String(r.symbol));   /* 1つのマスの記号は1日に1回（分割勤務の2行を2回にしない） */
      }
      if (r.kind === 'paid' && r.work_date >= first && r.work_date <= lastD) {
        var k = r.staff_id + '|' + r.work_date; paidBy[k] = (paidBy[k] || 0) + (r.paid_min || 0);
        if (r.symbol) (paidSym[k] = paidSym[k] || []).push(String(r.symbol));
      }
    });
    (opts.punches || []).forEach(function (p) { (punchBy[p.staff_id] = punchBy[p.staff_id] || []).push(p); });
    (opts.days || []).forEach(function (d) { dayBy[d.staff_id + '|' + d.work_date] = d; });
    /* v4（L8）: 手で入れた有休の使用（期間の中・取り消していない・0.5 か 1 日）。同じ人・同じ日は最初の1行（DB も1行だけ） */
    var leaveBy = {}, leaveStaff = {};
    (Array.isArray(opts.leave_uses) ? opts.leave_uses : []).forEach(function (u) {
      if (!u || u.voided_at || typeof u.staff_id !== 'string' || !isDate(u.use_date) || u.use_date < first || u.use_date > lastD) return;
      if (+u.days !== 0.5 && +u.days !== 1) return;
      var lk0 = u.staff_id + '|' + u.use_date;
      if (!leaveBy[lk0]) { leaveBy[lk0] = u; leaveStaff[u.staff_id] = 1; }
    });
    var people = [];
    var known = {};
    for (i = 0; i < staff.length; i++) known[staff[i].staff_id] = 1;
    /* 名簿に無いのに打刻・予定がある人も落とさない（名簿から外れた人の打刻を黙って消さない） */
    var extra = [];
    for (var sid in punchBy) if (!known[sid]) { known[sid] = 1; extra.push({ staff_id: sid, name: sid, office: null, emp_code: null, active: false, missingStaff: true }); }
    for (sid in schedBy) if (!known[sid]) { known[sid] = 1; extra.push({ staff_id: sid, name: sid, office: null, emp_code: null, active: false, missingStaff: true }); }
    for (sid in leaveStaff) if (!known[sid]) { known[sid] = 1; extra.push({ staff_id: sid, name: sid, office: null, emp_code: null, active: false, missingStaff: true }); }
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
        if (blocks[j].work_date < leadFirst || blocks[j].work_date > lastD) continue;
        (rawBy[blocks[j].work_date] = rawBy[blocks[j].work_date] || []).push(blocks[j]);
      }
      /* 休憩を直した日に塊が2つ以上ある時は、打刻のある最初の塊にだけ直した休憩を当てる（ほかは予定どおり・指摘13） */
      var target = {}, firstOf = {}, lastOf = {};
      var startOf = function (x) { return x.start || ((x.pairs[0].in || x.pairs[0].out).at); };
      for (var rd in rawBy) {
        /* early_from・ot_until は1つの塊にだけ当てる（分割勤務の別の塊へ漏らさない・仮置き v2-4）。
           候補は出勤と退勤のそろった打刻のある予定の塊（休憩の target と同じ選び方）。early_from は予定の開始が、
           ot_until は予定の終わりがその時刻に最も近い塊（同じ近さなら早い方） */
        var ord = rawBy[rd].slice().sort(function (x, y) { return startOf(x) - startOf(y); });
        var dnA = dayBy[st.staff_id + '|' + rd];
        var cands = ord.filter(function (x) { return x.start != null && x.pairs.some(function (pp) { return pp.in && pp.out; }); });
        var nearest = function (v, key) {
          var best = null, bd = Infinity;
          for (var ni = 0; ni < cands.length; ni++) { var dd0 = Math.abs(cands[ni][key] - v); if (dd0 < bd) { bd = dd0; best = cands[ni]; } }
          return best;
        };
        var efMs = dnA ? toMs(dnA.early_from) : null, otMs = dnA ? toMs(dnA.ot_until) : null;
        firstOf[rd] = efMs != null ? nearest(efMs, 'start') : null;
        lastOf[rd] = otMs != null ? nearest(otMs, 'end') : null;
        var dn0 = dnA;
        if (!dn0 || typeof dn0.break_min !== 'number') continue;
        var cand = rawBy[rd].slice().sort(function (x, y) { return (x.start || ((x.pairs[0].in || x.pairs[0].out).at)) - (y.start || ((y.pairs[0].in || y.pairs[0].out).at)); });
        target[rd] = cand[0];
        for (var ci = 0; ci < cand.length; ci++) if (cand[ci].pairs.some(function (pp) { return pp.in && pp.out; })) { target[rd] = cand[ci]; break; }
      }
      for (j = 0; j < blocks.length; j++) {
        var b = blocks[j];
        if (b.work_date < leadFirst || b.work_date > lastD) continue;
        var dnB = dayBy[st.staff_id + '|' + b.work_date];
        if (dnB && typeof dnB.break_min === 'number' && target[b.work_date] !== b) dnB = { early_ok: dnB.early_ok, overtime_ok: dnB.overtime_ok, day_mark: dnB.day_mark, early_from: dnB.early_from, ot_until: dnB.ot_until };
        if (dnB && ((dnB.early_from != null && firstOf[b.work_date] !== b) || (dnB.ot_until != null && lastOf[b.work_date] !== b))) {
          var cp = {}; for (var dk in dnB) cp[dk] = dnB[dk];
          if (firstOf[b.work_date] !== b) cp.early_from = null;
          if (lastOf[b.work_date] !== b) cp.ot_until = null;
          dnB = cp;
        }
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
      for (var lk1 in leaveBy) if (lk1.indexOf(st.staff_id + '|') === 0) { var ld = lk1.split('|')[1]; byDate[ld] = byDate[ld] || []; }
      var dates = Object.keys(byDate).sort(), days = [];
      var sum = { workDays: 0, paidDays: 0, paidMin: 0, workMin: 0, schedInMin: 0, overtimeMin: 0, legalOverMin: 0, nightMin: 0,
        lateCount: 0, lateMin: 0, earlyLeaveCount: 0, earlyLeaveMin: 0, noPunchDays: 0, reviewCount: 0, byOffice: {}, warnings: [],
        absentDays: 0, uncountedMin: 0, holidayMin: 0,
        legalInOverMin: 0, over60Min: 0, nightShiftCount: 0, schedDays: 0, counts: {}, weekOverMin: 0, frameOverMin: 0 };
      var leadDays = [], liDay = 0, seqOf = {};
      for (j = 0; j < dates.length; j++) {
        var date = dates[j], bl = byDate[date].sort(function (x, y) { return (x.schedStart || x.countStart || 0) - (y.schedStart || y.countStart || 0); });
        var dw = 0, dsw = 0, dflags = [], noPunchAll = bl.length > 0, dnote = dayBy[st.staff_id + '|' + date];
        var dhol = 0, dunc = 0, dabs = false, dot = 0;
        if (date < first) {
          /* 前の6日分（前の月分の日）は週40時間の積み上げにだけ使う（日の一覧・合計・要確認に入れない） */
          for (var lx = 0; lx < bl.length; lx++) { dw += bl[lx].workMin; dsw += bl[lx].schedWork; dhol += bl[lx].holidayMin; dot += bl[lx].overtimeMin; }
          var lLegal = Math.max(0, dw - dhol - (cfg.variableMonth ? Math.max(480, dsw) : 480));
          seqOf[date] = daySeq(bl, dhol, lLegal);
          leadDays.push({ date: date, workMin: dw, holidayMin: dhol, legalOverMin: lLegal, lead: true });
          continue;
        }
        for (var x = 0; x < bl.length; x++) {
          var c = bl[x];
          dw += c.workMin; dsw += c.schedWork; dot += c.overtimeMin;
          if (c.night && c.workMin > 0) sum.nightShiftCount++;
          if (c.flags.indexOf('no_punch') < 0) noPunchAll = false;
          sum.nightMin += c.nightMin; sum.overtimeMin += c.overtimeMin;
          if (c.lateMin > 0) { sum.lateCount++; sum.lateMin += c.lateMin; }
          if (c.earlyLeaveMin > 0) { sum.earlyLeaveCount++; sum.earlyLeaveMin += c.earlyLeaveMin; }
          for (var fl = 0; fl < c.flags.length; fl++) if (dflags.indexOf(c.flags[fl]) < 0) dflags.push(c.flags[fl]);
          if (needsReview(c)) sum.reviewCount++;   /* 要確認は勤務（塊）ごとに1件（印の数で数えない・指摘15）。確認済みの塊は数えない（v2-3） */
          dhol += c.holidayMin; dunc += c.uncountedMin;
          if (c.absent) dabs = true;
          for (var of in c.officeShare) sum.byOffice[of] = (sum.byOffice[of] || 0) + c.workMin * c.officeShare[of];
        }
        var paidMin = paidBy[st.staff_id + '|' + date] || 0;
        /* v4（L8）: 手で入れた有休は、シフトの有休の行が無い日だけ有休に数える（ある日はシフトの方を数え、足さない）。
           有休時間＝その日の予定の実働（無ければ480分）× 日数（半日は半分）。日数は入れた日数（0.5 か 1）のまま */
        var lu = leaveBy[st.staff_id + '|' + date], luDays = 0;
        if (lu && paidBy[st.staff_id + '|' + date] === undefined) { luDays = +lu.days === 0.5 ? 0.5 : 1; paidMin = Math.round((dsw > 0 ? dsw : 480) * luDays); }
        (paidSym[st.staff_id + '|' + date] || []).forEach(function (sy) { sum.counts[sy] = (sum.counts[sy] || 0) + 1; });
        if (dsw > 0 || paidMin > 0) sum.schedDays++;   /* 所定日数＝働く予定か有休のある日（仮置き） */
        if (dw > 0) (workSym[st.staff_id + '|' + date] || []).forEach(function (sy) { sum.counts[sy] = (sum.counts[sy] || 0) + 1; });   /* 働いた日の予定の記号ごと */
        /* 法定休日の労働は法定外残業に重ねない（v2-9）。legal_holiday が null なら dhol は 0 で従来どおり */
        var legal = Math.max(0, dw - dhol - (cfg.variableMonth ? Math.max(480, dsw) : 480));
        sum.legalOverMin += legal; sum.workMin += dw;
        /* 日の法定内残業＝予定を超えた実働（早出・後ろの残業・予定の無い勤務。法定休日でない分）のうち、日の法定外（時刻の後ろ）に入らない分
           （週・総枠の超過は月の合計の後で引く） */
        seqOf[date] = daySeq(bl, dhol, legal);
        liDay += seqLi(seqOf[date]);
        if (dw > 0) sum.workDays++;
        /* 有休日数は 0.5 刻み: 有休分 ÷ その日の所定（働く予定もある日は 予定の実働＋有休分・無ければ 480）が 0.5 以下なら 0.5、超えれば 1（仮置き v2-6） */
        var pdays = 0;
        if (luDays) { pdays = luDays; sum.paidDays += pdays; sum.paidMin += paidMin; }
        else if (paidMin > 0) { pdays = paidMin / (dsw > 0 ? dsw + paidMin : 480) <= 0.5 ? 0.5 : 1; sum.paidDays += pdays; sum.paidMin += paidMin; }
        if (noPunchAll && bl.length && paidMin === 0) sum.noPunchDays++;
        var absentDay = dabs && dw === 0 && paidMin === 0;
        if (absentDay) sum.absentDays++;
        sum.holidayMin += dhol; sum.uncountedMin += dunc;
        var dayRow = { date: date, blocks: bl, paidMin: paidMin, workMin: dw, schedWorkMin: dsw, legalOverMin: legal, flags: dflags, note: dnote || null,
          paidDays: pdays, holidayMin: dhol, uncountedMin: dunc, absent: absentDay, mark: (dnote && dnote.day_mark) || null };
        if (luDays) dayRow.leaveUse = { id: lu.id || null, days: luDays };   /* 手入力の有休を数えた日だけの印（無い日の形は今までどおり） */
        days.push(dayRow);
      }
      /* 週・期間の枠を超えた分も法定外（労基法32条・指摘11）。日の法定外として数えた分は二重に数えない。
         変形なし: 週（weekStartDow 始まり）の頭から日ごとに（実働−日の法定外−法定休日）を積み上げ、40時間を超えた分をその日の属する月分に付ける。
           期間の初日をまたぐ週は前の6日分も積み上げる（0101・期間をまたいで正しく数える。前の月分の日に付く分はこの月分に入れない）
         変形あり（1か月単位・起算日＝期間の初日・0101）: 日 → 週 → 総枠の順に、前の段の分を除いて数える
           週: 期間で切った週（weekStartDow 始まり）の（実働−日の法定外−法定休日）が、その週の予定の実働と40時間の長い方を超えた分。
               期間の端の7日に満たない週の40時間は 40時間×その週の期間の日数÷7（切り捨て・仮置き。40時間のままより法定外が多くなる＝多く払う側。
               端の週の扱いは社労士に確かめる・2026-11-19 反証レビューの指摘5）
           総枠: 期間の（実働−日−週の法定外−法定休日）が 40時間×期間の日数÷7（切り捨て）を超えた分 */
      var dailyLegal = sum.legalOverMin, weekLegal = 0, weekFromLi = 0, wi, wk, dd, dow, wkey;
      var weekOf = function (date) { var dw0 = new Date(jstMs(date, 12 * 60)).getUTCDay(); return addDays(date, -((dw0 - cfg.weekStartDow + 7) % 7)); };
      if (!cfg.variableMonth) {
        var acc = {}, all2 = leadDays.concat(days);
        for (wi = 0; wi < all2.length; wi++) {
          dd = all2[wi]; wkey = weekOf(dd.date);
          var before = acc[wkey] || 0, after = before + dd.workMin - dd.legalOverMin - dd.holidayMin;
          acc[wkey] = after;
          /* その日に40時間を超えた分は、その日の時刻の後ろから当たる（後ろの残業 → 予定の中 → 早出の順。分割勤務は後ろの塊から）。
             当たった所が法定内残業の候補なら法定内残業から、予定の中なら所定内から減る（週の予定が40時間を超える週・反証レビューの指摘2） */
          var inc = Math.max(0, after - 2400) - Math.max(0, before - 2400);
          if (!dd.lead) { weekLegal += inc; weekFromLi += tailLi(seqOf[dd.date] || [], inc); }
        }
      } else {
        var wsum = {}, wsch = {};
        for (wi = 0; wi < days.length; wi++) {
          dd = days[wi]; wkey = weekOf(dd.date);
          wsum[wkey] = (wsum[wkey] || 0) + dd.workMin - dd.legalOverMin - dd.holidayMin;
          wsch[wkey] = (wsch[wkey] || 0) + (dd.schedWorkMin || 0);
        }
        for (wk in wsum) {
          var ws = wk < first ? first : wk, we = addDays(wk, 6); if (we > lastD) we = lastD;
          var nd0 = periodDays({ from: ws, to: we });
          var cap = nd0 >= 7 ? 2400 : Math.floor(2400 * nd0 / 7);
          weekLegal += Math.max(0, wsum[wk] - Math.max(cap, wsch[wk]));
        }
        weekFromLi = weekLegal;   /* 変形ありの週の超過は予定の週の実働を超えた所から出る＝法定内残業から引く */
        var frame = Math.floor(2400 * periodDays(per) / 7);
        sum.frameOverMin = Math.max(0, sum.workMin - dailyLegal - weekLegal - sum.holidayMin - frame);
      }
      sum.weekOverMin = weekLegal;
      sum.legalOverMin += weekLegal + sum.frameOverMin;
      for (var ko in sum.byOffice) sum.byOffice[ko] = Math.round(sum.byOffice[ko]);
      if (cfg.monthRound30) { sum.overtimeMin = round30(sum.overtimeMin); sum.legalOverMin = round30(sum.legalOverMin); sum.nightMin = round30(sum.nightMin); }
      /* 重ならない4つに分ける（0101・給与の契約 §2）: 法定休日 → 法定外 → 法定内残業 → 所定内。和は workMin。
         法定内残業＝日ごとの（予定を超えた実働のうち日の法定外でない分）の合計から、週・総枠の超過を引いた分（週・総枠の超過が予定の中の時間から出た分は所定内から減る）。
         所定内＝残り（予定の中で法定外になった分は法定外に入る） */
      sum.legalOverMin = Math.min(sum.legalOverMin, Math.max(0, sum.workMin - sum.holidayMin));
      sum.legalInOverMin = Math.max(0, Math.min(liDay - weekFromLi - sum.frameOverMin, sum.overtimeMin, sum.workMin - sum.holidayMin - sum.legalOverMin));
      sum.schedInMin = sum.workMin - sum.holidayMin - sum.legalOverMin - sum.legalInOverMin;
      sum.over60Min = Math.max(0, sum.legalOverMin - 3600);
      if (sum.legalOverMin >= cfg.overtimeMonthWarnH * 60 && cfg.overtimeMonthWarnH > 0) sum.warnings.push('法定外の時間が月' + cfg.overtimeMonthWarnH + '時間以上です（36協定の確認）');
      if (st.missingStaff) sum.warnings.push('職員の名簿に無い番号の記録です（シフトから外れた職員）');
      people.push({ staff: st, days: days, sum: sum });
    }
    /* 月全体の合計（v2-10・画面のまとめと CSV の事業所別の列に使う） */
    var totals = { workMin: 0, reviewCount: 0, absentDays: 0, paidMin: 0, uncountedMin: 0, holidayMin: 0, byOffice: {} };
    for (i = 0; i < people.length; i++) {
      var ps = people[i].sum;
      totals.workMin += ps.workMin; totals.reviewCount += ps.reviewCount; totals.absentDays += ps.absentDays;
      totals.paidMin += ps.paidMin; totals.uncountedMin += ps.uncountedMin; totals.holidayMin += ps.holidayMin;
      for (var tb in ps.byOffice) totals.byOffice[tb] = (totals.byOffice[tb] || 0) + ps.byOffice[tb];
    }
    return { ym: ym, period: per, config: cfg, people: people, totals: totals };
  }
  /* 要確認の一覧（v2-11）: 月の結果 → [{ staffId, date, marks:[要確認の印], blockIndex }] を日付順（同じ日は名簿順・塊の順）。
   * blockIndex は people[].days[].blocks の添字。確認済みの塊は入れない */
  function reviewList(month) {
    var out = [], n = 0;
    var people = (month && month.people) || [];
    for (var i = 0; i < people.length; i++) {
      var days = people[i].days || [];
      for (var j = 0; j < days.length; j++) {
        var bl = days[j].blocks || [];
        for (var k = 0; k < bl.length; k++) {
          if (!needsReview(bl[k])) continue;
          out.push({ staffId: people[i].staff.staff_id, date: days[j].date, marks: bl[k].flags.filter(function (f) { return REVIEW[f]; }), blockIndex: k, _n: n++ });
        }
      }
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a._n - b._n; });
    for (i = 0; i < out.length; i++) delete out[i]._n;
    return out;
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
  /* v2-8: 末尾に足す列（buildCsv の opts.extraCols が true の時だけ出す＝既定の出力は v1 と同じ）。
     集計はこのあとに「実働_<事業所名>」を事業所ごと（施設・訪問・通所・その他の順）に足す */
  var SUMMARY_EXTRA_HEAD = ['欠勤日数', '有休時間', '数えなかった時間', '休日労働'];
  var DAILY_EXTRA_HEAD = ['氏名', '予定の開始', '予定の終わり', '打刻の出勤（生）', '打刻の退勤（生）', '残業', '休日労働', '有休時間', '印'];
  var OFFICE_ORDER = ['facility', 'visit', 'day'];

  /* opts: { month: computeMonth の結果, nameOf: 区分→事業所名（省略可）, extraCols: true で v2 の列を末尾に足す（省略は v1 の列だけ） }
   * 返す: { summary, daily, warnings:[文] } （どちらも CRLF・先頭に見出し）
   * 日ごとは 1人1日1行（同じ日の塊をまとめる: 出勤は最初・退勤は最後・休憩と実働と各内訳は合計・v2-7） */
  function buildCsv(month, opts) {
    opts = opts || {};
    var mode = month.config.csvTime, nameOf = opts.nameOf, warnings = [], ex = opts.extraCols === true;
    var i, j, k, offs = [];
    if (ex) {
      var seen = {};
      for (i = 0; i < month.people.length; i++) for (var oc in month.people[i].sum.byOffice) seen[oc] = 1;
      for (i = 0; i < OFFICE_ORDER.length; i++) if (seen[OFFICE_ORDER[i]]) { offs.push(OFFICE_ORDER[i]); delete seen[OFFICE_ORDER[i]]; }
      offs = offs.concat(Object.keys(seen).sort());
    }
    var sh = SUMMARY_HEAD.slice(), dh = DAILY_HEAD.slice();
    if (ex) {
      sh = sh.concat(SUMMARY_EXTRA_HEAD, offs.map(function (o) { return '実働_' + officeLabel(o, nameOf); }));
      dh = dh.concat(DAILY_EXTRA_HEAD);
    }
    var S = [csvLine(sh)], D = [csvLine(dh)];
    var uniq = function (arr) { var o = []; for (var u = 0; u < arr.length; u++) if (arr[u] !== '' && arr[u] != null && o.indexOf(arr[u]) < 0) o.push(arr[u]); return o; };
    for (i = 0; i < month.people.length; i++) {
      var p = month.people[i], st = p.staff, s = p.sum;
      var has = s.workMin > 0 || s.paidMin > 0 || s.noPunchDays > 0 || s.reviewCount > 0 || s.absentDays > 0;   /* 欠けた打刻だけ・欠勤だけの人も落とさない（指摘4） */
      if (!st.emp_code) { if (has) warnings.push((st.name || st.staff_id) + ' さんは従業員コードが無いので出していません'); continue; }
      if (!has) continue;
      var sr = [st.emp_code, st.name, officeLabel(st.office, nameOf), s.workDays, s.paidDays, fmtMin(s.workMin, mode), fmtMin(Math.max(0, s.workMin - s.overtimeMin), mode),
        fmtMin(s.overtimeMin, mode), fmtMin(s.legalOverMin, mode), fmtMin(s.nightMin, mode), s.lateCount, fmtMin(s.lateMin, mode),
        s.earlyLeaveCount, fmtMin(s.earlyLeaveMin, mode), s.noPunchDays, s.reviewCount];
      if (ex) {
        sr.push(s.absentDays || 0, fmtMin(s.paidMin, mode), fmtMin(s.uncountedMin, mode), fmtMin(s.holidayMin, mode));
        for (k = 0; k < offs.length; k++) sr.push(fmtMin(s.byOffice[offs[k]] || 0, mode));
      }
      S.push(csvLine(sr));
      for (j = 0; j < p.days.length; j++) {
        var d = p.days[j];
        if (d.paidMin > 0 && !d.blocks.some(function (b) { return b.workMin > 0; })) {
          var pr = [st.emp_code, d.date, '', '', 0, fmtMin(0, mode), fmtMin(0, mode), '', '有', '有休 ' + fmtMin(d.paidMin, 'hmm')];
          if (ex) pr.push(st.name, '', '', '', '', fmtMin(0, mode), fmtMin(0, mode), fmtMin(d.paidMin, mode), '');
          D.push(csvLine(pr));
          continue;
        }
        /* 打刻の欠けた日・欠勤の日も行に出す（指摘3）。勤務中・まだ出勤していない塊は出さない */
        var use = d.blocks.filter(function (b) { return b.countStart != null || b.absent || b.flags.some(function (fx) { return REVIEW[fx]; }); });
        if (!use.length) continue;
        var cs = null, ce = null, br = 0, wm = 0, nm = 0, ot = 0, so = null, se = null, ri = null, ro = null, notes = [], marks = [], ofs = [], syms = [];
        for (k = 0; k < use.length; k++) {
          var b = use[k];
          if (b.countStart != null && cs == null) cs = b.countStart;
          if (b.countEnd != null) ce = b.countEnd;
          if (b.schedStart != null && so == null) so = b.schedStart;
          if (b.schedEnd != null) se = b.schedEnd;
          br += b.breakMin; wm += b.workMin; nm += b.nightMin; ot += b.overtimeMin;
          for (var q = 0; q < b.punches.length; q++) {
            var pq = b.punches[q];
            if (pq.kind === 'in' && (ri == null || pq.at < ri)) ri = pq.at;
            if (pq.kind === 'out' && (ro == null || pq.at > ro)) ro = pq.at;
          }
          for (var f = 0; f < b.flags.length; f++) (REVIEW[b.flags[f]] ? notes : marks).push(FLAG_LABEL[b.flags[f]] || b.flags[f]);
          ofs.push(officeLabel(b.office, nameOf)); syms.push(b.symbol);
        }
        var dr = [st.emp_code, d.date, jstHM(cs), jstHM(ce), br, fmtMin(wm, mode), fmtMin(nm, mode), uniq(ofs).join('・'), uniq(syms).join(' '), uniq(notes).join('・')];
        if (ex) dr.push(st.name, jstHM(so), jstHM(se), jstHM(ri), jstHM(ro), fmtMin(ot, mode), fmtMin(d.holidayMin || 0, mode), fmtMin(d.paidMin, mode), uniq(marks).join('・'));
        D.push(csvLine(dr));
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
        noPunchDays: s.noPunchDays, reviewCount: s.reviewCount, byOffice: s.byOffice,
        holidayMin: s.holidayMin || 0, absentDays: s.absentDays || 0, paidMin: s.paidMin || 0, uncountedMin: s.uncountedMin || 0,   /* v2: 控えから締めた月の CSV を作れるように */
        legalInOverMin: s.legalInOverMin || 0, over60Min: s.over60Min || 0, nightShiftCount: s.nightShiftCount || 0, schedDays: s.schedDays || 0, counts: s.counts || {} });   /* 0101: 給与の入力 */
    }
    return { v: 1, ym: month.ym, period: month.period, config: month.config, rows: rows };
  }

  var api = {
    DEFAULTS: DEFAULTS, FLAG_LABEL: FLAG_LABEL, REVIEW: REVIEW, DIV_OFFICE: DIV_OFFICE, OFFICE_DIV: OFFICE_DIV,
    SUMMARY_HEAD: SUMMARY_HEAD, DAILY_HEAD: DAILY_HEAD, SUMMARY_EXTRA_HEAD: SUMMARY_EXTRA_HEAD, DAILY_EXTRA_HEAD: DAILY_EXTRA_HEAD,
    NOT_IN_GRACE_MIN: NOT_IN_GRACE_MIN, checkLegalHoliday: checkLegalHoliday, reviewList: reviewList, needsReview: needsReview,
    fillConfig: fillConfig, isYm: isYm, daysIn: daysIn, nextYm: nextYm, prevYm: prevYm, jstMs: jstMs, jstDate: jstDate, jstHM: jstHM,
    addDays: addDays, iso: iso, fmtMin: fmtMin, nightMinutes: nightMinutes, staffVisible: staffVisible,
    buildSchedule: buildSchedule, periodOf: periodOf, periodLabel: periodLabel, periodDays: periodDays, isDate: isDate, blocksOf: blocksOf, pairsOf: pairsOf, computeMonth: computeMonth, round30: round30,
    buildCsv: buildCsv, csvCell: csvCell, encodeSjis: encodeSjis, isCode: isCode, snapshotOf: snapshotOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiCalc = api;
})(typeof window !== 'undefined' ? window : this);
