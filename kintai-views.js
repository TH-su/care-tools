/* kintai-views.js — 勤怠の管理画面（kintai.html）の「年別」「事業所別」「休日」のタブ（2026-11-25 新設・ROOT-v7-plus-parity.md の段B「祝日の設定」・段C「年別・事業所別の画面」）
 *
 * ・入り切りは設定（kintai_settings.config）の鍵 plusViews（真の時だけ入・既定は切）。切の時はタブのボタンを足さない＝今の画面のまま。
 * ・この部品が読み込めない時も、勤怠の画面は今のまま動く（kintai.js は window.KintaiViews が無ければ何もしない）。
 * ・数え方は持たない。月の集計は kintai.js が今の月の一覧と同じ数え方（締めた月は締めた時の設定・締めていない月はシフトの休憩の決まりを重ねる）で作って渡す。
 *   並べ・足すのは kintai-yearly.js、休日の暦は kintai-holiday.js。
 * ・ほかの月分は kintai_month_get で読む（同時に3本まで・世代の番号で古い答えを捨てる・メモリだけ・5分で捨てる）。端末に残すのは
 *   年別の幅と項目（kintai_vw_n・kintai_vw_item・決まった値だけ）だけで、勤怠・氏名・数字は残さない。
 * ・会社の休日の足す・止める・使うは管理者だけ（DB の kintai_settings_put が決める）。消さない。
 * ・休日はまだ勤怠の計算（kintai-calc.js）につながない（表示とデータだけ）。
 * ★職員の名前は画面に出すだけ（端末に残さない）。
 */
(function () {
  'use strict';
  var Y = window.KintaiYearly, H = window.KintaiHoliday;
  if (!Y || !H) return;
  var TABS = [['year', '年別'], ['site', '事業所別'], ['holiday', '休日']];
  var LS_N = 'kintai_vw_n', LS_ITEM = 'kintai_vw_item';
  var CONC = 3, TTL = 5 * 60 * 1000;
  var cache = {}, loading = {}, gen = 0, lastLoad = null, ofFilter = '', holYear = null, holOf = '';
  var draft = {};   /* 会社の休日の書きかけ（画面の中だけ・端末に残さない） */
  var DRAFT_IDS = { 'vw-h-kind': 1, 'vw-h-from': 1, 'vw-h-to': 1, 'vw-h-name': 1, 'vw-h-of': 1 };
  function keep(e) { var id = e && e.target && e.target.id; if (DRAFT_IDS[id]) draft[id] = String(e.target.value == null ? '' : e.target.value).slice(0, 40); }
  function dirty() { return !!(draft['vw-h-name'] || draft['vw-h-from'] || draft['vw-h-to']); }
  function dv(id) { return draft[id] || ''; }

  function nowMs() { try { return window.performance && performance.now ? performance.now() : Date.now(); } catch (_) { return Date.now(); } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function getN() { var v = +lsGet(LS_N); return v >= 1 && v <= Y.MAX_N && Math.floor(v) === v ? v : 12; }   /* 既定は12か月（仮置き） */
  function getItem() { var v = lsGet(LS_ITEM); return Y.isItem(v) ? v : 'workMin'; }
  function on(cfg) { return !!(cfg && cfg.plusViews === true); }
  function isTab(t) { return TABS.some(function (x) { return x[0] === t; }); }

  /* タブのボタン: 入の時だけ「個人の月」の後ろに足す（切の時は外す） */
  function syncTabs(isOn, cur) {
    var nav = document.querySelector('.tabs'); if (!nav) return;
    TABS.forEach(function (x) {
      var b = nav.querySelector('button[data-tab="' + x[0] + '"]');
      if (isOn && !b) {
        b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-tab', x[0]); b.textContent = x[1];
        var after = nav.querySelector('button[data-tab="staff"]');
        nav.insertBefore(b, after || null);
      } else if (!isOn && b) { b.parentNode.removeChild(b); b = null; }
      if (b) b.setAttribute('aria-selected', x[0] === cur ? 'true' : 'false');   /* 再読み込みで戻したタブにも選ばれた印を付ける（審査 2026-11-25 m1） */
    });
  }

  /* ── 月分を読む（今の月は渡された月を使う・ほかは読む） ── */
  function monthsFor(ctx, yms) {
    var now = Date.now(), out = [], need = [];
    yms.forEach(function (y) {
      if (y === ctx.ym && ctx.month) { out.push({ ym: y, month: ctx.month }); return; }
      var c = cache[y];
      if (c && now - c.at < TTL) { out.push({ ym: y, month: c.month, err: c.err }); return; }
      out.push({ ym: y, month: null, wait: true }); need.push(y);
    });
    if (need.length) fetchAll(ctx, need);
    return out;
  }
  function fetchAll(ctx, yms) {
    var my = gen, todo = yms.filter(function (y) { return !Object.prototype.hasOwnProperty.call(loading, y); });   /* 世代の番号は 0 から始まるので、値ではなく鍵があるかで見る */
    if (!todo.length) return;
    var t0 = nowMs(), running = 0, i = 0, done = 0;
    todo.forEach(function (y) { loading[y] = my; });
    var next = function () {
      while (running < CONC && i < todo.length) {
        (function (y) {
          running++;
          ctx.loadMonth(y).then(function (m) {
            if (my !== gen) return;
            cache[y] = { month: m, at: Date.now() };
          }, function (e) {
            if (my !== gen) return;
            if (!ctx.isNetErr(e)) ctx.note('年別の読み込み', e);   /* 通信の失敗は月分ごとに報告しない（帯と「読み直す」で知らせる・反証レビュー 2026-11-25） */
            cache[y] = { month: null, err: ctx.msgOf(e), at: Date.now() };
          }).then(function () {
            if (loading[y] === my) delete loading[y];
            running--; done++;
            if (my !== gen) return;
            if (done === todo.length) lastLoad = { n: todo.length, ms: nowMs() - t0 };
            ctx.repaintYear();   /* 描き直すのは年別を開いている時だけ（休日の書きかけを消さない・審査 2026-11-25 M1） */
            next();
          });
        })(todo[i++]);
      }
    };
    next();
  }
  /* 読み直す: 控えを捨てる（今の月は kintai.js の読み直しに任せる） */
  function drop() { gen++; cache = {}; loading = {}; lastLoad = null; }

  function val(v, unit, ctx) { if (v == null) return ''; return unit === 'min' ? ctx.fm(v) : String(Math.round(v * 100) / 100); }
  function ymJa(y) { return (+y.slice(0, 4)) + '年' + (+y.slice(5)) + '月分'; }
  function ofSelect(id, cur, ctx, withUnset) {
    return '<label>事業所 <select id="' + id + '"><option value="">全部</option>' + ['facility', 'visit', 'day'].map(function (o) { return '<option value="' + o + '"' + (cur === o ? ' selected' : '') + '>' + ctx.esc(ctx.officeName(o)) + '</option>'; }).join('') + (withUnset ? '<option value="-"' + (cur === '-' ? ' selected' : '') + '>未設定</option>' : '') + '</select></label>';
  }

  /* ── 年別 ── */
  function paintYear(ctx) {
    var n = getN(), item = getItem(), it = Y.itemOf(item), yms = Y.monthsBack(ctx.ym, n);
    var ms = monthsFor(ctx, yms), waitN = ms.filter(function (x) { return x.wait; }).length, errs = ms.filter(function (x) { return x.err; });
    var tb = Y.yearTable(ms.filter(function (x) { return !x.wait; }), item, ctx.order());
    var rows = tb.rows.filter(function (r) { var o = r.staff && r.staff.office; return !ofFilter || (ofFilter === '-' ? !o : o === ofFilter); });
    var h = ctx.printHead('年別（' + it.name + '・' + ymJa(yms[0]) + '〜' + ymJa(yms[yms.length - 1]) + '）') + '<div class="cd"><div class="row no-print">' +
      '<label>幅 <select id="vw-n">' + Array.apply(null, Array(Y.MAX_N)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (n === i + 1 ? ' selected' : '') + '>' + (i + 1) + 'か月</option>'; }).join('') + '</select></label>' +
      '<label>項目 <select id="vw-item">' + Y.ITEMS.map(function (x) { return '<option value="' + x.key + '"' + (x.key === item ? ' selected' : '') + '>' + ctx.esc(x.name) + '</option>'; }).join('') + '</select></label>' +
      ofSelect('vw-of', ofFilter, ctx, true) +
      '<button type="button" class="btn sm" data-act="vw-reload">読み直す</button><button type="button" class="btn sm" data-act="print"' + (waitN ? ' disabled' : '') + '>印刷</button></div>';
    if (!ctx.breaksKnown()) h += '<div class="band warn" role="status">シフトの休憩の決まりを読めていないため、締めていない月分の数字が「月の一覧」と違うことがあります。「シフトを取り込み直す」を押してから見てください。</div>';
    if (waitN) h += '<p class="help" role="status">ほかの月分を読んでいます…（あと ' + waitN + ' か月分）</p>';
    else if (lastLoad) h += '<p class="help">' + lastLoad.n + ' か月分を ' + (lastLoad.ms / 1000).toFixed(1) + ' 秒で読みました。</p>';
    if (errs.length) h += '<div class="band warn" role="status">' + ctx.esc(errs.map(function (x) { return ymJa(x.ym); }).join('・')) + ' を読めませんでした（空の列）。「読み直す」を押してください。</div>';
    var stOf = {}; ms.forEach(function (x) { stOf[x.ym] = x.wait ? '読み込み中' : x.err ? '読めず' : ''; });
    /* 読めない・読み込み中の月は見出しに書く（紙にも出る＝空の列を「名簿に無い月」と取り違えない・審査 2026-11-25 m2） */
    var head = '<tr><th class="nm">氏名</th><th>事業所</th>' + yms.map(function (y) { return '<th class="num">' + (+y.slice(5)) + '月分' + (+y.slice(5) === 1 || y === yms[0] ? '<br><span class="raw">' + y.slice(0, 4) + '</span>' : '') + (stOf[y] ? '<br><b>' + stOf[y] + '</b>' : '') + '</th>'; }).join('') + '<th class="num">合計' + (waitN || errs.length ? '<br><b>一部の月なし</b>' : '') + '</th></tr>';
    var body = rows.map(function (r) {
      return '<tr><td class="nm">' + ctx.esc(ctx.dispName(r.staff)) + '</td><td>' + ctx.esc(ctx.officeName(r.staff && r.staff.office) || '未設定') + '</td>' + yms.map(function (y) { return '<td class="num">' + val(r.cells[y], it.unit, ctx) + '</td>'; }).join('') + '<td class="num"><b>' + val(r.total, it.unit, ctx) + '</b></td></tr>';
    }).join('');
    var sums = {}, grand = 0;
    yms.forEach(function (y) { var s = 0, any = false; rows.forEach(function (r) { if (r.cells[y] != null) { s += r.cells[y]; any = true; } }); sums[y] = any ? s : null; grand += s; });
    var foot = rows.length ? '<tr><th class="nm">合計（' + rows.length + '人）</th><th></th>' + yms.map(function (y) { return '<th class="num">' + val(sums[y], it.unit, ctx) + '</th>'; }).join('') + '<th class="num">' + val(grand, it.unit, ctx) + '</th></tr>' : '';
    h += '<div class="tw"><table class="mt-y"><thead>' + head + '</thead><tbody>' + (body || '<tr><td colspan="' + (yms.length + 3) + '" class="empty">' + (waitN ? '読んでいます…' : '該当する職員はいません') + '</td></tr>') + '</tbody>' + (foot ? '<tfoot>' + foot + '</tfoot>' : '') + '</table></div>' +
      '<p class="help">数字は各月分の「月の一覧」と同じ数え方です（締めた月分は締めた時の設定）。見出しに「読めず」とある月は読めなかった月です。事業所はその人の主の事業所で絞ります。終わりの月は上の月の選びで変えます。</p></div>';
    return h;
  }

  /* ── 事業所別 ── */
  function paintSite(ctx) {
    var t = Y.siteTable(ctx.month), cols = [['active', '在籍', 'n'], ['worked', '働いた人', 'n'], ['workDays', '出勤日数', 'd'], ['workMin', '実働', 'm'], ['overtimeMin', '残業', 'm'], ['legalOverMin', '法定外', 'm'], ['nightMin', '深夜', 'm'], ['holidayMin', '休日労働', 'm'], ['paidDays', '有休', 'd'], ['absentDays', '欠勤', 'd']];
    var cell = function (r, c) { var v = r[c[0]]; return '<td class="num">' + (c[2] === 'm' ? ctx.fm(v) : String(v)) + '</td>'; };
    var name = function (o) { return o === '' ? '未設定' : (ctx.officeName(o) || o); };
    var h = ctx.printHead('事業所別') + '<div class="cd"><div class="row no-print"><button type="button" class="btn sm" data-act="print">印刷</button></div>' +
      '<div class="tw"><table class="mt-s"><thead><tr><th>事業所</th>' + cols.map(function (c) { return '<th class="num">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.rows.map(function (r) { return '<tr><td>' + ctx.esc(name(r.office)) + '</td>' + cols.map(function (c) { return cell(r, c); }).join('') + '</tr>'; }).join('') +
      '</tbody><tfoot><tr><th>全体</th>' + cols.map(function (c) { var v = t.total[c[0]]; return '<th class="num">' + (c[2] === 'm' ? ctx.fm(v) : String(v)) + '</th>'; }).join('') + '</tr></tfoot></table></div>' +
      '<p class="help">実働は、その人が働いた事業所（予定の事業所）に分けて数えます（予定の無い勤務はその人の主の事業所）。残業・法定外・深夜・休日労働・有休・出勤日数・欠勤は、その人の主の事業所に入れます。在籍は今の勤怠の名簿で休止でない人を主の事業所で数え（過ぎた月分でも今の名簿で数えます）、働いた人はその事業所で1分以上働いた人です（2つの事業所で働いた人は両方に数えるので、全体の人数と合わないことがあります）。主の事業所が決まっていない人は「未設定」です。</p></div>';
    return h;
  }

  /* ── 休日 ── */
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function wd(d) { return WD[new Date(Date.parse(d + 'T12:00:00+09:00')).getUTCDay()]; }
  function mdJa(s) { return (+s.slice(-5, -3)) + '/' + (+s.slice(-2)); }
  function spanText(x) {
    if (x.date) return x.date.slice(0, 4) + '/' + mdJa(x.date) + (x.to ? '〜' + (x.to.slice(0, 4) !== x.date.slice(0, 4) ? x.to.slice(0, 4) + '/' : '') + mdJa(x.to) : '');
    return '毎年 ' + mdJa(x.md) + (x.to ? '〜' + mdJa(x.to) : '');
  }
  function paintHoliday(ctx) {
    var cfg = ctx.cfg(), y = holYear || +ctx.ym.slice(0, 4);
    var raw = cfg.companyHolidays, cl = H.cleanCompany(raw), items = cl.items, admin = ctx.isAdmin();
    var cal = H.yearCalendar(cfg, y, holOf);
    var nat = cal.filter(function (c) { return c.national; }).length, com = cal.filter(function (c) { return c.company.length; }).length;
    var est = y > H.CONFIRMED_THROUGH;
    var years = []; for (var yy = Math.max(H.MIN_YEAR, y - 2); yy <= Math.min(H.MAX_YEAR, y + 2); yy++) years.push(yy);
    var h = ctx.printHead(y + '年の休日') + '<div class="cd"><div class="row no-print"><label>年 <select id="vw-hy">' + years.map(function (v) { return '<option value="' + v + '"' + (v === y ? ' selected' : '') + '>' + v + '年</option>'; }).join('') + '</select></label>' +
      ofSelect('vw-hof', holOf, ctx, false) + '<button type="button" class="btn sm" data-act="print">印刷</button></div>' +
      '<p>国の祝日・休日 <b>' + nat + '</b> 日・会社の休日 <b>' + com + '</b> 日・合わせて <b>' + cal.length + '</b> 日</p>';
    if (est) h += '<div class="band warn" role="status">' + y + '年の祝日は、内閣府の発表の前の見込みです（春分の日・秋分の日は前の年の2月に決まります）。</div>';
    h += '<div class="tw"><table class="mt-h"><thead><tr><th>日付</th><th>曜日</th><th>国の祝日・休日</th><th>会社の休日</th></tr></thead><tbody>' +
      (cal.map(function (c) {
        return '<tr><td>' + mdJa(c.date) + '</td><td>' + wd(c.date) + '</td><td>' + (c.national ? ctx.esc(c.national.name) + (c.national.estimated ? '<span class="raw">（見込み）</span>' : '') : '') + '</td><td>' +
          ctx.esc(c.company.map(function (x) { return x.name + (x.office ? '（' + (ctx.officeName(x.office) || x.office) + '）' : ''); }).join('・')) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="empty">この年の休日はありません</td></tr>') + '</tbody></table></div>';
    /* 会社の休日の一覧と足す欄（画面だけ・印刷しない） */
    h += '<div class="no-print"><h2 style="font-size:16px;margin:14px 0 8px">会社の休日（使う ' + items.filter(function (x) { return x.active; }).length + ' / ' + H.MAX_COMPANY + ' 件・止めた分を含めて ' + items.length + ' / ' + H.MAX_TOTAL + ' 件）</h2>';
    if (cl.bad.length) h += '<div class="band warn" role="status">設定の会社の休日に、形の違う行が ' + cl.bad.length + ' 件あります（数えていません）。この画面で足す・止めると、その行は外れます。</div>';
    h += '<div class="tw"><table class="mt-h"><thead><tr><th>日付</th><th>名前</th><th>事業所</th><th>状態</th><th></th></tr></thead><tbody>' +
      (items.map(function (x, i) {
        return '<tr><td>' + ctx.esc(spanText(x)) + '</td><td>' + ctx.esc(x.name) + '</td><td>' + ctx.esc(x.office ? ctx.officeName(x.office) || x.office : '全部') + '</td><td>' + (x.active ? '使う' : '<span class="raw">止めた</span>') + '</td><td>' +
          (admin ? '<button type="button" class="btn sm" data-act="vw-h-toggle" data-i="' + i + '">' + (x.active ? '止める' : '使う') + '</button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="empty">会社の休日はまだありません</td></tr>') + '</tbody></table></div>';
    if (admin) {
      h += '<div id="vw-h-form" class="kv"><label for="vw-h-kind">種類</label><span><select id="vw-h-kind"><option value="once">この年だけ</option><option value="yearly"' + (dv('vw-h-kind') === 'yearly' ? ' selected' : '') + '>毎年</option></select></span>' +
        '<label for="vw-h-from">日付</label><span><input type="date" id="vw-h-from" value="' + ctx.esc(dv('vw-h-from')) + '" min="' + H.MIN_YEAR + '-01-01" max="' + H.MAX_YEAR + '-12-31"> 〜 <input type="date" id="vw-h-to" value="' + ctx.esc(dv('vw-h-to')) + '" aria-label="終わりの日（1日だけの時は空）" min="' + H.MIN_YEAR + '-01-01" max="' + H.MAX_YEAR + '-12-31"> 1日だけの時は終わりの日を空にします（' + H.RANGE_MAX + '日まで）。「毎年」の時は年を見ません</span>' +
        '<label for="vw-h-name">名前</label><span><input type="text" id="vw-h-name" value="' + ctx.esc(dv('vw-h-name')) + '" maxlength="' + H.NAME_MAX + '" placeholder="例: 年末年始の休み"> ' + H.NAME_MAX + '字まで</span>' +
        '<label for="vw-h-of">事業所</label><span><select id="vw-h-of"><option value="">全部</option>' + ['facility', 'visit', 'day'].map(function (o) { return '<option value="' + o + '"' + (dv('vw-h-of') === o ? ' selected' : '') + '>' + ctx.esc(ctx.officeName(o)) + '</option>'; }).join('') + '</select></span></div>' +
        '<div class="row"><button type="button" class="btn pri" data-act="vw-h-add">会社の休日を足す</button><button type="button" class="btn" data-act="vw-h-prune">去年までの止めた休日を外す</button></div>';
    } else h += '<p class="help">会社の休日を足す・止めるのは管理者（2段階認証まで済んだ人）です。</p>';
    h += '<p class="help">国の祝日は「国民の祝日に関する法律」の決まりで数えています（' + H.MIN_YEAR + '〜' + H.MAX_YEAR + '年・' + H.CONFIRMED_THROUGH + '年までは内閣府の一覧と同じであることを確かめてあります）。会社の休日は「止める」で外します（去年までの「この年だけ」で止めた休日は、件数が足りない時に一覧から外せます）。休日は、まだ勤怠の計算（残業・休日労働）には使っていません。</p></div></div>';
    return h;
  }

  function paint(tab, ctx) {
    if (tab === 'year') return paintYear(ctx);
    if (tab === 'site') return paintSite(ctx);
    return paintHoliday(ctx);
  }

  /* ── 押す・選ぶ ── */
  var WHY = { shape: '形', date: '日付', to: '終わりの日（始まりの日より後で' + H.RANGE_MAX + '日まで）', name: '名前（1〜' + H.NAME_MAX + '字）', office: '事業所', active: '状態', max: '件数（使う ' + H.MAX_COMPANY + '件・止めた分を含めて ' + H.MAX_TOTAL + '件まで）' };
  function save(ctx, list, btn, doneMsg, onOk) {
    var cfg = ctx.cfg(), out = {}, k;
    for (k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
    out.companyHolidays = list;
    if (!H.fitsConfig(out)) { alert('設定に入る量を超えます。止めた会社の休日を減らすか、期間でまとめてください。'); return; }
    ctx.saveConfig(out, btn, doneMsg, onOk);
  }
  function act(a, b, ctx) {
    if (a === 'vw-reload') { drop(); ctx.repaint(); return true; }
    if (a === 'vw-h-toggle') {
      if (!ctx.isAdmin()) return true;
      var items = H.cleanCompany(ctx.cfg().companyHolidays).items, i = +b.getAttribute('data-i'), x = items[i];
      if (!x) return true;
      if (!x.active && items.filter(function (c) { return c.active; }).length >= H.MAX_COMPANY) { alert('使う会社の休日が ' + H.MAX_COMPANY + ' 件あります。先にほかの休日を止めてください。'); return true; }   /* 31件目を黙って読み飛ばさない（反証レビュー 2026-11-25） */
      if (!confirm('会社の休日「' + x.name + '」（' + spanText(x) + '）を' + (x.active ? '止めます' : 'もう一度使います') + '。よいですか？')) return true;
      x.active = !x.active;
      save(ctx, items, b, x.active ? '会社の休日を使うようにしました' : '会社の休日を止めました');
      return true;
    }
    if (a === 'vw-h-prune') {
      /* 過ぎた年の「この年だけ」で止めた休日を設定から外す（今の暦にも計算にも効かない行だけ・件数の行き止まりを解く・反証レビュー 2026-11-25・仮置き） */
      if (!ctx.isAdmin()) return true;
      var all = H.cleanCompany(ctx.cfg().companyHolidays).items, y0 = String(new Date().getFullYear());
      var keepL = all.filter(function (c) { return !(c.active === false && c.date && (c.to || c.date).slice(0, 4) < y0); });
      var n0 = all.length - keepL.length;
      if (!n0) { alert('外せる休日はありません（外せるのは、去年までの「この年だけ」で止めた休日だけです）。'); return true; }
      if (!confirm('去年までの「この年だけ」で止めた会社の休日 ' + n0 + ' 件を一覧から外します。外した休日は戻せません（暦と計算には今も使っていません）。よいですか？')) return true;
      save(ctx, keepL, b, '止めた休日を ' + n0 + ' 件外しました');
      return true;
    }
    if (a === 'vw-h-add') {
      if (!ctx.isAdmin()) return true;
      var kind = val0('vw-h-kind'), from = val0('vw-h-from'), to = val0('vw-h-to'), nm = val0('vw-h-name'), of = val0('vw-h-of');
      if (!H.okDate(from)) { alert('日付を入れてください。'); return true; }
      var e = kind === 'yearly' ? { md: from.slice(5) } : { date: from };
      if (to) { if (!H.okDate(to)) { alert('終わりの日を入れ直してください。'); return true; } e.to = kind === 'yearly' ? to.slice(5) : to; }
      if (kind === 'yearly' && e.to === e.md) delete e.to;
      if (kind !== 'yearly' && e.to === e.date) delete e.to;
      e.name = nm; e.office = of; e.active = true;
      var chk = H.cleanCompany([e]);
      if (chk.bad.length) { alert('入れ直してください: ' + WHY[chk.bad[0].why]); return true; }
      var cur = H.cleanCompany(ctx.cfg().companyHolidays).items, ne = chk.items[0];
      if (cur.filter(function (c) { return c.active; }).length >= H.MAX_COMPANY) { alert('使う会社の休日は ' + H.MAX_COMPANY + ' 件までです。過ぎた休日を「止める」と空きます。'); return true; }
      if (cur.length >= H.MAX_TOTAL) { alert('会社の休日は止めた分を含めて ' + H.MAX_TOTAL + ' 件までです。「去年までの止めた休日を外す」で空けるか、期間でまとめて入れてください。'); return true; }
      if (cur.some(function (c) { return c.active && (c.date || '') === (ne.date || '') && (c.md || '') === (ne.md || '') && (c.to || '') === (ne.to || '') && c.office === ne.office; })) { alert('同じ日付・事業所の会社の休日がもうあります。'); return true; }
      save(ctx, cur.concat([ne]), b, '会社の休日を足しました', function () { draft = {}; });
      return true;
    }
    return false;
  }
  function val0(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function change(e, ctx) {
    var id = e.target && e.target.id;
    if (DRAFT_IDS[id]) { keep(e); return true; }
    if (id === 'vw-n') { var n = +e.target.value; if (n >= 1 && n <= Y.MAX_N) lsSet(LS_N, String(n)); ctx.repaint(); return true; }
    if (id === 'vw-item') { if (Y.isItem(e.target.value)) lsSet(LS_ITEM, e.target.value); ctx.repaint(); return true; }
    if (id === 'vw-of') { var v = e.target.value; ofFilter = v === '-' || v === 'facility' || v === 'visit' || v === 'day' ? v : ''; ctx.repaint(); return true; }
    if (id === 'vw-hy') { var y = +e.target.value; holYear = y >= H.MIN_YEAR && y <= H.MAX_YEAR ? y : null; ctx.repaint(); return true; }
    if (id === 'vw-hof') { var o = e.target.value; holOf = o === 'facility' || o === 'visit' || o === 'day' ? o : ''; ctx.repaint(); return true; }
    return false;
  }

  /* ── 設定のタブの入り切りの欄（#g-set の中・「設定を保存する」で保存） ── */
  function setHtml(cfg) {
    return '<label for="s-plusViews">年別・事業所別・休日のタブ</label><span><input type="checkbox" id="s-plusViews"' + (on(cfg) ? ' checked' : '') + '> 出す（休日はまだ勤怠の計算には使いません）</span>';
  }
  /* 返す: { keys:['plusViews'], vals:{} }。切のまま鍵が無ければ鍵を作らない（無い時と同じ動き） */
  function readSet(cfg) {
    var el = document.getElementById('s-plusViews');
    if (!el) return null;
    var vals = {};
    if (el.checked) vals.plusViews = true;
    else if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'plusViews')) vals.plusViews = false;
    return { keys: ['plusViews'], vals: vals };
  }

  window.KintaiViews = { keep: keep, dirty: dirty, TABS: TABS.map(function (x) { return x[0]; }), on: on, isTab: isTab, syncTabs: syncTabs, paint: paint, act: act, change: change, drop: drop, setHtml: setHtml, readSet: readSet };
})();
