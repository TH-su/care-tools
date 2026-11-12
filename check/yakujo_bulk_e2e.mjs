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
  R06: 'マグミット錠330mg 1錠分1 朝食後',   // 施設の書き方（屋号なし・分N）。書類6は見出しの枠の書式で、朝夕へ変わる＋外用の貼り薬
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
/* 実際の薬情と同じ「見出しの付いた枠」の書式（1剤ごとに お薬名・用法・1回量、量は時点の欄の下・色と形の行・説明の文） */
const lblPage = (name, kana) => {
  const hdr = (y) => [['起床時', 0.31], ['朝', 0.42], ['昼', 0.51], ['タ', 0.60], ['就寝前', 0.67]].map((h) => L(h[0], h[1], y, 0.03));
  return { no: 1, w: 1000, h: 1400, img: IMG, codes: { qr: 0, other: 0 }, lines: [
    L(name + ' 様', 0.1, 0.05), L(kana, 0.1, 0.07), L('調剤日 2026年11月01日', 0.5, 0.05),
    L('お薬名', 0.25, 0.10, 0.05), L('マグミット錠330mg', 0.32, 0.10, 0.3), L('用法', 0.25, 0.13, 0.03), L('1日2回 朝夕食後', 0.32, 0.13, 0.18),
    ...hdr(0.16), L('白色の錠剤', 0.09, 0.18, 0.07), L('1回量', 0.24, 0.18, 0.05), L('1錠', 0.41, 0.183, 0.04), L('1錠', 0.59, 0.183, 0.04), L('14日分(計28錠)', 0.82, 0.18, 0.11),
    L('・見本の説明の文です。', 0.09, 0.22, 0.5),
    L('お薬名', 0.25, 0.30, 0.05), L('架空クリーム0.1%「見本」', 0.32, 0.30, 0.3), L('用法', 0.25, 0.33, 0.03), L('外用', 0.32, 0.33, 0.04),
    L('<外用>', 0.24, 0.345, 0.06), L('1日数回 患部に塗布', 0.32, 0.345, 0.21), L('1回量', 0.24, 0.38, 0.05), L('(計20g)', 0.87, 0.38, 0.06),
  ] };
};
/* 書類にかかりつけ病院の名前の行を足す（架空の名前・本人指示 2026-11-10 の入れ替えの試験） */
const withLine = (pg, ln) => Object.assign({}, pg, { lines: pg.lines.concat([ln]) });
const resultFile = () => JSON.stringify({ kind: 'yakujo-yomitori', v: 1, createdAt: '2026-11-04T09:00:00+09:00', skipped: [], docs: [
  { no: 1, file: 'a.jpg', type: 'photo', error: '', pages: [page('架空 一郎', 'カクウ イチロウ', D_R01)] },
  { no: 2, file: 'b.jpg', type: 'photo', error: '', pages: [page('見本 一郎', 'ミホン イチロウ', D_R02)] },
  { no: 3, file: 'c.jpg', type: 'photo', error: '', pages: [page('試験 一郎', 'シケン イチロウ', D_R03)] },
  { no: 4, file: 'd.jpg', type: 'photo', error: '', pages: [withLine(page('仮名 一郎', 'カメイ イチロウ', D_R04), L('処方 架空 内科クリニック', 0.1, 0.9))] },
  { no: 5, file: 'e.pdf', type: 'pdf', error: '', note: 'はじめの 1 ページだけを読みました（残りは読んでいません）', pagesTotal: 3, pages: [page('架空 花子', 'カクウ ハナコ', D_R05)] },
  { no: 6, file: 'f.jpg', type: 'photo', error: '', pages: [lblPage('見本 花子', 'ミホン ハナコ')] },
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
      if (body.action === 'getResident' && res.record && opts.hospital && opts.hospital[res.record.id] != null) res.record.hospital = opts.hospital[res.record.id];
    }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  for (const rt of (fx.routes || [])) await ctx.route(rt.match, rt.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, fx.storage);
  const p = await ctx.newPage();
  const errors = [], dialogs = [];
  p.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  /* 2026-11-13: 確かめは画面の中の窓（su-dialog.js）になった。出た窓の文を同じ dialogs に記録し、同じ答え（OK）を押す（確かめる中身は同じ・yakujo_review_e2e と同じ仕掛け） */
  await p.exposeFunction('__sudSeen', (m) => { dialogs.push(m); });
  await p.addInitScript(() => {
    new MutationObserver(() => {
      const g = document.querySelector('dialog.sud-dlg[open]');
      if (!g || g.__seen) return;
      g.__seen = true;
      window.__sudSeen((g.querySelector('.sud-msg') || {}).textContent || '');
      setTimeout(() => { const b = g.querySelector('.sud-btn.pri'); if (b) b.click(); }, 0);
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await p.goto(srv.url + '/resident-master.html', { waitUntil: 'load' });
  await p.waitForFunction(() => Array.isArray(window.roster) && window.roster.length >= 6, null, { timeout: 20000 });
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
  t('★見出しの枠の書式の書類6は「まとめて反映できる方」: 屋号の無い施設の書き方のまま朝夕へ変え、「1日数回」の外用は定期薬に入れない', st[5].st === 'ok' && st[5].after.split('\n').length === 1 && /^マグミット錠330mg /.test(st[5].after) && /朝夕/.test(st[5].after) && !/架空クリーム/.test(st[5].after), st[5]);
  t('★読み残しの知らせがある書類5は、中身に問題が無くても1人ずつ', st[4].st === 'ng' && (st[4].why || []).some((w) => /読み残し/.test(w)) && (st[4].why || []).some((w) => /全部のページ/.test(w)), st[4]);
  const txt = await r.p.textContent('#yjBody');
  t('一覧に「まとめて反映できる方」と理由が出る', /まとめて反映できる方/.test(txt) && /1人ずつ確かめる理由：⚠ の行/.test(txt) && /変更なし（書かずに終わりにします）/.test(txt));
  t('一覧に「書類に無い今の薬 1 行は残します」が出る', /書類に無い今の薬 1 行は残します/.test(txt));
  t('一覧に「定期薬に入れない薬（外用・頓服など）：架空クリーム…」が出る', /定期薬に入れない薬（外用・頓服など）：架空クリーム0\.1%「見本」/.test(txt));
  t('ボタンの文言: 3人と変更なし1件', /チェックした 3 人をまとめて反映（変更なし 1 件も終わりにします）/.test(txt), txt.slice(0, 300));
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await r.p.screenshot({ path: path.join(shots, 'yj-bulk-before.png'), fullPage: false }); }
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  t('★確認の窓は1回だけ', r.dialogs.length === 1 && /次の 3 人/.test(r.dialogs[0]), r.dialogs);
  t('★送ったのは書類1・4・6の方だけ・1人1回ずつ', r.applied.map((b) => b.id).join() === 'R01,R04,R06', r.applied.map((b) => b.id));
  const b = r.applied[0] || {};
  t('★1人ずつと同じ形（srcKind 薬情・調剤日・判断の印・ログインの証明・書類の行）', b.srcKind === '薬情' && b.srcDate === '2026-11-01' && /^S\|R01\|2026-11-01\|[0-9a-f]{8}$/.test(b.srcKey) && b.accessToken === 'check-token' && typeof b.docRows === "string" && /^変える｜/.test(b.docRows) && /まとめて反映/.test(b.srcText), b);
  t('★送る前の定期薬は読んだ時の値・後は確認表の組み立てと同じ', b.before === MEDS.R01 && b.after === st[0].after);
  const st2 = await r.p.evaluate(() => window.yjSt.docs.map((x) => x.status));
  t('★反映後: 書類1・4・6は反映済み・書類3は変更なしで終わり・書類2・5は残る', st2[0] === 'done' && st2[3] === 'done' && st2[5] === 'done' && st2[2] === 'none' && st2[1] === '' && st2[4] === '', st2);
  if (shots) await r.p.screenshot({ path: path.join(shots, 'yj-bulk-after.png'), fullPage: false });
  t('画面の JS エラーなし', r.errors.length === 0, r.errors);
  await r.ctx.close();

  /* 3回目: チェックを外すと送らない */
  r = await run({});
  await r.p.uncheck('[data-yjbulk="0"]');
  const t3 = await r.p.textContent('#yjBulkGo');
  t('チェックを外すと人数が減る', /チェックした 2 人をまとめて反映/.test(t3), t3);
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  t('★チェックを外した方は送らない（書類4・6の方だけ送る）', r.applied.map((b) => b.id).join() === 'R04,R06', r.applied.map((b) => b.id));
  t('チェックを外した方は、まとめての対象のまま残る（1人ずつでも確かめられる）', await r.p.evaluate(() => window.yjSt.docs[0].status === '' && window.yjSt.docs[0].pre.st === 'ok'));
  await r.ctx.close();

  /* 4回目: 食い違いが返った方は1人ずつへ回る */
  r = await run({ conflictFor: 'R01' });
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  const st4 = await r.p.evaluate(() => ({ s: window.yjSt.docs[0].status, pre: window.yjSt.docs[0].pre, msg: window.yjSt.bulkMsg }));
  t('★食い違いの方は反映済みにせず、1人ずつへ回す（ほかの方は続けて反映する）', st4.s === '' && st4.pre.st === 'ng' && /定期薬が変わっていました/.test(st4.pre.why[0]) && /反映 2人・1人ずつに回した方 1人/.test(st4.msg), st4);
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
  t('★既に反映されていた方は別に数える', /反映 2人・既に反映されていた方 1人/.test(msg6), msg6);
  await r.ctx.close();

  /* 7回目: かかりつけ病院が1つで、書類にその名前がある方でも、書類に無い今の薬は自動で消さず残す。消すのは一覧でチェックした時だけ（本人指示 2026-11-10） */
  r = await run({ hospital: { R04: '架空内科クリニック', R01: '架空内科クリニック' } });
  const pre7 = () => r.p.evaluate(() => { const p = window.yjSt.docs[3].pre; return { st: p.st, after: p.bc.judged.after, stop: p.bc.judged.counts.stop, lefts: p.bc.lefts, mode: p.bc.plan && p.bc.plan.mode }; });
  let s7 = await pre7();
  t('★かかりつけ病院の書類でも、書類に無い今の薬は自動で消さない（残す）', s7.st === 'ok' && s7.mode === 'replace' && s7.stop === 0 && /架空ロール/.test(s7.after) && s7.lefts.length === 1 && s7.lefts[0].action === 'keep', s7);
  const st7 = await r.p.evaluate(() => window.yjSt.docs[0].pre.bc.plan && window.yjSt.docs[0].pre.bc.plan.mode);
  t('★書類にかかりつけ病院の名前が無い方（書類1）は、かかりつけ病院の書類と知らせない', st7 === 'keep', st7);
  const txt7 = await r.p.textContent('#yjBody');
  t('一覧に「かかりつけ病院の書類です」の知らせと、残す行が出る（「入れ替えます」とは出さない）', /かかりつけ病院（架空内科クリニック）の書類です/.test(txt7) && /残す 架空ロール錠5mg「見本」/.test(txt7) && !/入れ替えます/.test(txt7), txt7.slice(0, 600));
  const sel7 = '[data-yjbleft="3:' + s7.lefts[0].k + '"]';
  await r.p.check(sel7);
  s7 = await pre7();
  t('★チェックを付けると消す', s7.st === 'ok' && s7.stop === 1 && !/架空ロール/.test(s7.after), s7);
  await r.p.uncheck(sel7);
  s7 = await pre7();
  t('チェックを外すと残す', s7.stop === 0 && /架空ロール/.test(s7.after), s7);
  await r.p.check(sel7);
  await r.p.click('#yjBulkGo');
  await r.p.waitForFunction(() => window.yjSt && !window.yjSt.bulkBusy && /まとめて反映：/.test(window.yjSt.bulkMsg), null, { timeout: 20000 });
  t('★確認の窓に消す行の名前と注意が出る', r.dialogs.length === 1 && /消す 1行（架空ロール錠5mg「見本」）/.test(r.dialogs[0]) && /消す薬が 1 行あります/.test(r.dialogs[0]), r.dialogs);
  const b7 = r.applied.find((b) => b.id === 'R04');
  t('★送った定期薬から、書類に無い今の薬が消えている', b7 && b7.before === MEDS.R04 && !/架空ロール/.test(b7.after) && /^マグミット錠250mg /.test(b7.after), b7 && b7.after);
  t('画面の JS エラーなし（入れ替え）', r.errors.length === 0, r.errors);
  await r.ctx.close();

  /* 8回目: 1人ずつの確認表の「すべて入れ替え」（押した時だけ・確認の窓・取り消せる）と、書類に無い今の行の「直す」（本人指示 2026-11-10） */
  r = await run({ hospital: { R04: '架空内科クリニック' } });
  await r.p.click('[data-yjdoc="3"]');
  await r.p.waitForFunction(() => window.yjSt && window.yjSt.cur && window.yjSt.cur.loaded, null, { timeout: 20000 });
  const cur8 = () => r.p.evaluate(() => window.yjSt.cur.rows.filter((x) => x.kind === 'left').map((x) => ({ a: x.action, all: !!x.byAll, line: x.line })));
  let l8 = await cur8();
  t('★1人ずつでも、書類に無い今の行は自動で中止にしない（選ぶ前のまま）', l8.length === 1 && l8[0].a === '', l8);
  t('「すべて入れ替え」のボタンが出る', /すべて入れ替え（書類に無い今の薬 1 行を中止）/.test(await r.p.textContent('#yjAll')));
  await r.p.click('#yjAll');
  /* 画面の中の窓の答えを待ってから読む（OK の後に行が「中止」になる・2026-11-13） */
  await r.p.waitForFunction(() => !document.querySelector('dialog.sud-dlg[open]') && window.yjSt.cur.rows.some((x) => x.kind === 'left' && x.action === 'stop'), null, { timeout: 10000 }).catch(() => {});
  l8 = await cur8();
  t('★押すと確認の窓のあと、書類に無い今の行を全部「中止」にする', r.dialogs.length === 1 && /書類に無い次の 1 行を、すべて「中止」/.test(r.dialogs[0]) && /架空ロール錠5mg「見本」/.test(r.dialogs[0]) && l8[0].a === 'stop' && l8[0].all, { d: r.dialogs, l8 });
  t('ボタンが「取り消す」に変わる', /すべて入れ替えを取り消す/.test(await r.p.textContent('#yjAll')));
  await r.p.click('#yjAll');
  l8 = await cur8();
  t('★取り消すと選ぶ前に戻る（取り消しには確認の窓を出さない）', r.dialogs.length === 1 && l8[0].a === '' && !l8[0].all, l8);
  const k8 = await r.p.evaluate(() => window.yjSt.cur.rows.findIndex((x) => x.kind === 'left'));
  await r.p.selectOption('[data-yjact="' + k8 + '"]', 'edit');
  await r.p.fill('[data-yjline="' + k8 + '"]', '架空ロール錠5mg「後発」 1回1錠 夕食後');
  await r.p.dispatchEvent('[data-yjline="' + k8 + '"]', 'change');
  await r.p.waitForTimeout(100);
  const j8 = await r.p.evaluate(() => window.yjJudge_());
  t('★「直す」を選んで行を直すと、反映する定期薬で今の行がその行に変わる（並びは今のまま）', /架空ロール錠5mg「後発」 1回1錠 夕食後/.test(j8.after) && !/架空ロール錠5mg「見本」/.test(j8.after) && j8.counts.stop === 0, j8.after);
  const w8 = await r.p.evaluate((k) => window.yjSt.cur.rows[k].warns, k8);
  t('直した行は ⚠（手で直した行）として確かめを求める', w8.some((w) => /手で直した行/.test(w)), w8);
  /* 同じ成分の「置き換える」（反証レビュー 2026-11-10 指摘1・2）。足す行を1行足して、今の行と結んだ形を作って確かめる */
  await r.p.selectOption('[data-yjact="' + k8 + '"]', '');
  const ka = await r.p.evaluate((k) => { const c = window.yjSt.cur, w = '今の定期薬の「架空ロール錠5mg「見本」」と同じ成分です。先発品から後発品への切り替えなら「今の行と置き換える」を押してください（両方飲む薬なら、そのまま足してください）';
    c.rows.push({ kind: 'add', cur: '', line: '架空ロール錠5mg「後発」 1回1錠 夕食後', raw: '架空ロール錠5mg「後発」 1回1錠 夕食後', page: 1, box: null, warns: [w], twinWarn: w, twin: k, action: 'add', checked: true, auto: '' });
    window.yjPaint_(); return c.rows.length - 1; }, k8);
  await r.p.click('[data-yjtwin="' + ka + '"]');
  let tw = await r.p.evaluate(([k, a]) => { const c = window.yjSt.cur; return { left: c.rows[k].action, chk: c.rows[a].checked, w: c.rows[a].warns }; }, [k8, ka]);
  t('★「置き換える」で今の行を中止にし、足す行は「置き換えます」の知らせでもう一度確かめを求める', tw.left === 'stop' && tw.chk === false && tw.w.some((w) => /この行に置き換えます/.test(w)), tw);
  await r.p.selectOption('[data-yjact="' + k8 + '"]', 'keep');
  tw = await r.p.evaluate(([k, a]) => { const c = window.yjSt.cur; return { left: c.rows[k].action, chk: c.rows[a].checked, w: c.rows[a].warns }; }, [k8, ka]);
  t('★置き換えた後に今の行を「残す」へ戻すと、足す行に「同じ成分」の知らせが戻り確かめを外す（指摘1）', tw.left === 'keep' && tw.chk === false && tw.w.some((w) => /と同じ成分です/.test(w)) && !tw.w.some((w) => /置き換えます/.test(w)), tw);
  await r.p.click('[data-yjtwin="' + ka + '"]');
  await r.p.selectOption('[data-yjact="' + ka + '"]', 'skip');
  tw = await r.p.evaluate(([k, a]) => { const c = window.yjSt.cur; return { left: c.rows[k].action, add: c.rows[a].action }; }, [k8, ka]);
  t('★置き換えた後に足す行を「足さない」にすると、今の行の中止を外して選ぶ前に戻す（両方消えない・指摘2）', tw.left === '' && tw.add === 'skip', tw);
  t('画面の JS エラーなし（1人ずつ）', r.errors.length === 0, r.errors);
  await r.ctx.close();
} catch (e) {
  fail++; console.log('  ✗ 途中で止まった: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  await browser.close();
  await srv.close();
}
console.log('\n合計: 成功 ' + pass + '・失敗 ' + fail);
process.exit(fail ? 1 : 0);
