/* check/device_enroll_e2e.mjs — 端末登録の QR の通し試験（2026-11-08 段4・care-backend 統合 0082）
 *
 *   node check/device_enroll_e2e.mjs [--shots <保存先>]
 *
 * 本物の Chromium で、通信は全部横取りする（外へは出ない・架空データだけ）。
 *   A. 受け取りページ（enroll.html・本物の su-auth.js と supabase-js）: #c=番号 で開く → 住所から番号が消える → 受け口へ {code} だけ →
 *      受け取ったログインの鍵が共通ログインの保存場所に入る → 役割の確かめ → 端末の用途が入る → メニューへ移る。番号は端末のどこにも残らない
 *   B. 受け取りページ: 受け口が断った時は「使えません」を出し、ログインしない・メニューへ移らない
 *   C. 使える人の管理（ログインは偽物の管理者）: アカウントを選んで「QR を出す」→ QR の絵と期限が出る → 番号は端末に残らない →
 *      使われたら（一覧が active）QR が消えて「登録できました」
 * --shots を付けると、C の QR の絵を <保存先>/enroll-qr.png に撮る（読み取りの確かめ用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots || null;
const { chromium } = loadPlaywright();
const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';
const CODE = '0123456789abcdef0123456789abcdef01234567';
const EMAIL = 'kakuu-field@example.invalid';
const UID = '00000000-0000-4000-8000-0000000000f1';
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const ACCESS = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: UID, email: EMAIL, role: 'authenticated', aal: 'aal1', exp: now + 3600, iat: now,
  session_id: '10000000-0000-4000-8000-000000000001', amr: [{ method: 'magiclink', timestamp: now }] }) + '.c2ln';
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };

const srv = await startServer(repoDir);
const browser = await chromium.launch();

async function enrollRun(reply) {
  const st = { enrollBodies: [], hashAtSend: [], outside: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === srv.url) return route.continue();
    if (u.origin !== SB) { st.outside.push(u.origin); return route.abort(); }
    if (u.pathname === '/functions/v1/device-enroll') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
      st.enrollBodies.push(route.request().postData());
      return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
    }
    if (u.pathname === '/auth/v1/user') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) });
    if (u.pathname === '/rest/v1/rpc/my_account') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply.deny ? null : { email: EMAIL, role: 'field', mfa: false }) });
    if (u.pathname === '/rest/v1/allowed_accounts') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'field', label: '現場の端末（架空）' }) });
    if (u.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => st.errors.push(String(e && e.message || e)));
  await page.addInitScript(() => {
    const f = window.fetch;
    window.fetch = function (u, init) {
      if (String(u).includes('/functions/v1/device-enroll')) window.__hashAtSend = location.hash;
      return f.apply(this, arguments);
    };
  });
  await page.goto(srv.url + '/enroll.html#c=' + CODE);
  return { context, page, st };
}

try {
  say('— A. 受け取りページ（登録できる時） —');
  let { context, page, st } = await enrollRun({ status: 200, body: { ok: true, session: { access_token: ACCESS, refresh_token: 'refresh-kakuu', expires_at: now + 3600 }, deviceRole: 'field' } });
  await page.waitForURL(/\/index\.html$/, { timeout: 15000 }).catch(() => {});
  const hashAtSend = await page.evaluate(() => window.__hashAtSend).catch(() => 'x');
  t('メニューへ移った', /\/index\.html$/.test(page.url()), page.url());
  t('受け口へは {code} だけを1回', st.enrollBodies.length === 1 && st.enrollBodies[0] === JSON.stringify({ code: CODE }), st.enrollBodies);
  const stor = await page.evaluate(() => ({ ls: Object.assign({}, localStorage), ss: Object.assign({}, sessionStorage) }));
  const tokenKey = Object.keys(stor.ls).find((k) => /^sb-[a-z0-9]+-auth-token$/.test(k));
  t('ログインの鍵が共通ログインの保存場所に入った', !!tokenKey && stor.ls[tokenKey].includes('refresh-kakuu'));
  t('端末の用途が「現場」になった', stor.ls.su_device_role === 'field');
  t('番号は端末のどこにも残っていない（localStorage・sessionStorage）', !JSON.stringify(stor).includes(CODE));
  t('外への通信なし', st.outside.length === 0, st.outside);
  await context.close();

  ({ context, page, st } = await enrollRun({ status: 200, body: { ok: true, session: { access_token: ACCESS, refresh_token: 'refresh-kakuu', expires_at: now + 3600 }, deviceRole: 'field' } }));
  await page.waitForFunction(() => window.__hashAtSend !== undefined, null, { timeout: 10000 }).catch(() => {});
  t('受け口へ送る時には住所から番号が消えている', (await page.evaluate(() => window.__hashAtSend).catch(() => 'x')) === '');
  await context.close();

  say('— B. 受け取りページ（断られた時） —');
  ({ context, page, st } = await enrollRun({ status: 403, body: { ok: false, code: 'invalid' } }));
  await page.waitForSelector('#v-ng:not([hidden])', { timeout: 10000 }).catch(() => {});
  const msg = await page.textContent('#ng-msg').catch(() => '');
  const stor2 = await page.evaluate(() => Object.keys(localStorage));
  await page.waitForTimeout(2000);
  t('「この QR は使えません」を出す・メニューへ移らない', /使えません/.test(msg) && /\/enroll\.html$/.test(page.url()), [msg, page.url()]);
  t('ログインの鍵も用途も書かない', !stor2.some((k) => /auth-token|su_device_role/.test(k)), stor2);
  t('画面のエラーなし', st.errors.length === 0, st.errors);
  await context.close();

  say('— B2. 受け取りページ（ログインはできたが、データベースが使えないと答えた時） —');
  ({ context, page, st } = await enrollRun({ deny: true, status: 200, body: { ok: true, session: { access_token: ACCESS, refresh_token: 'refresh-kakuu', expires_at: now + 3600 }, deviceRole: 'field' } }));
  await page.waitForSelector('#v-ng:not([hidden])', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const stor4 = await page.evaluate(() => Object.keys(localStorage));
  t('ログアウトしてから断りを出す（ログインの鍵が端末に残らない・用途も書かない・メニューへ移らない）',
    !stor4.some((k) => /auth-token|su_device_role/.test(k)) && /\/enroll\.html$/.test(page.url()) && /使えません/.test(await page.textContent('#ng-msg')), stor4);
  await context.close();

  say('— C. 使える人の管理（QR を出す） —');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const calls = [];
  let state = 'open';
  await ctx.route('**/su-auth.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: `(function(){var S={SIGNED_OUT:'signed_out',DENIED:'denied',MFA_ENROLL:'mfa_enroll',MFA_VERIFY:'mfa_verify',OK:'ok',ERROR:'error'};var c=null;
    window.SUAuth={STATUS:S,ROLE_LABEL:{admin:'管理者',office:'事務所',field:'現場'},client:function(){return c||(c=supabase.createClient('${SB}','sb_publishable_fake',{auth:{persistSession:false,autoRefreshToken:false}}));},
    check:function(){return Promise.resolve({status:S.OK,role:'admin',roleLabel:'管理者',email:'kakuu-admin@example.invalid',mfa:true,label:'架空 管理者'});}};})();` }));
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === srv.url) return route.fallback();
    if (u.origin !== SB) return route.abort();
    const j = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/rest/v1/allowed_accounts') return j([{ email: 'kakuu-admin@example.invalid', role: 'admin', is_active: true, allow_password: false, label: '架空 管理者', tenant_id: '00000000-0000-4000-8000-000000000001' },
      { email: EMAIL, role: 'field', is_active: true, allow_password: false, label: '現場の端末（架空）', tenant_id: '00000000-0000-4000-8000-000000000001' }]);
    const m = u.pathname.match(/\/rest\/v1\/rpc\/(\w+)/);
    const name = m && m[1];
    if (name) calls.push({ name, body: route.request().postData() });
    if (name === 'device_enroll_candidates') return j({ ok: true, rows: [{ email: EMAIL, label: '現場の端末（架空）', role: 'field', ready: true }] });
    if (name === 'device_enroll_issue') return j({ ok: true, id: 3, code: CODE, expiresAt: new Date(Date.now() + 600000).toISOString(), email: EMAIL, deviceRole: 'field' });
    if (name === 'device_enroll_list') return j({ ok: true, rows: [{ id: 3, email: EMAIL, label: '現場の端末（架空）', deviceRole: 'field', deviceLabel: '', state, createdAt: new Date().toISOString(), boundAt: state === 'active' ? new Date().toISOString() : null }] });
    if (name === 'export_runs' || name) return j(null);
    return j([]);
  });
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await p2.goto(srv.url + '/accounts.html');
  await p2.waitForSelector('#en-form:not([hidden])', { timeout: 15000 }).catch(() => {});
  t('管理者には「端末登録の QR」の欄が出る', await p2.isVisible('#en-form'));
  await p2.selectOption('#en-acct', EMAIL);
  await p2.selectOption('#en-role', 'field');
  await p2.click('#b-enroll');
  await p2.waitForSelector('#en-qr:not([hidden]) svg', { timeout: 10000 }).catch(() => {});
  const qr = await p2.evaluate(() => {
    const s = document.querySelector('#en-qr svg');
    return s ? { d: (s.querySelector('path').getAttribute('d').match(/M/g) || []).length, label: s.getAttribute('aria-label'), text: document.getElementById('en-qr').textContent } : null;
  });
  t('QR の絵（黒いマス）と期限が出る', qr && qr.d > 100 && /あと \d+分/.test(qr.text), qr && { d: qr.d });
  t('画面の文字に番号は出ない', qr && !qr.text.includes(CODE));
  const issueCall = calls.find((c) => c.name === 'device_enroll_issue');
  t('出す時に送るのはアカウント・用途・呼び名だけ', issueCall && issueCall.body === JSON.stringify({ p_email: EMAIL, p_device_role: 'field', p_label: '' }), issueCall);
  const stor3 = await p2.evaluate(() => JSON.stringify([Object.assign({}, localStorage), Object.assign({}, sessionStorage)]));
  t('番号は端末に残らない', !stor3.includes(CODE));
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await (await p2.$('#en-qr svg')).screenshot({ path: path.join(shots, 'enroll-qr.png') });
  }
  state = 'active';
  await p2.waitForSelector('#en-qr[hidden]', { state: 'attached', timeout: 15000 }).catch(() => {});
  const after = await p2.evaluate(() => ({ hidden: document.getElementById('en-qr').hidden, msg: document.getElementById('en-msg').textContent, svg: !!document.querySelector('#en-qr svg') }));
  t('使われたら QR を消して「登録ができました」', after.hidden && !after.svg && /登録ができました/.test(after.msg), after);
  t('画面のエラーなし', errs.length === 0, errs);
  await ctx.close();
} finally {
  await browser.close();
  await srv.close();
}
say('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
process.exit(ng ? 1 : 0);
