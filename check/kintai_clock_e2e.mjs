/* check/kintai_clock_e2e.mjs — 出勤・退勤の打刻（kintai-clock.html・タブレット）の通し試験（2026-11-27 新設）
 *
 *   node check/kintai_clock_e2e.mjs [--shots <保存先>] [--old-css]
 *
 * 本物の Chromium で開き、Supabase への通信は全部横取りする（ログインは check/fixtures/kintai.mjs・打刻の関数 kintai_clock_* はこの中の偽物）。
 * iPad 横（1024×768）と iPhone（390×844）で確かめること:
 *   A. 番号で打刻 → 名前を確かめる画面: 覆いの見た目（su-app-gate.css）が読み込まれた状態で、「出勤」「退勤」「番号を入れ直す」が見えて押せる。
 *      どのボタンも画面の半分より大きくない。勧めるボタン（sug）に印の枠の影がある
 *      （2026-11-27: 覆いの裸の .sug が勧めるボタンに当たり、全画面のボタンになって押した方と違う打刻になっていた）
 *   B. 出勤していない人: 「出勤」で出勤を送る・「退勤」で退勤を送る。出勤中の人: 勧めは退勤・「出勤」を押すと「もう一度出勤を記録しますか」の確かめ（送らない）
 *   C. 氏名を選ぶ流れ（名前 → パスコード → 出勤）・番号が違う時・パスコードが違う時・通信できない時（控えて送信待ちの札）が今までどおり
 *   E. 検品の直し（2026-11-27）: 名前の行が1字だけ折れない・氏名の札が名前の途中で折れない・番号で打刻のボタン 280×48 以上・「やめる」はほかのボタンと 16px 以上・完了の画面の字 15px 以上と差 4.5:1 以上（iPad 横・iPhone・暗い表示）
 *   D. 覆い（ログインしていない時の SUAppGate の覆い）は全画面を覆い、下の画面を押せない。打刻の画面と勤怠管理の画面で、
 *      覆いの絵が直す前の決まり（.sug）と同じ（覆いの見え方が変わっていない）
 * --old-css: 直す前の覆いの決まり（裸の .sug）を出して回す。A が落ちることを確かめる時だけ使う。
 * ★架空データだけ（職員の名前は「見本 …」・本物の Supabase へは出ない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs, ensureDir } from './lib.mjs';
import * as FX from './fixtures/kintai.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const SHOTS = args.shots ? ensureDir(path.resolve(String(args.shots))) : null;
const OLD = !!args['old-css'];
const { chromium } = loadPlaywright();
let pass = 0, fail = 0;
const t = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } };

const FIXED = new Date('2026-01-14T09:00:00+09:00');
const at = (hm) => '2026-01-14T' + hm + ':00+09:00';
const STAFF = [['s1', '見本 一郎', 'facility'], ['s2', '見本 二美', 'facility'], ['s3', '見本 三太', 'visit'], ['s4', '見本 四子', 'day'], ['s5', '見本 甲乙丙丁戊己庚辛', 'facility']];   /* s5 は長い名前（全角10字＋空白・記号の漢字だけ） */
/* 31人の架空の名簿（「見本 …」の形・名の長さは1〜3字。1210×710・1194×700 の iPad 横で、氏名を選ぶ画面に送らずに入る決まり 83699af を確かめる） */
const GIVEN = ['甲', '甲一', '甲四己', '乙', '乙二', '乙五庚', '丙', '丙三', '丙六辛', '丁', '丁四', '丁七壬', '戊', '戊五', '戊八癸', '己', '己六', '己九甲', '庚', '庚七', '庚十乙', '辛', '辛八', '辛一丙', '壬九', '癸十', '甲二', '乙三', '壬二丁', '癸三戊', '甲四庚'];   /* 記号の漢字だけで作った架空の名（十干＋数の漢字・1〜3字）。実在の名前に当たらないように */
const STAFF31 = GIVEN.map((g, i) => ['m' + (i + 1), '見本 ' + g, ['facility', 'visit', 'day'][i % 3]]);
const CODES = { '1234': 's1', '2345': 's2', '5678': 's5' };   /* s2 は今日 08:58 に出勤済み（勤務中） */
const RECENT = [['in', '見本 二美', '08:58'], ['in', '見本 三太', '08:51'], ['out', '見本 四子', '08:30']];
/* 直した覆いの決まり（:where(#su-app-gate).sug）を、直す前の形（裸の .sug）へ戻したもの。覆いの絵の見比べと --old-css に使う */
const CSS_NEW = fs.readFileSync(path.join(ROOT, 'su-app-gate.css'), 'utf8');
const CSS_OLD = CSS_NEW.replace(/:where\(#su-app-gate\)\.sug(?![-\w])/g, '.sug');
if (CSS_OLD === CSS_NEW) throw new Error('覆いの決まりの書き方が変わったため、直す前の形を作れません（この試験を直してください）');

const srv = await startServer(ROOT);
const browser = await chromium.launch();

async function open(vp, o = {}) {
  const st = { punches: [], checks: [] };
  const ctx = await browser.newContext({ viewport: vp, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', hasTouch: vp.width < 900, colorScheme: o.dark ? 'dark' : 'light' });
  const storage = Object.assign({}, FX.storage);
  if (o.noLogin) delete storage['sb-jhbernqawjrzqwrmqrih-auth-token'];
  await ctx.addInitScript((s) => { for (const k in s) localStorage.setItem(k, s[k]); }, storage);
  for (const r of FX.routes) await ctx.route(r.match, r.handle);
  const css = o.oldCss || OLD ? CSS_OLD : CSS_NEW;
  await ctx.route(/\/su-app-gate\.css(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css }));
  await ctx.route(/\/rest\/v1\/rpc\/kintai_clock_[a-z]+$/, (route) => {
    const req = route.request(), name = /kintai_clock_([a-z]+)$/.exec(req.url())[1];
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let p = {}; try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
    const who = (sid) => { const s = STAFF.find((x) => x[0] === sid); return { name: s[1], state: sid === 's2' ? 'in' : null, last_at: sid === 's2' ? at('08:58') : null }; };
    if (name === 'roster') return json({ ok: true, staff: (o.roster || STAFF).map(([id, nm, off]) => ({ id, name: nm, office: off })) });
    if (name === 'check') { st.checks.push(p); return json(CODES[p.p_code] === p.p_staff_id ? { ok: true, staff: who(p.p_staff_id) } : { ok: false, error: 'notfound' }); }
    if (name === 'lookup') return json(CODES[p.p_code] ? { ok: true, staff: who(CODES[p.p_code]) } : { ok: false, error: 'notfound' });
    if (name === 'punch') {
      st.punches.push(p);
      if (o.offline) return route.abort('internetdisconnected');
      const sid = CODES[p.p_code];
      return json(sid ? { ok: true, name: STAFF.find((x) => x[0] === sid)[1], at: FIXED.toISOString(), dup: false } : { ok: false, error: 'notfound' });
    }
    if (name === 'recent') return json({ ok: true, items: RECENT.map(([k, n, tm]) => ({ kind: k, name: n, at: at(tm) })) });
    return json({ ok: false, error: 'format' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  /* 時刻は 2026-01-14 09:00 から進める（二度押しの止めが時刻の差を見るため） */
  await page.clock.install({ time: FIXED }); await page.clock.resume();
  page.on('dialog', (d) => d.accept());
  await page.goto(srv.url + '/' + (o.page || 'kintai-clock.html'));
  if (!o.noLogin && !o.page) { await page.waitForSelector('#k-body:not([hidden])', { timeout: 15000 }); await page.waitForTimeout(800); }
  return { ctx, page, st, errors };
}
/* 指で押すのと同じく、ボタンの真ん中の位置を押す（重なった別の物があれば、それが押される） */
const tap = async (page, sel) => { await page.waitForTimeout(900); const b = await page.$(sel); await b.evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(100); const r = await b.boundingBox();   /* 真ん中へ送ってから押す（iPhone の幅では右下の「不具合を報告」が下の段に重なるため） */ await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await page.waitForTimeout(500); };
const keys = async (page, s) => { for (const c of s) { await page.click('#k-panel [data-k="' + c + '"]'); await page.waitForTimeout(60); } };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const byCode = async (page, code) => { await tap(page, '#k-panel [data-k="bycode"]'); await keys(page, code); await tap(page, '#k-panel [data-k="ok"]'); await page.waitForTimeout(500); };
/* 名前を確かめる画面のボタンを測る: 見えている・真ん中の位置で押されるのがそのボタン自身・画面の半分より小さい・勧めるボタンに影 */
const measureWho = (page) => page.evaluate(() => {
  const W = window.innerWidth, H = window.innerHeight;
  const pick = (sel) => {
    const b = document.querySelector(sel); if (!b) return null;
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(Math.min(W - 1, Math.max(0, cx)), Math.min(H - 1, Math.max(0, cy)));
    return { text: b.textContent.trim(), vis: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H, self: !!hit && (hit === b || b.contains(hit)), half: r.width * r.height < W * H / 2, sug: b.classList.contains('sug'), shadow: getComputedStyle(b).boxShadow };
  };
  return { css: !!document.querySelector('link[data-su-app-gate]'), inBtn: pick('#k-panel [data-p="in"]'), outBtn: pick('#k-panel [data-p="out"]'), back: pick('#k-panel [data-k="back"]') };
});
const okBtn = (x) => !!x && x.vis && x.self && x.half;

try {
  for (const [vn, vp] of [['iPad 横', { width: 1024, height: 768 }], ['iPhone', { width: 390, height: 844 }]]) {
    console.log('\n— A・B. 番号で打刻（' + vn + '） —');
    /* 出勤していない人（s1）: 勧めは出勤 */
    let o = await open(vp);
    await byCode(o.page, '1234');
    await o.page.waitForSelector('#k-panel [data-p="in"]', { timeout: 10000 });
    let w = await measureWho(o.page);
    t('A ' + vn + ': 覆いの見た目（su-app-gate.css）が読み込まれている', w.css);
    t('A ' + vn + ': 「出勤」「退勤」「番号を入れ直す」が見えて押せる（真ん中を押すとそのボタン）・どれも画面の半分より小さい', okBtn(w.inBtn) && okBtn(w.outBtn) && okBtn(w.back), w);
    t('A ' + vn + ': 勧めるボタン（出勤）に印の枠の影がある', !!w.inBtn && w.inBtn.sug && /rgba?\(/.test(w.inBtn.shadow) && !w.outBtn.sug, w.inBtn && w.inBtn.shadow);
    await shot(o.page, 'clock-who-' + vp.width);
    await tap(o.page, '#k-panel [data-p="in"]');
    await o.page.waitForTimeout(500);
    t('B ' + vn + ': 出勤していない人が「出勤」を押すと出勤を送る', o.st.punches.length === 1 && o.st.punches[0].p_kind === 'in' && o.st.punches[0].p_code === '1234', o.st.punches.map((x) => x.p_kind));
    await o.ctx.close();
    o = await open(vp);
    await byCode(o.page, '1234');
    await o.page.waitForSelector('#k-panel [data-p="out"]', { timeout: 10000 });
    await tap(o.page, '#k-panel [data-p="out"]');
    await o.page.waitForTimeout(500);
    t('B ' + vn + ': 出勤していない人が「退勤」を押すと退勤を送る', o.st.punches.length === 1 && o.st.punches[0].p_kind === 'out', o.st.punches.map((x) => x.p_kind));
    await o.ctx.close();
    /* 出勤中の人（s2）: 勧めは退勤。「出勤」を押すと確かめ */
    o = await open(vp);
    await byCode(o.page, '2345');
    await o.page.waitForSelector('#k-panel [data-p="in"]', { timeout: 10000 });
    w = await measureWho(o.page);
    t('A ' + vn + ': 出勤中の人も3つが見えて押せる・勧めは退勤（影）', okBtn(w.inBtn) && okBtn(w.outBtn) && okBtn(w.back) && w.outBtn.sug && /rgba?\(/.test(w.outBtn.shadow) && !w.inBtn.sug, w);
    await tap(o.page, '#k-panel [data-p="in"]');
    await o.page.waitForSelector('#k-panel .ask', { timeout: 5000 }).catch(() => {});
    const ask = await o.page.textContent('#k-panel').catch(() => '');
    t('B ' + vn + ': 出勤中の人が「出勤」を押すと「もう一度出勤を記録しますか」の確かめ（まだ送らない）', /もう出勤しています（08:58 に出勤）。もう一度出勤を記録しますか？/.test(ask) && o.st.punches.length === 0, [ask.slice(0, 80), o.st.punches.map((x) => x.p_kind)]);
    await shot(o.page, 'clock-ask-' + vp.width);
    t('A・B ' + vn + ': 画面の例外 0', o.errors.length === 0, o.errors);
    await o.ctx.close();

    console.log('\n— C. 今までの動き（' + vn + '） —');
    o = await open(vp);
    await tap(o.page, '[data-g="in"]');
    await o.page.waitForSelector('#k-panel [data-sid="s1"]', { timeout: 10000 });
    await tap(o.page, '#k-panel [data-sid="s1"]');
    await keys(o.page, '9999'); await tap(o.page, '#k-panel [data-k="ok"]');
    await o.page.waitForFunction(() => /パスコードが違います/.test(document.getElementById('k-panel').textContent), null, { timeout: 5000 }).catch(() => {});
    t('C ' + vn + ': 氏名を選ぶ流れ: パスコードが違うと「パスコードが違います」・送らない', /パスコードが違います。もう一度入れてください（あと 2 回）/.test(await o.page.textContent('#k-panel')) && o.st.punches.length === 0);
    await o.page.waitForTimeout(1000);   /* 打ち直しは、知らせを出し直した直後の二度押しの止めが外れてから */
    await keys(o.page, '1234'); await tap(o.page, '#k-panel [data-k="ok"]');
    await o.page.waitForSelector('#k-panel .done', { timeout: 10000 }).catch(() => {});
    const doneTxt = await o.page.textContent('#k-panel').catch(() => '');
    t('C ' + vn + ': 氏名を選ぶ流れ: 名前 → パスコードで出勤を送り、完了の画面に名前と「出勤」', o.st.punches.length === 1 && o.st.punches[0].p_kind === 'in' && /見本 一郎 さん/.test(await o.page.textContent('#k-panel .done')) && /出勤/.test(await o.page.textContent('#k-panel .done')), [doneTxt.slice(0, 120), o.st.punches.length, o.st.checks.length]);
    await o.ctx.close();
    o = await open(vp);
    await byCode(o.page, '0000');
    t('C ' + vn + ': 番号が違うと「その番号は見つかりませんでした」・送らない', /その番号は見つかりませんでした/.test(await o.page.textContent('#k-panel')) && o.st.punches.length === 0);
    await o.ctx.close();
    o = await open(vp, { offline: true });
    await byCode(o.page, '1234');
    await o.page.waitForSelector('#k-panel [data-p="in"]', { timeout: 10000 });
    await tap(o.page, '#k-panel [data-p="in"]');
    await o.page.waitForFunction(() => /出勤を控えました/.test(document.getElementById('k-panel').textContent), null, { timeout: 15000 }).catch(() => {});
    const q = await o.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('kintai_clock_queue') || '[]').length; } catch (e) { return -1; } });
    t('C ' + vn + ': 通信できない時は控えて「出勤を控えました」・送信待ちの札', /出勤を控えました/.test(await o.page.textContent('#k-panel')) && /送信待ちの打刻 1 件/.test(await o.page.textContent('#k-foot')), q);
    await o.ctx.close();
  }

  /* ── E. 検品の指摘の直し（2026-11-27）: 名前の折れ方・番号で打刻のボタン・やめるの間・完了の画面の字 ── */
  /* 文字を1つずつ測って、見た目の行に分ける（折れた所が分かる） */
  const linesOf = (page, sel) => page.evaluate((q) => Array.from(document.querySelectorAll(q)).filter((e) => e.getClientRects().length).map((e) => {
    const out = []; let cur = '', top = null;
    const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      for (let i = 0; i < n.textContent.length; i++) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getClientRects()[0]; if (!b || !b.width) { cur += n.textContent[i]; continue; }
        if (top !== null && Math.abs(b.top - top) > b.height / 2) { out.push(cur); cur = ''; }
        if (top === null || Math.abs(b.top - top) > b.height / 2) top = b.top;
        cur += n.textContent[i];
      }
    }
    out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
  }), sel);
  const lastOk = (ls) => ls.length === 1 || ls[ls.length - 1].replace(/\s/g, '').length >= 2;
  for (const [vn, vp, dark] of [['iPad 横', { width: 1024, height: 768 }, false], ['iPhone', { width: 390, height: 844 }, false], ['iPad 横・暗い表示', { width: 1024, height: 768 }, true]]) {
    console.log('\n— E. 検品の直し（' + vn + '） —');
    let o = await open(vp, { dark });
    const hc = await o.page.evaluate(() => { const r = document.querySelector('#k-panel [data-k="bycode"]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    t('E ' + vn + ': 「名前が出ない時は 番号で打刻」は幅 280px 以上・高さ 48px 以上', hc.w >= 280 && hc.h >= 48, hc);
    await tap(o.page, '[data-g="in"]');
    await o.page.waitForSelector('#k-panel [data-sid="s5"]', { timeout: 10000 });
    const names = await linesOf(o.page, '#k-panel .nm');
    /* 名前の途中で折れない＝折れた所の前後をつなぐと空白（姓と名の間）だけ。ただし、札の中身の幅より広い1語（例 8字の名）は、どう並べても1行に入らないので途中で折れてよい
       （2026-11-27 審査役の指摘で iPad 横の列は6列のまま＝31人が1画面の決まり。札の幅は変えない） */
    const nmInfo = await o.page.evaluate(() => Array.from(document.querySelectorAll('#k-panel .nm')).map((e) => {
      const cs = getComputedStyle(e), inner = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font; document.body.appendChild(probe);
      const wide = e.textContent.trim().split(/\s+/).some((w) => { probe.textContent = w; return probe.getBoundingClientRect().width > inner + 0.5; });
      probe.remove(); return { full: e.textContent, wide };
    }));
    const midBreak = names.map((ls, i) => ({ ls, full: nmInfo[i].full, wide: nmInfo[i].wide })).filter((x) => !x.wide && x.ls.length > 1 && x.ls.join(' ') !== x.full.replace(/\s+/g, ' ').trim());
    t('E ' + vn + ': 氏名を選ぶ札は、名前の途中で折れない（折れるのは姓と名の間の空白だけ・札の中身より広い1語だけは除く）', names.length === 5 && midBreak.length === 0, { names, midBreak, wide: nmInfo.filter((x) => x.wide).map((x) => x.full) });
    await tap(o.page, '#k-panel [data-sid="s5"]');
    await o.page.waitForSelector('#k-panel .who', { timeout: 10000 });
    const pw = await linesOf(o.page, '#k-panel .who');
    t('E ' + vn + ': パスコードの画面の名前の行（長い名前）は1行か、2行でも最後の行が2字以上', pw.length === 1 && lastOk(pw[0]), pw);
    const gap = await o.page.evaluate(() => {
      const bk = document.querySelector('#k-panel [data-k="home"]').getBoundingClientRect();
      const others = Array.from(document.querySelectorAll('#k-panel button, #k-kinds button')).filter((b) => b.getAttribute('data-k') !== 'home' && b.getClientRects().length).map((b) => b.getBoundingClientRect());
      const d = (a, b) => Math.max(0, Math.max(a.left - b.right, b.left - a.right), Math.max(a.top - b.bottom, b.top - a.bottom));
      return Math.round(Math.min(...others.map((r) => d(bk, r))));
    });
    t('E ' + vn + ': パスコードの画面の「やめる」は、ほかのボタンと 16px 以上離れている', gap >= 16, gap);
    await o.ctx.close();
    /* 番号の流れの名前の画面（長い名前） */
    o = await open(vp, { dark });
    await byCode(o.page, '5678');
    await o.page.waitForSelector('#k-panel [data-p="in"]', { timeout: 10000 });
    const ww = await linesOf(o.page, '#k-panel .who');
    t('E ' + vn + ': 名前を確かめる画面の名前の行（長い名前）は1行か、2行でも最後の行が2字以上', ww.length === 1 && lastOk(ww[0]), ww);
    await o.ctx.close();
    /* 完了の画面の「画面を押すと、すぐ次の人へ」 */
    o = await open(vp, { dark });
    await byCode(o.page, '1234');
    await o.page.waitForSelector('#k-panel [data-p="in"]', { timeout: 10000 });
    await tap(o.page, '#k-panel [data-p="in"]');
    await o.page.waitForSelector('#k-panel .d-tap', { timeout: 10000 });
    const dt = await o.page.evaluate(() => {
      const e = document.querySelector('#k-panel .d-tap'), cs = getComputedStyle(e);
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const L = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      let bgEl = e, bg = 'rgba(0, 0, 0, 0)'; while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(bgEl).backgroundColor; bgEl = bgEl.parentElement; }
      const a = L(rgb(cs.color)), b = L(rgb(bg)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { fs: parseFloat(cs.fontSize), ratio: Math.round(ratio * 10) / 10, opacity: cs.opacity };
    });
    t('E ' + vn + ': 打刻した直後の「画面を押すと、すぐ次の人へ」は 15px 以上・地との差 4.5:1 以上', dt.fs >= 15 && dt.ratio >= 4.5 && +dt.opacity === 1, dt);
    t('E ' + vn + ': 画面の例外 0', o.errors.length === 0, o.errors);
    await o.ctx.close();
  }

  /* ── F. 31人が送らずに1画面（83699af の決まり・審査役の指摘 2026-11-27）: 氏名を選ぶ画面は6列のまま ── */
  for (const vp of [{ width: 1210, height: 710 }, { width: 1194, height: 700 }]) {
    const o = await open(vp, { roster: STAFF31 });
    await tap(o.page, '[data-g="in"]');
    await o.page.waitForSelector('#k-panel [data-sid="m31"]', { timeout: 10000 });
    const f = await o.page.evaluate(() => {
      const nm = Array.from(document.querySelectorAll('#k-panel .nm')), last = nm.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
      const cols = new Set(nm.map((e) => Math.round(e.getBoundingClientRect().left))).size;
      return { n: nm.length, cols, lastBottom: Math.round(last), vh: window.innerHeight, scroll: document.documentElement.scrollHeight - window.innerHeight, maxH: Math.round(Math.max(...nm.map((e) => e.getBoundingClientRect().height))) };
    });
    t('F ' + vp.width + '×' + vp.height + ': 氏名を選ぶ画面の31人が送らずに1画面に入る（6列・いちばん下の札の下端が画面の高さ以内・札は2行の高さのまま）', f.n === 31 && f.cols === 6 && f.lastBottom <= f.vh && f.maxH <= 58, f);
    const ls = await linesOf(o.page, '#k-panel .nm');
    const txt = await o.page.evaluate(() => Array.from(document.querySelectorAll('#k-panel .nm')).map((e) => e.textContent));
    const bad = ls.map((l, i) => ({ l, full: txt[i] })).filter((x) => x.l.length > 2 || (x.l.length > 1 && x.l.join(' ') !== x.full.replace(/\s+/g, ' ').trim()));
    t('F ' + vp.width + '×' + vp.height + ': 名（1〜3字）は途中で折れない（2行までで、折れるのは姓と名の間の空白だけ）', bad.length === 0, bad.slice(0, 5));
    await shot(o.page, 'clock-pick31-' + vp.width);
    await o.ctx.close();
  }

  console.log('\n— D. 覆い（ログインしていない時） —');
  for (const pg of ['kintai-clock.html', 'kintai.html']) {
    const shots = {};
    for (const which of ['new', 'old']) {
      const o = await open({ width: 1024, height: 768 }, { noLogin: true, page: pg, oldCss: which === 'old' });
      await o.page.waitForSelector('#su-app-gate', { timeout: 15000 });
      await o.page.waitForTimeout(800);
      if (which === 'new') {
        const g = await o.page.evaluate(() => {
          const b = document.getElementById('su-app-gate'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
          const hit = document.elementFromPoint(512, 600);
          const under = Array.from(document.body.children).filter((c) => c !== b && c.getClientRects().length > 0 && getComputedStyle(c).display !== 'none').map((c) => c.id || c.tagName);
          return { full: r.left === 0 && r.top === 0 && Math.round(r.width) === window.innerWidth && Math.round(r.height) === window.innerHeight, pos: cs.position, z: cs.zIndex, hitIn: !!hit && b.contains(hit), under };
        });
        t('D ' + pg + ': 覆いは全画面（fixed・最前面）で、下の画面は出さず押せない', g.full && g.pos === 'fixed' && +g.z >= 2147483000 && g.hitIn && g.under.length === 0, g);
      }
      shots[which] = await o.page.screenshot({ animations: 'disabled', caret: 'hide' });   /* 回る印の途中の絵で違いが出ないように */
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'gate-' + pg.replace('.html', '') + '-' + which + '.png'), shots[which]);
      await o.ctx.close();
    }
    t('D ' + pg + ': 覆いの絵は直す前の決まり（裸の .sug）と画素まで同じ', Buffer.compare(shots.new, shots.old) === 0);
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
