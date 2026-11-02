/* check/care_schedule_masterid_e2e.mjs — 週間計画の「?masterId=」受け口を本物のブラウザで確かめる（2026-11-02）
 *
 *   node check/care_schedule_masterid_e2e.mjs
 *
 * 本物の Chromium で care-schedule.html?masterId=… を開き、同期先（GAS）だけを偽物に差し替える。
 *   ・控えの無い端末で、取得した名簿にその方が居る → 選ばれる（「登録されていません」を出さない）
 *   ・控えの無い端末で、取得した名簿にも居ない → 取得の後に「登録されていません」
 *   ・控えの無い端末で、取得に失敗した → 「開けませんでした」（居ないとは言わない）
 *   ・控えのある端末 → 起動時にすぐ選ばれる（今までどおり）
 *   ・同期先の無い端末 → すぐ「登録されていません」（今までどおり）
 *   ・取得を待つ間に職員がセレクトで別の方を選んだ／ほかの経路で選んだ → 取得の後に上書きしない
 *   ・取得を待つ間に予定の編集画面を開いている → 表示中の方を裏で入れ替えない（「開けませんでした」）
 *   ・取得を待つ間に試算を始めた → 「登録されていません」とは言わない
 * データはすべて架空。外への通信はしない（GAS は横取り・それ以外の外部は止める）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer } from './lib.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info).slice(0, 400)); }
}

const GAS = 'https://script.google.com/macros/s/FAKE_TEST/exec';
const R = (id, name, kana, masterId) => ({ id, name, kana, masterId, events: [] });
const SERVER_DB = {
  residents: [R('r1', '架空 一郎', 'かくう いちろう', 'M1'), R('r2', '架空 二子', 'かくう ふたこ', 'M2'), R('r3', '架空 三太', 'かくう さんた', 'M3')],
  currentResidentId: null
};

async function run(browser, base, o) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let gets = 0;
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const u = route.request().url();
    if (process.env.DEBUG) console.log('    req', route.request().method(), u.slice(0, 80));
    if (u.startsWith(GAS)) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (body.action === 'get') {
        gets++;
        if (o.delay) await new Promise((r) => setTimeout(r, o.delay));
        if (o.serverFail) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: false, error: 'server error' }) });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, rev: 5, data: o.serverDb || SERVER_DB }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, rev: 5 }) });
    }
    return route.abort();
  });
  /* 保存先の切り替えスイッチは全部「切」にして、取得を偽物の GAS へ流す（Supabase の道でも取得の後の流れは同じ pull→adopt） */
  await page.route(/\/su-backend\.json/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"supabase":{}}' }));
  if (process.env.DEBUG) { page.on('console', (m) => console.log('    C', m.text().slice(0, 160))); page.on('pageerror', (e) => console.log('    E', e.message)); }
  await page.addInitScript((o) => {
    try {
      localStorage.setItem('su_device_role', 'office');
      if (o.target) localStorage.setItem('su_sync_common', JSON.stringify({ endpoint: o.gas, token: 'test-token' }));
      if (o.cache) localStorage.setItem('care_schedule_v2', JSON.stringify(o.cache));
    } catch (e) {}
    /* トーストの文を全部控える（画面のスクリプトは DOMContentLoaded より前に走るので、文書ごと見張る） */
    window.__toasts = [];
    new MutationObserver(() => {
      const el = document.getElementById('toast');
      const tx = el && el.textContent;
      if (tx && window.__toasts[window.__toasts.length - 1] !== tx) window.__toasts.push(tx);
    }).observe(document, { childList: true, characterData: true, subtree: true });
  }, { ...o, gas: GAS });
  await page.goto(base + '/care-schedule.html?masterId=' + o.mid);
  if (o.during) {   // 取得を待つ間に画面で何かする（架空の操作）
    await page.waitForFunction(() => typeof csApplyMasterIdParam === 'function');
    await page.evaluate(o.during);
  }
  if (o.pickEarly) {
    await page.waitForSelector('#resident-select');
    await page.evaluate((id) => {
      const sel = document.getElementById('resident-select');
      if (![...sel.options].some((op) => op.value === id)) sel.add(new Option('架空', id));
      sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, o.pickEarly);
  }
  await page.waitForTimeout(o.wait || 1500);
  const st = await page.evaluate(() => ({
    cur: DB.currentResidentId, sel: document.getElementById('resident-select').value,
    toasts: window.__toasts.slice(), search: location.search,
    log: (document.getElementById('sync-log') || {}).textContent || ''
  }));
  await ctx.close();
  return { ...st, gets };
}

const srv = await startServer(repoDir);
const browser = await chromium.launch();
try {
  const NOT_REG = '⚠️ 指定された利用者は週間計画に登録されていません';
  const CANT = '⚠️ 指定された利用者を開けませんでした';
  console.log('週間計画 ?masterId= の受け口');

  let s = await run(browser, srv.url, { target: true, mid: 'M2', delay: 300 });
  t('控えの無い端末：取得した名簿の方が選ばれる', s.cur === 'r2' && s.sel === 'r2', s);
  t('控えの無い端末：「登録されていません」を出さない', !s.toasts.includes(NOT_REG), s.toasts);
  t('控えの無い端末：選んだことを知らせる', s.toasts.some((x) => x.includes('架空 二子')), s.toasts);
  t('URL から指定を消す', s.search === '', s.search);

  s = await run(browser, srv.url, { target: true, mid: 'M9' });
  t('控えの無い端末：取得した名簿にも居ない時だけ「登録されていません」', s.toasts.includes(NOT_REG) && !s.cur, s);

  s = await run(browser, srv.url, { target: true, mid: 'M2', serverFail: true });
  t('控えの無い端末：取得に失敗した時は「開けませんでした」', s.toasts.includes(CANT) && !s.toasts.includes(NOT_REG), s.toasts);

  s = await run(browser, srv.url, { target: true, mid: 'M3', cache: SERVER_DB, delay: 800, wait: 400 });
  t('控えのある端末：取得を待たずに選ばれる（今までどおり）', s.cur === 'r3', s);

  s = await run(browser, srv.url, { target: false, mid: 'M2', wait: 600 });
  t('同期先の無い端末：すぐ「登録されていません」（今までどおり）', s.toasts.includes(NOT_REG) && s.gets === 0, s);

  s = await run(browser, srv.url, { target: true, mid: 'M2', delay: 600, pickEarly: 'r1', wait: 1500 });
  t('取得を待つ間に職員が選び直した方を、取得の後に上書きしない', s.cur !== 'r2' && !s.toasts.includes(NOT_REG), s);

  s = await run(browser, srv.url, { target: true, mid: 'M2', delay: 600, wait: 1500, cache: { residents: [R('r1', '架空 一郎', 'かくう いちろう', 'M1')], currentResidentId: 'r1' },
    during: "document.getElementById('mk-event').classList.add('open')" });
  t('取得を待つ間に予定の編集画面を開いていると、表示中の方を入れ替えない', s.cur === 'r1' && s.toasts.includes(CANT) && !s.toasts.includes(NOT_REG), s);

  s = await run(browser, srv.url, { target: true, mid: 'M2', delay: 600, wait: 1500, cache: { residents: [R('r1', '架空 一郎', 'かくう いちろう', 'M1')], currentResidentId: null },
    during: "csSetSelection_('r1')" });
  t('取得を待つ間にセレクト以外の経路で選んだ方も、取得の後に上書きしない', s.cur === 'r1' && !s.toasts.includes(NOT_REG), s);

  s = await run(browser, srv.url, { target: true, mid: 'M9', delay: 600, wait: 1500, during: 'SIM_ON = true' });
  t('取得を待つ間に試算を始めた時は「登録されていません」と言わない', !s.toasts.includes(NOT_REG), s.toasts);
} finally {
  await browser.close();
  await srv.close();
}
console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
