/* 端末の用途を管理者の決めたとおりに受け取る部品（su-device-role.js）と、管理者の欄（app-access-devices.js）の試験
   （2026-11-08 新設・代表者の決定 段3 案A・統合 0081）
   実行: node check/unit/device_role_test.js
   守ること:
     1. スイッチ device_role が切・読めない時は何も送らない・何も書かない
     2. 送るのは {k: 32文字の乱数の印, role, login, want:'role'} の4つだけ（氏名・アカウントは送らない）。ログインの控えが無い端末は login:false
     3. 届いた用途が今と違う時だけ su_device_role を書き換えて読み込み直す（現場→事務所へ緩めるのも届いた時だけ）。
        null・断られた・届かない・形の違う答えでは何もしない（今の端末の設定を消さない）。未設定の端末に事務所が届いても書かない
     4. 遅れて届いた答え（送った後に用途が変わった・後の呼び出しが出た）は捨てる
     5. 同じタブで同じ用途への読み込み直しは1回だけ（書いても戻ってしまう端末で繰り返さない）
     6. 番号を出す画面（data-mode="show"）は送らない・印を作らない・頭の8文字だけを出す
     7. 画面への組み込み: メニューと使い方の画面が同じ版で読む・メニューの同時読み込みの指示がそろう・公開の許可リストにある
     8. 管理者の欄は textContent だけで描き、一覧と決める口（device_role_list・device_role_set）だけを呼ぶ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-device-role.js'), 'utf8');
const DEV = fs.readFileSync(path.join(ROOT, 'app-access-devices.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
const KEY = '0123456789abcdef0123456789abcdef';

/* 部品を動かす。opt: {store, flag, answer(body)→{status, json}, mode, session, noKey} */
function env(opt) {
  const store = Object.assign({}, opt.store || {});
  const sess = Object.assign({}, opt.sess || {});
  const calls = [], reloads = [];
  const els = [{ textContent: 'まだありません' }];
  const box = {
    document: {
      readyState: 'complete',
      currentScript: { getAttribute: (n) => (n === 'data-mode' ? (opt.mode || null) : null) },
      addEventListener() {}, querySelectorAll: () => els
    },
    localStorage: {
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i],
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { if (opt.noWrite && k === 'su_device_role') return; store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    sessionStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(sess, k) ? sess[k] : null),
      setItem: (k, v) => { sess[k] = String(v); }
    },
    location: { reload: () => reloads.push(1) },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    Uint8Array, Promise, JSON, setTimeout, String, Array, Date,
    addEventListener() {},
    fetch: (url, init) => {
      calls.push({ url, init });
      if (url === 'su-backend.json') {
        if (opt.flag === 'throw') return Promise.reject(new Error('net'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { device_role: opt.flag === true } }) });
      }
      const body = JSON.parse(init.body);
      if (opt.before) opt.before(store);
      const a = opt.answer ? opt.answer(body) : { status: 200, json: { ok: true, role: null } };
      if (a === 'throw') return Promise.reject(new Error('net'));
      return Promise.resolve({ ok: a.status === 200, json: () => Promise.resolve(a.json) });
    }
  };
  box.window = box;
  if (opt.session) store['sb-jhbernqawjrzqwrmqrih-auth-token'] = '{}';
  if (opt.auth) box.SUAuth = { check: () => Promise.resolve(opt.auth) };
  vm.createContext(box);
  vm.runInContext(SRC, box);
  const posts = () => calls.filter((c) => c.url !== 'su-backend.json');
  return { box, store, sess, calls, posts, reloads, els, api: box.SUDeviceRole };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  console.log('su-device-role.js:');
  {
    const e = env({ flag: false, store: { su_device_key: KEY } });
    await tick(); await tick();
    t('1a スイッチが切: 受け口へ送らない・書かない', e.posts().length === 0 && e.store.su_device_role === undefined, e.calls);
  }
  {
    const e = env({ flag: 'throw', store: { su_device_key: KEY } });
    await tick(); await tick();
    t('1b スイッチが読めない: 送らない', e.posts().length === 0, e.calls);
  }
  {
    const e = env({ flag: true, store: { su_device_key: KEY, su_device_role: 'office' } });
    await tick(); await tick();
    const p = e.posts();
    const body = p.length ? JSON.parse(p[0].init.body) : null;
    t('2a 送るのは k・role・login・want の4つだけ（ログインの控えが無い端末は login:false）',
      p.length === 1 && JSON.stringify(Object.keys(body).sort()) === '["k","login","role","want"]'
      && body.k === KEY && body.role === 'office' && body.login === false && body.want === 'role', body);
    t('2b 受け口は device-seen・資格情報を付けない・POST', p.length === 1 && /\/functions\/v1\/device-seen$/.test(p[0].url)
      && p[0].init.method === 'POST' && p[0].init.credentials === 'omit', p[0] && p[0].init);
    t('3a 割り当てが無い（null）: 書かない・読み込み直さない', e.store.su_device_role === 'office' && e.reloads.length === 0, e.store);
  }
  {
    const e = env({ flag: true, store: {} });
    await tick(); await tick();
    const body = e.posts().length ? JSON.parse(e.posts()[0].init.body) : {};
    t('2c 印の無い端末は16バイトの乱数から32文字の印を作って残す', /^[0-9a-f]{32}$/.test(e.store.su_device_key || '') && body.k === e.store.su_device_key, e.store);
  }
  {
    const e = env({ flag: true, session: true, auth: { status: 'ok', role: 'office' }, store: { su_device_key: KEY } });
    await tick(); await tick();
    const body = e.posts().length ? JSON.parse(e.posts()[0].init.body) : {};
    t('2d ログイン中の端末は login:true（確かめはログインの部品の答え）', body.login === true, body);
  }
  {
    const e = env({ flag: true, session: true, auth: { status: 'error' }, store: { su_device_key: KEY } });
    await tick(); await tick();
    const body = e.posts().length ? JSON.parse(e.posts()[0].init.body) : {};
    t('2e ログインを確かめられない端末は login:null（分からない）', body.login === null, body);
  }
  {
    const e = env({ flag: true, store: { su_device_key: KEY, su_device_role: 'office' }, answer: () => ({ status: 200, json: { ok: true, role: 'field' } }) });
    await tick(); await tick();
    t('3b 現場が届いた事務所の端末: 書き換えて読み込み直す', e.store.su_device_role === 'field' && e.reloads.length === 1 && e.sess.su_device_role_reload === 'field', [e.store, e.reloads]);
  }
  {
    const e = env({ flag: true, store: { su_device_key: KEY }, answer: () => ({ status: 200, json: { ok: true, role: 'field' } }) });
    await tick(); await tick();
    t('3c 現場が届いた未設定の端末: 書き換えて読み込み直す', e.store.su_device_role === 'field' && e.reloads.length === 1, e.store);
  }
  {
    const e = env({ flag: true, store: { su_device_key: KEY, su_device_role: 'field' }, answer: () => ({ status: 200, json: { ok: true, role: 'office' } }) });
    await tick(); await tick();
    t('3d 事務所が届いた現場の端末: 届いた時だけ緩める（書き換えて読み込み直す）', e.store.su_device_role === 'office' && e.reloads.length === 1, e.store);
  }
  {
    const e = env({ flag: true, store: { su_device_key: KEY }, answer: () => ({ status: 200, json: { ok: true, role: 'office' } }) });
    await tick(); await tick();
    t('3e 事務所が届いた未設定の端末: 同じ扱いなので書かない', e.store.su_device_role === undefined && e.reloads.length === 0, e.store);
  }
  for (const [nm, ans] of [['断られた', { status: 400, json: { ok: false, code: 'weak' } }], ['ok でない', { status: 200, json: { ok: false } }],
    ['知らない値', { status: 200, json: { ok: true, role: 'admin' } }], ['届かない', 'throw'], ['答えが空', { status: 200, json: null }]]) {
    const e = env({ flag: true, store: { su_device_key: KEY, su_device_role: 'field' }, answer: () => ans });
    await tick(); await tick();
    t('3f ' + nm + ': 今の設定のまま（消さない）・読み込み直さない', e.store.su_device_role === 'field' && e.reloads.length === 0, e.store);
  }
  {
    const e = env({ flag: true, store: { su_device_key: KEY, su_device_role: 'office' },
      before: (s) => { s.su_device_role = 'field'; }, answer: () => ({ status: 200, json: { ok: true, role: 'office' } }) });
    await tick(); await tick();
    t('4a 送った後に別の所で用途が変わった答えは捨てる', e.store.su_device_role === 'field' && e.reloads.length === 0, e.store);
  }
  {
    const e = env({ flag: false, store: { su_device_key: KEY, su_device_role: 'office' } });
    await tick();
    const g1 = e.api._apply('field', 'office', -1);
    t('4b 古い世代の答えは捨てる', g1 === 'stale' && e.store.su_device_role === 'office', g1);
  }
  {
    const e = env({ flag: true, sess: { su_device_role_reload: 'field' }, store: { su_device_key: KEY, su_device_role: 'office' },
      answer: () => ({ status: 200, json: { ok: true, role: 'field' } }) });
    await tick(); await tick();
    t('5a 同じタブで同じ用途へはもう読み込み直さない（書くのは書く）', e.store.su_device_role === 'field' && e.reloads.length === 0, e.reloads);
  }
  {
    const e = env({ flag: true, noWrite: true, store: { su_device_key: KEY, su_device_role: 'office' },
      answer: () => ({ status: 200, json: { ok: true, role: 'field' } }) });
    await tick(); await tick();
    t('5b 書いても戻ってしまう端末は読み込み直さない', e.reloads.length === 0, e.reloads);
  }
  {
    const e = env({ flag: true, mode: 'show', store: { su_device_key: KEY } });
    await tick(); await tick();
    t('6a 番号を出す画面: 送らない・頭の8文字だけ（4-4 で区切る）', e.calls.length === 0 && e.els[0].textContent === '0123-4567', [e.calls.length, e.els[0].textContent]);
  }
  {
    const e = env({ flag: true, mode: 'show', store: {} });
    await tick();
    t('6b 印の無い端末: 印を作らない・文言のまま', e.store.su_device_key === undefined && e.els[0].textContent === 'まだありません', e.store);
  }
  t('7a 部品は console に出さない・innerHTML を使わない', !/console\./.test(SRC) && !/innerHTML/.test(SRC), '');
  t('7b 部品が書く鍵は印（su_device_key）と用途（su_device_role）だけ',
    (SRC.match(/localStorage\.setItem\((\w+)/g) || []).every((w) => /\((KEY_LS|ROLE_LS)$/.test(w)) && !/localStorage\.(removeItem|clear)\(/.test(SRC), SRC.match(/localStorage\.setItem\(\w+/g));

  const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const HELP = fs.readFileSync(path.join(ROOT, 'help.html'), 'utf8');
  const v = (s) => (s.match(/su-device-role\.js\?v=([0-9.-]+)/g) || []);
  const vi = v(INDEX), vh = v(HELP);
  t('7c メニューは部品を読み、同時読み込みの指示も同じ版', vi.length === 2 && vi[0] === vi[1] && /<link rel="preload" as="script" href="su-device-role\.js/.test(INDEX), vi);
  t('7d 使い方の画面は同じ版を「番号を出す」で読む', vh.length === 1 && vh[0] === vi[0] && /su-device-role\.js\?v=[0-9.-]+" data-mode="show"/.test(HELP) && /data-su-device-no/.test(HELP), vh);
  const GI = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  t('7e 公開の許可リストに部品と管理者の欄がある', /^!\/su-device-role\.js$/m.test(GI) && /^!\/app-access-devices\.js$/m.test(GI), '');

  console.log('app-access-devices.js:');
  t('8a 表示は textContent だけ（innerHTML・insertAdjacentHTML を使わない）・console に出さない',
    !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(DEV) && !/console\./.test(DEV), '');
  const rpcs = (DEV.match(/rpc\('([a-z_]+)'/g) || []).map((s) => s.slice(5, -1));
  t('8b 呼ぶのは device_role_list と device_role_set だけ', rpcs.length >= 2 && rpcs.every((n) => n === 'device_role_list' || n === 'device_role_set'), rpcs);
  t('8c 端末の保存領域へ書かない', !/localStorage|sessionStorage/.test(DEV), '');
  t('8d 管理者（2段階認証まで済んだ）の時だけ欄を出す', /me\.status !== SUAuth\.STATUS\.OK \|\| me\.role !== 'admin'\) return;/.test(DEV), '');
  const AH = fs.readFileSync(path.join(ROOT, 'app-access.html'), 'utf8');
  t('8e 画面は欄を隠して始め、部品を読む', /<section class="cd" id="v-devices" hidden/.test(AH) && /app-access-devices\.js\?v=/.test(AH), '');

  console.log(`\n${pass} 件合格／${fail} 件不合格`);
  process.exit(fail ? 1 : 0);
})();
