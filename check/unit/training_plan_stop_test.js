/* training_plan_stop_test.js — 個別機能訓練計画書（training-plan.html）の「通知を止める（退去・機能訓練中止・作成不要）」
   （2026-10-15 本人指示）を確かめる。純関数層 TP_PURE_MODULE を Node の vm で評価して判定を動かし、
   画面側は「指定が保存・読み込み・索引・AI一括作成の各経路で落ちないこと」を字面で確かめる。
   対象HTMLは環境変数 TP_HTML で差し替えられる。
     TP_HTML=/path/to/training-plan.html node check/unit/training_plan_stop_test.js
   決めたこと（本人の回答）:
     ・指定日から既定の一覧（在籍デイ利用者）・件数・起動時の知らせから外す（「全員」では「— 中止」等で出す）
     ・指定日の前日までは今までどおり通知し、一覧に「○/○で中止予定」と添える
     ・入居者マスタの退去日とは早い方から止める
     ・指定日以降の期は未作成に数えず、AI一括作成でも作らない
   ★名簿・日付はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.TP_HTML || path.join(__dirname, '..', '..', 'training-plan.html');
const raw = fs.readFileSync(HTML, 'utf8');
const mark = raw.indexOf('TP_PURE_MODULE');
const OPEN = raw.indexOf('(function (global) {', mark);
const END = "})(typeof window !== 'undefined' ? window : this);";
const CLOSE = raw.indexOf(END, OPEN);
if (mark < 0 || OPEN < 0 || CLOSE < 0) { console.log('TP_PURE_MODULE を切り出せない: ' + HTML); process.exit(1); }
const sb = {};
vm.createContext(sb);
vm.runInContext(raw.slice(OPEN, CLOSE + END.length), sb);
const TP = sb.TP;

let pass = 0, fail = 0;
function t(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
}
const J = (v) => JSON.stringify(v);

console.log('\n【0】切り出し');
t('TP を評価できた', !!TP);
['normalizeStop', 'stopLimitYmd', 'stopActiveOn', 'buildAlerts', 'alertCounts', 'expectedPeriods'].forEach(function (f) {
  t(f + ' がある', !!TP && typeof TP[f] === 'function');
});
if (!TP || typeof TP.normalizeStop !== 'function') {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + (fail || 1) + ' 件失敗 ──────────');
  process.exit(1);
}

console.log('\n【1】指定の読み込み（壊れた値で画面を止めない）');
t('正しい指定はそのまま', J(TP.normalizeStop({ reason: 'stopped', from: '2026-10-31', note: 'メモ', by: '架空職員', at: '2026-10-15T00:00:00Z' })) ===
  J({ reason: 'stopped', from: '2026-10-31', note: 'メモ', by: '架空職員', at: '2026-10-15T00:00:00Z' }));
t('未知の理由は捨てる', TP.normalizeStop({ reason: 'pause', from: '2026-10-31' }) === null);
t('日付でない日付は捨てる', TP.normalizeStop({ reason: 'stopped', from: '2026/10/31' }) === null);
t('null・文字列は捨てる', TP.normalizeStop(null) === null && TP.normalizeStop('x') === null);
t('ひとことは100字で切る', TP.normalizeStop({ reason: 'notNeeded', from: '2026-10-01', note: 'あ'.repeat(150) }).note.length === 100);
t('理由は3つ（退去・機能訓練中止・作成不要）', J(TP.STOP_REASONS) === J(['discharge', 'stopped', 'notNeeded']) &&
  TP.STOP_LABEL.stopped === '機能訓練中止' && TP.STOP_SHORT.notNeeded === '作成不要');

console.log('\n【2】境目の日');
t('上限日は指定日の前日', TP.stopLimitYmd({ reason: 'stopped', from: '2026-11-01' }) === '2026-10-31');
t('月をまたぐ前日', TP.stopLimitYmd({ reason: 'stopped', from: '2027-01-01' }) === '2026-12-31');
t('止めていなければ空', TP.stopLimitYmd(null) === '');
t('指定日の当日から止まる', TP.stopActiveOn({ reason: 'stopped', from: '2026-10-15' }, '2026-10-15') === true);
t('前日はまだ止まらない', TP.stopActiveOn({ reason: 'stopped', from: '2026-10-16' }, '2026-10-15') === false);

console.log('\n【3】一覧・件数・起動時の知らせ');
const TODAY = '2026-10-15';
/* 架空の3人。どれも最新の計画が古く「超過」になる形にしておく（止めなければ通知が出る） */
function row(id, extra) {
  return Object.assign({ masterId: id, name: '架空 ' + id, kana: 'かくう ' + id, isDaycare: true, active: true,
    latestPlanDate: '2026-06-01', nextDue: '2026-09-01', status: 'final', dischargeDate: '' }, extra || {});
}
const base = TP.buildAlerts([row('A')], { today: TODAY, scope: 'day' });
t('（前提）止めなければ超過として出る', base.length === 1 && base[0].state === 'overdue');

let L = TP.buildAlerts([row('A', { stop: { reason: 'stopped', from: '2026-10-31' } })], { today: TODAY, scope: 'day' });
t('先の日付: 前日までは今までどおり（超過のまま）', L.length === 1 && L[0].state === 'overdue', L);
t('先の日付: 「中止予定」の目印が付く', L[0].stopPlanned === 'stopped' && L[0].stopFrom === '2026-10-31', L[0]);
t('先の日付: 件数・起動時の知らせにも数える', TP.alertCounts(L).overdue === 1);

L = TP.buildAlerts([row('A', { stop: { reason: 'stopped', from: TODAY } })], { today: TODAY, scope: 'day' });
t('当日から: 既定の一覧（在籍デイ利用者）から外れる', L.length === 0, L);
L = TP.buildAlerts([row('A', { stop: { reason: 'notNeeded', from: '2026-09-01' } })], { today: TODAY, scope: 'all' });
t('過ぎた日付: 「全員」では終了として出る', L.length === 1 && L[0].state === 'ended' && L[0].ended === true, L);
t('過ぎた日付: 理由が付く（— 作成不要）', L[0].stopReason === 'notNeeded' && !L[0].stopPlanned);
t('過ぎた日付: 件数・起動時の知らせに数えない', J(TP.alertCounts(L)) === J({ overdue: 0, warn: 0, none: 0, ok: 0, ended: 1 }));

L = TP.buildAlerts([row('A', { latestPlanDate: '', nextDue: '', stop: { reason: 'notNeeded', from: '2026-10-01' } })], { today: TODAY, scope: 'all' });
t('計画が1件も無い方も止められる（「計画なし」に数えない）', L[0].state === 'ended' && TP.alertCounts(L).none === 0, L);

console.log('\n【4】入居者マスタの退去日とは早い方から');
L = TP.buildAlerts([row('A', { dischargeDate: '2026-12-31', stop: { reason: 'stopped', from: '2026-10-01' } })], { today: TODAY, scope: 'all' });
t('指定日が早い: 指定日で止まり、理由が付く', L[0].state === 'ended' && L[0].stopReason === 'stopped', L);
L = TP.buildAlerts([row('A', { dischargeDate: '2026-09-30', stop: { reason: 'stopped', from: '2026-10-05' } })], { today: TODAY, scope: 'all' });
t('退去日が早い: 従来どおりの「終了」（理由は付けない）', L[0].state === 'ended' && L[0].stopReason === '', L);
L = TP.buildAlerts([row('A', { dischargeDate: '2026-09-30', stop: { reason: 'stopped', from: '2026-11-30' } })], { today: TODAY, scope: 'all' });
t('退去で止まっている方に「中止予定」は出さない', L[0].state === 'ended' && L[0].stopPlanned === '', L);
L = TP.buildAlerts([row('A', { dischargeDate: '2026-10-10' })], { today: TODAY, scope: 'all' });
t('指定が無ければ従来どおり（退去日で終了）', L[0].state === 'ended' && L[0].stopReason === '' && L[0].stopPlanned === '');
L = TP.buildAlerts([row('A', { stop: { reason: 'pause', from: '2026-10-01' } })], { today: TODAY, scope: 'day' });
t('壊れた指定は無かったことにする（通知は止めない）', L.length === 1 && L[0].state === 'overdue');

console.log('\n【5】未作成の期は指定日の前日まで');
const plans = [{ planId: 'p1', planDate: '2026-01-01' }];
const all = TP.expectedPeriods(plans, TODAY, 'calendar', 45).filter((x) => x.kind === 'missing').map((x) => x.date);
t('（前提）止めなければ 4/1・7/1・10/1 が未作成', J(all) === J(['2026-04-01', '2026-07-01', '2026-10-01']), all);
const lim = TP.stopLimitYmd({ reason: 'stopped', from: '2026-07-01' });
const cut = TP.expectedPeriods(plans, lim, 'calendar', 45).filter((x) => x.kind === 'missing').map((x) => x.date);
t('7/1 から止めると 4/1 だけ（指定日当日の期は作らない）', J(cut) === J(['2026-04-01']), cut);

console.log('\n【6】画面側: 指定が保存・読み込み・索引・AI一括作成の経路で落ちない');
const S = raw;
t('開いた時に指定を読み込む（★落とすと次の保存で消える）', /stop: TP\.normalizeStop\(j\.data\.stop\)/.test(S));
t('サーバーの計画データの読み込みでも持つ（取込・競合）', /stop: TP\.normalizeStop\(data && data\.stop\)/.test(S));
t('新しい計画データにも欄がある', /plans: \[\], trash: \[\], gaps: \[\], stop: null/.test(S));
t('索引に理由と指定日を写す', /stop: \(function \(st\) \{ return st \? \{ reason: st\.reason, from: st\.from \} : null; \}\)\(TP\.normalizeStop\(doc && doc\.stop\)\)/.test(S));
t('未作成の数・期の並びは指定日の前日まで', /function timelineOf\(plans, stop\) \{[\s\S]{0,200}TP\.stopLimitYmd\(stop\)/.test(S) &&
  /missingCount: missingCountOf\(plans, doc && doc\.stop\)/.test(S) && /timelineOf\(DOC\.plans, DOC\.stop\)/.test(S));
t('AI一括作成は指定日の前日まで', /function batchAiLimitFor\(masterId\) \{[\s\S]{0,900}TP\.stopLimitYmd\(stop\)/.test(S));
t('一覧に指定を渡す', /stop: idxRow\.stop \|\| null/.test(S));
t('計画の無い方でも指定があれば索引を作り直す', (S.match(/j\.data\.plans\.length \|\| TP\.normalizeStop\(j\.data\.stop\)/g) || []).length === 2);
t('2台で同時に変えた時は3者で突き合わせる', /var stopTook = mergeStop\(DOC, srv\.stop, DOC_BASE \? TP\.normalizeStop\(DOC_BASE\.stop\) : undefined\);/.test(S));
t('バッジ: 理由つきの終了', /'— ' \+ \(TP\.STOP_SHORT\[row\.stopReason\] \|\| '終了'\)/.test(S));
t('バッジ: 中止予定の添え書き', /' で' \+ \(TP\.STOP_SHORT\[row\.stopPlanned\] \|\| '中止'\) \+ '予定）'/.test(S));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
