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
const STAFF = [['s1', '見本 一郎', 'facility'], ['s2', '見本 二美', 'facility'], ['s3', '見本 三太', 'visit'], ['s4', '見本 四子', 'day']];
const CODES = { '1234': 's1', '2345': 's2' };   /* s2 は今日 08:58 に出勤済み（勤務中） */
const RECENT = [['in', '見本 二美', '08:58'], ['in', '見本 三太', '08:51'], ['out', '見本 四子', '08:30']];
/* 直した覆いの決まり（:where(#su-app-gate).sug）を、直す前の形（裸の .sug）へ戻したもの。覆いの絵の見比べと --old-css に使う */
const CSS_NEW = fs.readFileSync(path.join(ROOT, 'su-app-gate.css'), 'utf8');
const CSS_OLD = CSS_NEW.replace(/:where\(#su-app-gate\)\.sug(?![-\w])/g, '.sug');
if (CSS_OLD === CSS_NEW) throw new Error('覆いの決まりの書き方が変わったため、直す前の形を作れません（この試験を直してください）');

const srv = await startServer(ROOT);
const browser = await chromium.launch();

async function open(vp, o = {}) {
  const st = { punches: [], checks: [] };
  const ctx = await browser.newContext({ viewport: vp, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', hasTouch: vp.width < 900 });
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
    if (name === 'roster') return json({ ok: true, staff: STAFF.map(([id, nm, off]) => ({ id, name: nm, office: off })) });
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
