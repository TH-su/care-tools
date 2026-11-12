/* check/yakujo_review_e2e.mjs — 入居者マスタの「薬情の見直し」（2026-11-11 代表者の決定）を、本物の画面（resident-master.html）と
 * 架空の入居者・架空の反映記録で通して確かめる。
 *
 *   node check/yakujo_review_e2e.mjs [--shots <撮影の置き場>]
 *
 * 確かめること:
 *   1. まとめて反映で消した方の詳細画面の「薬剤情報」の欄の頭に「⚠ 見直してください：まとめて反映（日時・確かめた人）」が出る。
 *      足すだけ・見直した・7日を過ぎた記録には出ない
 *   2. 「見直した」は確認の窓の後に medCand 'yjReview'（番号・印・時刻・ログインの証明）を1回送り、通れば印が消える。
 *      断られた時は職員に分かる文で出し、印は残す
 *   3. 印は紙に出さない（@media print で消える）・現場の端末では出さない
 *   4. 管理者の一覧は、見直し待ちと完全入れ替えの記録を出し、メニューの札の控え（rm_yjrev_due）に件数と日付だけを書く
 * ★架空データだけ（CLAUDE.md §2-1）。通信は全部横取りし、外へは出ない。ログインの証明は架空の文字列を返す。
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

const NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const STOP = '中止｜（書類に無い今の行）｜（中止）', ADD = '足す｜見本D錠｜見本D錠 1錠 朝食後';
const LOG = {
  R01: [
    { at: iso(NOW - 3600000), id: 'R01', srcKey: 'S|R01|2026-11-11|0000000a', srcDate: '2026-11-11', docRows: STOP, before: '見本A錠 1錠 朝食後\n見本B錠 1錠 夕食後',
      after: '見本A錠 1錠 朝食後', by: 'adm@example.invalid', how: 'まとめて反映', reviewedAt: '', reviewedBy: '' },
    { at: iso(NOW - 7200000), id: 'R01', srcKey: 'S|R01|2026-11-10|0000000b', srcDate: '2026-11-10', docRows: ADD, before: '', after: '見本D錠 1錠 朝食後',
      by: 'adm@example.invalid', how: 'まとめて反映', reviewedAt: '', reviewedBy: '' },
    { at: iso(NOW - 8 * 86400000), id: 'R01', srcKey: 'S|R01|2026-11-03|0000000c', srcDate: '2026-11-03', docRows: STOP, before: '見本E錠\n見本F錠', after: '見本E錠',
      by: 'adm@example.invalid', how: 'まとめて反映', reviewedAt: '', reviewedBy: '' },
  ],
  R02: [
    { at: iso(NOW - 3600000), id: 'R02', srcKey: 'S|R02|2026-11-11|0000000d', srcDate: '2026-11-11', docRows: STOP, before: '見本A錠\n見本G錠', after: '見本A錠',
      by: 'adm@example.invalid', how: 'まとめて反映', reviewedAt: iso(NOW - 600000), reviewedBy: 'nurse@example.invalid' },
  ],
};
const AUDIT = [].concat(LOG.R01, LOG.R02, [
  { at: '2026-11-10T13:30:00.000Z', id: 'R03', srcKey: 'S|R03|2026-11-10|0000000e', srcDate: '2026-11-10', docRows: STOP, before: '見本H錠\n見本I錠', after: '見本H錠',
    by: 'adm@example.invalid', how: '', reviewedAt: '', reviewedBy: '' },
]);

const srv = await startServer(process.cwd(), 0);
const browser = await chromium.launch();
async function run(opts) {
  const sent = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.route(fx.match, (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* 本文の無い要求 */ }
    let res;
    if (body.action === 'medCand' && body.op === 'yjLog') res = { ok: true, rows: JSON.parse(JSON.stringify(LOG[body.id] || [])) };
    else if (body.action === 'medCand' && body.op === 'yjAudit') { sent.push(body); res = { ok: true, rows: JSON.parse(JSON.stringify(AUDIT)), more: false }; }
    else if (body.action === 'medCand' && body.op === 'yjReview') { sent.push(body); res = opts.review || { ok: true, reviewedAt: new Date().toISOString(), reviewedBy: 'nurse@example.invalid' }; }
    else res = fx.respond(body);
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  for (const rt of (fx.routes || [])) await ctx.route(rt.match, rt.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, Object.assign({}, fx.storage, opts.storage || {}));
  const p = await ctx.newPage();
  const errors = [], dialogs = [];
  p.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  p.on('dialog', (d) => { dialogs.push(d.message()); (opts.decline ? d.dismiss() : d.accept()).catch(() => {}); });
  /* 2026-11-13: 確かめは画面の中の窓（su-dialog.js）になった。出た窓の文を同じ dialogs に記録し、同じ答え（OK／キャンセル）を押す（確かめる中身は同じ） */
  await p.exposeFunction('__sudSeen', (m) => { dialogs.push(m); });
  await p.addInitScript((decline) => {
    new MutationObserver(() => {
      const g = document.querySelector('dialog.sud-dlg[open]');
      if (!g || g.__seen) return;
      g.__seen = true;
      window.__sudSeen((g.querySelector('.sud-msg') || {}).textContent || '');
      setTimeout(() => { const b = g.querySelector(decline ? '.sud-btn:not(.pri)' : '.sud-btn.pri'); if (b) b.click(); }, 0);
    }).observe(document, { subtree: true, childList: true, attributes: true });
  }, !!opts.decline);
  await p.goto(srv.url + '/resident-master.html', { waitUntil: 'load' });
  if (opts.field) await p.waitForFunction(() => typeof window.yrSlot_ === 'function', null, { timeout: 20000 });
  else await p.waitForFunction(() => Array.isArray(window.roster) && window.roster.length >= 6, null, { timeout: 20000 });
  await p.evaluate(() => { window.rmAccessToken_ = function () { return Promise.resolve('check-token'); }; });
  return { p, ctx, sent, errors, dialogs };
}
const openR = async (p, id) => {
  await p.evaluate((x) => window.openResident(x), id);
  await p.waitForFunction((x) => { const s = document.getElementById('yrSlot'); return s && s.getAttribute('data-id') === x && window.yjlMem && window.yjlMem.id === x && window.yjlMem.rows; }, id, { timeout: 15000 });
};

try {
  /* 1. 印 */
  let r = await run({});
  await openR(r.p, 'R01');
  const marks = await r.p.$$eval('#yrSlot .yr-mark', (els) => els.map((e) => e.textContent));
  t('★まとめて反映で消した記録だけに印（足すだけ・8日前の記録は出さない）', marks.length === 1, marks);
  t('★印の文言「⚠ 見直してください：まとめて反映（日時・確かめた人 …）」', /^⚠ 見直してください：まとめて反映（\d{4}-\d{2}-\d{2} \d{2}:\d{2}・確かめた人 adm@example\.invalid）/.test(marks[0] || ''), marks[0]);
  t('★消えた行（見本B錠）を出す', /定期薬から無くなった行：見本B錠 1錠 夕食後/.test(marks[0] || ''), marks[0]);
  const inMeds = await r.p.evaluate(() => { const s = document.getElementById('yrSlot'); const sec = s && s.closest('.sec'); const l = sec && sec.querySelector('.sec-lbl'); return l ? l.textContent : ''; });
  t('★印は「薬剤情報」の欄の中', inMeds === '薬剤情報', inMeds);
  await r.p.emulateMedia({ media: 'print' });
  const printShown = await r.p.evaluate(() => { const s = document.getElementById('yrSlot'); return s ? getComputedStyle(s).display : 'none'; });
  await r.p.emulateMedia({ media: 'screen' });
  t('★紙には出さない（@media print で消える）', printShown === 'none', printShown);
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await (await r.p.$('#yrSlot')).screenshot({ path: path.join(shots, 'yr-mark.png') }); }

  /* 2. 見直した */
  await r.p.click('#yrSlot .yr-done');
  await r.p.waitForFunction(() => !document.querySelector('#yrSlot .yr-mark'), null, { timeout: 10000 });
  const rv = r.sent.filter((b) => b.op === 'yjReview');
  t('★確認の窓は1回', r.dialogs.length === 1 && /見直しましたか/.test(r.dialogs[0]), r.dialogs);
  t('★送るのは番号・印・時刻・ログインの証明（1回だけ）', rv.length === 1 && rv[0].id === 'R01' && rv[0].srcKey === 'S|R01|2026-11-11|0000000a' && rv[0].at === LOG.R01[0].at && rv[0].accessToken === 'check-token', rv);
  t('★通れば印が消える', (await r.p.$$('#yrSlot .yr-mark')).length === 0);
  await openR(r.p, 'R02');
  t('★見直した記録には印が出ない', (await r.p.$$('#yrSlot .yr-mark')).length === 0);
  t('画面の JS エラーなし', r.errors.length === 0, r.errors);
  await r.ctx.close();

  /* 2b. 断られた時 */
  r = await run({ review: { ok: false, denied: true, error: 'x' } });
  await openR(r.p, 'R01');
  await r.p.click('#yrSlot .yr-done');
  await r.p.waitForFunction(() => /管理者が「アプリの使える人」の「薬の見直し」で許した方だけ/.test((document.getElementById('yrSlot') || {}).textContent || ''), null, { timeout: 10000 });
  t('★断られた時は分かる文で出し、印は残す', (await r.p.$$('#yrSlot .yr-mark')).length === 1);
  await r.ctx.close();

  /* 2c. 確認の窓で取り消すと送らない */
  r = await run({ decline: true });
  await openR(r.p, 'R01');
  await r.p.click('#yrSlot .yr-done');
  await r.p.waitForTimeout(500);
  t('★確認の窓で取り消すと送らない', r.sent.filter((b) => b.op === 'yjReview').length === 0 && (await r.p.$$('#yrSlot .yr-mark')).length === 1);
  await r.ctx.close();

  /* 3a. ページを開いた時の札の数は、数だけの口（countOnly）で読む（記録の中身を読まない） */
  r = await run({});
  await r.p.evaluate(() => window.yrCountLoad_());
  await r.p.waitForFunction(() => !!localStorage.getItem('rm_yjrev_due'), null, { timeout: 10000 });
  t('★札の数は countOnly の口で読み、一覧（yrAudit）はメモリに持たない', r.sent.some((b) => b.op === 'yjAudit' && b.countOnly === true) && await r.p.evaluate(() => window.yrAudit === null));
  await r.ctx.close();

  /* 3. 管理者の一覧とメニューの札 */
  r = await run({});
  await r.p.evaluate(() => { document.getElementById('yrOpen').hidden = false; window.yrOpen_(); });
  await r.p.waitForFunction(() => /見直し待ち \d+ 件/.test((document.getElementById('yrBody') || {}).textContent || ''), null, { timeout: 10000 });
  const body = await r.p.textContent('#yrBody');
  /* R03（11/10 夜の自動の中止の期間）は 11/17 22:30 まで印が出る。それ以後にこの試験を回した時は R01 だけ */
  const want = 1 + (Date.now() < Date.parse('2026-11-10T13:30:00.000Z') + 7 * 86400000 ? 1 : 0);
  t('★見直し待ち（R01 のまとめて反映・7日以内なら R03 の自動の中止の期間。足すだけ・見直した・8日前は数えない）', new RegExp('見直し待ち ' + want + ' 件').test(body), body.slice(0, 400));
  t('★完全入れ替えの一覧に、自動の中止の期間の記録（R03）が出る', /完全入れ替えで定期薬を消した反映 1 件/.test(body) && /R03/.test(body) && /自動の中止の期間（中止 1行）/.test(body) && /見本I錠/.test(body), body);
  const due = await r.p.evaluate(() => localStorage.getItem('rm_yjrev_due'));
  t('★メニューの札の控えは件数と日付と管理者の印だけ', new RegExp('^\\{"v":1,"at":"\\d{4}-\\d{2}-\\d{2}","admin":true,"review":' + want + '\\}$').test(due || ''), due);
  t('★一覧は管理者の口（yjAudit）にログインの証明を添えて読む', r.sent.some((b) => b.op === 'yjAudit' && b.accessToken === 'check-token'));
  await r.p.emulateMedia({ media: 'print' });
  const mp = await r.p.evaluate(() => getComputedStyle(document.getElementById('mYjRev')).display);
  await r.p.emulateMedia({ media: 'screen' });
  t('★一覧は紙に出さない', mp === 'none', mp);
  if (shots) await r.p.screenshot({ path: path.join(shots, 'yr-audit.png'), fullPage: false });
  await r.p.click('#mYjRev .yr-go');
  await r.p.waitForFunction(() => !document.getElementById('mYjRev').classList.contains('on'), null, { timeout: 5000 });
  t('「開く」で一覧を閉じてその方を開く', await r.p.evaluate(() => window.curResident && /^R0[1-3]$/.test(String(window.curResident.id))));
  t('画面の JS エラーなし（一覧）', r.errors.length === 0, r.errors);
  await r.ctx.close();

  /* 3b. 入口の門（yjGate_）: ログインの確かめ（SUAuth.check）の答えで、管理者の時だけ「🔎 薬情の見直し」を出し、札の数を読む。
     ほかの答え（事務所・2段階認証の前・ログインしていない・確かめられない）では出さず、全員分の記録も札の数も読まない。
     ★確かめの答えだけを差し替え、門そのもの（yjGate_）は画面の本物を通す */
  for (const [label, st, want] of [
    ['管理者', { status: 'ok', role: 'admin', email: 'adm@example.invalid' }, true],
    ['事務所', { status: 'ok', role: 'office', email: 'office@example.invalid' }, false],
    ['2段階認証の前の管理者', { status: 'mfa_verify', role: 'admin', email: 'adm@example.invalid' }, false],
    ['ログインしていない', { status: 'signed_out' }, false],
    ['確かめられない', { status: 'error' }, false],
  ]) {
    r = await run({});
    await r.p.evaluate((a) => {
      window.SUAuth = Object.assign({}, window.SUAuth || {}, { STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out', ERROR: 'error' }, check: function () { return Promise.resolve(a); } });
      window.yjGate_();
    }, st);
    await r.p.waitForTimeout(800);
    const shown = await r.p.evaluate(() => !document.getElementById('yrOpen').hidden);
    const asked = r.sent.filter((b) => b.op === 'yjAudit');
    t('★入口の門: ' + label + 'は「🔎 薬情の見直し」を' + (want ? '出し、札の数だけを読む（countOnly）' : '出さず、記録を読まない'),
      shown === want && (want ? asked.length === 1 && asked[0].countOnly === true : asked.length === 0), { shown, asked: asked.map((b) => b.countOnly) });
    await r.ctx.close();
  }
  /* 3c. 現場の端末では、管理者の答えでも門を開けない */
  r = await run({ field: true, storage: { su_device_role: 'field' } });
  await r.p.evaluate(() => {
    window.SUAuth = Object.assign({}, window.SUAuth || {}, { STATUS: { OK: 'ok' }, check: function () { return Promise.resolve({ status: 'ok', role: 'admin', email: 'adm@example.invalid' }); } });
    if (typeof window.yjGate_ === 'function') window.yjGate_();
  });
  await r.p.waitForTimeout(800);
  t('★入口の門: 現場の端末では管理者でも出さず、記録を読まない', await r.p.evaluate(() => { const b = document.getElementById('yrOpen'); return !b || b.hidden; }) && r.sent.filter((b) => b.op === 'yjAudit').length === 0);
  await r.ctx.close();

  /* 4. 現場の端末では出さない */
  r = await run({ field: true, storage: { su_device_role: 'field' } });
  const fieldSlot = await r.p.evaluate(() => typeof window.yrSlot_ === 'function' ? window.yrSlot_({ id: 'R01' }) : 'nofn');
  t('★現場の端末では印の枠を作らない', fieldSlot === '', fieldSlot);
  await r.ctx.close();
} finally {
  await browser.close();
  await srv.close();
}
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
