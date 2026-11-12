/* check/score.mjs — 画面ごとの「商用の点」を機械で出す物差し（2026-11-12 新設・代表者の決定 2026-11-12 案1 の第1段）
 *
 *   node check/score.mjs [--dynamic] [--pages a.html,b.html] [--dir .] [--out check/out] [--timeout 20000]
 *
 * ・リポジトリの根の業務画面（公開の許可にある *.html・EXCLUDE を除く）を読み、check/score-calc.mjs で採点する
 * ・出力: <out>/score.json（画面ごとの項目・点・合計・日時・コミット）と <out>/score.md（点の低い順の表・全体の平均・項目ごとの不合格の画面）
 * ・画面のファイルは読むだけ。採点は知らせであって門ではない（点が低くても終了コードは 0。道具が壊れた時だけ 1）
 * ・--dynamic の時だけ playwright で各画面を開き、(a) 幅375px の横はみ出し (b) 開いた時の画面のエラー（pageerror）の数
 *   (c) 開いてから load までの時間 を測る。外への通信は全部止める（同じサイトの配信だけ通す）。使い捨てのプロファイルは playwright に任せ、必ず閉じる
 * ・測れない画面・環境（playwright が無い・開けない・時間切れ・ほかの画面へ移った）は「未測定」にし、点から外す（0点にしない）
 * ★限界（仮置き）: ログインの確かめ（SUAppGate）の覆いやログインの画面へ移る画面では、測った値は中身ではなく覆いの値になる。ログインは偽装しない。
 * ★公開の成果物に出るので、エラーの文面・ソースの断片は書かない（件数・割合だけ）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listPages, parseArgs, startServer, loadPlaywright, ensureDir } from './lib.mjs';
import { scorePage, localAssets, isOwnScript, AXES, ITEMS, AXIS_POINTS } from './score-calc.mjs';

/* 採点しない画面（移転の案内だけの画面） */
export const EXCLUDE = ['kotowaza-jiten.html'];

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args.dir || '.');
const outDir = ensureDir(path.resolve(args.out || path.join(repoDir, 'check', 'out')));
const DYNAMIC = args.dynamic === 'true';
const TIMEOUT = Math.max(3000, Number(args.timeout || 20000));
const SETTLE_MS = 1500;

let pages = listPages(repoDir).filter((p) => !EXCLUDE.includes(p) && fs.existsSync(path.join(repoDir, p)));
if (args.pages) { const want = String(args.pages).split(',').map((s) => s.trim()).filter(Boolean); pages = pages.filter((p) => want.includes(p)); }
if (!pages.length) { console.log('採点する画面が0です'); process.exit(1); }

function readLocal(rel) {
  const f = path.normalize(path.join(repoDir, rel.replace(/^\.?\//, '')));
  if (!(f.startsWith(repoDir + path.sep)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return null;
  return f;
}

/* ── 動的に測る（--dynamic の時だけ）── */
async function measureAll(list) {
  const res = {};
  let pw;
  try { pw = loadPlaywright(); } catch (e) { console.log('playwright が無いので動的の項目は未測定にします'); return { res, note: 'playwright が無い' }; }
  const srv = await startServer(repoDir, 0);
  let browser = null;
  try {
    try { browser = await pw.chromium.launch({ headless: true }); }
    catch (e) { console.log('ブラウザを起動できないので動的の項目は未測定にします'); return { res, note: 'ブラウザを起動できない' }; }
    for (const p of list) {
      let ctx = null;
      try {
        ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
        await ctx.route('**/*', (route) => {
          const u = route.request().url();
          return u.startsWith(srv.url + '/') ? route.continue() : route.abort();
        });
        const page = await ctx.newPage();
        let errs = 0;
        page.on('pageerror', () => { errs++; });
        page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
        const target = srv.url + '/' + p;
        const t0 = Date.now();
        await page.goto(target, { waitUntil: 'load', timeout: TIMEOUT });
        const loadMs = Date.now() - t0;
        await page.waitForTimeout(SETTLE_MS);
        const here = page.url().split(/[?#]/)[0];
        if (here !== target) { res[p] = { note: 'ほかの画面へ移った' }; continue; }
        const overflowPx = await page.evaluate(() => {
          const d = document.documentElement;
          return Math.max(0, Math.max(d.scrollWidth, document.body ? document.body.scrollWidth : 0) - d.clientWidth);
        });
        res[p] = { overflowPx, pageErrors: errs, loadMs };
      } catch (e) {
        res[p] = { note: '開けない・時間切れ' };
      } finally {
        if (ctx) await ctx.close().catch(() => {});
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await srv.close();
  }
  return { res, note: '' };
}

function gitCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return ''; }
}

const dyn = DYNAMIC ? await measureAll(pages) : { res: {}, note: '動的は測っていない（--dynamic なし）' };

const results = [];
for (const p of pages) {
  const html = fs.readFileSync(path.join(repoDir, p), 'utf8');
  const assets = localAssets(html);
  const css = {}, sizes = {}, scripts = {};
  for (const c of assets.css) { const f = readLocal(c); if (f) css[path.basename(f)] = fs.readFileSync(f, 'utf8'); }
  for (const s of assets.scripts) {
    const f = readLocal(s);
    if (!f) continue;
    sizes[path.basename(f)] = fs.statSync(f).size;
    if (isOwnScript(p, f)) scripts[path.basename(f)] = fs.readFileSync(f, 'utf8');   // その画面のための部品だけ中身を読む（閉じる前の確かめ）
  }
  const d = dyn.res[p] || {};
  const r = scorePage(p, html, { css, sizes, scripts, dynamic: { overflowPx: d.overflowPx, pageErrors: d.pageErrors, loadMs: d.loadMs } });
  if (d.note) r.dynamicNote = d.note;
  results.push(r);
}

const valid = results.filter((r) => r.total != null);
const avg = valid.length ? Math.round(valid.reduce((a, r) => a + r.total, 0) / valid.length * 10) / 10 : null;
const axisAvg = {};
for (const ax of AXES) {
  const v = results.map((r) => r.axes[ax.id].score).filter((s) => s != null);
  axisAvg[ax.id] = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
}
const out = {
  generatedAt: new Date().toISOString(),
  commit: gitCommit(),
  dynamic: DYNAMIC,
  dynamicNote: dyn.note || '',
  average: avg,
  axisAverage: axisAvg,
  pages: results,
};
fs.writeFileSync(path.join(outDir, 'score.json'), JSON.stringify(out, null, 2));

/* ── score.md ── */
const fmt = (v) => (v == null ? '—' : String(v));
const L = [];
L.push('# 画面ごとの商用の点（機械の物差し・仮置きの配点）', '');
L.push(`- 日時: ${out.generatedAt}　コミット: ${out.commit ? out.commit.slice(0, 7) : '不明'}`);
L.push(`- 画面: ${results.length}　全体の平均: **${fmt(avg)}** / 100`);
L.push(`- 動的の項目: ${!DYNAMIC ? '測っていない' : dyn.note ? '測れなかった（' + dyn.note + '）' : '測った（測れなかった画面は表の右の列）'}。未測定は点から外し、満点を比例で直す`);
L.push('- 各軸 ' + AXIS_POINTS + '点。「対象外」「未測定」の項目は点から外す。採点は知らせであって門ではない', '');
L.push('| 画面 | 合計 | ' + AXES.map((a) => a.label.replace(/（.*）/, '')).join(' | ') + ' | 動的 |');
L.push('|---|---:|' + AXES.map(() => '---:').join('|') + '|---|');
for (const r of [...results].sort((a, b) => (a.total ?? 999) - (b.total ?? 999) || a.page.localeCompare(b.page))) {
  L.push(`| ${r.page} | ${fmt(r.total)} | ` + AXES.map((a) => fmt(r.axes[a.id].score)).join(' | ') + ` | ${!DYNAMIC || dyn.note ? '—' : r.dynamicNote || '測った'} |`);
}
L.push(`| **平均** | **${fmt(avg)}** | ` + AXES.map((a) => fmt(axisAvg[a.id])).join(' | ') + ' | |', '');
L.push('## 項目ごとの不合格の画面（不合格の多い順・「一部」は括弧つき）', '');
const byItem = ITEMS.map((it) => {
  const ng = [], part = [];
  let na = 0, um = 0;
  for (const r of results) {
    const x = r.axes[it.axis].items.find((y) => y.id === it.id);
    if (!x) continue;
    if (x.status === '不合格') ng.push(r.page); else if (x.status === '一部') part.push(r.page);
    else if (x.status === '対象外') na++; else if (x.status === '未測定') um++;
  }
  return { it, ng, part, na, um };
}).sort((a, b) => (b.ng.length - a.ng.length) || (b.part.length - a.part.length));
for (const { it, ng, part, na, um } of byItem) {
  const ax = AXES.find((a) => a.id === it.axis).label.replace(/（.*）/, '');
  const tail = [na ? `対象外 ${na}` : '', um ? `未測定 ${um}` : ''].filter(Boolean).join('・');
  L.push(`- **${it.label}**（${ax}）: 不合格 ${ng.length}・一部 ${part.length}${tail ? '・' + tail : ''}`
    + (ng.length || part.length ? ' — ' + ng.join('、') + (part.length ? (ng.length ? '、' : '') + part.map((p) => '(' + p + ')').join('、') : '') : ''));
}
L.push('');
fs.writeFileSync(path.join(outDir, 'score.md'), L.join('\n'));
console.log(`採点 ${results.length}画面・全体の平均 ${fmt(avg)}／100 → ${path.relative(repoDir, path.join(outDir, 'score.md'))}`);
