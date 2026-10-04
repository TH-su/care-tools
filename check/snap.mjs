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
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, listPages, parseArgs, startServer, pdfPages, ensureDir, writeJson, FIXED_TIME } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args.dir || '.');
const outDir = ensureDir(path.resolve(args.out || 'check/out/head'));
const pages = args.pages ? String(args.pages).split(',').map((s) => s.trim()).filter(Boolean) : listPages(repoDir);
const hideReport = args['hide-report'] === 'true';
const SETTLE_MS = Number(args.settle || 2500);

const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
const browser = await chromium.launch();
const metrics = {};

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
    const context = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.scale, isMobile: v.mobile, hasTouch: v.mobile, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const { p, errors } = await open(context, null, file);
    try {
      const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body ? document.body.scrollWidth : 0 }));
      m[v.key] = { overflowPx: Math.max(0, Math.max(w.sw, w.bw) - w.iw) };
      await p.screenshot({ path: path.join(outDir, `${name}.${v.key}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
      if (v.key === 'pc') {
        await p.emulateMedia({ media: 'print' });
        await p.waitForTimeout(300);
        await p.screenshot({ path: path.join(outDir, `${name}.print.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
        const pdf = path.join(outDir, `${name}.pdf`);
        try {
          await p.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
          m.printPages = pdfPages(pdf);
        } catch (e) { m.printPages = null; errors.push('PDF: ' + e.message); }
      }
    } catch (e) { errors.push('撮影: ' + e.message); }
    m.errors[v.key] = errors;
    await context.close();
  }
  metrics[file] = m;
  const ov = VIEWS.map((v) => `${v.key}=${m[v.key] ? m[v.key].overflowPx : '?'}`).join(' ');
  console.log(`${file}: 横はみ出し ${ov} / 印刷 ${m.printPages == null ? '?' : m.printPages}ページ` + (Object.values(m.errors).some((a) => a.length) ? ' / 画面のエラーあり' : ''));
}

writeJson(path.join(outDir, 'metrics.json'), { at: new Date().toISOString(), fixedTime: FIXED_TIME.toISOString(), hideReport, pages: metrics });
await browser.close();
await srv.close();
/* 撮影そのものの失敗（開けない・撮れない・PDF）は終了コード 1。画面の JS エラー（pageerror）は記録だけ（比較側で増減を見る） */
const shootFail = Object.entries(metrics).filter(([, m]) => Object.values(m.errors).flat().some((e) => /^(開けない|撮影|PDF): /.test(e)));
if (shootFail.length) { console.log('撮影に失敗: ' + shootFail.map(([f]) => f).join('、')); process.exit(1); }
