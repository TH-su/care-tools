/* 実名ガード（check/name-guard.mjs）が、Mac の道具の本体 .swift と起動用 .command・.sh も見ることの試験（2026-10-22）
   公開リポジトリに Swift の道具（yakujo-reader/）と .command を置いたため。直す前の版はこの3種を見ずに exit 0 を返していた（反証レビューの指摘）。
   実行: node check/unit/name_guard_filetypes_test.js（環境変数 NAME_GUARD で別の版を当てられる）
   架空の語だけを使う。使い捨てのリポジトリは git の外の一時フォルダに作る（上のリポジトリへ git がたどらないように）。 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const GUARD = process.env.NAME_GUARD || path.join(__dirname, '..', 'name-guard.mjs');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ng-types-')));
const env = Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: tmp, SU_NAME_GUARD_QUIET: '', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });
const repo = path.join(tmp, 'r');
const git = a => cp.execFileSync('git', a, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  fs.mkdirSync(repo);
  git(['init', '-q']);
  if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== fs.realpathSync(repo)) throw new Error('使い捨てのリポジトリを作れなかった');
  const WORD = '架空見本語';
  const list = path.join(tmp, 'names.txt');
  fs.writeFileSync(list, WORD + '\n');
  fs.mkdirSync(path.join(repo, 'tool'));
  const files = ['tool/a.swift', 'tool/b.command', 'tool/c.sh', 'tool/d.md'];
  files.forEach(f => fs.writeFileSync(path.join(repo, f), '// 何もない\n'));
  git(['add', '-A']); git(['commit', '-q', '-m', 'base']);
  const run = (args) => cp.spawnSync(process.execPath, [GUARD, '--dir', repo].concat(args), { encoding: 'utf8', env: Object.assign({}, env, { SU_NAME_GUARD_FILE: list }) });

  console.log('\n— 差分（追加行）を見る —');
  files.forEach(f => fs.appendFileSync(path.join(repo, f), 'let x = "' + WORD + '"\n'));
  const r1 = run(['--base', 'HEAD']);
  t('（対照）.md の追加行は見つける', r1.status === 1 && r1.stdout.includes('tool/d.md'), r1.stdout);
  t('★.swift の追加行を見つける', r1.stdout.includes('tool/a.swift'), r1.stdout);
  t('★.command の追加行を見つける', r1.stdout.includes('tool/b.command'), r1.stdout);
  t('★.sh の追加行を見つける', r1.stdout.includes('tool/c.sh'), r1.stdout);

  console.log('\n— まだ追跡していない新しいファイルを見る —');
  git(['checkout', '-q', '--', '.']);
  fs.writeFileSync(path.join(repo, 'tool/new.swift'), 'let y = "' + WORD + '"\n');
  fs.writeFileSync(path.join(repo, 'tool/new.command'), 'echo "' + WORD + '"\n');
  const r2 = run(['--base', 'HEAD']);
  t('★新しい .swift・.command も見つける', r2.status === 1 && r2.stdout.includes('tool/new.swift') && r2.stdout.includes('tool/new.command'), r2.stdout);

  console.log('\n— --all（全ファイル）—');
  git(['add', '-A']); git(['commit', '-q', '-m', 'x']);
  const r3 = run(['--all']);
  t('★--all でも .swift・.command を見る', r3.status === 1 && r3.stdout.includes('tool/new.swift') && r3.stdout.includes('tool/new.command'), r3.stdout);

  console.log('\n— 語が無ければ通す —');
  fs.writeFileSync(path.join(repo, 'tool/new.swift'), 'let y = 1\n');
  fs.writeFileSync(path.join(repo, 'tool/new.command'), 'echo 1\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'clean']);
  const r4 = run(['--all']);
  t('語の無いリポジトリは exit 0', r4.status === 0, r4.stdout);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
