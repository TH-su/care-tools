/* check/care_plan_nochange_e2e.mjs — 予約を1件も使わない端末では、計画の版の改修の前と後で保存データ・送信の中身が同じことを確かめる（2026-11-27 新設）
 *
 *   node check/care_plan_nochange_e2e.mjs [--shots <保存先>]
 *   CS_BASE_REF=<コミット> node check/care_plan_nochange_e2e.mjs   … 比べる元（既定 origin/main）
 *   CS_NOW_DIR=<フォルダ> …（わざと差を入れた写しで、この試験が落ちることを確かめる時だけ）今の画面の代わりに配るフォルダ
 *
 * ★比べる元は、環境変数 CS_BASE_REF（既定 origin/main）の時点の care-schedule.html とその時の共通部品。改修を取り込んだ後は origin/main が
 *   今の画面と同じになるので、取り込み前のコミットを CS_BASE_REF に渡す（同じ中身なら「比べる元と同じなので比べになっていません」で失敗にする）。
 *
 * 代表者の指示「現在のデータが消えたり、書き換わったりしないことに最大限の注意を払う」による。
 * 直す前の画面（CS_BASE_REF の care-schedule.html と、その時の共通部品。care-plan-calc.js は置かない）と今の画面に、同じ操作の台本を流し、
 *   (1) 各段の後の端末の控え（localStorage の care_schedule_v2）
 *   (2) 偽のサーバー（新しい保存先の kv_put）が受け取った本文の列
 * が一字一句同じであることを比べる。今の画面の側では、どの利用者にも版の項目（planGen・planFrom・planLevel・planNote・nextPlans・planGone）が
 * 足されていないことと、年表の窓を開いて閉じるだけでは保存データが変わらないことも確かめる。
 *
 * 時刻と乱数は両方で同じ値になるよう固定する（時計は Playwright の clock.setFixedTime・乱数は決まった並びの擬似乱数）。
 * 比べる時に除く項目: 今の画面の側が送った本文の最上位の csAppVer（版の印・2026-11-27）だけ。editedAt・新しい予定の id は固定した時計と乱数で
 *   両方同じ値になるので、そのまま比べる。端末の控えの care_schedule_v2 と、偽のサーバーが保存した中身には csAppVer が無いことも確かめる
 *   （偽のサーバーは本物と同じく保存の前に最上位の csAppVer を取り除く）。
 * 比べないもの: care_schedule_v2 以外の端末の控え（世代の控え・土台・書き手の印など。中身でなく端末の作業用）。
 * データはすべて架空（check/fixtures/care-schedule.mjs の38名・版の項目は1つも持たない）。通信は全部横取りし、外へは出ない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';
import * as CS from './fixtures/care-schedule.mjs';
import * as F from './fixtures/flow.mjs';
import * as GATE from './fixtures/care-plan-gate.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots ? path.resolve(args.shots) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info).slice(0, 600))); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 15000, step = 150) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return v;
    await sleep(step);
  }
}

/* ── 直す前の画面: git の HEAD を一時フォルダに取り出す（care-plan-calc.js が HEAD に無いことも確かめる） ── */
const tmpBase = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'cp-nochange-'));
const beforeDir = path.join(tmpBase, 'before');
fs.mkdirSync(beforeDir);
const BASE_REF = process.env.CS_BASE_REF || 'origin/main';
execFileSync('bash', ['-c', 'git -C "$1" archive "$3" | tar -x -C "$2"', '_', repoDir, beforeDir, BASE_REF]);
const NOW_DIR = process.env.CS_NOW_DIR ? path.resolve(process.env.CS_NOW_DIR) : repoDir;
const sameAsBase = fs.readFileSync(path.join(beforeDir, 'care-schedule.html'), 'utf8') === fs.readFileSync(path.join(NOW_DIR, 'care-schedule.html'), 'utf8');
const calcInBefore = fs.existsSync(path.join(beforeDir, 'care-plan-calc.js'));
if (calcInBefore) fs.unlinkSync(path.join(beforeDir, 'care-plan-calc.js'));   /* 直す前の画面の側には置かない */

const FIXED = new Date('2026-11-20T10:00:00+09:00');
const ROUTED = { supabase: Object.assign({}, F.FLAGS_OFF.supabase, { care_schedule_v2: true }) };
const STORAGE = {
  su_sync_common: JSON.stringify({ endpoint: F.SYNC_URL, token: 'check-nochange', updatedAt: 1 }),
  ws_settings: JSON.stringify({ endpoint: F.SYNC_URL, token: 'check-nochange', shiftAuto: true }),
  su_device_role: 'office',
  su_backend_flags: JSON.stringify(ROUTED),
  su_facility_profile_v1: JSON.stringify({ setupDone: true, facilityName: '' }),
  'sb-jhbernqawjrzqwrmqrih-auth-token': F.FAKE_SESSION,
};
const PLAN_KEYS = ['planGen', 'planFrom', 'planLevel', 'planNote', 'nextPlans', 'planGone'];

const browser = await chromium.launch();

/* 1回の台本＝1つのブラウザの文脈（端末1台）。dir の画面に流し、各段の控えと送った本文を返す */
async function runScript(dir, label, isNow, planOn = true) {
  const srv = await startServer(dir);
  const st = { kv: { data: CS.careDb(), rev: 3 }, puts: [], vers: [], ext: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  await context.clock.setFixedTime(FIXED);
  await context.addInitScript(({ s }) => {
    /* 乱数を決まった並びにする（読み込みのたびに同じ種から） */
    let x = 20261127 >>> 0;
    Math.random = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
    try {
      if (localStorage.getItem('__nc_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__nc_seeded', '1');
    } catch (e) { /* 何もしない */ }
  }, { s: STORAGE });
  /* 画面の中の確かめの窓は、開いたら Enter で OK を押す（押下の守りの時間に当たらない押し方・両方で同じ） */
  await context.addInitScript(() => {
    new MutationObserver(() => {
      const d = document.querySelector('dialog.sud-dlg[open]');
      if (d && !d.__ncPressed) { d.__ncPressed = true; setTimeout(() => { const b = d.querySelector('.sud-btn.pri'); if (b) { b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); b.click(); } }, 400); }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const sbBase = F.supabase({ sb: [] }, 'office');
  const rpc = {
    kv_get: () => ({ rev: st.kv.rev, data: st.kv.data, mode: 'live', updatedAt: '' }),
    kv_head: (b) => { const revs = {}; (b.p_keys || []).forEach((k) => { revs[k] = k === 'care_schedule_v2' ? st.kv.rev : 0; }); return { revs }; },
    kv_put: (b) => {
      if (b.p_key !== 'care_schedule_v2') return { ok: true, rev: 1 };
      /* 比べる本文は最上位の csAppVer（版の印）を除いた物。付いていた印は別に控える */
      const body = Object.assign({}, b.p_data); st.vers.push(body.csAppVer === undefined ? null : body.csAppVer); delete body.csAppVer;
      st.puts.push(JSON.stringify(body));
      /* 共通 DB の門の偽物（版の印・中身の確かめ planstale・競合・印を外して保存・check/fixtures/care-plan-gate.mjs）を通す */
      const r = GATE.kvPut(st.kv, b);
      if (r.conflict) st.puts[st.puts.length - 1] = 'conflict:' + st.puts[st.puts.length - 1];
      else if (!r.ok) st.puts[st.puts.length - 1] = (r.error || 'ng') + ':' + st.puts[st.puts.length - 1];
      return r;
    },
    cs_plan_status: () => ({ ok: true, enabled: planOn, minAppVer: 2026112701, lastUnstampedAt: null, lastStampedAt: null }),
  };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROUTED) });
      return route.continue();
    }
    if (u.startsWith(F.SYNC_URL)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, server: 'silverunix-sync' }) });
    if (u.startsWith(F.SB + '/')) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(new URL(u).pathname);
      if (!m || !rpc[m[1]]) return sbBase(route);
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(rpc[m[1]](b)) });
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 160));
    return route.abort();
  });
  context.on('page', (page) => { page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200))); page.on('dialog', (d) => d.accept().catch(() => {})); });

  const snaps = [];
  let page = await context.newPage();
  const ls = () => page.evaluate(() => localStorage.getItem('care_schedule_v2'));
  /* 送信が落ち着くまで待つ（未送信があれば送る）。両方で同じ待ち方 */
  const settle = async () => {
    let calm = 0;
    for (let i = 0; i < 120 && calm < 3; i++) {
      const s = await page.evaluate(() => ({ busy: !!SYNC._busy, timer: !!SYNC._pushTimer, dirty: !!SYNC._dirty, dlg: !!document.querySelector('dialog.sud-dlg[open]') }));
      if (s.dirty && !s.busy && !s.timer && !s.dlg) { await page.evaluate(() => SYNC.push()); calm = 0; }
      else if (!s.busy && !s.timer && !s.dlg && !s.dirty) calm++;
      else calm = 0;
      await sleep(250);
    }
  };
  const snap = async (name) => { await settle(); snaps.push({ name, ls: await ls(), puts: st.puts.length }); };
  const open = async () => {
    await page.goto(srv.url + '/care-schedule.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof DB === 'object' && DB && Array.isArray(DB.residents) && DB.residents.length >= 38, null, { timeout: 20000 });
    await sleep(1500);
  };
  try {
    await open();
    await snap('1 起動と取得');
    await page.selectOption('#resident-select', 'cr002');
    await snap('2 利用者を選ぶ');
    await page.evaluate(() => {
      const r = currentResident();
      pushUndo();
      r.events.push({ id: uid(), dayOfWeek: 6, serviceType: 'visit', category: '身体１', startTime: '18:00', endTime: '18:30', detail: '架空の支援', notes: '', units: 0, bathing: false });
      recalcAllEventUnits(); saveDB(); renderAll();
    });
    await page.evaluate(() => { const r = currentResident(); pushUndo(); r.events[0].startTime = '06:00'; r.events[0].endTime = '06:30'; recalcAllEventUnits(); saveDB(); renderAll(); });
    await page.evaluate(() => { const r = currentResident(); pushUndo(); r.events.splice(1, 1); recalcAllEventUnits(); saveDB(); renderAll(); });
    await snap('3 予定を足す・時刻を変える・消す');
    await page.evaluate(() => manualSave());
    await snap('4 保存と送信');
    await page.evaluate(() => openCareInfoModal());
    await page.selectOption('#ci-copay', '2');
    await page.evaluate(() => saveCareInfo());
    await snap('5 介護情報の窓で負担割合を変えて保存');
    await page.evaluate(() => openResidentBulkModal());
    await sleep(500);
    await page.evaluate(() => saveResidentBulk_());
    await snap('6 一括編集を開いて保存');
    await page.evaluate(() => undo());
    await snap('7 元に戻す');
    /* ほかの端末が別の利用者（cr005）を直した版をサーバーに置いて、30秒ごとの取得 */
    st.kv.data = JSON.parse(JSON.stringify(st.kv.data));
    st.kv.data.residents.find((r) => r.id === 'cr005').events[0].detail = 'ほかの端末の直し';
    st.kv.rev++;
    await page.evaluate(() => SYNC.pollIfNeeded());
    await snap('8 ほかの端末の版を30秒の取得で取り込む');
    /* 競合: 自分の未送信（cr002）とサーバーの別の変更（cr007） */
    st.kv.data = JSON.parse(JSON.stringify(st.kv.data));
    st.kv.data.residents.find((r) => r.id === 'cr007').events[0].notes = 'サーバー側の架空のメモ';
    st.kv.rev++;
    await page.evaluate(() => { const r = currentResident(); pushUndo(); r.events[0].detail = 'この端末の架空の直し'; saveDB(); });
    await page.evaluate(() => { if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
    await snap('9 競合の統合');
    /* 試算: 入って予定を動かして終了（捨てる） */
    await page.evaluate(() => SIM.enter());
    await page.evaluate(() => { const r = currentResident(); r.events[0].startTime = '07:00'; r.events[0].endTime = '07:30'; saveDB(); renderAll(); });
    await page.evaluate(() => SIM.exit(true));
    await snap('10 試算モードに入り予定を動かして終了');
    /* 試算から実装 */
    await page.evaluate(() => SIM.enter());
    await page.evaluate(() => { const r = currentResident(); r.events[0].startTime = '08:00'; r.events[0].endTime = '08:30'; saveDB(); renderAll(); });
    await page.evaluate(() => SIM.openApply());
    await page.evaluate(() => SIM.applyGo());
    await waitFor(() => page.evaluate(() => !SIM_ON));
    await snap('11 試算モードから実装');
    /* 端末の控えの世代から「足す」復元（いちばん古い控え） */
    const ng = await page.evaluate(() => csReadGens_().length);
    if (ng > 0) await page.evaluate(() => restoreFromGen_(0, false));
    await waitFor(() => page.evaluate(() => !document.querySelector('dialog.sud-dlg[open]')));
    await snap('12 端末の控えの世代から足す復元（控え ' + ng + '件）');
    /* 強制保存（サーバーに別の変更がある状態で、この端末の内容で上書き。確かめの窓は OK） */
    st.kv.data = JSON.parse(JSON.stringify(st.kv.data));
    st.kv.data.residents.find((r) => r.id === 'cr009').events[0].notes = '強制保存で消える架空のメモ';
    st.kv.rev++;
    await page.evaluate(() => { const r = currentResident(); r.events[0].notes = '強制保存の前の架空の直し'; saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } });
    await page.evaluate(() => syncForcePush());
    await snap('12b 強制保存');
    /* 別タブの取り込み: もう1つのタブが localStorage を書く */
    const tab2 = await context.newPage();
    await tab2.goto(srv.url + '/su-backend.json');   /* 同じオリジンの軽い物を開いて、端末の控えだけを書く（画面のコードは動かさない） */
    await tab2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('care_schedule_v2'));
      const r = d.residents.find((x) => x.id === 'cr011');
      r.events.push({ id: 'e_tab2', dayOfWeek: 2, serviceType: 'visit', category: '身体１', startTime: '20:00', endTime: '20:30', detail: '別タブの架空の支援', notes: '', units: 0, bathing: false });
      localStorage.setItem('care_schedule_v2', JSON.stringify(d));
    });
    await tab2.close();
    await sleep(1500);
    await page.evaluate(() => { const r = currentResident(); r.events[0].notes = '別タブの後の架空の直し'; saveDB(); });
    await snap('12c 別タブの書き込みの取り込み');
    t(label + ': 12c 別タブが書いた予定を取り込んでいる', await page.evaluate(() => DB.residents.find((x) => x.id === 'cr011').events.some((e) => e.id === 'e_tab2')));
    /* 起動時に未送信がある時の取得: 直してすぐ（送る前に）読み込み直す */
    await page.evaluate(() => { const r = currentResident(); r.events[0].notes = '未送信のまま閉じた架空の直し'; if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } saveDB(); if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } });
    await open();
    await snap('13 未送信を抱えたまま再読み込み（起動時の取得）');
    /* 入居者マスタの共有名簿（介護度が1人だけ違う）を置いて再読み込み */
    await page.evaluate(() => {
      const list = DB.residents.map((r, i) => ({ masterId: 9000 + i, name: r.name, careLevel: i === 3 ? '要介護5' : r.careLevel, room: String(100 + i), active: true }));
      localStorage.setItem('su_residents_common', JSON.stringify({ residents: list, updatedAt: '2026-11-20T00:00:00.000Z' }));
    });
    await open();
    await snap('14 マスタの共有名簿を置いて再読み込み');
    const lv = await page.evaluate(() => DB.residents[3].careLevel);
    t(label + ': 14b 介護度が入居者マスタの値（要介護5）になる', lv === '要介護5', lv);
    t(label + ': 9 で競合（版の食い違いの断り）が実際に起きて統合を通った', st.puts.some((p) => p.startsWith('conflict:')));
    if (isNow === false) t(label + ': 直す前の画面は版の印を送らない', st.vers.every((v) => v === null), st.vers);
    if (isNow) {
      const before = await ls();
      const hasBtn = await page.evaluate(() => { const b = document.getElementById('cs-plan-btn'); return !!b && !b.hidden; });
      if (hasBtn) {
        await page.click('#cs-plan-btn');
        await page.waitForSelector('#mk-plan.open', { timeout: 5000 });
        await sleep(1500);
        if (shots) await page.screenshot({ path: path.join(shots, 'nochange-year.png') });
        await page.keyboard.press('Escape');
        await sleep(500);
      }
      await settle();
      t(label + ': 年表の窓を開いて閉じるだけでは保存データが変わらず、送らない', hasBtn && (await ls()) === before && st.puts.length === snaps[snaps.length - 1].puts, { hasBtn });
      const final = JSON.parse(await ls());
      const added = [];
      final.residents.forEach((r) => PLAN_KEYS.forEach((k) => { if (Object.prototype.hasOwnProperty.call(r, k)) added.push(r.id + '.' + k); }));
      st.puts.forEach((p, i) => { const d = JSON.parse(p.replace(/^conflict:/, '')); (d.residents || []).forEach((r) => PLAN_KEYS.forEach((k) => { if (Object.prototype.hasOwnProperty.call(r, k)) added.push('put' + i + ':' + r.id + '.' + k); })); });
      t(label + ': どの利用者にも版の項目（' + PLAN_KEYS.join('・') + '）が足されていない（端末の控え・送った本文とも）', added.length === 0, added.slice(0, 10));
      t(label + ': 端末の控えの care_schedule_v2 に版の印（csAppVer）が無い', !(await ls()).includes('csAppVer'));
      t(label + ': 偽のサーバーが保存した中身に版の印が紛れ込まない', !JSON.stringify(st.kv.data).includes('csAppVer'));
      t(label + ': 送った本文には版の印（2026112701）が付いている', st.vers.length > 0 && st.vers.every((v) => v === 2026112701), st.vers);
    }
  } finally {
    t(label + ': 画面のエラー（pageerror）なし', st.errors.length === 0, st.errors);
    t(label + ': 横取りしていない外への通信なし', st.ext.length === 0, st.ext);
    await context.close();
    await srv.close();
  }
  return { snaps, puts: st.puts };
}

console.log('\n— 予約を使わない端末で、改修の前（' + BASE_REF + '）と後の保存データ・送信の中身が同じ —');
t('比べる元（' + BASE_REF + '）と今の画面の care-schedule.html が違う（同じなら比べる元と同じなので比べになっていません）', !sameAsBase, sameAsBase ? '比べる元と同じなので比べになっていません' : undefined);
t('直す前の画面に care-plan-calc.js は置かない', true, calcInBefore ? '比べる元にあったので外した' : undefined);
const A = await runScript(beforeDir, '直す前', false);
const B = await runScript(NOW_DIR, '今の画面', true);
t('台本の段の数が同じ（' + A.snaps.length + '段）', A.snaps.length === B.snaps.length);
for (let i = 0; i < Math.min(A.snaps.length, B.snaps.length); i++) {
  const a = A.snaps[i], b = B.snaps[i];
  let at = -1;
  if (a.ls !== b.ls) { const x = String(a.ls), y = String(b.ls); at = 0; while (at < x.length && x[at] === y[at]) at++; }
  t(a.name + ': 端末の care_schedule_v2 が一字一句同じ', a.ls === b.ls, at >= 0 ? { at, before: String(a.ls).slice(Math.max(0, at - 80), at + 80), now: String(b.ls).slice(Math.max(0, at - 80), at + 80) } : undefined);
  t(a.name + ': ここまでに送った本文の数が同じ（' + a.puts + '本）', a.puts === b.puts, [a.puts, b.puts]);
}
t('送った本文の列（' + A.puts.length + '本）が一字一句同じ', A.puts.length === B.puts.length && A.puts.every((p, i) => p === B.puts[i]),
  A.puts.map((p, i) => p === B.puts[i]).map((ok, i) => ok ? null : i).filter((x) => x !== null));
t('送った本文が1本以上ある（比べた物が空でない）', A.puts.length > 0, A.puts.length);
/* 予約を使わないので、使い始めのスイッチ（cs_plan_status の enabled）が切でも同じ結果になる（2026-11-27） */
const Boff = await runScript(NOW_DIR, '今の画面（スイッチ切）', 'off', false);
t('スイッチ切: 各段の端末の care_schedule_v2 がスイッチ入と一字一句同じ', Boff.snaps.length === B.snaps.length && Boff.snaps.every((x, i) => x.ls === B.snaps[i].ls && x.puts === B.snaps[i].puts));
t('スイッチ切: 送った本文の列がスイッチ入と一字一句同じ', Boff.puts.length === B.puts.length && Boff.puts.every((p, i) => p === B.puts[i]));

await browser.close();
try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* 消せなくても試験の結果は変わらない */ }
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
