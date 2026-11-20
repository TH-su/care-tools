/* kintai-ledger.js — 年次有給休暇管理簿の行を作る純関数（2026-11-20 新設・総点検）
 *
 * 労基則24条の7 の管理簿（時季＝取得した日・日数・基準日）を、有給の計算（kintai-leave.js の summary の lots と使用）から1人分ずつ作る。
 * ・基準日ごと（付与日から次の付与日の前日まで。最後の付与は1年後の前日まで）に、その間に取った日と日数・その期間の終わり（今日より先なら今日）の残りを並べる
 * ・残りは kintai-leave.js の balance をそのまま使う（数え方を二つに分けない）
 * ・移行の残り（kind 'opening'）は「移行の残り」として先頭に出す（その前の取得の記録は無い）
 * ・この先の予定（今日より後の使用）は「予定」として別に数える（取った日には入れない）
 * ・時間単位の有休（v5 段4・src 'hourly'）は、同じ日の1日・半日と別の行にし（hourly: true・minutes）、取った日数（takenDays）には入れず takenHourMin（分）に数える。
 *   残りは kintai-leave.js の balance のまま（時間単位の分を日数に直して引いた値）
 * ・画面・印刷・通信を持たない。氏名は持たない（呼ぶ側が見出しに付ける）。試験は check/unit/kintai_ledger_test.js
 */
(function (root) {
  'use strict';
  var L = typeof require === 'function' && typeof module !== 'undefined' ? require('./kintai-leave.js') : root.KintaiLeave;

  function half(n) { return Math.round(n * 2) / 2; }
  function cleanUses(uses) {
    var by = {};
    (uses || []).forEach(function (u) {
      if (!u || u.voided_at || !L.isDate(u.use_date)) return;
      var d = +u.days;
      if (!(d > 0)) return;
      /* 時間単位は同じ日の1日・半日と鍵を分ける（上書きし合わない・v5 段4） */
      if (u.src === 'hourly') { var mn = +u.minutes; if (!(mn > 0)) return; by[u.use_date + '|h'] = { date: u.use_date, days: d, minutes: mn, hourly: true }; return; }
      by[u.use_date] = { date: u.use_date, days: d === 0.5 ? 0.5 : d >= 1 ? 1 : d };
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  /* o: { lots: summary の lots, uses: その人の使用（usesFromMonth で合わせたもの）, asOf: 'YYYY-MM-DD', openingDate: 移行日 or null }
     → { rows: [{ base, kind, days, expires, until, taken: [{date, days, hourly?, minutes?}], takenDays, takenHourMin, planned: [{date, days}], remain }], takenTotal, takenHourTotal } */
  function ledgerOf(o) {
    var asOf = o && o.asOf, rows = [], all = cleanUses(o && o.uses), open = o && L.isDate(o.openingDate) ? o.openingDate : null;
    if (!L.isDate(asOf)) return { rows: rows, takenTotal: 0, takenHourTotal: 0 };
    var lots = (o.lots || []).filter(function (g) { return g && !g.voided_at && L.isDate(g.grant_date) && +g.days > 0 && g.grant_date <= asOf; })
      .slice().sort(function (a, b) { return a.grant_date < b.grant_date ? -1 : a.grant_date > b.grant_date ? 1 : (a.kind === 'opening' ? -1 : b.kind === 'opening' ? 1 : 0); });
    /* 基準日（同じ日の付与は1つの基準日にまとめる＝移行の残りと自動の付与が同じ日の時など）。
       反証レビュー（2026-11-20）: 基準日は自動の付与日と移行の残りの付与日だけ。手で足した付与（manual）は基準日にせず、その日を含む前の基準日の行の付与日数に足す
       （前に基準日が無い時だけ、その付与日を基準日にする） */
    var bases = [];
    lots.forEach(function (g) {
      var last = bases[bases.length - 1];
      if (last && (last.base === g.grant_date || g.kind === 'manual')) { last.days = half(last.days + (+g.days)); if (last.base === g.grant_date && g.kind === 'auto') last.kind = 'auto'; if (g.expires > last.expires) last.expires = g.expires; return; }
      bases.push({ base: g.grant_date, kind: g.kind || 'manual', days: +g.days, expires: g.expires || L.expiresOf(g.grant_date) });
    });
    var takenTotal = 0, takenHourTotal = 0;
    bases.forEach(function (b, i) {
      var nextBase = bases[i + 1] ? bases[i + 1].base : null;
      var until = nextBase ? L.addDays(nextBase, -1) : L.addDays(L.addMonths(b.base, 12), -1);
      var from = b.base < (open || '') ? open : b.base;   /* 移行日より前の使用は記録に無い（数えない） */
      var taken = [], planned = [];
      all.forEach(function (u) {
        if (u.date < from || u.date > until) return;
        if (u.date > asOf) planned.push(u); else taken.push(u);
      });
      var td = half(taken.reduce(function (a, u) { return a + (u.hourly ? 0 : u.days); }, 0));
      var th = taken.reduce(function (a, u) { return a + (u.hourly ? u.minutes : 0); }, 0);
      takenTotal = half(takenTotal + td); takenHourTotal += th;
      var end = until < asOf ? until : asOf;
      var bal = L.balance(o.lots, o.uses, end, { openingDate: open });
      rows.push({ base: b.base, kind: b.kind, days: b.days, expires: b.expires, until: until, taken: taken, takenDays: td, takenHourMin: th, planned: planned, remain: bal.remain });
    });
    return { rows: rows, takenTotal: takenTotal, takenHourTotal: takenHourTotal };
  }

  var api = { ledgerOf: ledgerOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiLedger = api;
})(this);
