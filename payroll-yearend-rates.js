/* payroll-yearend-rates.js — 年末調整の定数の純データ（2026-11-23 新設・凍結仕様 ROOT-yearend.md の B2）
 * ════════════════════════════════════════════════════════════════
 * ・令和8年分（2026年）の年末調整の決まりの数字だけを持つ。計算は payroll-yearend.js
 * ・出典（頁は冊子の通し頁＝PDF の頁）:
 *     冊子「令和8年分 年末調整のしかた」 https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/nencho_all.pdf
 *     手引「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」 https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/all.pdf
 *   確かめた頁を各値の横に書く（2026-11-23）。頁の画像で確かめた: p.3・p.4・p.10-14・p.19・p.24-26・p.36-39・p.47-57。
 *   抽出文（all.txt）だけで確かめた: p.5（2,000万円超は対象外）・p.17（老人控除対象配偶者＝昭和32年1月1日以前生まれ）・p.30（住宅の所得要件）
 * ・確かめられない値は null にする（computeYearEnd が rates_missing を出して計算を止める）。記憶で埋めない・令和7年分の値を使わない
 * ・年の無い年（2025・2027 など）は forYear が null を返す
 * ・金額は円の整数。率は分子と分母の整数で持つ（浮動小数で掛けない）
 * ・個人情報は無い
 */
(function (root) {
  'use strict';
  var VERSION = 'yearend-rates-2026-11-23';

  var R8 = {
    year: 2026, label: '令和8年分',
    source: {
      booklet: 'https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/nencho_all.pdf',
      tebiki: 'https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/all.pdf'
    },

    /* 年末調整の対象（冊子 p.5「主たる給与の収入金額が2,000万円を超える人」は対象外） */
    eligible_pay_max: 20000000,

    /* 給与所得控除後の給与等の金額（冊子 p.3 の (2) ハ・p.36・p.47〜54 の表）
       ・741,000円未満は 0（p.47 の最初の行・p.36 注1）
       ・741,000〜2,190,999円は「給与等の金額から740,000円を控除した金額」の1行（p.47・p.3 ハ）
       ・2,191,000〜2,199,999円は3行の定額（p.47・p.3 ハ）
       ・2,200,000〜6,599,999円は4,000円刻みの行。行の下限×率−控除額が表の値（p.47〜54 の見本の行で確かめた）
       ・6,600,000〜8,499,999円は×90%−1,100,000円、8,500,000〜20,000,000円は−1,950,000円（1円未満切り捨て・p.54 の終わりの行・p.36 注2） */
    kyuyo: {
      zero_below: 741000,                                   /* p.47 */
      flat: { from: 741000, to: 2191000, sub: 740000 },     /* p.47（to は未満） */
      fixed: [                                              /* p.47・p.3 ハ（to は未満） */
        { from: 2191000, to: 2193000, value: 1451000 },
        { from: 2193000, to: 2196000, value: 1453000 },
        { from: 2196000, to: 2200000, value: 1456000 }
      ],
      table: [                                              /* p.47〜54（to は未満・unit 円刻みの行の下限で計算） */
        { from: 2200000, to: 3600000, unit: 4000, num: 7, den: 10, sub: 80000 },
        { from: 3600000, to: 6600000, unit: 4000, num: 8, den: 10, sub: 440000 }
      ],
      formula: [                                            /* p.54・p.36 注2（to は未満・null は上限なし） */
        { from: 6600000, to: 8500000, num: 9, den: 10, sub: 1100000 },
        { from: 8500000, to: null, num: 1, den: 1, sub: 1950000 }
      ]
    },

    /* 基礎控除（合計所得金額で引く・max は「以下」）（冊子 p.56 の〔参考〕令和8年分の基礎控除額の表・p.3 の (1)） */
    basic: [
      { max: 4890000, amount: 1040000 },
      { max: 6550000, amount: 670000 },
      { max: 23500000, amount: 620000 },
      { max: 24000000, amount: 480000 },
      { max: 24500000, amount: 320000 },
      { max: 25000000, amount: 160000 }
    ],                                                      /* 2,500万円超は 0（p.56 注2） */

    /* 扶養親族等の所得要件（冊子 p.4 の (3)・p.10・p.12・p.18-19・p.55） */
    dependent_income_max: 620000,                           /* 扶養親族・同一生計配偶者（p.4・p.10・p.12） */
    tokutei_income_max: 1230000,                            /* 特定親族（p.4・p.19） */
    spouse_special_income_max: 1330000,                     /* 配偶者特別控除の対象（p.4・p.55） */
    spouse_self_income_max: 10000000,                       /* 本人の合計所得が超えると配偶者控除・特別控除なし（p.55 注1・p.17） */

    /* 年齢（12月31日現在・誕生日の前日に到達）。printed は冊子に書かれた生年月日の区切りで、試験で年齢の数え方と照らす */
    age: {
      dependent_min: 16,  /* 控除対象扶養親族（p.11・p.56: 平成23年1月1日以前生まれ） */
      specific_min: 19,   /* 特定扶養親族（p.11・p.56: 平成16年1月2日〜平成20年1月1日生まれ） */
      specific_max: 23,   /* 23歳未満（未満） */
      elderly_min: 70,    /* 老人扶養親族・老人控除対象配偶者（p.11・p.17・p.56: 昭和32年1月1日以前生まれ） */
      under23: 23,        /* 所得金額調整控除と生命保険料の特例の「年齢23歳未満の扶養親族」（p.4・p.19・申告書の欄「平16.1.2以後生」） */
      nonres_min: 30,     /* 非居住者で30歳以上70歳未満は条件つき（p.11: 昭和32年1月2日〜平成9年1月1日生まれ） */
      nonres_max: 70,
      printed: {
        dependent_on_or_before: '2011-01-01',
        specific_from: '2004-01-02', specific_to: '2008-01-01',
        elderly_on_or_before: '1957-01-01',
        under23_on_or_after: '2004-01-02',
        nonres_from: '1957-01-02', nonres_to: '1997-01-01'
      }
    },

    /* 扶養控除・障害者控除・寡婦・ひとり親・勤労学生（冊子 p.56 の〔参考〕令和8年分の扶養控除額等の表・p.13-14） */
    dependent: { general: 380000, specific: 630000, elderly: 480000, elderly_cohabit: 580000 },
    disability: { general: 270000, special: 400000, special_cohabit: 750000 },
    widow: 270000, single_parent: 350000, working_student: 270000,
    widow_income_max: 5000000,                              /* 寡婦・ひとり親の本人の合計所得（p.13・p.14） */
    working_student_income_max: 890000,                     /* 勤労学生の合計所得（p.4・p.14） */
    working_student_other_max: 100000,                      /* 給与所得等以外の所得（p.14 の (3)） */

    /* 配偶者控除・配偶者特別控除（冊子 p.55 の〔参考〕令和8年分の配偶者控除額及び配偶者特別控除額の一覧表）
       self_cols は本人の合計所得の列の上限（以下）: 900万以下／900万超950万以下／950万超1,000万以下 */
    spouse: {
      self_cols: [9000000, 9500000, 10000000],
      ordinary: [380000, 260000, 130000],
      elderly: [480000, 320000, 160000],
      special: [                                            /* 配偶者の合計所得 min 超 max 以下 */
        { min: 620000, max: 950000, amounts: [380000, 260000, 130000] },
        { min: 950000, max: 1000000, amounts: [360000, 240000, 120000] },
        { min: 1000000, max: 1050000, amounts: [310000, 210000, 110000] },
        { min: 1050000, max: 1100000, amounts: [260000, 180000, 90000] },
        { min: 1100000, max: 1150000, amounts: [210000, 140000, 70000] },
        { min: 1150000, max: 1200000, amounts: [160000, 110000, 60000] },
        { min: 1200000, max: 1250000, amounts: [110000, 80000, 40000] },
        { min: 1250000, max: 1300000, amounts: [60000, 40000, 20000] },
        { min: 1300000, max: 1330000, amounts: [30000, 20000, 10000] }
      ]
    },

    /* 特定親族特別控除（冊子 p.56 の〔参考〕令和8年分の特定親族特別控除額の表・p.19）親族の合計所得 min 超 max 以下 */
    tokutei: [
      { min: 620000, max: 850000, amount: 630000 },
      { min: 850000, max: 900000, amount: 610000 },
      { min: 900000, max: 950000, amount: 510000 },
      { min: 950000, max: 1000000, amount: 410000 },
      { min: 1000000, max: 1050000, amount: 310000 },
      { min: 1050000, max: 1100000, amount: 210000 },
      { min: 1100000, max: 1150000, amount: 110000 },
      { min: 1150000, max: 1200000, amount: 60000 },
      { min: 1200000, max: 1230000, amount: 30000 }
    ],

    /* 所得金額調整控除（冊子 p.19・p.37）(給与の総額（上限 cap）−threshold)×1/10・1円未満切り上げ・上限 max */
    income_adjust: { threshold: 8500000, cap: 10000000, num: 1, den: 10, max: 150000 },

    /* 生命保険料控除（冊子 p.24 の計算式I・II・III・p.4 の 2）。段は「upto 以下」。rate は分子/分母、add は加える額、最後は一律 */
    life: {
      new: { steps: [{ upto: 20000, num: 1, den: 1, add: 0 }, { upto: 40000, num: 1, den: 2, add: 10000 }, { upto: 80000, num: 1, den: 4, add: 20000 }], flat: 40000 },       /* 計算式I */
      new_u23: { steps: [{ upto: 30000, num: 1, den: 1, add: 0 }, { upto: 60000, num: 1, den: 2, add: 15000 }, { upto: 120000, num: 1, den: 4, add: 30000 }], flat: 60000 }, /* 計算式II */
      old: { steps: [{ upto: 25000, num: 1, den: 1, add: 0 }, { upto: 50000, num: 1, den: 2, add: 12500 }, { upto: 100000, num: 1, den: 4, add: 25000 }], flat: 50000 },     /* 計算式III */
      both_max: 40000,          /* 新旧の両方の合計の上限（p.24 の表の (3)） */
      both_max_u23: 60000,      /* 23歳未満の扶養親族がいる一般の生命保険料の両方の上限（p.4 の 2 (2)・p.24） */
      total_max: 120000         /* 一般・介護医療・個人年金の合計の上限（p.4 注・p.24） */
    },

    /* 地震保険料控除（冊子 p.26 の表）。地震は全額（上限 quake_max）、旧長期損害は段、合計の上限 total_max・1円未満切り上げ */
    quake: {
      quake_max: 50000,
      old_long: { steps: [{ upto: 10000, num: 1, den: 1, add: 0 }, { upto: 20000, num: 1, den: 2, add: 5000 }], flat: 15000 },
      total_max: 50000
    },

    /* 算出所得税額の速算表（冊子 p.55 の令和8年分の年末調整のための算出所得税額の速算表）max は「以下」・rate は % */
    tax: [
      { max: 1950000, rate: 5, sub: 0 },
      { max: 3300000, rate: 10, sub: 97500 },
      { max: 6950000, rate: 20, sub: 427500 },
      { max: 9000000, rate: 23, sub: 636000 },
      { max: 18000000, rate: 33, sub: 1536000 },
      { max: 18050000, rate: 40, sub: 2796000 }
    ],                                                      /* 18,050,000円超は年末調整の対象外（p.55 注2） */
    taxable_unit: 1000,                                     /* 課税給与所得金額の1,000円未満切り捨て（p.38・p.55 注1） */

    /* 復興特別所得税を含む年調年税額（冊子 p.37・p.39 の (3)）年調所得税額×102.1%・100円未満切り捨て */
    fukko: { num: 1021, den: 1000 },
    nenzei_unit: 100,

    /* 住宅借入金等特別控除の所得要件（冊子 p.30 の 2）令和4年1月1日以後の居住は2,000万円以下、それより前は3,000万円以下、特例居住用家屋などは1,000万円以下 */
    /* 所得要件は申告の income_limit（1,000万・2,000万・3,000万）で受ける。無い時の既定 2,000万（冊子 p.30 の 2 と注） */
    housing: { limits: [10000000, 20000000, 30000000], default_limit: 20000000 },

    /* 年末調整をしない人の源泉徴収票に書く「源泉控除対象配偶者」「源泉控除対象親族」（手引 p.12 の用語(1)・(5)） */
    gensen: { self_income_max: 9000000, spouse_income_max: 950000, tokutei_income_max: 1000000 }
  };

  var BY_YEAR = { 2026: R8 };

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  var api = {
    VERSION: VERSION,
    /* 年の定数の写しを返す（無い年は null） */
    forYear: function (y) { y = Number(y); return Object.prototype.hasOwnProperty.call(BY_YEAR, y) ? copy(BY_YEAR[y]) : null; },
    years: function () { return Object.keys(BY_YEAR).map(Number); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollYearEndRates = api;
})(typeof window !== 'undefined' ? window : this);
