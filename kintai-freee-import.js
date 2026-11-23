/* kintai-freee-import.js — freee の勤怠の「月の集計」を勤怠の合計（sum）の値にする純関数（2026-11-23 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT-freee-month-import.md）
 * ════════════════════════════════════════════════════════════════
 * ・読み口は2つ: freee の勤怠の CSV（見出しの名前で列を探す）と、API の月の集計（work_record_summaries）。どちらも同じ rows の形にする
 * ・rows → toImport で職員（kintai_staff）と従業員コードで突き合わせ、取り込む値（vals）・取り込まない理由・警告を出す
 * ・vals の鍵は勤怠の合計の鍵（kintai-calc.js の sum と同じ名前）。DB（統合 0123 kintai_month_import_put）も同じ鍵と範囲で確かめる
 * ・推測で当てない: 当てはめ方の決まっていない欄（特別休暇・代休・振休・有休の時間・みなし・不足時間・知らない欄）が 0 でない人は取り込まない
 * ・画面（kintai.html）とは通信も DOM も持たない。ファイルの文字コードの判定は呼び手（kintai.js）。試験は check/unit/kintai_freee_import_test.js
 * ・氏名は画面の突き合わせの表に出すためだけに読み、取り込む値（ok の行）にもデータベースにも入れない
 * ・欄の名前（API）は freee の公開の API の定義（freee-api-schema・hr・ApiV1EmployeesWorkRecordSummarySerializer）で確かめた（2026-11-23）。
 *   日本語の見出しの別名は、実物の CSV の書き出しでは未検証（仮置き）
 * ・氏名・番号などの個人情報をこのファイルに書かない（試験も架空の職員だけ）
 */
(function (root) {
  'use strict';

  var DAY_MAX = 31, MIN_MAX = 31 * 24 * 60, ROWS_MAX = 1000;
  /* 欄の表。k＝API の名前（入れ子は「親.子」）・t＝形（min 分・day 日数・num 数）・ja＝日本語の見出しの別名・role:
       map＝勤怠の鍵に当てる・refuse＝0 でなければ取り込まない・warn＝0 でなければ取り込むが警告・ignore＝読むが使わない
     req＝CSV に無ければ読めない（ファイルの誤り）。払いに効く欄（総労働・所定内・所定外・法定内残業・法定休日・深夜・欠勤・有休日数・遅刻早退・勤務日数）は req（チーフの決定 2026-11-23）。
     休暇の種類・みなし・不足時間・所定休日・所定内法定外の欄は、無ければ missing で知らせて 0 として扱う（仮置き） */
  var FIELDS = [
    { k: 'work_days', t: 'day', role: 'map', req: true, ja: ['労働日数', '勤務日数', '出勤日数'] },
    { k: 'total_work_mins', t: 'min', role: 'map', req: true, ja: ['総勤務時間', '総労働時間', '労働時間合計'] },
    { k: 'total_normal_work_mins', t: 'min', role: 'map', req: true, ja: ['所定内労働時間', '所定労働時間', '所定内勤務時間'] },
    { k: 'total_overtime_except_normal_work_mins', t: 'min', role: 'map', req: true, ja: ['所定外労働時間', '残業時間', '所定外勤務時間', '所定外法定外労働時間'] },
    { k: 'total_overtime_within_statutory_work_mins', t: 'min', role: 'map', req: true, ja: ['法定内残業時間', '法定内残業', '給与計算に用いられる法定内残業時間'] },
    { k: 'total_holiday_work_mins', t: 'min', role: 'warn', req: true, ja: ['法定休日労働時間', '休日労働時間'] },
    { k: 'total_prescribed_holiday_work_mins', t: 'min', role: 'warn', ja: ['所定休日労働時間'] },
    { k: 'total_latenight_work_mins', t: 'min', role: 'warn', req: true, ja: ['深夜労働時間', '深夜勤務時間'] },
    { k: 'num_absences', t: 'day', role: 'warn', req: true, ja: ['欠勤日数'] },
    { k: 'total_lateness_and_early_leaving_mins', t: 'min', role: 'warn', req: true, ja: ['遅刻早退時間', '遅刻・早退時間'] },
    { k: 'num_paid_holidays', t: 'day', role: 'map', req: true, ja: ['有休日数', '有給休暇取得日数', '有給取得日数', '有休取得日数'] },
    { k: 'num_paid_holidays_and_hours.hours', t: 'num', role: 'refuse', ja: ['有休時間', '有給休暇取得時間', '有給取得時間', '有休取得時間', '有給休暇の取得時間', '時間単位有休', '時間単位年休', '時間有休'] },
    { k: 'num_special_holidays_used', t: 'day', role: 'refuse', ja: ['特別休暇日数', '特別休暇の使用日数', '特別休暇取得日数', '特別休暇の取得日数', '特休日数', '特別休暇'] },
    { k: 'num_special_holidays_and_hours_used.days', t: 'day', role: 'refuse', ja: [] },
    { k: 'num_special_holidays_and_hours_used.hours', t: 'num', role: 'refuse', ja: ['特別休暇時間', '特別休暇取得時間', '特別休暇の取得時間'] },
    { k: 'num_compensatory_holidays_used', t: 'day', role: 'refuse', ja: ['代休日数', '代休の使用日数', '代休取得日数', '代休の取得日数', '代休'] },
    { k: 'num_substitute_holidays_used', t: 'day', role: 'refuse', ja: ['振休日数', '振替休日日数', '振替休日の使用日数', '振替休日取得日数', '振休取得日数', '振替休日の取得日数', '振替休日', '振休'] },
    { k: 'total_shortage_work_mins', t: 'min', role: 'refuse', ja: ['不足時間', '不足労働時間', '不足時間数'] },
    { k: 'total_deemed_paid_overtime_within_statutory_work_mins', t: 'min', role: 'refuse', ja: ['みなし外の法定内残業時間'] },
    { k: 'total_deemed_paid_overtime_except_normal_work_mins', t: 'min', role: 'refuse', ja: ['みなし外の時間外労働時間', 'みなし残業時間'] },
    { k: 'total_deemed_paid_excess_statutory_work_mins', t: 'min', role: 'refuse', ja: [] },
    /* 所定内法定外（1日の所定が8時間を超える人の法定外）は仕様の表に無い＝当てはめ方が決まっていない（0 でなければ取り込まない・仮置き） */
    { k: 'total_overtime_within_normal_work_mins', t: 'min', role: 'refuse', ja: ['所定内法定外労働時間'] },
    /* 複数時給の内訳（行の数）。時給を分けて払う形は勤怠に無い（1つでもあれば取り込まない） */
    { k: 'multi_hourly_wages.count', t: 'num', role: 'refuse', ja: [] },
    /* 法定外の欄（excess_statutory）は freee の給与が使っていない（凍結した仕様）。有休の日数の入れ子・残りは数に使わない */
    { k: 'total_excess_statutory_work_mins', t: 'min', role: 'ignore', ja: ['法定外労働時間', '時間外労働時間'] },
    { k: 'num_paid_holidays_and_hours.days', t: 'day', role: 'ignore', ja: [] },
    { k: 'num_paid_holidays_left', t: 'day', role: 'ignore', ja: ['有給残日数', '有休残日数'] },
    { k: 'num_paid_holidays_and_hours_left.days', t: 'day', role: 'ignore', ja: [] },
    { k: 'num_paid_holidays_and_hours_left.hours', t: 'num', role: 'ignore', ja: [] }
  ];
  var BY_KEY = {};
  function isIgnored(k) { return !!(BY_KEY[k] && BY_KEY[k].role === 'ignore'); }
  for (var fi = 0; fi < FIELDS.length; fi++) BY_KEY[FIELDS[fi].k] = FIELDS[fi];
  var CODE_ALIAS = ['num', 'employee_num', '従業員番号', '従業員コード', '社員番号', '社員コード'];
  var NAME_ALIAS = ['display_name', '氏名', '従業員名', '名前', '表示名'];
  /* 期間の列（反証レビュー 2026-11-23: ファイルの期間がこの月分の期間と違えばファイルの誤りにする） */
  var PFROM_ALIAS = ['start_date', '期間の始まり', '期間開始', '期間開始日', '開始日', '集計開始日', '対象期間開始日'];
  var PTO_ALIAS = ['end_date', '期間の終わり', '期間終了', '期間終了日', '締め日', '終了日', '集計終了日', '対象期間終了日'];
  /* 別名の表に無い日本語の見出しのうち、名前にこの語がある列は、値が 0 でない人を取り込まない（休暇・労働の欄の言い方の揺れを見落とさない・反証レビュー 2026-11-23） */
  var WATCH_RE = /休暇|休日|代休|振替|振休|特別|みなし|不足|有休|有給|欠勤|遅刻|早退|残業|深夜|労働/;
  /* 見出しにしない API の鍵（文字・日付・日ごとの勤怠） */
  var API_SKIP = { year: 1, month: 1, start_date: 1, end_date: 1, work_records: 1, multi_hourly_wages: 1 };
  var LABEL = {
    num_paid_holidays_and_hours_hours: '有休の時間', num_special_holidays_used: '特別休暇の日数', num_special_holidays_and_hours_used_days: '特別休暇の日数',
    num_special_holidays_and_hours_used_hours: '特別休暇の時間', num_compensatory_holidays_used: '代休の日数', num_substitute_holidays_used: '振休の日数',
    total_shortage_work_mins: '不足時間', total_deemed_paid_overtime_within_statutory_work_mins: 'みなし外の法定内残業', total_deemed_paid_overtime_except_normal_work_mins: 'みなし外の時間外労働',
    total_deemed_paid_excess_statutory_work_mins: 'みなしの欄', total_overtime_within_normal_work_mins: '所定内法定外の労働時間', multi_hourly_wages_count: '複数時給の内訳',
    total_holiday_work_mins: '法定休日の労働', total_prescribed_holiday_work_mins: '所定休日の労働', total_latenight_work_mins: '深夜の労働',
    num_absences: '欠勤', total_lateness_and_early_leaving_mins: '遅刻・早退'
  };
  function labelOf(k) { return LABEL[k.replace(/\./g, '_')] || k; }

  /* 勤怠の合計の鍵（DB の 0123 と同じ並び・同じ範囲） */
  var VAL_KEYS = ['workDays', 'workMin', 'schedInMin', 'legalInOverMin', 'legalOverMin', 'holidayMin', 'nightMin', 'over60Min', 'absentDays', 'lateMin', 'paidDays'];
  var DAY_KEYS = { workDays: 1, absentDays: 1, paidDays: 1 };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  /* 全角の英数字・記号を半角に（NFKC）・前後の空白を除く */
  function nfkc(s) { s = String(s == null ? '' : s); try { s = s.normalize('NFKC'); } catch (_) {} return s.replace(/^﻿/, '').replace(/[\s　]+/g, ' ').trim(); }
  /* 従業員コードの照合（kintai-calc.js の empNorm と同じ規則: 頭の A を抜いた4桁＝A001→0001・ほかはそのまま） */
  function empNorm(c) { return /^A[0-9]{1,4}$/.test(c) ? ('0000' + c.slice(1)).slice(-4) : c; }
  function codeNorm(c) { var s = nfkc(c).replace(/\s+/g, ''); return s ? empNorm(s) : ''; }
  function fmtMin(m) { m = Math.round(m || 0); return Math.floor(m / 60) + ':' + pad(m % 60); }

  /* CSV を行の配列に（引用符・引用符の中の改行・CRLF・BOM） */
  function parseCsv(text) {
    var rows = [], row = [], f = '', q = false, i, ch;
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }
  /* 見出しの1つ → { raw, key, kind:'code'|'name'|'field'|'api'|null, unit:'min'|'hm'|null } */
  function headOf(raw) {
    var s = nfkc(raw), unit = null;
    var m = /^(.*?)\s*[(\[]\s*(分|時:分|時間:分|h:mm|日|時間)\s*[)\]]\s*$/i.exec(s);
    if (m) { s = m[1]; unit = m[2] === '分' ? 'min' : (m[2] === '日' || m[2] === '時間') ? null : 'hm'; }
    var flat = s.replace(/\s+/g, '');
    if (CODE_ALIAS.indexOf(flat) >= 0) return { raw: raw, key: 'code', kind: 'code', unit: null };
    if (NAME_ALIAS.indexOf(flat) >= 0) return { raw: raw, key: 'name', kind: 'name', unit: null };
    if (PFROM_ALIAS.indexOf(flat) >= 0) return { raw: raw, key: 'period_from', kind: 'pfrom', unit: null };
    if (PTO_ALIAS.indexOf(flat) >= 0) return { raw: raw, key: 'period_to', kind: 'pto', unit: null };
    if (BY_KEY[flat]) return { raw: raw, key: flat, kind: 'field', unit: /_mins$/.test(flat) ? 'min' : unit };
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].ja.indexOf(flat) >= 0) return { raw: raw, key: FIELDS[i].k, kind: 'field', unit: unit };
    /* API の名前の形をした知らない欄（数の欄なら 0 でない人は取り込まない） */
    if (/^[a-z][a-z0-9_.]*$/.test(flat) && !API_SKIP[flat]) return { raw: raw, key: flat, kind: 'api', unit: /_mins$/.test(flat) ? 'min' : unit };
    if (WATCH_RE.test(flat)) return { raw: raw, key: flat, kind: 'watch', unit: unit };
    return { raw: raw, key: null, kind: null, unit: unit };
  }
  /* 日付の読み（2026-11-16・2026/11/16・2026年11月16日）→ 'YYYY-MM-DD'。空は ''・読めなければ null */
  function dateOf(v) {
    var s = nfkc(v).replace(/\s+/g, '');
    if (!s) return '';
    var m = /^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?$/.exec(s);
    if (!m) return null;
    var d = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]), t = new Date(d + 'T00:00:00Z');
    return !isNaN(t) && t.toISOString().slice(0, 10) === d ? d : null;
  }
  /* 値の読み: 時間（min）は「時:分」か、見出しに「分」がある時（API の _mins の欄も）の整数の分だけ。小数・不明な形は null（その行の誤り）
     日数（day）は 0.5 きざみ・数（num）は 0 以上の数か「時:分」。空は 0 */
  function valOf(v, t, unit) {
    var s = nfkc(v).replace(/[,\s]/g, '');
    if (s === '' || s === '-') return 0;
    var hmM = /^(\d+):([0-5]\d)$/.exec(s);
    if (t === 'min') {
      if (hmM) return +hmM[1] * 60 + +hmM[2];
      if (unit === 'min' && /^\d+$/.test(s)) return +s;
      return null;
    }
    if (t === 'day') {
      if (!/^\d+(\.\d+)?$/.test(s)) return null;
      var d = +s;
      return Math.round(d * 2) === d * 2 ? d : null;
    }
    if (hmM) return +hmM[1] * 60 + +hmM[2];
    return /^\d+(\.\d+)?$/.test(s) ? +s : null;
  }

  /* freee の勤怠の CSV → { rows:[{ code, name?, src:{API の欄名: 数}, watch?:{見出し: 数|NaN}, period?:{from,to}, err?, line }], headers:[{raw,key,kind,unit}], errors:[文], unknown:[見出し], watch:[見出し], missing:[見出し] }
     必須の列（払いに効く10列）の値が空・「-」・行の欄が足りない時は、その行の誤り（0 にしない・反証レビュー 2026-11-23）。必須でない列の空は 0。
     watch＝別名の表に無い日本語の見出しのうち、休暇・労働などの語がある列（値が 0 でない人は toImport が取り込まない）
     missing＝必要な5列のほかに、CSV に無かった数の欄（取り込む値・取り込まない／警告の判定に使う欄）。無い欄は 0 として扱う（仮置き）ので、画面は必ず知らせる */
  function parseFreeeMonthCsv(text) {
    var out = { rows: [], headers: [], errors: [], unknown: [], watch: [], missing: [] };
    var all = parseCsv(text);
    if (!all.length) { out.errors.push('ファイルが空です。'); return out; }
    /* 見出しの行: 頭の5行のうち、従業員コードの見出しのある最初の行（表題の行を飛ばす） */
    var hi = -1;
    for (var r = 0; r < Math.min(5, all.length) && hi < 0; r++) if (all[r].some(function (c) { return headOf(c).kind === 'code'; })) hi = r;
    if (hi < 0) { out.errors.push('従業員番号（従業員コード）の列が見つかりません。'); return out; }
    var heads = all[hi].map(headOf), seen = {};
    out.headers = heads;
    heads.forEach(function (h) {
      if (h.kind === 'field' || h.kind === 'api' || h.kind === 'code' || h.kind === 'pfrom' || h.kind === 'pto' || h.kind === 'watch') {
        if (seen[h.key]) out.errors.push('同じ意味の列が2つあります（' + nfkc(h.raw) + '）。');
        seen[h.key] = 1;
        if (h.kind === 'watch') out.watch.push(nfkc(h.raw));
      } else if (h.kind == null && nfkc(h.raw)) out.unknown.push(nfkc(h.raw));
    });
    FIELDS.forEach(function (f) {
      if (f.req && !seen[f.k]) out.errors.push('必要な列「' + (f.ja[0] || f.k) + '」が見つかりません。');
      else if (!f.req && f.role !== 'ignore' && !seen[f.k] && f.ja.length) out.missing.push(f.ja[0]);   /* API にしか無い欄（日本語の見出しの無い入れ子・複数時給など）は数えない */
    });
    if (out.errors.length) return out;
    var body = all.slice(hi + 1);
    if (body.length > ROWS_MAX) { out.errors.push('行が多すぎます（' + ROWS_MAX + '行まで）。'); return out; }
    body.forEach(function (cells, j) {
      var row = { code: '', src: {}, line: hi + j + 2 }, bad = [], blank = [];
      heads.forEach(function (h, c) {
        var v = cells[c];
        if (h.kind === 'code') row.code = codeNorm(v);
        else if (h.kind === 'name') { var nm = nfkc(v); if (nm) row.name = nm; }
        else if (h.kind === 'pfrom' || h.kind === 'pto') {
          var dt = dateOf(v);
          if (dt === null) bad.push(nfkc(h.raw) + '「' + nfkc(v) + '」');
          else if (dt) { row.period = row.period || {}; row.period[h.kind === 'pfrom' ? 'from' : 'to'] = dt; }
        }
        else if (h.kind === 'watch') {
          var wn = valOf(v, 'num', h.unit);
          (row.watch = row.watch || {})[nfkc(h.raw)] = wn == null ? NaN : wn;
        }
        else if (h.kind === 'field' && BY_KEY[h.key].req && (c >= cells.length || nfkc(v) === '' || nfkc(v) === '-')) blank.push(nfkc(h.raw));
        else if ((h.kind === 'field' || h.kind === 'api') && isIgnored(h.key)) return;   /* 使わない欄（有休の残りなど）は読まない。freee は使い過ぎた人の残りを負の値で出すため（10月分の試し 2026-11-23） */
        else if (h.kind === 'field' || h.kind === 'api') {
          var t = h.kind === 'field' ? BY_KEY[h.key].t : (h.unit === 'min' ? 'min' : 'num');
          var n = valOf(v, t, h.unit);
          if (n == null) bad.push(nfkc(h.raw) + '「' + nfkc(v) + '」');
          else row.src[h.key] = n;
        }
      });
      var es = [];
      if (blank.length) es.push('必要な列の値が空です（' + blank.join('・') + '）');
      if (bad.length) es.push('読めない値があります（' + bad.join('・') + '。時間は「時:分」か、見出しに「分」とある列の整数の分で書いてください）');
      if (es.length) row.err = es.join('・');
      out.rows.push(row);
    });
    return out;
  }

  /* API の月の集計 → 同じ rows の形。list は [{ num（従業員番号）, summary（work_record_summaries の応答）}] */
  function fromApiSummaries(list) {
    var rows = [];
    (Array.isArray(list) ? list : []).forEach(function (it, i) {
      var s = it && it.summary && typeof it.summary === 'object' ? it.summary : null;
      var row = { code: codeNorm(it && it.num != null ? String(it.num) : ''), src: {}, line: i + 1 }, bad = [];
      if (!s) { row.err = '月の集計がありません'; rows.push(row); return; }
      Object.keys(s).forEach(function (k) {
        if (API_SKIP[k] || isIgnored(k)) return;
        var v = s[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          Object.keys(v).forEach(function (k2) { var n = v[k2]; if (n == null || isIgnored(k + '.' + k2)) return; if (typeof n !== 'number' || !isFinite(n) || n < 0) bad.push(k + '.' + k2); else row.src[k + '.' + k2] = n; });
          return;
        }
        if (v == null) return;
        if (typeof v !== 'number' || !isFinite(v) || v < 0) { bad.push(k); return; }
        row.src[k] = v;
      });
      if (Array.isArray(s.multi_hourly_wages)) row.src['multi_hourly_wages.count'] = s.multi_hourly_wages.length;
      var pf = dateOf(s.start_date), pt = dateOf(s.end_date);
      if (pf || pt) row.period = {};
      if (pf) row.period.from = pf;
      if (pt) row.period.to = pt;
      if (pf === null || pt === null) bad.push('start_date・end_date');
      var lack = FIELDS.filter(function (f) { return f.req && typeof row.src[f.k] !== 'number'; }).map(function (f) { return f.k; });
      if (lack.length) bad.push('欄が無い: ' + lack.join('・'));
      if (bad.length) row.err = '読めない値があります（' + bad.join('・') + '）';
      rows.push(row);
    });
    return rows;
  }

  /* rows の src → 勤怠の合計の値（vals）。欄が無い時は 0 */
  function valsOf(src) {
    var g = function (k) { var n = src[k]; return typeof n === 'number' && isFinite(n) ? n : 0; };
    var li = g('total_overtime_within_statutory_work_mins');
    var lo = Math.max(0, g('total_overtime_except_normal_work_mins') - li);
    return {
      workDays: g('work_days'), workMin: g('total_work_mins'), schedInMin: g('total_normal_work_mins'),
      legalInOverMin: li, legalOverMin: lo, holidayMin: g('total_holiday_work_mins'), nightMin: g('total_latenight_work_mins'),
      over60Min: Math.max(0, lo - 3600), absentDays: g('num_absences'), lateMin: g('total_lateness_and_early_leaving_mins'), paidDays: g('num_paid_holidays')
    };
  }
  /* vals の形の確かめ（kintai-calc.js の computeMonth・DB の 0123 と同じ決まり）。よければ null・だめなら理由 */
  function valsWhy(v) {
    if (!v || typeof v !== 'object') return '値がありません';
    for (var i = 0; i < VAL_KEYS.length; i++) {
      var k = VAL_KEYS[i], n = v[k];
      if (typeof n !== 'number' || !isFinite(n) || n < 0) return '値の形が違います（' + k + '）';
      if (DAY_KEYS[k] ? (n > DAY_MAX || Math.round(n * 2) !== n * 2) : (n > MIN_MAX || Math.round(n) !== n)) return '値が範囲の外です（' + k + '）';
    }
    for (var kk in v) if (VAL_KEYS.indexOf(kk) < 0) return '知らない鍵があります（' + kk + '）';
    /* 勤務日数は整数だけ（給与の attFromKintai は勤務日数を整数に丸める＝半日の勤務日数は freee の値と同じに渡せない） */
    if (Math.round(v.workDays) !== v.workDays) return '勤務日数が整数ではありません（' + v.workDays + '日・給与へ同じ値で渡せないため）';
    if (v.schedInMin + v.legalInOverMin + v.legalOverMin + v.holidayMin !== v.workMin) return '所定内・法定内残業・法定外・法定休日の和（' + fmtMin(v.schedInMin + v.legalInOverMin + v.legalOverMin + v.holidayMin) + '）が総労働（' + fmtMin(v.workMin) + '）と合いません';
    if (v.over60Min !== Math.max(0, v.legalOverMin - 3600)) return '60時間超の値が法定外と合いません';
    return null;
  }

  /* 突き合わせ。staffList は [{ staff_id, emp_code, schedDays?（期間の予定の働く日の数） }]
     → { ok:[{ staff_id, emp_code, vals, src }], refused:[{ code, staff_id?, why }], warn:[{ code, staff_id, why }], unmatched:[code], missingStaff:[staff_id] } */
  function toImport(rows, staffList, opts) {
    var res = { ok: [], refused: [], warn: [], unmatched: [], missingStaff: [] };
    /* ファイルの期間（期間の列・API の start_date・end_date）が、この月分の期間（opts.period）と違えばファイルの誤り（1人も取り込まない） */
    var per = opts && opts.period;
    if (per && per.from && per.to) {
      var off = (rows || []).filter(function (r) { return r && r.period && ((r.period.from && r.period.from !== per.from) || (r.period.to && r.period.to !== per.to)); });
      if (off.length) {
        var o0 = off[0].period;
        res.periodError = 'ファイルの期間（' + (o0.from || '？') + '〜' + (o0.to || '？') + '）が、この月分の期間（' + per.from + '〜' + per.to + '）と違います。月分か、勤怠の締め日の設定を確かめてください。';
        return res;
      }
    }
    var byCode = {}, seenStaff = {}, nCode = {};
    (Array.isArray(staffList) ? staffList : []).forEach(function (s) {
      if (!s || typeof s.staff_id !== 'string') return;
      var c = codeNorm(s.emp_code || '');
      if (c) (byCode[c] = byCode[c] || []).push(s);
    });
    (rows || []).forEach(function (r) { if (r && r.code) nCode[r.code] = (nCode[r.code] || 0) + 1; });
    (rows || []).forEach(function (r) {
      if (!r) return;
      var code = r.code || '';
      if (!code) { res.refused.push({ code: '', line: r.line, why: '従業員番号が空の行です' + (r.line ? '（' + r.line + '行目）' : '') }); return; }
      var hit = byCode[code] || [];
      if (hit.length === 1) seenStaff[hit[0].staff_id] = 1;
      if (nCode[code] > 1) { res.refused.push({ code: code, staff_id: hit.length === 1 ? hit[0].staff_id : null, why: '同じ従業員番号の行が2つ以上あります' }); return; }
      if (!hit.length) { res.unmatched.push(code); return; }
      if (hit.length > 1) { hit.forEach(function (h) { seenStaff[h.staff_id] = 1; }); res.refused.push({ code: code, staff_id: null, why: '勤怠の職員に同じ従業員コードの人が2人以上います（「職員と番号」で直してください）' }); return; }
      var st = hit[0];
      if (r.err) { res.refused.push({ code: code, staff_id: st.staff_id, why: r.err }); return; }
      var src = r.src || {}, why = [], warns = [];
      Object.keys(r.watch || {}).forEach(function (h) { var wv = r.watch[h]; if (wv !== 0) why.push('知らない列「' + h + '」に値があります（' + (isNaN(wv) ? '読めない値' : String(wv)) + '）'); });
      Object.keys(src).forEach(function (k) {
        var f = BY_KEY[k], n = src[k];
        if (typeof n !== 'number' || !isFinite(n) || n < 0) { why.push('読めない値があります（' + k + '）'); return; }
        if (!f) { if (n !== 0) why.push('freee の欄「' + k + '」は勤怠への当てはめ方が決まっていないため'); return; }
        if (f.role === 'refuse' && n !== 0) why.push(labelOf(k) + 'が 0 でないため（' + (f.t === 'min' ? fmtMin(n) : String(n)) + '）');
        if (f.role === 'warn' && n !== 0) warns.push(labelOf(k) + 'があります（' + (f.t === 'min' ? fmtMin(n) : String(n)) + '・給与の払い方は未検証です）');
      });
      var vals = valsOf(src);
      if (!why.length) { var vw = valsWhy(vals); if (vw) why.push(vw); }
      if (why.length) { res.refused.push({ code: code, staff_id: st.staff_id, why: why.join('・') }); return; }
      if (vals.holidayMin > 0) warns.push('法定休日に働いた日の数は freee の集計から分からないため 0 にします（日給の人は確かめてください）');
      if (typeof st.schedDays === 'number' && st.schedDays !== vals.workDays) warns.push('予定の働く日（' + st.schedDays + '日）と freee の勤務日数（' + vals.workDays + '日）が違います');
      warns.forEach(function (w) { res.warn.push({ code: code, staff_id: st.staff_id, why: w }); });
      var keep = {};
      Object.keys(src).forEach(function (k) { keep[k] = src[k]; });
      res.ok.push({ staff_id: st.staff_id, emp_code: st.emp_code || null, vals: vals, src: keep });
    });
    (Array.isArray(staffList) ? staffList : []).forEach(function (s) {
      if (s && typeof s.staff_id === 'string' && !seenStaff[s.staff_id] && typeof s.schedDays === 'number' && s.schedDays > 0) res.missingStaff.push(s.staff_id);
    });
    return res;
  }
  /* DB（0123 の kintai_import_src_ok）が受ける src だけにする: 名前は英小文字で始まる英小文字・数字・_・. の60字まで・0〜1000000 の数・60欄まで。
     → { src, dropped（捨てた欄の数） }（反証レビュー 2026-11-23: 1人の src の形で全員が止まらないように） */
  function srcClean(src) {
    var out = {}, n = 0, dropped = 0;
    Object.keys(src || {}).sort().forEach(function (k) {
      var v = src[k];
      if (n < 60 && /^[a-z][a-z0-9_.]{0,59}$/.test(k) && typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1000000) { out[k] = v; n++; }
      else dropped++;
    });
    return { src: out, dropped: dropped };
  }
  /* 勤怠なし（0）として取り込む値（freee に無い職員を選んだ時・source 'none'） */
  function zeroVals() { var v = {}; VAL_KEYS.forEach(function (k) { v[k] = 0; }); return v; }

  /* rows → API の欄名を見出しにした CSV（UTF-8・BOM なし・CRLF）。氏名は入れない */
  function toCanonicalCsv(rows) {
    var keys = FIELDS.map(function (f) { return f.k; });
    var extra = [];
    (rows || []).forEach(function (r) { Object.keys((r && r.src) || {}).forEach(function (k) { if (!BY_KEY[k] && extra.indexOf(k) < 0) extra.push(k); }); });
    keys = keys.concat(extra.sort());
    var hasP = (rows || []).some(function (r) { return r && r.period; });
    var cell = function (v) { var s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [['num'].concat(hasP ? ['start_date', 'end_date'] : [], keys).map(cell).join(',')];
    (rows || []).forEach(function (r) {
      if (!r) return;
      var pc = hasP ? [cell(r.period && r.period.from || ''), cell(r.period && r.period.to || '')] : [];
      lines.push([cell(r.code)].concat(pc, keys.map(function (k) { var n = r.src && r.src[k]; return typeof n === 'number' ? String(n) : '0'; })).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  var api = {
    FIELDS: FIELDS, VAL_KEYS: VAL_KEYS, DAY_MAX: DAY_MAX, MIN_MAX: MIN_MAX, ROWS_MAX: ROWS_MAX,
    parseFreeeMonthCsv: parseFreeeMonthCsv, fromApiSummaries: fromApiSummaries, toImport: toImport, toCanonicalCsv: toCanonicalCsv,
    valsOf: valsOf, valsWhy: valsWhy, zeroVals: zeroVals, srcClean: srcClean, dateOf: dateOf, empNorm: empNorm, codeNorm: codeNorm, parseCsv: parseCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiFreeeImport = api;
})(typeof window !== 'undefined' ? window : this);
