/* 公開（.github/workflows/pages.yml）── 公開できなかった時の知らせ（2026-10-25 本人指示・代表者の決定「GitHub の Issue」）
   実行: node check/unit/pages_notify_test.js

   守ること:
     1 main の試験が落ちた時（配らずに飛ばした）と、配る仕事が失敗した時（施設情報の Secret の不備など）に、
       ラベル「公開の失敗」の Issue を立てる。担当はリポジトリの持ち主（GitHub がメールとスマホへ知らせる）
     2 知らせに、前に配った版の日時（日本時間）と版の番号を入れる。読めない時は読めなかったと書く
     3 続けて失敗した時は、開いている知らせに書き足す（Issue を増やさない）
     4 配れた時（試験した版が main の先頭で、配る仕事が成功）だけ、開いている知らせを閉じる。先頭でない版の時は閉じない
     5 知らせの仕事は配る仕事の後に必ず回り（always）、Secret を読まない
   pages.yml の「PAGES-NOTIFY-BEGIN〜END」の区間をそのまま切り出し、偽の gh と偽の date を置いて bash で動かす（写経しない）。
   PAGES_YML で別の版を当てられる（わざと壊した版で落ちるかの確認用）。版の番号・題・日時はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const YML = fs.readFileSync(process.env.PAGES_YML || path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

/* 区間を切り出し、YAML の字下げ（区間の最初の行の字下げ）を外す */
const b = YML.indexOf('# PAGES-NOTIFY-BEGIN'), e = YML.indexOf('# PAGES-NOTIFY-END');
t('pages.yml に知らせの区間がある', b > 0 && e > b);
const lineStart = YML.lastIndexOf('\n', b) + 1;
const indent = YML.slice(lineStart, b);
const SCRIPT = YML.slice(lineStart, e).split('\n').map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');

/* 偽の gh・date。呼ばれた引数を1行ずつ記録する */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-notify-'));
const BIN = path.join(TMP, 'bin');
fs.mkdirSync(BIN);
fs.writeFileSync(path.join(BIN, 'gh'), `#!/bin/bash
printf '%s\\x1f' "$@" >> "$GH_LOG"; printf '\\x1e' >> "$GH_LOG"
all="$*"
case "$1 $2" in
  "issue list") case "$all" in *"--state open"*"--label"*|*"--label"*"--state open"*) printf '%s' "$FAKE_OPEN" ;; *) printf '%s' "$FAKE_CLOSED" ;; esac ;;   # 開いている知らせだけを数える
  "label create"|"issue create"|"issue comment"|"issue close") : ;;
  "api "*)
    case "$2" in
      *"/commits/main") printf '%s' "$FAKE_HEAD" ;;
      *"/actions/workflows/pages.yml/runs"*)
        case "$all" in *'select(.id != 999)'*) printf '%s' "$FAKE_RUNS" ;; *) printf '999\\n%s' "$FAKE_RUNS" ;; esac ;;   # 自分の実行を除いているか
      *"/actions/runs/999/jobs") printf '' ;;
      *"/actions/runs/21/jobs") case "$all" in *'.name == "配る" and .conclusion == "success"'*) printf '' ;; *) printf '2026-10-24T12:00:00Z' ;; esac ;;   # 21 は配らずに飛ばした実行（「配る」が skipped）
      *"/actions/runs/22/jobs") case "$all" in *'.name == "配る" and .conclusion == "success"'*) printf '%s' "$FAKE_AT" ;; *) printf '' ;; esac ;;
      *"/actions/runs/22") printf 'abcdef1234567890' ;;
      *"/actions/runs/21") printf '9999999999999999' ;;
      *"/commits/"*) printf '架空の題（見本）' ;;
    esac ;;
esac
exit 0
`, { mode: 0o755 });
fs.writeFileSync(path.join(BIN, 'date'), `#!/bin/bash
[ "$TZ" = "Asia/Tokyo" ] || { echo "TZ-not-japan"; exit 0; }   # 日本時間を指定していなければ別の値を返す
for a in "$@"; do [ "$a" = "-d" ] && { echo "2026-10-20 09:15"; exit 0; }; done
echo "2026-10-25 19:30"
`, { mode: 0o755 });

function run(env) {
  const log = path.join(TMP, 'gh.log'), sum = path.join(TMP, 'summary.md');
  fs.writeFileSync(log, ''); fs.writeFileSync(sum, '');
  const base = { PATH: BIN + ':' + process.env.PATH, GH_LOG: log, GITHUB_STEP_SUMMARY: sum,
    R: 'example/care-tools', OWNER: 'example-owner', SHA: '1234567890abcdef', RUN_URL: 'https://example.invalid/run/1',
    TEST_URL: 'https://example.invalid/test/9', FAKE_OPEN: '', FAKE_CLOSED: '77', FAKE_RUNS: '21\n22', FAKE_AT: '2026-10-20T00:15:00Z',
    FAKE_HEAD: '1234567890abcdef', GITHUB_RUN_ID: '999',
    TEST_RESULT: 'success', DEPLOY_RESULT: 'success', DEPLOY_GO: '1' };
  const r = spawnSync('bash', ['-eo', 'pipefail', '-c', SCRIPT], { env: Object.assign({}, base, env), encoding: 'utf8' });
  const calls = fs.readFileSync(log, 'utf8').split('\x1e').filter(Boolean).map((l) => l.split('\x1f').filter((x, i, a) => i < a.length - 1 || x));
  return { code: r.status, out: r.stdout + r.stderr, calls, summary: fs.readFileSync(sum, 'utf8') };
}
const find = (calls, a, b2) => calls.filter((c) => c[0] === a && c[1] === b2);
const argOf = (c, flag) => { const i = c.indexOf(flag); return i >= 0 ? c[i + 1] : undefined; };

console.log('\n— 試験が落ちた時 —');
{
  const r = run({ TEST_RESULT: 'failure', DEPLOY_RESULT: 'skipped', DEPLOY_GO: '' });
  const cr = find(r.calls, 'issue', 'create');
  const body = cr[0] ? argOf(cr[0], '--body') : '';
  t('★知らせの Issue を1つ立てる', r.code === 0 && cr.length === 1, r.calls);
  t('★題は「公開の失敗：試験の失敗（版 1234567）」', cr[0] && argOf(cr[0], '--title') === '公開の失敗：試験の失敗（版 1234567）', cr[0]);
  t('★ラベル「公開の失敗」・担当はリポジトリの持ち主', cr[0] && argOf(cr[0], '--label') === '公開の失敗' && argOf(cr[0], '--assignee') === 'example-owner', cr[0]);
  t('★前に配った版の日時（日本時間）と版の番号が入る（「配る」が成功した実行のうち新しいもの＝配らずに飛ばした実行と自分の実行は数えない）', /前に配った版: 2026-10-20 09:15（日本時間・版 abcdef1）/.test(body), body);
  t('今も前の版が公開され続けていると書く', /今もこの版が公開され続けています/.test(body));
  t('失敗した版の番号と題・実行の記録・試験の記録が入る', /失敗した版: 1234567 架空の題（見本）/.test(body) && body.includes('https://example.invalid/run/1') && body.includes('https://example.invalid/test/9'), body);
  t('本文の行の頭に YAML の字下げが残らない', !/^ {2,}- /m.test(body), body);
  t('ラベルが無くても作ってから立てる（label create --force）', find(r.calls, 'label', 'create').length === 1);
  t('実行の要約にも同じ知らせを書く', /公開できませんでした/.test(r.summary));
}

console.log('\n— 配る仕事が失敗した時（施設情報の Secret の不備など）—');
{
  const r = run({ DEPLOY_RESULT: 'failure', DEPLOY_GO: '1' });
  const cr = find(r.calls, 'issue', 'create');
  t('★知らせの Issue を立てる（種類は配信の失敗）', cr.length === 1 && /^公開の失敗：配信の失敗（版 1234567）$/.test(argOf(cr[0], '--title')), cr[0]);
  t('本文に Secret の名前を挙げて原因の見当を書く（Secret の中身は書かない）', /FACILITY_PROFILE_JSON/.test(argOf(cr[0], '--body')));
  t('試験の記録は付けない（試験は通っている）', !argOf(cr[0], '--body').includes('試験の記録'));
}

console.log('\n— 続けて失敗した時 —');
{
  const r = run({ TEST_RESULT: 'failure', DEPLOY_RESULT: 'skipped', FAKE_OPEN: '5' });
  t('★開いている知らせ（#5）に書き足し、Issue を増やさない', find(r.calls, 'issue', 'create').length === 0 && find(r.calls, 'issue', 'comment').length === 1 && find(r.calls, 'issue', 'comment')[0][2] === '5', r.calls);
  t('閉じない', find(r.calls, 'issue', 'close').length === 0);
}

console.log('\n— 配れた時 —');
{
  const r = run({ FAKE_OPEN: '5' });
  t('★開いている知らせ（#5）に「配れました」と書いて閉じる', find(r.calls, 'issue', 'comment').length === 1 && /配れました（版 1234567・2026-10-25 19:30）/.test(argOf(find(r.calls, 'issue', 'comment')[0], '--body')) && find(r.calls, 'issue', 'close').length === 1, r.calls);
  t('新しい知らせは立てない', find(r.calls, 'issue', 'create').length === 0);
  const r2 = run({});
  t('開いている知らせが無ければ何もしない', find(r2.calls, 'issue', 'create').length + find(r2.calls, 'issue', 'comment').length + find(r2.calls, 'issue', 'close').length === 0, r2.calls);
  const r3 = run({ FAKE_OPEN: '5', DEPLOY_GO: '0' });
  t('★試験した版が main の先頭でない（配っていない）時は閉じない', find(r3.calls, 'issue', 'close').length === 0 && find(r3.calls, 'issue', 'create').length === 0, r3.calls);
  const r4 = run({ FAKE_OPEN: '5', TEST_RESULT: 'cancelled', DEPLOY_RESULT: 'skipped', DEPLOY_GO: '' });
  t('試験が中止された時は知らせも閉じもしない', find(r4.calls, 'issue', 'close').length + find(r4.calls, 'issue', 'create').length === 0, r4.calls);
}

console.log('\n— 試験の終わり方・古い版 —');
{
  for (const c of ['timed_out', 'startup_failure', 'action_required']) {
    const r = run({ TEST_RESULT: c, DEPLOY_RESULT: 'skipped', DEPLOY_GO: '' });
    t('★試験が ' + c + ' で終わっても知らせる', find(r.calls, 'issue', 'create').length === 1 && new RegExp(c).test(argOf(find(r.calls, 'issue', 'create')[0], '--body')), r.calls);
  }
  const rc = run({ DEPLOY_RESULT: 'cancelled', DEPLOY_GO: '1' });
  t('★配る仕事が時間切れなどで止まった（cancelled）時も知らせる', find(rc.calls, 'issue', 'create').length === 1 && /配信の失敗/.test(argOf(find(rc.calls, 'issue', 'create')[0], '--title')), rc.calls);
  const ro = run({ TEST_RESULT: 'failure', DEPLOY_RESULT: 'skipped', FAKE_HEAD: 'ffffffffffffffff', FAKE_OPEN: '' });
  t('★落ちた版が今の main の先頭でなければ知らせない（後の版の実行が知らせる・もう配られている）', find(ro.calls, 'issue', 'create').length + find(ro.calls, 'issue', 'comment').length === 0, ro.calls);
  const rm = run({ TEST_RESULT: 'manual', DEPLOY_RESULT: 'failure', FAKE_HEAD: 'ffffffffffffffff' });
  t('手動の配信の失敗は、先頭かどうかに関係なく知らせる', find(rm.calls, 'issue', 'create').length === 1, rm.calls);
  const rcl = run({ TEST_RESULT: 'failure', DEPLOY_RESULT: 'skipped', FAKE_OPEN: '', FAKE_CLOSED: '77' });
  t('閉じた知らせには書き足さず、新しく立てる', find(rcl.calls, 'issue', 'comment').length === 0 && find(rcl.calls, 'issue', 'create').length === 1, rcl.calls);
}

console.log('\n— 前に配った版が読めない時 —');
{
  const r = run({ TEST_RESULT: 'failure', DEPLOY_RESULT: 'skipped', FAKE_RUNS: '' });
  const body = argOf(find(r.calls, 'issue', 'create')[0] || [], '--body') || '';
  t('★読めなかったと書く（空や前の値を書かない）', /前に配った版: （読めませんでした/.test(body), body);
}

console.log('\n— 仕事の組み立て（pages.yml）—');
{
  const nj = YML.slice(YML.indexOf('\n  notify:'));
  t('★知らせの仕事は配る仕事の後に必ず回る（needs: deploy・always()）', /needs: deploy/.test(nj) && /always\(\)/.test(nj));
  t('知らせの仕事は main への送信の試験か手動の配信の時だけ（PR の試験では回らない）', /github\.event\.workflow_run\.event == 'push'/.test(nj) && /head_branch == 'main'/.test(nj) && /workflow_dispatch/.test(nj));
  t('★知らせの仕事の権限は issues: write と actions: read と contents: read だけ（pages・id-token を持たない）', /issues: write/.test(nj) && /actions: read/.test(nj) && !/pages: write|id-token/.test(nj));
  t('★知らせの仕事は Secret を読まない', !/secrets\./.test(nj));
  t('配る仕事は「main の先頭か」の答え（go）を知らせの仕事へ渡す', /outputs:\s*\n\s*go: \$\{\{ steps\.head\.outputs\.go \}\}/.test(YML));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 片付けに失敗しても結果は変えない */ }
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
