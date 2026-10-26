/* check/export_e2e.mjs — 使える人の管理の「全データの書き出し」を、画面のボタンから通しで回す（2026-10-26 新設）
 *
 *   node check/export_e2e.mjs [--shots <保存先>]
 *
 * 本物の Chromium で accounts.html を開き、ログイン（su-auth.js）とデータベース・GAS だけを偽物に差し替えて、
 * 架空の事業者 C を書き出す → 保存された ZIP を開く → 中の JSON が架空のデータと1文字も違わないことを確かめる。
 *   ・2026-10-26: 既定は「暗号化する」。保存物は「元の名前.suenc」で、Node 側で su-export-crypt.js（vm）と
 *     ターミナルの道具 check/export-decrypt.mjs の両方で戻し、今までと同じ ZIP の中身であることを確かめる。
 *     暗号化しない時は理由が要る（空なら始まらない・あれば export_begin に false と理由が届く）。
 *     パスフレーズが localStorage・sessionStorage・送信のどこにも残らないこと、使い終えた入力欄が空になることも見る。
 *     「暗号化した書き出しを開く」で、データベース・GAS に触らずに元の ZIP を保存できることも確かめる
 *   ・データベースの偽物は、0025 の export_begin（p_encrypted・p_plain_reason）と 0024 の export_page・export_finish と同じ形で返す
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
import { loadCrypt } from './export-decrypt.mjs';

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
      if (rpc[1] === 'export_begin' && state.no0025) return send(404, { code: 'PGRST202', message: 'Could not find the function public.export_begin(p_encrypted) in the schema cache' });
      if (rpc[1] === 'export_begin') {
        state.begin = a;
        /* 0025 と同じ断り: 暗号化の有無が無い・暗号化しないのに理由が 5〜200 文字でない → 22023 */
        if (typeof a.p_encrypted !== 'boolean' ||
            (a.p_encrypted === false && !(typeof a.p_plain_reason === 'string' && a.p_plain_reason.trim().length >= 5 && a.p_plain_reason.trim().length <= 200))) {
          return send(400, { code: '22023', message: 'reason' });
        }
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
const PASS = 'kakuu-pass-0001';   // 架空のパスフレーズ
const X = loadCrypt();
async function openPage({ role = 'office', mfa = true, dialog = 'accept', denyAll = false, no0025 = false, noCrypt = false, viewport = { width: 1280, height: 900 } } = {}) {
  const state = { calls: [], pages: [], gas: [], finish: null, begin: null, denyAll, no0025, dialogs: [], errors: [], posts: [] };
  const context = await browser.newContext({ acceptDownloads: true, viewport });
  await context.route('**/su-auth.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fakeAuth(mfa) }));
  /* 暗号の部品が読み込めなかった端末の真似（中身の無いスクリプトを返す） */
  if (noCrypt) await context.route('**/su-export-crypt.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* 読み込めなかった */' }));
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
  page.on('request', (r) => { if (r.method() === 'POST') state.posts.push(String(r.postData() || '')); });
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
    t('既定は「暗号化する」が選ばれていて、パスフレーズの2欄が出る', await page.isChecked('#ex-enc-on') && await page.isVisible('#ex-pass') && await page.isVisible('#ex-pass2') && !(await page.isVisible('#ex-reason')), '');
    t('パスフレーズの欄（開く方も）は type=password・autocomplete=new-password', await page.evaluate(() => ['ex-pass', 'ex-pass2', 'dx-pass'].every((id) => {
      const e = document.getElementById(id); return e.type === 'password' && e.getAttribute('autocomplete') === 'new-password'; })), '');
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.locator('#sec-export').screenshot({ path: path.join(shots, 'export-before.png') }); }
    await page.fill('#ex-pass', PASS);
    await page.fill('#ex-pass2', PASS);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#b-export')]);
    const epath = path.join(tmp, dl.suggestedFilename());   // 画面で開く時の名前の扱いも見るため、保存された名前のまま置く
    await dl.saveAs(epath);
    const sealed = fs.readFileSync(epath);
    t('保存物は暗号ファイル（印 SUEXP2 で始まり、ZIP の印 PK では始まらない）', sealed.subarray(0, 8).equals(Buffer.from('SUEXP2\n\0', 'latin1')) && sealed.indexOf(Buffer.from('PK\u0003\u0004', 'latin1')) !== 0, sealed.subarray(0, 8));
    const plainZip = Buffer.concat((await X.decrypt(sealed, PASS)).map((c) => Buffer.from(c)));
    const zpath = path.join(tmp, 'c.zip');
    fs.writeFileSync(zpath, plainZip);
    t('違うパスフレーズでは戻せない', await X.decrypt(sealed, PASS + '!').then(() => false, (e) => e.code === 'auth'), '');
    /* ターミナルの道具でも戻せる（パスフレーズは試験用の環境変数だけ・端末に値を出さない） */
    const tpath = path.join(tmp, 'tool.zip');
    const toolOut = execFileSync(process.execPath, [path.join(repoDir, 'check', 'export-decrypt.mjs'), epath, '-o', tpath],
      { env: Object.assign({}, process.env, { SU_EXPORT_PASS: PASS }), stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    t('ターミナルの道具（export-decrypt.mjs）で戻すと、同じ ZIP になる', fs.readFileSync(tpath).equals(plainZip), fs.statSync(tpath).size);
    t('ターミナルの道具は値・パスフレーズを出さない', !toolOut.includes(PASS), toolOut);
    let toolNg = '';
    try { execFileSync(process.execPath, [path.join(repoDir, 'check', 'export-decrypt.mjs'), epath, '-o', path.join(tmp, 'ng.zip')],
      { env: Object.assign({}, process.env, { SU_EXPORT_PASS: 'wrong-pass-00' }), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { toolNg = String(e.stderr || '') + '#' + e.status; }
    t('ターミナルの道具: 違うパスフレーズは「パスフレーズが違うか…」で止まり、何も書かない', /パスフレーズが違うか/.test(toolNg) && /#1$/.test(toolNg) && !fs.existsSync(path.join(tmp, 'ng.zip')), toolNg);
    await page.waitForFunction(() => document.getElementById('ex-msg').className.includes('ok') && document.querySelectorAll('#ex-runs li').length === 1, null, { timeout: 15000 });
    const msgText = await page.textContent('#ex-msg');
    if (shots) await page.locator('#sec-export').screenshot({ path: path.join(shots, 'export-after.png') });
    t('始める前に個人情報の注意を出した（暗号化してパスフレーズが要る旨）', state.dialogs.length === 1 && /個人情報/.test(state.dialogs[0]) && /パスフレーズ/.test(state.dialogs[0]) && !/鍵はかかりません/.test(state.dialogs[0]), state.dialogs);
    t('ファイル名は「全データ_日時.zip.suenc」', /^全データ_\d{8}-\d{4}\.zip\.suenc$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    t('export_begin に「暗号化する」が届き、理由は送らない', state.begin && state.begin.p_encrypted === true && !('p_plain_reason' in state.begin), state.begin);
    t('使い終えたパスフレーズの欄は空', (await page.inputValue('#ex-pass')) === '' && (await page.inputValue('#ex-pass2')) === '', '');
    const store = await page.evaluate(() => { const o = []; for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) { const k = s.key(i); o.push(k + '=' + s.getItem(k)); } return o.join('\n'); });
    t('パスフレーズは localStorage・sessionStorage に残らない', !store.includes(PASS), store.length);
    t('パスフレーズはどこにも送らない（データベース・GAS への送信の本文に無い）', state.posts.length > 0 && state.posts.every((b) => !b.includes(PASS)), state.posts.length);
    t('同期データは 2000 行ずつ3回に分けて読んだ', ['kv_entries@0', 'kv_entries@2000', 'kv_entries@4000'].every((x) => state.pages.includes(x)) && state.pages.filter((x) => x.startsWith('kv_entries')).length === 3, state.pages);
    t('呼んだ順: 始める → 表ごと → 終える', state.calls[0] === 'export_begin' && state.calls[state.calls.length - 1] === 'export_finish', state.calls);
    t('終わりの記録: 受け取った件数が数えた件数と同じ・GAS の分・ファイル名',
      JSON.stringify(state.finish.p_got) === JSON.stringify(state.run.db_counts) && state.finish.p_file === dl.suggestedFilename() &&
      state.finish.p_gas['体重管理'].ok === true && state.finish.p_gas['体重管理'].count === 2 && state.finish.p_gas['ジェノグラム（家族構成図）'].ok === false, state.finish);
    t('終わりの記録に合言葉・接続先の URL は入らない', !/tok-|script\.google/.test(JSON.stringify(state.finish)), '');
    t('GAS: 接続設定のある2系統だけに送った（POST・text/plain・合言葉は本文だけ）',
      state.gas.length === 2 && state.gas.every((g) => /text\/plain/.test(g.ct) && !/tok-/.test(g.url) && /"token":"tok-/.test(g.body)), state.gas.map((g) => g.url));
    t('画面: 保存した旨と件数（4,504 行・Google 2 / 8 系統）を出す', /\.suenc」を保存しました/.test(msgText) && /4504 行/.test(msgText) && /Google 2 \/ 8 系統/.test(msgText), msgText);
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

    console.log('\n— 1b. 暗号化した書き出しを、この画面で開く（データベース・GAS には触らない）—');
    const before = { calls: state.calls.length, gas: state.gas.length, posts: state.posts.length };
    await page.setInputFiles('#dx-file', epath);
    await page.fill('#dx-pass', PASS + 'x');
    await page.click('#b-decrypt');
    await page.waitForFunction(() => document.getElementById('dx-msg').textContent !== '', null, { timeout: 15000 });
    t('違うパスフレーズ: 「パスフレーズが違うか、ファイルが壊れています。」と出し、欄を空にする',
      (await page.textContent('#dx-msg')) === 'パスフレーズが違うか、ファイルが壊れています。' && (await page.inputValue('#dx-pass')) === '', await page.textContent('#dx-msg'));
    if (shots) await page.locator('#sec-decrypt').screenshot({ path: path.join(shots, 'decrypt-ng.png') });
    await page.fill('#dx-pass', PASS);
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#b-decrypt')]);
    const opath = path.join(tmp, 'opened.zip');
    await dl2.saveAs(opath);
    t('開いた ZIP の名前は .suenc を外した名前', dl2.suggestedFilename() === dl.suggestedFilename().replace(/\.suenc$/, ''), dl2.suggestedFilename());
    t('画面で開いた ZIP は、Node で戻した ZIP と1バイトも違わない', fs.readFileSync(opath).equals(plainZip), fs.statSync(opath).size);
    await page.waitForFunction(() => /保存しました/.test(document.getElementById('dx-msg').textContent), null, { timeout: 15000 });
    t('開いた後、パスフレーズの欄は空', (await page.inputValue('#dx-pass')) === '', '');
    t('開く時はデータベースにも GAS にも送らない', state.calls.length === before.calls && state.gas.length === before.gas && state.posts.length === before.posts, [state.calls.length - before.calls, state.gas.length - before.gas]);
    const store2 = await page.evaluate(() => { const o = []; for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) { const k = s.key(i); o.push(k + '=' + s.getItem(k)); } return o.join('\n'); });
    t('開いた後も、パスフレーズは localStorage・sessionStorage に残らない', !store2.includes(PASS), '');
    t('画面のエラーなし（開く時）', state.errors.length === 0, state.errors);
    if (shots) await page.locator('#sec-decrypt').screenshot({ path: path.join(shots, 'decrypt-ok.png') });
    await context.close();
  }

  console.log('\n— 1c. 暗号化しないを選ぶ（理由が要る・記録に届く）—');
  {
    const { context, page, state } = await openPage();
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    await page.check('#ex-enc-off');
    t('「暗号化しない」を選ぶと、理由の欄と注意の文が出て、パスフレーズの欄は隠れる',
      await page.isVisible('#ex-reason') && /鍵はかかりません/.test(await page.textContent('#ex-plain-box')) && !(await page.isVisible('#ex-pass')), '');
    if (shots) await page.locator('#sec-export').screenshot({ path: path.join(shots, 'export-plain.png') });
    await page.click('#b-export');
    await page.waitForTimeout(400);
    t('理由が空: 確かめも出さず始めない（データベース・GAS に送らない）', state.dialogs.length === 0 && !state.calls.includes('export_begin') && state.gas.length === 0, state.calls);
    t('理由が空: 理由を書くよう出す', /理由を 5〜200 文字/.test(await page.textContent('#ex-msg')), await page.textContent('#ex-msg'));
    await page.fill('#ex-reason', '  移行  ');
    await page.click('#b-export');
    await page.waitForTimeout(400);
    t('理由が短い（前後の空白を除いて 4 文字）: 始めない', !state.calls.includes('export_begin'), state.calls);
    const REASON = '税理士へ渡す試験の控え（架空）';
    await page.fill('#ex-reason', REASON);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#b-export')]);
    const zp = path.join(tmp, 'plain.zip');
    await dl.saveAs(zp);
    await page.waitForFunction(() => document.getElementById('ex-msg').className.includes('ok'), null, { timeout: 15000 });
    t('確かめの文は「鍵はかかりません」', state.dialogs.length === 1 && /鍵はかかりません/.test(state.dialogs[0]), state.dialogs);
    t('export_begin に「暗号化しない」と理由が届く', state.begin && state.begin.p_encrypted === false && state.begin.p_plain_reason === REASON, state.begin);
    t('保存物は ZIP（.zip・印 PK）で、終わりの記録のファイル名も同じ', /^全データ_\d{8}-\d{4}\.zip$/.test(dl.suggestedFilename()) &&
      fs.readFileSync(zp).subarray(0, 4).equals(Buffer.from('PK\u0003\u0004', 'latin1')) && state.finish && state.finish.p_file === dl.suggestedFilename(), dl.suggestedFilename());
    await context.close();
  }

  console.log('\n— 1d. パスフレーズが短い・合わない時は始めない／0025 が無い時 —');
  {
    const { context, page, state } = await openPage();
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    await page.fill('#ex-pass', 'short7c'); await page.fill('#ex-pass2', 'short7c');
    await page.click('#b-export');
    await page.waitForTimeout(300);
    t('7 文字: 始めない・8 文字以上と出す・欄を空にする', !state.calls.includes('export_begin') && state.dialogs.length === 0 &&
      /8 文字以上/.test(await page.textContent('#ex-msg')) && (await page.inputValue('#ex-pass')) === '', await page.textContent('#ex-msg'));
    await page.fill('#ex-pass', PASS); await page.fill('#ex-pass2', PASS + 'x');
    await page.click('#b-export');
    await page.waitForTimeout(300);
    t('2つが合わない: 始めない・一致しないと出す・欄を空にする', !state.calls.includes('export_begin') && state.dialogs.length === 0 &&
      /一致しません/.test(await page.textContent('#ex-msg')) && (await page.inputValue('#ex-pass2')) === '', await page.textContent('#ex-msg'));
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ noCrypt: true });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    await page.fill('#ex-pass', PASS); await page.fill('#ex-pass2', PASS);
    await page.click('#b-export');
    await page.waitForTimeout(300);
    t('暗号の部品が無い端末: export_begin を呼ぶ前に断る（確かめも出さない・GAS に送らない）・欄を空にする',
      !state.calls.includes('export_begin') && state.dialogs.length === 0 && state.gas.length === 0 && /暗号化を扱えません/.test(await page.textContent('#ex-msg')) &&
      (await page.inputValue('#ex-pass')) === '' && (await page.inputValue('#ex-pass2')) === '', await page.textContent('#ex-msg'));
    await page.fill('#dx-pass', PASS);
    await page.click('#b-decrypt');
    await page.waitForTimeout(300);
    t('暗号の部品が無い端末: 開く方も断り、欄を空にする', /暗号化を扱えません/.test(await page.textContent('#dx-msg')) && (await page.inputValue('#dx-pass')) === '', await page.textContent('#dx-msg'));
    t('暗号の部品が無い端末: 画面のエラーなし', state.errors.length === 0, state.errors);
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ no0025: true });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    let downloaded = false; page.on('download', () => { downloaded = true; });
    await page.fill('#ex-pass', PASS); await page.fill('#ex-pass2', PASS);
    await page.click('#b-export');
    await page.waitForFunction(() => /0025/.test(document.getElementById('ex-msg').textContent), null, { timeout: 15000 });
    t('データベースに 0025 が無い（PGRST202）: 「書き出しの準備（データベースの 0025）がまだできていません。」・保存しない・GAS に送らない',
      (await page.textContent('#ex-msg')) === '書き出しの準備（データベースの 0025）がまだできていません。' && !downloaded && state.gas.length === 0, await page.textContent('#ex-msg'));
    t('失敗の後もパスフレーズの欄は空', (await page.inputValue('#ex-pass')) === '' && (await page.inputValue('#ex-pass2')) === '', '');
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
    await page.click('#b-decrypt');
    await page.waitForTimeout(300);
    t('現場の端末: 暗号化した書き出しも開かない（理由を出す）', /現場/.test(await page.textContent('#dx-msg')), await page.textContent('#dx-msg'));
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ dialog: 'dismiss' });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    await page.fill('#ex-pass', PASS); await page.fill('#ex-pass2', PASS);
    await page.click('#b-export');
    await page.waitForTimeout(500);
    t('注意の確かめで「キャンセル」: 何も読まない・保存しない', state.dialogs.length === 1 && !state.calls.includes('export_begin') && state.gas.length === 0, state.calls);
    t('キャンセルの後、パスフレーズの欄は空', (await page.inputValue('#ex-pass')) === '' && (await page.inputValue('#ex-pass2')) === '', '');
    await context.close();
  }
  {
    const { context, page, state } = await openPage({ denyAll: true });
    await page.waitForSelector('#sec-export:not([hidden])', { timeout: 15000 });
    let downloaded = false; page.on('download', () => { downloaded = true; });
    await page.fill('#ex-pass', PASS); await page.fill('#ex-pass2', PASS);
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
    const hs = await page.evaluate(() => ['ex-enc-on', 'ex-enc-off'].map((id) => document.querySelector('label[for="' + id + '"]').getBoundingClientRect().height)
      .concat([document.getElementById('b-decrypt').getBoundingClientRect().height, document.getElementById('ex-pass').getBoundingClientRect().height]));
    t('iPhone の幅: 暗号化の選択・パスフレーズの欄・開くボタンも 44px 以上', hs.every((h) => h >= 44), hs);
    if (shots) await page.locator('#sec-decrypt').screenshot({ path: path.join(shots, 'decrypt-iphone.png') });
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
