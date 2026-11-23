/* check/kintai_freee_payroll_e2e.mjs — freee の月の集計を取り込んだ月を締め、給与の画面（payroll.html）で下書きを保存できるかの通し試験（2026-11-23 新設・凍結仕様 ROOT-freee-month-import.md・統合 0123）
 *
 *   node check/kintai_freee_payroll_e2e.mjs
 *
 * 給与の画面は check/payroll_e2e.mjs と同じ偽の DB（check/fixtures/payroll.mjs の FX.routesFor）で開く。FX は変えず、routesFor の返り（routes.db）の
 * 勤怠の月（db.kraw[月分]＝kintai_month_get と payroll_bootstrap の勤怠の控えの両方の元）を、この試験の中で入れ替える:
 *   見本 二子（s-02・時給）の staff の行に month_import（freee_csv）を付け、打刻は空・予定は3日だけ。
 *   締めの控え（month.snapshot）は、勤怠の画面が締めの時に送る物と同じく、本物の kintai-calc.js の computeMonth → snapshotOf で同じ入力から作る。
 * ★給与の計算に入る勤怠の値は payroll_bootstrap の kintai.summary_by_staff から来る（payroll.js の normBoot・computeAll）。kintai_month_get は
 *   verifyKintai の照合だけに使う。本物の DB では両方とも同じ締めの控え（同じ行）を返すので、この試験も両方を同じ控えにする（kintai_month_get だけを
 *   変えると、照合は通るのに計算は元の値のままになり、取り込みの値が給与に届くかを確かめられない）。
 * 確かめること:
 *   1. 給与の画面が「勤怠は締めてあります」を出し、勤怠の確かめ（verifyKintai）で止まらない。計算して下書き保存が成功する
 *   2. 保存した入力（payroll_run_save の p_items）の s-02 の勤怠の値が取り込みの値どおり（基本給の分＝所定内・法定内残業・時間外＝所定外−法定内残業）
 *   3. 画面のエラー0
 *   4. 逆の場面: 控えの値を1つ変えると「控えと、今の勤怠の記録が合わない人がいます」で止まり、計算も保存もしない
 * 外へは通信しない（Supabase は全部横取り）。★架空データだけ。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadPlaywright, startServer } from './lib.mjs';
import * as FX from './fixtures/payroll.mjs';

const require = createRequire(import.meta.url);
const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KC = require(path.join(repoDir, 'kintai-calc.js'));
const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
const browser = await chromium.launch({ args: ['--disable-font-subpixel-positioning'] });
const CLOCK = new Date('2026-11-20T09:00:00+09:00');
const YM = '2026-11';
const SID = 's-02', NAME = '見本 二子', EMP = '9002';
/* freee の月の集計の値（4つの和＝総労働・60時間超＝max(0, 法定外−3600)・勤務日数は整数）。予定3日・打刻なしからは決して出ない数にする */
const VALS = { workDays: 20, workMin: 9600 + 90 + 600, schedInMin: 9600, legalInOverMin: 90, legalOverMin: 600, holidayMin: 0, nightMin: 0, over60Min: 0, absentDays: 0, lateMin: 0, paidDays: 0 };
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

/* routesFor の返りを包む: 偽の DB に月の生の行を一度作らせてから、s-02 だけを取り込みの形に替え、控えを作り直す */
function withImport(routes, opt = {}) {
  const db = routes.db;
  /* FX の handle を偽の route で1回呼んで db.kraw[YM] を作らせる（FX の中の作り方のまま。呼んだ記録は消す） */
  const fake = { request: () => ({ url: () => FX.URL + '/rest/v1/rpc/kintai_month_get', method: () => 'POST', postData: () => JSON.stringify({ p_ym: YM }) }), fulfill: () => {} };
  routes[0].handle(fake);
  routes.calls.length = 0;
  const k = db.kraw[YM];
  if (!k) throw new Error('偽の DB が勤怠の月を作らなかった');
  const raw = k.raw, per = raw.period, lockedAt = db.kintai.locked_at;
  /* 職員の番号（freee の従業員番号）を名簿と勤怠の行の両方に付ける */
  db.staff.forEach((s) => { if (s.staff_id === SID) s.emp_code = EMP; });
  const mi = { id: 'mi-' + SID, ym: YM, period: { from: per.from, to: per.to }, vals: Object.assign({}, VALS), source: 'freee_csv', created_at: '2026-11-15T18:00:00+09:00' };
  raw.staff = raw.staff.map((s) => (s.staff_id === SID ? Object.assign({}, s, { emp_code: EMP, month_import: mi }) : s));
  /* 打刻は空・予定は期間の初めの平日3日（9:00〜18:00・休憩60分） */
  raw.punches = raw.punches.filter((p) => p.staff_id !== SID);
  const at = (d, m) => new Date(KC.jstMs(d, m)).toISOString();
  const days = [];
  for (let d = per.from; days.length < 3 && d <= per.to; d = KC.addDays(d, 1)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) days.push(d); }
  raw.schedule = raw.schedule.filter((s) => s.staff_id !== SID).concat(days.map((d) => ({ staff_id: SID, work_date: d, seq: 1, kind: 'work', start_at: at(d, 540), end_at: at(d, 1080), break_min: 60, paid_min: 0, office: 'facility', symbol: '日' })));
  /* 勤怠の画面の締め（kintai.js の kintai_month_lock: C.snapshotOf(month)）と同じ作り方。設定は偽 DB と同じ空（既定） */
  const month = KC.computeMonth({ ym: YM, period: per, staff: raw.staff, schedule: raw.schedule, punches: raw.punches, days: raw.days || [], leave_uses: raw.leave_uses || [], config: {}, lockedAt, now: Date.parse(lockedAt) });
  const snapshot = KC.snapshotOf(month);
  if (opt.tamper) opt.tamper(snapshot);
  db.kraw[YM] = { raw, snapshot };
  return { snapshot, mi };
}

async function open(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: 'light' });
  const routes = FX.routesFor({ ym: YM, now: CLOCK, tab: 'run', start: 'none' });
  const made = withImport(routes, opt);
  const outside = [];
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.origin === srv.url || u.origin === FX.URL) return route.fallback(); outside.push(u.origin); return route.abort(); });
  for (const r of routes) await ctx.route(r.match, r.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, FX.storageFor({ tab: 'run' }));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(CLOCK);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* payroll_e2e と同じ除外: 暗証番号の状態（payroll_pin_status）は偽の DB がわざと置いていない。その1つの住所の読み込みの失敗だけは数えない */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location && m.location().url) || '';
    if (/^Failed to load resource/.test(m.text()) && /\/rest\/v1\/rpc\/payroll_pin_status$/.test(loc)) return;
    errors.push('console: ' + m.text() + (loc && /^Failed to load resource/.test(m.text()) ? ' @' + loc.replace(/^https?:\/\/[^/]+/, '') : ''));
  });
  await page.goto(srv.url + '/payroll.html');
  return { ctx, page, routes, errors, outside, made };
}
async function sud(page, answer = 'ok', wait = 5000) {
  try { await page.waitForSelector('dialog.sud-dlg[open]', { timeout: wait }); } catch (e) { return ''; }
  const msg = await page.textContent('dialog.sud-dlg[open] .sud-msg');
  await page.waitForTimeout(400);
  await page.click(answer === 'ok' ? 'dialog.sud-dlg[open] .sud-btn.pri' : 'dialog.sud-dlg[open] .sud-btn:not(.pri)');
  await page.waitForFunction(() => !document.querySelector('dialog.sud-dlg[open]'), null, { timeout: 5000 }).catch(() => {});
  return msg;
}
const waitApp = async (page) => {
  await page.waitForFunction(() => !document.getElementById('p-app').hidden && !document.querySelector('#p-main .skel'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
};
const kcheckDone = (page) => page.waitForFunction(() => !/締めた勤怠を確かめています/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 }).catch(() => {});
const attOf = (item) => { const o = {}; (item.lines || []).forEach((l) => { if (l.sec === 'att') o[l.code] = l.qty; }); return o; };

/* ── 0. 材料（node の中）: 取り込みが控えに入っている ── */
console.log('\n— 0. 締めの控え（computeMonth → snapshotOf）—');
{
  const routes = FX.routesFor({ ym: YM, now: CLOCK });
  const { snapshot } = withImport(routes);
  const r = snapshot.rows.find((x) => x.staff_id === SID);
  t('控えの s-02 の行に取り込みの印（freee_csv）', !!r && r.imported && r.imported.source === 'freee_csv', r && r.imported);
  t('控えの s-02 の値が取り込みの値どおり（総労働・所定内・法定内残業・法定外・勤務日数）・要確認 0', !!r && ['workMin', 'schedInMin', 'legalInOverMin', 'legalOverMin', 'workDays'].every((k) => r[k] === VALS[k]) && r.reviewCount === 0,
    r && { workMin: r.workMin, schedInMin: r.schedInMin, legalInOverMin: r.legalInOverMin, legalOverMin: r.legalOverMin, workDays: r.workDays, reviewCount: r.reviewCount });
  t('ほかの職員の行は取り込みの印なし', snapshot.rows.filter((x) => x.staff_id !== SID).every((x) => !x.imported));
}

/* ── 1. 給与の画面: 締めてある・確かめが通る・計算・下書き保存 ── */
console.log('\n— 1. 取り込んだ月を締めた後、給与の画面で計算して下書き保存 —');
{
  const o = await open();
  const p = o.page;
  await waitApp(p);
  await kcheckDone(p);
  const main = await p.textContent('#p-main');
  t('「勤怠は締めてあります」を出す', /勤怠は締めてあります/.test(main), main.slice(0, 300));
  t('勤怠の確かめで止まらない（控えと合わない・確かめられない、が出ない）', !/控えと、今の勤怠の記録が合わない人がいます|締めた勤怠を確かめられませんでした/.test(main));
  t('締めた勤怠を数え直した（kintai_month_get を読んだ）', o.routes.calls.some((c) => c.name === 'kintai_month_get' && c.args.p_ym === YM));
  await p.click('[data-act="compute"]');
  const m0 = await sud(p, 'ok', 1500);
  t('計算で止める窓が出ない', m0 === '', m0);
  t('計算すると s-02 の行が出る', (await p.locator('details.it[data-sid="' + SID + '"]').count()) === 1);
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 }).catch(() => {});
  const run = o.routes.db.runs[YM];
  t('下書き保存が成功する（偽の DB の月が draft）', !!run && run.status === 'draft', run && run.status);
  const saves = o.routes.calls.filter((c) => c.name === 'payroll_run_save');
  const last = saves[saves.length - 1];
  const x = last && (last.args.p_items || []).find((i) => i.staff_id === SID);
  const a = x ? attOf(x.item) : {};
  const basic = x ? (x.item.lines || []).find((l) => l.code === 'basic') : null;
  t('保存した s-02 の勤怠: 所定内＝取り込みの所定内', a.schedInMin === VALS.schedInMin, a);
  t('保存した s-02 の勤怠: 法定内残業＝取り込みの法定内残業', a.legalInOverMin === VALS.legalInOverMin, a);
  t('保存した s-02 の勤怠: 時間外＝取り込みの（所定外−法定内残業）', a.legalOverMin === VALS.legalOverMin, a);
  t('保存した s-02 の勤怠: 総労働・出勤日数も取り込みの値', a.workMin === VALS.workMin && a.workDays === VALS.workDays, a);
  t('保存した s-02 の基本給の分（時給・所定内＋有休）＝取り込みの所定内（有休 0）', !!basic && basic.qty === VALS.schedInMin, basic);
  const ot = x ? (x.item.lines || []).filter((l) => l.code === 'ot_in' || l.code === 'ot_out').map((l) => [l.code, l.qty]) : [];
  t('残業の行の分も取り込みの値（法定内残業 90・時間外 600）', JSON.stringify(ot) === JSON.stringify([['ot_in', VALS.legalInOverMin], ['ot_out', VALS.legalOverMin]]), ot);
  t('外へ通信しない', o.outside.length === 0, o.outside);
  t('画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

/* ── 2. 逆の場面: 控えの値を1つ変えると止まる ── */
console.log('\n— 2. 控えの値を1つ変えると「控えと合わない」で止まる —');
{
  const o = await open({ tamper: (snap) => { const r = snap.rows.find((x) => x.staff_id === SID); r.legalOverMin += 30; } });
  const p = o.page;
  await waitApp(p);
  await p.waitForSelector('text=控えと、今の勤怠の記録が合わない人がいます', { timeout: 10000 }).catch(() => {});
  const main = await p.textContent('#p-main');
  t('「控えと、今の勤怠の記録が合わない人がいます」と s-02 の名前を出す', /控えと、今の勤怠の記録が合わない人がいます/.test(main) && main.includes(NAME), main.slice(0, 400));
  await p.click('[data-act="compute"]');
  const mk = await sud(p);
  t('計算しない（名前を出して止める・行が出ない）', mk.includes(NAME) && (await p.locator('details.it').count()) === 0, mk);
  t('保存の関数を呼ばない', !o.routes.calls.some((c) => c.name === 'payroll_run_save'));
  t('画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

await browser.close();
await srv.close();
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件通過・' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
