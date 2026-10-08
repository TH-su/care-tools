/* su-annot.js — 画面の指摘（注釈モード）の部品（2026-10-04 新設・提案3・代表者の決定）
 *
 * なぜ必要か: 「ここの文字が切れる」をチャットで長文に直して説明する手間をなくす。
 *   管理者が画面の部品を指で指して一言書くと、部品の場所（CSS の書き方）・大きさ・はみ出し・端末の情報と、
 *   文字を塗りつぶした配置図が1件の報告になる（送り先は「不具合を報告」と同じ受け口 → GitHub の Issue）。
 *
 * 読み込み: 各画面には <script> を足さない。su-report.js が、管理者が「画面の場所を指して報告」を押した時だけ読み込む。
 *   check/annot-render.mjs（配置図を絵にする道具）もこのファイルを読み、SUAnnot.draw だけを使う。
 *   読み込んだだけでは何もしない（window.SUAnnot を置くだけ）。
 *
 * 個人情報の扱い（設計の中心）:
 *   ・画面の写真は撮らない。代わりに「配置図」を作る＝部品の四角の位置・大きさ・色と、文字がある所の帯（位置と長さだけ）。
 *     文字・入力の値・画像の中身は読み取らない・描かない。だから氏名・病名・居室番号は配置図に入りようがない。
 *     （入力欄は「値があるか」と、その帯の長さだけを測る。パスワード欄は帯も描かない）
 *   ・部品の名前（CSS の書き方）には、英数字と - _ だけの id・class だけを使う（3桁以上の数字を含むものは捨てる＝居室番号を拾わない）。
 *   ・3画素より小さい四角は配置図に入れない（細かい点を並べて文字を描くことをしにくくする。受け口の GAS も同じ決まりで捨てる）。
 *   ・指摘ごとの一言は管理者が書く自由記述。受け口で伏せ字にかけ、画面にも「氏名・居室番号・病名は書かない」を出す。
 *
 * 操作中は画面全体に透明の板を敷く＝画面のボタン・入力には指が届かない（押しても画面の保存・通信は起きない）。
 * 画面のスクロールはそのまま効く（マウスのホイールは、指している所のスクロールする枠へ渡す）。
 *
 * 使い方（su-report.js から）:
 *   SUAnnot.start({ marks: 前回の結果の marks（指し直す時）, onDone: function (res) {...}, onCancel: function () {...} })
 *     res = { marks: [{ n, note, sel, desc, el }], layout: 配置図 }   ※ el は送らない（画面の中だけで使う）
 *   SUAnnot.draw(canvas, layout, scale) → 配置図を canvas に描く（送る前の確認と、Issue の絵づくりの両方で同じ描き方）
 *   SUAnnot.clean(layout) → 形を確かめて、数値と色だけの配置図に作り直す（形が違えば null）
 */
(function () {
  'use strict';
  if (window.SUAnnot) return;

  var MAX_MARKS = 20;        // 1回の報告で指せる数
  var MAX_NOTE = 200;        // 一言の長さ
  var MAX_RECTS = 1800;      // 配置図の四角の数（多い時は指した所に近いものを残す）
  var MAX_H = 3000;          // 配置図の高さ（CSS px）
  var MAX_JSON = 44000;      // 配置図の文字数（受け口の上限 45000 の内側。送信の上限 64KB にも収める）
  var MIN_PX = 3;            // これより小さい四角は入れない
  var RED = '#d93025';

  /* ── 配置図の形（受け口の GAS・check/annot-render.mjs も同じ決まりで確かめる） ──
     { v:1, w:幅, h:高さ, p:[色 'rrggbb' …], r:[[種類, x, y, 幅, 高さ, 色番号] …], m:[[番号, x, y, 幅, 高さ] …] }
     種類: 0 塗り（背景）／1 枠線／2 文字のある所の帯／3 画像・図の場所（中身は描かない）。色番号 -1 は既定の灰色 */
  function int(v, lo, hi) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function clean(L) {
    try {
      if (!L || typeof L !== 'object' || L.v !== 1) return null;
      var w = int(L.w, 1, 4000), h = int(L.h, 1, 6000);
      if (w == null || h == null || !Array.isArray(L.p) || !Array.isArray(L.r)) return null;
      var p = [];
      for (var i = 0; i < L.p.length && i < 64; i++) { if (typeof L.p[i] !== 'string' || !/^[0-9a-f]{6}$/.test(L.p[i])) return null; p.push(L.p[i]); }
      var r = [];
      for (i = 0; i < L.r.length && i < 2000; i++) {
        var q = L.r[i];
        if (!Array.isArray(q) || q.length !== 6) return null;
        var k = int(q[0], 0, 3), x = int(q[1], -100, w + 100), y = int(q[2], -100, h + 100), qw = int(q[3], 0, 6000), qh = int(q[4], 0, 6000), c = int(q[5], -1, p.length - 1);
        if (k == null || x == null || y == null || qw == null || qh == null || c == null) return null;
        if (qw < MIN_PX || qh < MIN_PX) continue;      // 細かすぎる四角は捨てる（点で文字を描けないように）
        r.push([k, x, y, qw, qh, c]);
      }
      var m = [];
      var ml = Array.isArray(L.m) ? L.m : [];
      for (i = 0; i < ml.length && i < MAX_MARKS; i++) {
        var a = ml[i];
        if (!Array.isArray(a) || a.length !== 5) return null;
        var n = int(a[0], 1, MAX_MARKS), mx = int(a[1], -100, w + 100), my = int(a[2], -100, h + 100), mw = int(a[3], 0, 6000), mh = int(a[4], 0, 6000);
        if (n == null || mx == null || my == null || mw == null || mh == null) return null;
        m.push([n, mx, my, mw, mh]);
      }
      return { v: 1, w: w, h: h, p: p, r: r, m: m };
    } catch (e) { return null; }
  }

  function roundRect(x, l, t, w, h, rad) {
    rad = Math.max(0, Math.min(rad, w / 2, h / 2));
    x.beginPath();
    x.moveTo(l + rad, t); x.lineTo(l + w - rad, t); x.quadraticCurveTo(l + w, t, l + w, t + rad);
    x.lineTo(l + w, t + h - rad); x.quadraticCurveTo(l + w, t + h, l + w - rad, t + h);
    x.lineTo(l + rad, t + h); x.quadraticCurveTo(l, t + h, l, t + h - rad);
    x.lineTo(l, t + rad); x.quadraticCurveTo(l, t, l + rad, t);
    x.closePath(); x.fill();
  }
  /* 配置図を描く。文字は描かない（指摘の番号の数字だけ） */
  function draw(canvas, layout, scale) {
    var L = clean(layout);
    if (!L || !canvas || !canvas.getContext) return false;
    var s = scale || 1;
    canvas.width = Math.max(1, Math.round(L.w * s));
    canvas.height = Math.max(1, Math.round(L.h * s));
    var x = canvas.getContext('2d');
    x.setTransform(s, 0, 0, s, 0, 0);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, L.w, L.h);
    for (var i = 0; i < L.r.length; i++) {
      var q = L.r[i], col = q[5] >= 0 ? '#' + L.p[q[5]] : '#9aa0a6';
      if (q[0] === 0) { x.fillStyle = col; x.fillRect(q[1], q[2], q[3], q[4]); }
      else if (q[0] === 1) { x.strokeStyle = col; x.lineWidth = 1; x.strokeRect(q[1] + 0.5, q[2] + 0.5, Math.max(0, q[3] - 1), Math.max(0, q[4] - 1)); }
      else if (q[0] === 2) {
        var bh = Math.max(2, q[4] * 0.56);
        x.globalAlpha = 0.45; x.fillStyle = col;
        roundRect(x, q[1], q[2] + (q[4] - bh) / 2, Math.max(2, q[3]), bh, 3);
        x.globalAlpha = 1;
      } else {
        x.fillStyle = '#e8eaed'; x.fillRect(q[1], q[2], q[3], q[4]);
        x.strokeStyle = '#bdc1c6'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(q[1], q[2]); x.lineTo(q[1] + q[3], q[2] + q[4]); x.moveTo(q[1] + q[3], q[2]); x.lineTo(q[1], q[2] + q[4]); x.stroke();
        x.strokeRect(q[1] + 0.5, q[2] + 0.5, Math.max(0, q[3] - 1), Math.max(0, q[4] - 1));
      }
    }
    for (i = 0; i < L.m.length; i++) {
      var m = L.m[i];
      x.strokeStyle = RED; x.lineWidth = 3;
      x.strokeRect(m[1] - 1.5, m[2] - 1.5, m[3] + 3, m[4] + 3);
      var cx = Math.min(Math.max(m[1], 12), L.w - 12), cy = Math.min(Math.max(m[2], 12), L.h - 12);
      x.fillStyle = RED; x.beginPath(); x.arc(cx, cy, 11, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffffff'; x.font = 'bold 13px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(m[0]), cx, cy + 0.5);
    }
    return true;
  }

  /* ── 部品の名前（CSS の書き方）。英数字と - _ だけの id・class だけを使う ── */
  var SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
  function okToken(t) { return SAFE_TOKEN.test(t) && !/\d{3,}/.test(t) && !/^su[ar]-/.test(t); }   // 3桁以上の数字（居室番号など）を含む名前は使わない
  function selectorOf(el) {
    var parts = [];
    for (var e = el; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement && parts.length < 6; e = e.parentElement) {
      var tag = e.tagName.toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) tag = '*';
      if (e.id && okToken(e.id)) { parts.unshift('#' + e.id); break; }
      var part = tag;
      var cls = [];
      try { for (var i = 0; i < e.classList.length && cls.length < 2; i++) if (okToken(e.classList[i])) cls.push(e.classList[i]); } catch (x) { /* 何もしない */ }
      if (cls.length) part += '.' + cls.join('.');
      var dk = e.getAttribute && e.getAttribute('data-k');
      if (dk && okToken(dk)) part += '[data-k="' + dk + '"]';
      var p = e.parentElement;
      if (p) {
        var same = 0, idx = 0;
        for (var c = p.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === e.tagName) { same++; if (c === e) idx = same; }
        if (same > 1) part += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ').slice(0, 200) || el.tagName.toLowerCase();
  }
  /* 部品の事実（文字の中身は読まない）。x/y は配置図の中の位置 */
  function describe(el, r, region) {
    var L = [], cs = null;
    try { cs = getComputedStyle(el); } catch (e) { cs = null; }
    L.push(el.tagName.toLowerCase());
    L.push(inRegion(r, region) ? '配置図の x' + Math.round(r.left - region.l) + ' y' + Math.round(r.top - region.t) : '配置図の外（離れた所を指したため）');
    L.push('大きさ ' + Math.round(r.width) + '×' + Math.round(r.height));
    var cw = el.clientWidth, ch = el.clientHeight, sw = el.scrollWidth, sh = el.scrollHeight;
    if (cw > 0 && ch > 0 && (sw - cw > 1 || sh - ch > 1)) {
      var o = [];
      if (sw - cw > 1) o.push('横に' + (sw - cw) + 'px');
      if (sh - ch > 1) o.push('縦に' + (sh - ch) + 'px');
      L.push('中身 ' + sw + '×' + sh + '（' + o.join('・') + 'はみ出し' + (cs && cs.overflow !== 'visible' ? '・' + cs.overflow : '') + '）');
    }
    if (cs) L.push('文字 ' + Math.round(parseFloat(cs.fontSize) || 0) + 'px');
    return L.join('・');
  }

  /* ── 色 ── */
  function parseColor(s) {
    var m = String(s || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
    if (!m) return null;
    var a = m[4] == null ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (!(a > 0.04)) return null;
    function ch(v) { v = parseFloat(v); return Math.max(0, Math.min(255, Math.round(v * a + 255 * (1 - a)))); }   // 白の上に重ねた色にする
    return [ch(m[1]), ch(m[2]), ch(m[3])];
  }
  function hex(c) { return ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1); }

  /* ── 配置図を作る ── */
  var MEDIA = { IMG: 1, CANVAS: 1, VIDEO: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, svg: 1, SVG: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1 };
  var NO_DESCEND = { INPUT: 1, SELECT: 1, TEXTAREA: 1, svg: 1, SVG: 1, BUTTON: 0 };
  function inter(a, b) {
    var l = Math.max(a.l, b.l), t = Math.max(a.t, b.t), r = Math.min(a.r, b.r), bt = Math.min(a.b, b.b);
    return (r - l >= 0.5 && bt - t >= 0.5) ? { l: l, t: t, r: r, b: bt } : null;
  }
  function boxOf(r) { return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }

  function capture(marks, isOurs) {
    var de = document.documentElement;
    var W = Math.round(de.clientWidth || window.innerWidth), VH = window.innerHeight;
    var mr = [];
    for (var i = 0; i < marks.length; i++) mr.push(markRect(marks[i]));
    var top = 0, bot = VH;
    for (i = 0; i < mr.length; i++) { top = Math.min(top, mr[i].top - 16); bot = Math.max(bot, mr[i].bottom + 16); }
    if (bot - top > MAX_H) {      // 高さの上限に収まらない時は、指摘がいちばん多く入る範囲を選ぶ（同じ数なら後に指した方）
      var bestTop = top, bestN = -1;
      var starts = [0];
      for (i = 0; i < mr.length; i++) starts.push(mr[i].top - 16, mr[i].bottom + 16 - MAX_H);
      for (i = 0; i < starts.length; i++) {
        var st = starts[i], cnt = 0, last = -1;
        for (var j = 0; j < mr.length; j++) if (mr[j].top >= st && mr[j].bottom <= st + MAX_H) { cnt++; last = j; }
        if (cnt > bestN || (cnt === bestN && last >= 0)) { bestN = cnt; bestTop = st; }
      }
      top = bestTop; bot = top + MAX_H;
    }
    top = Math.floor(top);
    var H = Math.max(1, Math.min(MAX_H, Math.ceil(bot - top)));
    var region = { l: 0, t: top, r: W, b: top + H };

    var pal = [], palIx = {};
    function colIx(c) {
      if (!c) return -1;
      var h = hex(c);
      if (palIx[h] != null) return palIx[h];
      if (pal.length >= 64) {   // 色が多すぎる時は近い色に寄せる
        var best = 0, bd = Infinity;
        for (var j = 0; j < pal.length; j++) {
          var v = parseInt(pal[j], 16), d = Math.abs((v >> 16) - c[0]) + Math.abs(((v >> 8) & 255) - c[1]) + Math.abs((v & 255) - c[2]);
          if (d < bd) { bd = d; best = j; }
        }
        return best;
      }
      palIx[h] = pal.length; pal.push(h);
      return palIx[h];
    }
    var base = [], over = [], seq = 0;
    function add(list, k, rect, c, clip) {
      var b = inter(boxOf(rect), clip);
      if (!b) return;
      list.push({ q: [k, Math.round(b.l - region.l), Math.round(b.t - region.t), Math.round(b.r - b.l), Math.round(b.b - b.t), c], i: seq++ });
    }
    var range = document.createRange();
    var meas = null;
    function textWidth(s, cs) {
      try {
        if (!meas) meas = document.createElement('canvas').getContext('2d');
        meas.font = cs.font || (cs.fontSize + ' sans-serif');
        return meas.measureText(s).width;
      } catch (e) { return 0; }
    }
    function formBar(el, cs, r, list, clip) {
      var tag = el.tagName, type = String(el.type || '').toLowerCase(), s = '';
      if (tag === 'INPUT') {
        if (type === 'password' || type === 'hidden' || type === 'file' || type === 'range' || type === 'color') return;
        if (type === 'checkbox' || type === 'radio') {
          if (el.checked) add(list, 0, { left: r.left + r.width * 0.25, top: r.top + r.height * 0.25, right: r.right - r.width * 0.25, bottom: r.bottom - r.height * 0.25 }, colIx([32, 33, 36]), clip);
          return;
        }
        s = String(el.value || '');
      } else if (tag === 'SELECT') {
        var o = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        s = o ? String(o.text || '') : '';
      } else if (tag === 'TEXTAREA') s = String(el.value || '');
      if (!/\S/.test(s)) return;
      var pl = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
      var pr = (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderRightWidth) || 0);
      var fs = parseFloat(cs.fontSize) || 14, inner = Math.max(0, r.width - pl - pr);
      var bw = tag === 'TEXTAREA' ? inner * 0.8 : Math.min(inner, textWidth(s.split('\n')[0], cs));
      var lh = fs * 1.25, bt = tag === 'TEXTAREA' ? r.top + (parseFloat(cs.paddingTop) || 0) + 2 : r.top + (r.height - lh) / 2;
      add(list, 2, { left: r.left + pl, top: bt, right: r.left + pl + bw, bottom: bt + lh }, colIx(parseColor(cs.color)), clip);
    }
    function textNode(tn, cs, list, clip) {
      if (!/\S/.test(tn.data) || cs.visibility === 'hidden') return;
      try {
        range.selectNodeContents(tn);
        var rs = range.getClientRects(), c = colIx(parseColor(cs.color));
        for (var j = 0; j < rs.length && j < 200; j++) if (rs[j].width >= 1 && rs[j].height >= 1) add(list, 2, rs[j], c, clip);
      } catch (e) { /* 測れない文字は飛ばす */ }
    }
    function walk(node, ncs, clip, top) {
      for (var ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 3) { textNode(ch, ncs, top ? over : base, clip); continue; }
        if (ch.nodeType !== 1 || SKIP[ch.tagName] || isOurs(ch)) continue;
        var cs;
        try { cs = getComputedStyle(ch); } catch (e) { continue; }
        if (cs.display === 'none' || cs.opacity === '0') continue;
        var isTop = top || cs.position === 'fixed' || cs.position === 'sticky';   // 固定の帯は後から描く（上に重なる）
        var list = isTop ? over : base;
        var r = ch.getBoundingClientRect();
        var vis = cs.visibility !== 'hidden' && r.width >= 1 && r.height >= 1;
        var c2 = clip;
        if (cs.position === 'fixed') c2 = { l: region.l, t: Math.max(region.t, 0), r: region.r, b: Math.min(region.b, VH) };   // 固定のものは今の画面の中だけ
        if (vis) {
          if (MEDIA[ch.tagName]) { add(list, 3, r, -1, c2); continue; }
          var bg = parseColor(cs.backgroundColor);
          if (bg) add(list, 0, r, colIx(bg), c2);
          if (/url\(/.test(cs.backgroundImage || '')) add(list, 3, r, -1, c2);
          var bwid = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
          if (bwid > 0) {
            var bc = parseColor(cs.borderTopColor) || parseColor(cs.borderBottomColor) || parseColor(cs.borderLeftColor);
            if (bc) add(list, 1, r, colIx(bc), c2);
          }
          if (ch.tagName === 'INPUT' || ch.tagName === 'SELECT' || ch.tagName === 'TEXTAREA') formBar(ch, cs, r, list, c2);
        }
        if (NO_DESCEND[ch.tagName]) continue;
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') c2 = inter(c2, boxOf(r));
        if (!c2) continue;
        walk(ch, cs, c2, isTop);
      }
    }
    var bodyCs = getComputedStyle(document.body);
    var pageBg = parseColor(bodyCs.backgroundColor) || parseColor(getComputedStyle(de).backgroundColor) || [255, 255, 255];
    add(base, 0, { left: region.l, top: region.t, right: region.r, bottom: region.b }, colIx(pageBg), region);
    walk(document.body, bodyCs, region, false);

    var all = base.concat(over).filter(function (o) { return o.q[3] >= MIN_PX && o.q[4] >= MIN_PX; });
    var limit = MAX_RECTS;
    for (var round = 0; round < 12; round++) {
      var trimmed = trim(all, limit);
      var est = JSON.stringify(trimmed.map(function (o) { return o.q; })).length + pal.length * 9 + 200;
      if (est <= MAX_JSON) { all = trimmed; break; }
      limit = Math.floor(Math.min(limit, trimmed.length) * 0.85);
      if (round === 11) all = trimmed;
    }
    function trim(all, limit) {
      if (all.length <= limit) return all;
      var ms = [];
      for (var k = 0; k < mr.length; k++) ms.push({ x: (mr[k].left + mr[k].right) / 2 - region.l, y: (mr[k].top + mr[k].bottom) / 2 - region.t });
      var dist = function (o) {
        if (o.i === 0) return -1;
        var cx = o.q[1] + o.q[3] / 2, cy = o.q[2] + o.q[4] / 2, d = Infinity;
        for (var j = 0; j < ms.length; j++) d = Math.min(d, Math.abs(cx - ms[j].x) + Math.abs(cy - ms[j].y));
        return ms.length ? d : cy;
      };
      var keep = all.map(function (o, j) { return { o: o, d: dist(o), j: j }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, limit)
        .sort(function (a, b) { return a.j - b.j; });
      return keep.map(function (k) { return k.o; });
    }
    var m = [];
    for (i = 0; i < marks.length; i++) {
      if (!inRegion(mr[i], region)) continue;    // 配置図の外の指摘は描かない（説明に「配置図の外」と書く）
      m.push([marks[i].n, Math.round(mr[i].left - region.l), Math.round(mr[i].top - region.t), Math.round(mr[i].width), Math.round(mr[i].height)]);
    }
    return { layout: clean({ v: 1, w: W, h: H, p: pal, r: all.map(function (o) { return o.q; }), m: m }), region: region, rects: mr };
  }
  function inRegion(r, region) { return r.bottom > region.t && r.top < region.b && r.right > region.l && r.left < region.r; }
  function markRect(mk) {
    try { if (mk.el && mk.el.isConnected) { var r = mk.el.getBoundingClientRect(); mk.last = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; } } catch (e) { /* 前の位置を使う */ }
    return mk.last || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  /* ── 指す操作 ── */
  var CSS = [
    '.sua-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:14px/1.5 system-ui,sans-serif}',
    '.sua-board{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:transparent;touch-action:auto}',
    '.sua-hover{position:fixed;pointer-events:none;outline:2px dashed #0b57d0;outline-offset:1px;background:rgba(11,87,208,.08);display:none}',
    '.sua-cur{position:fixed;pointer-events:none;outline:3px solid #0b57d0;outline-offset:1px;background:rgba(11,87,208,.10);display:none}',
    '.sua-mark{position:fixed;pointer-events:none;outline:3px solid ' + RED + ';outline-offset:1px}',
    '.sua-badge{position:absolute;left:-12px;top:-12px;min-width:24px;height:24px;border-radius:12px;background:' + RED + ';color:#fff;',
    'font:700 13px/24px system-ui,sans-serif;text-align:center;pointer-events:auto;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3)}',
    '.sua-bar{position:fixed;left:8px;right:8px;top:8px;pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;',
    'padding:10px 12px;border-radius:12px;background:#202124;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.3)}',
    '.sua-bar.sua-low{top:auto;bottom:8px}',
    '.sua-bar .sua-t{flex:1 1 220px;font-weight:600}',
    '.sua-btn{min-height:44px;min-width:44px;padding:8px 14px;border-radius:8px;border:1px solid #dadce0;background:#fff;color:#202124;font:600 14px system-ui,sans-serif;cursor:pointer}',
    '.sua-btn.pri{background:#0b57d0;border-color:transparent;color:#fff}',
    '.sua-btn:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}',
    '.sua-bar .sua-btn.sub{background:transparent;color:#fff;border-color:#5f6368}',
    '.sua-pop{position:fixed;pointer-events:auto;width:min(340px,calc(100vw - 16px));box-sizing:border-box;padding:12px;border-radius:12px;',
    'background:#fff;color:#202124;box-shadow:0 8px 30px rgba(0,0,0,.3)}',
    '.sua-pop h3{margin:0 0 6px;font-size:15px}',
    '.sua-pop .sua-tag{margin-left:6px;font:12px ui-monospace,monospace;color:#5f6368}',
    '.sua-pop textarea{width:100%;min-height:64px;box-sizing:border-box;padding:8px;border:1px solid #dadce0;border-radius:8px;font:inherit}',
    '.sua-pop .sua-w{margin:4px 0 0;font-size:12px;color:#8a3a00;font-weight:600}',
    '.sua-pop .sua-e{margin:4px 0 0;font-size:12px;color:#b3261e;font-weight:600}',
    '.sua-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
    '@media print{.sua-root{display:none!important}}'
  ].join('');

  var active = false;
  function start(opt) {
    opt = opt || {};
    if (active) return false;
    active = true;
    var onDone = typeof opt.onDone === 'function' ? opt.onDone : function () {};
    var onCancel = typeof opt.onCancel === 'function' ? opt.onCancel : function () {};

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    var root = document.createElement('div');
    root.className = 'sua-root';
    root.innerHTML =
      '<div class="sua-board"></div><div class="sua-hover"></div><div class="sua-cur"></div><div class="sua-marks"></div>' +
      '<div class="sua-bar" role="toolbar" aria-label="画面の指摘">' +
      '<span class="sua-t" aria-live="polite"></span>' +
      '<button class="sua-btn sub" type="button" data-a="move">帯を下へ</button>' +
      '<button class="sua-btn pri" type="button" data-a="done">できた</button>' +
      '<button class="sua-btn sub" type="button" data-a="quit">やめる</button>' +
      '</div>';
    document.body.appendChild(root);
    var board = root.querySelector('.sua-board'), hover = root.querySelector('.sua-hover'), cur = root.querySelector('.sua-cur');
    var marksBox = root.querySelector('.sua-marks'), bar = root.querySelector('.sua-bar'), msg = root.querySelector('.sua-t');
    function isOurs(e) {
      if (!e || e.nodeType !== 1) return false;
      if (root.contains(e)) return true;
      var c = typeof e.className === 'string' ? e.className : '';
      return /(^|\s)su[ar]-/.test(c);   // 報告のボタン・報告の枠（su-report.js）も見ない
    }
    var marks = [];
    (opt.marks || []).forEach(function (m) { if (m && m.el && marks.length < MAX_MARKS) marks.push({ n: marks.length + 1, el: m.el, note: String(m.note || ''), last: m.last || null }); });
    var pop = null;   // { el, mark, box }

    function say() {
      msg.textContent = marks.length
        ? '指摘 ' + marks.length + 'か所。続けて指すか、「できた」を押してください'
        : '直してほしい場所を押してください（何か所でも指せます）';
    }
    function place(div, r) {
      div.style.left = r.left + 'px'; div.style.top = r.top + 'px';
      div.style.width = Math.max(0, r.width) + 'px'; div.style.height = Math.max(0, r.height) + 'px';
    }
    function renderMarks() {
      marksBox.innerHTML = '';
      marks.forEach(function (m, i) {
        m.n = i + 1;
        var d = document.createElement('div');
        d.className = 'sua-mark';
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'sua-badge'; b.textContent = String(m.n);
        b.setAttribute('aria-label', '指摘 ' + m.n + ' を直す・消す');
        b.addEventListener('click', function (e) { e.stopPropagation(); openPop(m.el, m); });
        d.appendChild(b);
        marksBox.appendChild(d);
        m.div = d;
      });
      say();
    }
    var raf = 0;
    function tick() {
      raf = 0;
      if (!active) return;
      marks.forEach(function (m) { if (m.div) place(m.div, markRect(m)); });
      if (pop) {
        var r = pop.el.isConnected ? pop.el.getBoundingClientRect() : null;
        if (r) { cur.style.display = 'block'; place(cur, r); }
      } else cur.style.display = 'none';
      raf = requestAnimationFrame(tick);
    }
    function pick(x, y) {
      var list = [];
      try { list = document.elementsFromPoint(x, y); } catch (e) { list = []; }
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (isOurs(e)) continue;
        if (e === document.body || e === document.documentElement) return null;
        return e;
      }
      return null;
    }
    function closePop() { if (pop) { pop.box.remove(); pop = null; } }
    function openPop(el, mark) {
      closePop();
      hover.style.display = 'none';
      var box = document.createElement('div');
      box.className = 'sua-pop';
      box.setAttribute('role', 'dialog');
      var n = mark ? mark.n : marks.length + 1;
      box.setAttribute('aria-label', '指摘 ' + n);
      box.innerHTML =
        '<h3>指摘 ' + n + '<span class="sua-tag"></span></h3>' +
        '<textarea maxlength="' + MAX_NOTE + '" placeholder="例：ここの文字が切れる／この枠を右に揃えたい" aria-label="この場所について一言"></textarea>' +
        '<p class="sua-w">氏名・居室番号・病名は書かないでください。</p>' +
        '<p class="sua-e" hidden></p>' +
        '<div class="sua-row">' +
        '<button class="sua-btn pri" type="button" data-a="ok">決める</button>' +
        '<button class="sua-btn" type="button" data-a="up">外側を選ぶ</button>' +
        '<button class="sua-btn" type="button" data-a="del">' + (mark ? 'この指摘を消す' : '取り消す') + '</button>' +
        '</div>';
      root.appendChild(box);
      pop = { el: el, mark: mark, box: box };
      var ta = box.querySelector('textarea'), tag = box.querySelector('.sua-tag'), err = box.querySelector('.sua-e');
      ta.value = mark ? mark.note : '';
      function showTag() {
        var r = pop.el.getBoundingClientRect();
        tag.textContent = pop.el.tagName.toLowerCase() + '・' + Math.round(r.width) + '×' + Math.round(r.height);
        var up = box.querySelector('[data-a="up"]');
        var p = pop.el.parentElement;
        up.disabled = !p || p === document.body || p === document.documentElement || !!mark;
        // 置き場所: 部品の下が空いていれば下、無ければ上。画面の外に出さない
        var bw = box.offsetWidth, bh = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
        var left = Math.min(Math.max(8, r.left), W - bw - 8), topY = r.bottom + 8;
        if (topY + bh > H - 8) topY = r.top - bh - 8;
        if (topY < 8) topY = Math.max(8, H - bh - 8);
        box.style.left = left + 'px'; box.style.top = topY + 'px';
      }
      showTag();
      box.addEventListener('click', function (e) {
        e.stopPropagation();
        var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
        if (a === 'ok') {
          var note = ta.value.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
          if (!note) { err.hidden = false; err.textContent = '一言を書いてください。'; ta.focus(); return; }
          if (mark) mark.note = note;
          else if (marks.length < MAX_MARKS) marks.push({ n: marks.length + 1, el: pop.el, note: note, last: null });
          closePop(); renderMarks();
        } else if (a === 'up') {
          var p = pop.el.parentElement;
          if (p && p !== document.body && p !== document.documentElement) { pop.el = p; showTag(); }
        } else if (a === 'del') {
          if (mark) marks.splice(marks.indexOf(mark), 1);
          closePop(); renderMarks();
        }
        if (!pop) focusBar();
      });
      try { ta.focus(); } catch (e) { /* 何もしない */ }   // すぐに入力できるように（打ち始めた文字が帯のボタンに行かないように）
    }

    function onMove(e) {
      if (pop || e.pointerType === 'touch') return;
      var t = pick(e.clientX, e.clientY);
      if (!t) { hover.style.display = 'none'; return; }
      hover.style.display = 'block'; place(hover, t.getBoundingClientRect());
    }
    function onClick(e) {
      e.preventDefault(); e.stopPropagation();
      if (pop) { closePop(); focusBar(); return; }      // 一言の枠の外を押したら、その指摘はやめる
      if (marks.length >= MAX_MARKS) { msg.textContent = '一度に指せるのは ' + MAX_MARKS + 'か所までです。「できた」を押してください'; return; }
      var t = pick(e.clientX, e.clientY);
      if (t) openPop(t, null);
    }
    function onWheel(e) {     // ホイールは、指している所のスクロールする枠へ渡す（無ければ画面全体がそのまま動く）
      var t = pick(e.clientX, e.clientY);
      for (var el = t; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        var cs = getComputedStyle(el);
        var canY = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
        var canX = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
        if ((canY && e.deltaY) || (canX && (e.deltaX || e.shiftKey))) {
          e.preventDefault();
          el.scrollBy({ left: e.deltaX || (e.shiftKey ? e.deltaY : 0), top: e.shiftKey ? 0 : e.deltaY });
          return;
        }
      }
    }
    /* キー操作は裏の画面に一切渡さない（Backspace で選んでいる予定が消える・Ctrl+S で保存される、を起こさない）。
       window の capture で受け、指摘の帯・一言の枠の外が相手のキーは止める。Tab は帯と枠の中だけで回す */
    function focusables() { return Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]),textarea')).filter(function (e) { return e.offsetParent !== null || e.getClientRects().length; }); }
    function focusBar() { try { var b = (pop ? pop.box.querySelector('textarea') : null) || bar.querySelector('button'); if (b) b.focus(); } catch (e) { /* 何もしない */ } }
    function scroller(t, dx, dy) {   // 指している所から外へ、その向きにまだ動けるスクロールの枠を探す
      for (var el = t; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        var cs = getComputedStyle(el);
        var canY = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);
        var canX = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0);
        if ((dy && canY) || (dx && canX)) return el;
      }
      return null;
    }
    var touch = null;   // 指で表の中を横・縦に動かした時も、その表を動かす（無ければ画面全体がそのまま動く）
    function onTouchStart(e) { if (e.touches.length !== 1) { touch = null; return; } var p = e.touches[0]; touch = { x: p.clientX, y: p.clientY, t: pick(p.clientX, p.clientY), el: null }; }
    function onTouchMove(e) {
      if (!touch || e.touches.length !== 1) return;
      var p = e.touches[0], dx = touch.x - p.clientX, dy = touch.y - p.clientY;
      var horiz = Math.abs(dx) > Math.abs(dy);
      var el = touch.el || scroller(touch.t, horiz ? dx : 0, horiz ? 0 : dy);
      if (!el) return;
      touch.el = el;
      e.preventDefault();
      el.scrollBy({ left: dx, top: dy });
      touch.x = p.clientX; touch.y = p.clientY;
    }
    function onKey(e) {
      var inside = e.target && e.target.nodeType === 1 && root.contains(e.target);
      if (inside && (e.isComposing || e.keyCode === 229)) return;   // 日本語の変換中の Esc・Tab は変換の操作（一言の枠を閉じない）
      if (e.type === 'keydown' && e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (pop) { closePop(); focusBar(); } else finish(false);
        return;
      }
      if (e.type === 'keydown' && e.key === 'Tab') {
        var f = focusables();
        if (f.length) {
          var i = f.indexOf(document.activeElement);
          var nx = i === -1 ? 0 : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
          e.preventDefault(); e.stopImmediatePropagation();
          f[nx].focus();
          return;
        }
      }
      if (!inside) { e.preventDefault(); e.stopImmediatePropagation(); focusBar(); }
    }
    board.addEventListener('pointermove', onMove);
    board.addEventListener('click', onClick);
    board.addEventListener('wheel', onWheel, { passive: false });
    board.addEventListener('touchstart', onTouchStart, { passive: true });
    board.addEventListener('touchmove', onTouchMove, { passive: false });
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      root.addEventListener(t, function (e) { e.stopPropagation(); });   // 一言の入力を裏の画面のキー操作に渡さない
      window.addEventListener(t, onKey, true);
    });
    bar.addEventListener('click', function (e) {
      e.stopPropagation();
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'move') { var low = bar.classList.toggle('sua-low'); e.target.textContent = low ? '帯を上へ' : '帯を下へ'; }
      else if (a === 'done') {
        if (pop) {      // 書きかけの一言は、書いてあれば決めたことにする
          var ta = pop.box.querySelector('textarea');
          var note = ta ? ta.value.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '';
          if (note) { if (pop.mark) pop.mark.note = note; else if (marks.length < MAX_MARKS) marks.push({ n: marks.length + 1, el: pop.el, note: note, last: null }); }
          closePop();
        }
        finish(true);
      } else if (a === 'quit') finish(false);
    });

    function finish(ok) {
      if (!active) return;
      var res = ok ? { layout: null, marks: [] } : null;   // 全部消して「できた」＝指摘なし（前の指摘は戻さない）
      if (ok && marks.length) {
        marks.forEach(function (m, i) { m.n = i + 1; markRect(m); });
        root.style.display = 'none';   // 配置図に自分の部品を入れない（isOurs でも外しているが、念のため）
        try {
          var cap = capture(marks, isOurs);
          res = {
            layout: cap.layout,
            marks: marks.map(function (m, i) {
              return { n: m.n, note: m.note, sel: selectorOf(m.el), desc: describe(m.el, cap.rects[i], cap.region), el: m.el, last: m.last };
            })
          };
        } catch (e) {
          res = { layout: null, marks: marks.map(function (m) { return { n: m.n, note: m.note, sel: selectorOf(m.el), desc: '', el: m.el, last: m.last }; }) };
        }
      }
      active = false;
      if (raf) cancelAnimationFrame(raf);
      ['keydown', 'keyup', 'keypress'].forEach(function (t) { window.removeEventListener(t, onKey, true); });
      root.remove(); style.remove();
      try { if (res) onDone(res); else onCancel(); } catch (e) { /* 呼び出し側の失敗を外に出さない */ }
    }

    renderMarks();
    raf = requestAnimationFrame(tick);
    focusBar();     // 画面の入力欄にフォーカスを残さない（キーが画面に届かないように）
    return true;
  }

  window.SUAnnot = { start: start, draw: draw, clean: clean, MAX_MARKS: MAX_MARKS };
})();
