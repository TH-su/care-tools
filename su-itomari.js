/*
 * su-itomari.js — メニューの毬（菊かがり・麻の葉）を描く部品（2026-10-26 代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * 目的: メニュー（index.html）の見出しの左と、メニューの設定（menu-settings.html）の見本に、
 *       「出ているツールの数」に合わせて育つ手まりを描く。アプリのアイコン（ロゴ v3 の菊かがり）と同じ球の描き方。
 *
 * ★描くだけ。端末に書かない・通信しない・例外を外に出さない（失敗した時は null を返す）。
 * ★SVG は図形を1つずつ作って組み立てる（createElementNS と setAttribute だけ）。文字列の HTML は使わない。
 * ★style の属性・<style> は使わず、fill・stroke などの表示の属性だけで描く（メニューの設定の画面の CSP は style を許さない）。
 * ★リンク先（href）は分野の色を選ぶ表を引くためだけに使い、SVG には入れない。SVG に入るのは数と色と座標だけ。
 *
 * 柄:
 *   kiku    菊かがり。10枚の花びらを5つの分野が2枚ずつ持ち、その分野のツール1本＝かがり1周。
 *           下地の色は クリーム → 薄い藍 → 紺（全体の3/4で紺）。1/4から帯、半分から後ろの段。全部そろうと金の縁と大きな結び目。
 *           ツールが0本の分野は花びらの形を点線で出す。
 *   asanoha 麻の葉。正二十面体を2つに割った格子に、ツール1本＝花1輪（いちばん手前の枠から順に咲く・32の枠）。
 *           半分から麻の葉の線。ツールが32本を超えた時は、出ている割合だけ32の枠に咲かせる。全部そろうと金の結び目。
 *   分野（色の順）: 記録・くすり/もの・入居者・計画・職員。表に無いリンク先は「入居者」の色。
 *
 * 使い方:
 *   SUItomari.render({kind, small, shown, all, px}) → <svg> の要素か null
 *     kind   'kiku' | 'asanoha'（それ以外は kiku）
 *     small  true で見出し用（線を太く・本数を減らす。麻の葉の糸の質感は描かない）
 *     shown  出ているツールのリンク先の配列（分子）  all  数えるツールのリンク先の配列（分母）
 *     px     幅と高さ（px）。無ければ viewBox だけ
 *   SUItomari.familyOf(href) → 分野の番号 0〜4（純関数）
 *   SUItomari.tally(shown, all) → {n, N, have:[5], total:[5]}（純関数。n は min(出ている数, 全体)）
 *   SUItomari.flowerCount(n, N) → 麻の葉に咲かせる花の数（純関数。32の枠）
 *   SUItomari.label(kind, n, N) → 読み上げの名前（純関数）
 *   SUItomari.name(kind) / other(kind)
 */
(function () {
  'use strict';
  if (window.SUItomari) return;

  var NS = 'http://www.w3.org/2000/svg';
  var NAVY = '#1F2A44', GOLD = '#D4AF5F', CREAM = '#F4EFE6';
  var COLORS = ['#D9483B', '#E8A92E', '#6BAA5A', '#3BA6B5', '#E58FA8'];
  var LIGHT = ['#F0A79F', '#F5D08A', '#B5D6A8', '#9FD3DA', '#F5C6D3'];
  var TIER = ['#F3E3B5', '#FBF7EE'];
  var KINDS = ['kiku', 'asanoha'];
  var NAMES = { kiku: '菊かがり', asanoha: '麻の葉' };
  var FAMILY_NAMES = ['記録', 'くすり・もの', '入居者', '計画', '職員'];
  var OTHER = 2;   // 表に無いリンク先は「入居者」
  // リンク先 → 分野（メニューの定義 #menuDef の業務ツール 23本・2026-10-26）。新しいツールは表に足す（足さなければ入居者の色）
  var FAMILY = {
    'https://th-su.github.io/care-log/': 0,
    'https://th-su.github.io/care-log/#/record/daycare': 0,
    'https://th-su.github.io/haiben-record/haiben-record.html': 0,
    'weight-record.html': 0,
    'moushiokuri-viewer.html': 0,
    'patch-calendar.html': 1,
    'supplies.html': 1,
    'https://kitchen-app-9o7.pages.dev/': 1,
    'resident-master.html': 2,
    'facesheet.html': 2,
    'genogram.html': 2,
    'resident-master.html?view=bday': 2,
    'admission-flow.html': 2,
    'care-schedule.html': 3,
    'visit-overview.html': 3,
    'daycare-roster.html': 3,
    'training-plan.html': 3,
    'care-meeting.html': 3,
    'shift-app.html': 4,
    'work-schedule.html': 4,
    'shift-analyzer.html': 4,
    'staff-master.html': 4,
    'ats.html': 4
  };
  var SLOTS = 32;
  var R = 48, CX = 50, CY = 50;   // viewBox 0 0 100 100
  var uid = 0;

  /* ── 純関数 ── */
  function familyOf(href) {
    return (typeof href === 'string' && Object.prototype.hasOwnProperty.call(FAMILY, href)) ? FAMILY[href] : OTHER;
  }
  function list(a) { return Array.isArray(a) ? a : []; }
  function tally(shown, all) {
    var total = [0, 0, 0, 0, 0], have = [0, 0, 0, 0, 0];
    var A = list(all), S = list(shown);
    A.forEach(function (h) { total[familyOf(h)]++; });
    S.forEach(function (h) { have[familyOf(h)]++; });
    for (var g = 0; g < 5; g++) if (have[g] > total[g]) have[g] = total[g];
    var N = A.length;
    return { n: Math.max(0, Math.min(S.length, N)), N: N, have: have, total: total };
  }
  /* 麻の葉に咲かせる花の数。32本までは1本＝1輪。超えたら割合（1本でもあれば1輪・全部でなければ31輪まで） */
  function flowerCount(n, N) {
    n = Math.max(0, Math.min(n | 0, N | 0)); N = N | 0;
    if (N <= SLOTS) return n;
    if (n >= N) return SLOTS;
    if (n <= 0) return 0;
    return Math.max(1, Math.min(SLOTS - 1, Math.round(SLOTS * n / N)));
  }
  function kindOf(k) { return KINDS.indexOf(k) >= 0 ? k : 'kiku'; }
  function name(k) { return NAMES[kindOf(k)]; }
  function other(k) { return kindOf(k) === 'kiku' ? 'asanoha' : 'kiku'; }
  function label(k, n, N) {
    return '毬の柄：' + name(k) + '。' + (N | 0) + '本中' + (n | 0) + '本。押すと' + name(other(k)) + 'に切り替わります';
  }
  /* 分野を交互に並べた順（どの分野も早めに出る） */
  function interleave(counts) {
    var left = counts.slice(), seq = [];
    while (left.some(function (x) { return x > 0; })) {
      for (var g = 0; g < 5; g++) if (left[g] > 0) { seq.push(g); left[g]--; }
    }
    return seq;
  }

  /* ── 色と数 ── */
  function hex2(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mix(c1, c2, t) {
    t = Math.max(0, Math.min(1, t));
    var a = hex2(c1), b = hex2(c2), s = '#';
    for (var i = 0; i < 3; i++) { var v = Math.round(a[i] + (b[i] - a[i]) * t); s += (v < 16 ? '0' : '') + v.toString(16); }
    return s;
  }
  function f1(x) { return (Math.round(x * 10) / 10).toString(); }
  function f2(x) { return (Math.round(x * 100) / 100).toString(); }
  function norm(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sc(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function rad(d) { return d * Math.PI / 180; }

  /* ── SVG の要素（表示の属性だけ） ── */
  function E(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  function shade(defs, id, stops) {
    var g = E('radialGradient', { id: id, cx: '0.36', cy: '0.30', r: '0.78' }, defs);
    stops.forEach(function (s) { E('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] }, g); });
  }

  /* ── 球（ロゴ v3 と同じ投影。pole の向きに柄の軸を置く） ── */
  function Ball(pole) {
    var P = norm(pole);
    var U = Math.abs(P[2]) < 0.999 ? norm(cross(P, [0, 0, 1])) : [1, 0, 0];
    var V = cross(P, U);
    function pt(th, ph) {
      var a = rad(th), b = rad(ph), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      return [ca * P[0] + sa * (cb * U[0] + sb * V[0]), ca * P[1] + sa * (cb * U[1] + sb * V[1]), ca * P[2] + sa * (cb * U[2] + sb * V[2])];
    }
    function clip(poly) {
      var out = [], n = poly.length;
      for (var i = 0; i < n; i++) {
        var A = poly[i], B = poly[(i + 1) % n], ina = A[2] >= 0, inb = B[2] >= 0;
        if (ina) out.push(A);
        if (ina !== inb) { var t = A[2] / (A[2] - B[2]); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
      }
      return out;
    }
    function path(poly) {
      var q = clip(poly);
      if (q.length < 3) return null;
      var s = 'M';
      for (var i = 0; i < q.length; i++) s += (i ? ' L' : '') + f1(CX + R * q[i][0]) + ',' + f1(CY + R * q[i][1]);
      return s + 'Z';
    }
    function petal(ph0, T, W, o) {
      var twist = o.twist || 0, th0 = o.th0 || 0, n = o.n || 48, sharp = o.sharp == null ? 0.75 : o.sharp, base = o.base || 0;
      var L = [], Rr = [];
      for (var i = 0; i <= n; i++) {
        var th = th0 + (T - th0) * i / n;
        var f = Math.pow(Math.sin(Math.PI * (base + (1 - base) * i / n)), sharp);
        var c = ph0 + twist * (th / T);
        L.push(pt(th, c - W * f)); Rr.push(pt(th, c + W * f));
      }
      return path(L.concat(Rr.reverse()));
    }
    return { pt: pt, path: path, petal: petal };
  }

  /* ── 菊かがり ── */
  function drawKiku(svg, t, small) {
    var N = t.N, k = t.n, p = N > 0 ? k / N : 0, done = N > 0 && k === N;
    var b = Ball([-0.17, -0.38, 0.91]);
    var sw = R * (small ? 0.03 : 0.016), n = 10, step = 36, tw = 8, pn = small ? 16 : 48, cap = small ? 3 : 8;
    var q = Math.min(1, p / 0.75);
    var base = q < 0.5 ? mix('#EFE9DC', '#AFC0DD', q / 0.5) : mix('#AFC0DD', NAVY, (q - 0.5) / 0.5);
    var id = 'su-itomari-' + (++uid);
    var defs = E('defs', {}, svg);
    shade(defs, id + 's', [['0', '#fff', '.30'], ['.45', '#fff', '0'], ['.8', '#000', '.10'], ['1', '#000', '.38']]);
    E('circle', { cx: CX, cy: CY, r: R }, E('clipPath', { id: id + 'c' }, defs));
    E('circle', { cx: CX, cy: CY, r: R, fill: base }, svg);
    var g = E('g', { 'clip-path': 'url(#' + id + 'c)' }, svg);
    var d, i;
    // 帯（全体の1/4から）
    if (p >= 0.25) {
      var seg = small ? 36 : 72, w = 360 / seg;
      for (i = 0; i < seg; i++) {
        d = b.path([b.pt(98, i * w), b.pt(98, (i + 1) * w), b.pt(110, (i + 1) * w), b.pt(110, i * w)]);
        if (d) E('path', { d: d, fill: CREAM }, g);
      }
    }
    // 後ろの段（半分から）
    if (p >= 0.5) {
      for (i = 0; i < n; i++) {
        d = b.petal(i * step + step / 2, 92, step * 0.60, { twist: tw, th0: 18, n: pn });
        if (d) E('path', { d: d, fill: TIER[i % 2], stroke: GOLD, 'stroke-width': f2(sw) }, g);
      }
    }
    // 花びら: 分野ごとに2枚。ツール1本＝かがり1周（外の周から内へ）
    for (i = 0; i < n; i++) {
      var fam = i % 5, h = t.have[fam], ng = t.total[fam];
      if (!h || !ng) {
        d = b.petal(i * step, 76, step * 0.74, { twist: tw, sharp: 0.6, base: 0.22, n: pn });
        if (d) E('path', { d: d, fill: 'none', stroke: mix(base, '#ffffff', 0.45), 'stroke-width': f2(sw * 0.7), 'stroke-dasharray': f1(R * 0.03) + ' ' + f1(R * 0.03) }, g);
        continue;
      }
      var rounds = Math.min(h, cap), top = h / ng;
      for (var j = rounds; j >= 1; j--) {
        var f = top * j / rounds;
        d = b.petal(i * step, Math.max(14, 76 * f), step * 0.74 * (0.35 + 0.65 * f), { twist: tw * f, sharp: 0.6, base: 0.22, n: pn });
        if (d) E('path', { d: d, fill: (rounds - j) % 2 === 0 ? COLORS[fam] : LIGHT[fam], stroke: GOLD, 'stroke-width': f2(sw * (j === rounds ? 1 : 0.6)), 'stroke-linejoin': 'round' }, g);
      }
    }
    var c = b.pt(0, 0);
    if (k > 0) E('circle', { cx: f1(CX + R * c[0]), cy: f1(CY + R * c[1]), r: f1(R * (done ? 0.08 : 0.045)), fill: GOLD }, g);
    E('circle', { cx: CX, cy: CY, r: R, fill: 'url(#' + id + 's)' }, svg);
    E('circle', { cx: CX, cy: CY, r: f2(R - sw), fill: 'none', stroke: done ? GOLD : mix(base, '#ffffff', 0.3), 'stroke-width': f2(sw * (done ? 2.2 : (small ? 1 : 0.8))) }, svg);
  }

  /* ── 麻の葉（正二十面体を2つに割った格子） ── */
  var AX = rad(-28), AY = rad(18);
  function rot(v) {
    var x = v[0], y = v[1], z = v[2], y2 = y * Math.cos(AX) - z * Math.sin(AX), z2 = y * Math.sin(AX) + z * Math.cos(AX);
    return [x * Math.cos(AY) + z2 * Math.sin(AY), y2, -x * Math.sin(AY) + z2 * Math.cos(AY)];
  }
  function view(p) { return rot(norm(p)); }
  var GEO = null;   // 形は数だけなので、初めて描く時に1回だけ作る
  function geo() {
    if (GEO) return GEO;
    var t = (1 + Math.sqrt(5)) / 2;
    var IV = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    var IF = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    var faces = [];
    IF.forEach(function (f) {
      var A = IV[f[0]], B = IV[f[1]], C = IV[f[2]], ab = norm(add(A, B)), bc = norm(add(B, C)), ca = norm(add(C, A));
      faces.push([A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]);
    });
    var big = [], spoke = [], fine = [], seen = {};
    function key(P) { return P.map(function (x) { return x.toFixed(4); }).join(','); }
    faces.forEach(function (F) {
      var A = F[0], B = F[1], C = F[2], G = norm(add(add(A, B), C));
      [[A, B], [B, C], [C, A]].forEach(function (e) {
        var k1 = key(e[0]), k2 = key(e[1]), k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
        if (!seen[k]) { seen[k] = 1; big.push(e); }
      });
      [A, B, C].forEach(function (P) { spoke.push([G, P]); });
      [[A, B], [B, C], [C, A]].forEach(function (e) {
        var gg = norm(add(add(G, e[0]), e[1]));
        fine.push([gg, G], [gg, e[0]], [gg, e[1]]);
      });
    });
    var slots = IV.slice().concat(IF.map(function (f) { return norm(add(add(IV[f[0]], IV[f[1]]), IV[f[2]])); }));
    slots.sort(function (a, b) { return view(b)[2] - view(a)[2]; });   // いちばん手前の枠から
    GEO = { IV: IV, big: big, spoke: spoke, fine: fine, slots: slots };
    return GEO;
  }
  function arc(a, b, n) {
    var out = [];
    for (var i = 0; i <= n; i++) out.push(norm(add(sc(a, 1 - i / n), sc(b, i / n))));
    return out;
  }
  /* 見えている所だけをつないだ線の d（M…L… を足していく） */
  function strokeD(pts) {
    var s = '', cur = [];
    function flush() {
      if (cur.length > 1) { s += 'M'; for (var i = 0; i < cur.length; i++) s += (i ? ' L' : '') + f1(CX + R * cur[i][0]) + ',' + f1(CY + R * cur[i][1]); }
      cur = [];
    }
    for (var i = 0; i < pts.length; i++) {
      var q = view(pts[i]);
      if (q[2] > 0.02) cur.push(q); else flush();
    }
    flush();
    return s;
  }
  function lines(parent, d, col, w, op) {
    if (!d) return;
    var a = { d: d, fill: 'none', stroke: col, 'stroke-width': f2(w), 'stroke-linecap': 'round' };
    if (op != null && op < 1) a['stroke-opacity'] = f2(op);
    E('path', a, parent);
  }
  function tangent(c) {
    var a = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    var u = norm(cross(a, c));
    return [u, cross(c, u)];
  }
  function flower(parent, c, col, seed, small) {
    var uv = tangent(c), n = small ? 12 : 30, r = 0.27, d = '';
    for (var k = 0; k < n; k++) {
      var ang = 2 * Math.PI * k / n + seed * 0.37;
      var L = r * (0.5 + 0.5 * ((Math.sin(seed * 12.9 + k * 7.3) + 1) / 2));
      var dir = norm(add(sc(uv[0], Math.cos(ang)), sc(uv[1], Math.sin(ang))));
      d += strokeD(arc(c, norm(add(c, sc(dir, Math.tan(L)))), small ? 5 : 10));
    }
    lines(parent, d, col, R * (small ? 0.03 : 0.015));
    var q = view(c);
    if (q[2] > 0.02) E('circle', { cx: f1(CX + R * q[0]), cy: f1(CY + R * q[1]), r: f1(R * (small ? 0.04 : 0.022)), fill: '#F2D24B' }, parent);
  }
  /* 糸の質感の乱数（毎回同じ絵になるよう種を決める。Math.random は使わない） */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function drawAsanoha(svg, t, small) {
    var N = t.N, k = t.n, p = N > 0 ? k / N : 0, done = N > 0 && k === N, G = geo();
    var base = mix('#EFE9DC', '#6F8FC4', Math.min(1, p * 1.6));
    var grid = mix('#B9B2A4', '#2E5B4A', Math.min(1, p * 1.6));
    var id = 'su-itomari-' + (++uid);
    var defs = E('defs', {}, svg);
    shade(defs, id + 's', [['0', '#fff', '.35'], ['.5', '#fff', '0'], ['1', '#000', '.30']]);
    E('circle', { cx: CX, cy: CY, r: R, fill: base }, svg);
    var i, d;
    // 糸の質感（大きい時だけ）
    if (k >= 1 && !small) {
      var r = rng(7);
      d = '';
      for (i = 0; i < 160; i++) {
        var a = norm([gauss(r), gauss(r), gauss(r)]), bb = norm([gauss(r), gauss(r), gauss(r)]);
        d += strokeD(arc(a, bb, 24));
      }
      lines(svg, d, mix(base, '#ffffff', 0.35), R * 0.004, 0.45);
    }
    // 大きな三角の格子（1本目から）
    if (k >= 1) {
      d = '';
      G.big.forEach(function (e) { d += strokeD(arc(e[0], e[1], small ? 8 : 16)); });
      lines(svg, d, grid, R * (small ? 0.022 : 0.012));
    }
    // 麻の葉の線（半分から）。小さい時は中心から角への線だけ
    if (N > 0 && k >= N * 0.5) {
      var op = Math.min(1, (k - N * 0.5) / (N * 0.25) + 0.35);
      d = '';
      G.spoke.forEach(function (e) { d += strokeD(arc(e[0], e[1], small ? 4 : 10)); });
      if (!small) G.fine.forEach(function (e) { d += strokeD(arc(e[0], e[1], 10)); });
      lines(svg, d, grid, R * (small ? 0.016 : 0.008), op);
    }
    // 花（1本＝1輪。32本を超えたら割合）
    var m = flowerCount(k, N), seq = interleave(t.have);
    for (i = 0; i < m; i++) {
      var fam = seq.length ? seq[Math.min(seq.length - 1, Math.floor(i * seq.length / m))] : OTHER;
      flower(svg, G.slots[i], COLORS[fam], i + 1, small);
    }
    if (done) {
      G.IV.forEach(function (P) {
        var q = view(P);
        if (q[2] > 0.05) E('circle', { cx: f1(CX + R * q[0]), cy: f1(CY + R * q[1]), r: f1(R * (small ? 0.05 : 0.03)), fill: GOLD }, svg);
      });
    }
    E('circle', { cx: CX, cy: CY, r: R, fill: 'url(#' + id + 's)' }, svg);
    var sw = R * (done ? (small ? 0.04 : 0.025) : (small ? 0.02 : 0.01));
    E('circle', { cx: CX, cy: CY, r: f2(R - sw / 2), fill: 'none', stroke: done ? GOLD : '#C9C2B4', 'stroke-width': f2(sw) }, svg);
  }

  function note(e) {
    try { if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note('メニューの毬', e, 'su-itomari.js'); } catch (e2) { /* 記録できなくても描かないだけ */ }
  }

  function render(o) {
    try {
      o = o || {};
      if (typeof document === 'undefined' || !document.createElementNS) return null;
      var kind = kindOf(o.kind), small = !!o.small, t = tally(o.shown, o.all);
      var svg = E('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
      var px = Number(o.px);
      if (isFinite(px) && px > 0) { svg.setAttribute('width', f1(px)); svg.setAttribute('height', f1(px)); }
      if (kind === 'asanoha') drawAsanoha(svg, t, small); else drawKiku(svg, t, small);
      return svg;
    } catch (e) {
      note(e);
      return null;
    }
  }

  window.SUItomari = {
    render: render, familyOf: familyOf, tally: tally, flowerCount: flowerCount, label: label,
    name: name, other: other, KINDS: KINDS.slice(), FAMILY_NAMES: FAMILY_NAMES.slice(), SLOTS: SLOTS
  };
})();
