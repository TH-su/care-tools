/* check/payroll_e2e.mjs — 給与の画面（payroll.html）の通し試験と撮影（2026-11-19 新設）
 *
 *   node check/payroll_e2e.mjs [--shots <保存先>]
 *
 * 偽のデータベース（check/fixtures/payroll.mjs）と契約の形の偽の部品（check/fixtures/payroll-calc-stub.js）で、本物の Chromium で開き、
 *   1. 計算する → 下書き保存 → 確定（確認の窓に件数・総額・警告・今月変わった設定）→ 確定済み
 *   2. 確定の窓を開いた後に入力が変わると（設定の版が上がる）、確定しないで数え直しを促す
 *   3. 保存の時に stale と言われると、読み直して計算し直す（自動で確定しない）
 *   4. 給与明細の全員分の印刷（1人1ページ・PDF のページ数＝人数）
 *   5. 振込と書き出し（全銀のスイッチの入・切・総額の照合・ダウンロード）
 *   6. 覆い（42501・aal1）・端末に残すのはタブだけ・10分で金額を消す
 *   7. 画面のエラー（pageerror・console.error）0
 * を確かめる。--shots を付けると PC・iPhone 幅・暗い表示・印刷の絵を残す。外へは通信しない（Supabase は全部横取り）。
 * ★架空データだけ。本物の給与・口座は使わない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs, pdfPages, ensureDir, FIXED_TIME } from './lib.mjs';
import * as FX from './fixtures/payroll.mjs';

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const SHOTS = args.shots ? ensureDir(path.resolve(String(args.shots))) : null;
const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
const browser = await chromium.launch({ args: ['--disable-font-subpixel-positioning'] });
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

async function open(opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: opt.dark ? 'dark' : 'light', acceptDownloads: true });
  const routes = FX.routesFor(opt);
  const outside = [];
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.origin === srv.url || u.origin === FX.URL) return route.fallback(); outside.push(u.origin); return route.abort(); });
  for (const r of routes) await ctx.route(r.match, r.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, FX.storageFor(opt));
  const page = await ctx.newPage();
  /* 時計は撮影の道具と同じ固定の日（月分は 2026-01＝材料の月分）。タイマーは動かす */
  await page.clock.setFixedTime(FIXED_TIME);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'log' || m.type() === 'info') logs.push(m.text()); });
  await page.goto(srv.url + '/payroll.html');
  return { ctx, page, routes, errors, outside, logs };
}
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); };
const waitApp = (page) => page.waitForFunction(() => !document.getElementById('p-app').hidden && !document.querySelector('#p-main .skel'), null, { timeout: 15000 });

/* ── 1. 計算→下書き保存→確定 ── */
console.log('\n— 1. 計算 → 下書き保存 → 確定 —');
{
  const o = await open({ tab: 'run', start: 'none' });
  const p = o.page;
  await waitApp(p);
  t('今月の給与のタブで開く（端末に残したタブ）', await p.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'run');
  t('管理者には設定のタブが出る', await p.evaluate(() => !document.querySelector('.tabs [data-tab="settings"]').hidden));
  t('期間つきの月分を出す', /1月分（12\/16〜1\/15）/.test(await p.textContent('#p-period')));
  await p.click('[data-act="compute"]');
  t('計算すると10人分の行が出る', (await p.locator('details.it').count()) === 10);
  t('下書き保存の前は確定を押せない', await p.isDisabled('[data-act="confirm"]'));
  await shot(p, 'payroll.run.pc');
  await p.click('details.it[data-sid="s-01"] > summary');
  await p.waitForSelector('details.it[data-sid="s-01"] [data-act="adj"]');
  t('行を開くと支給・控除・勤怠の根拠が出る', await p.locator('details.it[data-sid="s-01"] table').count() >= 3);
  await shot(p, 'payroll.run-open.pc');
  /* その月だけの調整（理由が無いと足せない） */
  await p.click('details.it[data-sid="s-01"] [data-act="adj"]');
  await p.fill('#a-name', '見本の立替');
  await p.fill('#a-amt', '3000');
  p.once('dialog', (d) => d.accept());
  await p.click('[data-act="adj-go"]');
  t('理由が無いと調整を足さない（窓が開いたまま）', await p.evaluate(() => document.getElementById('p-dlg').open));
  await p.fill('#a-reason', '見本の理由');
  await p.click('[data-act="adj-go"]');
  t('調整を足すと計算し直し、その行に出る', /見本の立替/.test(await p.textContent('details.it[data-sid="s-01"]')));
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  t('下書き保存すると確定を押せる', true);
  await p.click('[data-act="confirm"]');
  const dlg = await p.textContent('#p-dlg');
  t('確定の窓に人数・総額・警告・今月変わった設定と調整が出る', /10 人/.test(dlg) && /差引の合計/.test(dlg) && /残っている警告/.test(dlg) && /今月変わった設定と調整/.test(dlg) && /見本の立替/.test(dlg) && /見本 一郎：給与の設定/.test(dlg), dlg.slice(0, 300));
  await shot(p, 'payroll.confirm-dialog.pc', false);
  await p.emulateMedia({ media: 'print' });
  t('窓を開いたまま Cmd/Ctrl+P で刷っても、窓（総額）は紙に出ない', await p.evaluate(() => getComputedStyle(document.getElementById('p-dlg')).display === 'none' && getComputedStyle(document.getElementById('p-app')).display === 'none'));
  await p.emulateMedia({ media: 'screen' });
  p.once('dialog', (d) => d.accept());
  await p.click('[data-act="confirm-go"]');
  t('警告に印を入れないと確定しない', await p.evaluate(() => document.getElementById('p-dlg').open) && o.routes.db.run.status === 'draft');
  await p.check('#c-ack');
  await p.click('[data-act="confirm-go"]');
  await p.waitForFunction(() => /確定済み/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('確定すると確定済みになり、計算するのボタンが消える', o.routes.db.run.status === 'confirmed' && (await p.locator('[data-act="compute"]').count()) === 0);
  t('確定を押した時にもう一度読み直した（bootstrap が確定の前にある）', (() => { const n = o.routes.calls.map((c) => c.name); const i = n.lastIndexOf('payroll_run_confirm'); return i > 0 && n[i - 1] === 'payroll_bootstrap'; })());
  t('端末に残したのは payroll_tab だけ（月分・金額・氏名なし・施設情報の共通の控えは除いて数える）', await p.evaluate(() => { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); return ks.filter((k) => /payroll/.test(k)).join() === 'payroll_tab' && !ks.filter((k) => k !== 'su_facility_json_v1').some((k) => /見本 [一二三四五六七八九十]|見本銀行|\d{1,3},\d{3}/.test(localStorage.getItem(k) || '')); }));
  t('画面のエラー 0', o.errors.length === 0, o.errors);
  t('console.log に何も出さない', o.logs.length === 0, o.logs);
  t('外への通信 0', o.outside.length === 0, o.outside);
  await o.ctx.close();
}

/* ── 2. 確定の窓の後に入力が変わった ── */
console.log('\n— 2. 確定の窓の後に入力が変わる —');
{
  const o = await open({ tab: 'run', start: 'none' });
  const p = o.page;
  await waitApp(p);
  await p.click('[data-act="compute"]');
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  await p.click('[data-act="confirm"]');
  /* 窓を開いている間に別の人が職員の設定を変えた（基本給が上がり版が進む） */
  const x = o.routes.db.profiles.find((q) => q.staff_id === 's-02'); x.data.base = 1300; x.rev++;
  await p.check('#c-ack').catch(() => {});
  await p.click('[data-act="confirm-go"]');
  await p.waitForFunction(() => /読み直したら数字が変わっていました/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('数字が変わっていたら確定しない（下書きのまま）', o.routes.db.run.status === 'draft');
  t('新しい数字で計算し直し、もう一度保存を促す', !(await p.isDisabled('[data-act="save"]')) && await p.isDisabled('[data-act="confirm"]'));
  t('payroll_run_confirm を呼んでいない', !o.routes.calls.some((c) => c.name === 'payroll_run_confirm'));
  /* 3. 保存の時に stale（勤怠の締めが変わった） */
  o.routes.db.kintai.locked_at = '2026-01-17T09:00:00+09:00';
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => /計算した後に変わりました/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('stale と言われたら読み直して計算し直す（保存も確定もしない・保存のボタンはまた押せる）', o.routes.db.run.status === 'draft' && !(await p.isDisabled('[data-act="save"]')));
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  t('計算し直した後の保存は通る', o.routes.db.run.rev >= 2);
  t('画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

/* ── 4. 給与明細と印刷 ── */
console.log('\n— 4. 給与明細と印刷 —');
{
  const o = await open({ tab: 'slip', start: 'confirmed' });
  const p = o.page;
  await waitApp(p);
  await p.waitForSelector('#p-main .slip');
  t('明細は口座を下4桁だけ出す', /＊＊＊\d{4}/.test(await p.textContent('#p-main .slip')) && !/\d{7}/.test(await p.textContent('#p-main .slip')));
  await shot(p, 'payroll.slip.pc');
  await p.evaluate(() => { window.print = function () {}; });
  await p.click('[data-act="print-all"]');
  await p.waitForFunction(() => document.body.classList.contains('su-printing'), null, { timeout: 10000 });
  t('全員分の紙は1人1枚（10枚）', (await p.locator('#p-print .slip').count()) === 10);
  t('紙の見出しに施設名と印刷日の印がある', (await p.locator('#p-print [data-su-print-head="name date"]').count()) === 10);
  t('印刷したことを記録した', o.routes.db.log.includes('print'));
  await p.emulateMedia({ media: 'print' });
  if (SHOTS) {
    await p.screenshot({ path: path.join(SHOTS, 'payroll.slips.print.png'), fullPage: true });
    const pdf = path.join(SHOTS, 'payroll.slips.pdf');
    await p.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const n = pdfPages(pdf);
    t('印刷の PDF は10ページ（1人1ページ）', n === 10, n);
  }
  await p.emulateMedia({ media: 'screen' });
  t('画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}

/* ── 5. 振込と書き出し ── */
console.log('\n— 5. 振込と書き出し —');
{
  const o = await open({ tab: 'export', start: 'confirmed' });
  const p = o.page;
  await waitApp(p);
  t('全銀のスイッチが切の時は全銀のボタンを出さない', (await p.locator('[data-k="zengin"]').count()) === 0);
  t('総額の照合と消し方の案内が出る', /総額の照合/.test(await p.textContent('#p-main')) && /ごみ箱を空にする/.test(await p.textContent('#p-main')));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-k="ledger"]')]);
  t('賃金台帳の CSV をダウンロードできる（記録してから）', /^ledger-2026-01\.csv$/.test(dl.suggestedFilename()) && o.routes.db.log.includes('ledger'));
  t('payroll_bank_export を呼んでいない（全銀を押していない）', !o.routes.calls.some((c) => c.name === 'payroll_bank_export'));
  await shot(p, 'payroll.export.pc');
  await o.ctx.close();
  const o2 = await open({ tab: 'export', start: 'confirmed', zengin: true });
  const p2 = o2.page;
  await waitApp(p2);
  const [dz] = await Promise.all([p2.waitForEvent('download'), p2.click('[data-k="zengin"]')]);
  const zp = await dz.path(), buf = fs.readFileSync(zp);
  const recs = buf.toString('latin1').split('\r\n').filter(Boolean);
  t('全銀のファイルは120字の行・英数と空白だけ（偽の部品の形）', recs.length >= 3 && recs.every((r) => r.length === 120) && /^[\x20-\x7e\r\n]*$/.test(buf.toString('latin1')));
  await p2.waitForSelector('text=振込する分と一致');
  t('全銀の合計を振込する分と照合して出す', true);
  t('全銀の時は口座の全桁を書き出し専用の口から受け取った', o2.routes.calls.some((c) => c.name === 'payroll_bank_export'));
  fs.rmSync(zp, { force: true });
  t('画面のエラー 0', o.errors.length + o2.errors.length === 0, o.errors.concat(o2.errors));
  await o2.ctx.close();
}

/* ── 6. 覆い・設定・iPhone・暗い表示・10分 ── */
console.log('\n— 6. 覆い・その他 —');
{
  const o = await open({ tab: 'run', deny: true });
  await o.page.waitForFunction(() => !document.getElementById('p-gate').hidden, null, { timeout: 15000 });
  t('42501 なら覆いの画面だけ（給与の名簿に入っていない）', /給与の名簿に入っていません/.test(await o.page.textContent('#p-gate')) && await o.page.evaluate(() => document.getElementById('p-app').hidden));
  await shot(o.page, 'payroll.denied.pc', false);
  await o.ctx.close();
  const o2 = await open({ tab: 'run', role: 'office', aal: 'aal1' });
  await o2.page.waitForFunction(() => !document.getElementById('p-gate').hidden, null, { timeout: 15000 });
  t('二段階のログインが無ければ案内して何も読まない', /二段階のログイン/.test(await o2.page.textContent('#p-gate')) && !o2.routes.calls.some((c) => c.name === 'payroll_bootstrap'));
  await o2.ctx.close();
  const o3 = await open({ tab: 'settings', role: 'office' });
  await waitApp(o3.page);
  t('事務員（名簿の人）には設定のタブを出さず、設定のタブを残していても今月の給与で開く', await o3.page.evaluate(() => document.querySelector('.tabs [data-tab="settings"]').hidden && document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab') === 'run'));
  await o3.ctx.close();
  const o4 = await open({ tab: 'bogus', start: 'confirmed' });
  await waitApp(o4.page);
  t('知らないタブの値は今月の給与に戻す', await o4.page.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'run');
  await o4.page.click('[data-tab="settings"]');
  await shot(o4.page, 'payroll.settings.pc');
  await o4.page.click('[data-tab="profile"]');
  await shot(o4.page, 'payroll.profile.pc');
  t('職員の給与設定で抜けを赤の札で出す（口座の無い人）', /抜け：口座/.test(await o4.page.textContent('#p-main')));
  /* 給与設定の保存: 画面に無い項目を消さない・理由が要る */
  await o4.page.click('[data-act="prof"][data-sid="s-02"]');
  await o4.page.fill('#f-base', '1150');
  await o4.page.fill('#f-reason', '見本の昇給');
  await o4.page.click('[data-act="prof-go"]');
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const pc = o4.routes.calls.filter((c) => c.name === 'payroll_profile_put').pop();
  t('給与設定の保存: 変えた値・期間の初日・版・理由を送り、画面に無い項目（住民税・性別）は消さない', !!pc && pc.args.p_data.base === 1150 && pc.args.p_effective_from === '2025-12-16' && pc.args.p_rev === 1 && pc.args.p_reason === '見本の昇給'
    && pc.args.p_data.resident_tax['2026-01'] === 9000 && pc.args.p_data.gender === 'female' && pc.args.p_data.ins.health.std === 150000, pc && pc.args);
  /* freee の書き出しの取り込み: 画面の中だけで読み、違いの表は口座を下4桁だけ・送る時に全桁 */
  const csv = '従業員番号,氏名,給与形態,基本給,時給,口座種別,銀行コード,支店コード,口座番号,口座名義\r\nF-1,見本 一郎,月給,245000,,普通,9999,001,7654321,ﾐﾎﾝ ｲﾁﾛｳ\r\nF-9,見本 不明,時給,,1000,,,,,\r\n';
  await o4.page.setInputFiles('#i-file', { name: 'freee.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await o4.page.waitForSelector('[data-act="imp-go"]');
  const it = await o4.page.textContent('#p-main');
  t('取り込み: 違い（基本給）と口座の下4桁を見せ、全桁は出さない・名簿に無い人は送らない', /基本給・時給など：240,000円 → 245,000円/.test(it) && /口座：＊＊＊4321/.test(it) && !/7654321/.test(it) && /見つかりません（送りません）/.test(it) && /1人分を送る/.test(it));
  await shot(o4.page, 'payroll.import.pc');
  o4.page.once('dialog', (d) => d.accept());
  await o4.page.click('[data-act="imp-go"]');
  await o4.page.waitForFunction(() => !document.querySelector('[data-act="imp-go"]'), null, { timeout: 10000 });
  const ic = o4.routes.calls.filter((c) => c.name === 'payroll_import_put').pop();
  t('取り込み: 送るのは名簿に合った1人だけ・口座の全桁と違いの値', !!ic && ic.args.p_rows.length === 1 && ic.args.p_rows[0].staff_id === 's-01' && ic.args.p_rows[0].patch.base === 245000 && ic.args.p_rows[0].bank.number === '7654321' && !!ic.args.p_reason, ic && ic.args);
  await o4.page.click('[data-act="bank"][data-sid="s-01"]');
  await shot(o4.page, 'payroll.bank-dialog.pc', false);
  await o4.page.keyboard.press('Escape');
  /* 10分操作が無い（時計を進める代わりに最後の操作の時刻を戻す） */
  await o4.page.click('[data-tab="run"]');
  await o4.page.evaluate(() => { const ev = new Event('visibilitychange'); Date.now = ((n) => () => n + 11 * 60 * 1000)(Date.now()); document.dispatchEvent(ev); });
  await o4.page.waitForSelector('text=金額を隠しました');
  t('10分操作が無ければ金額を画面から消す（数字が残らない）', !/\d{2,3},\d{3}/.test(await o4.page.textContent('#p-main')) && !/\d,\d{3}/.test(await o4.page.textContent('#p-print')));
  await shot(o4.page, 'payroll.masked.pc', false);
  t('画面のエラー 0', o4.errors.length === 0, o4.errors);
  await o4.ctx.close();
  for (const [nm, vp, dark, tabn] of [['run.ph', { width: 390, height: 844 }, false, 'run'], ['slip.ph', { width: 390, height: 844 }, false, 'slip'], ['run.dark', { width: 1280, height: 900 }, true, 'run'], ['run.ph-dark', { width: 390, height: 844 }, true, 'run'], ['profile.ph', { width: 390, height: 844 }, false, 'profile']]) {
    const q = await open({ tab: tabn, start: 'confirmed', viewport: vp, dark });
    await waitApp(q.page);
    if (tabn === 'run') { await q.page.click('details.it[data-sid="s-09"] > summary'); await q.page.waitForSelector('details.it[data-sid="s-09"] table'); }
    const over = await q.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    t(nm + ': 画面の横はみ出し 0（表は枠の中で横に送る）', over <= 0, over);
    await shot(q.page, 'payroll.' + nm);
    t(nm + ': 画面のエラー 0', q.errors.length === 0, q.errors);
    await q.ctx.close();
  }
}

await browser.close();
await srv.close();
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
