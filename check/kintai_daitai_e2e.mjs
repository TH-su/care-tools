/* check/kintai_daitai_e2e.mjs — 勤怠管理の「代替休暇」を、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設）
 *
 * 実行: node check/kintai_daitai_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員に、締めた月分の控え・休暇の足し・取り消し・設定の保存をこの試験の中だけで足す）。本物の Supabase へは出ない。
 * 確かめること:
 *   1. 既定（設定に daitai が無い）: タブが隠れている・ホームに箱が無い・覚えていたタブが代替休暇でもホームを開く・設定の欄は切・画面の例外 0
 *   2. 設定で入れて保存: daitai が送られ、ほかの設定の鍵は残る → タブとホームの箱が出る
 *   3. 一覧: 締めた 2025年12月分の60時間超（一郎 20時間・二美 8時間）から 5:00・2:00 を与え、期限は 2026/2/28（月末締め）
 *   4. 入れる: 一郎の半日 → kintai_absence_add に有給の特別休暇・印 daitai・半日の分。読み直すと「取った代替休暇」に出て残りが 1:00
 *      二美の 2:00 と一郎の残り 1:00 は半日に満たず「取れない」（候補に出さない）。取り消す → kintai_absence_void に理由
 *   5. 特別休暇の種類に印 daitai を入れると保存しない
 *   6. 切に戻すとタブも箱も消える・iPhone の幅（390px）で横にはみ出さない・暗い表示で撮る（check/out/kintai_daitai/）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_daitai'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } };

const YM = '2026-01';
const SNAP = { v: 1, ym: '2025-12', period: { from: '2025-12-01', to: '2025-12-31' }, config: { legal_holiday: 0 },
  rows: [{ staff_id: 'sK01', over60Min: 20 * 60, legalOverMin: 80 * 60 }, { staff_id: 'sK02', over60Min: 8 * 60, legalOverMin: 68 * 60 }, { staff_id: 'sK03', over60Min: 0, legalOverMin: 10 * 60 }] };
const shiftInit = (ym) => {
  let kv;
  Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
    kv = v;
    if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
  } });
};

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
          if (mm.ok) {
            mm.settings = { config: st.config, rev: st.rev };
            if (p.p_ym === '2025-12') mm.month = { ym: '2025-12', locked_at: '2026-01-05T10:00:00+09:00', snapshot: SNAP };
            mm.absences = (mm.absences || []).concat(st.abs.filter((a) => a.date >= mm.period.from && a.date <= mm.period.to));
          }
          return json(mm);
        }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (name === 'kintai_absence_add') {
          const id = '00000000-0000-4000-8000-' + String(930000000000 + st.abs.length + 1);
          st.abs.push({ id, staff_id: p.p_staff_id, date: p.p_date, kind: p.p_kind, minutes: p.p_minutes, paid: p.p_paid, type_code: p.p_type_code, link_date: null, note: p.p_note || null });
          return json({ ok: true, id });
        }
        if (name === 'kintai_absence_void') { st.abs = st.abs.filter((a) => a.id !== p.p_id); return json({ ok: true }); }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [], alerts = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => { alerts.push(d.message()); d.type() === 'prompt' ? d.accept('記入の誤り（試験）') : d.accept(); });
  await page.goto(st.base + '/kintai.html');
  return { ctx, page, errs, alerts };
}
const mainText = (page) => page.textContent('#g-main');
const sentOf = (st, name) => st.calls.filter((c) => c[0] === name);
const tabHidden = (page) => page.$eval('.tabs button[data-tab="daitai"]', (b) => b.hidden);
const waitList = (page) => page.waitForFunction(() => document.querySelector('#g-main table.dt-t') && /与えた代替休暇/.test(document.getElementById('g-main').textContent), null, { timeout: 30000 });
const rowsOf = (page, i) => page.$$eval('#g-main table.dt-t', (ts, i) => ts[i] ? [...ts[i].querySelectorAll('tbody tr')].map((x) => x.textContent) : [], i);
/* 窓（SUDialog の prompt）が出たら理由を入れて OK（ブラウザの窓は dialog の受けで答える） */
async function answerPrompt(page, text) {
  const inp = await page.waitForSelector('.su-dlg input, dialog[open] input[type="text"]', { timeout: 3000 }).catch(() => null);
  if (!inp) return;
  await inp.fill(text);
  await page.keyboard.press('Enter');
}

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 既定（切）—');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, hourlyPaidLeave: true }, rev: 3, abs: [] };
    const { ctx, page, errs } = await open(browser, st, 'daitai');
    await page.waitForSelector('.hgrid', { timeout: 20000 });
    await page.waitForTimeout(1500);
    t('覚えていたタブが代替休暇でも、切ならホームを開く', (await page.getAttribute('.tabs button[data-tab="home"]', 'aria-selected')) === 'true');
    t('「代替休暇」のタブは隠れている', (await tabHidden(page)) === true);
    t('ホームに代替休暇の箱が無い', !(await page.$('.hbox[data-tab="daitai"]')));
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#dt-on', { timeout: 15000 });
    t('設定の欄は切・50%・25%・1日か半日・2か月・14日', !(await page.isChecked('#dt-on')) && (await page.inputValue('#dt-rateNo')) === '50' && (await page.inputValue('#dt-rateYes')) === '25' && (await page.inputValue('#dt-units')) === 'both' && (await page.inputValue('#dt-months')) === '2' && (await page.inputValue('#dt-warnDays')) === '14');

    console.log('\n— 5. 特別休暇の種類に印 daitai —');
    const nPut0 = sentOf(st, 'kintai_settings_put').length;
    const last = await page.$$eval('[id^="lt-code-"]', (xs) => xs.length - 1);
    await page.fill('#lt-code-' + last, 'daitai'); await page.fill('#lt-name-' + last, '代わりの休み');
    await page.click('[data-act="save-set"]');
    await page.waitForTimeout(800);
    t('印 daitai の特別休暇の種類は保存しない', sentOf(st, 'kintai_settings_put').length === nPut0);
    await page.fill('#lt-code-' + last, ''); await page.fill('#lt-name-' + last, '');

    console.log('\n— 2. 入れて保存 —');
    await page.check('#dt-on');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0], cfg = put && put[1].p_config;
    t('保存: daitai が入りで送られ、ほかの鍵（法定休日・時間単位の有休）は残る・shaho の鍵は作らない', cfg && cfg.daitai && cfg.daitai.on === true && cfg.daitai.rateNo === 50 && cfg.legal_holiday === 0 && cfg.hourlyPaidLeave === true && !('shaho' in cfg), cfg);
    await page.waitForFunction(() => !document.querySelector('.tabs button[data-tab="daitai"]').hidden, null, { timeout: 15000 });
    t('保存の後は「代替休暇」のタブが出る', (await tabHidden(page)) === false);
    await page.click('[data-tab="home"]');
    await page.waitForFunction(() => document.querySelector('.hbox[data-tab="daitai"]'), null, { timeout: 30000 });
    t('ホームに代替休暇の箱が出る', /代替休暇/.test(await page.textContent('.hbox[data-tab="daitai"]')));

    console.log('\n— 3. 一覧 —');
    await page.click('.hbox[data-tab="daitai"]');
    await waitList(page);
    const g = await rowsOf(page, 0), g1 = g.find((x) => x.indexOf('見本 一郎') >= 0) || '', g2 = g.find((x) => x.indexOf('見本 二美') >= 0) || '';
    t('一郎: 12月分 60時間超 20:00 → 与えられる 5:00・期限 2026/2/28', /12月分/.test(g1) && /20:00/.test(g1) && /5:00/.test(g1) && /2026\/1\/1〜2026\/2\/28/.test(g1), g1);
    t('二美: 8:00 → 2:00 は半日に満たず「単位に満たない（割増で払う）」', /8:00/.test(g2) && /2:00/.test(g2) && /単位に満たない/.test(g2), g2);
    t('入れる人の候補は一郎だけ（二美は取れない）', JSON.stringify(await page.$$eval('#dt-sid option', (os) => os.map((o) => o.value))) === '["sK01"]');
    t('60時間を超えない三太は出ない', !g.some((x) => x.indexOf('見本 三太') >= 0));
    await page.screenshot({ path: path.join(OUT, 'list_pc.png'), fullPage: true });

    console.log('\n— 4. 入れる・断る・取り消す —');
    await page.selectOption('#dt-sid', 'sK01');
    await page.fill('#dt-date', '2026-01-20');
    await page.selectOption('#dt-len', '0.5');
    await page.click('[data-act="dt-add"]');
    await page.waitForFunction(() => /代替休暇を入れました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const add = sentOf(st, 'kintai_absence_add').slice(-1)[0], a = add && add[1];
    t('送る: 有給の特別休暇・印 daitai・半日の分', a && a.p_kind === 'special' && a.p_type_code === 'daitai' && a.p_paid === true && a.p_minutes === 240 && a.p_date === '2026-01-20' && a.p_staff_id === 'sK01', a);
    await page.waitForFunction(() => /取った代替休暇/.test(document.getElementById('g-main').textContent) && document.querySelectorAll('#g-main table.dt-t')[1] && document.querySelectorAll('#g-main table.dt-t')[1].querySelector('[data-act="dt-void"]'), null, { timeout: 30000 });
    const u = await rowsOf(page, 1), u1 = u.find((x) => x.indexOf('見本 一郎') >= 0) || '';
    t('取った代替休暇に半日が出て、12月分から当てる', /半日/.test(u1) && /12月分/.test(u1) && /よい/.test(u1), u1);
    const g1b = (await rowsOf(page, 0)).find((x) => x.indexOf('見本 一郎') >= 0) || '';
    t('一郎は使った 4:00・残り 1:00・割増に代えた時間 16:00（半日 4時間÷25%）', /4:00\s*1:00\s*16:00/.test(g1b), g1b);
    t('一郎の残り 1:00 も半日に満たず、入れる人がいなくなる', /残りのある人がいません/.test(await mainText(page)));
    await page.click('#g-main [data-act="dt-void"]');
    await answerPrompt(page, '記入の誤り（試験）');
    await page.waitForFunction(() => /代替休暇を取り消しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const vd = sentOf(st, 'kintai_absence_void').slice(-1)[0];
    t('取り消す: kintai_absence_void に理由', vd && /記入の誤り/.test(vd[1].p_reason) && !!vd[1].p_id, vd);
    t('画面の例外 0', errs.length === 0, errs);

    console.log('\n— 6. 切に戻す —');
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#dt-on', { timeout: 15000 });
    await page.uncheck('#dt-on');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => document.querySelector('.tabs button[data-tab="daitai"]').hidden, null, { timeout: 15000 });
    const c3 = sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config;
    t('切に戻すとタブが消える（鍵は切で残る）', c3.daitai && c3.daitai.on === false, c3.daitai);
    await page.click('[data-tab="home"]');
    await page.waitForTimeout(800);
    t('ホームの箱も消える', !(await page.$('.hbox[data-tab="daitai"]')));
    const ls = await page.evaluate(() => Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).join('\n'));
    t('端末に代替休暇の中身を残さない', !/daitai|代替/.test(ls));
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 6b. iPhone の幅・暗い表示 —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, daitai: { on: true } }, rev: 3, abs: [], dark: true };
    const { ctx, page, errs } = await open(browser, st, 'daitai', { width: 390, height: 844 });
    await waitList(page);
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
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_daitai/）');
process.exit(fail ? 1 : 0);
