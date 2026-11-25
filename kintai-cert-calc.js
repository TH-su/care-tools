/* kintai-cert-calc.js — 勤怠の「資格の失効の警告」の純関数（2026-11-25 新設・ROOT-v7-plus-parity.md の段C）
 *
 * ・DOM に触れない・通信しない。勤怠の計算（kintai-calc.js）と給与（payroll*）は変えない・呼ばない
 * ・知らせだけ。資格の記録（care-backend 統合 0134 の kintai_certs）を読み、期限が近い・切れた・期限が未入力の資格を拾う
 * ・入り切りは設定（kintai_settings.config）の鍵 certAlert（true の時だけ入・既定は切）
 * ・資格の種類は設定の鍵 certKinds（[{ code, name, exp, warn, urgent, years, active }]）。鍵が無い時は既定の一覧（DEFAULT_KINDS）を使う
 *     exp＝期限が要る・warn＝何日前から「注意」・urgent＝何日前から「要対応」（切れた後も要対応）・years＝取得日から期限の目安（0＝目安なし・入力の手助けだけ）
 *     active＝false で止める（止めた種類の記録は一覧に出すが、知らせの数に入れない）
 * ・期限の日はその日まで使える（期限の日の当日は「今日まで」・次の日から「期限切れ」）
 * ・辞めた人（勤怠の職員で止めた人）は知らせの数に入れない
 * ★職員の名前は渡された名簿から読むだけで、保存しない。試験は架空の職員だけ（check/unit/kintai_cert_test.js）
 */
(function (root) {
  'use strict';
  var KEY_ON = 'certAlert', KEY_KINDS = 'certKinds';
  var MAX_KINDS = 30, NAME_MAX = 20, NOTE_MAX = 100, WARN_MAX = 365, YEARS_MAX = 10, CODE_RE = /^[A-Za-z0-9_-]{1,24}$/;
  var CFG_MAX = 8192;
  /* 既定の資格の種類（仮置き・設定の画面で足す・直す・止めることができる）。印は職員マスタの資格の印にそろえた所がある */
  var DEFAULT_KINDS = [
    { code: 'cm', name: '介護支援専門員証', exp: true, warn: 90, urgent: 30, years: 5, active: true },
    { code: 'scm', name: '主任介護支援専門員', exp: true, warn: 90, urgent: 30, years: 5, active: true },
    { code: 'car', name: '普通自動車運転免許', exp: true, warn: 90, urgent: 30, years: 0, active: true },
    { code: 'cw', name: '介護福祉士', exp: false, warn: 90, urgent: 30, years: 0, active: true },
    { code: 'jitsumu', name: '実務者研修', exp: false, warn: 90, urgent: 30, years: 0, active: true },
    { code: 'shonin', name: '初任者研修', exp: false, warn: 90, urgent: 30, years: 0, active: true },
    { code: 'nurse', name: '看護師', exp: false, warn: 90, urgent: 30, years: 0, active: true },
    { code: 'anurse', name: '准看護師', exp: false, warn: 90, urgent: 30, years: 0, active: true },
    { code: 'tankyu', name: '喀痰吸引等研修', exp: false, warn: 90, urgent: 30, years: 0, active: true }
  ];
  var LEVEL_RANK = { ok: 0, warn: 1, alert: 2 };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function copyKind(k) { return { code: k.code, name: k.name, exp: k.exp, warn: k.warn, urgent: k.urgent, years: k.years, active: k.active }; }
  function cleanName(s) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''; }
  /* 'YYYY-MM-DD' を暦の日の通し番号へ（形が違う・無い日は null） */
  function dayNo(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var t = Date.UTC(y, m - 1, d), dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }
  function isDate(s) { return dayNo(s) !== null; }
  function ymd(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }

  function on(cfg) { return !!(cfg && cfg[KEY_ON] === true); }

  /* 種類1つの確かめ。返す: { kind } か { why }（why: code・name・warn・urgent・years・shape） */
  function checkKind(x) {
    if (!isObj(x)) return { why: 'shape' };
    var code = typeof x.code === 'string' ? x.code.trim() : '';
    if (!CODE_RE.test(code)) return { why: 'code' };
    var name = cleanName(x.name);
    if (!name || name.length > NAME_MAX) return { why: 'name' };
    var warn = own(x, 'warn') ? x.warn : 90, urgent = own(x, 'urgent') ? x.urgent : 30, years = own(x, 'years') ? x.years : 0;
    if (!isInt(warn) || warn < 1 || warn > WARN_MAX) return { why: 'warn' };
    if (!isInt(urgent) || urgent < 0 || urgent > warn) return { why: 'urgent' };
    if (!isInt(years) || years < 0 || years > YEARS_MAX) return { why: 'years' };
    return { kind: { code: code, name: name, exp: x.exp === true, warn: warn, urgent: urgent, years: years, active: x.active !== false } };
  }
  /* 種類の一覧の掃除。返す: { items, bad:[{i, why}], isDefault }。鍵が配列でない（無い）時は既定の一覧。同じ印は先勝ち・30件まで */
  function cleanKinds(raw) {
    if (!Array.isArray(raw)) return { items: DEFAULT_KINDS.map(copyKind), bad: [], isDefault: true };
    var items = [], bad = [], seen = {};
    for (var i = 0; i < raw.length; i++) {
      var c = checkKind(raw[i]);
      if (!c.kind) { bad.push({ i: i, why: c.why }); continue; }
      if (own(seen, c.kind.code)) { bad.push({ i: i, why: 'dup' }); continue; }
      if (items.length >= MAX_KINDS) { bad.push({ i: i, why: 'max' }); continue; }
      seen[c.kind.code] = 1; items.push(c.kind);
    }
    return { items: items, bad: bad, isDefault: false };
  }
  function kindsOf(cfg) { return cleanKinds(cfg ? cfg[KEY_KINDS] : undefined).items; }
  function kindMap(kinds) { var m = {}; (kinds || []).forEach(function (k) { m[k.code] = k; }); return m; }

  /* 名前から新しい印を作る（既にある印と重ならない c1・c2… ・仮置き） */
  function newCode(kinds) {
    var m = kindMap(kinds);
    for (var i = 1; i < 1000; i++) if (!own(m, 'c' + i)) return 'c' + i;
    return null;
  }

  /* 期限の目安（取得日＋years 年の前の日）。目安が無い・形が違う時は '' */
  function suggestExpiry(acquired, years) {
    if (!isDate(acquired) || !isInt(years) || years < 1 || years > YEARS_MAX) return '';
    var y = +acquired.slice(0, 4) + years, m = +acquired.slice(5, 7), d = +acquired.slice(8, 10);
    var t = Date.UTC(y, m - 1, d);
    var dt = new Date(t);
    if (dt.getUTCMonth() !== m - 1) t = Date.UTC(y, m, 1);   /* 2月29日の翌年などは3月1日として扱う */
    return ymd(Math.round(t / 86400000) - 1);
  }

  /* 資格1件の判定。返す: { level:'ok'|'warn'|'alert', reason:'expired'|'urgent'|'warn'|'noexp'|'', days }（days は期限まで・切れたら負） */
  function judgeOne(cert, kind, today) {
    var tn = dayNo(today), en = cert ? dayNo(cert.expires_on) : null;
    if (tn === null) return { level: 'ok', reason: '', days: null };
    if (en === null) return kind && kind.exp ? { level: 'warn', reason: 'noexp', days: null } : { level: 'ok', reason: '', days: null };
    var warn = kind ? kind.warn : 90, urgent = kind ? kind.urgent : 30, days = en - tn;
    if (days < 0) return { level: 'alert', reason: 'expired', days: days };
    if (days <= urgent) return { level: 'alert', reason: 'urgent', days: days };
    if (days <= warn) return { level: 'warn', reason: 'warn', days: days };
    return { level: 'ok', reason: '', days: days };
  }
  function textOf(j, cert) {
    if (j.reason === 'noexp') return '期限が未入力';
    if (j.reason === 'expired') return '期限切れ（' + (-j.days) + '日過ぎ・' + cert.expires_on + ' まで）';
    if (j.days === 0) return '今日まで';
    if (j.reason === 'urgent' || j.reason === 'warn') return 'あと' + j.days + '日（' + cert.expires_on + ' まで）';
    return cert && cert.expires_on ? cert.expires_on + ' まで' : '';
  }
  function dispName(s) { return s ? String(s.display_name || s.name || s.staff_id || '') : ''; }

  /* 全体の判定。staff: [{ staff_id, name, display_name, active }]・certs: kintai_certs_list の rows・kinds: kindsOf・today: 'YYYY-MM-DD'（日本時間）
   * 返す: { rows:[{ id, staff_id, name, code, kindName, known, stopped, inactive, expires_on, acquired_on, note, rev, level, reason, days, text, counted }],
   *         counts:{ alert, warn }（数えた資格の件数）, people:{ alert, warn }（人数・その人のいちばん重い段で数える） }
   * 並び: 段の重い順→期限の近い順（期限が未入力は同じ段の最後）→名簿の順→種類 */
  function judge(staff, certs, kinds, today) {
    var km = kindMap(kinds), sm = {}, order = {}, rows = [];
    (staff || []).forEach(function (s, i) { if (s && s.staff_id != null) { sm[s.staff_id] = s; order[s.staff_id] = i; } });
    (certs || []).forEach(function (c) {
      if (!isObj(c) || typeof c.code !== 'string' || c.staff_id == null) return;
      var s = sm[c.staff_id] || null, k = own(km, c.code) ? km[c.code] : null;
      var j = judgeOne(c, k, today);
      var inactive = !s || s.active === false, stopped = !k || k.active === false;
      var counted = !inactive && !stopped && j.level !== 'ok';
      rows.push({ id: c.id, staff_id: c.staff_id, name: s ? dispName(s) : String(c.staff_id), code: c.code, kindName: k ? k.name : c.code + '（設定に無い種類）',
        known: !!k, stopped: stopped, inactive: inactive, expires_on: isDate(c.expires_on) ? c.expires_on : null, acquired_on: isDate(c.acquired_on) ? c.acquired_on : null,
        note: typeof c.note === 'string' ? c.note : '', rev: c.rev, level: j.level, reason: j.reason, days: j.days, text: textOf(j, c), counted: counted });
    });
    rows.sort(function (a, b) {
      var ra = a.counted ? LEVEL_RANK[a.level] : -1, rb = b.counted ? LEVEL_RANK[b.level] : -1;
      if (ra !== rb) return rb - ra;
      var da = a.days == null ? 1e9 : a.days, db = b.days == null ? 1e9 : b.days;   /* 期限が未入力は、日付のある知らせの後 */
      if (a.counted && b.counted && da !== db) return da - db;
      var oa = own(order, a.staff_id) ? order[a.staff_id] : 1e9, ob = own(order, b.staff_id) ? order[b.staff_id] : 1e9;
      if (oa !== ob) return oa - ob;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
    var counts = { alert: 0, warn: 0 }, worst = {};
    rows.forEach(function (r) {
      if (!r.counted) return;
      counts[r.level]++;
      if (!own(worst, r.staff_id) || LEVEL_RANK[r.level] > LEVEL_RANK[worst[r.staff_id]]) worst[r.staff_id] = r.level;
    });
    var people = { alert: 0, warn: 0 };
    Object.keys(worst).forEach(function (k) { people[worst[k]]++; });
    return { rows: rows, counts: counts, people: people };
  }

  /* ホームの箱（kintai.js の boxHtml の形: key・title・level・count・rows:[{name,text}]・note） */
  function box(res) {
    var hit = (res && res.rows || []).filter(function (r) { return r.counted; });
    var level = res && res.people.alert ? 'alert' : res && res.people.warn ? 'warn' : 'ok';
    return { key: 'cert', title: '資格の期限', level: level, count: res ? res.people.alert + res.people.warn : 0,
      rows: hit.map(function (r) { return { name: r.name, text: r.kindName + ' ' + r.text }; }),
      note: hit.length ? '' : '期限が近い・切れた資格はありません' };
  }

  /* 職員の資格の入力の確かめ（DB の kintai_cert_put と同じ決まり）。返す: { val:{ code, acquired_on, expires_on, note } } か { why } */
  function checkCert(x, today) {
    if (!isObj(x)) return { why: 'shape' };
    var code = typeof x.code === 'string' ? x.code.trim() : '';
    if (!CODE_RE.test(code)) return { why: 'code' };
    var a = typeof x.acquired_on === 'string' && x.acquired_on.trim() ? x.acquired_on.trim() : null;
    var e = typeof x.expires_on === 'string' && x.expires_on.trim() ? x.expires_on.trim() : null;
    var tn = dayNo(today), lo = dayNo('1950-01-01');
    if (a !== null && (!isDate(a) || dayNo(a) < lo || (tn !== null && dayNo(a) > tn))) return { why: 'acquired' };
    if (e !== null && (!isDate(e) || dayNo(e) < lo || (tn !== null && dayNo(e) > tn + 7300))) return { why: 'expires' };
    if (a !== null && e !== null && dayNo(e) < dayNo(a)) return { why: 'order' };
    var note = typeof x.note === 'string' ? x.note.replace(/^[\s　]+|[\s　]+$/g, '') : '';
    if (note.length > NOTE_MAX || /[\u0000-\u001f\u007f]/.test(note)) return { why: 'note' };
    return { val: { code: code, acquired_on: a, expires_on: e, note: note || null } };
  }

  /* UTF-8 のバイト数 */
  function byteLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  /* DB の octet_length(config::text) の見積もり（jsonb の文字は「: 」「, 」と空白が入る・kintai-holiday.js の jsonbBytes と同じ数え方）。安全側に少し大きく数える */
  function jsonbBytes(v) {
    var enc = function (s) { return byteLen(JSON.stringify(s)); };
    var walk = function (x) {
      if (x === null || typeof x === 'boolean' || typeof x === 'number') return String(x).length + 2;
      if (typeof x === 'string') return enc(x);
      if (Array.isArray(x)) { var n = 2; x.forEach(function (e, i) { n += walk(e) + (i ? 2 : 0); }); return n; }
      if (typeof x === 'object') { var m = 2, i = 0; for (var k in x) { if (!Object.prototype.hasOwnProperty.call(x, k) || x[k] === undefined) continue; m += enc(k) + 2 + walk(x[k]) + (i ? 2 : 0); i++; } return m; }
      return 4;
    };
    return walk(v);
  }
  /* 設定の大きさ（DB の kintai_settings_put は 8192 バイトまで）。余白 256 バイトを残す（kintai-holiday.js の fitsConfig と同じ決まり・反証レビュー 2026-11-25） */
  function fitsConfig(cfg) { try { return jsonbBytes(cfg) <= CFG_MAX - 256; } catch (e) { return false; } }

  var api = { KEY_ON: KEY_ON, KEY_KINDS: KEY_KINDS, MAX_KINDS: MAX_KINDS, NAME_MAX: NAME_MAX, NOTE_MAX: NOTE_MAX, WARN_MAX: WARN_MAX, YEARS_MAX: YEARS_MAX,
    DEFAULT_KINDS: DEFAULT_KINDS, LEVEL_RANK: LEVEL_RANK, on: on, checkKind: checkKind, cleanKinds: cleanKinds, kindsOf: kindsOf, kindMap: kindMap, newCode: newCode,
    isDate: isDate, dayNo: dayNo, suggestExpiry: suggestExpiry, judgeOne: judgeOne, judge: judge, box: box, checkCert: checkCert, byteLen: byteLen, jsonbBytes: jsonbBytes, fitsConfig: fitsConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintaiCertCalc = api;
})(typeof window !== 'undefined' ? window : this);
