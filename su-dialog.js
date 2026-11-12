/* su-dialog.js — ブラウザの止めて知らせる窓（alert・confirm）の代わりに、画面の中の窓を出す共通部品（2026-11-12 代表者の決定・推奨どおり）
 *
 * 使い方:
 *   await SUDialog.alert('文')            … 「OK」1つの窓。閉じたら約束が解ける
 *   if (await SUDialog.confirm('文')) …   … 「キャンセル」「OK」の窓。OK＝true／キャンセル・Esc＝false
 *   SUDialog.busy()                        … 窓が出ている・待っている間は true（同期を窓の後へ回すため）
 *   SUDialog.idle()                        … 窓が全部閉じた後（次の出来事の番）に解ける約束
 * 決まり:
 *   - 文はそのまま出す（textContent・改行もそのまま見える＝white-space:pre-wrap）。innerHTML は使わない
 *   - 画面の中央に出し、後ろを暗くする（<dialog> の showModal）。OK に初めから合わせる（Enter で OK・Esc でキャンセル）
 *   - 同時に2つ呼ばれたら、1つ目を閉じてから2つ目を出す（呼んだ順）
 *   - 印刷には出さない。枠（iframe）の中でも出す
 * 守り（CLAUDE.md §2-6）: 読み込めない・showModal が無い・例外が起きた時は、ブラウザの window.alert / window.confirm に落とす。
 *   例外を外に出さない。端末に何も書かない。通信しない。二重に読み込んでも1つしか動かない。
 * 見た目は同じサイトの su-dialog.css を <link> で読む（CSP の style-src 'self' でも効く・<style> を差し込まない）。
 *   CSS が読めない時の守りに、文字の大きさ・ボタンの大きさ・色は要素への直接の指定（CSSOM）でも付ける（値は su-dialog.css と同じ）。 */
(function () {
  'use strict';
  try {
    if (window.SUDialog) return;
    var CSS_HREF = 'su-dialog.css?v=2026-11-12';
    var queue = [];      // 待っている窓 {kind, msg, done}
    var current = null;  // 今出ている窓

    try {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      (document.head || document.documentElement).appendChild(link);
    } catch (e) { /* 読めなくても CSSOM の指定で出る */ }

    /* ブラウザの窓に落とす（この部品が使えない時の道） */
    function nativeAsk(kind, msg) {
      try {
        if (kind === 'confirm') return !!window.confirm(msg);
        window.alert(msg);
      } catch (e) { /* 何もしない */ }
      return kind === 'confirm' ? false : undefined;
    }

    function css(el, o) { try { for (var k in o) el.style[k] = o[k]; } catch (e) { /* 何もしない */ } }

    function build(item) {
      var dlg = document.createElement('dialog');
      dlg.className = 'sud-dlg';
      dlg.setAttribute('aria-modal', 'true');
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
      var cancel = item.kind === 'confirm' ? btn('キャンセル', false) : null;
      var ok = btn('OK', true);
      if (cancel) row.appendChild(cancel);
      row.appendChild(ok);
      inner.appendChild(p);
      inner.appendChild(row);
      dlg.appendChild(inner);
      return { dlg: dlg, ok: ok, cancel: cancel };
    }

    function finish(item, value) {
      if (item.settled) return;
      item.settled = true;
      try { if (item.parts && item.parts.dlg.open) item.parts.dlg.close(); } catch (e) { /* 何もしない */ }
      try { if (item.parts && item.parts.dlg.parentNode) item.parts.dlg.parentNode.removeChild(item.parts.dlg); } catch (e) { /* 何もしない */ }
      if (current === item) current = null;
      try { item.done(item.kind === 'confirm' ? !!value : undefined); } catch (e) { /* 何もしない */ }
      next();
    }

    function show(item) {
      var parts = null;
      try { parts = build(item); } catch (e) { parts = null; }
      if (!parts) return false;
      item.parts = parts;
      var dlg = parts.dlg;
      try {
        parts.ok.addEventListener('click', function () { finish(item, true); });
        if (parts.cancel) parts.cancel.addEventListener('click', function () { finish(item, false); });
        /* Esc（ブラウザが cancel を出す）と、ほかの理由で閉じた時はキャンセル扱い */
        dlg.addEventListener('cancel', function () { finish(item, false); });
        dlg.addEventListener('close', function () { finish(item, false); });
        dlg.addEventListener('keydown', function (e) {
          /* 押しっぱなしの Enter（窓を開いたボタンの Enter の続き）で OK にしない。窓の中のキーは画面へ伝えない（画面の Esc の処理を一緒に動かさない） */
          try {
            if (e.key === 'Enter' && e.repeat) e.preventDefault();
            e.stopPropagation();
          } catch (err) { /* 何もしない */ }
        });
        /* 画面の中央に置く（画面の「*{margin:0}」などで UA の中央寄せが消えても中央に出す） */
        css(dlg, { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', margin: 'auto', height: 'fit-content' });
        (document.body || document.documentElement).appendChild(dlg);
        dlg.showModal();
        try { parts.ok.focus(); } catch (e) { /* 何もしない */ }
      } catch (e) {
        try { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); } catch (err) { /* 何もしない */ }
        item.parts = null;
        return false;
      }
      return true;
    }

    function next() {
      while (!current && queue.length) {
        var item = queue.shift();
        current = item;
        if (show(item)) return;
        /* 出せなかった: ブラウザの窓で聞く（同じ順番のまま） */
        current = null;
        item.settled = true;
        var v = nativeAsk(item.kind, item.msg);
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

    function ask(kind, msg) {
      return new Promise(function (resolve) {
        try {
          queue.push({ kind: kind, msg: msg, done: resolve, settled: false, parts: null });
          next();
        } catch (e) {
          resolve(nativeAsk(kind, msg));
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
