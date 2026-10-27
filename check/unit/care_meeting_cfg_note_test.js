/* 担当者会議の記録を接続の案内・速さの記録の表に足す／入居者マスタの居室一覧の描き直しの失敗を記録に残す（2026-10-27・改善プロンプト第6弾の2）
   実行: node check/unit/care_meeting_cfg_note_test.js
   守ること:
     1. su-cfg-hint.js の表に care-meeting.html があり、接続先は入居者マスタと同じ rmaster_cfg の url
     2. perf-report.js の画面の名前の表に care-meeting.html（担当者会議の記録）がある
     3. 居室一覧の描き直し（rmRoomOnFacility_）で例外が出たら SUErrors.note を1回呼ぶ。
        種類は「保存・同期の失敗」と別の名前・渡すのは例外の名前だけ（例外の文は渡さない）・where は短い英字
     4. 記録の部品が無い／記録で例外が出ても、例外を外に出さない。続きの動き（描き直しの回数・待ち）は変えない
   ★架空データのみ（氏名は扱わない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
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

console.log('\n— 1. 接続の案内（su-cfg-hint.js）の表 —');
{
  const src = read('su-cfg-hint.js');
  const m = src.match(/var SYNC = [\s\S]*?var MAP = (\{[\s\S]*?\n  \});/);
  t('表（MAP）を切り出せる', !!m);
  const box = {};
  vm.createContext(box);
  vm.runInContext("var SYNC=[['su_sync_common','endpoint'],['ws_settings','endpoint']]; var MAP=" + (m ? m[1].replace(/;$/, '') : '{}') + ';', box);
  const v = box.MAP['care-meeting.html'];
  t('care-meeting.html が表にある', Array.isArray(v), v);
  t('接続先は rmaster_cfg の url だけ', JSON.stringify(v) === JSON.stringify([['rmaster_cfg', 'url']]), v);
  t('入居者マスタの行は変えていない', JSON.stringify(box.MAP['resident-master.html']) === JSON.stringify([['rmaster_cfg', 'url']]));
}

console.log('\n— 2. 速さの記録（perf-report.js）の画面の名前の表 —');
{
  const src = read('perf-report.js');
  const m = src.match(/var NAMES = (\{[\s\S]*?\});/);
  t('表（NAMES）を切り出せる', !!m);
  const names = m ? vm.runInNewContext('(' + m[1] + ')') : {};
  t('care-meeting.html は「担当者会議の記録」', names['care-meeting.html'] === '担当者会議の記録', names['care-meeting.html']);
  t('担当者会議の画面の名前（不具合を報告の data-tool）と同じ文言', read('care-meeting.html').includes('data-tool="担当者会議の記録"'));
  t('入居者マスタの名前は変えていない', names['resident-master.html'] === '入居者マスタ');
}

console.log('\n— 3. 居室一覧の描き直しの失敗を記録に残す —');
const RM = read('resident-master.html');
function env(opt) {
  opt = opt || {};
  const timers = [], notes = [];
  const b = {
    curView: 'room', renders: 0, getDeviceRole: () => 'office',
    roomPlanData: () => ({ f1: { cells: [] } }),
    renderRoster() { b.renders++; if (opt.throws) { const e = new TypeError('架空の名簿の描画に失敗'); throw e; } },
    JSON, String,
    document: { body: { classList: { contains: () => false } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  if (opt.window !== false) {
    b.window = opt.noteThrows
      ? { SUErrors: { note() { throw new Error('記録の失敗'); } } }
      : (opt.noSU ? {} : { SUErrors: { note(k, m, w) { notes.push([k, m, w]); } } });
  }
  vm.createContext(b);
  vm.runInContext('var rmRoomPlanSig_=null;\n' + cutF(RM, 'rmRoomOnFacility_'), b);
  return { b, timers, notes };
}
{
  const e = env({ throws: true });
  let threw = null;
  try { e.b.rmRoomOnFacility_(); } catch (x) { threw = x; }
  t('例外を外に出さない', threw === null, threw && threw.message);
  t('note を1回呼ぶ', e.notes.length === 1, e.notes.length);
  const n = e.notes[0] || [];
  t('種類は「保存・同期の失敗」と別の名前', typeof n[0] === 'string' && n[0] && n[0] !== '保存・同期の失敗', n[0]);
  t('渡すのは例外の名前だけ（例外の文・名簿の中身を渡さない）', n[1] === 'TypeError', n[1]);
  t('where は短い英字', typeof n[2] === 'string' && /^[A-Za-z:._-]{1,32}$/.test(n[2]), n[2]);
  t('続きの動きは変えない（描き直しは1回・待ちは増やさない）', e.b.renders === 1 && e.timers.length === 0, [e.b.renders, e.timers.length]);

  const ok = env({ throws: false });
  ok.b.rmRoomOnFacility_();
  t('例外が無い時は記録しない', ok.notes.length === 0 && ok.b.renders === 1, ok.notes);

  for (const [label, opt] of [['window が無い', { throws: true, window: false }], ['SUErrors が無い', { throws: true, noSU: true }], ['note が例外を出す', { throws: true, noteThrows: true }]]) {
    const x = env(opt);
    let th = null;
    try { x.b.rmRoomOnFacility_(); } catch (y) { th = y; }
    t('★' + label + '時も例外を外に出さず、描き直しは1回のまま', th === null && x.b.renders === 1 && x.timers.length === 0, th && th.message);
  }
  t('su-errors.js の読み込みは居室一覧の処理より前（note が使える）', RM.indexOf('<script src="su-errors.js') >= 0 && RM.indexOf('<script src="su-errors.js') < RM.indexOf('function rmRoomOnFacility_('));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
