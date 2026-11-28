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
 *   J. v6（統合 0125）: 事務所からの打刻漏れの知らせの帯（打刻がそろった日は出さない・帯から打刻の直しをその日付で開く）・
 *      休暇の申請（種類・時間単位は設定が true の時だけ・特別休暇の種類・送る形）・有給の残りから時間単位の有休を引く
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
    /* 前の月分は締めてある月分にする（締める前の目安の知らせを出さないことを確かめる・反証レビュー 2026-11-21） */
    days: [], month: ym === YM ? null : { locked_at: ym + '-28T10:00:00+09:00', snapshot: { config: {} } }, settings: { config: {} }, leave_uses: [],
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
    if (b.op === 'month') return opts.month ? opts.month(b.ym) : monthOf(b.ym);
    if (b.op === 'leave') return opts.leave || LEAVE;
    if (b.op === 'notices') return opts.notices ? { ok: true, rows: opts.notices } : { ok: false, error: 'format' };   /* 0125 の前の受け口は知らない op を format で断る */
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
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === srv.url) return route.continue();
    if (u.origin === SB && u.pathname === EP) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const b = JSON.parse(route.request().postData() || '{}');
      st.bodies.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await st.handle(b)) });   /* 答えを遅らせる場面（M）のために待てる形 */
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
  t('締めていない月分は、勤怠の表の上に「締める前の数字は目安です」を出す（反証レビュー 2026-11-21）', /締める前の数字は目安です（締めた後に事務所の数字と同じになります）/.test(await page.textContent('#days-head')));
  t('横にはみ出さない（390px）', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const tap = await page.evaluate(() => [...document.querySelectorAll('button:not([hidden]), input, select, textarea')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.height)]; }).filter((x) => x[1] < 44));
  t('押す所・入れる所の高さは 44px 以上', tap.length === 0, tap);
  await shot(page, 'days');
  await page.click('#b-prev');
  await page.waitForFunction(() => document.querySelector('#b-prev').getAttribute('aria-pressed') === 'true');
  t('前の月分へ切り替えた（受け口へ前の月分を聞いた）', st.bodies.some((b) => b.op === 'month' && b.ym === prevYm(YM)));
  await page.waitForFunction(() => /締めてあります/.test(document.querySelector('#days-head').textContent), null, { timeout: 10000 });
  t('締めた月分には目安の知らせを出さない', !/締める前の数字は目安/.test(await page.textContent('#days-head')));

  say('— C. 有給 —');
  LEAVE.months[0].config.hourlyPaidLeave = true;   /* 時間単位の有休を使う施設（有給の答えはまだ読んでいない＝この値で読む・反証レビュー 2026-11-21） */
  await page.click('#t-leave');
  await page.waitForFunction(() => /日/.test(document.querySelector('#leave-box').textContent) && !/読んでいます/.test(document.querySelector('#leave-box').textContent), null, { timeout: 10000 });
  const lvTxt = await page.textContent('#leave-box');
  t('有給の残り（10日−シフトの有休1日＝9日）と期限が出る', /9 日/.test(lvTxt) && /まで/.test(lvTxt), lvTxt.slice(0, 200));
  t('時間単位の有休を使う施設では、残りの近くに「時間単位で取った分は、ここの残りに入っていません。…」を出す', /時間単位で取った分は、ここの残りに入っていません。正しい残りは事務所で確かめてください。/.test(lvTxt));
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

  say('— J. v6: 打刻漏れの知らせ・休暇の申請 —');
  {
    /* d2 は有休（有）の日＝1日休む日は帯を出さない（反証 2026-11-24 の 4）。打刻の無い日の文は d3（予定も打刻も無い日＝直ったか分からないので出す）で見る */
    const d1 = YM + '-01', d2 = YM + '-02', d3 = YM + '-03';
    const NT = [{ id: '00000000-0000-4000-8000-0000000000a1', kind: 'missing', work_date: d1, created_at: d1 + 'T20:00:00+09:00', seen_at: null },
                { id: '00000000-0000-4000-8000-0000000000a2', kind: 'missing', work_date: d2, created_at: d2 + 'T20:00:00+09:00', seen_at: null },
                { id: '00000000-0000-4000-8000-0000000000a3', kind: 'free', work_date: d2, created_at: d2 + 'T20:00:00+09:00', seen_at: null },
                { id: '00000000-0000-4000-8000-0000000000a4', kind: 'missing', work_date: d3, created_at: d3 + 'T20:00:00+09:00', seen_at: null }];
    const LV6 = Object.assign({}, LEAVE, { months: [{ ym: YM, from: YM + '-01', to: YM + '-' + pad(lastDay(YM)), locked: false, config: { hourlyPaidLeave: true } }],
      absences: [{ id: 'h1', date: d1, kind: 'hourly_paid', minutes: 120, paid: true, type_code: null, link_date: null }] });
    const st4 = fake({ notices: NT, leave: LV6 });
    ({ context, page, errors } = await openPage(st4, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#nt-box:not([hidden]) .nt', { timeout: 10000 });
    const nb = await page.textContent('#nt-box');
    const m0 = +YM.slice(5, 7);
    t('帯: 見出し「事務所からの知らせ」と決まった文（打刻の無い日だけ・そろった日・有休の日・知らない種類は出さない）', /事務所からの知らせ/.test(nb) && nb.indexOf(m0 + '月3日の打刻が抜けています。事務所に伝えるか、申請から打刻の直しを出してください。') >= 0
      && nb.indexOf(m0 + '月1日') < 0 && nb.indexOf(m0 + '月2日') < 0 && (await page.$$('#nt-box .nt')).length === 1, nb);
    t('知らせは開いた時に1回だけ読む（key・open だけを送る）', st4.bodies.filter((b) => b.op === 'notices').length === 1 && JSON.stringify(Object.keys(st4.bodies.find((b) => b.op === 'notices')).sort()) === '["key","op","open"]');
    await shot(page, 'notice');
    await page.click('#nt-box button');
    await page.waitForSelector('#p-req:not([hidden])');
    t('帯から打刻の直しをその日付で開く', (await page.inputValue('#rq-kind')) === 'punch' && (await page.inputValue('#rq-date')) === d3 && (await page.inputValue('#rq-pk')) === 'in');
    const bh = await page.evaluate(() => document.querySelector('#nt-box button').getBoundingClientRect().height);
    t('帯のボタンは 44px 以上', bh >= 44, bh);

    await page.waitForFunction(() => /有休の残り/.test(document.querySelector('#rq-lv-remain').textContent), null, { timeout: 10000 });
    await page.selectOption('#rq-kind', 'leave');
    const opts = await page.$$eval('#rq-lt option', (o) => o.map((x) => x.value));
    t('休暇の種類: 時間単位は設定が true の時だけ（この施設は true）', JSON.stringify(opts) === JSON.stringify(['paid_day', 'paid_half', 'hourly', 'special', 'comp', 'swap']), opts);
    t('有休の残りを横に出す（10日−シフトの有休1日−時間単位の2時間＝8 日 6 時間）', /有休の残り: 8 日 6 時間/.test(await page.textContent('#rq-lv-remain')), await page.textContent('#rq-lv-remain'));
    t('休む日の欄の名前・理由の欄が出る・時刻の欄は出ない', (await page.textContent('#rq-date-l')) === '休む日' && (await vis(page, '#rq-reason')) && !(await vis(page, '#rq-time')));
    await page.selectOption('#rq-lt', 'special');
    t('特別休暇: 種類（既定の3つ）と半日が出て、時間と結ぶ日は出ない', (await vis(page, '#rq-lc')) && (await vis(page, '#rq-lhalf')) && !(await vis(page, '#rq-lh')) && !(await vis(page, '#rq-ll'))
      && JSON.stringify(await page.$$eval('#rq-lc option', (o) => o.map((x) => x.value))) === '["keicho","summer","other"]');
    await page.fill('#rq-date', YM + '-20');
    await page.fill('#rq-reason', '私用');
    await page.click('#b-req');
    await page.waitForFunction(() => /特別休暇（慶弔）/.test(document.querySelector('#req-list').textContent), null, { timeout: 10000 });
    const la = st4.bodies.filter((b) => b.op === 'request_add').pop();
    t('送る形: kind leave・休む日・{type, type_code}・理由', la && la.kind === 'leave' && la.work_date === YM + '-20' && JSON.stringify(la.body) === '{"type":"special","type_code":"keicho"}' && la.reason === '私用', la);
    t('一覧に「休暇」と中身「特別休暇（慶弔）」・承認待ち', /休暇/.test(await page.textContent('#req-list')) && /承認待ち/.test(await page.textContent('#req-list')));
    await page.selectOption('#rq-lt', 'hourly');
    t('時間単位: 時間の欄が出る（1日8時間の施設は1〜7時間）', (await vis(page, '#rq-lh')) && (await page.$$('#rq-lh option')).length === 7);
    await page.selectOption('#rq-lh', '2');
    await page.fill('#rq-reason', '通院');
    await page.click('#b-req');
    await page.waitForFunction(() => /有休（時間 2 時間）/.test(document.querySelector('#req-list').textContent), null, { timeout: 10000 });
    t('時間単位の送る形 {type:hourly, minutes:120}', JSON.stringify(st4.bodies.filter((b) => b.op === 'request_add').pop().body) === '{"type":"hourly","minutes":120}');
    await shot(page, 'leave-request');
    await page.click('#t-leave');
    await page.waitForFunction(() => /有給の残り/.test(document.querySelector('#leave-box').textContent), null, { timeout: 10000 });
    const lv6 = await page.textContent('#leave-box');
    t('有給のタブ: 残りは時間単位を引いた「8 日 6 時間」・受け口が休暇の行を返す時は「残りに入っていません」を出さない', /8 日 6 時間/.test(lv6) && !/ここの残りに入っていません/.test(lv6), lv6.slice(0, 200));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t('iPhone の幅で横にはみ出さない', over <= 1, over);
    t('画面のエラーなし', errors.length === 0, errors);
    await context.close();
  }

  say('— K. 2026-11-27: 確かめが要る日・塗りは1つ・有給の期限・申請の窓のチェック・0件の月・下の余白 —');
  {
    /* 前の月分（締めた月分）に、予定はあるのに打刻の無い日を4日（1日〜4日）。今月分は今までの材料（確かめが要る日なし） */
    const pm = prevYm(YM);
    const monthK = (ym) => {
      if (ym !== pm) return monthOf(ym);
      const m = monthOf(ym);
      m.punches = [];
      m.schedule = [1, 2, 3, 4].map((n) => ({ staff_id: SID, work_date: ym + '-0' + n, seq: 0, office: 'facility', start_at: ym + '-0' + n + 'T09:00:00+09:00', end_at: ym + '-0' + n + 'T18:00:00+09:00', break_min: 60, kind: 'work', symbol: '日', paid_min: 0 }));
      return m;
    };
    const st5 = fake({ month: monthK });
    ({ context, page, errors } = await openPage(st5, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#days-list .day', { timeout: 10000 });
    t('確かめが要る日が無い月分（今月分）には帯を出さない', await page.evaluate(() => document.getElementById('need-box').hidden));
    const fills = await page.evaluate(() => { const pri = getComputedStyle(document.querySelector('.tab[aria-selected="true"]')).backgroundColor; return Array.from(document.querySelectorAll('#v-app .tab, #v-app .seg .btn')).filter((b) => getComputedStyle(b).backgroundColor === pri).map((b) => b.textContent.trim()); });
    t('塗りに見えるのは上のタブ「勤怠」の1つだけ（月の切り替えは淡い地と下線）', fills.length === 1 && fills[0] === '勤怠', fills);
    t('「締める前の数字は目安です」は箱なしの注記（黄の箱にしない・文はそのまま）', await page.evaluate(() => { const p = Array.from(document.querySelectorAll('#days-head p')).find((x) => /締める前の数字は目安です/.test(x.textContent)); return !!p && !p.classList.contains('msg') && parseFloat(getComputedStyle(p).fontSize) >= 15; }));
    const padB = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('main')).paddingBottom));
    t('本文の外枠の下の余白は 96px 以上（右下の「不具合を報告」が末尾に重ならない）', padB >= 96, padB);
    await page.click('#b-prev');
    await page.waitForSelector('#need-box:not([hidden]) .need', { timeout: 10000 });
    const nb = await page.textContent('#need-box');
    const m0 = +pm.slice(5, 7);
    t('帯: 「確かめが要る日が 4 日あります（M/1・M/2・M/3 ほか 1 日）」（日付は3つまで）', nb === '確かめが要る日が 4 日あります（' + m0 + '/1・' + m0 + '/2・' + m0 + '/3 ほか 1 日）', nb);
    t('帯は月の合計の箱の上', await page.evaluate(() => !!(document.getElementById('need-box').compareDocumentPosition(document.getElementById('days-head')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#need-box .need');
    await page.waitForTimeout(900);
    const go = await page.evaluate((d) => { const c = document.querySelector('#days-list .day[data-date="' + d + '"]'); const r = c.getBoundingClientRect(); return { top: Math.round(r.top), inView: r.top >= -2 && r.top < window.innerHeight / 2, focus: document.activeElement === c }; }, pm + '-01');
    t('帯を押すと、確かめが要る最初の日の箱へ送る', go.inView && go.focus, go);
    /* 審査役の指摘（2026-11-27）: 送った先の日付の行が、上に貼り付く見出しの下に隠れない（幅390 と幅320・根の字200%） */
    const hidden = async (w, big) => {
      await page.setViewportSize({ width: w, height: 844 });
      await page.click('#t-days'); await page.waitForTimeout(300);
      await page.evaluate((b) => { if (b) document.documentElement.style.setProperty('font-size', '200%', 'important'); else document.documentElement.style.removeProperty('font-size'); window.scrollTo(0, 0); }, big);
      await page.waitForTimeout(300);
      await page.click('#need-box .need');
      await page.waitForTimeout(1000);
      return page.evaluate((d) => { const c = document.querySelector('#days-list .day[data-date="' + d + '"]'), top = c.querySelector('.d').getBoundingClientRect().top, hb = document.querySelector('.hdr').getBoundingClientRect().bottom; return { dateTop: Math.round(top), hdrBottom: Math.round(hb), ok: top >= hb }; }, pm + '-01');
    };
    for (const [w, big] of [[390, false], [320, false], [320, true]]) {
      const r = await hidden(w, big);
      t('帯で送った先の日付の行は、見出しの下に隠れない（幅' + w + (big ? '・根の字200%' : '') + '）', r.ok, r);
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#t-req');
    await page.waitForSelector('#f-req');
    const chk = await page.evaluate(() => Array.from(document.querySelectorAll('#f-req label.chk')).filter((l) => l.offsetParent).map((l) => Math.round(l.getBoundingClientRect().height)));
    t('申請の窓のチェックの欄はラベル全体が押せる行で、高さ 44px 以上', chk.length >= 1 && chk.every((h) => h >= 44), chk);
    await page.click('#f-req label.chk:has(#rq-next)', { position: { x: 200, y: 22 } });   /* チェックの四角ではなく、ラベルの文の所を押す */
    t('ラベルの文を押してもチェックが入る', await page.evaluate(() => document.getElementById('rq-next').checked));
    await page.selectOption('#rq-kind', 'overtime');
    const chk2 = await page.evaluate(() => Array.from(document.querySelectorAll('#f-req label.chk')).filter((l) => l.offsetParent).map((l) => Math.round(l.getBoundingClientRect().height)));
    t('残業の窓の「残業の終わりは次の日の時刻」も 44px 以上', chk2.length >= 1 && chk2.every((h) => h >= 44), chk2);
    t('「出した申請」の見出しの上の余白は 24px', await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#p-req > h2.sh')).marginTop)) === 24);
    await page.click('#t-leave');
    await page.waitForFunction(() => /有給の残り/.test(document.querySelector('#leave-box').textContent), null, { timeout: 10000 });
    const lot = await page.evaluate(() => Array.from(document.querySelectorAll('#leave-box li.lot')).map((li) => ({ e: li.querySelector('.lot-e').textContent, dateLines: li.querySelector('.lot-e .nw').getClientRects().length, sameRow: Math.abs(li.querySelector('.lot-g').getBoundingClientRect().top - li.querySelector('.lot-r').getBoundingClientRect().top) < 4 })));
    t('有給の付与ごと: 1行目に付与日と残り・2行目に「期限 … まで」・日付は折れない', lot.length >= 1 && lot.every((x) => /^期限 .+ まで$/.test(x.e) && x.dateLines === 1 && x.sameRow), lot);
    /* 審査役の指摘（2026-11-27）で、時間単位の有休の注意は黄の箱に戻した（残りの数を読み違えないため）。黄の箱はこの2つまで */
    t('有給の黄の箱は「いちばん早く消える残り」と時間単位の有休の注意だけ', await page.evaluate(() => Array.from(document.querySelectorAll('#leave-box .msg.warn')).every((x) => /いちばん早く消える残り|時間単位で取った分は、ここの残りに入っていません/.test(x.textContent))));
    await context.close();
    /* 予定も打刻も無い月: 合計の箱を出さず空の状態の箱だけ */
    const st6 = fake({ month: (ym) => Object.assign(monthOf(ym), { punches: [], schedule: [] }) });
    ({ context, page, errors } = await openPage(st6, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForFunction(() => /まだありません/.test(document.getElementById('days-head').textContent), null, { timeout: 10000 });
    const emp = await page.evaluate(() => ({ tot: !!document.querySelector('#days-head .tot'), txt: document.getElementById('days-head').textContent, list: document.getElementById('days-list').childElementCount, need: document.getElementById('need-box').hidden }));
    t('予定も打刻も無い月: 合計の箱（0 の並び）を出さず「この月分の予定と打刻はまだありません。」の箱だけ', !emp.tot && /この月分の予定と打刻はまだありません。/.test(emp.txt) && emp.list === 0 && emp.need, emp);
    await shot(page, 'empty-month');
    t('K. 画面のエラーなし', errors.length === 0, errors);
    await context.close();
  }
  {
    say('— L. 日の種類の札: 狭い幅・文字200%でも横にはみ出さない（反証レビュー 2026-11-28） —');
    /* 1日: 半日の特別休暇＋半日の勤務（13〜18時・打刻あり）＝札「特別休暇 半日」と「実働 4:00」が同じ行に並ぶ日。
       2日に入って3日に明ける夜勤・3日にまた入る夜勤と半日の有給＝札が3つ（明け・夜勤・有給 半日）と実働が並ぶ日 */
    const d1 = YM + '-01', d2 = YM + '-02', d3 = YM + '-03', d4 = YM + '-04';
    const p = (id, k, at) => ({ id, staff_id: SID, kind: k, at, source: 'tablet', created_at: at, voided_at: null });
    const stL = fake({ month: (ym) => Object.assign(monthOf(ym), ym !== YM ? {} : {
      schedule: [{ staff_id: SID, work_date: d1, seq: 0, office: 'facility', start_at: d1 + 'T13:00:00+09:00', end_at: d1 + 'T18:00:00+09:00', break_min: 0, kind: 'work', symbol: '13-18', paid_min: 0 },
        { staff_id: SID, work_date: d2, seq: 0, office: 'facility', start_at: d2 + 'T21:00:00+09:00', end_at: d3 + 'T07:00:00+09:00', break_min: 120, kind: 'night', symbol: '(21', paid_min: 0 },
        { staff_id: SID, work_date: d3, seq: 0, office: 'facility', start_at: d3 + 'T21:00:00+09:00', end_at: d4 + 'T07:00:00+09:00', break_min: 120, kind: 'night', symbol: '(21', paid_min: 0 }],
      punches: [p('l1', 'in', d1 + 'T12:58:00+09:00'), p('l2', 'out', d1 + 'T18:02:00+09:00'), p('l3', 'in', d2 + 'T20:55:00+09:00'), p('l4', 'out', d3 + 'T07:03:00+09:00'),
        p('l5', 'in', d3 + 'T20:56:00+09:00'), p('l6', 'out', d4 + 'T07:04:00+09:00')],
      absences: [{ id: 'la1', date: d1, kind: 'special', minutes: 240, paid: true, type_code: 'keicho', link_date: null }],
      leave_uses: [{ id: 'lu1', staff_id: SID, use_date: d3, days: 0.5, voided_at: null }] }) });
    ({ context, page, errors } = await openPage(stL, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#days-list .day[data-date="' + d3 + '"] .kd', { timeout: 10000 });
    const kinds = await page.evaluate((ds) => ds.map((d) => Array.from(document.querySelectorAll('#days-list .day[data-date="' + d + '"] .d .kd')).map((x) => x.textContent).join(',')
      + '|' + (document.querySelector('#days-list .day[data-date="' + d + '"] .d .w') || {}).textContent), [d1, d3]);
    t('札と実働が並ぶ日が出ている（1日: 特別休暇 半日と実働 5:00・3日: 明け・夜勤・有給 半日と実働）',
      kinds[0] === '特別休暇 半日|実働 5:00' && /^明け,夜勤,有給 半日\|実働 \d+:\d\d$/.test(kinds[1]), kinds);
    for (const w of [195, 320, 390]) {
      for (const z of [100, 200]) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.evaluate((zz) => document.documentElement.style.setProperty('font-size', zz + '%', 'important'), z);
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
          out: Array.from(document.querySelectorAll('#days-list .day .d, #days-list .day .d *')).filter((e) => { const r = e.getBoundingClientRect(), c = e.closest('.day').getBoundingClientRect(); return r.right > c.right + 0.5 || r.left < c.left - 0.5; }).length }));
        t('幅' + w + '・文字' + z + '%: 横にはみ出さない（scrollWidth＝幅）・日付の行の札と実働が日の箱の中に収まる', m.sw === m.iw && m.out === 0, m);
      }
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    t('L. 画面のエラーなし', errors.length === 0, errors);
    await context.close();
  }
  {
    say('— M. 前の月分の答えが遅れて届いても、今月分の見出しで前の月の中身を描かない（反証レビュー 2026-11-28） —');
    const PM = prevYm(YM);
    const stM = fake();
    const base = stM.handle;
    stM.handle = (b) => (b.op === 'month' && b.ym === PM ? new Promise((r) => setTimeout(() => r(base(b)), 1500)) : base(b));
    ({ context, page, errors } = await openPage(stM, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#days-list .day', { timeout: 10000 });
    await page.click('#b-prev');
    await page.waitForTimeout(100);
    await page.click('#b-cur');
    await page.waitForTimeout(2500);   /* 前の月分の答え（1.5秒遅れ）が届いた後 */
    const mv = await page.evaluate(() => ({ h: (document.querySelector('#days-head h2') || {}).textContent || '', dates: Array.from(document.querySelectorAll('#days-list .day')).map((x) => x.getAttribute('data-date')),
      cur: document.getElementById('b-cur').getAttribute('aria-pressed') }));
    t('前の月分を聞いた（答えは遅れて届いた）', stM.bodies.some((b) => b.op === 'month' && b.ym === PM));
    t('今月分を押した後は、遅れて届いた前の月分で描き直さない（見出しも日の箱も今月分のまま）',
      mv.cur === 'true' && mv.h.indexOf(YM.slice(0, 4) + '年' + (+YM.slice(5, 7)) + '月分') === 0 && mv.dates.length > 0 && mv.dates.every((d) => d.slice(0, 7) === YM), mv);
    t('M. 画面のエラーなし', errors.length === 0, errors);
    await context.close();
  }
  {
    say('— N. 給与明細のタブ（統合 0145・2026-11-28）: 確定済みの一覧と1枚・古い受け口は「まだ使えません」・閉じると捨てる —');
    const stN = fake();
    const baseN = stN.handle;
    const SLIP = { ym: '2027-04', pay_date: '2027-04-25', period: { from: '2027-03-16', to: '2027-04-15' }, company_name: '見本の会社', name: '表示 架空', gross: 250000, deduct: 40000, net: 210000,
      lines: [{ sec: 'pay', code: 'basic', name: '基本給', qty: null, amount: 240000 }, { sec: 'deduct', code: 'health', name: '健康保険', qty: null, amount: 12000 }, { sec: 'att', code: 'workDays', name: '出勤日数', qty: 20, amount: 0 }] };
    stN.handle = (b) => {
      if (b.op === 'payslips' && b.key === KEY && b.open === OPEN) return { ok: true, months: [{ ym: '2027-03', pay_date: '2027-03-25', net: 200000 }, { ym: '2027-04', pay_date: '2027-04-25', net: 210000 }] };
      if (b.op === 'payslip' && b.key === KEY && b.open === OPEN) return b.ym === '2027-04' ? { ok: true, slip: SLIP } : { ok: false, error: 'notfound' };
      return baseN(b);
    };
    ({ context, page, errors } = await openPage(stN, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'days'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#days-list .day', { timeout: 10000 });
    t('N. 開いただけでは明細を読まない', !stN.bodies.some((b) => b.op === 'payslips' || b.op === 'payslip'));
    await page.click('#t-slip');
    await page.waitForSelector('#slip-box .slip-row', { timeout: 10000 });
    const rows = await page.$$eval('#slip-box .slip-row', (bs) => bs.map((x) => x.textContent));
    t('N. 一覧は新しい順（4月分が先）・差引の額', rows.length === 2 && /2027年4月分/.test(rows[0]) && /210,000 円/.test(rows[0]), rows);
    t('N. 一覧を読む時に送るのは key・open だけ', JSON.stringify(Object.keys(stN.bodies.find((b) => b.op === 'payslips')).sort()) === '["key","op","open"]');
    await page.click('#slip-box .slip-row >> nth=0');
    await page.waitForSelector('#slip-box .slip-tot', { timeout: 10000 });
    const sv = await page.textContent('#slip-box');
    t('N. 明細: 題・支給日・会社と名前・合計・支給・控除・勤怠', /2027年4月分 給与明細/.test(sv) && /支給日 2027年4月25日/.test(sv) && /見本の会社/.test(sv) && /差引支給額210,000 円/.test(sv) && /基本給240,000 円/.test(sv) && /健康保険12,000 円/.test(sv) && /出勤日数20/.test(sv), sv.slice(0, 300));
    t('N. 明細を読む時に送るのは key・open・ym だけ', JSON.stringify(stN.bodies.find((b) => b.op === 'payslip')) === JSON.stringify({ op: 'payslip', key: KEY, open: OPEN, ym: '2027-04' }));
    t('N. 横にはみ出さない（390px）', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    t('N. 端末に残すのは鍵とタブの印だけ', JSON.stringify(await page.evaluate(() => Object.keys(localStorage).sort())) === JSON.stringify(['kintai_self_key', 'kintai_self_tab']));
    await shot(page, 'slip');
    /* 給与明細のタブのまま閉じて開き直すと、押さなくても一覧が出る（反証レビュー 2026-11-28） */
    await page.click('#b-close');
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#slip-box .slip-row', { timeout: 10000 }).catch(() => {});
    t('N. 給与明細のタブで閉じて開き直すと、押さなくても一覧が出る', (await page.locator('#slip-box .slip-row').count()) === 2);
    await page.click('#b-close');
    t('N. 閉じると明細を画面から捨てる', (await page.evaluate(() => document.getElementById('slip-box').textContent)) === '');
    t('N. 画面のエラーなし', errors.length === 0, errors);
    await context.close();
    /* 古い受け口（0145 の前・知らない op を format で断る） */
    const stO = fake();
    ({ context, page, errors } = await openPage(stO, '/kintai-self.html'));
    await page.evaluate((k) => { localStorage.setItem('kintai_self_key', k); localStorage.setItem('kintai_self_tab', 'slip'); }, KEY);
    await page.reload();
    await page.fill('#in-pin', '1357'); await page.click('#b-pin');
    await page.waitForSelector('#v-app:not([hidden])', { timeout: 10000 });
    await page.waitForFunction(() => /まだ使えません/.test(document.getElementById('slip-box').textContent), null, { timeout: 10000 }).catch(() => {});
    t('N. 古い受け口では「給与明細はまだ使えません」', /給与明細はまだ使えません/.test(await page.textContent('#slip-box')));
    t('N. 古い受け口: 画面のエラーなし', errors.length === 0, errors);
    await context.close();
  }
} finally {
  await browser.close();
  srv.close();
}
say('\n' + (ng ? '✗ 失敗 ' + ng + ' 件' : '✓ 全部合格') + '（' + ok + ' 件合格）');
process.exit(ng ? 1 : 0);
