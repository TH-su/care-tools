/* check/overview_live_e2e.mjs — 訪問俯瞰・全支援俯瞰を「接続先・合言葉の無い端末」で開く通し試験（2026-11-12 新設）
 *   node check/overview_live_e2e.mjs [--shots <保存先>]
 *
 * 何を守るか（代表者の決定 2026-11-08 A「ログインしていれば接続先・合言葉なしで動く」・check/daycare_live_e2e.mjs と同じ守り）:
 *   1. 接続先の無い事務所PCでも、ログインしていて週間計画・ワークスケジュールを新しい保存先へ切り替えた後なら、
 *      全支援俯瞰は開いた時に新しい保存先から読んで盤面を出す（「接続先が入っていません」で止まらない）。Google へは1本も送らない
 *   2. 読めて盤面が出ている時は、画面の下の「接続先が入っていません」の帯（su-cfg-hint.js）を出さない（訪問俯瞰も）
 *   3. ログインしていない端末・スイッチが切の端末は今までどおり何も読みに行かず、接続先が無い時の文は全支援俯瞰と同じ文と接続設定へのリンクにそろえる。
 *      訪問俯瞰の状態の欄は、接続先が無い時（未設定）と本当に空の時（クラウドにデータなし）を分ける
 *   4. 現場の端末（現場のアカウント）は読めるが、氏名は姓だけ（フルネームを出さない）・接続設定へのリンクは出さない
 *   5. 8秒で時間切れ・時間切れの後に届いた答えは使わない・端末に週間計画・盤面を書かない
 *   6. 接続先がある端末は今までどおり（全支援俯瞰はログインしていれば新しい保存先から読む）
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
const FLAGS_ON = { supabase: { ...F.FLAGS_OFF.supabase, care_schedule_v2: true, wsday: true } };
const NAMES = F.masterRecords().map((r) => r.name);
/* ワークスケジュールの日の盤面（架空）。どの日の鍵でも同じ盤面を返す（日付の計算を試験に持たない） */
const DAY = {
  columns: [{ id: 'c1', zone: 'visit', staffIds: ['s1'] }],
  tasks: NAMES.slice(0, 4).map((n, i) => ({ id: 'tk' + i, kind: 'care', staffId: 's1', start: 600 + i * 60, end: 630 + i * 60, residentName: n, svcCode: '身体１' })),
};
const NO_TARGET = '週間計画・ワースケ・シフトの接続先が入っていません。接続設定の「週間計画・ワースケ・シフト」の欄に、接続先のURLと合言葉を入れてください。';
const NO_TARGET_FIELD = 'この端末には週間計画・ワースケ・シフトの接続先が入っていません。事務所に知らせてください。';

/* 1台の端末。device＝端末の用途、role＝ログインのアカウントの役割（null＝ログインしていない）、flags＝su-backend.json、
   withCfg＝接続先を入れてある端末、care＝新しい保存先の週間計画（null＝空）、delayMs＝新しい保存先の答えを遅らせる */
async function run(pg, { device = 'office', role = 'office', flags = FLAGS_ON, withCfg = false, care, delayMs = 0, label }) {
  const st = { sb: [], gas: [], gasReq: [], ext: [], selfPost: [], errors: [] };
  const careData = care === undefined ? F.careDb() : care;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  const s = F.storage(device);
  delete s.rmaster_cfg;
  if (!withCfg) { delete s.su_sync_common; delete s.ws_settings; }   // 接続先・合言葉の無い端末
  if (!role) delete s['sb-jhbernqawjrzqwrmqrih-auth-token'];
  s.su_backend_flags = JSON.stringify(flags);
  await context.addInitScript((x) => { try { if (localStorage.getItem('__seeded') === '1') return; for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); localStorage.setItem('__seeded', '1'); } catch (e) {} }, s);
  const base = F.supabase(st, role || 'office');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const later = (fn) => (delayMs ? new Promise((r) => setTimeout(r, delayMs)).then(fn) : fn());
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (req.method() === 'POST') { st.selfPost.push(u.slice(srv.url.length, srv.url.length + 80)); return route.fulfill({ status: 405, body: '' }); }
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) });
      return route.continue();
    }
    if (u.startsWith('https://script.google.com/')) {
      st.gas.push(req.method() + ' ' + u.slice(0, 80));
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      st.gasReq.push({ url: u, method: req.method(), ctype: req.headers()['content-type'] || '', body: b });
      let out = { ok: false, error: 'test' };
      if (b.action === 'get' && b.key === 'care_schedule_v2') out = { ok: true, rev: 1, data: careData };
      else if (b.action === 'get') out = { ok: true, rev: 1, data: DAY };
      else if (b.action === 'pull') { const entries = {}; (b.keys || []).forEach((k) => { entries[k] = { key: k, rev: 1, data: DAY }; }); out = { ok: true, entries }; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    if (u.startsWith(F.SB + '/')) {
      if (req.method() === 'OPTIONS') return base(route);
      const p = new URL(u).pathname;
      const m = /\/rest\/v1\/rpc\/kv_get$/.test(p);
      if ((m || /\/rest\/v1\/kv_entries$/.test(p)) && st.kvFail) { st.sb.push('fail ' + p.split('/').pop()); return route.fulfill({ status: 500, contentType: 'application/json', headers: cors, body: '{"message":"test"}' }); }
      if (m) {
        let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
        st.sb.push('kv_get ' + b.p_key);
        const out = b.p_key === 'care_schedule_v2' ? { ok: true, rev: 3, data: careData, mode: 'live', updatedAt: '' } : { ok: true, rev: 1, data: DAY, mode: 'live', updatedAt: '' };
        return later(() => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) }));
      }
      if (/\/rest\/v1\/kv_entries$/.test(p)) {
        const q = new URL(u).searchParams.get('key') || '';
        const keys = (/^in\.\((.*)\)$/.exec(q) || [, ''])[1].split(',').map((k) => k.replace(/^"|"$/g, '')).filter(Boolean);
        st.sb.push('kv_entries ' + keys.length);
        const rows = keys.map((k) => ({ key: k, rev: 1, data: DAY, updated_at: '2026-11-12T00:00:00Z' }));
        return later(() => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(rows) }));
      }
      return base(route);
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 120));
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200)));
  const t0 = Date.now();
  await page.goto(srv.url + '/' + pg, { waitUntil: 'load' });
  return { page, st, context, label, t0 };
}
const lanes = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#board .b-lane, .b-lane')).map((l) => Array.from(l.querySelectorAll('.b-task')).map((c) => c.title)));
const stateOf = (page) => page.textContent('#syncState');
const hintOn = (page) => page.evaluate(() => !!document.getElementById('su-cfg-hint'));
const linkShown = (page) => page.evaluate(() => { const a = document.getElementById('emptyCsLink'); return !!a && !a.hidden && a.getAttribute('href') === 'connection-settings.html' && a.offsetParent !== null; });
const emptyMsg = (page) => page.textContent('#emptyMsg');
const fullNameShown = (L) => L.flat().some((x) => NAMES.some((n) => x.includes(n)));
const anyName = (L) => L.flat().some((x) => NAMES.some((n) => x.includes(n.split(' ')[0])));
const lsHasData = (page) => page.evaluate(() => Object.keys(localStorage).some((k) => k === 'care_schedule_v2' || /^wsday_/.test(k)));
/* 開いてから ms ミリ秒たつまで待つ（帯は開いて4秒後に確かめて出る） */
const untilSince = async (E, ms) => { const r = ms - (Date.now() - E.t0); if (r > 0) await E.page.waitForTimeout(r); };
/* 訪問俯瞰は開いた時に自動で読まない画面だったので、「更新」を押して読む（自動で読み始めていれば押しても重ねて読まない） */
const pressRefresh = async (page) => { try { if (!(await page.isDisabled('#btnRefresh'))) await page.click('#btnRefresh'); } catch (e) {} };

/* ═════ 全支援俯瞰 ═════ */
console.log('\n— 全支援俯瞰（support-overview.html） —');
{
  const E = await run('support-overview.html', { label: '事務所PC' });
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && fullNameShown(x) ? x : null; }, 20000);
  t('全支援俯瞰 事務所PC: 接続先が無くてもログインしていれば新しい保存先から読み、盤面に架空の方が出る', !!L, { state: await stateOf(E.page), sb: E.st.sb.slice(0, 6) });
  t('全支援俯瞰 事務所PC: 状態は「集計OK」', /^集計OK/.test(await stateOf(E.page)), await stateOf(E.page));
  t('全支援俯瞰 事務所PC: 「接続先が入っていません」の文を出さない', !(await emptyMsg(E.page)).includes('接続先が入っていません'), await emptyMsg(E.page));
  await untilSince(E, 7000);
  t('全支援俯瞰 事務所PC: 読めた時は画面の下の「接続先が入っていません」の帯を出さない', !(await hintOn(E.page)));
  t('全支援俯瞰 事務所PC: Google へは1本も送らない・この画面自身へも送らない', E.st.gas.length === 0 && E.st.selfPost.length === 0, [E.st.gas, E.st.selfPost]);
  t('全支援俯瞰 事務所PC: 端末に週間計画・盤面を書かない', !(await lsHasData(E.page)));
  t('全支援俯瞰 事務所PC: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  if (shots) await E.page.screenshot({ path: path.join(shots, 'overview-live-support-office.png') });
  await E.context.close();
}
for (const c of [
  { label: 'ログインしていない端末', role: null },
  { label: 'スイッチが切の端末', flags: { supabase: { ...F.FLAGS_OFF.supabase } } },
]) {
  const E = await run('support-overview.html', c);
  await untilSince(E, 2000);
  t('全支援俯瞰 ' + c.label + ': 今までどおり接続先が無い時の文と接続設定へのリンクを出す', (await emptyMsg(E.page)) === NO_TARGET && await linkShown(E.page), await emptyMsg(E.page));
  t('全支援俯瞰 ' + c.label + ': 状態は「未設定」', (await stateOf(E.page)) === '未設定', await stateOf(E.page));
  const hint = await waitFor(() => hintOn(E.page), 15000);
  t('全支援俯瞰 ' + c.label + ': 画面の下の帯は今までどおり出る', !!hint);
  t('全支援俯瞰 ' + c.label + ': 新しい保存先にも Google にも読みに行かない', !E.st.sb.some((x) => /^kv_/.test(x)) && E.st.gas.length === 0 && E.st.selfPost.length === 0, [E.st.sb, E.st.gas, E.st.selfPost]);
  t('全支援俯瞰 ' + c.label + ': 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}
{
  const E = await run('support-overview.html', { label: '現場の端末', device: 'field', role: 'field' });
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && anyName(x) ? x : null; }, 20000);
  t('全支援俯瞰 現場の端末: ログインしていれば読める', !!L, { state: await stateOf(E.page) });
  t('全支援俯瞰 現場の端末: フルネームを出さない（姓だけ）', !!L && !fullNameShown(L), L && L.flat().slice(0, 4));
  await untilSince(E, 7000);
  t('全支援俯瞰 現場の端末: 帯を出さない・接続設定へのリンクを出さない', !(await hintOn(E.page)) && !(await linkShown(E.page)));
  t('全支援俯瞰 現場の端末: Google へは送らない', E.st.gas.length === 0 && E.st.selfPost.length === 0, E.st.gas);
  t('全支援俯瞰 現場の端末: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}
{
  const E = await run('support-overview.html', { label: '接続先のある端末', withCfg: true });
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && fullNameShown(x) ? x : null; }, 20000);
  t('全支援俯瞰 接続先のある端末: 今までどおり盤面が出る（新しい保存先から読む）', !!L && E.st.sb.some((x) => /^kv_/.test(x)), { state: await stateOf(E.page), sb: E.st.sb.slice(0, 4) });
  t('全支援俯瞰 接続先のある端末: Google へは送らない（読めたため）', E.st.gas.length === 0, E.st.gas);
  t('全支援俯瞰 接続先のある端末: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}
{
  const E = await run('support-overview.html', { label: '答えが遅い端末', delayMs: 12000 });
  const st1 = await waitFor(async () => ((await stateOf(E.page)) === '未設定' ? '未設定' : null), 11000);
  t('全支援俯瞰 答えが遅い端末: 8秒で見切って「未設定」に戻る（取得中のまま止まらない）', !!st1, await stateOf(E.page));
  await untilSince(E, 15000);
  const L = await lanes(E.page);
  t('全支援俯瞰 答えが遅い端末: 時間切れの後に届いた答えで盤面を描かない', !anyName(L) && (await stateOf(E.page)) === '未設定', await stateOf(E.page));
  t('全支援俯瞰 答えが遅い端末: Google へは送らない・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length, [E.st.gas, E.st.errors]);
  await E.context.close();
}

{
  const E = await run('support-overview.html', { label: '読めていた端末' });
  await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && fullNameShown(x) ? x : null; }, 20000);
  E.st.kvFail = true;
  await E.page.click('#btnRefresh');
  const failed = await waitFor(async () => ((await stateOf(E.page)) === '取得失敗' ? 1 : null), 15000);
  t('全支援俯瞰 読めていた端末: 後で読めなくなった時は「取得失敗」', !!failed, await stateOf(E.page));
  const msg = await emptyMsg(E.page), toast = await E.page.textContent('#toast');
  t('全支援俯瞰 読めていた端末: 接続先を入れる逆の案内・リンクを出さない', !msg.includes('接続先が入っていません') && !msg.includes('接続先のURL') && !toast.includes('接続先') && !(await linkShown(E.page)), { msg, toast });
  t('全支援俯瞰 読めていた端末: 知らせ（toast）は通信とログインを確かめる文', toast === '取得に失敗しました。通信環境と、ログインしているかをご確認ください', toast);
  t('全支援俯瞰 読めていた端末: Google へもこの画面自身へも送らない・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length, [E.st.gas, E.st.selfPost, E.st.errors]);
  await E.context.close();
}
{
  const E = await run('support-overview.html', { label: '日ごとの盤面だけ切り替えていない端末', flags: { supabase: { ...F.FLAGS_OFF.supabase, care_schedule_v2: true } } });
  const settled = await waitFor(async () => ((await stateOf(E.page)) === '未設定' ? 1 : null), 20000);
  t('全支援俯瞰 日ごとの盤面だけ切り替えていない端末: 状態は「未設定」（ログインだけでは盤面を作れない）', !!settled, await stateOf(E.page));
  t('全支援俯瞰 日ごとの盤面だけ切り替えていない端末: 今までどおり接続先が無い時の文と接続設定へのリンクを出す', (await emptyMsg(E.page)) === NO_TARGET && await linkShown(E.page), await emptyMsg(E.page));
  t('全支援俯瞰 日ごとの盤面だけ切り替えていない端末: Google へもこの画面自身へも送らない・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length, [E.st.gas, E.st.selfPost, E.st.errors]);
  await E.context.close();
}

/* ═════ 訪問俯瞰 ═════ */
console.log('\n— 訪問俯瞰（visit-overview.html） —');
{
  const E = await run('visit-overview.html', { label: '事務所PC' });
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && fullNameShown(x) ? x : null; }, 15000);
  t('訪問俯瞰 事務所PC: 接続先が無くてもログインしていれば新しい保存先から読み、盤面に架空の方が出る', !!L, { state: await stateOf(E.page), sb: E.st.sb.slice(0, 4) });
  const okSt = await waitFor(async () => /^取得OK（\d+名）/.test(await stateOf(E.page)), 10000);   // 自動の取得の後に「更新」を押した時は、2回目の取得が終わるまで待つ
  t('訪問俯瞰 事務所PC: 状態は「取得OK」', !!okSt, await stateOf(E.page));
  await untilSince(E, 7000);
  t('訪問俯瞰 事務所PC: 読めた時は画面の下の「接続先が入っていません」の帯を出さない', !(await hintOn(E.page)));
  t('訪問俯瞰 事務所PC: Google へは1本も送らない・この画面自身へも送らない', E.st.gas.length === 0 && E.st.selfPost.length === 0, [E.st.gas, E.st.selfPost]);
  t('訪問俯瞰 事務所PC: 端末に週間計画を書かない', !(await lsHasData(E.page)));
  t('訪問俯瞰 事務所PC: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  if (shots) await E.page.screenshot({ path: path.join(shots, 'overview-live-visit-office.png') });
  await E.context.close();
}
for (const c of [
  { label: 'ログインしていない端末', role: null },
  { label: 'スイッチが切の端末', flags: { supabase: { ...F.FLAGS_OFF.supabase } } },
]) {
  const E = await run('visit-overview.html', c);
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  const st1 = await waitFor(async () => ((await stateOf(E.page)) === '未設定' ? 1 : null), 10000);
  t('訪問俯瞰 ' + c.label + ': 状態は「未設定」（「クラウドにデータなし」と言わない）', !!st1, await stateOf(E.page));
  t('訪問俯瞰 ' + c.label + ': 全支援俯瞰と同じ文と接続設定へのリンクを出す', (await emptyMsg(E.page)) === NO_TARGET && await linkShown(E.page), await emptyMsg(E.page));
  const toast = await E.page.textContent('#toast');
  t('訪問俯瞰 ' + c.label + ': 古い行き先の文「週間計画アプリで設定してください」を出さない', !toast.includes('週間計画アプリで設定') && !toast.includes('同期先が未設定'), toast);
  const hint = await waitFor(() => hintOn(E.page), 15000);
  t('訪問俯瞰 ' + c.label + ': 画面の下の帯は今までどおり出る', !!hint);
  t('訪問俯瞰 ' + c.label + ': 新しい保存先にも Google にも読みに行かない', !E.st.sb.some((x) => /^kv_/.test(x)) && E.st.gas.length === 0 && E.st.selfPost.length === 0, [E.st.sb, E.st.gas]);
  t('訪問俯瞰 ' + c.label + ': 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}
{
  const E = await run('visit-overview.html', { label: '現場の端末', device: 'field', role: 'field' });
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && anyName(x) ? x : null; }, 15000);
  t('訪問俯瞰 現場の端末: ログインしていれば読める', !!L, { state: await stateOf(E.page) });
  t('訪問俯瞰 現場の端末: フルネームを出さない（姓だけ）', !!L && !fullNameShown(L), L && L.flat().slice(0, 4));
  await untilSince(E, 7000);
  t('訪問俯瞰 現場の端末: 帯を出さない・接続設定へのリンクを出さない', !(await hintOn(E.page)) && !(await linkShown(E.page)));
  t('訪問俯瞰 現場の端末: Google へは送らない', E.st.gas.length === 0 && E.st.selfPost.length === 0, E.st.gas);
  t('訪問俯瞰 現場の端末: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}
{
  const E = await run('visit-overview.html', { label: '保存先が空の端末', care: null });
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  const st1 = await waitFor(async () => ((await stateOf(E.page)) === 'クラウドにデータなし' ? 1 : null), 10000);
  t('訪問俯瞰 保存先が空の端末: 読めたが空の時は「クラウドにデータなし」（未設定と分ける）', !!st1, await stateOf(E.page));
  t('訪問俯瞰 保存先が空の端末: 接続先を入れる文・リンクは出さない', !(await emptyMsg(E.page)).includes('接続先が入っていません') && !(await linkShown(E.page)), await emptyMsg(E.page));
  t('訪問俯瞰 保存先が空の端末: Google へは送らない・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length, [E.st.gas, E.st.errors]);
  await E.context.close();
}
{
  const E = await run('visit-overview.html', { label: '答えが遅い端末', delayMs: 12000 });
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  const st1 = await waitFor(async () => ((await stateOf(E.page)) === '未設定' ? 1 : null), 11000);
  t('訪問俯瞰 答えが遅い端末: 8秒で見切って「未設定」に戻る（取得中のまま止まらない）', !!st1, await stateOf(E.page));
  await untilSince(E, 15000);
  const L = await lanes(E.page);
  t('訪問俯瞰 答えが遅い端末: 時間切れの後に届いた答えで盤面を描かない', !anyName(L) && (await stateOf(E.page)) === '未設定', await stateOf(E.page));
  t('訪問俯瞰 答えが遅い端末: Google へは送らない・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length, [E.st.gas, E.st.errors]);
  await E.context.close();
}

{
  const E = await run('visit-overview.html', { label: '読めていた端末' });
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  await waitFor(async () => /^取得OK/.test(await stateOf(E.page)), 15000);
  E.st.kvFail = true;
  await E.page.click('#btnRefresh');
  const failed = await waitFor(async () => ((await stateOf(E.page)) === '取得失敗' ? 1 : null), 15000);
  t('訪問俯瞰 読めていた端末: 後で読めなくなった時は「取得失敗」', !!failed, await stateOf(E.page));
  const msg = await emptyMsg(E.page), toast = await E.page.textContent('#toast');
  t('訪問俯瞰 読めていた端末: 接続先を入れる逆の案内・リンクを出さない', !msg.includes('接続先が入っていません') && !toast.includes('接続先が入っていません') && !(await linkShown(E.page)), { msg, toast });
  t('訪問俯瞰 読めていた端末: Google へもこの画面自身へも送らない・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length, [E.st.gas, E.st.selfPost, E.st.errors]);
  await E.context.close();
}

{
  const E = await run('visit-overview.html', { label: '接続先のある端末', withCfg: true });
  await E.page.waitForTimeout(500);
  await pressRefresh(E.page);
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && fullNameShown(x) ? x : null; }, 15000);
  t('訪問俯瞰 接続先のある端末: 今までどおり盤面が出る（新しい保存先から読む）', !!L && E.st.sb.includes('kv_get care_schedule_v2'), { state: await stateOf(E.page), sb: E.st.sb.slice(0, 4) });
  t('訪問俯瞰 接続先のある端末: Google へは送らない（読めたため）・画面のエラーなし', E.st.gas.length === 0 && E.st.selfPost.length === 0 && !E.st.errors.length && !E.st.ext.length, [E.st.gas, E.st.errors, E.st.ext]);
  await E.context.close();
}

/* ═════ スイッチが切＋接続先ありの端末: Google へ送る形が今までどおり ═════ */
console.log('\n— スイッチが切で接続先のある端末: Google へ送る形 —');
const sentOk = (r) => r.method === 'POST' && r.ctype === 'text/plain;charset=utf-8' && r.url === F.SYNC_URL;
for (const pg of ['support-overview.html', 'visit-overview.html']) {
  const E = await run(pg, { label: 'スイッチが切', withCfg: true, flags: { supabase: { ...F.FLAGS_OFF.supabase } } });
  await E.page.waitForTimeout(500);
  if (pg === 'visit-overview.html') await pressRefresh(E.page);
  const L = await waitFor(async () => { const x = await lanes(E.page); return x.length === 7 && fullNameShown(x) ? x : null; }, 20000);
  t(pg + ' スイッチが切: Google から読んで盤面が出る', !!L, { state: await stateOf(E.page), gas: E.st.gas.slice(0, 3) });
  const care = E.st.gasReq.find((r) => r.body.action === 'get' && r.body.key === 'care_schedule_v2');
  t(pg + ' スイッチが切: 週間計画の読み取りは POST・text/plain;charset=utf-8・本文 {action:get, key, token}', !!care && sentOk(care) && JSON.stringify(care.body) === JSON.stringify({ action: 'get', key: 'care_schedule_v2', token: 'check-flow' }), care);
  if (pg === 'support-overview.html') {
    const pull = E.st.gasReq.find((r) => r.body.action === 'pull');
    t(pg + ' スイッチが切: 日ごとの盤面は POST・text/plain;charset=utf-8・本文 {action:pull, keys(7日), token}', !!pull && sentOk(pull) && Object.keys(pull.body).join(',') === 'action,keys,token' && pull.body.keys.length === 7 && pull.body.keys.every((k) => /^wsday_\d{4}-\d{2}-\d{2}$/.test(k)) && pull.body.token === 'check-flow', pull);
  }
  t(pg + ' スイッチが切: Google へ送った要求はすべて同じ形・新しい保存先の盤面は読まない', E.st.gasReq.length > 0 && E.st.gasReq.every(sentOk) && !E.st.sb.some((x) => /^kv_/.test(x)), E.st.gasReq.map((r) => [r.method, r.ctype]));
  t(pg + ' スイッチが切: 画面のエラーなし・外への通信なし', !E.st.errors.length && !E.st.ext.length && !E.st.selfPost.length, [E.st.errors, E.st.ext]);
  await E.context.close();
}

await browser.close();
srv.close && srv.close();
console.log('\n合格 ' + pass + ' / 失敗 ' + fail);
process.exit(fail ? 1 : 0);
