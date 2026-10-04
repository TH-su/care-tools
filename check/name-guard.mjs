/* check/name-guard.mjs — 「実名ガード」: 実在の氏名が配布物に混ざっていないかを確かめる（2026-10-04 新設）
 *
 *   node check/name-guard.mjs [--dir .] [--base origin/main] [--all]
 *
 * 一覧（実名の表）はリポジトリに置かない（公開リポジトリのため）。次の順で探す:
 *   1. 環境変数 SU_NAME_GUARD_FILE のファイル（1行1語。氏名・姓だけ・通称など）
 *   2. check/.names.local（.gitignore で除外済み）
 * 一覧が無い時は【未実施】（終了コード 2）。「exit 0」とは言わない。当て推量（○○様・○○さん）だけ警告する。
 *
 * 見る範囲: 既定は base との差分（追加行）＋まだ追跡していない新しいファイル。--all で公開ホワイトリストの全ファイル。
 * 終了コード: 一覧の語が見つかれば 1。一覧が無ければ 2。見つからなければ 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args.dir || '.');
const base = args.base || 'origin/main';

let names = [];
const listFile = process.env.SU_NAME_GUARD_FILE || path.join(repoDir, 'check', '.names.local');
if (fs.existsSync(listFile)) names = fs.readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));

function git(a) { return execFileSync('git', a, { cwd: repoDir, encoding: 'utf8', maxBuffer: 1 << 28 }); }
const ALLOW_FILE = /\.(html|js|mjs|json|md|css|gs|txt)$/;

function wholeFile(f, rows) {
  const full = path.join(repoDir, f);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return;
  fs.readFileSync(full, 'utf8').split('\n').forEach((t, i) => rows.push({ file: f, line: i + 1, text: t }));
}

/* 見る行を集める: [{file, line, text}] */
let rows = [];
if (args.all === 'true') {
  for (const f of git(['ls-files']).split('\n').filter((f) => ALLOW_FILE.test(f))) wholeFile(f, rows);
} else {
  let diff = '';
  try { diff = git(['diff', '--unified=0', base, '--']); } catch (e) { diff = git(['diff', '--unified=0', 'HEAD', '--']); }
  let file = '', line = 0;
  for (const t of diff.split('\n')) {
    if (t.startsWith('+++ ')) { file = t.slice(6); continue; }
    const h = t.match(/^@@ -\d+(?:,\d+)? \+(\d+)/); if (h) { line = Number(h[1]); continue; }
    if (t.startsWith('+') && !t.startsWith('+++')) { if (ALLOW_FILE.test(file)) rows.push({ file, line, text: t.slice(1) }); line++; }
  }
  // まだ追跡していない新しいファイル（git diff には出ない）も全文を見る
  for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter((f) => ALLOW_FILE.test(f))) wholeFile(f, rows);
}

const hits = [], warns = [];
const guess = /([一-龥々]{1,2}[ 　]?[一-龥々]{1,3})(様|さん)/g;
for (const r of rows) {
  for (const n of names) if (n && r.text.includes(n)) hits.push(`${r.file}:${r.line} 「${n}」`);
  if (!names.length) { let m; while ((m = guess.exec(r.text))) warns.push(`${r.file}:${r.line} 「${m[0]}」（当て推量）`); }
}
if (hits.length) { console.log(hits.join('\n')); console.log(`実名ガード exit 1（${hits.length}件）`); process.exit(1); }
if (!names.length) {
  console.log(`実名ガード: 一覧なし（未実施・${rows.length}行）${warns.length ? '\n' + warns.slice(0, 30).join('\n') : ''}`);
  process.exit(2);
}
console.log(`実名ガード exit 0（${rows.length}行を確認・一覧 ${names.length}語）`);
