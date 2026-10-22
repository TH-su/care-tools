/* yakujo-calc.js — 薬情の取り込み（入居者マスタ）の純関数（2026-10-22・代表者の決定）
 *
 * 薬情よみとり（yakujo-reader/・事務所の Mac の道具）が作った「結果のファイル」を読み、
 *   1. 誰の書類か（振り分け）
 *   2. 調剤日
 *   3. 薬の行（薬名・量・用法・日数）
 * を組み立てる。DOM・通信・保存に触れない（入居者マスタの画面が使い、check/unit の試験が確かめる）。
 *
 * 守ること
 * - 読んだ文字・画像は引数で受け取って返すだけ。どこにも保存しない・送らない・console に出さない
 * - 振り分けは「名簿の1人にだけ一字一致」の時だけ決める。あいまいな一致（文字の近さ）では決めない
 *   （書類にカナがある時は、氏名とカナが同じ1人に一致した時だけ。カナが無い時は、その方と同姓同名・
 *     氏名が1字違いの在籍者がいない時だけ・代表者の決定 2026-10-22）
 * - 迷う所は決めずに「確かめる」の印（warn）を付けて返す。反映を止めるかどうかは画面が決める
 */
(function (root) {
  'use strict';

  var MAX_DOCS = 20, MAX_PAGES = 10, MAX_LINES = 3000, MAX_TEXT = 300;

  function nfkc(s) { var t = String(s == null ? '' : s); try { t = t.normalize('NFKC'); } catch (e) {} return t; }
  /* 照合用: NFKC・空白を除く・末尾の敬称を除く */
  function nz(s) { return nfkc(s).replace(/[\s　]+/g, '').replace(/(様|さま|さん|殿|氏)$/, ''); }
  /* カナ照合用: ひらがなにそろえ、空白と敬称（さま・様）を除く */
  function kn(s) {
    var t = nfkc(s).replace(/[\s　]+/g, '');
    t = t.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
    return t.replace(/(さま|様|さん|どの)$/, '');
  }
  function num(v, lo, hi) { var n = Number(v); if (!isFinite(n)) return lo; return Math.min(hi, Math.max(lo, n)); }

  /* ── 1. 結果のファイルを読む（形を確かめ、余計な物を捨てる）── */
  function parseResult(text) {
    var d;
    try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, why: 'ファイルを読めません（薬情よみとりの結果のファイルではありません）' }; }
    if (!d || typeof d !== 'object' || d.kind !== 'yakujo-yomitori') return { ok: false, why: '薬情よみとりの結果のファイルではありません' };
    if (d.v !== 1) return { ok: false, why: 'この結果のファイルの版（' + String(d.v) + '）には対応していません。薬情よみとりと入居者マスタを新しくしてください' };
    if (!Array.isArray(d.docs)) return { ok: false, why: '結果のファイルの中身が足りません' };
    var docs = [];
    d.docs.slice(0, MAX_DOCS).forEach(function (x, i) {
      if (!x || typeof x !== 'object') return;
      var pages = [];
      (Array.isArray(x.pages) ? x.pages : []).slice(0, MAX_PAGES).forEach(function (p, j) {
        if (!p || typeof p !== 'object') return;
        var img = typeof p.img === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.img) ? p.img : '';
        var lines = [];
        (Array.isArray(p.lines) ? p.lines : []).slice(0, MAX_LINES).forEach(function (l) {
          if (!l || typeof l !== 'object') return;
          var t = nfkc(l.t).replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TEXT);
          if (!t) return;
          lines.push({ t: t, x: num(l.x, 0, 1), y: num(l.y, 0, 1), w: num(l.w, 0, 1), h: num(l.h, 0, 1), c: num(l.c, 0, 1) });
        });
        var codes = p.codes && typeof p.codes === 'object' ? p.codes : {};
        pages.push({ no: j + 1, w: Math.round(num(p.w, 0, 20000)), h: Math.round(num(p.h, 0, 20000)), img: img, lines: lines,
          qr: Math.round(num(codes.qr, 0, 99)) });
      });
      docs.push({ no: i + 1, file: String(x.file == null ? '' : x.file).slice(0, 200), type: x.type === 'pdf' ? 'pdf' : 'photo',
        error: String(x.error == null ? '' : x.error).slice(0, 200), pages: pages });
    });
    var skipped = (Array.isArray(d.skipped) ? d.skipped : []).slice(0, 200).map(function (s) {
      return { file: String(s && s.file || '').slice(0, 200), why: String(s && s.why || '').slice(0, 200) };
    });
    var created = typeof d.createdAt === 'string' ? d.createdAt.slice(0, 40) : '';
    return { ok: true, createdAt: created, docs: docs, skipped: skipped };
  }

  /* 2つの文字列の違いの数（上限 cap を超えたら cap+1） */
  function dist(a, b, cap) {
    cap = cap == null ? 3 : cap;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* ── 2. 誰の書類か ──
     roster: [{id, name, kana, active}]。在籍（active が true）の方だけを相手にする。
     戻り値 {id, how, why, cands:[{id, how}], pages:[{ids, kana}]}
       id が '' の時は未振分（why に理由） */
  function assign(doc, roster) {
    var act = (Array.isArray(roster) ? roster : []).filter(function (r) { return r && r.active === true && nz(r.name).length >= 2; });
    var res = { id: '', how: '', why: '', cands: [], pages: [] };
    var nameHit = {}, kanaHit = {}, kanaLines = 0, pageIds = [];
    doc.pages.forEach(function (p) {
      var ids = {};
      p.lines.forEach(function (l) {
        var z = nz(l.t), k = kn(l.t);
        if (/^[ぁ-ゖー]{3,}$/.test(k) && k.length <= 20) kanaLines++;
        act.forEach(function (r) {
          var n = nz(r.name);
          if (z.indexOf(n) >= 0) { ids[r.id] = 1; nameHit[r.id] = 1; }
          var rk = kn(r.kana);
          if (rk.length >= 3 && k.indexOf(rk) >= 0) kanaHit[r.id] = 1;
        });
      });
      var list = Object.keys(ids);
      pageIds.push(list);
      res.pages.push({ ids: list });
    });
    var names = Object.keys(nameHit), kanas = Object.keys(kanaHit);
    names.forEach(function (id) { res.cands.push({ id: id, how: kanaHit[id] ? '氏名とカナ' : '氏名' }); });
    kanas.forEach(function (id) { if (!nameHit[id]) res.cands.push({ id: id, how: 'カナ' }); });
    if (!names.length) {
      /* 似た名前の候補（1字違い）は出すが、決めない */
      act.forEach(function (r) {
        var n = nz(r.name), near = false;
        doc.pages.forEach(function (p) { p.lines.forEach(function (l) {
          var z = nz(l.t);
          for (var w = n.length - 1; w <= n.length + 1 && !near; w++) {
            for (var s = 0; s + w <= z.length && !near; s++) if (w > 0 && dist(n, z.slice(s, s + w), 1) === 1) near = true;
          }
        }); });
        if (near && !kanaHit[r.id]) res.cands.push({ id: r.id, how: '似た名前' });
      });
      res.why = kanas.length ? 'カナだけが一致しました（氏名が読めていません）' : '名簿の方の氏名が見つかりません';
      return res;
    }
    if (names.length > 1) { res.why = '名簿の ' + names.length + ' 名の氏名が見つかりました（どの方か決められません）'; return res; }
    var id = names[0];
    var mixed = pageIds.some(function (l) { return l.length && (l.length > 1 || l[0] !== id); });
    if (mixed) { res.why = 'ページごとに氏名が違います'; return res; }
    if (kanas.length && !(kanas.length === 1 && kanaHit[id])) { res.why = '氏名とカナが別の方に一致しました'; return res; }
    if (kanaHit[id]) { res.id = id; res.how = '氏名とカナが一致'; return res; }
    if (kanaLines) { res.why = '書類にカナがありますが、この方のカナと一致しません'; return res; }
    /* カナの無い書類: 同姓同名・氏名が1字違いの在籍者がいれば決めない（代表者の決定 2026-10-22） */
    var me = act.filter(function (r) { return String(r.id) === String(id); })[0], mn = nz(me.name);
    var twin = act.some(function (r) { return String(r.id) !== String(id) && dist(nz(r.name), mn, 1) <= 1; });
    if (twin) { res.why = '名簿に、同じ名前か1字違いの方がいます（どの方か確かめてください）'; return res; }
    res.id = id; res.how = '氏名が一致（カナなし）';
    return res;
  }

  /* ── 3. 調剤日 ── 'YYYY-MM-DD' の一覧。labeled は「調剤日」などの語の近く、other はそれ以外（生年月日は除く） */
  var ERA = { '明治': 1867, '大正': 1911, '昭和': 1925, '平成': 1988, '令和': 2018, 'M': 1867, 'T': 1911, 'S': 1925, 'H': 1988, 'R': 2018 };
  function ymd(y, m, d) {
    y = +y; m = +m; d = +d;
    if (!(y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return '';
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function datesIn(t) {
    var s = nfkc(t).replace(/\s+/g, ''), out = [], m;
    var re1 = /(20\d\d)[年./-](\d{1,2})[月./-](\d{1,2})日?/g;
    while ((m = re1.exec(s))) { var a = ymd(m[1], m[2], m[3]); if (a) out.push(a); }
    var re2 = /(令和|平成|[RH])(元|\d{1,2})[年./-](\d{1,2})[月./-](\d{1,2})日?/g;
    while ((m = re2.exec(s))) { var y = ERA[m[1]] + (m[2] === '元' ? 1 : +m[2]); var b = ymd(y, m[3], m[4]); if (b) out.push(b); }
    return out;
  }
  var DATE_LABEL = /調剤|処方|交付|発行|お渡し|受付日|作成日/, BIRTH = /生年月日|生まれ|誕生/;
  function findDates(doc) {
    var labeled = {}, other = {};
    doc.pages.forEach(function (p) {
      p.lines.forEach(function (l, i) {
        var ds = datesIn(l.t);
        if (!ds.length) return;
        if (BIRTH.test(l.t)) return;
        var prevT = i > 0 ? p.lines[i - 1].t : '';
        var lab = DATE_LABEL.test(l.t) || (DATE_LABEL.test(prevT) && !datesIn(prevT).length && Math.abs(p.lines[i - 1].y - l.y) < 0.03);
        ds.forEach(function (d) { (lab ? labeled : other)[d] = 1; });
      });
    });
    return { labeled: Object.keys(labeled).sort(), other: Object.keys(other).filter(function (d) { return !labeled[d]; }).sort() };
  }

  /* ── 4. 薬の行 ── */
  var FORM = /(錠|カプセル|ｶﾌﾟｾﾙ|散|顆粒|細粒|末|内用液|液|シロップ|ゼリー|ドライシロップ|DS|OD|テープ|パップ|貼付|軟膏|クリーム|ローション|点眼|点鼻|吸入|坐剤|坐薬|注|ゲル|スプレー)/;
  var TOPICAL = /(テープ|パップ|貼付|軟膏|クリーム|ローション|点眼|点鼻|吸入|坐剤|坐薬|注|ゲル|スプレー|外用|塗布|貼る)/;
  var USAGE_HEAD = /^(1日|１日|1回|１回|毎食|朝|昼|夕|就寝|寝る|起床|食前|食後|食間|頓|分\d|\d+日分|\d+回分)/;
  var NOT_DRUG = /(お薬の名前|薬品名|薬剤名|用法|用量|1日量|1回量|日数|効能|効果|副作用|注意|服用|保管|説明|薬局|病院|医院|クリニック|調剤|処方|電話|TEL|〒|様$)/i;
  /* 行の頭の番号（「1.」「1)」「(1)」「Rp1」「1 」など）を外す。量の欄（「1錠」）は外さない */
  var ENUM = /^(?:Rp\.?\s*\d{1,2}[.)．:、]?\s*|\(\d{1,2}\)\s*|（\d{1,2}）\s*|\d{1,2}[.)．:、]\s*|\d{1,2}\s+(?=[ァ-ヶー【(（A-Za-z一-龥]))/;
  function stripEnum(t) { return nfkc(t).replace(/^\s+/, '').replace(ENUM, ''); }
  function looksDrug(t) {
    var s = stripEnum(t).replace(/\s+/g, '');
    if (s.length < 3 || s.length > 60) return false;
    if (USAGE_HEAD.test(s) || /^\d/.test(s)) return false;
    if (!FORM.test(s)) return false;
    if (NOT_DRUG.test(s) && !/^(【[^】]*】)?[ァ-ヶー]{2,}/.test(s)) return false;
    return /^(【[^】]*】|\([^)]*\)|（[^）]*）)?[ァ-ヶーA-Za-z一-龥]/.test(s);
  }
  /* 同じページで、高さの中心が近い行を1つの「横の並び」にまとめる */
  function visualRows(page) {
    var ls = page.lines.slice().sort(function (a, b) { return (a.y + a.h / 2) - (b.y + b.h / 2); }), rows = [];
    ls.forEach(function (l) {
      var cy = l.y + l.h / 2, r = rows[rows.length - 1];
      if (r && Math.abs(r.cy - cy) <= Math.max(0.006, Math.min(r.h, l.h) * 0.6)) { r.items.push(l); r.cy = (r.cy * (r.items.length - 1) + cy) / r.items.length; r.h = Math.max(r.h, l.h); }
      else rows.push({ cy: cy, h: l.h, items: [l] });
    });
    rows.forEach(function (r) { r.items.sort(function (a, b) { return a.x - b.x; }); });
    return rows;
  }
  /* 表の見出しから「量の欄が1日量か1回量か」を読む */
  function doseHeader(page) {
    var t = page.lines.map(function (l) { return nfkc(l.t).replace(/\s+/g, ''); }).join('|');
    var d = /1日量|一日量|1日用量/.test(t), o = /1回量|一回量|1回用量/.test(t);
    return d && !o ? 'day' : (o && !d ? 'dose' : '');
  }
  var UNIT = '(錠|カプセル|包|g|mL|ml|枚|本|個|滴|噴霧|吸入|袋|cc)';   /* 「回」は量の単位にしない（1日1回を量と取り違えない） */
  function parseUse(text, header, prnRe) {
    var s = nfkc(text).replace(/\s+/g, ''), r = { per: '', amount: 0, unit: '', times: 0, slots: [], meal: '', days: 0, prn: false, extra: [] }, m;
    if ((m = new RegExp('1回(\\d+(?:\\.\\d+)?)' + UNIT).exec(s))) { r.per = 'dose'; r.amount = +m[1]; r.unit = m[2]; }
    else if ((m = new RegExp('1日(?:量)?(\\d+(?:\\.\\d+)?)' + UNIT).exec(s))) { r.per = 'day'; r.amount = +m[1]; r.unit = m[2]; }
    else if ((m = new RegExp('(?:^|[^\\d.日回分])(\\d+(?:\\.\\d+)?)' + UNIT).exec(s))) { r.per = header || ''; r.amount = +m[1]; r.unit = m[2]; }
    if ((m = /1日(\d)回/.exec(s)) || (m = /分(\d)/.exec(s))) r.times = +m[1];
    if ((m = /(\d+)日分/.exec(s))) r.days = +m[1];
    if ((m = /(\d+)回分/.exec(s))) { r.days = 0; r.extra.push(m[0]); }
    var slots = {};
    if (/毎食後/.test(s)) { slots['朝'] = slots['昼'] = slots['夕'] = 1; r.meal = '食後'; }
    else if (/毎食前/.test(s)) { slots['朝'] = slots['昼'] = slots['夕'] = 1; r.meal = '食前'; }
    else if ((m = /([朝昼夕]{1,3})食(後|前)/.exec(s))) { m[1].split('').forEach(function (c) { slots[c] = 1; }); r.meal = '食' + m[2]; }
    if (/就寝前|寝る前|眠前/.test(s)) slots['眠前'] = 1;
    r.slots = ['朝', '昼', '夕', '眠前'].filter(function (k) { return slots[k]; });
    if (/起床時|食間|食直前|食直後|隔日|週|曜|月[・、]|日おき|偶数日|奇数日/.test(s)) r.extra.push((/起床時|食間|食直前|食直後|隔日|週\d*回?|[月火水木金土日]曜|日おき|偶数日|奇数日/.exec(s) || [''])[0]);
    var re = prnRe instanceof RegExp ? prnRe : /頓|屯|とんぷく|適宜|必要時|痛時|発熱時|便秘時|不眠時|不穏時/;
    if (re.test(s)) r.prn = true;
    return r;
  }
  /* 書類の薬の行を組み立てる。opts.prnRe（頓用の言葉・画面の MED_PRN_RE を渡す） */
  function parseRows(doc, opts) {
    opts = opts || {};
    var out = [];
    doc.pages.forEach(function (p, pi) {
      var header = doseHeader(p), rows = visualRows(p);
      /* 用法を Rp ごとに薬の上へ書く書類か（最初の用法の行が、最初の薬の行より上にある） */
      var USE_ROW = /食後|食前|就寝前|寝る前|眠前|起床時|1日\d回|毎食|分\d|\d+日分/;
      var isDrugRow = function (rw) { return rw.items.some(function (x) { return looksDrug(x.t); }); };
      var isUseRow = function (rw) { return !isDrugRow(rw) && USE_ROW.test(nfkc(rw.items.map(function (x) { return x.t; }).join('')).replace(/\s+/g, '')); };
      var firstDrug = -1, firstUse = -1;
      rows.forEach(function (rw, ri) { if (firstDrug < 0 && isDrugRow(rw)) firstDrug = ri; if (firstUse < 0 && isUseRow(rw)) firstUse = ri; });
      var useAbove = firstUse >= 0 && firstDrug >= 0 && firstUse < firstDrug;
      for (var i = 0; i < rows.length; i++) {
        var items = rows[i].items;
        for (var j = 0; j < items.length; j++) {
          if (!looksDrug(items[j].t)) continue;
          /* 同じ並びの右側と、次の薬の行が来るまでの下の2並びを、用量・用法として読む */
          var rest = items.slice(j + 1).filter(function (x) { return !looksDrug(x.t); }).map(function (x) { return x.t; });
          for (var k = i + 1; k < rows.length && k <= i + 2; k++) {
            if (rows[k].items.some(function (x) { return looksDrug(x.t); })) break;
            /* 用法を薬の上に書く書類では、下の用法の行は次の組のもの */
            if (useAbove && isUseRow(rows[k])) break;
            /* 離れた並び（表の外・次の表の見出し）は読まない */
            if (rows[k].cy - rows[i].cy > Math.max(0.05, rows[i].h * 4)) break;
            if (rows[k].items.some(function (x) { return /お薬の名前|薬品名|薬剤名|^用法$|^日数$|1日量|1回量|説明書|薬剤情報|提供書|^\(?\d+\/\d+\)?$/.test(nfkc(x.t).replace(/\s+/g, '')); })) break;
            rest = rest.concat(rows[k].items.map(function (x) { return x.t; }));
          }
          var t0 = stripEnum(items[j].t), name = t0.replace(/\s+/g, ''), inline = '';
          /* 薬名の行に用量・用法が続けて書かれている時（例「〇〇錠5mg 1錠 1日1回朝食後」）は分ける */
          var cut = /\s(?=\d|1日|毎食|朝|昼|夕|就寝)/.exec(t0);
          if (cut) { name = t0.slice(0, cut.index).replace(/\s+/g, ''); inline = t0.slice(cut.index); }
          var own = (inline + ' ' + rest.join(' ')).trim();
          out.push({ page: pi + 1, vrow: i, box: { x: items[j].x, y: items[j].y, w: items[j].w, h: items[j].h }, raw: name,
            own: own, rest: own.slice(0, 200), use: null, topical: TOPICAL.test(name + ' ' + own) });
        }
      }
      /* まとめて書かれた用法（Rp ごとに「1日1回朝食後 14日分」と、薬の上か下に1行だけある形）を、
         自分の行に時点の語が無い薬へ当てる。上下どちらに書く書類かは、そのページで最初に出るのが
         薬の行か用法の行かで決める（決めきれない時は当てない＝用法が読めない ⚠ のまま） */
      var mine = out.filter(function (r) { return r.page === pi + 1; });
      var useRows = [];
      rows.forEach(function (rw, ri) { if (isUseRow(rw)) useRows.push({ ri: ri, t: rw.items.map(function (x) { return x.t; }).join(' ') }); });
      if (mine.length && useRows.length) {
        var before = useAbove;
        mine.forEach(function (r) {
          if (/食後|食前|就寝前|寝る前|眠前|起床時|毎食/.test(nfkc(r.own).replace(/\s+/g, ''))) return;
          var g = null, k2;
          if (before) { for (k2 = useRows.length - 1; k2 >= 0; k2--) if (useRows[k2].ri < r.vrow) { g = useRows[k2]; break; } }
          else { for (k2 = 0; k2 < useRows.length; k2++) if (useRows[k2].ri > r.vrow) { g = useRows[k2]; break; } }
          /* 間に別の用法の行を挟まない（その組の用法だけ）・離れすぎない */
          if (g && Math.abs(rows[g.ri].cy - rows[r.vrow].cy) <= 0.25) { r.group = g.t; r.rest = (r.own + ' ' + g.t).trim().slice(0, 200); }
        });
      }
      mine.forEach(function (r) { r.use = parseUse(r.rest, header, opts.prnRe); r.topical = TOPICAL.test(r.raw + ' ' + r.rest); });
    });
    return out;
  }

  /* ── 5. 名前を確かめる（寄せる）──
     読んだ名前が、次のどれかと一字まで同じかを見る（上ほど優先）。
       current … この方の今の定期薬の名前（施設の書き方）
       used    … 施設で使っている名前（全件データの定期薬の名前・氏名は受け取らない）
       items   … 薬価基準の品目（[[品名, 単位, [屋号…]], …]）
     後発品の多くは薬価基準では統一名（「◯◯ベシル酸塩5mg錠」）で、薬情の書き方（「◯◯錠5mg「屋号」」）と合わないため、
     施設の書き方を先に見る（定期薬の入力パネルと同じ考え・2026-10-01）。
     戻り値 {name, maker, unit, source:'current'|'used'|'yakka'|'', makerOk, near:[候補], ambiguous, dist} */
  function drugKey(s) { return nfkc(s).replace(/\s+/g, '').replace(/^【[^】]*】/, '').replace(/^[(（][^)）]*[)）]/, ''); }
  function splitMaker(s) {
    var t = nfkc(s).replace(/\s+/g, ''), m = /「([^」]+)」$/.exec(t);
    return m ? { base: t.slice(0, m.index), maker: m[1] } : { base: t.replace(/「[^」]*$/, ''), maker: '' };
  }
  function strength(s) { var m = /(\d+(?:\.\d+)?)(mg|μg|µg|g|mL|ml|%)/i.exec(s); return m ? m[1] + m[2].toLowerCase().replace('µ', 'μ') : ''; }
  function lineName(s) { return String(s || '').trim().split(/\s/)[0] || ''; }
  function yakkaKeys(items) {
    if (yakkaKeys.memo && yakkaKeys.memo.items === items) return yakkaKeys.memo.keys;
    var keys = items.map(function (it) { return drugKey(it && it[0]); });
    yakkaKeys.memo = { items: items, keys: keys };
    return keys;
  }
  function snap(raw, ctx) {
    ctx = ctx || {};
    var sm = splitMaker(raw), base = drugKey(sm.base), mk = nfkc(sm.maker);
    var res = { name: '', maker: '', unit: '', source: '', makerOk: false, near: [], ambiguous: false, dist: 0 };
    if (!base) return res;
    /* 施設の書き方（今の定期薬・施設で使っている名前）: 名前と屋号の組で見る */
    var fac = [];
    (Array.isArray(ctx.current) ? ctx.current : []).forEach(function (l) { var x = splitMaker(lineName(l)); if (x.base) fac.push({ base: drugKey(x.base), name: x.base, maker: x.maker, src: 'current' }); });
    (Array.isArray(ctx.used) ? ctx.used : []).forEach(function (l) { var x = splitMaker(lineName(l)); if (x.base) fac.push({ base: drugKey(x.base), name: x.base, maker: x.maker, src: 'used' }); });
    var i, f;
    for (i = 0; i < fac.length; i++) {
      f = fac[i];
      if (f.base === base && (!mk || nfkc(f.maker) === mk)) {
        res.name = f.name; res.maker = f.maker || sm.maker; res.source = f.src; res.makerOk = !mk || nfkc(f.maker) === mk; return res;
      }
    }
    var items = Array.isArray(ctx.items) ? ctx.items : [], keys = yakkaKeys(items), hit = -1;
    for (i = 0; i < keys.length; i++) if (keys[i] === base) { hit = i; break; }
    if (hit >= 0) {
      var it = items[hit], list = Array.isArray(it[2]) ? it[2] : [];
      res.name = String(it[0]); res.unit = String(it[1] || ''); res.source = 'yakka'; res.maker = sm.maker;
      /* 薬価基準の屋号の一覧は欠けが多い（一覧に無い屋号の製品もある）。一覧に無いだけでは止めず、
         一覧の屋号と1字だけ違う時（読み違いの疑い）だけ確かめる印を付ける */
      res.makerOk = true;
      if (mk && !list.some(function (x) { return nfkc(x) === mk; })) {
        var nm = list.filter(function (x) { return dist(nfkc(x), mk, 1) === 1; });
        if (nm.length) { res.makerOk = false; res.near = nm.slice(0, 3).map(function (x) { return res.name + '「' + x + '」'; }); }
      }
      return res;
    }
    /* 一字一致が無い: 近い名前を候補に出す（決めない）。規格の数字が同じものだけ */
    var st = strength(base), sc = [];
    fac.forEach(function (f2) { if (st && f2.base.indexOf(st) < 0) return; var d = dist(base, f2.base, 3); if (d <= 3) sc.push({ n: f2.name + (f2.maker ? '「' + f2.maker + '」' : ''), d: d, p: 0 }); });
    for (i = 0; i < keys.length; i++) {
      if (st && keys[i].indexOf(st) < 0) continue;
      var d = dist(base, keys[i], 3);
      if (d <= 3) sc.push({ n: String(items[i][0]), d: d, p: 1 });
    }
    sc.sort(function (a, b) { return a.d - b.d || a.p - b.p; });
    var seen = {};
    sc = sc.filter(function (o) { if (seen[o.n]) return false; seen[o.n] = 1; return true; });
    res.near = sc.slice(0, 3).map(function (o) { return o.n; });
    if (sc.length) { res.dist = sc[0].d; res.ambiguous = sc.length > 1 && sc[1].d - sc[0].d <= 1; }
    return res;
  }

  /* ── 5-2. 1剤1行の材料（入居者マスタの mpkLine に渡す形）と、確かめる印 ──
     戻り値 {spec:{name, maker, slots, dose, unit, meal, free}, warn:[文], skip:bool（頓服・外用など、既定では入れない）} */
  function fmtNum(n) { return String(Math.round(n * 100) / 100); }
  function lineSpec(row, sn) {
    var u = row.use, warn = [], sm = splitMaker(row.raw);
    var name = sn && sn.source ? sn.name : sm.base, maker = sn && sn.source ? (sn.maker || sm.maker) : sm.maker;
    var unit = u.unit || (sn && sn.unit) || '';
    var spec = { name: name, maker: maker, slots: [], dose: 0, unit: unit, meal: u.meal || '', free: '' };
    var skip = false;
    if (!sn || !sn.source) warn.push(sn && sn.near && sn.near.length ? '薬の名前が一字一致しません（近い名前: ' + sn.near.join('・') + '）' : '薬の名前が、今の定期薬・施設で使っている名前・薬価基準のどれとも一字一致しません');
    else if (!sn.makerOk) warn.push('屋号「' + sm.maker + '」が一致しません' + (sn.near && sn.near.length ? '（近い名前: ' + sn.near.join('・') + '）' : ''));
    if (sn && sn.ambiguous) warn.push('近い名前が複数あり、決めきれません');
    var usage = row.rest.replace(/\s+/g, ' ').trim();
    if (u.prn) { warn.push('頓服の書き方です（定期薬に入れるかを決めてください）'); skip = true; }
    if (row.topical) { warn.push('外用・注射の薬のようです（内服の定期薬の欄に入れるかを決めてください）'); skip = true; }
    var n = u.slots.length;
    if (!u.prn && n && u.amount > 0 && unit && (u.meal || (n === 1 && u.slots[0] === '眠前')) && !u.extra.length) {
      var per = u.per;
      if (!per) { warn.push('量が1日量か1回量か読めません（1日量として計算しました）'); per = 'day'; }
      var nMeal = u.slots.filter(function (k) { return k !== '眠前'; }).length;
      spec.slots = u.slots.slice(); spec.meal = nMeal ? u.meal : '';
      spec.dose = per === 'dose' ? u.amount : u.amount / n;
      if (u.times && u.times !== n) warn.push('「1日' + u.times + '回」と時点の数（' + n + '）が合いません');
      if (Math.round(spec.dose * 2) !== spec.dose * 2) warn.push('1回量が ' + fmtNum(spec.dose) + unit + ' になります（割り切れません）');
    } else {
      spec.free = usage.replace(/\d+日分/g, '').replace(/\s+/g, ' ').trim();
      if (!skip) warn.push(u.extra.length ? '毎日の決まった時点ではない書き方です（' + u.extra.join('・') + '）' : '用法・用量が読めません');
    }
    return { spec: spec, warn: warn, skip: skip };
  }
  /* 書類の中で日数が他と違う・短い行（臨時の疑い） */
  function shortDays(rows) {
    var cnt = {}, best = 0, mode = 0;
    rows.forEach(function (r) { var d = r.use.days; if (d) { cnt[d] = (cnt[d] || 0) + 1; if (cnt[d] > best) { best = cnt[d]; mode = d; } } });
    return rows.map(function (r) { var d = r.use.days; return !!(d && ((mode && d < mode) || d < 7)); });
  }

  /* ── 6. 今の定期薬との対応付け ── 名前の語幹（剤形の語の手前・規格を除く）で結ぶ */
  /* 同じ薬かを見る鍵: 剤形の語の手前（語幹）と、剤形の語の後ろ（規格の数字を除く）の組。
     語幹が3文字未満の時は結ばない（「架空錠N」と「架空錠Z」のように頭だけ同じ別の薬を結ばない） */
  function stem(s) {
    var t = drugKey(splitMaker(String(s).split(/\s/)[0] || '').base);
    var m = /^(.+?)(OD)?(錠|カプセル|散|顆粒|細粒|末|内用液|液|シロップ|ゼリー|DS|テープ|パップ|軟膏|クリーム|点眼)(.*)$/.exec(t);
    var n = (m ? m[1] : t).replace(/\d+(?:\.\d+)?(?:mg|μg|g|mL|%)?$/i, '');
    if (n.length < 3) return '';
    /* 剤形の語の後ろは、かっこ書き（屋号など）と規格の数字を除いた英字だけを比べる（例「錠N」と「錠Z」は別の薬） */
    var tail = m ? m[4].replace(/[「『(（【<＜][^」』)）】>＞]*[」』)）】>＞]?/g, '').replace(/\d+(?:\.\d+)?(?:mg|μg|g|mL|%)/ig, '').replace(/[^A-Za-z]/g, '').toUpperCase() : '';
    return n + '|' + tail;
  }
  /* rows: [{line}]（作った行）, current: 今の定期薬の全文 → {pairs:[{row, cur, kind}], left:[今の行で対応の無いもの]}
     kind: 'same'（同じ行）・'change'（同じ薬で中身が違う）・'add'（今に無い） */
  /* 今の行と、組み立てた材料（spec）が同じ意味か。名前（屋号を含む）が同じで、1日の量・単位・時点・食前後が同じ時だけ真。
     読めない・決めきれない時は偽（＝変更として人が見比べる） */
  function sameMeaning(curLine, spec) {
    if (!spec || spec.free || !spec.slots || !spec.slots.length || !(spec.dose > 0)) return false;
    var c = String(curLine || '').trim(), nm = splitMaker(lineName(c));
    if (drugKey(nm.base) !== drugKey(spec.name) || nfkc(nm.maker) !== nfkc(spec.maker || '')) return false;
    var u = parseUse(c.slice(lineName(c).length), 'day');
    if (!u.slots.length || !(u.amount > 0) || u.prn || u.extra.length) return false;
    var tot = u.per === 'dose' ? u.amount * u.slots.length : u.amount;
    if (u.slots.join() !== spec.slots.join()) return false;
    if ((u.meal || '') !== (spec.meal || '')) return false;
    if ((u.unit || '') !== (spec.unit || '')) return false;
    return Math.abs(tot - spec.dose * spec.slots.length) < 1e-9;
  }
  function matchCurrent(rows, current) {
    var cur = String(current == null ? '' : current).split(/\r\n|\r|\n/).map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim(); });
    var used = {}, pairs = [];
    var cmp = function (s) { return nfkc(s).replace(/\s+/g, ' ').trim(); };
    rows.forEach(function (r) {
      var line = r.line || '', j, hit = -1;
      for (j = 0; j < cur.length; j++) if (!used[j] && cmp(cur[j]) === cmp(line)) { hit = j; break; }
      if (hit >= 0) { used[hit] = 1; pairs.push({ row: r, cur: cur[hit], kind: 'same' }); return; }
      var a = drugKey(splitMaker(lineName(line)).base);
      for (j = 0; j < cur.length; j++) if (!used[j] && drugKey(splitMaker(lineName(cur[j])).base) === a && a) { hit = j; break; }
      if (hit < 0) { var st = stem(line); if (st) for (j = 0; j < cur.length; j++) if (!used[j] && stem(cur[j]) === st) { hit = j; break; } }
      if (hit >= 0) {
        used[hit] = 1;
        /* 書き方だけが違う（同じ薬・同じ屋号で、1日の量・単位・時点・食前後が同じ）なら、今の行のまま（kind 'same'・how 'meaning'） */
        if (r.spec && sameMeaning(cur[hit], r.spec)) { pairs.push({ row: r, cur: cur[hit], kind: 'same', how: 'meaning' }); return; }
        pairs.push({ row: r, cur: cur[hit], kind: 'change' });
        return;
      }
      pairs.push({ row: r, cur: '', kind: 'add' });
    });
    return { pairs: pairs, left: cur.filter(function (l, j) { return !used[j]; }) };
  }

  /* ── 7. 反映する全文を作る ──
     current の並びを保ち、変える行は置き換え、中止の行は除き、足す行は末尾に足す。
     decisions: {change:[{from, to}], stop:[行], add:[行]} */
  function buildAfter(current, dec) {
    var cur = String(current == null ? '' : current).split(/\r\n|\r|\n/).map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim(); });
    var stop = (dec.stop || []).slice(), chg = (dec.change || []).slice(), out = [];
    cur.forEach(function (l) {
      var si = stop.indexOf(l); if (si >= 0) { stop.splice(si, 1); return; }
      for (var i = 0; i < chg.length; i++) if (chg[i].from === l) { out.push(chg[i].to); chg.splice(i, 1); return; }
      out.push(l);
    });
    (dec.add || []).forEach(function (l) { out.push(l); });
    return out.join('\n');
  }

  /* ── 8. 確認表の行を作る ──
     pairs（matchCurrent の結果）と left（書類に無い今の行）から、確認表の行を作る。
     specs: pairs と同じ並びの lineSpec の結果（spec・warn・skip）。lines: pairs と同じ並びの作った行（mpkLine）。
     戻り値の行 {kind:'same'|'change'|'add'|'left', cur, line, raw, warns:[], action, checked:false}
       action の既定: same=keep（変えない）・change=change（書類の行へ）・add=add（足す。頓服・外用は skip）・left=''（決めるまで反映できない）
       書類の用法を組めなかった change は、今の行のまま（keep）を既定にして印を付ける */
  function buildRows(pairs, left, specs, opts) {
    opts = opts || {};
    var rows = [];
    pairs.forEach(function (p, i) {
      var sp = specs[i] || { warn: [], skip: false, spec: {} }, w = sp.warn.slice();
      if (opts.short && opts.short[i]) w.push('日数が他の行より短い・7日未満です（臨時の処方の疑い）');
      if (opts.slotWarn && opts.slotWarn[i]) w.push(opts.slotWarn[i]);
      var r = { kind: p.kind, cur: p.cur || '', line: p.row.line || '', raw: p.row.raw || '', page: p.row.page || 1, box: p.row.box || null,
        warns: w, action: '', checked: false };
      if (p.kind === 'same') { r.action = 'keep'; r.line = p.cur; }
      else if (p.kind === 'change') {
        if (sp.spec && sp.spec.free) { r.action = 'keep'; r.warns.push('書類の用法を読めなかったので、今の行のままにしています（原本と見比べてください）'); }
        else r.action = 'change';
      } else if (p.kind === 'add') r.action = sp.skip ? 'skip' : 'add';
      rows.push(r);
    });
    (left || []).forEach(function (l) {
      rows.push({ kind: 'left', cur: l, line: l, raw: '', page: 0, box: null, warns: [], action: '', checked: false });
    });
    return rows;
  }

  /* ── 9. 反映できるか（設計書 §4-3）──
     st: {id, dates:{labeled, other}, date, identity, server, rows, current, lastChange, oldChecked, sameDay, ack}
     戻り値 {stop:'理由（あれば反映できない）', notes:[知らせるだけ], after, counts:{change, add, stop}} */
  function judge(st) {
    var rows = st.rows || [], current = String(st.current == null ? '' : st.current), notes = [], stop = '';
    var dec = { change: [], stop: [], add: [] };
    rows.forEach(function (r) {
      if (r.kind === 'change' && r.action === 'change' && r.line && r.line !== r.cur) dec.change.push({ from: r.cur, to: r.line });
      else if (r.kind === 'add' && r.action === 'add' && r.line) dec.add.push(r.line);
      else if (r.kind === 'left' && r.action === 'stop') dec.stop.push(r.cur);
    });
    var after = buildAfter(current, dec);
    var lines = after.split('\n').filter(function (l) { return l.trim(); });
    var counts = { change: dec.change.length, add: dec.add.length, stop: dec.stop.length };
    var unchecked = rows.filter(function (r) { return r.warns && r.warns.length && !r.checked && !(r.action === 'skip' || (r.kind === 'same')); }).length;
    var undecided = rows.filter(function (r) { return r.kind === 'left' && r.action !== 'keep' && r.action !== 'stop'; }).length;
    var labeled = (st.dates && st.dates.labeled) || [], other = (st.dates && st.dates.other) || [];
    var seen = {}, dup = 0;
    lines.forEach(function (l) { var k = nfkc(l).replace(/\s+/g, ' ').trim(); if (seen[k]) dup++; seen[k] = 1; });
    if (!st.id) stop = '振り分け先（どの方の書類か）が決まっていません';
    else if (st.server === 'old') stop = '入居者マスタGASの貼り替えがまだのため、反映できません（確認表は見られます）';
    else if (st.server !== 'ok') stop = '入居者マスタGASに届きません。少し待って開き直してください';
    else if (!labeled.length && !other.length) stop = '書類から調剤日を読めません。日付の入った書類で取り込んでください（この書類からは反映できません）';
    else if (!st.date) stop = labeled.length > 1 ? '調剤日が2つ以上あります。この書類の調剤日を1つ選んでください' : '調剤日を選んでください';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.date))) stop = '調剤日の形が正しくありません';
    else if (!st.identity) stop = '書類の氏名を見て、この方の書類だと確かめたら、印を付けてください';
    else if (undecided) stop = '書類に無い今の薬が ' + undecided + ' 行あります。「残す」か「中止」を選んでください';
    else if (unchecked) stop = '⚠ の行が ' + unchecked + ' 行あります。原本と見比べて「確かめた」に印を付けてください';
    else if (st.lastChange && String(st.date) < String(st.lastChange) && !st.oldChecked)
      stop = 'この書類の調剤日は、定期薬の最後の変更（' + st.lastChange + '）より前です。古い書類で戻さないか確かめて、印を付けてください';
    else if (st.sameDay && !st.ack) stop = '同じ調剤日のこの方の記録から、既に反映しています。同じ変更でないかを変更履歴と見比べ、別の変更なら印を付けてください';
    else if (!counts.change && !counts.add && !counts.stop) stop = '反映する変更はありません（今の定期薬のままです）';
    else if (!lines.length) stop = '反映すると定期薬が空になります。全部の薬を止める時は編集画面で直してください';
    else if (after.length > 5000) stop = '反映する定期薬が長すぎます（5000字まで）';
    else if (/[（(]不明[）)]/.test(after)) stop = '「（不明）」が残っています。用量・用法を確かめて書き直してください';
    else if (dup) stop = '同じ行が2つになります（' + dup + '行）。足す行と今の行が重なっていないか確かめてください';
    if (counts.stop) notes.push('「中止」が ' + counts.stop + ' 行あります。書類どおりの中止か確かめてください（取りこぼすと飲んでいる薬がマスタから消えます）');
    return { stop: stop, notes: notes, after: after, counts: counts };
  }

  /* 指紋（FNV-1a 32bit・小文字の16進8桁）。入居者マスタの判断の印 S|利用者No|調剤日|指紋 に使う */
  function fnv8(s) {
    var t = nfkc(s).replace(/\s+/g, ' ').trim(), h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function srcKey(id, date, after) { return 'S|' + String(id) + '|' + String(date) + '|' + fnv8(after); }

  var api = { parseResult: parseResult, assign: assign, findDates: findDates, datesIn: datesIn, parseUse: parseUse,
    parseRows: parseRows, looksDrug: looksDrug, stripEnum: stripEnum, snap: snap, lineSpec: lineSpec, shortDays: shortDays, splitMaker: splitMaker, stem: stem, matchCurrent: matchCurrent, sameMeaning: sameMeaning, buildRows: buildRows, judge: judge, buildAfter: buildAfter,
    fnv8: fnv8, srcKey: srcKey, nz: nz, kn: kn, dist: dist };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YakujoCalc = api;
})(typeof window !== 'undefined' ? window : this);
