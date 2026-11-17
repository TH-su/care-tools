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
 * 縦に長い絵（2026-11-17 追加）: 絵は 2048 行ずつの帯に分けて比べる（1枚を丸ごと canvas に載せると、縦に長い絵は載らずに「一致」と出ていた）。
 *   snap.mjs が区切って撮った絵（<画面>.<表示>.t01.png…）は区切りごとに比べ、画面・表示ごとに1行にまとめる（違った区切りの番号と画素数を書く）。
 *   直す前と後で撮り方が違う（1枚と区切り・区切りの数が違う）時は「撮り方が違う（高さが変わった）」として違いに数える（合否の決まりは今までどおり）。
 *   絵を読めない時は「一致」と言わず失敗にする。
 *
 * 直す前を撮れなかった画面・帳票（2026-11-17 追加）: 直した後に絵があって直す前に無い時、今までは全部「新しい画面＝比べない」で通っていた。
 *   直す前の metrics.json にその画面・帳票の記録がある（撮ろうとして絵が残らなかった）時は「直す前を撮れなかった（比べていない）」として、
 *   pc・印刷・帳票では失敗にする（iPhone は今までどおり報告だけ・--allow の画面は〔許可〕で失敗に数えない）。
 *   本当に新しく足した画面・帳票（直す前の記録に無い・帳票は直す前の木に材料が無い）だけを「新しい」と出す。分け方は compare-calc.mjs。
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
import { baseMissingKind, baseShotReason } from './compare-calc.mjs';

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

/* 2枚の PNG を画素で比べる（違う画素の数・範囲・赤で塗った差分画像）。
   絵は高さ BAND 行ずつの細い帯に分けて小さな canvas に描いて比べる（2026-11-17）。
   1枚を丸ごと canvas に載せると、縦に長い絵（例: 780×約78,000 画素）は canvas に載らず、どの画素も 0 のまま読めて「一致」と出ていたため。
   差分画像は、高さ DIFF_MAX_H 以下なら今までどおり絵と同じ大きさの1枚、それより高い絵（と1枚に描けなかった時）は違いの範囲の上から CROP_H 行だけを切り出す（crop に範囲）。
   DIFF_MAX_H は実測（2026-11-17・手元の Chromium）: 高さ 65,535 までの canvas は読み書きでき、65,536 以上は何も描けずに 0 のまま読める
   帯が読めない（幅・高さが 0、帯の全画素が透明）時は「一致」と言わず error を返す */
const BAND = 2048, DIFF_MAX_H = 65535, CROP_H = 16384;
function diffPng(a, b) {
  return page.evaluate(async ([da, db, tol, BAND, MAXH, CROP_H]) => {
    function load(src) { return new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = src; }); }
    let ia, ib;
    try { [ia, ib] = await Promise.all([load(da), load(db)]); } catch (e) { return { same: false, size: false, error: '絵を読めない' }; }
    if (ia.width !== ib.width || ia.height !== ib.height) return { same: false, size: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
    const w = ia.width, h = ia.height;
    if (!w || !h) return { same: false, size: false, error: '絵を読めない' };
    const ca = document.createElement('canvas'); ca.width = w; ca.height = Math.min(BAND, h);
    const cb = document.createElement('canvas'); cb.width = w; cb.height = Math.min(BAND, h);
    const xa = ca.getContext('2d', { willReadFrequently: true }), xb = cb.getContext('2d', { willReadFrequently: true });
    if (!xa || !xb) return { same: false, size: false, error: '帯の canvas を作れない' };
    /* y0〜y1 の行を帯ごとに比べる。out があれば差分の色を out の (行 − oy) に描く */
    function scan(y0, y1, out, oy) {
      let n = 0, minY = h, maxY = -1, minX = w, maxX = -1, bad = false;
      for (let by = y0; by < y1; by += BAND) {
        const bh = Math.min(BAND, y1 - by);
        xa.clearRect(0, 0, w, BAND); xb.clearRect(0, 0, w, BAND);
        xa.drawImage(ia, 0, by, w, bh, 0, 0, w, bh); xb.drawImage(ib, 0, by, w, bh, 0, 0, w, bh);
        const pa = xa.getImageData(0, 0, w, bh).data, pb = xb.getImageData(0, 0, w, bh).data;
        const diff = out ? out.ctx.createImageData(w, bh) : null; const pd = diff ? diff.data : null;
        let seen = false;
        for (let i = 0; i < pa.length; i += 4) {
          if (pa[i + 3] || pb[i + 3]) seen = true;
          const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3]));
          const px = (i / 4) % w, py = by + Math.floor((i / 4) / w);
          if (d > tol) { n++; if (pd) { pd[i] = 255; pd[i + 1] = 0; pd[i + 2] = 0; pd[i + 3] = 255; } if (py < minY) minY = py; if (py > maxY) maxY = py; if (px < minX) minX = px; if (px > maxX) maxX = px; }
          else if (pd) { const g = Math.round((pb[i] + pb[i + 1] + pb[i + 2]) / 3); pd[i] = g; pd[i + 1] = g; pd[i + 2] = g; pd[i + 3] = 60; }
        }
        if (!seen) bad = true;   // 帯の全画素が透明＝描けていない（撮った絵は不透明なので、本物の絵ではまず起きない）
        if (diff) out.ctx.putImageData(diff, 0, by - oy);
      }
      return { n, box: [minX, minY, maxX, maxY], bad };
    }
    const full = h <= MAXH;
    let out = null;
    if (full) { const c = document.createElement('canvas'); c.width = w; c.height = h; out = { c, ctx: c.getContext('2d') }; }
    const r = scan(0, h, out, 0);
    if (r.bad) return { same: false, size: false, error: '帯を読めない（全画素が透明）', w, h };
    if (!r.n) return { same: true, size: false, w, h };
    let crop = null, png = full ? out.c.toDataURL('image/png') : '';
    if (png.length <= 6) {   // 高すぎる絵・1枚に描けなかった時は、違いの範囲の上から CROP_H 行だけ
      const y0 = Math.max(0, r.box[1] - 200), y1 = Math.min(h, y0 + CROP_H);
      const c = document.createElement('canvas'); c.width = w; c.height = y1 - y0; out = { c, ctx: c.getContext('2d') };
      scan(y0, y1, out, y0); crop = [y0, y1]; png = out.c.toDataURL('image/png');
    }
    return { same: false, size: false, w, h, n: r.n, box: r.box, crop, png: png.length > 6 ? png : null };
  }, [toDataUrl(a), toDataUrl(b), TOL, BAND, DIFF_MAX_H, CROP_H]);
}
const statusOf = (r) => (r.error ? '読めない' : r.same ? '一致' : (r.size ? '大きさが違う' : '違いあり'));

/* 撮った絵を、画面・表示ごとにまとめる。<名前>.<表示>.png（1枚）か <名前>.<表示>.t01.png…（縦に長すぎて区切って撮った絵・snap.mjs の fullShot） */
const TILE_RE = /^(.+)\.([a-z0-9]+)\.t(\d+)\.png$/, ONE_RE = /^(.+)\.([a-z0-9]+)\.png$/;
function shotGroups(dir) {
  const g = new Map();
  if (!fs.existsSync(dir)) return g;
  for (const f of fs.readdirSync(dir)) {
    const t = f.match(TILE_RE), o = t ? null : f.match(ONE_RE);
    const m = t || o; if (!m) continue;
    const k = `${m[1]}.${m[2]}`;
    const e = g.get(k) || { name: m[1], view: m[2], one: null, tiles: [] };
    if (t) e.tiles.push({ n: Number(t[3]), f }); else e.one = f;
    g.set(k, e);
  }
  for (const e of g.values()) e.tiles.sort((x, y) => x.n - y.n);
  return g;
}
/* 撮り方: 「1枚」か「N区切り」。番号の欠け・1枚との混在は撮り方が崩れている＝比べずに違いとして出す */
function shapeOf(e) {
  if (!e) return null;
  if (e.one && e.tiles.length) return '1枚と区切りが混在';
  if (e.one) return '1枚';
  if (e.tiles.some((t, i) => t.n !== i + 1)) return '区切りの番号が欠けている';
  return `${e.tiles.length}区切り`;
}
/* その画面・表示の絵があるか（1枚か区切りの1枚目） */
const hasShot = (dir, stem) => fs.existsSync(path.join(dir, `${stem}.png`)) || fs.existsSync(path.join(dir, `${stem}.t01.png`));
function keepPair(a, b, f) {   // 違った絵は、前・後の撮影も並べて置く（差分画像だけでは何が変わったか分かりにくいため）
  try { fs.copyFileSync(a, path.join(outDir, f.replace(/\.png$/, '.before.png'))); fs.copyFileSync(b, path.join(outDir, f.replace(/\.png$/, '.after.png'))); } catch (e) { /* 置けなくても比較は続ける */ }
}
function saveDiff(r, f) { if (!r.png) return null; const p = path.join(outDir, f.replace(/\.png$/, '.diff.png')); fs.writeFileSync(p, Buffer.from(r.png.split(',')[1], 'base64')); return p; }

const gBase = shotGroups(baseDir), gHead = shotGroups(headDir);
const results = [];
for (const k of [...gHead.keys()].sort()) {
  const eh = gHead.get(k), eb = gBase.get(k);
  const { name, view } = eh;
  const sb0 = shapeOf(eb), sh0 = shapeOf(eh);
  const label = eh.one && !eh.tiles.length ? eh.one : `${k}.t*.png`;
  if (!eb) { results.push({ file: label, name, view, status: 'base無し' }); continue; }
  /* 撮り方が違う（1枚と区切り・区切りの数が違う）＝画面の高さが変わった。比べずに違いとして数える */
  if (sb0 !== sh0 || !/^(1枚|\d+区切り)$/.test(sh0)) {
    results.push({ file: label, name, view, status: '撮り方が違う', pixels: 0, shape: { base: sb0, head: sh0 } });
    continue;
  }
  if (eh.one) {
    const f = eh.one, a = path.join(baseDir, f), b = path.join(headDir, f);
    const r = await diffPng(a, b);
    const row = { file: f, name, view, status: statusOf(r), pixels: r.n || 0, box: r.box || null, size: r.size ? { base: r.a, head: r.b } : null };
    if (r.crop) row.diffCrop = r.crop;
    const d = saveDiff(r, f); if (d) row.diff = d;
    if (!r.same) keepPair(a, b, f);
    results.push(row);
    continue;
  }
  /* 区切りごとに比べ、画面・表示ごとに1行にまとめる */
  const tiles = [];
  for (const t of eh.tiles) {
    const a = path.join(baseDir, t.f), b = path.join(headDir, t.f);
    const r = await diffPng(a, b);
    const tr = { t: t.n, status: statusOf(r), pixels: r.n || 0, box: r.box || null, size: r.size ? { base: r.a, head: r.b } : null };
    const d = saveDiff(r, t.f); if (d) tr.diff = d;
    if (!r.same) { keepPair(a, b, t.f); tiles.push(tr); }
  }
  const worst = ['読めない', '大きさが違う', '違いあり'].find((s) => tiles.some((t) => t.status === s)) || '一致';
  results.push({ file: label, name, view, status: worst, pixels: tiles.reduce((s, t) => s + t.pixels, 0), tileCount: eh.tiles.length, tiles });
}

const mbRaw = readJson(path.join(baseDir, 'metrics.json'), null);   // 読めない時は null（新しい画面とは言えない・compare-calc.mjs）
const mb = mbRaw && mbRaw.pages ? mbRaw : { pages: {} }, mh = readJson(path.join(headDir, 'metrics.json'), { pages: {} });
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
      const row = { name: key, page: i + 1, status: statusOf(r), pixels: r.n || 0, box: r.box || null };
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
const missingPng = expected.filter((f) => !hasShot(headDir, f.replace(/\.png$/, '')));   // 区切って撮った画面は t01 があれば撮れている
if (missingPng.length) { lines.push(`撮れていない画面がある（${missingPng.join('、')}）`); fail++; }
/* 帳票: 直す前に撮れていたのに、直した後で撮れなかったもの（直す前から撮れない帳票は比べられないと書くだけ） */
const lostSheets = Object.keys(sb).filter((k) => hasShot(baseDir, `${k}.print`) && !hasShot(headDir, `${k}.print`));
if (lostSheets.length) { lines.push(`帳票の印刷: 直した後で撮れなくなった（${lostSheets.join('、')}）`); fail++; }
/* 直す前に絵が無いのは、本当に新しいからか、直す前を撮れなかったからか（compare-calc.mjs）。撮れなかった分は比べずに違いとして数える */
for (const r of results) {
  if (r.status !== 'base無し' || baseMissingKind(r.name, isSheet(r.name), mbRaw) !== 'unshot') continue;
  r.status = '直す前を撮れなかった'; r.pixels = 0; r.reason = baseShotReason(r.name, isSheet(r.name), r.view, mbRaw);
}
const noBaseSheets = Object.keys(sh).filter((k) => !hasShot(baseDir, `${k}.print`) && hasShot(headDir, `${k}.print`) && baseMissingKind(k, true, mbRaw) === 'new');
/* 直した後の材料にあるのに、直す前・直した後のどちらでも撮れなかった帳票（新しい帳票も含む・比べていない） */
const bothLostSheets = Object.keys(sh).filter((k) => !hasShot(baseDir, `${k}.print`) && !hasShot(headDir, `${k}.print`));
if (bothLostSheets.length) { lines.push(`帳票の印刷: 直す前も直した後も撮れず比べていない（${bothLostSheets.join('、')}）`); fail++; }
const byView = (v) => results.filter((r) => r.view === v);
/* 違いの中身の補足: 撮り方が違う・区切りのどこが違うか・読めなかった */
function detail(r) {
  if (r.status === '直す前を撮れなかった') return `（直す前を撮れなかった＝比べていない: ${r.reason}）`;
  if (r.status === '撮り方が違う') return `（撮り方が違う＝高さが変わった: ${r.shape.base}→${r.shape.head}）`;
  if (r.tiles) return `（${r.tileCount}区切りのうち ${r.tiles.map((t) => `t${String(t.t).padStart(2, '0')}${t.status === '違いあり' ? (t.pixels ? ` ${t.pixels}px` : '') : ' ' + t.status}`).join('・')}）`;
  if (r.status === '読めない') return '（絵を読めない）';
  return '';
}
const missing = results.filter((r) => r.status === 'base無し' && !isSheet(r.name)).map((r) => r.name).filter((v, i, a) => a.indexOf(v) === i);
if (missing.length) lines.push(`直す前に無い画面（新しい画面＝比べない）: ${missing.join('、')}`);
for (const v of ['pc', 'print', 'sheet', 'ph100', 'ph200']) {
  const rows = (v === 'sheet' ? byView('print').filter((r) => isSheet(r.name)) : byView(v).filter((r) => !isSheet(r.name))).filter((r) => r.status !== 'base無し');
  if (v === 'sheet' && !rows.length && !noBaseSheets.length) continue;   // 帳票の材料がある画面を撮っていない時は行を出さない
  const changed = rows.filter((r) => r.status !== '一致');
  const label = { pc: 'PC の画面', print: '印刷の見た目', sheet: '帳票の印刷（架空データ）', ph100: 'iPhone 100%', ph200: 'iPhone 200%' }[v];
  const unit = v === 'sheet' ? '枚' : '画面';
  const extra = v === 'sheet' && noBaseSheets.length ? `（新しい帳票＝直す前に材料が無く比べていない: ${noBaseSheets.join('、')}）` : '';
  if (!changed.length) lines.push(`${label}: ${rows.length}${unit}すべて画素一致${TOL ? '（色の揺れ±' + TOL + '以内は同じとみなす）' : ''}${extra}`);
  else {
    lines.push(`${label}: ${rows.length - changed.length}${unit}は画素一致・${changed.length}${unit}に違い（${changed.map((r) => r.name + (allowed(r.name) ? '〔許可〕' : '') + (r.pixels ? ` ${r.pixels}px` : '') + detail(r)).join('、')}）${extra}`);
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
/* 絵を読めなかった（帯が描けない等）は、どの表示でも道具の失敗＝「一致」と言わず失敗にする */
if (results.some((r) => r.status === '読めない' || (r.tiles || []).some((t) => t.status === '読めない')) || pageRows.some((r) => r.status === '読めない')) fail++;
if (errRows.length) { lines.push(`画面のエラー: 直した後で増えた（${errRows.map((r) => `${r.file}: ${r.added.join(' / ').slice(0, 120)}`).join('、')}）`); fail++; }
else lines.push('画面のエラー: 直す前から増えていない');

console.log(lines.join('\n'));
writeJson(path.join(outDir, 'compare.json'), { base: baseDir, head: headDir, allow: [...allow], results, pageRows, printRows, lines, fail });
fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
await browser.close();
process.exit(fail ? 1 : 0);

function toDataUrl(file) { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); }
