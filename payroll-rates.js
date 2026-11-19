/* payroll-rates.js — 給与の率表の純データ（2026-11-19 新設・給与 v1 の契約 §1）
 * ════════════════════════════════════════════════════════════════
 * ・健康保険（協会けんぽ・都道府県）・介護・子ども子育て支援金・厚生年金・子ども子育て拠出金・雇用保険・
 *   標準報酬月額の等級・最低賃金・通勤手当の非課税限度を日付つきで持つ
 * ・引く基準日（契約 §1・検品の2）: 社保＝保険料の対象月（YYYY-MM）／雇用保険＝締め日（YYYY-MM-DD）／
 *   源泉の税額表＝支給日（payroll-tax-table.js）
 * ・一次資料で確かめた値だけを書く。確かめられない値は null（呼ぶ側が警告を出す）。記憶で埋めない
 *   - 令和8年3月分より前・令和9年3月分以降の社保の率は書いていない（null）
 *   - 令和9年4月1日以降の雇用保険料率は書いていない（null）
 *   - 熊本の最低賃金・通勤手当の非課税限度は一次資料で確かめていないので null
 * ・率は小数（0.1008＝10.08%）で返す。計算する側は百万分率の整数に直してから掛ける（50銭の境目を浮動小数で狂わせない）
 * ・個人情報は無い
 */
(function (root) {
  'use strict';
  var VERSION = 'rates-2026-11-19';

  /* 協会けんぽ（都道府県番号 '43'＝熊本）。from〜to は保険料の対象月（両端を含む）
     出典: 協会けんぽ 令和8年度 都道府県単位保険料率・熊本支部の料額表（R8_43kumamotoi.pdf）
     支援金は令和8年4月分から（3月分は 0） */
  var HEALTH = [
    { pref: '43', from: '2026-03', to: '2026-03', health: 0.1008, care: 0.0162, support: 0, pension: 0.183, childcare_contrib: 0.0036 },
    { pref: '43', from: '2026-04', to: '2027-02', health: 0.1008, care: 0.0162, support: 0.0023, pension: 0.183, childcare_contrib: 0.0036 }
  ];

  /* 雇用保険（一般の事業）。from〜to は締め日（両端を含む）。出典: 厚労省 令和8年度の雇用保険料率（001692566.pdf） */
  var EMPLOYMENT = [
    { kind: 'general', from: '2026-04-01', to: '2027-03-31', worker: 0.005, employer: 0.0085 }
  ];

  /* 健康保険の標準報酬月額 [等級, 標準報酬, 報酬月額の下限（以上）]。上限は次の等級の下限（未満） */
  var HEALTH_GRADES = [
    [1, 58000, 0], [2, 68000, 63000], [3, 78000, 73000], [4, 88000, 83000], [5, 98000, 93000],
    [6, 104000, 101000], [7, 110000, 107000], [8, 118000, 114000], [9, 126000, 122000], [10, 134000, 130000],
    [11, 142000, 138000], [12, 150000, 146000], [13, 160000, 155000], [14, 170000, 165000], [15, 180000, 175000],
    [16, 190000, 185000], [17, 200000, 195000], [18, 220000, 210000], [19, 240000, 230000], [20, 260000, 250000],
    [21, 280000, 270000], [22, 300000, 290000], [23, 320000, 310000], [24, 340000, 330000], [25, 360000, 350000],
    [26, 380000, 370000], [27, 410000, 395000], [28, 440000, 425000], [29, 470000, 455000], [30, 500000, 485000],
    [31, 530000, 515000], [32, 560000, 545000], [33, 590000, 575000], [34, 620000, 605000], [35, 650000, 635000],
    [36, 680000, 665000], [37, 710000, 695000], [38, 750000, 730000], [39, 790000, 770000], [40, 830000, 810000],
    [41, 880000, 855000], [42, 930000, 905000], [43, 980000, 955000], [44, 1030000, 1005000], [45, 1090000, 1055000],
    [46, 1150000, 1115000], [47, 1210000, 1175000], [48, 1270000, 1235000], [49, 1330000, 1295000], [50, 1390000, 1355000]
  ];
  /* 厚生年金の等級1〜32＝健保の等級4〜35（等級1は93,000円未満・等級32は635,000円以上） */
  var PENSION_FROM = 4, PENSION_TO = 35;

  /* 最低賃金（都道府県・発効日つき・時間額）。一次資料で確かめていないので空（minWage は null を返す） */
  var MIN_WAGE = [];

  /* 通勤手当の非課税限度（令和8年4月1日〜）。一次資料の表を確かめていないので空（commuteLimit は null を返す） */
  var COMMUTE = [];

  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s); }
  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  /* 保険料の対象月 ym の健保・介護・支援金・厚年・拠出金の率。無ければ null */
  function health(prefecture, ym) {
    if (!isYm(ym)) return null;
    var p = String(prefecture == null ? '' : prefecture);
    for (var i = 0; i < HEALTH.length; i++) {
      var h = HEALTH[i];
      if (h.pref === p && h.from <= ym && ym <= h.to) {
        return { health: h.health, care: h.care, support: h.support, pension: h.pension, childcare_contrib: h.childcare_contrib };
      }
    }
    return null;
  }

  /* 締め日 dateClose の雇用保険料率。無ければ null */
  function employment(dateClose, kind) {
    if (!isDate(dateClose)) return null;
    var k = kind || 'general';
    for (var i = 0; i < EMPLOYMENT.length; i++) {
      var e = EMPLOYMENT[i];
      if (e.kind === k && e.from <= dateClose && dateClose <= e.to) return { worker: e.worker, employer: e.employer };
    }
    return null;
  }

  /* 報酬月額 amount の等級 { health:{grade,std}, pension:{grade,std} } */
  function grade(amount) {
    var a = Number(amount);
    if (!isFinite(a) || a < 0) return null;
    var gi = 0;
    for (var i = 0; i < HEALTH_GRADES.length; i++) if (a >= HEALTH_GRADES[i][2]) gi = i;
    var h = HEALTH_GRADES[gi];
    var pi = Math.min(Math.max(gi, PENSION_FROM - 1), PENSION_TO - 1);
    return { health: { grade: h[0], std: h[1] }, pension: { grade: pi - (PENSION_FROM - 1) + 1, std: HEALTH_GRADES[pi][1] } };
  }

  /* std が表にある標準報酬月額か（kind: 'health'|'pension'） */
  function isStd(kind, std) {
    for (var i = 0; i < HEALTH_GRADES.length; i++) {
      if (HEALTH_GRADES[i][1] !== std) continue;
      if (kind === 'pension') return HEALTH_GRADES[i][0] >= PENSION_FROM && HEALTH_GRADES[i][0] <= PENSION_TO;
      return true;
    }
    return false;
  }

  /* その日に効いている最低賃金（時間額）。無ければ null */
  function minWage(prefecture, date) {
    if (!isDate(date)) return null;
    var p = String(prefecture == null ? '' : prefecture), best = null;
    for (var i = 0; i < MIN_WAGE.length; i++) {
      var m = MIN_WAGE[i];
      if (m.pref === p && m.from <= date && (best === null || m.from > best.from)) best = m;
    }
    return best && typeof best.hourly === 'number' ? best.hourly : null;
  }

  /* 通勤手当の月の非課税限度（means: 'transit'|'car' など・distance_km）。無ければ null */
  function commuteLimit(date, means, distanceKm) {
    if (!isDate(date)) return null;
    var best = null;
    for (var i = 0; i < COMMUTE.length; i++) {
      var c = COMMUTE[i];
      if (c.means !== means || c.from > date) continue;
      if (c.minKm != null && !(distanceKm >= c.minKm)) continue;
      if (c.maxKm != null && !(distanceKm < c.maxKm)) continue;
      if (best === null || c.from > best.from) best = c;
    }
    return best && typeof best.limit === 'number' ? best.limit : null;
  }

  var api = {
    VERSION: VERSION, HEALTH: HEALTH, EMPLOYMENT: EMPLOYMENT, HEALTH_GRADES: HEALTH_GRADES,
    MIN_WAGE: MIN_WAGE, COMMUTE: COMMUTE,
    health: health, employment: employment, grade: grade, isStd: isStd, minWage: minWage, commuteLimit: commuteLimit,
    taxTable: function (payDate) {
      var T = (typeof require !== 'undefined' && typeof window === 'undefined') ? require('./payroll-tax-table.js') : root.PayrollTaxTable;
      return T ? T.forPayDate(payDate) : null;
    },
    _copy: copy
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollRates = api;
})(typeof window !== 'undefined' ? window : this);
