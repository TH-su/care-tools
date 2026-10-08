/* check/snap.mjs — 全画面のスクリーンショットと印刷の採寸を撮る（2026-10-04 新設）
 *
 *   node check/snap.mjs --out check/out/head [--dir .] [--pages a.html,b.html] [--hide-report]
 *
 * 撮るもの（画面ごと）:
 *   <画面>.pc.png     … PC（幅1280）全体
 *   <画面>.ph100.png  … iPhone（幅390・表示100%）全体
 *   <画面>.ph200.png  … iPhone・表示200%（CSS幅195）全体
 *   <画面>.print.png  … 印刷の見た目（@media print を当てた画面）全体
 *   <画面>.pdf        … 印刷の PDF（ページ数を metrics.json に残す）
 *   metrics.json      … 横はみ出し（scrollWidth − 画面幅）・印刷ページ数・画面のエラー数
 *
 * 架空データ専用。接続先が無い状態（＝公開リポジトリをそのまま開いた状態）で撮る。本番の接続先は読まない。
 * 時計は固定（lib.FIXED_TIME）。--hide-report は「不具合を報告」ボタンを消して撮る（ボタン以外の画素一致を確かめる時）。
 *
 * --repeat N（既定 1）: 各表示を新しいブラウザで N 回撮り、いちばん多かった絵を残す（揺れの確かめ・run.mjs が違いの出た画面だけに使う）。
 *   画面全体を撮る時だけ、入力欄・選択欄の文字の描き方がまれに入れ替わることがある（2026-10-04 実測: 貼り薬カレンダーの iPhone 幅で約1割）。
 *   どの絵が何回出たかは metrics.json の wobble に残す。
 * --merge: 出力先の metrics.json を消さず、撮った画面の分だけ書き換える（一部の画面の撮り直し用）。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { loadPlaywright, listPages, parseArgs, startServer, pdfPages, ensureDir, writeJson, FIXED_TIME } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args.dir || '.');
const outDir = ensureDir(path.resolve(args.out || 'check/out/head'));
const pages = args.pages ? String(args.pages).split(',').map((s) => s.trim()).filter(Boolean) : listPages(repoDir);
const hideReport = args['hide-report'] === 'true';
const SETTLE_MS = Number(args.settle || 2500);
const REPEAT = Math.max(1, Math.min(9, Number(args.repeat || 1) || 1));
const MERGE = args.merge === 'true';

const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
/* 文字の位置を画素の格子に揃えて描く（--disable-font-subpixel-positioning）。
   揃えないと、入力欄・選択欄の文字が撮るたびに1画素未満ずれて描かれることがあり、目に見えない違いで比較が赤くなっていた
   （2026-10-04 実測: 貼り薬カレンダーの iPhone 幅で 30回中1回、CI では約半分。揃えると 30回とも同じ絵）。直す前・後とも同じ設定で撮る */
const browser = await chromium.launch({ args: ['--disable-font-subpixel-positioning'] });
const prev = MERGE ? readJsonSafe(path.join(outDir, 'metrics.json')) : null;
const metrics = (prev && prev.pages) || {};
function readJsonSafe(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
/* いちばん多かった絵を選ぶ。同数なら先に撮れた方 */
function majority(bufs) {
  const cnt = new Map();
  for (const b of bufs) { const k = crypto.createHash('md5').update(b).digest('hex'); const e = cnt.get(k) || { n: 0, b }; e.n++; cnt.set(k, e); }
  let best = null; for (const e of cnt.values()) if (!best || e.n > best.n) best = e;
  return { buf: best.b, kinds: cnt.size, top: best.n };
}

const VIEWS = [
  { key: 'pc', viewport: { width: 1280, height: 900 }, scale: 1, mobile: false },
  { key: 'ph100', viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
  { key: 'ph200', viewport: { width: 195, height: 422 }, scale: 4, mobile: true },
];

async function open(context, page, file) {
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 160)));
  p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.clock.setFixedTime(FIXED_TIME);
  if (hideReport) await p.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style'); st.textContent = '.sur-fab,.sur-dlg{display:none!important}'; document.head.appendChild(st);
    });
  });
  await p.goto(srv.url + '/' + file, { waitUntil: 'load', timeout: 30000 }).catch((e) => errors.push('開けない: ' + e.message));
  await p.waitForTimeout(SETTLE_MS);
  /* 撮影の揺れを抑える: フォントの読み込みを待つ・入力欄のフォーカス（カーソル・枠）を外す */
  await p.evaluate(() => Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 3000))])
    .then(() => { try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* 何もしない */ } })).catch(() => {});
  await p.waitForTimeout(200);
  return { p, errors };
}

for (const file of pages) {
  const name = file.replace(/\.html$/, '');
  const m = { errors: {} };
  for (const v of VIEWS) {
    const shots = { main: [], print: [] };
    let errors = [];
    for (let r = 0; r < REPEAT; r++) {
      const context = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.scale, isMobile: v.mobile, hasTouch: v.mobile, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
      const o = await open(context, null, file);
      const p = o.p;
      if (r === 0) errors = o.errors;
      try {
        if (r === 0) {
          const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body ? document.body.scrollWidth : 0 }));
          m[v.key] = { overflowPx: Math.max(0, Math.max(w.sw, w.bw) - w.iw) };
        }
        shots.main.push(await p.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }));
        if (v.key === 'pc') {
          await p.emulateMedia({ media: 'print' });
          await p.waitForTimeout(300);
          shots.print.push(await p.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }));
          if (r === 0) {
            const pdf = path.join(outDir, `${name}.pdf`);
            try {
              await p.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
              m.printPages = pdfPages(pdf);
            } catch (e) { m.printPages = null; errors.push('PDF: ' + e.message); }
          }
        }
      } catch (e) { errors.push('撮影: ' + e.message); }
      await context.close();
    }
    for (const [kind, key] of [['main', v.key], ['print', 'print']]) {
      if (!shots[kind].length) continue;
      const pick = majority(shots[kind]);
      fs.writeFileSync(path.join(outDir, `${name}.${key}.png`), pick.buf);
      if (pick.kinds > 1) { m.wobble = m.wobble || {}; m.wobble[key] = `${REPEAT}回中 ${pick.kinds}通りの絵・多数派 ${pick.top}回`; }
    }
    m.errors[v.key] = errors;
  }
  metrics[file] = m;
  const ov = VIEWS.map((v) => `${v.key}=${m[v.key] ? m[v.key].overflowPx : '?'}`).join(' ');
  console.log(`${file}: 横はみ出し ${ov} / 印刷 ${m.printPages == null ? '?' : m.printPages}ページ` + (Object.values(m.errors).some((a) => a.length) ? ' / 画面のエラーあり' : ''));
}

writeJson(path.join(outDir, 'metrics.json'), { at: new Date().toISOString(), fixedTime: FIXED_TIME.toISOString(), hideReport, repeat: REPEAT, pages: metrics });
await browser.close();
await srv.close();
/* 撮影そのものの失敗（開けない・撮れない・PDF）は終了コード 1。画面の JS エラー（pageerror）は記録だけ（比較側で増減を見る） */
const shootFail = Object.entries(metrics).filter(([f]) => pages.includes(f)).filter(([, m]) => Object.values(m.errors).flat().some((e) => /^(開けない|撮影|PDF): /.test(e)));
if (shootFail.length) { console.log('撮影に失敗: ' + shootFail.map(([f]) => f).join('、')); process.exit(1); }
