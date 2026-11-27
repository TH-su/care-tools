/* 週間計画の計画の版（care-plan-calc.js）の純関数の試験（2026-11-27）
   実行: node check/unit/care_plan_calc_test.js（環境変数 CARE_PLAN_CALC で別の版を当てられる）
   守りたいこと:
     1. 予約の無いデータでは、どの関数も何も変えない（events・careLevel を1バイトも変えず、項目も足さない）（受入条件 A1）
     2. 切替（applyDue）は同じ入力で同じ出力。2台が別々に・並びの違う配列で切り替えても一字一句同じ。予定の id は予約のまま（A2）
     3. planGen の小さい側の未送信の編集は、統合で大きい側を上書きしない。取り消した予約・切り替え済みの予約を生き返らせない（A3）
     4. 介護度の決まり（resolveLevel）の表の全行と境目（切替日の前日・当日・翌日・マスタが空・つながっていない）（A4）
     5. 「今日」は日本時間の暦の日付。実在しない日付は日付と認めない
     6. 形の崩れた入力で例外を出さない。引数を書き換えない
   ★氏名・予定はすべて架空。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.CARE_PLAN_CALC || path.join(ROOT, 'care-plan-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const J = (x) => JSON.stringify(x);
const cp = (x) => JSON.parse(JSON.stringify(x));
function deepFreeze(o) { if (o && typeof o === 'object') { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }

function ev(id, dow, st, en, extra) { return Object.assign({ id, dayOfWeek: dow, serviceType: 'visit', category: '身体1', startTime: st, endTime: en, detail: '架空の支援', notes: '', units: 0, bathing: false }, extra || {}); }
const CUR_EVENTS = [ev('e1', 1, '09:00', '09:30'), ev('e2', 3, '14:00', '14:30')];
function resNoPlan() { return { id: 'r1', name: '架空 一郎', careLevel: '要介護2', events: cp(CUR_EVENTS) }; }
function plan(id, from, careLevel, baseLevel, events, extra) {
  return Object.assign({ id, from, careLevel, baseLevel, events, note: '架空のメモ ' + id, createdAt: '2026-11-01T00:00:00.000Z', createdBy: '架空 花子', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: '架空 花子' }, extra || {});
}
function resWithPlans() {
  const r = resNoPlan();
  r.planFrom = '2026-04-01'; r.planGen = 3; r.planLevel = ''; r.planNote = '';
  r.nextPlans = [
    plan('pl_b', '2026-12-10', '', '要介護2', [ev('e1', 1, '09:00', '09:30'), ev('e9', 5, '10:00', '10:30')]),
    plan('pl_a', '2026-12-01', '要介護3', '要介護2', [ev('e1', 1, '09:00', '10:00'), ev('e2', 3, '14:00', '14:30')]),
    plan('pl_c', '2027-01-15', '要介護4', '要介護3', [ev('e1', 2, '09:00', '09:30')])
  ];
  r.planGone = [];
  return r;
}

console.log('■ 日付');
{
  t('1-1 UTC 14:59 は日本の同じ日', C.todayJst(Date.UTC(2026, 10, 30, 14, 59, 59)) === '2026-11-30', C.todayJst(Date.UTC(2026, 10, 30, 14, 59, 59)));
  t('1-2 UTC 15:00 で日本の日付が翌日になる', C.todayJst(Date.UTC(2026, 10, 30, 15, 0, 0)) === '2026-12-01', C.todayJst(Date.UTC(2026, 10, 30, 15, 0, 0)));
  t('1-3 年の境目（UTC 12/31 15:00 → 日本の 1/1）', C.todayJst(Date.UTC(2026, 11, 31, 15, 0, 0)) === '2027-01-01');
  t('1-4 読めない時刻は空', C.todayJst(NaN) === '' && C.todayJst('x') === '');
  t('1-5 isYmd: 実在する日付だけ', C.isYmd('2026-02-28') && !C.isYmd('2026-02-30') && !C.isYmd('2026-13-01') && !C.isYmd('2026-00-10') && !C.isYmd('2026-1-01') && !C.isYmd('') && !C.isYmd(null) && !C.isYmd(20260101));
  t('1-6 isYmd: うるう年', C.isYmd('2028-02-29') && !C.isYmd('2027-02-29'));
}

console.log('■ A1 予約の無いデータは何も変えない');
{
  const r = resNoPlan(); const before = J(r);
  deepFreeze(r);
  const a = C.applyDue(r, '2026-12-05', '2026-12-05T00:00:00Z');
  t('A1-1 applyDue: changed=false・steps 0・res は元と一字一句同じ（項目を足さない）', a.changed === false && a.steps.length === 0 && J(a.res) === before, J(a.res));
  t('A1-2 eventsFor は現行の events', J(C.eventsFor(r, '2026-12-05')) === J(CUR_EVENTS));
  t('A1-3 levelFor は今の介護度', C.levelFor(r, '2026-12-05') === '要介護2');
  const m = C.mergePlans(r, cp(r));
  t('A1-4 mergePlans: 同じ利用者どうしは元と一字一句同じ・tookGen same', J(m.res) === before && m.tookGen === 'same' && m.droppedMine === 0, J(m.res));
  const mine = cp(r); mine.events[0].startTime = '09:15';
  const m2 = C.mergePlans(r, mine);
  t('A1-5 mergePlans: 世代が同じなら events はサーバーのまま（id 単位の統合は呼び出し側）', J(m2.res) === before && m2.tookGen === 'same');
  const noEv = { id: 'r2', careLevel: '' }; const nb = J(noEv);
  t('A1-6 events の無い利用者にも項目を足さない', J(C.applyDue(noEv, '2026-12-05').res) === nb && J(C.mergePlans(noEv, cp(noEv)).res) === nb);
  const n = C.normPlans(r);
  t('A1-7 normPlans: 予約0件・落とした数0', n.plans.length === 0 && n.dropped === 0);
  const s = C.planSummary(r, '2026-12-05');
  t('A1-8 planSummary: 現行だけ・予約0件', s.next.length === 0 && s.current.count === 2 && s.current.careLevel === '要介護2' && s.dueCount === 0 && s.nextFrom === '');
  const lv = C.resolveLevel({ cur: '要介護2', master: '要介護2', planLevel: '', next: undefined, today: '2026-12-05' });
  t('A1-9 resolveLevel: マスタと同じ・知らせなし', lv.level === '要介護2' && lv.hold === false && lv.notice === null);
  t('A1-10 呼んだ後も引数は同じ', J(r) === before);
}

console.log('■ eventsFor・levelFor');
{
  const r = resWithPlans();
  t('2-1 最初の予約の前日は現行', J(C.eventsFor(r, '2026-11-30')) === J(CUR_EVENTS) && C.levelFor(r, '2026-11-30') === '要介護2');
  t('2-2 最初の予約の当日はその予約', C.eventsFor(r, '2026-12-01')[0].endTime === '10:00' && C.levelFor(r, '2026-12-01') === '要介護3');
  t('2-3 2つ目の予約（介護度が空）は events だけ変わり介護度は前の予約の値', C.eventsFor(r, '2026-12-10')[1].id === 'e9' && C.levelFor(r, '2026-12-10') === '要介護3');
  t('2-4 3つ目の予約', C.eventsFor(r, '2027-02-01')[0].dayOfWeek === 2 && C.levelFor(r, '2027-02-01') === '要介護4');
  t('2-5 日付が読めない時は現行', J(C.eventsFor(r, '2026/12/01')) === J(CUR_EVENTS) && C.levelFor(r, 'x') === '要介護2');
}

console.log('■ applyDue（A2）');
{
  const r = resWithPlans(); const before = J(r); deepFreeze(r);
  const expEv = C.eventsFor(r, '2026-12-15'), expLv = C.levelFor(r, '2026-12-15');
  const a = C.applyDue(r, '2026-12-15', '2026-12-15T01:00:00Z');
  t('3-1 期日を過ぎた2つが古い順に入れ替わり steps 2件', a.changed && a.steps.length === 2 && a.steps[0].planId === 'pl_a' && a.steps[1].planId === 'pl_b', a.steps.map((s) => s.planId));
  t('3-2 planGen が +2', a.res.planGen === 5, a.res.planGen);
  t('3-3 未来の予約は残る', a.res.nextPlans.length === 1 && a.res.nextPlans[0].id === 'pl_c');
  t('3-4 切替後の events・介護度は当てる前の eventsFor・levelFor と同じ', J(a.res.events) === J(expEv) && a.res.careLevel === expLv);
  t('3-5 予定の id は予約に入っていたまま', a.res.events.map((e) => e.id).join(',') === 'e1,e9');
  t('3-6 介護度が空の予約は介護度を変えない（pl_b の後も要介護3）', a.res.careLevel === '要介護3' && a.steps[1].level === '要介護3' && a.res.planLevel === '');
  t('3-7 planFrom・planNote は最後に入れ替えた予約', a.res.planFrom === '2026-12-10' && a.res.planNote === '架空のメモ pl_b');
  t('3-8 steps に前の計画（prevFrom・prevLevel・prevEvents）と終わりの日', a.steps[0].prevFrom === '2026-04-01' && a.steps[0].prevLevel === '要介護2' && J(a.steps[0].prevEvents) === J(CUR_EVENTS)
    && a.steps[0].to === '2026-11-30' && a.steps[1].prevFrom === '2026-12-01' && a.steps[1].prevLevel === '要介護3' && a.steps[1].prevEvents[0].endTime === '10:00' && a.steps[0].level === '要介護3');
  t('3-9 引数を書き換えていない', J(r) === before);
  const b = C.applyDue(cp(r), '2026-12-15', '2026-12-15T05:59:00Z');
  t('3-10 別々の写し・別の時刻で当てても JSON が一字一句同じ', J(a.res) === J(b.res) && J(a.steps) === J(b.steps));
  const rev = cp(r); rev.nextPlans.reverse();
  const c = C.applyDue(rev, '2026-12-15', 'z');
  t('3-11 予約の並びが違っても同じ答え', J(c.res) === J(a.res) && J(c.steps) === J(a.steps));
  const early = C.applyDue(r, '2026-12-01', 'z'), earlyRev = C.applyDue(rev, '2026-12-01', 'z');
  t('3-11b 残る予約が2件以上でも、並びの違う入力から同じ答え（残りは from の昇順）', J(early.res) === J(earlyRev.res) && early.res.nextPlans.map((p) => p.id).join(',') === 'pl_b,pl_c', early.res.nextPlans.map((p) => p.id));
  const again = C.applyDue(a.res, '2026-12-15', 'z');
  t('3-12 切り替えた後にもう一度当てても何も変わらない', again.changed === false && J(again.res) === J(a.res));
  const one = C.applyDue(r, '2026-12-01', 'z');
  t('3-13 切替日の当日に切り替わる・前日は切り替わらない', one.steps.length === 1 && one.res.careLevel === '要介護3' && C.applyDue(r, '2026-11-30', 'z').changed === false);
  const longNote = cp(r); longNote.nextPlans[1].note = 'あ'.repeat(120);
  t('3-14 planNote は80字まで', C.applyDue(longNote, '2026-12-01').res.planNote.length === 80);
  const dupFrom = resNoPlan(); dupFrom.nextPlans = [plan('pl_x', '2026-12-01', '要介護3', '要介護2', [ev('x1', 1, '08:00', '08:30')], { updatedAt: '2026-11-02T00:00:00Z' }), plan('pl_y', '2026-12-01', '要介護4', '要介護2', [ev('y1', 1, '08:00', '08:30')], { updatedAt: '2026-11-05T00:00:00Z' })];
  const d1 = C.applyDue(dupFrom, '2026-12-01'), dRev = cp(dupFrom); dRev.nextPlans.reverse();
  t('3-15 同じ from の予約は updatedAt の新しい方だけ・負けた方も外れる・並びに依らない', d1.steps.length === 1 && d1.steps[0].planId === 'pl_y' && d1.res.nextPlans.length === 0 && J(C.applyDue(dRev, '2026-12-01').res) === J(d1.res));
  const gone = cp(r); gone.planGone = [{ id: 'pl_a', at: '2026-11-03T00:00:00Z' }];
  const g1 = C.applyDue(gone, '2026-12-05');
  t('3-16 planGone にある予約は切り替えない', g1.changed === false);
  t('3-17 今日が読めない時は切り替えない', C.applyDue(r, '', 'z').changed === false && C.applyDue(r, '2026/12/15').changed === false);
}

console.log('■ A4 resolveLevel の表');
{
  const N = [plan('pl_n', '2026-12-01', '要介護3', '要介護2', [])];
  const R = (o) => C.resolveLevel(Object.assign({ cur: '要介護2', master: '要介護3', planLevel: '', next: N, today: '2026-11-20' }, o));
  const a = R({ master: undefined });
  t('4-1 マスタとつながっていない（undefined）→ cur・hold なし・知らせなし', a.level === '要介護2' && a.hold === false && a.notice === null);
  const a2 = C.resolveLevel({ cur: '要介護2', next: N, today: '2026-11-20' });
  t('4-1b master の項目が無い時も同じ', a2.level === '要介護2' && a2.hold === false && a2.notice === null);
  const b = R({ master: '' }), b2 = R({ master: null });
  t('4-2 マスタが空（\'\'・null）→ cur・hold なし・知らせなし', b.level === '要介護2' && !b.hold && b.notice === null && b2.level === '要介護2' && !b2.hold && b2.notice === null);
  const h = R({});
  t('4-3 次の予約の介護度にマスタが先に変わった → cur を保つ・hold・知らせ hold', h.level === '要介護2' && h.hold === true && J(h.notice) === J({ kind: 'hold', master: '要介護3', planned: '要介護3', from: '2026-12-01' }), h);
  const hPrev = R({ today: '2026-11-30' }), hDay = R({ today: '2026-12-01' }), hNext = R({ today: '2026-12-02' });
  t('4-4 切替日の前日は hold', hPrev.hold === true && hPrev.level === '要介護2');
  /* 2026-11-27 決まりの変更（反証レビュー A3）: 切替日を過ぎても、まだ切り替わっていない間は hold を保つ。切替が済めば予約が消えて終わる */
  t('4-5 切替日の当日も、まだ切り替わっていなければ hold を保つ', hDay.hold === true && hDay.level === '要介護2' && hDay.notice.kind === 'hold', hDay);
  t('4-6 切替日の翌日も、まだ切り替わっていなければ hold を保つ', hNext.hold === true && hNext.level === '要介護2');
  const afterSw = R({ next: [], today: '2026-12-02', cur: '要介護3' });
  t('4-6b 切替が済んで予約が消えたら hold は終わる（マスタが正）', afterSw.hold === false && afterSw.level === '要介護3' && afterSw.notice === null);
  const nc = R({ cur: '要介護1' });
  t('4-7 cur が baseLevel と違う時は hold しない → master', nc.hold === false && nc.level === '要介護3');
  const same = R({ next: [plan('pl_s', '2026-12-01', '要介護3', '要介護3', [])], cur: '要介護3' });
  t('4-8 予約の介護度が baseLevel と同じ時は hold しない', same.hold === false && same.level === '要介護3' && same.notice === null);
  const other = R({ master: '要介護4' });
  t('4-9 マスタが予約の介護度と違う → master（hold しない）', other.hold === false && other.level === '要介護4' && other.notice === null);
  const none = R({ next: [] }), noneU = R({ next: undefined });
  t('4-10 次の予約が無い → master', none.level === '要介護3' && !none.hold && noneU.level === '要介護3' && !noneU.hold);
  const mm = R({ next: [], planLevel: '要介護2', planFrom: '2026-10-01' });
  t('4-11 planLevel があり master と違う → master・知らせ mismatch', mm.level === '要介護3' && !mm.hold && J(mm.notice) === J({ kind: 'mismatch', master: '要介護3', planned: '要介護2', from: '2026-10-01' }), mm);
  const mmNoFrom = R({ next: [], planLevel: '要介護2' });
  t('4-11b mismatch の from は planFrom が無ければ空', mmNoFrom.notice && mmNoFrom.notice.from === '');
  const ms = R({ next: [], planLevel: '要介護3' });
  t('4-12 planLevel が master と同じ → 知らせなし', ms.level === '要介護3' && ms.notice === null);
  const emp = C.resolveLevel({ cur: '', master: '要支援1', planLevel: '', next: [plan('pl_e', '2026-12-01', '要支援1', '', [])], today: '2026-11-20' });
  t('4-13 baseLevel・cur が未設定（事業対象者の運用）でも hold が成り立つ', emp.hold === true && emp.level === '' && emp.notice.kind === 'hold');
  const minN = R({ next: [plan('pl_late', '2027-03-01', '要介護4', '要介護2', []), plan('pl_early', '2026-12-01', '要介護3', '要介護2', [])] });
  t('4-14 次の予約は from が最小のもの（並びに依らない）', minN.hold === true && minN.notice.from === '2026-12-01');
  const past = R({ next: [plan('pl_p', '2026-11-01', '要介護3', '要介護2', [])] });
  t('4-15 切替日を過ぎてまだ切り替わっていない予約も「次の予約」に入る（hold を保つ・決まりの変更 A3）', past.hold === true && past.level === '要介護2' && past.notice.from === '2026-11-01', past);
  const numLv = R({ next: [plan('pl_num', '2026-12-01', 3, '要介護2', [])] });
  t('4-18 予約の介護度が文字でない時は空とみなす（hold しない → master）', numLv.hold === false && numLv.level === '要介護3');
  const gone = R({ next: [Object.assign(plan('pl_g2', '2026-12-01', '要介護3', '要介護2', []))] });
  t('4-19 （対照）同じ予約で文字の介護度なら hold', gone.hold === true);
  const raw = R({ cur: '要介護2 ', master: '要介護3' });
  t('4-16 介護度は文字のまま比べる（cur の後ろの空白を取らない＝baseLevel と別の値で hold しない）', raw.level === '要介護3' && raw.hold === false);
  const single = R({ next: N[0] });
  t('4-17 next に予約1件を渡しても同じ', single.hold === true);
}

console.log('■ mergePlans（A3）');
{
  /* サーバーが切り替え済み（gen 4）・自分は古い（gen 3）で現行の予定を直した未送信を持つ */
  const old = resWithPlans(); // gen 3
  const server = C.applyDue(old, '2026-12-01').res; // gen 4・pl_a が現行・pl_b と pl_c が残る
  const mine = cp(old); mine.events[0].startTime = '09:15'; mine.events.push(ev('e_new', 6, '11:00', '11:30'));
  const sB = J(server), mB = J(mine);
  deepFreeze(server); deepFreeze(mine);
  const m1 = C.mergePlans(server, mine);
  t('5-1 server>mine: 大きい側（サーバー）の events・planFrom・planGen・介護度', m1.tookGen === 'server' && J(m1.res.events) === J(server.events) && m1.res.planGen === 4 && m1.res.planFrom === '2026-12-01' && m1.res.careLevel === '要介護3');
  /* mine.events = e1（直した）・e2・e_new。server.events = e1・e2（pl_a の中身・e1 は 09:00-10:00） */
  t('5-2 server>mine: 捨てた自分の予定の数（中身が違う・サーバーに無い）', m1.droppedMine === 2, m1.droppedMine);
  t('5-3 server>mine: 切り替え済みの予約（pl_a）を古い側から生き返らせない', !m1.res.nextPlans.some((p) => p.id === 'pl_a') && m1.res.nextPlans.map((p) => p.id).join(',') === 'pl_b,pl_c');
  t('5-4 引数を書き換えていない', J(server) === sB && J(mine) === mB);
  const m2 = C.mergePlans(cp(old), server);
  t('5-5 mine>server: 自分の events・planFrom・planLevel・planNote・planGen・介護度を採る', m2.tookGen === 'mine' && J(m2.res.events) === J(server.events) && m2.res.planGen === 4 && m2.res.careLevel === '要介護3' && m2.res.planLevel === '要介護3' && m2.res.planNote === '架空のメモ pl_a' && m2.droppedMine === 0);
  t('5-6 mine>server: 予約も自分の側（切り替え済みの pl_a は戻らない）', m2.res.nextPlans.map((p) => p.id).join(',') === 'pl_b,pl_c');
  const sameUnmatchedEv = cp(server); sameUnmatchedEv.events[0].units = 999; sameUnmatchedEv.events[0].authoredAt = 'x';
  t('5-7 server>mine の数え方: 単位・著者印だけ違う予定は捨てた数に入れない', C.mergePlans(server, Object.assign(cp(sameUnmatchedEv), { planGen: 1 })).droppedMine === 0);

  /* 世代が同じ時の予約の和 */
  const base = resWithPlans();
  const S = cp(base), M = cp(base);
  S.nextPlans = S.nextPlans.filter((p) => p.id !== 'pl_c');
  M.nextPlans.find((p) => p.id === 'pl_a').updatedAt = '2026-11-10T00:00:00Z';
  M.nextPlans.find((p) => p.id === 'pl_a').careLevel = '要介護4';
  M.nextPlans.push(plan('pl_new', '2027-03-01', '要介護4', '要介護2', []));
  const m3 = C.mergePlans(S, M);
  t('5-8 同じ世代: 予約は id で和（両方の予約が残る）', m3.tookGen === 'same' && m3.res.nextPlans.map((p) => p.id).join(',') === 'pl_a,pl_b,pl_c,pl_new', m3.res.nextPlans.map((p) => p.id));
  t('5-9 同じ世代: 同じ id は updatedAt の新しい方', m3.res.nextPlans[0].careLevel === '要介護4');
  t('5-10 同じ世代: events はサーバーのまま', J(m3.res.events) === J(S.events));
  const S2 = cp(base), M2 = cp(base);
  M2.nextPlans[1].careLevel = '要支援2';
  t('5-11 同じ id で updatedAt も同じならサーバー', C.mergePlans(S2, M2).res.nextPlans[0].careLevel === '要介護3');
  const S3 = cp(base), M3 = cp(base);
  M3.nextPlans = M3.nextPlans.filter((p) => p.id !== 'pl_b'); M3.planGone = [{ id: 'pl_b', at: '2026-11-20T00:00:00Z' }];
  const m4 = C.mergePlans(S3, M3);
  t('5-12 取り消した予約（planGone）はサーバーに残っていても消える', !m4.res.nextPlans.some((p) => p.id === 'pl_b') && m4.res.planGone.length === 1);
  const m5 = C.mergePlans(M3, S3);
  t('5-13 取り消した予約が古い側（相手）から生き返らない', !m5.res.nextPlans.some((p) => p.id === 'pl_b'));
  const S4 = cp(base), M4 = cp(base);
  M4.nextPlans.push(plan('pl_dup', '2026-12-01', '要支援1', '要介護2', [], { updatedAt: '2026-11-25T00:00:00Z' }));
  const m6 = C.mergePlans(S4, M4);
  t('5-14 from の重なりは updatedAt の新しい方だけ残す', m6.res.nextPlans.filter((p) => p.from === '2026-12-01').length === 1 && m6.res.nextPlans.find((p) => p.from === '2026-12-01').id === 'pl_dup');
  const S5 = cp(base), M5 = cp(base);
  S5.planGone = Array.from({ length: 15 }, (_, i) => ({ id: 'g_s' + i, at: '2026-10-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z' }));
  M5.planGone = Array.from({ length: 15 }, (_, i) => ({ id: 'g_m' + i, at: '2026-11-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z' }));
  const g = C.mergePlans(S5, M5).res.planGone;
  t('5-15 planGone は id で和の新しい20件', g.length === 20 && g.some((x) => x.id === 'g_m14') && !g.some((x) => x.id === 'g_s9') && g.some((x) => x.id === 'g_s10'), g.length);
  const S6 = cp(server), M6 = cp(old);
  M6.planGone = [{ id: 'pl_c', at: '2026-11-21T00:00:00Z' }]; M6.nextPlans = M6.nextPlans.filter((p) => p.id !== 'pl_c');
  t('5-16 世代が違っても、小さい側の取り消し（planGone）は効く', !C.mergePlans(S6, M6).res.nextPlans.some((p) => p.id === 'pl_c'));
  const m7a = C.mergePlans(S, M), m7b = C.mergePlans(cp(S), cp(M));
  t('5-17 同じ入力で同じ答え', J(m7a) === J(m7b));

  /* 世代が同じで現行の開始日（planFrom）が違う＝別の計画どうし（段1から持ち越した判断 2026-11-27） */
  const P1 = cp(base), P2 = cp(base);
  P2.planFrom = '2026-06-01'; P2.events = [ev('e7', 4, '13:00', '13:30')]; P2.careLevel = '要介護1'; P2.planNote = '架空の別の計画';
  const m8 = C.mergePlans(P1, P2);
  /* 5-18 の期待は 2026-11-27 反証 F2 で「開始日の新しい自分を採る」から「いつもサーバー」に変えた。共通 DB の門（planstale）は
     同じ世代（1以上）で開始日の違う保存を必ず断るので、自分を採ると統合した結果も断られ、その端末の保存が二度と通らなくなるため。
     載せなかった自分の予定（e7 の1件）は droppedMine で数える */
  t('5-18 同じ世代・開始日が違う: 開始日が新しくても自分は採らず、サーバーを丸ごと採って捨てた自分の予定を数える（予定を id で混ぜない）', m8.tookGen === 'server' && J(m8.res.events) === J(P1.events) && m8.res.planFrom === '2026-04-01' && m8.res.careLevel === P1.careLevel && m8.res.planNote === P1.planNote && m8.droppedMine === 1, [m8.tookGen, m8.droppedMine]);
  const m9 = C.mergePlans(P2, P1);
  t('5-19 同じ世代・開始日が違う: 開始日の新しいサーバーを丸ごと採り、捨てた自分の予定を数える', m9.tookGen === 'server' && J(m9.res.events) === J(P2.events) && m9.res.planFrom === '2026-06-01' && m9.droppedMine === 2, [m9.tookGen, m9.droppedMine]);
  const P3 = cp(base); P3.planFrom = '';
  const m10 = C.mergePlans(P3, P1);
  t('5-20 同じ世代・開始日の片方が読めない時はサーバー', m10.tookGen === 'server' && m10.res.planFrom === '' && J(m10.res.events) === J(P3.events));
  const m11 = C.mergePlans(P1, P3);
  t('5-21 同じ世代・開始日の片方が読めない時はサーバー（逆向き）', m11.tookGen === 'server' && m11.res.planFrom === '2026-04-01');
  const P4 = cp(base), P5 = cp(base); delete P4.planFrom; P5.planFrom = '';
  t('5-22 開始日が両方とも無い・空は同じ扱い（今までどおり same）', C.mergePlans(P4, P5).tookGen === 'same' && C.mergePlans(resNoPlan(), resNoPlan()).tookGen === 'same');
  const P6 = cp(base), P7 = cp(base); P6.planFrom = 20260401; P7.planFrom = '';
  t('5-22b 開始日が文字でない時は空と読む（共通 DB の門と同じ読み方）', C.mergePlans(P6, P7).tookGen === 'same');

  /* 2台が同じ世代を別の開始日で作った（反証 F2）: 世代0の同じ方に、端末 X は 12-01 の予約、端末 Y は 12-05 の予約をそれぞれ作り、
     どちらも共通 DB に送る前に自分の端末で切り替えた（どちらも世代1）。X が先に送って通った後、Y が統合して送り直す */
  const g0 = resNoPlan(); g0.planGen = 0; g0.planFrom = ''; g0.nextPlans = [];
  const x0 = cp(g0); x0.nextPlans = [plan('pl_x', '2026-12-01', '要介護3', '要介護2', [ev('ex1', 2, '10:00', '10:30')])];
  const y0 = cp(g0); y0.nextPlans = [plan('pl_y', '2026-12-05', '要介護1', '要介護2', [ev('ey1', 4, '13:00', '13:30'), ev('ey2', 5, '15:00', '15:30')])];
  const X = C.applyDue(x0, '2026-12-06').res, Y = C.applyDue(y0, '2026-12-06').res;
  t('5-23a 材料: どちらも世代1・開始日が違う', X.planGen === 1 && Y.planGen === 1 && X.planFrom === '2026-12-01' && Y.planFrom === '2026-12-05');
  const yAfter = C.mergePlans(X, Y);   /* Y の端末: サーバー（X が送った物）と自分を統合する */
  t('5-23b Y の統合はサーバー（X の計画）を丸ごと採る', yAfter.tookGen === 'server' && J(yAfter.res.events) === J(X.events) && yAfter.res.planFrom === '2026-12-01' && yAfter.res.planGen === 1, yAfter.tookGen);
  t('5-23c 載せなかった Y の予定（ey1・ey2 の2件）を droppedMine で返す（画面が知らせる）', yAfter.droppedMine === 2, yAfter.droppedMine);
  /* 統合した結果は門（0136 の planstale: 世代が下がる・同じ世代で開始日が違う・取り消した予約が戻る）に断られない＝送り直しが通る */
  const pf = (r) => (typeof r.planFrom === 'string' ? r.planFrom : '');
  const goneIds = new Set((X.planGone || []).map((g) => g.id));
  const staleAgainstX = (r) => r.planGen < X.planGen || (r.planGen === X.planGen && X.planGen >= 1 && pf(r) !== pf(X)) || (r.nextPlans || []).some((p) => goneIds.has(p.id));
  t('5-23d 統合した結果は門に断られない（同じ世代・同じ開始日・使った予約 pl_x が戻らない）', !staleAgainstX(yAfter.res), { gen: yAfter.res.planGen, from: yAfter.res.planFrom, next: (yAfter.res.nextPlans || []).map((p) => p.id) });
  t('5-23e （対照）直す前の決まり（開始日の新しい自分を採る）なら門に断られる形になる', staleAgainstX(Y));
  const xAfter = C.mergePlans(Y, X);   /* 逆に Y が先に通った時の X の端末も同じくサーバーを採る */
  t('5-23f 逆向き（Y が先に通った）でも X の端末はサーバー（Y の計画）を採る', xAfter.tookGen === 'server' && xAfter.res.planFrom === '2026-12-05' && xAfter.droppedMine === 1 && !(xAfter.res.planGen < Y.planGen), [xAfter.tookGen, xAfter.droppedMine]);
}

console.log('■ diffEvents');
{
  const before = [ev('e1', 1, '09:00', '09:30'), ev('e2', 3, '14:00', '14:30'), ev('e3', 5, '10:00', '10:30')];
  const after = [ev('e1', 1, '09:00', '09:30', { units: 500, authoredAt: '2026-11-01' }), ev('e2', 3, '14:00', '15:00'), ev('e4', 6, '11:00', '11:30')];
  const bB = J(before), aB = J(after);
  const d = C.diffEvents(before, after);
  t('6-1 追加・変更・削除・変わらない', d.added.length === 1 && d.added[0].id === 'e4' && d.changed.length === 1 && d.changed[0].after.id === 'e2' && d.removed.length === 1 && d.removed[0].id === 'e3' && d.same === 1, d);
  t('6-2 変わった項目の名前', J(d.changed[0].fields) === J(['endTime']));
  t('6-3 1行の日本語の文', d.text === '追加 1件・変更 1件・削除 1件', d.text);
  t('6-4 単位・著者印だけの違いは変わらない', C.diffEvents([before[0]], [after[0]]).same === 1 && C.diffEvents([before[0]], [after[0]]).text === '変更なし');
  const allF = C.diffEvents([ev('e1', 1, '09:00', '09:30')], [{ id: 'e1', dayOfWeek: 2, serviceType: 'daycare', category: '', startTime: '10:00', endTime: '16:00', detail: '別', notes: 'メモ', bathing: true }]);
  t('6-5 比べる8項目（曜日・種類・開始・終了・区分・入浴・支援内容・メモ）', J(allF.changed[0].fields) === J(['dayOfWeek', 'serviceType', 'startTime', 'endTime', 'category', 'bathing', 'detail', 'notes']), allF.changed[0].fields);
  t('6-6 空と未設定は同じ扱い（notes: \'\' と無し・bathing: false と無し）', C.diffEvents([{ id: 'a', dayOfWeek: 1, notes: '', bathing: false }], [{ id: 'a', dayOfWeek: 1 }]).same === 1);
  t('6-7 引数を書き換えていない', J(before) === bB && J(after) === aB);
}

console.log('■ planSummary・validatePlanInput・normPlans');
{
  const r = resWithPlans();
  const s = C.planSummary(r, '2026-12-05');
  t('7-1 年表の材料: 予約3件（昇順）・現行・期日を過ぎた数・次の予約の日', s.next.map((x) => x.id).join(',') === 'pl_a,pl_b,pl_c' && s.next[0].due === true && s.next[1].due === false && s.dueCount === 1 && s.nextFrom === '2026-12-10' && s.current.from === '2026-04-01' && s.current.gen === 3 && s.next[0].count === 2);
  const v = (i, today) => C.validatePlanInput(i, r, today || '2026-11-27');
  t('7-2 明日以降・重ならない・実在する日付 → ok', v({ from: '2026-11-28', careLevel: '要介護3' }).ok);
  t('7-3 今日は不可', v({ from: '2026-11-27' }).errors[0].code === 'from_past');
  t('7-4 過去は不可', v({ from: '2026-01-01' }).errors[0].code === 'from_past');
  t('7-5 実在しない日付は不可', v({ from: '2026-02-30' }).errors[0].code === 'from_bad');
  t('7-6 ほかの予約と同じ開始日は不可', v({ from: '2026-12-01' }).errors.some((e) => e.code === 'from_dup'));
  t('7-7 その予約自身を直す時（id 付き）は重なりにしない', v({ id: 'pl_a', from: '2026-12-01' }).ok);
  t('7-8 今日が読めない時は不可', v({ from: '2026-12-20' }, 'x').errors[0].code === 'today_bad');
  t('7-9 介護度が文字でない時は不可', v({ from: '2026-12-20', careLevel: 3 }).errors.some((e) => e.code === 'level_bad'));
  t('7-10 介護度が空（未設定）は可', v({ from: '2026-12-20', careLevel: '' }).ok);
  const bad = resNoPlan();
  bad.nextPlans = [null, 'x', { id: 'pl_1', from: '2026-02-30', events: [] }, { id: 'pl_2', from: '2026-12-01', events: 'x' }, { from: '2026-12-02', events: [] },
    plan('pl_ok', '2026-12-03', '要介護3', '要介護2', [ev('k1', 1, '09:00', '09:30')]), plan('pl_ok', '2026-12-04', '要介護3', '要介護2', [])];
  const bB = J(bad);
  const n = C.normPlans(bad);
  t('7-11 normPlans: 崩れた予約を落として数える（効くのは1件）', n.plans.length === 1 && n.plans[0].id === 'pl_ok' && n.dropped === 6, n.dropped);
  t('7-12 normPlans: 保存データは書き換えない', J(bad) === bB);
  const a = C.applyDue(bad, '2026-12-31');
  t('7-13 applyDue: 崩れた予約は効かず、保存データからも消さない', a.steps.length === 1 && a.res.nextPlans.length === 5 && a.res.events[0].id === 'k1', a.res.nextPlans.length);
  t('7-14 nextPlans が配列でない時は落とした数1・何も変えない', C.normPlans({ nextPlans: {} }).dropped === 1 && C.applyDue({ nextPlans: 'x', events: [] }, '2026-12-01').changed === false);
}

console.log('■ 崩れた入力で例外を出さない');
{
  const junk = [undefined, null, 0, '', 'x', [], {}, { events: 'x', nextPlans: 5, planGone: 'y', planGen: -1 }, { nextPlans: [null, 1, []], planGone: [null, 1] }];
  let ok = true, where = '';
  junk.forEach((a, i) => junk.forEach((b) => {
    try {
      C.todayJst(a); C.isYmd(a); C.sortPlans(a); C.normPlans(a); C.eventsFor(a, b); C.levelFor(a, b); C.applyDue(a, b, b);
      C.resolveLevel(a); C.resolveLevel({ cur: a, master: b, next: a, today: b, planLevel: b }); C.mergePlans(a, b); C.diffEvents(a, b);
      C.planSummary(a, b); C.validatePlanInput(a, b, b);
    } catch (e) { ok = false; where = i + ': ' + e.message; }
  }));
  t('8-1 どの関数も崩れた入力で例外を出さない', ok, where);
  t('8-2 planGen が負・小数の時は0とみなす', C.applyDue(Object.assign(resNoPlan(), { planGen: -3, nextPlans: [plan('pl_g', '2026-12-01', '', '', [])] }), '2026-12-01').res.planGen === 1
    && C.applyDue(Object.assign(resNoPlan(), { planGen: 1.5, nextPlans: [plan('pl_g', '2026-12-01', '', '', [])] }), '2026-12-01').res.planGen === 1);
}

console.log('■ 決まりの変更（2026-11-27 反証レビュー A1・A2・A4）');
{
  /* A1: 使った予約は planGone に {id, at: その予約の from} で載る */
  const r = resWithPlans();
  r.nextPlans.push(plan('pl_lose', '2026-12-01', '要介護4', '要介護2', [], { updatedAt: '2026-10-01T00:00:00.000Z' }));
  r.planGone = [{ id: 'pl_old', at: '2026-05-01T00:00:00.000Z' }];
  const a = C.applyDue(r, '2026-12-01', 'x');
  t('9-1 入れ替えた予約と同じ開始日で負けた予約が planGone に載る（at は予約の開始日）', a.res.planGone.some((g) => g.id === 'pl_a' && g.at === '2026-12-01') && a.res.planGone.some((g) => g.id === 'pl_lose' && g.at === '2026-12-01'), a.res.planGone);
  t('9-2 元の planGone も残る', a.res.planGone.some((g) => g.id === 'pl_old'));
  const twice = C.applyDue(Object.assign(cp(a.res), { nextPlans: a.res.nextPlans.concat([plan('pl_a', '2026-12-01', '要介護3', '要介護2', [])]) }), '2026-12-02');
  t('9-3 同じ id は planGone に重ねない（planGone にある予約は効かない）', twice.changed === false || twice.res.planGone.filter((g) => g.id === 'pl_a').length === 1);
  const many = resWithPlans(); many.planGone = Array.from({ length: 20 }, (_, i) => ({ id: 'g' + i, at: '2026-01-' + String(i + 1).padStart(2, '0') }));
  const am = C.applyDue(many, '2026-12-01');
  t('9-4 planGone は新しい20件まで（使った予約が入り、古い物が落ちる）', am.res.planGone.length === 20 && am.res.planGone.some((g) => g.id === 'pl_a') && !am.res.planGone.some((g) => g.id === 'g0'), am.res.planGone.length);
  const ta = C.applyDue(cp(r), '2026-12-01', 'a'), tb = C.applyDue(cp(r), '2026-12-01', 'b');
  t('9-5 2台の答えが一字一句同じ（時計を使わない）', J(ta.res) === J(tb.res));

  /* A2: 世代が違って片方を丸ごと採る時も、予約は両方の和 − 両方の planGone */
  const base0 = { id: 'r1', careLevel: '要介護2', events: cp(CUR_EVENTS), planGen: 0, planFrom: '', nextPlans: [plan('pl_a', '2026-12-01', '要介護3', '要介護2', [ev('e1', 1, '09:00', '10:00')])] };
  const server = C.applyDue(cp(base0), '2026-12-01').res;    // gen1・予約なし・planGone に pl_a
  const mine = cp(base0); mine.nextPlans.push(plan('pl_b', '2027-02-01', '要介護4', '要介護2', [], { updatedAt: '2026-11-25T00:00:00.000Z' }));
  const m1 = C.mergePlans(server, mine);
  t('9-6 サーバー gen1（切替済み）× 自分 gen0 [pl_a, 新しい pl_b] → pl_b だけ残る', m1.tookGen === 'server' && m1.res.nextPlans.map((p) => p.id).join(',') === 'pl_b', m1.res.nextPlans.map((p) => p.id));
  const sv = cp(base0); sv.nextPlans.push(plan('pl_s', '2027-03-01', '要介護1', '要介護2', []));   // ほかの端末の予約（サーバーは gen0）
  const mineSw = C.applyDue(cp(base0), '2026-12-01').res;                                         // 自分が手で切り替えた（gen1）
  const m2 = C.mergePlans(sv, mineSw);
  t('9-7 自分が切り替えて世代を上げた × サーバーにほかの端末の予約 pl_s → pl_s が残り、pl_a は生き返らない', m2.tookGen === 'mine' && m2.res.nextPlans.map((p) => p.id).join(',') === 'pl_s', m2.res.nextPlans.map((p) => p.id));
  const sv2 = cp(sv); sv2.nextPlans.find((p) => p.id === 'pl_s').note = '新しい直し'; sv2.nextPlans.find((p) => p.id === 'pl_s').updatedAt = '2026-11-26T00:00:00.000Z';
  const mineSw2 = cp(mineSw); mineSw2.nextPlans = [plan('pl_s', '2027-03-01', '要介護1', '要介護2', [], { note: '古い' })];
  t('9-8 同じ id は updatedAt の新しい方（負けた側の直しでも新しければ残る）', C.mergePlans(sv2, mineSw2).res.nextPlans[0].note === '新しい直し');

  /* A4: 文字でない介護度・メモ */
  const nr = resNoPlan(); nr.nextPlans = [Object.assign(plan('pl_n', '2026-12-01', 3, '要介護2', [ev('e5', 2, '10:00', '10:30')]), { note: { x: 1 } })];
  const an = C.applyDue(nr, '2026-12-01');
  t('9-9 介護度が文字でない予約: 介護度を変えず planLevel は空・note も空', an.res.careLevel === '要介護2' && an.res.planLevel === '' && an.res.planNote === '' && an.steps[0].level === '要介護2', [an.res.careLevel, an.res.planLevel, an.res.planNote]);
  t('9-10 levelFor・planSummary も同じ扱い', C.levelFor(nr, '2026-12-02') === '要介護2' && C.planSummary(nr, '2026-11-01').next[0].careLevel === '' && C.planSummary(nr, '2026-11-01').next[0].note === '');
  const long = '😀'.repeat(81);
  const nl = resNoPlan(); nl.nextPlans = [plan('pl_l', '2026-12-01', '', '', [], { note: long })];
  const al = C.applyDue(nl, '2026-12-01');
  t('9-11 メモの80字は文字の数（絵文字も1字）で切る', Array.from(al.res.planNote).length === 80 && al.res.planNote === '😀'.repeat(80), al.res.planNote.length);
}

console.log('■ 共通 DB の写し（SQL）と同じ答え（check/fixtures/care-plan-parity.json）');
{
  /* 作り直す手順（決まりを変えた時だけ。expected は直した後の applyDue の答え）:
       node -e "const C=require('./care-plan-calc.js'),f='check/fixtures/care-plan-parity.json',d=require('./'+f);d.cases.forEach(c=>c.expected=C.applyDue(c.input,c.today).res);require('fs').writeFileSync(f,JSON.stringify(d,null,1)+'\n')" */
  const fx = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'check', 'fixtures', 'care-plan-parity.json'), 'utf8'));
  t('10-0 照合の材料は12件以上', Array.isArray(fx.cases) && fx.cases.length >= 12, fx.cases && fx.cases.length);
  const bad = fx.cases.filter((c) => J(C.applyDue(c.input, c.today).res) !== J(c.expected)).map((c) => c.name);
  t('10-1 全件で applyDue の答えが expected と一字一句同じ', bad.length === 0, bad);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
