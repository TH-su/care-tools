/* check/kintai_extras_e2e.mjs — 勤怠管理の「日ごとの補助項目」を、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設・凍結仕様 ROOT-v7-plus-parity.md「段A1」・統合 0127）
 *
 * 実行: node check/kintai_extras_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定に、補助項目の3つの関数と設定の保存をこの試験の中だけで足す）。本物の Supabase へは出ない。
 * 確かめること:
 *   1. 関数がまだ無い（共通の材料のまま＝PGRST202）時: 設定・個人の月に補助項目の欄が無い・月の集計の CSV の見出しは今のまま・読み直しても聞き直さない・画面の例外 0
 *   2. 関数がある時: 設定のタブに初めの案（7つ）→ 行を足して保存 → extraItems が送られ、ほかの設定の鍵は残る → 保存したコードは変えられない
 *   3. 個人の月: 「補助項目を入れる」で移動距離 12.3 → 日の行の「補助項目」で社内会議 1時間30分 → 小数の桁が多い値は送らない →
 *      「直す」で 15.5 に入れ直す → 「取り消す」は理由が要る
 *   4. 月の集計の CSV の末尾に使う項目ごとの合計（今の列は前のまま）・日ごとの CSV の末尾にその日の値
 *   5. 締めた月分は入れる欄が出ない・iPhone の幅（390px）で押す所が 44px 以上・暗い表示で撮る（check/out/kintai_extras/）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_extras'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };

const YM = '2025-12';
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: '00000000-0000-4000-8000-' + String(910000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
/* 平日は予定どおり 9:00〜18:00 に打刻（要確認を出さない） */
const PUN = (() => { const m = FX.monthOf(YM), out = []; m.schedule.filter((r) => r.kind === 'work').forEach((r) => out.push(P(r.staff_id, 'in', r.work_date, '09:00'), P(r.staff_id, 'out', r.work_date, '18:00'))); return out; })();
const shiftInit = (ym) => {
  let kv;
  Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
    kv = v;
    if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
  } });
};
const readDl = async (page, sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(sel)]);
  return fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
};
/* 引用符の中のカンマを数えない簡単な分け方（この試験の CSV は引用符の中に改行が無い） */
const cellsOf = (line) => { const o = []; let c = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };

async function open(browser, st, tabName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
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
          if (mm.ok && p.p_ym === YM) {
            mm.punches = PUN;
            mm.settings = { config: st.config, rev: st.rev };
            if (st.locked) mm.month = { ym: YM, locked_at: '2026-01-14T09:00:00+09:00', snapshot: null, history: [] };
          }
          return json(mm);
        }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (st.withExtras && name === 'kintai_extras_get') return json({ ok: true, from: p.p_ym + '-01', to: p.p_ym + '-31', rows: st.rows.filter((x) => !x.voided_at && x.date.slice(0, 7) === p.p_ym) });
        if (st.withExtras && name === 'kintai_extra_put') {
          if (st.locked) return json({ ok: false, error: 'locked' });
          st.rows.forEach((x) => { if (!x.voided_at && x.staff_id === p.p_staff && x.date === p.p_date && x.code === p.p_code) x.voided_at = 'now'; });
          const id = '00000000-0000-4000-8000-0000000e' + String(1000 + st.rows.length);
          st.rows.push({ id, staff_id: p.p_staff, date: p.p_date, code: p.p_code, qty: p.p_qty, minutes: p.p_minutes, note: p.p_note });
          return json({ ok: true, id });
        }
        if (st.withExtras && name === 'kintai_extra_void') {
          const x = st.rows.find((y) => y.id === p.p_id);
          if (!x) return json({ ok: false, error: 'notfound' });
          if (x.voided_at) return json({ ok: false, error: 'already' });
          x.voided_at = 'now'; return json({ ok: true });
        }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [], alerts = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => { alerts.push(d.message()); if (process.env.EX_DEBUG) console.log('    [窓] ' + d.message()); d.accept(); });
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
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, hourlyPaidLeave: true }, rev: 3, rows: [], withExtras: false, locked: false };
    const { ctx, page, errs } = await open(browser, st, 'settings');
    await page.waitForSelector('#g-set', { timeout: 20000 });
    await page.waitForTimeout(800);
    t('設定のタブに「補助項目」の欄が無い', (await page.$('#ex-s-rows')) === null && !/補助項目/.test(await mainText(page)));
    await page.click('[data-tab="person"]');
    await page.waitForSelector('#g-staff', { timeout: 15000 });
    t('個人の月に「補助項目（日ごと）」の欄も日の行の「補助項目」のボタンも無い', !/補助項目/.test(await mainText(page)) && (await page.$('[data-act="ex-open"]')) === null);
    await page.click('[data-tab="close"]');
    await page.waitForSelector('[data-act="csv-sum"]', { timeout: 15000 });
    const csv = await readDl(page, '[data-act="csv-sum"]');
    const head = cellsOf(csv.split('\r\n')[0]);
    t('月の集計の CSV の見出しは今のまま（末尾は 実働_ の列）', /^実働_/.test(head[head.length - 1]) && !head.some((h) => /（km）|（回）/.test(h)), head.slice(-3));
    await page.click('#g-reload');
    await page.waitForTimeout(1500);
    t('関数が無いと分かったら読み直しても聞き直さない（kintai_extras_get は1回）', sentOf(st, 'kintai_extras_get').length === 1, sentOf(st, 'kintai_extras_get').length);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 2〜5. 関数がある時 —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, hourlyPaidLeave: true, csvTime: 'hmm' }, rev: 3, rows: [], withExtras: true, locked: false };
    const { ctx, page, errs, alerts } = await open(browser, st, 'settings');
    await page.waitForSelector('#ex-s-rows', { timeout: 20000 });
    const n0 = await page.$$eval('#ex-s-rows tr', (r) => r.length);
    t('設定: 初めの案の7行と「まだ保存していません」', n0 === 7 && /まだ保存していません/.test(await mainText(page)) && (await page.inputValue('#ex-s-code-0')) === 'dist' && (await page.inputValue('#ex-s-code-6')) === 'meeting', n0);
    await page.screenshot({ path: path.join(OUT, 'settings_pc.png'), fullPage: true });
    await page.click('[data-tab="person"]');
    await page.waitForFunction(() => /補助項目（日ごと）/.test(document.getElementById('g-main').textContent) && !/読み込んでいます/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const pre = await mainText(page);
    t('保存の前の個人の月: 「初めの7つ（…）は案です」と管理者への案内・入れるボタンは無い（DB が断るため）', /初めの7つ（移動距離・日曜出勤・/.test(pre) && /は案です。設定のタブの「補助項目」で保存すると/.test(pre) && /「設定を保存する」を押してください/.test(pre) && (await page.$('[data-act="ex-open"]')) === null, pre.slice(-300));
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#ex-s-rows', { timeout: 15000 });
    await page.click('[data-act="ex-add-row"]');
    await page.fill('#ex-s-code-7', 'parking');
    await page.fill('#ex-s-name-7', '駐車場');
    await page.selectOption('#ex-s-kind-7', 'number');
    await page.fill('#ex-s-unit-7', '円');
    await page.uncheck('#ex-s-act-3');   /* 年末年始出勤を止める */
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    const ei = put && put[1].p_config.extraItems;
    t('保存: extraItems は8つ（足した駐車場・円・数値）・年末年始出勤は active:false', Array.isArray(ei) && ei.length === 8 && ei[7].code === 'parking' && ei[7].kind === 'number' && ei[7].unit === '円' && ei[3].code === 'newyear' && ei[3].active === false, ei);
    t('保存: ほかの設定の鍵（legal_holiday・hourlyPaidLeave）は残す', put && put[1].p_config.legal_holiday === 0 && put[1].p_config.hourlyPaidLeave === true, put && put[1].p_config);
    await page.waitForSelector('#ex-s-code-0[readonly]', { timeout: 15000 });
    t('保存した後: コードは変えられない（readonly）・「まだ保存していません」が消える', (await page.$$('#ex-s-rows input[readonly]')).length === 8 && !/まだ保存していません/.test(await mainText(page)));

    /* 3. 個人の月 */
    await page.click('[data-tab="person"]');
    await page.waitForSelector('[data-act="ex-open"]:not([data-date])', { timeout: 15000 });
    t('個人の月: 「補助項目（日ごと）」の欄と、日の行の「補助項目」のボタン', /補助項目（日ごと）/.test(await mainText(page)) && (await page.$('[data-act="ex-open"][data-date="2025-12-02"]')) !== null);
    await page.click('[data-act="ex-open"]:not([data-date])');
    await page.waitForSelector('#g-dlg[open] #ex-date');
    const opts = await page.$$eval('#ex-code option', (o) => o.map((x) => x.value));
    t('入れる窓: 使う項目だけを選べる（止めた newyear は無い）', opts.length === 7 && opts.indexOf('newyear') < 0 && opts[0] === 'dist', opts);
    await page.fill('#ex-date', '2025-12-01');
    await page.selectOption('#ex-code', 'dist');
    await page.fill('#ex-qty', '1.23');
    await page.click('[data-act="ex-save"]');
    t('小数の桁が多い（1.23・設定は1桁）は送らない', sentOf(st, 'kintai_extra_put').length === 0 && /小数は 1 桁まで/.test(await page.textContent('#e-msg')), await page.textContent('#e-msg'));
    await page.fill('#ex-qty', '12.3');
    await page.click('[data-act="ex-save"]');
    await page.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 15000 });
    const p1 = sentOf(st, 'kintai_extra_put')[0];
    t('入れる: kintai_extra_put に6つの引数（p_qty 12.3・p_minutes null・p_note null）', p1 && JSON.stringify(p1[1]) === JSON.stringify({ p_staff: 'sK01', p_date: '2025-12-01', p_code: 'dist', p_qty: 12.3, p_minutes: null, p_note: null }), p1);
    await page.waitForFunction(() => /移動距離 12\.3 km/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    t('入れた後: 日の行の札と一覧に「移動距離 12.3 km」', true);

    await page.click('[data-act="ex-open"][data-date="2025-12-02"]');
    await page.waitForSelector('#g-dlg[open] #ex-date');
    t('日の行から開くと、その日が入っている', (await page.inputValue('#ex-date')) === '2025-12-02');
    await page.selectOption('#ex-code', 'meeting');
    t('時間の項目は「時間・分」の欄だけが出る', await page.isVisible('#ex-h') && !(await page.isVisible('#ex-qty')));
    await page.fill('#ex-h', '1'); await page.fill('#ex-m', '30'); await page.fill('#ex-note', '見本の会議');
    await page.screenshot({ path: path.join(OUT, 'input_pc.png') });
    await page.click('[data-act="ex-save"]');
    await page.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 15000 });
    const p2 = sentOf(st, 'kintai_extra_put')[1];
    t('時間: p_minutes 90・p_qty null・メモ', p2 && p2[1].p_minutes === 90 && p2[1].p_qty === null && p2[1].p_code === 'meeting' && p2[1].p_note === '見本の会議', p2);
    await page.waitForFunction(() => /社内会議 1:30/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });

    await page.click('[data-act="ex-open"][data-code="dist"]');
    await page.waitForSelector('#g-dlg[open] #ex-qty');
    t('直す窓: 今の値が入っていて、日と項目は変えられない', (await page.inputValue('#ex-qty')) === '12.3' && await page.isDisabled('#ex-date') && await page.isDisabled('#ex-code'));
    await page.fill('#ex-qty', '15.5');
    await page.click('[data-act="ex-save"]');
    await page.waitForFunction(() => /移動距離 15\.5 km/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const p3 = sentOf(st, 'kintai_extra_put')[2];
    t('直す: 同じ人・日・項目で入れ直す（p_qty 15.5）', p3 && p3[1].p_date === '2025-12-01' && p3[1].p_code === 'dist' && p3[1].p_qty === 15.5);

    const meetRow = st.rows.find((x) => x.code === 'meeting' && !x.voided_at);
    await page.click('[data-act="ex-void"][data-id="' + meetRow.id + '"]');
    await page.waitForSelector('#g-dlg[open] #e-reason');
    await page.click('[data-act="ex-void-go"]');
    t('取り消す: 理由が空では送らない', sentOf(st, 'kintai_extra_void').length === 0 && /理由を書いてください/.test(await page.textContent('#e-msg')));
    await page.fill('#e-reason', '見本の取り消し');
    await page.click('[data-act="ex-void-go"]');
    await page.waitForFunction(() => !/社内会議 1:30/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const v1 = sentOf(st, 'kintai_extra_void')[0];
    t('取り消す: kintai_extra_void(p_id, p_reason)', v1 && v1[1].p_id === meetRow.id && v1[1].p_reason === '見本の取り消し', v1);
    /* CSV のために社内会議をもう一度 1:30 で入れる */
    await page.click('[data-act="ex-open"][data-date="2025-12-02"]');
    await page.waitForSelector('#g-dlg[open] #ex-code');
    await page.selectOption('#ex-code', 'meeting'); await page.fill('#ex-h', '1'); await page.fill('#ex-m', '30');
    await page.click('[data-act="ex-save"]');
    await page.waitForFunction(() => /社内会議 1:30/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, 'person_pc.png'), fullPage: true });

    /* iPhone の幅・暗い表示 */
    await page.setViewportSize({ width: 390, height: 844 });
    const hmin = await page.evaluate(() => Math.min.apply(null, Array.from(document.querySelectorAll('#g-main [data-act^="ex-"]')).map((b) => b.getBoundingClientRect().height)));
    t('iPhone の幅: 補助項目の一覧のボタンは 44px 以上', hmin >= 44, hmin);
    await page.screenshot({ path: path.join(OUT, 'person_iphone.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(OUT, 'person_iphone_dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });

    /* 社内会議を止める（行がある止めた項目は CSV の列に残る・取り消しはできる・直すは出さない） */
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#ex-s-act-6', { timeout: 15000 });
    t('設定: この月分に行がある項目（移動距離・社内会議）は形を変えられない・行の無い項目（日曜出勤）は変えられる', await page.isDisabled('#ex-s-kind-0') && await page.isDisabled('#ex-s-kind-6') && !(await page.isDisabled('#ex-s-kind-1')));
    const nPut = sentOf(st, 'kintai_settings_put').length;
    await page.uncheck('#ex-s-act-6');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => document.querySelector('#ex-s-act-6') && !document.querySelector('#ex-s-act-6').checked && /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    t('社内会議を止めて保存（active:false）', sentOf(st, 'kintai_settings_put').length === nPut + 1 && sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config.extraItems[6].active === false);
    await page.click('[data-tab="person"]');
    await page.waitForSelector('[data-act="ex-void"]', { timeout: 15000 });
    const mrow = st.rows.find((x) => x.code === 'meeting' && !x.voided_at);
    t('止めた項目の行: 「止めた項目」の札・取り消すはある・直すは無い', /止めた項目/.test(await mainText(page)) && (await page.$('[data-act="ex-void"][data-id="' + mrow.id + '"]')) !== null && (await page.$('[data-act="ex-open"][data-code="meeting"]')) === null);

    /* 4. CSV */
    await page.click('[data-tab="close"]');
    await page.waitForSelector('[data-act="csv-sum"]', { timeout: 15000 });
    const sum = await readDl(page, '[data-act="csv-sum"]');
    const sl = sum.split('\r\n'), sh = cellsOf(sl[0]), s1 = cellsOf(sl.find((l) => l.indexOf('9001,') === 0) || '');
    const want = ['移動距離（km）', '日曜出勤（回）', '日曜出勤（時間）（時間）', '健診/有休（回）', '健診通勤手当なし（回）', '社内会議（時間）', '駐車場（円）'];
    t('月の集計: 末尾に7列（使う項目＋行のある止めた社内会議・行の無い止めた年末年始出勤は出さない）', JSON.stringify(sh.slice(-7)) === JSON.stringify(want), sh.slice(-8));
    t('月の集計: 今の列は前のまま（先頭は 従業員コード・氏名…、末尾の前は 実働_ の列）', sh[0] === '従業員コード' && sh[1] === '氏名' && /^実働_/.test(sh[sh.length - 8]));
    t('月の集計: 9001 は 移動距離 15.5・社内会議 1:30・ほかは 0（駐車場は整数のまま 0）', JSON.stringify(s1.slice(-7)) === JSON.stringify(['15.5', '0', '0:00', '0', '0', '1:30', '0']), s1.slice(-7));
    const day = await readDl(page, '[data-act="csv-day"]');
    const dl = day.split('\r\n'), dh = cellsOf(dl[0]), d1 = cellsOf(dl.find((l) => l.indexOf('9001,2025-12-01,') === 0) || ''), d2 = cellsOf(dl.find((l) => l.indexOf('9001,2025-12-02,') === 0) || '');
    t('日ごと: 末尾に7列・「数えなかった理由」はその前のまま', JSON.stringify(dh.slice(-7)) === JSON.stringify(want) && dh[dh.length - 8] === '数えなかった理由', dh.slice(-9));
    t('日ごと: 12/1 は 移動距離 15.5・12/2 は 社内会議 1:30（無い項目は空）', d1[d1.length - 7] === '15.5' && d1.slice(-6).every((x) => x === '') && d2[d2.length - 2] === '1:30', [d1.slice(-7), d2.slice(-7)]);
    t('書き出しの注意の窓は出ない（行の無い人・日が無い）', !alerts.some((a) => /補助項目/.test(a)), alerts);

    /* 5. 締めた月分 */
    st.locked = true;
    await page.click('[data-tab="person"]');
    await page.click('#g-reload');
    await page.waitForFunction(() => /締めた月分のため、入れることも取り消すこともできません/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    t('締めた月分: 入れる・直す・取り消すのボタンが無い（値の一覧は出る）', (await page.$('[data-act="ex-open"]')) === null && (await page.$('[data-act="ex-void"]')) === null && /移動距離 15\.5 km/.test(await mainText(page)));
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_extras/）');
process.exit(fail ? 1 : 0);
