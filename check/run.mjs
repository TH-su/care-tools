/* check/run.mjs — 直す前と直した後を撮って見比べ、CLAUDE.md §6 の言い方で結果を出す（2026-10-04 新設）
 *
 *   node check/run.mjs [--base origin/main] [--pages a.html,b.html] [--allow a.html] [--hide-report] [--skip-base]
 *
 * 流れ: ①base を一時 worktree に出して撮る → ②今の作業ツリーを撮る → ③画素で見比べる → ④JS構文 → ⑤実名ガード
 * 結果: check/out/summary.md（コミット文の「検証:」にそのまま貼れる行）
 * ・撮る前に前回の撮影（out/base・out/head・out/compare）を消す（古い PNG が混ざらないように）
 * ・撮影が失敗したらそこで失敗にする（古い結果で「画素一致」と言わない）
 * ・揺れの確かめ: 1回目の比較で違いが出た画面だけ、直す前・後とも 5 回ずつ撮り直し、多数派の絵で比べ直す
 *   （画面全体を撮る時、入力欄の文字の描き方がまれに入れ替わるため）。--recheck 0 で撮り直さない
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

/* ① base を一時 worktree に出す（揺れの確かめで撮り直すため、比べ終わるまで残す） */
let wt = null;
function dropWorktree() { if (wt) { try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoDir, stdio: 'inherit' }); } catch (e) { /* 残っても次の起動で別名を使う */ } wt = null; } }
const snapJs = path.join(repoDir, 'check', 'snap.mjs');
const cmpJs = path.join(repoDir, 'check', 'compare.mjs');
const cmp = ['--base', path.join(out, 'base'), '--head', path.join(out, 'head'), '--out', path.join(out, 'compare')];
if (args.allow) cmp.push('--allow', args.allow);
let cmpStatus = 1, recheckNote = '';
try {
  if (args['skip-base'] !== 'true') {
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'care-tools-base-'));
    fs.rmSync(wt, { recursive: true, force: true });
    try { execFileSync('git', ['worktree', 'add', '--detach', wt, base], { cwd: repoDir, stdio: 'inherit' }); }
    catch (e) { wt = null; fail(`直す前（${base}）を取り出せない: ` + e.message); }
    if (run(`直す前（${base}）を撮る`, [snapJs, '--dir', wt, '--out', path.join(out, 'base'), ...pass]) !== 0) { dropWorktree(); fail('直す前の撮影が失敗'); }
  }
  /* ② head */
  if (run('直した後（作業ツリー）を撮る', [snapJs, '--dir', repoDir, '--out', path.join(out, 'head'), ...pass]) !== 0) { dropWorktree(); fail('直した後の撮影が失敗'); }
  /* ③ compare */
  cmpStatus = run('画素比較', [cmpJs, ...cmp]);
  /* ③' 揺れの確かめ: 違いの出た画面だけ 5 回ずつ撮り直して比べ直す */
  const first = readJson(path.join(out, 'compare', 'compare.json'), null);
  const diffPages = first ? [...new Set(first.results.filter((r) => r.status === '違いあり' || r.status === '大きさが違う').map((r) => r.name + '.html'))] : [];
  if (diffPages.length && args.recheck !== '0' && wt) {
    const N = '5';
    const hide = args['hide-report'] === 'true' ? ['--hide-report'] : [];
    const a = run(`揺れの確かめ: 直す前を撮り直す（${diffPages.join('、')}・${N}回ずつ）`, [snapJs, '--dir', wt, '--out', path.join(out, 'base'), '--pages', diffPages.join(','), '--repeat', N, '--merge', ...hide]);
    const b = run(`揺れの確かめ: 直した後を撮り直す（${diffPages.join('、')}・${N}回ずつ）`, [snapJs, '--dir', repoDir, '--out', path.join(out, 'head'), '--pages', diffPages.join(','), '--repeat', N, '--merge', ...hide]);
    if (a !== 0 || b !== 0) { dropWorktree(); fail('揺れの確かめの撮影が失敗'); }
    fs.rmSync(path.join(out, 'compare'), { recursive: true, force: true });
    cmpStatus = run('画素比較（撮り直した後）', [cmpJs, ...cmp]);
    recheckNote = `揺れの確かめ: 1回目に違いが出た ${diffPages.length}画面（${diffPages.join('、')}）を直す前・後とも${N}回ずつ撮り直し、多数派の絵で比べた`;
  }
} finally { dropWorktree(); }
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
  ...(recheckNote ? [recheckNote] : []),
  overflow.length ? `sim-check: 横はみ出しあり（${overflow.map((r) => `${r.f} 100%:${r.a}px 200%:${r.b}px`).join('、')}）` : 'sim-check: iPhone 100%／200% とも横はみ出し 0',
  jsStatus === 0 ? 'JS構文 OK' : 'JS構文 エラーあり（上の出力を見る）',
  ngStatus === 0 ? '実名ガード exit 0' : (ngStatus === 2 ? '実名ガード: 一覧なし（未実施）' : '実名ガード exit 1（上の出力を見る）'),
];
fs.writeFileSync(path.join(out, 'summary.md'), lines.map((l) => '・' + l).join('\n') + '\n');
console.log('\n== まとめ（check/out/summary.md）\n' + lines.map((l) => '・' + l).join('\n'));
process.exit(cmpStatus || jsStatus || ngStatus === 1 ? 1 : 0);
