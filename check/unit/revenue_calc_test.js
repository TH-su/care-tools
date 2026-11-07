/* 収支の見通しの純関数（revenue-calc.js）の試験（2026-11-07 新設・本人指示「ゴール：」2026-11-07）
   実行: node check/unit/revenue_calc_test.js
   守ること: 介護報酬＝（限度額−2000）×単価／入居月は日割り・5日以降は差し引かない／2か月後の入金／
            入院・退去で2か月後が日割りで下がる／施設費は前払い（入居月は当月日割り＋翌月分）／
            月の日数（30・31・うるう年の2月）／入居と退去が同じ月／崩れた入力／stateLog から入院の期間
   ★データはすべて架空（「架空 甲」など・金額も架空の表）。出力に console を使わない。 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', '..', 'revenue-calc.js'));

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

const LIMITS = { '要支援1': 5032, '要支援2': 10531, '要介護1': 16765, '要介護2': 19705, '要介護3': 27048, '要介護4': 30938, '要介護5': 36217 };
const FEES = { '要介護1': 100000, '要介護2': 99000, '要介護3': 98000, '要介護4': 97000, '要介護5': 96000 };
function run(residents, start, months, extra) {
  return C.compute(Object.assign({ residents, start, months: months || 6, limits: LIMITS, fees: FEES, feePerUnit: 10 }, extra || {}));
}
function m(out, ym) { return out.months.find(x => x.ym === ym); }
function row(out, ym, key) { const M = m(out, ym); return M && M.rows.find(r => r.key === key); }

group('1. 1か月まるごと居た月の介護報酬＝（限度額−2000）×10円');
{
  const o = run([{ key: 'a', name: '架空 甲', careLevel: '要介護3', admit: '2025-01-15' }], '2026-08', 3);
  t('9月の入金は7月提供分の (27048−2000)×10 = 250,480円', row(o, '2026-09', 'a').care === 250480, row(o, '2026-09', 'a'));
  t('提供の月（発生）も同じ額', row(o, '2026-09', 'a').careAccrual === 250480);
  t('施設費は介護度の月額そのまま（翌月分を前の月に受け取る）', row(o, '2026-09', 'a').facility === 98000 && row(o, '2026-09', 'a').facilityAccrual === 98000);
  t('合計＝施設費＋介護報酬', m(o, '2026-09').total === 98000 + 250480);
}

group('2. 8/10 入居（本人の例）');
{
  const o = run([{ key: 'b', name: '架空 乙', careLevel: '要介護2', admit: '2026-08-10' }], '2026-08', 6);
  const aug = row(o, '2026-08', 'b');
  /* 8月は31日・10日〜31日＝22日 */
  t('8月の施設費の入金＝8月の日割り（22/31）＋9月1か月分', aug.facility === Math.round(99000 * 22 / 31) + 99000, aug);
  t('9月の入金＝10月分（翌月分）', row(o, '2026-09', 'b').facility === 99000);
  t('8月・9月は介護報酬の入金なし（入居前の提供分は無い）', aug.care === 0 && row(o, '2026-09', 'b').care === 0);
  t('8月分の介護報酬の日割りが10月末に入る（5日以降の入居なので差し引かない）', row(o, '2026-10', 'b').care === Math.round(19705 * 22 / 31 * 10), row(o, '2026-10', 'b'));
  t('10月の入金の行は「8月提供分」と分かる', row(o, '2026-10', 'b').careFor === '2026-08' && row(o, '2026-10', 'b').svcAdmit === true && row(o, '2026-10', 'b').svcDeducted === false);
  t('11月は9月分＝まるごと（−2000あり）', row(o, '2026-11', 'b').care === (19705 - 2000) * 10);
  t('8月の発生は日割り（差し引かない）', aug.careAccrual === Math.round(19705 * 22 / 31 * 10));
}

group('3. 5日の境（4日入居は差し引く・5日入居は差し引かない）');
{
  const o = run([{ key: 'c4', careLevel: '要介護4', admit: '2026-09-04' }, { key: 'c5', careLevel: '要介護4', admit: '2026-09-05' }], '2026-11', 1);
  t('9/4 入居: (30938−2000)×27/30×10', row(o, '2026-11', 'c4').care === Math.round((30938 - 2000) * 27 / 30 * 10), row(o, '2026-11', 'c4'));
  t('9/5 入居: 30938×26/30×10', row(o, '2026-11', 'c5').care === Math.round(30938 * 26 / 30 * 10), row(o, '2026-11', 'c5'));
  const o2 = run([{ key: 'c1', careLevel: '要介護4', admit: '2026-09-01' }], '2026-11', 1);
  t('1日の入居はまるごとの月と同じ（−2000あり）', row(o2, '2026-11', 'c1').care === (30938 - 2000) * 10);
  const o3 = run([{ key: 'c5', careLevel: '要介護4', admit: '2026-09-05' }], '2026-11', 1, { cutoffDay: 10 });
  t('差し引きをやめる日を10日にすると 9/5 入居は差し引く', row(o3, '2026-11', 'c5').care === Math.round((30938 - 2000) * 26 / 30 * 10));
}

group('4. 入院で2か月後が日割りで下がる');
{
  /* 9/11 入院 → 9/21 戻る＝11日〜20日の10日が入院 */
  const o = run([{ key: 'd', careLevel: '要介護5', admit: '2024-04-01', absences: [{ from: '2026-09-11', to: '2026-09-21' }] }], '2026-09', 3);
  const full = (36217 - 2000) * 10;
  t('11月の入金（9月分）は 20/30 の日割り', row(o, '2026-11', 'd').care === Math.round(full * 20 / 30), row(o, '2026-11', 'd'));
  t('減った分（入院で減る分）が出る', row(o, '2026-11', 'd').careLostAbsent === full - Math.round(full * 20 / 30) && m(o, '2026-11').careLostAbsent > 0);
  t('入院の日数が分かる', row(o, '2026-11', 'd').svcAbsent === 10);
  t('9月・10月の入金（7月・8月分）は減らない', row(o, '2026-09', 'd').care === full && row(o, '2026-10', 'd').care === full);
  t('入院中も施設費は変えない（仮置き）', row(o, '2026-09', 'd').facility === 96000 && row(o, '2026-10', 'd').facility === 96000);
  /* 戻っていない入院（to が空） */
  const o2 = run([{ key: 'e', careLevel: '要介護3', admit: '2024-04-01', absences: [{ from: '2026-10-16' }] }], '2026-12', 2);
  t('戻っていない入院: 10月は15日分だけ（12月の入金）', row(o2, '2026-12', 'e').care === Math.round((27048 - 2000) * 15 / 31 * 10), row(o2, '2026-12', 'e'));
  t('戻っていない入院: 11月はまるごと入院＝1月の入金は0円', row(o2, '2027-01', 'e').care === 0);
}

group('5. 退去（退去日まで居たとして日割り）');
{
  const o = run([{ key: 'f', careLevel: '要介護2', admit: '2024-04-01', leave: '2026-10-15' }], '2026-09', 4);
  t('9月の入金に10月分の施設費の日割り（15/31）', row(o, '2026-09', 'f').facility === Math.round(99000 * 15 / 31), row(o, '2026-09', 'f'));
  t('10月の入金に施設費なし（11月はもう居ない）', row(o, '2026-10', 'f').facility === 0);
  t('12月の入金は10月分の介護報酬の日割り（15/31）', row(o, '2026-12', 'f').care === Math.round((19705 - 2000) * 15 / 31 * 10), row(o, '2026-12', 'f'));
  const o2 = run([{ key: 'f', careLevel: '要介護2', admit: '2024-04-01', leave: '2026-10-15' }], '2027-01', 1);
  t('退去の2か月後より先の月には行を出さない', m(o2, '2027-01').rows.length === 0 && m(o2, '2027-01').total === 0);
}

group('6. 入居と退去が同じ月・月の日数');
{
  const o = run([{ key: 'g', careLevel: '要介護1', admit: '2026-11-10', leave: '2026-11-19' }], '2026-11', 3);
  t('施設費の入金は11月の日割り10日分だけ（12月分は無い）', row(o, '2026-11', 'g').facility === Math.round(100000 * 10 / 30), row(o, '2026-11', 'g'));
  t('1月の入金は11月分の日割り（5日以降なので差し引かない）', row(o, '2027-01', 'g').care === Math.round(16765 * 10 / 30 * 10));
  const leap = run([{ key: 'h', careLevel: '要介護3', admit: '2028-02-15' }], '2028-04', 1);
  t('うるう年の2月は29日で割る（15日〜29日＝15日）', row(leap, '2028-04', 'h').care === Math.round(27048 * 15 / 29 * 10), row(leap, '2028-04', 'h'));
  t('daysIn: 2027-02=28・2028-02=29・2026-04=30', C.daysIn('2027-02') === 28 && C.daysIn('2028-02') === 29 && C.daysIn('2026-04') === 30);
}

group('7. 内訳の合計＝月の合計（1人ずつ四捨五入してから足す）');
{
  const rs = [];
  for (let i = 0; i < 16; i++) rs.push({ key: 'k' + i, name: '架空 ' + i, careLevel: '要介護' + (1 + i % 5), admit: '2026-0' + (1 + i % 9) + '-' + String(1 + (i * 3) % 28).padStart(2, '0') });
  const o = run(rs, '2026-06', 8);
  const ok = o.months.every(M => M.rows.reduce((s, r) => s + r.facility, 0) === M.facility && M.rows.reduce((s, r) => s + r.care, 0) === M.care && M.total === M.facility + M.care);
  t('16名×8か月で内訳の合計が一致', ok);
  t('人数は居た方だけを数える', o.months.every(M => M.people === M.rows.filter(r => r.stay > 0).length));
}

group('8. 崩れた入力');
{
  const o = run([{ key: 'x', name: '架空 丙', careLevel: '', admit: '2026-02-30' }, { key: 'y', careLevel: '要介護3', admit: '2026-05-01', leave: '2026-04-01' }], '2026-06', 1);
  t('始めの月が無ければ ok:false', C.compute({}).ok === false);
  t('介護度が分からない方は介護報酬0円で、知らせる文が出る', row(o, '2026-06', 'x').care === 0 && o.warnings.some(w => w.key === 'x'));
  t('読めない入居日は知らせる', o.warnings.find(w => w.key === 'x').notes.some(s => /入居日/.test(s)));
  t('退去日が入居日より前なら退去日を使わない', row(o, '2026-06', 'y').facility === 98000 && o.warnings.some(w => w.key === 'y'));
  const o2 = C.compute({ start: '2026-06', months: 1, residents: [{ key: 'z', careLevel: '要介護3', admit: '2020-01-01', absences: [{ from: 'x' }, { from: '2026-04-10', to: '2026-04-01' }, null] }], limits: LIMITS, fees: FEES });
  t('壊れた入院の期間は捨てる', o2.ok && row(o2, '2026-06', 'z').care === (27048 - 2000) * 10);
  t('限度額が無い介護度は0円（推測しない）', run([{ key: 'w', careLevel: '要介護3', admit: '2020-01-01' }], '2026-06', 1, { limits: {} }).months[0].care === 0);
  t('入居日が空の方には知らせる文が出る', run([{ key: 'n', careLevel: '要介護3' }], '2026-06', 1).warnings.some(w => w.key === 'n' && /入居日が入っていません/.test(w.notes[0])));
  t('空の値（\'\'・null）は既定（lag 2・2000単位・10円）で数える', (function () { const o = C.compute({ start: '2026-06', months: 1, lagMonths: '', deductUnits: null, feePerUnit: '', residents: [], limits: LIMITS }); return o.params.lag === 2 && o.params.deductUnits === 2000 && o.params.feePerUnit === 10; })());
  t('months の上限は36', C.compute({ start: '2026-01', months: 999, residents: [] }).months.length === 36);
}

group('9. 介護度の書き方・入院の記録（stateLog）');
{
  t('normLevel: 要介護3・介護3・3・全角３・要支援1', C.normLevel('要介護3') === '要介護3' && C.normLevel('介護3') === '要介護3' && C.normLevel('3') === '要介護3' && C.normLevel('要介護３') === '要介護3' && C.normLevel('要支援1') === '要支援1');
  t('normLevel: 分からない書き方は空', C.normLevel('自立') === '' && C.normLevel('6') === '' && C.normLevel(null) === '');
  t('jstDate: UTC 15:30 は日本の翌日', C.jstDate('2026-09-10T15:30:00.000Z') === '2026-09-11' && C.jstDate('壊れた') === '');
  const log = [
    { ts: '2026-10-20T01:00:00Z', field: 'hospitalized', val: true },
    { ts: '2026-09-21T01:00:00Z', field: 'hospitalized', val: false },
    { ts: '2026-09-11T01:00:00Z', field: 'hospitalized', val: true },
    { ts: '2026-09-12T01:00:00Z', field: 'hospitalized', val: true },
    { ts: '2026-08-01T01:00:00Z', field: 'hospitalized', val: false },
    { ts: '2026-07-01T01:00:00Z', field: 'other', val: true }
  ];
  const ab = C.absencesFromStateLog(log);
  t('古い順の期間・続いた入院は最初の日・戻っていない入院は to が空', JSON.stringify(ab) === JSON.stringify([{ from: '2026-09-11', to: '2026-09-21' }, { from: '2026-10-20', to: '' }]), ab);
  t('配列でない時は空', C.absencesFromStateLog(null).length === 0);
}

group('10. 料金表・表示');
{
  const f = C.normFees({ '要介護1': '110,000', '要介護2': 105000.5, '要介護3': -1, '要介護4': '', '要介護5': 99000, toString: 1 });
  t('normFees: 文字の区切りは読む・小数・負・空は捨てる・知らない鍵は持たない', f['要介護1'] === 110000 && !('要介護2' in f) && !('要介護3' in f) && !('要介護4' in f) && f['要介護5'] === 99000 && !Object.prototype.hasOwnProperty.call(f, 'toString'));
  t('yen: 3桁区切り・負は −', C.yen(1234567) === '1,234,567' && C.yen(-500) === '−500' && C.yen(0) === '0');
  t('ymLabel', C.ymLabel('2026-08') === '2026年8月' && C.ymLabel('x') === '');
  t('addMonths: 年をまたぐ', C.addMonths('2026-11', 2) === '2027-01' && C.addMonths('2026-01', -1) === '2025-12');
}

group('11. 訪問と通所に分ける（週間計画の予定の基本単位の割合・2026-11-07）');
{
  const RM = { visitBase: { '身体１': 244, '生活２': 179 }, sogoVisit: { 'A2111': { units: 1176 } },
               daycareBase: { '要介護3': { '3h': 426, '4h': 448, '7h': 800 } } };
  const ev = (o) => Object.assign({ serviceType: 'visit' }, o);
  const W = 4.3;
  const sh = C.serviceShare([ev({ category: '身体１' }), ev({ category: '身体１' }), { serviceType: 'daycare', startTime: '09:00', endTime: '13:00' }], '要介護3', RM);
  t('訪問2回（244×2）と通所1回（4時間ちょうど＝3h の426）の割合', Math.abs(sh - (488 * W) / (488 * W + 426 * W)) < 1e-12, sh);
  t('4時間30分は 4h（448）', Math.abs(C.serviceShare([{ serviceType: 'daycare', startTime: '09:00', endTime: '13:30' }, ev({ category: '生活２' })], '3', RM) - (179 / (179 + 448))) < 1e-12);
  t('総合事業の区分は月の単位を1回だけ数える', Math.abs(C.serviceShare([ev({ category: 'A2111' }), ev({ category: 'A2111' }), { serviceType: 'daycare', startTime: '09:00', endTime: '16:30' }], '要介護3', RM) - (1176 / (1176 + 800 * W))) < 1e-12);
  t('通所だけの方は 0・訪問だけの方は 1', C.serviceShare([{ serviceType: 'daycare', startTime: '09:00', endTime: '12:00' }], '要介護3', RM) === 0 && C.serviceShare([ev({ category: '身体１' })], '要介護3', RM) === 1);
  t('予定が無い・単位の分からない予定だけの方は null（推測しない）', C.serviceShare([], '要介護3', RM) === null && C.serviceShare([ev({ category: '知らない区分' }), { serviceType: 'daycare', startTime: '09:00', endTime: '13:00' }], '要支援1', RM) === null);
  t('予定に週間計画の単位（ev.units・加算込み）があればそれを使う', Math.abs(C.serviceShare([ev({ category: '身体１', units: 293 }), { serviceType: 'daycare', startTime: '09:00', endTime: '13:00', units: 600 }], '要介護3', RM) - 293 / (293 + 600)) < 1e-12);
  t('ev.units が数でない・0以下の予定は基本単位で数える', Math.abs(C.serviceShare([ev({ category: '身体１', units: '293' }), { serviceType: 'daycare', startTime: '09:00', endTime: '13:00', units: 0 }], '要介護3', RM) - 244 / (244 + 426)) < 1e-12);
  t('壊れた時刻の通所は数えない', C.serviceShare([{ serviceType: 'daycare', startTime: '13:00', endTime: '09:00' }, ev({ category: '身体１' })], '要介護3', RM) === 1);
  const o = run([{ key: 's', careLevel: '要介護3', admit: '2025-01-01', visitShare: 0.3 }, { key: 'u', careLevel: '要介護2', admit: '2025-01-01' }], '2026-08', 2);
  const r = row(o, '2026-08', 's'), u = row(o, '2026-08', 'u'), M = m(o, '2026-08');
  t('訪問＝四捨五入・通所＝残り（足すと介護報酬）', r.careVisit === Math.round(r.care * 0.3) && r.careVisit + r.careDay === r.care && r.careOther === 0, r);
  t('利用した月の分も同じ割合で分ける', r.careVisitAccrual + r.careDayAccrual === r.careAccrual && r.careVisitAccrual === Math.round(r.careAccrual * 0.3));
  t('割合の無い方は「分けられない分」', u.careOther === u.care && u.careVisit === 0 && u.careDay === 0);
  t('月の合計: 訪問＋通所＋分けられない分＝介護報酬', M.careVisit + M.careDay + M.careOther === M.care && M.careVisitAccrual + M.careDayAccrual + M.careOtherAccrual === M.careAccrual);
  t('割合が 0〜1 の外・数でない時は使わない', row(run([{ key: 'z', careLevel: '要介護3', admit: '2025-01-01', visitShare: 1.5 }], '2026-08', 1), '2026-08', 'z').careOther > 0 && row(run([{ key: 'z', careLevel: '要介護3', admit: '2025-01-01', visitShare: '0.5' }], '2026-08', 1), '2026-08', 'z').careOther > 0);
}

group('12. 過去の月から始める（表示の始まりを半年前にする・2026-11-07）');
{
  /* 6月から: 4/10 入居の方は、6月の入金に4月分の日割りが入る */
  const o = run([{ key: 'p', careLevel: '要介護3', admit: '2026-04-10' }], '2026-06', 6);
  t('6月の入金に4月分の日割り（21/30・差し引かない）', row(o, '2026-06', 'p').care === Math.round(27048 * 21 / 30 * 10) && row(o, '2026-06', 'p').careFor === '2026-04', row(o, '2026-06', 'p'));
  t('6月の施設の利用料の入金は7月分', row(o, '2026-06', 'p').facility === 98000);
  t('過去の月の人数も数える', m(o, '2026-06').people === 1);
}

say('\n合格 ' + pass + ' ／ 不合格 ' + fail);
process.exit(fail ? 1 : 0);
