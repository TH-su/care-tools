/* symbols.js — シフト記号の正規化・パース（純粋関数・依存ゼロ）
 * 旧Safari互換のため ?. / ?? / replaceAll は使用しない */
(function () {
  'use strict';

  /* 全角→半角・揺れ正規化 */
  function normalizeCell(raw) {
    if (raw === null || raw === undefined) return '';
    var s = String(raw);
    var FW = '０１２３４５６７８９';
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var fi = FW.indexOf(c);
      if (fi >= 0) { out += String(fi); continue; }
      if (c === '（') { out += '('; continue; }
      if (c === '）') { out += ')'; continue; }
      if (c === '：') { out += ':'; continue; }
      if (c === '～' || c === '〜' || c === '−' || c === 'ー' || c === '－' || c === '―') { out += '-'; continue; }
      if (c === '　' || c === ' ' || c === '\t') { continue; }
      out += c;
    }
    return out;
  }

  /* おすすめ配色（区分別・セル背景＋文字色）。記号コード優先・無ければ区分(cat)で適用。
   * 配色は参考シート「希望シフト回答」(条件付き書式)から抽出した色に統一:
   *   早=#ead1dc / 遅=#cfe2f3 / 休系=#fff2cc+赤文字 / 有=#f4cccc / 日勤・夜勤・明け=白。 */
  var RECOMMENDED_BY_CODE = {
    '早':  { color: '#ead1dc', textColor: '#000000' },
    '日1': { color: '#ffffff', textColor: '#000000' },
    '日2': { color: '#ffffff', textColor: '#000000' },
    '日3': { color: '#ffffff', textColor: '#000000' },
    '遅':  { color: '#cfe2f3', textColor: '#000000' },
    '(21': { color: '#ffffff', textColor: '#000000' },
    '(22': { color: '#ffffff', textColor: '#000000' },
    '7)':  { color: '#ffffff', textColor: '#000000' },
    '8)':  { color: '#ffffff', textColor: '#000000' },
    '休':  { color: '#fff2cc', textColor: '#ff0000' },
    '公':  { color: '#fff2cc', textColor: '#ff0000' },
    '希':  { color: '#fff2cc', textColor: '#ff0000', bold: true },
    '有':  { color: '#f4cccc', textColor: '#000000' },
    '明':  { color: '#ffffff', textColor: '#666666' },
    '欠':  { color: '#fff2cc', textColor: '#ff0000', bold: true }
  };
  var RECOMMENDED_BY_CAT = {
    early: { color: '#ead1dc', textColor: '#000000' },
    mid:   { color: '#ffffff', textColor: '#000000' },
    late:  { color: '#cfe2f3', textColor: '#000000' },
    night: { color: '#ffffff', textColor: '#000000' },
    off:   { color: '#fff2cc', textColor: '#ff0000' }
  };

  /* 記号の色をこの区分の行に出してよいか（2026-07-24 追加）。
   * sym.colorDiv が未設定（既存記号すべて）なら true ＝全区分に出す＝従来と完全に同じ挙動。
   * 「9-12」のように通所でだけ意味を持つ記号に colorDiv:'通所' を設定すると、
   * 施設行・訪問行に同じ値を書いても背景色が付かなくなる（値と実働計算には一切影響しない）。 */
  function colorAppliesTo(sym, division) {
    if (!sym || !sym.colorDiv) return true;
    return sym.colorDiv === division;
  }

  function recommendedFor(sym) {
    var byCode = RECOMMENDED_BY_CODE[normalizeCell(sym.code)] || RECOMMENDED_BY_CODE[sym.code];
    if (byCode) return byCode;
    return RECOMMENDED_BY_CAT[sym.cat] || null;
  }

  /* 記号配列におすすめ配色を適用（color/textColor/bold を上書き）。新しい配列を返す */
  function applyRecommendedColors(symbols) {
    var out = [];
    for (var i = 0; i < symbols.length; i++) {
      var s = {};
      for (var k in symbols[i]) s[k] = symbols[i][k];
      var rec = recommendedFor(s);
      if (rec) {
        s.color = rec.color;
        s.textColor = rec.textColor;
        s.bold = !!rec.bold;
      }
      out.push(s);
    }
    return out;
  }

  /* 既定の記号マスタ（マスタ画面から動的に追加・編集される）。おすすめ配色を適用済み */
  var DEFAULT_SYMBOLS = applyRecommendedColors([
    { code: '早',  label: '早番(7:00-16:00)',   type: 'work', start: '7:00',  end: '16:00', cat: 'early' },
    { code: '日1', label: '日勤1(8:00-17:00)',  type: 'work', start: '8:00',  end: '17:00', cat: 'mid' },
    { code: '日2', label: '日勤2(8:30-17:30)',  type: 'work', start: '8:30',  end: '17:30', cat: 'mid' },
    { code: '日3', label: '日勤3(9:00-18:00)',  type: 'work', start: '9:00',  end: '18:00', cat: 'mid' },
    { code: '遅',  label: '遅番(12:00-21:00)',  type: 'work', start: '12:00', end: '21:00', cat: 'late' },
    { code: '(21', label: '夜勤入り21時',  type: 'nightIn',  start: '21:00', pairEnd: '7:00',  cat: 'night' },
    { code: '(22', label: '夜勤入り22時',  type: 'nightIn',  start: '22:00', pairEnd: '8:00',  cat: 'night' },
    { code: '7)',  label: '夜勤上がり7時', type: 'nightOut', end: '7:00',  cat: 'night' },
    { code: '8)',  label: '夜勤上がり8時', type: 'nightOut', end: '8:00',  cat: 'night' },
    { code: '休',  label: '公休',   type: 'off',       cat: 'off' },
    { code: '希',  label: '希望休', type: 'off',       cat: 'off', sub: '希望休' },
    { code: '公',  label: '公休',   type: 'publicOff', cat: 'off' },
    { code: '有',  label: '有給',   type: 'paidOff',   cat: 'off', fixedWork: 8 },
    { code: '明',  label: '夜勤明け', type: 'off',     cat: 'off' }
  ]);

  /* 別名（取込データの揺れ吸収） */
  var ALIASES = { '希休': '希', '有休': '有', '公休': '公', '希望休': '希', '有給': '有' };

  function timeToMin(t) {
    if (t === null || t === undefined) return null;
    var s = normalizeCell(String(t));
    var m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mm = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 30 || mm > 59) return null;
    return h * 60 + mm;
  }

  function minToTime(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h + (m ? ':' + (m < 10 ? '0' + m : m) : ':00');
  }

  function findSymbol(symbols, codeNorm) {
    for (var i = 0; i < symbols.length; i++) {
      if (symbols[i].disabled) continue;
      if (normalizeCell(symbols[i].code) === codeNorm) return symbols[i];
    }
    return null;
  }

  var RE_RANGE = /^(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)$/;
  var RE_NIGHT_OUT = /^(\d{1,2}(?::\d{2})?)\)/;          // 先頭の「7)」
  var RE_NIGHT_IN = /\((\d{1,2}(?::\d{2})?)$/;            // 末尾の「(21」

  /* セル文字列 → パーツ配列
   * 返値: { raw, norm, parts: [ {kind, ...} ], error }
   *  kind: 'work'{startMin,endMin} / 'nightIn'{startMin,pairEndMin} /
   *        'nightOut'{endMin} / 'off' / 'paidOff'{fixedWork} / 'publicOff'
   */
  function parseCell(raw, symbols) {
    if (!symbols) symbols = DEFAULT_SYMBOLS;
    /* 分割勤務（複合セル）: 「7-9 17-21」のように空白で区切られた複数トークンは
     * normalizeCell が空白を除去して1語に潰し解釈不能になる。先に生文字列を空白で分割し、
     * 2語以上なら各トークンを個別に解釈して parts を結合する。これにより早番(7-9)＋遅番(17-21)が
     * 両方カウントされ、実働時間も正しく合算される（汎用・氏名ハードコード非依存）。 */
    var rawStr = (raw === null || raw === undefined) ? '' : String(raw);
    /* 同行(早遅手当なし)の接尾「/同」「／同」を剥がして goudou フラグ化し、本体(早/遅/18-21等)を通常解釈する。
     * freee 出力側がこのフラグで手当なしコード(151/152/153)へ振り分ける。記号「同」の定義は不要。 */
    var goudou = false;
    var gm = rawStr.match(/[\/／][\s　]*同[\s　]*$/);
    if (gm) { goudou = true; rawStr = rawStr.slice(0, gm.index); }
    var toks = rawStr.split(/[\s　\t]+/);
    var nonEmpty = [];
    for (var ti = 0; ti < toks.length; ti++) { if (toks[ti] !== '') nonEmpty.push(toks[ti]); }
    if (nonEmpty.length >= 2) {
      var multi = { raw: raw, norm: normalizeCell(rawStr), parts: [], error: null, goudou: goudou };
      for (var tk = 0; tk < nonEmpty.length; tk++) {
        var sub = parseCell(nonEmpty[tk], symbols);   /* 各トークンは空白を含まない＝単一解釈へ */
        for (var sp = 0; sp < sub.parts.length; sp++) multi.parts.push(sub.parts[sp]);
        if (sub.error && !multi.error) multi.error = sub.error;
      }
      return multi;
    }
    var norm = normalizeCell(rawStr);
    var res = { raw: raw, norm: norm, parts: [], error: null, goudou: goudou };
    if (norm === '') return res;
    if (ALIASES[norm]) norm = ALIASES[norm];

    /* 1) 記号マスタ完全一致 */
    var sym = findSymbol(symbols, norm);
    if (sym) { res.parts.push(symbolToPart(sym)); return res; }

    /* 2) 範囲記号 9-12 / 7-8:30 等 */
    var m = norm.match(RE_RANGE);
    if (m) {
      var st = timeToMin(m[1]), en = timeToMin(m[2]);
      if (st !== null && en !== null && en > st && en <= 24 * 60) {
        res.parts.push({ kind: 'work', startMin: st, endMin: en, cat: rangeCat(st, en) });
        return res;
      }
      res.error = '時刻範囲を解釈できません: ' + norm;
      return res;
    }

    /* 3) 夜勤複合 8)(22 ・単独 7) ・ (21 */
    var rest = norm;
    var mo = rest.match(RE_NIGHT_OUT);
    if (mo) {
      var outSym = findSymbol(symbols, mo[1] + ')');
      var endMin = timeToMin(mo[1]);
      res.parts.push({ kind: 'nightOut', endMin: endMin,
        pairKnown: !!outSym });
      rest = rest.slice(mo[0].length);
    } else if (rest.charAt(0) === ')') {
      /* 上がり時刻を書かない明け「)」「)(希」（2026-08-24 依頼）。時刻不明の夜勤上がりとして扱う。
       * これまでは解釈できずCSVに1行も出なかった。実働時間は timecalc が前日の夜勤入りの
       * 定時上がり(pairEnd)で仮計算し「夜勤上がりが未入力」を警告する（従来の未入力時と同じ扱い）。
       * freee 出力では明けの日＝休み扱いのため、時刻が無くても公休/欠勤を決められる。 */
      res.parts.push({ kind: 'nightOut', endMin: null, pairKnown: false });
      rest = rest.slice(1);
    }
    if (rest !== '') {
      var mi = rest.match(RE_NIGHT_IN);
      if (mi && rest.charAt(0) === '(') {
        var inSym = findSymbol(symbols, '(' + mi[1]);
        var stMin = timeToMin(mi[1]);
        var part = { kind: 'nightIn', startMin: stMin,
          pairEndMin: inSym && inSym.pairEnd ? timeToMin(inSym.pairEnd) : null };
        res.parts.push(part);
        rest = '';
      } else if (rest.charAt(0) === '(') {
        /* 「(有」のような夜枠の代替記号 */
        var alt = rest.slice(1);
        if (ALIASES[alt]) alt = ALIASES[alt];
        var altSym = findSymbol(symbols, alt);
        if (altSym && altSym.type !== 'work') {
          res.parts.push(symbolToPart(altSym));
          rest = '';
        }
      }
    }
    if (res.parts.length === 0) {
      res.error = '解釈できない記号: ' + norm;
    } else if (rest !== '') {
      res.error = '一部を解釈できません: ' + norm;
    }
    return res;
  }

  function symbolToPart(sym) {
    if (sym.type === 'work') {
      return { kind: 'work', startMin: timeToMin(sym.start), endMin: timeToMin(sym.end), cat: sym.cat || 'mid', code: sym.code };
    }
    if (sym.type === 'nightIn') {
      return { kind: 'nightIn', startMin: timeToMin(sym.start), pairEndMin: timeToMin(sym.pairEnd), code: sym.code };
    }
    if (sym.type === 'nightOut') {
      return { kind: 'nightOut', endMin: timeToMin(sym.end), pairKnown: true, code: sym.code };
    }
    if (sym.type === 'paidOff') {
      return { kind: 'paidOff', fixedWork: (typeof sym.fixedWork === 'number' ? sym.fixedWork : 8), code: sym.code };
    }
    if (sym.type === 'publicOff') return { kind: 'publicOff', code: sym.code };
    return { kind: 'off', code: sym.code, sub: sym.sub || null };
  }

  /* 範囲記号の早遅分類（残数カウント用）:
   *  開始7:30以前=早系 / 終了20:00(1200分)以降=遅系（開始時刻を問わず・要件2「20時までの勤務は遅番」）。
   *  早番（早朝開始）を優先し、それ以外で20時以降まで勤務する枠は全て遅番に計上する。 */
  function rangeCat(startMin, endMin) {
    if (startMin <= 450) return 'early';
    if (endMin >= 1200) return 'late';   /* 20時以降まで勤務＝遅番（例 9-20/11-20/13-20/12-21/17-21 等） */
    return 'mid';
  }

  /* 職員ごとの「早番に数える開始時刻の上限」（2026-09-28・staff.rules.earlyStartMax・分）。
   * 既定（未設定）は従来どおり: 記号の分類・範囲の rangeCat（開始7:30まで＝早番）をそのまま使う。
   * 設定がある職員は、早番に分類された勤務でも開始がこの時刻より遅ければ日勤(mid)として数える
   * （例: 420＝7:00開始までを早番。7:30開始は日勤）。早番の人数の数え方だけを変え、
   * 勤務時間・区分・freee 出力には関わらない。氏名ではなく職員の設定で持つ（個人情報をコードに書かない）。 */
  var EARLY_START_MAX_CHOICES = [420];   /* 画面で選べる値（7:00まで）。未設定＝従来どおり */
  function earlyStartMaxOf(st) {
    var v = (st && st.rules) ? st.rules.earlyStartMax : null;
    return (typeof v === 'number' && isFinite(v) && v >= 0 && v < 1440) ? v : null;
  }
  function effectiveCat(cat, startMin, earlyStartMax) {
    if (cat !== 'early' || typeof earlyStartMax !== 'number') return cat;
    if (typeof startMin !== 'number') return cat;
    return startMin > earlyStartMax ? 'mid' : 'early';
  }

  /* 夜勤上がりの残業判定（表示ハイライト用）。
   * セル先頭の夜勤上がり（例「8)」）の実際の上がり時刻が、前日の夜勤入りの定時上がり(pairEnd)
   * より遅ければ残業。(21=定時7:00→「8)」は残業／(22=定時8:00→「8)」は通常／「7)」は定時。
   * timecalc の残業計算(endMin > nightIn.pairEndMin)と同じ基準。前日入りが特定できなければ非残業扱い。
   * 戻り値: 装飾すべき先頭夜勤上がり文字列の長さ（0=ハイライト無し）。 */
  function leadingNightOutOvertime(prevRaw, cellRaw, symbols) {
    if (!symbols) symbols = DEFAULT_SYMBOLS;
    var s = (cellRaw === null || cellRaw === undefined) ? '' : String(cellRaw);
    var m = s.match(/^(\d{1,2}(?::\d{2})?|[０-９]{1,2}(?:：[０-９]{2})?)[)）]/);  /* 先頭の「8)」「8）」(全角含む) */
    if (!m) return 0;
    var endMin = timeToMin(normalizeCell(m[1]));
    if (endMin === null) return 0;
    var prev = parseCell(prevRaw, symbols);
    var pairEnd = null, i;
    for (i = 0; i < prev.parts.length; i++) {
      if (prev.parts[i].kind === 'nightIn' && prev.parts[i].pairEndMin != null) { pairEnd = prev.parts[i].pairEndMin; break; }
    }
    if (pairEnd === null) return 0;            /* 前日入り不明＝判定不能＝ハイライトしない（安全側） */
    return endMin > pairEnd ? m[0].length : 0; /* 定時より遅い＝残業＝先頭夜勤上がりを装飾 */
  }

  /* ===== 許可パターン反映用（実シフトから使用中の勤務パターンを検出・安全に記号登録） ===== */

  /* 単一トークンが「範囲勤務(9-12 等)」なら正規化情報を返す。②RE_RANGE と完全同条件（en>st・en≤1440）。
   * 返値の start/end は元の左右辺(コロン有無そのまま)＝timeToMin が②と同値になる。cat も rangeCat で②一致。 */
  function parseRangeToken(norm) {
    var m = String(norm == null ? '' : norm).match(RE_RANGE);
    if (!m) return null;
    var st = timeToMin(m[1]), en = timeToMin(m[2]);
    if (st === null || en === null || !(en > st) || en > 24 * 60) return null;
    return { norm: normalizeCell(norm), start: m[1], end: m[2], startMin: st, endMin: en, cat: rangeCat(st, en) };
  }

  /* 範囲値→記号オブジェクト（回帰ゼロのレシピ: type work・start/end=左右辺・cat=rangeCat・色空・太字なし）。 */
  function buildRangeSymbol(r) {
    return { code: r.norm, type: 'work', start: r.start, end: r.end,
             cat: r.cat, color: '', textColor: '', bold: false };
  }

  /* 1職員のセル生値配列から、勤務系の「使用中記号code」と「未登録の範囲パターン」を集める。
   * 休み系(off/paidOff/publicOff)は常時許可のため除外。夜勤複合(8)(22)は 8) と (22 に分解して既存codeを拾う。 */
  function collectUsedWorkTokens(symbols, values) {
    if (!symbols) symbols = DEFAULT_SYMBOLS;
    var codes = [], ranges = [], seenCode = {}, seenRange = {}, i, v;
    function addCode(c) { if (c && !seenCode[c]) { seenCode[c] = 1; codes.push(c); } }
    for (i = 0; i < (values || []).length; i++) {
      v = values[i];
      var raw = (v === null || v === undefined) ? '' : String(v);
      var toks = raw.split(/[\s　\t]+/);
      for (var ti = 0; ti < toks.length; ti++) {
        if (toks[ti] === '') continue;
        var nt = normalizeCell(toks[ti]);
        if (nt === '') continue;
        if (ALIASES[nt]) nt = ALIASES[nt];
        /* ① 既登録記号: 勤務系(work/nightIn/nightOut)のみ採用。休み系は常時許可＝除外 */
        var sym = findSymbol(symbols, nt);
        if (sym) {
          if (sym.type === 'work' || sym.type === 'nightIn' || sym.type === 'nightOut') addCode(sym.code);
          continue;
        }
        /* ② 未登録の範囲勤務 */
        var r = parseRangeToken(nt);
        if (r) { if (!seenRange[r.norm]) { seenRange[r.norm] = 1; ranges.push(r); } continue; }
        /* ③ 夜勤複合 8)(22 → 8) と (22 の既存記号codeを拾う（単独は①で処理済み） */
        var got = false;
        var mo = nt.match(RE_NIGHT_OUT);
        var rest = nt;
        if (mo) { var oSym = findSymbol(symbols, normalizeCell(mo[1] + ')')); if (oSym) { addCode(oSym.code); got = true; } rest = nt.slice(mo[0].length); }
        var mi = rest.match(RE_NIGHT_IN);
        if (mi && rest.charAt(0) === '(') { var iSym = findSymbol(symbols, normalizeCell('(' + mi[1])); if (iSym) { addCode(iSym.code); got = true; } }
        /* got=false（22-8 等の解釈不能・off外）は無視 */
      }
    }
    return { codes: codes, ranges: ranges };
  }

  /* 範囲パターン群を、既存記号(disabled含む)に同codeが無い時だけ「新規記号オブジェクト配列」として返す（末尾追加用・非破壊）。 */
  function registerRangeSymbols(symbols, rangeObjs) {
    var existing = {}, i;
    for (i = 0; i < (symbols || []).length; i++) existing[normalizeCell(symbols[i].code)] = 1;   /* disabled も含めて重複判定 */
    var news = [], seen = {};
    for (i = 0; i < (rangeObjs || []).length; i++) {
      var code = normalizeCell(rangeObjs[i].norm);
      if (!code || existing[code] || seen[code]) continue;
      seen[code] = 1;
      news.push(buildRangeSymbol({ norm: code, start: rangeObjs[i].start, end: rangeObjs[i].end, cat: rangeObjs[i].cat }));
    }
    return news;
  }

  var api = {
    normalizeCell: normalizeCell,
    timeToMin: timeToMin,
    minToTime: minToTime,
    parseCell: parseCell,
    rangeCat: rangeCat,
    EARLY_START_MAX_CHOICES: EARLY_START_MAX_CHOICES,
    earlyStartMaxOf: earlyStartMaxOf,
    effectiveCat: effectiveCat,
    parseRangeToken: parseRangeToken,
    collectUsedWorkTokens: collectUsedWorkTokens,
    registerRangeSymbols: registerRangeSymbols,
    leadingNightOutOvertime: leadingNightOutOvertime,
    DEFAULT_SYMBOLS: DEFAULT_SYMBOLS,
    ALIASES: ALIASES,
    applyRecommendedColors: applyRecommendedColors,
    colorAppliesTo: colorAppliesTo,
    RECOMMENDED_BY_CODE: RECOMMENDED_BY_CODE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ShiftSymbols = api;
})();
