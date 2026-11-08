/*
 * su-qr.js — QR コードの絵を描く小さな部品（2026-11-08 新設・使える人の管理の「端末登録の QR」）
 * ════════════════════════════════════════════════════════════════
 * ・外の配信元・外の部品を使わない（CLAUDE.md §3 の決まり）。中身は JIS X 0510（ISO/IEC 18004）の手順そのもの:
 *   8ビットのバイトの形・誤り訂正 M（約15%）・型番 1〜10・8つの模様から減点の最も少ないものを選ぶ。
 * ・通信しない・端末に何も残さない・画面の DOM には SUQr.svg() が返す絵を置くだけ（文字は入れない）。
 * ・試験: check/unit/su_qr_test.js（8つの模様とも、別の作り方（Python の qrcode）で作った絵と1マスずつ同じことを
 *   指紋で確かめる・作った絵を読み取れる形かも確かめる）。
 *
 * 使い方:
 *   SUQr.matrix('https://…')        → { size, dark(x, y), mask, version }（x は左から・y は上から）
 *   SUQr.svg('https://…', { px: 240, label: '端末登録の QR' }) → <svg>（白い余白4マスつき・黒と白だけ）
 */
(function () {
  'use strict';
  if (window.SUQr) return;

  // 誤り訂正 M の、型番 1〜10 の「1ブロックの誤り訂正の語数」と「ブロックの数」（JIS X 0510 表9）
  var ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var MAX_VER = 10;
  var FORMAT_M = 0;   // 誤り訂正 M の形式の印（2ビット）

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_M[ver] * BLOCKS_M[ver]; }

  // GF(256)（原始多項式 0x11D）の掛け算
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(deg) {
    var r = [];
    for (var i = 0; i < deg - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = mul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = mul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function utf8(s) {
    var out = [];
    var e = unescape(encodeURIComponent(String(s)));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }

  function encodeData(bytes) {
    var ver;
    for (ver = 1; ver <= MAX_VER; ver++) {
      var cc = ver < 10 ? 8 : 16;
      if (4 + cc + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > MAX_VER) throw new Error('QR に入りきりません');
    var bits = [];
    function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    put(4, 4);                                   // 8ビットのバイトの形
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));      // 終わりの印
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var words = [];
    for (var i = 0; i < bits.length; i += 8) {
      var w = 0;
      for (var j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
      words.push(w);
    }
    return { ver: ver, words: words };
  }

  function addEcc(ver, data) {
    var nb = BLOCKS_M[ver], el = ECC_M[ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(el), blocks = [], k = 0;
    for (var i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortLen - el || j >= nShort) out.push(blocks[j][i]);
      }
    }
    return out;
  }

  function alignPos(ver, size) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6];
    for (var p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }

  function build(ver, codewords, mask) {
    var size = ver * 4 + 17;
    var m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, d) { m[y][x] = !!d; fn[y][x] = true; }

    for (var i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    });
    var ap = alignPos(ver, size), na = ap.length;
    for (i = 0; i < na; i++) for (var j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (var ddy = -2; ddy <= 2; ddy++) for (var ddx = -2; ddx <= 2; ddx++) {
        setF(ap[i] + ddx, ap[j] + ddy, Math.max(Math.abs(ddx), Math.abs(ddy)) !== 1);
      }
    }
    function formatBits(msk) {
      var data = (FORMAT_M << 3) | msk, rem = data;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      var b = function (n) { return ((bits >>> n) & 1) === 1; };
      for (var a = 0; a <= 5; a++) setF(8, a, b(a));
      setF(8, 7, b(6)); setF(8, 8, b(7)); setF(7, 8, b(8));
      for (a = 9; a < 15; a++) setF(14 - a, 8, b(a));
      for (a = 0; a < 8; a++) setF(size - 1 - a, 8, b(a));
      for (a = 8; a < 15; a++) setF(8, size - 15 + a, b(a));
      setF(8, size - 8, true);
    }
    formatBits(0);   // 場所を取っておく（模様を決めた後に描き直す）
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bit = ((vb >>> i) & 1) === 1, a = size - 11 + i % 3, bb = Math.floor(i / 3);
        setF(a, bb, bit); setF(bb, a, bit);
      }
    }
    // データを右下からジグザグに置く
    var k = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < size; v++) for (var jj = 0; jj < 2; jj++) {
        var x = right - jj, up = ((right + 1) & 2) === 0, yy2 = up ? size - 1 - v : v;
        if (!fn[yy2][x] && k < codewords.length * 8) {
          m[yy2][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
          k++;
        }
      }
    }
    function applyMask(msk) {
      for (var y3 = 0; y3 < size; y3++) for (var x3 = 0; x3 < size; x3++) {
        var inv;
        switch (msk) {
          case 0: inv = (x3 + y3) % 2 === 0; break;
          case 1: inv = y3 % 2 === 0; break;
          case 2: inv = x3 % 3 === 0; break;
          case 3: inv = (x3 + y3) % 3 === 0; break;
          case 4: inv = (Math.floor(x3 / 3) + Math.floor(y3 / 2)) % 2 === 0; break;
          case 5: inv = (x3 * y3) % 2 + (x3 * y3) % 3 === 0; break;
          case 6: inv = ((x3 * y3) % 2 + (x3 * y3) % 3) % 2 === 0; break;
          default: inv = ((x3 + y3) % 2 + (x3 * y3) % 3) % 2 === 0;
        }
        if (!fn[y3][x3] && inv) m[y3][x3] = !m[y3][x3];
      }
    }
    function penalty() {
      var res = 0;
      function addHist(len, h) { if (h[0] === 0) len += size; h.pop(); h.unshift(len); }
      function count(h) {
        var n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
        return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
      }
      function term(color, len, h) { if (color) { addHist(len, h); len = 0; } len += size; addHist(len, h); return count(h); }
      for (var pass = 0; pass < 2; pass++) {
        for (var a1 = 0; a1 < size; a1++) {
          var color = false, run = 0, h = [0, 0, 0, 0, 0, 0, 0];
          for (var a2 = 0; a2 < size; a2++) {
            var c = pass === 0 ? m[a1][a2] : m[a2][a1];
            if (c === color) {
              run++;
              if (run === 5) res += 3; else if (run > 5) res++;
            } else {
              addHist(run, h);
              if (!color) res += count(h) * 40;
              color = c; run = 1;
            }
          }
          res += term(color, run, h) * 40;
        }
      }
      var dark = 0;
      for (var y4 = 0; y4 < size; y4++) for (var x4 = 0; x4 < size; x4++) {
        if (m[y4][x4]) dark++;
        if (y4 < size - 1 && x4 < size - 1) {
          var cc = m[y4][x4];
          if (cc === m[y4][x4 + 1] && cc === m[y4 + 1][x4] && cc === m[y4 + 1][x4 + 1]) res += 3;
        }
      }
      var total = size * size;
      res += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return res;
    }
    var chosen = mask;
    if (chosen == null) {
      var best = Infinity;
      for (var t = 0; t < 8; t++) {
        applyMask(t); formatBits(t);
        var p = penalty();
        if (p < best) { best = p; chosen = t; }
        applyMask(t);   // 戻す（同じ模様をもう一度かけると元に戻る）
      }
    }
    applyMask(chosen); formatBits(chosen);
    return { size: size, mods: m, mask: chosen };
  }

  // 文字列 → マスの表。opts.mask（0〜7）で模様を決め打ちできる（試験用）
  function matrix(text, opts) {
    var enc = encodeData(utf8(text));
    var mask = opts && typeof opts.mask === 'number' ? opts.mask : null;
    var r = build(enc.ver, addEcc(enc.ver, enc.words), mask);
    return {
      size: r.size, version: enc.ver, mask: r.mask,
      dark: function (x, y) { return x >= 0 && y >= 0 && x < r.size && y < r.size && r.mods[y][x]; }
    };
  }

  var NS = 'http://www.w3.org/2000/svg';
  // SVG の絵（白地に黒・余白4マス）。文字は入れない（読み上げ用の名前だけ付ける）
  function svg(text, opts) {
    opts = opts || {};
    var q = matrix(text), quiet = 4, n = q.size + quiet * 2;
    var d = [];
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
      if (q.dark(x, y)) d.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z');
    }
    var el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
    var px = String(opts.px || 240);
    el.setAttribute('width', px);
    el.setAttribute('height', px);
    el.setAttribute('shape-rendering', 'crispEdges');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', String(opts.label || 'QR コード'));
    var bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', String(n)); bg.setAttribute('height', String(n)); bg.setAttribute('fill', '#ffffff');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d.join('')); p.setAttribute('fill', '#000000');
    el.appendChild(bg); el.appendChild(p);
    return el;
  }

  window.SUQr = { matrix: matrix, svg: svg };
})();
