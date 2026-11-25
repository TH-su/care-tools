/* check/kintai_cert_e2e.mjs — 勤怠管理の「資格」のタブとホームの「資格の期限」の箱を、本物の画面（kintai.html）で通しで確かめる（2026-11-25 新設・ROOT-v7 段C・統合 0134）
 *
 * 実行: node check/kintai_cert_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定と、この中の架空の資格の記録）。本物の Supabase へは出ない。今日は 2026-01-14（lib.mjs の FIXED_TIME）。
 * 確かめること:
 *   1. 入り切りが切（設定に certAlert が無い）: タブのボタンと箱が無い・資格の関数を1回も呼ばない・前に資格のタブを開いていてもホーム・切のまま保存しても鍵を作らない
 *   2. 入・データベースの更新がまだ（関数が無い）: 「データベースの更新がまだです」と出し、不具合の記録に残さない・画面の例外 0
 *   3. 入: ホームの箱（要対応と注意の人数）・資格のタブの知らせの並び（切れた→今日まで→あと日数→期限が未入力）・止めた職員を数えない
 *      足す（期限の目安を入れる）・直す（rev を送る）・取り消す・資格の種類を足す（ほかの設定の鍵を残して送る）・止める
 *      再読み込みで資格のタブのまま
 *   4. iPhone の幅（390px）で横にはみ出さない・押す所は 44px 以上・暗い表示で撮る（check/out/kintai_cert/）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = ensureDir(path.join(HERE, 'out', 'kintai_cert'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };
const YM = '2026-01';
let rid = 0;
const C = (sid, code, exp, acq, note) => ({ id: '00000000-0000-4000-8000-' + String(930000000000 + (++rid)), staff_id: sid, code, acquired_on: acq || null, expires_on: exp || null, note: note || null, rev: 1 });

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
        if (name === 'kintai_month_get') {
          const mm = FX.monthOf(p.p_ym);
          if (mm && mm.ok !== false) {
            mm.settings = { config: st.config, rev: st.rev };
            if (st.extraStaff) mm.staff = (mm.staff || []).concat(st.extraStaff);
          }
          return json(mm);
        }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (/^kintai_cert/.test(name)) {
          if (st.noDb) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
          if (name === 'kintai_certs_list') return json({ ok: true, rows: st.certs.filter((c) => !c.voided) });
          if (name === 'kintai_cert_put') {
            if (p.p_id) {
              const c = st.certs.find((x) => x.id === p.p_id && !x.voided);
              if (!c) return json({ ok: false, error: 'notfound' });
              if (c.rev !== p.p_rev) return json({ ok: false, error: 'conflict' });
              Object.assign(c, { code: p.p_code, acquired_on: p.p_acquired, expires_on: p.p_expires, note: p.p_note, rev: c.rev + 1 });
              return json({ ok: true, id: c.id, rev: c.rev });
            }
            if (st.certs.some((x) => !x.voided && x.staff_id === p.p_staff_id && x.code === p.p_code)) return json({ ok: false, error: 'exists' });
            const c = C(p.p_staff_id, p.p_code, p.p_expires, p.p_acquired, p.p_note); st.certs.push(c);
            return json({ ok: true, id: c.id, rev: 1 });
          }
          if (name === 'kintai_cert_void') {
            const c = st.certs.find((x) => x.id === p.p_id && !x.voided);
            if (!c) return json({ ok: false, error: 'notfound' });
            if (c.rev !== p.p_rev) return json({ ok: false, error: 'conflict' });
            c.voided = true; return json({ ok: true });
          }
        }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [], alerts = [], notes = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => { alerts.push(d.message()); d.accept(); });
  await page.exposeFunction('__ctNote', (w) => notes.push(w));
  await page.addInitScript(() => {
    /* 不具合の記録（SUErrors.note）に残したものを数える（中身は見ない） */
    let real = null;
    Object.defineProperty(window, 'SUErrors', { configurable: true, get() { return real; }, set(v) { real = v; if (v && v.note) { const n = v.note; v.note = function (a, b, w) { try { window.__ctNote(String(w || '')); } catch (e) { /* 数えられない時も画面は動かす */ } return n.apply(this, arguments); }; } } });
  });
  await page.goto(st.base + '/kintai.html');
  return { ctx, page, errs, alerts, notes };
}
const sentOf = (st, name) => st.calls.filter((c) => c[0] === name);
const certCalls = (st) => st.calls.filter((c) => /^kintai_cert/.test(c[0]));
const newSt = (base, config, certs) => ({ base, calls: [], config, rev: 2, certs: certs || [] });
const toast = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('g-toast').textContent), re, { timeout: 15000 });

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— 1. 切の時 —');
  {
    const st = newSt(server.url, { legal_holiday: 0 });
    const { ctx, page, errs } = await open(browser, st, 'cert');
    await page.waitForSelector('.tabs button[data-tab="home"][aria-selected="true"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    t('資格のタブのボタンが無い', (await page.$$('.tabs button[data-tab="cert"]')).length === 0);
    t('前に資格のタブを開いていた端末もホームを出す', (await page.getAttribute('.tabs button[data-tab="home"]', 'aria-selected')) === 'true');
    t('ホームに「資格の期限」の箱が無い', !/資格の期限/.test(await page.textContent('#g-main')));
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#s-certAlert', { timeout: 15000 });
    t('設定のタブに入り切りの欄（初めは切）', !(await page.isChecked('#s-certAlert')));
    await page.click('[data-act="save-set"]');
    await toast(page, '設定を保存しました');
    const put = sentOf(st, 'kintai_settings_put').slice(-1)[0];
    t('切のまま保存しても certAlert の鍵を作らない', put && !('certAlert' in put[1].p_config) && !('certKinds' in put[1].p_config) && put[1].p_config.legal_holiday === 0, put && put[1].p_config);
    await page.waitForTimeout(500);
    t('資格の関数を1回も呼ばない', certCalls(st).length === 0, certCalls(st));
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 2. 入・データベースの更新がまだ —');
  {
    const st = newSt(server.url, { legal_holiday: 0, certAlert: true });
    st.noDb = true;
    const { ctx, page, errs, notes } = await open(browser, st, 'cert');
    await page.waitForFunction(() => /データベースの更新がまだです/.test(document.getElementById('g-main').textContent), null, { timeout: 20000 });
    t('資格のタブに「データベースの更新がまだです」', true);
    await page.click('[data-tab="home"]');
    await page.waitForTimeout(600);
    t('ホームの箱も同じ文（何度も読みに行かない）', /資格の期限[\s\S]*データベースの更新がまだです/.test(await page.textContent('#g-main')) && sentOf(st, 'kintai_certs_list').length === 1, sentOf(st, 'kintai_certs_list').length);
    t('不具合の記録に残さない', !notes.some((w) => /資格/.test(w)), notes);
    await page.click('#g-reload');
    await page.waitForFunction(() => /資格の期限[\s\S]*データベースの更新がまだです/.test(document.getElementById('g-main').textContent), null, { timeout: 15000 });
    t('上の「読み直す」で関数の有無を確かめ直す（読み込み中のまま止まらない）', sentOf(st, 'kintai_certs_list').length === 2, sentOf(st, 'kintai_certs_list').length);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 3. 入の時 —');
  {
    const certs = [
      C('sK01', 'cm', '2026-01-10', '2021-01-11'),       /* 4日前に切れた → 要対応 */
      C('sK02', 'car', '2026-01-14'),                    /* 今日まで → 要対応 */
      C('sK03', 'cm', '2026-03-15'),                     /* あと60日 → 注意 */
      C('sK03', 'car', null),                            /* 期限が未入力 → 注意 */
      C('sK02', 'cw', null, '2015-03-01'),               /* 期限の要らない資格 → なし */
      C('sX99', 'cm', '2025-01-01')                      /* 止めた職員（名簿で active:false）→ 数えない */
    ];
    const st = newSt(server.url, { legal_holiday: 0, certAlert: true, csvTime: 'hmm' }, certs);
    st.extraStaff = [{ staff_id: 'sX99', name: '見本 止め', code: '0099', office: 'facility', emp_code: '9099', master_id: null, active: false, source: 'shift', clock_visible: false }];
    const { ctx, page, errs, alerts } = await open(browser, st, 'home');
    await page.waitForFunction(() => /資格の期限/.test(document.getElementById('g-main').textContent) && document.querySelector('.hbox[data-tab="cert"]'), null, { timeout: 20000 });
    const box = await page.textContent('.hbox[data-tab="cert"]');
    t('ホームの箱: 要対応と注意の3人・段は要対応', /3\s*人/.test(box) && /要対応/.test(box) && (await page.getAttribute('.hbox[data-tab="cert"]', 'class')).indexOf('alert') >= 0, box);
    t('タブのボタンを最後に足し、札は3', (await page.$$eval('.tabs button', (bs) => bs.map((b) => b.getAttribute('data-tab')).slice(-1)[0])) === 'cert' && /資格 3/.test(await page.textContent('.tabs button[data-tab="cert"]')));
    await page.click('.hbox[data-tab="cert"]');
    await page.waitForSelector('#ct-sid', { timeout: 15000 });
    const hit = await page.$$eval('table.mt-ct', (ts) => [...ts[0].querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(0, 5).map((d) => d.textContent.trim()).join('|')));
    t('知らせの並び: 切れた→今日まで→あと60日→期限が未入力（止めた職員は出さない）', hit.length === 4 && /期限切れ（4日過ぎ/.test(hit[0]) && /今日まで/.test(hit[1]) && /あと60日/.test(hit[2]) && /期限が未入力/.test(hit[3]) && !hit.some((h) => /見本 止め/.test(h)), hit);
    await page.screenshot({ path: path.join(OUT, 'cert_pc.png'), fullPage: true });
    t('止めた職員も「数えていない人」から選べる', (await page.$$eval('#ct-sid optgroup option', (os) => os.map((o) => o.value + ':' + o.textContent))).join() === 'sX99:見本 止め（止めた職員）');

    /* 足す（三太・期限の目安） */
    await page.selectOption('#ct-sid', 'sK03');
    await page.waitForSelector('#ct-form');
    await page.selectOption('#ct-code', 'scm');
    /* 取得日は1字ずつ打つ（途中で値が決まって change が出ても、欄から外れない） */
    await page.focus('#ct-acq');
    await page.keyboard.type('04012025', { delay: 40 });
    t('取得日を1字ずつ打っても欄から外れず、最後まで入る', (await page.inputValue('#ct-acq')) === '2025-04-01' && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'ct-acq', await page.inputValue('#ct-acq'));
    await page.waitForSelector('[data-act="ct-hint"]', { timeout: 5000 });
    t('期限の目安（取得日＋5年の前の日）', (await page.getAttribute('[data-act="ct-hint"]', 'data-v')) === '2030-03-31');
    await page.click('[data-act="ct-hint"]');
    t('目安を入れると期限の欄に入る', (await page.inputValue('#ct-exp')) === '2030-03-31');
    await page.fill('#ct-note', '見本のメモ');
    await page.click('[data-act="ct-save"]');
    await toast(page, '資格を足しました');
    const add = sentOf(st, 'kintai_cert_put').slice(-1)[0][1];
    t('足す: id は null・職員・種類・日付・メモを送る', add.p_id === null && add.p_rev === 0 && add.p_staff_id === 'sK03' && add.p_code === 'scm' && add.p_acquired === '2025-04-01' && add.p_expires === '2030-03-31' && add.p_note === '見本のメモ', add);
    await page.waitForFunction(() => /主任介護支援専門員/.test(document.getElementById('g-main').textContent), null, { timeout: 10000 });

    /* 直す（三太の介護支援専門員証の期限を更新） */
    const cmId = certs[2].id;
    await page.click('[data-act="ct-edit"][data-id="' + cmId + '"]');
    await page.waitForFunction(() => /直した内容を保存する/.test(document.getElementById('g-main').textContent));
    t('直す: 今の値が入る', (await page.inputValue('#ct-exp')) === '2026-03-15' && (await page.inputValue('#ct-code')) === 'cm');
    await page.fill('#ct-exp', '2031-03-15');
    await page.click('[data-act="ct-save"]');
    await toast(page, '資格を直しました');
    const ed = sentOf(st, 'kintai_cert_put').slice(-1)[0][1];
    t('直す: id と rev を送る', ed.p_id === cmId && ed.p_rev === 1 && ed.p_expires === '2031-03-15', ed);
    await page.waitForFunction(() => !/あと60日/.test(document.getElementById('g-main').textContent), null, { timeout: 10000 });
    t('直すと知らせから外れる（三太は運転免許の未入力が残るので札は3のまま）', /資格 3/.test(await page.textContent('.tabs button[data-tab="cert"]')));

    /* 取り消す（三太の運転免許） */
    await page.click('[data-act="ct-void"][data-id="' + certs[3].id + '"]');
    await toast(page, '資格の記録を取り消しました');
    const vd = sentOf(st, 'kintai_cert_void').slice(-1)[0][1];
    t('取り消す: id と rev を送る・確かめの窓を出す', vd.p_id === certs[3].id && vd.p_rev === 1 && alerts.some((a) => /取り消します/.test(a)), vd);
    await page.waitForFunction(() => /資格 2/.test(document.querySelector('.tabs button[data-tab="cert"]').textContent), null, { timeout: 10000 });
    t('取り消すと知らせから外れる（札は2）', true);

    /* 資格の種類を足す・止める（管理者） */
    await page.fill('#ct-k-name', '見本の研修');
    await page.fill('#ct-k-warn', '60');
    await page.fill('#ct-k-urgent', '14');
    await page.fill('#ct-k-years', '3');
    await page.click('[data-act="ct-k-save"]');
    await toast(page, '資格の種類を足しました');
    const kp = sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config;
    const ks = kp.certKinds || [];
    t('種類を足す: 既定の9件＋1件・ほかの設定の鍵を残す', ks.length === 10 && ks[9].name === '見本の研修' && ks[9].code === 'c1' && ks[9].warn === 60 && ks[9].urgent === 14 && ks[9].years === 3 && ks[9].exp === true && kp.certAlert === true && kp.csvTime === 'hmm', kp);
    await page.waitForFunction(() => /見本の研修/.test(document.getElementById('g-main').textContent), null, { timeout: 10000 });
    await page.click('[data-act="ct-k-toggle"][data-i="2"]');
    await toast(page, '資格の種類を止めました');
    const kp2 = sentOf(st, 'kintai_settings_put').slice(-1)[0][1].p_config;
    t('種類を止める: 運転免許の active が false', kp2.certKinds[2].code === 'car' && kp2.certKinds[2].active === false, kp2.certKinds[2]);
    await page.waitForFunction(() => /資格 1/.test(document.querySelector('.tabs button[data-tab="cert"]').textContent), null, { timeout: 10000 });
    t('止めた種類（二美の運転免許）は数えない（札は1）', true);

    /* 再読み込みで資格のタブのまま */
    await page.reload();
    await page.waitForSelector('#ct-sid', { timeout: 20000 });
    t('再読み込みで資格のタブのまま', (await page.getAttribute('.tabs button[data-tab="cert"]', 'aria-selected')) === 'true');
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— 4. iPhone の幅・暗い表示 —');
  {
    const st = newSt(server.url, { legal_holiday: 0, certAlert: true }, [C('sK01', 'cm', '2026-01-10'), C('sK02', 'car', '2026-02-20')]);
    const { ctx, page, errs } = await open(browser, st, 'cert', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true });
    await page.waitForSelector('#ct-sid', { timeout: 20000 });
    await page.selectOption('#ct-sid', 'sK01');
    await page.waitForSelector('#ct-form');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const small = await page.$$eval('#g-main button, #g-main select, #g-main input, .tabs button', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => (e.getAttribute('data-act') || e.id || e.textContent).slice(0, 20)));
    t('資格: 横にはみ出さない（' + ov + 'px）・押す所は 44px 以上', ov <= 0 && small.length === 0, small);
    await page.screenshot({ path: path.join(OUT, 'cert_iphone_dark.png'), fullPage: true });
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
