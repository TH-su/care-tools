/* check/flow_e2e.mjs — 業務の流れを通す試験（2026-11-02 新設）
 *
 *   node check/flow_e2e.mjs [--shots <保存先>] [--only 5,6,7]
 *
 * 本物の Chromium で画面を順に開き、職員と同じボタン操作で業務の流れを通す。通信は全部横取りして偽物が答える
 * （入居者マスタ GAS・統合同期 GAS・計画書の GAS・申送の GAS・Supabase・su-backend.json）。横取りしていない
 * 外への要求が出たら失敗にする。データはすべて架空（check/fixtures/flow.mjs）。画面のコードは1文字も変えない。
 *
 *   (1) 入居者マスタ→各画面: 入居者マスタで架空の1名を編集して保存し、フェイスシート・週間計画・デイ利用表に載ることを確かめる
 *   (2) 行き来の帯で巡る: フェイスシート→体重管理→家族構成図→週間計画→申送ビューア→計画書→担当者会議→入居者マスタ→フェイスシートと
 *       帯のリンクを押して移り、毎回「同じ方（同じ番号・同じ氏名）」が出ていること・帯に今の画面が無いことを確かめる（取り違えの検出）
 *   (3) 週間計画→ワークスケジュール・俯瞰: 週間計画で予定を1コマ足して保存し、ワークスケジュール・訪問俯瞰・全支援俯瞰に載ることを確かめる
 *   (4) 現場の端末の守り: 事務所向けの画面が中身を出さずに止まり、全件の読み取り・同期の読み取りを送らないこと。
 *       現場でも使える画面（フェイスシート・体重管理・家族構成図）は開け、事務所向けの行き先を帯に出さないこと
 *   (5) 体重管理: 事務所PCと現場の端末で、入居者マスタから開いた方に体重を入れて「記録を保存」し、体重の GAS にその方の記録だけが届き、
 *       開き直すと出ること（現場の端末は入居者マスタの全件・同期の読み取りを送らない）（代表者「推奨どおり」案2 2026-11-03）
 *   (6) 貼り薬カレンダー: 名簿から方を選んで開始日・場所を入れ、共通のデータベース（patch_put）にその方の設定だけが届き、開き直すと出ること。
 *       現場の端末は開いた時に送信待ちの方だけを送り、全員分を送らず、サーバーから読まない（patch_get を呼ばない）こと
 *   (7) 計画書: 入居者マスタから開いた方に「この日付で計画を追加」で期を作り、欄に書いて「保存」し、計画書の受け口にその方の計画だけが届き、
 *       開き直すと書いた内容が出て、一覧にその方の計画が載ること
 *   (8) 画面の中の窓（su-dialog.js）: 入居者マスタの一括編集の保存・食形態一覧の保存・薬情の取り込みを閉じる、体重管理の記録の削除と保存、
 *       職員マスタの一括保存、家族構成図の読込と削除、写しの見比べの「勤務表を写しの期間に戻す」で、OK で先へ進み・キャンセルで何も変わらず・
 *       素早い二度押し（守りの時間の後の2回押し・窓の外の2回押し）で二重にならないこと。落ちた時は画面の名前と操作の名前だけを出す（代表者の指示 2026-11-13）
 * どの流れも、画面のエラー（pageerror）が出たら失敗にする。成功で exit 0、1つでも落ちたら exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';
import * as F from './fixtures/flow.mjs';
import { seed as wsSeed } from './fixtures/work-schedule.mjs';
import * as SF from './fixtures/staff-master.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots ? path.resolve(args.shots) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
/* --only 5,7 のように番号を書くと、その流れだけを通す（直している間の確かめ用。毎晩と PR ごとは全部を通す） */
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

/* ── 架空の人と接続先 ── */
const ME = { id: '1001', name: '架空 一郎' };          // 主に使う方
const OTHER = { id: '1002', name: '見本 一郎' };       // 取り違えの相手（端末に「前に開いた方」として残しておく）
const TP_URL = 'https://script.google.com/macros/s/CHECK-FLOW-TP/exec';
const MSK_URL = 'https://script.google.com/macros/s/CHECK-FLOW-MSK/exec';
const WT_URL = 'https://script.google.com/macros/s/CHECK-FLOW-WT/exec';
const NAMES = F.masterRecords().map((r) => r.name);
const OFFICE_HOP = ['resident-master.html', 'care-schedule.html', 'moushiokuri-viewer.html', 'training-plan.html', 'care-meeting.html'];
/* 現場の端末で送ってはいけない入居者マスタ GAS の読み取り（getSection は facesheet_safe 以外を全部ここに数える） */
const MASTER_FULL = ['getRoster', 'getBulk', 'getListFull', 'getResident', 'getMedsBulk', 'getMealList', 'getMedDict'];

const srv = await startServer(repoDir);
const browser = await chromium.launch();

/* 日本時間の「昨日」（申送の偽物の記録の日付） */
function ymdJst(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}
/* 申送の GAS の偽物（events は架空の2名の申し送りを1件ずつ。ほかは中身なし） */
function mskRespond(b) {
  if (b.action === 'events') {
    const y = ymdJst(-1);
    return { ok: true, from: b.from, to: b.to, ingestedDates: [y], events: [
      { kind: 'resident', name: ME.name, date: y, time: '10:00', shift: 'day', text: '架空の申し送り（試験）' },
      { kind: 'resident', name: OTHER.name, date: y, time: '11:00', shift: 'day', text: '別の方の架空の申し送り' },
    ] };
  }
  if (b.action === 'measures') return { ok: true, rows: [] };
  return { ok: true };
}

/* 体重管理の GAS の偽物。疎通の確かめ（action なし）には今の GAS と同じ能力（POST の読み込み・項目だけの送信）を答え、
   getAll で入居者と記録を返し、saveRecord・saveResident・delRecord を覚える。受けた記録は saved に残す（試験が中身を見る） */
function createWeightGas(seed) {
  const s = { residents: JSON.parse(JSON.stringify((seed && seed.residents) || [])), records: JSON.parse(JSON.stringify((seed && seed.records) || [])), saved: [] };
  const VER = { ok: true, ver: 5, caps: ['postGetAll', 'fieldMerge'], authRequired: true };
  s.respond = (b) => {
    if (!b.action) return VER;
    if (b.action === 'getAll') return { ok: true, ver: 5, residents: s.residents, records: s.records, thresholds: null };
    if (b.action === 'saveRecord' && b.record && b.record.id != null) {
      const i = s.records.findIndex((r) => r.id === b.record.id);
      if (i >= 0) s.records[i] = b.record; else s.records.push(b.record);
      s.saved.push(JSON.parse(JSON.stringify(b.record)));
      return { ok: true, ver: 5 };
    }
    if (b.action === 'saveResident' && b.resident && b.resident.id != null) {
      const i = s.residents.findIndex((r) => r.id === b.resident.id);
      if (i >= 0) s.residents[i] = { ...s.residents[i], ...b.resident }; else s.residents.push(b.resident);
      return { ok: true, ver: 5 };
    }
    if (b.action === 'delRecord') { s.records = s.records.filter((r) => r.id !== b.id); return { ok: true, ver: 5 }; }
    return { ok: true, ver: 5 };
  };
  return s;
}

/* 1つの流れ＝1つのブラウザの文脈（端末1台）。偽物の通信の状態と、受けた要求の記録を持つ */
/* role・rpc・gas・sudCount は (8) 画面の中の窓 のために足した（既定は今までと同じ＝ほかの流れは変わらない）。
   role … ログインの役割（既定 office）／rpc … 共通のデータベースの関数の偽物 {名前: (本文)=>応答}（呼ばれた本文は st.rpc に残す）／
   tables … 共通のデータベースの表の読み取りの偽物 {表の名前: 行の配列}／
   gas … ほかの GAS の偽物 [[住所の頭, (本文)=>応答, 名前]]／sudCount … 画面の中の窓（dialog.sud-dlg）が出た回数を window.__sudShown に数える */
async function makeEnv({ device = 'office', kvSeed, extraStorage = {}, seedOnce = true, flags = F.FLAGS_OFF, wtSeed, patchSeed, role = 'office', rpc = null, tables = null, gas: gasExtra = [], sudCount = false } = {}) {
  const st = {
    master: F.createMaster(),
    kv: F.createKv(kvSeed || { care_schedule_v2: F.careDb() }),
    tp: F.createKv({}),
    wt: createWeightGas(wtSeed),
    patch: JSON.parse(JSON.stringify(patchSeed || {})), patchCalls: [],
    req: [], sb: [], ext: [], errors: [], dialogs: [], ct: [], tag: '', rpc: [],
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  /* 端末の設定は最初の1回だけ入れる（その後に画面が書いた値を上書きしない） */
  await context.addInitScript(({ s, once }) => {
    try {
      if (once && localStorage.getItem('__flow_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__flow_seeded', '1');
    } catch (e) { /* 端末の控えが使えない時は何もしない */ }
  }, { s: { ...F.storage(device), su_backend_flags: JSON.stringify(flags), tp_cfg: JSON.stringify({ url: TP_URL, token: 'check-flow' }), msk_cfg: JSON.stringify({ url: MSK_URL, token: 'check-flow' }), ...extraStorage }, once: seedOnce });
  const gasBody = (req) => {
    if (req.method() === 'GET') return Object.fromEntries(new URL(req.url()).searchParams);
    try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; }
  };
  const gas = (to, respond) => (route) => {
    const req = route.request();
    const b = gasBody(req);
    st.req.push({ tag: st.tag, to, method: req.method(), action: b.action, id: b.id, section: b.section, key: b.key, keys: b.keys });
    if (req.method() === 'POST') st.ct.push({ tag: st.tag, to, ct: (req.headers()['content-type'] || '') + '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(b)) });
  };
  const sbBase0 = F.supabase(st, role);
  const sbBase = !rpc && !tables ? sbBase0 : (route) => {
    const req = route.request();
    const pth = new URL(req.url()).pathname;
    const tb = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(pth);
    if (tb && tables && tables[tb[1]] && req.method() === 'GET') {
      st.sb.push('GET ' + pth);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(tables[tb[1]]) });
    }
    const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(pth);
    if (!m || req.method() === 'OPTIONS' || !rpc || !rpc[m[1]]) return sbBase0(route);
    let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
    st.sb.push(req.method() + ' /rest/v1/rpc/' + m[1]);
    st.rpc.push({ tag: st.tag, fn: m[1], body: b });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(rpc[m[1]](b)) });
  };
  if (sudCount) await context.addInitScript(() => {
    window.__sudShown = 0;
    /* __sudPoke を立てておくと、次に開いた窓の OK に、開いた直後（守りの時間の中）の押下（押下の回数 1）を1回当てる＝素早い2回押しの2回目が中央に出た OK に重なった時と同じ */
    window.__sudPoke = false; window.__sudPoked = false;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (!(n && n.nodeType === 1 && n.matches && n.matches('dialog.sud-dlg'))) continue;
        window.__sudShown++;
        if (window.__sudPoke && n.open) {
          window.__sudPoke = false;
          const ok = n.querySelector('.sud-btn.pri');
          if (ok) { ok.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, view: window })); window.__sudPoked = true; }
        }
      }
    }).observe(document, { subtree: true, childList: true });
  });
  /* 貼り薬カレンダーの共通のデータベースの偽物（patch_put・patch_put_many・patch_get）。ほかは F.supabase に任せる */
  const sbHandle = (route) => {
    const req = route.request();
    const m = /\/rest\/v1\/rpc\/(patch_put_many|patch_put|patch_get)$/.exec(new URL(req.url()).pathname);
    if (!m || req.method() === 'OPTIONS') return sbBase(route);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (e) { b = {}; }
    st.sb.push(req.method() + ' /rest/v1/rpc/' + m[1]);
    const put = (x) => { st.patch[String(x.p_resident_id)] = { start: x.p_start, no: x.p_no, prev: x.p_prev, by: x.p_by, at: x.p_at }; return { ok: true }; };
    let out;
    if (m[1] === 'patch_put') { st.patchCalls.push({ tag: st.tag, fn: m[1], rids: [String(b.p_resident_id)] }); out = put(b); }
    else if (m[1] === 'patch_put_many') { const items = Array.isArray(b.items) ? b.items : []; st.patchCalls.push({ tag: st.tag, fn: m[1], rids: items.map((x) => String(x.p_resident_id)) }); out = items.map(put); }
    else { st.patchCalls.push({ tag: st.tag, fn: m[1], rids: [] }); out = { ok: true, rows: JSON.parse(JSON.stringify(st.patch)) }; }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
  };
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) });
      return route.continue();
    }
    if (u.startsWith(F.MASTER_URL)) return gas('master', st.master.respond)(route);
    if (u.startsWith(F.SYNC_URL)) return gas('sync', st.kv.respond)(route);
    if (u.startsWith(TP_URL)) return gas('tp', st.tp.respond)(route);
    if (u.startsWith(MSK_URL)) return gas('msk', mskRespond)(route);
    if (u.startsWith(WT_URL)) return gas('wt', st.wt.respond)(route);
    if (u.startsWith(F.SB + '/')) return sbHandle(route);
    for (const [head, fn, name] of gasExtra) if (u.startsWith(head)) return gas(name, fn)(route);
    st.ext.push(route.request().method() + ' ' + u.slice(0, 160));
    return route.abort();
  });
  context.on('page', (page) => {
    page.on('pageerror', (e) => st.errors.push((st.tag ? st.tag + ': ' : '') + String(e && e.message).slice(0, 200)));
    page.on('dialog', (d) => {
      st.dialogs.push(d.type() + ': ' + d.message().slice(0, 120));
      if (d.type() === 'beforeunload' || d.type() === 'confirm') d.accept().catch(() => {}); else d.dismiss().catch(() => {});
    });
  });
  return { context, st };
}
async function open(env, url, tag) {
  env.st.tag = tag || url.split('?')[0];
  const page = await env.context.newPage();
  await page.goto(srv.url + '/' + url, { waitUntil: 'load' });
  return page;
}
const reqOf = (env, tag) => env.st.req.filter((r) => r.tag === tag);
async function waitFor(fn, timeout = 15000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}
/* 共通の終わりの確かめ（流れごと） */
function endChecks(env, label) {
  t(label + ': 画面のエラー（pageerror）なし', env.st.errors.length === 0, env.st.errors);
  t(label + ': 横取りしていない外への通信なし', env.st.ext.length === 0, env.st.ext);
  /* 送信の形（CLAUDE.md §2-3）: text/plain＝CORS の事前確認を起こさない形。charset の大文字小文字は同じ意味なので区別しない */
  const badCt = env.st.ct.filter((c) => c.ct.toLowerCase().replace(/\s+/g, '') !== 'text/plain;charset=utf-8');
  t(label + ': GAS への送信はすべて text/plain;charset=utf-8（' + env.st.ct.length + '本）', badCt.length === 0, badCt);
  const dflt = [...new Set(env.st.ct.filter((c) => c.ct === 'text/plain;charset=UTF-8').map((c) => c.tag + '→' + c.to))];
  if (dflt.length) console.log('    （参考: 見出しを付けずブラウザの既定 text/plain;charset=UTF-8 で送っている画面: ' + dflt.join('・') + '）');
  if (env.st.dialogs.length) console.log('    （参考: 出た確認の窓 ' + env.st.dialogs.length + '件: ' + env.st.dialogs.join(' ／ ').slice(0, 300) + '）');
}

/* 行き来の帯のリンク（href）から、渡している番号と氏名を取り出す */
function hopParams(hrefs) {
  return hrefs.map((h) => {
    const u = new URL(h, 'http://x/');
    const p = u.searchParams;
    return { page: u.pathname.split('/').pop(), id: p.get('masterId') || p.get('id') || p.get('resident'), name: p.get('name') };
  });
}
function hopOk(label, current, hrefs, { field = false } = {}) {
  const ps = hopParams(hrefs);
  t(label + ': 帯がある（' + ps.length + '件）', ps.length > 0, hrefs);
  t(label + ': 帯に今の画面が無い', !ps.some((p) => p.page === current), ps.map((p) => p.page));
  t(label + ': 帯の行き先は全部同じ方の番号（' + ME.id + '）', ps.length > 0 && ps.every((p) => p.id === ME.id), ps);
  const named = ps.filter((p) => p.name != null);
  t(label + ': 氏名を渡す行き先（家族構成図）は同じ方の氏名', named.every((p) => p.name === ME.name), named);
  if (field) t(label + ': 事務所向けの行き先が無い', !ps.some((p) => OFFICE_HOP.includes(p.page)), ps.map((p) => p.page));
  return ps;
}
/* 画面の文字の中に、ほかの架空の方の氏名が出ていないか（ある範囲の中だけを見る） */
const othersIn = (text) => NAMES.filter((n) => n !== ME.name && String(text || '').includes(n));

/* ═════════ (1) 入居者マスタ → フェイスシート・週間計画・デイ利用表 ═════════ */
async function flow1() {
  console.log('\n— (1) 入居者マスタで直した値が、フェイスシート・週間計画・デイ利用表に載る —');
  const db = F.careDb();
  /* 週間計画の側には、この方の古い介護度（マスタで直す前の値）が入ったままにしておく。
     週間計画は介護度を入居者マスタに合わせる（マスタを正にする・代表者の決定 2026-11-02）ので、直した値に変わるはず */
  const csMe = db.residents.find((r) => String(r.masterId) === ME.id);
  if (!csMe.careLevel || csMe.careLevel === '要介護3') csMe.careLevel = '要介護1';
  const env = await makeEnv({ kvSeed: { care_schedule_v2: db } });
  try {
    /* 直す前のデイ利用表: この方は1階（居室 101） */
    let page = await open(env, 'daycare-roster.html');
    const floorOf = () => page.evaluate((nm) => {
      const rows = Array.from(document.querySelectorAll('#roster tbody tr'));
      let floor = '', left = 0; const out = [];
      for (const tr of rows) {
        const f = tr.querySelector('th.col-flr');
        if (f) { floor = f.textContent.trim(); left = Number(f.getAttribute('rowspan') || 1); }
        if (Array.from(tr.querySelectorAll('td.user')).some((td) => td.textContent.trim() === nm)) out.push(floor);
        left--;
      }
      return out;
    }, ME.name);
    const before = await waitFor(async () => { const f = await floorOf(); return f.length && reqOf(env, 'daycare-roster.html').some((r) => r.action === 'getRoster') ? f : null; });
    t('デイ利用表（直す前）: ' + ME.name + ' は１階に出ている', Array.isArray(before) && before.length > 0 && before.every((f) => f === '１階'), before);
    await page.close();

    /* 入居者マスタで開いて、編集画面で介護度・居室・身長を直して保存（本物のボタン操作） */
    page = await open(env, 'resident-master.html');
    await page.waitForSelector(`.rcard[data-id="${ME.id}"]`, { timeout: 15000 });
    await page.click(`.rcard[data-id="${ME.id}"]`);
    await page.waitForFunction(() => { const b = document.getElementById('editBtn'); return b && !b.disabled && b.offsetParent; }, null, { timeout: 15000 });
    const viewName = await page.evaluate(() => (document.getElementById('viewBox').innerText || '').split('\n')[0]);
    t('入居者マスタ: 押した方（' + ME.name + '）の詳細が開く', viewName.trim() === ME.name, viewName);
    await page.click('#editBtn');
    await page.waitForSelector('#editBox select[data-k="careLevel"]', { timeout: 10000 });
    await page.selectOption('#editBox select[data-k="careLevel"]', '要介護3');
    await page.fill('#editBox input[data-k="room"]', '209');
    await page.fill('#editBox input[data-k="height"]', '172');
    const nSave = env.st.master.log.filter((l) => l.action === 'saveResident').length;
    await page.click('#saveBtn');
    const saved = await waitFor(async () => env.st.master.log.filter((l) => l.action === 'saveResident').length > nSave &&
      await page.evaluate(() => /保存OK/.test(document.body.innerText) && document.getElementById('saveBtn').disabled === false));
    const rec = env.st.master.get(ME.id);
    t('入居者マスタ: 保存（saveResident）が1本届き、画面が「保存OK」になる', saved && env.st.master.log.filter((l) => l.action === 'saveResident').length === nSave + 1, env.st.master.log.slice(-3));
    t('入居者マスタ: GAS に残った記録は 介護度=要介護3・居室=209・身長=172（ほかの方は変わらない）',
      rec && rec.careLevel === '要介護3' && rec.room === '209' && String(rec.height) === '172' && env.st.master.get(OTHER.id).room === '102', rec && { careLevel: rec.careLevel, room: rec.room, height: rec.height });
    const common = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('su_residents_common') || 'null'); } catch (e) { return null; } });
    const cMe = common && Array.isArray(common.residents) ? common.residents.find((r) => String(r.masterId) === ME.id) : null;
    t('入居者マスタ: 端末の共有名簿（su_residents_common）も新しい介護度・居室になる', cMe && cMe.careLevel === '要介護3' && cMe.room === '209', cMe);
    await shot(page, 'flow1-master-saved');
    await page.close();

    /* フェイスシート（?masterId=）: 保存した値が出る */
    page = await open(env, 'facesheet.html?masterId=' + ME.id);
    const cells = await waitFor(() => page.evaluate(() => {
      const out = {};
      for (const c of document.querySelectorAll('.cell')) {
        const l = c.querySelector('.lab'), v = c.querySelector('.val');
        if (l && v) (out[l.textContent.trim()] = out[l.textContent.trim()] || []).push(v.textContent.trim());
      }
      return out['介護度'] ? out : null;
    }));
    t('フェイスシート: 開いている方は ' + ME.name, await page.evaluate(() => (document.getElementById('fromMaster') || {}).innerText || '').then((s) => s.includes(ME.name + 'さんを開いています')));
    t('フェイスシート: 介護度が 要介護3', cells && cells['介護度'] && cells['介護度'].includes('要介護3') && !cells['介護度'].includes('要介護1'), cells && cells['介護度']);
    t('フェイスシート: 居室が 209', cells && cells['居室'] && cells['居室'].includes('209'), cells && cells['居室']);
    t('フェイスシート: 身長が 172 cm', cells && cells['身長'] && cells['身長'].includes('172 cm'), cells && cells['身長']);
    await shot(page, 'flow1-facesheet');
    await page.close();

    /* 週間計画: マスタの名簿から介護度を取り込む（入っている介護度もマスタの値にそろえる）。
       ?masterId= で開くと「初めての端末」の不具合（(2b) を参照）に当たるので、ここでは一覧から選ぶ */
    page = await open(env, 'care-schedule.html');
    await page.waitForFunction(() => document.querySelectorAll('#resident-select option').length > 3, null, { timeout: 15000 });
    await page.selectOption('#resident-select', { label: ME.name });
    const sel = await waitFor(() => page.evaluate(() => {
      const s = document.getElementById('resident-select');
      const o = s && s.options[s.selectedIndex];
      const lv = document.getElementById('sum-level');
      return o && o.value ? { name: o.textContent.trim(), level: lv ? lv.textContent.trim() : '' } : null;
    }));
    t('週間計画: 一覧から ' + ME.name + ' を選べる（入居者マスタの番号でつながっている）', sel && sel.name === ME.name, sel);
    t('週間計画: 入っていた介護度（要介護1）が入居者マスタの 要介護3 にそろう', sel && sel.level === '要介護3', sel);
    /* 介護情報の窓: マスタとつながっている方は介護度を直せず、「入居者マスタで直してください」と出る */
    const ci = await page.evaluate(() => { openCareInfoModal(); const s = document.getElementById('ci-level'); const n = document.getElementById('ci-level-note');
      const r = { disabled: !!(s && s.disabled), value: s ? s.value : '', note: !!(n && !n.hidden && n.offsetParent) }; closeCareInfoModal(); return r; });
    t('週間計画: 介護情報の窓では介護度を直せず、入居者マスタで直すよう案内が出る', ci.disabled && ci.value === '要介護3' && ci.note, ci);
    await shot(page, 'flow1-care-schedule');
    await page.close();

    /* デイ利用表: 居室はマスタ常勝で重ねる＝209 号室なので２階へ移る */
    page = await open(env, 'daycare-roster.html');
    env.st.tag = 'daycare-roster.html#2';
    const after = await waitFor(async () => { const f = await floorOf(); return f.length && f.every((x) => x === '２階') ? f : null; });
    t('デイ利用表（直した後）: ' + ME.name + ' は２階に出る（居室 209 を反映）', Array.isArray(after) && after.length > 0 && after.every((f) => f === '２階'), after || (await floorOf()));
    await shot(page, 'flow1-daycare');
    await page.close();
  } finally {
    endChecks(env, '(1)');
    await env.context.close();
  }
}

/* ═════════ (2) 行き来の帯で巡る ═════════ */
async function flow2() {
  console.log('\n— (2) 行き来の帯で同じ方の画面を巡る（取り違えの検出）—');
  const wt = { residents: [
    { id: 'w1', name: ME.name, masterId: ME.id, room: '101', active: true, height: 160 },
    { id: 'w2', name: OTHER.name, masterId: OTHER.id, room: '102', active: true, height: 158 },
  ], records: [] };
  const env = await makeEnv({ extraStorage: { wtmgr_v1: JSON.stringify(wt) } });
  try {
    /* 下ごしらえ: この端末で前に「別の方」を開いていたことにする（入居者マスタ・週間計画は開いた方を端末に覚える） */
    let page = await open(env, 'resident-master.html?id=' + OTHER.id, 'prep:resident-master');
    await waitFor(() => page.evaluate((n) => (document.getElementById('viewBox').innerText || '').startsWith(n), OTHER.name));
    await page.close();
    page = await open(env, 'care-schedule.html', 'prep:care-schedule');
    await page.waitForFunction(() => document.querySelectorAll('#resident-select option').length > 3, null, { timeout: 15000 });
    await page.selectOption('#resident-select', { label: OTHER.name });
    await page.waitForTimeout(300);
    await page.close();

    /* 帯のリンクを押して次の画面へ（同じタブで移る） */
    const hopClick = async (pg, selector, nextTag) => {
      env.st.tag = nextTag;
      await Promise.all([pg.waitForURL((u) => u.pathname.endsWith('/' + nextTag), { timeout: 15000 }), pg.click(selector)]);
      await pg.waitForLoadState('load');
    };
    const hrefsIn = (pg, sel) => pg.evaluate((s) => Array.from(document.querySelectorAll(s + ' .srh a')).map((a) => a.getAttribute('href')), sel);

    /* フェイスシート */
    page = await open(env, 'facesheet.html?masterId=' + ME.id);
    const fsWho = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent && e.querySelector('.srh') ? e.innerText : null; }));
    t('フェイスシート: 「' + ME.name + 'さんを開いています」', !!fsWho && fsWho.includes(ME.name + 'さんを開いています') && othersIn(fsWho).length === 0, fsWho);
    const fsBody = await page.evaluate(() => document.body.innerText);
    t('フェイスシート: 中身の見出しも同じ方（' + ME.name + '（101））で、別の方の見出しは無い', fsBody.includes(ME.name + '（101）') && !/（10[2-9]|11\d|20\d）/.test(fsBody.replace(ME.name + '（101）', '')), fsBody.slice(0, 200));
    hopOk('フェイスシート', 'facesheet.html', await hrefsIn(page, '#fromMaster'));
    await shot(page, 'flow2-1-facesheet');

    /* → 体重管理 */
    await hopClick(page, '#fromMaster .srh a[href^="weight-record.html"]', 'weight-record.html');
    const wtWho = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent && e.querySelector('.srh') ? e.innerText : null; }));
    t('体重管理: 「' + ME.name + 'さんを開いています」', !!wtWho && wtWho.includes(ME.name + 'さんを開いています') && othersIn(wtWho).length === 0, wtWho);
    const wtSel = await page.evaluate(() => Array.from(document.querySelectorAll('select')).map((s) => s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : '').filter((x) => /\[\d+\]/.test(x)));
    t('体重管理: 選ばれている方も ' + ME.name, wtSel.length > 0 && wtSel.every((x) => x.includes(ME.name)), wtSel);
    hopOk('体重管理', 'weight-record.html', await hrefsIn(page, '#fromMaster'));
    await shot(page, 'flow2-2-weight');

    /* → 家族構成図 */
    await hopClick(page, '#fromMaster .srh a[href^="genogram.html"]', 'genogram.html');
    const gnWho = await waitFor(() => page.evaluate(() => { const e = document.getElementById('suHopBar'); return e && !e.hidden && e.querySelector('.srh') ? e.innerText : null; }));
    t('家族構成図: 「' + ME.name + 'さんを開いています」', !!gnWho && gnWho.includes(ME.name + 'さんを開いています') && othersIn(gnWho).length === 0, gnWho);
    hopOk('家族構成図', 'genogram.html', await hrefsIn(page, '#suHopBar'));
    await shot(page, 'flow2-3-genogram');

    /* → 週間計画（端末には別の方の選択が残っている） */
    await hopClick(page, '#suHopBar .srh a[href^="care-schedule.html"]', 'care-schedule.html');
    const csSel = await waitFor(() => page.evaluate(() => {
      const s = document.getElementById('resident-select'); const o = s && s.options[s.selectedIndex];
      const b = document.getElementById('cs-hop-btn');
      return o && o.value && b && !b.hidden ? o.textContent.trim() : null;
    }));
    t('週間計画: 端末に残っていた別の方ではなく ' + ME.name + ' が選ばれる', csSel === ME.name, csSel);
    await page.click('#cs-hop-btn');
    await page.waitForSelector('#cs-hop-pop .srh a', { timeout: 5000 }).catch(() => {});
    const csPop = await page.evaluate(() => { const p = document.getElementById('cs-hop-pop'); return { hidden: p.hidden, hrefs: Array.from(p.querySelectorAll('.srh a')).map((a) => a.getAttribute('href')) }; });
    t('週間計画: 「この方の画面 ▾」を押すと一覧が開く', !csPop.hidden && csPop.hrefs.length > 0, csPop);
    hopOk('週間計画', 'care-schedule.html', csPop.hrefs);
    await shot(page, 'flow2-4-care-schedule');

    /* → 申送ビューア */
    await hopClick(page, '#cs-hop-pop .srh a[href^="moushiokuri-viewer.html"]', 'moushiokuri-viewer.html');
    const mkWho = await waitFor(() => page.evaluate(() => { const w = document.querySelector('#who .who'); return w && w.querySelector('.srh') ? w.innerText : null; }));
    t('申送ビューア: 本人確認バーが「' + ME.name + ' 様」', !!mkWho && mkWho.startsWith(ME.name + ' 様') && othersIn(mkWho).length === 0, mkWho);
    const mkBody = await page.evaluate(() => (document.getElementById('timeline') || document.getElementById('rtl') || document.body).innerText);
    t('申送ビューア: 出ている申し送りはこの方のものだけ', mkBody.includes('10:00') && !mkBody.includes('別の方の架空の申し送り'), mkBody.slice(0, 200));
    hopOk('申送ビューア', 'moushiokuri-viewer.html', await hrefsIn(page, '#who'));
    await shot(page, 'flow2-5-moushiokuri');

    /* → 計画書 */
    await hopClick(page, '#who .srh a[href^="training-plan.html"]', 'training-plan.html');
    const tpWho = await waitFor(() => page.evaluate(() => { const h = document.getElementById('edName'); const b = document.getElementById('tpHop'); return h && b && b.querySelector('.srh') ? h.textContent.trim() : null; }));
    t('計画書: 開いている方は ' + ME.name, tpWho === ME.name, tpWho);
    t('計画書: 計画書の読み出しもこの方の番号（training_plan:' + ME.id + '）', reqOf(env, 'training-plan.html').some((r) => r.to === 'tp' && r.key === 'training_plan:' + ME.id) && !reqOf(env, 'training-plan.html').some((r) => r.to === 'tp' && /^training_plan:\d+$/.test(r.key || '') && r.key !== 'training_plan:' + ME.id), reqOf(env, 'training-plan.html').filter((r) => r.to === 'tp'));
    hopOk('計画書', 'training-plan.html', await hrefsIn(page, '#tpHop'));
    await shot(page, 'flow2-6-training-plan');

    /* → 担当者会議 */
    await hopClick(page, '#tpHop .srh a[href^="care-meeting.html"]', 'care-meeting.html');
    const cmWho = await waitFor(() => page.evaluate(() => { const w = document.getElementById('cm-who'); return w && w.querySelector('.srh') ? w.innerText : null; }));
    t('担当者会議: 開いている方は ' + ME.name + '（101号室）', !!cmWho && cmWho.includes(ME.name) && cmWho.includes('101') && othersIn(cmWho).length === 0, cmWho);
    t('担当者会議: 読みに行ったのもこの方の番号だけ', reqOf(env, 'care-meeting.html').filter((r) => r.id != null).every((r) => String(r.id) === ME.id), reqOf(env, 'care-meeting.html'));
    hopOk('担当者会議', 'care-meeting.html', await hrefsIn(page, '#cm-who'));
    await shot(page, 'flow2-7-care-meeting');

    /* → 入居者マスタ（端末には別の方を開いていた記録が残っている） */
    await hopClick(page, '#cm-who .srh a[href^="resident-master.html"]', 'resident-master.html');
    const rmName = await waitFor(() => page.evaluate(() => {
      const v = document.getElementById('viewBox'); const first = v ? (v.innerText || '').split('\n')[0].trim() : '';
      return v && v.querySelector('a.rlink') && first && first !== '読み込み中…' ? first : null;
    }));
    t('入居者マスタ: 前に開いていた別の方ではなく ' + ME.name + ' の詳細が開く', rmName === ME.name, rmName);
    const rmGets = reqOf(env, 'resident-master.html').filter((r) => r.action === 'getResident').map((r) => String(r.id));
    t('入居者マスタ: 詳細を読みに行ったのはこの方の番号だけ', rmGets.length > 0 && rmGets.every((x) => x === ME.id), rmGets);
    const rmLinks = await page.evaluate(() => Array.from(document.querySelectorAll('#viewBox a.rlink')).map((a) => a.getAttribute('href')));
    const rmPs = hopParams(rmLinks);
    t('入居者マスタ: 「この方を各アプリで開く」の行き先も全部同じ方の番号', rmPs.length > 0 && rmPs.every((p) => p.id === ME.id), rmPs);
    await shot(page, 'flow2-8-resident-master');

    /* → フェイスシート（入居者マスタのリンクは新しいタブで開く）で一周 */
    env.st.tag = 'facesheet.html#2';
    const [p2] = await Promise.all([env.context.waitForEvent('page', { timeout: 15000 }), page.click('#viewBox a.rlink[href^="facesheet.html"]')]);
    await p2.waitForLoadState('load');
    const fsWho2 = await waitFor(() => p2.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent && e.querySelector('.srh') ? e.innerText : null; }));
    t('一周してフェイスシート: また ' + ME.name, !!fsWho2 && fsWho2.includes(ME.name + 'さんを開いています') && othersIn(fsWho2).length === 0, fsWho2);
    await p2.close();
    await page.close();
  } finally {
    endChecks(env, '(2)');
    await env.context.close();
  }

  /* 週間計画を一度も開いたことの無い事務所PC（端末に週間計画の控えが無い）で、帯から週間計画へ移った時 */
  console.log('\n— (2b) 週間計画を初めて開く端末で、帯から週間計画へ —');
  const env2 = await makeEnv({});
  try {
    const page = await open(env2, 'facesheet.html?masterId=' + ME.id);
    await page.waitForSelector('#fromMaster .srh a[href^="care-schedule.html"]', { timeout: 15000 });
    env2.st.tag = 'care-schedule.html';
    await Promise.all([page.waitForURL((u) => u.pathname.endsWith('/care-schedule.html'), { timeout: 15000 }), page.click('#fromMaster .srh a[href^="care-schedule.html"]')]);
    const got = await waitFor(() => page.evaluate(() => {
      const s = document.getElementById('resident-select'); const o = s && s.options[s.selectedIndex];
      return o && o.value ? o.textContent.trim() : null;
    }), 10000);
    const toast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
    t('週間計画（初めての端末）: 帯から来た方（' + ME.name + '）が選ばれる', got === ME.name, { selected: got, toast });
    await shot(page, 'flow2b-care-schedule-first');
    await page.close();
  } finally {
    endChecks(env2, '(2b)');
    await env2.context.close();
  }
}

/* ═════════ (3) 週間計画 → ワークスケジュール・訪問俯瞰・全支援俯瞰 ═════════ */
async function flow3() {
  console.log('\n— (3) 週間計画で足した予定が、ワークスケジュール・訪問俯瞰・全支援俯瞰に載る —');
  const care = F.careDb();
  const sd = wsSeed();   // 勤務表（職員・月ごとの予定）は check/fixtures/work-schedule.mjs の架空の職員を使う
  const kvSeed = { care_schedule_v2: care, ws_weekly_master_v1: F.wsMaster(care) };
  for (const k of Object.keys(sd)) if (k === 'staff' || k.startsWith('sched:')) kvSeed[k] = sd[k];
  const env = await makeEnv({ kvSeed });
  const WHO = '見本 花子';   // この方は週間計画に予定が無い（重なりの確認の窓が出ない）
  try {
    let page = await open(env, 'care-schedule.html');
    await page.waitForFunction(() => document.querySelectorAll('#resident-select option').length > 3, null, { timeout: 15000 });
    await page.selectOption('#resident-select', { label: WHO });
    const today = await page.evaluate(() => { const d = new Date(); return { dow: (d.getDay() + 6) % 7, ymd: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }; });
    const DOWS = ['月', '火', '水', '木', '金', '土', '日'];
    await page.click('#fab');
    await page.waitForSelector('#mk-event.open', { timeout: 5000 });
    await page.selectOption('#f-dow', String(today.dow));
    await page.check('input[name="serviceType"][value="visit"]');
    await page.selectOption('#f-category', '身体１');
    await page.fill('#f-start', '14:15');
    await page.dispatchEvent('#f-start', 'change');
    await page.fill('#f-detail', '流れの試験の予定');
    const endTime = await page.inputValue('#f-end');
    t('週間計画: 開始 14:15・身体１で終了が自動で入る（' + endTime + '）', endTime === '14:44', endTime);
    await page.click('#mk-event [data-on-click="saveEvent"]');
    const onSrv = await waitFor(() => {
      const r = (env.st.kv.kv.get('care_schedule_v2') || {}).data;
      const res = r && r.residents.find((x) => x.name === WHO);
      return res && res.events.find((e) => e.detail === '流れの試験の予定');
    });
    t('週間計画: 保存（put）でサーバーに届く（' + DOWS[today.dow] + '曜 14:15〜14:44・訪問・身体１）', onSrv && onSrv.dayOfWeek === today.dow && onSrv.startTime === '14:15' && onSrv.endTime === '14:44' && onSrv.serviceType === 'visit' && onSrv.category === '身体１', onSrv);
    await shot(page, 'flow3-care-schedule');
    await page.close();

    /* ワークスケジュール: 今日の盤面に載り、訪問の列に入る（週の型から作った列型の盤面） */
    page = await open(env, 'work-schedule.html');
    const wsKey = 'wsday_' + today.ymd;
    const placed = await waitFor(() => {
      const d = (env.st.kv.kv.get(wsKey) || {}).data;
      return d && Array.isArray(d.tasks) && d.tasks.find((x) => x.kind === 'care' && x.residentName === WHO && x.start === 14 * 60 + 15);
    }, 25000);
    t('ワークスケジュール: 今日の盤面（' + wsKey + '）に ' + WHO + ' 14:15〜14:44 が入って保存される', placed && placed.end === 14 * 60 + 44, placed && { start: placed.start, end: placed.end, staffId: placed.staffId });
    t('ワークスケジュール: その支援は列（職員）に配置されている', placed && placed.staffId != null && /^slot_visit_/.test(placed.staffId), placed && placed.staffId);
    const board = await waitFor(() => page.evaluate((w) => Array.from(document.querySelectorAll('#board .b-task')).map((x) => x.innerText.replace(/\s+/g, ' ')).find((s) => s.includes(w)) || null, WHO));
    t('ワークスケジュール: 盤面に「14:15-44 … ' + WHO + '」が出ている', !!board && board.includes('14:15-44') && board.includes('流れの試験の予定'), board);
    await shot(page, 'flow3-work-schedule');
    await page.close();

    const lanes = async (pg) => pg.evaluate(() => Array.from(document.querySelectorAll('#board .b-lane, .b-lane')).map((l) => Array.from(l.querySelectorAll('.b-task')).map((c) => c.title)));
    /* 訪問俯瞰: 週間計画の訪問を曜日の列に並べる */
    page = await open(env, 'visit-overview.html');
    const vo = await waitFor(async () => { const L = await lanes(page); return L.length === 7 && L.flat().some((x) => x.includes(WHO)) ? L : null; });
    const want = WHO + '　身体１　14:15〜14:44';
    t('訪問俯瞰: ' + DOWS[today.dow] + '曜の列に「' + want + '」', vo && vo[today.dow].includes(want), vo && vo[today.dow]);
    t('訪問俯瞰: ほかの曜日には出ない', vo && vo.every((l, i) => i === today.dow || !l.some((x) => x.includes(WHO))), vo);
    await shot(page, 'flow3-visit-overview');
    await page.close();

    /* 全支援俯瞰: ワークスケジュールの盤面（wsday_）で列に入った支援を重ねる */
    page = await open(env, 'support-overview.html');
    const so = await waitFor(async () => { const L = await lanes(page); return L.length === 7 && L.flat().some((x) => x.includes(WHO)) ? L : null; }, 20000);
    const want2 = WHO + '　身体１　' + DOWS[today.dow] + ' 14:15〜14:44';
    t('全支援俯瞰: ' + DOWS[today.dow] + '曜の列に「' + want2 + '…」', so && so[today.dow].some((x) => x.startsWith(want2)), so && so[today.dow]);
    await shot(page, 'flow3-support-overview');
    await page.close();
  } finally {
    endChecks(env, '(3)');
    await env.context.close();
  }
}

/* ═════════ (4) 現場の端末の守り ═════════ */
async function flow4() {
  console.log('\n— (4) 現場の端末: 事務所向けの画面は止まり、全件を読まない —');
  const wt = { residents: [{ id: 'w1', name: ME.name, masterId: ME.id, room: '101', active: true, height: 160 }], records: [] };
  const env = await makeEnv({ device: 'field', extraStorage: { wtmgr_v1: JSON.stringify(wt) } });
  const visible = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return false;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }, sel);
  const OFFICE = [
    ['resident-master.html', '#deviceBlock', '入居者マスタ'],
    ['care-schedule.html', '#suDeviceBlock', '週間計画'],
    ['moushiokuri-viewer.html', '#block', '申送ビューア'],
    ['training-plan.html', '#deviceBlock', '計画書'],
    ['care-meeting.html', '#cm-gate', '担当者会議'],
    ['staff-master.html', '#deviceBlock', '職員マスタ'],
    ['admission-flow.html', '#deviceBlock', '入居調整'],
    ['connection-settings.html', '#deviceBlock', '接続設定'],
  ];
  try {
    for (const [file, blockSel, label] of OFFICE) {
      const q = file === 'care-meeting.html' ? '?resident=' + ME.id : (file === 'resident-master.html' ? '?id=' + ME.id : (file === 'connection-settings.html' ? '' : '?masterId=' + ME.id));
      const page = await open(env, file + q);
      const shown = await waitFor(() => visible(page, blockSel), 10000);
      await page.waitForTimeout(2500);   // 起動の後の読み込み（あれば）を待ってから数える
      t(label + ': 止めの表示（' + blockSel + '）が出る', !!shown);
      const text = await page.evaluate(() => document.body.innerText);
      t(label + ': 入居者の氏名が画面に出ない', NAMES.every((n) => !text.includes(n)), NAMES.filter((n) => text.includes(n)));
      const rs = reqOf(env, file);
      const bad = rs.filter((r) => (r.to === 'master' && (MASTER_FULL.includes(r.action) || (r.action === 'getSection' && r.section !== 'facesheet_safe'))) ||
        (r.to === 'sync' && ['get', 'pull', 'head'].includes(r.action)) || ((r.to === 'tp' || r.to === 'msk') && r.action !== 'ping'));
      t(label + ': 入居者マスタの全件・詳細の読み取り、同期の読み取り（get/pull）を送らない', bad.length === 0, bad);
      if (rs.length) console.log('    （参考: ' + label + ' が送ったもの: ' + rs.map((r) => r.to + ':' + r.action).join('・') + '）');
      const hops = await page.evaluate(() => Array.from(document.querySelectorAll('.srh a')).map((a) => a.getAttribute('href')));
      t(label + ': 行き来の帯を出さない', hops.length === 0, hops);
      await shot(page, 'flow4-' + file.replace('.html', ''));
      await page.close();
    }

    /* 現場でも使える画面 */
    {
      const page = await open(env, 'facesheet.html?masterId=' + ME.id);
      const who = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent && e.querySelector('.srh') ? e.innerText : null; }));
      t('フェイスシート（現場）: 開けて「' + ME.name + 'さんを開いています」', !!who && who.includes(ME.name + 'さんを開いています'), who);
      await page.waitForTimeout(1500);
      const rs = reqOf(env, 'facesheet.html').filter((r) => r.to === 'master');
      const secs = rs.filter((r) => r.action === 'getSection');
      t('フェイスシート（現場）: この方の中身は getSection（facesheet_safe）で読む', secs.length > 0 && secs.every((r) => r.section === 'facesheet_safe' && String(r.id) === ME.id), secs);
      const other = rs.filter((r) => r.action !== 'getSection' && r.action !== 'getRoster');
      t('フェイスシート（現場）: getResident・getBulk・getListFull などの全項目・全件の読み取りを送らない', other.length === 0, other);
      const rosters = rs.filter((r) => r.action === 'getRoster');
      console.log('    （参考: 端末に共有名簿が無いので、名簿 getRoster を ' + rosters.length + '本送った＝facesheet.html の「共有名簿が空のときのフォールバック」）');
      t('フェイスシート（現場）: 同期の読み取り（get/pull）を送らない', !reqOf(env, 'facesheet.html').some((r) => r.to === 'sync'), reqOf(env, 'facesheet.html').filter((r) => r.to === 'sync'));
      hopOk('フェイスシート（現場）', 'facesheet.html', await page.evaluate(() => Array.from(document.querySelectorAll('#fromMaster .srh a')).map((a) => a.getAttribute('href'))), { field: true });
      await shot(page, 'flow4-facesheet');
      await page.close();
    }
    {
      const page = await open(env, 'weight-record.html?masterId=' + ME.id);
      const who = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent && e.querySelector('.srh') ? e.innerText : null; }));
      t('体重管理（現場）: 開けて「' + ME.name + 'さんを開いています」', !!who && who.includes(ME.name + 'さんを開いています'), who);
      hopOk('体重管理（現場）', 'weight-record.html', await page.evaluate(() => Array.from(document.querySelectorAll('#fromMaster .srh a')).map((a) => a.getAttribute('href'))), { field: true });
      t('体重管理（現場）: 入居者マスタ・同期へ読みに行かない', !reqOf(env, 'weight-record.html').some((r) => r.to === 'master' || r.to === 'sync'), reqOf(env, 'weight-record.html'));
      await page.close();
    }
    {
      /* 古い入口（?resident=&name=）で開かれた時も動く。開いたらすぐ URL から氏名を消す（代表者の決定 2026-11-13） */
      const page = await open(env, 'genogram.html?resident=' + ME.id + '&name=' + encodeURIComponent(ME.name));
      const who = await waitFor(() => page.evaluate(() => { const e = document.getElementById('suHopBar'); return e && !e.hidden && e.querySelector('.srh') ? e.innerText : null; }));
      t('家族構成図（現場・古い URL）: 開けて「' + ME.name + 'さんを開いています」', !!who && who.includes(ME.name + 'さんを開いています'), who);
      const geUrl = await page.evaluate(() => location.href);
      t('家族構成図（古い URL）: 開いた後の URL に氏名が残らない・番号は残る', !/[?&]name=/.test(geUrl) && !geUrl.includes(encodeURIComponent(ME.name)) && new URL(geUrl).searchParams.get('resident') === String(ME.id), geUrl);
      const ps = hopOk('家族構成図（現場）', 'genogram.html', await page.evaluate(() => Array.from(document.querySelectorAll('#suHopBar .srh a')).map((a) => a.getAttribute('href'))), { field: true });
      t('家族構成図（現場）: 帯の URL に氏名を載せない', ps.every((p) => p.name == null), ps);
      t('家族構成図（現場）: 入居者マスタ・同期へ読みに行かない', !reqOf(env, 'genogram.html').some((r) => r.to === 'master' || r.to === 'sync'), reqOf(env, 'genogram.html'));
      await page.close();
    }
  } finally {
    endChecks(env, '(4)');
    await env.context.close();
  }

  /* 共有名簿がある現場端末では、フェイスシートは名簿も読まない（getSection だけ） */
  console.log('\n— (4b) 共有名簿がある現場の端末のフェイスシート —');
  const common = { v: 1, updatedAt: new Date().toISOString(), residents: F.masterRecords().map((r) => ({ masterId: r.id, name: r.name, kana: r.kana, room: r.room, gender: r.gender, careLevel: r.careLevel, active: true })) };
  const env2 = await makeEnv({ device: 'field', extraStorage: { su_residents_common: JSON.stringify(common) } });
  try {
    const page = await open(env2, 'facesheet.html?masterId=' + ME.id);
    await waitFor(() => page.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent && e.querySelector('.srh'); }));
    await page.waitForTimeout(1500);
    const rs = reqOf(env2, 'facesheet.html').filter((r) => r.to !== 'sb');
    t('フェイスシート（現場・共有名簿あり）: 送ったのは getSection（facesheet_safe・この方の番号）だけ', rs.length > 0 && rs.every((r) => r.to === 'master' && r.action === 'getSection' && r.section === 'facesheet_safe' && String(r.id) === ME.id), rs);
    await page.close();
  } finally {
    endChecks(env2, '(4b)');
    await env2.context.close();
  }

  /* 家族構成図は番号だけで開き、氏名は共有名簿で引く。名簿に無い時は名前の欄を空にして帯で知らせる（代表者の決定 2026-11-13） */
  console.log('\n— (4c) 家族構成図を番号だけで開く —');
  const env3 = await makeEnv({ extraStorage: { su_residents_common: JSON.stringify(common) } });
  try {
    const page = await open(env3, 'genogram.html?resident=' + ME.id);
    const who = await waitFor(() => page.evaluate(() => { const e = document.getElementById('suHopBar'); return e && !e.hidden && e.querySelector('.srh') ? e.innerText : null; }));
    t('家族構成図（番号だけ）: 共有名簿の氏名で「' + ME.name + 'さんを開いています」', !!who && who.includes(ME.name + 'さんを開いています'), who);
    t('家族構成図（番号だけ）: 名前の欄は共有名簿の氏名', (await page.inputValue('#clientName')) === ME.name, await page.inputValue('#clientName'));
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('#suHopBar .srh a')).map((a) => a.getAttribute('href')));
    t('家族構成図（番号だけ）: 帯の行き先に氏名を載せない', hrefs.length > 0 && hrefs.every((h) => !/name=/.test(h) && !h.includes(encodeURIComponent(ME.name))), hrefs);
    await page.close();
  } finally {
    endChecks(env3, '(4c)');
    await env3.context.close();
  }
  const env4 = await makeEnv({});
  try {
    const page = await open(env4, 'genogram.html?resident=' + ME.id);
    const msg = await waitFor(() => page.evaluate(() => { const e = document.getElementById('suHopBar'); return e && !e.hidden ? e.innerText : null; }));
    t('家族構成図（名簿なし）: 「お名前を読めませんでした」と帯で知らせる', !!msg && msg.includes('この方のお名前を読めませんでした'), msg);
    t('家族構成図（名簿なし）: 名前の欄は空のまま', (await page.inputValue('#clientName')) === '', await page.inputValue('#clientName'));
    await page.close();
  } finally {
    endChecks(env4, '(4c-2)');
    await env4.context.close();
  }
  const env5 = await makeEnv({ device: 'field' });
  try {
    const page = await open(env5, 'genogram.html?resident=' + ME.id);
    const msg = await waitFor(() => page.evaluate(() => { const e = document.getElementById('suHopBar'); return e && !e.hidden ? e.innerText : null; }));
    t('家族構成図（現場・名簿なし）: 「お名前を読めませんでした」だけを出し、現場でできない「入居者マスタを一度開いて」は出さない', !!msg && msg.includes('お名前を読めませんでした') && !msg.includes('入居者マスタを一度開いて'), msg);
    await page.close();
  } finally {
    endChecks(env5, '(4c-3)');
    await env5.context.close();
  }
}

/* ═════════ (5) 体重管理: 体重を入れて保存すると、その方の記録だけが体重の GAS に届き、開き直すと出る ═════════ */
const ymJst = () => ymdJst(0).slice(0, 7);
function wtSeed() {
  return { residents: [
    { id: 'w1', name: ME.name, masterId: ME.id, room: '101', active: true, height: 160, targetWeight: true },
    { id: 'w2', name: OTHER.name, masterId: OTHER.id, room: '102', active: true, height: 158, targetWeight: true },
  ], records: [] };
}
async function weightFlow(device, label, value) {
  const seed = wtSeed();
  const env = await makeEnv({ device, wtSeed: seed, extraStorage: {
    wtmgr_v1: JSON.stringify(seed), wtmgr_api_url: WT_URL, wtmgr_api_token: 'check-flow',
  } });
  const tag = 'weight-record.html';
  try {
    let page = await open(env, 'weight-record.html?masterId=' + ME.id);
    const who = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fromMaster'); return e && e.offsetParent ? e.innerText : null; }));
    t(label + ': 入居者マスタから開いて「' + ME.name + 'さんを開いています」', !!who && who.includes(ME.name + 'さんを開いています'), who);
    /* 起動の同期（getAll）が終わるのを待ってから入力へ（同期の間は保存のボタンが止まる） */
    await waitFor(() => reqOf(env, tag).some((r) => r.to === 'wt' && r.action === 'getAll') && page.evaluate(() => !document.body.classList.contains('wr-sync-busy')));
    await page.click('.tnav button[data-go="input"]');
    const sel = await page.$eval('#inResident', (e) => ({ v: e.value, t: e.options[e.selectedIndex] ? e.options[e.selectedIndex].textContent : '' }));
    t(label + ': 入力の画面も同じ方が選ばれている（' + ME.name + '）', sel.v === 'w1' && sel.t.includes(ME.name), sel);
    const ym = ymJst(), day = ymdJst(0);
    await page.fill('#inMonth', ym);
    await page.fill('#inDate', day);
    await page.fill('#inWeight', String(value));
    await page.click('#inSave');
    const got = await waitFor(() => env.st.wt.saved.find((r) => r.residentId === 'w1' && Number(r.weight) === value) || null);
    t(label + ': 体重の GAS に「' + ME.name + '」の記録（' + value + 'kg・' + ym + '）が届く', !!got && got.yearMonth === ym && got.measuredOn === day, got || env.st.wt.saved);
    t(label + ': ほかの方（' + OTHER.name + '）の記録は送らない', !env.st.wt.saved.some((r) => r.residentId !== 'w1'), env.st.wt.saved.map((r) => r.residentId));
    const sv = reqOf(env, tag).filter((r) => r.to === 'wt' && r.action === 'saveRecord');
    t(label + ': 送った保存（saveRecord）は1本', sv.length === 1, sv);
    await shot(page, 'flow5-' + device);
    await page.close();

    /* 開き直す（同じ端末）: 記録の一覧（個人の画面）に入れた体重が出る */
    page = await open(env, 'weight-record.html?masterId=' + ME.id);
    const shown = await waitFor(() => page.evaluate((v) => { const s = document.querySelector('.scr.on'); return s && s.innerText.includes(String(v)) ? s.dataset.sc : null; }, value));
    t(label + ': 開き直すと、この方の画面に ' + value + 'kg が出る', !!shown, shown);
    await page.close();
    if (device === 'field') {
      const bad = env.st.req.filter((r) => (r.to === 'master' && (MASTER_FULL.includes(r.action) || (r.action === 'getSection' && r.section !== 'facesheet_safe'))) || (r.to === 'sync' && ['get', 'pull', 'head'].includes(r.action)));
      t(label + ': 入居者マスタの全件・詳細の読み取り、同期の読み取りを送らない', bad.length === 0, bad);
    }
  } finally {
    endChecks(env, label);
    await env.context.close();
  }

  /* 別の端末（同じ用途・端末の記録は空）: 体重の GAS の getAll で読んで、同じ体重が出る＝端末の控えではなくサーバーに載った */
  const seed2 = { residents: env.st.wt.residents, records: env.st.wt.records };
  const env2 = await makeEnv({ device, wtSeed: seed2, extraStorage: {
    wtmgr_v1: JSON.stringify(wtSeed()), wtmgr_api_url: WT_URL, wtmgr_api_token: 'check-flow',
  } });
  try {
    const page = await open(env2, 'weight-record.html?masterId=' + ME.id);
    const shown = await waitFor(() => page.evaluate((v) => { const s = document.querySelector('.scr.on'); return s && s.innerText.includes(String(v)) ? s.dataset.sc : null; }, value));
    t(label + '（別の端末）: 端末に記録が無くても、サーバーから読んで ' + value + 'kg が出る', !!shown && reqOf(env2, 'weight-record.html').some((r) => r.to === 'wt' && r.action === 'getAll'), shown);
    await page.close();
  } finally {
    endChecks(env2, label + '（別の端末）');
    await env2.context.close();
  }
}
async function flow5() {
  console.log('\n— (5) 体重管理: 入れた体重が、その方の記録として届き、開き直すと出る —');
  await weightFlow('office', '(5) 体重管理（事務所PC）', 52.3);
  await weightFlow('field', '(5) 体重管理（現場）', 48.7);
}

/* ═════════ (6) 貼り薬カレンダー: 設定を入れると、その方の分だけ共通のデータベースに届き、開き直すと出る ═════════ */
const PATCH_FLAGS = { supabase: { ...F.FLAGS_OFF.supabase, patch_push: true, patch_read: true } };   // 本番と同じ「送る・読む」が入の状態
function patchRoster() {
  return JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), residents: F.masterRecords().map((r) => ({ masterId: r.id, name: r.name, kana: r.kana, room: r.room, active: true })) });
}
async function patchSet(page, start, no) {
  await page.selectOption('#rs', ME.id);
  await page.fill('#st', start);
  await page.dispatchEvent('#st', 'change');
  await page.selectOption('#no', String(no));
}
async function flow6() {
  console.log('\n— (6) 貼り薬カレンダー: 入れた設定が、その方の分だけ届き、開き直すと出る —');
  const START = ymdJst(-3), NO = 5;
  const env = await makeEnv({ flags: PATCH_FLAGS, extraStorage: { su_residents_common: patchRoster() } });
  const tag = 'patch-calendar.html';
  try {
    let page = await open(env, 'patch-calendar.html');
    await waitFor(() => page.evaluate((id) => !!document.querySelector('#rs option[value="' + id + '"]'), ME.id));
    await page.waitForTimeout(2500);   // 開いた後の送信・読み込み（あれば）を待つ
    await patchSet(page, START, NO);
    const got = await waitFor(() => env.st.patch[ME.id] && env.st.patch[ME.id].start === START && Number(env.st.patch[ME.id].no) === NO ? env.st.patch[ME.id] : null);
    t('(6) 貼り薬（事務所PC）: 共通のデータベースに「' + ME.name + '」の設定（開始日・場所）が届く', !!got, env.st.patch);
    t('(6) 貼り薬（事務所PC）: 送った中身は番号と設定だけ（氏名を送らない）', !JSON.stringify(env.st.patch).includes(ME.name), env.st.patch);
    t('(6) 貼り薬（事務所PC）: ほかの方の設定は送らない', Object.keys(env.st.patch).every((k) => k === ME.id), Object.keys(env.st.patch));
    await shot(page, 'flow6-office');
    await page.close();

    /* 開き直す: サーバーの値（patch_get）を読み、この方を選ぶと入れた開始日・場所が出る */
    page = await open(env, 'patch-calendar.html');
    await waitFor(() => page.evaluate((id) => !!document.querySelector('#rs option[value="' + id + '"]'), ME.id));
    await page.selectOption('#rs', ME.id);
    const back = await waitFor(() => page.evaluate(() => ({ st: document.getElementById('st').value, no: document.getElementById('no').value })).then((v) => (v.st ? v : null)));
    t('(6) 貼り薬（事務所PC）: 開き直すと開始日 ' + START + '・場所 ' + NO + ' が出る', !!back && back.st === START && back.no === String(NO), back);
    t('(6) 貼り薬（事務所PC）: 開いた時にサーバーから読む（patch_get）', env.st.patchCalls.some((c) => c.fn === 'patch_get'), env.st.patchCalls);
    await page.close();
  } finally {
    endChecks(env, '(6) 貼り薬（事務所PC）');
    await env.context.close();
  }

  /* 別の事務所PC（端末の控えが空）: サーバーの値（patch_get）を読んで、同じ開始日・場所が出る＝控えではなくサーバーに載った */
  const env1b = await makeEnv({ flags: PATCH_FLAGS, patchSeed: env.st.patch, extraStorage: { su_residents_common: patchRoster() } });
  try {
    const page = await open(env1b, 'patch-calendar.html');
    await waitFor(() => env1b.st.patchCalls.some((c) => c.fn === 'patch_get'), 15000);
    await page.waitForTimeout(800);
    await page.selectOption('#rs', ME.id);
    const v = await waitFor(() => page.evaluate(() => ({ st: document.getElementById('st').value, no: document.getElementById('no').value })).then((x) => (x.st === '' ? null : x)));
    t('(6) 貼り薬（別の事務所PC）: 端末に控えが無くても、サーバーから読んで開始日 ' + START + '・場所 ' + NO + ' が出る', !!v && v.st === START && v.no === String(NO), v);
    await page.close();
  } finally {
    endChecks(env1b, '(6) 貼り薬（別の事務所PC）');
    await env1b.context.close();
  }

  /* 現場の端末: 端末の控えに2名分の設定（送信済み）と、送信待ちの1名がある。開いた時は送信待ちの方だけを送り、全員分を送らない */
  console.log('\n— (6b) 貼り薬カレンダー（現場の端末）: 開いた時は送信待ちの方だけを送る —');
  const at = new Date(Date.now() - 60 * 1000).toISOString();
  const local = { v: 1, r: {
    [ME.id]: { start: START, no: 2, prev: 1, by: '現場の端末', at },
    [OTHER.id]: { start: START, no: 3, prev: 2, by: '現場の端末', at },
  } };
  const env2 = await makeEnv({ device: 'field', flags: PATCH_FLAGS, extraStorage: {
    su_residents_common: patchRoster(), apc2_res: JSON.stringify(local),
    apc2_sync_q: JSON.stringify({ v: 1, q: { [ME.id]: at } }),
  } });
  try {
    const page = await open(env2, 'patch-calendar.html');
    await waitFor(() => env2.st.patchCalls.length > 0, 10000);
    await page.waitForTimeout(2500);
    const sent = [...new Set(env2.st.patchCalls.filter((c) => c.fn !== 'patch_get').flatMap((c) => c.rids))];
    t('(6b) 貼り薬（現場）: 開いた時に送信待ちの方（' + ME.name + '）を送る', sent.includes(ME.id), env2.st.patchCalls);
    t('(6b) 貼り薬（現場）: 送信待ちでない方（' + OTHER.name + '）は送らない＝全員分を送らない', !sent.includes(OTHER.id), env2.st.patchCalls);
    t('(6b) 貼り薬（現場）: サーバーから読まない（patch_get を呼ばない）', !env2.st.patchCalls.some((c) => c.fn === 'patch_get'), env2.st.patchCalls);
    /* 現場でも設定を直せば、その方を送る */
    const before = env2.st.patchCalls.length;
    await patchSet(page, START, NO);
    const got = await waitFor(() => env2.st.patch[ME.id] && Number(env2.st.patch[ME.id].no) === NO ? env2.st.patch[ME.id] : null);
    t('(6b) 貼り薬（現場）: 直した設定（場所 ' + NO + '）を送る', !!got && env2.st.patchCalls.length > before, env2.st.patch);
    t('(6b) 貼り薬（現場）: 入居者マスタ・同期へ読みに行かない', !reqOf(env2, tag).some((r) => r.to === 'master' || r.to === 'sync'), reqOf(env2, tag));
    await page.close();
  } finally {
    endChecks(env2, '(6b) 貼り薬（現場）');
    await env2.context.close();
  }
}

/* ═════════ (7) 計画書: 期を作って書いて保存すると、その方の計画だけが届き、開き直すと出て、一覧に載る ═════════ */
async function flow7() {
  console.log('\n— (7) 計画書: 作った計画が、その方の分だけ届き、開き直すと出て、一覧に載る —');
  const NOTE = '試験の記入（架空）';
  const env = await makeEnv();
  const KEY = 'training_plan:' + ME.id;
  try {
    let page = await open(env, 'training-plan.html?masterId=' + ME.id);
    const opened = await waitFor(() => page.evaluate(() => { const s = document.getElementById('scr-edit'); return s && s.classList.contains('on') && document.querySelector('#tpHop .srh') ? s.innerText.slice(0, 300) : null; }));
    t('(7) 計画書: 入居者マスタから開いて、この方（' + ME.name + '）の計画書の画面が出る', !!opened && opened.includes(ME.name), opened);
    await page.click('#btnAddAt');
    /* 期を作った直後は「本人の様子」の窓（AI の文案の依頼）が開く。職員と同じく「あとで」で閉じる */
    if (await waitFor(() => page.evaluate(() => document.getElementById('samplePop').classList.contains('on')), 5000)) await page.click('#spLater');
    const has = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fDiagnosis'); return e && !e.disabled && e.offsetParent ? true : null; }));
    t('(7) 計画書: 「この日付で計画を追加」で期ができ、欄に書ける', !!has);
    await page.fill('#fDiagnosis', NOTE);
    await page.dispatchEvent('#fDiagnosis', 'input');
    await page.click('#btnSave');
    const doc = await waitFor(() => { const e = env.st.tp.kv.get(KEY); return e && JSON.stringify(e.data).includes(NOTE) ? e.data : null; });
    t('(7) 計画書: 受け口に「' + ME.name + '」の計画（training_plan:' + ME.id + '）が届き、書いた内容が入っている', !!doc && Array.isArray(doc.plans) && doc.plans.length >= 1, doc ? { plans: doc.plans.length } : [...env.st.tp.kv.keys()]);
    t('(7) 計画書: 計画の持ち主の番号は ' + ME.id, !!doc && doc.subject && String(doc.subject.masterId) === ME.id, doc && doc.subject);
    const others = [...env.st.tp.kv.keys()].filter((k) => /^training_plan:/.test(k) && k !== KEY && k !== 'training_plan:index');
    t('(7) 計画書: ほかの方の計画は書かない', others.length === 0, others);
    /* 保存が通った後に、画面は一覧の索引（training_plan:index）のこの方の行を書き直す。職員と同じく保存が終わるのを待つ */
    const idx = await waitFor(() => { const e = env.st.tp.kv.get('training_plan:index'); const r = e && e.data && e.data.rows && e.data.rows[ME.id]; return r && r.latestPlanDate ? r : null; });
    t('(7) 計画書: 一覧の索引にこの方の行（最新の期の作成日・次回期限）が書かれる', !!idx && !!idx.nextDue, idx);
    const idxRows = (env.st.tp.kv.get('training_plan:index') || { data: { rows: {} } }).data.rows || {};
    t('(7) 計画書: 索引にほかの方の行を足さない', Object.keys(idxRows).every((k) => k === ME.id), Object.keys(idxRows));
    await shot(page, 'flow7-edit');
    await page.close();

    /* 開き直す: 書いた内容が出る */
    page = await open(env, 'training-plan.html?masterId=' + ME.id);
    const v = await waitFor(() => page.evaluate(() => { const e = document.getElementById('fDiagnosis'); return e && e.value ? e.value : null; }));
    t('(7) 計画書: 開き直すと書いた内容が出る', v === NOTE, v);
    await page.close();

    /* 一覧: この方に計画（1期）がある */
    page = await open(env, 'training-plan.html');
    let lastRow = null;
    const row = await waitFor(() => page.evaluate((nm) => {
      const s = document.getElementById('scr-list'); if (!s || !s.classList.contains('on')) return null;
      /* 一覧の1行＝その方の氏名と「開く」を両方持ついちばん小さい部品 */
      const rows = Array.from(s.querySelectorAll('*')).filter((x) => x.innerText && x.innerText.includes(nm) && x.innerText.includes('開く'));
      rows.sort((a, b) => a.innerText.length - b.innerText.length);
      return rows.length ? rows[0].innerText.replace(/\s+/g, ' ') : null;
    }, ME.name).then((r) => { lastRow = r; return r && !r.includes('計画なし') ? r : null; }));   // 一覧は名簿の後に期限を読み込んで描き直す
    t('(7) 計画書: 一覧に ' + ME.name + ' が出て、「計画なし」ではなく次回期限の日付が出る', !!row && !row.includes('計画なし') && /\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}/.test(row), row || lastRow);
    await shot(page, 'flow7-list');
    await page.close();
  } finally {
    endChecks(env, '(7)');
    await env.context.close();
  }
}

/* ═════════ (8) 画面の中の窓（su-dialog.js）: 確かめの窓を通る操作で、OK で先へ進み・キャンセルで何も変わらず・素早い二度押しで二重にならない ═════════
   代表者の指示 2026-11-13（横断の一手 cross 3）。操作ごとに次の場面を通す:
     (a) キャンセル … 窓が画面の中に出て（ブラウザの窓は出ない）、キャンセルを押すと何も送らず・窓が閉じ・画面の状態（直した印など）が残る
     (b) OK … 窓が開いてから守りの時間（開いてすぐの押下を受けない・350ms）を過ぎてから OK を素早く2回押す＝1回だけ先へ進む
     (c) 窓の外の2回押し … 操作のボタンを素早く2回押し（2回目は開いた窓か暗い後ろに当たる）、暗い後ろも2回押す＝窓は1つだけ・後ろの押下では答えない。
         その後 OK を1回押す＝1回だけ先へ進む
   確かめが2つ続く操作（写しの見比べの「本当に実行しますか？」）は、1つ目・2つ目のキャンセルを両方通し、1つ目で OK を2回押しても2つ目が1つだけ待つことも確かめる。
   落ちた時は「画面の名前／操作の名前：場面」だけを出す（窓の文・氏名・送った中身は出さない）。
   押すのは本物のマウスの押下（page.mouse）。要素の click() は押下の回数（detail）が0で、開いてすぐの押下の守りを素通りするため使わない */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GUARD_MS = 350;   // su-dialog.js の「開いてすぐの押下を受けない」時間。押すのはこれより後
const tn = (scr, op, what, ok) => t(scr + '／' + op + '：' + what, !!ok);
const dlgOpenN = (page) => page.evaluate(() => document.querySelectorAll('dialog.sud-dlg[open]').length).catch(() => -1);
const shownN = (page) => page.evaluate(() => window.__sudShown || 0).catch(() => -1);
async function waitDlg(page, timeout = 6000) {
  const h = await page.waitForSelector('dialog.sud-dlg[open]', { timeout }).catch(() => null);
  if (!h) return false;
  await sleep(GUARD_MS + 150);
  return true;
}
const centerOf = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return null;
  const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}, sel).catch(() => null);
/* 窓のボタンを押す（which: 'ok' | 'cancel'・times 回を素早く） */
async function pressDlg(page, which, times = 1) {
  const c = await centerOf(page, 'dialog.sud-dlg[open] .sud-btn' + (which === 'ok' ? '.pri' : ':not(.pri)'));
  if (!c) return false;
  for (let i = 0; i < times; i++) { await page.mouse.click(c.x, c.y); if (i + 1 < times) await sleep(40); }
  return true;
}
/* 画面のボタンを押す（times=2 は素早い2回押し＝2回目は窓が出た後なら窓か暗い後ろに当たる） */
async function pressAt(page, sel, times = 1) {
  await page.evaluate((s) => { const e = document.querySelector(s); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'center' }); }, sel).catch(() => {});
  const c = await centerOf(page, sel);
  if (!c) return false;
  if (times === 2) await page.mouse.dblclick(c.x, c.y); else await page.mouse.click(c.x, c.y);
  return true;
}
/* 操作1つを (a)(b)(c) の順に通す。
   prep(場面) … 確かめが出る状態（直した・開いた）を作る。true で用意できた
   go(times) … 操作のボタンを押す／effect() … 先へ進んだ回数（送った保存の数など）／kept() … キャンセルの後に画面の状態が残っているか
   steps … 先へ進むまでに続けて出る確かめの数 */
async function dialogOp(env, page, scr, op, { prep, go, effect, kept, steps = 1, settle = 900 }) {
  const native0 = env.st.dialogs.length, err0 = env.st.errors.length;
  for (let at = 1; at <= steps; at++) {
    const ready = await prep('a' + at);
    tn(scr, op, '確かめの前の状態を作れる（キャンセルの場面' + (steps > 1 ? at : '') + '）', ready);
    if (!ready) return;
    const e0 = await effect();
    await go(1);
    let shown = await waitDlg(page);
    tn(scr, op, '押すと画面の中の窓が出る（ブラウザの窓ではない）', shown && env.st.dialogs.length === native0);
    for (let k = 1; k < at && shown; k++) {
      await pressDlg(page, 'ok'); shown = await waitDlg(page);
      if (!shown) tn(scr, op, 'キャンセルの場面で' + (k + 1) + 'つ目の窓が出る', false);
    }
    if (!shown) return;
    await pressDlg(page, 'cancel');
    await sleep(settle);
    tn(scr, op, (steps > 1 ? at + 'つ目の窓の' : '') + 'キャンセルで何も変わらない（送らない・窓が閉じる・画面の状態が残る）',
      (await effect()) === e0 && (await dlgOpenN(page)) === 0 && (await kept()));
  }
  if (!(await prep('b'))) { tn(scr, op, '確かめの前の状態を作れる（OK の場面）', false); return; }
  const e1 = await effect();
  await go(1);
  for (let k = 1; k <= steps; k++) {
    if (!(await waitDlg(page))) { tn(scr, op, 'OK の場面で' + k + 'つ目の窓が出る', false); return; }
    await pressDlg(page, 'ok', 2);
    if (k < steps) {
      await sleep(300);
      tn(scr, op, '1つ目の窓で OK を2回押しても、まだ先へ進まず次の窓が1つだけ待つ', (await effect()) === e1 && (await dlgOpenN(page)) === 1);
    }
  }
  await waitFor(async () => (await effect()) > e1, 8000);
  await sleep(settle);
  const e2 = await effect();
  tn(scr, op, 'OK で先へ進む', e2 > e1);
  tn(scr, op, '守りの時間の後に OK を2回押しても1回だけ（二重にならない・窓が残らない）', e2 === e1 + 1 && (await dlgOpenN(page)) === 0);
  if (!(await prep('c'))) { tn(scr, op, '確かめの前の状態を作れる（窓の外の2回押しの場面）', false); return; }
  const e3 = await effect(), s0 = await shownN(page);
  await ev(page, () => { window.__sudPoke = true; window.__sudPoked = false; });
  await go(2);
  const shownC = await waitDlg(page);
  await page.mouse.click(6, 6); await sleep(40); await page.mouse.click(6, 6);
  await sleep(300);
  tn(scr, op, '開いてすぐ（守りの時間の中）に OK に当たった押下では答えない',
    shownC && !!(await ev(page, () => window.__sudPoked)) && (await dlgOpenN(page)) === 1 && (await effect()) === e3);
  tn(scr, op, '操作のボタンを素早く2回押しても窓は1つだけ・暗い後ろを押しても答えない',
    shownC && (await dlgOpenN(page)) === 1 && (await shownN(page)) === s0 + 1 && (await effect()) === e3);
  for (let k = 1; k <= steps; k++) {
    if (k > 1 && !(await waitDlg(page))) { tn(scr, op, '窓の外の2回押しの場面で' + k + 'つ目の窓が出る', false); return; }
    await pressDlg(page, 'ok');
  }
  await waitFor(async () => (await effect()) > e3, 8000);
  await sleep(settle);
  tn(scr, op, '操作のボタンを素早く2回押しても1回だけ先へ進む（二重にならない・窓が残らない）',
    (await effect()) === e3 + 1 && (await dlgOpenN(page)) === 0 && (await shownN(page)) === s0 + steps);
  tn(scr, op, '画面のエラーなし・ブラウザの窓なし', env.st.errors.length === err0 && env.st.dialogs.length === native0);
}
/* 名前だけを出す終わりの確かめ（endChecks と同じ中身・文や中身は出さない） */
function endChecksQuiet(env, scr) {
  tn(scr, '全体', '画面のエラー（pageerror）なし', env.st.errors.length === 0);
  tn(scr, '全体', '横取りしていない外への通信なし', env.st.ext.length === 0);
  const badCt = env.st.ct.filter((c) => c.ct.toLowerCase().replace(/\s+/g, '') !== 'text/plain;charset=utf-8');
  tn(scr, '全体', 'GAS への送信はすべて text/plain;charset=utf-8', badCt.length === 0);
}
const ev = (page, fn, arg) => page.evaluate(fn, arg).catch(() => null);

/* 入居者マスタ: 一括編集の保存・食形態一覧の保存・薬情の取り込みを閉じる */
async function flow8master() {
  const SCR = '入居者マスタ';
  const env = await makeEnv({ sudCount: true });
  const base = env.st.master.respond;
  const cnt = (a) => env.st.master.log.filter((l) => l.action === a).length;
  /* 一括保存・食形態一覧の保存は、送った方の数だけ「保存した」と答える（GAS の savePartial・saveMealList と同じ形） */
  env.st.master.respond = (b) => {
    if (b && (b.action === 'savePartial' || b.action === 'saveMealList')) { base(b); return { ok: true, saved: (b.changes || []).length, warn: [], warnIds: [] }; }
    if (b && b.action === 'medCand' && b.op === 'ping') { base(b); return { ok: true, build: 'check 反映記録' }; }
    return base(b);
  };
  try {
    const page = await open(env, 'resident-master.html');
    await page.waitForSelector(`.rcard[data-id="${ME.id}"]`, { timeout: 15000 });
    /* 一括編集の保存: 居室を直して「変更を保存」 */
    let n = 0;
    const room = `#bulkBody input[data-id="${ME.id}"][data-k="room"]`;
    await dialogOp(env, page, SCR, '一括編集の保存', {
      prep: async (sc) => {
        if (!(await ev(page, () => document.getElementById('mBulk').classList.contains('on')))) await page.click('#bulkOpen', { timeout: 8000 });
        if (!(await page.waitForSelector(room, { timeout: 15000 }).catch(() => null))) return false;
        if (sc !== 'b' && sc !== 'c' && (await ev(page, () => bulkCellCount() > 0))) return true;
        await page.fill(room, String(301 + (n++)));
        return !!(await ev(page, () => bulkCellCount() > 0 && !document.getElementById('bulkSave').disabled));
      },
      go: (k) => pressAt(page, '#bulkSave', k),
      effect: async () => cnt('savePartial'),
      kept: async () => !!(await ev(page, () => bulkCellCount() > 0 && document.getElementById('mBulk').classList.contains('on'))),
    });
    await page.click('#bulkClose', { timeout: 8000 });
    await waitFor(() => ev(page, () => !document.getElementById('mBulk').classList.contains('on')), 5000);

    /* 食形態一覧の保存: 表の1つの欄を直して「保存」 */
    await page.click('.vtab[data-v="meal"]', { timeout: 8000 });
    const cell = `#rosterBox .med[contenteditable][data-id="${ME.id}"]`;
    await dialogOp(env, page, SCR, '食形態一覧の保存', {
      prep: async () => {
        if (!(await page.waitForSelector(cell, { timeout: 15000 }).catch(() => null))) return false;
        if (await ev(page, () => mealDirtyCells() > 0)) return true;
        await page.evaluate(([s, v]) => { const e = document.querySelector(s); e.focus(); e.textContent = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [cell, '見本食' + (n++)]);
        return !!(await ev(page, () => mealDirtyCells() > 0 && !document.getElementById('mealSave').disabled));
      },
      go: (k) => pressAt(page, '#mealSave', k),
      effect: async () => cnt('saveMealList'),
      kept: async () => !!(await ev(page, () => mealDirtyCells() > 0)),
    });

    /* 薬情の取り込みを閉じる: 書類を1枚読み、確認表で印を付けた（保存していない）まま「閉じる」。
       管理者の入口（ログインの確かめ）は yakujo_bulk_e2e と同じく飛ばし、窓を直接開く */
    const yjFile = JSON.stringify({ kind: 'yakujo-yomitori', v: 1, createdAt: '2026-11-13T09:00:00+09:00', skipped: [], docs: [
      { no: 1, file: 'a.jpg', type: 'photo', error: '', pages: [{ no: 1, w: 1000, h: 1400, img: '', codes: { qr: 0, other: 0 }, lines: [
        { t: ME.name + ' 様', x: 0.1, y: 0.05, w: 0.4, h: 0.02, c: 1 }, { t: 'カクウ イチロウ', x: 0.1, y: 0.07, w: 0.4, h: 0.02, c: 1 },
        { t: '調剤日 2026年11月01日', x: 0.5, y: 0.05, w: 0.4, h: 0.02, c: 1 },
        { t: 'Rp1 1日1回 朝食後 14日分', x: 0.1, y: 0.12, w: 0.6, h: 0.02, c: 1 }, { t: '見本薬A', x: 0.1, y: 0.15, w: 0.4, h: 0.02, c: 1 }, { t: '1回2錠', x: 0.6, y: 0.15, w: 0.4, h: 0.02, c: 1 },
      ] }] }] });
    await dialogOp(env, page, SCR, '薬情の取り込みを閉じる', {
      prep: async () => {
        if (!(await ev(page, () => !!(window.yjSt && yjSt.cur && yjSt.cur.loaded)))) {
          await page.evaluate((txt) => { window.rmAccessToken_ = function () { return Promise.resolve('check-token'); }; window.yjOpen_(); window.yjLoadText_(txt); }, yjFile);
          if (!(await page.waitForSelector('#yjGo:not([disabled])', { timeout: 10000 }).catch(() => null))) return false;
          await page.click('#yjGo', { timeout: 8000 });
          if (!(await page.waitForSelector('[data-yjdoc="0"]', { timeout: 15000 }).catch(() => null))) return false;
          await page.click('[data-yjdoc="0"]', { timeout: 8000 });
          if (!(await waitFor(() => ev(page, () => !!(window.yjSt && yjSt.cur && yjSt.cur.loaded)), 15000))) return false;
        }
        if (!(await ev(page, () => yjDirty_()))) {
          if (!(await page.waitForSelector('#yjId', { timeout: 10000 }).catch(() => null))) return false;
          await page.click('#yjId', { timeout: 8000 });
        }
        return !!(await ev(page, () => yjDirty_() && document.getElementById('mYakujo').classList.contains('on')));
      },
      go: (k) => pressAt(page, '#yjClose', k),
      effect: async () => ((await ev(page, () => document.getElementById('mYakujo').classList.contains('on'))) === false ? 1 : 0),
      kept: async () => !!(await ev(page, () => yjDirty_() && document.getElementById('mYakujo').classList.contains('on'))),
    });
    await page.close();
  } finally {
    endChecksQuiet(env, SCR);
    await env.context.close();
  }
}

/* 体重管理: 記録の削除・記録の保存（前回から大きく変わった時の「測り直しても同じ値でしたか？」） */
async function flow8weight() {
  const SCR = '体重管理';
  /* 架空の過去の記録3件（削除の3つの場面で1件ずつ消す）。体重はどれも 50.0kg＝今日 60.0kg を入れると大きく変わった扱い */
  const old = [-70, -100, -130].map((d, i) => { const day = ymdJst(d); return { id: 'flow8-r' + (i + 1), residentId: 'w1', yearMonth: day.slice(0, 7), measuredOn: day, weight: 50, mode: 'normal' }; });
  const seed = { residents: wtSeed().residents, records: old };
  const env = await makeEnv({ wtSeed: seed, sudCount: true, extraStorage: { wtmgr_v1: JSON.stringify(seed), wtmgr_api_url: WT_URL, wtmgr_api_token: 'check-flow' } });
  const tag = 'weight-record.html';
  const cnt = (a) => reqOf(env, tag).filter((r) => r.to === 'wt' && r.action === a).length;
  try {
    const page = await open(env, 'weight-record.html?masterId=' + ME.id);
    await waitFor(() => reqOf(env, tag).some((r) => r.to === 'wt' && r.action === 'getAll') && page.evaluate(() => !document.body.classList.contains('wr-sync-busy')));
    await page.click('.tnav button[data-go="input"]', { timeout: 8000 });
    let k = 0;
    await dialogOp(env, page, SCR, '記録の削除', {
      prep: async (sc) => {
        k = sc === 'c' ? 1 : 0;   // キャンセルと OK の場面は1件目、窓の外の2回押しの場面は2件目
        const id = old[k].id;
        return !!(await page.waitForSelector(`[data-iex-del="${id}"]`, { timeout: 10000 }).catch(() => null));
      },
      go: (times) => pressAt(page, `[data-iex-del="${old[k].id}"]`, times),
      effect: async () => cnt('delRecord'),
      kept: async () => !!(await ev(page, (id) => !!document.querySelector(`[data-iex-del="${id}"]`), old[k].id)),
    });
    /* 消えた記録を数える（場面ごとに1件ずつ・キャンセルの場面では消さない） */
    const gone = old.filter((r) => !env.st.wt.records.some((x) => x.id === r.id)).length;
    tn(SCR, '記録の削除', 'サーバーから消えた記録は OK を押した2回分だけ', gone === 2);

    /* 記録の保存: 前回 50.0kg の方に 60.0kg を入れて「記録を保存」→「測り直しても同じ値でしたか？」 */
    let d = 0;
    await dialogOp(env, page, SCR, '記録の保存（測り直しの確かめ）', {
      prep: async (sc) => {
        if (sc === 'a1' || sc === 'b' || sc === 'c') {
          const day = ymdJst(-(d++));
          await page.fill('#inMonth', day.slice(0, 7));
          await page.fill('#inDate', day);
          await page.fill('#inWeight', '60');
        }
        return !!(await ev(page, () => document.getElementById('inWeight').value === '60' && !document.getElementById('inSave').disabled));
      },
      go: (times) => pressAt(page, '#inSave', times),
      effect: async () => cnt('saveRecord'),
      kept: async () => !!(await ev(page, () => document.getElementById('inWeight').value === '60')),
    });
    await page.close();
  } finally {
    endChecksQuiet(env, SCR);
    await env.context.close();
  }
}

/* 職員マスタ: 一括編集の「一括保存」。職員マスタ GAS の偽物は撮影の材料（check/fixtures/staff-master.mjs・架空の職員3名）の答えを使い、
   一括保存は送った行をそのまま「保存した」と答える（staff-api.gs の bulkSave と同じ形） */
const STAFF_URL = 'https://script.google.com/macros/s/CHECK-FLOW-STAFF/exec';
async function flow8staff() {
  const SCR = '職員マスタ';
  const rev = {};
  const respond = (b) => {
    if (b && b.action === 'bulkSave') {
      return { ok: true, ver: 1, applied: (b.rows || []).map((r) => { rev[r.id] = (rev[r.id] || Number(r.rev) || 1) + 1; return { id: r.id, rev: rev[r.id] }; }), conflicts: [], warnings: [] };
    }
    return SF.respond(b);
  };
  const env = await makeEnv({ sudCount: true, gas: [[STAFF_URL, respond, 'staff']],
    extraStorage: { stfm_cfg: JSON.stringify({ url: STAFF_URL, token: 'check-flow', by: '検証PC' }) } });
  const tag = 'staff-master.html';
  const cnt = () => reqOf(env, tag).filter((r) => r.to === 'staff' && r.action === 'bulkSave').length;
  const row = '#listBody tr[data-id="S0002"]';
  try {
    const page = await open(env, 'staff-master.html');
    let n = 0;
    await dialogOp(env, page, SCR, '一括保存', {
      prep: async () => {
        if (!(await page.waitForSelector(row, { timeout: 15000 }).catch(() => null))) return false;
        if (!(await ev(page, () => !!ST.bulk))) await page.click('#bulkBtn', { timeout: 8000 });
        const inp = row + ' input[type="text"][data-f="position"]';
        if (!(await page.waitForSelector(inp, { timeout: 10000 }).catch(() => null))) return false;
        if (await ev(page, () => Object.keys(ST.dirty).length > 0)) return true;
        await page.fill(inp, '見本係' + (n++));
        await page.dispatchEvent(inp, 'change');
        return !!(await ev(page, () => Object.keys(ST.dirty).length > 0 && !ST.busy));
      },
      go: (k) => pressAt(page, '#bulkSaveBtn', k),
      effect: async () => cnt(),
      kept: async () => !!(await ev(page, () => Object.keys(ST.dirty).length > 0 && !!ST.bulk)),
    });
    await page.close();
  } finally {
    endChecksQuiet(env, SCR);
    await env.context.close();
  }
}

/* 家族構成図: 保存していない変更があるまま一覧から別の図を開く（読込）・保存した図の削除。クラウドの接続先は入れない（端末の図だけ） */
async function flow8geno() {
  const SCR = '家族構成図';
  const env = await makeEnv({ sudCount: true });
  const has = (page, nm) => ev(page, (x) => localStorage.getItem('genogram:doc:' + x) != null, nm);
  /* 窓が出ていたら OK で閉じる（図を作る準備の間に出た知らせ） */
  const drain = async (page) => { for (let i = 0; i < 4 && (await dlgOpenN(page)) > 0; i++) { await sleep(GUARD_MS + 150); await pressDlg(page, 'ok'); await sleep(200); } };
  /* 今の図をこの名前で端末に保存する */
  const saveAs = async (page, nm) => {
    await page.fill('#clientName', nm);
    await page.dispatchEvent('#clientName', 'input');
    await page.click('#btnSave', { timeout: 8000 });
    await waitFor(async () => (await has(page, nm)) || (await dlgOpenN(page)) > 0, 8000);
    await drain(page);
    return !!(await waitFor(() => has(page, nm), 5000));
  };
  try {
    const page = await open(env, 'genogram.html');
    await page.waitForSelector('#btnSave', { timeout: 15000 });
    await sleep(500);
    await drain(page);
    const made = (await saveAs(page, OTHER.name)) && (await saveAs(page, ME.name));
    tn(SCR, '準備', '架空の図を2つ端末に保存できる', made);
    const cur = () => ev(page, () => document.getElementById('clientName').value.trim());
    /* 保存していない変更がある印＝画面が端末に書く下書き（genogram:draft）。画面の中の関数は外から呼べないため、見える印で確かめる */
    const unsaved = () => ev(page, () => localStorage.getItem('genogram:draft') != null);
    const docOpt = (nm) => '#docList option[value="' + nm + '"]';
    await dialogOp(env, page, SCR, '保存していない変更があるまま別の図を読込', {
      prep: async () => {
        if ((await cur()) !== ME.name) {
          if (!(await page.waitForSelector(docOpt(ME.name), { state: 'attached', timeout: 5000 }).catch(() => null))) return false;
          await page.selectOption('#docList', ME.name);
          await drain(page);
          if (!(await waitFor(async () => (await cur()) === ME.name, 8000))) return false;
        }
        if (!(await unsaved())) { await page.click('.tbtn[data-add="male"]', { timeout: 8000 }); await drain(page); }
        return !!(await waitFor(unsaved, 8000)) && (await cur()) === ME.name;
      },
      /* 読込は一覧から選ぶ操作。2回押しの場面は、選んだ直後に一覧の所を素早く2回押す（窓か暗い後ろに当たる） */
      go: async (times) => {
        await page.selectOption('#docList', OTHER.name);
        if (times === 2) { const c = await centerOf(page, '#docList'); if (c) await page.mouse.dblclick(c.x, c.y); }
        return true;
      },
      effect: async () => ((await cur()) === OTHER.name ? 1 : 0),
      kept: async () => (await cur()) === ME.name && !!(await unsaved()),
    });
    await drain(page);
    await dialogOp(env, page, SCR, '保存した図の削除', {
      prep: async () => {
        if (!(await has(page, OTHER.name)) || (await cur()) !== OTHER.name || (await unsaved())) {
          if (!(await saveAs(page, OTHER.name))) return false;
        }
        return !!(await has(page, OTHER.name)) && (await cur()) === OTHER.name;
      },
      go: (k) => pressAt(page, '#btnDelete', k),
      effect: async () => ((await has(page, OTHER.name)) ? 0 : 1),
      kept: async () => !!(await has(page, OTHER.name)) && !!(await ev(page, (nm) => JSON.parse(localStorage.getItem('genogram:index') || '[]').some((e) => e.name === nm), OTHER.name)),
    });
    tn(SCR, '保存した図の削除', 'もう1つの図は消えない', !!(await has(page, ME.name)));
    await page.close();
  } finally {
    endChecksQuiet(env, SCR);
    await env.context.close();
  }
}

/* 写しの見比べ: 「勤務表を写しの期間に戻す」（確かめが2つ続く・管理者だけ）。共通のデータベースの kv_set_family_mode の偽物は「変えた」と答え、呼ばれた数を数える */
async function flow8shadow() {
  const SCR = '写しの見比べ';
  /* 管理者＋2段階認証を通したログイン（my_account が mfa を返す）として開く */
  const env = await makeEnv({ sudCount: true, role: 'admin', rpc: { my_account: () => ({ role: 'admin', mfa: true }), kv_set_family_mode: () => ({ ok: true }) },
    tables: { master_residents: [], master_sync_runs: [] },
    /* 切り替える前の確かめが読む GitHub の試験の記録（読むだけ）も偽物が「記録なし」と答える＝外へは出ない */
    gas: [['https://api.github.com/', () => ({ total_count: 0, workflow_runs: [] }), 'github']] });
  const cnt = () => env.st.rpc.filter((r) => r.fn === 'kv_set_family_mode').length;
  try {
    const page = await open(env, 'shadow-check.html');
    const btn = '#b-shadow-shift';
    const ready = await waitFor(() => ev(page, (s) => { const b = document.querySelector(s); return !!(b && b.offsetParent && !b.disabled); }, btn), 20000);
    tn(SCR, '準備', '管理者として開き、「勤務表を写しの期間に戻す」が押せる', ready);
    if (ready) {
      await dialogOp(env, page, SCR, '勤務表を写しの期間に戻す', {
        steps: 2,
        prep: async () => !!(await ev(page, (s) => { const b = document.querySelector(s); return !!(b && b.offsetParent && !b.disabled); }, btn)),
        go: (k) => pressAt(page, btn, k),
        effect: async () => cnt(),
        kept: async () => !!(await ev(page, (s) => { const b = document.querySelector(s); return !!(b && b.offsetParent); }, btn)),
      });
      const fams = env.st.rpc.filter((r) => r.fn === 'kv_set_family_mode').map((r) => JSON.stringify(r.body));
      tn(SCR, '勤務表を写しの期間に戻す', '送ったのは勤務表を写しの期間に戻す変更だけ', fams.length > 0 && fams.every((f) => f === JSON.stringify({ p_families: ['shift'], p_mode: 'shadow' })));
    }
    await page.close();
  } finally {
    endChecksQuiet(env, SCR);
    await env.context.close();
  }
}

async function flow8() {
  console.log('\n— (8) 画面の中の窓: OK で先へ進み、キャンセルで何も変わらず、素早い二度押しで二重にならない —');
  /* 1つの画面で道具が止まっても、ほかの画面は続けて通す（落ちた時は画面の名前だけを出す） */
  for (const [scr, fn] of [['入居者マスタ', flow8master], ['体重管理', flow8weight], ['職員マスタ', flow8staff], ['家族構成図', flow8geno], ['写しの見比べ', flow8shadow]]) {
    try { await fn(); } catch (e) { tn(scr, '全体', '試験の道具が途中で止まらない', false); }
  }
}

try {
  const FLOWS = { 1: flow1, 2: flow2, 3: flow3, 4: flow4, 5: flow5, 6: flow6, 7: flow7, 8: flow8 };
  for (const [k, fn] of Object.entries(FLOWS)) if (!ONLY || ONLY.includes(k)) await fn();
} catch (e) {
  fail++;
  console.log('  ✗ 試験の道具が途中で止まりました  → ' + String(e && e.stack || e).slice(0, 800));
} finally {
  await browser.close();
  await srv.close();
}
console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
