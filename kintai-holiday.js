/* kintai-holiday.js — 勤怠の「休日の暦」の純関数（日本の祝日の算出と、会社の休日の掃除・一覧）（2026-11-25 新設・ROOT-v7-plus-parity.md の段B「祝日の設定」）
 *
 * ・DOM に触れない・通信しない。勤怠の計算（kintai-calc.js）にはまだつながない（表示とデータだけ・つなぐのは 2026-12-26 以降の別の作業）
 * ・日本の祝日は「国民の祝日に関する法律」の決まりで年ごとに算出する（2000〜2099 年）。
 *     答え合わせは内閣府の祝日 CSV（check/fixtures/holidays-jp-cao.csv）と全件の一致（check/unit/kintai_holiday_test.js）。
 *     春分・秋分の日は前の年の2月に官報で決まるので、CSV の最後の年（CONFIRMED_THROUGH）より先は「見込み」と印を付ける。
 *     法律が変わった時は、この部品の決まりと CONFIRMED_THROUGH を直し、新しい CSV で試験を回す（check/build-holidays-fixture.mjs）。
 * ・会社の休日は設定（kintai_settings.config）の鍵 companyHolidays に持つ:
 *     [{ date:'YYYY-MM-DD' | md:'MM-DD'（毎年）, to: 同じ形（任意・31日まで）, name: 1〜16字, office: ''|'facility'|'visit'|'day', active: 真偽 }]（30件まで）
 *     消さない（止める＝active:false）。形の違う要素は読み飛ばす（DB は中身を見ないので、読む時に掃除する）
 * ・設定の保存は config 全体が 8192 バイトまで（DB の kintai_settings_put）。保存の前に jsonbBytes で見積もる。
 * ★職員の名前・入居者の情報は持たない。
 */
(function (root) {
  'use strict';
  var MIN_YEAR = 2000, MAX_YEAR = 2099;
  var CONFIRMED_THROUGH = 2027;   /* 内閣府の CSV に載っている最後の年（2026-11-25 に取った CSV） */
  var MAX_COMPANY = 30, NAME_MAX = 16, RANGE_MAX = 31, CONFIG_MAX = 8192;
  var OFFICES = { '': 1, facility: 1, visit: 1, day: 1 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function dow(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addDays(s, n) { var t = Date.parse(s + 'T00:00:00Z') + n * 86400000, x = new Date(t); return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }
  /* その月の第 n 月曜日 */
  function nthMonday(y, m, n) { var w = dow(y, m, 1), first = 1 + ((8 - w) % 7); return first + (n - 1) * 7; }
  /* 春分・秋分の日（1980〜2099 年の近似式。CSV の年は全部一致を試験で確かめる） */
  function vernal(y) { return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
  function autumnal(y) { return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
  function isYear(y) { return typeof y === 'number' && Math.floor(y) === y && y >= MIN_YEAR && y <= MAX_YEAR; }

  /* 国民の祝日（振替休日・国民の休日を除く）。返す: { 'YYYY-MM-DD': 名前 } */
  function baseHolidays(y) {
    var h = {};
    var put = function (m, d, n) { h[ymd(y, m, d)] = n; };
    put(1, 1, '元日');
    put(1, nthMonday(y, 1, 2), '成人の日');
    put(2, 11, '建国記念の日');
    if (y >= 2020) put(2, 23, '天皇誕生日');
    put(3, vernal(y), '春分の日');
    put(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日');
    put(5, 3, '憲法記念日');
    if (y >= 2007) put(5, 4, 'みどりの日');
    put(5, 5, 'こどもの日');
    if (y === 2020) put(7, 23, '海の日');
    else if (y === 2021) put(7, 22, '海の日');
    else if (y >= 2003) put(7, nthMonday(y, 7, 3), '海の日');
    else put(7, 20, '海の日');
    if (y === 2020) put(8, 10, '山の日');
    else if (y === 2021) put(8, 8, '山の日');
    else if (y >= 2016) put(8, 11, '山の日');
    if (y >= 2003) put(9, nthMonday(y, 9, 3), '敬老の日');
    else put(9, 15, '敬老の日');
    put(9, autumnal(y), '秋分の日');
    if (y === 2020) put(7, 24, 'スポーツの日');
    else if (y === 2021) put(7, 23, 'スポーツの日');
    else put(10, nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : (y === 2019 ? '体育の日（スポーツの日）' : '体育の日'));
    put(11, 3, '文化の日');
    put(11, 23, '勤労感謝の日');
    if (y <= 2018) put(12, 23, '天皇誕生日');
    if (y === 2019) { put(5, 1, '休日（祝日扱い）'); put(10, 22, '休日（祝日扱い）'); }
    return h;
  }
  /* 年の祝日と休日の一覧（日付の順）。返す: [{ date, name, kind:'national'|'substitute'|'bridge'|'special', estimated }]・範囲の外の年は [] */
  function nationalHolidays(y) {
    if (!isYear(y)) return [];
    var base = baseHolidays(y), all = {}, kind = {}, k;
    for (k in base) { all[k] = base[k]; kind[k] = /祝日扱い/.test(base[k]) ? 'special' : 'national'; }
    /* 2019 の即位の日の前後（4/30・5/2）は法律で休日（国民の休日の決まりで決まる） */
    /* 振替休日: 国民の祝日が日曜日の時、その後のいちばん近い国民の祝日でない日（2007 年から。それより前は翌日の月曜日） */
    Object.keys(base).sort().forEach(function (d) {
      var p = d.split('-').map(Number);
      if (dow(p[0], p[1], p[2]) !== 0) return;
      var n = addDays(d, 1);
      if (y >= 2007) { while (base[n]) n = addDays(n, 1); }
      else if (base[n]) return;
      if (n.slice(0, 4) !== String(y)) return;
      all[n] = '休日'; kind[n] = 'substitute';
    });
    /* 国民の休日: 前の日と次の日が国民の祝日である、国民の祝日でない日（2007 年より前は日曜日と振替休日を除く） */
    for (var m = 1; m <= 12; m++) for (var d = 1; d <= daysIn(y, m); d++) {
      var s = ymd(y, m, d);
      if (base[s] || all[s]) continue;
      if (!(base[addDays(s, -1)] && base[addDays(s, 1)])) continue;
      if (y < 2007 && dow(y, m, d) === 0) continue;
      all[s] = '休日'; kind[s] = 'bridge';
    }
    var est = y > CONFIRMED_THROUGH;
    return Object.keys(all).sort().map(function (dd) {
      /* 見込み: 内閣府の発表の前の年。春分・秋分の日とそれで決まる休日は特に変わりうる */
      return { date: dd, name: all[dd], kind: kind[dd], estimated: est };
    });
  }

  /* ── 会社の休日 ── */
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/, MD_RE = /^(\d{2})-(\d{2})$/;
  function okDate(s) { var m = typeof s === 'string' && DATE_RE.exec(s); if (!m) return false; var y = +m[1], mo = +m[2], d = +m[3]; return y >= MIN_YEAR && y <= MAX_YEAR && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo); }
  function okMd(s) { var m = typeof s === 'string' && MD_RE.exec(s); if (!m) return false; var mo = +m[1], d = +m[2]; return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(2024, mo); }
  function str(v) { return v == null ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
  function nameLen(s) { return Array.from(s).length; }
  /* 毎年の期間の日数（12-29〜01-03 のように年をまたいでよい・うるう年で数える） */
  function mdSpan(a, b) { var y = 2024, d0 = ymd(y, +a.slice(0, 2), +a.slice(3)), d1 = ymd(b < a ? y + 1 : y, +b.slice(0, 2), +b.slice(3)); return Math.round((Date.parse(d1) - Date.parse(d0)) / 86400000) + 1; }
  /* 掃除: 形の違う要素は読み飛ばし、理由を bad に入れる。通った要素の先頭 30 件まで。返す: { items, bad:[{ row, why }] }
   *   why: shape（形）・date（日付）・to（終わりの日）・name（名前）・office（事業所）・active（真偽でない）・max（件数） */
  function cleanCompany(list) {
    var items = [], bad = [];
    if (!Array.isArray(list)) return { items: items, bad: bad };
    for (var i = 0; i < list.length; i++) {
      var x = list[i], row = i + 1;
      if (!x || typeof x !== 'object' || Array.isArray(x)) { bad.push({ row: row, why: 'shape' }); continue; }
      var hasD = x.date != null, hasM = x.md != null;
      if (hasD === hasM) { bad.push({ row: row, why: 'date' }); continue; }
      if (hasD && !okDate(x.date)) { bad.push({ row: row, why: 'date' }); continue; }
      if (hasM && !okMd(x.md)) { bad.push({ row: row, why: 'date' }); continue; }
      var to = x.to == null || x.to === '' ? null : x.to;
      if (to != null) {
        if (hasD && !(okDate(to) && to >= x.date && (Date.parse(to) - Date.parse(x.date)) / 86400000 < RANGE_MAX)) { bad.push({ row: row, why: 'to' }); continue; }
        if (hasM && !(okMd(to) && to !== x.md && mdSpan(x.md, to) <= RANGE_MAX)) { bad.push({ row: row, why: 'to' }); continue; }
      }
      var nm = str(x.name);
      if (!nm || nameLen(nm) > NAME_MAX) { bad.push({ row: row, why: 'name' }); continue; }
      var of = x.office == null ? '' : x.office;
      if (typeof of !== 'string' || !Object.prototype.hasOwnProperty.call(OFFICES, of)) { bad.push({ row: row, why: 'office' }); continue; }
      if (x.active != null && typeof x.active !== 'boolean') { bad.push({ row: row, why: 'active' }); continue; }
      if (items.length >= MAX_COMPANY) { bad.push({ row: row, why: 'max' }); continue; }
      var o = hasD ? { date: x.date } : { md: x.md };
      if (to != null) o.to = to;
      o.name = nm; o.office = of; o.active = x.active !== false;
      items.push(o);
    }
    return { items: items, bad: bad };
  }
  function companyOf(cfg) { return cleanCompany(cfg && cfg.companyHolidays).items; }
  /* その年に会社の休日が当たる日。返す: [{ date, name, office, idx }]（idx は companyHolidays の中の番号・止めた要素は入れない） */
  function companyDays(items, y) {
    var out = [];
    if (!isYear(y)) return out;
    (items || []).forEach(function (x, idx) {
      if (!x || x.active === false) return;
      var ranges = [];
      if (x.date) ranges.push([x.date, x.to || x.date]);
      else {
        /* 毎年: その年に始まる分と、前の年に始まって年をまたぐ分 */
        var to = x.to || x.md, wrap = to < x.md;
        ranges.push([ymd(y, +x.md.slice(0, 2), Math.min(+x.md.slice(3), daysIn(y, +x.md.slice(0, 2)))), null]);
        ranges[0][1] = wrap ? ymd(y + 1, +to.slice(0, 2), +to.slice(3)) : ymd(y, +to.slice(0, 2), Math.min(+to.slice(3), daysIn(y, +to.slice(0, 2))));
        if (wrap) ranges.push([ymd(y - 1, +x.md.slice(0, 2), Math.min(+x.md.slice(3), daysIn(y - 1, +x.md.slice(0, 2)))), ymd(y, +to.slice(0, 2), +to.slice(3))]);
        /* 2/29 の毎年の休日は、うるう年でない年は 2/28 にする（上の Math.min） */
      }
      ranges.forEach(function (r) {
        for (var d = r[0]; d <= r[1]; d = addDays(d, 1)) if (d.slice(0, 4) === String(y)) out.push({ date: d, name: x.name, office: x.office || '', idx: idx });
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.idx - b.idx; });
    return out;
  }
  /* 年の暦（祝日と会社の休日を日付で合わせる）。office を渡すと、その事業所に効く会社の休日だけ（office が '' の休日は全部の事業所）。
   * 返す: [{ date, national:{name,kind,estimated}|null, company:[{name,office,idx}] }] */
  function yearCalendar(cfg, y, office) {
    var by = {}, keys = [];
    var get = function (d) { if (!by[d]) { by[d] = { date: d, national: null, company: [] }; keys.push(d); } return by[d]; };
    nationalHolidays(y).forEach(function (h) { get(h.date).national = { name: h.name, kind: h.kind, estimated: h.estimated }; });
    companyDays(companyOf(cfg), y).forEach(function (c) {
      if (office && c.office && c.office !== office) return;
      get(c.date).company.push({ name: c.name, office: c.office, idx: c.idx });
    });
    keys.sort();
    return keys.map(function (d) { return by[d]; });
  }
  /* その日が休日か（計算につなぐ時の入口の案・今は画面の表示だけが使う）。返す: { national:bool, company:bool, name } */
  function dayInfo(cfg, date, office) {
    if (!okDate(date)) return { national: false, company: false, name: '' };
    var c = yearCalendar(cfg, +date.slice(0, 4), office).filter(function (x) { return x.date === date; })[0];
    if (!c) return { national: false, company: false, name: '' };
    return { national: !!c.national, company: c.company.length > 0, name: (c.national ? c.national.name : '') + (c.company.length ? (c.national ? '・' : '') + c.company.map(function (x) { return x.name; }).join('・') : '') };
  }

  /* DB の octet_length(config::text) の見積もり（jsonb の文字は「: 」「, 」と空白が入る）。安全側に少し大きく数える */
  function jsonbBytes(v) {
    var enc = function (s) { var n = 0, str0 = JSON.stringify(s); for (var i = 0; i < str0.length; i++) { var c = str0.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3; } return n; };
    var walk = function (x) {
      if (x === null || typeof x === 'boolean' || typeof x === 'number') return String(x === undefined ? null : x).length + 2;
      if (typeof x === 'string') return enc(x);
      if (Array.isArray(x)) { var n = 2; x.forEach(function (e, i) { n += walk(e) + (i ? 2 : 0); }); return n; }
      if (typeof x === 'object') { var m = 2, i = 0; for (var k in x) { if (!Object.prototype.hasOwnProperty.call(x, k) || x[k] === undefined) continue; m += enc(k) + 2 + walk(x[k]) + (i ? 2 : 0); i++; } return m; }
      return 4;
    };
    return walk(v);
  }
  function fitsConfig(cfg) { return jsonbBytes(cfg) <= CONFIG_MAX - 256; }

  var api = { MIN_YEAR: MIN_YEAR, MAX_YEAR: MAX_YEAR, CONFIRMED_THROUGH: CONFIRMED_THROUGH, MAX_COMPANY: MAX_COMPANY, NAME_MAX: NAME_MAX, RANGE_MAX: RANGE_MAX, CONFIG_MAX: CONFIG_MAX,
    nationalHolidays: nationalHolidays, cleanCompany: cleanCompany, companyOf: companyOf, companyDays: companyDays, yearCalendar: yearCalendar, dayInfo: dayInfo,
    jsonbBytes: jsonbBytes, fitsConfig: fitsConfig, okDate: okDate, okMd: okMd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintaiHoliday = api;
})(typeof window !== 'undefined' ? window : this);
