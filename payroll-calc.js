/* payroll-calc.js — 給与の計算の純関数（2026-11-19 新設・給与 v1 の契約 CONTRACT-payroll-v1.md §2〜§3）
 * ════════════════════════════════════════════════════════════════
 * ・PayrollCalc.computeItem(input) が1人・1か月分の明細（支給・控除・差引・会社負担・警告・区分別の合計）を返す
 * ・画面（payroll.html）とは通信も DOM も持たない。試験は check/unit/payroll_calc_test.js
 * ・金額は全部「有理数（BigInt の分子と分母）」で数え、丸めはこのファイルの中だけで行う
 *   （浮動小数で率を掛けると 50銭ちょうどの境目が狂うため）
 * ・端数の既定（契約 §0・freee で確かめた値）:
 *     社保の本人分: 50銭以下切捨て・50銭超切上げ（健保・介護・支援金・厚年を別々に丸める）
 *     雇保の本人分: 50銭以下切捨て・50銭1厘以上切上げ
 *     月給の時間単価: 円未満切上げ → 割増＝単価×率×時間を円未満切上げ
 *     時給の時間外: 時給×率×時間 を円未満切上げ（単価を先に丸めない）／時給の基本給: 円未満切上げ
 *     欠勤・遅刻早退の控除: 単価＝(基本給＋勤怠控除の基礎)÷平均所定労働時間 を円未満切捨て →
 *       欠勤＝単価×1日の所定時間×日数・遅刻早退＝単価×時間 を切捨て（マイナスの支給の行）
 *     日割り: 切捨て
 * ・年齢の到達は誕生日の前日（年齢計算ニ関スル法律）。社保は保険料の対象月で判定する（翌月徴収なら月分の前月）
 * ・氏名・口座などの個人情報をこのファイルに書かない（試験も架空の職員だけ）
 */
(function (root) {
  'use strict';
  var isNode = typeof require !== 'undefined' && typeof window === 'undefined';
  var Rates = isNode ? require('./payroll-rates.js') : root.PayrollRates;
  var CALC_VER = 'payroll-calc-1';

  var DEFAULTS = {
    si_month: 'next', tax_method: 'table', prefecture: '43', emp_ins_kind: 'general',
    avg_month_hours_default: 172, avg_month_days_default: 21.75,
    ot_rates: { in: 1.0, out: 1.25, over60: 0.25, night: 0.25, holiday: 1.35 },
    /* hourly_base・hourly_unit は契約 §4 に無い任意のキー（無くても既定で動く） */
    round: { hour_unit: 'ceil', premium: 'ceil', prorate: 'floor', deduct_unit: 'floor', deduct: 'floor', hourly_base: 'ceil', hourly_unit: 'none' },
    absence_deduct: true, late_deduct: true, night_premium: 'included', holidays: []
  };
  var ROUND_MODES = { ceil: 1, floor: 1, round: 1, none: 1 };

  /* ── 1. 有理数 ── */
  function B(x) { return BigInt(x); }
  function Q(n, d) {
    n = B(n); d = d === undefined ? 1n : B(d);
    if (d < 0n) { n = -n; d = -d; }
    return { n: n, d: d };
  }
  function qAdd(a, b) { return Q(a.n * b.d + b.n * a.d, a.d * b.d); }
  function qSub(a, b) { return Q(a.n * b.d - b.n * a.d, a.d * b.d); }
  function qMul(a, b) { return Q(a.n * b.n, a.d * b.d); }
  function qDiv(a, b) { return Q(a.n * b.d, a.d * b.n); }
  function qCmp(a, b) { var x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : (x > 0n ? 1 : 0); }
  function floorDiv(n, d) { var q = n / d; if ((n % d !== 0n) && ((n < 0n) !== (d < 0n))) q -= 1n; return q; }
  function qFloor(a) { return floorDiv(a.n, a.d); }
  function qCeil(a) { return -floorDiv(-a.n, a.d); }
  /* 率（0.1008 など）→ 百万分率の有理数 */
  /* 有限でない値（'abc'・Infinity・NaN）は0にして印を立てる（computeItem が警告に出す・例外を外に出さない）。
     空（undefined・null・''）は「値なし」で印を立てない */
  var badNum = 0;
  function fin(x) {
    if (x === undefined || x === null || x === '') return 0;
    var n = Number(x);
    if (!isFinite(n)) { badNum++; return 0; }
    return n;
  }
  function int(x) { return Math.round(fin(x)); }
  function rateQ(x) { return Q(Math.round(fin(x) * 1e6), 1000000); }
  /* 小数（172・21.75・7.5 など）→ 百分の一の有理数 */
  function decQ(x) { return Q(Math.round(fin(x) * 100), 100); }
  function intQ(x) { return Q(int(x)); }
  /* mode で円に丸める（none は丸めず有理数のまま返す） */
  function roundQ(a, mode) {
    if (mode === 'none') return a;
    if (mode === 'ceil') return Q(qCeil(a));
    if (mode === 'round') {   /* 0.5 は遠い方へ（四捨五入） */
      var neg = a.n < 0n, p = neg ? Q(-a.n, a.d) : a, r = floorDiv(p.n * 2n + p.d, p.d * 2n);
      return Q(neg ? -r : r);
    }
    return Q(qFloor(a));
  }
  function yen(a, mode) { return Number(qFloor(roundQ(a, mode || 'floor'))); }
  /* 50銭以下切捨て・50銭超切上げ（社保・雇保の本人分）。負は0 */
  function round50(a) {
    if (a.n <= 0n) return 0;
    var f = floorDiv(a.n, a.d), rem = a.n - f * a.d;
    return Number(rem * 2n > a.d ? f + 1n : f);
  }
  function qNum(a) { return Number(a.n * 10000n / a.d) / 10000; }

  /* ── 2. 日付 ── */
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(d, n) { return iso(Date.parse(d + 'T00:00:00Z') + n * 86400000); }
  function ymAdd(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function ymOf(d) { return d.slice(0, 7); }
  /* 誕生日 birth の age 歳の誕生日（2/29 生まれで平年は 3/1） */
  function birthdayAt(birth, age) {
    var y = +birth.slice(0, 4) + age, m = +birth.slice(5, 7) - 1, d = +birth.slice(8, 10);
    return iso(Date.UTC(y, m, d));
  }
  /* age 歳に到達する日（誕生日の前日） */
  function reachDate(birth, age) { return addDays(birthdayAt(birth, age), -1); }
  function reachYm(birth, age) { return ymOf(reachDate(birth, age)); }

  /* ── 3. 設定 ── */
  function num(v, lo, hi, def) {
    var n = Number(v), given = typeof v === 'number' || (typeof v === 'string' && v !== '');
    if (given && !isFinite(n)) badNum++;
    return given && isFinite(n) && n >= lo && n <= hi ? n : def;
  }
  function fillSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var o = {}, k;
    o.si_month = s.si_month === 'current' ? 'current' : 'next';
    o.tax_method = s.tax_method === 'computer' ? 'computer' : 'table';
    o.prefecture = typeof s.prefecture === 'string' && s.prefecture ? s.prefecture : DEFAULTS.prefecture;
    o.emp_ins_kind = typeof s.emp_ins_kind === 'string' && s.emp_ins_kind ? s.emp_ins_kind : DEFAULTS.emp_ins_kind;
    o.avg_month_hours_default = num(s.avg_month_hours_default, 1, 300, DEFAULTS.avg_month_hours_default);
    o.avg_month_days_default = num(s.avg_month_days_default, 1, 31, DEFAULTS.avg_month_days_default);
    o.ot_rates = {};
    var or = s.ot_rates && typeof s.ot_rates === 'object' ? s.ot_rates : {};
    for (k in DEFAULTS.ot_rates) o.ot_rates[k] = num(or[k], 0, 3, DEFAULTS.ot_rates[k]);
    o.round = {};
    var rr = s.round && typeof s.round === 'object' ? s.round : {};
    for (k in DEFAULTS.round) o.round[k] = ROUND_MODES[rr[k]] ? rr[k] : DEFAULTS.round[k];
    o.absence_deduct = s.absence_deduct !== false;
    o.late_deduct = s.late_deduct !== false;
    o.night_premium = s.night_premium === 'pay' ? 'pay' : 'included';
    o.holidays = Array.isArray(s.holidays) ? s.holidays.filter(isDate) : [];
    return o;
  }

  /* 手当の定義の属性（無い時の既定） */
  function attrsOf(def) {
    var a = def && def.attrs && typeof def.attrs === 'object' ? def.attrs : {};
    var fixed = !def || !def.calc || def.calc === 'fixed';
    function b(v, d) { return typeof v === 'boolean' ? v : d; }
    return {
      income_tax: b(a.income_tax, true), social_ins: b(a.social_ins, true), labor_ins: b(a.labor_ins, true),
      overtime_base: b(a.overtime_base, true), attendance_base: b(a.attendance_base, false), fixed_wage: b(a.fixed_wage, fixed),
      min_wage: b(a.min_wage, fixed), prorate: b(a.prorate, false), includes_night_premium: b(a.includes_night_premium, false)
    };
  }

  /* 在籍の所定労働日数（勤怠が無い時は 平日−祝日 で数える・仮置き） */
  function weekdaysBetween(from, to, holidays) {
    var n = 0, d = from;
    for (var i = 0; i < 40 && d <= to; i++) {
      var w = new Date(d + 'T00:00:00Z').getUTCDay();
      if (w !== 0 && w !== 6 && holidays.indexOf(d) < 0) n++;
      d = addDays(d, 1);
    }
    return n;
  }

  /* 保険の資格がある対象月か（取得月〜喪失月の前月・同月得喪は1か月） */
  function insCovered(ins, profile, target) {
    var from = ins && isDate(ins.from) ? ins.from : (isDate(profile.entry_date) ? profile.entry_date : null);
    var loss = ins && isDate(ins.to) ? ins.to : (isDate(profile.retire_date) ? addDays(profile.retire_date, 1) : null);
    var acq = from ? ymOf(from) : null, lossYm = loss ? ymOf(loss) : null;
    if (acq && target < acq) return false;
    if (lossYm) {
      if (acq && acq === lossYm) return target === acq;
      if (target >= lossYm) return false;
    }
    return true;
  }

  /* 雇用保険の資格（期間の日付で見る・取得日〜喪失日の前日と期間が重なれば数える） */
  function empCovered(ins, profile, period) {
    var from = ins && isDate(ins.from) ? ins.from : (isDate(profile.entry_date) ? profile.entry_date : null);
    var loss = ins && isDate(ins.to) ? ins.to : (isDate(profile.retire_date) ? addDays(profile.retire_date, 1) : null);
    if (from && from > period.to) return false;
    if (loss && loss <= period.from) return false;
    return true;
  }

  /* 割増の基礎に入る手当を時間あたりの額にする（1つにまとめた関数・freee の検算で確かめる所）
     時間の手当は時間あたりの額をそのまま足し、ほか（定額・回数・日・夜勤）はその月の額を月平均所定労働時間で割る */
  function otBaseAdd(list, avgH) {
    var sum = Q(0);
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      sum = qAdd(sum, x.calc === 'hour' ? intQ(x.perHour) : qDiv(intQ(x.month), avgH));
    }
    return sum;
  }

  /* ── 4. 源泉 ── */
  function taxTable(T, A, dep, col) {
    var d = Math.max(0, Math.floor(Number(dep) || 0)), A_ = Math.max(0, Math.floor(A));
    var kou, otsu, i;
    if (A_ < T.first.max) {
      kou = 0;
      otsu = yen(qMul(intQ(A_), rateQ(T.first.otsuRate / 100)), 'floor');
    } else if (A_ < T.rows[T.rows.length - 1][1]) {
      var row = null;
      for (i = 0; i < T.rows.length; i++) if (A_ >= T.rows[i][0] && A_ < T.rows[i][1]) { row = T.rows[i]; break; }
      kou = row[2][Math.min(d, 7)]; otsu = row[3];
    } else {
      var up = null;
      for (i = 0; i < T.upper.length; i++) if (A_ >= T.upper[i].min && (T.upper[i].max === null || A_ < T.upper[i].max)) { up = T.upper[i]; break; }
      kou = T.upper[i].kouBase[Math.min(d, 7)] + yen(qMul(intQ(A_ - up.min), rateQ(up.rate / 100)), 'floor');
      otsu = up.otsuBase + yen(qMul(intQ(A_ - up.otsuOver), rateQ(up.otsuRate / 100)), 'floor');
    }
    if (col === 'otsu') return Math.max(0, otsu - 1610 * d);
    if (d > 7) kou = Math.max(0, kou - 1610 * (d - 7));
    return kou;
  }
  /* 甲欄の電算機特例（令和8年分の式だけ・rates-2026.md §4） */
  function taxComputerR8(A, dep) {
    A = Math.max(0, Math.floor(A)); var n = Math.max(0, Math.floor(Number(dep) || 0)), K;
    if (A <= 158333) K = 54167;
    else if (A <= 299999) K = Number(qCeil(Q(B(A) * 3n + 66670n, 10)));
    else if (A <= 549999) K = Number(qCeil(Q(B(A) * 2n + 366670n, 10)));
    else if (A <= 708330) K = Number(qCeil(Q(B(A) + 916670n, 10)));
    else K = 162500;
    var basic = A <= 2120833 ? 48334 : A <= 2162499 ? 40000 : A <= 2204166 ? 26667 : A <= 2245833 ? 13334 : 0;
    var b = Math.max(0, A - K - 31667 * n - basic);
    var steps = [[162500, 0.05105, 0], [275000, 0.1021, 8296], [579166, 0.2042, 36374], [750000, 0.23483, 54113],
      [1500000, 0.33693, 130688], [3333333, 0.4084, 237893], [Infinity, 0.45945, 408061]];
    for (var i = 0; i < steps.length; i++) {
      if (b <= steps[i][0]) {
        var t = qSub(qMul(intQ(b), rateQ(steps[i][1])), intQ(steps[i][2]));
        if (t.n <= 0n) return 0;
        return Number(roundQ(qDiv(t, Q(10)), 'round').n) * 10;   /* 10円未満四捨五入 */
      }
    }
    return 0;
  }

  /* ── 5. 計算の本体 ── */
  function computeItem(input) {
    badNum = 0;
    try { return computeItem_(input); } catch (e) {
      return { lines: [], gross: 0, taxable: 0, si_total: 0, emp_ins_base: 0, tax_base: 0, deduct: 0, net: 0,
        buckets: { taxable: 0, nontax: 0, emp_ins_base: 0, labor_ins_base: 0, fixed_wage: 0, si_by_kind: { health: 0, care: 0, support: 0, pension: 0, emp: 0 } },
        warnings: [{ code: 'calc_error', msg: '計算できませんでした（入力の形を確かめてください）' }], fingerprint_inputs: { profile_rev: null, settings_rev: null, rates_ver: null, calc_ver: CALC_VER } };
    }
  }
  function computeItem_(input) {
    input = input || {};
    var R = input.rates || Rates;
    var S = fillSettings(input.settings);
    var P = input.profile && typeof input.profile === 'object' ? input.profile : {};
    var att = input.att && typeof input.att === 'object' ? input.att : null;
    var ym = input.ym, period = input.period || {}, payDate = input.payDate;
    var lines = [], warnings = [];
    function warn(code, msg) { for (var i = 0; i < warnings.length; i++) if (warnings[i].code === code) return; warnings.push({ code: code, msg: msg }); }
    function line(sec, code, name, qty, unit, amount, basis) { lines.push({ sec: sec, code: code, name: name, qty: qty, unit: unit, amount: amount, basis: basis || '' }); }
    var item = {
      lines: lines, gross: 0, taxable: 0, si_total: 0, emp_ins_base: 0, tax_base: 0, deduct: 0, net: 0,
      buckets: { taxable: 0, nontax: 0, emp_ins_base: 0, labor_ins_base: 0, fixed_wage: 0, si_by_kind: { health: 0, care: 0, support: 0, pension: 0, emp: 0 } },
      warnings: warnings,
      fingerprint_inputs: { profile_rev: input.profile_rev == null ? null : input.profile_rev, settings_rev: input.settings_rev == null ? null : input.settings_rev, rates_ver: R.VERSION || null, calc_ver: CALC_VER }
    };
    if (!isYm(ym) || !isDate(period.from) || !isDate(period.to) || !isDate(payDate)) { warn('badinput', '月分・期間・支給日の形が違います'); return item; }
    if (P.exclude) { warn('excluded', '計算から外す人です'); return item; }
    if ((isDate(P.retire_date) && P.retire_date < period.from) || (isDate(P.entry_date) && P.entry_date > period.to)) {
      warn('out_of_period', '期間の外に退職・入社している人です（満額で数えています・計算から外すか確かめてください）');
    }

    var type = P.pay_type, board = type === 'board';
    if (['monthly', 'hourly', 'daily', 'board'].indexOf(type) < 0) { warn('pay_type', '給与形態が決まっていません'); return item; }
    var defs = {}, order = [];
    (Array.isArray(input.allowanceDefs) ? input.allowanceDefs : []).forEach(function (d) { if (d && d.code) { defs[d.code] = d; order.push(d); } });
    order.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });

    var avgH = decQ(num(P.avg_month_hours, 1, 300, S.avg_month_hours_default));
    var avgD = decQ(num(P.avg_month_days, 1, 31, S.avg_month_days_default));
    var base = int(P.base);
    /* 1日の所定時間: 無い時は 月平均所定労働時間÷月平均所定労働日数（どちらかを明示した時）、それも無ければ8時間。どちらも警告 */
    var dayH;
    if (num(P.day_hours, 0.5, 24, null) !== null) dayH = decQ(P.day_hours);
    else {
      var setIn = input.settings && typeof input.settings === 'object' ? input.settings : {};
      var hGiven = num(P.avg_month_hours, 1, 300, null) !== null || num(setIn.avg_month_hours_default, 1, 300, null) !== null;
      var dGiven = num(P.avg_month_days, 1, 31, null) !== null || num(setIn.avg_month_days_default, 1, 31, null) !== null;
      dayH = hGiven && dGiven ? qDiv(avgH, avgD) : Q(8);
      dayH.missing = true;
    }
    function needDayH() { if (dayH.missing) warn('day_hours_missing', '1日の所定時間が空です（' + qNum(dayH) + '時間として数えました）'); return dayH; }
    if (!att && !P.no_attendance && !board) warn('no_att', '勤怠の集計がありません');
    if (att && att.locked === false) warn('kintai_unlocked', '勤怠の月がまだ締まっていません');
    if (att && Number(att.reviewCount) > 0) warn('review_left', '勤怠に要確認が残っています');
    var A = att || {};
    function m(k) { return Math.max(0, int(A[k])); }

    /* 支給の集め（行ごとに属性を持つ） */
    var pays = [];   /* {amount:int, tax:bool, labor:bool, fixed:bool, nontax:int} */
    function pay(code, name, qty, unit, amount, basis, at) {
      line('pay', code, name, qty, unit, amount, basis);
      pays.push({ amount: amount, tax: at.tax !== false, labor: at.labor !== false, fixed: !!at.fixed, si: at.si !== false, nontax: at.nontax || 0 });
    }

    /* 日割り（入社・退社の月） */
    var prorate = null;
    var inEntry = isDate(P.entry_date) && P.entry_date > period.from && P.entry_date <= period.to;
    var inRetire = isDate(P.retire_date) && P.retire_date >= period.from && P.retire_date < period.to;
    if ((inEntry || inRetire) && (type === 'monthly')) {
      var f = inEntry ? P.entry_date : period.from, t = inRetire ? P.retire_date : period.to;
      var days = att && att.schedDays != null ? m('schedDays') : weekdaysBetween(f, t, S.holidays);
      prorate = { days: days, from: f, to: t };
    }
    function prorated(amount) {
      if (!prorate) return amount;
      var v = yen(qDiv(qMul(intQ(amount), intQ(prorate.days)), avgD), S.round.prorate);
      return Math.min(amount, v);
    }

    /* 基本給 */
    var basePaid = 0;
    if (type === 'monthly') {
      basePaid = prorated(base);
      pay('basic', '基本給', prorate ? prorate.days : null, base, basePaid, prorate ? '日割り ' + base + '÷平均所定労働日数×' + prorate.days + '日' : '月給', { fixed: true });
    } else if (type === 'hourly') {
      var hMin = m('schedInMin') + m('paidMin');
      basePaid = yen(qDiv(qMul(intQ(base), intQ(hMin)), Q(60)), S.round.hourly_base);
      pay('basic', '基本給', hMin, base, basePaid, '時給×(所定内＋有休)' + hMin + '分÷60', { fixed: true });
    } else if (type === 'daily') {
      /* 法定休日に働いた日は法定休日労働（×1.35 の全額）で払うので、基本給の日数から除く */
      var wd = m('workDays');
      if (A.holidayWorkDays != null) wd = Math.max(0, wd - m('holidayWorkDays'));
      else if (m('holidayMin') > 0) warn('holiday_days_unknown', '法定休日に働いた日数が分かりません（基本給の日数から除いていません）');
      basePaid = base * wd;
      pay('basic', '基本給', wd, base, basePaid, '日給×出勤日数（法定休日を除く）', { fixed: true });
      if (m('paidDays') > 0) pay('paid_leave', '有休（日給）', m('paidDays'), base, base * m('paidDays'), '日給×有休の日数', { fixed: true });
    }
    if (board || Number(P.board_pay) > 0) {
      var bp = int(P.board_pay);
      pay('board', '役員報酬', null, bp, bp, '役員報酬', { fixed: true, labor: false });
    }

    /* 手当（定義の並び） */
    var pa = Array.isArray(P.allowances) ? P.allowances : [];
    var otBaseAdds = [], attBaseFixed = 0, minWageFixed = 0, nightIncluded = 0, nightAllowCount = 0;
    order.forEach(function (def) {
      if (def.sec && def.sec !== 'pay') return;
      for (var i = 0; i < pa.length; i++) {
        var a = pa[i];
        if (!a || a.code !== def.code) continue;
        var at = attrsOf(def), amt = int(a.amount), calc = def.calc || 'fixed', qty = null, v, basis;
        if (calc === 'fixed') {
          v = at.prorate ? prorated(amt) : amt; basis = at.prorate && prorate ? '日割り' : '定額';
          if (at.attendance_base) attBaseFixed += v;
          if (at.min_wage) minWageFixed += amt;
        } else {
          if (calc === 'count') {
            var src = a.count_source;
            qty = src && src !== 'manual' ? Math.max(0, Number((A.counts || {})[src]) || 0) : Math.max(0, Number(a.count) || 0);
            basis = '回数×単価';
          } else if (calc === 'night_shift') { qty = m('nightShiftCount'); basis = '夜勤回数×単価'; }
          else if (calc === 'day') { qty = m('workDays'); basis = '出勤日数×単価'; }
          else if (calc === 'hour') { qty = m('workMin'); basis = '労働時間×単価'; }
          else continue;
          var rmode = ROUND_MODES[def.round] && def.round !== 'none' ? def.round : 'ceil';
          v = calc === 'hour' ? yen(qDiv(qMul(intQ(amt), intQ(qty)), Q(60)), rmode) : yen(qMul(intQ(amt), decQ(qty)), rmode);
        }
        if (at.overtime_base && !board) otBaseAdds.push({ calc: calc, month: calc === 'fixed' ? amt : v, perHour: amt });
        if (at.includes_night_premium) { nightIncluded += v; nightAllowCount++; }
        pay('f' + def.code, def.name || def.code, qty, amt, v, basis, { tax: at.income_tax, labor: at.labor_ins, fixed: at.fixed_wage, si: at.social_ins });
      }
    });

    /* 固定残業代（profile.fixed_ot: { allowance_code, covered_min }・無ければ今の動き） */
    var fixedOt = null;
    if (P.fixed_ot && typeof P.fixed_ot === 'object' && !board) {
      var cov = Math.max(0, int(P.fixed_ot.covered_min));
      var fcode = P.fixed_ot.allowance_code;
      var hasAllow = fcode && defs[fcode] && pa.some(function (a) { return a && a.code === fcode; });
      if (!hasAllow) warn('fixed_ot_allowance', '固定残業代の手当が設定にありません（含む時間を引かずに数えました）');
      else fixedOt = { code: fcode, covered: cov };
    }

    /* 割増の単価 */
    var R_ = S.ot_rates, unit = null;
    if (!board) {
      var addH = otBaseAdd(otBaseAdds, avgH);
      if (type === 'monthly') unit = roundQ(qAdd(qDiv(intQ(base), avgH), addH), S.round.hour_unit);
      else if (type === 'hourly') unit = roundQ(qAdd(intQ(base), addH), S.round.hourly_unit);
      else if (type === 'daily') unit = roundQ(qAdd(qDiv(intQ(base), needDayH()), addH), S.round.hourly_unit);
    }
    if (unit) {
      var unitTxt = qNum(unit);
      [['in', 'legalInOverMin', 'ot_in', '法定内残業'], ['out', 'legalOverMin', 'ot_out', '時間外労働'], ['over60', 'over60Min', 'ot_over60', '60時間超の上乗せ'],
        ['night', 'nightMin', 'ot_night', '深夜の上乗せ'], ['holiday', 'holidayMin', 'ot_holiday', '法定休日労働']].forEach(function (x) {
        var mins = m(x[1]), name = x[3], fx = '';
        /* 固定残業代: 含む分（covered_min）は時間外の分から先に引き、超えた分だけを「残業代」として払う。
           法定内残業・60時間超・深夜の上乗せは今のまま。固定残業の手当そのものは手当の行で満額 */
        if (x[0] === 'out' && fixedOt) {
          mins = Math.max(0, mins - fixedOt.covered);
          name = '残業代';
          fx = '（固定残業代に含む ' + fixedOt.covered + '分を引いた後）';
        }
        if (x[0] === 'night') {
          var need = mins ? yen(qDiv(qMul(qMul(unit, rateQ(R_.night)), intQ(mins)), Q(60)), S.round.premium) : 0;
          /* 含む手当がその月に無い・0円の人は、含めようがないので上乗せを払う */
          if (S.night_premium === 'included' && nightAllowCount > 0 && nightIncluded > 0) {
            if (need > nightIncluded) warn('night_shortfall', '深夜の割増（' + need + '円）が夜勤手当（' + nightIncluded + '円）を超えています');
            return;
          }
        }
        if (!mins) return;
        var v = yen(qDiv(qMul(qMul(unit, rateQ(R_[x[0]])), intQ(mins)), Q(60)), S.round.premium);
        pay(x[2], name, mins, unitTxt, v, '単価' + unitTxt + '×' + R_[x[0]] + '×' + mins + '分÷60' + fx, {});
      });
    }

    /* 欠勤・遅刻早退の控除（月給だけ・マイナスの支給） */
    if (type === 'monthly' && att) {
      var dBase = base + attBaseFixed, capLeft = basePaid + attBaseFixed;
      var hu = roundQ(qDiv(intQ(dBase), avgH), S.round.deduct_unit);
      if (S.absence_deduct && m('absentDays') > 0) {
        var dhA = needDayH();
        var ab = Math.min(capLeft, yen(qMul(qMul(hu, dhA), intQ(m('absentDays'))), S.round.deduct));
        capLeft -= ab;
        pay('absence', '欠勤控除', m('absentDays'), qNum(hu), -ab, '時間単価' + qNum(hu) + '×1日の所定時間' + qNum(dhA) + '×日数', { fixed: false });
      }
      var lm = m('lateMin') + m('earlyLeaveMin');
      if (S.late_deduct && lm > 0) {
        var la = Math.min(capLeft, yen(qDiv(qMul(hu, intQ(lm)), Q(60)), S.round.deduct));
        pay('late', '遅刻早退控除', lm, qNum(hu), -la, '時間単価' + qNum(hu) + '×' + lm + '分÷60', { fixed: false });
      }
    }

    /* 通勤（非課税は限度まで） */
    var cm = P.commute && typeof P.commute === 'object' ? int(P.commute.monthly) : 0;
    if (cm > 0) {
      var lim = R.commuteLimit ? R.commuteLimit(payDate, P.commute.means, Number(P.commute.distance_km)) : null;
      var nt = cm;
      if (lim == null) warn('commute_limit_unknown', '通勤手当の非課税限度が率表にありません（全額を非課税として数えました）');
      else nt = Math.min(cm, lim);
      pay('commute', '通勤手当', null, cm, cm, nt < cm ? '非課税 ' + nt + '円・課税 ' + (cm - nt) + '円' : '非課税', { fixed: true, nontax: nt, si: true });
    }

    /* 調整（支給） */
    var adj = Array.isArray(input.adjustments) ? input.adjustments : [];
    var adjDeduct = [], adjSi = 0, adjTax = 0;
    adj.forEach(function (x, i) {
      if (!x) return;
      var v = int(x.amount), nm = x.name || '調整';
      if (x.kind === 'pay') pay('adj:' + i, nm, null, null, v, x.reason || '', {});
      else if (x.kind === 'pay_nontax') pay('adj_nontax:' + i, nm, null, null, v, x.reason || '', { tax: false, labor: false, nontax: v, si: false });
      else if (x.kind === 'deduct') adjDeduct.push({ code: 'adj:' + i, name: nm, amount: v, si: false, basis: x.reason || '' });
      else if (x.kind === 'deduct_si') { adjDeduct.push({ code: 'adj:' + i, name: nm, amount: v, si: true, basis: x.reason || '' }); adjSi += v; }
      else if (x.kind === 'tax_adjust') adjTax += v;
    });

    /* 支給の合計と区分 */
    var gross = 0, nontax = 0, labor = 0, fixedW = 0;
    pays.forEach(function (p) {
      gross += p.amount;
      if (!p.tax) nontax += p.amount; else if (p.nontax) nontax += p.nontax;
      if (p.labor) labor += p.amount;
      if (p.fixed) fixedW += p.amount;
    });
    var taxable = gross - nontax;
    if (board) labor = 0;
    var empOn = !!(!board && P.ins && P.ins.emp && P.ins.emp.on && empCovered(P.ins.emp, P, period));
    var empBase = empOn ? Math.max(0, labor) : 0;

    /* 社保（保険料の対象月） */
    var target = S.si_month === 'current' ? ym : ymAdd(ym, -1);
    var ins = P.ins && typeof P.ins === 'object' ? P.ins : {};
    var si = { health: 0, care: 0, support: 0, pension: 0, emp: 0 }, er = [];
    var birth = isDate(P.birth_date) ? P.birth_date : null;
    var hOn = ins.health && ins.health.on, pOn = ins.pension && ins.pension.on;
    /* 加入の印（on）が真偽で入っていない保険は、加入していないとして数え、黙らずに知らせる（取り込みで作った設定など・2026-11-19）。役員は雇用保険を見ない */
    var unset = ['health', 'pension'].concat(board ? [] : ['emp']).filter(function (k) { return !(ins[k] && typeof ins[k] === 'object' && typeof ins[k].on === 'boolean'); });
    if (unset.length) warn('ins_unset', '加入が決まっていない保険があります（' + unset.map(function (k) { return { health: '健康保険', pension: '厚生年金', emp: '雇用保険' }[k]; }).join('・') + '・加入していないとして数えました）');
    if ((hOn || pOn) && !birth) warn('birth_missing', '生年月日が空です（介護・年齢の判定ができません）');
    /* 産休・育休の免除（対象月が免除の期間なら健保・介護・支援金・厚年は0・雇保は賃金で数える） */
    var exempt = (Array.isArray(ins.exempt) ? ins.exempt : []).some(function (x) { return x && isYm(x.from_ym) && x.from_ym <= target && (!isYm(x.to_ym) || target <= x.to_ym); });
    if (exempt) { hOn = false; pOn = false; }
    /* 当月徴収: 資格を取った月が前の期間に入らず、この期間に入った時、その月の分を取りこぼす */
    if (S.si_month === 'current' && (hOn || pOn)) {
      var acqD = [ins.health, ins.pension].map(function (x) { return x && isDate(x.from) ? x.from : (isDate(P.entry_date) ? P.entry_date : null); }).filter(Boolean)[0];
      if (acqD && ymOf(acqD) < target && acqD >= period.from) warn('si_first_month_missed', '資格を取った月（' + ymOf(acqD) + '）の社会保険料をどの明細でも引いていない見込みです（調整で引いてください）');
    }
    var rt = (hOn || pOn) ? R.health(S.prefecture, target) : null;
    if ((hOn || pOn) && !rt) warn('rate_missing', target + ' 分の社会保険料率が率表にありません');
    if (rt && hOn && insCovered(ins.health, P, target) && !(birth && target >= ymOf(birthdayAt(birth, 75)))) {
      var hs = int(ins.health.std);
      if (!hs) warn('std_missing', '健康保険の標準報酬月額が空です');
      else {
        if (R.isStd && !R.isStd('health', hs)) warn('std_bad', '健康保険の標準報酬月額が等級表にありません');
        var std = intQ(hs);
        var careOn = birth && !ins.care_exempt && target >= reachYm(birth, 40) && target < reachYm(birth, 65);
        [['health', '健康保険料', rt.health], ['care', '介護保険料', careOn ? rt.care : 0], ['support', '子ども・子育て支援金', rt.support]].forEach(function (k) {
          if (!k[2]) return;
          var full = qMul(std, rateQ(k[2])), mine = round50(qDiv(full, Q(2)));
          si[k[0]] = mine;
          er.push({ code: 'er_' + k[0], name: k[1] + '（会社）', amount: qNum(qSub(full, intQ(mine))), basis: '標準報酬' + hs + '×' + k[2] + '−本人分' });
        });
      }
    }
    if (rt && pOn && insCovered(ins.pension, P, target) && !(birth && target >= reachYm(birth, 70))) {
      var ps = int(ins.pension.std);
      if (!ps) warn('std_missing', '厚生年金の標準報酬月額が空です');
      else {
        if (R.isStd && !R.isStd('pension', ps)) warn('std_bad', '厚生年金の標準報酬月額が等級表にありません');
        var pfull = qMul(intQ(ps), rateQ(rt.pension)), pm = round50(qDiv(pfull, Q(2)));
        si.pension = pm;
        er.push({ code: 'er_pension', name: '厚生年金保険料（会社）', amount: qNum(qSub(pfull, intQ(pm))), basis: '標準報酬' + ps + '×' + rt.pension + '−本人分' });
        er.push({ code: 'er_child', name: '子ども・子育て拠出金', amount: qNum(qMul(intQ(ps), rateQ(rt.childcare_contrib))), basis: '標準報酬' + ps + '×' + rt.childcare_contrib });
      }
    }
    if (empOn) {
      var re = R.employment(period.to, S.emp_ins_kind);
      if (!re) warn('emp_rate_missing', '締め日 ' + period.to + ' の雇用保険料率が率表にありません');
      else {
        si.emp = round50(qMul(intQ(empBase), rateQ(re.worker)));
        er.push({ code: 'er_emp', name: '雇用保険料（会社）', amount: qNum(qMul(intQ(empBase), rateQ(re.employer))), basis: '賃金' + empBase + '×' + re.employer });
      }
    }
    /* 定額の控除（定義の並び）。定義で social_ins が true のものは「社会保険料として扱う」＝税の基礎から引く */
    var pd = Array.isArray(P.deductions) ? P.deductions : [], fixedDed = [], fixedSi = 0;
    order.forEach(function (def) {
      if (def.sec !== 'deduct') return;
      pd.forEach(function (x) {
        if (!x || x.code !== def.code) return;
        var v = int(x.amount), asSi = !!(def.attrs && def.attrs.social_ins === true);
        if (asSi) fixedSi += v;
        fixedDed.push({ code: 'd:' + def.code, name: def.name || def.code, amount: v, basis: asSi ? '定額（社会保険料として扱う）' : '定額' });
      });
    });
    /* 定義の無い code は黙って落とさず知らせる */
    pa.concat(pd).forEach(function (x) {
      if (x && x.code && !defs[x.code]) warn('def_missing', '手当・控除の定義が無い項目があります（' + x.code + '）・計算に入れていません');
    });
    var siTotal = si.health + si.care + si.support + si.pension + si.emp + adjSi + fixedSi;

    /* 源泉 */
    var taxBase = taxable - siTotal, tax = 0, col = P.tax && P.tax.col, dep = P.tax ? P.tax.dependents : 0;
    if (P.tax && P.tax.dependents_checked === false) warn('dependents_unchecked', '扶養の数が未確認です');
    if (col === 'kou' || col === 'otsu') {
      var useComputer = S.tax_method === 'computer' && col === 'kou';
      if (useComputer && payDate.slice(0, 4) === '2026') tax = taxComputerR8(taxBase, dep);
      else {
        if (useComputer) warn('tax_computer_unavailable', '電算機特例の式は令和8年分しかありません（税額表で数えました）');
        var T = R.taxTable(payDate);
        if (!T) warn('tax_table_missing', '支給日の年の税額表がありません（所得税を0円にしています）');
        else tax = taxTable(T, taxBase, dep, col);
      }
    } else if (col !== 'none') warn('tax_col', '源泉の区分（甲・乙）が決まっていません');
    tax = Math.max(0, tax);
    var resident = P.resident_tax && typeof P.resident_tax === 'object' ? Math.max(0, int(P.resident_tax[payDate.slice(0, 7)])) : 0;

    /* 控除の行 */
    var dsum = 0;
    function ded(code, name, amount, basis) { line('deduct', code, name, null, null, amount, basis); dsum += amount; }
    if (si.health) ded('health', '健康保険料', si.health, '対象月 ' + target);
    if (si.care) ded('care', '介護保険料', si.care, '対象月 ' + target);
    if (si.support) ded('support', '子ども・子育て支援金', si.support, '対象月 ' + target);
    if (si.pension) ded('pension', '厚生年金保険料', si.pension, '対象月 ' + target);
    if (empOn) ded('emp', '雇用保険料', si.emp, '賃金 ' + empBase);
    if (col === 'kou' || col === 'otsu') ded('income_tax', '所得税', tax, (col === 'otsu' ? '乙欄' : '甲欄') + ' 課税対象 ' + taxBase);
    /* 税の精算（年調の過不足など）は所得税と別の行。負（還付）もそのまま通す */
    if (adjTax) ded('tax_adjust', '所得税の精算', adjTax, '調整');
    if (resident) ded('resident_tax', '住民税', resident, payDate.slice(0, 7));
    fixedDed.forEach(function (x) { ded(x.code, x.name, x.amount, x.basis); });
    adjDeduct.forEach(function (x) { ded(x.code, x.name, x.amount, x.basis); });
    er.forEach(function (x) { line('employer', x.code, x.name, null, null, x.amount, x.basis); });

    /* 勤怠の行（表示用） */
    if (att) {
      [['workDays', '出勤日数'], ['paidDays', '有休日数'], ['absentDays', '欠勤日数'], ['workMin', '総労働（分）'], ['schedInMin', '所定内（分）'],
        ['legalInOverMin', '法定内残業（分）'], ['legalOverMin', '時間外（分）'], ['over60Min', '60時間超（分）'], ['nightMin', '深夜（分）'],
        ['holidayMin', '法定休日（分）'], ['lateMin', '遅刻（分）'], ['earlyLeaveMin', '早退（分）'], ['nightShiftCount', '夜勤回数']].forEach(function (k) {
        line('att', k[0], k[1], m(k[0]), null, 0, '');
      });
    }

    item.gross = gross; item.taxable = taxable; item.si_total = siTotal; item.emp_ins_base = empBase; item.tax_base = taxBase;
    item.deduct = dsum; item.net = gross - dsum;
    item.buckets = { taxable: taxable, nontax: nontax, emp_ins_base: empBase, labor_ins_base: board ? 0 : labor, fixed_wage: fixedW, si_by_kind: si };

    /* 警告 */
    if (item.net < 0) warn('net_negative', '差引支給額がマイナスです');
    if (input.prevItem && Number(input.prevItem.gross) > 0) {
      var pg = Number(input.prevItem.gross);
      if (Math.abs(gross - pg) * 5 >= pg) warn('prev_change', '前月の総支給から20%以上変わっています');
    }
    if (!board && unit !== null) {
      var mw = R.minWage ? R.minWage(S.prefecture, period.to) : null;
      if (mw == null) warn('min_wage_unknown', '最低賃金が率表にありません（判定していません）');
      else {
        var eq;
        if (type === 'monthly') eq = qDiv(intQ(base + minWageFixed), avgH);
        else if (type === 'hourly') eq = qAdd(intQ(base), qDiv(intQ(minWageFixed), avgH));
        else eq = qAdd(qDiv(intQ(base), needDayH()), qDiv(intQ(minWageFixed), avgH));
        if (qCmp(eq, intQ(mw)) < 0) warn('min_wage', '時間あたり ' + qNum(eq) + '円が最低賃金 ' + mw + '円を下回っています');
      }
    }
    if (badNum) warn('bad_number', '数でない値がありました（0として数えました）');
    return item;
  }

  /* ── 画面向けの口（2026-11-19 結びの段・計算の決まりは変えない） ──
     支給日: 月分 ym の pay_day 日（月の日数を超えれば月末）。土日と settings.holidays の日は
     pay_day_shift で寄せる（'before' 前の営業日・既定／'after' 後の営業日／'none' 寄せない）。国民の祝日は settings.holidays に入れた分だけ（仮置き） */
  function payDate(ym, settings) {
    if (!isYm(ym)) return null;
    var s = settings && typeof settings === 'object' ? settings : {};
    var day = Number(s.pay_day);
    day = isFinite(day) && day >= 1 && day <= 31 ? Math.floor(day) : 27;
    var last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
    var d = ym + '-' + (Math.min(day, last) < 10 ? '0' : '') + Math.min(day, last);
    var step = s.pay_day_shift === 'after' ? 1 : (s.pay_day_shift === 'none' ? 0 : -1);
    var hol = Array.isArray(s.holidays) ? s.holidays : [];
    for (var i = 0; step && i < 31; i++) {
      var w = new Date(d + 'T00:00:00Z').getUTCDay();
      if (w !== 0 && w !== 6 && hol.indexOf(d) < 0) break;
      d = addDays(d, step);
    }
    return d;
  }

  var api = {
    VERSION: CALC_VER, payDate: payDate,
    CALC_VER: CALC_VER, DEFAULTS: DEFAULTS, computeItem: computeItem, fillSettings: fillSettings, attrsOf: attrsOf,
    reachDate: reachDate, reachYm: reachYm, birthdayAt: birthdayAt, insCovered: insCovered, ymAdd: ymAdd, addDays: addDays,
    empCovered: empCovered, otBaseAdd: otBaseAdd, taxTable: taxTable, taxComputerR8: taxComputerR8, round50: round50, weekdaysBetween: weekdaysBetween,
    _q: { Q: Q, rateQ: rateQ, roundQ: roundQ, yen: yen }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollCalc = api;
})(typeof window !== 'undefined' ? window : this);
