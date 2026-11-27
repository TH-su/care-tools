/* check/kintai_staffing_e2e.mjs — 勤怠管理のホームの「今日の人員配置」と設定の「人員配置の決まり」を、本物の画面（kintai.html）で通しで確かめる（2026-11-28 新設・代表者の決定 2026-11-28）
 *
 * 実行: node check/kintai_staffing_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定と、この中の架空のシフトの職員）。本物の Supabase へは出ない。今日は 2026-01-14（水）9:00（lib.mjs の FIXED_TIME）。
 *   予定: 見本 一郎（施設）・二美（訪問）は 9:00〜18:00、三太（通所）は水曜休み。打刻は無い（9:00 ちょうどなので始まりから15分の打刻待ち＝いる側）
 * 確かめること:
 *   1. 切（設定に staffCheck が無い）: ホームに出さない・シフトの職員を読まない・切のまま保存しても鍵を作らない
 *   2. 入: 足りない行だけ札（いま足りない→予定で足りない→足りている の順）・見出しの札の数・事業所の絞り込み・印刷に出さない
 *   3. シフトの職員が読めない: 「確かめられません」と理由・0人と言わない・読み直す
 *   4. 設定: 今の決まりが欄に入る・崩れた行は保存しない（窓で知らせる）・表示名を空にした行は落とす・ほかの設定の鍵を残して送る
 *   5. iPhone の幅（390px）で横にはみ出さない・押す所は 44px 以上・暗い表示で撮る（check/out/kintai_staffing/）
 * ★架空データだけ（CLAUDE.md §2-1）。決まりの数は試験のための架空の値で、施設の値ではない。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_staffing'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };
const YM = '2026-01';
const SHIFT_STAFF = [
  { id: 'sK01', name: '見本 一郎', mainDivision: '施設', qualifications: ['介護福祉士'], active: true },
  { id: 'sK02', name: '見本 二美', mainDivision: '訪問', qualifications: ['実務者研修'], serviceManager: true, active: true },
  { id: 'sK03', name: '見本 三太', mainDivision: '通所', qualifications: ['看護師'], jobTitle: '看護職員・機能訓練指導員', active: true },
];
const RULES = [
  { office: 'facility', label: '日中 職員', from: '09:00', to: '18:00', need: 1, who: 'all' },
  { office: 'facility', label: '夜間 職員', from: '21:00', to: '07:00', need: 2, who: 'all' },
  { office: 'visit', label: 'サ責', from: '09:00', to: '17:00', need: 1, who: 'sm' },
  { office: 'day', label: '看護職員', from: '09:00', to: '16:00', need: 1, who: 'nurse' },
];

async function open(browser, st, tabName, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opt || {}));
  await ctx.addInitScript((s) => { try { if (sessionStorage.getItem('__e2e_init')) return; sessionStorage.setItem('__e2e_init', '1'); for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }));
  for (const r of FX.routes) {
    if (r.match === FX.URL + '/**') {
      await ctx.route(r.match, async (route) => {
        const req = route.request(), u = req.url();
        const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
        let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        const json = (v, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
        if (req.method() === 'OPTIONS') return r.handle(route);
        if (name) st.calls.push([name, p]);
        if (name === 'kintai_month_get') { const mm = FX.monthOf(p.p_ym); if (mm && mm.ok !== false) mm.settings = { config: st.config, rev: st.rev }; return json(mm); }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (name === 'shift_pull') {
          if (st.shiftNg) return json({ ok: false, error: 'ng' });
          return json({ ok: true, entries: { staff: { data: SHIFT_STAFF, rev: 1 } } });
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
const sentOf = (st, name) => st.calls.filter((c) => c[0] === name);
/* この部品の読み（keys が staff だけ）。月の読み込みのシフトの取り込みも shift_pull を呼ぶので分けて数える */
const stfPulls = (st) => st.calls.filter((c) => c[0] === 'shift_pull' && JSON.stringify(c[1].p_keys) === '["staff"]');
const newSt = (base, config) => ({ base, calls: [], config, rev: 2 });
const toast = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('g-toast').textContent), re, { timeout: 15000 });
const rowsOf = (page) => page.$$eval('.sfb .sfl .sfr', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 切の時 —');
  {
    const st = newSt(server.url, { legal_holiday: 0 });
    const { ctx, page, errs } = await open(browser, st, 'home');
    await page.waitForSelector('.tdb', { timeout: 20000 });
    await page.waitForTimeout(600);
    t('ホームに今日の人員配置を出さない', !(await page.$('.sfb')));
    t('シフトの職員を読まない', stfPulls(st).length === 0, stfPulls(st).length);
    await page.click('.tabs [data-tab="settings"]');
    await page.waitForSelector('#s-staffCheck', { timeout: 15000 });
    t('設定のタブに入り切りの欄（初めは切）と空の決まりの行が2つ', !(await page.isChecked('#s-staffCheck')) && (await page.$$('.sfs-r')).length === 2);
    await page.click('[data-act="save-set"]');
    await toast(page, '設定を保存しました');
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    t('切のまま保存しても staffCheck・staffRules の鍵を作らない', put && !('staffCheck' in put[1].p_config) && !('staffRules' in put[1].p_config) && put[1].p_config.legal_holiday === 0, put && put[1].p_config);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 2. 入の時 —');
  {
    const st = newSt(server.url, { legal_holiday: 0, certAlert: true, staffCheck: true, staffRules: RULES });
    const { ctx, page, errs } = await open(browser, st, 'home');
    await page.waitForSelector('.sfb .sfl', { timeout: 20000 });
    const rows = await rowsOf(page);
    t('4行（夜間は今日の夜の分だけ・前の日の夜の分は 7:00 に終わったので出さない）', rows.length === 4, rows);
    t('並び: いま足りない（通所の看護職員・三太は休み）→ 予定で足りない（夜間 0/2）→ 足りている', /看護職員/.test(rows[0]) && /いま足りない/.test(rows[0]) && /夜間 職員/.test(rows[1]) && /予定で足りない/.test(rows[1]) && /21:00 に 0名/.test(rows[1]) && /足りている/.test(rows[2]) && /足りている/.test(rows[3]), rows);
    t('夜間は「21:00〜翌7:00」と書く', /21:00〜翌7:00/.test(rows[1]), rows[1]);
    t('9:00 ちょうどの打刻待ちはいる側（施設の日中 1/1・訪問のサ責 1/1）', rows.some((r) => /日中 職員/.test(r) && /いま 1名/.test(r)) && rows.some((r) => /サ責/.test(r) && /いま 1名/.test(r)), rows);
    t('見出しの札は足りない数（2）・足りている行は札にしない', /足りない 2/.test(await page.textContent('.sfb .tdb-hd')) && (await page.$$('.sfb .sfl .tag')).length === 2);
    t('シフトの職員は1回だけ読む（描き直しで読み直さない）', stfPulls(st).length === 1, stfPulls(st).length);
    await page.screenshot({ path: path.join(OUT, 'home_pc.png'), fullPage: true });
    const sec = await page.$('.tdw');
    if (sec) await sec.screenshot({ path: path.join(OUT, 'home_pc_today.png') });
    await page.click('[data-act="tdof"][data-o="day"]');
    await page.waitForFunction(() => document.querySelectorAll('.sfb .sfl .sfr').length === 1, null, { timeout: 10000 });
    t('事業所の絞り込み（今日の出勤状況と同じ札）で通所の行だけ', /看護職員/.test((await rowsOf(page))[0]));
    await page.click('[data-act="tdof"][data-o="visit"]');
    await page.waitForFunction(() => document.querySelectorAll('.sfb .sfl .sfr').length === 1, null, { timeout: 10000 });
    t('訪問に絞ると訪問の行だけ', /サ責/.test((await rowsOf(page))[0]));
    await page.click('[data-act="tdof"][data-o=""]');
    await page.emulateMedia({ media: 'print' });
    t('印刷には出さない', await page.$eval('.sfb', (e) => getComputedStyle(e).display === 'none'));
    await page.emulateMedia({ media: 'screen' });
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 3. シフトの職員が読めない —');
  {
    const st = newSt(server.url, { legal_holiday: 0, staffCheck: true, staffRules: RULES });
    st.shiftNg = true;
    const { ctx, page, errs } = await open(browser, st, 'home');
    await page.waitForFunction(() => /シフトの職員を読めませんでした/.test((document.querySelector('.sfb') || {}).textContent || ''), null, { timeout: 20000 });
    const rows = await rowsOf(page);
    t('どの行も「確かめられません」・人数は出さない・足りないの札も出さない', rows.length === 4 && rows.every((r) => /確かめられません/.test(r) && !/\d名/.test(r.replace(/必要 \d+名/, ''))) && !(await page.$('.sfb .tag')), rows);
    st.shiftNg = false;
    await page.click('[data-act="sf-reload"]');
    await page.waitForFunction(() => /いま足りない/.test((document.querySelector('.sfb') || {}).textContent || ''), null, { timeout: 15000 });
    t('「読み直す」で読めると数える', stfPulls(st).length === 2, stfPulls(st).length);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 4. 設定の欄 —');
  {
    const st = newSt(server.url, { legal_holiday: 0, certAlert: true, staffCheck: true, staffRules: RULES });
    const { ctx, page, errs, alerts } = await open(browser, st, 'settings');
    await page.waitForSelector('#sf-l-0', { timeout: 20000 });
    t('今の決まりが欄に入る（4行＋空の2行）', (await page.$$('.sfs-r')).length === 6 && (await page.inputValue('#sf-l-1')) === '夜間 職員' && (await page.inputValue('#sf-f-1')) === '21:00' && (await page.inputValue('#sf-n-1')) === '2' && (await page.inputValue('#sf-w-2')) === 'sm');
    t('事業所の選択肢は施設情報の名前', (await page.$$eval('#sf-o-0 option', (os) => os.length)) === 3);
    await page.screenshot({ path: path.join(OUT, 'settings_pc.png'), fullPage: true });
    /* 崩れた行（人数0）は保存しない */
    await page.fill('#sf-l-4', '見本 機能訓練');
    await page.selectOption('#sf-o-4', 'day');
    await page.fill('#sf-f-4', '10:00'); await page.fill('#sf-t-4', '12:00'); await page.fill('#sf-n-4', '0');
    await page.selectOption('#sf-w-4', 'job'); await page.fill('#sf-k-4', '機能訓練指導員');
    const n0 = sentOf(st, 'kintai_settings_put').length;
    await page.click('[data-act="save-set"]');
    await page.waitForTimeout(500);
    t('人数0の行は窓で知らせて保存しない', sentOf(st, 'kintai_settings_put').length === n0 && alerts.some((a) => /人員配置の決まり/.test(a) && /5行目/.test(a)), alerts);
    await page.fill('#sf-n-4', '1');
    await page.fill('#sf-l-0', '');   /* 1行目を落とす */
    await page.click('[data-act="save-set"]');
    await toast(page, '設定を保存しました');
    const cfg = sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config;
    const lb = (cfg.staffRules || []).map((r) => r.label);
    t('表示名を空にした行は落とし、足した行は語つきで入る', lb.join() === '夜間 職員,サ責,看護職員,見本 機能訓練' && cfg.staffRules[3].word === '機能訓練指導員' && cfg.staffRules[3].office === 'day', cfg.staffRules);
    t('ほかの設定の鍵（legal_holiday・certAlert）を残して送る・入り切りは入のまま', cfg.legal_holiday === 0 && cfg.certAlert === true && cfg.staffCheck === true, cfg);
    await page.uncheck('#s-staffCheck');
    await page.click('[data-act="save-set"]');
    await toast(page, '設定を保存しました');
    const cfg2 = sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config;
    t('切にすると staffCheck は false・決まりは残す', cfg2.staffCheck === false && (cfg2.staffRules || []).length === 4, cfg2);
    await page.emulateMedia({ media: 'print' });
    t('設定のタブの印刷に、足した欄（入り切り・決まり）を出さない', await page.evaluate(() => ['label[for="s-staffCheck"]', '#s-staffCheck', '.sfs-lb', '.sfs'].every((q) => { const e = document.querySelector(q); return e && !e.offsetParent && getComputedStyle(e.closest('.no-print') || e).display === 'none'; })));
    await page.emulateMedia({ media: 'screen' });
    const big = await page.evaluate(() => { const K = window.KintaiStaffing; const cfg = {}; for (let i = 0; i < 300; i++) cfg['x' + i] = 'y'.repeat(20); return K.fitsConfig(cfg); });
    t('8KB の確かめの関数が画面で使える（大きい設定は偽）', big === false);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 5. iPhone の幅・暗い表示 —');
  {
    const st = newSt(server.url, { legal_holiday: 0, staffCheck: true, staffRules: RULES });
    /* 設定のタブは、この機能を足す前から iPhone の幅で少しはみ出す（main の bd13b60 で 19px・この機能を切っても同じ）。足した欄で増えないことを確かめる */
    let base = 0;
    {
      const { ctx, page } = await open(browser, newSt(server.url, { legal_holiday: 0 }), 'settings', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.waitForSelector('#s-legal', { timeout: 20000 });
      base = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await ctx.close();
    }
    for (const tabName of ['home', 'settings']) {
      const { ctx, page, errs } = await open(browser, st, tabName, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true });
      await page.waitForSelector(tabName === 'home' ? '.sfb .sfl' : '#sf-l-0', { timeout: 20000 });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const sel = tabName === 'home' ? '.sfb button' : '.sfs input, .sfs select, #s-staffCheck';
      const small = await page.$$eval(sel, (els) => els.filter((e) => e.offsetParent && e.type !== 'checkbox' && e.getBoundingClientRect().height < 44).map((e) => e.id || e.className));
      const lim = tabName === 'home' ? 0 : base;
      t((tabName === 'home' ? 'ホーム: 横にはみ出さない（' + ov + 'px）' : '設定: 足した欄ではみ出しが増えない（' + ov + 'px・足す前 ' + base + 'px）') + '・押す所は 44px 以上', ov <= lim && small.length === 0, { ov, base, small });
      if (tabName === 'home') { const s = await page.$('.sfb'); if (s) await s.screenshot({ path: path.join(OUT, 'home_iphone_dark.png') }); }
      if (tabName === 'home') {
        /* 読めない時の「読み直す」も 44px 以上 */
        st.shiftNg = true;
        await page.evaluate(() => { const b = document.getElementById('g-reload'); if (b) b.click(); });
        await page.waitForSelector('[data-act="sf-reload"]', { timeout: 20000 });
        const h = await page.$eval('[data-act="sf-reload"]', (e) => e.getBoundingClientRect().height);
        t('読めない時の「読み直す」も 44px 以上（' + Math.round(h) + 'px）', h >= 44);
        st.shiftNg = false;
      }
      else await page.screenshot({ path: path.join(OUT, 'settings_iphone_dark.png'), fullPage: true });
      t('画面の例外 0', errs.length === 0, errs);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
