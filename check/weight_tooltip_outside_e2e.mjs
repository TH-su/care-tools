/* check/weight_tooltip_outside_e2e.mjs — 体重管理の推移図：点を押して出た詳しい情報が、グラフの外を押すと閉じるか（本人指示 2026-11-04）
 *
 * 使い方: node check/weight_tooltip_outside_e2e.mjs [リポジトリの場所（既定は1つ上）]
 * ★架空データだけ。端末の控え（wtmgr_v1）に架空の入居者1名と6か月分の体重を入れ、通信は全部止める。
 * 確かめること:
 *   1. スマホ（触って操作）で点を押すと詳しい情報が出る
 *   2. 同じグラフの中を押した時は今までどおり出たまま（近い点に切り替わる）
 *   3. グラフの外を押すと閉じる
 *   4. PC（マウス）でも、点を押す→外を押すで閉じる
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] || path.join(here, '..'));
const { chromium } = loadPlaywright();

const rid = 'wt01';
const months = ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'];
const records = months.map((ym, i) => ({ id: 'wtr' + i, residentId: rid, yearMonth: ym, measuredOn: ym + '-01', weight: 45 + i * 0.4, measureMode: 'stand' }));
const storage = {
  su_device_role: 'office',
  wtmgr_v1: JSON.stringify({ residents: [{ id: rid, name: '架空 一郎', room: '101', heightCm: 155, dischargedAt: '' }], records }),
  wtmgr_ui_v1: JSON.stringify({ tab: 'indiv', ivRes: rid }),
};

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK  ' : 'NG  ') + msg); if (!cond) fails++; };

const srv = await startServer(repo);
const browser = await chromium.launch();
try {
  for (const mode of ['touch', 'mouse']) {
    const ctx = await browser.newContext(mode === 'touch'
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
      : { viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(srv.url)) {
        if (u.includes('su-backend.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: {} }) });
        return route.continue();
      }
      return route.abort();
    });
    await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, storage);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(srv.url + '/weight-record.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof ivCharts !== 'undefined' && ivCharts.y1 && ivCharts.y1.getDatasetMeta(0).data.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const pt = async (i) => page.evaluate((i) => {
      const ch = ivCharts.y1; const el = ch.getDatasetMeta(0).data[i]; const r = ch.canvas.getBoundingClientRect();
      return { x: r.left + el.x, y: r.top + el.y };
    }, i);
    const active = () => page.evaluate(() => ivCharts.y1.tooltip.getActiveElements().map((e) => e.index));
    const tap = async (p) => { if (mode === 'touch') await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); };

    await page.evaluate(() => document.querySelector('#ivChartY1').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await tap(await pt(2));
    const a1 = await active();
    ok(a1.length === 1 && a1[0] === 2, `${mode}: 点を押すと詳しい情報が出る（${JSON.stringify(a1)}）`);
    await tap(await pt(4));
    const a2 = await active();
    ok(a2.length === 1 && a2[0] === 4, `${mode}: グラフの中の別の点を押すと、その点の情報に切り替わる（${JSON.stringify(a2)}）`);
    /* グラフの外（画面の下の方の、グラフの枠より下）を押す */
    const outside = await page.evaluate(() => { const r = ivCharts.y1.canvas.closest('.ch-w').getBoundingClientRect(); return { x: 20, y: Math.min(window.innerHeight - 10, r.bottom + 30) }; });
    if (mode === 'mouse') { await page.mouse.move(outside.x, outside.y); await page.waitForTimeout(200); }
    if (mode === 'touch') {
      /* iPhone の Safari は、押せない場所（文字や余白）を押した時に指の合図（pointerdown・touchstart・touchend）だけを出し、
         マウスの合図（mousemove・mouseout）を出さない＝Chart.js は外を押されたことに気づかない。それをそのまま再現する
         （Chromium の touchscreen.tap はマウスの合図も出すので、直す前でも閉じてしまい確かめにならない） */
      await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y) || document.body;
        const o = { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerType: 'touch', isPrimary: true, pointerId: 9 }));
        const tch = new Touch({ identifier: 9, target: el, clientX: p.x, clientY: p.y });
        el.dispatchEvent(new TouchEvent('touchstart', { ...o, touches: [tch], targetTouches: [tch], changedTouches: [tch] }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerType: 'touch', isPrimary: true, pointerId: 9 }));
        el.dispatchEvent(new TouchEvent('touchend', { ...o, touches: [], targetTouches: [], changedTouches: [tch] }));
      }, outside);
      await page.waitForTimeout(300);
      const a3i = await active();
      ok(a3i.length === 0, `iPhone の押し方: グラフの外を押すと閉じる（${JSON.stringify(a3i)}）`);
      await tap(await pt(4));
    }
    await tap(outside);
    const a3 = await active();
    ok(a3.length === 0, `${mode}: グラフの外を押すと閉じる（${JSON.stringify(a3)}）`);
    ok(errs.length === 0, `${mode}: 画面のエラーなし ${errs.join(' | ')}`);
    if (mode === 'touch') {
      await tap(await pt(1));
      await page.screenshot({ path: path.join(here, 'out', 'weight_tooltip_open.png') }).catch(() => {});
      await tap(outside);
      await page.screenshot({ path: path.join(here, 'out', 'weight_tooltip_closed.png') }).catch(() => {});
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log(fails ? `失敗 ${fails} 件` : '全部合格');
process.exit(fails ? 1 : 0);
