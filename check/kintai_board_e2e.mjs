/* check/kintai_board_e2e.mjs — 勤怠の段B（管理者のお知らせ・本人の画面からの補助項目の申請・2026-11-25・統合 0130）を本物の画面で通しで確かめる
 *
 * 実行: node check/kintai_board_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 * 通信は全部偽物（架空の職員・架空の時刻だけ・本物の Supabase へは出ない）。
 *   A. 管理画面・鍵が切: 申請のタブにお知らせ・補助項目の申請の欄が無い・0130 の関数を呼ばない。設定のタブで入にして保存 → 鍵が送られ、ほかの鍵は残る
 *   B. 管理画面・鍵が入: お知らせを書いて出す（事業所の選び・期間）→ 一覧に出る → 取り消す（理由が要る）。補助項目の申請を差し戻す（理由が要る）・承認する → 月を読み直す
 *   C. 本人の画面・鍵が入: 上に青の帯でお知らせ（文の改行のまま）・申請のタブの下に補助項目の申請 → 出す（送る形）→ 一覧に承認待ち → 取り下げ → 閉じると帯と欄が消える
 *   D. 本人の画面・鍵が切／古い受け口（format）: 帯も欄も出さない（今の画面のまま）・画面の例外 0
 *   E. iPhone の幅（390px）で横にはみ出さない・押す所 44px 以上（本人の画面）
 * ★架空データだけ（CLAUDE.md §2-1）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } };
const YM = '2025-12';
const ITEMS = [{ code: 'dist', name: '移動距離', kind: 'number', unit: 'km', decimals: 1, active: true }, { code: 'checkup', name: '健診', kind: 'count', decimals: 0, active: true },
  { code: 'meeting', name: '社内会議', kind: 'time', decimals: 0, active: true }];

/* ── 管理画面 ── */
async function openAdmin(browser, st, tabName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) { /* 既定 */ } }, Object.assign({}, FX.storage, { kintai_tab: tabName, kintai_ym: YM }));
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
        if (name === 'kintai_month_get') { const mm = FX.monthOf(p.p_ym); if (mm.ok) mm.settings = { config: st.config, rev: st.rev }; return json(mm); }
        if (name === 'kintai_settings_put') { st.config = p.p_config; st.rev++; return json({ ok: true, rev: st.rev }); }
        if (name === 'kintai_extras_get') return json({ ok: true, from: p.p_ym + '-01', to: p.p_ym + '-28', rows: [] });   /* 段A1（0127）の後の DB */
        if (name === 'kintai_announces_list') return json({ ok: true, rows: st.ann });
        if (name === 'kintai_announce_add') { const id = '00000000-0000-4000-8000-0000000b' + String(1000 + st.ann.length); st.ann.unshift({ id, body: p.p_body, offices: p.p_offices, date_from: p.p_from, date_to: p.p_to, created_by: 'kakuu@example.com', created_at: '2026-01-14T00:00:00Z', voided_at: null }); return json({ ok: true, id }); }
        if (name === 'kintai_announce_void') { const a = st.ann.find((x) => x.id === p.p_id); if (!a) return json({ ok: false, error: 'notfound' }); a.voided_at = '2026-01-14T01:00:00Z'; a.void_reason = p.p_reason; return json({ ok: true }); }
        if (name === 'kintai_extra_reqs_list') return json({ ok: true, rows: st.xr.filter((x) => !p.p_status || x.status === p.p_status), pending: st.xr.filter((x) => x.status === 'pending').length });
        if (name === 'kintai_extra_req_decide') { const x = st.xr.find((y) => y.id === p.p_id); if (!x || x.rev !== p.p_rev || x.status !== 'pending') return json({ ok: false, error: 'conflict' }); x.status = p.p_approve ? 'approved' : 'rejected'; x.rev++; x.decide_note = p.p_note; return json({ ok: true, rev: x.rev, status: x.status }); }
        return r.handle(route);
      });
    } else await ctx.route(r.match, r.handle);
  }
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(st.base + '/kintai.html');
  return { ctx, page, errs };
}
async function sud(page, text) {   /* 画面の中央の窓（SUDialog）に文を入れて OK */
  await page.waitForSelector('.sud-dlg', { timeout: 8000 });
  await page.waitForTimeout(450);   /* 開いた直後の押しは受けない（su-dialog.js の tooSoon・350ms） */
  if (text != null && (await page.$('.sud-inp'))) await page.fill('.sud-inp', text);
  await page.click('.sud-btn.pri');
  await page.waitForSelector('.sud-dlg', { state: 'detached', timeout: 8000 });
  await page.waitForTimeout(300);
}
const sent = (st, n) => st.calls.filter((c) => c[0] === n);

/* ── 本人の画面 ── */
const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co', EP = '/functions/v1/kintai-self';
const KEY = 'b'.repeat(64), OPEN = 'c'.repeat(64), SID = 'kakuu-s1';
const pad = (n) => (n < 10 ? '0' : '') + n;
const jst = new Date(Date.now() + 9 * 3600000);
const TODAY = jst.getUTCFullYear() + '-' + pad(jst.getUTCMonth() + 1) + '-' + pad(jst.getUTCDate());
const SYM = TODAY.slice(0, 7);
function selfMonth(ym) {
  return { ok: true, period: { from: ym + '-01', to: ym + '-28', lead_from: ym + '-01', close_day: 0 },
    staff: [{ staff_id: SID, name: '架空 本人', display_name: '表示 架空', office: 'facility', employment: null, active: true }],
    punches: [], schedule: [], days: [], month: null, settings: { config: {} }, leave_uses: [] };
}
function selfFake(mode) {
  const st = { bodies: [], xr: [] };
  st.handle = (b) => {
    if (b.key !== KEY) return { ok: false, error: 'nokey' };
    if (b.op === 'pin') return { ok: true, open: OPEN, name: '表示 架空', until: new Date(Date.now() + 300000).toISOString() };
    if (b.open !== OPEN) return { ok: false, error: 'closed' };
    if (b.op === 'month') return selfMonth(b.ym);
    if (b.op === 'leave') return { ok: true, staff_id: SID, hire_date: null, profile: null, grants: [], uses: [], months: [], schedule: [] };
    if (b.op === 'requests') return { ok: true, rows: [] };
    if (b.op === 'notices') return { ok: true, rows: [] };
    if (mode === 'old') return { ok: false, error: 'format' };   /* 0130 の前の受け口は知らない op を format で断る */
    if (b.op === 'announces') return mode === 'off' ? { ok: true, on: false, rows: [] } : { ok: true, on: true, rows: [{ id: 'a1', body: '年末の打刻は\n忘れずに', date_from: TODAY, date_to: TODAY }] };
    if (b.op === 'extra_info') return mode === 'off' ? { ok: true, on: false, items: [], rows: [] } : { ok: true, on: true, items: ITEMS.map((x) => ({ code: x.code, name: x.name, kind: x.kind, unit: x.unit || '', decimals: x.decimals })), rows: st.xr };
    if (b.op === 'extra_add') { const r = { id: '00000000-0000-4000-8000-00000000c' + String(100 + st.xr.length), work_date: b.work_date, ym: SYM, code: b.code, qty: b.qty ?? null, minutes: b.minutes ?? null, note: b.note ?? null, status: 'pending', rev: 1, created_at: new Date().toISOString() }; st.xr.unshift(r); return { ok: true, id: r.id, rev: 1, status: 'pending' }; }
    if (b.op === 'extra_withdraw') { const r = st.xr.find((x) => x.id === b.id); if (!r || r.rev !== b.rev) return { ok: false, error: 'conflict' }; r.status = 'withdrawn'; r.rev++; return { ok: true, rev: r.rev, status: 'withdrawn' }; }
    return { ok: false, error: 'format' };
  };
  return st;
}
async function openSelf(browser, base, st) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript((k) => { try { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); } catch (e) { /* 既定 */ } }, KEY);
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.origin === SB && u.pathname === EP) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const b = JSON.parse(route.request().postData() || '{}');
      st.bodies.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(st.handle(b)) });
    }
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/kintai-self.html');
  await page.waitForSelector('#v-pin:not([hidden])', { timeout: 10000 });
  await page.fill('#in-pin', '1357'); await page.click('#b-pin');
  await page.waitForSelector('#v-app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(800);
  return { context, page, errors };
}

const server = await startServer(ROOT);
const browser = await chromium.launch();
try {
  console.log('\n— A. 管理画面・鍵が切 —');
  {
    const st = { base: server.url, calls: [], config: { legal_holiday: 0, extraItems: ITEMS }, rev: 3, ann: [], xr: [] };
    const { ctx, page, errs } = await openAdmin(browser, st, 'requests');
    await page.waitForSelector('#g-main .rq', { timeout: 20000 });
    await page.waitForTimeout(800);
    t('申請のタブにお知らせ・補助項目の申請の欄が無い', (await page.$('.kb-ann')) === null && (await page.$('.kb-xr')) === null);
    t('お知らせの関数は呼ばない・補助項目は承認待ちを聞くだけ（無ければ何も出さない）', !st.calls.some((c) => /announce/.test(c[0])) && st.calls.filter((c) => /extra_req/.test(c[0])).every((c) => c[0] === 'kintai_extra_reqs_list' && c[1].p_status === 'pending'), st.calls.map((c) => c[0]));
    await page.click('[data-tab="settings"]');
    await page.waitForSelector('#kb-s-ann', { timeout: 15000 });
    t('設定のタブに2つの入り切り（既定は外れ）', !(await page.isChecked('#kb-s-ann')) && !(await page.isChecked('#kb-s-xr')));
    await page.check('#kb-s-ann'); await page.check('#kb-s-xr');
    await page.click('[data-act="save-set"]');
    await page.waitForTimeout(1500);
    const put = sent(st, 'kintai_settings_put').pop();
    t('保存: 鍵 selfAnnounce・selfExtraReq が true で送られ、ほかの鍵（extraItems・legal_holiday）は残る',
      put && put[1].p_config.selfAnnounce === true && put[1].p_config.selfExtraReq === true && Array.isArray(put[1].p_config.extraItems) && put[1].p_config.legal_holiday === 0, put && put[1].p_config);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— B. 管理画面・鍵が入 —');
  {
    const st = { base: server.url, calls: [], config: { selfAnnounce: true, selfExtraReq: true, extraItems: ITEMS }, rev: 3, ann: [],
      xr: [{ id: '00000000-0000-4000-8000-0000000d0001', staff_id: 'kakuu-s1', name: '架空 甲', staff_active: true, work_date: '2026-01-10', ym: '2026-01', code: 'dist', qty: 12.3, minutes: null, note: '訪問の移動', status: 'pending', rev: 1, created_at: '2026-01-13T00:00:00Z' },
          { id: '00000000-0000-4000-8000-0000000d0002', staff_id: 'kakuu-s2', name: '架空 乙', staff_active: true, work_date: '2026-01-11', ym: '2026-01', code: 'meeting', qty: null, minutes: 90, note: null, status: 'pending', rev: 1, created_at: '2026-01-13T01:00:00Z' }] };
    const { ctx, page, errs } = await openAdmin(browser, st, 'requests');
    await page.waitForSelector('.kb-ann', { timeout: 20000 });
    await page.waitForSelector('.kb-xr .rq-t', { timeout: 10000 });
    const xt = await page.textContent('.kb-xr');
    t('補助項目の申請の一覧: 名前・項目と値・本人の理由・承認待ちの数', /架空 甲/.test(xt) && /移動距離 12\.3 km/.test(xt) && /社内会議 1:30/.test(xt) && /訪問の移動/.test(xt) && /承認待ち 2 件/.test(xt), xt.slice(0, 300));
    await page.fill('#kb-a-body', '年末の打刻は\n忘れずに');
    await page.uncheck('#kb-a-o-day');
    await page.fill('#kb-a-from', '2026-01-14'); await page.fill('#kb-a-to', '2026-01-20');
    await page.click('[data-act="kb-a-add"]');
    await page.waitForTimeout(1200);
    const add = sent(st, 'kintai_announce_add').pop();
    t('お知らせを出す: 文・事業所（通所を外した2つ）・期間を送る', add && add[1].p_body === '年末の打刻は\n忘れずに' && JSON.stringify(add[1].p_offices) === '["facility","visit"]' && add[1].p_from === '2026-01-14' && add[1].p_to === '2026-01-20', add && add[1]);
    t('一覧に「出しています」と期間が出る・文の欄は空に戻る', /出しています/.test(await page.textContent('.kb-ann')) && /1\/14〜1\/20/.test(await page.textContent('.kb-ann')) && (await page.inputValue('#kb-a-body')) === '');
    await page.fill('#kb-a-body', '見本'); await page.fill('#kb-a-from', '2026-01-10'); await page.fill('#kb-a-to', '2026-01-13'); await page.click('[data-act="kb-a-add"]');
    await page.waitForTimeout(300);
    t('終わりが今日より前の期間は送らずに知らせる', sent(st, 'kintai_announce_add').length === 1 && /今日より前/.test(await page.textContent('#kb-a-msg')));
    await page.click('[data-act="kb-a-void"]');
    await sud(page, '出し間違い');
    t('取り消す: 理由つきで送る → 一覧に「取り消し」', sent(st, 'kintai_announce_void').length === 1 && sent(st, 'kintai_announce_void')[0][1].p_reason === '出し間違い' && /取り消し/.test(await page.textContent('.kb-ann')));
    await page.click('[data-act="kb-x-ng"][data-id="00000000-0000-4000-8000-0000000d0002"]');
    await sud(page, '');
    t('差し戻しは理由が空なら送らない', sent(st, 'kintai_extra_req_decide').length === 0);
    await page.click('[data-act="kb-x-ng"][data-id="00000000-0000-4000-8000-0000000d0002"]');
    await sud(page, '日付が違います');
    const ng = sent(st, 'kintai_extra_req_decide').pop();
    t('差し戻す: 理由つき・rev つきで送る', ng && ng[1].p_approve === false && ng[1].p_note === '日付が違います' && ng[1].p_rev === 1, ng && ng[1]);
    const getsBefore = sent(st, 'kintai_month_get').length;
    await page.click('[data-act="kb-x-ok"][data-id="00000000-0000-4000-8000-0000000d0001"]');
    await sud(page, null);
    await page.waitForTimeout(1500);
    const okc = sent(st, 'kintai_extra_req_decide').pop();
    t('承認する: 送る → 月を読み直す', okc && okc[1].p_approve === true && okc[1].p_note === null && sent(st, 'kintai_month_get').length > getsBefore, okc && okc[1]);
    await page.click('[data-tab="close"]');
    await page.waitForTimeout(1500);
    t('締めの画面の上に、この月分の補助項目の承認待ちの帯は出ない（残りは決めた・差し戻した）', (await page.$('.kb-close')) === null);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— B2. 管理画面・締めの画面と、鍵を切った後に残った承認待ち —');
  {
    const st = { base: server.url, calls: [], config: { extraItems: ITEMS }, rev: 3, ann: [],
      xr: [{ id: '00000000-0000-4000-8000-0000000d0003', staff_id: 'kakuu-s1', name: '架空 甲', staff_active: true, work_date: '2025-12-10', ym: '2025-12', code: 'checkup', qty: 1, minutes: null, note: null, status: 'pending', rev: 1, created_at: '2025-12-11T00:00:00Z' }] };
    const { ctx, page, errs } = await openAdmin(browser, st, 'close');
    await page.waitForSelector('.kb-close', { timeout: 20000 });
    t('締めの画面の上に、この月分の補助項目の承認待ちの帯', /承認待ちが 1 件あります/.test(await page.textContent('.kb-close')));
    await page.click('[data-tab="requests"]');
    await page.waitForSelector('.kb-xr', { timeout: 10000 });
    t('鍵が切でも、残った承認待ちは申請のタブで決められる（お知らせの欄は出さない）', /切にしたため/.test(await page.textContent('.kb-xr')) && (await page.$('.kb-ann')) === null);
    await page.click('[data-act="kb-x-ok"]');
    await sud(page, null);
    await page.waitForTimeout(1500);
    t('承認すると帯も残りも消える', st.xr[0].status === 'approved' && (await page.$('.kb-xr')) === null);
    t('画面の例外 0', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('\n— C. 本人の画面・鍵が入 —');
  {
    const st = selfFake('on');
    const { context, page, errors } = await openSelf(browser, server.url, st);
    await page.waitForSelector('#an-box:not([hidden])', { timeout: 8000 });
    t('上に青の帯でお知らせ（改行のまま）', /事務所からのお知らせ/.test(await page.textContent('#an-box')) && (await page.$eval('#an-box .an', (e) => e.textContent)) === '年末の打刻は\n忘れずに'
      && (await page.$eval('#an-box', (e) => getComputedStyle(e).whiteSpace + '|' + getComputedStyle(e.querySelector('.an')).whiteSpace)).endsWith('pre-wrap'));
    await page.click('#t-req');
    await page.waitForSelector('#xr-sec:not([hidden]) #f-xr', { timeout: 8000 });
    t('申請のタブの下に補助項目の申請の欄（項目は3つ）', (await page.$$eval('#xr-code option', (o) => o.map((x) => x.value))).join(',') === 'dist,checkup,meeting');
    await page.selectOption('#xr-code', 'dist'); await page.fill('#xr-date', TODAY); await page.fill('#xr-val', '12.34');
    await page.click('#b-xr');
    t('小数の桁が多い値は送らない', !st.bodies.some((b) => b.op === 'extra_add') && /小数は1桁まで/.test(await page.textContent('#xr-msg')));
    await page.fill('#xr-val', '12.3'); await page.fill('#xr-note', ' 訪問の移動 ');
    await page.click('#b-xr');
    await page.waitForSelector('#xr-list .day', { timeout: 8000 });
    const add = st.bodies.filter((b) => b.op === 'extra_add').pop();
    t('送る形: 鍵・開いている印・日・項目・値・理由・送り直しの印だけ', add && Object.keys(add).sort().join(',') === 'client_id,code,key,note,op,open,qty,work_date' && add.qty === 12.3 && add.note === '訪問の移動' && add.key === KEY && add.open === OPEN, add);
    t('一覧に承認待ち', /移動距離 12\.3 km/.test(await page.textContent('#xr-list')) && /承認待ち/.test(await page.textContent('#xr-list')) && /申請しました/.test(await page.textContent('#xr-msg')));
    await page.selectOption('#xr-code', 'meeting');
    await page.fill('#xr-h', '1'); await page.fill('#xr-m', '30'); await page.click('#b-xr');
    await page.waitForTimeout(800);
    const add2 = st.bodies.filter((b) => b.op === 'extra_add').pop();
    t('時間の項目は時間と分から分にして送る', add2 && add2.minutes === 90 && !('qty' in add2), add2);
    await page.click('#xr-list .day:last-child button');
    await page.waitForTimeout(800);
    t('取り下げ: id と rev を送る → 取り下げと出る', st.bodies.some((b) => b.op === 'extra_withdraw' && b.rev === 1) && /取り下げ/.test(await page.textContent('#xr-list')));
    t('横にはみ出さない（390px）', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const tap = await page.evaluate(() => [...document.querySelectorAll('#xr-sec button, #xr-sec input, #xr-sec select, #xr-sec textarea')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.height)]; }).filter((x) => x[1] < 44));
    t('押す所・入れる所の高さは 44px 以上', tap.length === 0, tap);
    await page.click('#b-close');
    await page.waitForSelector('#v-pin:not([hidden])', { timeout: 5000 });
    t('閉じると帯と欄が隠れて中身も消える', (await page.$eval('#an-box', (e) => e.hidden && !e.firstChild)) && (await page.$eval('#xr-sec', (e) => e.hidden && !e.firstChild)));
    t('画面の例外 0', errors.length === 0, errors);
    await context.close();
  }

  console.log('\n— D. 本人の画面・鍵が切／古い受け口 —');
  for (const mode of ['off', 'old']) {
    const st = selfFake(mode);
    const { context, page, errors } = await openSelf(browser, server.url, st);
    await page.click('#t-req');
    await page.waitForTimeout(800);
    t(mode + ': 帯も欄も出さない（今の画面のまま）', (await page.$eval('#an-box', (e) => e.hidden)) && (await page.$eval('#xr-sec', (e) => e.hidden)) && (await page.isVisible('#f-req')));
    t(mode + ': 断りの文を出さない', !(await page.isVisible('#app-msg')));
    t(mode + ': 画面の例外 0', errors.length === 0, errors);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
process.exit(fail ? 1 : 0);
