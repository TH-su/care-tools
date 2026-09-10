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
     StaffCalc.normName / normKana / parseCsv / toCsv
     StaffCalc.LABELS / ENUMS / setEnums / visibleEnum / mapLegacyRow / diffFields
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

  var VERSION = '2026-09-10.7';

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
  var RE_WAREKI = /^([MTSHR]|明治|大正|昭和|平成|令和)\s*(\d{1,2}|元)[\.\/\-年](\d{1,2})[\.\/\-月](\d{1,2})日?$/;
  var RE_SERIAL = /^\d{5}$/;
  var RE_YMD8 = /^(\d{4})(\d{2})(\d{2})$/;

  /* 妥当性（月日の実在＋1900〜翌年）。範囲外は null を返し、呼び手が「要確認」で止める */
  function inRange(y, m, d) {
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > lastDay(y, m)) return false;
    var maxY = +today().slice(0, 4) + 1;
    return y >= 1900 && y <= maxY;
  }

  function build(y, m, d) {
    if (!inRange(y, m, d)) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /* '2025/10/27' 'R7.10.27' '令和7年10月27日' '45957'（シリアル）'20251027' 等 → 'YYYY-MM-DD' */
  function normDate(raw) {
    var s = normDash(nfkc(raw)).replace(/^[\s　]+|[\s　]+$/g, '');
    if (s === '') return null;

    /* 途中の空白（'R 8. 9. 10'）と末尾の「生」（'昭和55年4月3日生'）を落としてから照合する */
    s = s.replace(RE_SPACE, '').replace(/生$/, '');
    if (s === '') return null;

    if (RE_SERIAL.test(s)) {                                    /* Excel/Sheets のシリアル値 */
      var base = daysFromCivil(1899, 12, 30);
      var o = civilFromDays(base + parseInt(s, 10));
      return build(o.y, o.m, o.d);
    }

    var m = RE_WEST.exec(s);
    if (m) return build(+m[1], +m[2], +m[3]);

    m = RE_WAREKI.exec(s);
    if (m) {
      var era = ERA_JA[m[1]] || m[1];
      var b = ERA_BASE[era];
      if (!b) return null;
      var n = (m[2] === '元') ? 1 : parseInt(m[2], 10);
      if (!(n >= 1)) return null;
      return build(b + n - 1, +m[3], +m[4]);
    }

    m = RE_YMD8.exec(s);
    if (m) return build(+m[1], +m[2], +m[3]);

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

  /* ── CSV（RFC4180） ────────────────────────────────────────────── */

  /* BOM除去・CRLF/LF/CR・引用符内のカンマと改行に対応。全セルが空の行は落とす */
  function parseCsv(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var rows = [], row = [], cell = '', inQ = false, i = 0;

    function endCell() { row.push(cell); cell = ''; }
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

  /* Excel で開くための書出し。BOM付き UTF-8・CRLF・全セル引用（日付や 0 始まりを化けさせない） */
  function toCsv(rows2d) {
    var out = '﻿';
    for (var i = 0; rows2d && i < rows2d.length; i++) {
      var r = rows2d[i] || [];
      var cells = [];
      for (var j = 0; j < r.length; j++) {
        var v = (r[j] === null || r[j] === undefined) ? '' : String(r[j]);
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
    normName: normName,
    normKana: normKana,
    parseCsv: parseCsv,
    toCsv: toCsv,
    LABELS: LABELS,
    ENUMS: ENUMS,
    setEnums: setEnums,
    visibleEnum: visibleEnum,
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
