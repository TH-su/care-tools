/* kintai-list.js — 勤怠の管理画面（kintai.html）の「勤怠一覧」「シフト表」のタブ（2026-11-28 本人指示・人事労務ソフトの勤怠一覧・シフト表の並び）
 *
 * ・数え方は持たない。月の集計は kintai.js が月の一覧と同じ数え方で作った month を受け取り、並べるだけ。
 * ・シフト表は勤怠に取り込んだ予定を見るだけ（予定を直すのはシフト作成の画面・この画面からは保存しない）。
 * ・この部品が読み込めない時は、タブのボタンを足さない＝今の画面のまま（kintai.js は window.KintaiList が無ければ何もしない）。
 * ・探す文字・件数・ページ・絞り込みは画面のメモリだけ（端末に残さない・月分を変えたら戻す）。職員の名前は描くだけ。
 * ★純関数（rowOf・shiftCell・pageOf）は check/unit/kintai_list_test.js で確かめる。
 */
(function () {
  'use strict';
  var TABS = [['list', '勤怠一覧'], ['shift', 'シフト表']];
  var SIZES = [50, 100, 0];
  var EMP_JA = { regular: '正社員', contract: '契約社員', part: 'パート', officer: '役員兼使用人', temp: '臨時' };   /* kintai.js の職員マスタの表と同じ呼び名 */
  function empJa(v) { return v ? EMP_JA[v] || String(v) : '—'; }
  var st = { q: '', of: '', size: 50, page: 0, ym: null };

  function pageOf(n, size, page) {
    n = Math.max(0, n | 0);
    var pages = size > 0 ? Math.max(1, Math.ceil(n / size)) : 1, p = Math.min(Math.max(0, page | 0), pages - 1);
    var from = n ? (size > 0 ? p * size : 0) : 0, to = size > 0 ? Math.min(n, from + size) : n;
    return { page: p, pages: pages, start: from, end: to, label: (n ? from + 1 : 0) + ' - ' + to + ' / ' + n };
  }
  /* 1人の月の集計から一覧の数字を作る。法定内 = 所定内の実働 + 所定を超えた法定内（月の一覧の4つの和の決まり） */
  function rowOf(sum) {
    var s = sum || {}, n = function (k) { var v = Number(s[k]); return isFinite(v) ? v : 0; };
    return { workDays: n('workDays'), workMin: n('workMin'), inMin: n('schedInMin') + n('legalInOverMin'), overMin: n('legalOverMin'), holMin: n('holidayMin'),
      nightMin: n('nightMin'), absentDays: n('absentDays'), lateEarlyMin: n('lateMin') + n('earlyLeaveMin'), paidDays: n('paidDays'), schedDays: n('schedDays'), review: n('reviewCount') };
  }
  /* シフト表の1日の升: 予定の時刻（複数は「・」でつなぐ）・有休・所定休日。hm は時刻の文字にする関数 */
  function shiftCell(day, hm) {
    var bl = day && Array.isArray(day.blocks) ? day.blocks.filter(function (b) { return b && b.schedStart != null; }) : [];
    if (bl.length) return { kind: 'work', text: bl.map(function (b) { return hm(b.schedStart) + '-' + hm(b.schedEnd); }).join('・'), min: bl.reduce(function (a, b) { return a + (Number(b.schedWork) || 0); }, 0) };
    if (day && day.paidMin) return { kind: 'paid', text: '有休', min: 0 };
    return { kind: 'off', text: '所定休日', min: 0 };
  }

  function syncTabs(cur) {
    var nav = document.querySelector('.tabs'); if (!nav) return;
    TABS.forEach(function (x) {
      var b = nav.querySelector('button[data-tab="' + x[0] + '"]');
      if (!b) {
        b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-tab', x[0]); b.textContent = x[1];
        var after = nav.querySelector('button[data-tab="person"]');
        nav.insertBefore(b, after || null);
      }
      b.setAttribute('aria-selected', x[0] === cur ? 'true' : 'false');
    });
  }
  function isTab(t) { return t === 'list' || t === 'shift'; }

  function people(c) {
    var q = String(st.q || '').replace(/[\s　]+/g, '').toLowerCase();
    return c.month.people.filter(function (p) {
      if (st.of && !(p.staff.office === st.of || (p.sum.byOffice && p.sum.byOffice[st.of] > 0))) return false;
      if (q && (c.dispName(p.staff) + String(p.staff.emp_code || '')).replace(/[\s　]+/g, '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function toolHtml(c, n, pg, right) {
    var e = c.esc, ofs = {};
    c.month.people.forEach(function (p) { if (p.staff.office) ofs[p.staff.office] = c.officeName(p.staff.office) || p.staff.office; });
    return '<div class="pl-tool no-print"><label><span class="sr-only">事業所で絞る</span><select id="kl-of" aria-label="事業所で絞る"><option value="">事業所：すべて</option>' + Object.keys(ofs).sort().map(function (k) { return '<option value="' + e(k) + '"' + (k === st.of ? ' selected' : '') + '>' + e(ofs[k]) + '</option>'; }).join('') + '</select></label>' +
      '<input type="search" id="kl-q" class="pl-q" placeholder="氏名など" aria-label="氏名・従業員番号で探す" value="' + e(st.q) + '" autocomplete="off">' +
      '<label><span class="sr-only">表示する件数</span><select id="kl-size" aria-label="表示する件数">' + SIZES.map(function (s) { return '<option value="' + s + '"' + (s === st.size ? ' selected' : '') + '>' + (s ? s + '件' : '全件') + '</option>'; }).join('') + '</select></label>' +
      '<span class="pl-cnt">' + e(pg.label) + '</span>' + (pg.pages > 1 ? '<button type="button" class="btn sm" data-act="kl-pv"' + (pg.page ? '' : ' disabled') + ' aria-label="前のページ">‹</button><button type="button" class="btn sm" data-act="kl-nx"' + (pg.page < pg.pages - 1 ? '' : ' disabled') + ' aria-label="次のページ">›</button>' : '') +
      '<span class="pl-sp"></span>' + right + '</div>';
  }
  function headHtml(c, title) {
    var e = c.esc, per = c.period(), pay = c.payDate ? c.payDate() : null;
    return '<div class="pl-ttl kl-hd"><h2 class="sr-only">' + e(title) + '</h2><p class="pl-meta">' + (pay ? '<span>▤ ' + e(c.jd(pay)) + '払い</span>' : '') + (per ? '<span>▦ ' + e(c.jd(per.from) + '〜' + c.jd(per.to)) + '勤務分</span>' : '') +
      (c.locked ? '<span class="tag ok">✓ 締め済み</span>' : '<span class="tag">まだ締めていません</span>') + '</p></div>';
  }
  function listHtml(c) {
    var e = c.esc, fm = c.fm, all = people(c), pg = pageOf(all.length, st.size, st.page); st.page = pg.page;
    var h = c.printHead('勤怠一覧') + '<div class="cd kl">' + headHtml(c, '勤怠一覧') +
      toolHtml(c, all.length, pg, '<button type="button" class="btn" data-tab="close">勤怠データの取込・締め</button>');
    h += '<div class="tw"><table class="kl-t"><thead><tr><th class="nm">氏名</th><th>従業員番号</th><th>入社日</th><th>部門</th><th>雇用形態</th><th class="num">労働日数</th><th class="num">総勤務</th><th class="num">法定内</th><th class="num">時間外</th><th class="num">法定休日</th><th class="num">深夜</th><th class="num">欠勤日数</th><th class="num">遅刻早退</th></tr></thead><tbody>';
    if (!all.length) h += '<tr><td class="empty" colspan="13">該当する職員はいません</td></tr>';
    all.slice(pg.start, pg.end).forEach(function (p) {
      var r = rowOf(p.sum), m = c.masterOf(p.staff) || {};
      h += '<tr><td class="nm"><button type="button" class="kl-nm" data-act="person" data-sid="' + e(p.staff.staff_id) + '">' + e(c.dispName(p.staff)) + '</button>' + (r.review ? '<span class="tag rv">要確認 ' + e(r.review) + '</span>' : '') + '</td>' +
        '<td>' + e(p.staff.emp_code || '—') + '</td><td>' + e(m.hire_date ? String(m.hire_date).slice(0, 10).replace(/-/g, '/') : '—') + '</td><td>' + e(c.officeName(p.staff.office) || '—') + '</td><td>' + e(empJa(m.employment_type)) + '</td>' +
        '<td class="num">' + e(r.workDays) + ' 日</td><td class="num">' + e(fm(r.workMin)) + '</td><td class="num">' + e(fm(r.inMin)) + '</td><td class="num">' + e(fm(r.overMin)) + '</td><td class="num">' + e(fm(r.holMin)) + '</td><td class="num">' + e(fm(r.nightMin)) + '</td><td class="num">' + e(r.absentDays) + ' 日</td><td class="num">' + e(fm(r.lateEarlyMin)) + '</td></tr>';
    });
    return h + '</tbody></table></div><p class="help no-print">氏名を押すと、その人の月（日ごとの打刻と直し）を開きます。数え方は「月の一覧」と同じです。</p></div>';
  }
  function shiftHtml(c) {
    var e = c.esc, fm = c.fm, all = people(c), pg = pageOf(all.length, st.size, st.page), ds = c.dateList(); st.page = pg.page;
    var cnt = {}; ds.forEach(function (d) { cnt[d] = 0; });
    all.forEach(function (p) { var by = {}; p.days.forEach(function (d) { by[d.date] = d; }); ds.forEach(function (x) { if (shiftCell(by[x], c.hm).kind === 'work') cnt[x]++; }); });   /* 出勤者数は表示中のページでなく、絞った全員で数える（反証レビュー 2026-11-28） */
    var body = all.slice(pg.start, pg.end).map(function (p) {
      var by = {}, m = c.masterOf(p.staff) || {}, tot = 0, wdN = 0, offN = 0, paid = 0;
      p.days.forEach(function (d) { by[d.date] = d; });
      var cells = ds.map(function (x) {
        var sc = shiftCell(by[x], c.hm);
        if (sc.kind === 'work') { tot += sc.min; wdN++; } else if (sc.kind === 'paid') paid++; else offN++;
        /* 升を押すと勤怠の「出勤予定を直す・入れる」の窓（手直しの記録・0111）をその人・その日で開く（2026-11-28） */
        return '<td class="kl-s ' + sc.kind + '"><button type="button" class="kl-sb" data-act="sched-cell" data-sid="' + e(p.staff.staff_id) + '" data-date="' + e(x) + '" aria-label="' + e(c.dispName(p.staff) + ' さんの ' + (+x.slice(5, 7)) + '月' + (+x.slice(8)) + '日の予定を直す') + '">' + e(sc.text) + '</button></td>';
      }).join('');
      var lv = c.leaveRemain(p.staff);
      return '<tr><th class="nm kl-sticky" scope="row"><button type="button" class="kl-nm" data-act="person" data-sid="' + e(p.staff.staff_id) + '">' + e(c.dispName(p.staff)) + '</button><span class="kl-code">' + e(p.staff.emp_code || '') + '</span></th>' +
        '<td class="num">' + e(fm(tot)) + '</td><td class="num">' + e(wdN) + '</td><td class="num">' + e(offN) + '</td><td class="num">' + e(lv == null ? '—' : lv) + '</td><td class="num">' + e(paid) + '日</td>' +
        '<td>' + e(c.officeName(p.staff.office) || '—') + '</td><td>' + e(empJa(m.employment_type)) + '</td>' + cells + '</tr>';
    }).join('');
    var h = c.printHead('シフト表') + '<div class="cd kl">' + headHtml(c, 'シフト表') +
      toolHtml(c, all.length, pg, '<button type="button" class="btn" data-act="kl-csv">出力（CSV）</button>') +
      '<p class="help no-print">シフト作成の画面で決めた予定を、勤怠に取り込んだまま見せます。升を押すと、その日の出勤予定を直す窓が開きます（直しはシフトの取り込み直しで消えない別の記録に残り、シフト作成の画面は変えません）。シフトそのものを変えた時は「月の一覧」の「シフトを取り込み直す」を押してください。</p>';
    h += '<div class="tw kl-sw"><table class="kl-t kl-shift"><thead><tr><th class="nm kl-sticky">氏名</th><th class="num">出勤時間</th><th class="num">出勤日数</th><th class="num">休日日数</th><th class="num">有休残数</th><th class="num">有休取得数</th><th>部門</th><th>雇用形態</th>' +
      ds.map(function (x) { var w = c.wd(x); return '<th class="kl-d' + (w === '日' ? ' sun' : w === '土' ? ' sat' : '') + '">' + e(w) + '<br>' + e((+x.slice(5, 7)) + '/' + (+x.slice(8))) + '</th>'; }).join('') + '</tr>' +
      '<tr class="kl-cnt"><th class="nm kl-sticky">出勤者数</th><td colspan="7"></td>' + ds.map(function (x) { return '<td class="num">' + e(cnt[x]) + '</td>'; }).join('') + '</tr></thead><tbody>' +
      (body || '<tr><td class="empty" colspan="40">該当する職員はいません</td></tr>') + '</tbody></table></div></div>';
    return h;
  }
  function paint(t, c) {
    if (st.ym !== c.ym) st = { q: '', of: '', size: 50, page: 0, ym: c.ym };
    if (!c.month) return '<p class="empty">読み込んでいます…</p>';
    return t === 'shift' ? shiftHtml(c) : listHtml(c);
  }
  /* シフト表の CSV（画面に出した列そのまま・この端末のダウンロードへ） */
  function csv(c) {
    var ds = c.dateList(), q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['氏名', '従業員番号', '部門'].concat(ds).map(q).join(',')];
    people(c).forEach(function (p) {
      var by = {}; p.days.forEach(function (d) { by[d.date] = d; });
      lines.push([c.dispName(p.staff), p.staff.emp_code || '', c.officeName(p.staff.office) || ''].concat(ds.map(function (x) { return shiftCell(by[x], c.hm).text; })).map(q).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = 'shift_' + c.ym + '.csv'; document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
  }
  var bound = false;
  function bind(getCtx, repaint) {
    if (bound) return; bound = true;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-act^="kl-"]') : null;
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-act');
      if (a === 'kl-pv') st.page--; else if (a === 'kl-nx') st.page++; else if (a === 'kl-csv') { var c = getCtx(); if (c && c.month) csv(c); return; } else return;
      repaint();
      var nb = document.querySelector('button[data-act="' + a + '"]:not([disabled])') || document.querySelector('button[data-act="kl-pv"],button[data-act="kl-nx"]');
      if (nb) nb.focus();
    });
    var tq = null;
    function onQ(el) {
      var v = String(el.value || '').slice(0, 40);
      st.q = v; st.page = 0; clearTimeout(tq);
      tq = setTimeout(function () {
        var cur = document.getElementById('kl-q'); if (!cur || cur.value !== v) return;
        var ss = cur.selectionStart, se = cur.selectionEnd;
        repaint();
        var q = document.getElementById('kl-q'); if (q) { q.focus(); try { q.setSelectionRange(ss, se); } catch (_) {} }
      }, 250);
    }
    document.addEventListener('input', function (e) { var el = e.target; if (!el || el.id !== 'kl-q' || e.isComposing) return; onQ(el); });
    document.addEventListener('compositionend', function (e) { var el = e.target; if (el && el.id === 'kl-q') onQ(el); });
    document.addEventListener('change', function (e) {
      var el = e.target; if (!el) return;
      if (el.id === 'kl-of') st.of = el.value; else if (el.id === 'kl-size') st.size = SIZES.indexOf(+el.value) >= 0 ? +el.value : 50; else return;
      st.page = 0; repaint();
    });
  }
  window.KintaiList = { syncTabs: syncTabs, isTab: isTab, paint: paint, bind: bind, rowOf: rowOf, shiftCell: shiftCell, pageOf: pageOf };
})();
