/* check/care_plan_e2e.mjs — 週間計画の「計画の版」（予約・切替・年表）を本物の Chromium で通す試験（2026-11-27 新設）
 *
 *   node check/care_plan_e2e.mjs [--shots <保存先>] [--only 1,3] [--width 390 --height 844]
 *
 * 通信は全部横取りして偽物が答える（統合同期 GAS・入居者マスタ GAS・Supabase・su-backend.json）。横取りしていない外への要求が出たら失敗にする。
 * データはすべて架空（check/fixtures/flow.mjs の careDb）。画面のコードは1文字も変えない。
 *   (1) 予約を作る→編集の間は本物のキー care_schedule_v2 が1バイトも変わらず、保存（put）も飛ばない→「予約を保存」で nextPlans に入り、
 *       今の予定（events）と介護度（careLevel）は元のまま
 *   (2) 予約の編集で介護度を変えると、集計の介護度・限度額・使用率がその介護度で出る（入居者マスタとつながっている方）
 *   (3) 切替日を過ぎた予約がある時、偽の cs_plan_switch が1回呼ばれ、取り直した盤面が新しい計画になる
 *   (4) 切替の口が無い時は帯と［今すぐ切り替える］が出て、押すと切り替わる
 *   (5) 年表に予約・現行・過去の計画・変更の記録が出る（偽の cs_plan_log_list）。過去の計画を開くと盤面が動かせない
 *   (6) 記録の口が断られても画面にエラーが出ない
 *   (7) 危ない文字（<img onerror> 等）を入れたメモ・記録が文字のまま出る
 *   (8) ほかの所（定時の仕事）で切り替わった版を受け取ると、Google への写し返しが1回届く
 *   (10) 使い始めのスイッチ（cs_plan_status）が切の時は予約のボタンを出さず切替の見張りもしない・強制保存は前の計画で上書きしない
 *   (9) 版の印の門（偽物）: 今の画面の保存には印が付いて通る・部品を読ませない端末は予約のあるデータを送らず帯を出す・
 *       古い版と断られると帯を出して送り直さない・Google の道とログインなしでは予約のボタンが出ない
 *   (12) 口 cs_plan_gate の答えが3秒に間に合わず印なしで送って oldapp → 確かめ直して印つきで1回だけ送り直して通る／
 *        印つきで oldapp の時は送り直さない／口が「なし」のままなら1回で止まる／送り直しても oldapp なら2本で止まる（2026-11-27 反証）
 *   (13) 送信の往復の最中に入れた次の直しは、送信が成功しても未送信のまま残り、ほかの端末の新しい版の取得で消えず、続けて送られる
 *        （往復が2秒の自動送信より長い時（a）と短い時（b）・だれも進めない時（c）・別のタブが共有の版数を進めた時は競合に倒れる（d）・
 *        往復の最中に試算を始めた時は閉じた後に送る（e）・2026-11-28）
 * どの流れも、画面のエラー（pageerror）が出たら失敗にする。成功で exit 0、1つでも落ちたら exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';
import * as F from './fixtures/flow.mjs';
import * as GATE from './fixtures/care-plan-gate.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require(path.join(repoDir, 'care-plan-calc.js'));
const args = parseArgs(process.argv.slice(2));
const shots = args.shots ? path.resolve(args.shots) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const ONLY = args.only ? String(args.only).split(',').map((x) => x.trim()).filter(Boolean) : null;
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info).slice(0, 500))); }
}
async function shot(page, name) {
  if (!shots) return;
  try { await page.screenshot({ path: path.join(shots, name + '.png') }); } catch (e) { /* 撮れなくても試験は続ける */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 15000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}
const today = C.todayJst(Date.now());
function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + n * 86400000);
  return d.toISOString().slice(0, 10);
}
const YESTERDAY = addDays(today, -1);
const LATER = addDays(today, 40);
const XSS = '<img src=x onerror="window.__xss=1">';

/* 架空の名簿（flow.mjs の careDb）。1人目（fl01・masterId 1001・要介護1）を使う */
function baseDb(mut) {
  const db = F.careDb();
  db.currentResidentId = 'fl01';
  const me = db.residents[0];
  me.planFrom = '2026-04-01'; me.planGen = 1; me.planLevel = ''; me.planNote = '';
  if (mut) mut(me, db);
  return db;
}
const ROUTED = { supabase: Object.assign({}, F.FLAGS_OFF.supabase, { care_schedule_v2: true }) };

const srv = await startServer(repoDir);
const browser = await chromium.launch();

/* 1つの流れ＝1つのブラウザの文脈（端末1台） */
/* 共通 DB の版の印の門の偽物（2026-11-27）: 保存済みか送ってきた data に予約（nextPlans が空でない）か世代1以上の利用者がいる時、
   最上位の csAppVer（2026112701 以上）が無い保存を oldapp で断る。保存の前に csAppVer を取り除く */
const hasPlans = (d) => !!(d && Array.isArray(d.residents) && d.residents.some((r) => r && ((typeof r.planGen === 'number' && r.planGen >= 1) || (Array.isArray(r.nextPlans) && r.nextPlans.length))));
async function makeEnv({ db, flags = F.FLAGS_OFF, rpc = {}, sbDb = null, localDb = null, noCalc = false, forceOld = false, planOn = true }) {
  const st = { kv: F.createKv({ care_schedule_v2: db }), master: F.createMaster(), req: [], rpc: [], ext: [], errors: [], sbKv: { data: JSON.parse(JSON.stringify(sbDb || db)), rev: 5 } };
  /* --width 390 --height 844 で iPhone の幅でも通せる（絵の確かめ用。既定は事務所PCの幅） */
  const context = await browser.newContext({ viewport: { width: Number(args.width) || 1280, height: Number(args.height) || 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP',
    ...(Number(args.width) && Number(args.width) < 700 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await context.addInitScript(({ s }) => {
    try {
      if (localStorage.getItem('__cp_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__cp_seeded', '1');
    } catch (e) { /* 何もしない */ }
  }, { s: { ...F.storage('office'), su_backend_flags: JSON.stringify(flags), cs_current_resident_v1: 'fl01', ...(localDb ? { care_schedule_v2: JSON.stringify(localDb) } : {}) } });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const sbBase = F.supabase({ sb: [] }, 'office');
  /* 共通のデータベースの偽物: kv_get・kv_head・kv_put（新しい保存先に切り替えた時）と、計画の版の2つの口 */
  const kvRpc = {
    kv_get: () => ({ rev: st.sbKv.rev, data: st.sbKv.data, mode: 'live', updatedAt: '' }),
    kv_head: (b) => { const revs = {}; (b.p_keys || []).forEach((k) => { revs[k] = k === 'care_schedule_v2' ? st.sbKv.rev : 0; }); return { revs }; },
    /* 門の偽物（版の印・中身の確かめ planstale・競合・印を外して保存）は check/fixtures/care-plan-gate.mjs */
    kv_put: (b) => {
      const r = GATE.kvPut(st.sbKv, b, { forceOld });
      if (r.error === 'oldapp') st.oldapp = (st.oldapp || 0) + 1;
      if (r.error === 'planstale') st.planstale = (st.planstale || 0) + 1;
      return r;
    },
    cs_plan_status: () => ({ ok: true, enabled: planOn, minAppVer: 2026112701, lastUnstampedAt: null, lastStampedAt: null }),
    /* 移行 0136 の有る無しを知る口（画面はこれが答えた時だけ版の印を付ける・反証 F1） */
    cs_plan_gate: () => GATE.csPlanGate(),
  };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) });
      if (noCalc && /\/care-plan-calc\.js(\?|$)/.test(u)) return route.fulfill({ status: 404, body: 'not found' });   /* 部品を読ませない端末 */
      return route.continue();
    }
    const gas = (respond, to) => {
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      st.req.push({ to, action: b.action, key: b.key, body: b });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(b)) });
    };
    if (u.startsWith(F.MASTER_URL)) return gas(st.master.respond, 'master');
    if (u.startsWith(F.SYNC_URL)) return gas(st.kv.respond, 'sync');
    if (u.startsWith(F.SB + '/')) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(new URL(u).pathname);
      const fn = m && (rpc[m[1]] || kvRpc[m[1]]);
      if (!fn) return sbBase(route);
      let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
      st.rpc.push({ fn: m[1], body: b });
      const out = await fn(b, st);
      if (out && out.__status) return route.fulfill({ status: out.__status, contentType: 'application/json', headers: cors, body: JSON.stringify(out.body) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    st.ext.push(req.method() + ' ' + u.slice(0, 160));
    return route.abort();
  });
  context.on('page', (page) => {
    page.on('pageerror', (e) => st.errors.push(String(e && e.message).slice(0, 200)));
    page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  });
  return { context, st };
}
async function openCs(env) {
  const page = await env.context.newPage();
  await page.goto(srv.url + '/care-schedule.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof DB !== 'undefined' && Array.isArray(DB.residents) && DB.residents.length > 0 && DB.currentResidentId === 'fl01', null, { timeout: 15000 });
  /* 起動の時の取得（kv_get）が返って、取り込みと後の処理まで終わるのを待ってから操作する。取得の最中に試験が送ると画面は送信を断り
     （SYNC._busy）、後から届いた取得は試験の書き換えを置き換える。待ち切れなくても先へ進み、その流れの確かめが落ちる */
  const idle = await waitFor(() => env.st.rpc.some((r) => r.fn === 'kv_get') && page.evaluate(() => !SYNC._busy), 15000);
  if (!idle) console.log('    （起動の時の取得が終わるのを待ち切れませんでした。通信: ' + env.st.rpc.map((r) => r.fn).join(', ') + '）');
  return page;
}
const lsRaw = (page) => page.evaluate(() => localStorage.getItem('care_schedule_v2'));
const puts = (env) => env.st.req.filter((r) => r.to === 'sync' && r.action === 'put').length + env.st.rpc.filter((r) => r.fn === 'kv_put').length;
async function sudOk(page) {
  await page.waitForSelector('dialog.sud-dlg[open] .sud-btn.pri', { timeout: 8000 });
  await page.waitForTimeout(700);   /* 窓が開いた直後の押下は守りの時間で受け付けない（su-dialog.js）＝人と同じく少し待って押す */
  await page.click('dialog.sud-dlg[open] .sud-btn.pri');
}
async function clickText(page, scope, text) {
  const loc = page.locator(scope + ' button', { hasText: text }).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  await loc.click();
}
function endChecks(env, label) {
  t(label + ': 画面のエラー（pageerror）なし', env.st.errors.length === 0, env.st.errors);
  t(label + ': 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
}
const run = (n) => !ONLY || ONLY.includes(String(n));

/* ═════ (1)(2) 予約を作る・編集・保存 ═════ */
if (run(1) || run(2)) {
  console.log('\n— (1)(2) 予約を作る→編集の間は本物に書かない・送らない→保存で nextPlans に入る／介護度を変えると集計がその介護度 —');
  const env = await makeEnv({ db: baseDb(), flags: ROUTED });
  try {
    const page = await openCs(env);
    await waitFor(() => env.st.rpc.some((r) => r.fn === 'kv_get'));
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return { events: JSON.stringify(r.events), careLevel: r.careLevel }; });
    t('(1) 計画の履歴・予約のボタンが出ている', await page.isVisible('#cs-plan-btn'));
    await page.click('#cs-plan-btn');
    await page.waitForSelector('#mk-plan.open', { timeout: 5000 });
    await shot(page, 'cp1-year-empty');
    await clickText(page, '#mk-plan', '＋ 次の計画を作る');
    await page.waitForSelector('#mk-plan-form.open', { timeout: 5000 });
    const defFrom = await page.inputValue('#cs-pl-f-from');
    t('(1) 適用開始日の初めは翌月1日', /^\d{4}-\d{2}-01$/.test(defFrom) && defFrom > today, defFrom);
    await page.fill('#cs-pl-f-note', '架空の予約のメモ');
    const raw0 = await lsRaw(page), put0 = puts(env);
    await clickText(page, '#mk-plan-form', '作って開く');
    await page.waitForFunction(() => document.body.classList.contains('plan-mode'), null, { timeout: 5000 });
    t('(1) 予約の編集の見出し（藍）と札が出る', await page.evaluate(() => /からの計画（予約）/.test(document.getElementById('cs-plan-tag').textContent)));
    /* 2026-11-27 文の変更（反証レビュー B9）: ワークスケジュールは切替日以降の日からこの内容で出る */
    t('(1) 予約の編集の説明が出る', await page.evaluate(() => /から今の計画になります。ワークスケジュールは \d+月\d+日 以降の日からこの内容で出ます/.test(document.getElementById('cs-plan-mode-note').textContent)));
    t('(1) 試算の「✅ 実装」は出ない・予約の保存は出る', await page.evaluate(() => getComputedStyle(document.getElementById('btnSimApply')).display === 'none' && getComputedStyle(document.getElementById('btnPlanSave')).display !== 'none'));
    /* 予定を1つ足す（予定の窓の保存の後と同じく saveDB を通す） */
    await page.evaluate(() => {
      const r = DB.residents.find((x) => x.id === 'fl01');
      r.events.push({ id: 'e_plan_new', dayOfWeek: 4, serviceType: 'visit', category: '身体１', startTime: '15:00', endTime: '15:30', detail: '架空の支援', notes: '', units: 0, bathing: false });
      recalcAllEventUnits(); saveDB(); renderAll();
    });
    /* (2) 介護情報の窓で介護度を変える（マスタとつながっている方も、この中だけ選べる） */
    await page.click('button[data-on-click="openCareInfoModal"]');
    await page.waitForSelector('#mk-care-info.open');
    const ciDisabled = await page.evaluate(() => document.getElementById('ci-level').disabled);
    t('(2) 予約の編集の中では、マスタとつながっている方も介護度を選べる', ciDisabled === false);
    t('(2) この計画だけの介護度の注記が出る', await page.evaluate(() => !document.getElementById('ci-level-plan-note').hidden && /この計画だけの介護度です/.test(document.getElementById('ci-level-plan-note').textContent)));
    await page.selectOption('#ci-level', '要介護4');
    await page.click('button[data-on-click="saveCareInfo"]');
    await page.waitForTimeout(400);
    const sum = await page.evaluate(() => ({ level: $('#sum-level').textContent, limit: $('#sum-limit').textContent, want: (effectiveCareLimit_('要介護4') || 0).toLocaleString(), pct: $('#sum-pct').textContent,
      total: Number(String($('#sum-total').textContent).replace(/,/g, '')) }));
    const wantPct = sum.total > 0 ? (Math.round(sum.total / Number(sum.want.replace(/,/g, '')) * 1000) / 10).toFixed(1) + '%' : '—%';
    t('(2) 集計の介護度・限度額・使用率が 要介護4 で出る', sum.level === '要介護4' && sum.limit === sum.want && sum.pct === wantPct, sum);
    await shot(page, 'cp2-plan-mode');
    /* 再読み込みしても予約の編集の続きから戻る（足した予定・介護度もそのまま） */
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('plan-mode') && typeof DB !== 'undefined' && DB.currentResidentId === 'fl01', null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return { ev: r.events.some((e) => e.id === 'e_plan_new'), lv: r.careLevel, tag: document.getElementById('cs-plan-tag').textContent }; });
    t('(1) 再読み込みで予約の編集の続きに戻る（足した予定・この計画の介護度・札）', back.ev && back.lv === '要介護4' && /からの計画（予約）/.test(back.tag), back);
    const raw1 = await lsRaw(page);
    t('(1) 編集の間、本物のキー care_schedule_v2 は1バイトも変わらない', raw1 === raw0);
    t('(1) 編集の間、保存（put）は飛ばない', puts(env) === put0, [puts(env), put0]);
    /* 予約の編集の間は「計画の履歴・予約」が操作の窓になる（見出しのボタンに届かない狭い画面の出口）。そこから保存する */
    await page.click('#cs-plan-btn');
    await page.waitForSelector('#mk-plan.open');
    t('(1) 予約の編集の間の操作の窓に「予約を保存」「閉じて今の計画へ戻る」がある', await page.evaluate(() => { const t0 = document.querySelector('#mk-plan .md').innerText; return /予約を保存/.test(t0) && /閉じて今の計画へ戻る/.test(t0); }));
    /* 押す前の通信の位置を控える（開いた直後の送信（予約なし）を「保存の後の送信」と取り違えないため） */
    const rpcMark = env.st.rpc.length;
    const rpcAfter = () => env.st.rpc.slice(rpcMark).map((r) => r.fn + (r.fn === 'kv_put' ? '[予約' + (((r.body.p_data && r.body.p_data.residents || []).find((x) => x && x.id === 'fl01') || {}).nextPlans || []).length + '件]' : ''));
    await clickText(page, '#mk-plan', '💾 予約を保存');
    await page.waitForFunction(() => !document.body.classList.contains('plan-mode'), null, { timeout: 8000 });
    /* 予約の編集の札は保存の途中（砂場を閉じた所）で外れ、その後にサーバーの今の姿を取り込んでから予約を入れて送る。
       予約が画面の DB に入るまで条件で待ってから読む（待ち切れなくても先へ進み、下の確かめが中身を出して落ちる） */
    const savedIn = await waitFor(() => page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return !!(r && Array.isArray(r.nextPlans) && r.nextPlans.length); }), 8000);
    if (!savedIn) console.log('    （予約が画面に入るのを待ち切れませんでした。押した後の通信: ' + rpcAfter().join(', ') + '）');
    const after = await page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return { events: JSON.stringify(r.events), careLevel: r.careLevel, next: r.nextPlans }; });
    t('(1) 保存で nextPlans に1件入る（開始日・介護度・メモ・予定）', Array.isArray(after.next) && after.next.length === 1 && after.next[0].from === defFrom && after.next[0].careLevel === '要介護4'
      && after.next[0].note === '架空の予約のメモ' && after.next[0].events.some((e) => e.id === 'e_plan_new') && after.next[0].baseLevel === before.careLevel, after.next);
    t('(1) 予約の予定は今の予定の id を保つ（写した予定は同じ id）', after.next && JSON.parse(before.events).every((e) => after.next[0].events.some((p) => p.id === e.id)));
    t('(1) 今の予定（events）と介護度（careLevel）は元のまま', after.events === before.events && after.careLevel === before.careLevel, { b: before.careLevel, a: after.careLevel });
    /* 押した後に初めて届いた送信（kv_put）を確かめる。予約入りの送信が来るまで待つ形にはしない（予約の無い古い姿を先に送る不具合を見逃すため） */
    const sent = await waitFor(() => env.st.rpc.slice(rpcMark).find((r) => r.fn === 'kv_put'), 8000);
    const sentRes = sent && sent.body && sent.body.p_data && Array.isArray(sent.body.p_data.residents) ? sent.body.p_data.residents.find((x) => x && x.id === 'fl01') : null;
    t('(1) 保存の後すぐに送られ、送った中身にも予約が入り今の予定は元のまま', sentRes && Array.isArray(sentRes.nextPlans) && sentRes.nextPlans.length === 1 && JSON.stringify(sentRes.events) === before.events, rpcAfter());
    await sleep(500);
    const putsAfter = env.st.rpc.slice(rpcMark).filter((r) => r.fn === 'kv_put');
    t('(1) 押した後の送信はどれも予約が入っている（予約の無い姿を送らない）', putsAfter.length >= 1 && putsAfter.every((r) => { const x = ((r.body.p_data && r.body.p_data.residents) || []).find((y) => y && y.id === 'fl01'); return x && Array.isArray(x.nextPlans) && x.nextPlans.length === 1; }), rpcAfter());
    const srvMe = (env.st.sbKv.data.residents || []).find((x) => x && x.id === 'fl01');
    t('(a) 今の画面の保存には版の印（csAppVer 2026112701）が付き、門を通る', sent && sent.body.p_data.csAppVer === 2026112701 && !env.st.oldapp && ((srvMe && srvMe.nextPlans) || []).length === 1, { ver: sent && sent.body.p_data && sent.body.p_data.csAppVer, oldapp: env.st.oldapp || 0, srv: ((srvMe && srvMe.nextPlans) || []).length, rpc: rpcAfter() });
    t('(a) 版の印は端末の控え・サーバーに保存した中身に入らない', !(await lsRaw(page)).includes('csAppVer') && !JSON.stringify(env.st.sbKv.data).includes('csAppVer'));
    t('(1) 集計の段に「次の計画 M/D〜」が出る', await page.evaluate(() => /^次の計画 \d+\/\d+〜$/.test(document.getElementById('cs-plan-badge').textContent)));
    await page.close();
  } finally { endChecks(env, '(1)(2)'); await env.context.close(); }
}

/* ═════ (3) 切替日を過ぎた予約 → サーバーの切替が1回呼ばれ、取り直した盤面が新しい計画 ═════ */
if (run(3)) {
  console.log('\n— (3) 切替日を過ぎた予約がある時、cs_plan_switch が1回呼ばれ、取り直した盤面が新しい計画になる —');
  const plan = { id: 'pl_due', from: YESTERDAY, careLevel: '要介護2', baseLevel: '要介護1', note: '', events: [
    { id: 'fl0_v2', dayOfWeek: 1, serviceType: 'visit', category: '身体１', startTime: '10:00', endTime: '10:30', detail: '排泄介助', notes: '', units: 0, bathing: false },
    { id: 'e_due_new', dayOfWeek: 2, serviceType: 'visit', category: '身体１', startTime: '11:00', endTime: '11:30', detail: '架空の支援', notes: '', units: 0, bathing: false }],
    createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'check', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'check' };
  const db = baseDb((me) => { me.nextPlans = [plan]; me.planGone = []; });
  const env = await makeEnv({ db, flags: ROUTED, rpc: {
    cs_plan_switch: (b, st) => {
      let n = 0;
      st.sbKv.data = Object.assign({}, st.sbKv.data, { residents: st.sbKv.data.residents.map((r) => { const a = C.applyDue(r, today, ''); if (a.changed) n++; return a.changed ? a.res : r; }) });
      if (n) st.sbKv.rev++;
      return { ok: true, switched: n, rev: st.sbKv.rev };
    },
  } });
  try {
    const page = await openCs(env);
    const called = await waitFor(() => env.st.rpc.filter((r) => r.fn === 'cs_plan_switch').length >= 1, 20000);
    t('(3) cs_plan_switch が呼ばれる', !!called);
    const switched = await waitFor(() => page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return r && r.planGen === 2 && r.events.some((e) => e.id === 'e_due_new') ? r : null; }), 15000);
    t('(3) 取り直した盤面が新しい計画（予定・世代・開始日・介護度）', !!switched && switched.planFrom === YESTERDAY && switched.careLevel === '要介護2' && !(switched.nextPlans || []).length, switched && { gen: switched.planGen, from: switched.planFrom, lv: switched.careLevel });
    await page.waitForTimeout(3000);
    t('(3) 呼ぶのは1回だけ（1分に1回まで）', env.st.rpc.filter((r) => r.fn === 'cs_plan_switch').length === 1, env.st.rpc.filter((r) => r.fn === 'cs_plan_switch').length);
    t('(3) 切替待ちの帯は出ない', await page.evaluate(() => document.getElementById('cs-plan-warn').hidden));
    t('(3) 1段目に「現行 M/D〜」が出る', await page.evaluate(() => /^現行 \d+\/\d+〜$/.test(document.getElementById('cs-plan-cur').textContent)));
    await page.close();
  } finally { endChecks(env, '(3)'); await env.context.close(); }
}

/* ═════ (3b) 切替の往復の最中に入れた未送信の編集は、取り直しで消えない（反証レビュー B1） ═════ */
if (run(3)) {
  console.log('\n— (3b) 切替の往復の最中に入れた未送信の編集は、取り直しで消えない —');
  const plan = { id: 'pl_due_b', from: YESTERDAY, careLevel: '', baseLevel: '要介護1', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' };
  const db = baseDb((me) => { me.nextPlans = [plan]; });
  let release = null;
  const env = await makeEnv({ db, flags: ROUTED, rpc: {
    cs_plan_switch: (b, st) => new Promise((ok) => { release = () => {
      st.sbKv.data = Object.assign({}, st.sbKv.data, { residents: st.sbKv.data.residents.map((r) => C.applyDue(r, today, '').res) });
      st.sbKv.rev++;
      ok({ ok: true, switched: 1, rev: st.sbKv.rev });
    }; }),
  } });
  try {
    const page = await openCs(env);
    t('(3b) 切替の呼び出しが届く', !!(await waitFor(() => env.st.rpc.some((r) => r.fn === 'cs_plan_switch') && release, 20000)));
    /* 往復の最中に、ほかの方（fl02）の予定を1つ足す（未送信） */
    await page.evaluate(() => {
      const r = DB.residents.find((x) => x.id === 'fl02');
      r.events.push({ id: 'e_mid', dayOfWeek: 3, serviceType: 'visit', category: '身体１', startTime: '17:00', endTime: '17:30', detail: '架空の支援', notes: '', units: 0, bathing: false });
      recalcAllEventUnits(); saveDB();
    });
    release();
    await page.waitForTimeout(2500);
    const kept = await page.evaluate(() => DB.residents.find((x) => x.id === 'fl02').events.some((e) => e.id === 'e_mid'));
    t('(3b) 往復の後も、最中に入れた未送信の予定が残る（取り直しで消さない）', kept);
    t('(3b) 未送信の印が残るか、送られている（消えていない）', await page.evaluate(() => SYNC._dirty === true) || env.st.rpc.some((r) => r.fn === 'kv_put' && JSON.stringify(r.body.p_data).includes('e_mid')));
    await page.close();
  } finally { endChecks(env, '(3b)'); await env.context.close(); }
}

/* ═════ (4) 口が無い時は帯と［今すぐ切り替える］ ═════ */
if (run(4)) {
  console.log('\n— (4) 切替の口が無い時は帯と［今すぐ切り替える］が出て、押すと切り替わる —');
  const plan = { id: 'pl_due4', from: YESTERDAY, careLevel: '', baseLevel: '要介護1', note: '架空', events: [
    { id: 'e4_only', dayOfWeek: 5, serviceType: 'visit', category: '身体１', startTime: '13:00', endTime: '13:30', detail: '架空の支援', notes: '', units: 0, bathing: false }],
    updatedAt: '2026-11-01T00:00:00.000Z' };
  /* 新しい保存先だが切替の口が無い（共通 DB にまだ流していない）時。Google の道では予約の機能を出さない（(d)） */
  const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED });
  try {
    const page = await openCs(env);
    const band = await waitFor(() => page.evaluate(() => { const w = document.getElementById('cs-plan-warn'); return w && !w.hidden ? w.textContent : null; }), 15000);
    t('(4) 帯「〇〇さんの M月D日からの計画が、まだ切り替わっていません」が出る', !!band && /さんの \d+月\d+日からの計画が、まだ切り替わっていません/.test(band), band);
    t('(4) 盤面は今の計画のまま（予約の予定を出さない）', await page.evaluate(() => !DB.residents.find((x) => x.id === 'fl01').events.some((e) => e.id === 'e4_only')));
    await shot(page, 'cp4-band');
    await page.click('#cs-plan-warn');
    await page.waitForSelector('#mk-plan.open');
    await shot(page, 'cp4-year-due');
    const put0 = puts(env);
    await clickText(page, '#mk-plan', '今すぐ切り替える');
    await sudOk(page);
    const sw = await waitFor(() => page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); return r.planGen === 2 ? r : null; }));
    t('(4) 押すと切り替わる（予定は予約の物・世代 2・開始日・介護度は変えない）', !!sw && sw.events.length === 1 && sw.events[0].id === 'e4_only' && sw.planFrom === YESTERDAY && sw.careLevel === '要介護1' && sw.planNote === '架空', sw && { n: sw.events.length, from: sw.planFrom, lv: sw.careLevel });
    t('(4) 切り替えた中身を送る', !!(await waitFor(() => puts(env) > put0)));
    t('(4) 帯が消える', await waitFor(() => page.evaluate(() => document.getElementById('cs-plan-warn').hidden)));
    await page.close();
  } finally { endChecks(env, '(4)'); await env.context.close(); }
}

/* ═════ (5)(7) 年表と過去の計画を見る・危ない文字 ═════ */
if (run(5) || run(7)) {
  console.log('\n— (5)(7) 年表に予約・現行・過去の計画・変更の記録が出る／過去の計画を開くと盤面が動かせない／危ない文字は文字のまま —');
  const plan = { id: 'pl_x', from: LATER, careLevel: '要介護3', baseLevel: '要介護1', note: XSS, events: [],
    createdAt: '2026-11-20T01:00:00.000Z', createdBy: XSS, updatedAt: '2026-11-20T01:00:00.000Z', updatedBy: XSS };
  const prevEv = [{ id: 'old1', dayOfWeek: 0, serviceType: 'visit', category: '身体１', startTime: '09:00', endTime: '09:30', detail: XSS, notes: '', units: 0, bathing: false }];
  const rows = [
    { id: 30, at: '2026-11-27T01:42:00.000Z', by: 'check-flow-office@example.invalid', kind: 'edit', gen: 1, detail: { before: [], after: prevEv } },
    { id: 20, at: '2026-11-20T01:00:00.000Z', by: XSS, kind: 'reserve', gen: 1, detail: { op: 'add', planId: 'pl_x', from: LATER, careLevel: '要介護3', count: 0, after: [] } },
    { id: 10, at: '2026-04-01T00:01:00.000Z', by: 'system', kind: 'switch', gen: 1, detail: { prevFrom: '2025-10-01', prevLevel: '要介護2', prevEvents: prevEv, from: '2026-04-01', level: '要介護1', count: 3 } },
  ];
  const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; me.planNote = XSS; }), flags: ROUTED, rpc: {
    cs_plan_log_list: () => ({ ok: true, rows, more: false }),
    cs_plan_switch: () => ({ ok: true, switched: 0, rev: 5 }),
  } });
  try {
    const page = await openCs(env);
    await waitFor(() => page.evaluate(() => !!window.SUAuth), 15000);
    await page.click('#cs-plan-btn');
    await page.waitForSelector('#mk-plan.open');
    const txt = await waitFor(() => page.evaluate(() => { const t0 = document.querySelector('#mk-plan .md').innerText; return /変更の記録/.test(t0) && /計画が切り替わりました/.test(t0) ? t0 : null; }), 10000);
    t('(5) 予約（札・開始日・介護度の変わり方）が出る', !!txt && /予約（これからの計画）/.test(txt) && /要介護1 → 要介護3/.test(txt), txt && txt.slice(0, 300));
    t('(5) 現行（開始日）が出る', !!txt && /今の計画（現行）/.test(txt) && /2026年4月1日（水）から/.test(txt));
    t('(5) 過去の計画（期間・介護度・件数）が出る', !!txt && /2025年10月1日〜2026年3月31日/.test(txt) && /介護度 要介護2　予定 1件/.test(txt));
    t('(5) 変更の記録（日時・人・追加の行・予約・切替）が出る', !!txt && /11月27日 10:42/.test(txt) && /＋ 月 09:00〜09:30 身体１/.test(txt) && /予約を作りました/.test(txt) && /計画が切り替わりました/.test(txt), txt && txt.slice(-400));
    t('(7) 危ない文字は文字のまま出て、動かない', await page.evaluate((x) => window.__xss === undefined && document.querySelector('#mk-plan .md').textContent.includes(x) && !document.querySelector('#mk-plan img'), XSS));
    await shot(page, 'cp5-year');
    const raw0 = await lsRaw(page), put0 = puts(env);
    await clickText(page, '#mk-plan', '見る');
    await page.waitForFunction(() => document.body.classList.contains('view-mode'), null, { timeout: 5000 });
    const v = await page.evaluate(() => ({ locked: BOARD_LOCKED, ev: DB.residents.find((x) => x.id === 'fl01').events.map((e) => e.id), lv: DB.residents.find((x) => x.id === 'fl01').careLevel, tag: document.getElementById('cs-plan-tag').textContent }));
    t('(5) 過去の計画の予定・介護度を盤面に出す', v.ev.join(',') === 'old1' && v.lv === '要介護2' && /^見るだけ過去の計画（2025年10月1日〜2026年3月31日）/.test(v.tag), v);
    t('(5) 盤面は動かせない（移動ロック）', v.locked === true);
    await page.evaluate(() => toggleBoardLock());
    t('(5) ロックの解除も効かない', await page.evaluate(() => BOARD_LOCKED === true));
    await page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl01'); r.events = []; saveDB(); });
    t('(5) 変えても保存せず入った時の姿に戻す', await page.evaluate(() => DB.residents.find((x) => x.id === 'fl01').events.length === 1));
    await shot(page, 'cp5-view-mode');
    t('(5) 見ている間、本物のキーは変わらず送らない', (await lsRaw(page)) === raw0 && puts(env) === put0);
    await page.click('#btnPlanClose');
    await page.waitForFunction(() => !document.body.classList.contains('view-mode'), null, { timeout: 5000 });
    t('(5) 閉じると今の計画に戻り、端末のロックの設定（解除）に戻る', await page.evaluate(() => BOARD_LOCKED === false && DB.residents.find((x) => x.id === 'fl01').events.length > 1));
    t('(7) 危ない文字を入れたメモでも何も動かない（最後まで）', await page.evaluate(() => window.__xss === undefined));
    await page.close();
  } finally { endChecks(env, '(5)(7)'); await env.context.close(); }
}

/* ═════ (6) 記録の口が断られても画面にエラーが出ない ═════ */
if (run(6)) {
  console.log('\n— (6) 記録の口が断られた時は、その区画に理由を1行出し、予約と現行は出す —');
  const env = await makeEnv({ db: baseDb(), flags: ROUTED, rpc: {
    cs_plan_log_list: () => ({ __status: 403, body: { code: '42501', message: 'not allowed' } }),
  } });
  try {
    const page = await openCs(env);
    await waitFor(() => page.evaluate(() => !!window.SUAuth), 15000);
    await page.click('#cs-plan-btn');
    await page.waitForSelector('#mk-plan.open');
    const txt = await waitFor(() => page.evaluate(() => { const t0 = document.querySelector('#mk-plan .md').innerText; return /記録を読めません/.test(t0) ? t0 : null; }), 10000);
    t('(6) 「記録を読めません（…）」が出る', !!txt && /記録を読めません（事務所・管理者としてログインすると出ます）/.test(txt), txt && txt.slice(-200));
    t('(6) 予約と現行の区画は出る', !!txt && /予約（これからの計画）/.test(txt) && /今の計画（現行）/.test(txt));
    await shot(page, 'cp6-log-denied');
    await page.close();
  } finally { endChecks(env, '(6)'); await env.context.close(); }
}

/* ═════ (9) 版の印の門・部品が読めない端末・Google の道（2026-11-27 データ保護の反証レビュー） ═════ */
if (run(9)) {
  console.log('\n— (9) 部品を読ませない端末・古い版と断られた時・Google の道とログインなし —');
  const edit = (page) => page.evaluate(() => { const r = DB.residents.find((x) => x.id === 'fl02'); r.events.push({ id: 'e_g' + r.events.length, dayOfWeek: 3, serviceType: 'visit', category: '身体１', startTime: '17:00', endTime: '17:30', detail: '架空の支援', notes: '', units: 0, bathing: false }); recalcAllEventUnits(); saveDB(); });
  /* (b) 部品を読ませない端末・予約のあるデータ */
  {
    const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [{ id: 'pl_b9', from: LATER, careLevel: '', baseLevel: '', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' }]; }), flags: ROUTED, noCalc: true });
    try {
      const page = await openCs(env);
      t('(b) 部品が読めていない（CarePlanCalc が無い）', await page.evaluate(() => typeof window.CarePlanCalc === 'undefined'));
      await edit(page);
      await page.evaluate(() => { if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
      await sleep(1500);
      t('(b) 版の項目のあるデータは送らない（保存の0件）', !env.st.rpc.some((r) => r.fn === 'kv_put'));
      t('(b) 帯「計画の部品を読めませんでした。読み込み直してください」が出る', await page.evaluate(() => { const w = document.getElementById('cs-app-warn'); return w && w.style.display !== 'none' && w.textContent === '計画の部品を読めませんでした。読み込み直してください'; }));
      t('(b) 編集は端末に残る（未送信の印つき）', await page.evaluate(() => SYNC._dirty === true && DB.residents.find((x) => x.id === 'fl02').events.some((e) => /^e_g/.test(e.id))));
      await shot(page, 'cp9-parts-missing');
      await page.close();
    } finally { endChecks(env, '(b)'); await env.context.close(); }
  }
  /* (b2) 部品を読ませない端末でも、版の項目を誰も持たないデータは今までどおり送る */
  {
    const db0 = F.careDb(); db0.currentResidentId = 'fl01';
    const env = await makeEnv({ db: db0, flags: ROUTED, noCalc: true });
    try {
      const page = await openCs(env);
      await edit(page);
      await page.evaluate(() => { if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
      const sent = await waitFor(() => env.st.rpc.find((r) => r.fn === 'kv_put'));
      t('(b2) 版の項目の無いデータは部品が無くても今までどおり送る（版の印は付けない）', !!sent && sent.body.p_data.csAppVer === undefined && !env.st.oldapp);
      await page.close();
    } finally { endChecks(env, '(b2)'); await env.context.close(); }
  }
  /* (c) 古い版と断られた時 */
  {
    const env = await makeEnv({ db: baseDb(), flags: ROUTED, forceOld: true });
    try {
      const page = await openCs(env);
      await edit(page);
      await page.evaluate(() => { if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; } return SYNC.push(); });
      await waitFor(() => env.st.oldapp >= 1);
      await page.evaluate(() => { saveDB(); return SYNC.push(); });
      await sleep(3000);
      t('(c) oldapp が返ると送り直さない（保存の試み1回だけ）', env.st.oldapp === 1, env.st.oldapp);
      t('(c) 帯「この画面は古い版です。読み込み直してください」が出て、未送信は端末に残る', await page.evaluate(() => { const w = document.getElementById('cs-app-warn'); return w && w.style.display !== 'none' && /この画面は古い版です。読み込み直してください/.test(w.textContent) && SYNC._dirty === true; }));
      await page.close();
    } finally { endChecks(env, '(c)'); await env.context.close(); }
  }
  /* (d) Google の道・ログインなしでは予約のボタンが出ない */
  for (const [label, flags, storage] of [['Google の道', F.FLAGS_OFF, null], ['ログインなし', ROUTED, 'nologin']]) {
    const dbD = baseDb((me) => { me.nextPlans = [{ id: 'pl_d9', from: LATER, careLevel: '', baseLevel: '', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' }]; });
    /* ログインなしの時は取得できないので、端末の控えに同じデータを置いておく */
    const env = await makeEnv({ db: dbD, flags, localDb: storage === 'nologin' ? dbD : null });
    try {
      if (storage === 'nologin') await env.context.addInitScript(() => { try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* 何もしない */ } });
      const page = await env.context.newPage();
      await page.goto(srv.url + '/care-schedule.html', { waitUntil: 'load' });
      await waitFor(() => page.evaluate(() => typeof DB !== 'undefined' && DB.residents.length > 0 && DB.currentResidentId === 'fl01'), 20000);
      await page.click('#cs-plan-btn');
      await page.waitForSelector('#mk-plan.open');
      const txt = await waitFor(() => page.evaluate(() => { const t0 = document.querySelector('#mk-plan .md').innerText; return /この機能は、ログインしている事務所の端末で使えます/.test(t0) ? t0 : null; }), 10000);
      t('(d) ' + label + ': 「この機能は、ログインしている事務所の端末で使えます」が出る', !!txt);
      t('(d) ' + label + ': ［＋ 次の計画を作る］［開いて直す］［取り消す］が出ない・予約は見える', !!txt && !/＋ 次の計画を作る|開いて直す|取り消す/.test(txt) && /予約（これからの計画）/.test(txt) && /から/.test(txt));
      await page.close();
    } finally { endChecks(env, '(d) ' + label); await env.context.close(); }
  }
}

/* ═════ (10) 使い始めのスイッチが切の時・強制保存（2026-11-27 門まわりの反証 3回目） ═════ */
if (run(10)) {
  console.log('\n— (10) 使い始めのスイッチが切の時は予約のボタンを出さず切替の見張りもしない・強制保存は前の計画で上書きしない —');
  {
    const plan = { id: 'pl_off', from: YESTERDAY, careLevel: '', baseLevel: '要介護1', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' };
    const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED, planOn: false, rpc: { cs_plan_switch: () => ({ ok: true, switched: 0, rev: 5 }) } });
    try {
      const page = await openCs(env);
      await waitFor(() => page.evaluate(() => !!window.SUAuth), 15000);
      await sleep(3000);
      t('(10) スイッチが切の間は切替の見張りをしない（cs_plan_switch を呼ばない）・切替待ちの帯も出さない', !env.st.rpc.some((r) => r.fn === 'cs_plan_switch') && await page.evaluate(() => document.getElementById('cs-plan-warn').hidden));
      await page.click('#cs-plan-btn');
      await page.waitForSelector('#mk-plan.open');
      const txt = await waitFor(() => page.evaluate(() => { const t0 = document.querySelector('#mk-plan .md').innerText; return /この機能はまだ使い始めていません/.test(t0) ? t0 : null; }), 10000);
      t('(10) 「この機能はまだ使い始めていません（準備ができたら使えるようになります）」が出て、予約のボタンが出ない', !!txt && /この機能はまだ使い始めていません（準備ができたら使えるようになります）/.test(txt) && !/＋ 次の計画を作る|開いて直す|取り消す|今すぐ切り替える/.test(txt));
      t('(10) 今ある予約と今の計画は見える', !!txt && /予約（これからの計画）/.test(txt) && /今の計画（現行）/.test(txt));
      await page.close();
    } finally { endChecks(env, '(10) スイッチ切'); await env.context.close(); }
  }
  {
    /* 強制保存: サーバーは切り替え済み（世代1）・端末は前の計画（世代0）のまま */
    const plan = { id: 'pl_f', from: YESTERDAY, careLevel: '', baseLevel: '要介護1', note: '', events: [{ id: 'e_f', dayOfWeek: 2, serviceType: 'visit', category: '身体１', startTime: '12:00', endTime: '12:30', detail: '架空の支援', notes: '', units: 0, bathing: false }], updatedAt: '2026-11-01T00:00:00.000Z' };
    const oldDb = baseDb((me) => { me.planGen = 0; me.nextPlans = [plan]; });
    const srvDb = JSON.parse(JSON.stringify(oldDb)); srvDb.residents[0] = C.applyDue(srvDb.residents[0], today, '').res;
    const env = await makeEnv({ db: oldDb, sbDb: srvDb, localDb: oldDb, flags: ROUTED, rpc: { cs_plan_switch: (b, st) => ({ ok: true, switched: 0, rev: st.sbKv.rev }) } });
    try {
      const page = await env.context.newPage();
      await page.goto(srv.url + '/care-schedule.html', { waitUntil: 'load' });
      await waitFor(() => page.evaluate(() => typeof DB !== 'undefined' && DB.residents.length > 0), 20000);
      /* 起動の時の取得（kv_get）が返って取り込まれるまで待つ。待たずに端末を前の計画に戻すと、後から届いた取得が
         サーバーの新しい計画（世代1）で DB を置き換え、強制保存が「前の計画で上書き」にならないまま通ってしまう（窓が出ず時間切れ） */
      const srvGen = srvDb.residents[0].planGen;
      const adopted = await waitFor(() => env.st.rpc.some((r) => r.fn === 'kv_get') && page.evaluate((g) => !SYNC._busy && DB.residents[0].planGen === g, srvGen), 20000);
      if (!adopted) console.log('    （起動の時の取得の取り込みを待ち切れませんでした。通信: ' + env.st.rpc.map((r) => r.fn).join(', ') + '）');
      /* 端末を前の計画に戻して（古い控えを持つ端末の再現）、強制保存を押す */
      await page.evaluate((d) => { SYNC.stopPolling(); DB = JSON.parse(d); saveLocalOnly(); }, JSON.stringify(oldDb));
      const n0 = env.st.rpc.filter((r) => r.fn === 'kv_put').length;
      const p = page.evaluate(() => syncForcePush());
      /* 1つ目は今までの「上書きします。よろしいですか？」の確かめ（OK を押す） */
      await waitFor(() => page.evaluate(() => { const d = document.querySelector('dialog.sud-dlg[open]'); return d && /このローカルのデータで上書きします/.test(d.innerText); }), 10000);
      await sudOk(page);
      const msg = await waitFor(() => page.evaluate(() => { const d = document.querySelector('dialog.sud-dlg[open]'); return d && !/このローカルのデータで上書きします/.test(d.innerText) ? d.innerText : null; }), 10000);
      const putsF = () => env.st.rpc.filter((r) => r.fn === 'kv_put').slice(n0).map((r) => ({ force: r.body.p_force, gen: r.body.p_data && r.body.p_data.residents[0].planGen }));
      t('(10) 強制保存: 世代の小さい方がいる時は上書きせず「切り替えた後の計画を、前の計画で上書きすることはできません。読み込み直してから直してください」', !!msg && msg.includes('切り替えた後の計画を、前の計画で上書きすることはできません。読み込み直してから直してください'), msg || { 窓なし: true, 送信: putsF() });
      if (msg) await sudOk(page);
      await Promise.race([p.catch(() => {}), sleep(10000)]);   /* 窓が出ないまま止まっても、ここで待ち続けず下の確かめへ進む */
      await sleep(1000);
      const putsAfter = env.st.rpc.filter((r) => r.fn === 'kv_put').slice(n0);
      t('(10) 強制保存（p_force）は送らない・サーバーの今の計画のまま（世代1）', !putsAfter.some((r) => r.body.p_force === true) && env.st.sbKv.data.residents[0].planGen === 1, putsAfter.map((r) => ({ force: r.body.p_force, gen: r.body.p_data && r.body.p_data.residents[0].planGen })));
      await page.close();
    } finally { endChecks(env, '(10) 強制保存'); await env.context.close(); }
  }
}

/* ═════ (8) ほかの所（定時の仕事）で切り替わった版を受け取ったら、Google へ1回写し返す ═════ */
if (run(8)) {
  console.log('\n— (8) サーバーで切り替わった版を受け取ると、Google への写し返し（mirror の印）が1回届く —');
  const plan = { id: 'pl_m', from: YESTERDAY, careLevel: '', baseLevel: '要介護1', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' };
  const oldDb = baseDb((me) => { me.nextPlans = [plan]; });
  const srvDb = JSON.parse(JSON.stringify(oldDb));
  srvDb.residents[0] = C.applyDue(srvDb.residents[0], today, '').res;
  const env = await makeEnv({ db: oldDb, sbDb: srvDb, localDb: oldDb, flags: ROUTED, rpc: { cs_plan_switch: (b, st) => ({ ok: true, switched: 0, rev: st.sbKv.rev }) } });
  try {
    const page = await openCs(env);
    const got = await waitFor(() => page.evaluate(() => DB.residents.find((x) => x.id === 'fl01').planGen === 2), 15000);
    t('(8) 切り替わった版を受け取る', !!got);
    const mir = await waitFor(() => env.st.req.find((r) => r.to === 'sync' && r.action === 'put' && r.body && r.body.mirror === true && r.body.force === true), 30000, 500);
    t('(8) 20秒ほどで Google へ写し返しが届く（force・mirror の印・中身は切り替えた後）', !!mir && mir.body.data.residents[0].planGen === 2, mir && { gen: mir.body.data.residents[0].planGen });
    t('(8) 写し返しは1回', env.st.req.filter((r) => r.to === 'sync' && r.action === 'put' && r.body && r.body.mirror === true).length === 1);
    await page.close();
  } finally { endChecks(env, '(8)'); await env.context.close(); }
}

/* ═════ (11) 版の印: 送る時にまだ確かめていない時は、予約ありの中身なら口 cs_plan_gate の答えを待って印を付ける（反証 F1・2026-11-27） ═════ */
if (run(11)) {
  console.log('\n— (11) 送る時にまだ確かめていない・答えが0.8秒遅れる・予約あり → 答えを待って版の印を付ける —');
  const plan = { id: 'pl_w', from: LATER, careLevel: '', baseLevel: '要介護1', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' };
  const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED, rpc: {
    cs_plan_gate: async () => { await sleep(800); return GATE.csPlanGate(); },
  } });
  try {
    const page = await openCs(env);
    await waitFor(() => env.st.rpc.some((r) => r.fn === 'cs_plan_gate'), 15000);
    await sleep(2000);
    const n0 = env.st.rpc.filter((r) => r.fn === 'kv_put').length;
    const ms = await page.evaluate(async () => {
      const r = DB.residents.find((x) => x.id === 'fl01'); r.events[0].notes = '待ちの架空の直し'; saveDB();
      if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; }
      csPlanGate_ = { yes: false, noAt: 0, p: null };   /* 送る時にまだ確かめていない形にする */
      const t0 = Date.now(); await SYNC.push(); return Date.now() - t0;
    });
    const sent = env.st.rpc.filter((r) => r.fn === 'kv_put').slice(n0);
    t('(11) 答えを待ってから送り（' + ms + 'ミリ秒）、送った本文に版の印（2026112701）が付いて門を通る', sent.length >= 1 && sent[0].body.p_data.csAppVer === 2026112701 && ms >= 750 && !env.st.oldapp
      && env.st.sbKv.data.residents.find((x) => x.id === 'fl01').events[0].notes === '待ちの架空の直し', { ms, ver: sent[0] && sent[0].body.p_data.csAppVer, oldapp: env.st.oldapp });
    t('(11) 端末の控え・サーバーに保存した中身に版の印が入らない', !(await lsRaw(page)).includes('csAppVer') && !JSON.stringify(env.st.sbKv.data).includes('csAppVer'));
    await page.close();
  } finally { endChecks(env, '(11)'); await env.context.close(); }
}

/* ═════ (12) 印なしで送って oldapp の時の確かめ直しと1回の送り直し（2026-11-27 反証） ═════ */
if (run(12)) {
  const plan = { id: 'pl_r', from: LATER, careLevel: '', baseLevel: '要介護1', note: '', events: [], updatedAt: '2026-11-01T00:00:00.000Z' };
  const gateCalls = (env) => env.st.rpc.filter((r) => r.fn === 'cs_plan_gate').length;
  const bandOn = (page) => page.evaluate(() => { const w = document.getElementById('cs-app-warn'); return !!w && w.style.display !== 'none' && /この画面は古い版です/.test(w.textContent); });
  /* (12a) 口の答えが4.5秒遅れる・送る時にまだ確かめていない → 3秒で印なしで送る → oldapp → 確かめの答えを待って印つきで1回送り直す */
  {
    console.log('\n— (12a) 口の答えが3秒に間に合わず印なしで送って oldapp → 確かめ直して印つきで1回送り直して通る —');
    const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED, rpc: {
      cs_plan_gate: async () => { await sleep(4500); return GATE.csPlanGate(); },
    } });
    try {
      const page = await openCs(env);
      await waitFor(() => env.st.rpc.some((r) => r.fn === 'cs_plan_gate'), 15000);
      await sleep(5500);
      const n0 = env.st.sbKv.log ? env.st.sbKv.log.length : 0;
      const g0 = gateCalls(env);
      const r = await page.evaluate(async () => {
        const me = DB.residents.find((x) => x.id === 'fl01'); me.events[0].notes = '送り直しの架空の直し'; saveDB();
        if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; }
        csPlanGate_ = { yes: false, noAt: 0, p: null };   /* 送る時にまだ確かめていない形にする */
        const t0 = Date.now(); const ok = await SYNC.push(); return { ok, ms: Date.now() - t0, oldApp: !!SYNC._oldApp, dirty: SYNC._dirty === true, retry: !!SYNC._oldAppRetry };
      });
      const log = (env.st.sbKv.log || []).slice(n0);
      t('(12a) 送信はちょうど2本: 印なしで oldapp → 印つき（2026112701）で通る', log.length === 2 && log[0].ver === null && log[0].result === 'oldapp' && log[1].ver === 2026112701 && log[1].result === 'ok', log);
      t('(12a) 口の確かめは送信の間に1本だけ（確かめの最中の答えを待つ）', gateCalls(env) - g0 === 1, gateCalls(env) - g0);
      t('(12a) 保存は成功（' + r.ms + 'ミリ秒）・古い版の印を立てない・未送信が残らない・送り直しの印は戻る', r.ok === true && r.oldApp === false && r.dirty === false && r.retry === false && r.ms >= 4000, r);
      t('(12a) 帯「この画面は古い版です」は出ない', !(await bandOn(page)));
      t('(12a) サーバーに直しが入り、端末の控え・サーバーに版の印が入らない', env.st.sbKv.data.residents.find((x) => x.id === 'fl01').events[0].notes === '送り直しの架空の直し'
        && !(await lsRaw(page)).includes('csAppVer') && !JSON.stringify(env.st.sbKv.data).includes('csAppVer'));
      await page.close();
    } finally { endChecks(env, '(12a)'); await env.context.close(); }
  }
  /* (12b) 印つきで oldapp（本当に古い版と断られた）→ 送り直さない */
  {
    console.log('\n— (12b) 印つきで送って oldapp の時は送り直さない —');
    const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED, forceOld: true });
    try {
      const page = await openCs(env);
      await waitFor(() => page.evaluate(() => csPlanGate_.yes === true), 15000);
      const n0 = env.st.sbKv.log ? env.st.sbKv.log.length : 0;
      const g0 = gateCalls(env);
      /* 落ちた時に原因が読めるよう、送る前の状態（古い版の印・取得の最中か・数え始めより前の送信）を控える */
      const pre = await page.evaluate(() => ({ oldApp: !!SYNC._oldApp, busy: !!SYNC._busy, dirty: SYNC._dirty === true }));
      const preLog = (env.st.sbKv.log || []).slice(0, n0);
      const r = await page.evaluate(async () => {
        const me = DB.residents.find((x) => x.id === 'fl01'); me.events[0].notes = '印つきの架空の直し'; saveDB();
        if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; }
        const ok = await SYNC.push(); return { ok, oldApp: !!SYNC._oldApp, dirty: SYNC._dirty === true };
      });
      await sleep(1500);
      const log = (env.st.sbKv.log || []).slice(n0);
      t('(12b) 送信は1本だけ（印つき・oldapp）・送り直さない', log.length === 1 && log[0].ver === 2026112701 && log[0].result === 'oldapp', { log, 送る前: pre, 数え始めより前の送信: preLog, 答え: r });
      t('(12b) 口を確かめ直さない', gateCalls(env) === g0, [g0, gateCalls(env)]);
      t('(12b) 止めて案内（古い版の印・未送信は端末に残る・帯が出る）', r.ok === false && r.oldApp === true && r.dirty === true && await bandOn(page), r);
      await page.close();
    } finally { endChecks(env, '(12b)'); await env.context.close(); }
  }
  /* (12c) 口が無い（答えがエラー）ままで予約あり → 印なしで oldapp → 確かめ直しても「なし」→ 1回で止める */
  {
    console.log('\n— (12c) 口が「なし」のまま印なしで送って oldapp → 確かめ直しても「なし」なら1回で止める —');
    const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED, rpc: {
      cs_plan_gate: () => ({ __status: 404, body: { code: 'PGRST202', message: 'Could not find the function', details: null, hint: null } }),
    } });
    try {
      const page = await openCs(env);
      await waitFor(() => env.st.rpc.some((r) => r.fn === 'cs_plan_gate'), 15000);
      await sleep(1500);
      /* 起動の後の最初の送信（起動の時に送る時はその送信・送らない時は下の送信）で、印なし→oldapp→確かめ直し→止める、になる。
         どちらの時も、送信は全部で1本・口の確かめは起動の時の1本と確かめ直しの1本で2本 */
      const r = await page.evaluate(async () => {
        const me = DB.residents.find((x) => x.id === 'fl01'); me.events[0].notes = 'なしの架空の直し'; saveDB();
        if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; }
        const ok = await SYNC.push(); return { ok, oldApp: !!SYNC._oldApp, dirty: SYNC._dirty === true, yes: csPlanGate_.yes };
      });
      await sleep(1500);
      const log = env.st.sbKv.log || [];
      t('(12c) 送信は全部で1本だけ（印なし・oldapp）', log.length === 1 && log[0].ver === null && log[0].result === 'oldapp', log);
      t('(12c) 5分の間でも口を1回確かめ直した（起動の時と合わせて2本・答えは「なし」）', gateCalls(env) === 2 && r.yes === false, [gateCalls(env), r.yes]);
      t('(12c) 止めて案内（古い版の印・未送信は端末に残る・帯が出る）', r.ok === false && r.oldApp === true && r.dirty === true && await bandOn(page), r);
      await page.close();
    } finally { endChecks(env, '(12c)'); await env.context.close(); }
  }
  /* (12d) 口の答えが4.5秒遅れる・門がいつも oldapp → 印なしで oldapp → 確かめ直して印つきで送り直しても oldapp → そこで止める（送り直しは1回だけ） */
  {
    console.log('\n— (12d) 送り直しても oldapp なら、送信2本（印なし→印つき）で止めて案内する —');
    const env = await makeEnv({ db: baseDb((me) => { me.nextPlans = [plan]; }), flags: ROUTED, forceOld: true, rpc: {
      cs_plan_gate: async () => { await sleep(4500); return GATE.csPlanGate(); },
    } });
    try {
      const page = await openCs(env);
      /* 起動の後の最初の送信（起動の時に送る時はその送信・送らない時は下の送信）で、印なし→oldapp→確かめ直し→印つきで送り直し→oldapp→止める、になる */
      const r = await page.evaluate(async () => {
        const me = DB.residents.find((x) => x.id === 'fl01'); me.events[0].notes = '二度断られる架空の直し'; saveDB();
        if (SYNC._pushTimer) { clearTimeout(SYNC._pushTimer); SYNC._pushTimer = null; }
        if (!csPlanGate_.yes) csPlanGate_ = { yes: false, noAt: 0, p: null };   /* 送る時にまだ確かめていない形にする */
        const ok = await SYNC.push(); return { ok, oldApp: !!SYNC._oldApp, dirty: SYNC._dirty === true, retry: !!SYNC._oldAppRetry };
      });
      await waitFor(() => page.evaluate(() => !!SYNC._oldApp && !SYNC._busy), 20000);
      await page.evaluate(() => SYNC.push());
      await sleep(1500);
      const log = env.st.sbKv.log || [];
      t('(12d) 送信は全部でちょうど2本: 印なしで oldapp → 印つきで oldapp（3本目は送らない）', log.length === 2 && log[0].ver === null && log[0].result === 'oldapp' && log[1].ver === 2026112701 && log[1].result === 'oldapp', log);
      t('(12d) 止めて案内（古い版の印・未送信は端末に残る・帯が出る・送り直しの印は戻る）', await page.evaluate(() => !!SYNC._oldApp && SYNC._dirty === true && !SYNC._oldAppRetry) && await bandOn(page), r);
      await page.close();
    } finally { endChecks(env, '(12d)'); await env.context.close(); }
  }
}

/* ═════ (13) 送信の往復の最中に入れた次の直しは、成功の後も未送信のまま残り、取得で消えず、続けて送られる（2026-11-28） ═════
   1つ目の直しを送り、答えを止めている間に2つ目の直しを入れる → 答え（成功）→ 続けて送る。
   直す前は、成功で未送信の印が消え、取得がほかの端末の版を取り込んで2つ目の直しが画面からもサーバーからも消えていた。
   (a)(b) ほかの端末がサーバーを進める（往復が2秒の自動送信より長い・短い）→ 定期の取得
   (c) だれも進めない → 続けて送る版は1つ目の答えの版で、競合にならない
   (d) 同じ端末の別のタブ（ワークスケジュール）がサーバーと共有の版数を進める → 続けて送る送信は1つ目の答えの版を名乗って競合に倒れ、相手の変更を上書きしない
   (e) 往復の最中に試算を始め、答えの後に閉じる → 試算の間は送らず、閉じた後に本物の中身を続けて送る */
if (run(13)) {
  for (const [tag, holdMs, other] of [['a', 2600, 'server'], ['b', 400, 'server'], ['c', 400, 'none'], ['d', 400, 'tab'], ['e', 400, 'sim']]) {
    console.log('\n— (13' + tag + ') 送信の往復（' + holdMs + 'ms）の最中に入れた直しは、成功の後も消えずに続けて送られる（' + ({ server: 'ほかの端末が進める', none: 'だれも進めない', tab: '別のタブが共有の版数を進める', sim: '往復の最中に試算を始め、答えの後に閉じる' })[other] + '） —');
    let held = false, release = null, firstRev = null;
    const ev = (id, h) => ({ id, dayOfWeek: 4, serviceType: 'visit', category: '身体１', startTime: h + ':00', endTime: h + ':30', detail: '架空の支援', notes: '', units: 0, bathing: false });
    const env = await makeEnv({ db: baseDb(), flags: ROUTED, rpc: {
      kv_put: (b, st) => {
        if (!held && JSON.stringify(b.p_data || {}).includes('e_first')) {
          held = true;
          /* 答えを返す時に、ほかの端末（または別のタブ）がサーバーを進めた形にする（成功の答えが届いた時には、もうサーバーが先にある） */
          return new Promise((ok) => { release = () => {
            const r = GATE.kvPut(st.sbKv, b);
            firstRev = st.sbKv.rev; st.logAt = (st.sbKv.log || []).length;
            if (other === 'server' || other === 'tab') {
              const d = JSON.parse(JSON.stringify(st.sbKv.data));
              d.residents.find((x) => x.id === 'fl03').events.push(ev('e_other', '15'));
              st.sbKv.data = d; st.sbKv.rev++;
            }
            ok(r);
          }; });
        }
        return GATE.kvPut(st.sbKv, b);
      },
    } });
    const has = (d, rid, id) => !!(d && d.residents.find((x) => x.id === rid).events.some((e) => e.id === id));
    try {
      const page = await openCs(env);
      /* 起動の後の送信（単位マスタの押し戻し・900ms 後）が済んで静かになるまで待つ（試験の送信と競わないため） */
      await waitFor(() => page.evaluate(() => !SYNC._busy && !SYNC._dirty), 15000);
      await page.waitForTimeout(2000);
      await waitFor(() => page.evaluate(() => !SYNC._busy && !SYNC._dirty), 15000);
      /* 1つ目の直し（fl01）を保存して送る（2秒の自動送信は待たずにすぐ送る） */
      await page.evaluate((e) => {
        DB.residents.find((x) => x.id === 'fl01').events.push(e);
        recalcAllEventUnits(); saveDB();
        clearTimeout(SYNC._pushTimer);
        /* 送信の終わりと同じ流れで、未送信の印と固定した版を控える（続けて送る送信と競走しないため） */
        window.__p13 = SYNC.push().then((ok) => ({ ok, dirty: SYNC._dirty === true, mark: localStorage.getItem('care_schedule_dirty_v1') === '1', base: SYNC._baseRev }));
      }, ev('e_first', '13'));
      t('(13' + tag + ') 1つ目の送信が届き、答えを止めている', !!(await waitFor(() => release, 10000)));
      /* 答えを待つ間に、2つ目の直し（fl02）を保存する（2秒後の自動送信が予約される） */
      await page.evaluate((e) => {
        DB.residents.find((x) => x.id === 'fl02').events.push(e);
        recalcAllEventUnits(); saveDB();
      }, ev('e_second', '14'));
      if (other === 'sim') await page.evaluate(() => SIM.enter());
      await page.waitForTimeout(holdMs);
      release();
      const r1 = await page.evaluate(() => window.__p13);
      t('(13' + tag + ') 1つ目の送信は成功し、サーバーに1つ目の直しが入る', r1.ok === true && has(env.st.sbKv.data, 'fl01', 'e_first'), r1);
      t('(13' + tag + ') 成功の後も、2つ目の直しは未送信のまま（印が残る・版は1つ目の答えの版に固定）', r1.dirty && r1.mark && r1.base === firstRev, Object.assign({ firstRev }, r1));
      if (other === 'server') {
        /* 定期の取得（ほかの端末が進めた版がサーバーにある） */
        await page.evaluate(() => SYNC.pollIfNeeded());
        t('(13' + tag + ') 取得の後も、画面に2つ目の直しが残る', await page.evaluate(() => DB.residents.find((x) => x.id === 'fl02').events.some((e) => e.id === 'e_second')));
      }
      if (other === 'sim') {
        await page.waitForTimeout(2500);
        t('(13' + tag + ') 試算の間は送らない（続けて送る送信は0本）', (env.st.sbKv.log || []).length === env.st.logAt, (env.st.sbKv.log || []).slice(env.st.logAt));
        await page.evaluate(() => SIM.exit(true));
      }
      if (other === 'tab') {
        /* 別のタブがサーバーへ送り、共有の版数（ws_sync_revs.care）をその版へ進めた */
        await page.evaluate((rev) => { const o = JSON.parse(localStorage.getItem('ws_sync_revs') || '{}'); o.care = rev; localStorage.setItem('ws_sync_revs', JSON.stringify(o)); }, env.st.sbKv.rev);
      }
      const done = await waitFor(() => has(env.st.sbKv.data, 'fl02', 'e_second') && page.evaluate(() => !SYNC._busy && !SYNC._dirty), 12000);
      const srvD = env.st.sbKv.data;
      const want = [['fl01', 'e_first'], ['fl02', 'e_second']].concat(other === 'server' || other === 'tab' ? [['fl03', 'e_other']] : []);
      t('(13' + tag + ') 2つ目の直しも続けて送られ、サーバーに' + want.length + 'つとも残る', !!done && want.every(([r, id]) => has(srvD, r, id)), want.map(([r, id]) => id + ':' + has(srvD, r, id)));
      const after = (env.st.sbKv.log || []).slice(env.st.logAt || 0);
      if (other === 'none' || other === 'sim') t('(13' + tag + ') 続けて送る送信は競合にならず1本で通る', after.length === 1 && after[0].result === 'ok', after);
      else t('(13' + tag + ') 続けて送る送信は1つ目の答えの版を名乗って競合に倒れ、取り込んで送り直す', after.length === 2 && after[0].result === 'conflict' && after[1].result === 'ok', after);
      const n0 = env.st.rpc.filter((r) => r.fn === 'kv_put').length;
      await page.waitForTimeout(3000);
      t('(13' + tag + ') 送り終えた後は送り続けない（3秒で保存0本・未送信なし）', env.st.rpc.filter((r) => r.fn === 'kv_put').length === n0 && await page.evaluate(() => !SYNC._dirty), env.st.rpc.filter((r) => r.fn === 'kv_put').length - n0);
      t('(13' + tag + ') 送り終えた後の画面にも残る', await page.evaluate((w) => w.every(([r, id]) => DB.residents.find((x) => x.id === r).events.some((e) => e.id === id)), want));
      await page.close();
    } finally { endChecks(env, '(13' + tag + ')'); await env.context.close(); }
  }
}

await browser.close();
await srv.close();
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
