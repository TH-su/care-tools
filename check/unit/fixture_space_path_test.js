/* 試験の部品が、空白の入ったフォルダ（例「Local Sites」）でも自分のファイルを読めることの試験（2026-11-24）
   check/fixtures/payroll.mjs が new URL(…).pathname を require に渡していたため、空白が %20 のまま残り
   「Cannot find module '…/Local%20Sites/…'」で payroll_page_test.js が手元だけ落ちた（CI は空白の無い場所なので通っていた）。
   ファイルの場所は fileURLToPath で作る。この試験は check/ の中に同じ書き方が戻っていないかを見る。
   実行: node check/unit/fixture_space_path_test.js */
'use strict';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const CHECK = path.join(__dirname, '..');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js|cjs)$/.test(e.name) && p !== __filename) files.push(p);
  }
})(CHECK);

// ファイルを読む関数に URL の .pathname をそのまま渡す書き方（空白・日本語のフォルダで壊れる）
const BAD = /\b(require|readFileSync|readFile|existsSync|statSync|readdirSync|import)\s*\(\s*new\s+(?:globalThis\.)?URL\([^;]*?\)\.pathname/;
const hits = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (BAD.test(l)) hits.push(path.relative(CHECK, f) + ':' + (i + 1)); });
}
t('check/ の中に「URL の .pathname をファイルの場所に使う」書き方が無い（fileURLToPath を使う）', hits.length === 0, hits);
t('見つける式が元の書き方を見つける', BAD.test("const PC = require(new globalThis.URL('payroll-calc.js', ROOT).pathname);"));
t('見つける式が直した書き方は見つけない', !BAD.test("const PC = require(fileURLToPath(new globalThis.URL('payroll-calc.js', ROOT)));"));

// 実際に空白入りの場所でも部品が読み込めるか（直した fixtures/payroll.mjs を読み込む）
import(require('url').pathToFileURL(path.join(CHECK, 'fixtures', 'payroll.mjs')).href)
  .then(m => t('fixtures/payroll.mjs を読み込める（' + (/\s/.test(CHECK) ? '空白の入った場所' : '空白の無い場所') + '）', !!m && typeof m.URL === 'string'))
  .catch(e => t('fixtures/payroll.mjs を読み込める', false, String(e && e.message)))
  .finally(() => {
    console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
    process.exit(fail ? 1 : 0);
  });
