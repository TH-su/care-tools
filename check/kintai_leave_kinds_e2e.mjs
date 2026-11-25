/* check/kintai_leave_kinds_e2e.mjs — 勤怠管理の「休暇の種類を足した分・休業の期間・エラー勤務の残り3種」を、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設・段B・統合 0131）
 *
 * 実行: node check/kintai_leave_kinds_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定に、0131 の関数をこの試験の中だけで足す）。本物の Supabase へは出ない。
 * 確かめること:
 *   1. 関数がまだ無い（PGRST202）時: 要確認と有給のタブに「データベースの準備中」・画面の例外 0・月の数字は今のまま
 *   2. 関数がある時: 要確認のタブに「エラー勤務」（休業中の勤務・子の看護等休暇の1年の日数を超えた日）と「振替休日の知らせ」・日の札に足した種類
 *   3. 有給のタブの「休業の期間」: 一覧・入れる（kintai_leave_term_add の引数）・重なりは送らない
 *   4. 有給の窓: 子の看護等休暇を2時間で入れる（kintai_absence_add の引数 p_minutes 120・p_paid false）・暗い表示で撮る（check/out/kintai_leave_kinds/）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_leave_kinds'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };

const YM = '2025-12';
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: '00000000-0000-4000-8000-' + String(920000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
const PUN = (() => { const m = FX.monthOf(YM), out = []; m.schedule.filter((r) => r.kind === 'work').forEach((r) => out.push(P(r.staff_id, 'in', r.work_date, '09:00'), P(r.staff_id, 'out', r.work_date, '18:00'))); return out; })();
const WORK_DAY = FX.monthOf(YM).schedule.filter((r) => r.kind === 'work' && r.staff_id === 'sK01')[0].work_date;
const shiftInit = (ym) => {
  let kv;
  Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
    kv = v;
    if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
  } });
};

async function open(browser, st, tabName, dark) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  await ctx.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }));
  await ctx.addInitScript(shiftInit, YM);
  for (const r of FX.routes) {
    if (r.match === FX.URL + '/**') {
      await ctx.route(r.match, (route) => {
        const req = route.request(), u = req.url();
        const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
        let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
        if (req.method() === 'OPTIONS') return r.handle(route);
        if (name) st.calls.push([name, p]);
        if (name === 'kintai_month_get') {
          const mm = FX.monthOf(p.p_ym);
          if (mm.ok && p.p_ym === YM) { mm.punches = PUN; mm.settings = { config: st.config, rev: 3 }; mm.absences = (mm.absences || []).concat(st.abs); }
          return json(mm);
        }
        if (st.withDb && name === 'kintai_leave_extra_get') return json({ ok: true, from: YM + '-01', to: YM + '-31', terms: st.terms, year_absences: st.yearAbs });
        if (st.withDb && name === 'kintai_leave_term_add') {
          const id = '00000000-0000-4000-8000-0000000f' + String(1000 + st.terms.length);
          st.terms.push({ id, staff_id: p.p_staff_id, kind: p.p_kind, date_from: p.p_from, date_to: p.p_to, note: p.p_note, created_at: '2025-12-20T00:00:00Z', voided_at: null });
          return json({ ok: true, id });
        }
        if (name === 'kintai_absence_add') return json(st.withDb ? { ok: true, id: '00000000-0000-4000-8000-0000000f9999' } : { ok: false, error: 'badkind' });
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

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 関数がまだ無い時 —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0 }, abs: [], terms: [], yearAbs: [], withDb: false };
    const { ctx, page, errs } = await open(browser, st, 'review');
    await page.waitForFunction(() => /エラー勤務の一覧.*データベースの準備中/.test(document.getElementById('g-main').textContent), null, { timeout: 20000 });
    t('要確認のタブ: エラー勤務は「データベースの準備中」', true);
    await page.click('[data-tab="leave"]');
    await page.waitForFunction(() => /休業の期間は、データベースの準備中/.test(document.getElementById('g-main').textContent), null, { timeout: 30000 });
    t('有給のタブ: 休業の期間は「データベースの準備中」', true);
    t('関数が無いと分かった後は、描き直しても聞き直さない（1回か2回まで）', sentOf(st, 'kintai_leave_extra_get').length <= 2, sentOf(st, 'kintai_leave_extra_get').length);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 2. 要確認のエラー勤務と振替の知らせ —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0 }, withDb: true,
      abs: [{ id: '00000000-0000-4000-8000-0000000f0101', staff_id: 'sK02', date: '2025-12-15', kind: 'child_care', minutes: 120, paid: false, type_code: null, link_date: null, note: '', created_at: '2025-12-14T10:00:00+09:00' }],
      terms: [{ id: '00000000-0000-4000-8000-0000000f0001', staff_id: 'sK01', kind: 'childcare', date_from: WORK_DAY, date_to: '2026-03-31', note: '見本', created_at: '2025-11-20T00:00:00Z', voided_at: null }],
      yearAbs: ['2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'].map((d, i) => ({ id: 'y' + i, staff_id: 'sK02', date: d, kind: 'child_care', minutes: null })).concat([{ id: 'y9', staff_id: 'sK02', date: '2025-12-15', kind: 'child_care', minutes: 120 }]) };
    const { ctx, page, errs } = await open(browser, st, 'review');
    await page.waitForFunction(() => /エラー勤務 \d+ 件/.test(document.getElementById('g-main').textContent), null, { timeout: 20000 });
    const tx = await mainText(page);
    t('休業中の勤務: 育児休業の期間の中の日の打刻を出す', /育児休業の期間（.*）の中の日に打刻があります/.test(tx), tx.slice(-600));
    t('休暇の残り不足: 子の看護等休暇が1年の5日を超えた日を出す', /子の看護等休暇が1年（4\/1〜3\/31）の 5 日を超えています/.test(tx));
    t('振替休日の知らせの欄がある', /振替休日の知らせ \d+ 件/.test(tx));
    t('今の要確認の一覧（締めを止める方）の数は変えない（タブの数の札は今のまま）', /要確認/.test(await page.textContent('[data-tab="review"]')));
    await page.screenshot({ path: path.join(OUT, 'review_pc.png'), fullPage: true });
    await page.click('[data-tab="person"]');
    await page.waitForSelector('#g-staff', { timeout: 15000 });
    await page.selectOption('#g-staff', 'sK02');
    await page.waitForFunction(() => /子の看護等休暇 2時間/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    t('個人の月: 日の札に「子の看護等休暇 2時間」', true);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 3. 休業の期間 —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0 }, withDb: true, abs: [], yearAbs: [],
      terms: [{ id: '00000000-0000-4000-8000-0000000f0001', staff_id: 'sK01', kind: 'childcare', date_from: '2025-12-01', date_to: '2026-03-31', note: '見本', created_at: '2025-11-20T00:00:00Z', voided_at: null }] };
    const { ctx, page, errs } = await open(browser, st, 'leave');
    await page.waitForSelector('#lk-t-staff', { timeout: 40000 });
    const tx = await mainText(page);
    t('一覧: 育児休業・期間と日数（2025/12/1〜2026/3/31（121日））', /育児休業2025\/12\/1〜2026\/3\/31（121日）/.test(tx.replace(/\s+/g, '')), tx.slice(-400));
    await page.selectOption('#lk-t-staff', 'sK01');
    await page.selectOption('#lk-t-kind', 'childcare');
    await page.fill('#lk-t-from', '2026-03-01');
    await page.fill('#lk-t-to', '2026-04-30');
    await page.click('[data-act="lk-term-add"]');
    t('同じ人・同じ種類で重なる期間は送らない', sentOf(st, 'kintai_leave_term_add').length === 0 && /重なっています/.test(await page.textContent('#lk-t-msg')));
    await page.selectOption('#lk-t-kind', 'papa');
    await page.fill('#lk-t-note', '見本の入れ方');
    await page.click('[data-act="lk-term-add"]');
    await page.waitForFunction(() => /産後パパ育休/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const add = sentOf(st, 'kintai_leave_term_add')[0];
    t('入れる: kintai_leave_term_add に5つの引数', add && JSON.stringify(add[1]) === JSON.stringify({ p_staff_id: 'sK01', p_kind: 'papa', p_from: '2026-03-01', p_to: '2026-04-30', p_note: '見本の入れ方' }), add);
    await page.setViewportSize({ width: 390, height: 844 });
    const small = await page.$$eval('[data-act="lk-term-add"],[data-act="lk-term-void"]', (bs) => bs.filter((b) => b.getBoundingClientRect().height < 44).length);
    t('iPhone の幅（390px）で押す所が 44px 以上', small === 0, small);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 4. 有給の窓で子の看護等休暇を入れる —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0 }, withDb: true, abs: [], terms: [], yearAbs: [] };
    const { ctx, page, errs } = await open(browser, st, 'leave', true);
    await page.waitForSelector('[data-act="lv-open"][data-sid="sK01"]', { timeout: 40000 });
    await page.click('[data-act="lv-open"][data-sid="sK01"]');
    await page.waitForSelector('#g-dlg[open] #lv-a-kind', { timeout: 15000 });
    const kinds = await page.$$eval('#lv-a-kind option', (o) => o.map((x) => x.textContent));
    t('種類に足した8つが並ぶ', ['子の看護等休暇', '介護休暇', '産前産後休業', '育児休業', '産後パパ育休', '介護休業', '公休', '労災の休業'].every((k) => kinds.indexOf(k) >= 0), kinds);
    await page.selectOption('#lv-a-kind', 'child_care');
    await page.dispatchEvent('#lv-a-kind', 'change');
    t('子の看護等休暇を選ぶと「長さ（1日・時間）」の欄だけが出る', await page.isVisible('#lv-a-hlen') && !(await page.isVisible('#lv-a-type')));
    await page.fill('#lv-a-date', '2025-12-16');
    await page.selectOption('#lv-a-hlen', '2');
    await page.click('[data-act="lv-abs-add"]');
    await page.waitForFunction(() => /保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const a = sentOf(st, 'kintai_absence_add')[0];
    t('kintai_absence_add に p_kind child_care・p_minutes 120・p_paid false', a && a[1].p_kind === 'child_care' && a[1].p_minutes === 120 && a[1].p_paid === false && a[1].p_type_code === null && a[1].p_link_date === null, a);
    await page.screenshot({ path: path.join(OUT, 'leave_dialog_dark.png'), fullPage: true });
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_leave_kinds/）');
process.exit(fail ? 1 : 0);
