/* 全支援俯瞰・訪問俯瞰：接続先の無い端末でも、ログインだけで入院の印を重ねる（2026-11-12 商用化の見直し 6）の試験。
 * 各画面の「入院を重ねる」の関数（*HospLoginOnly_・*FetchHosp・*ApplyHosp・*WatchState）を切り出し、架空の window で動かす。架空データだけ。
 * 確かめること:
 *   1. 接続先があれば今までどおり（Google へ送る形は変えない・名簿の入口に今までの読み方を渡す）
 *   2. 接続先が無い・ログインの控えがある・事務所PC: 名簿の入口（officeOnly）から受け取った入院の印を重ねる。Google へは何も送らない
 *   3. 入口が今までの読み方（Google）へ戻した時（ログインしていない・切り替える前）は、何も送らずに重ねない
 *   4. ログインの控えが無い・現場の端末・入口の部品が無い時は、入口も呼ばない
 *   5. 版数の見張り: 接続先が無くても、ログインだけで読める時は入口の版数を見張り、変わった時に読み直す。Google へは聞かない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
let ok = 0, ng = 0;
function t(name, cond, extra){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }

function slice(src, from, to){ const i = src.indexOf(from); const j = src.indexOf(to, i); return i >= 0 && j > i ? src.slice(i, j) : ''; }

for (const [file, P, where] of [['support-overview.html', 'so', 'support'], ['visit-overview.html', 'vo', 'visit']]) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const code = slice(src, 'var ' + P.toUpperCase() + '_CFG_KEY', '\n/* ── 現場の端末では氏名を姓だけで出す') || slice(src, 'var ' + P.toUpperCase() + '_CFG_KEY', '\nfunction render(db) {');
  t('入院を重ねる関数を切り出せる', code.indexOf('function ' + P + 'HospLoginOnly_') >= 0 && code.indexOf('function ' + P + 'WatchState') >= 0);

  function run(opt){
    const store = Object.assign({}, opt.store || {});
    const keys = Object.keys(store);
    const sent = [], calls = [], revCalls = [];
    const win = {
      SUDevCfg: opt.cfg ? { get: () => opt.cfg } : { get: () => null },
      SURoster: null,
      SUGasAuth: null
    };
    if (opt.resRead !== false) {
      win.SUResRead = {
        call: (body, old, o) => { calls.push({ body, o }); return opt.routed ? Promise.resolve(opt.routed) : old(); },
        stateRev: (gasFn, o) => { revCalls.push(o); return opt.rev != null ? Promise.resolve({ json: () => Promise.resolve({ ok: true, rev: opt.rev, srev: 0 }) }) : gasFn(); }
      };
    }
    const ctx = {
      window: win,
      localStorage: { getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null, key: (i) => keys[i] || null, get length(){ return keys.length; } },
      fetch: (url, init) => { sent.push({ url, init }); return Promise.resolve({ json: () => Promise.resolve({ roster: [{ id: 'M1', hospitalized: true }] }) }); },
      document: { hidden: false },
      JSON, Promise, Object, String, Array, Error
    };
    vm.createContext(ctx);
    vm.runInContext(code + '\n;this.__x = { fetchHosp: ' + P + 'FetchHosp, apply: ' + P + 'ApplyHosp, watch: ' + P + 'WatchState, map: function(){ return ' + P + 'HospMap; } };', ctx);
    return { ctx, x: ctx.__x, sent, calls, revCalls };
  }
  const LOGIN = { 'sb-abc-auth-token': '{"x":1}' };
  const ROSTER = { roster: [{ id: 'M1', hospitalized: true }, { id: 'M2', hospitalized: false }, { id: 'M3' }] };
  function residents(){ return [{ masterId: 'M1', hospitalized: false }, { masterId: 'M2', hospitalized: true }, { masterId: 'M3', hospitalized: true }, { name: '架空' }]; }
  function applyTo(x){ const arr = residents(); if (P === 'so') x.apply(arr); else x.apply({ residents: arr }); return arr; }

  module.exports.__p = (module.exports.__p || Promise.resolve()).then(async () => {
    console.log('— ' + file + ' —');
    {
      const r = run({ cfg: { url: 'https://example.invalid/exec', token: 'tk' }, store: {} });
      const got = await r.x.fetchHosp();
      t(file + ' 1. 接続先あり: 今までどおり Google へ getRoster を POST 本文で送る', got === true && r.sent.length === 1 && r.sent[0].init.method === 'POST' && r.sent[0].init.headers['Content-Type'] === 'text/plain;charset=utf-8' && JSON.parse(r.sent[0].init.body).action === 'getRoster', r.sent.map((s) => s.init && s.init.body));
      t(file + ' 1. 接続先あり: 名簿の入口に officeOnly で渡す', r.calls.length === 1 && r.calls[0].o.officeOnly === true && r.calls[0].o.screen === where + '-overview');
    }
    {
      const r = run({ cfg: null, store: LOGIN, routed: ROSTER });
      const got = await r.x.fetchHosp();
      const arr = applyTo(r.x);
      t(file + ' 2. 接続先なし・ログイン・事務所PC: 入口から受け取る', got === true && r.calls.length === 1 && r.calls[0].o.officeOnly === true);
      t(file + ' 2. Google へは何も送らない', r.sent.length === 0);
      t(file + ' 2. 入院の印を重ねる（印のある方だけ・印の無い方と masterId の無い方は触らない）', arr[0].hospitalized === true && arr[1].hospitalized === false && arr[2].hospitalized === true && arr[3].hospitalized === undefined, arr);
    }
    {
      const r = run({ cfg: null, store: LOGIN, routed: null });
      const got = await r.x.fetchHosp();
      t(file + ' 3. 入口が Google へ戻した時: 何も送らずに重ねない', got === false && r.sent.length === 0 && r.x.map() === null);
    }
    {
      const r = run({ cfg: null, store: {}, routed: ROSTER });
      t(file + ' 4. ログインの控えが無い: 入口を呼ばない', (await r.x.fetchHosp()) === false && r.calls.length === 0 && r.sent.length === 0);
      const f = run({ cfg: null, store: Object.assign({ su_device_role: 'field' }, LOGIN), routed: ROSTER });
      t(file + ' 4. 現場の端末: 入口を呼ばない', (await f.x.fetchHosp()) === false && f.calls.length === 0 && f.sent.length === 0);
      const n = run({ cfg: null, store: LOGIN, resRead: false });
      t(file + ' 4. 入口の部品が無い: 何もしない', (await n.x.fetchHosp()) === false && n.sent.length === 0);
    }
    {
      const r = run({ cfg: null, store: LOGIN, routed: ROSTER, rev: 7 });
      r.x.watch();
      await new Promise((ok2) => setTimeout(ok2, 20));
      t(file + ' 5. 接続先なし・ログイン: 入口の版数を見張り、変わった時に読み直す', r.revCalls.length === 1 && r.revCalls[0].key === where && r.calls.length === 1 && r.sent.length === 0);
      const r2 = run({ cfg: null, store: LOGIN, routed: ROSTER, rev: null });
      r2.x.watch();
      await new Promise((ok2) => setTimeout(ok2, 20));
      t(file + ' 5. 入口が Google へ戻した時: 何も聞かない', r2.sent.length === 0 && r2.calls.length === 0);
      const r3 = run({ cfg: null, store: {}, rev: 7 });
      r3.x.watch();
      t(file + ' 5. ログインの控えが無い: 見張らない', r3.revCalls.length === 0 && r3.sent.length === 0);
    }
  });
}
module.exports.__p.then(() => {
  console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
  process.exit(ng ? 1 : 0);
}, (e) => { console.log('  ✗ 例外 ' + (e && e.stack || e)); process.exit(1); });
