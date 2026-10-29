/* 事務所用の合言葉の GAS への読み取りにログインの証明を添える部品（su-gas-auth.js・2026-10-29 代表者の決定）の試験。架空のデータだけを使う。
   1. token(): 鍵が無い・現場の端末は '' でログインの部品も読み込まない／証明を返す／3秒で返らない・失敗は ''／証明を端末に書かない
   2. addTo(): 証明あり＝浅い写しの最後に accessToken（ほかの項目と順番は同じ・元の本文は書き換えない）／証明なし・object でない・もう証明がある＝同じもの
   3. 送り口の動き: su-data-gas.js の post と入居者マスタの apiGet が、部品があれば証明を添え、無ければ今までと同じ本文を同じ送り方で送る
   4. 画面の静的な確かめ: 事務所用の合言葉の GAS への POST が SUGasAuth.addTo を通り、stateRev には足していない。部品は su-errors.js の後で読む
   実行: node check/unit/gas_auth_test.js
   GAS_AUTH_JS: 条件を抜いた版で試験が落ちるかを見る時だけ使う。
   ★出力に console を使わない（個人情報を出力に流さない作法をそろえる）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.GAS_AUTH_JS || path.join(ROOT, 'su-gas-auth.js'), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let ok = 0, ng = 0;
let finished = false;
/* 約束が解決しないまま node が抜けた時（待ちが効かない版など）も失敗にする */
process.on('exit', (c) => { if (!finished) { process.stdout.write('\n試験が終わる前に止まりました（返らない約束がある）\n'); process.exitCode = 1; } });
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

const TOKEN = 'kakuu-access-token-0001';
const SESS = { 'sb-kakuu-auth-token': '{}' };

/* 偽物の部品で su-gas-auth.js を読み込む。
   opt.storage: 端末の控え／opt.auth: 最初から SUAuth がある（getSession の答えを返す関数）／opt.loadAuth: script を足した時に入れる SUAuth
   opt.tags: 読み込み済みの script タグの src／待ち時間は 1/100 に縮める（3秒→30ms） */
function load(opt) {
  opt = opt || {};
  const store = new Map(Object.entries(opt.storage || {}));
  const cnt = { session: 0, sets: 0 };
  const added = [];
  const win = {};
  function mkAuth(fn) {
    return { client() { return { auth: { getSession() { cnt.session++; return fn(); } } }; } };
  }
  if (opt.auth) { win.SUAuth = mkAuth(opt.auth); win.supabase = {}; }
  const scripts = (opt.tags || []).map((src) => ({ getAttribute: (k) => (k === 'src' ? src : null) }));
  const head = {
    appendChild(s) {
      added.push(s.src);
      setImmediate(() => {
        if (/^supabase-js-/.test(s.src)) win.supabase = {};
        if (/^su-auth\.js/.test(s.src) && opt.loadAuth) win.SUAuth = mkAuth(opt.loadAuth);
        if (opt.loadFail) { if (s.onerror) s.onerror(); } else if (s.onload) s.onload();
      });
      return s;
    }
  };
  const ctx = {
    window: win, Promise, JSON, Object, Array, String, Error, RegExp,
    setTimeout(fn, ms) { return setTimeout(fn, Math.max(0, Math.floor((ms || 0) / 100))); },
    localStorage: {
      get length() { return store.size; },
      key(i) { return [...store.keys()][i] || null; },
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem() { cnt.sets++; }
    },
    document: { scripts, head, createElement(tag) { return { tag, src: '', async: false }; } }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'su-gas-auth.js' });
  return { A: win.SUGasAuth, win, cnt, added, store };
}
const okSess = () => Promise.resolve({ data: { session: { access_token: TOKEN } } });
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 10));

(async () => {
  group('1. token()');
  {
    const x = load({ storage: {}, auth: okSess });
    t('部品は window.SUGasAuth に token と addTo を出す', x.A && typeof x.A.token === 'function' && typeof x.A.addTo === 'function');
    const v = await x.A.token();
    t('ログインの鍵が無い端末は空', v === '', v);
    t('  └ ログインの部品に聞かない', x.cnt.session === 0, x.cnt);
  }
  {
    const x = load({ storage: {}, loadAuth: okSess });
    const v = await x.A.token();
    t('鍵が無い端末はログインの部品を読み込まない', v === '' && x.added.length === 0, x.added);
  }
  {
    const x = load({ storage: { 'sb-kakuu-auth-token-code-verifier': 'x', 'sb-kakuu-auth-token-x': 'y' }, auth: okSess });
    t('鍵の名前が sb-…-auth-token と一字一致しない控えはログインとみなさない', (await x.A.token()) === '' && x.cnt.session === 0);
  }
  {
    const x = load({ storage: Object.assign({ su_device_role: 'field' }, SESS), loadAuth: okSess });
    const v = await x.A.token();
    t('現場の端末は空', v === '', v);
    t('  └ 現場の端末はログインの部品を読み込まない', x.added.length === 0 && x.cnt.session === 0, { added: x.added, cnt: x.cnt });
  }
  {
    const x = load({ storage: Object.assign({}, SESS), auth: okSess });
    t('ログインしている事務所の端末は証明を返す', (await x.A.token()) === TOKEN);
    x.store.set('su_device_role', 'field');
    t('端末の用途が現場へ変わった後は空（用途を毎回読み直す）', (await x.A.token()) === '');
    x.store.set('su_device_role', 'office');
    t('事務所へ戻れば証明を返す', (await x.A.token()) === TOKEN);
    t('証明を端末に書かない', x.cnt.sets === 0, x.cnt);
  }
  {
    const x = load({ storage: Object.assign({}, SESS), loadAuth: okSess });
    const v = await x.A.token();
    t('ログインの部品が無ければ supabase-js → su-auth.js の順に読み込んで証明を返す', v === TOKEN &&
      JSON.stringify(x.added) === JSON.stringify(['supabase-js-2.112.4.js', 'su-auth.js?v=2026-10-28']), { v, added: x.added });
  }
  {
    const x = load({ storage: Object.assign({}, SESS), tags: ['supabase-js-2.112.4.js', 'su-auth.js?v=2026-10-28'] });
    const p = x.A.token();
    setTimeout(() => { x.win.supabase = {}; x.win.SUAuth = { client() { return { auth: { getSession: okSess } }; } }; }, 5);
    const v = await p;
    t('読み込み済みの script タグがあれば足さずに待つ', v === TOKEN && x.added.length === 0, { v, added: x.added });
  }
  {
    const x = load({ storage: Object.assign({}, SESS), loadFail: true });
    t('ログインの部品を読み込めない時は空', (await x.A.token()) === '');
  }
  {
    const x = load({ storage: Object.assign({}, SESS), auth: () => new Promise(() => {}) });
    const t0 = Date.now();
    const v = await x.A.token();
    t('3秒（試験では 30ms）で返らなければ空', v === '' && Date.now() - t0 < 1000, v);
  }
  {
    const x = load({ storage: Object.assign({}, SESS), auth: () => { throw new Error('kakuu'); } });
    t('getSession が例外を投げたら空（外に出さない）', (await x.A.token()) === '');
    const y = load({ storage: Object.assign({}, SESS), auth: () => Promise.reject(new Error('kakuu')) });
    t('getSession が失敗したら空', (await y.A.token()) === '');
    const z = load({ storage: Object.assign({}, SESS), auth: () => Promise.resolve({ data: { session: null } }) });
    t('ログインの控えが期限切れ（session なし）なら空', (await z.A.token()) === '');
    const w = load({ storage: Object.assign({}, SESS), auth: () => Promise.resolve({ data: { session: { access_token: 12345 } } }) });
    t('証明が文字でなければ空', (await w.A.token()) === '');
  }

  group('2. addTo()');
  {
    const x = load({ storage: Object.assign({}, SESS), auth: okSess });
    const b = { action: 'getRoster', id: '901', token: 'goukotoba-kakuu' };
    const r = await x.A.addTo(b);
    t('証明がある時は accessToken を足す', r && r.accessToken === TOKEN, r);
    t('  └ ほかの項目と順番は変えず、最後に足す', JSON.stringify(Object.keys(r)) === JSON.stringify(['action', 'id', 'token', 'accessToken']), Object.keys(r));
    t('  └ ほかの項目の値は同じ', r.action === 'getRoster' && r.id === '901' && r.token === 'goukotoba-kakuu');
    t('  └ 元の本文を書き換えない（浅い写し）', r !== b && !('accessToken' in b) && JSON.stringify(b) === JSON.stringify({ action: 'getRoster', id: '901', token: 'goukotoba-kakuu' }), b);
    const nested = { action: 'meeting', rec: { a: 1 } };
    const r2 = await x.A.addTo(nested);
    t('  └ 入れ子は同じもの（浅い写し）', r2.rec === nested.rec && r2 !== nested);
    const has = { action: 'medCand', op: 'apply', accessToken: 'gamen-ga-soeta' };
    const n0 = x.cnt.session;
    const r3 = await x.A.addTo(has);
    t('もう accessToken を持つ本文はそのまま返す（上書きしない・問い合わせない）', r3 === has && has.accessToken === 'gamen-ga-soeta' && x.cnt.session === n0);
  }
  {
    const x = load({ storage: {}, auth: okSess });
    const b = { action: 'getRoster', token: 'goukotoba-kakuu' };
    const r = await x.A.addTo(b);
    t('証明が無い時は同じ本文を返す', r === b && !('accessToken' in b));
  }
  {
    const x = load({ storage: Object.assign({}, SESS), auth: okSess });
    let all = true;
    for (const v of ['文字', 12, null, undefined, true, ['a']]) { const r = await x.A.addTo(v); if (r !== v) all = false; }
    t('object でない本文（文字・数・null・配列など）はそのまま返す', all);
  }
  {
    const x = load({ storage: Object.assign({}, SESS), auth: () => { throw new Error('kakuu'); } });
    const b = { action: 'list' };
    t('失敗の時は本文をそのまま返す（例外を出さない）', (await x.A.addTo(b)) === b);
  }
  {
    const x = load({ storage: Object.assign({}, SESS), auth: okSess });
    x.win.SUGasAuth.marker = 1;
    vm.runInContext(SRC, vm.createContext({ window: x.win, localStorage: { length: 0 } }));
    t('二度読み込んでも作り直さない', x.win.SUGasAuth.marker === 1);
  }

  group('3. 送り口の動き');
  /* su-data-gas.js の post（入居調整・訓練計画書・デイ利用表の入居者マスタ）。部品の有無で本文だけが変わる */
  async function gasPost(withPart) {
    const sent = [];
    const win = { SU: { data: { register(n, g) { win.G = g; } } } };
    if (withPart) win.SUGasAuth = { addTo: (b) => Promise.resolve(Object.assign({}, b, { accessToken: TOKEN })) };
    const ctx = { window: win, Promise, JSON, Object, Error, performance: { mark() {} },
      fetch(u, o) { sent.push({ u, o }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); } };
    vm.createContext(ctx);
    vm.runInContext(read('su-data-gas.js'), ctx);
    await win.G.kvRaw({ action: 'getBulk' }, { endpoint: 'https://script.google.com/macros/s/KAKUU/exec', token: 'goukotoba-kakuu' });
    return sent[0];
  }
  {
    const a = await gasPost(false), b = await gasPost(true);
    t('su-data-gas.js: 部品が無い時は今までと同じ本文', a.o.body === JSON.stringify({ action: 'getBulk', token: 'goukotoba-kakuu' }), a.o.body);
    t('su-data-gas.js: 部品がある時は accessToken を最後に足す', b.o.body === JSON.stringify({ action: 'getBulk', token: 'goukotoba-kakuu', accessToken: TOKEN }), b.o.body);
    const shape = (s) => JSON.stringify({ u: s.u, method: s.o.method, headers: s.o.headers, redirect: s.o.redirect, keys: Object.keys(s.o) });
    t('su-data-gas.js: 送り方（URL・POST・text/plain・redirect・項目）は同じ', shape(a) === shape(b) &&
      a.o.method === 'POST' && a.o.headers['Content-Type'] === 'text/plain;charset=utf-8' && a.o.redirect === 'follow', [shape(a), shape(b)]);
  }
  /* 入居者マスタの apiGet（getRoster 等の読み取り全部が通る） */
  function cutFn(src, name) {
    const h = src.indexOf('function ' + name + '(');
    let d = 0, i = src.indexOf('{', h);
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
    return '';
  }
  async function rmGet(withPart) {
    const RM = read('resident-master.html');
    const sent = [];
    const win = {};
    if (withPart) win.SUGasAuth = { addTo: (b) => Promise.resolve(Object.assign({}, b, { accessToken: TOKEN })) };
    const ctx = { window: win, Promise, JSON, Object, Error, String, setTimeout, clearTimeout,
      CFG: { url: 'https://script.google.com/macros/s/KAKUU/exec', token: 'goukotoba-kakuu' },
      fetch(u, o) { sent.push({ u, o }); return Promise.resolve({ text: () => Promise.resolve('{"ok":true}') }); } };
    vm.createContext(ctx);
    vm.runInContext(cutFn(RM, 'apiGet') + cutFn(RM, 'fetchWithTimeout') + cutFn(RM, 'parseJson'), ctx);
    await ctx.apiGet({ action: 'getResident', id: 901 });
    return sent[0];
  }
  {
    const a = await rmGet(false), b = await rmGet(true);
    t('入居者マスタ apiGet: 部品が無い時は今までと同じ本文', a.o.body === JSON.stringify({ action: 'getResident', id: '901', token: 'goukotoba-kakuu' }), a.o.body);
    t('入居者マスタ apiGet: 部品がある時は accessToken を最後に足す', b.o.body === JSON.stringify({ action: 'getResident', id: '901', token: 'goukotoba-kakuu', accessToken: TOKEN }), b.o.body);
    t('入居者マスタ apiGet: 送り方は同じ', a.o.method === 'POST' && b.o.method === 'POST' && JSON.stringify(a.o.headers) === JSON.stringify(b.o.headers) &&
      a.o.headers['Content-Type'] === 'text/plain;charset=utf-8' && !('redirect' in a.o) && !('redirect' in b.o));
  }

  group('4. 画面の静的な確かめ');
  /* [ファイル, 関数の名前（または区切りの印）, 説明]。区切りの中に SUGasAuth.addTo があり、送る本文は addTo の答え（b）になっている */
  const SITES = [
    ['resident-master.html', 'apiGet', '入居者マスタ: 読み取り（getRoster・getResident・getBulk・getListFull・getMealList・getMedDict・getSection）'],
    ['resident-master.html', 'apiPostRaw', '入居者マスタ: 薬の変更候補（medCand）'],
    ['resident-master.html', 'mdAiProxy_', '入居者マスタ: 薬効の下書き（訓練計画書の GAS の ai）'],
    ['facesheet.html', 'apiGet', 'フェイスシート: 読み取り'],
    ['care-meeting.html', 'apiGet', '担当者会議の記録: 入居者マスタの読み取り'],
    ['care-meeting.html', 'meetingPost_', '担当者会議の記録: meeting'],
    ['staff-master.html', 'apiPost', '職員マスタ: 読む action（list 等）'],
    ['ats.html', 'stfPost_', '採用管理: 職員マスタの list・getEnums'],
    ['admission-flow.html', 'masterGet', '入居調整: 入居者マスタの getRoster'],
    ['su-data-gas.js', 'post', '共通の送り口（入居調整・訓練計画書・デイ利用表の getRoster）'],
    ['care-schedule.html', 'csRosterRaw_', '週間計画: getRoster'],
    ['visit-overview.html', 'voFetchHosp', '訪問 週間俯瞰: getRoster'],
    ['support-overview.html', 'soFetchHosp', '全支援 週間俯瞰: getRoster'],
    ['weight-record.html', 'wrFetchMasterRoster', '体重管理: getRoster'],
    ['accounts-export.js', 'post', '使える人の管理の書き出し'],
    ['shadow-check.js', 'rmasterRoster', '写しの見比べ: getRoster']
  ];
  function region(src, name) {
    let h = src.indexOf('function ' + name + '(');
    if (h < 0) h = src.indexOf('var ' + name + ' = function(');
    if (h < 0) return '';
    let d = 0, i = src.indexOf('{', h);
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
    return '';
  }
  for (const [f, fn, label] of SITES) {
    const src = read(f), r = region(src, fn);
    t(label + '（' + f + ' ' + fn + '）は SUGasAuth.addTo を通す', !!r && /SUGasAuth[\s\S]{0,40}\.addTo\(|ga\.addTo\(/.test(r) && /SUGasAuth/.test(r), r.slice(0, 80));
    t('  └ 送る本文は addTo の答えで、部品が無い時も送る', /JSON\.stringify\((b|p)\)|\.then\(send\)|JSON\.stringify\(rb\)/.test(r) && /Promise\.resolve\(|: send\(payload\)|if\(window\.SUGasAuth\)/.test(r));
  }
  {
    const RM = read('resident-master.html');
    const r = region(RM, 'apiPostRaw');
    t('入居者マスタ apiPostRaw: 足すのは medCand だけ（savePartial・saveMealList の本文は今までどおり）', /body\.action==='medCand'&&window\.SUGasAuth/.test(r));
    t('入居者マスタ apiPost（書き込み）には足さない', !/SUGasAuth/.test(region(RM, 'apiPost')));
    t('入居調整 masterPost（書き込み）には足さない', !/SUGasAuth/.test(region(read('admission-flow.html'), 'masterPost')));
    const SM = region(read('staff-master.html'), 'apiPost');
    t('職員マスタ: 読む action だけ addTo・書く action は今までの証明の添え方', /REQ_WRITE_ACTIONS\.indexOf\(action\) < 0 && window\.SUGasAuth/.test(SM) && /stfmAccessToken_\(\)\.then/.test(SM));
    const G = read('su-data-gas.js');
    const D = read('su-data.js');
    t('訓練計画書の get・ai（su-data.js の入口）は gas の道で su-data-gas.js の送り口（kvGet・kvRaw→post）を通る',
      /return SU_DATA\.kvGet\(key, opts\);/.test(D) && /return SU_DATA\.kvRaw\(\{ action: 'ai', body: body \}, opts\);/.test(D) &&
      /kvGet: function \(key, t, opts\) \{ return post\(/.test(G) && /kvRaw: function \(payload, t, opts\) \{\s*return post\(payload, t\);/.test(G));
    t('su-data-gas.js: ページを閉じる時の送信（sendBeacon）には足さない', !/SUGasAuth/.test(G.slice(G.indexOf('kvPutBeacon:'), G.indexOf('kvRaw:'))));
  }
  {
    /* 合言葉の無い stateRev の要求の近く（前後 400 字）に addTo が無いこと */
    const files = ['resident-master.html', 'facesheet.html', 'care-meeting.html', 'training-plan.html', 'admission-flow.html', 'staff-master.html', 'ats.html',
      'care-schedule.html', 'visit-overview.html', 'support-overview.html', 'daycare-roster.html', 'weight-record.html', 'accounts-export.js', 'shadow-check.js',
      'su-data-gas.js', 'su-roster.js', 'connection-settings.html'];
    const bad = [];
    let seen = 0;
    for (const f of files) {
      const src = read(f);
      const re = /stateRev['"]\s*[},]/g;
      let m;
      while ((m = re.exec(src))) {
        seen++;
        const near = src.slice(Math.max(0, m.index - 400), m.index + 400);
        if (/SUGasAuth/.test(near)) bad.push(f + '@' + m.index);
      }
    }
    t('stateRev（合言葉なし）の要求には足さない（' + seen + ' か所を見た）', seen > 0 && bad.length === 0, bad);
    t('su-roster.js は触らない（画面から渡された取り出し関数を呼ぶだけ）', !/SUGasAuth/.test(read('su-roster.js')));
  }
  {
    const TAG = '<script src="su-gas-auth.js?v=2026-10-29"></script>';
    const PAGES = ['resident-master.html', 'facesheet.html', 'care-meeting.html', 'training-plan.html', 'admission-flow.html', 'staff-master.html', 'ats.html',
      'care-schedule.html', 'visit-overview.html', 'support-overview.html', 'daycare-roster.html', 'weight-record.html'];
    for (const f of PAGES) {
      const src = read(f), i = src.indexOf(TAG), e = src.indexOf('<script src="su-errors.js');
      const firstInline = src.indexOf('<script>');
      t(f + ': 部品を su-errors.js の後・画面のスクリプトより前で1回だけ読む', i > e && e >= 0 && (firstInline < 0 || i < firstInline || firstInline < e) &&
        src.split(TAG).length === 2 && src.indexOf('<script src="su-gas-auth.js') === i);
    }
    for (const [f, part] of [['accounts.html', 'accounts-export.js'], ['shadow-check.html', 'shadow-check.js']]) {
      const src = read(f), i = src.indexOf(TAG);
      t(f + ': 部品を ' + part + ' より前で読む', i >= 0 && i < src.indexOf('<script src="' + part));
    }
    /* 版は全画面で1種類 */
    const vers = new Set();
    for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
      for (const m of read(f).matchAll(/su-gas-auth\.js\?v=([0-9.-]+)/g)) vers.add(m[1]);
    }
    t('su-gas-auth.js の ?v= は全画面で1種類', vers.size === 1, [...vers]);
    t('公開の一覧（.gitignore）に入っている', /^!\/su-gas-auth\.js$/m.test(read('.gitignore')));
  }
  {
    t('部品は console を使わない・端末に書かない・fetch しない', !/console\.|localStorage\.setItem|sessionStorage|\bfetch\(/.test(SRC));
    t('部品は鍵（service_role・sb_secret_）を持たない', !/service_role|sb_secret_/.test(SRC));
  }

  finished = true;
  say('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
})().catch((e) => { say('試験が途中で止まりました: ' + (e && e.message)); process.exit(1); });
