/* check/care_plan_daycare_e2e.mjs — デイ利用表（daycare-roster.html）が週間計画の写しを新しい保存先へ送る時の版の印 csAppVer の通し試験（2026-11-27 反証 F1）
 *
 *   node check/care_plan_daycare_e2e.mjs
 *
 * デイ利用表は取得した週間計画の写しを持ち回して PUT する画面。共通 DB の移行 0136 の口 cs_plan_gate が答える時だけ印を付け、
 * 答えない（0136 より前の本番）時は印を付けない。取得した写し・端末の控えに csAppVer が紛れていても、取り込み・次の送信に持ち回さない。
 * 場面:
 *   1 口が無い（0136 より前・kv_put は印を除かずに保存する）・予約あり … 送った本文に印が無い（答えを最大3秒待ってから印なしで送る）
 *   2 口がある・予約あり … 送った本文に印（2026112701）が付く
 *   3 口が無い・取得した写しに csAppVer がある … 取得の答え・端末の控えの読み取りに印が無く、次の送信にも無い
 *   4 口が無い・予約なし … 答えを待たずに送り、本文に印が無い
 *   5〜7 送る時にまだ確かめていない（確かめの答えが遅れる）: 0.8秒遅れ・予約あり … 答えを待って印が付く／6秒遅れ・予約あり … 約3秒で打ち切って印なしで送り、
 *        門が oldapp で断る／0.8秒遅れ・予約なし … 待たずに印なしで送る（送る直前に画面の確かめの覚え dcrGate_ を「まだ確かめていない」へ戻して作る）
 * 送信は画面の通信の入口（gasCall）を page.evaluate で直接呼ぶ（画面のコードは変えない）。データはすべて架空。通信は全部横取りし、外へは出ない。
 *   8〜10 保存の本物の道（queueFlags → runSaver）で、印なしで送って oldapp の時（2026-11-27 反証）:
 *        8 口の答えが4.5秒遅れる（3秒に間に合わない）… 印なしで oldapp → 口を確かめ直して印つきで1回だけ送り直して通る（送信はちょうど2本・取り消しの知らせなし）
 *        9 口はあるが門がいつも oldapp（本当に古い版）… 印つきで oldapp → 送り直さない（送信1本・口を確かめ直さない）
 *        10 口が無い（答えがエラー）・予約あり … 印なしで oldapp → 確かめ直しても「なし」→ 送信1本で止めて知らせる
 *        11 口の答えが4.5秒遅れる・門がいつも oldapp … 印なしで oldapp → 印つきで送り直しても oldapp → 送信2本で止めて知らせる
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer } from './lib.mjs';
import * as F from './fixtures/flow.mjs';
import * as GATE from './fixtures/care-plan-gate.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info).slice(0, 500))); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUTED = { supabase: Object.assign({}, F.FLAGS_OFF.supabase, { care_schedule_v2: true }) };

function planDb(withPlan) {
  const db = F.careDb(); db.currentResidentId = 'fl01';
  const me = db.residents[0];
  if (withPlan) {
    me.planGen = 0; me.planFrom = ''; me.planGone = [];
    me.nextPlans = [{ id: 'P', from: '2099-01-01', careLevel: '', baseLevel: me.careLevel, note: '架空の予約', events: [], updatedAt: '2026-11-01T00:00:00.000Z' }];
  }
  return db;
}

const srv = await startServer(repoDir);
const browser = await chromium.launch();

async function scene({ title, gate, withPlan, dirty, delay = 0 }) {
  console.log('\n— ' + title + ' —');
  const db = planDb(withPlan); if (dirty) db.csAppVer = 2026112701;
  const st = { kv: { data: JSON.parse(JSON.stringify(db)), rev: 5, log: [] }, ext: [], errors: [], gateCalls: 0 };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  const seed = { ...F.storage('office'), su_backend_flags: JSON.stringify(ROUTED) };
  if (dirty) seed.care_schedule_v2 = JSON.stringify(db);   /* 端末の控えにも印つきの中身（古い版のタブが書いた形） */
  await context.addInitScript(({ s }) => {
    try {
      if (localStorage.getItem('__dc_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__dc_seeded', '1');
    } catch (e) { /* 何もしない */ }
  }, { s: seed });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const sbBase = F.supabase({ sb: [] }, 'office');
  const rpc = {
    kv_get: () => ({ rev: st.kv.rev, data: st.kv.data, mode: 'live', updatedAt: '' }),
    kv_head: (b) => { const revs = {}; (b.p_keys || []).forEach((k) => { revs[k] = k === 'care_schedule_v2' ? st.kv.rev : 0; }); return { revs }; },
    kv_put: (b) => (gate ? GATE.kvPut : GATE.kvPutPre0136)(st.kv, b),
  };
  if (gate) rpc.cs_plan_gate = async () => { st.gateCalls++; if (delay) await sleep(delay); return GATE.csPlanGate(); };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTED) });
      return route.continue();
    }
    if (u.startsWith(F.SYNC_URL)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, server: 'silverunix-sync' }) });
    if (u.startsWith(F.MASTER_URL)) return route.abort();
    if (u.startsWith(F.SB + '/')) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(new URL(u).pathname);
      if (m && m[1] === 'cs_plan_gate' && !gate) st.gateCalls++;
      if (!m || !rpc[m[1]]) return sbBase(route);
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      const out = await rpc[m[1]](b);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 160));
    return route.abort();
  });
  context.on('page', (page) => { page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200))); page.on('dialog', (d) => d.accept().catch(() => {})); });
  const page = await context.newPage();
  try {
    await page.goto(srv.url + '/daycare-roster.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof gasCall === 'function' && !!window.SUKv, null, { timeout: 20000 });
    await sleep(1500 + delay);   /* 起動の時に始まった確かめが終わるまで待つ */
    /* 取得（画面の入口）→ 取った写しに名前の印を1つ足して PUT（runSaver と同じ「取得した全体を持ち回して送る」形） */
    const resetGate = !!delay;
    const r = await page.evaluate(async (resetGate) => {
      const g = await gasCall({ action: 'get', key: 'care_schedule_v2' });
      const local = loadLocal();
      const d = g && g.data ? JSON.parse(JSON.stringify(g.data)) : null;
      if (!d) return { err: 'get', g };
      d.residents[1].lunchMed = !d.residents[1].lunchMed;
      if (resetGate) dcrGate_ = { yes: false, noAt: 0, p: null };   /* 送る時にまだ確かめていない形にする */
      const t0 = Date.now();
      const p = await gasCall({ action: 'put', key: 'care_schedule_v2', data: d, rev: g.rev });
      return { getHas: Object.prototype.hasOwnProperty.call(g.data, 'csAppVer'), localHas: !!local && Object.prototype.hasOwnProperty.call(local, 'csAppVer'), putOk: !!(p && p.ok), ms: Date.now() - t0, p };
    }, resetGate);
    const sent = st.kv.log;
    if (delay) {
      const late = delay > 3000;
      const want = (withPlan && !late) ? 2026112701 : null;
      t('送った本文の版の印は ' + (want === null ? '無い' : want) + '（' + sent.length + '本）', sent.length === 1 && sent[0].ver === want, sent);
      if (withPlan && !late) t('答えを待ってから送る（' + r.ms + 'ミリ秒・遅れの ' + delay + 'ミリ秒以上）・保存が通る', r.ms >= delay - 50 && r.putOk === true && sent[0].result === 'ok', [r.ms, r.p]);
      if (withPlan && late) t('3秒で打ち切って印なしで送る（' + r.ms + 'ミリ秒）・門が oldapp で断る', r.ms >= 2900 && r.ms < 4500 && sent.length === 1 && sent[0].result === 'oldapp' && r.p && r.p.error === 'oldapp', [r.ms, r.p]);
      if (!withPlan) t('予約なしの時は答えを待たずに送る（' + r.ms + 'ミリ秒・遅れの ' + delay + 'ミリ秒より短い）・保存が通る', r.ms < delay - 200 && r.putOk === true, [r.ms, r.p]);
      return;
    }
    const want = gate ? 2026112701 : null;
    t('取得の答えに版の印が無い', r.getHas === false, r);
    if (dirty) t('端末の控えの読み取り（loadLocal）にも版の印が無い', r.localHas === false, r);
    t('送った本文の版の印は ' + (want === null ? '無い' : want) + '（' + sent.length + '本）', sent.length === 1 && sent[0].ver === want, sent);
    t('保存が通る', r.putOk === true && sent.length === 1 && sent[0].result === 'ok', r.p);
    if (!gate) t('サーバーの中身（印を除かない 0136 より前の形）に版の印が残らない', !Object.prototype.hasOwnProperty.call(st.kv.data, 'csAppVer'));
    t('口 cs_plan_gate を確かめに行った', st.gateCalls >= 1, st.gateCalls);
    if (!gate && !withPlan) t('予約なしの時は答えを待たずに送る（3秒より短い）', r.ms < 2500, r.ms);
  } finally {
    t('画面のエラーなし', st.errors.length === 0, st.errors);
    t('横取りしていない外への通信なし', st.ext.length === 0, st.ext);
    await context.close();
  }
}

await scene({ title: '1 口が無い（0136 より前）・予約あり', gate: false, withPlan: true, dirty: false });
await scene({ title: '2 口がある・予約あり', gate: true, withPlan: true, dirty: false });
await scene({ title: '3 口が無い・取得した写しと端末の控えに csAppVer がある', gate: false, withPlan: true, dirty: true });
await scene({ title: '4 口が無い・予約なし', gate: false, withPlan: false, dirty: false });
await scene({ title: '5 送る時にまだ確かめていない・答えが0.8秒遅れる・予約あり', gate: true, withPlan: true, dirty: false, delay: 800 });
await scene({ title: '6 送る時にまだ確かめていない・答えが6秒遅れる・予約あり', gate: true, withPlan: true, dirty: false, delay: 6000 });
await scene({ title: '7 送る時にまだ確かめていない・答えが0.8秒遅れる・予約なし', gate: true, withPlan: false, dirty: false, delay: 800 });

/* 8〜10: 保存の本物の道（queueFlags → runSaver）で、印なしで送って oldapp の時の確かめ直しと1回の送り直し */
async function saverScene({ title, delay = 0, gateNone = false, forceOld = false }) {
  console.log('\n— ' + title + ' —');
  const db = planDb(true);
  const st = { kv: { data: JSON.parse(JSON.stringify(db)), rev: 5, log: [] }, ext: [], errors: [], gateCalls: 0 };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  const seed = { ...F.storage('office'), su_backend_flags: JSON.stringify(ROUTED) };
  await context.addInitScript(({ s }) => {
    try {
      if (localStorage.getItem('__dc_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__dc_seeded', '1');
    } catch (e) { /* 何もしない */ }
  }, { s: seed });
  /* 知らせ（トースト）を読み込みの初めから控える（画面のコードは変えず、#toast に出た文を写すだけ） */
  await context.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => { const el = document.getElementById('toast'); const tx = el ? el.textContent : ''; if (tx && window.__toasts[window.__toasts.length - 1] !== tx) window.__toasts.push(tx); })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const sbBase = F.supabase({ sb: [] }, 'office');
  const rpc = {
    kv_get: () => ({ rev: st.kv.rev, data: st.kv.data, mode: 'live', updatedAt: '' }),
    kv_head: (b) => { const revs = {}; (b.p_keys || []).forEach((k) => { revs[k] = k === 'care_schedule_v2' ? st.kv.rev : 0; }); return { revs }; },
    kv_put: (b) => GATE.kvPut(st.kv, b, { forceOld }),
    cs_plan_gate: async () => {
      st.gateCalls++;
      if (gateNone) return { __status: 404, body: { code: 'PGRST202', message: 'Could not find the function', details: null, hint: null } };
      if (delay) await sleep(delay);
      return GATE.csPlanGate();
    },
  };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTED) });
      return route.continue();
    }
    if (u.startsWith(F.SYNC_URL)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, server: 'silverunix-sync' }) });
    if (u.startsWith(F.MASTER_URL)) return route.abort();
    if (u.startsWith(F.SB + '/')) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(new URL(u).pathname);
      if (!m || !rpc[m[1]]) return sbBase(route);
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      const out = await rpc[m[1]](b);
      if (out && out.__status) return route.fulfill({ status: out.__status, contentType: 'application/json', headers: cors, body: JSON.stringify(out.body) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 160));
    return route.abort();
  });
  context.on('page', (page) => { page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200))); page.on('dialog', (d) => d.accept().catch(() => {})); });
  const page = await context.newPage();
  try {
    await page.goto(srv.url + '/daycare-roster.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof queueFlags === 'function' && !!window.SUKv && typeof DB !== 'undefined' && DB && Array.isArray(DB.residents) && DB.residents.length > 1, null, { timeout: 20000 });
    await sleep(1500 + delay);   /* 起動の時に始まった確かめが終わるまで待つ */
    const n0 = st.kv.log.length, g0 = st.gateCalls;
    const r = await page.evaluate(async (resetGate) => {
      if (resetGate) dcrGate_ = { yes: false, noAt: 0, p: null };   /* 送る時にまだ確かめていない形にする */
      const me = DB.residents[1];
      const want = !me.lunchMed;
      const t0 = Date.now();
      window.__toasts = [];
      queueFlags([{ rid: me.id, masterId: me.masterId, name: me.name }], 'lunchMed', want, '昼食薬');
      while (saverRunning) await new Promise((ok) => setTimeout(ok, 50));
      return { ms: Date.now() - t0, want, rid: me.id, pending: pendingFlags.size, toasts: window.__toasts.slice() };
    }, !!delay);
    await sleep(500);
    const log = st.kv.log.slice(n0);
    const srvMe = st.kv.data.residents.find((x) => x.id === r.rid);
    if (delay && forceOld) {
      t('送信はちょうど2本: 印なしで oldapp → 印つき（2026112701）でも oldapp（3本目は送らない）', log.length === 2 && log[0].ver === null && log[0].result === 'oldapp' && log[1].ver === 2026112701 && log[1].result === 'oldapp', log);
      t('止めて知らせる（「この画面は古い版です。読み込み直してください」・変更を取り消す）・サーバーは変わらない', r.toasts.some((x) => /保存できませんでした。?.*この画面は古い版です。読み込み直してください/.test(x)) && !!srvMe && !!srvMe.lunchMed !== r.want, { toasts: r.toasts, srv: srvMe && srvMe.lunchMed });
    } else if (delay) {
      t('送信はちょうど2本: 印なしで oldapp → 印つき（2026112701）で通る', log.length === 2 && log[0].ver === null && log[0].result === 'oldapp' && log[1].ver === 2026112701 && log[1].result === 'ok', log);
      t('口の確かめは送信の間に1本だけ（確かめの最中の答えを待つ）', st.gateCalls - g0 === 1, st.gateCalls - g0);
      t('保存が通り（' + r.ms + 'ミリ秒）、サーバーに昼食薬の印が入る・未送信が残らない', !!srvMe && !!srvMe.lunchMed === r.want && r.pending === 0 && !Object.prototype.hasOwnProperty.call(st.kv.data, 'csAppVer'), { r, srv: srvMe && srvMe.lunchMed });
      t('「保存しました」が出て、取り消しの知らせは出ない', r.toasts.some((x) => /を保存しました/.test(x)) && !r.toasts.some((x) => /保存できませんでした|古い版/.test(x)), r.toasts);
    } else {
      const wantVer = forceOld ? 2026112701 : null;
      t('送信は1本だけ（版の印は ' + (wantVer === null ? '無い' : wantVer) + '・oldapp）・送り直さない', log.length === 1 && log[0].ver === wantVer && log[0].result === 'oldapp', log);
      if (forceOld) t('印つきで断られた時は口を確かめ直さない', st.gateCalls === g0, [g0, st.gateCalls]);
      else t('口が「なし」の時は、5分の間でも1回確かめ直す', st.gateCalls - g0 === 1, [g0, st.gateCalls]);
      t('止めて知らせる（「この画面は古い版です。読み込み直してください」・変更を取り消す）・サーバーは変わらない', r.toasts.some((x) => /保存できませんでした。?.*この画面は古い版です。読み込み直してください/.test(x)) && !!srvMe && !!srvMe.lunchMed !== r.want, { toasts: r.toasts, srv: srvMe && srvMe.lunchMed });
    }
  } finally {
    t('画面のエラーなし', st.errors.length === 0, st.errors);
    t('横取りしていない外への通信なし', st.ext.length === 0, st.ext);
    await context.close();
  }
}
await saverScene({ title: '8 保存の道・口の答えが4.5秒遅れる・予約あり → 印なしで oldapp → 確かめ直して印つきで1回送り直して通る', delay: 4500 });
await saverScene({ title: '9 保存の道・印つきで oldapp（本当に古い版）→ 送り直さない', forceOld: true });
await saverScene({ title: '10 保存の道・口が無い（答えがエラー）・予約あり → 印なしで oldapp → 確かめ直しても「なし」で止める', gateNone: true });
await saverScene({ title: '11 保存の道・口の答えが4.5秒遅れる・門がいつも oldapp → 印つきで送り直しても oldapp なら2本で止める', delay: 4500, forceOld: true });

await browser.close();
await srv.close();
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
