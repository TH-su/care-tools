/* equip-calc.js — 設備・修繕の記録（equip-log.html）の純関数（2026-11-03 新設・本人の決定 2026-11-03「1〜10 は推奨案・11 を追加」）
 *
 * 画面（設備・修繕の記録）と試験（check/unit/equip_calc_test.js・equip_page_test.js）が使う。
 * 通信・端末への保存・画面の部品には触らない（localStorage も読まない・書かない）。
 *
 * 約束（共通 DB の設備・修繕の移行（eq_*）と同じ決まり）:
 *   1. 場所の鍵: 居室 'room:<部屋番号>'／図面の名前の箱 'area:<階キー>:<名前>'（例 'area:f1:浴室1'・2026-11-03 階つきに変更。
 *      別の階の同じ名前の箱を分けるため。階キーが無い・形が違う時と、変更前に保存した鍵は 'area:<名前>'）／図面に無い場所 'place:<eq_places.id>'。
 *      図面は施設情報の roomPlan の cells の room と t だけを使う（入居者の氏名は扱わない）
 *   2. 並び・年度の集計の基準日は 対応日 → 完了日 → 故障日 の順で最初にある日。3つとも無い記録は集計に入れず「日付なし」に別に数える
 *   3. 年度は 4月1日〜翌年3月31日。年度の名前は始まりの年（2026年度 = 2026-04-01〜2027-03-31）
 *   4. 取り消した記録は集計・予定から外す（記録そのものは画面に印つきで残す）
 *   5. 増やした項目の値（extra）の確かめは共通 DB（eq_save_asset／eq_save_event）と同じ規則。画面は保存の前に同じ規則で知らせる
 *   6. 日付の順の逆転（故障日 ≤ 依頼日 ≤ 対応日 ≤ 完了日 が崩れる）は知らせるだけで、保存は止めない
 */
(function (root) {
  'use strict';

  var VERSION = '2026-11-13';

  /* 設備の種類（ROOT の 10 種・固定）。保存するのは code */
  var CATEGORIES = [
    { code: 'aircon', label: '空調' }, { code: 'kitchen', label: '厨房' }, { code: 'it', label: 'PC・通信' },
    { code: 'furniture', label: '家具・寝具' }, { code: 'water', label: '水回り' }, { code: 'electric', label: '電気・照明' },
    { code: 'fire', label: '消防・防災' }, { code: 'building', label: '建物' }, { code: 'vehicle', label: '車両' }, { code: 'other', label: 'その他' }
  ];
  /* 対応の種類（ROOT の 7 種・固定） */
  var EVENT_TYPES = [
    { code: 'purchase', label: '購入' }, { code: 'repair', label: '修理' }, { code: 'cleaning', label: '清掃' },
    { code: 'inspection', label: '点検' }, { code: 'replace', label: '交換' }, { code: 'dispose', label: '廃棄' }, { code: 'other', label: 'その他' }
  ];
  /* 設備の状態 */
  var STATUSES = [{ code: 'active', label: '使用中' }, { code: 'repairing', label: '修理中' }, { code: 'retired', label: '廃棄' }];
  /* 事業所の種類（共通 DB の kind）→ 施設情報の種類のキー（SUFacility.officeName に渡す） */
  var OFFICE_KINDS = [{ code: 'facility', fac: '施設' }, { code: 'visit', fac: '訪問' }, { code: 'daycare', fac: '通所' }];
  /* 増やせる項目の種類 */
  var FTYPES = [{ code: 'date', label: '日付' }, { code: 'text', label: '文字' }, { code: 'number', label: '数' }, { code: 'select', label: '選択肢' }];
  var TARGETS = ['asset', 'event'];
  var TEXT_MAX = 500;
  var SOON_DAYS = 30;
  /* 「法定」の印の値（2026-11-13 代表者の指示）。設備に付ける選択肢の項目でこの値を選んだ設備を法定点検の設備として数える */
  var LEGAL_VALUE = '法定';
  /* 画面のタブ（端末に残すのは名前だけ） */
  var TABS = ['map', 'assets', 'events', 'sched', 'cost', 'vendors', 'fields'];
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var ID_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{0,63}$/;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function codeIn(list, v) { for (var i = 0; i < list.length; i++) if (list[i].code === v) return true; return false; }
  function labelOf(list, v) { for (var i = 0; i < list.length; i++) if (list[i].code === v) return list[i].label; return v == null ? '' : String(v); }

  /* 画面に入れる値は全部これを通す（数字・日付も） */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 実在する暦の日付か（YYYY-MM-DD だけ） */
  function isDate(s) {
    if (typeof s !== 'string') return false;
    var m = DATE_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return d <= last;
  }
  function dateOrEmpty(s) { return isDate(s) ? s : ''; }
  function todayJST(now) {
    var d = new Date((typeof now === 'number' ? now : Date.now()) + 9 * 3600000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDays(s, n) {
    if (!isDate(s)) return '';
    var m = DATE_RE.exec(s);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /* 場所の鍵（図面の箱・その他の場所から作る）。作れない時は空。
     名前の箱は階キー（roomPlan の鍵 f1・f2 …）を付ける。階キーが無い・形が違う時は階なしの 'area:<名前>' */
  var FLOOR_KEY_RE = /^[A-Za-z0-9_-]{1,20}$/;
  function placeKeyOf(x, floorKey) {
    if (!isObj(x)) return '';
    if (typeof x.room === 'string' && x.room.trim()) return 'room:' + x.room.trim();
    if (typeof x.room === 'number' && isFinite(x.room)) return 'room:' + String(x.room);
    if (typeof x.t === 'string' && x.t.trim()) return 'area:' + (typeof floorKey === 'string' && FLOOR_KEY_RE.test(floorKey) ? floorKey + ':' : '') + x.t.trim();
    if (x.r == null && x.c == null && (typeof x.id === 'string' || typeof x.id === 'number') && String(x.id)) return 'place:' + String(x.id);
    return '';
  }
  /* 場所の鍵 → 画面に出す名前（その他の場所は eq_places の名前・見つからない時は「（消えた場所）」）。
     階つきの名前の箱は「名前（N階）」（階の名前は floorLabel・間取りに無い階は「名前（階キー）」）。階なしの古い鍵は名前だけ */
  function placeLabel(key, places, plan) {
    var k = String(key || '');
    if (k.indexOf('room:') === 0) return k.slice(5);
    if (k.indexOf('area:') === 0) {
      var rest = k.slice(5), j = rest.indexOf(':');
      if (j > 0 && j < rest.length - 1 && FLOOR_KEY_RE.test(rest.slice(0, j))) {
        var fk = rest.slice(0, j), fl = isObj(plan) && has(plan, fk) && isObj(plan[fk]) ? floorLabel(plan[fk].title, fk) : fk;
        return rest.slice(j + 1) + '（' + fl + '）';
      }
      return rest;
    }
    if (k.indexOf('place:') === 0) {
      var id = k.slice(6), list = Array.isArray(places) ? places : [];
      for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === id) return String(list[i].name || '');
      return '（見つからない場所）';
    }
    return k ? k : '（場所なし）';
  }
  /* 場所の鍵 → 事業所の種類。居室・図面の箱は施設、その他の場所は eq_places の kind。分からなければ空 */
  function placeKind(key, places) {
    var k = String(key || '');
    if (k.indexOf('room:') === 0 || k.indexOf('area:') === 0) return 'facility';
    if (k.indexOf('place:') === 0) {
      var id = k.slice(6), list = Array.isArray(places) ? places : [];
      for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === id) return codeIn(OFFICE_KINDS, list[i].kind) ? list[i].kind : '';
    }
    return '';
  }

  /* 次回の予定日 = 基準の日 + 周期（月）。月末は丸める（1月31日 + 1か月 = 2月28日／29日）。周期が 1〜120 の整数でない・日付が無い時は空 */
  function nextDueDate(base, months) {
    var n = Number(months);
    if (!isDate(base) || !isFinite(n) || Math.floor(n) !== n || n < 1 || n > 120) return '';
    var m = DATE_RE.exec(base);
    var y = +m[1], mo = +m[2] - 1 + n, d = +m[3];
    y += Math.floor(mo / 12); mo = mo % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return y + '-' + pad2(mo + 1) + '-' + pad2(Math.min(d, last));
  }
  /* 期限の判定: 'overdue'（期限切れ＝今日より前）／'soon'（今日〜30日以内）／'ok'（それ以外）／''（日付なし） */
  function dueStatus(due, today) {
    if (!isDate(due)) return '';
    var t = isDate(today) ? today : todayJST();
    if (due < t) return 'overdue';
    if (due <= addDays(t, SOON_DAYS)) return 'soon';
    return 'ok';
  }
  /* 基準日（対応日 → 完了日 → 故障日 の順で最初にある日・無ければ空） */
  function effectiveDate(ev) {
    if (!isObj(ev)) return '';
    return dateOrEmpty(ev.handled_on) || dateOrEmpty(ev.done_on) || dateOrEmpty(ev.found_on) || '';
  }
  /* 日付の順の逆転の知らせ（故障日 ≤ 依頼日 ≤ 対応日 ≤ 完了日）。入っている日どうしだけを比べる。知らせるだけで保存は止めない */
  var DATE_STEPS = [['found_on', '故障日'], ['requested_on', '依頼日'], ['handled_on', '対応日'], ['done_on', '完了日']];
  function dateOrderWarnings(ev) {
    var out = [];
    if (!isObj(ev)) return out;
    for (var i = 0; i < DATE_STEPS.length; i++) {
      var a = dateOrEmpty(ev[DATE_STEPS[i][0]]);
      if (!a) continue;
      for (var j = i + 1; j < DATE_STEPS.length; j++) {
        var b = dateOrEmpty(ev[DATE_STEPS[j][0]]);
        if (b && b < a) out.push(DATE_STEPS[j][1] + '（' + b + '）が' + DATE_STEPS[i][1] + '（' + a + '）より前になっています');
      }
    }
    return out;
  }
  /* 年度（4月始まり・始まりの年で呼ぶ）。日付でなければ null */
  function fiscalYearOf(s) {
    if (!isDate(s)) return null;
    var y = +s.slice(0, 4), mo = +s.slice(5, 7);
    return mo >= 4 ? y : y - 1;
  }
  function isCancelled(ev) { return !!(ev && ev.cancelled_at); }
  function amountOf(ev) { var n = Number(ev && ev.amount); return isFinite(n) && n >= 0 ? Math.floor(n) : 0; }

  /* 記録の事業所の種類: 記録の kind → 設備の kind → 場所の鍵 の順 */
  function eventOffice(ev, assets, places) {
    if (!isObj(ev)) return '';
    if (codeIn(OFFICE_KINDS, ev.kind)) return ev.kind;
    var list = Array.isArray(assets) ? assets : [];
    if (ev.asset_id != null) for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === ev.asset_id && codeIn(OFFICE_KINDS, list[i].kind)) return list[i].kind;
    return placeKind(ev.place_key, places);
  }

  /* 費用の集計（eq_summary と同じ形）: 年度の記録だけを、取り消しを除いて事業所・種類（対応の種類）・業者ごとに数える。
     基準日の無い記録は undated に別に数える（年度に関係なく・取り消しは除く） */
  function summarize(events, fy, ctx) {
    ctx = ctx || {};
    var out = { by_office: {}, by_kind: {}, by_vendor: {}, total: { count: 0, amount: 0 }, undated: { count: 0, amount: 0 } };
    var list = Array.isArray(events) ? events : [];
    var year = Number(fy);
    function add(map, k, a) { if (!has(map, k)) map[k] = { count: 0, amount: 0 }; map[k].count++; map[k].amount += a; }
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      if (!isObj(ev) || isCancelled(ev)) continue;
      var a = amountOf(ev), d = effectiveDate(ev);
      if (!d) { out.undated.count++; out.undated.amount += a; continue; }
      if (fiscalYearOf(d) !== year) continue;
      out.total.count++; out.total.amount += a;
      add(out.by_office, eventOffice(ev, ctx.assets, ctx.places) || '', a);
      add(out.by_kind, ev.etype == null ? '' : String(ev.etype), a);
      add(out.by_vendor, ev.vendor_id == null ? '' : String(ev.vendor_id), a);
    }
    return out;
  }

  /* 予定の一覧: 使用中・修理中の設備ごとに、いちばん新しい（取り消していない）記録の次回予定日 → 設備の次回予定日 →
     周期と基準（いちばん新しい記録の基準日か購入日）から出した日 の順で決める。設備に付かない記録の次回予定日も並べる */
  function schedule(assets, events, today) {
    var out = [], al = Array.isArray(assets) ? assets : [], el = Array.isArray(events) ? events : [];
    function latest(id) {
      var best = null, bd = '';
      for (var i = 0; i < el.length; i++) {
        var ev = el[i];
        if (!isObj(ev) || isCancelled(ev) || ev.asset_id !== id) continue;
        var d = effectiveDate(ev) || '';
        if (!best || d > bd) { best = ev; bd = d; }
      }
      return best;
    }
    for (var i = 0; i < al.length; i++) {
      var a = al[i];
      if (!isObj(a) || a.status === 'retired') continue;
      var ev = latest(a.id), due = '', src = '';
      if (ev && isDate(ev.next_due)) { due = ev.next_due; src = 'event'; }
      else if (isDate(a.next_due)) { due = a.next_due; src = 'asset'; }
      else if (a.cycle_months) { due = nextDueDate((ev && effectiveDate(ev)) || dateOrEmpty(a.bought_on), a.cycle_months); src = due ? 'interval' : ''; }
      if (!due) continue;
      out.push({ asset_id: a.id, place_key: a.place_key, due: due, status: dueStatus(due, today), src: src });
    }
    for (var j = 0; j < el.length; j++) {
      var e = el[j];
      if (!isObj(e) || isCancelled(e) || e.asset_id != null || !isDate(e.next_due)) continue;
      out.push({ asset_id: null, event_id: e.id, place_key: e.place_key, due: e.next_due, status: dueStatus(e.next_due, today), src: 'event' });
    }
    out.sort(function (x, y) { return x.due < y.due ? -1 : x.due > y.due ? 1 : 0; });
    return out;
  }

  /* 「法定」の印（2026-11-13 代表者の指示・消防設備・エレベーター・受水槽など）。新しい列は作らず「増やした項目」で持つ:
     付け先が設備・種類が選択肢・「使わない」でない項目のどれかで「法定」（LEGAL_VALUE）を選んでいる設備だけを法定とする。
     ほかの値（「任意」など）・文字の項目に書いた「法定」・使わないにした項目の値は数えない */
  function isLegalAsset(asset, fields) {
    if (!isObj(asset) || !isObj(asset.extra)) return false;
    var fl = Array.isArray(fields) ? fields : [];
    for (var i = 0; i < fl.length; i++) {
      var f = fl[i];
      if (!isObj(f) || f.id == null || f.target !== 'asset' || f.ftype !== 'select' || f.disabled) continue;
      if (asset.extra[String(f.id)] === LEGAL_VALUE) return true;
    }
    return false;
  }
  /* メニューのタイルの札に残す件数（2026-11-13 代表者の指示）。予定の一覧（schedule）の status だけで数える:
     overdue＝期限切れ・soon＝今日から30日以内・legal＝期限切れのうち法定の印の設備（overdue の内数・設備に付かない予定は数えない）。
     返すのは件数と数えた日だけ（設備名・場所は入れない）。today が 年-月-日 でない時は null（今日の日付に落とさない） */
  function menuDueSummary(assets, events, fields, today) {
    if (!isDate(today)) return null;
    var al = Array.isArray(assets) ? assets : [], byId = {};
    for (var i = 0; i < al.length; i++) if (isObj(al[i]) && al[i].id != null) byId[String(al[i].id)] = al[i];
    var out = { v: 1, at: today, eq: true, overdue: 0, soon: 0, legal: 0 };
    schedule(assets, events, today).forEach(function (x) {
      if (x.status === 'overdue') {
        out.overdue++;
        if (x.asset_id != null && has(byId, String(x.asset_id)) && isLegalAsset(byId[String(x.asset_id)], fields)) out.legal++;
      } else if (x.status === 'soon') out.soon++;
    });
    return out;
  }

  /* 時系列の並び: 基準日の新しい順。基準日の無い記録は作った時刻（created_at）で並べ、日付のある記録の後ろに置く */
  function sortEvents(events) {
    var list = (Array.isArray(events) ? events : []).filter(isObj).slice();
    list.sort(function (a, b) {
      var da = effectiveDate(a), db = effectiveDate(b);
      if (da && !db) return -1;
      if (!da && db) return 1;
      var ka = da || String(a.created_at || ''), kb = db || String(b.created_at || '');
      if (ka !== kb) return ka < kb ? 1 : -1;
      var ca = String(a.created_at || ''), cb = String(b.created_at || '');
      return ca < cb ? 1 : ca > cb ? -1 : 0;
    });
    return list;
  }

  /* 増やした項目の定義を付け先ごとに並び順で（使わない項目も含む・並び → 名前） */
  function fieldsFor(fields, target) {
    return (Array.isArray(fields) ? fields : []).filter(function (f) { return isObj(f) && f.target === target; })
      .sort(function (a, b) { var sa = Number(a.sort) || 0, sb = Number(b.sort) || 0; return sa !== sb ? sa - sb : String(a.name) < String(b.name) ? -1 : 1; });
  }
  function sameVal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function emptyVal(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

  /* 増やした項目の値の確かめ（共通 DB と同じ規則）。
     extra: 画面が送る {項目の id: 値}・fields: 定義の一覧・target: 'asset'|'event'・prev: 今の保存値（新しい行は {}）。
     返す {ok, errors:[{key, msg}], value}: value は保存してよい形（空の値は鍵ごと落とす・数は数にする・使わない項目の今の値は残す） */
  function validateExtra(extra, fields, target, prev) {
    var errors = [], value = {}, defs = {};
    var p = isObj(prev) ? prev : {};
    (Array.isArray(fields) ? fields : []).forEach(function (f) { if (isObj(f) && f.id != null) defs[String(f.id)] = f; });
    var x = isObj(extra) ? extra : {};
    Object.keys(x).forEach(function (k) {
      var v = x[k], f = defs[k];
      if (!f) { errors.push({ key: k, msg: '項目の定義に無い鍵です（' + k + '）' }); return; }
      if (f.target !== target) { errors.push({ key: k, msg: '付け先の違う項目です（' + (f.name || k) + '）' }); return; }
      /* 今の保存値と同じ値は確かめ直さない（選択肢を後から外しても、入っている値のまま保存し直せる・共通 DB と同じ） */
      if (has(p, k) && sameVal(p[k], v)) { value[k] = p[k]; return; }
      if (f.disabled) {
        if (emptyVal(v) && !has(p, k)) return;
        errors.push({ key: k, msg: '「' + (f.name || k) + '」は使わない項目のため、新しい値は入れられません' });
        return;
      }
      if (emptyVal(v)) return;
      if (f.ftype === 'date') {
        if (!isDate(v)) { errors.push({ key: k, msg: '「' + (f.name || k) + '」は 年-月-日 の日付で入れてください' }); return; }
        value[k] = v;
      } else if (f.ftype === 'number') {
        var n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(v) ? Number(v) : NaN);
        if (!isFinite(n)) { errors.push({ key: k, msg: '「' + (f.name || k) + '」は数で入れてください' }); return; }
        value[k] = n;
      } else if (f.ftype === 'select') {
        var opts = Array.isArray(f.options) ? f.options : [];
        if (typeof v !== 'string' || opts.indexOf(v) < 0) { errors.push({ key: k, msg: '「' + (f.name || k) + '」は選択肢から選んでください' }); return; }
        value[k] = v;
      } else if (f.ftype === 'text') {
        if (typeof v !== 'string') { errors.push({ key: k, msg: '「' + (f.name || k) + '」は文字で入れてください' }); return; }
        if (v.length > TEXT_MAX) { errors.push({ key: k, msg: '「' + (f.name || k) + '」は ' + TEXT_MAX + ' 字までです（いま ' + v.length + ' 字）' }); return; }
        value[k] = v;
      } else {
        errors.push({ key: k, msg: '項目の種類が分かりません（' + (f.name || k) + '）' });
      }
    });
    /* 使わない項目の今の値は、送られていなくても残す（項目をやめても入れた値は消さない） */
    Object.keys(p).forEach(function (k) { var f = defs[k]; if (f && f.disabled && !has(x, k)) value[k] = p[k]; });
    return { ok: errors.length === 0, errors: errors, value: value };
  }

  /* 項目の定義の確かめ（名前 1〜20字・同じ付け先で重ねない・選択肢は select の時だけ 1〜30個） */
  function validateField(row, fields) {
    var errs = [];
    if (!isObj(row)) return ['項目の中身がありません'];
    var name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || name.length > 20) errs.push('項目の名前は 1〜20 字で入れてください');
    if (TARGETS.indexOf(row.target) < 0) errs.push('付け先を選んでください');
    if (!codeIn(FTYPES, row.ftype)) errs.push('項目の種類を選んでください');
    (Array.isArray(fields) ? fields : []).forEach(function (f) {
      if (isObj(f) && f.target === row.target && String(f.id) !== String(row.id == null ? '' : row.id) && String(f.name || '').trim() === name) errs.push('同じ名前の項目がもうあります（' + name + '）');
    });
    if (row.ftype === 'select') {
      var o = Array.isArray(row.options) ? row.options : [];
      if (o.length < 1 || o.length > 30) errs.push('選択肢は 1〜30 個にしてください');
      else if (o.some(function (s) { return typeof s !== 'string' || !s.trim(); })) errs.push('空の選択肢があります');
    }
    return errs;
  }

  /* 金額の確かめ（税込・円・0 以上の整数） */
  function parseAmount(v) {
    if (v == null || v === '') return { ok: true, value: 0 };
    var s = typeof v === 'number' ? String(v) : String(v).replace(/[,，\s円]/g, '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (!/^\d+$/.test(s)) return { ok: false, value: null };
    var n = Number(s);
    if (!isFinite(n) || n > 2147483647) return { ok: false, value: null };
    return { ok: true, value: n };
  }

  /* CSV（UTF-8 の BOM 付き・改行は CRLF・RFC4180 の引用符）。
     固定の列のあとに、記録向けの増やした項目を並び順で足す（値が入っている項目は使わない項目でも列に出す） */
  var CSV_FIXED = ['基準日', '故障日', '依頼日', '対応日', '完了日', '事業所', '場所', '設備', '種類', '業者', '金額', '内容', '取り消し'];
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    /* 表計算で数式として動かないよう、= + - @ タブ CR で始まる文字は先頭に ' を付ける（数の列はそのまま） */
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(events, ctx) {
    ctx = ctx || {};
    var list = Array.isArray(events) ? events.filter(isObj) : [];
    var assets = Array.isArray(ctx.assets) ? ctx.assets : [], vendors = Array.isArray(ctx.vendors) ? ctx.vendors : [];
    var officeName = typeof ctx.officeName === 'function' ? ctx.officeName : function (k) { return k || ''; };
    var defs = fieldsFor(ctx.fields, 'event').filter(function (f) {
      if (!f.disabled) return true;
      for (var i = 0; i < list.length; i++) if (isObj(list[i].extra) && has(list[i].extra, String(f.id)) && !emptyVal(list[i].extra[String(f.id)])) return true;
      return false;
    });
    function nameById(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return String(arr[i].name || ''); return ''; }
    var rows = [CSV_FIXED.concat(defs.map(function (f) { return String(f.name || ''); }))];
    list.forEach(function (ev) {
      var ex = isObj(ev.extra) ? ev.extra : {};
      rows.push([
        effectiveDate(ev), dateOrEmpty(ev.found_on), dateOrEmpty(ev.requested_on), dateOrEmpty(ev.handled_on), dateOrEmpty(ev.done_on),
        officeName(eventOffice(ev, assets, ctx.places)), placeLabel(ev.place_key, ctx.places, ctx.plan), ev.asset_id != null ? nameById(assets, ev.asset_id) : '',
        labelOf(EVENT_TYPES, ev.etype), ev.vendor_id != null ? nameById(vendors, ev.vendor_id) : '', amountOf(ev), ev.body == null ? '' : String(ev.body),
        isCancelled(ev) ? '取り消し' : ''
      ].concat(defs.map(function (f) { var v = ex[String(f.id)]; return v == null ? '' : v; })));
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  /* 端末に残す UI の状態の復元（既知の値だけ・それ以外は既定へ）。
     raw = {tab, floor, filter}（端末の控えを読んだ文字列のまま）・ctx = {floors:[階キー]} */
  var FILTER_DEF = { etype: '', kind: '', place: '', vendor: '', fy: '' };
  /* ── 探す（上部の検索1つ・2026-11-03 U2）。検索語は端末に保存しない（画面のメモリだけ） ──
     検索語を正規化して語に分ける（全角・半角と大文字・小文字をそろえる・空白で区切る・10語まで・1語100字まで） */
  function normText(v) {
    var s = v == null ? '' : String(v);
    try { if (typeof s.normalize === 'function') s = s.normalize('NFKC'); } catch (e) { /* 古い環境はそのまま */ }
    return s.toLowerCase();
  }
  function queryTerms(q) {
    return normText(q).split(/\s+/).filter(Boolean).slice(0, 10).map(function (w) { return w.slice(0, 100); });
  }
  /* 文字の列のどれかに、検索語の全部の語が入っているか（語どうしは AND）。検索語が空なら常に合う */
  function matchQuery(texts, q) {
    var terms = queryTerms(q);
    if (!terms.length) return true;
    var hay = (Array.isArray(texts) ? texts : []).map(normText).join('\n');
    for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    return true;
  }
  function vendorNameOf(id, vendors) {
    if (id == null) return '';
    var list = Array.isArray(vendors) ? vendors : [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return String(list[i].name || '');
    return '';
  }
  /* 増やした項目のうち、文字と選択肢の値（日付・数は探す対象にしない） */
  function extraTexts(row, fields, target) {
    var out = [], x = isObj(row) && isObj(row.extra) ? row.extra : {};
    fieldsFor(fields, target).forEach(function (f) {
      if (f.ftype !== 'text' && f.ftype !== 'select') return;
      var v = x[String(f.id)];
      if (typeof v === 'string' && v) out.push(v);
    });
    return out;
  }
  /* 設備の探す文字: 名前・メーカー・型番・製造番号・購入先の業者名・増やした項目（文字・選択肢） */
  function assetTexts(a, ctx) {
    ctx = ctx || {};
    if (!isObj(a)) return [];
    return [a.name, a.maker, a.model, a.serial, vendorNameOf(a.vendor_id, ctx.vendors)].concat(extraTexts(a, ctx.fields, 'asset'))
      .filter(function (v) { return v != null && v !== ''; }).map(String);
  }
  /* 対応の記録の探す文字: 内容・業者名・増やした項目（文字・選択肢）・付いている設備の名前・メーカー・型番・製造番号 */
  function eventTexts(e, ctx) {
    ctx = ctx || {};
    if (!isObj(e)) return [];
    var out = [e.body, vendorNameOf(e.vendor_id, ctx.vendors)].concat(extraTexts(e, ctx.fields, 'event'));
    if (e.asset_id != null) {
      var list = Array.isArray(ctx.assets) ? ctx.assets : [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a && String(a.id) === String(e.asset_id)) { out.push(a.name, a.maker, a.model, a.serial); break; }
      }
    }
    return out.filter(function (v) { return v != null && v !== ''; }).map(String);
  }
  function matchAsset(a, q, ctx) { return matchQuery(assetTexts(a, ctx), q); }
  function matchEvent(e, q, ctx) { return matchQuery(eventTexts(e, ctx), q); }
  /* 予定の1行（schedule の要素）: 設備の行は設備で、設備に付かない記録の行は記録で照らす */
  function matchSchedule(x, q, ctx) {
    if (!queryTerms(q).length) return true;
    if (!isObj(x)) return false;
    ctx = ctx || {};
    var list = x.asset_id != null ? ctx.assets : ctx.events, id = x.asset_id != null ? x.asset_id : x.event_id;
    list = Array.isArray(list) ? list : [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return x.asset_id != null ? matchAsset(list[i], q, ctx) : matchEvent(list[i], q, ctx);
    return false;
  }

  /* ── 図面の印（U3）: 場所ごとに 設備の数（廃棄を除く）・期限切れの予定がある・修理中の設備がある ── */
  function placeMarks(assets, events, today) {
    var out = {};
    function at(k) { if (!has(out, k)) out[k] = { count: 0, overdue: false, repairing: false }; return out[k]; }
    (Array.isArray(assets) ? assets : []).forEach(function (a) {
      if (!isObj(a) || a.status === 'retired' || !a.place_key) return;
      var m = at(String(a.place_key));
      m.count++;
      if (a.status === 'repairing') m.repairing = true;
    });
    schedule(assets, events, today).forEach(function (x) { if (x.status === 'overdue' && x.place_key) at(String(x.place_key)).overdue = true; });
    return out;
  }
  /* 階の切替ボタンの名前: 間取りの title から「N階」を抜けたら「N階」、抜けなければ title のまま（title が無ければ鍵） */
  function floorLabel(title, key) {
    var s = title == null || title === '' ? String(key == null ? '' : key) : String(title);
    var n = s;
    try { if (typeof n.normalize === 'function') n = n.normalize('NFKC'); } catch (e) { /* そのまま */ }
    var m = /(\d+)\s*階/.exec(n);
    return m ? String(Number(m[1])) + '階' : s;
  }

  /* ── 設備のカルテ（U7） ── */
  /* 日付まであと何日か（今日 = 0・過ぎたら負）。日付でなければ null */
  function daysUntil(date, today) {
    if (!isDate(date)) return null;
    var t = isDate(today) ? today : todayJST();
    var a = DATE_RE.exec(date), b = DATE_RE.exec(t);
    return Math.round((Date.UTC(+a[1], +a[2] - 1, +a[3]) - Date.UTC(+b[1], +b[2] - 1, +b[3])) / 86400000);
  }
  /* 設備1件の対応の記録（新しい順・取り消しも印つきで含む）と累計費用（取り消しを除く） */
  function assetHistory(asset, events) {
    var id = isObj(asset) ? asset.id : null;
    var list = sortEvents((Array.isArray(events) ? events : []).filter(function (e) { return isObj(e) && id != null && e.asset_id != null && String(e.asset_id) === String(id); }));
    var total = { count: 0, amount: 0 };
    list.forEach(function (e) { if (!isCancelled(e)) { total.count++; total.amount += amountOf(e); } });
    return { events: list, total: total };
  }

  function restoreUiState(raw, ctx) {
    raw = isObj(raw) ? raw : {};
    var floors = (ctx && Array.isArray(ctx.floors)) ? ctx.floors : [];
    var tab = TABS.indexOf(raw.tab) >= 0 ? raw.tab : 'map';
    var floor = (typeof raw.floor === 'string' && floors.indexOf(raw.floor) >= 0) ? raw.floor : (floors[0] || '');
    var f = {};
    var src = raw.filter;
    if (typeof src === 'string') { try { src = JSON.parse(src); } catch (e) { src = null; } }
    src = isObj(src) ? src : {};
    f.etype = codeIn(EVENT_TYPES, src.etype) ? src.etype : '';
    f.kind = codeIn(OFFICE_KINDS, src.kind) ? src.kind : '';
    f.place = (typeof src.place === 'string' && /^(?:(?:room|place):[^\u0000-\u001f]{1,60}|area:(?:[A-Za-z0-9_-]{1,20}:)?[^\u0000-\u001f]{1,60})$/.test(src.place)) ? src.place : '';
    f.vendor = (typeof src.vendor === 'string' && ID_RE.test(src.vendor)) ? src.vendor : '';
    f.fy = (typeof src.fy === 'string' && /^(20\d\d)$/.test(src.fy)) ? src.fy : '';
    return { tab: tab, floor: floor, filter: f };
  }

  var api = {
    VERSION: VERSION, CATEGORIES: CATEGORIES, EVENT_TYPES: EVENT_TYPES, STATUSES: STATUSES, OFFICE_KINDS: OFFICE_KINDS, FTYPES: FTYPES,
    TARGETS: TARGETS, TABS: TABS, TEXT_MAX: TEXT_MAX, SOON_DAYS: SOON_DAYS, LEGAL_VALUE: LEGAL_VALUE, CSV_FIXED: CSV_FIXED, FILTER_DEF: FILTER_DEF,
    esc: esc, isDate: isDate, todayJST: todayJST, addDays: addDays, labelOf: labelOf,
    placeKeyOf: placeKeyOf, placeLabel: placeLabel, placeKind: placeKind, eventOffice: eventOffice,
    nextDueDate: nextDueDate, dueStatus: dueStatus, effectiveDate: effectiveDate, dateOrderWarnings: dateOrderWarnings,
    fiscalYearOf: fiscalYearOf, summarize: summarize, schedule: schedule, sortEvents: sortEvents,
    fieldsFor: fieldsFor, validateExtra: validateExtra, validateField: validateField, parseAmount: parseAmount,
    buildCsv: buildCsv, restoreUiState: restoreUiState,
    queryTerms: queryTerms, matchQuery: matchQuery, assetTexts: assetTexts, eventTexts: eventTexts, matchAsset: matchAsset, matchEvent: matchEvent, matchSchedule: matchSchedule,
    placeMarks: placeMarks, floorLabel: floorLabel, daysUntil: daysUntil, assetHistory: assetHistory,
    isLegalAsset: isLegalAsset, menuDueSummary: menuDueSummary
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EquipCalc = api;
})(typeof window !== 'undefined' ? window : this);
