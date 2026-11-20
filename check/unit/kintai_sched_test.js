/* 勤怠管理の出勤予定の手直し・シフトに載らない職員の直接入力・固定時間の前提（統合 0111・2026-11-20 代表者の依頼）の画面の試験
   実行: node check/unit/kintai_sched_test.js
   守りたいこと:
     1. 計算（kintai-calc.js）は変えていない。DB が合わせた「効いている予定」（手直し・前提の行は seq 0・記号なし）をそのまま数えられる
        （前提の日に打刻が無ければ「打刻なし」・早い打刻は早出の確認・予定の中の時間は所定内・予定を超えた分は残業）
     2. 窓から呼ぶ関数と引数の名前は DB（0111）と同じ。理由は必ず・版（rev）を送る・締めた月分は窓を止める
     3. 端末に新しく何も残さない（localStorage の鍵は今のまま）・保存していない入力は閉じる前に確かめる
     4. 画面に出す値はエスケープを通す・履歴の文に新しい5つの操作
     5. 給与の画面（payroll.js）と計算の部品は触っていない（給与は kintai_month_get の予定をそのまま数え直す） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const C = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const K = read('kintai.js');
const between = (a, b) => { const i = K.indexOf(a); const j = K.indexOf(b, i + 1); return i >= 0 && j > i ? K.slice(i, j) : ''; };

console.log('\n— 1. 合わせた予定をそのまま数えられる —');
{
  /* 架空の職員 x1（シフトに載らない）。6/3（月）は前提の 9:00〜18:00 休憩60・6/4 は手直しの 10:00〜19:00 休憩45・6/5 は前提で打刻なし */
  const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
  const row = (d, s, e, br) => ({ staff_id: 'x1', work_date: d, seq: 0, office: 'day', start_at: iso(d, s), end_at: iso(d, e), break_min: br, kind: 'work', symbol: null, paid_min: 0, imported_at: '2024-06-01T00:00:00Z' });
  const sched = [row('2024-06-03', '09:00', '18:00', 60), row('2024-06-04', '10:00', '19:00', 45), row('2024-06-05', '09:00', '18:00', 60)];
  const p = (id, kind, d, hm) => ({ id: id, staff_id: 'x1', kind: kind, at: iso(d, hm), source: 'tablet', created_at: iso(d, hm), voided_at: null });
  const punches = [p('a', 'in', '2024-06-03', '08:20'), p('b', 'out', '2024-06-03', '18:30'), p('c', 'in', '2024-06-04', '10:00'), p('d', 'out', '2024-06-04', '19:00')];
  const m = C.computeMonth({ ym: '2024-06', period: { from: '2024-06-01', to: '2024-06-30' }, staff: [{ staff_id: 'x1', name: '架空', office: 'day', active: true }],
    schedule: sched, punches: punches, days: [], config: {}, now: Date.parse('2024-07-10T00:00:00+09:00') });
  const per = m.people[0], day = (d) => per.days.filter((x) => x.date === d)[0];
  const b3 = day('2024-06-03').blocks[0], b4 = day('2024-06-04').blocks[0], b5 = day('2024-06-05').blocks[0];
  t('前提の日（打刻 8:20〜18:30）は予定どおり 9:00〜18:00 で数え、早出と残業の確認の印・実働 8時間', b3.sched && b3.workMin === 480 && b3.flags.indexOf('early') >= 0 && b3.flags.indexOf('overtime') >= 0, [b3.workMin, b3.flags]);
  t('手直しの日（10:00〜19:00・休憩45）は休憩45分で実働 8時間15分・遅刻も早退もなし', b4.sched && b4.breakMin === 45 && b4.workMin === 495 && b4.lateMin === 0 && b4.earlyLeaveMin === 0, [b4.breakMin, b4.workMin]);
  t('前提の日に打刻が無ければ「打刻なし」（要確認）', b5.flags.indexOf('no_punch') >= 0 && C.needsReview(b5), b5.flags);
  t('記号の無い行は記号ごとの回数に入れない（手当の回数を増やさない）', Object.keys(per.sum.counts).length === 0, per.sum.counts);
  t('所定内は予定の中の実働（8時間＋8時間15分）・承認していない早出と残業は数えない（残業 0）', per.sum.schedInMin === 480 + 495 && per.sum.overtimeMin === 0, [per.sum.schedInMin, per.sum.overtimeMin]);
  /* 夜勤の手直し（22:00〜翌7:00）は kind night で、翌日の打刻と組める */
  const n = { staff_id: 'x1', work_date: '2024-06-10', seq: 0, office: 'day', start_at: iso('2024-06-10', '22:00'), end_at: iso('2024-06-11', '07:00'), break_min: 60, kind: 'night', symbol: null, paid_min: 0 };
  const m2 = C.computeMonth({ ym: '2024-06', period: { from: '2024-06-01', to: '2024-06-30' }, staff: [{ staff_id: 'x1', name: '架空', office: 'day', active: true }],
    schedule: [n], punches: [p('e', 'in', '2024-06-10', '22:00'), p('f', 'out', '2024-06-11', '07:00')], days: [], config: {}, now: Date.parse('2024-07-10T00:00:00+09:00') });
  const bn = m2.people[0].days.filter((x) => x.date === '2024-06-10')[0].blocks[0];
  t('日をまたぐ手直しは夜勤の塊（翌日の退勤と組む・実働 8時間・夜勤の回数 1）', bn.night && bn.workMin === 480 && m2.people[0].sum.nightShiftCount === 1, [bn.night, bn.workMin]);
}

console.log('\n— 2. 窓から呼ぶ関数と引数 —');
const ss = between('function saveSched(btn)', '\n  /* ── 0111: 前提の時間');
const sf = between('function saveFixed(btn)', '\n  function voidFixed(');
const sv = between('function voidFixed(id, btn)', '\n  /* ── v4: 職員マスタの突き合わせ');
t('予定は kintai_sched_edit_put(p_staff_id, p_rows, p_reason) を1回で呼ぶ（全部か全部断る）', /rpc\('kintai_sched_edit_put', \{ p_staff_id: sid, p_rows: rows, p_reason: reason \}\)/.test(ss) && (ss.match(/rpc\(/g) || []).length === 1);
t('予定の行は op（set・off・clear）と work_date・時刻帯つきの時刻・休憩・版 rev', /op: 'set', start_at: isoAt\(x, t0\), end_at: isoAt\(t1 <= t0 \? C\.addDays\(x, 1\) : x, t1\), break_min: br, rev: se \? se\.rev : 0/.test(ss)
  && /op: 'off', rev: se \? se\.rev : 0/.test(ss) && /op: 'clear', rev: se\.rev/.test(ss) && /function isoAt\(date, t\) \{ return date \+ 'T' \+ t \+ ':00\+09:00'; \}/.test(K));
t('予定の理由は必ず（理由が無ければ送らない）・まとめて入れる時は確かめる', ss.indexOf("if (!reason)") >= 0 && ss.indexOf("if (!reason)") < ss.indexOf("rpc('kintai_sched_edit_put'") && /rows\.length > 1 && !confirm\(/.test(ss));
t('日付はこの月分の中だけ・62日まで・外す時は手直しのある日だけ送る', /!inPer\(d0\) \|\| !inPer\(d1\)/.test(ss) && /dates\.length > 62/.test(ss) && /if \(se\) rows\.push\(\{ work_date: x, op: 'clear'/.test(ss));
t('前提は kintai_fixed_put(p_staff_id, p_valid_from, p_week, p_replace, p_reason)・同じ効く日の版は確かめてから id を渡して置き換える',
  /rpc\('kintai_fixed_put', \{ p_staff_id: ctx\.sid, p_valid_from: d, p_week: week, p_replace: same \? same\.id : null, p_reason: reason \}\)/.test(sf) && /if \(same && !confirm\(/.test(sf));
t('前提の取り消しは kintai_fixed_void(p_id, p_reason)・理由は必ず・確かめてから', /rpc\('kintai_fixed_void', \{ p_id: id, p_reason: reason \}\)/.test(sv) && sv.indexOf('if (!reason)') < sv.indexOf('confirm(') && sv.indexOf('confirm(') < sv.indexOf("rpc('kintai_fixed_void'"));
t('前提の週の形は 0（日）〜6（土）の7つ・休みは {off:true}・勤務は start・end・break_min', /w\[String\(i\)\] = \{ off: true \}/.test(K) && /w\[String\(i\)\] = \{ start: s0, end: e0, break_min: bm \}/.test(K) && /var WD_ORDER = \[1, 2, 3, 4, 5, 6, 0\]/.test(K));
t('締めた月分は予定の窓を止める（保存のボタンを出さない）', /openDlg\('出勤予定を直す・入れる（' \+ perLabel\(\) \+ '）', b, lk, '保存する', 'sched-save'\)/.test(K));
t('断りの言葉: 締めた日は日付つき・版の食い違い・形の違い・前提の締めと週の形', /e\.kintai === 'locked'\) return \(e\.date \?/.test(K) && /NG_SCHED = \{ conflict:/.test(K) && /NG_FIXED = \{ locked:/.test(K) && /badweek:/.test(K));
t('入口: 日ごと・個人の月の道具の行・直す窓の「この日の予定を直す」・職員と番号の「前提の時間」', (K.match(/data-act="sched-open"/g) || []).length === 2 && /data-act="sched-day"/.test(K) && (K.match(/data-act="fx-open"/g) || []).length === 2
  && /else if \(a === 'sched-save'\) saveSched\(b\);/.test(K) && /else if \(a === 'fx-save'\) saveFixed\(b\);/.test(K) && /else if \(a === 'fx-void'\) voidFixed\(b\.getAttribute\('data-id'\), b\);/.test(K));
t('シフトに載る人の前提の窓には注意を出す', /この人はシフトに載っています。前提の時間を入れると、シフトの空いた日（休み）にも前提の予定が入り/.test(K));

t('休憩が空の時の既定は取り込みと同じ（日をまたぐ勤務は夜勤の休憩・前提の窓も同じ）（審査の指摘2・7）', /if \(br == null\) br = defBreak\(span, t1 <= t0\);/.test(K) && /bm = bv === '' \? defBreak\(sp, e0 <= s0\)/.test(K) && /if \(night\) return Math\.round\(\(typeof cf\.nightBreakH === 'number' \? cf\.nightBreakH : 2\) \* 60\);/.test(K));
t('窓の中で職員・始まりの日付を替えると、今の予定と初めの値を描き直す（審査の指摘3）', /else if \(\(id === 'sc-sid' \|\| id === 'sc-from'\) && dlgCtx && dlgCtx\.mode === 'sched'\) schedRefill\(\);/.test(K) && /function schedRefill\(\)/.test(K) && /openSched\(sid \|\| null, d\);/.test(K) && /dlgCtx\.init = init;/.test(K) && /if \(d1 === from0\) d1 = d;/.test(K));
t('前提の取り消しは、理由と書きかけが消えることを確かめの窓に出し、通信中は窓全体を止める（審査の指摘4）', /取り消す理由: ' \+ reason/.test(sv) && /書きかけの入力は消えます/.test(sv) && /pressBusy\(btn, '取り消しています…', \$\('g-dlg'\)\)/.test(sv));
t('出どころの札は画面だけ（紙の形を変えない）・休みにした日は「予定なし」の後ろにも札（審査の指摘5・6）', /<span class="tag no-print">' \+ \(e\.off/.test(K) && /'<span class="raw">予定なし<\/span>' \+ \(\(schedEditOf\(b\.staff_id, b\.work_date\) \|\| \{\}\)\.off \? srcTag\(b\.staff_id, b\.work_date\) : ''\)/.test(K));
t('理由の「その他」は新しい窓の定型の文も消す・休止中の人の前提には注意（審査の指摘8・10）', /SCHED_REASONS\.indexOf\(inp\.value\) >= 0 \|\| FX_REASONS\.indexOf\(inp\.value\) >= 0/.test(K) && /この人は休止中です。前提の版が残っている間は/.test(K));
{
  /* defBreak を取り出して動かす（夜勤 16:30〜翌9:30 は 120 分・日勤 9:00〜18:00 は 60 分・9:00〜15:00 は 0 分） */
  const src = between('function defBreak(span, night)', '\n  function okOrD(');
  const f = new Function('C', 'month', src + '\nreturn defBreak;')(C, { config: C.fillConfig({}) });
  t('defBreak: 夜勤は 120 分・6時間を超える日勤は 60 分・6時間ちょうどは 0 分', f(1020, true) === 120 && f(540, false) === 60 && f(360, false) === 0, [f(1020, true), f(540, false), f(360, false)]);
}

console.log('\n— 3. 端末に残さない・保存していない入力 —');
t('localStorage.setItem は今までどおり1か所（lsSet）だけ', (K.match(/localStorage\.setItem/g) || []).length === 1);
t('新しい2つの窓は保存していない入力を確かめる', /var DIRTY_MODES = \{[^}]*sched: 1, fixed: 1 \}/.test(K));
t('直す窓から予定の窓へ移る時も、保存していない直しを確かめる', /else if \(a === 'sched-day'\) \{[^\n]*if \(!dirty\(\) \|\| confirm\(/.test(K));

console.log('\n— 4. エスケープと履歴の文 —');
const now = between('function schedNow(sid, date)', '\n  function openSched(');
t('今の予定の文の記号・休憩・理由・した人はエスケープを通す', /esc\(x\.symbol\)/.test(now) && /esc\(x\.break_min \|\| 0\)/.test(now) && /esc\(se\.reason \|\| ''\)/.test(now) && /esc\(se\.updated_by\)/.test(now));
const of = between('function openFixed(sid)', '\n  function fixedWeek(');
t('前提の版の一覧の値はエスケープを通す', /esc\(ymdSl\(v\.valid_from\)\)/.test(of) && /esc\(weekTxt\(v\.week\)\)/.test(of) && /esc\(v\.reason \|\| ''\)/.test(of) && /esc\(v\.created_by \|\| ''\)/.test(of) && /esc\(v\.id\)/.test(of));
t('履歴の文に新しい5つの操作（予定を直した・休み・外した・前提を入れた・取り消した）', /sched_set: '予定を直した', sched_off: '予定を休みにした', sched_clear: '予定の手直しを外した', fixed_put: '前提の時間を入れた', fixed_void: '前提の時間を取り消した'/.test(K)
  && /if \(e\.action === 'sched_set' \|\| e\.action === 'sched_off'\)/.test(K) && /if \(e\.action === 'fixed_void'\)/.test(K));
t('予定の文に出どころの印（手直し・手直し（休み）・前提）', /function srcTag\(sid, date\)/.test(K) && /hm\(b\.schedEnd\) \+ srcTag\(b\.staff_id, b\.work_date\)/.test(K));
t('古い DB（鍵が無い）でも動く（sched_edits・sched_fixed_days・fixed が配列でなければ空）', /Array\.isArray\(data\.sched_edits\) \? data\.sched_edits : \[\]/.test(K) && /Array\.isArray\(data\.sched_fixed_days\)/.test(K) && /Array\.isArray\(data\.fixed\) \? data\.fixed : \[\]/.test(K));

console.log('\n— 5. 給与と計算は触っていない —');
t('kintai.js は月の計算に DB の予定（data.schedule）をそのまま渡す（手直し・前提を画面で混ぜ直さない）', /C\.computeMonth\(\{[^}]*schedule: data\.schedule/.test(K) && !/data\.schedule\s*=|data\.schedule\.push\(/.test(K));
t('payroll.js は kintai_month_get の予定をそのまま数え直す（手直し・前提は DB が入れる）', /schedule: arr\(d\.schedule\)/.test(read('payroll.js')));

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
