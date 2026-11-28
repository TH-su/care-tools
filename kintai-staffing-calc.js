/* kintai-staffing-calc.js — 勤怠管理のホームの「今日の人員配置」の純関数（2026-11-28 新設・代表者の決定 2026-11-28「推奨どおり」）
 * ════════════════════════════════════════════════════════════════
 * ・DOM に触れない・通信しない。勤怠の計算（kintai-calc.js）と給与（payroll*）は変えない・呼ばない。知らせだけ
 * ・入り切りは設定（kintai_settings.config）の鍵 staffCheck（true の時だけ入・既定は切）。決まりは鍵 staffRules（[{…}]・最大20行）
 *   決まりの1行: { office: 'facility'|'visit'|'day', label: 表示名（1〜20字）, from: 'HH:MM', to: 'HH:MM'（from 以下なら翌日の時刻）,
 *                 need: 必要な人数（1〜20）, who: 数える人, word: 'job' の時の語（1〜20字） }
 *   who: all＝全員 / care＝介護職員（看護師・准看護師でない人。シフトのデイの人数確認欄と同じ分け方） / nurse＝看護職員（看護師・准看護師）
 *        qual＝介護の資格のある人（介護福祉士・実務者研修・初任者研修のどれか） / sm＝サービス提供責任者の印のある人 / job＝シフトの職員の「職種（様式1）」に word を含む人
 *   施設の数字はコードに書かない（公開リポジトリ）。決まりは施設ごとに設定の画面で入れる
 * ・数え方（evaluate）:
 *   予定 … 時間帯を通して、その事業所の予定の塊（b.office・欠勤と1日の休みを除く）が覆う人数の、いちばん少ない時刻の人数（同じ人は1人）
 *   いま … 時間帯の途中の時だけ。打刻で勤務中の人（出勤〜退勤の間・退勤がまだで勤務中の印）と、予定の始まりから15分まででまだ打刻の無い人
 *   足りない時だけ札にする: 予定で足りない＝warn・いま足りない＝alert（ほかは ok で札にしない）
 *   確かめられない時は 0 人と言わず unknown（シフトの職員が読めない・その日が開いている月分の外）
 * ・0:00 をまたぐ時間帯（21:00〜翌7:00 など）は、今日の夜の分と、前の日の夜から続いて今がまだ終わっていない分の2つを出す
 * ・頭数に入れない人（シフトの countInHeadcount が false）と、シフトの職員にいない人は数えない（いない人の数は missing に出す）
 * ・一人が二つの決まりに当たる時（看護師を看護職員と機能訓練指導員の両方で数えるなど）は両方に数える。兼務の可否・加算の専従の要件は判定しない
 * ★氏名などを端末に残さない（計算だけ）。試験は架空の職員だけ（check/unit/kintai_staffing_test.js）
 */
(function (root) {
  'use strict';
  var KEY_ON = 'staffCheck', KEY_RULES = 'staffRules';
  var MAX_RULES = 20, LABEL_MAX = 20, WORD_MAX = 20, NEED_MAX = 20, CFG_MAX = 8192, GRACE_MS = 15 * 60000, JST = 9 * 3600000;
  var OFFICES = ['facility', 'visit', 'day'];
  var WHO = ['all', 'care', 'nurse', 'qual', 'sm', 'job'];
  var WHO_JA = { all: '全員', care: '介護職員', nurse: '看護職員', qual: '介護の資格', sm: 'サ責', job: '職種の語' };   /* 選ぶ欄の短い名前（意味は設定の欄の説明に書く） */
  var NURSE_Q = ['看護師', '准看護師'], CARE_Q = ['介護福祉士', '実務者研修', '初任者研修'];

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function clean(s) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isHm(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function hmMin(s) { return +s.slice(0, 2) * 60 + +s.slice(3, 5); }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.getUTCFullYear() === +s.slice(0, 4) && d.getUTCMonth() === +s.slice(5, 7) - 1 && d.getUTCDate() === +s.slice(8, 10);
  }
  function addDays(d, n) {
    var x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000);
    return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  }
  /* 日本時間の日付と時刻（分）を時刻の数へ */
  function at(date, min) { return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - JST + min * 60000; }
  function msOf(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var t = Date.parse(v); return isNaN(t) ? null : t; }

  function on(cfg) { return !!(cfg && cfg[KEY_ON] === true); }

  /* 決まり1行の確かめ。返す: { rule } か { why }（why: shape・office・label・from・to・same・need・who・word） */
  function checkRule(x) {
    if (!isObj(x)) return { why: 'shape' };
    if (OFFICES.indexOf(x.office) < 0) return { why: 'office' };
    var label = clean(x.label);
    if (!label || label.length > LABEL_MAX) return { why: 'label' };
    if (!isHm(x.from)) return { why: 'from' };
    if (!isHm(x.to)) return { why: 'to' };
    if (x.from === x.to) return { why: 'same' };
    if (!isInt(x.need) || x.need < 1 || x.need > NEED_MAX) return { why: 'need' };
    if (WHO.indexOf(x.who) < 0) return { why: 'who' };
    var word = clean(x.word);
    if (x.who === 'job' && (!word || word.length > WORD_MAX)) return { why: 'word' };
    var r = { office: x.office, label: label, from: x.from, to: x.to, need: x.need, who: x.who };
    if (x.who === 'job') r.word = word;
    return { rule: r };
  }
  /* 設定の決まり。崩れた行は使わず bad に番号（1から）と理由を出す。行が配列でない・多すぎる時は全部使わない */
  function rulesOf(cfg) {
    var raw = cfg && own(cfg, KEY_RULES) ? cfg[KEY_RULES] : null, items = [], bad = [];
    if (raw == null) return { items: items, bad: bad };
    if (!Array.isArray(raw) || raw.length > MAX_RULES) return { items: items, bad: [{ i: 0, why: 'shape' }] };
    raw.forEach(function (x, i) { var c = checkRule(x); if (c.rule) items.push(c.rule); else bad.push({ i: i + 1, why: c.why }); });
    return { items: items, bad: bad };
  }
  /* DB の octet_length(config::text) の見積もり（kintai-cert-calc.js・kintai-holiday.js と同じ数え方。jsonb の「: 」「, 」と UTF-8 のバイト数・余白 256 バイト） */
  function byteLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  function jsonbBytes(v) {
    var enc = function (x) { return byteLen(JSON.stringify(x)); };
    var walk = function (x) {
      if (x === null || typeof x === 'boolean' || typeof x === 'number') return String(x).length + 2;
      if (typeof x === 'string') return enc(x);
      if (Array.isArray(x)) { var n = 2; x.forEach(function (e, i) { n += walk(e) + (i ? 2 : 0); }); return n; }
      if (typeof x === 'object') { var m = 2, i = 0; for (var k in x) { if (!own(x, k) || x[k] === undefined) continue; m += enc(k) + 2 + walk(x[k]) + (i ? 2 : 0); i++; } return m; }
      return 4;
    };
    return walk(v);
  }
  function fitsConfig(cfg) { try { return jsonbBytes(cfg) <= CFG_MAX - 256; } catch (e) { return false; } }

  /* シフトの職員1人がその決まりの数える人に当たるか（st が無い＝シフトの職員にいない人は false） */
  function matches(rule, st) {
    if (!st || st.countInHeadcount === false) return false;
    var q = Array.isArray(st.qualifications) ? st.qualifications : [];
    var nurse = q.indexOf(NURSE_Q[0]) >= 0 || q.indexOf(NURSE_Q[1]) >= 0;
    switch (rule.who) {
      case 'all': return true;
      case 'nurse': return nurse;
      case 'care': return !nurse;
      case 'qual': return CARE_Q.some(function (x) { return q.indexOf(x) >= 0; });
      case 'sm': return st.serviceManager === true;
      case 'job': return typeof st.jobTitle === 'string' && !!rule.word && st.jobTitle.indexOf(rule.word) >= 0;
    }
    return false;
  }
  /* その日に1日の特別休暇・代休がある（kintai-today.js と同じ決まり） */
  function dayOff(day) { return ((day && day.absences) || []).some(function (x) { return x && (x.kind === 'special' || x.kind === 'comp') && x.minutes == null; }); }
  /* 打刻からいた間 [[始め, 終わり]]。退勤がまだで勤務中の印がある時は今まで */
  function actualSpans(b, nowMs) {
    var ps = (b.punches || []).map(function (p) { return { k: p && p.kind, t: msOf(p && p.at) }; }).filter(function (p) { return p.t != null && (p.k === 'in' || p.k === 'out'); });
    ps.sort(function (a, c) { return a.t - c.t; });
    var out = [], open = null;
    ps.forEach(function (p) {
      if (p.k === 'in') { if (open == null) open = p.t; }
      else if (open != null) { out.push([open, p.t]); open = null; }
    });
    if (open != null && b.working && nowMs != null && nowMs >= open) out.push([open, nowMs + 1]);   /* 今の時刻を含む */
    return out;
  }
  /* 区間の集まり（人ごとの区間の配列）について、[s, e) の間でいちばん少ない人数とその時刻 */
  function minCover(perPerson, s, e) {
    var pts = [s];
    perPerson.forEach(function (sp) { sp.forEach(function (x) { if (x[0] > s && x[0] < e) pts.push(x[0]); if (x[1] > s && x[1] < e) pts.push(x[1]); }); });
    pts.sort(function (a, b) { return a - b; });
    var best = null, bestAt = s;
    pts.forEach(function (t) {
      var n = 0;
      perPerson.forEach(function (sp) { if (sp.some(function (x) { return x[0] <= t && t < x[1]; })) n++; });
      if (best == null || n < best) { best = n; bestAt = t; }
    });
    return { min: best == null ? 0 : best, at: bestAt };
  }

  /* 今日の人員配置
     in: { month（kintai-calc.js の computeMonth の結果）, today: 'YYYY-MM-DD'（日本時間）, nowMs, cfg, staff（シフトの職員の配列・読めない時は null）,
           period: { from, to }（開いている月分・省略時は日付で確かめない）, office: '' か事業所（絞り込み）,
           schedule（kintai_month_get の予定の行・省略時は塊の事業所と予定の時刻で数える） }
     返す: { on, rules（使った決まり）, bad（崩れた決まりの行）, rows: [行], short（足りない行の数）, staffOk }
     行: { idx（決まりの番号・0から）, office, label, need, who, from, to, date（時間帯の始まりの日）, startMs, endMs, overnight, phase: 'later'|'now'|'past',
           plan（予定のいちばん少ない人数・unknown の時は null）, planAt（その時刻）, now（いまの人数・時間帯の途中でない時は null）, missing（シフトの職員にいない人の数）,
           partial（月分の外の日の塊を数えていない）, nowUnknown（いまの人数を確かめられない＝月分の外の日に始まった勤務の打刻を読んでいない）, level: 'ok'|'warn'|'alert'|'unknown', why（unknown の理由: staff・period） } */
  function evaluate(inp) {
    var cfg = inp && inp.cfg, ru = rulesOf(cfg), res = { on: on(cfg), rules: ru.items, bad: ru.bad, rows: [], short: 0, staffOk: Array.isArray(inp && inp.staff) };
    var td = inp && isDate(inp.today) ? inp.today : null, nowMs = inp && typeof inp.nowMs === 'number' ? inp.nowMs : null;
    if (!td || nowMs == null) return res;
    var of = inp && typeof inp.office === 'string' ? inp.office : '';
    var per = inp && inp.period && isDate(inp.period.from) && isDate(inp.period.to) ? inp.period : null;
    var sById = {};
    if (res.staffOk) inp.staff.forEach(function (s) { if (s && typeof s.id === 'string') sById[s.id] = s; });
    /* 日付 → 人ごとの塊 [{ staff_id, b, day }] */
    var byDate = {};
    ((inp.month && inp.month.people) || []).forEach(function (p) {
      var sid = p && p.staff && p.staff.staff_id;
      ((p && p.days) || []).forEach(function (dd) {
        (dd.blocks || []).forEach(function (b) { (byDate[dd.date] = byDate[dd.date] || []).push({ sid: b.staff_id || sid, b: b, day: dd }); });
      });
    });
    /* 人と日ごとの「その日は数えない」（欠勤の印・1日の特別休暇・代休で打刻の無い日）と「打刻がある」 */
    var off = {}, punched = {}, part = {};
    Object.keys(byDate).forEach(function (d) {
      var per0 = {};
      byDate[d].forEach(function (x) { var k = x.sid + '|' + d; (per0[k] = per0[k] || []).push(x); });
      Object.keys(per0).forEach(function (k) {
        var xs = per0[k], np = !xs.some(function (x) { return (x.b.punches || []).length; }), day = xs[0].day;
        if (!np) punched[k] = true;
        if (xs.some(function (x) { return x.b.absent; }) || (np && (dayOff(day) || (day && day.mark === 'absent') || (day && day.leaveUse && day.leaveUse.days >= 1)))) off[k] = true;   /* 1日の有休（手入力・申請の承認）の日も外す（シフトの予定の行は残るため・反証レビュー 2026-11-28） */
        if (np && day && day.leaveUse && day.leaveUse.days > 0 && day.leaveUse.days < 1) part[k] = true;   /* 半日の有休は、その日の予定を丸ごとは信じない（下で予定に数えない） */   /* 欠勤の印は始まりの前でも外す（kintai-calc.js は始まりの後に塊へ当てる） */
      });
    });
    /* 予定の行（kintai_month_get の schedule）。働く行（work・night）だけ */
    var sched = Array.isArray(inp.schedule) ? inp.schedule.map(function (x) {
      var a = x && msOf(x.start_at), b = x && msOf(x.end_at);
      return x && (x.kind === 'work' || x.kind === 'night') && typeof x.staff_id === 'string' && isDate(x.work_date) && a != null && b != null && b > a ? { sid: x.staff_id, date: x.work_date, office: x.office, s: a, e: b } : null;
    }).filter(Boolean) : null;
    var yday = addDays(td, -1);
    ru.items.forEach(function (r, idx) {
      if (of && r.office !== of) return;
      var fm = hmMin(r.from), tm = hmMin(r.to), over = tm <= fm;
      var starts = [td];
      if (over) starts.unshift(yday);
      starts.forEach(function (sd) {
        var s = at(sd, fm), e = at(over ? addDays(sd, 1) : sd, tm);
        if (sd === yday && e <= nowMs) return;   /* 前の日の夜の分は、今まだ終わっていない時だけ */
        var row = { idx: idx, office: r.office, label: r.label, need: r.need, who: r.who, from: r.from, to: r.to, date: sd, startMs: s, endMs: e, overnight: over,
          phase: nowMs < s ? 'later' : nowMs >= e ? 'past' : 'now', plan: null, planAt: null, now: null, missing: 0, partial: false, level: 'unknown', why: '' };
        /* 時間帯にかかる塊は、始まりの日の前の日〜終わりの日の塊（夜勤の塊は始まった日にある） */
        var dates = [addDays(sd, -1), sd]; if (over) dates.push(addDays(sd, 1));
        var allDates = dates.slice();   /* 予定の行は月分の初日の7日前から届く（kintai_month_get）ので、月分の外の日も数える */
        if (per && (sd < per.from || sd > per.to)) { row.why = 'period'; res.rows.push(row); return; }
        if (!res.staffOk) { row.why = 'staff'; res.rows.push(row); return; }
        /* 開いている月分の外の日（初日の前の日・終わりの日の次の日）の塊は読んでいない。その日は数えず、partial の印を付ける（画面が一言添える） */
        if (per) dates = dates.filter(function (d) { var o = d >= per.from && d <= per.to; if (!o && !sched) row.partial = true; return o; });   /* 予定の行がある時は、月分の外の日の予定も数えられる */
        var plan = {}, act = {}, miss = {};
        var take = function (sid, add) {   /* シフトの職員にいる・数える人に当たる時だけ add を呼ぶ */
          var st = sById[sid];
          if (!st) { miss[sid] = 1; return; }
          if (matches(r, st)) add();
        };
        /* 予定: 予定の行（schedule）があれば、その事業所の行の時刻で数える（1つの勤務にまとめた塊は主の事業所しか持たないため、
           通所の応援など別の事業所の時間を拾えない）。無い時は塊の事業所と予定の時刻で数える */
        if (sched) {
          sched.forEach(function (x) {
            if (x.office !== r.office || allDates.indexOf(x.date) < 0 || off[x.sid + '|' + x.date] || part[x.sid + '|' + x.date]) return;
            if (x.e <= s || x.s >= e) return;   /* 時間帯にかからない行は見ない（シフトにいない人の数にも入れない） */
            take(x.sid, function () { (plan[x.sid] = plan[x.sid] || []).push([x.s, x.e]); });
          });
        }
        dates.forEach(function (d) {
          (byDate[d] || []).forEach(function (x) {
            var b = x.b, k = x.sid + '|' + d;
            var mine = b.office === r.office || !!(b.officeShare && b.officeShare[r.office] > 0);
            if (!mine) return;
            var bs = b.sched && typeof b.schedStart === 'number' && typeof b.schedEnd === 'number' && b.schedEnd > b.schedStart;
            var sp = actualSpans(b, nowMs);
            var lo = bs ? b.schedStart : (sp.length ? sp[0][0] : null), hi = bs ? b.schedEnd : (sp.length ? sp[sp.length - 1][1] : null);
            if (lo == null || hi <= s || lo >= e) return;   /* 時間帯にかからない塊は見ない */
            take(x.sid, function () {
              if (!sched && bs && !off[k] && !part[k] && b.office === r.office) (plan[x.sid] = plan[x.sid] || []).push([b.schedStart, b.schedEnd]);
              if (row.phase !== 'now' || !sp.length) return;
              /* いま: 兼務の人は、いまの時刻にその事業所の予定の行がある時だけ数える（ほかの事業所の時間に両方へ数えない・反証レビュー 2026-11-28）。
                 いまの時刻にどの予定の行も無い人（予定の外の勤務）と、予定の行を渡されない時は、塊の主の事業所だけで数える */
              if (sched) {
                var rowsNow = sched.filter(function (y) { return y.sid === x.sid && y.s <= nowMs && nowMs < y.e; });
                if (rowsNow.length ? !rowsNow.some(function (y) { return y.office === r.office; }) : b.office !== r.office) return;
              } else if (b.office !== r.office) return;
              act[x.sid] = (act[x.sid] || []).concat(sp);
            });
          });
        });
        /* いま: 始まりから15分までの打刻待ちはいる側（その事業所の予定の行・その日に打刻の無い人だけ） */
        if (row.phase === 'now') {
          Object.keys(plan).forEach(function (sid) {
            if (act[sid]) return;
            var waiting = plan[sid].some(function (x) { return nowMs >= x[0] && nowMs < Math.min(x[1], x[0] + GRACE_MS); });
            if (waiting && !dates.some(function (d) { return punched[sid + '|' + d]; })) act[sid] = [[nowMs, nowMs + 1]];
          });
        }
        var pp = Object.keys(plan).map(function (k) { return plan[k]; }), mc = minCover(pp, s, e);
        row.plan = mc.min; row.planAt = mc.at; row.missing = Object.keys(miss).length;
        /* 月分の外の日（初日の前の日）に始まった、この事業所の予定の行が今の時刻を含む時は、その人の打刻を読んでいないので、いまの人数は確かめられない（反証レビュー 2026-11-28） */
        if (row.phase === 'now' && sched && per && sched.some(function (y) { return y.office === r.office && y.date < per.from && y.s <= nowMs && nowMs < y.e && !off[y.sid + '|' + y.date] && sById[y.sid] && matches(r, sById[y.sid]); })) { row.nowUnknown = true; }
        if (row.phase === 'now' && !row.nowUnknown) {
          var n = 0;
          Object.keys(act).forEach(function (k) { if (act[k].some(function (x) { return x[0] <= nowMs && nowMs < x[1]; })) n++; });
          row.now = n;
        }
        row.level = row.now != null && row.now < r.need ? 'alert' : row.plan < r.need ? 'warn' : 'ok';
        if (row.level !== 'ok') res.short++;
        res.rows.push(row);
      });
    });
    /* 並び: 足りない（いま→予定）→ 確かめられない → 足りている。同じ中は事業所・始まりの順 */
    var LV = { alert: 0, warn: 1, unknown: 2, ok: 3 };
    res.rows.sort(function (a, b) { return (LV[a.level] - LV[b.level]) || (OFFICES.indexOf(a.office) - OFFICES.indexOf(b.office)) || (a.startMs - b.startMs) || (a.idx - b.idx); });
    return res;
  }

  var api = { KEY_ON: KEY_ON, KEY_RULES: KEY_RULES, MAX_RULES: MAX_RULES, LABEL_MAX: LABEL_MAX, WORD_MAX: WORD_MAX, NEED_MAX: NEED_MAX, OFFICES: OFFICES, WHO: WHO, WHO_JA: WHO_JA,
    on: on, checkRule: checkRule, rulesOf: rulesOf, fitsConfig: fitsConfig, matches: matches, evaluate: evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiStaffing = api;
})(typeof window !== 'undefined' ? window : this);
