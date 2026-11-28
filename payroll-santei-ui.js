/* payroll-santei-ui.js — 給与の画面（payroll.html）の「定時決定」のタブ（2026-11-26 新設・設計 ~/Claude/Work/勤怠管理アプリ/給与/ROOT-santei.md）
 * ════════════════════════════════════════════════════════════════
 * ・payroll.js はタブの登録と呼び口だけ。描く物は html(ctx) が文字で返し（HTML を入れるのは payroll.js の put）、出来事は onClick / onChange で受ける
 * ・計算は PayrollSantei（純関数）。読むのは payroll_bootstrap(ym)（統合 0102 の今の口）・書くのは「9月分から等級を変える」の payroll_profile_put だけ
 * ・二つの使い方:
 *     定時決定（7月）: 4〜6月に支給した確定済みの給与 → 算定基礎届の控え（CSV）→ 9月分から等級を変える（初めて効く月分の前の月分が確定した後だけ）
 *     見込み（3月ごろ）: 直近3か月の確定分 → このままだと等級が上がる人・回数の手当が無ければ等級が変わる人・境目まであと少しの人
 * ・画面の手直し（特定適用事業所か・外す手当・倍率・日数・遡及の額）は保存しない（仮置き・閉じると消える）
 * ・個人情報: 読んだ明細・名前・金額はこのファイルのメモリの中だけ。端末に残さない・console に出さない。覆い・10分で金額を隠す時は reset() で全部捨てる
 * ★試験・見本は架空の職員と架空の金額だけ（check/payroll_santei_e2e.mjs）
 */
(function (root) {
  'use strict';
  var VERSION = 'santei-ui-2026-11-26';
  var S = { gen: 0, mode: 'teiji', year: null, base: null, data: null, loading: null, err: null, special: false, nearK: null, cc: null, ov: {}, busy: false, applied: null };

  function ZJ() { var z = root && root.PayrollZuiji; return z && typeof z.judge === 'function' ? z : null; }
  function ST() { var s = root && root.PayrollSantei; return s && typeof s.compute === 'function' ? s : null; }
  function R() { return root && root.PayrollRates || null; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function isYm(v) { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }
  function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }
  function el(id) { return document.getElementById(id); }
  function mj(ym) { return isYm(ym) ? +ym.slice(5, 7) + '月' : ''; }
  function ymJa(ym) { return isYm(ym) ? ym.slice(0, 4) + '年' + mj(ym) : ''; }
  function reset() { S.gen++; S.data = null; S.loading = null; S.err = null; S.ov = {}; S.busy = false; S.applied = null; S.plan = null; S.edit = null; }
  function dirty() { return Object.keys(S.ov).length > 0; }

  function yearOf(ctx) { if (S.year) return S.year; var y = isYm(ctx.ym) ? +ctx.ym.slice(0, 4) : new Date().getFullYear(); return y; }
  function baseOf(ctx) { return isYm(S.base) ? S.base : (isYm(ctx.ym) ? ctx.ym : null); }
  function siMonth(ctx) { var c = obj(ctx.bs && ctx.bs.settings && ctx.bs.settings.config); return c.si_month === 'current' ? 'current' : 'next'; }

  /* ── 読む ── */
  function wantYms(ctx) {
    var s = ST(); if (!s) return [];
    if (S.mode === 'teiji') { var y = yearOf(ctx); return [y + '-03', y + '-04', y + '-05', y + '-06', y + '-07']; }
    var b = baseOf(ctx); if (!b) return [];
    /* 随時改定: 表示中の月分までの9か月分（変わった月分の前の月分と、その後の3か月の支給を見るため）と、その先の3か月分（改定の前の額・もう変えたかを版で見るため） */
    if (S.mode === 'zuiji') { var z = []; for (var i = -8; i <= 3; i++) z.push(s.ymAdd(b, i)); return z; }
    return [s.ymAdd(b, -4), s.ymAdd(b, -3), s.ymAdd(b, -2), s.ymAdd(b, -1), b];
  }
  function key(ctx) { return S.mode + ':' + (S.mode === 'teiji' ? yearOf(ctx) : baseOf(ctx)); }
  function ensure(ctx) {
    var k = key(ctx);
    if ((S.data && S.data.key === k) || S.loading === k) return;
    var my = S.gen, yms = wantYms(ctx); S.loading = k; S.err = null;
    Promise.all(yms.map(function (ym) { return ctx.rpc('payroll_bootstrap', { p_ym: ym }).then(function (r) { return r && r.ok !== false ? r : null; }); })).then(function (boots) {
      if (my !== S.gen) return;
      S.loading = null;
      S.data = { key: k, boots: boots.filter(Boolean) };
      if (!S.data.boots.length) S.err = '給与のデータを読めませんでした。「読み直す」を押してください。';
      ctx.paint();
    }, function (e) {
      if (my !== S.gen) return;
      S.loading = null; S.data = { key: k, boots: [] }; S.err = '読めませんでした。「読み直す」を押してください。';
      ctx.paint();
      if (ctx.fail) ctx.fail(e, '定時決定の読み込み');
    });
  }
  function reload(ctx) { S.gen++; S.data = null; S.loading = null; S.err = null; S.applied = null; ensure(ctx); ctx.paint(); }

  /* 読んだ明細から窓の月と結果を作る（手直しは S.ov・設定は S.special・S.cc・S.nearK） */
  function defsOf() { var b = S.data && S.data.boots[S.data.boots.length - 1]; return arr(b && b.allowances).filter(function (a) { return a && a.code && obj(a.def).sec !== 'deduct'; }); }
  function ccOf() {
    if (S.cc) return S.cc;
    var s = ST(), o = {}; defsOf().forEach(function (a) { if (s.DEFAULTS.countCalcs.indexOf(obj(a.def).calc) >= 0) o[a.code] = true; });
    return o;
  }
  function confirmedPayMonths() {
    var out = {};
    arr(S.data && S.data.boots).forEach(function (b) {
      var st = b.run && b.run.status; if (st !== 'confirmed' && st !== 'exported') return;
      arr(b.items).forEach(function (it) { var p = obj(it && it.frozen).pay_date; if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p)) out[p.slice(0, 7)] = 1; });
    });
    return Object.keys(out).sort();
  }
  function result(ctx) {
    var s = ST(); if (!s || !S.data) return null;
    if (S.mode === 'zuiji') {
      var z = ZJ(); if (!z) return null;
      var bz = baseOf(ctx), zr = z.judge({ boots: S.data.boots, opts: { special: S.special, siMonth: siMonth(ctx) }, overrides: S.ov, fromYm: bz ? s.ymAdd(bz, -7) : null, toYm: bz });
      zr.mode = 'zuiji'; zr.base = bz;
      return zr;
    }
    var months, applyYm, latest = null;
    if (S.mode === 'teiji') { months = s.teijiMonths(yearOf(ctx)); applyYm = yearOf(ctx) + '-09'; }
    else {
      var b = baseOf(ctx), cp = confirmedPayMonths().filter(function (m) { return b && m <= b; });
      latest = cp.length ? cp[cp.length - 1] : null;
      months = latest ? s.forecastMonths(latest) : [];
      applyYm = latest ? s.forecastApplyYm(latest) : null;
    }
    var cc = ccOf();
    /* 従前の版: 翌月徴収は7月分（6月分の保険料）・当月徴収は6月分の期首の版（7月の随時改定を「今」に混ぜない）。見込みは一番新しい版 */
    var curYm = S.mode === 'teiji' ? yearOf(ctx) + (siMonth(ctx) === 'current' ? '-06' : '-07') : null;
    var src = s.fromItems({ payMonths: months, boots: S.data.boots, countCodes: Object.keys(cc).length ? cc : { __none__: false }, opts: { special: S.special }, overrides: S.ov, curYm: curYm });
    var res = s.compute({ mode: S.mode, year: S.mode === 'teiji' ? yearOf(ctx) : null, applyYm: applyYm, people: src.people, special: S.special, nearK: S.nearK === null ? s.DEFAULTS.nearK : S.nearK });
    res.months = months; res.latest = latest; res.srcWarns = src.warns;
    return res;
  }

  /* ── 描く ── */
  var TAG = { ok: '<span class="tag ok">算定</span>', keep: '<span class="tag">従前のまま</span>', review: '<span class="tag warn">要確認</span>', out: '<span class="tag">対象外</span>' };
  function stdTxt(ctx, g) { return g ? ctx.esc(g.grade) + '等級 ' + ctx.esc(ctx.yen(g.std)) : '—'; }
  function html(ctx) {
    var esc = ctx.esc, s = ST();
    var h = '<div class="cd"><h2>定時決定（算定基礎届）</h2>';
    if (!s || !R()) return h + '<div class="band ng" role="alert">計算の部品が読み込めていません。ページを読み込み直してください。直らない時は管理者に知らせてください。</div></div>';
    h += '<div class="row" role="radiogroup" aria-label="使い方">' +
      '<label><input type="radio" name="st-mode" id="st-mode-teiji" value="teiji"' + (S.mode === 'teiji' ? ' checked' : '') + '> 定時決定（4〜6月に支給した分）</label>' +
      '<label><input type="radio" name="st-mode" id="st-mode-fc" value="forecast"' + (S.mode === 'forecast' ? ' checked' : '') + '> 見込み（直近3か月の確定分）</label>' +
      '<label><input type="radio" name="st-mode" id="st-mode-zj" value="zuiji"' + (S.mode === 'zuiji' ? ' checked' : '') + '> 随時改定（固定的賃金が変わった人）</label></div>';
    if (S.mode === 'teiji') {
      var y0 = isYm(ctx.ym) ? +ctx.ym.slice(0, 4) : yearOf(ctx), yy = yearOf(ctx);
      h += '<div class="row"><label for="st-year">年</label><select id="st-year">';
      [y0 - 1, y0, y0 + 1].forEach(function (y) { h += '<option value="' + esc(y) + '"' + (y === yy ? ' selected' : '') + '>' + esc(y) + '年</option>'; });
      h += '</select><button type="button" class="btn" data-act="st-reload">読み直す</button></div>' +
        '<p class="help">' + esc(yy) + '年4・5・6月に支給した確定済みの給与（支給日で選びます）から報酬月額を出し、' + esc(yy) + '年9月分からの等級を決めます。算定基礎届は7月1日〜10日に出します。</p>';
    } else if (S.mode === 'zuiji') {
      h += '<div class="row"><span>' + esc(ymJa(baseOf(ctx))) + '分までの9か月分で見ます（上の月分を変えると窓も変わります）</span><button type="button" class="btn" data-act="st-reload">読み直す</button></div>' +
        '<p class="help">基本給・時給・日給・役員報酬・通勤手当・固定的賃金の印の手当（回数の手当は単価）・時給の人の1日の所定時間が変わった人を探し、変わった額を初めて払った月から3か月の報酬で、2等級以上変わるかを見ます。当てはまる人は月額変更届を出し、4か月目の分から等級を変えます。</p>';
      if (!ZJ()) return h + '<div class="band ng" role="alert">随時改定の部品が読み込めていません。ページを読み込み直してください。</div></div>';
    } else {
      h += '<div class="row"><span>' + esc(ymJa(baseOf(ctx))) + '分までの確定分で見ます（上の月分を変えると窓も変わります）</span><button type="button" class="btn" data-act="st-reload">読み直す</button></div>' +
        '<p class="help">このままの勤務が続いた時の、次の9月分からの等級の見込みです。シフトを組む前（3月ごろ）に見ると、4〜6月の日曜・夜勤の回数で等級が上がる人が分かります。</p>';
    }
    ensure(ctx);
    if (!S.data || S.data.key !== key(ctx)) return h + '<div aria-busy="true"><span class="skel w8"></span><span class="skel w6"></span></div></div>';
    if (S.err) return h + '<div class="band ng" role="alert">' + esc(S.err) + '</div></div>';
    var res = result(ctx);
    h += optsHtml(ctx) + '</div>';
    if (!res) return h;
    if (S.mode === 'zuiji') return h + zjHtml(ctx, res);
    if (S.mode === 'forecast' && !res.latest) return h + '<div class="cd"><div class="band warn">確定した給与がまだありません。確定してから見てください。</div></div>';
    h += sumHtml(ctx, res) + tableHtml(ctx, res);
    if (S.mode === 'teiji') h += applyHtml(ctx, res);
    return h;
  }
  function optsHtml(ctx) {
    var esc = ctx.esc, s = ST(), cc = ccOf(), defs = defsOf(), k = S.nearK === null ? s.DEFAULTS.nearK : S.nearK;
    var cur = el('st-opts'), open = cur ? cur.open : false;   /* 描き直しても開いたまま（設定を変えるたびに閉じない） */
    var h = '<details class="cd" id="st-opts"' + (open ? ' open' : '') + '><summary>数え方の設定（この画面の中だけ・保存しません）</summary>' +
      '<div class="row"><label><input type="checkbox" id="st-special"' + (S.special ? ' checked' : '') + '> 特定適用事業所（短時間労働者は支払基礎日数11日以上の月で数える）</label></div>' +
      '<p class="help">入れると、各人の「直す」で短時間労働者の印を付けられます。切の時は、時給・日給の人を「パート」（17日以上の月が無ければ15日以上の月）で数えます。</p>' +
      '<fieldset><legend>回数で変わる手当（「手当なし」の平均から外す物）</legend>';
    if (!defs.length) h += '<p class="help">手当の定義がありません。</p>';
    defs.forEach(function (a, i) {
      var d = obj(a.def);
      h += '<label class="chk"><input type="checkbox" id="st-cc-' + esc(i) + '" data-st-cc="' + esc(a.code) + '"' + (cc[a.code] ? ' checked' : '') + '> ' + esc(d.name || a.code) + '</label> ';
    });
    h += '</fieldset><div class="row"><label for="st-k">「あと少し」の倍率</label><input id="st-k" type="number" inputmode="decimal" min="0" max="10" step="0.5" value="' + esc(k) + '" style="width:6em">' +
      '<span class="help">手当なしの平均から次の境目までが、回数の手当の月平均のこの倍以下の人に印を付けます（2＝回数が今の2倍になると越える）。</span></div></details>';
    return h;
  }
  function sumHtml(ctx, res) {
    var esc = ctx.esc, c = res.counts, wm = res.months.map(mj).join('・');
    var h = '<div class="cd"><h2>' + (S.mode === 'teiji' ? esc(res.year) + '年の定時決定' : '見込み（' + esc(wm) + 'に支給した分・' + esc(ymJa(res.applyYm)) + '分から）') + '</h2>';
    h += '<div class="sumbar"><div>人数<b>' + esc(c.all - c.out) + ' 人</b></div><div>等級が変わる<b>' + esc(c.change) + ' 人</b></div><div>上がる／下がる<b>' + esc(c.up) + '／' + esc(c.down) + '</b></div>' +
      '<div>2等級以上の差<b>' + esc(c.big) + ' 人</b></div><div>回数の手当が無ければ変わる<b>' + esc(c.byCount) + ' 人</b></div><div>境目まであと少し<b>' + esc(c.near) + ' 人</b></div>' +
      '<div>要確認<b>' + esc(c.review || 0) + ' 人</b></div></div>';
    if (c.review) h += '<div class="band warn">要確認の人がいます。行の「直す」で日数・遡及の額を確かめてください。</div>';
    arr(res.srcWarns).forEach(function (w) { h += '<div class="band warn" role="status">' + esc(w.msg) + '</div>'; });
    var noRun = res.months.filter(function (m) { return res.people.some(function (p) { return p.months.some(function (x) { return x.ym === m && x.warns.some(function (w) { return w.code === 'run_missing'; }); }); }); });
    if (noRun.length) h += '<div class="band warn" role="status">' + esc(noRun.map(mj).join('・')) + 'に支給した給与が画面にありません。その月の給与を確定してから「読み直す」を押してください。</div>';
    h += '<div class="row"><button type="button" class="btn" data-act="st-csv">' + (S.mode === 'teiji' ? '算定基礎届の控え（CSV）' : '見込みの一覧（CSV）') + '</button></div>' +
      '<p class="help">CSV には氏名と金額が入ります。届を書き終えたら、Finder の「ダウンロード」でそのファイルを選び、ごみ箱へ入れて「ごみ箱を空にする」まで行ってください。メール・チャット・共有のフォルダには入れないでください。</p></div>';
    return h;
  }
  function tableHtml(ctx, res) {
    var esc = ctx.esc, yen = ctx.yen, s = ST();
    var h = '<div class="cd"><div class="tw"><table class="st-t"><thead><tr><th>番号</th><th>氏名</th><th>区分</th>';
    res.months.forEach(function (m) { h += '<th class="num">' + esc(mj(m)) + '<br><span class="help">日数・報酬</span></th>'; });
    h += '<th class="num">平均</th><th>健保 今→新</th><th>厚年 今→新</th><th class="num">差</th><th>回数の手当なし</th><th class="num">次の境目まで</th><th></th><th>状態</th></tr></thead><tbody>';
    res.people.forEach(function (p) {
      var cls = p.status === 'out' ? ' class="out"' : '';
      h += '<tr' + cls + '><td>' + esc(p.code) + '</td><td>' + esc(p.name) + '</td><td>' + esc(s.KIND_JA[p.kind]) + (p.status !== 'out' ? '<br><span class="help">' + esc(p.rule) + '日以上</span>' : '') + '</td>';
      p.months.forEach(function (m) {
        var mark = m.use ? '✓' : (m.why ? esc(m.why) : '');
        h += '<td class="num">' + (m.days !== null && m.days !== undefined ? esc(m.days) + '日' : '') + (m.why === '支給なし' ? '' : '<br>' + esc(yen(m.pay))) + (m.retro ? '<br><span class="help">遡及 ' + esc(yen(m.retro)) + '</span>' : '') + '<br><span class="help">' + mark + '</span></td>';
      });
      if (p.status === 'out') { h += '<td colspan="6">' + esc(p.reason) + '</td><td></td><td class="why">' + TAG.out + '</td></tr>'; return; }
      var nx = p.next || {}, nc = p.noCount, ed = p.edge;
      h += '<td class="num">' + (p.avg === null ? '—' : esc(yen(p.avg))) + (p.avgMod !== null ? '<br><span class="help">修正平均</span>' : '') + '</td>' +
        '<td>' + stdTxt(ctx, p.cur.health) + '<br>→ ' + stdTxt(ctx, nx.health) + '</td>' +
        '<td>' + stdTxt(ctx, p.cur.pension) + '<br>→ ' + stdTxt(ctx, nx.pension) + '</td>' +
        '<td class="num">' + (p.diff === null ? '—' : esc((p.diff > 0 ? '+' : '') + p.diff)) + (p.big ? '<br><span class="tag warn">2等級以上</span>' : '') + '</td>' +
        '<td>' + (nc && nc.health ? esc(nc.health.grade) + '等級（' + esc(yen(nc.avg)) + '）' + (nc.differs ? '<br><span class="tag warn">手当で等級が変わる</span>' : '') : '—') + '</td>' +
        '<td class="num">' + (ed && ed.toNext !== null ? esc(yen(ed.toNext)) : '—') + (ed && ed.near ? '<br><span class="tag warn">あと少し</span>' : '') + '</td>' +
        '<td><button type="button" class="btn" data-act="st-edit" data-sid="' + esc(p.staff_id) + '" aria-label="' + esc(p.name) + ' さんの日数・遡及を直す">直す</button></td>' +
        '<td class="why">' + (TAG[p.status] || '') + (p.reason ? '<br><span class="help">' + esc(p.reason) + '</span>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="help">報酬＝支給のうち社会保険の対象（通勤手当・残業代・回数の手当を含む。社会保険の対象外の手当と非課税の調整は除く）。賞与は入りません。' +
      '支払基礎日数は、月給＝期間の暦日数、時給・日給＝出勤＋有休。欠勤のある月給の月は「出勤＋有休」で数えて要確認にします（決まりは所定労働日数−欠勤日数）。平均は円未満を切り捨てます。</p></div>';
    return h;
  }

  /* ── 随時改定（payroll-zuiji.js）の一覧と、1人ずつ等級を変える ── */
  var ZTAG = { hit: '<span class="tag warn">随時改定</span>', wait: '<span class="tag">待ち</span>', no: '<span class="tag">対象外</span>', review: '<span class="tag warn">要確認</span>', done: '<span class="tag ok">変えた</span>' };
  function chgTxt(ctx, c) {
    function v(x) { return x === null || x === undefined ? 'なし' : typeof x === 'number' ? (c.unit === '円' ? ctx.yen(x) + '円' : String(x) + (c.unit || '')) : String(x); }
    if (c.unit === '' && typeof c.from !== 'string' && typeof c.to !== 'string') return ctx.esc(c.label + ' ' + (c.from === null ? '新しく付いた' : '無くなった'));
    return ctx.esc(c.label + ' ' + v(c.from) + '→' + v(c.to));
  }
  function zjHtml(ctx, res) {
    var esc = ctx.esc, yen = ctx.yen, c = res.counts;
    var h = '<div class="cd"><h2>随時改定（' + esc(ymJa(res.base)) + '分までの9か月分）</h2>';
    h += '<div class="sumbar"><div>固定的賃金が変わった<b>' + esc(c.all) + ' 件</b></div><div>随時改定<b>' + esc(c.hit || 0) + ' 件</b></div><div>要確認<b>' + esc(c.review || 0) + ' 件</b></div>' +
      '<div>3か月の給与を待つ<b>' + esc(c.wait || 0) + ' 件</b></div><div>対象外<b>' + esc(c.no || 0) + ' 件</b></div><div>変えた<b>' + esc(c.done || 0) + ' 件</b></div></div>';
    arr(res.warns).forEach(function (w) { h += '<div class="band warn" role="status">' + esc(w.msg) + '</div>'; });
    if (c.review) h += '<div class="band warn">要確認の行があります。理由を読み、遡及の差額があれば「直す」で額を入れてください。上がった物と下がった物が同時の時・給与の形が変わった時・等級表の端の時は、年金事務所の案内で確かめてから「職員の給与設定」で直してください。</div>';
    if (S.applied) h += '<div class="band ' + (S.applied.ng ? 'warn' : 'ok') + '" role="status">' + esc(S.applied.msg) + '</div>';
    if (!res.people.length) return h + '<p class="help">この9か月に固定的賃金が変わった人はいません。</p></div>';
    h += '<div class="tw"><table class="st-t"><thead><tr><th>番号</th><th>氏名</th><th>変わった月分</th><th>変わった物</th><th>起算の月</th>' +
      '<th class="num">1か月目</th><th class="num">2か月目</th><th class="num">3か月目</th><th class="num">平均</th><th>健保 今→新</th><th>厚年 今→新</th><th>改定</th><th></th><th>状態</th></tr></thead><tbody>';
    res.people.forEach(function (p) {
      h += '<tr' + (p.status === 'no' ? ' class="out"' : '') + '><td>' + esc(p.code) + '</td><td>' + esc(p.name) + '</td><td>' + esc(ymJa(p.changeYm)) + '分</td>' +
        '<td>' + p.changes.map(function (x) { return chgTxt(ctx, x); }).join('<br>') + '</td><td>' + esc(ymJa(p.start)) + '支給</td>';
      p.months.forEach(function (m) {
        h += '<td class="num">' + esc(mj(m.ym)) + (m.days !== null && m.days !== undefined ? '<br>' + esc(m.days) + '日' : '') + (m.why === '支給なし' ? '' : '<br>' + esc(yen(m.pay))) +
          (m.retro ? '<br><span class="help">遡及 ' + esc(yen(m.retro)) + '</span>' : '') + (m.why ? '<br><span class="help">' + esc(m.why) + '</span>' : '') + '</td>';
      });
      var nx = p.next || {};
      h += '<td class="num">' + (p.avg === null ? '—' : esc(yen(p.avg))) + '</td>' +
        '<td>' + stdTxt(ctx, p.cur.health) + '<br>→ ' + stdTxt(ctx, nx.health) + (p.diffH !== null ? '<br><span class="help">' + esc((p.diffH > 0 ? '+' : '') + p.diffH) + '等級</span>' : '') + '</td>' +
        '<td>' + stdTxt(ctx, p.cur.pension) + '<br>→ ' + stdTxt(ctx, nx.pension) + (p.diffP !== null ? '<br><span class="help">' + esc((p.diffP > 0 ? '+' : '') + p.diffP) + '等級</span>' : '') + '</td>' +
        '<td>' + esc(ymJa(p.applyYm)) + '分から</td>' +
        '<td><button type="button" class="btn" data-act="st-edit" data-sid="' + esc(p.staff_id) + '" data-ym="' + esc(p.changeYm) + '" aria-label="' + esc(p.name) + ' さんの日数・遡及を直す">直す</button>' +
        (p.status === 'hit' ? '<br><button type="button" class="btn pri" data-act="st-zj-apply" data-sid="' + esc(p.staff_id) + '" data-ym="' + esc(p.changeYm) + '"' + (S.busy ? ' disabled' : '') + ' aria-label="' + esc(p.name) + ' さんの等級を変える">等級を変える…</button>' : '') + '</td>' +
        '<td class="why">' + (ZTAG[p.status] || '') + (p.reason ? '<br><span class="help">' + esc(p.reason) + '</span>' : '') +
        p.warns.filter(function (w) { return w.msg !== p.reason; }).map(function (w) { return '<br><span class="help">' + esc(w.msg) + '</span>'; }).join('') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="help">報酬は定時決定と同じ数え方です（社会保険の対象の支給・賞与は入らない）。支払基礎日数は3か月とも17日以上（特定適用事業所の短時間労働者は11日以上）が要ります。固定的賃金が上がったのに等級が下がった時（その逆も）は対象外です。' +
      '確定した月分は、その時に払った明細の額で比べます。月額変更届は年金事務所へ速やかに出し、決定通知書の額で「等級を変える」の窓の額を確かめてください。</p></div>';
    return h;
  }
  function zjApply(ctx, sid, ym) {
    var res = result(ctx); if (!res || res.mode !== 'zuiji') return;
    var p = res.people.filter(function (x) { return x.staff_id === sid && x.changeYm === ym && x.status === 'hit'; })[0]; if (!p) return;
    openApply(ctx, { mode: 'zuiji', applyYm: p.applyYm, year: null,
      people: [{ staff_id: p.staff_id, code: p.code, name: p.name, status: 'ok', change: true, cur: p.cur, next: p.next }] });
  }

  /* ── 9月分から等級を変える ── */
  function applyInfo(ctx, res) {
    var s = ST(), runYm = s.applyRunYm(res.applyYm, siMonth(ctx)), prev = runYm ? s.ymAdd(runYm, -1) : null;
    return { runYm: runYm, prev: prev };
  }
  function applyHtml(ctx, res) {
    var esc = ctx.esc, a = applyInfo(ctx, res), list = res.people.filter(function (p) { return p.status !== 'out' && p.change; });
    var h = '<div class="cd"><h2>' + esc(ymJa(res.applyYm)) + '分から等級を変える</h2>' +
      '<p class="help">保険料の対象月 ' + esc(ymJa(res.applyYm)) + '分を引くのは ' + esc(ymJa(a.runYm)) + '分の給与です（' + (siMonth(ctx) === 'current' ? '当月徴収' : '翌月徴収') + '）。' +
      esc(ymJa(a.runYm)) + '分の期間の初日から効く設定の版を作り、健康保険と厚生年金の標準報酬月額だけを差し替えます。ほかの設定は、その日に効いている版のまま写します。</p>' +
      '<p class="help">' + esc(ymJa(a.prev)) + '分の給与を確定した後に押してください（先に作ると、その後に入れた昇給などが元に戻るため）。決定通知書の額と違う時は、窓の中で直せます。</p>';
    if (S.applied) h += '<div class="band ' + (S.applied.ng ? 'warn' : 'ok') + '" role="status">' + esc(S.applied.msg) + '</div>';
    h += '<button type="button" class="btn pri" data-act="st-apply"' + (list.length && !S.busy ? '' : ' disabled') + '>' + esc(list.length) + '人の等級を変える…</button></div>';
    return h;
  }
  function openApply(ctx, given) {
    var res = given || result(ctx); if (!res || S.busy) return;
    var zj = res.mode === 'zuiji', label = zj ? '随時改定' : '定時決定';
    var a = applyInfo(ctx, res), my = S.gen;
    S.busy = true; ctx.paint();
    Promise.all([ctx.rpc('payroll_bootstrap', { p_ym: a.prev }), ctx.rpc('payroll_bootstrap', { p_ym: a.runYm })]).then(function (bb) {
      S.busy = false;
      if (my !== S.gen) return;
      var bp = bb[0], br = bb[1];
      if (!bp || bp.ok === false || !br || br.ok === false) { ctx.say('給与の設定を読めませんでした。「読み直す」を押してからもう一度行ってください。'); ctx.paint(); return; }
      var st = bp.run && bp.run.status;
      if (st !== 'confirmed' && st !== 'exported') { ctx.say(ymJa(a.prev) + '分の給与がまだ確定していません。確定してから押してください（先に版を作ると、その後に入れた設定が' + ymJa(a.runYm) + '分から元に戻ります）。'); ctx.paint(); return; }
      var st2 = br.run && br.run.status;
      if (st2 === 'confirmed' || st2 === 'exported') { ctx.say(ymJa(a.runYm) + '分の給与はもう確定しています。等級を変えても確定した明細の保険料は変わりません。管理者が' + ymJa(a.runYm) + '分の確定を取り消してから押すか、「職員の給与設定」で直して差額を調整で引いてください。'); ctx.paint(); return; }
      var from = br.period && br.period.from, plan = [], skip = [];
      var profs = {}; arr(br.profiles).forEach(function (p) { if (p && p.staff_id) profs[p.staff_id] = p; });
      res.people.forEach(function (p) {
        if (p.status === 'out' || !p.change) return;
        var pr = profs[p.staff_id], d = obj(pr && pr.data), ins = obj(d.ins), h0 = obj(ins.health), p0 = obj(ins.pension);
        if (p.status !== 'ok') { skip.push({ p: p, why: p.status === 'keep' ? '従前のまま' : '要確認（' + p.reason + '）' }); return; }
        if (!pr || !from) { skip.push({ p: p, why: '給与の設定がありません' }); return; }
        if (arr(pr.versions).some(function (v) { return v.effective_from > from; })) { skip.push({ p: p, why: ymJa(a.runYm) + '分より後の版があります（手で直してください）' }); return; }
        var curH = p.cur.health ? p.cur.health.std : 0, curP = p.cur.pension ? p.cur.pension.std : 0;
        if (Number(h0.std || 0) !== curH || (p0.on === true && Number(p0.std || 0) !== curP)) { skip.push({ p: p, why: zj ? '変わった後に標準報酬が変わっています（もう変えたか・定時決定と重なっていないか手で確かめてください）' : '7月より後に標準報酬が変わっています（随時改定のおそれ・手で確かめてください）' }); return; }
        plan.push({ p: p, prof: pr, health: p.next.health.std, pension: p0.on === true && p.next.pension ? p.next.pension.std : null, pOn: p0.on === true });
      });
      S.plan = { runYm: a.runYm, from: from, list: plan, applyYm: res.applyYm, year: res.year, label: label };
      var esc = ctx.esc, yen = ctx.yen;
      var body = '<p>' + esc(ymJa(a.runYm)) + '分（' + esc(from) + 'から）の設定の版を作り、標準報酬月額を変えます。額は決定通知書と照らしてください。</p>';
      if (plan.length) {
        body += '<div class="tw"><table><thead><tr><th>番号</th><th>氏名</th><th>健康保険</th><th>厚生年金</th></tr></thead><tbody>';
        plan.forEach(function (x, i) {
          body += '<tr><td>' + esc(x.p.code) + '</td><td>' + esc(x.p.name) + '</td>' +
            '<td>' + esc(yen(x.p.cur.health ? x.p.cur.health.std : 0)) + ' → <input id="st-ah-' + i + '" type="number" inputmode="numeric" value="' + esc(x.health) + '" aria-label="' + esc(x.p.name) + ' さんの新しい健康保険の標準報酬月額" style="width:8em"></td>' +
            '<td>' + (x.pOn ? esc(yen(x.p.cur.pension ? x.p.cur.pension.std : 0)) + ' → <input id="st-ap-' + i + '" type="number" inputmode="numeric" value="' + esc(x.pension) + '" aria-label="' + esc(x.p.name) + ' さんの新しい厚生年金の標準報酬月額" style="width:8em">' : '加入なし') + '</td></tr>';
        });
        body += '</tbody></table></div>';
      } else body += '<div class="band warn">自動で変えられる人がいません。</div>';
      if (skip.length) body += '<h3 style="font-size:16px">変えない人（' + esc(skip.length) + '）</h3><ul>' + skip.map(function (x) { return '<li>' + esc(x.p.code + ' ' + x.p.name) + '：' + esc(x.why) + '</li>'; }).join('') + '</ul>';
      ctx.openDlg('等級を変える（' + ymJa(res.applyYm) + '分から）', body,
        '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="st-apply-go"' + (plan.length ? '' : ' disabled') + '>' + esc(plan.length) + '人を変える</button>');
      ctx.paint();
    }, function (e) { S.busy = false; if (my !== S.gen) return; ctx.paint(); if (ctx.fail) ctx.fail(e, label + 'の反映の準備'); });
  }
  function applyGo(ctx, btn) {
    var pl = S.plan, Rt = R(); if (!pl || S.busy || !Rt) return;
    var bad = [], jobs = [];
    pl.list.forEach(function (x, i) {
      var h = num(el('st-ah-' + i) && el('st-ah-' + i).value), pe = x.pOn ? num(el('st-ap-' + i) && el('st-ap-' + i).value) : null;
      if (h === null || !Rt.isStd('health', h)) bad.push(x.p.name + ' さんの健康保険');
      if (x.pOn && (pe === null || !Rt.isStd('pension', pe, pl.applyYm))) bad.push(x.p.name + ' さんの厚生年金');
      var d = JSON.parse(JSON.stringify(obj(x.prof.data))); d.ins = obj(d.ins); d.ins.health = obj(d.ins.health); d.ins.health.std = h;
      if (x.pOn) { d.ins.pension = obj(d.ins.pension); d.ins.pension.std = pe; }
      var same = x.prof.effective_from === pl.from;
      jobs.push({ x: x, data: d, rev: same ? Number(x.prof.rev) || 0 : 0, reason: (pl.label === '随時改定' ? '随時改定: ' + pl.applyYm.slice(0, 4) + '年' : '定時決定 ' + pl.year + '年: ') + mj(pl.applyYm) + '分から 健保 ' + (x.p.cur.health ? x.p.cur.health.std : 0) + '→' + h + (x.pOn ? '・厚年 ' + (x.p.cur.pension ? x.p.cur.pension.std : 0) + '→' + pe : '') });
    });
    if (bad.length) { ctx.say('等級表に無い額です: ' + bad.join('・')); return; }
    S.busy = true; if (btn) { btn.disabled = true; btn.textContent = '送っています…'; }
    var my = S.gen, okN = 0, ng = [];
    jobs.reduce(function (pr, j) {
      return pr.then(function () {
        /* 送り始めた後は、金額を隠す覆いがかかっても最後まで送る（途中で止めると、変えた人と変えていない人が混ざったまま知らせが出ない） */
        return ctx.rpc('payroll_profile_put', { p_staff_id: j.x.p.staff_id, p_effective_from: pl.from, p_data: j.data, p_rev: j.rev, p_reason: j.reason.slice(0, 200) }).then(function (r) {
          if (r && r.ok === true) okN++; else ng.push(j.x.p.name + '（' + String(r && r.error || 'ng') + '）');
        }, function (e) { ng.push(j.x.p.name + '（送れませんでした）'); if (ctx.note) ctx.note('定時決定の反映', e); });
      });
    }, Promise.resolve()).then(function () {
      S.busy = false; S.plan = null;
      if (my !== S.gen) { ctx.toast((pl.label || '定時決定') + ': ' + okN + '人の等級を変えました' + (ng.length ? '・' + ng.length + '人は変えられませんでした（「職員の給与設定」で確かめてください）' : '')); return; }   /* 覆いの間は名前を出さない */
      ctx.closeDlg();
      S.applied = { ng: ng.length > 0, msg: okN + '人の等級を ' + ymJa(pl.runYm) + '分の設定の版で変えました。' + (ng.length ? '変えられなかった人: ' + ng.join('・') + '（「職員の給与設定」で確かめてください）' : '') };
      if (ctx.reloadMain) ctx.reloadMain();
      ctx.paint();
    });
  }

  /* ── 人ごとの手直し（保存しない） ── */
  function openEdit(ctx, sid, cym) {
    var res = result(ctx); if (!res) return;
    var zj = res.mode === 'zuiji';
    /* 随時改定は同じ人に2件の変動があり得るので、変わった月分（data-ym）でも引く */
    var p = res.people.filter(function (x) { return x.staff_id === sid && (!zj || !cym || x.changeYm === cym); })[0]; if (!p) return;
    var esc = ctx.esc, yen = ctx.yen, o = obj(S.ov[sid]), mo = obj(o.months);
    var body = '<p>' + esc(p.code + ' ' + p.name) + ' さん（この画面の中だけ・保存しません）</p>';
    if (S.special) body += '<label><input type="checkbox" id="st-e-short"' + (o.short ? ' checked' : '') + '> 短時間労働者（4分の3未満で加入・支払基礎日数11日以上の月で数える）</label>';
    /* 随時改定は3か月とも要るので「外す」を出さない・遡及は昇給の差額 */
    body += '<div class="tw"><table><thead><tr><th>支給の月</th><th>報酬</th><th>支払基礎日数</th><th>' + (zj ? '遡及の差額（前の月の分）' : '遡及の額（3月以前の分）') + '</th>' + (zj ? '' : '<th>外す</th>') + '</tr></thead><tbody>';
    p.months.forEach(function (m, i) {
      var x = obj(mo[m.ym]);
      body += '<tr><td>' + esc(ymJa(m.ym)) + (m.daysNote ? '<br><span class="help">' + esc(m.daysNote) + '</span>' : '') + '</td><td class="num">' + esc(m.why === '支給なし' ? '—' : yen(m.pay)) + '</td>' +
        '<td><input id="st-e-d' + i + '" type="number" inputmode="numeric" min="0" max="31" value="' + esc(num(x.days) !== null ? x.days : (m.days === null || m.days === undefined ? '' : m.days)) + '" aria-label="' + esc(mj(m.ym)) + 'の支払基礎日数" style="width:5em"></td>' +
        '<td><input id="st-e-r' + i + '" type="number" inputmode="numeric" min="0" value="' + esc(num(x.retro) !== null ? x.retro : '') + '" aria-label="' + esc(mj(m.ym)) + 'の遡及の額" style="width:8em"></td>' +
        (zj ? '' : '<td><input type="checkbox" id="st-e-x' + i + '"' + (x.excluded ? ' checked' : '') + ' aria-label="' + esc(mj(m.ym)) + 'を平均から外す"></td>') + '</tr>';
    });
    body += '</tbody></table></div>';
    if (p.warns.length) body += '<ul>' + p.warns.map(function (w) { return '<li>' + esc(w.msg) + '</li>'; }).join('') + '</ul>';
    body += '<label><input type="checkbox" id="st-e-ack"' + (o.ackAdj ? ' checked' : '') + '> その月だけの支給の調整は遡及ではない・同じ月の2回の支給も確かめた</label><p class="help">2回の支給の月は、支払基礎日数を直しても確かめたことになります。</p>';
    S.edit = { sid: sid, months: p.months.map(function (m) { var x = obj(mo[m.ym]); return { ym: m.ym, days: m.days, had: num(x.days) !== null }; }) };
    ctx.openDlg('日数・遡及を直す', body, '<button type="button" class="btn" data-act="st-edit-clear">元に戻す</button><button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="st-edit-go">数え直す</button>');
  }
  function editGo(ctx, clear) {
    var e = S.edit; if (!e) return;
    if (clear) delete S.ov[e.sid];
    else {
      var o = { months: {} };
      if (el('st-e-short')) o.short = !!el('st-e-short').checked;
      o.ackAdj = !!(el('st-e-ack') && el('st-e-ack').checked);
      e.months.forEach(function (m, i) {
        var d = num(el('st-e-d' + i) && el('st-e-d' + i).value), r = num(el('st-e-r' + i) && el('st-e-r' + i).value), x = !!(el('st-e-x' + i) && el('st-e-x' + i).checked), z = {};
        if (d !== null && (m.had || d !== m.days) && d >= 0 && d <= 31) z.days = Math.round(d);   /* 前に直した日数は、同じ値のままでも手直しとして残す */
        if (r !== null && r > 0) z.retro = Math.round(r);
        if (x) z.excluded = true;
        if (Object.keys(z).length) o.months[m.ym] = z;
      });
      S.ov[e.sid] = o;
    }
    S.edit = null; ctx.closeDlg(); ctx.paint();
  }

  function doCsv(ctx) {
    var res = result(ctx), s = ST(); if (!res || !s) return;
    var name = S.mode === 'teiji' ? 'santei_' + res.year + '.csv' : 'santei_forecast_' + (res.latest || '') + '.csv';
    ctx.download({ name: name, text: s.csv(res) });
    ctx.toast('CSV を書き出しました（ダウンロードのフォルダ）');
  }

  function onClick(ctx, act, b) {
    var sid = b && b.getAttribute ? b.getAttribute('data-sid') : null;
    if (act === 'st-reload') reload(ctx);
    else if (act === 'st-csv') doCsv(ctx);
    else if (act === 'st-edit') { if (sid) openEdit(ctx, sid, b.getAttribute('data-ym')); }
    else if (act === 'st-edit-go') editGo(ctx, false);
    else if (act === 'st-edit-clear') editGo(ctx, true);
    else if (act === 'st-apply') openApply(ctx);
    else if (act === 'st-zj-apply') { if (sid) zjApply(ctx, sid, b.getAttribute('data-ym')); }
    else if (act === 'st-apply-go') applyGo(ctx, b);
    else return false;
    return true;
  }
  function onChange(ctx, t) {
    var id = t && t.id;
    if (id === 'st-mode-teiji' || id === 'st-mode-fc' || id === 'st-mode-zj') { var m = id === 'st-mode-fc' ? 'forecast' : id === 'st-mode-zj' ? 'zuiji' : 'teiji'; if (m !== S.mode) { S.mode = m; S.applied = null; S.ov = {}; ctx.paint(); } }
    else if (id === 'st-year') { var y = +t.value; if (y >= 2000 && y <= 2100 && y !== yearOf(ctx)) { S.gen++; S.year = y; S.data = null; S.loading = null; S.ov = {}; S.applied = null; ctx.paint(); } }
    else if (id === 'st-special') { S.special = !!t.checked; ctx.paint(); }
    else if (id === 'st-k') { var k = num(t.value); if (k !== null && k >= 0 && k <= 10) { S.nearK = k; ctx.paint(); } }
    else if (t && t.getAttribute && t.getAttribute('data-st-cc') !== null) { var cc = Object.assign({}, ccOf()); var c = t.getAttribute('data-st-cc'); if (t.checked) cc[c] = true; else delete cc[c]; S.cc = cc; ctx.paint(); }
    else return false;
    return true;
  }
  /* 月分を変えた時（見込みの窓は表示中の月分に付いてくる） */
  function onYm() { if (S.mode === 'forecast' || S.mode === 'zuiji') { S.gen++; S.data = null; S.loading = null; S.ov = {}; } }

  var api = { VERSION: VERSION, html: html, onClick: onClick, onChange: onChange, onYm: onYm, reset: reset, dirty: dirty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollSanteiUI = api;
})(typeof window !== 'undefined' ? window : this);
