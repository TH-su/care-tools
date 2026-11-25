/* kintai-extras.js — 勤怠の「日ごとの補助項目」（移動距離・健診・社内会議など手で入れる項目）の純関数（2026-11-25 新設・凍結仕様 ROOT-v7-plus-parity.md「段A1」）
 *
 * ・DOM に触れない・通信しない。勤怠の計算（kintai-calc.js）の数え方は変えない（月の集計にも足さない）
 * ・項目の定義は設定（kintai_settings.config）の鍵 extraItems: [{ code, name, kind:'count'|'number'|'time', unit, decimals, active }]（20個まで）
 *     count＝回数（qty）・number＝数値＋単位（qty・小数は decimals 桁まで）・time＝時間（minutes・1〜1440 分）
 * ・日の行は DB（統合 0127 の kintai_extras）が正本。ここは掃除・確かめ・合計・表示・CSV の末尾の列だけ
 * ・CSV は kintai-calc.js の buildCsv が作った文の各行の「末尾」にだけ列を足す（今の列の並びは変えない・行も足さない）
 * ★職員の名前は持たない（staff_id と従業員コードだけ）。
 */
(function (root) {
  'use strict';
  var C = (typeof module !== 'undefined' && module.exports) ? require('./kintai-calc.js') : root.KintaiCalc;
  var MAX_ITEMS = 20, CODE_RE = /^[A-Za-z0-9_-]{1,20}$/, NAME_MAX = 20, UNIT_MAX = 10;
  var QTY_MAX = 99999.99, COUNT_MAX = 99999, MIN_MAX = 1440;
  var KINDS = { count: '回数', number: '数値', time: '時間' };
  /* 初期値（設定に extraItems が無い時に出す案・保存で確定。勤怠管理Plus の補助項目にそろえた・2026-11-25 チーフの追加） */
  var EXTRA_ITEMS_DEFAULT = [
    { code: 'dist', name: '移動距離', kind: 'number', unit: 'km', decimals: 1, active: true },
    { code: 'sunday', name: '日曜出勤', kind: 'count', unit: '', decimals: 0, active: true },
    { code: 'sunday_time', name: '日曜出勤（時間）', kind: 'time', unit: '', decimals: 0, active: true },
    { code: 'newyear', name: '年末年始出勤', kind: 'count', unit: '', decimals: 0, active: true },
    { code: 'checkup', name: '健診/有休', kind: 'count', unit: '', decimals: 0, active: true },
    { code: 'checkup_nocommute', name: '健診通勤手当なし', kind: 'count', unit: '', decimals: 0, active: true },
    { code: 'meeting', name: '社内会議', kind: 'time', unit: '', decimals: 0, active: true }
  ];

  function copyDefault() { return EXTRA_ITEMS_DEFAULT.map(function (x) { var o = {}, k; for (k in x) o[k] = x[k]; return o; }); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  /* 鍵（code・staff_id）で引く入れ物は継承の無い物にする（code が constructor・toString・__proto__ でも取り違えない＝DB と同じに受ける・反証レビュー 2026-11-25） */
  function dict() { return Object.create(null); }
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  /* 定義の掃除（DB 統合 0127 の確かめと同じ決まり・2026-11-25 DB 側の確定）:
   *   オブジェクトであること・code は英数字・_・- の20字まで・kind は count|number|time・decimals は無い（＝0）か 0/1/2・active は無い（＝使う）か真偽。
   *   違う要素は読み飛ばす。同じ code は先勝ち（先が止めた項目なら後の同じ code も使えない）。通った要素の先頭20個まで。
   *   name・unit は DB は見ない（ここでは文字にして前後の空白を切るだけ・名前が空なら画面は code を出す）。
   * 返す: { items, bad:[{ row:1始まりの番号, why }] }（why: shape・code・kind・decimals・active・dup・max） */
  function cleanExtraItems(list) {
    var items = [], bad = [], seen = dict();
    if (!Array.isArray(list)) return { items: items, bad: bad };
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (!x || typeof x !== 'object' || Array.isArray(x)) { bad.push({ row: i + 1, why: 'shape' }); continue; }
      var code = typeof x.code === 'string' ? x.code : '', kind = x.kind, dec = x.decimals == null ? 0 : x.decimals;
      if (!CODE_RE.test(code)) { bad.push({ row: i + 1, why: 'code' }); continue; }
      if (typeof kind !== 'string' || !own(KINDS, kind)) { bad.push({ row: i + 1, why: 'kind' }); continue; }
      if (!(dec === 0 || dec === 1 || dec === 2)) { bad.push({ row: i + 1, why: 'decimals' }); continue; }
      if (x.active != null && typeof x.active !== 'boolean') { bad.push({ row: i + 1, why: 'active' }); continue; }
      if (seen[code]) { bad.push({ row: i + 1, why: 'dup' }); continue; }
      seen[code] = 1;
      if (items.length >= MAX_ITEMS) { bad.push({ row: i + 1, why: 'max' }); continue; }
      items.push({ code: code, name: str(x.name), kind: kind, unit: str(x.unit), decimals: dec, active: x.active !== false });
    }
    return { items: items, bad: bad };
  }
  /* 設定のタブの入力の確かめ（画面だけの決まり・DB の決まりの上に足す）: 名前は1〜20字・単位は10字まで。返す: [{ row, why }]（why: name・unit） */
  function checkForm(items) {
    var bad = [];
    (items || []).forEach(function (x, i) {
      var nm = str(x && x.name);
      if (!nm || nm.length > NAME_MAX) bad.push({ row: i + 1, why: 'name' });
      else if (str(x && x.unit).length > UNIT_MAX) bad.push({ row: i + 1, why: 'unit' });
    });
    return bad;
  }
  /* 設定から保存済みの定義を読む。鍵が無い時は null（まだ決めていない＝画面は初期値の案を出す） */
  function itemsOf(config) {
    var v = config && typeof config === 'object' ? config.extraItems : undefined;
    return Array.isArray(v) ? cleanExtraItems(v).items : null;
  }
  function activeItems(config) { return (itemsOf(config) || []).filter(function (x) { return x.active; }); }

  /* 入れた値の確かめ（DB の badvalue と同じ線: count は 0〜99999 の整数・number は 0〜99999.99 で decimals の桁まで・time は 1〜1440 分）。count・number は input（文字か数）、time は分（整数）。
   * 返す: { ok:true, qty, minutes } か { ok:false, why }（why: empty・neg・range・decimals・int） */
  function parseValue(item, input) {
    if (!item) return { ok: false, why: 'empty' };
    var s = str(input);
    if (s === '') return { ok: false, why: 'empty' };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, why: 'range' };
    var n = +s;
    if (item.kind === 'time') {
      if (Math.floor(n) !== n) return { ok: false, why: 'int' };
      if (n < 1 || n > MIN_MAX) return { ok: false, why: 'range' };
      return { ok: true, qty: null, minutes: n };
    }
    if (n < 0) return { ok: false, why: 'neg' };
    if (n > (item.kind === 'count' ? COUNT_MAX : QTY_MAX)) return { ok: false, why: 'range' };
    var frac = s.indexOf('.') >= 0 ? s.split('.')[1].replace(/0+$/, '').length : 0;
    if (frac > (item.kind === 'number' ? item.decimals : 0)) return { ok: false, why: 'decimals' };
    return { ok: true, qty: n, minutes: null };
  }
  /* 時間の入力（時間と分の2つの欄）を分にする。どちらも空なら null */
  function minutesOf(h, m) {
    var hs = str(h), ms = str(m);
    if (hs === '' && ms === '') return null;
    if ((hs !== '' && !/^\d+$/.test(hs)) || (ms !== '' && !/^\d+$/.test(ms))) return NaN;
    var mm = +(ms || 0);
    if (mm > 59) return NaN;
    return +(hs || 0) * 60 + mm;
  }

  /* 小数を100倍の整数で足す（12.3＋4.1 が 16.400000000000002 にならないように） */
  function cents(v) { return Math.round(+v * 100); }
  /* 月の行を職員×code に合計する。取り消した行・定義に無い code・形に合わない行（time なのに minutes が無い等）は数えない。
   * 形を直した項目の前の形の行（time なのに qty だけ・count／number なのに minutes だけ）は数えず、mismatch に code ごとの件数を返す（画面が知らせる）。
   * 返す: { byStaff: { sid: { code: 値 } }, byDay: { 'sid|date': { code: 値 } }, rows: 数えた行の数, mismatch: { code: 件数 } }
   * 値は time＝分（整数）・count／number＝数（100倍の整数で足してから戻す） */
  function sumExtras(rows, items) {
    var def = dict(), byStaff = dict(), byDay = dict(), n = 0, raw = dict(), rawDay = dict(), mismatch = dict();
    (items || []).forEach(function (x) { def[x.code] = x; });
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.voided_at || typeof r.staff_id !== 'string' || typeof r.date !== 'string') return;
      if (typeof r.code !== 'string' || !own(def, r.code)) return;
      var it = def[r.code], v, isT = it.kind === 'time';
      var hasM = r.minutes != null && isFinite(+r.minutes), hasQ = r.qty != null && isFinite(+r.qty);
      if (isT ? !hasM : !hasQ) { if (isT ? hasQ : hasM) mismatch[r.code] = (mismatch[r.code] || 0) + 1; return; }
      v = isT ? Math.round(+r.minutes) : cents(r.qty);
      n++;
      var a = raw[r.staff_id] || (raw[r.staff_id] = dict()), dk = r.staff_id + '|' + r.date, b = rawDay[dk] || (rawDay[dk] = dict());
      a[r.code] = (a[r.code] || 0) + v; b[r.code] = (b[r.code] || 0) + v;
    });
    var back = function (src, dst) {
      Object.keys(src).forEach(function (k) {
        var o = dst[k] = dict();
        Object.keys(src[k]).forEach(function (c) { o[c] = def[c].kind === 'time' ? src[k][c] : src[k][c] / 100; });
      });
    };
    back(raw, byStaff); back(rawDay, byDay);
    return { byStaff: byStaff, byDay: byDay, rows: n, mismatch: mismatch };
  }

  /* 値の表示。mode は CSV の時間の書き方（'hmm'＝8:30・'dec'＝8.50）。withUnit で単位を付ける（画面の札） */
  function fmtValue(item, v, mode, withUnit) {
    if (!item || v == null || v === '') return '';
    if (item.kind === 'time') return C.fmtMin(+v, mode === 'dec' ? 'dec' : 'hmm');
    /* 桁は設定の桁を最小にし、値が持つ桁（2桁まで）は切らない（桁や形を後から変えても、入れた数を黙って丸めない・反証レビュー 2026-11-25） */
    var min = item.kind === 'number' ? item.decimals : 0, s = (Math.round(+v * 100) / 100).toFixed(2);
    while (s.indexOf('.') >= 0 && s.split('.')[1].length > min && /0$/.test(s)) s = s.slice(0, -1);
    if (/\.$/.test(s)) s = s.slice(0, -1);
    if (!withUnit) return s;
    return item.kind === 'count' ? s + ' 回' : (item.unit ? s + ' ' + item.unit : s);
  }
  /* 画面の札（「移動距離 12.5 km」「健診/有休 1 回」「社内会議 1:30」） */
  function nameOf(item) { return item ? item.name || item.code : ''; }
  function label(item, v) { return item ? nameOf(item) + ' ' + fmtValue(item, v, 'hmm', true) : ''; }
  /* CSV の見出し（項目の名前＋単位。回数は（回）・時間は（時間）） */
  function colHead(item) {
    var u = item.kind === 'count' ? '回' : item.kind === 'time' ? '時間' : item.unit;
    var nm = nameOf(item);
    return u && nm.slice(-(u.length + 2)) !== '（' + u + '）' ? nm + '（' + u + '）' : nm;   /* 名前が「…（時間）」なら重ねない */
  }

  /* CSV の列にする項目: 使う項目と、止めた項目でもこの月分に行がある項目（入れた数が CSV から消えないように・2026-11-25 DB 側の確定）。並びは定義の順 */
  function csvItems(items, rows) {
    var has = dict();
    (Array.isArray(rows) ? rows : []).forEach(function (r) { if (r && !r.voided_at && typeof r.code === 'string') has[r.code] = 1; });
    return (items || []).filter(function (x) { return x.active || has[x.code]; });
  }

  /* 形を直した項目の前の形の行の知らせ（mismatch が空なら ''）。items は定義（名前を出す） */
  function mismatchText(mismatch, items) {
    var ks = Object.keys(mismatch || {});
    if (!ks.length) return '';
    var nm = function (c) { var it = (items || []).filter(function (x) { return x.code === c; })[0]; return it ? nameOf(it) : c; };
    return '形を変えた補助項目に、前の形で入れた行があります（' + ks.map(function (c) { return nm(c) + ' ' + mismatch[c] + ' 件'; }).join('・') + '）。この行は合計と CSV に数えていません。形を元に戻すか、その行を取り消して入れ直してください。';
  }

  /* CSV の文を行（record）に分ける。引用符の中の改行・カンマは行・欄の区切りにしない。
   * 返す: [{ raw: 行の文（改行なし）, cells: [欄の値] }] */
  function splitCsv(text) {
    var out = [], i = 0, n = text.length;
    while (i < n) {
      var start = i, cells = [], cell = '', q = false;
      for (; i < n; i++) {
        var ch = text.charAt(i);
        if (q) {
          if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
          else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { cells.push(cell); cell = ''; }
        else if (ch === '\r' && text.charAt(i + 1) === '\n') break;
        else if (ch === '\n') break;
        else cell += ch;
      }
      cells.push(cell);
      var end = i;
      if (i < n) i += text.charAt(i) === '\r' ? 2 : 1;
      out.push({ raw: text.slice(start, end), cells: cells });
    }
    return out;
  }

  /* buildCsv の文（summary か daily）の各行の末尾に、有効な項目ごとの列を足す。
   * ctx: { people: [{ staff_id, emp_code }]（buildCsv に渡した月の並び）, items: 有効な項目, sums: sumExtras の結果, mode: 'hmm'|'dec' }
   * 行は従業員コード（日ごとは＋日付）で人に結ぶ。月の集計は合計（無ければ 0）、日ごとはその日の値（無ければ空）。
   * 項目が1つも無い時は文をそのまま返す（今の CSV と1バイトも変わらない）。
   * 返す: { text, dropped: CSV に行が無いため出せなかった値の数（人または日）} */
  function appendCsv(text, kind, ctx) {
    var items = (ctx && ctx.items) || [];
    if (!items.length || typeof text !== 'string' || !text) return { text: text, dropped: 0 };
    var recs = splitCsv(text), people = (ctx.people || []), sums = ctx.sums || { byStaff: {}, byDay: {} }, mode = ctx.mode;
    var used = dict(), out = [], ptr = 0, lastDate = null;
    var cellsOf = function (vals) { return vals.map(function (v) { return C.csvCell(v); }).join(','); };
    var find = function (emp, from) { for (var k = from; k < people.length; k++) if (people[k] && String(people[k].emp_code || '') === emp) return k; return -1; };
    recs.forEach(function (r, idx) {
      if (idx === 0) { out.push(r.raw + ',' + cellsOf(items.map(colHead))); return; }
      var emp = r.cells[0] || '', sid = null;
      if (kind === 'sum') {
        var k = find(emp, ptr); if (k < 0) k = find(emp, 0);
        if (k >= 0) { sid = people[k].staff_id; ptr = k + 1; }
        var tot = sid && own(sums.byStaff, sid) ? sums.byStaff[sid] : dict();
        if (sid) used[sid] = 1;
        out.push(r.raw + ',' + cellsOf(items.map(function (it) { return fmtValue(it, own(tot, it.code) ? tot[it.code] : 0, mode, false); })));
        return;
      }
      var date = r.cells[1] || '';
      var cur = people[ptr - 1];
      if (cur && String(cur.emp_code || '') === emp && (lastDate == null || date > lastDate)) sid = cur.staff_id;
      else {
        var k2 = find(emp, ptr); if (k2 < 0) k2 = find(emp, 0);
        if (k2 >= 0) { sid = people[k2].staff_id; ptr = k2 + 1; }
      }
      lastDate = date;
      var dk = sid + '|' + date, dv = sid && own(sums.byDay, dk) ? sums.byDay[dk] : null;
      if (dv) used[dk] = 1;
      out.push(r.raw + ',' + cellsOf(items.map(function (it) { return dv && own(dv, it.code) ? fmtValue(it, dv[it.code], mode, false) : ''; })));
    });
    /* CSV に行が無い人・日（勤務も打刻も無い人・日の補助項目）は行を足さずに数だけ返す（画面で知らせる・仮置き） */
    var codes = dict(); items.forEach(function (it) { codes[it.code] = 1; });
    var has = function (o) { return !!o && Object.keys(o).some(function (c) { return own(codes, c) && o[c]; }); };
    var src = kind === 'sum' ? sums.byStaff : sums.byDay, dropped = 0;
    Object.keys(src || {}).forEach(function (key) { if (!used[key] && has(src[key])) dropped++; });
    return { text: out.join('\r\n') + '\r\n', dropped: dropped };
  }

  var api = {
    MAX_ITEMS: MAX_ITEMS, CODE_RE: CODE_RE, NAME_MAX: NAME_MAX, UNIT_MAX: UNIT_MAX, QTY_MAX: QTY_MAX, COUNT_MAX: COUNT_MAX, MIN_MAX: MIN_MAX, KINDS: KINDS,
    EXTRA_ITEMS_DEFAULT: EXTRA_ITEMS_DEFAULT, copyDefault: copyDefault, cleanExtraItems: cleanExtraItems, checkForm: checkForm, itemsOf: itemsOf, activeItems: activeItems, csvItems: csvItems, nameOf: nameOf, mismatchText: mismatchText,
    parseValue: parseValue, minutesOf: minutesOf, sumExtras: sumExtras, fmtValue: fmtValue, label: label, colHead: colHead, splitCsv: splitCsv, appendCsv: appendCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiExtras = api;
})(typeof window !== 'undefined' ? window : this);
