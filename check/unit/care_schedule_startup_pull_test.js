/* 週間計画（care-schedule.html）：起動の時にクラウドへ取りに行くのを、決まった時間待たせない（2026-11-01 新設・品質改善 第2期 便1 item 2）
   実行: node check/unit/care_schedule_startup_pull_test.js

   なぜ作るか:
     起動の最後に「同期先があれば 300ms 待ってから startupPull」としていた。待つ理由になる処理は無く、
     新しい端末（端末の控えが無い）では名簿が出るまで・いつもの端末では最新の予定に揃うまで、毎回 300ms 遅れていた
     （架空38名・CPU 4倍で、開いてから名簿がそろうまで約600ms のうち約300ms がこの待ち）。

   何を守るか（起動の部分だけを HTML から切り出し、通信と時計を偽物にして動かす）:
     1. 同期先がある事務所PCでは、取りに行く予約は1回だけで、待ち時間は 0（決まった時間を待たない）
     2. 起動の処理の途中（同じ流れの中）では取りに行かない＝予約を回した時に初めて startupPull が呼ばれる
     3. 取り終えた後に、備考のクリア → 本人指定の選び直し → 定期の見回り の順で動く（今までどおり）
     4. 現場の端末・同期先の無い端末では取りに行かない（今までどおり）
   ★公開リポジトリの check/unit にある。氏名・施設名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

/* 文字列とコメントの中のかっこを数えないスキャナ（care_schedule_test.js と同じ考え方） */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}

/* 起動の「取りに行く」部分（if … else … の両方）を切り出す */
const HEAD = "if (SYNC.hasTarget() && suGetDeviceRole() !== 'field') {";
const at = SRC.indexOf(HEAD);
assert.ok(at >= 0, '起動の取りに行く部分が見つからない');
assert.strictEqual(SRC.indexOf(HEAD, at + 1), -1, '起動の取りに行く部分が2か所ある');
const end1 = scanBlock(SRC, at, '{', '}');
assert.ok(end1 > at, 'if の終わりが見つからない');
const rest = SRC.slice(end1 + 1);
const m = /^\s*else\s*/.exec(rest);
assert.ok(m, 'else が見つからない');
const elseAt = end1 + 1 + m[0].length;
const end2 = scanBlock(SRC, elseAt, '{', '}');
assert.ok(end2 > elseAt, 'else の終わりが見つからない');
const CODE = SRC.slice(at, end2 + 1);

function run({ hasTarget, role }) {
  const calls = [];
  const timers = [];
  let pullResolve;
  const SYNC = {
    _pushTimer: null,
    hasTarget: () => hasTarget,
    startupPull: () => { calls.push('startupPull'); return new Promise((r) => { pullResolve = r; }); },
    startPolling: () => calls.push('startPolling'),
    updateStatusUI: (s) => calls.push('status:' + s),
    push: () => calls.push('push'),
  };
  const ctx = {
    SYNC,
    suGetDeviceRole: () => role,
    migrateClearNotes_: () => { calls.push('migrateClearNotes_'); return false; },
    csApplyMasterIdParam: () => calls.push('csApplyMasterIdParam'),
    csNote_: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms: ms === undefined ? 0 : ms }); return timers.length; },
    clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { calls, timers, resolvePull: (v) => pullResolve && pullResolve(v) };
}

let pass = 0;
const t = (name, fn) => fn().then(() => { pass++; process.stdout.write('ok ' + name + '\n'); });

(async () => {
  await t('同期先がある事務所PC: 予約は1回・待ち時間は 0', async () => {
    const r = run({ hasTarget: true, role: 'office' });
    assert.strictEqual(r.timers.length, 1, '取りに行く予約は1回');
    assert.strictEqual(r.timers[0].ms, 0, '決まった時間を待たない（待ち時間 ' + r.timers[0].ms + 'ms）');
  });

  await t('起動の流れの中では取りに行かず、予約を回すと取りに行く', async () => {
    const r = run({ hasTarget: true, role: 'office' });
    assert.deepStrictEqual(r.calls.filter((c) => c === 'startupPull'), [], '同じ流れの中で取りに行っている');
    r.timers[0].fn();
    assert.deepStrictEqual(r.calls, ['startupPull']);
  });

  await t('取り終えた後: 備考のクリア → 本人指定の選び直し → 定期の見回り', async () => {
    const r = run({ hasTarget: true, role: 'office' });
    r.timers[0].fn();
    r.resolvePull(true);
    await new Promise((res) => setImmediate(res));
    assert.deepStrictEqual(r.calls, ['startupPull', 'migrateClearNotes_', 'csApplyMasterIdParam', 'startPolling']);
  });

  await t('現場の端末: 取りに行かない', async () => {
    const r = run({ hasTarget: true, role: 'field' });
    assert.strictEqual(r.timers.length, 0);
    assert.ok(!r.calls.includes('startupPull'));
    assert.deepStrictEqual(r.calls, ['status:同期', 'migrateClearNotes_']);
  });

  await t('同期先の無い端末: 取りに行かない', async () => {
    const r = run({ hasTarget: false, role: 'office' });
    assert.strictEqual(r.timers.length, 0);
    assert.deepStrictEqual(r.calls, ['migrateClearNotes_']);
  });

  process.stdout.write(`care_schedule_startup_pull: ${pass} 件成功\n`);
})().catch((e) => { process.stderr.write('失敗: ' + (e && e.message || e) + '\n'); process.exit(1); });
