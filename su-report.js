/* su-report.js — 現場から不具合を1タップで報告するための共有部品（2026-09-06 新設）
 *
 * なぜ必要か: 稼働中ツールの不具合は「職員 → 代表 → Claude」の口伝でしか届かず、
 *   届く頃には「印刷が崩れる」まで圧縮されて端末・ブラウザ・状態が失われている。
 *   そのため再現に往復が増える。押した瞬間の状況を機械が添える。
 *
 * 個人情報の扱い（設計の中心）:
 *   ・集めるのは下の allowlist だけ。localStorage の【値】は一切読まない。
 *     接続設定は「設定あり/なし」の真偽だけを見る（宛先も合言葉も読まない・書かない）。
 *   ・入居者名・記録・処方は自動収集しない。自由記述に書くかどうかは職員の判断。
 *   ・送る前に【全文を画面に出す】。本人が見ていない文字は外に出ない。
 *
 * 動作:
 *   既定は「本文をコピー」— LINE等に貼って送る。サーバーは要らない。
 *   window.SU_REPORT_ENDPOINT を設定すると、そのURLへ POST する経路も出る（未設定なら出さない）。
 *
 * 使い方: 各ツールの </body> の直前で
 *   <script src="su-report.js" data-tool="週間計画"></script>
 */
(function () {
  'use strict';
  if (window.__suReportLoaded) return;
  window.__suReportLoaded = true;

  var TOOL = (document.currentScript && document.currentScript.dataset.tool) || document.title || location.pathname;
  var FILE = location.pathname.split('/').pop() || location.pathname;
  var T0 = Date.now();
  var ERRORS = [];   // 直近のJSエラー（最大5件）

  function pushErr(s) {
    s = String(s || '').replace(/\s+/g, ' ').slice(0, 160);
    if (!s) return;
    if (ERRORS.indexOf(s) === -1) ERRORS.push(s);
    if (ERRORS.length > 5) ERRORS.shift();
  }
  window.addEventListener('error', function (e) {
    pushErr((e.message || 'エラー') + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    pushErr('未処理のPromise: ' + ((e.reason && (e.reason.message || e.reason)) || ''));
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

  function compose(symptom) {
    var mins = Math.round((Date.now() - T0) / 60000);
    var L = [];
    L.push('【不具合報告】' + new Date().toLocaleString('ja-JP'));
    L.push('ツール: ' + TOOL + '（' + FILE + '）');
    L.push('症状: ' + (symptom || '（未記入）'));
    L.push('──── ここから下は自動で付いた情報です ────');
    L.push('端末: ' + device() + ' / 画面 ' + window.innerWidth + '×' + window.innerHeight + '（倍率' + (window.devicePixelRatio || 1) + '）');
    L.push('役割: ' + role() + ' ／ 接続: ' + connected());
    L.push('版: ' + build() + ' ／ この画面を開いてから ' + mins + '分');
    L.push('画面のエラー: ' + (ERRORS.length ? ERRORS.length + '件' : 'なし'));
    for (var i = 0; i < ERRORS.length; i++) L.push('  ' + (i + 1) + ') ' + ERRORS[i]);
    return L.join('\n');
  }

  // ── UI ──
  var css = document.createElement('style');
  css.textContent = [
    '.sur-fab{position:fixed;right:14px;bottom:14px;z-index:2147483000;min-height:44px;min-width:44px;',
    'padding:10px 16px;border:0;border-radius:999px;background:var(--pri,#0b57d0);color:#fff;font:600 14px/1.2 system-ui,sans-serif;',
    'box-shadow:var(--sh,0 1px 6px rgba(0,0,0,.12));cursor:pointer}',
    '.sur-fab:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}',
    '.sur-dlg{border:0;border-radius:var(--r,12px);padding:0;width:min(560px,94vw);box-shadow:0 8px 30px rgba(0,0,0,.25)}',
    '.sur-dlg::backdrop{background:rgba(0,0,0,.45)}',
    '.sur-in{padding:18px;font:14px/1.6 system-ui,sans-serif;color:var(--g9,#202124);background:#fff}',
    '.sur-in h2{margin:0 0 4px;font-size:17px}',
    '.sur-in p{margin:0 0 12px;color:var(--g7,#5f6368);font-size:13px}',
    '.sur-in label{display:block;font-weight:600;margin:12px 0 4px}',
    '.sur-in textarea{width:100%;min-height:88px;padding:10px;border:1px solid var(--g3,#dadce0);border-radius:8px;font:inherit;box-sizing:border-box}',
    '.sur-pre{white-space:pre-wrap;background:var(--g0,#f8f9fa);border:1px solid var(--g2,#e8eaed);border-radius:8px;padding:10px;',
    'font:12px/1.5 ui-monospace,monospace;max-height:34vh;overflow:auto;margin-top:6px}',
    '.sur-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}',
    '.sur-btn{min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid var(--g3,#dadce0);background:#fff;font:600 14px system-ui;cursor:pointer}',
    '.sur-btn.pri{background:var(--pri,#0b57d0);color:#fff;border-color:transparent}',
    '.sur-ok{margin-top:10px;color:#0842a0;font-weight:600}',
    '@media print{.sur-fab{display:none}}'
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
  dlg.innerHTML =
    '<div class="sur-in">' +
    '<h2>不具合を報告する</h2>' +
    '<p>何が起きたかを書いてください。端末やエラーの情報は自動で付きます。</p>' +
    '<label for="sur-sym">何が起きましたか</label>' +
    '<textarea id="sur-sym" placeholder="例：印刷すると右端が切れる／保存を押しても戻ってしまう"></textarea>' +
    '<label>送る内容（これがそのまま渡ります）</label>' +
    '<div class="sur-pre" id="sur-prev"></div>' +
    '<div class="sur-row">' +
    '<button class="sur-btn pri" id="sur-copy" type="button">この内容をコピー</button>' +
    '<button class="sur-btn" id="sur-send" type="button" hidden>そのまま送信</button>' +
    '<button class="sur-btn" id="sur-close" type="button">とじる</button>' +
    '</div><div class="sur-ok" id="sur-msg" hidden></div></div>';

  function refresh() {
    dlg.querySelector('#sur-prev').textContent = compose(dlg.querySelector('#sur-sym').value.trim());
  }
  fab.addEventListener('click', function () {
    refresh();
    dlg.querySelector('#sur-msg').hidden = true;
    if (window.SU_REPORT_ENDPOINT) dlg.querySelector('#sur-send').hidden = false;
    dlg.showModal();
    dlg.querySelector('#sur-sym').focus();
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(fab);
    document.body.appendChild(dlg);
    dlg.querySelector('#sur-sym').addEventListener('input', refresh);
    dlg.querySelector('#sur-close').addEventListener('click', function () { dlg.close(); });
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
      fetch(window.SU_REPORT_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: compose(dlg.querySelector('#sur-sym').value.trim())
      }).then(function (r) {
        msg.hidden = false;
        msg.textContent = r.ok ? '送信しました。ありがとうございます。' : '送信できませんでした。コピーして送ってください。';
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = '送信できませんでした。コピーして送ってください。';
      });
    });
  });
})();
