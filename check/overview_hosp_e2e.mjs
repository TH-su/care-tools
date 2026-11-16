/* check/overview_hosp_e2e.mjs — 全支援俯瞰：開いた時の入院の印と週の盤面の読み込みの順番の通し試験（2026-11-17 新設）
 *   node check/overview_hosp_e2e.mjs
 *
 * 何を守るか:
 *   1. 入居者マスタの名簿（入院の印）の答えが遅くても、週の盤面は名簿の答えを待たずに読み始める（開いてから使えるまでの待ちを減らす・本人指示）
 *   2. それでも最初に出る盤面から入院の方に斜線が付く（初回だけ入院が抜けた表にしない・2026-08-08 監査O1）
 *   3. 名簿が読めない時も盤面は出る（入院は重ねない＝今までどおり）。開いた時の自動の集計は1回だけ
 *   4. 名簿が答えないまま止まっても、待ちの上限（8秒）の後に盤面が出て「取り直し」も効く。上限を過ぎて届いた時は1回だけ集計し直して斜線を付ける
 * ★通信は全部横取りする（外へは出ない）。データは check/fixtures/flow.mjs の架空の入居者だけ。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer } from './lib.mjs';
import * as F from './fixtures/flow.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info).slice(0, 400))); }
}
async function waitFor(fn, timeout = 20000, step = 100) {
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
const REC = F.masterRecords();
const NAMES = REC.map((r) => r.name);
const HOSP_ID = REC[1].id;            // 盤面に出る4名のうち2人目を入院中にする
const DAY = {
  columns: [{ id: 'c1', zone: 'visit', staffIds: ['s1'] }],
  tasks: NAMES.slice(0, 4).map((n, i) => ({ id: 'tk' + i, kind: 'care', staffId: 's1', start: 600 + i * 60, end: 630 + i * 60, residentName: n, svcCode: '身体１' })),
};

/* rosterMs＝名簿の答えを遅らせる時間、rosterFail＝名簿が読めない、rosterHang＝名簿が答えないまま止まる */
async function run({ rosterMs = 0, rosterFail = false, rosterHang = false }) {
  const st = { boardAt: [], careGets: 0, rosterAt: null, rosterDoneAt: null, errors: [], ext: [] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  const s = F.storage('office');
  await context.addInitScript((x) => { try { if (localStorage.getItem('__seeded') === '1') return; for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); localStorage.setItem('__seeded', '1'); } catch (e) {} }, s);
  const sb = F.supabase(null, 'office');
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.FLAGS_OFF) });
      return route.continue();
    }
    if (u.startsWith(F.MASTER_URL)) {
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      if (b.action !== 'getRoster') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' });
      st.rosterAt = Date.now();
      if (rosterHang) return new Promise(() => {});   // 答えない
      const roster = REC.map((r) => ({ id: r.id, name: r.name, hospitalized: r.id === HOSP_ID }));
      return new Promise((res) => setTimeout(res, rosterMs)).then(() => {
        st.rosterDoneAt = Date.now();
        if (rosterFail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"test"}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, roster, stateRev: 1, srev: 0 }) });
      });
    }
    if (u.startsWith(F.SYNC_URL)) {
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      let out = { ok: false, error: 'test' };
      if (b.action === 'get' && b.key === 'care_schedule_v2') { st.careGets++; out = { ok: true, rev: 1, data: F.careDb() }; }
      else if (b.action === 'get') { st.boardAt.push(Date.now()); out = { ok: true, rev: 1, data: DAY }; }
      else if (b.action === 'pull') { st.boardAt.push(Date.now()); const entries = {}; (b.keys || []).forEach((k) => { entries[k] = { key: k, rev: 1, data: DAY }; }); out = { ok: true, entries }; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    }
    if (u.startsWith(F.SB + '/')) return sb(route);
    st.ext.push(req.method() + ' ' + u.slice(0, 120));
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200)));
  await page.goto(srv.url + '/support-overview.html', { waitUntil: 'load' });
  /* 最初に「集計OK」になった瞬間の盤面を取る（後から描き直された盤面ではなく、最初の盤面を見る） */
  const first = await waitFor(() => page.evaluate(() => {
    const s = (document.getElementById('syncState') || {}).textContent || '';
    if (!/集計OK/.test(s)) return null;
    return Array.from(document.querySelectorAll('.b-task')).map((c) => ({ title: c.title || '', hosp: c.classList.contains('is-hosp') }));
  }));
  await page.waitForTimeout(800);   // 遅れて2回目の集計が走らないかを見る
  return { page, context, st, first };
}
const hospCards = (cards) => (cards || []).filter((c) => c.title.includes(NAMES[1]));
const otherCards = (cards) => (cards || []).filter((c) => !c.title.includes(NAMES[1]));

console.log('\n— 全支援俯瞰：入院の印と週の盤面の読み込み —');
{
  const E = await run({ rosterMs: 2500 });
  const { st, first } = E;
  t('名簿の答えが遅くても盤面が出る', Array.isArray(first) && first.length > 0, first);
  t('★週の盤面は名簿の答えを待たずに読み始める（最初の盤面の読み取りが名簿の答えより前）',
    st.boardAt.length > 0 && st.rosterDoneAt && st.boardAt[0] < st.rosterDoneAt, { board0: st.boardAt[0] - st.rosterAt, rosterDone: st.rosterDoneAt - st.rosterAt });
  t('★最初に出た盤面から入院の方に斜線が付く', hospCards(first).length > 0 && hospCards(first).every((c) => c.hosp), hospCards(first));
  t('入院していない方には斜線が付かない', otherCards(first).length > 0 && otherCards(first).every((c) => !c.hosp), otherCards(first));
  t('開いた時の自動の集計は1回だけ（予定の型の読み取り1回）', st.careGets === 1, st.careGets);
  t('外へ出る通信なし・画面のエラーなし', st.ext.length === 0 && st.errors.length === 0, { ext: st.ext, err: st.errors });
  await E.context.close();
}
{
  const E = await run({ rosterMs: 300, rosterFail: true });
  const { st, first } = E;
  t('名簿が読めない時も盤面が出る', Array.isArray(first) && first.length > 0, first);
  t('名簿が読めない時は斜線を重ねない（今までどおり）', (first || []).every((c) => !c.hosp), first);
  t('名簿が読めない時も自動の集計は1回だけ', st.careGets === 1, st.careGets);
  t('画面のエラーなし', st.errors.length === 0, st.errors);
  await E.context.close();
}
{
  const E = await run({ rosterHang: true });
  const { st, first } = E;
  t('名簿が答えないまま止まっても、待ちの上限の後に盤面が出る', Array.isArray(first) && first.length > 0, first);
  t('名簿が答えない時は斜線を重ねない', (first || []).every((c) => !c.hosp), first);
  /* 開いた後に手で「取り直し」を押しても盤面が出る（集計が止まったままにならない） */
  const n0 = st.careGets;
  await E.page.click('#btnRefresh');
  const again = await waitFor(() => (st.careGets > n0 ? E.page.evaluate(() => /集計OK/.test((document.getElementById('syncState') || {}).textContent || '')) : null));
  t('名簿が答えない時も「取り直し」で集計し直せる', !!again && st.careGets === n0 + 1, { n0, now: st.careGets });
  t('画面のエラーなし', st.errors.length === 0, st.errors);
  await E.context.close();
}
{
  /* 名簿が待ちの上限（8秒）を過ぎて届く: 最初の盤面は斜線なし→届いた後に1回だけ集計し直して斜線が付く */
  const E = await run({ rosterMs: 10000 });
  const { st, first } = E;
  t('名簿が上限を過ぎて届く時も、先に盤面が出る（斜線なし）', Array.isArray(first) && first.length > 0 && first.every((c) => !c.hosp), first);
  const later = await waitFor(() => E.page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.b-task'));
    return cards.some((c) => c.classList.contains('is-hosp')) ? cards.map((c) => ({ title: c.title || '', hosp: c.classList.contains('is-hosp') })) : null;
  }), 15000);
  t('★名簿が上限を過ぎて届いたら、集計し直して入院の方に斜線が付く', hospCards(later).length > 0 && hospCards(later).every((c) => c.hosp) && otherCards(later).every((c) => !c.hosp), later);
  await E.page.waitForTimeout(800);
  t('集計し直すのは1回だけ（予定の型の読み取り2回）', st.careGets === 2, st.careGets);
  t('画面のエラーなし', st.errors.length === 0, st.errors);
  await E.context.close();
}
{
  const E = await run({ rosterMs: 0 });
  const { st, first } = E;
  t('名簿の答えが速い時も最初の盤面から斜線が付く', hospCards(first).length > 0 && hospCards(first).every((c) => c.hosp), hospCards(first));
  t('名簿の答えが速い時も自動の集計は1回だけ', st.careGets === 1, st.careGets);
  await E.context.close();
}

await browser.close();
await srv.close();
console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
