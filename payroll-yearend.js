/* payroll-yearend.js — 年末調整の計算の純関数（2026-11-23 新設・凍結仕様 ROOT-yearend.md の B2）
 * ════════════════════════════════════════════════════════════════
 * ・PayrollYearEnd.computeYearEnd(input) が1人・1年分の年税額と過不足、源泉徴収票の欄の値（lines）を返す
 * ・画面とは通信も DOM も持たない。試験は check/unit/payroll_yearend_test.js
 * ・定数は payroll-yearend-rates.js（令和8年分・頁つき）。定数の無い年・null の値があれば計算しない（eligible=false）
 * ・金額は円の整数だけで数える（率は分子/分母の整数で掛け、割り算は整数の切り捨て・切り上げ）
 * ・端数（冊子 p.36〜39・p.24・p.26）:
 *     給与所得控除後の金額: 660万円以上は1円未満切り捨て／所得金額調整控除: 1円未満切り上げ
 *     生命保険料・地震保険料の控除額: 1円未満切り上げ
 *     課税給与所得金額: 1,000円未満切り捨て／年調年税額: 100円未満切り捨て
 * ・年齢は12月31日（asOf）現在・誕生日の前日に到達（年齢計算ニ関スル法律）
 * ・仮置き（決まりは確かめたが、申告の形だけでは決めきれない所。安全側＝控除しない／警告）:
 *     同居老親等は relation が直系尊属の言葉（父・母・祖父・祖母・義父・義母など）の時だけ。違えば老人扶養（同居老親等以外）＋警告
 *     非居住者で30歳以上70歳未満の扶養親族は、留学（student）・障害者（disability が none 以外）・38万円以上の送金（remit38）の
 *       どれかの時だけ控除対象（手引 p.9 欄22 の区分 02・03・04）。どれでもなければ控除しない＋警告
 *     under23_others（配偶者などの扶養に入れている23歳未満の親族）は扶養控除をせず、所得金額調整控除と生命保険料の特例の判定にだけ使う（冊子 p.20・p.22: 夫婦の両方が受けられる）
 *     住宅借入金等特別控除の所得要件は decl.housing_loan.income_limit（1,000万／2,000万／3,000万）。無い時は 2,000万で警告
 *     前職は input.prevJobs が配列ならそれを使い、無ければ decl.prev_jobs を使う（二重に足さない）
 *     decl.kou が無い時は甲欄として計算し警告を出す
 * ・氏名などの個人情報をこのファイルに書かない（試験も架空の人だけ）
 */
(function (root) {
  'use strict';
  var isNode = typeof require !== 'undefined' && typeof window === 'undefined';
  var Rates = isNode ? require('./payroll-yearend-rates.js') : root.PayrollYearEndRates;
  var CALC_VER = 'payroll-yearend-1';

  var DATA_KEYS = ['gross', 'taxable', 'nontax', 'si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'si_other', 'income_tax'];
  var SI_KEYS = ['si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'si_other'];
  var INS_KEYS = ['life_new_general', 'life_old_general', 'life_new_care', 'life_new_pension', 'life_old_pension', 'quake', 'old_long_fire', 'small_biz', 'social_extra', 'national_pension'];
  var DISABILITY = { none: 1, general: 1, special: 1, special_cohabit: 1 };
  /* 直系尊属（本人か配偶者の）とみなす続柄の言葉（仮置き） */
  var ASCENDANT_RE = /^(父|母|祖父|祖母|曾祖父|曾祖母|曽祖父|曽祖母|養父|養母|実父|実母|義父|義母|義祖父|義祖母|配偶者の(父|母|祖父|祖母|曾祖父|曾祖母|曽祖父|曽祖母|養父|養母))$/;

  /* ── 1. 整数の割り算（非負） ── */
  function isInt(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e12; }
  function floorDiv(a, b) { return (a - (a % b)) / b; }
  function ceilDiv(a, b) { var q = floorDiv(a, b); return (a % b) ? q + 1 : q; }
  function mulFloor(x, num, den) { return floorDiv(x * num, den); }
  function mulCeil(x, num, den) { return ceilDiv(x * num, den); }

  /* ── 2. 日付と年齢 ── */
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function addDay(s) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  /* asOf の日の年齢（誕生日の前日に1つ増える＝翌日の満年齢） */
  function ageAt(birth, asOf) {
    if (!isDate(birth) || !isDate(asOf)) return null;
    var d = addDay(asOf);
    var a = Number(d.slice(0, 4)) - Number(birth.slice(0, 4));
    if (d.slice(5) < birth.slice(5)) a--;
    return a;
  }

  /* ── 3. 決まりの表を引く関数（試験からも呼ぶ） ── */
  /* 給与所得控除後の給与等の金額（冊子 p.47〜54・p.3・p.36） */
  function kyuyoAfter(pay, r) {
    var k = r.kyuyo;
    if (pay < k.zero_below) return 0;
    if (pay >= k.flat.from && pay < k.flat.to) return pay - k.flat.sub;
    var i, s;
    for (i = 0; i < k.fixed.length; i++) { s = k.fixed[i]; if (pay >= s.from && pay < s.to) return s.value; }
    for (i = 0; i < k.table.length; i++) {
      s = k.table[i];
      if (pay >= s.from && pay < s.to) { var low = pay - (pay % s.unit); return mulFloor(low, s.num, s.den) - s.sub; }
    }
    for (i = 0; i < k.formula.length; i++) {
      s = k.formula[i];
      if (pay >= s.from && (s.to === null || pay < s.to)) return Math.max(0, mulFloor(pay, s.num, s.den) - s.sub);
    }
    return null;
  }
  function basicDeduction(income, r) {
    for (var i = 0; i < r.basic.length; i++) if (income <= r.basic[i].max) return r.basic[i].amount;
    return 0;
  }
  /* 本人の合計所得の列（0〜2）。1,000万円超は -1 */
  function selfCol(income, r) {
    var c = r.spouse.self_cols;
    for (var i = 0; i < c.length; i++) if (income <= c[i]) return i;
    return -1;
  }
  /* 配偶者控除と配偶者特別控除 → {kind:'spouse'|'special'|null, amount} */
  function spouseDeduction(selfIncome, spouseIncome, elderly, r) {
    var col = selfCol(selfIncome, r);
    if (col < 0) return { kind: null, amount: 0 };
    if (spouseIncome <= r.dependent_income_max) return { kind: 'spouse', amount: (elderly ? r.spouse.elderly : r.spouse.ordinary)[col] };
    var t = r.spouse.special;
    for (var i = 0; i < t.length; i++) if (spouseIncome > t[i].min && spouseIncome <= t[i].max) return { kind: 'special', amount: t[i].amounts[col] };
    return { kind: null, amount: 0 };
  }
  function tokuteiDeduction(income, r) {
    for (var i = 0; i < r.tokutei.length; i++) if (income > r.tokutei[i].min && income <= r.tokutei[i].max) return r.tokutei[i].amount;
    return 0;
  }
  function incomeAdjust(pay, r) {
    var a = r.income_adjust;
    if (pay <= a.threshold) return 0;
    return Math.min(a.max, mulCeil(Math.min(pay, a.cap) - a.threshold, a.num, a.den));
  }
  /* 段の式（生命保険料・旧長期損害保険料）。1円未満切り上げ */
  function stepFormula(x, f) {
    if (!x) return 0;
    for (var i = 0; i < f.steps.length; i++) { var s = f.steps[i]; if (x <= s.upto) return mulCeil(x, s.num, s.den) + s.add; }
    return f.flat;
  }
  /* 生命保険料の控除額（冊子 p.24）→ {general, care, pension, total, u23_applied} */
  function lifeDeduction(ins, under23, r) {
    var L = r.life;
    var ng = ins.life_new_general || 0, og = ins.life_old_general || 0;
    var a = ng ? stepFormula(ng, under23 ? L.new_u23 : L.new) : 0;
    var b = og ? stepFormula(og, L.old) : 0;
    var c = (ng && og) ? Math.min(a + b, under23 ? L.both_max_u23 : L.both_max) : 0;
    var general = Math.max(a, b, c);
    var care = stepFormula(ins.life_new_care || 0, L.new);
    var np = ins.life_new_pension || 0, op = ins.life_old_pension || 0;
    var pa = np ? stepFormula(np, L.new) : 0, pb = op ? stepFormula(op, L.old) : 0;
    var pc = (np && op) ? Math.min(pa + pb, L.both_max) : 0;
    var pension = Math.max(pa, pb, pc);
    return { general: general, care: care, pension: pension, total: Math.min(L.total_max, general + care + pension), u23_applied: !!(under23 && ng > 0) };
  }
  /* 地震保険料の控除額（冊子 p.26） */
  function quakeDeduction(quake, oldLong, r) {
    var Q = r.quake;
    var q = Math.min(quake || 0, Q.quake_max);
    var l = stepFormula(oldLong || 0, Q.old_long);
    return Math.min(Q.total_max, q + l);
  }
  /* 算出所得税額（冊子 p.55）。課税給与所得は 1,000円未満を切り捨て済みの額。速算表の外は null */
  function taxCalc(taxable, r) {
    for (var i = 0; i < r.tax.length; i++) { var t = r.tax[i]; if (taxable <= t.max) return Math.max(0, mulFloor(taxable, t.rate, 100) - t.sub); }
    return null;
  }

  /* ── 4. 定数の null を探す ── */
  function nullPaths(o, p, out) {
    if (o === null || o === undefined) { out.push(p || '(全体)'); return out; }
    if (typeof o === 'number' && !isFinite(o)) { out.push(p); return out; }
    if (typeof o === 'object') for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) {
      /* formula の最後の to:null は「上限なし」の意味なので除く */
      if (k === 'to' && /formula\.\d+$/.test(p) && o[k] === null) continue;
      nullPaths(o[k], p ? p + '.' + k : k, out);
    }
    return out;
  }

  function W(list, code, msg, extra) { var w = { code: code, msg: msg }; if (extra) for (var k in extra) w[k] = extra[k]; list.push(w); }

  /* ── 5. 本体 ── */
  function computeYearEnd(input) {
    input = input || {};
    var warnings = [], reasons = [];
    var year = Number(input.year);
    var decl = (input.decl && typeof input.decl === 'object') ? input.decl : {};
    var r = input.rates !== undefined ? input.rates : (Rates ? Rates.forYear(year) : null);
    if (r && typeof r.forYear === 'function') r = r.forYear(year);   /* 定数の部品そのもの（PayrollYearEndRates）を渡された時は年で引く */
    var asOf = isDate(input.asOf) ? input.asOf : (Number.isInteger(year) ? year + '-12-31' : null);
    if (input.asOf !== undefined && input.asOf !== null && !isDate(input.asOf)) W(warnings, 'bad_asof', '基準日の形が違うので12月31日で数えます');

    /* 5-1. 支払った給与・賞与の合計（自社分） */
    var own = { pay: 0, gross: 0, nontax: 0, si: 0, tax: 0, months: 0 }, bad = false;
    var rows = Array.isArray(input.rows) ? input.rows : [];
    rows.forEach(function (row, i) {
      if (!row || typeof row !== 'object' || !isDate(row.pay_date) || (row.kind !== 'salary' && row.kind !== 'bonus')) { bad = true; W(warnings, 'bad_row', (i + 1) + '行目の形が違います', { row: i }); return; }
      if (Number(row.pay_date.slice(0, 4)) !== year) { W(warnings, 'row_other_year', (i + 1) + '行目は支給日の年が違うので数えません', { row: i }); return; }
      var d = row.data || {};
      for (var j = 0; j < DATA_KEYS.length; j++) {
        var v = d[DATA_KEYS[j]];
        if (v !== undefined && v !== null && !isInt(v)) { bad = true; W(warnings, 'bad_amount', (i + 1) + '行目の ' + DATA_KEYS[j] + ' が0以上の円の整数ではありません', { row: i }); return; }
      }
      var g = d.gross || 0, nt = d.nontax || 0;
      var tx = (d.taxable !== undefined && d.taxable !== null) ? d.taxable : Math.max(0, g - nt);
      own.pay += tx; own.gross += g; own.nontax += nt; own.tax += d.income_tax || 0;
      SI_KEYS.forEach(function (k) { own.si += d[k] || 0; });
      if (row.kind === 'salary') own.months++;
    });

    /* 5-2. 前職 */
    var prevList = Array.isArray(input.prevJobs) ? input.prevJobs : (Array.isArray(decl.prev_jobs) ? decl.prev_jobs : []);
    if (Array.isArray(input.prevJobs) && input.prevJobs.length && Array.isArray(decl.prev_jobs) && decl.prev_jobs.length) W(warnings, 'prev_jobs_from_input', '前職は渡された prevJobs を使い、申告の prev_jobs は足していません');
    var prev = { pay: 0, si: 0, tax: 0, list: [] };
    prevList.forEach(function (p, i) {
      p = p || {};
      if (!isInt(p.pay || 0) || !isInt(p.si || 0) || !isInt(p.tax || 0)) { bad = true; W(warnings, 'bad_prev', '前職の' + (i + 1) + '件目の金額が0以上の円の整数ではありません'); return; }
      prev.pay += p.pay || 0; prev.si += p.si || 0; prev.tax += p.tax || 0;
      prev.list.push({ payer: typeof p.payer === 'string' ? p.payer.slice(0, 200) : '', address: typeof p.address === 'string' ? p.address.slice(0, 200) : '', left_on: isDate(p.left_on) ? p.left_on : '', pay: p.pay || 0, si: p.si || 0, tax: p.tax || 0 });
    });

    var payTotal = own.pay + prev.pay, withheld = own.tax + prev.tax, siPay = own.si + prev.si;

    /* 5-3. 申告の金額の形 */
    var ins = (decl.insurance && typeof decl.insurance === 'object') ? decl.insurance : {};
    INS_KEYS.forEach(function (k) { if (ins[k] !== undefined && ins[k] !== null && !isInt(ins[k])) { bad = true; W(warnings, 'bad_decl', '保険料の ' + k + ' が0以上の円の整数ではありません'); } });
    var hl = (decl.housing_loan && typeof decl.housing_loan === 'object') ? decl.housing_loan : {};
    if (hl.amount !== undefined && hl.amount !== null && !isInt(hl.amount)) { bad = true; W(warnings, 'bad_decl', '住宅借入金等特別控除の額が0以上の円の整数ではありません'); }
    if (hl.income_limit !== undefined && hl.income_limit !== null && [10000000, 20000000, 30000000].indexOf(hl.income_limit) < 0) { bad = true; W(warnings, 'bad_decl', '住宅借入金等特別控除の所得要件は 10000000・20000000・30000000 のどれかです'); }
    var otherIncome = 0;
    if (decl.other_income !== undefined && decl.other_income !== null) { if (isInt(decl.other_income)) otherIncome = decl.other_income; else { bad = true; W(warnings, 'bad_decl', '給与以外の所得の見込みが0以上の円の整数ではありません'); } }

    /* 5-4. 対象か */
    if (!r) { reasons.push('rates_missing'); W(warnings, 'rates_missing', (Number.isInteger(year) ? year : '?') + '年分の年末調整の定数がありません（計算しません）'); }
    else {
      var nulls = nullPaths(r, '', []);
      if (nulls.length) { reasons.push('rates_missing'); W(warnings, 'rates_missing', '年末調整の定数に確かめていない値があります（計算しません）', { paths: nulls }); }
    }
    if (decl.kou === false) reasons.push('not_kou');
    else if (decl.kou !== true) W(warnings, 'kou_unset', '甲欄かどうかの申告が無いので甲欄として計算しました');
    if (r && isInt(r.eligible_pay_max) && payTotal > r.eligible_pay_max) reasons.push('over_20m');
    if (bad) reasons.push('bad_input');

    var base = {
      version: CALC_VER, year: year, asOf: asOf,
      eligible: false, reasons: reasons,
      pay_total: payTotal, pay_own: own.pay, pay_prev: prev.pay,
      withheld_total: withheld, withheld_own: own.tax, withheld_prev: prev.tax,
      si_total: null, si_pay: siPay, months: own.months,
      kyuyo_shotoku: null, income_adjust: null, kyuyo_after_adjust: null, total_income: null,
      deductions: null, deductions_total: null, taxable: null, tax_calc: null,
      housing_applied: null, housing_possible: null, nenzei_before_fukko: null, nenzei: null,
      balance: null, balance_settle: 0, warnings: warnings, lines: null
    };
    /* 5-5. 親族の区分（年末調整は mode='ye'。年末調整をしない人の源泉徴収票は mode='gensen'＝源泉控除対象親族の区分・手引 p.12 の用語(5)） */
    function family(mode) {
      var A = r.age;
      var f = {
        cnt: { specific: 0, elderly: 0, elderly_cohabit: 0, other: 0, under16: 0, tokutei: 0, dis_special: 0, dis_special_cohabit: 0, dis_other: 0, nonresident: 0 },
        depAmount: 0, disAmount: 0, tokuteiAmount: 0, hasUnder23: false, anySpecialDisDep: false,
        names: { dependents: [], under16: [], tokutei: [], adjust: [] }
      };
      var cnt = f.cnt;
      f.disAdd = function (kind, who) {
        if (!kind || kind === 'none') return;
        if (!DISABILITY[kind]) { W(warnings, 'bad_disability', who + 'の障害者の区分が分かりません（控除しません）'); return; }
        f.disAmount += r.disability[kind];
        if (kind === 'special') cnt.dis_special++;
        else if (kind === 'special_cohabit') { cnt.dis_special++; cnt.dis_special_cohabit++; }
        else cnt.dis_other++;
      };
      var deps = Array.isArray(decl.dependents) ? decl.dependents : [];
      deps.forEach(function (dp, i) {
        dp = dp || {};
        var who = '扶養の' + (i + 1) + '人目';
        var inc = dp.income;
        if (inc === undefined || inc === null) { inc = 0; W(warnings, 'dep_income_missing', who + 'の所得の見込みが無いので0円として数えました'); }
        else if (!isInt(inc)) { W(warnings, 'dep_income_bad', who + 'の所得の見込みの形が違います（控除しません）'); return; }
        var age = ageAt(dp.birth, asOf);
        if (age === null) { W(warnings, 'dep_birth_missing', who + 'の生年月日が無いか形が違います（控除しません）'); return; }
        var nm = { name: dp.name || '', kana: dp.kana || '', nonresident: !!dp.nonresident };
        if (inc <= r.dependent_income_max) {
          /* 扶養親族 */
          if (age < A.under23) { f.hasUnder23 = true; f.names.adjust.push(nm); }
          if (dp.disability === 'special' || dp.disability === 'special_cohabit') f.anySpecialDisDep = true;
          f.disAdd(dp.disability, who);
          if (age < A.dependent_min) { cnt.under16++; if (dp.nonresident) cnt.nonresident++; f.names.under16.push(nm); return; }
          if (dp.nonresident) {
            if (age >= A.nonres_min && age < A.nonres_max) {
              /* 手引 p.9 欄22 の区分: 02 留学・03 障害者・04 38万円以上の送金 */
              var code = dp.student ? '02' : (dp.disability && dp.disability !== 'none' && DISABILITY[dp.disability]) ? '03' : dp.remit38 ? '04' : null;
              if (!code) {
                W(warnings, 'nonresident_30_69', who + 'は非居住者で30歳以上70歳未満で、留学・障害者・38万円以上の送金のどれにも当たらないため扶養控除をしていません');
                return;
              }
              nm.nonres_code = code;
            } else nm.nonres_code = '01';
            cnt.nonresident++;
          }
          if (age >= A.specific_min && age < A.specific_max) { cnt.specific++; f.depAmount += r.dependent.specific; nm.kind = 'specific'; }
          else if (age >= A.elderly_min) {
            if (dp.live_together && ASCENDANT_RE.test(String(dp.relation || ''))) { cnt.elderly++; cnt.elderly_cohabit++; f.depAmount += r.dependent.elderly_cohabit; nm.kind = 'elderly_cohabit'; }
            else {
              if (dp.live_together) W(warnings, 'cohabit_relation_check', who + 'は同居の老人ですが続柄が直系尊属の言葉でないため同居老親等にしていません');
              cnt.elderly++; f.depAmount += r.dependent.elderly; nm.kind = 'elderly';
            }
          } else { cnt.other++; f.depAmount += r.dependent.general; nm.kind = 'general'; }
          f.names.dependents.push(nm);
        } else {
          if (dp.disability && dp.disability !== 'none') W(warnings, 'dep_disability_not_applied', who + 'は所得が62万円を超えるので障害者控除の対象になりません');
          var tMax = mode === 'gensen' ? r.gensen.tokutei_income_max : r.tokutei_income_max;
          if (age >= A.specific_min && age < A.specific_max && inc <= tMax) {
            var t = tokuteiDeduction(inc, r);
            f.tokuteiAmount += t; cnt.tokutei++;
            if (dp.nonresident) cnt.nonresident++;
            nm.kind = 'tokutei'; nm.amount = t; f.names.tokutei.push(nm);
          }
        }
      });
      /* 配偶者などの扶養に入れている23歳未満の親族（扶養控除はしない・欄には出さない。冊子 p.20・p.22） */
      var others = Array.isArray(decl.under23_others) ? decl.under23_others.slice(0, 10) : [];
      if (Array.isArray(decl.under23_others) && decl.under23_others.length > 10) W(warnings, 'under23_others_over', '配偶者などの扶養の23歳未満の親族は10人までしか数えません');
      others.forEach(function (o, i) {
        o = o || {};
        var age = ageAt(o.birth, asOf);
        if (age === null) { W(warnings, 'under23_others_birth', '配偶者などの扶養の親族の' + (i + 1) + '人目の生年月日が無いか形が違います（数えません）'); return; }
        if (age < A.under23) f.hasUnder23 = true;
        if (o.special_disabled) f.anySpecialDisDep = true;
      });
      return f;
    }

    /* 年末調整をしない人の源泉徴収票は自社の分だけ（前職を合算しない・手引 p.5 の欄4と欄7「年末調整をしない給与等」）
       源泉控除対象配偶者・源泉控除対象親族・16歳未満の扶養親族は申告から書く（手引 p.5-6 の欄8・p.10 の欄22 注2・欄24 注1・p.12 の用語(1)(5)） */
    function ineligibleLines() {
      var L = { eligible: false, shubetsu: '給料・賞与', pay: own.pay, own_pay: own.pay, own_tax: own.tax, tax: own.tax, si_amount: own.si, prev_pay: 0, prev_si: 0, prev_tax: 0, prev_jobs: [] };
      if (!r || !r.gensen || !r.age || reasons.indexOf('rates_missing') >= 0 || !Number.isInteger(year)) {
        W(warnings, 'slip_family_skipped', '定数が無いので源泉徴収票の配偶者・扶養の欄を作っていません（人が書く）');
        return L;
      }
      var f = family('gensen'), cnt = f.cnt;
      var sp = (decl.spouse && typeof decl.spouse === 'object') ? decl.spouse : null;
      if (sp && !sp.name && !sp.birth && sp.income === undefined) sp = null;
      var selfEst = (kyuyoAfter(own.pay, r) || 0) + otherIncome;
      var gs = !!(sp && (sp.income === undefined || sp.income === null || isInt(sp.income)) && (sp.income || 0) <= r.gensen.spouse_income_max && selfEst <= r.gensen.self_income_max);
      var spAge = gs ? ageAt(sp.birth, asOf) : null;
      if (gs && sp.nonresident) cnt.nonresident++;
      if (sp && (sp.income || 0) <= r.dependent_income_max && isInt(sp.income || 0)) f.disAdd(sp.disability, '配偶者');
      L.spouse_has = gs; L.spouse_elderly = gs && spAge !== null && spAge >= r.age.elderly_min;
      L.spouse_name = gs ? (sp.name || '') : ''; L.spouse_kana = gs ? (sp.kana || '') : ''; L.spouse_nonresident = !!(gs && sp.nonresident);
      L.dep_specific = cnt.specific; L.dep_elderly = cnt.elderly; L.dep_elderly_cohabit = cnt.elderly_cohabit; L.dep_other = cnt.other;
      L.dep_tokutei = cnt.tokutei; L.under16 = cnt.under16;
      L.disabled_special = cnt.dis_special; L.disabled_special_cohabit = cnt.dis_special_cohabit; L.disabled_other = cnt.dis_other;
      L.nonresident = cnt.nonresident;
      L.dependents = f.names.dependents; L.under16_names = f.names.under16; L.tokutei_names = f.names.tokutei;
      L.family_gensen = true;
      return L;
    }
    if (reasons.length) {
      base.lines = ineligibleLines();
      return base;
    }

    var spouse = (decl.spouse && typeof decl.spouse === 'object') ? decl.spouse : null;
    if (spouse && !spouse.name && !spouse.birth && spouse.income === undefined) spouse = null;
    var self = (decl.self && typeof decl.self === 'object') ? decl.self : {};
    var A = r.age;
    var fam = family('ye');
    var cnt = fam.cnt, depAmount = fam.depAmount, tokuteiAmount = fam.tokuteiAmount, hasUnder23 = fam.hasUnder23, anySpecialDisDep = fam.anySpecialDisDep, names = fam.names;
    var disAdd = fam.disAdd;

    /* 5-6. 所得金額調整控除・合計所得 */
    var spouseIncome = 0, spouseAge = null, doitsu = false;
    if (spouse) {
      if (spouse.income === undefined || spouse.income === null) W(warnings, 'spouse_income_missing', '配偶者の所得の見込みが無いので0円として数えました');
      else if (!isInt(spouse.income)) { W(warnings, 'spouse_income_bad', '配偶者の所得の見込みの形が違います（配偶者の控除をしません）'); spouse = null; }
    }
    if (spouse) {
      spouseIncome = spouse.income || 0;
      spouseAge = ageAt(spouse.birth, asOf);
      if (spouseAge === null) W(warnings, 'spouse_birth_missing', '配偶者の生年月日が無いので老人控除対象配偶者にしていません');
      doitsu = spouseIncome <= r.dependent_income_max;
    }
    var selfSpecial = self.disability === 'special' || self.disability === 'special_cohabit';
    var spouseSpecial = !!(spouse && doitsu && (spouse.disability === 'special' || spouse.disability === 'special_cohabit'));
    var adjustNeeded = selfSpecial || hasUnder23 || spouseSpecial || anySpecialDisDep;
    var kyuyo = kyuyoAfter(payTotal, r);
    var adjust = adjustNeeded ? incomeAdjust(payTotal, r) : 0;
    var kyuyoAdj = Math.max(0, kyuyo - adjust);
    var totalIncome = kyuyoAdj + otherIncome;

    /* 5-7. 配偶者 */
    var sp = { kind: null, amount: 0 }, spouseElderly = false;
    if (spouse) {
      spouseElderly = spouseAge !== null && spouseAge >= A.elderly_min;
      sp = spouseDeduction(totalIncome, spouseIncome, spouseElderly, r);
      if (!sp.kind && selfCol(totalIncome, r) < 0) W(warnings, 'spouse_self_over', '本人の合計所得が1,000万円を超えるので配偶者控除・配偶者特別控除はありません');
      if (doitsu) disAdd(spouse.disability, '配偶者');
      else if (spouse.disability && spouse.disability !== 'none') W(warnings, 'spouse_disability_not_applied', '配偶者の所得が62万円を超えるので障害者控除の対象になりません');
      if (spouse.nonresident && sp.kind) cnt.nonresident++;
    }

    /* 5-8. 本人の区分 */
    var selfDis = 0;
    if (self.disability && self.disability !== 'none') {
      if (self.disability === 'general') selfDis = r.disability.general;
      else if (self.disability === 'special') selfDis = r.disability.special;
      else if (self.disability === 'special_cohabit') { selfDis = r.disability.special; W(warnings, 'self_special_cohabit', '本人は同居特別障害者に当たらないので特別障害者として数えました'); }
      else W(warnings, 'bad_disability', '本人の障害者の区分が分かりません（控除しません）');
    }
    var widowAmt = 0, widowKind = null;
    if (self.widow === 'widow' || self.widow === 'single_parent') {
      if (totalIncome <= r.widow_income_max) { widowKind = self.widow; widowAmt = self.widow === 'widow' ? r.widow : r.single_parent; }
      else W(warnings, 'widow_income_over', '合計所得が500万円を超えるので寡婦・ひとり親の控除はありません');
    }
    var wsAmt = 0;
    if (self.working_student) {
      if (totalIncome <= r.working_student_income_max && otherIncome <= r.working_student_other_max) wsAmt = r.working_student;
      else W(warnings, 'working_student_over', '所得の要件を満たさないので勤労学生控除はありません');
    }

    /* 5-9. 保険料 */
    var siExtra = ins.social_extra || 0, smallBiz = ins.small_biz || 0, natPension = ins.national_pension || 0;
    var siTotal = siPay + siExtra + natPension;   /* 国民年金保険料等は社会保険料控除に入れ、源泉徴収票の内訳に別に出す（手引 p.7 欄18） */
    var life = lifeDeduction(ins, hasUnder23, r);
    var quake = quakeDeduction(ins.quake || 0, ins.old_long_fire || 0, r);
    var basic = basicDeduction(totalIncome, r);

    var ded = {
      social: siTotal, small_biz: smallBiz, life: life.total, life_detail: life, quake: quake,
      spouse: sp.kind === 'spouse' ? sp.amount : 0, spouse_special: sp.kind === 'special' ? sp.amount : 0,
      tokutei: tokuteiAmount, dependents: depAmount, disability: fam.disAmount + selfDis,
      widow: widowKind === 'widow' ? widowAmt : 0, single_parent: widowKind === 'single_parent' ? widowAmt : 0,
      working_student: wsAmt, basic: basic
    };
    /* 扶養控除額及び障害者等の控除額の合計（源泉徴収簿の欄・冊子 p.38 の 3-4） */
    ded.fuyo_etc = ded.dependents + ded.disability + ded.widow + ded.single_parent + ded.working_student;
    var dedTotal = ded.social + ded.small_biz + ded.life + ded.quake + ded.spouse + ded.spouse_special + ded.tokutei + ded.fuyo_etc + ded.basic;

    /* 5-10. 税額 */
    var taxable = Math.max(0, kyuyoAdj - dedTotal);
    taxable = taxable - (taxable % r.taxable_unit);
    var calc = taxCalc(taxable, r);
    if (calc === null) {
      reasons.push('over_taxable_max');
      base.eligible = false;
      base.lines = ineligibleLines();
      return base;
    }
    var hAmt = hl.amount || 0, hApplied = 0, hPossible = null;
    if (hAmt > 0) {
      var hMax = hl.income_limit;
      if (!hMax) { hMax = r.housing.default_limit; W(warnings, 'housing_income_limit_unset', '住宅借入金等特別控除の所得要件が申告に無いので 2,000万円で確かめました（住宅の種類と居住開始日で 1,000万・3,000万の時がある・冊子 p.30）'); }
      if (totalIncome > hMax) W(warnings, 'housing_income_over', '合計所得が所得要件を超えるので住宅借入金等特別控除はありません');
      else {
        hApplied = Math.min(hAmt, calc);
        if (hAmt > calc) { hPossible = hAmt; W(warnings, 'housing_over_tax', '住宅借入金等特別控除の額が算出所得税額を超えるので、引ききれない分は切り捨てます（源泉徴収票に可能額を書きます）'); }
      }
    }
    var nenzeiBase = calc - hApplied;
    var nz = mulFloor(nenzeiBase, r.fukko.num, r.fukko.den);
    nz = nz - (nz % r.nenzei_unit);
    var balance = nz - withheld;

    var spouseLine = !!sp.kind;
    var hShow = hApplied > 0 || hPossible !== null;   /* 可能額がある時は算出税額が0でも内訳を書く（手引 p.7 欄19） */
    base.eligible = true;
    base.si_total = siTotal;
    base.kyuyo_shotoku = kyuyo; base.income_adjust = adjust; base.kyuyo_after_adjust = kyuyoAdj; base.total_income = totalIncome;
    base.deductions = ded; base.deductions_total = dedTotal; base.taxable = taxable; base.tax_calc = calc;
    base.housing_applied = hApplied; base.housing_possible = hPossible; base.nenzei_before_fukko = nenzeiBase; base.nenzei = nz;
    base.balance = balance; base.balance_settle = balance;
    base.lines = {
      eligible: true, shubetsu: '給料・賞与',
      pay: payTotal, kyuyo_after: kyuyoAdj, deductions_total: dedTotal, tax: nz,
      own_pay: own.pay, own_tax: Math.max(0, nz - prev.tax),
      spouse_has: spouseLine && sp.kind === 'spouse', spouse_elderly: sp.kind === 'spouse' && spouseElderly,
      spouse_deduction: sp.amount, spouse_income: spouseLine ? spouseIncome : null,
      spouse_name: spouseLine ? (spouse.name || '') : '', spouse_kana: spouseLine ? (spouse.kana || '') : '', spouse_nonresident: !!(spouseLine && spouse.nonresident),
      spouse_doitsu_note: (!spouseLine && spouse && doitsu && spouse.disability && spouse.disability !== 'none') ? (spouse.name || '') : '',
      dep_specific: cnt.specific, dep_elderly: cnt.elderly, dep_elderly_cohabit: cnt.elderly_cohabit, dep_other: cnt.other,
      dep_tokutei: cnt.tokutei, under16: cnt.under16,
      disabled_special: cnt.dis_special, disabled_special_cohabit: cnt.dis_special_cohabit, disabled_other: cnt.dis_other,
      nonresident: cnt.nonresident, tokutei_amount: tokuteiAmount,
      si_amount: siTotal + smallBiz, small_biz: smallBiz,
      life_amount: life.total, quake_amount: quake, housing_amount: hApplied, housing_possible: hPossible,
      housing_count: hShow ? (hl.count === 2 ? 2 : 1) : 0, housing_start: hShow && isDate(hl.start_date) ? hl.start_date : '', housing_kind: hShow ? String(hl.kind || '') : '',
      national_pension: natPension,
      life_new: ins.life_new_general || 0, life_old: ins.life_old_general || 0, life_care: ins.life_new_care || 0,
      pension_new: ins.life_new_pension || 0, pension_old: ins.life_old_pension || 0,
      old_long: ins.old_long_fire ? ins.old_long_fire : 0,
      basic: basic, income_adjust: adjust,
      self_disability: self.disability === 'general' ? 'general' : (selfSpecial ? 'special' : ''),
      widow: widowKind === 'widow', single_parent: widowKind === 'single_parent', working_student: wsAmt > 0,
      life_u23_applied: life.u23_applied,
      dependents: names.dependents.concat([]), under16_names: names.under16, tokutei_names: names.tokutei,
      adjust_names: adjust > 0 ? names.adjust : [],
      prev_pay: prev.pay, prev_si: prev.si, prev_tax: prev.tax, prev_jobs: prev.list
    };
    return base;
  }

  var api = {
    VERSION: CALC_VER, computeYearEnd: computeYearEnd,
    kyuyoAfter: kyuyoAfter, basicDeduction: basicDeduction, spouseDeduction: spouseDeduction, tokuteiDeduction: tokuteiDeduction,
    incomeAdjust: incomeAdjust, lifeDeduction: lifeDeduction, quakeDeduction: quakeDeduction, taxCalc: taxCalc, stepFormula: stepFormula,
    ageAt: ageAt, isDate: isDate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollYearEnd = api;
})(typeof window !== 'undefined' ? window : this);
