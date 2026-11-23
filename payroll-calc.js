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
  var CALC_VER = 'payroll-calc-3';   /* 2026-11-23: 電算機特例に令和9年分の式を足した。 2026-11-21: 時給・日給の有休、日給の法定休日の差、乙欄、通勤手当の非課税限度を直した（確定した明細の指紋で前の版と区別する） */

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
  /* 甲欄の電算機特例（財務省告示の式・年ごと）。出典: 国税庁「月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」
     令和8年分 https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf
     令和9年分 https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/denshi_01.pdf （令和8年4月30日財務省告示第128号・2026-11-23 に確かめた）
     令和9年分で変わったのは、給与所得控除の最低の区分（169,444円以下は57,500円）と基礎控除の最初の区分（2,120,833円以下は51,667円）だけ。
     表の無い年は null（呼ぶ側が税額表で数えて警告する・別の年の式で代えない） */
  var COMPUTER = {
    2026: { kMinMax: 158333, kMin: 54167, basicFirst: 48334 },
    2027: { kMinMax: 169444, kMin: 57500, basicFirst: 51667 }
  };
  function taxComputer(A, dep, year) {
    var Y = COMPUTER[year];
    if (!Y) return null;
    A = Math.max(0, Math.floor(A)); var n = Math.max(0, Math.floor(Number(dep) || 0)), K;
    if (A <= Y.kMinMax) K = Y.kMin;
    else if (A <= 299999) K = Number(qCeil(Q(B(A) * 3n + 66670n, 10)));
    else if (A <= 549999) K = Number(qCeil(Q(B(A) * 2n + 366670n, 10)));
    else if (A <= 708330) K = Number(qCeil(Q(B(A) + 916670n, 10)));
    else K = 162500;
    var basic = A <= 2120833 ? Y.basicFirst : A <= 2162499 ? 40000 : A <= 2204166 ? 26667 : A <= 2245833 ? 13334 : 0;
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
  /* 令和8年分の式（前からの呼び名を残す） */
  function taxComputerR8(A, dep) { return taxComputer(A, dep, 2026); }

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
    /* 勤怠 v5 段4: 休暇の種類の日数は半日きざみのまま（丸めると半日が1日になる）。有理数で返す */
    function mHalf(k) { return Q(Math.max(0, Math.round(fin(A[k]) * 2)), 2); }
    function halfNum(k) { return Math.max(0, Math.round(fin(A[k]) * 2)) / 2; }

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
      /* 給与の額の直し（代表者の決定 2026-11-20）: 予定も前提も無い勤務は全部が法定内残業に入り、基本給も満額のまま。数え方は変えず、確かめを促す警告を出す（勤怠の「確認済み」では消えない） */
      if (m('noSchedWorkMin') > 0) warn('no_sched_monthly', '予定の無い勤務が' + m('noSchedWorkMin') + '分あり、全部を残業として数えています。勤怠の「職員と番号」で固定時間の前提を入れてください');
    } else if (type === 'hourly') {
      var hMin = m('schedInMin') + m('paidMin');
      /* 給与の額の直し（代表者の決定 2026-11-20・反証レビュー 2026-11-21）: 予定の無い日の有休（シフトの「有」の日・手入力で予定の無い日）は、勤怠が1日を8時間などで数えるので、
         1日の所定時間が入っている時は「予定の無い日の有休の日数×1日の所定時間」で払う。予定のある日の有休は今までどおりその日の予定の実働（paidMin のまま）。
         1日の所定時間が空の時は今の値のまま払い、警告を出す。鍵（paidNoSchedDays・paidNoSchedMin）の無い古い控えは今までどおり paidMin で払う */
      var nsD = A.paidNoSchedDays != null && A.paidNoSchedMin != null ? halfNum('paidNoSchedDays') : 0, nsM = nsD > 0 ? Math.min(m('paidNoSchedMin'), m('paidMin')) : 0;
      if (nsD > 0 && nsM > 0 && !dayH.missing) {
        var nsQ = qMul(qMul(mHalf('paidNoSchedDays'), dayH), Q(60)), keepMin = m('paidMin') - nsM, hsQ = qAdd(intQ(m('schedInMin') + keepMin), nsQ);
        basePaid = yen(qDiv(qMul(intQ(base), hsQ), Q(60)), S.round.hourly_base);
        hMin = Math.round(qNum(hsQ));
        pay('basic', '基本給', hMin, base, basePaid, '時給×(所定内' + m('schedInMin') + '分＋有休（予定のある日・時間単位）' + keepMin + '分＋予定の無い日の有休' + nsD + '日×1日の所定時間' + qNum(dayH) + '時間×60)÷60', { fixed: true });
      } else {
        if (nsD > 0 && nsM > 0) needDayH();
        basePaid = yen(qDiv(qMul(intQ(base), intQ(hMin)), Q(60)), S.round.hourly_base);
        pay('basic', '基本給', hMin, base, basePaid, '時給×(所定内＋有休)' + hMin + '分÷60', { fixed: true });
      }
      /* 勤怠 v5 段4（仮置き）: 時間単位の有休は効く分（その日の所定の時間のうち働かなかった分まで）が paidMin に入っているので上の基本給で払う。有給の特別休暇は時給×その分。無給の特別休暇・代休は払わない */
      if (m('specialPaidMin') > 0) {
        var spH = yen(qDiv(qMul(intQ(base), intQ(m('specialPaidMin'))), Q(60)), S.round.hourly_base);
        pay('special_paid', '特別休暇（有給）', m('specialPaidMin'), base, spH, '時給×特別休暇' + m('specialPaidMin') + '分÷60', { fixed: true });
      }
    } else if (type === 'daily') {
      /* 法定休日に働いた日は法定休日労働（×1.35 の全額）で払うので、基本給の日数から除く */
      var wd = m('workDays');
      if (A.holidayWorkDays != null) wd = Math.max(0, wd - m('holidayWorkDays'));
      else if (m('holidayMin') > 0) warn('holiday_days_unknown', '法定休日に働いた日数が分かりません（基本給の日数から除いていません）');
      basePaid = base * wd;
      pay('basic', '基本給', wd, base, basePaid, '日給×出勤日数（法定休日を除く）', { fixed: true });
      /* 有休は半日きざみのまま（日給×0.5日・2026-11-21。前は日数を整数に丸めて半日も1日分を払っていた）。整数の日は今と同じ額。
         反証レビュー（2026-11-21）: 働いた日はその日の日給をもう満額払っているので、働いた日の半日有休は上乗せしない（働いていない日の有休 paidOffDays だけ払う・時間単位の有休・特別休暇と同じ）。
         鍵の無い古い控えは今までどおり有休の日数で払う */
      var plK = A.paidOffDays != null ? 'paidOffDays' : 'paidDays';
      if (halfNum(plK) > 0) pay('paid_leave', '有休（日給）', halfNum(plK), base, yen(qMul(intQ(base), mHalf(plK)), S.round.hourly_base), plK === 'paidOffDays' ? '日給×働いていない日の有休の日数' : '日給×有休の日数', { fixed: true });
      /* 勤怠 v5 段4（仮置き・反証レビュー 2026-11-20）: 働いた日はその日の日給をもう満額払っているので上乗せしない。働いていない日だけ、
         時間単位の有休は「効く分÷1日の所定時間×日給」（hourlyPaidOffMin）、有給の特別休暇は「日給×日数」（specialPaidOffDays）。無給の特別休暇・代休は払わない */
      if (m('hourlyPaidOffMin') > 0) {
        var dhH = needDayH(), hpD = yen(qDiv(qMul(intQ(base), intQ(m('hourlyPaidOffMin'))), qMul(dhH, Q(60))), S.round.hourly_base);
        pay('paid_leave_hour', '有休（時間単位）', m('hourlyPaidOffMin'), base, hpD, '日給×働いていない日の時間単位の有休' + m('hourlyPaidOffMin') + '分÷60÷1日の所定時間' + qNum(dhH), { fixed: true });
      }
      if (halfNum('specialPaidOffDays') > 0) {
        var spD = yen(qMul(intQ(base), mHalf('specialPaidOffDays')), S.round.hourly_base);
        pay('special_paid', '特別休暇（有給）', halfNum('specialPaidOffDays'), base, spD, '日給×働いていない日の特別休暇の日数', { fixed: true });
      }
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

    /* 固定残業代（profile.fixed_ot: { allowance_code, covered_min, checked }・無ければ今の動き） */
    var fixedOt = null;
    if (P.fixed_ot && typeof P.fixed_ot === 'object' && !board) {
      var cov = Math.max(0, int(P.fixed_ot.covered_min));
      var fcode = P.fixed_ot.allowance_code;
      var hasAllow = fcode && defs[fcode] && pa.some(function (a) { return a && a.code === fcode; });
      if (!hasAllow) warn('fixed_ot_allowance', '固定残業代の手当が設定にありません（含む時間を引かずに数えました）');
      else fixedOt = { code: fcode, covered: cov };
      /* 含む時間を確かめたか（checked が true でなければ知らせる・数え方は変えない・代表者の決定 2026-11-19・文は仮置き） */
      if (P.fixed_ot.checked !== true) warn('fixed_ot_unchecked', '固定残業代の含む時間を freee の画面か雇用契約書で確かめてください');
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
      /* 反証レビュー（2026-11-21・仮置き）: 日給の人が全部を法定休日に働いた日（基本給の日数から除いた日）は、その日の休日労働の額が日給より少なければ差を足す（多い方を払う）。
         日ごとの実働は勤怠の holidayDaysMin（無い古い控えは足さない） */
      if (type === 'daily' && Array.isArray(A.holidayDaysMin) && A.holidayDaysMin.length) {
        var gap = 0, gapN = 0;
        A.holidayDaysMin.forEach(function (hm) {
          hm = Math.max(0, int(hm));
          var pd = yen(qDiv(qMul(qMul(unit, rateQ(R_.holiday)), intQ(hm)), Q(60)), S.round.premium);
          if (pd < base) { gap += base - pd; gapN++; }
        });
        if (gap > 0) pay('holiday_gap', '休日の日給との差', gapN, base, gap, '全部を法定休日に働いた日のうち、その日の休日労働の額が日給' + base + '円より少ない' + gapN + '日の差', {});
      }
    }

    /* 欠勤・遅刻早退の控除（月給だけ・マイナスの支給） */
    if (type === 'monthly' && att) {
      var dBase = base + attBaseFixed, capLeft = basePaid + attBaseFixed;
      var hu = roundQ(qDiv(intQ(dBase), avgH), S.round.deduct_unit);
      /* 欠勤の日数（半日きざみ・欠勤の印の日に半日の休暇があると 0.5 日）×日額＋欠勤の分（欠勤の印の日の休暇で埋まらない残り）×時間単価（再確認の反証 2026-11-20・仮置き）。
         欠勤の分が無い月は今までと同じ式・同じ根拠の文 */
      var abD = halfNum('absentDays'), abP = m('absentPartMin');
      if (S.absence_deduct && (abD > 0 || abP > 0)) {
        var dhA = needDayH();
        var abQ = qMul(qMul(hu, dhA), mHalf('absentDays'));
        if (abP > 0) abQ = qAdd(abQ, qDiv(qMul(hu, intQ(abP)), Q(60)));
        var ab = Math.min(capLeft, yen(abQ, S.round.deduct));
        capLeft -= ab;
        pay('absence', '欠勤控除', abD, qNum(hu), -ab, '時間単価' + qNum(hu) + '×1日の所定時間' + qNum(dhA) + '×日数' + (abP > 0 ? '＋時間単価×欠勤の時間' + abP + '分÷60' : ''), { fixed: false });
      }
      /* 勤怠 v5 段4（仮置き）: 無給の特別休暇と代休は、欠勤と同じに日数で控除する（有給の特別休暇・時間単位の有休は控除しない。時間単位の有休の時間は勤怠の計算が遅刻・早退から除いてある） */
      var ulD = halfNum('specialUnpaidDays') + halfNum('compDays');
      if (S.absence_deduct && ulD > 0) {
        var dhU = needDayH(), ulQ = qAdd(mHalf('specialUnpaidDays'), mHalf('compDays'));
        var ul = Math.min(capLeft, yen(qMul(qMul(hu, dhU), ulQ), S.round.deduct));
        capLeft -= ul;
        pay('leave_unpaid', '特別休暇（無給）・代休の控除', ulD, qNum(hu), -ul, '時間単価' + qNum(hu) + '×1日の所定時間' + qNum(dhU) + '×日数', { fixed: false });
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
      var lim = R.commuteLimit ? R.commuteLimit(payDate, P.commute.means, P.commute.distance_km == null || P.commute.distance_km === '' ? NaN : Number(P.commute.distance_km), P.commute.parking_monthly) : null;
      var nt = cm;
      /* 非課税限度の表は国税庁の表（payroll-rates.js の COMMUTE・支給日で選ぶ）。手段か距離が分からない人・併用の人は今の扱いのまま（全額を非課税）で知らせる（仮置き 2026-11-21） */
      if (lim == null) {
        var cmMeans = P.commute.means, cmKm = P.commute.distance_km;
        warn('commute_limit_unknown', !cmMeans ? '通勤の手段が空なので、通勤手当の非課税限度を決められません（全額を非課税として数えました）' :
          cmMeans === 'car' && (cmKm == null || cmKm === '' || !isFinite(Number(cmKm))) ? '通勤の片道の距離が空なので、通勤手当の非課税限度を決められません（全額を非課税として数えました）' :
          cmMeans === 'mixed' ? '併用の通勤手当は非課税限度を数えていません（全額を非課税として数えました・分け方を確かめてください）' :
          '通勤手当の非課税限度が率表にありません（全額を非課税として数えました）');
      }
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
    /* 甲乙・扶養の数を確かめたか（dependents_checked が true でない源泉の対象の人に知らせる・代表者の決定 2026-11-19） */
    if ((col === 'kou' || col === 'otsu') && !(P.tax && P.tax.dependents_checked === true)) warn('dependents_unchecked', '扶養の数が未確認です');
    /* 乙欄では扶養の数を引かない（甲から乙へ変えた人の数が残るため・従たる給与の申告書の分は数えない・仮置き 2026-11-21） */
    if (col === 'otsu') {
      if (Math.floor(Number(dep) || 0) >= 1) warn('otsu_dependents', '乙欄では扶養の数を数えていません（従たる給与の申告書を出した方は代表者へ）');
      dep = 0;
    }
    if (col === 'kou' || col === 'otsu') {
      var useComputer = S.tax_method === 'computer' && col === 'kou';
      var ct = useComputer ? taxComputer(taxBase, dep, Number(payDate.slice(0, 4))) : null;
      if (ct !== null) tax = ct;
      else {
        if (useComputer) warn('tax_computer_unavailable', '支給日の年の電算機特例の式がありません（税額表で数えました）');
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
        line('att', k[0], k[1], k[0] === 'absentDays' || k[0] === 'paidDays' ? halfNum(k[0]) : m(k[0]), null, 0, '');   /* 欠勤日数は半日きざみ（整数の日は今までと同じ） */
      });
      /* 勤怠 v5 段4: 休暇の種類（ある時だけ出す＝使わない月の行は今のまま・文は仮置き） */
      [['absentPartMin', '欠勤（分・休暇で埋まらない残り）'], ['hourlyPaidMin', '時間単位の有休（分）'], ['specialPaidDays', '特別休暇（有給）日数'], ['specialUnpaidDays', '特別休暇（無給）日数'], ['compDays', '代休日数']].forEach(function (k) {
        var v = /Days$/.test(k[0]) ? halfNum(k[0]) : m(k[0]);
        if (v > 0) line('att', k[0], k[1], v, null, 0, '');
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

  /* ── 6. 賞与（2026-11-23 足した・賞与の計算 v1 §2・CALC_VER とは別の版 BONUS_VER） ──
     computeBonus(input) が1人・1回分の賞与（社保・雇保・源泉）を返す。computeItem（月の給与）とは別の道で、月の給与の数え方は変えない。
     入力（形は報告と試験 check/unit/payroll_bonus_test.js に合わせる）:
       bonus: { pay_date:'YYYY-MM-DD', lines:[{code, amount}] }  code 'bonus' は定義が無くても「賞与」（課税・社保・労保の対象）。ほかは allowanceDefs の定義に従う
       settings（月の給与と同じ給与の設定・prefecture・emp_ins_kind・bonus_period_months（算定期間の月数・既定6・仮置き））
       profile（支給日に有効な給与の設定・月の給与と同じ形）
       allowanceDefs（手当・控除の定義・月の給与と同じ形）
       prev: { kind:'db'|'ytd'|'manual'|'none'|'unconfirmed'|'missing', P（前月の社会保険料等控除後の給与・円）, manualP（任意・手入力の P・食い違いの知らせに使う）, period_months（任意） }
       fyStdSum（同じ年度のほかの回の健保の標準賞与額の和）・fyPriorStd（この年度に他（freee など）で払った健保の標準賞与額・手入力。null は 0 として知らせる）
       monthStdSum（同じ月のほかの回の厚年の標準賞与額の和）・count12（過去12か月のほかの回の数）・count12Other（過去12か月の他での回の数・手入力）
       rates（率表・試験で差し替える時だけ）
     ・保険料の率は支給日の月の率（月の給与の「徴収の月」のずらしを通さない）。雇用保険は支給日の率
     ・源泉は算出率の表（前月の給与 P で率を引く）。前月が無い・P≦0・T が P の10倍を超える時は月額表の方法（国税庁 No.2523）。
       月額表の方法は月額表（taxTable）だけで数え、電算機特例（taxComputer）は使わない */
  var BONUS_VER = 'payroll-bonus-1';
  /* 止めの警告（確定できない）。画面と DB はこの code で見分ける */
  var BONUS_BLOCK = { badinput: 1, calc_error: 1, prev_unconfirmed: 1, prev_missing: 1, rate_missing: 1, tax_table_missing: 1, emp_rate_missing: 1, std_missing: 1 };
  var BONUS_HEALTH_FY_CAP = 5730000, BONUS_PENSION_MONTH_CAP = 1500000;
  function computeBonus(input) {
    badNum = 0;
    try { return computeBonus_(input); }
    catch (e) {
      return { ver: BONUS_VER, gross: 0, taxable: 0, social: 0, deduct: 0, net: 0, T: 0, tax: 0, taxMethod: null, rate: null, P: null,
        std: { raw: 0, health: 0, pension: 0 }, ins: { health: 0, care: 0, support: 0, pension: 0, emp: 0 },
        employer: { health: 0, care: 0, support: 0, pension: 0, childcare: 0, emp: 0 }, lines: [],
        warns: [{ code: 'calc_error', msg: '計算できませんでした（入力の形を確かめてください）', stop: true }] };
    }
  }
  /* 賞与の資格: 取得は月で見る（取得月より前の月は対象外）。喪失月に払った分は 0（喪失日の前日までに払った分は lost の印）。
     取得と喪失が同じ月なら、取得日〜喪失日の前日に払った分は対象 */
  function bonusCovered(ins, profile, payDate) {
    var from = ins && isDate(ins.from) ? ins.from : (isDate(profile.entry_date) ? profile.entry_date : null);
    var loss = ins && isDate(ins.to) ? ins.to : (isDate(profile.retire_date) ? addDays(profile.retire_date, 1) : null);
    var ym = ymOf(payDate), acq = from ? ymOf(from) : null, lossYm = loss ? ymOf(loss) : null;
    if (acq && ym < acq) return { on: false, lost: false };
    if (lossYm) {
      if (acq && acq === lossYm) return { on: ym === acq && from <= payDate && payDate < loss, lost: false };
      if (ym > lossYm) return { on: false, lost: false };
      if (ym === lossYm) return { on: false, lost: payDate < loss };
    }
    return { on: true, lost: false };
  }
  function computeBonus_(input) {
    input = input || {};
    var R = input.rates || Rates;
    var TT = R && typeof R.bonusRate === 'function' ? R : (isNode ? require('./payroll-tax-table.js') : root.PayrollTaxTable);
    var setIn = input.settings && typeof input.settings === 'object' ? input.settings : {};
    var S = fillSettings(setIn);
    var P = input.profile && typeof input.profile === 'object' ? input.profile : null;
    var bonus = input.bonus && typeof input.bonus === 'object' ? input.bonus : {};
    var payDate = bonus.pay_date, warns = [], lines = [];
    function warn(code, msg) { for (var i = 0; i < warns.length; i++) if (warns[i].code === code) return; warns.push({ code: code, msg: msg, stop: !!BONUS_BLOCK[code] }); }
    function line(sec, code, name, amount, basis) { lines.push({ sec: sec, code: code, name: name, amount: amount, basis: basis || '' }); }
    var out = { ver: BONUS_VER, gross: 0, taxable: 0, social: 0, deduct: 0, net: 0, T: 0, tax: 0, taxMethod: null, rate: null, P: null,
      std: { raw: 0, health: 0, pension: 0 }, ins: { health: 0, care: 0, support: 0, pension: 0, emp: 0 },
      employer: { health: 0, care: 0, support: 0, pension: 0, childcare: 0, emp: 0 }, lines: lines, warns: warns };
    if (!isDate(payDate)) { warn('badinput', '支給日の形が違います'); return out; }
    /* 給与の設定が無い人は標準賞与額の対象も税の欄も決められない（止め・仮置き） */
    if (!P || !Object.keys(P).length) { warn('std_missing', '給与の設定がありません'); return out; }
    var ym = ymOf(payDate), board = P.pay_type === 'board';
    var defs = {};
    (Array.isArray(input.allowanceDefs) ? input.allowanceDefs : []).forEach(function (d) { if (d && d.code) defs[d.code] = d; });

    /* 1. 支給と控除の行 */
    var gross = 0, taxable = 0, siBase = 0, laborBase = 0, dedLines = [], dedSi = 0;
    (Array.isArray(bonus.lines) ? bonus.lines : []).forEach(function (x) {
      if (!x || !x.code) return;
      var def = defs[x.code], amt = int(x.amount);
      if (!def && x.code !== 'bonus') { warn('def_missing', '手当・控除の定義が無い項目があります（' + x.code + '）・計算に入れていません'); return; }
      if (def && def.sec === 'deduct') {
        var asSi = !!(def.attrs && def.attrs.social_ins === true);
        if (asSi) dedSi += amt;
        dedLines.push({ code: 'd:' + def.code, name: def.name || def.code, amount: amt, basis: asSi ? '定額（社会保険料として扱う）' : '定額' });
        return;
      }
      var at = attrsOf(def || null), name = def ? (def.name || def.code) : '賞与';
      if (x.code === 'commute' || (def && /通勤/.test(String(def.name || '')))) warn('commute_in_bonus', '賞与に通勤手当があります（月の給与で払うものか確かめてください）');
      gross += amt;
      if (at.income_tax) taxable += amt;
      if (at.social_ins) siBase += amt;
      if (at.labor_ins) laborBase += amt;
      line('pay', def ? 'f' + def.code : 'bonus', name, amt, '');
    });

    /* 2. 標準賞与額（千円未満切捨て）と上限 */
    var raw = Math.max(0, Math.floor(siBase / 1000) * 1000);
    var fyPrior = input.fyPriorStd;
    if (fyPrior === undefined || fyPrior === null || fyPrior === '') { fyPrior = 0; warn('fy_prior_manual', 'この年度に他（freee など）で払った賞与の標準賞与額が入っていません（0として数えました）'); }
    var fySum = Math.max(0, int(input.fyStdSum)) + Math.max(0, int(fyPrior));
    var stdH = Math.min(raw, Math.max(0, BONUS_HEALTH_FY_CAP - fySum));
    var stdP = Math.min(raw, Math.max(0, BONUS_PENSION_MONTH_CAP - Math.max(0, int(input.monthStdSum))));
    out.std.raw = raw;

    /* 3〜5. 社保（支給日の月の率） */
    var ins = P.ins && typeof P.ins === 'object' ? P.ins : {};
    var birth = isDate(P.birth_date) ? P.birth_date : null;
    var hOn = !!(ins.health && ins.health.on), pOn = !!(ins.pension && ins.pension.on);
    var unset = ['health', 'pension'].concat(board ? [] : ['emp']).filter(function (k) { return !(ins[k] && typeof ins[k] === 'object' && typeof ins[k].on === 'boolean'); });
    if (unset.length) warn('ins_unset', '加入が決まっていない保険があります（' + unset.map(function (k) { return { health: '健康保険', pension: '厚生年金', emp: '雇用保険' }[k]; }).join('・') + '・加入していないとして数えました）');
    if ((hOn || pOn) && !birth) warn('birth_missing', '生年月日が空です（介護・年齢の判定ができません）');
    /* 年度の途中で資格を取った人は、前の会社で受けた賞与を年度の累計に数えられない（知らせだけ・仮置き） */
    var fyStart = (+ym.slice(5, 7) >= 4 ? ym.slice(0, 4) : String(+ym.slice(0, 4) - 1)) + '-04-01';
    var acqH = ins.health && isDate(ins.health.from) ? ins.health.from : (isDate(P.entry_date) ? P.entry_date : null);
    if (hOn && acqH && acqH > fyStart && acqH <= payDate) warn('fy_prior_unknown', '年度の途中で資格を取った方です（前の勤め先の賞与は年度の累計に入っていません）');
    /* 産休・育休の免除の記録（月の範囲）が支給月に掛かる時は、自動で免除せず知らせる（仮置き） */
    var leave = (Array.isArray(ins.exempt) ? ins.exempt : []).some(function (x) { return x && isYm(x.from_ym) && x.from_ym <= ym && (!isYm(x.to_ym) || ym <= x.to_ym); });
    if (leave) warn('leave_check', '産休・育休の免除の期間に払う賞与です（保険料を引いて数えました・免除になるか確かめてください）');
    var covH = bonusCovered(ins.health, P, payDate), covP = bonusCovered(ins.pension, P, payDate);
    var hAge = !(birth && ym >= ymOf(birthdayAt(birth, 75))), pAge = !(birth && ym >= reachYm(birth, 70));
    var hTarget = hOn && hAge && (covH.on || covH.lost), pTarget = pOn && pAge && (covP.on || covP.lost);
    out.std.health = hTarget ? stdH : 0;
    out.std.pension = pTarget ? stdP : 0;
    if ((hTarget && covH.lost) || (pTarget && covP.lost)) warn('lost_month', '資格を失う月に払う賞与です（保険料は0・賞与支払届は出します）');
    var rt = (hOn || pOn) ? R.health(S.prefecture, ym) : null;
    if ((hOn || pOn) && !rt) warn('rate_missing', ym + ' の社会保険料率が率表にありません');
    var si = out.ins, er = out.employer;
    if (rt && hTarget && covH.on && stdH > 0) {
      var careOn = birth && !ins.care_exempt && ym >= reachYm(birth, 40) && ym < reachYm(birth, 65);
      [['health', rt.health], ['care', careOn ? rt.care : 0], ['support', rt.support]].forEach(function (k) {
        if (!k[1]) return;
        var full = qMul(intQ(stdH), rateQ(k[1])), mine = round50(qDiv(full, Q(2)));
        si[k[0]] = mine; er[k[0]] = qNum(qSub(full, intQ(mine)));
      });
    }
    if (rt && pTarget && covP.on && stdP > 0) {
      var pfull = qMul(intQ(stdP), rateQ(rt.pension)), pm = round50(qDiv(pfull, Q(2)));
      si.pension = pm; er.pension = qNum(qSub(pfull, intQ(pm)));
      er.childcare = qNum(qMul(intQ(stdP), rateQ(rt.childcare_contrib)));
    }

    /* 7. 雇用保険（支給日の率） */
    var empOn = !!(!board && ins.emp && ins.emp.on && empCovered(ins.emp, P, { from: payDate, to: payDate }));
    if (empOn) {
      var re = R.employment(payDate, S.emp_ins_kind);
      if (!re) warn('emp_rate_missing', '支給日 ' + payDate + ' の雇用保険料率が率表にありません');
      else {
        var eb = Math.max(0, laborBase);
        si.emp = round50(qMul(intQ(eb), rateQ(re.worker)));
        er.emp = qNum(qMul(intQ(eb), rateQ(re.employer)));
      }
    }
    var social = si.health + si.care + si.support + si.pension + si.emp;

    /* 8. 源泉 */
    var T = Math.max(0, taxable - social - dedSi), tax = 0;
    var col = P.tax && P.tax.col, dep = P.tax ? Math.max(0, Math.floor(Number(P.tax.dependents) || 0)) : 0;
    if ((col === 'kou' || col === 'otsu') && !(P.tax && P.tax.dependents_checked === true)) warn('dependents_unchecked', '扶養の数が未確認です');
    if (col === 'otsu') dep = 0;
    var prev = input.prev && typeof input.prev === 'object' ? input.prev : {};
    /* 前月の給与の確かめは源泉の対象（甲・乙）の人だけ（区分 none の人を前月の給与で止めない・仮置き） */
    var taxed = col === 'kou' || col === 'otsu';
    var kind = prev.kind, pv = null;
    if (kind === 'none') pv = 0;
    else if (kind === 'db' || kind === 'ytd' || kind === 'manual') {
      /* P を 0 に丸めない（欠けた P で黙って「前月なし」に落とさない） */
      var pn = typeof prev.P === 'number' ? prev.P : (typeof prev.P === 'string' && prev.P !== '' ? Number(prev.P) : NaN);
      if (isFinite(pn)) pv = Math.floor(pn);
      else if (taxed) warn('prev_missing', '前月の給与（社会保険料等を引いた後）が入っていません');
    } else if (kind === 'unconfirmed') { if (taxed) warn('prev_unconfirmed', '前月の給与がまだ確定していません'); }
    else if (taxed) warn('prev_missing', '前月の給与（社会保険料等を引いた後）が入っていません');
    if ((kind === 'db' || kind === 'ytd') && pv !== null && prev.manualP != null && prev.manualP !== '' && isFinite(Number(prev.manualP)) && Math.floor(Number(prev.manualP)) !== pv) {
      warn('prev_mismatch', '前月の給与が手入力の値と違います（記録の値で数えました）');
    }
    if (Number(prev.period_months) > 1) warn('prev_period', '前月の給与の支給期が1か月ではありません（この計算の対象外です・代表者へ）');
    out.P = pv;
    if (col === 'kou' || col === 'otsu') {
      var year = Number(payDate.slice(0, 4));
      var hasRate = TT && TT.bonusRate(year, col, dep, 0) !== null;
      if (!hasRate) warn('tax_table_missing', '支給日の年の賞与の算出率の表がありません（所得税を0円にしています）');
      else if (pv !== null && T > 0) {
        var monthly = pv <= 0 || T > pv * 10;
        if (!monthly) {
          var rate = TT.bonusRate(year, col, dep, pv);
          out.rate = rate; out.taxMethod = 'rate';
          tax = yen(qMul(intQ(T), rateQ(rate / 100)), 'floor');
        } else {
          var MT = R.taxTable(payDate);
          var div = Number(setIn.bonus_period_months) > 6 ? 12 : 6;
          if (!MT) warn('tax_table_missing', '支給日の年の月額表がありません（所得税を0円にしています）');
          else {
            if (col === 'otsu') warn('otsu_monthly', '乙欄の方を月額表の方法で数えました（確かめてください）');
            var a = Math.floor(T / div);
            if (pv <= 0) { out.taxMethod = 'monthly_none'; tax = taxTable(MT, a, dep, col) * div; }
            else { out.taxMethod = 'monthly_10x'; tax = (taxTable(MT, a + pv, dep, col) - taxTable(MT, pv, dep, col)) * div; }
          }
        }
      }
    } else if (col !== 'none') warn('tax_col', '源泉の区分（甲・乙）が決まっていません');
    tax = Math.max(0, tax);

    /* 9. 控除の行 */
    var dsum = 0;
    function ded(code, name, amount, basis) { line('deduct', code, name, amount, basis); dsum += amount; }
    if (si.health) ded('health', '健康保険料', si.health, '標準賞与額 ' + stdH);
    if (si.care) ded('care', '介護保険料', si.care, '標準賞与額 ' + stdH);
    if (si.support) ded('support', '子ども・子育て支援金', si.support, '標準賞与額 ' + stdH);
    if (si.pension) ded('pension', '厚生年金保険料', si.pension, '標準賞与額 ' + stdP);
    if (empOn) ded('emp', '雇用保険料', si.emp, '賃金 ' + Math.max(0, laborBase));
    if (col === 'kou' || col === 'otsu') ded('income_tax', '所得税', tax, (col === 'otsu' ? '乙欄' : '甲欄') + ' 課税対象 ' + T + (out.rate !== null ? ' × ' + out.rate + '%' : ''));
    dedLines.forEach(function (x) { ded(x.code, x.name, x.amount, x.basis); });

    /* 10. 回数（過去12か月に4回以上は報酬の扱いの恐れ） */
    if (Math.max(0, int(input.count12)) + Math.max(0, int(input.count12Other)) + 1 >= 4) warn('four_times', '過去12か月に4回以上の賞与です（賞与ではなく報酬として扱う恐れがあります）');

    out.gross = gross; out.taxable = taxable; out.social = social; out.T = T; out.tax = tax;
    out.deduct = dsum; out.net = gross - dsum;
    if (out.net < 0) warn('net_negative', '差引支給額がマイナスです');
    if (badNum) warn('bad_number', '数でない値がありました（0として数えました）');
    return out;
  }

  var api = {
    VERSION: CALC_VER, payDate: payDate,
    CALC_VER: CALC_VER, DEFAULTS: DEFAULTS, computeItem: computeItem, fillSettings: fillSettings, attrsOf: attrsOf,
    reachDate: reachDate, reachYm: reachYm, birthdayAt: birthdayAt, insCovered: insCovered, ymAdd: ymAdd, addDays: addDays,
    empCovered: empCovered, otBaseAdd: otBaseAdd, taxTable: taxTable, taxComputer: taxComputer, taxComputerR8: taxComputerR8, COMPUTER_YEARS: Object.keys(COMPUTER).map(Number), round50: round50, weekdaysBetween: weekdaysBetween,
    _q: { Q: Q, rateQ: rateQ, roundQ: roundQ, yen: yen }
  };
  /* 賞与（2026-11-23 足した） */
  api.computeBonus = computeBonus; api.BONUS_VER = BONUS_VER; api.BONUS_BLOCK = BONUS_BLOCK;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollCalc = api;
})(typeof window !== 'undefined' ? window : this);
