/* 介護ツール共通 ── 画面が黙って壊れないようにする（2026-09-13 新設）
 *
 * なぜ要るか:
 *   これまで各ツールには window の error / unhandledrejection の捕捉が無く、描画中や非同期処理の
 *   例外はどこにも出なかった（空 catch も多い）。画面が途中まで描かれて止まっても、現場からは
 *   「開かない」「動かない」としか伝わらず、何が起きたか誰も分からなかった。
 *
 * ここでやるのは【記録と通知だけ】。復旧も再試行もしないので、既存の動作は一切変わらない。
 * 読み込むだけで有効になる（呼び出し側のコードは不要）。各ツールの <script> より前に置くこと。
 *
 * 個人情報を出さない:
 *   通知に載せるのは例外のメッセージとファイル名・行番号だけで、変数の中身は一切触らない。
 *   氏名・記録・合言葉が画面や通知に出ることはない。
 *
 * 通知先の優先順位:
 *   ①そのツールが持つトースト（showToast / toast）があれば使う＝見た目が揃う
 *   ②無ければ、このファイルが最小限の帯を自前で出す（ツールのCSSに依存しない）
 *   いずれも印刷には出さない（帯は @media print で消す）。
 *
 * ツール側からの追加（2026-09-24・任意／2026-10-04: 登録より前の通知も渡す）:
 *   window.SUErrors.onReport(fn)  … 通知のたびに fn(kind, brief, where) を呼ぶ（例: 同期ログへ残す）。
 *                                   fn が例外を出しても通知は止めない。間引き（30秒）を通った時だけ呼ぶ。
 *                                   登録より前に起きた通知（起動時の例外など・直近5件）も、登録した時にその場で渡す。
 *   window.SUErrors.report(kind, msg, where) … ツールが自分で拾った例外を同じ経路で知らせる。
 *   window.SUErrors.note(kind, msg, where)   … 画面には出さずに記録だけ残す（2026-10-08・監査10月版 #8）。
 *                                   保存・同期の補助（未送信の控え・同期の印・接続先の控えなど）で、黙って捨てると
 *                                   後で原因が追えない失敗に使う。コンソール（warn）と onReport の記録先にだけ渡し、
 *                                   トースト・帯は出さない（現場の画面に警告が続けて出ないように）。
 *                                   同じ組み合わせは30秒に1回（report と違い、組み合わせごとに数える＝交互に起きても止まる）。
 *                                   onReport の記録先には、note から来た時だけ4つ目に 'note' を渡す（2026-10-27。速さの記録が
 *                                   「黙って失敗した回数」を report と分けて数えるため。report の時は渡さない＝今までの記録先は3つだけ読めばよい）。
 *   onReport の記録先には、5つ目に「手がかり」{cls, status, code} を渡す（2026-11-21・代表者の決定「案1」）。
 *                                   例外の物（Error・supabase-js の失敗の物）から、決まった形の値だけを取り出す（下の hintOf）。
 *                                   文の中身は入れない。古い記録先は4つ目までしか読まないので、今までどおり動く。
 *   使わないツールの動きは今までと同じ。
 */
(function () {
  'use strict';
  if (window.__suErrorsInstalled) return;   /* 二重読み込みでも二重に出さない */
  window.__suErrorsInstalled = true;

  var THROTTLE_MS = 30000;                  /* 同じ例外が描画のたびに出続けると操作の邪魔になる */
  var lastSig = '', lastAt = 0;
  var MSG = '⚠ 画面でエラーが起きました。入力中の内容を控えて再読み込みしてください';
  var hooks = [];                           /* ツールが足す記録先（SUErrors.onReport） */
  var recent = [];                          /* 登録より前の通知を渡すための控え（直近5件・画面には出さない） */

  /* ツール側のトーストを借りる。関数名はツールによって違うので両方見る。 */
  function pageToast(msg) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg); return true; }
      if (typeof window.toast === 'function') { window.toast(msg); return true; }
    } catch (e) {}
    return false;
  }

  var styleDone = false;
  function ensureStyle() {
    if (styleDone) return;
    styleDone = true;
    try {
      var st = document.createElement('style');
      /* 17px＝介護現場要件の本文下限。#7a4200 on #fff8e1 でコントラスト比 約7.4:1。
         紙には出さない（帳票の下端に警告が刷り込まれないように）。 */
      st.textContent = '[data-su-err]{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;'
        + 'background:#fff8e1;color:#7a4200;border:1px solid #ffa000;border-radius:8px;'
        + 'padding:12px 14px;font-size:17px;font-weight:600;line-height:1.5;'
        + 'box-shadow:0 2px 10px rgba(0,0,0,.2)}'
        + '@media print{[data-su-err]{display:none!important}}';
      document.head.appendChild(st);
    } catch (e) {}
  }

  /* ツール側にトーストが無い時の最小限の帯。DOM がまだ無ければ用意できるまで待つ。 */
  function ownBanner(msg) {
    try {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', function () { ownBanner(msg); }, { once: true });
        return;
      }
      ensureStyle();
      var el = document.querySelector('[data-su-err]');
      if (!el) {
        el = document.createElement('div');
        el.setAttribute('data-su-err', '1');
        el.setAttribute('role', 'status');
        /* 直書きの <style> を禁じる画面（CSP の style-src 'self'・管理者向けの画面など）でも帯が下に固定して読めるように、
           要素へ直接付ける（CSSOM の指定は CSP でも効く）。値は上の <style> と同じ＝<style> が効く画面の見た目は変わらない。 */
        try {
          var S = el.style;
          S.position = 'fixed'; S.left = '12px'; S.right = '12px'; S.bottom = '12px'; S.zIndex = '2147483647';
          S.background = '#fff8e1'; S.color = '#7a4200'; S.border = '1px solid #ffa000'; S.borderRadius = '8px';
          S.padding = '12px 14px'; S.fontSize = '17px'; S.fontWeight = '600'; S.lineHeight = '1.5';
          S.boxShadow = '0 2px 10px rgba(0,0,0,.2)';
        } catch (e) {}
        document.body.appendChild(el);
      }
      el.textContent = msg;
      clearTimeout(ownBanner._t);
      ownBanner._t = setTimeout(function () { try { el.remove(); } catch (e) {} }, 12000);
    } catch (e) {}
  }

  /* 紙には出さない: <style> の @media print が効かない画面でも、印刷の前に帯を外す */
  try { window.addEventListener('beforeprint', function () { try { var b = document.querySelector('[data-su-err]'); if (b) b.remove(); } catch (e) {} }); } catch (e) {}

  /* 手がかり（2026-11-21・代表者の決定「案1」・不具合の自動報告で原因を分けるため）。
   * 例外の物から、決まった形の値だけを取り出す。文の中身・変数の値は入れない（個人情報が入る余地を作らない）。
   *   cls    … 区分。HINT_CLS の8つの言葉のどれか1つ
   *   status … HTTP の番号（100〜599 の整数）。物の status か、関数の失敗の応答（context.status）。無ければ 0
   *            （supabase-js のデータベースの失敗の物は status を持たない＝0。区分は符号で決まる）
   *   code   … データベースの符号（SQLSTATE の5文字の英大文字と数字、または PGRST と3桁の数字）。形の違う値は入れない
   * 区分の決め方（上から順に、最初に当たったもの）:
   *   時間切れ … 名前が AbortError・TimeoutError、または文が timeout・打ち切り・タイムアウト・時間切れ（文字だけの値も）
   *   通信の失敗 … 名前が NetworkError、または文が通信の失敗の決まり文句（Failed to fetch・Load failed など。
   *               supabase-js は通信の失敗を素の物 {message:'TypeError: Failed to fetch'} で返す）
   *   端末の保存領域 … 名前が QuotaExceededError
   *   断り … HTTP 401・403、名前が AuthError・ForbiddenError、符号が 42501・28000・28P01・PGRST301〜303
   *   サーバーの失敗 … HTTP 500 以上、名前が ServerError、符号が PGRST000〜002・57014・08xxx・53xxx
   *   コードの例外 … TypeError・ReferenceError・RangeError・SyntaxError・URIError・EvalError（上の通信の失敗を除く）
   *   不明 … それ以外 */
  var HINT_CLS = ['通信の失敗', '時間切れ', '断り', 'サーバーの失敗', 'コードの例外', '端末の保存領域', 'ブラウザが伏せた例外', '不明'];
  var HINT_NET = /failed to fetch|networkerror when attempting|network request failed|load failed|the internet connection appears to be offline/i;
  var HINT_TIMEOUT = /^(timeout|timed out|打ち切り|タイムアウト|時間切れ)$/i;
  function hintOf(x) {
    var h = { cls: '不明', status: 0, code: '' };
    try {
      /* 文字だけで来た値（'タイムアウト' など）は、決まり文句に当たる時だけ区分にする（番号・符号は無い） */
      if (typeof x === 'string') {
        if (HINT_TIMEOUT.test(x)) h.cls = '時間切れ';
        else if (HINT_NET.test(x)) h.cls = '通信の失敗';
        return h;
      }
      if (!x || typeof x !== 'object') return h;
      /* 番号: 物の status、無ければ関数（Edge Function）の失敗が持つ応答（context）の status */
      var st = Number(x.status);
      if (!(st >= 100 && st <= 599) && x.context && typeof x.context === 'object') st = Number(x.context.status);
      if (st >= 100 && st <= 599 && Math.floor(st) === st) h.status = st;
      var c = String(x.code == null ? '' : x.code);
      if (/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(c)) h.code = c;
      var name = String(x.name || ''), m = String(x.message || '');
      var isErr = x instanceof Error;
      if (name === 'AbortError' || name === 'TimeoutError' || (isErr && HINT_TIMEOUT.test(m))) h.cls = '時間切れ';
      /* 通信の失敗: 決まり文句・supabase-js の関数への通信の失敗（FunctionsFetchError）・画面が作り直した Error('network') */
      else if (name === 'NetworkError' || name === 'FunctionsFetchError' || HINT_NET.test(m) || (isErr && /^(network|通信失敗|通信の失敗)$/.test(m))) h.cls = '通信の失敗';
      else if (name === 'QuotaExceededError') h.cls = '端末の保存領域';
      else if (h.status === 401 || h.status === 403 || name === 'AuthError' || name === 'ForbiddenError' || /^(42501|28000|28P01|PGRST30[123])$/.test(h.code)) h.cls = '断り';
      else if (h.status >= 500 || name === 'ServerError' || name === 'FunctionsRelayError' || /^(PGRST00[012]|57014|08[0-9A-Z]{3}|53[0-9A-Z]{3})$/.test(h.code)) h.cls = 'サーバーの失敗';
      else if (isErr && /^(TypeError|ReferenceError|RangeError|SyntaxError|URIError|EvalError)$/.test(name)) h.cls = 'コードの例外';
    } catch (e) { /* 取り出せない物は「不明」のまま */ }
    return h;
  }

  function report(kind, msg, where, hint) {
    try {
      if (!hint) hint = hintOf(msg);
      var brief = String(msg == null ? '' : (msg.message || msg)).slice(0, 120);
      var sig = kind + '|' + brief + '|' + where;
      var now = Date.now();
      if (sig === lastSig && now - lastAt < THROTTLE_MS) return;
      lastSig = sig; lastAt = now;
      /* 開発時に原因へたどり着けるよう、詳細はコンソールへ残す（画面には出さない） */
      try { console.error('[su-errors] ' + kind + '：' + brief + (where ? '（' + where + '）' : '')); } catch (e) {}
      recent.push([kind, brief, where, hint]); if (recent.length > 5) recent.shift();
      for (var i = 0; i < hooks.length; i++) { try { hooks[i](kind, brief, where, undefined, hint); } catch (e) {} }
      if (!pageToast(MSG)) ownBanner(MSG);
    } catch (e) {}
  }

  var noteAt = {}, noteKeys = 0;
  var recentNotes = [];                     /* note の控えは別に持つ（起動中の note が本物の起動エラーを押し出さないように・直近3件） */
  /* note の要約。例外の名前（QuotaExceededError 等）を頭に付けて、種類が不具合報告に残るようにする。
     ★引用符の中は伏せる。JSON の読み込み失敗の文にはデータの断片（氏名など）がそのまま入るため
       （例: Unexpected token … "{"name":"…"}" is not valid JSON）。週間計画は要約を同期ログに出す。 */
  function noteBrief(msg) {
    var s = (msg && typeof msg === 'object' && msg.name && msg.message) ? (msg.name + ': ' + msg.message)
      : String(msg == null ? '' : (msg.message || msg));
    /* 二重引用符は最初から最後までをまとめて伏せる（JSON の断片は引用符が入れ子になり、1組ずつでは中の値が残る） */
    return s.replace(/"[\s\S]*"/, '"…"').replace(/'[^']*'/g, "'…'").replace(/“[\s\S]*”/, '“…”').slice(0, 120);
  }
  function note(kind, msg, where) {
    try {
      var brief = noteBrief(msg);
      var hint = hintOf(msg);
      var sig = kind + '|' + brief + '|' + where;
      var now = Date.now();
      if (noteAt[sig] && now - noteAt[sig] < THROTTLE_MS) return;
      if (++noteKeys > 200) { noteAt = {}; noteKeys = 1; }   /* 組み合わせの控えが増え続けないように */
      noteAt[sig] = now;
      try { console.warn('[su-errors] ' + kind + '：' + brief + (where ? '（' + where + '）' : '')); } catch (e) {}
      recentNotes.push([kind, brief, where, hint]); if (recentNotes.length > 3) recentNotes.shift();
      for (var i = 0; i < hooks.length; i++) { try { hooks[i](kind, brief, where, 'note', hint); } catch (e) {} }
    } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    /* 画像・スクリプトの読み込み失敗も同じイベントで来るが、あちらは message を持たない。
       通信の一時失敗で毎回警告を出しても現場は対処できないので、例外だけを対象にする。 */
    if (!e || (!e.message && !e.error)) return;
    var where = '';
    try {
      if (e.filename) where = String(e.filename).split('/').pop().split('?')[0].split('#')[0] + ':' + (e.lineno || 0);   /* クエリ（?masterId=… 等）は残さない */
    } catch (e2) {}
    /* 手がかり: 例外の物があればそこから。物も場所も無い＝ブラウザが中身を伏せた例外（別のサイト・拡張機能のスクリプトなど） */
    var h = (e.error && typeof e.error === 'object') ? hintOf(e.error) : { cls: where ? '不明' : 'ブラウザが伏せた例外', status: 0, code: '' };
    report('スクリプトエラー', e.message || (e.error && e.error.message) || '不明', where, h);
  });

  window.addEventListener('unhandledrejection', function (e) {
    report('未処理の失敗', (e && e.reason) || '不明', '');
  });

  window.SUErrors = {
    report: function (kind, msg, where) { report(String(kind || 'エラー'), msg, String(where || '')); },
    note: function (kind, msg, where) { note(String(kind || '記録'), msg, String(where || '')); },
    onReport: function (fn) {
      if (typeof fn !== 'function') return;
      hooks.push(fn);
      for (var i = 0; i < recent.length; i++) { try { fn(recent[i][0], recent[i][1], recent[i][2], undefined, recent[i][3]); } catch (e) {} }
      for (var j = 0; j < recentNotes.length; j++) { try { fn(recentNotes[j][0], recentNotes[j][1], recentNotes[j][2], 'note', recentNotes[j][3]); } catch (e) {} }
    }
  };
})();
