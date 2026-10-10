/* メニュー（index.html）の組み立てが壊れた定義でも使える分を出すこと（#15）と、接続設定の初回案内（#12）・
   家族構成図の合言葉の文言（#16）の試験（2026-10-10 新設・監査10月版 第2版 12・15・16）
   実行: node check/unit/menu_fallback_test.js
   守ること:
     ①壊れたタイル・壊れた区分は、その1件だけを飛ばし、出せた分は出す。上に「一部の項目（n件）」の帯を出し、不具合として知らせる
     ②定義を読めない・1枚も出せない時は案内に切り替え、その時も「使い方・困った時」（help.html）へのリンクを出す
     ③正しい定義では帯も知らせも出ない（今までどおり）
     ④接続設定の初回案内は印刷しない・「✓ が並べば準備はできています」と言い切らない
     ⑤家族構成図: GAS 側の GENOGRAM_TOKEN 未設定の可能性も文言で示す・通らない 'grace' の分岐は無い */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* 組み立てのスクリプト（定義の次の <script>）を取り出す */
const defEnd = HTML.indexOf('</script>', HTML.indexOf('id="menuDef"'));
const sStart = HTML.indexOf('<script>', defEnd) + '<script>'.length;
const BUILD = HTML.slice(sStart, HTML.indexOf('</script>', sStart));
const GOOD_DEF = HTML.slice(HTML.indexOf('>', HTML.indexOf('id="menuDef"')) + 1, defEnd);

/* 組み立てに要る分だけの小さな DOM */
function makeEl(tag) {
  const e = { tagName: tag.toUpperCase(), className: '', attrs: {}, children: [], _text: '', id: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v); this.children = []; },
    querySelector(sel) {   // 'a.tile' だけ
      const [tg, cls] = sel.split('.');
      const walk = n => { for (const c of n.children || []) { if (c.tagName === tg.toUpperCase() && (' ' + c.className + ' ').indexOf(' ' + cls + ' ') >= 0) return c; const r = walk(c); if (r) return r; } return null; };
      return walk(this);
    }
  };
  return e;
}
function run(defText) {
  const main = makeEl('main');
  const reports = [];
  const doc = {
    getElementById: id => (id === 'menu' ? main : id === 'menuDef' ? { textContent: defText } : null),
    createElement: makeEl,
    createTextNode: s => ({ textContent: String(s), children: [] })
  };
  const box = { document: doc, window: { SUErrors: { report: (a, e, w) => reports.push([a, e && e.message, w]) } }, JSON, Array, String, Object, Error };
  box.SUErrors = box.window.SUErrors;
  vm.createContext(box);
  let err = null;
  try { vm.runInContext(BUILD, box); } catch (e) { err = e.message; }
  const tiles = [];
  const walk = n => { for (const c of n.children || []) { if (c.tagName === 'A' && /\btile\b/.test(c.className)) tiles.push(c.attrs.href); walk(c); } };
  walk(main);
  const links = [];
  const walkA = n => { for (const c of n.children || []) { if (c.tagName === 'A') links.push(c.attrs.href); walkA(c); } };
  walkA(main);
  const broken = main.children.find(c => c.className === 'menu-broken');
  return { main, tiles, links, reports, err, broken: broken ? broken.textContent : null };
}

console.log('\n— 1. 正しい定義は今までどおり —');
const good = JSON.parse(GOOD_DEF);
const goodCount = good.sections.reduce((n, s) => n + s.tiles.length, 0);
{
  const r = run(GOOD_DEF);
  t('全部のタイルが出る（' + goodCount + '枚）', !r.err && r.tiles.length === goodCount, [r.err, r.tiles.length]);
  t('帯も不具合の知らせも出ない', r.broken === null && r.reports.length === 0, [r.broken, r.reports]);
  /* 並び順・事務所PC用の印・行替え・施設名の欄まで、定義どおりに出る */
  const want = [], got = [];
  good.sections.forEach(s => s.tiles.forEach(x => want.push([x.href, !!(x.officeOnly || s.officeOnly), !!x.newrow, /^\{\{(施設|訪問|通所)\}\}/.test(x.note || '') ? RegExp.$1 : ''])));
  const facOf = n => { for (const c of n.children || []) { if (c.attrs && c.attrs['data-fac-name']) return c.attrs['data-fac-name']; const v = facOf(c); if (v) return v; } return ''; };
  r.main.children.forEach(sec => sec.children.filter(c => c.className === 'grid').forEach(g => g.children.forEach(a =>
    got.push([a.attrs.href, 'data-office-only' in a.attrs || 'data-office-only' in sec.attrs, /\bnewrow\b/.test(a.className), facOf(a)]))));
  t('並び順・事務所PC用の印・行替え・施設名の欄が定義どおり', JSON.stringify(got) === JSON.stringify(want), { want: want.slice(0, 3), got: got.slice(0, 3) });
  t('区分の見出しの数が定義どおり', r.main.children.filter(c => c.tagName === 'SECTION').length === good.sections.length, '');
}

console.log('\n— 2. 壊れた1件だけを飛ばす —');
{
  const d = JSON.parse(GOOD_DEF);
  d.sections[0].tiles.splice(1, 0, null);   // 壊れたタイル（null）
  const r = run(JSON.stringify(d));
  t('壊れたタイル1件だけを飛ばし、残りは全部出す', !r.err && r.tiles.length === goodCount, [r.err, r.tiles.length]);
  t('上に「一部の項目（1件）」の帯を出す', !!r.broken && /一部の項目（1件）/.test(r.broken) && r.main.children[0].className === 'menu-broken', r.broken);
  t('不具合として1回知らせる', r.reports.length === 1 && r.reports[0][0] === 'メニュー', r.reports);
}
{
  const d = JSON.parse(GOOD_DEF);
  d.sections.splice(0, 0, null);         // 壊れた区分（null）だけ
  const r = run(JSON.stringify(d));
  t('壊れた区分（null）を飛ばし、他の区分は全部出す・帯と知らせ', !r.err && r.tiles.length === goodCount && /（1件）/.test(r.broken || '') && r.reports.length === 1, [r.err, r.tiles.length, r.broken, r.reports]);
}
{
  const d = JSON.parse(GOOD_DEF);
  const lost = d.sections[1].tiles.length;
  d.sections[1].tiles = 'x';            // タイルの一覧が配列でない区分だけ
  const r = run(JSON.stringify(d));
  const secs = r.main.children.filter(c => c.tagName === 'SECTION').length;
  t('タイルの一覧が配列でない区分だけでも、壊れた1件として帯と知らせを出し、その区分は出さない',
    !r.err && r.tiles.length === goodCount - lost && /（1件）/.test(r.broken || '') && r.reports.length === 1 && secs === d.sections.length - 1, [r.err, r.tiles.length, r.broken, r.reports, secs]);
}
{
  const d = JSON.parse(GOOD_DEF);
  delete d.sections[0].tiles[0].href;    // リンク先の無いタイル
  const r = run(JSON.stringify(d));
  t('リンク先の無いタイルは「undefined」のリンクにせず、壊れた1件として飛ばす',
    !r.err && r.tiles.length === goodCount - 1 && r.tiles.indexOf('undefined') < 0 && /（1件）/.test(r.broken || '') && r.reports.length === 1, [r.err, r.tiles.length, r.broken]);
}
{
  const d = JSON.parse(GOOD_DEF);
  d.sections[2].tiles = d.sections[2].tiles.map(() => null);   // 区分のタイルが全部壊れた
  const r = run(JSON.stringify(d));
  const secs = r.main.children.filter(c => c.tagName === 'SECTION').length;
  t('タイルが全部壊れた区分は見出しだけで出さない', !r.err && secs === d.sections.length - 1 && !!r.broken, [secs, r.broken]);
}

console.log('\n— 3. 1枚も出せない時は案内と「使い方・困った時」 —');
for (const [name, txt] of [['定義が JSON として読めない', '{ 壊れた'], ['区分が空', '{"sections":[]}'], ['sections が無い', '{}'], ['null', 'null']]) {
  const r = run(txt);
  t(name + ': 案内を出し、help.html へのリンクを出す・不具合として知らせる',
    !r.err && r.tiles.length === 0 && /メニューを組み立てられませんでした/.test(r.main.textContent) && r.links.indexOf('help.html') >= 0 && r.reports.length === 1,
    [r.err, r.main.textContent.slice(0, 40), r.links, r.reports]);
}

console.log('\n— 4. 接続設定の初回案内（#12）—');
{
  const CS = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');
  t('印刷では案内（#wiz）と開くボタン（.wiz-open）を出さない', /@media print \{ #wiz, \.wiz-open \{ display: none !important; \} \}/.test(CS), '');
  t('「✓ が並べば準備はできています」と言い切らない', CS.indexOf('並べば準備') < 0, '');
  t('✓＝URL につながった、合言葉と正しいアプリかは各アプリで確かめる、と書く', /✓ は「URL につながった」という印です。合言葉が正しいか・そのアプリの GAS かは、各アプリ/.test(CS), '');
}

console.log('\n— 5. 家族構成図の合言葉の文言（#16）—');
{
  const GN = fs.readFileSync(path.join(ROOT, 'genogram.html'), 'utf8');
  const m = /const AUTH_ERR_MSG = '([^']*)';/.exec(GN);
  t('断られた時の文言に、端末の合言葉と GAS 側の GENOGRAM_TOKEN の両方が出る', !!m && /クラウド設定の「合言葉」/.test(m[1]) && /GENOGRAM_TOKEN/.test(m[1]), m && m[1]);
  t("通らない 'grace' の分岐が無い", GN.indexOf("p.auth === 'grace'") < 0, '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
