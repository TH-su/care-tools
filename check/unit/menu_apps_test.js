/* メニューのボタンを施設で使うアプリで絞る（su-menu.js の SUMenu.view の4つ目・index.html の組み立て・2026-11-02）の試験
   実行: node check/unit/menu_apps_test.js
   守ること:
     1 施設情報の apps を書いていない（null）・読めない・形が違う時は、今までと同じ（同じものを返す・組み立て直さない・並びも数も同じ）
     2 apps に無いアプリのボタンだけを出さない。切り方は接続設定と同じ表（SUMenu.appOf）。表に無いボタンと使い方・困った時は出す
     3 役割の決まり（管理者専用・現場の事務所専用）は今のまま効く。メニューの設定（並び・移し先）で絞ったボタンを出し直せない
     4 施設情報は後から届く。届いて値が変わった時だけ1回組み直す。ボタンが全部消えた区分は見出しも出さない
     5 毬は出ているボタンを数える（絞った後の数・分母は定義の数のまま）
     6 su-menu.js の版は、読む画面（メニュー・メニューの設定・アプリの使える人）で同じ
   画面のコードは書き換えず、su-menu.js と index.html の組み立ての script をそのまま読み込んで動かす。値は架空。 */
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

const defEnd = HTML.indexOf('</script>', HTML.indexOf('id="menuDef"'));
const sStart = HTML.indexOf('<script>', defEnd) + '<script>'.length;
const BUILD = HTML.slice(sStart, HTML.indexOf('</script>', sStart));
const DEF_TEXT = HTML.slice(HTML.indexOf('>', HTML.indexOf('id="menuDef"')) + 1, defEnd);
const DEF = JSON.parse(DEF_TEXT);
const ALL = [].concat(...DEF.sections.map(s => s.tiles.map(x => x.href)));

/* 接続設定と同じ切り方の表（この試験の期待値） */
const WANT = {
  ws: ['shift-app.html', 'work-schedule.html', 'care-schedule.html', 'visit-overview.html', 'daycare-roster.html'],
  master: ['resident-master.html', 'resident-master.html?view=bday', 'facesheet.html'],
  adm: ['admission-flow.html'], tp: ['training-plan.html'],
  haiben: ['https://th-su.github.io/haiben-record/haiben-record.html'],
  weight: ['weight-record.html'], msk: ['moushiokuri-viewer.html'], geno: ['genogram.html'], analyzer: ['shift-analyzer.html']
};
const MAPPED = [].concat(...Object.values(WANT));
const UNMAPPED = ALL.filter(h => MAPPED.indexOf(h) < 0);

/* ── 小さな DOM（menu_ball_test.js と同じ形）── */
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
function memStore(init) {
  return {
    _d: Object.assign({}, init || {}),
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    key(i) { return Object.keys(this._d)[i]; },
    get length() { return Object.keys(this._d).length; }
  };
}
const LOGIN = { 'sb-abc-auth-token': 'x' };
const cacheOf = (config, role) => JSON.stringify({ role: role || 'office', config: config, at: '2026-11-02T00:00:00Z' });

/* ページを動かす。opt: store・def・fac（SUFacility の差し替え。無ければ置かない） */
function page(opt) {
  opt = opt || {};
  const html = makeEl('html');
  const hdr = makeEl('header'); hdr.className = 'hdr';
  const main = makeEl('main'); main.id = 'menu';
  html.appendChild(hdr); html.appendChild(main);
  const ls = memStore(opt.store);
  const reports = [], docL = {};
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
      addEventListener(ev, fn) { (docL[ev] = docL[ev] || []).push(fn); }
    },
    addEventListener() {},
    SUErrors: { report: (a, e) => reports.push([a, e && e.message]), note() {} }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(MENU_SRC, box);
  let resync = null;
  box.SUMenu.startSync = fn => { resync = fn; };
  vm.runInContext(BALL_SRC, box);
  let err = null;
  try { vm.runInContext(BUILD, box); } catch (e) { err = e.message; }
  // 施設情報は組み立ての後ろで読む（本物の並びと同じ）
  if (opt.fac) box.SUFacility = opt.fac;
  const sec0 = () => main.children[0];
  return {
    box, main, hdr, reports, err, sec0,
    tiles: () => main.querySelectorAll('a.tile').map(a => a.getAttribute('href')),
    heads: () => main.querySelectorAll('section').map(s => s.getAttribute('aria-labelledby')),
    label: () => { const b = hdr.querySelector('button.ball'); return b ? b.getAttribute('aria-label') : null; },
    ready: () => (docL.DOMContentLoaded || []).forEach(fn => fn()),
    resync: (cfg, role) => resync && resync(cfg, role)
  };
}
/* 施設情報の差し替え。onReady は呼ばれた関数を控え、試験から later() で呼ぶ（読み終わりが後から来る形） */
function fac(appsFn) {
  const waiters = [];
  return { ready: () => true, officeName: k => k, support: () => ({}), apps: appsFn,
    onReady: fn => waiters.push(fn), later: () => waiters.splice(0).forEach(fn => fn()), waiters };
}

const M0 = page().box.SUMenu;
// 部品に口が無い版（直す前）でも止まらずに「失敗」と数える
const M = { view: M0.view, appsView: (v, a) => (typeof M0.appsView === 'function' ? M0.appsView(v, a) : NaN), appOf: h => (typeof M0.appOf === 'function' ? M0.appOf(h) : NaN) };
const hrefsOf = v => [].concat(...v.sections.map(s => (s.tiles || []).map(x => x.href)));

console.log('1 書いていない・読めない・形が違う → 今までと同じ');
['admin', 'office', 'field', 'pending', null].forEach(role => {
  const base = M.view(DEF, null, role), B = JSON.stringify(base);
  t('1a 役割 ' + role + ': apps が null → 同じ形（絞りの層は渡した形をそのまま返す）', JSON.stringify(M.view(DEF, null, role, null)) === B && M.appsView(base, null) === base);
  const bad = [undefined, 'ws', { 0: 'ws', length: 1 }, [1], ['ws', null], 0, true];
  t('1b 役割 ' + role + ': 配列でない・文字でない要素がある → 同じ形', bad.every(a => JSON.stringify(M.view(DEF, null, role, a)) === B && M.appsView(base, a) === base), bad.map(a => JSON.stringify(M.view(DEF, null, role, a)) === B));
});
{
  const before = JSON.stringify(DEF);
  M.view(DEF, null, 'admin', ['ws']); M.view(DEF, { ver: 1, mv: { 'genogram.html': 'sec-staff' } }, 'field', []);
  t('1c 元の定義を書き換えない', JSON.stringify(DEF) === before);
}

console.log('2 接続設定と同じ切り方の表');
t('2a 表の id は接続設定の id（ws・master・adm・tp・haiben・weight・msk・geno・analyzer）', MAPPED.every(h => M.appOf(h) === Object.keys(WANT).find(k => WANT[k].indexOf(h) >= 0)), MAPPED.map(h => [h, M.appOf(h)]));
t('2b 表に載るボタンはメニューの定義にある', MAPPED.every(h => ALL.indexOf(h) >= 0), MAPPED.filter(h => ALL.indexOf(h) < 0));
t('2c 表に無いボタン（職員マスタ・採用管理・消耗品・ケアログ・厨房・貼り薬・担当者会議・接続設定・使い方）は id を持たない', UNMAPPED.every(h => M.appOf(h) === null) && ['staff-master.html', 'ats.html', 'supplies.html', 'patch-calendar.html', 'care-meeting.html', 'connection-settings.html', 'help.html'].every(h => UNMAPPED.indexOf(h) >= 0), UNMAPPED);
t('2d 文字でない・知らないリンク先 → null', M.appOf(null) === null && M.appOf(3) === null && M.appOf('toString') === null && M.appOf('constructor') === null);
t('2e 隠せないボタン（使い方・困った時）は表に載せない（どのアプリを選んでも消えない）', Object.keys(M0.KEEP).length > 0 && Object.keys(M0.KEEP).every(k => M.appOf(k) === null), Object.keys(M0.KEEP));

console.log('3 絞る');
Object.keys(WANT).forEach(id => {
  const got = hrefsOf(M.view(DEF, null, 'admin', [id]));
  const want = ALL.filter(h => UNMAPPED.indexOf(h) >= 0 || WANT[id].indexOf(h) >= 0);
  t('3a [' + id + '] → ' + id + ' のボタンと表に無いボタンだけ（並びは定義のまま）', JSON.stringify(got) === JSON.stringify(want), { got, want });
});
{
  const got = hrefsOf(M.view(DEF, null, 'admin', []));
  t('3b 空の配列 → 表に無いボタンだけ・使い方・困った時は出る', JSON.stringify(got) === JSON.stringify(UNMAPPED) && got.indexOf('help.html') >= 0, got);
  const all = hrefsOf(M.view(DEF, null, 'admin', Object.keys(WANT)));
  t('3c 全部の id → 全部出る（絞りの層は渡した形をそのまま返す）', JSON.stringify(all) === JSON.stringify(ALL) && M.appsView(DEF, Object.keys(WANT)) === DEF);
  const extra = hrefsOf(M.view(DEF, null, 'admin', ['ws', 'report', 'zz']));
  t('3d 表に無い id が混ざっても害は無い', JSON.stringify(extra) === JSON.stringify(hrefsOf(M.view(DEF, null, 'admin', ['ws']))));
}

console.log('4 役割の決まりが先に効く・設定で出し直せない');
{
  const office = hrefsOf(M.view(DEF, null, 'office', ['ws', 'master']));
  t('4a 事務所: 採用管理（管理者専用）は施設のアプリと関係なく出ない', office.indexOf('ats.html') < 0 && office.indexOf('staff-master.html') >= 0, office);
  const field = hrefsOf(M.view(DEF, null, 'field', ['ws', 'master', 'adm']));
  t('4b 現場: 事務所専用（誕生日・入居調整・職員マスタ・担当者会議）は使うアプリでも出ない', ['resident-master.html?view=bday', 'admission-flow.html', 'staff-master.html', 'care-meeting.html'].every(h => field.indexOf(h) < 0) && field.indexOf('resident-master.html') >= 0, field);
  const cfg = { ver: 1, mv: { 'weight-record.html': 'sec-staff', 'genogram.html': 'sec-help' }, order: { 'sec-staff': ['weight-record.html'], 'sec-help': ['genogram.html', 'help.html'] }, hide: { admin: [] } };
  const v = hrefsOf(M.view(DEF, cfg, 'admin', ['ws']));
  const v0 = hrefsOf(M.view(DEF, cfg, 'admin'));
  t('4c 設定で別の区分へ移し、並びの先頭に置いたボタンも、使わないアプリなら出ない', v0.indexOf('weight-record.html') >= 0 && v.indexOf('weight-record.html') < 0 && v.indexOf('genogram.html') < 0 && v.indexOf('help.html') >= 0, v);
}

console.log('5 メニューの画面（index.html）');
{
  const p0 = page();
  const base = p0.tiles(), baseLabel = p0.label(), baseHeads = p0.heads();
  t('5a 施設情報の部品が無い → 今までと同じ（組み立て直さない）', (() => { const s = p0.sec0(); p0.ready(); return s === p0.sec0() && JSON.stringify(p0.tiles()) === JSON.stringify(base); })() && !p0.err && base.length > 0, [p0.err, base.length]);

  const fn = fac(() => null), pn = page({ fac: fn });
  const s1 = pn.sec0(); pn.ready(); fn.later();
  t('5b apps が null → 同じ並び・同じ数・同じ毬・組み立て直さない', s1 === pn.sec0() && JSON.stringify(pn.tiles()) === JSON.stringify(base) && pn.label() === baseLabel && JSON.stringify(pn.heads()) === JSON.stringify(baseHeads), [pn.tiles().length, base.length, pn.label(), baseLabel]);

  const ft = fac(() => { throw new Error('架空の故障'); }), pt = page({ fac: ft });
  const s2 = pt.sec0(); pt.ready(); ft.later();
  t('5c apps が例外を出す → 今までと同じ・組み立て直さない・報告も出さない', s2 === pt.sec0() && JSON.stringify(pt.tiles()) === JSON.stringify(base) && pt.reports.length === 0, pt.reports);

  const fg = fac(() => 'ws'), pg = page({ fac: fg });
  const s3 = pg.sec0(); pg.ready(); fg.later();
  t('5d apps が配列でない → 今までと同じ・組み立て直さない', s3 === pg.sec0() && JSON.stringify(pg.tiles()) === JSON.stringify(base));

  const fw = fac(() => ['ws']), pw = page({ fac: fw });
  pw.ready();
  const s4 = pw.sec0();
  const want = base.filter(h => MAPPED.indexOf(h) < 0 || WANT.ws.indexOf(h) >= 0);
  t('5e apps が [ws] → 届いた時に組み直し、使わないアプリのボタンだけ消える', JSON.stringify(pw.tiles()) === JSON.stringify(want) && pw.tiles().length < base.length && pw.tiles().indexOf('help.html') >= 0, pw.tiles());
  fw.later();
  t('5f 読み終わりの知らせで同じ値なら組み直さない（1回だけ）', s4 === pw.sec0());
  const m = /(\d+)本中(\d+)本/.exec(pw.label() || ''), m0 = /(\d+)本中(\d+)本/.exec(baseLabel || '');
  const bizGone = base.filter(h => MAPPED.indexOf(h) >= 0 && WANT.ws.indexOf(h) < 0).length;
  t('5g 毬は出ているボタンを数える（分母は定義のまま・分子は消えた分だけ減る）', !!m && !!m0 && m[1] === m0[1] && Number(m[2]) === Number(m0[2]) - bizGone, [pw.label(), baseLabel, bizGone]);
  t('5h 消えた後も 区分の見出しは中身のある区分だけ', pw.main.querySelectorAll('section').every(s => s.querySelectorAll('a.tile').length > 0));

  // 控えが無い時（施設情報をまだ読めない）は、読み終わりの知らせで初めて値が来る
  let v = null;
  const fl = fac(() => v), pl = page({ fac: fl });
  pl.ready();
  const s5 = pl.sec0();
  v = ['master'];
  fl.later();
  t('5i 後から届いた apps でも組み直す', s5 !== pl.sec0() && pl.tiles().indexOf('weight-record.html') < 0 && pl.tiles().indexOf('resident-master.html') >= 0, pl.tiles());
}
{
  // ボタンが全部消えた区分は見出しを出さない（架空の区分）
  const d = JSON.parse(DEF_TEXT);
  d.sections.splice(1, 0, { id: 'sec-mihon', mk: '🧪', title: '見本', tiles: [{ href: 'genogram.html', ic: '🧪', nm: '架空', note: '' }, { href: 'weight-record.html', ic: '🧪', nm: '架空', note: '' }] });
  const f = fac(() => ['ws']), p = page({ fac: f, def: JSON.stringify(d) });
  const before = p.heads().indexOf('sec-mihon') >= 0;
  p.ready();
  t('5j ボタンが全部消えた区分は見出しも出さない', before && p.heads().indexOf('sec-mihon') < 0, p.heads());
}
{
  // 組み直しは今の設定と役割のまま（設定で隠したボタンを出し直さない）
  const cfg = { ver: 1, hide: { office: ['supplies.html'] } };
  const store = Object.assign({ su_menu_v1: cacheOf(cfg, 'office') }, LOGIN);
  const f = fac(() => ['ws']), p = page({ fac: f, store });
  p.ready();
  t('5k 控えの設定で隠したボタンは、施設のアプリで組み直した後も出ない', p.tiles().indexOf('supplies.html') < 0 && p.tiles().indexOf('weight-record.html') < 0 && p.tiles().indexOf('staff-master.html') >= 0, p.tiles());
  const cfg2 = { ver: 1, hide: { office: ['staff-master.html'] } };
  p.box.localStorage._d.su_menu_v1 = cacheOf(cfg2, 'office');
  p.resync(cfg2, 'office');
  t('5l 設定を読み直した後も施設のアプリの絞りは続く', p.tiles().indexOf('weight-record.html') < 0 && p.tiles().indexOf('staff-master.html') < 0 && p.tiles().indexOf('supplies.html') >= 0, p.tiles());
}
{
  // 設定を読み直した後に施設のアプリが届いた時も、読み直した設定で組み直す（古い控えの設定に戻さない）
  const store = Object.assign({ su_menu_v1: cacheOf({ ver: 1, hide: { office: ['supplies.html'] } }, 'office') }, LOGIN);
  let v = null;
  const f = fac(() => v), p = page({ fac: f, store });
  p.ready();
  const cfg2 = { ver: 1, hide: { office: ['staff-master.html'] } };
  p.box.localStorage._d.su_menu_v1 = cacheOf(cfg2, 'office');
  p.resync(cfg2, 'office');
  v = ['ws'];
  f.later();
  t('5m 設定を読み直した後に届いた apps では、読み直した設定のまま組み直す', p.tiles().indexOf('staff-master.html') < 0 && p.tiles().indexOf('supplies.html') >= 0 && p.tiles().indexOf('weight-record.html') < 0, p.tiles());
}

console.log('6 版');
{
  const v = f => { const m = /src="su-menu\.js\?v=([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8')); return m && m[1]; };
  const pre = (/<link[^>]*href="su-menu\.js\?v=([^"]+)"/.exec(HTML) || [])[1];
  t('6a su-menu.js の版はメニュー・メニューの設定・アプリの使える人・先読みで同じ', !!v('index.html') && [v('menu-settings.html'), v('app-access.html'), pre].every(x => x === v('index.html')), [v('index.html'), v('menu-settings.html'), v('app-access.html'), pre]);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
