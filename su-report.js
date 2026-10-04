/* su-report.js — 現場から不具合を1タップで報告するための共有部品（2026-09-06 新設・2026-10-04 全画面＋自動報告）
 *
 * なぜ必要か: 稼働中ツールの不具合は「職員 → 代表 → Claude」の口伝でしか届かず、
 *   届く頃には「印刷が崩れる」まで圧縮されて端末・ブラウザ・状態が失われている。
 *   そのため再現に往復が増える。押した瞬間の状況を機械が添える。
 *
 * 個人情報の扱い（設計の中心）:
 *   ・集めるのは下の allowlist だけ。localStorage の【値】は一切読まない。
 *     接続設定は「設定あり/なし」の真偽だけを見る（宛先も合言葉も読まない・書かない）。
 *   ・入居者名・記録・処方は自動収集しない。自由記述に書くかどうかは職員の判断。
 *     報告は公開の場所（GitHub の Issue）に載るため、画面にその旨と「氏名・居室番号・病名は書かない」を出す。
 *   ・送る前に【全文を画面に出す】。本人が見ていない文字は外に出ない。
 *   ・エラーの文（メッセージ）は送らない。V8 のエラー文はデータの中身（氏名など）を含むことがあるため、
 *     送るのは「エラーの種類（TypeError 等）とファイル名:行番号」だけ。
 *
 * 動作:
 *   既定は「本文をコピー」— LINE等に貼って送る。サーバーは要らない。
 *   送信先（接続設定の「不具合の報告先」＝ localStorage su_report_endpoint と合言葉 su_report_token）が
 *   両方あれば「そのまま送信」も出る。送る先は <endpoint>?k=<合言葉>。
 *
 * ★2026-10-04（代表者の決定）: 全画面に置く。画面で起きたエラー（su-errors.js が拾ったもの）は、
 *   送信先が設定されている端末からだけ【自動で】送る。同じエラーは30分に1回に間引く。
 *   送信先が無い端末では何もしない＝今までどおり。
 * ★ボタンの置き場所: 右下が基本。右下に別の固定要素（週間計画の「＋」等）が重なるなら左下へ、
 *   下端のバー（.bnav 等）があればその上へ、自分で測って置く。印刷には出さない。
 *   重なり順は画面のモーダルより下（z-index 30）＝モーダルの「保存」を覆わない。モーダルの中では報告できない（閉じてから押す）。
 *   他の画面の中に枠（iframe）として埋め込まれている時はボタンを出さない（自動報告は効く）。
 *
 * 使い方: 各ツールの </body> の直前で
 *   <script src="su-report.js?v=2026-10-04" data-tool="週間計画"></script>
 */
(function () {
  'use strict';
  if (window.__suReportLoaded) return;
  window.__suReportLoaded = true;

  var TOOL = (document.currentScript && document.currentScript.dataset.tool) || document.title || location.pathname;
  var FILE = (location.pathname.split('/').pop() || location.pathname).split('?')[0];
  var T0 = Date.now();
  var ERRORS = [];   // 直近のJSエラー（種類と場所だけ・最大5件）
  var AUTO_LS = 'su_report_auto_v1';          // 自動報告の間引き（{署名: 送った時刻}）
  var AUTO_GAP_MS = 30 * 60 * 1000;           // 同じエラーは30分に1回
  var AUTO_MAX_PER_LOAD = 10;                 // 1回の画面表示で自動送信する上限（暴走しても止まる）
  var autoSent = 0;

  /* エラー文からは「種類」だけを取り出す（文の中身は送らない）。where は ファイル名:行 だけ（クエリは落とす） */
  function errType(msg) {
    var s = String(msg || '');
    var m = s.match(/\b([A-Z][A-Za-z]*Error)\b/);
    return m ? m[1] : 'エラー';
  }
  function cleanWhere(where) {
    var w = String(where || '').replace(/[?#][^:]*/, '');
    var m = w.match(/([A-Za-z0-9_.-]+\.(?:html|js)):?(\d+)?/);
    return m ? (m[1] + (m[2] ? ':' + m[2] : '')) : '';
  }
  function pushErr(s) {
    s = String(s || '').replace(/\s+/g, ' ').slice(0, 120);
    if (!s) return;
    if (ERRORS.indexOf(s) === -1) ERRORS.push(s);
    if (ERRORS.length > 5) ERRORS.shift();
  }
  window.addEventListener('error', function (e) {
    if (!e || (!e.message && !e.error)) return;
    pushErr(errType(e.message || (e.error && e.error.message)) + (e.filename ? ' @' + cleanWhere(String(e.filename).split('/').pop() + ':' + (e.lineno || 0)) : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    pushErr('未処理のPromise: ' + errType(e && e.reason && (e.reason.message || e.reason)));
  });

  // ── 収集する事実の allowlist。ここに無いものは集めない ──
  function device() {
    var ua = navigator.userAgent;
    var os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
      : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
        : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'その他';
    var br = /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge'
      : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'その他';
    return os + ' / ' + br;
  }
  function role() {
    try { return localStorage.getItem('su_device_role') === 'field' ? '現場端末' : '事務所端末'; }
    catch (e) { return '不明'; }
  }
  function connected() {
    // 【真偽だけ】を見る。宛先も合言葉も読まない
    try {
      var keys = ['su_sync_common', 'ws_settings', 'rmaster_cfg'];
      for (var i = 0; i < keys.length; i++) if (localStorage.getItem(keys[i])) return '設定あり';
      return '設定なし（未接続）';
    } catch (e) { return '不明'; }
  }
  function build() {
    var m = document.querySelector('meta[name="build"], meta[name="version"]');
    return m ? m.content : '記載なし';
  }
  function facts() {
    var mins = Math.round((Date.now() - T0) / 60000);
    var L = [];
    L.push('端末: ' + device() + ' / 画面 ' + window.innerWidth + '×' + window.innerHeight + '（倍率' + (window.devicePixelRatio || 1) + '）');
    L.push('役割: ' + role() + ' ／ 接続: ' + connected());
    L.push('版: ' + build() + ' ／ この画面を開いてから ' + mins + '分');
    return L;
  }

  function compose(symptom) {
    var L = [];
    L.push('【不具合報告】' + new Date().toLocaleString('ja-JP'));
    L.push('ツール: ' + TOOL + '（' + FILE + '）');
    L.push('症状: ' + (symptom ? symptom.replace(/\r?\n/g, ' ／ ') : '（未記入）'));   // 症状は1行にする（行頭の見出しと紛れないように）
    L.push('──── ここから下は自動で付いた情報です ────');
    L = L.concat(facts());
    L.push('画面のエラー: ' + (ERRORS.length ? ERRORS.length + '件（種類と場所だけ）' : 'なし'));
    for (var i = 0; i < ERRORS.length; i++) L.push('  ' + (i + 1) + ') ' + ERRORS[i]);
    return L.join('\n');
  }
  // 自動報告の本文。職員が書く欄は無い＝エラーの種類・場所と端末の事実だけ
  function composeAuto(type, where) {
    var L = [];
    L.push('【自動報告】' + new Date().toLocaleString('ja-JP'));
    L.push('ツール: ' + TOOL + '（' + FILE + '）');
    L.push('エラー: ' + type + (where ? '（' + where + '）' : ''));
    L.push('──── 自動で付いた情報 ────');
    L = L.concat(facts());
    return L.join('\n');
  }

  // 送信先は【端末の localStorage】から読む（他ツールの接続先と同じ流儀＝配信物に URL や合言葉を載せない）。
  // 設定する所: 接続設定の「不具合の報告先」（URL と合言葉）。両方そろって初めて送れる。
  function endpoint() {
    try {
      var url = String(localStorage.getItem('su_report_endpoint') || '').trim();
      var tok = String(localStorage.getItem('su_report_token') || '').trim();
      if (!/^https:\/\//i.test(url) || !tok) return '';     // https:// 以外（http:・javascript: 等）へは送らない
      return url + (url.indexOf('?') === -1 ? '?' : '&') + 'k=' + encodeURIComponent(tok);
    } catch (e) { return ''; }
  }
  /* 受け口の応答（JSON の ok）まで見る。HTTP が 200 でも合言葉違い・形式違いは ok:false で返る */
  function post(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body, keepalive: true
    }).then(function (r) {
      if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
      return r.text().then(function (t) {
        try { var j = JSON.parse(t); return { ok: j && j.ok === true, why: j && j.error }; }
        catch (e) { return { ok: false, why: '応答が読めない' }; }
      });
    });
  }

  // ── 自動報告（su-errors.js の通知を受ける）──
  function autoThrottled(sig) {
    var now = Date.now(), map = null;
    try { map = JSON.parse(localStorage.getItem(AUTO_LS) || 'null'); } catch (e) { map = null; }
    if (!map || typeof map !== 'object') map = {};
    var last = map[sig] || 0;
    if (now - last < AUTO_GAP_MS) return true;
    var keep = {};   // 古い記録は捨てる（増え続けないように）。保存できなくてもメモリの上限で止まる
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k) && now - map[k] < AUTO_GAP_MS) keep[k] = map[k];
    keep[sig] = now;
    try { localStorage.setItem(AUTO_LS, JSON.stringify(keep)); } catch (e) { /* 書けなくても送る */ }
    return false;
  }
  function autoSend(kind, brief, where) {
    var url = endpoint();
    if (!url) return;                                      // 送信先が無い端末では何もしない
    if (autoSent >= AUTO_MAX_PER_LOAD) return;
    var type = String(kind || 'エラー') + '：' + errType(brief);   // 例「スクリプトエラー：TypeError」。文の中身は送らない
    var w = cleanWhere(where);
    var sig = FILE + '|' + type + '|' + w;
    if (autoThrottled(sig)) return;
    autoSent++;
    post(url, composeAuto(type, w)).then(null, function () { /* 送れなくても画面には何も出さない */ });
  }
  try {
    if (window.SUErrors && typeof window.SUErrors.onReport === 'function') {
      window.SUErrors.onReport(function (kind, brief, where) {
        try { pushErr(String(kind || 'エラー') + '：' + errType(brief) + (cleanWhere(where) ? ' @' + cleanWhere(where) : '')); } catch (e) { /* 何もしない */ }
        try { autoSend(kind, brief, where); } catch (e) { /* 何もしない */ }
      });
    }
  } catch (e) { /* su-errors.js が無い画面では自動報告は無い */ }

  // ── UI ──
  // 他の画面の中に枠（iframe）として埋め込まれている時はボタンを出さない（左右比較は外側の画面に1つあれば足りる）。
  var inFrame = false;
  try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }
  if (inFrame) return;

  var css = document.createElement('style');
  css.textContent = [
    /* z-index は画面のモーダル（各画面 40〜1000）より下に置く＝モーダルが開いている間はその下に隠れ、「保存」などを覆わない。
       接続先の案内の帯（su-cfg-hint）はこのボタンの実寸を測って上に乗るので、重ならない */
    '.sur-fab{position:fixed;right:14px;bottom:14px;z-index:30;min-height:44px;min-width:44px;',
    'padding:10px 16px;border:0;border-radius:999px;background:var(--pri,#0b57d0);color:#fff;font:600 14px/1.2 system-ui,sans-serif;',
    'box-shadow:var(--sh,0 1px 6px rgba(0,0,0,.12));cursor:pointer}',
    '.sur-fab:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}',
    '.sur-dlg{border:0;border-radius:var(--r,12px);padding:0;width:min(560px,94vw);box-shadow:0 8px 30px rgba(0,0,0,.25)}',
    '.sur-dlg::backdrop{background:rgba(0,0,0,.45)}',
    '.sur-dlg.sur-fallback{position:fixed;left:3vw;top:5vh;z-index:2147483001;display:none;max-height:90vh;overflow:auto}',
    '.sur-dlg.sur-fallback.sur-open{display:block}',
    '.sur-in{padding:18px;font:14px/1.6 system-ui,sans-serif;color:var(--g9,#202124);background:#fff}',
    '.sur-in h2{margin:0 0 4px;font-size:17px}',
    '.sur-in p{margin:0 0 12px;color:var(--g7,#5f6368);font-size:13px}',
    '.sur-in p.sur-warn{color:#8a3a00;font-weight:600}',
    '.sur-in label{display:block;font-weight:600;margin:12px 0 4px}',
    '.sur-in textarea{width:100%;min-height:88px;padding:10px;border:1px solid var(--g3,#dadce0);border-radius:8px;font:inherit;box-sizing:border-box}',
    '.sur-pre{white-space:pre-wrap;background:var(--g0,#f8f9fa);border:1px solid var(--g2,#e8eaed);border-radius:8px;padding:10px;',
    'font:12px/1.5 ui-monospace,monospace;max-height:34vh;overflow:auto;margin-top:6px}',
    '.sur-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}',
    '.sur-btn{min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid var(--g3,#dadce0);background:#fff;font:600 14px system-ui;cursor:pointer}',
    '.sur-btn.pri{background:var(--pri,#0b57d0);color:#fff;border-color:transparent}',
    '.sur-ok{margin-top:10px;color:#0842a0;font-weight:600}',
    '.sur-note{margin-top:10px;font-size:12px;color:var(--g7,#5f6368)}',
    '@media (max-width:260px){.sur-fab{padding:8px 10px;font-size:13px}}',   /* 表示200%（CSS幅200px前後）では小さめにして中身を隠しすぎない */
    '@media print{.sur-fab,.sur-dlg{display:none!important}}'
  ].join('');
  document.head.appendChild(css);

  var fab = document.createElement('button');
  fab.className = 'sur-fab';
  fab.type = 'button';
  fab.textContent = '不具合を報告';
  fab.setAttribute('aria-haspopup', 'dialog');

  var dlg = document.createElement('dialog');
  dlg.className = 'sur-dlg';
  dlg.setAttribute('aria-label', '不具合の報告');
  var canModal = typeof dlg.showModal === 'function';
  if (!canModal) dlg.className += ' sur-fallback';   // <dialog> が無い古いブラウザでは、普通の枠として出す
  dlg.innerHTML =
    '<div class="sur-in">' +
    '<h2>不具合を報告する</h2>' +
    '<p>何が起きたかを書いてください。端末やエラーの情報は自動で付きます。</p>' +
    '<p class="sur-warn">この報告は、直す担当が見る公開の場所に載ります。入居者・職員の氏名、居室番号、病名は書かないでください。</p>' +
    '<label for="sur-sym">何が起きましたか</label>' +
    '<textarea id="sur-sym" placeholder="例：印刷すると右端が切れる／保存を押しても戻ってしまう"></textarea>' +
    '<label>送る内容（これがそのまま渡ります）</label>' +
    '<div class="sur-pre" id="sur-prev"></div>' +
    '<div class="sur-row">' +
    '<button class="sur-btn pri" id="sur-copy" type="button">この内容をコピー</button>' +
    '<button class="sur-btn" id="sur-send" type="button" hidden>そのまま送信</button>' +
    '<button class="sur-btn" id="sur-close" type="button">とじる</button>' +
    '</div><div class="sur-ok" id="sur-msg" hidden></div>' +
    '<div class="sur-note" id="sur-note" hidden>この端末は送信先が設定されているため、画面でエラーが起きた時は、エラーの種類・ファイル名・行番号・端末の種類だけが自動で送られます（エラーの文の中身、氏名、記録、合言葉は送りません）。</div>' +
    '</div>';

  function openDlg() { if (canModal) dlg.showModal(); else dlg.classList.add('sur-open'); }
  function closeDlg() { if (canModal) dlg.close(); else dlg.classList.remove('sur-open'); }
  function refresh() {
    dlg.querySelector('#sur-prev').textContent = compose(dlg.querySelector('#sur-sym').value.trim());
  }
  fab.addEventListener('click', function () {
    refresh();
    dlg.querySelector('#sur-msg').hidden = true;
    var has = !!endpoint();
    dlg.querySelector('#sur-send').hidden = !has;
    dlg.querySelector('#sur-note').hidden = !has;
    openDlg();
    dlg.querySelector('#sur-sym').focus();
  });

  /* ボタンの置き場所を自分で測る（画面ごとの CSS に手を入れない）。
     ・下端に接する幅広の固定要素（下のナビバー等）があれば、その上へ上げる
     ・右下の候補の場所に、別の固定要素（週間計画の「＋」等）が重なるなら左下へ寄る。左下も重なるなら、重なる要素の上へ
     ・自分・報告ダイアログ・接続先の案内の帯（#su-cfg-hint）・エラーの帯（[data-su-err]）は見ない
       （帯の方がこのボタンを避けて上に乗る＝su-cfg-hint.js の liftAboveReportButton）
     ・見るのは body の子と孫、それに名前に fab / bnav / float を含む要素（画面全体を毎回なめない） */
  function fixedRects() {
    var out = [], seen = [], els = [], i, j;
    try {
      var kids = document.body.children;
      for (i = 0; i < kids.length; i++) {
        els.push(kids[i]);
        var g = kids[i].children;
        for (j = 0; j < g.length && j < 40; j++) els.push(g[j]);
      }
      var named = document.querySelectorAll('[class*="fab"],[class*="bnav"],[class*="float"],nav,footer');
      for (i = 0; i < named.length && i < 60; i++) els.push(named[i]);
    } catch (e) { return out; }
    var H = window.innerHeight;
    for (i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || seen.indexOf(el) !== -1) continue;
      seen.push(el);
      if (el === fab || el === dlg || el.id === 'su-cfg-hint' || el.hasAttribute('data-su-err')) continue;
      var cs = window.getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.height > 200) continue;       // 画面全体に広がる枠（盤面・暗幕・パネル）は見ない
      if (r.bottom < H - 120) continue;                                   // 下の方に無いものは関係ない
      out.push(r);
    }
    return out;
  }
  function overlaps(a, b, gap) {
    return !(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top);
  }
  function place() {
    try {
      if (!fab.isConnected || document.hidden) return;
      var H = window.innerHeight, W = window.innerWidth;
      var rects = fixedRects(), lift = 0, i;
      for (i = 0; i < rects.length; i++) {
        if (rects[i].width >= W * 0.6 && rects[i].bottom >= H - 2) lift = Math.max(lift, Math.round(H - rects[i].top));   // 下端のバー
      }
      var fw = fab.offsetWidth || 120, fh = fab.offsetHeight || 44;
      var bottom = 14 + lift;
      var right = { left: W - 14 - fw, right: W - 14, top: H - bottom - fh, bottom: H - bottom };
      var left = { left: 14, right: 14 + fw, top: right.top, bottom: right.bottom };
      function busy(box) {
        for (var k = 0; k < rects.length; k++) {
          var r = rects[k];
          if (r.width >= W * 0.6) continue;             // バーは lift で避けた
          if (overlaps(box, r, 8)) return r;
        }
        return null;
      }
      var side = 'right', hit = busy(right);
      if (hit) { side = 'left'; var hit2 = busy(left); if (hit2) { side = 'right'; bottom = Math.round(H - Math.min(hit.top, hit2.top)) + 8; } }
      fab.style.bottom = bottom + 'px';
      if (side === 'left') { fab.style.right = 'auto'; fab.style.left = '14px'; }
      else { fab.style.left = 'auto'; fab.style.right = '14px'; }
    } catch (e) { /* 測れなくても右下に出す */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(fab);
    document.body.appendChild(dlg);
    place();
    setTimeout(place, 1000);
    setTimeout(place, 3000);
    window.addEventListener('resize', place);
    setInterval(place, 2000);   // 後から現れるバー・ボタン（入居者を開いた時など）にも追従する。隠れたタブでは何もしない
    /* 画面が変わった直後（利用者を選んで「＋」が出た時など）にもすぐ置き直す。2秒待つ間に重なったままにしない */
    try {
      var pend = 0;
      new MutationObserver(function () {
        if (pend) return;
        pend = setTimeout(function () { pend = 0; place(); }, 120);
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    } catch (e) { /* 監視できなければ 2秒ごとの置き直しだけ */ }
    /* 報告の枠の中のキー操作（Esc など）を、裏の画面に伝えない（裏のモーダルまで閉じて入力が消えないように） */
    dlg.addEventListener('keydown', function (e) { e.stopPropagation(); });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeDlg(); });
    dlg.querySelector('#sur-sym').addEventListener('input', refresh);
    dlg.querySelector('#sur-close').addEventListener('click', closeDlg);
    dlg.querySelector('#sur-copy').addEventListener('click', function () {
      var txt = compose(dlg.querySelector('#sur-sym').value.trim());
      var msg = dlg.querySelector('#sur-msg');
      function done(ok) {
        msg.hidden = false;
        msg.textContent = ok ? 'コピーしました。LINEなどに貼って送ってください。'
          : 'コピーできませんでした。上の枠の文字を選んでコピーしてください。';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    });
    dlg.querySelector('#sur-send').addEventListener('click', function () {
      var msg = dlg.querySelector('#sur-msg');
      var url = endpoint();
      if (!url) {
        msg.hidden = false;
        msg.textContent = '送信先が正しく設定されていません。コピーして送ってください。';
        return;
      }
      var btn = dlg.querySelector('#sur-send');
      btn.disabled = true;
      post(url, compose(dlg.querySelector('#sur-sym').value.trim())).then(function (r) {
        msg.hidden = false;
        msg.textContent = r.ok ? '送信しました。ありがとうございます。'
          : '送信先に受け付けられませんでした（合言葉の違いなど）。コピーして送ってください。';
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = '送信できませんでした。コピーして送ってください。';
      }).then(function () { btn.disabled = false; });
    });
  });
})();
