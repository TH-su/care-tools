/* staff-master-calc.js（職員マスタの算出層）の回帰テスト。
   node --test で走る。外部ライブラリ不要（node:test + node:assert/strict のみ）。

   守りたいのは次の5つ:
   1. 年齢・勤続が法律どおりに刻む（誕生日前日満了・2/29 生まれ・応当日の無い月末）
   2. 離職率の分母分子が期中の出入りで崩れない（期首0人は「0%」でなく null）
   3. 日付の正規化が書式ゆれを吸収し、読めないものは勝手に埋めず null にする
   4. CSV が Excel との往復で壊れない（BOM・CRLF・引用符内のカンマと改行）
   5. 旧スプレッドシートの取込で、判定できない項目を推測で埋めない（issues に落とす）

   ★実在の氏名・住所・電話は1件も含まない（テスト職員NN・架空の番号のみ）。

     node --test "…/check/unit/staff-calc.test.js"
*/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const S = require(path.join(__dirname, '..', '..', 'staff-master-calc.js'));

/* ── 日付の下ごしらえ ───────────────────────────────────────────── */

test('ymd: 正しい書式だけ通す', () => {
  assert.deepEqual(S.ymd('2025-10-27'), { y: 2025, m: 10, d: 27 });
  assert.equal(S.ymd('2025-02-30'), null);      /* 実在しない日 */
  assert.equal(S.ymd('2025-13-01'), null);
  assert.equal(S.ymd('2025/10/27'), null);      /* 書式違いは normDate の仕事 */
  assert.equal(S.ymd(''), null);
  assert.equal(S.ymd(null), null);
  assert.deepEqual(S.ymd('2024-02-29'), { y: 2024, m: 2, d: 29 });
});

test('today: JST の YYYY-MM-DD を返す', () => {
  const t = S.today();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(S.ymd(t), null);
});

/* ── 年齢（§3-1） ───────────────────────────────────────────────── */

test('age: 誕生日の当日に上がり、前日は上がらない', () => {
  assert.equal(S.age('1980-05-10', '2026-05-10'), 46);   /* 当日 */
  assert.equal(S.age('1980-05-10', '2026-05-09'), 45);   /* 前日 */
  assert.equal(S.age('1980-05-10', '2026-05-11'), 46);
});

test('age: 2/29 生まれは平年 2/28 に上がる', () => {
  assert.equal(S.age('2000-02-29', '2001-02-27'), 0);
  assert.equal(S.age('2000-02-29', '2001-02-28'), 1);    /* 平年 */
  assert.equal(S.age('2000-02-29', '2004-02-28'), 3);
  assert.equal(S.age('2000-02-29', '2004-02-29'), 4);    /* 閏年は当日 */
});

test('age: 生年月日が空・未来・不正なら null', () => {
  assert.equal(S.age('', '2026-01-01'), null);
  assert.equal(S.age('2030-01-01', '2026-01-01'), null);
  assert.equal(S.age('1980-13-01', '2026-01-01'), null);
});

/* ── 勤続（§3-2） ───────────────────────────────────────────────── */

test('tenure: 退職日は在籍最終日として両端を含める', () => {
  const t = S.tenure('2020-04-01', '2021-03-31', '2026-01-01');
  assert.equal(t.text, '1年0ヶ月');
  assert.equal(t.years, 1);
  assert.equal(t.months, 0);
  assert.equal(t.days, 365);
});

test('tenure: 応当日の無い月は末日で満了（1/31 入社 → 2/29 で1ヶ月）', () => {
  const t = S.tenure('2024-01-31', '', '2024-02-29');
  assert.equal(t.text, '0年1ヶ月');
  assert.equal(t.days, 30);
  const t2 = S.tenure('2024-01-31', '', '2024-02-28');
  assert.equal(t2.text, '0年0ヶ月');           /* 前日はまだ満了しない */
});

test('tenure: 退職日が空なら基準日まで数える', () => {
  const t = S.tenure('2020-04-01', '', '2025-07-01');
  assert.equal(t.text, '5年3ヶ月');
  const t2 = S.tenure('2020-04-01', null, '2025-07-01');
  assert.equal(t2.text, '5年3ヶ月');
});

test('tenure: 入社日が未来・空・不正なら null', () => {
  assert.equal(S.tenure('2030-01-01', '', '2026-01-01'), null);
  assert.equal(S.tenure('', '', '2026-01-01'), null);
  assert.equal(S.tenure('2020-99-99', '', '2026-01-01'), null);
});

test('tenure: 同日入退社は在籍1日', () => {
  const t = S.tenure('2025-06-01', '2025-06-01', '2026-01-01');
  assert.equal(t.days, 1);
  assert.equal(t.text, '0年0ヶ月');
});

test('tenure: decimal は日数÷365.25 を小数2桁', () => {
  const t = S.tenure('2020-04-01', '2021-03-31', '2026-01-01');
  assert.equal(t.decimal, 1);                   /* 365 / 365.25 = 0.9993 → 1.00 */
  const t2 = S.tenure('2020-04-01', '', '2030-04-01');
  assert.equal(t2.days, 3653);                  /* 両端含む・うるう年2回 */
  assert.equal(t2.decimal, 10);                 /* 3653 / 365.25 = 10.0014 → 10.00 */
});

/* ── 在籍ステータス（凍結仕様 §0・退職日から導出） ───────────────── */

test('statusOf: 退職日から在職・退職予定・退職済を導く', () => {
  assert.equal(S.statusOf({ retireDate: '' }, '2026-01-01'), 'active');
  assert.equal(S.statusOf({ retireDate: '2025-12-31' }, '2026-01-01'), 'retired');
  assert.equal(S.statusOf({ retireDate: '2026-01-01' }, '2026-01-01'), 'retired');  /* 当日は在籍最終日＝退職済扱い */
  assert.equal(S.statusOf({ retireDate: '2026-03-31' }, '2026-01-01'), 'retiring');
  assert.equal(S.statusOf({ onLeave: true }, '2026-01-01'), 'leave');
  assert.equal(S.statusOf({ onLeave: true, retireDate: '2025-12-31' }, '2026-01-01'), 'retired');
});

/* ── 人数・離職率（§4-2） ───────────────────────────────────────── */

/* 架空の5名。officer は役員兼使用人（既定で離職率の分母分子から外れる） */
const ROWS = [
  { id: 'S0001', name: 'テスト職員01', hireDate: '2024-04-01', retireDate: '', employmentType: 'regular', primarySite: 'facility', jobTitle: '介護' },
  { id: 'S0002', name: 'テスト職員02', hireDate: '2020-04-01', retireDate: '2024-09-30', employmentType: 'part', primarySite: 'visit', jobTitle: '介護' },
  { id: 'S0003', name: 'テスト職員03', hireDate: '2024-06-01', retireDate: '2024-12-31', employmentType: 'part', primarySite: 'day', jobTitle: '介護' },
  { id: 'S0004', name: 'テスト職員04', hireDate: '2015-04-01', retireDate: '2024-08-31', employmentType: 'officer', primarySite: 'facility', jobTitle: '施設長・介護' },
  { id: 'S0005', name: 'テスト職員05', hireDate: '2024-04-01', retireDate: '', employmentType: 'regular', primarySite: '', onLeave: true, jobTitle: '厨房' }
];

test('headAt: 休職を在籍に数え、退職日当日はまだ在籍', () => {
  assert.equal(S.headAt(ROWS, '2024-04-01'), 4);          /* 01・02・04・05（03 は未入職） */
  assert.equal(S.headAt(ROWS, '2024-09-30'), 4);          /* 02 の退職日当日 */
  assert.equal(S.headAt(ROWS, '2024-10-01'), 3);
  assert.equal(S.headAt(ROWS, '2025-03-31'), 2);
  assert.equal(S.headAt(ROWS, '2010-01-01'), 0);
  assert.equal(S.headAt(ROWS, 'ではない'), 0);
});

test('leavers: 期間内の退職日だけを数える（休職は無視）', () => {
  assert.equal(S.leavers(ROWS, '2024-04-01', '2025-03-31'), 3);
  assert.equal(S.leavers(ROWS, '2024-10-01', '2025-03-31'), 1);
  assert.equal(S.leavers(ROWS, '2026-01-01', '2026-12-31'), 0);
});

test('turnover: 役員を既定で外す（分母・分子の両方から）', () => {
  const t = S.turnover(ROWS, '2024-04-01', '2025-03-31');
  assert.equal(t.leavers, 2);                             /* 04（役員）を除く */
  assert.equal(t.avgHead, 2.5);                           /* (3 + 2) / 2 */
  assert.equal(t.rate, 80);
  assert.equal(t.rateRef, 66.7);                          /* 2 / 3（期首在籍） */
  assert.equal(t.hires, 3);
  assert.equal(t.shortStay, 1);                           /* 03 は期中入退社 */
});

test('turnover: excludeOfficer:false なら役員も数える', () => {
  const t = S.turnover(ROWS, '2024-04-01', '2025-03-31', { excludeOfficer: false });
  assert.equal(t.leavers, 3);
  assert.equal(t.avgHead, 3);                             /* (4 + 2) / 2 */
  assert.equal(t.rate, 100);
  assert.equal(t.rateRef, 75);
});

test('turnover: 日次平均は期首期末平均と一致しない（期中の出入りが分母に効く）', () => {
  const std = S.turnover(ROWS, '2024-04-01', '2025-03-31');
  const daily = S.turnover(ROWS, '2024-04-01', '2025-03-31', { avg: 'daily' });
  assert.equal(daily.avgHead, 3.09);                      /* 1127人日 / 365日 */
  assert.equal(daily.rate, 64.8);
  assert.notEqual(daily.avgHead, std.avgHead);
  assert.notEqual(daily.rate, std.rate);
});

test('turnover: 期首0人なら rate は 0% ではなく null', () => {
  const t = S.turnover(ROWS, '2010-01-01', '2010-12-31');
  assert.equal(t.avgHead, 0);
  assert.equal(t.rate, null);
  assert.equal(t.rateRef, null);
  assert.equal(t.leavers, 0);
});

test('turnover: 期間が不正なら数えない', () => {
  const t = S.turnover(ROWS, '2025-03-31', '2024-04-01');
  assert.equal(t.rate, null);
  assert.equal(t.leavers, 0);
});

test('turnover: 事業所で絞ってから同じ関数へ（兼務者を二重に数えない）', () => {
  const visit = ROWS.filter((r) => r.primarySite === 'visit');
  const t = S.turnover(visit, '2024-04-01', '2025-03-31');
  assert.equal(t.leavers, 1);
  assert.equal(t.avgHead, 0.5);                           /* (1 + 0) / 2 */
  assert.equal(t.rate, 200);
});

/* ── 集計期間（§4-2 period） ────────────────────────────────────── */

test('period: 年度・暦年・月と、基準日での打ち切り', () => {
  assert.deepEqual(S.period('fy', 2024, null, '2026-01-01'), { from: '2024-04-01', to: '2025-03-31' });
  assert.deepEqual(S.period('cy', 2025, null, '2026-01-01'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(S.period('month', 2026, 2, '2026-12-31'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(S.period('month', 2024, 2, '2026-12-31'), { from: '2024-02-01', to: '2024-02-29' });
  /* 終端が基準日より未来なら基準日で止める（未来分を数えない） */
  assert.deepEqual(S.period('fy', 2026, null, '2026-09-05'), { from: '2026-04-01', to: '2026-09-05' });
  assert.deepEqual(S.period('month', 2026, 9, '2026-09-05'), { from: '2026-09-01', to: '2026-09-05' });
  assert.equal(S.period('week', 2026, 1, '2026-09-05'), null);
  assert.equal(S.period('month', 2026, 13, '2026-09-05'), null);
});

/* ── 平均・構成比 ───────────────────────────────────────────────── */

test('averageTenureYears / averageAge: 在職者だけを平均する', () => {
  const rows = [
    { hireDate: '2020-04-01', retireDate: '', birthDate: '1980-04-01' },
    { hireDate: '2022-04-01', retireDate: '', birthDate: '1990-04-01' },
    { hireDate: '2000-04-01', retireDate: '2024-03-31', birthDate: '1950-04-01' }  /* 退職済＝除外 */
  ];
  assert.equal(S.averageTenureYears(rows, '2026-04-01'), 5);   /* (6.00 + 4.00) / 2 */
  assert.equal(S.averageAge(rows, '2026-04-01'), 41);          /* (46 + 36) / 2 */
  assert.equal(S.averageTenureYears([], '2026-04-01'), null);
  assert.equal(S.averageAge([], '2026-04-01'), null);
});

test('composition: 在職者のみ・日本語ラベル・未設定は「未設定」・件数降順', () => {
  const rows = [
    { hireDate: '2020-04-01', employmentType: 'regular', primarySite: 'facility' },
    { hireDate: '2020-04-01', employmentType: 'regular', primarySite: 'facility' },
    { hireDate: '2020-04-01', employmentType: 'part', primarySite: '' },
    { hireDate: '2020-04-01', employmentType: '', primarySite: 'visit' },
    { hireDate: '2000-04-01', retireDate: '2001-04-01', employmentType: 'officer', primarySite: 'cm' }
  ];
  const c = S.composition(rows, 'employmentType');
  assert.deepEqual(c.map((x) => x.label), ['正社員', 'パート', '未設定']);
  assert.equal(c[0].count, 2);
  assert.equal(c[0].pct, 50);
  assert.equal(c.reduce((a, x) => a + x.count, 0), 4);        /* 退職済は入らない */
  /* 同数のときは「未設定」を後ろへ回す（施設2・訪問1・未設定1） */
  const p = S.composition(rows, 'primarySite');
  assert.deepEqual(p.map((x) => x.label), ['施設', '訪問', '未設定']);
  assert.deepEqual(p.map((x) => x.pct), [50, 25, 25]);
});

/* ── 事業所別の集計・兼務比率 ────────────────────────────────────
   守りたいのは「兼務者を実人数で数える」こと。施設20%・訪問80%の人は施設で1名・訪問で1名。
   各事業所の合計が全体の在職者数と一致しなくてよい（案分しない＝本人裁定）。 */

/* 架空の5名。A=施設のみ B=施設と訪問の兼務 C=訪問の退職者 D=厨房（4列とも空）E=所属なし */
const SITE_ROWS = [
  { id: 'A', hireDate: '2024-04-01', retireDate: '', employmentType: 'regular', siteFacility: true, siteVisit: false, siteDay: false, siteCm: false },
  { id: 'B', hireDate: '2024-04-01', retireDate: '', employmentType: 'part', siteFacility: true, siteVisit: true, siteRatiosJson: { facility: 20, visit: 80 } },
  { id: 'C', hireDate: '2020-04-01', retireDate: '2024-09-30', employmentType: 'part', siteVisit: true },
  { id: 'D', hireDate: '2024-04-01', retireDate: '', employmentType: 'part', primarySite: 'kitchen' },
  { id: 'E', hireDate: '2024-04-01', retireDate: '', employmentType: 'part' }
];

function statOf(list, site) {
  return list.find((x) => x.site === site);
}

test('belongsTo: 真偽列で所属を判定する（専従・兼務・表記ゆれ）', () => {
  const only = { siteFacility: true };
  assert.equal(S.belongsTo(only, 'facility'), true);
  assert.equal(S.belongsTo(only, 'visit'), false);
  assert.equal(S.belongsTo(only, 'day'), false);
  assert.equal(S.belongsTo(only, 'cm'), false);

  const both = { siteFacility: true, siteVisit: true };
  assert.equal(S.belongsTo(both, 'facility'), true);
  assert.equal(S.belongsTo(both, 'visit'), true);

  /* 保存経路で 1 や '1' に化けても同じに読む（statusOf の onLeave と同じ寛容さ） */
  assert.equal(S.belongsTo({ siteDay: 1 }, 'day'), true);
  assert.equal(S.belongsTo({ siteDay: '1' }, 'day'), true);
  assert.equal(S.belongsTo({ siteDay: 'true' }, 'day'), true);
  assert.equal(S.belongsTo({ siteDay: 0 }, 'day'), false);
  assert.equal(S.belongsTo({ siteDay: '' }, 'day'), false);

  /* 事業所コード以外・空の行は偽 */
  assert.equal(S.belongsTo(only, 'kitchen'), false);
  assert.equal(S.belongsTo(only, ''), false);
  assert.equal(S.belongsTo(null, 'facility'), false);
  assert.equal(S.belongsTo(undefined, 'facility'), false);
});

test('belongsTo / siteRatios: 厨房（4列とも空）は施設と通所に 50:50 で属する', () => {
  const k = { primarySite: 'kitchen', siteFacility: false, siteVisit: false, siteDay: false, siteCm: false };
  assert.equal(S.belongsTo(k, 'facility'), true);
  assert.equal(S.belongsTo(k, 'day'), true);
  assert.equal(S.belongsTo(k, 'visit'), false);
  assert.equal(S.belongsTo(k, 'cm'), false);
  assert.deepEqual(S.siteRatios(k), { facility: 50, day: 50 });
  assert.equal(S.ratioTotal(k), 100);
  /* 列そのものが無い（未設定の行）でも同じ */
  assert.deepEqual(S.siteRatios({ primarySite: 'kitchen' }), { facility: 50, day: 50 });
});

test('siteRatios: 厨房でも印が1つでも立っていれば導出を使わない（入力値が正）', () => {
  const k = { primarySite: 'kitchen', siteDay: true };
  assert.equal(S.belongsTo(k, 'day'), true);
  assert.equal(S.belongsTo(k, 'facility'), false);              /* 導出しない */
  assert.deepEqual(S.siteRatios(k), {});                        /* 比率も既定を当てない */
  const k2 = { primarySite: 'kitchen', siteDay: true, siteRatiosJson: { day: 100 } };
  assert.deepEqual(S.siteRatios(k2), { day: 100 });
  assert.equal(S.ratioTotal(k2), 100);
});

test('siteRatios: 所属していない事業所のキーは落とす', () => {
  const r = { siteFacility: true, siteRatiosJson: { facility: 60, visit: 40 } };
  assert.deepEqual(S.siteRatios(r), { facility: 60 });
  assert.equal(S.ratioTotal(r), 60);
  /* 整数に丸める・数値にできない値は落とす */
  assert.deepEqual(S.siteRatios({ siteFacility: true, siteVisit: true, siteRatiosJson: { facility: 20.4, visit: 'ではない' } }),
    { facility: 20 });
  /* 比率が無い・壊れている行は空（合計 0） */
  assert.deepEqual(S.siteRatios({ siteFacility: true }), {});
  assert.deepEqual(S.siteRatios({ siteFacility: true, siteRatiosJson: [1, 2] }), {});
  assert.deepEqual(S.siteRatios(null), {});
  assert.equal(S.ratioTotal({ siteFacility: true }), 0);
  assert.equal(S.ratioTotal(null), 0);
  /* 0〜100 の外は丸めずに落とす（100 に丸めると合計の注意が出ず、異常が隠れるため） */
  assert.deepEqual(S.siteRatios({ siteFacility: true, siteVisit: true, siteRatiosJson: { facility: 120, visit: -5 } }), {});
  assert.deepEqual(S.siteRatios({ siteFacility: true, siteVisit: true, siteRatiosJson: { facility: 120, visit: 40 } }), { visit: 40 });
});

test('siteStats: 兼務の人は両方の事業所で1名（2:8 でも 1 と 1）', () => {
  const one = [SITE_ROWS[1]];                                   /* B のみ（施設20・訪問80） */
  const st = S.siteStats(one, '2024-04-01', '2025-03-31', '2025-03-31');
  assert.equal(statOf(st, 'facility').head, 1);
  assert.equal(statOf(st, 'visit').head, 1);
  assert.equal(statOf(st, 'day').head, 0);
  /* 合計は在職者数と一致しない（案分しない） */
  assert.equal(st.reduce((a, x) => a + x.head, 0), 2);
  assert.equal(S.headAt(one, '2025-03-31'), 1);
});

test('siteStats: 事業所ごとの人数・退職者・離職率が、その事業所の人だけで出る', () => {
  const st = S.siteStats(SITE_ROWS, '2024-04-01', '2025-03-31', '2025-03-31');
  assert.deepEqual(st.map((x) => x.site), ['facility', 'visit', 'day', 'cm', '']);
  assert.deepEqual(st.map((x) => x.label), ['施設', '訪問', '通所', '居宅', '事業所の指定なし']);

  const fac = statOf(st, 'facility');
  assert.equal(fac.head, 3);                                    /* A・B・D（厨房） */
  assert.equal(fac.leavers, 0);
  assert.equal(fac.rate, 0);
  assert.equal(fac.hires, 3);

  const vis = statOf(st, 'visit');
  assert.equal(vis.head, 1);                                    /* B（C は退職済） */
  assert.equal(vis.leavers, 1);                                 /* C */
  assert.equal(vis.avgHead, 1.5);                               /* (2 + 1) / 2 */
  assert.equal(vis.rate, 66.7);
  assert.equal(vis.rateRef, 50);

  assert.equal(statOf(st, 'day').head, 1);                      /* D（厨房＝通所にも属する） */
  assert.equal(statOf(st, 'cm').head, 0);
  assert.equal(statOf(st, 'cm').rate, null);                    /* 0人の事業所は 0% でなく null */
});

test('siteStats: どの事業所にも属さない人は「事業所の指定なし」に入る', () => {
  const st = S.siteStats(SITE_ROWS, '2024-04-01', '2025-03-31', '2025-03-31');
  const none = statOf(st, '');
  assert.equal(none.label, '事業所の指定なし');
  assert.equal(none.head, 1);                                   /* E だけ（厨房の D は施設・通所へ） */
  assert.equal(none.leavers, 0);
});

test('siteStats: 空配列・不正な日付でも落ちない（rate は null）', () => {
  const empty = S.siteStats([], '2024-04-01', '2025-03-31', '2025-03-31');
  assert.equal(empty.length, 5);
  empty.forEach((x) => {
    assert.equal(x.head, 0);
    assert.equal(x.leavers, 0);
    assert.equal(x.rate, null);
    assert.equal(x.rateRef, null);
  });
  assert.equal(S.siteStats(null, '2024-04-01', '2025-03-31', '2025-03-31').length, 5);

  const bad = S.siteStats(SITE_ROWS, 'ではない', '2025-03-31', '2025-03-31');
  bad.forEach((x) => {
    assert.equal(x.rate, null);
    assert.equal(x.leavers, 0);
  });
  assert.equal(statOf(bad, 'facility').head, 3);                /* 人数は基準日で数えられる */
  /* asOf を省略しても落ちない（today で数える） */
  assert.equal(S.siteStats(SITE_ROWS, '2024-04-01', '2025-03-31').length, 5);
});

test('siteStats: 元の rows を書き換えない', () => {
  const before = JSON.stringify(SITE_ROWS);
  S.siteStats(SITE_ROWS, '2024-04-01', '2025-03-31', '2025-03-31');
  assert.equal(SITE_ROWS.length, 5);
  assert.equal(JSON.stringify(SITE_ROWS), before);
});

test('SITE_* 定数: コード・列名・名前がそろっている（居宅は入力欄の既定から外す）', () => {
  assert.deepEqual(S.SITE_CODES, ['facility', 'visit', 'day', 'cm']);
  assert.deepEqual(S.SITE_ACTIVE, ['facility', 'visit', 'day']);
  assert.deepEqual(S.SITE_CODES.map((c) => S.SITE_COL[c]), ['siteFacility', 'siteVisit', 'siteDay', 'siteCm']);
  assert.deepEqual(S.SITE_CODES.map((c) => S.SITE_LABEL[c]), ['施設', '訪問', '通所', '居宅']);
  assert.deepEqual(S.KITCHEN_SITES, { facility: 50, day: 50 });
  /* 列名は LABELS と同じ項目を指す */
  S.SITE_CODES.forEach((c) => assert.equal(S.LABELS[S.SITE_COL[c]], S.SITE_LABEL[c]));
});

/* ── 日付の正規化（§6-2） ───────────────────────────────────────── */

test('normDate: 8書式を同じ日に正規化する', () => {
  assert.equal(S.normDate('2025-10-27'), '2025-10-27');
  assert.equal(S.normDate('2025/10/27'), '2025-10-27');
  assert.equal(S.normDate('2025.10.27'), '2025-10-27');
  assert.equal(S.normDate('2025年10月27日'), '2025-10-27');
  assert.equal(S.normDate('R7.10.27'), '2025-10-27');
  assert.equal(S.normDate('令和7年10月27日'), '2025-10-27');
  assert.equal(S.normDate('45957'), '2025-10-27');           /* Sheets のシリアル値 */
  assert.equal(S.normDate('20251027'), '2025-10-27');
  /* 元号の記号は小文字でも受ける（人は小文字で打つ・2026-09-16 追加）。
     ★受けたあと大文字へ寄せていないと ERA_BASE が引けず null に落ちる */
  assert.equal(S.normDate('r7.10.27'), '2025-10-27');
  assert.equal(S.normDate('s15.4.3'), '1940-04-03');
  assert.equal(S.normDate('ｓ15.4.3'), '1940-04-03');          /* 全角も NFKC で吸収する */
  assert.equal(S.normDate('x15.4.3'), null);                   /* 元号でない文字は通さない */
});

test('normDate: 先の日付の上限は既定「翌年」・呼び手が延ばせる（2026-09-16 追加）', () => {
  const nextY = Number(S.today().slice(0, 4)) + 1;
  const far = (nextY + 3) + '-03-31';
  /* ★既定は変えない。職員の生年月日・入社日が数年先になることは無く、
     3025 のような打ち間違いをここで止めている */
  assert.equal(S.normDate(nextY + '-03-31'), nextY + '-03-31');
  assert.equal(S.normDate(far), null);
  /* 介護保険の認定有効期間は更新で最長48か月＝4年先の終了日が実在する */
  assert.equal(S.normDate(far, { aheadYears: 10 }), far);
  /* 延ばしても打ち間違いは止まる */
  assert.equal(S.normDate('3026-01-01', { aheadYears: 10 }), null);
  /* 過去側の下限は動かさない */
  assert.equal(S.normDate('1899-12-31', { aheadYears: 10 }), null);
  assert.equal(S.normDate('1900-01-01', { aheadYears: 10 }), '1900-01-01');
});

test('normDate: 全角・和暦の元年・旧元号', () => {
  assert.equal(S.normDate('２０２５／１０／２７'), '2025-10-27');
  assert.equal(S.normDate('令和元年5月1日'), '2019-05-01');
  assert.equal(S.normDate('H31.4.30'), '2019-04-30');
  assert.equal(S.normDate('昭和45年1月2日'), '1970-01-02');
  assert.equal(S.normDate('2015.3.31'), '2015-03-31');       /* 旧シートの資格取得日 */
});

test('normDate: 不正な月日・範囲外・読めないものは null（勝手に埋めない）', () => {
  assert.equal(S.normDate('2025/13/01'), null);
  assert.equal(S.normDate('2025/02/30'), null);
  assert.equal(S.normDate('2023/02/29'), null);              /* 平年の 2/29 */
  assert.equal(S.normDate('2024/02/29'), '2024-02-29');
  assert.equal(S.normDate('1899-12-31'), null);              /* 1900 未満 */
  assert.equal(S.normDate('2999-01-01'), null);              /* 翌年より先 */
  assert.equal(S.normDate('未定'), null);
  assert.equal(S.normDate(''), null);
  assert.equal(S.normDate(null), null);
  assert.equal(S.normDate('X7.10.27'), null);
});

test('normDate: 末尾の「生」と途中の空白を落として読む（手書き・転記の表記ゆれ）', () => {
  assert.equal(S.normDate('昭和55年4月3日生'), '1980-04-03');
  assert.equal(S.normDate('S55.4.3生'), '1980-04-03');
  assert.equal(S.normDate('R 8. 9. 10'), '2026-09-10');
  assert.equal(S.normDate('令和 7 年 10 月 27 日'), '2025-10-27');
  assert.equal(S.normDate('2025 / 10 / 27'), '2025-10-27');
  assert.equal(S.normDate('　2025-10-27　'), '2025-10-27');
  assert.equal(S.normDate('生'), null);                        /* 「生」だけなら日付ではない */
  assert.equal(S.normDate('生年月日'), null);
});

/* ── 和暦の読み下し（入力欄の確認表示） ─────────────────────────── */

test('toWareki: 改元日を正しく跨ぐ（M/T/S/H/R の境界）', () => {
  assert.equal(S.toWareki('1912-07-29'), '明治45年7月29日');
  assert.equal(S.toWareki('1912-07-30'), '大正元年7月30日');
  assert.equal(S.toWareki('1926-12-24'), '大正15年12月24日');
  assert.equal(S.toWareki('1926-12-25'), '昭和元年12月25日');
  assert.equal(S.toWareki('1989-01-07'), '昭和64年1月7日');
  assert.equal(S.toWareki('1989-01-08'), '平成元年1月8日');
  assert.equal(S.toWareki('2019-04-30'), '平成31年4月30日');
  assert.equal(S.toWareki('2019-05-01'), '令和元年5月1日');
});

test('toWareki: 元年の表記と通常の年', () => {
  assert.equal(S.toWareki('2026-09-10'), '令和8年9月10日');
  assert.equal(S.toWareki('2019-12-31'), '令和元年12月31日');
  assert.equal(S.toWareki('1980-02-29'), '昭和55年2月29日');
  assert.equal(S.toWareki('1868-01-25'), '明治元年1月25日');   /* 明治の始まり */
});

test('toWareki: 明治より前・書式違い・実在しない日は null（勝手に埋めない）', () => {
  assert.equal(S.toWareki('1868-01-24'), null);
  assert.equal(S.toWareki('1867-12-31'), null);
  assert.equal(S.toWareki('2025/10/27'), null);                /* 正規化は normDate の仕事 */
  assert.equal(S.toWareki('2025-02-30'), null);
  assert.equal(S.toWareki('R8.9.10'), null);
  assert.equal(S.toWareki(''), null);
  assert.equal(S.toWareki(null), null);
});

test('normDate → toWareki: 入力欄の往復（打った値が同じ日を指す）', () => {
  ['昭和55年4月3日生', 'S55.4.3', '1980/4/3', '19800403'].forEach((raw) => {
    const iso = S.normDate(raw);
    assert.equal(iso, '1980-04-03');
    assert.equal(S.toWareki(iso), '昭和55年4月3日');
  });
});

/* ── 氏名・フリガナの正規化 ─────────────────────────────────────── */

test('normName / normKana: 名寄せ用に空白と字種の差を潰す', () => {
  assert.equal(S.normName('テスト　職員 01'), 'テスト職員01');
  assert.equal(S.normName('ＴＥＳＴ 01'), 'test01');
  assert.equal(S.normKana('てすと しょくいん'), 'テストショクイン');
  assert.equal(S.normKana('ﾃｽﾄ ｼｮｸｲﾝ'), 'テストショクイン');
  assert.equal(S.normKana('テスト　ショクイン'), 'テストショクイン');
});

/* ── CSV ────────────────────────────────────────────────────────── */

test('parseCsv: BOM・CRLF・引用符内のカンマと改行・空行', () => {
  const text = '﻿a,b,"c,d"\r\n"e\r\nf",g,"h""i"\r\n\r\n1,2,3\r\n';
  const rows = S.parseCsv(text);
  assert.equal(rows.length, 3);                              /* 空行は落ちる */
  assert.deepEqual(rows[0], ['a', 'b', 'c,d']);
  assert.deepEqual(rows[1], ['e\r\nf', 'g', 'h"i']);
  assert.deepEqual(rows[2], ['1', '2', '3']);
});

test('parseCsv: LF だけ・末尾改行なし・空文字', () => {
  assert.deepEqual(S.parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(S.parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(S.parseCsv(''), []);
  assert.deepEqual(S.parseCsv('\r\n\r\n'), []);
});

test('toCsv: BOM付き・CRLF・全セル引用', () => {
  const s = S.toCsv([['a', 'b"c'], ['1', '']]);
  assert.equal(s.charCodeAt(0), 0xFEFF);
  assert.equal(s.slice(1), '"a","b""c"\r\n"1",""\r\n');
});

test('toCsv → parseCsv の往復で中身が変わらない', () => {
  const rows = [
    ['職員ID', '氏名', '備考'],
    ['S0001', 'テスト職員01', 'カンマ, と "引用符" と\n改行'],
    ['S0002', 'テスト職員02', '']
  ];
  assert.deepEqual(S.parseCsv(S.toCsv(rows)), rows);
});

/* ── 旧スプレッドシート「職員一覧」の取込（§6-1） ────────────────── */

/* 実測の見出し（フリガナ列は見出しが空・「勤務形態」は同名2列・「年」「ヶ月」は作業列） */
const HEAD = ['No', '氏名', '', '性別', '生年月日', '年齢', '入職日', '退職日', '職種',
  '勤務形態', '勤務形態', '資格', '連絡先', '住所', '退職', '現職', '形態', '入職後日数',
  '年', 'ヶ月', '介護就職', '年', 'ヶ月', '施設', '訪問', '通所', '居宅', '退職順作業',
  '介護作業', '雇用', '介護福祉士', '資格取得日', '取得後年数', '訪問作業', 'デイ作業',
  '在籍', '指定日作業', '雇用保険番号', '備考'];

function row(over) {
  const r = new Array(HEAD.length).fill('');
  Object.keys(over).forEach((k) => { r[+k] = over[k]; });
  return r;
}

test('mapLegacyRow: 正常な1行を取り込む（見出し名で引く）', () => {
  const r = row({
    0: '1', 1: 'テスト職員01', 2: 'テストショクイン', 3: '女', 4: '1980/5/10',
    6: '2015/4/1', 8: '介護', 9: '常勤', 10: '専従', 11: '介護福祉士・実務者研修',
    12: '000-0000-0000', 13: '架空県架空市１－２－３', 15: '○', 16: '常勤・専従',
    20: '2010/4/1', 23: '◯', 29: '正社員', 30: '○', 31: '2015.3.31',
    35: '在籍', 37: '1234-567890-1', 38: '備考なし'
  });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.legacyNo, '1');
  assert.equal(fields.name, 'テスト職員01');
  assert.equal(fields.kana, 'テストショクイン');
  assert.equal(fields.gender, 'F');
  assert.equal(fields.birthDate, '1980-05-10');
  assert.equal(fields.hireDate, '2015-04-01');
  assert.equal(fields.careStartDate, '2010-04-01');
  assert.equal(fields.retireDate, undefined);
  assert.equal(fields.jobTitle, '介護');
  assert.equal(fields.workStyle, 'full_ded');
  assert.equal(fields.employmentType, 'regular');
  assert.equal(fields.siteFacility, true);
  assert.equal(fields.siteVisit, false);
  assert.equal(fields.primarySite, 'facility');
  assert.deepEqual(fields.qualsJson, [
    { code: 'cw', acquiredOn: '2015-03-31' },
    { code: 'jitsumu', acquiredOn: '' }
  ]);
  assert.equal(fields.phone, '000-0000-0000');
  assert.equal(fields.address, '架空県架空市1-2-3');
  assert.equal(fields.empInsNo, '1234-567890-1');
  assert.equal(fields.note, '備考なし');
  assert.deepEqual(issues, []);
});

test('mapLegacyRow: 事業所が2つなら主たる事業所を埋めず要確認にする', () => {
  const r = row({ 1: 'テスト職員02', 6: '2020/4/1', 23: '◯', 24: '◯', 29: 'パート' });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.siteFacility, true);
  assert.equal(fields.siteVisit, true);
  assert.equal(fields.primarySite, undefined);               /* 推測しない */
  assert.equal(issues.filter((x) => x.key === 'primarySite').length, 1);
  assert.match(issues.find((x) => x.key === 'primarySite').reason, /主たる事業所/);
});

test('mapLegacyRow: 判定できない雇用は fields に入れず issues に理由を残す', () => {
  const r = row({ 1: 'テスト職員03', 6: '2020/4/1', 23: '◯', 29: '嘱託' });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.employmentType, undefined);
  const it = issues.find((x) => x.key === 'employmentType');
  assert.notEqual(it, undefined);
  assert.match(it.reason, /嘱託/);
});

test('mapLegacyRow: 読めない日付・判定できない性別は埋めない', () => {
  const r = row({ 1: 'テスト職員04', 3: '不明', 4: '未定', 6: '2020/4/1', 23: '◯', 29: 'パート' });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.birthDate, undefined);
  assert.equal(fields.gender, undefined);
  assert.equal(issues.filter((x) => x.key === 'birthDate').length, 1);
  assert.equal(issues.filter((x) => x.key === 'gender').length, 1);
});

test('mapLegacyRow: 事業所の印がゼロなら要確認にせず、主たる事業所を空のまま通す', () => {
  const r = row({ 1: 'テスト職員19', 6: '2020/4/1', 8: '介護', 29: 'パート' });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.primarySite, undefined);               /* 推測しない */
  assert.equal(issues.filter((x) => x.key === 'primarySite').length, 0);   /* 印ゼロは要確認にしない */
});

test('mapLegacyRow: 事業所の印が無くても職種が厨房なら kitchen', () => {
  const r = row({ 1: 'テスト職員05', 6: '2020/4/1', 8: '栄養士（厨房）', 29: 'パート' });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.primarySite, 'kitchen');
  assert.equal(issues.filter((x) => x.key === 'primarySite').length, 0);
});

test('mapLegacyRow: 資格の「・」区切りを語彙表でコード化する', () => {
  const r1 = row({ 1: 'テスト職員06', 6: '2020/4/1', 11: '准看護師・初任者研修', 23: '◯', 29: 'パート' });
  assert.deepEqual(S.mapLegacyRow(HEAD, r1).fields.qualsJson,
    [{ code: 'anurse', acquiredOn: '' }, { code: 'shonin', acquiredOn: '' }]);

  const r2 = row({ 1: 'テスト職員07', 6: '2020/4/1', 11: '介護支援専門員・初任者研修・薬剤師', 23: '◯', 29: 'パート' });
  assert.deepEqual(S.mapLegacyRow(HEAD, r2).fields.qualsJson.map((q) => q.code),
    ['cm', 'shonin', 'pharm']);

  /* 「社会福祉士主事」を「社会福祉士」と取り違えない */
  const r3 = row({ 1: 'テスト職員08', 6: '2020/4/1', 11: '社会福祉士主事', 23: '◯', 29: 'パート' });
  assert.deepEqual(S.mapLegacyRow(HEAD, r3).fields.qualsJson, [{ code: 'swshuji', acquiredOn: '' }]);

  /* 全角の「ヘルパー２級」「ヘルパー１級」・無資格・語彙表に無いものは other */
  const r4 = row({ 1: 'テスト職員09', 6: '2020/4/1', 11: '看護師・ヘルパー１級', 23: '◯', 29: 'パート' });
  assert.deepEqual(S.mapLegacyRow(HEAD, r4).fields.qualsJson.map((q) => q.code), ['nurse', 'helper1']);
  const r5 = row({ 1: 'テスト職員10', 6: '2020/4/1', 11: '無資格', 23: '◯', 29: 'パート' });
  assert.deepEqual(S.mapLegacyRow(HEAD, r5).fields.qualsJson, [{ code: 'none', acquiredOn: '' }]);
  const r6 = row({ 1: 'テスト職員11', 6: '2020/4/1', 11: '架空研修', 23: '◯', 29: 'パート' });
  assert.deepEqual(S.mapLegacyRow(HEAD, r6).fields.qualsJson, [{ code: 'other', label: '架空研修', acquiredOn: '' }]);
});

test('mapLegacyRow: 勤務形態は同名2列を値で見分け、無ければ「形態」列で補う', () => {
  const a = row({ 1: 'テスト職員12', 6: '2020/4/1', 9: '非常勤', 10: '兼務', 23: '◯', 29: 'パート' });
  assert.equal(S.mapLegacyRow(HEAD, a).fields.workStyle, 'part_con');
  /* 順序が逆でも値で判定できる */
  const b = row({ 1: 'テスト職員13', 6: '2020/4/1', 9: '専従', 10: '常勤', 23: '◯', 29: 'パート' });
  assert.equal(S.mapLegacyRow(HEAD, b).fields.workStyle, 'full_ded');
  /* 2列とも空なら「形態」列（常勤・兼務） */
  const c = row({ 1: 'テスト職員14', 6: '2020/4/1', 16: '常勤・兼務', 23: '◯', 29: 'パート' });
  assert.equal(S.mapLegacyRow(HEAD, c).fields.workStyle, 'full_con');
  /* 片方しか読めなければ埋めずに要確認 */
  const d = row({ 1: 'テスト職員15', 6: '2020/4/1', 9: '常勤', 23: '◯', 29: 'パート' });
  const dm = S.mapLegacyRow(HEAD, d);
  assert.equal(dm.fields.workStyle, undefined);
  assert.equal(dm.issues.filter((x) => x.key === 'workStyle').length, 1);
});

test('mapLegacyRow: 退職欄が立っているのに退職日が空なら要確認', () => {
  const r = row({ 1: 'テスト職員16', 6: '2020/4/1', 14: '○', 23: '◯', 29: 'パート' });
  const { fields, issues } = S.mapLegacyRow(HEAD, r);
  assert.equal(fields.retireDate, undefined);
  assert.equal(issues.filter((x) => x.key === 'retireDate').length, 1);
});

test('mapLegacyRow: 見出しの位置が動いても名前で引ける', () => {
  const head2 = ['氏名', '', '入職日', 'No', '施設', '雇用'];
  const { fields } = S.mapLegacyRow(head2, ['テスト職員17', 'テストショクイン', '2021/1/4', '9', '◯', 'パート']);
  assert.equal(fields.name, 'テスト職員17');
  assert.equal(fields.kana, 'テストショクイン');
  assert.equal(fields.hireDate, '2021-01-04');
  assert.equal(fields.legacyNo, '9');
  assert.equal(fields.primarySite, 'facility');
  assert.equal(fields.employmentType, 'part');
});

test('mapLegacyRow: 見出しが空でもカタカナでなければフリガナにしない', () => {
  const head2 = ['氏名', '', '入職日'];
  const { fields } = S.mapLegacyRow(head2, ['テスト職員18', '2021年入職', '2021/1/4']);
  assert.equal(fields.kana, undefined);
});

test('mapLegacyRow: 氏名が空なら要確認（勝手に作らない）', () => {
  const { fields, issues } = S.mapLegacyRow(HEAD, row({ 6: '2020/4/1', 23: '◯', 29: 'パート' }));
  assert.equal(fields.name, undefined);
  assert.equal(issues.filter((x) => x.key === 'name').length, 1);
});

/* ── 部分更新の差分 ─────────────────────────────────────────────── */

test('diffFields: 同値は含めない（前後の空白差も同値とみなす）', () => {
  const base = { name: 'テスト職員01', jobTitle: '介護', onLeave: false };
  const edited = { name: ' テスト職員01 ', jobTitle: '介護', onLeave: false };
  assert.deepEqual(S.diffFields(base, edited), {});
});

test('diffFields: 変えた項目だけを返す', () => {
  const base = { name: 'テスト職員01', jobTitle: '介護', onLeave: false, siteVisit: false };
  const edited = { name: 'テスト職員01', jobTitle: '看護・介護', onLeave: true, siteVisit: false };
  assert.deepEqual(S.diffFields(base, edited), { jobTitle: '看護・介護', onLeave: true });
});

test('diffFields: 空にした項目は null（未指定と区別する）', () => {
  const base = { note: '備考あり', retireDate: '2025-03-31', qualsJson: [{ code: 'cw', acquiredOn: '2015-03-31' }] };
  const edited = { note: '   ', retireDate: '', qualsJson: [] };
  assert.deepEqual(S.diffFields(base, edited), { note: null, retireDate: null, qualsJson: null });
});

test('diffFields: もともと空で編集後も空なら何も送らない', () => {
  assert.deepEqual(S.diffFields({ note: '', kana: null }, { note: '', kana: '' }), {});
  assert.deepEqual(S.diffFields({}, { note: '' }), {});
});

test('diffFields: 資格は並び順と空の取得日の差を変更に数えない（開いた直後に未保存にしない）', () => {
  const base = { qualsJson: [{ code: 'shonin', acquiredOn: '' }, { code: 'cw', acquiredOn: '2015-03-31' }] };
  /* 並びが入れ替わり、空の取得日が落ちただけ＝同じ内容 */
  const same = { qualsJson: [{ code: 'cw', acquiredOn: '2015-03-31' }, { code: 'shonin' }] };
  assert.deepEqual(S.diffFields(base, same), {});
  /* その他の名称（label）が落ちたら変更として拾う */
  const lost = S.diffFields({ qualsJson: [{ code: 'other', label: '架空研修', acquiredOn: '' }] },
    { qualsJson: [{ code: 'other' }] });
  assert.deepEqual(lost, { qualsJson: [{ code: 'other' }] });
  /* 取得日を入れたら変更 */
  const added = S.diffFields(base, { qualsJson: [{ code: 'cw', acquiredOn: '2015-03-31' }, { code: 'shonin', acquiredOn: '2012-04-01' }] });
  assert.equal(Array.isArray(added.qualsJson), true);
});

test('diffFields: 配列・オブジェクトは中身で比べる', () => {
  const base = { qualsJson: [{ code: 'cw', acquiredOn: '2015-03-31' }] };
  assert.deepEqual(S.diffFields(base, { qualsJson: [{ code: 'cw', acquiredOn: '2015-03-31' }] }), {});
  const changed = S.diffFields(base, { qualsJson: [{ code: 'cw', acquiredOn: '2016-03-31' }] });
  assert.deepEqual(changed, { qualsJson: [{ code: 'cw', acquiredOn: '2016-03-31' }] });
  /* base に無いキーを足した場合も差分に載る */
  assert.deepEqual(S.diffFields({}, { emergencyJson: [{ name: 'テスト連絡先01', relation: '子', phone: '000-0000-0000' }] }),
    { emergencyJson: [{ name: 'テスト連絡先01', relation: '子', phone: '000-0000-0000' }] });
});

/* ── ラベル・語彙 ───────────────────────────────────────────────── */

test('LABELS / ENUMS: 画面と CSV が同じ語彙を使う', () => {
  assert.equal(S.LABELS.hireDate, '入職日');
  assert.equal(S.LABELS.empInsNo, '雇用保険番号');
  assert.equal(S.ENUMS.employmentType.officer, '役員兼使用人');
  assert.equal(S.ENUMS.workStyle.part_con, '非常勤・兼務');
  assert.equal(S.ENUMS.primarySite.kitchen, '厨房');
  assert.equal(S.ENUMS.gender.F, '女');
  assert.equal(S.ENUMS.qualCodes.cw, '介護福祉士');
  /* 取込で作り得るコードはすべてラベルを持つ */
  ['cw', 'jitsumu', 'shonin', 'helper1', 'helper2', 'kiso', 'cm', 'nurse', 'anurse',
    'pt', 'ot', 'sw', 'swshuji', 'pharm', 'dietitian', 'cook', 'none', 'other']
    .forEach((c) => assert.equal(typeof S.ENUMS.qualCodes[c], 'string'));
});

/* ── 選択肢マスタ（サーバー保存の雇用区分・資格／spec-enums.md §6）───────────
   守りたいのは「サーバーの選択肢に差し替えても、既存データの表示と既定値が壊れない」こと。
   ENUMS は共有の入れ物なので、各テストは終わりに既定へ戻す（他のテストへ持ち出さない）。 */

/* 既定に戻すための写し。setEnums に食わせられる形（[{code,label}]）で作る */
function snapEnums() {
  return {
    employmentType: S.visibleEnum('employmentType').map((p) => ({ code: p[0], label: p[1] })),
    qualCodes: S.visibleEnum('qualCodes').map((p) => ({ code: p[0], label: p[1] }))
  };
}

test('setEnums: サーバーの選択肢へ差し替える（並び順・追加・ラベル変更）', () => {
  const back = snapEnums();
  try {
    const n = S.setEnums({
      employmentType: [
        { code: 'part', label: 'パート' },
        { code: 'regular', label: '正職員' },              /* ラベル変更 */
        { code: 'contract', label: '契約社員' },
        { code: 'officer', label: '役員兼使用人' },
        { code: 'temp', label: '臨時' },
        { code: 'x1', label: '嘱託' }                      /* 追加 */
      ],
      qualCodes: [{ code: 'cw', label: '介護福祉士' }, { code: 'x1', label: '喀痰吸引研修' }]
    });
    assert.equal(n, 2);                                     /* 2群とも差し替えた */
    assert.deepEqual(S.visibleEnum('employmentType'), [
      ['part', 'パート'], ['regular', '正職員'], ['contract', '契約社員'],
      ['officer', '役員兼使用人'], ['temp', '臨時'], ['x1', '嘱託']
    ]);
    assert.equal(S.ENUMS.employmentType.x1, '嘱託');        /* 表示用の辞書にも入る */
    assert.equal(S.ENUMS.employmentType.regular, '正職員');
    assert.equal(S.ENUMS.qualCodes.x1, '喀痰吸引研修');
  } finally {
    S.setEnums(back);
  }
});

test('setEnums: hidden は選択肢から外れるが、既存データの表示には残る', () => {
  const back = snapEnums();
  try {
    S.setEnums({
      employmentType: [
        { code: 'regular', label: '正社員' },
        { code: 'temp', label: '臨時', hidden: true }
      ],
      qualCodes: [{ code: 'cw', label: '介護福祉士' }, { code: 'helper2', label: 'ヘルパー2級', hidden: true }]
    });
    assert.deepEqual(S.visibleEnum('employmentType'), [['regular', '正社員']]);
    assert.deepEqual(S.visibleEnum('qualCodes'), [['cw', '介護福祉士']]);
    assert.equal(S.ENUMS.employmentType.temp, '臨時');       /* 表示は引ける */
    assert.equal(S.ENUMS.qualCodes.helper2, 'ヘルパー2級');
    /* 非表示の区分のままの在職者も、構成比では名前で出る（人数を落とさない） */
    const comp = S.composition([
      { employmentType: 'temp', hireDate: '2020-04-01', retireDate: '' },
      { employmentType: 'regular', hireDate: '2020-04-01', retireDate: '' }
    ], 'employmentType');
    assert.deepEqual(comp.map((c) => c.label).sort(), ['正社員', '臨時']);
  } finally {
    S.setEnums(back);
  }
});

test('setEnums: 壊れた応答では選択肢を失わない（安全側に倒す）', () => {
  const before = S.visibleEnum('employmentType');
  assert.equal(S.setEnums(null), 0);
  assert.equal(S.setEnums({}), 0);
  assert.equal(S.setEnums({ employmentType: [] }), 0);            /* 空配列は無視 */
  assert.equal(S.setEnums({ employmentType: 'こわれた値' }), 0);
  assert.equal(S.setEnums({ gender: [{ code: 'X', label: '？' }] }), 0);  /* 対象外の群は触らない */
  assert.deepEqual(S.visibleEnum('employmentType'), before);
  assert.equal(S.ENUMS.gender.M, '男');
  /* 項目が壊れているものだけ落として残りは活かす。名前が無ければコードを出す */
  const back = snapEnums();
  try {
    assert.equal(S.setEnums({ employmentType: [null, { code: 'regular' }, { label: '名前だけ' }, { code: 'regular', label: '重複は先勝ち' }] }), 1);
    assert.deepEqual(S.visibleEnum('employmentType'), [['regular', 'regular']]);
  } finally {
    S.setEnums(back);
  }
});

test('visibleEnum: サーバーから受け取らない群は ENUMS の並びをそのまま出す', () => {
  assert.deepEqual(S.visibleEnum('gender'), [['M', '男'], ['F', '女']]);
  assert.deepEqual(S.visibleEnum('workStyle').map((p) => p[0]), ['full_ded', 'full_con', 'part_ded', 'part_con']);
  assert.deepEqual(S.visibleEnum('primarySite').map((p) => p[1]), ['施設', '訪問', '通所', '居宅', '厨房']);
  assert.deepEqual(S.visibleEnum('存在しない群'), []);
});

test('setEnums のあとも既定の18資格・5区分は引ける（既定コードは消えない契約）', () => {
  assert.equal(S.visibleEnum('qualCodes').length, 18);
  assert.equal(S.visibleEnum('employmentType').length, 5);
  assert.equal(S.ENUMS.employmentType.officer, '役員兼使用人');
  assert.equal(S.ENUMS.qualCodes.cw, '介護福祉士');
  assert.equal(S.VERSION, '2026-09-23.8');
});

/* ── 委員会と構成員（spec-committee.md §1・§4）────────────────────
   守りたいのは「実地指導でそのまま見せられる名簿」。減算の要件（担当者・委員長）が
   空のまま静かに通らないこと、退職者が構成員に残らないこと、サーバーの応答が壊れても
   委員会が画面から消えないこと。COMMITTEES は共有の入れ物なので、差し替えるテストは
   終わりに既定へ戻す（他のテストへ持ち出さない）。 */

const COM_ASOF = '2026-04-01';

/* 架空の5名。A・B・C は在職、D は退職者（委員長のまま）、E は所属なし。
   ★並びの検査のため、配列はわざと氏名順に並べていない */
const COM_ROWS = [
  {
    id: 'B', name: 'テスト職員B', kana: 'テスト ショクインB', hireDate: '2020-04-01', retireDate: '', jobTitle: '介護',
    committeesJson: [{ code: 'abuse', role: 'chair' }, { code: 'infection', role: 'member' }, { code: 'safety', role: 'member' }]
  },
  {
    id: 'C', name: 'テスト職員C', kana: 'テスト ショクインC', hireDate: '2021-04-01', retireDate: '', jobTitle: '看護',
    committeesJson: [{ code: 'abuse', role: 'member' }, { code: 'infection', role: 'officer' }, { code: 'restraint', role: 'member' }]
  },
  {
    id: 'A', name: 'テスト職員A', kana: 'テスト ショクインA', hireDate: '2022-04-01', retireDate: '', jobTitle: '介護',
    committeesJson: [{ code: 'abuse', role: 'member' }, { code: 'infection', role: 'chair' }, { code: 'safety', role: 'member' }]
  },
  {
    id: 'D', name: 'テスト職員D', kana: 'テスト ショクインD', hireDate: '2015-04-01', retireDate: '2026-03-31', jobTitle: '介護',
    committeesJson: [{ code: 'abuse', role: 'chair' }, { code: 'infection', role: 'chair' }]
  },
  { id: 'E', name: 'テスト職員E', kana: 'テスト ショクインE', hireDate: '2020-04-01', retireDate: '', jobTitle: '厨房', committeesJson: [] }
];

function comOf(list, code) {
  return list.find((x) => x.code === code);
}

test('COMMITTEE_DEFAULTS: 既定6件が熊本市資料どおり（コード・対象・頻度・根拠・未実施の影響）', () => {
  /* 2026-09-22.2 で委員会以外の3件（bcp・disaster・hygiene）が末尾に増えた。
     このテストは既存6件の値を見るので先頭6件だけを相手にする（9件の内訳は下の新しいテスト） */
  assert.deepEqual(S.COMMITTEE_DEFAULTS.slice(0, 6).map((c) => c.code),
    ['abuse', 'restraint', 'infection', 'safety', 'kondan', 'dementia']);
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });

  assert.equal(by.abuse.label, '虐待防止委員会');
  assert.deepEqual(by.abuse.sites, ['facility', 'visit', 'day']);
  assert.equal(by.abuse.freq, '定期的');
  /* ★2026-09-22.5 訂正。第104条の2 は「地域との連携等」で虐待防止ではない（通所は第105条で準用）。
     指導指針は条例ではないので「第◯条」を持たない＝番号を落として文書名だけにする */
  assert.equal(by.abuse.basis, '居宅基準 第37条の2（訪問）／第105条で準用（通所）／熊本市有料老人ホーム設置運営指導指針');
  assert.equal(by.abuse.penalty, '高齢者虐待防止措置未実施減算（利用者全員1%・発見月から3か月は必ず減算）');

  assert.equal(by.restraint.label, '身体的拘束等適正化委員会');
  assert.deepEqual(by.restraint.sites, ['facility']);   /* 2026-09-23.4 条文どおり（訪問・通所に委員会の定めなし） */
  assert.equal(by.restraint.freq, '3か月に1回以上');                /* 2026-09-23.7 施設だけの頻度 */
  assert.equal(by.restraint.basis, '同指導指針');                 /* 2026-09-23.6 施設だけ＝熊本市の指導指針 */
  assert.equal(by.restraint.penalty, '');                         /* 2026-09-23.6 当社3事業所のどれにも減算は無い */
  assert.equal(by.restraint.hasPenalty, false);

  assert.equal(by.infection.label, '感染対策委員会');
  assert.deepEqual(by.infection.sites, ['facility', 'visit', 'day']);
  assert.equal(by.infection.freq, '概ね6か月に1回以上');
  /* ★2026-09-22.5 訂正。訪問介護の感染対策委員会は第31条【第3項】（第2項は設備・備品の衛生管理） */
  assert.equal(by.infection.basis, '居宅基準 第31条3項（訪問）／第104条2項（通所）／同指導指針');
  assert.equal(by.infection.penalty, '');                       /* 表の「—」＝減算なし */

  assert.equal(by.safety.label, '利用者の安全並びに介護サービスの質の確保及び職員の負担軽減に資する方策を検討するための委員会');
  assert.deepEqual(by.safety.sites, []);               /* 2026-09-23.4 条文どおり（第139条の2 は短期入所生活介護） */
  assert.equal(by.safety.freq, '定期的');
  assert.equal(by.safety.basis, '令和6年度介護報酬改定');
  assert.equal(by.safety.penalty, '令和9年4月1日から義務（経過措置は令和9年3月31日まで）');

  assert.equal(by.kondan.label, '運営懇談会');
  assert.deepEqual(by.kondan.sites, ['facility']);
  assert.equal(by.kondan.freq, '定期的');
  assert.equal(by.kondan.basis, '同指導指針');
  assert.equal(by.kondan.penalty, '');                          /* 表の「—」＝減算なし */

  assert.equal(by.dementia.label, '認知症ケアの事例検討・技術的指導会議');
  assert.deepEqual(by.dementia.sites, ['day']);
  assert.equal(by.dementia.freq, '定期的');
  assert.equal(by.dementia.basis, '通所介護 認知症加算');
  assert.equal(by.dementia.penalty, '加算を算定する場合に必要（現在は未算定＝既定で対象外）');
  assert.equal(by.dementia.inactive, true);                     /* 認知症加算が未算定のうちは対象外 */

  /* 画面の注記（§1 補足）。サーバー（staff-api.gs）の既定と1字一句そろえる */
  assert.equal(by.abuse.note, '委員会・指針・年1回以上の研修・担当者の設置の4つが揃って要件を満たす');
  assert.equal(by.restraint.note, '担当者は虐待防止委員会の担当者と同一が望ましい（指導指針）');
  assert.equal(by.infection.note, 'BCP の研修・訓練と一体的に実施してよい');
  assert.equal(by.safety.note, '管理者とケアを行う職種を含む幅広い職種で構成することが望ましい');
  assert.equal(by.kondan.note, '入居者・家族・設置者・外部の者で構成。定員が少ない等で困難なら代替措置可');
  /* 2026-09-22 チーフ裁定: 画面はマスタの値だけで説明できるようにする（定義を画面側に持たない）ため、
     空だった注記を埋めた。GAS 側の既定とも同じ文言にそろえてある。 */
  assert.equal(by.dementia.note, '認知症加算を算定する場合に必要。現在は未算定のため対象外');

  /* 対象は事業所コードの体系（SITE_CODES）と同じもので持つ。現在は対象外は認知症ケア会議だけ。
     ★2026-09-23.4: 生産性向上委員会は条文上どの事業所も対象でない（第139条の2 は短期入所生活介護）ので
       対象事業所が空。それ以外の委員会は1つ以上を持つ＝空の対象事業所は条文で説明できるものだけに限る */
  const NO_SITE_BY_STATUTE = ['safety'];
  S.COMMITTEE_DEFAULTS.forEach((c) => {
    if (NO_SITE_BY_STATUTE.indexOf(c.code) >= 0) assert.equal(c.sites.length, 0, c.code + ' は条文上の対象事業所なし');
    else assert.ok(c.sites.length > 0, c.code + ' は対象事業所を1つ以上持つ');
    c.sites.forEach((s) => assert.notEqual(S.SITE_CODES.indexOf(s), -1));
    assert.equal(c.inactive, c.code === 'dementia');
    assert.equal(typeof c.note, 'string');
  });
  assert.deepEqual(S.COMMITTEE_ROLES, [['chair', '委員長'], ['officer', '担当者'], ['member', '委員']]);
  assert.equal(S.committeeOf('abuse').label, '虐待防止委員会');
  assert.equal(S.committeeOf('ではない'), null);
  assert.equal(S.committeeOf(''), null);
  assert.equal(S.committees().length, 9);                       /* 2026-09-22.2 で委員会以外の3件が増えた */
});

test('committeesOf: 未知のコード・3種以外の役割・同じ委員会の重複・壊れた値を落とす', () => {
  const row = {
    id: 'X', committeesJson: [
      { code: 'abuse', role: 'chair' },
      { code: 'abuse', role: 'member' },                        /* 同じ委員会は先勝ち */
      { code: 'ではない', role: 'chair' },                       /* マスタに無い委員会 */
      { code: 'infection', role: 'boss' },                      /* 3種以外の役割 */
      { code: '', role: 'member' },
      { role: 'member' },
      null,
      'ではない',
      { code: 'kondan', role: 'member' }
    ]
  };
  assert.deepEqual(S.committeesOf(row), [{ code: 'abuse', role: 'chair' }, { code: 'kondan', role: 'member' }]);
  /* 配列でなければ空（シートを直接いじった等で壊れていても画面を止めない） */
  assert.deepEqual(S.committeesOf({ committeesJson: 'ではない' }), []);
  assert.deepEqual(S.committeesOf({ committeesJson: { abuse: 'chair' } }), []);
  assert.deepEqual(S.committeesOf({ committeesJson: null }), []);
  assert.deepEqual(S.committeesOf({}), []);
  assert.deepEqual(S.committeesOf(null), []);
  assert.deepEqual(S.committeesOf(undefined), []);
});

test('committeeMembers: 委員長 → 担当者 → 委員、同じ役割の中は氏名順（入力順ではない）', () => {
  const inf = S.committeeMembers(COM_ROWS, 'infection', COM_ASOF);
  assert.deepEqual(inf.map((m) => m.role), ['chair', 'officer', 'member']);
  assert.deepEqual(inf.map((m) => m.row.id), ['A', 'C', 'B']);
  const ab = S.committeeMembers(COM_ROWS, 'abuse', COM_ASOF);
  assert.deepEqual(ab.map((m) => m.role), ['chair', 'member', 'member']);
  assert.deepEqual(ab.map((m) => m.row.id), ['B', 'A', 'C']);   /* 委員2人は氏名順（配列は C→A の順） */
  /* 誰も居ない委員会は空。所属の無い人（E）はどこにも出ない */
  assert.deepEqual(S.committeeMembers(COM_ROWS, 'kondan', COM_ASOF), []);
  assert.equal(ab.filter((m) => m.row.id === 'E').length, 0);
});

test('committeeMembers: 退職した人は構成員に出ない（基準日の在職で決める）', () => {
  const ab = S.committeeMembers(COM_ROWS, 'abuse', COM_ASOF);
  assert.equal(ab.filter((m) => m.row.id === 'D').length, 0);   /* D は 2026-03-31 退職 */
  assert.equal(S.committeeMembers(COM_ROWS, 'infection', COM_ASOF).filter((m) => m.row.id === 'D').length, 0);
  /* 退職前の基準日なら数える（委員長が2人＝どちらも氏名順で並ぶ） */
  const past = S.committeeMembers(COM_ROWS, 'abuse', '2026-03-01');
  assert.deepEqual(past.map((m) => m.row.id), ['B', 'D', 'A', 'C']);
  assert.deepEqual(past.map((m) => m.role), ['chair', 'chair', 'member', 'member']);
  /* 退職者が委員長のままでも、基準日では「委員長が決まっていない」と出る */
  const st = S.committeeStats(COM_ROWS, COM_ASOF);
  assert.equal(comOf(st, 'abuse').chair, 1);                    /* B だけ（D は数えない） */
});

test('committeeStats: 減算のある委員会で担当者・委員長が空なら注意を出す（対象外の委員会には出さない）', () => {
  const st = S.committeeStats(COM_ROWS, COM_ASOF);
  assert.deepEqual(st.map((c) => c.code),
    ['abuse', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']);

  const ab = comOf(st, 'abuse');
  assert.equal(ab.total, 3);
  assert.equal(ab.chair, 1);
  assert.equal(ab.officer, 0);
  assert.equal(ab.member, 2);
  assert.deepEqual(ab.warn, ['担当者が決まっていません（減算の要件です）']);
  assert.equal(ab.label, '虐待防止委員会');                      /* 一覧に出す値も一緒に返す */
  assert.deepEqual(ab.sites, ['facility', 'visit', 'day']);

  /* 身体的拘束は 2026-09-23.6 から減算なし（施設だけ・熊本市の指導指針）＝「減算の要件です」は出さない */
  const res = comOf(st, 'restraint');
  assert.deepEqual(res.warn, ['委員長が決まっていません']);
  /* 減算のある委員会で委員長も担当者も空なら、減算の要件を先に出す（虐待防止の委員長を外して確かめる） */
  const noChair = COM_ROWS.map((r) => Object.assign({}, r, {
    committeesJson: (r.committeesJson || []).map((x) =>
      (x.code === 'abuse' && x.role === 'chair') ? { code: 'abuse', role: 'member' } : x)
  }));
  const ab2 = comOf(S.committeeStats(noChair, COM_ASOF), 'abuse');
  assert.deepEqual(ab2.warn, ['担当者が決まっていません（減算の要件です）', '委員長が決まっていません']);
  assert.equal(res.total, 1);

  /* 減算の無い委員会（未実施の影響が空）には担当者の注意を出さない */
  const inf = comOf(st, 'infection');
  assert.equal(inf.penalty, '');
  assert.equal(inf.chair, 1);
  assert.equal(inf.officer, 1);
  assert.deepEqual(inf.warn, []);

  /* 誰も居ない委員会 */
  const kon = comOf(st, 'kondan');
  assert.equal(kon.total, 0);
  assert.deepEqual(kon.warn, ['委員長が決まっていません', '委員が1人もいません']);

  /* 現在は対象外の委員会には注意を出さない（認知症加算が未算定のため） */
  const dem = comOf(st, 'dementia');
  assert.equal(dem.inactive, true);
  assert.equal(dem.total, 0);
  assert.deepEqual(dem.warn, []);
});

test('committeeStats: 対象事業所が無い委員会（safety）は体制の警告を出さず、要確認だけ（2026-09-23.6）', () => {
  const TODO = '要確認（法令上の扱いを確かめてください）';
  const one = comOf(S.committeeStats(COM_ROWS, COM_ASOF), 'safety');
  assert.deepEqual(one.sites, []);
  assert.equal(one.total, 2);                                   /* 構成員は数える（A・B とも介護） */
  assert.deepEqual(one.warn, [TODO]);                           /* 委員長・委員・職種の警告は出さない */
  const none = comOf(S.committeeStats([], COM_ASOF), 'safety');
  assert.deepEqual(none.warn, [TODO]);                          /* 誰も居なくても「委員が1人もいません」は出さない */
});

test('committeeStats: 幅広い職種の判定は、対象事業所がある時に働く（熊本市の判断で対象になった時のため）', () => {
  const WIDE = '幅広い職種で構成することが望ましい委員会です（いまは1職種）';
  const def = S.COMMITTEE_DEFAULTS.find((c) => c.code === 'safety');
  const keep = def.sites;
  const back = S.committees();
  try {
    def.sites = ['day'];                                        /* 検査の中だけ、対象事業所を持たせる */
    S.setCommittees(S.committees());
    const one = comOf(S.committeeStats(COM_ROWS, COM_ASOF), 'safety');
    assert.notEqual(one.warn.indexOf(WIDE), -1);
    const rows2 = COM_ROWS.concat([{
      id: 'F', name: 'テスト職員F', kana: 'テスト ショクインF', hireDate: '2020-04-01', retireDate: '', jobTitle: '看護',
      committeesJson: [{ code: 'safety', role: 'member' }]
    }]);
    const two = comOf(S.committeeStats(rows2, COM_ASOF), 'safety');
    assert.equal(two.warn.indexOf(WIDE), -1);
    assert.notEqual(two.warn.indexOf('委員長が決まっていません'), -1);
    S.committeeStats(rows2, COM_ASOF).forEach((c) => {
      if (c.code !== 'safety') assert.equal(c.warn.indexOf(WIDE), -1);
    });
  } finally {
    def.sites = keep;                                           /* 必ず元に戻す */
    S.setCommittees(back);
  }
  assert.deepEqual(S.COMMITTEE_DEFAULTS.find((c) => c.code === 'safety').sites, []);
});

test('committeeStats / committeeMembers: 空配列・不正な基準日でも落ちない', () => {
  const empty = S.committeeStats([], COM_ASOF);
  assert.equal(empty.length, 9);
  empty.forEach((c) => {
    assert.equal(c.total, 0);
    assert.equal(c.chair, 0);
    assert.equal(c.officer, 0);
    assert.equal(c.member, 0);
    /* 委員会ではない体制（計画と訓練・選任）には「委員が1人もいません」を出さない（2026-09-22.2） */
    /* 2026-09-23.6: 既定の対象事業所が空の委員会（生産性向上）には体制の警告を出さない */
    assert.equal(c.warn.indexOf('委員が1人もいません') >= 0, !c.inactive && c.kind === 'committee' && c.sites.length > 0);
  });
  assert.equal(S.committeeStats(null, COM_ASOF).length, 9);
  assert.equal(S.committeeStats(COM_ROWS, 'ではない').length, 9);   /* 不正な基準日 */
  assert.equal(S.committeeStats(COM_ROWS).length, 9);               /* 基準日の省略（today で数える） */
  assert.deepEqual(S.committeeMembers([], 'abuse', COM_ASOF), []);
  assert.deepEqual(S.committeeMembers(null, 'abuse', COM_ASOF), []);
  assert.deepEqual(S.committeeMembers(COM_ROWS, 'ではない', COM_ASOF), []);
  assert.deepEqual(S.committeeMembers(COM_ROWS, '', COM_ASOF), []);
  assert.deepEqual(S.committeeMembers([null, undefined], 'abuse', COM_ASOF), []);
});

test('committeeStats: 元の rows を書き換えない', () => {
  const before = JSON.stringify(COM_ROWS);
  S.committeeStats(COM_ROWS, COM_ASOF);
  S.committeeMembers(COM_ROWS, 'abuse', COM_ASOF);
  S.committeesOf(COM_ROWS[0]);
  assert.equal(COM_ROWS.length, 5);
  assert.equal(JSON.stringify(COM_ROWS), before);
});

test('setCommittees: サーバーのマスタへ差し替える（壊れた項目だけ落として残りは活かす）', () => {
  const back = S.committees();
  try {
    const n = S.setCommittees([
      { code: 'abuse', label: '虐待防止委員会', sites: ['facility'], freq: '毎月', basis: '架空の根拠', penalty: '架空の減算', note: '架空の注記' },
      { code: 'x1', label: '架空委員会', sites: ['visit', 'ではない', 'visit'], freq: '年1回以上', inactive: true },
      { code: 'abuse', label: '重複は先勝ち' },
      { code: 'x2' },                                           /* 名前が無ければコードを出す */
      { label: 'コードなし' },
      null,
      'ではない'
    ]);
    /* 送られた3件＋既定のうち送られてこなかった8件（2026-09-22.2 のマージ。下の専用テスト参照） */
    assert.equal(n, 11);
    assert.deepEqual(S.committees().map((c) => c.code),
      ['abuse', 'x1', 'x2', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']);
    assert.equal(S.committeeOf('abuse').freq, '毎月');
    assert.equal(S.committeeOf('abuse').label, '虐待防止委員会');
    assert.deepEqual(S.committeeOf('x1').sites, ['visit']);     /* 知らない事業所コード・重複は落とす */
    assert.equal(S.committeeOf('x1').inactive, true);
    assert.equal(S.committeeOf('x2').label, 'x2');
    assert.equal(S.committeeOf('kondan').label, '運営懇談会');   /* 既定の体制は送られてこなくても消えない */
    /* マスタに無い委員会は所属からも落ちる＝集計に幽霊が残らない（既定にも無いコードで見る） */
    assert.equal(S.committeeOf('x9'), null);
    assert.deepEqual(S.committeesOf({ committeesJson: [{ code: 'x9', role: 'chair' }] }), []);
    assert.deepEqual(S.committeeStats(COM_ROWS, COM_ASOF).map((c) => c.code),
      ['abuse', 'x1', 'x2', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']);
    /* 差し替え後も職種の注意は safety のコードにだけ結びつく */
    assert.equal(comOf(S.committeeStats(COM_ROWS, COM_ASOF), 'x1').warn.length, 0);   /* inactive */
  } finally {
    assert.equal(S.setCommittees(back), 9);
  }
  assert.deepEqual(S.committees().map((c) => c.code), S.COMMITTEE_DEFAULTS.map((c) => c.code));
  assert.equal(S.committeeOf('abuse').freq, '定期的');
});

test('setCommittees: 空配列・壊れた応答では既定の委員会を失わない（安全側に倒す）', () => {
  const before = S.committees();
  assert.equal(S.setCommittees([]), 0);                         /* 空配列は無視 */
  assert.equal(S.setCommittees(null), 0);
  assert.equal(S.setCommittees(undefined), 0);
  assert.equal(S.setCommittees('ではない'), 0);
  assert.equal(S.setCommittees({ 0: { code: 'abuse' } }), 0);   /* 配列でない */
  assert.equal(S.setCommittees([null, 'ではない', { label: 'コードなし' }]), 0);
  assert.deepEqual(S.committees(), before);
  assert.equal(S.committees().length, 9);
});

/* ★2026-09-22 実測の不具合の回帰テスト。
   setCommittees が hasPenalty を落とすと、サーバーのマスタを読み込んだ瞬間に
   「担当者が決まっていません（減算の要件です）」が永久に出なくなる。
   画面は起動のたびにサーバーのマスタを読むため、本番では一度も出ない状態になっていた。 */
test('setCommittees: サーバーのマスタを読み込んでも減算の注意が消えない', () => {
  const rows = [{ id: '1', name: 'A', hireDate: '2020-04-01', jobTitle: '介護',
                  committeesJson: [{ code: 'abuse', role: 'member' }] }];   /* 例は虐待防止（身体的拘束は 2026-09-23.6 から減算なし） */
  const warnOf = () => S.committeeStats(rows, '2026-09-22').find((x) => x.code === 'abuse').warn;
  const before = warnOf();
  assert.ok(before.some((w) => /減算の要件です/.test(w)), '読み込み前に出ていること');

  /* サーバーが返した値として、そのまま渡す／JSON を通して渡す の両方で確かめる */
  S.setCommittees(S.COMMITTEE_DEFAULTS);
  assert.ok(warnOf().some((w) => /減算の要件です/.test(w)), 'そのまま渡した後も出ること');
  S.setCommittees(JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS)));
  assert.ok(warnOf().some((w) => /減算の要件です/.test(w)), 'JSON を通した後も出ること');

  /* 減算の無い委員会には出ない（safety は令和9年4月からの義務であって減算ではない） */
  const rows2 = [{ id: '1', name: 'A', hireDate: '2020-04-01', jobTitle: '介護',
                   committeesJson: [{ code: 'safety', role: 'member' }] }];
  const w2 = S.committeeStats(rows2, '2026-09-22').find((x) => x.code === 'safety').warn;
  assert.ok(!w2.some((w) => /減算の要件です/.test(w)), 'safety には出ないこと');
});

/* ★2026-09-22 の指摘（積み残し1）の回帰テスト。
   hasPenalty を持たない古い committeesJson が meta に残っていると、それを読んだ瞬間に
   減算の注意が消えてしまう。減算の有無は制度上の事実なので、既定にある委員会は
   保存済みの値ではなく既定を正とする。 */
test('setCommittees: 減算の有無を持たない古いマスタを読んでも注意が消えない', () => {
  const rows = [{ id: '1', name: 'A', hireDate: '2020-04-01', jobTitle: '介護',
                  committeesJson: [{ code: 'abuse', role: 'member' }] }];
  const warnOf = () => S.committeeStats(rows, '2026-09-22').find((x) => x.code === 'abuse').warn;

  /* hasPenalty を落とした（古い版が保存した）マスタを渡す */
  const old = S.COMMITTEE_DEFAULTS.map((c) => {
    const o = Object.assign({}, c); delete o.hasPenalty; return o;
  });
  S.setCommittees(old);
  assert.equal(S.committeeOf('abuse').hasPenalty, true, '既定から引き直すこと（例は虐待防止。身体的拘束は 2026-09-23.6 から減算なし）');
  assert.ok(warnOf().some((w) => /減算の要件です/.test(w)), '注意が出続けること');

  /* 逆に、人が hasPenalty を true にした値を送ってきても、既定が false の委員会は false のまま */
  const forged = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, { hasPenalty: true }));
  S.setCommittees(forged);
  assert.equal(S.committeeOf('safety').hasPenalty, false, '既定が false なら false のまま');
  assert.equal(S.committeeOf('restraint').hasPenalty, false, '身体的拘束も既定が false（2026-09-23.6）なので false のまま');
  const rows2 = [{ id: '1', name: 'A', hireDate: '2020-04-01', jobTitle: '介護',
                   committeesJson: [{ code: 'safety', role: 'member' }] }];
  const w2 = S.committeeStats(rows2, '2026-09-22').find((x) => x.code === 'safety').warn;
  assert.ok(!w2.some((w) => /減算の要件です/.test(w)), 'safety には出ないまま');

  S.setCommittees(S.COMMITTEE_DEFAULTS);
});

/* ── 委員会以外の体制と「要件の表示」（spec-committee2.md §1〜§3・版 2026-09-22.2）──
   既定は9件（委員会6・計画と訓練2・選任1）。BCP・非常災害対策・衛生推進者は委員会では
   ないので、「委員長が決まっていません」「委員が1人もいません」を出さない。出すと、実地指導に
   出す紙へ存在しない要件を自分から書くことになる。担当者の注意は減算のある体制にだけ出す
   （BCP は業務継続計画未策定減算があるので出る）。
   値は熊本市の集団指導資料から起こした確定値なので、1字一句そのまま突き合わせる。 */

const KIND_ASOF = '2026-04-01';

/* 架空の1名。委員会以外の3件に「委員」として入れてあるが、委員長・担当者は空 */
const KIND_ROWS = [
  {
    id: 'G', name: 'テスト職員G', kana: 'テスト ショクインG', hireDate: '2020-04-01', retireDate: '', jobTitle: '介護',
    committeesJson: [{ code: 'bcp', role: 'member' }, { code: 'disaster', role: 'member' }, { code: 'hygiene', role: 'member' }]
  }
];

test('COMMITTEE_DEFAULTS: 既定は9件、種別の内訳は 委員会6・計画と訓練2・選任1', () => {
  assert.deepEqual(S.COMMITTEE_DEFAULTS.map((c) => c.code),
    ['abuse', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']);
  const count = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { count[c.kind] = (count[c.kind] || 0) + 1; });
  assert.deepEqual(count, { committee: 6, plan: 2, officer: 1 });
  S.COMMITTEE_DEFAULTS.slice(0, 6).forEach((c) => assert.equal(c.kind, 'committee', c.code));
  assert.equal(S.committeeOf('bcp').kind, 'plan');
  assert.equal(S.committeeOf('disaster').kind, 'plan');
  assert.equal(S.committeeOf('hygiene').kind, 'officer');
  /* 画面の見出しの区切りに使う種別の一覧 */
  assert.deepEqual(S.COMMITTEE_KINDS, [['committee', '委員会'], ['plan', '計画と訓練'], ['officer', '選任']]);
  /* 要確認の印は衛生推進者と生産性向上委員会の2件（2026-09-22.5）。
     衛生＝事業場の数え方で選任義務が変わる／安全＝3事業所が対象に含まれる根拠が見つからない */
  S.COMMITTEE_DEFAULTS.forEach((c) =>
    assert.equal(c.todo === true, c.code === 'hygiene' || c.code === 'safety', c.code));
});

test('COMMITTEE_DEFAULTS: 新しい3件（BCP・非常災害対策・衛生推進者）が熊本市資料どおり', () => {
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });

  assert.equal(by.bcp.label, '業務継続計画（BCP）');
  assert.deepEqual(by.bcp.sites, ['facility', 'visit', 'day']);
  assert.equal(by.bcp.freq, '委員会の設置義務はなし');
  assert.equal(by.bcp.basis, '令和3年度改正（令和6年4月1日から義務）／業務継続計画未策定減算');
  assert.equal(by.bcp.penalty, '業務継続計画未策定減算（利用者全員1%・訪問介護と通所介護は令和7年4月1日から適用）');
  assert.equal(by.bcp.hasPenalty, true);
  assert.equal(by.bcp.purpose, '減算を避けるため（業務継続計画未策定減算）');
  assert.equal(by.bcp.training, '定期的');
  assert.equal(by.bcp.drill, '定期的（感染症は感染対策と、災害は非常災害対策の訓練と一体実施可）');
  assert.equal(by.bcp.note, '計画の策定と、計画に従った措置が減算の判定対象。周知・研修・訓練・見直しの有無は減算の要件ではない');
  assert.equal(by.bcp.inactive, false);

  assert.equal(by.disaster.label, '非常災害対策');
  assert.deepEqual(by.disaster.sites, ['facility', 'day']);
  assert.equal(by.disaster.freq, '委員会の設置義務はなし');
  assert.equal(by.disaster.basis, '運営基準／消防法施行規則 第3条（消防計画）');
  assert.equal(by.disaster.penalty, '');
  assert.equal(by.disaster.hasPenalty, false);
  assert.equal(by.disaster.purpose, '法令上の義務（訪問介護には計画策定・訓練の定めなし）');
  assert.equal(by.disaster.training, '定期的に従業者へ周知');
  assert.equal(by.disaster.drill, '避難訓練は年2回以上（消防法施行規則）。実施した内容の記録を残すこと');
  assert.equal(by.disaster.note, '浸水想定区域・土砂災害警戒区域内で市の地域防災計画に定められた施設は、避難確保計画の作成・避難訓練・訓練結果の報告も必要');
  assert.equal(by.disaster.inactive, false);

  assert.equal(by.hygiene.label, '衛生推進者の選任');
  assert.deepEqual(by.hygiene.sites, ['facility', 'visit', 'day']);
  assert.equal(by.hygiene.freq, '委員会の設置義務はなし');
  assert.equal(by.hygiene.basis, '労働安全衛生法（介護保険の集団指導資料には記載なし）');
  assert.equal(by.hygiene.penalty, '');
  assert.equal(by.hygiene.hasPenalty, false);
  assert.equal(by.hygiene.purpose, '法令上の義務（労働安全衛生法）');
  assert.ok(!by.hygiene.training);                              /* 研修・訓練の定めは無い */
  assert.ok(!by.hygiene.drill);
  assert.equal(by.hygiene.todo, true);
  assert.equal(by.hygiene.note, '常時10人以上50人未満の事業場に選任義務。事業場をどう数えるか（3事業所を別々に見るか同一敷地で一体と見るか）で結論が変わるため、労働基準監督署または社会保険労務士への確認が要る');
  assert.equal(by.hygiene.inactive, false);
});

test('COMMITTEE_DEFAULTS: 非常災害対策の対象に訪問は入らない（訪問介護には計画策定・訓練の定めが無い）', () => {
  assert.equal(S.committeeOf('disaster').sites.indexOf('visit'), -1);
  assert.deepEqual(S.committeeOf('disaster').sites, ['facility', 'day']);
  /* BCP と衛生推進者は3事業所すべてが対象（ここと取り違えない） */
  assert.notEqual(S.committeeOf('bcp').sites.indexOf('visit'), -1);
  assert.notEqual(S.committeeOf('hygiene').sites.indexOf('visit'), -1);
  /* 集計に出る行も同じ（画面はこちらを見る） */
  const st = S.committeeStats(KIND_ROWS, KIND_ASOF);
  assert.deepEqual(st.find((x) => x.code === 'disaster').sites, ['facility', 'day']);
});

test('COMMITTEE_DEFAULTS: 既存6件に足した「何のため・研修・訓練・通称」が表どおり', () => {
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });

  assert.equal(by.abuse.purpose, '減算を避けるため（高齢者虐待防止措置未実施減算）');
  /* ★年2回以上は特別養護老人ホーム等の施設系の要件。当社3事業所は該当しない */
  assert.equal(by.abuse.training, '訪問介護は年1回以上／通所介護・住宅型は定期的');
  assert.ok(!by.abuse.drill);

  assert.equal(by.restraint.purpose, '熊本市有料老人ホーム設置運営指導指針による義務');   /* 2026-09-23.6 */
  assert.equal(by.restraint.training, '定期的');
  assert.ok(!by.restraint.drill);

  assert.equal(by.infection.purpose, '法令上の義務（運営基準）');
  assert.equal(by.infection.training, '定期的');
  assert.equal(by.infection.drill, '定期的（BCP の研修・訓練と一体実施可）');

  assert.equal(by.safety.purpose, '法令上の義務（令和9年4月1日から）');
  assert.ok(!by.safety.training);
  assert.ok(!by.safety.drill);

  assert.equal(by.kondan.purpose, '熊本市有料老人ホーム設置運営指導指針による義務');
  assert.equal(by.dementia.purpose, '加算の要件（通所介護 認知症加算）');

  /* 通称は safety（生産性向上委員会）だけ */
  assert.equal(by.safety.alias, '生産性向上委員会');
  ['abuse', 'restraint', 'infection', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']
    .forEach((c) => assert.ok(!by[c].alias, c));
  const st = S.committeeStats([], KIND_ASOF);
  assert.equal(st.find((x) => x.code === 'safety').alias, '生産性向上委員会');
  assert.equal(st.find((x) => x.code === 'abuse').alias, '');   /* 集計の行では空文字にそろえる */
});

test('committeeStats: 各行に 種別・通称・何のため・研修・訓練・要確認 を載せる', () => {
  const st = S.committeeStats(KIND_ROWS, KIND_ASOF);
  assert.equal(st.length, 9);
  st.forEach((c) => {
    assert.equal(typeof c.kind, 'string', c.code);
    assert.equal(typeof c.alias, 'string', c.code);
    assert.equal(typeof c.purpose, 'string', c.code);
    assert.equal(typeof c.training, 'string', c.code);
    assert.equal(typeof c.drill, 'string', c.code);
    assert.equal(typeof c.todo, 'boolean', c.code);
  });
  const bcp = st.find((x) => x.code === 'bcp');
  assert.equal(bcp.kind, 'plan');
  assert.equal(bcp.purpose, '減算を避けるため（業務継続計画未策定減算）');
  assert.equal(bcp.training, '定期的');
  assert.equal(bcp.drill, '定期的（感染症は感染対策と、災害は非常災害対策の訓練と一体実施可）');
  assert.equal(bcp.todo, false);
  const hyg = st.find((x) => x.code === 'hygiene');
  assert.equal(hyg.kind, 'officer');
  assert.equal(hyg.todo, true);
  assert.equal(st.find((x) => x.code === 'abuse').kind, 'committee');
});

test('committeeStats: 委員会でない体制には委員長・委員の注意を出さない（構成員が居ても居なくても）', () => {
  const CHAIR = '委員長が決まっていません';
  const MEMBER = '委員が1人もいません';
  [S.committeeStats([], KIND_ASOF), S.committeeStats(KIND_ROWS, KIND_ASOF)].forEach((st) => {
    st.forEach((c) => {
      if (c.kind === 'committee') return;
      assert.equal(c.warn.indexOf(CHAIR), -1, c.code);
      assert.equal(c.warn.indexOf(MEMBER), -1, c.code);
    });
    /* 委員会のほうには従来どおり出る（出し分けが効いていることの裏取り） */
    const kon = st.find((x) => x.code === 'kondan');
    assert.notEqual(kon.warn.indexOf(CHAIR), -1);
    assert.notEqual(kon.warn.indexOf(MEMBER), -1);
  });
  /* ★2026-09-22.3 レビュー2 で契約を追加。KIND_ROWS は bcp・disaster・hygiene に「委員」を
     置いている（＝委員会でない体制に委員が入っている状態）。旧契約ではここは注意ゼロだったが、
     実地指導に出す紙に存在しない役職を刷らせないため、いまは1件出す。
     ★出すのは「置けません」の1文だけで、「委員長が決まっていません」「委員が1人もいません」
       （＝委員会にだけ出す不足の注意）は従来どおり出さない。上の forEach がそれを見ている。 */
  const NOTCM = '委員会ではないので委員長・委員は置けません（担当者に直してください）';
  assert.deepEqual(S.committeeStats(KIND_ROWS, KIND_ASOF).find((x) => x.code === 'disaster').warn, [NOTCM]);
  /* 誰も入っていなければ出ない（空を責めない） */
  assert.deepEqual(S.committeeStats([], KIND_ASOF).find((x) => x.code === 'disaster').warn, []);
});

test('committeeStats: BCP は担当者が空なら減算の注意を出す（委員会ではないが減算はある）', () => {
  const OFFICER = '担当者が決まっていません（減算の要件です）';
  assert.equal(S.committeeOf('bcp').hasPenalty, true);          /* 集計の行は penalty だけを持つ（従来どおり） */
  const bcp = S.committeeStats(KIND_ROWS, KIND_ASOF).find((x) => x.code === 'bcp');
  assert.equal(bcp.penalty, '業務継続計画未策定減算（利用者全員1%・訪問介護と通所介護は令和7年4月1日から適用）');
  assert.equal(bcp.officer, 0);
  assert.equal(bcp.total, 1);
  /* ★2026-09-22.3 レビュー2。KIND_ROWS は BCP に「委員」を置いているので、減算の注意に加えて
     「委員会ではないので…」が1件出る。「委員長が決まっていません」等の不足の注意は従来どおり出ない。 */
  const NOTCM = '委員会ではないので委員長・委員は置けません（担当者に直してください）';
  assert.deepEqual(bcp.warn, [OFFICER, NOTCM]);

  /* 担当者を決めれば減算の注意は消える（委員が残っている間は「置けません」だけ残る） */
  const rows = KIND_ROWS.concat([{
    id: 'H', name: 'テスト職員H', kana: 'テスト ショクインH', hireDate: '2019-04-01', retireDate: '', jobTitle: '看護',
    committeesJson: [{ code: 'bcp', role: 'officer' }]
  }]);
  const after = S.committeeStats(rows, KIND_ASOF).find((x) => x.code === 'bcp');
  assert.equal(after.officer, 1);
  assert.deepEqual(after.warn, [NOTCM]);
  /* 委員を外して担当者だけにすれば注意はゼロになる */
  const clean = [{
    id: 'H', name: 'テスト職員H', kana: 'テスト ショクインH', hireDate: '2019-04-01', retireDate: '', jobTitle: '看護',
    committeesJson: [{ code: 'bcp', role: 'officer' }]
  }];
  assert.deepEqual(S.committeeStats(clean, KIND_ASOF).find((x) => x.code === 'bcp').warn, []);
  /* 減算の無い体制には出ない */
  ['disaster', 'hygiene'].forEach((c) => {
    assert.equal(S.committeeStats(rows, KIND_ASOF).find((x) => x.code === c).warn.indexOf(OFFICER), -1, c);
  });
});

test('committeeStats: 衛生推進者は「要確認」を出し続ける（事業場の数え方で選任義務が変わる）', () => {
  const TODO = '要確認（法令上の扱いを確かめてください）';
  const empty = S.committeeStats([], KIND_ASOF).find((x) => x.code === 'hygiene');
  assert.deepEqual(empty.warn, [TODO]);
  /* 担当者を決めても、法令上の扱いが決まるまでは消さない */
  const rows = [{
    id: 'I', name: 'テスト職員I', kana: 'テスト ショクインI', hireDate: '2019-04-01', retireDate: '', jobTitle: '事務',
    committeesJson: [{ code: 'hygiene', role: 'officer' }]
  }];
  assert.deepEqual(S.committeeStats(rows, KIND_ASOF).find((x) => x.code === 'hygiene').warn, [TODO]);
  /* 要確認が出るのは衛生推進者と生産性向上委員会だけ（2026-09-22.5 で safety を追加）*/
  S.committeeStats(rows, KIND_ASOF).forEach((c) => {
    if (c.code !== 'hygiene' && c.code !== 'safety') assert.equal(c.warn.indexOf(TODO), -1, c.code);
  });
  assert.notEqual(S.committeeStats(rows, KIND_ASOF).find((x) => x.code === 'safety').warn.indexOf(TODO), -1);
});

test('setCommittees: 種別・通称・何のため・研修・訓練・要確認が落ちない（既定から引き直す）', () => {
  const back = S.committees();
  const check = (where) => {
    assert.equal(S.committees().length, 9, where);
    assert.equal(S.committeeOf('bcp').kind, 'plan', where);
    assert.equal(S.committeeOf('bcp').hasPenalty, true, where);
    assert.equal(S.committeeOf('bcp').purpose, '減算を避けるため（業務継続計画未策定減算）', where);
    assert.equal(S.committeeOf('bcp').training, '定期的', where);
    assert.equal(S.committeeOf('bcp').drill, '定期的（感染症は感染対策と、災害は非常災害対策の訓練と一体実施可）', where);
    assert.equal(S.committeeOf('disaster').kind, 'plan', where);
    assert.deepEqual(S.committeeOf('disaster').sites, ['facility', 'day'], where);
    assert.equal(S.committeeOf('hygiene').kind, 'officer', where);
    assert.equal(S.committeeOf('hygiene').todo, true, where);
    assert.equal(S.committeeOf('safety').alias, '生産性向上委員会', where);
    assert.equal(S.committeeOf('abuse').kind, 'committee', where);
    const st = S.committeeStats(KIND_ROWS, KIND_ASOF);
    ['bcp', 'disaster', 'hygiene'].forEach((c) => {
      const w = st.find((x) => x.code === c).warn;
      assert.equal(w.indexOf('委員長が決まっていません'), -1, where + '/' + c);
      assert.equal(w.indexOf('委員が1人もいません'), -1, where + '/' + c);
    });
    /* ★2026-09-22.3 レビュー2。KIND_ROWS は bcp・hygiene にも「委員」を置いているので
       「委員会ではないので…」が1件付く（不足の注意は上の forEach どおり出ない） */
    const NOTCM = '委員会ではないので委員長・委員は置けません（担当者に直してください）';
    assert.deepEqual(st.find((x) => x.code === 'bcp').warn,
      ['担当者が決まっていません（減算の要件です）', NOTCM], where);
    assert.deepEqual(st.find((x) => x.code === 'hygiene').warn,
      [NOTCM, '要確認（法令上の扱いを確かめてください）'], where);
  };
  try {
    assert.equal(S.setCommittees(S.COMMITTEE_DEFAULTS), 9);     /* そのまま渡す */
    check('そのまま');
    assert.equal(S.setCommittees(JSON.parse(JSON.stringify(S.COMMITTEE_DEFAULTS))), 9);   /* JSON を通す */
    check('JSON');
    /* 項目を抜いた古い形（2026-09-22.1 以前が保存したマスタ）。制度上の事実は既定から引き直す */
    const old = S.COMMITTEE_DEFAULTS.map((c) => {
      const o = Object.assign({}, c);
      delete o.kind; delete o.alias; delete o.purpose; delete o.training; delete o.drill; delete o.todo; delete o.hasPenalty;
      return o;
    });
    assert.equal(S.setCommittees(old), 9);
    check('古い形');
    /* 人が画面から変えた値を送ってきても、既定にある体制は既定の値のまま */
    const forged = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, {
      kind: 'committee', alias: '架空の通称', purpose: '架空の目的', training: '架空の研修', drill: '架空の訓練', todo: true
    }));
    assert.equal(S.setCommittees(forged), 9);
    check('作り替えた値');
  } finally {
    S.setCommittees(back);
  }
  assert.deepEqual(S.committees().map((c) => c.code), S.COMMITTEE_DEFAULTS.map((c) => c.code));
  assert.equal(S.committeeOf('hygiene').todo, true);
});

test('setCommittees: 既定に無い体制は送られた種別・説明をそのまま使い、知らない種別は委員会に寄せる', () => {
  const back = S.committees();
  try {
    assert.equal(S.setCommittees([
      { code: 'x1', label: '架空の計画', kind: 'plan', purpose: '架空の目的', training: '架空の研修', drill: '架空の訓練', todo: true },
      { code: 'x2', label: '架空の体制', kind: 'ではない' },
      { code: 'x3', label: '種別なし' }
    ]), 12);                                                    /* 送った3件＋既定9件（マージ） */
    assert.equal(S.committeeOf('x1').kind, 'plan');
    assert.equal(S.committeeOf('x1').purpose, '架空の目的');
    assert.equal(S.committeeOf('x1').training, '架空の研修');
    assert.equal(S.committeeOf('x1').drill, '架空の訓練');
    assert.equal(S.committeeOf('x1').todo, true);
    /* 知らない種別・未指定は 'committee' へ寄せる＝委員長・委員の注意を静かに消さない（安全側） */
    assert.equal(S.committeeOf('x2').kind, 'committee');
    assert.equal(S.committeeOf('x3').kind, 'committee');
    const st = S.committeeStats([], KIND_ASOF);
    assert.deepEqual(st.find((x) => x.code === 'x1').warn, ['要確認（法令上の扱いを確かめてください）']);
    assert.notEqual(st.find((x) => x.code === 'x2').warn.indexOf('委員が1人もいません'), -1);
  } finally {
    assert.equal(S.setCommittees(back), 9);
  }
});

/* ★2026-09-22.2 の穴の回帰テスト（コーディネータ指摘・高）。
   前の版の時代に「6件だけ」保存された meta を本番のサーバーから受け取ると、そのまま差し替えると
   BCP・非常災害対策・衛生推進者が画面から消える。制度上の体制は、人が保存した覚えが無くても
   存在する。だから setCommittees は「既定にあって送られてこなかった code を末尾に足す」。
   足すのは既定の値そのまま。送られてきた分の編集（名前・頻度・対象外の印）は保存値のまま残す。 */

/* 前の版（2026-09-22.1 以前）が保存したであろう6件。新項目は持っていない */
function legacySix() {
  return S.COMMITTEE_DEFAULTS.slice(0, 6).map((c) => {
    const o = JSON.parse(JSON.stringify(c));
    delete o.kind; delete o.alias; delete o.purpose; delete o.training; delete o.drill; delete o.todo; delete o.hasPenalty;
    return o;
  });
}

test('setCommittees: 6件だけのマスタを読んでも委員会以外の3件が消えない（既定から足し戻す）', () => {
  const back = S.committees();
  try {
    assert.equal(S.setCommittees(legacySix()), 9);
    assert.equal(S.committees().length, 9);
    /* 並びは「送られた分をその順」→「既定にしか無い分を既定の順」 */
    assert.deepEqual(S.committees().map((c) => c.code),
      ['abuse', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']);

    /* 足した3件は既定の値そのまま（画面の「要件の表示」が欠けない） */
    const bcp = S.committeeOf('bcp');
    assert.equal(bcp.label, '業務継続計画（BCP）');
    assert.equal(bcp.kind, 'plan');
    assert.equal(bcp.hasPenalty, true);
    assert.equal(bcp.freq, '委員会の設置義務はなし');
    assert.equal(bcp.basis, '令和3年度改正（令和6年4月1日から義務）／業務継続計画未策定減算');
    assert.equal(bcp.penalty, '業務継続計画未策定減算（利用者全員1%・訪問介護と通所介護は令和7年4月1日から適用）');
    assert.equal(bcp.purpose, '減算を避けるため（業務継続計画未策定減算）');
    assert.equal(bcp.training, '定期的');
    assert.equal(bcp.drill, '定期的（感染症は感染対策と、災害は非常災害対策の訓練と一体実施可）');
    assert.equal(bcp.note, '計画の策定と、計画に従った措置が減算の判定対象。周知・研修・訓練・見直しの有無は減算の要件ではない');
    assert.deepEqual(S.committeeOf('disaster').sites, ['facility', 'day']);
    assert.equal(S.committeeOf('disaster').training, '定期的に従業者へ周知');
    assert.equal(S.committeeOf('hygiene').kind, 'officer');
    assert.equal(S.committeeOf('hygiene').todo, true);
    assert.equal(S.committeeOf('safety').alias, '生産性向上委員会');

    /* 足した体制の sites は複製＝呼び手が並べ替えても既定が崩れない */
    S.committeeOf('bcp').sites.pop();
    assert.deepEqual(S.COMMITTEE_DEFAULTS[6].sites, ['facility', 'visit', 'day']);

    /* 注意も正しく出る（足しただけの体制でも warn の出し分けが効く） */
    const st = S.committeeStats([], KIND_ASOF);
    assert.equal(st.length, 9);
    assert.deepEqual(st.find((x) => x.code === 'bcp').warn, ['担当者が決まっていません（減算の要件です）']);
    assert.deepEqual(st.find((x) => x.code === 'disaster').warn, []);
    assert.deepEqual(st.find((x) => x.code === 'hygiene').warn, ['要確認（法令上の扱いを確かめてください）']);
  } finally {
    S.setCommittees(back);
  }
});

test('setCommittees: 足し戻しても、送られてきた分の編集（名前・頻度・対象外の印）は保存値のまま', () => {
  const back = S.committees();
  try {
    const six = legacySix();
    six[4].label = '運営懇談会（毎年6月）';                      /* 人が名前を直した保存値 */
    six[4].freq = '年1回以上';
    six[5].inactive = false;                                    /* 認知症加算を算定し始めて「対象」に直した保存値 */
    six[0].note = '架空の注記';
    assert.equal(S.setCommittees(six), 9);

    assert.equal(S.committeeOf('kondan').label, '運営懇談会（毎年6月）');
    assert.equal(S.committeeOf('kondan').freq, '年1回以上');
    assert.equal(S.committeeOf('dementia').inactive, false);    /* マージで既定（true）へ戻さない */
    assert.equal(S.committeeOf('abuse').note, '架空の注記');
    /* 制度上の事実は従来どおり既定が正（人が画面から変えられない） */
    assert.equal(S.committeeOf('dementia').purpose, '加算の要件（通所介護 認知症加算）');
    assert.equal(S.committeeOf('abuse').hasPenalty, true);
    assert.equal(S.committeeOf('abuse').kind, 'committee');
  } finally {
    S.setCommittees(back);
  }
  assert.equal(S.committeeOf('dementia').inactive, true);       /* 既定へ戻したら元どおり */
  assert.equal(S.committeeOf('kondan').label, '運営懇談会');
});

test('setCommittees: 既定に無い体制（人が足した分）はマージ後も残る', () => {
  const back = S.committees();
  try {
    const list = legacySix().concat([
      { code: 'x9', label: '架空の体制', kind: 'plan', sites: ['visit'], freq: '毎月', purpose: '架空の目的', todo: true }
    ]);
    assert.equal(S.setCommittees(list), 10);
    assert.deepEqual(S.committees().map((c) => c.code),
      ['abuse', 'restraint', 'infection', 'safety', 'kondan', 'dementia', 'x9', 'bcp', 'disaster', 'hygiene']);
    const x9 = S.committeeOf('x9');
    assert.equal(x9.label, '架空の体制');
    assert.equal(x9.kind, 'plan');
    assert.equal(x9.purpose, '架空の目的');                      /* 既定に無い code は送られた値をそのまま使う */
    assert.equal(x9.todo, true);
    assert.deepEqual(x9.sites, ['visit']);
    /* 既定の9件も全部そろっている */
    S.COMMITTEE_DEFAULTS.forEach((d) => assert.notEqual(S.committeeOf(d.code), null, d.code));
  } finally {
    S.setCommittees(back);
  }
  assert.equal(S.committeeOf('x9'), null);                      /* 既定に戻せば消える（幽霊は残さない） */
});

test('setCommittees: 空配列・壊れた応答ではマージもせず、いまのマスタ（既定9件）をそのまま保つ', () => {
  S.setCommittees(S.COMMITTEE_DEFAULTS);
  const before = S.committees();
  assert.equal(before.length, 9);
  assert.equal(S.setCommittees([]), 0);
  assert.equal(S.setCommittees(null), 0);
  assert.equal(S.setCommittees(undefined), 0);
  assert.equal(S.setCommittees('ではない'), 0);
  assert.equal(S.setCommittees({ 0: { code: 'abuse' } }), 0);
  assert.equal(S.setCommittees([null, 'ではない', { label: 'コードなし' }]), 0);
  assert.deepEqual(S.committees(), before);
  assert.deepEqual(S.committees().map((c) => c.code), S.COMMITTEE_DEFAULTS.map((c) => c.code));
  assert.equal(S.committees().length, 9);
});

/* ══════════════════════════════════════════════════════════════════════════
   2026-09-22.2 公開前レビューで挙がった実害の回帰テスト（算出モジュール側）。
   架空データのみ（テスト職員・架空コード zz*）。
   ══════════════════════════════════════════════════════════════════════════ */

/* サーバー応答を1度も受け取っていない「起動直後」の算出モジュールを作る。
   require のキャッシュを外して読み直す＝COMMITTEES が初期値のままの実体が手に入る。
   ★他のテストが見ている実体（S）は元に戻してから返す。 */
function freshCalc() {
  const p = require.resolve(path.join(__dirname, '..', '..', 'staff-master-calc.js'));
  const keep = require.cache[p];
  delete require.cache[p];
  const mod = require(p);
  delete require.cache[p];
  require.cache[p] = keep;
  return mod;
}

const CALC_KEYS = ['code', 'label', 'alias', 'kind', 'sites', 'freq', 'basis', 'penalty',
                   'hasPenalty', 'purpose', 'training', 'drill', 'note', 'todo', 'inactive',
                   'url', 'todoNote',                       /* 2026-09-22.5 で追加 */
                   'startedAt', 'siteStartedAt'];           /* 2026-09-23.2 で追加 */

test('レビュー3: 起動直後の committees() が setCommittees 後とそろった形を返す', () => {
  const F = freshCalc();
  const before = F.committees();
  assert.equal(before.length, 9);
  before.forEach((c) => {
    assert.deepEqual(Object.keys(c).sort(), CALC_KEYS.slice().sort(), c.code);
    ['label', 'alias', 'freq', 'basis', 'penalty', 'purpose', 'training', 'drill', 'note', 'url', 'todoNote',
     'startedAt', 'siteStartedAt']
      .forEach((k) => assert.equal(typeof c[k], 'string', c.code + '.' + k));
    ['hasPenalty', 'todo', 'inactive']
      .forEach((k) => assert.equal(typeof c[k], 'boolean', c.code + '.' + k));
    assert.ok(Array.isArray(c.sites), c.code + '.sites');
  });
  /* ★不揃いだった実例（未正規化の実体をそのまま返していた退行）。旧: undefined */
  assert.equal(F.committeeOf('abuse').drill, '');
  assert.equal(F.committeeOf('kondan').alias, '');
  assert.equal(F.committeeOf('safety').drill, '');
  assert.equal(F.committeeOf('safety').training, '');
  assert.equal(F.committeeOf('restraint').drill, '');
  assert.equal(F.committeeOf('hygiene').training, '');
  /* ★同じ公開APIが状況で別の形を返さない＝setCommittees を通しても1文字も変わらない */
  F.setCommittees(F.COMMITTEE_DEFAULTS);
  assert.equal(JSON.stringify(F.committees()), JSON.stringify(before));
});

test('レビュー3: 起動直後の committees() が COMMITTEE_DEFAULTS と実体・sites を共有しない', () => {
  const F = freshCalc();
  const d = F.COMMITTEE_DEFAULTS.find((c) => c.code === 'abuse');
  const c = F.committeeOf('abuse');
  assert.notEqual(c, d);                                     /* 行の実体が別 */
  assert.notEqual(c.sites, d.sites);                         /* ★sites 配列の参照も別 */
  assert.deepEqual(c.sites, d.sites);                        /* 値は同じ */
  /* 呼び手が返り値の sites をいじっても、既定の正本は崩れない（fromDefault の★の約束）。
     ※ committees() は従来どおり浅い写し＝行の実体は COMMITTEES と共有する（ここは変えていない） */
  const got = F.committees();
  got[0].sites.push('cm');
  assert.deepEqual(F.COMMITTEE_DEFAULTS[0].sites, ['facility', 'visit', 'day']);
  assert.deepEqual(F.COMMITTEE_DEFAULTS.find((x) => x.code === 'abuse').sites, ['facility', 'visit', 'day']);
});

test('レビュー2: 委員会でない体制に委員長が入っていたら注意を出す（隠さない・消さない）', () => {
  const W = '委員会ではないので委員長・委員は置けません（担当者に直してください）';
  const A = '2026-09-22';
  const rows = [{
    id: 'K1', name: 'テスト職員K', kana: 'テスト ショクインK', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '介護', committeesJson: [{ code: 'hygiene', role: 'chair' }, { code: 'bcp', role: 'chair' }]
  }];
  const st = S.committeeStats(rows, A);
  const hyg = st.find((x) => x.code === 'hygiene');
  const bcp = st.find((x) => x.code === 'bcp');
  assert.notEqual(hyg.warn.indexOf(W), -1, hyg.warn.join('｜'));   /* 選任 */
  assert.notEqual(bcp.warn.indexOf(W), -1, bcp.warn.join('｜'));   /* 計画と訓練 */

  /* ★入っている委員長を隠しも消しもしない（隠すと画面からその人を外せなくなる） */
  assert.equal(hyg.chair, 1);
  assert.equal(hyg.total, 1);
  assert.equal(bcp.chair, 1);
  const mem = S.committeeMembers(rows, 'hygiene', A);
  assert.equal(mem.length, 1);
  assert.equal(mem[0].role, 'chair');
  assert.equal(mem[0].row.id, 'K1');

  /* 委員会（kind: committee）には出さない＝委員長は正しい役割 */
  const rows2 = [{
    id: 'K2', name: 'テスト職員L', kana: 'テスト ショクインL', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '介護', committeesJson: [{ code: 'abuse', role: 'chair' }]
  }];
  S.committeeStats(rows2, A).forEach((c) => assert.equal(c.warn.indexOf(W), -1, c.code));
  /* 担当者だけなら出ない（担当者は置ける役割） */
  const rows3 = [{
    id: 'K3', name: 'テスト職員M', kana: 'テスト ショクインM', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '介護', committeesJson: [{ code: 'hygiene', role: 'officer' }, { code: 'bcp', role: 'officer' }]
  }];
  S.committeeStats(rows3, A).forEach((c) => assert.equal(c.warn.indexOf(W), -1, c.code));
  /* 誰も入っていない時も出ない（空を責めない） */
  S.committeeStats([], A).forEach((c) => assert.equal(c.warn.indexOf(W), -1, c.code));
  /* 既存の注意は従来どおり（出し分けを壊していない） */
  assert.notEqual(bcp.warn.indexOf('担当者が決まっていません（減算の要件です）'), -1);
  assert.equal(bcp.warn.indexOf('委員長が決まっていません'), -1);
  assert.equal(hyg.warn.indexOf('委員が1人もいません'), -1);
  assert.notEqual(hyg.warn.indexOf('要確認（法令上の扱いを確かめてください）'), -1);
});

test('レビュー6: committeeStats の行に減算の有無（hasPenalty）を載せる', () => {
  const A = '2026-09-22';
  const st = S.committeeStats([], A);
  st.forEach((c) => assert.equal(typeof c.hasPenalty, 'boolean', c.code));
  /* 減算のある2件（既定のとおり。身体的拘束は 2026-09-23.6 から減算なし） */
  ['abuse', 'bcp'].forEach((c) =>
    assert.equal(st.find((x) => x.code === c).hasPenalty, true, c));
  /* 残り6件は減算なし。safety は「令和9年4月1日から義務」であって減算ではない */
  ['restraint', 'infection', 'safety', 'kondan', 'dementia', 'disaster', 'hygiene'].forEach((c) =>
    assert.equal(st.find((x) => x.code === c).hasPenalty, false, c));
  /* 既存の警告の判定条件は変えていない＝hasPenalty が true で担当者0なら減算の注意が出る */
  st.forEach((c) => {
    const has = c.warn.indexOf('担当者が決まっていません（減算の要件です）') >= 0;
    assert.equal(has, c.hasPenalty === true && c.officer === 0 && !c.inactive, c.code);
  });

  /* 人が足した委員会の減算フラグも載る（サーバーが落としていた分・レビュー6） */
  const back = S.committees();
  try {
    S.setCommittees(S.COMMITTEE_DEFAULTS.concat([{
      code: 'zz9', label: 'テスト独自委員会', kind: 'committee', sites: ['day'], freq: '年2回',
      basis: 'テストの根拠', penalty: 'テストの減算', hasPenalty: true, purpose: '減算を避けるため',
      note: '', inactive: false
    }]));
    const z = S.committeeStats([], A).find((x) => x.code === 'zz9');
    assert.equal(z.hasPenalty, true);
    assert.notEqual(z.warn.indexOf('担当者が決まっていません（減算の要件です）'), -1, z.warn.join('｜'));
  } finally {
    S.setCommittees(back);
  }
  assert.equal(S.committeeOf('zz9'), null);                  /* 後始末（幽霊を残さない） */
  assert.equal(S.committeeStats([], A).length, 9);
});

test('レビュー2（(b) 裁定）: 委員会でない体制に「委員」が入っていても注意を出す', () => {
  const W = '委員会ではないので委員長・委員は置けません（担当者に直してください）';
  const A = '2026-09-22';
  /* 委員長は居ない・委員だけが入っている状態（第1版の画面が作れてしまう） */
  const rows = [{
    id: 'M1', name: 'テスト職員N', kana: 'テスト ショクインN', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '介護',
    committeesJson: [{ code: 'hygiene', role: 'member' }, { code: 'disaster', role: 'member' },
                     { code: 'bcp', role: 'member' }]
  }];
  const st = S.committeeStats(rows, A);
  ['hygiene', 'disaster', 'bcp'].forEach((c) => {
    const row = st.find((x) => x.code === c);
    assert.notEqual(row.warn.indexOf(W), -1, c + ': ' + row.warn.join('｜'));
    assert.equal(row.chair, 0, c);
    assert.equal(row.member, 1, c);                 /* ★数えるだけ＝隠しも消しもしない */
    assert.equal(row.total, 1, c);
  });
  /* 同じ1文で済ませる＝委員長でも委員でも2件に増やさない */
  assert.equal(st.find((x) => x.code === 'disaster').warn.filter((w) => w === W).length, 1);
  /* 委員長と委員が両方入っていても1件 */
  const both = [{
    id: 'M2', name: 'テスト職員O', kana: 'テスト ショクインO', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '介護', committeesJson: [{ code: 'disaster', role: 'chair' }]
  }, {
    id: 'M3', name: 'テスト職員P', kana: 'テスト ショクインP', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '看護', committeesJson: [{ code: 'disaster', role: 'member' }]
  }];
  const d2 = S.committeeStats(both, A).find((x) => x.code === 'disaster');
  assert.deepEqual(d2.warn, [W]);
  assert.equal(d2.chair, 1);
  assert.equal(d2.member, 1);
  assert.equal(S.committeeMembers(both, 'disaster', A).length, 2);   /* 構成員は1人も消えない */

  /* 委員会（kind: committee）には従来どおり出ない＝委員は正しい役割 */
  const cm = [{
    id: 'M4', name: 'テスト職員Q', kana: 'テスト ショクインQ', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '介護',
    committeesJson: [{ code: 'abuse', role: 'member' }, { code: 'infection', role: 'member' },
                     { code: 'kondan', role: 'chair' }]
  }];
  S.committeeStats(cm, A).forEach((c) => {
    if (c.kind === 'committee') assert.equal(c.warn.indexOf(W), -1, c.code);
  });
  /* 担当者だけなら出ない（委員会でない体制に置ける唯一の役割） */
  const off = [{
    id: 'M5', name: 'テスト職員R', kana: 'テスト ショクインR', hireDate: '2019-04-01', retireDate: '',
    jobTitle: '事務',
    committeesJson: [{ code: 'hygiene', role: 'officer' }, { code: 'disaster', role: 'officer' },
                     { code: 'bcp', role: 'officer' }]
  }];
  S.committeeStats(off, A).forEach((c) => assert.equal(c.warn.indexOf(W), -1, c.code));
  /* 対象外（inactive）の行には従来どおり注意を出さない */
  const back = S.committees();
  try {
    const list = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
      c.code === 'disaster' ? { inactive: true } : {}));
    S.setCommittees(list);
    assert.equal(S.committeeStats(rows, A).find((x) => x.code === 'disaster').warn.indexOf(W), -1);
  } finally {
    S.setCommittees(back);
  }
});

test('レビュー4（(d) 裁定）: 第1版のサーバー応答で根拠を書き換えられても紙には既定が出る', () => {
  const back = S.committees();
  try {
    /* 第1版のサーバー（basis・penalty を素通しする）が返してくる9件を模す。
       ★紙に刷られる根拠は committees() から出るので、ここで既定に引き直せないと
         書き換えられた根拠がそのまま実地指導の紙に乗る。 */
    const v1 = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, {
      basis: 'テストで書き換えた根拠',
      penalty: 'テストで書き換えた減算の文面'
    }));
    v1[0].label = '虐待防止委員会（合同）';          /* 名前の書き換えは残る */
    v1[0].freq = '毎月';                            /* 頻度も残る */
    v1[0].note = 'テストの注記';                     /* 注記も残る */
    v1[0].sites = ['facility'];                     /* 対象事業所を書き換えて送る（2026-09-23.4 から既定へ戻る） */
    assert.equal(S.setCommittees(v1), 9);

    /* ★既定にある9件は根拠も減算の文面も既定のまま */
    assert.equal(S.committeeOf('abuse').basis,
      '居宅基準 第37条の2（訪問）／第105条で準用（通所）／熊本市有料老人ホーム設置運営指導指針');
    assert.equal(S.committeeOf('abuse').penalty,
      '高齢者虐待防止措置未実施減算（利用者全員1%・発見月から3か月は必ず減算）');
    assert.equal(S.committeeOf('infection').penalty, '');          /* 空が正の行は空のまま */
    assert.equal(S.committeeOf('bcp').basis,
      '令和3年度改正（令和6年4月1日から義務）／業務継続計画未策定減算');
    S.COMMITTEE_DEFAULTS.forEach((d) => {
      assert.equal(S.committeeOf(d.code).basis, String(d.basis == null ? '' : d.basis).trim(), d.code);
      assert.equal(S.committeeOf(d.code).penalty, String(d.penalty == null ? '' : d.penalty).trim(), d.code);
    });
    /* 集計の行（紙のもと）にも書き換えは出ない */
    const st = S.committeeStats([], '2026-09-22');
    assert.equal(st.filter((c) => /テストで書き換えた/.test(c.basis + c.penalty)).length, 0);
    /* ★根拠が空で減算だけ立っている行を作れない（紙の事故の本体） */
    assert.equal(st.filter((c) => c.hasPenalty === true && !String(c.basis || '').trim()).length, 0);

    /* 書き換え可の項目は従来どおり残る */
    assert.equal(S.committeeOf('abuse').label, '虐待防止委員会（合同）');
    assert.equal(S.committeeOf('abuse').freq, '毎月');
    assert.equal(S.committeeOf('abuse').note, 'テストの注記');
    assert.deepEqual(S.committeeOf('abuse').sites, ['facility', 'visit', 'day']);   /* ★既定が正（条文で決まる） */

    /* 既定に無い体制（人が足した分）は従来どおり自分の根拠・文面を持てる */
    S.setCommittees(S.COMMITTEE_DEFAULTS.concat([{
      code: 'zz8', label: 'テスト独自体制', kind: 'committee', sites: ['day'], freq: '年2回',
      basis: 'テストの根拠', penalty: 'テストの減算', hasPenalty: true, note: '', inactive: false
    }]));
    assert.equal(S.committeeOf('zz8').basis, 'テストの根拠');
    assert.equal(S.committeeOf('zz8').penalty, 'テストの減算');
    assert.equal(S.committeeOf('abuse').basis,
      '居宅基準 第37条の2（訪問）／第105条で準用（通所）／熊本市有料老人ホーム設置運営指導指針');
  } finally {
    S.setCommittees(back);
  }
  assert.equal(S.committeeOf('zz8'), null);
  assert.equal(S.committees().length, 9);
});

test('レビュー4（(d) 裁定）: サーバーと算出モジュールが既定を正とする項目がそろっている', () => {
  /* サーバー（normCommittees_）と算出モジュール（setCommittees）が既定から引き直す9項目。
     どちらか片方だけ増えると、画面とサーバーで紙の中身が食い違う。 */
  const DEF_WINS = ['kind', 'alias', 'purpose', 'training', 'drill', 'hasPenalty', 'todo', 'basis', 'penalty',
                    'todoNote',                           /* 2026-09-22.5: 確認事項も制度の説明 */
                    'sites'];                             /* 2026-09-23.4: 対象事業所は条文で決まる */
  const EDITABLE = ['label', 'freq', 'note', 'url'];    /* 2026-09-22.5: url は書き換え可 */
  const back = S.committees();
  try {
    const tampered = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, {
      kind: 'committee', alias: 'テスト通称', purpose: 'テスト目的', training: 'テスト研修',
      drill: 'テスト訓練', hasPenalty: true, todo: true,
      basis: 'テスト根拠', penalty: 'テスト減算', todoNote: 'テスト確認事項', sites: ['cm']
    }));
    S.setCommittees(tampered);
    S.COMMITTEE_DEFAULTS.forEach((d) => {
      const got = S.committeeOf(d.code);
      DEF_WINS.forEach((k) => {
        if (k === 'sites') { assert.deepEqual(got.sites, d.sites, d.code + '.sites は既定が正'); return; }
        const want = (k === 'hasPenalty' || k === 'todo') ? (d[k] === true)
          : String(d[k] == null ? '' : d[k]).trim();
        assert.equal(got[k], want, d.code + '.' + k + ' は既定が正');
      });
    });
  } finally {
    S.setCommittees(back);
  }
  /* 書き換え可の4項目は引き直さない（名前の変更は検収項目）。対象事業所は 2026-09-23.4 から既定が正 */
  const back2 = S.committees();
  try {
    const edited = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, {
      label: c.label + '（改）', freq: 'テスト頻度', note: 'テスト注記', sites: ['facility'],
      url: 'https://example.invalid/ours'
    }));
    S.setCommittees(edited);
    S.COMMITTEE_DEFAULTS.forEach((d) => {
      const got = S.committeeOf(d.code);
      assert.equal(got.label, d.label + '（改）', d.code + '.label');
      assert.equal(got.freq, 'テスト頻度', d.code + '.freq');
      assert.equal(got.note, 'テスト注記', d.code + '.note');
      assert.deepEqual(got.sites, d.sites, d.code + '.sites は送っても既定のまま');
      assert.equal(got.url, 'https://example.invalid/ours', d.code + '.url');
    });
    assert.equal(EDITABLE.length, 4);
  } finally {
    S.setCommittees(back2);
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   2026-09-22.5（A〜D）— 要件を確認できるページ・制度の記述の訂正・要確認と確認事項
   ══════════════════════════════════════════════════════════════════════════ */
const URL_WANT = {
  abuse: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_37_2',
  restraint: 'https://www.city.kumamoto.jp/kiji0032329/index.html',
  infection: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_104',
  safety: '',
  kondan: 'https://www.city.kumamoto.jp/kiji0032329/index.html',
  dementia: 'https://www.mhlw.go.jp/web/t_doc?dataId=82ab4584&dataType=0&pageNo=1',
  bcp: 'https://laws.e-gov.go.jp/law/411M50000100037#Mp-At_30_2',
  disaster: 'https://laws.e-gov.go.jp/law/336M50000008006#Mp-At_3',
  hygiene: 'https://laws.e-gov.go.jp/law/347AC0000000057#Mp-At_12_2'
};
const TODONOTE_SAFETY = '訪問介護・通所介護・住宅型有料老人ホームが対象に含まれるかを熊本市に確認してください（令和9年度改定で対象が変わる可能性があります）';
const TODONOTE_HYGIENE = '3事業所がそれぞれ別の事業場に当たるかを労働基準監督署に確認してください（同じ場所なら1事業場、場所が分かれていれば原則別事業場）';

test('A: 既定9件の url がサーバーの既定と同じ値（1字一句）', () => {
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });
  Object.keys(URL_WANT).forEach((code) => assert.equal(by[code].url, URL_WANT[code], code));
  /* 生産性向上委員会だけ空（対象サービスが確認中のため既定を置かない） */
  assert.equal(by.safety.url, '');
  /* http/https 以外は1件も無い */
  S.COMMITTEE_DEFAULTS.forEach((c) => {
    if (c.url) assert.match(c.url, /^https?:\/\//, c.code);
  });
});

test('A: url は書き換え可（setCommittees で保存値が残る・既定へ引き戻さない）', () => {
  const back = S.committees();
  try {
    const edited = S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
      c.code === 'abuse' ? { url: 'https://example.invalid/ours' } : {}));
    S.setCommittees(edited);
    assert.equal(S.committeeOf('abuse').url, 'https://example.invalid/ours');
    assert.equal(S.committeeOf('kondan').url, URL_WANT.kondan);
    /* 空にもできる */
    S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
      c.code === 'abuse' ? { url: '' } : {})));
    assert.equal(S.committeeOf('abuse').url, '');
  } finally {
    S.setCommittees(back);
  }
});

test('A: 危ない scheme の url は落として空にする（画面がリンクにするため）', () => {
  const back = S.committees();
  try {
    ['javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)', '//example.invalid/x',
     'example.invalid', 'https://' + new Array(400).join('a')].forEach((bad) => {
      S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
        c.code === 'abuse' ? { url: bad } : {})));
      assert.equal(S.committeeOf('abuse').url, '', bad.slice(0, 20));
    });
    /* 通してよい形 */
    ['https://example.invalid/a', 'http://example.invalid/a', 'HTTPS://EXAMPLE.INVALID/A'].forEach((good) => {
      S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
        c.code === 'abuse' ? { url: good } : {})));
      assert.equal(S.committeeOf('abuse').url, good, good);
    });
  } finally {
    S.setCommittees(back);
  }
});

test('B: 根拠の訂正（4件）と、古い値を送っても新しい値に戻ること', () => {
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });
  assert.equal(by.abuse.basis, '居宅基準 第37条の2（訪問）／第105条で準用（通所）／熊本市有料老人ホーム設置運営指導指針');
  assert.equal(by.restraint.basis, '同指導指針');                 /* 2026-09-23.6 施設だけ＝熊本市の指導指針 */
  assert.equal(by.infection.basis, '居宅基準 第31条3項（訪問）／第104条2項（通所）／同指導指針');
  assert.equal(by.kondan.basis, '同指導指針');
  /* 指導指針は条例ではないので条番号を持たない／第104条の2 は虐待防止ではない */
  assert.equal(S.COMMITTEE_DEFAULTS.filter((c) => /指導指針 第\d+条/.test(c.basis)).length, 0);
  assert.equal(S.COMMITTEE_DEFAULTS.filter((c) => /第104条の2/.test(c.basis)).length, 0);

  const back = S.committees();
  try {
    const old = {
      abuse: '居宅基準 第37条の2（訪問）／第104条の2（通所）／熊本市有料老人ホーム設置運営指導指針 第12条',
      restraint: '居宅基準／同指導指針 第13条',
      infection: '居宅基準 第31条2項（訪問）／第104条2項（通所）／同指導指針 第11条',
      kondan: '同指導指針 第10条'
    };
    S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) =>
      Object.assign({}, c, old[c.code] ? { basis: old[c.code] } : {})));
    Object.keys(old).forEach((code) => assert.equal(S.committeeOf(code).basis, by[code].basis, code));
    /* 集計（画面と紙が見るところ）にも古い値が出ない */
    assert.equal(S.committeeStats([], KIND_ASOF).filter((c) => /第104条の2|指導指針 第\d+条/.test(c.basis)).length, 0);
  } finally {
    S.setCommittees(back);
  }
});

test('C: 生産性向上委員会に「要確認」が立つ（行は消さない・対象外にもしない）', () => {
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });
  assert.equal(by.safety.todo, true);
  assert.equal(by.safety.inactive, false);
  assert.deepEqual(S.COMMITTEE_DEFAULTS.filter((c) => c.todo === true).map((c) => c.code), ['safety', 'hygiene']);
  /* 集計にも出る＝画面の「要確認」バッジと注意の文言が出る */
  const st = S.committeeStats([], KIND_ASOF);
  assert.equal(st.find((x) => x.code === 'safety').todo, true);
  assert.notEqual(st.find((x) => x.code === 'safety').warn.indexOf('要確認（法令上の扱いを確かめてください）'), -1);
});

test('D: todoNote は要確認の2件だけに入り、画面から書き換えられない', () => {
  const by = {};
  S.COMMITTEE_DEFAULTS.forEach((c) => { by[c.code] = c; });
  assert.equal(by.safety.todoNote, TODONOTE_SAFETY);
  assert.equal(by.hygiene.todoNote, TODONOTE_HYGIENE);
  assert.deepEqual(S.COMMITTEE_DEFAULTS.filter((c) => c.todoNote).map((c) => c.code), ['safety', 'hygiene']);
  S.COMMITTEE_DEFAULTS.forEach((c) => assert.equal(typeof c.todoNote, 'string', c.code));

  const back = S.committees();
  try {
    S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, { todoNote: 'テストで書き換えた', todo: false })));
    assert.equal(S.committeeOf('safety').todoNote, TODONOTE_SAFETY);
    assert.equal(S.committeeOf('hygiene').todoNote, TODONOTE_HYGIENE);
    assert.equal(S.committeeOf('abuse').todoNote, '');
    assert.equal(S.committeeOf('safety').todo, true);
  } finally {
    S.setCommittees(back);
  }
});

test('D: committeeStats の各行に url と todoNote を載せる（画面はここを見る）', () => {
  const st = S.committeeStats(KIND_ROWS, KIND_ASOF);
  assert.equal(st.length, 9);
  st.forEach((c) => {
    assert.equal(typeof c.url, 'string', c.code);
    assert.equal(typeof c.todoNote, 'string', c.code);
  });
  assert.equal(st.find((x) => x.code === 'hygiene').url, URL_WANT.hygiene);
  assert.equal(st.find((x) => x.code === 'hygiene').todoNote, TODONOTE_HYGIENE);
  assert.equal(st.find((x) => x.code === 'safety').todoNote, TODONOTE_SAFETY);
  assert.equal(st.find((x) => x.code === 'safety').url, '');
  /* 要確認でない行には確認事項を出さない */
  assert.equal(st.filter((x) => x.todo !== true && x.todoNote).length, 0);
});

test('A・D: 古い保存値（url・todoNote を持たない）を読んでも確認事項は戻る', () => {
  const back = S.committees();
  try {
    const legacy = S.COMMITTEE_DEFAULTS.map((c) => {
      const o = Object.assign({}, c);
      delete o.url; delete o.todoNote; delete o.todo;
      return o;
    });
    S.setCommittees(legacy);
    assert.equal(S.committeeOf('safety').todoNote, TODONOTE_SAFETY);
    assert.equal(S.committeeOf('safety').todo, true);
    /* ★2026-09-22.5 実機で契約を修正。url のキーが【無い】記録は「未設定」なので既定を配る */
    assert.equal(S.committeeOf('abuse').url, URL_WANT.abuse);
  } finally {
    S.setCommittees(back);
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   2026-09-22.5 実機で落ちた穴の回帰テスト（算出モジュール側）
   「既存の事業所では URL が全件空のまま」
   ★契約: url のキーが【無い】＝一度も設定されていない → 既定のURLを出す
           キーがあって空文字＝人が意図して消した       → 空のまま（復活させない）
   ★normUrl(it.url) だけで書くと undefined が '' に潰れて区別できなくなる。
   ★画面が第1版のサーバー（url を知らない）に繋がった時にも既定が出るよう、ここにも同じ約束を持つ。
   ══════════════════════════════════════════════════════════════════════════ */
function dropKey(list, key) {
  return list.map((c) => {
    const o = {};
    Object.keys(c).forEach((k) => { if (k !== key) o[k] = c[k]; });
    return o;
  });
}

test('実機: url キーを持たない記録を読むと既定のURLが出る（9件すべて）', () => {
  const back = S.committees();
  try {
    const legacy = dropKey(S.COMMITTEE_DEFAULTS, 'url');
    assert.equal(legacy.filter((c) => Object.prototype.hasOwnProperty.call(c, 'url')).length, 0);
    assert.equal(S.setCommittees(legacy), 9);
    Object.keys(URL_WANT).forEach((code) => {
      assert.equal(S.committeeOf(code).url, URL_WANT[code], code);
    });
    /* 集計（画面が見るところ）にも届く */
    const st = S.committeeStats([], KIND_ASOF);
    Object.keys(URL_WANT).forEach((code) => {
      assert.equal(st.find((x) => x.code === code).url, URL_WANT[code], code);
    });
    /* 既定が空の生産性向上委員会は空のまま */
    assert.equal(S.committeeOf('safety').url, '');
  } finally {
    S.setCommittees(back);
  }
});

test('実機: url が空文字の記録は空のまま（人が消したものを既定で復活させない）', () => {
  const back = S.committees();
  try {
    S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, { url: '' })));
    S.COMMITTEE_DEFAULTS.forEach((d) => assert.equal(S.committeeOf(d.code).url, '', d.code));
  } finally {
    S.setCommittees(back);
  }
});

test('実機: url が入っている記録はその値のまま', () => {
  const back = S.committees();
  try {
    S.setCommittees(S.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, { url: 'https://example.invalid/' + c.code })));
    S.COMMITTEE_DEFAULTS.forEach((d) =>
      assert.equal(S.committeeOf(d.code).url, 'https://example.invalid/' + d.code, d.code));
  } finally {
    S.setCommittees(back);
  }
});

test('実機: 一部だけ url がある記録（版をまたいで書き足された状態）', () => {
  const back = S.committees();
  try {
    const mixed = dropKey(S.COMMITTEE_DEFAULTS, 'url');
    mixed.find((c) => c.code === 'abuse').url = 'https://example.invalid/ours';   /* 人が入れた */
    mixed.find((c) => c.code === 'kondan').url = '';                              /* 人が消した */
    S.setCommittees(mixed);
    assert.equal(S.committeeOf('abuse').url, 'https://example.invalid/ours');
    assert.equal(S.committeeOf('kondan').url, '');
    ['restraint', 'infection', 'safety', 'dementia', 'bcp', 'disaster', 'hygiene'].forEach((code) => {
      assert.equal(S.committeeOf(code).url, URL_WANT[code], code);                /* キーが無い＝既定 */
    });
  } finally {
    S.setCommittees(back);
  }
});

test('実機: 第1版のサーバー応答（url を1件も持たない）でも画面に既定のURLが出る', () => {
  const back = S.committees();
  try {
    /* 第1版のサーバーは6件しか返さず、url も todoNote も知らない */
    const v1 = dropKey(S.COMMITTEE_DEFAULTS.slice(0, 6), 'url').map((c) => {
      const o = Object.assign({}, c);
      delete o.todoNote; delete o.todo; delete o.kind; delete o.alias;
      delete o.purpose; delete o.training; delete o.drill; delete o.hasPenalty;
      return o;
    });
    assert.equal(S.setCommittees(v1), 9);              /* 既定の増分3件は末尾に補われる */
    ['abuse', 'restraint', 'infection', 'kondan', 'dementia'].forEach((code) => {
      assert.equal(S.committeeOf(code).url, URL_WANT[code], code);
    });
    /* 既定から補った3件も既定のURLを持つ */
    ['bcp', 'disaster', 'hygiene'].forEach((code) => {
      assert.equal(S.committeeOf(code).url, URL_WANT[code], code);
    });
    assert.equal(S.committeeOf('safety').todoNote, TODONOTE_SAFETY);
  } finally {
    S.setCommittees(back);
  }
});

test('実機: 起動直後（サーバー応答の前）も既定のURLを持つ', () => {
  const F = freshCalc();
  Object.keys(URL_WANT).forEach((code) => assert.equal(F.committeeOf(code).url, URL_WANT[code], code));
  /* 既定をそのまま通しても1文字も変わらない */
  const before = F.committees();
  F.setCommittees(F.COMMITTEE_DEFAULTS);
  assert.equal(JSON.stringify(F.committees()), JSON.stringify(before));
});

/* ══════════════════════════════════════════════════════════════════════════
   2026-09-23.2 いつから（startedAt / siteStartedAt）— 算出モジュール側
   ・startedAt      制度の対象開始月。basis・penalty と同じ「既定から引き直す」側
   ・siteStartedAt  当事業所が実際に始めた月。url と同じ「書き換えられる」側（既定は全件空）
   ══════════════════════════════════════════════════════════════════════════ */

/* ★本人が e-Gov 法令検索の条文・附則を直接読んで確定した正本。1字一句を突き合わせる。
   サーバー（staff-api.gs の COMMITTEE_DEFAULTS）との機械照合は staff_committee_gas_test.js の
   「検収4」が全項目で行う。ここは算出モジュール単体で読める形の控え。 */
const STARTED_WANT = {
  abuse: '2024年4月から完全義務・減算／2021年4月（令和3年4月）に義務化・経過措置は2024年3月まで。有料老人ホームは熊本市指針が根拠で時期は確認できず',
  restraint: '訪問介護・通所介護は委員会の定めなし（原則禁止と記録の義務のみ）／有料老人ホームは熊本市指針が根拠で時期は確認できず',
  infection: '2024年4月から完全義務／2021年4月（令和3年4月）に義務化・経過措置は2024年3月まで。専用の減算は確認できず',
  safety: '訪問介護・通所介護は規定なし（居宅基準 第139条の2 は短期入所生活介護の条文）／対象となる種別は2024年4月・経過措置は2027年3月まで',
  kondan: '確認できず（熊本市有料老人ホーム設置運営指導指針）',
  dementia: '2024年4月（令和6年度改定）に通所介護 認知症加算の要件へ加わった',
  bcp: '2024年4月から完全義務／2021年4月（令和3年4月）に策定義務・経過措置は2024年3月まで。減算は訪問介護が2025年4月から。通所介護の減算開始は要確認',
  disaster: '通所介護は2000年4月（基準制定当初）から／訪問介護は居宅基準に条文なし（消防法は別の体系）',
  hygiene: '1989年4月（平成元年4月）労働安全衛生法 第12条の2 の新設'
};

test('いつから: 起動直後（サーバー応答の前）に既定の startedAt を9件とも持つ', () => {
  const F = freshCalc();
  Object.keys(STARTED_WANT).forEach((code) => {
    assert.equal(F.committeeOf(code).startedAt, STARTED_WANT[code], code);
  });
  assert.equal(F.committees().length, 9);
  /* 一次資料で特定できなかったものを、それらしい日付で埋めていない */
  assert.match(F.committeeOf('kondan').startedAt, /確認できず/);
  assert.match(F.committeeOf('restraint').startedAt, /定めなし/);
  assert.match(F.committeeOf('safety').startedAt, /規定なし/);
  assert.match(F.committeeOf('bcp').startedAt, /通所介護の減算開始は要確認/);
});

test('いつから: 既定の siteStartedAt は全件空', () => {
  const F = freshCalc();
  F.committees().forEach((c) => assert.equal(c.siteStartedAt, '', c.code));
});

test('いつから: startedAt はサーバーが違う値を返しても既定に戻る（basis と同じ扱い）', () => {
  const F = freshCalc();
  const tampered = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c, { startedAt: '2099年1月（でたらめ）' }));
  assert.equal(F.setCommittees(tampered), 9);
  Object.keys(STARTED_WANT).forEach((code) => {
    assert.equal(F.committeeOf(code).startedAt, STARTED_WANT[code], code);
  });
});

test('いつから: startedAt を持たない古いマスタを読んでも既定が戻る', () => {
  const F = freshCalc();
  const legacy = F.COMMITTEE_DEFAULTS.map((c) => {
    const o = Object.assign({}, c); delete o.startedAt; return o;
  });
  assert.equal(legacy.filter((c) => Object.prototype.hasOwnProperty.call(c, 'startedAt')).length, 0);
  assert.equal(F.setCommittees(legacy), 9);
  Object.keys(STARTED_WANT).forEach((code) => {
    assert.equal(F.committeeOf(code).startedAt, STARTED_WANT[code], code);
  });
});

test('いつから: 人が足した委員会の startedAt はそのまま（引ける既定が無い）', () => {
  const F = freshCalc();
  assert.ok(F.setCommittees([{ code: 'zz9', label: 'テスト独自委員会', sites: ['day'], startedAt: '2019年4月' }]) > 0);
  assert.equal(F.committeeOf('zz9').startedAt, '2019年4月');
});

test('いつから: siteStartedAt は書き換えられる（url と同じ側）', () => {
  const F = freshCalc();
  const mine = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
    (c.code === 'abuse') ? { siteStartedAt: '2024年4月' } : {}));
  assert.equal(F.setCommittees(mine), 9);
  assert.equal(F.committeeOf('abuse').siteStartedAt, '2024年4月');
  ['restraint', 'infection', 'safety', 'kondan', 'dementia', 'bcp', 'disaster', 'hygiene']
    .forEach((code) => assert.equal(F.committeeOf(code).siteStartedAt, '', code));
  /* 空にできる */
  const cleared = F.committees().map((c) => Object.assign({}, c, { siteStartedAt: '' }));
  assert.equal(F.setCommittees(cleared), 9);
  assert.equal(F.committeeOf('abuse').siteStartedAt, '');
});

test('いつから: siteStartedAt は書式を縛らない・40字で切る', () => {
  const F = freshCalc();
  const forms = ['2024年4月', 'R6.4', '令和6年4月ごろ', '2024-04', '開設時から'];
  forms.forEach((v) => {
    const m = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
      (c.code === 'abuse') ? { siteStartedAt: v } : {}));
    F.setCommittees(m);
    assert.equal(F.committeeOf('abuse').siteStartedAt, v);
  });
  const long = new Array(60).join('あ');
  const m = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
    (c.code === 'abuse') ? { siteStartedAt: long } : {}));
  F.setCommittees(m);
  assert.equal(F.committeeOf('abuse').siteStartedAt.length, 40);
  /* 前後の空白・改行は落とす */
  const m2 = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
    (c.code === 'abuse') ? { siteStartedAt: '  2024年4月 \n' } : {}));
  F.setCommittees(m2);
  assert.equal(F.committeeOf('abuse').siteStartedAt, '2024年4月');
});

test('いつから: siteStartedAt のキーが無いマスタを読んでも落ちない（古い画面との互換）', () => {
  const F = freshCalc();
  const legacy = F.COMMITTEE_DEFAULTS.map((c) => {
    const o = Object.assign({}, c); delete o.siteStartedAt; return o;
  });
  assert.equal(legacy.filter((c) => Object.prototype.hasOwnProperty.call(c, 'siteStartedAt')).length, 0);
  assert.equal(F.setCommittees(legacy), 9);
  F.committees().forEach((c) => assert.equal(c.siteStartedAt, '', c.code));
  /* 読み出した形をそのまま戻しても値が育たない */
  const back = F.committees();
  F.setCommittees(back);
  assert.equal(JSON.stringify(F.committees()), JSON.stringify(back));
});

test('いつから: committeeStats が startedAt と siteStartedAt を返す（画面と紙はここから出る）', () => {
  const F = freshCalc();
  const mine = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
    (c.code === 'bcp') ? { siteStartedAt: 'R6.4' } : {}));
  F.setCommittees(mine);
  const rows = [{ id: 'a', name: 'テスト職員A', hireDate: '2020-04-01',
    committeesJson: [{ code: 'abuse', role: 'chair' }] }];
  const st = {};
  F.committeeStats(rows, '2026-09-23').forEach((x) => { st[x.code] = x; });
  Object.keys(STARTED_WANT).forEach((code) => {
    assert.equal(st[code].startedAt, STARTED_WANT[code], code);
  });
  assert.equal(st.bcp.siteStartedAt, 'R6.4');
  assert.equal(st.abuse.siteStartedAt, '');
  /* 型は必ず文字列（画面が txt() で受けても undefined を見ない） */
  Object.keys(st).forEach((code) => {
    assert.equal(typeof st[code].startedAt, 'string', code);
    assert.equal(typeof st[code].siteStartedAt, 'string', code);
  });
});

/* ── 2026-09-23.7: 身体的拘束の開催頻度（前の既定の文面だけ今の既定へ引き直す）─────────── */
const RETIRED_RESTRAINT_FREQ = '有料は3か月に1回以上／訪問・通所は定期的';

test('開催頻度: 身体的拘束の既定は施設だけの頻度（2026-09-23.7）', () => {
  const F = freshCalc();
  assert.equal(F.COMMITTEE_DEFAULTS.find((c) => c.code === 'restraint').freq, '3か月に1回以上');
  /* サーバー応答を受け取る前の初期値も同じ（紙を刷ってもこの文面） */
  assert.equal(F.committeeOf('restraint').freq, '3か月に1回以上');
  assert.equal(/訪問|通所/.test(F.committeeOf('restraint').freq), false);
});

test('開催頻度: 保存値が前の既定の文面のままなら今の既定へ引き直す（2026-09-23.7）', () => {
  const F = freshCalc();
  const list = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
    (c.code === 'restraint') ? { freq: RETIRED_RESTRAINT_FREQ } : {}));
  assert.equal(F.setCommittees(list), 9);
  assert.equal(F.committeeOf('restraint').freq, '3か月に1回以上');
  /* 前後の空白（全角を含む）は整形で落ちるので、同じ文面として引き直す */
  const F2 = freshCalc();
  F2.setCommittees([{ code: 'restraint', label: '身体的拘束等適正化委員会', sites: ['facility'],
    freq: '　' + RETIRED_RESTRAINT_FREQ + ' ' }]);
  assert.equal(F2.committeeOf('restraint').freq, '3か月に1回以上');
});

test('開催頻度: 人が書いた頻度・空の頻度・一字違い・他の委員会・人が足した委員会には触らない（2026-09-23.7）', () => {
  const F = freshCalc();
  const list = F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c));
  list.find((c) => c.code === 'restraint').freq = '毎月';
  list.find((c) => c.code === 'abuse').freq = RETIRED_RESTRAINT_FREQ;          /* 別の委員会に同じ文面 */
  list.push({ code: 'zzz9', label: '架空の足した委員会', sites: ['visit'], freq: RETIRED_RESTRAINT_FREQ });
  F.setCommittees(list);
  assert.equal(F.committeeOf('restraint').freq, '毎月');
  assert.equal(F.committeeOf('abuse').freq, RETIRED_RESTRAINT_FREQ);
  assert.equal(F.committeeOf('zzz9').freq, RETIRED_RESTRAINT_FREQ);
  [['', ''], [RETIRED_RESTRAINT_FREQ + '（目安）', RETIRED_RESTRAINT_FREQ + '（目安）']].forEach(([saved, want]) => {
    const F2 = freshCalc();
    F2.setCommittees([{ code: 'restraint', label: '身体的拘束等適正化委員会', sites: ['facility'], freq: saved }]);
    assert.equal(F2.committeeOf('restraint').freq, want, JSON.stringify(saved));
  });
});

test('開催頻度: 読み出した形を戻しても値が育たず、画面と紙の集計にも新しい文面が出る（2026-09-23.7）', () => {
  const F = freshCalc();
  F.setCommittees(F.COMMITTEE_DEFAULTS.map((c) => Object.assign({}, c,
    (c.code === 'restraint') ? { freq: RETIRED_RESTRAINT_FREQ } : {})));
  const back = F.committees();
  F.setCommittees(back);
  assert.equal(JSON.stringify(F.committees()), JSON.stringify(back));
  const st = F.committeeStats([], '2026-09-23').find((x) => x.code === 'restraint');
  assert.equal(st.freq, '3か月に1回以上');
});

test('開催頻度: 前の文面の控えは、前の版の既定に実際にあった文面だけ（2026-09-23.7）', () => {
  const F = freshCalc();
  const R = F.RETIRED_DEFAULT_FREQ;
  assert.deepEqual(Object.keys(R), ['restraint']);
  assert.deepEqual(R.restraint, [RETIRED_RESTRAINT_FREQ]);
  /* 控えの文面が今の既定と同じだと引き直しが空回りする＝入れてはいけない */
  Object.keys(R).forEach((code) => {
    const d = F.COMMITTEE_DEFAULTS.find((c) => c.code === code);
    assert.ok(d, code + ' は既定にある委員会');
    R[code].forEach((f) => assert.notEqual(f, d.freq, code));
  });
});

/* ── CSV の数式対策（2026-09-23）: Excel が数式として実行する先頭文字（= + - @ タブ CR）には ' を前置する。
   ただの数値（-12・0.5・+5）と「-」1文字は数式にならないので触らない。取り込み時は前置した ' だけを外す ── */
test('toCsv: 数式になる先頭文字のセルに \' を前置する', () => {
  const s = S.toCsv([['=1+1', '+81-90-0000-0000', '@SUM(A1)', '\tx', '\rx', '-A1+1']]);
  const cells = S.parseCsv(s.replace(/^﻿/, '').replace(/'(?=[=+\-@\t\r])/g, '<Q>'))[0];
  assert.deepEqual(cells, ['<Q>=1+1', '<Q>+81-90-0000-0000', '<Q>@SUM(A1)', '<Q>\tx', '<Q>\rx', '<Q>-A1+1']);
});

test('toCsv: ただの数値・「-」1文字・普通の文字は前置しない', () => {
  const s = S.toCsv([['-12', '0.5', '+5', '-', 'テスト職員', '', "'abc"]]);
  assert.equal(s, '﻿"-12","0.5","+5","-","テスト職員","","\'abc"\r\n');
});

test('toCsv → parseCsv の往復: 前置した \' は取り込みで外れ、元の値に戻る', () => {
  const rows = [['=1+1', '+81-90', '@x', '-A', '\tx', '-12', '-', "'abc", "'=keep?", '＝1+1', '＋81', "'＠x"]];
  assert.deepEqual(S.parseCsv(S.toCsv(rows)), rows);
});

test('toCsv: 全角の ＝＋－＠ で始まるセルにも \' を前置する（日本語版 Excel の予防）', () => {
  assert.equal(S.toCsv([['＝1+1', '＋81', '－A', '＠x']]), '﻿"\'＝1+1","\'＋81","\'－A","\'＠x"\r\n');
});
