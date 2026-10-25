/* care-meeting-calc.js — サービス担当者会議の記録（担当者会議）の純関数（2026-10-23 新設・代表者の決定）
 *
 * NotebookLM が「◆欄名：」の印つきで出した議事録を、様式（サービス担当者会議の要点）の各欄へ振り分ける。
 * AI は呼ばない（決まった規則だけ）。画面（担当者会議のページ）と試験（check/unit/care_meeting_calc_test.js）が使う。
 *
 * 約束:
 *   1. 欄の区切りは、行の先頭の「◆」（◇ も可・前に Markdown の飾り # - * > があってもよい）と、知っている欄名だけ。
 *      本文の中の【CM】【施設】などの小見出しは区切りにしない
 *   2. 黙って捨てない。知らない欄名・もう出た欄名の印は、今の欄の本文のまま残して知らせる。最初の印より前の文章も知らせる
 *   3. 日付・時刻・回数・開催の理由は形を確かめ、読めない時は空にして知らせる（推測で埋めない）
 *   4. 利用者名は、開いている入居者と照らし合わせる。合わない・同じ名前の方が名簿に2人以上いる時は確定させない
 *   5. 上限を超える欄・出席者は切り詰めない（知らせて、保存の前に直してもらう）
 *   6. 個人情報を外へ送らない・保存しない（この部品は計算だけ）
 */
(function (root) {
  'use strict';

  var VERSION = '2026-10-25a';
  /* 様式の欄（並びは様式どおり）。max は1欄の上限の文字数（GAS の meeting.gs と同じ値）。optional は無くても知らせない欄 */
  var FIELDS = [
    { key: 'sourceName', label: '利用者名', max: 40 },
    { key: 'kind', label: '開催の理由', type: 'kind', optional: true },
    { key: 'author', label: '作成担当者', max: 40 },
    { key: 'createdDate', label: '作成年月日', max: 10, type: 'date' },
    { key: 'heldDate', label: '開催日', max: 10, type: 'date' },
    { key: 'place', label: '開催場所', max: 100 },
    { key: 'timeText', label: '開催時間', max: 40, type: 'time' },
    { key: 'count', label: '開催回数', max: 20, type: 'count' },
    { key: 'attendees', label: '出席者', type: 'attendees' },
    { key: 'items', label: '検討した項目', max: 2000 },
    { key: 'content', label: '検討内容', max: 5000 },
    { key: 'conclusion', label: '結論', max: 3000 },
    { key: 'issues', label: '残された課題', max: 2000 },
    { key: 'nextText', label: '次回の開催時期', max: 200 }
  ];
  /* 同じ欄の別の呼び方（NotebookLM の出力の揺れ・今の様式の見出し）。
     ★「場所」「時間」「次回」のような一語の呼び方は入れない（本文の中の「◆場所：…」を欄の区切りと取り違えるため） */
  var ALIASES = {
    '会議出席者': 'attendees', '出席者一覧': 'attendees',
    '作成日': 'createdDate', '開催年月日': 'heldDate', '会議日': 'heldDate',
    '検討項目': 'items',
    '開催理由': 'kind',
    '次回開催時期': 'nextText', '次回の開催予定': 'nextText', '次回開催予定': 'nextText'
  };
  /* 開催の理由（GAS の MEETING_KINDS と同じ・シートにもこの文字で残る） */
  var KINDS = ['新規', '認定の更新', '区分変更', '退院・退所', '状態の変化', 'その他'];
  /* ★「更新」だけでは認定の更新にしない（ケアプランの更新・目標の期間の更新と取り違えるため。「認定」の語を求める）。
     「要介護状態区分の変更」は区分変更と状態の変化の両方に当たる＝決めずに選んでもらう */
  var KIND_RULES = [
    ['区分変更', /区分変更|区変|区分の変更|介護度の変更/],
    ['退院・退所', /退院|退所/],
    ['認定の更新', /認定.{0,4}更新|更新認定/],
    ['新規', /新規|初回|入居時|利用開始|サービス開始/],
    ['状態の変化', /状態|変化|悪化|低下/],
    ['その他', /その他/]
  ];
  var ATTENDEE_MAX = 20;      // 保存できる人数（GAS と同じ）
  var ATTENDEE_LEN = 40;      // 所属（職種）・氏名の上限の文字数（GAS と同じ）
  var ATTENDEE_PRINT = 9;     // 様式の表に入る人数（3列×3段）
  var INPUT_MAX = 30000;      // 貼り付けを振り分ける上限の文字数（議事録の実測の最大より十分に大きい）

  function nfkc(s) { s = String(s == null ? '' : s); return s.normalize ? s.normalize('NFKC') : s; }
  function labelKey(s) { return nfkc(s).replace(/[\s（）()「」【】*_]/g, ''); }
  var BY_LABEL = {};
  FIELDS.forEach(function (f) { BY_LABEL[labelKey(f.label)] = f.key; });
  Object.keys(ALIASES).forEach(function (a) { BY_LABEL[labelKey(a)] = ALIASES[a]; });
  function fieldOf(key) { for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === key) return FIELDS[i]; return null; }

  /* ── 日付 ── 2026/10/23・2026-10-23・2026年10月23日・令和8年10月23日・R8.10.23（曜日のかっこは無視）→ 'YYYY-MM-DD'／読めなければ '' */
  function normDate(s) {
    var t = nfkc(s).replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '');
    if (!t) return '';
    var y, m, d, mm;
    if ((mm = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(t))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
    else if ((mm = /^(?:令和|R)(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i.exec(t))) { y = 2018 + (mm[1] === '元' ? 1 : +mm[1]); m = +mm[2]; d = +mm[3]; }
    else return '';
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function ymdOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && normDate(s) === s; }
  /* ── 時刻 ── 14:00〜15:00・14時〜15時30分・14:00-15:00 → {start:'14:00', end:'15:00', text:'14:00〜15:00'}／読めなければ null */
  function hm(s) {
    var mm = /^(\d{1,2})(?:[:：時](\d{1,2})?分?)?$/.exec(s);
    if (!mm) return '';
    var h = +mm[1], mi = mm[2] === undefined || mm[2] === '' ? 0 : +mm[2];
    if (h > 23 || mi > 59) return '';
    return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
  }
  function normTime(s) {
    var t = nfkc(s).replace(/\s+/g, '');
    if (!t) return null;
    var parts = t.split(/[〜~\-－ー～]|から/).filter(function (x) { return x !== ''; });
    if (parts.length < 1 || parts.length > 2) return null;
    var a = hm(parts[0]), b = parts.length === 2 ? hm(parts[1]) : '';
    if (!a || (parts.length === 2 && !b)) return null;
    if (b && b <= a) return null;
    return { start: a, end: b, text: b ? a + '〜' + b : a };
  }
  /* ── 回数 ── 3回目・第3回・3 → '3'／読めなければ '' */
  function normCount(s) {
    var t = nfkc(s).replace(/\s+/g, '');
    var mm = /^(?:第)?(\d{1,3})(?:回目?|回)?$/.exec(t);
    return mm && +mm[1] > 0 ? String(+mm[1]) : '';
  }
  /* ── 開催の理由 ── 決まりの6つの名前ならそのまま。ほかは言葉から1つに決まる時だけ当てはめる
     戻り値 {kind:'決まりの名前'|'', hits:[当てはまった名前]}（2つ以上に当てはまる時は決めずに '' を返す） */
  function normKind(s) {
    var t = nfkc(s).replace(/\s+/g, '').replace(/[／\/]/g, '・');
    if (!t) return { kind: '', hits: [] };
    for (var i = 0; i < KINDS.length; i++) if (t === KINDS[i]) return { kind: KINDS[i], hits: [KINDS[i]] };
    var hits = KIND_RULES.filter(function (r) { return r[1].test(t); }).map(function (r) { return r[0]; });
    return { kind: hits.length === 1 ? hits[0] : '', hits: hits };
  }
  /* ── 出席者 ── 1行に1人「所属（職種）／氏名」→ [{role, name}]。長い・多い時は切り詰めずに知らせる */
  function parseAttendees(text) {
    var out = [], warns = [];
    String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var l = line.replace(/^\s*(?:[・\-\*●○◯]|\d{1,2}[.．)）])\s*/, '').trim();
      if (!l) return;
      var mm = /^(.*?)\s*[／\/｜|\t：:]\s*(.*)$/.exec(l), role = '', name = '';
      if (mm) { role = mm[1].trim(); name = mm[2].trim(); }
      else name = l;
      if (!name) { warns.push('出席者の行に氏名がありません（' + l.slice(0, 20) + '）'); return; }
      if (!role) warns.push('出席者「' + name.slice(0, 20) + '」の所属（職種）がありません');
      if (role.length > ATTENDEE_LEN || name.length > ATTENDEE_LEN)
        warns.push('出席者「' + name.slice(0, 20) + '」の所属（職種）か氏名が ' + ATTENDEE_LEN + ' 字を超えています。保存の前に短くしてください');
      out.push({ role: role, name: name });
    });
    if (out.length > ATTENDEE_MAX) warns.push('出席者が ' + out.length + ' 名あります。保存できるのは ' + ATTENDEE_MAX + ' 名までです。保存の前に減らしてください');
    else if (out.length > ATTENDEE_PRINT) warns.push('出席者が ' + out.length + ' 名あります。印刷の表に入るのは ' + ATTENDEE_PRINT + ' 名までで、残りは表の下に続けて出します');
    return { list: out, warns: warns };
  }

  /* ── 印の行か ── 行の先頭の飾り（# > - + * __ と空白）を外して「◆」「◇」で始まれば、その後ろを返す。違えば null
     ★正規表現1本で飾りを繰り返して読むと、* が長く続く行で時間がかかるため、1つずつ外す */
  function markBody(line) {
    var s = String(line).replace(/^\s+/, ''), prev;
    for (var i = 0; i < 20 && s; i++) {
      prev = s; s = s.replace(/^(?:#{1,6}|>|[-+]|\*+|_{2,})\s*/, '');
      if (s === prev) break;
    }
    return s.charAt(0) === '◆' || s.charAt(0) === '◇' ? s.slice(1) : null;
  }
  /* ── 振り分け ── 印つきの文章 → {fields, attendees, warns, found, missing, unknown, preamble, raw, tooLong} */
  function parse(text) {
    var src = String(text == null ? '' : text);
    if (src.length > INPUT_MAX) {
      return { fields: {}, attendees: [], found: [], unknown: [], preamble: '', raw: {}, tooLong: true,
        missing: FIELDS.filter(function (f) { return !f.optional; }).map(function (f) { return f.key; }),
        warns: ['貼り付けた文章が ' + INPUT_MAX + ' 字を超えています（' + src.length + ' 字）。振り分けていません。1回の会議の分だけを貼ってください'] };
    }
    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var sections = [], cur = null, seen = {}, pre = [], unknown = [], warns = [];
    lines.forEach(function (line) {
      var body = markBody(line);
      if (body !== null) {
        var colon = body.search(/[：:]/), label = colon >= 0 ? body.slice(0, colon) : body, rest = colon >= 0 ? body.slice(colon + 1) : '';
        rest = rest.replace(/^\s*(?:\*\*|__)\s*/, '').trim();
        var key = BY_LABEL[labelKey(label)], name = labelKey(label).slice(0, 20);
        if (key && !seen[key]) { seen[key] = 1; cur = { key: key, lines: rest ? [rest] : [] }; sections.push(cur); return; }
        /* 知らない欄名・もう出た欄名の印は、区切りにせず今の欄の本文のまま残す（本文の「◆」の箇条書きを欄と取り違えない） */
        if (cur) {
          unknown.push({ label: name, in: cur.key });
          warns.push('「' + fieldOf(cur.key).label + '」の中に' + (key ? 'もう一度「' + fieldOf(key).label + '」' : '知らない印「' + name + '」') + 'の行があります（本文のまま残しました。確かめてください）');
        } else unknown.push({ label: name, in: '' });
      }
      if (cur) cur.lines.push(line); else pre.push(line);
    });
    var fields = {}, found = [];
    sections.forEach(function (s) {
      fields[s.key] = s.lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
      found.push(s.key);
    });
    var preamble = pre.join('\n').trim();
    if (preamble) warns.push('最初の「◆」より前に文章があります（どの欄にも入れていません）');
    if (!sections.length) warns.push('「◆欄名：」の印が見つかりません。NotebookLM の出力の形を確かめるか、手で欄に入れてください');

    /* 形を確かめる（読めない時は空にして知らせる・元の文字は raw に残す） */
    var raw = {};
    ['createdDate', 'heldDate'].forEach(function (k) {
      if (fields[k] === undefined) return;
      raw[k] = fields[k]; var d = normDate(fields[k]);
      if (!d && fields[k].trim()) warns.push('「' + fieldOf(k).label + '」の日付を読めません（' + fields[k].slice(0, 20) + '）');
      fields[k] = d;
    });
    if (fields.timeText !== undefined) {
      raw.timeText = fields.timeText; var tm = normTime(fields.timeText);
      if (!tm && fields.timeText.trim()) warns.push('「開催時間」を読めません（' + fields.timeText.slice(0, 20) + '）');
      fields.timeText = tm ? tm.text : '';
    }
    if (fields.count !== undefined) {
      raw.count = fields.count; var c = normCount(fields.count);
      if (!c && fields.count.trim()) warns.push('「開催回数」を読めません（' + fields.count.slice(0, 20) + '）');
      fields.count = c;
    }
    if (fields.kind !== undefined) {
      raw.kind = fields.kind; var kd = normKind(fields.kind);
      if (!kd.kind && fields.kind.trim())
        warns.push(kd.hits.length > 1 ? '「開催の理由」が2つ以上に当てはまります（' + kd.hits.join('・') + '）。画面で1つ選んでください'
          : '「開催の理由」を決まりの6つ（' + KINDS.join('・') + '）に当てはめられません（' + fields.kind.slice(0, 20) + '）。画面で選んでください');
      fields.kind = kd.kind;
    }
    var att = { list: [], warns: [] };
    if (fields.attendees !== undefined) { att = parseAttendees(fields.attendees); warns = warns.concat(att.warns); delete fields.attendees; }
    FIELDS.forEach(function (f) {
      if (f.max && typeof fields[f.key] === 'string' && fields[f.key].length > f.max)
        warns.push('「' + f.label + '」が ' + f.max + ' 字を超えています（' + fields[f.key].length + ' 字）。保存の前に短くしてください');
    });
    /* 入っていない欄＝印が無い・印はあるが中身が空（読めずに空にした欄も含む） */
    var missing = FIELDS.filter(function (f) {
      if (f.optional) return false;
      if (f.key === 'attendees') return !att.list.length;
      return !String(fields[f.key] == null ? '' : fields[f.key]).trim();
    }).map(function (f) { return f.key; });
    return { fields: fields, attendees: att.list, warns: warns, found: found, missing: missing, unknown: unknown, preamble: preamble, raw: raw, tooLong: false };
  }

  /* ── 利用者名の照らし合わせ ── 空白・全角半角・末尾の「様」「さん」「殿」を除いて比べる。
     roster（名簿の [{name}]）を渡すと、同じ名前の方が2人以上いる時は一致にしない（どちらの方か分からないため） */
  function nameKey(s) { return nfkc(s).replace(/[\s]/g, '').replace(/(様|さん|殿)$/, ''); }
  function residentMatch(textName, resident, roster) {
    var a = nameKey(textName), b = nameKey(resident && resident.name);
    if (!a) return { ok: false, reason: 'empty', dupes: 0 };
    if (!b) return { ok: false, reason: 'noResident', dupes: 0 };
    if (a !== b) return { ok: false, reason: 'mismatch', dupes: 0 };
    var dupes = Array.isArray(roster) ? roster.filter(function (r) { return r && nameKey(r.name) === a; }).length : 0;
    return dupes > 1 ? { ok: false, reason: 'dupe', dupes: dupes } : { ok: true, reason: '', dupes: dupes };
  }

  /* ── 保存できるか ── 下書きでも止める形の誤り（GAS も同じ条件で断る）。戻り値 {stop:'理由'|''} */
  function checkSave(rec) {
    rec = rec || {};
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i], v = rec[f.key];
      if (f.max && typeof v === 'string' && v.length > f.max) return { stop: '「' + f.label + '」が ' + f.max + ' 字を超えています（' + v.length + ' 字）' };
    }
    if (rec.heldDate && !ymdOk(rec.heldDate)) return { stop: '開催日の形が違います（YYYY-MM-DD）' };
    if (rec.createdDate && !ymdOk(rec.createdDate)) return { stop: '作成年月日の形が違います（YYYY-MM-DD）' };
    if (rec.kind && KINDS.indexOf(rec.kind) < 0) return { stop: '開催の理由を選んでください' };
    var att = rec.attendees == null ? [] : rec.attendees;
    if (!Array.isArray(att)) return { stop: '出席者の形が違います' };
    if (att.length > ATTENDEE_MAX) return { stop: '出席者は ' + ATTENDEE_MAX + ' 名までです（' + att.length + ' 名）' };
    for (var j = 0; j < att.length; j++) {
      var a = att[j];
      if (!a || typeof a !== 'object' || Array.isArray(a)) return { stop: '出席者の形が違います' };
      if (String(a.role || '').trim().length > ATTENDEE_LEN || String(a.name || '').trim().length > ATTENDEE_LEN)
        return { stop: '出席者の所属（職種）・氏名は ' + ATTENDEE_LEN + ' 字までです' };
    }
    return { stop: '' };
  }
  /* ── 確定できるか ── rec: {heldDate, attendees[], items, content, conclusion, issues, ...}／ctx: {today, residentOk}
     ctx.residentOk は画面が residentMatch(rec.sourceName, 開いている方, 名簿).ok か「原本で確かめた」印（rec.nameChecked）で決める
     戻り値 {stop:'理由（あれば確定できない）', warns:[]} */
  function checkFinal(rec, ctx) {
    rec = rec || {}; ctx = ctx || {};
    var warns = [], stop = '', sv = checkSave(rec).stop;
    var att = Array.isArray(rec.attendees) ? rec.attendees.filter(function (a) { return a && String(a.name || '').trim(); }) : [];
    if (ctx.residentOk !== true) stop = '利用者名が、開いている方と一致しません。原本で確かめてください';
    else if (!ymdOk(rec.heldDate)) stop = '開催日を入れてください（YYYY-MM-DD）';
    else if (!ymdOk(ctx.today)) stop = '今日の日付が読めません（画面を開き直してください）';
    else if (String(rec.heldDate) > String(ctx.today)) stop = '開催日が今日より後です';
    else if (!att.length) stop = '出席者を1名以上入れてください';
    else if (!String(rec.items || '').trim()) stop = '「検討した項目」が空です';
    else if (!String(rec.content || '').trim()) stop = '「検討内容」が空です';
    else if (!String(rec.conclusion || '').trim()) stop = '「結論」が空です';
    else if (sv) stop = sv;
    if (!String(rec.issues || '').trim()) warns.push('「残された課題」が空です（無ければ「なし」と書いてください）');
    if (!String(rec.place || '').trim()) warns.push('「開催場所」が空です');
    if (!rec.kind) warns.push('「開催の理由」が選ばれていません');
    if (rec.createdDate && rec.heldDate && String(rec.createdDate) < String(rec.heldDate)) warns.push('作成年月日が開催日より前です');
    return { stop: stop, warns: warns };
  }

  /* ── 日付の計算 ── */
  function ymd(d) { return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').slice(0, 10)); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function addDays(s, n) { var d = parseYmd(s); return d ? ymd(new Date(d.getTime() + n * 86400000)) : ''; }
  function addMonths(s, n) {
    var d = parseYmd(s); if (!d) return '';
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return ymd(new Date(Date.UTC(y, m, Math.min(day, last))));
  }
  function daysBetween(a, b) { var x = parseYmd(a), y = parseYmd(b); return x && y ? Math.round((y - x) / 86400000) : null; }
  /* 今日（日本時間）の YYYY-MM-DD。now（ミリ秒）を渡すとその時点で数える（試験用） */
  function todayJST(now) { var t = typeof now === 'number' ? now : Date.now(); return ymd(new Date(t + 9 * 3600000)); }
  /* 時刻（ISO の文字）→ 日本時間の日付。読めなければ '' */
  function jstDate(ts) { var t = Date.parse(String(ts || '')); return isNaN(t) ? '' : todayJST(t); }

  function heldList(meetings) {
    return (meetings || []).filter(function (m) { return m && !m.deleted && m.status === 'final' && parseYmd(m.heldDate); })
      .map(function (m) { return String(m.heldDate).slice(0, 10); }).sort();
  }
  function lastHeld(meetings) { var h = heldList(meetings); return h.length ? h[h.length - 1] : ''; }
  /* 入院の記録（stateLog）から、今の入院の状態・入院した日・退院した日を読む（新しい順に限らず ts で並べ直す） */
  function hospitalState(stateLog) {
    var log = (Array.isArray(stateLog) ? stateLog : []).filter(function (e) { return e && e.field === 'hospitalized' && jstDate(e.ts) && typeof e.val === 'boolean'; })
      .slice().sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); });
    if (!log.length) return { known: false, inHospital: false, admitted: '', discharged: '' };
    if (log[0].val === true) return { known: true, inHospital: true, admitted: jstDate(log[0].ts), discharged: '' };
    var adm = '';
    for (var i = 1; i < log.length; i++) if (log[i].val === true) { adm = jstDate(log[i].ts); break; }
    return { known: true, inHospital: false, admitted: adm, discharged: jstDate(log[0].ts) };
  }
  /* 介護度の履歴（careLevelHistory）から、いちばん新しい区分変更を記録した日 */
  function lastCareChange(hist) {
    var out = '';
    (Array.isArray(hist) ? hist : []).forEach(function (h) {
      if (!h || !/区分変更/.test(String(h.note || ''))) return;
      var d = parseYmd(h.changedAt) ? String(h.changedAt).slice(0, 10) : '';
      if (d > out) out = d;
    });
    return out;
  }

  /* ── 期限の知らせ ── 入居者1人ぶん
     in: {today, meetings:[{heldDate, status, deleted}], careCertStart, careCertEnd, stateLog, hospitalized, careLevelHistory,
          cfg:{certSoonDays, certLeadDays, intervalMonths, intervalSoonDays}}
     数えるのは確定した会議だけ（下書き・取り消しは数えない）。どの理由の会議でも数える（臨時の会議でも6か月の数え直しになる）
     戻り値 [{kind, level:'high'|'mid'|'info', text, reason}]（high・mid・info の順）。reason は「臨時の会議を記録」で選ぶ開催の理由 */
  function dueAlerts(input) {
    input = input || {};
    var cfg = input.cfg || {}, soon = cfg.certSoonDays > 0 ? cfg.certSoonDays : 60, lead = cfg.certLeadDays > 0 ? cfg.certLeadDays : 30,
        months = cfg.intervalMonths > 0 ? cfg.intervalMonths : 6, isoon = cfg.intervalSoonDays > 0 ? cfg.intervalSoonDays : 30;
    var today = String(input.today || ''), out = [];
    if (!ymdOk(today)) return out;
    var held = heldList(input.meetings), last = held.length ? held[held.length - 1] : '';
    var after = function (d) { return held.some(function (h) { return h >= d; }); };
    var start = parseYmd(input.careCertStart) ? String(input.careCertStart).slice(0, 10) : '';
    var end = parseYmd(input.careCertEnd) ? String(input.careCertEnd).slice(0, 10) : '';
    var hs = hospitalState(input.stateLog);
    var inHospital = typeof input.hospitalized === 'boolean' ? input.hospitalized : hs.inHospital;
    if (!last) out.push({ kind: 'none', level: 'mid', text: '担当者会議の記録がありません', reason: '' });
    /* 認定の始まり: 始まりの lead 日前から数えて、会議が無ければ知らせる（始まる前は「間もなく」） */
    if (start) {
      var from = addDays(start, -lead);
      if (today >= from && !after(from)) {
        out.push(start <= today
          ? { kind: 'certStart', level: 'high', reason: '認定の更新', text: '今の認定期間（' + start + ' から）の担当者会議の記録がありません（始まりの ' + lead + ' 日前から数えています）' }
          : { kind: 'certStart', level: 'mid', reason: '認定の更新', text: '認定期間が ' + start + ' から始まります。担当者会議の時期です（' + from + ' から数えています）' });
      }
    }
    if (end) {
      /* 知らせは終わりの soon 日前から出すが、更新の会議として数えるのは次の認定の始まり（終わりの翌日）の lead 日前から（始まり側と同じ範囲） */
      var left = daysBetween(today, end), efrom = addDays(end, 1 - lead);
      if (left < 0) out.push({ kind: 'certEnded', level: 'high', reason: '', text: '認定期間が ' + end + ' で終わっています（認定の記録が新しくなっているか確かめてください）' });
      else if (left <= soon && !after(efrom))
        out.push({ kind: 'certEnd', level: left <= 30 ? 'high' : 'mid', reason: '認定の更新', text: '認定期間の終わり（' + end + '・あと ' + left + ' 日）が近づいています。更新の担当者会議の時期です' });
    }
    /* 区分変更: 記録した日の lead 日前から後に会議が無ければ知らせる（変更の前に開くこともあるため） */
    var cc = lastCareChange(input.careLevelHistory);
    if (cc && cc <= today && !after(addDays(cc, -lead)))
      out.push({ kind: 'careChange', level: 'high', reason: '区分変更', text: '区分変更（' + cc + ' に記録）の前後に、担当者会議の記録がありません' });
    /* 入院中は6か月の知らせを止めて、退院したら会議を、と出す。退院した後は、入院した日から後に会議が無ければ知らせる */
    if (inHospital) out.push({ kind: 'inHospital', level: 'info', reason: '', text: '入院中です（退院したら担当者会議を開いてください）' });
    /* 入院した日が分からない（記録が退院だけ）時は出さない（入院の記録の前の押し直しなどで、会議の要らない退院を知らせない） */
    else if (hs.discharged && hs.admitted && hs.discharged <= today && !after(hs.admitted))
      out.push({ kind: 'discharge', level: 'high', reason: '退院・退所', text: '退院（' + hs.discharged + '）の後の担当者会議の記録がありません' });
    if (last && !inHospital) {
      var due = addMonths(last, months), dleft = daysBetween(today, due);
      if (dleft < 0) out.push({ kind: 'interval', level: 'high', reason: '', text: '前回（' + last + '）から ' + months + ' か月を過ぎています（目安 ' + due + '）' });
      else if (dleft === 0) out.push({ kind: 'interval', level: 'high', reason: '', text: '前回（' + last + '）から今日で ' + months + ' か月です' });
      else if (dleft <= isoon) out.push({ kind: 'interval', level: 'mid', reason: '', text: '前回（' + last + '）から、間もなく ' + months + ' か月です（目安 ' + due + '・あと ' + dleft + ' 日）' });
    }
    var rank = { high: 0, mid: 1, info: 2 };
    return out.map(function (a, i) { a._i = i; return a; })
      .sort(function (a, b) { return rank[a.level] - rank[b.level] || a._i - b._i; })
      .map(function (a) { delete a._i; return a; });
  }

  /* 出席者の✔︎の候補（2026-10-25 代表者の決定「この方の前回までの出席者」）。
     この方の記録の一覧（取り消し済み・開いている記録を除く）を開催日の新しい順に見て、出席者を「所属と氏名の組」で
     重ねずに並べる（新しい会議に出た人ほど前）。所属・氏名の比べ方は互換の文字をそろえ、空白を除く。max 名まで（既定 30） */
  function attKey(a) {
    var n = function (s) { s = String(s == null ? '' : s); if (s.normalize) s = s.normalize('NFKC'); return s.replace(/\s+/g, ''); };
    return n(a && a.role) + '|' + n(a && a.name);
  }
  function attendeeCandidates(list, excludeId, max) {
    var out = [], seen = {}, lim = max > 0 ? max : 30;
    var ms = (Array.isArray(list) ? list : []).filter(function (m) {
      return m && !m.deleted && !(excludeId != null && excludeId !== '' && String(m.meetingId) === String(excludeId));
    }).map(function (m, i) { return { m: m, i: i }; });
    ms.sort(function (a, b) {
      var x = String(a.m.heldDate || ''), y = String(b.m.heldDate || '');
      return x !== y ? (x < y ? 1 : -1) : a.i - b.i;
    });
    ms.forEach(function (o) {
      (Array.isArray(o.m.attendees) ? o.m.attendees : []).forEach(function (a) {
        if (out.length >= lim || !a) return;
        var role = String(a.role == null ? '' : a.role).trim(), name = String(a.name == null ? '' : a.name).trim();
        if (!role && !name) return;
        var k = attKey({ role: role, name: name });
        if (seen[k]) return;
        seen[k] = 1; out.push({ role: role, name: name });
      });
    });
    return out;
  }

  var api = { VERSION: VERSION, FIELDS: FIELDS, KINDS: KINDS, ATTENDEE_MAX: ATTENDEE_MAX, ATTENDEE_LEN: ATTENDEE_LEN, ATTENDEE_PRINT: ATTENDEE_PRINT, INPUT_MAX: INPUT_MAX,
    parse: parse, normDate: normDate, normTime: normTime, normCount: normCount, normKind: normKind, parseAttendees: parseAttendees,
    residentMatch: residentMatch, checkSave: checkSave, checkFinal: checkFinal, dueAlerts: dueAlerts, lastHeld: lastHeld,
    addMonths: addMonths, todayJST: todayJST, hospitalState: hospitalState, lastCareChange: lastCareChange,
    attKey: attKey, attendeeCandidates: attendeeCandidates };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CareMeetingCalc = api;
})(typeof window !== 'undefined' ? window : this);
