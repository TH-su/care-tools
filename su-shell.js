/* su-shell.js — 見出しの右に「ログイン中の役割」の札を出す（2026-11-12 商用90点・案1 第2段・代表者の決定 2026-11-12「推奨どおりで」）
 *
 * 何をするか: 見出しの中の決まった場所 <span class="su-shell-role" hidden></span> にだけ、ログインの役割の文を入れて見せる。
 *   文はメニューの帯と同じ3つだけ（管理者としてログイン中・事務所としてログイン中・現場としてログイン中）。
 *   役割は、画面がすでに読んでいる su-auth.js の SUAuth.check()（強制でない確かめ）に相乗りして受け取る。
 *   SUAuth がまだ無い時は、少しの間（最長 30 秒・ログインの覆いが後から読む画面のため）現れるのを待ってから1回だけ聞く。su-auth.js をこの部品から読み込むことはしない。
 * 何をしないか（CLAUDE.md §2-6 共通部品の決まり）:
 *   - 誰が何をできるかを決めない（札は知らせだけ。守りはデータベースと各画面の確かめが持つ）
 *   - 確かめている間・確かめられない時・ログインしていない時は札を出さない（決めつけない）
 *   - 端末に何も書かない。外からの文字を入れない（固定の文を textContent で入れる）
 *   - 読み込めなくても画面は動く。例外を外に出さない。二重に読み込んでも1つしか動かない
 *   - 枠（iframe）の中では出さない。印刷の紙には出さない（su-shell.css の @media print）
 *   - ログインの画面（login.html）には当てない（Google から戻った時の知らせを、画面より先に受け取ってしまわないため） */
(function () {
  'use strict';
  try {
    if (window.SUShell) return;
    var TEXT = { admin: '管理者としてログイン中', office: '事務所としてログイン中', field: '現場としてログイン中' };
    var inFrame = false;
    try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }
    function slots() {
      try { return Array.prototype.slice.call(document.querySelectorAll('.su-shell-role')); } catch (e) { return []; }
    }
    function draw(role) {
      var t = Object.prototype.hasOwnProperty.call(TEXT, role) ? TEXT[role] : '';
      slots().forEach(function (el) {
        try {
          el.textContent = t;
          el.hidden = !t || inFrame;
          if (t) el.setAttribute('role', 'status'); else el.removeAttribute('role');
          /* 札が出ている時だけ、狭い幅で見出しを2段にしてよい印を付ける（出ていない時の見出しは今のまま・su-shell.css） */
          var h = el.closest ? el.closest('.su-shell-hdr') : null;
          if (h && h.classList) { if (t && !inFrame) h.classList.add('su-shell-on'); else h.classList.remove('su-shell-on'); }
        } catch (e) { /* 札が出せなくても画面は動く */ }
      });
    }
    var asked = false;
    function ask() {
      if (asked) return;
      var A = window.SUAuth;
      if (!A || typeof A.check !== 'function') return;
      asked = true;
      try {
        Promise.resolve(A.check()).then(function (r) {
          var ok = r && A.STATUS && r.status === A.STATUS.OK;
          draw(ok ? r.role : '');
        }, function () { draw(''); });
      } catch (e) { draw(''); }
    }
    function start() {
      if (inFrame || !slots().length) return;
      ask();
      if (asked) return;
      var n = 0;
      var timer = setInterval(function () {
        n++;
        ask();
        if (asked || n >= 60) clearInterval(timer);
      }, 500);
    }
    window.SUShell = { TEXT: TEXT, _draw: draw, _ask: ask };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    /* 「戻る」で前の表示のまま戻った時（pageshow の persisted）は、その間にログアウト・アカウントの入れ替えがあり得るので聞き直す */
    try {
      window.addEventListener('pageshow', function (ev) {
        if (!ev || !ev.persisted || inFrame || !slots().length) return;
        asked = false; draw(''); start();
      });
      /* 別のタブでログアウト・アカウントの入れ替えがあった時（ログインの控え sb-…-auth-token が変わった時）は、札を消してから聞き直す。
         su-auth.js も同じ出来事で同じタブの控えを捨てるので、古い役割を受け取らない */
      window.addEventListener('storage', function (ev) {
        if (inFrame || !slots().length) return;
        if (ev && ev.key !== null && !/^sb-[a-z0-9]+-auth-token$/.test(String(ev.key))) return;
        asked = false; draw(''); start();
      });
    } catch (e) { /* 聞き直せなくても画面は動く */ }
  } catch (e) { /* 読み込みの失敗を外に出さない */ }
})();
