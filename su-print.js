/* su-print.js — 印刷共通モジュール v0.1（2026-09-12 参考実装）
 *
 * 目的: 各ツールが個別に持っている「@page 動的注入 → 採寸 → 文字サイズで1枚に収める →
 *   afterprint で必ず後始末」を 1 か所にまとめ、用紙・余白・収め方を職員が画面から選べるようにする。
 *   daycare-roster.html の印刷エンジン（PRINT_SPEC / pageAvailPx_ / withPrintMetrics_ / printNow /
 *   beforeprint ガード）を一般化したもの。
 *
 * 設計の要点
 *   1. 文字サイズ（CSS 変数）で収める。zoom / transform:scale は使わない
 *      （レイアウト箱が縮まず PC で余白・分割が起きる／罫線が潰れる、の二重の原因）。
 *   2. 採寸は「@media print の規則を一時的に画面へも適用」して行う（styleSheets の mediaText を
 *      print → print,screen に切替）。各ツールで印刷規則を二重に書き写す必要がなくなる。
 *   3. 用紙幅は mm→px(96dpi) で確定させ、html/body の幅を紙幅に固定してから採寸・印刷する
 *      （画面幅・端末に依存しない＝Mac と Windows で同じ紙面）。
 *   4. 状態は冪等にクリアする。全ての入口（ボタン・Cmd/Ctrl+P）が同じ prepare() を通り、
 *      afterprint 未発火（iOS Safari / PDF出力）でも 3 秒後に必ず片付ける。
 *   5. 個人情報は扱わない。保存するのは「用紙・余白・収め方」の設定だけ（localStorage: su_print_prefs）。
 *
 * 使い方（最小）※タグ表記はコメント内に書かない（inline 化した時に閉じタグと誤認されるため）
 *   head で su-print.css を link し、su-print.js を script で読み込んだ後に:
 *     SUPrint.define('daylist', {
 *       label: '利用者一覧',
 *       paper: 'A3 portrait', margin: 8,                 // 既定（職員は設定画面で変更できる）
 *       root: '#sc-daylist',                             // 印刷する範囲。外側は自動で非表示
 *       fit: { mode: 'height', cssVar: '--sh-fs', base: 12, min: 7, step: 0.25 },
 *       stamp: true                                      // 印刷日を root の先頭に付ける
 *     });
 *     // ボタン: SUPrint.print('daylist')  /  設定つき: SUPrint.openDialog('daylist')
 *     // タブ切替時: SUPrint.setActive('daylist')  → Cmd/Ctrl+P でも同じ用紙・フィットで出る
 *
 * 公開API
 *   SUPrint.define(name, spec)        ビューを登録（同名は上書き）
 *   SUPrint.setActive(name)           Cmd/Ctrl+P の対象ビュー
 *   SUPrint.print(name?, overrides?)  準備 → window.print() → 後始末
 *   SUPrint.openDialog(name?)         用紙・余白・収め方を選ぶ画面を出してから印刷
 *   SUPrint.estimate(name?, prefs?)   {pages, availPx, needPx, fontPx} を返す（印刷はしない）
 *   SUPrint.prefs(name).get()/set()/reset()   保存設定（su_print_prefs）
 *   SUPrint.last                      直近の印刷診断（su-report.js が添付できる）
 *   SUPrint.clear()                   状態の強制クリア（デバッグ用）
 *
 * ツール側フック: before(state) / after(state) / onShrink(px, diag) / pagesOf(state, 既定枚数)
 *   / when() → false なら準備しない（移行途中の同居対策）／ afterMeasure(state, diag)
 *   / clearDelay … afterprint 未発火時の後始末までの ms（既定 3000）
 *   fit: { mode, cssVar, target, base, min, step, max(数値|関数), apply(px,target,state,isFinal),
 *          minFallback:'base', checkWidth, check(state,need,px), measure(state), slack:{w,h} }
 */
(function (global) {
  'use strict';
  if (global.SUPrint) return;

  var PX_PER_MM = 96 / 25.4;
  /* 「横がはみ出します」の許容（px）。ブラウザは要素幅を整数へ丸めるため、用紙幅ぴったりに
     列幅を配分した帳票でも 1px 程度は上に出る。ここを 0 に近づけると、正しい既定の用紙で
     毎回この警告が出て職員を迷わせる（実測: 利用表・A4縦で 734 vs 733.23）。 */
  var OVERFLOW_TOL = 2;
  /* 「収まった」と見なす許容（px）。ブラウザは小数の高さを返すので、ぴったり1枚ぶんでも
     0.1px 単位で上に出る。フィットの合否と見込み枚数は【同じ許容】で判定すること。
     揃えないと「1枚に収まると判定して刷った帳票を、見込みでは2枚と表示する」ことが起きる。 */
  var FIT_TOL = 0.5;
  /* afterprint が来ない環境向けの保険タイマー（ms）。★移行元のツールが持っていた値を下回らせない。
     window.print() が同期的に止まらない環境では、プレビューを開いている最中にこれが発火すると
     用紙指定と印刷用クラスが外れて紙面が別物になる。spec.clearDelay で上書きできる。 */
  var CLEAR_DELAY = 3000;
  var PAPERS = {                                  // mm（幅×高さ）
    'A4 portrait': [210, 297], 'A4 landscape': [297, 210],
    'A3 portrait': [297, 420], 'A3 landscape': [420, 297],
    /* ★CSS の @page{size:B4|B5} は【ISO】の寸法（B4=250x353・B5=176x250）。
       JIS（B4=257x364・B5=182x257）を書くと、実際より大きい紙として採寸してしまい、
       収まると判定したものが紙からはみ出す（2026-09-12 実測: B4縦の実PDFは 250x353mm）。
       JIS が要る時は size に 'JIS-B4' を使う別エントリを足すこと（値を書き換えないこと）。 */
    'B4 portrait': [250, 353], 'B4 landscape': [353, 250],
    'B5 portrait': [176, 250], 'B5 landscape': [250, 176]
  };
  var PAPER_LABEL = { 'A4 portrait': 'A4 縦', 'A4 landscape': 'A4 横', 'A3 portrait': 'A3 縦', 'A3 landscape': 'A3 横',
    'B4 portrait': 'B4 縦', 'B4 landscape': 'B4 横', 'B5 portrait': 'B5 縦', 'B5 landscape': 'B5 横' };
  var MARGIN_CHOICES = [[5, '狭い（5mm）'], [8, '標準（8mm）'], [10, '広め（10mm）'], [15, 'ゆったり（15mm）']];
  var FIT_CHOICES = [['height', '1枚に収める（文字を自動で縮小）'], ['width', '幅だけ合わせる（縦は複数枚可）'], ['none', 'そのまま（縮小しない）']];
  var FILE = (location.pathname.split('/').pop() || 'index').replace(/\.html?$/, '');
  var PREF_KEY = 'su_print_prefs';

  var views = {};          // name → spec
  var active = null;       // Cmd/Ctrl+P の対象
  var state = null;        // 準備中の状態（null = 何もしていない）
  var timer = null;        // afterprint 未発火の保険
  var api = { version: '0.1', last: null };

  /* ───────── ユーティリティ ───────── */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function mmToPx(mm) { return mm * PX_PER_MM; }
  function paperOf(key) { return PAPERS[key] ? key : 'A4 portrait'; }
  function marginObj(m) {                         // 数値 or 'a' | 'v h' | 't r b l'（mm）
    if (typeof m === 'number') return { t: m, r: m, b: m, l: m };
    var p = String(m || '8').replace(/mm/g, '').trim().split(/\s+/).map(parseFloat);
    if (p.length === 1) return { t: p[0], r: p[0], b: p[0], l: p[0] };
    if (p.length === 2) return { t: p[0], r: p[1], b: p[0], l: p[1] };
    if (p.length === 3) return { t: p[0], r: p[1], b: p[2], l: p[1] };
    return { t: p[0], r: p[1], b: p[2], l: p[3] };
  }
  function marginCss(mo) { return mo.t + 'mm ' + mo.r + 'mm ' + mo.b + 'mm ' + mo.l + 'mm'; }
  /* 印字面（px@96dpi）。★floor しない。1px 未満を切り捨てると、列幅を用紙幅ぴったりに
     配分している帳票が「幅が足りない」と判定され、収まるはずの候補が全部落ちる。 */
  function metrics(paper, mo) {
    var wh = PAPERS[paperOf(paper)];
    return {
      paper: paperOf(paper), margin: mo,
      wPx: mmToPx(wh[0] - mo.l - mo.r),
      hPx: mmToPx(wh[1] - mo.t - mo.b)
    };
  }
  function px2(v) { return Math.round(v * 100) / 100; }   // CSS へ出す時だけ小数2桁へ
  function device() {
    var ua = navigator.userAgent;
    var os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
      : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
        : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'その他';
    var br = /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge'
      : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'その他';
    return os + '/' + br;
  }
  function todayText() {
    var d = new Date(), w = '日月火水木金土'[d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + w + '）';
  }

  /* ───────── 設定の保存（個人情報なし） ───────── */
  function loadAll() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveAll(o) { try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); } catch (e) { /* 私用モード等 */ } }
  function prefsFor(name) {
    var key = FILE + ':' + name;
    return {
      get: function () { return loadAll()[key] || null; },
      set: function (p) { var all = loadAll(); all[key] = p; saveAll(all); },
      reset: function () { var all = loadAll(); delete all[key]; saveAll(all); }
    };
  }
  function resolve(spec, overrides) {             // 既定 ← 保存設定 ← 一時上書き
    var saved = prefsFor(spec.name).get() || {};
    var o = overrides || {};
    var allow = spec.allowUser || ['paper', 'margin', 'fit'];
    function pick(k, dflt) {
      if (o[k] != null) return o[k];
      if (allow.indexOf(k) >= 0 && saved[k] != null) return saved[k];
      return dflt;
    }
    var fitMode = pick('fit', (spec.fit && spec.fit.mode) || 'none');
    return {
      paper: paperOf(pick('paper', spec.paper || 'A4 portrait')),
      margin: marginObj(pick('margin', spec.margin != null ? spec.margin : 8)),
      fit: fitMode,
      pages: Math.max(1, parseInt(pick('pages', spec.pages || 1), 10) || 1)
    };
  }

  /* ───────── @media print を画面へ一時適用（採寸用） ───────── */
  function eachPrintRule(fn) {
    var sheets = document.styleSheets, i, j, rules;
    for (i = 0; i < sheets.length; i++) {
      try { rules = sheets[i].cssRules; } catch (e) { continue; }   // クロスオリジンは飛ばす
      if (!rules) continue;
      for (j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (r.type === 4 /* MEDIA_RULE */ && /(^|,)\s*print\s*($|,| and)/.test(r.media.mediaText)) fn(r);
      }
    }
  }
  var mediaPatched = [];
  function printRulesOn() {
    mediaPatched = [];
    eachPrintRule(function (r) {
      var before = r.media.mediaText;
      try { r.media.appendMedium('screen'); mediaPatched.push([r, before]); } catch (e) { /* 読み取り専用シートは無視 */ }
    });
  }
  function printRulesOff() {
    for (var i = mediaPatched.length - 1; i >= 0; i--) {
      try { mediaPatched[i][0].media.mediaText = mediaPatched[i][1]; } catch (e) { /* noop */ }
    }
    mediaPatched = [];
  }

  /* ───────── 印刷範囲の外側を隠す（root の祖先ごとに兄弟を隠す） ───────── */
  function hideOutside(root) {
    var hidden = [], node = root;
    while (node && node !== document.body) {
      var parent = node.parentElement; if (!parent) break;
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c !== node && !/^(SCRIPT|STYLE|LINK|DIALOG)$/.test(c.tagName) && !c.classList.contains('su-print-keep')) {
          c.classList.add('su-print-hidden'); hidden.push(c);
        }
      }
      node = parent;
    }
    return hidden;
  }

  /* ───────── 採寸とフィット ───────── */
  function ensureStyle(id, css) {
    var st = document.getElementById(id);
    if (!st) { st = document.createElement('style'); st.id = id; document.head.appendChild(st); }   // 末尾に追加＝後勝ち
    st.textContent = css;
    return st;
  }
  function pageCss(m) {
    return '@media print{@page{size:' + m.paper + ';margin:' + marginCss(m.margin) + '}' +
      'html,body{width:' + px2(m.wPx) + 'px!important;min-width:0!important;max-width:none!important;margin:0!important;padding:0!important;overflow:visible!important}' +
      '}';
  }
  function measureCss(m) {                        // 採寸中だけ画面へ効かせる幅の固定
    return 'html,body{width:' + px2(m.wPx) + 'px!important;min-width:0!important;max-width:none!important;margin:0!important;padding:0!important;overflow:visible!important}';
  }
  /* root の必要寸法（px）。
     ★ここで切り上げない。scrollWidth/scrollHeight は既にブラウザ側で整数へ丸められており、
       その上から Math.ceil を掛けると紙幅ぴったりの帳票が最大2px 過大に出る
       （実測: 印字可能幅 733.23px の用紙に対し 734 と出て「横がはみ出します」を誤表示した）。 */
  function need(root) {
    var r = root.getBoundingClientRect();
    return { w: Math.max(root.scrollWidth, r.width), h: Math.max(root.scrollHeight, r.height) };
  }
  /* fit の指定（すべて任意）
   *   cssVar / target      … 既定の適用方法（target のインライン style へ cssVar を書く）
   *   apply(px, target, state, isFinal)
   *                        … 適用をツール側に任せる。px=null は「既定へ戻す」。
   *                          isFinal=true は探索が終わって採用値を確定させる呼び出し（採寸窓の中）。
   *                          列幅を文字サイズに連動させる／companion 変数も一緒に動かす／
   *                          画面へ残さず @media print 限定の規則として当てる、等に使う。
   *   max                  … 拡大の上限（数値 or 関数(target, state)）。既定は base（＝拡大しない）。
   *                          データ依存の上限（氏名が1行に収まる最大 等）は関数で渡す。
   *   minFallback: 'base'  … 下限まで縮めても収まらない時、下限ではなく base で刷る
   *                          （読めない紙面で、しかも複数枚になるのを避ける運用判断がある帳票向け）
   *   check(state, need, px) … 合否に【ツール側の追加条件】を足す（AND）。root の外形寸法には
   *                          現れない欠け（セルが overflow:hidden で内容を切っている等）は
   *                          モジュールからは見えないので、見えるツール側が判定する。
   *   measure(state)       … 探索そのものをツール側で行う（採寸窓の中で1回だけ呼ばれる）。
   *                          「1行に収まる率が9割以上で、かつページ数が最小の中で最大の文字」の
   *                          ような、高さ・幅の単純比較で書けない方針を持つ帳票用。
   *                          {fontPx, need:{w,h}} を返す。返した need がそのまま枚数計算に使われる。
   *   slack: {w, h}        … 合否判定だけを厳しくする安全余裕(px)。端末ごとの丸めの1px差で
   *                          最終行が次の紙へ落ちるのを防ぐ。★見込み枚数は実際の紙の高さで
   *                          数える（ここを一緒に削ると枚数を過大に出す）。
   *   checkWidth: false    … mode:'height' の合否を【高さだけ】で見る。列幅を colgroup の px で
   *                          自前に予算管理している帳票（列幅は文字サイズでほとんど変わらない）では、
   *                          幅を合否に入れると 1px の超過で全候補が不合格になり、下限あるいは既定
   *                          サイズへ落ちて「縮めれば1枚に入るのに複数枚で出る」事故になる。
   *                          幅の超過は合否から外しても api.last.overflowW で必ず報告される
   *                          （設定画面の「⚠ 横がはみ出します」はそのまま出る）。
   */
  function fitFont(spec, root, m, mode, pages) {
    var f = spec.fit || {};
    var target = f.target ? ($(f.target, root) || root) : root;
    var cssVar = f.cssVar, apply = f.apply;
    var base = f.base || 12, min = f.min || 7, step = f.step || 0.25;
    /* 安全余裕は【合否だけ】を厳しくする（見込み枚数は実際の紙の高さで数える） */
    var slackW = (f.slack && f.slack.w) || 0, slackH = (f.slack && f.slack.h) || 0;
    var availW = m.wPx - slackW, availH = m.hPx * pages - slackH;
    function setFs(v, isFinal) {
      if (apply) apply(v, target, state, !!isFinal);
      else target.style.setProperty(cssVar, v + 'px');
    }
    /* ★ツール側が探索そのものを持つ場合は【何より先に】そちらへ委ねる。
       この判定を「cssVar も apply も無ければ帰る」より後ろに置くと、measure だけを渡した
       ビューでは一度も呼ばれない（＝用紙を変えても採寸が追従しないのに、描画時の採寸が
       残っているせいで既定用紙では正しく見えてしまう）。 */
    if (f.measure) {
      var mr = f.measure(state) || {};
      return { fontPx: (mr.fontPx != null ? mr.fontPx : null), need: (mr.need || need(root)),
               target: target, cssVar: cssVar, apply: apply,
               /* ★二重にくるまない。ツールが pagesOf 等で読むのは measure が返した中身そのもの */
               diag: (mr.diag != null ? mr.diag : mr) };
    }
    if (!cssVar && !apply) return { fontPx: null, need: need(root) };
    if (mode === 'none') {
      /* 収め方=そのまま。文字サイズは既定のままだが、apply を持つツールには既定サイズで一度通す
         ＝「用紙が決まった」ことを知らせる。これを飛ばすと、用紙に追従させている寸法
         （列幅の配分など）が前の用紙のまま残る（実測: A3 を選んで「そのまま」にすると
         利用表の列幅が A4縦の予算のままだった）。 */
      if (!apply) return { fontPx: null, need: need(root) };
      setFs(base);
      var need0 = need(root);
      setFs(base, true);
      return { fontPx: null, need: need0, target: target, cssVar: cssVar, apply: apply };
    }
    var wideOk = (f.checkWidth === false) ? function () { return true; }
      : function (n) { return n.w <= availW + FIT_TOL; };
    function ok(v) {
      setFs(v); var n = need(root);
      /* ツール側の追加条件（AND）。root の外形には出ない欠けを見るためのもの。 */
      if (f.check) { var c; try { c = f.check(state, n, v); } catch (e) { c = false; } if (!c) return false; }
      if (mode === 'width') return n.w <= availW + FIT_TOL;
      return wideOk(n) && n.h <= availH + FIT_TOL;             // height = 既定では幅も高さも
    }
    var max = (typeof f.max === 'function') ? f.max(target, state) : (f.max != null ? f.max : base);
    if (!(max > 0)) max = base;                                 // 上限の算出に失敗しても既定で刷る
    if (max < min) max = min;
    var chosen;
    if (ok(max)) chosen = max;                                  // 既定（または上限）で収まるならそれを採る
    else {
      var lo = min, hi = max;                                   // 二分探索（step 刻み）
      if (!ok(lo)) chosen = (f.minFallback === 'base') ? base : lo;   // 下限でも溢れる
      else {
        while (hi - lo > step) { var mid = lo + Math.round(((hi - lo) / 2) / step) * step; if (mid <= lo || mid >= hi) break; if (ok(mid)) lo = mid; else hi = mid; }
        chosen = lo;
      }
    }
    /* ★採寸は「画面に効く形」で当ててから行い、そのあとで確定形へ移す。
       確定形（isFinal）を @media print 限定の規則として当てるツールがあり、その規則は
       採寸窓（mediaText 切替）の後に生成されるため画面には効かない＝既定サイズで測ってしまう。
       実測: 利用表が縮小した局面で、実際は1枚なのに見込み2枚と出た。 */
    setFs(chosen);
    var needFinal = need(root);
    setFs(chosen, true);
    return { fontPx: chosen, need: needFinal, target: target, cssVar: cssVar, apply: apply };
  }

  /* ───────── 準備・後始末 ───────── */
  /* 後始末。★2つの決めごと:
       ① ツール側の after（氏名を含む印刷用DOMの破棄）を【最初に】呼ぶ。後段の復元で例外が出ても
          個人情報が DOM に残らないようにするため。
       ② 各手順を個別の try で包む。1つ失敗しても残りの復元（画面の文字サイズ・非表示の解除・
          注入した @page の除去）が必ず走る。state は先に null にしてあるので、やり直しは来ない。 */
  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!state) { printRulesOff(); return; }
    var s = state; state = null;
    var steps = [
      function () { if (s.spec.after) s.spec.after(s); },                       // ★氏名の破棄を最優先
      function () {
        if (s.fitted && s.fitted.apply) s.fitted.apply(null, s.fitted.target, s, false);
        else if (s.fitted && s.fitted.cssVar) s.fitted.target.style.removeProperty(s.fitted.cssVar);
      },
      function () { for (var i = 0; i < s.hidden.length; i++) s.hidden[i].classList.remove('su-print-hidden'); },
      function () { if (s.stamp && s.stamp.parentNode) s.stamp.parentNode.removeChild(s.stamp); },
      function () { s.root.classList.remove('su-print-root'); },
      function () { document.body.classList.remove('su-printing', 'su-print-' + s.spec.name); },
      function () { var st = document.getElementById('su-print-page'); if (st) st.parentNode.removeChild(st); },
      function () { var ms = document.getElementById('su-print-measure'); if (ms) ms.parentNode.removeChild(ms); }
    ];
    for (var k = 0; k < steps.length; k++) {
      try { steps[k](); } catch (e) { console.warn('[su-print] 後始末の手順 ' + k + ' で例外', e); }
    }
    printRulesOff();
  }
  function prepare(name, overrides, silent) {
    clear();
    var spec = views[name || active];
    if (!spec) { if (!silent) console.warn('[su-print] 未登録のビュー:', name || active); return null; }
    /* ★そのビューを画面に出していない時は準備しない（移行途中の同居対策・上の beforeprint 参照）。
       ボタン経路・設定画面・Cmd/Ctrl+P のすべてがここを通るので、門は1つで足りる。 */
    if (spec.when) { var okView; try { okView = spec.when(spec); } catch (e) { okView = false; } if (!okView) return null; }
    var root = typeof spec.root === 'string' ? $(spec.root) : (spec.root || document.body);
    if (!root) { console.warn('[su-print] root が見つかりません:', spec.root); return null; }
    var p = resolve(spec, overrides);
    var m = metrics(p.paper, p.margin);
    state = { spec: spec, root: root, prefs: p, metrics: m, hidden: [], stamp: null, fitted: null };
    /* ★ここから先は必ず try で囲む。before（氏名を含む印刷用DOMの構築）や採寸で例外が出ると、
       state が非 null のまま・印刷用DOM も残り、次の Cmd/Ctrl+P が
       「準備済み」と誤認して早期 return し、前のタブの用紙で刷られる。 */
    try {
    if (spec.before) spec.before(state);                        // 一括ページの構築など（root の中身を作る）
    document.body.classList.add('su-printing', 'su-print-' + spec.name);
    root.classList.add('su-print-root');
    state.hidden = hideOutside(root);
    if (spec.stamp) {
      var d = document.createElement('div'); d.className = 'su-print-stamp';
      d.textContent = (typeof spec.stamp === 'string' ? spec.stamp : '印刷日 ') + todayText();
      root.insertBefore(d, root.firstChild); state.stamp = d;
    }
    // 採寸: 印刷規則を画面へ適用 + 幅を紙に固定 → フィット → 元へ
    var ms = ensureStyle('su-print-measure', measureCss(m));
    printRulesOn();
    var pagesCalc = 1;
    try {
      state.fitted = fitFont(spec, root, m, p.fit, p.pages);
      /* 見込み枚数も【採寸窓の中で】数える。印刷規則が当たっていない画面で数えると、
         紙だけで効く文字サイズ・行高・改ページ指定が反映されず実枚数とずれる。
         spec.pagesOf(state, 既定値) を持つツールはそちらを正とする（明示的な改ページを持つ帳票用）。 */
      pagesCalc = Math.max(1, Math.ceil((state.fitted.need.h - FIT_TOL) / m.hPx));
      if (spec.pagesOf) { var pv = spec.pagesOf(state, pagesCalc); if (pv > 0) pagesCalc = pv; }
    }
    finally { printRulesOff(); ms.parentNode.removeChild(ms); }
    ensureStyle('su-print-page', pageCss(m));
    var n = state.fitted.need;
    api.last = {
      at: new Date().toISOString(), file: FILE, view: spec.name, device: device(),
      paper: m.paper, margin: marginCss(m.margin), fit: p.fit,
      availPx: [m.wPx, m.hPx], needPx: [n.w, n.h], fontPx: state.fitted.fontPx,
      pages: pagesCalc, overflowW: n.w > m.wPx + OVERFLOW_TOL
    };
    /* 採寸の結果をツールへ返す。★採寸窓の【外】で呼ぶ＝ここで画面に警告を出しても採寸に影響しない。
       「1枚に収まりません」等の画面内警告は移行前からの機能なので、これで残す（原則1）。
       Cmd/Ctrl+P（silent）でも呼ぶ＝どの経路でも警告が出る。 */
    if (spec.afterMeasure) {
      try { spec.afterMeasure(state, api.last); } catch (e) { console.warn('[su-print] afterMeasure で例外', e); }
    }
    /* 縮小の通知。★条件に apply を含めること（cssVar を使わず apply フックだけで
       文字サイズを当てるビューがあり、cssVar だけ見ていると通知が1度も出ない）。 */
    if (!silent && spec.fit && (spec.fit.cssVar || spec.fit.apply) && state.fitted.fontPx != null
        && state.fitted.fontPx < (spec.fit.base || 12) && spec.onShrink)
      spec.onShrink(state.fitted.fontPx, api.last);
    } catch (e) {
      console.warn('[su-print] 印刷の準備に失敗しました', e);
      clear();                                                  // 氏名DOM・@page・非表示指定を必ず落とす
      return null;
    }
    return state;
  }
  function estimate(name, prefs) {
    try { var s = prepare(name, prefs, true); return s ? api.last : null; }
    finally { clear(); }
  }
  function doPrint(name, overrides) {
    if (!prepare(name, overrides)) return;
    var done = function () { window.removeEventListener('afterprint', done); clear(); };
    window.addEventListener('afterprint', done);
    var sp0 = views[name || active];
    timer = setTimeout(done, (sp0 && sp0.clearDelay) || CLEAR_DELAY);   // afterprint 未発火の保険（iOS/PDF）
    window.print();
  }
  /* Cmd/Ctrl+P: 準備済みならそのまま。未準備なら active ビューで同じ準備を通す。
     ★spec.when() が false を返す時は【何もしない】。1つのツールの中に su-print へ移した画面と
       まだ移していない画面が同居していると、移していない画面（個票・様式など）で印刷した時に
       「最後に見ていた帳票ビュー」の用紙と幅固定が乗ってしまう。when はその横取りを塞ぐ唯一の門。 */
  window.addEventListener('beforeprint', function () {
    if (state || !active || !views[active]) return;
    if (prepare(active, null, true)) timer = setTimeout(clear, (views[active].clearDelay || CLEAR_DELAY));
  });
  window.addEventListener('afterprint', function () { clear(); });
  window.addEventListener('pagehide', function () { clear(); });
  /* 保険その4: afterprint も pagehide も来ない環境向け（印刷メディアを抜けたのを合図に戻す）。
     ★プレビューを開いている間は matches:true のままなので、設定を変えただけでは発火しない。 */
  try {
    if (window.matchMedia) {
      var mqPrint = window.matchMedia('print');
      var onMedia = function (ev) { if (!ev.matches) clear(); };
      if (mqPrint.addEventListener) mqPrint.addEventListener('change', onMedia);
      else if (mqPrint.addListener) mqPrint.addListener(onMedia);
    }
  } catch (e) { /* 非対応環境は他の3経路に任せる */ }

  /* ───────── 設定画面 ───────── */
  function openDialog(name) {
    name = name || active;
    var spec = views[name]; if (!spec) return;
    var cur = resolve(spec), pf = prefsFor(name), allow = spec.allowUser || ['paper', 'margin', 'fit'];
    var dlg = document.getElementById('su-print-dialog');
    if (dlg) dlg.parentNode.removeChild(dlg);
    dlg = document.createElement('dialog'); dlg.id = 'su-print-dialog'; dlg.className = 'su-print-keep';
    function opts(list, sel, fmt) { return list.map(function (x) { var v = x[0], l = x[1]; return '<option value="' + v + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + l + '</option>'; }).join(''); }
    var papers = (spec.papers || ['A4 portrait', 'A4 landscape', 'A3 portrait', 'A3 landscape']).map(function (k) { return [k, PAPER_LABEL[k] || k]; });
    var mrg = cur.margin.t;
    var canFit = !!(spec.fit && (spec.fit.cssVar || spec.fit.apply));   // apply フックだけのビューも収め方を選べる
    dlg.innerHTML =
      '<form method="dialog" class="su-pd">' +
      '<h2>印刷の設定 <small>' + (spec.label || name) + '</small></h2>' +
      (allow.indexOf('paper') >= 0 ? '<label>用紙<select name="paper">' + opts(papers, cur.paper) + '</select></label>' : '') +
      (allow.indexOf('margin') >= 0 ? '<label>余白<select name="margin">' + opts(MARGIN_CHOICES, mrg) + '</select></label>' : '') +
      (allow.indexOf('fit') >= 0 && canFit ? '<label>収め方<select name="fit">' + opts(FIT_CHOICES, cur.fit) + '</select></label>' : '') +
      '<p class="su-pd-est" aria-live="polite"></p>' +
      '<label class="su-pd-remember"><input type="checkbox" name="remember" checked> この設定を次回も使う（この端末）</label>' +
      '<div class="su-pd-btns"><button value="reset" type="button">既定に戻す</button><span></span>' +
      '<button value="cancel" type="button">キャンセル</button><button value="print" type="submit" class="su-pd-primary">印刷</button></div>' +
      '</form>';
    document.body.appendChild(dlg);
    var form = dlg.firstChild, est = $('.su-pd-est', dlg);
    function snap() {
      var o = {};
      if (form.paper) o.paper = form.paper.value;
      if (form.margin) o.margin = form.margin.value;
      if (form.fit) o.fit = form.fit.value;
      return o;
    }
    var initial = snap();
    /* ★職員が触っていない項目は返さない（＝開発側の既定・保存済みの設定をそのまま使う）。
       余白の選択肢は上下左右同値しか表せないため、非対称の既定（例 上15・左右5・下0）は
       上マージン1つに潰れて表示される。それをそのまま返すと「用紙も余白も変えずに印刷を
       押しただけ」で @page の余白が上下左右均等に書き換わり、1枚に詰めてある帳票が溢れる。 */
    function read() {
      var cur = snap(), o = {};
      if (cur.paper != null && cur.paper !== initial.paper) o.paper = cur.paper;
      if (cur.margin != null && cur.margin !== initial.margin) o.margin = parseFloat(cur.margin);
      if (cur.fit != null && cur.fit !== initial.fit) o.fit = cur.fit;
      return o;
    }
    function refresh() {
      var r = estimate(name, read());
      if (!r) { est.textContent = ''; return; }
      var t = PAPER_LABEL[r.paper] + '・見込み ' + r.pages + ' 枚';
      if (r.fontPx != null && spec.fit && r.fontPx < (spec.fit.base || 12)) t += '（文字 ' + r.fontPx.toFixed(2).replace(/\.?0+$/, '') + 'px に縮小）';
      if (r.overflowW) t += '　⚠ 横がはみ出します（用紙を横向きか大きめに）';
      if (r.pages > 1 && r.fit === 'height') t += '　⚠ 下限の文字でも1枚に入りません';
      est.textContent = t;
    }
    form.addEventListener('change', refresh);
    dlg.addEventListener('click', function (e) {
      var v = e.target && e.target.value;
      if (v === 'cancel') dlg.close('cancel');
      if (v === 'reset') { pf.reset(); dlg.close('cancel'); openDialog(name); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var o = read();
      /* 保存は「前回の保存内容 ← 今回変えた項目」の重ね書き。o は変えた項目だけなので、
         そのまま set すると前回保存した用紙・余白が消える。 */
      if (form.remember.checked) {
        var keep = pf.get() || {}, merged = {};
        for (var k1 in keep) if (Object.prototype.hasOwnProperty.call(keep, k1)) merged[k1] = keep[k1];
        for (var k2 in o) if (Object.prototype.hasOwnProperty.call(o, k2)) merged[k2] = o[k2];
        pf.set(merged);
      } else pf.reset();
      dlg.close('print');
      setTimeout(function () { doPrint(name, o); }, 30);      // dialog が閉じてから印刷（dialog 自体が紙に出ない）
    });
    dlg.addEventListener('close', function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
    refresh();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /* ───────── 公開 ───────── */
  api.define = function (name, spec) { spec = spec || {}; spec.name = name; views[name] = spec; if (!active) active = name; return api; };
  /* 印刷対象のビューを切り替える。★null を渡すと「対象なし」＝Cmd/Ctrl+P で何も準備しない。
     移行途中のツールが、まだ移していない画面（個票・様式など）へ移った時に必ず呼ぶこと。 */
  api.setActive = function (name) {
    if (name == null) { active = null; return api; }
    if (views[name]) active = name;
    return api;
  };
  api.getActive = function () { return active; };
  api.print = function (name, overrides) { doPrint(name || active, overrides); };
  api.openDialog = openDialog;
  api.estimate = estimate;
  api.prefs = prefsFor;
  api.clear = clear;
  api.papers = PAPERS;
  api.paperLabel = function (key) { return PAPER_LABEL[key] || key; };   // 'A4 portrait' → 'A4 縦'
  api.metrics = function (paper, margin) { return metrics(paper, marginObj(margin == null ? 8 : margin)); };
  global.SUPrint = api;
})(window);
