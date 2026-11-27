/* hospital-visit-calc.js — 受診連絡（hospital-visit.html）の純関数（2026-11-27 新設・本人指示）
 *
 * 画面（受診連絡）と試験（check/unit/hospital_visit_calc_test.js）が使う。
 * 通信・端末への保存・画面の部品には触らない（localStorage も読まない・書かない）。
 *
 * 約束（共通 DB の受診連絡の移行（hv_*）と同じ決まり）:
 *   1. 1回の受診＝1行。手紙は受診の前、結果は受診の後に同じ行へ書き足す
 *   2. 結果があるか＝ 結果（1つ目）・診察内容・追加薬 のどれかが空でない（共通 DB の has_result と同じ）
 *   3. 追加薬は '有' | '無' | ''（空）
 *   4. 手紙の定型文・署名・選択肢は設定（hv_settings）が正。無い・崩れている項目は下の既定を使う
 *      （既定の文は代表者が渡した手紙の見本の文のまま・一字も直さない）
 *   5. 日付は 'YYYY-MM-DD' の文字で持ち、手紙には「2026年11月17日」の形で刷る
 */
(function (root) {
  'use strict';

  var VERSION = '2026-11-27';
  var MAX = { letter_body: 8000, result_body: 8000, result_note: 4000, added_med_note: 200, hospital_name: 80, dept: 40, doctor: 60,
              visit_kind: 20, result1: 20, result2: 20, letter_title: 40, resident_name: 60 };

  /* 既定（仮置き。設定の画面から変えられる）。文は見本の手紙のまま */
  var DEFAULTS = {
    titleTail: '身体状況のご報告',
    opening: '平素よりお世話になっております。',
    openingTail: 'のご状況についてご報告させていただきます。',
    closing: '以上、ご報告とさせて頂きます。今後ともどうぞ宜しくお願いいたします。',
    honorific: '御机下',
    signOrg: '',            // 空なら施設情報の施設の呼び名
    signName: '',           // 例: 施設長　〇〇（画面の設定で入れる）
    kinds: ['定期受診', '臨時受診', '初診', '検査', '紹介受診'],
    results1: ['経過観察', '処方継続', '処方変更', '処方追加', '検査予定', '入院'],
    results2: ['次回受診あり', '次回受診なし', '紹介状あり', '終診']
  };
  var TEXT_KEYS = ['titleTail', 'opening', 'openingTail', 'closing', 'honorific', 'signOrg', 'signName'];
  var LIST_KEYS = ['kinds', 'results1', 'results2'];

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).replace(/^[\s　]+|[\s　]+$/g, ''); }
  function esc(s) {
    return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 設定を既定と合わせる。文字は1〜200字（署名は0字可）、選択肢は1〜20字を最大20個・重なりは1つに */
  function normSettings(raw) {
    var o = {}, d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    TEXT_KEYS.forEach(function (k) {
      var v = typeof d[k] === 'string' ? d[k] : null;
      var okEmpty = (k === 'signOrg' || k === 'signName');
      o[k] = (v !== null && v.length <= 200 && (okEmpty || trim(v) !== '')) ? v : DEFAULTS[k];
    });
    LIST_KEYS.forEach(function (k) {
      var arr = Array.isArray(d[k]) ? d[k] : null, out = [];
      if (arr) arr.forEach(function (x) { var t = trim(x); if (t && t.length <= 20 && out.indexOf(t) < 0 && out.length < 20) out.push(t); });
      o[k] = out.length ? out : DEFAULTS[k].slice();
    });
    return o;
  }
  /* 設定の画面の入力（1行1つ）を配列にする */
  function linesToList(text) {
    var out = [];
    str(text).split(/\r?\n/).forEach(function (x) { var t = trim(x); if (t && t.length <= 20 && out.indexOf(t) < 0 && out.length < 20) out.push(t); });
    return out;
  }

  function isIso(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(d));
    if (!m) return false;
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
  }
  function jpDate(d) { if (!isIso(d)) return ''; var p = d.split('-'); return +p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日'; }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function mdw(d) {
    if (!isIso(d)) return '';
    var p = d.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (+p[1]) + '/' + (+p[2]) + '（' + WD[dt.getUTCDay()] + '）';
  }
  function md(d) { if (!isIso(d)) return ''; var p = d.split('-'); return (+p[1]) + '/' + (+p[2]); }
  /* 日本時間の今日 */
  function todayJST(now) {
    var t = (now instanceof Date ? now : new Date()).getTime() + 9 * 3600000, d = new Date(t);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  function hasResult(v) {
    if (!v) return false;
    if (v.has_result === true) return true;
    return trim(v.result1) !== '' || trim(v.result_body) !== '' || trim(v.added_med) !== '';
  }
  /* 並びの日（受診日 → 手紙の日付） */
  function sortOn(v) { return (v && (isIso(v.visit_date) ? v.visit_date : (isIso(v.letter_date) ? v.letter_date : ''))) || ''; }
  function byNewest(a, b) {
    var x = sortOn(a), y = sortOn(b);
    if (x !== y) return x < y ? 1 : -1;
    return str(a.updated_at) < str(b.updated_at) ? 1 : (str(a.updated_at) > str(b.updated_at) ? -1 : 0);
  }
  function sortVisits(list) { return (Array.isArray(list) ? list.slice() : []).filter(Boolean).sort(byNewest); }

  /* 左に出す「前回」: 書いている受診より前の受診のうち、同じ病院のいちばん新しいもの。無ければ病院を問わずいちばん新しいもの。
     書いている受診が新しい（id が無い）時は、全部の受診が「前」 */
  function prevVisitFor(visits, cur) {
    var list = sortVisits(visits), curId = cur && cur.id ? String(cur.id) : '';
    var idx = -1;
    if (curId) for (var i = 0; i < list.length; i++) if (String(list[i].id) === curId) { idx = i; break; }
    var older = curId && idx >= 0 ? list.slice(idx + 1) : list.filter(function (v) { return !curId || String(v.id) !== curId; });
    if (!older.length) return null;
    var hn = trim(cur && cur.hospital_name);
    if (hn) for (var j = 0; j < older.length; j++) if (trim(older[j].hospital_name) === hn) return older[j];
    return older[0];
  }

  /* 定期薬の文（1行1剤）を行にする。空行・前後の空白は落とす */
  function medLines(text) {
    return str(text).split(/\r?\n/).map(trim).filter(function (x) { return x !== ''; });
  }
  /* 見出しつきの薬の塊（例:【受診前】＋行） */
  function medsBlock(label, text) {
    var ls = medLines(text);
    return '【' + label + '】\n' + (ls.length ? ls.join('\n') : '（定期薬の記載なし）');
  }
  /* 結果の「診察内容」の書き始め（見本1枚目の形）: 受診前の薬と、受診日つきの受診後の薬（同じ薬を写しておき、直す） */
  function resultStarter(medsText, visitDate) {
    var d = md(visitDate);
    return medsBlock('受診前', medsText) + '\n\n' + medsBlock((d ? d + ' ' : '') + '受診後', medsText);
  }
  /* 手紙の書き始め（見本2枚目の形）: 前回の結果の診察内容があれば、その中の【受診前】を【前回受診前】に直して写す。
     無ければ今の定期薬を【現在の処方】として入れる */
  function letterStarter(prev, medsText) {
    var rb = trim(prev && prev.result_body);
    if (rb && /【[^】]*受診[前後]】/.test(rb)) return rb.replace(/【受診前】/g, '【前回受診前】');
    return medsBlock('現在の処方', medsText);
  }

  /* 文の中の2つの薬の塊（受診前と受診後）を比べ、足された行・消えた行を返す（画面の印のため。判定はしない＝人が確かめる） */
  function medDiff(before, after) {
    var b = medLines(before), a = medLines(after);
    return { added: a.filter(function (x) { return b.indexOf(x) < 0; }), removed: b.filter(function (x) { return a.indexOf(x) < 0; }) };
  }
  /* 診察内容から【…受診前】【…受診後】の塊を取り出す（無ければ空） */
  function splitBeforeAfter(text) {
    var s = str(text), out = { before: '', after: '' };
    var re = /【([^】]*)】([\s\S]*?)(?=【[^】]*】|$)/g, m;
    while ((m = re.exec(s))) {
      var h = m[1];
      if (/受診前/.test(h) && !out.before) out.before = m[2];
      else if (/受診後/.test(h) && !out.after) out.after = m[2];
    }
    return out;
  }

  /* 入居者の検索（氏名・ふりがな・居室・番号）。退居の方は出さない。空の時は全員（居室の順） */
  function norm(s) {
    return str(s).replace(/[\s　]/g, '').replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).toLowerCase();
  }
  function roomKey(r) { var m = /\d+/.exec(str(r && r.room)); return m ? ('000000' + m[0]).slice(-6) : '999999'; }
  function searchResidents(roster, q) {
    var list = (Array.isArray(roster) ? roster : []).filter(function (r) { return r && r.id != null && r.active !== false; });
    var k = norm(q);
    if (k) list = list.filter(function (r) {
      return norm(r.name).indexOf(k) >= 0 || norm(r.kana).indexOf(k) >= 0 || norm(r.room).indexOf(k) >= 0 || norm(r.id) === k;
    });
    return list.sort(function (a, b) { var x = roomKey(a), y = roomKey(b); return x < y ? -1 : (x > y ? 1 : (str(a.kana) < str(b.kana) ? -1 : 1)); });
  }

  /* 病院の候補: 台帳（使っているもの）→ 入居者マスタの主治医の病院・救急の病院 → その方の過去の受診の病院（名前の重なりは1つ）
     返す形 {key, name, dept, doctor, hospital_id, src:'book'|'master'|'past'} */
  function hospitalChoices(hospitals, medical, visits) {
    var out = [], seen = {};
    function add(o) { var n = trim(o.name); if (!n || seen[n]) return; seen[n] = 1; o.name = n; out.push(o); }
    (Array.isArray(hospitals) ? hospitals : []).filter(function (h) { return h && !h.disabled; })
      .forEach(function (h) { add({ key: 'h:' + h.id, name: h.name, dept: trim(h.dept), doctor: trim(h.doctor), hospital_id: h.id, src: 'book' }); });
    var m = medical || {};
    if (trim(m.hospital)) add({ key: 'm:main', name: firstLine(m.hospital), dept: '', doctor: firstLine(m.doctor), hospital_id: null, src: 'master' });
    if (trim(m.emergencyHospital)) add({ key: 'm:emg', name: firstLine(m.emergencyHospital), dept: '', doctor: '', hospital_id: null, src: 'master' });
    sortVisits(visits).forEach(function (v) {
      if (trim(v.hospital_name)) add({ key: 'p:' + v.id, name: v.hospital_name, dept: trim(v.dept), doctor: trim(v.doctor), hospital_id: v.hospital_id || null, src: 'past' });
    });
    return out;
  }
  function firstLine(s) { return trim(str(s).split(/\r?\n/)[0]).slice(0, 80); }

  /* 保存の前の確かめ。返すのは職員向けの文の配列（空なら保存してよい） */
  function checkVisit(v) {
    var e = [];
    if (!v || !trim(v.resident_id)) e.push('入居者を選んでください。');
    ['letter_date', 'visit_date', 'next_date'].forEach(function (k, i) {
      if (v && str(v[k]) !== '' && !isIso(v[k])) e.push(['手紙の日付', '受診日', '次回の受診日'][i] + 'の形が違います。');
    });
    Object.keys(MAX).forEach(function (k) {
      if (v && str(v[k]).length > MAX[k]) e.push(LABEL[k] + 'が長すぎます（' + MAX[k] + '字まで）。');
    });
    if (v && str(v.added_med) !== '' && v.added_med !== '有' && v.added_med !== '無') e.push('追加薬は「有」か「無」を選んでください。');
    return e;
  }
  var LABEL = { letter_body: '手紙の本文', result_body: '診察内容', result_note: '備考', added_med_note: '追加薬の内容', hospital_name: '病院名',
                dept: '受診科', doctor: '医師名', visit_kind: '受診種別', result1: '結果', result2: '結果', letter_title: '手紙の題', resident_name: '氏名' };

  /* 保存する項目だけを取り出す（画面の下書き → 共通 DB へ送る形）。空文字の日付は空のまま送る（共通 DB が null にする） */
  var SAVE_KEYS = ['resident_id', 'resident_name', 'letter_date', 'visit_date', 'visit_kind', 'hospital_id', 'hospital_name', 'dept', 'doctor',
                   'letter_title', 'letter_body', 'result_body', 'result1', 'result2', 'added_med', 'added_med_note', 'result_note', 'next_date'];
  function toSave(draft) {
    var o = {};
    SAVE_KEYS.forEach(function (k) { var v = draft ? draft[k] : null; o[k] = v == null ? '' : (k === 'hospital_id' ? (v || '') : String(v)); });
    if (draft && draft.id) o.id = String(draft.id);
    return o;
  }
  /* 2つの下書きが同じか（保存していない編集があるか） */
  function sameDraft(a, b) {
    var x = toSave(a), y = toSave(b);
    for (var i = 0; i < SAVE_KEYS.length; i++) if (x[SAVE_KEYS[i]] !== y[SAVE_KEYS[i]]) return false;
    return true;
  }
  function blankVisit(resident, today) {
    return { id: null, rev: null, resident_id: resident ? str(resident.id) : '', resident_name: resident ? trim(resident.name) : '',
             letter_date: today || '', visit_date: '', visit_kind: '', hospital_id: '', hospital_name: '', dept: '', doctor: '',
             letter_title: '', letter_body: '', result_body: '', result1: '', result2: '', added_med: '', added_med_note: '', result_note: '', next_date: '' };
  }
  function fromRow(r) {
    var b = blankVisit(null, '');
    Object.keys(b).forEach(function (k) { if (r && r[k] != null) b[k] = k === 'rev' ? r[k] : String(r[k]); });
    b.id = r && r.id ? String(r.id) : null; b.rev = r && r.rev != null ? Number(r.rev) : null;
    return b;
  }

  /* 手紙の紙の中身（HTML）。値はすべてエスケープする。fac は施設の呼び名（設定の signOrg が空の時に使う） */
  function letterHtml(v, settings, fac) {
    var s = normSettings(settings), name = trim(v && v.resident_name);
    var nameSp = name.replace(/[\s　]+/g, '　');
    var to = [trim(v && v.hospital_name), trim(v && v.dept)].filter(Boolean).join('　');
    var doc = trim(v && v.doctor);
    var docLine = doc ? (doc + ' 先生　' + s.honorific) : s.honorific;   // 医師名が無い時は文を足さない
    var title = trim(v && v.letter_title) || s.titleTail;
    var org = trim(s.signOrg) || trim(fac);
    var body = str(v && v.letter_body);
    return '<div class="hl-sheet">' +
      '<p class="hl-date">' + esc(jpDate(v && v.letter_date)) + '</p>' +
      '<p class="hl-to"><span class="hl-hosp">' + esc(to) + '</span><span class="hl-doc">' + esc(docLine) + '</span></p>' +
      '<h1 class="hl-title">' + esc(nameSp) + '　様　' + esc(title) + '</h1>' +
      '<p class="hl-open"><span>' + esc(s.opening) + '</span><span>' + esc(nameSp) + ' 様' + esc(s.openingTail) + '</span></p>' +
      '<div class="hl-box">' + esc(body) + '</div>' +
      '<p class="hl-close">' + esc(s.closing) + '</p>' +
      '<div class="hl-sign">' + (org ? '<p>' + esc(org) + '</p>' : '') + (trim(s.signName) ? '<p>' + esc(s.signName) + '</p>' : '') + '</div>' +
      '</div>';
  }

  /* 画面の状態（端末に残すのは開いていたタブだけ）。決まった値だけを受ける */
  var LEFT_TABS = ['prev', 'meds'], RIGHT_TABS = ['letter', 'result', 'paper'];
  function pickTab(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }

  var api = {
    VERSION: VERSION, DEFAULTS: DEFAULTS, MAX: MAX, LEFT_TABS: LEFT_TABS, RIGHT_TABS: RIGHT_TABS,
    esc: esc, trim: trim, normSettings: normSettings, linesToList: linesToList, isIso: isIso, jpDate: jpDate, mdw: mdw, md: md,
    todayJST: todayJST, hasResult: hasResult, sortVisits: sortVisits, prevVisitFor: prevVisitFor, medLines: medLines, medsBlock: medsBlock,
    resultStarter: resultStarter, letterStarter: letterStarter, medDiff: medDiff, splitBeforeAfter: splitBeforeAfter,
    searchResidents: searchResidents, hospitalChoices: hospitalChoices, checkVisit: checkVisit, toSave: toSave, sameDraft: sameDraft,
    blankVisit: blankVisit, fromRow: fromRow, letterHtml: letterHtml, pickTab: pickTab
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HospitalVisitCalc = api;
})(typeof window !== 'undefined' ? window : this);
