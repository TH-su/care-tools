/* シフト分析（shift-analyzer.html）── 常勤換算と特定事業所加算（訪問介護）の人の要件の「値」を、規則から手で計算した数字で確かめる（2026-10-25 新設）
   実行: node check/unit/shift_tokutei_value_test.js
   読む画面を差し替える時: SHIFT_ANALYZER_HTML=<画面のファイル> node check/unit/shift_tokutei_value_test.js

   公開中の1枚から src/logic/timecalc.js と src/logic/aggregate.js の区間を切り出して動かし、
   window.ShiftAggregate の fteStdByDivision・tokuteiMonth・tokuteiPeriod・tokuteiWindows・svcMgrCheck を取る（写経しない）。
   期待値はコードを走らせて写したものではなく、下の規則から手で計算した値。計算の筋道は各試験の名前に書く。
   2つの画面（シフト作成・シフト分析）の写しが一字一句同じことは shift_fte_copy_same_test.js が確かめる。

   規則の出どころと確度:
     1 介護福祉士 30%以上、または 介護福祉士・実務者研修修了者・看護師 50%以上（告示95号 第三号イ）……国の文書
     2 割合は「前年度（3月を除く）の1月あたりの平均」か「届出の前3月の平均」で見る（老企36号）……国の文書
     3 常勤換算＝暦月の勤務延時間 ÷ 常勤の勤務すべき時間（4週 160h）。1人の上限は常勤の時間……香川県の資料
     4 常勤換算の端数は小数点第2位以下切り捨て、割合も小数点第2位以下切り捨て……宮崎県の計算様式
       （県の様式は分母・分子とも切り捨て）
     5 分母（訪問介護員等の総数）は切り捨てず、小数点第3位で切り上げて第2位まで……当社の決め
       （分母を切り捨てると割合が上に振れ、届いていないのに「満たす」と出るため・割合を甘く見せない側）
     6 常勤（A・B）の休暇（有休）は勤務とみなし、非常勤の休暇は入れない……事務連絡（平成14年3月28日）
     7 今の数え方：常勤で専従（A）で主区分が訪問の職員は、訪問の勤務が少しでもあれば1人（月の途中の入退職でも）。
       主区分がほかの A の訪問の勤務は時間で換算する……国の文書では未確認。代表者の決定 2026-10-25 で据え置き
       （入退職日が無く、休みの多い普通の月と見分けられないため）
     8 サービス提供責任者は 介護福祉士で実務経験3年以上、または 実務者研修・看護師で5年以上（告示95号 第三号イ(6)）。
       起算日を1日目に数える（2023-04-01 起算なら 2026-03-31 で満3年）……当社の読み
   職員は 'S1' 等の記号だけを使う（氏名は使わない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.SHIFT_ANALYZER_HTML || path.join(ROOT, 'shift-analyzer.html'), 'utf8');

function section(html, file) {
  const head = '/* ===== ' + file + ' ===== */';
  const s = html.indexOf(head);
  if (s < 0) throw new Error('shift-analyzer.html に ' + file + ' がありません');
  const e = html.indexOf('\n/* ===== src/', s + head.length);   /* 区切りは行頭の「/* ===== src/…」だけ */
  return html.slice(s, e < 0 ? html.indexOf('</script>', s) : e);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

const box = { window: {}, Math, Date, String, Object, RegExp, Array, JSON, Number, isNaN, parseInt };
vm.createContext(box);
vm.runInContext(section(HTML, 'src/logic/timecalc.js'), box, { filename: 'shift-analyzer.html(timecalc.js)' });
vm.runInContext(section(HTML, 'src/logic/aggregate.js'), box, { filename: 'shift-analyzer.html(aggregate.js)' });
const AG = box.window.ShiftAggregate;

console.log('\n— 0. 切り出せる —');
const FN = ['fteStdByDivision', 'tokuteiMonth', 'tokuteiPeriod', 'tokuteiWindows', 'svcMgrCheck'];
t('timecalc.js・aggregate.js を切り出して動かすと window.ShiftAggregate に5つの関数が出る', !!AG && FN.every(n => typeof AG[n] === 'function'));
if (!AG || !FN.every(n => typeof AG[n] === 'function')) { console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + (fail + 1) + ' 件失敗 ──────────'); process.exit(1); }

const H = 60;   /* 1時間＝60分 */
const DEF = {};                                  /* 既定: fteBaseHours 160・paidLeaveCountsAsWork true */
const NOPAID = { paidLeaveCountsAsWork: false };
/* 1人の月の結果（computeStaffMonth の totals の形）。有休を実働に入れる設定では divMin28 に有休が入っている */
function R(visitH, paidH, settings) {
  const p = (paidH || 0) * H, inWork = !(settings && settings.paidLeaveCountsAsWork === false);
  return { totals: { divMin28: { 訪問: visitH * H + (inWork ? p : 0) }, paidMin28: p, paidDivMin28: p ? { 訪問: p } : {} } };
}
const ST = (id, form, quals, extra) => Object.assign({ id, mainDivision: '訪問', qualifications: quals || [] }, form ? { workForm: form } : {}, extra || {});
const KF = ['介護福祉士'];
function month(staff, results, settings, ym) { return AG.tokuteiMonth(staff, results, settings || DEF, ym || '2026-07'); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n— a. 勤務形態ごとの数え方 —');
{
  const staff = [ST('S1', 'A'), ST('S2', 'C'), ST('S3', 'D'), ST('S4', '')];
  const r = { S1: R(160), S2: R(80), S3: R(200), S4: R(200) };
  const m = month(staff, r);
  t('常勤A（訪問 160h）＝1人', m.den.full === 1, m.den);
  t('非常勤C 80h＋D 200h（上限160h）＋未設定 200h（上限160h）＝(80+160+160)h＝400h → 400÷160＝2.5', m.den.convMin === 400 * H, m.den.convMin);
  t('総数＝1＋2.5＝3.5・4人', m.den.fte === 3.5 && m.persons === 4, { fte: m.den.fte, persons: m.persons });
  const f = AG.fteStdByDivision(staff, r, DEF)['訪問'];
  t('標準様式1（fteStdByDivision）: A は1人、C 80h・D 200h→160h・未設定は上限なしで 200h＝440h', f.full === 1 && f.convMin === 440 * H, { full: f.full, convMin: f.convMin });
  t('標準様式1: 440h÷160h＝2.75 → 小数点第2位以下切り捨て 2.7・合計 3.7', f.conv === 2.7 && f.total === 3.7, { conv: f.conv, total: f.total });
}

console.log('\n— b. 休暇 —');
[DEF, NOPAID].forEach((s) => {
  const lab = '（有休を実働に入れる設定 ' + (s.paidLeaveCountsAsWork === false ? 'false' : 'true') + '）';
  const staff = [ST('S1', 'A'), ST('S2', 'B'), ST('S3', 'C'), ST('S4', 'D')];
  const r = { S1: R(120, 40, s), S2: R(120, 40, s), S3: R(80, 16, s), S4: R(0, 40, s) };
  const m = month(staff, r, s);
  t('常勤A: 訪問 120h＋有休 40h＝160h＝1人' + lab, m.den.full === 1, m.den);
  t('常勤B: 120h＋有休 40h＝160h、非常勤C: 80h（有休 16h は入れない）→ (160+80)h÷160＝1.5' + lab, m.den.convMin === 240 * H, m.den.convMin);
  t('非常勤D: 有休 40h だけ＝勤務0で数えない → 3人・総数 2.5' + lab, m.persons === 3 && m.den.fte === 2.5, { persons: m.persons, fte: m.den.fte });
});

{
  /* 有休を実働に入れる設定（既定）では divMin28 に有休が入っている＝常勤に足し直さない・非常勤からは引く */
  const b = month([ST('S1', 'B')], { S1: R(100, 20) });
  t('既定の設定で 常勤B 100h＋有休 20h＝120h（有休は divMin28 に入り済み・二重に足さない）→ 120÷160＝0.75（二重なら 140h で 0.88）', b.den.fte === 0.75, b.den);
  const c = month([ST('S1', 'C')], { S1: R(100, 20) });
  t('既定の設定で 非常勤C 100h＋有休 20h → 有休を引いて 100h → 100÷160＝0.625 → 分母は第3位で切り上げ 0.63（引かなければ 0.75）', c.den.convMin === 100 * H && c.den.fte === 0.63, c.den);
}

console.log('\n— c. 月の途中の入退職・数えない職員 —');
{
  /* 今の数え方：A は勤務が少しでもあれば1人（月の途中の入退職でも）。国の文書では未確認。
   * 代表者の決定 2026-10-25 で据え置き（入退職日が無く、休みの多い普通の月と見分けられないため） */
  const m = month([ST('S1', 'A', KF)], { S1: R(90) });
  t('c-A: 今の数え方：A は勤務が少しでもあれば1人（月の途中の入退職でも）→ 月の途中の入職（訪問 90h）も1人・介護福祉士も1人（国の文書では未確認・代表者の決定 2026-10-25 で据え置き）',
    m.den.full === 1 && m.den.convMin === 0 && m.den.fte === 1 && m.kf.fte === 1, { den: m.den, kf: m.kf });
  const lv = month([ST('S1', 'A')], { S1: R(100, 20, NOPAID) }, NOPAID);
  t('c-A: 今の数え方：A で 100h＋有休 20h（休みの多い月）も1人（代表者の決定 2026-10-25 で据え置き）', lv.den.full === 1 && lv.den.fte === 1, lv.den);
  const sh = month([ST('S1', 'A', KF, { shortTime: true })], { S1: R(112) });
  t('c-A: 今の数え方：短時間勤務制度の A で 112h も1人（代表者の決定 2026-10-25 で据え置き）', sh.den.full === 1 && sh.den.fte === 1 && sh.kf.fte === 1, { den: sh.den, kf: sh.kf });
  const fac = month([ST('S1', 'A', KF, { mainDivision: '施設' })], { S1: { totals: { divMin28: { 施設: 120 * H, 訪問: 40 * H }, paidMin28: 0, paidDivMin28: {} } } });
  t('c-A: 主区分が施設の A の訪問の勤務 40h は1人にせず時間で換算 → 40÷160＝0.25', fac.den.full === 0 && fac.den.convMin === 40 * H && fac.den.fte === 0.25, fac.den);
}
{
  const sh = month([ST('S1', 'A', KF, { shortTime: true })], { S1: R(120) });
  t('短時間勤務制度の A で 120h（週30h×4週）＝1人', sh.den.full === 1 && sh.den.fte === 1, sh.den);
  const c = month([ST('S1', 'C')], { S1: R(40) });
  t('非常勤C の月の途中（40h）は 40÷160＝0.25', c.den.fte === 0.25, c.den);
  const staff = [ST('S1', 'C', [], { active: false }), ST('S2', 'C', [], { countInHeadcount: false }), ST('S3', 'C')];
  const x = month(staff, { S1: R(160), S2: R(160), S3: R(80) });
  t('休職（active:false）・頭数に入れない（countInHeadcount:false）は数えない → 1人・0.5', x.persons === 1 && x.den.fte === 0.5, { persons: x.persons, fte: x.den.fte });
}

console.log('\n— d. 端数 —');
{
  const m = month([ST('S1', 'C', KF), ST('S2', 'C')], { S1: R(76), S2: R(84) });
  t('分子: 介護福祉士 76h÷160＝0.475 → 小数点第2位以下切り捨て 0.4（四捨五入なら 0.5）', m.kf.fte === 0.4, m.kf);
  t('分母: (76+84)h÷160＝1 → 1', m.den.fte === 1, m.den);
  /* A 介護福祉士3人（160h ずつ）＋非常勤7人（160h ずつ）＋非常勤1人（10分） */
  const staff = [], r = {};
  for (let i = 1; i <= 3; i++) { staff.push(ST('A' + i, 'A', KF)); r['A' + i] = R(160); }
  for (let i = 1; i <= 7; i++) { staff.push(ST('C' + i, 'C')); r['C' + i] = R(160); }
  staff.push(ST('C8', 'C')); r.C8 = { totals: { divMin28: { 訪問: 10 }, paidMin28: 0, paidDivMin28: {} } };
  const b = month(staff, r);
  t('分母: 3＋(7×160h＋10分)÷160h＝10.00104… → 小数点第3位で切り上げ 10.01（県の様式の切り捨てなら 10.0）', b.den.fte === 10.01, b.den);
  const P = AG.tokuteiPeriod([b]);
  t('割合: 3÷10.01＝29.97% → 29.9%・30% に届かない（県の様式どおり分母を切り捨てると 30.0% で届くと出る）', P.kfPct === 29.9 && P.ok5 === false, { kfPct: P.kfPct, ok5: P.ok5 });
  const q = AG.tokuteiPeriod([{ den: { fte: 9.68 }, kf: { fte: 2.9 }, g50: { fte: 4.8 }, g50j: { fte: 4.8 } }]);
  t('割合: 2.9÷9.68＝29.958% → 小数点第2位以下切り捨て 29.9%（四捨五入なら 30.0%）・4.8÷9.68＝49.58% → 49.5% → 満たさない',
    q.kfPct === 29.9 && q.g50Pct === 49.5 && q.ok5 === false, { kfPct: q.kfPct, g50Pct: q.g50Pct, ok5: q.ok5 });
}

console.log('\n— e. 期間 —');
{
  const mk = (den, kf, g50) => ({ den: { fte: den }, kf: { fte: kf }, g50: { fte: g50 }, g50j: { fte: g50 } });
  const P = AG.tokuteiPeriod([mk(10, 3.1, 4), mk(10.01, 2.9, 4)]);
  t('合計どうしで割る: (3.1+2.9)÷(10+10.01)＝6÷20.01＝29.985% → 29.9%（平均の分母を 10.0 に丸めて割ると 30.0% になる）',
    P.n === 2 && P.kfPct === 29.9 && P.ok5 === false, { n: P.n, kfPct: P.kfPct, ok5: P.ok5 });
  const k30 = AG.tokuteiPeriod([mk(10, 3, 4), mk(10, 3, 4)]);
  t('介護福祉士 6÷20＝30.0% → 満たす（30%以上）', k30.kfPct === 30 && k30.ok5 === true, { kfPct: k30.kfPct, ok5: k30.ok5 });
  const g = AG.tokuteiPeriod([mk(10, 1, 5), mk(10, 1, 5)]);
  t('介護福祉士 10% でも、介護福祉士・実務者研修・看護師 10÷20＝50.0% → 満たす（50%以上）', g.kfPct === 10 && g.g50Pct === 50 && g.ok5 === true, { kfPct: g.kfPct, g50Pct: g.g50Pct, ok5: g.ok5 });
  const g2 = AG.tokuteiPeriod([mk(10, 1, 4.9), mk(10, 1, 5)]);
  t('9.9÷20＝49.5% → 満たさない', g2.g50Pct === 49.5 && g2.ok5 === false, { g50Pct: g2.g50Pct, ok5: g2.ok5 });
  const z = AG.tokuteiPeriod([]);
  t('月が無い期間は割合なし・満たさない', z.n === 0 && z.kfPct === null && z.ok5 === false, z);
}

console.log('\n— f. 窓（前年度・今年度・直近3月）—');
{
  const seq = (y, m, n) => { const o = []; for (let i = 0; i < n; i++) { const mm = (m - 1 + i) % 12 + 1, yy = y + Math.floor((m - 1 + i) / 12); o.push(yy + '-' + (mm < 10 ? '0' : '') + mm); } return o; };
  const PREV_2025 = seq(2025, 4, 11);   /* 2025-04〜2026-02（3月を除く11か月） */
  const cases = [
    ['2026-07', PREV_2025, ['2026-04', '2026-05', '2026-06', '2026-07'], ['2026-04', '2026-05', '2026-06']],
    ['2027-03', PREV_2025, seq(2026, 4, 11), ['2026-12', '2027-01', '2027-02']],
    ['2026-01', seq(2024, 4, 11), seq(2025, 4, 10), ['2025-10', '2025-11', '2025-12']],
    ['2026-04', PREV_2025, ['2026-04'], ['2026-01', '2026-02', '2026-03']]
  ];
  t('前年度は前年4月〜2月の11か月（2025-04〜2026-02）', PREV_2025.length === 11 && PREV_2025[0] === '2025-04' && PREV_2025[10] === '2026-02');
  cases.forEach(([ym, prev, cur, last3]) => {
    const W = AG.tokuteiWindows(ym);
    t(ym + ': 前年度＝' + prev[0] + '〜' + prev[prev.length - 1] + '（3月を除く）', same(W.prevFy, prev), W.prevFy);
    t(ym + ': 今年度＝' + cur[0] + '〜' + cur[cur.length - 1] + '（3月を除く・' + cur.length + 'か月）', same(W.curFy, cur), W.curFy);
    t(ym + ': 直近3月＝' + last3.join('・'), same(W.last3, last3), W.last3);
  });
}

console.log('\n— g. サービス提供責任者 —');
{
  const kf = ST('S1', 'A', KF), jt = ST('S2', 'C', ['実務者研修']), ns = ST('S3', 'C', ['看護師']), no = ST('S4', 'C', ['初任者研修']);
  const a = AG.svcMgrCheck(kf, '2023-04-01', '2026-03-31');
  t('介護福祉士: 2023-04-01 起算で 2026-03-31 時点＝満3年（起算日を1日目に数える）→ 満たす', a.ok === true && a.years === 3 && a.need === 3, a);
  const a2 = AG.svcMgrCheck(kf, '2023-04-02', '2026-03-31');
  t('介護福祉士: 2023-04-02 起算なら満2年 → 満たさない', a2.ok === false && a2.years === 2, a2);
  const b = AG.svcMgrCheck(jt, '2021-04-01', '2026-03-31');
  t('実務者研修: 2021-04-01 起算で 2026-03-31 時点＝満5年 → 満たす', b.ok === true && b.need === 5 && b.years === 5, b);
  const b2 = AG.svcMgrCheck(jt, '2023-04-01', '2026-03-31');
  t('実務者研修: 満3年では満たさない（5年が要る）', b2.ok === false && b2.need === 5, b2);
  const c = AG.svcMgrCheck(ns, '2021-04-02', '2026-03-31');
  t('看護師: 5年が要る・2021-04-02 起算は満4年 → 満たさない', c.ok === false && c.need === 5 && c.years === 4, c);
  const d = AG.svcMgrCheck(no, '2010-04-01', '2026-03-31');
  t('資格なし（初任者研修だけ）→ 満たさない', d.ok === false && d.need === 0, d);
  const e = AG.svcMgrCheck(kf, '', '2026-03-31');
  t('起算日なし → 満たさない', e.ok === false && e.years === -1, e);
  const m = AG.tokuteiMonth([ST('S1', 'A', KF, { serviceManager: true, careExpSince: '2023-04-01' })], { S1: R(160) }, DEF, '2026-04');
  t('tokuteiMonth（2026-04）は前月の末日 2026-03-31 時点で見る → 満たす', m.asOf === '2026-03-31' && m.svcAllOk === true, { asOf: m.asOf, svcAllOk: m.svcAllOk });
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
