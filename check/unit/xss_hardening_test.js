/* xss_hardening_test.js — innerHTML の全数点検で見つけた所の守り（2026-10-16・ポートフォリオ現況の改善プロンプト3）
 *
 * 固定する約束:
 *   1 入居者マスタの居室一覧の脚注「図に無い居室番号」は、名簿の居室番号を esc を通して出す（実行される値を入れても HTML にならない）
 *   2 間取り図の数（列幅・行高・縦横比・マスの位置）は数に直してから style に入れ、図の名前は esc を通す。正しい設定では今までと同じ文字列
 *   3 週間計画の前の版の控えの一覧は、端末の控えから読む件数を数に直す
 *   4 週間計画の escHtml は ' も置き換える（入居者マスタの esc と同じ5記号）
 * 実物の画面のソースから関数を切り出して動かす（写経しない）。RM_HTML・CS_HTML で差し替えるのは、直す前の版で落ちるかの確認用。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(process.env.RM_HTML || path.join(ROOT, 'resident-master.html'), 'utf8');
const CS = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(src, name) {
  const m = new RegExp('\\n[ \\t]*function ' + name + '\\(').exec(src);
  if (!m) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(src, m.index);
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(m.index, end + 1);
}
/* esc・escHtml は正規表現の中に引用符を含み簡易スキャナで切り出せないので、行の形で取る */
function grabLine(src, re) { const m = re.exec(src); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
const EVIL = '<img src=x onerror=alert(1)>';
const hasTag = (h) => /<img\b/i.test(h);

console.log('— 入居者マスタ：居室一覧 —');
{
  const PLAN = {
    f1: { title: '1階', cols: [1.5, 2, '3'], rows: [1, 1], ar: [297, 210], align: 'left',
          cells: [{ r: 1, c: 1, room: '101' }, { r: 1, c: 2, rs: 2, t: 'ホール', sides: 'lt' }] },
    f2: { title: '2階', cols: [1], rows: [1], ar: [1, 1], cells: [{ r: 1, c: 1, room: '201' }] }
  };
  const box = { PLAN, OCC: {} };
  vm.createContext(box);
  const code = [
    grabLine(RM, /function esc\(s\)\{[^\n]*\}/),
    'function roomPlanData(){ return PLAN; }',
    'function roomOccupants(){ return OCC; }',
    'function shStamp(){ return "R8.10.16"; }',
    /function rpNum_\(/.test(RM) ? grabFn(RM, 'rpNum_') : '',
    grabFn(RM, 'roomSideCls'), grabFn(RM, 'roomCellHtml'), grabFn(RM, 'roomFtNote'), grabFn(RM, 'roomFloorHtml')
  ].join('\n');
  vm.runInContext(code, box);

  box.OCC = { '101': [{ name: '架空 一郎' }] };
  box.OCC[EVIL] = [{ name: '架空 次郎' }];
  const note = box.roomFtNote('f1', box.OCC);
  t('1 図に無い居室番号に実行される値を入れても、タグにならない', !hasTag(note), note);
  t('1 図に無い居室番号は文字として残る（黙って落とさない）', note.includes('&lt;img src=x onerror=alert(1)&gt;'), note);
  t('1 普通の居室番号は今までどおり', box.roomFtNote('f1', { '101': [{ name: 'a' }], '999': [{ name: 'b' }] }).includes('★図に無い居室番号 999'));

  const okHtml = box.roomFloorHtml('f1');
  t('2 正しい設定では style が今までと同じ文字列', okHtml.includes('grid-template-columns:1.5fr 2fr 3fr;grid-template-rows:1fr 1fr;aspect-ratio:297 / 210;')
    && okHtml.includes('style="grid-row:1 / span 1;grid-column:1 / span 1;"') && okHtml.includes('style="grid-row:1 / span 2;grid-column:2 / span 1;"'), okHtml.slice(0, 300));
  t('2 図の id は今までどおり（印刷の roomSheet_f1 を壊さない）', okHtml.includes('id="roomSheet_f1"'));

  box.PLAN.f9 = { title: '<b>x</b>', cols: ['1;" onmouseover="alert(1)'], rows: [1], ar: [1, '1"><img src=x>'],
                  cells: [{ r: '1;"><img src=x onerror=alert(1)>', c: 1, t: 'x' }] };
  box.OCC = {};
  const bad = box.roomFloorHtml('f9');
  t('2 設定に悪い値があっても、style・属性を抜けない', !hasTag(bad) && !/onmouseover="/.test(bad), bad);
  box.PLAN['f"><img src=x>'] = { title: 't', cols: [1], rows: [1], ar: [1, 1], cells: [] };
  const badKey = box.roomFloorHtml('f"><img src=x>');
  t('2 図の名前（id）に悪い値があっても抜けない', !hasTag(badKey), badKey);
}

console.log('\n— 週間計画 —');
{
  const box = {};
  vm.createContext(box);
  vm.runInContext(grabLine(CS, /function escHtml\(s\) \{\n[^\n]*\n\}/), box);
  t('4 escHtml は 5記号（& < > " \'）をすべて置き換える', box.escHtml(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;', box.escHtml(`&<>"'`));
  t('4 \' で囲んだ属性に入れても抜けない', !/' onmouseover=/.test("<a title='" + box.escHtml("' onmouseover=alert(1) '") + "'>"));
  const line = grabLine(CS, /'<div class="evlist-cat">利用者' \+ [^\n]*/);
  t('3 控えの一覧の件数は数に直す', /\(Number\(g\.res\) \|\| 0\)/.test(line) && /\(Number\(g\.ev\) \|\| 0\)/.test(line), line);
  const g = { res: EVIL, ev: '3' };
  const html = vm.runInNewContext(line.replace(/\s*\+\s*(\/\*.*\*\/)?\s*$/, '').replace(/\s*\/\*.*$/, '').replace(/\+\s*$/, ''), { g });
  t('3 端末の控えに実行される値があってもタグにならない', !hasTag(html) && html.includes('利用者0名・予定3件'), html);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
