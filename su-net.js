/* su-net.js — インターネットにつながっていない時の帯（2026-11-12 商用化の見直し）
 *
 * 何をするか: ブラウザが「つながっていない」と知らせた時（offline の出来事・開いた時の navigator.onLine が false）に、
 *   画面の上の中央に小さな札を1つ出す。「つながった」と知らせた時（online の出来事）に帯を消す。
 * 何をしないか（CLAUDE.md §2-6 共通部品の決まり）:
 *   - アプリの動き・保存・通信には一切触れない（送り直しもしない・入力を残すとも書かない）
 *   - 端末に何も書かない。外からの文字を入れない（帯の文は下の固定の文だけ・textContent）
 *   - 読み込めなくても画面は動く。例外を外に出さない。二重に読み込んでも1つしか動かない
 *   - 枠（iframe）の中では出さない（親の画面が出す）。印刷には出さない（印刷の前に隠す・@media print 相当）
 * 見た目は要素への直接の指定（CSSOM）で付ける＝CSP の style-src 'self' の画面でも効く。
 * 各画面で通信切れを自分で扱っている画面には読み込まない（重ねて出さないため）。 */
(function () {
  'use strict';
  try {
    if (window.SUNet) return;
    var inFrame = false;
    try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }
    var MSG = 'インターネットにつながっていません';
    var band = null, printing = false;
    function make() {
      if (band) return band;
      band = document.createElement('div');
      band.className = 'su-net-band';
      band.setAttribute('role', 'status');
      band.setAttribute('aria-live', 'polite');
      band.textContent = '📡 ' + MSG;
      var s = band.style;
      /* ★見出しのボタン・窓を押せなくしない（2026-11-12 反証レビュー）: 1行の小さな札にし、札の上を押しても下のボタンに届く
         （pointer-events:none）。重なり順は各画面の見出し（〜100）より上・窓より下（140。入居者マスタ・フェイスシートの窓は150・2026-11-12 反証レビュー）。iPhone の切り欠きをよける */
      s.position = 'fixed'; s.left = '50%'; s.top = 'max(6px, env(safe-area-inset-top))'; s.transform = 'translateX(-50%)';
      s.zIndex = '140'; s.pointerEvents = 'none';
      s.padding = '6px 14px'; s.margin = '0'; s.boxSizing = 'border-box'; s.maxWidth = 'calc(100vw - 24px)';
      s.whiteSpace = 'nowrap'; s.overflow = 'hidden'; s.textOverflow = 'ellipsis'; s.borderRadius = '999px';
      s.background = '#5c2b00'; s.color = '#ffffff';   /* 地との差 約 11:1 */
      s.font = '600 15px/1.4 system-ui,-apple-system,"Hiragino Sans",sans-serif';
      s.textAlign = 'center'; s.boxShadow = '0 2px 8px rgba(0,0,0,.3)';
      s.display = 'none';
      (document.body || document.documentElement).appendChild(band);
      return band;
    }
    function show(on) {
      try {
        if (inFrame) return;
        if (!on && !band) return;
        var b = make();
        b.style.display = (on && !printing) ? 'block' : 'none';
        b.hidden = !on;
      } catch (e) { /* 帯が出せなくても画面は動く */ }
    }
    function isOffline() { try { return navigator.onLine === false; } catch (e) { return false; } }
    function start() {
      if (isOffline()) show(true);
      window.addEventListener('offline', function () { show(true); });
      window.addEventListener('online', function () { show(false); });
      /* 印刷の紙に出さない（beforeprint/afterprint） */
      window.addEventListener('beforeprint', function () { printing = true; if (band) band.style.display = 'none'; });
      window.addEventListener('afterprint', function () { printing = false; if (band && !band.hidden) band.style.display = 'block'; });
      /* 印刷の見た目への切り替えを出来事なしで行う経路（共有からの印刷など）にも効かせる */
      try {
        var mq = window.matchMedia && window.matchMedia('print');
        var onMq = function (e) { printing = !!(e && e.matches); if (band) band.style.display = (!printing && !band.hidden) ? 'block' : 'none'; };
        if (mq && mq.addEventListener) mq.addEventListener('change', onMq); else if (mq && mq.addListener) mq.addListener(onMq);
      } catch (e) { /* 無い端末は beforeprint だけで隠す */ }
    }
    window.SUNet = { isOffline: isOffline, _show: show, MSG: MSG };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  } catch (e) { /* 読み込みの失敗を外に出さない */ }
})();
