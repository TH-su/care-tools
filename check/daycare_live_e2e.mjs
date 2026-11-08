/* check/daycare_live_e2e.mjs — デイ利用表を「接続先・合言葉の無い端末」で開く通し試験（2026-11-08 新設）
 *   node check/daycare_live_e2e.mjs [--shots <保存先>]
 *
 * 何を守るか（代表者の決定 2026-11-08「端末ごとの設定を極限までなくす」）:
 *   1. 接続先・合言葉の無い事務所PCでも、事務所のアカウントでログインしていて週間計画を新しい保存先へ切り替えた後なら、
 *      開いた時に週間計画を新しい保存先（kv_get）から読み、利用表に架空の方が並ぶ。「接続先がまだ入っていません」の案内は出さない
 *   2. 昼食薬のチェック（本物のチェック欄を押す）は新しい保存先（kv_put）へ保存し、Google へは1本も送らない
 *   3. 入院・居室の重ね読みは、入居者マスタの接続先が無くても名簿の口（res_roster）で読みに行く（Google へは送らない）
 *   4. ログインしていない端末・スイッチが切の端末は今までどおり: 案内が出て、新しい保存先にも Google にも読みに行かない
 *   5. 現場の端末（現場のアカウント）は読めるが、チェックは押せない（見るだけ）
 *   6. フェイスシートの ☁️設定 の合言葉の欄は伏せ字で、保存した合言葉を入れて開かない（空欄のまま保存しても今のまま）
 *   7. 訪問俯瞰・全支援俯瞰は、別のタブで端末の用途が変わったら読み込み直す（CLAUDE.md §2-5）
 * ★通信は全部横取りする（外へは出ない）。データは check/fixtures/flow.mjs の架空の入居者だけ。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';
import * as F from './fixtures/flow.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots ? path.resolve(args.shots) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info).slice(0, 400))); }
}
async function waitFor(fn, timeout = 15000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

const srv = await startServer(repoDir);
const browser = await chromium.launch();
const FLAGS_ON = { supabase: { ...F.FLAGS_OFF.supabase, care_schedule_v2: true, master_live: true } };
const NAMES = F.masterRecords().map((r) => r.name);

/* 1台の端末。device＝端末の用途、role＝ログインのアカウントの役割（null＝ログインしていない）、flags＝su-backend.json */
async function run({ device = 'office', role = 'office', flags = FLAGS_ON, label }) {
  const st = { sb: [], gas: [], ext: [], errors: [], kv: { rev: 3, data: F.careDb() }, puts: [] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  const s = F.storage(device);
  delete s.rmaster_cfg; delete s.su_sync_common; delete s.ws_settings;   // 接続先・合言葉の無い端末
  if (!role) delete s['sb-jhbernqawjrzqwrmqrih-auth-token'];
  s.su_backend_flags = JSON.stringify(flags);
  await context.addInitScript((x) => { try { if (localStorage.getItem('__seeded') === '1') return; for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); localStorage.setItem('__seeded', '1'); } catch (e) {} }, s);
  const base = F.supabase(st, role || 'office');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) });
      return route.continue();
    }
    if (u.startsWith('https://script.google.com/')) { st.gas.push(u.slice(0, 80)); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"test"}' }); }
    if (u.startsWith(F.SB + '/')) {
      const m = /\/rest\/v1\/rpc\/(kv_get|kv_put|kv_head|res_mode_get|res_roster)$/.exec(new URL(u).pathname);
      if (!m || req.method() === 'OPTIONS') return base(route);
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      st.sb.push(req.method() + ' /rest/v1/rpc/' + m[1]);
      let out;
      if (m[1] === 'kv_get' && st.kvFail) return route.fulfill({ status: 500, contentType: 'application/json', headers: cors, body: '{"message":"test"}' });
      if (m[1] === 'kv_get') out = { ok: true, rev: st.kv.rev, data: st.kv.data, updatedAt: '' };
      else if (m[1] === 'kv_head') out = { revs: { [b.p_keys && b.p_keys[0]]: st.kv.rev } };
      else if (m[1] === 'kv_put') {
        if (Number(b.p_rev) !== st.kv.rev) out = { ok: false, conflict: true, rev: st.kv.rev };
        else { st.kv.rev += 1; st.kv.data = b.p_data; st.puts.push(b.p_data); out = { ok: true, rev: st.kv.rev }; }
      }
      else if (m[1] === 'res_mode_get') out = { mode: 'live', stateRev: 1 };
      else out = { ok: true, rows: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 120));
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200)));
  await page.goto(srv.url + '/daycare-roster.html', { waitUntil: 'load' });
  return { page, st, context, label };
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const NOCFG = '週間計画の接続先（Google の受け口の URL と合言葉）がまだ入っていません';

/* 1〜3: 事務所PC・事務所のアカウント・切り替えた後 */
{
  const E = await run({ label: '事務所PC' });
  const listed = await waitFor(async () => { const tx = await bodyText(E.page); return NAMES.some((n) => tx.includes(n)) ? tx : null; });
  t('事務所PC: 接続先が無くても週間計画を新しい保存先から読み、架空の方が利用表に並ぶ', !!listed);
  t('事務所PC: 読んだのは新しい保存先（kv_get）', E.st.sb.includes('POST /rest/v1/rpc/kv_get'), E.st.sb);
  const tx = await bodyText(E.page);
  t('事務所PC: 「接続先がまだ入っていません」の案内を出さない', !tx.includes(NOCFG));
  t('事務所PC: 状態は「取得OK」', /取得OK（\d+名）/.test(await E.page.textContent('#syncState')), await E.page.textContent('#syncState'));
  const roster = await waitFor(() => E.st.sb.includes('POST /rest/v1/rpc/res_roster'));
  t('事務所PC: 入院・居室の重ね読みは名簿の口（res_roster）で読む', !!roster, E.st.sb);
  if (shots) await E.page.screenshot({ path: path.join(shots, 'daycare-live-office.png') });
  // 昼食薬のチェックを本物の画面の操作で押す
  await E.page.click('#tnav [data-sc="sc-med"]');
  const cb = E.page.locator('#chkMed input[type=checkbox]').first();
  await cb.waitFor({ state: 'visible', timeout: 10000 });
  const was = await cb.isChecked();
  await cb.click();
  const put = await waitFor(() => E.st.puts.length > 0);
  t('事務所PC: 昼食薬のチェックは新しい保存先（kv_put）へ保存する', !!put, E.st.sb);
  const before = F.careDb().residents.filter((r) => !!r.lunchMed).length;
  const after = put ? E.st.puts[0].residents.filter((r) => !!r.lunchMed).length : -1;
  t('事務所PC: 保存した中身で1名だけ昼食薬が変わっている', after === before + (was ? -1 : 1), { before, after });
  // 一度読み損なっても（遅い回線の時間切れ等）「ログインだけで使える」は外さず、取得の失敗として知らせ、次のチェックも保存できる（反証レビュー 2026-11-08）
  E.st.kvFail = true;
  await E.page.click('#btnRefresh');
  const failed = await waitFor(async () => /取得失敗/.test(await E.page.textContent('#syncState')));
  t('事務所PC: 読み損なった時は「取得失敗」と出す', !!failed, await E.page.textContent('#syncState'));
  E.st.kvFail = false;
  const nPut = E.st.puts.length;
  await E.page.locator('#chkMed input[type=checkbox]').nth(1).click();
  const put2 = await waitFor(() => E.st.puts.length > nPut);
  t('事務所PC: 読み損なった後も、次のチェックは新しい保存先へ保存する（接続先を入れる案内を出さない）', !!put2 && !(await bodyText(E.page)).includes('接続先のURLと合言葉を入れてください'), E.st.sb.slice(-4));
  t('事務所PC: Google へは1本も送らない', E.st.gas.length === 0, E.st.gas);
  t('事務所PC: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}

/* 4: ログインしていない端末・スイッチが切の端末は今までどおり */
for (const c of [
  { label: 'ログインしていない端末', role: null },
  { label: 'スイッチが切の端末', flags: { supabase: { ...F.FLAGS_OFF.supabase } } },
]) {
  const E = await run(c);
  const guide = await waitFor(async () => (await bodyText(E.page)).includes(NOCFG));
  t(c.label + ': 今までどおり「接続先がまだ入っていません」の案内が出る', !!guide);
  await E.page.waitForTimeout(800);
  t(c.label + ': 週間計画を新しい保存先に読みに行かない', !E.st.sb.includes('POST /rest/v1/rpc/kv_get'), E.st.sb);
  t(c.label + ': Google へも送らない', E.st.gas.length === 0, E.st.gas);
  t(c.label + ': 状態は「データなし」のまま（「クラウドにデータなし」と言わない）', (await E.page.textContent('#syncState')) === 'データなし', await E.page.textContent('#syncState'));
  t(c.label + ': 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}

/* 5: 現場の端末（現場のアカウント）は読めるが、チェックは押せない */
{
  const E = await run({ label: '現場の端末', device: 'field', role: 'field' });
  const ok = await waitFor(async () => /取得OK（\d+名）/.test(await E.page.textContent('#syncState')));
  t('現場の端末: ログインしていれば週間計画を読める（取得OK）', !!ok && E.st.sb.includes('POST /rest/v1/rpc/kv_get'), E.st.sb);
  await E.page.click('#tnav [data-sc="sc-med"]');
  const dis = await waitFor(async () => { const n = await E.page.locator('#chkMed input[type=checkbox]').count(); return n && E.page.locator('#chkMed input[type=checkbox]').first().isDisabled(); });
  t('現場の端末: 昼食薬のチェックは押せない（見るだけ）', !!dis);
  t('現場の端末: 保存（kv_put）を送らない', !E.st.sb.includes('POST /rest/v1/rpc/kv_put'), E.st.sb);
  t('現場の端末: Google へは送らない', E.st.gas.length === 0, E.st.gas);
  t('現場の端末: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}

/* 6: フェイスシートの ☁️設定 の合言葉の欄は伏せ字で、保存した合言葉を入れて開かない。空欄のまま保存しても合言葉は今のまま */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  const s = F.storage('office');
  s.su_backend_flags = JSON.stringify(F.FLAGS_OFF);
  await context.addInitScript((x) => { try { if (localStorage.getItem('__seeded') === '1') return; for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); localStorage.setItem('__seeded', '1'); } catch (e) {} }, s);
  const ext = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.FLAGS_OFF) });
      return route.continue();
    }
    if (u.startsWith('https://script.google.com/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"roster":[]}' });
    if (u.startsWith(F.SB + '/')) return F.supabase(null)(route);
    ext.push(u.slice(0, 120)); return route.abort();
  });
  const page = await context.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message).slice(0, 200)));
  await page.goto(srv.url + '/facesheet.html', { waitUntil: 'load' });
  await page.click('button[data-sc="sync"]');
  await page.waitForSelector('#mSync.on', { timeout: 10000 });
  const tok = await page.evaluate(() => ({ type: document.getElementById('cfgToken').type, value: document.getElementById('cfgToken').value }));
  t('フェイスシート: 合言葉の欄は伏せ字（password）', tok.type === 'password', tok.type);
  t('フェイスシート: 保存した合言葉を欄に入れて開かない', tok.value === '', tok.value.length);
  await page.click('#syncSave');
  await page.waitForTimeout(800);
  const kept = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rmaster_cfg')).token; } catch (e) { return null; } });
  t('フェイスシート: 空欄のまま保存しても、合言葉は今のまま残る', kept === 'check-flow', kept);
  t('フェイスシート: 画面のエラーなし・外への通信なし', !errs.length && !ext.length, [errs, ext]);
  await context.close();
}

/* 7: 訪問俯瞰・全支援俯瞰は、別のタブで端末の用途が変わったら読み込み直す（CLAUDE.md §2-5） */
for (const pg of ['visit-overview.html', 'support-overview.html']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const s = F.storage('office');
  delete s.su_sync_common; delete s.ws_settings; delete s.rmaster_cfg; delete s['sb-jhbernqawjrzqwrmqrih-auth-token'];
  await context.addInitScript((x) => { try { if (localStorage.getItem('__seeded') === '1') return; for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); localStorage.setItem('__seeded', '1'); } catch (e) {} }, s);
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.FLAGS_OFF) });
      return route.continue();
    }
    return route.abort();
  });
  const a = await context.newPage();
  await a.goto(srv.url + '/' + pg, { waitUntil: 'load' });
  let reloaded = 0;
  a.on('framenavigated', (f) => { if (f === a.mainFrame()) reloaded++; });
  const b = await context.newPage();
  await b.goto(srv.url + '/' + pg, { waitUntil: 'load' });
  await b.evaluate(() => localStorage.setItem('su_device_role', 'field'));
  const ok = await waitFor(() => reloaded > 0, 5000);
  t(pg + ': 別のタブで現場用に変わったら読み込み直す', !!ok, reloaded);
  reloaded = 0;
  await b.evaluate(() => localStorage.setItem('su_device_role', 'field'));   // 同じ値の書き直しでは読み込み直さない
  await a.waitForTimeout(800);
  t(pg + ': 用途が変わらない書き直しでは読み込み直さない', reloaded === 0, reloaded);
  await context.close();
}

await browser.close();
srv.close && srv.close();
console.log('\n合格 ' + pass + ' / 失敗 ' + fail);
process.exit(fail ? 1 : 0);
