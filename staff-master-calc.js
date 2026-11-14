/* staff-master-calc.js — 職員マスタ（staff-master.html）の算出・日付正規化・CSV・取込マッピング
   ─────────────────────────────────────────────────────────────────────
   役割（凍結仕様 v1 §1）
     ・派生値（年齢・勤続・離職率・構成比）は保存せず、基準日 asOf を渡してここで毎回計算する
     ・日付は 'YYYY-MM-DD' 文字列を {y,m,d} に分解した整数演算だけで扱う（new Date() の
       タイムゾーンずれを踏まない。JST を要するのは today() だけ）
     ・旧スプレッドシート「職員一覧」の1行をアプリの項目へ写す（判定できないものは埋めずに issues へ）
   公開API（凍結。名前・引数・戻り値を変えない）
     StaffCalc.ymd / normDate / toWareki / today / age / tenure / statusOf / headAt / leavers / turnover
     StaffCalc.period / averageTenureYears / averageAge / composition
     StaffCalc.belongsTo / siteRatios / ratioTotal / siteStats（事業所別の集計・兼務比率）
     StaffCalc.normCorp / setCorp / corp（法人設定＝使う事業所・厨房の兼務先と比率）
     StaffCalc.normName / normKana / parseCsv / toCsv
     StaffCalc.LABELS / ENUMS / setEnums / visibleEnum / mapLegacyRow / diffFields
     StaffCalc.COMMITTEE_DEFAULTS / COMMITTEE_ROLES / COMMITTEE_KINDS / setCommittees / committees / committeeOf / committeesOf / committeeMembers / committeeStats（委員会と構成員）
   前提・注意
     ・依存ゼロ。ブラウザ（iPad Safari）と node の両方で動く。ES2018 以下の構文だけを使う
     ・console 呼び出しをこのファイルに置かない（個人情報がログに出る経路を作らない）
     ・在籍ステータスは列で持たず退職日から導出する（凍結仕様 §0）。休職は真偽列 onLeave
     ・mapLegacyRow の issues は {key, reason} の配列（画面は key で欄を指して赤く出せる）
     ・配列項目（qualsJson / emergencyJson）はクライアント側では「配列」で持つ。
       JSON 文字列化は GAS 側の責務（list は配列に復元して返す契約）
   ────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var VERSION = '2026-11-14';

  /* ── 日付の下ごしらえ（すべて整数演算） ───────────────────────── */

  var RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function lastDay(y, m) {
    if (m === 2) return isLeap(y) ? 29 : 28;
    if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
    return 31;
  }

  /* 'YYYY-MM-DD' → {y,m,d}。書式・実在しない日付は null（呼び手は「—」を出す） */
  function ymd(s) {
    if (typeof s !== 'string') return null;
    var m = RE_ISO.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > lastDay(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  /* 1970-01-01 起点の通日（Howard Hinnant の days_from_civil。Date を使わない） */
  function daysFromCivil(y, m, d) {
    var yy = y - (m <= 2 ? 1 : 0);
    var era = Math.floor(yy / 400);
    var yoe = yy - era * 400;                                   /* [0,399] */
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  /* 通日 → {y,m,d}（civil_from_days） */
  function civilFromDays(z) {
    var zz = z + 719468;
    var era = Math.floor(zz / 146097);
    var doe = zz - era * 146097;                                /* [0,146096] */
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function iso(o) {
    if (!o) return null;
    return o.y + '-' + pad2(o.m) + '-' + pad2(o.d);
  }

  function daysOf(s) {
    var o = ymd(s);
    return o ? daysFromCivil(o.y, o.m, o.d) : null;
  }

  function addDaysIso(s, n) {
    var d = daysOf(s);
    if (d === null) return null;
    return iso(civilFromDays(d + n));
  }

  function isDate(s) { return ymd(s) !== null; }

  /* 今日（JST）。UTC の通日に +9時間ぶんを足して求める＝端末のタイムゾーン設定に左右されない */
  function today() {
    var ms = Date.now() + 9 * 3600 * 1000;
    return iso(civilFromDays(Math.floor(ms / 86400000)));
  }

  function round(x, digits) {
    var p = Math.pow(10, digits);
    /* 浮動小数の 0.5 落ち（例 1.005*100 = 100.49999…）を1ulp ぶん持ち上げてから丸める */
    return Math.round((x * p) * (1 + Number.EPSILON)) / p;
  }

  /* ── 文字列の下ごしらえ ────────────────────────────────────────── */

  var RE_SPACE = /[\s　 ]/g;

  function nfkc(s) {
    var t = String(s == null ? '' : s);
    return t.normalize ? t.normalize('NFKC') : t;
  }

  function trim(s) { return String(s == null ? '' : s).replace(/^[\s　]+|[\s　]+$/g, ''); }

  /* 名寄せ用。NFKC・空白全除去・小文字 */
  function normName(s) {
    return nfkc(s).replace(RE_SPACE, '').toLowerCase();
  }

  /* 名寄せ用。NFKC・ひらがな→カタカナ・空白全除去 */
  function normKana(s) {
    return nfkc(s).replace(/[ぁ-ゖ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) + 0x60);
    }).replace(RE_SPACE, '');
  }

  /* 表示・保存用のフリガナ。カタカナに寄せるが姓名の区切り（半角スペース1つ）は残す */
  function toKanaField(s) {
    return nfkc(s).replace(/[ぁ-ゖ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) + 0x60);
    }).replace(/[\s　 ]+/g, ' ').replace(/^ | $/g, '');
  }

  /* ダッシュ類（NFKC で吸収されないもの）を半角ハイフンへ寄せる */
  function normDash(s) {
    return String(s == null ? '' : s).replace(/[‐-―−ー－]/g, '-');
  }

  /* ── 日付の正規化（取込と入力欄で共用・design-db.md §6-2） ────── */

  var ERA_BASE = { M: 1868, T: 1912, S: 1926, H: 1989, R: 2019 };
  var ERA_JA = { '明治': 'M', '大正': 'T', '昭和': 'S', '平成': 'H', '令和': 'R' };

  var RE_WEST = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/;
  /* 元号の記号は小文字でも受ける（s15.4.3 / r8.9.16）。人は小文字で打つ。
     ★照合したあとは必ず大文字へ寄せてから ERA_BASE を引くこと（下の toUpperCase）。 */
  var RE_WAREKI = /^([MTSHRmtshr]|明治|大正|昭和|平成|令和)\s*(\d{1,2}|元)[\.\/\-年](\d{1,2})[\.\/\-月](\d{1,2})日?$/;
  var RE_SERIAL = /^\d{5}$/;
  var RE_YMD8 = /^(\d{4})(\d{2})(\d{2})$/;

  /* 妥当性（月日の実在＋1900〜上限年）。範囲外は null を返し、呼び手が「要確認」で止める。
     ★既定の上限は「翌年」。職員の生年月日・入社日は先の日付にならないので、
       3025 のような打ち間違いをここで止める。
     ★aheadYears で上限を延ばせる（2026-09-16 追加）。介護保険の認定有効期間は
       更新で最長48か月＝4年先の終了日が実在するため、入居調整アプリはこれを使う。
       既定値は変えていないので、職員マスタの挙動は1文字も変わらない。 */
  function inRange(y, m, d, aheadYears) {
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > lastDay(y, m)) return false;
    var ahead = (typeof aheadYears === 'number' && aheadYears >= 0) ? Math.floor(aheadYears) : 1;
    var maxY = +today().slice(0, 4) + ahead;
    return y >= 1900 && y <= maxY;
  }

  function build(y, m, d, aheadYears) {
    if (!inRange(y, m, d, aheadYears)) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /* '2025/10/27' 'R7.10.27' '令和7年10月27日' '45957'（シリアル）'20251027' 等 → 'YYYY-MM-DD' */
  function normDate(raw, opts) {
    var ahead = (opts && typeof opts.aheadYears === 'number') ? opts.aheadYears : undefined;
    var s = normDash(nfkc(raw)).replace(/^[\s　]+|[\s　]+$/g, '');
    if (s === '') return null;

    /* 途中の空白（'R 8. 9. 10'）と末尾の「生」（'昭和55年4月3日生'）を落としてから照合する */
    s = s.replace(RE_SPACE, '').replace(/生$/, '');
    if (s === '') return null;

    if (RE_SERIAL.test(s)) {                                    /* Excel/Sheets のシリアル値 */
      var base = daysFromCivil(1899, 12, 30);
      var o = civilFromDays(base + parseInt(s, 10));
      return build(o.y, o.m, o.d, ahead);
    }

    var m = RE_WEST.exec(s);
    if (m) return build(+m[1], +m[2], +m[3], ahead);

    m = RE_WAREKI.exec(s);
    if (m) {
      var era = ERA_JA[m[1]] || String(m[1]).toUpperCase();
      var b = ERA_BASE[era];
      if (!b) return null;
      var n = (m[2] === '元') ? 1 : parseInt(m[2], 10);
      if (!(n >= 1)) return null;
      return build(b + n - 1, +m[3], +m[4], ahead);
    }

    m = RE_YMD8.exec(s);
    if (m) return build(+m[1], +m[2], +m[3], ahead);

    return null;
  }

  /* ── 和暦の読み下し（入力の確認用。保存する値は常に 'YYYY-MM-DD'） ── */

  /* 改元日（グレゴリオ暦）。新しい元号から順に見て、最初に「始まり以降」に当たったものを採る */
  var ERA_START = [
    { name: '令和', y: 2019, m: 5, d: 1 },
    { name: '平成', y: 1989, m: 1, d: 8 },
    { name: '昭和', y: 1926, m: 12, d: 25 },
    { name: '大正', y: 1912, m: 7, d: 30 },
    { name: '明治', y: 1868, m: 1, d: 25 }
  ];

  /* 'YYYY-MM-DD' → '令和8年9月10日'（元号の1年目は「元年」）。明治より前・読めない値は null */
  function toWareki(s) {
    var o = ymd(s);
    if (!o) return null;
    var day = daysFromCivil(o.y, o.m, o.d);
    for (var i = 0; i < ERA_START.length; i++) {
      var e = ERA_START[i];
      if (day < daysFromCivil(e.y, e.m, e.d)) continue;
      var n = o.y - e.y + 1;                                    /* 改元年は前の元号と同じ西暦なので引き算だけで足りる */
      return e.name + (n === 1 ? '元' : n) + '年' + o.m + '月' + o.d + '日';
    }
    return null;
  }

  /* ── 年齢・勤続（design-db.md §3） ─────────────────────────────── */

  /* 満年齢。2/29 生まれは平年 2/28 に加齢する（年齢計算ニ関スル法律の「誕生日前日満了」） */
  function age(birth, asOf) {
    var b = ymd(birth);
    var a = ymd(asOf || today());
    if (!b || !a) return null;
    if (daysFromCivil(b.y, b.m, b.d) > daysFromCivil(a.y, a.m, a.d)) return null;
    var n = a.y - b.y;
    var bm = b.m, bd = b.d;
    if (bm === 2 && bd === 29 && !isLeap(a.y)) bd = 28;
    if (a.m < bm || (a.m === bm && a.d < bd)) n -= 1;
    return n;
  }

  /* 勤続（両端含む）。to が空なら asOf まで。入社日が未来なら null */
  function tenure(from, to, asOf) {
    var h = ymd(from);
    if (!h) return null;
    var endStr = (to && isDate(to)) ? to : (asOf || today());
    var e = ymd(endStr);
    if (!e) return null;
    var hDays = daysFromCivil(h.y, h.m, h.d);
    var eDays = daysFromCivil(e.y, e.m, e.d);
    if (eDays < hDays) return null;

    /* 退職日は在籍最終日なので、翌日を「含まない終端」に置き換えて数える */
    var x = civilFromDays(eDays + 1);
    var months = (x.y - h.y) * 12 + (x.m - h.m);
    if (x.d < h.d) months -= 1;                                 /* 応当日が未到来（民法143条2項） */
    if (months < 0) months = 0;
    var years = Math.floor(months / 12);
    var rem = months % 12;
    var days = eDays + 1 - hDays;                               /* 在籍日数（両端含む） */
    return {
      years: years,
      months: rem,
      text: years + '年' + rem + 'ヶ月',
      days: days,
      decimal: round(days / 365.25, 2)                          /* 集計用。うるう年を平均で吸収 */
    };
  }

  /* ── 在籍ステータス（退職日から導出・凍結仕様 §0） ─────────────── */

  function statusOf(row, asOf) {
    var a = asOf || today();
    var r = row && row.retireDate ? String(row.retireDate) : '';
    if (isDate(r)) {
      if (r <= a) return 'retired';                             /* 退職日は在籍最終日。翌日から退職済 */
      return 'retiring';                                        /* 未来日＝在職（退職予定） */
    }
    if (row && (row.onLeave === true || row.onLeave === 1 || row.onLeave === '1' || row.onLeave === 'true')) return 'leave';
    return 'active';
  }

  function isActiveAt(row, asOf) { return statusOf(row, asOf) !== 'retired'; }

  /* ── 人数・離職率（design-db.md §4-2） ─────────────────────────── */

  /* d 時点の在籍者数。休職は在籍に数える（status は見ない＝未来の退職予定日を入れた在職者を正しく数える） */
  function headAt(rows, d) {
    if (!rows || !rows.length || !isDate(d)) return 0;
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i] || {};
      var h = s.hireDate ? String(s.hireDate) : '';
      if (!isDate(h) || h > d) continue;
      var r = s.retireDate ? String(s.retireDate) : '';
      if (isDate(r) && r < d) continue;
      n++;
    }
    return n;
  }

  function leavers(rows, from, to) {
    if (!rows || !rows.length || !isDate(from) || !isDate(to)) return 0;
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] && rows[i].retireDate ? String(rows[i].retireDate) : '';
      if (isDate(r) && r >= from && r <= to) n++;
    }
    return n;
  }

  /* 離職率。既定は「期間退職者数 ÷ 平均在籍者数((期首+期末)/2)」。
     rateRef は介護労働安定センター方式（÷期首在籍）の参考値。役員は既定で分母分子から外す */
  function turnover(rows, from, to, opt) {
    var o = opt || {};
    var exOfficer = (o.excludeOfficer === false) ? false : true;
    var list = [];
    var i;
    for (i = 0; rows && i < rows.length; i++) {
      var s = rows[i] || {};
      if (exOfficer && s.employmentType === 'officer') continue;
      list.push(s);
    }
    if (!isDate(from) || !isDate(to) || from > to) {
      return { leavers: 0, avgHead: 0, rate: null, rateRef: null, hires: 0, shortStay: 0 };
    }

    var L = leavers(list, from, to);
    var A;
    if (o.avg === 'daily') {
      var d0 = daysOf(from), d1 = daysOf(to), sum = 0;
      for (var d = d0; d <= d1; d++) sum += headAt(list, iso(civilFromDays(d)));
      A = sum / (d1 - d0 + 1);
    } else {
      A = (headAt(list, from) + headAt(list, to)) / 2;
    }
    var ref = headAt(list, from);

    var hires = 0, shortStay = 0;
    for (i = 0; i < list.length; i++) {
      var h = list[i].hireDate ? String(list[i].hireDate) : '';
      var r = list[i].retireDate ? String(list[i].retireDate) : '';
      if (isDate(h) && h >= from && h <= to) hires++;
      /* 期中入退社＝分母に一度も乗らない人。率を押し上げる要因として脚注に出す */
      if (isDate(h) && isDate(r) && h >= from && r <= to) shortStay++;
    }

    return {
      leavers: L,
      avgHead: round(A, 2),
      rate: A > 0 ? round(L / A * 100, 1) : null,
      rateRef: ref > 0 ? round(L / ref * 100, 1) : null,
      hires: hires,
      shortStay: shortStay
    };
  }

  /* 集計期間。終端が基準日より未来なら基準日で止める（未来分を数えない） */
  function period(kind, y, m, asOf) {
    var a = (asOf && isDate(asOf)) ? asOf : today();
    var from, to;
    if (kind === 'cy') {
      from = y + '-01-01';
      to = y + '-12-31';
    } else if (kind === 'month') {
      var mm = +m;
      if (!(mm >= 1 && mm <= 12)) return null;
      from = y + '-' + pad2(mm) + '-01';
      to = y + '-' + pad2(mm) + '-' + pad2(lastDay(+y, mm));
    } else if (kind === 'fy') {
      from = y + '-04-01';
      to = (+y + 1) + '-03-31';
    } else {
      return null;
    }
    if (to > a) to = a;
    return { from: from, to: to };
  }

  function averageTenureYears(rows, asOf) {
    var a = asOf || today();
    var sum = 0, n = 0;
    for (var i = 0; rows && i < rows.length; i++) {
      if (!isActiveAt(rows[i], a)) continue;
      var t = tenure(rows[i].hireDate, '', a);
      if (!t) continue;
      sum += t.decimal; n++;
    }
    return n ? round(sum / n, 1) : null;
  }

  function averageAge(rows, asOf) {
    var a = asOf || today();
    var sum = 0, n = 0;
    for (var i = 0; rows && i < rows.length; i++) {
      if (!isActiveAt(rows[i], a)) continue;
      var v = age(rows[i].birthDate, a);
      if (v === null) continue;
      sum += v; n++;
    }
    return n ? round(sum / n, 1) : null;
  }

  /* ── 事業所別の集計・兼務比率 ─────────────────────────────────────
     数え方は実人数（本人裁定）。施設20%・訪問80%の人は「施設で1名」かつ「訪問で1名」に
     数え、各事業所の合計は全体の在職者数と一致しない（案分すると実配置の人数が読めなくなる）。
     兼務比率は入力・保存・表示のためだけに持ち、集計には当面使わない。 */

  var SITE_CODES  = ['facility', 'visit', 'day', 'cm'];
  var SITE_ACTIVE = ['facility', 'visit', 'day'];               /* 居宅は休止中のため入力欄の既定から外す */
  var SITE_COL    = { facility: 'siteFacility', visit: 'siteVisit', day: 'siteDay', cm: 'siteCm' };
  var SITE_LABEL  = { facility: '施設', visit: '訪問', day: '通所', cm: '居宅' };
  var KITCHEN_SITES = { facility: 50, day: 50 };                /* 厨房は施設:通所 = 1:1 の兼務（本人裁定） */

  /* ── 事業所の区分の名前（施設情報の corpSettings.siteLabels・第6段 SM-02・代表者の決定 2026-11-14）──
     差し替えるのは名前だけ。コード（SITE_CODES の4つ）・保存の列（真偽の4列）・保存済みの値は変えない。
     4つ全部が 1〜6 字の文字・互いに別の名前・CSV の見出しの語（SITE_LABEL_RESERVED・「厨房」を含む）とほかの区分の今の名前に重ならない時だけ当て、
     1つでも崩れていれば丸ごと今の名前に戻す。
     SITE_LABEL・LABELS・ENUMS.primarySite は公開API が同じ実体を指しているので、中身だけを入れ替える */
  var SITE_LABEL_DEF = { facility: '施設', visit: '訪問', day: '通所', cm: '居宅' };
  var SITE_LABEL_KEY = '';
  /* 名前に使えない語（反証レビュー 2026-11-14）。CSV の取り込みは見出しの語で列を決めるので、区分の名前が別の列の見出しと
     同じだと、書き出した CSV を読み戻した時に所属の印が落ちる・主たる事業所を取り違える。並べるのは画面の取り込みの別名
     （staff-master.js の HEADER_ALIAS の区分以外の語）・書き出しの見出し・旧い表の取り込み（mapLegacyRow）が読む語。
     画面の別名が増えたらここにも足す（check/unit/staff_site_labels_test.js が突き合わせる） */
  var SITE_LABEL_RESERVED = ['no', 'no.', '職員no', '旧no', '職員id', 'id', '氏名', '名前', '姓名', 'フリガナ', 'ふりがな', 'カナ',
    '性別', '生年月日', '入職日', '入社日', '退職日', '退職', '職種', '役職', '雇用', '雇用形態', '雇用区分', '形態', '勤務形態',
    '主たる事業所', '事業所', '連絡先', '電話', '電話番号', '携帯', '住所', '緊急連絡先', '介護就職', '資格', '資格取得日',
    '雇用保険番号', '備考', '兼務比率', '休職', '休職中', '所属委員会', '年齢', '勤続年数', '介護福祉士', '厨房'];
  function normSiteLabels(o) {
    if (!o || typeof o !== 'object' || Object.prototype.toString.call(o) === '[object Array]') return null;
    var ks = Object.keys(o), out = {}, seen = {}, i;
    if (ks.length !== SITE_CODES.length) return null;
    for (i = 0; i < SITE_CODES.length; i++) {
      var v = o[SITE_CODES[i]];
      if (typeof v !== 'string') return null;
      v = v.trim();
      /* 1〜6 字・記号や制御文字・空白を含まない（見出し・CSV の列名・紙の欄に入るため） */
      if (!v || v.length > 6 || /[\s<>&"'`=,;:\/\\\u0000-\u001f\u007f]/.test(v)) return null;
      var nv = normName(v);
      if (seen[nv] || SITE_LABEL_RESERVED.indexOf(nv) >= 0) return null;
      /* ほかの区分の今の名前（旧い CSV・旧い表の見出し）は使えない（旧い名前の列が別の区分に結ばれるため）。自分の区分の今の名前は使える */
      for (var j = 0; j < SITE_CODES.length; j++) if (j !== i && normName(SITE_LABEL_DEF[SITE_CODES[j]]) === nv) return null;
      seen[nv] = true;
      out[SITE_CODES[i]] = v;
    }
    return out;
  }
  /* 当てる。名前が変わった時だけ true（画面は true の時だけ描き直す） */
  function setSiteLabels(o) {
    var n = normSiteLabels(o) || SITE_LABEL_DEF;
    var key = (n === SITE_LABEL_DEF) ? '' : JSON.stringify(n);
    if (key === SITE_LABEL_KEY) return false;
    SITE_LABEL_KEY = key;
    for (var i = 0; i < SITE_CODES.length; i++) {
      var c = SITE_CODES[i];
      SITE_LABEL[c] = n[c];
      LABELS[SITE_COL[c]] = n[c];
      ENUMS.primarySite[c] = n[c];
    }
    return true;
  }

  /* ── 法人設定（2026-10-11・監査10月版 第2版 職員マスタ）────────────────
     使う事業所（SITE_ACTIVE）と厨房の兼務先・比率（KITCHEN_SITES）を、サーバー（staff-api.gs の meta.corpJson）から
     差し替えられるようにする。★既定は上の2つの値そのもの＝設定を一度も保存していなければ、画面も紙も今と同じ。
     ・事業所のコード（SITE_CODES の4つ）とシートの列は変えない。差し替えるのは「どれを使うか」と「厨房の数え方」だけ
     ・SITE_ACTIVE・KITCHEN_SITES は公開API（StaffCalc.SITE_ACTIVE 等）が同じ実体を指しているので、中身だけを入れ替える
     ・厨房の兼務先を変えると、過去の期間の事業所別の人数も新しい設定で数え直す（履歴は持たない・本人裁定 2026-10-11）
     ・規則は staff-api.gs の validateCorp_ と同じ（両方を同じ試験で突き合わせる） */
  var CORP_DEFAULT = { activeSites: SITE_ACTIVE.slice(), kitchenSites: { facility: 50, day: 50 } };
  var CORP_KEYS = ['activeSites', 'kitchenSites'];

  /* 形と中身を確かめて整えた写しを返す。1つでも外れれば null（中途半端に差し替えない） */
  function normCorp(o) {
    if (!o || typeof o !== 'object' || Object.prototype.toString.call(o) === '[object Array]') return null;
    var ks = Object.keys(o), i;
    for (i = 0; i < ks.length; i++) if (CORP_KEYS.indexOf(ks[i]) < 0) return null;
    var a = o.activeSites, k = o.kitchenSites;
    if (Object.prototype.toString.call(a) !== '[object Array]' || !a.length || a.length > SITE_CODES.length) return null;
    var seen = {};
    for (i = 0; i < a.length; i++) {
      if (typeof a[i] !== 'string' || SITE_CODES.indexOf(a[i]) < 0 || seen[a[i]]) return null;
      seen[a[i]] = true;
    }
    if (!k || typeof k !== 'object' || Object.prototype.toString.call(k) === '[object Array]') return null;
    var kk = Object.keys(k), sum = 0;
    if (!kk.length) return null;
    for (i = 0; i < kk.length; i++) {
      var v = k[kk[i]];
      if (SITE_CODES.indexOf(kk[i]) < 0 || !seen[kk[i]]) return null;       /* 兼務先は使う事業所の中から */
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 1 || v > 100) return null;
      sum += v;
    }
    if (sum !== 100) return null;
    var out = { activeSites: [], kitchenSites: {} };
    for (i = 0; i < SITE_CODES.length; i++) {                                /* 並びは SITE_CODES の順にそろえる */
      if (seen[SITE_CODES[i]]) out.activeSites.push(SITE_CODES[i]);
      if (Object.prototype.hasOwnProperty.call(k, SITE_CODES[i])) out.kitchenSites[SITE_CODES[i]] = k[SITE_CODES[i]];
    }
    return out;
  }
  /* 差し替え。null・undefined は既定へ戻す。形が違えば何もしないで false（今の値のまま動かす） */
  function setCorp(o) {
    var c = (o === null || o === undefined) ? normCorp(CORP_DEFAULT) : normCorp(o);
    if (!c) return false;
    var i, kk = Object.keys(KITCHEN_SITES);
    SITE_ACTIVE.length = 0;
    for (i = 0; i < c.activeSites.length; i++) SITE_ACTIVE.push(c.activeSites[i]);
    for (i = 0; i < kk.length; i++) delete KITCHEN_SITES[kk[i]];
    kk = Object.keys(c.kitchenSites);
    for (i = 0; i < kk.length; i++) KITCHEN_SITES[kk[i]] = c.kitchenSites[kk[i]];
    return true;
  }
  /* いまの値の写し（画面の欄を作る・既定かどうかを見る用） */
  function corp() {
    var out = { activeSites: SITE_ACTIVE.slice(), kitchenSites: {} }, kk = Object.keys(KITCHEN_SITES);
    for (var i = 0; i < kk.length; i++) out.kitchenSites[kk[i]] = KITCHEN_SITES[kk[i]];
    return out;
  }
  function corpDefault() { return normCorp(CORP_DEFAULT); }

  /* 真偽列の読み取り。statusOf の onLeave と同じ寛容さ（保存経路で 1 や '1' に化けるため） */
  function isOn(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
  }

  /* 事業所4列がすべて偽で、主たる事業所が厨房＝施設と通所の兼務として導出する行 */
  function isKitchenDerived(row) {
    if (!row || typeof row !== 'object') return false;
    for (var i = 0; i < SITE_CODES.length; i++) {
      if (isOn(row[SITE_COL[SITE_CODES[i]]])) return false;     /* 1つでも印があれば入力値が正 */
    }
    return row.primarySite === 'kitchen';
  }

  function belongsTo(row, site) {
    if (!row || typeof row !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(SITE_COL, site)) return false;
    if (isOn(row[SITE_COL[site]])) return true;
    if (!isKitchenDerived(row)) return false;
    return Object.prototype.hasOwnProperty.call(KITCHEN_SITES, site);
  }

  /* 兼務比率 {facility:20, visit:80}。所属していない事業所のキーは落とす（表示の食い違いを作らない） */
  function siteRatios(row) {
    var out = {}, i;
    var src = row ? row.siteRatiosJson : null;
    if (src && typeof src === 'object' && Object.prototype.toString.call(src) !== '[object Array]') {
      var ks = Object.keys(src);
      for (i = 0; i < ks.length; i++) {
        if (!belongsTo(row, ks[i])) continue;
        var v = src[ks[i]];
        if (v === null || v === undefined || typeof v === 'boolean') continue;
        if (typeof v === 'string' && trim(v) === '') continue;
        var n = Number(v);
        if (!isFinite(n)) continue;                             /* 数値にできない値は落とす */
        n = Math.round(n);
        /* 0〜100 の外は 0/100 へ丸めずに落とす。サーバーは 0〜100 の整数しか受け付けないので、
           範囲外の値はシートを直接いじった等の異常。100 に丸めると合計の注意も出ず異常が隠れる */
        if (n < 0 || n > 100) continue;
        out[ks[i]] = n;
      }
    }
    if (!Object.keys(out).length && isKitchenDerived(row)) {
      var kk = Object.keys(KITCHEN_SITES);
      for (i = 0; i < kk.length; i++) out[kk[i]] = KITCHEN_SITES[kk[i]];
    }
    return out;
  }

  function ratioTotal(row) {
    var r = siteRatios(row), ks = Object.keys(r), sum = 0;
    for (var i = 0; i < ks.length; i++) sum += r[ks[i]];
    return sum;
  }

  /* 事業所1つぶんの行。人数は headAt、離職率は turnover をそのまま使う（式を二重に持たない） */
  function siteStatRow(site, label, sub, from, to, asOf, opt) {
    var t = turnover(sub, from, to, opt);
    return {
      site: site,
      label: label,
      head: headAt(sub, asOf),
      leavers: t.leavers,
      rate: t.rate,
      rateRef: t.rateRef,
      avgHead: t.avgHead,
      hires: t.hires
    };
  }

  /* 事業所別の集計。最後にどの事業所にも属さない行を「事業所の指定なし」で足す。
     元の rows は書き換えず、部分集合を新しい配列に集めてから渡す */
  function siteStats(rows, from, to, asOf, opt) {
    var a = asOf || today();
    var list = (rows && rows.length) ? rows : [];
    var out = [], i, j;
    for (i = 0; i < SITE_CODES.length; i++) {
      var code = SITE_CODES[i];
      var sub = [];
      for (j = 0; j < list.length; j++) if (belongsTo(list[j], code)) sub.push(list[j]);
      out.push(siteStatRow(code, SITE_LABEL[code], sub, from, to, a, opt));
    }
    var rest = [];
    for (j = 0; j < list.length; j++) {
      var hit = false;
      for (i = 0; i < SITE_CODES.length; i++) {
        if (belongsTo(list[j], SITE_CODES[i])) { hit = true; break; }
      }
      if (!hit) rest.push(list[j]);
    }
    out.push(siteStatRow('', '事業所の指定なし', rest, from, to, a, opt));
    return out;
  }

  /* ── ラベル・語彙 ──────────────────────────────────────────────── */

  var LABELS = {
    id: '職員ID',
    rev: '版',
    updatedAt: '更新日時',
    updatedBy: '更新元',
    legacyNo: '職員No',
    name: '氏名',
    kana: 'フリガナ',
    birthDate: '生年月日',
    gender: '性別',
    phone: '連絡先',
    address: '住所',
    emergencyJson: '緊急連絡先',
    employmentType: '雇用区分',
    jobTitle: '職種',
    position: '役職',
    siteFacility: '施設',
    siteVisit: '訪問',
    siteDay: '通所',
    siteCm: '居宅',
    primarySite: '主たる事業所',
    workStyle: '勤務形態',
    hireDate: '入職日',
    retireDate: '退職日',
    onLeave: '休職中',
    careStartDate: '介護就職',
    qualsJson: '資格',
    empInsNo: '雇用保険番号',
    note: '備考'
  };

  var ENUMS = {
    employmentType: {
      regular: '正社員',
      contract: '契約社員',
      part: 'パート',
      officer: '役員兼使用人',
      temp: '臨時'
    },
    primarySite: {
      facility: '施設',
      visit: '訪問',
      day: '通所',
      cm: '居宅',
      kitchen: '厨房'
    },
    workStyle: {
      full_ded: '常勤・専従',
      full_con: '常勤・兼務',
      part_ded: '非常勤・専従',
      part_con: '非常勤・兼務'
    },
    gender: { M: '男', F: '女' },
    qualCodes: {
      cw: '介護福祉士',
      jitsumu: '実務者研修',
      shonin: '初任者研修',
      helper2: 'ヘルパー2級',
      helper1: 'ヘルパー1級',
      kiso: '基礎研修',
      cm: '介護支援専門員',
      nurse: '看護師',
      anurse: '准看護師',
      pt: '理学療法士',
      ot: '作業療法士',
      sw: '社会福祉士',
      swshuji: '社会福祉主事',
      pharm: '薬剤師',
      dietitian: '管理栄養士',
      cook: '調理師',
      none: '無資格',
      other: 'その他'
    }
  };

  /* ── 選択肢マスタ（サーバー保存の雇用区分・資格／spec-enums.md §6）─────────
     上の ENUMS は「サーバーが無い・古い」ときの既定値としてそのまま残す。
     起動時に getEnums が取れたら setEnums で差し替える。並び順と hidden は
     ENUM_LISTS が覚える（ENUMS は {コード:名前} なので順序と非表示を持てない）。 */
  var ENUM_LISTS = { employmentType: null, qualCodes: null };

  /* サーバーの選択肢を反映する。obj[群] が [{code,label,hidden}] の配列のときだけ差し替える。
     hidden のものも ENUMS には入れる（既存データの表示に要る）。
     空配列は無視する＝応答が壊れても画面の選択肢を失わない（安全側に倒す）。
     戻り値: 差し替えた群の数 */
  function setEnums(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    var groups = ['employmentType', 'qualCodes'], applied = 0;
    for (var g = 0; g < groups.length; g++) {
      var key = groups[g], src = obj[key];
      if (!Object.prototype.hasOwnProperty.call(ENUMS, key) || !src || !src.length) continue;
      if (Object.prototype.toString.call(src) !== '[object Array]') continue;
      var dict = {}, list = [];
      for (var i = 0; i < src.length; i++) {
        var it = src[i];
        if (!it || typeof it !== 'object') continue;
        var code = trim(it.code);
        if (!code || Object.prototype.hasOwnProperty.call(dict, code)) continue;   /* 同じコードは先勝ち */
        var label = trim(it.label) || code;                                        /* 名前が無ければコードを出す */
        dict[code] = label;
        list.push({ code: code, label: label, hidden: it.hidden === true });
      }
      if (!list.length) continue;
      ENUMS[key] = dict;
      ENUM_LISTS[key] = list;
      applied++;
    }
    return applied;
  }

  /* 画面の選択肢を作るための [[コード, 名前], …]。hidden は落とす。
     サーバーから受け取っていない群（性別・主たる事業所・勤務形態）は ENUMS の並びをそのまま出す。 */
  function visibleEnum(group) {
    var list = Object.prototype.hasOwnProperty.call(ENUM_LISTS, group) ? ENUM_LISTS[group] : null;
    var out = [], i;
    if (list) {
      for (i = 0; i < list.length; i++) if (!list[i].hidden) out.push([list[i].code, list[i].label]);
      return out;
    }
    var dict = ENUMS[group];
    if (!dict) return out;
    var ks = Object.keys(dict);
    for (i = 0; i < ks.length; i++) out.push([ks[i], dict[ks[i]]]);
    return out;
  }

  /* 在職者だけの構成比。未設定は「未設定」でまとめ、件数の多い順に並べる */
  function composition(rows, key) {
    var a = today();
    var map = {}, order = [], total = 0;
    for (var i = 0; rows && i < rows.length; i++) {
      if (!isActiveAt(rows[i], a)) continue;
      var raw = rows[i][key];
      var v = (raw === null || raw === undefined) ? '' : String(raw).replace(/^[\s　]+|[\s　]+$/g, '');
      var dict = ENUMS[key];
      var label = v === '' ? '未設定' : ((dict && dict[v]) ? dict[v] : v);
      if (!Object.prototype.hasOwnProperty.call(map, label)) { map[label] = 0; order.push(label); }
      map[label]++;
      total++;
    }
    order.sort(function (x, y) {
      if (map[y] !== map[x]) return map[y] - map[x];
      if (x === '未設定') return 1;                             /* 同数なら「未設定」を後ろへ */
      if (y === '未設定') return -1;
      return x < y ? -1 : (x > y ? 1 : 0);
    });
    var out = [];
    for (var j = 0; j < order.length; j++) {
      out.push({ label: order[j], count: map[order[j]], pct: total ? round(map[order[j]] / total * 100, 1) : 0 });
    }
    return out;
  }

  /* ── 委員会と構成員（spec-committee.md §1・§4） ─────────────────
     既定6件は熊本市の集団指導資料から起こした確定値。名称・対象・頻度・根拠・
     未実施の影響・注記は実地指導でそのまま見せるので、ここで言い換えない。
     サーバー（meta の committeesJson）が取れたら setCommittees で差し替える。
     職員の所属は staff の committeesJson 1列だけに持つ（同じ事実を2か所に置かない）。
     ★未実施の影響が「—」の委員会（感染対策・運営懇談会）は penalty を空文字にする。
       空でないことを「減算の要件がある」の判定に使うため（§4）。
     ★6件の値は staff-api.gs の COMMITTEE_DEFAULTS（サーバーのマスタ）と1字一句そろえる。
       ずれると、サーバーから受け取れた端末と既定で動く端末で画面の文言が変わる。

     ── startedAt（制度の対象開始月）について（2026-09-23.2 追加）──
     ★e-Gov 法令検索の条文・附則を直接読んで確定した正本。1文字も変えない。
       「確認できず」「定めなし」「規定なし」「要確認」をそれらしい日付で埋めないこと。
     根拠の条文は staff-api.gs の COMMITTEE_DEFAULTS の頭に書いた注記が正本
       （居宅基準 第30条の2・第37条の2・第31条3項・第104条2項・第103条・第105条の準用リスト／
         第139条の2 は短期入所生活介護の条文であること／附則第2条〜第4条の「第91条＝居宅療養管理指導
         だけが令和9年3月末まで」）。
     ★sites（対象事業所）は 2026-09-23.2 の時点では変えなかったが、2026-09-23.4 に本人の指示で条文どおりに訂正した
       （restraint＝施設だけ／safety＝対象なし）。以後は basis と同じく既定が正（setCommittees で既定から引き直す）。
       ★対象事業所を条文と違う値へ戻さないこと。 */

  var COMMITTEE_DEFAULTS = [
    {
      code: 'abuse',
      label: '虐待防止委員会',
      alias: 'やさしいケア推進チーム',
      kind: 'committee',
      sites: ['facility', 'visit', 'day'],
      freq: '定期的',
      /* ★2026-09-22.5 訂正（e-Gov 法令検索の条文一覧と本文で1件ずつ確認）。
         第104条の2 は「地域との連携等」であって虐待防止ではない。通所介護の虐待防止は
         第105条（準用）が第37条の2 を準用する形。指導指針は条例ではないので「第◯条」という
         単位を持たない（番号自体も実物と食い違っていた）ため、番号を落として文書名だけにする。
         どの項かは url から開いて確かめる。 */
      basis: '居宅基準 第37条の2（訪問）／第105条で準用（通所）／熊本市有料老人ホーム設置運営指導指針',
      url: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_37_2',
      /* 令和3年度改正で第37条の2 が新設（令和3年4月1日施行・令和6年3月31日まで経過措置）。
         減算は令和6年度改定で新設。有料老人ホーム分は熊本市指導指針が根拠で施行日を持たない。 */
      startedAt: '2024年4月から完全義務・減算／2021年4月（令和3年4月）に義務化・経過措置は2024年3月まで。有料老人ホームは熊本市指針が根拠で時期は確認できず',
      siteStartedAt: '',
      penalty: '高齢者虐待防止措置未実施減算（利用者全員1%・発見月から3か月は必ず減算）',
      hasPenalty: true,
      purpose: '減算を避けるため（高齢者虐待防止措置未実施減算）',
      /* ★研修が「年2回以上」なのは特別養護老人ホーム等の施設系。当社3事業所は該当しない */
      training: '訪問介護は年1回以上／通所介護・住宅型は定期的',
      note: '委員会・指針・年1回以上の研修・担当者の設置の4つが揃って要件を満たす',
      todoNote: '',
      inactive: false
    },
    {
      code: 'restraint',
      label: '身体的拘束等適正化委員会',
      alias: 'のびのび生活委員会',
      kind: 'committee',
      /* ★2026-09-23.4 条文どおりに訂正。訪問介護（第23条）・通所介護（第98条）は身体的拘束の原則禁止と記録の義務だけで、
         委員会の定めが無い（「委員会」の語が0回）。委員会を求めるのは熊本市有料老人ホーム設置運営指導指針＝施設だけ。 */
      sites: ['facility'],
      /* ★2026-09-23.7 本人の指示で施設だけの頻度にした。前の文面は RETIRED_DEFAULT_FREQ に控える（サーバーと同じ） */
      freq: '3か月に1回以上',
      /* ★2026-09-22.5 訂正。指導指針は条例ではないので「第◯条」を持たない（abuse と同じ理由）。
         url は熊本市の案内ページ。指針PDFの直リンクは改定のたびにファイル名が変わり切れるため。 */
      basis: '同指導指針',
      url: 'https://www.city.kumamoto.jp/kiji0032329/index.html',
      /* 居宅基準の訪問介護・通所介護には委員会を置く条文が無い（原則禁止と記録の義務だけ）。
         3か月に1回以上の開催は熊本市指導指針で、指針は条例ではないため施行日を持たない。 */
      startedAt: '訪問介護・通所介護は委員会の定めなし（原則禁止と記録の義務のみ）／有料老人ホームは熊本市指針が根拠で時期は確認できず',
      siteStartedAt: '',
      /* ★2026-09-23.6 本人の指示で、施設だけの実態に合わせた（運営懇談会と同じ書き方）。
         身体的拘束廃止未実施減算は施設系・居住系のサービス（令和6年度からは短期入所系・多機能系も）が対象で、訪問介護・通所介護には掛からない。
         住宅型有料老人ホームは施設として介護報酬を算定しないので、これも対象外＝当社3事業所のどれにも減算は無い。
         委員会（3か月に1回以上）・指針・研修は熊本市有料老人ホーム設置運営指導指針が求める＝根拠は同指導指針だけ。 */
      penalty: '',
      hasPenalty: false,
      purpose: '熊本市有料老人ホーム設置運営指導指針による義務',
      training: '定期的',
      note: '担当者は虐待防止委員会の担当者と同一が望ましい（指導指針）',
      todoNote: '',
      inactive: false
    },
    {
      code: 'infection',
      label: '感染対策委員会',
      alias: 'みんなの健康守り隊',
      kind: 'committee',
      sites: ['facility', 'visit', 'day'],
      freq: '概ね6か月に1回以上',
      /* ★2026-09-22.5 訂正。訪問介護の感染対策委員会は第31条【第3項】（第2項は設備・備品の
         衛生管理）。通所介護の第104条第2項は正しいのでそのまま。指導指針の項番号は落とす。 */
      basis: '居宅基準 第31条3項（訪問）／第104条2項（通所）／同指導指針',
      url: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_104',
      /* 令和3年度改正で第31条3項（訪問）・第104条2項（通所）が新設（令和3年4月1日施行・
         令和6年3月31日まで経過措置）。感染対策だけを対象にした減算は見つからなかった。 */
      startedAt: '2024年4月から完全義務／2021年4月（令和3年4月）に義務化・経過措置は2024年3月まで。専用の減算は確認できず',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（運営基準）',
      training: '定期的',
      drill: '定期的（BCP の研修・訓練と一体実施可）',
      note: 'BCP の研修・訓練と一体的に実施してよい',
      todoNote: '',
      inactive: false
    },
    {
      code: 'safety',
      label: '利用者の安全並びに介護サービスの質の確保及び職員の負担軽減に資する方策を検討するための委員会',
      alias: 'みらいの職場づくりチーム',
      kind: 'committee',
      /* ★2026-09-23.4 条文どおりに訂正。第139条の2 は第九章 短期入所生活介護の条文で、訪問介護・通所介護には規定が無い
         （第105条の準用リストにも入っていない）。住宅型有料老人ホーム（特定施設の指定なし）も熊本市の指導指針に定めが無い。 */
      sites: [],
      freq: '定期的',
      basis: '令和6年度介護報酬改定',
      /* ★対象サービスを確認中のため既定のURLを置かない（下の todo を参照）。 */
      url: '',
      /* 居宅基準 第139条の2 は【短期入所生活介護】の条文で、訪問介護・通所介護の条文ではない。
         附則第2条〜第4条の準用対象にも訪問介護（第4〜42条の2）・通所介護（第92〜109条）は無く、
         経過措置が令和9年3月末まで伸びるのは第91条＝居宅療養管理指導だけ。 */
      startedAt: '訪問介護・通所介護は規定なし（居宅基準 第139条の2 は短期入所生活介護の条文）／対象となる種別は2024年4月・経過措置は2027年3月まで',
      siteStartedAt: '',
      penalty: '令和9年4月1日から義務（経過措置は令和9年3月31日まで）',
      hasPenalty: false,
      purpose: '法令上の義務（令和9年4月1日から）',
      note: '管理者とケアを行う職種を含む幅広い職種で構成することが望ましい',
      /* ★2026-09-22.5 で「要確認」を付けた。一次情報を3方向から当たっても、当社3事業所が対象に
         含まれる根拠が見つからなかったため。
         ①e-Gov 法令の附則（令和6年1月25日厚労省令第16号 第4条）の準用対象リストに、訪問介護
           （第4〜42条の2）・通所介護（第92〜109条）の条文番号が1つも含まれていない
         ②熊本市の集団指導資料は「共通編」でのみ触れ、訪問介護・通所介護・有料老人ホームの各個別
           資料には記述が無い（有料老人ホーム編の委員会は虐待防止・身体的拘束等適正化・感染対策・
           運営懇談会の4つだけ）
         ③当施設は住宅型で特定施設入居者生活介護の指定を受けていない
         ただし「対象外」と断定はしない。行は消さず、hygiene と同じ「要確認」にして人の確認を促す。 */
      todo: true,
      todoNote: '訪問介護・通所介護・住宅型有料老人ホームが対象に含まれるかを熊本市に確認してください（令和9年度改定で対象が変わる可能性があります）',
      inactive: false
    },
    {
      code: 'kondan',
      label: '運営懇談会',
      alias: 'みんなの暮らし会議',
      kind: 'committee',
      sites: ['facility'],
      freq: '定期的',
      /* ★2026-09-22.5 訂正。指導指針は条例ではないので「第◯条」を持たない（abuse と同じ理由）。 */
      basis: '同指導指針',
      url: 'https://www.city.kumamoto.jp/kiji0032329/index.html',
      /* 根拠が熊本市有料老人ホーム設置運営指導指針だけで、指針は条例ではないため施行日を持たない。 */
      startedAt: '確認できず（熊本市有料老人ホーム設置運営指導指針）',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '熊本市有料老人ホーム設置運営指導指針による義務',
      note: '入居者・家族・設置者・外部の者で構成。定員が少ない等で困難なら代替措置可',
      todoNote: '',
      inactive: false
    },
    {
      code: 'dementia',
      label: '認知症ケアの事例検討・技術的指導会議',
      alias: '寄り添いケア会議',
      kind: 'committee',
      sites: ['day'],
      freq: '定期的',
      basis: '通所介護 認知症加算',
      url: 'https://www.mhlw.go.jp/web/t_doc?dataId=82ab4584&dataType=0&pageNo=1',
      /* 令和6年度改定で通所介護の認知症加算の算定要件に事例検討・技術的指導の会議が加わった。 */
      startedAt: '2024年4月（令和6年度改定）に通所介護 認知症加算の要件へ加わった',
      siteStartedAt: '',
      penalty: '加算を算定する場合に必要（現在は未算定＝既定で対象外）',
      hasPenalty: false,
      purpose: '加算の要件（通所介護 認知症加算）',
      note: '認知症加算を算定する場合に必要。現在は未算定のため対象外',
      todoNote: '',
      inactive: true                                            /* 認知症加算が未算定のうちは対象外（注意も出さない） */
    },
    /* ここから下は委員会ではない体制（spec-committee2.md §2）。同じ一覧で見たいので同居させ、
       kind で分ける。委員会ではないので「委員長・委員」の注意は出さない（§3・committeeStats） */
    {
      code: 'bcp',
      label: '業務継続計画（BCP）',
      alias: 'もしもの備え隊',
      kind: 'plan',
      sites: ['facility', 'visit', 'day'],
      freq: '委員会の設置義務はなし',
      basis: '令和3年度改正（令和6年4月1日から義務）／業務継続計画未策定減算',
      url: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_30_2',
      /* 令和3年度改正で第30条の2 が新設（令和3年4月1日施行・令和6年3月31日まで経過措置）。
         減算は訪問介護が令和7年4月から。通所介護の減算開始日は一次資料で確定できなかった。 */
      startedAt: '2024年4月から完全義務／2021年4月（令和3年4月）に策定義務・経過措置は2024年3月まで。減算は訪問介護が2025年4月から。通所介護の減算開始は要確認',
      siteStartedAt: '',
      penalty: '業務継続計画未策定減算（利用者全員1%・訪問介護と通所介護は令和7年4月1日から適用）',
      hasPenalty: true,
      purpose: '減算を避けるため（業務継続計画未策定減算）',
      training: '定期的',
      drill: '定期的（感染症は感染対策と、災害は非常災害対策の訓練と一体実施可）',
      note: '計画の策定と、計画に従った措置が減算の判定対象。周知・研修・訓練・見直しの有無は減算の要件ではない',
      todoNote: '',
      inactive: false
    },
    {
      code: 'disaster',
      label: '非常災害対策',
      alias: '避難マイスターズ',
      kind: 'plan',
      sites: ['facility', 'day'],                               /* ★訪問介護には計画策定・訓練の定めがない（visit は入れない） */
      freq: '委員会の設置義務はなし',
      basis: '運営基準／消防法施行規則 第3条（消防計画）',
      url: 'https://laws.e-gov.go.jp/law/336M50000008006#Mp-At_3',
      /* 通所介護の非常災害対策は居宅基準の制定当初（平成12年4月1日施行）からある。
         訪問介護には非常災害対策の条文が無い（消防法の防火管理は介護保険の基準とは別の体系）。 */
      startedAt: '通所介護は2000年4月（基準制定当初）から／訪問介護は居宅基準に条文なし（消防法は別の体系）',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（訪問介護には計画策定・訓練の定めなし）',
      training: '定期的に従業者へ周知',
      drill: '避難訓練は年2回以上（消防法施行規則）。実施した内容の記録を残すこと',
      note: '浸水想定区域・土砂災害警戒区域内で市の地域防災計画に定められた施設は、避難確保計画の作成・避難訓練・訓練結果の報告も必要',
      todoNote: '',
      inactive: false
    },
    {
      code: 'hygiene',
      label: '衛生推進者の選任',
      alias: '働く環境の見守り役',
      kind: 'officer',
      sites: ['facility', 'visit', 'day'],
      freq: '委員会の設置義務はなし',
      basis: '労働安全衛生法（介護保険の集団指導資料には記載なし）',
      url: 'https://laws.e-gov.go.jp/law/347AC0000000057#Mp-At_12_2',
      /* 労働安全衛生法 第12条の2（衛生推進者等）は平成元年の改正で新設され平成元年4月1日に施行。 */
      startedAt: '1989年4月（平成元年4月）労働安全衛生法 第12条の2 の新設',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（労働安全衛生法）',
      note: '常時10人以上50人未満の事業場に選任義務。事業場をどう数えるか（3事業所を別々に見るか同一敷地で一体と見るか）で結論が変わるため、労働基準監督署または社会保険労務士への確認が要る',
      todo: true,                                               /* 事業場の数え方で選任義務が変わる＝結論が出るまで「要確認」を出し続ける */
      todoNote: '3事業所がそれぞれ別の事業場に当たるかを労働基準監督署に確認してください（同じ場所なら1事業場、場所が分かれていれば原則別事業場）',
      inactive: false
    },
    /* ── 2026-11-06 追加の5件（指導指針などで担当者・体制を求める係）─────────────
       ★staff-api.gs の COMMITTEE_DEFAULTS と1字一句そろえる（既存9件と同じ約束）。
       事故発生防止は熊本市有料老人ホーム設置運営指導指針 13(8)（指針・報告と分析の体制・委員会と研修・担当者）、
       苦情・個人情報・ハラスメントは居宅基準（第36条・第33条・第30条4項）、防火管理者は消防法 第8条。
       どれも減算は無い（hasPenalty は false）。防火管理者は該当するかが収容人員で決まるので要確認を出し続ける。 */
    {
      code: 'accident',
      label: '事故発生防止委員会',
      alias: 'ヒヤリハット会議',
      kind: 'committee',
      sites: ['facility'],
      freq: '定期的',
      basis: '同指導指針',
      url: 'https://www.city.kumamoto.jp/kiji0032329/index.html',
      startedAt: '訪問介護・通所介護は委員会の定めなし（事故の記録・市への報告の義務のみ）／有料老人ホームは熊本市指針が根拠で時期は確認できず',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '熊本市有料老人ホーム設置運営指導指針による義務',
      training: '定期的',
      note: '指針・報告と分析の体制・委員会と研修・担当者の4つをそろえる（指導指針）。身体的拘束等適正化委員会と同日開催でよいが、議事録は別に作る',
      todoNote: '',
      inactive: false
    },
    {
      code: 'complaint',
      label: '苦情受付担当者・苦情解決責任者',
      alias: 'よりよくする窓口',
      kind: 'officer',
      sites: ['facility', 'visit', 'day'],
      freq: '委員会の設置義務はなし',
      basis: '居宅基準 第36条（訪問）／第105条で準用（通所）／同指導指針',
      url: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_36',
      startedAt: '訪問介護・通所介護は2000年4月（基準制定当初）から／有料老人ホームは熊本市指針が根拠で時期は確認できず',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（運営基準）',
      training: '',
      note: '受付の窓口と記録（5年保存）、重要事項説明書への記載、外部の苦情処理機関（市・国保連）の周知が要る。受付担当者と解決責任者は分けて置く',
      todoNote: '',
      inactive: false
    },
    {
      code: 'privacy',
      label: '個人情報保護管理責任者',
      alias: '個人情報ガードマン',
      kind: 'officer',
      sites: ['facility', 'visit', 'day'],
      freq: '委員会の設置義務はなし',
      basis: '個人情報保護法／居宅基準 第33条（訪問）／第105条で準用（通所）／同指導指針',
      url: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_33',
      startedAt: '2005年4月（個人情報保護法の全面施行）から／居宅基準 第33条は2000年4月（基準制定当初）から',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（個人情報保護法・運営基準）',
      training: '',
      note: '規程の整備、従業者の秘密保持の措置（誓約書・退職後を含む）、利用目的の掲示、第三者提供の文書同意を担当する。法人で1名でよい',
      todoNote: '',
      inactive: false
    },
    {
      code: 'harassment',
      label: 'ハラスメント相談担当者',
      alias: '一人で抱えない窓口',
      kind: 'officer',
      sites: ['facility', 'visit', 'day'],
      freq: '委員会の設置義務はなし',
      basis: '居宅基準 第30条4項（訪問）／第105条で準用（通所）／労働施策総合推進法 第30条の2',
      url: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_30',
      startedAt: '2021年4月（令和3年4月）に居宅基準へ追加／パワーハラスメント防止の措置は中小企業も2022年4月から義務',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（運営基準・労働施策総合推進法）',
      training: '年1回以上で運用',
      note: '事業主の方針の明確化と相談窓口の設置・周知。利用者やご家族からのハラスメント（カスタマーハラスメント）への対応も含めることが望ましい。相談担当者は相談者と利害のない者を置く',
      todoNote: '',
      inactive: false
    },
    {
      code: 'fire',
      label: '防火管理者',
      alias: '火の用心係',
      kind: 'officer',
      sites: ['facility', 'day'],
      freq: '委員会の設置義務はなし',
      basis: '消防法 第8条／消防法施行令 第1条の2',
      url: 'https://laws.e-gov.go.jp/law/323AC0000000186#Mp-At_8',
      startedAt: '消防法 第8条が根拠。当事業所が該当するかは防火対象物の収容人員で決まる（要確認）',
      siteStartedAt: '',
      penalty: '',
      hasPenalty: false,
      purpose: '法令上の義務（消防法）',
      training: '',
      note: '収容人員が一定数以上の防火対象物に選任義務（有料老人ホーム・デイサービスは10人以上が目安）。消防署へ選任届を出し、消防計画を作る。施設と通所が同じ建物なら建物全体で1名',
      todo: true,
      todoNote: '施設と通所の建物が同じ防火対象物か、収容人員の数え方を消防署に確認してください',
      inactive: false
    }
  ];

  /* ── 所在自治体（2026-10-11・監査10月版 第2版 10）───────────────
     上の COMMITTEE_DEFAULTS は熊本市の資料から起こした確定値のまま変えない（staff-api.gs と1字一句そろえる約束・
     gas/tests の staff_committee_gas_test がそれを照合する）。施設情報（facility-profile.json）の municipality と
     法人設定（corpSettings）が熊本市以外を指す時だけ、画面と紙に出す既定（LOCAL_DEFAULTS）の文言を置き換える。
       ・未設定（施設情報が読めない・municipality が空）と熊本市は、今と1字も変えない（LOCAL_DEFAULTS は COMMITTEE_DEFAULTS そのもの）
       ・熊本市以外で法人設定が空 → 一般名「所在自治体の有料老人ホーム設置運営指導指針」で出し、案内ページは空・要確認を付ける
         （実在しない文書名を実地指導の紙に刷らないため。2026-10-11 本人裁定）
       ・法人設定に名称・URL があればそれを使う
     置き換えるのは熊本市の指針の名前・略称・案内ページ・「熊本市に確認」だけ。条文（居宅基準）の部分は触らない。
     ★サーバー（staff-api.gs）の既定は熊本市の文言のまま。画面は basis・purpose・startedAt・todoNote を既定から引き直す
       （setCommittees）ので、紙に出るのはここで置き換えた文言になる。 */
  var LOC_KUMAMOTO = {
    municipality: '熊本市',
    name: '熊本市有料老人ホーム設置運営指導指針',
    short: '熊本市指針',
    url: 'https://www.city.kumamoto.jp/kiji0032329/index.html'
  };
  var LOC_GENERIC_NAME = '所在自治体の有料老人ホーム設置運営指導指針';
  var LOC_TODO_NOTE = '有料老人ホームの指導指針の名称と案内ページ（URL）を、施設情報の法人設定に入れてください';   /* 紙に出るのでファイル名は書かない（置き場は facility-profile.json の corpSettings） */
  var LOCALITY = LOC_KUMAMOTO;
  var LOCAL_DEFAULTS = COMMITTEE_DEFAULTS;

  function localizeText(s, loc) {
    s = trim(s);
    if (loc === LOC_KUMAMOTO) return s;
    return s.split(LOC_KUMAMOTO.name).join(loc.name)
            .split(LOC_KUMAMOTO.short).join(loc.short)
            .split(LOC_KUMAMOTO.municipality + 'に確認').join(loc.municipality + 'に確認');
  }
  function localizeDefault(d, loc) {
    if (loc === LOC_KUMAMOTO) return d;
    var o = {}, k;
    for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = d[k];
    if (Object.prototype.toString.call(d.sites) === '[object Array]') o.sites = d.sites.slice();
    o.basis = localizeText(d.basis, loc);
    o.purpose = localizeText(d.purpose, loc);
    o.startedAt = localizeText(d.startedAt, loc);
    o.todoNote = localizeText(d.todoNote, loc);
    if (trim(d.url) === LOC_KUMAMOTO.url) {
      o.url = loc.url;
      /* 案内ページが分からない＝人に確かめてもらう（既に要確認なら、その確認事項を残す） */
      if (!loc.url && d.todo !== true) { o.todo = true; o.todoNote = LOC_TODO_NOTE; }
    }
    return o;
  }

  /* 施設情報から所在自治体を決める。opt = {municipality, homeGuidelineName, homeGuidelineUrl}（どれも省略可） */
  function localityFrom(opt) {
    var mun = trim(opt && opt.municipality), name = trim(opt && opt.homeGuidelineName), url = trim(opt && opt.homeGuidelineUrl);
    if (!/^https:\/\/[^\s"<>]+$/.test(url)) url = '';
    var isKuma = (mun === '' || mun === LOC_KUMAMOTO.municipality);
    if (isKuma && !name && !url) return LOC_KUMAMOTO;
    return {
      municipality: mun || '所在自治体',
      name: name || (isKuma ? LOC_KUMAMOTO.name : LOC_GENERIC_NAME),
      short: name || (isKuma ? LOC_KUMAMOTO.short : '所在自治体の指針'),
      url: url || (isKuma && !name ? LOC_KUMAMOTO.url : '')
    };
  }

  /* ── 法人設定の委員会の既定（2026-11-02・代表者の決定 判断5）─────────
     facility-profile.json の corpSettings.committeeDefaults に、COMMITTEE_DEFAULTS と同じ形の配列が書いてあれば、
     画面と紙に出す既定（LOCAL_DEFAULTS の元）をそれで差し替える。所在自治体の置き換えはその上に当てる。
       ・書いていない時は今と1字も変わらない（元は COMMITTEE_DEFAULTS そのもの）
       ・1件でも形が崩れていれば丸ごと捨てて COMMITTEE_DEFAULTS を使う（一部だけ混ぜると委員会の組が壊れるため）
     ★code の組は COMMITTEE_DEFAULTS と同じ9件に限る（足す・減らすは崩れ）。サーバー（staff-api.gs）は同じ9件の既定を
       持っていて、既定にある委員会の根拠・種別などを保存値によらず自分の既定から引き直す。ここで知らない code を
       足すと、画面の保存（setCommittees）で人が足した委員会としてサーバーに書かれてしまうため。
       差し替わるのは「既定が正」の項目（種別・対象事業所・根拠・減算・何のため・研修・訓練・いつから・確認事項）と、
       サーバーのマスタを受け取る前の表示と「既定に戻す」の値。名前・頻度・注記・URL はサーバーの値を出す（今と同じ）。
     ★上限と形はサーバーの検証（validateCommittees_）と同じにする。通るのに保存で断られる既定を作らないため。 */
  var CMT_ITEM_KEYS = ['code', 'label', 'sites', 'freq', 'basis', 'penalty', 'note', 'inactive', 'hasPenalty',
                       'kind', 'alias', 'purpose', 'training', 'drill', 'todo', 'url', 'todoNote',
                       'startedAt', 'siteStartedAt'];                        /* staff-api.gs の COMMITTEE_ITEM_KEYS と同じ */
  var CMT_TEXT_KEYS = ['freq', 'basis', 'penalty', 'note', 'alias', 'purpose', 'training', 'drill', 'todoNote', 'startedAt'];
  var CMT_LABEL_MAX = 60, CMT_TEXT_MAX = 200;                            /* staff-api.gs の COMMITTEE_LABEL_MAX・COMMITTEE_TEXT_MAX と同じ */
  var BASE_DEFAULTS = COMMITTEE_DEFAULTS;                                 /* 所在自治体を当てる前の既定（法人設定があればその値） */
  var BASE_KEY = '';                                                      /* 受け入れた法人設定の既定の写し（JSON）。無ければ空 */

  /* 法人設定の既定を確かめる。形が合えば写し（配列）、崩れていれば null */
  function normCommitteeDefaults(v) {
    if (Object.prototype.toString.call(v) !== '[object Array]' || v.length !== COMMITTEE_DEFAULTS.length) return null;   /* 空・足りない・多いは崩れ */
    var out = [], codes = {}, labels = {}, i, j, k;
    for (i = 0; i < v.length; i++) {
      var d = v[i];
      if (!d || typeof d !== 'object') return null;
      for (k in d) {
        if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
        if (k.charAt(0) === '_') continue;                                /* 説明の欄（_note など）は読み飛ばす */
        if (CMT_ITEM_KEYS.indexOf(k) < 0) return null;
      }
      /* code の形（英数字と _）は下の「COMMITTEE_DEFAULTS と同じ組」で決まる */
      if (typeof d.code !== 'string' || Object.prototype.hasOwnProperty.call(codes, d.code)) return null;
      if (typeof d.label !== 'string') return null;
      var label = d.label.replace(/[\r\n\t]/g, ' ').trim();
      if (!label || label.length > CMT_LABEL_MAX || Object.prototype.hasOwnProperty.call(labels, label)) return null;
      if (normKind(d.kind) !== d.kind) return null;
      if (Object.prototype.toString.call(d.sites) !== '[object Array]') return null;
      for (j = 0; j < d.sites.length; j++) {
        if (SITE_CODES.indexOf(d.sites[j]) < 0 || d.sites.indexOf(d.sites[j]) !== j) return null;
      }
      for (j = 0; j < CMT_TEXT_KEYS.length; j++) {
        var tv = d[CMT_TEXT_KEYS[j]];
        if (tv === undefined) continue;
        if (typeof tv !== 'string' || tv.replace(/[\r\n\t]/g, ' ').trim().length > CMT_TEXT_MAX) return null;
      }
      if (d.url !== undefined && (typeof d.url !== 'string' || normUrl(d.url) !== trim(d.url))) return null;
      if (d.siteStartedAt !== undefined && (typeof d.siteStartedAt !== 'string' || trim(d.siteStartedAt).length > SITE_STARTED_MAX)) return null;
      if ((d.hasPenalty !== undefined && typeof d.hasPenalty !== 'boolean') ||
          (d.todo !== undefined && typeof d.todo !== 'boolean') ||
          (d.inactive !== undefined && typeof d.inactive !== 'boolean')) return null;
      codes[d.code] = 1;
      labels[label] = 1;
      var o = {};
      for (j = 0; j < CMT_ITEM_KEYS.length; j++) {
        k = CMT_ITEM_KEYS[j];
        if (Object.prototype.hasOwnProperty.call(d, k)) o[k] = (k === 'sites') ? d.sites.slice() : d[k];
      }
      out.push(o);
    }
    /* code の組は COMMITTEE_DEFAULTS と同じ（上の★） */
    for (i = 0; i < COMMITTEE_DEFAULTS.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(codes, COMMITTEE_DEFAULTS[i].code)) return null;
    }
    return out;
  }

  /* 所在自治体を反映する。変わらなければ false（画面は描き直さなくてよい）。
     変われば既定を引き直し、受け取り済みのサーバーのマスタにも同じ規則（setCommittees）を当て直す。
     opt.committeeDefaults（法人設定の委員会の既定・省略可）も同じ時に当てる（上の「法人設定の委員会の既定」） */
  var LAST_SERVER_LIST = null;
  function setLocality(opt) {
    var loc = localityFrom(opt);
    var base = normCommitteeDefaults(opt && opt.committeeDefaults);
    var baseKey = base ? JSON.stringify(base) : '';
    var same = (loc === LOCALITY) || (loc !== LOC_KUMAMOTO && LOCALITY !== LOC_KUMAMOTO &&
      loc.municipality === LOCALITY.municipality && loc.name === LOCALITY.name && loc.short === LOCALITY.short && loc.url === LOCALITY.url);
    if (same && baseKey === BASE_KEY) return false;
    LOCALITY = loc;
    BASE_DEFAULTS = base || COMMITTEE_DEFAULTS;
    BASE_KEY = baseKey;
    LOCAL_DEFAULTS = BASE_DEFAULTS.map(function (d) { return localizeDefault(d, loc); });
    if (!(LAST_SERVER_LIST && setCommittees(LAST_SERVER_LIST))) COMMITTEES = LOCAL_DEFAULTS.map(function (d) { return fromDefault(d); });
    return true;
  }
  function locality() {
    return { municipality: LOCALITY.municipality, name: LOCALITY.name, short: LOCALITY.short, url: LOCALITY.url, isDefault: LOCALITY === LOC_KUMAMOTO };
  }
  /* 画面の「既定に戻す」が引く出荷時の既定（所在自治体を当てた後）。写しを返す */
  function localDefaults() { return LOCAL_DEFAULTS.map(function (d) { return fromDefault(d); }); }

  /* 既定の開催頻度を直した時の、前の既定の文面（2026-09-23.7）。サーバー（staff-api.gs の
     RETIRED_DEFAULT_FREQ_）と同じ中身にする（テストで照合）。
     ★頻度は書き換え可の側だが、画面に入力欄が無く、保存のたびに読み出した文面が書き戻される＝既定を
       直しても保存済みの本番には前の文面が残る。setCommittees で、送られた頻度がここにある文面と
       【一字一句同じ】時だけ今の既定へ引き直す（サーバーが前の版のままでも、画面と紙には新しい文面が出る）。
     ★入れてよいのは前の版の COMMITTEE_DEFAULTS に実際にあった文面だけ（人が書いた頻度を書き換えないため）。 */
  var RETIRED_DEFAULT_FREQ = {
    /* 2026-09-23.6 まで。身体的拘束は 2026-09-23.4 から施設だけ＝訪問・通所の頻度は要らなくなった */
    restraint: ['有料は3か月に1回以上／訪問・通所は定期的']
  };
  /* 前の既定の通称（2026-11-06.2）。保存値がこれと同じ時だけ今の既定へ引き直す（aliasFrom）。
     サーバー（staff-api.gs）と同じ中身にする。入れてよいのは前の版の既定に実際にあった文面だけ */
  var RETIRED_DEFAULT_ALIAS = { safety: ['生産性向上委員会'] };

  var COMMITTEE_ROLES = [['chair', '委員長'], ['officer', '担当者'], ['member', '委員']];

  /* 一覧の種別（委員会／計画と訓練／選任）。画面の見出しの区切りに使う。
     'committee' 以外は委員会ではないので、委員長・委員の注意を出さない（committeeStats） */
  var COMMITTEE_KINDS = [['committee', '委員会'], ['plan', '計画と訓練'], ['officer', '選任']];

  /* 役割の並び（委員長 → 担当者 → 委員）。所属の検証にも使う＝この3種以外は落とす */
  var ROLE_ORDER = { chair: 0, officer: 1, member: 2 };

  /* 要件を確認できるページ。空でよい。http:// か https:// で始まる形だけ通す。
     ★画面がこの値をリンクにするので、javascript: / data: / vbscript: などは落として空にする。
       サーバー（staff-api.gs の normCommitteeUrl_ / COMMITTEE_URL_RE）と同じ約束。 */
  var COMMITTEE_URL_MAX = 300;
  var COMMITTEE_URL_RE = /^https?:\/\//i;
  function normUrl(v) {
    var t = trim(v);
    if (!t || t.length > COMMITTEE_URL_MAX || !COMMITTEE_URL_RE.test(t)) return '';
    return t;
  }

  /* 記録から url を取り出す。★「一度も設定されていない」と「人が消した」を分ける（2026-09-22.5 実機）。
       キーが【無い】＝第4版までに保存された記録＝未設定 → 既定のURLを出す
       キーがあって空文字＝人が意図して消した → 空のまま（勝手に復活させない）
     ★normUrl(src.url) だけで書くと undefined が '' に潰れて区別できなくなる。
       必ず hasOwnProperty でキーの有無を先に見ること。
     ★画面が第1版のサーバー（url を知らない）に繋がった時にも既定が出るよう、算出モジュール側にも
       同じ約束を持つ（既定の増分をマージしているのと同じ考え方）。 */
  function urlFrom(src, def) {
    if (src && Object.prototype.hasOwnProperty.call(src, 'url')) return normUrl(src.url);
    return def ? normUrl(def.url) : '';
  }

  /* 当事業所が始めた月（2026-09-23.2）。空でよい。書式は縛らない＝現場の書き方
     （「2024年4月」「R6.4」「令和6年4月ごろ」など）をそのまま通し、長さだけを見る。
     サーバー（staff-api.gs の normCommitteeSiteStarted_ / COMMITTEE_SITE_STARTED_MAX）と同じ約束。 */
  var SITE_STARTED_MAX = 40;
  function normSiteStarted(v) { return trim(v).substring(0, SITE_STARTED_MAX); }

  /* 記録から siteStartedAt を取り出す。★url とまったく同じ作法で「一度も設定されていない」と
     「人が消した」を分ける（hasOwnProperty でキーの有無を先に見る）。
     ★ただし siteStartedAt は既定が全件空なので、キーが無い時も結果は空になる。
       この形で書いておくと、将来どれかに既定を入れた時にそのまま効く。 */
  function siteStartedFrom(src, def) {
    if (src && Object.prototype.hasOwnProperty.call(src, 'siteStartedAt')) return normSiteStarted(src.siteStartedAt);
    return def ? normSiteStarted(def.siteStartedAt) : '';
  }

  /* 記録から開催頻度を取り出す（2026-09-23.7・RETIRED_DEFAULT_FREQ の★）。書き換え可の側なので送られた値を
     そのまま使うが、既定にある委員会で、前の既定の文面と一字一句同じ時だけ今の既定へ引き直す。 */
  function freqFrom(src, def) {
    var f = trim(src && src.freq);
    if (def && Object.prototype.hasOwnProperty.call(RETIRED_DEFAULT_FREQ, def.code) &&
        RETIRED_DEFAULT_FREQ[def.code].indexOf(f) >= 0) return trim(def.freq);
    return f;
  }

  /* 記録から通称を取り出す（2026-11-06.2）。書き換え可の側なので送られた値を尊重するが、
     既定にある委員会で、空か前の既定の通称（RETIRED_DEFAULT_ALIAS）と一字一句同じ時だけ今の既定へ引き直す。
     人が足した委員会は送られた値のまま */
  function aliasFrom(src, def) {
    var a = trim(src && src.alias);
    if (!def) return a;
    if (a === '' || (Object.prototype.hasOwnProperty.call(RETIRED_DEFAULT_ALIAS, def.code) &&
        RETIRED_DEFAULT_ALIAS[def.code].indexOf(a) >= 0)) return trim(def.alias);
    return a;
  }

  /* 知らない種別は 'committee' に寄せる（注意を静かに減らさない安全側。sites の検証と同じ作法） */
  function normKind(v) {
    var k = trim(v);
    for (var i = 0; i < COMMITTEE_KINDS.length; i++) if (COMMITTEE_KINDS[i][0] === k) return k;
    return 'committee';
  }

  /* 既定にある委員会（setCommittees で「既定の値を正とする」項目を引く） */
  function defaultCommittee(code) {
    for (var i = 0; i < LOCAL_DEFAULTS.length; i++) {
      if (LOCAL_DEFAULTS[i].code === code) return LOCAL_DEFAULTS[i];
    }
    return null;
  }

  /* 既定の1件を、setCommittees が組み立てる行と同じ形（全項目・空は空文字）で写す。
     ★sites は必ず複製する。既定の配列をそのまま渡すと、呼び手の並べ替えでマスタが崩れる */
  function fromDefault(d) {
    return {
      code: d.code,
      label: trim(d.label) || d.code,
      alias: trim(d.alias),
      kind: normKind(d.kind),
      sites: d.sites.slice(),
      freq: trim(d.freq),
      basis: trim(d.basis),
      penalty: trim(d.penalty),
      hasPenalty: d.hasPenalty === true,
      purpose: trim(d.purpose),
      training: trim(d.training),
      drill: trim(d.drill),
      note: trim(d.note),
      /* 要件を確認できるページ（書き換え可）と、要確認の時に何を確かめるか（既定が正）。2026-09-22.5 */
      url: urlFrom(d, defaultCommittee(d.code)),
      /* 制度の対象開始月（既定が正）と、当事業所が始めた月（書き換え可）。2026-09-23.2 */
      startedAt: trim(d.startedAt),
      siteStartedAt: siteStartedFrom(d, defaultCommittee(d.code)),
      todoNote: trim(d.todoNote),
      todo: d.todo === true,
      inactive: d.inactive === true
    };
  }

  /* いまのマスタの初期値。★必ず fromDefault を通す（2026-09-22.2 レビュー3）。
     COMMITTEE_DEFAULTS.slice() だと、サーバー応答を受け取る前の committees() が未正規化の実体を
     そのまま返し、abuse.drill・kondan.alias などが undefined（setCommittees 後は ''）になる＝
     同じ公開APIが状況で別の形を返す。さらに sites 配列の参照を既定と共有してしまい、
     fromDefault の「★sites は必ず複製する」と矛盾する。 */
  var COMMITTEE_MAX_ROWS = 20;   /* マスタに置ける委員会の数（staff-api.gs の COMMITTEE_MAX_ROWS と同じ値） */
  var COMMITTEES = LOCAL_DEFAULTS.map(function (d) { return fromDefault(d); });

  /* サーバーの委員会マスタを反映する。[{code,…}] の配列のときだけ差し替える。
     空配列・壊れた値は無視する＝応答が古くても画面から委員会が消えない（setEnums と同じ安全側）。
     ★既定にあって list に無い体制は末尾に足す（2026-09-22.2）。前の版の時代に保存された
       6件だけのマスタをサーバーから受け取ると、そのままでは BCP・非常災害対策・衛生推進者が
       画面から消える。制度上の体制は人が保存した覚えが無くても存在するので、足して補う。
       並びは「list にある分をその順」→「既定にしか無い分を既定の順」。list に在る分の編集
       （名前・頻度・根拠・対象外の印など）は保存値のままにし、マージで既定へ戻さない。
     戻り値: 反映後の件数（0 なら既定のまま） */
  function setCommittees(list) {
    if (Object.prototype.toString.call(list) !== '[object Array]' || !list.length) return 0;
    var out = [], seen = {}, i, j;
    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it !== 'object') continue;
      var code = trim(it.code);
      if (!code || Object.prototype.hasOwnProperty.call(seen, code)) continue;   /* 同じコードは先勝ち */
      seen[code] = 1;
      var src = (Object.prototype.toString.call(it.sites) === '[object Array]') ? it.sites : [];
      var sites = [];
      for (j = 0; j < src.length; j++) {
        var s = trim(src[j]);
        /* 知らない事業所コードは落とす（SITE_CODES と同じ体系でしか集計できない） */
        if (SITE_CODES.indexOf(s) < 0 || sites.indexOf(s) >= 0) continue;
        sites.push(s);
      }
      /* ★減算の有無・種別・要件の表示（何のため・研修・訓練・要確認）は必ず持ち回る
           （2026-09-22 実測の不具合）。ここで落とすと、サーバーのマスタを読み込んだ瞬間に
           「担当者が決まっていません（減算の要件です）」が永久に出なくなる。委員会機能で
           いちばん効く警告なので、文面からの推測で代用しない。
         ★既定にある委員会は【既定の値】を正とする。減算の有無も、種別も、何の加算・減算の
           ための体制かも制度上の事実であって、人が画面から変えるものではない。古いサーバーや、
           これらの項目を持たない保存済みのマスタを読んでも、注意と説明が消えないようにするため。 */
      var def = defaultCommittee(code);
      out.push({
        code: code,
        label: trim(it.label) || code,                                           /* 名前が無ければコードを出す */
        /* ★通称は 2026-11-06.2 から label・freq と同じ書き換え可の側。空＝既定の通称（aliasFrom） */
        alias: aliasFrom(it, def),
        kind: def ? normKind(def.kind) : normKind(it.kind),
        /* ★対象事業所も既定が正（2026-09-23.4）。どの事業所が対象かは条文で決まる。人が足した委員会だけ送られた値 */
        sites: def ? def.sites.slice() : sites,
        /* ★頻度は書き換え可の側。ただし前の既定の文面のままなら今の既定へ引き直す（2026-09-23.7・freqFrom） */
        freq: freqFrom(it, def),
        /* ★根拠と減算の文面も既定を正とする（2026-09-22.3 レビュー4・サーバーと対称）。
           紙に刷られる根拠はサーバーではなく、ここ（committees()）から出ている。第2版の画面が
           第1版のサーバー（basis を素通しする）に繋がると、書き換えられた根拠がそのまま紙に乗る。 */
        basis: def ? trim(def.basis) : trim(it.basis),
        penalty: def ? trim(def.penalty) : trim(it.penalty),
        hasPenalty: def ? def.hasPenalty === true : it.hasPenalty === true,
        purpose: def ? trim(def.purpose) : trim(it.purpose),
        training: def ? trim(def.training) : trim(it.training),
        drill: def ? trim(def.drill) : trim(it.drill),
        note: trim(it.note),
        /* ★url は label・freq・note と同じ「書き換え可」の側。事業所ごとに参照先を変えられる
           ことが依頼の趣旨なので、書き換えた値は既定から引き直さない（2026-09-22.5）。
           ただし url のキーごと無い記録（第4版までに保存された committeesJson・第1版のサーバーの
           応答）は「未設定」なので既定のURLを出す＝既存の事業所でも既定が表示される。 */
        url: (def && LOCALITY !== LOC_KUMAMOTO && trim(it.url) === LOC_KUMAMOTO.url) ? trim(def.url) : urlFrom(it, def),
        /* ↑★熊本市以外では、サーバーが送ってくる熊本市の案内ページ（staff-api.gs は保存が無くても既定の url を付けて返す）を
             「既定のまま」とみなして所在自治体の既定へ引き直す（2026-10-11 審査の指摘）。熊本市・未設定は従来どおり urlFrom */
        /* ★startedAt（制度の対象開始月）は basis・penalty と同じ「既定が正」の側（2026-09-23.2）。
           いつから義務・減算なのかは制度上の事実なので、画面から書き換えられない。
           ★siteStartedAt（当事業所が始めた月）は url と同じ「書き換え可」の側。キーごと無い記録
           （第6版までに保存された committeesJson）は「未設定」として扱う＝上の siteStartedFrom。 */
        startedAt: def ? trim(def.startedAt) : trim(it.startedAt),
        siteStartedAt: siteStartedFrom(it, def),
        /* ★todoNote（何を確認すればよいか）は制度の説明なので既定を正とする＝画面から書き換えない。
           古い保存値を読んでも確認事項が消えない（basis・penalty と同じ扱い）。 */
        todoNote: def ? trim(def.todoNote) : trim(it.todoNote),
        todo: def ? def.todo === true : it.todo === true,
        inactive: it.inactive === true
      });
    }
    if (!out.length) return 0;
    /* 既定にあって送られてこなかった体制を、既定の順で末尾に足す（既定の値そのまま） */
    for (i = 0; i < LOCAL_DEFAULTS.length; i++) {
      /* ★上限（20件）を超えてまでは足さない（2026-11-06・既定が14件になったため）。staff-api.gs の
           normCommittees_（COMMITTEE_MAX_ROWS）と同じ規則。超えると保存時に validateCommittees_ の
           「委員会は20件までです」で全件差し戻される */
      if (out.length >= COMMITTEE_MAX_ROWS) break;
      if (Object.prototype.hasOwnProperty.call(seen, LOCAL_DEFAULTS[i].code)) continue;
      /* ★同じ名前の委員会が既にあれば足さない（2026-11-06）。事業所が「防火管理者」等を独自に作っていた時、
           同じ名前が2件になると validateCommittees_ の「同じ名前が2つあります」で保存が全件差し戻される。
           staff-api.gs の normCommittees_・validateCommittees_ と同じ規則 */
      if (labelTaken(out, LOCAL_DEFAULTS[i].label)) continue;
      out.push(fromDefault(LOCAL_DEFAULTS[i]));
    }
    COMMITTEES = out;
    LAST_SERVER_LIST = list;          /* 所在自治体が後から分かった時に、同じ規則で当て直すため（setLocality） */
    return out.length;
  }

  /* 名前が既にマスタにあるか（既定を末尾に足す時の重複よけ。改行・タブは空白に揃えて比べる＝validateCommittees_ と同じ） */
  function labelTaken(list, label) {
    var t = String(label == null ? '' : label).replace(/[\r\n\t]/g, ' ').trim();
    for (var k = 0; k < list.length; k++) {
      if (String(list[k].label == null ? '' : list[k].label).replace(/[\r\n\t]/g, ' ').trim() === t) return true;
    }
    return false;
  }

  /* いまのマスタ。写しを返す（呼び手の並べ替えでマスタが崩れない） */
  function committees() { return COMMITTEES.slice(); }

  function committeeOf(code) {
    var c = trim(code);
    if (c === '') return null;
    for (var i = 0; i < COMMITTEES.length; i++) if (COMMITTEES[i].code === c) return COMMITTEES[i];
    return null;
  }

  /* ── 必要書類と開催の条件（2026-11-06）──────────────────────────
     委員会ごとに「そろえる書類」と「開催の条件」を code で引く別表。画面の構成図カードと紙に出すだけ。
     ★委員会マスタの各項目（committees() の要素）には入れない。画面は setCommittees で全件を送り返すので、
       ここを要素に足すと staff-api.gs の検証（COMMITTEE_ITEM_KEYS に無い項目）で保存が全部断られる。
       通信にも載せない（サーバーは知らなくてよい情報）。
     COMMITTEE_DOCS: code → [{ name, kind, sites?, freq, basis }]。kind は COMMITTEE_DOC_KINDS のどれか。
       sites を書かない書類は「その委員会の対象事業所と同じ」（committeeDocs が補う）。
     COMMITTEE_MEET: code → { freq, attend, method, minutes, notify, keep }。無いものは '—'。 */
  var COMMITTEE_DOC_KINDS = ['指針', '要綱', '規程', '計画', '議事録', '記録', '辞令', '様式', '掲示'];
  var COMMITTEE_MEET_KEYS = ['freq', 'attend', 'method', 'minutes', 'notify', 'keep'];

  var COMMITTEE_DOCS = {
    abuse: [
      { name: '虐待の防止のための指針', kind: '指針', freq: '常備・改正時に見直し', basis: '居宅基準 第37条の2／指導指針 10(4)ハ' },
      { name: '虐待防止検討委員会 設置要綱', kind: '要綱', freq: '制定時', basis: '—' },
      { name: '虐待防止検討委員会 議事録', kind: '議事録', freq: '開催ごと・5年保存', basis: '居宅基準 第37条の2／指導指針 10(4)ロ' },
      { name: '虐待防止研修 記録', kind: '記録', freq: '年1回以上＋新規採用時', basis: '老企第25号／指導指針 10(4)ニ' },
      { name: '虐待防止担当者の選任の辞令・体制表', kind: '辞令', freq: '選任・変更時', basis: '居宅基準 第37条の2第4号／指導指針 10(4)ホ' },
      { name: '運営規程への虐待防止措置の記載', kind: '規程', sites: ['visit', 'day'], freq: '改正時', basis: '集団指導 共通編の指摘事項' },
      { name: '市への通報体制・通報の記録', kind: '記録', freq: '事象ごと', basis: '高齢者虐待防止法 第21条' }
    ],
    restraint: [
      { name: '身体的拘束等の適正化のための指針', kind: '指針', freq: '常備・改正時に見直し', basis: '指導指針 10(7)ロ' },
      { name: '身体的拘束等適正化検討委員会 設置要綱', kind: '要綱', freq: '制定時', basis: '—' },
      { name: '身体的拘束等適正化検討委員会 議事録', kind: '議事録', freq: '3か月に1回以上（年4回）・5年保存', basis: '指導指針 10(7)イ' },
      { name: '身体的拘束等の適正化のための研修 記録', kind: '記録', freq: '年1回以上で運用', basis: '指導指針 10(7)ハ' },
      { name: '身体的拘束等の判断・手続の記録（3要件の確認・家族への説明）', kind: '記録', freq: '事象ごと・5年保存', basis: '指導指針 10(5)(6)・帳簿 9(3)ニ' },
      { name: '身体的拘束中の経過観察の記録', kind: '記録', freq: '事象ごと', basis: '指導指針 10(6)' }
    ],
    infection: [
      { name: '感染症の予防及びまん延の防止のための指針', kind: '指針', freq: '常備・改正時に見直し', basis: '居宅基準 第31条3項／第104条2項／指導指針 9(7)ロ' },
      { name: '感染対策委員会 議事録', kind: '議事録', freq: 'おおむね6か月に1回以上・5年保存', basis: '居宅基準 第31条3項／第104条2項／指導指針 9(7)イ' },
      { name: '感染症研修 記録', kind: '記録', freq: '年1回以上（新規採用時は努力義務）', basis: '老企第25号／指導指針 9(7)ハ' },
      { name: '感染症の訓練（机上・実地）記録', kind: '記録', freq: '年1回以上', basis: '老企第25号／指導指針 9(7)ハ' },
      { name: '感染対策担当者の選任の記録', kind: '辞令', freq: '選任・変更時', basis: '老企第25号' },
      { name: '職員健康診断の記録', kind: '記録', freq: '年1回以上', basis: '居宅基準 第31条／立入検査の確認書類' }
    ],
    safety: [
      { name: '委員会 議事録', kind: '議事録', freq: '定期', basis: '令和6年度介護報酬改定' },
      { name: '検討した方策と取組の記録', kind: '記録', freq: '随時', basis: '令和6年度介護報酬改定' }
    ],
    kondan: [
      { name: '運営懇談会 開催状況の記録・議事録', kind: '議事録', freq: '定期開催・5年保存', basis: '指導指針 9(11)／立入検査の確認書類' },
      { name: '入居者・身元引受人への開催周知の記録', kind: '記録', freq: '開催ごと', basis: '指導指針 9(11)ロ' },
      { name: '報告資料（入居者の状況・サービス提供の状況・収支）', kind: '記録', freq: '開催ごと', basis: '指導指針 9(11)ニ' }
    ],
    dementia: [
      { name: '事例検討・技術的指導の会議 記録', kind: '議事録', freq: '定期', basis: '通所介護 認知症加算' }
    ],
    bcp: [
      { name: '感染症に係る業務継続計画', kind: '計画', freq: '策定・定期見直し', basis: '居宅基準 第30条の2／指導指針 9(5)イ' },
      { name: '非常災害に係る業務継続計画（感染症と一体でも可）', kind: '計画', freq: '策定・定期見直し', basis: '居宅基準 第30条の2／指導指針 9(5)イ' },
      { name: 'BCP研修 記録', kind: '記録', freq: '年1回以上（新規採用時は努力義務）', basis: '老企第25号／指導指針 9(5)ロ' },
      { name: 'BCP訓練 記録（課題も残す）', kind: '記録', freq: '年1回以上', basis: '老企第25号／指導指針 9(5)ロ' },
      { name: '職員への周知の記録', kind: '記録', freq: '策定・改訂時', basis: '居宅基準 第30条の2第2項' },
      { name: 'BCP担当者の選任の記録', kind: '辞令', freq: '選任・変更時', basis: '—' }
    ],
    disaster: [
      { name: '消防計画書（消防署へ届出）', kind: '計画', freq: '作成・変更時', basis: '消防法施行規則 第3条／指導指針 9(6)' },
      { name: '風水害・地震等の非常災害に関する具体的計画', kind: '計画', freq: '策定・定期見直し', basis: '指導指針 9(6)イ' },
      { name: '避難訓練 実施記録', kind: '記録', freq: '年2回以上（施設はうち1回は夜間想定）', basis: '消防法施行規則／有料老人ホーム集団指導資料' },
      { name: '関係機関への通報・連携体制表', kind: '記録', freq: '定期見直し', basis: '指導指針 9(6)イ' },
      { name: '避難確保計画（浸水想定区域等に当たる時）', kind: '計画', freq: '該当時', basis: '水防法・土砂災害防止法' }
    ],
    hygiene: [
      { name: '衛生推進者の選任の記録', kind: '辞令', freq: '選任時', basis: '労働安全衛生法 第12条の2' },
      { name: '職員への周知（掲示等）', kind: '掲示', freq: '選任時', basis: '労働安全衛生規則 第12条の4' }
    ],
    accident: [
      { name: '事故発生の防止のための指針（事故対応・報告の方法を含む）', kind: '指針', freq: '常備・改正時に見直し', basis: '指導指針 13(8)一' },
      { name: '事故発生防止委員会 設置要綱', kind: '要綱', freq: '制定時', basis: '—' },
      { name: '事故発生防止委員会 議事録', kind: '議事録', freq: '定期（年4回程度で運用）・5年保存', basis: '指導指針 13(8)三' },
      { name: '事故発生防止研修 記録', kind: '記録', freq: '年1回以上で運用', basis: '指導指針 13(8)三' },
      { name: '担当者の選任の辞令', kind: '辞令', freq: '選任・変更時', basis: '指導指針 13(8)四' },
      { name: '事故報告書・ヒヤリハット報告と、分析・改善策の周知記録', kind: '記録', freq: '事象ごと・5年保存', basis: '指導指針 13(8)二・帳簿 9(3)ヘ' },
      { name: '市・家族への連絡記録と市への事故報告書', kind: '記録', freq: '事象ごと・速やかに', basis: '指導指針 13(9)' }
    ],
    complaint: [
      { name: '苦情対応規程', kind: '規程', freq: '常備', basis: '居宅基準 第36条／指導指針 13(7)' },
      { name: '苦情受付窓口の体制表（受付担当者・解決責任者）', kind: '記録', freq: '常備', basis: '居宅基準 第36条／指導指針 13(7)' },
      { name: '苦情受付・対応の記録', kind: '記録', freq: '事象ごと・5年保存', basis: '居宅基準 第36条2項／帳簿 9(3)ホ' },
      { name: '苦情相談窓口の掲示物（市・国保連の窓口を含む）', kind: '掲示', freq: '常時掲示', basis: '居宅基準 第32条／指導指針 13(7)' },
      { name: '重要事項説明書・契約書への苦情窓口の記載', kind: '規程', freq: '改正時', basis: '居宅基準 第8条／指導指針 13(4)' }
    ],
    privacy: [
      { name: '個人情報保護規程（医療・介護関係事業者のガイダンス準拠）', kind: '規程', freq: '常備', basis: '指導指針 9(4)／集団指導の手引き' },
      { name: '従業者の秘密保持誓約書（退職後を含む）', kind: '様式', freq: '入職時', basis: '居宅基準 第33条' },
      { name: '個人情報利用の同意書（担当者会議等での利用）', kind: '様式', freq: '契約時', basis: '居宅基準 第33条3項' },
      { name: '利用目的の掲示', kind: '掲示', freq: '常時掲示', basis: '個人情報保護法 第21条' },
      { name: '漏えい時の報告・本人通知の手順書', kind: '規程', freq: '常備', basis: '個人情報保護法 第26条' }
    ],
    harassment: [
      { name: 'ハラスメント防止の方針（就業規則・運営規程への記載）', kind: '規程', freq: '改正時', basis: '居宅基準 第30条4項／労働施策総合推進法' },
      { name: '相談窓口の周知（掲示・文書）', kind: '掲示', freq: '常時', basis: '労働施策総合推進法 第30条の2' },
      { name: '相談・対応の記録', kind: '記録', freq: '事象ごと', basis: '—' },
      { name: 'ハラスメント研修 記録', kind: '記録', freq: '年1回以上で運用', basis: '—' }
    ],
    fire: [
      { name: '防火管理者 選任（解任）届出書（消防署へ）', kind: '辞令', freq: '選任・変更時', basis: '消防法 第8条' },
      { name: '消防計画書（消防署へ届出）', kind: '計画', freq: '作成・変更時', basis: '消防法施行規則 第3条' },
      { name: '防火管理講習 修了証', kind: '記録', freq: '選任時（甲種・乙種）', basis: '消防法施行令 第3条' },
      { name: '消防訓練 実施記録（消防署へ事前通知）', kind: '記録', freq: '年2回以上', basis: '消防法施行規則 第3条' }
    ]
  };

  var COMMITTEE_MEET = {
    abuse: {
      freq: '定期的（年2回以上で運用）',
      attend: '管理者を含む幅広い職種で構成（管理者の出席が必須）',
      method: 'テレビ電話等で開催可。3事業所の合同開催可',
      minutes: '議事録は事業所ごとに分けて作る（日付・出席者・検討内容・結論・周知方法）',
      notify: '結果を職員に周知徹底',
      keep: '5年保存（熊本市）'
    },
    restraint: {
      freq: '3か月に1回以上（年4回）',
      attend: '施設長（責任者）・看護・介護・生活相談員など幅広い職種。責任者は虐待防止担当者と同一が望ましい',
      method: 'テレビ電話等可。事故発生防止委員会と同日開催でよい',
      minutes: '議事録は委員会ごとに別に作る',
      notify: '結果を介護職員その他の従業者に周知徹底',
      keep: '5年保存（熊本市）'
    },
    infection: {
      freq: 'おおむね6か月に1回以上（年2回）',
      attend: '感染対策の知識を有する者（看護職員など）を含む幅広い職種',
      method: 'テレビ電話等可。合同開催可。BCP の研修・訓練と一体実施可',
      minutes: '議事録は事業所ごとに分けて作る',
      notify: '結果を職員に周知徹底',
      keep: '5年保存（熊本市）'
    },
    safety: {
      freq: '定期的（当社3事業所が対象かは要確認）',
      attend: '管理者とケアを行う職種を含む幅広い職種',
      method: 'テレビ電話等可',
      minutes: '開催ごとに記録',
      notify: '—',
      keep: '—'
    },
    kondan: {
      freq: '定期的（年2回程度で運用）',
      attend: '管理者・職員・入居者（要介護の方は身元引受人等）。学識経験者・民生委員など第三者を加えるよう努める',
      method: 'テレビ電話等可',
      minutes: '開催ごとに記録。定員が少ない等で困難な時は代替措置と入居者への説明が要る',
      notify: '入居者の要望・意見を運営に反映',
      keep: '5年保存（熊本市）'
    },
    dementia: {
      freq: '定期的（認知症加算を算定する時）',
      attend: '認知症介護の指導に係る専門的な研修の修了者を中心に',
      method: '—',
      minutes: '開催ごとに記録',
      notify: '—',
      keep: '—'
    },
    bcp: {
      freq: '委員会の設置義務はなし。研修・訓練は各年1回以上',
      attend: '全職員（欠席者は個別に実施）',
      method: '机上訓練でよい。感染症は感染対策の訓練と、災害は避難訓練と一体実施可。3事業所の合同可',
      minutes: '研修記録・訓練記録は事業所ごとに作る',
      notify: '計画を職員に周知',
      keep: '5年保存（熊本市）'
    },
    disaster: {
      freq: '避難訓練は年2回以上（施設はうち1回は夜間想定）',
      attend: '全職員。地域住民の参加が得られるよう連携に努める',
      method: '消防訓練として実施。BCP の訓練と併せて実施可',
      minutes: '訓練ごとに記録（区分・参加者・課題）',
      notify: '計画を定期的に職員へ周知',
      keep: '5年保存（熊本市）'
    },
    hygiene: {
      freq: '委員会の設置義務はなし',
      attend: '選任の要否は事業場の数え方で決まる（要確認）',
      method: '—',
      minutes: '—',
      notify: '選任したら氏名を職員に周知',
      keep: '—'
    },
    accident: {
      freq: '定期的（年4回程度で運用）',
      attend: '施設長・看護・介護・生活相談員・機能訓練指導員など幅広い職種',
      method: 'テレビ電話等可。身体的拘束等適正化委員会と同日開催でよい',
      minutes: '議事録は委員会ごとに別に作る',
      notify: '分析を通した改善策を職員に周知徹底',
      keep: '5年保存（熊本市）'
    },
    complaint: {
      freq: '委員会ではない（受付→記録→解決責任者の判断→改善の流れ）',
      attend: '受付担当者と解決責任者を分けて置く',
      method: '—',
      minutes: '苦情ごとに記録',
      notify: '外部の苦情処理機関（市・国保連）を利用者・入居者に周知',
      keep: '5年保存（熊本市）'
    },
    privacy: {
      freq: '委員会ではない',
      attend: '管理責任者1名（法人で1名でよい）',
      method: '—',
      minutes: '誓約書・同意書の取得台帳',
      notify: '利用目的を掲示・公表',
      keep: '誓約書は退職後も保管'
    },
    harassment: {
      freq: '委員会ではない（研修は年1回以上で運用）',
      attend: '相談担当者は相談者と利害のない者を置く',
      method: '—',
      minutes: '相談ごとに記録（相談者の不利益にならないよう秘密を守る）',
      notify: '方針と窓口を職員に周知',
      keep: '—'
    },
    fire: {
      freq: '委員会ではない',
      attend: '防火管理者は管理的・監督的な地位の者で講習修了者',
      method: '—',
      minutes: '消防計画に基づく自主点検の記録',
      notify: '—',
      keep: '—'
    }
  };

  /* ある委員会の必要書類と開催の条件。{ docs: [...], meet: {...} } の写しを返す（呼び手が壊しても表は崩れない）。
     どちらの表にも無い code（人が足した委員会）・空・文字列でない値は null */
  function committeeDocs(code) {
    if (typeof code !== 'string') return null;
    var c = trim(code);
    if (c === '') return null;
    var hasDocs = Object.prototype.hasOwnProperty.call(COMMITTEE_DOCS, c);
    var hasMeet = Object.prototype.hasOwnProperty.call(COMMITTEE_MEET, c);
    if (!hasDocs && !hasMeet) return null;
    /* sites を書かない書類の補い先: いまのマスタ → 無ければ出荷時の既定 */
    var cur = committeeOf(c), base = null, i, k;
    for (i = 0; i < COMMITTEE_DEFAULTS.length; i++) if (COMMITTEE_DEFAULTS[i].code === c) { base = COMMITTEE_DEFAULTS[i]; break; }
    var defSites = (cur && Object.prototype.toString.call(cur.sites) === '[object Array]') ? cur.sites
                 : (base ? base.sites : []);
    var docs = [], src = hasDocs ? COMMITTEE_DOCS[c] : [];
    for (i = 0; i < src.length; i++) {
      var d = src[i];
      docs.push({
        name: d.name,
        kind: d.kind,
        sites: (Object.prototype.toString.call(d.sites) === '[object Array]' ? d.sites : defSites).slice(),
        freq: d.freq,
        basis: d.basis
      });
    }
    var meet = {}, m = hasMeet ? COMMITTEE_MEET[c] : {};
    for (i = 0; i < COMMITTEE_MEET_KEYS.length; i++) {
      k = COMMITTEE_MEET_KEYS[i];
      meet[k] = (typeof m[k] === 'string' && trim(m[k]) !== '') ? m[k] : '—';
    }
    return { docs: docs, meet: meet };
  }

  /* 1人の所属 [{code,role}]。マスタに無い委員会・3種以外の役割は落とし、同じ委員会は先勝ち。
     配列でなければ空（シートを直接いじった等で壊れた値が来ても画面を止めない） */
  function committeesOf(row) {
    var src = row ? row.committeesJson : null;
    var out = [], seen = {};
    if (Object.prototype.toString.call(src) !== '[object Array]') return out;
    for (var i = 0; i < src.length; i++) {
      var it = src[i];
      if (!it || typeof it !== 'object') continue;
      var code = trim(it.code), role = trim(it.role);
      if (!committeeOf(code)) continue;
      if (!Object.prototype.hasOwnProperty.call(ROLE_ORDER, role)) continue;
      if (Object.prototype.hasOwnProperty.call(seen, code)) continue;
      seen[code] = 1;
      out.push({ code: code, role: role });
    }
    return out;
  }

  /* 氏名順。一覧の既定の並びと同じ作法（フリガナが無ければ氏名で寄せ、同名は ID で決める） */
  function byKanaThenId(a, b) {
    var x = normKana((a && a.kana) || (a && a.name)), y = normKana((b && b.kana) || (b && b.name));
    if (x === y) return trim(a && a.id) < trim(b && b.id) ? -1 : 1;
    return x < y ? -1 : 1;
  }

  /* ある委員会の構成員 [{row, role}]。在職者だけ（退職者は名簿に残さない）。
     並びは 委員長 → 担当者 → 委員、同じ役割の中は氏名順 */
  function committeeMembers(rows, code, asOf) {
    var a = asOf || today();
    var c = committeeOf(code);
    var out = [], i, j;
    if (!c) return out;
    for (i = 0; rows && i < rows.length; i++) {
      if (!isActiveAt(rows[i], a)) continue;
      var mine = committeesOf(rows[i]);
      for (j = 0; j < mine.length; j++) {
        if (mine[j].code !== c.code) continue;
        out.push({ row: rows[i], role: mine[j].role });
        break;                                                  /* 同じ委員会は先勝ちで1件だけ */
      }
    }
    out.sort(function (x, y) {
      if (ROLE_ORDER[x.role] !== ROLE_ORDER[y.role]) return ROLE_ORDER[x.role] - ROLE_ORDER[y.role];
      return byKanaThenId(x.row, y.row);
    });
    return out;
  }

  /* 委員会ごとの人数と注意。元の rows は読むだけで書き換えない。
     warn は減算の要件（担当者・委員長）を先に出す。現在は対象外（inactive）の委員会には出さない */
  function committeeStats(rows, asOf) {
    var a = asOf || today();
    var list = COMMITTEES, out = [], i, j;
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      var mem = committeeMembers(rows, c.code, a);
      var n = { chair: 0, officer: 0, member: 0 };
      var jobs = {}, jobKinds = 0;
      for (j = 0; j < mem.length; j++) {
        n[mem[j].role]++;
        var job = trim(mem[j].row && mem[j].row.jobTitle);
        /* 職種が空の人は「1職種」に数えない（未入力と1職種は別物） */
        if (job !== '' && !Object.prototype.hasOwnProperty.call(jobs, job)) { jobs[job] = 1; jobKinds++; }
      }
      var warn = [];
      var kind = normKind(c.kind);
      /* ★対象事業所が無い委員会（2026-09-23.6 本人の指示・いまは生産性向上だけ）は、体制の警告
         （担当者・委員長・委員・職種）を出さず「要確認」だけ残す。条文上どの事業所も対象でないのに
         「委員長が決まっていません」と刷ると、必要のない体制を自分から欠員として書いた紙になる。
         ★委員会でない体制に委員長・委員が入っている時の注意は、データの誤りなので残す。
         ★既定にある委員会だけに効かせる（既定の対象事業所が空＝条文上どこも対象でない）。人が足した
           委員会で対象事業所を入れ忘れただけのものまで警告を消すと、足りない体制を見落とす。 */
      var noSite = !(c.sites && c.sites.length) && !!defaultCommittee(c.code);
      if (!c.inactive) {
        /* ★担当者の注意は「減算のある委員会」だけに出す（2026-09-22 レビュー 中1）。
           penalty の非空で判定すると、減算ではなく令和9年4月からの義務を書いてある
           safety にも「（減算の要件です）」が出る。この文言は紙にも刷られるため、
           実地指導に出す書類へ存在しない減算要件を自分から書くことになる。
           そもそも safety に担当者の定めは無く、要件は構成員の職種の幅である。
           ★種別によらず出す。BCP（計画と訓練）にも担当者の定めがあり減算もあるため。 */
        if (!noSite && c.hasPenalty === true && n.officer === 0) warn.push('担当者が決まっていません（減算の要件です）');
        /* ★委員長・委員の注意は委員会だけ（spec-committee2.md §3）。計画と訓練・選任は
           そもそも委員会ではないので、出すと実在しない要件を紙に刷ることになる。 */
        if (!noSite && kind === 'committee') {
          if (n.chair === 0) warn.push('委員長が決まっていません');
          if (mem.length === 0) warn.push('委員が1人もいません');
        }
        /* ★逆に、委員会でない体制に委員長・委員が入っていたら直してもらう（2026-09-22.3 レビュー2）。
           サーバーも保存を断るが、第1版の画面（9件すべてに委員長の欄を出す）が先に保存した分は
           すでに入っているので、画面に出して直せるようにする。
           ★委員長だけでなく委員も見る。この機能の目的は「実地指導に出す紙に、存在しない役職を
             刷らせない」ことなので、片方だけ止めても目的の半分しか果たせない。
           ★数えるだけで、隠しも消しもしない（隠すと画面からその人を外せなくなる）。 */
        if (kind !== 'committee' && (n.chair > 0 || n.member > 0)) {
          warn.push('委員会ではないので委員長・委員は置けません（担当者に直してください）');
        }
        if (!noSite && c.code === 'safety' && jobKinds <= 1) warn.push('幅広い職種で構成することが望ましい委員会です（いまは1職種）');
        /* 事故発生防止は減算こそ無いが、指導指針 13(8)四 が担当者を置くことを求める（2026-11-06）。減算の文面とは分ける */
        if (!noSite && c.code === 'accident' && n.officer === 0) warn.push('担当者が決まっていません（指導指針の要件です）');
        /* 法令上の扱いが未確定のもの（衛生推進者の選任）。結論が出るまで画面に出し続ける */
        if (c.todo === true) warn.push('要確認（法令上の扱いを確かめてください）');
      }
      out.push({
        code: c.code,
        label: c.label,
        alias: trim(c.alias),
        kind: kind,
        sites: c.sites.slice(),
        freq: c.freq,
        basis: c.basis,
        penalty: c.penalty,
        hasPenalty: c.hasPenalty === true,        /* 減算の有無（2026-09-22.2 レビュー6）。penalty の文面からは判定しない */
        purpose: trim(c.purpose),
        training: trim(c.training),
        drill: trim(c.drill),
        /* 画面が「開く」リンクと「何を確認するか」を出すのに使う（2026-09-22.5） */
        url: trim(c.url),
        /* 画面と紙の「いつから」（2026-09-23.2）。制度の対象開始月と、当事業所が始めた月 */
        startedAt: trim(c.startedAt),
        siteStartedAt: trim(c.siteStartedAt),
        todoNote: trim(c.todoNote),
        todo: c.todo === true,
        inactive: c.inactive === true,
        total: mem.length,
        chair: n.chair,
        officer: n.officer,
        member: n.member,
        warn: warn
      });
    }
    return out;
  }

  /* ── CSV（RFC4180） ────────────────────────────────────────────── */

  /* BOM除去・CRLF/LF/CR・引用符内のカンマと改行に対応。全セルが空の行は落とす */
  function parseCsv(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var rows = [], row = [], cell = '', inQ = false, i = 0;

    /* toCsv が数式よけに前置した ' を1個だけ外す（元から ' で始まる値は toCsv が ' を足しているので往復で消えない） */
    function endCell() { row.push(/^'+[=+\-@\t\r＝＋－＠]/.test(cell) ? cell.slice(1) : cell); cell = ''; }
    function endRow() {
      endCell();
      var empty = true;
      for (var k = 0; k < row.length; k++) { if (row[k] !== '') { empty = false; break; } }
      if (!empty) rows.push(row);
      row = [];
    }

    while (i < s.length) {
      var c = s.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { endCell(); i++; continue; }
      if (c === '\r') {
        endRow();
        i += (s.charAt(i + 1) === '\n') ? 2 : 1;
        continue;
      }
      if (c === '\n') { endRow(); i++; continue; }
      cell += c; i++;
    }
    endRow();
    return rows;
  }

  /* Excel が数式として実行する先頭文字（= + - @ タブ CR。日本語版の全角 ＝＋－＠ も予防で含める）のセルに ' を前置する（CSV インジェクション対策）。
     ただの数値（-12・0.5・+5）と「-」1文字は数式にならないので触らない。先頭の ' は読み飛ばして判定する＝往復で値が変わらない */
  function csvSafe(v) {
    if (v === '-' || /^[-+]?\d+(\.\d+)?$/.test(v)) return v;
    return /^'*[=+\-@\t\r＝＋－＠]/.test(v) ? "'" + v : v;
  }

  /* Excel で開くための書出し。BOM付き UTF-8・CRLF・全セル引用（日付や 0 始まりを化けさせない） */
  function toCsv(rows2d) {
    var out = '﻿';
    for (var i = 0; rows2d && i < rows2d.length; i++) {
      var r = rows2d[i] || [];
      var cells = [];
      for (var j = 0; j < r.length; j++) {
        var v = csvSafe((r[j] === null || r[j] === undefined) ? '' : String(r[j]));
        cells.push('"' + v.replace(/"/g, '""') + '"');
      }
      out += cells.join(',') + '\r\n';
    }
    return out;
  }

  /* ── 旧スプレッドシート「職員一覧」1行 → アプリ項目（design-db.md §6-1） ── */

  /* 見出しの表記ゆれ（[merged] 印・空白）を落として突き合わせる。位置では決め打ちしない */
  function normHeader(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '')
      .replace(/\[merged\]/gi, '')
      .replace(RE_SPACE, '');
  }

  /* ◯・1・TRUE 等を true、空・0・×・- を false と見る（旧シートは記号が揺れている） */
  function isMark(v) {
    var t = trim(v);
    if (t === '') return false;
    if (t === '0' || t === '×' || t === 'x' || t === 'X' || t === '-' || t === '−' || t === 'false' || t === 'FALSE') return false;
    return true;
  }

  /* 資格名 → コード。「社会福祉士主事」を「社会福祉士」より先に引くため完全一致表で持つ */
  var QUAL_MAP = {
    '介護福祉士': 'cw',
    '実務者研修': 'jitsumu', '介護福祉士実務者研修': 'jitsumu',
    '初任者研修': 'shonin', '介護職員初任者研修': 'shonin',
    'ヘルパー1級': 'helper1', 'ホームヘルパー1級': 'helper1', '訪問介護員1級': 'helper1',
    'ヘルパー2級': 'helper2', 'ホームヘルパー2級': 'helper2', '訪問介護員2級': 'helper2',
    '基礎研修': 'kiso', '介護職員基礎研修': 'kiso',
    '介護支援専門員': 'cm', 'ケアマネジャー': 'cm', 'ケアマネージャー': 'cm',
    '看護師': 'nurse', '正看護師': 'nurse',
    '准看護師': 'anurse',
    '理学療法士': 'pt',
    '作業療法士': 'ot',
    '社会福祉士': 'sw',
    '社会福祉士主事': 'swshuji', '社会福祉主事': 'swshuji',
    '薬剤師': 'pharm',
    '管理栄養士': 'dietitian',
    '調理師': 'cook',
    '無資格': 'none', 'なし': 'none'
  };

  function parseQuals(raw) {
    var out = [];
    var s = nfkc(raw).replace(/^[\s　]+|[\s　]+$/g, '');
    if (s === '') return out;
    var parts = s.split(/[・、,\/]+/);
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var t = trim(parts[i]);
      if (t === '') continue;
      var code = QUAL_MAP[t] || null;
      var key = code ? code : ('other:' + t);
      if (seen[key]) continue;
      seen[key] = 1;
      if (code) out.push({ code: code, acquiredOn: '' });
      else out.push({ code: 'other', label: t, acquiredOn: '' });
    }
    return out;
  }

  function mapLegacyRow(headerCells, rowCells) {
    var fields = {}, issues = [];
    var head = [], i;
    for (i = 0; headerCells && i < headerCells.length; i++) head.push(normHeader(headerCells[i]));

    function idxOf(name) {
      var n = normHeader(name);
      for (var k = 0; k < head.length; k++) if (head[k] === n) return k;
      return -1;
    }
    function idxStarting(prefix) {
      var n = normHeader(prefix), a = [];
      for (var k = 0; k < head.length; k++) if (head[k].indexOf(n) === 0) a.push(k);
      return a;
    }
    function cell(name) {
      var k = idxOf(name);
      if (k < 0) return '';
      return trim(rowCells && rowCells[k]);
    }
    function note(key, reason) { issues.push({ key: key, reason: reason }); }

    /* 日付4種。非空なのに読めないものは埋めずに止める（勝手に補完しない） */
    function putDate(key, headName) {
      var raw = cell(headName);
      if (raw === '') return;
      var v = normDate(raw);
      if (v) fields[key] = v;
      else note(key, LABELS[key] + '「' + raw + '」を日付として読めません');
    }

    /* No・氏名・フリガナ */
    var no = cell('No');
    if (no === '') no = cell('No.');
    if (no !== '') fields.legacyNo = String(no);

    var nameIdx = idxOf('氏名');
    var nameRaw = nameIdx >= 0 ? trim(rowCells && rowCells[nameIdx]) : '';
    if (nameRaw !== '') {
      fields.name = nfkc(nameRaw).replace(/[\s　]+/g, ' ').replace(/^ | $/g, '');
    } else {
      note('name', '氏名が空です');
    }

    /* フリガナ列は見出しが空。「氏名の直後の列で、値がカタカナ主体」のときだけ採る */
    if (nameIdx >= 0 && head.length > nameIdx + 1 && head[nameIdx + 1] === '') {
      var kanaRaw = trim(rowCells && rowCells[nameIdx + 1]);
      if (kanaRaw !== '') {
        var body = kanaRaw.replace(RE_SPACE, '');
        var kana = body.replace(/[^゠-ヿぁ-ゖｦ-ﾟー]/g, '');
        if (body.length && kana.length / body.length >= 0.6) fields.kana = toKanaField(kanaRaw);
      }
    }

    /* 性別 */
    var g = cell('性別');
    if (g !== '') {
      var gn = nfkc(g);
      if (gn === '男' || gn === '男性' || gn === 'M' || gn === 'm') fields.gender = 'M';
      else if (gn === '女' || gn === '女性' || gn === 'F' || gn === 'f') fields.gender = 'F';
      else note('gender', '性別「' + g + '」を判定できません');
    }

    putDate('birthDate', '生年月日');
    putDate('hireDate', '入職日');
    putDate('retireDate', '退職日');
    putDate('careStartDate', '介護就職');

    /* 退職欄が立っているのに退職日が空＝在籍状態が決まらない（退職日から導出する設計のため） */
    var taishoku = cell('退職');
    if (taishoku !== '' && isMark(taishoku) && !fields.retireDate) {
      note('retireDate', '退職欄が立っていますが退職日が空です');
    }

    /* 職種 */
    var job = cell('職種');
    if (job !== '') fields.jobTitle = job;

    /* 勤務形態（同名2列。1つ目=常勤/非常勤・2つ目=専従/兼務。値でも見分ける）。無ければ「形態」列 */
    var wsIdx = idxStarting('勤務形態');
    var v1 = wsIdx.length > 0 ? trim(rowCells && rowCells[wsIdx[0]]) : '';
    var v2 = wsIdx.length > 1 ? trim(rowCells && rowCells[wsIdx[1]]) : '';
    var joined = v1 + '・' + v2;
    if (trim(joined.replace(/・/g, '')) === '') joined = cell('形態');
    var ws = null;
    if (joined !== '') {
      var full = /非常勤/.test(joined) ? false : (/常勤/.test(joined) ? true : null);
      var ded = /兼務/.test(joined) ? false : (/専従/.test(joined) ? true : null);
      if (full !== null && ded !== null) ws = (full ? 'full_' : 'part_') + (ded ? 'ded' : 'con');
      else if (full !== null || ded !== null) note('workStyle', '勤務形態「' + joined + '」は常勤/非常勤と専従/兼務の片方しか読めません');
      else note('workStyle', '勤務形態「' + joined + '」を判定できません');
    }
    if (ws) fields.workStyle = ws;

    /* 雇用区分 */
    var emp = cell('雇用');
    if (emp === '') emp = cell('雇用形態');
    if (emp !== '') {
      var en = nfkc(emp);
      var et = '';
      if (/役員/.test(en)) et = 'officer';
      else if (/正社員|正規|正職員/.test(en)) et = 'regular';
      else if (/契約/.test(en)) et = 'contract';
      else if (/パート|アルバイト|非正規/.test(en)) et = 'part';
      else if (/臨時/.test(en)) et = 'temp';
      if (et) fields.employmentType = et;
      else note('employmentType', '雇用「' + emp + '」を雇用区分に対応づけられません');
    }

    /* 事業所4列 */
    var siteKeys = [['施設', 'siteFacility', 'facility'], ['訪問', 'siteVisit', 'visit'], ['通所', 'siteDay', 'day'], ['居宅', 'siteCm', 'cm']];
    var on = [];
    for (i = 0; i < siteKeys.length; i++) {
      var k = idxOf(siteKeys[i][0]);
      if (k < 0) continue;
      var b = isMark(rowCells && rowCells[k]);
      fields[siteKeys[i][1]] = b;
      if (b) on.push(siteKeys[i][2]);
    }

    /* 主たる事業所は推測しない。◯が1つならそれ、複数なら空のまま要確認 */
    if (on.length === 1) {
      fields.primarySite = on[0];
    } else if (on.length > 1) {
      note('primarySite', '事業所が' + on.length + 'つ付いています。主たる事業所を選んでください');
    } else if (/厨房/.test(fields.jobTitle || '')) {
      fields.primarySite = 'kitchen';
    }
    /* 印がゼロの行は要確認にしない（旧名簿の退職者は所属欄が空のまま。空＝未設定として通す） */

    /* 資格。介護福祉士の取得日は「資格取得日」列から入れる */
    var quals = parseQuals(cell('資格'));
    var hasCw = false;
    for (i = 0; i < quals.length; i++) if (quals[i].code === 'cw') hasCw = true;
    if (!hasCw && isMark(cell('介護福祉士'))) { quals.push({ code: 'cw', acquiredOn: '' }); hasCw = true; }
    if (hasCw) {
      var acqRaw = cell('資格取得日');
      var acq = acqRaw === '' ? null : normDate(acqRaw);
      if (acq) {
        for (i = 0; i < quals.length; i++) if (quals[i].code === 'cw') quals[i].acquiredOn = acq;
      } else if (acqRaw !== '') {
        note('qualsJson', '資格取得日「' + acqRaw + '」を日付として読めません');
      } else {
        note('qualsJson', '介護福祉士の取得日が空です');
      }
    }
    if (quals.length) fields.qualsJson = quals;

    /* 連絡先・住所・雇用保険番号・備考 */
    var phone = cell('連絡先');
    if (phone === '') phone = cell('電話');
    if (phone !== '') fields.phone = normDash(nfkc(phone)).replace(RE_SPACE, '');
    var addr = cell('住所');
    if (addr !== '') {
      fields.address = normDash(addr.replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      }));
    }
    var ein = cell('雇用保険番号');
    if (ein !== '') {
      var e2 = normDash(nfkc(ein)).replace(/[^0-9-]/g, '');
      if (e2 !== '') fields.empInsNo = e2;
    }
    var memo = cell('備考');
    if (memo !== '') fields.note = memo;

    return { fields: fields, issues: issues };
  }

  /* ── 部分更新の差分（変えた項目だけを送る） ────────────────────── */

  function isEmptyVal(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return trim(v) === '';
    if (Object.prototype.toString.call(v) === '[object Array]') return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;                                               /* 0・false は「値」であって空ではない */
  }

  function isObj(v) {
    return v !== null && typeof v === 'object';
  }

  /* 資格配列を「比べるための形」に揃える。code で並べ替え、空の取得日は落とす。
     画面が開いた直後の並び替えだけで未保存扱いになるのを防ぐ。保存する値はこれを通さない
     （label など元の項目をそのまま送るため）。 */
  function normQuals(v) {
    var a = (Object.prototype.toString.call(v) === '[object Array]') ? v : [];
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var q = a[i];
      if (!q || typeof q !== 'object' || trim(q.code) === '') continue;
      var o = { code: trim(q.code) };
      if (trim(q.acquiredOn) !== '') o.acquiredOn = trim(q.acquiredOn);
      if (trim(q.label) !== '') o.label = trim(q.label);
      out.push(o);
    }
    out.sort(function (x, y) { return x.code < y.code ? -1 : (x.code > y.code ? 1 : 0); });
    return out;
  }

  /* base と edited を比べ、変えた項目だけ返す。同値は含めず、空にした項目は null で送る */
  function diffFields(base, edited) {
    var b = base || {}, e = edited || {}, out = {};
    var keys = Object.keys(e);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var bv = b[k], ev = e[k];
      var bEmpty = isEmptyVal(bv), eEmpty = isEmptyVal(ev);

      if (eEmpty) {
        if (!bEmpty) out[k] = null;                             /* 消した＝null で明示（未指定と区別する） */
        continue;
      }
      if (k === 'qualsJson') {                                  /* 並び順・空の取得日の差は変更に数えない */
        if (JSON.stringify(normQuals(bv)) !== JSON.stringify(normQuals(ev))) out[k] = ev;
        continue;
      }
      if (isObj(ev) || isObj(bv)) {
        if (JSON.stringify(bv === undefined ? null : bv) !== JSON.stringify(ev)) out[k] = ev;
        continue;
      }
      if (typeof ev === 'string' || typeof bv === 'string') {
        var bs = (bv === null || bv === undefined) ? '' : trim(String(bv));
        var es = trim(String(ev));
        if (bs !== es) out[k] = es;
        continue;
      }
      if (bv !== ev) out[k] = ev;
    }
    return out;
  }

  /* ── 公開 ──────────────────────────────────────────────────────── */

  var StaffCalc = {
    VERSION: VERSION,
    ymd: ymd,
    normDate: normDate,
    toWareki: toWareki,
    today: today,
    age: age,
    tenure: tenure,
    statusOf: statusOf,
    headAt: headAt,
    leavers: leavers,
    turnover: turnover,
    period: period,
    averageTenureYears: averageTenureYears,
    averageAge: averageAge,
    composition: composition,
    SITE_CODES: SITE_CODES,
    SITE_ACTIVE: SITE_ACTIVE,
    SITE_COL: SITE_COL,
    SITE_LABEL: SITE_LABEL,
    normSiteLabels: normSiteLabels,
    SITE_LABEL_RESERVED: SITE_LABEL_RESERVED,
    setSiteLabels: setSiteLabels,
    KITCHEN_SITES: KITCHEN_SITES,
    normCorp: normCorp,
    setCorp: setCorp,
    corp: corp,
    corpDefault: corpDefault,
    belongsTo: belongsTo,
    siteRatios: siteRatios,
    ratioTotal: ratioTotal,
    siteStats: siteStats,
    normName: normName,
    normKana: normKana,
    parseCsv: parseCsv,
    toCsv: toCsv,
    LABELS: LABELS,
    ENUMS: ENUMS,
    setEnums: setEnums,
    visibleEnum: visibleEnum,
    COMMITTEE_DEFAULTS: COMMITTEE_DEFAULTS,
    RETIRED_DEFAULT_FREQ: RETIRED_DEFAULT_FREQ,
    RETIRED_DEFAULT_ALIAS: RETIRED_DEFAULT_ALIAS,
    COMMITTEE_ROLES: COMMITTEE_ROLES,
    COMMITTEE_KINDS: COMMITTEE_KINDS,
    setCommittees: setCommittees,
    setLocality: setLocality,
    locality: locality,
    localDefaults: localDefaults,
    committees: committees,
    committeeOf: committeeOf,
    committeesOf: committeesOf,
    committeeMembers: committeeMembers,
    committeeStats: committeeStats,
    committeeDocs: committeeDocs,
    COMMITTEE_DOC_KINDS: COMMITTEE_DOC_KINDS,
    mapLegacyRow: mapLegacyRow,
    diffFields: diffFields,
    normQuals: normQuals,
    /* 下ごしらえ（テストと画面の日付計算で使う。契約の一部ではない） */
    isLeap: isLeap,
    lastDay: lastDay,
    addDays: addDaysIso
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = StaffCalc;
  else root.StaffCalc = StaffCalc;
})(typeof window !== 'undefined' ? window : this);
