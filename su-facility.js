/* 介護ツール共通 ── 施設情報（法人・施設・事業所）の読み口（2026-09-24 新設）
 *
 * なぜ要るか:
 *   施設名・事業所名・事業所番号・住所・電話が各画面のコードに直接書かれていて、他の施設で使えなかった。
 *   値は同じ場所の facility-profile.json に1つだけ置き、画面はここから読む。外販の時は配る先ごとに
 *   facility-profile.json だけを差し替える（画面のコードは変えない）。
 *
 * 読み方:
 *   SUFacility.ready()            … 設定を読めているか（端末の控え・ファイルのどちらかから）
 *   SUFacility.onReady(fn)        … 読めたら（または読めないと分かったら）fn() を呼ぶ。読めた後なら直ちに呼ぶ
 *   SUFacility.office('通所')     … {kind, name, formalName, type, officeNo, address, tel, aliases[]}（無ければ空の器）
 *   SUFacility.officeName('通所') … 事業所の呼び名（未設定なら「通所介護」などの一般名）
 *   SUFacility.aliases()          … {呼び名: '施設'|'訪問'|'通所'}（名前・正式名・別名）
 *   SUFacility.get()              … 設定全体の写し（書き換えても元は変わらない）
 *   SUFacility.fill(text)         … 文中の {{施設}} {{訪問}} {{通所}} を事業所の呼び名に、{{施設名}} を施設名に差し替える（2026-09-24.2・施設名は .3）
 *   SUFacility.nameOf(kind)       … 事業所の名前そのもの（未設定なら空＝一般名で埋めない）。kind に '施設名' を渡すと施設名
 *   SUFacility.floors()           … [{no, label}]（未設定なら １階・２階 の2階建て＝これまでの並び）
 *   SUFacility.floorOf(room)      … 居室番号の先頭の数字が floors の no ならその階・それ以外は 0（全角数字も読む）
 *   SUFacility.floorLabel(no)     … 階の見出し（１階 など）
 *   SUFacility.roomPlan()         … 入居者マスタの間取り図（無ければ null）
 *
 * 端末の控え:
 *   読めた設定を localStorage（su_facility_json_v1）に控え、次の起動ではまず控えを使う（通信できなくても表示が崩れない）。
 *   控えるのは施設の公開情報だけで、利用者・職員の情報は扱わない。
 *   事業所の種類のキー（施設/訪問/通所）は既存データとの互換のため固定（シフト作成の su_facility_profile_v1 と同じ）。
 */
(function () {
  'use strict';
  if (window.SUFacility) return;

  var URL_JSON = 'facility-profile.json';
  var CACHE_KEY = 'su_facility_json_v1';
  var KINDS = ['施設', '訪問', '通所'];
  var GENERIC = { '施設': '施設', '訪問': '訪問介護', '通所': '通所介護' };
  var FIELDS = ['name', 'formalName', 'type', 'officeNo', 'address', 'tel'];

  var data = null, settled = false, waiters = [];

  function str(v) { return (typeof v === 'string') ? v : ''; }

  /* 受け取った設定を信じない（形の崩れた値は捨て、足りない所は空で埋める） */
  function norm(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.offices)) return null;
    var out = { version: 1, corpName: str(p.corpName), facilityName: str(p.facilityName), offices: [], floors: [], roomPlan: null };
    if (Array.isArray(p.floors)) {
      for (var fl = 0; fl < p.floors.length; fl++) {
        var F = p.floors[fl];
        if (F && typeof F.no === 'number' && F.no >= 1 && F.no <= 9 && Math.floor(F.no) === F.no) out.floors.push({ no: F.no, label: str(F.label) || (F.no + '階') });
      }
    }
    /* 間取り図は形だけ確かめて丸ごと持つ（各階に cells の配列があること） */
    if (p.roomPlan && typeof p.roomPlan === 'object') {
      var okPlan = true, anyFloor = false;
      for (var pk in p.roomPlan) {
        if (!Object.prototype.hasOwnProperty.call(p.roomPlan, pk)) continue;
        anyFloor = true;
        if (!p.roomPlan[pk] || !Array.isArray(p.roomPlan[pk].cells)) { okPlan = false; break; }
      }
      if (okPlan && anyFloor) out.roomPlan = JSON.parse(JSON.stringify(p.roomPlan));
    }
    for (var k = 0; k < KINDS.length; k++) {
      var src = null;
      for (var i = 0; i < p.offices.length; i++) {
        if (p.offices[i] && p.offices[i].kind === KINDS[k]) { src = p.offices[i]; break; }
      }
      var o = { kind: KINDS[k], aliases: [] };
      for (var f = 0; f < FIELDS.length; f++) o[FIELDS[f]] = src ? str(src[FIELDS[f]]) : '';
      if (src && Array.isArray(src.aliases)) {
        for (var a = 0; a < src.aliases.length; a++) if (str(src.aliases[a])) o.aliases.push(src.aliases[a]);
      }
      out.offices.push(o);
    }
    return out;
  }

  function settle() {
    if (settled) return;
    settled = true;
    var list = waiters; waiters = [];
    for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
  }

  try {
    var cached = localStorage.getItem(CACHE_KEY);
    if (cached) data = norm(JSON.parse(cached));
  } catch (e) { data = null; }

  function refresh() {
    if (typeof fetch !== 'function') { settle(); return; }
    fetch(URL_JSON, { cache: 'no-cache' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      var n = norm(j);
      if (n) {
        data = n;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(n)); } catch (e) {}
      }
      settle();
    }).catch(function () { settle(); });
  }
  refresh();

  function office(kind) {
    if (data) {
      for (var i = 0; i < data.offices.length; i++) if (data.offices[i].kind === kind) return JSON.parse(JSON.stringify(data.offices[i]));
    }
    var empty = { kind: kind, aliases: [] };
    for (var f = 0; f < FIELDS.length; f++) empty[FIELDS[f]] = '';
    return empty;
  }

  window.SUFacility = {
    ready: function () { return !!data; },
    onReady: function (fn) {
      if (typeof fn !== 'function') return;
      if (settled) { try { fn(); } catch (e) {} } else waiters.push(fn);
    },
    get: function () { return data ? JSON.parse(JSON.stringify(data)) : null; },
    office: office,
    officeName: function (kind) { return office(kind).name || GENERIC[kind] || ''; },
    fill: function (text) {
      return String(text == null ? '' : text).replace(/\{\{(施設名|施設|訪問|通所)\}\}/g, function (a, k) {
        if (k === '施設名') return (data && data.facilityName) || window.SUFacility.officeName('施設');
        return window.SUFacility.officeName(k);
      });
    },
    nameOf: function (kind) {
      if (kind === '施設名') return (data && data.facilityName) || office('施設').name;
      return office(kind).name;
    },
    floors: function () {
      return (data && data.floors.length) ? JSON.parse(JSON.stringify(data.floors)) : [{ no: 1, label: '１階' }, { no: 2, label: '２階' }];
    },
    floorOf: function (room) {
      var s = String(room == null ? '' : room).trim()
        .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
      var m = s.match(/^([1-9])/);
      if (!m) return 0;
      var n = parseInt(m[1], 10), fs = window.SUFacility.floors();
      for (var i = 0; i < fs.length; i++) if (fs[i].no === n) return n;
      return 0;
    },
    floorLabel: function (no) {
      var fs = window.SUFacility.floors();
      for (var i = 0; i < fs.length; i++) if (fs[i].no === no) return fs[i].label;
      return no + '階';
    },
    roomPlan: function () { return (data && data.roomPlan) ? JSON.parse(JSON.stringify(data.roomPlan)) : null; },
    aliases: function () {
      var map = {};
      if (!data) return map;
      for (var i = 0; i < data.offices.length; i++) {
        var o = data.offices[i];
        [o.name, o.formalName].concat(o.aliases).forEach(function (n) { if (n) map[n] = o.kind; });
      }
      return map;
    }
  };
})();
