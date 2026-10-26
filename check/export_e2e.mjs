/* check/export_e2e.mjs — 使える人の管理の「全データの書き出し」を、画面のボタンから通しで回す（2026-10-26 新設）
 *
 *   node check/export_e2e.mjs [--shots <保存先>]
 *
 * 本物の Chromium で accounts.html を開き、ログイン（su-auth.js）とデータベース・GAS だけを偽物に差し替えて、
 * 架空の事業者 C を書き出す → 保存された ZIP を開く → 中の JSON が架空のデータと1文字も違わないことを確かめる。
 *   ・データベースの偽物は、0024 の export_begin・export_page・export_finish と同じ形で返す
 *     （同期データの表は 4,500 行＝2000 行ずつ3回に分けて読むことも確かめる。中身の規則そのものは care-backend の試験）
 *   ・GAS の偽物は script.google.com への送信を横取りして返す（外へは出ない）。接続設定は架空の値を端末に入れる
 *   ・確かめること: 書き出しの記録に、画面が受け取った件数・GAS の分・ファイル名が届く／現場の端末では始まらない／
 *     注意の確かめで「キャンセル」すると何も読まない／2段階認証が切れていたら（42501）保存しない
 * データはすべて架空。外への通信はしない（Supabase・Google は全部横取り）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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

/* ── 架空の事業者 C ── */
const TEN = '00000000-0000-4000-8000-00000000000c';
const ME = 'c-admin@example.com';
const DB = {
  tenants: [{ id: TEN, name: '試験用 書き出し事業者', created_at: '2026-10-01T00:00:00+00:00' }],
  allowed_accounts: [
    { email: ME, tenant_id: TEN, role: 'admin', is_active: true, allow_password: false, label: '架空の管理者' },
    { email: 'c-field@example.com', tenant_id: TEN, role: 'field', is_active: true, allow_password: true, label: '=架空の現場' }
  ],
  kv_entries: Array.from({ length: 4500 }, (_, i) => ({ tenant_id: TEN, key: 'wsday_k' + String(i).padStart(4, '0'), rev: i, data: { n: i, '名前': '架空 ' + i, '改行': 'a\nb', '並び': [i, null] } })),
  master_residents: [{ tenant_id: TEN, source_id: 'X001', name: '試験 花子', target_apps: ['a', 'b,c'], active: true, discharge_date: null }],
  audit_log: []
};
const COLS = {};
for (const k of Object.keys(DB)) COLS[k] = Object.keys(DB[k][0] || { id: 1 }).map((c) => ({ name: c, type: 'text', nullable: true, comment: '' }));
const SCOPE = { tenants: 'self' };

function fakeDb(state) {
  return (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const send = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
    if (rpc) {
      const a = req.postDataJSON() || {};
      state.calls.push(rpc[1]);
      if (state.denyAll) return send(403, { code: '42501', message: 'permission denied' });
      if (rpc[1] === 'export_begin') {
        const tables = Object.keys(DB).map((n) => ({ name: n, scope: SCOPE[n] || 'tenant', count: DB[n].length, comment: n === 'kv_entries' ? '同期データの本体' : '', columns: COLS[n] }));
        state.run = { id: 41, db_counts: Object.fromEntries(tables.map((x) => [x.name, x.count])) };
        return send(200, { run_id: 41, started_at: '2026-10-26T01:02:03+00:00', tenant_id: TEN, tenant_name: DB.tenants[0].name, actor_email: ME,
                           total: tables.reduce((s, x) => s + x.count, 0), tables });
      }
      if (rpc[1] === 'export_page') {
        /* 0024 と同じ形: {rows, next}。続きの印は「最後に読んだ行の位置」（本物は主キー。ここは配列の位置で真似る） */
        const from = a.p_after ? a.p_after.i + 1 : 0;
        state.pages.push(a.p_table + '@' + from);
        if (a.p_run !== 41 || !DB[a.p_table] || a.p_limit > 2000) return send(403, { code: '42501', message: 'x' });
        const rows = DB[a.p_table].slice(from, from + a.p_limit);
        return send(200, { rows, next: rows.length === a.p_limit ? { i: from + rows.length - 1 } : null });
      }
      if (rpc[1] === 'export_finish') {
        state.finish = a;
        return send(200, { ok: true, match: JSON.stringify(a.p_got) === JSON.stringify(state.run.db_counts) });
      }
      return send(404, { code: 'PGRST202', message: 'Could not find the function' });
    }
    if (u.pathname.endsWith('/rest/v1/allowed_accounts')) return send(200, DB.allowed_accounts);
    if (u.pathname.endsWith('/rest/v1/export_runs')) {
      return send(200, state.finish ? [{ id: 41, started_at: '2026-10-26T01:02:03+00:00', actor_email: ME, db_total: 4504, finished_at: '2026-10-26T01:02:09+00:00',
                                         gas_counts: state.finish.p_gas, file_name: state.finish.p_file }] : []);
    }
    return send(404, {});
  };
}
const GASDATA = {
  WS: { ok: true, entries: { care_schedule_v2: { key: 'care_schedule_v2', rev: 2, data: { events: [{ '名前': '架空 予定' }] } } } },
  WT: { ok: true, ver: 3, residents: [{ id: 'r1', name: '架空 一郎' }], records: [{ id: 'w1', kg: 50.5 }, { id: 'w2', kg: 49 }], thresholds: { warn: 2 } }
};
function fakeGas(state) {
  return (route) => {
    const req = route.request();
    state.gas.push({ url: req.url(), body: req.postData(), ct: req.headers()['content-type'] });
    const id = /\/s\/([A-Z]+)\/exec/.exec(req.url())[1];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GASDATA[id] || { ok: false, error: 'x' }) });
  };
}
/* ログインの偽物（su-auth.js の check・client・STATUS・ROLE_LABEL だけ。client は本物の supabase-js に、横取りされる URL で作らせる） */
function fakeAuth(mfa) {
  return `(function(){var S={SIGNED_OUT:'signed_out',DENIED:'denied',MFA_ENROLL:'mfa_enroll',MFA_VERIFY:'mfa_verify',OK:'ok',ERROR:'error'};
  var c=null;window.SUAuth={STATUS:S,ROLE_LABEL:{admin:'管理者',office:'事務所',field:'現場'},
  client:function(){return c||(c=supabase.createClient('https://jhbernqawjrzqwrmqrih.supabase.co','sb_publishable_fake',{auth:{persistSession:false,autoRefreshToken:false}}));},
  check:function(){return Promise.resolve(${mfa ? `{status:S.OK,role:'admin',roleLabel:'管理者',email:'${ME}',mfa:true,label:'架空の管理者'}` : `{status:S.MFA_VERIFY}`});}};})();`;
}

const srv = await startServer(repoDir);
const browser = await chromium.launch();
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'export-e2e-'));
async function openPage({ role = 'office', mfa = true, dialog = 'accept', denyAll = false, viewport = { width: 1280, height: 900 } } = {}) {
  const state = { calls: [], pages: [], gas: [], finish: null, denyAll, dialogs: [], errors: [] };
  const context = await browser.newContext({ acceptDownloads: true, viewport });
  await context.route('**/su-auth.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fakeAuth(mfa) }));
  await context.route('https://jhbernqawjrzqwrmqrih.supabase.co/**', fakeDb(state));
  await context.route('https://script.google.com/**', fakeGas(state));
  await context.addInitScript((r) => {
    localStorage.setItem('su_device_role', r);
    localStorage.setItem('su_sync_common', JSON.stringify({ endpoint: 'https://script.google.com/macros/s/WS/exec', token: 'tok-ws-fake' }));
    localStorage.setItem('wtmgr_api_url', 'https://script.google.com/macros/s/WT/exec');
    localStorage.setItem('wtmgr_api_token', 'tok-wt-fake');
  }, role);
  const page = await context.newPage();
  page.on('pageerror', (e) => state.errors.push(String(e.message).slice(0, 160)));
  page.on('dialog', (d) => { state.dialogs.push(d.message()); (dialog === 'accept' ? d.accept() : d.dismiss()).catch(() => {}); });
  await page.goto(srv.url + '/accounts.html', { waitUntil: 'load' });
  return { context, page, state };
}

try {
  console.log('\n— 1. 管理者（2段階認証あり）が架空の事業者 C を書き出して、ZIP を読み戻す —');
  {
    const { context, page, state } = await openPage();
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    t('管理者には書き出しの枠が出る', await page.isVisible('#b-export'), '');
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.locator('#sec-export').screenshot({ path: path.join(shots, 'export-before.png') }); }
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#b-export')]);
    const zpath = path.join(tmp, 'c.zip');
    await dl.saveAs(zpath);
    await page.waitForFunction(() => document.getElementById('ex-msg').className.includes('ok') && document.querySelectorAll('#ex-runs li').length === 1, null, { timeout: 15000 });
    const msgText = await page.textContent('#ex-msg');
    if (shots) await page.locator('#sec-export').screenshot({ path: path.join(shots, 'export-after.png') });
    t('始める前に個人情報の注意を出した', state.dialogs.length === 1 && /個人情報/.test(state.dialogs[0]) && /鍵はかかりません/.test(state.dialogs[0]), state.dialogs);
    t('ファイル名は「全データ_日時.zip」', /^全データ_\d{8}-\d{4}\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    t('同期データは 2000 行ずつ3回に分けて読んだ', ['kv_entries@0', 'kv_entries@2000', 'kv_entries@4000'].every((x) => state.pages.includes(x)) && state.pages.filter((x) => x.startsWith('kv_entries')).length === 3, state.pages);
    t('呼んだ順: 始める → 表ごと → 終える', state.calls[0] === 'export_begin' && state.calls[state.calls.length - 1] === 'export_finish', state.calls);
    t('終わりの記録: 受け取った件数が数えた件数と同じ・GAS の分・ファイル名',
      JSON.stringify(state.finish.p_got) === JSON.stringify(state.run.db_counts) && state.finish.p_file === dl.suggestedFilename() &&
      state.finish.p_gas['体重管理'].ok === true && state.finish.p_gas['体重管理'].count === 2 && state.finish.p_gas['ジェノグラム（家族構成図）'].ok === false, state.finish);
    t('終わりの記録に合言葉・接続先の URL は入らない', !/tok-|script\.google/.test(JSON.stringify(state.finish)), '');
    t('GAS: 接続設定のある2系統だけに送った（POST・text/plain・合言葉は本文だけ）',
      state.gas.length === 2 && state.gas.every((g) => /text\/plain/.test(g.ct) && !/tok-/.test(g.url) && /"token":"tok-/.test(g.body)), state.gas.map((g) => g.url));
    t('画面: 保存した旨と件数（4,504 行・Google 2 / 8 系統）を出す', /保存しました/.test(msgText) && /4504 行/.test(msgText) && /Google 2 \/ 8 系統/.test(msgText), msgText);
    t('画面: これまでの書き出しに今回の1行が出る', /保存まで済み/.test(await page.textContent('#ex-runs')), await page.textContent('#ex-runs'));
    t('画面のエラーなし', state.errors.length === 0, state.errors);

    const py = execFileSync('python3', ['-I', '-c',
      'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad":z.testzip(),"names":sorted(z.namelist()),' +
      '"db":{n[3:-5]:json.loads(z.read(n).decode("utf-8")) for n in z.namelist() if n.startswith("db/") and n.endswith(".json")},' +
      '"gas":json.loads(z.read("gas/weight.json").decode("utf-8")),"man":json.loads(z.read("manifest.json").decode("utf-8")),' +
      '"readme":z.read("README.txt").decode("utf-8-sig"),"csv":z.read("db/allowed_accounts.csv").decode("utf-8-sig")},ensure_ascii=False))', zpath],
      { maxBuffer: 64 * 1024 * 1024 }).toString();
    const r = JSON.parse(py);
    t('保存された ZIP は Python の zipfile で壊れていない', r.bad === null, r.bad);
    t('ZIP の中身: 説明書き・目録・表ごとの JSON と CSV・読めた GAS', ['README.txt', 'manifest.json', 'db/kv_entries.json', 'db/kv_entries.csv', 'db/tenants.json', 'gas/ws.json', 'gas/weight.json', 'gas/weight__records.csv'].every((n) => r.names.includes(n)) &&
      !r.names.some((n) => n.startsWith('gas/geno')), r.names);
    t('読み戻し: データベースの全部の表が架空のデータと1文字も違わない（4,500 行の表を含む）', JSON.stringify(r.db) === JSON.stringify(DB), Object.keys(r.db));
    t('読み戻し: GAS の分も応答のまま（ok の印だけ外す）', JSON.stringify(r.gas) === JSON.stringify({ ver: 3, residents: GASDATA.WT.residents, records: GASDATA.WT.records, thresholds: GASDATA.WT.thresholds }), r.gas);
    t('目録: 書き出しの番号 41・人・事業者・件数', r.man.run_id === 41 && r.man.actor_email === ME && r.man.tenant_id === TEN && r.man.db.find((d) => d.table === 'kv_entries').count === 4500, r.man.db);
    t('説明書き: 事業者・人・件数・表の説明・入っていない系統の理由', r.readme.includes('試験用 書き出し事業者') && r.readme.includes(ME) && r.readme.includes('【kv_entries】 4500 行') &&
      r.readme.includes('同期データの本体') && /ジェノグラム.*入っていません: この端末の接続設定に無い/.test(r.readme), r.readme.slice(0, 300));
    t("CSV: 先頭が = の値に ' が付く（表計算ソフトで式にしない）", r.csv.includes("'=架空の現場"), r.csv);
    await context.close();
  }

  console.log('\n— 2. 止まるべき時に止まる —');
  {
    const { context, page, state } = await openPage({ role: 'field' });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    await page.click('#b-export');
    await page.waitForTimeout(500);
    t('現場の端末: 確かめも出さず、データベースにも GAS にも送らない', state.dialogs.length === 0 && !state.calls.includes('export_begin') && state.gas.length === 0, state.calls);
    t('現場の端末: 理由を出す', /現場/.test(await page.textContent('#ex-msg')), await page.textContent('#ex-msg'));
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ dialog: 'dismiss' });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    await page.click('#b-export');
    await page.waitForTimeout(500);
    t('注意の確かめで「キャンセル」: 何も読まない・保存しない', state.dialogs.length === 1 && !state.calls.includes('export_begin') && state.gas.length === 0, state.calls);
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ denyAll: true });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    let downloaded = false; page.on('download', () => { downloaded = true; });
    await page.click('#b-export');
    await page.waitForFunction(() => /2段階認証/.test(document.getElementById('ex-msg').textContent), null, { timeout: 15000 });
    t('データベースが断ったら（42501）: 保存しない・GAS にも送らない・2段階認証を確かめるよう出す', !downloaded && state.gas.length === 0, state.calls);
    t('断られた後もボタンは押せる（やり直せる）', await page.isEnabled('#b-export'), '');
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ mfa: false });
    await page.waitForSelector('#v-gate:not([hidden])', { timeout: 15000 });
    t('2段階認証の前: 書き出しの枠は出ない', !(await page.isVisible('#sec-export')) && state.calls.length === 0, state.calls);
    await context.close();
  }
  {
    const { context, page } = await openPage({ viewport: { width: 390, height: 844 } });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('iPhone の幅: 横にはみ出さない', over <= 0, over);
    const box = await page.locator('#b-export').boundingBox();
    t('iPhone の幅: ボタンは押しやすい高さ（44px 以上）', box && box.height >= 44, box);
    if (shots) await page.locator('#sec-export').screenshot({ path: path.join(shots, 'export-iphone.png') });
    await context.close();
  }
} catch (e) {
  t('例外なし', false, String(e && e.stack || e));
} finally {
  await browser.close();
  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
