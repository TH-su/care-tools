/* 端末登録の QR（enroll.html・enroll.js・accounts-enroll.js・2026-11-08 段4・care-backend 統合 0082）の試験。架空のデータだけを使う。
   1. 受け取りページ: 番号を住所からすぐ消す・受け口へ {code} だけを送る・番号を端末に残さない・ログインの鍵を共通ログインの部品へ入れる・
      端末の用途は QR にある時だけ書く・断りの文は理由を分けない・前のログインは先に外す・番号の無い時は何も送らない
   2. 管理者の欄: 出した番号を受け取りページの住所の # の後ろに入れて QR にする・番号を端末に残さない・断りの文・関数の無い時は「まだ使えません」・
      使われたら QR を消す・取り消し
   3. ファイルの決まり: CSP・直書きのスクリプトなし・公開の許可・紙に出さない・読み込みの順番
   実行: node check/unit/device_enroll_page_test.js
   ★出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 20); i++) await tick(); }

const CODE = '0123456789abcdef0123456789abcdef01234567';
const ENDPOINT = 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/device-enroll';

function mkEl(id) {
  const e = {
    id, hidden: false, textContent: '', className: '', value: '', disabled: false, children: [], attrs: {}, listeners: {},
    selectedOptions: [],
    setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...c) { this.children = c; }, addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); },
    focus() {}, scrollIntoView() {},
  };
  return e;
}
function mkDom(ids) {
  const els = {};
  ids.forEach((i) => { els[i] = mkEl(i); });
  const document = {
    hidden: false,
    getElementById: (i) => els[i] || null,
    createElement: (tag) => Object.assign(mkEl(''), { tag }),
    createElementNS: (ns, tag) => Object.assign(mkEl(''), { tag, ns }),
  };
  return { els, document };
}
function mkStorage(init) {
  const m = new Map(Object.entries(init || {}));
  const writes = [];
  return { m, writes, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push([k, String(v)]); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); } };
}

/* ── 1. 受け取りページ ── */
async function runEnroll(opt) {
  opt = opt || {};
  const { els, document } = mkDom(['v-loading', 'v-ok', 'v-ng', 'v-none', 'ng-msg', 'b-retry', 'ok-role', 'b-menu']);
  const ls = mkStorage(opt.ls), ss = mkStorage();
  const log = { fetch: [], replaceState: [], setSession: [], signOut: 0, replace: [], order: [] };
  const loc = {
    hash: opt.hash === undefined ? '#c=' + CODE : opt.hash, pathname: '/care-tools/enroll.html', search: '',
    replace(u) { log.replace.push(u); },
  };
  const history = { replaceState(a, b, u) { log.replaceState.push(u); log.order.push('clear'); loc.hash = ''; } };
  const fetchImpl = async (url, init) => {
    log.order.push('fetch');
    log.fetch.push({ url, init, hashAtSend: loc.hash });
    if (opt.netErr) throw new TypeError('Failed to fetch');
    const r = opt.reply || { status: 200, body: { ok: true, session: { access_token: 'acc-inv', refresh_token: 'ref-inv', expires_at: 1 }, deviceRole: opt.deviceRole === undefined ? 'field' : opt.deviceRole } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  const SUAuth = {
    STATUS: { OK: 'ok' },
    client: () => ({ auth: {
      getSession: async () => ({ data: { session: opt.hadSession ? { user: {} } : null } }),
      setSession: async (s) => { log.order.push('setSession'); log.setSession.push(s); return { error: opt.setErr ? { message: 'x' } : null }; },
    } }),
    signOut: async () => { log.order.push('signOut'); log.signOut++; },
    check: async () => (opt.denied ? { status: 'denied' } : { status: 'ok', role: 'field', roleLabel: '現場' }),
  };
  const timers = [];
  const ctx = {
    document, location: loc, history, fetch: fetchImpl, localStorage: ls, sessionStorage: ss, SUAuth, URLSearchParams,
    setTimeout: (f) => { timers.push(f); return timers.length; }, JSON, String, Promise,
  };
  ctx.window = ctx;
  vm.runInNewContext(read('enroll.js'), ctx);
  await settle();
  timers.forEach((f) => f());
  return { els, ls, ss, log, loc };
}

/* ── 2. 管理者の欄 ── */
async function runAdmin(opt) {
  opt = opt || {};
  const { els, document } = mkDom(['sec-enroll', 'en-msg', 'en-form', 'en-acct', 'en-role', 'en-label', 'b-enroll', 'en-qr', 'en-qr-img', 'en-qr-for', 'en-qr-exp', 'b-enroll-close', 'en-list', 'b-enroll-revoke-all']);
  els['sec-enroll'].hidden = true; els['en-form'].hidden = true; els['en-qr'].hidden = true;
  const ls = mkStorage(), ss = mkStorage();
  const calls = [];
  let listRows = opt.listRows || [];
  const rpcImpl = async (name, args) => {
    calls.push({ name, args });
    if (opt.missing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    if (name === 'device_enroll_candidates') return { data: { ok: true, rows: [{ email: 'inv-f@example.invalid', label: '現場の端末（見本）', role: 'field', ready: true }, { email: 'inv-n@example.invalid', label: '見本', role: 'field', ready: false }] }, error: null };
    if (name === 'device_enroll_list') return { data: { ok: true, rows: listRows }, error: null };
    if (name === 'device_enroll_issue') return { data: opt.issue || { ok: true, id: 5, code: CODE, expiresAt: new Date(Date.now() + 600000).toISOString(), email: args.p_email, deviceRole: args.p_device_role }, error: null };
    if (name === 'device_enroll_revoke') return { data: { ok: true, revoked: true }, error: null };
    if (name === 'device_enroll_revoke_account') return { data: { ok: true, revoked: 3 }, error: null };
    return { data: null, error: { message: 'x' } };
  };
  const svgs = [];
  const SUQr = { svg: (text, o) => { svgs.push({ text, o }); return { tag: 'svg', text }; } };
  const intervals = [];
  const ctx = {
    document, location: { href: 'https://example.invalid/care-tools/accounts.html?x=1#y' }, localStorage: ls, sessionStorage: ss,
    SUAuth: { client: () => ({ rpc: rpcImpl }) }, SUQr, URL, Date, Math, JSON, String, Promise,
    setInterval: (f) => { intervals.push(f); return intervals.length; }, clearInterval: () => {},
    confirm: () => true, addEventListener() {},
  };
  ctx.window = ctx;
  vm.runInNewContext(read('accounts-enroll.js'), ctx);
  await ctx.SUAccountsEnroll.show();
  return { els, ls, ss, calls, svgs, ctx, setList: (r) => { listRows = r; }, intervals };
}

(async () => {
  group('1. 受け取りページ（enroll.js）');
  let r = await runEnroll();
  t('番号を住所から消してから受け口へ送る（送る時に住所に番号が無い）',
    r.log.order[0] === 'clear' && r.log.order.indexOf('fetch') > 0 && r.log.fetch[0].hashAtSend === '' && r.log.replaceState[0] === '/care-tools/enroll.html');
  const f = r.log.fetch[0];
  t('受け口へは {code} だけを POST・決まった住所・Cookie を付けない',
    f.url === ENDPOINT && f.init.method === 'POST' && f.init.body === JSON.stringify({ code: CODE }) && f.init.credentials === 'omit'
    && f.init.headers['Content-Type'] === 'application/json' && !('Authorization' in f.init.headers));
  t('ログインの鍵を共通ログインの部品へ入れる', r.log.setSession.length === 1 && r.log.setSession[0].access_token === 'acc-inv' && r.log.setSession[0].refresh_token === 'ref-inv');
  t('QR に用途がある時は端末の用途を書く・番号はどこにも残さない',
    r.ls.m.get('su_device_role') === 'field' && !JSON.stringify([...r.ls.writes, ...r.ss.writes]).includes(CODE));
  t('登録できたら役割を出してメニューへ移る（読み込み直し）', !r.els['v-ok'].hidden && r.els['ok-role'].textContent === '現場' && r.log.replace[0] === 'index.html');
  t('前のログインが無い時はログアウトしない', r.log.signOut === 0);

  r = await runEnroll({ deviceRole: null, ls: { su_device_role: 'office' } });
  t('QR に用途が無い時は端末の用途を変えない', r.ls.m.get('su_device_role') === 'office' && r.ls.writes.length === 0);

  r = await runEnroll({ hadSession: true });
  t('前のログインがある時は、先にこの端末だけログアウトしてから入る', r.log.signOut === 1 && r.log.order.indexOf('signOut') < r.log.order.indexOf('setSession'));

  for (const [code, want] of [['invalid', '使えません'], ['limited', 'しばらく'], ['server', '登録できませんでした']]) {
    r = await runEnroll({ reply: { status: code === 'limited' ? 429 : code === 'invalid' ? 403 : 502, body: { ok: false, code } } });
    t('断り（' + code + '）: 職員向けの文・もう一度は送らない・ログインしない',
      !r.els['v-ng'].hidden && r.els['ng-msg'].textContent.includes(want) && r.els['b-retry'].hidden && r.log.setSession.length === 0 && r.log.fetch.length === 1
      && !/invalid|limited|server|error/i.test(r.els['ng-msg'].textContent));
  }
  r = await runEnroll({ netErr: true });
  t('通信できない時は「もう一度試す」を出す（番号はメモリにだけ）', !r.els['v-ng'].hidden && !r.els['b-retry'].hidden && r.ls.writes.length === 0 && r.ss.writes.length === 0);
  r = await runEnroll({ denied: true });
  t('ログインできてもデータベースが使えないと答えた時は、この端末だけログアウトしてから「使えません」を出し、メニューへ移らない・用途を書かない',
    !r.els['v-ng'].hidden && r.log.replace.length === 0 && r.ls.writes.length === 0
    && r.log.signOut === 1 && r.log.order.indexOf('signOut') > r.log.order.indexOf('setSession'));
  r = await runEnroll({ setErr: true });
  t('鍵を入れられなかった時は断りを出す', !r.els['v-ng'].hidden && r.log.replace.length === 0);
  for (const h of ['', '#c=', '#c=' + CODE.toUpperCase(), '#c=' + CODE + 'x', '#code=' + CODE]) {
    r = await runEnroll({ hash: h });
    t('番号の形が違う・無い時（' + (h || '空') + '）は何も送らず案内だけ', r.log.fetch.length === 0 && !r.els['v-none'].hidden);
  }

  group('2. 管理者の欄（accounts-enroll.js）');
  let a = await runAdmin();
  t('開くと欄を出し、選べるアカウントを並べる（まだログインしていない人は選べない）',
    !a.els['sec-enroll'].hidden && !a.els['en-form'].hidden && a.els['en-acct'].children.length === 3 && a.els['en-acct'].children[2].disabled === true);
  a.els['en-acct'].value = 'inv-f@example.invalid';
  a.els['en-acct'].selectedOptions = [{ textContent: '現場の端末（見本）（現場）' }];
  a.els['en-role'].value = 'field';
  a.els['en-label'].value = ' 見本の iPad ';
  await a.els['b-enroll'].listeners.click[0]();
  await settle();
  const iss = a.calls.find((c) => c.name === 'device_enroll_issue');
  t('出す時に送るのはアカウント・用途・呼び名だけ', JSON.stringify(iss.args) === JSON.stringify({ p_email: 'inv-f@example.invalid', p_device_role: 'field', p_label: '見本の iPad' }));
  t('QR の中身は受け取りページの住所（?・# は付け替え）＋ #c=番号だけ',
    a.svgs.length === 1 && a.svgs[0].text === 'https://example.invalid/care-tools/enroll.html#c=' + CODE);
  t('QR を出す・期限を出す・番号は画面の文字にも端末にも残さない',
    !a.els['en-qr'].hidden && /あと 9分|あと 10分/.test(a.els['en-qr-exp'].textContent)
    && !JSON.stringify([...a.ls.writes, ...a.ss.writes]).includes(CODE) && !a.els['en-qr-for'].textContent.includes(CODE)
    && !a.els['en-msg'].textContent.includes(CODE));
  a.setList([{ id: 5, email: 'inv-f@example.invalid', label: '現場の端末（見本）', state: 'active', deviceRole: 'field', deviceLabel: '見本の iPad', createdAt: new Date().toISOString(), boundAt: new Date().toISOString() }]);
  a.ctx.Date = Date;
  // 読み直しの間隔を過ぎた扱いにして1回回す
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  await a.intervals[0](); await settle();
  Date.now = realNow;
  t('使われたら QR を消して「登録できました」と出し、一覧に「この端末を取り消す」を出す',
    a.els['en-qr'].hidden && a.els['en-qr-img'].children.length === 0 && a.els['en-msg'].textContent.includes('登録ができました')
    && a.els['en-list'].children[0].children[1].children[0].textContent === 'この端末を取り消す');
  await a.els['en-list'].children[0].children[1].children[0].listeners.click[0](); await settle();
  t('取り消しは行の番号だけを送る', JSON.stringify(a.calls.filter((c) => c.name === 'device_enroll_revoke').map((c) => c.args)) === JSON.stringify([{ p_id: 5 }]));

  a = await runAdmin({ listRows: [
    { id: 7, email: 'inv-f@example.invalid', label: '見本', state: 'lapsed', createdAt: new Date().toISOString() },
    { id: 8, email: 'inv-f@example.invalid', label: '見本', state: 'failed', createdAt: new Date().toISOString() },
    { id: 9, email: 'inv-f@example.invalid', label: '見本', state: 'revoked', createdAt: new Date().toISOString() },
    { id: 10, email: 'inv-f@example.invalid', label: '見本', state: 'expired', createdAt: new Date().toISOString() }] });
  const btnOf = (i) => a.els['en-list'].children[i].children[1].children[0];
  t('90日を過ぎた端末・使った直後でまだ結んでいない行には取り消しのボタン・取り消した行と期限切れには無い',
    btnOf(0) && btnOf(0).textContent === 'この端末を取り消す' && btnOf(1) && btnOf(1).textContent === 'この QR を取り消す' && !btnOf(2) && !btnOf(3));
  a.els['en-acct'].value = 'inv-f@example.invalid';
  a.els['en-acct'].selectedOptions = [{ textContent: '現場の端末（見本）（現場）' }];
  await a.els['b-enroll-revoke-all'].listeners.click[0](); await settle();
  t('「このアカウントの端末を全部取り消す」は選んだアカウントだけを送り、件数を出す',
    JSON.stringify(a.calls.filter((c) => c.name === 'device_enroll_revoke_account').map((c) => c.args)) === JSON.stringify([{ p_email: 'inv-f@example.invalid' }])
    && a.els['en-msg'].textContent.includes('3件'));
  a.els['en-acct'].value = '';
  await a.els['b-enroll-revoke-all'].listeners.click[0](); await settle();
  t('アカウントを選ばない時は全部取り消しを送らない', a.calls.filter((c) => c.name === 'device_enroll_revoke_account').length === 1);

  for (const [err, want] of [['badaccount', '選べません'], ['toomany', '5つ'], ['badlabel', '20字']]) {
    a = await runAdmin({ issue: { ok: false, error: err } });
    a.els['en-acct'].value = 'inv-f@example.invalid';
    await a.els['b-enroll'].listeners.click[0](); await settle();
    t('断り（' + err + '）: QR を出さず職員向けの文', a.svgs.length === 0 && a.els['en-qr'].hidden && a.els['en-msg'].textContent.includes(want));
  }
  a = await runAdmin({ issue: { ok: true, id: 1, code: 'not-a-code', expiresAt: new Date().toISOString() } });
  a.els['en-acct'].value = 'inv-f@example.invalid';
  await a.els['b-enroll'].listeners.click[0](); await settle();
  t('形の違う番号は QR にしない', a.svgs.length === 0);
  a = await runAdmin();
  a.els['en-acct'].value = '';
  await a.els['b-enroll'].listeners.click[0](); await settle();
  t('アカウントを選ばない時は出さない', !a.calls.some((c) => c.name === 'device_enroll_issue'));
  a = await runAdmin({ missing: true });
  t('データベースの関数がまだ無い時は「まだ使えません」と出し、入力の欄を出さない',
    !a.els['sec-enroll'].hidden && a.els['en-form'].hidden && a.els['en-msg'].textContent.includes('まだ使えません'));

  group('3. ファイルの決まり');
  const eh = read('enroll.html'), ah = read('accounts.html'), css = read('su-enroll.css'), gi = read('.gitignore');
  const ej = read('enroll.js'), aj = read('accounts-enroll.js');
  t('受け取りページ: CSP があり、スクリプトは自サイトだけ・通信は Supabase だけ・直書きのスクリプトなし',
    /Content-Security-Policy" content="default-src 'self'; script-src 'self';[^"]*connect-src https:\/\/jhbernqawjrzqwrmqrih\.supabase\.co wss:\/\/jhbernqawjrzqwrmqrih\.supabase\.co;/.test(eh)
    && !/<script>(?!<\/script>)/.test(eh.replace(/<!--[\s\S]*?-->/g, '')) && !/\son[a-z]+=/i.test(eh));
  t('受け取りページ: 住所を外へ渡さない・控えを残さない・「不具合を報告」は置かない（ログインの画面と同じ）',
    /name="referrer" content="no-referrer"/.test(eh) && /no-store/.test(eh) && !/su-report\.js/.test(eh));
  t('受け取りページ・管理者の欄: 番号を localStorage・sessionStorage に入れる書き方が無い',
    !/(localStorage|sessionStorage)\.setItem\([^)]*code/i.test(ej + aj) && !/console\./.test(ej + aj + read('su-qr.js')));
  t('使える人の管理: QR の部品 → 欄 → 本体の順で読む', ah.indexOf('<script src="su-qr.js') > 0 && ah.indexOf('<script src="su-qr.js') < ah.indexOf('<script src="accounts-enroll.js') && ah.indexOf('<script src="accounts-enroll.js') < ah.indexOf('<script src="accounts.js'));
  t('紙には QR も欄も出さない', /@media print\s*\{\s*#sec-enroll, \.en-qr \{ display: none !important; \}/.test(css));
  t('公開の許可（.gitignore）に新しい5つのファイルがある', ['accounts-enroll.js', 'su-qr.js', 'su-enroll.css', 'enroll.html', 'enroll.js'].every((x) => gi.includes('\n!/' + x + '\n')));

  say('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
})().catch((e) => { say('✗ 試験そのものが止まりました: ' + (e && e.stack || e)); process.exit(1); });
