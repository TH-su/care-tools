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
  for (const r of (opt.extraRoutes || [])) await ctx.route(r.match, r.handle);   /* 場面だけの口（後から足した口が先に効く・2026-11-26 暗証番号の画面を通る場面） */
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
    /* 賞与（2026-11-23）: 0121 の前の DB の真似（noBonusDb）の賞与の口と、年末調整の記録（0122）を置いていない場面のその口だけは数えない */
    if (/^Failed to load resource/.test(m.text()) && ((opt.noBonusDb && /\/rest\/v1\/rpc\/payroll_bonus_bootstrap$/.test(loc)) || (opt.bonus && !opt.ytd && /\/rest\/v1\/rpc\/payroll_ytd_get$/.test(loc)))) return;
    errors.push('console: ' + m.text() + (loc && /^Failed to load resource/.test(m.text()) ? ' @' + loc.replace(/^https?:\/\/[^/]+/, '') : ''));
  });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'log' || m.type() === 'info') logs.push(m.text()); });
  await page.goto(srv.url + '/' + (opt.path || 'payroll.html'));   /* path: 勤怠管理から来た形（payroll.html?ym=…）で開く時だけ（2026-11-25） */
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
  /* ★2026-11-21（反証レビュー 5）: 計算の版の印を payroll-calc-2・率表の版を rates-2026-11-21 に上げたので期待を改めた
     ★2026-11-23: 令和9年分の電算機特例と熊本の最低賃金を足して payroll-calc-3・rates-2026-11-23 に上げたので期待を改めた */
  t('下書き保存は {staff_id, item, adjustments} の形（item に氏名・口座を入れない）・指紋は bootstrap の値＋率と計算の版', !!sv && sv.args.p_items.every((x) => Object.keys(x).sort().join() === 'adjustments,item,staff_id' && !('name' in x.item) && !('bank_last4' in x.item) && /^\d{4}-\d{2}-\d{2}$/.test(x.item.pay_date))
    && sv.args.p_fingerprint.rates_ver === 'rates-2026-11-23' && sv.args.p_fingerprint.calc_ver === 'payroll-calc-3' && 'kintai_locked_at' in sv.args.p_fingerprint && 'allowances' in sv.args.p_fingerprint, sv && Object.keys(sv.args.p_fingerprint));
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
  t('従業員番号を空のまま保存しても、鍵を足さない', !!pc && !('freee_emp_num' in pc.args.p_data));
  /* freee に登録の無い人（契約社員）の従業員番号を「直す」で手で入れる（2026-11-23 検収の直し） */
  await o4.page.click('[data-act="prof"][data-sid="s-02"]');
  t('「直す」に従業員番号（freee の番号）の欄と、A9 で始まる番号は比べる対象から外す説明', (await o4.page.locator('#f-emp').count()) === 1 && /A9 で始まる番号（例 A901）/.test(await o4.page.textContent('#p-dlg')));
  await o4.page.fill('#f-emp', 'A901');
  await o4.page.fill('#f-reason', '見本の契約社員の番号');
  await o4.page.click('[data-act="prof-go"]');
  await o4.page.waitForFunction(() => !document.getElementById('p-dlg').open, null, { timeout: 10000 });
  const pe = o4.routes.calls.filter((c) => c.name === 'payroll_profile_put').pop();
  t('手で入れた従業員番号 A901 を送り、DB の形の確かめを通る・「比べる対象から外します」と知らせる', !!pe && pe.args.p_data.freee_emp_num === 'A901'
    && o4.routes.db.profiles.some((q) => q.staff_id === 's-02' && q.data.freee_emp_num === 'A901') && /比べる対象から外します/.test(await o4.page.textContent('body')), pe && pe.args.p_data.freee_emp_num);
  /* 後の取り込みの場面（従業員番号で結ぶ）に響かないよう、入れた番号を外して読み直す */
  o4.routes.db.profiles.filter((q) => q.staff_id === 's-02').forEach((q) => { delete q.data.freee_emp_num; });
  await o4.page.click('#p-reload'); await waitApp(o4.page);
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
  /* 支給日の欄（2026-11-24）: 空は「空です」と言って欄へ移り赤枠・送らない／「２７日」（全角・日つき）は 27 と読む */
  const pdKeep = await o4.page.inputValue('#s-payday');
  const putN0 = o4.routes.calls.filter((c) => c.name === 'payroll_settings_put').length;
  await o4.page.fill('#s-payday', '');
  await o4.page.click('[data-act="set-go"]');
  const pdMsg = await sud(o4.page);
  t('支給日が空: 「支給日が空です」と知らせ、欄へ移って赤枠にし、保存を送らない', /支給日が空です/.test(pdMsg) && await o4.page.evaluate(() => document.activeElement && document.activeElement.id === 's-payday' && document.getElementById('s-payday').getAttribute('aria-invalid') === 'true')
    && o4.routes.calls.filter((c) => c.name === 'payroll_settings_put').length === putN0, pdMsg);
  await o4.page.fill('#s-payday', '３１日');
  await o4.page.click('[data-act="set-go"]');
  await o4.page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('p-toast').textContent), null, { timeout: 10000 });
  const spz = o4.routes.calls.filter((c) => c.name === 'payroll_settings_put').pop();
  t('支給日に「３１日」（全角・日つき）: 31 と読んで送る', !!spz && spz.args.p_config.pay_day === 31, spz && spz.args.p_config.pay_day);
  await o4.page.evaluate(() => { document.getElementById('p-toast').textContent = ''; });
  await settle(o4.page);
  await o4.page.click('[data-tab="settings"]');
  await o4.page.fill('#s-payday', pdKeep);
  await o4.page.click('[data-act="set-go"]');
  await o4.page.waitForFunction(() => /設定を保存しました/.test(document.getElementById('p-toast').textContent), null, { timeout: 10000 });
  const sp = o4.routes.calls.filter((c) => c.name === 'payroll_settings_put').pop();
  t('設定の保存: 理由の引数なし・全銀を使う印（zengin_enabled・既定は使わない）を真偽で送る・DB の確かめを通って版が上がる', !!sp && sp.args.p_config.zengin_enabled === false && o4.routes.db.settings.rev === 5 && o4.routes.db.settings.config.bank_from.bank_kana === 'ﾐﾎﾝｷﾞﾝｺｳ', sp && sp.args);
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

/* ── 年末調整のタブ（2026-11-23・ROOT-yearend.md の C）: 開く・freee の明細を取り込む・1人を開いて計算・コンソールのエラー 0 ── */
console.log('\n— 年末調整のタブ —');
{
  const o = await open({ tab: 'yearend', start: 'confirmed' });
  const p = o.page;
  await waitApp(p);
  t('端末に残したタブ（yearend）で開く', await p.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'yearend');
  await p.waitForFunction(() => /職員ごとの累計と年末調整/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('payroll_ytd_get(p_year=2026) を読み、5つの節を出す', o.routes.calls.some((c) => c.name === 'payroll_ytd_get' && c.args.p_year === 2026)
    && await p.evaluate(() => ['freee の明細を取り込む', 'freee と比べる', '職員ごとの累計と年末調整', '精算する月分の給与へ入れる', '源泉徴収票と合計表の値'].every((x) => document.getElementById('p-main').textContent.indexOf(x) >= 0)));
  /* 架空の freee の明細（氏名で結ぶ1人＋結べない1人） */
  const csv = '﻿氏名,支給日,総支給額,課税支給額,健康保険料,厚生年金保険料,雇用保険料,所得税\r\n見本 一郎,2026/03/25,"250,000","242,000","13,000","23,790","1,375","5,130"\r\n居ない 人,2026/03/25,"100,000","100,000",0,0,0,0\r\n';
  await p.setInputFiles('#ye-files', { name: 'freee-2026-03.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await p.waitForSelector('[data-act="ye-imp-go"]', { timeout: 10000 });
  t('取り込みの下見: 結べた1回分・結べない行を見せる（まだ送らない）', /1回分を累計に入れる/.test(await p.textContent('[data-act="ye-imp-go"]')) && /職員に結べない行（1行/.test(await p.textContent('#p-main')) && !o.routes.calls.some((c) => c.name === 'payroll_ytd_put'));
  await p.click('[data-act="ye-imp-go"]');
  await p.waitForFunction(() => /給与 1・賞与 0/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const put = o.routes.calls.find((c) => c.name === 'payroll_ytd_put');
  t('「累計に入れる」で payroll_ytd_put（source=freee・data の鍵だけ）', !!put && put.args.p_rows.length === 1 && put.args.p_rows[0].source === 'freee' && put.args.p_rows[0].staff_id === 's-01' && put.args.p_rows[0].data.income_tax === 5130, put && put.args);
  t('取り込んだ CSV・累計・年は端末に残さない（給与の鍵は payroll_tab だけ・値に氏名・金額なし・施設情報の共通の控えは除く）', await p.evaluate(() => { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); return ks.filter((k) => /payroll|yearend|ytd/.test(k)).join() === 'payroll_tab' && localStorage.getItem('payroll_tab') === 'yearend' && !ks.filter((k) => k !== 'su_facility_json_v1').some((k) => /見本 一郎|居ない 人|5,?130|250,?000|2026/.test(localStorage.getItem(k) || '') && k !== 'sb-jhbernqawjrzqwrmqrih-auth-token'); }));
  await p.click('[data-act="ye-open"][data-sid="s-01"]');
  await p.waitForSelector('#p-dlg[open] #ye-kou');
  t('申告の窓: 紙の順の5つの欄・マイナンバーの欄は無い', await p.evaluate(() => { const tx = document.getElementById('p-dlg-b').textContent; const L = ['扶養控除等（異動）申告書', '配偶者控除等申告書', '保険料控除申告書', '住宅借入金等特別控除申告書', '前職の源泉徴収票'].map((x) => tx.indexOf(x)); return L.every((x, i) => x > 0 && (i === 0 || x > L[i - 1])) && !/個人番号/.test(tx) && !document.querySelector('#p-dlg [id*="mynum"], #p-dlg [id*="my_number"]'); }));
  await p.fill('#ye-i-life_new_general', '80000');
  await p.click('[data-act="ye-calc"]');
  await p.waitForFunction(() => /計算の結果|計算を止めました|年末調整の対象外/.test(document.getElementById('ye-res').textContent), null, { timeout: 5000 });
  t('「計算する」で内訳と過不足（または止める知らせ）を窓の中に出す', /計算の結果|計算を止めました/.test(await p.textContent('#ye-res')));
  await shot(p, 'payroll.yearend.dlg', false);
  await p.click('[data-act="ye-save"]');
  for (let i = 0; i < 50 && !o.routes.calls.some((c) => c.name === 'payroll_yearend_put'); i++) await p.waitForTimeout(100);
  const yp = o.routes.calls.find((c) => c.name === 'payroll_yearend_put');
  t('下書き保存: basis.ytd は (pay_date・kind・rev・fp) で、fp は ytd_get が返した DB の指紋をそのまま写す', !!yp && yp.args.p_basis.ytd.length === 1 && /^[0-9a-f]{8}$/.test(yp.args.p_basis.ytd[0].fp) && Object.keys(yp.args.p_basis.ytd[0]).sort().join() === 'fp,kind,pay_date,rev' && o.routes.db.yearend.length === 1, yp && yp.args.p_basis);
  await p.click('#p-dlg [data-act="dlg-close"]');
  await sud(p, 'ok', 1500);
  await shot(p, 'payroll.yearend.pc');
  t('年末調整のタブ: 画面のエラー 0', o.errors.length === 0, o.errors);
  t('年末調整のタブ: 外へ通信しない', o.outside.length === 0, o.outside);
  await o.ctx.close();
}

/* ── 年末調整の精算（今月の給与のタブ）: 確定した人の過不足を「年末調整の精算を入れる」で入れ、確定の前の確かめ（payroll_yearend_check）を通す・合わなければ止める ── */
console.log('\n— 年末調整の精算（今月の給与） —');
{
  const o = await open({ tab: 'yearend', start: 'none' });
  const p = o.page;
  /* 架空の年末調整の確定（精算する月分を表示中の 2026-11 にした見本・還付 1,200 円） */
  o.routes.db.yearend = [{ year: 2026, staff_id: 's-01', decl: { kou: true }, result: { eligible: true, balance: -1200, balance_settle: -1200, warnings: [] }, basis: { ytd: [], items: [] }, status: 'final', settle_ym: YM, rev: 2, finalized_at: '2026-11-20T09:00:00+09:00' }];
  await waitApp(p);
  await p.waitForFunction(() => /職員ごとの累計と年末調整/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  await p.click('[data-tab="run"]');
  await p.waitForSelector('[data-act="ye-settle"]', { timeout: 10000 });
  t('今月の給与: 精算がまだ入っていない人を知らせ「年末調整の精算を入れる」を出す', /まだこの月分に入っていない/.test(await p.textContent('#p-main')));
  await p.click('[data-act="ye-settle"]');
  await p.waitForFunction(() => /年末調整の精算（1 人）はこの月分に入っています/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  await p.click('[data-act="ye-settle"]');   /* 二度押し */
  await p.click('details.it[data-sid="s-01"] > summary');
  await p.waitForSelector('details.it[data-sid="s-01"] table');
  const adjN = await p.evaluate(() => (document.querySelector('details.it[data-sid="s-01"]').textContent.match(/所得税の精算：年末調整の精算/g) || []).length);
  t('「その月だけの調整」に所得税の精算が1行だけ入る（二度押しで増えない）・額は還付の −1,200', adjN === 1 && /所得税の精算：年末調整の精算 −1,200/.test(await p.textContent('details.it[data-sid="s-01"]')), adjN);
  await p.click('[data-act="save"]');
  await settle(p);
  await p.click('[data-act="confirm"]');
  await p.waitForSelector('#p-dlg[open] [data-act="confirm-go"]');
  if (await p.$('#c-ack')) await p.check('#c-ack');
  o.routes.calls.length = 0;
  await p.click('[data-act="confirm-go"]');
  await p.waitForFunction(() => /確定済み/.test(document.getElementById('p-main').textContent), null, { timeout: 15000 });
  const iChk = o.routes.calls.findIndex((c) => c.name === 'payroll_yearend_check'), iConf = o.routes.calls.findIndex((c) => c.name === 'payroll_run_confirm');
  t('確定は payroll_yearend_check(p_year) で合っていると確かめてから payroll_run_confirm', iChk >= 0 && iConf > iChk && o.routes.calls[iChk].args.p_year === 2026, o.routes.calls.map((c) => c.name));
  t('精算: 画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}
{
  const o = await open({ tab: 'yearend', start: 'none' });
  const p = o.page;
  o.routes.db.yearend = [{ year: 2026, staff_id: 's-01', decl: { kou: true }, result: { eligible: true, balance: -1200, balance_settle: -1200, warnings: [] }, basis: { ytd: [], items: [] }, status: 'final', settle_ym: YM, rev: 2, finalized_at: null }];
  await waitApp(p);
  await p.waitForFunction(() => /職員ごとの累計と年末調整/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  await p.click('[data-tab="run"]');
  await p.waitForSelector('[data-act="ye-settle"]', { timeout: 10000 });
  await p.click('[data-act="compute"]');   /* 精算を入れずに計算して保存する */
  await p.click('[data-act="save"]');
  await settle(p);
  await p.click('[data-act="confirm"]');
  await p.waitForSelector('#p-dlg[open] [data-act="confirm-go"]');
  if (await p.$('#c-ack')) await p.check('#c-ack');
  await p.click('[data-act="confirm-go"]');
  await p.waitForFunction(() => /確定していません。年末調整の精算の額/.test(document.getElementById('p-main').textContent), null, { timeout: 15000 });
  t('精算が入っていない時は確定しない（payroll_run_confirm を呼ばない）', !o.routes.calls.some((c) => c.name === 'payroll_run_confirm') && (o.routes.db.runs[YM] || {}).status === 'draft');
  t('止めた時: 画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}
/* 反証レビュー（2026-11-23）: 年末調整の確定の後に精算する月分の明細が変わった（stale）は、今月の給与のタブで知らせ、確定を止める */
{
  const o = await open({ tab: 'run', start: 'none' });
  const p = o.page;
  o.routes.db.yearend = [{ year: 2026, staff_id: 's-01', decl: { kou: true }, result: { eligible: true, balance: 0, balance_settle: 0, warnings: [] }, basis: { ytd: [], items: [{ ym: YM, rev: 1, gross: 1, taxable: 1, si: 1, tax: 1 }] }, status: 'final', settle_ym: YM, rev: 2, finalized_at: null },
    { year: 2026, staff_id: 's-02', decl: { kou: true }, result: {}, basis: { ytd: [], items: [] }, status: 'draft', settle_ym: YM, rev: 1, finalized_at: null }];
  await waitApp(p);
  await p.waitForFunction(() => /年末調整を確定した後に、この月分の明細が変わりました/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('stale: 今月の給与のタブに「確定した後に明細が変わった」を出す（年末調整のタブを開かなくても）・下書きの人は止めない知らせ', /見本 一郎/.test(await p.textContent('#p-main')) && /年末調整の知らせ（確定は止めません）: 見本 二子（年末調整がまだ下書き）/.test(await p.textContent('#p-main')));
  await p.click('[data-act="compute"]');
  await p.click('[data-act="save"]');
  await settle(p);
  await p.click('[data-act="confirm"]');
  await p.waitForSelector('#p-dlg[open] [data-act="confirm-go"]');
  if (await p.$('#c-ack')) await p.check('#c-ack');
  await p.click('[data-act="confirm-go"]');
  await p.waitForFunction(() => /確定していません。年末調整を確定した後に/.test(document.getElementById('p-main').textContent), null, { timeout: 15000 });
  t('stale: 確定しない（payroll_run_confirm も読み直しも呼ばない）', !o.routes.calls.some((c) => c.name === 'payroll_run_confirm') && (o.routes.db.runs[YM] || {}).status === 'draft');
  t('stale: 画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}
/* 源泉徴収票の印刷は payroll_yearend_log が通ってから */
{
  const o = await open({ tab: 'yearend', start: 'confirmed' });
  const p = o.page;
  o.routes.db.yearend = [{ year: 2026, staff_id: 's-01', decl: { kou: true }, result: { eligible: false, reasons: ['not_kou'], balance: null, balance_settle: 0, warnings: [], lines: null }, basis: { ytd: [], items: [] }, status: 'final', settle_ym: '2026-12', rev: 2, finalized_at: '2026-11-20T09:00:00+09:00' }];
  await waitApp(p);
  await p.waitForSelector('[data-act="ye-print"][data-k="all"]:not([disabled])', { timeout: 10000 });
  await p.evaluate(() => { window.print = function () {}; });
  await p.click('[data-act="ye-print"][data-k="all"]');
  await p.waitForFunction(() => document.body.classList.contains('su-printing') || /記録に残せなかった/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
  const lg = o.routes.calls.find((c) => c.name === 'payroll_yearend_log');
  t('源泉徴収票の印刷: payroll_yearend_log(withholding_slip・1人) が通ってから紙を作る', !!lg && lg.args.p_kind === 'withholding_slip' && lg.args.p_count === 1 && o.routes.db.log.includes('yearend:withholding_slip'), lg && lg.args);
  t('源泉徴収票の印刷: 画面のエラー 0', o.errors.length === 0, o.errors);
  await o.ctx.close();
}
/* 年末調整のタブの iPhone 幅・暗い表示（横はみ出し 0・エラー 0） */
for (const [nm, vp, dark] of [['yearend.ph', { width: 390, height: 844 }, false], ['yearend.dark', { width: 1280, height: 900 }, true], ['yearend.ph-dark', { width: 390, height: 844 }, true]]) {
  const q = await open({ tab: 'yearend', start: 'confirmed', viewport: vp, dark });
  await waitApp(q.page);
  await q.page.waitForFunction(() => /職員ごとの累計と年末調整/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const over = await q.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t(nm + ': 画面の横はみ出し 0（表は枠の中で横に送る）', over <= 0, over);
  await shot(q.page, 'payroll.' + nm);
  t(nm + ': 画面のエラー 0', q.errors.length === 0, q.errors);
  await q.ctx.close();
}

/* ── 7. 賞与のタブ（統合 0121・2026-11-23）── */
/* 賞与額が空の欄に 0 を入れる・前月の給与の欄を全員「前月の給与なし」にする（代表者の答え 2026-11-23「誰も外さない」で、空の人がいると確定できないため） */
const fillZero = async (pg, skip = []) => { const ids = await pg.evaluate((sk) => [...document.querySelectorAll('[data-bk="amt"]')].filter((e) => !e.value && !sk.includes(e.getAttribute('data-bsid'))).map((e) => e.id), skip); for (const id of ids) await pg.fill('#' + id, '0'); return ids.length; };
const allNone = async (pg) => { const sids = await pg.evaluate(() => [...document.querySelectorAll('[data-bk="pm"]')].map((e) => e.getAttribute('data-bsid'))); for (const x of sids) await pg.selectOption('[data-bk="pm"][data-bsid="' + x + '"]', 'none'); return sids.length; };
console.log('\n— 7. 賞与のタブ —');
{
  /* 関数の無い DB（0121 の前）: 「まだ使えません」だけ出して何もしない */
  const o0 = await open({ tab: 'bonus', start: 'confirmed', noBonusDb: true });
  await o0.page.waitForSelector('text=賞与はまだ使えません（データベースの準備中）', { timeout: 15000 });
  t('関数の無い DB では「賞与はまだ使えません（データベースの準備中）」だけ出し、ボタンを出さない', (await o0.page.locator('[data-act^="b-"]').count()) === 0);
  t('関数の無い DB で呼んだのは一覧の読み込みだけ', o0.routes.calls.filter((c) => /^payroll_bonus_/.test(c.name)).every((c) => c.name === 'payroll_bonus_bootstrap'));
  t('関数の無い DB: 画面のエラー 0', o0.errors.length === 0, o0.errors);
  await o0.ctx.close();

  /* 11月分の給与を確定した DB（前月の給与は自社の確定した明細）・全銀のスイッチ入 */
  const o = await open({ tab: 'bonus', start: 'confirmed', bonus: true, zengin: true, retiredStaff: true });   /* 退職済みの見本 十二（給与の設定あり・在籍でない）を足した場面 */
  const p = o.page;
  await p.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
  t('賞与のタブで開く（端末に残したタブ）・回はまだ無い', await p.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'bonus' && /賞与の回はまだありません/.test(await p.textContent('#p-main')));
  await shot(p, 'payroll.bonus-list.pc');
  await p.click('[data-act="b-new"]');
  await p.fill('#bn-date', '2026-12-24');
  await p.fill('#bn-title', '見本の冬の賞与');
  await p.click('[data-act="b-new-go"]');
  await p.waitForSelector('[data-act="b-compute"]', { timeout: 10000 });
  t('新しい賞与を作ると回の画面が開く（支給日・題）', /見本の冬の賞与（支給日 2026年12月24日）/.test(await p.textContent('#p-main')) && o.routes.calls.some((c) => c.name === 'payroll_bonus_create' && c.args.p_pay_date === '2026-12-24'));
  t('職員の一覧にいて在籍なのに給与の設定が無い人（s-11）を回の画面の上で知らせる（確定は止めない）', /給与の設定が無いので賞与の一覧に出ていない職員: 見本 十一（賞与の対象なら職員の給与の設定を先に入れてください）/.test(await p.textContent('#p-main')), (await p.textContent('#p-main')).slice(0, 300));
  t('前月の給与は11月分の確定した明細から読む（入れる欄を出さない）', /給与の記録/.test(await p.textContent('#p-main')) && (await p.locator('[data-bk="pm"]:not([data-bsid="s-12"])').count()) === 0);
  const idx = async (sid) => p.evaluate((s) => { const e = document.querySelector('[data-bk="amt"][data-bsid="' + s + '"]'); return e ? e.id : null; }, sid);
  await p.fill('#' + await idx('s-01'), '300000');
  await p.fill('#' + await idx('s-03'), '200000');
  await p.fill('#' + await idx('s-08'), '100000');
  /* 回の設定: 他所で払った標準賞与額（千円の倍数でないと断る） */
  await p.click('details.cd > summary');
  await p.fill('#' + await p.evaluate(() => document.querySelector('[data-bk="fy"][data-bsid="s-01"]').id), '301500');
  await p.click('[data-act="b-cfg-save"]');
  const mCfg = await sud(p);
  t('他所で払った標準賞与額は千円の倍数でないと保存しない', /千円の倍数/.test(mCfg), mCfg);
  await p.fill('#' + await p.evaluate(() => document.querySelector('[data-bk="fy"][data-bsid="s-01"]').id), '301000');
  await p.click('[data-act="b-cfg-save"]');
  await p.waitForFunction(() => /回の設定を保存しました/.test(document.getElementById('p-toast').textContent), null, { timeout: 10000 });
  t('回の設定は config_put（fy_prior_std・算定期間）で保存した', o.routes.calls.some((c) => c.name === 'payroll_bonus_config_put' && c.args.p_config.fy_prior_std['s-01'] === 301000 && c.args.p_config.bonus_period_months === 6));
  await settle(p);
  t('回の設定を保存しても、入れた賞与額は残る', await p.inputValue('#' + await idx('s-01')) === '300000');
  await p.click('[data-act="b-compute"]');
  await p.waitForSelector('details.bit');
  t('計算すると賞与額を入れた3人の結果が出る', (await p.locator('details.bit').count()) === 3);
  t('下書き保存の前は確定を押せない', await p.isDisabled('[data-act="b-confirm"]'));
  await shot(p, 'payroll.bonus-run.pc');
  /* 賞与額が空の人がいれば、下書き保存はできるが確定できない（代表者の答え 2026-11-23「誰も外さない」） */
  await p.click('[data-act="b-save"]');
  /* ★空の止めの対象を在籍・支給日より前に退職していない人に絞った（反証レビュー 2026-11-23）ので、11月10日に退職した見本 五郎も外れ、空の人は7人から6人になった（期待を改めた） */
  await p.waitForSelector('text=賞与額が空の人がいます（6人）', { timeout: 10000 });
  t('賞与額が空の人がいれば下書き保存はでき、確定は押せない（「払わない人は 0 を入れてください」）', await p.isDisabled('[data-act="b-confirm"]') && /払わない人は 0 を入れてください/.test(await p.textContent('#p-main')) && o.routes.calls.filter((c) => c.name === 'payroll_bonus_save').length === 1);
  t('空の人がいる時の確定の止めは「見本 二子」など名前で出す', /賞与額が空の人がいます（6人）：見本 二子、/.test(await p.textContent('#p-main')));
  t('給与の設定があって退職済みの人（見本 十二）は一覧に出るが、空の止めに数えない', (await p.locator('[data-bk="amt"][data-bsid="s-12"]').count()) === 1 && !/見本 十二/.test((await p.textContent('#p-main')).split('賞与額が空の人がいます')[1].split('払わない人は')[0]));
  await fillZero(p, ['s-12']);   /* 退職済みの人は空のまま */
  await p.click('[data-act="b-save"]');
  await p.waitForFunction(() => { const b = document.querySelector('[data-act="b-confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  t('空の人に 0 を入れて保存すると確定を押せる・読み直しても 0 と出る', await p.inputValue('[data-bk="amt"][data-bsid="s-02"]') === '0');
  const sv = o.routes.calls.filter((c) => c.name === 'payroll_bonus_save').pop();
  /* ★0 の人も明細にする決まり（2026-11-23）で、保存する明細は3人から10人（0 の7人を含む）に変わったので期待を改めた */
  t('0 の人は総支給0・控除0・差引0 の明細で保存する', !!sv && sv.args.p_items.filter((x) => x.item.gross === 0).every((x) => x.item.deduct === 0 && x.item.net === 0) && sv.args.p_items.filter((x) => x.item.gross === 0).length === 7);
  t('下書き保存は 0121 の形（許された鍵だけ・指紋は bootstrap の文字・前月の給与の出どころ ok）', !!sv && typeof sv.args.p_fingerprint === 'string' && sv.args.p_items.length === 10
    && sv.args.p_items.every((x) => Object.keys(x).sort().join() === 'item,prev_manual,staff_id' && x.item.prev_kind === 'ok' && !('raw' in x.item.std) && !('T' in x.item) && x.item.warns.every((w) => !('stop' in w))));
  await p.click('[data-act="b-confirm"]');
  const dlg = await p.textContent('#p-dlg');
  /* ★0 の人も明細にしたので、確定の窓の人数は3人から10人に変わった（期待を改めた） */
  t('確定の窓に人数・総額・支給日', /10 人/.test(dlg) && /差引の合計/.test(dlg) && /2026年12月24日/.test(dlg), dlg.slice(0, 300));
  if (await p.locator('#bc-ack').count()) await p.check('#bc-ack');
  await p.click('[data-act="b-confirm-go"]');
  await p.waitForFunction(() => /確定済み/.test(document.getElementById('p-main').textContent) && document.querySelector('[data-act="b-print-all"]'), null, { timeout: 10000 });
  t('確定すると確定済みになり、計算するのボタンが消える', (await p.locator('[data-act="b-compute"]').count()) === 0 && Object.values(o.routes.db.bonus.runs)[0].status === 'confirmed');
  t('確定を押した時に読み直してから確定した（bootstrap → confirm）', (() => { const n = o.routes.calls.map((c) => c.name); const i = n.lastIndexOf('payroll_bonus_confirm'); return i > 0 && n.slice(0, i).lastIndexOf('payroll_bonus_bootstrap') > n.lastIndexOf('payroll_bonus_save'); })());
  /* ── 確定した賞与を年末調整の累計へ（統合 0124・2026-11-23）── */
  await p.waitForFunction(() => /年末調整の累計に入れました/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const bid0 = Object.keys(o.routes.db.bonus.items)[0], paid = o.routes.db.bonus.items[bid0].filter((i) => i.gross > 0);
  const yput = o.routes.calls.filter((c) => c.name === 'payroll_ytd_put').pop();
  t('確定すると、総支給が0より大きい人だけを累計へ（source=app・kind=bonus・支給日・版0・社保の和は social・所得税は tax）', !!yput && yput.args.p_year === 2026 && yput.args.p_rows.length === paid.length
    && yput.args.p_rows.every((r) => { const i = paid.find((x) => x.staff_id === r.staff_id); const d = r.data; return i && r.source === 'app' && r.kind === 'bonus' && r.pay_date === '2026-12-24' && r.rev === 0
      && d.gross === i.gross && d.income_tax === i.tax && d.si_health + d.si_care + d.si_support + d.si_pension + d.si_emp + d.si_other === i.social && d.resident_tax === 0
      && d.taxable === (Number.isInteger(i.item.taxable) ? i.item.taxable : i.gross) && d.nontax === d.gross - d.taxable; }), yput && yput.args.p_rows.map((r) => r.staff_id));
  t('モック（0124 の照合の写し）に通り、「足した N 人」と出る', new RegExp('足した ' + paid.length + ' 人・置き換えた 0 人').test(await p.textContent('#p-main')));
  const nPut = o.routes.calls.filter((c) => c.name === 'payroll_ytd_put').length;
  await p.click('[data-act="b-ytd-put"]');
  await p.waitForFunction(() => /もう入っています/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('もう一度押しても、同じ値が入っていれば送らない（版を上げない）', o.routes.calls.filter((c) => c.name === 'payroll_ytd_put').length === nPut);
  /* 確定した回を開き直すと、累計に入っているかを読んで確かめる（送らない） */
  await p.click('#p-reload'); await settle(p);
  await p.waitForFunction(() => /年末調整の累計には、この賞与が入っています/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('確定した回を開き直すと累計を確かめて「入っています」（送らない）', o.routes.calls.filter((c) => c.name === 'payroll_ytd_put').length === nPut);
  /* 累計の行を1つ消した DB で開き直すと「まだ入っていない人」を知らせる */
  const gone = o.routes.db.ytd.splice(o.routes.db.ytd.findIndex((x) => x.staff_id === paid[0].staff_id && x.kind === 'bonus'), 1)[0];
  await p.click('#p-reload'); await settle(p);
  await p.waitForFunction(() => /まだ入っていない人（値の違う人を含む）が 1 人います/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('確定の後に累計から抜けた人がいれば、開いた時に知らせる（送らない）', o.routes.calls.filter((c) => c.name === 'payroll_ytd_put').length === nPut);
  o.routes.db.ytd.push(gone);
  /* 確定し直して支給が無くなった（0円の）人の app の行が累計に残っていれば、賞与のタブから消せる（理由つき） */
  const zero = o.routes.db.bonus.items[bid0].find((i) => i.gross === 0);
  o.routes.db.ytd.push({ year: 2026, staff_id: zero.staff_id, pay_date: '2026-12-24', kind: 'bonus', source: 'app', data: { gross: 1000 }, rev: 1, src_fp: '' });
  await p.click('#p-reload'); await settle(p);
  await p.waitForSelector('[data-act="b-ytd-del"]', { timeout: 10000 });
  t('累計に前の確定の行が残る人を名前つきで出し、消すボタンを出す', /前の確定の行が残っている人/.test(await p.textContent('#p-main')) && /累計の残っている行を消す（1 人）/.test(await p.textContent('[data-act="b-ytd-del"]')));
  await p.click('[data-act="b-ytd-del"]');
  await p.waitForSelector('dialog[open]', { timeout: 5000 }); await p.waitForTimeout(500);
  await p.locator('dialog[open] button', { hasText: 'OK' }).click();
  await p.waitForFunction(() => /年末調整の累計には、この賞与が入っています/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const del = o.routes.calls.filter((c) => c.name === 'payroll_ytd_delete').pop();
  t('消すと payroll_ytd_delete（その人・支給日・賞与・版・理由）で消え、確かめ直して「入っています」', !!del && del.args.p_staff_id === zero.staff_id && del.args.p_kind === 'bonus' && del.args.p_pay_date === '2026-12-24' && del.args.p_rev === 1 && !!del.args.p_reason
    && !o.routes.db.ytd.some((x) => x.staff_id === zero.staff_id && x.kind === 'bonus'), del && del.args);
  /* ── freee と比べる（賞与の明細の CSV・架空の値）── */
  const HEADB = '従業員番号,氏名,賞与支給日,総支給額,課税支給額合計,健康保険料,介護保険料,子ども・子育て支援金,厚生年金保険料,雇用保険料,所得税,控除合計,差引支給額';
  const rowOf = (i, o2) => { const x = Object.assign({ date: '2026/12/24', tax: i.tax }, o2 || {}), s = i.item.ins || {};
    return ['', i.frozen.name, x.date, i.gross, i.item.taxable != null ? i.item.taxable : i.gross, s.health || 0, s.care || 0, s.support || 0, s.pension || 0, s.emp || 0, x.tax, i.deduct - i.tax + x.tax, i.net + i.tax - x.tax].map((v) => '"' + v + '"').join(','); };
  const csvB = (rows) => Buffer.from('﻿' + HEADB + '\r\n' + rows.join('\r\n') + '\r\n', 'utf8');
  const up = async (buf) => { await p.setInputFiles('#b-cmpfile', { name: 'bonus.csv', mimeType: 'text/csv', buffer: buf }); await settle(p); };
  await up(csvB(paid.map((i) => rowOf(i))));
  await p.waitForFunction(() => /1円まで一致/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const mainB = await p.textContent('#p-main');
  t('賞与の CSV と全員の全項目が同じなら「1円まで一致」の帯（比べた人数・0円で freee に行の無い人は比べない）', new RegExp('比べた ' + paid.length + ' 人の全項目').test(mainB) && /賞与額0円で freee に行の無い 7 人は比べていません/.test(mainB), mainB.slice(mainB.indexOf('freee と比べる'), mainB.indexOf('freee と比べる') + 400));
  t('比べた後もファイルの欄は空・端末に金額を残さない', await p.inputValue('#b-cmpfile') === '' && await p.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)); if (/300000|300,000/.test(v)) return false; } return true; }));
  await up(csvB(paid.map((i, k) => rowOf(i, k === 0 ? { tax: i.tax + 1 } : null))));
  await p.waitForFunction(() => /差あり/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('所得税が1円違う人がいると「差あり」（所得税・控除の合計・差引の3件）・合格の帯は出さない', /差あり 3 件/.test(await p.textContent('#p-main')) && !/1円まで一致/.test(await p.textContent('#p-main')));
  await up(csvB(paid.map((i) => rowOf(i, { date: '2026/07/10' }))));
  await p.waitForFunction(() => /この回の支給日（2026-12-24）がありません/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('支給日の違う（夏の）賞与の CSV では比べない', !/1円まで一致|差あり/.test(await p.textContent('#p-main')));
  await up(csvB(paid.map((i) => rowOf(i, { date: 'R8.12.24' }))));
  await p.waitForFunction(() => /支給日の読めない行が/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('支給日の読めない賞与の CSV（R8.12.24）は比べない（合格の帯を出さない）', !/1円まで一致|差あり/.test(await p.textContent('#p-main')));
  /* freee に登録の無い人（従業員番号 A9 始まり）: CSV に居なくても対象外として別に数え、ほかが全部同じなら合格 */
  const a9 = paid[paid.length - 1];
  o.routes.db.profiles.filter((q) => q.staff_id === a9.staff_id).forEach((q) => { q.data = Object.assign({}, q.data, { freee_emp_num: 'A901' }); });
  await p.click('#p-reload'); await settle(p);
  await p.waitForSelector('#b-cmpfile');
  await up(csvB(paid.filter((i) => i !== a9).map((i) => rowOf(i))));
  await p.waitForFunction(() => /1円まで一致/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  const mainA = await p.textContent('#p-main');
  t('A9 始まりの人は「自社だけ（freee に登録の無い人・比べる対象外）」・帯に対象外の人数', /freee に登録の無い人（比べる対象外）1 人/.test(mainA) && new RegExp('自社だけ（freee に登録の無い人・比べる対象外）：' + a9.frozen.name).test(mainA), mainA.slice(mainA.indexOf('freee と比べる'), mainA.indexOf('freee と比べる') + 600));
  await p.click('[data-act="b-cmp-clear"]');
  t('「比べた結果を消す」で帯が消える', !/1円まで一致/.test(await p.textContent('#p-main')));
  /* 明細の印刷（1人1枚・賞与の見出し） */
  await p.evaluate(() => { window.print = function () {}; });
  await p.click('[data-act="b-print-all"]');
  await p.waitForFunction(() => document.body.classList.contains('su-printing'), null, { timeout: 10000 });
  t('賞与明細の紙は1人1枚（3枚）・見出しは「賞与明細」・施設名と印刷日の印', (await p.locator('#p-print .slip').count()) === 3 && /賞与明細　見本の冬の賞与/.test(await p.textContent('#p-print')) && (await p.locator('#p-print [data-su-print-head="name date"]').count()) === 3);
  t('印刷したことを記録した（種類 slip）', o.routes.db.log.includes('bonus_slip'));
  if (SHOTS) {
    await p.emulateMedia({ media: 'print' });
    const pdf = path.join(SHOTS, 'payroll.bonus-slips.pdf');
    await p.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    t('賞与明細の PDF は3ページ', pdfPages(pdf) === 3);
    await p.emulateMedia({ media: 'screen' });
  }
  await p.evaluate(() => document.body.classList.remove('su-printing'));
  /* 全銀（種別12・振込指定日＝支給日） */
  const [dz] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="b-zengin"]')]);
  const recs = fs.readFileSync(await dz.path()).toString('latin1').split('\r\n').filter(Boolean);
  t('賞与の振込データは種別12・振込指定日は支給日（1224）・120バイトの行', /^payroll-zengin-bonus-2026-12-24\.txt$/.test(dz.suggestedFilename()) && recs.every((r) => r.length === 120) && recs[0].slice(1, 3) === '12' && recs[0].slice(54, 58) === '1224', recs[0] && recs[0].slice(0, 60));
  fs.rmSync(await dz.path(), { force: true });
  t('全銀は記録（zengin）の後に口座の全桁を書き出し専用の口から受け取った', o.routes.calls.some((c) => c.name === 'payroll_bonus_bank_export') && o.routes.db.log.includes('bonus_zengin'));
  await settle(p);
  const [dc] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="b-shoyo"]')]);
  const csv = fs.readFileSync(await dc.path(), 'utf8');
  /* ★賞与支払届の CSV は支払った人を全員載せる決まりに改めた（2026-11-23 反証レビュー 7・仮置き）ので、保険の無い人（見本 八子）も載る期待に改めた */
  t('賞与支払届に写す値の CSV（見出し・支払った3人を全員・同じ月のほかの回が無いので合算の印なし・個人番号なし）', /^payroll-shoyo-2026-12-24\.csv$/.test(dc.suggestedFilename()) && /氏名,生年月日,支給日,賞与額,千円未満切り捨ての額,70歳以上の印,同じ月の合算の印/.test(csv)
    && /見本 一郎,1980-05-01,2026-12-24,300000,300000,,\r\n/.test(csv) && /見本 八子,/.test(csv) && csv.trim().split('\r\n').length === 4 && o.routes.db.log.includes('bonus_shoyo_csv'), csv.slice(0, 300));
  fs.rmSync(await dc.path(), { force: true });
  t('端末に残したのは payroll_tab（bonus）だけ（金額・氏名なし）', await p.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), v = localStorage.getItem(k); if (/見本|300000/.test(v) && !/^sb-|^su_fac/.test(k)) return false; } return localStorage.getItem('payroll_tab') === 'bonus'; }));
  /* 確定の取り消し（管理者・理由が要る） */
  await p.click('[data-act="b-unconfirm"]');
  await p.fill('#bu-reason', '見本の直し');
  await p.click('[data-act="b-unconfirm-go"]');
  await p.waitForSelector('[data-act="b-compute"]', { timeout: 10000 });
  t('確定を取り消すと下書きに戻る（理由つき）', o.routes.calls.some((c) => c.name === 'payroll_bonus_unconfirm' && c.args.p_reason === '見本の直し'));
  t('一度振込データを書き出した回は「消す」のボタンを出さない', (await p.locator('[data-act="b-delete"]').count()) === 0);
  /* 0121 は取り消しても確定の写しを消さない。下書きに戻った明細の見本は今の口座・「下書き（確定前）」で出す（確定の後に口座を直した人も今の口座） */
  o.routes.db.bank['s-01'] = { rev: 2, accounts: [{ bank_code: '9997', branch_code: '003', type: '1', number: '0009999', name_kana: 'ﾐﾎﾝ', bank_name: '見本の新銀行', amount_or_rest: 'rest' }] };
  await p.click('#p-reload'); await settle(p);
  await p.waitForSelector('#p-main .slip');
  const slipD = await p.textContent('#p-main .slip');
  t('取り消した下書きの明細の見本は「下書き（確定前）」・今の口座（＊＊＊9999）で出す', /下書き（確定前）/.test(slipD) && /＊＊＊9999/.test(slipD) && !/＊＊＊2222/.test(slipD), slipD.slice(0, 200));
  t('賞与: 画面のエラー 0', o.errors.length === 0, o.errors);
  t('賞与: console.log に何も出さない・外への通信 0', o.logs.length === 0 && o.outside.length === 0, [o.logs, o.outside]);
  /* 10分で金額を隠す */
  await p.evaluate(() => { const ev = new Event('visibilitychange'); Date.now = ((n) => () => n + 11 * 60 * 1000)(Date.now()); document.dispatchEvent(ev); });
  await p.waitForSelector('text=金額を隠しました', { timeout: 20000 });
  t('10分操作が無ければ賞与の金額も画面から消す', !/300,000/.test(await p.textContent('#p-main')));
  await o.ctx.close();

  /* 前月の給与が無い DB（11月分の給与がまだ無い）: 止めの警告で確定できず、「前月の給与なし」を選ぶと確定できる。年末調整の記録が無い DB では黙って飛ばす */
  const o2 = await open({ tab: 'bonus', start: 'none', bonus: true });
  const p2 = o2.page;
  await p2.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
  await p2.click('[data-act="b-new"]');
  await p2.fill('#bn-date', '2026-12-24');
  await p2.click('[data-act="b-new-go"]');
  await p2.waitForSelector('[data-act="b-compute"]', { timeout: 10000 });
  const id2 = await p2.evaluate(() => document.querySelector('[data-bk="amt"][data-bsid="s-01"]').id);
  await p2.fill('#' + id2, '300000');
  await p2.click('[data-act="b-save"]');
  await p2.waitForFunction(() => /確定できない警告/.test(document.getElementById('p-main').textContent) && !/計算した結果はまだ保存していません/.test(document.getElementById('p-main').textContent), null, { timeout: 10000 });
  t('前月の給与が入っていない人がいれば、保存はできるが確定のボタンを押せない（止めの警告の一覧を出す）', await p2.isDisabled('[data-act="b-confirm"]') && /前月の給与/.test(await p2.textContent('#p-main')) && !!o2.routes.calls.find((c) => c.name === 'payroll_bonus_save'));
  await shot(p2, 'payroll.bonus-block.pc');
  /* ★支給日より前に退職した見本 五郎を空の止めから外した（反証レビュー 2026-11-23）ので、9人から8人に改めた */
  t('前月の給与の止めと一緒に、賞与額が空の人（8人）の止めも出す', /賞与額が空の人がいます（8人）/.test(await p2.textContent('#p-main')));
  /* 0 の人も明細なので、前月の給与の止め（DB と同じ）がかかる。0121 の確定は明細ごとに前月の給与を確かめるため、全員「前月の給与なし」にする（仮置き・要確認） */
  await fillZero(p2); await allNone(p2);
  await p2.click('[data-act="b-save"]');
  await p2.waitForFunction(() => { const b = document.querySelector('[data-act="b-confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  const sv2 = o2.routes.calls.filter((c) => c.name === 'payroll_bonus_save').pop();
  sv2.args.p_items.sort((a, b) => (a.staff_id === 's-01' ? -1 : b.staff_id === 's-01' ? 1 : 0));
  t('「前月の給与なし」は prev_manual {P:null, none:true} で送り、確定を押せる', sv2.args.p_items[0].prev_manual.none === true && sv2.args.p_items[0].prev_manual.P === null && sv2.args.p_items[0].item.prev_kind === 'none');
  t('年末調整の口が無い DB でも止まらない（画面のエラー 0）', o2.errors.length === 0, o2.errors);
  await o2.ctx.close();

  /* 年末調整の記録がある DB: 前月の給与の P を記録から取り、prev_manual（source ytd）で送る */
  const o3 = await open({ tab: 'bonus', start: 'none', bonus: true, ytd: [{ staff_id: 's-01', pay_date: '2026-11-25', kind: 'salary', source: 'freee', data: { taxable: 250000, si_health: 12000, si_pension: 22000, si_emp: 1200 } },
    { staff_id: 's-01', pay_date: '2026-07-10', kind: 'bonus', source: 'freee', data: { gross: 301234 } }] });
  const p3 = o3.page;
  await p3.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
  await p3.click('[data-act="b-new"]');
  await p3.fill('#bn-date', '2026-12-24');
  await p3.click('[data-act="b-new-go"]');
  await p3.waitForSelector('text=年末調整の記録', { timeout: 10000 });
  t('年末調整の記録から前月の給与の P（214,800 円）を出す', /年末調整の記録 214,800 円/.test((await p3.textContent('#p-main')).replace(/\s+/g, ' ')));
  await p3.fill('#' + await p3.evaluate(() => document.querySelector('[data-bk="amt"][data-bsid="s-01"]').id), '300000');
  if (!(await p3.evaluate(() => document.getElementById("b-cfg").open))) await p3.click("details.cd > summary");
  await p3.click('[data-act="b-cfg-fill"]');
  t('「年末調整の記録から埋める」で他所で払った標準賞与額（301,000）を入れる（保存は人が押す）', await p3.inputValue('[data-bk="fy"][data-bsid="s-01"]') === '301000' && !(await p3.isDisabled('[data-act="b-cfg-save"]')));
  await p3.click('[data-act="b-cfg-save"]');
  await p3.waitForFunction(() => /回の設定を保存しました/.test(document.getElementById('p-toast').textContent), null, { timeout: 10000 });
  await settle(p3);
  await fillZero(p3); await allNone(p3);
  await p3.click('[data-act="b-save"]');
  await p3.waitForFunction(() => { const b = document.querySelector('[data-act="b-confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  const sv3 = o3.routes.calls.filter((c) => c.name === 'payroll_bonus_save').pop();
  sv3.args.p_items.sort((a, b) => (a.staff_id === 's-01' ? -1 : b.staff_id === 's-01' ? 1 : 0));
  t('記録から取った前月の給与は prev_manual {P:214800, source:"ytd"}・prev_kind manual で送り、確定を押せる', sv3.args.p_items[0].prev_manual.P === 214800 && sv3.args.p_items[0].prev_manual.source === 'ytd' && sv3.args.p_items[0].item.prev_kind === 'manual' && sv3.args.p_items[0].item.P === 214800);
  t('年末調整の記録: 画面のエラー 0', o3.errors.length === 0, o3.errors);
  await o3.ctx.close();
  /* iPhone の幅で横にはみ出さない */
  /* 年末調整の記録の答えが来ない: 10秒で読めなかった扱いにして解き、手入力で進められる（後から届いた答えは使わない） */
  {
    const o5 = await open({ tab: 'bonus', start: 'none', bonus: true, ytd: [{ staff_id: 's-01', pay_date: '2026-11-25', kind: 'salary', source: 'freee', data: { taxable: 250000 } }], ytdDelay: 14000 });
    const p5 = o5.page;
    await p5.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
    await p5.click('[data-act="b-new"]'); await p5.fill('#bn-date', '2026-12-24'); await p5.click('[data-act="b-new-go"]');
    await p5.waitForSelector('[data-act="b-compute"]', { timeout: 10000 });
    const t0 = Date.now();
    await p5.waitForFunction(() => { const b = document.querySelector('[data-act="b-save"]'); return b && !b.disabled; }, null, { timeout: 13000 });
    const waited = Date.now() - t0;
    t('記録の答えが来ない時は約10秒で待ちを解き、手入力の欄を出す', waited >= 8000 && waited < 13000 && (await p5.locator('[data-bk="pm"][data-bsid="s-01"]').count()) === 1, waited);
    await p5.waitForTimeout(5000);
    t('時間切れの後に届いた記録の答えは使わない（札に変えない）', (await p5.locator('[data-bk="pm"][data-bsid="s-01"]').count()) === 1 && !/年末調整の記録 /.test(await p5.textContent('#p-main')));
    /* 「もう一度読む」の確かめ（保存していない入力がある時）: 読み直すのボタンと同じ窓 */
    await p5.fill('#' + await p5.evaluate(() => document.querySelector('[data-bk="amt"][data-bsid="s-01"]').id), '1000');
    await p5.click('#p-reload');
    const mR = await sud(p5, 'cancel');
    t('保存していない賞与の入力がある時の読み直しは確かめる（やめれば入力が残る）', /捨てて読み直しますか/.test(mR) && await p5.inputValue('[data-bk="amt"][data-bsid="s-01"]') === '1000', mR);
    t('記録の答えが来ない場面: 画面のエラー 0', o5.errors.length === 0, o5.errors);
    await o5.ctx.close();
  }
  /* 記録が後から届いて札に変わる人: 入れかけの「金額を入れる」の選びを外し、形の違いで止めない */
  {
    const o6 = await open({ tab: 'bonus', start: 'none', bonus: true, ytd: [{ staff_id: 's-01', pay_date: '2026-11-25', kind: 'salary', source: 'freee', data: { taxable: 250000 } }], ytdDelay: 3000 });
    const p6 = o6.page;
    await p6.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
    await p6.click('[data-act="b-new"]'); await p6.fill('#bn-date', '2026-12-24'); await p6.click('[data-act="b-new-go"]');
    await p6.waitForSelector('[data-bk="pm"][data-bsid="s-01"]', { timeout: 10000 });
    await p6.selectOption('[data-bk="pm"][data-bsid="s-01"]', 'P');
    await p6.fill('#' + await p6.evaluate(() => document.querySelector('[data-bk="amt"][data-bsid="s-01"]').id), '300000');
    await p6.waitForFunction(() => { const b = document.querySelector('[data-act="b-save"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    await p6.click('[data-act="b-compute"]');
    const m6 = await sud(p6, 'ok', 1500);
    t('記録が後から届いた人は札に変わり、入れかけの金額の欄で止めない（計算できる）', m6 === '' && /年末調整の記録 250,000 円/.test((await p6.textContent('#p-main')).replace(/\s+/g, ' ')) && (await p6.locator('details.bit').count()) === 1, m6);
    t('記録が後から届く場面: 画面のエラー 0', o6.errors.length === 0, o6.errors);
    await o6.ctx.close();
  }
  /* 年末調整の記録の答えが遅い: 届くまで「下書き保存」「確定」を押せず、届いたら押せる */
  {
    const o4 = await open({ tab: 'bonus', start: 'none', bonus: true, ytd: [], ytdDelay: 3000 });
    const p4 = o4.page;
    await p4.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
    await p4.click('[data-act="b-new"]'); await p4.fill('#bn-date', '2026-12-24'); await p4.click('[data-act="b-new-go"]');
    await p4.waitForSelector('[data-act="b-compute"]', { timeout: 10000 });
    t('年末調整の記録を待つ間は「下書き保存」「確定」を押せない（待っている知らせを出す）', await p4.isDisabled('[data-act="b-save"]') && await p4.isDisabled('[data-act="b-confirm"]') && /年末調整の記録を確かめています/.test(await p4.textContent('#p-main')));
    await p4.waitForFunction(() => { const b = document.querySelector('[data-act="b-save"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    t('記録の答えが届いたら「下書き保存」を押せる', !/年末調整の記録を確かめています/.test(await p4.textContent('#p-main')));
    t('記録の答えが遅い場面: 画面のエラー 0', o4.errors.length === 0, o4.errors);
    await o4.ctx.close();
  }
  const q = await open({ tab: 'bonus', start: 'confirmed', bonus: true, viewport: { width: 390, height: 844 } });
  await q.page.waitForSelector('[data-act="b-new"]', { timeout: 15000 });
  t('賞与（iPhone の幅・回の一覧）: 画面の横はみ出し 0', await q.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0);
  /* 回の画面（入力の表・回の設定・計算の結果・明細の見本）も測る */
  await q.page.click('[data-act="b-new"]'); await q.page.fill('#bn-date', '2026-12-24'); await q.page.click('[data-act="b-new-go"]');
  await q.page.waitForSelector('[data-act="b-compute"]', { timeout: 10000 });
  await q.page.fill('#' + await q.page.evaluate(() => document.querySelector('[data-bk="amt"][data-bsid="s-01"]').id), '300000');
  await q.page.click('details.cd > summary');
  await q.page.click('[data-act="b-save"]');
  await q.page.waitForSelector('#p-main .slip', { timeout: 10000 });
  await q.page.click('details.bit > summary');
  t('賞与（iPhone の幅・回の画面と明細の見本）: 画面の横はみ出し 0（表は枠の中で横に送る）', await q.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, await q.page.evaluate(() => document.documentElement.scrollWidth));
  await shot(q.page, 'payroll.bonus-run.ph');
  t('賞与（iPhone の幅）: 画面のエラー 0', q.errors.length === 0, q.errors);
  await q.ctx.close();
}

/* ── 勤怠管理との行き来（2026-11-25 本人指示）: ?ym= で来た月分で開き、URL から消し、「勤怠管理へ」は今の月分の締めと出力のタブへ ── */
{
  console.log('\n— 勤怠管理との行き来 —');
  const h = await open({ path: 'payroll.html?ym=2026-10' });
  await h.page.waitForFunction(() => !document.getElementById('p-app').hidden && document.getElementById('p-main').textContent.length > 0, null, { timeout: 15000 });
  t('勤怠管理から ?ym=2026-10 で来ると 2026年10月分で開く（今日は11月）', await h.page.inputValue('#p-ym') === '2026-10');
  t('来た後は URL から月分を消す（再読み込みは今までどおり今月）', await h.page.evaluate(() => location.search) === '');
  t('月分は端末に残さない', await h.page.evaluate(() => Object.keys(localStorage).filter((k) => /^payroll/.test(k) && k !== 'payroll_tab')) .then((x) => x.length === 0));
  t('頭の「勤怠管理へ」は 10月分の締めと出力のタブへ', /\/?kintai\.html\?ym=2026-10&tab=close$/.test(await h.page.getAttribute('#p-to-kin', 'href')), await h.page.getAttribute('#p-to-kin', 'href'));
  await h.page.click('#p-next');
  await h.page.waitForFunction(() => document.getElementById('p-ym').value === '2026-11', null, { timeout: 10000 });
  t('月分を変えると「勤怠管理へ」の行き先も変わる', /kintai\.html\?ym=2026-11&tab=close$/.test(await h.page.getAttribute('#p-to-kin', 'href')), await h.page.getAttribute('#p-to-kin', 'href'));
  t('「勤怠管理へ」は 44px 以上の押す所', await h.page.evaluate(() => document.getElementById('p-to-kin').getBoundingClientRect().height >= 44));
  await shot(h.page, 'payroll.hop.pc', false);
  t('行き来の場面: 画面のエラー 0', h.errors.length === 0, h.errors);
  await h.ctx.close();
  const b = await open({ path: 'payroll.html?ym=2026-1x' });
  await b.page.waitForFunction(() => !document.getElementById('p-app').hidden && document.getElementById('p-main').textContent.length > 0, null, { timeout: 15000 });
  t('形の違う ?ym は捨てて今月（11月分）で開く', await b.page.inputValue('#p-ym') === '2026-11' && await b.page.evaluate(() => location.search) === '');
  await b.ctx.close();
  const ph = await open({ path: 'payroll.html?ym=2026-10', viewport: { width: 390, height: 844 } });
  await ph.page.waitForFunction(() => !document.getElementById('p-app').hidden && document.getElementById('p-main').textContent.length > 0, null, { timeout: 15000 });
  t('iPhone の幅: 頭に「勤怠管理へ」が入っても横はみ出し 0', await ph.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0);
  await shot(ph.page, 'payroll.hop.ph', false);
  await ph.ctx.close();
}

/* ── 勤怠管理から締めた勤怠を受け取る（?from=kintai・2026-11-26 本人指示）: 1回だけ自動で計算し、保存・確定は人が押す ── */
{
  console.log('\n— 勤怠管理から受け取る（from=kintai） —');
  const waitRun = async (pg) => { await waitApp(pg); await pg.waitForFunction(() => !/確かめています/.test(document.getElementById('p-main').textContent), null, { timeout: 15000 }).catch(() => {}); await settle(pg); };
  const saveCalls = (o) => o.routes.calls.filter((c) => /^payroll_run_(save|confirm)$/.test(c.name)).length;
  const band = (pg) => pg.evaluate(() => { const b = document.querySelector('#p-main .kin-band'); return b ? { cls: b.className, role: b.getAttribute('role'), text: b.textContent } : null; });
  const priAct = (pg) => pg.evaluate(() => Array.from(document.querySelectorAll('#p-main [data-act="compute"],#p-main [data-act="save"],#p-main [data-act="confirm"]')).filter((b) => b.classList.contains('pri')).map((b) => b.getAttribute('data-act')));
  /* (a) 締めた月分・下書きなし・端末に残したタブは「給与明細」でも、今月の給与で開いて自動で計算する */
  const a = await open({ tab: 'slip', start: 'none', path: 'payroll.html?ym=2026-11&from=kintai' });
  await waitRun(a.page);
  await a.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
  const ba = await band(a.page);
  t('(a) 今月の給与のタブで開く（端末のタブより先）・端末のタブは書き換えない', await a.page.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'run' && await a.page.evaluate(() => localStorage.getItem('payroll_tab')) === 'slip');
  t('(a) 自動で計算して10人分の行が出る', (await a.page.locator('details.it').count()) === 10);
  t('(a) 受け取りの帯（ok・role=status）が手順の段階のすぐ下に「10 人分…計算しました（警告 M 件）」', !!ba && /band ok/.test(ba.cls) && ba.role === 'status' && /^勤怠管理から 10 人分の締めた勤怠を受け取り、計算しました（警告 \d+ 件）。確かめてから「下書き保存」を押してください。$/.test(ba.text)
    && await a.page.evaluate(() => { const b = document.querySelector('#p-main .kin-band'); return !!b && b.previousElementSibling && b.previousElementSibling.matches('ol.su-steps'); }), ba);
  t('(a) 主ボタン（塗り）は「下書き保存」の1つだけ', JSON.stringify(await priAct(a.page)) === '["save"]', await priAct(a.page));
  t('(a) URL に from も ym も残さない', await a.page.evaluate(() => location.search) === '');
  t('(f) 自動で下書き保存・確定の関数を呼ばない', saveCalls(a) === 0);
  await shot(a.page, 'payroll.from-kintai.pc', false);
  /* 警告のある人だけ（B2） */
  const wn = await a.page.evaluate(() => document.querySelectorAll('details.it .tag.warn').length);
  const wb = a.page.locator('[data-act="warn-only"]');
  t('警告のある人だけ: 件数つきの切り替え（aria-pressed=false）が合計の帯と見出しの行の間に出る', wn > 0 && (await wb.count()) === 1 && await wb.getAttribute('aria-pressed') === 'false' && (await wb.textContent()) === '警告のある人だけ（' + wn + '）'
    && await a.page.evaluate(() => { const r = document.querySelector('.wfilt'); return !!r && r.previousElementSibling.matches('.sumbar') && r.nextElementSibling.matches('.ihd'); }), wn);
  await wb.click();
  t('警告のある人だけ: 押すと警告のある人だけになり aria-pressed=true・合計の帯は全員分のまま', (await a.page.locator('details.it').count()) === wn && await a.page.getAttribute('[data-act="warn-only"]', 'aria-pressed') === 'true' && /10 人/.test(await a.page.textContent('.sumbar')));
  await a.page.click('[data-act="warn-only"]');
  t('警告のある人だけ: もう一度押すと全員に戻る', (await a.page.locator('details.it').count()) === 10);
  /* 下書き保存 → 帯が消え、主ボタンは「確定する」 */
  await a.page.click('[data-act="save"]');
  await a.page.waitForFunction(() => { const b = document.querySelector('[data-act="confirm"]'); return b && !b.disabled; }, null, { timeout: 10000 });
  await settle(a.page);
  t('下書き保存の後: 受け取りの帯は消え、主ボタンは「確定する」', !(await band(a.page)) && JSON.stringify(await priAct(a.page)) === '["confirm"]', await priAct(a.page));
  await shot(a.page, 'payroll.from-kintai-saved.pc', false);
  t('(a) 画面のエラー 0', a.errors.length === 0, a.errors);
  await a.ctx.close();
  /* (b) 自動で計算した後に読み込み直す: 保存していない計算があるので離れる確かめが出る→そのまま読み込み直すと自動では計算しない */
  const b = await open({ tab: 'run', start: 'none', path: 'payroll.html?ym=2026-11&from=kintai' });
  await waitRun(b.page);
  await b.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
  b.page.on('dialog', (d) => d.accept().catch(() => {}));
  await b.page.reload();
  await waitRun(b.page);
  t('(b) 読み込み直しても自動では計算しない（帯なし・行なし）・URL に from が無い', !(await band(b.page)) && (await b.page.locator('details.it').count()) === 0 && await b.page.evaluate(() => location.search) === '');
  t('(b) 計算する前は主ボタンが「計算する」', JSON.stringify(await priAct(b.page)) === '["compute"]', await priAct(b.page));
  await b.ctx.close();
  /* (c) 確定済みの月分 */
  const c = await open({ tab: 'run', start: 'confirmed', path: 'payroll.html?ym=2026-11&from=kintai' });
  await waitRun(c.page);
  await c.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
  const bc = await band(c.page);
  t('(c) 確定済みの月分では計算せず「確定済み」の帯（warn）', !!bc && /band warn/.test(bc.cls) && bc.text === 'この月分は確定済みです（計算し直していません）。' && saveCalls(c) === 0, bc);
  await shot(c.page, 'payroll.from-kintai-confirmed.pc', false);
  await c.ctx.close();
  /* (d) from の値が違う */
  const d = await open({ tab: 'run', start: 'none', path: 'payroll.html?ym=2026-11&from=xyz' });
  await waitRun(d.page);
  await d.page.waitForTimeout(300);
  t('(d) from=xyz では何も起きない（計算しない・帯なし）・URL から消す', !(await band(d.page)) && (await d.page.locator('details.it').count()) === 0 && await d.page.evaluate(() => location.search) === '');
  await d.ctx.close();
  const d2 = await open({ tab: 'run', start: 'none', path: 'payroll.html?from=kintai' });
  await waitRun(d2.page);
  await d2.page.waitForTimeout(300);
  t('(d) 月分の無い from=kintai では何も起きない・URL から from を消す', !(await band(d2.page)) && (await d2.page.locator('details.it').count()) === 0 && await d2.page.evaluate(() => location.search) === '');
  await d2.ctx.close();
  /* (e) 勤怠が未締め */
  const e = await open({ tab: 'run', start: 'none', kintaiUnlocked: true, path: 'payroll.html?ym=2026-11&from=kintai' });
  await waitRun(e.page);
  await e.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
  const be = await band(e.page);
  t('(e) 未締めでは計算せず「まだ締められていない」の帯', !!be && /band warn/.test(be.cls) && be.text === '勤怠がまだ締められていないため、自動では計算していません。' && (await e.page.locator('details.it').count()) === 0 && saveCalls(e) === 0, be);
  await e.ctx.close();
  /* 下書きがあって stale でない */
  const g = await open({ tab: 'run', start: 'none' });
  await waitRun(g.page);
  await g.page.click('[data-act="compute"]');
  await g.page.click('[data-act="save"]');
  await g.page.waitForFunction(() => { const x = document.querySelector('[data-act="confirm"]'); return x && !x.disabled; }, null, { timeout: 10000 });
  await settle(g.page);
  const nSave = saveCalls(g);
  await g.page.goto(srv.url + '/payroll.html?ym=2026-11&from=kintai');
  await waitRun(g.page);
  await g.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
  const bg = await band(g.page);
  t('下書きがある月分では計算し直さず「保存した下書きがあります」の帯・主ボタンは「確定する」', !!bg && bg.text === '保存した下書きがあります（計算し直していません）。' && JSON.stringify(await priAct(g.page)) === '["confirm"]' && saveCalls(g) === nSave, [bg, await priAct(g.page)]);
  await g.ctx.close();
  /* 給与明細の空の状態から今月の給与へ */
  const s = await open({ tab: 'slip', start: 'none' });
  await waitRun(s.page);
  t('給与明細の空の状態に「今月の給与を開く」', /この月分の明細はまだありません/.test(await s.page.textContent('#p-main .cd.empty')) && (await s.page.locator('#p-main .cd.empty [data-tab="run"]').count()) === 1);
  await shot(s.page, 'payroll.slip-empty.pc', false);
  await s.page.click('#p-main .cd.empty [data-tab="run"]');
  t('「今月の給与を開く」で今月の給与のタブになる', await s.page.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'run');
  await s.ctx.close();
  /* 本番と同じく暗証番号の画面を通る: 鍵を開けるまでは計算せず、開けた後に1回だけ計算する。鍵をかけて開け直しても計算し直さず、帯は消える */
  {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const pinCalls = [];
    const pinRoute = { match: /\/rest\/v1\/rpc\/payroll_pin_(status|unlock|touch|lock)$/, handle: (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const nm = /payroll_pin_([a-z]+)$/.exec(req.url())[1]; pinCalls.push(nm);
      const body = nm === 'status' ? { set: true, admin: true, locked_until: null } : nm === 'unlock' ? { ok: true } : nm === 'touch' ? { unlocked: true } : { ok: true };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    } };
    const k = await open({ tab: 'slip', start: 'none', path: 'payroll.html?ym=2026-11&from=kintai', extraRoutes: [pinRoute] });
    await k.page.waitForSelector('#p-pin', { timeout: 15000 });
    t('鍵: 暗証番号の画面の間は計算しない（中身を出さない）・URL から from を外してある', await k.page.evaluate(() => document.getElementById('p-app').hidden) && !k.routes.calls.some((c) => c.name === 'payroll_bootstrap') && await k.page.evaluate(() => location.search) === '');
    await k.page.fill('#p-pin', '2468');
    await k.page.click('[data-act="pin-open"]');
    await waitRun(k.page);
    await k.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
    t('鍵: 開けた後に1回だけ自動で計算し、受け取りの帯（今月の給与のタブ）', (await k.page.locator('details.it').count()) === 10 && /^勤怠管理から 10 人分/.test((await band(k.page) || {}).text || '') && await k.page.evaluate(() => document.querySelector('.tabs [aria-selected="true"]').getAttribute('data-tab')) === 'run');
    await k.page.click('#p-lock');
    await k.page.waitForSelector('#p-pin', { timeout: 10000 });
    await k.page.fill('#p-pin', '2468');
    await k.page.click('[data-act="pin-open"]');
    await waitRun(k.page);
    await k.page.waitForTimeout(300);
    t('鍵: かけて開け直すと帯は消え、計算は残る（計算し直さない・保存と確定の関数を呼ばない）', !(await band(k.page)) && (await k.page.locator('details.it').count()) === 10 && JSON.stringify(await priAct(k.page)) === '["save"]' && saveCalls(k) === 0, pinCalls);
    t('鍵: 画面のエラー 0', k.errors.length === 0, k.errors);
    await k.ctx.close();
  }
  /* 幅320・390・768・1280 と文字200%（ui-check と同じ見方: 根の字の大きさを 200% にする）で帯がはみ出さない */
  for (const [w, z] of [[320, 1], [390, 1], [768, 1], [1280, 1], [320, 2], [390, 2], [1280, 2]]) {
    const q = await open({ tab: 'run', start: 'none', viewport: { width: w, height: 900 }, path: 'payroll.html?ym=2026-11&from=kintai' });
    await waitRun(q.page);
    await q.page.waitForSelector('#p-main .kin-band', { timeout: 10000 });
    if (z !== 1) await q.page.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important'));
    const ov = await q.page.evaluate(() => { const b = document.querySelector('#p-main .kin-band'); const r = b.getBoundingClientRect(); return { doc: document.documentElement.scrollWidth - window.innerWidth, right: r.right - window.innerWidth, fs: parseFloat(getComputedStyle(b).fontSize) }; });
    t('受け取りの帯: 幅' + w + (z !== 1 ? '・文字' + (z * 100) + '%' : '') + ' で横はみ出し 0・字 15px 以上', ov.doc <= 0 && ov.right <= 0.5 && ov.fs >= 15, ov);
    if (w === 390 && z === 1) await shot(q.page, 'payroll.from-kintai.ph', false);
    await q.ctx.close();
  }
}

await browser.close();
await srv.close();
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
