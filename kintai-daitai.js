/* kintai-daitai.js — 代替休暇（労基法37条3項）の純関数（DOM に触れない・2026-11-25 新設・ROOT-v7 の残りの ×「代替休暇」・12/26 以降に取り込む）
 *
 * 法の決まり（厚労省 基発第0529001号 平成21年5月29日 第3・2023年4月から中小企業にも適用）:
 *   ・月60時間を超える時間外労働の割増（5割以上）のうち、引き上げ分の代わりに「通常の賃金が支払われる休暇」を与えられる。労使協定が要る（届出は要らない・就業規則にも書く）。
 *   ・与えられる時間 ＝（1か月の時間外労働 − 60時間）× 換算率。換算率 ＝ 取らなかった時の割増率（5割以上）− 取った時の割増率（2割5分以上）。
 *   ・単位は1日か半日（協定で一方か両方）。足りない時は、協定で決めれば、ほかの有給の休暇と合わせて1日・半日にできる（割増に代えられるのは代替休暇の分だけ）。
 *     ★この合わせ方は入れない（足りない分を年休などから引く道がまだ無く、有給の休みが増えてしまうため・反証レビュー 2026-11-25）。足りない日は断る。
 *   ・取れる期間は60時間を超えた月の末日の翌日から2か月以内（協定でその範囲で決める）。期間が1か月を超える時は前々月と前月の分を合わせて取れる。
 *   ・取るかは本人の意思。取った時、引き上げ分の割増が要らなくなるのは「取った時間 ÷ 換算率」の時間。取れなかった分は引き上げ分を払う。
 *   ・年次有給休暇とは別。取って終日休んだ日は、年休の出勤率の全労働日に入れない。
 *
 * この部品のやること（★勤怠の数え方 kintai-calc.js と給与 payroll-* は一切変えない・呼ばない）:
 *   1. 設定の掃除（設定の鍵 daitai・既定は切＝協定が無ければ切のまま）
 *   2. 月分ごとの60時間超（over60Min）から付与（与えられる時間）と期限を作る
 *      締めた月分は控えの値（段A2 の控え ext の adj.over60Min があればそれを先に読む）、締めていない終わった月分は数えた値（仮の印）、途中の月分は付与しない。
 *   3. 取った代替休暇（休暇の表の「有給の特別休暇」に印 daitai を付けた行・1日か半日）を、期限の早い付与から当てる
 *   4. 残り・期限切れ・期限が近い・足りない使用・付与の無い使用を出す（知らせだけ・締めは止めない）
 *   5. 給与へ渡す印（中立の形）: { staff_id, originYm, useDate, takenMin, exemptMin }。exemptMin は取った分÷換算率（1分未満は切り捨て・元の月分の60時間超まで）。
 *      どの月の給与で引くか（意向を確かめて25%だけ払う形か、50%を払って取った後に精算する形か）は協定の中身で決まるため、ここでは決めない（給与の作業）。
 * ★職員の名前は持たない（staff_id だけ）。
 */
(function (root) {
  'use strict';
  var TYPE = 'daitai';   /* 休暇の表の特別休暇の印（type_code）。設定の特別休暇の種類にはこの印を使わせない */
  var DEFAULTS = { on: false, rateNo: 50, rateYes: 25, units: 'both', months: 2, warnDays: 14 };
  var EXPIRED_SHOW = 31;   /* 期限切れの知らせを出す日数（期限の翌日から・その後は一覧にだけ残す・反証レビュー 2026-11-25・仮置き） */
  var RANGES = { rateNo: [50, 200], rateYes: [25, 150], months: [1, 2], warnDays: [0, 60] };
  var UNITS = ['both', 'day', 'half'];
  var LABEL = { rateNo: '取らなかった時の割増率', rateYes: '取った時の割増率', months: '取れる期間', warnDays: '期限の知らせ' };

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function okNum(k, n) { var r = RANGES[k]; return isInt(n) && n >= r[0] && n <= r[1]; }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   /* m は1〜12 */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* 期間の終わり（民法143条）: 起算日 from から n か月。応当日の前日に満了・応当日が無い月はその月の末日に満了 */
  function deadlineOf(from, n) {
    var y = +from.slice(0, 4), m = +from.slice(5, 7) + n, d = +from.slice(8, 10);
    while (m > 12) { m -= 12; y++; }
    if (d > lastDay(y, m)) return y + '-' + pad(m) + '-' + pad(lastDay(y, m));
    return addDays(y + '-' + pad(m) + '-' + pad(d), -1);
  }

  /* 1. 設定（rawCfg.daitai）。崩れた値は既定へ（起動不能にしない）。取った時の率が取らなかった時の率以上なら換算率が0以下なので切に倒す */
  function fillConfig(rawCfg) {
    var s = rawCfg && typeof rawCfg === 'object' && rawCfg.daitai && typeof rawCfg.daitai === 'object' && !Array.isArray(rawCfg.daitai) ? rawCfg.daitai : {};
    var o = { on: s.on === true, units: UNITS.indexOf(s.units) >= 0 ? s.units : DEFAULTS.units };
    ['rateNo', 'rateYes', 'months', 'warnDays'].forEach(function (k) { o[k] = okNum(k, s[k]) ? s[k] : DEFAULTS[k]; });
    if (o.rateYes >= o.rateNo) { o.rateNo = DEFAULTS.rateNo; o.rateYes = DEFAULTS.rateYes; }
    o.ratePct = o.rateNo - o.rateYes;   /* 換算率（%・整数）。掛ける・割るは整数で行い、小数の誤差で1分ずらさない（反証レビュー 2026-11-25） */
    o.rate = o.ratePct / 100;
    return o;
  }
  /* 設定の画面の入力（文字のまま受ける）。返す { vals, bad:[欄の名前] } */
  function readForm(f) {
    var vals = { on: f.on === true, units: UNITS.indexOf(f.units) >= 0 ? f.units : DEFAULTS.units }, bad = [];
    ['rateNo', 'rateYes', 'months', 'warnDays'].forEach(function (k) {
      var raw = f[k] == null ? '' : String(f[k]).trim();
      if (raw === '') { vals[k] = DEFAULTS[k]; return; }
      var n = Number(raw);
      if (!okNum(k, n)) { bad.push(LABEL[k]); return; }
      vals[k] = n;
    });
    if (!bad.length && vals.rateYes >= vals.rateNo) bad.push('取った時の割増率（取らなかった時の割増率より小さく）');
    return { vals: bad.length ? null : vals, bad: bad };
  }
  function describe(cfg) {
    var u = cfg.units === 'day' ? '1日' : cfg.units === 'half' ? '半日' : '1日か半日';
    return '換算率 ' + Math.round(cfg.rate * 100) + '%（取らなかった時 ' + cfg.rateNo + '% − 取った時 ' + cfg.rateYes + '%）・単位 ' + u + '・60時間を超えた月分の終わりの翌日から ' + cfg.months + ' か月';
  }

  /* 取った代替休暇の行か（休暇の表の行・取り消した行は読み出しに入らない前提だが、印があれば外す） */
  function isUse(a) { return !!a && a.kind === 'special' && a.type_code === TYPE && a.paid === true && !a.voided_at && isDate(a.date) && typeof a.staff_id === 'string'; }

  /* 2. 付与。months: [{ ym, period:{from,to}, state:'locked'|'ended'|'open', rows:[{ staff_id, over60Min, adjOver60Min? }] }] */
  function grantsOf(months, cfg) {
    var out = {};
    (months || []).forEach(function (m) {
      if (!m || !m.period || !isDate(m.period.to) || m.state === 'open') return;
      (m.rows || []).forEach(function (r) {
        if (!r || typeof r.staff_id !== 'string') return;
        var o60 = typeof r.adjOver60Min === 'number' && isFinite(r.adjOver60Min) ? r.adjOver60Min : +r.over60Min || 0;
        o60 = Math.max(0, Math.round(o60));
        if (!o60) return;
        var from = addDays(m.period.to, 1);
        (out[r.staff_id] || (out[r.staff_id] = [])).push({ ym: m.ym, over60Min: o60, grantMin: Math.floor(o60 * cfg.ratePct / 100), from: from, to: deadlineOf(from, cfg.months),
          prov: m.state !== 'locked', usedMin: 0, exemptMin: 0 });
      });
    });
    Object.keys(out).forEach(function (sid) { out[sid].sort(function (a, b) { return a.to < b.to ? -1 : a.to > b.to ? 1 : a.ym < b.ym ? -1 : 1; }); });
    return out;
  }

  /* 3〜5. 台帳。input: { cfg(fillConfig 済み), months, absences, today, dayMinOf(sid)→分（半日の元）, dayNeedOf(sid, date)→分（1日の分） }
     1日の分は月の計算（kintai-calc.js）が有給の特別休暇の1日に払う時間と同じ「その日の予定の実働（無ければ設定の1日の時間）」を画面が渡す（反証レビュー 2026-11-25）。
     半日は DB が人ごとの1日の時間の半分で入れる（行の minutes）。
     返す: { people:[{ staff_id, grants, uses, remainMin, soon, expired, problems }], marks:[…], counts } */
  function ledger(input) {
    var cfg = input.cfg, td = input.today, dayMinOf = input.dayMinOf || function () { return 480; }, dayNeedOf = input.dayNeedOf || null;
    var gs = grantsOf(input.months, cfg), usesBy = {}, marks = [];
    (input.absences || []).filter(isUse).forEach(function (a) { (usesBy[a.staff_id] || (usesBy[a.staff_id] = [])).push(a); });
    var sids = Object.keys(gs).concat(Object.keys(usesBy).filter(function (s) { return !gs[s]; })).sort();
    var people = sids.map(function (sid) {
      var grants = gs[sid] || [], dm = Math.max(1, Math.round(dayMinOf(sid) || 480));
      var uses = (usesBy[sid] || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).map(function (a) {
        var half = a.minutes != null, need = half ? Math.round(+a.minutes || dm / 2) : dayNeed(dayNeedOf, sid, a.date, dm), left = need, got = [];
        grants.forEach(function (g) {
          if (left <= 0 || a.date < g.from || a.date > g.to) return;
          var rem = g.grantMin - g.usedMin; if (rem <= 0) return;
          var take = Math.min(rem, left);
          g.usedMin += take; left -= take;
          var ex = Math.min(g.over60Min - g.exemptMin, Math.floor(take * 100 / cfg.ratePct));
          g.exemptMin += ex;
          got.push({ ym: g.ym, takenMin: take, exemptMin: ex });
          marks.push({ staff_id: sid, originYm: g.ym, useDate: a.date, takenMin: take, exemptMin: ex, prov: g.prov });
        });
        var taken = need - left, prob = null;
        if (!taken) prob = 'nogrant';
        else if (left > 0) prob = 'short';
        if (!prob && cfg.units === 'day' && half) prob = 'unit';
        if (!prob && cfg.units === 'half' && !half) prob = 'unit';
        return { id: a.id || null, date: a.date, half: half, needMin: need, takenMin: taken, shortMin: left, from: got, problem: prob };
      });
      var remain = 0, soon = [], expired = [], unit = cfg.units === 'day' ? dm : Math.round(dm / 2);
      grants.forEach(function (g) {
        g.remainMin = Math.max(0, g.grantMin - g.usedMin);
        /* 取れる単位（半日・1日だけの協定は1日）に満たない残りは、合わせて取れる別の付与が無ければ「取れない」（割増で払う・知らせに出さない・反証レビュー 2026-11-25） */
        var pool = 0; grants.forEach(function (h) { if (h.from <= g.to && h.to >= g.from) pool += Math.max(0, h.grantMin - h.usedMin); });
        g.state = !g.remainMin ? (g.grantMin ? 'used' : 'none') : td > g.to ? 'expired' : pool < unit ? 'small' : td < g.from ? 'wait' : daysBetween(td, g.to) <= cfg.warnDays ? 'soon' : 'open';
        if (g.state === 'open' || g.state === 'soon' || g.state === 'wait') remain += g.remainMin;
        if (g.state === 'soon') soon.push(g);
        if (g.state === 'expired' && daysBetween(g.to, td) <= EXPIRED_SHOW) expired.push(g);
      });
      return { staff_id: sid, dayMin: dm, grants: grants, uses: uses, remainMin: remain, soon: soon, expired: expired,
        problems: uses.filter(function (u) { return u.problem; }) };
    });
    var counts = { soon: 0, expired: 0, problems: 0, remain: 0 };
    people.forEach(function (p) { if (p.soon.length) counts.soon++; if (p.expired.length) counts.expired++; if (p.problems.length) counts.problems++; if (p.remainMin) counts.remain++; });
    return { people: people, marks: marks, counts: counts };
  }

  /* 新しく取る前の確かめ（画面が kintai_absence_add を呼ぶ前）。p は ledger の1人（無ければ null）。返す null（よい）か 文 */
  function checkTake(p, cfg, date, half, td, maxDate, dayNeedMin) {
    if (!isDate(date)) return '休む日を入れてください。';
    if (half && cfg.units === 'day') return '協定の単位は1日だけです（半日は取れません）。';
    if (!half && cfg.units === 'half') return '協定の単位は半日だけです（1日は取れません）。';
    if (maxDate && date > maxDate) return 'この日はまだ入れられません（休暇を入れられるのは次の月分の期間の終わりまでです）。';
    if (!p) return 'この人には取れる代替休暇がありません（60時間を超えた月分がありません）。';
    if (p.uses.some(function (u) { return u.date === date; })) return 'この日はもう代替休暇を入れています。';
    var need = half ? Math.round(p.dayMin / 2) : (dayNeedMin > 0 ? dayNeedMin : p.dayMin), have = 0;
    p.grants.forEach(function (g) { if (date >= g.from && date <= g.to) have += g.remainMin; });
    if (!have) return 'この日に使える代替休暇がありません（取れる期間の外か、使い切っています）。';
    if (have < need) return '残りが足りません（この日に使える残り ' + hm(have) + '・' + (half ? '半日' : 'この日の1日') + 'は ' + hm(need) + '）。足りない分を年休などと合わせて取る形は、まだ入れられません。';
    return null;
  }
  function dayNeed(fn, sid, date, dm) { var v = fn ? fn(sid, date) : null; return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : dm; }
  function hm(m) { m = Math.max(0, Math.round(m || 0)); return Math.floor(m / 60) + ':' + pad(m % 60); }

  /* ホームの箱。期限が近い・期限が過ぎた残り・足りない使用の人 */
  var PROB_JA = { nogrant: '付与の無い日に取っています', short: '残りより多く取っています', unit: '協定の単位と違います' };
  function box(res) {
    var rows = [];
    res.people.forEach(function (p) {
      p.expired.forEach(function (g) { rows.push({ staff_id: p.staff_id, lv: 2, text: '期限切れ: ' + (+g.ym.slice(5)) + '月分の残り ' + hm(g.remainMin) + '（' + g.to + ' まで・取らなかった分は割増で払う）' }); });
      p.problems.forEach(function (u) { rows.push({ staff_id: p.staff_id, lv: 2, text: '要確認: ' + u.date + ' ' + PROB_JA[u.problem] }); });
      p.soon.forEach(function (g) { rows.push({ staff_id: p.staff_id, lv: 1, text: '期限が近い: ' + (+g.ym.slice(5)) + '月分の残り ' + hm(g.remainMin) + '（' + g.to + ' まで）' }); });
    });
    rows.sort(function (a, b) { return b.lv - a.lv; });
    var lv = rows.some(function (r) { return r.lv === 2; }) ? 'alert' : rows.length ? 'warn' : 'ok';
    return { key: 'daitai', title: '代替休暇', count: rows.length, level: lv, tab: 'daitai', rows: rows };
  }
  /* 給与へ渡す印を元の月分ごとに足す（{ ym: { staff_id: exemptMin } }）。どの月の給与で使うかは給与の作業で決める */
  function exemptByOrigin(res) {
    var o = {};
    res.marks.forEach(function (m) { var y = o[m.originYm] || (o[m.originYm] = {}); y[m.staff_id] = (y[m.staff_id] || 0) + m.exemptMin; });
    return o;
  }

  var api = { TYPE: TYPE, EXPIRED_SHOW: EXPIRED_SHOW, DEFAULTS: DEFAULTS, RANGES: RANGES, UNITS: UNITS, PROB_JA: PROB_JA, fillConfig: fillConfig, readForm: readForm, describe: describe,
    deadlineOf: deadlineOf, isUse: isUse, grantsOf: grantsOf, ledger: ledger, checkTake: checkTake, box: box, exemptByOrigin: exemptByOrigin, hm: hm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintaiDaitai = api;
})(typeof window !== 'undefined' ? window : this);
