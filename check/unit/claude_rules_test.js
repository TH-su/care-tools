/* claude_rules_test.js — 画面ごとの決まり（.claude/rules/*.md）の置き場の試験（2026-11-21・CLAUDE.md §3 を分けた時に新設）
   実行: node check/unit/claude_rules_test.js
   守ること:
     1. .claude/rules/*.md はどれも先頭に `paths:` の付いた frontmatter があり、書いた形（"..." の並び）が崩れていない
        （崩れると paths の無いルールとして毎回読まれ、CLAUDE.md を分けた意味が無くなる）
     2. paths のどのグロブも、公開されているファイルに1つ以上当たる（名前を変えた画面を取りこぼさない）
     3. CLAUDE.md §3 の索引と .claude/rules/*.md が1対1（索引に無いファイル・ファイルの無い索引を作らない）
     4. .claude/rules/*.md は .gitignore で公開に入る（足し忘れるとクラウドのセッションに届かない）
     5. 横断の決まりと禁止事項を CLAUDE.md に残している（外部の AI へ送らない・端末に残してよい物）
     6. .gitignore は決まりのファイルを1つずつ名前で公開し、*.md でまとめて開けない
   見るのは .gitignore が公開に入れるファイルだけ。テーマの手元には公開しない内部の決まり（データの約束事・個人情報の扱い）が
   同じフォルダにあり、それを数えると手元でだけ落ちる（2026-11-22 朝の点検の赤）。手元だけにあるファイルに頼らない。
   ただし .gitignore が外すファイルでも、公開の決まりの形（frontmatter が paths: と "..." の並びだけ）なら落とす
   （新しい決まりを .gitignore にも索引にも足し忘れた時に気づくため。内部の決まりは description: を持つので当たらない）。
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

/* Claude のグロブ: / を含まない形はどの階層のファイル名にも当たる・/ を含む形はルートからの道（頭の / はルートの直下だけ）。** と * と ? だけを使う */
function globRe(p) {
  if (p.startsWith('/')) p = p.slice(1);
  const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(p.includes('/') ? '^' + body + '$' : '(^|/)' + body + '$');
}

const tracked = cp.execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const allMd = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort() : [];
/* .gitignore が外すファイル（手元だけの内部の決まり）は見ない。git の管理下のファイルは外さない */
function ignoredSet(files) {
  if (!files.length) return new Set();
  try {
    const out = cp.execFileSync('git', ['check-ignore', '-z', '--stdin'], { cwd: ROOT, encoding: 'utf8', input: files.map((f) => '.claude/rules/' + f).join('\0'), stdio: ['pipe', 'pipe', 'pipe'] });
    return new Set(out.split('\0').filter(Boolean).map((p) => p.replace(/^\.claude\/rules\//, '')));
  } catch (e) {
    if (e.status === 1) return new Set(); /* 1 = どれも外れていない */
    throw e;
  }
}
const ignored = ignoredSet(allMd);
const rules = allMd.filter((f) => !ignored.has(f));
function publicShape(f) {
  const L = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  const end = L.indexOf('---', 1);
  const fm = end > 0 ? L.slice(1, end) : [];
  return L[0] === '---' && end > 1 && fm[0] === 'paths:' && fm.length > 1 && fm.slice(1).every((l) => /^  - "[^"\s]+"$/.test(l));
}
const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

console.log('画面ごとの決まりの置き場');
t('0 .claude/rules に決まりのファイルがある', rules.length > 0, rules);
const hiddenPublic = [...ignored].filter(publicShape);
t('4 公開の決まりの形なのに .gitignore で外れているファイルが無い（.gitignore に !/.claude/rules/<名前>.md の足し忘れ）', hiddenPublic.length === 0, hiddenPublic);

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
  /* 本文に名前の出るファイルが paths に当たる（書き足した画面の取りこぼしを止める）。このサイトの外の画面と「乗らない」と書いた部品だけ除く */
  const NOT_HERE = new Set(['medication.html', 'su-auth.js']);
  const body = L.slice(end + 1).join('\n');
  const named = [...new Set(body.match(/[A-Za-z0-9_./-]+\.(?:html|js|mjs|cjs|css|json|swift)\b/g) || [])].filter((n) => !NOT_HERE.has(n));
  const uncovered = named.filter((n) => {
    const hit = tracked.filter((p) => p === n || p.endsWith('/' + n));
    return hit.length === 0 || !hit.some((p) => globs.some((g) => globRe(g).test(p)));
  });
  t(`2 ${f}: 本文に名前の出るファイルがどれも paths に当たる`, uncovered.length === 0, uncovered);
  t(`3 ${f}: CLAUDE.md の索引にある`, claude.includes('- `.claude/rules/' + f + '` … '));
}
const listed = [...claude.matchAll(/^- `\.claude\/rules\/([^`]+)` … /gm)].map((m) => m[1]);
const orphan = listed.filter((f) => !rules.includes(f));
t('3 索引のファイルがどれもある', listed.length === rules.length && orphan.length === 0, orphan);

t('5 外部の AI へ送らない決まり（薬の変更候補・担当者会議の振り分け・印の無い議事録・ほかの形の表）は CLAUDE.md に残す',
  /「薬の変更候補」は、外部の AI へ処方を送らない/.test(claude) && /NotebookLM が「◆欄名：」の印つきで出した議事録/.test(claude) &&
  /^- 担当者会議の記録の議事録に「◆欄名：」の印が1つも無い時は/m.test(claude) && /^- 過去の担当者会議をほかの形の表/m.test(claude));
t('5 複数の画面に効く決まり（未送信の一覧・アレルゲンと禁食の一字一句）は CLAUDE.md に残す',
  /^- 未送信の一覧（`unsent\.html`）は/m.test(claude) && /新しい種類の送信待ちは作らない/.test(claude) && /アレルゲン・禁食の選択肢と符号一覧は一字一句そろえる/.test(claude));
for (const f of rules) {
  const b = fs.readFileSync(path.join(DIR, f), 'utf8');
  t(`5 ${f}: 外部の AI へ送らない決まりを含む行を移していない`, !/外部の AI へ(は)?(処方を)?送らない/.test(b));
}
t('5 勤怠管理・給与の「端末に残してよい物」は CLAUDE.md に残す',
  /^  - 端末に残してよい物: 打刻の画面は/m.test(claude) && /^  - 端末に残してよい物は開いていたタブ（payroll_tab）だけ/m.test(claude));
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n');
const wild = gi.filter((l) => /^!\/?\.claude\/rules\/.*\*/.test(l.trim()));
t('6 .gitignore は決まりのファイルを *.md でまとめて公開しない', wild.length === 0, wild);
const named = gi.map((l) => (l.trim().match(/^!\/\.claude\/rules\/([^/*]+\.md)$/) || [])[1]).filter(Boolean).sort();
t('6 .gitignore で名前を挙げた決まりと公開の決まりが1対1', JSON.stringify(named) === JSON.stringify([...rules].sort()), { named, rules });
t('5 §2 の絶対に守ることは CLAUDE.md に残す', /^## 2\. 絶対に守ること/m.test(claude) && /^5\. \*\*現場端末では読まない・書かない。\*\*/m.test(claude));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
