/* check/load-latency.mjs — 画面を開いてから使えるまでの通信を数える道具（2026-11-16 新設）
 *
 *   node check/load-latency.mjs [--pages a.html,b.html] [--lat 700] [--device office|field] [--json 保存先] [--root 測るフォルダ]
 *
 * 本物の Chromium で画面を開き、通信を全部横取りして偽物が答える（check/fixtures/flow.mjs と同じ架空データ）。
 * 外への通信（GAS・Supabase）は1本ごとに --lat ミリ秒（既定 700）遅らせて答え、同じサイトのファイルは
 * 「50ms＋大きさ÷2MB/秒」遅らせて返す（現場の回線のおおよそ）。画面のコードは1文字も変えない。
 *
 * 画面ごとに出すもの:
 *   ready … 画面が SUPerf.ready を呼んだ時刻（呼ばない画面は「―」）
 *   idle  … 最後の通信が終わった時刻（開いてから 12 秒まで見る）
 *   外N   … GAS・Supabase への通信の本数（OPTIONS は数えない）
 *   直列  … 外への通信が「前の通信の答えを待ってから」出た段の数のいちばん長い鎖（多いほど待たされる）
 *   重複  … 同じ相手・同じ中身の外への通信が2回以上出た組（無駄な往復）
 *   静的KB … 同じサイトから読んだファイルの合計
 *
 * 読むだけ・ネットへは出ない（横取りしていない外への通信は止めて「外へ出かけた」に数える）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs, listPages } from './lib.mjs';
import * as F from './fixtures/flow.mjs';

const args = parseArgs(process.argv.slice(2));
/* --root で別のフォルダ（例: main の写し）の画面を測れる（直す前と後を同じ道具で比べるため） */
const repoDir = args.root ? path.resolve(String(args.root)) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAT = Number(args.lat || 700);
const DEVICE = args.device === 'field' ? 'field' : 'office';
const WATCH_MS = Number(args.watch || 12000);
/* --live: 切り替えスイッチを測る側の su-backend.json のまま使い（本番と同じ道）、新しい保存先の主な読み取り
   （res_mode_get・res_roster・res_get・kv_get・kv_head・kv_entries）に架空の答えを返す。ほかの関数は「無い」と答える */
const LIVE = !!args.live;
const pages = args.pages ? String(args.pages).split(',').map((s) => s.trim()).filter(Boolean) : listPages(repoDir);
const { chromium } = loadPlaywright();

const srv = await startServer(repoDir);
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

async function measure(pg) {
  const master = F.createMaster();
  const kv = F.createKv({ care_schedule_v2: F.careDb() });
  const st = { sb: [] };
  const sbFake = F.supabase(st, 'office');
  const reqs = [];
  const errors = [];
  const ext = [];
  const flags = LIVE ? JSON.parse(fs.readFileSync(path.join(repoDir, 'su-backend.json'), 'utf8')) : F.FLAGS_OFF;
  const recs = F.masterRecords();
  const liveAnswer = (fn, b) => {
    if (fn === 'res_mode_get') return { mode: 'live', stateRev: 1 };
    if (fn === 'res_roster') return { ok: true, rows: recs };
    if (fn === 'res_get') { const ids = (b.p_ids || []).map(String); return { ok: true, rows: recs.filter((r) => ids.includes(String(r.id))) }; }
    if (fn === 'kv_get') return b.p_key === 'care_schedule_v2' ? { ok: true, rev: 1, data: F.careDb(), mode: 'live', updatedAt: '' } : { ok: true, rev: 1, data: null, mode: 'live', updatedAt: '' };
    if (fn === 'kv_head') return { revs: {} };
    return undefined;
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  await context.addInitScript(({ s }) => {
    try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) { /* 控えが使えない時は何もしない */ }
    /* SUPerf.ready を呼んだ時刻を __suReadyAt に控える（su-perf.js が window.SUPerf に入れた時に ready を包む） */
    let held;
    Object.defineProperty(window, 'SUPerf', { configurable: true, get() { return held; }, set(v) {
      if (v && typeof v.ready === 'function') { const o = v.ready; v.ready = function () { if (window.__suReadyAt == null) window.__suReadyAt = Math.round(performance.now()); return o.apply(this, arguments); }; }
      held = v;
    } });
  }, { s: { ...F.storage(DEVICE), su_perf_off: '1', su_backend_flags: JSON.stringify(flags) } });
  let t0 = 0;
  const now = () => Date.now() - t0;
  const bodyKey = (req) => {
    const pd = req.postData() || '';
    return req.method() + ' ' + req.url().split('#')[0] + ' ' + crypto.createHash('sha1').update(pd).digest('hex').slice(0, 10);
  };
  const label = (req) => {
    const u = new URL(req.url());
    if (u.hostname.endsWith('supabase.co')) return 'sb:' + u.pathname.replace(/^\/(rest|auth|functions)\/v1\//, '').replace(/^rpc\//, '');
    let b = {};
    if (req.method() === 'GET') b = Object.fromEntries(u.searchParams);
    else { try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; } }
    const who = u.pathname.includes('MASTER') ? 'master' : u.pathname.includes('SYNC') ? 'sync' : 'gas';
    return who + ':' + (b.action || '?') + (b.key ? '(' + b.key + ')' : '') + (b.section ? '[' + b.section + ']' : '');
  };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      const rel = decodeURIComponent(u.slice(srv.url.length).split('?')[0]);
      if (/\/su-backend\.json$/.test(rel)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) });
      let size = 0;
      try { size = fs.statSync(path.join(repoDir, rel)).size; } catch (e) { size = 0; }
      const r = { kind: 'static', name: rel, start: now(), size };
      reqs.push(r);
      await wait(50 + size / 2000);
      r.end = now();
      return route.continue();
    }
    const isExt = u.startsWith(F.MASTER_URL) || u.startsWith(F.SYNC_URL) || u.startsWith(F.SB + '/');
    if (!isExt) { ext.push(req.method() + ' ' + u.slice(0, 120)); return route.abort(); }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const r = { kind: 'ext', name: label(req), key: bodyKey(req), start: now() };
    reqs.push(r);
    await wait(LAT);
    r.end = now();
    if (u.startsWith(F.SB + '/')) {
      if (LIVE) {
        const pth = new URL(u).pathname;
        const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(pth);
        let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
        const out = m ? liveAnswer(m[1], b) : (/\/rest\/v1\/kv_entries$/.test(pth) ? [] : undefined);
        if (out !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
      }
      return sbFake(route);
    }
    let b = {};
    if (req.method() === 'GET') b = Object.fromEntries(new URL(u).searchParams);
    else { try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; } }
    const out = u.startsWith(F.MASTER_URL) ? master.respond(b) : kv.respond(b);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e && e.message).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  t0 = Date.now();
  try { await page.goto(srv.url + '/' + pg, { waitUntil: 'load', timeout: 30000 }); } catch (e) { errors.push('goto: ' + String(e.message).slice(0, 80)); }
  const loadAt = now();
  await wait(WATCH_MS - Math.min(loadAt, WATCH_MS - 1000));
  let ready = null;
  try { ready = await page.evaluate(() => window.__suReadyAt == null ? null : window.__suReadyAt); } catch (e) { ready = null; }
  await context.close();
  /* 直列の鎖: 外への通信 r の深さ＝ r が出る前に終わっていた外への通信の深さの最大＋1 */
  const exts = reqs.filter((r) => r.kind === 'ext' && r.end != null).sort((a, b) => a.start - b.start);
  for (const r of exts) {
    let d = 0;
    for (const q of exts) if (q !== r && q.end <= r.start + 5 && q.depth != null) d = Math.max(d, q.depth);
    r.depth = d + 1;
  }
  const depth = exts.reduce((m, r) => Math.max(m, r.depth), 0);
  const dupMap = new Map();
  for (const r of exts) dupMap.set(r.key, (dupMap.get(r.key) || []).concat(r));
  const dups = [...dupMap.values()].filter((l) => l.length > 1).map((l) => l[0].name + '×' + l.length);
  const idle = reqs.reduce((m, r) => Math.max(m, r.end || 0), 0);
  const staticKB = Math.round(reqs.filter((r) => r.kind === 'static').reduce((s, r) => s + r.size, 0) / 1024);
  const staticN = reqs.filter((r) => r.kind === 'static').length;
  return { page: pg, loadAt, idle, ready, extN: exts.length, depth, dups, staticKB, staticN, errors, ext,
    seq: exts.map((r) => r.depth + ':' + r.name + '@' + r.start + '-' + r.end),
    stat: reqs.filter((r) => r.kind === 'static').map((r) => r.name + '@' + r.start + '-' + r.end) };
}

const out = [];
for (const pg of pages) {
  const r = await measure(pg);
  out.push(r);
  console.log([r.page.padEnd(26), 'load ' + String(r.loadAt).padStart(5), 'ready ' + String(r.ready == null ? '―' : r.ready).padStart(5), 'idle ' + String(r.idle).padStart(5),
    '外' + String(r.extN).padStart(3), '直列' + String(r.depth).padStart(2), '静的' + String(r.staticN).padStart(3) + '本 ' + String(r.staticKB).padStart(5) + 'KB',
    r.dups.length ? '重複 ' + r.dups.join(' ') : '', r.errors.length ? 'エラー' + r.errors.length : '', r.ext.length ? '外へ' + r.ext.length : ''].join('  '));
}
if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(out, null, 1));
await browser.close();
await srv.close();
