/* メニュー（index.html）の、端末の役割（su_device_role）による出し分けと事業所名の差し込みの試験（2026-10-22 新設・改善プロンプト第4弾の7）
   実行: node check/unit/menu_device_role_test.js
   （画面を差し替えて試す時: INDEX_HTML=差し替えた画面のパス node check/unit/menu_device_role_test.js）
   定義の中身は menu_def_test.js、組み立ての壊れた定義の扱いは menu_fallback_test.js が見る。ここは残りの3つを見る:
   守ること:
     1. 端末の役割が「現場」（'field'）の時だけ、ページに is-field の印を付ける。「事務所」・未設定・知らない値では付けない。
        端末の保存領域が使えない時（例外）は印を付けない＝タイルを出す側に倒す（ページを止めない）
     2. 「戻る」でページがそのまま戻った時（pageshow の persisted）だけ測り直し、印を今の役割に合わせる。普通の表示では測り直さない
     3. 印を付ける処理は <body> より前にある（タイルが一瞬見えてから消える「ちらつき」を出さない）。
        印のある時に事務所専用（data-office-only）のタイルを隠す CSS は !important 付き。
        このページは su_device_role を読むだけで、端末の保存領域へ書かない
     4. 事業所名の差し込み（data-fac-name）は、施設情報が読めた時だけ officeName の名前に置き換える。
        読めていない時は一般名のまま触らず、読めた時（onReady）に置き換える。施設情報の部品が無くても止まらない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.INDEX_HTML || path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}

/* 役割の判定（is-field を付ける <script>）と、事業所名の差し込み（data-fac-name を埋める <script>）を取り出す */
function scriptAround(marker) {
  const at = HTML.indexOf(marker);
  if (at < 0) throw new Error('見つかりません: ' + marker);
  const s = HTML.lastIndexOf('<script>', at) + '<script>'.length;
  return { src: HTML.slice(s, HTML.indexOf('</script>', at)), at: s };
}
const ROLE = scriptAround("classList.toggle('is-field'");
// 組み立ての script も組み立て直した後に同じ差し込みをする（2026-10-23）ので、施設情報の読み終わりを預ける末尾の script を探す
const FILL = scriptAround("SUFacility.onReady(fill)");

/* 役割の判定を動かす。store は端末の保存領域（throws=true なら読むと例外） */
function runRole(store, throws) {
  const cls = new Set(), listeners = {}, writes = [];
  const box = {
    document: { documentElement: { classList: {
      toggle(c, on) { if (on) cls.add(c); else cls.delete(c); },
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); }
    } } },
    localStorage: {
      getItem(k) { if (throws) throw new Error('SecurityError'); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { writes.push([k, v]); }, removeItem(k) { writes.push([k, null]); }
    },
    window: { addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); } }
  };
  vm.createContext(box);
  let err = null;
  try { vm.runInContext(ROLE.src, box); } catch (e) { err = e.message; }
  const fire = (ev, e) => (listeners[ev] || []).forEach(fn => fn(e));
  return { field: () => cls.has('is-field'), fire, listeners, writes, err };
}

console.log('\n— 1. 端末の役割で印を付ける —');
for (const [label, store, want] of [
  ['現場（field）は印を付ける', { su_device_role: 'field' }, true],
  ['事務所（office）は付けない', { su_device_role: 'office' }, false],
  ['未設定（既定＝事務所）は付けない', {}, false],
  ['大文字の "Field" は付けない（一致だけで判定）', { su_device_role: 'Field' }, false]
]) {
  const r = runRole(store, false);
  t(label, !r.err && r.field() === want, [r.err, r.field()]);
}
{
  const r = runRole({ su_device_role: 'field ' }, false);
  t('前後に空白がある "field " も現場とみなさない（一致だけで判定）', !r.err && r.field() === false, [r.err, r.field()]);
}
{
  const r = runRole({ su_device_role: 'field' }, true);
  t('保存領域が使えない（読むと例外）時は印を付けず、例外を外に出さない', !r.err && r.field() === false, [r.err, r.field()]);
}

console.log('\n— 2. 「戻る」で戻った時だけ測り直す —');
{
  const store = { su_device_role: 'office' };
  const r = runRole(store, false);
  t('pageshow を1つだけ見張る', (r.listeners.pageshow || []).length === 1, Object.keys(r.listeners));
  store.su_device_role = 'field';
  r.fire('pageshow', { persisted: false });
  t('普通の表示（persisted=false）では測り直さない', r.field() === false, r.field());
  r.fire('pageshow', { persisted: true });
  t('そのまま戻った時（persisted=true）は今の役割で付け直す（事務所→現場）', r.field() === true, r.field());
  store.su_device_role = 'office';
  r.fire('pageshow', { persisted: true });
  t('現場→事務所へ戻した後に戻ると印を外す', r.field() === false, r.field());
  t('どの場合も保存領域へ書かない', r.writes.length === 0, r.writes);
}

console.log('\n— 3. 置き場所と隠す CSS —');
const bodyAt = HTML.search(/^<body>/m);   // 先頭のコメントにも「<body>」の字があるので、行頭のタグだけを見る
t('役割の判定は <body> より前（head の中）にある', ROLE.at > 0 && ROLE.at < bodyAt && ROLE.at < HTML.indexOf('</head>'), [ROLE.at, bodyAt]);
t('印のある時に data-office-only を隠す CSS が !important 付きである', /\.is-field \[data-office-only\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/.test(HTML), '');
t('隠す CSS は <body> より前にある', HTML.indexOf('.is-field [data-office-only]') > 0 && HTML.indexOf('.is-field [data-office-only]') < bodyAt, '');
t('ページのどこにも端末の保存領域への書き込み（setItem・removeItem・clear）が無い', !/localStorage\.(setItem|removeItem|clear)\(/.test(HTML), '');
t('役割の判定が読むのは su_device_role だけ', (ROLE.src.match(/getItem\('([^']+)'\)/g) || []).join() === "getItem('su_device_role')", ROLE.src.match(/getItem\([^)]*\)/g));

console.log('\n— 4. 事業所名の差し込み —');
function runFill(fac) {
  const els = [{ attr: '通所', textContent: '通所介護' }, { attr: '訪問', textContent: '訪問介護' }];
  const ready = [];
  const box = {
    document: { querySelectorAll: sel => (sel === '[data-fac-name]' ? els.map(e => ({
      getAttribute: k => (k === 'data-fac-name' ? e.attr : null),
      set textContent(v) { e.textContent = v; }, get textContent() { return e.textContent; }
    })) : []) },
    window: {}
  };
  if (fac) {
    box.window.SUFacility = {
      ready: () => fac.isReady,
      onReady: fn => { ready.push(fn); },
      officeName: k => ({ 通所: '見本デイ', 訪問: '見本ヘルパー' }[k] || '')
    };
    box.SUFacility = box.window.SUFacility;
  }
  vm.createContext(box);
  let err = null;
  try { vm.runInContext(FILL.src, box); } catch (e) { err = e.message; }
  return { els, ready, err, fac };
}
{
  const r = runFill({ isReady: true });
  t('読めている時はすぐに officeName の名前へ置き換える', !r.err && r.els.map(e => e.textContent).join() === '見本デイ,見本ヘルパー', [r.err, r.els]);
}
{
  const r = runFill({ isReady: false });
  t('読めていない時は一般名のまま触らない', !r.err && r.els.map(e => e.textContent).join() === '通所介護,訪問介護', [r.err, r.els]);
  t('読めた時（onReady）に置き換える処理を1つ預ける', r.ready.length === 1, r.ready.length);
  r.fac.isReady = true; r.ready[0]();
  t('onReady が来たら置き換わる', r.els.map(e => e.textContent).join() === '見本デイ,見本ヘルパー', r.els);
}
{
  const r = runFill(null);
  t('施設情報の部品が無くても止まらず、一般名のまま', !r.err && r.els.map(e => e.textContent).join() === '通所介護,訪問介護', [r.err, r.els]);
}
t('施設情報の部品（su-facility.js）は差し込みの処理より前に読み込む', HTML.indexOf('<script src="su-facility.js') > 0 && HTML.indexOf('<script src="su-facility.js') < FILL.at, '');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
