/* check/patch_config_e2e.mjs — 貼り薬カレンダーの薬の名前と貼る場所を施設情報（facility-profile.json の patchCalendar）で差し替える
 * （代表者の決定 2026-11-13）を、本物の画面で通して確かめる。通信は全部偽物・架空の値だけ。
 *
 *   node check/patch_config_e2e.mjs
 *
 * 守ること:
 *   1. 書いていない施設（見本）は今のまま（背中の写真の図・8箇所・元の文）
 *   2. 6か所・2か所・8か所（独自の名前）で、選ぶ欄・順番図・ますの図・文が場所の数に合い、画面と紙（A4縦1ページ）が崩れない
 *   3. 薬の名前だけ書いた時は背中の写真の図と8箇所のまま、名前だけ替わる
 *   4. 10か所（保存が 1〜8 しか持てない）・崩れた値は丸ごと捨てて既定
 *   5. 端末の控えが無く、読み終えてから届いた時も作り直す。保存してある番号が場所の数を超える時は未設定として知らせる
 *   6. 施設情報が読めない時は刷らずに知らせる（印刷の画面を開かない）
 *   8. 名簿から選んだ方の道でも、場所の数を超える番号は使わず、作り直しても選んだ方のまま
 *   9. 端末の控えに場所があり、届いた施設情報から外れていた時は、元の文と背中の写真の図に戻る
 *   7. 外からの文字は文字のまま出す（タグとして読まない）
 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, loadPlaywright } from './lib.mjs';

const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } };

const sample = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'facility-profile.sample.json'), 'utf8'));
const withPc = (pc) => { const p = JSON.parse(JSON.stringify(sample)); if (pc !== undefined) p.patchCalendar = pc; return p; };
const sites = (n, pre) => Array.from({ length: n }, (_, i) => ({ name: (pre || '場所') + (i + 1), short: (pre || '所') + (i + 1) }));
const NOW = new Date('2026-01-14T10:00:00+09:00');

const srv = await startServer(process.cwd(), 0);
const browser = await chromium.launch();

/* fp: 配る施設情報（null＝404・関数なら要求のたびに呼ぶ）。delay: 施設情報を返すまで待つミリ秒。storage: 開く前に端末へ入れる値 */
async function open(fp, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.route('**/su-backend.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: {} }) }));
  await ctx.route('**/facility-profile.json*', async (r) => {
    if (opts.delay) await new Promise((ok) => setTimeout(ok, typeof opts.delay === 'function' ? opts.delay() : opts.delay));
    const body = typeof fp === 'function' ? fp() : fp;
    if (body === null) return r.fulfill({ status: 404, body: 'no' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  /* 既定はその月の中に開始日を置いた手入力の設定（ますに図が出る）。storage を渡した時はそれだけ */
  const st = Object.assign({ su_device_role: 'office' }, opts.storage === undefined ? { apc2_start: '2026-01-05', apc2_no: '3', apc2_prev: '2' } : opts.storage);
  await ctx.addInitScript((s) => {
    for (const k of Object.keys(s)) localStorage.setItem(k, s[k]);
    window.__printed = 0; window.__alerts = [];
    window.print = function () { window.__printed++; };
    window.alert = function (m) { window.__alerts.push(String(m)); };
    window.confirm = function () { return true; };
  }, st);
  const p = await ctx.newPage();
  await p.clock.setFixedTime(NOW);
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e && e.message)));
  await p.goto(srv.url + '/patch-calendar.html', { waitUntil: 'load' });
  await p.waitForTimeout(opts.wait || 600);
  return { p, ctx, errs };
}
async function look(p) {
  return p.evaluate(() => {
    const q = (s) => document.querySelector(s), qa = (s) => Array.from(document.querySelectorAll(s));
    const sheet = q('#sheet'), ttl = q('.sh-ttl');
    const cells = qa('#weeks .cell');
    const figOut = cells.filter((c) => { const f = c.querySelector('.fig-svg'); if (!f) return false; const a = c.getBoundingClientRect(), b = f.getBoundingClientRect(); return b.left < a.left - 0.5 || b.right > a.right + 0.5 || b.top < a.top - 0.5 || b.bottom > a.bottom + 0.5; }).length;
    const lbOut = qa('#weeks .cell .lb').filter((l) => l.scrollWidth > l.clientWidth + 1).length;
    const guide = q('#guide svg');
    return {
      sub: q('#pcSub').textContent, drugHtml: q('#pcDrug').innerHTML, drug: q('#pcDrug').textContent,
      cap: q('#pcCap').textContent, use: q('#pcLnUse').textContent, back: q('#pcLnBack').textContent,
      viewHidden: q('#pcLnView').hidden, viewShown: getComputedStyle(q('#pcLnView')).display !== 'none',
      noOpts: qa('#no option').map((o) => o.textContent), pvOpts: qa('#pv option').length,
      guideImg: !!(guide && guide.querySelector('image')), guideRects: guide ? guide.querySelectorAll('rect').length : -1,
      guideTexts: guide ? Array.from(guide.querySelectorAll('text')).map((x) => x.textContent) : [],
      cellImgs: qa('#weeks .cell .fig-svg image').length, cellFigs: qa('#weeks .cell .fig-svg').length,
      labels: qa('#weeks .cell .lb').map((l) => l.textContent),
      sheetOver: sheet.scrollHeight > sheet.clientHeight + 1, ttlOver: ttl.scrollWidth > ttl.clientWidth + 1,
      figOut, lbOut, hint: q('#sthint').textContent, docOverX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}
async function pdfPages(p) {
  await p.emulateMedia({ media: 'print' });
  const buf = await p.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
  await p.emulateMedia({ media: 'screen' });
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
}

try {
  /* 1. 書いていない施設 */
  const base = await open(sample);
  const B = await look(base.p);
  t('見本（書いていない）: 背中の写真の図のまま・8箇所', B.guideImg && B.noOpts.length === 8 && B.cellImgs > 0 && B.cellImgs === B.cellFigs, B);
  t('見本: 見出しと注意書きは元の文（® の上付きも残る）', B.sub === 'アリドネパッチの貼付部位（背中8箇所ローテーション）' && /アリドネ<sup>®<\/sup>パッチ／背中8箇所/.test(B.drugHtml)
    && B.cap === '背中（貼る順番）' && /1→2→…→8/.test(B.use) && /8日後です（間隔7日）/.test(B.back) && B.viewShown, B);
  t('見本: 紙は A4 縦1ページ', (await pdfPages(base.p)) === 1);
  t('見本: 画面の例外 0', base.errs.length === 0, base.errs);
  await base.ctx.close();

  /* 2. 6か所・2か所・8か所（独自）＋薬の名前 */
  for (const [n, drug] of [[6, '架空テープ'], [2, '架空の長い名前の貼り薬テープ二十字です'.slice(0, 20)], [8, '架空パッチ']]) {
    for (const width of [1280, 390]) {
      const o = await open(withPc({ drug, sites: sites(n) }), { width });
      const L = await look(o.p);
      const tag = n + 'か所・幅' + width;
      t(tag + ': 選ぶ欄が場所の数（前日は＋なし）', L.noOpts.length === n && L.pvOpts === n + 1 && L.noOpts[0] === '1番（場所1）', L.noOpts);
      t(tag + ': 順番図は写真でなく番号の枠と名前', !L.guideImg && L.guideRects === n && L.guideTexts.indexOf('所1') >= 0 && L.guideTexts.indexOf(String(n)) >= 0, L);
      t(tag + ': ますの図も写真を使わない・名前は場所の短い名前', L.cellImgs === 0 && L.cellFigs > 0 && L.labels.every((x) => /^所\d+$/.test(x) || /番をはがす$/.test(x)), L.labels.slice(0, 5));
      t(tag + ': 文が場所の数と薬の名前に合う', L.sub === drug + 'の貼付部位（' + n + '箇所ローテーション）' && L.drug === drug + '／' + n + '箇所' && L.cap === '貼る場所（貼る順番）'
        && L.use.indexOf(drug + 'は 1日1回1枚。') === 0 && L.use.indexOf(n === 2 ? '1→2 の順' : '1→2→…→' + n) > 0 && L.back.indexOf(n + '日後です（間隔' + (n - 1) + '日）') > 0 && L.viewHidden && !L.viewShown, L);
      t(tag + ': 紙の中ではみ出さない（用紙・見出しの行・ますの図・ますの名前）', !L.sheetOver && !L.ttlOver && L.figOut === 0 && L.lbOut === 0, L);
      if (width === 1280) t(tag + ': 紙は A4 縦1ページ', (await pdfPages(o.p)) === 1);
      t(tag + ': 画面の例外 0', o.errs.length === 0, o.errs);
      await o.ctx.close();
    }
  }

  /* 3. 薬の名前だけ */
  {
    const o = await open(withPc({ drug: '架空テープ' }));
    const L = await look(o.p);
    t('薬の名前だけ: 背中の写真の図と8箇所のまま', L.guideImg && L.noOpts.length === 8 && L.cellImgs === L.cellFigs && L.cap === '背中（貼る順番）' && L.viewShown, L);
    t('薬の名前だけ: 名前だけ替わる', L.sub === '架空テープの貼付部位（背中8箇所ローテーション）' && L.drug === '架空テープ／背中8箇所' && L.use.indexOf('架空テープは 1日1回1枚。') === 0 && /8日後です（間隔7日）/.test(L.back), L);
    t('薬の名前だけ: 紙は A4 縦1ページ', (await pdfPages(o.p)) === 1);
    await o.ctx.close();
  }

  /* 4. 10か所・崩れた値は既定 */
  const bads = [
    ['10か所', { drug: '架空テープ', sites: sites(10) }],
    ['1か所', { sites: sites(1) }],
    ['同じ名前が2つ', { sites: [{ name: '左' }, { name: '左' }] }],
    ['名前が長すぎる（13字）', { sites: [{ name: 'あいうえおかきくけこさしす' }, { name: '右' }] }],
    ['短い名前が無く名前が7字', { sites: [{ name: 'あいうえおかき' }, { name: '右' }] }],
    ['薬の名前が数', { drug: 12 }],
    ['薬の名前にタグ', { drug: '<b>架空</b>' }],
    ['sites が文字', { sites: '左,右' }],
    ['空の塊', {}],
    ['配列', [1, 2]],
  ];
  for (const [nm, pc] of bads) {
    const o = await open(withPc(pc));
    const L = await look(o.p);
    t('崩れた値は既定（' + nm + '）', L.guideImg && L.noOpts.length === 8 && L.sub === B.sub && L.drugHtml === B.drugHtml && L.use === B.use && L.back === B.back && L.viewShown && o.errs.length === 0, { L, errs: o.errs });
    await o.ctx.close();
  }

  /* 5. 控えが無く後から届く・保存してある番号が場所の数を超える */
  {
    const o = await open(withPc({ drug: '架空テープ', sites: sites(6) }), { delay: 700, wait: 150,
      storage: { apc2_start: '2026-01-05', apc2_no: '7', apc2_prev: '0' } });
    const L0 = await look(o.p);
    await o.p.waitForTimeout(1200);
    const L1 = await look(o.p);
    t('届く前は既定（控えが無い）・届いたら6か所に作り直す', L0.noOpts.length === 8 && L1.noOpts.length === 6 && !L1.guideImg && L1.guideRects === 6, { a: L0.noOpts.length, b: L1.noOpts.length });
    t('保存してある7番は6か所では使わず、未設定として知らせる', /初期値です/.test(L1.hint) && /5番（場所5）/.test(L1.hint), L1.hint);
    await o.ctx.close();
  }
  {
    /* 番号が場所の数の中なら、そのまま使う */
    const o = await open(withPc({ sites: sites(6) }), { storage: { apc2_start: '2026-01-05', apc2_no: '4', apc2_prev: '3' } });
    const L = await look(o.p);
    t('保存してある4番は6か所でもそのまま使う（確定のまま）', !/初期値です/.test(L.hint) && /4番（場所4）/.test(L.hint), L.hint);
    await o.ctx.close();
  }
  {
    /* 4か所: 既定の開始番号5・前日2 は範囲外なので 1番・なし */
    const o = await open(withPc({ sites: sites(4) }), { storage: {} });
    const L = await look(o.p);
    t('4か所で設定が無い時は 1番から（既定の5番は使わない）', /1番（場所1）/.test(L.hint) && o.errs.length === 0, L.hint);
    await o.ctx.close();
  }

  /* 6. 施設情報が読めない時は刷らない・読めれば刷る */
  {
    const o = await open(null, { wait: 300 });
    await o.p.click('#print');
    await o.p.waitForTimeout(3600);
    const r = await o.p.evaluate(() => ({ printed: window.__printed, alerts: window.__alerts }));
    t('施設情報が読めない時は印刷の画面を開かず知らせる', r.printed === 0 && r.alerts.length === 1 && /施設情報が読めません/.test(r.alerts[0]), r);
    await o.ctx.close();
  }
  {
    const o = await open(withPc({ sites: sites(6) }));
    await o.p.click('#print');
    await o.p.waitForTimeout(200);
    const r = await o.p.evaluate(() => ({ printed: window.__printed, alerts: window.__alerts }));
    t('読めている時はその場で印刷の画面を開く（今までどおり）', r.printed === 1 && r.alerts.length === 0, r);
    await o.ctx.close();
  }
  {
    /* 控えが無く、押した時にまだ届いていない → 届くのを待って、作り直してから刷る */
    const o = await open(withPc({ drug: '架空テープ', sites: sites(6) }), { delay: 1200, wait: 150 });
    await o.p.click('#print');
    await o.p.waitForTimeout(1800);
    const r = await o.p.evaluate(() => ({ printed: window.__printed, n: document.querySelectorAll('#no option').length }));
    t('押した時に届いていなければ待ち、6か所に作り直してから1回だけ刷る', r.printed === 1 && r.n === 6, r);
    await o.ctx.close();
  }

  /* 8. 名簿から選んだ方（架空の2名）。1人目は7番・2人目は4番を保存してある。控えが無く、施設情報（6か所）は後から届く */
  {
    const roster = JSON.stringify({ residents: [{ masterId: 'X1', name: '架空 一郎', room: '101', kana: 'かくう', active: true },
      { masterId: 'X2', name: '架空 二郎', room: '102', kana: 'かくう', active: true }] });
    const at = '2026-01-10T01:00:00.000Z';
    const res = JSON.stringify({ v: 1, r: { X1: { start: '2026-01-05', no: 7, prev: 0, by: '事務所PC', at }, X2: { start: '2026-01-05', no: 4, prev: 3, by: '事務所PC', at } } });
    const o = await open(withPc({ drug: '架空テープ', sites: sites(6) }), { delay: 900, wait: 150, storage: { su_residents_common: roster, apc2_res: res } });
    await o.p.selectOption('#rs', 'X2');
    const L0 = await look(o.p);
    await o.p.waitForTimeout(1400);
    const L1 = await look(o.p);
    const rs1 = await o.p.$eval('#rs', (e) => e.value);
    t('名簿から選んだ方: 届く前は既定で4番・届いて作り直しても選んだ方のまま4番（確定のまま）',
      L0.noOpts.length === 8 && /4番（右・2段目）/.test(L0.hint) && rs1 === 'X2' && L1.noOpts.length === 6 && /4番（場所4）/.test(L1.hint) && !/まだ設定されていません|初期値/.test(L1.hint), { h0: L0.hint, h1: L1.hint, rs1 });
    await o.p.selectOption('#rs', 'X1');
    const L2 = await look(o.p);
    t('名簿から選んだ方: 保存してある7番は6か所では使わず、未設定として知らせる', /この方の開始日と場所はまだ設定されていません/.test(L2.hint) && /1番（場所1）/.test(L2.hint), L2.hint);
    const kept = await o.p.evaluate(() => JSON.parse(localStorage.getItem('apc2_res')).r.X1.no);
    t('名簿から選んだ方: 開いただけでは保存してある7番を書き換えない', kept === 7, kept);
    t('名簿から選んだ方: 画面の例外 0', o.errs.length === 0, o.errs);
    await o.ctx.close();
  }

  /* 9. 端末の控えに6か所があり、届いた施設情報から外れていた（見本に戻した）時は元に戻る */
  {
    let cur = withPc({ drug: '架空テープ', sites: sites(6) }), slow = 0;
    const o = await open(() => cur, { delay: () => slow });
    const A = await look(o.p);
    cur = sample; slow = 900;
    await o.p.reload({ waitUntil: 'load' });
    await o.p.waitForTimeout(150);
    const L0 = await look(o.p);
    await o.p.waitForTimeout(1400);
    const L1 = await look(o.p);
    t('控えの6か所で最初から描く（届く前）', A.noOpts.length === 6 && L0.noOpts.length === 6 && !L0.guideImg, { a: A.noOpts.length, b: L0.noOpts.length });
    t('届いた施設情報に無ければ、見本と同じ文・背中の写真の図・8箇所に戻る',
      L1.guideImg && L1.noOpts.length === 8 && L1.cellImgs === L1.cellFigs && L1.sub === B.sub && L1.drugHtml === B.drugHtml && L1.cap === B.cap && L1.use === B.use && L1.back === B.back && L1.viewShown && !L1.viewHidden, L1);
    t('戻した後も画面の例外 0', o.errs.length === 0, o.errs);
    await o.ctx.close();
  }

  /* 7. 外からの文字は文字のまま */
  {
    const o = await open(withPc({ drug: '架空"&テープ', sites: [{ name: '左&右"1', short: '左&1' }, { name: '右\'2' }] }));
    const L = await look(o.p);
    t('記号の入った名前は文字のまま出る（タグとして読まない）', L.drug === '架空"&テープ／2箇所' && L.noOpts[0] === '1番（左&右"1）' && L.guideTexts.indexOf('左&1') >= 0 && !/<b>|<script/.test(L.drugHtml.replace(/<sup>®<\/sup>/, '')), L);
    await o.ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`\n${pass} 合格 / ${fail} 不合格`);
process.exit(fail ? 1 : 0);
