/* payroll-list.js — 給与の「今月の給与」の一覧を、人事労務ソフトの「給与明細一覧」の並びにそろえる部品（2026-11-28 本人指示）
 *
 * ・見せ方だけを受け持つ。計算・保存・確定・書き出しの動きは payroll.js のまま（ここのボタンは payroll.js の今ある操作（data-act・data-tab）を押すだけ）。
 * ・この部品が読み込めない時は、payroll.js は今の一覧のまま描く（window.PayrollList が無ければ何もしない）。
 * ・絞り込み・探す文字・件数・ページ・合計金額の開け閉めは、この画面のメモリだけに持つ（端末に残さない・月分を変えたら戻す）。
 * ・金額・氏名は描くだけで、端末に残さない・console に出さない。10分で金額を捨てるのは payroll.js の覆い（masked）がこの一覧ごと隠す。
 * ★純関数（filterRows・pageOf・dueDate・diffText・taxSums）は check/unit/payroll_list_test.js で確かめる。
 */
(function () {
  'use strict';
  var PAY_TYPE = { monthly: '月給', hourly: '時給', daily: '日給', board: '役員報酬' };
  var SIZES = [50, 100, 0];   /* 0 = 全件 */
  var st = { q: '', f: false, pt: '', of: '', size: 50, page: 0, sum: false, rep: false, ym: null }, bq = '';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function yen(v) { return Math.round(num(v)).toLocaleString('ja-JP'); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function isDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }
  function jd(d) { return isDate(d) ? d.slice(0, 4) + '年' + (+d.slice(5, 7)) + '月' + (+d.slice(8)) + '日' : ''; }

  /* 前月比の文字: 0 は「±0」、増えた時は「+」、前月が無い時は空 */
  function diffText(d) { if (d == null || !isFinite(d)) return ''; d = Math.round(d); return d === 0 ? '±0' : (d > 0 ? '+' : '-') + Math.abs(d).toLocaleString('ja-JP'); }
  /* 納める期限: 支給日の翌月10日（納期の特例は見ない・仮置き） */
  function dueDate(pay) {
    if (!isDate(pay)) return null;
    var y = +pay.slice(0, 4), m = +pay.slice(5, 7) + 1; if (m > 12) { m = 1; y++; }
    return y + '-' + (m < 10 ? '0' : '') + m + '-10';
  }
  /* 住民税・所得税の合計（控除の行の code で数える）。所得税は精算の行も足す */
  function taxSums(list) {
    var o = { resident: 0, residentN: 0, income: 0, incomeN: 0, gross: 0, n: 0 };
    arr(list).forEach(function (it) {
      var r = 0, t = 0;
      arr(it && it.lines).forEach(function (l) {
        if (!l || l.sec !== 'deduct') return;
        if (l.code === 'resident_tax') r += num(l.amount);
        else if (l.code === 'income_tax' || l.code === 'tax_adjust') t += num(l.amount);
      });
      o.resident += r; if (r) o.residentN++;
      o.income += t; if (t) o.incomeN++;
      o.gross += num(it && it.gross); o.n++;
    });
    return o;
  }
  /* 絞り込み: 探す文字は氏名・従業員番号の一部（空白は無視）、給与形態・事業所・警告だけ */
  function filterRows(rows, f) {
    f = f || {};
    var q = String(f.q || '').replace(/[\s　]+/g, '').toLowerCase();
    return arr(rows).filter(function (r) {
      if (f.warnOnly && !r.warn) return false;
      if (f.pt && r.pt !== f.pt) return false;
      if (f.of && r.of !== f.of) return false;
      if (q) { var s = (String(r.name || '') + String(r.code || '')).replace(/[\s　]+/g, '').toLowerCase(); if (s.indexOf(q) < 0) return false; }
      return true;
    });
  }
  /* ページ: size 0 は全件。page は範囲に収める。from・to は 1 から数えた番号（件数0なら 0） */
  function pageOf(n, size, page) {
    n = Math.max(0, n | 0);
    var pages = size > 0 ? Math.max(1, Math.ceil(n / size)) : 1;
    var p = Math.min(Math.max(0, page | 0), pages - 1);
    var from = n ? (size > 0 ? p * size : 0) : 0, to = size > 0 ? Math.min(n, from + size) : n;
    return { page: p, pages: pages, start: from, end: to, label: (n ? from + 1 : 0) + ' - ' + to + ' / ' + n };
  }

  /* ── 描く ── */
  function rowsOf(c) {
    return arr(c.list).map(function (it) {
      var s = c.staffOf(it.staff_id) || {}, p = c.profOf(it.staff_id), pv = c.prevOf(it.staff_id);
      var pt = p && p.data ? String(p.data.pay_type || '') : '';
      return { it: it, sid: it.staff_id, name: it.name, code: s.emp_code || '', of: s.office || '', ofName: s.office ? (c.officeName(s.office) || s.office) : '',
        pt: PAY_TYPE[pt] ? pt : '', ptName: PAY_TYPE[pt] || '', warn: arr(it.warnings).length,
        dNet: pv ? num(it.net) - pv.net : null, dGross: pv ? num(it.gross) - pv.gross : null, dDed: pv ? num(it.deduct) - (pv.gross - pv.net) : null,
        adj: arr(it.adjustments).length };
    });
  }
  function dspan(d) {
    var t = diffText(d);
    return t ? ' <span class="pl-d' + (d < 0 ? ' neg' : '') + '">(' + esc(t) + ')</span>' : '';
  }
  function headHtml(c) {
    var pay = c.payDate(), per = c.period(), h = '<div class="pl-ttl pl-hd"><h2>' + esc(isDate(pay) ? (+pay.slice(5, 7)) + '月' + (+pay.slice(8)) + '日支払い分の給与明細' : c.periodText()) + '</h2>';
    h += '<p class="pl-meta"><span>' + esc(c.periodText()) + '</span>' + (per ? '<span><small>賃金計算期間</small> ' + esc(jd(per.from) + '〜' + jd(per.to)) + '</span>' : '') + '<span><small>計算開始</small> 手動</span></p></div>';
    return h;
  }
  /* 確定の後だけ: 書き出しの案内と「確定後の手続き」 */
  function afterHtml(c) {
    if (!c.frozen) return '';
    var x = c.canExport, ts = taxSums(c.list), due = dueDate(c.payDate());
    var h = '<div class="pl-info" role="note"><span class="pl-i" aria-hidden="true">i</span><span>賃金台帳（<button type="button" class="pl-lk" data-act="exp" data-k="ledger"' + (x ? '' : ' disabled') + '>CSV</button>）と給与明細一覧表（<button type="button" class="pl-lk" data-act="exp" data-k="list"' + (x ? '' : ' disabled') + '>CSV</button>）がダウンロードできます。全員分の明細の印刷は「<button type="button" class="pl-lk" data-tab="slip">給与明細</button>」からできます。</span></div>';
    h += '<h3 class="pl-sub">確定後の手続き</h3><div class="pl-proc">';
    h += '<button type="button" class="pl-card" data-tab="export"><span class="pl-ci" aria-hidden="true">🏛</span><b>給与の振込</b><span class="pl-cd">振込データ・総額の照合・仕訳の CSV を書き出します。</span><span class="pl-go" aria-hidden="true">›</span></button>';
    h += '<details class="pl-card"><summary><span class="pl-ci" aria-hidden="true">▣</span><b>住民税の振込</b><span class="pl-cd">従業員から徴収した住民税額を確かめます。</span>' + (due ? '<span class="pl-due">' + esc((+due.slice(5, 7)) + '月' + (+due.slice(8)) + '日まで') + '</span>' : '') + '<span class="pl-go" aria-hidden="true">›</span></summary>' +
      '<div class="pl-cb"><table><tbody><tr><th>住民税を引いた人</th><td class="num">' + esc(ts.residentN) + ' 人</td></tr><tr><th>住民税の合計</th><td class="num">' + esc(yen(ts.resident)) + ' 円</td></tr></tbody></table><p class="help">市町村ごとの内訳と振込の依頼のファイルは、この画面にはまだありません。</p></div></details>';
    h += '<details class="pl-card"><summary><span class="pl-ci" aria-hidden="true">▤</span><b>所得税徴収高計算書</b><span class="pl-cd">従業員から徴収した所得税額を確かめて納付します。</span>' + (due ? '<span class="pl-due">' + esc((+due.slice(5, 7)) + '月' + (+due.slice(8)) + '日まで') + '</span>' : '') + '<span class="pl-go" aria-hidden="true">›</span></summary>' +
      '<div class="pl-cb"><table><tbody><tr><th>支給年月日</th><td>' + esc(jd(c.payDate())) + '</td></tr><tr><th>人員</th><td class="num">' + esc(ts.n) + ' 人</td></tr><tr><th>支給額（総支給の合計）</th><td class="num">' + esc(yen(ts.gross)) + ' 円</td></tr><tr><th>税額（所得税と精算）</th><td class="num">' + esc(yen(ts.income)) + ' 円</td></tr></tbody></table>' +
      '<p class="help">納付の期限は支給日の翌月10日で見ています（納期の特例の時は違います）。</p></div></details>';
    return h + '</div>';
  }
  function toolHtml(c, rows, pg) {
    var ofs = {}, pts = {};
    rows.forEach(function (r) { if (r.of) ofs[r.of] = r.ofName; if (r.pt) pts[r.pt] = r.ptName; });
    var opt = function (o, cur, all) { return '<option value="">' + all + '</option>' + Object.keys(o).sort().map(function (k) { return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(o[k]) + '</option>'; }).join(''); };
    var nf = (st.pt ? 1 : 0) + (st.of ? 1 : 0);
    var h = '<div class="pl-tool"><button type="button" class="btn" data-act="pl-f" aria-expanded="' + (st.f ? 'true' : 'false') + '"><span aria-hidden="true">☰</span> フィルタ' + (nf ? '（' + nf + '）' : '') + '</button>' +
      '<input type="search" id="pl-q" class="pl-q" placeholder="氏名など" aria-label="氏名・従業員番号で探す" value="' + esc(st.q) + '" autocomplete="off">' +
      '<label class="pl-sz"><span class="sr-only">表示する件数</span><select id="pl-size">' + SIZES.map(function (s) { return '<option value="' + s + '"' + (s === st.size ? ' selected' : '') + '>' + (s ? s + '件' : '全件') + '</option>'; }).join('') + '</select></label>' +
      '<span class="pl-cnt">' + esc(pg.label) + '</span>' + (pg.pages > 1 ? '<button type="button" class="btn sm" data-act="pl-pv"' + (pg.page ? '' : ' disabled') + ' aria-label="前のページ">‹</button><button type="button" class="btn sm" data-act="pl-nx"' + (pg.page < pg.pages - 1 ? '' : ' disabled') + ' aria-label="次のページ">›</button>' : '') +
      c.warnFilterHtml +
      '<span class="pl-sp"></span>' +
      '<button type="button" class="btn pl-tx" data-act="pl-rep" aria-expanded="' + (st.rep ? 'true' : 'false') + '">前月比更新レポート ›</button>' +
      '<button type="button" class="btn" data-act="exp" data-k="list"' + (c.frozen && c.canExport ? '' : ' disabled title="確定した月だけ書き出せます"') + '>給与明細一覧表の出力</button>' +
      '<button type="button" class="btn" data-tab="slip"><span aria-hidden="true">🖨</span> 印刷用ダウンロード</button></div>';
    if (st.f) h += '<div class="pl-fp"><label>給与形態 <select id="pl-pt">' + opt(pts, st.pt, 'すべて') + '</select></label><label>事業所 <select id="pl-of">' + opt(ofs, st.of, 'すべて') + '</select></label>' + (nf ? '<button type="button" class="btn sm" data-act="pl-fx">絞り込みを外す</button>' : '') + '</div>';
    return h;
  }
  function repHtml(rows) {
    var ch = rows.filter(function (r) { return r.dNet != null && (r.dNet || r.dGross || r.dDed); });
    var nw = rows.filter(function (r) { return r.dNet == null; });
    var h = '<div class="pl-rep" role="region" aria-label="前月比更新レポート"><h3 class="pl-sub">前月比更新レポート（前月の確定した明細と比べて変わった人）</h3>';
    if (!ch.length && !nw.length) return h + '<p class="help">前月と同じ金額です。</p></div>';
    if (ch.length) h += '<div class="tw"><table><thead><tr><th>氏名</th><th class="num">差引支給額</th><th class="num">総支給額</th><th class="num">総控除額</th></tr></thead><tbody>' +
      ch.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td class="num">' + esc(diffText(r.dNet)) + '</td><td class="num">' + esc(diffText(r.dGross)) + '</td><td class="num">' + esc(diffText(r.dDed)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    if (nw.length) h += '<p class="help">前月の確定した明細が無い人: ' + esc(nw.map(function (r) { return r.name; }).join('、')) + '</p>';
    return h + '</div>';
  }
  function stTag(c, r) {
    var t = c.frozen ? '<span class="tag pl-st ok">確定済み</span>' : c.status === 'draft' && !c.dirty ? '<span class="tag pl-st">保存済み</span>' : '<span class="tag pl-st">計算完了</span>';
    if (r.adj) t += '<span class="tag pl-st warn">調整あり</span>';
    return t;
  }
  /* 一覧: payroll.js の details.it の形（開くと内訳と調整）を保ち、列を足す。足した列は PC だけ（899px 以下は今の並び） */
  function listHtml(c) {
    if (st.ym !== c.ym) { st = { q: '', f: false, pt: '', of: '', size: 50, page: 0, sum: false, rep: false, ym: c.ym }; }
    var all = rowsOf(c);
    var rows = filterRows(all, { q: st.q, pt: st.pt, of: st.of, warnOnly: c.warnOnly });
    var pg = pageOf(rows.length, st.size, st.page); st.page = pg.page;
    var calcAt = c.frozen ? c.at(c.run && c.run.confirmed_at) : (c.status === 'draft' && !c.dirty ? c.at(c.run && c.run.saved_at) : '');
    var h = '<details class="pl-sum"' + (st.sum ? ' open' : '') + '><summary>合計金額</summary>' + c.sumHtml + '</details>';
    h += '<div class="cd pl-list">' + toolHtml(c, all, pg) + (st.rep ? repHtml(all) : '');
    h += '<div class="ihd pl-g" aria-hidden="true"><span>氏名</span><span class="pl-pc">従業員番号</span><span class="pl-pc">事業所</span><span class="pl-pc">給与形態</span><span>総支給額（前月比）</span><span>総控除額（前月比）</span><span>差引支給額（前月比）</span><span>前月差</span><span class="pl-pc">最終計算日時</span><span>ステータス</span></div>';
    if (!rows.length) h += '<p class="empty">該当する職員はいません。</p>';
    rows.slice(pg.start, pg.end).forEach(function (r) {
      var it = r.it, w = r.warn;
      h += '<details class="it pl-g" data-sid="' + esc(r.sid) + '"' + (c.openSid === r.sid ? ' open' : '') + '><summary><span class="nm">' + esc(it.name) + '</span>' +
        '<span class="pl-pc pl-code">' + esc(r.code || '—') + '</span><span class="pl-pc pl-of">' + esc(r.ofName || '—') + '</span><span class="pl-pc pl-pt">' + esc(r.ptName || '—') + '</span>' +
        '<span class="num" aria-label="総支給" data-l="総支給">' + esc(yen(it.gross)) + '<span class="pl-pc">' + dspan(r.dGross) + '</span></span>' +
        '<span class="num" aria-label="控除" data-l="控除">' + esc(yen(it.deduct)) + '<span class="pl-pc">' + dspan(r.dDed) + '</span></span>' +
        '<span class="num" aria-label="差引" data-l="差引"><b>' + esc(yen(it.net)) + '</b><span class="pl-pc">' + dspan(r.dNet) + '</span></span>' +
        '<span class="num pl-ph" aria-label="前月差" data-l="前月差">' + esc(r.dNet == null ? '—' : (r.dNet > 0 ? '+' : '') + yen(r.dNet)) + '</span>' +
        '<span class="pl-pc pl-at">' + esc(calcAt || '未保存') + '</span>' +
        (w ? '<span class="tag warn">⚠ 警告 ' + esc(w) + '</span>' : '<span class="tag ok">✓</span>') + '<span class="pl-pc pl-stw">' + stTag(c, r) + '</span></summary>';
      if (c.openSid === r.sid) h += c.itemBody(it);
      h += '</details>';
    });
    return h + '</div>';
  }

  /* 操作の受け口（1回だけ付ける）。repaint は payroll.js の paint（今月の給与のタブの時だけ描き直す） */
  var bound = false;
  function bind(repaint) {
    if (bound || typeof repaint !== 'function') return;
    bound = true;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-act^="pl-"]') : null;
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-act');
      if (a === 'pl-f') st.f = !st.f;
      else if (a === 'pl-fx') { st.pt = ''; st.of = ''; st.page = 0; }
      else if (a === 'pl-rep') st.rep = !st.rep;
      else if (a === 'pl-pv') st.page--;
      else if (a === 'pl-nx') st.page++;
      else return;
      repaint();
    });
    document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('pl-sum')) st.sum = !!d.open; }, true);
    document.addEventListener('input', function (e) {
      var el = e.target; if (!el || (el.id !== 'pl-q' && el.id !== 'pl-bq')) return;
      var v = String(el.value || '').slice(0, 40), id = el.id;
      if (id === 'pl-bq') bq = v; else { st.q = v; st.page = 0; }
      repaint();
      var q = document.getElementById(id); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (_) {} }
    });
    document.addEventListener('change', function (e) {
      var el = e.target; if (!el || !el.id) return;
      if (el.id === 'pl-pt') st.pt = el.value;
      else if (el.id === 'pl-of') st.of = el.value;
      else if (el.id === 'pl-size') st.size = SIZES.indexOf(+el.value) >= 0 ? +el.value : 50;
      else return;
      st.page = 0; repaint();
    });
  }

  /* 賞与の入れる表の上の段: 探す欄と件数（画面のメモリだけ） */
  function bonusTool(all, shown) {
    return '<div class="pl-tool"><input type="search" id="pl-bq" class="pl-q" placeholder="氏名など" aria-label="氏名・従業員番号で探す" value="' + esc(bq) + '" autocomplete="off"><span class="pl-cnt">' + esc((shown ? 1 : 0) + ' - ' + shown + ' / ' + all) + '</span></div>';
  }
  function bonusQuery() { return bq; }

  window.PayrollList = { bonusTool: bonusTool, bonusQuery: bonusQuery, listHtml: listHtml, headHtml: headHtml, afterHtml: afterHtml, bind: bind,
    filterRows: filterRows, pageOf: pageOf, dueDate: dueDate, diffText: diffText, taxSums: taxSums };
})();
