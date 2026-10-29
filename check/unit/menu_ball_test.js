/* メニューの毬（菊かがり・麻の葉）の試験（2026-10-26 代表者の決定）
   実行: node check/unit/menu_ball_test.js
   守ること:
     1 柄の決め方（su-menu.js）: 端末の選択 → 施設の既定（ログインして読めた設定の控えだけ）→ 菊かがり。
       壊れた値・知らない値は無視する。ログインしていない端末は施設の既定を読まない。
       書くのは鍵 su_menu_ball だけ・値は 'kiku'・'asanoha' だけ。選んだ柄が施設の既定と同じ時は鍵を消す。保存領域が使えなくても止まらない
     2 分野と数（su-itomari.js の純関数）: 今の23本が 記録5・くすり/もの3・入居者5・計画5・職員5。表に無いリンク先は入居者。
       出ている数は全体で止める。麻の葉は32本を超えたら割合で咲かせる。読み上げの名前
     3 描いた SVG: style の属性・<style> が無い・表示の属性だけ・リンク先などの外の文字が入らない。
       0〜64本の全段階・両方の柄・大小で例外を出さず、毎回同じ絵（乱数を使わない）。描けない時は null
     4 メニュー（index.html）の数え方: 分母は定義の業務ツール（既定の区分が設定・困った時でないもの）、
       分子は組み立てたボタンのうち業務ツールで、現場端末では自分も親も事務所専用でないもの。
       非表示・区分の移動（設定の区分への移動を含む）・32本超・0本・出ている数＞全体。押すと柄が切り替わり、読み上げの名前が変わる。
       数え直すのは、設定を読み直した後と「戻る」で開き直した時
     5 毬の部品が無い・描けない時はボタンを出さず、メニューはそのまま出る
   画面と部品のコードは書き換えず、そのまま読み込んで小さな DOM で動かす。データは架空（リンク先の名前だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MENU_SRC = fs.readFileSync(path.join(ROOT, 'su-menu.js'), 'utf8');
const BALL_SRC = fs.readFileSync(path.join(ROOT, 'su-itomari.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* 組み立てのスクリプト（定義の次の <script>）と定義 */
const defEnd = HTML.indexOf('</script>', HTML.indexOf('id="menuDef"'));
const sStart = HTML.indexOf('<script>', defEnd) + '<script>'.length;
const BUILD = HTML.slice(sStart, HTML.indexOf('</script>', sStart));
const DEF_TEXT = HTML.slice(HTML.indexOf('>', HTML.indexOf('id="menuDef"')) + 1, defEnd);
const DEF = JSON.parse(DEF_TEXT);

/* ── 小さな DOM（組み立て・毬に要る分だけ）── */
function matches(e, sel) {
  const m = /^([a-zA-Z]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/.exec(sel.trim());
  if (!m || !e || !e.tagName) return false;
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
  const cls = m[2] ? m[2].split('.').filter(Boolean) : [];
  if (cls.some(c => !e.classList.contains(c))) return false;
  const at = m[3] ? m[3].match(/\[[^\]]+\]/g) : [];
  return at.every(a => { const x = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a); return x[1] in e.attrs && (x[2] === undefined || e.attrs[x[1]] === x[2]); });
}
function makeEl(tag, ns) {
  const e = {
    tagName: ns ? tag : tag.toUpperCase(), ns: ns || null, attrs: {}, children: [], parentNode: null, _text: '', listeners: {}, id: '',
    get className() { return this.attrs.class || ''; }, set className(v) { this.attrs.class = String(v); },
    classList: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v); this.children.forEach(c => { c.parentNode = null; }); this.children = []; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); },
    all(sel) { const out = []; const walk = n => { for (const c of n.children || []) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; },
    querySelectorAll(sel) { return this.all(sel); },
    querySelector(sel) { return this.all(sel)[0] || null; },
    closest(sel) { let n = this; while (n && n.tagName) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
  };
  e.classList = {
    contains: c => (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0,
    add: c => { if (!e.classList.contains(c)) e.className = (e.className + ' ' + c).trim(); },
    remove: c => { e.className = e.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
    toggle: (c, on) => { if (on) e.classList.add(c); else e.classList.remove(c); }
  };
  return e;
}
function memStore(init, throws) {
  return {
    _d: Object.assign({}, init || {}), writes: [],
    getItem(k) { if (throws) throw new Error('SecurityError'); return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { if (throws) throw new Error('SecurityError'); this.writes.push([k, String(v)]); this._d[k] = String(v); },
    removeItem(k) { if (throws) throw new Error('SecurityError'); this.writes.push([k, null]); delete this._d[k]; },
    key(i) { if (throws) throw new Error('SecurityError'); return Object.keys(this._d)[i]; },
    get length() { if (throws) throw new Error('SecurityError'); return Object.keys(this._d).length; }
  };
}
const LOGIN = { 'sb-abc-auth-token': 'x' };   // ログインの記録（鍵の名前だけを見る）
const cacheOf = (config, role) => JSON.stringify({ role: role || 'office', config: config, at: '2026-10-26T00:00:00Z' });

/* ページを動かす。opt: store・throws・field・itomari(false で読まない)・render（render の差し替え）・def（定義の文字） */
function page(opt) {
  opt = opt || {};
  const html = makeEl('html');
  if (opt.field) html.classList.add('is-field');
  const hdr = makeEl('header'); hdr.className = 'hdr';
  const h1 = makeEl('h1'); h1.textContent = '介護ツール メニュー'; hdr.appendChild(h1);
  const sub = makeEl('p'); sub.className = 'sub'; hdr.appendChild(sub);
  const main = makeEl('main'); main.id = 'menu';
  html.appendChild(hdr); html.appendChild(main);
  const ls = memStore(opt.store, opt.throws);
  const reports = [], notes = [];
  const listeners = {};
  const box = {
    localStorage: ls, JSON, Array, String, Object, Error, Math, Number, Promise, setTimeout, isFinite, parseInt,
    document: {
      documentElement: html, readyState: 'loading',
      getElementById: id => (id === 'menu' ? main : id === 'menuDef' ? { textContent: opt.def || DEF_TEXT } : null),
      createElement: tag => makeEl(tag),
      createElementNS: (ns, tag) => makeEl(tag, ns),
      createTextNode: s => ({ textContent: String(s), children: [] }),
      querySelector: sel => html.querySelector(sel),
      querySelectorAll: sel => html.querySelectorAll(sel),
      getElementsByTagName: () => [],
      addEventListener() {}
    },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    SUErrors: { report: (a, e) => reports.push([a, e && e.message]), note: (k, e) => notes.push([k, e && e.message]) }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(MENU_SRC, box);
  let resync = null;
  box.SUMenu.startSync = fn => { resync = fn; };   // 設定の読み直しは試験から呼ぶ（通信しない）
  if (opt.itomari !== false) {
    vm.runInContext(BALL_SRC, box);
    if (opt.render) box.SUItomari.render = opt.render;
  }
  let err = null;
  try { vm.runInContext(BUILD, box); } catch (e) { err = e.message; }
  const btn = () => hdr.querySelector('button.ball');
  return {
    box, ls, hdr, main, html, reports, notes, err, btn,
    label: () => (btn() ? btn().getAttribute('aria-label') : null),
    tiles: () => main.querySelectorAll('a.tile').map(a => a.getAttribute('href')),
    resync: (cfg, role) => resync && resync(cfg, role),
    fire: (ev, e) => (listeners[ev] || []).forEach(fn => fn(e))
  };
}
const L = (kind, n, N) => '毬の柄：' + kind + '。' + N + '本中' + n + '本。押すと' + (kind === '菊かがり' ? '麻の葉' : '菊かがり') + 'に切り替わります';

/* 部品だけを読む（純関数の試験用） */
function parts(store, throws) {
  const ls = memStore(store, throws);
  const box = { localStorage: ls, JSON, Math, Number, Object, Array, String, Promise, setTimeout, isFinite,
    document: { readyState: 'loading', getElementsByTagName: () => [], createElementNS: (ns, tag) => makeEl(tag, ns) } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(MENU_SRC, box);
  vm.runInContext(BALL_SRC, box);
  return { M: box.SUMenu, B: box.SUItomari, ls, box };
}

console.log('\n— 1. 柄の決め方（su-menu.js）—');
{
  const asa = cacheOf({ ver: 1, ball: 'asanoha' });
  t('1a 端末の選択も設定も無い → 菊かがり', parts({}).M.ball() === 'kiku');
  t('1b ログインして読めた施設の既定が麻の葉 → 麻の葉', parts(Object.assign({ su_menu_v1: asa }, LOGIN)).M.ball() === 'asanoha');
  t('1c ログインしていない端末は施設の既定（控え）を読まない → 菊かがり', parts({ su_menu_v1: asa }).M.ball() === 'kiku');
  t('1d 端末の選択が先（施設が麻の葉でも端末が菊かがりなら菊かがり）', parts(Object.assign({ su_menu_v1: asa, su_menu_ball: 'kiku' }, LOGIN)).M.ball() === 'kiku');
  t('1e 端末の選択が麻の葉 → 麻の葉（ログインなしでも）', parts({ su_menu_ball: 'asanoha' }).M.ball() === 'asanoha');
  for (const bad of ['ASANOHA', ' asanoha', '"asanoha"', '', 'null', '1', '{"k":1}']) {
    t('1f 壊れた端末の値（' + JSON.stringify(bad) + '）は無視して施設の既定へ', parts(Object.assign({ su_menu_v1: asa, su_menu_ball: bad }, LOGIN)).M.ball() === 'asanoha'
      && parts({ su_menu_ball: bad }).M.ball() === 'kiku');
  }
  t('1g 壊れた控え（JSON でない）→ 菊かがり', parts(Object.assign({ su_menu_v1: '{壊れ' }, LOGIN)).M.ball() === 'kiku');
  t('1h 控えの ball が "kiku"・不正な値 → 菊かがり', parts(Object.assign({ su_menu_v1: cacheOf({ ver: 1, ball: 'kiku' }) }, LOGIN)).M.ball() === 'kiku'
    && parts(Object.assign({ su_menu_v1: cacheOf({ ver: 1, ball: 3 }) }, LOGIN)).M.ball() === 'kiku');
  t('1i 純関数 chooseBall', (function () { const M = parts({}).M;
    return M.chooseBall('asanoha', null) === 'asanoha' && M.chooseBall(null, { ball: 'asanoha' }) === 'asanoha' && M.chooseBall('x', { ball: 'x' }) === 'kiku' && M.chooseBall(undefined, undefined) === 'kiku'; })());

  const p = parts({});
  t('1j 知らない柄は書かない（false）', p.M.setBall('x') === false && p.M.setBall('') === false && p.M.setBall(null) === false && p.ls.writes.length === 0, p.ls.writes);
  t('1k 施設の既定（菊かがり）と違う麻の葉を選ぶ → su_menu_ball に asanoha を書く', p.M.setBall('asanoha') === true && p.ls._d.su_menu_ball === 'asanoha' && p.M.ball() === 'asanoha');
  t('1l 施設の既定が分からない（ログインの控え無し）時に菊かがりを選ぶ → 鍵を消さずに kiku を書く（最後に選んだ柄を残す）', p.M.setBall('kiku') === true && p.ls._d.su_menu_ball === 'kiku' && p.M.ball() === 'kiku', p.ls._d);
  t('1l2 施設の既定（菊かがり）が分かっている時に菊かがりを選ぶ → 鍵を消して施設の既定に従う', (function () { const r = parts(Object.assign({ su_menu_v1: cacheOf({ ver: 1 }), su_menu_ball: 'asanoha' }, LOGIN));
    return r.M.setBall('kiku') === true && !('su_menu_ball' in r.ls._d) && r.M.ball() === 'kiku'; })());
  t('1m 書いた鍵は su_menu_ball だけ・値は kiku/asanoha だけ', p.ls.writes.every(w => w[0] === 'su_menu_ball' && (w[1] === null || w[1] === 'kiku' || w[1] === 'asanoha')), p.ls.writes);
  const q = parts(Object.assign({ su_menu_v1: asa }, LOGIN));
  t('1n 施設の既定が麻の葉の時: 菊かがりを選ぶと kiku を書く・麻の葉に戻すと鍵を消す',
    q.M.setBall('kiku') && q.ls._d.su_menu_ball === 'kiku' && q.M.ball() === 'kiku' && q.M.setBall('asanoha') && !('su_menu_ball' in q.ls._d) && q.M.ball() === 'asanoha');
  const z = parts({}, true);
  let threw = null;
  try { t('1o 保存領域が使えない端末: 読めば null・書けば false・柄は菊かがり（例外を出さない）', z.M.getBall() === null && z.M.setBall('asanoha') === false && z.M.ball() === 'kiku'); }
  catch (e) { threw = e.message; t('1o 保存領域が使えない端末でも例外を出さない', false, threw); }
}

console.log('\n— 2. 分野と数（su-itomari.js）—');
const BIZ = [];
{
  const home = {};
  DEF.sections.forEach(s => s.tiles.forEach(x => { if (!(x.href in home)) { home[x.href] = s.id; if (s.id !== 'sec-setup' && s.id !== 'sec-help') BIZ.push(x.href); } }));
}
{
  const { B } = parts({});
  t('2a 定義の業務ツールは23本', BIZ.length === 23, BIZ.length);
  const tl = B.tally(BIZ, BIZ);
  t('2b 分野ごとの本数は 記録5・くすり/もの3・入居者5・計画5・職員5', JSON.stringify(tl.total) === '[5,3,5,5,5]', tl.total);
  t('2c 全部出ている → 23本中23本', tl.n === 23 && tl.N === 23 && JSON.stringify(tl.have) === '[5,3,5,5,5]', tl);
  const fam = h => B.familyOf(h);
  t('2d 分野の対応（例）', fam('https://th-su.github.io/care-log/') === 0 && fam('https://th-su.github.io/care-log/#/record/daycare') === 0 && fam('supplies.html') === 1
    && fam('resident-master.html?view=bday') === 2 && fam('care-meeting.html') === 3 && fam('staff-master.html') === 4 && fam('https://kitchen-app-9o7.pages.dev/') === 1);
  t('2e 表に無いリンク先・文字でない値は「入居者」', fam('new-tool.html') === 2 && fam(undefined) === 2 && fam(42) === 2 && fam('__proto__') === 2 && fam('constructor') === 2);
  const over = B.tally(BIZ.concat(['shift-app.html', 'shift-app.html']), BIZ);
  t('2f 出ている数が全体を超えても全体で止める（min(n, N)）', over.n === 23 && over.have[4] === 5, over);
  t('2g 0本・壊れた入力でも数を返す', JSON.stringify(B.tally([], [])) === JSON.stringify({ n: 0, N: 0, have: [0, 0, 0, 0, 0], total: [0, 0, 0, 0, 0] })
    && B.tally(null, 'x').N === 0);
  t('2h 麻の葉の花: 32本までは1本＝1輪', B.flowerCount(0, 22) === 0 && B.flowerCount(3, 22) === 3 && B.flowerCount(22, 22) === 22 && B.flowerCount(32, 32) === 32);
  t('2i 麻の葉の花: 32本を超えたら割合（1本でもあれば1輪・全部でなければ31輪まで・全部で32輪）',
    B.flowerCount(1, 64) === 1 && B.flowerCount(32, 64) === 16 && B.flowerCount(63, 64) === 31 && B.flowerCount(64, 64) === 32 && B.flowerCount(1, 1000) === 1);
  t('2j 麻の葉の花: 出ている数＞全体・0本', B.flowerCount(30, 22) === 22 && B.flowerCount(0, 0) === 0 && B.flowerCount(5, 0) === 0);
  t('2k 読み上げの名前', B.label('kiku', 22, 22) === '毬の柄：菊かがり。22本中22本。押すと麻の葉に切り替わります'
    && B.label('asanoha', 17, 22) === '毬の柄：麻の葉。22本中17本。押すと菊かがりに切り替わります' && B.label('x', 0, 0) === L('菊かがり', 0, 0));
}

console.log('\n— 3. 描いた SVG —');
{
  const { B, box } = parts({});
  const ALLOWED_TAGS = new Set(['svg', 'defs', 'radialGradient', 'stop', 'clipPath', 'circle', 'g', 'path']);
  const ALLOWED_ATTRS = new Set(['viewBox', 'aria-hidden', 'focusable', 'width', 'height', 'id', 'cx', 'cy', 'r', 'offset', 'stop-color', 'stop-opacity', 'clip-path',
    'fill', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'd']);
  const VALUE_RE = /^[\w\s.,#()\-:% MLZ]*$/;
  function serial(e) { return '<' + e.tagName + Object.keys(e.attrs).map(k => ' ' + k + '="' + e.attrs[k] + '"').join('') + '>' + e.children.map(serial).join('') + '</' + e.tagName + '>'; }
  function check(e, bad) {
    if (!ALLOWED_TAGS.has(e.tagName) || e.ns !== 'http://www.w3.org/2000/svg') bad.push('tag:' + e.tagName);
    for (const k of Object.keys(e.attrs)) { if (!ALLOWED_ATTRS.has(k)) bad.push('attr:' + k); if (!VALUE_RE.test(e.attrs[k])) bad.push('val:' + k + '=' + e.attrs[k]); }
    if (e._text) bad.push('text');
    e.children.forEach(c => check(c, bad));
  }
  const EVIL = ['<script>alert(1)</script>', 'javascript:alert(1)', '" onload="x', 'url(https://example.invalid/x)', '{{施設}}'];
  const FAKE = n => Array.from({ length: n }, (_, i) => 'tool-' + i + '.html');
  let errs = [], nulls = 0, bad = [], count = 0, styleHit = 0, evilHit = 0;
  for (const kind of ['kiku', 'asanoha']) for (const small of [false, true]) for (const N of [0, 22, 33, 64]) {
    const all = N === 22 ? BIZ : FAKE(N).map((h, i) => (i < EVIL.length ? EVIL[i] : h));
    for (let n = 0; n <= 64; n++) {
      count++;
      let s = null;
      try { s = B.render({ kind, small, shown: all.slice(0, Math.min(n, all.length)).concat(n > all.length ? EVIL : []), all, px: 56 }); } catch (e) { errs.push(kind + small + N + ':' + n + ' ' + e.message); continue; }
      if (!s) { nulls++; continue; }
      check(s, bad);
      const txt = serial(s);
      if (/style/i.test(txt)) styleHit++;
      const vals = []; (function w(e) { Object.keys(e.attrs).forEach(k => vals.push(e.attrs[k])); e.children.forEach(w); })(s);
      if (/script|javascript|onload|example|施設|tool-|\.html|[<>"']/.test(vals.join('\n'))) evilHit++;
    }
  }
  t('3a 0〜64本・両方の柄・大小・全体0/22/33/64本の全段階（' + count + '通り）で例外を出さない', errs.length === 0, errs.slice(0, 3));
  t('3b 全段階で SVG を返す（null にならない）', nulls === 0, nulls);
  t('3c 出力に style の文字が無い（style の属性も <style> も無い）', styleHit === 0, styleHit);
  t('3d 使う要素と属性は表示のものだけ（script・foreignObject・イベントの属性が無い）・値は数と色と座標だけ', bad.length === 0, bad.slice(0, 5));
  t('3e リンク先などの外の文字（危ない文字を混ぜた架空のリンク先）が SVG に入らない', evilHit === 0, evilHit);
  const a1 = serial(B.render({ kind: 'asanoha', shown: BIZ.slice(0, 15), all: BIZ })).replace(/su-itomari-\d+/g, 'ID');
  const a2 = serial(B.render({ kind: 'asanoha', shown: BIZ.slice(0, 15), all: BIZ })).replace(/su-itomari-\d+/g, 'ID');
  t('3f 同じ数なら毎回同じ絵（乱数を使わない）', a1 === a2);
  const i1 = B.render({ kind: 'kiku', shown: BIZ, all: BIZ }), i2 = B.render({ kind: 'kiku', shown: BIZ, all: BIZ });
  const ids = e => { const o = []; const w = n => { if (n.attrs && n.attrs.id) o.push(n.attrs.id); (n.children || []).forEach(w); }; w(e); return o; };
  t('3g 図ごとに模様の名前（id）が違う（設定の画面に2つ並べても混ざらない）', ids(i1).length > 0 && ids(i1).every(x => ids(i2).indexOf(x) < 0), [ids(i1), ids(i2)]);
  const gold = s => serial(s).indexOf('#D4AF5F') >= 0;
  const rim = s => s.children[s.children.length - 1].attrs.stroke;
  t('3h 菊かがり: 全部そろうと金の縁・そろわないと金の縁にしない', rim(B.render({ kind: 'kiku', shown: BIZ, all: BIZ })) === '#D4AF5F' && rim(B.render({ kind: 'kiku', shown: BIZ.slice(0, 21), all: BIZ })) !== '#D4AF5F');
  t('3i 麻の葉: 全部そろうと金の縁・0本は金を使わない', rim(B.render({ kind: 'asanoha', shown: BIZ, all: BIZ })) === '#D4AF5F' && !gold(B.render({ kind: 'asanoha', shown: [], all: BIZ })));
  const dashed = s => (serial(s).match(/stroke-dasharray/g) || []).length;
  t('3j 菊かがり: 0本の分野は点線（0本＝10枚・全部そろうと0枚）', dashed(B.render({ kind: 'kiku', shown: [], all: BIZ })) === 10 && dashed(B.render({ kind: 'kiku', shown: BIZ, all: BIZ })) === 0);
  t('3k px を渡すと幅と高さ・渡さないと viewBox だけ', (function () { const s = B.render({ shown: [], all: [], px: 56 }), u = B.render({ shown: [], all: [] });
    return s.attrs.width === '56' && s.attrs.height === '56' && !('width' in u.attrs) && u.attrs.viewBox === '0 0 100 100'; })());
  const brokenDoc = box.document.createElementNS;
  box.document.createElementNS = () => { throw new Error('壊れた DOM'); };
  let r = 'x', thrown = null;
  try { r = B.render({ kind: 'kiku', shown: BIZ, all: BIZ }); } catch (e) { thrown = e.message; }
  box.document.createElementNS = brokenDoc;
  t('3l 描けない時は null を返し、例外を外に出さない', r === null && thrown === null, [r, thrown]);
  let perf = 0;
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) B.render({ kind: i % 2 ? 'asanoha' : 'kiku', small: true, shown: BIZ, all: BIZ });
  perf = (Date.now() - t0) / 20;
  t('3m 見出しの毬を1つ描く時間（この試験の小さな DOM で・目安 20ms 以内）: ' + perf.toFixed(1) + 'ms', perf < 20, perf);
}

console.log('\n— 4. メニューの数え方と切り替え（index.html）—');
// 採用管理は管理者専用（adminOnly・2026-10-29 本人承認）。管理者以外・ログインしていない時は出ないので、出ている数は1本少ない
{
  const p = page({});
  t('4a 事務所の端末・設定なし: 毬のボタンを見出しの先頭に出し、23本中22本', !p.err && !!p.btn() && p.hdr.children[0] === p.btn() && p.label() === L('菊かがり', 22, 23), [p.err, p.label()]);
  t('4b ボタンは type=button・見出しに has-ball の印・中は SVG だけ', p.btn().type === 'button' && p.hdr.classList.contains('has-ball') && p.btn().children.length === 1 && p.btn().children[0].tagName === 'svg');
  t('4c タイルは今までどおり全部出る・帯も知らせも無い', p.tiles().length === 24 && p.reports.length === 0 && p.notes.length === 0, [p.tiles().length, p.reports, p.notes]);
  p.btn().click();
  t('4d 押すと麻の葉に切り替わり、読み上げの名前も変わる・端末に asanoha を書く', p.label() === L('麻の葉', 22, 23) && p.ls._d.su_menu_ball === 'asanoha', [p.label(), p.ls._d]);
  p.btn().click();
  t('4e もう一度押すと菊かがりに戻る（ログインの控えが無く施設の既定が分からないので kiku を残す）', p.label() === L('菊かがり', 22, 23) && p.ls._d.su_menu_ball === 'kiku', [p.label(), p.ls._d]);
  t('4f 書いたのは su_menu_ball だけ', p.ls.writes.every(w => w[0] === 'su_menu_ball'), p.ls.writes);
  t('4g 同じボタンを使い続ける（押した後もボタンは1つ・手元が外れない）', p.hdr.querySelectorAll('button.ball').length === 1);
}
{
  const p = page({ field: true });
  t('4h 現場端末: 事務所専用の5本を数えない → 23本中17本', p.label() === L('菊かがり', 17, 23), p.label());
  p.html.classList.remove('is-field');
  p.fire('pageshow', { persisted: false });
  t('4i 普通の表示（persisted=false）では数え直さない', p.label() === L('菊かがり', 17, 23), p.label());
  p.fire('pageshow', { persisted: true });
  t('4j 「戻る」で開き直した時（persisted=true）は数え直す（現場→事務所で22本）', p.label() === L('菊かがり', 22, 23), p.label());
}
{
  const store = Object.assign({ su_menu_v1: cacheOf({ ver: 1, hide: { office: ['weight-record.html', 'supplies.html', 'connection-settings.html'] } }, 'office') }, LOGIN);
  const p = page({ store });
  t('4k 役割で隠したボタンは数えない（業務2本＋設定1本を隠す → 23本中20本・分母は23のまま）', p.label() === L('菊かがり', 20, 23), p.label());
  // 本物の流れと同じく、控えを書いてから組み立て直しを呼ぶ（su-menu.js の startSync は writeCache の後に onChange）
  const cfg2 = { ver: 1, hide: { office: ['weight-record.html'] }, ball: 'asanoha' };
  p.ls._d.su_menu_v1 = cacheOf(cfg2, 'office');
  p.resync(cfg2, 'office');
  t('4l 設定を読み直した後に数え直し、施設の既定の柄（麻の葉）も効く（23本中21本）', p.label() === L('麻の葉', 21, 23), p.label());
}
{
  const cfg = { ver: 1, mv: { 'weight-record.html': 'sec-setup', 'connection-settings.html': 'sec-staff', 'shift-app.html': 'sec-kitchen' } };
  const store = Object.assign({ su_menu_v1: cacheOf(cfg, 'office') }, LOGIN);
  const p = page({ store });
  t('4m 区分を移したボタン: 業務かどうかは既定の区分で決める（設定の区分へ移しても数える・接続設定を移しても数えない）→ 23本中22本', p.label() === L('菊かがり', 22, 23), p.label());
  const f = page({ store, field: true });
  t('4n 現場端末では、事務所専用の区分（設定）へ移したボタンは隠れるので数えない → 23本中16本', f.label() === L('菊かがり', 16, 23), f.label());
}
{
  const d = JSON.parse(DEF_TEXT);
  d.sections[0].tiles = d.sections[0].tiles.concat(Array.from({ length: 18 }, (_, i) => ({ href: 'fake-tool-' + i + '.html', ic: '🧪', nm: '架空' + i, note: '' })));
  const p = page({ def: JSON.stringify(d), store: { su_menu_ball: 'asanoha' } });
  t('4o 業務ツールが32本を超えても数える（41本中40本・麻の葉）', p.label() === L('麻の葉', 40, 41) && !!p.btn().children[0], p.label());
}
{
  const d = JSON.parse(DEF_TEXT);
  d.sections = d.sections.filter(s => s.id === 'sec-setup' || s.id === 'sec-help');
  const p = page({ def: JSON.stringify(d) });
  t('4p 業務ツールが0本: 0本中0本で止まらない', !p.err && p.label() === L('菊かがり', 0, 0) && p.tiles().length === 2, [p.err, p.label()]);
}
{
  const d = JSON.parse(DEF_TEXT);
  d.sections[3].tiles.push({ href: 'shift-app.html', ic: '🗓️', nm: '二つ目', note: '' });
  const p = page({ def: JSON.stringify(d) });
  t('4q 同じリンク先が2枚あっても、出ている数は全体で止める（23本中22本）', p.label() === L('菊かがり', 22, 23) && p.tiles().length === 25, [p.label(), p.tiles().length]);
}
{
  const d = JSON.parse(DEF_TEXT);
  d.sections[3].tiles.push({ href: 'shift-app.html', ic: '🗓️', nm: '二つ目', note: '' });
  const p = page({ def: JSON.stringify(d), field: true });
  const base = page({ field: true });
  t('4t 現場端末で同じリンク先のボタンが2枚あっても1本と数える（重ねない時と同じ数・全体に届かない）', p.label() === base.label() && p.label() !== L('菊かがり', 23, 23), [p.label(), base.label()]);
}
{
  const p = page({ throws: true });
  t('4r 保存領域が使えない端末でも毬は出て、押すとこの画面では切り替わる', !p.err && p.label() === L('菊かがり', 22, 23) && (p.btn().click(), p.label() === L('麻の葉', 22, 23)), [p.err, p.label()]);
}
{
  const p = page({ store: Object.assign({ su_menu_v1: cacheOf({ ver: 1, ball: 'asanoha' }) }, LOGIN) });
  t('4s 施設の既定が麻の葉（ログインして読めた控え）→ 麻の葉で出る', p.label() === L('麻の葉', 22, 23), p.label());
}

{
  const p = page({ store: Object.assign({ su_menu_v1: JSON.stringify({ role: 'admin', config: null, at: '2026-10-29T00:00:00Z' }) }, LOGIN) });
  t('4u 管理者（設定なしの控え）: 採用管理も出る → 23本中23本・タイル25枚', p.label() === L('菊かがり', 23, 23) && p.tiles().length === 25, [p.label(), p.tiles().length]);
}
{
  const p = page({ store: Object.assign({}, LOGIN) });
  t('4v ログインの記録はあるが役割が分からない間: 事務所専用を出さない → 23本中17本', p.label() === L('菊かがり', 17, 23), p.label());
}
console.log('\n— 5. 毬の部品が無い・描けない時 —');
{
  const p = page({ itomari: false });
  t('5a 部品が無い: ボタンを出さず、見出しは今のまま（h1・説明の2つだけ・has-ball なし）', !p.err && !p.btn() && p.hdr.children.length === 2 && !p.hdr.classList.contains('has-ball'), [p.err, p.hdr.children.length]);
  t('5b 部品が無い: タイルは全部出る・帯も知らせも無い', p.tiles().length === 24 && p.reports.length === 0 && !p.main.querySelector('p.menu-broken'), [p.tiles().length, p.reports]);
  p.fire('pageshow', { persisted: true });
  t('5c 部品が無い: 「戻る」で開き直しても止まらない', !p.btn());
}
{
  const p = page({ render: () => null });
  t('5d 描けない（null）時: ボタンを出さず、メニューは全部出る', !p.err && !p.btn() && p.tiles().length === 24 && !p.hdr.classList.contains('has-ball'), [p.err]);
}
{
  const p = page({ render: () => { throw new Error('描けない'); } });
  t('5e 部品が例外を出しても: メニューは全部出て、記録（note）に残す', !p.err && p.tiles().length === 24 && p.reports.length === 0 && p.notes.length === 1, [p.err, p.notes]);
}
{
  const at = HTML.indexOf('<script src="su-itomari.js');
  t('5f 部品は head で su-menu.js の直後に読む', at > HTML.indexOf('<script src="su-menu.js') && at < HTML.indexOf('</head>')
    && HTML.slice(HTML.indexOf('<script src="su-menu.js'), at).split('<script').length === 2, at);
  t('5g 毬の処理は組み立ての script の中（定義と組み立ての間に別の script を足していない）', /function drawBall\(\)/.test(BUILD) && HTML.slice(defEnd + 9, sStart - 8).trim() === '', '');
  t('5h 印刷では毬を出さない・見出しの並びを変えるのは画面だけ', /@media print \{ \.hdr \.ball \{ display: none !important; \} \}/.test(HTML)
    && /@media screen \{\s*\.hdr\.has-ball \{ display: grid;/.test(HTML) && !/^\.hdr\.has-ball/m.test(HTML), '');
  t('5i 生成りの見出しの上で見えるフォーカスの枠（藍・2026-10-29）・押せる大きさ 56px', /\.hdr \.ball:focus-visible \{ outline: 3px solid #1F2A44;/.test(HTML) && /\.hdr \.ball \{\s*display: block; width: 56px; height: 56px;/.test(HTML), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
