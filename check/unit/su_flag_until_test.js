/* 切り替えスイッチの終わりの時刻（<キー>_until）の試験（2026-11-02 本人指示）。
   守りたいこと:
     A 純関数 SU.data._flagOn(スイッチ, キー, 今): _until の無いキーは今までどおり true だけが入
     B _until があれば、その時刻より前だけ入。ちょうど・過ぎたら切
     C 時刻が読めない（日付だけ・時差の無い形・文字でない・空・ありえない日付）時は切
     D 入口の道（SU.data._entryRoute）も同じ判定＝端末の時計が終わりの時刻を過ぎたら gas の道、別のキーは巻き込まない
   実行: node check/unit/su_flag_until_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const END = '2026-11-02T07:00:00+09:00';
const END_MS = Date.parse('2026-11-01T22:00:00Z');   /* 同じ時刻を UTC で */
const BEFORE = END_MS - 60000, AFTER = END_MS + 60000;

function box(flags, nowMs) {
  const store = {};
  if (flags !== undefined) store.su_backend_flags = JSON.stringify({ supabase: flags });
  const clock = { now: nowMs };
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    performance: { mark() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: flags || {} }) }),
    Date: { now: () => clock.now, parse: Date.parse },
    Promise, JSON, Object, Array, String, Number, Error, RegExp, isFinite, setTimeout, clearTimeout
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('su-data.js'), w);
  vm.runInContext(read('su-data-gas.js'), w);
  vm.runInContext(read('su-data-supabase.js'), w);
  return { w, clock };
}

const on = box(undefined, 0).w.SU.data._flagOn;

console.log('\n— A. _until の無いキーは今までどおり —');
t('true は入', on({ training_ai: true }, 'training_ai', AFTER) === true);
t('false は切', on({ training_ai: false }, 'training_ai', BEFORE) === false);
t('無いキーは切', on({}, 'training_ai', BEFORE) === false);
t('"true"（文字）は切', on({ training_ai: 'true' }, 'training_ai', BEFORE) === false);
t('スイッチが読めていない（null）は切', on(null, 'training_ai', BEFORE) === false);

console.log('\n— B. 終わりの時刻より前だけ入 —');
t('1分前は入', on({ training_ai: true, training_ai_until: END }, 'training_ai', BEFORE) === true);
t('ちょうどは切', on({ training_ai: true, training_ai_until: END }, 'training_ai', END_MS) === false);
t('1分後は切', on({ training_ai: true, training_ai_until: END }, 'training_ai', AFTER) === false);
t('Z の形も読める（前は入）', on({ training_ai: true, training_ai_until: '2026-11-01T22:00:00Z' }, 'training_ai', BEFORE) === true);
t('秒の無い形も読める（前は入）', on({ training_ai: true, training_ai_until: '2026-11-02T07:00+09:00' }, 'training_ai', BEFORE) === true);
t('false なら時刻が先でも切', on({ training_ai: false, training_ai_until: END }, 'training_ai', BEFORE) === false);
t('別のキーの _until は効かない', on({ training: true, training_ai_until: END }, 'training', AFTER) === true);

console.log('\n— C. 時刻が読めない時は切 —');
for (const [name, v] of [
  ['日付だけ', '2026-11-02'],
  ['時差の無い形', '2026-11-02T07:00:00'],
  ['空の文字', ''],
  ['null', null],
  ['数（ミリ秒）', END_MS + 86400000],
  ['ありえない日付', '2026-13-45T07:00:00+09:00'],
  ['日本語', '11月2日 7時'],
  ['前後に空白', ' ' + END]
]) t(name + 'は切（時刻がまだ先でも）', on({ training_ai: true, training_ai_until: v }, 'training_ai', BEFORE - 86400000) === false, v);
t('今の時刻が数でなければ切', on({ training_ai: true, training_ai_until: END }, 'training_ai', undefined) === false);

console.log('\n— D. 入口の道も同じ判定 —');
{
  const x = box({ training: true, training_ai: true, training_ai_until: END }, BEFORE);
  t('終わりの時刻の前は training_ai が supabase の道', x.w.SU.data._entryRoute('training_ai') === 'supabase');
  x.clock.now = AFTER;
  t('過ぎたら training_ai は gas の道', x.w.SU.data._entryRoute('training_ai') === 'gas');
  t('training（_until なし）は過ぎても supabase の道のまま', x.w.SU.data._entryRoute('training') === 'supabase');
}
{
  const x = box({ training_ai: true, training_ai_until: '壊れ' }, BEFORE);
  t('時刻が読めなければ gas の道', x.w.SU.data._entryRoute('training_ai') === 'gas');
}
{
  const x = box({ training_ai: true }, AFTER);
  t('_until が無ければ今までどおり supabase の道', x.w.SU.data._entryRoute('training_ai') === 'supabase');
}

console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
