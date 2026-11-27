/* check/payroll_zuiji_e2e.mjs — 給与の画面の「定時決定」のタブの「随時改定」の通し試験（2026-11-28 新設）
 *
 *   node check/payroll_zuiji_e2e.mjs [--shots <保存先>]
 *
 * 偽のデータベース（check/fixtures/payroll.mjs）に 2027年3〜6月の確定した明細と給与の設定の版を差し込み、本物の Chromium で開いて確かめる:
 *   1. 随時改定に切り替えると、9か月分の中で固定的賃金が変わった人が出る（昇給の月分・変わった物・起算の月・3か月・平均・等級）
 *   2. 2等級以上の昇給は「随時改定」・1等級だけは対象外・17日未満の月がある時給の人は対象外
 *   3. 等級を変える: 改定の前の月分（7月分）が確定するまで止まる → 確定後は 8月分の期首の版で健保・厚年の std だけを変える
 *   4. iPhone 幅で横はみ出し0・画面のエラー0・外への通信0
 * ★架空データだけ。本物の給与は使わない。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs, ensureDir } from './lib.mjs';
import * as FX from './fixtures/payroll.mjs';

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const SHOTS = args.shots ? ensureDir(path.resolve(String(args.shots))) : null;
const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
const browser = await chromium.launch({ args: ['--disable-font-subpixel-positioning'] });
const CLOCK = new Date('2027-07-20T09:00:00+09:00');
const YM = '2027-07';
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

/* 架空の明細（支給の行は単価 unit も持つ＝確定した月分は払った明細の単価で比べる） */
function item(pay, att) {
  const lines = pay.map(([code, amount, unit]) => ({ sec: 'pay', code, name: code, qty: null, unit: unit === undefined ? amount : unit, amount, basis: '' }))
    .concat(Object.keys(att).map((k) => ({ sec: 'att', code: k, name: k, qty: att[k], unit: null, amount: 0, basis: '' })));
  const gross = pay.reduce((a, x) => a + x[1], 0);
  return { lines, gross, taxable: gross, si_total: 0, deduct: 0, net: gross, buckets: {}, warnings: [] };
}
function putMonth(db, ym, payDate, rows, status = 'confirmed') {
  const per = FX.periodOf(ym);
  db.items[ym] = rows.map(([sid, it]) => ({ staff_id: sid, item: it, adjustments: [], gross: it.gross, deduct: 0, net: it.gross,
    frozen: Object.assign({ name: (db.staff.find((s) => s.staff_id === sid) || {}).name || sid, settings: { config: db.settings.config }, period: per },
      status === 'draft' ? {} : { confirmed: { period: per, pay_date: payDate, bank_last4: [] } }) }));
  const att = (it, k) => { const l = it.lines.find((x) => x.sec === 'att' && x.code === k); return l ? l.qty : 0; };
  db.kraw[ym] = { raw: { period: per, staff: [], schedule: [], punches: [], days: [] },
    snapshot: { rows: rows.map(([sid, it]) => ({ staff_id: sid, workDays: att(it, 'workDays'), paidDays: att(it, 'paidDays'), paidOffDays: att(it, 'paidDays'), specialPaidOffDays: 0, schedDays: 21 })) } };
  db.runs[ym] = { status, rev: 2, pay_date: payDate, fingerprint: {}, stale: false, totals: {}, bank_fp: {}, history: [], saved_at: '2027-01-01T00:00:00Z', saved_by: 'x', confirmed_at: status === 'draft' ? null : '2027-01-01T00:00:00Z', confirmed_by: 'x', exported_at: null };
}
function seedZuiji(db) {
  /* 版: s-01 は 2027-03-16（4月分の期首）から基本給 240,000 → 300,000。s-09 は 260,000 → 270,000。s-02 は時給 1,100 → 1,300 */
  const clone = (sid) => JSON.parse(JSON.stringify(db.profiles.filter((x) => x.staff_id === sid).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0].data));
  const d01 = clone('s-01'), d09 = clone('s-09'), d02 = clone('s-02');
  db.profiles = db.profiles.filter((x) => !['s-01', 's-09', 's-02'].includes(x.staff_id));
  const ver = (sid, from, data, patch) => db.profiles.push({ staff_id: sid, effective_from: from, data: Object.assign(JSON.parse(JSON.stringify(data)), patch), rev: 1, reason: '見本の版' });
  ver('s-01', '2025-04-16', d01, { base: 240000 }); ver('s-01', '2027-03-16', d01, { base: 300000 });
  ver('s-09', '2025-04-16', d09, { base: 260000, allowances: [] }); ver('s-09', '2027-03-16', d09, { base: 270000, allowances: [] });
  ver('s-02', '2025-04-16', d02, { base: 1100 }); ver('s-02', '2027-03-16', d02, { base: 1300 });
  const a01 = (b) => item([['basic', b], ['commute', 8000], ['fqual', 10000]], { workDays: 20, paidDays: 0 });
  const a09 = (b) => item([['basic', b]], { workDays: 20, paidDays: 0 });
  const a02 = (u, d) => item([['basic', u * 8 * d, u]], { workDays: d, paidDays: 0 });
  putMonth(db, '2027-03', '2027-03-26', [['s-01', a01(240000)], ['s-09', a09(260000)], ['s-02', a02(1100, 18)]]);
  ['2027-04', '2027-05', '2027-06'].forEach((ym, i) => putMonth(db, ym, ym + '-26', [['s-01', a01(300000)], ['s-09', a09(270000)], ['s-02', a02(1300, i === 1 ? 15 : 18)]]));
}

async function open(opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: opt.dark ? 'dark' : 'light' });
  const routes = FX.routesFor(Object.assign({ ym: YM, now: CLOCK, start: 'none' }, opt));
  seedZuiji(routes.db);
  const outside = [];
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.origin === srv.url || u.origin === FX.URL) return route.fallback(); outside.push(u.origin); return route.abort(); });
  for (const r of routes) await ctx.route(r.match, r.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, FX.storageFor(Object.assign({ tab: 'santei' }, opt)));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(CLOCK);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location && m.location().url) || '';
    if (/^Failed to load resource/.test(m.text()) && /\/rest\/v1\/rpc\/payroll_pin_status$/.test(loc)) return;   /* payroll_e2e.mjs と同じ（偽の DB がわざと置いていない口） */
    errors.push('console: ' + m.text());
  });
  await page.goto(srv.url + '/payroll.html');
  return { ctx, page, routes, errors, outside };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };
const ready = async (page) => {
  await page.waitForFunction(() => !document.getElementById('p-app').hidden && document.querySelector('#p-main h2') && !document.querySelector('#p-main [aria-busy="true"]'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#p-main [aria-busy="true"]'), null, { timeout: 15000 });
};
const rowText = (page, name) => page.evaluate((nm) => { const tr = [...document.querySelectorAll('#p-main tbody tr')].find((r) => r.textContent.includes(nm)); return tr ? tr.textContent.replace(/\s+/g, ' ') : ''; }, name);
async function sud(page, answer = 'ok', wait = 5000) {
  try { await page.waitForSelector('dialog.sud-dlg[open]', { timeout: wait }); } catch (e) { return ''; }
  const msg = await page.textContent('dialog.sud-dlg[open] .sud-msg');
  await page.waitForTimeout(400);
  await page.click(answer === 'ok' ? 'dialog.sud-dlg[open] .sud-btn.pri' : 'dialog.sud-dlg[open] .sud-btn:not(.pri)');
  await page.waitForFunction(() => !document.querySelector('dialog.sud-dlg[open]'), null, { timeout: 5000 }).catch(() => {});
  return msg;
}

console.log('1. 随時改定の一覧');
{
  const o = await open();
  const p = o.page;
  await ready(p);
  await p.check('#st-mode-zj');
  await ready(p);
  const all = await p.textContent('#p-main');
  t('見出しに 2027年7月分までの9か月分', /随時改定（2027年7月分までの9か月分）/.test(all), all.slice(0, 300));
  const r1 = await rowText(p, '見本 一郎');
  t('見本 一郎: 4月分に基本給 240,000→300,000・4月支給から3か月・平均 318,000・健保 20→23等級・7月分から・随時改定', /2027年4月分/.test(r1) && /基本給 240,000→300,000/.test(r1) && /2027年4月支給/.test(r1) && /318,000/.test(r1) && /20等級 260,000/.test(r1) && /23等級 320,000/.test(r1) && /2027年7月分から/.test(r1) && /随時改定/.test(r1), r1);
  t('7月分からの改定は算定基礎届が要らない知らせ', /算定基礎届が要りません/.test(r1), r1);
  const r9 = await rowText(p, '見本 九郎');
  t('見本 九郎: 1等級だけ（20→21）は対象外', /21等級 280,000/.test(r9) && /2等級以上の差がありません/.test(r9) && /対象外/.test(r9), r9);
  const r2 = await rowText(p, '見本 二子');
  t('見本 二子: 時給 1,100→1,300・5月が15日＝対象外', /時給 1,100→1,300/.test(r2) && /15日/.test(r2) && /17日未満の月があります/.test(r2), r2);
  t('数の帯（変わった 3 件・随時改定 1 件）', /固定的賃金が変わった3 件/.test(all.replace(/\s+/g, '')) || /固定的賃金が変わった\s*3 件/.test(all), all.slice(0, 500));
  await shot(p, 'zuiji-pc');

  console.log('2. 等級を変える');
  await p.click('[data-act="st-zj-apply"][data-sid="s-01"]');
  const m1 = await sud(p, 'ok');
  t('7月分の給与が確定する前は止める', /2027年7月分の給与がまだ確定していません/.test(m1), m1);
  putMonth(o.routes.db, '2027-07', '2027-07-26', [], 'confirmed');
  await p.click('[data-act="st-zj-apply"][data-sid="s-01"]');
  await p.waitForSelector('#p-dlg[open] [data-act="st-apply-go"]', { timeout: 10000 });
  const dlg = await p.textContent('#p-dlg');
  t('窓: 2027年8月分（2027-07-16から）の版・見本 一郎だけ・健保の欄に 320000', /2027年8月分（2027-07-16から）/.test(dlg) && /見本 一郎/.test(dlg) && !/見本 九郎/.test(dlg) && await p.inputValue('#st-ah-0') === '320000', [dlg.slice(0, 200), await p.inputValue('#st-ah-0').catch(() => '')]);
  await p.click('#p-dlg [data-act="st-apply-go"]');
  await p.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  await p.waitForSelector('#p-main .band.ok, #p-main .band.warn', { timeout: 10000 });
  const db = o.routes.db;
  const v = db.profiles.filter((x) => x.staff_id === 's-01' && x.effective_from === '2027-07-16')[0];
  const v0 = db.profiles.filter((x) => x.staff_id === 's-01' && x.effective_from === '2027-03-16')[0];
  t('8月分の期首（2027-07-16）に新しい版・健保と厚年の std は 320,000', !!v && v.data.ins.health.std === 320000 && v.data.ins.pension.std === 320000, v && v.data.ins);
  const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.ins.health.std; delete c.ins.pension.std; return JSON.stringify(c); };
  t('std のほかは前の版のまま写した', !!v && !!v0 && strip(v.data) === strip(v0.data));
  t('理由に「随時改定: 2027年7月分から」', !!v && /^随時改定: 2027年7月分から 健保 260000→320000・厚年 260000→320000$/.test(v.reason || ''), v && v.reason);
  t('変えたのは見本 一郎の1人だけ', db.audit.filter((a) => a.action === 'profile_put').length === 1, db.audit.filter((a) => a.action === 'profile_put').length);
  t('知らせの帯に「1人の等級を 2027年8月分の設定の版で変えました」', /1人の等級を 2027年8月分の設定の版で変えました/.test(await p.textContent('#p-main')));
  t('画面のエラー0', o.errors.length === 0, o.errors);
  t('外への通信0', o.outside.length === 0, o.outside);
  await o.ctx.close();
}

console.log('3. iPhone 幅・暗い表示');
{
  const o = await open({ viewport: { width: 375, height: 812 }, dark: true });
  const p = o.page;
  await ready(p);
  await p.check('#st-mode-zj');
  await ready(p);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('iPhone 幅で画面の横はみ出し0（表は枠の中で横に送る）', over <= 0, over);
  await shot(p, 'zuiji-ph-dark');
  t('画面のエラー0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

await browser.close();
await srv.close();
console.log('\n' + (fail ? '✗ ' + fail + ' 件 失敗（' + pass + ' 件 合格）' : '✓ ' + pass + ' 件 合格'));
process.exit(fail ? 1 : 0);
