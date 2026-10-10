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
 * ★2026-10-04（代表者の決定・提案3）: 画面の指摘（注釈モード）。管理者（Google＋2段階認証でログイン中）にだけ、
 *   報告の枠に「画面の場所を指して報告」を出す。押すと su-annot.js を読み込み、画面の部品を指して一言ずつ書ける。
 *   送るのは「【画面の指摘】」で始まる本文（指摘ごとの一言・部品の場所・大きさ）と、文字を塗りつぶした配置図（数値だけ）。
 *   管理者かどうかは、この端末にログインの記録がある時だけ su-auth.js に聞く（現場端末では聞かない）。
 *   これは「ボタンを出すかどうか」だけの判定で、受け付けるかどうかは今までどおり受け口の合言葉が決める。
 *
 * 使い方: 各ツールの </body> の直前で
 *   <script src="su-report.js?v=2026-10-10" data-tool="週間計画"></script>
 */
(function () {
  'use strict';
  if (window.__suReportLoaded) return;
  window.__suReportLoaded = true;

  var TOOL = (document.currentScript && document.currentScript.dataset.tool) || document.title || location.pathname;
  var FILE = (location.pathname.split('/').pop() || location.pathname).split('?')[0];
  var T0 = Date.now();
  var ERRORS = [];   // 直近のJSエラー（種類と場所だけ・最大5件）
  var NOTES = [];    // 画面に出さない記録（su-errors.js の note）の控え（種類と場所だけ・最大3件）。ERRORS と分ける＝本物のエラーを押し出さない
  var AUTO_LS = 'su_report_auto_v1';          // 自動報告の間引き（{署名: 送った時刻}）
  var AUTO_GAP_MS = 30 * 60 * 1000;           // 同じエラーは30分に1回
  var AUTO_MAX_PER_LOAD = 10;                 // 1回の画面表示で自動送信する上限（暴走しても止まる）
  var autoSent = 0;
  /* su-errors.js の note（画面に出さない記録・2026-10-08 監査10月版 #8）から来たものは、1回の画面表示で1件だけ送る。
     容量いっぱいの端末では間引きの控えも書けず、別々の場所の失敗が一度に来るため、上限の10件を使い切って
     後から起きた本物のスクリプトエラーが送られなくなる（2026-10-08 審査の指摘）。 */
  var NOTE_KIND = '保存・同期の失敗';
  var autoNoteSent = 0;
  /* ★note は「場所（where）ごとに1件・1回の画面表示で合計3件まで」（2026-10-10・監査10月版 第2版 13）。
     以前は合計1件だけで、最初の軽い失敗が、後から別の場所で起きた本物の失敗の報告を塞いでいた。 */
  var AUTO_NOTE_MAX = 3;
  var autoNoteWhere = {};

  /* エラー文からは「種類」だけを取り出す（文の中身は送らない）。where は ファイル名:行 だけ（クエリは落とす） */
  function errType(msg) {
    var s = String(msg || '');
    var m = s.match(/\b([A-Z][A-Za-z]*Error)\b/);
    return m ? m[1] : 'エラー';
  }
  function cleanWhere(where) {
    /* note の場所は「画面:何の書き込み」の決まった言葉（例 care:未送信の印・weight:未送信の控え）。データは入らないのでそのまま残す */
    var n = String(where || '').match(/^[a-z]{2,12}:[^\s:/?#<>"'&]{1,40}$/);
    if (n) return n[0];
    var w = String(where || '').replace(/[?#][^:]*/, '');
    var m = w.match(/([A-Za-z0-9_.-]+\.(?:html|js)):?(\d+)?/);
    return m ? (m[1] + (m[2] ? ':' + m[2] : '')) : '';
  }
  function pushErr(s, list, max) {
    list = list || ERRORS; max = max || 5;
    s = String(s || '').replace(/\s+/g, ' ').slice(0, 120);
    if (!s) return;
    if (list.indexOf(s) === -1) list.push(s);
    if (list.length > max) list.shift();
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

  function oneLine(s) { return String(s || '').replace(/\r?\n/g, ' ／ '); }
  function compose(symptom) {
    var L = [], ann = annot && annot.marks.length ? annot : null;
    L.push((ann ? '【画面の指摘】' : '【不具合報告】') + new Date().toLocaleString('ja-JP'));
    L.push('ツール: ' + TOOL + '（' + FILE + '）');
    L.push('症状: ' + (symptom ? oneLine(symptom) : '（未記入）'));   // 症状は1行にする（行頭の見出しと紛れないように）
    if (ann) {
      for (var j = 0; j < ann.marks.length; j++) {
        var m = ann.marks[j];
        L.push('指摘 ' + m.n + ': ' + oneLine(m.note) + ' ／ 部品: ' + m.sel + (m.desc ? ' ／ ' + m.desc : ''));
      }
    }
    L.push('──── ここから下は自動で付いた情報です ────');
    L = L.concat(facts());
    L.push('画面のエラー: ' + (ERRORS.length ? ERRORS.length + '件（種類と場所だけ）' : 'なし'));
    for (var i = 0; i < ERRORS.length; i++) L.push('  ' + (i + 1) + ') ' + ERRORS[i]);
    if (NOTES.length) {
      L.push('保存・同期の記録（画面には出していない）: ' + NOTES.length + '件（種類と場所だけ）');
      for (var k = 0; k < NOTES.length; k++) L.push('  ' + (k + 1) + ') ' + NOTES[k]);
    }
    if (ann) L.push('配置図: ' + (ann.layout ? '添付（部品の四角 ' + ann.layout.r.length + '個・文字は含まない）' : '作れなかった'));
    return L.join('\n');
  }
  /* 送る本文。配置図は最後の1行に数値だけで付ける（コピーには付けない＝LINE などに貼るには長すぎるため） */
  function payload(symptom) {
    var t = compose(symptom);
    if (annot && annot.marks.length && annot.layout) t += '\nSU-LAYOUT-V1 ' + JSON.stringify(annot.layout);
    return t;
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
  /* ★合言葉は URL に付けず、本文の1行目「SU-KEY-V1 <合言葉>」で送る（2026-10-10・監査10月版 第2版 8）。
     URL の ?k= は Apps Script の実行ログや途中の機器のログに残りうるため。受け口（gas/su-report-api.gs）は
     1行目を照合したら外し、シートには残さない。画面に出す本文・コピーには入らない（送る時だけ付ける）。 */
  function reportToken() {
    try {
      var tok = String(localStorage.getItem('su_report_token') || '').trim();
      return /[\r\n]/.test(tok) ? '' : tok.slice(0, 200);
    } catch (e) { return ''; }
  }
  function endpoint() {
    try {
      var url = String(localStorage.getItem('su_report_endpoint') || '').trim();
      if (!/^https:\/\//i.test(url) || !reportToken()) return '';     // https:// 以外（http:・javascript: 等）へは送らない
      return url;
    } catch (e) { return ''; }
  }
  /* 受け口の応答（JSON の ok）まで見る。HTTP が 200 でも合言葉違い・形式違いは ok:false で返る */
  function post(url, body) {
    var tok = reportToken();
    if (!tok) return Promise.resolve({ ok: false, why: '合言葉が無い' });
    body = 'SU-KEY-V1 ' + tok + '\n' + body;
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body, keepalive: body.length < 20000   // keepalive は 64KB までしか送れない。配置図つきの大きい報告は普通に送る
    }).then(function (r) {
      if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
      return r.text().then(function (t) {
        try { var j = JSON.parse(t); return { ok: j && j.ok === true, why: j && j.error }; }
        catch (e) { return { ok: false, why: '応答が読めない' }; }
      });
    });
  }

  // ── 画面の指摘（管理者だけ）──
  var annot = null;   // { marks: [{ n, note, sel, desc, el }], layout }
  var ANNOT_SRC = 'su-annot.js?v=2026-10-04';
  // 管理者かどうかを聞くための部品。各画面が読む時と同じ版を書く（su-auth.js を直して ?v= を上げたら、ここも上げる）
  var AUTH_SRC = ['supabase-js-2.112.4.js', 'su-auth.js?v=2026-09-26'];
  var loading = {};
  /* 画面がすでに同じ部品の札（<script src>）を入れている時は、2本目を入れずに読み終わるのを待つ（su-auth.js を二重に動かさない） */
  function waitFor(test, ms) {
    return new Promise(function (ok, ng) {
      var t0 = Date.now();
      (function poll() { if (test()) ok(); else if (Date.now() - t0 > ms) ng(new Error('待ちきれない')); else setTimeout(poll, 100); })();
    });
  }
  function hasTag(name) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) if (String(ss[i].getAttribute('src') || '').split('?')[0].split('/').pop() === name) return true;
    return false;
  }
  function loadAuth() {
    if (window.SUAuth) return Promise.resolve();
    if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
    var lib = window.supabase ? Promise.resolve()
      : (hasTag(AUTH_SRC[0]) ? waitFor(function () { return !!window.supabase; }, 8000) : loadScript(AUTH_SRC[0]));
    return lib.then(function () { return window.SUAuth ? null : loadScript(AUTH_SRC[1]); });
  }
  function loadScript(src) {
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { ok(); };
      s.onerror = function () { delete loading[src]; try { s.remove(); } catch (e) { /* 何もしない */ } ng(new Error('読み込めない: ' + src)); };   // 失敗した札は残さない（他の部品が「読み込み中」と思って待たないように）
      document.head.appendChild(s);
    });
    return loading[src];
  }
  /* この端末にログインの記録があるか（キーの名前だけを見る。中身は読まない） */
  function hasLogin() {
    try {
      for (var i = 0; i < localStorage.length; i++) if (/^sb-[a-z0-9]+-auth-token$/.test(localStorage.key(i) || '')) return true;
    } catch (e) { /* 読めなければ無いものとする */ }
    return false;
  }
  var adminP = null;
  function isAdmin() {
    if (adminP) return adminP;
    if (role() === '現場端末' || !hasLogin() || typeof Promise === 'undefined') return Promise.resolve(false);
    adminP = new Promise(function (done) {
      var t = setTimeout(function () { done(false); }, 10000);
      loadAuth().then(function () { return window.SUAuth.check(); }).then(function (r) {
        clearTimeout(t);
        done(!!(r && r.status === window.SUAuth.STATUS.OK && r.role === 'admin'));
      }).catch(function () { clearTimeout(t); done(false); });
    }).then(function (ok) { if (!ok) adminP = null; return ok; });   // 管理者でなかった・聞けなかった時は、次に枠を開いた時にもう一度聞く
    return adminP;
  }

  // ── 自動報告（su-errors.js の通知を受ける）──
  /* ★容量がいっぱいで localStorage に控えを書けない端末では sessionStorage に控える（2026-10-10・第2版 13）。
     書けないまま送ると、再読み込みのたびに同じ報告を送ってしまう。読む時は両方を合わせて見る。 */
  function autoThrottled(sig) {
    var now = Date.now(), map = null, ss = null;
    try { map = JSON.parse(localStorage.getItem(AUTO_LS) || 'null'); } catch (e) { map = null; }
    if (!map || typeof map !== 'object') map = {};
    try { ss = JSON.parse(sessionStorage.getItem(AUTO_LS) || 'null'); } catch (e) { ss = null; }
    if (ss && typeof ss === 'object') for (var s in ss) if (Object.prototype.hasOwnProperty.call(ss, s) && !(map[s] >= ss[s])) map[s] = ss[s];
    var last = map[sig] || 0;
    if (now - last < AUTO_GAP_MS) return true;
    var keep = {};   // 古い記録は捨てる（増え続けないように）。保存できなくてもメモリの上限で止まる
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k) && now - map[k] < AUTO_GAP_MS) keep[k] = map[k];
    keep[sig] = now;
    var json = JSON.stringify(keep);
    try { localStorage.setItem(AUTO_LS, json); }
    catch (e) { try { sessionStorage.setItem(AUTO_LS, json); } catch (e2) { /* どちらも書けなくても送る（1回の表示の上限で止まる） */ } }
    return false;
  }
  function autoSend(kind, brief, where) {
    var url = endpoint();
    if (!url) return;                                      // 送信先が無い端末では何もしない
    if (autoSent >= AUTO_MAX_PER_LOAD) return;
    var type = String(kind || 'エラー') + '：' + errType(brief);   // 例「スクリプトエラー：TypeError」。文の中身は送らない
    var w = cleanWhere(where);
    var isNote = String(kind) === NOTE_KIND;
    if (isNote && (autoNoteSent >= AUTO_NOTE_MAX || autoNoteWhere[w])) return;
    var sig = FILE + '|' + type + '|' + w;
    if (autoThrottled(sig)) return;
    autoSent++;
    if (isNote) { autoNoteSent++; autoNoteWhere[w] = 1; }
    post(url, composeAuto(type, w)).then(null, function () { /* 送れなくても画面には何も出さない */ });
  }
  try {
    if (window.SUErrors && typeof window.SUErrors.onReport === 'function') {
      window.SUErrors.onReport(function (kind, brief, where) {
        try {
          var line = String(kind || 'エラー') + '：' + errType(brief) + (cleanWhere(where) ? ' @' + cleanWhere(where) : '');
          if (String(kind) === NOTE_KIND) pushErr(line, NOTES, 3); else pushErr(line);
        } catch (e) { /* 何もしない */ }
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
    '.sur-ann{margin-top:10px}',
    '.sur-ann ol{margin:4px 0 0;padding-left:1.6em}',
    '.sur-ann li{margin:2px 0}',
    '.sur-ann canvas{display:block;max-width:100%;max-height:40vh;margin-top:8px;border:1px solid var(--g3,#dadce0);border-radius:8px}',
    /* hidden 属性は上の display:block に負けて隠れない。配置図を描けなかった時に空の枠が出ていた（2026-10-09） */
    '.sur-ann canvas[hidden]{display:none}',
    '.sur-fab.sur-hide{visibility:hidden}',
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
    '<div class="sur-ann" id="sur-ann" hidden>' +
    '<button class="sur-btn" id="sur-pick" type="button">画面の場所を指して報告</button>' +
    '<div id="sur-ann-box" hidden>' +
    '<label>画面の指摘</label><ol id="sur-ann-list"></ol>' +
    '<canvas id="sur-ann-cv" role="img" aria-label="一緒に送る配置図（文字は塗りつぶし）"></canvas>' +
    '<div class="sur-note">この絵（配置図）も一緒に送ります。部品の四角と、文字がある所の帯だけです。文字・入力の値・写真は入っていません。</div>' +
    '<div class="sur-row"><button class="sur-btn" id="sur-repick" type="button">指し直す</button>' +
    '<button class="sur-btn" id="sur-unpick" type="button">指摘を消す</button></div>' +
    '</div></div>' +
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
    isAdmin().then(function (ok) { if (ok) dlg.querySelector('#sur-ann').hidden = false; }, function () { /* 出さない */ });
  });
  function renderAnnot() {
    var box = dlg.querySelector('#sur-ann-box'), list = dlg.querySelector('#sur-ann-list');
    var has = !!(annot && annot.marks.length);
    box.hidden = !has;
    dlg.querySelector('#sur-pick').hidden = has;
    list.innerHTML = '';
    if (!has) return;
    annot.marks.forEach(function (m) {
      var li = document.createElement('li');
      li.textContent = m.note;
      list.appendChild(li);
    });
    var cv = dlg.querySelector('#sur-ann-cv');
    var drawn = false;
    try { drawn = !!(annot.layout && window.SUAnnot && window.SUAnnot.draw(cv, annot.layout, 1)); } catch (e) { drawn = false; }
    cv.hidden = !drawn;
  }
  function startPick() {
    var msg = dlg.querySelector('#sur-msg');
    closeDlg();
    fab.classList.add('sur-hide');
    function back() { fab.classList.remove('sur-hide'); renderAnnot(); refresh(); msg.hidden = true; openDlg(); }
    loadScript(ANNOT_SRC).then(function () {
      var ok = window.SUAnnot.start({
        marks: annot ? annot.marks : null,
        onDone: function (res) { annot = res && res.marks && res.marks.length ? res : null; back(); },
        onCancel: back
      });
      if (!ok) back();
    }).catch(function () {
      back();
      msg.hidden = false;
      msg.textContent = '画面の指摘の部品を読み込めませんでした。電波を確かめてから、もう一度押してください。';
    });
  }

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
    dlg.querySelector('#sur-pick').addEventListener('click', startPick);
    dlg.querySelector('#sur-repick').addEventListener('click', startPick);
    dlg.querySelector('#sur-unpick').addEventListener('click', function () { annot = null; renderAnnot(); refresh(); });
    dlg.querySelector('#sur-copy').addEventListener('click', function () {
      var txt = compose(dlg.querySelector('#sur-sym').value.trim());
      var msg = dlg.querySelector('#sur-msg');
      function done(ok) {
        msg.hidden = false;
        msg.textContent = ok ? 'コピーしました。LINEなどに貼って送ってください。' + (annot && annot.marks.length ? '（配置図の絵はコピーに入りません）' : '')
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
      post(url, payload(dlg.querySelector('#sur-sym').value.trim())).then(function (r) {
        msg.hidden = false;
        if (r.ok && annot) { annot = null; renderAnnot(); refresh(); }   // 送った指摘は消す（次の報告で同じものをもう一度送らない）
        msg.textContent = r.ok ? '送信しました。ありがとうございます。'
          : '送信先に受け付けられませんでした（合言葉の違いなど）。コピーして送ってください。';
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = '送信できませんでした。コピーして送ってください。';
      }).then(function () { btn.disabled = false; });
    });
  });
})();
