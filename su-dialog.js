/* su-dialog.js — ブラウザの止めて知らせる窓（alert・confirm・prompt）の代わりに、画面の中の窓を出す共通部品（2026-11-12 代表者の決定・推奨どおり。prompt は 2026-11-14 第6段 RM-01）
 *
 * 使い方:
 *   await SUDialog.alert('文')            … 「OK」1つの窓。閉じたら約束が解ける
 *   if (await SUDialog.confirm('文')) …   … 「キャンセル」「OK」の窓。OK＝true／キャンセル・Esc＝false
 *   var v = await SUDialog.prompt('文', '初めの値') … 入力欄と「キャンセル」「OK」の窓。OK＝入れた文字（空なら ''）／キャンセル・Esc＝null
 *                                         入力欄に初めから合わせる（初めの値は選んだ状態）。入力欄で Enter＝OK（かな漢字の変換中の Enter は OK にしない）
 *   SUDialog.busy()                        … 窓が出ている・待っている間は true（同期を窓の後へ回すため）
 *   SUDialog.idle()                        … 窓が全部閉じた後（次の出来事の番）に解ける約束
 * 決まり:
 *   - 文はそのまま出す（textContent・改行もそのまま見える＝white-space:pre-wrap）。innerHTML は使わない
 *   - 画面の中央に出し、後ろを暗くする（<dialog> の showModal）。OK に初めから合わせる（Enter で OK・Esc でキャンセル）
 *   - 同時に2つ呼ばれたら、1つ目を閉じてから2つ目を出す（呼んだ順）
 *   - 印刷には出さない。枠（iframe）の中でも出す
 * 守り（CLAUDE.md §2-6）: 読み込めない・showModal が無い・例外が起きた時は、ブラウザの window.alert / window.confirm / window.prompt に落とす。
 *   例外を外に出さない。端末に何も書かない。通信しない。二重に読み込んでも1つしか動かない。
 * 見た目は同じサイトの su-dialog.css を <link> で読む（CSP の style-src 'self' でも効く・<style> を差し込まない）。
 *   CSS が読めない時の守りに、文字の大きさ・ボタンの大きさ・色は要素への直接の指定（CSSOM）でも付ける（値は su-dialog.css と同じ）。 */
(function () {
  'use strict';
  try {
    if (window.SUDialog) return;
    var CSS_HREF = 'su-dialog.css?v=2026-11-14';
    var queue = [];      // 待っている窓 {kind, msg, def, done}
    var current = null;  // 今出ている窓

    try {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      (document.head || document.documentElement).appendChild(link);
    } catch (e) { /* 読めなくても CSSOM の指定で出る */ }

    /* ブラウザの窓に落とす（この部品が使えない時の道） */
    function nativeAsk(kind, msg, def) {
      try {
        if (kind === 'confirm') return !!window.confirm(msg);
        if (kind === 'prompt') { var r = window.prompt(msg, def == null ? '' : String(def)); return r == null ? null : String(r); }
        window.alert(msg);
      } catch (e) { /* 何もしない */ }
      return kind === 'confirm' ? false : (kind === 'prompt' ? null : undefined);
    }
    /* 答えを待つ側へ返す値（alert＝なし・confirm＝真偽・prompt＝入れた文字か null） */
    function answerOf(item, value) {
      if (item.kind === 'confirm') return !!value;
      if (item.kind === 'prompt') {
        if (!value) return null;
        try { return String(item.parts && item.parts.inp ? item.parts.inp.value : ''); } catch (e) { return ''; }
      }
      return undefined;
    }

    /* 経過時間は端末の時計の戻り（時刻合わせ）に左右されない performance.now で測る。無い時は Date.now（反証レビューの指摘） */
    function nowMs() { try { if (window.performance && typeof performance.now === 'function') return performance.now(); } catch (e) { /* 何もしない */ } return Date.now(); }

    function css(el, o) { try { for (var k in o) el.style[k] = o[k]; } catch (e) { /* 何もしない */ } }

    function build(item) {
      var dlg = document.createElement('dialog');
      dlg.className = 'sud-dlg';
      dlg.setAttribute('aria-modal', 'true');
      /* 読み上げ用の窓の名前（画面には出さない・仮置き）。名前の無いダイアログと読まれないように */
      dlg.setAttribute('aria-label', item.kind === 'confirm' ? '確認' : (item.kind === 'prompt' ? '入力' : 'お知らせ'));
      if (typeof dlg.showModal !== 'function') return null;
      css(dlg, { boxSizing: 'border-box', width: 'min(520px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', padding: '0',
        border: '1px solid #5f6368', borderRadius: '12px', background: '#ffffff', color: '#1b1b1b', overflow: 'auto' });
      var inner = document.createElement('div');
      inner.className = 'sud-in';
      css(inner, { padding: '20px', font: '17px/1.6 system-ui,-apple-system,"Hiragino Sans",sans-serif' });
      var p = document.createElement('p');
      p.className = 'sud-msg';
      p.id = 'sud-msg-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      p.textContent = String(item.msg == null ? '' : item.msg);
      css(p, { margin: '0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '17px', color: '#1b1b1b' });
      dlg.setAttribute('aria-describedby', p.id);
      var row = document.createElement('div');
      row.className = 'sud-row';
      css(row, { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' });
      function btn(label, pri) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sud-btn' + (pri ? ' pri' : '');
        b.textContent = label;
        css(b, { minHeight: '44px', minWidth: '96px', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer',
          font: '600 17px/1.2 system-ui,-apple-system,"Hiragino Sans",sans-serif',
          border: pri ? '1px solid #0b3a7e' : '1px solid #5f6368',
          background: pri ? '#0b3a7e' : '#ffffff', color: pri ? '#ffffff' : '#1b1b1b' });
        return b;
      }
      var cancel = item.kind !== 'alert' ? btn('キャンセル', false) : null;
      var ok = btn('OK', true);
      if (cancel) row.appendChild(cancel);
      row.appendChild(ok);
      inner.appendChild(p);
      /* 入力の窓（prompt）: 文の下に1行の入力欄。読み上げの名前は上の文（aria-labelledby）。iPhone で拡大されないよう文字は 17px */
      var inp = null;
      if (item.kind === 'prompt') {
        inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'sud-inp';
        inp.setAttribute('aria-labelledby', p.id);
        inp.setAttribute('autocomplete', 'off');
        inp.value = item.def == null ? '' : String(item.def);
        css(inp, { display: 'block', boxSizing: 'border-box', width: '100%', minHeight: '44px', marginTop: '12px', padding: '8px 10px',
          border: '1px solid #5f6368', borderRadius: '8px', background: '#ffffff', color: '#1b1b1b',
          font: '17px/1.4 system-ui,-apple-system,"Hiragino Sans",sans-serif' });
        inner.appendChild(inp);
      }
      inner.appendChild(row);
      dlg.appendChild(inner);
      return { dlg: dlg, ok: ok, cancel: cancel, inp: inp, first: inp || ok };
    }

    function finish(item, value) {
      if (item.settled) return;
      item.settled = true;
      var ans = answerOf(item, value);   /* 入力欄を外す前に読む */
      try { if (item.parts && item.parts.dlg.open) item.parts.dlg.close(); } catch (e) { /* 何もしない */ }
      try { if (item.parts && item.parts.dlg.parentNode) item.parts.dlg.parentNode.removeChild(item.parts.dlg); } catch (e) { /* 何もしない */ }
      if (current === item) current = null;
      try { item.done(ans); } catch (e) { /* 何もしない */ }
      next();
    }

    function show(item) {
      var parts = null;
      try { parts = build(item); } catch (e) { parts = null; }
      if (!parts) return false;
      item.parts = parts;
      var dlg = parts.dlg;
      try {
        /* 窓を開いた押下の続き（素早い二度押しの2回目が、画面の中央に出た OK・キャンセルに重なる）で答えないようにする。
           マウス・指の押下（e.detail が1以上）だけを、開いてから少しの間は受けない。Enter・Space（e.detail が0）は今までどおり（2026-11-13 実測の指摘・仮置き 350ms） */
        function tooSoon(e) { try { return !!e && e.detail > 0 && (nowMs() - (item.openedAt || 0)) < 350; } catch (err) { return false; } }
        parts.ok.addEventListener('click', function (e) { if (tooSoon(e)) return; finish(item, true); });
        if (parts.cancel) parts.cancel.addEventListener('click', function (e) { if (tooSoon(e)) return; finish(item, false); });
        /* Esc（ブラウザが cancel を出す）と、ほかの理由で閉じた時はキャンセル扱い */
        dlg.addEventListener('cancel', function (e) {
          /* 画面の Esc の処理の中で窓を開いた時、同じ Esc が開いたばかりの窓をすぐ閉じないようにする（開いたのと同じ一続きの処理の中の cancel は受けない） */
          if (item.opening) { try { e.preventDefault(); } catch (err) { /* 何もしない */ } return; }
          /* 入力の窓で、かな漢字の変換中の Esc は変換の取り消しなので、窓を閉じない（2026-11-14 PR #575 の反証） */
          if (item.composing) { try { e.preventDefault(); } catch (err) { /* 何もしない */ } return; }
          finish(item, false);
        });
        dlg.addEventListener('close', function () { finish(item, false); });
        /* 入力欄の Enter で OK（form の無い入力欄は Enter で何も起きないため自前で受ける）。
           かな漢字の変換を決める Enter（isComposing・keyCode 229）と、押しっぱなしの Enter（前の窓を閉じた Enter の続き）では OK にしない */
        /* 変換中の印（compositionstart〜compositionend）。変換を終えた Esc の後に届く cancel も受けないよう、外すのは次の出来事の番 */
        if (parts.inp) {
          parts.inp.addEventListener('compositionstart', function () { item.composing = true; });
          parts.inp.addEventListener('compositionend', function () { setTimeout(function () { item.composing = false; }, 0); });
        }
        if (parts.inp) parts.inp.addEventListener('keydown', function (e) {
          try {
            /* 変換中の Esc は窓を閉じる既定の動き（cancel）を止める（変換の取り消しだけにする） */
            if ((e.key === 'Escape' || e.key === 'Esc') && (item.composing || e.isComposing || e.keyCode === 229)) { e.preventDefault(); return; }
            if (e.key !== 'Enter') return;
            if (e.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            if (e.repeat) return;
            finish(item, true);
          } catch (err) { /* 何もしない */ }
        });
        dlg.addEventListener('keydown', function (e) {
          /* 押しっぱなしの Enter（窓を開いたボタンの Enter の続き）で OK にしない。窓の中のキーは画面へ伝えない（画面の Esc の処理を一緒に動かさない） */
          try {
            if (e.key === 'Enter' && e.repeat) e.preventDefault();
            e.stopPropagation();
            /* 入力の窓で、窓の地や文を押した後（入力の的が窓そのもの）に打った文字は入力欄へ入れる（打った文字が消えないように・2026-11-14 実測）。
               ボタンの上・Tab・Esc・写す（Cmd+C・Ctrl+C）はそのまま */
            if (parts.inp && e.target !== parts.inp && e.target !== parts.ok && e.target !== parts.cancel
              && e.key !== 'Tab' && e.key !== 'Escape' && e.key !== 'Esc'
              && !((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C'))) parts.inp.focus();
          } catch (err) { /* 何もしない */ }
        });
        /* 画面の中央に置く（画面の「*{margin:0}」などで UA の中央寄せが消えても中央に出す） */
        css(dlg, { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', margin: 'auto', height: 'fit-content' });
        (document.body || document.documentElement).appendChild(dlg);
        /* 今の Esc キーの押下の中で開く時は、その既定の動き（開いた窓を閉じる）を止め、同じ一続きの処理の中の cancel も受けない（opening）。
           Esc 以外で開いた時は opening を立てない（開いた直後・OK の直後に押した Esc も、今までどおりキャンセルとして受ける・2026-11-13 実測の指摘）。
           答えを待った後の続き（2つ目の確かめ）など、出来事の外で開いた時は window.event が空なので、Esc で開いたとは扱わない */
        var escOpen = false;
        try { var ev = window.event; escOpen = !!ev && ev.type === 'keydown' && (ev.key === 'Escape' || ev.key === 'Esc'); if (escOpen) ev.preventDefault(); } catch (err) { /* 何もしない */ }
        item.openedAt = nowMs();
        if (escOpen) { item.opening = true; setTimeout(function () { item.opening = false; }, 0); }
        installKeyGuard();
        dlg.showModal();
        try { parts.first.focus(); if (parts.inp && typeof parts.inp.select === 'function') parts.inp.select(); } catch (e) { /* 何もしない */ }
      } catch (e) {
        try { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); } catch (err) { /* 何もしない */ }
        item.parts = null;
        return false;
      }
      return true;
    }

    /* 窓が出ている間に、入力の的が窓の外（文の上や暗い後ろを押した時の body など）にある時のキーは、画面へ渡さない。
       ブラウザの窓では画面の処理が全部止まっていたので、画面のキー操作（Esc で窓を閉じる・Cmd+Z で取り消す・Cmd+S で保存する）は動かなかった。
       Esc は今の窓のキャンセル（開いたのと同じ一続きの処理の中の Esc は受けない）、ほかのキーは何もしないで OK に入力の的を戻す（Enter で OK にはしない）（2026-11-13 反証レビューの指摘）。
       入力の窓（prompt）では OK ではなく入力欄に戻す（2026-11-14） */
    var keyGuardOn = false;
    function keyGuard(e) {
      try {
        var it = current;
        if (!it || !it.parts) return;
        var dlg = it.parts.dlg;
        if (e.target && dlg.contains && dlg.contains(e.target)) return;
        e.stopImmediatePropagation();
        /* 窓の文をなぞって写す（Cmd+C・Ctrl+C）は止めない（画面へは渡さない） */
        if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) return;
        if (e.key === 'Tab') { e.preventDefault(); try { it.parts.first.focus(); } catch (er) { /* 何もしない */ } return; }
        e.preventDefault();
        if ((e.key === 'Escape' || e.key === 'Esc') && !it.opening && !it.composing) { finish(it, false); return; }
        try { it.parts.first.focus(); } catch (er) { /* 何もしない */ }
      } catch (err) { /* 何もしない */ }
    }
    function installKeyGuard() {
      if (keyGuardOn) return;
      try { window.addEventListener('keydown', keyGuard, true); keyGuardOn = true; } catch (e) { /* 何もしない */ }
    }

    function next() {
      while (!current && queue.length) {
        var item = queue.shift();
        current = item;
        if (show(item)) return;
        /* 出せなかった: ブラウザの窓で聞く（同じ順番のまま） */
        current = null;
        item.settled = true;
        var v = nativeAsk(item.kind, item.msg, item.def);
        try { item.done(v); } catch (e) { /* 何もしない */ }
      }
      if (!current && !queue.length) flushIdle();
    }

    var idleWaiters = [];
    function flushIdle() {
      if (!idleWaiters.length) return;
      /* 窓の答えを待っていた処理（約束の続き）が先に動き切るよう、次の出来事の番で確かめ直す */
      setTimeout(function () {
        if (current || queue.length) return;
        var w = idleWaiters; idleWaiters = [];
        for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) { /* 何もしない */ } }
      }, 0);
    }

    function ask(kind, msg, def) {
      return new Promise(function (resolve) {
        try {
          queue.push({ kind: kind, msg: msg, def: def, done: resolve, settled: false, parts: null });
          next();
        } catch (e) {
          resolve(nativeAsk(kind, msg, def));
        }
      });
    }

    /* 印刷の前に隠す（CSS の @media print が読めない時の守り） */
    try {
      window.addEventListener('beforeprint', function () { if (current && current.parts) css(current.parts.dlg, { visibility: 'hidden' }); });
      window.addEventListener('afterprint', function () { if (current && current.parts) css(current.parts.dlg, { visibility: '' }); });
    } catch (e) { /* 何もしない */ }

    window.SUDialog = {
      alert: function (msg) { return ask('alert', msg); },
      confirm: function (msg) { return ask('confirm', msg); },
      prompt: function (msg, def) { return ask('prompt', msg, def); },
      busy: function () { return !!(current || queue.length); },
      idle: function () {
        return new Promise(function (resolve) {
          try {
            idleWaiters.push(resolve);
            if (!current && !queue.length) flushIdle();
          } catch (e) { resolve(); }
        });
      }
    };
  } catch (e) { /* 読み込みの失敗は外に出さない（画面の受け口がブラウザの窓に落とす） */ }
})();
