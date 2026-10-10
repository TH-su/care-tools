/* CI（.github/workflows）が実名ガードを呼ぶ所は、必ず「見つけた語を出さない」指定（SU_NAME_GUARD_QUIET=1）を付けることの試験（2026-10-10）。
   公開リポジトリの Actions のログは誰でも読めるので、実名が混ざった PR が来た時に、ガードがその語をログへ書くと名前が残る。
   守りたいこと:
     A 実名ガード（check/name-guard.mjs）か、それを呼ぶ check/run.mjs を動かす手順には、同じ手順かジョブ・ワークフローの env に SU_NAME_GUARD_QUIET: '1' がある
     B その指定で、name-guard.mjs が本当に語を出さない（指定が無ければ出る＝この試験が見分けている）
   実行: node check/unit/workflow_nameguard_quiet_test.js
   架空の語だけを使う。 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const QUIET = /SU_NAME_GUARD_QUIET:\s*['"]1['"]/;
const CALLS = /check\/name-guard\.mjs|check\/run\.mjs/;

console.log('\n— A. ワークフローの指定 —');
const files = fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f)).sort();
t('ワークフローが読める', files.length > 0, files);
let calls = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(WF, f), 'utf8');
  const head = src.slice(0, Math.max(0, src.indexOf('steps:')));   /* ワークフロー・ジョブの env（steps より前） */
  const steps = src.split(/\n(?=\s*- (?:name|uses|run):)/);
  steps.forEach(st => {
    if (!CALLS.test(st)) return;
    calls++;
    const name = (/- name:\s*(.+)/.exec(st) || [, '（名前なし）'])[1].trim();
    t('★' + f + '「' + name + '」は実名ガードの語を出さない指定つき', QUIET.test(st) || QUIET.test(head));
  });
}
t('実名ガードを呼ぶ手順が少なくとも2つ（試験の CI と画面の見比べ）見つかる', calls >= 2, calls);

console.log('\n— B. 指定で本当に語が出ない —');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-quiet-'));
  try {
    const word = '架空';   /* 試験のファイルにだけ出てくる架空の語 */
    const list = path.join(dir, 'names.txt');
    fs.writeFileSync(list, word + '\n');
    const run = quiet => cp.spawnSync(process.execPath, [path.join(ROOT, 'check', 'name-guard.mjs'), '--all'],
      { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { SU_NAME_GUARD_FILE: list, SU_NAME_GUARD_QUIET: quiet ? '1' : '' }) });
    const loud = run(false), hush = run(true);
    t('（対照）指定が無いと、見つけた語をそのまま出す', loud.status === 1 && (loud.stdout || '').includes('「' + word + '」'), loud.status);
    t('★指定があると、見つけた場所は出すが語は出さない', hush.status === 1 && !(hush.stdout || '').includes(word) && /一覧の語が含まれる/.test(hush.stdout || ''), hush.status);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
