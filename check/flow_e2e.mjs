/* check/flow_e2e.mjs — 業務の流れを通す試験（2026-11-02 新設）
 *
 *   node check/flow_e2e.mjs [--shots <保存先>]
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
 * どの流れも、画面のエラー（pageerror）が出たら失敗にする。成功で exit 0、1つでも落ちたら exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';
import * as F from './fixtures/flow.mjs';
import { seed as wsSeed } from './fixtures/work-schedule.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots ? path.resolve(args.shots) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
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

/* 1つの流れ＝1つのブラウザの文脈（端末1台）。偽物の通信の状態と、受けた要求の記録を持つ */
async function makeEnv({ device = 'office', kvSeed, extraStorage = {}, seedOnce = true } = {}) {
  const st = {
    master: F.createMaster(),
    kv: F.createKv(kvSeed || { care_schedule_v2: F.careDb() }),
    tp: F.createKv({}),
    req: [], sb: [], ext: [], errors: [], dialogs: [], ct: [], tag: '',
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
  /* 端末の設定は最初の1回だけ入れる（その後に画面が書いた値を上書きしない） */
  await context.addInitScript(({ s, once }) => {
    try {
      if (once && localStorage.getItem('__flow_seeded') === '1') return;
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      localStorage.setItem('__flow_seeded', '1');
    } catch (e) { /* 端末の控えが使えない時は何もしない */ }
  }, { s: { ...F.storage(device), tp_cfg: JSON.stringify({ url: TP_URL, token: 'check-flow' }), msk_cfg: JSON.stringify({ url: MSK_URL, token: 'check-flow' }), ...extraStorage }, once: seedOnce });
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
  const sbHandle = F.supabase(st);
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(srv.url + '/')) {
      if (/^[^?]*\/su-backend\.json(\?|$)/.test(u.slice(srv.url.length))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.FLAGS_OFF) });
      return route.continue();
    }
    if (u.startsWith(F.MASTER_URL)) return gas('master', st.master.respond)(route);
    if (u.startsWith(F.SYNC_URL)) return gas('sync', st.kv.respond)(route);
    if (u.startsWith(TP_URL)) return gas('tp', st.tp.respond)(route);
    if (u.startsWith(MSK_URL)) return gas('msk', mskRespond)(route);
    if (u.startsWith(F.SB + '/')) return sbHandle(route);
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
      const page = await open(env, 'genogram.html?resident=' + ME.id + '&name=' + encodeURIComponent(ME.name));
      const who = await waitFor(() => page.evaluate(() => { const e = document.getElementById('suHopBar'); return e && !e.hidden && e.querySelector('.srh') ? e.innerText : null; }));
      t('家族構成図（現場）: 開けて「' + ME.name + 'さんを開いています」', !!who && who.includes(ME.name + 'さんを開いています'), who);
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
}

try {
  await flow1();
  await flow2();
  await flow3();
  await flow4();
} catch (e) {
  fail++;
  console.log('  ✗ 試験の道具が途中で止まりました  → ' + String(e && e.stack || e).slice(0, 800));
} finally {
  await browser.close();
  await srv.close();
}
console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
