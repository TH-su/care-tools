/* payroll-withholding-slip.js — 源泉徴収票（受給者交付用）と、法定調書合計表・給与支払報告書の総括表の値（2026-11-23 新設・凍結仕様 ROOT-yearend.md の B3）
 * ════════════════════════════════════════════════════════════════
 * ・slipValues(result, staffInfo, company) … computeYearEnd の結果から源泉徴収票の欄の値を作る
 * ・slipHtml(values | [values…]) … 印刷用の HTML（A4 1枚に2人分）。文字は全部エスケープする
 * ・summaryValues([values…]) … 「給与所得の源泉徴収票合計表（375）」の欄と、給与支払報告書の総括表の人数
 * ・toCsv([values…], summary?) … 人が e-Tax／eLTAX／紙に写す用の値の一覧
 * ・欄の順と書き方の出典: 手引「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」p.3〜12（第2章）・p.31（第8章）
 *   https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/all.pdf
 *   受給者交付用の様式そのもの（枠の位置）は確かめていないので、HTML の頭に「様式の並びは未検証」と出す
 * ・マイナンバー・法人番号の欄は作らない（手引 p.5・p.10・p.11: 受給者に交付する源泉徴収票には書かない）
 * ・住所は持たない（住所の欄は空欄で手で書く・仮置き）。市区町村ごとの振り分けは作らない（人が行う）
 * ・氏名などの個人情報をこのファイルに書かない
 */
(function (root) {
  'use strict';
  var VERSION = 'withholding-slip-1';
  var SLIP_RETIRE_MAX = 300000;   /* 手引 p.3: 年の中途で退職した人で支払額が30万円以下は提出しない（令和8年分から） */
  var UNVERIFIED = '様式の並びは未検証';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime()); }
  function yen(n) { return (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('ja-JP'); }

  /* 和暦（受給者生年月日の元号・手引 p.11 の欄28 の書き方は「元号を漢字で」） */
  var ERAS = [['令和', '2019-05-01'], ['平成', '1989-01-08'], ['昭和', '1926-12-25'], ['大正', '1912-07-30'], ['明治', '1868-01-25']];
  function wareki(d) {
    if (!isDate(d)) return null;
    for (var i = 0; i < ERAS.length; i++) if (d >= ERAS[i][1]) {
      var y = Number(d.slice(0, 4)) - Number(ERAS[i][1].slice(0, 4)) + 1;
      return { era: ERAS[i][0], y: y, m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)), text: ERAS[i][0] + (y === 1 ? '元' : y) + '年' + Number(d.slice(5, 7)) + '月' + Number(d.slice(8, 10)) + '日' };
    }
    return null;
  }

  /* ── 1. 欄の値 ── */
  function slipValues(res, staffInfo, company) {
    res = res || {}; staffInfo = staffInfo || {}; company = company || {};
    var L = res.lines || {};
    var year = Number(res.year);
    var adj = !!(res.eligible && L.eligible);
    var joined = isDate(staffInfo.joined_on) && Number(staffInfo.joined_on.slice(0, 4)) === year ? staffInfo.joined_on : '';
    var left = isDate(staffInfo.left_on) && Number(staffInfo.left_on.slice(0, 4)) === year && staffInfo.left_on < year + '-12-31' ? staffInfo.left_on : '';
    var tekiyo = [];
    /* 家族の欄: 年末調整をした人は控除の区分、しない人は源泉控除対象配偶者・源泉控除対象親族（中途退職者の票にも書く・手引 p.10 欄22 注2・欄24 注1） */
    var fam = adj || !!L.family_gensen;
    /* 同じ年に中途就職と中途退職の両方: 退職と退職日だけ書き、摘要に「中途就」（手引 p.11 欄27 注・p.12 摘要(9)） */
    var both = !!(joined && left);
    if (both) joined = '';
    if (adj) {
      (L.prev_jobs || []).forEach(function (p) {
        /* 手引 p.12 の摘要 (6): 前の支払者の名・退職した日・給与等の金額・徴収した税額・社会保険料 */
        tekiyo.push('前職 ' + (p.address ? p.address + ' ' : '') + (p.payer || '') + (p.left_on ? ' ' + p.left_on + '退職' : '') + ' 支払 ' + yen(p.pay) + '円 税 ' + yen(p.tax) + '円 社保 ' + yen(p.si) + '円');
      });
      if (L.life_u23_applied) tekiyo.push('租税特別措置法第41条の15の5第1項適用');   /* 手引 p.11 の (4) */
      (L.adjust_names || []).forEach(function (n) { tekiyo.push((n.name || '') + '（調整）'); });   /* 手引 p.11 の (3) */
      if (L.spouse_doitsu_note) tekiyo.push(L.spouse_doitsu_note + '（同配）');   /* 手引 p.11 の (2) */
    }
    if (fam) {
      var deps = (L.dependents || []).concat(L.tokutei_names || []);
      deps.slice(4).forEach(function (n, i) { tekiyo.push('(' + (i + 1) + ')' + (n.name || '')); });   /* 5人目以降（手引 p.11 の (1)） */
      (L.under16_names || []).slice(4).forEach(function (n, i) { tekiyo.push('(' + (i + 1) + ')' + (n.name || '') + '（年少）'); });
    }
    if (both) tekiyo.push('中途就');   /* 手引 p.12 の (9) */
    var birth = isDate(staffInfo.birth) ? staffInfo.birth : (isDate(staffInfo.birth_date) ? staffInfo.birth_date : '');
    return {
      version: VERSION, year: year, adjusted: adj,
      title: '令和' + (year - 2018) + '年分 給与所得の源泉徴収票',
      /* 支払を受ける者（住所は空欄・マイナンバーの欄は無い） */
      address: '', name: staffInfo.name || '', kana: staffInfo.kana || '', post: staffInfo.post || '', staff_id: staffInfo.staff_id || '',
      shubetsu: L.shubetsu || '給料・賞与',
      pay: L.pay || 0,
      kyuyo_after: adj ? L.kyuyo_after : null,
      deductions_total: adj ? L.deductions_total : null,
      tax: L.tax || 0,
      own_pay: L.own_pay || 0, own_tax: L.own_tax || 0,
      spouse_has: fam && L.spouse_has ? '有' : '', spouse_elderly: !!(fam && L.spouse_elderly),
      spouse_deduction: adj ? (L.spouse_deduction || 0) : null,
      dep_specific: fam ? (L.dep_specific || 0) : 0, dep_elderly: fam ? (L.dep_elderly || 0) : 0, dep_elderly_cohabit: fam ? (L.dep_elderly_cohabit || 0) : 0,
      dep_other: fam ? (L.dep_other || 0) : 0, dep_tokutei: fam ? (L.dep_tokutei || 0) : 0, under16: fam ? (L.under16 || 0) : 0,
      disabled_special: fam ? (L.disabled_special || 0) : 0, disabled_special_cohabit: fam ? (L.disabled_special_cohabit || 0) : 0, disabled_other: fam ? (L.disabled_other || 0) : 0,
      nonresident: fam ? (L.nonresident || 0) : 0,
      tokutei_amount: adj ? (L.tokutei_amount || 0) : null,
      si_amount: L.si_amount || 0, small_biz: adj ? (L.small_biz || 0) : 0,
      life_amount: adj ? L.life_amount : null, quake_amount: adj ? L.quake_amount : null,
      housing_amount: adj ? L.housing_amount : null, housing_possible: adj ? L.housing_possible : null,
      housing_count: adj ? L.housing_count : 0, housing_start: adj ? L.housing_start : '', housing_kind: adj ? L.housing_kind : '',
      life_new: adj ? L.life_new : 0, life_old: adj ? L.life_old : 0, life_care: adj ? L.life_care : 0,
      pension_new: adj ? L.pension_new : 0, pension_old: adj ? L.pension_old : 0, old_long: adj ? L.old_long : 0,
      national_pension: adj ? (L.national_pension || 0) : 0,
      basic: adj ? L.basic : null, income_adjust: adj ? (L.income_adjust || null) : null,
      spouse_name: fam ? (L.spouse_name || '') : '', spouse_kana: fam ? (L.spouse_kana || '') : '', spouse_nonresident: !!(fam && L.spouse_nonresident),
      spouse_income: adj ? L.spouse_income : null,
      dependents: fam ? (L.dependents || []).concat(L.tokutei_names || []).slice(0, 4) : [],
      under16_names: fam ? (L.under16_names || []).slice(0, 4) : [],
      tekiyo: tekiyo.join(' ／ '),
      /* 乙欄の印は staffInfo.otsu で受ける（decl.kou=false は「年末調整の対象でない」で、甲欄の中途退職者も含むため・仮置き） */
      minor: !!staffInfo.minor, foreigner: !!staffInfo.foreigner, died: !!staffInfo.died, disaster: false, otsu: !!staffInfo.otsu,
      self_disability: adj ? (L.self_disability || '') : (staffInfo.self_disability || ''),
      widow: !!(adj && L.widow), single_parent: !!(adj && L.single_parent), working_student: !!(adj && L.working_student),
      joined_on: joined, left_on: left,
      birth: birth, birth_wareki: birth ? wareki(birth) : null,
      payer_name: company.name || '', payer_address: company.address || '', payer_tel: company.tel || ''
    };
  }

  /* ── 2. 印刷用 HTML（A4 1枚に2人分） ── */
  var CSS = '<style>' +
    '.wsl-page{page-break-after:always;break-after:page}.wsl-page:last-child{page-break-after:auto;break-after:auto}' +
    '.wsl{box-sizing:border-box;height:132mm;border:1px solid #000;padding:2mm 3mm;margin-bottom:3mm;font:9pt/1.3 "Hiragino Sans","Yu Gothic",sans-serif;color:#000;background:#fff;overflow:hidden}' +
    '.wsl h2{font-size:11pt;text-align:center;margin:0 0 1mm}.wsl .note{font-size:7pt;color:#555;text-align:right}' +
    '.wsl table{border-collapse:collapse;width:100%;table-layout:fixed}.wsl td,.wsl th{border:1px solid #000;padding:.6mm 1mm;vertical-align:top}' +
    '.wsl th{font-weight:normal;font-size:7pt;text-align:left;background:#f2f2f2}.wsl td.n{text-align:right;font-variant-numeric:tabular-nums}' +
    '.wsl .unv{font-size:7pt;color:#a00}' +
    '</style>';
  function chk(b) { return b ? '○' : ''; }
  function amt(v) { return (v === null || v === undefined) ? '' : yen(v); }
  function one(v) {
    var depRows = '';
    for (var i = 0; i < 4; i++) {
      var d = (v.dependents || [])[i] || {}, u = (v.under16_names || [])[i] || {};
      depRows += '<tr><th>控除対象扶養親族 ' + (i + 1) + '</th><td colspan="2">' + esc(d.kana ? d.kana + ' ' : '') + esc(d.name || '') + (d.nonresident ? '（非居住者）' : '') + '</td>' +
        '<th>16歳未満の扶養親族 ' + (i + 1) + '</th><td colspan="2">' + esc(u.kana ? u.kana + ' ' : '') + esc(u.name || '') + (u.nonresident ? '（非居住者）' : '') + '</td></tr>';
    }
    var b = v.birth_wareki;
    return '<div class="wsl">' +
      '<div class="note">' + esc(UNVERIFIED) + '（手引 p.4 の欄の順で作った表）</div>' +
      '<h2>' + esc(v.title) + '</h2>' +
      '<table>' +
      '<tr><th>支払を受ける者 住所又は居所</th><td colspan="3">' + esc(v.address) + '</td><th>氏名</th><td>' + esc(v.kana ? v.kana + ' ' : '') + esc(v.name) + (v.post ? '（' + esc(v.post) + '）' : '') + '</td></tr>' +
      '<tr><th>種別</th><th>支払金額</th><th>給与所得控除後の金額（調整控除後）</th><th>所得控除の額の合計額</th><th>源泉徴収税額</th><th></th></tr>' +
      '<tr><td>' + esc(v.shubetsu) + '</td><td class="n">' + amt(v.pay) + '</td><td class="n">' + amt(v.kyuyo_after) + '</td><td class="n">' + amt(v.deductions_total) + '</td><td class="n">' + amt(v.tax) + '</td><td></td></tr>' +
      '<tr><th>（源泉）控除対象配偶者の有無等</th><th>配偶者（特別）控除の額</th><th>控除対象扶養親族の数（特定・老人（内 同居）・その他・特親）</th><th>16歳未満扶養親族の数</th><th>障害者の数（本人を除く）特別（内 同居）・その他</th><th>非居住者である親族の数</th></tr>' +
      '<tr><td>' + esc(v.spouse_has) + (v.spouse_elderly ? ' 老人' : '') + '</td><td class="n">' + amt(v.spouse_deduction) + '</td>' +
      '<td>' + esc(v.dep_specific) + '・' + esc(v.dep_elderly) + '（' + esc(v.dep_elderly_cohabit) + '）・' + esc(v.dep_other) + '・' + esc(v.dep_tokutei) + '</td>' +
      '<td class="n">' + esc(v.under16) + '</td><td>' + esc(v.disabled_special) + '（' + esc(v.disabled_special_cohabit) + '）・' + esc(v.disabled_other) + '</td><td class="n">' + esc(v.nonresident) + '</td></tr>' +
      '<tr><th>特定親族特別控除の額</th><th>社会保険料等の金額（内 小規模企業共済等掛金）</th><th>生命保険料の控除額</th><th>地震保険料の控除額</th><th>住宅借入金等特別控除の額</th><th>基礎控除の額・所得金額調整控除額</th></tr>' +
      '<tr><td class="n">' + amt(v.tokutei_amount) + '</td><td class="n">' + amt(v.si_amount) + (v.small_biz ? '（内 ' + amt(v.small_biz) + '）' : '') + '</td><td class="n">' + amt(v.life_amount) + '</td><td class="n">' + amt(v.quake_amount) + '</td><td class="n">' + amt(v.housing_amount) + '</td><td class="n">' + amt(v.basic) + (v.income_adjust ? '・' + amt(v.income_adjust) : '') + '</td></tr>' +
      '<tr><th>生命保険料の金額の内訳</th><td colspan="5">新生命 ' + amt(v.life_new) + '・旧生命 ' + amt(v.life_old) + '・介護医療 ' + amt(v.life_care) + '・新個人年金 ' + amt(v.pension_new) + '・旧個人年金 ' + amt(v.pension_old) + '・国民年金保険料等 ' + amt(v.national_pension) + '・旧長期損害 ' + amt(v.old_long) + '</td></tr>' +
      '<tr><th>住宅借入金等特別控除の額の内訳</th><td colspan="5">適用数 ' + esc(v.housing_count || '') + '・可能額 ' + amt(v.housing_possible) + '・居住開始年月日 ' + esc(v.housing_start ? (wareki(v.housing_start) || {}).text || '' : '') + '・区分 ' + esc(v.housing_kind) + '</td></tr>' +
      '<tr><th>（源泉・特別）控除対象配偶者</th><td colspan="3">' + esc(v.spouse_kana ? v.spouse_kana + ' ' : '') + esc(v.spouse_name) + (v.spouse_nonresident ? '（非居住者）' : '') + '</td><th>配偶者の合計所得</th><td class="n">' + amt(v.spouse_income) + '</td></tr>' +
      depRows +
      '<tr><th>摘要</th><td colspan="5">' + esc(v.tekiyo) + '</td></tr>' +
      '<tr><th>未成年者・外国人・死亡退職・災害者・乙欄</th><td>' + [chk(v.minor), chk(v.foreigner), chk(v.died), chk(v.disaster), chk(v.otsu)].join('・') + '</td>' +
      '<th>本人が障害者（特別・その他）・寡婦・ひとり親・勤労学生</th><td>' + [chk(v.self_disability === 'special'), chk(v.self_disability === 'general'), chk(v.widow), chk(v.single_parent), chk(v.working_student)].join('・') + '</td>' +
      '<th>中途就・退職</th><td>' + (v.joined_on ? '就職 ' + esc(v.joined_on) : '') + (v.left_on ? ' 退職 ' + esc(v.left_on) : '') + '</td></tr>' +
      '<tr><th>受給者生年月日</th><td colspan="2">' + esc(b ? b.text : '') + '</td><th>支払者</th><td colspan="2">' + esc(v.payer_name) + (v.payer_address ? ' ' + esc(v.payer_address) : '') + (v.payer_tel ? ' 電話 ' + esc(v.payer_tel) : '') + '</td></tr>' +
      '</table></div>';
  }
  function slipHtml(values) {
    var list = Array.isArray(values) ? values : [values];
    list = list.filter(Boolean);
    var out = CSS + '<div class="wsl-head unv">' + esc(UNVERIFIED) + '（国税庁の受給者交付用の様式の枠の位置と同じではありません。欄の順は手引 p.4〜12 に合わせています）</div>';
    for (var i = 0; i < list.length; i += 2) {
      out += '<section class="wsl-page">' + one(list[i]) + (list[i + 1] ? one(list[i + 1]) : '') + '</section>';
    }
    return out;
  }

  /* ── 3. 合計表（375）と総括表の数 ── */
  function isMidRetired(v) { return !!(v && v.left_on && v.left_on < v.year + '-12-31'); }
  function submitTarget(v) { return !(isMidRetired(v) && (v.pay || 0) <= SLIP_RETIRE_MAX); }
  function summaryValues(list) {
    /* computeYearEnd の結果（lines を持つ）が渡されたら欄の値に直す（退職日が分からないので提出する側に数える） */
    var noStaff = 0;
    list = (Array.isArray(list) ? list : []).filter(Boolean).map(function (x) {
      if (x && x.lines && x.adjusted === undefined) { noStaff++; return slipValues(x, {}, {}); }
      return x;
    });
    var s = {
      /* A 俸給・給与・賞与等の総額（前職の分を含めない・手引 p.31） */
      total_people: 0, total_no_tax_people: 0, total_pay: 0, total_tax: 0,
      /* B 源泉徴収票を提出するもの（前職の分を含める・手引 p.31） */
      submit_people: 0, submit_pay: 0, submit_tax: 0,
      /* 給与支払報告書の総括表 */
      report_total_people: 0, report_people: 0,
      excluded: 0,
      notes: [
        '令和9年1月1日以降は、給与支払報告書を市区町村に出せば税務署へ源泉徴収票を出したものとみなされます（手引 p.2〜3）。その時は合計表の「1 給与所得の源泉徴収票合計表（375）」は書かなくてよい（手引 p.31）',
        '提出の範囲は、年の中途で退職した人で支払額が30万円以下の人を除く全員です（令和8年分から・手引 p.3）',
        '市区町村ごとの振り分けは住所を持たないので作っていません（人が行う）'
      ]
    };
    list.forEach(function (v) {
      var ownTax = v.adjusted ? Math.max(0, v.own_tax || 0) : (v.tax || 0);
      s.total_people++; s.total_pay += v.own_pay || 0; s.total_tax += ownTax;
      /* 「源泉徴収税額のない者」は源泉徴収票の源泉徴収税額の欄が0の人（手引 p.31） */
      if (!(v.tax || 0)) s.total_no_tax_people++;
      s.report_total_people++;
      if (submitTarget(v)) { s.submit_people++; s.submit_pay += v.pay || 0; s.submit_tax += v.tax || 0; s.report_people++; }
      else s.excluded++;
    });
    if (noStaff) s.notes.push('退職日の分からない ' + noStaff + ' 人は提出する側に数えました（源泉徴収票の欄の値を渡すと年の中途退職を見分けます）');
    return s;
  }

  /* ── 4. CSV ── */
  var COLS = [
    ['staff_id', '職員の番号'], ['name', '氏名'], ['kana', 'フリガナ'], ['adjusted', '年末調整'], ['otsu', '乙欄'], ['shubetsu', '種別'], ['pay', '支払金額'], ['kyuyo_after', '給与所得控除後の金額'],
    ['deductions_total', '所得控除の額の合計額'], ['tax', '源泉徴収税額'], ['spouse_has', '控除対象配偶者の有無'], ['spouse_elderly', '老人控除対象配偶者'],
    ['spouse_deduction', '配偶者（特別）控除の額'], ['dep_specific', '特定扶養親族の数'], ['dep_elderly', '老人扶養親族の数'], ['dep_elderly_cohabit', 'うち同居老親等'],
    ['dep_other', 'その他の控除対象扶養親族の数'], ['dep_tokutei', '特定親族の数'], ['under16', '16歳未満扶養親族の数'], ['disabled_special', '特別障害者の数'],
    ['disabled_special_cohabit', 'うち同居'], ['disabled_other', 'その他の障害者の数'], ['nonresident', '非居住者である親族の数'], ['tokutei_amount', '特定親族特別控除の額'],
    ['si_amount', '社会保険料等の金額'], ['small_biz', 'うち小規模企業共済等掛金'], ['life_amount', '生命保険料の控除額'], ['quake_amount', '地震保険料の控除額'],
    ['housing_amount', '住宅借入金等特別控除の額'], ['housing_possible', '住宅借入金等特別控除可能額'], ['basic', '基礎控除の額'], ['income_adjust', '所得金額調整控除額'],
    ['spouse_income', '配偶者の合計所得'], ['life_new', '新生命保険料の金額'], ['life_old', '旧生命保険料の金額'], ['life_care', '介護医療保険料の金額'],
    ['pension_new', '新個人年金保険料の金額'], ['pension_old', '旧個人年金保険料の金額'], ['national_pension', '国民年金保険料等の金額'], ['old_long', '旧長期損害保険料の金額'],
    ['self_disability', '本人が障害者'], ['widow', '寡婦'], ['single_parent', 'ひとり親'], ['working_student', '勤労学生'],
    ['joined_on', '就職の日'], ['left_on', '退職の日'], ['birth', '生年月日'], ['tekiyo', '摘要'], ['own_pay', '自社の支払金額'], ['own_tax', '自社の源泉徴収税額']
  ];
  function cell(v) {
    if (v === null || v === undefined) return '';
    if (v === true) return '1';
    if (v === false) return '';
    var s = String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   /* 表計算ソフトで式として読まれない */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(list, summary) {
    if (list && !Array.isArray(list) && typeof list === 'object' && Array.isArray(list.slips)) { summary = summary || list.summary; list = list.slips; }
    list = (Array.isArray(list) ? list : []).filter(Boolean);
    var lines = [COLS.map(function (c) { return cell(c[1]); }).join(',')];
    list.forEach(function (v) { lines.push(COLS.map(function (c) { return cell(v[c[0]]); }).join(',')); });
    if (summary) {
      lines.push('');
      lines.push(['合計表（375）', '人員', '源泉徴収税額のない者', '支払金額', '源泉徴収税額'].join(','));
      lines.push(['俸給・給与・賞与等の総額', summary.total_people, summary.total_no_tax_people, summary.total_pay, summary.total_tax].join(','));
      lines.push(['源泉徴収票を提出するもの', summary.submit_people, '', summary.submit_pay, summary.submit_tax].join(','));
      lines.push(['給与支払報告書 総括表', '受給者総人員', summary.report_total_people, '報告人員', summary.report_people].join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  var api = {
    VERSION: VERSION, UNVERIFIED: UNVERIFIED, SLIP_RETIRE_MAX: SLIP_RETIRE_MAX,
    slipValues: slipValues, slipHtml: slipHtml, summaryValues: summaryValues, toCsv: toCsv,
    wareki: wareki, submitTarget: submitTarget, COLS: COLS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollWithholdingSlip = api;
})(typeof window !== 'undefined' ? window : this);
