/* kintai-self-slip.js — 自分の勤怠（kintai-self.html）の「給与明細」のタブ（2026-11-28・代表者の決定 2026-11-28「推奨どおり」・care-backend 統合 0145）
 *   本人の確定済みの給与明細だけを、端末の鍵と暗証番号（統合 0114 と同じ）で見る。受け口の op は payslips（一覧）と payslip（1枚）
 *   ・受け口が返すのは支給・控除・勤怠の行（区分・名前・数・額）と合計だけ。口座・会社が払う保険料・内部の理由文と注意の文・設定は返さない（データベースが落とす）
 *   ・中身（一覧・明細）はメモリだけで、閉じる・2分さわらない・登録を外す時に kintai-self.js の lock から reset で捨てる。端末に何も残さない
 *   ・画面に入れる文は全部 textContent（HTML の代入を使わない）。console を使わない
 *   ・古い受け口（op を知らず形の違いで断る）の時は「まだ使えません」と出す
 *   純関数（listRows・slipView・errText）は check/unit/kintai_self_slip_test.js で確かめる。文と位置は仮置き
 */
(function (root) {
  'use strict';
  function isYm(v) { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }
  function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }
  function yen(v) { var n = num(v); if (n === null) return '—'; return (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ja-JP') + ' 円'; }
  function ymJa(ym) { return isYm(ym) ? ym.slice(0, 4) + '年' + (+ym.slice(5, 7)) + '月分' : ''; }
  function dJa(d) { return isDate(d) ? d.slice(0, 4) + '年' + (+d.slice(5, 7)) + '月' + (+d.slice(8, 10)) + '日' : ''; }
  function md(d) { return isDate(d) ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  /* 勤怠の行の数: 分の物は「時間:分」、日・回はそのまま */
  var MIN_CODES = { workMin: 1, overtimeMin: 1, legalOverMin: 1, nightMin: 1, holidayMin: 1, lateMin: 1, earlyLeaveMin: 1, schedInMin: 1, legalInOverMin: 1, hourlyPaidOffMin: 1 };
  function qtyText(code, q) {
    var n = num(q); if (n === null) return '';
    if (MIN_CODES[code] || /Min$/.test(String(code || ''))) { var m = Math.round(n); return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2); }
    return String(n);
  }

  /* 一覧の行（新しい順・確定済みだけが来る） */
  function listRows(months) {
    return (Array.isArray(months) ? months : []).filter(function (m) { return m && isYm(m.ym); })
      .sort(function (a, b) { return a.ym < b.ym ? 1 : -1; })
      .map(function (m) { return { ym: m.ym, title: ymJa(m.ym), pay: isDate(m.pay_date) ? dJa(m.pay_date) + ' 支給' : '', net: yen(m.net) }; });
  }
  /* 1枚の明細の表示の形 */
  function slipView(s) {
    s = s && typeof s === 'object' ? s : {};
    var lines = Array.isArray(s.lines) ? s.lines : [], per = s.period && typeof s.period === 'object' ? s.period : {};
    function sec(k) {
      return lines.filter(function (l) { return l && l.sec === k && typeof l.name === 'string'; }).map(function (l) {
        return k === 'att' ? { name: l.name, value: qtyText(l.code, l.qty) } : { name: l.name, value: yen(l.amount) };
      }).filter(function (r) { return k !== 'att' || r.value !== ''; });
    }
    return {
      title: ymJa(s.ym) + ' 給与明細',
      sub: [isDate(s.pay_date) ? '支給日 ' + dJa(s.pay_date) : '', isDate(per.from) && isDate(per.to) ? '期間 ' + md(per.from) + '〜' + md(per.to) : ''].filter(Boolean).join('・'),
      company: typeof s.company_name === 'string' ? s.company_name : '',
      name: typeof s.name === 'string' ? s.name : '',
      pay: sec('pay'), deduct: sec('deduct'), att: sec('att'),
      totals: [['総支給額', yen(s.gross)], ['控除の合計', yen(s.deduct)], ['差引支給額', yen(s.net)]]
    };
  }
  var ERR = {
    format: '給与明細はまだ使えません（事務所の準備中です）。',
    notfound: 'この月分の明細はありません（確定を取り消したか、まだ確定していません）。',
    badym: '月分が正しくありません。',
    net: 'つながりません。電波の良い所でもう一度開いてください。',
    server: 'うまく読めませんでした。もう一度開いてください。直らない時は事務所に知らせてください。'
  };
  function errText(code) { return ERR[code] || ERR.server; }

  var api = { listRows: listRows, slipView: slipView, errText: errText, qtyText: qtyText, yen: yen };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ── 画面 ── */
  var $ = function (id) { return document.getElementById(id); };
  var callFn = null, authFn = null, gen = 0, list = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function box() { return $('slip-box'); }
  function reset() { gen++; callFn = null; authFn = null; list = null; clear(box()); }
  /* 開いた時に呼ばれる（読むのはタブを開いた時だけ） */
  function start(call, auth) { reset(); callFn = call; authFn = auth; }
  function fail(r) {
    if (authFn && authFn(r)) return true;
    var b = box(); clear(b);
    b.appendChild(el('p', 'msg ng', errText(r && r.error === 'format' ? 'format' : r && r.error)));
    return false;
  }
  async function load() {
    var b = box(); if (!b || !callFn) return;
    var my = gen;
    clear(b); b.appendChild(el('p', 'help', '読んでいます…'));
    var r = await callFn('payslips', {});
    if (my !== gen) return;
    if (!r || r.ok !== true) { fail(r); return; }
    list = listRows(r.months);
    paintList();
  }
  function paintList() {
    var b = box(); clear(b);
    b.appendChild(el('h2', null, '給与明細'));
    b.appendChild(el('p', 'help', '事務所が確定した月分の明細です（直近2年分）。開いたことは事務所の記録に残ります。'));
    if (!list || !list.length) { b.appendChild(el('p', 'empty', '見られる明細はまだありません。')); return; }
    var ul = el('ul', 'slip-list');
    list.forEach(function (x) {
      var li = el('li'), bt = el('button', 'slip-row');
      bt.type = 'button';
      bt.setAttribute('aria-label', x.title + 'の明細を開く');
      bt.appendChild(el('span', 'slip-ym', x.title));
      bt.appendChild(el('span', 'slip-pay', x.pay));
      bt.appendChild(el('b', 'slip-net', '差引 ' + x.net));
      bt.addEventListener('click', function () { openSlip(x.ym); });
      li.appendChild(bt); ul.appendChild(li);
    });
    b.appendChild(ul);
  }
  async function openSlip(ym) {
    var b = box(); if (!b || !callFn) return;
    var my = gen;
    clear(b); b.appendChild(el('p', 'help', '読んでいます…'));
    var r = await callFn('payslip', { ym: ym });
    if (my !== gen) return;
    if (!r || r.ok !== true || !r.slip) { if (!fail(r)) addBack(); return; }
    paintSlip(slipView(r.slip));
  }
  function addBack() {
    var bk = el('button', 'btn sm', '← 明細の一覧へ'); bk.type = 'button';
    bk.addEventListener('click', function () { if (list) paintList(); else load(); });
    box().appendChild(bk);
  }
  function table(title, rows) {
    var sec = el('section', 'slip-sec'); sec.appendChild(el('h3', null, title));
    if (!rows.length) { sec.appendChild(el('p', 'empty', 'なし')); return sec; }
    var dl = el('dl', 'slip-dl');
    rows.forEach(function (r) { dl.appendChild(el('dt', null, r.name)); dl.appendChild(el('dd', null, r.value)); });
    sec.appendChild(dl); return sec;
  }
  function paintSlip(v) {
    var b = box(); clear(b);
    addBack();
    b.appendChild(el('h2', null, v.title));
    if (v.sub) b.appendChild(el('p', 'help', v.sub));
    if (v.company || v.name) b.appendChild(el('p', 'slip-who', [v.company, v.name ? v.name + ' さん' : ''].filter(Boolean).join('　')));
    var tot = el('dl', 'slip-dl slip-tot');
    v.totals.forEach(function (t) { tot.appendChild(el('dt', null, t[0])); tot.appendChild(el('dd', null, t[1])); });
    b.appendChild(tot);
    b.appendChild(table('支給', v.pay));
    b.appendChild(table('控除', v.deduct));
    b.appendChild(table('勤怠', v.att));
  }
  root.KintaiSelfSlip = { start: start, reset: reset, load: load };
})(typeof window !== 'undefined' ? window : this);
