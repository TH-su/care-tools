/* care-meeting-calc.js — サービス担当者会議の記録（担当者会議）の純関数（2026-10-23 新設・代表者の決定）
 *
 * NotebookLM が「◆欄名：」の印つきで出した議事録を、様式（サービス担当者会議の要点）の各欄へ振り分ける。
 * AI は呼ばない（決まった規則だけ）。画面（担当者会議のページ）と試験（check/unit/care_meeting_calc_test.js）が使う。
 *
 * 約束:
 *   1. 欄の区切りは、行の先頭の「◆」（◇ も可）と、知っている欄名だけ。本文の中の【CM】【施設】などの小見出しは区切りにしない
 *   2. 黙って捨てない。知らない欄名・同じ欄の重なり・最初の印より前の文章は、知らせ（warns）と一緒に返す
 *   3. 日付・時刻・回数は形を確かめ、読めない時は空にして知らせる（推測で埋めない）
 *   4. 利用者名は、開いている入居者と照らし合わせる。合わない時は確定させない（別の方の記録を入れない）
 *   5. 個人情報を外へ送らない・保存しない（この部品は計算だけ）
 */
(function (root) {
  'use strict';

  var VERSION = '2026-10-23a';
  /* 様式の欄（並びは様式どおり）。max は1欄の上限の文字数（GAS の meeting.gs と同じ値） */
  var FIELDS = [
    { key: 'residentName', label: '利用者名', max: 40 },
    { key: 'author', label: '作成担当者', max: 40 },
    { key: 'createdDate', label: '作成年月日', max: 10, kind: 'date' },
    { key: 'heldDate', label: '開催日', max: 10, kind: 'date' },
    { key: 'place', label: '開催場所', max: 100 },
    { key: 'timeText', label: '開催時間', max: 40, kind: 'time' },
    { key: 'count', label: '開催回数', max: 20, kind: 'count' },
    { key: 'attendees', label: '出席者', kind: 'attendees' },
    { key: 'items', label: '検討した項目', max: 2000 },
    { key: 'content', label: '検討内容', max: 5000 },
    { key: 'conclusion', label: '結論', max: 3000 },
    { key: 'issues', label: '残された課題', max: 2000 },
    { key: 'nextText', label: '次回の開催時期', max: 200 }
  ];
  /* 同じ欄の別の呼び方（NotebookLM の出力の揺れ・今の様式の見出し） */
  var ALIASES = {
    '会議出席者': 'attendees', '出席者一覧': 'attendees', '参加者': 'attendees',
    '作成者': 'author', '担当者': 'author',
    '作成日': 'createdDate', '開催年月日': 'heldDate', '会議日': 'heldDate',
    '場所': 'place', '時間': 'timeText', '回数': 'count',
    '検討項目': 'items', '議題': 'items',
    '次回開催時期': 'nextText', '次回の開催予定': 'nextText', '次回開催予定': 'nextText', '次回': 'nextText'
  };
  var ATTENDEE_MAX = 20;      // 保存できる人数（GAS と同じ）
  var ATTENDEE_PRINT = 9;     // 様式の表に入る人数（3列×3段）

  function nfkc(s) { s = String(s == null ? '' : s); return s.normalize ? s.normalize('NFKC') : s; }
  function labelKey(s) { return nfkc(s).replace(/[\s（）()「」【】]/g, ''); }
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
  /* ── 出席者 ── 1行に1人「所属（職種）／氏名」→ [{role, name}] */
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
      out.push({ role: role.slice(0, 40), name: name.slice(0, 40) });
    });
    if (out.length > ATTENDEE_MAX) { warns.push('出席者が ' + out.length + ' 名あります。保存できるのは ' + ATTENDEE_MAX + ' 名までです'); out = out.slice(0, ATTENDEE_MAX); }
    else if (out.length > ATTENDEE_PRINT) warns.push('出席者が ' + out.length + ' 名あります。印刷の表に入るのは ' + ATTENDEE_PRINT + ' 名までで、残りは表の下に続けて出します');
    return { list: out, warns: warns };
  }

  /* ── 振り分け ── 印つきの文章 → {fields, attendees, warns, found, missing, unknown, preamble} */
  var MARK = /^\s*[◆◇]\s*(.+?)\s*$/;
  function parse(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var sections = [], cur = null, pre = [], unknown = [], warns = [];
    lines.forEach(function (line) {
      var m = MARK.exec(line);
      if (m) {
        var body = m[1], colon = body.search(/[：:]/), label = colon >= 0 ? body.slice(0, colon) : body, rest = colon >= 0 ? body.slice(colon + 1) : '';
        var key = BY_LABEL[labelKey(label)];
        if (key) { cur = { key: key, lines: rest.trim() ? [rest.trim()] : [] }; sections.push(cur); return; }
        cur = { key: '', label: label.trim(), lines: rest.trim() ? [rest.trim()] : [] }; sections.push(cur); return;
      }
      if (cur) cur.lines.push(line); else pre.push(line);
    });
    var fields = {}, found = [];
    sections.forEach(function (s) {
      var v = s.lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
      if (!s.key) { unknown.push({ label: s.label, text: v }); warns.push('知らない欄「' + s.label.slice(0, 20) + '」があります（どの欄にも入れていません）'); return; }
      if (Object.prototype.hasOwnProperty.call(fields, s.key)) {
        warns.push('「' + fieldOf(s.key).label + '」が2回あります（つなげて入れました。確かめてください）');
        fields[s.key] = fields[s.key] + (v ? '\n' + v : '');
      } else { fields[s.key] = v; found.push(s.key); }
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
    var att = { list: [], warns: [] };
    if (fields.attendees !== undefined) { att = parseAttendees(fields.attendees); warns = warns.concat(att.warns); delete fields.attendees; }
    FIELDS.forEach(function (f) {
      if (f.max && typeof fields[f.key] === 'string' && fields[f.key].length > f.max)
        warns.push('「' + f.label + '」が ' + f.max + ' 字を超えています（' + fields[f.key].length + ' 字）。保存の前に短くしてください');
    });
    var missing = FIELDS.filter(function (f) { return f.key !== 'attendees' ? found.indexOf(f.key) < 0 : !att.list.length; }).map(function (f) { return f.key; });
    return { fields: fields, attendees: att.list, warns: warns, found: found, missing: missing, unknown: unknown, preamble: preamble, raw: raw };
  }

  /* ── 利用者名の照らし合わせ ── 空白・末尾の「様」「さん」「殿」を除いて比べる */
  function nameKey(s) { return nfkc(s).replace(/[\s]/g, '').replace(/(様|さん|殿)$/, ''); }
  function residentMatch(textName, resident) {
    var a = nameKey(textName), b = nameKey(resident && resident.name);
    if (!a) return { ok: false, reason: 'empty' };
    if (!b) return { ok: false, reason: 'noResident' };
    return a === b ? { ok: true, reason: '' } : { ok: false, reason: 'mismatch' };
  }

  /* ── 確定できるか ── rec: {heldDate, attendees[], items, content, conclusion, issues, ...}／ctx: {today, residentOk}
     戻り値 {stop:'理由（あれば確定できない）', warns:[]}。下書きの保存は止めない（長さだけは画面と GAS の両方で止める） */
  function checkFinal(rec, ctx) {
    rec = rec || {}; ctx = ctx || {};
    var warns = [], stop = '';
    var lenOver = FIELDS.filter(function (f) { return f.max && typeof rec[f.key] === 'string' && rec[f.key].length > f.max; });
    var att = Array.isArray(rec.attendees) ? rec.attendees.filter(function (a) { return a && String(a.name || '').trim(); }) : [];
    if (ctx.residentOk !== true) stop = '利用者名が、開いている方と一致しません。原本で確かめてください';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rec.heldDate || ''))) stop = '開催日を入れてください（YYYY-MM-DD）';
    else if (ctx.today && String(rec.heldDate) > String(ctx.today)) stop = '開催日が今日より後です';
    else if (!att.length) stop = '出席者を1名以上入れてください';
    else if (!String(rec.items || '').trim()) stop = '「検討した項目」が空です';
    else if (!String(rec.content || '').trim()) stop = '「検討内容」が空です';
    else if (!String(rec.conclusion || '').trim()) stop = '「結論」が空です';
    else if (lenOver.length) stop = '「' + lenOver[0].label + '」が ' + lenOver[0].max + ' 字を超えています';
    if (!String(rec.issues || '').trim()) warns.push('「残された課題」が空です（無ければ「なし」と書いてください）');
    if (!String(rec.place || '').trim()) warns.push('「開催場所」が空です');
    if (rec.createdDate && rec.heldDate && String(rec.createdDate) < String(rec.heldDate)) warns.push('作成年月日が開催日より前です');
    return { stop: stop, warns: warns };
  }

  /* ── 期限の知らせ ── 入居者1人ぶん
     in: {today, meetings:[{heldDate, status, deleted}], careCertStart, careCertEnd, cfg:{certSoonDays, intervalMonths, intervalSoonDays}}
     数えるのは確定・同意済みの会議だけ（下書き・取り消しは数えない）。戻り値 [{kind, level:'high'|'mid', text}]（high が先） */
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
  function heldList(meetings) {
    return (meetings || []).filter(function (m) { return m && !m.deleted && (m.status === 'final' || m.status === 'consented') && parseYmd(m.heldDate); })
      .map(function (m) { return String(m.heldDate).slice(0, 10); }).sort();
  }
  function lastHeld(meetings) { var h = heldList(meetings); return h.length ? h[h.length - 1] : ''; }
  function dueAlerts(input) {
    input = input || {};
    var cfg = input.cfg || {}, soon = cfg.certSoonDays > 0 ? cfg.certSoonDays : 60, months = cfg.intervalMonths > 0 ? cfg.intervalMonths : 6,
        isoon = cfg.intervalSoonDays > 0 ? cfg.intervalSoonDays : 30;
    var today = String(input.today || ''), out = [];
    if (!parseYmd(today)) return out;
    var held = heldList(input.meetings), last = held.length ? held[held.length - 1] : '';
    var start = parseYmd(input.careCertStart) ? String(input.careCertStart).slice(0, 10) : '';
    var end = parseYmd(input.careCertEnd) ? String(input.careCertEnd).slice(0, 10) : '';
    if (!last) out.push({ kind: 'none', level: 'mid', text: '担当者会議の記録がありません' });
    if (start && start <= today && !held.some(function (h) { return h >= start; }))
      out.push({ kind: 'certStart', level: 'high', text: '今の認定期間（' + start + ' から）になってから、担当者会議の記録がありません' });
    if (end) {
      var left = daysBetween(today, end), from = addDays(end, -soon);
      if (left < 0) out.push({ kind: 'certEnded', level: 'high', text: '認定期間が ' + end + ' で終わっています（認定の記録が新しくなっているか確かめてください）' });
      else if (left <= soon && !held.some(function (h) { return h >= from; }))
        out.push({ kind: 'certEnd', level: left <= 30 ? 'high' : 'mid', text: '認定期間の終わり（' + end + '・あと ' + left + ' 日）が近づいています。更新の担当者会議の時期です' });
    }
    if (last) {
      var due = addMonths(last, months), dleft = daysBetween(today, due);
      if (dleft <= 0) out.push({ kind: 'interval', level: 'high', text: '前回（' + last + '）から ' + months + ' か月を過ぎています（目安 ' + due + '）' });
      else if (dleft <= isoon) out.push({ kind: 'interval', level: 'mid', text: '前回（' + last + '）から、間もなく ' + months + ' か月です（目安 ' + due + '・あと ' + dleft + ' 日）' });
    }
    return out.sort(function (a, b) { return (a.level === 'high' ? 0 : 1) - (b.level === 'high' ? 0 : 1); });
  }

  var api = { VERSION: VERSION, FIELDS: FIELDS, ATTENDEE_MAX: ATTENDEE_MAX, ATTENDEE_PRINT: ATTENDEE_PRINT,
    parse: parse, normDate: normDate, normTime: normTime, normCount: normCount, parseAttendees: parseAttendees,
    residentMatch: residentMatch, checkFinal: checkFinal, dueAlerts: dueAlerts, lastHeld: lastHeld, addMonths: addMonths };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CareMeetingCalc = api;
})(typeof window !== 'undefined' ? window : this);
