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
 */
(function () {
  'use strict';
  if (window.__suErrorsInstalled) return;   /* 二重読み込みでも二重に出さない */
  window.__suErrorsInstalled = true;

  var THROTTLE_MS = 30000;                  /* 同じ例外が描画のたびに出続けると操作の邪魔になる */
  var lastSig = '', lastAt = 0;
  var MSG = '⚠ 画面でエラーが起きました。入力中の内容を控えて再読み込みしてください';

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
      if (!pageToast(MSG)) ownBanner(MSG);
    } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    /* 画像・スクリプトの読み込み失敗も同じイベントで来るが、あちらは message を持たない。
       通信の一時失敗で毎回警告を出しても現場は対処できないので、例外だけを対象にする。 */
    if (!e || (!e.message && !e.error)) return;
    var where = '';
    try {
      if (e.filename) where = String(e.filename).split('/').pop() + ':' + (e.lineno || 0);
    } catch (e2) {}
    report('スクリプトエラー', e.message || (e.error && e.error.message) || '不明', where);
  });

  window.addEventListener('unhandledrejection', function (e) {
    report('未処理の失敗', (e && e.reason) || '不明', '');
  });
})();
