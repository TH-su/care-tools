/* check/fail-inject/observe.mjs — 失敗を起こして、画面がどう見せたかを数える（2026-10-31 新設）
 *
 *   node check/fail-inject/observe.mjs --ls-keys check/fail-inject/ls-keys.sample.json [--sb http://127.0.0.1:55421]
 *        [--sb-accounts <試験用アカウントのファイル>] [--only ws-gas,ws-sb,sb-rls,rm-gas] [--measure <measure.json>] [--run 1|2]
 *     試験用 Supabase の公開鍵は環境変数 SU_FI_SB_KEY で渡す（表示しない・ファイルに書かない）。
 *     試験用アカウントのファイルは「メール 空白 パスワード」の行（中身は表示しない・記録に書かない）。役割はログインして確かめる。
 *
 * 何をするか:
 *   ・serve.mjs を1つ立て、使い捨てのプロファイル（~/.claude/scripts/lib/chrome-temp.mjs の makeTempProfile）で
 *     ヘッドレス Chrome の文脈を2つ（A・B）作る。ポートは固定しない。終わった時・止められた時にプロファイルを消す。
 *   ・画面の接続先は、画面が受け付ける Google の形の架空の住所にし、その住所への通信を同じ serve.mjs の /__fake-gas/ へ回す
 *     （画面のコードは変えない。CSP の connect-src も変えない）。接続先の localStorage の鍵は --ls-keys で受ける（推測しない）。
 *   ・架空データ（check/fixtures の見本）で画面を開き、台本の回だけ失敗を起こしながら保存の操作をして、次の4つを数える:
 *       (i)   保存の失敗が画面に出た回数（同期の表示・知らせ・確かめの窓）
 *       (ii)  偽って「保存しました」と出た回数（保存の操作の後、サーバーに1件も書けていないのに成功の表示が出た）
 *       (iii) 送信待ちが残り、台本の失敗が終わった後に届いた回数
 *       (iv)  もう一方の文脈を読み込み直した時に古い値へ巻き戻った回数（B の表示がサーバーより少ない・サーバーの中身が減った・古い版の上書きが通った）
 *     要求ごとの「HTTP の成否」と「アプリの ok:false」は別の列で数える。
 *   ・対象（使用頻度の順）: ワークスケジュール（GAS の道＝統合KV）→ ワークスケジュール（Supabase の道＝試験用 Supabase）
 *     → 試験用 Supabase の RLS の断り（現場アカウント×事務所専用の書き込み kv_put）→ 入居者マスタ（GAS の道）
 *   ・記録: check/out/fail-inject/<日時>.json。--measure を渡すと、その measure.json の item 1 の行を書き足す・直す。
 * ★ワークスケジュールの競合の決まりは「未送信あり＝端末の方を優先」。巻き戻りはその決まりを前提に数え、直さない。
 * ★コンソールへの書き出しは使わない（進み具合は process.stdout・記録はファイル）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, parseArgs, ensureDir, writeJson, readJson } from '../lib.mjs';
import { startFailInjectServer } from './serve.mjs';
import { createKvBackend, createMasterBackend, FAILURE_KINDS } from './gas-script.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const args = parseArgs(process.argv.slice(2));
const say = (s) => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 画面が受け付ける形の架空の接続先（ここへの通信は全部 serve.mjs の /__fake-gas/ へ回す＝外へ出ない） */
const GAS_URL = { kv: 'https://script.google.com/macros/s/FAIL-INJECT-KV/exec', master: 'https://script.google.com/macros/s/FAIL-INJECT-MASTER/exec' };
const OBS_POINTS = ['failureShown', 'falseSaved', 'deliveredLater', 'rollback'];
const FAIL_RE = /⚠|失敗|できません|競合|確認できず|止めました|オフライン|保存されていません|未送信/;
const OK_RE = /✓同期|送信完了|保存しました|保存OK|届いていました/;

/* 使い捨てのプロファイル。~/.claude の部品があればそれを使い、無い環境（CI など）では同じ決まりの控えで作って消す */
async function tempProfileMaker() {
  const lib = path.join(os.homedir(), '.claude', 'scripts', 'lib', 'chrome-temp.mjs');
  if (fs.existsSync(lib)) return (await import(pathToFileURL(lib).href)).makeTempProfile;
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 消せなければ残る */ } };
    process.once('exit', cleanup);
    return { dir, cleanup, args: [`--user-data-dir=${dir}`, '--no-first-run', '--disk-cache-size=1'] };
  };
}

const lsKeysFile = args['ls-keys'];
if (!lsKeysFile || lsKeysFile === 'true') { say('使い方: --ls-keys <画面ごとの接続先の localStorage の鍵の JSON> が要ります（例: check/fail-inject/ls-keys.sample.json）'); process.exit(2); }
const LS_KEYS = JSON.parse(fs.readFileSync(lsKeysFile, 'utf8'));
const only = args.only && args.only !== 'true' ? String(args.only).split(',') : ['ws-gas', 'ws-sb', 'sb-rls', 'rm-gas'];
const sbTarget = args.sb && args.sb !== 'true' ? args.sb : null;
const sbKey = process.env.SU_FI_SB_KEY || '';

function storageFor(page, extra) {
  const tpl = LS_KEYS[page];
  if (!tpl) throw new Error(`--ls-keys に ${page} がありません`);
  const out = {};
  for (const [k, v] of Object.entries(tpl)) out[k] = (typeof v === 'string' ? v : JSON.stringify(v)).replaceAll('{{GAS_KV}}', GAS_URL.kv).replaceAll('{{GAS_MASTER}}', GAS_URL.master);
  return Object.assign(out, extra || {});
}

const pw = loadPlaywright();
const makeTempProfile = await tempProfileMaker();
const opened = [];   // {ctx, prof}
async function closeAll() {
  for (const o of opened.splice(0)) { try { await o.ctx.close(); } catch (e) { /* 閉じている */ } try { o.prof.cleanup(); } catch (e) { /* 消せない */ } }
}
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { if (stopping) return; stopping = true; await closeAll(); process.exit(130); });

/* 文脈を1つ作る（使い捨てのプロファイル・ポート固定なし）。fakeGas: {Google の形の住所 → 偽 GAS の名前} */
async function openContext(label, server, storage, extraRoutes) {
  const prof = makeTempProfile('fail-inject-' + label + '-');
  const ctx = await pw.chromium.launchPersistentContext(prof.dir, {
    headless: true, args: prof.args.filter((a) => !a.startsWith('--user-data-dir')),
    viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block',
  });
  opened.push({ ctx, prof });
  for (const [name, url] of Object.entries(GAS_URL)) {
    await ctx.route(url.replace('/exec', '/**'), async (route) => {
      try {
        const resp = await route.fetch({ url: server.url + '/__fake-gas/' + name, timeout: 0, maxRedirects: 0 });
        await route.fulfill({ response: resp });
      } catch (e) { try { await route.abort('connectionreset'); } catch (e2) { /* 画面が先に諦めた */ } }
    });
  }
  for (const rt of (extraRoutes || [])) await ctx.route(rt.match, rt.handle);
  /* 端末の設定は「まだ無い時だけ」入れる（読み込み直しで端末の控えを上書きしない）。表示の変化を時刻つきで控える */
  await ctx.addInitScript((cfg) => {
    try { for (const k of Object.keys(cfg.storage)) if (localStorage.getItem(k) === null) localStorage.setItem(k, cfg.storage[k]); } catch (e) { /* 保存領域が使えない */ }
    window.__fi = { ev: [] };
    const rec = (sel, el) => { try { window.__fi.ev.push({ t: Date.now(), sel, text: String(el.textContent || '').slice(0, 160), cls: String(el.className || '') }); } catch (e) { /* 控えられない */ } };
    const arm = () => {
      for (const sel of cfg.watch) {
        const el = document.querySelector(sel);
        if (el && !el.__fiArmed) { el.__fiArmed = true; new MutationObserver(() => rec(sel, el)).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }
      }
    };
    document.addEventListener('DOMContentLoaded', arm);
    setInterval(arm, 300);
  }, { storage, watch: ['#saveState', '#badgeSync', '#toast', '#stResult', '#syncStatus'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.__dialogs = [];
  page.on('dialog', async (d) => { page.__dialogs.push({ t: Date.now(), text: d.message().slice(0, 160) }); try { await d.accept(); } catch (e) { /* 閉じた */ } });
  page.__errors = 0;
  page.on('pageerror', () => { page.__errors++; });
  return { ctx, page, label };
}

/* 通信が静かになるまで待つ（最後の要求から quiet ミリ秒） */
async function waitQuiet(server, quiet = 3000, max = 60000) {
  const st = Date.now();
  while (Date.now() - st < max) {
    const last = server.log.length ? server.log[server.log.length - 1].t : 0;
    if (Date.now() - last >= quiet) return true;
    await sleep(250);
  }
  return false;
}
async function events(page, since) {
  const ev = await page.evaluate(() => (window.__fi && window.__fi.ev) || []).catch(() => []);
  return ev.concat(page.__dialogs.map((d) => ({ t: d.t, sel: 'dialog', text: d.text, cls: '' }))).filter((e) => e.t >= since);
}
const isFail = (e) => FAIL_RE.test(e.text) || (e.sel === '#toast' && /\bng\b/.test(e.cls)) || (e.sel === '#syncStatus' && /\berr\b/.test(e.cls));
const isOk = (e) => !isFail(e) && OK_RE.test(e.text);

/* 1つの場面の数え方。writes＝その場面で数える書き込みの記録（log の行）、tClick＝保存の操作をした時刻 */
function countScenario(server, fromIdx, tClick, evA, writeEntry) {
  const rows = server.log.slice(fromIdx);
  const writes = rows.filter((e) => writeEntry(e));
  const injected = rows.filter((e) => e.injected);
  const httpFail = writes.filter((e) => e.http !== 200 && !(typeof e.http === 'number' && e.http >= 200 && e.http < 300)).length;
  const appFail = writes.filter((e) => typeof e.http === 'number' && e.http >= 200 && e.http < 300 && e.bodyOk === false).length;
  const landed = writes.filter((e) => e.landed);
  /* (i) 失敗の後に失敗の表示が出た、または失敗から3秒たっても失敗の表示（未送信あり等）が残っている */
  const firstInj = injected.length ? Math.min(...injected.map((e) => e.t)) : tClick;
  const stateAt = (t) => { const last = {}; for (const e of evA) if (e.t <= t && e.sel !== 'dialog') last[e.sel] = e; return Object.values(last).some(isFail); };
  const failureShown = (evA.some((e) => isFail(e) && e.t >= firstInj) || stateAt(firstInj + 3000)) ? 1 : 0;
  let falseSaved = 0;
  for (const e of evA.filter(isOk)) if (!landed.some((w) => w.landedAt && w.landedAt >= tClick && w.landedAt <= e.t)) falseSaved++;
  const lastInj = injected.length ? Math.max(...injected.map((e) => e.t)) : 0;
  const lost = injected.some((e) => !e.landed);
  const deliveredLater = (lost && landed.some((w) => w.landedAt > lastInj)) ? 1 : 0;
  return { requests: rows.length, writes: writes.length, injected: injected.length, httpFail, appFail, landed: landed.length,
    failureShown, falseSaved, deliveredLater, injectedKinds: [...new Set(injected.map((e) => (e.via === 'sb' ? 'sb:' : 'gas:') + e.injected))] };
}

const outDir = ensureDir(path.join(REPO, 'check', 'out', 'fail-inject'));
const result = { startedAt: new Date().toISOString(), run: args.run || '1', scenarios: [], kindsFired: [], notes: [] };

async function wsNotes(page) { return page.evaluate(() => document.querySelectorAll('#noteLayer .b-note').length).catch(() => -1); }
function serverNotes(be, key) { const e = be.kv.get(key); return e && e.data && e.data.meta && Array.isArray(e.data.meta.notes) ? e.data.meta.notes.length : 0; }
function serverNoteIds(be, key) { const e = be.kv.get(key); return new Set(e && e.data && e.data.meta && Array.isArray(e.data.meta.notes) ? e.data.meta.notes.map((n) => n.id) : []); }

/* ── ワークスケジュール（GAS の道・統合KV）── */
async function runWsGas(server) {
  const ws = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'work-schedule.mjs')).href);
  const cs = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'care-schedule.mjs')).href);
  const be = createKvBackend(ws.seed());
  server.setBackend('kv', be);
  server.setFlags(cs.FLAGS_OFF);
  server.setScript([]);
  const st = storageFor('work-schedule.html');
  const A = await openContext('ws-a', server, st);
  const B = await openContext('ws-b', server, st);
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/work-schedule.html', { waitUntil: 'domcontentloaded' });
    await X.page.waitForSelector('#btnAddNote', { state: 'visible', timeout: 60000 });
    await waitQuiet(server, 4000, 90000);
  }
  const plan = [
    { kind: 'deny', times: 2, wait: 60000 },
    { kind: 'conflict', times: 1, wait: 60000 },
    { kind: 'nores', times: 2, wait: 120000 },
    { kind: 'timeout', times: 1, wait: 150000 },
  ];
  for (const p of plan) {
    say(`  ワークスケジュール（GAS）: ${p.kind} を ${p.times} 回`);
    const putKeyBefore = [...be.kv.keys()].filter((k) => /^wsday_/.test(k));
    server.setScript([{ entry: 'put', nth: 1, kind: p.kind, times: p.times }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#btnAddNote');
    await A.page.keyboard.type('見本の印 ' + p.kind).catch(() => {});
    await A.page.mouse.click(5, 5).catch(() => {});
    /* 台本の失敗が全部起きて、その後に書けるか、待ちの上限まで */
    const st0 = Date.now();
    while (Date.now() - st0 < p.wait) {
      const rep = server.engine().report()[0];
      const rows = server.log.slice(fromIdx);
      const lastInj = Math.max(0, ...rows.filter((e) => e.injected).map((e) => e.t));
      if (rep.fired >= rep.times && rows.some((e) => e.entry === 'put' && e.landed && e.landedAt > lastInj)) break;
      await sleep(500);
    }
    await waitQuiet(server, 4000, 30000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, (e) => e.via === 'gas' && e.app === 'kv' && e.entry === 'put');
    const key = (server.log.slice(fromIdx).find((e) => e.entry === 'put' && /^wsday_/.test(e.key || '')) || {}).key || putKeyBefore[0];
    /* (iii) の確かめ: 届いた後、A の表示の印の数がサーバーにも載っている */
    const aNotes = await wsNotes(A.page), sNotesA = serverNotes(be, key);
    if (c.deliveredLater && sNotesA < aNotes) c.deliveredLater = 0;
    /* (iv) B を読み込み直す。B に未送信は無い＝サーバーの盤面を採るのが正しい */
    const idsBefore = serverNoteIds(be, key);
    await B.page.reload({ waitUntil: 'domcontentloaded' });
    await B.page.waitForSelector('#btnAddNote', { state: 'visible', timeout: 60000 }).catch(() => {});
    await waitQuiet(server, 5000, 60000);
    const bNotes = await wsNotes(B.page), sNotes = serverNotes(be, key);
    const idsAfter = serverNoteIds(be, key);
    const lostIds = [...idsBefore].filter((id) => !idsAfter.has(id)).length;
    c.rollback = (bNotes >= 0 && bNotes < sNotes) || lostIds > 0 ? 1 : 0;
    const rep = server.engine().report()[0];
    result.scenarios.push(Object.assign({ app: 'ワークスケジュール', path: 'GAS（統合KV）', kind: 'gas:' + p.kind, scriptTimes: rep.times, fired: rep.fired,
      notes: { a: aNotes, b: bNotes, server: sNotes, lostIds }, pageErrors: A.page.__errors + B.page.__errors }, c));
  }
  await closeAll();
}

/* 試験用 Supabase へログインして、supabase-js が端末に置く形の控えを作る（資格は表示しない・記録しない） */
async function sbSessions(server) {
  const file = args['sb-accounts'];
  if (!file || file === 'true' || !fs.existsSync(file)) throw new Error('--sb-accounts が要ります');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\S+@\S+\s+\S+$/.test(l.trim()));
  const out = {};
  for (const l of lines) {
    const [email, password] = l.trim().split(/\s+/);
    const r = await fetch(server.url + '/__sb/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: sbKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) continue;
    const s = await r.json();
    const me = await (await fetch(server.url + '/__sb/rest/v1/rpc/my_account', { method: 'POST', headers: { apikey: sbKey, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: '{}' })).json().catch(() => null);
    const role = me && me.role;
    if (role && !out[role]) out[role] = s;
  }
  return out;
}
const SB_STORAGE_KEY = 'sb-127-auth-token';   // supabase-js の既定の鍵（接続先の名前の最初の区切り＝127.0.0.1 の 127）

/* ── ワークスケジュール（Supabase の道・試験用 Supabase）── */
async function runWsSb(server, sessions) {
  const ws = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'work-schedule.mjs')).href);
  server.setBackend('kv', createKvBackend(ws.seed()));
  const FLAGS_ON = { supabase: { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false, patch_push: false, master_roster_read: false } };
  server.setFlags(FLAGS_ON);
  server.setScript([]);
  if (!sessions.office) { result.notes.push('Supabase の道: 事務所の試験アカウントでログインできず、省きました'); return; }
  const st = storageFor('work-schedule.html', { [SB_STORAGE_KEY]: JSON.stringify(sessions.office), su_backend_flags: JSON.stringify(FLAGS_ON) });
  const A = await openContext('wssb-a', server, st);
  const B = await openContext('wssb-b', server, st);
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/work-schedule.html', { waitUntil: 'domcontentloaded' });
    await X.page.waitForSelector('#btnAddNote', { state: 'visible', timeout: 60000 }).catch(() => {});
    await waitQuiet(server, 4000, 90000);
  }
  const plan = [{ kind: 'unreachable', times: 2, wait: 90000 }, { kind: 'slow', times: 1, ms: 3000, wait: 60000 }];
  for (const p of plan) {
    say(`  ワークスケジュール（Supabase）: ${p.kind} を ${p.times} 回`);
    server.setScript([{ entry: 'sb:rpc/kv_put', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#btnAddNote').catch(() => {});
    await A.page.keyboard.type('見本の印 ' + p.kind).catch(() => {});
    await A.page.mouse.click(5, 5).catch(() => {});
    const st0 = Date.now();
    while (Date.now() - st0 < p.wait) {
      const rep = server.engine().report()[0];
      if (rep.fired >= rep.times && Date.now() - st0 > 20000) break;
      await sleep(500);
    }
    await waitQuiet(server, 4000, 30000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, (e) => e.via === 'sb' && /rpc\/kv_put/.test(e.entry));
    await B.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitQuiet(server, 5000, 60000);
    const aNotes = await wsNotes(A.page), bNotes = await wsNotes(B.page);
    /* サーバー（試験用 Supabase）の中身は読まない（共用のため）。届いた書き込みが無い時、B の表示が A より多ければ巻き戻りではない＝数えない */
    c.rollback = 0;
    const rep = server.engine().report()[0];
    const names = [...new Set(server.log.slice(fromIdx).filter((e) => /rpc\/kv_put/.test(e.entry) && e.name).map((e) => e.name))];
    result.scenarios.push(Object.assign({ app: 'ワークスケジュール', path: 'Supabase（試験用）', kind: 'sb:' + p.kind, scriptTimes: rep.times, fired: rep.fired,
      notes: { a: aNotes, b: bNotes }, appNames: names, pageErrors: A.page.__errors + B.page.__errors }, c));
  }
  await closeAll();
}

/* ── 試験用 Supabase の RLS の断り（現場アカウント×事務所専用の書き込み kv_put）──
   画面は現場アカウントでは kv_put を呼ばない（su-kv.js が印だけの kv_put_marks に回す・事務所以外は送る前に断る）ので、
   中継を通して直接1回呼び、既存のポリシーで断られることを確かめる。データは書かれない（断りは入口の役割の照合） */
async function runSbRls(server, sessions) {
  server.setScript([]);
  if (!sessions.field) { result.notes.push('RLS の断り: 現場の試験アカウントでログインできず、省きました'); return; }
  say('  試験用 Supabase: 現場アカウントで kv_put（RLS の断り）を 1 回');
  const fromIdx = server.log.length;
  const r = await fetch(server.url + '/__sb/rest/v1/rpc/kv_put', { method: 'POST', headers: { apikey: sbKey, Authorization: 'Bearer ' + sessions.field.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: 'wsday_2026-01-14', p_rev: 0, p_data: { meta: { date: '2026-01-14' }, staff: [] } }) });
  await r.text();
  const rows = server.log.slice(fromIdx).filter((e) => /rpc\/kv_put/.test(e.entry));
  const denied = rows.filter((e) => e.http === 403 && e.name === '42501').length;
  result.scenarios.push({ app: '試験用 Supabase', path: 'Supabase（試験用）', kind: 'sb:deny', scriptTimes: 1, fired: denied, requests: rows.length, writes: rows.length, injected: 0,
    httpFail: rows.filter((e) => e.http !== 200).length, appFail: 0, landed: rows.filter((e) => e.landed).length, failureShown: null, falseSaved: null, deliveredLater: null, rollback: null,
    injectedKinds: denied ? ['sb:deny'] : [], realPolicy: true });
}

/* ── 入居者マスタ（GAS の道）── */
async function runRmGas(server) {
  const rm = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'resident-master.mjs')).href);
  const cs = await import(pathToFileURL(path.join(REPO, 'check', 'fixtures', 'care-schedule.mjs')).href);
  const be = createMasterBackend(rm.respond, rm.respond({ action: 'getBulk' }).rows || []);
  server.setBackend('master', be);
  server.setAuthRewrite(false);   // ログインの確かめは材料の架空の応答（本物の接続先の形の住所を横取り）で答える
  server.setBackend('kv', createKvBackend({}));
  server.setFlags(Object.assign({}, cs.FLAGS_OFF, { supabase: Object.assign({}, cs.FLAGS_OFF.supabase, { master_live: false }) }));
  server.setScript([]);
  const st = storageFor('resident-master.html', { 'sb-jhbernqawjrzqwrmqrih-auth-token': rm.storage['sb-jhbernqawjrzqwrmqrih-auth-token'] });
  /* ログインの確かめは材料（fixtures/resident-master.mjs）の架空の応答で答える（本物の Supabase へは出ない） */
  const A = await openContext('rm-a', server, st, rm.routes);
  const B = await openContext('rm-b', server, st, rm.routes);
  for (const X of [A, B]) {
    await X.page.goto(server.url + '/resident-master.html', { waitUntil: 'domcontentloaded' });
    await X.page.waitForFunction(() => typeof roster !== 'undefined' && roster.length > 0, null, { timeout: 60000 });
    await waitQuiet(server, 3000, 60000);
  }
  const plan = [{ kind: 'deny', times: 1 }, { kind: 'conflict', times: 1 }, { kind: 'nores', times: 1 }, { kind: 'timeout', times: 1, ms: 40000 }];
  let i = 0;
  for (const p of plan) {
    say(`  入居者マスタ（GAS）: ${p.kind} を ${p.times} 回`);
    const id = (await A.page.evaluate((k) => roster[k % roster.length].id, i++));
    /* B が先に同じ方の編集画面を開いておく（古い版を持ったまま） */
    await B.page.evaluate((rid) => { openEdit(roster.find((r) => r.id === rid)); }, id);
    await A.page.evaluate((rid) => { openEdit(roster.find((r) => r.id === rid)); }, id);
    server.setScript([{ entry: 'saveResident', nth: 1, kind: p.kind, times: p.times, ms: p.ms }]);
    const fromIdx = server.log.length;
    const tClick = Date.now();
    await A.page.click('#saveBtn');
    const st0 = Date.now();
    while (Date.now() - st0 < 70000) {
      const disabled = await A.page.evaluate(() => document.getElementById('saveBtn').disabled).catch(() => false);
      if (!disabled && Date.now() - st0 > 1500) break;
      await sleep(500);
    }
    await waitQuiet(server, 3000, 60000);
    /* 失敗した時は、職員と同じく開き直さずにもう一度保存する（送信待ちを持たない画面で、後から届くかを見る） */
    server.setScript([]);
    await A.page.click('#saveBtn').catch(() => {});
    await sleep(2000);
    await waitQuiet(server, 3000, 60000);
    const evA = await events(A.page, tClick);
    const c = countScenario(server, fromIdx, tClick, evA, (e) => e.via === 'gas' && e.app === 'master' && e.entry === 'saveResident');
    /* (iv) B は古い版のまま保存する。通ってしまえば A の保存を巻き戻した */
    const fromB = server.log.length;
    await B.page.click('#saveBtn').catch(() => {});
    await sleep(2000);
    await waitQuiet(server, 3000, 60000);
    const bRows = server.log.slice(fromB).filter((e) => e.entry === 'saveResident');
    const aLanded = server.log.slice(fromIdx, fromB).some((e) => e.entry === 'saveResident' && e.landed);
    c.rollback = aLanded && bRows.some((e) => e.landed) ? 1 : 0;
    const rep = server.engine().report();
    result.scenarios.push(Object.assign({ app: '入居者マスタ', path: 'GAS（入居者マスタ）', kind: 'gas:' + p.kind, scriptTimes: p.times,
      fired: server.log.slice(fromIdx).filter((e) => e.injected === p.kind).length, bSave: bRows.map((e) => e.name || (e.landed ? 'saved' : null)), pageErrors: A.page.__errors + B.page.__errors }, c));
    void rep;
    await A.page.evaluate(() => { try { closeEdit && closeEdit(); } catch (e) { /* 無い */ } }).catch(() => {});
  }
  await closeAll();
}

const server = await startFailInjectServer({ root: REPO, script: [], sb: sbTarget ? { target: sbTarget, key: sbKey } : null, backends: {} });
let exitCode = 0;
try {
  let sessions = {};
  if (sbTarget && (only.includes('ws-sb') || only.includes('sb-rls'))) sessions = await sbSessions(server);
  if (only.includes('ws-gas')) await runWsGas(server);
  if (only.includes('ws-sb')) { if (sbTarget) await runWsSb(server, sessions); else result.notes.push('Supabase の道: --sb が無いので省きました'); }
  if (only.includes('sb-rls')) { if (sbTarget) await runSbRls(server, sessions); else result.notes.push('RLS の断り: --sb が無いので省きました'); }
  if (only.includes('rm-gas')) await runRmGas(server);
} catch (e) {
  exitCode = 1;
  result.notes.push('途中で止まりました: ' + String(e && e.message || e).slice(0, 300));
} finally {
  await closeAll();
  await server.close();
}

/* まとめ（観測点ごとの合計・起きた失敗の種類） */
const fired = new Set();
for (const s of result.scenarios) for (const k of s.injectedKinds || []) fired.add(k);
result.kindsFired = FAILURE_KINDS.filter((k) => fired.has(k));
const sum = (k) => result.scenarios.reduce((a, s) => a + (typeof s[k] === 'number' ? s[k] : 0), 0);
result.totals = { failureKinds: result.kindsFired.length, observationPoints: OBS_POINTS.length, failureShown: sum('failureShown'), falseSaved: sum('falseSaved'),
  deliveredLater: sum('deliveredLater'), rollback: sum('rollback'), httpFail: sum('httpFail'), appFail: sum('appFail'),
  scriptMatched: result.scenarios.every((s) => s.fired === s.scriptTimes) };
result.finishedAt = new Date().toISOString();
const stamp = result.startedAt.replace(/[:.]/g, '-');
const outFile = path.join(outDir, stamp + '.json');
writeJson(outFile, result);
say(`記録: ${path.relative(REPO, outFile)}`);
say(`起きた失敗の種類 ${result.totals.failureKinds}／観測点 ${result.totals.observationPoints}／失敗の表示 ${result.totals.failureShown}／偽の保存しました ${result.totals.falseSaved}／後から届いた ${result.totals.deliveredLater}／巻き戻り ${result.totals.rollback}／HTTP の失敗 ${result.totals.httpFail}／ok:false ${result.totals.appFail}／台本の回数と一致 ${result.totals.scriptMatched ? 'はい' : 'いいえ'}`);

/* measure.json（item 1）へ書き足す。run は 1 か 2（同じ条件で2回測る） */
if (args.measure && args.measure !== 'true') {
  const mf = args.measure;
  const m = readJson(mf, []) || [];
  const idx = Math.max(0, Math.min(1, Number(args.run || 1) - 1));
  const how = args.how && args.how !== 'true' ? String(args.how) : 'node check/fail-inject/observe.mjs ' + process.argv.slice(2).join(' ');
  const upsert = (metric, unit, before, val) => {
    let row = m.find((r) => r.item === 1 && r.metric === metric);
    if (!row) { row = { item: 1, app: '共通の道具（check/fail-inject・失敗を起こして数える）', metric, unit, before, after: [null, null], how: '' }; m.push(row); }
    row.after[idx] = val;
    row.how = how;
  };
  upsert('起こせる失敗の種類数', '種類', [0, 0], result.totals.failureKinds);
  upsert('観測点の数', '点', [0, 0], result.totals.observationPoints);
  upsert('偽って保存しましたと出た回数', '回', ['未測定', '未測定'], result.totals.falseSaved);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
  say(`measure: ${mf} の item 1 を書きました（${idx + 1} 回目）`);
}
process.exit(exitCode);
