/* check/care_plan_oldtab_e2e.mjs — 古い版の週間計画のタブと新しい版のタブが同じ端末（同じ localStorage）にある時、
 * 切り替えた後の計画に前の計画の予定・入浴が混ざらないことを確かめる通し試験（2026-11-27・門まわりの反証 3回目・助言役の指示）
 *
 *   node check/care_plan_oldtab_e2e.mjs [--only A,B] [--shots <保存先>]
 *   CS_BASE_REF=<コミット> … 古い版（比べる元・既定 origin/main）。改修を取り込んだ後は、取り込み前のコミットを渡す
 *
 * 古い版（CS_BASE_REF の画面と共通部品・care-plan-calc.js は無い）を /old/、今の作業ツリーを /new/ に置き、同じサーバー（同じオリジン＝同じ localStorage）で配る。
 * 偽の共通 DB（check/fixtures/care-plan-gate.mjs）は、版の印の門（oldapp）・中身の確かめ（planstale: 世代が下がる・同じ世代で開始日が違う・取り消した予約が戻る）・
 * 競合・印を外して保存、を持つ。cs_plan_switch は偽のサーバーの中身を CarePlanCalc.applyDue で入れ替える。使い始めのスイッチは入。
 * 場面:
 *   A  予約あり → サーバーで切替 → 新しいタブが切替後を取得 → 古いタブ（切替前の中身・同じ方と別の方に未送信）が保存して localStorage を上書き → 新しいタブが運ぶ
 *   B  古いタブを閉じた後（localStorage に切替前の中身と未送信の印）に新しいタブを開く（起動時に未送信がある時の道）
 *   A2 古いタブが、新しいタブの書いた切替後の中身を別タブの取り込みで混ぜた中身（世代は古いまま・予定は和）を書き、新しいタブが運ぶ
 *   D  切替の後に開いた古いタブ（切替後の中身）が今の計画を1件直して書き、新しいタブが運ぶ → 正当な直しとして通る
 *   E  予約を1件も使っていない時: 古いタブが送れない（通信を止める）まま未送信を抱え、別のタブがその中身を運ぶ。「古い版どうし」と「古い版＋新しい版」で
 *      サーバーの結果が同じ（editedAt・editedBy・updatedAt は時刻とログインで変わるので除いて比べる）
 *   G  版の印（反証 F1）: 口 cs_plan_gate が無い（0136 より前・印を除かずに保存するサーバー）時は送った本文に csAppVer が無く、口がある時は付く。
 *      取得した中身・別タブの書いた控えに csAppVer が入っていても、DB・端末の控え・次の送信に持ち回さない
 * 期待（A・B・A2）: サーバーの切り替えた方の予定は「切替後の計画＋新しいタブでの正当な直し」だけ（前の計画の予定・入浴が混ざらない）・世代が下がらない・使った予約が戻らない。
 * どの場面でも、古いタブ自身の送信は oldapp で断られて未送信のまま止まる（E は予約を使っていないので断られない）。データはすべて架空。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';
import * as F from './fixtures/flow.mjs';
import * as GATE from './fixtures/care-plan-gate.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require(path.join(repoDir, 'care-plan-calc.js'));
const args = parseArgs(process.argv.slice(2));
const ONLY = args.only ? String(args.only).split(',').map((x) => x.trim()) : null;
const shots = args.shots ? path.resolve(args.shots) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
const results = [];
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info).slice(0, 700))); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 15000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return v;
    await sleep(step);
  }
}

/* ── 古い版と新しい版を同じオリジンに置く ── */
const BASE_REF = process.env.CS_BASE_REF || 'origin/main';
const root = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'cp-oldtab-'));
fs.mkdirSync(path.join(root, 'old')); fs.mkdirSync(path.join(root, 'new'));
execFileSync('bash', ['-c', 'git -C "$1" archive "$3" | tar -x -C "$2"', '_', repoDir, path.join(root, 'old'), BASE_REF]);
try { fs.unlinkSync(path.join(root, 'old', 'care-plan-calc.js')); } catch (e) { /* 比べる元には無い */ }
execFileSync('rsync', ['-a', '--exclude', '.git', '--exclude', 'check/out', '--exclude', 'node_modules', repoDir + '/', path.join(root, 'new') + '/']);
const sameAsBase = fs.readFileSync(path.join(root, 'old', 'care-schedule.html'), 'utf8') === fs.readFileSync(path.join(root, 'new', 'care-schedule.html'), 'utf8');

const ROUTED = { supabase: Object.assign({}, F.FLAGS_OFF.supabase, { care_schedule_v2: true }) };
const today = C.todayJst(Date.now());
const addDays = (ymd, n) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
const YESTERDAY = addDays(today, -1);
const ev = (id, dow, st, en, o) => Object.assign({ id, dayOfWeek: dow, serviceType: 'visit', category: '身体１', startTime: st, endTime: en, detail: '架空の支援', notes: '', units: 0, bathing: false }, o || {});

/* 架空の名簿。fl01 に切替日（昨日）の予約 P を持たせる。予約の予定: fl0_d1 は入浴なしに変え、新しいデイ p_new（入浴あり）を足し、fl0_d4・fl0_v2 は使わない */
function planDb() {
  const db = F.careDb(); db.currentResidentId = 'fl01';
  const me = db.residents[0];
  const d1 = JSON.parse(JSON.stringify(me.events.find((e) => e.id === 'fl0_d1'))); d1.bathing = false;
  me.planGen = 0; me.planFrom = ''; me.planLevel = ''; me.planNote = ''; me.planGone = [];
  me.nextPlans = [{ id: 'P', from: YESTERDAY, careLevel: '', baseLevel: me.careLevel, note: '架空の予約', events: [d1, ev('p_new', 4, '09:30', '16:00', { serviceType: 'daycare', category: '', detail: '入浴・機能訓練', bathing: true })],
    createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'check', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'check' }];
  return db;
}
const PLAN_IDS = ['fl0_d1', 'p_new'];

const srv = await startServer(root);
const browser = await chromium.launch();

/* gate … 共通 DB の口 cs_plan_gate（移行 0136）が答えるか。pre0136 … 0136 より前の本番を真似る（cs_plan_gate・cs_plan_status・cs_plan_switch が無く、
   kv_put は門を持たず最上位の csAppVer を取り除かずに保存する・check/fixtures/care-plan-gate.mjs の kvPutPre0136） */
async function makeEnv({ db, blockOld = false, gate = true, pre0136 = false }) {
  const st = { kv: { data: JSON.parse(JSON.stringify(db)), rev: 5, log: [] }, ext: [], errors: [], pages: new Map(), switched: 0 };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  await context.addInitScript(({ s }) => {
    try {
      if (localStorage.getItem('__ot_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__ot_seeded', '1');
    } catch (e) { /* 何もしない */ }
  }, { s: { ...F.storage('office'), rmaster_cfg: '', su_backend_flags: JSON.stringify(ROUTED), cs_current_resident_v1: 'fl01' } });
  /* 知らせ（トースト）を読み込みの初めから控える（画面のコードは変えず、#toast に出た文を写すだけ） */
  await context.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => { const el = document.getElementById('toast'); const tx = el ? el.textContent : ''; if (tx && window.__toasts[window.__toasts.length - 1] !== tx) window.__toasts.push(tx); })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  /* 画面の中の確かめの窓は OK を押す（両方の版で同じ） */
  await context.addInitScript(() => {
    new MutationObserver(() => {
      const d = document.querySelector('dialog.sud-dlg[open]');
      if (d && !d.__ot) { d.__ot = true; setTimeout(() => { const b = d.querySelector('.sud-btn.pri'); if (b) { b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); b.click(); } }, 500); }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const sbBase = F.supabase({ sb: [] }, 'office');
  const tagOf = (req) => { try { return st.pages.get(req.frame().page()) || '?'; } catch (e) { return '?'; } };
  const rpc = {
    kv_get: () => ({ rev: st.kv.rev, data: st.kv.data, mode: 'live', updatedAt: '' }),
    kv_head: (b) => { const revs = {}; (b.p_keys || []).forEach((k) => { revs[k] = k === 'care_schedule_v2' ? st.kv.rev : 0; }); return { revs }; },
    kv_put: (b, tag) => { const r = (pre0136 ? GATE.kvPutPre0136 : GATE.kvPut)(st.kv, b); st.kv.log[st.kv.log.length - 1].tag = tag; return r; },
    cs_plan_status: () => ({ ok: true, enabled: true, minAppVer: 2026112701, lastUnstampedAt: null, lastStampedAt: null }),
    cs_plan_switch: () => {
      let n = 0;
      st.kv.data = Object.assign({}, st.kv.data, { residents: st.kv.data.residents.map((r) => { const a = C.applyDue(r, today, ''); if (a.changed) n++; return a.changed ? a.res : r; }) });
      if (n) { st.kv.rev++; st.switched += n; }
      return { ok: true, switched: n, rev: st.kv.rev };
    },
  };
  if (gate && !pre0136) rpc.cs_plan_gate = () => GATE.csPlanGate();
  if (pre0136) { delete rpc.cs_plan_status; delete rpc.cs_plan_switch; }
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/\/su-backend\.json(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTED) });
      return route.continue();
    }
    if (u.startsWith(F.SYNC_URL)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, server: 'silverunix-sync' }) });
    if (u.startsWith(F.MASTER_URL)) return route.abort();
    if (u.startsWith(F.SB + '/')) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(new URL(u).pathname);
      if (!m || !rpc[m[1]]) return sbBase(route);
      const tag = tagOf(req);
      if (blockOld && m[1] === 'kv_put' && tag === 'old-x') { st.kv.log.push({ tag, result: 'network-blocked' }); return route.abort('failed'); }
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(rpc[m[1]](b, tag)) });
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 160));
    return route.abort();
  });
  context.on('page', (page) => { page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200))); page.on('dialog', (d) => d.accept().catch(() => {})); });
  return { context, st };
}
async function openTab(env, which, tag) {
  const page = await env.context.newPage();
  env.st.pages.set(page, tag);
  await page.goto(srv.url + '/' + which + '/care-schedule.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof DB === 'object' && DB && Array.isArray(DB.residents) && DB.residents.length >= 12, null, { timeout: 20000 });
  await sleep(1500);
  return page;
}
/* 送信が落ち着くまで待つ（未送信があれば送る） */
async function settle(page, ms = 12000) {
  const t0 = Date.now(); let calm = 0;
  while (Date.now() - t0 < ms && calm < 4) {
    const s = await page.evaluate(() => ({ busy: !!SYNC._busy, timer: !!SYNC._pushTimer, dlg: !!document.querySelector('dialog.sud-dlg[open]') }));
    calm = (!s.busy && !s.timer && !s.dlg) ? calm + 1 : 0;
    await sleep(300);
  }
}
const srvRes = (env, id) => env.st.kv.data.residents.find((r) => r.id === id);
/* 切り替えた方の期待: 予定は切替後の計画（＋ extra の id）だけ・入浴は計画のまま・世代1・使った予約が戻らない */
function checkSwitched(label, env, extraEdit) {
  const r = srvRes(env, 'fl01');
  const ids = r.events.map((e) => e.id).sort();
  t(label + ': サーバーの fl01 の予定は切替後の計画だけ（前の計画の fl0_d4・fl0_v2 が混ざらない）', JSON.stringify(ids) === JSON.stringify(PLAN_IDS.slice().sort()), ids);
  const d1 = r.events.find((e) => e.id === 'fl0_d1'), pn = r.events.find((e) => e.id === 'p_new');
  t(label + ': 入浴は計画のまま（fl0_d1 は入浴なし・p_new は入浴あり）', !!d1 && d1.bathing === false && !!pn && pn.bathing === true, { d1: d1 && d1.bathing, pn: pn && pn.bathing });
  t(label + ': 世代は1のまま（下がらない）・開始日は切替日', r.planGen === 1 && r.planFrom === YESTERDAY, { gen: r.planGen, from: r.planFrom });
  t(label + ': 使った予約 P が戻らない（nextPlans に無く planGone にある）', !(r.nextPlans || []).some((p) => p.id === 'P') && (r.planGone || []).some((g) => g.id === 'P'));
  if (extraEdit) t(label + ': 新しいタブでの正当な直しは入っている', extraEdit(r), r.events.map((e) => [e.id, e.detail, e.startTime]));
  t(label + ': サーバーの中身に版の印が残らない', !JSON.stringify(env.st.kv.data).includes('csAppVer'));
  return { gen: r.planGen, from: r.planFrom, events: r.events.map((e) => e.id + (e.bathing ? '(入浴)' : '') + ' ' + e.startTime + ' ' + e.detail), nextPlans: (r.nextPlans || []).map((p) => p.id), planGone: (r.planGone || []).map((g) => g.id) };
}
function oldRejected(label, env) {
  const olds = env.st.kv.log.filter((l) => /^old/.test(l.tag || ''));
  t(label + ': 古いタブ自身の送信は oldapp で断られる（' + olds.length + '回）・通ったものは無い', olds.length > 0 && olds.every((l) => l.result === 'oldapp'), olds.map((l) => l.result));
}
const oldEdit = (page) => page.evaluate(() => {
  const r = DB.residents.find((x) => x.id === 'fl01');
  const v2 = r.events.find((e) => e.id === 'fl0_v2'); if (v2) { v2.startTime = '11:00'; v2.endTime = '11:30'; }
  const d4 = r.events.find((e) => e.id === 'fl0_d4'); if (d4) d4.bathing = true;
  const r2 = DB.residents.find((x) => x.id === 'fl02'); r2.events[0].notes = '古いタブの架空のメモ';
  saveDB();
});
const run = (k) => !ONLY || ONLY.includes(k);

console.log('\n— 古い版（' + BASE_REF + '）のタブと新しい版のタブが同じ端末にある時 —');
t('比べる元と今の画面が違う（同じなら比べになっていません）', !sameAsBase, sameAsBase ? '比べる元と同じなので比べになっていません' : undefined);

/* ═════ A ═════ */
for (const mode of ['A', 'A2']) {
  if (!run(mode)) continue;
  console.log('\n— ' + mode + (mode === 'A' ? ' 古いタブが切替前の中身で localStorage を上書き → 新しいタブが運ぶ' : ' 古いタブが切替後の中身を和で混ぜた中身を書く → 新しいタブが運ぶ') + ' —');
  const env = await makeEnv({ db: planDb() });
  try {
    const old = await openTab(env, 'old', 'old');
    await old.evaluate(() => SYNC.stopPolling());
    if (mode === 'A') await old.evaluate(() => { csScheduleStorageAdopt_ = function () {}; });   /* 古いタブは寝ていて別タブの書き込みを取り込まない */
    t(mode + ': 古いタブは切替前の中身（fl01 の世代0・予約あり）', await old.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return (r.planGen || 0) === 0 && r.nextPlans.length === 1; }));
    if (mode === 'A2') {
      /* A2: サーバーで切替（定時の仕事）→ 古いタブが知らずに直す（未送信） */
      rpcSwitch(env);
      await oldEdit(old);
      await sleep(3000);
    }
    const nw = await openTab(env, 'new', 'new');
    if (mode === 'A2') {
      /* 古いタブが、新しいタブの書いた切替後の中身を、古い版の画面の統合（csMergeEventsFrom_＝予定の id ごとの和）で取り込んで書く。
         書き手の指紋がタブの間で共有のため、ふだんの storage の受け口では起きにくいので、古い版の画面の本物の関数を直接呼んで作る */
      await sleep(1500);
      const mixed = await old.evaluate(() => {
        const other = JSON.parse(localStorage.getItem('care_schedule_v2')); DB = csMergeEventsFrom_(other, DB); saveDB();
        const d = JSON.parse(localStorage.getItem('care_schedule_v2')); const r = d.residents.find((x) => x.id === 'fl01');
        return (r.planGen || 0) === 0 && r.events.some((e) => e.id === 'p_new') && r.events.some((e) => e.id === 'fl0_v2');
      });
      t(mode + ': 古いタブは和で混ぜた中身（世代0のまま・切替後の予定 p_new と前の計画の fl0_v2 の両方を持つ）を書いた', mixed);
    }
    await waitFor(() => env.st.switched > 0 && nw.evaluate(() => DB.residents.find((x) => x.id === 'fl01').planGen === 1), 20000);
    t(mode + ': サーバーで切り替わり、新しいタブは切替後を持つ', env.st.switched === 1 && await nw.evaluate(() => DB.residents.find((x) => x.id === 'fl01').planGen === 1));
    await sleep(2500);   /* A2: 古いタブが新しいタブの書き込みを取り込む */
    if (mode === 'A') await oldEdit(old);
    await sleep(4000);
    t(mode + ': 古いタブは未送信のまま止まる', await old.evaluate(() => SYNC._dirty === true));
    /* 新しいタブ: 別タブの書き込みを取り込み、今の計画を1件直して送る */
    await sleep(1500);
    await nw.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); const e = r.events.find((x) => x.id === 'p_new'); if (e) e.detail = '新しいタブの架空の直し'; saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
    await settle(nw);
    const sum = checkSwitched(mode, env, (r) => (r.events.find((e) => e.id === 'p_new') || {}).detail === '新しいタブの架空の直し');
    const fl02 = srvRes(env, 'fl02').events[0].notes;
    oldRejected(mode, env);
    const toasts = await nw.evaluate(() => window.__toasts);
    results.push({ mode, server: sum, fl02notes: fl02, newTabToasts: toasts, log: env.st.kv.log.map((l) => (l.tag || '?') + ':' + l.result) });
    if (shots) await nw.screenshot({ path: path.join(shots, 'oldtab-' + mode + '.png') });
  } finally {
    t(mode + ': 画面のエラーなし', env.st.errors.length === 0, env.st.errors);
    t(mode + ': 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
    await env.context.close();
  }
}

/* ═════ B ═════ */
if (run('B')) {
  console.log('\n— B 古いタブを閉じた後（切替前の中身と未送信の印が残る）に新しいタブを開く —');
  const env = await makeEnv({ db: planDb() });
  try {
    const old = await openTab(env, 'old', 'old');
    await old.evaluate(() => SYNC.stopPolling());
    /* サーバーで切替（定時の仕事）→ 古いタブは知らずに直して保存 → 断られて未送信のまま閉じる */
    rpcSwitch(env);
    await oldEdit(old);
    await sleep(3500);
    t('B: 古いタブは未送信のまま止まる', await old.evaluate(() => SYNC._dirty === true && localStorage.getItem('care_schedule_dirty_v1') === '1'));
    await old.close();
    const nw = await openTab(env, 'new', 'new');
    await sleep(2000);
    /* 職員が新しいタブで別の方を直して保存する（送る） */
    await nw.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl03'); if (r.events[0]) r.events[0].notes = '新しいタブの架空の直し'; saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
    await settle(nw, 15000);
    const sum = checkSwitched('B', env);
    const newLog = env.st.kv.log.filter((l) => l.tag === 'new').map((l) => l.result);
    t('B: 新しいタブの最初の送信は planstale で断られ、取り直して統合した送り直しが通る', newLog[0] && /^planstale/.test(newLog[0]) && newLog.includes('ok'), newLog);
    const toasts = await nw.evaluate(() => window.__toasts);
    t('B: 新しいタブに「ほかの端末で計画が切り替わったため、この端末の未送信の変更 n件は反映していません」が出る', toasts.some((m) => /ほかの端末で計画が切り替わったため、この端末の未送信の変更 \d+件は反映していません/.test(m)), toasts);
    t('B: 新しいタブの別の方の直しは入る', srvRes(env, 'fl03').events[0].notes === '新しいタブの架空の直し');
    oldRejected('B', env);
    results.push({ mode: 'B', server: sum, fl02notes: srvRes(env, 'fl02').events[0].notes, newTabToasts: toasts, log: env.st.kv.log.map((l) => (l.tag || '?') + ':' + l.result) });
  } finally {
    t('B: 画面のエラーなし', env.st.errors.length === 0, env.st.errors);
    t('B: 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
    await env.context.close();
  }
}
function rpcSwitch(env) {
  const st = env.st;
  st.kv.data = Object.assign({}, st.kv.data, { residents: st.kv.data.residents.map((r) => C.applyDue(r, today, '').res) });
  st.kv.rev++; st.switched++;
}

/* ═════ D ═════ */
if (run('D')) {
  console.log('\n— D 切替の後に開いた古いタブが今の計画を1件直す → 新しいタブが運ぶ（正当な直しとして通る） —');
  const env = await makeEnv({ db: planDb() });
  try {
    rpcSwitch(env);
    const nw = await openTab(env, 'new', 'new');
    const old = await openTab(env, 'old', 'old');
    await old.evaluate(() => SYNC.stopPolling());
    t('D: 古いタブは切替後の中身（世代1）', await old.evaluate(() => DB.residents.find((x) => x.id === 'fl01').planGen === 1));
    await old.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); const e = r.events.find((x) => x.id === 'p_new'); e.startTime = '10:00'; saveDB(); });
    await sleep(3500);
    t('D: 古いタブ自身の送信は断られて未送信のまま', await old.evaluate(() => SYNC._dirty === true));
    await sleep(1500);
    await nw.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl03'); if (r.events[0]) r.events[0].notes = '新しいタブの架空の直し'; saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
    await settle(nw);
    const sum = checkSwitched('D', env, (r) => (r.events.find((e) => e.id === 'p_new') || {}).startTime === '10:00');
    oldRejected('D', env);
    results.push({ mode: 'D', server: sum, newTabToasts: await nw.evaluate(() => window.__toasts), log: env.st.kv.log.map((l) => (l.tag || '?') + ':' + l.result) });
  } finally {
    t('D: 画面のエラーなし', env.st.errors.length === 0, env.st.errors);
    t('D: 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
    await env.context.close();
  }
}

/* ═════ E ═════ */
if (run('E')) {
  console.log('\n— E 予約を使っていない時: 送れない古いタブの未送信を別のタブが運ぶ（古い版どうし と 古い版＋新しい版 で同じ結果） —');
  /* 除いて比べる項目: editedAt・editedBy（直した時刻と人）・updatedAt（サービス辞書などを整えた時刻）・csAppVer（版の印） */
  const strip = (d) => JSON.parse(JSON.stringify(d), (k, v) => (k === 'editedAt' || k === 'editedBy' || k === 'updatedAt' || k === 'csAppVer' ? undefined : v));
  const outs = {};
  for (const carrier of ['old', 'new']) {
    const db = F.careDb(); db.currentResidentId = 'fl01';
    const env = await makeEnv({ db, blockOld: true });
    try {
      const x = await openTab(env, 'old', 'old-x');
      await x.evaluate(() => SYNC.stopPolling());
      await x.evaluate(() => { const r = DB.residents.find((y) => y.id === 'fl02'); r.events.push({ id: 'e_E1', dayOfWeek: 5, serviceType: 'visit', category: '身体１', startTime: '15:00', endTime: '15:30', detail: '送れなかった架空の支援', notes: '', units: 0, bathing: false }); saveDB(); });
      await sleep(3500);
      t('E(' + carrier + '): 送れない古いタブは未送信を抱える', await x.evaluate(() => SYNC._dirty === true));
      const y = await openTab(env, carrier, carrier === 'old' ? 'old-y' : 'new');
      await sleep(2000);
      await y.evaluate(() => { const r = DB.residents.find((z) => z.id === 'fl03'); if (r.events[0]) r.events[0].notes = '運ぶタブの架空の直し'; saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
      await settle(y);
      outs[carrier] = { data: strip(env.st.kv.data), log: env.st.kv.log.map((l) => (l.tag || '?') + ':' + l.result), carried: env.st.kv.data.residents.find((r) => r.id === 'fl02').events.some((e) => e.id === 'e_E1') };
    } finally {
      t('E(' + carrier + '): 画面のエラーなし', env.st.errors.length === 0, env.st.errors);
      t('E(' + carrier + '): 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
      await env.context.close();
    }
  }
  const same = JSON.stringify(outs.old.data) === JSON.stringify(outs.new.data);
  let firstDiff = null;
  if (!same) {
    const a1 = JSON.stringify(outs.old.data), b1 = JSON.stringify(outs.new.data); let i = 0; while (i < a1.length && a1[i] === b1[i]) i++;
    firstDiff = { at: i, oldOldPair: a1.slice(Math.max(0, i - 150), i + 150), oldNewPair: b1.slice(Math.max(0, i - 150), i + 150) };
  }
  t('E: 古い版どうし と 古い版＋新しい版 でサーバーの結果が同じ（editedAt・editedBy・updatedAt・版の印を除く）', same, same ? undefined : firstDiff);
  results.push({ mode: 'E', same, carriedByOld: outs.old.carried, carriedByNew: outs.new.carried, oldLog: outs.old.log, newLog: outs.new.log });
}

/* ═════ G ═════ */
if (run('G')) {
  console.log('\n— G 版の印は共通 DB の口 cs_plan_gate が答えた時だけ付く（0136 より前の本番に印を残さない・反証 F1） —');
  const lastNew = (env) => env.st.kv.log.filter((l) => l.tag === 'new').pop();
  const lsHas = (page) => page.evaluate(() => String(localStorage.getItem('care_schedule_v2') || '').includes('csAppVer'));
  const editPush = (page, note) => page.evaluate((n) => { const r = DB.residents.find((x) => x.id === 'fl03'); if (r.events[0]) r.events[0].notes = n; saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); }, note);
  for (const c of [
    { k: 'G1', title: '0136 より前（口が無い・印を除かずに保存する）・予約あり', gate: false, pre0136: true, dirty: false, want: null },
    { k: 'G2', title: '0136 あり（口が答える）・予約あり', gate: true, pre0136: false, dirty: false, want: 2026112701 },
    { k: 'G3', title: '0136 より前の本番に印が保存されていた（取得した中身に csAppVer）・口が無い', gate: false, pre0136: true, dirty: true, want: null },
    { k: 'G4', title: '取得した中身に csAppVer があり、口は答える', gate: true, pre0136: false, dirty: true, want: 2026112701 },
  ]) {
    const db = planDb(); if (c.dirty) db.csAppVer = 2026112701;
    const env = await makeEnv({ db, gate: c.gate, pre0136: c.pre0136 });
    try {
      const nw = await openTab(env, 'new', 'new');
      await sleep(1500);
      t(c.k + ' ' + c.title + ': 取り込んだ中身（DB）と端末の控えに版の印が無い', !(await nw.evaluate(() => Object.prototype.hasOwnProperty.call(DB, 'csAppVer'))) && !(await lsHas(nw)));
      const n0 = env.st.kv.log.length;
      await editPush(nw, c.k + ' の架空の直し');
      await settle(nw, 15000);
      const sent = env.st.kv.log.slice(n0).filter((l) => l.tag === 'new');
      const ok = sent.filter((l) => l.result === 'ok');
      t(c.k + ': 送った本文の版の印は ' + (c.want === null ? '無い' : c.want) + '（送った ' + sent.length + '本すべて）', sent.length > 0 && sent.every((l) => l.ver === c.want), sent.map((l) => [l.ver, l.result]));
      t(c.k + ': 保存が通り、直しがサーバーに入る', ok.length > 0 && srvRes(env, 'fl03').events[0].notes === c.k + ' の架空の直し', sent.map((l) => l.result));
      if (c.pre0136) t(c.k + ': 0136 より前のサーバー（印を除かない）に版の印が残らない', !Object.prototype.hasOwnProperty.call(env.st.kv.data, 'csAppVer'));
      else t(c.k + ': サーバーの中身に版の印が残らない', !JSON.stringify(env.st.kv.data).includes('csAppVer'));
      t(c.k + ': 送った後も端末の控えに版の印が無い', !(await lsHas(nw)));
      if (c.k === 'G3') {
        /* 別タブが印つきの中身を端末の控えに書いた時も、取り込み・次の送信に持ち回さない */
        const tab2 = await env.context.newPage();
        await tab2.goto(srv.url + '/new/su-backend.json');
        await tab2.evaluate(() => { const d = JSON.parse(localStorage.getItem('care_schedule_v2')); d.csAppVer = 2026112701; const r = d.residents.find((x) => x.id === 'fl02'); r.events[0].notes = '別タブの架空のメモ'; localStorage.setItem('care_schedule_v2', JSON.stringify(d)); });
        await tab2.close();
        await sleep(2000);
        const n1 = env.st.kv.log.length;
        await editPush(nw, 'G3 の2回目の架空の直し');
        await settle(nw, 15000);
        const sent2 = env.st.kv.log.slice(n1).filter((l) => l.tag === 'new');
        t('G3: 別タブが印つきで書いた中身を取り込んでも、DB・端末の控えに印が無い', !(await nw.evaluate(() => Object.prototype.hasOwnProperty.call(DB, 'csAppVer'))) && !(await lsHas(nw)));
        t('G3: 次の送信にも印が無い（' + sent2.length + '本）', sent2.length > 0 && sent2.every((l) => l.ver === null), sent2.map((l) => [l.ver, l.result]));
        t('G3: 別タブの直しも取り込んで送っている', srvRes(env, 'fl02').events[0].notes === '別タブの架空のメモ');
      }
      results.push({ mode: c.k, log: env.st.kv.log.map((l) => (l.tag || '?') + ':' + l.result + ':' + l.ver) });
    } finally {
      t(c.k + ': 画面のエラーなし', env.st.errors.length === 0, env.st.errors);
      t(c.k + ': 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
      await env.context.close();
    }
  }
}

console.log('\n── 場面ごとのサーバーの最後の中身（要約） ──');
results.forEach((r) => console.log(JSON.stringify(r)));
await browser.close();
await srv.close();
try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* 消せなくても結果は変わらない */ }
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
