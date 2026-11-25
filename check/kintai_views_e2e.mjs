/* check/kintai_views_e2e.mjs — 勤怠管理の「年別」「事業所別」「休日」のタブを、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設・ROOT-v7 段B・段C）
 *
 * 実行: node check/kintai_views_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定）。本物の Supabase へは出ない。月の読み出しには 150ms の遅れを入れて速さを測る。
 * 確かめること:
 *   1. 入り切りが切（設定に plusViews が無い）: タブのボタンが無い・前に年別を開いていてもホーム・画面の例外 0
 *   2. 入: 年別に12か月分が並ぶ・ほかの月分は同時に3本まで読む・今の月の値は「月の一覧」の総労働と同じ・読み込みの秒を出す
 *      再読み込みで年別のまま（幅も戻る）・幅を3か月にすると列が3つ
 *   3. 事業所別: 事業所の実働の和＝全体
 *   4. 休日: 国の祝日の数・会社の休日を足す（ほかの設定の鍵は残す）・止める・設定のタブで切にする
 *   5. iPhone の幅（390px）で横にはみ出さない・押す所は 44px 以上・暗い表示で撮る（check/out/kintai_views/）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_views'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };
const YM = '2025-12', DELAY = 150;
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: '00000000-0000-4000-8000-' + String(920000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
/* 平日は予定どおり 9:00〜18:00・月の初めの日だけ 19:30 まで（残業を認めていないので数える時間は予定まで） */
const punOf = (ym) => { const m = FX.monthOf(ym), out = []; (m.schedule || []).filter((r) => r.kind === 'work').forEach((r) => out.push(P(r.staff_id, 'in', r.work_date, '09:00'), P(r.staff_id, 'out', r.work_date, '18:00'))); return out; };
const toMin = (s) => { const m = /^(\d+):(\d{2})$/.exec(String(s).trim()); return m ? +m[1] * 60 + +m[2] : NaN; };

async function open(browser, st, tabName, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opt || {}));
  await ctx.addInitScript((s) => { try { if (sessionStorage.getItem('__e2e_init')) return; sessionStorage.setItem('__e2e_init', '1'); for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }, st.ls || {}));
  for (const r of FX.routes) {
    if (r.match === FX.URL + '/**') {
      await ctx.route(r.match, async (route) => {
        const req = route.request(), u = req.url();
        const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
        let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
        if (req.method() === 'OPTIONS') return r.handle(route);
        if (name) st.calls.push([name, p]);
        if (name === 'kintai_month_get') {
          st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
          await new Promise((res) => setTimeout(res, DELAY));
          st.inflight--;
          const mm = FX.monthOf(p.p_ym);
          if (mm && mm.ok !== false) { mm.settings = { config: st.config, rev: st.rev }; mm.punches = punOf(p.p_ym); }
          return json(mm);
        }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
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
const newSt = (base, config) => ({ base, calls: [], config, rev: 2, inflight: 0, maxInflight: 0 });

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 切の時 —');
  {
    const st = newSt(server.url, { legal_holiday: 0 });
    const { ctx, page, errs } = await open(browser, st, 'year');
    await page.waitForSelector('.tabs button[data-tab="home"][aria-selected="true"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    t('タブのボタン（年別・事業所別・休日）が無い', (await page.$$('.tabs button[data-tab="year"], .tabs button[data-tab="site"], .tabs button[data-tab="holiday"]')).length === 0);
    t('前に年別を開いていた端末もホームを出す', (await page.getAttribute('.tabs button[data-tab="home"]', 'aria-selected')) === 'true');
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#s-plusViews', { timeout: 15000 });
    t('設定のタブに入り切りの欄（初めは切）', !(await page.isChecked('#s-plusViews')));
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    t('切のまま保存しても plusViews の鍵を作らない', put && !('plusViews' in put[1].p_config) && put[1].p_config.legal_holiday === 0, put && put[1].p_config);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 2〜4. 入の時 —');
  {
    const st = newSt(server.url, { legal_holiday: 0, plusViews: true, csvTime: 'hmm' });
    const { ctx, page, errs, alerts } = await open(browser, st, 'grid');
    await page.waitForSelector('table.grid tbody tr', { timeout: 20000 });
    t('タブのボタンが「個人の月」の後・「職員と番号」の前に3つ', (await page.$$eval('.tabs button', (bs) => bs.map((b) => b.getAttribute('data-tab')).join())).indexOf('person,year,site,holiday,staff') >= 0);
    const grid = await page.$$eval('table.grid tbody tr', (rs) => rs.map((r) => [r.querySelector('td.nm button').textContent.trim(), r.querySelector('td.sr2').textContent.trim()]));
    /* 月の一覧は36協定の印のために有給の月分を裏で読む。それが静まってから年別を開く（年別の読み出しだけを数える） */
    for (let last = -1, k = 0; k < 40; k++) { const n0 = sentOf(st, 'kintai_month_get').length; if (n0 === last && st.inflight === 0) break; last = n0; await page.waitForTimeout(500); }
    st.maxInflight = 0;
    const getsBefore = sentOf(st, 'kintai_month_get').length;
    const t0 = Date.now();
    await page.click('[data-tab="year"]');
    await page.waitForFunction(() => /か月分を [\d.]+ 秒で読みました/.test(document.getElementById('g-main').textContent), null, { timeout: 30000 });
    const ms = Date.now() - t0;
    const got = sentOf(st, 'kintai_month_get').slice(getsBefore).map((c) => c[1].p_ym);
    t('年別: 今の月分は読み直さず、ほかの11か月分を読む', got.length === 11 && got.indexOf(YM) < 0 && new Set(got).size === 11, got);
    t('同時に読むのは3本まで（' + st.maxInflight + '）', st.maxInflight <= 3 && st.maxInflight >= 2, st.maxInflight);
    console.log('    （速さ: 1本 ' + DELAY + 'ms の遅れで 11か月分を読み終えて描くまで ' + ms + 'ms・1本ずつなら約 ' + (DELAY * 11) + 'ms）');
    t('速さ: 11か月分を ' + ms + 'ms（1本ずつの 0.6 倍より速い）', ms < DELAY * 11 * 0.6 + 400, ms);
    const head = await page.$$eval('table.mt-y thead th', (ths) => ths.map((x) => x.textContent));
    t('列は 氏名・事業所・12か月分・合計', head.length === 15 && /^1月分/.test(head[2]) && /^12月分/.test(head[13]) && head[14] === '合計', head);
    const yr = await page.$$eval('table.mt-y tbody tr', (rs) => rs.map((r) => { const td = r.querySelectorAll('td'); return [td[0].textContent.trim(), td[td.length - 2].textContent.trim()]; }));
    t('今の月分の値は「月の一覧」の総労働と同じ（並びも同じ）', JSON.stringify(yr) === JSON.stringify(grid), [yr, grid]);
    await page.screenshot({ path: path.join(OUT, 'year_pc.png'), fullPage: true });
    /* 再読み込みで年別のまま・幅と項目が戻る（初めの控えは1回目の読み込みの時だけ入れる） */
    await page.selectOption('#vw-n', '3');
    await page.selectOption('#vw-item', 'nightMin');
    await page.reload();
    await page.waitForSelector('table.mt-y thead th', { timeout: 20000 });
    await page.waitForTimeout(800);
    t('再読み込みでも年別のまま・幅3か月・項目は深夜', (await page.getAttribute('.tabs button[data-tab="year"]', 'aria-selected')) === 'true' && (await page.$$('table.mt-y thead th')).length === 6 && (await page.inputValue('#vw-item')) === 'nightMin' && (await page.inputValue('#vw-n')) === '3');
    t('端末に残した鍵の値は決まった値だけ', JSON.stringify(await page.evaluate(() => [localStorage.getItem('kintai_vw_n'), localStorage.getItem('kintai_vw_item'), localStorage.getItem('kintai_tab')])) === JSON.stringify(['3', 'nightMin', 'year']));

    console.log('\n— 3. 事業所別 —');
    await page.click('[data-tab="site"]');
    await page.waitForSelector('table.mt-s tfoot', { timeout: 15000 });
    const sx = await page.$$eval('table.mt-s tbody tr', (rs) => rs.map((r) => Array.from(r.querySelectorAll('td')).map((x) => x.textContent.trim())));
    const tot = await page.$$eval('table.mt-s tfoot th', (ths) => ths.map((x) => x.textContent.trim()));
    const wSum = sx.reduce((a, r) => a + toMin(r[4]), 0);
    t('事業所の行（施設・訪問・通所）の実働の和＝全体', sx.length === 3 && wSum === toMin(tot[4]) && wSum > 0, [sx, tot]);
    t('全体の実働＝「月の一覧」の総労働の和', toMin(tot[4]) === grid.reduce((a, r) => a + toMin(r[1]), 0), [tot[4], grid]);
    t('在籍の和＝全体の在籍（3人）', sx.reduce((a, r) => a + (+r[1]), 0) === +tot[1] && +tot[1] === 3, tot);

    console.log('\n— 4. 休日 —');
    await page.click('[data-tab="holiday"]');
    await page.waitForSelector('table.mt-h', { timeout: 15000 });
    const txt = await mainText(page);
    t('2025年: 国の祝日・休日 19 日（内閣府の一覧と同じ数）', /国の祝日・休日 19 日/.test(txt), txt.slice(0, 200));
    t('2025-11-24 の振替休日が出る', await page.$$eval('table.mt-h tbody tr', (rs) => rs.some((r) => /11\/24/.test(r.textContent) && /休日/.test(r.textContent))));
    await page.selectOption('#vw-h-kind', 'yearly');
    await page.fill('#vw-h-from', '2025-12-29');
    await page.fill('#vw-h-to', '2026-01-03');
    await page.fill('#vw-h-name', '年末年始の休み');
    /* 書きかけのままタブを移って戻っても、入れた値は残る（描き直しで消さない） */
    await page.click('[data-tab="year"]');
    await page.waitForSelector('table.mt-y', { timeout: 15000 });
    await page.click('[data-tab="holiday"]');
    await page.waitForSelector('#vw-h-name', { timeout: 15000 });
    t('書きかけの会社の休日はタブを移っても残る', (await page.inputValue('#vw-h-name')) === '年末年始の休み' && (await page.inputValue('#vw-h-kind')) === 'yearly' && (await page.inputValue('#vw-h-to')) === '2026-01-03');
    await page.click('[data-act="vw-h-add"]');
    await page.waitForFunction(() => /会社の休日を足しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    const ch = put && put[1].p_config.companyHolidays;
    t('足した: 毎年 12-29〜01-03・全部の事業所・使う', Array.isArray(ch) && ch.length === 1 && ch[0].md === '12-29' && ch[0].to === '01-03' && ch[0].office === '' && ch[0].active === true, ch);
    t('ほかの設定の鍵は残す（legal_holiday・plusViews・csvTime）・版を送る', put[1].p_config.legal_holiday === 0 && put[1].p_config.plusViews === true && put[1].p_config.csvTime === 'hmm' && put[1].p_rev === 2, put[1]);
    await page.waitForFunction(() => /会社の休日 6 日/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    t('読み直した後の暦: 2025年の 1/1〜1/3 と 12/29〜12/31 の6日（1/1 は元日と同じ行なので 19＋6−1＝24 日）', /合わせて 24 日/.test(await mainText(page)), (await mainText(page)).slice(0, 300));
    t('足した後は書きかけを空に戻す', (await page.inputValue('#vw-h-name')) === '');
    await page.reload();
    await page.waitForSelector('table.mt-h', { timeout: 20000 });
    t('再読み込みでも休日のタブのまま・タブに選ばれた印', (await page.getAttribute('.tabs button[data-tab="holiday"]', 'aria-selected')) === 'true');
    await page.click('[data-act="vw-h-toggle"][data-i="0"]');
    await page.waitForFunction(() => /会社の休日を止めました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put2 = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    t('止める: 消さずに active を false（1件のまま）', put2[1].p_config.companyHolidays.length === 1 && put2[1].p_config.companyHolidays[0].active === false);
    await page.waitForFunction(() => /止めた/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    await page.fill('#vw-h-from', '2025-12-01');
    await page.fill('#vw-h-name', '');
    await page.click('[data-act="vw-h-add"]');
    t('名前が空なら送らない', alerts.some((a) => /名前/.test(a)) && sentOf(st, 'kintai_settings_put').length === 2);
    await page.screenshot({ path: path.join(OUT, 'holiday_pc.png'), fullPage: true });
    /* 設定で切にする */
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#s-plusViews', { timeout: 15000 });
    t('設定のタブで入になっている', await page.isChecked('#s-plusViews'));
    await page.uncheck('#s-plusViews');
    await page.click('[data-act="save-set"]');
    await page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('g-toast').textContent), null, { timeout: 15000 });
    const put3 = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    t('切にして保存: plusViews は false・会社の休日は残す', put3[1].p_config.plusViews === false && put3[1].p_config.companyHolidays.length === 1, put3[1].p_config);
    await page.waitForFunction(() => !document.querySelector('.tabs button[data-tab="year"]'), null, { timeout: 15000 });
    t('切にしたらタブのボタンが消える', (await page.$$('.tabs button[data-tab="holiday"]')).length === 0);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 5. iPhone の幅・暗い表示 —');
  {
    const st = newSt(server.url, { legal_holiday: 0, plusViews: true });
    const { ctx, page, errs } = await open(browser, st, 'year', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true });
    await page.waitForFunction(() => /か月分を [\d.]+ 秒で読みました/.test(document.getElementById('g-main').textContent), null, { timeout: 30000 });
    for (const tb of ['year', 'site', 'holiday']) {
      await page.click('[data-tab="' + tb + '"]');
      await page.waitForTimeout(400);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const small = await page.$$eval('#g-main button, #g-main select, #g-main input, .tabs button', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => (e.getAttribute('data-act') || e.id || e.textContent).slice(0, 20)));
      t(tb + ': 横にはみ出さない（' + ov + 'px）・押す所は 44px 以上', ov <= 0 && small.length === 0, small);
      await page.screenshot({ path: path.join(OUT, tb + '_iphone_dark.png'), fullPage: true });
    }
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格（撮った絵: check/out/kintai_views/）');
process.exit(fail ? 1 : 0);
