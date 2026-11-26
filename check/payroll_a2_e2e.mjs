/* check/payroll_a2_e2e.mjs — 給与の画面（payroll.html）の段A2（手当の回数の元・社内会議を時間外に足す）の通し試験（2026-11-25 新設・凍結仕様 ROOT-v7-plus-parity.md「段A2」）
 *
 *   node check/payroll_a2_e2e.mjs（check/ で npm install 済みか NODE_PATH に playwright。run-all には入れない）
 *
 * 偽のデータベース（check/fixtures/payroll.mjs の opt.a2）と本物の計算の部品で、本物の Chromium で開き、
 *   1. 勤怠を締めた控え（ext 入り）→ 職員の給与設定で早遅手当の「回数の元」に記号の組を選ぶ（時間外に足す社内会議は選べない）→ 保存
 *   2. 計算すると、早遅手当＝控えの記号の組の回数×400円・時間外は会議 60分を足した後・明細の勤怠に「うち社内会議」→ 下書き保存 → 確定できる
 *   3. 会議の時間（t:meeting）を手当の回数の元にした人がいると、確定の窓で止まる（meeting_src・画面だけ）
 *   4. 会議を足す設定なのに控えに ext が無い月分（期間の初日が 2026-12-16 以降）は、確定の窓で止まる（ext_missing・画面だけ）
 * を確かめる。外へは通信しない（Supabase は全部横取り）。★架空データだけ。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer } from './lib.mjs';
import * as FX from './fixtures/payroll.mjs';

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
const browser = await chromium.launch();
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

async function open(opt) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const routes = FX.routesFor(Object.assign({ now: opt.clock }, opt));
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.origin === srv.url || u.origin === FX.URL) return route.fallback(); return route.abort(); });
  for (const r of routes) await ctx.route(r.match, r.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, FX.storageFor(opt));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(opt.clock);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(srv.url + '/payroll.html');
  return { ctx, page, routes, errors };
}
async function sud(page, wait = 3000) {
  try { await page.waitForSelector('dialog.sud-dlg[open]', { timeout: wait }); } catch (e) { return ''; }
  const msg = await page.textContent('dialog.sud-dlg[open] .sud-msg');
  await page.waitForTimeout(400);
  await page.click('dialog.sud-dlg[open] .sud-btn.pri');
  await page.waitForFunction(() => !document.querySelector('dialog.sud-dlg[open]'), null, { timeout: 5000 }).catch(() => {});
  return msg;
}
const waitApp = async (page) => {
  await page.waitForFunction(() => !document.getElementById('p-app').hidden && !document.querySelector('#p-main .skel'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
};
/* 勤怠の確かめ（verifyKintai）が済むのを待ってから計算する */
const compute = async (page) => {
  for (let i = 0; i < 40; i++) {
    await page.click('[data-act="compute"]');
    const m = await sud(page, 400);
    if (!m) return '';
    if (!/確かめています/.test(m)) return m;
    await page.waitForTimeout(300);
  }
  return 'timeout';
};
const lineOf = (page, sid) => page.evaluate((s) => { const o = {}; document.querySelectorAll('details.it[data-sid="' + s + '"] tbody tr').forEach((tr) => { const td = tr.querySelectorAll('td'); if (td.length >= 3) o[td[0].textContent.trim()] = [td[1].textContent.trim(), td[2].textContent.trim()]; }); return o; }, sid);
const yen = (v) => Number(String(v || '').replace(/[^\d]/g, ''));

console.log('\n— 1〜3. 回数の元を選ぶ → 計算 → 明細の額 → 確定・会議を回数の元にすると止まる —');
{
  const o = await open({ tab: 'profile', start: 'none', a2: {}, clock: new Date('2026-11-20T09:00:00+09:00'), ym: '2026-11' });
  const p = o.page, db = o.routes.db;
  await waitApp(p);
  await p.waitForFunction(() => !!document.querySelector('[data-act="prof"][data-sid="s-01"]'), null, { timeout: 15000 });
  await p.waitForTimeout(800);   /* 勤怠の設定（kintai_month_get）を読み終えるまで */
  await p.click('[data-act="prof"][data-sid="s-01"]');
  await p.waitForSelector('#p-dlg[open]');
  const sels = await p.evaluate(() => [...document.querySelectorAll('#p-dlg select[id^="f-als"]')].map((s) => ({ id: s.id, opts: [...s.options].map((x) => x.value) })));
  const hy = sels[0];
  t('回数×単価の手当（早遅手当・会議の手当）に回数の元の選び（手で入れる・シフトの記号「早」・補助項目・記号の組・通勤回数）', sels.length === 2 && hy && hy.opts.indexOf('manual') === 0 && hy.opts.indexOf('早') > 0 && hy.opts.indexOf('g:hayaoso') > 0 && hy.opts.indexOf('k:commute') > 0, sels);
  t('時間外に足している社内会議（t:meeting）は選びに出ない（二重払いの守り）', sels.every((s) => s.opts.indexOf('t:meeting') < 0), sels);
  await p.selectOption('#' + hy.id, 'g:hayaoso');
  await p.fill('#f-reason', '見本の回数の元');
  await p.click('[data-act="prof-go"]');
  await p.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const pc = o.routes.calls.filter((c) => c.name === 'payroll_profile_put').pop();
  const al = pc && pc.args.p_data.allowances.find((x) => x.code === 'hayaoso');
  t('保存: 早遅手当の回数の元 g:hayaoso・額 400 を送り、DB の形の確かめを通る', !!al && al.count_source === 'g:hayaoso' && al.amount === 400 && db.profiles.some((q) => q.staff_id === 's-01' && q.data.allowances.some((x) => x.code === 'hayaoso' && x.count_source === 'g:hayaoso')), al);

  await p.click('[data-tab="run"]');
  await waitApp(p);
  const m0 = await compute(p);
  t('計算できる（勤怠の控えの ext と、補助項目を読んで数え直した値が同じ）', m0 === '', m0);
  const ext = db.kraw['2026-11'].snapshot.ext, r1 = ext.rows['s-01'], row1 = db.kraw['2026-11'].snapshot.rows.find((x) => x.staff_id === 's-01');
  t('材料: 控えの s-01 は早遅の回数・会議 60分の足し分がある', r1['g:hayaoso'] > 0 && r1.adj && r1.adj.meetingMin === 60, r1);
  await p.click('details.it[data-sid="s-01"] > summary');
  await p.waitForSelector('details.it[data-sid="s-01"] [data-act="adj"]');
  const L = await lineOf(p, 's-01');
  t('早遅手当＝控えの記号の組の回数 ' + r1['g:hayaoso'] + ' 回×400円', yen((L['早遅手当'] || [])[1]) === r1['g:hayaoso'] * 400, L['早遅手当']);
  const hm = (m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  t('時間外は会議 60分を足した後（締めた時間外 ' + row1.legalOverMin + '分＋60分）で払う', !!L['時間外労働'] && L['時間外労働'][0] === hm(row1.legalOverMin + 60) && yen(L['時間外労働'][1]) > 0, [L['時間外労働'], row1.legalOverMin]);
  t('明細の勤怠の欄に「うち社内会議 1:00」', !!L['うち社内会議'] && L['うち社内会議'][0] === '1:00', L['うち社内会議']);
  t('労働時間数（総労働）にも会議の 60分を足す', !!L['総労働'] && L['総労働'][0] === hm(row1.workMin + 60), [L['総労働'], row1.workMin]);
  t('補助項目の読み口を読んだ（kintai_extras_get）', o.routes.calls.some((c) => c.name === 'kintai_extras_get'));
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  await p.click('[data-act="confirm"]');
  const dlg = await p.textContent('#p-dlg');
  t('確定の窓: 段A2 の止め（ext_missing・meeting_src）は無く、確定できない警告も無い', !/確定できない警告/.test(dlg) && !/補助項目がありません/.test(dlg) && !/回数の元に選べません/.test(dlg), dlg.slice(0, 300));
  await p.click('[data-act="dlg-close"]').catch(() => {});

  /* 3. 会議の時間（t:meeting）を会議の手当の回数の元にする（画面の選びには出ないので、DB の設定を直接直して読み直す＝古い設定の人の真似） */
  db.profiles.filter((q) => q.staff_id === 's-01').forEach((q) => { q.data.allowances = q.data.allowances.concat([{ code: 'mtgal', amount: 100, count_source: 't:meeting' }]); });
  await p.click('#p-reload'); await waitApp(p);
  const m1 = await compute(p);
  t('読み直して計算できる', m1 === '', m1);
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  await p.click('[data-act="confirm"]');
  const dlg2 = await p.textContent('#p-dlg');
  t('t:meeting を回数の元にした人がいると確定の窓で止まる（meeting_src・確定のボタンを押せない）', /社内会議の時間は時間外に足しているので、手当の回数の元に選べません/.test(dlg2) && await p.isDisabled('[data-act="confirm-go"]'), dlg2.slice(0, 400));
  t('画面の例外 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

console.log('\n— 4. 会議を足す設定なのに控えに ext が無い月分（2027年1月分＝12/16〜1/15） —');
{
  const o = await open({ tab: 'run', start: 'none', a2: { ext: false }, clock: new Date('2027-01-20T09:00:00+09:00'), ym: '2027-01' });
  const p = o.page;
  await waitApp(p);
  const m0 = await compute(p);
  t('計算はできる（止めるのは確定だけ）', m0 === '', m0);
  t('ext の無い控えでは補助項目を読まない', !o.routes.calls.some((c) => c.name === 'kintai_extras_get'));
  await p.click('details.it[data-sid="s-01"] > summary');
  await p.waitForSelector('details.it[data-sid="s-01"] [data-act="adj"]');
  const body = await p.textContent('details.it[data-sid="s-01"]');
  t('警告: 「この月分の勤怠の控えに補助項目がありません。勤怠の締めを外して締め直してください」', /この月分の勤怠の控えに補助項目がありません。勤怠の締めを外して締め直してください/.test(body), body.slice(0, 300));
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  await p.click('[data-act="confirm"]');
  const dlg = await p.textContent('#p-dlg');
  t('確定の窓で止まる（確定できない警告に ext_missing の文・確定のボタンを押せない）', /確定できない警告/.test(dlg) && /この月分の勤怠の控えに補助項目がありません/.test(dlg) && await p.isDisabled('[data-act="confirm-go"]'), dlg.slice(0, 400));
  t('画面の例外 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

console.log('\n— 5. 社内会議を時間外に足すかを保存しないまま締めた控え（def.meetingOt が null・会議の時間がある） —');
{
  const o = await open({ tab: 'run', start: 'none', a2: { noMeet: true }, clock: new Date('2026-11-20T09:00:00+09:00'), ym: '2026-11' });
  const p = o.page;
  await waitApp(p);
  const m0 = await compute(p);
  t('計算はできる', m0 === '', m0);
  await p.click('details.it[data-sid="s-01"] > summary');
  await p.waitForSelector('details.it[data-sid="s-01"] [data-act="adj"]');
  const L = await lineOf(p, 's-01');
  t('会議の足し分は当てない（うち社内会議の行が無い）', !L['うち社内会議'], Object.keys(L));
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  await p.click('[data-act="confirm"]');
  const dlg = await p.textContent('#p-dlg');
  t('確定の窓で止まる（meeting_unset・画面だけ・確定のボタンを押せない）', /確定できない警告/.test(dlg) && /社内会議を時間外に足すかを勤怠の設定で保存しないまま締めた月分です/.test(dlg) && await p.isDisabled('[data-act="confirm-go"]'), dlg.slice(0, 400));
  t('画面の例外 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

await browser.close();
await srv.close();
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
