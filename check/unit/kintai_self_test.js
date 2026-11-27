/* 自分の勤怠（職員本人のスマホの画面・kintai-self.html・kintai-self.js・kintai-self-calc.js・2026-11-20 契約 ROOT-v5-freee.md「段5」・care-backend 統合 0114）の試験。
   架空の職員・架空の時刻だけを使う。
   1. 登録の番号: 8文字のそろえ方（shortOf）は enroll.js・login.js と一字一句同じ・住所の # の後ろから番号を取り出す・暗証番号の形
   2. 勤怠: 受け口の月の答え（自分1人）を管理画面と同じ computeMonth に渡し、日ごとの予定・打刻・数えた時刻・実働と合計を出す・今月分の決め方（締め日）
   3. 有給: 受け口の有給の答えから、管理画面と同じ数え方（シフトの有休の日＋手入力の使用・usesFromMonth → summary）で残りと期限を出す
   4. 申請: 入力 → 送る形（打刻の直し・残業と早出・月の確認・理由の194字・次の日の時刻）・一覧の文・断りの語（データベースの語は全部、職員に分かる文がある）
   5. ファイルの決まり: CSP は受け口の住所だけ・直書きのスクリプトなし・HTML の代入なし・共通ログインの部品を読まない・端末に置くのは鍵とタブの印だけ・
      読み込みの順番と版・不具合の報告ボタン・印刷しない・押す所 44px と入力の文字 16px・公開の許可
   実行: node check/unit/kintai_self_test.js
   ★出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const S = require(path.join(ROOT, 'kintai-self-calc.js'));
const C = require(path.join(ROOT, 'kintai-calc.js'));
const L = require(path.join(ROOT, 'kintai-leave.js'));
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

group('1. 登録の番号・暗証番号');
const block = (src) => { const a = src.indexOf('// SHORTOF-BEGIN'), b = src.indexOf('// SHORTOF-END'); return a < 0 || b < 0 ? null : src.slice(a, b).split('\n').map((x) => x.trim()).join('\n'); };
t('shortOf は enroll.js と一字一句同じ', block(read('kintai-self-calc.js')) !== null && block(read('kintai-self-calc.js')) === block(read('enroll.js')));
t('shortOf は login.js と一字一句同じ', block(read('kintai-self-calc.js')) === block(read('login.js')));
t('8文字のそろえ方（全角・小文字・空白・横棒）・使わない字は断る',
  S.shortOf('ｋ７ｍｐ　２ｘｑ９') === 'K7MP2XQ9' && S.shortOf('k7mp-2xq9') === 'K7MP2XQ9' && S.shortOf('K7MP2XQ0') === '' && S.shortOf('') === '');
t('住所の # の後ろから QR の40字・8文字を取り出す（形が違えば空）',
  S.codeFromHash('#c=0123456789abcdef0123456789abcdef01234567') === '0123456789abcdef0123456789abcdef01234567'
  && S.codeFromHash('#c=K7MP-2XQ9') === 'K7MP2XQ9' && S.codeFromHash('#c=%3Cscript%3E') === '' && S.codeFromHash('') === '' && S.codeFromHash('#x=1') === '');
t('暗証番号: 4桁の数字・2回同じ', S.pinProblem('1357', '1357') === '' && S.pinProblem('135', '135') !== '' && S.pinProblem('13a7', '13a7') !== ''
  && S.pinProblem('1357', '1358') !== '' && S.pinProblem('1357') === '');
t('2分さわらないと閉じる（仮置き）', S.IDLE_MS === 120000);

group('2. 勤怠（管理画面と同じ computeMonth）');
const SID = 'ks-s1';
const month = {
  ok: true, period: { from: '2022-05-01', to: '2022-05-31', lead_from: '2022-04-25', close_day: 0 },
  staff: [{ staff_id: SID, name: '架空 本人一', display_name: '表示 本人一', office: 'facility', employment: null, active: true }],
  punches: [
    { id: 'p1', staff_id: SID, kind: 'in', at: '2022-05-10T08:55:00+09:00', source: 'tablet', created_at: '2022-05-10T08:55:00+09:00', voided_at: null },
    { id: 'p2', staff_id: SID, kind: 'out', at: '2022-05-10T18:05:00+09:00', source: 'tablet', created_at: '2022-05-10T18:05:00+09:00', voided_at: null },
  ],
  schedule: [
    { staff_id: SID, work_date: '2022-05-10', seq: 0, office: 'facility', start_at: '2022-05-10T09:00:00+09:00', end_at: '2022-05-10T18:00:00+09:00', break_min: 60, kind: 'work', symbol: '日', paid_min: 0 },
    { staff_id: SID, work_date: '2022-05-11', seq: 0, office: 'facility', start_at: null, end_at: null, break_min: 0, kind: 'paid', symbol: '有', paid_min: 480 },
    { staff_id: SID, work_date: '2022-05-12', seq: 0, office: 'facility', start_at: '2022-05-12T09:00:00+09:00', end_at: '2022-05-12T18:00:00+09:00', break_min: 60, kind: 'work', symbol: '日', paid_min: 0 },
  ],
  days: [], month: null, settings: { config: {} }, leave_uses: [],
};
const m = S.computeOf(month, '2022-05', C, Date.parse('2022-06-05T12:00:00+09:00'));
const direct = C.computeMonth({ ym: '2022-05', period: month.period, staff: month.staff, schedule: month.schedule, punches: month.punches, days: [], leave_uses: [], config: {}, now: Date.parse('2022-06-05T12:00:00+09:00') });
t('数え方は管理画面の computeMonth と同じ（合計が一致）', JSON.stringify(m.people[0].sum) === JSON.stringify(direct.people[0].sum));
const rows = S.dayRows(m, C, '2022-06-05');
const r10 = rows.find((r) => r.date === '2022-05-10'), r11 = rows.find((r) => r.date === '2022-05-11'), r12 = rows.find((r) => r.date === '2022-05-12');
t('5/10: 予定 9:00〜18:00・打刻 出 08:55 退 18:05・数えた時刻 09:00〜18:00・実働 8:00',
  r10 && r10.label === '5/10（火）' && r10.sched === '09:00〜18:00' && r10.punches === '出 08:55　退 18:05' && r10.counted === '09:00〜18:00' && r10.work === '8:00', r10);
t('5/11: 有休の日', r11 && r11.sched === '有休' && r11.paid === 1, r11);
t('5/12: 打刻が無い日は印（打刻がありません）が出る', r12 && r12.punches === '' && r12.flags.indexOf(C.FLAG_LABEL.no_punch) >= 0, r12);
const tot = S.monthTotals(m);
t('合計: 実働 480分・出勤1日・有休1日', tot.workMin === 480 && tot.workDays === 1 && tot.paidDays === 1, tot);
t('締めた月分は控えの設定で数える（管理画面と同じ）・締めの印を出す',
  S.monthHead({ period: month.period, month: { locked_at: '2022-06-02T00:00:00Z' } }, C, '2022-05').locked === true
  && S.monthHead(month, C, '2022-05').label === '2022年5月分（5/1〜5/31）');
t('今月分の決め方: 締め日が20日で今日が21日なら次の月分・期間の中ならその月',
  S.currentYm('2022-05-21', '2022-05', { from: '2022-04-21', to: '2022-05-20' }) === '2022-06'
  && S.currentYm('2022-05-10', '2022-05', { from: '2022-04-21', to: '2022-05-20' }) === '2022-05'
  && S.currentYm('2022-05-10', '2022-05', { from: '2022-05-01', to: '2022-05-31' }) === '2022-05');
t('事務所が足した打刻（承認した直し）には印を出さない',
  S.dayRows(C.computeMonth({ ym: '2022-05', period: month.period, staff: month.staff, schedule: month.schedule.slice(0, 1),
    punches: [{ id: 'p3', staff_id: SID, kind: 'in', at: '2022-05-10T09:00:00+09:00', source: 'office' }, { id: 'p4', staff_id: SID, kind: 'out', at: '2022-05-10T18:00:00+09:00', source: 'office' }],
    days: [], config: {}, now: Date.parse('2022-06-05T12:00:00+09:00') }), C, '2022-06-05')[0].flags.length === 0);

group('2b. 休暇の種類（統合 0113・段4）');
/* 受け口の月の答えの absences（id・date・kind・minutes・paid・type_code・link_date だけ・職員の番号なし）に自分の番号を付けて computeMonth へ渡す */
let seen = null;
const spyC = { computeMonth: (o) => { seen = o; return { people: [] }; } };
S.computeOf(Object.assign({}, month, { absences: [{ id: 'a1', date: '2022-05-20', kind: 'special', minutes: null, paid: true, type_code: 'keicho', link_date: null }] }), '2022-05', spyC, 0);
t('休暇は自分の職員の番号を付けて computeMonth へ渡す（中身は変えない）',
  seen && Array.isArray(seen.absences) && seen.absences.length === 1 && seen.absences[0].staff_id === SID && seen.absences[0].kind === 'special' && seen.absences[0].type_code === 'keicho', seen && seen.absences);
S.computeOf(month, '2022-05', spyC, 0);
t('休暇の鍵が無い答え（0113 の前の受け口）でも空で渡す', seen && Array.isArray(seen.absences) && seen.absences.length === 0);
t('今の計算の部品（休暇を数えない版）に渡しても止まらない',
  (() => { try { S.computeOf(Object.assign({}, month, { absences: [{ id: 'a1', date: '2022-05-20', kind: 'comp', minutes: null, paid: false, type_code: null, link_date: '2022-05-15' }] }), '2022-05', C, 0); return true; } catch (e) { return false; } })());
/* 日の行の印の言い方は、勤怠の管理画面（段4 の kintai.js の absTags）と同じ */
const TYPES = [{ code: 'keicho', name: '慶弔', paid: true }, { code: 'other', name: 'その他', paid: false }];
t('休暇の印の言い方は管理画面と同じ（時間単位・特別休暇・半日・無給・代休・振替の休む日と働く日）',
  S.absLabel({ kind: 'hourly_paid', minutes: 120 }, TYPES) === '時間単位の有休 2時間'
  && S.absLabel({ kind: 'special', minutes: null, paid: true, type_code: 'keicho' }, TYPES) === '特別休暇「慶弔」'
  && S.absLabel({ kind: 'special', minutes: 240, paid: false, type_code: 'other' }, TYPES) === '特別休暇「その他」半日（無給）'
  && S.absLabel({ kind: 'special', minutes: null, paid: true, type_code: 'zzz' }, TYPES) === '特別休暇「zzz」'
  && S.absLabel({ kind: 'comp', minutes: null, link_date: '2022-05-15' }, TYPES) === '代休（05/15 の休日出勤）'
  && S.absLabel({ kind: 'comp', minutes: 240, link_date: '2022-05-15' }, TYPES) === '代休 半日（05/15 の休日出勤）'
  && S.absLabel({ kind: 'swap', role: 'off', link_date: '2022-05-28' }, TYPES) === '振替休日（働く日 05/28）'
  && S.absLabel({ kind: 'swap', role: 'work', date: '2022-06-03' }, TYPES) === '振替で働く日（休む日 06/03）'
  && S.absLabel({ kind: 'nope' }, TYPES) === '' && S.absLabel(null, TYPES) === '');
const fakeMonth = { config: {}, people: [{ staff: { staff_id: SID }, sum: {}, days: [
  { date: '2022-05-20', blocks: [], workMin: 0, paidDays: 0, absences: [{ kind: 'special', minutes: null, paid: true, type_code: 'keicho' }] },
  { date: '2022-05-21', blocks: [], workMin: 0, paidDays: 0 }] }] };
const fakeC = { FLAG_LABEL: C.FLAG_LABEL, leaveTypesOf: () => TYPES };
const ar = S.dayRows(fakeMonth, fakeC, '2022-06-01');
t('日の行に休暇の印を出す（設定の特別休暇の名前）・休暇の無い日は空', JSON.stringify(ar[0].absences) === JSON.stringify(['特別休暇「慶弔」']) && JSON.stringify(ar[1].absences) === '[]', ar);
t('特別休暇の種類の一覧を読めない部品でも、印は種類の印のまま出す', JSON.stringify(S.dayRows(fakeMonth, { FLAG_LABEL: {} }, '2022-06-01')[0].absences) === JSON.stringify(['特別休暇「keicho」']));
t('画面は休暇の印を textContent で出す（tag の部品）', /r\.absences\.forEach\(function \(x\) \{ c\.appendChild\(el\('span', 'tag', x\)\); \}\)/.test(read('kintai-self.js')));

group('3. 有給（管理画面と同じ数え方）');
const lv = {
  ok: true, staff_id: SID, hire_date: null, profile: null,
  grants: [{ id: 'g1', staff_id: SID, grant_date: '2022-04-01', days: 10, kind: 'manual', created_at: '2022-04-01T00:00:00Z', voided_at: null }],
  uses: [{ id: 'u1', staff_id: SID, use_date: '2022-05-16', days: 1, created_at: '2022-05-16T00:00:00Z', voided_at: null },
         { id: 'u2', staff_id: SID, use_date: '2022-05-17', days: 0.5, created_at: '2022-05-17T00:00:00Z', voided_at: '2022-05-18T00:00:00Z' }],
  months: [{ ym: '2022-04', from: '2022-04-01', to: '2022-04-30', locked: true, config: {} }, { ym: '2022-05', from: '2022-05-01', to: '2022-05-31', locked: false, config: {} }],
  schedule: month.schedule,
};
const sm = S.leaveOf(lv, C, L, '2022-06-01');
/* 管理画面の数え方（kintai.js の loadLeave と同じ: 月分ごとに computeMonth → usesFromMonth → summary） */
const adminMonths = lv.months.map((x) => C.computeMonth({ ym: x.ym, period: { from: x.from, to: x.to }, staff: [{ staff_id: SID }], schedule: lv.schedule, punches: [], days: [],
  leave_uses: lv.uses.filter((u) => !u.voided_at && u.use_date >= x.from && u.use_date <= x.to), config: {}, now: Date.UTC(2000, 0, 1) }));
const adminUses = L.usesFromMonth(adminMonths, lv.uses);
const adminSm = L.summary({ hireDate: null, profile: null, grants: lv.grants, uses: adminUses.filter((u) => u.staff_id === SID), asOf: '2022-06-01' });
t('残り 8 日（付与10日−シフトの有休1日−手入力1日・取り消した使用は数えない）', sm && sm.balance.remain === 8, sm && sm.balance);
t('管理画面の数え方と同じ結果', JSON.stringify(sm.balance) === JSON.stringify(adminSm.balance));
const v = S.leaveView(sm);
t('表示: 残り・付与ごとの残りと期限（2年後の前日）・入職日が分からない注意',
  v.remain === 8 && v.lots.length === 1 && v.lots[0].expires === '2024年3月31日' && v.lots[0].remain === 8 && v.hireUnknown === true, v);
t('職員の番号が無い答えは数えない', S.leaveOf({ ok: true }, C, L, '2022-06-01') === null);

group('4. 申請');
const bp = S.buildRequest({ kind: 'punch', date: '2022-05-10', punchKind: 'out', time: '19:00', reason: ' 退勤を押し忘れました ' });
t('打刻の直し: {kind, at}（+09:00）・理由は前後の空白を除く',
  bp.ok && JSON.stringify(bp.req) === JSON.stringify({ kind: 'punch', work_date: '2022-05-10', ym: null, body: { kind: 'out', at: '2022-05-10T19:00:00+09:00' }, reason: '退勤を押し忘れました' }), bp);
t('夜勤の退勤（次の日の時刻）', S.buildRequest({ kind: 'punch', date: '2022-05-31', punchKind: 'out', time: '09:00', nextDay: true, reason: '見本' }).req.body.at === '2022-06-01T09:00:00+09:00');
const bo = S.buildRequest({ kind: 'overtime', date: '2022-05-12', earlyFrom: '08:00', otUntil: '01:00', otNextDay: true, reason: '見本' });
t('残業と早出: 早出の始まりと残業の終わり（次の日）', bo.ok && JSON.stringify(bo.req.body) === JSON.stringify({ early_from: '2022-05-12T08:00:00+09:00', ot_until: '2022-05-13T01:00:00+09:00' }), bo);
t('残業だけ・早出だけも出せる',
  JSON.stringify(S.buildRequest({ kind: 'overtime', date: '2022-05-12', otUntil: '19:30', reason: '見本' }).req.body) === '{"ot_until":"2022-05-12T19:30:00+09:00"}'
  && JSON.stringify(S.buildRequest({ kind: 'overtime', date: '2022-05-12', earlyFrom: '07:30', reason: '見本' }).req.body) === '{"early_from":"2022-05-12T07:30:00+09:00"}');
t('月の確認: 理由なし・中身は {}', JSON.stringify(S.buildRequest({ kind: 'month', ym: '2022-05' }).req) === JSON.stringify({ kind: 'month', work_date: null, ym: '2022-05', body: {}, reason: null }));
t('断り: 理由なし・195字・時刻なし・時刻の形・早出も残業も無い・日付なし・種類なし・月分なし',
  !S.buildRequest({ kind: 'punch', date: '2022-05-10', punchKind: 'in', time: '09:00', reason: '  ' }).ok
  && !S.buildRequest({ kind: 'punch', date: '2022-05-10', punchKind: 'in', time: '09:00', reason: 'あ'.repeat(195) }).ok
  && S.buildRequest({ kind: 'punch', date: '2022-05-10', punchKind: 'in', time: '09:00', reason: 'あ'.repeat(194) }).ok
  && !S.buildRequest({ kind: 'punch', date: '2022-05-10', punchKind: 'in', time: '', reason: '見本' }).ok
  && !S.buildRequest({ kind: 'punch', date: '2022-05-10', punchKind: 'in', time: '24:00', reason: '見本' }).ok
  && !S.buildRequest({ kind: 'overtime', date: '2022-05-10', reason: '見本' }).ok
  && !S.buildRequest({ kind: 'punch', date: '2022-02-30', punchKind: 'in', time: '09:00', reason: '見本' }).ok
  && !S.buildRequest({ kind: 'leave', date: '2022-05-10', reason: '見本' }).ok
  && !S.buildRequest({ kind: 'month', ym: '2022-5' }).ok);
const rr = S.requestRow({ id: 'x', rev: 2, kind: 'overtime', work_date: '2022-05-12', ym: '2022-05', body: { early_from: '2022-05-12T08:00:00+09:00', ot_until: '2022-05-12T20:00:00+09:00' },
  reason: '見本', status: 'rejected', decide_note: '予定どおりでした' });
t('一覧の文: 種類・日・中身・状態・差し戻しの理由・取り下げは承認待ちだけ',
  rr.kind === '残業・早出' && rr.when === '5/12（木）' && rr.what === '早出 08:00から・残業 20:00まで' && rr.status === '差し戻し' && rr.note === '予定どおりでした' && rr.canWithdraw === false
  && S.requestRow({ kind: 'punch', work_date: '2022-05-10', body: { kind: 'in', at: '2022-05-10T09:00:00+09:00' }, status: 'pending' }).canWithdraw === true
  && S.requestRow({ kind: 'month', ym: '2022-05', body: {}, status: 'approved' }).when === '2022年5月分', rr);
/* データベース（統合 0114 の本人の口）と受け口が返す断りの語は、全部に職員に分かる文がある（技術の語をそのまま出さない） */
const WORDS = ['format', 'badpin', 'limited', 'invalid', 'samecode', 'toomany', 'nokey', 'closed', 'wrong', 'locked', 'badym', 'badperiod', 'badkind',
  'conflict', 'reason', 'badvalue', 'baddate', 'exists', 'notfound', 'server', 'net', 'origin', 'inactive', 'too-large', 'method'];
t('断りの語は全部、職員に分かる文がある', WORDS.every((w) => S.ERR[w] && !/[a-z_]{4,}/.test(S.ERR[w])), WORDS.filter((w) => !S.ERR[w]));
t('休止中（inactive）の文（仮置き）・鍵は消さずに暗証番号の画面のまま止める（中身は捨てる）',
  S.errorText('inactive') === '今は勤怠の名簿でお休み中になっているため、開けません。事務所に知らせてください。'
  && /if \(r && r\.error === 'inactive'\) \{ lock\(S\.errorText\('inactive'\)\); return true; \}/.test(read('kintai-self.js'))
  && !/error === 'inactive'[^\n]*forgetLocal/.test(read('kintai-self.js')));
t('申請の時の locked・toomany は申請の文', S.errorText('locked', 'request') !== S.errorText('locked') && S.errorText('toomany', 'request').indexOf('20件') >= 0
  && S.errorText('who-knows') === S.ERR.server);

group('4b. v6: 事務所からの打刻漏れの知らせ（統合 0125・op notices）');
{
  /* その日の打刻は月の答えを数えた結果で見る（5/10 は出勤・退勤がそろう・5/12 は予定だけで打刻なし） */
  const pu10 = S.punchesOn(m, '2022-05-10'), pu12 = S.punchesOn(m, '2022-05-12'), puX = S.punchesOn(m, '2022-05-25');
  t('その日の出勤・退勤（in・out の2つだけを見る）', pu10.known && pu10.hasIn && pu10.hasOut && pu12.known && !pu12.hasIn && !pu12.hasOut && !puX.known, [pu10, pu12, puX]);
  const N = (kind, d) => ({ id: '00000000-0000-4000-8000-0000000000n1', kind, work_date: d, created_at: '2022-05-13T10:00:00+09:00', seen_at: null });
  t('打刻漏れの文: 打刻が無い日は「〇月〇日の打刻が抜けています」＋直し方（決まった文・仮置き）',
    S.noticeText(N('missing', '2022-05-12'), pu12) === '5月12日の打刻が抜けています。事務所に伝えるか、申請から打刻の直しを出してください。', S.noticeText(N('missing', '2022-05-12'), pu12));
  t('打刻漏れの文: 出勤だけある日は「退勤の」・退勤だけある日は「出勤の」',
    S.noticeText(N('missing', '2022-05-12'), { known: true, hasIn: true, hasOut: false, missOut: true }) === '5月12日の退勤の打刻が抜けています。' + S.NOTICE_TAIL
    && S.noticeText(N('missing', '2022-05-12'), { known: true, hasIn: false, hasOut: true, missIn: true }) === '5月12日の出勤の打刻が抜けています。' + S.NOTICE_TAIL);
  t('打刻漏れは出勤・退勤がそろったら出さない', S.noticeText(N('missing', '2022-05-10'), pu10) === '');
  t('まだ出勤していないの文・出勤があれば出さない（仮置き）',
    S.noticeText(N('not_in', '2022-05-12'), pu12) === '5月12日の出勤の打刻がまだありません。' + S.NOTICE_TAIL
    && S.noticeText(N('not_in', '2022-05-10'), pu10) === '' && S.noticeText(N('not_in', '2022-05-12'), { known: true, hasIn: true, hasOut: false }) === '');
  /* 反証 2026-11-24 の 1: 出勤・退勤が1つずつあっても、管理画面の塊ごとの印で打刻漏れなら帯を出す（本物の computeMonth で数える） */
  const P = (id, kind, hm) => ({ id, staff_id: SID, kind, at: '2022-05-12T' + hm + ':00+09:00', source: 'tablet', created_at: '2022-05-12T' + hm + ':00+09:00', voided_at: null });
  const mOf = (pp) => S.computeOf(Object.assign({}, month, { punches: month.punches.concat(pp) }), '2022-05', C, Date.parse('2022-06-05T12:00:00+09:00'));
  const puA = S.punchesOn(mOf([P('q1', 'in', '09:00'), P('q2', 'in', '13:00'), P('q3', 'out', '18:00')]), '2022-05-12');
  const puB = S.punchesOn(mOf([P('q1', 'in', '09:00'), P('q2', 'out', '12:00'), P('q3', 'in', '13:00')]), '2022-05-12');
  t('出勤→出勤→退勤（昼の退勤の押し忘れ）・出勤→退勤→出勤（中抜けの後の退勤の押し忘れ）でも、管理画面と同じく打刻漏れの帯を出す',
    puA.hasIn && puA.hasOut && S.noticeText(N('missing', '2022-05-12'), puA) !== '' && puB.hasIn && puB.hasOut && S.noticeText(N('missing', '2022-05-12'), puB) !== '', [puA, puB]);
  const mLv = S.computeOf(Object.assign({}, month, { absences: [{ id: 'a9', date: '2022-05-12', kind: 'special', minutes: null, paid: true, type_code: 'keicho', link_date: null }] }), '2022-05', C, Date.parse('2022-06-05T12:00:00+09:00'));
  t('1日休む休暇の日（有休の1日のシフト・1日の特別休暇）は帯を出さない（反証の 4）',
    S.noticeText(N('missing', '2022-05-11'), S.punchesOn(m, '2022-05-11')) === '' && S.noticeText(N('not_in', '2022-05-12'), S.punchesOn(mLv, '2022-05-12')) === ''
    && S.noticeText(N('missing', '2022-05-12'), S.punchesOn(mLv, '2022-05-12')) === '');
  t('時間単位の有休が切られた時の断りは本当の理由（反証の 3）', /時間単位の有休/.test(S.errorText('badkind', 'leave', 'hourly')) && S.errorText('badkind', 'leave', 'paid_day') === S.errorText('badkind', 'leave'));
  t('月の答えを読めない時（null）も決まった文を出す', S.noticeText(N('missing', '2022-05-12'), null) === '5月12日の打刻が抜けています。' + S.NOTICE_TAIL);
  t('知らない種類・日付の形が違う行は出さない（自由な文を持たない）', S.noticeText(N('free', '2022-05-12'), null) === '' && S.noticeText(N('missing', '2022-5-12'), null) === '' && S.noticeText(null, null) === '');
  const nr = S.noticeRows([N('missing', '2022-05-12'), N('not_in', '2022-05-11'), N('missing', '2022-05-12'), { kind: 'x', work_date: '2022-05-01' }, null, N('missing', 'zz')]);
  t('受け口の行: 形の合う知らせだけ・日付の古い順・同じ日と種類は1つ', nr.length === 2 && nr[0].kind === 'not_in' && nr[1].work_date === '2022-05-12' && S.noticeRows(null).length === 0, nr);
  t('文に技術の語・記号の名前が無い', !/[a-z_]{4,}/.test(S.noticeText(N('missing', '2022-05-12'), null) + S.noticeText(N('not_in', '2022-05-12'), null)));
  const sjs = read('kintai-self.js');
  t('開いた時に1回だけ読む（暗証番号で開いた後）・閉じた時に帯と中身を捨てる',
    /setTab\(tab\);\s*loadNotices\(\);/.test(sjs) && (sjs.match(/call\('notices'/g) || []).length === 1 && /notices = null; monthWait = \{\};/.test(sjs) && /'req-list', 'nt-box'\]\.forEach/.test(sjs) && /\$\('nt-box'\)\.hidden = true;/.test(sjs));
  t('読めない時（古い受け口の format など）は帯を出さないだけ（鍵の語だけ扱う）', /if \(r\.ok !== true\) \{ handleAuth\(r\); return; \}/.test(sjs));
  t('帯は textContent の部品で作り、見出し「事務所からの知らせ」を付ける（色だけで伝えない）・帯から打刻の直しをその日付で開く',
    /el\('h2', null, '事務所からの知らせ'\)/.test(sjs) && /function openPunchFix\(date, pk\) \{[\s\S]*?setTab\('req'\);[\s\S]*?\$\('rq-kind'\)\.value = 'punch'; kindChanged\(\);[\s\S]*?\$\('rq-date'\)\.value = date;/.test(sjs));
}

group('4c. v6: 休暇の申請（kind leave）');
{
  const T3 = C.leaveTypesOf({});
  const L1 = (o) => S.buildRequest(Object.assign({ kind: 'leave', date: '2022-06-10', reason: '私用', types: T3, hourlyOn: false }, o));
  const body = (o) => { const r = L1(o); return r.ok ? JSON.stringify(r.req.body) : 'NG:' + r.msg; };
  t('有休（1日）・有休（半日）は type だけ', body({ leaveType: 'paid_day' }) === '{"type":"paid_day"}' && body({ leaveType: 'paid_half', half: true }) === '{"type":"paid_half"}');
  t('送る形: kind leave・work_date が休む日・ym なし・理由', JSON.stringify(L1({ leaveType: 'paid_day' }).req) === JSON.stringify({ kind: 'leave', work_date: '2022-06-10', ym: null, body: { type: 'paid_day' }, reason: '私用' }));
  t('時間単位: 設定 hourlyPaidLeave が true の時だけ・時間×60分', body({ leaveType: 'hourly', hours: '2', hourlyOn: true }) === '{"type":"hourly","minutes":120}' && !L1({ leaveType: 'hourly', hours: '2' }).ok && !L1({ leaveType: 'hourly', hours: '', hourlyOn: true }).ok);
  t('特別休暇: 設定の種類（無い時は既定の3つ）・半日', body({ leaveType: 'special', typeCode: 'keicho' }) === '{"type":"special","type_code":"keicho"}'
    && body({ leaveType: 'special', typeCode: 'other', half: true }) === '{"type":"special","type_code":"other","half":true}' && !L1({ leaveType: 'special', typeCode: 'nope' }).ok && T3.length === 3);
  t('代休: 休日に働いた日・半日／振替: 働く日（半日なし）', body({ leaveType: 'comp', linkDate: '2022-06-05', half: true }) === '{"type":"comp","link_date":"2022-06-05","half":true}'
    && body({ leaveType: 'swap', linkDate: '2022-06-12', half: true }) === '{"type":"swap","link_date":"2022-06-12"}' && !L1({ leaveType: 'comp' }).ok && !L1({ leaveType: 'swap', linkDate: '2022-06-10' }).ok);
  t('有休に半日・結ぶ日の鍵を付けない（当てはまる鍵だけ）', body({ leaveType: 'paid_day', half: true, linkDate: '2022-06-01', typeCode: 'keicho', hours: '3' }) === '{"type":"paid_day"}');
  t('断り: 種類なし・日付なし（休暇の理由は無くてよい＝DB 0125 と同じ・反証の 5）', !L1({ leaveType: '' }).ok && !L1({ leaveType: 'paid_day', date: '' }).ok && /休む日/.test(L1({ leaveType: 'paid_day', date: '' }).msg)
    && L1({ leaveType: 'paid_day', reason: ' ' }).ok && L1({ leaveType: 'paid_day', reason: ' ' }).req.reason === null);
  t('選べる種類: 時間単位は設定が true の時だけ', S.leaveTypeOptions(false).map((x) => x[0]).join() === 'paid_day,paid_half,special,comp,swap' && S.leaveTypeOptions(true).map((x) => x[0]).join() === 'paid_day,paid_half,hourly,special,comp,swap');
  const TY = [{ code: 'keicho', name: '慶弔', paid: true }];
  t('中身の言い方（契約: 有休（1日）／有休（半日）／有休（時間 n 時間）／特別休暇（種類名・半日）／代休（休日に働いた日 M/D）／振替（働く日 M/D））',
    S.leaveText({ type: 'paid_day' }, TY) === '有休（1日）' && S.leaveText({ type: 'paid_half' }, TY) === '有休（半日）' && S.leaveText({ type: 'hourly', minutes: 180 }, TY) === '有休（時間 3 時間）'
    && S.leaveText({ type: 'special', type_code: 'keicho', half: true }, TY) === '特別休暇（慶弔・半日）' && S.leaveText({ type: 'special', type_code: 'zz' }, TY) === '特別休暇（zz）'
    && S.leaveText({ type: 'comp', link_date: '2022-06-05' }, TY) === '代休（休日に働いた日 6/5）' && S.leaveText({ type: 'swap', link_date: '2022-06-12' }, TY) === '振替（働く日 6/12）');
  const lr = S.requestRow({ id: 'y', rev: 1, kind: 'leave', work_date: '2022-06-10', ym: '2022-06', body: { type: 'special', type_code: 'keicho' }, reason: '私用', status: 'pending' }, TY);
  t('申請の一覧の行: 種類「休暇」・休む日・中身', lr.kind === '休暇' && lr.when === '6/10（金）' && lr.what === '特別休暇（慶弔）' && lr.canWithdraw === true, lr);
  t('休暇の断りの文（時刻の文を出さない・技術の語なし）', S.errorText('badvalue', 'leave') !== S.errorText('badvalue', 'request') && S.errorText('exists', 'leave') === S.ERR_LEAVE.exists
    && S.errorText('locked', 'leave') === S.ERR.lockedday && S.errorText('toomany', 'leave') === S.ERR.reqlimit && Object.keys(S.ERR_LEAVE).every((k) => !/[a-z_]{4,}/.test(S.ERR_LEAVE[k])));
  const sh = read('kintai-self.html');
  t('画面: 申請の種類に「休暇」・種類・時間・特別休暇の種類・半日・結ぶ日の欄（label つき）', /<option value="leave">休暇/.test(sh) && ['rq-lt', 'rq-lh', 'rq-lc', 'rq-lhalf', 'rq-ll'].every((id) => sh.indexOf('id="' + id + '"') >= 0)
    && ['rq-lt', 'rq-lh', 'rq-lc', 'rq-ll'].every((id) => sh.indexOf('<label for="' + id + '"') >= 0) && /id="rq-lv-remain"/.test(sh));
}

group('4d. v6: 有給の残りから時間単位の有休を引く（v5 の積み残し (1)）');
{
  const lvH = Object.assign({}, lv, { months: lv.months.map((x) => Object.assign({}, x, { config: { hourlyPaidLeave: true } })),
    absences: [{ id: 'h1', date: '2022-05-20', kind: 'hourly_paid', minutes: 120, paid: true }, { id: 'h2', date: '2022-05-21', kind: 'hourly_paid', minutes: 60, voided_at: '2022-05-22T00:00:00Z' }, { id: 's1', date: '2022-05-23', kind: 'special', minutes: null, paid: true, type_code: 'keicho' }] });
  const smH = S.leaveOf(lvH, C, L, '2022-06-01');
  /* 管理画面（kintai.js の loadLeave）と同じ: 時間単位の行に職員の番号を付けて hourlyUses（1日8時間）→ uses に足して summary */
  const admH = L.summary({ hireDate: null, profile: null, grants: lv.grants, uses: adminUses.filter((u) => u.staff_id === SID).concat(L.hourlyUses(lvH.absences.map((a) => Object.assign({ staff_id: SID }, a)), 480)), asOf: '2022-06-01' });
  t('時間単位の2時間を引く（8日 − 2/8日 = 7.75 日・取り消した行と特別休暇は引かない）', smH && smH.balance.remain === 7.75, smH && smH.balance);
  t('管理画面の数え方と同じ結果', JSON.stringify(smH.balance) === JSON.stringify(admH.balance));
  t('1日の時間は設定の dayHours（人ごとの週の所定があればそれ）', S.dayMinOfLeave({ months: [{ ym: '2022-05', config: { dayHours: 6 } }] }, C, L) === 360 && S.dayMinOfLeave({ months: [] }, C, L) === 480
    && S.dayMinOfLeave({ profile: { weekly_days: 4, weekly_hours: 20 }, months: [] }, C, L) === 300);
  t('absences の無い古い受け口の答えは今までどおり（引かない）', S.leaveOf(Object.assign({}, lvH, { absences: undefined }), C, L, '2022-06-01').balance.remain === 8);
  t('知らせ（HOURLY_NOTE）は、時間単位を使う施設で absences が無い時だけ', S.hourlyNoteOn(Object.assign({}, lvH, { absences: undefined })) === true && S.hourlyNoteOn(lvH) === false && S.hourlyNoteOn(lv) === false);
  t('画面の残りは daysHm（「7 日 6 時間」）で出す', /function dTxt\(n\) \{ return L\.daysHm \? L\.daysHm\(n, S\.dayMinOfLeave\(leaveData, C, L\)\)/.test(read('kintai-self.js')) && L.daysHm(7.75, 480) === '7 日 6 時間'
    && /if \(S\.hourlyNoteOn\(leaveData\)\) box\.appendChild/.test(read('kintai-self.js')));
}

group('5. ファイルの決まり');
const html = read('kintai-self.html'), js = read('kintai-self.js'), css = read('kintai-self.css'), calc = read('kintai-self-calc.js');
const csp = (/http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
const ENDPOINT = 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/kintai-self';
t('CSP: 通信は受け口の住所1つだけ・スクリプトは自サイトだけ・object なし・base なし',
  csp.split(';').map((x) => x.trim()).indexOf('connect-src ' + ENDPOINT) >= 0 && /script-src 'self'(;|$)/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp)
  && !/unsafe-inline|unsafe-eval/.test(csp), csp);
t('画面の受け口の住所は CSP と同じ', js.indexOf("var ENDPOINT = '" + ENDPOINT + "'") >= 0);
const noComment = html.replace(/<!--[\s\S]*?-->/g, '');
t('直書きのスクリプトとイベント属性が無い', !/<script(?![^>]*\bsrc=)[^>]*>/i.test(noComment) && !/\son[a-z]+=/i.test(noComment));
t('共通ログインの部品（su-auth.js・supabase-js・su-app-gate.js）を読まない', !/su-auth\.js|supabase-js|su-app-gate\.js/.test(noComment));
const order = ['shift-symbols.js', 'kintai-calc.js', 'kintai-leave.js', 'kintai-self-calc.js', 'kintai-self.js', 'su-report.js'].map((f) => noComment.indexOf('src="' + f));
t('読み込みの順番: 記号 → 計算 → 有給 → 本人の計算 → 画面 → 不具合の報告', order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), order);
const ver = (src, f) => (new RegExp(f.replace('.', '\\.') + '\\?v=([^"]+)"').exec(src) || [])[1];
const adm = read('kintai.html');
t('共通の部品の版は勤怠の管理画面と同じ', ['shift-symbols.js', 'kintai-calc.js', 'kintai-leave.js', 'su-report.js'].every((f) => ver(noComment, f) && ver(noComment, f) === ver(adm, f)),
  ['shift-symbols.js', 'kintai-calc.js', 'kintai-leave.js', 'su-report.js'].map((f) => [f, ver(noComment, f), ver(adm, f)]));
t('不具合の報告ボタンを </body> の直前に置く', /<script src="su-report\.js\?v=[^"]+" data-tool="[^"]+"><\/script>\s*<\/body>/.test(html));
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
t('HTML の代入（innerHTML・outerHTML・insertAdjacentHTML・document.write）を使わない', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code(js) + code(calc)));
t('console・eval を使わない', !/\bconsole\.|\beval\(|new Function/.test(code(js) + code(calc)));
const lsKeys = [...code(js).matchAll(/(?:getItem|setItem|removeItem)\(\s*([A-Za-z_]+|'[^']*')/g)].map((x) => x[1]);
t('端末に置くのは鍵とタブの印だけ（localStorage の鍵は kintai_self_key・kintai_self_tab）',
  /var KEY_LS = 'kintai_self_key', TAB_LS = 'kintai_self_tab';/.test(js) && lsKeys.every((k) => k === 'k') && !/sessionStorage|indexedDB|document\.cookie/.test(code(js)), lsKeys);
t('lsSet で書くのは鍵とタブの印だけ', [...code(js).matchAll(/lsSet\(([A-Z_]+),/g)].every((x) => x[1] === 'KEY_LS' || x[1] === 'TAB_LS'));
t('住所の番号はすぐ消す（replaceState）', /history\.replaceState\(null, '', location\.pathname\)/.test(js));
t('閉じる・2分で、開いている印と中身をメモリと画面から捨てる', /function lock\(text\) \{[\s\S]*?open = null; months = \{\}; curYm = null; viewYm = null; leaveData = null; reqRows = null;[\s\S]*?clear\(\$\(id\)\)/.test(js)
  && /setTimeout\(function \(\) \{ lock\(/.test(js) && /\$\('b-close'\)\.addEventListener\('click', function \(\) \{ lock\(''\); \}\)/.test(js));
t('開いている印・暗証番号は端末に置かない（lsSet に open・pin を渡さない）', !/lsSet\([^)]*(open|pin)/i.test(code(js)));
t('印刷しない（@media print で画面の中身を全部隠す）', /@media print \{\s*body \* \{ display: none !important; \}/.test(css));
t('押す所 44px 以上・入力の文字 16px', /\.btn \{[^}]*min-height: 44px;[^}]*min-width: 44px;/.test(css) && /input, select, textarea \{[^}]*font-size: 16px;[^}]*min-height: 44px;/.test(css)
  && /\.tab \{[^}]*min-height: 48px;/.test(css));
t('暗い表示の色を持つ（prefers-color-scheme: dark）', /@media \(prefers-color-scheme: dark\)/.test(css) && /<meta name="color-scheme" content="light dark">/.test(html));
const gi = read('.gitignore');
t('公開の許可（.gitignore のホワイトリスト）に4つのファイルがある', ['kintai-self.html', 'kintai-self.js', 'kintai-self-calc.js', 'kintai-self.css'].every((f) => gi.indexOf('!/' + f + '\n') >= 0));
t('[hidden] は必ず隠れる', /\[hidden\] \{ display: none !important; \}/.test(css));

/* 色の差（文字と地 4.5:1 以上・明るい表示と暗い表示） */
function lum(hex) { const c = hex.replace('#', ''); const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function vars(block) { const o = {}; for (const m2 of block.matchAll(/--([a-z-]+): (#[0-9a-f]{6})/g)) o[m2[1]] = m2[2]; return o; }
const light = vars(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = vars(css.slice(darkAt, css.indexOf('}', css.indexOf(':root {', darkAt))));
const PAIRS = [['tx', 'bg'], ['tx', 'card'], ['mut', 'card'], ['mut', 'bg'], ['pri', 'card'], ['pri-tx', 'pri'], ['ok', 'ok-l'], ['ng', 'ng-l'], ['warn', 'warn-l'], ['pri', 'pri-l']];
for (const [nm, set] of [['明るい表示', light], ['暗い表示', dark]]) {
  const bad = PAIRS.filter(([a, b]) => !(set[a] && set[b] && ratio(set[a], set[b]) >= 4.5)).map(([a, b]) => a + '/' + b + '=' + (set[a] && set[b] ? ratio(set[a], set[b]).toFixed(2) : '?'));
  t(nm + ': 文字と地の差はどれも 4.5:1 以上', bad.length === 0, bad);
}

say('— 2026-11-27: 確かめが要る日・見た目の直し —');
{
  const J = read('kintai-self.js'), CSS = read('kintai-self.css'), H = read('kintai-self.html');
  t('確かめが要る日は、日の札（S.dayRows の flags）と計算の部品の C.REVIEW・C.FLAG_LABEL から数える（計算の部品を変えず、判定を2つに分けない）・確認済みの日と先の日は数えない',
    /function needDays\(rows\) \{[\s\S]*?\(C && C\.REVIEW\)[\s\S]*?\(C && C\.FLAG_LABEL\)[\s\S]*?!r\.future && r\.flags\.some[\s\S]*?r\.flags\.indexOf\(chk\) < 0/.test(J) && /paintNeed\(needDays\(rows\)\);/.test(J));
  t('帯は日付を3つまで・それ以上は「ほか n 日」・押すとその日の箱へ（画面の中だけの印 data-date）・textContent の部品で作る',
    /need\.slice\(0, 3\)/.test(J) && /' ほか ' \+ \(need\.length - 3\) \+ ' 日'/.test(J) && /'確かめが要る日が ' \+ need\.length \+ ' 日あります（' \+ shown \+ '）'/.test(J) && /c\.setAttribute\('data-date', r\.date\)/.test(J) && !/innerHTML/.test(J));
  t('帯の箱は月の合計の箱の上（月の切り替えの下）・閉じる時に捨てる', /<div id="need-box" class="need-box" role="status" hidden><\/div>\s*<div class="cd" id="days-head"><\/div>/.test(H) && /clear\(\$\('need-box'\)\); \$\('need-box'\)\.hidden = true;/.test(J));
  t('予定も打刻も無い月は合計を出さずに空の箱だけ', /if \(!rows\.length\) \{ head\.appendChild\(el\('p', 'muted empty', 'この月分の予定と打刻はまだありません。'\)\); return; \}/.test(J));
  t('月の切り替えは塗らない（淡い地と下線）・塗りは上のタブだけ', /\.seg \.btn\[aria-pressed="true"\] \{ background: var\(--pri-l\);/.test(CSS) && !/\.seg \.btn\[aria-pressed="true"\] \{ background: var\(--pri\);/.test(CSS));
  /* 審査役の指摘（2026-11-27）: 時間単位の有休の注意は、残りの数を読み違えないよう黄の箱に戻した。黄の箱はこの2つまで・年5日は注記のまま */
  t('有給: 黄の箱は「いちばん早く消える残り」と時間単位の有休の注意の2つだけ（年5日は注記）', (J.match(/'msg warn'/g) || []).length === 2 && /el\('p', 'msg warn', 'いちばん早く消える残り: '/.test(J) && /el\('p', 'msg warn', S\.HOURLY_NOTE\)/.test(J) && /v\.ob5Warn \? 'help em' : 'muted'/.test(J));
  t('帯で送る先の日の箱は、見出しの高さ（--hdr-h・画面が測る）の分だけ下で止める', /\.day \{ scroll-margin-top: calc\(var\(--hdr-h, 112px\) \+ 8px\); \}/.test(CSS) && /function syncHdr\(\)/.test(J) && /syncHdr\(\); t\.scrollIntoView/.test(J));
}

say('— 2026-11-27: 今月の箱の夜勤の回数と有給の残り・日の種類の札（代表者の決定 2026-11-27） —');
{
  const J = read('kintai-self.js'), CSS = read('kintai-self.css');
  const P = { from: '2022-05-01', to: '2022-05-31' }, ST = [{ staff_id: SID, office: 'facility', active: true }];
  const nightRow = (d, d2, sym) => ({ staff_id: SID, work_date: d, seq: 0, office: 'facility', start_at: d + 'T21:00:00+09:00', end_at: d2 + 'T07:00:00+09:00', break_min: 120, kind: 'night', symbol: sym || '(21', paid_min: 0 });
  const workRow = (d) => ({ staff_id: SID, work_date: d, seq: 0, office: 'facility', start_at: d + 'T09:00:00+09:00', end_at: d + 'T18:00:00+09:00', break_min: 60, kind: 'work', symbol: '日1', paid_min: 0 });
  const paidRow = (d) => ({ staff_id: SID, work_date: d, seq: 0, office: 'facility', start_at: null, end_at: null, break_min: 0, kind: 'paid', symbol: '有', paid_min: 480 });
  const pin = (id, d, hh) => ({ id: id, staff_id: SID, kind: 'in', at: d + 'T' + hh + '+09:00', source: 'tablet', created_at: d + 'T' + hh + '+09:00' });
  const pout = (id, d, hh) => ({ id: id, staff_id: SID, kind: 'out', at: d + 'T' + hh + '+09:00', source: 'tablet', created_at: d + 'T' + hh + '+09:00' });
  const NOW = Date.parse('2022-06-05T12:00:00+09:00');
  /* 期間の前の日（4/30）に入った夜勤・5/10 に入って 5/11 に明ける夜勤・期間の最終日（5/31）に入る夜勤・先の予定の夜勤（打刻なし）・有給の日・半日・時間単位・休暇 */
  const schedule = [nightRow('2022-04-30', '2022-05-01'), paidRow('2022-05-01'), nightRow('2022-05-10', '2022-05-11'), paidRow('2022-05-11'), workRow('2022-05-12'),
    nightRow('2022-05-20', '2022-05-21'), nightRow('2022-05-31', '2022-06-01')];
  const punches = [pin('n0', '2022-04-30', '20:55:00'), pout('n1', '2022-05-01', '07:05:00'), pin('n2', '2022-05-10', '20:55:00'), pout('n3', '2022-05-11', '07:05:00'),
    pin('w1', '2022-05-12', '08:55:00'), pout('w2', '2022-05-12', '18:05:00'), pin('n4', '2022-05-31', '20:55:00'), pout('n5', '2022-06-01', '07:05:00')];
  const absences = [{ id: 'a1', date: '2022-05-13', kind: 'hourly_paid', minutes: 120, paid: true, type_code: null, link_date: null },
    { id: 'a2', date: '2022-05-14', kind: 'special', minutes: null, paid: true, type_code: 'keicho', link_date: null },
    { id: 'a3', date: '2022-05-15', kind: 'special', minutes: 240, paid: false, type_code: 'other', link_date: null },
    { id: 'a4', date: '2022-05-16', kind: 'comp', minutes: null, paid: false, type_code: null, link_date: '2022-05-08' },
    { id: 'a5', date: '2022-05-17', kind: 'swap', minutes: null, paid: false, type_code: null, link_date: '2022-05-22' }];
  const leaveUses = [{ id: 'u1', staff_id: SID, use_date: '2022-05-18', days: 0.5, voided_at: null }];
  const mon = { period: P, staff: ST, schedule: schedule, punches: punches, days: [], leave_uses: leaveUses, absences: absences, month: null, settings: { config: {} } };
  const mm = S.computeOf(mon, '2022-05', C, NOW);
  const tt = S.monthTotals(mm);
  const dir = C.computeMonth({ ym: '2022-05', period: P, staff: ST, schedule: schedule, punches: punches, days: [], leave_uses: leaveUses,
    absences: absences.map((a) => Object.assign({ staff_id: SID }, a)), config: {}, now: NOW });
  t('夜勤の回数は computeMonth の nightShiftCount のまま（数え方を新しく作らない）', tt.nightCount === dir.people[0].sum.nightShiftCount, { tt, n: dir.people[0].sum.nightShiftCount });
  t('夜勤の回数: 入りの日の月分で数える＝期間の前の日（4/30）に入った夜勤は入れず、5/10 と期間の最終日（5/31）に入る夜勤は数え、働いていない先の予定（5/20）は入れない＝2回', tt.nightCount === 2, tt);
  /* 締めた月分は締めた時の設定で数える（computeOf）。回数も computeMonth を締めた時の設定で直接呼んだ合計と同じ */
  const lockedMon = Object.assign({}, mon, { month: { locked_at: '2022-06-02T00:00:00Z', snapshot: { config: { nightBreakH: 1 } } } });
  const mL = S.computeOf(lockedMon, '2022-05', C, NOW);
  const dirL = C.computeMonth({ ym: '2022-05', period: P, staff: ST, schedule: schedule, punches: punches, days: [], leave_uses: leaveUses,
    absences: absences.map((a) => Object.assign({ staff_id: SID }, a)), config: { nightBreakH: 1 }, lockedAt: '2022-06-02T00:00:00Z', now: NOW });
  t('締めた月分: 夜勤の回数は締めた時の設定で computeMonth を直接呼んだ合計と同じ', S.monthTotals(mL).nightCount === dirL.people[0].sum.nightShiftCount && S.monthTotals(mL).nightCount === 2);
  t('今月の箱の合計の形（実働・出勤・有休・予定を超えた時間は今のまま・夜勤の回数を足す）', JSON.stringify(Object.keys(tt)) === JSON.stringify(['workMin', 'workDays', 'paidDays', 'overtimeMin', 'nightCount']));

  const rr = S.dayRows(mm, C, '2022-06-05');
  const kd = (d) => { const r = rr.find((x) => x.date === d); return r ? r.kinds.map((k) => k.k + ':' + k.t).join(',') : null; };
  t('日をまたぐ夜勤: 入りの日（5/10）に「夜勤」', kd('2022-05-10') === 'night:夜勤', kd('2022-05-10'));
  t('明け: 夜勤の明けの日に箱が出る時（5/11 は有給の日）は「明け」と「有給」', kd('2022-05-11') === 'ake:明け,off:有給', kd('2022-05-11'));
  t('期間の初日（5/1）の明けは、前の夜勤が期間の前の日の側で分からない＝明けの札を付けない（有給だけ）', kd('2022-05-01') === 'off:有給', kd('2022-05-01'));
  t('普段の勤務（夜勤でない予定）には札を付けない', kd('2022-05-12') === '', kd('2022-05-12'));
  t('先の予定の夜勤（5/20）も予定の種類として「夜勤」・期間の最終日に入る夜勤（5/31）も「夜勤」', kd('2022-05-20') === 'night:夜勤' && kd('2022-05-31') === 'night:夜勤', [kd('2022-05-20'), kd('2022-05-31')]);
  t('明けだけの日（5/21・6/1 の側）は日の行が無い＝箱も札も出ない', kd('2022-05-21') === null);
  t('有給の時間単位「有給 時間」・特別休暇・特別休暇 半日（無給でも種類だけ）・代休・振替休日', kd('2022-05-13') === 'off:有給 時間' && kd('2022-05-14') === 'off:特別休暇'
    && kd('2022-05-15') === 'off:特別休暇 半日' && kd('2022-05-16') === 'off:代休' && kd('2022-05-17') === 'off:振替休日', ['13', '14', '15', '16', '17'].map((x) => kd('2022-05-' + x)));
  t('有給の半日（手入力の 0.5 日）は「有給 半日」', kd('2022-05-18') === 'off:有給 半日', kd('2022-05-18'));
  t('締めた月分でも札は同じ', JSON.stringify(S.dayRows(mL, C, '2022-06-05').map((r) => r.kinds)) === JSON.stringify(rr.map((r) => r.kinds)));
  t('札の純関数: 分からない日・崩れた日は空・振替で働く日は札なし・同じ札は1つ',
    S.dayKinds(null, {}).length === 0 && S.dayKinds({ date: '2022-05-01' }, null).length === 0
    && S.dayKinds({ date: '2022-05-02', blocks: [], absences: [{ kind: 'swap', role: 'work', date: '2022-05-09' }, null, 'x'] }, {}).length === 0
    && S.dayKinds({ date: '2022-05-03', blocks: [{ night: true, schedStart: 1 }, { night: true, schedStart: 2 }], paidDays: 0 }, {}).length === 1
    && S.dayKinds({ date: '2022-05-03', blocks: [{ night: true, schedStart: null }] }, {}).length === 0);
  t('明けの日は夜勤の塊の予定の終わりの日（ちょうど0時に終わる夜勤は入りの日のまま）',
    JSON.stringify(S.nightEndsOf([{ date: '2022-05-10', blocks: [{ night: true, schedEnd: Date.parse('2022-05-11T07:00:00+09:00') }] }])) === '{"2022-05-11":true}'
    && JSON.stringify(S.nightEndsOf([{ date: '2022-05-10', blocks: [{ night: true, schedEnd: Date.parse('2022-05-11T00:00:00+09:00') }, { night: false, schedEnd: Date.parse('2022-05-11T07:00:00+09:00') }] }])) === '{}');
  t('画面: 今月の箱に「夜勤の回数」の行・「有給の残り」は有給のタブと同じ数え方（S.leaveView(S.leaveOf(…))）と同じ出し方（dTxt・1日の時間も同じ答えから）で、今月分の箱だけ',
    /\['夜勤の回数', tot\.nightCount \+ ' 回'\]/.test(J) && /if \(ym === curYm\) paintLeaveRemain\(t, head\);/.test(J)
    && /function leaveViewNow\(lv\) \{\s*try \{ return S\.leaveView\(S\.leaveOf\(lv \|\| leaveData, C, L, S\.todayOf\(Date\.now\(\)\)\)\); \}/.test(J)
    && /function dTxtOf\(n, lv\) \{ return L\.daysHm \? L\.daysHm\(n, S\.dayMinOfLeave\(lv, C, L\)\) : n \+ ' 日'; \}/.test(J)
    && /el\('span', null, '有給の残り'\)\); row\.appendChild\(el\('b', null, dTxtOf\(v\.remain, lv\)\)\)/.test(J) && /box\.appendChild\(el\('p', 'big', dTxt\(v\.remain\)\)\);/.test(J));
  t('画面: 箱の有給の読み取りは1本にまとめ・有給のタブの控えには入れない（有給のタブは今までどおり押した時に読む）・閉じる時に捨てる・断りの文を出さない・時間単位の注意も添える',
    /if \(!boxWait\) \{ var w = boxWait = call\('leave'/.test(J) && /monthWait = \{\}; boxLeave = null; boxWait = null;/.test(J) && /if \(r\.ok !== true\) \{ handleAuth\(r\); return null; \}\s*boxLeave = r;/.test(J)
    && !/leaveData = r;[\s\S]*boxLeave = r;[\s\S]*leaveData = /.test(J) && /if \(!lv \|\| my !== gen \|\| viewYm !== ym0 \|\| !t\.isConnected\) return;/.test(J) && /S\.hourlyNoteOn\(lv\)\) t\.parentNode\.insertBefore\(el\('p', 'help', S\.HOURLY_NOTE\)/.test(J));
  t('画面: 札は日付の横（.d の中の先頭の span）に textContent の部品で出す・色は今の変数だけ',
    /var lb = el\('span', 'dl0', r\.label\);\s*\(r\.kinds \|\| \[\]\)\.forEach\(function \(k\) \{ lb\.appendChild\(el\('span', 'kd kd-' \+ k\.k, k\.t\)\); \}\);/.test(J)
    && /\.kd-night \{ background: var\(--pri-l\); color: var\(--pri\); \}/.test(CSS) && /\.kd-off \{ background: var\(--ok-l\); color: var\(--ok\); \}/.test(CSS)
    && !/\.kd[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(CSS));
}

say('\n' + (ng ? '✗ 失敗 ' + ng + ' 件' : '✓ 全部合格') + '（' + ok + ' 件合格）');
process.exit(ng ? 1 : 0);
