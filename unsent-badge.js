/*
 * unsent-badge.js — メニューの「未送信の一覧」のタイルに、この端末の送信待ちの件数の札「未送信n」を出す（代表者の決定 2026-11-14【訂正】）
 * ════════════════════════════════════════════════════════════════
 * ★数えるのは unsent-calc.js（SUUnsent.total）。メニューが受け取るのは合計の数だけで、氏名・中身・種類はメニューに持ち込まない。
 *   写し返し（保存はすんでいる分）と、数えられない種類（シフト作成の縮めた控えなど）は数えない。
 * ★読むだけ。端末に書かない・通信しない。現場の端末でも出す（数だけ・入居調整の控えは現場では読まない）。
 * ★0件・読めない時は札を出さない（今と同じ見た目）。例外を外に出さない。
 *   使い方（index.html）: SUUnsentBadge.apply(root)（組み立てた後・組み立て直した後に呼ぶ）・SUUnsentBadge.start(root)
 */
(function () {
  'use strict';
  if (window.SUUnsentBadge) return;
  var HREF = 'unsent.html', root = null;

  function apply(r) {
    try {
      if (r) root = r;
      if (!root) return;
      var olds = root.querySelectorAll('a.tile .unsb');
      for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
      if (!window.SUUnsent) return;
      var st = null, ss = null;
      try { st = window.localStorage; } catch (e) { st = null; }
      try { ss = window.sessionStorage; } catch (e) { ss = null; }
      var n = window.SUUnsent.total({ local: st, session: ss });
      if (!(typeof n === 'number' && isFinite(n) && n > 0)) return;
      var tiles = root.querySelectorAll('a.tile');
      for (var j = 0; j < tiles.length; j++) {
        if (tiles[j].getAttribute('href') !== HREF) continue;
        var s = document.createElement('span');
        s.className = 'unsb';
        s.textContent = '未送信' + (n > 9999 ? '9999+' : n);
        tiles[j].appendChild(s);
      }
    } catch (e) { /* 付けられなくてもメニューは動く */ }
  }

  function start(r) {
    try {
      root = r || root;
      apply();
      /* ほかのタブで送れた・積まれた時、「戻る」で戻った時は数え直す（書かないので何度数えてもよい） */
      window.addEventListener('storage', function () { apply(); });
      window.addEventListener('pageshow', function (e) { if (e && e.persisted) apply(); });
    } catch (e) { /* 何もしない */ }
  }

  window.SUUnsentBadge = { start: start, apply: apply };
})();
