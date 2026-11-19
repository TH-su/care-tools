/* payroll-export.js — 給与の書き出しの純関数（2026-11-19 新設・給与 v1 の契約・ROOT-payroll.md C4）
 * ════════════════════════════════════════════════════════════════
 * ・全銀の総合振込（種別 21）・給与振込（11）・賞与振込（12）の 120バイト固定長のバイト列（Shift_JIS・CRLF は設定）
 *   ヘッダ(1)・データ(2)・トレーラ(8)・エンド(9)。出典は rates-2026.md §6（信用金庫の解説・一次文書ではない）
 *   文字は半角の英大文字・数字・半角カナ・一部の記号だけに限る。全角カナ・全角英数は半角へ直し、
 *   直せない文字は「?」にせず一覧で返して止める
 * ・仕訳の CSV（給与手当・役員報酬・旅費交通費・法定福利費・預り金・未払費用・普通預金）
 * ・賃金台帳の CSV（労基則54条: 氏名・性別・賃金計算期間・労働日数・労働時間数・時間外・休日・深夜・賃金の種類ごとの額・控除）
 * ・給与明細一覧の CSV
 * ・画面とは通信も DOM も持たない。試験は check/unit/payroll_export_test.js。個人情報をこのファイルに書かない
 */
(function (root) {
  'use strict';

  /* ── 1. 全銀の文字 ── */
  var ALLOWED_SYM = ' ()-./,\\';
  /* 全角カタカナ → 半角（濁点・半濁点は2文字になる） */
  var KANA_FULL = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴ';
  var KANA_HALF = ['ｱ', 'ｱ', 'ｲ', 'ｲ', 'ｳ', 'ｳ', 'ｴ', 'ｴ', 'ｵ', 'ｵ', 'ｶ', 'ｶﾞ', 'ｷ', 'ｷﾞ', 'ｸ', 'ｸﾞ', 'ｹ', 'ｹﾞ', 'ｺ', 'ｺﾞ',
    'ｻ', 'ｻﾞ', 'ｼ', 'ｼﾞ', 'ｽ', 'ｽﾞ', 'ｾ', 'ｾﾞ', 'ｿ', 'ｿﾞ', 'ﾀ', 'ﾀﾞ', 'ﾁ', 'ﾁﾞ', 'ﾂ', 'ﾂ', 'ﾂﾞ', 'ﾃ', 'ﾃﾞ', 'ﾄ', 'ﾄﾞ',
    'ﾅ', 'ﾆ', 'ﾇ', 'ﾈ', 'ﾉ', 'ﾊ', 'ﾊﾞ', 'ﾊﾟ', 'ﾋ', 'ﾋﾞ', 'ﾋﾟ', 'ﾌ', 'ﾌﾞ', 'ﾌﾟ', 'ﾍ', 'ﾍﾞ', 'ﾍﾟ', 'ﾎ', 'ﾎﾞ', 'ﾎﾟ',
    'ﾏ', 'ﾐ', 'ﾑ', 'ﾒ', 'ﾓ', 'ﾔ', 'ﾔ', 'ﾕ', 'ﾕ', 'ﾖ', 'ﾖ', 'ﾗ', 'ﾘ', 'ﾙ', 'ﾚ', 'ﾛ', 'ﾜ', 'ﾜ', 'ｲ', 'ｴ', 'ｦ', 'ﾝ', 'ｳﾞ'];
  /* 半角の小さいカナ → 大きいカナ（全銀で使えない銀行が多いため・仮置き） */
  var SMALL_HALF = { 'ｧ': 'ｱ', 'ｨ': 'ｲ', 'ｩ': 'ｳ', 'ｪ': 'ｴ', 'ｫ': 'ｵ', 'ｬ': 'ﾔ', 'ｭ': 'ﾕ', 'ｮ': 'ﾖ', 'ｯ': 'ﾂ' };

  /* 全銀に書ける形へ直す。{ text, bad:[直せない文字] } */
  function zenginText(s) {
    var out = '', bad = [];
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i), k;
      if (c >= 0xFF01 && c <= 0xFF5E) { ch = String.fromCharCode(c - 0xFEE0); c = ch.charCodeAt(0); }   /* 全角英数・記号 → 半角 */
      if (ch === '　') ch = ' ';
      if (ch === 'ー' || ch === 'ｰ' || ch === '−' || ch === '‐') ch = '-';   /* 長音は「-」（仮置き） */
      if (ch === '¥' || ch === '￥') ch = '\\';
      if ((k = KANA_FULL.indexOf(ch)) >= 0) { out += KANA_HALF[k].split('').map(function (x) { return SMALL_HALF[x] || x; }).join(''); continue; }
      if (ch === '゛') ch = 'ﾞ';
      if (ch === '゜') ch = 'ﾟ';
      if (SMALL_HALF[ch]) ch = SMALL_HALF[ch];
      if (ch >= 'a' && ch <= 'z') ch = ch.toUpperCase();
      c = ch.charCodeAt(0);
      if ((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || ALLOWED_SYM.indexOf(ch) >= 0 || (c >= 0xFF71 && c <= 0xFF9F) || c === 0xFF66) out += ch;
      else if (bad.indexOf(ch) < 0) bad.push(ch);
    }
    return { text: out, bad: bad };
  }

  /* 半角の文字列 → Shift_JIS のバイト（英数・記号は ASCII、半角カナは 0xA1〜0xDF） */
  function sjisBytes(s) {
    var b = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) b.push(c);
      else if (c >= 0xFF61 && c <= 0xFF9F) b.push(c - 0xFF61 + 0xA1);
      else throw new Error('Shift_JIS に変えられない文字: ' + s.charAt(i));
    }
    return b;
  }

  function isDigits(s, n) { return typeof s === 'string' && /^\d+$/.test(s) && s.length <= n; }
  function zpad(v, n) { var s = String(v); while (s.length < n) s = '0' + s; return s; }
  function spad(s, n) { while (s.length < n) s += ' '; return s; }

  /* 全銀のファイルを作る */
  function zenginBuild(opt) {
    opt = opt || {};
    var errors = [], warnings = [], excluded = [];
    function err(where, msg) { errors.push({ where: where, msg: msg }); }
    function digits(where, v, n, required) {
      var s = v == null ? '' : String(v);
      if (!s && !required) return zpad('', n);
      if (!isDigits(s, n)) { err(where, n + '桁以内の数字ではありません'); return zpad('', n); }
      return zpad(s, n);
    }
    function kana(where, v, n, truncWarn) {
      var z = zenginText(v);
      if (z.bad.length) err(where, '全銀で使えない文字があります: ' + z.bad.join(' '));
      var t = z.text;
      if (t.length > n) { if (truncWarn) warnings.push({ where: where, msg: n + '桁を超えたので切りました' }); t = t.slice(0, n); }
      return spad(t, n);
    }
    var kind = opt.kind === '11' || opt.kind === '12' ? opt.kind : '21';
    var md = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(opt.payDate || ''));
    if (!md) err('header', '振込指定日の形が違います');
    var f = opt.from || {};
    var type = function (where, t, okList) { var s = String(t == null ? '' : t); if (okList.indexOf(s) < 0) { err(where, '預金種目が違います'); return '1'; } return s; };
    var lines = [];
    lines.push('1' + kind + '0' + digits('header.consignor_code', f.consignor_code, 10, true) + kana('header.consignor_kana', f.consignor_kana, 40, true) +
      (md ? md[1] + md[2] : '0000') + digits('header.bank_code', f.bank_code, 4, true) + kana('header.bank_name', f.bank_name_kana, 15, true) +
      digits('header.branch_code', f.branch_code, 3, true) + kana('header.branch_name', f.branch_name_kana, 15, true) +
      type('header.type', f.type, ['1', '2']) + digits('header.number', f.number, 7, true) + spad('', 17));
    var count = 0, total = 0;
    (Array.isArray(opt.records) ? opt.records : []).forEach(function (r, i) {
      var w = 'record' + (i + 1);
      var amt = Number(r && r.amount);
      if (!r || !(amt > 0) || Math.floor(amt) !== amt) { excluded.push({ index: i, reason: '金額が0以下か整数でない' }); return; }
      if (!r.bank_code || !r.number) { excluded.push({ index: i, reason: '口座がない（現金払い）' }); return; }
      if (amt > 9999999999) { err(w, '金額が10桁を超えています'); return; }
      lines.push('2' + digits(w + '.bank_code', r.bank_code, 4, true) + kana(w + '.bank_name', r.bank_name_kana, 15, true) +
        digits(w + '.branch_code', r.branch_code, 3, true) + kana(w + '.branch_name', r.branch_name_kana, 15, true) + spad('', 4) +
        type(w + '.type', r.type, ['1', '2', '4']) + digits(w + '.number', r.number, 7, true) + kana(w + '.name', r.name_kana, 30, true) +
        zpad(amt, 10) + '0' + kana(w + '.cust1', r.cust1 || '', 10, false) + kana(w + '.cust2', r.cust2 || '', 10, false) +
        (kind === '21' ? (r.transfer_kind === '8' ? '8' : '7') : ' ') + ' ' + spad('', 7));
      count++; total += amt;
    });
    if (count > 999999) err('trailer', '件数が6桁を超えています');
    lines.push('8' + zpad(count, 6) + zpad(total, 12) + spad('', 101));
    lines.push('9' + spad('', 119));
    var eol = opt.crlf === false ? [] : [0x0D, 0x0A], bytes = [];
    for (var j = 0; j < lines.length; j++) {
      var lb;
      try { lb = sjisBytes(lines[j]); } catch (e) { err('line' + (j + 1), String(e.message)); lb = []; }
      if (lb.length !== 120) err('line' + (j + 1), '120バイトではありません（' + lb.length + '）');
      for (var k = 0; k < lb.length; k++) bytes.push(lb[k]);
      for (k = 0; k < eol.length; k++) bytes.push(eol[k]);
    }
    if (opt.eof === true) bytes.push(0x1A);
    return { ok: errors.length === 0, bytes: errors.length ? null : new Uint8Array(bytes), lines: lines, count: count, total: total, excluded: excluded, errors: errors, warnings: warnings };
  }

  /* 1人の差引を口座（最大3つ）へ分ける。amount_or_rest: 数＝その額・'rest'＝残り（最後の 'rest' が受ける） */
  function splitAccounts(net, accounts) {
    var list = (Array.isArray(accounts) ? accounts : []).slice(0, 3), out = [], left = Math.max(0, Math.round(Number(net) || 0)), restIdx = -1;
    list.forEach(function (a, i) { if (a && a.amount_or_rest === 'rest') restIdx = i; });
    if (restIdx < 0 && list.length) restIdx = list.length - 1;
    list.forEach(function (a, i) {
      if (!a || i === restIdx) return;
      var v = Math.min(left, Math.max(0, Math.round(Number(a.amount_or_rest) || 0)));
      if (v > 0) { out.push({ account: a, amount: v }); left -= v; }
    });
    if (restIdx >= 0 && left > 0) out.push({ account: list[restIdx], amount: left });
    return { parts: out, rest: restIdx < 0 ? left : 0 };
  }

  /* 振込の合計と差引の合計の照合（現金払い・0以下は transferable=false で外す） */
  function checkTotals(items, built) {
    var sum = 0;
    (items || []).forEach(function (x) { if (x && x.transferable !== false && Number(x.net) > 0) sum += Number(x.net); });
    return { ok: !!built && built.total === sum, netTotal: sum, fileTotal: built ? built.total : null, diff: built ? built.total - sum : null };
  }

  /* ── 2. CSV ── */
  function csvCell(v) {
    if (typeof v === 'number') return String(v);
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   /* 表計算ソフトで式として読まれないように */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvJoin(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }
  function hm(min) { min = Math.max(0, Math.round(Number(min) || 0)); var m = min % 60; return Math.floor(min / 60) + ':' + (m < 10 ? '0' : '') + m; }
  function attOf(item, code) { var l = (item.lines || []).filter(function (x) { return x.sec === 'att' && x.code === code; })[0]; return l ? l.qty : 0; }
  /* 区分 sec の行の名前を、出てきた順で集める（同じ code は1列） */
  function columns(rows, sec) {
    var cols = [], seen = {};
    rows.forEach(function (r) {
      (r.item.lines || []).forEach(function (l) {
        if (l.sec !== sec) return;
        var key = l.code.indexOf('adj:') === 0 ? 'adj:' + l.name : l.code;
        if (!seen[key]) { seen[key] = 1; cols.push({ key: key, name: l.name }); }
      });
    });
    return cols;
  }
  function amountsBy(item, sec) {
    var o = {};
    (item.lines || []).forEach(function (l) {
      if (l.sec !== sec) return;
      var key = l.code.indexOf('adj:') === 0 ? 'adj:' + l.name : l.code;
      o[key] = (o[key] || 0) + l.amount;
    });
    return o;
  }
  function genderLabel(g) { return g === 'male' || g === 'M' || g === '男' ? '男' : (g === 'female' || g === 'F' || g === '女' ? '女' : ''); }

  /* 賃金台帳（労基則54条）。rows: [{ emp_num, name, gender, period:{from,to}, item }] */
  function wageLedgerCsv(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var pc = columns(rows, 'pay'), dc = columns(rows, 'deduct');
    var head = ['従業員番号', '氏名', '性別', '賃金計算期間', '労働日数', '労働時間数', '時間外労働時間数', '法定内残業時間数', '休日労働時間数', '深夜労働時間数']
      .concat(pc.map(function (c) { return c.name; }), ['総支給額'], dc.map(function (c) { return c.name; }), ['控除合計', '差引支給額']);
    var out = [head];
    rows.forEach(function (r) {
      var it = r.item, pa = amountsBy(it, 'pay'), da = amountsBy(it, 'deduct'), p = r.period || {};
      out.push([r.emp_num || '', r.name || '', genderLabel(r.gender), (p.from || '') + '〜' + (p.to || ''), attOf(it, 'workDays'), hm(attOf(it, 'workMin')),
        hm(attOf(it, 'legalOverMin')), hm(attOf(it, 'legalInOverMin')), hm(attOf(it, 'holidayMin')), hm(attOf(it, 'nightMin'))]
        .concat(pc.map(function (c) { return pa[c.key] || 0; }), [it.gross], dc.map(function (c) { return da[c.key] || 0; }), [it.deduct, it.net]));
    });
    return csvJoin(out);
  }

  /* 給与明細の一覧。rows: [{ emp_num, name, item }] */
  function payslipListCsv(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var pc = columns(rows, 'pay'), dc = columns(rows, 'deduct');
    var head = ['従業員番号', '氏名', '総支給額', '課税支給額', '社会保険料等', '課税対象額', '控除合計', '差引支給額']
      .concat(pc.map(function (c) { return c.name; }), dc.map(function (c) { return c.name; }));
    var out = [head];
    rows.forEach(function (r) {
      var it = r.item, pa = amountsBy(it, 'pay'), da = amountsBy(it, 'deduct');
      out.push([r.emp_num || '', r.name || '', it.gross, it.taxable, it.si_total, it.tax_base, it.deduct, it.net]
        .concat(pc.map(function (c) { return pa[c.key] || 0; }), dc.map(function (c) { return da[c.key] || 0; })));
    });
    return csvJoin(out);
  }

  /* 仕訳。rows: [{ board:bool, item }]。会社負担は全員の小数の和を円未満切捨て（仮置き） */
  var ACCOUNTS = { salary: '給与手当', board: '役員報酬', commute: '旅費交通費', welfare: '法定福利費', si: '預り金', emp: '預り金', tax: '預り金',
    resident: '預り金', other: '預り金', welfare_payable: '未払費用', bank: '普通預金' };
  function journalCsv(rows, opt) {
    rows = Array.isArray(rows) ? rows : []; opt = opt || {};
    var A = {}, k, acc = opt.accounts || {};
    for (k in ACCOUNTS) A[k] = typeof acc[k] === 'string' && acc[k] ? acc[k] : ACCOUNTS[k];
    var s = { salary: 0, board: 0, commute: 0, si: 0, emp: 0, tax: 0, resident: 0, other: 0, net: 0 }, er = 0;
    rows.forEach(function (r) {
      var it = r.item;
      (it.lines || []).forEach(function (l) {
        if (l.sec === 'pay') {
          if (l.code === 'commute') s.commute += l.amount;
          else if (r.board || l.code === 'board') s.board += l.amount;
          else s.salary += l.amount;
        } else if (l.sec === 'deduct') {
          if (['health', 'care', 'support', 'pension'].indexOf(l.code) >= 0) s.si += l.amount;
          else if (l.code === 'emp') s.emp += l.amount;
          else if (l.code === 'income_tax') s.tax += l.amount;
          else if (l.code === 'resident_tax') s.resident += l.amount;
          else s.other += l.amount;
        } else if (l.sec === 'employer') er += Math.round(Number(l.amount) * 10000);
      });
      s.net += it.net;
    });
    var erYen = Math.floor(er / 10000);
    var date = opt.date || '', memo = opt.memo || '給与';
    var D = [[A.salary, s.salary], [A.board, s.board], [A.commute, s.commute], [A.welfare, erYen]];
    var C = [[A.si, s.si, '社会保険料'], [A.emp, s.emp, '雇用保険料'], [A.tax, s.tax, '源泉所得税'], [A.resident, s.resident, '住民税'],
      [A.other, s.other, 'その他控除'], [A.welfare_payable, erYen, '法定福利費（会社負担）'], [A.bank, s.net, '差引支給額']];
    var out = [['取引日', '借方勘定科目', '借方金額', '貸方勘定科目', '貸方金額', '摘要']], dt = 0, ct = 0;
    D.forEach(function (d) { if (d[1]) { out.push([date, d[0], d[1], '', '', memo]); dt += d[1]; } });
    C.forEach(function (c) { if (c[1]) { out.push([date, '', '', c[0], c[1], memo + ' ' + c[2]]); ct += c[1]; } });
    return { csv: csvJoin(out), debit: dt, credit: ct, balanced: dt === ct, employer: erYen, sums: s };
  }

  var api = {
    zenginText: zenginText, sjisBytes: sjisBytes, zenginBuild: zenginBuild, splitAccounts: splitAccounts, checkTotals: checkTotals,
    csvCell: csvCell, wageLedgerCsv: wageLedgerCsv, payslipListCsv: payslipListCsv, journalCsv: journalCsv, ACCOUNTS: ACCOUNTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollExport = api;
})(typeof window !== 'undefined' ? window : this);
