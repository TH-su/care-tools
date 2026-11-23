/* payroll-freee-slips.js — freee の給与・賞与の明細の書き出し（CSV）を読む・職員に結ぶ・自社の明細と比べる・累計の行にする純関数
 * （2026-11-23 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/給与/ROOT-yearend.md の B1）
 * ════════════════════════════════════════════════════════════════
 * ・画面（payroll-yearend-ui.js）から呼ぶだけ。DOM・通信・端末への保存・console は使わない
 * ・文字は呼ぶ側が decode した物を受ける（UTF-8 の BOM・Shift_JIS の読み分けは payroll.js の decode）
 * ・CSV の読み方は payroll.js の parseCsv と同じ規則（引用符・中の読点・二重の引用符・CRLF・空行を捨てる）を自前で持つ
 * ・見出しの候補は HEAD の表。前から順に最初に当たった列を使う
 *   ・給与は freee の賃金台帳の CSV（1か月分・2026-08 分）の実物の見出しで確かめた（2026-11-23）。実物の課税対象額は
 *     「課税支給額合計−社会保険料等控除合計」（所得税の基礎）なので、課税支給の候補に入れない（入れると年末調整の収入が小さく入る）
 *   ★未検証（事務担当が書き出した実物で確かめる）: 賞与の書き出しと、複数の月を1つにした書き出し（1〜11月）の見出し。実物の賃金台帳には支給日の列が無い（給与計算の締日だけ）
 * ・compare / compareSlips は、自社の明細に「所得税の精算」（tax_adjust＝年末調整の還付・追徴）がある時はそれを除いた
 *   控除の合計・差引で比べ、精算の額は別の欄（settle）に出す（freee では年末調整をしないため・代表者の決定 2026-11-23）
 * ★試験・見本は架空の職員と架空の金額だけ
 */
(function (root) {
  'use strict';
  var VERSION = 'freee-slips-2026-11-23.3';
  /* freee に登録の無い人（比べる対象外）の従業員コードの頭（今は契約社員の A901・A902・2026-11-23 代表者）。
     自社の側（職員の給与設定の freee の番号）で判定する。番号が空の人は対象外にしない（止まる側） */
  var EXCLUDE_PREFIX = 'A9';

  /* 見出しの候補（★未検証・上の注記）。比べる時は NFKC＋空白を除いた形で比べる */
  var HEAD = {
    emp_num: ['従業員番号', '社員番号', '従業員コード', '従業員ID'],
    name: ['氏名', '従業員名', '従業員氏名', '名前', '表示名'],
    sei: ['姓'],
    mei: ['名'],
    pay_date: ['支給日', '支払日', '給与支給日', '賞与支給日', '支払年月日'],
    gross: ['総支給額', '支給合計', '支給額合計', '総支給金額', '支給総額', '賞与総支給額'],
    taxable: ['課税支給額合計', '課税支給額', '課税支給合計', '課税合計'],   /* 課税対象額は社保を引いた後の額なので候補にしない */
    nontax: ['非課税支給額合計', '非課税支給額', '非課税支給合計', '非課税合計', '通勤手当(非課税)', '非課税通勤手当'],
    si_health: ['健康保険料', '健康保険'],
    si_care: ['介護保険料', '介護保険'],
    si_support: ['子ども・子育て支援金', '子ども子育て支援金', '子ども・子育て支援金額'],
    si_pension: ['厚生年金保険料', '厚生年金保険', '厚生年金'],
    si_emp: ['雇用保険料', '雇用保険'],
    si_total: ['社会保険料等控除合計', '社会保険料合計', '社会保険料等合計', '社会保険料計', '社保合計'],
    income_tax: ['所得税', '源泉所得税'],
    resident_tax: ['住民税'],
    deduct_total: ['控除合計', '総控除額', '控除額合計', '控除計'],
    net: ['差引支給額', '差引支給金額', '差引支給合計', '差引額']
  };
  var MONEY = ['gross', 'taxable', 'nontax', 'si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'si_total', 'income_tax', 'resident_tax', 'deduct_total', 'net'];
  var SI = ['si_health', 'si_care', 'si_support', 'si_pension', 'si_emp'];
  /* 突き合わせの項目の並び（固定・賞与のセッションとそろえた 2026-11-23）。住民税は賞与には無い */
  var ITEMS = [
    ['gross', '総支給'], ['taxable', '課税の総支給'], ['si_health', '健康保険'], ['si_care', '介護保険'], ['si_support', '子ども子育て支援金'],
    ['si_pension', '厚生年金'], ['si_emp', '雇用保険'], ['si_total', '社保等の合計'], ['income_tax', '所得税'], ['resident_tax', '住民税'],
    ['deduct_total', '控除の合計'], ['net', '差引の支給額']
  ];
  /* payroll_ytd の data の鍵（DB の白い一覧と同じ） */
  var YTD_KEYS = ['gross', 'taxable', 'nontax', 'si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'si_other', 'income_tax', 'resident_tax'];
  /* payroll-calc.js の明細の行の code → 項目 */
  var LINE = { health: 'si_health', care: 'si_care', support: 'si_support', pension: 'si_pension', emp: 'si_emp', income_tax: 'income_tax', resident_tax: 'resident_tax' };

  function nk(s) { s = String(s == null ? '' : s); try { s = s.normalize('NFKC'); } catch (_) {} return s.replace(/[\s　]/g, ''); }
  function normName(s) { return String(s == null ? '' : s).replace(/[\s　]/g, ''); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function int(v) { var n = Number(v); return isFinite(n) ? Math.round(n) : 0; }

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
    return rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }

  /* 金額を読む: 「1,234」「¥1,234」「￥1,234円」「-1,234」「△1,234」「(1,234)」「（空）」。読めなければ NaN */
  function toYen(s) {
    var t = nk(s);
    if (t === '' || t === '-' || t === '—' || t === '(空)' || t === '空') return 0;
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    t = t.replace(/[¥￥円,]/g, '').replace(/^[−ー－‐]/, '-');
    if (/^[△▲]/.test(t)) { neg = true; t = t.slice(1); }
    if (/^-/.test(t)) { neg = !neg; t = t.slice(1); }
    if (!/^\d+$/.test(t)) return NaN;
    var n = parseInt(t, 10);
    return neg ? -n : n;
  }
  function toDate(s) {
    var t = nk(s).replace(/[年月\/.]/g, '-').replace(/日$/, '');
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return m[1] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  /* 見出しから列を決める（前から順に最初に当たった候補） */
  function colsOf(head) {
    var hn = head.map(nk), col = {}, used = {};
    Object.keys(HEAD).forEach(function (k) {
      col[k] = -1;
      var cands = HEAD[k].map(nk);
      for (var c = 0; c < cands.length && col[k] < 0; c++) { var j = hn.indexOf(cands[c]); if (j >= 0 && !used[j]) { col[k] = j; used[j] = 1; } }
    });
    return { col: col, used: used };
  }

  /* parse(text, opt) → { rows, cols:{found:[鍵], missing:[名前]}, kind, head }
     opt.kind: 'salary'|'bonus'（呼ぶ側が決める）。無ければ見出しに「賞与」があれば bonus、無ければ salary */
  function parse(text, opt) {
    opt = opt || {};
    var all = parseCsv(text);
    if (!all.length) return { rows: [], cols: { found: [], missing: ['見出し'], required: ['見出し'] }, kind: opt.kind || 'salary', head: [], refused: true };
    var head = all[0], cm = colsOf(head), col = cm.col;
    var kind = opt.kind === 'bonus' || opt.kind === 'salary' ? opt.kind : (head.some(function (h) { return /賞与/.test(nk(h)); }) ? 'bonus' : 'salary');
    var found = Object.keys(col).filter(function (k) { return col[k] >= 0; });
    var missing = [];
    if (col.emp_num < 0 && col.name < 0 && !(col.sei >= 0 && col.mei >= 0)) missing.push('従業員番号・氏名');
    if (col.pay_date < 0) missing.push('支給日');
    if (col.gross < 0) missing.push('総支給額');
    if (col.income_tax < 0) missing.push('所得税');
    if (col.taxable < 0 && col.nontax < 0) missing.push('課税支給額（非課税支給額）');   /* どちらも無いと課税支給＝総支給になるので知らせる */
    /* 必須の見出し: 総支給額・所得税と、課税支給額か非課税支給額のどちらか。無いファイルは行を作らずに断る（refused） */
    var required = [];
    if (col.gross < 0) required.push('総支給額');
    if (col.income_tax < 0) required.push('所得税');
    if (col.taxable < 0 && col.nontax < 0) required.push('課税支給額（非課税支給額）');
    if (required.length) return { rows: [], cols: { found: found, missing: missing, required: required }, kind: kind, head: head.slice(), refused: true };
    var rows = all.slice(1).map(function (r, i) {
      var g = function (k) { return col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]) : ''; };
      var o = { line: i + 2, kind: kind, emp_num: nk(g('emp_num')), name: '', pay_date: null, bad: [], badKeys: [], items: {}, has: {} };
      o.name = col.name >= 0 ? String(g('name')).trim() : (String(g('sei')).trim() + ' ' + String(g('mei')).trim()).trim();
      if (col.pay_date >= 0) { o.pay_date = toDate(g('pay_date')); if (!o.pay_date) o.bad.push(head[col.pay_date] || '支給日'); }
      MONEY.forEach(function (k) {
        if (col[k] < 0) { o[k] = null; return; }
        var n = toYen(g(k));
        if (n !== n) { o[k] = null; o.bad.push(head[col[k]]); o.badKeys.push(k); } else { o[k] = n; o.has[k] = true; }
      });
      head.forEach(function (h, j) {
        if (cm.used[j] || nk(h) === '') return;
        var raw = r[j] == null ? '' : String(r[j]);
        if (nk(raw) === '') return;
        var n = toYen(raw);
        if (n === n) o.items[String(h)] = n;
      });
      return o;
    });
    return { rows: rows, cols: { found: found, missing: missing, required: [] }, kind: kind, head: head.slice(), refused: false };
  }

  function empOf(s) { var v = s && (s.emp_num != null ? s.emp_num : (isObj(s.data) ? s.data.freee_emp_num : null)); return v == null ? '' : nk(v); }
  /* match(rows, staff) → { matched:[行＋staff_id・how], unmatched:[{row, why}] }
     従業員番号で結ぶ。当たらなければ空白を除いた氏名がちょうど1人と同じ時だけ。2人以上・0人は結ばない（勝手に作らない） */
  function match(rows, staff) {
    var list = arr(staff).filter(function (s) { return s && typeof s.staff_id === 'string'; });
    var out = { matched: [], unmatched: [] };
    arr(rows).forEach(function (r) {
      if (!r) return;
      var by = null, how = null;
      if (r.emp_num) {
        var e = list.filter(function (s) { return empOf(s) !== '' && empOf(s) === r.emp_num; });
        if (e.length === 1) { by = e[0]; how = 'emp'; }
        else if (e.length > 1) { out.unmatched.push({ row: r, why: 'many' }); return; }
      }
      if (!by) {
        var nm = normName(r.name);
        if (!nm) { out.unmatched.push({ row: r, why: 'nokey' }); return; }
        var n = list.filter(function (s) { return normName(s.name) === nm; });
        if (n.length === 1) { by = n[0]; how = 'name'; }
        else { out.unmatched.push({ row: r, why: n.length > 1 ? 'many' : 'none' }); return; }
      }
      out.matched.push(Object.assign({}, r, { staff_id: by.staff_id, staff_name: by.name || '', how: how }));
    });
    return out;
  }

  /* 自社の明細（payroll-calc.js の item）→ 比べる形。tax_adjust は除いて settle に分ける */
  function fromItem(it) {
    it = isObj(it) ? it : {};
    var o = { gross: 0, taxable: 0, si_health: 0, si_care: 0, si_support: 0, si_pension: 0, si_emp: 0, si_total: 0, income_tax: 0, resident_tax: 0, deduct_total: 0, net: 0, settle: 0 };
    var lines = arr(it.lines);
    if (lines.length || Array.isArray(it.lines)) {
      lines.forEach(function (l) {
        if (!l || l.sec !== 'deduct') return;
        if (l.code === 'tax_adjust') { o.settle += int(l.amount); return; }
        var k = LINE[l.code]; if (k) o[k] += int(l.amount);
      });
      o.gross = int(it.gross);
      o.taxable = it.taxable != null ? int(it.taxable) : o.gross;
      var siSum = SI.reduce(function (s, k) { return s + o[k]; }, 0);
      o.si_total = it.si_total != null ? int(it.si_total) : siSum;
      o.deduct_total = int(it.deduct) - o.settle;
      o.net = int(it.net) + o.settle;
    } else {
      MONEY.forEach(function (k) { if (k in o && it[k] != null) o[k] = int(it[k]); });
      if (it.si_total == null) o.si_total = SI.reduce(function (s, k) { return s + o[k]; }, 0);
      if (it.taxable == null) o.taxable = o.gross - int(it.nontax);
      o.settle = int(it.settle);
    }
    return o;
  }
  /* freee の行 → 比べる形（社保等の合計の列が無ければ各社保の和・課税支給が無ければ 総支給−非課税） */
  function fromFreee(r) {
    r = isObj(r) ? r : {};
    var o = {};
    ITEMS.forEach(function (x) { o[x[0]] = r[x[0]] == null ? 0 : int(r[x[0]]); });
    if (r.si_total == null) o.si_total = SI.reduce(function (s, k) { return s + o[k]; }, 0);
    if (r.taxable == null) o.taxable = o.gross - int(r.nontax);
    /* 数でなかった項目（と、それを使って出す合計）は「読めない値」にする */
    var bad = {};
    arr(r.badKeys).forEach(function (k) { bad[k] = 1; });
    if (bad.si_health || bad.si_care || bad.si_support || bad.si_pension || bad.si_emp) { if (r.si_total == null) bad.si_total = 1; }
    if (bad.nontax && r.taxable == null) bad.taxable = 1;
    o.bad = bad;
    return o;
  }
  function excluded(emp) { var e = nk(emp).toUpperCase(); return e !== '' && e.indexOf(EXCLUDE_PREFIX) === 0; }
  function nameShort(n) { n = String(n == null ? '' : n).trim(); var p = n.split(/[\s　]+/); return p.length > 1 ? p[0] : n.slice(0, 2); }

  /* compare(appItems, freeeRows, opt) → 人×項目 {app, freee, diff}・合計の行・項目ごとの一致／差ありの人数
     appItems: [{staff_id, name, emp_num?, lines, gross, deduct, net, ...}]（payroll-calc.js の item）
     freeeRows: match の matched（staff_id つき）。staff_id の無い行は従業員番号→氏名で自社の側に当てる */
  function compare(appItems, freeeRows, opt) {
    opt = opt || {};
    var keys = ITEMS.filter(function (x) { return !(opt.kind === 'bonus' && x[0] === 'resident_tax'); });
    var app = arr(appItems).filter(function (x) { return x && typeof x.staff_id === 'string'; });
    var people = [], seenF = {};
    var fr = arr(freeeRows).filter(Boolean);
    /* 対にするのは match で結べた staff_id だけ（結べなかった freee の行は氏名で自社の人に当てず「照合できません」に出す） */
    function findF(a) {
      var hit = -1;
      if (excluded(a.emp_num)) return -1;   /* freee に登録の無い人は必ず「自社だけ」に出す（結ぶ freee の行が来ても結ばない＝その行は freee だけに残る） */
      fr.forEach(function (r, i) { if (hit < 0 && !seenF[i] && r.staff_id && r.staff_id === a.staff_id) hit = i; });
      return hit;
    }
    app.forEach(function (a) {
      var i = findF(a), A = fromItem(a), F = i >= 0 ? fromFreee(fr[i]) : null;
      if (i >= 0) seenF[i] = 1;
      var cells = {};
      keys.forEach(function (x) { var k = x[0], bad = !!(F && F.bad[k]); cells[k] = { app: A[k], freee: F && !bad ? F[k] : null, diff: F && !bad ? A[k] - F[k] : null, bad: bad }; });
      people.push({ staff_id: a.staff_id, name: String(a.name || ''), emp_num: a.emp_num ? nk(a.emp_num) : (i >= 0 ? fr[i].emp_num || '' : ''), only: F ? null : 'app', excluded: !F && excluded(a.emp_num), settle: A.settle, cells: cells });
    });
    fr.forEach(function (r, i) {
      if (seenF[i]) return;
      var F = fromFreee(r), cells = {};
      keys.forEach(function (x) { var k = x[0]; cells[k] = { app: null, freee: F.bad[k] ? null : F[k], diff: null, bad: !!F.bad[k] }; });
      people.push({ staff_id: r.staff_id || null, name: String(r.staff_name || r.name || ''), emp_num: r.emp_num || '', only: 'freee', nomatch: !r.staff_id, settle: 0, cells: cells });
    });
    var totals = {}, counts = {};
    keys.forEach(function (x) {
      var k = x[0], t = { app: 0, freee: 0, diff: 0 }, c = { same: 0, diff: 0 };
      people.forEach(function (p) {
        var v = p.cells[k];
        if (v.app != null) t.app += v.app;
        if (v.freee != null) t.freee += v.freee;
        if (v.bad && !p.only) c.diff++;
        else if (v.diff != null) { if (v.diff === 0) c.same++; else c.diff++; }
      });
      t.diff = t.app - t.freee; totals[k] = t; counts[k] = c;
    });
    var diffPeople = people.filter(function (p) { return !p.only && keys.some(function (x) { return p.cells[x[0]].bad || p.cells[x[0]].diff !== 0; }); }).length;
    var settle = people.reduce(function (s, p) { return s + int(p.settle); }, 0);
    return { items: keys.map(function (x) { return { key: x[0], label: x[1] }; }), people: people, totals: totals, counts: counts, diffPeople: diffPeople,
      onlyApp: people.filter(function (p) { return p.only === 'app'; }).length, onlyFreee: people.filter(function (p) { return p.only === 'freee'; }).length, settle: settle };
  }

  /* compareSlips(ours[], freeeRows[], kind) → { rows, diffCount, unmatched, excluded, compared, pass }（賞与のセッションとそろえた形・2026-11-23）
     unmatched の要素の excluded が真の人は「freee に登録の無い人（比べる対象外）」（自社だけ・差の数に入れない）。
     pass（1円まで一致）は、比べた人が1人以上・差のある行が0・対象外のほかに片方だけの人がいない時だけ真
     rows は1行＝1人×1項目 {staff_id, emp_num, name_short, item, ours, freee, diff, settle}。差のある行を上に（同じ差の有無の中は人・項目の並び） */
  function compareSlips(ours, freeeRows, kind) {
    var c = compare(ours, freeeRows, { kind: kind === 'bonus' ? 'bonus' : 'salary' });
    var rows = [], unmatched = [];
    c.people.forEach(function (p, pi) {
      if (p.only) { unmatched.push({ side: p.only === 'app' ? 'ours' : 'freee', staff_id: p.staff_id, emp_num: p.emp_num, name_short: nameShort(p.name), nomatch: !!p.nomatch, excluded: !!p.excluded }); return; }
      c.items.forEach(function (x, xi) {
        var v = p.cells[x.key];
        rows.push({ staff_id: p.staff_id, emp_num: p.emp_num, name_short: nameShort(p.name), item: x.label, key: x.key, ours: v.app, freee: v.freee, diff: v.diff, bad: !!v.bad, settle: p.settle, _o: pi * 100 + xi });
      });
    });
    /* 読めない値（freee の側が数でない）は diff を null にして、差のある行として数える */
    rows.sort(function (a, b) { var da = a.diff !== 0 ? 0 : 1, db = b.diff !== 0 ? 0 : 1; return da - db || a._o - b._o; });
    rows.forEach(function (r) { delete r._o; });
    var diffCount = rows.filter(function (r) { return r.diff !== 0; }).length;
    var exN = unmatched.filter(function (u) { return u.excluded; }).length, otherN = unmatched.length - exN;
    var compared = c.people.filter(function (p) { return !p.only; }).length;
    return { rows: rows, diffCount: diffCount, unmatched: unmatched, excluded: exN, others: otherN, compared: compared,
      pass: compared > 0 && diffCount === 0 && otherN === 0, totals: c.totals, counts: c.counts, settle: c.settle };
  }

  /* toYtd(rows, kind) → payroll_ytd_put の p_rows（source='freee'）。返す配列に warnings・skipped を添える（送る時は配列だけが JSON になる）
     data の鍵へ写す。課税支給が無い時は 総支給−非課税。si_other は社保等の合計の列がある時だけ、そこから各社保を引いた残り（負なら0・警告） */
  function toYtd(rows, kind) {
    var out = [], warnings = [], skipped = [];
    arr(rows).forEach(function (r) {
      if (!r) return;
      if (!r.staff_id) { skipped.push({ line: r.line, why: 'nostaff' }); return; }
      if (!r.pay_date) { skipped.push({ line: r.line, why: 'nodate' }); return; }
      if (arr(r.bad).length) { skipped.push({ line: r.line, why: 'bad' }); return; }
      var d = {};
      YTD_KEYS.forEach(function (k) { d[k] = 0; });
      ['gross', 'nontax', 'si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'income_tax', 'resident_tax'].forEach(function (k) { if (r[k] != null) d[k] = int(r[k]); });
      d.taxable = r.taxable != null ? int(r.taxable) : d.gross - d.nontax;
      if (r.taxable != null && r.nontax == null) d.nontax = Math.max(0, d.gross - d.taxable);
      if (r.si_total != null) {
        var rest = int(r.si_total) - SI.reduce(function (s, k) { return s + d[k]; }, 0);
        if (rest < 0) { warnings.push({ line: r.line, staff_id: r.staff_id, code: 'si_other_neg', msg: '社保等の合計が各社保の和より小さい（その他は0にしました）' }); rest = 0; }
        d.si_other = rest;
      }
      var neg = YTD_KEYS.filter(function (k) { return d[k] < 0; });
      if (neg.length) { skipped.push({ line: r.line, why: 'negative', keys: neg, staff_id: r.staff_id, pay_date: r.pay_date, kind: kind === 'bonus' || kind === 'salary' ? kind : (r.kind === 'bonus' ? 'bonus' : 'salary'), src_name: r.src_name || '' }); return; }
      out.push({ staff_id: r.staff_id, pay_date: r.pay_date, kind: kind === 'bonus' || kind === 'salary' ? kind : (r.kind === 'bonus' ? 'bonus' : 'salary'), source: 'freee', data: d, src_fp: String(r.src_fp || '').slice(0, 16), rev: 0 });
    });
    out.warnings = warnings; out.skipped = skipped;
    return out;
  }
  /* 自社の確定した明細 → payroll_ytd の data（source='app' の行・年末調整の rows の12月分）。tax_adjust（精算）は所得税に入れない */
  function itemToYtd(it) {
    var o = fromItem(it), d = {};
    YTD_KEYS.forEach(function (k) { d[k] = 0; });
    ['gross', 'taxable', 'si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'income_tax', 'resident_tax'].forEach(function (k) { d[k] = Math.max(0, o[k]); });
    d.nontax = Math.max(0, d.gross - d.taxable);
    d.si_other = Math.max(0, o.si_total - SI.reduce(function (s, k) { return s + d[k]; }, 0));
    return d;
  }

  /* 賞与の確定した明細（payroll.js の bonusNorm の item: gross・social・tax・taxable・ins）→ payroll_ytd の data（source='app'・kind='bonus'）。
     DB（0124 の private.payroll_ytd_bonus_err）と同じ取り方: 課税支給は item.taxable（0 以上の円の整数の時）・それ以外は総支給／
     非課税＝総支給−課税支給／社保は ins の5つ（和は item.social と同じ）／所得税は item.tax／住民税は 0 */
  function bonusToYtd(it) {
    it = isObj(it) ? it : {};
    var ins = isObj(it.ins) ? it.ins : {}, d = {};
    YTD_KEYS.forEach(function (k) { d[k] = 0; });
    d.gross = Math.max(0, int(it.gross));
    var tx = it.taxable;
    d.taxable = typeof tx === 'number' && isFinite(tx) && tx >= 0 && Math.round(tx) === tx ? tx : d.gross;
    d.nontax = Math.max(0, d.gross - d.taxable);
    d.si_health = Math.max(0, int(ins.health)); d.si_care = Math.max(0, int(ins.care)); d.si_support = Math.max(0, int(ins.support));
    d.si_pension = Math.max(0, int(ins.pension)); d.si_emp = Math.max(0, int(ins.emp));
    var siSum = d.si_health + d.si_care + d.si_support + d.si_pension + d.si_emp;
    if (it.social != null && int(it.social) > siSum) d.si_other = int(it.social) - siSum;   /* ins が欠けた明細でも合計は DB の social に合わせる */
    d.income_tax = Math.max(0, int(it.tax));
    return d;
  }
  function sameData(a, b) { a = isObj(a) ? a : {}; b = isObj(b) ? b : {}; return YTD_KEYS.every(function (k) { return int(a[k]) === int(b[k]); }); }
  /* planBonusYtd(items, payDate, ytd) → { rows（payroll_ytd_put の p_rows）, same:[staff_id], final:[staff_id], replace:[{staff_id, source}] }
     items: 同じ支給日の確定した回の明細を全部（同じ人が2回にいれば合算・DB と同じ）。ytd: payroll_ytd_get の答え {rows, yearend}
     ・年末調整を確定した人は送らない（final・DB は1件でも final があると何も書かない）
     ・累計に同じ値の app の行があれば送らない（same・版を上げて年末調整の下書きを古くしない）
     ・同じ人・支給日の賞与の行があれば、その版で置き換える（手で足した manual・freee の行も app で置き換える＝replace に出す） */
  function planBonusYtd(items, payDate, ytd) {
    ytd = isObj(ytd) ? ytd : {};
    var by = {}, order = [];
    arr(items).forEach(function (it) {
      if (!it || typeof it.staff_id !== 'string' || int(it.gross) <= 0) return;
      var d = bonusToYtd(it);
      if (!by[it.staff_id]) { by[it.staff_id] = d; order.push(it.staff_id); return; }
      YTD_KEYS.forEach(function (k) { by[it.staff_id][k] += d[k]; });
    });
    var fin = {};
    arr(ytd.yearend).forEach(function (y) { if (y && y.status === 'final') fin[y.staff_id] = 1; });
    var out = { rows: [], same: [], final: [], replace: [] };
    order.forEach(function (sid) {
      if (fin[sid]) { out.final.push(sid); return; }
      var cur = arr(ytd.rows).filter(function (r) { return r && r.staff_id === sid && r.kind === 'bonus' && r.pay_date === payDate; })[0];
      if (cur && cur.source === 'app' && sameData(cur.data, by[sid])) { out.same.push(sid); return; }
      if (cur && cur.source !== 'app') out.replace.push({ staff_id: sid, source: cur.source });
      out.rows.push({ staff_id: sid, pay_date: payDate, kind: 'bonus', source: 'app', data: by[sid], src_fp: '', rev: cur ? int(cur.rev) : 0 });
    });
    return out;
  }
  /* pickByDate(rows, payDate) → { rows, dates, nodate, off }。freee の行を支給日でしぼる（賞与は夏と冬が同じ額でも取り違えないように）
     ・行に支給日がある時は payDate と同じ行だけ。1つも合わなければ off=true（比べない）
     ・支給日の列が無い・空の行（賃金台帳の形）はしぼらずに使う（nodate に数える） */
  function pickByDate(rows, payDate) {
    var list = arr(rows).filter(Boolean), dated = list.filter(function (r) { return r.pay_date; }), dates = {};
    dated.forEach(function (r) { dates[r.pay_date] = 1; });
    var nod = list.filter(function (r) { return !r.pay_date; });
    if (!dated.length) return { rows: list, dates: [], nodate: nod.length, off: false };
    var same = dated.filter(function (r) { return r.pay_date === payDate; });
    return { rows: same.concat(nod), dates: Object.keys(dates).sort(), nodate: nod.length, off: !same.length };
  }

  var api = { VERSION: VERSION, EXCLUDE_PREFIX: EXCLUDE_PREFIX, excluded: excluded, bonusToYtd: bonusToYtd, planBonusYtd: planBonusYtd, pickByDate: pickByDate, HEAD: HEAD, ITEMS: ITEMS, YTD_KEYS: YTD_KEYS, parseCsv: parseCsv, toYen: toYen, toDate: toDate,
    parse: parse, match: match, compare: compare, compareSlips: compareSlips, toYtd: toYtd, fromItem: fromItem, itemToYtd: itemToYtd, nameShort: nameShort };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PayrollFreeeSlips = api;
})(typeof window !== 'undefined' ? window : null);
