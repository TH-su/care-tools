/* シフト作成（shift-app.html）── 職員 ID の純関数（src/logic/ids.js）を公開中の1枚から切り出して確かめる（2026-10-14 新設・代表者の依頼）
   実行: node check/unit/shift_ids_test.js

   守ること:
     1 作る ID は 's'＋英小文字と数字。決まった形（英数字・_・-）に入り、2000件でほぼ重ならない
     2 決まった形の判定（引用符・空白・日本語・] ・空・文字列以外は外れ）
     3 形の違う ID の件数（id の無い行・空の行・null は数えない）
     4 cssAttr: 普通の値は1文字も変えない。" と \ と改行・改ページだけを CSS の書き方で書き換える
   ★shift-app.html はシフト作成のプロジェクトで組み立てた公開版。正本の試験（tests/staff-ids.test.js）とは別に、
     公開された1枚の中身をここで毎回確かめる（組み立てで抜けた・古い版が載った、を拾う）。
   ★氏名は使わない（架空の値だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.SHIFT_HTML || path.join(ROOT, 'shift-app.html'), 'utf8');

/* 組み立ての区切り「/* ===== src/logic/<名前> ===== *\/」から、次の行頭の区切りの手前までを切り出す */
function section(html, file) {
  const head = '/* ===== ' + file + ' ===== */';
  const s = html.indexOf(head);
  if (s < 0) throw new Error('shift-app.html に ' + file + ' がありません');
  const e = html.indexOf('\n/* ===== src/', s + head.length);   /* 区切りは行頭の「/* ===== src/…」だけ（中身のコメントの ===== で切らない） */
  return html.slice(s, e < 0 ? html.indexOf('</script>', s) : e);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

const box = { window: {}, Math, Date, String, Object, RegExp };
vm.createContext(box);
vm.runInContext(section(HTML, 'src/logic/ids.js'), box, { filename: 'shift-app.html(ids.js)' });
const IDS = box.window.ShiftIds;

console.log('\n— 0. 切り出せる —');
t('shift-app.html の ids.js を切り出して動かすと window.ShiftIds が出る', !!IDS && typeof IDS.newStaffId === 'function');
if (!IDS) { console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + (fail + 1) + ' 件失敗 ──────────'); process.exit(1); }
t('ids.js は画面の部品（grid.js・app.js）より前に組み込まれている',
  HTML.indexOf('/* ===== src/logic/ids.js ===== */') < HTML.indexOf('/* ===== src/ui/grid.js ===== */') &&
  HTML.indexOf('/* ===== src/logic/ids.js ===== */') < HTML.indexOf('/* ===== src/ui/app.js ===== */'));

console.log('\n— 1. 作る ID —');
{
  const seen = new Set(); let bad = null;
  for (let i = 0; i < 2000; i++) {
    const id = IDS.newStaffId();
    if (!/^s[0-9a-z]{9,}$/.test(id) || !IDS.isValidStaffId(id)) { bad = id; break; }
    seen.add(id);
  }
  t('形は s＋英小文字と数字・決まった形に入る', bad === null, bad);
  t('2000件でほぼ重ならない', seen.size >= 1990, seen.size);
}

console.log('\n— 2. 決まった形の判定 —');
{
  const oks = ['s1', 'smxyz1234abcd', 'A-b_9', 'x'.repeat(64), 'x'.repeat(65)];
  const ngs = ['', 'a"b', 'a b', '職員甲', 'a]b', "a'b", 'a\nb', 12, null, undefined, {}];
  t('英数字・_・- だけの ID は通す（長さの上限は付けない）', oks.every(v => IDS.isValidStaffId(v) === true), oks.filter(v => !IDS.isValidStaffId(v)));
  t('引用符・空白・日本語・] ・改行・空・文字列以外は外す', ngs.every(v => IDS.isValidStaffId(v) === false), ngs.filter(v => IDS.isValidStaffId(v)).map(String));
}

console.log('\n— 3. 形の違う ID の件数 —');
t('id の無い行・空の行・null は数えず、形の違う ID だけを数える',
  IDS.countInvalidStaffIds([{ id: 's1' }, { id: 'a"b' }, { id: '職員甲' }, { name: '見本' }, null, { id: '' }, 'x']) === 2);
t('配列でなければ 0', IDS.countInvalidStaffIds(null) === 0 && IDS.countInvalidStaffIds({ length: 3 }) === 0 && IDS.countInvalidStaffIds([]) === 0);

console.log('\n— 4. cssAttr —');
t('普通の値は1文字も変えない', ['smxyz1234abcd', '訪問', '通所', '12', 'draft:d1', 'A-b_9'].every(v => IDS.cssAttr(v) === v));
t('" と \\ を書き換える', IDS.cssAttr('a"b') === 'a\\"b' && IDS.cssAttr('a\\b') === 'a\\\\b', [IDS.cssAttr('a"b'), IDS.cssAttr('a\\b')]);
t('改行（\\n・\\r\\n・\\r）と改ページを CSS の改行の書き方にする',
  IDS.cssAttr('a\nb') === 'a\\a b' && IDS.cssAttr('a\r\nb') === 'a\\a b' && IDS.cssAttr('a\rb') === 'a\\a b' && IDS.cssAttr('a\fb') === 'a\\c b');
t('数値は文字にし、null・undefined は空', IDS.cssAttr(7) === '7' && IDS.cssAttr(null) === '' && IDS.cssAttr(undefined) === '');
t('書き換えた値は、引用符の中で属性の照合を壊さない（" で閉じない）', !/(^|[^\\])"/.test(IDS.cssAttr('x"] , [data-x="y')));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
