/* supplies-calc.js（消耗品管理の計算層）の回帰テスト。
   node --test で走る。外部ライブラリ不要（node:test + node:assert/strict のみ）。

   凍結API `.claude/plans/supplies-L0-api-freeze.md` §5 ＝ 設計書 §7-2 の全項目を並べている:
   1. 提案→導出→逆算が往復で一致する（unit 起点・bill 起点）
   2. 丸め3方式と浮動小数の罠（1.1×100 の ceil・0.1×3 の ceil・1.1g×3回×30日×2.0円＝198円）
   3. 単位チェーン 1段／2段／3段・billIdx=0／=minIdx・R が10の倍数でない（7）・per=1
   4. 初回改定（種別既定の値入率）・負の前回値入率・値入率の範囲外
   5. profile の小数 dose（1.1g・2.5g×3回×31日）
   6. convertQty（各段→最小単位）・qtyBill（unitIdx<billIdx・=billIdx・入数変更をまたぐ付け直し）
   7. stockOf（棚卸の前後・棚卸日と同日で棚卸より後の行・遡り日付の行・countOnly・棚卸なし）
   8. aggregateMonth（voided 除外・提供先なし・氏名の解決）と CSV

   ★実在の入居者・職員・商品名は1件も含まない（テスト品／テスト利用者・架空の価格のみ）。

     node --test "…/check/unit/supplies-calc.test.js"
*/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const C = require(path.join(__dirname, '..', '..', 'supplies-calc.js'));

/* ── 架空の単位チェーン ─────────────────────────────────────────── */

/* 3段: 1箱＝4パック・1パック＝30枚（F=120・パック請求なら R=30） */
const U3 = [{ name: '箱' }, { name: 'パック', per: 4 }, { name: '枚', per: 30 }];
/* 2段・入数が10の倍数でない: 1袋＝7本（F=7） */
const U7 = [{ name: '袋' }, { name: '本', per: 7 }];
/* 2段・per=1: 1ケース＝1本 */
const U1x = [{ name: 'ケース' }, { name: '本', per: 1 }];
/* 1段のみ */
const U1 = [{ name: '本' }];
/* profile 用: 1缶＝500g */
const UG = [{ name: '缶' }, { name: 'g', per: 500 }];

/* ── 公開API の形 ───────────────────────────────────────────────── */

test('公開APIが凍結どおり揃っている', () => {
  assert.equal(C.VERSION, '2026-09-23.1');
  const names = ['factor', 'minIdx', 'ratioR', 'validateUnits', 'splitQty', 'roundDiv',
    'propose', 'deriveBill', 'refUnit', 'effMarkup', 'costPer', 'belowCost',
    'currentPrice', 'priceAt', 'changeRatio', 'convertQty', 'qtyBillOf', 'unitAmount',
    'profileQtyAmount', 'profileMonthly', 'defaultProfile', 'stockOf', 'reorderState',
    'aggregateMonth', 'toCsv', 'today', 'monthRange', 'prevMonth', 'isYmd'];
  names.forEach((n) => assert.equal(typeof C[n], 'function', n + ' が無い'));
});

/* ── 単位チェーン ──────────────────────────────────────────────── */

test('factor: 基準単位1つに含まれる各段の個数（factor(0)=1）', () => {
  assert.equal(C.factor(U3, 0), 1);
  assert.equal(C.factor(U3, 1), 4);
  assert.equal(C.factor(U3, 2), 120);
  assert.equal(C.factor(U7, 1), 7);
  assert.equal(C.factor(U1x, 1), 1);
  assert.equal(C.factor(U1, 0), 1);
  assert.equal(C.factor(U3, 3), null);        /* 段の範囲外 */
  assert.equal(C.factor(U3, -1), null);
  assert.equal(C.factor([], 0), null);
  assert.equal(C.factor(null, 0), null);
  assert.equal(C.factor([{ name: '箱' }, { name: 'パック', per: 0 }], 1), null);
});

test('minIdx / ratioR: 最小単位の添字と R', () => {
  assert.equal(C.minIdx(U3), 2);
  assert.equal(C.minIdx(U1), 0);
  assert.equal(C.minIdx('箱'), null);
  assert.equal(C.ratioR(U3, 1), 30);          /* 1パック＝30枚 */
  assert.equal(C.ratioR(U3, 0), 120);         /* 1箱＝120枚 */
  assert.equal(C.ratioR(U3, 2), 1);
  assert.equal(C.ratioR(U7, 0), 7);
  assert.equal(C.ratioR(U1x, 0), 1);
  assert.equal(C.ratioR(U1, 0), 1);
});

test('validateUnits: 壊れたチェーンを欄ごとに指す', () => {
  assert.deepEqual(C.validateUnits(U3), []);
  assert.deepEqual(C.validateUnits([]), [{ key: 'units', reason: 'empty' }]);
  assert.deepEqual(C.validateUnits(null), [{ key: 'units', reason: 'empty' }]);
  assert.deepEqual(C.validateUnits([{ name: '' }]), [{ key: 'units.0.name', reason: 'required' }]);
  assert.deepEqual(C.validateUnits([{ name: '箱' }, { name: 'パック', per: 0 }]),
    [{ key: 'units.1.per', reason: 'range' }]);
  assert.deepEqual(C.validateUnits([{ name: '箱', per: 2 }]),
    [{ key: 'units.0.per', reason: 'unexpected' }]);
  const four = C.validateUnits([{ name: 'a' }, { name: 'b', per: 2 }, { name: 'c', per: 2 }, { name: 'd', per: 2 }]);
  assert.deepEqual(four, [{ key: 'units', reason: 'too_many' }]);
  /* 単位名は12字まで（サーバー UNIT_NAME_MAX と同値）。13字以上は画面に理由を出す */
  assert.deepEqual(C.validateUnits([{ name: 'パック（Lサイズ・30枚）' }]),
    [{ key: 'units.0.name', reason: 'too_long' }]);
  assert.deepEqual(C.validateUnits([{ name: '123456789012' }]), []);     /* ちょうど12字は通る */
});

test('splitQty: 最小単位の在庫を「◯パックと余り◯枚」に割る', () => {
  assert.deepEqual(C.splitQty(U3, 125, 1), { major: 4, rest: 5 });
  assert.deepEqual(C.splitQty(U3, 125, 0), { major: 1, rest: 5 });   /* 1箱と5枚 */
  assert.deepEqual(C.splitQty(U3, 120, 1), { major: 4, rest: 0 });
  assert.deepEqual(C.splitQty(U3, 125, 2), { major: 125, rest: 0 });
  assert.deepEqual(C.splitQty(U3, -125, 1), { major: -4, rest: -5 }); /* 在庫マイナス */
  assert.equal(C.splitQty(U3, 1.5, 1), null);
  assert.equal(C.splitQty(null, 10, 0), null);
});

/* ── 丸め（整数除算）と浮動小数の罠 ────────────────────────────── */

test('roundDiv: 3方式（round は .5 切り上げ）', () => {
  assert.equal(C.roundDiv(10, 4, 'round'), 3);     /* 2.5 → 3 */
  assert.equal(C.roundDiv(10, 4, 'ceil'), 3);
  assert.equal(C.roundDiv(10, 4, 'floor'), 2);
  assert.equal(C.roundDiv(9, 4, 'round'), 2);      /* 2.25 → 2 */
  assert.equal(C.roundDiv(9, 4, 'ceil'), 3);
  assert.equal(C.roundDiv(9, 4, 'floor'), 2);
  assert.equal(C.roundDiv(12, 4, 'ceil'), 3);      /* 割り切れたら増やさない */
  assert.equal(C.roundDiv(0, 4, 'ceil'), 0);
  assert.equal(C.roundDiv(10, 0, 'round'), null);  /* 0 除算 */
  assert.equal(C.roundDiv(10, -4, 'round'), null);
  assert.equal(C.roundDiv(1.5, 4, 'round'), null);
  assert.equal(C.roundDiv('10', 4, 'round'), null);
  assert.equal(C.roundDiv(10, 4), 3);              /* mode 省略は round */
  assert.equal(C.roundDiv(10, 4, 'nearest'), 3);   /* 未知の mode も round */
});

/* 負の被除数は「絶対値で丸めて符号を戻す」＝GAS の roundDiv_ と同じ裁定。
   数学的な floor/ceil（−∞/+∞ 方向）にすると二重実装が食い違う */
test('roundDiv: 負の被除数は絶対値で丸めて符号を戻す（GAS と同値）', () => {
  assert.equal(C.roundDiv(-5, 10, 'round'), -1);   /* 0.5 → 1 → −1 */
  assert.equal(C.roundDiv(-4, 10, 'round'), -0);   /* 0.4 → 0 → −0（== 0） */
  assert.equal(C.roundDiv(-1, 10, 'ceil'), -1);
  assert.equal(C.roundDiv(-11, 10, 'floor'), -1);
  assert.equal(C.roundDiv(-20, 10, 'ceil'), -2);   /* 割り切れたら増やさない */
  /* 絶対値で丸めるので floor は 0 に近い側。符号を戻した結果は −0（JSON でも 0） */
  assert.equal(C.roundDiv(-1, 10, 'floor'), -0);
  assert.equal(JSON.stringify(C.roundDiv(-1, 10, 'floor')), '0');
});

test('浮動小数の罠: 1.1×100 の ceil（float は 111・整数なら 110）', () => {
  assert.equal(Math.ceil(1.1 * 100), 111);                  /* 1.1*100 = 110.00000000000001 */
  assert.equal(C.roundDiv(11 * 100, 10, 'ceil'), 110);      /* 0.1円単位の整数で持てば 110 */
  /* 同じ話を請求額で: 1.1円/枚 × 100枚 = 110円 */
  assert.equal(C.unitAmount({ units: U1, billIdx: 0, qty: 100, unitPrice10: 11 }), 110);
});

test('浮動小数の罠: 0.1×3 の ceil（float は 4・整数なら 3）', () => {
  assert.equal(0.1 * 3, 0.30000000000000004);
  assert.equal(Math.ceil(0.1 * 3 * 10), 4);
  assert.equal(C.roundDiv(1 * 3, 1, 'ceil'), 3);            /* 0.1単位の整数なら 3 のまま */
  /* 0.1円/枚 × 3枚 = 0.3円 → 請求は 0円（四捨五入） */
  assert.equal(C.unitAmount({ units: U1, billIdx: 0, qty: 3, unitPrice10: 1 }), 0);
});

test('浮動小数の罠: 1.1g×3回×30日×2.0円＝198円ちょうど（float は 199）', () => {
  assert.equal(Math.ceil(1.1 * 3 * 30 * 2.0), 199);         /* 1.1*3*30 = 99.00000000000001 */
  const r = C.profileQtyAmount({ dose10: 11, timesPerDay: 3, days: 30, unitPrice10: 20 });
  assert.deepEqual(r, { qty: 99, amount: 198 });
});

/* ── 価格の提案・導出・逆算（往復） ────────────────────────────── */

test('propose: 3段・パック請求の提案（原価4800円/箱・値入率20.0%）', () => {
  const r = C.propose({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', m1000: 200, mode: 'round' });
  assert.deepEqual(r, { ok: true, unitPrice10: 500, billPrice: 1500, m1000Used: 200, warnings: [] });
  /* 導出と逆算が往復で一致する（unit 起点） */
  assert.equal(C.deriveBill({ unitPrice10: 500, units: U3, billIdx: 1 }), 1500);
  assert.equal(C.effMarkup({
    cost: 4800, units: U3, billIdx: 1, billType: 'unit', billPrice: 1500, unitPrice10: 500
  }), 200);
  assert.equal(C.refUnit({ billPrice: 1500, units: U3, billIdx: 1 }), 50);
});

test('effMarkup: 請求単位売価を人が直した時の逆算（bill 起点）', () => {
  /* 1500円ではなく 1480円に手で下げた → 実効値入率は 18.9% */
  assert.equal(C.effMarkup({
    cost: 4800, units: U3, billIdx: 1, billType: 'unit', billPrice: 1480, unitPrice10: null
  }), 189);
  /* 参考表示の枚単価は小数で出す（49.33…円） */
  const ref = C.refUnit({ billPrice: 1480, units: U3, billIdx: 1 });
  assert.ok(Math.abs(ref - 49.3333333) < 1e-6);
  /* billPrice が無ければ最小単位売価から逆算する */
  assert.equal(C.effMarkup({
    cost: 4800, units: U3, billIdx: 1, billType: 'unit', billPrice: null, unitPrice10: 500
  }), 200);
  assert.equal(C.effMarkup({ cost: 4800, units: U3, billIdx: 1, billPrice: null, unitPrice10: null }), null);
});

test('propose: billIdx=0（箱で請求）と billIdx=minIdx（枚で請求）', () => {
  const box = C.propose({ cost: 4800, units: U3, billIdx: 0, billType: 'unit', m1000: 200 });
  assert.equal(box.unitPrice10, 500);
  assert.equal(box.billPrice, 6000);                      /* 500×120÷10 */
  assert.equal(C.effMarkup({ cost: 4800, units: U3, billIdx: 0, billPrice: 6000 }), 200);

  const sheet = C.propose({ cost: 4800, units: U3, billIdx: 2, billType: 'unit', m1000: 200 });
  assert.equal(sheet.unitPrice10, 500);
  assert.equal(sheet.billPrice, null);                    /* 請求単位＝最小単位なので導出しない */
  assert.equal(C.deriveBill({ unitPrice10: 500, units: U3, billIdx: 2 }), null);
  /* 請求額は最小単位売価から（枚数×50.0円） */
  assert.equal(C.unitAmount({ units: U3, billIdx: 2, qty: 7, unitPrice10: 500 }), 350);
});

test('propose: 1段だけの品目（請求単位＝最小単位＝基準単位）', () => {
  const r = C.propose({ cost: 100, units: U1, billIdx: 0, billType: 'unit', m1000: 200 });
  assert.equal(r.unitPrice10, 1250);                      /* 125.0円 */
  assert.equal(r.billPrice, null);
  assert.equal(C.effMarkup({ cost: 100, units: U1, billIdx: 0, unitPrice10: 1250 }), 200);
});

test('propose: R が10の倍数でない品目（1袋＝7本）でも往復が一致する', () => {
  const r = C.propose({ cost: 1000, units: U7, billIdx: 0, billType: 'unit', m1000: 200 });
  assert.equal(r.unitPrice10, 1786);                      /* 178.6円/本（切り上げ側） */
  assert.equal(r.billPrice, 1250);                        /* 1786×7÷10 = 1250.2 → 1250 */
  assert.equal(C.effMarkup({ cost: 1000, units: U7, billIdx: 0, billPrice: 1250 }), 200);
  assert.equal(C.effMarkup({ cost: 1000, units: U7, billIdx: 0, unitPrice10: 1786 }), 200);
});

test('propose: 丸め3方式で提案が変わる', () => {
  const base = { cost: 1000, units: U7, billIdx: 0, billType: 'unit', m1000: 200 };
  assert.equal(C.propose(Object.assign({}, base, { mode: 'floor' })).unitPrice10, 1785);
  assert.equal(C.propose(Object.assign({}, base, { mode: 'ceil' })).unitPrice10, 1786);
  assert.equal(C.propose(Object.assign({}, base, { mode: 'round' })).unitPrice10, 1786);
  /* 請求単位売価にも同じ mode がかかる */
  assert.equal(C.propose(Object.assign({}, base, { mode: 'ceil' })).billPrice, 1251);
  assert.equal(C.propose(Object.assign({}, base, { mode: 'floor' })).billPrice, 1249);
});

test('propose: per=1 のチェーン', () => {
  const r = C.propose({ cost: 300, units: U1x, billIdx: 0, billType: 'unit', m1000: 200 });
  assert.equal(r.unitPrice10, 3750);
  assert.equal(r.billPrice, 375);
  assert.equal(C.effMarkup({ cost: 300, units: U1x, billIdx: 0, billPrice: 375 }), 200);
});

test('propose: 初回改定は種別既定の値入率をそのまま使う', () => {
  const r = C.propose({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', m1000: 250 });
  assert.equal(r.m1000Used, 250);
  assert.equal(r.unitPrice10, 533);                       /* 48,000,000 ÷ (120×750) = 533.3 */
  assert.equal(r.billPrice, 1599);
  assert.deepEqual(r.warnings, []);
});

test('propose: 前回の値入率が負なら 0 に丸めて警告する', () => {
  const r = C.propose({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', m1000: -50 });
  assert.equal(r.ok, true);
  assert.equal(r.m1000Used, 0);
  assert.deepEqual(r.warnings, ['markup_negative']);
  assert.equal(r.unitPrice10, 400);                       /* 原価そのまま 40.0円/枚 */
  assert.equal(r.billPrice, 1200);
});

test('propose: 値入率が 1000 以上・入力が壊れていれば ok:false', () => {
  assert.deepEqual(C.propose({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', m1000: 1000 }),
    { ok: false, error: 'markup_range' });
  assert.deepEqual(C.propose({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', m1000: 1200 }),
    { ok: false, error: 'markup_range' });
  assert.equal(C.propose({ cost: -1, units: U3, billIdx: 1, billType: 'unit', m1000: 200 }).ok, false);
  assert.equal(C.propose({ cost: 4800, units: [], billIdx: 1, billType: 'unit', m1000: 200 }).ok, false);
  assert.equal(C.propose({ cost: 4800, units: U3, billIdx: 9, billType: 'unit', m1000: 200 }).ok, false);
  assert.equal(C.propose({}).ok, false);
});

test('propose: profile 品目は請求単位売価を出さない', () => {
  const r = C.propose({ cost: 2400, units: UG, billIdx: 0, billType: 'profile', m1000: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.unitPrice10, 60);                        /* 6.0円/g */
  assert.equal(r.billPrice, null);
});

test('costPer / belowCost: 原価の段別表示と原価割れ', () => {
  assert.equal(C.costPer({ cost: 4800, units: U3, idx: 0 }), 4800);
  assert.equal(C.costPer({ cost: 4800, units: U3, idx: 1 }), 1200);
  assert.equal(C.costPer({ cost: 4800, units: U3, idx: 2 }), 40);
  assert.equal(C.costPer({ cost: 4800, units: U3, idx: 5 }), null);

  assert.equal(C.belowCost({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', billPrice: 1100 }), true);
  assert.equal(C.belowCost({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', billPrice: 1200 }), false);
  assert.equal(C.belowCost({ cost: 100, units: U1, billIdx: 0, billType: 'unit', unitPrice10: 990 }), true);
  assert.equal(C.belowCost({ cost: 100, units: U1, billIdx: 0, billType: 'unit', unitPrice10: 1000 }), false);
  assert.equal(C.belowCost({ cost: 100, units: U1, billIdx: 0 }), false);   /* 材料不足は赤にしない */
  /* 売価 0 円は最も明確な原価割れ。0 を「材料不足」と同じ扱いにしない */
  assert.equal(C.belowCost({ cost: 100, units: U1, billIdx: 0, billType: 'unit', billPrice: 0 }), true);
  assert.equal(C.belowCost({ cost: 100, units: U1, billIdx: 0, billType: 'unit', unitPrice10: 0 }), true);
  assert.equal(C.belowCost({ cost: 4800, units: U3, billIdx: 1, billType: 'unit', billPrice: 0 }), true);
});

/* ── 価格台帳の読み方 ──────────────────────────────────────────── */

const P1 = { id: 'pr_1', effDate: '2026-06-01', cost: 4500, unitPrice10: 470, billPrice: 1410, createdAt: '2026-05-20T10:00:00+09:00' };
const P2 = { id: 'pr_2', effDate: '2026-09-01', cost: 4800, unitPrice10: 500, billPrice: 1500, createdAt: '2026-08-20T10:00:00+09:00' };
const P3 = { id: 'pr_3', effDate: '2026-10-01', cost: 5000, unitPrice10: 520, billPrice: 1560, createdAt: '2026-09-10T10:00:00+09:00' };
const PV = { id: 'pr_4', effDate: '2026-09-15', cost: 4900, unitPrice10: 510, billPrice: 1530, createdAt: '2026-09-14T10:00:00+09:00', voided: true };
const PRICES = [P1, P2, P3, PV];

test('currentPrice: 現在・直前・予定・最新行id', () => {
  const r = C.currentPrice(PRICES, '2026-09-17');
  assert.equal(r.current.id, 'pr_2');
  assert.equal(r.previous.id, 'pr_1');
  assert.deepEqual(r.scheduled.map((p) => p.id), ['pr_3']);
  assert.equal(r.latestPriceId, 'pr_3');            /* voided を除く createdAt 最大 */
});

test('currentPrice: 同じ effDate は createdAt が後の行が勝つ', () => {
  const later = { id: 'pr_5', effDate: '2026-09-01', cost: 4850, unitPrice10: 505, billPrice: 1515, createdAt: '2026-08-25T09:00:00+09:00' };
  const r = C.currentPrice([P1, P2, later], '2026-09-17');
  assert.equal(r.current.id, 'pr_5');
  assert.equal(r.previous.id, 'pr_1');              /* 同日の pr_2 は「直前」ではない */
});

test('currentPrice: createdAt が同じ秒なら「後の行」が最新（サーバーと同じ裁定）', () => {
  /* 秒精度なので、同じ秒に2件作ると createdAt では決まらない。行番号の後ろを採る */
  const sameSec = '2026-09-17T10:12:00+09:00';
  const a = { id: 'pr_2', effDate: '2026-10-01', cost: 4800, unitPrice10: 500, billPrice: 1500, createdAt: sameSec };
  const b = { id: 'pr_3', effDate: '2026-09-17', cost: 4900, unitPrice10: 510, billPrice: 1530, createdAt: sameSec };
  assert.equal(C.currentPrice([a, b], '2026-09-17').latestPriceId, 'pr_3');
  assert.equal(C.currentPrice([b, a], '2026-09-17').latestPriceId, 'pr_2');
});

test('currentPrice: 有効行が無ければ空で返す（例外を投げない）', () => {
  assert.deepEqual(C.currentPrice([], '2026-09-17'),
    { current: null, previous: null, scheduled: [], latestPriceId: '' });
  assert.deepEqual(C.currentPrice(null, '2026-09-17'),
    { current: null, previous: null, scheduled: [], latestPriceId: '' });
  const only = C.currentPrice([PV], '2026-09-17');
  assert.equal(only.current, null);
  assert.equal(only.latestPriceId, '');
  const future = C.currentPrice([P3], '2026-09-17');
  assert.equal(future.current, null);
  assert.equal(future.latestPriceId, 'pr_3');
});

test('priceAt: その日付で有効な行（取り消し行は無視）', () => {
  assert.equal(C.priceAt(PRICES, '2026-06-15').id, 'pr_1');
  assert.equal(C.priceAt(PRICES, '2026-09-01').id, 'pr_2');
  assert.equal(C.priceAt(PRICES, '2026-09-16').id, 'pr_2');   /* pr_4 は voided */
  assert.equal(C.priceAt(PRICES, '2026-10-05').id, 'pr_3');
  assert.equal(C.priceAt(PRICES, '2026-05-31'), null);
  assert.equal(C.priceAt(PRICES, '2026-13-01'), null);
});

test('changeRatio: 前回比は変化率の千分率（符号つき）', () => {
  assert.deepEqual(C.changeRatio(P2, P1), { cost: 67, price: 64 });
  assert.deepEqual(C.changeRatio(P1, P1), { cost: 0, price: 0 });
  assert.deepEqual(C.changeRatio({ cost: 4000, billPrice: 1200 }, { cost: 5000, billPrice: 1500 }),
    { cost: -200, price: -200 });
  /* 請求単位売価が無い品目は最小単位売価で比べる */
  assert.deepEqual(C.changeRatio({ cost: 110, unitPrice10: 520, billPrice: null },
    { cost: 100, unitPrice10: 500, billPrice: null }), { cost: 100, price: 40 });
  assert.deepEqual(C.changeRatio(P2, null), { cost: null, price: null });
  assert.deepEqual(C.changeRatio({ cost: 100 }, { cost: 0 }), { cost: null, price: null });
});

/* ── 数量の換算 ────────────────────────────────────────────────── */

test('convertQty: 各段の入力を最小単位の整数に直す', () => {
  assert.equal(C.convertQty({ units: U3, unitIdx: 0, qtyEntered: 1 }), 120);
  assert.equal(C.convertQty({ units: U3, unitIdx: 1, qtyEntered: 2 }), 60);
  assert.equal(C.convertQty({ units: U3, unitIdx: 2, qtyEntered: 7 }), 7);
  assert.equal(C.convertQty({ units: U7, unitIdx: 0, qtyEntered: 3 }), 21);
  assert.equal(C.convertQty({ units: U3, unitIdx: 1, qtyEntered: 0 }), 0);
  assert.equal(C.convertQty({ units: U3, unitIdx: 1, qtyEntered: 1.5 }), null);
  assert.equal(C.convertQty({ units: U3, unitIdx: 1, qtyEntered: -1 }), null);
  assert.equal(C.convertQty({ units: U3, unitIdx: 3, qtyEntered: 1 }), null);
  assert.equal(C.convertQty({ units: U3, unitIdx: 1, qtyEntered: '2' }), null);
});

test('qtyBillOf: 請求単位の数量（下の段からは作れない）', () => {
  assert.equal(C.qtyBillOf({ units: U3, billIdx: 1, unitIdx: 0, qtyEntered: 1 }), 4);   /* 1箱＝4パック */
  assert.equal(C.qtyBillOf({ units: U3, billIdx: 1, unitIdx: 1, qtyEntered: 3 }), 3);
  assert.equal(C.qtyBillOf({ units: U3, billIdx: 1, unitIdx: 2, qtyEntered: 30 }), null); /* 枚では出庫できない */
  assert.equal(C.qtyBillOf({ units: U3, billIdx: 2, unitIdx: 2, qtyEntered: 30 }), 30);
  assert.equal(C.qtyBillOf({ units: U3, billIdx: 1, unitIdx: 0, qtyEntered: 1.5 }), null);
});

test('qtyBill: 入数を変えた改定をまたいでも、保存済みの qtyBill で付け直す', () => {
  const U3new = [{ name: '箱' }, { name: 'パック', per: 5 }, { name: '枚', per: 30 }];
  /* 登録時（1箱＝4パック）に確定した qtyBill は 4 */
  const saved = C.qtyBillOf({ units: U3, billIdx: 1, unitIdx: 0, qtyEntered: 1 });
  assert.equal(saved, 4);
  /* 入数が 5 に変わった後で qtyEntered から作り直すと 5 になってしまう＝使ってはいけない */
  assert.equal(C.qtyBillOf({ units: U3new, billIdx: 1, unitIdx: 0, qtyEntered: 1 }), 5);
  /* 付け直しは保存済み qtyBill × 新しい請求単位売価 */
  assert.equal(C.unitAmount({ units: U3new, billIdx: 1, qtyBill: saved, billPrice: 1600 }), 6400);
});

test('unitAmount: 請求単位が上の段なら数量×売価・最小単位なら 0.1円から丸める', () => {
  assert.equal(C.unitAmount({ units: U3, billIdx: 1, qtyBill: 2, billPrice: 1500 }), 3000);
  assert.equal(C.unitAmount({ units: U3, billIdx: 2, qty: 25, unitPrice10: 505 }), 1263); /* 1262.5 → 1263 */
  assert.equal(C.unitAmount({ units: U3, billIdx: 2, qty: -25, unitPrice10: 505 }), -1263); /* 台帳の符号つき */
  assert.equal(C.unitAmount({ units: U3, billIdx: 1, qtyBill: null, billPrice: 1500 }), null);
  assert.equal(C.unitAmount({ units: U3, billIdx: 9, qtyBill: 1, billPrice: 1500 }), null);
});

/* ── profile（月額） ───────────────────────────────────────────── */

test('profileQtyAmount: 2.5g×3回×31日（小数の1回量）', () => {
  const r = C.profileQtyAmount({ dose10: 25, timesPerDay: 3, days: 31, unitPrice10: 20 });
  assert.deepEqual(r, { qty: 233, amount: 465 });          /* 232.5g → 233g・465円 */
  const noPrice = C.profileQtyAmount({ dose10: 25, timesPerDay: 3, days: 31 });
  assert.deepEqual(noPrice, { qty: 233, amount: null });
  assert.equal(C.profileQtyAmount({ dose10: -1, timesPerDay: 3, days: 31 }), null);
  assert.equal(C.profileQtyAmount({ dose10: 2.5, timesPerDay: 3, days: 31 }), null);
});

test('profileMonthly / defaultProfile: 既定日数の月額', () => {
  const pf = { id: 'pf_1', name: '標準', dose10: 30, timesPerDay: 3, daysPerMonth: 30, isDefault: true };
  assert.deepEqual(C.profileMonthly(pf, { unitPrice10: 20 }), { qty: 270, amount: 540 });
  assert.equal(C.profileMonthly(pf, null), null);          /* 価格が無ければ null */
  assert.equal(C.profileMonthly(null, { unitPrice10: 20 }), null);
  /* daysPerMonth が壊れていれば既定 30 日で計算する */
  assert.deepEqual(C.profileMonthly({ dose10: 30, timesPerDay: 3, daysPerMonth: 0 }, { unitPrice10: 20 }),
    { qty: 270, amount: 540 });

  const pf2 = { id: 'pf_2', name: '多め', dose10: 40, timesPerDay: 3, daysPerMonth: 30, isDefault: false };
  assert.equal(C.defaultProfile([pf2, pf]).id, 'pf_1');
  assert.equal(C.defaultProfile([pf2]).id, 'pf_2');        /* isDefault が無ければ先頭 */
  assert.equal(C.defaultProfile([]), null);
  assert.equal(C.defaultProfile(null), null);
});

/* ── 在庫（棚卸を錨にする） ────────────────────────────────────── */

const ITEM_FULL = { id: 'it_0001', units: U3, billIdx: 1, billType: 'unit', stockMode: 'full', reorderPoint: 4 };
/* 追記順（＝シートの行番号順）。out の qty は負で入っている */
const MOVES = [
  { id: 'mv_a', itemId: 'it_0001', type: 'in', date: '2026-09-01', qty: 240, createdAt: '2026-09-01T09:00:00+09:00' },
  { id: 'mv_b', itemId: 'it_0001', type: 'out', date: '2026-09-03', qty: -30, createdAt: '2026-09-03T09:00:00+09:00' },
  { id: 'mv_c', itemId: 'it_0001', type: 'count', date: '2026-09-05', qty: 200, createdAt: '2026-09-05T09:00:00+09:00' },
  { id: 'mv_d', itemId: 'it_0001', type: 'out', date: '2026-09-06', qty: -30, createdAt: '2026-09-06T09:00:00+09:00' },
  { id: 'mv_e', itemId: 'it_0001', type: 'out', date: '2026-09-02', qty: -30, createdAt: '2026-09-07T09:00:00+09:00' },
  { id: 'mv_f', itemId: 'it_0001', type: 'out', date: '2026-09-05', qty: -30, createdAt: '2026-09-07T10:00:00+09:00' },
  { id: 'mv_g', itemId: 'it_0001', type: 'in', date: '2026-09-07', qty: 120, createdAt: '2026-09-07T11:00:00+09:00' },
  { id: 'mv_h', itemId: 'it_0001', type: 'out', date: '2026-09-08', qty: -60, createdAt: '2026-09-08T09:00:00+09:00', voided: true }
];

test('stockOf: 棚卸より前の行は効かず、棚卸日と同日でも棚卸より後に入れた行は効く', () => {
  const r = C.stockOf(MOVES, ITEM_FULL);
  /* 200（棚卸）− 30（9/6）− 30（9/5・棚卸の後に追記）＋ 120（9/7）＝ 260。
     mv_a・mv_b は棚卸より前・mv_e は遡り日付・mv_h は取り消し済みで効かない */
  assert.equal(r.qty, 260);
  assert.deepEqual(r.lastCount, {
    date: '2026-09-05', createdAt: '2026-09-05T09:00:00+09:00', rowIndex: 2
  });
});

test('stockOf: stockMode=countOnly は出庫を数えない', () => {
  const r = C.stockOf(MOVES, Object.assign({}, ITEM_FULL, { stockMode: 'countOnly' }));
  assert.equal(r.qty, 320);                                /* 200 ＋ 120（入庫だけ） */
  assert.equal(r.lastCount.date, '2026-09-05');
});

test('stockOf: 棚卸が無い品目は全件を足し引きする', () => {
  const noCount = MOVES.filter((m) => m.type !== 'count');
  const r = C.stockOf(noCount, ITEM_FULL);
  assert.equal(r.qty, 240);                                /* 240−30−30−30−30＋120（取り消し行は除く） */
  assert.equal(r.lastCount, null);
});

test('stockOf: 他品目の行・壊れた行・空配列に耐える', () => {
  const mixed = MOVES.concat([
    { id: 'mv_x', itemId: 'it_0002', type: 'out', date: '2026-09-09', qty: -500 },
    null,
    { id: 'mv_y', itemId: 'it_0001', type: 'out', date: '2026-09-09', qty: 'abc' }
  ]);
  assert.equal(C.stockOf(mixed, ITEM_FULL).qty, 260);
  assert.deepEqual(C.stockOf([], ITEM_FULL), { qty: 0, lastCount: null });
  assert.deepEqual(C.stockOf(null, ITEM_FULL), { qty: 0, lastCount: null });
});

test('reorderState: 発注点は unit なら請求単位・profile なら基準単位で比べる', () => {
  assert.equal(C.reorderState(ITEM_FULL, { qty: 260 }), 'ok');    /* 発注点4パック＝120枚 */
  assert.equal(C.reorderState(ITEM_FULL, { qty: 120 }), 'low');   /* 以下なら low */
  assert.equal(C.reorderState(ITEM_FULL, 90), 'low');             /* 数値でも受ける */
  assert.equal(C.reorderState(Object.assign({}, ITEM_FULL, { reorderPoint: 0 }), { qty: 10 }), 'unknown');
  assert.equal(C.reorderState(ITEM_FULL, { qty: null }), 'unknown');
  const pf = { id: 'it_0002', units: UG, billType: 'profile', reorderPoint: 2 };
  assert.equal(C.reorderState(pf, { qty: 1200 }), 'ok');          /* 発注点2缶＝1000g */
  assert.equal(C.reorderState(pf, { qty: 1000 }), 'low');
});

/* ── 月次集計・CSV ─────────────────────────────────────────────── */

const ITEMS = [
  { id: 'it_1', name: 'テスト品A', units: U3, billIdx: 1, billType: 'unit', taxRate: 10 },
  { id: 'it_2', name: 'テスト品B', units: UG, billIdx: 0, billType: 'profile', taxRate: 8 }
];
const ROSTER = [{ masterId: 12, name: 'テスト利用者A' }, { masterId: 7, name: 'テスト利用者B' }];
const OUT_MOVES = [
  { id: 'mv_1', type: 'out', date: '2026-09-03', itemId: 'it_1', residentId: '12', qtyBill: 2, qty: -60, amount: 3000 },
  { id: 'mv_2', type: 'out', date: '2026-09-10', itemId: 'it_1', residentId: '12', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'mv_3', type: 'out', date: '2026-09-11', itemId: 'it_1', residentId: '12', qtyBill: 1, qty: -30, amount: 1500, voided: true },
  { id: 'mv_4', type: 'out', date: '2026-09-30', itemId: 'it_2', residentId: '7', qty: -270, dose10: 30, timesPerDay: 3, days: 30, amount: 540 },
  { id: 'mv_5', type: 'out', date: '2026-09-05', itemId: 'it_1', residentId: '', qtyBill: 1, qty: -30, amount: 1500 },
  { id: 'mv_6', type: 'in', date: '2026-09-02', itemId: 'it_1', qty: 240, costEntered: 4800 }
];

test('aggregateMonth: 取り消し・入庫を除き、利用者No×品目でまとめる', () => {
  const rows = C.aggregateMonth({ moves: OUT_MOVES, items: ITEMS, prices: {}, roster: ROSTER });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    residentId: '7', name: 'テスト利用者B', itemId: 'it_2', itemName: 'テスト品B',
    billType: 'profile', qtyBill: null, qty: 270, unitName: 'g', amount: 540, taxRate: 8
  });
  assert.deepEqual(rows[1], {
    residentId: '12', name: 'テスト利用者A', itemId: 'it_1', itemName: 'テスト品A',
    billType: 'unit', qtyBill: 3, qty: 90, unitName: 'パック', amount: 4500, taxRate: 10
  });
  assert.deepEqual(rows[2], {
    residentId: '', name: '（提供先なし）', itemId: 'it_1', itemName: 'テスト品A',
    billType: 'unit', qtyBill: 1, qty: 30, unitName: 'パック', amount: 1500, taxRate: 10
  });
});

test('aggregateMonth: 名簿が無ければ氏名は空のまま（利用者Noは残す）', () => {
  const rows = C.aggregateMonth({ moves: OUT_MOVES, items: ITEMS, roster: [] });
  assert.equal(rows[0].name, '');
  assert.equal(rows[1].name, '');
  assert.equal(rows[2].name, '（提供先なし）');
  /* 名簿は {residents:[…]} の形でも読む */
  const rows2 = C.aggregateMonth({ moves: OUT_MOVES, items: ITEMS, roster: { residents: ROSTER } });
  assert.equal(rows2[1].name, 'テスト利用者A');
});

test('aggregateMonth: amount が欠けた行は date 時点の価格で埋める', () => {
  const moves = [{ id: 'mv_9', type: 'out', date: '2026-09-10', itemId: 'it_1', residentId: '12', qtyBill: 2, qty: -60 }];
  const rows = C.aggregateMonth({ moves: moves, items: ITEMS, prices: { it_1: [P1, P2] }, roster: ROSTER });
  assert.equal(rows[0].amount, 3000);                      /* 9/10 は pr_2（1500円/パック） */
  const rows2 = C.aggregateMonth({ moves: moves, items: ITEMS, prices: {}, roster: ROSTER });
  assert.equal(rows2[0].amount, 0);                        /* 価格も無ければ 0 のまま（推測しない） */
});

test('aggregateMonth: 読みのある名簿では五十音順に並ぶ（CSV も同じ順）', () => {
  /* 読みは架空。利用者Noの順（7→12）ではなく読みの順（12→7）になることを見る */
  const kroster = [
    { masterId: 12, name: 'テスト利用者A', kana: 'あさひ てすと' },
    { masterId: 7, name: 'テスト利用者B', kana: 'わかば てすと' }
  ];
  const rows = C.aggregateMonth({ moves: OUT_MOVES, items: ITEMS, prices: {}, roster: kroster });
  assert.deepEqual(rows.map(function (r) { return r.residentId; }), ['12', '7', '']);
  const lines = C.toCsv(rows).split('\r\n');
  assert.equal(lines[1].indexOf('"12"'), 0);
  assert.equal(lines[2].indexOf('"7"'), 0);
});

test('aggregateMonth: 空入力でも落ちない', () => {
  assert.deepEqual(C.aggregateMonth({}), []);
  assert.deepEqual(C.aggregateMonth(null), []);
});

test('toCsv: BOM・CRLF・見出し・引用符の二重化', () => {
  const rows = C.aggregateMonth({ moves: OUT_MOVES, items: ITEMS, roster: ROSTER });
  const csv = C.toCsv(rows);
  assert.ok(csv.charCodeAt(0) === 0xfeff, 'BOM が無い');
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿"利用者No","氏名","品目","数量","単位","金額","方式","税率"');
  /* 数量は unit なら請求単位（パック）・profile なら最小単位（g） */
  assert.equal(lines[1], '"7","テスト利用者B","テスト品B","270","g","540","profile","8"');
  assert.equal(lines[2], '"12","テスト利用者A","テスト品A","3","パック","4500","unit","10"');
  assert.equal(lines[3], '"","（提供先なし）","テスト品A","1","パック","1500","unit","10"');
  assert.equal(lines[4], '');                              /* 最終行も CRLF で終わる */

  const esc = C.toCsv([{ residentId: '1', name: 'テスト利用者C', itemName: 'テスト品"D",1号', qtyBill: null, qty: 2, unitName: '本', amount: 100, billType: 'unit', taxRate: 10 }]);
  assert.ok(esc.indexOf('"テスト品""D"",1号"') > 0, '引用符が二重化されていない');
  assert.equal(C.toCsv([]).split('\r\n').length, 2);       /* 見出しだけ */
  assert.equal(C.toCsv(null).split('\r\n').length, 2);
});

/* ── 日付 ──────────────────────────────────────────────────────── */

test('today: JST の YYYY-MM-DD を返す', () => {
  const t = C.today();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(C.isYmd(t), true);
});

test('isYmd: 書式と実在する日付だけ true', () => {
  assert.equal(C.isYmd('2026-09-17'), true);
  assert.equal(C.isYmd('2024-02-29'), true);
  assert.equal(C.isYmd('2026-02-30'), false);
  assert.equal(C.isYmd('2026-13-01'), false);
  assert.equal(C.isYmd('2026/09/17'), false);
  assert.equal(C.isYmd(''), false);
  assert.equal(C.isYmd(null), false);
});

test('monthRange / prevMonth: 月の初日と末日・前月', () => {
  assert.deepEqual(C.monthRange('2026-09'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(C.monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(C.monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(C.monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(C.monthRange('2026-13'), null);
  assert.equal(C.monthRange('2026-9'), null);
  assert.equal(C.monthRange(null), null);
  assert.equal(C.prevMonth('2026-09'), '2026-08');
  assert.equal(C.prevMonth('2026-01'), '2025-12');
  assert.equal(C.prevMonth('2026-13'), null);
  assert.equal(C.prevMonth(''), null);
});

/* ── CSV の数式対策（2026-09-23）: 文字の列は = + - @ タブ CR 始まりに ' を前置。数値の列（数量・金額・税率）は触らない ── */
test('toCsv: 利用者名・品目名が数式にならない／数値の列はそのまま', () => {
  const csv = C.toCsv([{ residentId: '=1', name: '=HYPERLINK("http://x","y")', itemName: '-テスト品', qtyBill: null, qty: -2, unitName: '@本', amount: -300, billType: 'unit', taxRate: 10 }]);
  const line = csv.split('\r\n')[1];
  assert.equal(line, '"\'=1","\'=HYPERLINK(""http://x"",""y"")","\'-テスト品","-2","\'@本","-300","unit","10"');
});
