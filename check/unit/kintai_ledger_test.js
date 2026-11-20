/* 年次有給休暇管理簿の行（kintai-ledger.js）の試験（2026-11-20 新設・総点検）
   実行: node check/unit/kintai_ledger_test.js
   守りたいこと:
     1. 基準日（付与日）ごとに、次の付与日の前日までに取った日・日数を並べる（半日も）
     2. 期間の終わり（今日より先なら今日）の残りは kintai-leave.js の balance と同じ
     3. 今日より後の使用は「予定」に分け、取った日数に入れない
     4. 移行の残りは先頭の基準日・移行日より前の使用は数えない
     5. 取り消した使用・壊れた入力は数えない／例外を出さない
   ★職員は架空。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'kintai-leave.js'));
const G = require(path.join(ROOT, 'kintai-ledger.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const U = (d, n, extra) => Object.assign({ staff_id: 'sT01', use_date: d, days: n }, extra || {});

console.log('\n— 1〜3. 基準日ごとの取った日・残り・予定 —');
{
  const asOf = '2026-11-20';
  const uses = [U('2025-11-10', 1), U('2025-12-01', 0.5), U('2026-05-01', 1), U('2026-10-20', 1), U('2026-11-25', 1), U('2026-12-10', 0.5, { voided_at: '2026-11-01' })];
  const sm = L.summary({ hireDate: '2024-04-01', profile: {}, grants: [], uses, asOf });
  const g = G.ledgerOf({ lots: sm.lots, uses, asOf, openingDate: null });
  const b = g.rows.map((r) => r.base).join();
  t('基準日は自動の付与日（2024-10-01・2025-10-01・2026-10-01）', b === '2024-10-01,2025-10-01,2026-10-01', b);
  const r25 = g.rows[1];
  t('2025-10-01 の年: 付与11日・期間は 2026-09-30 まで・取った日は3つ（半日を含む）・2.5日', r25.days === 11 && r25.until === '2026-09-30' && r25.taken.map((u) => u.date).join() === '2025-11-10,2025-12-01,2026-05-01' && r25.takenDays === 2.5, r25);
  t('期間の終わりの残りは balance と同じ', r25.remain === L.balance(sm.lots, uses, '2026-09-30', {}).remain, [r25.remain, L.balance(sm.lots, uses, '2026-09-30', {}).remain]);
  const r26 = g.rows[2];
  t('今の年（2026-10-01〜）: 取った日は 10/20 の1日・11/25 は予定・取り消した使用は出さない', r26.taken.length === 1 && r26.taken[0].date === '2026-10-20' && r26.planned.length === 1 && r26.planned[0].date === '2026-11-25' && r26.takenDays === 1, r26);
  t('今の年の残りは今日の時点の balance と同じ（＝有給タブの「残り」）', r26.remain === sm.balance.remain, [r26.remain, sm.balance.remain]);
  t('取った日数の合計は今日までの使用の合計（1＋0.5＋1＋1）', g.takenTotal === 3.5, g.takenTotal);
}

console.log('\n— 4. 移行の残り —');
{
  const asOf = '2026-11-20';
  const grants = [{ id: 'g1', staff_id: 'sT01', grant_date: '2026-04-01', days: 8.5, kind: 'opening' }];
  const uses = [U('2026-03-20', 1), U('2026-06-01', 1)];
  const sm = L.summary({ hireDate: '2015-04-01', profile: { opening_date: '2026-04-01' }, grants, uses, asOf });
  const g = G.ledgerOf({ lots: sm.lots, uses, asOf, openingDate: '2026-04-01' });
  t('移行の残りは先頭の基準日（2026-04-01・8.5日）', g.rows[0].base === '2026-04-01' && g.rows[0].kind === 'opening' && g.rows[0].days === 8.5, g.rows[0]);
  t('移行日より前の使用（3/20）は数えない', g.rows.every((r) => r.taken.every((u) => u.date >= '2026-04-01')), g.rows);
  t('残りは有給タブと同じ', g.rows[g.rows.length - 1].remain === sm.balance.remain, [g.rows.map((r) => r.remain), sm.balance.remain]);
}

console.log('\n— 5. 壊れた入力 —');
{
  t('今日が無い・付与が無い時は空', G.ledgerOf({ lots: [], uses: [], asOf: '2026-11-20' }).rows.length === 0 && G.ledgerOf({}).rows.length === 0 && G.ledgerOf(null).rows.length === 0);
  t('壊れた使用（日付・日数）は数えない', G.ledgerOf({ lots: [{ grant_date: '2026-01-01', days: 10, kind: 'auto' }], uses: [U('2026-13-01', 1), U('2026-02-01', 0), U('2026-02-02', 'x')], asOf: '2026-11-20' }).rows[0].takenDays === 0);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 合格 / ' + fail + ' 不合格');
process.exit(fail ? 1 : 0);
