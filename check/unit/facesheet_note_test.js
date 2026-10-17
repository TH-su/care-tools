/* フェイスシート（facesheet.html）の「黙ると困る失敗」を記録に残すことの試験（2026-10-12・監査10月版 v2 フェイスシート 第1手）。
   守ること:
     1. fsNoteAs_(kind, where, e) は su-errors の note へ kind・例外・'facesheet:'+where を渡す（画面には出さない）。su-errors が無くても例外を出さない
     2. 端末の用途の切り替え（storage・pageshow の受け口と読み込み直し）・印刷の準備（食形態一覧と誕生日表の1枚収め）・
        デイ利用日の取得の呼び出しは、失敗を空の catch で黙らせず記録する
     3. 本当に失敗した時に記録される（受け口の中で例外が出た時・読み込み直しが失敗した時）
     4. 空の catch は、業務に響かないものだけ（数の上限で見張る）
   実行: node check/unit/facesheet_note_test.js（FACESHEET_HTML で別の facesheet.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.FACESHEET_HTML || path.join(__dirname, '..', '..', 'facesheet.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cutLine(re) { const m = src.match(re); if (!m) throw new Error('見つかりません: ' + re); return m[0]; }
const FN = cutLine(/function fsNoteAs_\(kind, where, e\)\{[^\n]*\}/);

console.log('\n— 1. 記録の口 —');
{
  const got = [];
  const box = { window: { SUErrors: { note: (k, m, w) => got.push([k, String(m && m.message || m), w]) } } };
  vm.createContext(box); vm.runInContext(FN, box);
  box.fsNoteAs_('印刷の準備', '誕生日表の用紙フィット', new Error('x'));
  t('★kind・例外・facesheet:場所 を note へ渡す', JSON.stringify(got[0]) === JSON.stringify(['印刷の準備', 'x', 'facesheet:誕生日表の用紙フィット']), got);
  const box2 = { window: {} }; vm.createContext(box2); vm.runInContext(FN, box2);
  let threw = null; try { box2.fsNoteAs_('端末の用途', 'x', new Error('y')); } catch (e) { threw = String(e); }
  t('su-errors が無い古い画面でも例外を出さない', threw === null, threw);
  const box3 = { window: { SUErrors: { note: () => { throw new Error('note が壊れた'); } } } }; vm.createContext(box3); vm.runInContext(FN, box3);
  threw = null; try { box3.fsNoteAs_('端末の用途', 'x', new Error('y')); } catch (e) { threw = String(e); }
  t('記録そのものが失敗しても例外を外へ出さない', threw === null, threw);
}

console.log('\n— 2. 黙らせずに記録する場所 —');
const want = [
  ['storage の受け口（別のタブでの切り替え）', /window\.addEventListener\('storage',function\(e\)\{ try\{ onDeviceRoleChange_\(e\); \}catch\(err\)\{ fsNoteAs_\('端末の用途', '[^']+', err\); \} \}\);/],
  ['pageshow の受け口（戻るで復元した時）', /window\.addEventListener\('pageshow',function\(e\)\{ try\{ if\(e&&e\.persisted\) onDeviceRoleChange_\(\{key:DEVICE_KEY\}\); \}catch\(err\)\{ fsNoteAs_\('端末の用途', '[^']+', err\); \} \}\);/],
  ['読み込み直し（fsReload_）', /function fsReload_\(\)\{ try\{ location\.reload\(\); \}catch\(e\)\{ fsNoteAs_\('端末の用途', '[^']+', e\); \} \}/],
  ['食形態一覧の1枚収め', /try\{ fitMealSheet\(\); \}catch\(e\)\{ fsNoteAs_\('印刷の準備', '[^']+', e\); \}/],
  ['誕生日表の1枚収め（ボタン）', /try\{ if\(bdayViewActive_\(\)\) fitBdaySheet\(\); \}catch\(e\)\{ fsNoteAs_\('印刷の準備', '[^']+', e\); \}/],
  ['誕生日表の1枚収め（Cmd/Ctrl+P）', /\n  try\{ fitBdaySheet\(\); \}catch\(e\)\{ fsNoteAs_\('印刷の準備', '[^']+', e\); \}/],
  ['デイ利用日の取得の呼び出し', /a4EnsureDayMap\(\)\.then\(function\(\)\{ patchDayUse\(r\); \}\)\.catch\(function\(\)\{\}\);\n  \}catch\(e\)\{ fsNoteAs_\('デイ利用日', '[^']+', e\); \}/]
];
for (const [label, re] of want) t('★' + label, re.test(src));

console.log('\n— 3. 本当に失敗した時に記録される —');
{
  const got = [], listeners = {};
  const box = {
    DEVICE_KEY: 'su_device_role',
    window: { SUErrors: { note: (k, m, w) => got.push([k, w]) }, addEventListener: (ty, fn) => { listeners[ty] = fn; } },
    onDeviceRoleChange_: () => { throw new Error('切り替えに失敗'); },
    location: { reload: () => { throw new Error('reload できない'); } }
  };
  vm.createContext(box);
  vm.runInContext([FN, cutLine(/function fsReload_\(\)\{[^\n]*\}/), cutLine(/window\.addEventListener\('storage',function\(e\)\{ try\{ onDeviceRoleChange_[^\n]*/),
    cutLine(/window\.addEventListener\('pageshow',[^\n]*onDeviceRoleChange_[^\n]*/)].join('\n'), box);
  let threw = null;
  try { listeners.storage({ key: 'su_device_role' }); listeners.pageshow({ persisted: true }); box.fsReload_(); } catch (e) { threw = String(e); }
  t('★受け口・読み込み直しの失敗は外へ出さない（画面を止めない）', threw === null, threw);
  t('★3つとも「端末の用途」として記録される', got.length === 3 && got.every(g => g[0] === '端末の用途' && /^facesheet:/.test(g[1])), got);
}

console.log('\n— 4. 空の catch の数 —');
const empties = (src.match(/catch *(\([a-z_]*\))? *\{ *\}/g) || []).length;
/* 2026-10-17: 動作の速さの記録（SUPerf.ready）の1か所を足した。計測だけで業務に響かない */
t('空の catch は 19 か所以下（業務に響かないもの17＋動作の速さの記録の1＋記録の口の中の1）', empties <= 19, empties);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
