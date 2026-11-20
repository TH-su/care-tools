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

say('\n' + (ng ? '✗ 失敗 ' + ng + ' 件' : '✓ 全部合格') + '（' + ok + ' 件合格）');
process.exit(ng ? 1 : 0);
