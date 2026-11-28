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
      if (t.length > n) {
        if (truncWarn) warnings.push({ where: where, msg: n + '桁を超えたので切りました' });
        /* 濁点・半濁点（ﾞ ﾟ）は前の字と2文字で1つの音。切る所の次が濁点・半濁点なら、その前の字も残さない（ｶﾞ の ｶ だけを残さない・2026-11-21） */
        var cut = n; if (t.charAt(n) === 'ﾞ' || t.charAt(n) === 'ﾟ') cut = n - 1;
        t = t.slice(0, cut);
      }
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
      .concat(pc.map(function (c) { return c.name; }), ['総支給額'], dc.map(function (c) { return c.name; }), ['控除合計', '差引支給額', '備考']);
    var out = [head];
    rows.forEach(function (r) {
      var it = r.item, pa = amountsBy(it, 'pay'), da = amountsBy(it, 'deduct'), p = r.period || {};
      /* 勤怠の無い人（役員・固定給）は日数・時間の欄を空欄にする（0 と書かない） */
      var hasAtt = (it.lines || []).some(function (l) { return l.sec === 'att'; });
      var attCols = hasAtt ? [attOf(it, 'workDays'), hm(attOf(it, 'workMin')), hm(attOf(it, 'legalOverMin')), hm(attOf(it, 'legalInOverMin')), hm(attOf(it, 'holidayMin')), hm(attOf(it, 'nightMin'))]
        : ['', '', '', '', '', ''];
      out.push([r.emp_num || '', r.name || '', genderLabel(r.gender), (p.from || '') + '〜' + (p.to || '')].concat(attCols)
        .concat(pc.map(function (c) { return pa[c.key] || 0; }), [it.gross], dc.map(function (c) { return da[c.key] || 0; }), [it.deduct, it.net, hasAtt ? '' : '勤怠なし（固定給）']));
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
  var ACCOUNTS = { salary: '給与手当', board: '役員報酬', commute: '旅費交通費', nontax: '立替金', welfare: '法定福利費', si: '預り金', emp: '預り金', tax: '預り金',
    resident: '預り金', other: '預り金', welfare_payable: '未払費用', bank: '普通預金' };
  function journalCsv(rows, opt) {
    rows = Array.isArray(rows) ? rows : []; opt = opt || {};
    var A = {}, k, acc = opt.accounts || {};
    for (k in ACCOUNTS) A[k] = typeof acc[k] === 'string' && acc[k] ? acc[k] : ACCOUNTS[k];
    var s = { salary: 0, board: 0, commute: 0, nontax: 0, si: 0, emp: 0, tax: 0, resident: 0, other: 0, net: 0 }, er = 0;
    rows.forEach(function (r) {
      var it = r.item;
      (it.lines || []).forEach(function (l) {
        if (l.sec === 'pay') {
          if (l.code === 'commute') s.commute += l.amount;
          else if (l.code.indexOf('adj_nontax:') === 0) s.nontax += l.amount;   /* 非課税の精算は給与・役員報酬に入れない */
          else if (r.board || l.code === 'board') s.board += l.amount;
          else s.salary += l.amount;
        } else if (l.sec === 'deduct') {
          if (['health', 'care', 'support', 'pension'].indexOf(l.code) >= 0) s.si += l.amount;
          else if (l.code === 'emp') s.emp += l.amount;
          else if (l.code === 'income_tax' || l.code === 'tax_adjust') s.tax += l.amount;   /* 税の精算も源泉の預り金 */
          else if (l.code === 'resident_tax') s.resident += l.amount;
          else s.other += l.amount;
        } else if (l.sec === 'employer') er += Math.round(Number(l.amount) * 10000);
      });
      s.net += it.net;
    });
    var erYen = Math.floor(er / 10000);
    var date = opt.date || '', memo = opt.memo || '給与';
    var D = [[A.salary, s.salary], [A.board, s.board], [A.commute, s.commute], [A.nontax, s.nontax], [A.welfare, erYen]];
    var C = [[A.si, s.si, '社会保険料'], [A.emp, s.emp, '雇用保険料'], [A.tax, s.tax, '源泉所得税'], [A.resident, s.resident, '住民税'],
      [A.other, s.other, 'その他控除'], [A.welfare_payable, erYen, '法定福利費（会社負担）'], [A.bank, s.net, '差引支給額']];
    var out = [['取引日', '借方勘定科目', '借方金額', '貸方勘定科目', '貸方金額', '摘要']], dt = 0, ct = 0;
    /* マイナスの額は借方と貸方を入れ替えて正の額で書く */
    D.forEach(function (d) {
      if (d[1] > 0) { out.push([date, d[0], d[1], '', '', memo]); dt += d[1]; }
      else if (d[1] < 0) { out.push([date, '', '', d[0], -d[1], memo]); ct += -d[1]; }
    });
    C.forEach(function (c) {
      if (c[1] > 0) { out.push([date, '', '', c[0], c[1], memo + ' ' + c[2]]); ct += c[1]; }
      else if (c[1] < 0) { out.push([date, c[0], -c[1], '', '', memo + ' ' + c[2]]); dt += -c[1]; }
    });
    return { csv: csvJoin(out), debit: dt, credit: ct, balanced: dt === ct, employer: erYen, sums: s };
  }

  /* ── 3. 画面向けの口（2026-11-19 結びの段・上の純関数を呼ぶだけで、書き出しの決まりは変えない） ──
     o = { ym, period:{from,to}, payDate, settings（payroll_settings.config）, items:[明細（staff_id・name・lines・gross・deduct・net …）],
           profiles:[{staff_id, data}], rows（zengin だけ・payroll_bank_export の rows [{staff_id, net, accounts}]） } */
  function fileName(kind, ym, ext) { return 'payroll-' + kind + '-' + (/^\d{4}-\d{2}$/.test(String(ym)) ? ym : 'x') + '.' + ext; }
  function profMap(o) { var m = {}; (Array.isArray(o.profiles) ? o.profiles : []).forEach(function (p) { if (p && p.staff_id) m[p.staff_id] = p.data || {}; }); return m; }
  function itemsOf(o) { return (Array.isArray(o.items) ? o.items : []).filter(function (it) { return it && it.staff_id; }); }
  /* 振込: 口座を2つ以上に分けた人は口座ごとに1件（count は全銀のデータの件数＝分けた後の数） */
  function zengin(o) {
    o = o || {};
    var S = o.settings || {}, bf = S.bank_from || {}, z = S.zengin || {}, by = {}, records = [], skipped = [], extra = [];
    itemsOf(o).forEach(function (it) { by[it.staff_id] = it; });
    (Array.isArray(o.rows) ? o.rows : []).forEach(function (r, i) {
      var it = r && by[r.staff_id];
      if (!it) { skipped.push(r && r.staff_id); return; }
      if (Number(r.net) !== Number(it.net)) { extra.push({ where: 'row' + (i + 1), msg: '確定した差引と振込の額が違います', who: it.name || '' }); return; }
      var sp = splitAccounts(it.net, r.accounts);
      if (sp.rest > 0) { extra.push({ where: 'row' + (i + 1), msg: '口座に振り分けられない残りがあります', who: it.name || '' }); return; }
      sp.parts.forEach(function (p) {
        var a = p.account || {};
        records.push({ bank_code: a.bank_code, branch_code: a.branch_code, type: a.type, number: a.number, name_kana: a.name_kana, amount: p.amount, who: it.name || '' });
      });
    });
    var built = zenginBuild({ kind: z.kind, payDate: o.payDate, crlf: z.crlf !== false, records: records,
      from: { consignor_code: bf.consignor_code, consignor_kana: bf.consignor_kana, bank_code: bf.bank_code, bank_name_kana: bf.bank_kana,
        branch_code: bf.branch_code, branch_name_kana: bf.branch_kana, type: bf.type, number: bf.number } });
    /* どの職員の行の知らせかを添える（who＝明細の表示名・recordN は records の並び＝口座ごと） */
    var whoOf = function (e) { var m = /^record(\d+)\./.exec(String(e.where || '')) || /^record(\d+)$/.exec(String(e.where || '')), rc = m && records[+m[1] - 1]; if (rc && rc.who) e.who = rc.who; return e; };
    built.errors.forEach(whoOf); built.warnings.forEach(whoOf);
    var errors = built.errors.concat(extra);
    return { ok: errors.length === 0, name: fileName('zengin', o.ym, 'txt'), bytes: errors.length ? null : built.bytes, count: built.count, total: built.total,
      errors: errors, warnings: built.warnings, skipped: skipped };
  }
  function journal(o) {
    o = o || {};
    var pm = profMap(o), S = o.settings || {}, J = S.journal && typeof S.journal === 'object' ? S.journal : {};
    var r = journalCsv(itemsOf(o).map(function (it) { return { board: (pm[it.staff_id] || {}).pay_type === 'board', item: it }; }),
      { date: o.payDate || '', accounts: J.accounts && typeof J.accounts === 'object' ? J.accounts : J });
    return { ok: r.balanced, name: fileName('journal', o.ym, 'csv'), text: r.csv, balanced: r.balanced };
  }
  function ledger(o) {
    o = o || {};
    var pm = profMap(o);
    return { ok: true, name: fileName('ledger', o.ym, 'csv'), text: wageLedgerCsv(itemsOf(o).map(function (it) {
      var d = pm[it.staff_id] || {};
      return { emp_num: d.freee_emp_num == null ? '' : String(d.freee_emp_num), name: it.name, gender: d.gender, period: o.period, item: it };
    })) };
  }
  function list(o) {
    o = o || {};
    var pm = profMap(o);
    return { ok: true, name: fileName('list', o.ym, 'csv'), text: payslipListCsv(itemsOf(o).map(function (it) {
      var d = pm[it.staff_id] || {};
      return { emp_num: d.freee_emp_num == null ? '' : String(d.freee_emp_num), name: it.name, item: it };
    })) };
  }

  /* ── 従業員の項目を選んで書き出す（職員の給与設定の CSV・2026-11-28） ──
     o = { ym, profiles: [{staff_id, name, effective_from, data, none}], staffInfo: { staff_id: {emp_code, office} }, defs: [{code, name, sec}], keys: [選んだ列の key（並びどおり）] }
     ・口座は出さない（下4桁も）・給与の設定が無い人（none）は出さない・計算から外す人も出す（列「計算から外す」で分かる）
     ・列は empColumns(defs) が返す物だけ（知らない key は捨てる）。値は表計算ソフトで式として読まれないよう csvCell で無害化 */
  var PT_JA = { monthly: '月給', hourly: '時給', daily: '日給', board: '役員報酬' };
  var COL_JA = { kou: '甲欄', otsu: '乙欄', none: '対象外' };
  var MEANS_JA = { public: '公共交通', car: '車・自転車', mixed: '併用' };
  function yn(b) { return b === true ? 'はい' : ''; }
  function o_(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function blank(v) { return v === null || v === undefined ? '' : v; }
  function empColumns(defs, profiles) {
    /* 隠した手当も、額を持つ人がいれば列に出す（隠しても払っているため・反証レビュー 2026-11-28） */
    var used = {};
    (Array.isArray(profiles) ? profiles : []).forEach(function (p) { var d = o_(p && p.data); ['allowances', 'deductions'].forEach(function (k) { (Array.isArray(d[k]) ? d[k] : []).forEach(function (a) { if (a && a.code && a.amount !== null && a.amount !== undefined && a.amount !== '') used[a.code] = 1; }); }); });
    var c = [
      { key: 'code', label: '社員番号', group: '基本' }, { key: 'name', label: '氏名', group: '基本' }, { key: 'office', label: '事業所', group: '基本' },
      { key: 'freee_emp_num', label: '従業員番号（freee）', group: '基本' }, { key: 'birth_date', label: '生年月日', group: '基本' }, { key: 'gender', label: '性別', group: '基本' },
      { key: 'entry_date', label: '入社日', group: '基本' }, { key: 'retire_date', label: '退職日', group: '基本' }, { key: 'effective_from', label: '今の設定の版（いつから）', group: '基本' },
      { key: 'pay_type', label: '給与形態', group: '給与' }, { key: 'base', label: '基本給・時給・日給', group: '給与' }, { key: 'board_pay', label: '役員報酬', group: '給与' },
      { key: 'avg_month_hours', label: '月平均所定労働時間', group: '給与' }, { key: 'avg_month_days', label: '月平均所定労働日数', group: '給与' }, { key: 'day_hours', label: '1日の所定時間', group: '給与' }
    ];
    (Array.isArray(defs) ? defs : []).forEach(function (a) {
      if (!a || !a.code || (a.hidden && !used[a.code])) return;
      /* 回数・時間・日数で額が変わる手当（calc が fixed 以外）の額は単価（payroll-calc.js の手当の計算） */
      var unit = a.calc && a.calc !== 'fixed' ? '（単価）' : '';
      if (a.sec === 'pay') c.push({ key: 'al:' + a.code, label: (a.name || a.code) + unit, group: '手当' });
      else if (a.sec === 'deduct') c.push({ key: 'de:' + a.code, label: (a.name || a.code), group: '固定の控除' });
    });
    c.push({ key: 'commute', label: '通勤手当（月）', group: '通勤' }, { key: 'commute_means', label: '通勤の手段', group: '通勤' }, { key: 'commute_km', label: '片道の距離（km）', group: '通勤' }, { key: 'commute_parking', label: '駐車場の料金（月）', group: '通勤' },
      { key: 'health_on', label: '健康保険', group: '社会保険' }, { key: 'health_std', label: '健保の標準報酬月額', group: '社会保険' }, { key: 'pension_on', label: '厚生年金', group: '社会保険' }, { key: 'pension_std', label: '厚年の標準報酬月額', group: '社会保険' },
      { key: 'emp_on', label: '雇用保険', group: '社会保険' }, { key: 'care_exempt', label: '介護保険の対象外', group: '社会保険' },
      { key: 'tax_col', label: '源泉の区分', group: '税' }, { key: 'dependents', label: '扶養親族等の数', group: '税' }, { key: 'resident_tax', label: '住民税（この月分）', group: '税' },
      { key: 'no_attendance', label: '勤怠を使わない', group: 'そのほか' }, { key: 'exclude', label: '計算から外す', group: 'そのほか' });
    return c;
  }
  function empValue(key, p, si, ym, opt) {
    opt = opt || {};
    var d = o_(p.data), ins = o_(d.ins), cm = o_(d.commute), tx = o_(d.tax);
    function amt(list, code) { var x = (Array.isArray(list) ? list : []).filter(function (a) { return a && a.code === code; })[0]; return x && x.amount !== null && x.amount !== undefined && x.amount !== '' ? Number(x.amount) : ''; }
    if (/^al:/.test(key)) return amt(d.allowances, key.slice(3));
    if (/^de:/.test(key)) return amt(d.deductions, key.slice(3));
    switch (key) {
      case 'code': return si.emp_code || '';
      case 'name': return p.name || '';
      case 'office': return si.office ? (typeof opt.officeName === 'function' ? (opt.officeName(si.office) || si.office) : si.office) : '';
      case 'freee_emp_num': return blank(d.freee_emp_num);
      case 'birth_date': return blank(d.birth_date);
      case 'gender': return genderLabel(d.gender);
      case 'entry_date': return blank(d.entry_date);
      case 'retire_date': return blank(d.retire_date);
      case 'effective_from': return blank(p.effective_from);
      case 'pay_type': return PT_JA[d.pay_type] || '';
      case 'base': return d.pay_type === 'board' ? '' : blank(d.base);
      case 'board_pay': return blank(d.board_pay);
      case 'avg_month_hours': return blank(d.avg_month_hours);
      case 'avg_month_days': return blank(d.avg_month_days);
      case 'day_hours': return blank(d.day_hours);
      case 'commute': return blank(cm.monthly);
      case 'commute_means': return MEANS_JA[cm.means] || '';
      case 'commute_km': return blank(cm.distance_km);
      case 'commute_parking': return blank(cm.parking_monthly);
      case 'health_on': return yn(o_(ins.health).on);
      case 'health_std': return blank(o_(ins.health).std);
      case 'pension_on': return yn(o_(ins.pension).on);
      case 'pension_std': return blank(o_(ins.pension).std);
      case 'emp_on': return yn(o_(ins.emp).on);
      case 'care_exempt': return yn(ins.care_exempt);
      case 'tax_col': return COL_JA[tx.col] || '';
      case 'dependents': return blank(tx.dependents);
      case 'resident_tax': return blank(o_(d.resident_tax)[opt.taxYm || ym]);
      case 'no_attendance': return yn(d.no_attendance);
      case 'exclude': return yn(d.exclude);
    }
    return '';
  }
  function empCsv(o) {
    o = o || {};
    var cols = empColumns(o.defs, o.profiles), by = {};
    cols.forEach(function (c) { by[c.key] = c; });
    var keys = (Array.isArray(o.keys) ? o.keys : []).filter(function (k, i, a) { return by[k] && a.indexOf(k) === i; });
    if (!keys.length) return { ok: false, error: 'nocols' };
    var si = o_(o.staffInfo), rows = [keys.map(function (k) { return by[k].group === '手当' || by[k].group === '固定の控除' ? by[k].group + '：' + by[k].label : by[k].label; })], n = 0;
    (Array.isArray(o.profiles) ? o.profiles : []).forEach(function (p) {
      if (!p || !p.staff_id || p.none) return;
      n++;
      rows.push(keys.map(function (k) { return empValue(k, p, o_(si[p.staff_id]), o.ym, o); }));
    });
    return { ok: true, name: fileName('staff', o.ym, 'csv'), text: csvJoin(rows), count: n };
  }

  var api = {
    zengin: zengin, journal: journal, ledger: ledger, list: list,
    zenginText: zenginText, sjisBytes: sjisBytes, zenginBuild: zenginBuild, splitAccounts: splitAccounts, checkTotals: checkTotals,
    empColumns: empColumns, empCsv: empCsv,
    csvCell: csvCell, wageLedgerCsv: wageLedgerCsv, payslipListCsv: payslipListCsv, journalCsv: journalCsv, ACCOUNTS: ACCOUNTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollExport = api;
})(typeof window !== 'undefined' ? window : this);
