/* check/kintai_freee_import_e2e.mjs — 勤怠管理の「freee の月の集計を取り込む」を、本物の画面（kintai.html）で通しで確かめる（2026-11-23 新設・凍結仕様 ROOT-freee-month-import.md・統合 0123）
 *
 * 実行: node check/kintai_freee_import_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定。打刻は無い＝取り込む前は要確認が残る）。本物の Supabase へは出ない。
 * 偽の DB の取り込みの関数は、統合 0123 の kintai_month_import_put・kintai_month_import_void の引数の名前と形・返す形を写す（月の読み出しは staff の行に month_import）。
 * 確かめること:
 *   1. 締めていない月分・管理者の時、「締めと出力」の「月の締め」の上に取り込みの箱がある。取り込む前は要確認が残り「まだ締められません」
 *   2. Shift_JIS の CSV（日本語の見出し）を選ぶと、突き合わせの表（取り込む2人・freee に無い職員1人・勤怠の職員に無い番号1件）が出る
 *   3. 理由が空では送らない。freee に無い職員を「勤怠なし（0）」にして取り込むと、kintai_month_import_put に3行（勤怠なしは source none・全部 0）・
 *      氏名は送らない・ファイルの指紋（64桁）・理由。読み直すと取り込んだ人の一覧に3人・要確認はありません
 *   4. 1人の取り込みを取り消す（理由）と kintai_month_import_void・その人は要確認に戻る。同じファイルを選び直すと「取り込み直します」と出て取り込み直せる
 *   5. 締めると、kintai_month_lock に送る控えの要確認が全員 0・取り込んだ人の行の値が freee の値（総労働・所定内・法定内残業・法定外・勤務日数・有休日数）と imported
 *   6. 締めた月分では取り込みの箱にファイルの選びが無い（締めてあるため取り込み・取り消しはできない）
 *   7. 取り込みの箱を PC・iPhone の幅（390px）・暗い表示で撮る（check/out/kintai_freee_import/ に置く。人の目で見る）・横にはみ出さない・画面の例外 0
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const C = require(path.join(ROOT, 'kintai-calc.js'));
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_freee_import'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } };

const YM = '2025-12';
/* freee の勤怠の CSV（日本語の見出し・Shift_JIS）。9001・9002 は勤怠の職員・9099 は勤怠の職員に無い番号・9003（見本 三太）は freee に無い */
const CSV = '従業員番号,氏名,勤務日数,総労働時間,所定内労働時間,所定外労働時間,法定内残業時間,深夜労働時間,有休日数,法定休日労働時間,欠勤日数,遅刻早退時間\r\n' +
  '9001,見本 一郎,21,170:00,168:00,2:00,0:30,0:00,1,0:00,0,0:00\r\n' +
  '9002,見本 二美,20,160:00,160:00,0:00,0:00,0:00,0,0:00,0,0:00\r\n' +
  '9099,見本 外部,3,24:00,24:00,0:00,0:00,0:00,0,0:00,0,0:00\r\n' +
  '"<img src=x onerror=window.__xss=1>","<script>window.__xss=2</script>",1,8:00,8:00,0:00,0:00,0:00,0,0:00,0,0:00\r\n';   /* 危険な値（番号・氏名）は文字のまま出る（CLAUDE.md §5） */
const FILE = { name: 'freee_kintai_mihon.csv', mimeType: 'text/csv', buffer: Buffer.from(C.encodeSjis(CSV).bytes) };
const WANT = { sK01: { workDays: 21, workMin: 10200, schedInMin: 10080, legalInOverMin: 30, legalOverMin: 90, paidDays: 1 }, sK02: { workDays: 20, workMin: 9600, schedInMin: 9600, legalInOverMin: 0, legalOverMin: 0, paidDays: 0 } };

/* 偽の DB（0123 の形） */
const imports = {};   /* staff_id → 効いている取り込み { id, ym, vals, source, created_at } */
const history = [];   /* 取り消しの印を付けた行も残す */
const sent = [];
let locked = null, nid = 0;
const VKEYS = ['workDays', 'workMin', 'schedInMin', 'legalInOverMin', 'legalOverMin', 'holidayMin', 'nightMin', 'over60Min', 'absentDays', 'lateMin', 'paidDays'];
function month(ym) {
  const m = FX.monthOf(ym);
  if (!m.ok || ym !== YM) return m;
  m.staff = m.staff.map((s) => (imports[s.staff_id] ? Object.assign({}, s, { month_import: imports[s.staff_id] }) : Object.assign({}, s)));
  m.month = locked ? { ym, locked_at: '2026-01-14T09:00:00+09:00', snapshot: locked, history: [] } : null;
  return m;
}
function importPut(p) {
  if (locked) return { ok: false, error: 'locked' };
  const per = FX.monthOf(YM).period;
  if (p.p_period_from !== per.from || p.p_period_to !== per.to) return { ok: false, error: 'periodchanged', from: per.from, to: per.to };   /* 0123: 画面が見た期間が今の期間と違えば断る */
  if (!p.p_reason || !String(p.p_reason).trim()) return { ok: false, error: 'reason' };
  if (!Array.isArray(p.p_rows) || !p.p_rows.length) return { ok: false, error: 'badshape' };
  const ids = FX.monthOf(YM).staff.map((s) => s.staff_id);
  for (const r of p.p_rows) {
    if (ids.indexOf(r.staff_id) < 0) return { ok: false, error: 'notfound', staff_id: r.staff_id };
    const v = r.vals || {};
    if (Object.keys(v).sort().join() !== VKEYS.slice().sort().join() || v.schedInMin + v.legalInOverMin + v.legalOverMin + v.holidayMin !== v.workMin) return { ok: false, error: 'badvalue', staff_id: r.staff_id };
  }
  let rep = 0;
  for (const r of p.p_rows) {
    if (imports[r.staff_id]) { history.push(Object.assign({ voided: true }, imports[r.staff_id])); rep++; }
    imports[r.staff_id] = { id: '00000000-0000-4000-8000-' + String(990000000000 + (++nid)), ym: p.p_ym, period: { from: per.from, to: per.to }, vals: r.vals, source: r.source || p.p_source, created_at: '2026-01-14T09:00:00+09:00' };
  }
  return { ok: true, count: p.p_rows.length, replaced: rep };
}
function importVoid(p) {
  if (locked) return { ok: false, error: 'locked' };
  const hit = (p.p_staff_ids || []).filter((s) => imports[s]);
  if (!hit.length) return { ok: false, error: 'notfound' };
  hit.forEach((s) => { history.push(Object.assign({ voided: true }, imports[s])); delete imports[s]; });
  return { ok: true, count: hit.length };
}

const server = await startServer(ROOT);
const base = server.url;
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((st) => { try { for (const k in st) localStorage.setItem(k, st[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: 'close', kintai_ym: YM }));
  /* シフトの読み口（SUKv.callShift）は偽物（kintai_review_e2e.mjs と同じ: 確定済みの空のシフト） */
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
        if (req.method() === 'OPTIONS') return r.handle(route);
        if (name === 'kintai_month_get') return json(month(p.p_ym));
        if (name === 'kintai_month_rev') return json('rev-' + nid + (locked ? 'L' : ''));
        if (name === 'kintai_month_import_put') { sent.push([name, p]); return json(importPut(p)); }
        if (name === 'kintai_month_import_void') { sent.push([name, p]); return json(importVoid(p)); }
        if (name === 'kintai_month_lock') { sent.push([name, p]); locked = p.p_snapshot; return json({ ok: true }); }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/kintai.html');
  await page.waitForSelector('#g-fi', { timeout: 20000 });
  const order = await page.evaluate(() => { const fi = document.getElementById('g-fi'), h = [...document.querySelectorAll('#g-main h2')].find((x) => x.textContent === '月の締め'); return !!(fi && h && (fi.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  t('取り込みの箱は「月の締め」の上・ファイルの選びがある（管理者・締めていない月分）', order && (await page.$('#fi-file')) !== null);
  const box0 = await page.textContent('#g-fi');
  t('取り込みの箱に期間を大きく出す・締め日が月末のままの知らせ', /この取り込みは 12月1日〜12月31日 の分として入ります/.test(box0) && /締め日が月末のままです。freee の期間（15日締め）と合わない時は、先に設定で締め日を変えてください/.test(box0), box0.slice(0, 400));
  t('取り込む前は要確認が残り、まだ締められない', /要確認が \d+ 件残っているため、まだ締められません/.test(await page.textContent('#g-main')));

  await page.setInputFiles('#fi-file', FILE);
  await page.waitForSelector('#g-fi [data-act="fi-go"]', { timeout: 15000 });
  const tb = await page.textContent('#g-fi');
  await page.evaluate(() => document.getElementById('g-fi').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'table_pc.png'), fullPage: false });
  t('突き合わせの表: 取り込む2人・勤怠の職員に無い番号2件・freee に無い職員1人（Shift_JIS の日本語の見出しを読めた）',
    /取り込む 2 人・取り込まない 0 件・勤怠の職員に無い番号 2 件・freee に無い職員 1 人/.test(tb) && /9099/.test(tb) && /freee に無い職員です/.test(tb) && /170:00|170：00/.test(tb.replace(/\s/g, '')), tb.slice(0, 300));
  await page.click('[data-act="fi-go"]');
  t('危険な値の番号・氏名は文字のまま出る（要素にならない・スクリプトが動かない）', (await page.$('#g-fi img')) === null && (await page.evaluate(() => window.__xss)) === undefined && /<img/.test(tb) && /<script>window.__xss=2<\/script>/.test(tb), tb.slice(0, 200));
  t('CSV に無い休暇の種類の列は 0 として扱うと知らせる（特別休暇・代休など・払いに効く列はこの CSV にある）', /CSV に無い列は 0 として扱っています（[^）]*特別休暇日数[^）]*代休日数/.test(tb) && !/0 として扱っています（[^）]*欠勤日数/.test(tb), tb.slice(0, 600));
  t('理由が空では送らない', !sent.some((x) => x[0] === 'kintai_month_import_put') && /理由を書いてください/.test(await page.textContent('#fi-msg')));
  await page.check('#g-fi input[name="fi-none"]');
  await page.waitForFunction(() => /3 人を取り込む/.test((document.querySelector('[data-act="fi-go"]') || {}).textContent || ''), null, { timeout: 10000 });
  await page.fill('#fi-reason', '12月分の freee の集計（見本）');
  await page.click('[data-act="fi-go"]');
  await page.waitForFunction(() => /この月分に取り込んである人（3 人）/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
  const put = sent.find((x) => x[0] === 'kintai_month_import_put')[1];
  const none = put.p_rows.find((r) => r.staff_id === 'sK03');
  t('kintai_month_import_put: 月分・画面が見た期間・3行・どこから freee_csv・理由・ファイルの指紋（64桁）', put.p_ym === YM && put.p_period_from === '2025-12-01' && put.p_period_to === '2025-12-31' && put.p_rows.length === 3 && put.p_source === 'freee_csv' && put.p_reason === '12月分の freee の集計（見本）' && /^[0-9a-f]{64}$/.test(put.p_file_sha), put);
  t('送る行: 値は freee の値・勤怠なしは source none で全部 0・氏名を送らない', ['sK01', 'sK02'].every((s) => Object.keys(WANT[s]).every((k) => put.p_rows.find((r) => r.staff_id === s).vals[k] === WANT[s][k]))
    && none && none.source === 'none' && Object.values(none.vals).every((v) => v === 0) && !/見本/.test(JSON.stringify(put.p_rows)), put.p_rows);
  t('読み直すと要確認はありません', /要確認はありません/.test(await page.textContent('#g-main')));
  await page.screenshot({ path: path.join(OUT, 'imported_pc.png'), fullPage: false });

  /* 1人を取り消す → 要確認に戻る → 同じファイルで取り込み直す */
  page.once('dialog', (d) => d.accept('取り違えの見本'));
  await page.check('#g-fi input[name="fi-v"][value="sK02"]');
  await page.click('[data-act="fi-void"]');
  await page.waitForFunction(() => /この月分に取り込んである人（2 人）/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
  const vd = sent.find((x) => x[0] === 'kintai_month_import_void')[1];
  t('取り消し: kintai_month_import_void に月分・職員・理由・その人は要確認に戻る', vd.p_ym === YM && JSON.stringify(vd.p_staff_ids) === '["sK02"]' && vd.p_reason === '取り違えの見本' && /要確認が \d+ 件残っているため/.test(await page.textContent('#g-main')), vd);
  await page.setInputFiles('#fi-file', FILE);
  await page.waitForSelector('#g-fi [data-act="fi-go"]', { timeout: 15000 });
  t('同じファイルを選び直すと、取り込み済みの人に「取り込み直します」', /取り込み直します/.test(await page.textContent('#g-fi')));
  await page.fill('#fi-reason', '取り込み直し（見本）');
  await page.click('[data-act="fi-go"]');
  await page.waitForFunction(() => /要確認はありません/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
  t('取り込み直すと前の取り込みは取り消しの印で残る（偽の DB の履歴: 取り消した二美・取り込み直した一郎）・効いているのは3人', history.length === 2 && Object.keys(imports).sort().join() === 'sK01,sK02,sK03', [history.length, Object.keys(imports)]);
  t('取り込み直し: 送ったのは2人（勤怠なしは選び直していない）', sent.filter((x) => x[0] === 'kintai_month_import_put')[1][1].p_rows.length === 2);

  /* iPhone の幅・暗い表示（人の目で見る） */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.getElementById('g-fi').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'box_iphone.png'), fullPage: false });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('iPhone の幅（390px）で画面が横にはみ出さない（表は箱の中で横に動く）', over <= 1, over);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(OUT, 'box_iphone_dark.png'), fullPage: false });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });

  /* 締める */
  await page.click('[data-act="lock"]');
  await page.waitForSelector('#g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
  await page.click('#g-dlg-f [data-act="lock-go"]');
  await page.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 15000 });
  const lk = sent.find((x) => x[0] === 'kintai_month_lock');
  const rows = lk ? lk[1].p_snapshot.rows : [];
  t('締め: kintai_month_lock に送る控えの要確認が全員 0', rows.length === 3 && rows.every((r) => r.reviewCount === 0), rows.map((r) => r.reviewCount));
  t('締めの控え: 取り込んだ人の値が freee の値・imported の印（勤怠なしの人も）', ['sK01', 'sK02'].every((s) => { const r = rows.find((x) => x.staff_id === s); return r && Object.keys(WANT[s]).every((k) => r[k] === WANT[s][k]) && r.paidMin === 0 && r.imported && r.imported.source === 'freee_csv'; })
    && rows.find((x) => x.staff_id === 'sK03').imported.source === 'none' && rows.find((x) => x.staff_id === 'sK03').workMin === 0, rows);
  await page.waitForFunction(() => /この月は締めてあるため、取り込み・取り消しはできません/.test(document.getElementById('g-fi').textContent), null, { timeout: 15000 });
  t('締めた月分: 取り込みの箱にファイルの選びと取り消しのボタンが無い', (await page.$('#fi-file')) === null && (await page.$('[data-act="fi-void"]')) === null);
  t('画面の例外 0', errs.length === 0, errs);
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_freee_import/）');
process.exit(fail ? 1 : 0);
