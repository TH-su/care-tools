/* check/payroll_santei_e2e.mjs — 給与の画面の「定時決定」のタブの通し試験（2026-11-26 新設・設計 ~/Claude/Work/勤怠管理アプリ/給与/ROOT-santei.md）
 *
 *   node check/payroll_santei_e2e.mjs [--shots <保存先>]
 *
 * 偽のデータベース（check/fixtures/payroll.mjs）に 2027年4〜6月の確定した明細を差し込み、本物の Chromium で開いて確かめる:
 *   1. タブが開き、4〜6月に支給した確定分から平均・等級・2等級以上・パートの15日・対象外が出る
 *   2. 手当で等級が変わる人・境目まであと少しの人の印、数え方の設定（外す手当）で数え直す
 *   3. 人ごとの手直し（遡及の額）で修正平均になる（保存しない）
 *   4. 算定基礎届の控え（CSV）を書き出す
 *   5. 9月分から等級を変える: 前の月分（9月分）が確定するまで押しても止まる → 確定後は 10月分の期首の版で健保・厚年の std だけを変える
 *   6. 見込み（直近3か月）の窓
 *   7. iPhone 幅で横はみ出し0・暗い表示・画面のエラー0・外への通信0
 * ★架空データだけ。本物の給与は使わない。
 */
import fs from 'node:fs';
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
const CLOCK = new Date('2027-07-03T09:00:00+09:00');
const YM = '2027-07';
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

/* 架空の明細（定時決定が読むのは支給の行と勤怠の行だけ） */
function item(pay, att) {
  const lines = pay.map(([code, amount]) => ({ sec: 'pay', code, name: code, qty: null, unit: null, amount, basis: '' }))
    .concat(Object.keys(att).map((k) => ({ sec: 'att', code: k, name: k, qty: att[k], unit: null, amount: 0, basis: '' })));
  const gross = pay.reduce((a, x) => a + x[1], 0);
  return { lines, gross, taxable: gross, si_total: 0, deduct: 0, net: gross, buckets: {}, warnings: [] };
}
function putMonth(db, ym, payDate, rows, status = 'confirmed') {
  const per = FX.periodOf(ym);
  db.items[ym] = rows.map(([sid, it]) => ({ staff_id: sid, item: it, adjustments: [], gross: it.gross, deduct: 0, net: it.gross,
    frozen: Object.assign({ name: (db.staff.find((s) => s.staff_id === sid) || {}).name || sid, settings: { config: db.settings.config }, period: per },
      status === 'draft' ? {} : { confirmed: { period: per, pay_date: payDate, bank_last4: [] } }) }));
  db.runs[ym] = { status, rev: 2, pay_date: payDate, fingerprint: {}, stale: false, totals: {}, bank_fp: {}, history: [], saved_at: '2027-01-01T00:00:00Z', saved_by: 'x', confirmed_at: status === 'draft' ? null : '2027-01-01T00:00:00Z', confirmed_by: 'x', exported_at: null };
}
function seedSantei(db) {
  /* s-01: 月給（今 260,000）・月 290,000 → 22等級 300,000（+2）
     s-02: 時給（今 150,000）・16／15／14日 → パートの15日で4・5月・夜勤手当（回数）入り
     s-09: 月給（今 260,000）・手当なし 249,000＋夜勤 6,000 → 手当で 20等級（手当なしは19等級）
     s-03: 日給（今 260,000）・22日・手当なし 268,000＋夜勤 1,500 → 境目 270,000 まで 2,000 ≤ 1,500×2 → あと少し
     s-04: 入社 2027-06-20（6月1日以降の取得＝対象外）・s-08: 健保なし（対象外） */
  const s01 = item([['basic', 280000], ['commute', 10000]], { workDays: 20, paidDays: 1 });
  const s09 = item([['basic', 249000], ['fnight', 6000]], { workDays: 20, paidDays: 0 });
  const s03 = item([['basic', 268000], ['fnight', 1500]], { workDays: 22, paidDays: 0 });
  putMonth(db, '2027-04', '2027-04-27', [['s-01', s01], ['s-09', s09], ['s-03', s03], ['s-02', item([['basic', 158000], ['fnight', 2000]], { workDays: 15, paidDays: 1 })], ['s-08', item([['basic', 90000]], { workDays: 10, paidDays: 0 })]]);
  putMonth(db, '2027-05', '2027-05-27', [['s-01', s01], ['s-09', s09], ['s-03', s03], ['s-02', item([['basic', 160000], ['fnight', 2000]], { workDays: 15, paidDays: 0 })]]);
  putMonth(db, '2027-06', '2027-06-25', [['s-01', s01], ['s-09', s09], ['s-03', s03], ['s-02', item([['basic', 150000]], { workDays: 14, paidDays: 0 })]]);
  putMonth(db, '2027-03', '2027-03-26', [['s-01', item([['basic', 999999]], { workDays: 20 })]]);   /* 3月に支給した分は入らない */
}

async function open(opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: opt.dark ? 'dark' : 'light', acceptDownloads: true });
  const routes = FX.routesFor(Object.assign({ ym: YM, now: CLOCK, start: 'none' }, opt));
  seedSantei(routes.db);
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

console.log('1. 定時決定のタブ');
{
  const o = await open();
  const p = o.page;
  await ready(p);
  t('定時決定のタブで開く（端末に残したタブ）', await p.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'santei');
  t('見出しに 2027年の定時決定', /2027年の定時決定/.test(await p.textContent('#p-main')));
  const r1 = await rowText(p, '見本 一郎');
  t('月給: 4・5・6月の暦日数（31・30・31日）と平均 290,000・健保 20→22等級・2等級以上', /31日/.test(r1) && /30日/.test(r1) && /290,000/.test(r1) && /20等級 260,000/.test(r1) && /22等級 300,000/.test(r1) && /2等級以上/.test(r1), r1);
  t('3月に支給した分（999,999）は入らない', !/999,999/.test(r1), r1);
  const r2 = await rowText(p, '見本 二子');
  t('時給: 16・15・14日 → パートの15日で4・5月の平均 161,000・13等級 160,000', /パート/.test(r2) && /15日以上/.test(r2) && /161,000/.test(r2) && /13等級 160,000/.test(r2), r2);
  const r9 = await rowText(p, '見本 九郎');
  t('夜勤の手当で等級が変わる人の印（手当なしは19等級）', /手当で等級が変わる/.test(r9) && /19等級（249,000）/.test(r9), r9);
  const r3 = await rowText(p, '見本 三郎');
  t('境目まであと少しの人の印（手当なし 268,000・境目 270,000）', /あと少し/.test(r3) && /269,500/.test(r3), r3);
  const r4 = await rowText(p, '見本 四子');
  t('6月20日の入社は対象外（6月1日以降の資格取得）', /6月1日以降の資格取得/.test(r4) && /対象外/.test(r4), r4);
  t('健保に入っていない人は対象外', /健康保険に入っていない/.test(await rowText(p, '見本 八子')));
  t('明細の無い加入者は従前のまま', /従前のまま/.test(await rowText(p, '見本 六子')));
  await shot(p, 'santei-pc');

  console.log('2. 数え方の設定');
  await p.click('#st-opts > summary');
  const nightBox = p.locator('input[data-st-cc="night"]');
  t('夜勤手当（night_shift）は初めから「外す手当」', await nightBox.isChecked());
  await nightBox.uncheck();
  await p.waitForFunction(() => { const tr = [...document.querySelectorAll('#p-main tbody tr')].find((r) => r.textContent.includes('見本 九郎')); return tr && !/手当で等級が変わる/.test(tr.textContent); }, null, { timeout: 5000 }).catch(() => {});
  t('外す手当から夜勤を抜くと、手当で変わる印が消える', !/手当で等級が変わる/.test(await rowText(p, '見本 九郎')));
  t('設定を変えても設定の欄は開いたまま', await p.evaluate(() => document.getElementById('st-opts').open));
  await p.locator('input[data-st-cc="night"]').check();

  console.log('3. 人ごとの手直し（遡及）');
  await p.click('[data-act="st-edit"][data-sid="s-01"]');
  await p.waitForSelector('#p-dlg[open] #st-e-r0');
  await p.fill('#st-e-r0', '30000');
  await p.click('#p-dlg [data-act="st-edit-go"]');
  await p.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 5000 });
  const r1b = await rowText(p, '見本 一郎');
  t('遡及 30,000 を除いて修正平均 280,000（4月の欄に遡及の額）', /280,000/.test(r1b) && /修正平均/.test(r1b) && /遡及 30,000/.test(r1b), r1b);
  t('手直しは保存しない（DB への書き込み0）', !o.routes.db.audit.some((a) => a.action === 'profile_put'));

  console.log('4. 算定基礎届の控え（CSV）');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="st-csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  t('CSV の名前 santei_2027.csv', dl.suggestedFilename() === 'santei_2027.csv', dl.suggestedFilename());
  t('CSV の頭と行（支払基礎日数・修正平均額・見本 一郎の 280000）', /4月 支払基礎日数/.test(csv) && /修正平均額/.test(csv) && /見本 一郎.*,280000,/.test(csv), csv.split('\n').slice(0, 2));

  console.log('5. 9月分から等級を変える');
  const putsBefore = o.routes.db.audit.filter((a) => a.action === 'profile_put').length;
  await p.click('[data-act="st-apply"]');
  const m1 = await sud(p, 'ok');
  t('9月分の給与が確定する前は止める（10月分から元に戻るため）', /2027年9月分の給与がまだ確定していません/.test(m1), m1);
  putMonth(o.routes.db, '2027-09', '2027-09-27', [], 'confirmed');
  await p.click('[data-act="st-apply"]');
  await p.waitForSelector('#p-dlg[open] [data-act="st-apply-go"]', { timeout: 10000 });
  const dlg = await p.textContent('#p-dlg');
  t('窓: 2027年10月分（2027-09-16から）の版・見本 一郎の健保の欄に 280000（修正平均の等級 21）', /2027年10月分（2027-09-16から）/.test(dlg) && await p.inputValue('#st-ah-0') === '280000', [dlg.slice(0, 200), await p.inputValue('#st-ah-0').catch(() => '')]);
  await shot(p, 'santei-apply');
  await p.click('#p-dlg [data-act="st-apply-go"]');
  await p.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  await p.waitForSelector('#p-main .band.ok, #p-main .band.warn', { timeout: 10000 });
  const db = o.routes.db;
  const v = db.profiles.filter((x) => x.staff_id === 's-01' && x.effective_from === '2027-09-16')[0];
  const v0 = db.profiles.filter((x) => x.staff_id === 's-01' && x.effective_from < '2027-09-16').sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  t('10月分の期首（2027-09-16）に見本 一郎の新しい版・健保と厚年の std は 280,000', !!v && v.data.ins.health.std === 280000 && v.data.ins.pension.std === 280000, v && v.data.ins);
  const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.ins.health.std; delete c.ins.pension.std; return JSON.stringify(c); };
  t('std のほかは前の版のまま写した', !!v && !!v0 && strip(v.data) === strip(v0.data));
  t('理由に「定時決定 2027年: 9月分から」', !!v && /^定時決定 2027年: 9月分から 健保 260000→280000・厚年 260000→280000$/.test(v.reason || ''), v && v.reason);
  const putsAfter = db.audit.filter((a) => a.action === 'profile_put').length;
  t('変えたのは等級が変わる「算定」の人だけ（見本 一郎・二子。九郎・三郎は等級が同じ）', putsAfter - putsBefore === 2 && !db.profiles.some((x) => x.staff_id === 's-09' && x.effective_from === '2027-09-16') && !db.profiles.some((x) => x.staff_id === 's-03' && x.effective_from === '2027-09-16'), putsAfter - putsBefore);
  t('見本 二子（時給）の健保・厚年は 160,000', (db.profiles.filter((x) => x.staff_id === 's-02' && x.effective_from === '2027-09-16')[0] || { data: { ins: {} } }).data.ins.health.std === 160000);
  t('知らせの帯に「2人の等級を 2027年10月分の設定の版で変えました」', /2人の等級を 2027年10月分の設定の版で変えました/.test(await p.textContent('#p-main')));

  console.log('6. 見込み');
  await p.check('#st-mode-fc');
  await ready(p);
  const fc = await p.textContent('#p-main');
  t('見込みの窓は確定した支給の月の新しい方から3か月（4・5・6月・2027年9月分から）', /見込み（4月・5月・6月に支給した分・2027年9月分から）/.test(fc), fc.slice(0, 300));
  t('見込みでは反映のボタンを出さない', !(await p.$('[data-act="st-apply"]')));
  t('画面のエラー0', o.errors.length === 0, o.errors);
  t('外への通信0', o.outside.length === 0, o.outside);
  await o.ctx.close();
}

console.log('7. iPhone 幅・暗い表示');
{
  const o = await open({ viewport: { width: 375, height: 812 }, dark: true });
  const p = o.page;
  await ready(p);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('iPhone 幅で画面の横はみ出し0（表は枠の中で横に送る）', over <= 0, over);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  t('暗い表示で背景が暗い', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every((x) => +x < 80), bg);
  await shot(p, 'santei-ph-dark');
  t('画面のエラー0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

await browser.close();
await srv.close();
console.log('\n' + (fail ? '✗ ' + fail + ' 件 失敗（' + pass + ' 件 合格）' : '✓ ' + pass + ' 件 合格'));
process.exit(fail ? 1 : 0);
