/* check/kintai_lockpay_e2e.mjs — 勤怠管理の「この月を締めて、給与へ渡す」とホームの「この月分の進み具合」を、本物の画面（kintai.html）で通しで確かめる（2026-11-26 新設・本人指示）
 *
 * 実行: node check/kintai_lockpay_e2e.mjs [--shots <保存先>]（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（check/fixtures/kintai.mjs の架空の職員・予定に、予定どおりの打刻を足す）。本物の Supabase へは出ない。給与の画面（payroll.html）は偽の1枚に差し替えて、移った先の住所だけを見る。
 * 確かめること:
 *   1. 要確認 0・締められる月分（2025-12）: ホームの進み具合は「月を締める」が今の段で、主ボタンは「締めと出力へ進む」（ホームからは締めない）
 *   2. 締めと出力: 主ボタン「この月を締めて、給与へ渡す」が「この月を締める」の前にあり、「この月を締める」は塗りなし。CSV の箱に「CSV は要りません」の1行
 *   3. 「この月を締めて、給与へ渡す」→ 締めの窓を閉じる（確かめで止める）と移らず、締めの関数も呼ばない
 *   4. 「この月を締めて、給与へ渡す」→ 窓の「締める」で、締めの関数（kintai_month_lock）の後に payroll.html?ym=2025-12&from=kintai へ移る
 *   5. 普通の「この月を締める」では締めた後も勤怠の画面のまま（前に「給与へ渡す」を押して窓を閉じていても）。締めた後のリンクは from=kintai つき・ホームの進み具合も同じリンク
 *   6. 要確認が残る月分: ホームの主ボタンは「要確認を1件目から決める」・締めと出力に「給与へ渡す」は出ない
 *   7. 事務所（管理者でない）: 「給与へ渡す」は出ない
 *   8. ホームの進み具合: 幅320・390・768・1280 と文字200% で横はみ出し 0・押す所 44px 以上・字 15px 以上
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, ensureDir, parseArgs, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = parseArgs(process.argv.slice(2));
const OUT = ensureDir(args.shots ? path.resolve(String(args.shots)) : path.join(HERE, 'out', 'kintai_lockpay'));
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } };

const YM = '2025-12';
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
let pid = 0;
const P = (sid, kind, d, hm) => ({ id: '00000000-0000-4000-8000-' + String(800000000000 + (++pid)), staff_id: sid, kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
/* 予定は 9:00〜18:00。early が真なら 12/1 一郎を 8:20 出勤（早出＝要確認 1件）にする。ほかは予定どおり */
function punchesOf(base, early) {
  const out = [];
  base.schedule.filter((r) => r.kind === 'work').forEach((r) => {
    const d = r.work_date;
    out.push(P(r.staff_id, 'in', d, early && r.staff_id === 'sK01' && d === '2025-12-01' ? '08:20' : '09:00'), P(r.staff_id, 'out', d, '18:00'));
  });
  return out;
}

const server = await startServer(ROOT);
const base = server.url;
const browser = await chromium.launch();

async function open(opt = {}) {
  const st = { locked: null, sent: [], PUN: null, toPay: [] };
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, colorScheme: opt.dark ? 'dark' : 'light', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 控えが使えない時は既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: opt.tab || 'home', kintai_ym: YM }));
  /* シフトの読み口（SUKv.callShift）は偽物: 確定済みの空のシフトを返す（取り込みは通り、予定は月の読み出しの架空の行を使う） */
  await ctx.addInitScript((ym) => {
    let kv;
    Object.defineProperty(window, 'SUKv', { configurable: true, get() { return kv; }, set(v) {
      kv = v;
      if (v && typeof v === 'object') v.callShift = () => Promise.resolve({ ok: true, entries: { ['sched:' + ym + ':plan']: { data: { cells: {}, meta: { confirmedAt: ym + '-01T00:00:00+09:00' } } }, staff: { data: [] }, symbols: { data: [] }, settings: { data: {} } } });
    } });
  }, YM);
  /* 給与の画面は偽の1枚（移った先の住所だけを見る） */
  await ctx.route(/\/payroll\.html(\?.*)?$/, (route) => { st.toPay.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>給与（偽）</title><p id="fake-pay">給与の画面（試験の偽物）</p>' }); });
  for (const r of FX.routes) {
    if (r.match === FX.URL + '/**') {
      await ctx.route(r.match, (route) => {
        const req = route.request(), u = req.url();
        const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u), name = m ? m[1] : '';
        let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
        if (req.method() !== 'OPTIONS' && opt.office && /\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role: 'office', mfa: true });
        if (req.method() !== 'OPTIONS' && opt.office && /\/rest\/v1\/allowed_accounts/.test(u)) return json({ role: 'office', label: '' });
        if (req.method() !== 'OPTIONS' && opt.office && /\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role: 'office', rules: null, mine: null, updatedAt: null });
        if (req.method() !== 'OPTIONS' && name === 'kintai_month_get') {
          const mm = FX.monthOf(p.p_ym);
          if (mm.ok && p.p_ym === YM) {
            if (!st.PUN) st.PUN = punchesOf(mm, !!opt.early);
            mm.punches = st.PUN;
            mm.month = st.locked ? { ym: YM, locked_at: '2026-01-14T09:00:00+09:00', snapshot: st.locked, history: [] } : null;
          }
          return json(mm);
        }
        if (req.method() !== 'OPTIONS' && name === 'kintai_month_rev') return json('rev-' + (st.locked ? 'L' : '0'));
        if (req.method() !== 'OPTIONS' && name === 'kintai_month_lock') {
          st.sent.push(name);
          if (opt.lockFail && !st.failed) { st.failed = true; if (opt.lockFail === 'net') return route.abort(); return json({ ok: false, error: 'review' }); }   /* 1回目だけ断る・通信が切れる */
          st.locked = p.p_snapshot; return json({ ok: true });
        }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/kintai.html');
  return { ctx, page, st, errs };
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
const waitHome = (page) => page.waitForSelector('#g-main .hflow .hf-act > *', { timeout: 20000 });
const flowState = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#g-main .hflow .su-steps li')).map((li) => li.className[0]).join(''));

try {
  /* ── 1〜4: 締められる月分で「給与へ渡す」 ── */
  console.log('\n— 1〜4. 締められる月分で「この月を締めて、給与へ渡す」 —');
  {
    const o = await open({ tab: 'home' });
    const p = o.page;
    await waitHome(p);
    t('1. ホームの進み具合: 3段（済み・今・まだ）で「月を締める」が今の段', await flowState(p) === 'dct' && /この月分の進み具合/.test(await p.textContent('#g-main .hflow h3')), await flowState(p));
    t('1. ホームの主ボタンは「締めと出力へ進む」の1つ（締めのボタンはホームに無い）', (await p.textContent('#g-main .hflow .hf-act')).trim() === '締めと出力へ進む' && (await p.$('#g-main .hflow [data-act="lock"], #g-main .hflow [data-act="lock-go"]')) === null);
    t('1. 進み具合は箱の一覧の上・印刷に出さない', await p.evaluate(() => { const f = document.querySelector('#g-main .hflow'), g = document.querySelector('#g-main .hgrid'); return !!f && !!g && (f.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) && f.classList.contains('no-print'); }));
    await shot(p, 'kintai.home.can-lock.pc', true);
    await p.click('#g-main .hflow [data-tab="close"]');
    await p.waitForSelector('[data-act="lock"]', { timeout: 20000 });
    t('1. 「締めと出力へ進む」で締めと出力のタブへ切り替えるだけ（締めの関数は呼ばない）', await p.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'close' && o.st.sent.length === 0);
    const order = await p.evaluate(() => { const g = document.querySelector('#g-main [data-act="lock-pay"]'), l = document.querySelector('#g-main [data-act="lock"]'); return g && l ? { before: !!(g.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING), gCls: g.className, lCls: l.className, gBg: getComputedStyle(g).backgroundColor, lBg: getComputedStyle(l).backgroundColor, cardBg: getComputedStyle(document.querySelector('#g-main .cd')).backgroundColor, gTxt: g.textContent } : null; });
    t('2. 主ボタン「この月を締めて、給与へ渡す」（紙に出さない）が「この月を締める」の前・「この月を締める」は class "btn pri su-sub"（紙は今のまま）で画面では枠のボタン（地が箱と同じ）', !!order && order.before && order.gCls === 'btn pri no-print' && order.lCls === 'btn pri su-sub' && order.lBg === order.cardBg && order.gBg !== order.lBg && order.gTxt === 'この月を締めて、給与へ渡す', order);
    const diffTxt = await p.evaluate(() => { const l = document.querySelector('#g-main [data-act="lock"]'), n = l && l.nextElementSibling; return n ? n.className + '|' + n.textContent : ''; });
    t('2. 「この月を締める」のすぐ下に2つのボタンの違いの1文（紙に出さない）', diffTxt === 'help no-print|「この月を締める」は締めるだけで、給与の画面へは移りません。', diffTxt);
    const csvHelp = await p.evaluate(() => { const h = Array.from(document.querySelectorAll('#g-main .cd h2')).find((x) => /給与計算への出力（CSV）/.test(x.textContent)); const n = h && h.nextElementSibling; return n ? n.className + '|' + n.textContent : ''; });
    t('2. CSV の箱の見出しの直後に「CSV は要りません」の1行（class "help no-print"）', csvHelp === 'help no-print|自社の給与の画面は、締めた勤怠をそのまま読みます（CSV の書き出し・取り込みは要りません）。この CSV は、ほかの給与ソフトへ渡す時だけ使います。', csvHelp);
    t('2. 締める前の並びは今のまま: freee の取り込みの箱 → 月の締め', await p.evaluate(() => { const f = document.getElementById('g-fi'), c = document.querySelector('#g-main [data-act="lock"]').closest('.cd'); return !!f && !!(f.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    await shot(p, 'kintai.close.can-lock.pc', true);
    /* 1b. 紙は変えない: 足した物（給与へ渡すのボタン・2つの説明）は紙に出ず、「この月を締める」は紙では今までどおりの塗りのボタン */
    await p.emulateMedia({ media: 'print' });
    const pr = await p.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && !!el.getClientRects().length && !el.closest('.no-print');
      const l = document.querySelector('#g-main [data-act="lock"]'), probe = document.createElement('button');
      probe.className = 'btn pri'; probe.textContent = 'x'; l.parentElement.insertBefore(probe, l);
      const same = getComputedStyle(probe).backgroundColor === getComputedStyle(l).backgroundColor && getComputedStyle(probe).color === getComputedStyle(l).color && getComputedStyle(probe).borderColor === getComputedStyle(l).borderColor;
      probe.remove();
      const helps = Array.from(document.querySelectorAll('#g-main p.help')).filter((x) => /CSV の書き出し・取り込みは要りません|締めるだけで、給与の画面へは移りません/.test(x.textContent));
      return { pay: vis(document.querySelector('#g-main [data-act="lock-pay"]')), helps: helps.length, helpsVis: helps.filter(vis).length, lockVis: vis(l), same };
    });
    await p.emulateMedia({ media: 'screen' });
    t('1b. 紙: 「給与へ渡す」と足した説明2つは紙に出ない・「この月を締める」は紙では塗りのボタンのまま（btn pri と同じ色）', !pr.pay && pr.helps === 2 && pr.helpsVis === 0 && pr.lockVis && pr.same, pr);
    /* 3. 窓を閉じると移らない */
    await p.click('#g-main [data-act="lock-pay"]');
    await p.waitForSelector('#g-dlg[open] #g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    await p.click('#g-dlg [data-act="dlg-close"]');
    await p.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 5000 });
    await p.waitForTimeout(500);
    t('3. 締めの窓を閉じると移らない・締めの関数を呼ばない', o.st.toPay.length === 0 && o.st.sent.length === 0 && /kintai\.html/.test(p.url()));
    /* 4. 窓の「締める」で締めの後に給与へ */
    await p.click('#g-main [data-act="lock-pay"]');
    await p.waitForSelector('#g-dlg[open] #g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    await p.click('#g-dlg-f [data-act="lock-go"]');
    await p.waitForURL(/\/payroll\.html\?/, { timeout: 15000 });
    const u = new URL(p.url());
    t('4. 締めの関数（kintai_month_lock）を呼んだ後に payroll.html?ym=2025-12&from=kintai へ同じタブで移る', o.st.sent.join(',') === 'kintai_month_lock' && u.pathname.endsWith('/payroll.html') && u.search === '?ym=2025-12&from=kintai' && o.st.toPay.length === 1, [o.st.sent, p.url()]);
    t('1〜4. 画面のエラー 0', o.errs.length === 0, o.errs);
    await o.ctx.close();
  }
  /* ── 5: 普通の「この月を締める」では移らない ── */
  console.log('\n— 5. 普通の「この月を締める」 —');
  {
    const o = await open({ tab: 'close' });
    const p = o.page;
    await p.waitForSelector('#g-main [data-act="lock-pay"]', { timeout: 20000 });
    await p.click('#g-main [data-act="lock-pay"]');   /* 先に「給与へ渡す」を押して窓を閉じる */
    await p.waitForSelector('#g-dlg[open] #g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    await p.click('#g-dlg [data-act="dlg-close"]');
    await p.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 5000 });
    await p.click('#g-main [data-act="lock"]');
    await p.waitForSelector('#g-dlg[open] #g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    await p.click('#g-dlg-f [data-act="lock-go"]');
    await p.waitForFunction(() => !!document.querySelector('#g-main [data-act="unlock"]'), null, { timeout: 15000 });
    await p.waitForTimeout(500);
    t('5. 普通の「この月を締める」は締めた後も勤怠の画面のまま', o.st.sent.join(',') === 'kintai_month_lock' && o.st.toPay.length === 0 && /kintai\.html/.test(p.url()));
    const link = await p.evaluate(() => { const a = Array.from(document.querySelectorAll('#g-main a.btn.pri')).find((x) => /給与の画面でこの月分を計算する/.test(x.textContent)); return a ? { href: a.getAttribute('href'), txt: a.textContent, label: a.parentElement.textContent } : null; });
    t('5. 締めた後のリンクは「💴 給与の画面でこの月分を計算する」（文言そのまま）・href に from=kintai・3段目だと分かる', !!link && link.href === 'payroll.html?ym=2025-12&from=kintai' && link.txt === '💴 給与の画面でこの月分を計算する' && /次は給与の画面で計算します/.test(link.label), link);
    t('5. 締めた後の締めと出力: 手順は「給与で計算」が今の段', await p.evaluate(() => Array.from(document.querySelectorAll('#g-main ol.su-steps li')).map((li) => li.className[0]).join('')) === 'ddc');
    t('5. 締めた後は freee の取り込みの箱を月の締めの後ろへ（主役は給与の画面へのリンク）', await p.evaluate(() => { const f = document.getElementById('g-fi'), c = document.querySelector('#g-main [data-act="unlock"]').closest('.cd'); return !!f && !!(c.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    await shot(p, 'kintai.close.locked.pc', true);
    await p.click('.tabs [data-tab="home"]');
    await waitHome(p);
    const hl = await p.evaluate(() => { const a = document.querySelector('#g-main .hflow .hf-act a'); return a ? { href: a.getAttribute('href'), txt: a.textContent, pri: a.classList.contains('pri') } : null; });
    t('5. ホームの進み具合（締めた後）: 同じリンク（from=kintai つき）', !!hl && hl.href === 'payroll.html?ym=2025-12&from=kintai' && hl.txt === '💴 給与の画面でこの月分を計算する' && hl.pri && await flowState(p) === 'ddc', hl);
    await shot(p, 'kintai.home.locked.pc', true);
    t('5. 画面のエラー 0', o.errs.length === 0, o.errs);
    await o.ctx.close();
  }
  /* ── 5b: 締めが断られた・通信が切れた時は移らない（その後に普通に締めても移らない） ── */
  for (const how of ['ng', 'net']) {
    console.log('\n— 5b. 締めが' + (how === 'ng' ? '断られた' : '通信で失敗した') + '時 —');
    const o = await open({ tab: 'close', lockFail: how });
    const p = o.page;
    await p.waitForSelector('#g-main [data-act="lock-pay"]', { timeout: 20000 });
    await p.click('#g-main [data-act="lock-pay"]');
    await p.waitForSelector('#g-dlg[open] #g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    await p.click('#g-dlg-f [data-act="lock-go"]');
    await p.waitForFunction(() => { const m = document.getElementById('e-msg'); return !!(m && m.textContent.trim()); }, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(600);
    t('5b. ' + how + ': 締めの関数を呼んだが通らない時は給与へ移らない（勤怠の画面のまま・知らせが出る）', o.st.sent.length === 1 && o.st.toPay.length === 0 && /kintai\.html/.test(p.url()) && !o.st.locked && !!(await p.textContent('#e-msg')).trim(), [o.st.sent, await p.textContent('#e-msg').catch(() => '')]);
    await p.click('#g-dlg [data-act="dlg-close"]').catch(() => {});
    await p.waitForFunction(() => !document.getElementById('g-dlg').open, null, { timeout: 5000 }).catch(() => {});
    await p.click('#g-main [data-act="lock"]');
    await p.waitForSelector('#g-dlg[open] #g-dlg-f [data-act="lock-go"]', { timeout: 15000 });
    await p.click('#g-dlg-f [data-act="lock-go"]');
    await p.waitForFunction(() => !!document.querySelector('#g-main [data-act="unlock"]'), null, { timeout: 15000 });
    await p.waitForTimeout(500);
    t('5b. ' + how + ': その後に普通の「この月を締める」で締めても給与へ移らない', o.st.sent.length === 2 && !!o.st.locked && o.st.toPay.length === 0 && /kintai\.html/.test(p.url()));
    t('5b. ' + how + ': 画面のエラー 0', o.errs.length === 0, o.errs);
    await o.ctx.close();
  }
  /* ── 6: 要確認が残る月分 ── */
  console.log('\n— 6. 要確認が残る月分 —');
  {
    const o = await open({ tab: 'home', early: true });
    const p = o.page;
    await waitHome(p);
    t('6. ホームの主ボタンは「要確認を1件目から決める」（data-act="rvd-start"）・1段目が今', (await p.textContent('#g-main .hflow .hf-act')).trim() === '要確認を1件目から決める' && (await p.$('#g-main .hflow [data-act="rvd-start"].pri')) !== null && await flowState(p) === 'ctt');
    await shot(p, 'kintai.home.review.pc', true);
    await p.click('#g-main .hflow [data-act="rvd-start"]');
    await p.waitForFunction(() => /の要確認を決める/.test(document.getElementById('g-dlg-h').textContent), null, { timeout: 15000 });
    t('6. 押すと決める窓が開く（今の道のまま）', true);
    await p.click('#g-dlg [data-act="dlg-close"]').catch(() => {});
    await p.click('.tabs [data-tab="close"]');
    await p.waitForSelector('#g-main [data-act="lock"]', { timeout: 20000 });
    t('6. 締めと出力: 要確認が残る間は「給与へ渡す」を出さず、塗りは「要確認を1件目から決める」・「この月を締める」は印 su-sub（紙は btn pri のまま）', (await p.$('#g-main [data-act="lock-pay"]')) === null && await p.getAttribute('#g-main [data-act="lock"]', 'class') === 'btn pri su-sub' && await p.getAttribute('#g-main .row [data-act="rvd-start"]', 'class') === 'btn pri');
    await shot(p, 'kintai.close.review.pc', true);
    t('6. 画面のエラー 0', o.errs.length === 0, o.errs);
    await o.ctx.close();
  }
  /* ── 7: 事務所（管理者でない） ── */
  console.log('\n— 7. 事務所のアカウント —');
  {
    const o = await open({ tab: 'close', office: true });
    const p = o.page;
    await p.waitForSelector('#g-main [data-act="lock"]', { timeout: 20000 });
    t('7. 事務所（管理者でない）には「給与へ渡す」を出さない・「この月を締める」は主ボタン', (await p.$('#g-main [data-act="lock-pay"]')) === null && await p.getAttribute('#g-main [data-act="lock"]', 'class') === 'btn pri');
    await o.ctx.close();
  }
  /* ── 7b: 締めと出力（iPhone の幅）: freee の箱のファイルの欄が箱の中に収まり、期間の1行は本文と同じ大きさ ── */
  for (const w of [320, 390]) {
    const o = await open({ tab: 'close', viewport: { width: w, height: 844 } });
    const p = o.page;
    await p.waitForSelector('#fi-file', { timeout: 20000 });
    const m = await p.evaluate(() => { const f = document.getElementById('fi-file'), box = document.getElementById('g-fi'), per = box.querySelector('p[style]'); const fr = f.getBoundingClientRect(), br = box.getBoundingClientRect(); return { inBox: fr.right <= br.right + 0.5, doc: document.documentElement.scrollWidth - window.innerWidth, perFs: parseFloat(getComputedStyle(per).fontSize), bodyFs: parseFloat(getComputedStyle(box).fontSize), perW: getComputedStyle(per).fontWeight }; });
    t('7b. 幅' + w + ': ファイルの欄が箱の中・横はみ出し 0・期間の1行は本文と同じ大きさで太字', m.inBox && m.doc <= 0 && m.perFs === m.bodyFs && +m.perW >= 700, m);
    await o.ctx.close();
  }
  /* ── 8: 幅と文字200% ── */
  console.log('\n— 8. 幅と文字200% —');
  for (const [w, z, dark] of [[320, 1], [390, 1], [768, 1], [1280, 1], [320, 2], [390, 2], [1280, 2], [1440, 1, true]]) {
    const o = await open({ tab: 'home', viewport: { width: w, height: 900 }, dark: !!dark });
    const p = o.page;
    await waitHome(p);
    if (z !== 1) await p.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'));
    const m = await p.evaluate(() => {
      const f = document.querySelector('#g-main .hflow'), r = f.getBoundingClientRect(), b = f.querySelector('.hf-act .btn');
      const small = Array.from(f.querySelectorAll('*')).filter((e) => e.childNodes.length && Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 15 && getComputedStyle(e).fontSize !== '0px').map((e) => e.tagName + ':' + getComputedStyle(e).fontSize);
      return { doc: document.documentElement.scrollWidth - window.innerWidth, right: r.right - window.innerWidth, btnH: b ? b.getBoundingClientRect().height : 0, small };
    });
    const sv = await p.evaluate(() => Array.from(document.querySelectorAll('#g-main .hflow .su-steps li')).map((li) => { const s = li.querySelector('.su-st-s'), r = li.getBoundingClientRect(); return { fs: parseFloat(getComputedStyle(li).fontSize), sub: s ? getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().width > 0 : false, txt: li.textContent, top: Math.round(r.top) }; }));
    const vert = sv.length === 3 && sv[0].top < sv[1].top && sv[1].top < sv[2].top;
    t('8. 手順の段: 幅' + w + (z !== 1 ? '・文字200%' : '') + (dark ? '・暗い表示' : '') + ' で3段とも名前と状態が読める（字 15px 以上）' + (w <= 420 ? '・縦に並ぶ' : '・横に並ぶ'), sv.length === 3 && sv.every((x) => x.fs >= 15 && x.sub) && (w <= 420 ? vert : !vert), sv);
    t('8. 進み具合: 幅' + w + (z !== 1 ? '・文字200%' : '') + (dark ? '・暗い表示' : '') + ' で横はみ出し 0・押す所 44px 以上・字 15px 以上', m.doc <= 0 && m.right <= 0.5 && m.btnH >= 44 && m.small.length === 0, m);
    if (w === 390 && z === 1) await shot(p, 'kintai.home.can-lock.ph', true);
    if (dark) await shot(p, 'kintai.home.can-lock.dark', true);
    await o.ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
