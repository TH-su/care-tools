/* check/revenue_e2e.mjs — 入居者マスタ「💴 収支の見通し」（2026-11-07 本人指示）を、本物の画面と架空の入居者16名で通して確かめる。
 *
 *   node check/revenue_e2e.mjs [--shots <撮影の置き場>]
 *
 * 確かめること:
 *   1. タブを押すと、グラフ・月ごとの表・今月の内訳が出る（施設情報の residenceFees の表・週間計画の報酬マスタの限度額を使う）
 *   2. 表の今月の合計＝画面の計算部品（RevenueCalc）に同じ入力を渡した値＝内訳の合計
 *   3. 入院/復帰の記録（stateLog）がある方は、2か月後の介護報酬が入院の日数ぶん減り、理由の欄に「入院 N日」と出る
 *   4. 入居予定を足すと、その月の施設の利用料（当月の日割り＋翌月分）が増え、2か月後に介護報酬の日割りが入る
 *   5. 入居者マスタ・週間計画へ書く要求を1本も送らない。端末に残すのは表示の選びと料金表だけ（氏名を残さない）
 *   6. 現場端末では出さない（週間計画も入院の記録も読まない）
 *   7. 印刷に出ない（@media print で消える）・横にはみ出さない（PC と iPhone の幅）
 * ★架空データだけ（CLAUDE.md §2-1）。通信は全部横取りし、外へは出ない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, parseArgs, loadPlaywright } from './lib.mjs';
import * as fx from './fixtures/resident-master.mjs';

const { chromium } = loadPlaywright();
const args = parseArgs(process.argv.slice(2));
const shots = args.shots || '';
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } };

const CS_URL = 'https://script.google.com/macros/s/CHECK-CS-DUMMY/exec';
const LIMITS = { '要支援1': 5032, '要支援2': 10531, '要介護1': 16765, '要介護2': 19705, '要介護3': 27048, '要介護4': 30938, '要介護5': 36217 };
/* 週間計画の報酬マスタ（割合を数える表だけ）と、名簿の1人目・2人目の予定（架空）。
   1人目＝訪問（身体１）週2回＋通所（4時間ちょうど＝3h）週1回、2人目＝通所だけ。3人目以降は週間計画に予定なし */
const RM = { careLimits: LIMITS, feePerUnit: 10, visitBase: { '身体１': 244 }, daycareBase: {
  '要介護1': { '3h': 370 }, '要介護2': { '3h': 423 }, '要介護3': { '3h': 479 }, '要介護4': { '3h': 533 }, '要介護5': { '3h': 588 } } };
function csResidents() {
  const ro = fx.respond({ action: 'getRoster' }).roster;
  const dc = { serviceType: 'daycare', startTime: '09:00', endTime: '13:00', dayOfWeek: 2 };
  return [
    { name: ro[0].name, masterId: ro[0].id, careLevel: ro[0].careLevel, events: [{ serviceType: 'visit', category: '身体１', dayOfWeek: 0 }, { serviceType: 'visit', category: '身体１', dayOfWeek: 3 }, dc] },
    { name: ro[1].name, masterId: ro[1].id, careLevel: ro[1].careLevel, events: [dc] },
  ];
}
const sample = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'facility-profile.sample.json'), 'utf8'));
const NOW = new Date('2026-11-07T10:00:00+09:00');
const RM_DC = { '要介護1': 370, '要介護2': 423, '要介護3': 479, '要介護4': 533, '要介護5': 588 };

const srv = await startServer(process.cwd(), 0);
const browser = await chromium.launch();
async function open(role, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const sent = [];
  let roster = null;
  await ctx.route(fx.match, (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* 本文の無い要求 */ }
    sent.push(body.action);
    let res = fx.respond(body);
    /* 1人目（架空）に入院の記録を持たせる: 9/11 入院 → 9/21 戻る（10日）。2人目は今入院中（10/30〜） */
    if (body.action === 'getRoster' && res && res.roster) roster = res.roster;
    if (body.action === 'getResident' && res && res.record && roster) {
      if (String(body.id) === String(roster[0].id)) res.record.stateLog = [
        { ts: '2026-09-21T01:00:00Z', field: 'hospitalized', val: false, src: 'master' },
        { ts: '2026-09-11T01:00:00Z', field: 'hospitalized', val: true, src: 'master' }];
      if (String(body.id) === String(roster[1].id)) { res.record.hospitalized = true; res.record.hospitalizedAt = '2026-10-30T01:00:00Z'; res.record.stateLog = [{ ts: '2026-10-30T01:00:00Z', field: 'hospitalized', val: true }]; }
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  await ctx.route('https://script.google.com/macros/s/CHECK-CS-DUMMY/**', (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* なし */ }
    sent.push('cs:' + body.action + ':' + (body.key || ''));
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, data: { residents: csResidents(), rateMaster: RM } }) });
  });
  await ctx.route('**/facility-profile.json*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sample) }));
  for (const rt of (fx.routes || [])) await ctx.route(rt.match, rt.handle);
  const st = Object.assign({}, fx.storage, { su_device_role: role || 'office', su_sync_common: JSON.stringify({ endpoint: CS_URL, token: 'check-dummy' }) });
  await ctx.addInitScript((s) => { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); }, st);
  const p = await ctx.newPage();
  await p.clock.setFixedTime(NOW);
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e && e.message)));
  await p.goto(srv.url + '/resident-master.html', { waitUntil: 'load' });
  return { ctx, p, sent, errs };
}

try {
  /* ── 事務所PC ── */
  const { ctx, p, sent, errs } = await open('office', 1280);
  await p.waitForFunction(() => window.roster && roster.length > 0, null, { timeout: 20000 });
  await p.click('.vtab[data-v="rev"]');
  await p.waitForSelector('#revRoot .rev-tbl tbody tr', { timeout: 20000 });
  await p.waitForFunction(() => window.REV && REV.st && !REV.stLoading && window.bkRows && window.csRateMaster_, null, { timeout: 30000 });
  await p.waitForTimeout(300);
  t('1. グラフ・月ごとの表（半年前の5か月＋今月から先12か月＝17か月）・内訳が出る', await p.$('#revRoot svg.rev-svg') && (await p.$$('#revRoot .rev-tbl:not(.det) tbody tr')).length === 17 && await p.$('#revRoot .rev-tbl.det tbody tr'));
  const warn = await p.$eval('#revRoot', (el) => (el.querySelector('.rev-warn') || {}).textContent || '');
  t('1b. 料金表（施設情報）と週間計画の限度額が使えている（知らせの帯に料金表・限度額の文が無い）', !/利用料の表が入っていません|全国の既定/.test(warn), warn);
  const prem = await p.$eval('#revRoot .rev-prem', (el) => el.textContent);
  t('1c. 計算の前提の欄も「週間計画の報酬マスタ」になる（読み終えた後に古い文が残らない）', /週間計画の報酬マスタ/.test(prem) && !/全国の既定/.test(prem));
  const chk = await p.evaluate(() => {
    const o = revCompute_(), M = o.months.find((x) => x.ym === '2026-11');
    const firstRow = document.querySelector('#revRoot .rev-tbl:not(.det) tbody tr[data-ym="2026-11"] td.tot').textContent;
    const det = [...document.querySelectorAll('#revRoot .rev-tbl.det tbody tr td.tot')].reduce((s, td) => s + Number(td.textContent.replace(/[^\d]/g, '')), 0);
    return { total: M.total, shown: Number(firstRow.replace(/[^\d]/g, '')), det, src: o.F.src, fromSch: o.L.fromSchedule };
  });
  t('2. 表の今月の合計＝計算部品の値＝内訳の合計', chk.total > 0 && chk.total === chk.shown && chk.total === chk.det && chk.src === 'facility' && chk.fromSch, chk);

  /* 8. 表示の始まり・折れ線・訪問と通所（2026-11-07 本人指示） */
  const st8 = await p.evaluate(() => ({ first: document.querySelector('#revRoot .rev-tbl:not(.det) tbody tr').getAttribute('data-ym'),
    sel: (document.querySelector('#revRoot .rev-tbl:not(.det) tbody tr.on') || {}).getAttribute && document.querySelector('#revRoot .rev-tbl:not(.det) tbody tr.on').getAttribute('data-ym'),
    pts: (document.querySelector('#revRoot polyline.fline') || { getAttribute: () => '' }).getAttribute('points').trim().split(/\s+/).length,
    dots: document.querySelectorAll('#revRoot circle.fdot').length, now: !!document.querySelector('#revRoot line.now') }));
  t('8. 既定の表示の始まりは半年前（11月なら6月）・選んでいる月は今月', st8.first === '2026-06' && st8.sel === '2026-11', st8);
  t('8b. 施設の利用料は同じグラフの折れ線（17か月ぶんの点）・今月の印', st8.pts === 17 && st8.dots === 17 && st8.now, st8);
  const fac = await p.evaluate(() => { const o = revCompute_(); return o.months.map((M) => M.facility); });
  const lineY = await p.evaluate(() => document.querySelector('#revRoot polyline.fline').getAttribute('points').trim().split(/\s+/).map((q) => +q.split(',')[1]));
  t('8c. 折れ線の高さの並びが施設の利用料の大小と同じ向き', fac.every((v, i) => i === 0 || Math.sign(fac[i - 1] - v) === Math.sign(lineY[i] - lineY[i - 1]) || fac[i - 1] === v), { fac, lineY });
  await p.focus('#revRoot input[data-rev="split"]');
  await p.check('#revRoot input[data-rev="split"]');
  await p.waitForSelector('#revRoot .rev-tbl:not(.det) thead th:nth-child(4)');
  const sp = await p.evaluate(() => {
    const o = revCompute_(), M = o.months.find((x) => x.ym === '2026-11');
    const id0 = String(roster[0].id), id1 = String(roster[1].id), id2 = String(roster[2].id);
    const r0 = M.rows.find((r) => r.key === id0), r1 = M.rows.find((r) => r.key === id1), r2 = M.rows.find((r) => r.key === id2);
    const heads = [...document.querySelectorAll('#revRoot .rev-tbl:not(.det) thead th')].map((th) => th.textContent);
    return { sum: M.careVisit + M.careDay + M.careOther === M.care, s0: r0 && r0.visitShare, s1: r1 && r1.visitShare, s2: r2 ? r2.visitShare : 'x', heads, legend: !!document.querySelector('#revRoot .rev-leg .sw.d'), ui: JSON.parse(localStorage.getItem('rmaster_rev_ui')).split };
  });
  const lv0 = await p.evaluate(() => RevenueCalc.normLevel(roster[0].careLevel));
  const exp0 = (244 * 2) / (244 * 2 + RM_DC[lv0]);
  t('8d. 訪問と通所に分けると、表に訪問・通所・分けられない分の列が出て、足すと介護報酬', sp.sum && sp.heads.includes('訪問') && sp.heads.includes('通所') && sp.heads.includes('分けられない分') && sp.legend && sp.ui === true, sp);
  t('8e. 割合は週間計画の予定の基本単位から（1人目＝訪問2回と通所1回・2人目＝通所だけ＝0・予定の無い方＝分けられない）', Math.abs(sp.s0 - exp0) < 1e-9 && sp.s1 === 0 && sp.s2 === null, { sp, exp0 });
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, 'rev-split.png'), fullPage: true }); }
  await p.focus('#revRoot select[data-rev="startBack"]');
  await p.selectOption('#revRoot select[data-rev="startBack"]', '0');
  await p.waitForFunction(() => document.querySelector('#revRoot .rev-tbl:not(.det) tbody tr').getAttribute('data-ym') === '2026-11');
  t('8f. 表示の始まりを「今月から」に変えられ、端末に残る', JSON.parse(await p.evaluate(() => localStorage.getItem('rmaster_rev_ui'))).startBack === 0);
  await p.selectOption('#revRoot select[data-rev="startBack"]', '5');
  await p.uncheck('#revRoot input[data-rev="split"]');

  /* 3. 入院の記録: 1人目は9月に10日入院 → 11月の入金（9月分）が減る */
  const hosp = await p.evaluate(() => {
    const o = revCompute_(), M = o.months.find((x) => x.ym === '2026-11'), id = String(roster[0].id), r = M.rows.find((x) => x.key === id);
    const id2 = String(roster[1].id), M1 = o.months.find((x) => x.ym === '2027-01'), r2 = M1.rows.find((x) => x.key === id2);
    return { absent: r && r.svcAbsent, lost: r && r.careLostAbsent, r2abs: r2 && r2.svcAbsent, monthLost: M.careLostAbsent };
  });
  t('3. 入院の記録（9/11〜9/20）で11月の入金が10日分減る', hosp.absent === 10 && hosp.lost > 0 && hosp.monthLost >= hosp.lost, hosp);
  t('3b. 今入院中で戻る日が分からない方は「今月末に戻る」とみなす（11月分＝1月の入金で入院は11月の30日のうち10/30〜の分）', hosp.r2abs === 30, hosp);
  await p.click('#revRoot tr[data-ym="2026-11"]');
  const why = await p.$eval('#revRoot .rev-tbl.det', (el) => el.textContent);
  t('3c. 11月の内訳の理由に「入院 10日」が出る', /入院 10日/.test(why));

  /* 4. 入居予定を足す（12/10・要介護3） */
  const before = await p.evaluate(() => { const o = revCompute_(), g = (ym) => o.months.find((x) => x.ym === ym); return { dec: g('2026-12').facility, feb: g('2027-02').care }; });
  await p.focus('#revPType');
  await p.selectOption('#revPType', 'in');
  await p.selectOption('#revPLv', '要介護3');
  await p.fill('#revPDate', '2026-12-10');
  await p.click('[data-rev="addplan"]');
  await p.waitForSelector('#revRoot .rev-plist li');
  const after = await p.evaluate(() => { const o = revCompute_(), g = (ym) => o.months.find((x) => x.ym === ym); return { dec: g('2026-12').facility, feb: g('2027-02').care }; });
  const fee3 = sample.residenceFees.monthly['要介護3'];
  t('4. 12月の施設の利用料の入金が「12月の日割り（22/31）＋1月分」増える', after.dec - before.dec === Math.round(fee3 * 22 / 31) + fee3, { before, after });
  t('4b. 2か月後（2月）の入金に12月分の介護報酬の日割り（5日以降なので差し引かない）', after.feb - before.feb === Math.round(LIMITS['要介護3'] * 22 / 31 * 10), { before, after });

  /* 5. 書かない・残さない */
  const writes = sent.filter((a) => a && !/^(getRoster|getBulk|getResident|stateRev|ping|getMealList|getListFull|getMedDict|getSection|getMedsBulk|cs:get:care_schedule_v2)$/.test(a));
  t('5. 入居者マスタ・週間計画へ書く要求が0本', writes.length === 0, writes);
  const ls = await p.evaluate(() => ({ ui: localStorage.getItem('rmaster_rev_ui'), fees: localStorage.getItem('rmaster_rev_fees'), all: Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).join('\n') }));
  const names = await p.evaluate(() => roster.map((r) => r.name));
  t('5b. 端末に氏名を残していない（収支の見通しの鍵にも名簿の氏名が入っていない）', !names.some((n) => (ls.ui || '').includes(n) || (ls.fees || '').includes(n)));
  await p.focus('#revRoot select[data-rev="months"]');   /* 実機では選んだ時にフォーカスが残る（反証レビュー指摘1） */
  await p.selectOption('#revRoot select[data-rev="months"]', '6');
  await p.waitForFunction(() => document.querySelectorAll('#revRoot .rev-tbl:not(.det) tbody tr').length === 11);
  /* 前提の数字を入力中（フォーカスあり）に Enter で確定しても描き直す（反証レビュー指摘1） */
  const bLost = await p.evaluate(() => revCompute_().months[0].care);
  await p.fill('#revRoot input[data-k="deduct"]', '3000');
  await p.press('#revRoot input[data-k="deduct"]', 'Enter');
  await p.waitForTimeout(200);
  const shownNow = await p.$eval('#revRoot .rev-tbl:not(.det) tbody tr td.tot', (td) => Number(td.textContent.replace(/[^\d]/g, '')));
  const calcNow = await p.evaluate(() => revCompute_().months[0].total);
  t('5d. 差し引く単位を入力して確定すると、すぐ表が変わる（入力中の守りに止められない）', shownNow === calcNow && (await p.evaluate(() => revCompute_().months[0].care)) < bLost, { shownNow, calcNow });
  await p.fill('#revRoot input[data-k="deduct"]', '2000');
  await p.press('#revRoot input[data-k="deduct"]', 'Enter');
  /* 2回目の審査の指摘: 金額を入れて Tab で次の欄へ移れる・裏の描き直しで入れかけの予定が消えない */
  await p.focus('#revRoot input[data-lv="要支援1"]');
  await p.keyboard.type('90000');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(150);
  const fk = await p.evaluate(() => { const a = document.activeElement; return a && a.getAttribute('data-lv'); });
  t('5e. 金額を入れて Tab を押すと次の欄（要支援2）へ移る（描き直しで入力欄から外れない）', fk === '要支援2', fk);
  await p.selectOption('#revPType', 'out');
  await p.fill('#revPDate', '2027-01-15');
  await p.evaluate(() => { renderRoster(); });
  await p.waitForTimeout(100);
  const kept = await p.evaluate(() => ({ ty: document.getElementById('revPType').value, d: document.getElementById('revPDate').value }));
  t('5f. 1分ごとの読み直し（renderRoster）が走っても、入れかけの予定（種類・日付）が消えない', kept.ty === 'out' && kept.d === '2027-01-15', kept);
  await p.evaluate(() => { REV.force = true; renderRoster(); });
  const kept2 = await p.evaluate(() => ({ ty: document.getElementById('revPType').value, d: document.getElementById('revPDate').value }));
  t('5g. 画面を作り直しても、入れかけの予定はメモリの控えから戻る', kept2.ty === 'out' && kept2.d === '2027-01-15', kept2);
  await p.evaluate(() => { REV.form = {}; localStorage.removeItem('rmaster_rev_fees'); REV.force = true; renderRoster(); });
  t('5c. 期間の選びは端末に残る（読み込み直しても6か月）', JSON.parse(await p.evaluate(() => localStorage.getItem('rmaster_rev_ui'))).months === 6);

  /* 7. 印刷に出ない・はみ出さない */
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, 'rev-pc.png'), fullPage: true }); }
  await p.emulateMedia({ media: 'print' });
  t('7. 印刷では収支の見通しを出さない', await p.$eval('#revRoot', (el) => getComputedStyle(el).display) === 'none');
  await p.emulateMedia({ media: 'screen' });
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('7b. PC の幅で横にはみ出さない', ov <= 0, ov);
  t('7c. 画面の例外0件', errs.length === 0, errs);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#revRoot .rev-tbl tbody tr', { timeout: 20000 });
  t('7d. 読み込み直しても収支の見通しのまま（原則11）', await p.$eval('.vtab[data-v="rev"]', (b) => b.getAttribute('aria-selected')) === 'true');
  await ctx.close();

  /* iPhone の幅 */
  {
    const o2 = await open('office', 390);
    await o2.p.waitForFunction(() => window.roster && roster.length > 0, null, { timeout: 20000 });
    await o2.p.evaluate(() => setView('rev'));
    await o2.p.waitForSelector('#revRoot .rev-tbl tbody tr', { timeout: 20000 });
    await o2.p.waitForTimeout(800);
    const ov2 = await o2.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('7e. iPhone の幅（390px）で横にはみ出さない（表は枠の中で横に送る）', ov2 <= 0, ov2);
    const small = await o2.p.evaluate(() => [...document.querySelectorAll('#revRoot button, #revRoot select, #revRoot input')].filter((el) => el.offsetParent && (el.type === 'checkbox' ? el.closest('label') : el).getBoundingClientRect().height < 44)   /* チェックボックスは押せる範囲＝ラベル全体で測る */.map((el) => el.outerHTML.slice(0, 80)));
    t('7f. iPhone の幅で押す所は高さ44px以上', small.length === 0, small);
    if (shots) await o2.p.screenshot({ path: path.join(shots, 'rev-iphone.png'), fullPage: true });
    await o2.ctx.close();
  }

  /* 6. 現場端末 */
  {
    const o3 = await open('field', 1280);
    await o3.p.waitForTimeout(1500);
    await o3.p.evaluate(() => { try { setView('rev'); } catch (e) { /* 止めの画面 */ } });
    await o3.p.waitForTimeout(1500);
    const csRead = o3.sent.filter((a) => /^cs:|getResident|getBulk/.test(a || ''));
    t('6. 現場端末では週間計画・入院の記録・入居日を読まない', csRead.length === 0, csRead);
    await o3.ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log('\n合格 ' + pass + ' ／ 不合格 ' + fail);
process.exit(fail ? 1 : 0);
