/* check/kintai_self_e2e.mjs — 自分の勤怠（職員本人のスマホの画面・kintai-self.html）の通し試験（2026-11-20 契約 ROOT-v5-freee.md「段5」・care-backend 統合 0114）
 *
 *   node check/kintai_self_e2e.mjs [--shots <保存先>]
 *
 * 本物の Chromium（iPhone の幅 390px）で、通信は全部横取りする（外へは出ない・架空の職員と架空の時刻だけ）。受け口 kintai-self は偽物（メモリの中の決まり）。
 *   A. 登録: #c=QR の番号 で開く → 住所から番号が消える → 暗証番号を2回 → 受け口へ {op:'redeem', code, pin} だけ → 鍵だけが端末に残る → 続けて開く → 表示名が出る
 *   B. 勤怠: 今月分の日ごとの予定・打刻・数えた時刻・実働が出る。前の月分へ切り替えられる。横にはみ出さない
 *   C. 有給: 残りと期限が出る
 *   D. 申請: 打刻の直しを出す → 一覧に「承認待ち」→ 取り下げる。送る中身は決まった形だけ
 *   E. 閉じる: 暗証番号の画面へ戻り、表示名・勤怠・申請が画面から消える。端末に残るのは鍵とタブの印だけ
 *   F. 2分さわらない: 暗証番号の画面へ戻る（時計を進める）
 *   G. 暗証番号の違い: 残りの回数が出る・開かない
 *   H. 鍵が使えない（取り消し）: 登録の画面に戻り、鍵を端末から消す
 *   I. 暗い表示でも開ける・印刷には中身を出さない
 * --shots を付けると、各画面を <保存先>/kintai-self-*.png に撮る（目で確かめる用・架空データ）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, startServer, parseArgs } from './lib.mjs';

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const shots = args.shots || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();
const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';
const EP = '/functions/v1/kintai-self';
const CODE = '0123456789abcdef0123456789abcdef01234567';
const KEY = 'b'.repeat(64), OPEN = 'c'.repeat(64);
const SID = 'kakuu-s1';
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

/* 今月分の架空の勤怠（今日の月の1日〜3日） */
const pad = (n) => (n < 10 ? '0' : '') + n;
const jst = new Date(Date.now() + 9 * 3600000);
const YM = jst.getUTCFullYear() + '-' + pad(jst.getUTCMonth() + 1);
const prevYm = (ym) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m < 1) { m = 12; y--; } return y + '-' + pad(m); };
const lastDay = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
function monthOf(ym) {
  const d1 = ym + '-01', d2 = ym + '-02';
  return {
    ok: true, period: { from: d1, to: ym + '-' + pad(lastDay(ym)), lead_from: d1, close_day: 0 },
    staff: [{ staff_id: SID, name: '架空 本人', display_name: '表示 架空', office: 'facility', employment: null, active: true }],
    punches: [{ id: 'p1', staff_id: SID, kind: 'in', at: d1 + 'T08:55:00+09:00', source: 'tablet', created_at: d1 + 'T08:55:00+09:00', voided_at: null },
              { id: 'p2', staff_id: SID, kind: 'out', at: d1 + 'T18:05:00+09:00', source: 'tablet', created_at: d1 + 'T18:05:00+09:00', voided_at: null }],
    schedule: [{ staff_id: SID, work_date: d1, seq: 0, office: 'facility', start_at: d1 + 'T09:00:00+09:00', end_at: d1 + 'T18:00:00+09:00', break_min: 60, kind: 'work', symbol: '日', paid_min: 0 },
               { staff_id: SID, work_date: d2, seq: 0, office: 'facility', start_at: null, end_at: null, break_min: 0, kind: 'paid', symbol: '有', paid_min: 480 }],
    days: [], month: null, settings: { config: {} }, leave_uses: [],
  };
}
const LEAVE = {
  ok: true, staff_id: SID, hire_date: null, profile: null,
  grants: [{ id: 'g1', staff_id: SID, grant_date: prevYm(prevYm(YM)) + '-01', days: 10, kind: 'manual', created_at: '2020-01-01T00:00:00Z', voided_at: null }],
  uses: [], months: [{ ym: YM, from: YM + '-01', to: YM + '-' + pad(lastDay(YM)), locked: false, config: {} }], schedule: monthOf(YM).schedule,
};

function fake(opts = {}) {
  const st = { bodies: [], outside: [], reqs: [], hashAtSend: [] };
  st.handle = (b) => {
    if (b.op === 'redeem') return b.code === CODE && /^[0-9]{4}$/.test(b.pin) ? { ok: true, key: KEY } : { ok: false, error: 'invalid' };
    if (b.op === 'forget') return { ok: true };
    if (b.key !== KEY || opts.nokey) return { ok: false, error: 'nokey' };
    if (b.op === 'pin') return b.pin === '1357' ? { ok: true, open: OPEN, name: '表示 架空', until: new Date(Date.now() + 300000).toISOString() } : { ok: false, error: 'wrong', left: 3 };
    if (b.open !== OPEN) return { ok: false, error: 'closed' };
    if (b.op === 'month') return monthOf(b.ym);
    if (b.op === 'leave') return LEAVE;
    if (b.op === 'requests') return { ok: true, rows: st.reqs };
    if (b.op === 'request_add') { const r = { id: '00000000-0000-4000-8000-00000000e2e' + st.reqs.length, kind: b.kind, work_date: b.work_date, ym: b.ym || YM, body: b.body, reason: b.reason, status: 'pending', rev: 1, created_at: new Date().toISOString() }; st.reqs.unshift(r); return { ok: true, id: r.id, rev: 1, status: 'pending' }; }
    if (b.op === 'withdraw') { const r = st.reqs.find((x) => x.id === b.id); if (!r || r.rev !== b.rev || r.status !== 'pending') return { ok: false, error: 'conflict' }; r.status = 'withdrawn'; r.rev++; return { ok: true, rev: r.rev, status: 'withdrawn' }; }
    return { ok: false, error: 'format' };
  };
  return st;
}

const srv = await startServer(repoDir);
const browser = await chromium.launch();

async function openPage(st, start, ctxOpts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...ctxOpts });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === srv.url) return route.continue();
    if (u.origin === SB && u.pathname === EP) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const b = JSON.parse(route.request().postData() || '{}');
      st.bodies.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(st.handle(b)) });
    }
    st.outside.push(u.origin + u.pathname);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.exposeFunction('__recHash', (h) => { st.hashAtSend.push(h); });
  await page.addInitScript(() => {
    const f = window.fetch;
    window.fetch = function (u) { if (String(u).includes('/functions/v1/kintai-self')) window.__recHash(location.hash); return f.apply(this, arguments); };
  });
  await page.goto(srv.url + start);
  return { context, page, errors };
}
const vis = (page, sel) => page.isVisible(sel).catch(() => false);
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, 'kintai-self-' + name + '.png'), fullPage: true }); };

try {
  say('— A. 登録 —');
  const st = fake();
  let { context, page, errors } = await openPage(st, '/kintai-self.html#c=' + CODE);
  await page.waitForSelector('#v-enroll:not([hidden])', { timeout: 10000 });
  t('住所から番号が消える', !(await page.evaluate(() => location.hash)) && !(await page.evaluate(() => location.href)).includes(CODE));
  t('QR の番号を読んだ時は8文字の欄を出さない', !(await vis(page, '#fld-code')) && (await vis(page, '#code-from-qr')));
  await shot(page, 'enroll');
  await page.fill('#in-pin1', '1357'); await page.fill('#in-pin2', '1358'); await page.click('#b-enroll');
  t('2回の暗証番号が違えば送らない', st.bodies.length === 0 && /違います/.test(await page.textContent('#enroll-msg')));
  await page.fill('#in-pin2', '1357'); await page.click('#b-enroll');
  await page.waitForSelector('#v-app:not([hidden])', { timeout: 10000 });
  t('受け口へは {op:redeem, code, pin} だけ → 続けて {op:pin, key, pin}',
    JSON.stringify(st.bodies[0]) === JSON.stringify({ op: 'redeem', code: CODE, pin: '1357' }) && JSON.stringify(st.bodies[1]) === JSON.stringify({ op: 'pin', key: KEY, pin: '1357' }), st.bodies.slice(0, 2));
  t('送る時には住所に番号が無い', st.hashAtSend.every((h) => h === ''), st.hashAtSend);
  t('表示名が出る（「さん」を重ねない）', (await page.textContent('#who')) === '表示 架空 さんの勤怠', await page.textContent('#who'));

  say('— B. 勤怠 —');
  await page.waitForSelector('#days-list .day', { timeout: 10000 });
  const daysTxt = await page.textContent('#days-list');
  t('日ごとの予定・打刻・数えた時刻・実働が出る', /09:00〜18:00/.test(daysTxt) && /出 08:55/.test(daysTxt) && /退 18:05/.test(daysTxt) && /実働 8:00/.test(daysTxt) && /有休/.test(daysTxt), daysTxt.slice(0, 200));
  t('月分の見出しと合計', /月分（/.test(await page.textContent('#days-head')) && /8:00/.test(await page.textContent('#days-head')));
  t('横にはみ出さない（390px）', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const tap = await page.evaluate(() => [...document.querySelectorAll('button:not([hidden]), input, select, textarea')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.height)]; }).filter((x) => x[1] < 44));
  t('押す所・入れる所の高さは 44px 以上', tap.length === 0, tap);
  await shot(page, 'days');
  await page.click('#b-prev');
  await page.waitForFunction(() => document.querySelector('#b-prev').getAttribute('aria-pressed') === 'true');
  t('前の月分へ切り替えた（受け口へ前の月分を聞いた）', st.bodies.some((b) => b.op === 'month' && b.ym === prevYm(YM)));

  say('— C. 有給 —');
  await page.click('#t-leave');
  await page.waitForFunction(() => /日/.test(document.querySelector('#leave-box').textContent) && !/読んでいます/.test(document.querySelector('#leave-box').textContent), null, { timeout: 10000 });
  const lvTxt = await page.textContent('#leave-box');
  t('有給の残り（10日−シフトの有休1日＝9日）と期限が出る', /9 日/.test(lvTxt) && /まで/.test(lvTxt), lvTxt.slice(0, 200));
  await shot(page, 'leave');

  say('— D. 申請 —');
  await page.click('#t-req');
  await page.waitForSelector('#req-list p, #req-list .day', { timeout: 10000 });
  await page.selectOption('#rq-kind', 'punch');
  await page.fill('#rq-date', YM + '-01');
  await page.selectOption('#rq-pk', 'out');
  await page.fill('#rq-time', '19:00');
  await page.click('#b-req');
  t('理由が無ければ送らない', !st.bodies.some((b) => b.op === 'request_add') && /理由/.test(await page.textContent('#rq-msg')));
  await page.fill('#rq-reason', '退勤を押し忘れました');
  await page.click('#b-req');
  await page.waitForSelector('#req-list .day', { timeout: 10000 });
  const add = st.bodies.find((b) => b.op === 'request_add');
  t('送る中身は決まった形だけ（打刻の直し・+09:00 の時刻・送り直しの印）',
    add && add.kind === 'punch' && add.work_date === YM + '-01' && JSON.stringify(add.body) === JSON.stringify({ kind: 'out', at: YM + '-01T19:00:00+09:00' })
    && add.reason === '退勤を押し忘れました' && /^[0-9a-f-]{36}$/.test(add.client_id) && add.key === KEY && add.open === OPEN, add);
  t('一覧に「承認待ち」', /承認待ち/.test(await page.textContent('#req-list')));
  await shot(page, 'request');
  page.once('dialog', (d) => d.accept());
  await page.click('#req-list button');
  await page.waitForFunction(() => /取り下げ/.test(document.querySelector('#req-list').textContent) && !document.querySelector('#req-list button'), null, { timeout: 10000 });
  t('取り下げられる（rev つき）', st.bodies.some((b) => b.op === 'withdraw' && b.rev === 1));

  say('— E. 閉じる —');
  await page.click('#b-close');
  await page.waitForSelector('#v-pin:not([hidden])');
  const cleared = await page.evaluate(() => ({ who: document.querySelector('#who').textContent, days: document.querySelector('#days-list').childElementCount,
    leave: document.querySelector('#leave-box').childElementCount, req: document.querySelector('#req-list').childElementCount, ls: Object.assign({}, localStorage), ss: sessionStorage.length }));
  t('表示名・勤怠・有給・申請が画面から消える', cleared.who === '' && cleared.days === 0 && cleared.leave === 0 && cleared.req === 0, cleared);
  t('端末に残るのは鍵とタブの印だけ（開いている印・暗証番号・勤怠は残らない）',
    JSON.stringify(Object.keys(cleared.ls).sort()) === JSON.stringify(['kintai_self_key', 'kintai_self_tab']) && cleared.ls.kintai_self_key === KEY && cleared.ss === 0
    && !JSON.stringify(cleared.ls).includes(OPEN) && !JSON.stringify(cleared.ls).includes('1357'), cleared.ls);
  await shot(page, 'pin');

  say('— G. 暗証番号の違い —');
  await page.fill('#in-pin', '0000'); await page.click('#b-pin');
  await page.waitForFunction(() => !document.querySelector('#pin-msg').hidden);
  t('違えば開かず、残りの回数が出る', /あと 3 回/.test(await page.textContent('#pin-msg')) && !(await vis(page, '#v-app')));

  say('— F. 2分さわらない —');
  await page.clock.install();
  await page.fill('#in-pin', '1357'); await page.click('#b-pin');
  await page.waitForSelector('#v-app:not([hidden])', { timeout: 10000 });
  t('開き直すとタブの印（申請）を覚えている', (await page.getAttribute('#t-req', 'aria-selected')) === 'true');
  await page.waitForSelector('#req-list .day', { timeout: 10000 });
  await page.clock.fastForward(110000);
  t('2分より前は開いたまま（110秒）', await vis(page, '#v-app'));
  await page.click('#rq-reason');   // さわると数え直す
  await page.clock.fastForward(110000);
  t('さわった後は、そこから2分までは開いたまま（さわってから110秒）', await vis(page, '#v-app'));
  await page.clock.fastForward(11000);
  await page.waitForSelector('#v-pin:not([hidden])', { timeout: 5000 }).catch(() => {});
  t('さわらずに2分で暗証番号の画面へ戻る（文が出る）', await vis(page, '#v-pin') && /2分間/.test(await page.textContent('#pin-msg')));
  const idle = await page.evaluate(() => ({ who: document.querySelector('#who').textContent, days: document.querySelector('#days-list').childElementCount,
    head: document.querySelector('#days-head').childElementCount, leave: document.querySelector('#leave-box').childElementCount,
    req: document.querySelector('#req-list').childElementCount, app: !document.querySelector('#v-app').hidden, ls: Object.keys(localStorage).sort() }));
  t('2分で表示名・勤怠・有給・申請を画面から捨て、端末には鍵とタブの印だけが残る',
    idle.who === '' && idle.days === 0 && idle.head === 0 && idle.leave === 0 && idle.req === 0 && !idle.app
    && JSON.stringify(idle.ls) === JSON.stringify(['kintai_self_key', 'kintai_self_tab']), idle);
  t('画面のエラーなし・外への通信なし', errors.length === 0 && st.outside.length === 0, [errors, st.outside]);
  await context.close();

  say('— H0. 開いている最中に鍵が使えなくなった（取り消し） —');
  const st0 = fake();
  ({ context, page, errors } = await openPage(st0, '/kintai-self.html'));
  await page.evaluate((k) => localStorage.setItem('kintai_self_key', k), KEY);
  await page.reload();
  await page.fill('#in-pin', '1357'); await page.click('#b-pin');
  await page.waitForSelector('#days-list .day', { timeout: 10000 });
  const realHandle = st0.handle;
  st0.handle = (b) => (b.op === 'forget' ? { ok: true } : { ok: false, error: 'nokey' });
  await page.click('#t-leave');
  await page.waitForSelector('#v-enroll:not([hidden])', { timeout: 10000 });
  const gone = await page.evaluate(() => ({ who: document.querySelector('#who').textContent, days: document.querySelector('#days-list').childElementCount,
    head: document.querySelector('#days-head').childElementCount, key: localStorage.getItem('kintai_self_key') }));
  t('中身（表示名・勤怠）を画面から捨ててから登録の画面に戻り、鍵を消す', gone.who === '' && gone.days === 0 && gone.head === 0 && gone.key === null
    && /登録し直して/.test(await page.textContent('#enroll-msg')), gone);
  st0.handle = realHandle;
  t('画面のエラーなし', errors.length === 0, errors);
  await context.close();

  say('— H1. 同じサイトのログインの記録がある端末（不具合の報告の部品が共通ログインを読みに行く） —');
  const st1 = fake();
  ({ context, page, errors } = await openPage(st1, '/kintai-self.html'));
  await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('sb-jhbernqawjrzqwrmqrih-auth-token', '{"access_token":"kakuu","refresh_token":"kakuu"}'); }, KEY);
  await page.reload();
  await page.fill('#in-pin', '1357'); await page.click('#b-pin');
  await page.waitForSelector('#days-list .day', { timeout: 10000 });
  await page.waitForTimeout(1500);
  t('画面は開ける・ログインの記録は消さない・外へは通信しない（CSP と横取りで止まる）',
    (await page.evaluate(() => localStorage.getItem('sb-jhbernqawjrzqwrmqrih-auth-token'))) !== null && st1.bodies.some((b) => b.op === 'month'),
    { outside: st1.outside });
  t('画面のエラーなし', errors.length === 0, errors);
  await context.close();

  say('— H. 鍵が使えない（取り消し） —');
  const st2 = fake({ nokey: true });
  ({ context, page, errors } = await openPage(st2, '/kintai-self.html'));
  await page.evaluate((k) => localStorage.setItem('kintai_self_key', k), KEY);
  await page.reload();
  await page.waitForSelector('#v-pin:not([hidden])');
  await page.fill('#in-pin', '1357'); await page.click('#b-pin');
  await page.waitForSelector('#v-enroll:not([hidden])', { timeout: 10000 });
  t('登録の画面に戻り、知らせを出し、鍵を端末から消す', /登録し直して/.test(await page.textContent('#enroll-msg')) && (await page.evaluate(() => localStorage.getItem('kintai_self_key'))) === null);
  await context.close();

  say('— I. 暗い表示・印刷 —');
  const st3 = fake();
  ({ context, page, errors } = await openPage(st3, '/kintai-self.html', { colorScheme: 'dark' }));
  await page.evaluate((k) => localStorage.setItem('kintai_self_key', k), KEY);
  await page.reload();
  await page.fill('#in-pin', '1357'); await page.click('#b-pin');
  await page.waitForSelector('#v-app:not([hidden])', { timeout: 10000 });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  t('暗い表示の色になる', bg === 'rgb(17, 21, 28)', bg);
  await shot(page, 'dark');
  await page.emulateMedia({ media: 'print' });
  t('印刷には中身を出さない', await page.evaluate(() => getComputedStyle(document.querySelector('main')).display === 'none'));
  t('画面のエラーなし', errors.length === 0, errors);
  await context.close();
} finally {
  await browser.close();
  srv.close();
}
say('\n' + (ng ? '✗ 失敗 ' + ng + ' 件' : '✓ 全部合格') + '（' + ok + ' 件合格）');
process.exit(ng ? 1 : 0);
