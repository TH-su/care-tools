/* 入居者マスタの居室一覧：施設情報が後から届いた時に描き直す（2026-10-23 代表者の指示）
   実行: node check/unit/master_room_facwait_test.js
   守ること:
     1. 施設情報（SUFacility.onReady）が届いた時、居室一覧を開いていれば描き直す（「間取り図が設定されていません」のまま残さない）
     2. 居室一覧以外のビュー・現場端末では何もしない
     3. 印刷の準備中（body.su-printing）は描き直さず、終わってから1回だけ描き直す（待つのは最大40回）
     4. onReady の知らせは init の後へ回す（その場で呼ばれても、名簿を読む前に描かない）
   ★架空データのみ（氏名は扱わない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
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
}

function env(view, role, printing) {
  const timers = [];
  const cls = new Set(printing ? ['su-printing'] : []);
  const b = {
    curView: view, renders: 0,
    getDeviceRole: () => role,
    renderRoster() { b.renders++; },
    document: { body: { classList: { contains: (c) => cls.has(c) } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  vm.createContext(b);
  vm.runInContext(cutF(RM, 'rmRoomOnFacility_'), b);
  return { b, timers, cls };
}

console.log('\n— 1. 居室一覧を開いている時だけ描き直す —');
{
  const e = env('room', 'office', false);
  e.b.rmRoomOnFacility_();
  t('居室一覧を開いていれば描き直す', e.b.renders === 1, e.b.renders);
  const o = env('cm', 'office', false);
  o.b.rmRoomOnFacility_();
  t('★ほかのビュー（ケアマネ一覧）では描き直さない', o.b.renders === 0 && o.timers.length === 0);
  const f = env('room', 'field', false);
  f.b.rmRoomOnFacility_();
  t('★現場端末では何もしない', f.b.renders === 0 && f.timers.length === 0);
}

console.log('\n— 2. 印刷の準備中は待つ —');
{
  const e = env('room', 'office', true);
  e.b.rmRoomOnFacility_();
  t('★印刷の準備中は描き直さず、少し後にもう一度見る', e.b.renders === 0 && e.timers.length === 1 && e.timers[0].ms === 500, e.timers.map((x) => x.ms));
  e.cls.delete('su-printing');
  e.timers.shift().fn();
  t('印刷が終わったら1回だけ描き直す', e.b.renders === 1 && e.timers.length === 0, e.b.renders);
  const g = env('room', 'office', true);
  g.b.rmRoomOnFacility_();
  let n = 0;
  while (g.timers.length && n < 100) { g.timers.shift().fn(); n++; }
  t('★印刷の準備がいつまでも終わらなくても、待つのは40回まで（止まらない時計を残さない）', n === 40 && g.b.renders === 0 && g.timers.length === 0, n);
}

console.log('\n— 3. 知らせの受け方 —');
{
  const reg = /document\.addEventListener\('DOMContentLoaded',function\(\)\{\s*try\{ if\(window\.SUFacility&&typeof SUFacility\.onReady==='function'\) SUFacility\.onReady\(function\(\)\{ setTimeout\(rmRoomOnFacility_,0\); \}\); \}catch\(e\)\{\}\s*\}\);/;
  t('★DOMContentLoaded で SUFacility.onReady に登録し、知らせは setTimeout(…,0) で init の後へ回す', reg.test(RM));
  const at = RM.search(reg), initAt = RM.indexOf("document.addEventListener('DOMContentLoaded',init);");
  t('登録は init の登録より前（同じ DOMContentLoaded の中で init が先に済むよう、知らせは次の回へ回す）', at > 0 && initAt > at, [at, initAt]);
  const fac = fs.readFileSync(path.join(ROOT, 'su-facility.js'), 'utf8');
  t('su-facility.js に onReady がある（読めた時・読めないと分かった時に1回呼ぶ）', /onReady:\s*function\s*\(fn\)/.test(fac) && /function settle\(\)/.test(fac));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
