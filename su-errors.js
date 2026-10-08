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
        document.body.appendChild(el);
      }
      el.textContent = msg;
      clearTimeout(ownBanner._t);
      ownBanner._t = setTimeout(function () { try { el.remove(); } catch (e) {} }, 12000);
    } catch (e) {}
  }

  function report(kind, msg, where) {
    try {
      var brief = String(msg == null ? '' : (msg.message || msg)).slice(0, 120);
      var sig = kind + '|' + brief + '|' + where;
      var now = Date.now();
      if (sig === lastSig && now - lastAt < THROTTLE_MS) return;
      lastSig = sig; lastAt = now;
      /* 開発時に原因へたどり着けるよう、詳細はコンソールへ残す（画面には出さない） */
      try { console.error('[su-errors] ' + kind + '：' + brief + (where ? '（' + where + '）' : '')); } catch (e) {}
      recent.push([kind, brief, where]); if (recent.length > 5) recent.shift();
      for (var i = 0; i < hooks.length; i++) { try { hooks[i](kind, brief, where); } catch (e) {} }
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
      var sig = kind + '|' + brief + '|' + where;
      var now = Date.now();
      if (noteAt[sig] && now - noteAt[sig] < THROTTLE_MS) return;
      if (++noteKeys > 200) { noteAt = {}; noteKeys = 1; }   /* 組み合わせの控えが増え続けないように */
      noteAt[sig] = now;
      try { console.warn('[su-errors] ' + kind + '：' + brief + (where ? '（' + where + '）' : '')); } catch (e) {}
      recentNotes.push([kind, brief, where]); if (recentNotes.length > 3) recentNotes.shift();
      for (var i = 0; i < hooks.length; i++) { try { hooks[i](kind, brief, where); } catch (e) {} }
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
    report('スクリプトエラー', e.message || (e.error && e.error.message) || '不明', where);
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
      for (var i = 0; i < recent.length; i++) { try { fn(recent[i][0], recent[i][1], recent[i][2]); } catch (e) {} }
      for (var j = 0; j < recentNotes.length; j++) { try { fn(recentNotes[j][0], recentNotes[j][1], recentNotes[j][2]); } catch (e) {} }
    }
  };
})();
