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
 *   7. 印が1つも無い議事録は、よくある見出しから欄の候補を出すだけ（guess）。欄へ入れるのは人が選んだ候補だけ（guessApply）。
 *      候補にならなかった文も捨てずに返す（2026-11-13 代表者の指示）
 *   8. ほかの形の表（CSV・貼った表）からの取り込みは、読む・列の候補・1行の記録の形・行ごとの判定まで（imp*）。
 *      列の当ては人が決める。名簿の1名にだけ一致・開催日が読めて先の日付でない・上限に収まる・表の中で重ならない行だけを送る候補にする
 *      （2026-11-17 代表者の決定・細部は仮置き）
 */
(function (root) {
  'use strict';

  var VERSION = '2026-11-17';
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

  /* ── メニューの札の件数（2026-11-13 代表者の決定・台帳 CM-02・仮置き） ──
     入居者を選ぶ画面の材料（共有名簿＋最終開催日の要約）だけで数える。数えるのは「前回から6か月」の知らせ（dueAlerts の interval）だけで、
     認定の更新・区分変更・退院の後・記録なしは数えない（1人ずつの記録を読まないため）。
     in: residents [{masterId, active, hospitalized}]（在籍している方だけ数える）・summary {masterId:{lastHeld}}・today 'YYYY-MM-DD'
     戻り値 {v:1, at:today, cm:true, overdue:n, soon:n}（overdue＝過ぎた・今日で6か月、soon＝30日以内）。件数と日付だけで、氏名・番号は入れない。
     today が日付でない・名簿や要約の形が違う時は null（書かない） */
  function menuDueSummary(residents, summary, today) {
    if (!ymdOk(today) || !Array.isArray(residents) || !summary || typeof summary !== 'object') return null;
    var overdue = 0, soon = 0;
    residents.forEach(function (r) {
      if (!r || r.active === false || r.masterId == null) return;
      var id = String(r.masterId), s = Object.prototype.hasOwnProperty.call(summary, id) ? summary[id] : null;
      var last = s && ymdOk(String(s.lastHeld || '').slice(0, 10)) ? String(s.lastHeld).slice(0, 10) : '';
      if (!last) return;
      dueAlerts({ today: today, meetings: [{ heldDate: last, status: 'final' }], hospitalized: r.hospitalized === true })
        .forEach(function (a) {
          if (a.kind !== 'interval') return;
          if (a.level === 'high') overdue++;
          else if (a.level === 'mid') soon++;
        });
    });
    return { v: 1, at: today, cm: true, overdue: overdue, soon: soon };
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

  /* ── 印の無い議事録の見出しから欄の候補を出す（2026-11-13 代表者の指示） ──
     「◆欄名：」の印が1つも無い時（parse の found が空の時）だけ使う。決まった表の語に一致する見出しの行を候補にし、
     どの欄へ入れるかは人が選ぶ（この関数は欄へ入れない）。
     ★この表は parse の区切りに使わない（ALIASES に入れると「◆課題：」などが欄の区切りになり、印のある議事録の振り分けが変わるため）
     見出しと認める形は2つだけ: (1) 飾り（【】■●・# 番号など）を外した残り全体が表の語 (2)「語：本文」の語が表の語。
     本文の中の【CM】【施設】・「結論としては…」のような文は見出しにしない
     2026-11-14 代表者の決定: 一般の会議の言い方（議題・話し合い・今後の方針・決まったこと・次回まで・宿題 など）まで広げた。
     入れる欄は今の表の並びにそろえる（話し合い＝検討内容、方針＝結論、次回まで・宿題・持ち帰り＝残された課題、次回の会議・日程＝次回の開催時期）。
     ★「日時」は入れない（日付と時刻の1行は開催日の形で読めず、欄が空になるため） */
  var GUESS_WORDS = {
    sourceName: ['利用者名', '利用者', '利用者氏名', '対象者'],
    kind: ['開催の理由', '開催理由', '開催目的', '会議の目的'],
    author: ['作成担当者', '作成者', '記録者'],
    createdDate: ['作成年月日', '作成日'],
    heldDate: ['開催日', '開催年月日', '会議日', '実施日'],
    place: ['開催場所', '場所', '会場', '実施場所'],
    timeText: ['開催時間', '時間'],
    count: ['開催回数', '回数'],
    attendees: ['出席者', '参加者', '会議出席者', '出席者一覧', '参加者一覧', '出席', '参加', 'メンバー', '出席メンバー', '参加メンバー'],
    items: ['検討した項目', '検討項目', '検討事項', '議題', '協議事項', '本日の議題', '議事', '話し合う項目', '話し合うこと'],
    content: ['検討内容', '検討の内容', '協議内容', '話し合いの内容', '主な意見', '話し合い', '話し合ったこと', '話し合いの要点', '各職種の意見', '意見', '報告事項'],
    conclusion: ['結論', '決定事項', '決まったこと', 'まとめ', '今後の方針', '方針', '支援の方針', '対応の方針', '決めたこと', '合意事項'],
    issues: ['残された課題', '今後の課題', '残った課題', '課題', '次回まで', '次回までに', '次回までの課題', '次回までにすること', '宿題', '持ち帰り', '持ち帰り事項', '検討課題', '懸案事項'],
    nextText: ['次回の開催時期', '次回開催時期', '次回の開催予定', '次回開催予定', '次回の予定', '次回', '次回の会議', '次回会議', '次回の日程', '次回日程']
  };
  var GUESS_BY = {};
  Object.keys(GUESS_WORDS).forEach(function (k) { GUESS_WORDS[k].forEach(function (w) { GUESS_BY[labelKey(w)] = k; }); });
  var GUESS_HEAD_MAX = 20;    // 見出しの語の長さの上限（これより長い「〜：」は文として扱う）
  /* 行の先頭の飾りを1つずつ外す（★正規表現1本で繰り返すと、飾りの長く続く行で時間がかかるため markBody と同じく1つずつ） */
  function stripDecor(line) {
    var s = String(line).replace(/^\s+/, ''), prev;
    for (var i = 0; i < 20 && s; i++) {
      prev = s;
      s = s.replace(/^(?:#{1,6}|>|[-+]|\*+|_{2,}|[・■□●○◎◯▼▽▶►▷◆◇★☆※]|\d{1,2}[.．)）]|[(（]\d{1,2}[)）]|[一二三四五六七八九十]{1,2}[、.．])\s*/, '');
      if (s === prev) break;
    }
    return s;
  }
  /* 見出しの行なら {head, key, rest} を返す。違えば null */
  function guessHead(line) {
    var s = stripDecor(line), mm, word, rest;
    if (!s) return null;
    if ((mm = /^[【［\[〔《]([^】］\]〕》]{1,20})[】］\]〕》]\s*(?:[：:]\s*)?([\s\S]*)$/.exec(s))) { word = mm[1]; rest = mm[2]; }
    else {
      var colon = s.search(/[：:]/);
      if (colon > 0 && colon <= GUESS_HEAD_MAX) { word = s.slice(0, colon); rest = s.slice(colon + 1); }
      else if (colon < 0 && s.length <= GUESS_HEAD_MAX) { word = s; rest = ''; }
      else return null;
    }
    var key = GUESS_BY[labelKey(word)];
    if (!key) return null;
    rest = rest.replace(/^\s*(?:\*\*|__)\s*/, '').trim();
    /* 同じ行の後ろが「◆」の印の形の時は見出しにしない（組み直した文の中で別の欄の印として読まれ、選んでいない欄に入るため） */
    if (rest && markBody(rest) !== null) return null;
    return { head: word.trim(), key: key, rest: rest };
  }
  /* 印の無い文章 → {cands:[{head, key, line, body, lines, src}], rest, tooLong, marked}
     cands は見出しの順。body は見出しの行の後ろの文（同じ行の「：」の後ろを含む）から次の見出しの前まで。
     src は見出しの行からの元の文のまま（選ばなかった時に返す）。rest は最初の見出しより前の文（どの候補にも入らない文）。空でない行はすべて、どれか1つの候補か rest に入る（捨てない）
     印のある文章（parse で欄が1つでも見つかる）・長すぎる文章では候補を出さない（marked・tooLong） */
  function guess(text) {
    var src = String(text == null ? '' : text);
    if (src.length > INPUT_MAX) return { cands: [], rest: '', tooLong: true, marked: false };
    if (parse(src).found.length) return { cands: [], rest: '', tooLong: false, marked: true };
    var cands = [], pre = [], cur = null;
    src.replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var h = guessHead(line);
      if (h) { cur = { head: h.head, key: h.key, line: line.trim(), body: [], src: [line] }; if (h.rest) cur.body.push(h.rest); cands.push(cur); return; }
      if (cur) { cur.body.push(line); cur.src.push(line); } else pre.push(line);
    });
    cands.forEach(function (c) {
      c.body = c.body.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
      c.lines = c.body ? c.body.split('\n').length : 0;
      c.src = c.src.join('\n').replace(/\s+$/, '');
    });
    return { cands: cands, rest: pre.join('\n').trim(), tooLong: false, marked: false };
  }
  /* 人が選んだ候補だけを欄へ入れる形にする。choices は候補と同じ並びで、欄の key（入れない時は '' か null）。
     選んだ分を「◆欄名：」の形に組み直して parse に通す（日付・時刻・回数・出席者の形の確かめは parse と同じ）。
     同じ欄に2つ以上選んだ時は、見出しの順につないで1つにして知らせる。選ばなかった候補は見出しの行ごと rest に足す。
     戻り値 parse と同じ形 ＋ {rest, chosen}。1つも選んでいない時は chosen が 0 で fields は空 */
  var ONE_LINE = { createdDate: 1, heldDate: 1, timeText: 1, count: 1, kind: 1 };   // parse が形を確かめる1行の欄
  function guessApply(g, choices) {
    var cands = (g && Array.isArray(g.cands)) ? g.cands : [], ch = Array.isArray(choices) ? choices : [];
    var by = {}, left = [], dupWarn = [];
    if (g && g.rest) left.push(String(g.rest));
    cands.forEach(function (c, i) {
      var k = ch[i];
      if (k && fieldOf(k)) {
        var body = String(c.body || '');
        /* 形を確かめる1行の欄は、最初の文の行（見出しの行の後ろ、無ければ次の行）だけを入れ、続く行は振り分けられなかった文へ回す
           （続く行まで入れると形を読めずに空になり、どこにも残らなかった・反証レビューの指摘 2026-11-13） */
        if (ONE_LINE[k]) {
          var bl = body.split('\n'), j = 0;
          while (j < bl.length && !bl[j].trim()) j++;
          var more = bl.slice(j + 1).join('\n').trim();
          body = j < bl.length ? bl[j].trim() : '';
          if (more) left.push(more);
        }
        (by[k] = by[k] || []).push(body);
        return;
      }
      left.push(String(c.src || c.line || ''));
    });
    var parts = [], chosen = 0;
    FIELDS.forEach(function (f) {
      if (!by[f.key]) return;
      chosen += by[f.key].length;
      if (by[f.key].length > 1) dupWarn.push('「' + f.label + '」の欄に ' + by[f.key].length + ' つの見出しの文をつないで入れました（確かめてください）');
      parts.push('◆' + f.label + '：\n' + by[f.key].join('\n'));
    });
    var res = chosen ? parse(parts.join('\n')) : { fields: {}, attendees: [], warns: [], found: [], unknown: [], preamble: '', raw: {}, tooLong: false,
      missing: FIELDS.filter(function (f) { return !f.optional; }).map(function (f) { return f.key; }) };
    res.warns = dupWarn.concat(res.warns);
    /* 形を読めずに空にした欄の元の文も、振り分けられなかった文へ足す（黙って捨てない） */
    Object.keys(ONE_LINE).forEach(function (k) {
      var raw = res.raw && res.raw[k] !== undefined ? String(res.raw[k]).trim() : '';
      if (raw && !String(res.fields[k] == null ? '' : res.fields[k]).trim()) left.push(raw);
    });
    res.rest = left.join('\n\n').trim();
    res.chosen = chosen;
    return res;
  }

  /* ═══ ほかの形の表（CSV・Excel などから貼った表）から過去の会議を取り込む（2026-11-17 代表者の決定・細部は仮置き） ═══
     1行が1会議の表だけを読む。AI は呼ばない・通信しない（読む → 列の当て → 1行ずつ記録の形 → 行ごとの判定 まで）。
     ★ALIASES・GUESS_WORDS には足さない（parse・guess の区切りが変わるため）。見出しの語はこの節の表だけで引く
     ★開催の理由は当てない・入れない（空欄で入れる。E表別紙からの取り込みと同じ）
     ★表と判定はメモリだけで使う（この部品は保存しない） */
  var IMP_ROWS_MAX = 2000;                // 見出しを除いた行の数の上限（仮置き）
  var IMP_BYTES_MAX = 2 * 1024 * 1024;    // 表の大きさの上限（UTF-8 のバイト数・仮置き）
  var IMP_ID_RE = /^[0-9A-Za-z_-]{1,32}$/; // 利用者No（担当者会議のページの ID_RE と同じ形）
  function utf8Len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  /* ── 表を読む ── text → {ok:true, sep:'\t'|',', header:[…], rows:[[…]], ragged:列の数が見出しと違う行の数}／{ok:false, reason, message}
     区切りは1行目にタブがあればタブ（Excel などから貼った表）、無ければカンマ（CSV）。
     引用符（"）で始まるセルは、閉じる引用符まで改行・区切りもセルの中身とし、"" は " 1字にする。先頭の BOM を落とす。改行は CRLF・LF・CR。
     中身が空の行は飛ばす。引用符が閉じないまま終わった時・上限を超えた時は読まない（例外を出さない）。
     ★1文字ずつ読む（正規表現1本で読むと、引用符の多い表で時間がかかるため） */
  function impTable(text, limits) {
    limits = limits || {};
    var maxRows = typeof limits.rows === 'number' ? limits.rows : IMP_ROWS_MAX;
    var maxBytes = typeof limits.bytes === 'number' ? limits.bytes : IMP_BYTES_MAX;
    var src = String(text == null ? '' : text);
    if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
    if (utf8Len(src) > maxBytes) return { ok: false, reason: 'tooBig', message: '表が大きすぎます（' + Math.round(maxBytes / 1024 / 1024) + 'MB まで）。年ごとなどに分けて読んでください' };
    /* 区切りは、中身のある最初の行（見出しになる行）で決める（先頭に空の行がある貼り付けでも見出しと同じ行で見る） */
    var lines = src.split(/\r\n?|\n/), first = '';
    for (var li = 0; li < lines.length; li++) if (/[^\s,]/.test(lines[li])) { first = lines[li]; break; }
    var sep = first.indexOf('\t') >= 0 ? '\t' : ',';
    var out = [], row = [], cell = '', inQ = false, quoted = false, i = 0, len = src.length, header = null, ragged = 0, over = false;
    function endRow() {
      row.push(cell); cell = ''; quoted = false;
      var any = false;
      for (var k = 0; k < row.length; k++) if (String(row[k]).trim()) { any = true; break; }
      if (any) {
        if (!header) header = row;
        else {
          if (out.length >= maxRows) { over = true; }
          else { if (row.length !== header.length) ragged++; out.push(row); }
        }
      }
      row = [];
    }
    while (i < len && !over) {
      var ch = src.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        if (ch === '\r') { cell += '\n'; i += src.charAt(i + 1) === '\n' ? 2 : 1; continue; }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === '' && !quoted) { inQ = true; quoted = true; i++; continue; }
      if (ch === sep) { row.push(cell); cell = ''; quoted = false; i++; continue; }
      if (ch === '\r' || ch === '\n') { endRow(); i += (ch === '\r' && src.charAt(i + 1) === '\n') ? 2 : 1; continue; }
      cell += ch; i++;
    }
    if (over) return { ok: false, reason: 'tooMany', message: '行が ' + maxRows + ' 行を超えています。年ごとなどに分けて読んでください' };
    if (inQ) return { ok: false, reason: 'quote', message: '引用符（"）が閉じていないセルがあります。表を書き出し直してください' };
    if (cell !== '' || row.length) endRow();
    if (over) return { ok: false, reason: 'tooMany', message: '行が ' + maxRows + ' 行を超えています。年ごとなどに分けて読んでください' };
    if (!header) return { ok: false, reason: 'empty', message: '表が空です' };
    return { ok: true, sep: sep, header: header, rows: out, ragged: ragged };
  }
  /* ── 文字コード ── 採用管理の decodeCsv（ats-calc.js）と同じ決まり: UTF-8 で読んで置き換え文字（U+FFFD）が出たら Shift_JIS で読み直す。
     decoder(label) は TextDecoder を作る関数。戻り値 {text, enc:'UTF-8'|'Shift_JIS'} */
  function impDecode(bytes, decoder) {
    var u = '';
    try { u = decoder('utf-8').decode(bytes); } catch (e) { u = ''; }
    if (u && u.indexOf('�') < 0) return { text: u, enc: 'UTF-8' };
    try { return { text: decoder('shift_jis').decode(bytes), enc: 'Shift_JIS' }; } catch (e) { return { text: u, enc: 'UTF-8' }; }
  }
  /* ── 見出しから欄の候補 ── 一般の語だけ（特定のソフトの名前・列名は書かない）。様式の欄の名前と ALIASES も引く（開催の理由は除く） */
  var IMP_WORDS = {
    sourceName: ['氏名', '利用者', '利用者氏名', '利用者名', '対象者', '名前', 'お名前', '入居者名', '入居者氏名'],
    author: ['作成者', '記録者'],
    createdDate: ['作成日'],
    heldDate: ['開催日', '開催年月日', '会議日', '実施日', '開催日時', '会議開催日'],
    place: ['場所', '会場', '実施場所'],
    timeText: ['時間', '会議時間'],
    count: ['回数'],
    attendees: ['参加者', '出席者', '参加者一覧', '出席者氏名', '参加者氏名'],
    items: ['検討事項', '議題'],
    content: ['内容', '協議内容', '会議内容', '話し合いの内容'],
    conclusion: ['決定事項', 'まとめ', '今後の方針'],
    issues: ['課題', '今後の課題'],
    nextText: ['次回', '次回の予定', '次回開催']
  };
  var IMP_KIND_WORDS = ['開催の理由', '開催理由', '開催目的', '会議の目的'];
  var IMP_BY = Object.create(null), IMP_KIND = Object.create(null);
  FIELDS.forEach(function (f) { if (f.key !== 'kind') IMP_BY[labelKey(f.label)] = f.key; });
  Object.keys(ALIASES).forEach(function (a) { if (ALIASES[a] !== 'kind') IMP_BY[labelKey(a)] = ALIASES[a]; });
  Object.keys(IMP_WORDS).forEach(function (k) { IMP_WORDS[k].forEach(function (w) { IMP_BY[labelKey(w)] = k; }); });
  IMP_KIND_WORDS.forEach(function (w) { IMP_KIND[labelKey(w)] = 1; });
  /* header → {map:[欄の key か ''（入れない）], cols:[{i, head, key, why:''|'none'|'dup'|'kind'|'empty'}], warns}
     同じ欄に2列以上が当たった時は、その列をどれも「入れない」にして知らせる（どちらかは人が選ぶ）。候補は出すだけで、決めるのは人 */
  function impGuessCols(header) {
    var hs = Array.isArray(header) ? header : [], cols = [], warns = [], by = Object.create(null);
    hs.forEach(function (h, i) {
      var head = String(h == null ? '' : h).trim(), k = labelKey(head), key = '', why = '';
      if (!k) why = 'empty';
      else if (IMP_KIND[k]) why = 'kind';
      else if (Object.prototype.hasOwnProperty.call(IMP_BY, k)) key = IMP_BY[k];
      else why = 'none';
      cols.push({ i: i, head: head, key: key, why: why });
      if (key) (by[key] = by[key] || []).push(i);
    });
    Object.keys(by).forEach(function (key) {
      if (by[key].length < 2) return;
      by[key].forEach(function (i) { cols[i].key = ''; cols[i].why = 'dup'; });
      warns.push('「' + fieldOf(key).label + '」に当たる列が ' + by[key].length + ' つあります（' + by[key].map(function (i) { return cols[i].head.slice(0, 20); }).join('・') + '）。どの列を入れるか選んでください');
    });
    cols.forEach(function (c) {
      if (c.why === 'kind') warns.push('列「' + c.head.slice(0, 20) + '」は開催の理由です。開催の理由は取り込みません（空欄で入ります）');
      else if (c.why === 'none') warns.push('列「' + c.head.slice(0, 20) + '」はどの欄にも当てていません（入れる時は欄を選んでください）');
    });
    return { map: cols.map(function (c) { return c.key; }), cols: cols, warns: warns };
  }
  /* ── 取り込みの日付 ── normDate の形に加えて 平成・H、後ろの時刻（2024/4/1 0:00・秒つき・T 区切り）、8桁の数字（20240401）を読む。
     Excel の通し番号（45383 など）・月日の順が分からない形（1/2/2024）・「4月」だけ・空は読まない（''）。normDate は変えない */
  var HEISEI_FROM = '1989-01-08', HEISEI_TO = '2019-04-30';
  function impDate(s) {
    var t = nfkc(s).replace(/[（(][^）)]*[）)]/g, '').trim(), d;
    if (!t) return '';
    /* 空白を消す前に後ろの時刻を外す（先に消すと「2024/4/1 0:00」が「2024/4/10:00」になる） */
    t = t.replace(/(?:\s+|T)\d{1,2}[:：]\d{2}(?:[:：]\d{2})?$/, '');
    /* 数字と数字の間に空白が残る形（「2024/4/1 2」など）は読まない（空白を消すと 4月12日 と読み違えるため） */
    if (/\d\s+\d/.test(t)) return '';
    t = t.replace(/\s+/g, '');
    if (!t) return '';
    d = normDate(t);
    if (d) return d;
    var mm;
    if ((mm = /^(?:平成|H)(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i.exec(t))) {
      var n = mm[1] === '元' ? 1 : +mm[1];
      if (n < 1 || n > 31) return '';
      d = normDate((1988 + n) + '-' + mm[2] + '-' + mm[3]);
      return d && d >= HEISEI_FROM && d <= HEISEI_TO ? d : '';
    }
    if ((mm = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) {
      if (+mm[1] < 1900) return '';
      return normDate(mm[1] + '-' + mm[2] + '-' + mm[3]);
    }
    return '';
  }
  /* ── 1行を記録の形に ── cells（1行のセル）と map（列ごとの欄の key か ''）→ {rec, warns, raw}
     rec は今の保存の欄の名前（FIELDS の key）。開催の理由は入れない（いつも ''）。同じ欄に当てた複数の列は改行でつなぐ。
     日付・時間・回数は読めなければ空にして知らせる（元の文字は raw）。出席者は1セルを改行・「、」・「;」で分けて parseAttendees へ。
     長すぎる欄は切り詰めない（impPlan が checkSave で止める） */
  function impRow(cells, map) {
    var cs = Array.isArray(cells) ? cells : [], mp = Array.isArray(map) ? map : [], vals = Object.create(null), warns = [], raw = {};
    for (var i = 0; i < mp.length; i++) {
      var key = mp[i];
      if (!key || key === 'kind' || !fieldOf(key)) continue;
      var v = String(cs[i] == null ? '' : cs[i]).replace(/\r\n?/g, '\n').trim();
      if (v) (vals[key] = vals[key] || []).push(v);
    }
    var rec = {};
    FIELDS.forEach(function (f) { rec[f.key] = f.key === 'attendees' ? [] : ''; });
    FIELDS.forEach(function (f) {
      var k = f.key;
      if (k === 'kind' || !vals[k]) return;
      var v = vals[k].join('\n');
      if (k === 'attendees') {
        var lines = [];
        vals[k].forEach(function (c) { c.split(/\n|、|;|；/).forEach(function (x) { if (x.trim()) lines.push(x.trim()); }); });
        var att = parseAttendees(lines.join('\n'));
        rec.attendees = att.list; warns = warns.concat(att.warns);
      } else if (f.type === 'date') {
        raw[k] = v; rec[k] = impDate(v);
        if (!rec[k]) warns.push('「' + f.label + '」の日付を読めません（' + v.slice(0, 20) + '）');
      } else if (f.type === 'time') {
        raw[k] = v; var tm = normTime(v); rec[k] = tm ? tm.text : '';
        if (!tm) warns.push('「開催時間」を読めません（' + v.slice(0, 20) + '）');
      } else if (f.type === 'count') {
        raw[k] = v; rec[k] = normCount(v);
        if (!rec[k]) warns.push('「開催回数」を読めません（' + v.slice(0, 20) + '）');
      } else rec[k] = v;
    });
    return { rec: rec, warns: warns, raw: raw };
  }
  /* ── 送信の印 ── 'impc-<利用者No>-<YYYYMMDD>'。番号・開催日の形が違えば '' */
  function impKey(id, heldDate) {
    var s = String(id == null ? '' : id);
    if (!IMP_ID_RE.test(s) || !ymdOk(heldDate)) return '';
    return 'impc-' + s + '-' + String(heldDate).replace(/-/g, '');
  }
  /* ── 行ごとの判定 ── rows（impRow の戻り値か rec）・roster（名簿 [{masterId, name, active}]・退去した方も含めて渡す）・today（'YYYY-MM-DD'）
     → {items:[{i, status, id, name, active, heldDate, key, stop, warns, rec}], counts:{状態: 件数}}／形が違えば null
     status（決まる順）: unmatched 名簿の0名 → ambiguous 2名以上（退去した方も数える）→ baddate 開催日が読めない → future 先の日付
       → toolong 上限超え（checkSave・切り詰めない）→ infile 同じ表に同じ方・同じ開催日がほかにもある（その行はどれも入れない）→ new 送る候補
     infile は名簿の1名に一致して開催日が読めた行どうしで数える（先の日付・上限超えの行も数に入れる）＝行の順を変えても答えは同じ */
  var IMP_STATUSES = ['new', 'unmatched', 'ambiguous', 'baddate', 'future', 'toolong', 'infile'];
  function impPlan(rows, roster, today) {
    if (!Array.isArray(rows) || !Array.isArray(roster) || !ymdOk(today)) return null;
    var people = roster.filter(function (r) { return r && nameKey(r.name); });
    var items = rows.map(function (row, i) {
      var rec = (row && row.rec && typeof row.rec === 'object') ? row.rec : (row || {});
      var warns = (row && Array.isArray(row.warns)) ? row.warns.slice() : [];
      var nk = nameKey(rec.sourceName), hits = nk ? people.filter(function (r) { return nameKey(r.name) === nk; }) : [];
      var it = { i: i, status: '', id: '', name: '', active: false, heldDate: ymdOk(rec.heldDate) ? rec.heldDate : '', key: '', stop: '', warns: warns, rec: rec };
      if (hits.length === 1) {
        var id = String(hits[0].masterId != null ? hits[0].masterId : (hits[0].id != null ? hits[0].id : ''));
        if (IMP_ID_RE.test(id)) { it.id = id; it.name = String(hits[0].name); it.active = hits[0].active !== false; }
      }
      if (!hits.length || (hits.length === 1 && !it.id)) it.status = 'unmatched';
      else if (hits.length > 1) it.status = 'ambiguous';
      else if (!it.heldDate) it.status = 'baddate';
      else if (it.heldDate > today) it.status = 'future';
      else if ((it.stop = checkSave(rec).stop)) it.status = 'toolong';
      return it;
    });
    var group = Object.create(null);
    items.forEach(function (it) { if (it.id && it.heldDate) { var g = it.id + '|' + it.heldDate; group[g] = (group[g] || 0) + 1; } });
    items.forEach(function (it) {
      if (it.status) return;
      if (group[it.id + '|' + it.heldDate] > 1) { it.status = 'infile'; return; }
      it.status = 'new'; it.key = impKey(it.id, it.heldDate);
    });
    var counts = {};
    IMP_STATUSES.forEach(function (s) { counts[s] = 0; });
    items.forEach(function (it) { counts[it.status]++; });
    return { items: items, counts: counts };
  }

  var api = { VERSION: VERSION, FIELDS: FIELDS, KINDS: KINDS, ATTENDEE_MAX: ATTENDEE_MAX, ATTENDEE_LEN: ATTENDEE_LEN, ATTENDEE_PRINT: ATTENDEE_PRINT, INPUT_MAX: INPUT_MAX,
    parse: parse, guess: guess, guessApply: guessApply, guessHead: guessHead, normDate: normDate, normTime: normTime, normCount: normCount, normKind: normKind, parseAttendees: parseAttendees,
    residentMatch: residentMatch, checkSave: checkSave, checkFinal: checkFinal, dueAlerts: dueAlerts, lastHeld: lastHeld, menuDueSummary: menuDueSummary,
    addMonths: addMonths, todayJST: todayJST, hospitalState: hospitalState, lastCareChange: lastCareChange,
    attKey: attKey, attendeeCandidates: attendeeCandidates,
    IMP_ROWS_MAX: IMP_ROWS_MAX, IMP_BYTES_MAX: IMP_BYTES_MAX, IMP_STATUSES: IMP_STATUSES,
    impTable: impTable, impDecode: impDecode, impGuessCols: impGuessCols, impDate: impDate, impRow: impRow, impPlan: impPlan, impKey: impKey };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CareMeetingCalc = api;
})(typeof window !== 'undefined' ? window : this);
