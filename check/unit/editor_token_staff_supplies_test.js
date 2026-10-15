/* 職員マスタ（staff-master.html）・消耗品管理（supplies.html）── 書く要求にログインの証明を添える試験（2026-10-15 新設）
   実行: node check/unit/editor_token_staff_supplies_test.js
   守ること:
     1. 証明の取り出し: ログインの控え（sb-…-auth-token）が端末に無ければ問い合わせずに ''（supabase-js・su-auth.js も読み込まない）
        控えがあればセッションの access_token・取り出せない／失敗は ''・3秒で返らなければ ''
     2. 書く action の要求（POST の本文）にだけ accessToken を添える。読むだけの action・ログインなしでは添えない
     3. ログインの控えが無い時は今までどおりすぐ送る（fetch を同じ呼び出しの中で呼ぶ）
     4. 証明は URL・端末の保存（localStorage）には残さない
     5. 画面の by は旧い GAS との互換のため送り続ける（GAS 側で記録に使わない）
   ★証明は試験用の作り物。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('閉じていません: ' + name);
}
function cutVar(src, name) {
  const m = src.match(new RegExp('var ' + name + ' = [\\s\\S]*?;\\n'));
  if (!m) throw new Error('変数が見つかりません: ' + name);
  return m[0];
}
const TOKEN = 'aaa.bbb.ccc';
const tick = () => new Promise(r => setImmediate(r));

/* app: 画面ごとの名前（関数・書く action の一覧）。opt.login（控えあり）・opt.session（getSession の結果）・opt.hang（返らない） */
function box(app, opt) {
  const o = opt || {};
  const store = {};
  if (o.login) store['sb-example123-auth-token'] = '{"x":1}';
  store.some_ui_state = 'tab1';
  const sets = [], fetches = [], timers = [], loads = [];
  let getSessionCalls = 0;
  const auth = { client: () => ({ auth: { getSession: () => { getSessionCalls++;
    if (o.hang) return new Promise(() => {});
    if (o.reject) return Promise.reject(new Error('x'));
    return Promise.resolve(o.session === undefined ? { data: { session: { access_token: TOKEN } } } : o.session); } } }) };
  const b = {
    localStorage: o.lsThrows ? { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); } } : {
      getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { sets.push([k, v]); store[k] = String(v); },
      key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
    window: o.noAuth ? {} : { SUAuth: auth, supabase: {} },
    document: { scripts: [], head: { appendChild: s => { loads.push(s.src); } }, createElement: () => ({}) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true}') }); },
    AbortController: function () { this.signal = {}; this.abort = function () {}; },
    Promise, Date, String, Math, isFinite, Array, Object, JSON, Number, Error, Uint8Array,
    crypto: { getRandomValues: a => a }
  };
  vm.createContext(b);
  const src = app.src;
  const parts = [
    'function txt(v){ return v == null ? "" : String(v); }',
    'function mkErr(m, h){ var e = new Error(m); e.userMsg = m; e.hint = h || ""; return e; }',
    'function markNoAnswer(e){ e.noAnswer = true; return e; }',
    'function loadCfg(){ return { url: "https://script.google.com/macros/s/EXAMPLE/exec", token: "aikotoba", by: "事務所PC" }; }',
    'var URL_OK_RE = /^https:\\/\\/script\\.google\\.com\\//;',
    'var FLUSH_FAIL_MSG = "x"; var CFG_URL_CHECK = "x"; var MOVE_WRITERS = []; function markBillStale(){}',
    'function serverErrText(){ return "x"; } function serverErrHint(){ return "x"; }',
    cutVar(src, app.writeVar), cutVar(src, app.sessionVar)
  ];
  if (app.newReqId) parts.push(cutF(src, 'newReqId'));
  parts.push(cutF(src, app.has), cutF(src, app.load), cutF(src, app.token), cutF(src, 'apiPost'));
  vm.runInContext(parts.join('\n'), b);
  return { b, sets, fetches, timers, loads, gs: () => getSessionCalls };
}

const APPS = [
  { label: '職員マスタ', src: fs.readFileSync(process.env.STFM_HTML || path.join(ROOT, 'staff-master.html'), 'utf8'),
    has: 'stfmHasLogin_', load: 'stfmAuthLoad_', token: 'stfmAccessToken_', writeVar: 'REQ_WRITE_ACTIONS', sessionVar: 'STFM_SESSION_RE', newReqId: true,
    writes: ['bulkSave', 'importRows', 'uploadFile', 'removeFile', 'setEnums', 'setCommittees', 'setCorp'],
    reads: ['list', 'dryRun', 'getSecure', 'getEnums', 'getCommittees', 'getCorp'] },
  { label: '消耗品管理', src: fs.readFileSync(process.env.SPL_HTML || path.join(ROOT, 'supplies.html'), 'utf8'),
    has: 'splHasLogin_', load: 'splAuthLoad_', token: 'splAccessToken_', writeVar: 'SPL_WRITE_ACTIONS', sessionVar: 'SPL_SESSION_RE', newReqId: false,
    writes: ['saveItem', 'addPrice', 'voidPrice', 'setProfiles', 'addMoves', 'voidMove', 'repriceMoves', 'setNote', 'setCategories', 'setDefaults', 'setClosedMonths'],
    reads: ['list', 'listPrices', 'listMoves'] }
];

/* 約束（Promise）が返らないまま空になると node は終了コード 0 で抜ける＝失敗を見落とす。最後まで来なければ失敗にする */
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 試験が最後まで進まなかった（返らない約束がある）'); process.exitCode = 1; } });
(async function main() {
  for (const app of APPS) {
    console.log('\n— ' + app.label + ' —');
    /* 1. 証明の取り出し */
    {
      const x = box(app, {});
      t('控えが無ければログインなし', x.b[app.has]() === false);
      const r = await x.b[app.token]();
      t('控えが無ければ問い合わせずに ""（読み込みもしない）', r === '' && x.gs() === 0 && x.loads.length === 0 && x.timers.length === 0, [r, x.gs(), x.loads]);
    }
    {
      const x = box(app, { lsThrows: true });
      t('localStorage が読めない端末はログインなし', x.b[app.has]() === false);
    }
    {
      const x = box(app, { login: true });
      t('控え（sb-…-auth-token）があればログインあり', x.b[app.has]() === true);
      const r = await x.b[app.token]();
      t('ログイン中はセッションの access_token', r === TOKEN, r);
      t('3秒の打ち切りを置く', x.timers.some(tm => tm.ms === 3000), x.timers.map(tm => tm.ms));
    }
    {
      const x = box(app, { login: true, session: { data: { session: null } } });
      t('セッションが無ければ ""', (await x.b[app.token]()) === '');
      const y = box(app, { login: true, reject: true });
      t('取り出しが失敗したら ""', (await y.b[app.token]()) === '');
    }
    {
      const x = box(app, { login: true, hang: true });
      const p = x.b[app.token]();
      await tick();
      const tm = x.timers.find(z => z.ms === 3000);
      if (tm) tm.fn();
      t('3秒で返らなければ ""', (await p) === '');
    }
    {
      const x = box(app, { login: true, noAuth: true });
      x.b[app.token]();
      await tick();
      t('su-auth・supabase-js が無ければ使う時にだけ読み込む', x.loads.some(s => /^supabase-js-/.test(s)), x.loads);
    }
    t('書く action の一覧が GAS と同じ', JSON.stringify(vm.runInNewContext(cutVar(app.src, app.writeVar) + app.writeVar)) === JSON.stringify(app.writes));

    /* 2. 書く要求にだけ添える */
    for (const a of app.writes) {
      const x = box(app, { login: true });
      await x.b.apiPost(a, { id: 'x' });
      const body = x.fetches[0] && JSON.parse(x.fetches[0].init.body);
      t('書く ' + a + ': 本文に accessToken を添える（URL には載せない）', body && body.accessToken === TOKEN && x.fetches[0].url.indexOf(TOKEN) < 0, body);
      if (a === app.writes[0]) {
        t('  └ 画面の by は旧い GAS との互換で送り続ける', app.label !== '消耗品管理' || body.by === '事務所PC', body);
        t('  └ 証明を端末に保存しない', !x.sets.some(s => String(s[1]).indexOf(TOKEN) >= 0), x.sets);
      }
    }
    for (const a of app.reads) {
      const x = box(app, { login: true });
      await x.b.apiPost(a, {});
      const body = JSON.parse(x.fetches[0].init.body);
      t('読む ' + a + ': 添えない・問い合わせない', !('accessToken' in body) && x.gs() === 0, body);
    }
    {
      const x = box(app, {});
      const p = x.b.apiPost(app.writes[0], { id: 'x' });
      t('ログインなし: 今までどおり同じ呼び出しの中で送る', x.fetches.length === 1);
      await p;
      t('ログインなし: accessToken は付かない', !('accessToken' in JSON.parse(x.fetches[0].init.body)));
    }
    {
      const x = box(app, { login: true, session: { data: { session: null } } });
      await x.b.apiPost(app.writes[0], { id: 'x' });
      t('証明を取り出せない時は添えずに送る（保存は止めない）', x.fetches.length === 1 && !('accessToken' in JSON.parse(x.fetches[0].init.body)));
    }
  }
  finished = true;
  console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
