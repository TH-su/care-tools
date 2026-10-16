/* 写しの見比べ（shadow-check.js）の勤務表まわりの純粋な部分の試験（2026-10-16 新設）。
   守りたいこと:
     A 作りかけの案の点検: drafts:YYYY-MM の一覧から案の本体のキー（sched:YYYY-MM:draft:<id>）を正しく並べる
       （形の違う id・一覧でない中身は数えない・重複は1つ）。案ごとの見比べの判定（一致・写しに無い・Google に無い・
       写しの版が古い／新しい・版は同じで中身が違う）
   ★画面の本物の関数を切り出して動かす（DOM・通信には触れない）。
   実行: node check/unit/shadow_check_shift_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 文字列・コメント・正規表現の中のかっこを数えない切り出し（sukv_routed_test.js と同じ） */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grab(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('見つかりません: ' + header.trim());
  const end = scanBlock(src, start);
  if (end < 0) throw new Error('終わりが見つかりません: ' + header.trim());
  return src.slice(start, end + 1);
}
function line(src, re) { const m = src.match(re); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }

const SRC = read('shadow-check.js');
const box = { JSON, Object, Array, Number, String };
vm.createContext(box);
vm.runInContext([
  line(SRC, /var DRAFTS_RE = .*;/),
  line(SRC, /var DRAFT_ID_RE = .*;/),
  // canon は2つ宣言されていて後の方（文字列を返す方）が効いている＝後の方を切り出す
  grab(SRC, 'function canon(v) {\n    if (v === null'),
  grab(SRC, 'function sameData('),
  grab(SRC, 'function draftKeysOf('),
  grab(SRC, 'function draftCompare(')
].join('\n'), box, { filename: 'shadow-check.js（切り出し）' });

console.log('\n— A. 作りかけの案の点検 —');
{
  const keys = box.draftKeysOf({
    'drafts:2026-10': [{ id: 'dabc1' }, { id: 'dxyz2', label: '案2' }, { id: 'dabc1' }, { id: '../x' }, { id: '' }, null, { label: 'id なし' }, { id: 12345 }],
    'drafts:2026-11': [{ id: 'd_q.r-s' }],
    'drafts:2026-12': { id: 'not-array' },
    'drafts:26-10': [{ id: 'dbad' }],
    'sched:2026-10:plan': [{ id: 'dplan' }]
  });
  t('★案の本体のキーを並べる（重複は1つ・数の id も文字にする・並びは決まった順）',
    JSON.stringify(keys) === JSON.stringify(['sched:2026-10:draft:12345', 'sched:2026-10:draft:dabc1', 'sched:2026-10:draft:dxyz2', 'sched:2026-11:draft:d_q.r-s']), keys);
  t('★形の違う id（../x・空・id 無し）・一覧でない中身・drafts:YYYY-MM でないキーは数えない',
    !keys.some(k => /\.\.\/|draft:$|dbad|dplan|not-array/.test(k)), keys);
  t('一覧が空・無しなら何も並べない', JSON.stringify(box.draftKeysOf({})) === '[]' && JSON.stringify(box.draftKeysOf(null)) === '[]');
  t('並べたキーはデータベースの勤務表の種類（0007 の kv_family）に収まる',
    keys.every(k => /^sched:\d{4}-\d{2}:[A-Za-z0-9_.:-]{1,80}$/.test(k)), keys);

  const C = box.draftCompare;
  const d1 = { cells: { a: { 1: 'A' } }, meta: { x: 1, y: 2 } }, d1r = { meta: { y: 2, x: 1 }, cells: { a: { 1: 'A' } } }, d2 = { cells: { a: { 1: 'B' } } };
  t('★版も中身も同じ（キーの並びは問わない）→ 一致', C({ rev: 3, data: d1 }, { rev: 3, data: d1r }) === 'same');
  t('★写しに無い → missing（写せる）', C({ rev: 3, data: d1 }, null) === 'missing' && C({ rev: 3, data: d1 }, { rev: 0, data: null }) === 'missing');
  t('Google に無い → gasonly', C(null, { rev: 2, data: d1 }) === 'gasonly');
  t('★写しの版が古い → older（写せる）', C({ rev: 5, data: d1 }, { rev: 3, data: d1 }) === 'older');
  t('写しの版が新しい → newer', C({ rev: 3, data: d1 }, { rev: 5, data: d1 }) === 'newer');
  t('★版は同じで中身が違う → content（写せる）', C({ rev: 3, data: d1 }, { rev: 3, data: d2 }) === 'content');
  t('どちらにも無い → 一致（数えない）', C(null, null) === 'same' && C({ rev: 0, data: null }, { rev: 0 }) === 'same');
  t('版が数でない値は 0（無い）として扱う', C({ rev: 'x', data: d1 }, { rev: 3, data: d1 }) === 'gasonly');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
