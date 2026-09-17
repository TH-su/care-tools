/* supplies-calc.js — 消耗品管理（supplies.html／gas/supplies-api.gs）の計算層
   ─────────────────────────────────────────────────────────────────────
   役割（凍結API `.claude/plans/supplies-L0-api-freeze.md` §2）
     ・単位チェーン（箱→パック→枚・最大3段）の換算、価格の提案・導出・逆算、
       請求額、在庫（棚卸を錨にした現在庫）、月次集計と CSV、日付の下ごしらえ
     ・金額は整数円（税込）、最小単位売価は 0.1 円単位の整数 `unitPrice10`、
       値入率は千分率の整数 `m1000`、1回量は 0.1 最小単位の整数 `dose10`
     ・**浮動小数で丸めない**。割り算はすべて roundDiv（整数の商と余りで判定）を通す
       （1.1*100 が 110.00000000000001 になる類の罠を踏まないため）
   公開API（凍結。名前・引数・戻り値を変えない）
     SuppliesCalc.VERSION
     factor / minIdx / ratioR / validateUnits / splitQty
     roundDiv
     propose / deriveBill / refUnit / effMarkup / costPer / belowCost
     currentPrice / priceAt / changeRatio
     convertQty / qtyBillOf / unitAmount / profileQtyAmount / profileMonthly / defaultProfile
     stockOf / reorderState
     aggregateMonth / toCsv
     today / monthRange / prevMonth / isYmd
   前提・注意
     ・依存ゼロ。ブラウザ（iPad Safari）と node の両方で動く。ES2018 以下の構文だけ
     ・純関数。例外を投げない（不正入力は null または {ok:false, error}）
     ・console 呼び出しをこのファイルに置かない（個人情報がログに出る経路を作らない）
     ・氏名は持たない。集計の氏名は呼び手が渡す名簿（roster）で解決するだけで、
       このモジュールが保存・記憶することはない
   実装上の取り決め（凍結仕様に明記が無く、ここで決めたもの。見直す時は仕様側を先に直す）
     ・roundDiv の mode が 'round'|'ceil'|'floor' 以外なら 'round' として扱う
     ・負の被除数は「絶対値で丸めてから符号を戻す」（出庫 qty が負で入ってくる経路のため）。
       公開している roundDiv も内部の signedDiv も同じ裁定＝GAS の roundDiv_ と一致させる
     ・単位名は UNIT_NAME_MAX（12字）まで。validateUnits が 'too_long' で報せる（サーバーと同値）
     ・changeRatio の前回比は**変化率**（(今回−前回)÷前回 の千分率・符号つき）。
       据え置きは 0、1割高は +100
     ・aggregateMonth の並びは 利用者No 昇順（数値優先）→ 提供先なしを最後 → 品目名 → 品目id
     ・aggregateMonth は moves.amount を正とし、欠けている行だけ prices から解決する
     ・validateUnits は units[0] に per が付いていることを issue として報告するが、
       factor/ratioR は units[0].per を無視して換算する（サーバー由来の余分な値で
       画面全体が止まらないようにするため）
   ────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var VERSION = '2026-09-17.1';

  /* 単位名の字数上限。サーバー（gas/supplies-api.gs の UNIT_NAME_MAX）と同じ値。
     ここで too_long を報せないと、画面に理由が出ないまま bad_units で断られる */
  var UNIT_NAME_MAX = 12;

  var NO_RESIDENT = '（提供先なし）';
  var CSV_HEAD = ['利用者No', '氏名', '品目', '数量', '単位', '金額', '方式', '税率'];

  /* ── 素材の判定 ────────────────────────────────────────────────── */

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function str(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }

  function trim(s) {
    return str(s).replace(/^[\s　]+|[\s　]+$/g, '');
  }

  /* シート由来の真偽（true / 'TRUE' / 1）を吸収する。空・0・'false' は false */
  function isVoided(row) {
    var v = row ? row.voided : false;
    if (v === true || v === 1) return true;
    if (typeof v === 'string') return /^(true|1|yes)$/i.test(trim(v));
    return false;
  }

  /* ── 日付（すべて整数演算。new Date() のタイムゾーンずれを踏まない） ── */

  var RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  var RE_YM = /^(\d{4})-(\d{2})$/;

  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function lastDay(y, m) {
    if (m === 2) return isLeap(y) ? 29 : 28;
    if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
    return 31;
  }

  /* 'YYYY-MM-DD' → {y,m,d}。書式違い・実在しない日付は null */
  function ymd(s) {
    if (typeof s !== 'string') return null;
    var m = RE_ISO.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > lastDay(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  function isYmd(s) {
    return ymd(s) !== null;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /* 通日 → {y,m,d}（civil_from_days。staff-master-calc.js と同じ式） */
  function civilFromDays(z) {
    var zz = z + 719468;
    var era = Math.floor(zz / 146097);
    var doe = zz - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  /* 今日（JST）。UTC の通日に +9 時間ぶんを足す＝端末のタイムゾーン設定に左右されない */
  function today() {
    var ms = Date.now() + 9 * 3600 * 1000;
    var o = civilFromDays(Math.floor(ms / 86400000));
    return o.y + '-' + pad2(o.m) + '-' + pad2(o.d);
  }

  /* 'YYYY-MM' → {from:'YYYY-MM-01', to:'YYYY-MM-末日'}。書式違いは null */
  function monthRange(ym) {
    if (typeof ym !== 'string') return null;
    var m = RE_YM.exec(ym);
    if (!m) return null;
    var y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return { from: y + '-' + pad2(mo) + '-01', to: y + '-' + pad2(mo) + '-' + pad2(lastDay(y, mo)) };
  }

  /* 'YYYY-MM' → 前月の 'YYYY-MM'。書式違いは null */
  function prevMonth(ym) {
    if (typeof ym !== 'string') return null;
    var m = RE_YM.exec(ym);
    if (!m) return null;
    var y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    mo -= 1;
    if (mo === 0) { mo = 12; y -= 1; }
    return y + '-' + pad2(mo);
  }

  /* ── 整数の割り算（丸めは3方式。ここだけが割り算をする） ───────── */

  function normMode(mode) {
    return (mode === 'ceil' || mode === 'floor') ? mode : 'round';
  }

  /* num/den を整数で割り、mode で丸めた整数を返す。den≤0・非整数は null。
     商と余りだけで判定するので浮動小数の誤差が結果に混ざらない。
     'round' は余りが半分以上で切り上げ（正数での四捨五入）。
     負の num は「絶対値で丸めてから符号を戻す」（GAS roundDiv_ と同じ裁定。
     二重実装の食い違いを作らないため。floor/ceil も 0 に近い側・遠い側で対称になる） */
  function roundDiv(num, den, mode) {
    if (!isInt(num) || !isInt(den) || den <= 0) return null;
    var neg = num < 0;
    var a = neg ? -num : num;
    var q = Math.floor(a / den);
    var r = a - q * den;
    if (r < 0) { q -= 1; r += den; }          /* 大きな値で商が1ずれた時の補正 */
    else if (r >= den) { q += 1; r -= den; }
    var m = normMode(mode);
    if (r !== 0) {
      if (m === 'ceil') q += 1;
      else if (m !== 'floor' && r * 2 >= den) q += 1;
    }
    return neg ? -q : q;
  }

  /* 負の被除数は絶対値で丸めてから符号を戻す（出庫 qty が負で入る経路のため）。
     roundDiv が同じ裁定になったので結果は一致する。呼び手の意図を残すために置いている */
  function signedDiv(num, den, mode) {
    if (!isInt(num)) return null;
    if (num >= 0) return roundDiv(num, den, mode);
    var v = roundDiv(-num, den, mode);
    return v === null ? null : -v;
  }

  /* ── 単位チェーン ──────────────────────────────────────────────── */

  /* 換算に使える形か（1〜3段・2段目以降に per が1以上の整数で入っている） */
  function chainOk(units) {
    if (!Array.isArray(units) || units.length === 0 || units.length > 3) return false;
    if (!units[0] || typeof units[0] !== 'object') return false;
    for (var i = 1; i < units.length; i++) {
      var u = units[i];
      if (!u || typeof u !== 'object') return false;
      if (!isInt(u.per) || u.per < 1) return false;
    }
    return true;
  }

  /* 基準単位1つに含まれる units[k] の個数（Π per[1..k]）。factor(units,0)=1 */
  function factor(units, k) {
    if (!chainOk(units)) return null;
    if (!isInt(k) || k < 0 || k > units.length - 1) return null;
    var f = 1;
    for (var i = 1; i <= k; i++) f *= units[i].per;
    return f;
  }

  /* 最小単位（チェーン末尾）の添字 */
  function minIdx(units) {
    return chainOk(units) ? units.length - 1 : null;
  }

  /* units[idx] 1つに含まれる最小単位の数（R）。billIdx=0 なら基準単位あたり */
  function ratioR(units, billIdx) {
    var mi = minIdx(units);
    if (mi === null) return null;
    var fb = factor(units, billIdx);
    var fm = factor(units, mi);
    if (fb === null || fm === null || fb <= 0) return null;
    var r = fm / fb;
    return isInt(r) ? r : null;
  }

  /* 入力チェック。issues が空なら正常。key は欄を指す文字列 */
  function validateUnits(units) {
    var issues = [];
    if (!Array.isArray(units) || units.length === 0) {
      issues.push({ key: 'units', reason: 'empty' });
      return issues;
    }
    if (units.length > 3) issues.push({ key: 'units', reason: 'too_many' });
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u || typeof u !== 'object') {
        issues.push({ key: 'units.' + i, reason: 'type' });
        continue;
      }
      if (!trim(u.name)) issues.push({ key: 'units.' + i + '.name', reason: 'required' });
      else if (trim(u.name).length > UNIT_NAME_MAX) issues.push({ key: 'units.' + i + '.name', reason: 'too_long' });
      if (i === 0) {
        if (u.per !== undefined && u.per !== null && u.per !== '') {
          issues.push({ key: 'units.0.per', reason: 'unexpected' });
        }
      } else if (!isInt(u.per) || u.per < 1) {
        issues.push({ key: 'units.' + i + '.per', reason: 'range' });
      }
    }
    return issues;
  }

  /* 最小単位の数量を units[idx] と余りに割る。3段・qty=125・idx=1 → {major:4, rest:5} */
  function splitQty(units, qty, idx) {
    var r = ratioR(units, idx);
    if (r === null || !isInt(qty)) return null;
    var neg = qty < 0;
    var a = neg ? -qty : qty;
    var major = Math.floor(a / r);
    var rest = a - major * r;
    return neg ? { major: -major, rest: -rest } : { major: major, rest: rest };
  }

  /* ── 価格 ──────────────────────────────────────────────────────── */

  /* 仕入と値入率から売価の案を作る（改定行の提案）。
     unitPrice10 = roundDiv(cost*10*1000, F*(1000-m1000Used), mode)
     billPrice   = 請求単位が最小単位より上の unit 品目だけ導出（1円刻み） */
  function propose(o) {
    o = o || {};
    var units = o.units;
    var mi = minIdx(units);
    if (mi === null) return { ok: false, error: 'bad_input' };
    if (!isInt(o.cost) || o.cost < 0) return { ok: false, error: 'bad_input' };
    if (!isInt(o.m1000)) return { ok: false, error: 'bad_input' };
    if (o.m1000 >= 1000) return { ok: false, error: 'markup_range' };

    var isUnit = (o.billType === 'unit');
    if (isUnit && (!isInt(o.billIdx) || o.billIdx < 0 || o.billIdx > mi)) {
      return { ok: false, error: 'bad_input' };
    }

    var warnings = [];
    var used = o.m1000;
    if (used < 0) { used = 0; warnings.push('markup_negative'); }

    var mode = normMode(o.mode);
    var F = factor(units, mi);
    var up = roundDiv(o.cost * 10 * 1000, F * (1000 - used), mode);
    if (up === null) return { ok: false, error: 'bad_input' };

    var bp = null;
    if (isUnit && o.billIdx < mi) {
      var R = ratioR(units, o.billIdx);
      if (R === null) return { ok: false, error: 'bad_input' };
      bp = roundDiv(up * R, 10, mode);
    }
    return { ok: true, unitPrice10: up, billPrice: bp, m1000Used: used, warnings: warnings };
  }

  /* 最小単位売価 → 請求単位売価（1円）。billIdx が最小単位なら null（導出しない） */
  function deriveBill(o) {
    o = o || {};
    var mi = minIdx(o.units);
    if (mi === null) return null;
    if (!isInt(o.billIdx) || o.billIdx < 0 || o.billIdx > mi) return null;
    if (o.billIdx === mi) return null;
    if (!isInt(o.unitPrice10) || o.unitPrice10 < 0) return null;
    var R = ratioR(o.units, o.billIdx);
    if (R === null) return null;
    return roundDiv(o.unitPrice10 * R, 10, normMode(o.mode));
  }

  /* 請求単位売価から見た最小単位売価（円・小数可）。画面の「≒」参考表示だけに使う */
  function refUnit(o) {
    o = o || {};
    var R = ratioR(o.units, o.billIdx);
    if (R === null || !isNum(o.billPrice)) return null;
    return o.billPrice * 10 / R / 10;
  }

  /* 実効値入率（千分率・売価基準・負もある）。billPrice があればそちらが正 */
  function effMarkup(o) {
    o = o || {};
    var mi = minIdx(o.units);
    if (mi === null) return null;
    if (!isInt(o.cost) || o.cost < 0) return null;

    if (isInt(o.billPrice) && o.billPrice > 0) {
      var fb = factor(o.units, o.billIdx);
      if (fb === null) return null;
      var d1 = roundDiv(o.cost * 1000, fb * o.billPrice, 'round');
      return d1 === null ? null : 1000 - d1;
    }
    if (isInt(o.unitPrice10) && o.unitPrice10 > 0) {
      var F = factor(o.units, mi);
      var d2 = roundDiv(o.cost * 1000 * 10, F * o.unitPrice10, 'round');
      return d2 === null ? null : 1000 - d2;
    }
    return null;
  }

  /* units[idx] 1つあたりの原価（円・小数可・表示用） */
  function costPer(o) {
    o = o || {};
    var f = factor(o.units, o.idx);
    if (f === null || !isNum(o.cost)) return null;
    return o.cost / f;
  }

  /* 原価割れ（売価 < 原価）。判定材料が足りない時は false（赤を出さない）。
     売価 0 円は「最も明確な原価割れ」なので 0 も判定に進める（設計 §3-3） */
  function belowCost(o) {
    o = o || {};
    var mi = minIdx(o.units);
    if (mi === null) return false;
    if (!isInt(o.cost) || o.cost <= 0) return false;

    if (isInt(o.billPrice) && o.billPrice >= 0) {
      var fb = factor(o.units, o.billIdx);
      if (fb !== null) return o.billPrice * fb < o.cost;
    }
    if (isInt(o.unitPrice10) && o.unitPrice10 >= 0) {
      var F = factor(o.units, mi);
      return o.unitPrice10 * F < o.cost * 10;
    }
    return false;
  }

  /* 有効行（voided でなく effDate が読める）を effDate→createdAt→並び順で昇順に */
  function livePrices(prices) {
    var live = [];
    if (!Array.isArray(prices)) return live;
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i];
      if (!p || typeof p !== 'object') continue;
      if (isVoided(p)) continue;
      if (!isYmd(p.effDate)) continue;
      live.push({ row: p, i: i });
    }
    live.sort(function (a, b) {
      var ad = str(a.row.effDate), bd = str(b.row.effDate);
      if (ad !== bd) return ad < bd ? -1 : 1;
      var ac = str(a.row.createdAt), bc = str(b.row.createdAt);
      if (ac !== bc) return ac < bc ? -1 : 1;
      return a.i - b.i;
    });
    return live;
  }

  /* 現在価格・直前1件・予定行・最新行id。today を省くと当日（JST） */
  function currentPrice(prices, today_) {
    var out = { current: null, previous: null, scheduled: [], latestPriceId: '' };
    var t = isYmd(today_) ? today_ : today();
    var live = livePrices(prices);
    if (!live.length) return out;

    var curAt = -1, latest = null;
    for (var i = 0; i < live.length; i++) {
      var e = live[i], r = e.row;
      if (str(r.effDate) <= t) curAt = i;
      else out.scheduled.push(r);
      /* 最新行は createdAt が最大の行。同じ createdAt（秒までしか無い）なら「後の行」を採る＝
         サーバー currentPrice_ と同じ裁定にする（食い違うと expectLatestPriceId が永久に合わない） */
      if (!latest || str(r.createdAt) > str(latest.row.createdAt) ||
          (str(r.createdAt) === str(latest.row.createdAt) && e.i > latest.i)) latest = e;
    }
    if (curAt >= 0) {
      out.current = live[curAt].row;
      var curDate = str(out.current.effDate);
      for (var j = curAt - 1; j >= 0; j--) {
        if (str(live[j].row.effDate) < curDate) { out.previous = live[j].row; break; }
      }
    }
    out.latestPriceId = latest ? str(latest.row.id) : '';
    return out;
  }

  /* その日付で有効な価格行（無ければ null） */
  function priceAt(prices, date) {
    if (!isYmd(date)) return null;
    return currentPrice(prices, date).current;
  }

  /* 前回比＝変化率の千分率（符号つき）。据え置き 0・1割高 +100。比べられなければ null */
  function perMille(a, b) {
    if (!isInt(a) || !isInt(b) || b <= 0) return null;
    return signedDiv((a - b) * 1000, b, 'round');
  }

  function changeRatio(cur, prev) {
    var out = { cost: null, price: null };
    if (!cur || !prev) return out;
    out.cost = perMille(cur.cost, prev.cost);
    var useBill = isInt(cur.billPrice) && cur.billPrice > 0 && isInt(prev.billPrice) && prev.billPrice > 0;
    out.price = useBill
      ? perMille(cur.billPrice, prev.billPrice)
      : perMille(cur.unitPrice10, prev.unitPrice10);
    return out;
  }

  /* ── 数量・金額 ────────────────────────────────────────────────── */

  /* 入力した段の数量 → 最小単位の整数。非負整数でなければ null */
  function convertQty(o) {
    o = o || {};
    var R = ratioR(o.units, o.unitIdx);
    if (R === null) return null;
    if (!isInt(o.qtyEntered) || o.qtyEntered < 0) return null;
    return o.qtyEntered * R;
  }

  /* 入力した段の数量 → 請求単位の整数。請求単位より下の段は null（出庫の入口で弾く） */
  function qtyBillOf(o) {
    o = o || {};
    var mi = minIdx(o.units);
    if (mi === null) return null;
    if (!isInt(o.billIdx) || o.billIdx < 0 || o.billIdx > mi) return null;
    if (!isInt(o.unitIdx) || o.unitIdx < 0 || o.unitIdx > mi) return null;
    if (o.unitIdx > o.billIdx) return null;
    if (!isInt(o.qtyEntered) || o.qtyEntered < 0) return null;
    var fb = factor(o.units, o.billIdx);
    var fu = factor(o.units, o.unitIdx);
    if (fb === null || fu === null || fu <= 0) return null;
    var r = fb / fu;
    return isInt(r) ? o.qtyEntered * r : null;
  }

  /* unit 方式の請求額（整数円）。
     請求単位が最小単位より上: qtyBill × billPrice／最小単位そのもの: qty × unitPrice10 ÷ 10 */
  function unitAmount(o) {
    o = o || {};
    var mi = minIdx(o.units);
    if (mi === null) return null;
    if (!isInt(o.billIdx) || o.billIdx < 0 || o.billIdx > mi) return null;
    if (o.billIdx < mi) {
      if (!isInt(o.qtyBill) || !isInt(o.billPrice)) return null;
      return o.qtyBill * o.billPrice;
    }
    if (!isInt(o.qty) || !isInt(o.unitPrice10)) return null;
    return signedDiv(o.qty * o.unitPrice10, 10, 'round');
  }

  /* profile 方式: 1回量(0.1最小単位)×回数/日×日数 → 数量（最小単位）と請求額（円） */
  function profileQtyAmount(o) {
    o = o || {};
    if (!isInt(o.dose10) || o.dose10 < 0) return null;
    if (!isInt(o.timesPerDay) || o.timesPerDay < 0) return null;
    if (!isInt(o.days) || o.days < 0) return null;
    var total = o.dose10 * o.timesPerDay * o.days;          /* 0.1 最小単位 */
    var amount = null;
    if (isInt(o.unitPrice10) && o.unitPrice10 >= 0) {
      amount = roundDiv(total * o.unitPrice10, 100, 'round');
    }
    return { qty: roundDiv(total, 10, 'round'), amount: amount };
  }

  /* プロファイルの月額（既定日数で）。価格が無ければ null */
  function profileMonthly(profile, price) {
    if (!profile || typeof profile !== 'object') return null;
    if (!price || !isInt(price.unitPrice10)) return null;
    var days = (isInt(profile.daysPerMonth) && profile.daysPerMonth > 0) ? profile.daysPerMonth : 30;
    return profileQtyAmount({
      dose10: profile.dose10,
      timesPerDay: profile.timesPerDay,
      days: days,
      unitPrice10: price.unitPrice10
    });
  }

  /* 既定のプロファイル（isDefault → 無ければ先頭 → 無ければ null） */
  function defaultProfile(profiles) {
    if (!Array.isArray(profiles) || !profiles.length) return null;
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      if (p && p.isDefault) return p;
    }
    return profiles[0] || null;
  }

  /* ── 在庫 ──────────────────────────────────────────────────────── */

  /* 現在庫（最小単位）＝ 最新の棚卸を錨に、その後ろに追記された入出庫だけを足し引きする。
       錨   = voided でない type:'count' のうち配列で最後のもの（行番号順＝追記順）
       対象 = 錨より後ろ かつ date ≥ 錨の日付 の in/out/adj（voided を除く）
     qty の符号はサーバーが書いた値のまま（in ＋／out −／adj ±）。count は実棚。
     stockMode==='countOnly' の品目は out を数えない（入庫と棚卸だけで追う）。
     moves はこの品目のぶんだけでも全品目でもよい（itemId があれば item.id で絞る） */
  function stockOf(moves, item) {
    var out = { qty: 0, lastCount: null };
    if (!Array.isArray(moves)) return out;
    var it = item || {};
    var itemId = str(it.id);
    var countOnly = (it.stockMode === 'countOnly');

    var rows = [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (!m || typeof m !== 'object') continue;
      if (itemId && str(m.itemId) && str(m.itemId) !== itemId) continue;
      if (isVoided(m)) continue;
      rows.push({ m: m, i: i });
    }

    var start = 0, sum = 0;
    for (var j = rows.length - 1; j >= 0; j--) {
      if (rows[j].m.type === 'count') {
        var a = rows[j].m;
        sum = isNum(a.qty) ? a.qty : 0;
        start = j + 1;
        out.lastCount = {
          date: str(a.date),
          createdAt: str(a.createdAt),
          rowIndex: isInt(a.rowIndex) ? a.rowIndex : rows[j].i
        };
        break;
      }
    }
    var anchorDate = out.lastCount ? out.lastCount.date : '';

    for (var k = start; k < rows.length; k++) {
      var mv = rows[k].m;
      var t = mv.type;
      if (t !== 'in' && t !== 'out' && t !== 'adj') continue;
      if (countOnly && t === 'out') continue;
      if (anchorDate && !(str(mv.date) >= anchorDate)) continue;   /* 遡って入れた行は在庫に効かない */
      if (!isNum(mv.qty)) continue;
      sum += mv.qty;
    }
    out.qty = sum;
    return out;
  }

  /* 発注点との比較。unit は請求単位・profile は基準単位で数える。判断材料が無ければ unknown */
  function reorderState(item, stock) {
    var it = item || {};
    var mi = minIdx(it.units);
    if (mi === null) return 'unknown';
    if (!isNum(it.reorderPoint) || it.reorderPoint <= 0) return 'unknown';
    var q = (stock && typeof stock === 'object') ? stock.qty : stock;
    if (!isNum(q)) return 'unknown';
    var idx = (it.billType === 'unit') ? it.billIdx : 0;
    var R = ratioR(it.units, idx);
    if (R === null) return 'unknown';
    return (q <= it.reorderPoint * R) ? 'low' : 'ok';
  }

  /* ── 月次集計・CSV ─────────────────────────────────────────────── */

  function toMap(list, key) {
    var map = {};
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o && typeof o === 'object' && str(o[key])) map[str(o[key])] = o;
      }
    } else if (list && typeof list === 'object') {
      for (var k in list) if (Object.prototype.hasOwnProperty.call(list, k)) map[k] = list[k];
    }
    return map;
  }

  /* 名簿 {masterId,name}[] → {'12':'…'}。氏名はここで解決するだけで保存しない */
  function rosterMap(roster) {
    var map = {};
    var list = Array.isArray(roster) ? roster : (roster && Array.isArray(roster.residents) ? roster.residents : []);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var id = str(r.masterId);
      if (id) map[id] = str(r.name);
    }
    return map;
  }

  function unitNameOf(item) {
    if (!item) return '';
    var mi = minIdx(item.units);
    if (mi === null) return '';
    var idx = (item.billType === 'unit' && isInt(item.billIdx) && item.billIdx >= 0 && item.billIdx <= mi)
      ? item.billIdx : mi;
    return trim(item.units[idx] ? item.units[idx].name : '');
  }

  /* prices は {itemId:[行]} でも list 応答の {itemId:{current,previous,scheduled}} でも読む */
  function priceRowsOf(prices, itemId) {
    if (!prices || typeof prices !== 'object') return null;
    var p = prices[itemId];
    if (!p) return null;
    if (Array.isArray(p)) return p;
    var rows = [];
    if (p.previous) rows.push(p.previous);
    if (p.current) rows.push(p.current);
    if (Array.isArray(p.scheduled)) rows = rows.concat(p.scheduled);
    return rows.length ? rows : null;
  }

  /* move.amount が欠けている行だけの保険（通常はサーバーが焼き付けた amount を使う） */
  function fallbackAmount(mv, item, prices) {
    if (!item) return null;
    var rows = priceRowsOf(prices, str(mv.itemId));
    if (!rows) return null;
    var pr = priceAt(rows, str(mv.date));
    if (!pr) return null;
    if (item.billType === 'profile') {
      var r = profileQtyAmount({
        dose10: mv.dose10, timesPerDay: mv.timesPerDay, days: mv.days, unitPrice10: pr.unitPrice10
      });
      return r ? r.amount : null;
    }
    return unitAmount({
      units: item.units,
      billIdx: item.billIdx,
      qtyBill: isInt(mv.qtyBill) ? Math.abs(mv.qtyBill) : null,
      qty: isInt(mv.qty) ? Math.abs(mv.qty) : null,
      billPrice: pr.billPrice,
      unitPrice10: pr.unitPrice10
    });
  }

  /* 月次集計: 出庫（voided を除く）を 利用者No×品目 でまとめる。
     数量は請求として見るので絶対値（台帳の out は負）。提供先の無い行は1本にまとめる */
  function aggregateMonth(o) {
    o = o || {};
    var moves = Array.isArray(o.moves) ? o.moves : [];
    var itemMap = toMap(o.items, 'id');
    var names = rosterMap(o.roster);
    var groups = {}, order = [];

    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      if (!mv || typeof mv !== 'object') continue;
      if (mv.type !== 'out') continue;
      if (isVoided(mv)) continue;

      var itemId = str(mv.itemId);
      var it = itemMap[itemId] || null;
      var rid = trim(mv.residentId);
      var key = rid + '\u0000' + itemId;
      var g = groups[key];
      if (!g) {
        g = {
          residentId: rid,
          name: rid ? (names[rid] || '') : NO_RESIDENT,
          itemId: itemId,
          itemName: it ? trim(it.name) : '',
          billType: it ? str(it.billType) : '',
          qtyBill: null,
          qty: 0,
          unitName: unitNameOf(it),
          amount: 0,
          taxRate: (it && isNum(it.taxRate)) ? it.taxRate : null
        };
        groups[key] = g;
        order.push(key);
      }
      if (isNum(mv.qty)) g.qty += Math.abs(mv.qty);
      if (g.billType === 'unit' && isNum(mv.qtyBill)) {
        g.qtyBill = (g.qtyBill === null ? 0 : g.qtyBill) + Math.abs(mv.qtyBill);
      }
      var amt = isNum(mv.amount) ? mv.amount : fallbackAmount(mv, it, o.prices);
      if (isNum(amt)) g.amount += amt;
    }

    var rows = [];
    for (var j = 0; j < order.length; j++) rows.push(groups[order[j]]);
    rows.sort(function (a, b) {
      var ea = (a.residentId === ''), eb = (b.residentId === '');
      if (ea !== eb) return ea ? 1 : -1;                     /* 提供先なしは最後 */
      if (a.residentId !== b.residentId) {
        var na = Number(a.residentId), nb = Number(b.residentId);
        if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
        return a.residentId < b.residentId ? -1 : 1;
      }
      if (a.itemName !== b.itemName) return a.itemName < b.itemName ? -1 : 1;
      if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
      return 0;
    });
    return rows;
  }

  /* 集計行 → CSV（BOM＋CRLF・全セル引用符・引用符は二重化）。氏名は行に入っている値だけ */
  function toCsv(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var out = '﻿';
    out += csvLine(CSV_HEAD);
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var qty = (r.qtyBill === null || r.qtyBill === undefined) ? r.qty : r.qtyBill;
      out += csvLine([
        r.residentId, r.name, r.itemName, qty, r.unitName, r.amount, r.billType,
        (r.taxRate === null || r.taxRate === undefined) ? '' : r.taxRate
      ]);
    }
    return out;
  }

  function csvLine(cells) {
    var buf = [];
    for (var i = 0; i < cells.length; i++) {
      buf.push('"' + str(cells[i]).replace(/"/g, '""') + '"');
    }
    return buf.join(',') + '\r\n';
  }

  /* ── 公開 ──────────────────────────────────────────────────────── */

  var SuppliesCalc = {
    VERSION: VERSION,
    /* 単位 */
    factor: factor,
    minIdx: minIdx,
    ratioR: ratioR,
    validateUnits: validateUnits,
    splitQty: splitQty,
    /* 丸め */
    roundDiv: roundDiv,
    /* 価格 */
    propose: propose,
    deriveBill: deriveBill,
    refUnit: refUnit,
    effMarkup: effMarkup,
    costPer: costPer,
    belowCost: belowCost,
    currentPrice: currentPrice,
    priceAt: priceAt,
    changeRatio: changeRatio,
    /* 数量・金額 */
    convertQty: convertQty,
    qtyBillOf: qtyBillOf,
    unitAmount: unitAmount,
    profileQtyAmount: profileQtyAmount,
    profileMonthly: profileMonthly,
    defaultProfile: defaultProfile,
    /* 在庫 */
    stockOf: stockOf,
    reorderState: reorderState,
    /* 集計・CSV */
    aggregateMonth: aggregateMonth,
    toCsv: toCsv,
    /* 日付 */
    today: today,
    monthRange: monthRange,
    prevMonth: prevMonth,
    isYmd: isYmd
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SuppliesCalc;
  else root.SuppliesCalc = SuppliesCalc;
})(typeof window !== 'undefined' ? window : this);
