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

  /* buildCsv が行を出す人（従業員コードがあり、働いた・有休・打刻なし・要確認・欠勤のどれかがある人）だけにする。
   * buildCsv（kintai-calc.js・変えない）の行を出す条件と同じ（試験で本物の buildCsv の行と突き合わせる）。返す: [{ staff_id, emp_code, name }] */
  function csvPeople(people) {
    return (people || []).filter(function (p) {
      var st = p && p.staff, s = p && p.sum;
      if (!st || !st.emp_code || !s) return false;
      return s.workMin > 0 || s.paidMin > 0 || s.noPunchDays > 0 || s.reviewCount > 0 || s.absentDays > 0;
    }).map(function (p) { return { staff_id: p.staff.staff_id, emp_code: String(p.staff.emp_code), name: p.staff.name || p.staff.staff_id }; });
  }

  /* buildCsv の文（summary か daily）の各行の末尾に、項目ごとの列を足す。
   * ctx: { people: csvPeople の結果（CSV に行を出す人だけ）, items: 列にする項目, sums: sumExtras の結果, mode: 'hmm'|'dec' }
   * 行は従業員コードで人に結ぶ。月の集計は合計（無ければ 0）、日ごとはその日の値（無ければ空）。
   * 同じ従業員コードの人が2人以上いる時は、どの人の行か決められないので、その行には何も付けない（欄は空）・dup にその人たちを返す（画面が名前つきで知らせる）。
   * 項目が1つも無い時は文をそのまま返す（今の CSV と1バイトも変わらない）。
   * 返す: { text, dropped: CSV に行が無いため出せなかった値の数（人または日・dup の人は数えない）, dup: [{ staff_id, emp_code, name }] } */
  function appendCsv(text, kind, ctx) {
    var items = (ctx && ctx.items) || [];
    if (!items.length || typeof text !== 'string' || !text) return { text: text, dropped: 0, dup: [] };
    var recs = splitCsv(text), people = (ctx.people || []).filter(function (p) { return p && p.emp_code; }), sums = ctx.sums || { byStaff: dict(), byDay: dict() }, mode = ctx.mode;
    var byEmp = dict(), cnt = dict(), dupSid = dict(), dup = [], dupSeen = dict();
    people.forEach(function (p) { var e = String(p.emp_code); cnt[e] = (cnt[e] || 0) + 1; if (!own(byEmp, e)) byEmp[e] = p; });
    people.forEach(function (p) { if (cnt[String(p.emp_code)] > 1) dupSid[p.staff_id] = 1; });
    var used = dict(), out = [];
    var cellsOf = function (vals) { return vals.map(function (v) { return C.csvCell(v); }).join(','); };
    var blank = items.map(function () { return ''; });
    recs.forEach(function (r, idx) {
      if (idx === 0) { out.push(r.raw + ',' + cellsOf(items.map(colHead))); return; }
      var emp = r.cells[0] || '';
      if (own(cnt, emp) && cnt[emp] > 1) {
        if (!dupSeen[emp]) { dupSeen[emp] = 1; people.forEach(function (p) { if (String(p.emp_code) === emp) dup.push(p); }); }
        out.push(r.raw + ',' + cellsOf(blank));
        return;
      }
      var sid = own(byEmp, emp) ? byEmp[emp].staff_id : null;
      if (kind === 'sum') {
        var tot = sid && own(sums.byStaff, sid) ? sums.byStaff[sid] : dict();
        if (sid) used[sid] = 1;
        out.push(r.raw + ',' + cellsOf(sid ? items.map(function (it) { return fmtValue(it, own(tot, it.code) ? tot[it.code] : 0, mode, false); }) : blank));
        return;
      }
      var date = r.cells[1] || '', dk = sid + '|' + date, dv = sid && own(sums.byDay, dk) ? sums.byDay[dk] : null;
      if (dv) used[dk] = 1;
      out.push(r.raw + ',' + cellsOf(items.map(function (it) { return dv && own(dv, it.code) ? fmtValue(it, dv[it.code], mode, false) : ''; })));
    });
    /* CSV に行が無い人・日（勤務も打刻も無い人・日の補助項目）は行を足さずに数だけ返す（画面で知らせる・仮置き） */
    var codes = dict(); items.forEach(function (it) { codes[it.code] = 1; });
    var has = function (o) { return !!o && Object.keys(o).some(function (c) { return own(codes, c) && o[c]; }); };
    var src = kind === 'sum' ? sums.byStaff : sums.byDay, dropped = 0;
    Object.keys(src || {}).forEach(function (key) { var sid0 = kind === 'sum' ? key : key.split('|')[0]; if (!used[key] && !dupSid[sid0] && has(src[key])) dropped++; });
    return { text: out.join('\r\n') + '\r\n', dropped: dropped, dup: dup };
  }

  /* ── 段A2（2026-11-25・凍結仕様 ROOT-v7-plus-parity.md「段A2」と「反証レビュー1回」・「2 の追記」）──
   * 締める時に kintai.js が控え（snapshot）の最上段に ext として足す値を作る。給与（payroll.js）が手当の「回数の元」と時間外に使う。
   * ・記号の組（設定の鍵 symbolGroups）: 予定の行の記号（シフトと同じ正規化）が組に入り、同行（companion: true）でない日のうち、実働が 0 より多い日の数
   * ・通勤回数（設定の鍵 commuteCount）: 実働が 0 より多い日のうち、minus の補助項目の取り消していない行が1つも無い日の数
   * ・社内会議を時間外に足す（設定の鍵 meetingOt）: その時間の補助項目の分を、法定休日なら休日労働に、ほかは丸める前の時間外に足した後の値（adj）
   * ・freee の月の集計を取り込んだ人（sum.imported）は、記号の組・通勤回数・会議の足し分を入れない（日ごとの行が無い・freee の時間外に会議が入っている恐れ）
   * ・勤怠の数え方（kintai-calc.js の computeMonth・snapshotOf）は変えない。ここは控えに足す値を作るだけ */
  var GROUPS_MAX = 10, GROUP_SYM_MAX = 20, SYM_LEN_MAX = 40, MINUS_MAX = 20;
  var Sym = (typeof module !== 'undefined' && module.exports) ? require('./shift-symbols.js') : root.ShiftSymbols;
  /* 記号の正規化はシフトアプリと同じ（全角数字・括弧・コロン・波線を半角へ・空白を除く）。部品が無い時は前後の空白を切るだけ */
  function normSym(s) { s = str(s); return Sym && typeof Sym.normalizeCell === 'function' ? Sym.normalizeCell(s) : s.replace(/[\s　]/g, ''); }
  /* 初めの案（設定に鍵が無い時に出す・保存で確定＝保存するまで締めの控えには効かせない・仮置き）。
     早遅の記号は、シフトアプリの freee の書き出しが「早遅手当なし」に振り分ける3つの時間帯（7-16・12-21・18-21）と、その記号（早・遅）にそろえた */
  var SYMBOL_GROUPS_DEFAULT = [{ code: 'hayaoso', name: '早遅', symbols: ['早', '遅', '7-16', '12-21', '18-21'], active: true }];
  var COMMUTE_DEFAULT = { minus: ['checkup', 'checkup_nocommute'] };
  var MEETING_OT_DEFAULT = { code: 'meeting', on: true };
  function copyJson(x) { return JSON.parse(JSON.stringify(x)); }

  /* 記号の組の掃除: オブジェクト・code は英数字・_・- の20字まで・name は1〜20字・symbols は1〜20個の文字（正規化して1〜40字・重なりは1つに）・active は無い（＝使う）か真偽。
   * 違う要素は読み飛ばす。同じ code は先勝ち。先頭10組まで。返す: { groups, bad:[{ row, why }] }（why: shape・code・name・symbols・active・dup・max） */
  function cleanSymbolGroups(list) {
    var groups = [], bad = [], seen = dict();
    if (!Array.isArray(list)) return { groups: groups, bad: bad };
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (!x || typeof x !== 'object' || Array.isArray(x)) { bad.push({ row: i + 1, why: 'shape' }); continue; }
      var code = typeof x.code === 'string' ? x.code : '', nm = str(x.name);
      if (!CODE_RE.test(code)) { bad.push({ row: i + 1, why: 'code' }); continue; }
      if (!nm || nm.length > NAME_MAX) { bad.push({ row: i + 1, why: 'name' }); continue; }
      if (x.active != null && typeof x.active !== 'boolean') { bad.push({ row: i + 1, why: 'active' }); continue; }
      var syms = [], ss = dict(), okS = Array.isArray(x.symbols) && x.symbols.length >= 1 && x.symbols.length <= GROUP_SYM_MAX;
      if (okS) x.symbols.forEach(function (s) { var n = typeof s === 'string' ? normSym(s) : ''; if (!n || n.length > SYM_LEN_MAX) okS = false; else if (!ss[n]) { ss[n] = 1; syms.push(n); } });
      if (!okS) { bad.push({ row: i + 1, why: 'symbols' }); continue; }
      if (seen[code]) { bad.push({ row: i + 1, why: 'dup' }); continue; }
      seen[code] = 1;
      if (groups.length >= GROUPS_MAX) { bad.push({ row: i + 1, why: 'max' }); continue; }
      groups.push({ code: code, name: nm, symbols: syms, active: x.active !== false });
    }
    return { groups: groups, bad: bad };
  }
  /* 通勤回数の掃除: { minus: [code] }（code の形・重なりは1つに・20個まで）。形が違えば null（＝通勤回数を数えない） */
  function cleanCommute(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.minus)) return null;
    var out = [], seen = dict();
    for (var i = 0; i < v.minus.length; i++) {
      var c = v.minus[i];
      if (typeof c !== 'string' || !CODE_RE.test(c)) return null;
      if (!seen[c]) { seen[c] = 1; out.push(c); }
    }
    return out.length > MINUS_MAX ? null : { minus: out };
  }
  /* 社内会議を時間外に足す設定の掃除: { code, on }。形が違えば null（＝足さない） */
  function cleanMeetingOt(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.code !== 'string' || !CODE_RE.test(v.code) || typeof v.on !== 'boolean') return null;
    return { code: v.code, on: v.on };
  }
  /* 設定から保存済みの値を読む（鍵が無い時は null＝まだ決めていない・画面は初めの案を出す） */
  function groupsOf(config) { var v = config && typeof config === 'object' ? config.symbolGroups : undefined; return Array.isArray(v) ? cleanSymbolGroups(v).groups : null; }
  function commuteOf(config) { return config && typeof config === 'object' && config.commuteCount !== undefined ? cleanCommute(config.commuteCount) : null; }
  function meetingOtOf(config) { return config && typeof config === 'object' && config.meetingOt !== undefined ? cleanMeetingOt(config.meetingOt) : null; }
  /* 控えに写す定義（締めた時の定義・給与の数え直しはこれで数える）。保存していない鍵は空（初めの案は効かせない） */
  function defOf(config) {
    return { items: itemsOf(config) || [], groups: groupsOf(config) || [], commute: commuteOf(config), meetingOt: meetingOtOf(config) };
  }
  /* 控えの def を掃除し直す（形の崩れた控えでも例外を出さない・2回通しても同じ＝給与の数え直しが締めた時と同じになる） */
  function cleanDef(def) {
    def = def && typeof def === 'object' ? def : {};
    return { items: cleanExtraItems(def.items).items, groups: cleanSymbolGroups(def.groups).groups, commute: cleanCommute(def.commute), meetingOt: cleanMeetingOt(def.meetingOt) };
  }

  /* その日が法定休日か（kintai-calc.js の holidayMinutes と同じ決まり: 設定の曜日・振替休日で動かした日）。
   * day は month.people[i].days の1日（無い日は曜日だけで決める）。振替の印 absences の swap: role 'off'（休む日）は、働く日（link_date）が法定休日の曜日なら法定休日にする。
   * role 'work'（働く日）は、その日が法定休日の曜日なら法定休日にしない（仮置き・日の行は中身を確かめてから使う） */
  function dowOf(d) { return new Date(Date.parse(d + 'T12:00:00+09:00')).getUTCDay(); }
  function isLegalHoliday(date, day, cfg) {
    var lh = cfg && typeof cfg.legal_holiday === 'number' ? cfg.legal_holiday : null;
    if (lh == null || !C.isDate(date)) return false;
    var abs = day && Array.isArray(day.absences) ? day.absences : [], v = null;
    abs.forEach(function (a) {
      if (!a || a.kind !== 'swap') return;
      if (a.role === 'off' && C.isDate(a.link_date) && dowOf(a.link_date) === lh) v = true;
      else if (a.role === 'work' && dowOf(date) === lh) v = false;
    });
    return v != null ? v : dowOf(date) === lh;
  }
  function round30Of(m) { return typeof C.round30 === 'function' ? C.round30(m) : m; }
  /* 会議の時間を足した後の時間外・60時間超・休日労働（kintai-calc.js の computeMonth の月の合計の式と同じ順: 丸める前の時間外に足す → 月の30分丸め（入の時）→
   * 上限（総労働−休日労働に会議の分を足した値）→ 60時間超＝時間外−3600）。会議 0 なら computeMonth の値と同じ（試験で確かめる）。
   * s は people[i].sum・cfg は月の設定（fillConfig 済み）・non は法定休日でない日の会議の分・hol は法定休日の会議の分 */
  function adjOf(s, cfg, non, hol) {
    var raw = typeof s.legalOverRawMin === 'number' ? s.legalOverRawMin : (+s.legalOverMin || 0);
    var cap = Math.max(0, (+s.workMin || 0) - (+s.holidayMin || 0)) + non, x = raw + non;
    var lo = Math.min(cfg && cfg.monthRound30 ? round30Of(x) : x, cap);
    /* 反証レビュー（2026-11-25・low）: 上限が効いていた月は、丸め直すと足す前より少なくなることがある（例: 丸める前 70・上限 70・会議 10・30分丸めで 60）。足す前の値を下回らせない */
    lo = Math.max(lo, +s.legalOverMin || 0);
    return { legalOverMin: lo, over60Min: Math.max(0, lo - 3600), holidayMin: Math.max((+s.holidayMin || 0) + hol, +s.holidayMin || 0), meetingMin: non + hol };
  }

  /* 控えの ext を作る。month は computeMonth の結果・extrasRows は kintai_extras_get の rows・scheduleRows は kintai_month_get の schedule・config は勤怠の設定（保存した値）。
   * 返す: { v:1, def:{ items, groups, commute, meetingOt }, rows:{ staff_id: { 'x:code': 数, 't:code': 分, 'g:code': 日数, 'k:commute': 日数, adj:{…} } } }
   * 0 の値は入れない（鍵の無い元は 0）。値の無い人は rows に入れない */
  function buildExt(month, extrasRows, scheduleRows, config) { return buildExtDef(month, extrasRows, scheduleRows, defOf(config)); }
  function buildExtDef(month, extrasRows, scheduleRows, def0) {
    var def = cleanDef(def0), m = month && typeof month === 'object' ? month : {}, cfg = m.config || {};
    var per = m.period && C.isDate(m.period.from) && C.isDate(m.period.to) ? m.period : null;
    var inP = function (d) { return !per || (d >= per.from && d <= per.to); };
    var rowsIn = (Array.isArray(extrasRows) ? extrasRows : []).filter(function (r) { return r && !r.voided_at && typeof r.date === 'string' && inP(r.date); });
    var S0 = sumExtras(rowsIn, def.items), out = dict(), people = Array.isArray(m.people) ? m.people : [];
    var put = function (sid, k, v) { if (!v) return; (out[sid] || (out[sid] = dict()))[k] = v; };
    /* 補助項目の月の合計（止めた項目も、締めた時に行があれば入る） */
    Object.keys(S0.byStaff).forEach(function (sid) {
      def.items.forEach(function (it) { var v = S0.byStaff[sid][it.code]; if (v) put(sid, (it.kind === 'time' ? 't:' : 'x:') + it.code, v); });
    });
    /* 予定の行（記号と同行の印）を職員×日に */
    var sched = dict();
    (Array.isArray(scheduleRows) ? scheduleRows : []).forEach(function (r) {
      if (!r || typeof r.staff_id !== 'string' || typeof r.work_date !== 'string' || r.symbol == null) return;
      var k = r.staff_id + '|' + r.work_date; (sched[k] || (sched[k] = [])).push({ sym: normSym(r.symbol), comp: r.companion === true });
    });
    var groups = def.groups.filter(function (g) { return g.active; });
    var minus = dict(); (def.commute ? def.commute.minus : []).forEach(function (c) { minus[c] = 1; });
    var minusDay = dict(); rowsIn.forEach(function (r) { if (typeof r.code === 'string' && own(minus, r.code) && typeof r.staff_id === 'string') minusDay[r.staff_id + '|' + r.date] = 1; });
    var mo = def.meetingOt && def.meetingOt.on ? def.meetingOt : null;
    var meetIt = mo ? def.items.filter(function (it) { return it.code === mo.code && it.kind === 'time'; })[0] : null;
    people.forEach(function (p) {
      var st = p && p.staff, sum = p && p.sum;
      if (!st || typeof st.staff_id !== 'string' || !sum || sum.imported) return;
      var sid = st.staff_id, days = Array.isArray(p.days) ? p.days : [], byDate = dict();
      days.forEach(function (d) { if (d && typeof d.date === 'string') byDate[d.date] = d; });
      var worked = days.filter(function (d) { return d && typeof d.date === 'string' && inP(d.date) && +d.workMin > 0; });
      groups.forEach(function (g) {
        var set = dict(); g.symbols.forEach(function (s) { set[s] = 1; });
        put(sid, 'g:' + g.code, worked.filter(function (d) { return (sched[sid + '|' + d.date] || []).some(function (x) { return own(set, x.sym) && !x.comp; }); }).length);
      });
      if (def.commute) put(sid, 'k:commute', worked.filter(function (d) { return !minusDay[sid + '|' + d.date]; }).length);
      if (meetIt) {
        var non = 0, hol = 0;
        Object.keys(S0.byDay).forEach(function (dk) {
          var ix = dk.indexOf('|');
          if (dk.slice(0, ix) !== sid) return;
          var mv = S0.byDay[dk][meetIt.code], dt = dk.slice(ix + 1);
          if (!mv) return;
          if (isLegalHoliday(dt, byDate[dt], cfg)) hol += mv; else non += mv;
        });
        if (non + hol > 0) (out[sid] || (out[sid] = dict())).adj = adjOf(sum, cfg, non, hol);
      }
    });
    var rows = {};
    Object.keys(out).sort().forEach(function (sid) { var o = {}; Object.keys(out[sid]).sort().forEach(function (k) { o[k] = out[sid][k]; }); rows[sid] = o; });
    return { v: 1, def: copyJson(def), rows: rows };
  }
  /* 2つの ext が同じか（数は 0.01 の単位で比べる・鍵の並びは問わない）。どちらかが ext の形でなければ偽 */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 100)) : 'NaN';
    return JSON.stringify(v === undefined ? null : v);
  }
  function isExt(x) { return !!x && typeof x === 'object' && x.v === 1 && !!x.def && typeof x.def === 'object' && !!x.rows && typeof x.rows === 'object'; }
  function sameExt(a, b) { return isExt(a) && isExt(b) && canon(a.def) === canon(b.def) && canon(a.rows) === canon(b.rows); }
  /* 会議と残業の知らせ（反証レビュー1回の1）: その日の会議の分が、その日の「数えなかった時間」（uncountedMin）より多い日。
   * 返す: [{ staff_id, date, meetingMin, uncountedMin }]（設定が切・会議の項目が無い時は空）。日の行は people[i].days から読む（無い日は数えなかった時間 0） */
  function meetingOverUncounted(month, extrasRows, config) {
    var mo = meetingOtOf(config), items = itemsOf(config) || [];
    if (!mo || !mo.on) return [];
    var it = items.filter(function (x) { return x.code === mo.code && x.kind === 'time'; })[0];
    if (!it) return [];
    var S0 = sumExtras((Array.isArray(extrasRows) ? extrasRows : []).filter(function (r) { return r && r.code === it.code; }), [it]), uc = dict(), out = [];
    ((month && month.people) || []).forEach(function (p) {
      if (!p || !p.staff || (p.sum && p.sum.imported)) return;
      (p.days || []).forEach(function (d) { if (d && typeof d.date === 'string') uc[p.staff.staff_id + '|' + d.date] = Math.max(0, +d.uncountedMin || 0); });
    });
    Object.keys(S0.byDay).sort().forEach(function (dk) {
      var mv = S0.byDay[dk][it.code], u = own(uc, dk) ? uc[dk] : 0, ix = dk.indexOf('|');
      if (mv > u) out.push({ staff_id: dk.slice(0, ix), date: dk.slice(ix + 1), meetingMin: mv, uncountedMin: u });
    });
    return out;
  }
  /* 社内会議を時間外に足すかを保存しないまま締めようとしている（反証レビュー 2026-11-25・medium）: 設定に鍵 meetingOt が無く（保存していない）、
   * その月分に初めの案の会議の項目（code meeting）か、時間の補助項目の取り消していない行（分が 0 より多い）がある時に真 */
  function meetingUnsaved(config, extrasRows) {
    if (config && typeof config === 'object' && config.meetingOt !== undefined) return false;
    var tm = dict(); (itemsOf(config) || []).forEach(function (x) { if (x.kind === 'time') tm[x.code] = 1; });
    return (Array.isArray(extrasRows) ? extrasRows : []).some(function (r) { return r && !r.voided_at && typeof r.code === 'string' && (r.code === MEETING_OT_DEFAULT.code || own(tm, r.code)) && +r.minutes > 0; });
  }
  var MEETING_UNSAVED_TEXT = '社内会議を時間外に足すかを、設定のタブで保存してから締めてください';
  var MEETING_OVER_TEXT = '会議の時間が、この日の数えなかった時間より多くなっています。会議の時間が打刻の中で払われていないか確かめてください';
  var MEETING_INPUT_HELP = '予定の外で、残業として認めていない会議の時間を入れます';
  /* 回数の元の名前の形（payroll-calc.js と同じ）。シフトの記号はこの形にならない（試験で確かめる） */
  var SRC_RE = /^[xtgk]:[A-Za-z0-9_-]{1,20}$/;
  /* 回数の元の表示名（給与の画面の選び・明細の根拠）。def は控えの ext.def か defOf(config) */
  function srcLabel(src, def) {
    if (typeof src !== 'string' || !SRC_RE.test(src)) return src;
    var kd = src.charAt(0), code = src.slice(2), d = def || {};
    if (kd === 'k') return '通勤回数';
    if (kd === 'g') { var g = (d.groups || []).filter(function (x) { return x.code === code; })[0]; return '記号の組：' + (g ? g.name : code); }
    var it = (d.items || []).filter(function (x) { return x.code === code; })[0];
    var nm = it ? nameOf(it) : code;
    return '補助項目：' + nm + (kd === 't' && nm.slice(-4) !== '（時間）' ? '（時間）' : '');   /* 名前が「…（時間）」なら重ねない */
  }
  /* 会議の足し分を 36協定の見張りの月の行に足す分（丸める前）: 締めた月は控えの adj から（休日分＝adj.holidayMin−行の holidayMin）、
   * 締めていない月は extrasRows から数える。返す: { non, hol }（分） */
  function meeting36(adj, row) {
    if (!adj || typeof adj !== 'object') return { non: 0, hol: 0 };
    var tot = Math.max(0, +adj.meetingMin || 0), hol = Math.max(0, Math.min(tot, (+adj.holidayMin || 0) - (+(row && row.holidayMin) || 0)));
    return { non: tot - hol, hol: hol };
  }
  function meetingSplitOf(month, extrasRows, config, sid) {
    var mo = meetingOtOf(config), items = itemsOf(config) || [], non = 0, hol = 0;
    if (!mo || !mo.on) return { non: 0, hol: 0 };
    var it = items.filter(function (x) { return x.code === mo.code && x.kind === 'time'; })[0];
    if (!it) return { non: 0, hol: 0 };
    var p = ((month && month.people) || []).filter(function (x) { return x && x.staff && x.staff.staff_id === sid; })[0];
    if (!p || (p.sum && p.sum.imported)) return { non: 0, hol: 0 };
    var by = dict(); (p.days || []).forEach(function (d) { if (d && typeof d.date === 'string') by[d.date] = d; });
    (Array.isArray(extrasRows) ? extrasRows : []).forEach(function (r) {
      if (!r || r.voided_at || r.staff_id !== sid || r.code !== it.code || r.minutes == null || !isFinite(+r.minutes)) return;
      if (isLegalHoliday(r.date, by[r.date], (month && month.config) || {})) hol += Math.round(+r.minutes); else non += Math.round(+r.minutes);
    });
    return { non: non, hol: hol };
  }

  /* 月の集計の CSV（buildCsv の summary に補助項目の列を足した後の文）の末尾に、段A2 の列を足す（今の列の並びは変えない・行も足さない）:
   *   使う記号の組ごとに「<組の名前>（回）」・通勤回数を数える時は「通勤回数（回）」・会議を時間外に足す時は「時間外（社内会議を含む）」
   * ctx: { people: csvPeople の結果, ext: 控えの形（buildExt の結果）, base: { staff_id: 足す前の時間外（分） }, imported: { staff_id: 1 }, mode: 'hmm'|'dec' }
   * 取り込みの人の記号の組・通勤回数は数えていないので空（時間外は足す前の値）。同じ従業員コードの人が2人以上いる行は空（appendCsv と同じ）。
   * 列が1つも無い時は文をそのまま返す。返す: { text, cols: 足した列の数 } */
  function extCols(ext) {
    var d = isExt(ext) ? cleanDef(ext.def) : null, cols = [];
    if (!d) return cols;
    d.groups.filter(function (g) { return g.active; }).forEach(function (g) { cols.push({ key: 'g:' + g.code, head: g.name + '（回）', kind: 'n' }); });
    if (d.commute) cols.push({ key: 'k:commute', head: '通勤回数（回）', kind: 'n' });
    if (d.meetingOt && d.meetingOt.on) cols.push({ key: 'ot', head: '時間外（社内会議を含む）', kind: 't' });
    return cols;
  }
  function appendExtCsv(text, ctx) {
    var cols = extCols(ctx && ctx.ext);
    if (!cols.length || typeof text !== 'string' || !text) return { text: text, cols: 0 };
    var rows = ctx.ext.rows || {}, base = ctx.base || {}, imp = ctx.imported || {}, mode = ctx.mode === 'dec' ? 'dec' : 'hmm';
    var people = (ctx.people || []).filter(function (p) { return p && p.emp_code; }), byEmp = dict(), cnt = dict(), out = [];
    people.forEach(function (p) { var e = String(p.emp_code); cnt[e] = (cnt[e] || 0) + 1; if (!own(byEmp, e)) byEmp[e] = p; });
    var cell = function (v) { return C.csvCell(v); };
    splitCsv(text).forEach(function (r, idx) {
      if (idx === 0) { out.push(r.raw + ',' + cols.map(function (c) { return cell(c.head); }).join(',')); return; }
      var emp = r.cells[0] || '', p = own(byEmp, emp) && cnt[emp] === 1 ? byEmp[emp] : null, sid = p ? p.staff_id : null;
      var er = sid && own(rows, sid) ? rows[sid] : {};
      out.push(r.raw + ',' + cols.map(function (c) {
        if (!sid) return '';
        if (c.kind === 't') { var lo = er.adj && typeof er.adj.legalOverMin === 'number' ? er.adj.legalOverMin : (+base[sid] || 0); return cell(C.fmtMin(lo, mode)); }
        if (own(imp, sid)) return '';
        return cell(String(+er[c.key] || 0));
      }).join(','));
    });
    return { text: out.join('\r\n') + '\r\n', cols: cols.length };
  }

  var api = {
    MAX_ITEMS: MAX_ITEMS, CODE_RE: CODE_RE, NAME_MAX: NAME_MAX, UNIT_MAX: UNIT_MAX, QTY_MAX: QTY_MAX, COUNT_MAX: COUNT_MAX, MIN_MAX: MIN_MAX, KINDS: KINDS,
    EXTRA_ITEMS_DEFAULT: EXTRA_ITEMS_DEFAULT, copyDefault: copyDefault, cleanExtraItems: cleanExtraItems, checkForm: checkForm, itemsOf: itemsOf, activeItems: activeItems, csvItems: csvItems, nameOf: nameOf, mismatchText: mismatchText,
    parseValue: parseValue, minutesOf: minutesOf, sumExtras: sumExtras, fmtValue: fmtValue, label: label, colHead: colHead, splitCsv: splitCsv, csvPeople: csvPeople, appendCsv: appendCsv,
    /* 段A2 */
    GROUPS_MAX: GROUPS_MAX, GROUP_SYM_MAX: GROUP_SYM_MAX, MINUS_MAX: MINUS_MAX, SRC_RE: SRC_RE, SYMBOL_GROUPS_DEFAULT: SYMBOL_GROUPS_DEFAULT, COMMUTE_DEFAULT: COMMUTE_DEFAULT, MEETING_OT_DEFAULT: MEETING_OT_DEFAULT,
    MEETING_OVER_TEXT: MEETING_OVER_TEXT, MEETING_INPUT_HELP: MEETING_INPUT_HELP, normSym: normSym, cleanSymbolGroups: cleanSymbolGroups, cleanCommute: cleanCommute, cleanMeetingOt: cleanMeetingOt,
    groupsOf: groupsOf, commuteOf: commuteOf, meetingOtOf: meetingOtOf, defOf: defOf, cleanDef: cleanDef, isLegalHoliday: isLegalHoliday, adjOf: adjOf, buildExt: buildExt, buildExtDef: buildExtDef,
    isExt: isExt, sameExt: sameExt, meetingOverUncounted: meetingOverUncounted, srcLabel: srcLabel, meeting36: meeting36, meetingSplitOf: meetingSplitOf, copyJson: copyJson, extCols: extCols, appendExtCsv: appendExtCsv, meetingUnsaved: meetingUnsaved, MEETING_UNSAVED_TEXT: MEETING_UNSAVED_TEXT
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiExtras = api;
})(typeof window !== 'undefined' ? window : this);
