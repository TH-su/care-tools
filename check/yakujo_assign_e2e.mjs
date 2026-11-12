/* check/yakujo_assign_e2e.mjs — 入居者マスタ「📥 薬情の取り込み」の振り分けの画面（本人指示 2026-11-12）を、
 * 本物の画面（resident-master.html）と架空の入居者・架空の薬情で通して確かめる。
 *
 *   node check/yakujo_assign_e2e.mjs [--shots <撮影の置き場>]
 *
 * 確かめること:
 *   1. 自動で決まらなかった書類でも、候補の氏名を出す時は、その方（2名以上なら最初の方）が「この書類の方」の既定になる
 *   2. 候補の無い書類は「（選ぶ）」のまま
 *   3. 書類ごとに氏名の所を拡大した絵（SVG の切り出し）が出て、選んだ方を変えると拡大する所も変わる
 *   4. 候補を既定にした書類は、まとめて反映に入らず1人ずつに回る（自動の一字一致ではないため）
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

const L = (t, x, y, w) => ({ t, x, y, w: w || 0.4, h: 0.02, c: 1 });
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAsIAAEAAQEBEQD/xAAUAAEAAAAAAAAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwBH/9k=';   // 1画素の白い画像（架空）
const pg = (lines) => ({ no: 1, w: 1000, h: 1400, img: IMG, codes: { qr: 0, other: 0 }, lines: lines.concat([
  L('調剤日 2026年11月01日', 0.5, 0.03), L('Rp1 1日1回 朝食後 14日分', 0.1, 0.3, 0.6), L('マグミット錠250mg', 0.1, 0.33), L('1回1錠', 0.6, 0.33)]) });
const resultFile = () => JSON.stringify({ kind: 'yakujo-yomitori', v: 1, createdAt: new Date().toISOString(), skipped: [], docs: [
  /* 1: 1字違い（架空 一朗）→ 候補は「架空 一郎」だけ */
  { no: 1, file: 'a.jpg', type: 'photo', error: '', pages: [pg([L('架空 一朗 様', 0.1, 0.10, 0.25)])] },
  /* 2: 名簿の2名の氏名がある → 候補2名・最初の方が既定 */
  { no: 2, file: 'b.jpg', type: 'photo', error: '', pages: [pg([L('見本 一郎 様', 0.1, 0.08, 0.25), L('架空 一郎', 0.1, 0.6, 0.25)])] },
  /* 3: 氏名が読めない → 候補なし・（選ぶ）のまま。「氏名」の見出しの所を拡大 */
  { no: 3, file: 'c.jpg', type: 'photo', error: '', pages: [pg([L('患者氏名 ＊＊＊ 様', 0.55, 0.12, 0.3)])] },
  /* 4: 氏名とカナが一字一致 → 自動で決まる（今までどおり） */
  { no: 4, file: 'd.jpg', type: 'photo', error: '', pages: [pg([L('試験 一郎 様', 0.1, 0.05, 0.25), L('シケン イチロウ', 0.1, 0.07, 0.25)])] },
] });

const srv = await startServer(process.cwd(), 0);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.route(fx.match, (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* 本文の無い要求 */ }
    const res = body.action === 'medCand' && body.op === 'ping' ? { ok: true, build: 'check 振り分け' }
      : body.action === 'medCand' && body.op === 'apply' ? { ok: false, error: '試験では送らない' } : fx.respond(body);
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  for (const rt of (fx.routes || [])) await ctx.route(rt.match, rt.handle);
  await ctx.addInitScript((st) => { for (const k of Object.keys(st)) localStorage.setItem(k, st[k]); }, fx.storage);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await p.goto(srv.url + '/resident-master.html', { waitUntil: 'load' });
  await p.waitForFunction(() => Array.isArray(window.roster) && window.roster.length >= 6, null, { timeout: 20000 });
  await p.evaluate((txt) => { window.rmAccessToken_ = function () { return Promise.resolve('check-token'); }; window.yjOpen_(); window.yjLoadText_(txt); }, resultFile());
  await p.waitForSelector('select[data-yjpick="3"]', { timeout: 10000 });

  const st = () => p.evaluate(() => window.yjSt.docs.map((x) => ({ auto: x.a.id, pick: x.pick, guess: x.guess, sel: (document.querySelector('select[data-yjpick="' + window.yjSt.docs.indexOf(x) + '"]') || {}).value })));
  let s = await st();
  t('★書類1（1字違い）: 候補の「架空 一郎」がプルダウンの既定', s[0].auto === '' && s[0].pick === 'R01' && s[0].sel === 'R01' && s[0].guess === true, s[0]);
  t('★書類2（2名の氏名）: 書類の上の方にある「見本 一郎」がプルダウンの既定（番号の小さい方ではない）', s[1].auto === '' && s[1].pick === 'R02' && s[1].sel === 'R02', s[1]);
  t('★書類3（候補なし）: （選ぶ）のまま', s[2].pick === '' && s[2].sel === '' && s[2].guess === false, s[2]);
  t('書類4（一字一致）: 今までどおり自動で決まる・仮の印なし', s[3].auto === 'R03' && s[3].sel === 'R03' && s[3].guess === false, s[3]);
  const body = await p.textContent('#yjBody');
  t('候補を既定にした書類に「仮に選んでいます」が出る（2件だけ）', (body.match(/候補の方を仮に選んでいます/g) || []).length === 2, body.slice(0, 300));

  const zooms = await p.evaluate(() => Array.from(document.querySelectorAll('.yj-arow')).map((r) => { const z = r.querySelector('svg.yj-zoom'); return z ? { vb: z.getAttribute('viewBox'), cap: (z.parentNode.querySelector('.yj-sub') || {}).textContent, box: !!z.querySelector('rect.yj-box'), img: !!z.querySelector('image') } : null; }));
  t('★4件とも氏名の拡大が出る（画像つき）', zooms.every((z) => z && z.img), zooms);
  const vy = (z) => z ? +z.vb.split(' ')[1] : -1, vh = (z) => z ? +z.vb.split(' ')[3] : -1;
  t('★書類1: 1字違いの氏名の行（y=140px 付近）を枠つきで拡大', zooms[0] && /似た所/.test(zooms[0].cap) && zooms[0].box && vy(zooms[0]) <= 140 && vy(zooms[0]) + vh(zooms[0]) >= 168, zooms[0]);
  t('★書類3: 氏名の見出しの行を拡大（候補なしでも）', zooms[2] && /氏名らしい所/.test(zooms[2].cap) && vy(zooms[2]) <= 168 && vy(zooms[2]) + vh(zooms[2]) >= 196, zooms[2]);
  t('書類4: 氏名の行を拡大', zooms[3] && /氏名の所を拡大/.test(zooms[3].cap), zooms[3]);
  t('拡大の範囲はページの中に収まり、ページ全体より小さい', zooms.every((z) => { const [x, y, w, h] = z.vb.split(' ').map(Number); return x >= 0 && y >= 0 && x + w <= 1000.1 && y + h <= 1400.1 && w * h < 1000 * 1400 / 4; }), zooms.map((z) => z && z.vb));
  const sz = await p.evaluate(() => { const r = document.querySelector('.yj-arow svg.yj-zoom').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  t('拡大の絵は小さな見本（幅150px）より大きく、幅は320pxまで（本人指示 2026-11-12 で半分に）', sz.w > 300 && sz.w <= 320.5 && sz.h > 40, sz);
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, 'yj-assign.png'), fullPage: false }); }

  /* 書類2の選択を、もう一人の候補へ変えると、拡大する所もその方の行へ移る */
  const other = s[1].pick === 'R01' ? 'R02' : 'R01';
  await p.selectOption('select[data-yjpick="1"]', other);
  s = await st();
  const z2 = await p.evaluate(() => document.querySelectorAll('.yj-arow')[1].querySelector('svg.yj-zoom').getAttribute('viewBox'));
  const wantY = other === 'R02' ? 112 : 840;
  t('★選び直すと仮の印が消え、拡大する所が選んだ方の氏名の行へ移る', s[1].pick === other && s[1].guess === false && +z2.split(' ')[1] <= wantY && +z2.split(' ')[1] + +z2.split(' ')[3] >= wantY + 28, { s: s[1], z2 });

  /* 候補なしの書類3を外して進めると、候補を既定にした書類はまとめて反映に入らない */
  await p.check('input[data-yjout="2"]');
  await p.waitForSelector('#yjGo:not([disabled])', { timeout: 5000 });
  await p.click('#yjGo');
  await p.waitForFunction(() => window.yjSt && window.yjSt.preTotal > 0 && window.yjSt.preDone === window.yjSt.preTotal, null, { timeout: 20000 });
  const pre = await p.evaluate(() => window.yjSt.docs.map((x) => x.pre && { st: x.pre.st, why: x.pre.why }));
  t('★候補を既定にした書類1は1人ずつ（振り分けが一字一致で決まっていない）', pre[0] && pre[0].st !== 'ok' && (pre[0].why || []).some((w) => /一字一致/.test(w)), pre[0]);
  t('画面の JS エラーなし', errors.length === 0, errors);
  await ctx.close();
} catch (e) {
  fail++; console.log('  ✗ 途中で止まった: ' + String(e && e.message || e).split('\n')[0]);
} finally {
  await browser.close();
  await srv.close();
}
console.log('\n合計: 成功 ' + pass + '・失敗 ' + fail);
process.exit(fail ? 1 : 0);
