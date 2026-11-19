/* 勤怠管理の有給（kintai-leave.js）の純関数の試験（2026-11-20 新設・凍結した仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v4-master-leave.md の L1〜L8）
   実行: node check/unit/kintai_leave_test.js（環境変数 KINTAI_LEAVE で別の版を当てられる）
   守りたいこと:
     1. 付与の表（6か月で10日・以後1年ごと 11・12・14・16・18・20日・6年6か月以降20日）
     2. 比例付与（週4/3/2/1日・週30時間未満の時だけ。片方が空・30時間以上・週5日は通常の付与）
     3. 入職の6か月後は同じ日（無い日は月末）。付与日は毎回入職日から数える（月末に丸めた日を次の起点にしない）
     4. 期限は付与日から2年（2年後の前日まで使える）・FIFO（使用の日に使える古い付与から）・半日・使える付与の無い使用
     5. 年5日の色（届いた・黄・期限まで60日以内の赤・10日未満や移行の残りは対象外）
     6. 移行日（opening_date より前の自動の付与は数えない）・付与しない日（skip_grants）
     7. シフトの有休と手入力が同じ日にあれば手入力を正にし、二重に数えない（computeMonth の結果から作る）
     8. 端末の時刻帯で日がずれない（別の時刻帯の node で同じ答え）
   ★職員は架空（試験 甲・試験 乙）。 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const LV = process.env.KINTAI_LEAVE || path.join(ROOT, 'kintai-leave.js');
const L = require(LV);
const C = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const dates = (list) => list.map((g) => g.grant_date).join(',');
const daysOf = (list) => list.map((g) => g.days).join(',');

console.log('\n— 1. 付与の表 —');
{
  const g = L.autoGrants('2019-04-01', null, '2027-12-31');
  t('入職 2019/4/1 → 2019/10/1 から1年ごと', dates(g) === '2019-10-01,2020-10-01,2021-10-01,2022-10-01,2023-10-01,2024-10-01,2025-10-01,2026-10-01,2027-10-01', dates(g));
  t('日数 10・11・12・14・16・18・20・以後20', daysOf(g) === '10,11,12,14,16,18,20,20,20', daysOf(g));
  t('期限は付与日の2年後の前日', g[0].expires === '2021-09-30' && g[6].expires === '2027-09-30', [g[0].expires, g[6].expires]);
  t('6か月より前は付与なし', L.autoGrants('2026-06-01', null, '2026-11-30').length === 0);
  t('入職日が無い・壊れている時は付与なし（回り続けない）', L.autoGrants(null, null, '2026-11-30').length === 0 && L.autoGrants('2026-02-30', null, '2026-11-30').length === 0);
  const ng = L.nextGrant('2019-04-01', null, '2026-11-20');
  t('次の付与（今日より後の最初）', ng && ng.grant_date === '2027-10-01' && ng.days === 20, ng);
  t('付与日の当日は「次」に入れない', L.nextGrant('2019-04-01', null, '2026-10-01').grant_date === '2027-10-01');
}

console.log('\n— 2. 比例付与 —');
{
  const row = (wd, wh) => daysOf(L.autoGrants('2019-04-01', { weekly_days: wd, weekly_hours: wh }, '2027-12-31'));
  t('週4日・20時間 → 7,8,9,10,12,13,15（以後15）', row(4, 20) === '7,8,9,10,12,13,15,15,15', row(4, 20));
  t('週3日 → 5,6,6,8,9,10,11', row(3, 18) === '5,6,6,8,9,10,11,11,11', row(3, 18));
  t('週2日 → 3,4,4,5,6,6,7', row(2, 10) === '3,4,4,5,6,6,7,7,7', row(2, 10));
  t('週1日 → 1,2,2,2,3,3,3', row(1, 4) === '1,2,2,2,3,3,3,3,3', row(1, 4));
  t('週の所定時間が空 → 通常の付与（そろった時だけ比例）', row(4, null) === '10,11,12,14,16,18,20,20,20', row(4, null));
  t('週の所定日数が空 → 通常の付与', row(null, 20) === '10,11,12,14,16,18,20,20,20');
  t('週4日でも30時間以上 → 通常の付与', row(4, 30) === '10,11,12,14,16,18,20,20,20', row(4, 30));
  t('週5日・20時間 → 通常の付与', row(5, 20) === '10,11,12,14,16,18,20,20,20');
  t('文字の数（DB の numeric）でも同じ', row('3', '18.0') === '5,6,6,8,9,10,11,11,11');
  t('比例付与の印', L.autoGrants('2019-04-01', { weekly_days: 2, weekly_hours: 10 }, '2020-01-01')[0].proportional === true && L.summary({ hireDate: '2019-04-01', profile: { weekly_days: 2, weekly_hours: 10 }, asOf: '2026-01-01' }).proportional === true);
}

console.log('\n— 3. 入職の6か月後の月末の扱い —');
{
  t('入職 8/31 → 2/28（平年）', L.autoGrants('2025-08-31', null, '2026-12-31')[0].grant_date === '2026-02-28');
  const g = L.autoGrants('2025-08-31', null, '2030-12-31');
  t('次の年も入職日から数える（2/28 を起点にしない）・閏年は 2/29', dates(g) === '2026-02-28,2027-02-28,2028-02-29,2029-02-28,2030-02-28', dates(g));
  t('入職 3/31 → 9/30・次も 9/30', dates(L.autoGrants('2026-03-31', null, '2027-12-31')) === '2026-09-30,2027-09-30');
  t('入職 8/29 → 閏年の 2/29、翌年は 2/28', dates(L.autoGrants('2023-08-29', null, '2025-12-31')) === '2024-02-29,2025-02-28');
  t('入職 4/1 → 10/1（同じ日）', L.autoGrants('2026-04-01', null, '2026-12-31')[0].grant_date === '2026-10-01');
  t('閏日の付与の期限は2年後の2月末の前日', L.expiresOf('2024-02-29') === '2026-02-27');
}

console.log('\n— 4. 期限2年・FIFO・半日 —');
{
  const G = [{ grant_date: '2024-10-01', days: 10, kind: 'auto' }, { grant_date: '2025-10-01', days: 11, kind: 'auto' }];
  const b1 = L.balance(G, [{ use_date: '2025-11-10', days: 1 }, { use_date: '2025-11-11', days: 1 }, { use_date: '2025-11-12', days: 1 }], '2025-12-01');
  t('FIFO: 古い付与（2024/10/1）から減る', b1.lots[0].used === 3 && b1.lots[1].used === 0 && b1.remain === 18, b1.lots);
  t('期限の近い分: 2024/10/1 の残り7日（2026/9/30 まで）', b1.soon && b1.soon.days === 7 && b1.soon.expires === '2026-09-30', b1.soon);
  const b2 = L.balance(G, [], '2026-09-30');
  t('期限の当日（2年後の前日）まではまだ使える', b2.remain === 21 && b2.lots[0].state === 'valid');
  const b3 = L.balance(G, [], '2026-10-01');
  t('期限の翌日に古い付与は消える', b3.remain === 11 && b3.lots[0].state === 'expired', b3.remain);
  const b4 = L.balance(G, [{ use_date: '2026-10-05', days: 2 }], '2026-11-01');
  t('期限が切れた後の使用は新しい付与から（切れた付与を食わない）', b4.lots[0].used === 0 && b4.lots[1].used === 2 && b4.remain === 9, b4.lots);
  const b5 = L.balance(G, [{ use_date: '2025-09-20', days: 1 }], '2025-12-01');
  t('付与日より前の使用は、その時に使えた付与からだけ', b5.lots[0].used === 1 && b5.lots[1].used === 0);
  const b6 = L.balance(G, [{ use_date: '2025-11-10', days: 0.5 }, { use_date: '2025-11-11', days: 0.5 }, { use_date: '2025-11-12', days: 0.5 }], '2025-12-01');
  t('半日3回で1.5日・残り19.5日', b6.used === 1.5 && b6.remain === 19.5 && b6.lots[0].remain === 8.5, [b6.used, b6.remain]);
  const b7 = L.balance([{ grant_date: '2025-10-01', days: 1, kind: 'auto' }], [{ use_date: '2025-11-01', days: 1 }, { use_date: '2025-11-02', days: 0.5 }, { use_date: '2024-01-01', days: 1 }], '2025-12-01');
  t('使える付与の無い使用は「付与の無い使用」に数え、残りを負にしない', b7.over === 1.5 && b7.remain === 0, b7);
  const b8 = L.balance(G, [{ use_date: '2025-11-10', days: 1 }, { use_date: '2026-01-10', days: 1, voided_at: '2026-01-01T00:00:00Z' }, { use_date: '2026-02-01', days: 1 }], '2025-12-01');
  t('取り消した使用は数えない・この先の使用は予定に分ける', b8.used === 1 && b8.planned === 1 && b8.remain === 20, b8);
  const b9 = L.balance([{ grant_date: '2025-10-01', days: 5, kind: 'opening' }, { grant_date: '2025-10-01', days: 11, kind: 'auto' }], [{ use_date: '2025-10-02', days: 6 }], '2025-10-03');
  t('同じ付与日なら移行の残りから先に減らす', b9.lots[0].kind === 'opening' && b9.lots[0].used === 5 && b9.lots[1].used === 1);
}

console.log('\n— 5. 年5日の取得義務 —');
{
  const G = [{ grant_date: '2025-10-01', days: 10, kind: 'auto' }];
  const u2 = [{ use_date: '2025-12-01', days: 1 }, { use_date: '2026-01-05', days: 1 }];
  const y = L.obligation5(G, u2, '2026-05-01');
  t('2日・期限まで60日より前 → 黄（あと3日・2026/9/30 まで）', y.state === 'yellow' && y.used === 2 && y.need === 3 && y.end === '2026-09-30', y);
  const r = L.obligation5(G, u2, '2026-08-01');
  t('2日・期限まで60日 → 赤', r.state === 'red' && r.daysLeft === 60, r);
  t('期限まで61日 → 黄', L.obligation5(G, u2, '2026-07-31').state === 'yellow');
  const u5 = u2.concat([{ use_date: '2026-02-01', days: 1 }, { use_date: '2026-03-01', days: 1 }, { use_date: '2026-03-02', days: 0.5 }, { use_date: '2026-03-03', days: 0.5 }]);
  t('5日（半日2回を含む）に届いた → 届いた', L.obligation5(G, u5, '2026-08-01').state === 'ok');
  t('期間の前の使用は数えない', L.obligation5(G, [{ use_date: '2025-09-30', days: 5 }], '2026-05-01').used === 0);
  t('この先の使用は予定（届いたことにしない）', (() => { const o = L.obligation5(G, [{ use_date: '2026-09-01', days: 5 }], '2026-05-01'); return o.state === 'yellow' && o.planned === 5 && o.used === 0; })());
  t('10日未満の付与（比例付与の7日）は対象外', L.obligation5([{ grant_date: '2025-10-01', days: 7, kind: 'auto' }], [], '2026-05-01').state === 'none');
  t('移行の残り（opening）は10日以上でも対象外', L.obligation5([{ grant_date: '2025-10-01', days: 12, kind: 'opening' }], [], '2026-05-01').state === 'none');
  t('手で足した10日以上の付与は対象', L.obligation5([{ grant_date: '2025-10-01', days: 10, kind: 'manual' }], [], '2026-05-01').state === 'yellow');
  t('付与しない日にした付与は対象外', L.obligation5([{ grant_date: '2025-10-01', days: 10, kind: 'auto', status: 'skip' }], [], '2026-05-01').state === 'none');
  t('新しい付与があればその日から数え直す', L.obligation5([...G, { grant_date: '2026-10-01', days: 11, kind: 'auto' }], u5, '2026-10-02').used === 0);
}

console.log('\n— 6. 移行日・付与しない日 —');
{
  const g = L.autoGrants('2019-04-01', { opening_date: '2026-04-01' }, '2026-12-31');
  t('移行日より前の自動の付与は「移行日より前」で数えない', g.filter((x) => x.status === 'opening').length === 7 && g[g.length - 1].grant_date === '2026-10-01' && g[g.length - 1].status === 'ok', g.map((x) => x.status));
  const sm = L.summary({ hireDate: '2019-04-01', profile: { opening_date: '2026-04-01' }, grants: [
    { id: 'g1', grant_date: '2024-10-01', days: 3, kind: 'opening' }, { id: 'g2', grant_date: '2025-10-01', days: 18, kind: 'opening' },
    { id: 'g3', grant_date: '2025-10-01', days: 5, kind: 'opening', voided_at: '2026-05-01T00:00:00Z' }], uses: [{ use_date: '2026-05-10', days: 4 }], asOf: '2026-11-20' });
  t('移行: 前年分3日＋今年分18日＋自動20日、取り消した行は数えない', sm.lots.length === 3 && sm.balance.remain === 37, [sm.lots.map((x) => x.kind + x.days), sm.balance.remain]);
  t('移行の残りの前年分（2024/10/1・期限 2026/9/30）は期限切れ、使用4日は前年分3日＋今年分1日から', sm.balance.lots[0].used === 3 && sm.balance.lots[1].used === 1 && sm.balance.lots[0].state === 'expired', sm.balance.lots);
  const sk = L.autoGrants('2019-04-01', { skip_grants: ['2025-10-01', 'bad'] }, '2026-12-31');
  t('付与しない日（skip_grants）は「付与しない」で数えない', sk.find((x) => x.grant_date === '2025-10-01').status === 'skip' && sk.filter((x) => x.status === 'skip').length === 1);
  const s2 = L.summary({ hireDate: '2019-04-01', profile: { skip_grants: ['2025-10-01'] }, asOf: '2025-12-01' });
  t('付与しない日の分は残りに入らない（2024/10/1 の18日だけ）', s2.balance.remain === 18, s2.balance.remain);
  t('次の付与が付与しない日なら印が付く', L.nextGrant('2019-04-01', { skip_grants: ['2027-10-01'] }, '2026-11-20').status === 'skip');
  t('有給の設定の入職日が職員マスタの入職日より優先', L.summary({ hireDate: '2019-04-01', profile: { hire_date: '2022-04-01' }, asOf: '2026-11-20' }).hire === '2022-04-01' && L.hireOf('2019-04-01', null) === '2019-04-01' && L.hireOf(null, { hire_date: '' }) === null);
  t('パート・臨時で週の所定日数が空なら注意', L.needsWeekly('part', null) === true && L.needsWeekly('temp', {}) === true && L.needsWeekly('part', { weekly_days: 3 }) === false && L.needsWeekly('full', null) === false);
}

console.log('\n— 7. シフトの有休と手入力（二重に数えない） —');
{
  const K_STAFF = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }, { staff_id: 'sT02', name: '試験 乙', office: 'visit', emp_code: '9002' }];
  const paid = (sid, d, min) => ({ staff_id: sid, work_date: d, seq: 9, kind: 'paid', start_at: null, end_at: null, break_min: 0, paid_min: min, office: 'facility', symbol: '有' });
  const manual = [
    { id: 'u1', staff_id: 'sT01', use_date: '2026-12-03', days: 1 },                 /* シフトの有休もある日 */
    { id: 'u2', staff_id: 'sT01', use_date: '2026-12-10', days: 0.5 },               /* 手入力だけ */
    { id: 'u3', staff_id: 'sT02', use_date: '2026-12-11', days: 1, voided_at: '2026-12-12T00:00:00Z' }   /* 取り消した */
  ];
  const m = C.computeMonth({ ym: '2026-12', staff: K_STAFF, schedule: [paid('sT01', '2026-12-03', 480), paid('sT01', '2026-12-05', 240), paid('sT02', '2026-12-11', 480)], punches: [], days: [], leave_uses: manual, config: {}, now: Date.parse('2027-01-10T12:00:00+09:00') });
  const us = L.usesFromMonth(m, manual);
  const k = (u) => u.staff_id + '|' + u.use_date + '|' + u.days + '|' + u.src;
  t('同じ日のシフトと手入力は手入力の1件（二重に数えない）', us.filter((u) => u.use_date === '2026-12-03').length === 1 && us.find((u) => u.use_date === '2026-12-03').src === 'manual' && us.find((u) => u.use_date === '2026-12-03').alsoShift === true);
  t('一覧: シフトの半日（12/5）・手入力の半日（12/10）・取り消した手入力の日はシフトの1日（12/11）', us.map(k).join() === 'sT01|2026-12-03|1|manual,sT01|2026-12-05|0.5|shift,sT01|2026-12-10|0.5|manual,sT02|2026-12-11|1|shift', us.map(k));
  const s1 = L.summary({ hireDate: '2019-04-01', grants: [], uses: us.filter((u) => u.staff_id === 'sT01'), asOf: '2026-12-31' });
  t('残りの計算でも 1＋0.5＋0.5＝2日だけ減る', s1.balance.used === 2, s1.balance.used);
  t('月の計算の側は、シフトの有休がある日に手入力を足さない（12/3 は1日・12/10 は手入力の半日）', m.people[0].sum.paidDays === 2 && m.people[0].sum.paidMin === 480 + 240 + 240, [m.people[0].sum.paidDays, m.people[0].sum.paidMin]);
  const two = L.usesFromMonth([m, m], manual);
  t('同じ月を2回渡しても同じ日を2回数えない', two.length === us.length);
  const out = L.usesFromMonth(Object.assign({}, m, { period: { from: '2026-12-04', to: '2026-12-31' } }), []);
  t('月分の期間の外の日はシフトから数えない', !out.some((u) => u.use_date === '2026-12-03'));
}

console.log('\n— 8. 端末の時刻帯で日がずれない —');
{
  const code = `const L=require(${JSON.stringify(LV)});process.stdout.write(JSON.stringify([L.autoGrants('2025-08-31',null,'2030-12-31'),L.expiresOf('2024-02-29'),L.addDays('2026-03-08',1),L.addDays('2026-11-01',-1),L.diffDays('2026-03-01','2026-04-01')]));`;
  const outs = ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC'].map((tz) => spawnSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' }).stdout);
  t('東京・ロサンゼルス・キリティマティ・UTC で同じ答え', outs[0] && outs.every((o) => o === outs[0]), outs.map((o) => (o || '').slice(0, 60)));
  t('夏時間の切り替わりの日も1日ずつ', JSON.parse(outs[1])[2] === '2026-03-09' && JSON.parse(outs[1])[3] === '2026-10-31' && JSON.parse(outs[1])[4] === 31);
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
