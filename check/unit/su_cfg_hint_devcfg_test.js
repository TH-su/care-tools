/* 接続の案内（su-cfg-hint.js）が、管理者が全端末へ配った接続先（su-devcfg.js・統合 0080）とログインを見て、出さない時は出さない（2026-11-10）
   実行: node check/unit/su_cfg_hint_devcfg_test.js
   守ること:
     1. 端末の控えが空でも、SUDevCfg.get がその画面の系統の接続先を返す時は「入っていない」としない
     2. SUDevCfg が無い・何も返さない時は、今までどおり「入っていない」とする
     3. メニューは、ログインの印がある端末では「入っていない」としない（ログインしていない端末は今までどおり）
     4. 端末の控えに接続先がある時は、今までどおり「入っていない」としない
   ★架空データのみ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-cfg-hint.js'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function make(pageName, store, devcfg) {
  const ls = new Map(Object.entries(store || {}));
  const localStorage = {
    get length() { return ls.size; },
    key(i) { return Array.from(ls.keys())[i] || null; },
    getItem(k) { return ls.has(k) ? ls.get(k) : null; },
    setItem(k, v) { ls.set(k, String(v)); }, removeItem(k) { ls.delete(k); }
  };
  const win = {};
  if (devcfg) win.SUDevCfg = { get: (k) => devcfg[k] || null, ready: () => Promise.resolve() };
  const ctx = {
    window: win, localStorage,
    location: { pathname: '/care-tools/' + pageName },
    document: { readyState: 'complete', body: null, getElementById: () => null, addEventListener() {} },
    setTimeout() {}, setInterval() {}, clearInterval() {}, Promise, JSON, Math, String, Array, Object
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return win.SUCfgHint;
}
const URL1 = { url: 'https://script.google.com/macros/s/AKfyc-test0001/exec', token: 'x' };

console.log('\n— 1. 配った接続先を受け取っている画面 —');
t('入居者マスタ: 控えが空でも、配った master があれば出さない', make('resident-master.html', {}, { master: URL1 })._empty() === false);
t('週間計画: 控えが空でも、配った ws があれば出さない', make('care-schedule.html', {}, { ws: URL1 })._empty() === false);
t('体重管理: 配った weight があれば出さない', make('weight-record.html', {}, { weight: URL1 })._empty() === false);
t('申送ビューア: 配った moushi があれば出さない', make('moushiokuri-viewer.html', {}, { moushi: URL1 })._empty() === false);
t('入居者マスタ: 配ったのが別の系統（ws）だけなら今までどおり出す', make('resident-master.html', {}, { ws: URL1 })._empty() === true);

console.log('\n— 2. 配った接続先が無い時は今までどおり —');
t('部品が無い: 控えが空なら出す', make('resident-master.html', {}, null)._empty() === true);
t('部品が何も返さない: 控えが空なら出す', make('facesheet.html', {}, {})._empty() === true);

console.log('\n— 3. メニュー —');
t('ログインの印がある端末では出さない', make('index.html', { 'sb-abcdefgh-auth-token': '{"access_token":"x"}' }, null)._empty() === false);
t('ログインの印が空の値なら今までどおり出す', make('index.html', { 'sb-abcdefgh-auth-token': '' }, null)._empty() === true);
t('ログインしていない端末は今までどおり出す', make('index.html', {}, null)._empty() === true);
t('ほかの画面はログインの印だけでは出さない扱いにしない（配った値を見る）', make('resident-master.html', { 'sb-abcdefgh-auth-token': '{"a":1}' }, {})._empty() === true);

console.log('\n— 4. 端末の控えがある時 —');
t('控えに接続先がある時は出さない', make('resident-master.html', { rmaster_cfg: JSON.stringify({ url: URL1.url }) }, null)._empty() === false);

console.log('\n' + (fail ? '✗' : '✓') + ' su_cfg_hint_devcfg: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
