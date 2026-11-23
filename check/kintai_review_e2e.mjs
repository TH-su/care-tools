/* check/kintai_review_e2e.mjs — 勤怠管理の「締めの前の要確認を1件ずつ決める」を、本物の画面（kintai.html）で通しで確かめる（2026-11-21 新設・本人指示・統合 0120）
 *
 * 実行: node check/kintai_review_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定に、早出・残業・控えの打刻を足す）。本物の Supabase へは出ない。
 * 確かめること:
 *   1. 要確認が残る月分（2025-12）で「この月を締める」を押すと、「締められません」の帯が出て「締める」のボタンが無い
 *   2. 「要確認を1件目から決める」で決める窓が開き、何も選ばずに「決めて次へ」を押しても送らない
 *   3. 早出を「認めない」＋理由で送ると early_ng に理由が入り、次の1件が開く。残業は「認める」で overtime_ok、控えだけの日は「認める」で確認済み
 *   4. 全部決めた後に締めると、kintai_month_lock に送る控えの要確認が全員 0
 *   5. 日ごとの CSV の末尾に「数えなかった時間」「数えなかった理由」が出て、認めなかった日に理由が入る
 *   6. 決める窓を PC・iPhone の幅（390px）・暗い表示で撮る（check/out/kintai_review/ に置く。人の目で見る）
 *   7. v6（2026-11-24・統合 0125）: ホームの「知らせる」（まだ出勤していない・退勤の打刻漏れ・スマホ未登録）→ SUDialog の確かめ → 送る形 → 「知らせ済み」／
 *      申請のタブの来月分の休暇の行と「承認」「差し戻し」
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_review'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } };

const YM = '2025-12';
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm, src) => ({ id: '00000000-0000-4000-8000-' + String(900000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: src || 'tablet', created_at: iso(d, hm), voided_at: null });
/* 予定は 9:00〜18:00（見本の月分）。12/1 一郎: 8:20 出勤（早出）・12/2 一郎: 18:50 退勤（残業）・12/3 二美: 控えの打刻（offline）・ほかの平日はちょうど */
function punchesOf(base) {
  const out = [];
  base.schedule.filter((r) => r.kind === 'work').forEach((r) => {
    const d = r.work_date;
    if (r.staff_id === 'sK01' && d === '2025-12-01') { out.push(P('sK01', 'in', d, '08:20'), P('sK01', 'out', d, '18:00')); return; }
    if (r.staff_id === 'sK01' && d === '2025-12-02') { out.push(P('sK01', 'in', d, '09:00'), P('sK01', 'out', d, '18:50')); return; }
    if (r.staff_id === 'sK02' && d === '2025-12-03') { out.push(P('sK02', 'in', d, '09:00', 'offline'), P('sK02', 'out', d, '18:00')); return; }
    out.push(P(r.staff_id, 'in', d, '09:00'), P(r.staff_id, 'out', d, '18:00'));
  });
  return out;
}
const days = {};   /* 'sid|date' → 日の行（kintai_day_put で書く） */
const sent = [];
let locked = null, PUN = null;
function month(ym) {
  const m = FX.monthOf(ym);
  if (!m.ok || ym !== YM) return m;
  if (!PUN) PUN = punchesOf(m);
  m.punches = PUN;
  m.days = Object.keys(days).map((k) => days[k]);
  m.month = locked ? { ym, locked_at: '2026-01-14T09:00:00+09:00', snapshot: locked, history: [] } : null;
  return m;
}

const server = await startServer(ROOT);
const base = server.url;
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((st) => { try { for (const k in st) localStorage.setItem(k, st[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: 'close', kintai_ym: YM }));
  /* シフトの読み口（SUKv.callShift）は偽物にする: 確定済みの空のシフトを返す（取り込みは通り、予定は月の読み出しの架空の行を使う＝締めのボタンが出る） */
  await ctx.addInitScript((ym) => {
    let kv;
    Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
      kv = v;
      if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
    } });
  }, YM);
  for (const r of FX.routes) {
    if (r.match === FX.URL + '/**') {
      await ctx.route(r.match, (route) => {
        const req = route.request(), u = req.url();
        const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
        let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
        if (req.method() !== 'OPTIONS' && name === 'kintai_month_get') return json(month(p.p_ym));
        if (req.method() !== 'OPTIONS' && name === 'kintai_month_rev') return json('rev-' + Object.keys(days).length + (locked ? 'L' : ''));
        if (req.method() !== 'OPTIONS' && name === 'kintai_day_put') {
          sent.push(['kintai_day_put', p]);
          const k = p.p_staff_id + '|' + p.p_date, cur = days[k] || { staff_id: p.p_staff_id, work_date: p.p_date, rev: 0, early_ok: false, overtime_ok: false, break_min: null, note: null, day_mark: null, early_from: null, ot_until: null, early_ng: null, ot_ng: null };
          if ((cur.rev || 0) !== p.p_rev) return json({ ok: false, error: 'conflict' });
          days[k] = Object.assign({}, cur, p.p_patch, { rev: (cur.rev || 0) + 1 });
          return json({ ok: true, rev: days[k].rev });
        }
        if (req.method() !== 'OPTIONS' && name === 'kintai_month_lock') { sent.push(['kintai_month_lock', p]); locked = p.p_snapshot; return json({ ok: true }); }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/kintai.html');
  await page.waitForSelector('[data-act="lock"]', { timeout: 20000 });
  const reviewBand = await page.textContent('#g-main');
  t('締めと出力: 要確認が残る間は「まだ締められません」の帯と「要確認を1件目から決める」', /要確認が 3 件残っているため、まだ締められません/.test(reviewBand) && (await page.$('#g-main [data-act="rvd-start"]')) !== null, reviewBand.slice(0, 200));

  await page.click('[data-act="lock"]');
  await page.waitForSelector('#g-dlg[open]');
  const lockBody = await page.textContent('#g-dlg-b');
  t('締めの窓: 「締められません」の帯・「締める」のボタンが無い', /要確認が 3 件（2 人）残っているため、締められません/.test(lockBody) && (await page.$('#g-dlg-f [data-act="lock-go"]')) === null, lockBody.slice(0, 200));
  await page.screenshot({ path: path.join(OUT, 'lock_blocked_pc.png') });

  await page.click('#g-dlg-b [data-act="rvd-start"]');
  await page.waitForFunction(() => /の要確認を決める/.test(document.getElementById('g-dlg-h').textContent));
  const h1 = await page.textContent('#g-dlg-h');
  t('決める窓: 1件目（12/1 見本 一郎・早出）が開く・ラジオは何も選んでいない', /見本 一郎 さん　12\/01/.test(h1) && (await page.$$('#g-dlg-b input[type=radio]:checked')).length === 0 && /出勤の打刻 08:20・予定の開始 09:00/.test(await page.textContent('#g-dlg-b')), h1);
  await page.screenshot({ path: path.join(OUT, 'decide_pc.png') });
  await page.click('[data-act="rvd-save"]');
  t('決める窓: 何も選ばずに「決めて次へ」では送らない', sent.length === 0 && /早出を「認める」か「認めない」かを選んでください/.test(await page.textContent('#e-msg')));
  await page.check('input[name="d-em"][value="ng"]');
  await page.click('[data-act="rvd-save"]');
  t('決める窓: 認めない＋理由が空では送らない', sent.length === 0 && /認めない理由を書いてください/.test(await page.textContent('#e-msg')));
  await page.click('#g-dlg-b [data-act="reason"][data-r="指示・申請が無い"]');
  await page.click('[data-act="rvd-save"]');
  await page.waitForFunction(() => /12\/02/.test(document.getElementById('g-dlg-h').textContent), null, { timeout: 15000 });
  const s1 = sent[0] && sent[0][1];
  t('早出を認めない: early_ng に理由・p_reason も同じ・次の1件（12/2 残業）が開く', s1 && s1.p_patch.early_ng === '指示・申請が無い' && s1.p_reason === '指示・申請が無い' && s1.p_staff_id === 'sK01' && s1.p_date === '2025-12-01', s1);

  await page.check('input[name="d-om"][value="ok"]');
  await page.click('[data-act="rvd-save"]');
  await page.waitForFunction(() => /見本 二美 さん　12\/03/.test(document.getElementById('g-dlg-h').textContent), null, { timeout: 15000 });
  t('残業を認める: overtime_ok だけを送り、理由の空は決まった文', JSON.stringify(sent[1][1].p_patch) === '{"overtime_ok":true}' && sent[1][1].p_reason === '締めの前の確かめで認めた', sent[1]);
  const b3 = await page.textContent('#g-dlg-b');
  t('控えの打刻だけの日: 早出・残業の欄は無く「認める（このまま数える・確認済みにする）」だけ', /通信できない時の打刻/.test(b3) && /認める（このまま数える・確認済みにする）/.test(b3) && (await page.$('input[name="d-em"]')) === null);

  /* iPhone の幅・暗い表示でも撮る（人の目で見る） */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(OUT, 'decide_iphone.png'), fullPage: false });
  const over = await page.evaluate(() => document.getElementById('g-dlg').scrollWidth - document.getElementById('g-dlg').clientWidth);
  t('iPhone の幅（390px）で決める窓が横にはみ出さない', over <= 1, over);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(OUT, 'decide_iphone_dark.png'), fullPage: false });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.check('input[name="d-ck"][value="ok"]');
  await page.click('[data-act="rvd-save"]');
  await page.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 15000 });
  t('控えの日を認める: day_mark checked', JSON.stringify(sent[2][1].p_patch) === '{"day_mark":"checked"}', sent[2]);
  await page.waitForFunction(() => /要確認はありません/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
  t('全部決めると「要確認はありません」', true);

  await page.click('[data-act="lock"]');
  await page.waitForSelector('#g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
  await page.click('#g-dlg-f [data-act="lock-go"]');
  await page.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 15000 });
  const lk = sent.find((x) => x[0] === 'kintai_month_lock');
  t('締め: kintai_month_lock に送る控えの要確認が全員 0', lk && Array.isArray(lk[1].p_snapshot.rows) && lk[1].p_snapshot.rows.every((r) => r.reviewCount === 0) && lk[1].p_snapshot.rows.length === 3, lk && lk[1].p_snapshot.rows.map((r) => r.reviewCount));

  /* 日ごとの CSV（UTF-8） */
  await page.waitForSelector('[data-act="csv-day"], [data-act="csv"]', { timeout: 15000 }).catch(() => null);
  const btn = await page.$('[data-act="csv-day"]') || await page.$('button:has-text("日ごと")');
  let csv = '';
  if (btn) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), btn.click()]);
    csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  }
  const lines = csv.split('\r\n'), head = (lines[0] || '').split(','), iU = head.indexOf('数えなかった時間'), iW = head.indexOf('数えなかった理由');
  const r1 = lines.find((l) => l.indexOf('9001,2025-12-01') === 0) || '';
  t('日ごとの CSV: 末尾に「数えなかった時間」「数えなかった理由」・12/1 は 0:40 と「早出：指示・申請が無い」', iU === head.length - 2 && iW === head.length - 1 && r1.split(',')[iU] === '0:40' && r1.split(',')[iW] === '早出：指示・申請が無い', [head.slice(-3), r1]);
  t('画面の例外 0', errs.length === 0, errs);

  /* ── v6（2026-11-24・統合 0125）: ホームの「知らせる」と申請のタブの休暇の行を、本物の画面と SUDialog の窓で通す ──
     時計は 2026-01-14 10:00（予定 9:00 の15分後を過ぎた＝まだ出勤していない）。1/13 の見本 一郎は出勤だけ（退勤の打刻漏れ）。
     スマホを登録しているのは見本 一郎だけ（ほかの人は「スマホ未登録」）。知らせ・申請・スマホの一覧は偽の口（架空の職員だけ） */
  {
    const YM6 = '2026-01', TD6 = '2026-01-14';
    const notices = [], sent6 = [];
    const ctx6 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx6.addInitScript((st) => { try { for (const k in st) localStorage.setItem(k, st[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: 'home', kintai_ym: YM6 }));
    await ctx6.addInitScript((ym) => {
      let kv;
      Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
        kv = v;
        if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
      } });
    }, YM6);
    const LVROW = { id: '00000000-0000-4000-8000-0000000c6e01', staff_id: 'sK02', name: '見本 二美', staff_active: true, kind: 'leave', work_date: '2026-02-03', ym: '2026-02', body: { type: 'special', type_code: 'keicho', half: true }, reason: '見本の理由', status: 'pending', rev: 1, created_at: '2026-01-13T10:00:00+09:00' };
    for (const r of FX.routes) {
      if (r.match === FX.URL + '/**') {
        await ctx6.route(r.match, (route) => {
          const req = route.request(), u = req.url();
          const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
          let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
          const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
          const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
          if (req.method() === 'OPTIONS') return r.handle(route);
          if (name === 'kintai_month_get') {
            const mm = FX.monthOf(p.p_ym);
            if (mm.ok && p.p_ym === YM6) mm.punches = [P('sK01', 'in', '2026-01-13', '09:00')];
            return json(mm);
          }
          if (name === 'kintai_notices_list') { sent6.push([name, p]); return json({ ok: true, rows: notices.slice() }); }
          if (name === 'kintai_self_devices') return json({ ok: true, devices: [{ id: 1, staff_id: 'sK01', created_at: '2026-01-05T10:00:00+09:00', last_used_at: '2026-01-13T10:00:00+09:00', revoked_at: null, state: 'active' }], codes: [] });
          if (name === 'kintai_notice_add') {
            sent6.push([name, p]);
            const id = '00000000-0000-4000-8000-0000000c6f0' + notices.length;
            notices.push({ id, staff_id: p.p_staff_id, kind: p.p_kind, work_date: p.p_work_date, created_by: 'check-office@example.invalid', created_at: TD6 + 'T10:01:00+09:00', seen_at: null });
            return json({ ok: true, id, dup: false });
          }
          if (name === 'kintai_requests_list') return json({ ok: true, rows: p.p_status === 'pending' || p.p_status === null ? [LVROW] : [], pending: 1, month_confirmed: p.p_ym ? 0 : null, active_staff: 3 });
          return r.handle(route);
        });
      } else await ctx6.route(r.match, r.handle);
    }
    const pg = await ctx6.newPage();
    await pg.clock.setFixedTime(new Date('2026-01-14T10:00:00+09:00'));
    const errs6 = [];
    pg.on('pageerror', (e) => errs6.push(String(e)));
    await pg.goto(base + '/kintai.html');
    await pg.waitForSelector('.hnt [data-act="nt-add"]', { timeout: 20000 });
    const ntTxt = await pg.textContent('#g-main');
    t('v6 ホーム: 見本 一郎の「まだ出勤していない」と 1/13 の退勤の打刻漏れに「知らせる」', (await pg.$('[data-act="nt-add"][data-sid="sK01"][data-kind="not_in"][data-date="2026-01-14"]')) !== null
      && (await pg.$('[data-act="nt-add"][data-sid="sK01"][data-kind="missing"][data-date="2026-01-13"]')) !== null, ntTxt.slice(0, 300));
    t('v6 ホーム: スマホを登録していない人は「スマホ未登録」でボタンなし', /スマホ未登録/.test(ntTxt) && (await pg.$('[data-act="nt-add"][data-sid="sK02"]')) === null);
    await pg.screenshot({ path: path.join(OUT, 'notice_home_pc.png') });
    await pg.click('[data-act="nt-add"][data-sid="sK01"][data-kind="not_in"]');
    await pg.waitForSelector('dialog.sud-dlg[open]', { timeout: 10000 });
    const dq = await pg.textContent('dialog.sud-dlg[open] .sud-msg');
    t('v6 確かめの窓（SUDialog）: 「見本 一郎 さんの本人の画面に「1月14日の出勤の打刻がまだありません」と出します」', dq.indexOf('見本 一郎 さんの本人の画面に「1月14日の出勤の打刻がまだありません」と出します') === 0, dq);
    await pg.screenshot({ path: path.join(OUT, 'notice_confirm_pc.png') });
    /* 時計を止めた画面では、窓の「開いてすぐの押下は受けない」（su-dialog.js の tooSoon・performance.now）が進まないので、初めから合っている OK を Enter で押す */
    await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => /知らせ済み/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const ad = sent6.find((x) => x[0] === 'kintai_notice_add');
    t('v6 送る: 人・日・種類だけ → 行に「知らせ済み 10:01・まだ見ていません」と「取り消す」', ad && JSON.stringify(ad[1]) === JSON.stringify({ p_staff_id: 'sK01', p_work_date: TD6, p_kind: 'not_in' })
      && /知らせ済み 10:01・まだ見ていません/.test(await pg.textContent('#g-main')) && (await pg.$('[data-act="nt-void"]')) !== null, ad);
    await pg.setViewportSize({ width: 390, height: 844 });
    const nh = await pg.evaluate(() => Math.min.apply(null, Array.from(document.querySelectorAll('.hnt button')).map((b) => b.getBoundingClientRect().height)));
    t('v6 iPhone の幅: 「知らせる」「取り消す」は 44px 以上', nh >= 44, nh);
    await pg.screenshot({ path: path.join(OUT, 'notice_home_iphone.png'), fullPage: true });
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.click('[data-tab="requests"]');
    await pg.waitForFunction(() => /休暇: 特別休暇/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    const rq = await pg.textContent('#g-main');
    t('v6 申請のタブ: 来月分の休暇の行「休暇: 特別休暇（慶弔・半日）」と「承認」「差し戻し」', /休暇: 特別休暇（慶弔・半日）/.test(rq) && (await pg.$('[data-act="rq-ok"]')) !== null && (await pg.$('[data-act="rq-ng"]')) !== null, rq.slice(0, 400));
    await pg.screenshot({ path: path.join(OUT, 'leave_request_pc.png') });
    t('v6 画面の例外 0', errs6.length === 0, errs6);
    await ctx6.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_review/）');
process.exit(fail ? 1 : 0);
