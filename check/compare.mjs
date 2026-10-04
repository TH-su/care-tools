/* check/compare.mjs — 直す前（base）と直した後（head）の撮影を画素で見比べる（2026-10-04 新設）
 *
 *   node check/compare.mjs --base check/out/base --head check/out/head [--out check/out/compare] [--allow a.html,b.html]
 *
 * ・同じ名前の PNG を1枚ずつ比べ、違う画素の数を数える。違いがあれば赤で塗った差分画像を out に置く
 * ・印刷ページ数（metrics.json）も見比べる
 * ・--allow に挙げた画面は「変えてよい画面」＝違いがあっても失敗にしない（PC・印刷とも）
 * ・終了コード: 許可していない画面の PC か印刷に違いがあれば 1、無ければ 0
 *   iPhone（ph100/ph200）の違いは報告だけ（終了コードに入れない。幅の条件つきの直しで変わるのが普通のため）
 *
 * 比べ方は Node に画像ライブラリを入れず、Chromium の canvas で行う（依存を増やさない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, parseArgs, ensureDir, readJson, writeJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const baseDir = path.resolve(args.base || 'check/out/base');
const headDir = path.resolve(args.head || 'check/out/head');
const outDir = ensureDir(path.resolve(args.out || 'check/out/compare'));
const allow = new Set((args.allow ? String(args.allow).split(',') : []).map((s) => s.trim().replace(/\.html$/, '')).filter(Boolean));

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();

const files = fs.readdirSync(headDir).filter((f) => f.endsWith('.png')).sort();
const results = [];
for (const f of files) {
  const a = path.join(baseDir, f), b = path.join(headDir, f);
  const [name, view] = [f.replace(/\.[a-z0-9]+\.png$/, ''), f.match(/\.([a-z0-9]+)\.png$/)[1]];
  if (!fs.existsSync(a)) { results.push({ file: f, name, view, status: 'base無し' }); continue; }
  const r = await page.evaluate(async ([da, db]) => {
    function load(src) { return new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = src; }); }
    const [ia, ib] = await Promise.all([load(da), load(db)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { same: false, size: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
    const w = ia.width, h = ia.height;
    const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
    const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
    const xa = ca.getContext('2d', { willReadFrequently: true }), xb = cb.getContext('2d', { willReadFrequently: true });
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const pa = xa.getImageData(0, 0, w, h).data, pb = xb.getImageData(0, 0, w, h).data;
    let n = 0, minY = h, maxY = -1, minX = w, maxX = -1;
    const diff = xb.createImageData(w, h); const pd = diff.data;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) + Math.abs(pa[i + 3] - pb[i + 3]);
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      if (d > 0) { n++; pd[i] = 255; pd[i + 1] = 0; pd[i + 2] = 0; pd[i + 3] = 255; if (py < minY) minY = py; if (py > maxY) maxY = py; if (px < minX) minX = px; if (px > maxX) maxX = px; }
      else { const g = Math.round((pb[i] + pb[i + 1] + pb[i + 2]) / 3); pd[i] = g; pd[i + 1] = g; pd[i + 2] = g; pd[i + 3] = 60; }
    }
    if (!n) return { same: true, size: false, w, h };
    xb.putImageData(diff, 0, 0);
    return { same: false, size: false, w, h, n, box: [minX, minY, maxX, maxY], png: cb.toDataURL('image/png') };
  }, [toDataUrl(a), toDataUrl(b)]);
  const row = { file: f, name, view, status: r.same ? '一致' : (r.size ? '大きさが違う' : '違いあり'), pixels: r.n || 0, box: r.box || null, size: r.size ? { base: r.a, head: r.b } : null };
  if (r.png) { const p = path.join(outDir, f.replace(/\.png$/, '.diff.png')); fs.writeFileSync(p, Buffer.from(r.png.split(',')[1], 'base64')); row.diff = p; }
  results.push(row);
}

const mb = readJson(path.join(baseDir, 'metrics.json'), { pages: {} }), mh = readJson(path.join(headDir, 'metrics.json'), { pages: {} });
const printRows = [];
for (const file of Object.keys(mh.pages)) {
  if (!mb.pages[file]) continue;   // 直す前に無い画面は比べない
  const pb = mb.pages[file].printPages, ph = mh.pages[file].printPages;
  printRows.push({ file, base: pb == null ? null : pb, head: ph == null ? null : ph, same: pb === ph });
}

/* 画面の JS エラー（撮影時の pageerror）が直した後で増えていないか */
const errRows = [];
for (const file of Object.keys(mh.pages)) {
  const eb = mb.pages[file] ? Object.values(mb.pages[file].errors || {}).flat() : [];
  const eh = Object.values(mh.pages[file].errors || {}).flat();
  const added = eh.filter((e) => !eb.includes(e));
  if (added.length) errRows.push({ file, added });
}

/* 報告（CLAUDE.md §6 の言い方で） */
let fail = 0;
const lines = [];
if (!results.some((r) => r.status !== 'base無し')) { console.log('比べられる画面が1つもありません（直す前の撮影が無い）'); process.exit(1); }
/* 撮れているはずの PNG（画面×4表示）が揃っているか。無い分を「一致」に数えない */
const expected = [];
for (const file of Object.keys(mh.pages)) for (const v of ['pc', 'print', 'ph100', 'ph200']) expected.push(`${file.replace(/\.html$/, '')}.${v}.png`);
const missingPng = expected.filter((f) => !fs.existsSync(path.join(headDir, f)));
if (missingPng.length) { lines.push(`撮れていない画面がある（${missingPng.join('、')}）`); fail++; }
const byView = (v) => results.filter((r) => r.view === v);
const missing = results.filter((r) => r.status === 'base無し').map((r) => r.name).filter((v, i, a) => a.indexOf(v) === i);
if (missing.length) lines.push(`直す前に無い画面（新しい画面＝比べない）: ${missing.join('、')}`);
for (const v of ['pc', 'print', 'ph100', 'ph200']) {
  const rows = byView(v).filter((r) => r.status !== 'base無し');
  const changed = rows.filter((r) => r.status !== '一致');
  const label = { pc: 'PC の画面', print: '印刷の見た目', ph100: 'iPhone 100%', ph200: 'iPhone 200%' }[v];
  if (!changed.length) lines.push(`${label}: ${rows.length}画面すべて画素一致`);
  else {
    lines.push(`${label}: ${rows.length - changed.length}画面は画素一致・${changed.length}画面に違い（${changed.map((r) => r.name + (allow.has(r.name) ? '〔許可〕' : '') + (r.pixels ? ` ${r.pixels}px` : '')).join('、')}）`);
    if (v === 'pc' || v === 'print') fail += changed.filter((r) => !allow.has(r.name)).length;
  }
}
const totalPages = printRows.reduce((s, r) => s + (r.head || 0), 0);
const pageDiff = printRows.filter((r) => !r.same);
lines.push(pageDiff.length ? `印刷ページ数: 違いあり（${pageDiff.map((r) => `${r.file} ${r.base}→${r.head}`).join('、')}）` : `印刷ページ数: 全${totalPages}ページ一致`);
if (pageDiff.some((r) => !allow.has(r.file.replace(/\.html$/, '')))) fail++;
if (errRows.length) { lines.push(`画面のエラー: 直した後で増えた（${errRows.map((r) => `${r.file}: ${r.added.join(' / ').slice(0, 120)}`).join('、')}）`); fail++; }
else lines.push('画面のエラー: 直す前から増えていない');

console.log(lines.join('\n'));
writeJson(path.join(outDir, 'compare.json'), { base: baseDir, head: headDir, allow: [...allow], results, printRows, lines, fail });
fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
await browser.close();
process.exit(fail ? 1 : 0);

function toDataUrl(file) { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); }
