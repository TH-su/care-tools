/* 体重管理：端末の保存領域が足りない時、控え（二世代目から）を捨てて本体と一世代目を守る（2026-11-11・自動報告 QuotaExceededError の直し）
   実行: node check/unit/weight_backup_quota_test.js
   守ること:
     1. 容量が足りる時は今までどおり、本体・一世代目・二世代目を書く
     2. 二世代目が入らない時は二世代目を捨て、記録しない（端末の状態のため）。本体・一世代目は書く
     3. 一世代目が入らない時は二世代目を捨てて書き直す。それでも入らない時だけ1件記録し、本体の保存は続ける
     4. 容量以外の失敗は今までどおり記録する
   ★架空データのみ。weight-record.html の実物の save() を切り出して動かす */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'weight-record.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) { const h = SRC.indexOf('function ' + name + '('); let i = SRC.indexOf('{', h), d = 0; for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(h, i + 1); } } }
function world(cap, opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {}), notes = [];
  const used = () => Object.keys(store).reduce((n, k) => n + k.length + String(store[k]).length, 0);
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (opts.other && opts.other(k)) { const e = new Error('x'); e.name = 'SecurityError'; throw e; }
      const before = k in store ? k.length + store[k].length : 0;
      if (used() - before + k.length + String(v).length > cap) { const e = new Error('q'); e.name = 'QuotaExceededError'; throw e; }
      store[k] = String(v);
    },
    removeItem: (k) => { delete store[k]; }
  };
  const ctx = { localStorage: ls, console: { error() {}, info() {}, warn() {} }, JSON, Date, window: { dispatchEvent() {} }, CustomEvent: function () {},
    LS_KEY: 'wtmgr_v1', LS_BAK: 'wtmgr_v1_bak', LS_BAK2: 'wtmgr_v1_bak2', LS_LAST_SAVE: 'wtmgr_last_save_at',
    wrNote_: (w, e) => notes.push(w), toast: () => {}, DB: opts.db || { residents: [{ id: 1, name: '架空 一郎' }], records: [] } };
  vm.createContext(ctx);
  vm.runInContext('let _lastSaveOk=true, _lastSaveAt=null;\n' + cut('save') + '\nthis.save=save;', ctx);
  return { ctx, store, notes };
}
const old1 = JSON.stringify({ residents: [{ id: 1, name: '架空 一郎' }], records: [{ v: 'a'.repeat(200) }] });
const old2 = JSON.stringify({ residents: [{ id: 1, name: '架空 一郎' }], records: [{ v: 'b'.repeat(200) }] });
const newDb = { residents: [{ id: 1, name: '架空 一郎' }], records: [{ v: 'c'.repeat(200) }] };
console.log('体重管理：控えの容量');
{
  const w = world(1e6, { store: { wtmgr_v1: old1, wtmgr_v1_bak: old2 }, db: newDb });
  const ok = w.ctx.save();
  t('1. 容量が足りる時は本体・一世代目・二世代目を書く', ok && w.store.wtmgr_v1 === JSON.stringify(newDb) && w.store.wtmgr_v1_bak === old1 && w.store.wtmgr_v1_bak2 === old2 && !w.notes.length, w.notes);
}
{
  /* 本体＋一世代目は入るが、二世代目まで入らない大きさ */
  const cap = 'wtmgr_v1'.length * 2 + old1.length * 2 + 'wtmgr_v1_bak'.length + 'wtmgr_last_save_at'.length + 60 + 30;
  const w = world(cap, { store: { wtmgr_v1: old1, wtmgr_v1_bak: old2, wtmgr_v1_bak2: old2 }, db: newDb });
  const ok = w.ctx.save();
  t('2. 二世代目が入らない時は二世代目を捨て、記録しない。本体と一世代目は書く', ok && !('wtmgr_v1_bak2' in w.store) && w.store.wtmgr_v1_bak === old1 && w.store.wtmgr_v1 === JSON.stringify(newDb) && !w.notes.length, { keys: Object.keys(w.store), notes: w.notes });
}
{
  /* 一世代目を書くには二世代目を捨てる必要がある大きさ（二世代目を置いたまま一世代目を書き換えると入らない） */
  const big = JSON.stringify({ residents: [], records: [{ v: 'd'.repeat(260) }] });
  const cap = 'wtmgr_v1'.length + old1.length + 'wtmgr_v1_bak'.length + big.length + 'wtmgr_v1_bak2'.length + old2.length + 10;
  const w = world(cap, { store: { wtmgr_v1: big, wtmgr_v1_bak: old1, wtmgr_v1_bak2: old2 }, db: { residents: [], records: [] } });
  w.ctx.save();
  t('3. 一世代目が入らない時は二世代目を捨てて書き直す（記録しない）', w.store.wtmgr_v1_bak === big && !('wtmgr_v1_bak2' in w.store) && !w.notes.length, { keys: Object.keys(w.store), notes: w.notes });
}
{
  const big = JSON.stringify({ residents: [], records: [{ v: 'e'.repeat(400) }] });
  const cap = 'wtmgr_v1'.length + big.length + 'wtmgr_v1_bak'.length + 100 + 'wtmgr_last_save_at'.length + 30 + 40;
  const w = world(cap, { store: { wtmgr_v1: big, wtmgr_v1_bak: 'x'.repeat(100) }, db: { residents: [], records: [] } });
  const ok = w.ctx.save();
  t('3. 二世代目を捨てても入らない時だけ1件記録し、本体の保存は続ける（古い一世代目は残す）', ok && w.notes.length === 1 && w.notes[0] === '控えの書き込み（容量）' && w.store.wtmgr_v1_bak === 'x'.repeat(100) && w.store.wtmgr_v1 === '{"residents":[],"records":[]}', { notes: w.notes, keys: Object.keys(w.store) });
}
{
  const w = world(1e6, { store: { wtmgr_v1: old1, wtmgr_v1_bak: old2 }, db: newDb, other: (k) => k === 'wtmgr_v1_bak' });
  w.ctx.save();
  t('4. 容量以外の失敗は今までどおり記録する', w.notes.indexOf('控えの書き込み') >= 0, w.notes);
}
console.log('\n' + (fail ? '✗' : '✓') + ' weight_backup_quota: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
