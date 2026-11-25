/* check/kintai_shaho_e2e.mjs — 勤怠管理の「社会保険の加入の知らせ」を、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設）
 *
 * 実行: node check/kintai_shaho_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定に、打刻・設定の保存・給与の設定の読み口をこの試験の中だけで足す）。本物の Supabase へは出ない。
 * 確かめること:
 *   1. 既定（設定に shaho が無い）: 「社保」のタブが隠れている・ホームに箱が無い・覚えていたタブが社保でもホームを開く・設定の欄は切・画面の例外 0
 *   2. 設定で入れて保存: shaho が送られ、ほかの設定の鍵は残る → タブとホームの箱が出る
 *   3. 一覧: 11・12月分を予定どおり働いた2人は要対応・打刻の無い人は予定だけで注意。給与の設定を読めない（関数が無い・鍵がかかっている）時は「読めない」帯
 *   4. 給与の設定が読める時: 加入済みの人を外す・金額を画面に出さない・端末に給与の値を残さない
 *   5. 「対象外にする」: shaho.exempt に足し、ほかの設定の鍵は残る → 対象外の段へ移る
 *   6. 切に戻すとタブも箱も消える・iPhone の幅（390px）で横にはみ出さない・暗い表示で撮る（check/out/kintai_shaho/）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_shaho'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } };

const YM = '2025-12';
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: '00000000-0000-4000-8000-' + String(920000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
/* 11・12月分: 見本 一郎・二美は予定どおり 9:00〜18:00 に打刻（月 約160時間＝週 約37時間・20日）。三太は打刻なし（予定だけ） */
const punchesOf = (ym) => { const m = FX.monthOf(ym), out = []; m.schedule.filter((r) => r.kind === 'work' && r.staff_id !== 'sK03').forEach((r) => out.push(P(r.staff_id, 'in', r.work_date, '09:00'), P(r.staff_id, 'out', r.work_date, '18:00'))); return out; };
const PUN = { '2025-11': punchesOf('2025-11'), '2025-12': punchesOf('2025-12') };
const shiftInit = (ym) => {
  let kv;
  Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
    kv = v;
    if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
  } });
};
const BOOT = { ok: true, settings: { config: {}, rev: 1 }, allowances: [], kintai: {}, period: {},
  profiles: [
    { staff_id: 'sK01', name: '見本 一郎', rev: 1, data: { pay_type: 'monthly', base: 234567, ins: { health: { on: true }, pension: { on: true } } }, bank_last4: [] },
    { staff_id: 'sK02', name: '見本 二美', rev: 1, data: { pay_type: 'hourly', base: 1234, ins: { health: { on: false }, pension: { on: false } } }, bank_last4: [] },
  ] };

async function open(browser, st, tabName, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, colorScheme: st.dark ? 'dark' : 'light' });
  await ctx.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }));
  await ctx.addInitScript(shiftInit, YM);
  for (const r of FX.routes) {
    if (r.match === FX.URL + '/**') {
      await ctx.route(r.match, (route) => {
        const req = route.request(), u = req.url();
        const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
        let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        const json = (v, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
        if (req.method() === 'OPTIONS') return r.handle(route);
        if (name) st.calls.push([name, p]);
        if (name === 'kintai_month_get') {
          const mm = FX.monthOf(p.p_ym);
          if (mm.ok) { mm.punches = PUN[p.p_ym] || []; mm.settings = { config: st.config, rev: st.rev }; }
          return json(mm);
        }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (name === 'payroll_bootstrap') {
          if (st.pay === 'locked') return json({ code: '42501', message: '給与の鍵がかかっています', details: null, hint: null }, 403);
          if (st.pay === 'ok') return json(BOOT);
        }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [], alerts = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => { alerts.push(d.message()); d.accept(); });
  await page.goto(st.base + '/kintai.html');
  return { ctx, page, errs, alerts };
}
const mainText = (page) => page.textContent('#g-main');
const sentOf = (st, name) => st.calls.filter((c) => c[0] === name);
const tabHidden = (page) => page.$eval('.tabs button[data-tab="shaho"]', (b) => b.hidden);
const waitShahoList = (page) => page.waitForFunction(() => document.querySelector('#g-main table.mt') && /社会保険の加入の知らせ/.test(document.getElementById('g-main').textContent), null, { timeout: 30000 });
const rowOf = (page, nm) => page.$$eval('#g-main table.mt tbody tr', (trs, nm) => { const tr = trs.find((x) => x.textContent.indexOf(nm) >= 0); return tr ? tr.textContent : null; }, nm);

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 既定（切）—');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, hourlyPaidLeave: true }, rev: 3, pay: null };
    const { ctx, page, errs } = await open(browser, st, 'shaho');
    await page.waitForSelector('.hgrid', { timeout: 20000 });
    await page.waitForTimeout(1500);
    t('覚えていたタブが社保でも、切ならホームを開く', (await page.getAttribute('.tabs button[data-tab="home"]', 'aria-selected')) === 'true');
    t('「社保」のタブは隠れている', (await tabHidden(page)) === true);
    t('ホームに社会保険の箱が無い・給与の設定を読みに行かない', !/社会保険の加入/.test(await mainText(page)) && sentOf(st, 'payroll_bootstrap').length === 0);
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#sh-on', { timeout: 15000 });
    t('設定の欄は切・4分の3・40時間・21日・月額0・2か月', !(await page.isChecked('#sh-on')) && (await page.inputValue('#sh-mode')) === 'quarter' && (await page.inputValue('#sh-baseWeekH')) === '40' && (await page.inputValue('#sh-baseMonthDays')) === '21' && (await page.inputValue('#sh-wageMin')) === '0' && (await page.inputValue('#sh-months')) === '2');

    console.log('\n— 2. 入れて保存 —');
    await page.check('#sh-on');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0], cfg = put && put[1].p_config;
    t('保存: shaho が入りで送られ、ほかの鍵（法定休日・時間単位の有休）は残る', cfg && cfg.shaho && cfg.shaho.on === true && cfg.shaho.mode === 'quarter' && cfg.legal_holiday === 0 && cfg.hourlyPaidLeave === true, cfg);
    await page.waitForFunction(() => !document.querySelector('.tabs button[data-tab="shaho"]').hidden, null, { timeout: 15000 });
    t('保存の後は「社保」のタブが出る', (await tabHidden(page)) === false);
    await page.click('[data-tab="home"]');
    await page.waitForFunction(() => /社会保険の加入/.test(document.getElementById('g-main').textContent) && document.querySelector('.hbox[data-tab="shaho"]'), null, { timeout: 30000 });
    const box = await page.textContent('.hbox[data-tab="shaho"]');
    t('ホームの箱: 3人（要対応2・注意1）・要対応の段', /3\s*人/.test(box) && /要対応/.test(box) && (await page.getAttribute('.hbox[data-tab="shaho"]', 'class')).indexOf('alert') >= 0, box);

    console.log('\n— 3. 一覧（給与を読めない）—');
    await page.click('.hbox[data-tab="shaho"]');
    await waitShahoList(page);
    await page.waitForFunction(() => /給与の設定を読めない/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const r1 = await rowOf(page, '見本 一郎'), r3 = await rowOf(page, '見本 三太');
    t('一郎: 11・12月分の実績で要対応', /要対応/.test(r1) && /2 か月続けて/.test(r1), r1);
    t('三太: 打刻が無く予定だけ → 注意', /注意/.test(r3) && /予定が基準以上/.test(r3), r3);
    t('給与の設定を読めない帯と「読み直す」が出る', /給与の設定を読めないため/.test(await mainText(page)) && !!(await page.$('[data-act="sh-pay"]')));
    t('タブの札は3', (await page.textContent('#g-sh-n')) === '3');
    await page.screenshot({ path: path.join(OUT, 'list_pc.png'), fullPage: true });
    t('画面の例外 0', errs.length === 0, errs);

    console.log('\n— 5. 対象外にする —');
    const nPut = sentOf(st, 'kintai_settings_put').length;
    await page.click('#g-main tr:has-text("見本 二美") [data-act="sh-ex"]');
    await page.waitForFunction(() => /対象外にしました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put2 = sentOf(st, 'kintai_settings_put')[nPut], c2 = put2 && put2[1].p_config;
    t('対象外: shaho.exempt に二美の番号・入のまま・ほかの鍵は残る', c2 && JSON.stringify(c2.shaho.exempt) === '["sK02"]' && c2.shaho.on === true && c2.legal_holiday === 0 && c2.hourlyPaidLeave === true, c2);
    await waitShahoList(page);
    await page.waitForFunction(() => { const tr = [...document.querySelectorAll('#g-main table.mt tbody tr')].find((x) => x.textContent.indexOf('見本 二美') >= 0); return tr && /対象外にしています/.test(tr.textContent); }, null, { timeout: 15000 });
    t('二美は対象外の段（「対象外を戻す」）', /対象外を戻す/.test(await rowOf(page, '見本 二美')));

    console.log('\n— 6. 切に戻す —');
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#sh-on', { timeout: 15000 });
    await page.uncheck('#sh-on');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => document.querySelector('.tabs button[data-tab="shaho"]').hidden, null, { timeout: 15000 });
    const c3 = sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config;
    t('切に戻すとタブが消え、対象外の一覧は残る', c3.shaho.on === false && JSON.stringify(c3.shaho.exempt) === '["sK02"]', c3.shaho);
    await page.click('[data-tab="home"]');
    await page.waitForTimeout(800);
    t('ホームの箱も消える', !/社会保険の加入/.test(await mainText(page)));
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 3b. 給与の鍵がかかっている —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, shaho: { on: true } }, rev: 3, pay: 'locked' };
    const { ctx, page, errs } = await open(browser, st, 'shaho');
    await waitShahoList(page);
    await page.waitForFunction(() => /給与の設定を読めない/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    t('鍵がかかっている時も覆い・暗証番号の窓を出さず、一覧のまま「読めない」帯', !(await page.$('#g-gate:not([hidden])')) && /要対応/.test(await mainText(page)));
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 4. 給与の設定が読める —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, shaho: { on: true } }, rev: 3, pay: 'ok' };
    const { ctx, page, errs } = await open(browser, st, 'shaho');
    await waitShahoList(page);
    await page.waitForFunction(() => /給与の設定を読みました/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const r1 = await rowOf(page, '見本 一郎');
    t('健保と厚年に加入している一郎は「加入済み」', /加入済み/.test(r1) && !/要対応/.test(r1), r1);
    t('二美（加入していない）は要対応のまま', /要対応/.test(await rowOf(page, '見本 二美')));
    const txt = await page.textContent('body');
    t('金額（基本給・時給）を画面に出さない', !/234,?567|1,?234\b/.test(txt));
    const ls = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
    t('端末に給与の値を残さない（localStorage に金額・加入の印が無い）', !Object.values(ls).some((v) => /234567|1234\b|enrolled|pension/.test(String(v))), Object.keys(ls));
    t('payroll_bootstrap は表示中の月分で1回だけ', sentOf(st, 'payroll_bootstrap').length === 1 && sentOf(st, 'payroll_bootstrap')[0][1].p_ym === YM, sentOf(st, 'payroll_bootstrap').length);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 6b. iPhone の幅・暗い表示 —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, shaho: { on: true } }, rev: 3, pay: null, dark: true };
    const { ctx, page, errs } = await open(browser, st, 'shaho', { width: 390, height: 844 });
    await waitShahoList(page);
    await page.waitForTimeout(500);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('iPhone の幅で横にはみ出さない', ov <= 0, ov);
    const small = await page.$$eval('#g-main button', (bs) => bs.filter((b) => !b.disabled && b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
    t('押す所は 44px 以上', small.length === 0, small);
    await page.screenshot({ path: path.join(OUT, 'list_iphone_dark.png'), fullPage: true });
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_shaho/）');
process.exit(fail ? 1 : 0);
