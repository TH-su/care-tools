/* check/yakujo_bulk_e2e.mjs — 入居者マスタ「📥 薬情の取り込み」のまとめて反映（半自動・2026-11-04 代表者の決定）を、
 * 本物の画面（resident-master.html）と架空の入居者・架空の薬情で通して確かめる。
 *
 *   node check/yakujo_bulk_e2e.mjs [--shots <撮影の置き場>]
 *
 * 確かめること:
 *   1. 問題の無い書類（氏名の一字一致・調剤日1つ・⚠ 無し・変わる行が上限まで）の方だけが「まとめて反映できる方」に出る
 *   2. ⚠ のある書類の方は1人ずつに回り、理由が出る。変更の無い書類は「変更なし」に出る
 *   3. まとめて反映は確認の窓1回で、対象の方だけを medCand 'apply'（1人ずつと同じ形）で1回ずつ送る。書類に無い今の薬は残す
 *   4. チェックを外した方は送らない。食い違い（conflict）が返った方は1人ずつへ回る（何も書かない）
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

/* 架空の今の定期薬（3名）。R01 は1行変わって1行足す・R02 は読めない薬がある・R03 は書類と同じ */
/* R01 は1行変わって1行足す・R02 は読めない薬がある・R03 は書類と同じ・R04 は1行変わり、書類に無い今の薬を残す */
const MEDS = {
  R01: 'マグミット錠250mg 1回1錠 朝食後',
  R02: 'マグミット錠250mg 1回1錠 朝食後',
  R03: null,   // 1回目の組み立ての結果を見て決める（同じ行にする）
  R04: 'マグミット錠250mg 1回1錠 朝食後\n架空ロール錠5mg「見本」 1回1錠 夕食後',
  R05: 'マグミット錠250mg 1回1錠 朝食後\n架空ロール錠5mg「見本」 1回1錠 夕食後',
};
const L = (t, x, y, w) => ({ t, x, y, w: w || 0.4, h: 0.02, c: 1 });
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAsIAAEAAQEBEQD/xAAUAAEAAAAAAAAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwBH/9k=';   // 1画素の白い画像（架空）
const page = (name, kana, drugs) => ({ no: 1, w: 1000, h: 1400, img: IMG, codes: { qr: 0, other: 0 }, lines: [
  L(name + ' 様', 0.1, 0.05), L(kana, 0.1, 0.07), L('調剤日 2026年11月01日', 0.5, 0.05),
  ...drugs.flatMap((d, i) => [L('Rp' + (i + 1) + ' ' + d[2] + ' 14日分', 0.1, 0.12 + i * 0.09, 0.6), L(d[0], 0.1, 0.15 + i * 0.09), L(d[1], 0.6, 0.15 + i * 0.09)]),
] });
const D_R01 = [['マグミット錠250mg', '1回1錠', '1日2回 朝夕食後'], ['ランソプラゾールOD錠15mg「ケミファ」', '1回1錠', '1日1回 夕食後']];
const D_R02 = [['マグミット錠250mg', '1回1錠', '1日1回 朝食後'], ['カクウヨメナイ錠9mg', '1回1錠', '1日1回 夕食後']];
const D_R03 = [['マグミット錠250mg', '1回1錠', '1日1回 朝食後']];
const D_R04 = [['マグミット錠250mg', '1回1錠', '1日2回 朝夕食後']];
const D_R05 = [['マグミット錠250mg', '1回1錠', '1日2回 朝夕食後']];   // 中身は書類4と同じだが、読み残しの知らせがある
const resultFile = () => JSON.stringify({ kind: 'yakujo-yomitori', v: 1, createdAt: '2026-11-04T09:00:00+09:00', skipped: [], docs: [
  { no: 1, file: 'a.jpg', type: 'photo', error: '', pages: [page('架空 一郎', 'カクウ イチロウ', D_R01)] },
  { no: 2, file: 'b.jpg', type: 'photo', error: '', pages: [page('見本 一郎', 'ミホン イチロウ', D_R02)] },
  { no: 3, file: 'c.jpg', type: 'photo', error: '', pages: [page('試験 一郎', 'シケン イチロウ', D_R03)] },
  { no: 4, file: 'd.jpg', type: 'photo', error: '', pages: [page('仮名 一郎', 'カメイ イチロウ', D_R04)] },
  { no: 5, file: 'e.pdf', type: 'pdf', error: '', note: 'はじめの 1 ページだけを読みました（残りは読んでいません）', pagesTotal: 3, pages: [page('架空 花子', 'カクウ ハナコ', D_R05)] },
] });

const srv = await startServer(process.cwd(), 0);
const browser = await chromium.launch();
async function run(opts) {
  const applied = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.route(fx.match, (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* 本文の無い要求 */ }
    let res;
    if (body.action === 'medCand' && body.op === 'ping') res = { ok: true, build: 'check 反映記録' };
    else if (body.action === 'medCand' && body.op === 'apply') { applied.push(body); res = opts.conflictFor === body.id ? { ok: false, conflict: true } : opts.unknownFor === body.id ? { ok: false, unknown: true } : opts.alreadyFor === body.id ? { ok: false, already: true } : { ok: true }; }
    else {
      res = fx.respond(body);
      if (body.action === 'getResident' && res.record && MEDS[res.record.id] != null) { res.record.medsRegular = MEDS[res.record.id]; res.record.medsHistory = []; }
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  for (const rt of (fx.routes || [])) await ctx.route(rt.match, rt.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, fx.storage);
  const p = await ctx.newPage();
  const errors = [], dialogs = [];
  p.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  await p.goto(srv.url + '/resident-master.html', { waitUntil: 'load' });
  await p.waitForFunction(() => Array.isArray(window.roster) && window.roster.length >= 5, null, { timeout: 20000 });
  /* 管理者の入口（yjGate_）はログインの確かめが要るので、ここでは窓を直接開く。ログインの証明は架空の文字列 */
  await p.evaluate((txt) => { window.rmAccessToken_ = function () { return Promise.resolve('check-token'); }; window.yjOpen_(); window.yjLoadText_(txt); }, resultFile());
  await p.waitForSelector('#yjGo:not([disabled])', { timeout: 10000 });
  await p.click('#yjGo');
  await p.waitForFunction(() => window.yjSt && window.yjSt.preTotal > 0 && window.yjSt.preDone === window.yjSt.preTotal && window.yjSt.server === 'ok', null, { timeout: 20000 });
  return { p, ctx, applied, errors, dialogs };
}

try {
  /* 1回目: R03 の今の定期薬を決めるため、書類3の組み立ての行を読む（R03 は空の定期薬で「足す」になる） */
  let r = await run({});
  const r03Lines = await r.p.evaluate(() => { const x = window.yjSt.docs[2]; return x.pre && x.pre.bc ? x.pre.bc.rows.filter((w) => w.kind === 'add').map((w) => w.line) : null; });
  await r.ctx.close();
  t('書類3の薬の行を組み立てられる', Array.isArray(r03Lines) && r03Lines.length === 1, r03Lines);
  MEDS.R03 = (r03Lines || []).join('\n');

  /* 2回目: 本番の流れ */
  r = await run({});
  const st = await r.p.evaluate(() => window.yjSt.docs.map((x) => ({ st: x.pre && x.pre.st, why: x.pre && x.pre.why, after: x.pre && x.pre.bc && x.pre.bc.judged.after, warns: x.pre && x.pre.bc && x.pre.bc.rows.map((w) => w.kind + ':' + w.warns.join('/')) })));
  if (process.env.YJ_DEBUG) console.log(JSON.stringify(st, null, 1));
  t('★問題の無い書類1は「まとめて反映できる方」', st[0].st === 'ok', st[0]);
  t('★書類1の反映後: 変える1行・足す1行', st[0].after && st[0].after.split('\n').length === 2 && /^マグミット錠250mg .*朝.*夕/.test(st[0].after) && /ランソプラゾールOD錠15mg「ケミファ」/.test(st[0].after), st[0].after);
  t('★書類4は「まとめて反映できる方」で、書類に無い今の薬は残す', st[3].st === 'ok' && /架空ロール錠5mg「見本」 1回1錠 夕食後/.test(st[3].after) && st[3].after.split('\n').length === 2, st[3]);
  t('★読めない薬のある書類2は1人ずつ（理由に ⚠）', st[1].st === 'ng' && (st[1].why || []).some((w) => /⚠ の行/.test(w)), st[1]);
  t('★書類と同じ書類3は「変更なし」', st[2].st === 'none', st[2]);
  t('★読み残しの知らせがある書類5は、中身に問題が無くても1人ずつ', st[4].st === 'ng' && (st[4].why || []).some((w) => /読み残し/.test(w)) && (st[4].why || []).some((w) => /全部のページ/.test(w)), st[4]);
  const txt = await r.p.textContent('#yjBody');
  t('一覧に「まとめて反映できる方」と理由が出る', /まとめて反映できる方/.test(txt) && /1人ずつ確かめる理由：⚠ の行/.test(txt) && /変更なし（書かずに終わりにします）/.test(txt));
  t('一覧に「書類に無い今の薬 1 行は残します」が出る', /書類に無い今の薬 1 行は残します/.test(txt));
  t('ボタンの文言: 2人と変更なし1件', /チェックした 2 人をまとめて反映（変更なし 1 件も終わりにします）/.test(txt), txt.slice(0, 300));
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await r.p.screenshot({ path: path.join(shots, 'yj-bulk-before.png'), fullPage: false }); }
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  t('★確認の窓は1回だけ', r.dialogs.length === 1 && /次の 2 人/.test(r.dialogs[0]), r.dialogs);
  t('★送ったのは書類1・4の方だけ・1人1回ずつ', r.applied.map((b) => b.id).join() === 'R01,R04', r.applied.map((b) => b.id));
  const b = r.applied[0] || {};
  t('★1人ずつと同じ形（srcKind 薬情・調剤日・判断の印・ログインの証明・書類の行）', b.srcKind === '薬情' && b.srcDate === '2026-11-01' && /^S\|R01\|2026-11-01\|[0-9a-f]{8}$/.test(b.srcKey) && b.accessToken === 'check-token' && typeof b.docRows === "string" && /^変える｜/.test(b.docRows) && /まとめて反映/.test(b.srcText), b);
  t('★送る前の定期薬は読んだ時の値・後は確認表の組み立てと同じ', b.before === MEDS.R01 && b.after === st[0].after);
  const st2 = await r.p.evaluate(() => window.yjSt.docs.map((x) => x.status));
  t('★反映後: 書類1・4は反映済み・書類3は変更なしで終わり・書類2・5は残る', st2[0] === 'done' && st2[3] === 'done' && st2[2] === 'none' && st2[1] === '' && st2[4] === '', st2);
  if (shots) await r.p.screenshot({ path: path.join(shots, 'yj-bulk-after.png'), fullPage: false });
  t('画面の JS エラーなし', r.errors.length === 0, r.errors);
  await r.ctx.close();

  /* 3回目: チェックを外すと送らない */
  r = await run({});
  await r.p.uncheck('[data-yjbulk="0"]');
  const t3 = await r.p.textContent('#yjBulkGo');
  t('チェックを外すと人数が減る', /チェックした 1 人をまとめて反映/.test(t3), t3);
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  t('★チェックを外した方は送らない（書類4の方だけ送る）', r.applied.map((b) => b.id).join() === 'R04', r.applied.map((b) => b.id));
  t('チェックを外した方は、まとめての対象のまま残る（1人ずつでも確かめられる）', await r.p.evaluate(() => window.yjSt.docs[0].status === '' && window.yjSt.docs[0].pre.st === 'ok'));
  await r.ctx.close();

  /* 4回目: 食い違いが返った方は1人ずつへ回る */
  r = await run({ conflictFor: 'R01' });
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  const st4 = await r.p.evaluate(() => ({ s: window.yjSt.docs[0].status, pre: window.yjSt.docs[0].pre, msg: window.yjSt.bulkMsg }));
  t('★食い違いの方は反映済みにせず、1人ずつへ回す（ほかの方は続けて反映する）', st4.s === '' && st4.pre.st === 'ng' && /定期薬が変わっていました/.test(st4.pre.why[0]) && /反映 1人・1人ずつに回した方 1人/.test(st4.msg), st4);
  await r.ctx.close();

  /* 5回目: 届いたか分からない（unknown）方が出たら、残りの方へは送らない */
  r = await run({ unknownFor: 'R01' });
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  const st5 = await r.p.evaluate(() => ({ s0: window.yjSt.docs[0].status, s3: window.yjSt.docs[3].status, p3: window.yjSt.docs[3].pre && window.yjSt.docs[3].pre.st, msg: window.yjSt.bulkMsg }));
  t('★確かめ中の方が出たら止め、残りの方へは送らない', r.applied.map((b) => b.id).join() === 'R01' && st5.s0 === 'unsure' && st5.s3 === '' && st5.p3 === 'ok' && /途中で止めました/.test(st5.msg), { ids: r.applied.map((b) => b.id), st5 });
  await r.ctx.close();

  /* 6回目: 既に反映されていた方は、書き換えた人数に数えない */
  r = await run({ alreadyFor: 'R01' });
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  const msg6 = await r.p.evaluate(() => window.yjSt.bulkMsg);
  t('★既に反映されていた方は別に数える', /反映 1人・既に反映されていた方 1人/.test(msg6), msg6);
  await r.ctx.close();
} catch (e) {
  fail++; console.log('  ✗ 途中で止まった: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  await browser.close();
  await srv.close();
}
console.log('\n合計: 成功 ' + pass + '・失敗 ' + fail);
process.exit(fail ? 1 : 0);
