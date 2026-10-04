/* check/run.mjs — 直す前と直した後を撮って見比べ、CLAUDE.md §6 の言い方で結果を出す（2026-10-04 新設）
 *
 *   node check/run.mjs [--base origin/main] [--pages a.html,b.html] [--allow a.html] [--hide-report] [--skip-base]
 *
 * 流れ: ①base を一時 worktree に出して撮る → ②今の作業ツリーを撮る → ③画素で見比べる → ④JS構文 → ⑤実名ガード
 * 結果: check/out/summary.md（コミット文の「検証:」にそのまま貼れる行）
 * ・撮る前に前回の撮影（out/base・out/head・out/compare）を消す（古い PNG が混ざらないように）
 * ・撮影が失敗したらそこで失敗にする（古い結果で「画素一致」と言わない）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { parseArgs, ensureDir, readJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = process.cwd();
const base = args.base || 'origin/main';
const out = ensureDir(path.join(repoDir, 'check', 'out'));
const node = process.execPath;
const pass = [];
if (args.pages) pass.push('--pages', args.pages);
if (args['hide-report'] === 'true') pass.push('--hide-report');

function run(label, a, opts = {}) {
  console.log(`\n== ${label}`);
  const r = spawnSync(node, a, { stdio: 'inherit', cwd: repoDir, ...opts });
  return r.status == null ? 1 : r.status;
}
function fail(msg) { console.log('\n== 失敗: ' + msg); fs.writeFileSync(path.join(out, 'summary.md'), '・検証は完了していない（' + msg + '）\n'); process.exit(1); }

fs.writeFileSync(path.join(out, 'summary.md'), '・検証は完了していない（途中で止まった）\n');   // 前回の結果が残らないよう、最初に上書きする
for (const d of ['base', 'head', 'compare']) if (args['skip-base'] !== 'true' || d !== 'base') fs.rmSync(path.join(out, d), { recursive: true, force: true });

/* ① base */
if (args['skip-base'] !== 'true') {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'care-tools-base-'));
  fs.rmSync(wt, { recursive: true, force: true });
  try { execFileSync('git', ['worktree', 'add', '--detach', wt, base], { cwd: repoDir, stdio: 'inherit' }); }
  catch (e) { fail(`直す前（${base}）を取り出せない: ` + e.message); }
  let st;
  try { st = run(`直す前（${base}）を撮る`, [path.join(repoDir, 'check', 'snap.mjs'), '--dir', wt, '--out', path.join(out, 'base'), ...pass]); }
  finally { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoDir, stdio: 'inherit' }); }
  if (st !== 0) fail('直す前の撮影が失敗');
}
/* ② head */
if (run('直した後（作業ツリー）を撮る', [path.join(repoDir, 'check', 'snap.mjs'), '--dir', repoDir, '--out', path.join(out, 'head'), ...pass]) !== 0) fail('直した後の撮影が失敗');
/* ③ compare */
const cmp = ['--base', path.join(out, 'base'), '--head', path.join(out, 'head'), '--out', path.join(out, 'compare')];
if (args.allow) cmp.push('--allow', args.allow);
const cmpStatus = run('画素比較', [path.join(repoDir, 'check', 'compare.mjs'), ...cmp]);
/* ④⑤ */
const jsStatus = run('JS構文', ['--experimental-vm-modules', '--no-warnings', path.join(repoDir, 'check', 'jscheck.mjs')]);
const ngStatus = run('実名ガード', [path.join(repoDir, 'check', 'name-guard.mjs'), '--base', base]);

/* まとめ */
const c = readJson(path.join(out, 'compare', 'compare.json'), null);
if (!c) fail('画素比較の結果が無い');
const mh = readJson(path.join(out, 'head', 'metrics.json'), { pages: {} });
const overflow = Object.entries(mh.pages).map(([f, m]) => ({ f, a: m.ph100 ? m.ph100.overflowPx : 0, b: m.ph200 ? m.ph200.overflowPx : 0 })).filter((r) => r.a || r.b);
const lines = [
  ...c.lines,
  overflow.length ? `sim-check: 横はみ出しあり（${overflow.map((r) => `${r.f} 100%:${r.a}px 200%:${r.b}px`).join('、')}）` : 'sim-check: iPhone 100%／200% とも横はみ出し 0',
  jsStatus === 0 ? 'JS構文 OK' : 'JS構文 エラーあり（上の出力を見る）',
  ngStatus === 0 ? '実名ガード exit 0' : (ngStatus === 2 ? '実名ガード: 一覧なし（未実施）' : '実名ガード exit 1（上の出力を見る）'),
];
fs.writeFileSync(path.join(out, 'summary.md'), lines.map((l) => '・' + l).join('\n') + '\n');
console.log('\n== まとめ（check/out/summary.md）\n' + lines.map((l) => '・' + l).join('\n'));
process.exit(cmpStatus || jsStatus || ngStatus === 1 ? 1 : 0);
