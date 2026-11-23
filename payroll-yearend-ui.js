/* payroll-yearend-ui.js — 給与の画面（payroll.html）の「年末調整」のタブ（2026-11-23 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/給与/ROOT-yearend.md の C）
 * ════════════════════════════════════════════════════════════════
 * ・payroll.js はタブの登録と呼び口だけ。描く物は html(ctx) が文字で返し（HTML を入れるのは payroll.js の put）、出来事は onClick / onChange で受ける
 * ・ctx は payroll.js が毎回作って渡す（rpc・esc・yen・bs・items・ym・paint・toast・openDlg・closeDlg・isAdmin・note・parseCsv・decode・put ほか）
 * ・計算は PayrollYearEnd.computeYearEnd、源泉徴収票は PayrollWithholdingSlip、freee の明細は PayrollFreeeSlips（どれも純関数）。無い時は止める
 * ・データベースの口は統合 0122（payroll_ytd_get・payroll_ytd_put・payroll_yearend_put・payroll_yearend_finalize・payroll_yearend_unfinalize・payroll_yearend_check）
 * ・個人情報: 申告・累計・取り込んだ CSV はこのファイルのメモリの中だけ。端末に残さない・console に出さない・ファイルを保存しない。
 *   10分で金額を隠す・鍵の画面・覆いの時は payroll.js が reset() を呼び、ここで持つ物を全部捨てる
 * ・年は端末に残さない（既定は表示中の月分の年・仮置き。端末に残してよいのは開いていたタブだけ＝CLAUDE.md の給与の決まり）
 * ・申告は紙で集め、事務所（給与を扱える人）がこの画面で入れる（本人の画面は作らない・代表者の決定 2026-11-23）。
 *   入れる欄は紙の順（扶養控除等申告書 → 基礎控除・配偶者控除等申告書 → 保険料控除申告書 → 住宅借入金等特別控除申告書 → 前職の源泉徴収票）。
 *   マイナンバーの欄は作らない（代表者の決定）
 * ★試験・見本は架空の職員と架空の金額だけ
 */
(function (root) {
  'use strict';
  var VERSION = 'yearend-ui-2026-11-23';
  var SETTLE_NAME = '年末調整の精算';
  var MAX_FILE = 2 * 1024 * 1024, PUT_CHUNK = 500;
  var S = { gen: 0, year: null, data: null, loading: null, imp: null, impErr: null, cmp: null, cmpErr: null, cmpAll: false, pick: {}, dlg: null, chk: null, chkLoading: null, nodb: false, busy: false };

  function F() { return root && root.PayrollFreeeSlips || null; }
  function YE() { var y = root && root.PayrollYearEnd; return y && typeof y.computeYearEnd === 'function' ? y : null; }
  function WS() { var w = root && root.PayrollWithholdingSlip; return w && typeof w.slipValues === 'function' ? w : null; }
  function partsOk() { return !!(F() && YE() && WS()); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function int(v) { var n = Number(v); return isFinite(n) ? Math.round(n) : 0; }
  function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function isYm(v) { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }
  function reiwa(y) { return y - 2018; }
  function ymText(v) { return isYm(v) ? v.slice(0, 4) + '年' + (+v.slice(5)) + '月分' : ''; }
  function yearOf(ctx) { return S.year || (isYm(ctx.ym) ? +ctx.ym.slice(0, 4) : new Date().getFullYear()); }
  function el(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
  function val(id) { var e = el(id); return e ? String(e.value || '').trim() : ''; }
  function on(id) { var e = el(id); return !!(e && e.checked); }
  function settleOf(year, y) { return isYm(y && y.settle_ym) ? y.settle_ym : year + '-12'; }

  /* 捨てる（10分で隠す・鍵の画面・覆い・別の年）。遅れて届いた答えは gen で捨てる */
  function reset() { S.gen++; S.data = null; S.loading = null; S.imp = null; S.impErr = null; S.cmp = null; S.cmpErr = null; S.cmpAll = false; S.pick = {}; S.dlg = null; S.chk = null; S.chkLoading = null; S.busy = false; }

  function profiles(ctx) { return arr(ctx.bs && ctx.bs.profiles); }
  function profOf(ctx, sid) { var p = profiles(ctx); for (var i = 0; i < p.length; i++) if (p[i].staff_id === sid) return p[i]; return null; }
  function nameOf(ctx, sid) { var p = profOf(ctx, sid); return p ? p.name : sid; }
  function staffList(ctx) { return profiles(ctx).map(function (p) { return { staff_id: p.staff_id, name: p.name, emp_num: obj(p.data).freee_emp_num }; }); }
  function itemOf(ctx, sid) { var l = arr(ctx.items); for (var i = 0; i < l.length; i++) if (l[i] && l[i].staff_id === sid) return l[i]; return null; }
  function rowsOf(sid) { return arr(S.data && S.data.rows).filter(function (r) { return r.staff_id === sid; }); }
  function yeOf(sid) { var l = arr(S.data && S.data.yearend); for (var i = 0; i < l.length; i++) if (l[i].staff_id === sid) return l[i]; return null; }

  /* ── 読み込み（payroll_ytd_get） ── */
  function normData(r, year) {
    return { year: year, err: null,
      rows: arr(r && r.rows).filter(function (x) { return x && typeof x.staff_id === 'string' && isDate(x.pay_date); }).map(function (x) {
        return { staff_id: x.staff_id, pay_date: x.pay_date, kind: x.kind === 'bonus' ? 'bonus' : 'salary', source: String(x.source || ''), data: obj(x.data), rev: int(x.rev), src_fp: x.src_fp || '', fp: typeof x.fp === 'string' ? x.fp : '' };
      }).sort(function (a, b) { return a.pay_date < b.pay_date ? -1 : a.pay_date > b.pay_date ? 1 : 0; }),
      yearend: arr(r && r.yearend).filter(function (x) { return x && typeof x.staff_id === 'string'; }).map(function (x) {
        return { staff_id: x.staff_id, decl: obj(x.decl), result: obj(x.result), basis: obj(x.basis), status: x.status === 'final' ? 'final' : 'draft', settle_ym: isYm(x.settle_ym) ? x.settle_ym : year + '-12', rev: int(x.rev), finalized_at: x.finalized_at || null };
      }) };
  }
  function ensure(ctx, year) {
    if ((S.data && S.data.year === year) || S.loading === year) return;
    var my = S.gen; S.loading = year;
    Promise.resolve().then(function () { return ctx.rpc('payroll_ytd_get', { p_year: year }); }).then(function (r) {
      if (my !== S.gen) return;
      S.loading = null;
      if (r && r.ok === false) { S.data = { year: year, rows: [], yearend: [], err: '読めませんでした（' + String(r.error || 'ng') + '）。' }; ctx.paint(); return; }
      S.data = normData(r, year);
      ctx.paint();
    }, function (e) {
      if (my !== S.gen) return;
      S.loading = null;
      if (ctx.noDb && ctx.noDb(e)) { S.data = { year: year, rows: [], yearend: [], err: 'データベースに年末調整の仕組みがまだありません（統合 0122 を入れた後に使えます）。', nodb: true }; ctx.paint(); return; }
      S.data = { year: year, rows: [], yearend: [], err: '読めませんでした。「読み直す」を押してください。' };
      ctx.paint();
      if (ctx.fail) ctx.fail(e, '年末調整の読み込み');
    });
  }
  function reload(ctx) { var y = yearOf(ctx); S.gen++; S.data = null; S.loading = null; S.chk = null; S.chkLoading = null; ensure(ctx, y); ctx.paint(); }

  /* ── 描く ── */
  function html(ctx) {
    var esc = ctx.esc, yen = ctx.yen, year = yearOf(ctx);
    var h = '<div class="cd"><h2>年末調整（令和' + esc(reiwa(year)) + '年分）</h2><div class="row"><label for="ye-year">年</label><select id="ye-year">';
    var y0 = isYm(ctx.ym) ? +ctx.ym.slice(0, 4) : year;
    [y0 - 1, y0].forEach(function (y) { h += '<option value="' + esc(y) + '"' + (y === year ? ' selected' : '') + '>' + esc(y) + '年（令和' + esc(reiwa(y)) + '年分）</option>'; });
    h += '</select><button type="button" class="btn" data-act="ye-reload">読み直す</button></div>';
    if (!partsOk()) return h + '<div class="band ng" role="alert">計算の部品が読み込めていません。ページを読み込み直してください。直らない時は管理者に知らせてください。</div></div>';
    h += '<p class="help">申告は紙（扶養控除等申告書・保険料控除申告書・基礎控除・配偶者控除等申告書・住宅借入金等特別控除申告書・前職の源泉徴収票）で集め、ここで入れます。申告・累計・取り込んだ CSV はこの画面の中だけにあり、端末には残しません。</p></div>';
    ensure(ctx, year);
    if (!S.data || S.data.year !== year) return h + '<div class="cd" aria-busy="true"><span class="skel w8"></span><span class="skel w6"></span></div>';
    if (S.data.err) { h += '<div class="band ' + (S.data.nodb ? 'warn' : 'ng') + '" role="alert">' + esc(S.data.err) + '</div>'; if (S.data.nodb) return h; }
    h += importHtml(ctx, year) + compareHtml(ctx) + listHtml(ctx, year) + settleHelpHtml(ctx, year) + printHtml(ctx, year);
    return h;
  }

  var YTD_LABEL = { gross: '総支給', taxable: '課税支給', nontax: '非課税支給', si_health: '健康保険料', si_care: '介護保険料', si_support: '子ども・子育て支援金', si_pension: '厚生年金保険料', si_emp: '雇用保険料', si_other: 'その他の社保', income_tax: '所得税', resident_tax: '住民税' };
  /* 分けて送った途中で断られた時の、入った行と入らなかった行（読み直した累計で確かめた物） */
  function doneHtml(ctx, d) {
    var esc = ctx.esc, line = function (x) { return '<li>' + esc(nameOf(ctx, x.staff_id) + '・' + x.pay_date + '・' + (x.kind === 'bonus' ? '賞与' : '給与')) + '</li>'; };
    return '<div class="band ng" role="alert"><b>⚠ 途中で断られました（' + esc(d.msg) + '）</b><p>累計を読み直して確かめました。入った行 ' + esc(d.entered.length) + '・入らなかった行 ' + esc(d.missed.length) + '。</p>' +
      (d.entered.length ? '<details><summary>入った行（' + esc(d.entered.length) + '）</summary><ul>' + d.entered.map(line).join('') + '</ul></details>' : '') +
      (d.missed.length ? '<p>入らなかった行</p><ul>' + d.missed.map(line).join('') + '</ul>' : '') + '入らなかった行は、直してから「累計に入れる」をもう一度押してください（下の数は入らなかった行だけ）。</div>';
  }
  function importHtml(ctx, year) {
    var esc = ctx.esc, yen = ctx.yen;
    var h = '<div class="cd"><h2>freee の明細を取り込む（1〜11月の累計）</h2><p class="help">freee から書き出した月ごとの給与・賞与の明細の CSV を選びます（いくつでも）。画面の中だけで読み、「累計に入れる」を押すまでデータベースは変わりません。ファイルはどこにも保存しません。★CSV の見出しは、事務担当が書き出した実物でまだ確かめていません（未検証）。</p>';
    h += '<div class="row"><label for="ye-kind">種類</label><select id="ye-kind"><option value="">ファイルの見出しで決める</option><option value="salary">給与</option><option value="bonus">賞与</option></select>' +
      '<label for="ye-files">CSV のファイル</label><input type="file" id="ye-files" accept=".csv,text/csv" multiple style="max-width:100%">' +
      '<button type="button" class="btn" data-act="ye-manual">＋ 累計に1回分を手で足す</button></div>';
    if (S.impErr) h += '<div class="band ng" role="alert">' + esc(S.impErr) + '</div>';
    var im = S.imp;
    if (im) {
      var by = {}, bad = 0, other = 0;
      im.rows.forEach(function (r) { if (arr(r.bad).length) bad++; if (r.pay_date && +r.pay_date.slice(0, 4) !== year) other++; });
      im.ok.forEach(function (r) { (by[r.staff_id] = by[r.staff_id] || []).push(r); });
      var okF = im.files.filter(function (f) { return !f.refused; }), ngF = im.files.filter(function (f) { return f.refused; });
      if (ngF.length) h += '<div class="band ng" role="alert"><b>読めなかったファイル（入れません）</b><ul>' + ngF.map(function (f) { return '<li>' + esc(f.name + '：読めなかった見出し ' + f.required.join('・')) + '</li>'; }).join('') + '</ul>freee の給与・賞与の明細の CSV か確かめてください。</div>';
      if (okF.length) h += '<p class="help">読んだファイル: ' + esc(okF.map(function (f) { return f.name + '（' + (f.kind === 'bonus' ? '賞与' : '給与') + '・' + f.n + '行' + (f.missing.length ? '・読めなかった見出し: ' + f.missing.join('・') : '') + '）'; }).join('／')) + '</p>';
      if (arr(im.dups).length) h += '<div class="band warn"><b>同じ人・支給日・種類の明細が2つのファイルにあります（後のファイルの行を入れます）</b><ul>' + im.dups.map(function (d) { return '<li>' + esc(nameOf(ctx, d.staff_id) + '・' + d.pay_date + '・' + (d.kind === 'bonus' ? '賞与' : '給与') + '：' + d.files.join('／') + ' → 入れるのは「' + d.chosen + '」') + '</li>'; }).join('') + '</ul>違うファイルを入れたい時は、そのファイルだけ選び直してください。</div>';
      h += '<div class="tw"><table><thead><tr><th>職員</th><th>支給日・種類・総支給・所得税</th></tr></thead><tbody>' + Object.keys(by).map(function (sid) {
        return '<tr><td class="nm">' + esc(nameOf(ctx, sid)) + '</td><td>' + by[sid].map(function (r) { return esc(r.pay_date + ' ' + (r.kind === 'bonus' ? '賞与' : '給与') + ' ' + yen(r.data.gross) + '円・税 ' + yen(r.data.income_tax) + '円' + (r.rev ? '（置き換え）' : '') + (r.dup ? '（⚠ 2つのファイルにあり・「' + r.src_name + '」の行）' : '')); }).join('<br>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      if (im.unmatched.length) h += '<div class="band warn"><b>職員に結べない行（' + esc(im.unmatched.length) + '行・入れません）</b><ul>' + im.unmatched.map(function (u) { return '<li>' + esc((u.row.name || '（氏名なし）') + '：' + ({ many: '同じ番号・氏名の職員が2人以上', none: '番号・氏名の合う職員がいない', nokey: '番号も氏名も無い' }[u.why] || u.why)) + '</li>'; }).join('') + '</ul>従業員番号は「職員の給与設定」の取り込みで入ります。</div>';
      if (bad) h += '<div class="band warn">数でない値・読めない支給日のある行が ' + esc(bad) + ' 行あります（入れません）。</div>';
      if (other) h += '<div class="band warn">支給日が' + esc(year) + '年でない行が ' + esc(other) + ' 行あります（入れません）。</div>';
      arr(im.warnings).forEach(function (w) { h += '<div class="band warn">' + esc(nameOf(ctx, w.staff_id) + '：' + w.msg) + '</div>'; });
      if (im.finalNg.length) h += '<div class="band warn">年末調整を確定した人の累計は変えられません（' + esc(im.finalNg.map(function (s) { return nameOf(ctx, s); }).join('、')) + '・入れません）。</div>';
      var neg = arr(im.neg);
      if (neg.length) h += '<div class="band ng" role="alert"><b>⛔ 負の値があって入れられない行（' + esc(neg.length) + '行）</b><ul>' + neg.map(function (x) {
        return '<li>' + esc(nameOf(ctx, x.staff_id) + '・' + x.pay_date + '・' + (x.kind === 'bonus' ? '賞与' : '給与') + '：' + arr(x.keys).map(function (k) { return YTD_LABEL[k] || k; }).join('・') + (x.src_name ? '（' + x.src_name + '）' : '')) + '</li>';
      }).join('') + '</ul>累計には負の額を入れられません。この行がある間は「累計に入れる」を押せません。この行を消したファイルを選び直し、その月は「＋ 累計に1回分を手で足す」で差し引きした額（0以上）を入れてください。</div>';
      if (im.done) h += doneHtml(ctx, im.done);
      h += '<div class="row"><button type="button" class="btn" data-act="ye-imp-cancel">やめる</button><button type="button" class="btn pri" data-act="ye-imp-go"' + (im.ok.length && !neg.length ? '' : ' disabled') + '>' + esc(im.ok.length) + '回分を累計に入れる</button></div>';
    }
    return h + '</div>';
  }

  function compareHtml(ctx) {
    var esc = ctx.esc, yen = ctx.yen;
    var h = '<div class="cd"><h2>freee と比べる（' + esc(ymText(ctx.ym)) + '）</h2><p class="help">freee から書き出したこの月分の給与の明細の CSV を選ぶと、この画面の今の計算（下書きでも確定でも）と人×項目で比べます。自社の明細に「所得税の精算」（年末調整の還付・追徴）がある時は、それを除いた控除の合計・差引で比べ、精算の額は別の列に出します（freee では年末調整をしないため・差の数に入れません）。</p>';
    h += '<div class="row"><label for="ye-cmpfile">この月分の CSV</label><input type="file" id="ye-cmpfile" accept=".csv,text/csv" style="max-width:100%"></div>';
    if (S.cmpErr) h += '<div class="band ng" role="alert">' + esc(S.cmpErr) + '</div>';
    var c = S.cmp;
    if (!c || c.ym !== ctx.ym) return h + '</div>';
    var r = c.res;
    /* 比べた後に計算し直した・読み直した時は、古い結果で合格の帯を出さない */
    if (c.fp !== cmpFp(ctx)) return h + '<div class="band warn" role="status">比べた後にこの月分の計算が変わりました。もう一度 CSV を選んで比べ直してください。</div><div class="row"><button type="button" class="btn" data-act="ye-cmp-clear">比べた結果を消す</button></div></div>';
    h += cmpBand(esc, r);
    if (c.nodate) h += '<p class="help">⚠ 支給日の列の無い行（' + esc(c.nodate) + ' 行）は、この月分として比べました。この月分の CSV かどうかは人が確かめてください。</p>';
    h += '<div class="tw"><table><caption class="help" style="text-align:left">項目ごとの合計</caption><thead><tr><th>項目</th><th class="num">自社</th><th class="num">freee</th><th class="num">差</th><th class="num">一致の人数</th><th class="num">差ありの人数</th></tr></thead><tbody>' +
      F().ITEMS.filter(function (x) { return r.totals[x[0]]; }).map(function (x) {
        var t = r.totals[x[0]], k = r.counts[x[0]];
        return '<tr><td>' + esc(x[1]) + '</td><td class="num">' + esc(yen(t.app)) + '</td><td class="num">' + esc(yen(t.freee)) + '</td><td class="num"' + (t.diff ? ' style="color:var(--ng);font-weight:700"' : '') + '>' + esc((t.diff ? '⚠ ' : '') + yen(t.diff)) + '</td><td class="num">' + esc(k.same) + '</td><td class="num">' + esc(k.diff) + '</td></tr>';
      }).join('') + (r.settle ? '<tr><td>年末調整の精算（自社だけ）</td><td class="num">' + esc(yen(r.settle)) + '</td><td class="num">—</td><td class="num">—</td><td></td><td></td></tr>' : '') + '</tbody></table></div>';
    if (r.unmatched.length) h += '<div class="band warn"><b>片方だけにいる人・照合できない行</b><ul>' + r.unmatched.map(function (u) {
      return '<li>' + esc(u.excluded ? '自社だけ（freee に登録の無い人・比べる対象外）：' + nameOf(ctx, u.staff_id) : u.side === 'ours' ? '自社だけ：' + nameOf(ctx, u.staff_id) : u.staff_id ? 'freee だけ：' + nameOf(ctx, u.staff_id) : '照合できません（職員に結べない freee の行）：' + u.name_short) + '</li>'; }).join('') + '</ul>職員に結べない行は、従業員番号（「職員の給与設定」の取り込みで入ります）か、同じ氏名がちょうど1人の時だけ結びます。従業員番号が ' + esc(F().EXCLUDE_PREFIX) + ' で始まる人は freee に登録が無いので比べません（差の数に入れません）。</div>';
    var rows = S.cmpAll ? r.rows : r.rows.filter(function (x) { return x.diff !== 0 || (x.key === 'income_tax' && x.settle); });
    h += '<div class="row"><label><input type="checkbox" id="ye-cmpall"' + (S.cmpAll ? ' checked' : '') + '> 一致した行も見せる</label></div>';
    h += rows.length ? '<div class="tw"><table><thead><tr><th>氏名</th><th>項目</th><th class="num">自社</th><th class="num">freee</th><th class="num">差</th><th class="num">年末調整の精算（自社だけ）</th></tr></thead><tbody>' + rows.map(function (x) {
      return '<tr><td class="nm">' + esc(x.staff_id ? nameOf(ctx, x.staff_id) : x.name_short) + '</td><td>' + esc(x.item) + '</td><td class="num">' + esc(yen(x.ours)) + '</td><td class="num">' + esc(x.bad ? '⚠ 読めない値' : yen(x.freee)) + '</td><td class="num"' + (x.diff !== 0 ? ' style="color:var(--ng);font-weight:700"' : '') + '>' + esc(x.bad ? '⚠ 読めない値' : (x.diff ? '⚠ ' : '') + yen(x.diff)) + '</td><td class="num">' + esc(x.key === 'income_tax' && x.settle ? yen(x.settle) : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="help">差のある行はありません。</p>';
    return h + '<div class="row"><button type="button" class="btn" data-act="ye-cmp-clear">比べた結果を消す</button></div></div>';
  }

  /* 合格の帯（給与と賞与で同じ文・payroll.js の賞与のタブも window.PayrollYearEndUI.cmpBand を使う） */
  function cmpBand(esc, r) {
    var ex = r.excluded ? '・freee に登録の無い人（比べる対象外）' + r.excluded + ' 人' : '';
    if (r.pass) return '<div class="band ok" role="status"><b>✓ 1円まで一致</b>（比べた ' + esc(r.compared) + ' 人の全項目' + esc(ex) + '）</div>';
    if (!r.compared && !r.diffCount && !r.others) return '<div class="band warn" role="status">⚠ 比べられた人がいません（freee の行と自社の明細の人が結べませんでした' + esc(ex) + '）</div>';
    return '<div class="band ng" role="status">⚠ 差あり ' + esc(r.diffCount) + ' 件（人×項目）・片方だけの人 ' + esc(r.others) + ' 人' + esc(ex) + '</div>';
  }
  /* 比べた時の自社の明細の指紋（計算し直し・読み直しで変われば、古い結果を出さない）。金額は画面のメモリの中だけ */
  function cmpFp(ctx) { return arr(ctx.items).map(function (it) { return it && it.staff_id + ':' + int(it.gross) + ':' + int(it.deduct) + ':' + int(it.net); }).sort().join('|'); }
  function sumOf(rows, k) { return rows.reduce(function (s, r) { return s + int(r.data[k]); }, 0); }
  function people(ctx) {
    var seen = {}, out = [];
    profiles(ctx).forEach(function (p) { if (!seen[p.staff_id]) { seen[p.staff_id] = 1; out.push(p.staff_id); } });
    arr(S.data && S.data.rows).concat(arr(S.data && S.data.yearend)).forEach(function (r) { if (!seen[r.staff_id]) { seen[r.staff_id] = 1; out.push(r.staff_id); } });
    return out;
  }
  function listHtml(ctx, year) {
    var esc = ctx.esc, yen = ctx.yen;
    var h = '<div class="cd"><h2>職員ごとの累計と年末調整</h2>';
    var ids = people(ctx);
    if (!ids.length) return h + '<p class="help">職員がいません。</p></div>';
    h += '<div class="tw"><table><thead><tr><th>印刷</th><th>氏名</th><th class="num">累計の回数</th><th class="num">支給の合計</th><th class="num">源泉の合計</th><th>申告</th><th>計算</th><th>警告</th><th></th></tr></thead><tbody>';
    ids.forEach(function (sid) {
      var rows = rowsOf(sid), y = yeOf(sid), ns = rows.filter(function (r) { return r.kind === 'salary'; }).length, nb = rows.length - ns;
      var w = y ? arr(y.result.warnings).length : 0, fin = y && y.status === 'final';
      h += '<tr><td>' + (fin ? '<input type="checkbox" id="ye-pk-' + esc(sid) + '" data-ye-pick="' + esc(sid) + '" aria-label="' + esc(nameOf(ctx, sid)) + ' の源泉徴収票を印刷に入れる"' + (S.pick[sid] ? ' checked' : '') + '>' : '') + '</td>' +
        '<td class="nm">' + esc(nameOf(ctx, sid)) + '</td><td class="num">' + esc('給与 ' + ns + '・賞与 ' + nb) + '</td><td class="num">' + esc(yen(sumOf(rows, 'gross'))) + '</td><td class="num">' + esc(yen(sumOf(rows, 'income_tax'))) + '</td>' +
        '<td>' + (y && Object.keys(y.decl).length ? '<span class="tag ok">入力済み</span>' : '<span class="tag">未入力</span>') + '</td>' +
        '<td>' + (fin ? '<span class="tag ok">✓ 確定</span>' : y ? '<span class="tag warn">下書き</span>' : '<span class="tag">なし</span>') + '</td>' +
        '<td>' + (w ? '<span class="tag warn">⚠ ' + esc(w) + '</span>' : '') + '</td>' +
        '<td class="nm"><button type="button" class="btn" data-act="ye-open" data-sid="' + esc(sid) + '">開く</button></td></tr>';
    });
    return h + '</tbody></table></div><p class="help">累計の回数は、データベースの累計に入った回（取り込んだ freee の明細・手で足した分）の数です。精算する月分の給与は、累計に入れずに「計算する」の時にその月の明細から足します。</p></div>';
  }
  function settleHelpHtml(ctx, year) {
    var esc = ctx.esc;
    return '<div class="cd"><h2>精算する月分の給与へ入れる</h2><ol class="help">' +
      '<li>年末調整を確定した人の過不足は、精算する月分（既定は' + esc(ymText(year + '-12')) + '）の給与の「その月だけの調整」の「所得税の精算」として入れます。</li>' +
      '<li>上の月分を精算する月分にして「今月の給与」のタブを開き、「年末調整の精算を入れる」を押します（何度押しても1人1行に置き換わります）。</li>' +
      '<li>計算し直して下書き保存し、確定します。確定の前に、データベースで精算の額が年末調整と合っているかを確かめ、合っていなければ確定しません。</li></ol></div>';
  }
  function printHtml(ctx, year) {
    var esc = ctx.esc, fin = arr(S.data && S.data.yearend).filter(function (y) { return y.status === 'final'; });
    var picked = fin.filter(function (y) { return S.pick[y.staff_id]; }).length;
    var h = '<div class="cd"><h2>源泉徴収票と合計表の値</h2>';
    h += '<p class="help">確定した人（' + esc(fin.length) + '人）の源泉徴収票（受給者交付用・A4 に2人分）を印刷します。住所の欄は空けてあるので手で書いてください（この画面は住所を持ちません）。マイナンバーの欄はありません。</p>';
    h += '<p class="help">令和9年1月以降は、市町村へ給与支払報告書を出せば税務署へ出す源泉徴収票は出したものとみなされます。市町村ごとの振り分けは住所を持たないので人が行ってください。</p>';
    h += '<div class="row"><button type="button" class="btn" data-act="ye-print" data-k="pick"' + (picked ? '' : ' disabled') + '>選んだ人を印刷（' + esc(picked) + '人）</button><button type="button" class="btn pri" data-act="ye-print" data-k="all"' + (fin.length ? '' : ' disabled') + '>確定した全員を印刷（' + esc(fin.length) + '人）</button>' +
      '<button type="button" class="btn" data-act="ye-csv"' + (fin.length ? '' : ' disabled') + '>合計表・給与支払報告書の値の CSV</button></div>';
    return h + '</div>';
  }

  /* ── 精算する月分の給与（今月の給与のタブ）──
     もとは DB の payroll_yearend_check(年) の行（統合 0122: staff_id・status・settle_ym・tax_adjust・balance_settle・state）。年末調整のタブで読んだ物（S.data）には頼らない。
     state: ok・diff（額が違う）・stale（確定の後に精算する月分の明細が変わった）・noitem・norun・notfinal・nobalance・noyearend。
     月の全員の確定を止めるのは「この月分を精算する月分にした確定済みの人」の stale と diff だけ。notfinal・noyearend・nobalance は止めずに帯で知らせる */
  var STOP_STATE = { stale: 1, diff: 1 }, INFO_STATE = { notfinal: '年末調整がまだ下書き', noyearend: '年末調整が無いのに所得税の精算がある', nobalance: '年末調整の過不足の額が無い' };
  function chkRows(rows, ym) { return arr(rows).filter(function (x) { return x && typeof x.staff_id === 'string' && (isYm(x.settle_ym) ? x.settle_ym : ym.slice(0, 4) + '-12') === ym; }); }
  function stopRows(rows, ym) { return chkRows(rows, ym).filter(function (x) { return x.status === 'final' && STOP_STATE[x.state]; }); }
  function finalsFor(ctx) {
    if (!isYm(ctx.ym) || !S.chk || S.chk.ym !== ctx.ym) return [];
    return chkRows(S.chk.rows, ctx.ym).filter(function (x) { return x.status === 'final' && typeof x.balance_settle === 'number'; });
  }
  /* 精算の額は「所得税の精算」（kind='tax_adjust'）のうち名前が「年末調整の精算」の行だけ（ほかの tax_adjust は今の使い方のまま） */
  function adjSettle(list) { return arr(list).filter(function (a) { return a && a.kind === 'tax_adjust' && a.name === SETTLE_NAME; }).reduce(function (s, a) { return s + int(a.amount); }, 0); }
  function chkKey(ctx) { return ctx.ym + '|' + (ctx.runRev || 0); }
  function loadChk(ctx) {
    var key = chkKey(ctx), my = S.gen, ym = ctx.ym;
    if (S.nodb || S.chkLoading === key) return;
    S.chkLoading = key;
    Promise.resolve().then(function () { return ctx.rpc('payroll_yearend_check', { p_year: +ym.slice(0, 4) }); }).then(function (r) {
      if (my !== S.gen) return;
      S.chkLoading = null;
      S.chk = { key: key, ym: ym, rows: r && r.ok !== false ? arr(r.rows) : [], err: !!(r && r.ok === false) };
      ctx.paint();
    }, function (e) {
      if (my !== S.gen) return;
      S.chkLoading = null;
      if (ctx.noDb && ctx.noDb(e)) { S.nodb = true; return; }
      if (ctx.note) ctx.note('年末調整の確かめ', e);
      S.chk = { key: key, ym: ym, rows: [], err: true };
      ctx.paint();
    });
  }
  function runBand(ctx) {
    if (ctx.frozen || !isYm(ctx.ym) || S.nodb) return '';
    if (!S.chk || S.chk.key !== chkKey(ctx)) { loadChk(ctx); if (!S.chk || S.chk.ym !== ctx.ym) return ''; }
    var esc = ctx.esc, rows = chkRows(S.chk.rows, ctx.ym), h = '';
    if (S.chk.err) h += '<div class="band warn" role="status">⚠ 年末調整の精算を確かめられませんでした（確定の時にもう一度確かめます）。</div>';
    var st = rows.filter(function (x) { return x.status === 'final' && x.state === 'stale'; });
    if (st.length) h += '<div class="band ng" role="alert">⛔ 年末調整を確定した後に、この月分の明細が変わりました（' + esc(st.map(function (x) { return nameOf(ctx, x.staff_id); }).join('、')) + '）。この月分は確定できません。管理者が年末調整の確定を取り消し、計算し直して確定し直してください。</div>';
    var info = rows.filter(function (x) { return INFO_STATE[x.state]; });
    if (info.length) h += '<div class="band warn" role="status">⚠ 年末調整の知らせ（確定は止めません）: ' + esc(info.map(function (x) { return nameOf(ctx, x.staff_id) + '（' + INFO_STATE[x.state] + '）'; }).join('、')) + '</div>';
    var fin = finalsFor(ctx);
    if (!fin.length) return h;
    var ng = fin.filter(function (y) { return adjSettle(ctx.adjOf(y.staff_id)) !== int(y.balance_settle); });
    return h + '<div class="band ' + (ng.length ? 'warn' : 'ok') + '" role="status">' + (ng.length
      ? '⚠ 年末調整を確定した ' + esc(fin.length) + ' 人のうち ' + esc(ng.length) + ' 人は、精算の額がまだこの月分に入っていないか、額が違います（' + esc(ng.map(function (y) { return nameOf(ctx, y.staff_id); }).join('、')) + '）。'
      : '✓ 年末調整の精算（' + esc(fin.length) + ' 人）はこの月分に入っています。') +
      ' <button type="button" class="btn" data-act="ye-settle">年末調整の精算を入れる</button></div>';
  }
  function settle(ctx) {
    if (ctx.frozen) return;
    var fin = finalsFor(ctx), n = 0, miss = [];
    fin.forEach(function (y) {
      var p = profOf(ctx, y.staff_id), amt = int(y.balance_settle);
      if (!p || p.none || obj(p.data).exclude === true) { if (amt !== 0) miss.push(nameOf(ctx, y.staff_id)); return; }
      var list = arr(ctx.adjOf(y.staff_id)).filter(function (a) { return !(a && a.kind === 'tax_adjust' && a.name === SETTLE_NAME); });
      if (amt !== 0) list.push({ kind: 'tax_adjust', name: SETTLE_NAME, amount: amt, reason: '令和' + reiwa(+ctx.ym.slice(0, 4)) + '年分の年末調整（' + (amt > 0 ? '不足額の徴収' : '超過額の還付') + '）' });
      ctx.setAdj(y.staff_id, list); n++;
    });
    if (miss.length) ctx.say('給与の設定が無い・計算から外している人には入れられませんでした（' + miss.join('、') + '）。');
    if (n) ctx.compute();
  }
  /* 確定の前の確かめ。月分に関係なく毎回 payroll_yearend_check(年) を呼び、この月分を精算する月分にした確定済みの人の stale・diff だけで止める。
     止める時は文、通す時は null。DB にまだ関数が無い時（0122 の前）は今の流れのまま通す（仮置き）。通信の失敗は止める */
  function beforeConfirm(ctx) {
    if (!isYm(ctx.ym)) return Promise.resolve(null);
    var ym = ctx.ym, my = S.gen;
    return Promise.resolve().then(function () { return ctx.rpc('payroll_yearend_check', { p_year: +ym.slice(0, 4) }); }).then(function (r) {
      if (r && r.ok === false) return '年末調整の精算を確かめられませんでした（' + String(r.error || 'ng') + '）。';
      if (my === S.gen) S.chk = { key: chkKey(ctx), ym: ym, rows: arr(r && r.rows), err: false };
      var bad = stopRows(r && r.rows, ym);
      if (!bad.length) return null;
      var st = bad.filter(function (x) { return x.state === 'stale'; }), df = bad.filter(function (x) { return x.state === 'diff'; });
      var msg = [];
      if (df.length) msg.push('年末調整の精算の額が、この月分の明細と合っていません（' + df.map(function (x) { return nameOf(ctx, x.staff_id); }).join('、') + '）。「年末調整の精算を入れる」で入れ直し、下書き保存してから確定してください。');
      if (st.length) msg.push('年末調整を確定した後に、この月分の明細が変わりました（' + st.map(function (x) { return nameOf(ctx, x.staff_id); }).join('、') + '）。管理者が年末調整の確定を取り消し、計算し直して確定し直してください。');
      return msg.join('');
    }, function (e) {
      if (ctx.noDb && ctx.noDb(e)) { S.nodb = true; return null; }
      if (ctx.note) ctx.note('年末調整の確かめ', e);
      return '年末調整の精算を確かめられませんでした。通信を確かめてから、もう一度押してください。';
    });
  }
  /* 「振込と書き出し」のタブの印（この月分を freee と比べて差があった時だけ・止めない） */
  function exportBadge(ctx) {
    var c = S.cmp;
    if (!c || c.ym !== ctx.ym) return '';
    if (c.fp !== cmpFp(ctx)) return '<span class="tag warn">⚠ freee と比べた後に計算が変わりました（比べ直してください）</span>';
    /* 対象外（freee に登録の無い人）は差に数えない */
    var n = c.res.pass ? 0 : c.res.diffCount + c.res.others;
    return n ? '<span class="tag warn">⚠ freee と差があります（' + ctx.esc(n) + '件）</span>' : (c.res.pass ? '' : '<span class="tag warn">⚠ freee と比べられた人がいません</span>');
  }

  /* ── ファイルを読む ── */
  function readFiles(files) {
    return Promise.all(files.map(function (f) {
      return f.arrayBuffer().then(function (buf) {
        var fp = '';
        var dg = root && root.crypto && root.crypto.subtle ? root.crypto.subtle.digest('SHA-256', buf).then(function (d) {
          return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 16);
        }, function () { return ''; }) : Promise.resolve('');
        return dg.then(function (h) { fp = h; return { name: f.name, buf: buf, fp: fp }; });
      });
    }));
  }
  function importFiles(ctx, list) {
    S.imp = null; S.impErr = null;
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) { ctx.paint(); return; }
    if (files.some(function (f) { return f.size > MAX_FILE; })) { S.impErr = 'ファイルが大きすぎます（1つ 2MB まで）。'; ctx.paint(); return; }
    var my = S.gen, year = yearOf(ctx), kindSel = val('ye-kind');
    readFiles(files).then(function (got) {
      if (my !== S.gen) return;
      var rows = [], fl = [];
      got.forEach(function (g, gi) {
        var p = F().parse(ctx.decode(g.buf), { kind: kindSel || undefined });
        g.buf = null;
        /* 必須の見出し（総支給額・所得税・課税支給額か非課税支給額）が無いファイルは、行を作らずファイルごと断る */
        fl.push({ name: g.name, kind: p.kind, n: p.rows.length, missing: p.cols.missing, refused: !!p.refused, required: arr(p.cols.required) });
        if (p.refused) return;
        p.rows.forEach(function (r) { r.src_fp = g.fp; r.src_name = g.name; r.src_i = gi; r.kind = p.kind; rows.push(r); });
      });
      var m = F().match(rows, staffList(ctx));
      var inYear = m.matched.filter(function (r) { return r.pay_date && +r.pay_date.slice(0, 4) === year; });
      var ok = [], warnings = [], finalNg = {}, neg = [];
      ['salary', 'bonus'].forEach(function (k) {
        var src = inYear.filter(function (r) { return r.kind === k; });
        var t = F().toYtd(src, k);
        arr(t.warnings).forEach(function (w) { warnings.push(w); });
        arr(t.skipped).forEach(function (x) { if (x.why === 'negative') neg.push(x); });   /* 負の値の行（入れられない・画面に赤く出し、ある間は送らせない） */
        /* toYtd は入れない行を飛ばすので、行のファイル名は (staff_id・支給日) の並びで当て直す */
        t.forEach(function (x) {
          var hit = src.filter(function (r) { return r.staff_id === x.staff_id && r.pay_date === x.pay_date && !arr(r.bad).length; });
          var used = ok.filter(function (o) { return o.staff_id === x.staff_id && o.pay_date === x.pay_date && o.kind === x.kind; }).length;
          var from = hit[used] || hit[hit.length - 1] || {};
          x.src_name = from.src_name || ''; x.src_i = from.src_i || 0;
          ok.push(x);
        });
      });
      /* 同じ人・同じ支給日・同じ種類が2つ以上あれば、後のファイル（選んだ順）の行を入れ、知らせと一覧の印を出す */
      var key = {}, uniq = [], dups = [];
      ok.forEach(function (x) {
        var k = x.staff_id + '|' + x.pay_date + '|' + x.kind, old = key[k];
        if (old) {
          var d = dups.filter(function (z) { return z.k === k; })[0];
          if (!d) { d = { k: k, staff_id: x.staff_id, pay_date: x.pay_date, kind: x.kind, files: [old.src_name] }; dups.push(d); }
          d.files.push(x.src_name);
          if (x.src_i < old.src_i) { d.chosen = old.src_name; return; }
          d.chosen = x.src_name;
        }
        key[k] = x;
      });
      Object.keys(key).forEach(function (k) { var x = key[k]; if (dups.some(function (z) { return z.k === k; })) x.dup = true; uniq.push(x); });
      uniq = uniq.filter(function (x) { var y = yeOf(x.staff_id); if (y && y.status === 'final') { finalNg[x.staff_id] = 1; return false; } return true; });
      uniq.forEach(function (x) { var old = rowsOf(x.staff_id).filter(function (r) { return r.pay_date === x.pay_date && r.kind === x.kind; })[0]; x.rev = old ? old.rev : 0; });
      uniq.sort(function (a, b) { return a.staff_id < b.staff_id ? -1 : a.staff_id > b.staff_id ? 1 : a.pay_date < b.pay_date ? -1 : 1; });
      S.imp = { files: fl, rows: rows, unmatched: m.unmatched, ok: uniq, warnings: warnings, finalNg: Object.keys(finalNg), dups: dups, neg: neg };
      ctx.paint();
    })['catch'](function (e) { if (ctx.note) ctx.note('freee の明細の読み込み', e); S.imp = null; S.impErr = '読めませんでした。freee の給与・賞与の明細の CSV を選んでください。'; ctx.paint(); });
  }
  function putRows(ctx, year, rows) {
    var i = 0;
    function next() {
      if (i >= rows.length) return Promise.resolve({ ok: true });
      var part = rows.slice(i, i + PUT_CHUNK); i += PUT_CHUNK;
      return ctx.rpc('payroll_ytd_put', { p_year: year, p_rows: part }).then(function (r) {
        if (r && r.ok === false) return Object.assign({ sent: i - part.length }, r);
        return next();
      });
    }
    return next();
  }
  /* 送った行が累計に入ったか: 読み直した累計に同じ人・支給日・種類があり、版が送った版より進んでいる（新しい行は1以上） */
  function splitDone(rows, data) {
    var out = { entered: [], missed: [] };
    rows.forEach(function (x) {
      var hit = arr(data && data.rows).filter(function (r) { return r.staff_id === x.staff_id && r.pay_date === x.pay_date && r.kind === x.kind; })[0];
      (hit && hit.rev > x.rev ? out.entered : out.missed).push(x);
    });
    return out;
  }
  var NG = { badshape: '形が違う行がありました', nostaff: '職員の名簿に無い人がいました', badyear: '支給日の年が違う行がありました', conflict: 'ほかの人が先に累計を変えました。読み直してください', final: '年末調整を確定した人の累計は変えられません', mismatch: '確定した明細と金額が違います', stale: '計算した後に累計か精算する月分の明細が変わりました（精算する月分の給与を下書き保存してから、計算し直してください）', reason: '理由を書いてください', notcalculated: '計算してから確定してください', notfound: '年末調整の下書きがありません', notfinal: '確定していません', badyear: '年が違います' };
  function ngText(r) { return (NG[r && r.error] || 'うまくいきませんでした（' + String((r && r.error) || 'ng') + '）') + (r && r.staff_id ? '（' + r.staff_id + '）' : '') + '。'; }
  function importGo(ctx, btn) {
    if (S.busy || !S.imp || !S.imp.ok.length || arr(S.imp.neg).length) return;
    var year = yearOf(ctx), rows = S.imp.ok.map(function (x) { return { staff_id: x.staff_id, pay_date: x.pay_date, kind: x.kind, source: 'freee', data: x.data, src_fp: x.src_fp, rev: x.rev }; });
    S.busy = true; if (btn) btn.disabled = true;
    var my = S.gen;
    putRows(ctx, year, rows).then(function (r) {
      if (my !== S.gen) { S.busy = false; rows = null; return; }
      if (!(r && r.ok === false)) { S.busy = false; rows = null; S.imp = null; ctx.toast('累計に入れました。'); reload(ctx); return; }
      /* 途中（500行ごと）で断られた: 累計を読み直し、入った行と入らなかった行を画面に出す。入らなかった行は今の版で送り直せるようにする */
      var msg = ngText(r);
      return Promise.resolve().then(function () { return ctx.rpc('payroll_ytd_get', { p_year: year }); }).then(function (g) {
        S.busy = false;
        if (my !== S.gen) return;
        if (!g || g.ok === false) { ctx.say('累計に入れられませんでした：' + msg + '（読み直しもできませんでした。「読み直す」を押して確かめてください）'); rows = null; ctx.paint(); return; }
        S.data = normData(g, year);
        var d = splitDone(rows, S.data); rows = null;
        var left = S.imp ? S.imp.ok.filter(function (x) { return d.missed.some(function (m) { return m.staff_id === x.staff_id && m.pay_date === x.pay_date && m.kind === x.kind; }); }) : [];
        left.forEach(function (x) { var cur = rowsOf(x.staff_id).filter(function (q) { return q.pay_date === x.pay_date && q.kind === x.kind; })[0]; x.rev = cur ? cur.rev : 0; });
        if (S.imp) { S.imp.ok = left; S.imp.done = { msg: msg, entered: d.entered, missed: d.missed }; }
        ctx.say('累計に入れられませんでした：' + msg + '（入った行 ' + d.entered.length + '・入らなかった行 ' + d.missed.length + '。下に一覧を出しました）');
        ctx.paint();
      }, function (e) { S.busy = false; rows = null; if (ctx.fail) ctx.fail(e, '累計の読み直し'); });
    }, function (e) { S.busy = false; rows = null; if (ctx.fail) ctx.fail(e, '累計に入れる'); });
  }
  function compareFile(ctx, f) {
    S.cmp = null; S.cmpErr = null;
    if (!f) { ctx.paint(); return; }
    if (f.size > MAX_FILE) { S.cmpErr = 'ファイルが大きすぎます（2MB まで）。'; ctx.paint(); return; }
    var my = S.gen, ym = ctx.ym;
    f.arrayBuffer().then(function (buf) {
      if (my !== S.gen) return;
      var p = F().parse(ctx.decode(buf), { kind: 'salary' }); buf = null;
      if (p.refused) { S.cmpErr = '読めなかった見出し: ' + arr(p.cols.required).join('・') + '。freee の給与の明細の CSV を選んでください。'; ctx.paint(); return; }
      var m = F().match(p.rows, staffList(ctx));
      var pd = ctx.payDate, mon = isDate(pd) ? pd.slice(0, 7) : null;
      var fr = m.matched.concat(m.unmatched.map(function (u) { return u.row; }));
      /* 支給日でこの月分にしぼる。読めない支給日の行・この月分の行が1つも無い CSV は比べない（前月の CSV で合格の帯を出さない） */
      var pk = mon ? F().pickByDate(fr, mon, { month: true }) : { rows: fr, off: false, nodate: fr.filter(function (r) { return !r.pay_date; }).length };
      if (pk.off) { S.cmpErr = pk.why === 'baddate' ? '支給日の読めない行が ' + pk.baddate + ' 行あります（どの月分か分からないので比べません）。freee の給与の明細の CSV を選び直してください。' : 'この CSV の支給日（' + pk.dates.join('・') + '）に、この月分（' + mon + '）の支給日がありません。この月分の CSV を選んでください。'; ctx.paint(); return; }
      fr = pk.rows;
      var ours = arr(ctx.items).map(function (it) { var q = profOf(ctx, it.staff_id); return Object.assign({}, it, { emp_num: q ? obj(q.data).freee_emp_num : null }); });
      if (!ours.length) { S.cmpErr = 'この月分の計算がまだありません。「今月の給与」で「計算する」を押してから比べてください。'; ctx.paint(); return; }
      S.cmp = { ym: ym, fp: cmpFp(ctx), nodate: pk.nodate, res: F().compareSlips(ours, fr, 'salary') };
      ctx.paint();
    })['catch'](function (e) { if (ctx.note) ctx.note('freee と比べる', e); S.cmpErr = '読めませんでした。freee の給与の明細の CSV を選んでください。'; ctx.paint(); });
  }

  /* ── 累計に1回分を手で足す（source='manual'・冬の賞与など） ── */
  var MAN = [['gross', '総支給'], ['taxable', '課税支給'], ['si_health', '健康保険料'], ['si_care', '介護保険料'], ['si_support', '子ども・子育て支援金'], ['si_pension', '厚生年金保険料'], ['si_emp', '雇用保険料'], ['income_tax', '所得税']];
  function openManual(ctx) {
    var esc = ctx.esc, year = yearOf(ctx);
    var ids = people(ctx).filter(function (sid) { var y = yeOf(sid); return !(y && y.status === 'final'); });
    var h = '<p>freee の明細に無い回を累計に足します。自社の給与アプリの賞与は、賞与のタブで確定すると累計に入ります（入らなかった時は賞与のタブの「年末調整の累計に入れる」）。ここで足すのは、それ以外の回（他所で払った分など・' + esc(year) + '年）だけです。</p><div class="kv">' +
      '<label for="ye-m-sid">職員</label><select id="ye-m-sid">' + ids.map(function (sid) { return '<option value="' + esc(sid) + '">' + esc(nameOf(ctx, sid)) + '</option>'; }).join('') + '</select>' +
      '<label for="ye-m-kind">種類</label><select id="ye-m-kind"><option value="bonus">賞与</option><option value="salary">給与</option></select>' +
      '<label for="ye-m-date">支給日</label><input type="date" id="ye-m-date" value="' + esc(year + '-12-24') + '">' +
      MAN.map(function (m) { return '<label for="ye-m-' + m[0] + '">' + esc(m[1]) + '（円）</label><input id="ye-m-' + m[0] + '" inputmode="numeric" autocomplete="off">'; }).join('') + '</div>' +
      '<p class="help">課税支給が空なら総支給と同じにします。同じ人・支給日・種類の行が累計にあれば置き換えます。</p>';
    ctx.openDlg('累計に1回分を手で足す', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="ye-manual-go">累計に足す</button>', { mode: 'ye-manual', dirtyCheck: true });
  }
  function yenIn(id) { var s = val(id).replace(/[,，\s円]/g, ''); if (s === '') return null; return /^\d{1,10}$/.test(s) ? parseInt(s, 10) : NaN; }
  function manualGo(ctx, btn) {
    if (S.busy) return;
    var year = yearOf(ctx), sid = val('ye-m-sid'), kind = val('ye-m-kind') === 'salary' ? 'salary' : 'bonus', pd = val('ye-m-date');
    if (!sid) { ctx.say('職員を選んでください。'); return; }
    if (!isDate(pd) || +pd.slice(0, 4) !== year) { ctx.say('支給日は ' + year + '年の日付で入れてください。'); return; }
    var d = {}, bad = [];
    MAN.forEach(function (m) { var n = yenIn('ye-m-' + m[0]); if (n !== n) bad.push(m[1]); d[m[0]] = n == null ? null : n; });
    if (bad.length) { ctx.say('円の整数で入れてください（' + bad.join('・') + '）。'); return; }
    if (d.gross == null) { ctx.say('総支給を入れてください。'); return; }
    if (d.taxable == null) d.taxable = d.gross;
    if (d.taxable > d.gross) { ctx.say('課税支給が総支給より大きくなっています。'); return; }
    var data = { gross: d.gross, taxable: d.taxable, nontax: d.gross - d.taxable, si_other: 0, resident_tax: 0 };
    ['si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'income_tax'].forEach(function (k) { data[k] = d[k] || 0; });
    var old = rowsOf(sid).filter(function (r) { return r.pay_date === pd && r.kind === kind; })[0];
    S.busy = true; if (btn) btn.disabled = true;
    var my = S.gen;
    ctx.rpc('payroll_ytd_put', { p_year: year, p_rows: [{ staff_id: sid, pay_date: pd, kind: kind, source: 'manual', data: data, src_fp: '', rev: old ? old.rev : 0 }] }).then(function (r) {
      S.busy = false; if (btn) btn.disabled = false;
      if (my !== S.gen) return;
      if (r && r.ok === false) { ctx.say('足せませんでした：' + ngText(r)); return; }
      ctx.closeDlg(); ctx.toast('累計に足しました。'); reload(ctx);
    }, function (e) { S.busy = false; if (btn) btn.disabled = false; ctx.closeDlg(); if (ctx.fail) ctx.fail(e, '累計に足す'); });
  }

  /* ── 1人を開く（申告の入力・計算・下書き保存・確定） ── */
  var DIS = [['none', 'なし'], ['general', '一般の障害者'], ['special', '特別障害者'], ['special_cohabit', '同居特別障害者']];
  var INS = [['life_new_general', '一般の生命保険料（新）'], ['life_old_general', '一般の生命保険料（旧）'], ['life_new_care', '介護医療保険料'], ['life_new_pension', '個人年金保険料（新）'], ['life_old_pension', '個人年金保険料（旧）'],
    ['quake', '地震保険料'], ['old_long_fire', '旧長期損害保険料'], ['national_pension', '国民年金保険料等'], ['social_extra', '社会保険料（給与から引いていない分・本人が払った分）'], ['small_biz', '小規模企業共済等掛金']];
  function selH(esc, id, label, v, opts) { return '<label for="' + id + '">' + esc(label) + '</label><select id="' + id + '"' + (S.dlg && S.dlg.ro ? ' disabled' : '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(v == null ? '' : v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function inH(esc, id, label, v, attrs) { return '<label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" value="' + esc(v == null ? '' : v) + '" autocomplete="off"' + (attrs || '') + (S.dlg && S.dlg.ro ? ' disabled' : '') + '>'; }
  function ckH(esc, id, label, v) { return '<label><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + (S.dlg && S.dlg.ro ? ' disabled' : '') + '> ' + esc(label) + '</label>'; }
  var NUM = ' inputmode="numeric"', TXT = ' maxlength="40"';
  function depsHtml(esc, list, n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      var d = obj(list[i]), p = 'ye-d' + i + '-';
      h += '<fieldset><legend>扶養親族 ' + (i + 1) + '</legend><div class="kv">' + inH(esc, p + 'name', '氏名', d.name, TXT) + inH(esc, p + 'kana', 'フリガナ', d.kana, TXT) + inH(esc, p + 'birth', '生年月日', d.birth, ' type="date"') +
        inH(esc, p + 'rel', '続柄', d.relation, ' maxlength="20"') + inH(esc, p + 'inc', '本年中の所得の見積額（円）', d.income, NUM) + selH(esc, p + 'dis', '障害者', d.disability || 'none', DIS) + '</div><div class="row">' +
        ckH(esc, p + 'live', '同居', d.live_together) + ckH(esc, p + 'nr', '非居住者', d.nonresident) +
        /* 留学・38万円以上の送金は非居住者の時だけ出す（印を変えると欄を描き直す） */
        (d.nonresident ? ckH(esc, p + 'stu', '留学', d.student) + ckH(esc, p + 'r38', '38万円以上の送金', d.remit38) : '') + '</div></fieldset>';
    }
    return h;
  }
  function u23Html(esc, list, n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      var d = obj(list[i]), p = 'ye-u' + i + '-';
      h += '<div class="row">' + '<label for="' + p + 'birth">' + esc((i + 1) + '人目の生年月日') + '</label><input id="' + p + 'birth" type="date" value="' + esc(d.birth || '') + '" autocomplete="off"' + (S.dlg && S.dlg.ro ? ' disabled' : '') + '>' +
        ckH(esc, p + 'sd', '特別障害者', d.special_disabled) + '</div>';
    }
    return h;
  }
  function prevHtml(esc, list, n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      var d = obj(list[i]), p = 'ye-p' + i + '-';
      h += '<fieldset><legend>前職 ' + (i + 1) + '</legend><div class="kv">' + inH(esc, p + 'payer', '支払者の名前', d.payer, ' maxlength="200"') + inH(esc, p + 'addr', '支払者の住所', d.address, ' maxlength="200"') + inH(esc, p + 'pay', '支払金額（円）', d.pay, NUM) +
        inH(esc, p + 'si', '社会保険料等の金額（円）', d.si, NUM) + inH(esc, p + 'tax', '源泉徴収税額（円）', d.tax, NUM) + inH(esc, p + 'left', '退職年月日', d.left_on, ' type="date"') + '</div></fieldset>';
    }
    return h;
  }
  function declBody(ctx, sid) {
    var esc = ctx.esc, D = S.dlg, d = D.decl, sp = d.spouse ? obj(d.spouse) : null, self = obj(d.self), ins = obj(d.insurance), hl = obj(d.housing_loan), year = yearOf(ctx);
    var h = '<p>' + esc(nameOf(ctx, sid)) + ' さんの令和' + esc(reiwa(year)) + '年分の申告を、紙の申告書の欄の順に入れます。マイナンバーは入れません。</p>';
    if (D.ro) h += '<div class="band ok">✓ 確定しています（' + esc(D.finalized_at || '') + '）。直す時は管理者が確定を取り消します。</div>';
    h += '<fieldset><legend>1. 給与所得者の扶養控除等（異動）申告書</legend><div class="row">' + ckH(esc, 'ye-kou', '扶養控除等申告書が出ている（甲欄・年末調整の対象）', d.kou !== false) + '</div><div class="kv">' +
      inH(esc, 'ye-exr', '対象にしない理由（乙欄・中途退職など）', d.exclude_reason, ' maxlength="200"') +
      selH(esc, 'ye-s-dis', '本人の障害者の区分', self.disability || 'none', DIS.slice(0, 3)) + selH(esc, 'ye-s-wid', '本人の寡婦・ひとり親', self.widow || 'none', [['none', 'なし'], ['widow', '寡婦'], ['single_parent', 'ひとり親']]) + '</div><div class="row">' +
      ckH(esc, 'ye-s-stu', '本人が勤労学生', self.working_student) + '</div>';
    h += '<p class="help">控除対象扶養親族・16歳未満の扶養親族（障害者の判定に使う）を、申告書の上から順に入れます。</p><div id="ye-deps">' + depsHtml(esc, arr(d.dependents), D.nDep) + '</div>' +
      (D.ro ? '' : '<button type="button" class="btn" data-act="ye-dep-add"' + (D.nDep >= 30 ? ' disabled' : '') + '>＋ 扶養親族の欄を足す</button>') +
      '<p class="help">配偶者の扶養に入れた23歳未満の子など（所得金額調整控除・生命保険料の特例の判定だけに使う・10人まで）</p><div id="ye-u23s">' + u23Html(esc, arr(d.under23_others), D.nU23) + '</div>' +
      (D.ro ? '' : '<button type="button" class="btn" data-act="ye-u23-add"' + (D.nU23 >= 10 ? ' disabled' : '') + '>＋ 23歳未満の子などの欄を足す</button>') + '</fieldset>';
    h += '<fieldset><legend>2. 給与所得者の基礎控除申告書・配偶者控除等申告書</legend><div class="kv">' + inH(esc, 'ye-oi', '本人の給与以外の所得の見積額（円）', d.other_income, NUM) + '</div><div class="row">' + ckH(esc, 'ye-sp-on', '配偶者がいる（控除等を受ける）', !!sp) + '</div><div class="kv">' +
      inH(esc, 'ye-sp-name', '配偶者の氏名', sp && sp.name, TXT) + inH(esc, 'ye-sp-kana', 'フリガナ', sp && sp.kana, TXT) + inH(esc, 'ye-sp-birth', '生年月日', sp && sp.birth, ' type="date"') +
      inH(esc, 'ye-sp-inc', '配偶者の本年中の合計所得金額の見積額（円）', sp && sp.income, NUM) + selH(esc, 'ye-sp-dis', '配偶者の障害者の区分', (sp && sp.disability) || 'none', DIS) + '</div><div class="row">' +
      ckH(esc, 'ye-sp-live', '同居', sp && sp.live_together) + ckH(esc, 'ye-sp-nr', '非居住者', sp && sp.nonresident) + '</div></fieldset>';
    h += '<fieldset><legend>3. 給与所得者の保険料控除申告書（申告書に書いた額・円）</legend><div class="kv">' + INS.map(function (x) { return inH(esc, 'ye-i-' + x[0], x[1], ins[x[0]], NUM); }).join('') + '</div></fieldset>';
    h += '<fieldset><legend>4. 住宅借入金等特別控除申告書</legend><div class="kv">' + inH(esc, 'ye-h-amt', '住宅借入金等特別控除の額（申告書の額・円）', hl.amount, NUM) + inH(esc, 'ye-h-start', '居住開始年月日', hl.start_date, ' type="date"') +
      selH(esc, 'ye-h-cnt', '控除の適用の数', String(hl.count || 1), [['1', '1回目の分だけ'], ['2', '2回目の分もある']]) +
      selH(esc, 'ye-h-lim', '所得の要件（合計所得金額）', String(hl.income_limit || 20000000), [['10000000', '1,000万円以下'], ['20000000', '2,000万円以下'], ['30000000', '3,000万円以下']]) + inH(esc, 'ye-h-kind', '住宅借入金等特別控除区分', hl.kind, ' maxlength="40"') + '</div></fieldset>';
    h += '<fieldset><legend>5. 前職の源泉徴収票（年の中途で就職した人）</legend><div id="ye-prevs">' + prevHtml(esc, arr(d.prev_jobs), D.nPrev) + '</div>' +
      (D.ro ? '' : '<button type="button" class="btn" data-act="ye-prev-add"' + (D.nPrev >= 5 ? ' disabled' : '') + '>＋ 前職の欄を足す</button>') + '</fieldset>';
    h += '<fieldset><legend>精算とメモ</legend><div class="kv">' + selH(esc, 'ye-settle-ym', '精算する月分', D.settle_ym, settleOpts(year)) + inH(esc, 'ye-memo', 'メモ', d.memo, ' maxlength="200"') + '</div>' +
      '<p class="help">既定は' + esc(ymText(year + '-12')) + '。12月分で精算できない時の扱いは税理士に確かめてください。</p></fieldset>';
    h += '<div id="ye-res">' + resultHtml(ctx, D.result, D.note) + '</div>';
    return h;
  }
  /* 精算する月分はその年の1〜12月分だけ（0122 の basis は同じ年の月分だけを受ける） */
  function settleOpts(year) { var o = []; for (var m = 1; m <= 12; m++) { var v = year + '-' + (m < 10 ? '0' : '') + m; o.push([v, ymText(v)]); } return o; }
  function dlgFoot(ctx) {
    var D = S.dlg, h = '<button type="button" class="btn" data-act="dlg-close">閉じる</button>';
    if (D.ro) return h + (ctx.isAdmin() ? '<button type="button" class="btn ng" data-act="ye-unfinal">確定を取り消す（管理者）</button>' : '');
    return h + '<button type="button" class="btn" data-act="ye-calc">計算する</button><button type="button" class="btn" data-act="ye-save">下書き保存</button><button type="button" class="btn pri" data-act="ye-final">確定する</button>';
  }
  function openPerson(ctx, sid) {
    var y = yeOf(sid), year = yearOf(ctx), decl = y ? JSON.parse(JSON.stringify(y.decl)) : { kou: true };
    S.dlg = { sid: sid, decl: decl, result: y && Object.keys(y.result).length ? y.result : null, rev: y ? y.rev : 0, ro: !!(y && y.status === 'final'), finalized_at: y && y.finalized_at,
      settle_ym: y ? y.settle_ym : year + '-12', nDep: Math.min(30, Math.max(arr(decl.dependents).length + 1, 2)), nPrev: Math.min(5, Math.max(arr(decl.prev_jobs).length, 1)), nU23: Math.min(10, Math.max(arr(decl.under23_others).length, 1)), note: null };
    ctx.openDlg(nameOf(ctx, sid) + ' さんの年末調整', declBody(ctx, sid), dlgFoot(ctx), { mode: 'ye-person', sid: sid, dirtyCheck: !S.dlg.ro });
  }
  /* 欄 → 申告（白い一覧の鍵だけ・空の欄は入れない） */
  function nIn(id, label, bad) { var n = yenIn(id); if (n !== n) { bad.push(label); return null; } return n; }
  function dIn(id, label, bad) { var s = val(id); if (!s) return null; if (!isDate(s)) { bad.push(label); return null; } return s; }
  function readDecl() {
    var D = S.dlg, bad = [], d = {};
    d.kou = on('ye-kou');
    var exr = val('ye-exr').slice(0, 200); if (exr) d.exclude_reason = exr;
    d.self = { disability: val('ye-s-dis') || 'none', widow: val('ye-s-wid') || 'none', working_student: on('ye-s-stu') };
    var deps = [];
    for (var i = 0; i < D.nDep; i++) {
      var p = 'ye-d' + i + '-', nm = val(p + 'name').slice(0, 40);
      if (!nm && !val(p + 'birth') && !val(p + 'inc')) continue;
      var x = { name: nm, kana: val(p + 'kana').slice(0, 40), birth: dIn(p + 'birth', '扶養親族' + (i + 1) + 'の生年月日', bad), relation: val(p + 'rel').slice(0, 20), income: nIn(p + 'inc', '扶養親族' + (i + 1) + 'の所得', bad) || 0,
        nonresident: on(p + 'nr'), disability: val(p + 'dis') || 'none', live_together: on(p + 'live') };
      if (x.nonresident) { x.student = on(p + 'stu'); x.remit38 = on(p + 'r38'); }
      if (!x.name) bad.push('扶養親族' + (i + 1) + 'の氏名');
      if (!x.birth) bad.push('扶養親族' + (i + 1) + 'の生年月日');
      deps.push(x);
    }
    if (deps.length) d.dependents = deps;
    var u23 = [];
    for (var u = 0; u < (D.nU23 || 0); u++) {
      var ub = dIn('ye-u' + u + '-birth', '23歳未満の子など' + (u + 1) + 'の生年月日', bad);
      if (ub) u23.push({ birth: ub, special_disabled: on('ye-u' + u + '-sd') });
      else if (on('ye-u' + u + '-sd')) bad.push('23歳未満の子など' + (u + 1) + 'の生年月日');
    }
    if (u23.length) d.under23_others = u23;
    if (on('ye-sp-on')) {
      d.spouse = { name: val('ye-sp-name').slice(0, 40), kana: val('ye-sp-kana').slice(0, 40), birth: dIn('ye-sp-birth', '配偶者の生年月日', bad), income: nIn('ye-sp-inc', '配偶者の所得', bad) || 0,
        nonresident: on('ye-sp-nr'), disability: val('ye-sp-dis') || 'none', live_together: on('ye-sp-live') };
      if (!d.spouse.birth) bad.push('配偶者の生年月日');
    }
    var oi = nIn('ye-oi', '給与以外の所得', bad); if (oi != null) d.other_income = oi;
    var ins = {};
    INS.forEach(function (x) { var n = nIn('ye-i-' + x[0], x[1], bad); if (n) ins[x[0]] = n; });
    if (Object.keys(ins).length) d.insurance = ins;
    var ha = nIn('ye-h-amt', '住宅借入金等特別控除の額', bad);
    var lim = +val('ye-h-lim'); if ([10000000, 20000000, 30000000].indexOf(lim) < 0) lim = 20000000;
    if (ha) d.housing_loan = { amount: ha, start_date: dIn('ye-h-start', '居住開始年月日', bad), count: val('ye-h-cnt') === '2' ? 2 : 1, kind: val('ye-h-kind').slice(0, 40), income_limit: lim };
    var pj = [];
    for (var j = 0; j < D.nPrev; j++) {
      var q = 'ye-p' + j + '-', payer = val(q + 'payer').slice(0, 200), pay = nIn(q + 'pay', '前職' + (j + 1) + 'の支払金額', bad);
      if (!payer && !pay) continue;
      pj.push({ payer: payer, address: val(q + 'addr').slice(0, 200), pay: pay || 0, si: nIn(q + 'si', '前職' + (j + 1) + 'の社会保険料', bad) || 0, tax: nIn(q + 'tax', '前職' + (j + 1) + 'の源泉徴収税額', bad) || 0, left_on: dIn(q + 'left', '前職' + (j + 1) + 'の退職年月日', bad) });
    }
    if (pj.length) d.prev_jobs = pj;
    var memo = val('ye-memo').slice(0, 200); if (memo) d.memo = memo;
    var sy = val('ye-settle-ym'); if (isYm(sy)) D.settle_ym = sy;
    return { decl: d, bad: bad };
  }
  /* 計算の入力: 累計の全行（freee・manual・app）＋精算する月分の給与がまだ累計に無ければ今の計算の明細（tax_adjust は除く） */
  function calcInput(ctx, sid, decl) {
    var year = yearOf(ctx), D = S.dlg, rows = rowsOf(sid).map(function (r) { return { staff_id: r.staff_id, pay_date: r.pay_date, kind: r.kind, source: r.source, data: r.data, rev: r.rev }; });
    var settle = null, warn = null;
    if (ctx.ym === D.settle_ym) {
      var it = itemOf(ctx, sid), pd = it && isDate(it.pay_date) ? it.pay_date : ctx.payDate;
      if (it && isDate(pd)) {
        /* 精算する月分の自社の給与（app）と同じ暦の月の給与の行（freee・manual）が累計にあれば二重に数えるので止める */
        var twin = rows.filter(function (r) { return r.kind === 'salary' && r.pay_date.slice(0, 7) === pd.slice(0, 7); });
        if (twin.length) return { input: null, basis: null, warn: null, stop: twin };
        var data = F().itemToYtd(it);
        rows.push({ staff_id: sid, pay_date: pd, kind: 'salary', source: 'app', data: data, rev: 0 });
        /* DB（0122 の payroll_item_vals）は明細の gross・item.taxable・item.si_total・所得税の行の和と比べる */
        settle = { ym: ctx.ym, rev: ctx.runRev || 0, gross: int(it.gross), taxable: it.taxable != null ? int(it.taxable) : data.taxable, si: it.si_total != null ? int(it.si_total) : data.si_health + data.si_care + data.si_support + data.si_pension + data.si_emp + data.si_other, tax: data.income_tax };
      } else warn = ymText(D.settle_ym) + 'の給与の明細がまだ無いので、その月を含めずに数えています（「今月の給与」で計算してから計算し直してください）。';
    } else warn = '精算する月分（' + ymText(D.settle_ym) + '）を表示していないので、その月の給与を含めずに数えています。上の月分を' + ymText(D.settle_ym) + 'にしてから計算してください。';
    /* 定数（rates）は渡さない（PayrollYearEnd が年で引く）。前職は decl.prev_jobs から読ませる（prevJobs と二重に渡さない） */
    var input = { year: year, rows: rows, decl: decl };
    /* basis の形は統合 0122 の payroll_basis_ok: {ytd:[{pay_date, kind, rev, fp}], items:[{ym, rev, gross, taxable, si, tax}]}。fp は ytd_get が返した DB の指紋をそのまま写す */
    var basis = { ytd: rowsOf(sid).map(function (r) { return { pay_date: r.pay_date, kind: r.kind, rev: r.rev, fp: r.fp }; }), items: settle ? [settle] : [] };
    return { input: input, basis: basis, warn: warn };
  }
  function doCalc(ctx) {
    var D = S.dlg; if (!D || D.ro) return null;
    var rd = readDecl();
    if (rd.bad.length) { ctx.say('入れ方が違う欄があります（' + rd.bad.slice(0, 8).join('・') + '）。円は整数、日付は年月日で入れてください。'); return null; }
    var ci = calcInput(ctx, D.sid, rd.decl), res;
    if (ci.stop) {
      D.result = null; D.twin = ci.stop;
      var bx = el('ye-res'); if (bx) ctx.put(bx, twinHtml(ctx, ci.stop));
      ctx.say('精算する月分（' + ymText(D.settle_ym) + '）の給与が、累計（' + ci.stop.map(function (r) { return r.pay_date + '・' + (SRC[r.source] || r.source); }).join('、') + '）と今の月分の明細の2つにあり、二重に数えるので計算しません。下の「累計のこの行を消す」でどちらかを消してください。');
      return null;
    }
    try { res = YE().computeYearEnd(ci.input); } catch (e) { if (ctx.note) ctx.note('年末調整の計算', e); ctx.say('計算できませんでした（申告の形を確かめてください）。'); return null; }
    D.decl = rd.decl; D.result = obj(res); D.basis = ci.basis; D.note = ci.warn;
    var box = el('ye-res'); if (box) ctx.put(box, resultHtml(ctx, D.result, D.note));
    return { decl: rd.decl, result: D.result, basis: ci.basis };
  }
  /* 内訳は決まった鍵だけを決まった順に描く（fuyo_etc は扶養・障害者等の合計なので内訳には入れず、小計として別の行に出す＝二重に数えない） */
  var SRC = { freee: 'freee の明細', manual: '手で足した分', app: 'この画面の給与' };
  function twinHtml(ctx, twin) {
    var esc = ctx.esc;
    return '<div class="band ng" role="alert"><b>⛔ 二重に数える行があるので計算しません</b><ul>' + twin.map(function (r) {
      return '<li>' + esc(r.pay_date + '・' + (SRC[r.source] || r.source) + '・総支給 ' + ctx.yen(r.data.gross) + '円') + ' <button type="button" class="btn ng" data-act="ye-ytd-del" data-pd="' + esc(r.pay_date) + '" data-k="' + esc(r.kind) + '">累計のこの行を消す</button></li>';
    }).join('') + '</ul><label for="ye-del-reason">消す理由（必ず書く）</label><input id="ye-del-reason" maxlength="200" autocomplete="off" style="width:100%"></div>';
  }
  function ytdDelete(ctx, b) {
    var D = S.dlg; if (!D || D.ro || S.busy || !b) return;
    var pd = b.getAttribute('data-pd'), kind = b.getAttribute('data-k'), reason = val('ye-del-reason');
    var row = rowsOf(D.sid).filter(function (r) { return r.pay_date === pd && r.kind === kind; })[0];
    if (!row) return;
    if (!reason) { ctx.say('消す理由を書いてください。'); return; }
    var year = yearOf(ctx), my = S.gen;
    ctx.ask(pd + ' の' + (SRC[row.source] || row.source) + 'の行を累計から消しますか？（消したことと理由は記録に残ります）').then(function (ok) {
      if (!ok || S.dlg !== D) return;
      S.busy = true; b.disabled = true;
      return ctx.rpc('payroll_ytd_delete', { p_year: year, p_staff_id: D.sid, p_pay_date: pd, p_kind: kind, p_rev: row.rev, p_reason: reason }).then(function (r) {
        S.busy = false;
        if (my !== S.gen) return;
        if (r && r.ok === false) { b.disabled = false; ctx.say('消せませんでした：' + ngText(r)); return; }
        S.data.rows = S.data.rows.filter(function (x) { return x !== row; });
        D.twin = null; var bx = el('ye-res'); if (bx) ctx.put(bx, resultHtml(ctx, null, null));
        ctx.toast('累計から消しました。もう一度「計算する」を押してください。');
      }, function (e) { S.busy = false; b.disabled = false; if (ctx.fail) ctx.fail(e, '累計の行を消す'); });
    });
  }
  var DED = [['social', '社会保険料控除'], ['small_biz', '小規模企業共済等掛金控除'], ['life', '生命保険料控除'], ['quake', '地震保険料控除'], ['spouse', '配偶者控除'], ['spouse_special', '配偶者特別控除'], ['tokutei', '特定親族特別控除'],
    ['dependents', '扶養控除'], ['disability', '障害者控除'], ['widow', '寡婦控除'], ['single_parent', 'ひとり親控除'], ['working_student', '勤労学生控除'], ['fuyo_etc', '（小計）扶養控除額及び障害者等の控除額の合計'], ['basic', '基礎控除']];
  var WHY = { not_kou: '扶養控除等申告書が出ていない（甲欄でない）', over_20m: 'その年の給与の収入が2,000万円を超える', rates_missing: 'その年の定数が無いか、確かめていない値がある', bad_input: '累計の行の形が違う', over_taxable_max: '課税給与所得が速算表の範囲を超える' };
  var STOP = { rates_missing: 1, bad_input: 1 };
  function stopOf(r) { return arr(r && r.reasons).filter(function (x) { return STOP[x]; }); }
  function resultHtml(ctx, r, warn) {
    var esc = ctx.esc, yen = ctx.yen;
    if (!r) return warn ? '<div class="band warn">' + esc(warn) + '</div>' : '<p class="help">「計算する」を押すと、ここに内訳と年税額と過不足を出します。</p>';
    var h = '<h3 style="font-size:16px">計算の結果</h3>';
    if (warn) h += '<div class="band warn">⚠ ' + esc(warn) + '</div>';
    arr(r.warnings).forEach(function (w) { h += '<div class="band warn">⚠ ' + esc(typeof w === 'string' ? w : (w && (w.msg || w.code)) || '') + '</div>'; });
    if (stopOf(r).length) return h + '<div class="band ng" role="alert">計算を止めました（' + esc(stopOf(r).map(function (x) { return WHY[x] || x; }).join('・')) + '）。確定できません。</div>';
    if (r.eligible === false) return h + '<div class="band warn">年末調整の対象外です（' + esc(arr(r.reasons).map(function (x) { return WHY[x] || String(x); }).join('・')) + '）。源泉徴収票は支払金額と徴収済みの税額で作ります。</div>';
    var line = function (k, v) { return '<tr><th>' + esc(k) + '</th><td class="num">' + esc(v == null ? '—' : yen(v)) + ' 円</td></tr>'; };
    h += '<div class="tw"><table><tbody>' + line('給与の支払金額', r.pay_total) + line('徴収済みの税額', r.withheld_total) + line('社会保険料（給与から）', r.si_total) + line('給与所得控除後の金額', r.kyuyo_shotoku) + line('所得金額調整控除', r.income_adjust);
    var dd = obj(r.deductions);
    DED.forEach(function (x) { if (typeof dd[x[0]] === 'number') h += line(x[1], dd[x[0]]); });
    h += line('所得控除の合計', r.deductions_total) + line('課税給与所得金額', r.taxable) + line('算出所得税額', r.tax_calc) + line('住宅借入金等特別控除の額', r.housing_applied) + line('年調年税額（復興特別所得税を含む）', r.nenzei) + '</tbody></table></div>';
    var b = r.balance == null ? null : int(r.balance);
    h += b == null ? '<div class="band ng">年税額を出せませんでした（定数の無い項目があります）。確定できません。</div>'
      : '<div class="band ' + (b > 0 ? 'warn' : 'ok') + '"><b>' + esc(b > 0 ? '不足額（12月の給与で徴収）' : b < 0 ? '超過額（12月の給与で還付）' : '過不足なし') + '：' + esc(yen(Math.abs(b))) + ' 円</b></div>';
    return h;
  }
  function saveDecl(ctx, btn, then) {
    var D = S.dlg; if (!D || D.ro || S.busy) return;
    var c = doCalc(ctx); if (!c) return;
    var year = yearOf(ctx), my = S.gen;
    S.busy = true; if (btn) btn.disabled = true;
    ctx.rpc('payroll_yearend_put', { p_year: year, p_staff_id: D.sid, p_decl: c.decl, p_result: c.result, p_basis: c.basis, p_settle_ym: D.settle_ym, p_rev: D.rev }).then(function (r) {
      S.busy = false; if (btn) btn.disabled = false;
      if (my !== S.gen || S.dlg !== D) return;
      if (r && r.ok === false) { ctx.say('保存できませんでした：' + ngText(r)); return; }
      D.rev = r && r.rev != null ? int(r.rev) : D.rev + 1;
      var y = yeOf(D.sid), row = { staff_id: D.sid, decl: c.decl, result: c.result, basis: c.basis, status: 'draft', settle_ym: D.settle_ym, rev: D.rev, finalized_at: null };
      if (y) Object.assign(y, row); else S.data.yearend.push(row);
      if (then) then(c); else { ctx.toast('下書き保存しました。'); ctx.paint(); }
    }, function (e) { S.busy = false; if (btn) btn.disabled = false; ctx.closeDlg(); S.dlg = null; if (ctx.fail) ctx.fail(e, '年末調整の下書き保存'); });
  }
  function finalize(ctx, btn) {
    var D = S.dlg; if (!D || D.ro || S.busy) return;
    var c0 = doCalc(ctx); if (!c0) return;
    if (stopOf(c0.result).length) { ctx.say('計算を止める警告があるので確定できません（' + stopOf(c0.result).map(function (x) { return WHY[x] || x; }).join('・') + '）。'); return; }
    if (c0.result.eligible !== false && (c0.result.balance == null || !c0.basis.items.length)) { ctx.say(c0.result.balance == null ? '年税額を出せていないので確定できません。' : '精算する月分（' + ymText(D.settle_ym) + '）の給与を含めて計算してから確定してください。上の月分を' + ymText(D.settle_ym) + 'にして「今月の給与」で計算してから開き直してください。'); return; }
    ctx.ask('この内容で年末調整を確定しますか？（確定すると、この人の累計と申告は変えられません。データベースが累計と精算する月分の明細を照らし合わせます）').then(function (ok) {
      if (!ok || S.dlg !== D) return;
      saveDecl(ctx, btn, function () {
        var year = yearOf(ctx), my = S.gen;
        S.busy = true;
        ctx.rpc('payroll_yearend_finalize', { p_year: year, p_staff_id: D.sid, p_rev: D.rev }).then(function (r) {
          S.busy = false;
          if (my !== S.gen) return;
          if (r && r.ok === false) { ctx.say('確定できませんでした：' + ngText(r)); if (r.error === 'stale') { ctx.closeDlg(); S.dlg = null; reload(ctx); } return; }
          ctx.closeDlg(); S.dlg = null; ctx.toast('年末調整を確定しました。'); reload(ctx);
        }, function (e) { S.busy = false; ctx.closeDlg(); S.dlg = null; if (ctx.fail) ctx.fail(e, '年末調整の確定'); });
      });
    });
  }
  function openUnfinal(ctx) {
    var D = S.dlg; if (!D || !D.ro || !ctx.isAdmin()) return;
    var sid = D.sid;
    ctx.openDlg('年末調整の確定を取り消す（管理者）', '<p>' + ctx.esc(nameOf(ctx, sid)) + ' さんの年末調整を下書きに戻します。取り消したことと理由は記録に残ります。精算する月分の給与に入れた精算は、そのまま残るので確かめてください。</p><label for="ye-u-reason">理由（必ず書く）</label><br><textarea id="ye-u-reason" rows="3" style="width:100%" maxlength="200"></textarea>',
      '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn ng" data-act="ye-unfinal-go">取り消す</button>', { mode: 'ye-unfinal', sid: sid });
    S.dlg = { sid: sid, ro: true, unfinal: true };
  }
  function unfinalGo(ctx, btn) {
    var D = S.dlg; if (!D || !D.unfinal || S.busy) return;
    var reason = val('ye-u-reason');
    if (!reason) { ctx.say('理由を書いてください。'); return; }
    var year = yearOf(ctx), my = S.gen;
    S.busy = true; if (btn) btn.disabled = true;
    ctx.rpc('payroll_yearend_unfinalize', { p_year: year, p_staff_id: D.sid, p_reason: reason }).then(function (r) {
      S.busy = false;
      if (my !== S.gen) return;
      ctx.closeDlg(); S.dlg = null;
      if (r && r.ok === false) { ctx.say('取り消せませんでした：' + ngText(r)); return; }
      ctx.toast('確定を取り消しました。'); reload(ctx);
    }, function (e) { S.busy = false; ctx.closeDlg(); S.dlg = null; if (ctx.fail) ctx.fail(e, '年末調整の確定の取り消し'); });
  }
  /* 扶養親族の欄を描き直す時は、空の行も含めて今の欄のまま写す（入れかけの印を落とさない） */
  function rawDeps(n) {
    var out = [];
    for (var i = 0; i < n; i++) { var p = 'ye-d' + i + '-'; out.push({ name: val(p + 'name'), kana: val(p + 'kana'), birth: val(p + 'birth'), relation: val(p + 'rel'), income: val(p + 'inc'), nonresident: on(p + 'nr'), disability: val(p + 'dis') || 'none', live_together: on(p + 'live'), student: on(p + 'stu'), remit38: on(p + 'r38') }); }
    return out;
  }
  function rawPrev(n) {
    var out = [];
    for (var j = 0; j < n; j++) { var q = 'ye-p' + j + '-'; out.push({ payer: val(q + 'payer'), address: val(q + 'addr'), pay: val(q + 'pay'), si: val(q + 'si'), tax: val(q + 'tax'), left_on: val(q + 'left') }); }
    return out;
  }
  function rawU23(n) { var out = []; for (var u = 0; u < n; u++) out.push({ birth: val('ye-u' + u + '-birth'), special_disabled: on('ye-u' + u + '-sd') }); return out; }
  function addRows(ctx, which) {
    var D = S.dlg; if (!D || D.ro) return;
    if (which === 'dep') { if (D.nDep >= 30) return; var raw = rawDeps(D.nDep); D.nDep++; ctx.put(el('ye-deps'), depsHtml(ctx.esc, raw, D.nDep)); }
    else if (which === 'u23') { if (D.nU23 >= 10) return; var ru = rawU23(D.nU23); D.nU23++; ctx.put(el('ye-u23s'), u23Html(ctx.esc, ru, D.nU23)); }
    else if (which === 'deps') ctx.put(el('ye-deps'), depsHtml(ctx.esc, rawDeps(D.nDep), D.nDep));
    else { if (D.nPrev >= 5) return; var rp = rawPrev(D.nPrev); D.nPrev++; ctx.put(el('ye-prevs'), prevHtml(ctx.esc, rp, D.nPrev)); }
  }

  /* ── 印刷と CSV ── */
  function slipList(ctx, which) {
    var w = WS(), out = [];
    arr(S.data && S.data.yearend).forEach(function (y) {
      if (y.status !== 'final' || (which === 'pick' && !S.pick[y.staff_id])) return;
      var p = profOf(ctx, y.staff_id), pd = p ? obj(p.data) : {};
      /* 乙欄の印は給与の設定の源泉の区分（tax.col が otsu）から（decl.kou=false は対象外の理由が乙欄とは限らないため） */
      out.push(w.slipValues(y.result, { staff_id: y.staff_id, name: nameOf(ctx, y.staff_id), birth: pd.birth_date || '', joined_on: pd.entry_date || '', left_on: pd.retire_date || '', otsu: obj(pd.tax).col === 'otsu' }, { name: ctx.corpName || '' }));
    });
    return out;
  }
  /* 印刷・書き出しは、記録（payroll_yearend_log）が通ってからだけ（給与明細の印刷と同じ順）。0122 の無い DB では止める */
  function logThen(ctx, kind, count, go) {
    var year = yearOf(ctx), my = S.gen;
    Promise.resolve().then(function () { return ctx.rpc('payroll_yearend_log', { p_year: year, p_kind: kind, p_count: count }); }).then(function (r) {
      if (my !== S.gen) return;
      if (!r || r.ok !== true) { ctx.say('記録に残せなかったので、止めました（' + String((r && r.error) || 'ng') + '）。'); return; }
      go();
    }, function (e) {
      if (ctx.noDb && ctx.noDb(e)) { ctx.say('データベースに記録の仕組みがまだ無いので、止めました（統合 0122 を入れた後に使えます）。'); return; }
      if (ctx.fail) ctx.fail(e, '源泉徴収票の記録');
    });
  }
  function doPrintSlips(ctx, which) {
    var list; try { list = slipList(ctx, which); } catch (e) { if (ctx.note) ctx.note('源泉徴収票の値', e); ctx.say('源泉徴収票を作れませんでした。'); return; }
    if (!list.length) return;
    var body; try { body = WS().slipHtml(list); } catch (e2) { if (ctx.note) ctx.note('源泉徴収票の紙', e2); ctx.say('源泉徴収票を作れませんでした。'); return; }
    logThen(ctx, 'withholding_slip', list.length, function () { ctx.printSlips(String(body || ''), Math.ceil(list.length / 2)); body = null; });
  }
  function doCsv(ctx) {
    var w = WS(), year = yearOf(ctx);
    try {
      var vals = slipList(ctx, 'all'), sum = w.summaryValues(vals);
      var text = w.toCsv(vals, sum);
      text = typeof text === 'string' ? text : String((text && text.text) || '');
      logThen(ctx, 'yearend_csv', vals.length, function () { ctx.download({ name: 'withholding-' + year + '.csv', text: text }); text = null; });
    } catch (e) { if (ctx.note) ctx.note('合計表の CSV', e); ctx.say('CSV を作れませんでした。'); }
  }

  /* ── 出来事（payroll.js から受ける）。受けた時は true ── */
  function onClick(ctx, act, b) {
    var sid = b && b.getAttribute ? b.getAttribute('data-sid') : null;
    if (act === 'ye-reload') reload(ctx);
    else if (act === 'ye-imp-cancel') { S.imp = null; S.impErr = null; ctx.paint(); }
    else if (act === 'ye-imp-go') importGo(ctx, b);
    else if (act === 'ye-manual') { if (partsOk()) openManual(ctx); }
    else if (act === 'ye-manual-go') manualGo(ctx, b);
    else if (act === 'ye-cmp-clear') { S.cmp = null; S.cmpErr = null; ctx.paint(); }
    else if (act === 'ye-open') { if (partsOk() && sid) openPerson(ctx, sid); }
    else if (act === 'ye-dep-add') addRows(ctx, 'dep');
    else if (act === 'ye-prev-add') addRows(ctx, 'prev');
    else if (act === 'ye-u23-add') addRows(ctx, 'u23');
    else if (act === 'ye-ytd-del') ytdDelete(ctx, b);
    else if (act === 'ye-calc') doCalc(ctx);
    else if (act === 'ye-save') saveDecl(ctx, b);
    else if (act === 'ye-final') finalize(ctx, b);
    else if (act === 'ye-unfinal') openUnfinal(ctx);
    else if (act === 'ye-unfinal-go') unfinalGo(ctx, b);
    else if (act === 'ye-settle') settle(ctx);
    else if (act === 'ye-print') doPrintSlips(ctx, b.getAttribute('data-k') === 'pick' ? 'pick' : 'all');
    else if (act === 'ye-csv') doCsv(ctx);
    else return false;
    return true;
  }
  function onChange(ctx, t) {
    var id = t && t.id;
    if (id === 'ye-year') { var y = +t.value; if (y >= 2000 && y <= 2100 && y !== yearOf(ctx)) { S.gen++; S.year = y; S.data = null; S.loading = null; S.imp = null; S.pick = {}; ctx.paint(); } }
    else if (id === 'ye-files') { importFiles(ctx, t.files); t.value = ''; }
    else if (id === 'ye-cmpfile') { compareFile(ctx, t.files && t.files[0]); t.value = ''; }
    else if (id === 'ye-cmpall') { S.cmpAll = !!t.checked; ctx.paint(); }
    else if (/^ye-d\d+-nr$/.test(id || '')) { addRows(ctx, 'deps'); var f = el(id); if (f) f.focus(); }   /* 非居住者の印で留学・送金の欄を出し入れする */
    else if (t && t.getAttribute && t.getAttribute('data-ye-pick')) { S.pick[t.getAttribute('data-ye-pick')] = !!t.checked; ctx.paint(); }
    else return false;
    return true;
  }
  /* 入力の途中では描き直さない（欄の状態は窓の中にある） */
  function onInput() { return false; }
  function dirty() { return !!S.imp; }

  var api = { VERSION: VERSION, SETTLE_NAME: SETTLE_NAME, html: html, onClick: onClick, onChange: onChange, onInput: onInput, reset: reset, runBand: runBand, beforeConfirm: beforeConfirm, exportBadge: exportBadge, dirty: dirty,
    cmpBand: cmpBand,
    _test: { state: function () { return S; }, cmpFp: cmpFp, settle: settle, finalsFor: finalsFor, adjSettle: adjSettle, calcInput: calcInput, settleOpts: settleOpts, readDecl: readDecl, depsHtml: depsHtml, stopRows: stopRows, rawPrev: rawPrev, rawU23: rawU23, slipList: slipList, splitDone: splitDone } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PayrollYearEndUI = api;
})(typeof window !== 'undefined' ? window : null);
