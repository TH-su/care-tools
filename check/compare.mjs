/* check/compare.mjs — 直す前（base）と直した後（head）の撮影を画素で見比べる（2026-10-04 新設）
 *
 *   node check/compare.mjs --base check/out/base --head check/out/head [--out check/out/compare] [--allow a.html,b.html] [--tol 2]
 *
 * ・同じ名前の PNG を1枚ずつ比べ、違う画素の数を数える。違いがあれば赤で塗った差分画像を out に置く
 * ・印刷ページ数（metrics.json）も見比べる
 * ・--allow に挙げた画面は「変えてよい画面」＝違いがあっても失敗にしない（PC・印刷とも）
 * ・終了コード: 許可していない画面の PC か印刷に違いがあれば 1、無ければ 0
 *   iPhone（ph100/ph200）の違いは報告だけ（終了コードに入れない。幅の条件つきの直しで変わるのが普通のため）
 *
 * 比べ方は Node に画像ライブラリを入れず、Chromium の canvas で行う（依存を増やさない）。
 *
 * 帳票の紙（2026-10-26 追加）: snap.mjs が架空データで撮った <画面>__<帳票>.print.png も同じく比べる。
 *   「帳票の印刷（架空データ）」の行に分けて出す。--allow に画面を挙げると、その画面の帳票も「変えてよい」。
 *   帳票の印刷ページ数も見比べる。直した後で撮れなくなった帳票は失敗にする（撮れないまま「一致」と言わない）。
 *
 * 帳票の PDF をページごとに（2026-11-14 追加）: 上の帳票の絵は改ページの無い1枚の絵なので、改ページの位置（break-inside など）の直しが見えない。
 *   そこで snap.mjs が残した <画面>__<帳票>.pdf を、直す前・後とも pdftoppm（poppler）で1ページずつ絵にして、同じ番号のページどうしを比べる。
 *   「帳票の印刷（PDF のページごと）」の行に出す。--allow の扱いは帳票の絵と同じ。違ったページの差分画像は <帳票>.p<番号>.diff.png。
 *   pdftoppm が無い時は「未実施」と出し、「一致」とは言わない（環境変数 SU_REQUIRE_PDFTOPPM=1 の時は失敗にする＝CI）。
 *
 * ★色の揺れ（--tol・既定 2）: 1画素の赤・緑・青のどれもが 2 以内しか違わない時は「同じ」とみなす。
 *   角の丸み・文字のにじみの描き方が撮るたびに 1 だけずれることがある（2026-10-04 実測: 消耗品管理の角で ±1）。
 *   位置・形・文字が変わると差は数十〜二百になるので、この幅で本当の違いを見落とすことはない。
 *   結果の文には必ず「色の揺れ±2以内は同じとみなす」と書く（やっていないことを書かないため）。--tol 0 で完全一致だけを見る。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPlaywright, parseArgs, ensureDir, readJson, writeJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const baseDir = path.resolve(args.base || 'check/out/base');
const headDir = path.resolve(args.head || 'check/out/head');
const outDir = ensureDir(path.resolve(args.out || 'check/out/compare'));
const TOL = Math.max(0, Number(args.tol == null ? 2 : args.tol) || 0);
const allow = new Set((args.allow ? String(args.allow).split(',') : []).map((s) => s.trim().replace(/\.html$/, '')).filter(Boolean));
/* 帳票（<画面>__<帳票>）は、その画面を許していれば許す */
const allowed = (name) => allow.has(name) || allow.has(String(name).split('__')[0]);
const isSheet = (name) => String(name).includes('__');

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();

/* 2枚の PNG を画素で比べる（違う画素の数・範囲・赤で塗った差分画像） */
function diffPng(a, b) {
  return page.evaluate(async ([da, db, tol]) => {
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
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3]));
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      if (d > tol) { n++; pd[i] = 255; pd[i + 1] = 0; pd[i + 2] = 0; pd[i + 3] = 255; if (py < minY) minY = py; if (py > maxY) maxY = py; if (px < minX) minX = px; if (px > maxX) maxX = px; }
      else { const g = Math.round((pb[i] + pb[i + 1] + pb[i + 2]) / 3); pd[i] = g; pd[i + 1] = g; pd[i + 2] = g; pd[i + 3] = 60; }
    }
    if (!n) return { same: true, size: false, w, h };
    xb.putImageData(diff, 0, 0);
    return { same: false, size: false, w, h, n, box: [minX, minY, maxX, maxY], png: cb.toDataURL('image/png') };
  }, [toDataUrl(a), toDataUrl(b), TOL]);
}

const files = fs.readdirSync(headDir).filter((f) => f.endsWith('.png')).sort();
const results = [];
for (const f of files) {
  const a = path.join(baseDir, f), b = path.join(headDir, f);
  const [name, view] = [f.replace(/\.[a-z0-9]+\.png$/, ''), f.match(/\.([a-z0-9]+)\.png$/)[1]];
  if (!fs.existsSync(a)) { results.push({ file: f, name, view, status: 'base無し' }); continue; }
  const r = await diffPng(a, b);
  const row = { file: f, name, view, status: r.same ? '一致' : (r.size ? '大きさが違う' : '違いあり'), pixels: r.n || 0, box: r.box || null, size: r.size ? { base: r.a, head: r.b } : null };
  if (r.png) { const p = path.join(outDir, f.replace(/\.png$/, '.diff.png')); fs.writeFileSync(p, Buffer.from(r.png.split(',')[1], 'base64')); row.diff = p; }
  if (!r.same) {   // 違った画面は、前・後の撮影も並べて置く（差分画像だけでは何が変わったか分かりにくいため）
    try { fs.copyFileSync(a, path.join(outDir, f.replace(/\.png$/, '.before.png'))); fs.copyFileSync(b, path.join(outDir, f.replace(/\.png$/, '.after.png'))); } catch (e) { /* 置けなくても比較は続ける */ }
  }
  results.push(row);
}

const mb = readJson(path.join(baseDir, 'metrics.json'), { pages: {} }), mh = readJson(path.join(headDir, 'metrics.json'), { pages: {} });
const printRows = [];
for (const file of Object.keys(mh.pages)) {
  if (!mb.pages[file]) continue;   // 直す前に無い画面は比べない
  const pb = mb.pages[file].printPages, ph = mh.pages[file].printPages;
  printRows.push({ file, base: pb == null ? null : pb, head: ph == null ? null : ph, same: pb === ph });
}
/* 帳票の印刷ページ数（直す前に撮れていた帳票だけ比べる） */
const sb = mb.sheets || {}, sh = mh.sheets || {};
for (const key of Object.keys(sh)) {
  if (!sb[key] || sb[key].printPages == null) continue;
  const pb = sb[key].printPages, ph = sh[key].printPages;
  printRows.push({ file: key, base: pb, head: ph == null ? null : ph, same: pb === ph });
}

/* 画面の JS エラー（撮影時の pageerror）が直した後で増えていないか */
const errRows = [];
for (const file of Object.keys(mh.pages)) {
  const eb = mb.pages[file] ? Object.values(mb.pages[file].errors || {}).flat() : [];
  const eh = Object.values(mh.pages[file].errors || {}).flat();
  const added = eh.filter((e) => !eb.includes(e));
  if (added.length) errRows.push({ file, added });
}
for (const key of Object.keys(sh)) {
  const eb = sb[key] ? (sb[key].errors || []) : [];
  const added = (sh[key].errors || []).filter((e) => !eb.includes(e));
  if (added.length) errRows.push({ file: key, added });
}

/* 帳票の PDF をページごとに絵にして比べる（改ページの位置の直しを見るため・2026-11-14）。
   直す前・後の両方に PDF がある帳票だけ。ページの数が違う時は、両方にある番号のページだけ比べ、数の違いは上の「印刷ページ数」の行で失敗にする */
const PDF_DPI = 60;   // A4 縦で約 500×700 画素。改ページの位置が変われば数万画素の違いになり、この粗さで見落とさない
const hasPdftoppm = !spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' }).error;
const pageRows = [];
const pageSheets = Object.keys(sh).filter((k) => fs.existsSync(path.join(baseDir, `${k}.pdf`)) && fs.existsSync(path.join(headDir, `${k}.pdf`))).sort();
let pageError = '';
const pageShort = [];   // ページの数が違い、先頭の分だけ比べた帳票（数の違いは「印刷ページ数」の行が別に失敗にする）
function rasterize(pdf, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); ensureDir(dir);
  const r = spawnSync('pdftoppm', ['-r', String(PDF_DPI), '-png', pdf, path.join(dir, 'p')], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) return null;
  /* 名前は p-1.png か p-01.png（ページ数の桁で変わる）。番号の順に並べる */
  return fs.readdirSync(dir).filter((f) => /^p-\d+\.png$/.test(f)).sort((x, y) => Number(x.match(/\d+/)[0]) - Number(y.match(/\d+/)[0])).map((f) => path.join(dir, f));
}
if (hasPdftoppm) {
  for (const key of pageSheets) {
    const pa = rasterize(path.join(baseDir, `${key}.pdf`), path.join(outDir, 'pdfpages', 'base', key));
    const pb = rasterize(path.join(headDir, `${key}.pdf`), path.join(outDir, 'pdfpages', 'head', key));
    if (!pa || !pb || !pa.length || !pb.length) { pageError += (pageError ? '、' : '') + key; continue; }
    const n = Math.min(pa.length, pb.length);
    if (pa.length !== pb.length) pageShort.push(`${key} ${pa.length}→${pb.length}ページ・先頭${n}ページだけ`);
    for (let i = 0; i < n; i++) {
      const r = await diffPng(pa[i], pb[i]);
      const row = { name: key, page: i + 1, status: r.same ? '一致' : (r.size ? '大きさが違う' : '違いあり'), pixels: r.n || 0, box: r.box || null };
      if (!r.same) {
        const stem = path.join(outDir, `${key}.p${i + 1}`);
        if (r.png) { fs.writeFileSync(stem + '.diff.png', Buffer.from(r.png.split(',')[1], 'base64')); row.diff = stem + '.diff.png'; }
        try { fs.copyFileSync(pa[i], stem + '.before.png'); fs.copyFileSync(pb[i], stem + '.after.png'); } catch (e) { /* 置けなくても比較は続ける */ }
      }
      pageRows.push(row);
    }
  }
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
/* 帳票: 直す前に撮れていたのに、直した後で撮れなかったもの（直す前から撮れない帳票は比べられないと書くだけ） */
const lostSheets = Object.keys(sb).filter((k) => fs.existsSync(path.join(baseDir, `${k}.print.png`)) && !fs.existsSync(path.join(headDir, `${k}.print.png`)));
if (lostSheets.length) { lines.push(`帳票の印刷: 直した後で撮れなくなった（${lostSheets.join('、')}）`); fail++; }
const noBaseSheets = Object.keys(sh).filter((k) => !fs.existsSync(path.join(baseDir, `${k}.print.png`)));
const byView = (v) => results.filter((r) => r.view === v);
const missing = results.filter((r) => r.status === 'base無し' && !isSheet(r.name)).map((r) => r.name).filter((v, i, a) => a.indexOf(v) === i);
if (missing.length) lines.push(`直す前に無い画面（新しい画面＝比べない）: ${missing.join('、')}`);
for (const v of ['pc', 'print', 'sheet', 'ph100', 'ph200']) {
  const rows = (v === 'sheet' ? byView('print').filter((r) => isSheet(r.name)) : byView(v).filter((r) => !isSheet(r.name))).filter((r) => r.status !== 'base無し');
  if (v === 'sheet' && !rows.length && !noBaseSheets.length) continue;   // 帳票の材料がある画面を撮っていない時は行を出さない
  const changed = rows.filter((r) => r.status !== '一致');
  const label = { pc: 'PC の画面', print: '印刷の見た目', sheet: '帳票の印刷（架空データ）', ph100: 'iPhone 100%', ph200: 'iPhone 200%' }[v];
  const unit = v === 'sheet' ? '枚' : '画面';
  const extra = v === 'sheet' && noBaseSheets.length ? `（直す前に撮れず比べていない: ${noBaseSheets.join('、')}）` : '';
  if (!changed.length) lines.push(`${label}: ${rows.length}${unit}すべて画素一致${TOL ? '（色の揺れ±' + TOL + '以内は同じとみなす）' : ''}${extra}`);
  else {
    lines.push(`${label}: ${rows.length - changed.length}${unit}は画素一致・${changed.length}${unit}に違い（${changed.map((r) => r.name + (allowed(r.name) ? '〔許可〕' : '') + (r.pixels ? ` ${r.pixels}px` : '')).join('、')}）${extra}`);
    if (v === 'pc' || v === 'print' || v === 'sheet') fail += changed.filter((r) => !allowed(r.name)).length;
  }
}
/* 帳票の PDF のページごと（帳票を撮っていない時は行を出さない） */
if (pageSheets.length) {
  const label = '帳票の印刷（PDF のページごと）';
  if (!hasPdftoppm) {
    lines.push(`${label}: 未実施（PDF を絵にする道具 pdftoppm が無い・改ページの位置は比べていない）`);
    if (process.env.SU_REQUIRE_PDFTOPPM === '1') fail++;
  } else {
    const changed = pageRows.filter((r) => r.status !== '一致');
    const tolNote = TOL ? '（色の揺れ±' + TOL + '以内は同じとみなす）' : '';
    const errNote = (pageError ? `（絵にできず比べていない: ${pageError}）` : '') + (pageShort.length ? `（ページの数が違い比べたのは一部: ${pageShort.join('、')}）` : '');
    const nSheets = new Set(pageRows.map((r) => r.name)).size;
    /* 比べていない分がある時は「すべて一致」と言わない */
    if (!pageRows.length) lines.push(`${label}: 未実施（比べられたページが無い）${errNote}`);
    else if (!changed.length) lines.push(pageError || pageShort.length ? `${label}: 比べた${nSheets}枚・計${pageRows.length}ページは画素一致${tolNote}${errNote}` : `${label}: ${nSheets}枚・計${pageRows.length}ページすべて画素一致${tolNote}`);
    else {
      lines.push(`${label}: ${pageRows.length - changed.length}ページは画素一致・${changed.length}ページに違い（${changed.map((r) => `${r.name}${allowed(r.name) ? '〔許可〕' : ''} ${r.page}ページ目${r.pixels ? ` ${r.pixels}px` : ''}`).join('、')}）${tolNote}${errNote}`);
      fail += changed.filter((r) => !allowed(r.name)).length;
    }
    if (pageError || !pageRows.length) fail++;   // 道具はあるのに絵にできない＝撮れていないのと同じ扱い（一致と言わない）
  }
}
const totalPages = printRows.reduce((s, r) => s + (r.head || 0), 0);
const pageDiff = printRows.filter((r) => !r.same);
lines.push(pageDiff.length ? `印刷ページ数: 違いあり（${pageDiff.map((r) => `${r.file} ${r.base}→${r.head}`).join('、')}）` : `印刷ページ数: 全${totalPages}ページ一致`);
if (pageDiff.some((r) => !allowed(r.file.replace(/\.html$/, '')))) fail++;
if (errRows.length) { lines.push(`画面のエラー: 直した後で増えた（${errRows.map((r) => `${r.file}: ${r.added.join(' / ').slice(0, 120)}`).join('、')}）`); fail++; }
else lines.push('画面のエラー: 直す前から増えていない');

console.log(lines.join('\n'));
writeJson(path.join(outDir, 'compare.json'), { base: baseDir, head: headDir, allow: [...allow], results, pageRows, printRows, lines, fail });
fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
await browser.close();
process.exit(fail ? 1 : 0);

function toDataUrl(file) { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); }
