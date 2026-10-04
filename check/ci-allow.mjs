/* check/ci-allow.mjs — PR の自動チェックで「変えてよい画面」を決める（2026-10-04 新設・代表者の決定）
 *
 *   node check/ci-allow.mjs --base origin/main     （GitHub Actions の中で使う。手元でも同じ結果が出る）
 *
 * 決め方:
 *   ① この PR で中身を変えた画面（リポジトリ直下の .html）は自動で「変えてよい」
 *   ② PR 本文に「画素の違いを許す: a.html, b.html」と書いた画面も「変えてよい」（意図して他の画面も変わる時）
 *   共通部品（su-*.js）だけを変えた時は、①に当たる画面が無い＝全画面が画素一致でなければならない
 *
 * PR 本文は誰でも書ける入力なので、名前の形（英数字・. _ -・.html で終わる）に合い、実在する画面だけを拾う。
 * 結果は GITHUB_OUTPUT に allow=<カンマ区切り> で書く（シェルに入れても安全な文字だけ）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, listPages } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = process.cwd();
const base = args.base || 'origin/main';
const pages = new Set(listPages(repoDir));
const SAFE = /^[A-Za-z0-9_.-]+\.html$/;

// ① この PR で変えた画面（base と分かれた所からの差分）
let changed = [];
try {
  changed = execFileSync('git', ['-c', 'core.quotepath=off', 'diff', '--name-only', `${base}...HEAD`], { cwd: repoDir, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((f) => SAFE.test(f) && pages.has(f));
} catch (e) { console.log('差分を取れませんでした: ' + e.message); }

// ② PR 本文の「画素の違いを許す: …」
let fromBody = [];
try {
  const ev = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const body = String((ev && ev.pull_request && ev.pull_request.body) || '');
  for (const m of body.matchAll(/^\s*画素の違いを許す\s*[:：]\s*(.+)$/gm)) {
    for (const w of m[1].split(/[\s,、，]+/)) { const f = w.replace(/^`|`$/g, ''); if (SAFE.test(f) && pages.has(f)) fromBody.push(f); }
  }
} catch (e) { console.log('PR 本文を読めませんでした: ' + e.message); }

const allow = [...new Set([...changed, ...fromBody])].sort();
console.log('この PR で変えた画面: ' + (changed.length ? changed.join(', ') : 'なし'));
console.log('PR 本文で許した画面: ' + (fromBody.length ? [...new Set(fromBody)].join(', ') : 'なし'));
console.log('変えてよい画面: ' + (allow.length ? allow.join(', ') : 'なし（全画面が画素一致であること）'));
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `allow=${allow.join(',')}\nchanged=${changed.join(',')}\nbody=${[...new Set(fromBody)].join(',')}\n`);
}
