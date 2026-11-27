/* check/kintai_list_e2e.mjs — 勤怠管理の「勤怠一覧」「シフト表」のタブ（kintai-list.js・2026-11-28 本人指示）の通し試験と撮影
 *   node check/kintai_list_e2e.mjs
 * 偽のデータベース（check/fixtures/kintai.mjs）で本物の Chromium を開き、
 *   1. タブが「月の一覧」の後に2つ足される・前に開いていたタブで戻る
 *   2. 勤怠一覧: 1人1行・列（労働日数〜遅刻早退）・数字は月の一覧と同じ（総勤務）・探す欄で絞れる・氏名で個人の月へ
 *   3. シフト表: 期間の日の列・予定の時刻／所定休日・出勤者数の行・事務所の絞り込み
 *   4. 幅390 で横はみ出し 0（表は枠の中で横に送る）・画面のエラー 0
 * を確かめ、check/out/kintai_list/ に絵を残す。★架空データだけ。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_list'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };
const YM = '2025-12';

async function open(browser, base, tabName, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' }, opt || {}));
  await ctx.addInitScript((s) => { try { if (sessionStorage.getItem('__e2e_init')) return; sessionStorage.setItem('__e2e_init', '1'); for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }));
  for (const r of FX.routes) await ctx.route(r.match, r.handle);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/kintai.html');
  return { ctx, page, errs };
}

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 勤怠一覧 —');
  {
    const { ctx, page, errs } = await open(browser, server.url, 'list');
    await page.waitForSelector('#g-main table.kl-t tbody tr', { timeout: 20000 });
    const order = await page.$$eval('.tabs button', (bs) => bs.map((b) => b.getAttribute('data-tab')).join());
    t('タブ「勤怠一覧」「シフト表」が「月の一覧」の後に足される', order.indexOf('grid,list,shift') >= 0, order);
    t('前に開いていた「勤怠一覧」で開く', (await page.getAttribute('.tabs button[data-tab="list"]', 'aria-selected')) === 'true');
    const heads = await page.$$eval('#g-main table.kl-t thead th', (ths) => ths.map((x) => x.textContent.trim()));
    t('列: 氏名・従業員番号・入社日・部門・雇用形態・労働日数・総勤務・法定内・時間外・法定休日・深夜・欠勤日数・遅刻早退', heads.join() === '氏名,従業員番号,入社日,部門,雇用形態,労働日数,総勤務,法定内,時間外,法定休日,深夜,欠勤日数,遅刻早退', heads);
    const n = await page.locator('#g-main table.kl-t tbody tr').count();
    t('1人1行', n >= 2, n);
    const cnt = await page.textContent('#g-main .pl-cnt');
    t('件数「1 - n / n」', cnt.trim() === '1 - ' + n + ' / ' + n, cnt);
    await page.screenshot({ path: path.join(OUT, 'list_pc.png'), fullPage: true });
    /* 総勤務は月の一覧と同じ */
    const first = await page.$eval('#g-main table.kl-t tbody tr', (tr) => ({ nm: tr.querySelector('.kl-nm').textContent, work: tr.children[6].textContent.trim() }));
    await page.click('[data-tab="grid"]');
    await page.waitForSelector('#g-main table.grid tbody tr');
    const gw = await page.$$eval('#g-main table.grid tbody tr', (trs, nm) => { const tr = trs.find((x) => x.querySelector('.nm button') && x.querySelector('.nm button').textContent === nm); return tr ? tr.querySelector('.sr2').textContent.trim() : null; }, first.nm);
    t('総勤務は「月の一覧」の総労働と同じ', gw === first.work, { list: first.work, grid: gw });
    await page.click('[data-tab="list"]');
    await page.waitForSelector('#kl-q');
    await page.fill('#kl-q', first.nm.slice(-2));
    await page.waitForTimeout(500);   /* 探す欄は打ち終わりを少し待ってから描き直す（250ms） */
    const m = await page.locator('#g-main table.kl-t tbody tr').count();
    t('探す欄で絞れて、打っている間も欄から外れない', m >= 1 && m < n && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'kl-q', { m, n });
    await page.fill('#kl-q', '');
    await page.click('#g-main table.kl-t tbody tr .kl-nm');
    await page.waitForTimeout(200);
    t('氏名を押すと個人の月を開く', (await page.getAttribute('.tabs button[data-tab="person"]', 'aria-selected')) === 'true');
    /* 途中にカーソルを置いて1字足しても、カーソルの位置が戻る（反証レビュー 2026-11-28） */
    await page.click('[data-tab="list"]'); await page.waitForSelector('#kl-q');
    await page.fill('#kl-q', 'ab'); await page.waitForTimeout(500);
    await page.focus('#kl-q'); await page.evaluate(() => document.getElementById('kl-q').setSelectionRange(1, 1)); await page.keyboard.type('x'); await page.waitForTimeout(500);
    const caret = await page.evaluate(() => { const q = document.getElementById('kl-q'); return { v: q.value, s: q.selectionStart, f: document.activeElement === q }; });
    t('探す欄: 途中に打った字が途中に入り、描き直した後もカーソルは打った所', caret.v === 'axb' && caret.s === 2 && caret.f, caret);
    t('画面のエラー 0', errs.length === 0, errs);
    await ctx.close();
  }
  console.log('\n— 2. シフト表 —');
  {
    const { ctx, page, errs } = await open(browser, server.url, 'shift');
    await page.waitForSelector('#g-main table.kl-shift tbody tr', { timeout: 20000 });
    const heads = await page.$$eval('#g-main table.kl-shift thead tr:first-child th', (ths) => ths.map((x) => x.textContent.trim()));
    t('先頭の列: 氏名・出勤時間・出勤日数・休日日数・有休残数・有休取得数・部門・雇用形態', heads.slice(0, 8).join() === '氏名,出勤時間,出勤日数,休日日数,有休残数,有休取得数,部門,雇用形態', heads.slice(0, 8));
    const days = heads.length - 8;
    t('日の列が期間の日数だけある（28〜31）', days >= 28 && days <= 31, days);
    t('出勤者数の行がある', (await page.locator('#g-main table.kl-shift .kl-cnt').count()) === 1);
    const cells = await page.$$eval('#g-main table.kl-shift tbody td.kl-s', (tds) => tds.map((x) => x.textContent));
    t('升は予定の時刻（HH:MM-HH:MM）か「所定休日」か「有休」', cells.length > 0 && cells.every((x) => /^(\d{1,2}:\d{2}-\d{1,2}:\d{2})(・\d{1,2}:\d{2}-\d{1,2}:\d{2})*$|^所定休日$|^有休$/.test(x)), cells.slice(0, 5));
    t('予定の時刻の升がある', cells.some((x) => /:/.test(x)));
    await page.screenshot({ path: path.join(OUT, 'shift_pc.png'), fullPage: false });
    t('画面のエラー 0', errs.length === 0, errs);
    await ctx.close();
  }
  console.log('\n— 3. iPhone の幅 —');
  for (const tb of ['list', 'shift']) {
    const { ctx, page, errs } = await open(browser, server.url, tb, { viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await page.waitForSelector('#g-main table.kl-t tbody tr', { timeout: 20000 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    t(tb + ': 幅390 で横はみ出し 0（表は枠の中で横に送る）', over <= 0, over);
    await page.screenshot({ path: path.join(OUT, tb + '_iphone_dark.png'), fullPage: true });
    t(tb + ': 画面のエラー 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_list/）');
process.exit(fail ? 1 : 0);
