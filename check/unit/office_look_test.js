/* 事務所の管理画面（勤怠管理・給与）の PC の並び（左の縦のメニュー・題の帯・パンくず・丸い月の並び）の試験（2026-11-27 本人指示）
 *   1. su-office-look.css は画面だけ（紙は足した部品を隠すだけ）・他社の名前を書かない
 *   2. 2画面が </head> の直前で読む・公開の許可リストに載っている
 *   3. su-office-look.js は見た目だけ（保存・通信・端末への記録・innerHTML・console を使わない）・月分は今の欄に値を入れて change を送るだけ
 *   4. 丸い月の並び・パンくずの動き（仮の DOM で）: 押すと欄が変わり change が届く・欄の値を画面が戻すと並びも戻る・パンくずは今のタブの名前（件数の札を除く）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const CSS = read('su-office-look.css'), JS = read('su-office-look.js'), KH = read('kintai.html'), PH = read('payroll.html');

console.log('\n— 1. 画面だけ —');
const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = body.match(/@media[^{]*\{/g) || [];
t('全部の塊が @media screen か @media print', blocks.length > 0 && blocks.every((b) => /^@media (screen|print)\b/.test(b)), blocks);
const pr = (body.match(/@media print\s*\{([\s\S]*?)\}\s*\}/) || [])[1] || '';
t('紙の塊は足した部品を隠すだけ', /^\s*\.sul-crumb, \.sul-months \{ display: none !important; \s*$/.test(pr) && (body.match(/@media print/g) || []).length === 1);
t('塊の外に決まりを書かない', body.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').trim() === '');
t('他社の製品名を書かない', !/freee|フリー/i.test(CSS + JS));
t('外の住所の絵を読まない（絵は data: だけ）', !/url\((?!["']?data:|var\()/.test(body));
t('隠したタブ（社保・給与の設定）は左のメニューでも出さない', /\.tabs > button\[hidden\][^{]*\{ display: none !important; \}/.test(body));
t('次に押す塗りの青は印 su-sub の付いたボタンに当てない', /\.btn\.pri:not\(\.su-sub\)/.test(body) && !/\.btn\.pri \{/.test(body));

console.log('\n— 2. 読む画面と公開 —');
for (const [n, h] of [['勤怠管理', KH], ['給与', PH]]) {
  t(n + ': </head> の直前で CSS と JS（defer）を読む', /<link rel="stylesheet" href="su-office-look\.css\?v=2026-11-28\.1">\n<script src="su-office-look\.js\?v=2026-11-27" defer><\/script>\n<\/head>/.test(h));
}
const others = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f) && f !== 'kintai.html' && f !== 'payroll.html').filter((f) => /su-office-look/.test(read(f)));
t('ほかの画面は読まない', others.length === 0, others);
const gi = read('.gitignore');
t('公開の許可リストに載っている', /^!\/su-office-look\.css$/m.test(gi) && /^!\/su-office-look\.js$/m.test(gi));

console.log('\n— 3. 見た目だけ —');
const code = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
t('保存・通信・端末への記録を使わない', !/localStorage|sessionStorage|fetch\(|XMLHttpRequest|indexedDB|document\.cookie/.test(code));
t('innerHTML・insertAdjacentHTML・console を使わない', !/innerHTML|insertAdjacentHTML|outerHTML|console\./.test(code));
t('月分は今の欄に値を入れて change を送るだけ', /ym\.value = v;\s*ym\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/.test(code));
t('二度読んでも1回だけ動く', /window\.__suOfficeLook\) return/.test(code));

console.log('\n— 4. 仮の DOM で動き —');
/* 小さな仮の DOM（使う分だけ） */
function mk(doc, tag) {
  const e = { tagName: tag.toUpperCase(), children: [], childNodes: [], attrs: {}, parentNode: null, hidden: false, disabled: false, listeners: {}, className: '', ownerDocument: doc,
    get firstChild() { return this.childNodes[0] || null; },
    set textContent(v) { this.childNodes = [{ nodeType: 3, nodeValue: String(v) }]; this.children = []; },
    get textContent() { return this.childNodes.map((c) => c.nodeType === 3 ? c.nodeValue : c.textContent).join(''); },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.tagName) this.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); this.children = this.childNodes.filter((x) => x.tagName); return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); this.children = this.childNodes.filter((x) => x.tagName); return c; },
    addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); },
    dispatchEvent(ev) { ev.target = ev.target || this; let n = this; while (n) { (n.listeners[ev.type] || []).forEach((f) => f(ev)); n = ev.bubbles ? n.parentNode : null; } return true; },
    contains(x) { while (x) { if (x === this) return true; x = x.parentNode; } return false; },
    closest(sel) { let n = this; while (n) { if (n.tagName && n.tagName.toLowerCase() === sel) return n; n = n.parentNode; } return null; },
    all() { const out = []; (function walk(n) { n.children.forEach((c) => { out.push(c); walk(c); }); })(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const direct = /^:scope > /.test(sel); const s = sel.replace(/^:scope > /, '');
      const m = /^([a-z0-9]*)(?:\.([a-z-]+))?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(s); if (!m) return [];
      const pool = direct ? this.children : this.all();
      return pool.filter((n) => (!m[1] || n.tagName.toLowerCase() === m[1]) && (!m[2] || (' ' + n.className + ' ').includes(' ' + m[2] + ' ')) && (!m[3] || (m[4] === undefined ? m[3] in n.attrs : n.attrs[m[3]] === m[4])));
    },
    focus() { doc.activeElement = this; } };
  return e;
}
const doc = { readyState: 'complete', hidden: false, activeElement: null, listeners: {}, addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); } };
doc.createElement = (tag) => mk(doc, tag);
const html = mk(doc, 'html'), hdr = mk(doc, 'header'), h1 = mk(doc, 'h1'), app = mk(doc, 'div'), bar = mk(doc, 'div'), tabs = mk(doc, 'nav'), ym = mk(doc, 'input');
h1.textContent = '勤怠管理'; hdr.appendChild(h1); html.appendChild(hdr);
app.id = 'g-app'; bar.className = 'bar su-mbar'; tabs.className = 'tabs'; ym.id = 'g-ym'; ym.value = '2026-01'; ym.min = ''; ym.max = '';
bar.appendChild(ym); app.appendChild(bar); app.appendChild(tabs); html.appendChild(app);
const changes = [];
ym.addEventListener('change', () => changes.push(ym.value));
for (const [k, name, n] of [['home', 'ホーム', ''], ['review', '要確認', '26'], ['grid', '月の一覧', '']]) {
  const b = mk(doc, 'button'); b.setAttribute('role', 'tab'); b.setAttribute('data-tab', k); b.setAttribute('aria-selected', k === 'review' ? 'true' : 'false');
  b.childNodes.push({ nodeType: 3, nodeValue: name }); if (n) { const sp = mk(doc, 'span'); sp.className = 'tab-n'; sp.textContent = n; b.appendChild(sp); }
  b.click = () => { tabs.children.forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); };
  tabs.appendChild(b);
}
doc.getElementById = (id) => html.all().find((n) => n.id === id) || null;
doc.querySelector = (s) => (s === '.hdr h1' ? h1 : null);
let tick = null;
const win = { matchMedia: () => ({ matches: true }), setTimeout: (f) => f(), document: doc };
const sb = { window: win, document: doc, Event: function (type, o) { this.type = type; this.bubbles = !!(o && o.bubbles); }, KeyboardEvent: function () {}, setInterval: (f) => { tick = f; }, setTimeout: (f) => f(), Date };
vm.runInNewContext(JS, sb);
const crumb = app.children[0], months = bar.children[0];
t('パンくずが中身の頭に入る', crumb && crumb.className.includes('sul-crumb'));
t('パンくずの今の場所は件数の札を除いたタブの名前', crumb && crumb.textContent.includes('要確認') && !crumb.textContent.includes('26'), crumb && crumb.textContent);
t('丸い月の並びが帯の頭に入り、1月が選ばれている', months && months.className.includes('sul-months') && months.querySelector('button[aria-pressed="true"]').getAttribute('data-sul-ym') === '2026-01');
const m3 = months.querySelector('button[data-sul-ym="2026-03"]');
months.dispatchEvent({ type: 'click', target: m3, bubbles: false });
t('3月を押すと欄が 2026-03 になり change が1回届く', ym.value === '2026-03' && changes.join() === '2026-03', changes);
t('並びも3月を選んだ形になる', months.querySelector('button[aria-pressed="true"]').getAttribute('data-sul-ym') === '2026-03');
ym.value = '2026-01'; tick();
t('画面が欄の値を戻すと（保存していない設定でやめた等）並びも戻る', months.querySelector('button[aria-pressed="true"]').getAttribute('data-sul-ym') === '2026-01');
months.dispatchEvent({ type: 'click', target: months.querySelector('button[data-sul-y="1"]'), bubbles: false });
t('→ で次の年の月を出すだけ（欄は変えない）', ym.value === '2026-01' && !!months.querySelector('button[data-sul-ym="2027-01"]') && changes.length === 1);
ym.min = '2027-03'; ym.value = '2027-05'; tick();
t('欄の min より前の月は押せない', months.querySelector('button[data-sul-ym="2027-02"]').disabled === true && months.querySelector('button[data-sul-ym="2027-03"]').disabled === false);
tabs.children[2].click(); tick();
t('タブを移るとパンくずも追いつく', crumb.textContent.includes('月の一覧'));

/* 勤怠管理だけ元の青と白（本人指示 2026-11-28）: 印は勤怠管理の <html> だけ・給与には付けない・CSS は明るい表示と暗い表示の両方で戻す */
{
  const fs2 = require('fs'), path2 = require('path'), R2 = path2.join(__dirname, '..', '..');
  const K = fs2.readFileSync(path2.join(R2, 'kintai.html'), 'utf8'), P = fs2.readFileSync(path2.join(R2, 'payroll.html'), 'utf8'), CSS = fs2.readFileSync(path2.join(R2, 'su-office-look.css'), 'utf8');
  t('勤怠管理の <html> に data-sul-palette="blue"・給与には無い', /<html lang="ja" data-su-theme data-sul-palette="blue">/.test(K) && !/data-sul-palette/.test(P));
  t('青と白の組: 明るい表示（字 #14213d・地 #fff・塗り #1946a8）と暗い表示（塗り #9dbaff）', /\[data-sul-palette="blue"\]:not\(\[data-su-theme~="keep-hdr"\]\) \{[^}]*--ink: #14213d;[^}]*--sul-fill: #1946a8;/.test(CSS) && /prefers-color-scheme: dark\) \{\n  html:root\[data-su-theme\]\[data-sul-palette="blue"\][^{]*\{[^}]*--sul-fill: #9dbaff;/.test(CSS));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
