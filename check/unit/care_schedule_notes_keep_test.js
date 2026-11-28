/* 週間計画（care-schedule.html）：新しい端末で開いても、予定の備考を消さない・送らない（代表者の決定 2026-11-28）
   実行: node check/unit/care_schedule_notes_keep_test.js

   なぜ作るか:
     2026-07-01 の一回限りの備考の一括クリア（migrateClearNotes_）は、済みの印を端末にだけ持っていた。
     そのため、接続先のある端末で初めて週間計画を開くたびに、取得した全員の予定の備考を空にしてすぐ送っていた
     （新しい端末・サイトのデータを消した端末・新しい施設）。一括クリアは止め、呼ぶ所だけを残した。

   何を守るか（関数を HTML から切り出し、端末の控えと保存を偽物にして動かす）:
     1. 済みの印が無い端末でも、備考の入った予定の備考を1文字も変えない
     2. 端末の控え（localStorage）に何も書かない（控え・済みの印を作らない）・保存（saveDB）を呼ばない
     3. いつも false を返す＝起動の取得の後の「消した後にすぐ送る」が動かない
   ★公開リポジトリの check/unit にある。氏名・施設名は使わない（架空の備考だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

/* 関数の本体を、文字列とコメントの中のかっこを数えずに切り出す */
function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' が見つからない');
  const open = src.indexOf('{', at);
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(name + ' の終わりが見つからない');
}

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}

function run() {
  const writes = [];
  let saves = 0;
  const store = {};   // 済みの印が無い・新しい端末
  const DB = { residents: [
    { id: 'r1', events: [{ id: 'e1', detail: '架空の支援', notes: '架空の備考A' }, { id: 'e2', detail: '', notes: '架空の備考B' }] },
    { id: 'r2', events: [{ id: 'e3', detail: '架空の支援', notes: '' }] },
  ] };
  const before = JSON.stringify(DB);
  const ctx = {
    DB, LS_KEY: 'care_schedule_v2',
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { writes.push(k); store[k] = String(v); },
      removeItem: (k) => { writes.push('-' + k); delete store[k]; },
    },
    saveDB: () => { saves++; return true; },
    csNote_: () => {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(SRC, 'migrateClearNotes_') + '\nvar __r = migrateClearNotes_();', ctx);
  return { ret: ctx.__r, writes, saves, before, after: JSON.stringify(DB) };
}

t('1. 済みの印が無い端末でも、備考を1文字も変えない', () => {
  const r = run();
  assert.strictEqual(r.after, r.before);
});
t('2. 端末の控えに何も書かない・保存を呼ばない', () => {
  const r = run();
  assert.deepStrictEqual(r.writes, []);
  assert.strictEqual(r.saves, 0);
});
t('3. いつも false を返す（消した後にすぐ送る道が動かない）', () => {
  assert.strictEqual(run().ret, false);
});
if (failed) { console.log('\n' + failed + ' 件 失敗'); process.exit(1); }
console.log('\nすべて合格');
