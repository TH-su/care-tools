/* check/payroll_e2e.mjs — 給与の画面（payroll.html）の通し試験と撮影（2026-11-19 新設）
 *
 *   node check/payroll_e2e.mjs [--shots <保存先>]
 *
 * 偽のデータベース（check/fixtures/payroll.mjs・統合 0102 の関数の引数の名前と形の確かめを写したもの）と本物の計算・書き出しの部品で、本物の Chromium で開き、
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
import { loadPlaywright, startServer, parseArgs, pdfPages, ensureDir } from './lib.mjs';
import * as FX from './fixtures/payroll.mjs';

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const SHOTS = args.shots ? ensureDir(path.resolve(String(args.shots))) : null;
const { chromium } = loadPlaywright();
const srv = await startServer(repoDir);
const browser = await chromium.launch({ args: ['--disable-font-subpixel-positioning'] });
/* 月分は 2026-11（期間 10/16〜11/15・支給日 11/27）。率表（令和8年3月分〜）の中で本物の率のまま計算するため、撮影の道具の固定の日（2026-01）ではなくこの日に固定する */
const CLOCK = new Date('2026-11-20T09:00:00+09:00');
const YM = '2026-11';
const run = (o) => o.routes.db.runs[YM] || { status: null, rev: 0 };
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

async function open(opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: opt.dark ? 'dark' : 'light', acceptDownloads: true });
  const routes = FX.routesFor(Object.assign({ ym: YM, now: CLOCK }, opt));
  const outside = [];
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.origin === srv.url || u.origin === FX.URL) return route.fallback(); outside.push(u.origin); return route.abort(); });
  for (const r of routes) await ctx.route(r.match, r.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, FX.storageFor(opt));
  const page = await ctx.newPage();
  /* 時計は固定の日（月分は 2026-11＝材料の月分）。タイマーは動かす */
  await page.clock.setFixedTime(CLOCK);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* 暗証番号の状態（payroll_pin_status）は、偽の DB がわざと置いていない（統合 0110 より前の DB の真似＝鍵の画面を出さずに開く）。
     その1つの住所の読み込みの失敗だけは画面のエラーに数えない（ほかの住所の失敗は今までどおり数える・2026-11-21） */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location && m.location().url) || '';
    if (/^Failed to load resource/.test(m.text()) && /\/rest\/v1\/rpc\/payroll_pin_status$/.test(loc)) return;
    errors.push('console: ' + m.text() + (loc && /^Failed to load resource/.test(m.text()) ? ' @' + loc.replace(/^https?:\/\/[^/]+/, '') : ''));
  });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'log' || m.type() === 'info') logs.push(m.text()); });
  await page.goto(srv.url + '/payroll.html');
  return { ctx, page, routes, errors, outside, logs };
}
/* 画面の中の窓（su-dialog.js）に答える。開いてすぐの押下は受けないので少し待ってから押す。出た文を返す（窓が出なければ ''） */
async function sud(page, answer = 'ok', wait = 5000) {
  try { await page.waitForSelector('dialog.sud-dlg[open]', { timeout: wait }); } catch (e) { return ''; }
  const msg = await page.textContent('dialog.sud-dlg[open] .sud-msg');
  await page.waitForTimeout(400);
  await page.click(answer === 'ok' ? 'dialog.sud-dlg[open] .sud-btn.pri' : 'dialog.sud-dlg[open] .sud-btn:not(.pri)');
  await page.waitForFunction(() => !document.querySelector('dialog.sud-dlg[open]'), null, { timeout: 5000 }).catch(() => {});
  return msg;
}
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); };
/* 画面が開き、職員の並び（入職順・kintai_master_list）の読み込みと描き直しまで落ち着くのを待つ（描き直しの途中でファイルの欄などを触らない・2026-11-21） */
/* 読み直し（読み込みの表示）と通信が落ち着くのを待つ */
const settle = async (page) => {
  await page.waitForFunction(() => !document.getElementById('p-sync').textContent, null, { timeout: 10000 });
  await page.waitForLoadState('networkidle').catch(() => {});
};
const waitApp = async (page) => {
  await page.waitForFunction(() => !document.getElementById('p-app').hidden && !document.querySelector('#p-main .skel'), null, { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
};

/* ── 1. 計算→下書き保存→確定 ── */
console.log('\n— 1. 計算 → 下書き保存 → 確定 —');
{
  const o = await open({ tab: 'run', start: 'none' });
  const p = o.page;
  await waitApp(p);
  t('今月の給与のタブで開く（端末に残したタブ）', await p.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'run');
  t('管理者には設定のタブが出る', await p.evaluate(() => !document.querySelector('.tabs [data-tab="settings"]').hidden));
  t('期間つきの月分を出す', /11月分（10\/16〜11\/15）/.test(await p.textContent('#p-period')));
  await p.click('[data-act="compute"]');
  t('計算すると給与の設定がある10人分の行が出る（設定の無い人は計算しない）', (await p.locator('details.it').count()) === 10 && (await p.locator('details.it[data-sid="s-11"]').count()) === 0);
  t('偽の部品ではなく本物の部品を読んでいる', await p.evaluate(() => !window.PayrollCalc.STUB && !window.PayrollExport.STUB && typeof window.PayrollRates.health === 'function'));
  t('下書き保存の前は確定を押せない', await p.isDisabled('[data-act="confirm"]'));
  await shot(p, 'payroll.run.pc');
  await p.click('details.it[data-sid="s-01"] > summary');
  await p.waitForSelector('details.it[data-sid="s-01"] [data-act="adj"]');
  t('行を開くと支給・控除・勤怠の根拠が出る', await p.locator('details.it[data-sid="s-01"] table').count() >= 3);
  const body1 = await p.textContent('details.it[data-sid="s-01"]');
  t('本物の部品の明細: 基本給・資格手当・健康保険料・厚生年金保険料・雇用保険料・所得税・住民税の行', ['基本給', '資格手当', '健康保険料', '厚生年金保険料', '雇用保険料', '所得税', '住民税'].every((k) => body1.includes(k)), body1.slice(0, 400));
  t('勤怠の根拠は締めた勤怠（予定どおりの20日×8時間＝160:00）・名前の「（分）」は見せない', /総労働160:00/.test(body1.replace(/\s+/g, '')) && !/総労働（分）/.test(body1), body1.slice(0, 600));
  t('締めた勤怠を数え直して控えと合うことを確かめた（kintai_month_get を読んだ）', o.routes.calls.some((c) => c.name === 'kintai_month_get' && c.args.p_ym === YM));
  /* 手で確かめた値（契約 §0 の決まりで電卓で出した・2026-11-19）: 見本 一郎＝月給 240,000・資格手当 10,000・通勤 8,000（非課税）・時間外なし（予定どおりの勤怠）・
     健保と厚年の標準報酬 260,000・令和8年4月分〜の熊本の率・翌月徴収（対象月 2026-10）
       総支給 240,000＋10,000＋8,000＝258,000
       健保 260,000×10.08%÷2＝13,104・介護 260,000×1.62%÷2＝2,106・支援金 260,000×0.23%÷2＝299・厚年 260,000×18.3%÷2＝23,790
       雇保 258,000×0.5%＝1,290
       課税対象 258,000−4,200−(13,104＋2,106＋299＋23,790＋1,290)＝213,211
     ★総点検（2026-11-21）: 通勤手当の非課税の上限を国税庁の表で入れた（車・片道6km は月4,200円まで・令和7年4月1日以後）ので、
       非課税は 8,000 でなく 4,200、課税対象は 209,411 から 213,211 に改めた（前は上限の表が空で通勤手当の全額を非課税にしていた）
     所得税（税額表の引き）・住民税（設定の額）は手で確かめていない値なので比べない */
  await shot(p, 'payroll.run-open.pc');
  const s01 = await p.evaluate(() => { const o = {}; document.querySelectorAll('details.it[data-sid="s-01"] tbody tr').forEach((tr) => { const td = tr.querySelectorAll('td'); if (td.length >= 3) o[td[0].textContent.trim()] = td[2].textContent.trim(); }); return o; });
  const y = (k) => Number(String(s01[k] || '').replace(/[^\d]/g, ''));
  t('手で確かめた値と一致（時間外の行なし・健保 13,104・介護 2,106・支援金 299・厚年 23,790・雇保 1,290）', !('時間外労働' in s01) && y('健康保険料') === 13104 && y('介護保険料') === 2106 && y('子ども・子育て支援金') === 299 && y('厚生年金保険料') === 23790 && y('雇用保険料') === 1290, s01);
  t('手で確かめた値と一致（総支給 258,000・課税対象 213,211）', /258,000/.test(await p.textContent('details.it[data-sid="s-01"] > summary')) && /課税対象 213211/.test(body1), body1.slice(0, 200));
  /* その月だけの調整（理由が無いと足せない） */
  await p.click('details.it[data-sid="s-01"] [data-act="adj"]');
  await p.fill('#a-name', '見本の立替');
  await p.fill('#a-amt', '3000');
  await p.click('[data-act="adj-go"]');
  const mAdj = await sud(p);
  t('理由が無いと調整を足さない（画面の中の窓で知らせ・入力の窓は開いたまま）', /理由を書いてください/.test(mAdj) && await p.evaluate(() => document.getElementById('p-dlg').open), mAdj);
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
  await p.click('[data-act="confirm-go"]');
  await sud(p);
  t('警告に印を入れないと確定しない', await p.evaluate(() => document.getElementById('p-dlg').open) && run(o).status === 'draft');
  await p.check('#c-ack');
  await p.click('[data-act="confirm-go"]');
  await p.waitForFunction(() => /確定済み/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('確定すると確定済みになり、計算するのボタンが消える', run(o).status === 'confirmed' && (await p.locator('[data-act="compute"]').count()) === 0);
  const sv = o.routes.calls.filter((c) => c.name === 'payroll_run_save').pop();
  /* ★2026-11-21（反証レビュー 5）: 計算の版の印を payroll-calc-2・率表の版を rates-2026-11-21 に上げたので期待を改めた */
  t('下書き保存は {staff_id, item, adjustments} の形（item に氏名・口座を入れない）・指紋は bootstrap の値＋率と計算の版', !!sv && sv.args.p_items.every((x) => Object.keys(x).sort().join() === 'adjustments,item,staff_id' && !('name' in x.item) && !('bank_last4' in x.item) && /^\d{4}-\d{2}-\d{2}$/.test(x.item.pay_date))
    && sv.args.p_fingerprint.rates_ver === 'rates-2026-11-21' && sv.args.p_fingerprint.calc_ver === 'payroll-calc-2' && 'kintai_locked_at' in sv.args.p_fingerprint && 'allowances' in sv.args.p_fingerprint, sv && Object.keys(sv.args.p_fingerprint));
  t('支給日は 2026-11-27（金曜・手で確かめた値）を明細に写し、指紋にも入れた', !!sv && sv.args.p_items.every((x) => x.item.pay_date === '2026-11-27') && sv.args.p_fingerprint.pay_date === '2026-11-27');
  t('確定を押した時にもう一度読み直し、締めた勤怠も数え直した（bootstrap → kintai_month_get → 確定）', (() => { const n = o.routes.calls.map((c) => c.name); const i = n.lastIndexOf('payroll_run_confirm'); return i > 1 && n[i - 1] === 'kintai_month_get' && n[i - 2] === 'payroll_bootstrap'; })());
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
  t('数字が変わっていたら確定しない（下書きのまま）', run(o).status === 'draft');
  t('新しい数字で計算し直し、もう一度保存を促す', !(await p.isDisabled('[data-act="save"]')) && await p.isDisabled('[data-act="confirm"]'));
  t('payroll_run_confirm を呼んでいない', !o.routes.calls.some((c) => c.name === 'payroll_run_confirm'));
  /* 3. 保存の時に stale（勤怠の締めが変わった） */
  o.routes.db.kintai.locked_at = '2026-11-17T09:00:00+09:00';   /* 締め直した（勤怠の中身は同じ） */
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => /計算した後に変わりました/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('stale と言われたら読み直して計算し直す（保存も確定もしない・保存のボタンはまた押せる）', run(o).status === 'draft' && !(await p.isDisabled('[data-act="save"]')));
  await p.click('[data-act="save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  t('計算し直した後の保存は通る', run(o).rev >= 2);
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
  t('印刷したことを記録した（種類 payslip）', o.routes.db.log.includes('payslip'));
  await p.emulateMedia({ media: 'print' });
  if (SHOTS) {
    await p.screenshot({ path: path.join(SHOTS, 'payroll.slips.print.png'), fullPage: true });
    const pdf = path.join(SHOTS, 'payroll.slips.pdf');
    await p.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const n = pdfPages(pdf);
    t('印刷の PDF は10ページ（1人1ページ）', n === 10, n);
  }
  await p.emulateMedia({ media: 'screen' });
  /* 確定の写し（統合 0102 の frozen）: 確定の後に設定の事業者名・口座を変えても、明細は写した名前・口座の下4桁で出す */
  {
    const o5 = await open({ tab: 'slip', start: 'confirmed' });
    o5.routes.db.settings.config.company_name = '見本の新しい名前';
    o5.routes.db.bank['s-01'] = { rev: 2, accounts: [{ bank_code: '9997', branch_code: '003', type: '1', number: '0009999', name_kana: 'ﾐﾎﾝ', amount_or_rest: 'rest' }] };
    await waitApp(o5.page); await o5.page.waitForSelector('#p-main .slip');
    const tx = await o5.page.textContent('#p-main .slip');
    t('確定した月は DB が写した設定（事業者名）・期間・口座の下4桁で明細を出し、今の値から取らない', /見本の事業者/.test(tx) && !/見本の新しい名前/.test(tx) && /10\/16〜11\/15/.test(tx) && /＊＊＊1000/.test(tx) && /＊＊＊2222/.test(tx) && !/9999/.test(tx), tx.slice(0, 300));
    await o5.ctx.close();
  }
  t('確定した月の明細は、明細に写した支給日（11/27）と DB が写した氏名で出す', /2026年11月27日/.test(await p.textContent('#p-main .slip')) && /見本 一郎/.test(await p.textContent('#p-main .slip')));
  /* 確定の取り消し（管理者・理由が要る・統合 0102 の payroll_run_unconfirm(p_ym, p_reason)） */
  await p.evaluate(() => { window.print = function () {}; });
  await p.click('[data-tab="run"]');
  await p.click('[data-act="unconfirm"]');
  await p.fill('#u-reason', '見本の直し');
  await p.click('[data-act="unconfirm-go"]');
  await p.waitForSelector('[data-act="compute"]', { timeout: 10000 });
  t('確定を取り消すと下書きに戻り、計算し直せる', run(o).status === 'draft' && o.routes.calls.some((c) => c.name === 'payroll_run_unconfirm' && c.args.p_reason === '見本の直し'));
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
  t('賃金台帳の CSV をダウンロードできる（記録してから）', /^payroll-ledger-2026-11\.csv$/.test(dl.suggestedFilename()) && o.routes.db.log.includes('ledger'));
  const lt = fs.readFileSync(await dl.path(), 'utf8');
  t('賃金台帳は本物の書き出し（労基則54条の見出し・期間・性別）', /従業員番号,氏名,性別,賃金計算期間/.test(lt) && /2026-10-16〜2026-11-15/.test(lt) && /見本 一郎,男/.test(lt));
  fs.rmSync(await dl.path(), { force: true });
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-k="list"]')]);
  t('明細一覧の CSV は記録の種類 csv で残す', /^payroll-list-2026-11\.csv$/.test(dl2.suggestedFilename()) && o.routes.db.log.includes('csv'));
  fs.rmSync(await dl2.path(), { force: true });
  const [dl3] = await Promise.all([p.waitForEvent('download'), p.click('[data-k="journal"]')]);
  t('仕訳の CSV（借方と貸方が合う時だけ落とす）', /^payroll-journal-2026-11\.csv$/.test(dl3.suggestedFilename()) && /^\uFEFF?取引日,借方勘定科目/.test(fs.readFileSync(await dl3.path(), 'utf8')));
  fs.rmSync(await dl3.path(), { force: true });
  t('payroll_bank_export を呼んでいない（全銀を押していない）', !o.routes.calls.some((c) => c.name === 'payroll_bank_export'));
  await shot(p, 'payroll.export.pc');
  await o.ctx.close();
  const o2 = await open({ tab: 'export', start: 'confirmed', zengin: true });
  const p2 = o2.page;
  await waitApp(p2);
  const [dz] = await Promise.all([p2.waitForEvent('download'), p2.click('[data-k="zengin"]')]);
  const zp = await dz.path(), buf = fs.readFileSync(zp);
  const recs = buf.toString('latin1').split('\r\n').filter(Boolean);
  t('全銀のファイルは120バイトの行・ヘッダ→データ→トレーラ→エンドの順（本物の書き出し）', recs.length >= 4 && recs.every((r) => r.length === 120) && recs[0][0] === '1' && recs[recs.length - 2][0] === '8' && recs[recs.length - 1][0] === '9' && recs.slice(1, -2).every((r) => r[0] === '2'), recs.map((r) => r.length));
  /* ファイルが落ちた後の読み直しと描き直し（全銀の合計の行）が済んでから画面の文を読む（読み直しの前に読むと件数の行がまだ無い・CI で1回落ちた 2026-11-21） */
  await p2.waitForSelector('text=振込する分と一致');
  const zc = await p2.textContent('#p-main');
  const nData = recs.length - 3;
  t('口座を2つに分けた人は2件と数え、画面の振込の件数と全銀の件数が合う', new RegExp('振込 ' + nData + '件').test(zc) && new RegExp('全銀ファイルの合計（' + nData + '件）').test(zc), [nData, zc.slice(0, 400)]);
  await p2.waitForSelector('text=振込する分と一致');
  t('全銀の合計を振込する分と照合して出す', true);
  t('全銀の時は口座の全桁を書き出し専用の口から受け取った', o2.routes.calls.some((c) => c.name === 'payroll_bank_export'));
  /* 振込元の設定が足りない時は、口座の全桁を受け取る前に止める（月を書き出し済みにしない） */
  {
    const o3 = await open({ tab: 'export', start: 'confirmed', zengin: true });
    await waitApp(o3.page);
    delete o3.routes.db.settings.config.bank_from.consignor_code;
    await o3.page.click('#p-reload'); await waitApp(o3.page);
    await o3.page.click('[data-k="zengin"]');
    const m3 = await sud(o3.page);
    t('振込元の設定が足りない時は口座を受け取らず（bank_export・記録を呼ばない）、月も書き出し済みにしない', /振込元の設定に足りない所があるので/.test(m3) && !o3.routes.calls.some((c) => c.name === 'payroll_bank_export' || c.name === 'payroll_export_log') && run(o3).status === 'confirmed', m3);
    await o3.ctx.close();
  }
  /* 統合 0118: 書き出し済みの月をもう一度書き出す時は、確かめの窓（「いいえ」なら何も送らない・「はい」なら zengin_again を記録してから受け取る） */
  t('1回目の書き出しで月は書き出し済み', run(o2).status === 'exported');
  {
    const n0 = o2.routes.calls.length;
    await p2.click('[data-k="zengin"]');
    const ma = await sud(p2, 'cancel');
    t('書き出し済みの月の振込データは、二重の振込を確かめる窓を出し、「いいえ」なら何も送らない', /もう書き出しています/.test(ma) && /二重に振り込まれます/.test(ma)
      && !o2.routes.calls.slice(n0).some((c) => c.name === 'payroll_export_log' || c.name === 'payroll_bank_export'), ma);
    let dla = null; p2.once('download', (d) => { dla = d; });
    await p2.click('[data-k="zengin"]');
    await sud(p2, 'ok');
    await p2.waitForTimeout(800);
    const ca = o2.routes.calls.slice(n0).filter((c) => c.name === 'payroll_export_log' || c.name === 'payroll_bank_export').map((c) => c.name + ':' + (c.args.p_kind || ''));
    t('「はい」なら zengin_again を記録してから口座を受け取り、もう一度ファイルを作る', JSON.stringify(ca) === JSON.stringify(['payroll_export_log:zengin_again', 'payroll_bank_export:']) && !!dla, ca);
    if (dla) fs.rmSync(await dla.path(), { force: true });
    /* 確かめの記録が DB に残らなかった（別の画面で書き出された・10分を過ぎた）として: DB は exported で断り、画面はその知らせを出す */
    const au = o2.routes.db.audit;
    au.push = function (x) { return x && x.action === 'export_zengin_again' ? this.length : Array.prototype.push.call(this, x); };
    let dlx = false; p2.once('download', () => { dlx = true; });
    await p2.click('[data-k="zengin"]');
    await sud(p2, 'ok');
    const mx = await sud(p2);
    delete au.push;
    t('DB がもう一度の書き出しを断った（exported）時は、ファイルを作らずその知らせを出す', /もう一度作る時は/.test(mx) && !dlx, mx);
  }
  /* 確定の後に口座が直された（統合 0102 は stale で断る）: 計算し直しの知らせではなく口座の知らせ */
  /* 全銀の合計・件数が画面の振込する分と合わない（確定の後に口座の分け方が変わった・版は同じ）: ファイルを作らず知らせる */
  o2.routes.db.bank['s-01'].accounts = [o2.routes.db.bank['s-01'].accounts[0]];
  let dl9 = false; p2.once('download', () => { dl9 = true; });
  await p2.click('[data-k="zengin"]');
  await sud(p2, 'ok');   /* 0118: もう一度の書き出しの確かめ */
  const msg9 = await sud(p2);
  t('全銀の件数が画面の振込する分と合わない時はファイルを作らず知らせる', /と合いません。ファイルは作っていません/.test(msg9) && !dl9, msg9);
  /* 確定の後に口座が直された（統合 0102 は stale で断る）: 計算し直しの知らせではなく口座の知らせ */
  o2.routes.db.bank['s-02'].rev++;
  await p2.click('[data-k="zengin"]');
  await sud(p2, 'ok');   /* 0118: もう一度の書き出しの確かめ */
  const msg2 = await sud(p2);
  t('確定の後に口座が直されていたら、振込データを作らず口座の知らせを出す', /確定した後に振込先の口座が直されました/.test(msg2), msg2);
  /* 全銀を使わない設定（DB が zengin_off で断る）。ボタンは出ないが、DB の断りも口座の知らせと別の文にする */
  o2.routes.db.bank['s-02'].rev--;
  o2.routes.db.settings.config.zengin_enabled = false;
  await p2.click('[data-k="zengin"]');
  await sud(p2, 'ok');   /* 0118: もう一度の書き出しの確かめ */
  const msgOff = await sud(p2);
  t('DB が全銀を使わない設定と断った（zengin_off）時は、その知らせを出す', /管理者が「設定」で使うようにするまで使えません/.test(msgOff), msgOff);
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
  /* 給与設定の保存: 画面に無い項目を消さない・理由が要る。住民税は今の年度と前の年度より古い月を外して送る */
  o4.routes.db.profiles.find((q) => q.staff_id === 's-02').data.resident_tax['2024-06'] = 5000;
  o4.routes.db.profiles.find((q) => q.staff_id === 's-02').data.resident_tax['2025-06'] = 6000;
  await o4.page.click('#p-reload'); await waitApp(o4.page);
  await o4.page.click('[data-act="prof"][data-sid="s-02"]');
  await o4.page.fill('#f-base', '1150');
  await o4.page.fill('#f-reason', '見本の昇給');
  await o4.page.click('[data-act="prof-go"]');
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const pc = o4.routes.calls.filter((c) => c.name === 'payroll_profile_put').pop();
  t('給与設定の保存: 変えた値・期間の初日・新しい版（rev 0）・理由を送り、画面に無い項目（住民税・性別）は消さない', !!pc && pc.args.p_data.base === 1150 && pc.args.p_effective_from === '2026-10-16' && pc.args.p_rev === 0 && pc.args.p_reason === '見本の昇給'
    && pc.args.p_data.resident_tax['2026-11'] === 9000 && pc.args.p_data.gender === 'F' && pc.args.p_data.ins.health.std === 150000, pc && pc.args);
  t('給与設定の保存: 甲乙・扶養を確かめた印（確かめた人は印が入って開く）をそのまま送る', !!pc && pc.args.p_data.tax.dependents_checked === true, pc && pc.args.p_data.tax);
  t('住民税: 前の年度より古い月（2024-06）は外し、前の年度（2025-06）と今の年度（2026-11）は残す', !!pc && !('2024-06' in pc.args.p_data.resident_tax) && pc.args.p_data.resident_tax['2025-06'] === 6000 && pc.args.p_data.resident_tax['2026-11'] === 9000, pc && pc.args.p_data.resident_tax);
  t('給与設定の保存は DB の形の確かめを通った（新しい版が足された）', o4.routes.db.profiles.some((q) => q.staff_id === 's-02' && q.effective_from === '2026-10-16' && q.data.base === 1150));
  /* 固定残業代の欄（手当・含む時間（分）・確かめた）: s-09 の夜勤手当を固定残業代として 600分・確かめた */
  await o4.page.click('[data-act="prof"][data-sid="s-09"]');
  await o4.page.selectOption('#f-fot', 'night'); await o4.page.fill('#f-fotmin', '600'); await o4.page.check('#f-fotok');
  await o4.page.fill('#f-reason', '見本の固定残業');
  await o4.page.click('[data-act="prof-go"]');
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const pf = o4.routes.calls.filter((c) => c.name === 'payroll_profile_put').pop();
  t('固定残業代: 手当・含む時間（分）・確かめた を送り、DB の確かめを通る', !!pf && JSON.stringify(pf.args.p_data.fixed_ot) === JSON.stringify({ allowance_code: 'night', covered_min: 600, checked: true })
    && o4.routes.db.profiles.some((q) => q.staff_id === 's-09' && q.effective_from === '2026-10-16' && q.data.fixed_ot && q.data.fixed_ot.checked === true), pf && pf.args.p_data.fixed_ot);
  /* 統合 0118: 通勤手当の駐車場の料金（本人が負担・月）の欄。s-01（車・片道6km）に 3000円 */
  await o4.page.click('[data-act="prof"][data-sid="s-01"]');
  await o4.page.fill('#f-cmp', '3000');
  await o4.page.fill('#f-reason', '見本の駐車場');
  await o4.page.click('[data-act="prof-go"]');
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const pk = o4.routes.calls.filter((c) => c.name === 'payroll_profile_put').pop();
  t('駐車場の料金: 通勤手当の parking_monthly で送り（手段・距離・月の額はそのまま）、DB の確かめを通る', !!pk && pk.args.p_staff_id === 's-01'
    && JSON.stringify(pk.args.p_data.commute) === JSON.stringify({ monthly: 8000, means: 'car', distance_km: 6, parking_monthly: 3000 })
    && o4.routes.db.profiles.some((q) => q.staff_id === 's-01' && q.effective_from === '2026-10-16' && q.data.commute.parking_monthly === 3000), pk && pk.args.p_data.commute);
  t('給与の設定の無い人には印を出す', /給与の設定なし/.test(await o4.page.textContent('#p-main')));
  /* freee の書き出しの取り込み: 画面の中だけで読み、違いの表は口座を下4桁だけ・送る時に全桁 */
  const csv = '従業員番号,氏名,給与形態,基本給,時給,口座種別,銀行コード,支店コード,口座番号,口座名義\r\nF-1,見本 一郎,月給,245000,,普通,9999,001,7654321,ﾐﾎﾝ ｲﾁﾛｳ\r\nF-9,見本 不明,時給,,1000,,,,,\r\n,見本 二子,,,,普通,9999,001,1111111,\r\n';
  await settle(o4.page);   /* 直前の設定の保存の後の読み直しが終わってから選ぶ（読み直しの間に読んだファイルは、画面が古いとして捨てる） */
  await o4.page.setInputFiles('#i-file', { name: 'freee.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await o4.page.waitForSelector('[data-act="imp-go"]');
  const it = await o4.page.textContent('#p-main');
  t('取り込み: 違い（基本給）と口座の下4桁を見せ、全桁は出さない・名簿に無い人は送らない', /基本給・時給など：240,000円 → 245,000円/.test(it) && /口座：＊＊＊4321/.test(it) && !/7654321/.test(it) && /見つかりません（送りません）/.test(it) && /2人分を送る/.test(it));   /* 見本 二子は口座を送らず、甲乙・扶養の「未確認」だけを送る（2026-11-19） */
  t('取り込み: 口座名義が空の行は口座を送らないと知らせる', /口座名義が無いので送りません/.test(it));
  t('取り込み: 表の上に読めた項目の数と読めなかった主な項目を1行で出す（2026-11-20）', /見出しから読めた項目：10個（読めなかった主な項目：標準報酬・加入・納税者区分・扶養）/.test(it));
  t('取り込み: 扶養・甲乙の列が無い人は「未確認」で入れると表に出す', /甲乙・扶養の確かめ：確かめた → 未確認|甲乙・扶養の確かめ：（空） → 未確認/.test(it));
  await shot(o4.page, 'payroll.import.pc');
  await o4.page.click('[data-act="imp-go"]');
  await sud(o4.page);
  await o4.page.waitForFunction(() => !document.querySelector('[data-act="imp-go"]'), null, { timeout: 10000 });
  const ic = o4.routes.calls.filter((c) => c.name === 'payroll_import_put').pop();
  const pl = ic && ic.args.p_payload;
  t('取り込み: 扶養・甲乙の列が無い人は dependents_checked=false で送る', !!pl && pl.profiles.length === 2 && pl.profiles.every((x) => x.data.tax.dependents_checked === false));
  t('取り込み: 送るのは名簿に合った人だけ・今の設定に違いを当てた全体（期間の初日）と口座の全桁（口座名義の無い人の口座は送らない）', !!pl && pl.profiles[0].staff_id === 's-01' && pl.profiles[1].staff_id === 's-02' && pl.profiles[0].effective_from === '2026-10-16' && pl.profiles[0].data.base === 245000
    && pl.profiles[0].data.ins.health.std === 260000 && pl.banks.length === 1 && pl.banks[0].accounts[0].number === '7654321', pl);
  t('取り込みは足すだけ（この月分の版・口座がもうある人は書き換えず、そう知らせる）', /この月分の版がもうあるので設定は書き換えません/.test(it) && /口座がもうあるので口座は書き換えません/.test(it) && o4.routes.db.profiles.filter((q) => q.staff_id === 's-01' && q.effective_from === '2026-10-16')[0].data.base === 240000);
  /* 加入の列から ins.*.on を作る（無ければ標準報酬の有無）・給与の設定が無い人（s-11）は新しい設定として足す */
  const csv2 = '従業員番号,氏名,給与形態,基本給,健康保険の標準報酬月額,厚生年金保険の標準報酬月額,健康保険,雇用保険\r\nF-11,見本 十一,月給,205000,200000,200000,加入,未加入\r\n';
  /* 1つ目を送った後の読み直しが終わってから選ぶ（読み直しの間に読んだファイルは、画面が古いとして捨てるため・2026-11-21） */
  await settle(o4.page);
  await o4.page.setInputFiles('#i-file', { name: 'freee2.csv', mimeType: 'text/csv', buffer: Buffer.from(csv2, 'utf8') });
  await o4.page.waitForSelector('[data-act="imp-go"]');
  t('取り込み: 加入の違いを表に出す', /健康保険の加入：（空） → 加入/.test(await o4.page.textContent('#p-main')) && /雇用保険の加入：（空） → 加入しない/.test(await o4.page.textContent('#p-main')));
  await o4.page.click('[data-act="imp-go"]');
  await sud(o4.page);
  await o4.page.waitForFunction(() => !document.querySelector('[data-act="imp-go"]'), null, { timeout: 10000 });
  const ic2 = o4.routes.calls.filter((c) => c.name === 'payroll_import_put').pop(), d11 = ic2 && ic2.args.p_payload.profiles && ic2.args.p_payload.profiles[0].data;
  t('取り込み: 健保は列で加入・厚年は列が無いので標準報酬ありで加入・雇保は列で加入しない（DB の確かめを通って足された）', !!d11 && d11.ins.health.on === true && d11.ins.pension.on === true && d11.ins.emp.on === false
    && o4.routes.db.profiles.some((q) => q.staff_id === 's-11' && q.effective_from === '2026-10-16'), d11 && d11.ins);
  await o4.page.click('[data-act="bank"][data-sid="s-01"]');
  await shot(o4.page, 'payroll.bank-dialog.pc', false);
  await o4.page.keyboard.press('Escape');
  /* 設定のタブ: 設定の保存・手当の定義・名簿・操作の記録（管理者だけ）。どれも統合 0102 の形の確かめを通る */
  await o4.page.click('[data-tab="settings"]');
  await o4.page.click('[data-act="set-go"]');
  await o4.page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('p-toast').textContent), null, { timeout: 10000 });
  const sp = o4.routes.calls.filter((c) => c.name === 'payroll_settings_put').pop();
  t('設定の保存: 理由の引数なし・全銀を使う印（zengin_enabled・既定は使わない）を真偽で送る・DB の確かめを通って版が上がる', !!sp && sp.args.p_config.zengin_enabled === false && o4.routes.db.settings.rev === 4 && o4.routes.db.settings.config.bank_from.bank_kana === 'ﾐﾎﾝｷﾞﾝｺｳ', sp && sp.args);
  /* 夜勤手当は深夜の割増を含む（代表者の答え）: 手当の定義の窓に「深夜の割増を含む（夜勤手当）」の欄があり、夜勤手当では印が入っている */
  await o4.page.click('[data-act="alw"][data-code="night"]');
  t('手当の定義に「深夜の割増を含む（夜勤手当）」の欄があり、夜勤手当は印が入っている', await o4.page.isChecked('#w-a-includes_night_premium'));
  await o4.page.keyboard.press('Escape');
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 5000 });
  await o4.page.click('[data-act="alw"][data-code="qual"]');
  await o4.page.fill('#w-name', '資格手当（見本）');
  await o4.page.click('[data-act="alw-go"]');
  await o4.page.waitForFunction(() => /手当・控除の定義を保存しました/.test(document.getElementById('p-toast').textContent), null, { timeout: 10000 });
  const ap = o4.routes.calls.filter((c) => c.name === 'payroll_allowance_put').pop();
  t('手当の定義の保存: 今の版で送り、DB の確かめを通る（名前が変わり版が上がる）', !!ap && ap.args.p_rev === 1 && o4.routes.db.allowances.find((a) => a.code === 'qual').rev === 2 && o4.routes.db.allowances.find((a) => a.code === 'qual').def.name === '資格手当（見本）', ap && ap.args);
  await o4.page.click('[data-act="mem-load"]');
  await o4.page.waitForSelector('#m-add');
  await o4.page.fill('#m-add', 'check-new@example.invalid');
  await o4.page.click('[data-act="mem-add"]');
  await o4.page.waitForFunction(() => /check-new@example\.invalid/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const mp = o4.routes.calls.filter((c) => c.name === 'payroll_members_put').pop();
  t('名簿に足す: 1人ずつ（p_email・p_on）', !!mp && mp.args.p_email === 'check-new@example.invalid' && mp.args.p_on === true, mp && mp.args);
  await o4.page.click('[data-act="aud-load"]');
  await o4.page.waitForFunction(() => /手当・控除の定義/.test((document.querySelector('#p-main .cd:last-child') || {}).textContent || ''), null, { timeout: 10000 });
  t('操作の記録を設定のタブの下の節に出す（何を・いつ・だれが）', /操作の記録/.test(await o4.page.textContent('#p-main')) && /給与の設定/.test(await o4.page.textContent('#p-main .cd:last-child')));
  await shot(o4.page, 'payroll.settings-full.pc');
  /* 口座を全部消す（統合 0102 は accounts=[] と理由で消す）: 確かめの窓が出ている間に10分たったら金額を隠し、後から OK を押しても消さない */
  await o4.page.click('[data-tab="profile"]');
  await o4.page.click('[data-act="bank"][data-sid="s-02"]');
  await o4.page.fill('#b-reason', '見本の退職');
  await o4.page.click('[data-act="bank-go"]');
  await o4.page.waitForSelector('dialog.sud-dlg[open]');
  t('口座を全部消す時は画面の中の窓で確かめる', /口座を全部消して「口座なし（振込しない）」にしますか/.test(await o4.page.textContent('dialog.sud-dlg[open] .sud-msg')));
  /* 10分操作が無い（時計を進める代わりに最後の操作の時刻を戻す）。窓が出ていても隠す処理が動く */
  await o4.page.evaluate(() => { const ev = new Event('visibilitychange'); Date.now = ((n) => () => n + 11 * 60 * 1000)(Date.now()); document.dispatchEvent(ev); });
  await o4.page.waitForSelector('text=金額を隠しました');
  t('10分操作が無ければ金額を画面から消す（確かめの窓が出ていても・数字が残らない）', !/\d{2,3},\d{3}/.test(await o4.page.textContent('#p-main')) && !/\d,\d{3}/.test(await o4.page.textContent('#p-print')));
  await sud(o4.page);
  t('隠した後に確かめの窓の OK を押しても口座は消さない', !o4.routes.calls.some((c) => c.name === 'payroll_bank_put' && c.args.p_staff_id === 's-02') && !!o4.routes.db.bank['s-02']);
  await shot(o4.page, 'payroll.masked.pc', false);
  const nb = o4.routes.calls.filter((c) => c.name === 'payroll_bootstrap').length;
  await o4.page.evaluate(() => { Date.now = (() => { const f = Date.now; return () => f(); })(); });
  await o4.page.click('[data-act="unmask"]');
  await o4.page.waitForFunction(() => !/金額を隠しました/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('「金額を表示する」の後は DB に確かめ直す（読み直しがある）', o4.routes.calls.filter((c) => c.name === 'payroll_bootstrap').length > nb);
  /* 口座を全部消す（隠していない時） */
  await o4.page.click('[data-tab="profile"]');
  await o4.page.click('[data-act="bank"][data-sid="s-02"]');
  await o4.page.fill('#b-reason', '見本の退職');
  await o4.page.click('[data-act="bank-go"]');
  await sud(o4.page);
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const bp = o4.routes.calls.filter((c) => c.name === 'payroll_bank_put').pop();
  t('口座を全部消す: accounts=[] と理由を送り、DB から消えた', !!bp && Array.isArray(bp.args.p_accounts) && bp.args.p_accounts.length === 0 && bp.args.p_reason === '見本の退職' && !o4.routes.db.bank['s-02'], bp && bp.args);
  t('画面のエラー 0', o4.errors.length === 0, o4.errors);
  await o4.ctx.close();
  /* v4（2026-11-20）: 手で入れた有休の使用がある月を締めた控えは、数え直し（leave_uses を渡す）と一致して止まらない */
  {
    const o7 = await open({ tab: 'run', start: 'none', kintaiLeave: true });
    await waitApp(o7.page);
    const k7 = o7.routes.db.kraw[YM], r3 = k7 && k7.snapshot.rows.find((r) => r.staff_id === 's-03');
    t('材料: s-03 の締めの控えに手入力の有休 1日・480分が入っている（シフトの有休の行は無い）', !!r3 && r3.paidDays === 1 && r3.paidMin === 480 && k7.raw.leave_uses.length === 1 && !k7.raw.schedule.some((x) => x.staff_id === 's-03' && x.kind === 'paid'), r3);
    await o7.page.click('[data-act="compute"]');
    t('手入力の有休がある月でも、控えと数え直しが一致して計算できる（10人分・食い違いの知らせなし）', (await o7.page.locator('details.it').count()) === 10 && !/控えと、今の勤怠の記録が合わない人がいます/.test(await o7.page.textContent('#p-main')));
    t('数え直しは kintai_month_get の leave_uses を受け取った', o7.routes.calls.some((c) => c.name === 'kintai_month_get'));
    t('画面のエラー 0（手入力の有休）', o7.errors.length === 0, o7.errors);
    await o7.ctx.close();
  }
  /* 締めの控えと今の勤怠の記録が食い違う（review 9）: 計算・保存を止めて、食い違う人の名前を出す */
  {
    const o6 = await open({ tab: 'run', start: 'none', kintaiDrift: true });
    await waitApp(o6.page);
    await o6.page.waitForSelector('text=控えと、今の勤怠の記録が合わない人がいます', { timeout: 10000 });
    await o6.page.click('[data-act="compute"]');
    const mk = await sud(o6.page);
    t('締めの控えと今の勤怠が食い違う人がいれば計算しない（名前を出す）', /見本 二子/.test(mk) && (await o6.page.locator('details.it').count()) === 0, mk);
    await shot(o6.page, 'payroll.kintai-drift.pc', false);
    await o6.ctx.close();
  }
  /* 読んだ後に名簿から外された（42501）: 描いた物を消して覆いに倒す */
  {
    const o7 = await open({ tab: 'run', start: 'none' });
    await waitApp(o7.page);
    await o7.page.click('[data-act="compute"]');
    o7.routes.opt.deny = true;
    await o7.page.click('[data-act="save"]');
    await o7.page.waitForFunction(() => !document.getElementById('p-gate').hidden, null, { timeout: 10000 });
    t('保存の時に 42501 なら覆いに倒し、描いた金額を消す', /給与の名簿に入っていません/.test(await o7.page.textContent('#p-gate')) && await o7.page.evaluate(() => document.getElementById('p-app').hidden && !/\d{2,3},\d{3}/.test(document.getElementById('p-main').textContent)));
    await o7.ctx.close();
  }
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
