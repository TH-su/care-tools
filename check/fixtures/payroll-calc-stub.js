/* check/fixtures/payroll-calc-stub.js — 給与の画面（payroll.html）を確かめるための「契約どおりの形の偽の部品」（2026-11-19）
 * ════════════════════════════════════════════════════════════════
 * ★本物ではない。試験（check/unit/payroll_page_test.js）と確かめ用の撮影（check/payroll_e2e.mjs・check/fixtures/payroll.mjs）
 *   だけで使い、公開の画面は読まない（撮影の時は payroll-calc.js・payroll-export.js の要求をこのファイルで答える）。
 * ★金額の式はでたらめ（形だけ契約 CONTRACT-payroll-v1.md §2・§3 にそろえる）。法令の数え方・率は本物の payroll-calc.js が受け持つ。
 * 契約の形:
 *   PayrollCalc.computeItem(input) → { lines:[{sec,code,name,qty,unit,amount,basis}], gross, taxable, si_total, emp_ins_base, tax_base,
 *                                      deduct, net, buckets, warnings:[{code,msg}], fingerprint_inputs:{profile_rev,settings_rev,rates_ver,calc_ver} }
 *   PayrollCalc.payDate(ym, settings) → 'YYYY-MM-DD'（土日祝を寄せた支給日）  ※画面が使う形（仮置き・本物に足してもらう）
 *   PayrollExport.zengin({ym, payDate, settings, items, accounts}) → { name, bytes:Uint8Array, count, total, skipped:[staff_id] }
 *   PayrollExport.journal / ledger / list({ym, period, payDate, settings, items, profiles}) → { name, text }
 */
(function (g) {
  'use strict';
  var CALC_VER = 'stub-0', RATES_VER = 'stub-rates-0';
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function r0(v) { return Math.round(v); }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2); }

  function payDate(ym, settings) {
    var st = settings || {}, day = num(st.pay_day) || 27, hol = Array.isArray(st.holidays) ? st.holidays : [];
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var d = new Date(Date.UTC(y, m - 1, Math.min(day, last)));
    for (var i = 0; i < 10; i++) {
      var w = d.getUTCDay();
      if (w !== 0 && w !== 6 && hol.indexOf(ymd(d)) < 0) break;
      d = new Date(d.getTime() + (st.pay_day_shift === 'after' ? 1 : -1) * 86400000);
    }
    return ymd(d);
  }

  function computeItem(input) {
    var p = (input && input.profile) || {}, att = input && input.att, lines = [], warnings = [];
    var adj = (input && input.adjustments) || [];
    function L(sec, code, name, qty, unit, amount, basis) { lines.push({ sec: sec, code: code, name: name, qty: qty, unit: unit, amount: amount, basis: basis }); }
    if (att) {
      L('att', 'workDays', '出勤日数', att.workDays || 0, '日', 0, '勤怠の締めの数字');
      L('att', 'workMin', '総労働', Math.round((att.workMin || 0) / 6) / 10, '時間', 0, '勤怠の締めの数字');
      L('att', 'legalOverMin', '時間外', Math.round((att.legalOverMin || 0) / 6) / 10, '時間', 0, '勤怠の締めの数字');
      L('att', 'paidDays', '有休', att.paidDays || 0, '日', 0, '勤怠の締めの数字');
    } else if (!p.no_attendance) warnings.push({ code: 'noatt', msg: '勤怠の数字がありません（未締め）' });
    var pay = 0, unit = 0;
    if (p.pay_type === 'monthly') { pay = num(p.base); unit = Math.ceil(pay / (num(p.avg_month_hours) || 172)); L('pay', 'base', '基本給', 1, '月', pay, '月給'); }
    else if (p.pay_type === 'hourly') { unit = num(p.base); pay = Math.ceil(unit * ((att ? att.schedInMin + att.paidMin : 0) / 60)); L('pay', 'base', '基本給', Math.round((att ? att.schedInMin + att.paidMin : 0) / 6) / 10, '時間', pay, '時給 ' + unit + ' 円 × 所定内＋有休の時間'); }
    else if (p.pay_type === 'daily') { unit = Math.ceil(num(p.base) / (num(p.day_hours) || 8)); pay = num(p.base) * (att ? att.workDays : 0); L('pay', 'base', '基本給', att ? att.workDays : 0, '日', pay, '日給 × 出勤日数'); }
    else if (p.pay_type === 'board') { pay = num(p.board_pay); L('pay', 'board', '役員報酬', 1, '月', pay, '役員報酬'); }
    else warnings.push({ code: 'nopaytype', msg: '給与形態が入っていません' });
    var gross = pay, nontax = 0;
    var defs = (input && input.allowanceDefs) || [];
    function defName(code) { for (var i = 0; i < defs.length; i++) if (defs[i].code === code) return defs[i].name; return code; }
    (p.allowances || []).forEach(function (a) { var v = r0(num(a.amount)); if (!v) return; gross += v; L('pay', a.code, defName(a.code), 1, '月', v, '固定の手当'); });
    if (att && att.legalOverMin && unit) { var ov = Math.ceil(unit * 1.25 * att.legalOverMin / 60); gross += ov; L('pay', 'ot_out', '時間外手当', Math.round(att.legalOverMin / 6) / 10, '時間', ov, '時間単価 ' + unit + ' 円 × 1.25'); }
    if (p.commute && num(p.commute.monthly)) { var cm = r0(num(p.commute.monthly)); gross += cm; nontax += cm; L('pay', 'commute', '通勤手当', 1, '月', cm, '非課税（限度内）'); }
    var addDeduct = 0, siAdj = 0, taxAdj = 0;
    adj.forEach(function (a) {
      var v = r0(num(a.amount));
      if (a.kind === 'pay') { gross += v; L('pay', 'adj', a.name, 1, '回', v, 'その月だけ：' + (a.reason || '')); }
      else if (a.kind === 'pay_nontax') { gross += v; nontax += v; L('pay', 'adj', a.name, 1, '回', v, 'その月だけ（非課税）：' + (a.reason || '')); }
      else if (a.kind === 'deduct') { addDeduct += v; }
      else if (a.kind === 'deduct_si') { siAdj += v; }
      else if (a.kind === 'tax_adjust') { taxAdj += v; }
    });
    var ins = p.ins || {}, hstd = ins.health && num(ins.health.std), pstd = ins.pension && num(ins.pension.std);
    var health = ins.health && ins.health.on ? r0(hstd * 0.0504) : 0, pension = ins.pension && ins.pension.on ? r0(pstd * 0.0915) : 0;
    var emp = ins.emp && ins.emp.on ? r0(gross * 0.005) : 0;
    if (ins.health && ins.health.on && !hstd) warnings.push({ code: 'nostd', msg: '健康保険の標準報酬が空です' });
    if (!p.birth_date) warnings.push({ code: 'nobirth', msg: '生年月日が空です（年齢の判定ができません）' });
    var siTotal = health + pension + emp + siAdj;
    var taxable = gross - nontax, taxBase = Math.max(0, taxable - siTotal);
    var tax = p.tax && p.tax.col === 'none' ? 0 : Math.max(0, r0(taxBase * 0.03)) + taxAdj;
    if (p.tax && p.tax.dependents_checked === false) warnings.push({ code: 'deps', msg: '扶養の数が未確認です' });
    var rt = p.resident_tax && input.payDate ? num(p.resident_tax[input.payDate.slice(0, 7)]) : 0;
    if (health) L('deduct', 'health', '健康保険', 1, '月', health, '標準報酬 ' + hstd + ' 円 × 率（偽）');
    if (pension) L('deduct', 'pension', '厚生年金', 1, '月', pension, '標準報酬 ' + pstd + ' 円 × 率（偽）');
    if (emp) L('deduct', 'emp', '雇用保険', 1, '月', emp, '賃金 × 率（偽）');
    if (siAdj) L('deduct', 'adj_si', '社会保険料の調整', 1, '回', siAdj, 'その月だけ');
    L('deduct', 'tax', '所得税', 1, '月', tax, '課税の基礎 ' + taxBase + ' 円（偽の式）');
    if (rt) L('deduct', 'resident', '住民税', 1, '月', rt, '特別徴収');
    adj.forEach(function (a) { if (a.kind === 'deduct') L('deduct', 'adj', a.name, 1, '回', r0(num(a.amount)), 'その月だけ：' + (a.reason || '')); });
    (p.deductions || []).forEach(function (d) { var v = r0(num(d.amount)); if (!v) return; addDeduct += v; L('deduct', d.code, defName(d.code), 1, '月', v, '固定の控除'); });
    var deduct = siTotal + tax + rt + addDeduct, net = gross - deduct;
    if (net < 0) warnings.push({ code: 'netneg', msg: '差引がマイナスです' });
    var prev = input && input.prevItem;
    if (prev && prev.net && Math.abs(net - prev.net) / Math.abs(prev.net) >= 0.2) warnings.push({ code: 'prev20', msg: '前月から20%以上変わりました' });
    L('employer', 'health_er', '健康保険（会社）', 1, '月', health, '');
    return {
      lines: lines, gross: gross, taxable: taxable, si_total: siTotal, emp_ins_base: gross, tax_base: taxBase, deduct: deduct, net: net,
      buckets: { taxable: taxable, nontax: nontax, emp_ins_base: gross, labor_ins_base: gross, fixed_wage: pay, si_by_kind: { health: health, care: 0, support: 0, pension: pension, emp: emp } },
      warnings: warnings,
      fingerprint_inputs: { profile_rev: input && input.profileRev != null ? input.profileRev : null, settings_rev: input && input.settingsRev != null ? input.settingsRev : null, rates_ver: RATES_VER, calc_ver: CALC_VER }
    };
  }

  /* 全銀の形だけ（120字の固定長・英数と半角の空白だけ・CRLF）。中身は偽 */
  function zengin(o) {
    var recs = [], total = 0, count = 0, skipped = [];
    function fit(s, w) { s = String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, ' '); while (s.length < w) s += ' '; return s.slice(0, w); }
    function z(n, w) { return pad(String(n).replace(/\D/g, ''), w).slice(-w); }
    recs.push(fit('1' + '21' + '0' + z(0, 10) + fit('STUB', 40) + z((o.payDate || '').slice(5).replace('-', ''), 4), 120));
    (o.items || []).forEach(function (it) {
      var acc = o.accounts && o.accounts[it.staff_id];
      if (!acc || !acc.length || !(it.net > 0)) { skipped.push(it.staff_id); return; }
      var a = acc[0];
      recs.push(fit('2' + z(a.bank_code, 4) + fit('', 15) + z(a.branch_code, 3) + fit('', 19) + z(a.type || 1, 1) + z(a.number, 7) + fit(a.name_kana, 30) + z(it.net, 10), 120));
      total += it.net; count++;
    });
    recs.push(fit('8' + z(count, 6) + z(total, 12), 120));
    recs.push(fit('9', 120));
    var s = recs.join('\r\n') + '\r\n', b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return { name: 'zengin-' + o.ym + '.txt', bytes: b, count: count, total: total, skipped: skipped };
  }
  function csv(rows) { return rows.map(function (r) { return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n') + '\r\n'; }
  function journal(o) { var g0 = 0, n0 = 0; (o.items || []).forEach(function (it) { g0 += it.gross; n0 += it.net; }); return { name: 'journal-' + o.ym + '.csv', text: csv([['日付', '借方', '借方金額', '貸方', '貸方金額'], [o.payDate, '給与手当', g0, '普通預金', n0]]) }; }
  function ledger(o) { return { name: 'ledger-' + o.ym + '.csv', text: csv([['職員', '氏名', '総支給', '控除', '差引']].concat((o.items || []).map(function (it) { return [it.staff_id, it.name, it.gross, it.deduct, it.net]; }))) }; }
  function list(o) { return { name: 'list-' + o.ym + '.csv', text: csv([['職員', '氏名', '総支給', '控除', '差引']].concat((o.items || []).map(function (it) { return [it.staff_id, it.name, it.gross, it.deduct, it.net]; }))) }; }

  g.PayrollCalc = { VERSION: CALC_VER, STUB: true, computeItem: computeItem, payDate: payDate };
  g.PayrollExport = { STUB: true, zengin: zengin, journal: journal, ledger: ledger, list: list };
})(typeof window !== 'undefined' ? window : globalThis);
