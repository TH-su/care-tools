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
 *   SUFacility.municipality()     … 施設のある市区町村（未設定なら空）（2026-10-08・監査10月版 #10）
 *   SUFacility.apps()             … この施設で使うアプリの id の配列（facility-profile.json の apps）。書いていなければ null＝全部使う（2026-10-12・監査10月版 v2）
 *   SUFacility.visitingClinics()  … 訪問診療の医療機関 [{name, aliases[]}]（facility-profile.json の visitingClinics）。書いていなければ空の配列（2026-10-14）
 *   SUFacility.clinicOf(text)     … かかりつけ欄の文字が当たる医療機関の name（name か aliases のどれかを含む）。当たらなければ空
 *   SUFacility.corpSettings()     … 法人設定 {homeGuidelineName, homeGuidelineUrl}（未設定なら空文字。URL は https:// だけ）（2026-10-11・#10）
 *   SUFacility.support()          … 困った時の問い合わせ先 {contactName, contactTel, hours, emergency, replyTarget}（文字列だけ・未設定なら空文字）（2026-10-26 本人指示）
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
    var out = { version: 1, corpName: str(p.corpName), facilityName: str(p.facilityName), municipality: str(p.municipality), offices: [], floors: [], roomPlan: null,
                corpSettings: { homeGuidelineName: '', homeGuidelineUrl: '' }, apps: null, visitingClinics: [],
                support: { contactName: '', contactTel: '', hours: '', emergency: '', replyTarget: '' } };
    /* 訪問診療の医療機関（2026-10-14）。name は1〜40字、aliases は1〜40字の文字列だけ（空の名前・空の別名は捨てる＝空文字は何にでも当たるため） */
    if (Array.isArray(p.visitingClinics)) {
      for (var vc = 0; vc < p.visitingClinics.length && out.visitingClinics.length < 20; vc++) {
        var C = p.visitingClinics[vc], cn = C && str(C.name).trim();
        if (!cn || cn.length > 40) continue;
        var al = Array.isArray(C.aliases) ? C.aliases.filter(function (x) { return typeof x === 'string' && x.trim() && x.trim().length <= 40; }).map(function (x) { return x.trim(); }).slice(0, 10) : [];
        out.visitingClinics.push({ name: cn, aliases: al });
      }
    }
    /* 使うアプリ（2026-10-12）。英小文字の id だけを持つ。書いていない・空の配列は null＝全部使う
       （空の配列を「何も使わない」と読むと、書き損じ1つで接続設定の欄が全部消えるため） */
    if (Array.isArray(p.apps)) {
      var ap = p.apps.filter(function (x) { return typeof x === 'string' && /^[a-z]{2,16}$/.test(x); }).slice(0, 40);
      out.apps = ap.length ? ap : null;
    }
    /* 法人設定（2026-10-11）。名前は文字列だけ、URL は https:// で始まる形だけ持つ（紙と画面のリンクに出すため） */
    if (p.corpSettings && typeof p.corpSettings === 'object') {
      out.corpSettings.homeGuidelineName = str(p.corpSettings.homeGuidelineName).trim().slice(0, 80);
      var gu = str(p.corpSettings.homeGuidelineUrl).trim();
      out.corpSettings.homeGuidelineUrl = /^https:\/\/[^\s"<>]+$/.test(gu) ? gu.slice(0, 300) : '';
    }
    /* 困った時の問い合わせ先（2026-10-26 本人指示）。使い方・困った時とメニューに文字として出す。文字列だけを持ち、
       文字列でない値は空にする（数や配列を文字にして出さない）。公開サイトで誰でも読めるので、電話は公表済みの事業所の番号だけを書く決まり */
    if (p.support && typeof p.support === 'object' && !Array.isArray(p.support)) {
      out.support.contactName = str(p.support.contactName).trim().slice(0, 60);
      out.support.contactTel = str(p.support.contactTel).trim().slice(0, 30);
      out.support.hours = str(p.support.hours).trim().slice(0, 80);
      out.support.emergency = str(p.support.emergency).trim().slice(0, 120);
      out.support.replyTarget = str(p.support.replyTarget).trim().slice(0, 80);
    }
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
    municipality: function () { return (data && data.municipality) || ''; },
    apps: function () { return (data && data.apps) ? data.apps.slice() : null; },
    visitingClinics: function () {
      return (data && data.visitingClinics) ? data.visitingClinics.map(function (c) { return { name: c.name, aliases: c.aliases.slice() }; }) : [];
    },
    clinicOf: function (text) {
      var t = String(text == null ? '' : text), list = (data && data.visitingClinics) || [];
      if (!t) return '';
      for (var i = 0; i < list.length; i++) {
        var keys = [list[i].name].concat(list[i].aliases);
        for (var j = 0; j < keys.length; j++) if (keys[j] && t.indexOf(keys[j]) >= 0) return list[i].name;
      }
      return '';
    },
    corpSettings: function () {
      var c = data && data.corpSettings;
      return { homeGuidelineName: (c && c.homeGuidelineName) || '', homeGuidelineUrl: (c && c.homeGuidelineUrl) || '' };
    },
    support: function () {
      var c = (data && data.support) || {};
      return { contactName: c.contactName || '', contactTel: c.contactTel || '', hours: c.hours || '', emergency: c.emergency || '', replyTarget: c.replyTarget || '' };
    },
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
