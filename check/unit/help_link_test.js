/* 見出しの「使い方」の試験（代表者の決定 2026-11-13・文言「使い方」も代表者の決定）
   実行: node check/unit/help_link_test.js
   守ること:
     1. 行き先の表（su-shell.js の HELP_SEC）が、使い方の画面の受け口（help-sec.js の SEC）と同じ値・同じ見出しを持つ
     2. 見出しに直接書いた16画面: 「← メニュー」の右隣に「使い方」が1本だけあり、行き先は表どおり（節のある画面は help.html?sec=<画面>・無い画面は help.html）。
        メニューのリンクと同じ型の名前（su-menu-back を除く）を持ち、印刷では消す。.su-menu-row の中にある画面はその中に置く
     3. su-shell.js を読む6画面: 見出しの「← メニュー」の右隣に置く（表どおりの行き先・型の名前を写す・二重に置かない・枠の中とメニュー・ログイン・使い方の画面では置かない・文字は textContent）
     4. 保存していない入力がある5画面（入居者マスタ・職員マスタ・担当者会議・入居調整・消耗品管理）は、「使い方」を押した時も「← メニュー」と同じ判定で確かめ、
        「いいえ」なら移らない・「はい」なら直後の beforeunload で二重に聞かない印を立てる・変更が無ければ聞かない
     5. メニュー・ログイン・使い方の画面と、別の正本から配る3画面（ワークスケジュール・シフト作成・シフト分析）には置かない
   画面のコードは書き換えず、ソースを読んで切り出して動かすだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readMaster } = require('../master-page.cjs');

const ROOT = path.join(__dirname, '..', '..');
const raw = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const read = (f) => readMaster(path.join(ROOT, f));
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

/* su-shell.js を架空の画面で動かす */
function runShell(opts) {
  const o = opts || {};
  const made = [];
  function el(cls, href) {
    const e = { className: cls, _href: href, attrs: {}, parentNode: null, nextSibling: null, textContent: '', innerHTML: '',
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === 'href' ? this._href : this.attrs[k]; } };
    return e;
  }
  const back = el(o.backCls || 'back su-menu-back', 'index.html');
  const kids = [back];
  const hdr = {
    querySelector(sel) {
      if (sel === '.su-help-link') return kids.find((k) => /\bsu-help-link\b/.test(k.className)) || null;
      if (sel === 'a[href="index.html"]') return o.noBack ? null : back;
      return null;
    },
    insertBefore(n, ref) { const i = ref ? kids.indexOf(ref) : kids.length; kids.splice(i < 0 ? kids.length : i, 0, n); n.parentNode = hdr; made.push(n); }
  };
  back.parentNode = hdr;
  const listeners = {};
  const doc = {
    readyState: 'complete',
    querySelectorAll: (sel) => (sel === '.su-shell-hdr' ? [hdr] : []),
    createElement: () => el('', ''),
    addEventListener: (k, f) => { listeners['d:' + k] = f; }
  };
  const win = { location: { pathname: '/care-tools/' + (o.file || 'accounts.html') }, addEventListener: (k, f) => { listeners['w:' + k] = f; } };
  win.top = o.inFrame ? {} : win; win.self = win;
  const ctx = { window: win, document: doc, setInterval: () => 0, clearInterval: () => 0, Promise };
  vm.createContext(ctx);
  vm.runInContext(raw('su-shell.js'), ctx);
  const help = () => kids.filter((k) => /\bsu-help-link\b/.test(k.className));
  return { ctx, win, kids, back, help, listeners, made };
}

console.log('1 行き先の表');
const shellRun = runShell();
const HELP_SEC = shellRun.win.SUShell && shellRun.win.SUShell.HELP_SEC;
let SEC = null;
{
  const ctx = { window: { location: { search: '' } }, document: { readyState: 'loading', addEventListener() {} } };
  const src = raw('help-sec.js').replace("var SEC = {", "var SEC = window.__SEC = {");
  vm.createContext(ctx); vm.runInContext(src, ctx);
  SEC = ctx.window.__SEC;
  t('help-sec.js の表を読める', !!SEC && Object.keys(SEC).length > 0, SEC);
  t('su-shell.js の表を読める', !!HELP_SEC && Object.keys(HELP_SEC).length > 0, HELP_SEC);
  const want = Object.keys(SEC || {}).sort();
  const got = Object.keys(HELP_SEC || {}).map((f) => HELP_SEC[f]).sort();
  t('表の値が help-sec.js の受ける値と同じ', JSON.stringify(want) === JSON.stringify(got), { want, got });
  t('表の画面は「その値＋.html」', Object.keys(HELP_SEC || {}).every((f) => f === HELP_SEC[f] + '.html'), HELP_SEC);
  const help = raw('help.html');
  t('表の値ごとに help.html に節の見出しがある', want.every((k) => help.indexOf('id="' + SEC[k] + '"') >= 0), want);
  const H = shellRun.win.SUShell.helpHref;
  t('節のある画面は help.html?sec=<画面>', H('care-schedule.html') === 'help.html?sec=care-schedule' && H('weight-record.html') === 'help.html?sec=weight-record');
  t('節の無い画面・壊れた値は help.html', H('facesheet.html') === 'help.html' && H('') === 'help.html' && H('__proto__') === 'help.html' && H('constructor') === 'help.html');
}
const expHref = (f) => (Object.prototype.hasOwnProperty.call(HELP_SEC || {}, f) ? 'help.html?sec=' + HELP_SEC[f] : 'help.html');

console.log('2 見出しに直接書いた16画面');
const DIRECT = ['resident-master.html', 'facesheet.html', 'genogram.html', 'weight-record.html', 'care-meeting.html', 'care-schedule.html',
  'visit-overview.html', 'support-overview.html', 'overview-compare.html', 'daycare-roster.html', 'supplies.html', 'staff-master.html',
  'admission-flow.html', 'training-plan.html', 'patch-calendar.html', 'moushiokuri-viewer.html'];
for (const f of DIRECT) {
  const s = read(f).replace(/<!--[\s\S]*?-->/g, '');
  const helps = [...s.matchAll(/<a class="([^"]*\bsu-help-link\b[^"]*)" href="([^"]*)">([^<]*)<\/a>/g)];
  t(f + ': 「使い方」が1本', helps.length === 1 && (s.match(/su-help-link"/g) || []).length === 1, helps.length);
  if (!helps.length) continue;
  const h = helps[0];
  t(f + ': 文言は「使い方」', h[3] === '使い方', h[3]);
  t(f + ': 行き先は表どおり（' + expHref(f) + '）', h[2] === expHref(f), h[2]);
  const m = /<a class="([^"]*)" href="index\.html">← メニュー<\/a>(\s*)<a class="[^"]*\bsu-help-link\b/.exec(s);
  t(f + ': 「← メニュー」の右隣にある', !!m, '');
  if (m) {
    const want = m[1].split(/\s+/).filter((c) => c && c !== 'su-menu-back').concat('su-help-link').join(' ');
    t(f + ': メニューのリンクと同じ型の名前（su-menu-back は付けない）', h[1] === want, { got: h[1], want });
    const inRow = /<span class="su-menu-row"><a [^>]*>← メニュー<\/a>/.test(s);
    if (inRow) t(f + ': .su-menu-row の中に置く', /<span class="su-menu-row"><a [^>]*>← メニュー<\/a> <a [^>]*su-help-link[^>]*>使い方<\/a><\/span>/.test(s), '');
  }
  t(f + ': 印刷では消す', /@media print\{\.su-help-link\{display:none !important\}\}/.test(s), '');
  /* 「← メニュー」に当てている決まりは、同じ値で「使い方」にも当てる（同じ大きさ・色・899px 以下で44px） */
  const backRules = [...s.matchAll(/\.su-menu-back\{([^{}]*)\}/g)].map((r) => r[1]).filter((b) => b !== 'display:none !important');
  const helpRules = [...s.matchAll(/\.su-help-link\{([^{}]*)\}/g)].map((r) => r[1]).filter((b) => b !== 'display:none !important');
  t(f + ': 「← メニュー」と同じ決まりを当てる', JSON.stringify(backRules) === JSON.stringify(helpRules), { backRules, helpRules });
}
{
  const s = raw('weight-record.html');
  t('体重管理: 「← メニュー」の次の箱に寄せる決まりを「使い方」の次の箱へ写す', /\.su-help-link \+ div\{margin-right:auto\}/.test(s));
}
{
  const oc = raw('overview-compare.html');
  t('左右比較: 枠の中では .su-menu-row ごと隠す（「使い方」も入っている）', /querySelectorAll\('\.su-menu-row, \.su-menu-back'\)/.test(oc));
  for (const f of ['visit-overview.html', 'support-overview.html']) t(f + ': 「使い方」は .su-menu-row の中', /<span class="su-menu-row">[^\n]*su-help-link[^\n]*<\/span>/.test(raw(f)));
}

console.log('3 su-shell.js を読む6画面');
const SHELL = ['accounts.html', 'app-access.html', 'menu-settings.html', 'shadow-check.html', 'ats.html', 'equip-log.html'];
for (const f of SHELL) {
  const s = raw(f);
  const hdr = (s.match(/<header class="hdr su-shell-hdr">([\s\S]*?)<\/header>/) || [])[1] || '';
  const m = /<a class="([^"]*)" href="index\.html"[^>]*>[^<]*メニュー<\/a>/.exec(hdr);
  t(f + ': 見出しにメニューへのリンクがある', !!m, '');
  t(f + ': 見出しに「使い方」を直接書いていない（部品が置く）', hdr.indexOf('su-help-link') < 0);
  if (!m) continue;
  const r = runShell({ file: f, backCls: m[1] });
  const h = r.help();
  t(f + ': 部品が「使い方」を1本置く', h.length === 1, h.length);
  if (h.length) {
    t(f + ': 「← メニュー」の右隣', r.kids.indexOf(h[0]) === r.kids.indexOf(r.back) + 1);
    t(f + ': 行き先は表どおり', h[0].attrs.href === expHref(f), h[0].attrs.href);
    t(f + ': 文字は textContent の「使い方」', h[0].textContent === '使い方' && h[0].innerHTML === '');
    t(f + ': 型の名前を写す（su-menu-back は付けない）', h[0].className === m[1].split(/\s+/).filter((c) => c && c !== 'su-menu-back').concat('su-help-link').join(' '), h[0].className);
  }
}
{
  const r = runShell({ file: 'accounts.html' });
  r.win.SUShell._addHelp(); r.win.SUShell._addHelp();
  t('二重に置かない（何度呼んでも1本）', r.help().length === 1, r.help().length);
  r.listeners['w:pageshow']({ persisted: true });
  t('「戻る」で戻っても1本のまま', r.help().length === 1, r.help().length);
  t('枠（iframe）の中では置かない', runShell({ inFrame: true }).help().length === 0);
  for (const f of ['index.html', 'login.html', 'help.html']) t(f + ' では置かない', runShell({ file: f }).help().length === 0);
  t('メニューへのリンクが無い見出しには置かない', runShell({ noBack: true }).help().length === 0);
  t('部品は innerHTML を使わない', !/innerHTML/.test(raw('su-shell.js')));
  const css = raw('su-shell.css');
  t('su-shell.css: 印刷では「使い方」を消す', /@media print\s*\{\s*\.su-help-link\s*\{\s*display:\s*none\s*!important/.test(css));
  t('su-shell.css: 「← メニュー」と同じく折り返さない', /\.su-help-link\s*\{\s*white-space:\s*nowrap;\s*text-decoration:\s*none;\s*\}/.test(css));
}

console.log('4 保存していない入力がある5画面');
const Q = '保存していない変更があります。使い方へ移ると消えます。移りますか？';
function block(src, start) {
  const i = src.indexOf('{', start);
  let d = 0, q = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2) + 1; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(start, k + 1); }
  }
  return '';
}
/* 「使い方」の受け口（closest('a.su-help-link') を含む click の登録）を切り出す */
function cutHelpListener(src) {
  const k = src.indexOf("closest('a.su-help-link')");
  if (k < 0) return '';
  const i = src.lastIndexOf("document.addEventListener('click',", k);
  return i < 0 ? '' : src.slice(i, i + block(src, i).length) + ');';
}
const helpLink = { closest: (sel) => (sel === 'a.su-help-link' ? {} : null) };
const menuLink = { closest: (sel) => (sel.split(',').some((x) => x.trim() === 'a.su-menu-back') ? { classList: { contains: (x) => x === 'su-menu-back' } } : null) };
function runClick(code, ctx, ans, target, ev0) {
  let h = null, asked = 0;
  const ev = Object.assign({ button: 0, prevented: false, defaultPrevented: false, preventDefault() { this.prevented = true; }, target }, ev0 || {});
  const c = Object.assign({ setTimeout: () => 0, confirm: () => { asked++; return ans; },
    document: { addEventListener: (k, f) => { if (k === 'click') h = f; } } }, ctx);
  c.window = { confirm: c.confirm };
  vm.createContext(c);
  vm.runInContext(code, c);
  if (h) h(ev);
  return { prevented: ev.prevented, asked, ctx: c, bound: !!h };
}
const CASES = [
  { name: '入居者マスタ', src: () => raw('resident-master.js'), flag: 'rmMenuLeaveOk_', dirty: { rmMenuLeaveDirty_: () => true }, clean: { rmMenuLeaveDirty_: () => false } },
  { name: '職員マスタ', src: () => raw('staff-master.js'), flag: 'smMenuLeaveOk_', dirty: { hasUnsaved: () => true }, clean: { hasUnsaved: () => false } },
  { name: '入居調整', src: () => raw('admission-flow.html'), flag: 'afMenuLeaveOk_', dirty: { editing: {}, editDirty: true }, clean: { editing: null, editDirty: false } },
  { name: '消耗品管理', src: () => raw('supplies.html'), flag: 'SUP_LEAVE_OK', dirty: { supUnsaved: () => true }, clean: { supUnsaved: () => false } }
];
for (const c of CASES) {
  const s = c.src();
  const on = cutHelpListener(s);
  t(c.name + ': 「使い方」の受け口がある', !!on, '');
  if (!on) continue;
  t(c.name + ': 文言', on.indexOf(Q) >= 0, '');
  /* 「← メニュー」の受け口と同じ判定を呼ぶ */
  const judge = Object.keys(c.dirty).join('|');
  t(c.name + ': 「← メニュー」と同じ判定を使う', new RegExp(judge.replace(/\|/g, '[\\s\\S]*')).test(on), judge);
  const code = 'var ' + c.flag + '=false;' + on;
  const no = runClick(code, c.dirty, false, helpLink);
  t(c.name + ': 保存していない時「いいえ」で移らない', no.bound && no.prevented && no.asked === 1 && no.ctx[c.flag] === false, no);
  const yes = runClick(code, c.dirty, true, helpLink);
  t(c.name + ': 「はい」で移り、beforeunload に二重に聞かない印を立てる', !yes.prevented && yes.asked === 1 && yes.ctx[c.flag] === true, yes);
  const clean = runClick(code, c.clean, false, helpLink);
  t(c.name + ': 変更が無ければ聞かない', !clean.prevented && clean.asked === 0, clean);
  const other = runClick(code, c.dirty, false, menuLink);
  t(c.name + ': 「← メニュー」を押した時はこの受け口では聞かない（二重に聞かない）', !other.prevented && other.asked === 0, other);
}
{
  const s = raw('supplies.html');
  const on = cutHelpListener(s);
  const a = s.indexOf('function priceEditSnap(E) {'), b = s.indexOf('function closeNew() {');
  t('消耗品管理: 「使い方」の受け口は既存の確かめの区間（priceEditSnap〜closeNew）の外に置く', !!on && s.indexOf("closest('a.su-help-link')") > b && b > a);
  const code = 'var SUP_LEAVE_OK=false;' + on;
  const mod = runClick(code, { supUnsaved: () => true }, false, helpLink, { metaKey: true });
  t('消耗品管理: 新しいタブで開く押し方では聞かない', !mod.prevented && mod.asked === 0, mod);
}
{ // 担当者会議
  const s = raw('care-meeting.html');
  const i = s.search(/function onHdrHelpClick_\s*\(/);
  const fn = i < 0 ? '' : s.slice(i, i + block(s, i).length);
  const j = s.search(/function cmLeaveDirty_\s*\(/);
  const dirtyFn = j < 0 ? '' : s.slice(j, j + block(s, j).length);
  t('担当者会議: 「使い方」の受け口がある・同じ判定（cmLeaveDirty_）を使う', !!fn && /cmLeaveDirty_\(\)/.test(fn) && !!dirtyFn, '');
  t('担当者会議: 文言', fn.indexOf(Q) >= 0, '');
  const code = 'var cmLeaveOk_=false;' + dirtyFn + fn + ' document.addEventListener("click", onHdrHelpClick_);';
  const dirty = { isDirty_: () => true, ed: {}, impSt: null };
  const no = runClick(code, dirty, false, helpLink);
  t('担当者会議: 保存していない時「いいえ」で移らない', no.prevented && no.asked === 1, no);
  const yes = runClick(code, dirty, true, helpLink);
  t('担当者会議: 「はい」で移り印を立てる', !yes.prevented && yes.ctx.cmLeaveOk_ === true, yes);
  const clean = runClick(code, { isDirty_: () => false, ed: null, impSt: null }, false, helpLink);
  t('担当者会議: 変更が無ければ聞かない', !clean.prevented && clean.asked === 0, clean);
  t('担当者会議: 見出しに受け口を付ける', /hdrEl\.addEventListener\('click',onHdrHelpClick_\)/.test(s));
}

console.log('5 置かない画面');
for (const f of ['index.html', 'login.html', 'help.html', 'work-schedule.html', 'shift-app.html', 'shift-analyzer.html']) {
  t(f + ': 「使い方」を置かない', raw(f).indexOf('su-help-link') < 0 && raw(f).indexOf('su-shell.js') < 0);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
