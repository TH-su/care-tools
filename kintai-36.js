/* kintai-36.js — 勤怠管理の36協定のアラートの純関数（2026-11-20 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md の段3）
 * ════════════════════════════════════════════════════════════════
 * ・画面（kintai.js）とは通信も DOM も持たない。試験は check/unit/kintai_36_test.js
 * ・設定の鍵 agreement36（無い時は既定）。既定は freee の初期値にそろえる（仮置き）。
 *   月の警告の目安 monthWarnH が無い時は、今の画面の警告と同じ値（設定の overtimeMonthWarnH・無ければ 45）を使う
 * ・比べるのは全部「分の整数」（時間×60）。平均は割ってから比べず、合計と「上限×60×か月数」を比べる
 * ・法の上限（労基法36条6項）は設定と切り離して常に判定する: 法定外＋休日労働が月100時間以上・2〜6か月の平均が80時間超
 * ・休日労働は法定休日（legal_holiday）を決めていないと数えられない（0 になる）ので、休日労働を含む項目に「少なく出ています」を足す（不変条件4）
 * ・年度の累計・45時間を超えた月の数は、協定年度の最初の月から ym までを数える。2〜6か月の平均は年度をまたいで数える
 * ・months には月の30分丸め（monthRound30）の前の値を渡す（丸めた値で上限を判定しない）
 * ・休日労働を数えたか（法定休日を決めていたか）は月ごとに持つ（months の行の holidayKnown）。判定に使う月の1つでも false なら注意を出す
 * ・2〜6か月の平均の窓に記録の無い月がある時は、無い月を0とした合計がもう上限を超えれば確定の超過、超えなければ「確かめられません」の警告
 * ・氏名などの業務データを端末に残さない（このファイルは計算だけ）。試験も架空の職員だけ
 */
(function (root) {
  'use strict';
  var DEFAULTS = {
    startMonth: 4, monthLimitH: 45, yearLimitH: 360, monthWarnH: 36, yearWarnH: 288,
    special: false, specialMonthMaxH: 100, specialAvgH: 80, specialYearH: 720, specialCountMax: 6
  };
  /* 範囲（範囲外・壊れた値は既定へ）。上限の値は法の値まで（仮置き）。0 の monthWarnH・yearWarnH は「目安の警告を出さない」 */
  var RANGE = {
    monthLimitH: [1, 45], yearLimitH: [1, 360], monthWarnH: [0, 200], yearWarnH: [0, 720],
    specialMonthMaxH: [1, 100], specialAvgH: [1, 80], specialYearH: [1, 720]
  };
  /* kintai-calc.js の DEFAULTS.overtimeMonthWarnH と同じ値（今の画面の警告） */
  var OLD_WARN_DEFAULT = 45;
  /* 法の上限（労基法36条6項2号・3号）。設定で変えない */
  var LAW_MONTH_MIN = 100 * 60, LAW_AVG_MIN = 80 * 60;
  var HOLIDAY_NOTE = '法定休日を決めていないため少なく出ています';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isYm(s) { return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) && +s.slice(5, 7) >= 1 && +s.slice(5, 7) <= 12; }
  function ymIndex(s) { return +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1); }
  function ymOf(ix) { return Math.floor(ix / 12) + '-' + pad(ix % 12 + 1); }
  function numIn(v, r) { return typeof v === 'number' && isFinite(v) && v >= r[0] && v <= r[1]; }
  function isMonthNo(v) { return typeof v === 'number' && v >= 1 && v <= 12 && Math.floor(v) === v; }
  function minOf(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : 0; }

  /* 設定を既定で埋める（壊れた値・範囲外は既定へ戻す＝起動不能にしない）。cfg は勤怠の設定全体（kintai_settings.config） */
  function fillAgreement(cfg) {
    var out = {}, k, c = cfg && typeof cfg === 'object' ? cfg : {};
    var a = c.agreement36 && typeof c.agreement36 === 'object' && !Array.isArray(c.agreement36) ? c.agreement36 : {};
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    for (k in RANGE) if (k !== 'monthWarnH' && numIn(a[k], RANGE[k])) out[k] = a[k];
    if (isMonthNo(a.startMonth)) out.startMonth = a.startMonth;
    if (typeof a.special === 'boolean') out.special = a.special;
    if (typeof a.specialCountMax === 'number' && a.specialCountMax >= 0 && a.specialCountMax <= 6 && Math.floor(a.specialCountMax) === a.specialCountMax) out.specialCountMax = a.specialCountMax;
    /* 月の目安: agreement36.monthWarnH → 設定の overtimeMonthWarnH（kintai-calc.js の範囲 0〜200）→ 今の画面の既定 45 */
    if (numIn(a.monthWarnH, RANGE.monthWarnH)) out.monthWarnH = a.monthWarnH;
    else if (numIn(c.overtimeMonthWarnH, [0, 200])) out.monthWarnH = c.overtimeMonthWarnH;
    else out.monthWarnH = OLD_WARN_DEFAULT;
    return out;
  }

  /* その月が属する協定年度の最初の月（'YYYY-MM'）。文字の計算だけ（端末の時刻帯に関係しない）。形が違えば null */
  function fiscalYearOf(ym, startMonth) {
    if (!isYm(ym)) return null;
    var s = isMonthNo(startMonth) ? startMonth : DEFAULTS.startMonth;
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return (m >= s ? y : y - 1) + '-' + pad(s);
  }

  /* 法定休日を決めているか（kintai-calc.js の checkLegalHoliday と同じ読み方: 0〜6 の整数か '0'〜'6' だけ。ほかは決めていない＝休日労働 0） */
  function legalHolidaySet(v) {
    if (typeof v === 'string') return /^[0-6]$/.test(v);
    return typeof v === 'number' && v >= 0 && v <= 6 && Math.floor(v) === v;
  }
  /* 時間の文字: 45時間・45時間30分・30分 */
  function fmtH(min) {
    min = Math.max(0, Math.round(min));
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + '分';
    return m ? h + '時間' + m + '分' : h + '時間';
  }

  /* 判定。months は職員1人分の [{ ym, legalOverMin, holidayMin, locked, partial, holidayKnown（その月を法定休日を決めて数えたか・省略は opts の値） }]（締めた月分は控えの値・締めていない月分は computeMonth の値）
   * opts: { holidayKnown（false＝法定休日を決めていない・省略時は cfg.legal_holiday が無ければ false）, elapsedDays, periodDays（月の途中の見込み） }
   * 返す: { ym, fiscalFrom, monthLegalMin, monthHolidayMin, yearLegalMin, monthWithHolidayMin, avg:{n2..n6（分・窓に無い月があれば null）},
   *         over45Count, projectedMin（月の途中の見込み・無ければ null）, holidayUnknown, items:[{ code, level:'warn'|'over', text, note? }], agreement（埋めた設定） }
   * ym の形が違う時は null */
  function judge(months, ym, cfg, opts) {
    if (!isYm(ym)) return null;
    var a = fillAgreement(cfg), o = opts || {};
    var holidayDefault = typeof o.holidayKnown === 'boolean' ? o.holidayKnown : legalHolidaySet(cfg && cfg.legal_holiday);
    var holidayKnown = true;
    var useMonth = function (r) { if (r && (typeof r.holidayKnown === 'boolean' ? !r.holidayKnown : !holidayDefault)) holidayKnown = false; };
    /* 同じ月が2つある時は締めた方（控え）を正にし、どちらも同じなら後の方 */
    var by = {};
    (Array.isArray(months) ? months : []).forEach(function (r) {
      if (!r || !isYm(r.ym)) return;
      if (by[r.ym] && by[r.ym].locked && !r.locked) return;
      by[r.ym] = r;
    });
    var ix = ymIndex(ym), cur = by[ym] || null;
    if (!cur) useMonth({});   /* 当月の記録が無い時は既定の値で決める */
    useMonth(cur);
    var legal = cur ? minOf(cur.legalOverMin) : 0, hol = cur ? minOf(cur.holidayMin) : 0;
    var fy = fiscalYearOf(ym, a.startMonth), fyIx = ymIndex(fy);
    var yearLegal = 0, over45 = 0, limitMin = a.monthLimitH * 60;
    for (var i = fyIx; i <= ix; i++) {
      var r = by[ymOf(i)];
      if (!r) continue;
      useMonth(r);
      var lm = minOf(r.legalOverMin);
      yearLegal += lm;
      if (lm > limitMin) over45++;
    }
    /* 2〜6か月の平均（法定外＋休日労働）。ym を終わりにした直近 n か月。窓の中に無い月があれば平均は null（0 で埋めない）。
       lows は無い月を0とした合計（少なくともこれだけある＝これで上限を超えれば確定の超過）、gaps は窓の中の無い月 */
    var avg = {}, sums = {}, lows = {}, gaps = [];
    for (var n = 2; n <= 6; n++) {
      var s = 0, ok = true;
      for (var j = 0; j < n; j++) {
        var rr = by[ymOf(ix - j)];
        if (!rr) { ok = false; if (gaps.indexOf(ix - j) < 0) gaps.push(ix - j); continue; }
        useMonth(rr);
        s += minOf(rr.legalOverMin) + minOf(rr.holidayMin);
      }
      sums[n] = ok ? s : null;
      lows[n] = s;
      avg['n' + n] = ok ? Math.round(s / n) : null;
    }
    var items = [];
    var note = function (it) { if (!holidayKnown) { it.note = HOLIDAY_NOTE; it.text += '（' + HOLIDAY_NOTE + '）'; } return it; };
    var total = legal + hol;

    /* 月の法定外 */
    var warnMin = a.monthWarnH * 60;
    if (legal > limitMin) {
      if (a.special) items.push({ code: 'month_special', level: 'warn', text: '法定外が今月 ' + fmtH(legal) + 'で、月' + fmtH(limitMin) + 'を超えています（特別条項の月・今年度 ' + over45 + '回目／上限 ' + a.specialCountMax + '回）' });
      else items.push({ code: 'month_over', level: 'over', text: '法定外が今月 ' + fmtH(legal) + 'で、36協定の月の上限 ' + fmtH(limitMin) + 'を超えています' });
    } else if (a.monthWarnH > 0 && legal >= warnMin) {
      /* 文は kintai-calc.js の月の警告と同じ形（monthWarnH が今の既定の時は今と一字一句同じ） */
      items.push({ code: 'month_warn', level: 'warn', text: '法定外の時間が月' + a.monthWarnH + '時間以上です（36協定の確認）' });
    }
    /* 特別条項の月の上限（法定外＋休日労働）。100時間（法の「未満」）の時は下の法の項目だけを出す（二重に出さない）。
       協定で100時間より下げた値は「超えたら」超過（90時間ちょうどは超過でない） */
    var spMax = a.specialMonthMaxH * 60;
    if (a.special && spMax < LAW_MONTH_MIN && total > spMax) {
      items.push(note({ code: 'month_special_max', level: 'over', text: '法定外＋休日労働が今月 ' + fmtH(total) + 'で、特別条項の月の上限 ' + fmtH(spMax) + 'を超えています' }));
    }
    if (total >= LAW_MONTH_MIN) {
      items.push(note({ code: 'law_month100', level: 'over', text: '法定外＋休日労働が今月 ' + fmtH(total) + 'です。月100時間未満の法の上限を超えています（労基法36条6項）' }));
    }
    /* 年度の累計 */
    var yLimit = (a.special ? a.specialYearH : a.yearLimitH) * 60;
    if (yearLegal > yLimit) {
      items.push({ code: 'year_over', level: 'over', text: '法定外の今年度の累計が ' + fmtH(yearLegal) + 'で、36協定の年の上限 ' + fmtH(yLimit) + 'を超えています' });
    } else if (a.yearWarnH > 0 && yearLegal >= a.yearWarnH * 60) {
      items.push({ code: 'year_warn', level: 'warn', text: '法定外の今年度の累計が ' + fmtH(yearLegal) + 'です（36協定の目安 ' + fmtH(a.yearWarnH * 60) + '以上・年の上限 ' + fmtH(yLimit) + '）' });
    }
    /* 2〜6か月の平均。法の80時間は常に。特別条項の平均は80時間より厳しい時だけ別に出す */
    var avgOver = function (limitAvgMin) {
      var hit = [];
      for (var k = 2; k <= 6; k++) {
        if (sums[k] != null && sums[k] > limitAvgMin * k) hit.push(k + 'か月平均 ' + fmtH(Math.ceil(sums[k] / k)));
        else if (sums[k] == null && lows[k] > limitAvgMin * k) hit.push(k + 'か月平均 ' + fmtH(Math.ceil(lows[k] / k)) + '以上（記録の無い月を0として）');
      }
      return hit;
    };
    var spAvg = a.specialAvgH * 60;
    if (a.special && spAvg < LAW_AVG_MIN) {
      var hs = avgOver(spAvg);
      if (hs.length && !avgOver(LAW_AVG_MIN).length) items.push(note({ code: 'avg_special', level: 'over', text: '法定外＋休日労働の 2〜6か月の平均が、特別条項の上限 ' + fmtH(spAvg) + 'を超えています（' + hs.join('、') + '）' }));
    }
    var hl = avgOver(LAW_AVG_MIN);
    if (hl.length) items.push(note({ code: 'law_avg80', level: 'over', text: '法定外＋休日労働の 2〜6か月の平均が 80時間を超えています（' + hl.join('、') + '）。80時間以下の法の上限です（労基法36条6項）' }));
    /* 窓に記録の無い月があり、超過と決まらなかった時は「確かめられません」（超過が出ている時は重ねない） */
    if (gaps.length && !hl.length && !(a.special && spAvg < LAW_AVG_MIN && avgOver(spAvg).length)) {
      gaps.sort(function (x, y) { return x - y; });
      items.push({ code: 'avg_unknown', level: 'warn', text: gaps.map(function (g) { return (g % 12 + 1) + '月'; }).join('・') + 'の記録が無いため、2〜6か月の平均を確かめられません' });
    }
    /* 特別条項の回数 */
    if (a.special && over45 > a.specialCountMax) {
      items.push({ code: 'count_over', level: 'over', text: '法定外が月' + fmtH(limitMin) + 'を超えた月が今年度 ' + over45 + '回で、特別条項の上限 ' + a.specialCountMax + '回を超えています' });
    }
    /* 月の途中の見込み（今日までの値×期間の日数÷過ぎた日数・仮置き）。実績がもう上限を超えている時は重ねない */
    var projected = null, ed = o.elapsedDays, pd = o.periodDays;
    if (cur && cur.partial && !cur.locked && typeof ed === 'number' && typeof pd === 'number' && isFinite(ed) && isFinite(pd) && ed > 0 && pd >= ed) {
      projected = Math.round(legal * pd / ed);
      if (projected > limitMin && legal <= limitMin) items.push({ code: 'projection', level: 'warn', text: 'この調子だと月末に' + fmtH(limitMin) + 'を超えます（見込み ' + fmtH(projected) + '）' });
    }
    return {
      ym: ym, fiscalFrom: fy, monthLegalMin: legal, monthHolidayMin: hol, yearLegalMin: yearLegal, monthWithHolidayMin: total,
      avg: avg, over45Count: over45, projectedMin: projected, holidayUnknown: !holidayKnown, items: items, agreement: a
    };
  }

  var api = { DEFAULTS: DEFAULTS, HOLIDAY_NOTE: HOLIDAY_NOTE, fillAgreement: fillAgreement, fiscalYearOf: fiscalYearOf, fmtH: fmtH, judge: judge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Kintai36 = api;
})(typeof window !== 'undefined' ? window : this);
