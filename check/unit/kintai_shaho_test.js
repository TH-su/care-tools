/* 勤怠の「社会保険の加入の知らせ」の純関数（kintai-shaho.js）と画面の組み込み（kintai.js・kintai.html）の試験（2026-11-25 新設）
   実行: node check/unit/kintai_shaho_test.js
   守りたいこと:
     1. 設定の掃除（fillConfig・readForm）: 既定は切・4分の3基準・月額は見ない（0）・2か月。範囲の外は既定／入力は断る。対象外の一覧の重なりと形
     2. 換算と基準（weekMin・hitOf）: 月×12÷52。4分の3は時間と日数の両方。短時間労働者の要件は週の時間と（入れた時だけ）月額。境目ちょうどは基準以上
     3. 判定（judge）: 2か月続けた実績で要対応・1か月か予定で注意・今の月分が途中の時は前の月分から数える・読めた月分が足りない印・対象外と加入済み・役員を外す・
        辞めた人（今の月分の名簿に無い・止めた人）を出さない・freee から取り込んだ月分（日が無く集計だけ）も数える
     4. 給与の設定の取り出し（payDigest）: 加入済み（健保と厚年の両方）・役員・月給／時給／日給の月額の見込み・最低賃金に入らない手当を足さない・形の違う答えは null
     5. ホームの箱（box）: 要対応と注意の人だけ・段の高さ・給与を読めない時の注記
     6. 画面の組み込み: kintai.html が kintai.js の前に読む・タブは初めは隠す・kintai.js は切の時にタブと箱を出さない・給与の読み込みは覆いを出さない・
        金額を画面に出さない・端末に残さない（localStorage に書かない）・設定の保存に shaho を入れる・kintai-calc.js と payroll-calc.js を変えていない（呼ばない）
   ★架空データだけ（職員は sX… の番号）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KS = require(path.join(ROOT, 'kintai-shaho.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 架空の月の結果（computeMonth の形のうち使う所だけ） */
function person(sid, actMin, actDays, planPerDay, planDays, extra) {
  const days = [];
  for (let i = 0; i < planDays; i++) days.push({ date: '2026-01-' + String(i + 1).padStart(2, '0'), workMin: 0, schedWorkMin: planPerDay });
  return Object.assign({ staff: { staff_id: sid, name: '架空' + sid, active: true }, days: days, sum: { workMin: actMin, workDays: actDays } }, extra || {});
}
function mon(ym, people) { return { ym: ym, people: people }; }
const H = 60;
/* 4分の3（既定: 40時間・21日 → 週30時間・15.75日）。月の時間 M の週は M×12/52。週30時間 ＝ 月 130時間 */
const Q_MIN = 130 * H;

console.log('\n— 1. 設定の掃除 —');
const d0 = KS.fillConfig({});
t('既定は切・4分の3・月額0・2か月・40時間・21日・週20時間', d0.on === false && d0.mode === 'quarter' && d0.wageMin === 0 && d0.months === 2 && d0.baseWeekH === 40 && d0.baseMonthDays === 21 && d0.weekH === 20, d0);
t('on は true の時だけ入（文字の "true" は切）', KS.fillConfig({ shaho: { on: 'true' } }).on === false && KS.fillConfig({ shaho: { on: true } }).on === true);
const d1 = KS.fillConfig({ shaho: { mode: 'special', weekH: 99, months: 1.5, wageMin: -1, baseWeekH: 37.5, baseMonthDays: 0 } });
t('範囲の外・整数でない値は既定に戻す（37.5 は通す）', d1.mode === 'special' && d1.weekH === 20 && d1.months === 2 && d1.wageMin === 0 && d1.baseWeekH === 37.5 && d1.baseMonthDays === 21, d1);
t('対象外の一覧は文字だけ・重なりを1つに', JSON.stringify(KS.fillConfig({ shaho: { exempt: ['sA', 'sA', 3, '', null, 'sB'] } }).exempt) === '["sA","sB"]');
t('shaho が配列・文字の時は既定', KS.fillConfig({ shaho: [] }).on === false && KS.fillConfig({ shaho: 'x' }).mode === 'quarter');
const f1 = KS.readForm({ on: true, mode: 'special', weekH: '20', wageMin: '88000', months: '2', baseWeekH: '', baseMonthDays: '21' }, ['sA']);
t('入力: 空の欄は既定・数を受ける・対象外は今のまま', f1.bad.length === 0 && f1.vals.on === true && f1.vals.wageMin === 88000 && f1.vals.baseWeekH === 40 && JSON.stringify(f1.vals.exempt) === '["sA"]', f1);
const f2 = KS.readForm({ on: true, mode: 'quarter', weekH: 'abc', wageMin: '1.5', months: '7', baseWeekH: '40', baseMonthDays: '21' }, []);
t('入力: 数でない・整数でない月額・範囲の外の月数は断る（3つ）', f2.vals === null && f2.bad.length === 3, f2.bad);

console.log('\n— 2. 換算と基準 —');
t('週の換算は 月×12÷52（130時間 → 30時間）', Math.abs(KS.weekMin(Q_MIN) - 30 * H) < 1e-9);
const q = KS.fillConfig({ shaho: { on: true } });
t('4分の3: 週30時間ちょうど・16日 → 基準以上', KS.hitOf(q, Q_MIN, 16, null) === true);
t('4分の3: 1分足りない → 届かない', KS.hitOf(q, Q_MIN - 1, 16, null) === false);
t('4分の3: 時間が足りても日数 15日（15.75 未満）→ 届かない', KS.hitOf(q, Q_MIN + 600, 15, null) === false);
t('4分の3: 日数の境目 15.75 は 16日で以上', KS.hitOf(q, Q_MIN, 16, null) === true);
const sp = KS.fillConfig({ shaho: { on: true, mode: 'special' } });
const S_MIN = Math.ceil(20 * H * 52 / 12);   /* 週20時間 ＝ 月 86.67時間 */
t('短時間: 週20時間ちょうど（月 86時間40分）→ 以上・日数は見ない', KS.hitOf(sp, 5200, 1, null) === true && KS.hitOf(sp, 5199, 30, null) === false, S_MIN);
const spw = KS.fillConfig({ shaho: { on: true, mode: 'special', wageMin: 88000 } });
t('短時間＋月額: 見込みが未満なら届かない・以上と未判定（null）は届く', KS.hitOf(spw, 6000, 10, 87999) === false && KS.hitOf(spw, 6000, 10, 88000) === true && KS.hitOf(spw, 6000, 10, null) === true);
t('説明の文（4分の3は 30・15.75）', /週 30 時間以上 かつ 月 15.75 日以上/.test(KS.describe(q)) && /月額は見ない/.test(KS.describe(sp)));

console.log('\n— 3. 判定 —');
const OVER = Q_MIN + 300, UNDER = 100 * H;
const months = {
  '2026-09': mon('2026-09', [person('sA', OVER, 20, 0, 0), person('sB', UNDER, 20, 0, 0)]),
  '2026-10': mon('2026-10', [person('sA', OVER, 20, 0, 0), person('sB', OVER, 20, 0, 0), person('sC', OVER, 20, 0, 0), person('sF', OVER, 20, 0, 0)]),
  '2026-11': mon('2026-11', [person('sA', 2000, 5, 400, 20), person('sB', OVER, 20, 0, 0), person('sC', UNDER, 10, 0, 0), person('sD', 1000, 3, 0, 0), person('sE', 0, 0, 480, 20),
    person('sG', OVER, 20, 0, 0), person('sH', 0, 0, 0, 0), person('sX', OVER, 20, 0, 0, { staff: { staff_id: 'sX', name: '架空sX', active: false } })]),
  '2026-12': mon('2026-12', [person('sD', 0, 0, 480, 20)])
};
const r1 = KS.judge({ cfg: q, curYm: '2026-11', curOpen: true, months: months, pay: null });
const by = {}; r1.people.forEach((p) => { by[p.staff_id] = p; });
t('見る月分は 9・10・11月分（古い順）と次の12月分', JSON.stringify(r1.yms) === '["2026-09","2026-10","2026-11"]' && r1.next === '2026-12', r1.yms);
t('sA: 11月分は途中で届いていない→前から数えて 9・10 の2か月で要対応', by.sA.level === 'alert' && by.sA.streak === 2, by.sA);
t('sB: 11月分が届いた（途中でも）＋10月分 → 2か月で要対応', by.sB.level === 'alert' && by.sB.streak === 2, by.sB);
t('sC: 10月分だけ（11月分は途中で未満・9月分の名簿に無い）→ 注意', by.sC.level === 'warn' && by.sC.streak === 1, by.sC);
t('sD: 実績は未満・次の月分の予定が基準以上 → 注意', by.sD.level === 'warn' && /12月分の予定/.test(by.sD.why), by.sD);
t('sE: 今の月分の予定（8時間×20日＝160時間）が基準以上 → 注意', by.sE.level === 'warn' && /11月分の予定/.test(by.sE.why), by.sE);
t('sG: 11月分だけ届き、前の月分に名簿が無い → 注意で「月分が足りない」の印', by.sG.level === 'warn' && by.sG.short === true, by.sG);
t('sH: 何も届かず、前の月分にいない → なし・足りない印', by.sH.level === 'ok' && by.sH.short === true && /足りません/.test(by.sH.why), by.sH);
t('sF（今の月分にいない）・sX（止めた人）は出さない', !by.sF && !by.sX);
t('数: 要対応2・注意4・なし1', r1.counts.alert === 2 && r1.counts.warn === 4 && r1.counts.ok === 1, r1.counts);
t('並び: 要対応 → 注意 → なし（同じ段は名簿の順）', r1.people.map((p) => p.staff_id).join(',') === 'sA,sB,sC,sD,sE,sG,sH', r1.people.map((p) => p.staff_id));
const r2 = KS.judge({ cfg: q, curYm: '2026-11', curOpen: false, months: months, pay: null });
const r2a = r2.people.filter((p) => p.staff_id === 'sA')[0];
t('今の月分が終わっていれば途中の扱いをしない（sA は 11月分の実績で途切れ、予定だけで注意）', r2a.level === 'warn' && r2a.streak === 0 && /11月分の予定/.test(r2a.why), r2a);
const r3 = KS.judge({ cfg: KS.fillConfig({ shaho: { on: true, months: 3 } }), curYm: '2026-11', curOpen: true, months: months, pay: null });
t('続けた月数を3にすると sA は2か月で注意', r3.people.filter((p) => p.staff_id === 'sA')[0].level === 'warn');
const r4 = KS.judge({ cfg: KS.fillConfig({ shaho: { on: true, exempt: ['sA'] } }), curYm: '2026-11', curOpen: true, months: months,
  pay: { sB: { enrolled: true, board: false, wage: 200000 }, sC: { enrolled: false, board: true, wage: null } } });
const by4 = {}; r4.people.forEach((p) => { by4[p.staff_id] = p; });
t('対象外の一覧の人・給与で加入済みの人・役員は外す', by4.sA.level === 'exempt' && by4.sB.level === 'enrolled' && by4.sC.level === 'exempt' && r4.counts.exempt === 2 && r4.counts.enrolled === 1, r4.counts);
/* freee から取り込んだ月分（日が無く集計だけ） */
const imp = { '2026-10': mon('2026-10', [{ staff: { staff_id: 'sI', name: '架空sI' }, days: [], sum: { workMin: OVER, workDays: 20 } }]),
  '2026-11': mon('2026-11', [{ staff: { staff_id: 'sI', name: '架空sI' }, days: [], sum: { workMin: OVER, workDays: 20 } }]) };
t('freee から取り込んだ月分（集計だけ）も数える', KS.judge({ cfg: q, curYm: '2026-11', curOpen: false, months: imp, pay: null }).people[0].level === 'alert');
/* 短時間＋月額 */
const r5 = KS.judge({ cfg: spw, curYm: '2026-11', curOpen: false, months: { '2026-10': mon('2026-10', [person('sJ', 6000, 10, 0, 0), person('sK', 6000, 10, 0, 0)]), '2026-11': mon('2026-11', [person('sJ', 6000, 10, 0, 0), person('sK', 6000, 10, 0, 0)]) },
  pay: { sJ: { enrolled: false, board: false, wage: 70000 } } });
const by5 = {}; r5.people.forEach((p) => { by5[p.staff_id] = p; });
t('短時間＋月額: 見込みが未満の人は届かない・給与に無い人は未判定のまま要対応', by5.sJ.level === 'ok' && by5.sJ.wageState === 'under' && by5.sK.level === 'alert' && /月額は未判定/.test(by5.sK.why), [by5.sJ, by5.sK]);
t('今の月分が形の違う文字なら空の答え', KS.judge({ cfg: q, curYm: '2026-13', months: {} }).people.length === 0);
t('年をまたぐ（1月分の前は前の年の12月分）', JSON.stringify(KS.judge({ cfg: q, curYm: '2027-01', months: {} }).yms) === '["2026-11","2026-12","2027-01"]');

console.log('\n— 4. 給与の設定の取り出し —');
const boot = {
  allowances: [{ code: 'qual', def: { sec: 'pay', calc: 'fixed', attrs: {} } }, { code: 'commute2', def: { sec: 'pay', calc: 'fixed', attrs: { min_wage: false } } }, { code: 'night', def: { sec: 'pay', calc: 'night_shift' } }],
  profiles: [
    { staff_id: 'sA', data: { pay_type: 'monthly', base: 180000, allowances: [{ code: 'qual', amount: 10000 }, { code: 'commute2', amount: 5000 }, { code: 'night', amount: 4000 }], ins: { health: { on: true }, pension: { on: true } } } },
    { staff_id: 'sB', data: { pay_type: 'hourly', base: 1100, ins: { health: { on: true }, pension: { on: false } } } },
    { staff_id: 'sC', data: { pay_type: 'daily', base: 9000 } },
    { staff_id: 'sD', data: { pay_type: 'board', base: 300000 } },
    { staff_id: 'sE', data: { pay_type: 'monthly', base: '' } },
    { data: {} }
  ], bank_last4: [{ x: 1 }]
};
const dg = KS.payDigest(boot, { sB: { min: 80 * H, days: 16 }, sC: { min: 0, days: 10 } });
t('月給: 基本給＋最低賃金に入る定額の手当（通勤など外した手当・回数の手当は足さない）', dg.sA.wage === 190000 && dg.sA.enrolled === true, dg.sA);
t('時給: 時給×予定の時間（1100×80）・健保だけは加入済みにしない', dg.sB.wage === 88000 && dg.sB.enrolled === false, dg.sB);
t('日給: 日給×予定の日数', dg.sC.wage === 90000);
t('役員の印・基本給が空なら未判定（null）・番号の無い行は捨てる', dg.sD.board === true && dg.sE.wage === null && Object.keys(dg).length === 5);
t('取り出した物は3つの項目だけ（口座・名前などを持たない）', Object.keys(dg.sA).sort().join(',') === 'board,enrolled,wage');
t('形の違う答えは null', KS.payDigest(null) === null && KS.payDigest({ profiles: 'x' }) === null);
const dg2 = KS.payDigest({ profiles: [{ staff_id: 'sB', data: { pay_type: 'hourly', base: 1100 } }] }, {});
t('時給で予定が無い人は未判定', dg2.sB.wage === null);

console.log('\n— 4b. 反証レビュー（2026-11-25）の直し —');
/* 1. 先の月分を開いても、本当の今の月分（途中）の実績を済んだ月として数えない */
const per = (ym) => ({ from: ym + '-01', to: ym + '-' + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, '0') });
const withPer = (m) => Object.assign(m, { period: per(m.ym) });
const fm1 = { '2026-09': withPer(mon('2026-09', [person('sA', OVER, 20, 0, 0)])), '2026-10': withPer(mon('2026-10', [person('sA', OVER, 20, 0, 0)])),
  '2026-11': withPer(mon('2026-11', [person('sA', 40 * H, 6, 0, 0)])), '2026-12': withPer(mon('2026-12', [person('sA', 0, 0, 0, 0)])) };
const j11 = KS.judge({ cfg: q, curYm: '2026-11', today: '2026-11-10', months: fm1 }).people[0];
const j12 = KS.judge({ cfg: q, curYm: '2026-12', today: '2026-11-10', months: fm1 }).people[0];
t('今日 11/10: 11月分を開いても 12月分（先）を開いても、9・10月分で要対応', j11.level === 'alert' && j12.level === 'alert' && j12.streak === 2, [j11.level, j12.level, j12.streak]);
t('先の月分の実績は基準の判定に使わない（actHit は偽）', j12.months[j12.months.length - 1].state === 'future' && j12.months[j12.months.length - 1].actHit === false);
/* 2. 喪失日・資格の始まり・退職日・70歳 */
const B2 = { profiles: [
  { staff_id: 'sL', data: { pay_type: 'monthly', base: 1, ins: { health: { on: true, to: '2026-04-01' }, pension: { on: true, to: '2026-04-01' } } } },
  { staff_id: 'sM', data: { pay_type: 'monthly', base: 1, ins: { health: { on: true, from: '2026-12-01' }, pension: { on: true, from: '2026-12-01' } } } },
  { staff_id: 'sN', data: { pay_type: 'monthly', base: 1, retire_date: '2026-10-31', ins: { health: { on: true }, pension: { on: true } } } },
  { staff_id: 'sO', data: { pay_type: 'monthly', base: 1, birth_date: '1950-05-05', ins: { health: { on: true }, pension: { on: false } } } },
  { staff_id: 'sP', data: { pay_type: 'monthly', base: 1, birth_date: '1980-05-05', ins: { health: { on: true }, pension: { on: false } } } },
  { staff_id: 'sQ', data: { pay_type: 'monthly', base: 1, ins: { health: { on: true, to: '2026-12-01' }, pension: { on: true } } } }] };
const d2 = KS.payDigest(B2, {}, '2026-11-25');
t('喪失日を過ぎた人・資格の始まりが先の人・退職した人は加入済みにしない', !d2.sL.enrolled && !d2.sM.enrolled && !d2.sN.enrolled, d2);
t('70歳以上は厚生年金を見ない（健保だけで加入済み）・70歳未満は両方が要る・喪失日が先なら今は加入済み', d2.sO.enrolled && !d2.sP.enrolled && d2.sQ.enrolled, [d2.sO, d2.sP, d2.sQ]);
/* 3. 予定が0の時給・日給の人は月額を見込めない（0円で外さない） */
const d3 = KS.payDigest({ profiles: [{ staff_id: 'sR', data: { pay_type: 'hourly', base: 1500 } }, { staff_id: 'sS', data: { pay_type: 'daily', base: 9000 } }] }, { sR: { min: 0, days: 0 }, sS: { min: 0, days: 0 } }, '2026-11-25');
t('予定が0の時給・日給の人は月額は未判定（null）', d3.sR.wage === null && d3.sS.wage === null, d3);
/* 5. 締めた月分は控えの実働を使う */
const lk = withPer(mon('2026-10', [person('sT', UNDER, 10, 0, 0)])); lk.k36 = { locked: true, rows: [{ staff_id: 'sT', workMin: OVER, workDays: 20 }] };
const f5 = KS.factsOf(lk, 'sT');
t('締めた月分は締めた時の控えの実働・日数（打刻から数え直した値でなく）', f5.actMin === OVER && f5.actDays === 20 && f5.snap === true, f5);
/* 10. 期間が暦の1か月でない月分は期間の日数で週へ */
t('期間が 28〜31日なら ×12÷52・それ以外（例 46日）は ×7÷日数', Math.abs(KS.weekMin(Q_MIN, { from: '2026-10-01', to: '2026-10-31' }) - 30 * H) < 1e-9 && Math.abs(KS.weekMin(46 * 60 * 10, { from: '2026-10-01', to: '2026-11-15' }) - 70 * 60) < 1e-9);
t('期間が暦の1か月でない月分は日数の基準も期間に合わせる（15日の期間は 15.75×15×12÷365≒7.8日・45日は 23.3日）',
  KS.hitOf(q, 56 * 60 * 15 / 7, 11, null, { from: '2026-10-01', to: '2026-10-15' }) === true && KS.hitOf(q, 40 * 60 * 45 / 7, 17, null, { from: '2026-10-01', to: '2026-11-14' }) === false);
const d75 = KS.payDigest({ profiles: [{ staff_id: 'sV', data: { pay_type: 'monthly', base: 1, birth_date: '1950-01-01', ins: { health: { on: false }, pension: { on: false } } } }] }, {}, '2026-11-25');
t('75歳以上は健保・厚年とも見ない（後期高齢者医療）＝加入済みとして外す', d75.sV.enrolled === true, d75);
/* 12. 打刻の画面に出さない仮の枠は出さない */
const r12 = KS.judge({ cfg: q, curYm: '2026-11', months: { '2026-11': mon('2026-11', [person('sU', OVER, 20, 0, 0, { staff: { staff_id: 'sU', name: '架空sU', clock_visible: false } })]) } });
t('仮の枠（clock_visible が false）は出さない', r12.people.length === 0);
/* 9. 文は続けた月数を言い切らない */
t('要対応の文に「3か月目」を書かない（続けた月数の設定と食い違わない）', !/3か月目/.test(j11.why), j11.why);

console.log('\n— 5. ホームの箱 —');
const b1 = KS.box(r1);
t('箱: 要対応と注意の人だけ（6人）・要対応があれば alert・押すと社保のタブ', b1.count === 6 && b1.level === 'alert' && b1.tab === 'shaho' && b1.key === 'shaho' && /^要対応: /.test(b1.rows[0].text), b1);
t('箱: 給与を読めない時と月分が足りない時の注記', /給与の設定を読めない/.test(b1.note) && /月分が足りない/.test(b1.note));
const b2 = KS.box(KS.judge({ cfg: q, curYm: '2026-11', curOpen: false, months: { '2026-10': mon('2026-10', [person('sZ', 0, 0, 0, 0)]), '2026-11': mon('2026-11', [person('sZ', 0, 0, 0, 0)]), '2026-09': mon('2026-09', [person('sZ', 0, 0, 0, 0)]) }, pay: {} }));
t('箱: 誰もいなければ ok・0人・注記なし', b2.level === 'ok' && b2.count === 0 && b2.note === '', b2);

console.log('\n— 6. 画面の組み込み —');
const html = read('kintai.html'), js = read('kintai.js');
const iS = html.indexOf('kintai-shaho.js?v='), iJ = html.indexOf('kintai.js?v=');
t('kintai.html は kintai-shaho.js を kintai.js の前に読む', iS > 0 && iJ > iS);
t('社保のタブは初めは隠してある（hidden）', /<button type="button" role="tab" data-tab="shaho" hidden>/.test(html));
t('kintai.js: タブの一覧に shaho・切の時はホームへ戻す・入れた時だけタブを出す', /'holiday', 'shaho', 'cert'(?:, 'daitai')?\]/.test(js) && /tab === 'shaho' && data && !shOn\(\)\) tab = 'home'/.test(js) && /shTab\.hidden = !shv/.test(js));
t('kintai.js: ホームの箱は入れた時だけ（shBoxHtml は切なら空）', /function shBoxHtml\(\) \{\n    if \(!shOn\(\)\) return '';/.test(js));
const blk = js.slice(js.indexOf('/* ── 社会保険の加入の知らせ'), js.indexOf('/* ── 段A1'));
t('給与の読み込みは payroll_bootstrap だけで、覆い・暗証番号の窓を出さない', /rpc\('payroll_bootstrap'/.test(blk) && !/showGate|payroll_pin|pinRecheck/.test(blk));
t('答えはすぐ取り出し（payDigest）にして元を捨てる・10分で捨てる', /plan = shPlanOf\(\)/.test(blk) && /KS\.payDigest\(r, plan, td\); r = null;/.test(blk) && /setTimeout\(function \(\) \{ if \(shPay && shPay\.at === at\) shPay = null; \}, SH_PAY_TTL\)/.test(blk) && /SH_PAY_TTL = 600000;/.test(js) && /Date\.now\(\) - shPay\.at < SH_PAY_TTL/.test(blk));
t('端末に残さない（localStorage・lsSet を使わない）', !/localStorage|lsSet\(/.test(blk));
t('金額を画面に出さない（wage を描かない）', !/\.wage\b/.test(blk));
t('設定の保存に shaho を入れる・欄が無い時は今の設定のまま', /if \(shs && \('shaho' in cur \|\| JSON\.stringify\(shs\.vals\) !== JSON\.stringify\(KS\.fillConfig\(\{\}\)\)\)\) outCfg\.shaho = shs\.vals;/.test(js) && /\.concat\(shs \? \['shaho'\] : \[\]\)/.test(js));
t('対象外の保存はほかの設定を全部残して送る（管理者だけ）', /function shExempt\(sid, on, btn\) \{\n    if \(busy \|\| !isAdmin\(\)/.test(blk) && /for \(k in cur\) out\[k\] = cur\[k\];/.test(blk));
const ksrc = read('kintai-shaho.js');
t('kintai-shaho.js は kintai-calc.js・payroll-calc.js を読まない・DOM と通信を持たない', !/require\(|KintaiCalc|PayrollCalc|document\.|fetch\(|XMLHttpRequest|localStorage/.test(ksrc));

console.log('\n' + (fail ? '✗ ' + fail + ' 件失敗' : '✓ 全部通過') + '（' + pass + ' 件）');
process.exit(fail ? 1 : 0);
