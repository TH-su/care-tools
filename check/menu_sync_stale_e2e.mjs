/* check/menu_sync_stale_e2e.mjs — メニューの「入居者マスタ」の、写しが止まっている時の札を本物のブラウザで確かめる（2026-10-26 本人指示）
 *
 *   node check/menu_sync_stale_e2e.mjs [--shots <保存先>]
 *
 * 本物の Chromium で index.html を開き、ログイン（su-auth.js）とデータベースだけを偽物に差し替える（export_e2e.mjs と同じやり方）。
 *   ・確かめること: 管理者＋古い成功で札が出る（入居者マスタのタイルだけ）／新しい成功で出ない／事務所のアカウントで出ない／
 *     現場端末では su-auth を読みに行かない・写しの記録を読まない／読む要求は1本で、成功（failed=0）をサーバー側で絞っている
 *   ・現場端末でもログインの記録があると、メニューの並び（su-menu.js）が su-auth を読む（既存の動き・現場のアカウントの並びのため）。
 *     そこでは「札の部品が確かめ（check）・写しの記録の読み取りをしない」ことを見る。ログインの記録が無い現場端末では su-auth 自体を読まない
 * データはすべて架空。外への通信はしない（Supabase は全部横取り）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots ? path.resolve(args.shots) : '';
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info).slice(0, 400)); }
}

const HOUR = 3600 * 1000;
const OLD = new Date(Date.now() - 3 * 24 * HOUR).toISOString();
const NEW = new Date(Date.now() - HOUR).toISOString();
/* 日本時間の MM/DD HH:mm（試験の側でも同じ規則で作る） */
function jst(isoText) {
  const d = new Date(Date.parse(isoText) + 9 * HOUR);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

/* ログインの偽物（check・client・STATUS だけ。check の回数は window.__checks に数える） */
function fakeAuth(role) {
  return `(function(){var S={SIGNED_OUT:'signed_out',DENIED:'denied',MFA_ENROLL:'mfa_enroll',MFA_VERIFY:'mfa_verify',OK:'ok',ERROR:'error'};
  var c=null;window.__checks=0;window.SUAuth={STATUS:S,ROLE_LABEL:{admin:'管理者',office:'事務所',field:'現場'},
  client:function(){return c||(c=supabase.createClient('https://jhbernqawjrzqwrmqrih.supabase.co','sb_publishable_fake',{auth:{persistSession:false,autoRefreshToken:false}}));},
  check:function(){window.__checks++;return Promise.resolve({status:S.OK,role:'${role}',roleLabel:'',email:'kakuu@example.com',mfa:${role === 'admin'},label:'架空 太郎'});}};})();`;
}

const srv = await startServer(repoDir);
const browser = await chromium.launch();

async function openMenu({ device = 'office', login = true, role = 'admin', rows = [] } = {}) {
  const state = { runs: [], authReq: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/su-auth.js*', (r) => { state.authReq.push('su-auth.js'); return r.fulfill({ status: 200, contentType: 'text/javascript', body: fakeAuth(role) }); });
  await context.route('**/supabase-js-*.js*', (r) => { state.authReq.push('supabase-js'); return r.continue(); });
  await context.route('https://jhbernqawjrzqwrmqrih.supabase.co/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/rest/v1/master_sync_runs')) {
      state.runs.push(u.search);
      /* サーバー側の絞り込み（failed=eq.0・新しい順・limit）を真似る */
      let out = rows.slice();
      if (u.searchParams.get('failed') === 'eq.0') out = out.filter((x) => x.failed === 0);
      out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const lim = Number(u.searchParams.get('limit') || out.length);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out.slice(0, lim)) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await context.addInitScript((o) => {
    localStorage.setItem('su_device_role', o.device);
    if (o.login) localStorage.setItem('sb-jhbernqawjrzqwrmqrih-auth-token', '{"架空":"ログインの記録の印"}');
  }, { device, login });
  const page = await context.newPage();
  page.on('pageerror', (e) => state.errors.push(String(e.message).slice(0, 160)));
  await page.goto(srv.url + '/index.html', { waitUntil: 'load' });
  return { context, page, state };
}
async function badges(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a.tile .stale')).map((s) => ({ href: s.closest('a.tile').getAttribute('href'), text: s.textContent })));
}

try {
  console.log('\n— 1. 管理者＋古い成功（その後に新しい失敗）→ 札が出る —');
  {
    const rows = [{ at: OLD, failed: 0, device_label: '架空 太郎' }, { at: NEW, failed: 3, device_label: '架空 次郎' }];
    const { context, page, state } = await openMenu({ rows });
    await page.waitForSelector('a.tile .stale', { timeout: 15000 }).catch(() => {});
    const b = await badges(page);
    t('入居者マスタのタイルだけに1枚（誕生日一覧には付けない）', b.length === 1 && b[0].href === 'resident-master.html', b);
    t('文は「写しが止まっています（最終 MM/DD HH:mm）」で、古い成功の日本時間', b[0] && b[0].text === '写しが止まっています（最終 ' + jst(OLD) + '）', b);
    t('札に氏名らしい値は出ない', b.every((x) => !/架空|太郎|次郎/.test(x.text)), b);
    t('写しの記録を読む要求は1本・at と failed だけ・成功（failed=eq.0）を新しい順に1行', state.runs.length === 1 &&
      /select=at%2Cfailed|select=at,failed/.test(state.runs[0]) && /failed=eq\.0/.test(state.runs[0]) && /order=at\.desc/.test(state.runs[0]) && /limit=1/.test(state.runs[0]), state.runs);
    t('確かめ（SUAuth.check）は1回', (await page.evaluate(() => window.__checks)) === 1, '');
    t('画面のエラーなし', state.errors.length === 0, state.errors);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.locator('a.tile[href="resident-master.html"]').screenshot({ path: path.join(shots, 'menu-stale-badge.png') }); }
    await context.close();
  }

  console.log('\n— 2. 管理者＋成功の記録なし → 「記録なし」—');
  {
    const { context, page } = await openMenu({ rows: [{ at: NEW, failed: 1 }] });
    await page.waitForSelector('a.tile .stale', { timeout: 15000 }).catch(() => {});
    const b = await badges(page);
    t('「写しが止まっています（最終 記録なし）」', b.length === 1 && b[0].text === '写しが止まっています（最終 記録なし）', b);
    await context.close();
  }

  console.log('\n— 3. 管理者＋新しい成功 → 出ない —');
  {
    const { context, page, state } = await openMenu({ rows: [{ at: NEW, failed: 0 }] });
    await page.waitForFunction(() => window.__checks === 1, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    t('読んだ（1本）うえで札は出ない', state.runs.length === 1 && (await badges(page)).length === 0, { runs: state.runs.length, b: await badges(page) });
    await context.close();
  }

  console.log('\n— 4. 事務所のアカウント・現場のアカウント → 出ない・読まない —');
  for (const role of ['office', 'field']) {
    const { context, page, state } = await openMenu({ role, rows: [{ at: OLD, failed: 0 }] });
    await page.waitForFunction(() => window.__checks === 1, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    t(role + ' のアカウント: 札なし・写しの記録を読まない', (await badges(page)).length === 0 && state.runs.length === 0, state.runs);
    await context.close();
  }

  console.log('\n— 5. 現場端末 —');
  {
    const { context, page, state } = await openMenu({ device: 'field', login: false, rows: [{ at: OLD, failed: 0 }] });
    await page.waitForTimeout(1500);
    t('ログインの記録なし: su-auth.js・supabase-js を読みに行かない・写しの記録を読まない・札なし',
      state.authReq.length === 0 && state.runs.length === 0 && (await badges(page)).length === 0, state);
    await context.close();
  }
  {
    const { context, page, state } = await openMenu({ device: 'field', login: true, rows: [{ at: OLD, failed: 0 }] });
    await page.waitForTimeout(2500);
    const checks = await page.evaluate(() => window.__checks);
    t('ログインの記録あり（管理者）: 札の部品は確かめない・写しの記録を読まない・札なし',
      !checks && state.runs.length === 0 && (await badges(page)).length === 0, { checks, runs: state.runs, authReq: state.authReq });
    console.log('    （参考: この時メニューの並びの部品が読んだもの: ' + (state.authReq.join('・') || 'なし') + '）');
    await context.close();
  }

  console.log('\n— 6. ログインなし（事務所の端末）—');
  {
    const { context, page, state } = await openMenu({ login: false, rows: [{ at: OLD, failed: 0 }] });
    await page.waitForTimeout(1500);
    t('su-auth.js・supabase-js を読みに行かない・札なし', state.authReq.length === 0 && state.runs.length === 0 && (await badges(page)).length === 0, state);
    await context.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log(`\n${pass} 件成功／${fail} 件失敗`);
process.exit(fail ? 1 : 0);
