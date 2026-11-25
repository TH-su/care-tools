/* check/kintai_a2_e2e.mjs — 勤怠管理の段A2（記号の組・通勤回数・社内会議を時間外に足す）を、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設・凍結仕様 ROOT-v7-plus-parity.md「段A2」）
 *
 * 実行: node check/kintai_a2_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定に、補助項目の読み口と設定の保存・締めをこの試験の中だけで足す）。本物の Supabase へは出ない。
 * 確かめること:
 *   1. 設定のタブ: 記号の組・通勤回数・社内会議の3つの欄が初めの案で出る → ほかの設定だけを保存しても3つの鍵は送らない →
 *      「この案で使い始める」で symbolGroups・commuteCount・meetingOt が決まり、ほかの鍵は残る → 決めた後はボタンが消え、組のコードは変えられない
 *   2. 個人の月: 会議の時間がその日の数えなかった時間より多い日に知らせの札
 *   3. 締め: 補助項目を読み直して、控えの最上段に ext（記号の組・通勤回数・会議の足し分）を入れる。補助項目が読めない時は締めない
 *   4. 月の集計の CSV（締めた時の数字）の末尾に 早遅（回）・通勤回数（回）・時間外（社内会議を含む）。今の列は前のまま
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_a2'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };

const YM = '2025-12';
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: '00000000-0000-4000-8000-' + String(920000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
/* 平日は予定どおり 9:00〜18:00 に打刻（要確認を出さない・数えなかった時間は 0） */
const PUN = (() => { const m = FX.monthOf(YM), out = []; m.schedule.filter((r) => r.kind === 'work').forEach((r) => out.push(P(r.staff_id, 'in', r.work_date, '09:00'), P(r.staff_id, 'out', r.work_date, '18:00'))); return out; })();
const WORKDAYS_K01 = FX.monthOf(YM).schedule.filter((r) => r.kind === 'work' && r.staff_id === 'sK01').length;
const ITEMS = [{ code: 'dist', name: '移動距離', kind: 'number', unit: 'km', decimals: 1, active: true }, { code: 'checkup', name: '健診/有休', kind: 'count', unit: '', decimals: 0, active: true },
  { code: 'checkup_nocommute', name: '健診通勤手当なし', kind: 'count', unit: '', decimals: 0, active: true }, { code: 'meeting', name: '社内会議', kind: 'time', unit: '', decimals: 0, active: true }];
const shiftInit = (a) => {
  let kv;
  const ym = a.ym, cells = a.cells || {}, staff = a.staff || [];
  Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
    kv = v;
    if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: staff }, symbols: { data: [] }, settings: { data: {} } } });
  } });
};
const readDl = async (page, sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(sel)]);
  return fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
};
const cellsOf = (line) => { const o = []; let c = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };

async function open(browser, st, tabName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }));
  await ctx.addInitScript(shiftInit, { ym: YM, cells: st.shiftCells || {}, staff: st.shiftStaff || [] });
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
          if (mm.ok && p.p_ym === YM) {
            mm.punches = PUN;
            mm.settings = { config: st.config, rev: st.rev };
            if (st.locked) mm.month = { ym: YM, locked_at: '2026-01-14T09:00:00+09:00', snapshot: st.snapshot || null, history: [] };
          }
          return json(mm);
        }
        /* 段A2（反証レビュー 2026-11-25・high）: 0129 の前の DB の真似。companion の鍵のある行は badrow で断る */
        if (name === 'kintai_schedule_put') { st.puts = (st.puts || []).concat([p.p_rows]); if (st.rejectComp && (p.p_rows || []).some((x) => 'companion' in x)) return json({ ok: false, error: 'badrow', row: 1 }); return json({ ok: true, rows: (p.p_rows || []).length }); }
        if (name === 'kintai_month_lock') { st.locked = true; st.snapshot = p.p_snapshot; return json({ ok: true }); }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (name === 'kintai_extras_get') {
          if (st.failExtras) return json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500);
          return json({ ok: true, from: p.p_ym + '-01', to: p.p_ym + '-31', rows: st.rows.filter((x) => !x.voided_at && x.date.slice(0, 7) === p.p_ym) });
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
const ROWS = () => [
  { id: '00000000-0000-4000-8000-0000000a2e01', staff_id: 'sK01', date: '2025-12-02', code: 'meeting', qty: null, minutes: 90, note: null },
  { id: '00000000-0000-4000-8000-0000000a2e02', staff_id: 'sK01', date: '2025-12-03', code: 'checkup', qty: 1, minutes: null, note: null },
];

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 設定のタブ —');
  const st = { base: server.url, calls: [], config: { legal_holiday: 0, hourlyPaidLeave: true, csvTime: 'hmm', extraItems: ITEMS }, rev: 3, rows: ROWS(), locked: false };
  {
    const { ctx, page, errs } = await open(browser, st, 'settings');
    await page.waitForSelector('#a2g-rows', { timeout: 20000 });
    t('記号の組の初めの案（hayaoso 早遅 早、遅、7-16、12-21、18-21）・通勤回数・社内会議の欄', (await page.inputValue('#a2g-code-0')) === 'hayaoso' && (await page.inputValue('#a2g-syms-0')) === '早、遅、7-16、12-21、18-21' && (await page.isChecked('#a2c-on')) && (await page.isChecked('#a2m-on')) && (await page.inputValue('#a2m-code')) === 'meeting');
    await page.screenshot({ path: path.join(OUT, 'settings_pc.png'), fullPage: true });
    await page.selectOption('#s-closeDay', '0');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put0 = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    t('3つの欄を触らずに保存すると3つの鍵は送らない（案のまま決まらない）・補助項目は残る', put0 && !('symbolGroups' in put0[1].p_config) && !('commuteCount' in put0[1].p_config) && !('meetingOt' in put0[1].p_config) && Array.isArray(put0[1].p_config.extraItems), put0 && Object.keys(put0[1].p_config));
    await page.waitForSelector('[data-act="a2-adopt"]', { timeout: 15000 });
    await page.evaluate(() => { document.getElementById('g-toast').textContent = ''; });
    await page.click('[data-act="a2-adopt"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0], c = put && put[1].p_config;
    t('「この案で使い始める」で3つが決まる（ほかの鍵は残す）', c && JSON.stringify(c.symbolGroups) === JSON.stringify([{ code: 'hayaoso', name: '早遅', symbols: ['早', '遅', '7-16', '12-21', '18-21'], active: true }]) &&
      JSON.stringify(c.commuteCount) === '{"minus":["checkup","checkup_nocommute"]}' && JSON.stringify(c.meetingOt) === '{"code":"meeting","on":true}' && c.legal_holiday === 0 && Array.isArray(c.extraItems), c);
    await page.waitForSelector('#a2g-code-0[readonly]', { timeout: 15000 });
    t('決めた後はボタンが消え、組のコードは変えられない', (await page.$('[data-act="a2-adopt"]')) === null);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 2〜4. 個人の月・締め・CSV —');
  {
    const { ctx, page, errs, alerts } = await open(browser, st, 'person');
    await page.waitForFunction(() => /補助項目（日ごと）/.test(document.getElementById('g-main').textContent) && !/読み込んでいます/.test(document.getElementById('g-main').textContent), null, { timeout: 20000 });
    const txt = await mainText(page);
    t('個人の月: 数えなかった時間が 0 の日の会議（12/2 1:30）に知らせの札', /会議の時間が、この日の数えなかった時間より多くなっています/.test(txt), txt.slice(0, 200));
    /* 補助項目が読めない時は締めない */
    st.failExtras = true;
    await page.click('[data-tab="close"]');
    await page.waitForSelector('[data-act="lock"]', { timeout: 15000 });
    await page.click('[data-act="lock"]');
    await page.waitForSelector('#g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    const nLock0 = sentOf(st, 'kintai_month_lock').length;
    await page.click('#g-dlg-f [data-act="lock-go"]');
    await page.waitForFunction(() => /補助項目が読めません/.test((document.getElementById('e-msg') || {}).textContent || '') || /補助項目が読めません/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 }).catch(() => {});
    t('補助項目が読めない時は締めない（kintai_month_lock を送らない・「補助項目が読めません」）', sentOf(st, 'kintai_month_lock').length === nLock0 && !st.locked && /補助項目が読めません/.test(((await page.textContent('#e-msg').catch(() => '')) || '') + (await page.textContent('#g-toast'))));
    st.failExtras = false;
    await page.click('#g-dlg-f [data-act="lock-go"]');
    await page.waitForFunction(() => /締めてあります/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const ext = st.snapshot && st.snapshot.ext, r1 = ext && ext.rows && ext.rows.sK01;
    t('締め: 控えの最上段に ext（v1・締めた時の定義）・行 rows は今のまま', !!ext && ext.v === 1 && ext.def.groups[0].code === 'hayaoso' && ext.def.meetingOt.on === true && Array.isArray(st.snapshot.rows) && st.snapshot.rows.length === 3, ext && Object.keys(ext));
    t('締め: 見本 一郎の通勤回数は働いた ' + WORKDAYS_K01 + ' 日（健診の 12/3 を除く ' + (WORKDAYS_K01 - 1) + ' 日）・記号「日」は早遅に入らない・会議 90分を時間外に足す', r1 && r1['k:commute'] === WORKDAYS_K01 - 1 && !('g:hayaoso' in r1) && r1['t:meeting'] === 90 && r1.adj && r1.adj.meetingMin === 90 && r1.adj.legalOverMin === st.snapshot.rows.find((x) => x.staff_id === 'sK01').legalOverMin + 90, r1);
    await page.waitForSelector('[data-act="csv-sum"]', { timeout: 15000 });
    const csv = await readDl(page, '[data-act="csv-sum"]');
    const head = cellsOf(csv.split('\r\n')[0]), l1 = cellsOf(csv.split('\r\n').find((l) => l.indexOf('9001,') === 0) || '');
    t('月の集計の CSV（締めた時の数字）の末尾に3列', JSON.stringify(head.slice(-3)) === JSON.stringify(['早遅（回）', '通勤回数（回）', '時間外（社内会議を含む）']), head.slice(-6));
    /* 見本の月は1か月単位の変形（既定）で、期間の総枠を超えた分が時間外に入っている。会議の90分はその上に足す */
    const lo0 = st.snapshot.rows.find((x) => x.staff_id === 'sK01').legalOverMin, hm = (m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
    t('9001 の末尾: 早遅 0・通勤回数・時間外（締めた時間外 ' + hm(lo0) + '＋会議 1:30）', JSON.stringify(l1.slice(-3)) === JSON.stringify(['0', String(WORKDAYS_K01 - 1), hm(lo0 + 90)]), [l1.slice(-3), lo0]);
    const iLo = head.indexOf('法定外');
    t('今の「法定外」の列は会議を足す前のまま', iLo >= 0 && l1[iLo] === hm(lo0), [iLo, l1[iLo]]);
    t('補助項目の列はその前のまま（社内会議（時間）の列は 1:30）', head.indexOf('社内会議（時間）') > 0 && head.indexOf('社内会議（時間）') < head.length - 3 && l1[head.indexOf('社内会議（時間）')] === '1:30', head);
    t('書き出しの注意の窓に段A2 の注意は出ない', !alerts.some((a) => /記号の組/.test(a)), alerts);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 5. 0129 の前の DB（同行の印を断る）でも予定の取り込みを止めない —');
  {
    const st5 = { base: server.url, calls: [], config: { legal_holiday: 0, csvTime: 'hmm', extraItems: ITEMS }, rev: 3, rows: [], locked: false, rejectComp: true,
      shiftStaff: [{ id: 'sK01', name: '見本 一郎', mainDivision: '施設', empCode: '9001', active: true }], shiftCells: { sK01: { 1: '早', 2: '早/同' } } };
    const { ctx, page, errs } = await open(browser, st5, 'person');
    await page.waitForFunction(() => /補助項目（日ごと）/.test(document.getElementById('g-main').textContent), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const puts = st5.puts || [], withC = puts.filter((r) => r.some((x) => 'companion' in x)), withoutC = puts.filter((r) => r.length && !r.some((x) => 'companion' in x));
    t('同行の印の行を断られたら、印を外して1回だけ送り直して通る（取り込みの失敗の帯を出さない）', withC.length === 1 && withoutC.length === 1 && withoutC[0].length === withC[0].length && !/シフトを取り込めませんでした/.test(await mainText(page)), [puts.length, withC.length, withoutC.length]);
    t('送り直した行は印のほかは同じ（記号「早」の2日）', withoutC[0].filter((x) => x.symbol === '早').length === 2);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
    const st6 = Object.assign({}, st5, { calls: [], puts: [], rejectComp: false });
    const o6 = await open(browser, st6, 'person');
    await o6.page.waitForFunction(() => /補助項目（日ごと）/.test(document.getElementById('g-main').textContent), null, { timeout: 20000 });
    t('0129 の後の DB では1回で送り、同行の印を残す', (st6.puts || []).filter((r) => r.length).length === 1 && st6.puts.filter((r) => r.length)[0].some((x) => x.companion === true));
    await o6.ctx.close();
  }

  console.log('\n— 6. 社内会議を時間外に足すかを保存しないまま、会議の時間がある月は締めない —');
  {
    const st7 = { base: server.url, calls: [], config: { legal_holiday: 0, csvTime: 'hmm', extraItems: ITEMS, symbolGroups: [], commuteCount: null }, rev: 3, rows: ROWS(), locked: false };
    const { ctx, page, errs } = await open(browser, st7, 'close');
    await page.waitForSelector('[data-act="lock"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.click('[data-act="lock"]');
    await page.waitForSelector('#g-dlg[open]', { timeout: 15000 });
    const dt = await page.textContent('#g-dlg');
    t('締めの窓に「社内会議を時間外に足すかを、設定のタブで保存してから締めてください」・締めるボタンが無い', /社内会議を時間外に足すかを、設定のタブで保存してから締めてください/.test(dt) && (await page.$('#g-dlg-f [data-act="lock-go"]')) === null, dt.slice(0, 200));
    t('締めていない', !st7.locked && sentOf(st7, 'kintai_month_lock').length === 0);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_a2/）');
process.exit(fail ? 1 : 0);
