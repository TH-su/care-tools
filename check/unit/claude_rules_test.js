/* claude_rules_test.js — 画面ごとの決まり（.claude/rules/*.md）の置き場の試験（2026-11-21・CLAUDE.md §3 を分けた時に新設）
   実行: node check/unit/claude_rules_test.js
   守ること:
     1. .claude/rules/*.md はどれも先頭に `paths:` の付いた frontmatter があり、書いた形（"..." の並び）が崩れていない
        （崩れると paths の無いルールとして毎回読まれ、CLAUDE.md を分けた意味が無くなる）
     2. paths のどのグロブも、公開されているファイルに1つ以上当たる（名前を変えた画面を取りこぼさない）
     3. CLAUDE.md §3 の索引と .claude/rules/*.md が1対1（索引に無いファイル・ファイルの無い索引を作らない）
     4. .claude/rules/*.md は .gitignore で公開に入る（足し忘れるとクラウドのセッションに届かない）
     5. 横断の決まりと禁止事項を CLAUDE.md に残している（外部の AI へ送らない・端末に残してよい物）
   ファイルは書き換えず、読むだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, '.claude', 'rules');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

/* Claude のグロブ: / を含まない形はどの階層のファイル名にも当たる・/ を含む形はルートからの道。** と * と ? だけを使う */
function globRe(p) {
  const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(p.includes('/') ? '^' + body + '$' : '(^|/)' + body + '$');
}

const tracked = cp.execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const rules = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort() : [];
const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

console.log('画面ごとの決まりの置き場');
t('0 .claude/rules に決まりのファイルがある', rules.length > 0, rules);

for (const f of rules) {
  const L = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  const end = L.indexOf('---', 1);
  const fm = end > 0 ? L.slice(1, end) : [];
  const shapeOk = L[0] === '---' && end > 1 && fm[0] === 'paths:' && fm.length > 1 && fm.slice(1).every((l) => /^  - "[^"\s]+"$/.test(l));
  t(`1 ${f}: 先頭に paths: の frontmatter（"..." の並び）`, shapeOk, fm);
  const globs = fm.slice(1).map((l) => (l.match(/"([^"]+)"/) || [])[1]).filter(Boolean);
  const none = globs.filter((g) => !tracked.some((p) => globRe(g).test(p)));
  t(`2 ${f}: paths のグロブがどれも公開のファイルに当たる`, globs.length > 0 && none.length === 0, none);
  t(`4 ${f}: 公開に入っている（git の管理下）`, tracked.includes('.claude/rules/' + f));
  t(`3 ${f}: CLAUDE.md の索引にある`, claude.includes('- `.claude/rules/' + f + '` … '));
}
const listed = [...claude.matchAll(/^- `\.claude\/rules\/([^`]+)` … /gm)].map((m) => m[1]);
const orphan = listed.filter((f) => !rules.includes(f));
t('3 索引のファイルがどれもある', listed.length === rules.length && orphan.length === 0, orphan);

t('5 外部の AI へ送らない決まり（薬の変更候補・担当者会議の振り分け）は CLAUDE.md に残す',
  /「薬の変更候補」は、外部の AI へ処方を送らない/.test(claude) && /NotebookLM が「◆欄名：」の印つきで出した議事録/.test(claude));
t('5 勤怠管理・給与の「端末に残してよい物」は CLAUDE.md に残す',
  /^  - 端末に残してよい物: 打刻の画面は/m.test(claude) && /^  - 端末に残してよい物は開いていたタブ（payroll_tab）だけ/m.test(claude));
t('5 §2 の絶対に守ることは CLAUDE.md に残す', /^## 2\. 絶対に守ること/m.test(claude) && /^5\. \*\*現場端末では読まない・書かない。\*\*/m.test(claude));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
