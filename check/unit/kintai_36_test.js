/* 勤怠管理の36協定のアラート（kintai-36.js）の純関数の試験（2026-11-20 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md の段3）
   実行: node check/unit/kintai_36_test.js（環境変数 KINTAI_36 で別の版を当てられる）
   守りたいこと:
     1. 設定: agreement36 が無い時は既定・月の目安は overtimeMonthWarnH（今の画面の警告と同じ値）・壊れた値は既定へ
     2. 協定年度（起算月 4 で 3月と4月の切り替わり・起算月 1・壊れた月）
     3. 月の法定外の境目: 36時間ちょうど＝warn／45時間ちょうど＝warn で over でない／45時間1分＝over。月の警告の文は今の画面と同じ
     4. 法の上限: 法定外＋休日労働 100時間ちょうど＝over・99時間59分＝over でない（特別条項でなくても）
     5. 2〜6か月の平均: 80時間ちょうど＝over でない・80時間1分＝over・年度をまたぐ・窓に無い月は null
     6. 年度の累計（288時間＝warn・360時間ちょうど＝warn・360時間1分＝over）・特別条項（上限の差し替え・回数）
     7. 法定休日を決めていない時の注意（少なく出ています）
     8. 月の途中の見込み
   ★職員は架空（判定は1人分の月の列だけで、氏名を持たない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const A = require(process.env.KINTAI_36 || path.join(ROOT, 'kintai-36.js'));
const C = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const H = (h, m) => h * 60 + (m || 0);
const M = (ym, legalOverMin, holidayMin, extra) => Object.assign({ ym, legalOverMin, holidayMin: holidayMin || 0, locked: true, partial: false }, extra || {});
const codes = (r) => r.items.map((x) => x.code + ':' + x.level).join(',');
const item = (r, code) => r.items.find((x) => x.code === code);
/* 法定休日を決めた設定（注意を出さない）と、目安の警告 36時間を明示した設定 */
const BASE = { legal_holiday: 0, agreement36: { monthWarnH: 36 } };
const one = (legal, hol, cfg) => A.judge([M('2026-10', legal, hol)], '2026-10', cfg || BASE, { holidayKnown: true });

console.log('\n— 1. 設定 —');
{
  const d = A.fillAgreement({});
  t('agreement36 が無い時は既定（起算月4・月45・年360・年の目安288・特別条項なし・100・80・720・6）',
    d.startMonth === 4 && d.monthLimitH === 45 && d.yearLimitH === 360 && d.yearWarnH === 288 && d.special === false && d.specialMonthMaxH === 100 && d.specialAvgH === 80 && d.specialYearH === 720 && d.specialCountMax === 6, d);
  t('agreement36 が無い設定で monthWarnH は overtimeMonthWarnH の値（40）', A.fillAgreement({ overtimeMonthWarnH: 40 }).monthWarnH === 40);
  t('agreement36 に monthWarnH が無い時も overtimeMonthWarnH（30）', A.fillAgreement({ overtimeMonthWarnH: 30, agreement36: { startMonth: 1 } }).monthWarnH === 30);
  t('overtimeMonthWarnH も無い時は今の画面の既定と同じ 45（kintai-calc.js の DEFAULTS）', A.fillAgreement({}).monthWarnH === 45 && C.DEFAULTS.overtimeMonthWarnH === 45 && A.fillAgreement(C.fillConfig({})).monthWarnH === 45);
  /* 注: fillConfig を通した設定には agreement36 が残らない（知らない鍵を写さない）。画面では通す前の生の設定を渡す */
  t('agreement36.monthWarnH があればそちら（36）', A.fillAgreement({ overtimeMonthWarnH: 40, agreement36: { monthWarnH: 36 } }).monthWarnH === 36);
  const bad = A.fillAgreement({ overtimeMonthWarnH: 'x', agreement36: { startMonth: 13, monthLimitH: 60, yearLimitH: -1, monthWarnH: 'abc', yearWarnH: NaN, special: 'yes', specialMonthMaxH: 120, specialAvgH: 90, specialYearH: 800, specialCountMax: 7.5 } });
  t('壊れた値・範囲外は既定へ（起算月13・月60・年-1・文字・NaN・特別条項の値が法を超える・回数の小数）',
    bad.startMonth === 4 && bad.monthLimitH === 45 && bad.yearLimitH === 360 && bad.monthWarnH === 45 && bad.yearWarnH === 288 && bad.special === false && bad.specialMonthMaxH === 100 && bad.specialAvgH === 80 && bad.specialYearH === 720 && bad.specialCountMax === 6, bad);
  t('agreement36 が配列・null・文字でも既定（例外を出さない）', [[], null, 'x', 5].every((v) => A.fillAgreement({ agreement36: v }).monthLimitH === 45) && A.fillAgreement(null).startMonth === 4 && A.fillAgreement(undefined).monthWarnH === 45);
  const ok = A.fillAgreement({ agreement36: { startMonth: 1, monthLimitH: 42, yearLimitH: 320, monthWarnH: 0, yearWarnH: 0, special: true, specialMonthMaxH: 90, specialAvgH: 75, specialYearH: 700, specialCountMax: 3 } });
  t('正しい値はそのまま（変形の 42・320 も・0 は目安の警告なし）', ok.startMonth === 1 && ok.monthLimitH === 42 && ok.yearLimitH === 320 && ok.monthWarnH === 0 && ok.yearWarnH === 0 && ok.special === true && ok.specialMonthMaxH === 90 && ok.specialAvgH === 75 && ok.specialYearH === 700 && ok.specialCountMax === 3, ok);
}

console.log('\n— 2. 協定年度 —');
{
  t('起算月4: 2027-03 は 2026-04 の年度', A.fiscalYearOf('2027-03', 4) === '2026-04');
  t('起算月4: 2027-04 は 2027-04 の年度（切り替わり）', A.fiscalYearOf('2027-04', 4) === '2027-04');
  t('起算月1: 2026-12 は 2026-01・2027-01 は 2027-01', A.fiscalYearOf('2026-12', 1) === '2026-01' && A.fiscalYearOf('2027-01', 1) === '2027-01');
  t('起算月が壊れていれば 4・月の形が違えば null', A.fiscalYearOf('2027-03', 0) === '2026-04' && A.fiscalYearOf('2027-13', 4) === null && A.fiscalYearOf('2027/03', 4) === null);
  /* 年度の累計は起算月から: 3月は前の年度の続き、4月は新しい年度で0から */
  const rows = [M('2026-04', H(30)), M('2026-05', H(30)), M('2027-02', H(30)), M('2027-03', H(30)), M('2027-04', H(10))];
  const r3 = A.judge(rows, '2027-03', BASE, { holidayKnown: true }), r4 = A.judge(rows, '2027-04', BASE, { holidayKnown: true });
  t('3月の累計は 2026-04〜2027-03（120時間）', r3.yearLegalMin === H(120) && r3.fiscalFrom === '2026-04', r3.yearLegalMin);
  t('4月の累計は 4月だけ（10時間）', r4.yearLegalMin === H(10) && r4.fiscalFrom === '2027-04', r4.yearLegalMin);
  const r4b = A.judge([M('2027-03', H(50)), M('2027-04', H(50))], '2027-04', BASE, { holidayKnown: true });
  t('45時間を超えた月の数も年度で切る（3月の50時間は4月の年度に数えない）', r4b.over45Count === 1, r4b.over45Count);
  const after = A.judge([M('2026-10', H(10)), M('2026-11', H(500))], '2026-10', BASE, { holidayKnown: true });
  t('ym より後の月は累計に入れない', after.yearLegalMin === H(10));
}

console.log('\n— 3. 月の法定外の境目 —');
{
  const w35 = one(H(35, 59)), w36 = one(H(36)), w45 = one(H(45)), o45 = one(H(45, 1));
  t('35時間59分は何も出ない', w35.items.length === 0, codes(w35));
  t('36時間ちょうどは warn', codes(w36) === 'month_warn:warn', codes(w36));
  t('45時間ちょうどは warn で over でない', codes(w45) === 'month_warn:warn', codes(w45));
  t('45時間1分は over（warn を重ねない）', codes(o45) === 'month_over:over', codes(o45));
  t('over の文は「45時間1分」「45時間」の形', (item(o45, 'month_over') || {}).text === '法定外が今月 45時間1分で、36協定の月の上限 45時間を超えています', (item(o45, 'month_over') || {}).text);
  t('月の法定外・休日を含めた時間を返す', o45.monthLegalMin === H(45, 1) && o45.monthWithHolidayMin === H(45, 1));
  /* agreement36 の無い今の設定では、警告は今の画面と同じ 45時間以上・同じ文 */
  const legacy = C.computeMonth({ ym: '2026-10', staff: [], schedule: [], punches: [], config: {} });
  const now45 = A.judge([M('2026-10', H(45))], '2026-10', { legal_holiday: 0 }, { holidayKnown: true });
  const now44 = A.judge([M('2026-10', H(44, 59))], '2026-10', { legal_holiday: 0 }, { holidayKnown: true });
  t('agreement36 が無い設定: 44時間59分は出ない・45時間で warn', now44.items.length === 0 && codes(now45) === 'month_warn:warn', [codes(now44), codes(now45)]);
  t('月の警告の文は kintai-calc.js の今の文と一字一句同じ', (item(now45, 'month_warn') || {}).text === '法定外の時間が月' + legacy.config.overtimeMonthWarnH + '時間以上です（36協定の確認）', (item(now45, 'month_warn') || {}).text);
  /* kintai-calc.js の文の型そのものを読んで確かめる（試験の中に書いた型と比べるだけにしない） */
  const calcSrc = fs.readFileSync(path.join(ROOT, 'kintai-calc.js'), 'utf8');
  t('kintai-calc.js の月の警告の文の型が今も同じ（「法定外の時間が月' + "'" + ' + 値 + ' + "'" + '時間以上です（36協定の確認）」）', calcSrc.indexOf("'法定外の時間が月' + cfg.overtimeMonthWarnH + '時間以上です（36協定の確認）'") >= 0);
  const calc45 = C.computeMonth({ ym: '2026-10', staff: [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }], schedule: [], days: [], config: {}, now: Date.parse('2026-11-10T00:00:00+09:00'),
    punches: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].reduce((a, d, i) => a.concat([{ id: 'x' + i + 'i', staff_id: 'sT01', kind: 'in', at: new Date(C.jstMs(d, 6 * 60)).toISOString(), source: 'tablet', created_at: new Date(C.jstMs(d, 6 * 60)).toISOString() }, { id: 'x' + i + 'o', staff_id: 'sT01', kind: 'out', at: new Date(C.jstMs(d, 6 * 60 + 18 * 60)).toISOString(), source: 'tablet', created_at: new Date(C.jstMs(d, 6 * 60 + 18 * 60)).toISOString() }]), []) });
  const s45 = calc45.people[0].sum, j45 = A.judge([M('2026-10', s45.legalOverMin, s45.holidayMin)], '2026-10', {}, {});
  t('computeMonth が出した月の警告と、同じ月の判定の文が一字一句同じ（法定外 ' + s45.legalOverMin + '分）', s45.legalOverMin === 45 * 60 && s45.warnings.length === 1 && (item(j45, 'month_warn') || {}).text === s45.warnings[0], [s45.warnings, j45.items]);
  const off = A.judge([M('2026-10', H(44))], '2026-10', { legal_holiday: 0, overtimeMonthWarnH: 0 }, { holidayKnown: true });
  t('overtimeMonthWarnH が 0（警告しない）の時は目安の警告を出さない（上限の over は出す）', off.items.length === 0 && codes(A.judge([M('2026-10', H(46))], '2026-10', { legal_holiday: 0, overtimeMonthWarnH: 0 }, { holidayKnown: true })) === 'month_over:over');
  t('月が列に無い時は0で返す（例外を出さない）・ym の形が違えば null', A.judge([], '2026-10', BASE, {}).monthLegalMin === 0 && A.judge(null, '2026-10', BASE).items.length === 0 && A.judge([], '2026-1', BASE) === null);
}

console.log('\n— 4. 法の上限（月100時間） —');
{
  const a = one(H(40), H(60)), b = one(H(40), H(59, 59)), c = one(H(99, 59), 0);
  t('法定外40時間＋休日60時間＝100時間ちょうどは over（特別条項でなくても）', codes(a) === 'month_warn:warn,law_month100:over', codes(a));
  t('99時間59分は 100時間の over でない', !item(b, 'law_month100'), codes(b));
  t('法定外だけで99時間59分は月の上限の over だけ（100時間の項目なし）', codes(c) === 'month_over:over', codes(c));
  t('100時間の文', (item(a, 'law_month100') || {}).text === '法定外＋休日労働が今月 100時間です。月100時間未満の法の上限を超えています（労基法36条6項）', (item(a, 'law_month100') || {}).text);
}

console.log('\n— 5. 2〜6か月の平均 —');
{
  /* 2か月で 160時間＝平均 80時間ちょうど（休日労働を含む） */
  const eq = A.judge([M('2026-09', H(40), H(40)), M('2026-10', H(40), H(40))], '2026-10', BASE, { holidayKnown: true });
  const ov = A.judge([M('2026-09', H(40), H(40)), M('2026-10', H(40), H(40, 2))], '2026-10', BASE, { holidayKnown: true });
  const half = A.judge([M('2026-09', H(40), H(40)), M('2026-10', H(40), H(40, 1))], '2026-10', BASE, { holidayKnown: true });
  t('2か月平均 80時間ちょうどは over でない', !item(eq, 'law_avg80') && eq.avg.n2 === H(80), [codes(eq), eq.avg]);
  t('2か月平均 80時間1分は over', !!item(ov, 'law_avg80') && ov.avg.n2 === H(80, 1), [codes(ov), ov.avg]);
  t('合計で比べる（平均 80時間30秒＝合計 160時間1分も over）', !!item(half, 'law_avg80'), codes(half));
  t('平均の文に窓と平均を出す', /2か月平均 80時間1分/.test((item(ov, 'law_avg80') || {}).text) && /労基法36条6項/.test((item(ov, 'law_avg80') || {}).text), (item(ov, 'law_avg80') || {}).text);
  const cross = A.judge([M('2027-03', H(50), H(35)), M('2027-04', H(50), H(30))], '2027-04', BASE, { holidayKnown: true });
  t('平均は年度をまたいで数える（3月と4月の2か月平均 82時間30分）', cross.avg.n2 === H(82, 30) && !!item(cross, 'law_avg80'), [cross.avg, codes(cross)]);
  const gap = A.judge([M('2026-08', H(90)), M('2026-10', H(70))], '2026-10', BASE, { holidayKnown: true });
  t('窓の中に無い月がある時はその平均を null（0 で埋めない）', gap.avg.n2 === null && gap.avg.n3 === null && gap.avg.n6 === null, gap.avg);
  const six = A.judge(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((ym) => M(ym, H(44), H(36, 1))), '2026-10', BASE, { holidayKnown: true });
  t('6か月の窓まで数える（各月 80時間1分→2〜6か月すべて over）', six.avg.n6 === H(80, 1) && /6か月平均/.test((item(six, 'law_avg80') || {}).text), six.avg);
}

console.log('\n— 6. 年度の累計・特別条項 —');
{
  const yr = (total) => A.judge([M('2026-04', total - H(30)), M('2026-05', H(30))], '2026-05', BASE, { holidayKnown: true });
  t('年度の累計 287時間59分は出ない・288時間ちょうどで warn', !item(yr(H(287, 59)), 'year_warn') && (item(yr(H(288)), 'year_warn') || {}).level === 'warn');
  t('年度の累計 360時間ちょうどは warn・360時間1分で over', item(yr(H(360)), 'year_warn') && !item(yr(H(360)), 'year_over') && (item(yr(H(360, 1)), 'year_over') || {}).level === 'over', [codes(yr(H(360))), codes(yr(H(360, 1)))]);
  const SP = { legal_holiday: 0, agreement36: { monthWarnH: 36, special: true } };
  const s60 = A.judge([M('2026-10', H(60))], '2026-10', SP, { holidayKnown: true });
  t('特別条項: 45時間を超えた月は warn（over でない）', codes(s60) === 'month_special:warn', codes(s60));
  const sp100 = A.judge([M('2026-10', H(80), H(20))], '2026-10', SP, { holidayKnown: true });
  t('特別条項の上限 100（法と同じ）の時は法の項目だけ（二重に出さない）', codes(sp100) === 'month_special:warn,law_month100:over', codes(sp100));
  const SP90 = { legal_holiday: 0, agreement36: { monthWarnH: 36, special: true, specialMonthMaxH: 90, specialAvgH: 70 } };
  const sp90 = A.judge([M('2026-10', H(80), H(10))], '2026-10', SP90, { holidayKnown: true });
  t('特別条項の上限 90: 法定外＋休日 90時間ちょうどで over', codes(sp90) === 'month_special:warn,month_special_max:over', codes(sp90));
  const spa = A.judge([M('2026-09', H(70)), M('2026-10', H(70, 1))], '2026-10', SP90, { holidayKnown: true });
  t('特別条項の平均 70: 70時間1分で over（法の80時間には届かない）', !!item(spa, 'avg_special') && !item(spa, 'law_avg80'), codes(spa));
  const yrS = A.judge([M('2026-04', H(370))], '2026-04', SP, { holidayKnown: true });
  t('特別条項の時の年の上限は 720時間（370時間は over でない）', !item(yrS, 'year_over'), codes(yrS));
  const cnt = (n) => A.judge(Array.from({ length: n }, (_, i) => M('2026-' + String(4 + i).padStart(2, '0'), H(46))), '2026-' + String(3 + n).padStart(2, '0'), SP, { holidayKnown: true });
  t('特別条項: 45時間超の月が6回は over でない・7回で over', cnt(6).over45Count === 6 && !item(cnt(6), 'count_over') && cnt(7).over45Count === 7 && (item(cnt(7), 'count_over') || {}).level === 'over', [cnt(6).over45Count, codes(cnt(7))]);
  t('特別条項でない時は回数で over にしない（月の上限の over は出る）', !item(A.judge(Array.from({ length: 7 }, (_, i) => M('2026-' + String(4 + i).padStart(2, '0'), H(46))), '2026-10', BASE, { holidayKnown: true }), 'count_over'));
}

console.log('\n— 7. 法定休日を決めていない時 —');
{
  const u = A.judge([M('2026-10', H(100))], '2026-10', { agreement36: { monthWarnH: 36 } }, { holidayKnown: false });
  t('holidayKnown:false は holidayUnknown・100時間の項目に注意', u.holidayUnknown === true && (item(u, 'law_month100') || {}).note === A.HOLIDAY_NOTE && /法定休日を決めていないため少なく出ています/.test((item(u, 'law_month100') || {}).text), u.items);
  t('休日労働を含まない月の上限の項目には注意を付けない', !(item(u, 'month_over') || {}).note);
  const d = A.judge([M('2026-10', H(10))], '2026-10', {}, {});
  t('holidayKnown を渡さない時は設定の legal_holiday で決める（null＝決めていない）', d.holidayUnknown === true && A.judge([M('2026-10', H(10))], '2026-10', { legal_holiday: 0 }, {}).holidayUnknown === false);
  const hk = (v) => A.judge([M('2026-10', H(10))], '2026-10', { legal_holiday: v }, {}).holidayUnknown;
  t('legal_holiday が 7・-1・1.5・文字・\'7\' は kintai-calc.js と同じく決めていない扱い（注意を落とさない）・\'6\' は決めた扱い',
    [7, -1, 1.5, 'x', '7', '', null].every((v) => hk(v) === true && C.checkLegalHoliday(v).value === null) && hk('6') === false && hk(6) === false, [7, -1, 1.5, 'x', '7'].map(hk));
  const a2 = A.judge([M('2026-09', H(81)), M('2026-10', H(81))], '2026-10', {}, {});
  t('平均の項目にも注意', (item(a2, 'law_avg80') || {}).note === A.HOLIDAY_NOTE);
}

console.log('\n— 8. 月の途中の見込み —');
{
  const p = A.judge([M('2026-10', H(20), 0, { locked: false, partial: true })], '2026-10', BASE, { holidayKnown: true, elapsedDays: 10, periodDays: 31 });
  t('20時間×31/10＝62時間 を見込みに返し、warn を足す', p.projectedMin === H(62) && (item(p, 'projection') || {}).level === 'warn' && (item(p, 'projection') || {}).text === 'この調子だと月末に45時間を超えます（見込み 62時間）', [p.projectedMin, p.items]);
  const r = A.judge([M('2026-10', 101, 0, { locked: false, partial: true })], '2026-10', BASE, { holidayKnown: true, elapsedDays: 3, periodDays: 31 });
  t('見込みは分で四捨五入（101×31/3＝1043.67→1044）', r.projectedMin === 1044, r.projectedMin);
  const eq = A.judge([M('2026-10', H(15), 0, { locked: false, partial: true })], '2026-10', BASE, { holidayKnown: true, elapsedDays: 10, periodDays: 30 });
  t('見込みが45時間ちょうどは warn を出さない', eq.projectedMin === H(45) && !item(eq, 'projection'));
  const al = A.judge([M('2026-10', H(46), 0, { locked: false, partial: true })], '2026-10', BASE, { holidayKnown: true, elapsedDays: 20, periodDays: 31 });
  t('実績がもう上限を超えている時は見込みの warn を重ねない', !item(al, 'projection') && !!item(al, 'month_over'));
  const no = [{}, { elapsedDays: 0, periodDays: 31 }, { elapsedDays: 32, periodDays: 31 }, { elapsedDays: 'x', periodDays: 31 }].map((o) => A.judge([M('2026-10', H(20), 0, { locked: false, partial: true })], '2026-10', BASE, Object.assign({ holidayKnown: true }, o)).projectedMin);
  t('日数が無い・0・期間より多い・数でない時は見込みなし', no.every((v) => v === null), no);
  t('締めた月・partial でない月は見込みなし', A.judge([M('2026-10', H(20))], '2026-10', BASE, { holidayKnown: true, elapsedDays: 10, periodDays: 31 }).projectedMin === null);
  t('時間の文: 30分・45時間・45時間30分', A.fmtH(30) === '30分' && A.fmtH(H(45)) === '45時間' && A.fmtH(H(45, 30)) === '45時間30分');
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
