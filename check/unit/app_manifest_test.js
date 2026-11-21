/* ホーム画面に追加した時の名前とアイコンの試験（2026-11-21 本人指示）
   実行: node check/unit/app_manifest_test.js
   守ること:
     - manifest.webmanifest は JSON として読め、住所はすべて相対（よその施設の公開先でもそのまま動く）
     - 書いた絵（アイコン）はリポジトリにあり、PNG で、書いた大きさと同じ
     - 名前に施設名・会社名を入れない（公開リポジトリ。施設ごとの名前は facility-profile.json の役目）
     - 端末に画面を残す仕組み（service worker）を登録しない（古い画面が端末に残る・2026-11-21 決定）
     - メニュー（index.html）だけが manifest を読み、公開の白リスト（.gitignore）に全部載っている
   画面のコードは書き換えず、ファイルを読むだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const isRel = (u) => typeof u === 'string' && u.length > 0 && !/^[a-z]+:/i.test(u) && !u.startsWith('/') && !u.startsWith('//');

console.log('ホーム画面に追加した時の名前とアイコン');
let m = null;
try { m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); } catch (e) { m = null; }
t('1 manifest.webmanifest を JSON として読める', !!m && typeof m === 'object', '');
m = m || {};
t('2 名前と短い名前がある（短い名前は12字まで）', typeof m.name === 'string' && m.name && typeof m.short_name === 'string' && m.short_name && [...m.short_name].length <= 12, [m.name, m.short_name]);
t('3 開く所・範囲・id は相対の住所', ['start_url', 'scope', 'id'].every((k) => isRel(m[k])), [m.start_url, m.scope, m.id]);
t('4 開く所は範囲の中（メニュー）', m.start_url === './index.html' && m.scope === './', [m.start_url, m.scope]);
t('5 開き方は決まった値', ['standalone', 'minimal-ui', 'browser', 'fullscreen'].includes(m.display), m.display);
t('6 色は #RRGGBB', /^#[0-9A-Fa-f]{6}$/.test(m.background_color || '') && /^#[0-9A-Fa-f]{6}$/.test(m.theme_color || ''), [m.background_color, m.theme_color]);

const icons = Array.isArray(m.icons) ? m.icons : [];
t('7 アイコンが 192 と 512 の両方ある（512 の maskable も）',
  icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512' && (i.purpose || 'any').includes('any')) &&
  icons.some((i) => i.sizes === '512x512' && (i.purpose || '').includes('maskable')), icons.map((i) => i.sizes + ' ' + i.purpose));
const bad = [];
for (const i of icons) {
  const f = path.join(ROOT, i.src || '');
  if (!isRel(i.src) || !fs.existsSync(f)) { bad.push(i.src + ' が無い'); continue; }
  const s = pngSize(f);
  const [w, h] = String(i.sizes || '').split('x').map(Number);
  if (!s || i.type !== 'image/png') bad.push(i.src + ' が PNG でない');
  else if (s.w !== w || s.h !== h) bad.push(i.src + ' の大きさが ' + s.w + 'x' + s.h);
}
t('8 アイコンの絵が実在し、書いた大きさの PNG', bad.length === 0, bad);

const touch = path.join(ROOT, 'apple-touch-icon.png');
const ts = fs.existsSync(touch) ? pngSize(touch) : null;
t('9 iPhone 用の絵（apple-touch-icon.png）は 180x180 の PNG', !!ts && ts.w === 180 && ts.h === 180, ts);

// 施設名・会社名を入れない: 施設の名前は facility-profile.json（公開の見本）からではなく、名前の欄が一般の語だけかで確かめる
const text = JSON.stringify([m.name, m.short_name, m.description]);
t('10 名前は一般の語だけ（施設名・会社名・事業所の語を入れない）', !/(株式会社|有限会社|合同会社|ホーム|訪問介護|デイサービス|事業所)/.test(text), text);

const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const head = INDEX.slice(0, INDEX.search(/<\/head>/i));
t('11 メニューの頭が manifest と iPhone 用の絵を読む',
  /<link\b[^>]*\brel="manifest"[^>]*\bhref="manifest\.webmanifest"/.test(head) && /<link\b[^>]*\brel="apple-touch-icon"[^>]*\bhref="apple-touch-icon\.png"/.test(head), '');
t('12 iPhone の全画面を強める指定（apple-mobile-web-app-capable）を入れない', !/apple-mobile-web-app-capable|mobile-web-app-capable/.test(head), '');

// service worker を登録しない（公開しているすべての HTML・JS を読む）
const reg = [];
for (const f of fs.readdirSync(ROOT)) {
  if (!/\.(html|js)$/.test(f)) continue;
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/serviceWorker\s*\.\s*register\s*\(/.test(s)) reg.push(f);
}
t('13 どの画面も service worker を登録しない', reg.length === 0, reg);

const others = [];
for (const f of fs.readdirSync(ROOT)) {
  if (!/\.html$/.test(f) || f === 'index.html') continue;
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (/rel="manifest"/.test(s)) others.push(f);
}
t('14 manifest を読むのはメニューだけ', others.length === 0, others);

const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
const need = ['manifest.webmanifest', 'apple-touch-icon.png'].concat(icons.map((i) => i.src));
const miss = need.filter((f) => !gi.includes('!/' + f));
t('15 公開の白リスト（.gitignore）に全部載っている', miss.length === 0, miss);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
