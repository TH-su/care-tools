/* 入居者マスタ：薬効辞書の一覧（md）が、入居者の詳細のまとめ読み（fullEnsure）の後にも描き直されること（2026-11-03）
   辞書の方が先に届くと、辞書の側の描き直しは済んだ後なので、まとめ読みの後に md を描き直さないと
   表が「取得しています… 0 / N名」のまま止まっていた。印刷の紙での確かめは check/fixtures/resident-master.mjs の md。
   実行: node check/unit/master_md_redraw_test.js */
'use strict';
const fs = require('fs'), path = require('path');
const S = fs.readFileSync(path.join(__dirname, '..', '..', 'resident-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const i = S.indexOf('function fullEnsure(');
const j = S.indexOf('\nfunction ', i + 10);
const body = i >= 0 && j > i ? S.slice(i, j) : '';
t('fullEnsure がある', body.length > 0);
const tail = body.slice(body.lastIndexOf('fullLoading=false'));
t('まとめ読みの終わりで、薬効辞書の一覧（md）も描き直す', /curView==='md'/.test(tail) && /renderRoster\(\)/.test(tail), tail.slice(0, 400));
t('家族情報・病歴薬の一覧は今までどおり描き直す', /curView==='fam'/.test(tail) && /curView==='hist'/.test(tail));
t('表の中で入力している最中は描き直さない（入力の場所を動かさない）', /activeElement[\s\S]{0,80}closest\('#rosterBox'\)/.test(tail));
t('薬効辞書を開くと、まとめ読みを呼ぶ（この直しが効く前提）', /if\(curView==='md'\)\{[^}]*fullEnsure\(false\)/.test(S));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
