/* check/tap-latency.mjs — 押してから画面が描き変わるまでの遅れを、架空データで測る（2026-10-27 新設）
 *
 *   node check/tap-latency.mjs [--pages work-schedule.html,care-schedule.html] [--rates 4,1] [--reps 5]
 *                              [--profile 3] [--out check/out] [--dir .]
 *
 * やること（画面のコードは1行も変えない・道具の側で測るだけ）:
 *   1. check/fixtures/<画面名>.mjs の架空データを読ませて画面を開く（統合同期 GAS への要求を横取りして決まった応答を返す・
 *      su-backend.json は「全部切」で返す＝Google の道だけ）。外への通信は全部止める。
 *   2. 主な操作を1つずつ reps 回（間に元へ戻す）行い、次の3つを測る:
 *        描画まで   … 操作の入力イベントの時刻 → requestAnimationFrame 2回目（＝その後の最初の描画が済んだ時）
 *        落ち着くまで … 同じ起点 → 長い処理（longtask）と材料への要求が 300ms 来なくなった所（上限 8秒）
 *        longtask合計 … 起点〜落ち着くまでの間の長い処理（50ms 超の塊）の合計
 *      CPU は 4倍遅く（スマートフォン相当）と 1倍（事務所PC）の両方（--rates）。
 *   3. 起動（開いてから SUPerf.ready が呼ばれるまで）も1行。
 *   4. 4倍の「落ち着くまで」の中央値が大きい上位 N 個（--profile）について、1倍で Chrome の性能記録（CDP Profiler）を取り、
 *      関数ごとの自分の時間・含む時間の上位と、レイアウト・スタイル計算の回数を出す。
 * 出力: <out>/tap-latency.md（表）と <out>/tap-latency.json（生の値）。
 *
 * ★ブラウザは Mac の Chrome（channel:'chrome'）。無い環境では playwright 同梱の Chromium を使う。使い捨てのプロファイルは playwright に任せ、必ず閉じる。
 * ★時計は止めない（実行した日を基準に材料が作られる）。印刷のダイアログは開かない（window.print を「beforeprint を出すだけ」に置き換え、
 *   戻す時に afterprint を出す）。alert / confirm は道具の側で即答する（待ち時間を計測に混ぜない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright, parseArgs, startServer, ensureDir } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args.dir || '.');
const outDir = ensureDir(path.resolve(args.out || 'check/out'));
const PAGES = String(args.pages || 'work-schedule.html,care-schedule.html').split(',').map((s) => s.trim()).filter(Boolean);
const RATES = String(args.rates || '4,1').split(',').map(Number).filter((n) => n >= 1);
const REPS = Math.max(1, Number(args.reps || 5));
const PROFILE_N = Math.max(0, Number(args.profile == null ? 3 : args.profile));
const QUIET_MS = 300, SETTLE_CAP_MS = 8000;

const { chromium } = loadPlaywright();
const srv = await startServer(repoDir, 0);
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
catch (e) { browser = await chromium.launch({ headless: true }); }

/* ── 画面に入れる計測の部品（道具の側・addInitScript）── */
function pageProbe() {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* 無い環境は0件 */ }
  /* SUPerf.ready() が呼ばれた時刻を控える（su-perf.js が window.SUPerf を置いた時に包む） */
  let sp;
  Object.defineProperty(window, 'SUPerf', { configurable: true, get() { return sp; }, set(v) {
    sp = v;
    try { const orig = v && v.ready; if (typeof orig === 'function') v.ready = function () { if (window.__readyAt == null) window.__readyAt = performance.now(); return orig.apply(this, arguments); }; } catch (e) { /* 包めなければ代替の目印を使う */ }
  } });
  window.alert = function () {};
  window.confirm = function () { return true; };
  window.print = function () { window.dispatchEvent(new Event('beforeprint')); };
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
  window.__lat = {
    /* 道具が直接押す操作: 起点を取ってから押し、描画2回を待つ */
    async run(fn) { const t0 = performance.now(); fn(); const t1 = await raf2(); return { t0, t1 }; },
    /* 本物の入力（マウス）の操作: 入力イベントを待ち、そのイベントの時刻を起点にする */
    arm(type, nth) {
      let n = 0;
      window.__armed = new Promise((res) => {
        const h = (e) => { if (++n < (nth || 1)) return; window.removeEventListener(type, h, true); const t0 = e.timeStamp; raf2().then((t1) => res({ t0, t1 })); };
        window.addEventListener(type, h, true);
      });
    },
  };
}

/* ── 操作の一覧（画面を読んで実在するものだけ）──
 * do: 測る操作 / undo: 元へ戻す（測らない）/ ok: 中身が出ているかの確かめ（1回目だけ・報告に残す）
 * kind 'dom' … 道具が要素を押す（data-on-click や click の受け口に届く）／'mouse' … 本物のマウス入力 */
const OPS = {
  'work-schedule.html': [
    { name: '次の日へ（▶）', kind: 'dom', do: () => document.getElementById('btnNext').click(), undo: { dom: () => document.getElementById('btnPrev').click() } },
    { name: '前の日へ（◀）', kind: 'dom', do: () => document.getElementById('btnPrev').click(), undo: { dom: () => document.getElementById('btnNext').click() } },
    { name: '来週へ', kind: 'dom', do: () => document.getElementById('btnNextWeek').click(), undo: { dom: () => document.getElementById('btnPrevWeek').click() } },
    { name: '札を開く（ダブルクリック→詳細の窓）', kind: 'mouse', mouse: 'dblclick', target: 'care',
      ok: () => document.getElementById('mEdit').className.indexOf('on') >= 0,
      undo: { dom: () => document.getElementById('edCancel').click() } },
    { name: '札を保存（メモを1字変えて保存）', kind: 'dom', target: 'care',
      before: 'openCare', do: () => { const m = document.getElementById('edMemo'); m.value = (m.value || '') + '試'; m.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('edSave').click(); },
      ok: () => document.getElementById('mEdit').className.indexOf('on') < 0,
      undo: { dom: () => document.getElementById('btnUndo').click() } },
    { name: '札を別の列へ動かす（ドラッグ）', kind: 'mouse', mouse: 'drag', target: 'care',
      undo: { dom: () => document.getElementById('btnUndo').click() } },
    { name: '24時間配置表を開く', kind: 'dom', do: () => document.getElementById('btnStaff24').click(),
      ok: () => document.getElementById('mStaff24').className.indexOf('on') >= 0,
      undo: { dom: () => document.getElementById('rpClose').click() } },
    { name: '印刷の準備（下の「印刷」）', kind: 'dom', do: () => document.getElementById('navPrint').click(),
      undo: { dom: () => window.dispatchEvent(new Event('afterprint')), wait: 2000 } },
  ],
  'care-schedule.html': [
    { name: '利用者を選ぶ（別の方へ切り替え）', kind: 'dom', do: () => { const s = document.getElementById('resident-select'); const o = [...s.options].filter((x) => x.value); const i = o.findIndex((x) => x.value === s.value); s.value = o[(i + 1) % o.length].value; s.dispatchEvent(new Event('change', { bubbles: true })); },
      ok: () => document.querySelectorAll('.event-block').length > 0 },
    { name: 'コマを開く（予定の窓）', kind: 'dom', do: () => document.querySelector('.event-block').click(),
      ok: () => document.getElementById('mk-event').classList.contains('open'),
      undo: { dom: () => window.closeEventModal ? window.closeEventModal() : document.querySelector('[data-on-click="closeEventModal"]').click() } },
    { name: 'コマを保存（支援内容を1字変えて保存）', kind: 'dom', before: 'openEvent',
      do: () => { const d = document.getElementById('f-detail'); d.value = (d.value || '') + '試'; document.querySelector('#mk-event [data-on-click="saveEvent"]').click(); },
      ok: () => !document.getElementById('mk-event').classList.contains('open'),
      undo: { dom: () => document.getElementById('btnUndo').click() } },
    { name: '予定一覧を開く', kind: 'dom', do: () => document.querySelector('[data-on-click="openEventListModal"]').click(),
      ok: () => document.getElementById('mk-event-list').classList.contains('open'),
      undo: { dom: () => document.querySelector('[data-on-click="closeEventListModal"]').click() } },
    { name: '予定一覧の表示切り替え（サービス種別別）', kind: 'dom', before: 'openList',
      do: () => document.querySelector('[data-on-click="setEventListView"][data-args*="svc"]').click(),
      undo: { dom: () => { document.querySelector('[data-on-click="setEventListView"][data-args*="day"]').click(); document.querySelector('[data-on-click="closeEventListModal"]').click(); } } },
    { name: '利用者一覧を開く（全員の表）', kind: 'dom', do: () => document.querySelector('[data-on-click="openResidentListModal"]').click(),
      ok: () => document.getElementById('mk-resident-list').classList.contains('open'),
      undo: { dom: () => document.querySelector('[data-on-click="closeResidentListModal"]').click() } },
    { name: '週ボードの印刷の準備（🖨）', kind: 'dom', do: () => document.querySelector('[data-on-click="printWeek"]').click(),
      undo: { dom: () => window.dispatchEvent(new Event('afterprint')), wait: 500 } },
    { name: 'A3週間予定表の印刷の準備', kind: 'dom', do: () => document.querySelector('[data-on-click="printWeeklySheet"]').click(),
      undo: { dom: () => window.dispatchEvent(new Event('afterprint')), wait: 500 } },
  ],
};

/* ── 小さな道具 ── */
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r0 = (v) => (v == null ? '—' : String(Math.round(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(file, rate) {
  const name = file.replace(/\.html$/, '');
  const fx = await import(new URL(`./fixtures/${name}.mjs`, import.meta.url).href);
  const K = fx.freshKv();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const net = { pending: 0, lastAt: Date.now(), blocked: [], log: [] };
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (/\/su-backend\.json(\?|$)/.test(u)) { const r = fx.routes[0]; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.body) }); }
    if (u.startsWith(fx.URL)) {
      net.pending++; net.lastAt = Date.now();
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* 本文の無い要求は空で答える */ }
      net.log.push(String(body.action || '-') + (body.action === 'get' || body.action === 'put' ? ':' + String(body.key || '').replace(/_\d{4}-\d{2}-\d{2}$/, '_日') : ''));
      try { await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(K.respond(body)) }); }
      finally { net.pending--; net.lastAt = Date.now(); }
      return;
    }
    if (u.startsWith(srv.url)) return route.continue();
    net.blocked.push(u.replace(/[?#].*$/, '').slice(0, 80));
    return route.abort();
  });
  await ctx.addInitScript((st) => { try { for (const k of Object.keys(st)) if (localStorage.getItem(k) === null) localStorage.setItem(k, st[k]); } catch (e) { /* 入らなければ空の画面になり、確かめで分かる */ } }, fx.storage);
  await ctx.addInitScript(pageProbe);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await cdp.send('Performance.enable');
  const tNav = Date.now();
  await page.goto(srv.url + '/' + file, { waitUntil: 'load', timeout: 120000 });
  return { name, fx, K, ctx, page, cdp, net, errors, tNav };
}

/* 落ち着くまで待つ: longtask と材料への要求が QUIET_MS 来なくなるまで（上限 SETTLE_CAP_MS）。戻り値は画面の時刻（performance.now 基準） */
async function settle(page, net, t0, t1) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  const capAt = Date.now() + SETTLE_CAP_MS;
  let end = t1;
  for (;;) {
    await sleep(60);
    const st = await page.evaluate(() => { const lt = window.__lt; const last = lt.length ? lt[lt.length - 1] : null; return { now: performance.now(), ltEnd: last ? last[0] + last[1] : 0 }; });
    const reqEnd = net.lastAt - origin;
    const lastAct = Math.max(t1, st.ltEnd > t0 ? st.ltEnd : 0, reqEnd > t0 ? reqEnd : 0);
    end = lastAct;
    if (net.pending === 0 && st.now - lastAct >= QUIET_MS) break;
    if (Date.now() > capAt) { end = st.now; break; }
  }
  const lt = await page.evaluate(([a, b]) => window.__lt.filter(([s]) => s >= a - 1 && s < b), [t0, end]);
  return { settle: end - t0, ltSum: lt.reduce((s, [, d]) => s + d, 0), ltN: lt.length };
}

/* 支援の札（訪問の列にある身体・生活・混合）を1枚選ぶ。i で毎回違う札にする */
async function careBox(page, i, needTarget) {
  return page.evaluate(([i, needTarget]) => {
    const els = [...document.querySelectorAll('#board .b-task.k-phys, #board .b-task.k-mix, #board .b-task.k-life')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 24; });
    for (let k = 0; k < els.length; k++) {
      const e = els[(i * 7 + k) % els.length]; e.scrollIntoView({ block: 'center', inline: 'center' });
      const r = e.getBoundingClientRect();
      if (r.top < 200 || r.bottom > innerHeight - 80) continue;
      /* 動かし先: 同じ時間に札の無い訪問の列（画面に見えている中でいちばん近い列）。札のある所へ落とすと重なりで動かないことがある */
      const myLane = e.closest('.b-lane');
      const lanes = [...document.querySelectorAll('#board .b-lane.z-visit')].filter((l) => l !== myLane).map((l) => ({ l, b: l.getBoundingClientRect() }))
        .filter(({ l, b }) => b.width > 20 && b.left > 60 && b.right < innerWidth - 10 &&
          ![...l.querySelectorAll('.b-task')].some((t) => { const q = t.getBoundingClientRect(); return q.top < r.bottom + 4 && r.top - 4 < q.bottom; }));
      lanes.sort((a, b) => Math.abs(a.b.left - r.left) - Math.abs(b.b.left - r.left));
      const to = lanes.length ? lanes[0].b : null;
      if (needTarget && !to) continue;
      return { x: r.left + r.width / 2, y: r.top + Math.min(14, r.height / 2), id: e.getAttribute('data-id'),
        col: myLane ? myLane.getAttribute('data-col') : null, tx: to ? to.left + to.width / 2 : null };
    }
    return null;
  }, [i, !!needTarget]);
}

async function prepare(o, op, i) {
  const { page } = o;
  if (op.before === 'openCare') {
    const b = await careBox(page, i);
    if (!b) throw new Error('札が見つからない');
    await page.mouse.dblclick(b.x, b.y);
    await page.waitForSelector('#mEdit.on', { timeout: 10000 });
  } else if (op.before === 'openEvent') {
    await page.evaluate(() => document.querySelectorAll('.event-block')[0].click());
    await page.waitForSelector('#mk-event.open', { timeout: 10000 });
  } else if (op.before === 'openList') {
    await page.evaluate(() => document.querySelector('[data-on-click="openEventListModal"]').click());
    await page.waitForSelector('#mk-event-list.open', { timeout: 10000 });
  }
  await sleep(150);
}

async function runOp(o, op, i) {
  const { page, net } = o;
  await prepare(o, op, i);
  const logFrom = net.log.length;
  let tt;
  if (op.kind === 'dom') {
    /* 関数の文面を式として渡す（DevTools の評価は画面の CSP に止められない。画面の中で new Function は使えない） */
    tt = await page.evaluate(`window.__lat.run(${op.do.toString()})`);
    if (!tt) throw new Error('押せない');
  } else if (op.mouse === 'dblclick') {
    const b = await careBox(page, i);
    if (!b) throw new Error('札が見つからない');
    /* 画面は2回目の押下（pointerdown）で詳細の窓を開く（work-schedule.html の WSDrag・DBL_FAST_MS）＝2回目の押下を起点にする */
    await page.evaluate(() => window.__lat.arm('pointerdown', 2));
    await page.mouse.dblclick(b.x, b.y);
    tt = await page.evaluate(() => window.__armed);
  } else if (op.mouse === 'drag') {
    const b = await careBox(page, i, true);
    if (!b || b.tx == null) throw new Error('動かす札・列が見つからない');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(b.x + (b.tx - b.x) * s / 8, b.y + 2);
    await sleep(100);
    await page.evaluate(() => window.__lat.arm('pointerup', 1));
    await page.mouse.up();
    tt = await page.evaluate(() => window.__armed);
    /* 確かめ: 動かした札が別の列（data-col）に描かれているか */
    tt.moved = await page.evaluate(([id, x]) => { const e = document.querySelector('#board .b-task[data-id="' + id + '"]'); const l = e && e.closest('.b-lane'); return l ? l.getAttribute('data-col') : null; }, [b.id, b.x]);
    tt.from = b.col;
  }
  const s = await settle(page, net, tt.t0, tt.t1);
  const reqs = net.log.slice(logFrom);
  let ok = null;
  if (op.mouse === 'drag') ok = tt.moved != null && tt.moved !== tt.from;
  if (op.ok) ok = await page.evaluate(`(() => { try { return !!(${op.ok.toString()})(); } catch (e) { return 'err:' + e.message; } })()`);
  if (op.undo) {
    if (op.undo.dom) await page.evaluate(`(() => { try { (${op.undo.dom.toString()})(); } catch (e) { /* 戻せなければ次で分かる */ } })()`);
    await sleep(op.undo.wait || 0);
    const t = await page.evaluate(() => performance.now());
    await settle(page, net, t, t);
  }
  return { paint: tt.t1 - tt.t0, ...s, ok, reqs };
}

async function countPage(o) {
  return o.page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    if (document.getElementById('board')) {
      return { 札: q('#board .b-task'), 支援の札: q('#board .b-task.k-phys, #board .b-task.k-mix, #board .b-task.k-life'),
        列: q('#board .b-head') - 1, 職員名の入った列: [...document.querySelectorAll('#board .b-head .h-name')].filter((e) => e.textContent.trim() && e.textContent.trim() !== '—').length,
        日付: (document.getElementById('hdrDate') || {}).textContent };
    }
    const s = document.getElementById('resident-select');
    return { 利用者: s ? [...s.options].filter((x) => x.value).length : 0, 表示中の方のコマ: q('.event-block') };
  });
}

/* ── 1画面 × 1倍率の計測 ── */
async function measure(file, rate) {
  const o = await openPage(file, rate);
  const res = { file, rate, ops: [], errors: o.errors, blocked: o.net.blocked };
  try {
    /* 起動: SUPerf.ready の時刻（無ければ主要な表が出た時刻） */
    const mainSel = file === 'work-schedule.html' ? '#board .b-task' : '#resident-select option[value]:not([value=""])';
    await o.page.waitForSelector(mainSel, { timeout: 120000, state: 'attached' }).catch(() => {});
    await o.page.waitForFunction(() => window.__readyAt != null, null, { timeout: 30000 }).catch(() => {});
    const st = await o.page.evaluate(() => ({ ready: window.__readyAt, now: performance.now() }));
    const s0 = await settle(o.page, o.net, 0, st.ready || st.now);
    res.startup = { ready: st.ready, settle: s0.settle, ltSum: s0.ltSum, ltN: s0.ltN };
    if (file === 'care-schedule.html') {
      /* 利用者を1人選んだ状態から始める（未選択だと週の盤面が空） */
      await o.page.evaluate(() => { const s = document.getElementById('resident-select'); const o = [...s.options].filter((x) => x.value); s.value = o[0].value; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await sleep(500);
    } else {
      /* ならし: 前後の日・週を一度開いておく（初めて開く日は盤面を作って送るため。計測は2回目以降の「いつもの」状態） */
      for (const id of ['btnNext', 'btnPrev', 'btnPrev', 'btnNext', 'btnNextWeek', 'btnPrevWeek']) {
        await o.page.evaluate((id) => document.getElementById(id).click(), id);
        const t = await o.page.evaluate(() => performance.now());
        await settle(o.page, o.net, t, t);
      }
    }
    res.counts = await countPage(o);
    for (const op of OPS[file]) {
      const row = { name: op.name, samples: [], fail: '' };
      for (let i = 0; i < REPS; i++) {
        try { row.samples.push(await runOp(o, op, i)); }
        catch (e) { row.fail = String(e.message || e).split('\n')[0].slice(0, 120); try { await o.page.keyboard.press('Escape'); } catch (e2) { /* 次へ */ } }
      }
      res.ops.push(row);
      process.stdout.write(`  ${file} ×${rate} ${op.name}: ${row.samples.length}/${REPS}${row.fail ? ' 失敗: ' + row.fail : ''}\n`);
    }
    res.countsAfter = await countPage(o);
  } finally { await o.ctx.close(); }
  return res;
}

/* ── 性能記録（CDP Profiler）で上位の関数を出す ── */
function aggregateProfile(profile, file) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas || [];
  for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; self.set(id, (self.get(id) || 0) + (dt[i] || 0) / 1000); }
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const keyOf = (n) => {
    const f = n.callFrame; const fn = f.functionName || '(無名)';
    const u = f.url ? f.url.replace(/^.*\//, '').replace(/\?.*$/, '') : '';
    return u ? `${fn} ${u}:${f.lineNumber + 1}` : fn;
  };
  const selfBy = new Map(), totalBy = new Map();
  for (const [id, ms] of self) {
    const n = nodes.get(id); selfBy.set(keyOf(n), (selfBy.get(keyOf(n)) || 0) + ms);
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) { const k = keyOf(nodes.get(cur)); if (seen.has(k)) continue; seen.add(k); totalBy.set(k, (totalBy.get(k) || 0) + ms); }
  }
  const skip = (k) => /^\((root|program|idle)\)/.test(k);
  const top = (m, n) => [...m].filter(([k]) => !skip(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, ms: Math.round(v * 10) / 10 }));
  return { self: top(selfBy, 12), total: top(totalBy, 15).filter((x) => x.fn.indexOf(file) >= 0 || /^\((garbage|program)/.test(x.fn) || x.fn.indexOf('.js:') >= 0) };
}

async function profileOp(file, opName, rate) {
  const o = await openPage(file, rate);
  try {
    const mainSel = file === 'work-schedule.html' ? '#board .b-task' : '#resident-select option[value]:not([value=""])';
    await o.page.waitForSelector(mainSel, { timeout: 120000, state: 'attached' }).catch(() => {});
    const t = await o.page.evaluate(() => performance.now()); await settle(o.page, o.net, t, t);
    if (file === 'care-schedule.html') { await o.page.evaluate(() => { const s = document.getElementById('resident-select'); const o = [...s.options].filter((x) => x.value); s.value = o[0].value; s.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500); }
    else for (const id of ['btnNext', 'btnPrev', 'btnPrev', 'btnNext', 'btnNextWeek', 'btnPrevWeek']) { await o.page.evaluate((id) => document.getElementById(id).click(), id); const t2 = await o.page.evaluate(() => performance.now()); await settle(o.page, o.net, t2, t2); }
    const op = OPS[file].find((x) => x.name === opName);
    const met = async () => Object.fromEntries((await o.cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await o.cdp.send('Profiler.enable');
    await o.cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    const profs = [], diffs = [];
    for (let i = 0; i < 3; i++) {
      await prepare(o, op, i);
      const m0 = await met();
      await o.cdp.send('Profiler.start');
      const saved = op.before; op.before = null;
      try { await runOp(o, { ...op, undo: null }, i); } finally { op.before = saved; }
      const { profile } = await o.cdp.send('Profiler.stop');
      const m1 = await met();
      profs.push(profile);
      diffs.push({ layout: m1.LayoutCount - m0.LayoutCount, style: m1.RecalcStyleCount - m0.RecalcStyleCount,
        layoutMs: (m1.LayoutDuration - m0.LayoutDuration) * 1000, styleMs: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000,
        scriptMs: (m1.ScriptDuration - m0.ScriptDuration) * 1000 });
      if (op.undo && op.undo.dom) { await o.page.evaluate(`(() => { try { (${op.undo.dom.toString()})(); } catch (e) { /* 次へ */ } })()`); await sleep(op.undo.wait || 0); }
      const t3 = await o.page.evaluate(() => performance.now()); await settle(o.page, o.net, t3, t3);
    }
    /* 3回分の記録をまとめて数える */
    const agg = { self: new Map(), total: new Map() };
    for (const p of profs) { const a = aggregateProfile(p, file); for (const x of a.self) agg.self.set(x.fn, (agg.self.get(x.fn) || 0) + x.ms / 3); for (const x of a.total) agg.total.set(x.fn, (agg.total.get(x.fn) || 0) + x.ms / 3); }
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, ms]) => ({ fn, ms: Math.round(ms * 10) / 10 }));
    const avg = (k) => diffs.reduce((s, d) => s + d[k], 0) / diffs.length;
    return { file, op: opName, rate, self: top(agg.self, 10), total: top(agg.total, 12),
      metrics: { layout: avg('layout'), style: avg('style'), layoutMs: avg('layoutMs'), styleMs: avg('styleMs'), scriptMs: avg('scriptMs') } };
  } finally { await o.ctx.close(); }
}

/* ── 実行 ── */
const results = [];
try {
  for (const file of PAGES) for (const rate of RATES) {
    console.log(`計測: ${file} CPU ${rate}倍`);
    results.push(await measure(file, rate));
  }
  /* 上位 N 個（4倍の落ち着くまで中央値。4倍が無ければ最初の倍率） */
  const baseRate = RATES.includes(4) ? 4 : RATES[0];
  const ranked = [];
  for (const r of results.filter((x) => x.rate === baseRate)) for (const op of r.ops) if (op.samples.length) ranked.push({ file: r.file, name: op.name, med: median(op.samples.map((s) => s.settle)) });
  ranked.sort((a, b) => b.med - a.med);
  const profRate = RATES.includes(1) ? 1 : RATES[0];
  const profiles = [];
  for (const x of ranked.slice(0, PROFILE_N)) {
    console.log(`性能記録: ${x.file} ${x.name}（CPU ${profRate}倍）`);
    try { profiles.push(await profileOp(x.file, x.name, profRate)); } catch (e) { profiles.push({ file: x.file, op: x.name, error: String(e.message || e).slice(0, 160) }); }
  }
  fs.writeFileSync(path.join(outDir, 'tap-latency.json'), JSON.stringify({ at: new Date().toISOString(), reps: REPS, rates: RATES, results, ranked, profiles }, null, 2));
  fs.writeFileSync(path.join(outDir, 'tap-latency.md'), report(results, ranked, profiles));
  console.log('書き出し: ' + path.join(outDir, 'tap-latency.md'));
} finally {
  await browser.close();
  await srv.close();
}

function report(results, ranked, profiles) {
  const L = [];
  L.push('# 押してから描き変わるまで（架空データ・tap-latency.mjs）', '');
  L.push(`測った日時: ${new Date().toISOString()}／各操作 ${REPS} 回／CPU ${RATES.join('倍・')}倍（4倍＝スマートフォン相当・1倍＝事務所PC）`, '');
  L.push('- 描画まで: 入力イベント → requestAnimationFrame 2回目（その後の最初の描画が済んだ所）');
  L.push(`- 落ち着くまで: 同じ起点 → 長い処理と材料への要求が ${QUIET_MS}ms 来なくなった所（上限 ${SETTLE_CAP_MS}ms）`);
  L.push('- longtask: 起点〜落ち着くまでの 50ms 超の処理の合計（中央値）', '');
  for (const file of PAGES) {
    const byRate = Object.fromEntries(results.filter((r) => r.file === file).map((r) => [r.rate, r]));
    const any = byRate[RATES[0]];
    L.push(`## ${file}`, '');
    if (any && any.counts) L.push('材料で出たもの: ' + Object.entries(any.counts).map(([k, v]) => `${k} ${v}`).join('・'), '');
    const head = ['操作'];
    for (const rt of RATES) head.push(`${rt}倍 描画まで 中央/最大`, `${rt}倍 落ち着くまで 中央/最大`, `${rt}倍 longtask`);
    L.push('| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|');
    const st = [`起動（開いて→SUPerf.ready）`];
    for (const rt of RATES) { const r = byRate[rt]; st.push(r && r.startup ? r0(r.startup.ready) : '—', r && r.startup ? r0(r.startup.settle) : '—', r && r.startup ? r0(r.startup.ltSum) : '—'); }
    L.push('| ' + st.join(' | ') + ' |');
    for (const op of OPS[file]) {
      const row = [op.name];
      for (const rt of RATES) {
        const o = byRate[rt] && byRate[rt].ops.find((x) => x.name === op.name);
        if (!o || !o.samples.length) { row.push('測れず', '測れず', '—'); continue; }
        const p = o.samples.map((s) => s.paint), se = o.samples.map((s) => s.settle), lt = o.samples.map((s) => s.ltSum);
        row.push(`${r0(median(p))} / ${r0(Math.max(...p))}`, `${r0(median(se))} / ${r0(Math.max(...se))}`, r0(median(lt)) + (o.samples.length < REPS ? `（${o.samples.length}回）` : ''));
      }
      L.push('| ' + row.join(' | ') + ' |');
    }
    const oks = [];
    for (const rt of RATES) { const r = byRate[rt]; if (!r) continue; for (const o of r.ops) { const v = o.samples.map((s) => s.ok).filter((x) => x !== null); if (v.length) oks.push(`${rt}倍 ${o.name}: 中身の確かめ ${v.filter((x) => x === true).length}/${v.length} 回 OK`); if (o.fail) oks.push(`${rt}倍 ${o.name}: 失敗「${o.fail}」`); } if (r.errors.length) oks.push(`${rt}倍 画面のエラー ${r.errors.length}件: ${r.errors[0]}`); if (r.blocked.length) oks.push(`${rt}倍 止めた外への通信 ${r.blocked.length}件`); }
    for (const o of (any ? any.ops : [])) {
      if (!o.samples.length) continue;
      const c = {}; for (const x of o.samples[o.samples.length - 1].reqs || []) c[x] = (c[x] || 0) + 1;
      const t = Object.entries(c).map(([k, v]) => `${k}×${v}`).join('・');
      oks.push(`${o.name}: 材料（GAS の見本）への要求 ${t || 'なし'}（${RATES[0]}倍の最後の1回）`);
    }
    if (oks.length) L.push('', ...oks.map((s) => '- ' + s));
    L.push('');
  }
  L.push('## 遅い順（' + (RATES.includes(4) ? 4 : RATES[0]) + '倍の落ち着くまで・中央値）', '');
  ranked.forEach((x, i) => L.push(`${i + 1}. ${x.file} ${x.name} … ${r0(x.med)}ms`));
  L.push('');
  for (const p of profiles) {
    L.push(`## 性能記録: ${p.file} ${p.op}（CPU ${p.rate || '?'}倍・3回の平均）`, '');
    if (p.error) { L.push('記録できず: ' + p.error, ''); continue; }
    const m = p.metrics;
    L.push(`レイアウト ${m.layout.toFixed(1)}回・${r0(m.layoutMs)}ms／スタイル計算 ${m.style.toFixed(1)}回・${r0(m.styleMs)}ms／スクリプト ${r0(m.scriptMs)}ms`, '');
    L.push('含む時間の上位（呼んだ先も含む）:', '');
    for (const x of p.total) L.push(`- ${x.ms}ms ${x.fn}`);
    L.push('', '自分の時間の上位:', '');
    for (const x of p.self) L.push(`- ${x.ms}ms ${x.fn}`);
    L.push('');
  }
  return L.join('\n') + '\n';
}
