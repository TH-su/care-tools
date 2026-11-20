/* 給与の画面と計算の、勤怠 v5 段4（休暇の種類・統合 0113）の受け方の試験（2026-11-20 新設）
   実行: node check/unit/payroll_s4_test.js
   守りたいこと:
     1. 締めの控えの確かめ（verifyKintai）は kintai_month_get の absences を computeMonth に渡す＝休暇を入れた月でも控えと同じで止まらない
     2. 勤怠の受け口（attFromKintai）: 休暇の鍵を受ける（日数は半日きざみのまま）・段4 より前の控え（鍵が無い）は 0 で missing にしない・attSame で比べる
     3. 払い方（仮置き）: 時給＝時間単位は今の paidMin のまま・有給の特別休暇は時給×分。日給＝時間単位は日給×分÷1日の所定時間・有給の特別休暇は日給×日数。
        月給＝有給の休みは控除しない・無給の特別休暇と代休は欠勤と同じに日数で控除。無給の休み（時給・日給）は何も足さない
     4. 休暇を使わない月は、休暇の鍵が無い時と同じ明細（行・額・警告）
     5. 勤怠の計算: 時間単位の有休で休んだ時間は、その日の遅刻・早退に数えない（月給の遅刻早退の控除に入らない）
   ★職員は架空。期待値は手で数えた数字。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PC = require(path.join(ROOT, 'payroll-calc.js'));
const KC = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

const PERIOD = { from: '2026-12-01', to: '2026-12-31' };
const run = (profile, att) => PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2027-01-25', settings: {}, profile, allowanceDefs: [], att, adjustments: [] });
const L = (it, code) => { const l = it.lines.find((x) => x.code === code && x.sec !== 'att'); return l ? l.amount : undefined; };
const LA = (it, code) => { const l = it.lines.find((x) => x.code === code && x.sec === 'att'); return l ? l.qty : undefined; };
const INS = { emp: { on: true } }, TAX = { col: 'kou', dependents: 0 };
const HOURLY = { pay_type: 'hourly', base: 1100, ins: INS, tax: TAX };
const DAILY = { pay_type: 'daily', base: 10000, day_hours: 8, ins: INS, tax: TAX };
const MONTHLY = { pay_type: 'monthly', base: 300000, day_hours: 8, ins: INS, tax: TAX };
const BASE_ATT = { workDays: 20, paidDays: 1, paidMin: 480, workMin: 9600, schedInMin: 9600, absentDays: 0, lateMin: 30, earlyLeaveMin: 0, schedDays: 21 };
const ZERO = { hourlyPaidMin: 0, specialPaidMin: 0, specialPaidDays: 0, specialUnpaidDays: 0, compDays: 0 };

console.log('\n— 4. 休暇を使わない月は今と同じ —');
for (const [nm, pf] of [['時給', HOURLY], ['日給', DAILY], ['月給', MONTHLY]]) {
  const a = run(pf, Object.assign({}, BASE_ATT)), b = run(pf, Object.assign({}, BASE_ATT, ZERO));
  t(nm + ': 休暇の鍵が0の月は、鍵が無い時と明細（行・額・警告）が同じ', JSON.stringify(a) === JSON.stringify(b) && a.gross > 0, [a.gross, b.gross]);
}

console.log('\n— 3. 払い方 —');
{
  const h = run(HOURLY, Object.assign({}, BASE_ATT, { paidMin: 480 + 120, hourlyPaidMin: 120, specialPaidMin: 480, specialPaidDays: 1, specialUnpaidDays: 1, compDays: 0.5 }));
  t('時給: 基本給は（所定内＋有休）＝ 時間単位の有休を含む paidMin で払う（1100×(9600+600)÷60＝187000）', L(h, 'basic') === 187000, L(h, 'basic'));
  t('時給: 有給の特別休暇は時給×分（1100×480÷60＝8800）・無給の特別休暇と代休は何も足さない（控除の行も無い）', L(h, 'special_paid') === 8800 && L(h, 'leave_unpaid') === undefined && L(h, 'paid_leave_hour') === undefined, h.lines.filter((l) => l.sec === 'pay'));
  const d = run(DAILY, Object.assign({}, BASE_ATT, { hourlyPaidMin: 120, specialPaidDays: 1.5, specialUnpaidDays: 1, compDays: 1 }));
  t('日給: 時間単位の有休は日給×分÷1日の所定時間（10000×120÷480＝2500）', L(d, 'paid_leave_hour') === 2500, L(d, 'paid_leave_hour'));
  t('日給: 有給の特別休暇は日給×日数（半日きざみのまま・10000×1.5＝15000）・無給の休みは何も足さない', L(d, 'special_paid') === 15000 && L(d, 'leave_unpaid') === undefined);
  t('日給: 今の有休（日給×有休の日数）はそのまま', L(d, 'paid_leave') === 10000);
  const m0 = run(MONTHLY, Object.assign({}, BASE_ATT));
  const m1 = run(MONTHLY, Object.assign({}, BASE_ATT, { hourlyPaidMin: 120, specialPaidMin: 480, specialPaidDays: 1 }));
  t('月給: 時間単位の有休・有給の特別休暇は控除しない（総支給が同じ・控除の行なし）', m1.gross === m0.gross && L(m1, 'leave_unpaid') === undefined && L(m1, 'special_paid') === undefined, [m0.gross, m1.gross]);
  const m2 = run(MONTHLY, Object.assign({}, BASE_ATT, { specialUnpaidDays: 1, compDays: 0.5 }));
  t('月給: 無給の特別休暇と代休は欠勤と同じに控除（単価 300000÷172＝1744 ×8h×1.5日＝20928）', L(m2, 'leave_unpaid') === -20928 && m2.gross === m0.gross - 20928, L(m2, 'leave_unpaid'));
  const m3 = PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: '2027-01-25', settings: { absence_deduct: false }, profile: MONTHLY, allowanceDefs: [], att: Object.assign({}, BASE_ATT, { specialUnpaidDays: 1 }), adjustments: [] });
  t('月給: 欠勤控除をしない設定では、無給の休みも控除しない', L(m3, 'leave_unpaid') === undefined);
  t('勤怠の行: 休暇の種類はある時だけ出す（時間単位の分・日数は半日きざみ）・無い月は出さない', LA(d, 'hourlyPaidMin') === 120 && LA(d, 'specialPaidDays') === 1.5 && LA(d, 'compDays') === 1 && LA(m0, 'compDays') === undefined && LA(m0, 'hourlyPaidMin') === undefined);
}

console.log('\n— 5. 勤怠の計算: 時間単位の有休の時間を遅刻・早退に数えない —');
{
  const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
  const D = '2026-12-01', D2 = '2026-12-02';
  const S = (d) => ({ staff_id: 'x', work_date: d, seq: 1, office: 'facility', kind: 'work', start_at: KC.iso(at(d, '9:00')), end_at: KC.iso(at(d, '18:00')), break_min: 60, paid_min: 0, symbol: '日' });
  const P = (d, k, hm) => ({ id: d + k + hm, staff_id: 'x', kind: k, at: new Date(at(d, hm)).toISOString(), source: 'tablet' });
  const mon = (abs) => KC.computeMonth({ ym: '2026-12', staff: [{ staff_id: 'x', office: 'facility' }], schedule: [S(D), S(D2)], punches: [P(D, 'in', '11:00'), P(D, 'out', '18:00'), P(D2, 'in', '9:00'), P(D2, 'out', '17:00')], days: [], absences: abs, config: {}, now: Date.parse('2027-01-10') }).people[0];
  const p0 = mon([]), p1 = mon([{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 120 }, { staff_id: 'x', date: D2, kind: 'hourly_paid', minutes: 60 }]);
  t('休暇なし: 遅刻 120分（1回）・早退 60分（1回）', p0.sum.lateMin === 120 && p0.sum.lateCount === 1 && p0.sum.earlyLeaveMin === 60 && p0.sum.earlyLeaveCount === 1, p0.sum);
  t('時間単位の有休（遅刻の日 2時間・早退の日 1時間）: 遅刻・早退とも 0分・0回（日の行に差し引いた分）', p1.sum.lateMin === 0 && p1.sum.lateCount === 0 && p1.sum.earlyLeaveMin === 0 && p1.sum.earlyLeaveCount === 0 && p1.days[0].hourlyOffsetMin === 120, p1.sum);
  const p2 = mon([{ staff_id: 'x', date: D, kind: 'hourly_paid', minutes: 60 }]);
  t('時間単位の有休が遅刻より短い（1時間）: 遅刻は残り 60分・1回のまま', p2.sum.lateMin === 60 && p2.sum.lateCount === 1, p2.sum);
  t('実働・paidMin は時間単位で変わらない所は今のまま（実働は同じ・paidMin は時間単位の分だけ増える）', p1.sum.workMin === p0.sum.workMin && p1.sum.paidMin === p0.sum.paidMin + 180);
  const mo = run(MONTHLY, Object.assign({}, BASE_ATT, { lateMin: p1.sum.lateMin, earlyLeaveMin: p1.sum.earlyLeaveMin, hourlyPaidMin: 180 }));
  t('月給: 時間単位の有休で休んだ遅刻・早退は遅刻早退の控除に入らない', L(mo, 'late') === undefined, mo.lines.filter((l) => l.sec === 'pay'));
}

console.log('\n— 1・2. 締めの控えの確かめと勤怠の受け口 —');
{
  const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
  const between = (a, b) => { const i = J.indexOf(a), j = J.indexOf(b, i + 1); return i >= 0 && j > i ? J.slice(i, j) : ''; };
  const src = between('  function arr(v)', '  function kintaiBlock()');
  t('給与の画面の部品を切り出せた', /function verifyKintai\(/.test(src) && /absences: arr\(d\.absences\)/.test(src));
  const make = (raw) => new Function('KC', 'RAW', `var window = { KintaiCalc: KC }; function note() {}
    function rpc(name, args) { return Promise.resolve(RAW(args.p_ym)); }
    ${src}
    return { verifyKintai: verifyKintai, attFromKintai: attFromKintai, attSame: attSame };`)(KC, raw);
  /* 架空の月: 2人・休暇あり（時間単位・特別休暇・振替）・締めた時の控えは休暇を入れて数えた控え */
  const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
  const sched = [], pun = [];
  for (let d = 1; d <= 31; d++) {
    const ds = '2026-12-' + String(d).padStart(2, '0'), w = new Date(Date.UTC(2026, 11, d)).getUTCDay();
    if (w === 0 || w === 6) continue;
    for (const sid of ['k1', 'k2']) {
      sched.push({ staff_id: sid, work_date: ds, seq: 1, office: 'facility', kind: 'work', start_at: KC.iso(at(ds, '9:00')), end_at: KC.iso(at(ds, '18:00')), break_min: 60, paid_min: 0, symbol: '日' });
      if (!(sid === 'k2' && (d === 9 || d === 18))) pun.push({ id: sid + ds + 'i', staff_id: sid, kind: 'in', at: new Date(at(ds, '9:00')).toISOString() }, { id: sid + ds + 'o', staff_id: sid, kind: 'out', at: new Date(at(ds, '18:00')).toISOString() });
    }
  }
  const staff = [{ staff_id: 'k1', office: 'facility' }, { staff_id: 'k2', office: 'facility' }];
  const absences = [{ id: 'a1', staff_id: 'k1', date: '2026-12-03', kind: 'hourly_paid', minutes: 120, paid: true }, { id: 'a2', staff_id: 'k2', date: '2026-12-18', kind: 'special', paid: false, type_code: 'other' },
    { id: 'a3', staff_id: 'k2', date: '2026-12-09', kind: 'swap', link_date: '2026-12-13' }];
  const period = { from: '2026-12-01', to: '2026-12-31' };
  const snapM = KC.computeMonth({ ym: '2026-12', period, staff, schedule: sched, punches: pun, days: [], absences, config: { legal_holiday: 0 }, now: Date.parse('2027-01-05') });
  const snap = KC.snapshotOf(snapM);
  const raw = () => ({ ok: true, period, staff, schedule: sched, punches: pun, days: [], leave_uses: [], absences, month: { ym: '2026-12', locked_at: '2027-01-05T00:00:00Z', snapshot: snap } });
  const boot = { kintai: { locked: true }, profiles: [{ staff_id: 'k1', name: '架空 一', data: {} }, { staff_id: 'k2', name: '架空 二', data: {} }] };
  const F = make(raw);
  F.verifyKintai('2026-12', boot).then((r) => {
    t('休暇を入れた月（時間単位・無給の特別休暇・振替）でも、締めの控えと同じで止まらない（ok）', r.state === 'ok' && r.names.length === 0, r);
    t('材料の確かめ: 控えに休暇の数字が入っている（k1 の時間単位 120分・k2 の無給の特別休暇 1日）', snap.rows[0].hourlyPaidMin === 120 && snap.rows[1].specialUnpaidDays === 1);
    /* 休暇の行が無い数え直し（直す前の画面と同じ）なら食い違う＝渡すことが要る */
    const G = make(() => Object.assign(raw(), { absences: [] }));
    return G.verifyKintai('2026-12', boot).then((r2) => {
      t('（比べ）休暇の行を渡さない数え直しでは食い違って止まる（休暇を入れた2人とも）', r2.state === 'ng' && r2.names.length === 2, r2);
      const a = F.attFromKintai({ workDays: 1, paidDays: 0.5, paidMin: 0, specialPaidDays: 1.5, compDays: 0.5, hourlyPaidMin: 120.4 });
      t('受け口: 休暇の日数は半日きざみのまま（1.5・0.5）・分は整数', a.specialPaidDays === 1.5 && a.compDays === 0.5 && a.hourlyPaidMin === 120);
      const old = F.attFromKintai(Object.assign({}, snap.rows[0], { hourlyPaidMin: undefined, specialPaidMin: undefined, specialPaidDays: undefined, specialUnpaidDays: undefined, compDays: undefined }));
      t('受け口: 段4 より前の控え（休暇の鍵が無い）は 0 で、missing（古い控えの警告）に入れない', ['hourlyPaidMin', 'specialPaidMin', 'specialPaidDays', 'specialUnpaidDays', 'compDays'].every((k) => old[k] === 0 && old.missing.indexOf(k) < 0));
      const x0 = F.attFromKintai(snap.rows[1]), x1 = F.attFromKintai(Object.assign({}, snap.rows[1], { compDays: 0.5 }));
      t('attSame: 休暇の鍵が違えば違う・同じなら同じ', F.attSame(x0, F.attFromKintai(snap.rows[1])) && !F.attSame(x0, x1));
    });
  }).then(() => {
    console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
    process.exit(fail ? 1 : 0);
  }, (e) => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
}
