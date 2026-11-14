/* su-intro.js — 画面の見出しのすぐ下に出す「初回の案内の帯」（2026-11-02 本人の決定「この文言で作る」）
 *
 * 何をするか:
 *   ・画面ごとに「この画面でできること／はじめに／困った時」を、印 data-su-intro-after の要素（無ければ body 直下の見出しの入れ物 .hdr）の直後に帯で出す。
 *   ・「×」（案内を閉じる）で閉じたら、その端末では出さない。端末に残すのは localStorage の
 *     su_intro_closed_<画面id> = '1' だけ（UI の状態だけ。氏名・記録などは入れない）。
 *     localStorage が使えない端末では、例外を外に出さずに毎回出す（×で今の表示だけ閉じる）。
 *   ・画面だけに出し、印刷しない（su-intro.css の @media print と、CSS が読めない時の beforeprint の守り）。
 *   ・枠（iframe）の中では出さない（左右比較の中の全支援俯瞰・訪問俯瞰で二重に出さないため）。
 *   ・文言は下の TEXT に画面 id（ファイル名から .html を除いたもの）ごとに持つ。知らない画面では何もしない。
 *     文言は本人の決定どおり一字一句変えない。施設名は書かない。
 *     担当者会議・職員マスタ・採用管理・設備・修繕の記録の4画面の文は仮置き（代表者の決定 2026-11-13）。
 *   ・文字は textContent で入れる。
 *
 * 共通部品の決まり（CLAUDE.md §2 の6）: 読み込むだけで効く・読み込めなくても動く・例外を外に出さない。
 *   画面の動き・保存・通信には触れない（読むのは自分の印の localStorage だけ）。
 *   現場端末でも出す（文言は端末を問わない）。
 *   入居者マスタ・入居調整で SUAppGate の覆いが出ている間は、帯も body の子として覆いの下になる（覆いには触れない）。
 *
 * 見た目は同じサイトの su-intro.css から読む（su-report.js と su-report.css と同じ作り。<style> は差し込まない＝
 *   CSP で直書きの style を禁じる画面でも効く）。CSS が届いてから帯を置く（届く前に置くと素の文字が一瞬出る）。
 *   届かない・遅い時も CSS_WAIT_MS で置く。
 *
 * 使い方: 各画面の </body> の直前（su-report.js の前）で
 *   <script src="su-intro.js?v=2026-11-13"></script>
 */
(function () {
  'use strict';
  try {
    if (window.__suIntroLoaded) return;
    window.__suIntroLoaded = true;

    var inFrame;
    try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
    if (inFrame) return;

    var HELP = '困った時：画面の「不具合を報告」ボタンから知らせてください。';
    /* リンクを含む「困った時」の行。行き先は下の決まった画面 id から作る（location からは作らない） */
    var helpLine = function (sec) {
      return { pre: '困った時：', link: '「使い方」のこの画面の説明（別のタブで開きます）', href: 'help.html?sec=' + sec, post: 'を見るか、画面の「不具合を報告」ボタンから知らせてください。' };
    };
    var TEXT = {
      'daycare-roster': [
        'この画面でできること：デイの利用日と時間を、帳票（利用表・利用者一覧・全員リスト・薬用・週間名簿）で見て印刷します。',
        'はじめに：上のタブで帳票を選び、「印刷」で紙にします。',
        HELP
      ],
      'facesheet': [
        'この画面でできること：入居者お一人ずつの基本情報を1枚で見て、印刷します。',
        'はじめに：「入居者を検索」に氏名・ふりがな・居室を入れて、一覧から選びます。',
        HELP
      ],
      'support-overview': [
        'この画面でできること：施設の支援の配置を、何週か重ねて1枚に並べ、支援の薄い時間帯を見つけます。',
        'はじめに：「重ね週数」を選んで「更新」を押すと集計します。',
        HELP
      ],
      'visit-overview': [
        'この画面でできること：訪問の予定（週間計画）を、月〜日の1枚に並べて見ます。',
        'はじめに：上の「施設」「外部」で、見る利用者を切り替えます。',
        HELP
      ],
      'overview-compare': [
        'はじめに：片方を動かすと、もう片方も同じ時刻・曜日にそろいます（「連動」を外すと別々に動きます）。',
        HELP
      ],
      'admission-flow': [
        'この画面でできること：入居のご相談から入居まで、案件ごとの進み具合と、今日やることを管理します。',
        'はじめに：下の「今日」でやることを確かめ、新しいご相談は右下の「＋」で足します。くわしくは下の「使い方」へ。',
        HELP
      ],
      'patch-calendar': [
        'この画面でできること：貼り薬の貼る場所の順番を、月のカレンダーにして印刷します。',
        'はじめに：「入居者」と「開始日」を選び、年月を確かめてから「印刷」を押します。',
        HELP
      ],
      /* 便9（2026-11-02 本人の決定「このまま確定」） */
      'weight-record': [
        'この画面でできること：入居者の毎月の体重を記録し、増減のアラートと食事形態を確かめます。',
        'はじめに：上の「入力」で入居者と体重を入れて「記録を保存」を押します。紙に書いて測る時は「一覧」の「🖨️ 用紙作成」で用紙を印刷します。',
        HELP
      ],
      'training-plan': [
        'この画面でできること：デイ利用者の個別機能訓練計画書を作って直し、3か月ごとの期限を一覧で確かめて印刷します。',
        'はじめに：一覧で期限を確かめ、利用者の「開く」で計画書を開きます。紙にする時は下の「印刷」へ。',
        HELP
      ],
      'supplies': [
        'はじめに：下の「在庫」の「入出庫を記録する」で品目・入庫か出庫・数量を入れ、「記録する」を押します。',
        HELP
      ],
      'resident-master': [
        'この画面でできること：入居者の情報の確かめと直し、帳票（食形態・ケアマネ一覧・居室一覧など）の印刷をします。',
        'はじめに：検索欄に氏名・ふりがな・居室を入れて選ぶか、上のタブで帳票を選びます。',
        HELP
      ],
      /* 第6段（代表者の決定 2026-11-13・文は Claude の仮置き）。「困った時」の行は使い方のその画面の節へのリンクを含む。
         リンクは別のタブで開く（4画面の保存していない編集の確かめは見出しの中のリンクだけに効くため、同じタブで移ると書きかけを失う） */
      'care-meeting': [
        'この画面でできること：サービス担当者会議の要点を入居者お一人ずつ記録して確定し、次の会議の期限を確かめて印刷します。',
        'はじめに：「入居者を選ぶ」から入居者を選び、「＋ 新しい記録」で書き始めます。',
        helpLine('care-meeting')
      ],
      'staff-master': [
        'この画面でできること：職員の情報・資格・委員会を管理し、一覧とダッシュボードで確かめます。',
        'はじめに：上の「一覧」で職員を選んで直し、新しい方は「＋ 新規」で足します。',
        helpLine('staff-master')
      ],
      'ats': [
        'この画面でできること：応募から入職までの選考の進み具合と、面接の予定を管理します。',
        'はじめに：「選考」のボードで応募者を確かめ、新しい応募は「＋ 応募者を足す」で足します。',
        helpLine('ats')
      ],
      'equip-log': [
        'この画面でできること：設備・備品と、その購入・修理・清掃・点検・交換の記録を残し、次の予定の期限を確かめます。',
        'はじめに：「設備」の「＋ 設備を足す」で設備を登録し、修理や点検をしたら「＋ 記録を足す」で残します。',
        helpLine('equip-log')
      ]
    };

    var FILE = (String(location.pathname || '').split('/').pop() || '').split('?')[0];
    var ID = FILE.replace(/\.html$/, '');
    if (!ID || !Object.prototype.hasOwnProperty.call(TEXT, ID)) return;
    var KEY = 'su_intro_closed_' + ID;

    var closed = false;
    try { closed = window.localStorage.getItem(KEY) === '1'; } catch (e) { closed = false; }
    if (closed) return;

    var CSS_HREF = 'su-intro.css?v=2026-11-13';
    var CSS_WAIT_MS = 3000;
    var placed = false;

    function build() {
      var band = document.createElement('div');
      band.className = 'sui-band';
      band.setAttribute('role', 'note');
      band.setAttribute('aria-label', 'この画面の案内');
      var tx = document.createElement('div');
      tx.className = 'sui-tx';
      var lines = TEXT[ID];
      for (var i = 0; i < lines.length; i++) {
        var p = document.createElement('p');
        p.className = 'sui-ln';
        var ln = lines[i];
        if (typeof ln === 'string') p.textContent = ln;
        else {
          /* リンクを含む行も文字は textContent で入れる */
          var s1 = document.createElement('span'); s1.textContent = ln.pre; p.appendChild(s1);
          var a = document.createElement('a');
          a.className = 'sui-a';
          a.href = ln.href;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = ln.link;
          p.appendChild(a);
          var s2 = document.createElement('span'); s2.textContent = ln.post; p.appendChild(s2);
        }
        tx.appendChild(p);
      }
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'sui-x';
      x.setAttribute('aria-label', '案内を閉じる');
      x.textContent = '×';
      x.addEventListener('click', function () {
        try { window.localStorage.setItem(KEY, '1'); } catch (e) { /* 覚えられない端末では次も出す */ }
        try { if (band.parentNode) band.parentNode.removeChild(band); } catch (e) { /* 何もしない */ }
      });
      band.appendChild(tx);
      band.appendChild(x);
      /* CSS が読めない時も紙に出さない守り（要素に直接の指定は CSP の style-src 'self' でも効く） */
      try {
        window.addEventListener('beforeprint', function () { band.style.display = 'none'; });
        window.addEventListener('afterprint', function () { band.style.display = ''; });
      } catch (e) { /* CSS の @media print で消える */ }
      return band;
    }

    function place() {
      if (placed) return;
      placed = true;
      try {
        /* 画面が印 data-su-intro-after を付けた要素があればその後ろ、無ければ body 直下の見出しの入れ物の後ろに置く（2026-11-02 便9）。
           印は見出しの入れ物が body 直下に無い画面（体重管理）と、見出しの下に「この画面でできること」の行がある画面（消耗品管理）が付ける */
        var hdr = document.querySelector('[data-su-intro-after]') || document.querySelector('body > .hdr');
        if (!hdr || !hdr.parentNode) return;
        var band = build();
        hdr.parentNode.insertBefore(band, hdr.nextSibling);
      } catch (e) { /* 帯が出せなくても画面はそのまま */ }
    }

    function start() {
      var done = false;
      function go() { if (done) return; done = true; place(); }
      try {
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.onload = go;
        css.onerror = go;   // 読めなくても帯は出す（印刷は beforeprint で隠す）
        css.href = CSS_HREF;
        document.head.appendChild(css);
      } catch (e) { go(); }
      setTimeout(go, CSS_WAIT_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  } catch (e) { /* 例外を外に出さない */ }
})();
