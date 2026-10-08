/* supplies-calc.js の請求明細（billRows / billTotal）の受け入れ試験。
   凍結仕様 .claude/plans/supplies-M1-bill-detail-freeze.md §3 を、実装とは独立に並べたもの。

   ここは「実装を読んで書いた」テストではなく「仕様から先に書いた」テスト。
   実装が仕様と食い違えば落ちる側に倒してある。

   ★実在の入居者・職員・商品名は1件も含まない（テスト品／テスト利用者・架空の価格のみ）。

     node --test "…/check/unit/supplies-bill.test.js"
*/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const C = require(path.join(__dirname, '..', '..', 'supplies-calc.js'));

/* ── 架空の材料 ─────────────────────────────────────────────────── */

const U3 = [{ name: '箱' }, { name: 'パック', per: 4 }, { name: '枚', per: 30 }];
const UG = [{ name: '缶' }, { name: 'g', per: 500 }];

const ITEMS = [
  { id: 'it_1', name: 'テスト品A', units: U3, billIdx: 1, billType: 'unit', taxRate: 10 },
  { id: 'it_2', name: 'テスト品B', units: UG, billIdx: 0, billType: 'profile', taxRate: 8 }
];
const ROSTER = [{ masterId: 12, name: 'テスト利用者A' }, { masterId: 7, name: 'テスト利用者B' }];

/* 9月。mv_3 は取り消し済み・mv_6 は入庫＝どちらも明細に出ない */
const MOVES = [
  { id: 'mv_1', type: 'out', date: '2026-09-03', itemId: 'it_1', residentId: '12', qtyBill: 2, qty: -60, amount: 3000 },
  { id: 'mv_2', type: 'out', date: '2026-09-10', itemId: 'it_1', residentId: '12', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'mv_3', type: 'out', date: '2026-09-11', itemId: 'it_1', residentId: '12', qtyBill: 1, qty: -30, amount: 1500, voided: true },
  { id: 'mv_4', type: 'out', date: '2026-09-30', itemId: 'it_2', residentId: '7', qty: -270, dose10: 30, timesPerDay: 3, days: 30, amount: 540 },
  { id: 'mv_5', type: 'out', date: '2026-09-05', itemId: 'it_1', residentId: '', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'mv_6', type: 'in', date: '2026-09-02', itemId: 'it_1', qty: 240, costEntered: 4800 }
];

const NOTES = [
  { ym: '2026-09', residentId: '12', itemId: 'it_1', text: '9月から新しいサイズ' },
  { ym: '2026-08', residentId: '12', itemId: 'it_1', text: '先月のメモ' },
  { ym: '2026-09', residentId: '7', itemId: 'it_1', text: '別の人のメモ' }
];

function base(extra) {
  return Object.assign({ moves: MOVES, items: ITEMS, prices: {}, roster: ROSTER }, extra || {});
}
function ids(rows) { return rows.map(function (r) { return r.date + '/' + r.residentId + '/' + r.itemId; }); }

/* ── 公開されているか ───────────────────────────────────────────── */

test('billRows と billTotal が公開されている', () => {
  assert.equal(typeof C.billRows, 'function');
  assert.equal(typeof C.billTotal, 'function');
});

/* ── 対象の絞り込み（type と取り消し）────────────────────────────── */

test('出庫だけを拾い、取り消し行と入庫は落とす', () => {
  const rows = C.billRows(base());
  assert.equal(rows.length, 4);
  assert.equal(rows.some(function (r) { return r.date === '2026-09-11'; }), false, '取り消し行が混ざっている');
  assert.equal(rows.some(function (r) { return r.date === '2026-09-02'; }), false, '入庫が混ざっている');
});

/* ── 行の中身 ───────────────────────────────────────────────────── */

test('unit の行は請求単位の数量と単位名を持つ', () => {
  const rows = C.billRows(base({ sort: 'date' }));
  const r = rows[0];
  assert.equal(r.date, '2026-09-03');
  assert.equal(r.residentId, '12');
  assert.equal(r.name, 'テスト利用者A');
  assert.equal(r.itemName, 'テスト品A');
  assert.equal(r.qtyBill, 2);
  assert.equal(r.qty, 60, 'qty は絶対値で持つ');
  assert.equal(r.unitName, 'パック');
  assert.equal(r.amount, 3000);
  assert.equal(r.billType, 'unit');
  assert.equal(r.taxRate, 10);
});

test('profile の行は最小単位の数量を持ち、qtyBill は null', () => {
  const rows = C.billRows(base({ itemId: 'it_2' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qtyBill, null);
  assert.equal(rows[0].qty, 270);
  assert.equal(rows[0].unitName, 'g');
  assert.equal(rows[0].name, 'テスト利用者B');
});

test('提供先なしの行は共用として出す（集計と同じ文字）', () => {
  const rows = C.billRows(base({ residentId: '-' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].residentId, '');
  assert.equal(rows[0].name, '（提供先なし）');
});

test('名簿が無ければ氏名は空。利用者Noは残る', () => {
  const rows = C.billRows(base({ roster: [], residentId: '12' }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '');
  assert.equal(rows[0].residentId, '12');
});

/* ── 金額（集計と一致すること）──────────────────────────────────── */

test('★絞り込み無しの合計が aggregateMonth の合計と一致する', () => {
  const rows = C.billRows(base());
  const agg = C.aggregateMonth({ moves: MOVES, items: ITEMS, prices: {}, roster: ROSTER });
  const aggSum = agg.reduce(function (a, r) { return a + (r.amount || 0); }, 0);
  assert.equal(C.billTotal(rows), aggSum);
  assert.equal(C.billTotal(rows), 6540);
});

test('amount が欠けた行は date 時点の価格で埋める', () => {
  const P1 = { id: 'pr_1', itemId: 'it_1', effDate: '2026-08-01', billPrice: 1400, unitPrice10: 467 };
  const P2 = { id: 'pr_2', itemId: 'it_1', effDate: '2026-09-01', billPrice: 1500, unitPrice10: 500 };
  const moves = [{ id: 'mv_9', type: 'out', date: '2026-09-10', itemId: 'it_1', residentId: '12', qtyBill: 2, qty: -60 }];
  const rows = C.billRows({ moves: moves, items: ITEMS, prices: { it_1: [P1, P2] }, roster: ROSTER });
  assert.equal(rows[0].amount, 3000);
  assert.equal(C.billTotal(rows), 3000);
});

test('billTotal は数値でない金額を足さない', () => {
  assert.equal(C.billTotal([{ amount: 100 }, { amount: null }, { amount: 'x' }, {}]), 100);
  assert.equal(C.billTotal([]), 0);
  assert.equal(C.billTotal(null), 0);
});

/* ── 並び替え ───────────────────────────────────────────────────── */

test('日付順（既定）', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'date' }))),
    ['2026-09-03/12/it_1', '2026-09-05//it_1', '2026-09-10/12/it_1', '2026-09-30/7/it_2']);
  assert.deepEqual(ids(C.billRows(base())), ids(C.billRows(base({ sort: 'date', dir: 'asc' }))),
    'sort・dir の既定は date・asc');
});

test('日付順の降順', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'date', dir: 'desc' }))),
    ['2026-09-30/7/it_2', '2026-09-10/12/it_1', '2026-09-05//it_1', '2026-09-03/12/it_1']);
});

test('入居者順。利用者Noは数値で比べ、共用は最後', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'resident' }))),
    ['2026-09-30/7/it_2', '2026-09-03/12/it_1', '2026-09-10/12/it_1', '2026-09-05//it_1']);
});

test('入居者順の降順。第1キーだけ反転し、同じ人の中は日付の昇順のまま', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'resident', dir: 'desc' }))),
    ['2026-09-05//it_1', '2026-09-03/12/it_1', '2026-09-10/12/it_1', '2026-09-30/7/it_2']);
});

test('品目順。同じ品目の中は日付の昇順', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'item' }))),
    ['2026-09-03/12/it_1', '2026-09-05//it_1', '2026-09-10/12/it_1', '2026-09-30/7/it_2']);
});

test('品目順の降順。第1キーだけ反転する', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'item', dir: 'desc' }))),
    ['2026-09-30/7/it_2', '2026-09-03/12/it_1', '2026-09-05//it_1', '2026-09-10/12/it_1']);
});

test('知らない sort・dir は既定へ倒す', () => {
  assert.deepEqual(ids(C.billRows(base({ sort: 'zzz', dir: 'zzz' }))), ids(C.billRows(base())));
});

/* ── 絞り込み ───────────────────────────────────────────────────── */

test('入居者で絞る', () => {
  const rows = C.billRows(base({ residentId: '12' }));
  assert.equal(rows.length, 2);
  assert.equal(rows.every(function (r) { return r.residentId === '12'; }), true);
});

test('品目で絞る', () => {
  const rows = C.billRows(base({ itemId: 'it_1' }));
  assert.equal(rows.length, 3);
  assert.equal(rows.every(function (r) { return r.itemId === 'it_1'; }), true);
});

test('入居者と品目を重ねて絞る', () => {
  const rows = C.billRows(base({ residentId: '12', itemId: 'it_1' }));
  assert.equal(rows.length, 2);
  assert.equal(C.billTotal(rows), 4500);
});

test('空・null の絞り込みは「すべて」と同じ', () => {
  assert.equal(C.billRows(base({ residentId: '', itemId: '' })).length, 4);
  assert.equal(C.billRows(base({ residentId: null, itemId: null })).length, 4);
});

/* ── メモ ───────────────────────────────────────────────────────── */

test('メモは月×入居者×品目が揃った行すべてに載る', () => {
  const rows = C.billRows(base({ notes: NOTES, sort: 'date' }));
  const byKey = {};
  rows.forEach(function (r) { byKey[r.date] = r; });
  assert.equal(byKey['2026-09-03'].note, '9月から新しいサイズ');
  assert.equal(byKey['2026-09-10'].note, '9月から新しいサイズ', '同じ人の同じ品目なら日付が違っても載る');
});

test('メモは別の人・別の品目・別の月には載らない', () => {
  const rows = C.billRows(base({ notes: NOTES, sort: 'date' }));
  const byKey = {};
  rows.forEach(function (r) { byKey[r.date] = r; });
  assert.equal(byKey['2026-09-05'].note || '', '', '共用の行に他人のメモが載っている');
  assert.equal(byKey['2026-09-30'].note || '', '', '別品目の行にメモが載っている');
  /* 8月のメモは9月の行に出ない（同じ人・同じ品目でも月が違う） */
  assert.equal(rows.some(function (r) { return r.note === '先月のメモ'; }), false);
});

test('メモを渡さなくても落ちない', () => {
  const rows = C.billRows(base());
  assert.equal(rows[0].note || '', '');
});

/* ── 月額（profile）の内訳 ─────────────────────────────────────── */

test('月額の行は 1回量・回数/日・日数 を持ち帰る（紙で内訳を出すため）', () => {
  const rows = C.billRows(base({ itemId: 'it_2' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dose10, 30, '1回3.0g');
  assert.equal(rows[0].timesPerDay, 3);
  assert.equal(rows[0].days, 30);
  assert.equal(rows[0].qty, 270, '合計は 3.0g×3回×30日＝270g');
});

test('数量で出す品目には月額の内訳を付けない', () => {
  const rows = C.billRows(base({ itemId: 'it_1' }));
  rows.forEach(function (r) {
    assert.equal(r.dose10, null);
    assert.equal(r.timesPerDay, null);
    assert.equal(r.days, null);
  });
});

test('月額でも記録に内訳が無ければ null のまま（推測で埋めない）', () => {
  const moves = [{ id: 'mv_p', type: 'out', date: '2026-09-30', itemId: 'it_2', residentId: '7', qty: -100, amount: 200 }];
  const rows = C.billRows({ moves: moves, items: ITEMS, prices: {}, roster: ROSTER });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dose10, null);
  assert.equal(rows[0].timesPerDay, null);
  assert.equal(rows[0].days, null);
  assert.equal(rows[0].qty, 100, '合計は記録どおり残す');
});

test('内訳を足しても合計は変わらない（集計と一致し続ける）', () => {
  const rows = C.billRows(base());
  const agg = C.aggregateMonth({ moves: MOVES, items: ITEMS, prices: {}, roster: ROSTER });
  assert.equal(C.billTotal(rows), agg.reduce(function (a, r) { return a + (r.amount || 0); }, 0));
  assert.equal(C.billTotal(rows), 6540);
});

/* ── 在庫の動きとの突き合わせ ─────────────────────────────────── */

const STOCK_MOVES = [
  { id: 's1', type: 'in',    date: '2026-09-01', itemId: 'it_1', qty: 240, costEntered: 4800 },
  { id: 's2', type: 'out',   date: '2026-09-03', itemId: 'it_1', residentId: '12', qty: -30, qtyBill: 1, amount: 1500 },
  { id: 's3', type: 'out',   date: '2026-09-05', itemId: 'it_1', residentId: '7',  qty: -60, qtyBill: 2, amount: 3000 },
  { id: 's4', type: 'adj',   date: '2026-09-10', itemId: 'it_1', qty: -15 },
  { id: 's5', type: 'adj',   date: '2026-09-12', itemId: 'it_1', qty: 5 },
  { id: 's6', type: 'count', date: '2026-09-30', itemId: 'it_1', qty: 120 },
  { id: 's7', type: 'out',   date: '2026-09-11', itemId: 'it_1', residentId: '12', qty: -30, voided: true },
  { id: 's8', type: 'out',   date: '2026-09-20', itemId: 'it_2', residentId: '7', qty: -270, dose10: 30, timesPerDay: 3, days: 30, amount: 540 }
];

test('在庫の動きを品目ごとにまとめる', () => {
  const rows = C.stockMoveSummary({ moves: STOCK_MOVES, items: ITEMS });
  assert.equal(rows.length, 2);
  const a = rows.filter(function (r) { return r.itemId === 'it_1'; })[0];
  assert.equal(a.inQty, 240);
  assert.equal(a.outQty, 90, '出庫は絶対値で足す（30+60・取り消しは数えない）');
  assert.equal(a.adjQty, -10, '調整は符号つきで足す（-15 と +5）');
  assert.equal(a.unitName, '枚', '在庫は最小単位で数える');
  assert.deepEqual(a.counts, [{ date: '2026-09-30', qty: 120 }]);
});

test('取り消した出庫は在庫の動きに数えない', () => {
  const rows = C.stockMoveSummary({ moves: STOCK_MOVES, items: ITEMS });
  const a = rows.filter(function (r) { return r.itemId === 'it_1'; })[0];
  assert.equal(a.outQty, 90, '取り消し30枚を足していない');
});

test('調整も棚卸も無い品目は 0 と空で返す（行は落とさない）', () => {
  const rows = C.stockMoveSummary({ moves: STOCK_MOVES, items: ITEMS });
  const b = rows.filter(function (r) { return r.itemId === 'it_2'; })[0];
  assert.equal(b.adjQty, 0);
  assert.deepEqual(b.counts, []);
  assert.equal(b.outQty, 270);
  assert.equal(b.unitName, 'g');
});

test('棚卸が複数あれば日付順に並べる', () => {
  const moves = STOCK_MOVES.concat([{ id: 's9', type: 'count', date: '2026-09-10', itemId: 'it_1', qty: 200 }]);
  const rows = C.stockMoveSummary({ moves: moves, items: ITEMS });
  const a = rows.filter(function (r) { return r.itemId === 'it_1'; })[0];
  assert.deepEqual(a.counts.map(function (c) { return c.date; }), ['2026-09-10', '2026-09-30']);
});

test('突き合わせの出庫合計は、明細の行から数えた合計と一致する', () => {
  const sum = C.stockMoveSummary({ moves: STOCK_MOVES, items: ITEMS });
  const rows = C.billRows({ moves: STOCK_MOVES, items: ITEMS, prices: {}, roster: ROSTER });
  ['it_1', 'it_2'].forEach(function (id) {
    const fromSummary = sum.filter(function (r) { return r.itemId === id; })[0].outQty;
    const fromRows = rows.filter(function (r) { return r.itemId === id; })
      .reduce(function (a, r) { return a + r.qty; }, 0);
    assert.equal(fromSummary, fromRows, id + ' の出庫合計が食い違う');
  });
});

test('空入力・壊れた行でも落ちない', () => {
  assert.deepEqual(C.stockMoveSummary({}), []);
  assert.deepEqual(C.stockMoveSummary(null), []);
  const rows = C.stockMoveSummary({ moves: STOCK_MOVES.concat([null, {}, { type: 'out' }]), items: ITEMS });
  assert.equal(rows.length, 2, '品目IDの無い行は数えない');
});

/* ── 壊れた入力 ─────────────────────────────────────────────────── */

test('空入力・壊れた行でも落ちない', () => {
  assert.deepEqual(C.billRows({}), []);
  assert.deepEqual(C.billRows(null), []);
  const broken = MOVES.concat([null, { id: 'mv_z' }, { id: 'mv_w', type: 'out', date: '2026-09-04' }]);
  const rows = C.billRows({ moves: broken, items: ITEMS, prices: {}, roster: ROSTER });
  assert.equal(rows.length >= 4, true);
  rows.forEach(function (r) { assert.equal(typeof r.date, 'string'); });
});

test('知らない品目の行でも落ちない（品目名は空で残す）', () => {
  const moves = [{ id: 'mv_u', type: 'out', date: '2026-09-07', itemId: 'it_zzz', residentId: '12', qty: -1 }];
  const rows = C.billRows({ moves: moves, items: ITEMS, prices: {}, roster: ROSTER });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemName, '');
});

test('元の配列を書き換えない', () => {
  const before = JSON.stringify(MOVES);
  C.billRows(base({ sort: 'resident', dir: 'desc' }));
  assert.equal(JSON.stringify(MOVES), before);
});

/* ══════════════════════════════════════════════════════════════════
   氏名の並び（五十音順）— 2026-09-19 管理者指示
   ・名簿の読み（kana）で並べる。カタカナ・半角カナ・全角スペースは吸収する
   ・同じ読みは利用者Noの小さい順（並びを毎回同じにするため）
   ・読みが無い人は最後にまとめ、利用者Noの小さい順（読みを捏造しない）
   ・明細の「入居者順」と入居者ごとの改ページも、この並びに従う
   ★ここも実在の入居者は1件も含まない（読みは架空）
   ══════════════════════════════════════════════════════════════════ */

const KROSTER = [
  { masterId: 12, name: 'テスト利用者ア', kana: 'わたなべ てすと', active: true },
  { masterId: 7, name: 'テスト利用者イ', kana: 'あおやま てすと', active: true },
  { masterId: 3, name: 'テスト利用者ウ', kana: 'アオヤマ てすと', active: false, dischargeDate: '2026-08-31' },
  { masterId: 40, name: 'テスト利用者エ', kana: 'ｽｽﾞｷ ﾃｽﾄ', active: true },
  { masterId: 5, name: 'テスト利用者オ', kana: 'すずき　てすと', active: true },
  { masterId: 99, name: 'テスト利用者カ', kana: '', active: true }
];
function idsOf(list) { return list.map(function (r) { return String(r.masterId); }); }

test('sortRoster と rosterOrder が公開されている', () => {
  assert.equal(typeof C.sortRoster, 'function');
  assert.equal(typeof C.rosterOrder, 'function');
});

test('読みの五十音順に並ぶ。カタカナ・半角カナ・全角スペースは同じ読みとして扱う', () => {
  assert.deepEqual(idsOf(C.sortRoster(KROSTER)), ['3', '7', '5', '40', '12', '99']);
});

test('同じ読みは利用者Noの小さい順', () => {
  const r = C.sortRoster([
    { masterId: 20, name: 'テストA', kana: 'あさひ てすと' },
    { masterId: 4, name: 'テストB', kana: 'あさひ てすと' }
  ]);
  assert.deepEqual(idsOf(r), ['4', '20']);
});

test('読みが無い人は最後・利用者No順（読みのある人の間に混ぜない）', () => {
  const r = C.sortRoster([
    { masterId: 30, name: 'テストA', kana: '' },
    { masterId: 2, name: 'テストB', kana: 'わ てすと' },
    { masterId: 8, name: 'テストC' }
  ]);
  assert.deepEqual(idsOf(r), ['2', '8', '30']);
});

test('濁点・小さい字・長音でも読みの順に並ぶ', () => {
  const r = C.sortRoster([
    { masterId: 4, name: 'D', kana: 'さんとう てすと' },
    { masterId: 3, name: 'C', kana: 'ざとう てすと' },
    { masterId: 2, name: 'B', kana: 'さとう てすと' },
    { masterId: 1, name: 'A', kana: 'さいとう てすと' }
  ]);
  assert.deepEqual(idsOf(r), ['1', '2', '3', '4']);
});

test('元の名簿を書き換えない・利用者Noの無い行は落とす', () => {
  const before = JSON.stringify(KROSTER);
  const r = C.sortRoster(KROSTER.concat([{ name: '番号なし', kana: 'あ' }, null]));
  assert.equal(JSON.stringify(KROSTER), before);
  assert.equal(r.length, KROSTER.length);
});

test('名簿は {residents:[…]} の形でも読む・空や null でも落ちない', () => {
  assert.deepEqual(idsOf(C.sortRoster({ residents: KROSTER })), ['3', '7', '5', '40', '12', '99']);
  assert.deepEqual(C.sortRoster([]), []);
  assert.deepEqual(C.sortRoster(null), []);
  assert.deepEqual(C.rosterOrder(null), {});
});

test('rosterOrder は 利用者No → 何番目 を返す', () => {
  const o = C.rosterOrder(KROSTER);
  assert.equal(o['3'], 0);
  assert.equal(o['7'], 1);
  assert.equal(o['12'], 4);
  assert.equal(o['99'], 5);
  assert.equal(o['999'], undefined);
});

/* ── 明細の「入居者順」が五十音順になる ─────────────────────────── */

const KMOVES = [
  { id: 'kv_1', type: 'out', date: '2026-09-03', itemId: 'it_1', residentId: '12', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'kv_2', type: 'out', date: '2026-09-04', itemId: 'it_1', residentId: '7', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'kv_3', type: 'out', date: '2026-09-05', itemId: 'it_1', residentId: '3', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'kv_4', type: 'out', date: '2026-09-06', itemId: 'it_1', residentId: '99', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'kv_5', type: 'out', date: '2026-09-07', itemId: 'it_1', residentId: '', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'kv_6', type: 'out', date: '2026-09-08', itemId: 'it_1', residentId: '777', qtyBill: 1, qty: -30, amount: 1500 }
];
function rids(rows) { return rows.map(function (r) { return r.residentId; }); }

test('入居者順は五十音順。読みの無い人と名簿に無い人は後ろ、共用は最後', () => {
  const rows = C.billRows({ moves: KMOVES, items: ITEMS, prices: {}, roster: KROSTER, sort: 'resident' });
  assert.deepEqual(rids(rows), ['3', '7', '12', '99', '777', '']);
});

test('入居者順の降順は第1キーだけ反転する', () => {
  const rows = C.billRows({ moves: KMOVES, items: ITEMS, prices: {}, roster: KROSTER, sort: 'resident', dir: 'desc' });
  assert.deepEqual(rids(rows), ['', '777', '99', '12', '7', '3']);
});

test('日付順の中の同じ日は五十音順（第2キー）', () => {
  const same = KMOVES.slice(0, 3).map(function (m) { return Object.assign({}, m, { date: '2026-09-09' }); });
  const rows = C.billRows({ moves: same, items: ITEMS, prices: {}, roster: KROSTER, sort: 'date' });
  assert.deepEqual(rids(rows), ['3', '7', '12']);
});

test('読みの無い名簿では従来どおり利用者Noの順（後方互換）', () => {
  const rows = C.billRows(base({ sort: 'resident' }));
  assert.deepEqual(ids(rows),
    ['2026-09-30/7/it_2', '2026-09-03/12/it_1', '2026-09-10/12/it_1', '2026-09-05//it_1']);
});

test('並べ替えても合計は変わらない', () => {
  const a = C.billTotal(C.billRows({ moves: KMOVES, items: ITEMS, prices: {}, roster: KROSTER, sort: 'resident' }));
  const b = C.billTotal(C.billRows({ moves: KMOVES, items: ITEMS, prices: {}, roster: KROSTER, sort: 'date' }));
  const c = C.billTotal(C.billRows({ moves: KMOVES, items: ITEMS, prices: {}, roster: [], sort: 'resident' }));
  assert.equal(a, b);
  assert.equal(a, c);
});

test('集計も五十音順に並ぶ。行の形は増やさない', () => {
  const rows = C.aggregateMonth({ moves: KMOVES, items: ITEMS, prices: {}, roster: KROSTER });
  assert.deepEqual(rids(rows), ['3', '7', '12', '99', '777', '']);
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['amount', 'billType', 'itemId', 'itemName', 'name', 'qty', 'qtyBill', 'residentId', 'taxRate', 'unitName']);
});
