/* training-plan-mask-main.mjs — 個別機能訓練計画書の純関数の層（TP_PURE_MODULE）の写し。比べる相手として固定する。
   写した元: origin/main の training-plan.html（コミット a3f510c 時点・md5 e361c6c18124fcb209d51a5072519f95）。
   中身は一字一句そのまま（この見出しのコメントだけを足した）。読み込むのは check/unit/training_plan_mask_vs_main_test.js だけで、
   文字として読んで vm で評価する（import しない）。画面の伏せ字を直しても、この写しは直さない（直す前より弱くならないことを確かめる相手）。 */
(function (global) {
'use strict';

var ID_RE = /^[0-9A-Za-z_-]{1,32}$/;
var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var STATUSES = ['none', 'draft_ai', 'reviewed', 'printed', 'signed'];
var STATUS_LABEL = { none:'未作成', draft_ai:'AI生成', reviewed:'確認・修正済', printed:'印刷済', signed:'家族署名受領済' };
var DUE_RULES = ['calendar', 'min', 'days90'];
var STATE_RANK = { overdue:0, warn:1, none:2, ok:3, ended:4 };
var PLAN_MONTHS = 3;          /* 3月ごとに1回以上（Ⅰイの要件） */
var PLAN_DAYS = 90;           /* 日数ルールを選んだ時の日数 */
/* 【報告書欄】その期の評価に入る欄（D20・D34）。evalOrigin.fields の絞り込みにも使う。
   ★アプリ側（下のスクリプト）にも同じ並びの EVAL_KEYS があるが、この層は document 等に触れず
     単体で評価できる形に保つ決まりのため、あえて別に持つ（意図的な重複）。 */
var EVAL_KEYS = ['shortAchievement', 'longAchievement', 'changes', 'issues'];

function s_(v) { return String(v == null ? '' : v); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isYmd(v) { return YMD_RE.test(s_(v)) && !!parseYmd(v); }

/* 入居者マスタから来た日付を 'YYYY-MM-DD' にそろえる（2026-09-24）。
   ★スプレッドシートが日付の文字列を日付型に変えると、「2026-09-23T15:00:00.000Z」や
     「Thu Sep 24 2026 00:00:00 GMT+0900 (日本標準時)」の形で届く。先頭10文字を切ると
     日本時間では前日になり、そのままでは英語の日付が画面・計画書に出る。
     時刻付きの形だけを日本時間の日付に直し、それ以外（「2020年頃」など人の記入）は元のまま返す。 */
var DT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
var DT_JS_RE = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}/;
function toYmd(v) {
  var t = s_(v).replace(/^[\s　]+|[\s　]+$/g, '');
  if (YMD_RE.test(t)) return t;
  var m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/.exec(t);
  if (m) return fmtYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  if (DT_ISO_RE.test(t) || DT_JS_RE.test(t)) {
    var ms = Date.parse(t);
    if (!isNaN(ms)) {
      var j = new Date(ms + 9 * 3600000);   /* 施設は日本時間。端末の時間帯に左右されない */
      return fmtYmd(j.getUTCFullYear(), j.getUTCMonth() + 1, j.getUTCDate());
    }
  }
  return t;
}

/* 'YYYY-MM-DD' → {y,m,d}。実在しない日付（2月30日など）は null を返す */
function parseYmd(v) {
  var m = YMD_RE.exec(s_(v));
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > daysInMonth(y, mo)) return null;
  return { y: y, m: mo, d: d };
}
function fmtYmd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
function daysInMonth(y, m) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

/* 暦月の加算。応当日が無い月は月末へ丸める（1/31 の3か月後は 4/30、11/30 の3か月後は 2/28） */
function addMonthsClamp(ymd, months) {
  var p = parseYmd(ymd);
  if (!p) return '';
  var n = Number(months) || 0;
  var total = (p.y * 12) + (p.m - 1) + n;
  var y = Math.floor(total / 12), m = (total % 12) + 1;
  if (m <= 0) { m += 12; y -= 1; }
  var d = Math.min(p.d, daysInMonth(y, m));
  return fmtYmd(y, m, d);
}
function addDays(ymd, days) {
  var p = parseYmd(ymd);
  if (!p) return '';
  var t = Date.UTC(p.y, p.m - 1, p.d) + (Number(days) || 0) * 86400000;
  var d = new Date(t);
  return fmtYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
/* a - b（日数）。どちらかが不正なら null */
function diffDays(a, b) {
  var pa = parseYmd(a), pb = parseYmd(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86400000);
}
function cmpYmd(a, b) { return s_(a) < s_(b) ? -1 : (s_(a) > s_(b) ? 1 : 0); }

/* 次回期限。起算は最新計画の作成日。既定は暦月3か月の応当日（D6） */
function nextDueOf(planDate, rule) {
  if (!isYmd(planDate)) return '';
  var r = DUE_RULES.indexOf(s_(rule)) >= 0 ? s_(rule) : 'calendar';
  var cal = addMonthsClamp(planDate, PLAN_MONTHS);
  var d90 = addDays(planDate, PLAN_DAYS);
  if (r === 'days90') return d90;
  if (r === 'min') return cmpYmd(cal, d90) <= 0 ? cal : d90;
  return cal;
}

/* 期限の状態。warnDays 日前から warn（既定28日前）。期限当日は warn（超過ではない） */
function dueState(nextDue, today, warnDays) {
  if (!isYmd(nextDue)) return 'none';
  var d = diffDays(nextDue, today);
  if (d === null) return 'none';
  var w = Number(warnDays);
  if (!isFinite(w) || w < 0) w = 28;
  if (d < 0) return 'overdue';
  if (d <= w) return 'warn';
  return 'ok';
}

/* 氏名の正規化（名寄せ用）。空白だけ除く。異体字は直さない（原則6） */
function normalizeName(v) { return s_(v).replace(/[\s　]+/g, ''); }
/* 異体字の吸収（D44）。【取込の照合だけ】に使う。保存する氏名は名簿の表記に揃える（名簿が正本）。
   ★normalizeName そのものは変えない（保存時の氏名照合など、既存の厳密一致を緩めない） */
/* ★旧字体→常用字だけを束ねる。別姓になりうる異体字（嶋/島・嶌/島・舘/館）は入れない。
   ★齊は「斉」の旧字体、齋は「斎」の旧字体。斎藤と斉藤は別姓なので互いに束ねない（レビュー高1） */
var NAME_FOLD = {
  '髙': '高', '﨑': '崎', '嵜': '崎', '惠': '恵', '齋': '斎', '齊': '斉', '邊': '辺', '邉': '辺',
  '廣': '広', '國': '国', '櫻': '桜', '眞': '真', '實': '実', '壽': '寿',
  '德': '徳', '澤': '沢', '濱': '浜', '藏': '蔵', '榮': '栄', '靜': '静', '瀨': '瀬',
  '燈': '灯', '龜': '亀', '鐵': '鉄', '稻': '稲', '穗': '穂', '萬': '万', '與': '与', '來': '来',
  '兒': '児', '曻': '昇', '檜': '桧', '橫': '横', '𠮷': '吉'
};
function foldName(v) {
  var t = normalizeName(v);
  try { t = t.normalize('NFC'); } catch (e) {}
  var out = '', i, ch, code, next;
  /* サロゲートペア（𠮷 など）は上位＋下位がそろっている時だけ1文字として扱う */
  for (i = 0; i < t.length; i++) {
    ch = t.charAt(i);
    code = t.charCodeAt(i);
    next = (i + 1 < t.length) ? t.charCodeAt(i + 1) : 0;
    if (code >= 0xD800 && code <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) { ch = t.substr(i, 2); i++; }
    out += Object.prototype.hasOwnProperty.call(NAME_FOLD, ch) ? NAME_FOLD[ch] : ch;
  }
  return out;
}

/* ── 通知を止める（退去・機能訓練中止・作成不要）2026-10-15 本人指示 ──
   各人の計画データに stop:{reason, from, note, by, at} を持つ。from（指定日）から期限の通知・件数・起動時の知らせを止める。
   ・指定日は過去でも先の日付でもよい（後日あらためて指定・変更・取り消しができる）
   ・指定日の前日までは今までどおり通知し、一覧に「○/○で中止予定」と添える
   ・入居者マスタの退去日とは【早い方】から止める（マスタの退去日は従来どおり「— 終了」）
   ・指定日以降の期は「未作成」に数えず、AI一括作成でも作らない（前日までの期だけ）
   ★未知の理由・壊れた日付は読み込みの時に捨てる（null）＝画面を止めない */
var STOP_REASONS = ['discharge', 'stopped', 'notNeeded'];
var STOP_LABEL = { discharge: '退去', stopped: '機能訓練中止', notNeeded: '作成不要' };
var STOP_SHORT = { discharge: '退去', stopped: '中止', notNeeded: '作成不要' };
var STOP_NOTE_MAX = 100;
function normalizeStop(v) {
  if (!v || typeof v !== 'object') return null;
  var r = s_(v.reason), f = s_(v.from);
  if (STOP_REASONS.indexOf(r) < 0 || !isYmd(f)) return null;
  return { reason: r, from: f, note: s_(v.note).slice(0, STOP_NOTE_MAX), by: s_(v.by).slice(0, 40), at: s_(v.at).slice(0, 40) };
}
/* 期を数える・作る上限日（指定日の前日）。止めていない・壊れている時は '' */
function stopLimitYmd(stop) {
  var st = normalizeStop(stop);
  return st ? addDays(st.from, -1) : '';
}
/* 今日の時点で止まっているか（指定日が今日以前） */
function stopActiveOn(stop, today) {
  var st = normalizeStop(stop);
  return !!(st && isYmd(today) && cmpYmd(st.from, today) <= 0);
}

/* 一覧の行を作る。退去者（退去日が今日以前）はアラートの対象外にし「終了」で残す。
   rows: [{masterId,name,kana,careLevel,dischargeDate,active,isDaycare,
           latestPlanDate,nextDue,status,count,gapCount}] */
function buildAlerts(rows, opts) {
  opts = opts || {};
  var today = isYmd(opts.today) ? opts.today : '';
  var warnDays = Number(opts.warnDays);
  if (!isFinite(warnDays) || warnDays < 0) warnDays = 28;
  var rule = DUE_RULES.indexOf(s_(opts.dueRule)) >= 0 ? s_(opts.dueRule) : 'calendar';
  var scope = (opts.scope === 'all' || opts.scope === 'aidraft') ? opts.scope : 'day';
  var sort = (opts.sort === 'name' || opts.sort === 'state') ? opts.sort : 'due';
  var list = [];
  var src = Object.prototype.toString.call(rows) === '[object Array]' ? rows : [];
  for (var i = 0; i < src.length; i++) {
    var r = src[i] || {};
    var dischEnded = !!(isYmd(r.dischargeDate) && today && cmpYmd(r.dischargeDate, today) <= 0);
    /* 通知を止める指定（2026-10-15）。マスタの退去日と早い方から止める */
    var stop = normalizeStop(r.stop);
    var stopEnded = stopActiveOn(stop, today);
    var ended = dischEnded || stopEnded;
    /* 止めた理由の表示は、指定日がマスタの退去日より早い（または同じ）時だけ。マスタの退去が先なら従来どおり「終了」 */
    var stopShown = stopEnded && !(dischEnded && cmpYmd(r.dischargeDate, stop.from) < 0);
    var inactive = (r.active === false);
    if (scope === 'day' && (ended || inactive || !r.isDaycare)) continue;
    /* AI下書きあり（絞込・D47〜D50拡張）: 状態が draft_ai の期がある人だけ。在籍・退去は問わない */
    if (scope === 'aidraft' && !(Number(r.aiDraftCount) || 0)) continue;
    var due = isYmd(r.nextDue) ? r.nextDue : nextDueOf(r.latestPlanDate, rule);
    var state;
    if (ended || inactive) state = 'ended';
    else if (!isYmd(r.latestPlanDate)) state = 'none';
    else state = dueState(due, today, warnDays);
    list.push({
      masterId: s_(r.masterId), name: s_(r.name), kana: s_(r.kana),
      careLevel: s_(r.careLevel), dischargeDate: s_(r.dischargeDate),
      admissionDate: isYmd(r.admissionDate) ? s_(r.admissionDate) : '',
      isDaycare: !!r.isDaycare, ended: ended || inactive,
      latestPlanId: s_(r.latestPlanId), latestPlanDate: s_(r.latestPlanDate),
      nextDue: due, state: state,
      days: (state === 'none' || !due) ? null : diffDays(due, today),
      status: STATUSES.indexOf(s_(r.status)) >= 0 ? s_(r.status) : 'none',
      count: Number(r.count) || 0, gapCount: Number(r.gapCount) || 0,
      prevMismatch: Number(r.prevMismatch) || 0,
      missingCount: Number(r.missingCount) || 0,
      /* 状態が draft_ai（AI生成のまま＝未確認）の期の数（一括AI作成の目印。D47〜D50拡張） */
      aiDraftCount: Number(r.aiDraftCount) || 0,
      /* 通知を止めた理由（指定日を過ぎた時だけ）と、先の日付で止める予定（前日まで） */
      stopReason: stopShown ? stop.reason : '',
      stopFrom: stop ? stop.from : '',
      stopPlanned: (stop && !stopEnded && !ended && !inactive) ? stop.reason : ''
    });
  }
  list.sort(function (a, b) {
    if (sort === 'name') return cmpKana(a, b);
    var ra = STATE_RANK[a.state], rb = STATE_RANK[b.state];
    if (ra !== rb) return ra - rb;
    if (sort === 'state') return cmpKana(a, b);
    var da = a.nextDue || '9999-12-31', db = b.nextDue || '9999-12-31';
    if (da !== db) return cmpYmd(da, db);
    return cmpKana(a, b);
  });
  return list;
}
function cmpKana(a, b) {
  var ka = a.kana || a.name, kb = b.kana || b.name;
  if (ka === kb) return 0;
  return ka < kb ? -1 : 1;
}
/* 起動時トーストと見出しに出す件数。終了（退去）は数えない */
function alertCounts(list) {
  var c = { overdue: 0, warn: 0, none: 0, ok: 0, ended: 0 };
  var src = Object.prototype.toString.call(list) === '[object Array]' ? list : [];
  for (var i = 0; i < src.length; i++) {
    var st = src[i] && src[i].state;
    if (c[st] !== undefined) c[st]++;
  }
  return c;
}

/* メニューのタイルに出す期限の件数（2026-10-24 代表者の決定 案A）。氏名・利用者Noは入れず、件数と数えた日だけ。
   list は buildAlerts の結果（在籍デイ利用者＝scope 'day' で作ったもの）。today が日付でなければ null（残さない） */
function menuDueSummary(list, today) {
  if (!isYmd(today)) return null;
  var c = alertCounts(list);
  return { v: 1, at: today, overdue: c.overdue, warn: c.warn, none: c.none };
}

/* ── 文単位の差分（LCS）──
   前回と今回で「変わっていない文／消えた文／増えた文」を出す。色だけに頼らず記号も返す。 */
function splitSentences(v) {
  var s = s_(v), out = [], buf = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    buf += ch;
    if (ch === '。' || ch === '！' || ch === '？' || ch === '\n') {
      if (buf.replace(/[\s　]/g, '') !== '') out.push(buf);
      buf = '';
    }
  }
  if (buf.replace(/[\s　]/g, '') !== '') out.push(buf);
  return out;
}
function diffSentences(prev, cur) {
  var a = splitSentences(prev), b = splitSentences(cur);
  var A = a.map(function (t) { return t.replace(/[\s　]+/g, ''); });
  var B = b.map(function (t) { return t.replace(/[\s　]+/g, ''); });
  var ops = [], i, j;
  /* 文が極端に多い時は総当たりを避ける（画面が固まる方が害が大きい） */
  if (a.length * b.length > 40000) {
    for (i = 0; i < a.length; i++) ops.push({ t: 'del', s: a[i] });
    for (j = 0; j < b.length; j++) ops.push({ t: 'add', s: b[j] });
    return { ops: ops, same: 0, adds: b.length, dels: a.length, truncated: true };
  }
  var dp = [];
  for (i = 0; i <= a.length; i++) { dp.push(new Array(b.length + 1)); dp[i][b.length] = 0; }
  for (j = 0; j <= b.length; j++) dp[a.length][j] = 0;
  for (i = a.length - 1; i >= 0; i--) {
    for (j = b.length - 1; j >= 0; j--) {
      dp[i][j] = (A[i] === B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  i = 0; j = 0;
  var same = 0, adds = 0, dels = 0;
  while (i < a.length && j < b.length) {
    if (A[i] === B[j]) { ops.push({ t: 'same', s: a[i] }); same++; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', s: a[i] }); dels++; i++; }
    else { ops.push({ t: 'add', s: b[j] }); adds++; j++; }
  }
  while (i < a.length) { ops.push({ t: 'del', s: a[i] }); dels++; i++; }
  while (j < b.length) { ops.push({ t: 'add', s: b[j] }); adds++; j++; }
  return { ops: ops, same: same, adds: adds, dels: dels, truncated: false };
}

/* ── 自立度の表記ゆれを正す（facesheet.html bfNormRank と同じ考え方）──
   文字列【全体】が変換形と一致する時だけ直す。補足つき（「Ⅲa（H30判定）」）は1文字も触らない。 */
var DEMENTIA_RANKS = ['自立', 'Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M'];
var RANK_ALIAS = { 'I': 'Ⅰ', 'II': 'Ⅱ', 'III': 'Ⅲ', 'IV': 'Ⅳ', 'Ⅰ': 'Ⅰ', 'Ⅱ': 'Ⅱ', 'Ⅲ': 'Ⅲ', 'Ⅳ': 'Ⅳ',
  '1': 'Ⅰ', '2': 'Ⅱ', '3': 'Ⅲ', '4': 'Ⅳ' };   /* 「2a」「２ａ」のような算用数字書きも受ける */
var BEDRIDDEN_RANKS = ['自立', 'J1', 'J2', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
function normDementiaRank(v) {
  var t = s_(v).trim();
  if (t === '' || DEMENTIA_RANKS.indexOf(t) >= 0) return t;
  /* 全角の英数字だけ半角へ寄せる（２ａ→2a・Ｍ→M）。ローマ数字や補足の日本語には触らない */
  var h = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  if (DEMENTIA_RANKS.indexOf(h) >= 0) return h;
  var m = /^([IVⅠⅡⅢⅣ]+|[1-4])\s*([ab]?)$/i.exec(h);
  if (!m) return t;
  var head = RANK_ALIAS[m[1].toUpperCase()] || RANK_ALIAS[m[1]];
  if (!head) return t;
  var cand = head + (m[2] || '').toLowerCase();
  return DEMENTIA_RANKS.indexOf(cand) >= 0 ? cand : t;
}
function normBedriddenRank(v) {
  /* 全角の英数字は半角へ寄せる（Ａ-Ｚ ａ-ｚ ０-９）。それ以外の文字は触らない */
  var t = s_(v).trim().replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  if (t === '' || BEDRIDDEN_RANKS.indexOf(t) >= 0) return t;
  var m = /^([JABCjabc])\s*([12])$/.exec(t);
  if (m) return m[1].toUpperCase() + m[2];
  return t;
}
/* 要介護度は様式の「要介護度」欄の下に数字だけを出す（原本Excelは全角「３」）。
   入居者マスタは「要介護2」の形で返すので、接頭辞を落として全角数字に寄せる。
   要支援・未知の表記はそのまま返す（勝手に書き換えない・原則6） */
function normCareLevel(v) {
  var t = s_(v).trim();
  var m = /^(?:要介護)?\s*([1-5１-５])$/.exec(t);
  if (!m) return t;
  var d = m[1].replace(/[1-5]/, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); });
  return d;
}
function isKnownRank(kind, v) {
  var t = s_(v).trim();
  if (t === '') return true;   /* 空欄は「未知」ではない */
  return (kind === 'dementia' ? DEMENTIA_RANKS : BEDRIDDEN_RANKS).indexOf(t) >= 0;
}

/* ── 計画1件のひな形と正規化 ── */
function emptyProgram() { return { content: '', caution: '', frequency: '', duration: '', staff: '' }; }
function emptyPlan(planDate) {
  return {
    planId: '', seq: 0, planDate: isYmd(planDate) ? planDate : '', prevPlanDate: '', firstPlanDate: '',
    period: { from: '', to: '' }, nextDue: '', visitDate: '', cmReportDate: '',
    explained: { date: '', explainer: '' }, signature: { receivedOn: '', by: '' },
    status: 'none', statusLog: [],
    generation: { requestedAt: '', requestedBy: '', mode: '', rephrase: false, sample: null, doneAt: '' },
    origin: { kind: 'human', source: '', basePlanId: '', promptVersion: '', model: '', at: '' },
    evalOrigin: null,
    audit: { createdAt: '', updatedAt: '', updatedBy: '', retro: false },
    basic: { name: '', kana: '', gender: '', birthDate: '', careLevel: '', dementiaRank: '', bedriddenRank: '' },
    planner: '', plannerJob: '', programPlanner: '',
    hopeSelf: '', hopeFamily: '', socialParticipation: '', homeEnvironment: '',
    health: { diagnosis: '', onsetDate: '', lastHospitalization: '' },
    treatmentCourse: '', diseaseControl: '', precautions: '',
    shortAchievement: '', longAchievement: '',
    shortGoalFunction: '', shortGoalActivity: '', shortGoalParticipation: '',
    longGoalFunction: '', longGoalActivity: '', longGoalParticipation: '',
    programs: [emptyProgram(), emptyProgram(), emptyProgram(), emptyProgram()],
    homeExercise: '', remarks: '', changes: '', issues: '',
    v2: { comorbidities: [], lastDischargeDate: '' }
  };
}
function isObj_(o) { return !!o && typeof o === 'object' && Object.prototype.toString.call(o) !== '[object Array]'; }
function asArr_(a) { return Object.prototype.toString.call(a) === '[object Array]' ? a : []; }
/* 受け取った計画をひな形へはめ直す（未知キーは捨てる・欠けは既定値）。
   ★元の値は書き換えない（純関数）。 */
function normalizePlan(src) {
  var p = emptyPlan(''), s = isObj_(src) ? src : {};
  var strKeys = ['planId', 'planDate', 'prevPlanDate', 'firstPlanDate', 'nextDue', 'visitDate', 'cmReportDate',
    'planner', 'plannerJob', 'programPlanner', 'hopeSelf', 'hopeFamily', 'socialParticipation', 'homeEnvironment',
    'treatmentCourse', 'diseaseControl', 'precautions', 'shortAchievement', 'longAchievement',
    'shortGoalFunction', 'shortGoalActivity', 'shortGoalParticipation',
    'longGoalFunction', 'longGoalActivity', 'longGoalParticipation',
    'homeExercise', 'remarks', 'changes', 'issues'];
  for (var i = 0; i < strKeys.length; i++) p[strKeys[i]] = s_(s[strKeys[i]]);
  p.seq = Number(s.seq) || 0;
  p.status = STATUSES.indexOf(s_(s.status)) >= 0 ? s_(s.status) : 'none';
  if (isObj_(s.period)) { p.period.from = s_(s.period.from); p.period.to = s_(s.period.to); }
  if (isObj_(s.explained)) { p.explained.date = s_(s.explained.date); p.explained.explainer = s_(s.explained.explainer); }
  if (isObj_(s.signature)) { p.signature.receivedOn = s_(s.signature.receivedOn); p.signature.by = s_(s.signature.by); }
  p.statusLog = asArr_(s.statusLog).filter(isObj_).map(function (l) {
    var e = { status: s_(l.status), at: s_(l.at), by: s_(l.by) };
    if (s_(l.note)) e.note = s_(l.note);   /* 印刷済の記録につく「計画書」「報告書」の別（E） */
    return e;
  });
  if (isObj_(s.generation)) {
    p.generation.requestedAt = s_(s.generation.requestedAt);
    p.generation.requestedBy = s_(s.generation.requestedBy);
    p.generation.mode = (s_(s.generation.mode) === 'next' || s_(s.generation.mode) === 'fill_eval') ? s_(s.generation.mode) : '';
    p.generation.rephrase = s.generation.rephrase === true;
    p.generation.sample = isObj_(s.generation.sample) ? {
      achievement: {
        short: s_(isObj_(s.generation.sample.achievement) ? s.generation.sample.achievement.short : ''),
        long: s_(isObj_(s.generation.sample.achievement) ? s.generation.sample.achievement.long : '')
      },
      trend: s_(s.generation.sample.trend),
      tags: asArr_(s.generation.sample.tags).map(s_),
      note: s_(s.generation.sample.note),
      envChange: s_(s.generation.sample.envChange),
      adlNote: s_(s.generation.sample.adlNote)
    } : null;
    p.generation.doneAt = s_(s.generation.doneAt);
  }
  if (isObj_(s.origin)) {
    var kind = s_(s.origin.kind);
    p.origin.kind = (kind === 'ai' || kind === 'import') ? kind : 'human';
    p.origin.source = s_(s.origin.source); p.origin.basePlanId = s_(s.origin.basePlanId);
    p.origin.promptVersion = s_(s.origin.promptVersion); p.origin.model = s_(s.origin.model);
    p.origin.at = s_(s.origin.at);
  }
  /* 前の期（base）へAIが評価を書いた印。人が確かめて欄を編集するまで confirmed は false のまま（原則6） */
  if (isObj_(s.evalOrigin) && s_(s.evalOrigin.kind) === 'ai') {
    p.evalOrigin = { kind: 'ai', at: s_(s.evalOrigin.at), confirmed: s.evalOrigin.confirmed === true };
    /* D34: AIが実際に書いた欄名（EVAL_KEYS のうち既知のものだけ）。無ければ持たない */
    if (Object.prototype.toString.call(s.evalOrigin.fields) === '[object Array]') {
      var evFields = s.evalOrigin.fields.map(s_).filter(function (k) { return EVAL_KEYS.indexOf(k) >= 0; });
      if (evFields.length) p.evalOrigin.fields = evFields;
    }
  }
  if (isObj_(s.audit)) {
    p.audit.createdAt = s_(s.audit.createdAt); p.audit.updatedAt = s_(s.audit.updatedAt);
    p.audit.updatedBy = s_(s.audit.updatedBy); p.audit.retro = s.audit.retro === true;
  }
  if (isObj_(s.basic)) {
    p.basic.name = s_(s.basic.name); p.basic.kana = s_(s.basic.kana); p.basic.gender = s_(s.basic.gender);
    p.basic.birthDate = s_(s.basic.birthDate); p.basic.careLevel = normCareLevel(s.basic.careLevel);
    p.basic.dementiaRank = s_(s.basic.dementiaRank); p.basic.bedriddenRank = s_(s.basic.bedriddenRank);
  }
  if (isObj_(s.health)) {
    p.health.diagnosis = s_(s.health.diagnosis); p.health.onsetDate = s_(s.health.onsetDate);
    p.health.lastHospitalization = s_(s.health.lastHospitalization);
  }
  var pg = asArr_(s.programs);
  for (var k = 0; k < 4; k++) {
    var g = isObj_(pg[k]) ? pg[k] : {};
    p.programs[k] = { content: s_(g.content), caution: s_(g.caution), frequency: s_(g.frequency), duration: s_(g.duration), staff: s_(g.staff) };
  }
  if (isObj_(s.v2)) {
    p.v2.comorbidities = asArr_(s.v2.comorbidities).map(s_);
    p.v2.lastDischargeDate = s_(s.v2.lastDischargeDate);
  }
  return p;
}
/* ── 取り消し置き場（trash）1件のひな形と正規化（D30）──
   plan.planId が空の要素は捨てる。★渡された配列は書き換えない（純関数） */
function normalizeTrash(arr) {
  var src = asArr_(arr), out = [];
  for (var i = 0; i < src.length; i++) {
    var t = isObj_(src[i]) ? src[i] : {};
    /* ★1件も捨てない。捨てるとサーバーが持っている件数より手元が少なくなり、
       以後どの保存も件数減少ガードで断られる（原因が画面から分からない詰み方をする）。
       planId が無い壊れた記録は「取り消した期」に出さないだけにする（renderTrashCard）。 */
    out.push({ at: s_(t.at), by: s_(t.by), plan: normalizePlan(t.plan) });
  }
  return out;
}
/* ── 目標6欄の「言い回しが変わっていない」箇所（D35）──
   ①前の期と同じ文（空白を無視して完全一致）②短期と長期で同じ観点（機能どうし・活動どうし・参加どうし）が同じ文
   戻り: { samePrev:[欄名…], samePair:[長期側の欄名…], fields:[言い直す欄名（重複なし・様式の並び順）] }
   ★渡されたオブジェクトは書き換えない（純関数）。空欄どうしは対象にしない（初回の期・未記入） */
var GOAL_SHORT_KEYS = ['shortGoalFunction', 'shortGoalActivity', 'shortGoalParticipation'];
var GOAL_LONG_KEYS = ['longGoalFunction', 'longGoalActivity', 'longGoalParticipation'];
function goalTextKey_(v) { return s_(v).replace(/[\s\u3000]+/g, ''); }
function goalRepeats(cur, prev) {
  var c = isObj_(cur) ? cur : {}, q = isObj_(prev) ? prev : {};
  var all = GOAL_SHORT_KEYS.concat(GOAL_LONG_KEYS);
  var samePrev = [], samePair = [], want = {}, i, k, a, b;
  for (i = 0; i < all.length; i++) {
    k = all[i];
    a = goalTextKey_(c[k]);
    if (!a) continue;
    if (a === goalTextKey_(q[k])) { samePrev.push(k); want[k] = 1; }
  }
  for (i = 0; i < GOAL_SHORT_KEYS.length; i++) {
    a = goalTextKey_(c[GOAL_SHORT_KEYS[i]]);
    b = goalTextKey_(c[GOAL_LONG_KEYS[i]]);
    /* 短期と長期が同じ文なら、広い到達像を書く長期側を言い直す */
    if (a && a === b) { samePair.push(GOAL_LONG_KEYS[i]); want[GOAL_LONG_KEYS[i]] = 1; }
  }
  var fields = [];
  for (i = 0; i < all.length; i++) if (want[all[i]]) fields.push(all[i]);
  return { samePrev: samePrev, samePair: samePair, fields: fields };
}
/* 転記（import）以外で、作成日が登録日時より7日以上前なら「遡及」の印を立てる */
function isRetro(plan, createdAtIso) {
  if (!plan || plan.origin.kind === 'import') return false;
  if (!isYmd(plan.planDate)) return false;
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(s_(createdAtIso));
  if (!m) return false;
  var d = diffDays(m[1], plan.planDate);
  return d !== null && d > 7;
}

/* ── 取込（JSON）の検証 ──
   roster: [{masterId,name,kana}]（空でもよい）。
   戻り: {ok, errors[], warnings[], doc, needsPick} */
function validateImport(raw, roster) {
  /* errors = 全部の不合格理由（ok の判定に使う）。
     structural = 「形が壊れていて計画を組み立てられない」もの。
     ★氏名の不一致は structural ではない。対象者を選び直せば取り込めるので、
       doc は作って返す（作らないと画面の「選び直す」が働かない）。 */
  var errors = [], warnings = [], structural = [];
  var list = asArr_(roster);
  if (!isObj_(raw)) return { ok: false, errors: ['控えのファイルの形ではありません（計画書の控えのファイルを選んでください）'], warnings: warnings, doc: null, needsPick: false };
  function err(msg) { errors.push(msg); structural.push(msg); }
  if (Number(raw.v) !== 1) err('v が 1 ではありません（この版のアプリでは読めません）');
  var sub = isObj_(raw.subject) ? raw.subject : {};
  var mid = s_(sub.masterId);
  if (!ID_RE.test(mid)) err('subject.masterId が利用者番号の形ではありません');
  var nameNorm = normalizeName(sub.nameNorm);
  if (!nameNorm) err('subject.nameNorm が空です');
  var plans = asArr_(raw.plans);
  if (!plans.length) err('plans が空です');
  if (plans.length > 200) err('plans が多すぎます（200件まで）');
  var seen = {}, out = [];
  for (var i = 0; i < plans.length; i++) {
    var p = normalizePlan(plans[i]);
    var where = 'plans[' + i + ']';
    if (!p.planId) err(where + ': planId がありません');
    else if (seen[p.planId]) err(where + ': planId が重複しています');
    else seen[p.planId] = 1;
    if (!isYmd(p.planDate)) err(where + ': planDate が YYYY-MM-DD ではありません');
    if (!isObj_(plans[i]) || Object.prototype.toString.call(plans[i].programs) !== '[object Array]') {
      warnings.push(where + ': programs が配列ではないため4行の空欄で補いました');
    }
    if (p.prevPlanDate && !isYmd(p.prevPlanDate)) warnings.push(where + ': prevPlanDate の形が日付ではありません');
    out.push(p);
  }
  /* 前回作成日の食い違いは【取込を拒否しない】。原本の値のまま入れ、警告だけ出す（§3-2） */
  var mism = prevDateMismatches(out);
  for (var q = 0; q < mism.length; q++) {
    warnings.push('作成日 ' + mism[q].planDate + ' の計画: prevPlanDate（' + mism[q].prevPlanDate +
      '）が直前の計画の作成日（' + mism[q].expected + '）と一致しません（原本の値のまま取り込みます）');
  }
  var needsPick = false;
  var hit = null;
  for (var k = 0; k < list.length; k++) {
    if (s_(list[k].masterId) === mid) { hit = list[k]; break; }
  }
  if (hit) {
    if (normalizeName(hit.name) !== nameNorm) {
      errors.push('名簿の氏名とファイルの氏名が一致しません（取り違えを防ぐため取り込みません）');
      needsPick = true;
    }
  } else if (list.length) {
    warnings.push('この利用者番号が名簿にありません。対象者を選び直してください');
    needsPick = true;
  } else {
    warnings.push('名簿を読めていないため、氏名の照合ができていません');
  }
  var doc = structural.length ? null : {
    v: 1,
    subject: { masterId: mid, nameNorm: nameNorm, kana: s_(sub.kana) },
    plans: out,
    gaps: asArr_(raw.gaps).filter(isObj_).map(function (g) {
      return { from: s_(g.from), to: s_(g.to), note: s_(g.note) };
    })
  };
  return { ok: !errors.length, errors: errors, warnings: warnings, doc: doc, needsPick: needsPick };
  /* ★ok=false でも doc が返ることがある（氏名の不一致）。呼び出し側は needsPick を見て
       対象者を選び直させる（取り違えたまま黙って書かない）。 */
}

/* ── 未作成の期（欠落期）の洗い出し（M2 §1）──
   起点＝いちばん古い期の作成日。各期の作成日から「次の予定日」（dueRule。既定は暦月3か月の
   応当日）を出し、
     ・次に実在する計画が【予定日＋猶予（既定45日・D18）より後】なら、その間を予定日の刻みで
       「未作成」として埋める（翌月1日運用のような数日のずれで誤検知しないための猶予）
     ・最後の期より後ろは【猶予なし】で、予定日が今日以前のものを「未作成」とする
       （猶予は「少し遅れて作った計画を次の期と誤認しない」ための仕組み。次の計画が無い区間には
         意味がなく、過ぎた予定日を出さないと「作成できていない分」が見えないため）
   戻り: [{kind:'plan'|'missing', date, planId?, seq?}]（作成日の昇順）
   ★渡された配列は書き換えない（純関数）。作成日が日付でない期は数に入れない。 */
function expectedPeriods(plans, today, rule, graceDays) {
  var src = asArr_(plans).filter(function (p) { return p && isYmd(p.planDate); }).slice();
  src.sort(function (a, b) { return cmpYmd(a && a.planDate, b && b.planDate); });
  var out = [];
  if (!src.length) return out;
  var g = Number(graceDays);
  if (!isFinite(g) || g < 0) g = 45;
  var r = DUE_RULES.indexOf(s_(rule)) >= 0 ? s_(rule) : 'calendar';
  var td = isYmd(today) ? s_(today) : '';
  var GUARD = 400;            /* 予定日が進まない・日付が壊れている時に無限に増やさない */
  for (var i = 0; i < src.length; i++) {
    out.push({
      kind: 'plan', date: s_(src[i].planDate),
      planId: s_(src[i].planId), seq: Number(src[i].seq) || (i + 1)
    });
    var from = s_(src[i].planDate);
    var limit = (i + 1 < src.length) ? s_(src[i + 1].planDate) : '';
    var n = 0;
    while (n++ < GUARD) {
      var due = nextDueOf(from, r);
      if (!due || cmpYmd(due, from) <= 0) break;
      if (limit) {
        if (cmpYmd(limit, addDays(due, g)) <= 0) break;   /* 猶予の内に次の計画がある＝欠けていない */
      } else if (!td || cmpYmd(due, td) > 0) {
        break;                    /* 末尾側は猶予なし＝予定日が今日以前なら未作成として出す */
      }
      out.push({ kind: 'missing', date: due });
      from = due;
    }
  }
  return out;
}

/* 各期の「並び順どおりなら入っているはずの前回作成日」を planId → 直前の期の作成日 で返す（M2）。
   期を足す・作成日を動かす【前】に控えておき、動かした後に autoPrevDateFixes へ渡す。
   ★渡された配列は書き換えない（純関数）。作成日が日付でない期・planId が無い期は数に入れない */
function prevNeighborMap(plans) {
  var src = asArr_(plans).filter(function (p) { return p && isYmd(p.planDate) && s_(p.planId); }).slice();
  src.sort(function (a, b) { return cmpYmd(a.planDate, b.planDate); });
  var out = {};
  for (var i = 0; i < src.length; i++) out[s_(src[i].planId)] = (i > 0) ? s_(src[i - 1].planDate) : '';
  return out;
}
/* 期の並びが変わった後、後ろの期の「前回作成日」を追随させる対象を返す（M2）。
   規則: その期の前回作成日が【並びが変わる前の直前の期の作成日】と同じ（＝自動で入った値）で、
   かつ転記（origin.kind==='import'）でない期だけ、【今の直前の期の作成日】へ入れ替える。
   ★人が原本どおりに直した値と、原本から転記した期は動かさない（原則6）
   ★wasPrev に無い期（いま作った期）は触らない
   戻り: [{planId, from, to}]（実際に書き換えるのは呼び出し側） */
function autoPrevDateFixes(plans, wasPrev) {
  var src = asArr_(plans).filter(function (p) { return p && isYmd(p.planDate) && s_(p.planId); }).slice();
  src.sort(function (a, b) { return cmpYmd(a.planDate, b.planDate); });
  var map = (wasPrev && typeof wasPrev === 'object') ? wasPrev : {};
  var out = [], i, q, id, was, now;
  for (i = 0; i < src.length; i++) {
    q = src[i];
    id = s_(q.planId);
    if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
    if (q.origin && s_(q.origin.kind) === 'import') continue;
    was = s_(map[id]);
    if (s_(q.prevPlanDate) !== was) continue;
    now = (i > 0) ? s_(src[i - 1].planDate) : '';
    if (now === was) continue;
    out.push({ planId: id, from: was, to: now });
  }
  return out;
}

/* 前回作成日（prevPlanDate）が直前の期の作成日と食い違う期を拾う（§3-2）。
   ★原本（Excel）に実例があるため、値は【直さない】で数だけ返す（原則6）。
   作成日で並べ直した写しで見る＝渡された配列は触らない（純関数）。
   戻り: [{seq, planDate, prevPlanDate, expected}] */
function prevDateMismatches(plans) {
  var src = asArr_(plans).slice();
  src.sort(function (a, b) { return cmpYmd(a && a.planDate, b && b.planDate); });
  var out = [];
  for (var i = 1; i < src.length; i++) {
    var cur = src[i] || {}, prev = src[i - 1] || {};
    var pv = s_(cur.prevPlanDate);
    if (!pv) continue;                       /* 空欄は「書いていない」＝不一致にしない */
    var expect = s_(prev.planDate);
    if (!expect || pv === expect) continue;
    out.push({ seq: Number(cur.seq) || (i + 1), planDate: s_(cur.planDate), prevPlanDate: pv, expected: expect });
  }
  return out;
}

/* 既存 plans へ取り込む。planId が重複する計画は【上書きせず飛ばす】（原本を壊さない） */
function mergeImport(existingPlans, incomingPlans) {
  var have = {}, out = [], skipped = [], added = 0;
  var ex = asArr_(existingPlans), inc = asArr_(incomingPlans), i;
  for (i = 0; i < ex.length; i++) { out.push(ex[i]); if (ex[i] && ex[i].planId) have[ex[i].planId] = 1; }
  for (i = 0; i < inc.length; i++) {
    var p = inc[i];
    if (!p || !p.planId) continue;
    if (have[p.planId]) { skipped.push(p.planId); continue; }
    have[p.planId] = 1; out.push(p); added++;
  }
  out.sort(function (a, b) { return cmpYmd(a && a.planDate, b && b.planDate); });
  for (i = 0; i < out.length; i++) out[i].seq = i + 1;
  return { plans: out, added: added, skipped: skipped };
}

/* ── 印刷用の写し（計画書／報告書）の空欄化・既定（M4 D21・D22）──
   kind='plan' は達成度・Ⅲを空にする（○が付かず、Ⅲが空欄で印刷される）。
   kind='report' は達成度が空なら「一部」を既定にする。保存データは触らない（呼び出し側が写しに適用する）。 */
function applyPrintKind(o, kind) {
  var src = isObj_(o) ? o : {};
  var out = {
    shortAchievement: s_(src.shortAchievement), longAchievement: s_(src.longAchievement),
    changes: s_(src.changes), issues: s_(src.issues)
  };
  if (kind === 'plan') {
    out.shortAchievement = ''; out.longAchievement = ''; out.changes = ''; out.issues = '';
  } else if (kind === 'report') {
    if (!out.shortAchievement) out.shortAchievement = '一部';
    if (!out.longAchievement) out.longAchievement = '一部';
  }
  return out;
}

/* ── 報告書に刷る「説明日」（D61〜D63・2026-09-15 本人裁定で D57'・D58' を差し替え）──
   報告書は次の期の計画書と同じ日に刷り、その場でご家族へ一緒に説明する運用のため、
   様式右下の【説明日】をその日に合わせる。
   ・次の期の計画書があれば、その作成日（＝実際に説明する日）
   ・まだ無ければ、この期の作成日の PLAN_MONTHS か月後（見込み）
   ★上段（作成日・前回作成日・初回作成日）は差し替えない。2026-09-09 の版は作成日を
     次の期へずらしていたが、「報告書の作成日は計画書の作成日と同じ日」が本人裁定。
   ★説明者は変えない（説明日のみ）。★保存データは触らない（写しにだけ適用する）。
   from: 'next'＝次の期の作成日／'estimate'＝作成日からの見込み／'none'＝作成日が空で出せない */
function reportExplainedDate(cur, next) {
  var c = isObj_(cur) ? cur : {};
  var n = isObj_(next) ? next : null;
  var nextDate = n ? s_(n.planDate) : '';
  if (isYmd(nextDate)) return { date: nextDate, from: 'next' };
  var curDate = s_(c.planDate);
  if (!isYmd(curDate)) return { date: '', from: 'none' };
  return { date: addMonthsClamp(curDate, PLAN_MONTHS), from: 'estimate' };
}

/* ── AIの出力の形の判定（aiShapeNotes v2・item C）。文言の組立は呼び出し側が行う ── */
var ACH_VALUES = ['達成', '一部', '未達', ''];
function achievementValid(v) { return ACH_VALUES.indexOf(s_(v)) >= 0; }
var CHANGE_PREFIXES = ['（機能）', '（活動）', '（参加）'];
/* Ⅲ（実施による変化・課題）に接頭辞（機能／活動／参加のいずれか）が紛れ込んでいないか（v5・item E）。
   v4は「3つそろっているか」の検査だったが、v5はⅢを接頭辞なしの連続した文章で書く仕様に変わったため、
   逆に「接頭辞が入っていたら注意」に反転する。空文字は注意の対象外（false） */
function changesHasPrefixes(v) {
  var t = s_(v);
  if (!t) return false;
  for (var i = 0; i < CHANGE_PREFIXES.length; i++) if (t.indexOf(CHANGE_PREFIXES[i]) >= 0) return true;
  return false;
}
/* 目標欄が指定の接頭辞で始まっているか。空文字は判定対象外（true） */
function goalHasPrefix(v, prefix) {
  var t = s_(v);
  return !t || t.indexOf(s_(prefix)) === 0;
}

/* ── 外部AIへ送る前の氏名の伏せ字（2026-09-23） ──
   AIへ送る入力（前の期の計画・本人の様子）は氏名・生年月日・病名の欄を含まない設計（D5）だが、自由記入の欄
   （希望・メモ・ADLの様子・備考など）に人の名前が書かれることがある。送る直前に名簿の氏名・かなを記号へ置き換え、
   返事の記号は【送る時に置き換えた書き方】へ戻す（無ければ名簿の表記）。
   ・ご本人: フルネーム→〔ご本人〕／姓→〔ご本人・姓〕／名→〔ご本人・名〕／かな→〔ご本人・かな〕／
             かなの姓・名→〔ご本人・姓かな〕〔ご本人・名かな〕（どれも2文字以上）
   ・他の利用者: フルネーム→〔利用者N〕／かな→〔利用者N・かな〕。姓だけは伏せない（一般の語を壊さないため）
   ・異体字（髙→高 など foldName の表）と、かなのカタカナ書きも同じ記号にする
   ・姓・名だけの置き換えは、直後が 市 町 村 郡 県 区 の時はしない（菊池市・山鹿市のような地名を壊さない）
   ・1文字の語は伏せない。長い語から先に置き換える（短い語が長い名前の一部を先に食わない）
   ★置き換えられるのは名簿の氏名・かなだけ。愛称・家族や職員の名前・ローマ字は置き換えられない（確認画面で伝える） */
var AI_MASK_PART_STOP = '市町村郡県区';
function aiToKatakana(v) {
  return s_(v).replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
}
function aiMaskTerms(roster, subjectId, subjectExtra) {
  var list = Object.prototype.toString.call(roster) === '[object Array]' ? roster : [];
  var out = [], seen = {}, n = 0;
  var WS = /[\s　]+/;
  function trim(v) { return s_(v).replace(/^[\s　]+|[\s　]+$/g, ''); }
  function add(term, token, orig, part) {
    term = s_(term);
    if (term.length < 2 || seen[term]) return;
    seen[term] = 1;
    out.push({ term: term, token: token, orig: s_(orig), part: !!part });
  }
  function joins(parts) { return [parts.join(''), parts.join(' '), parts.join('　')]; }
  function addRow(row, tok, isSubject) {
    var nm = trim(row.name), kn = trim(row.kana);
    var parts = nm ? nm.split(WS) : [], fparts = parts.map(foldName);
    var kparts = kn ? kn.split(WS) : [], kkparts = kparts.map(aiToKatakana);
    [parts, fparts].forEach(function (P) { if (P.length) joins(P).forEach(function (v) { add(v, tok, nm); }); });
    if (nm) add(nm, tok, nm);
    [kparts, kkparts].forEach(function (P) { if (P.length) joins(P).forEach(function (v) { add(v, tok.replace('〕', '・かな〕'), kn); }); });
    if (!isSubject) return;
    if (parts.length >= 2) {
      [parts[0], fparts[0]].forEach(function (v) { add(v, '〔ご本人・姓〕', parts[0], true); });
      [parts.slice(1).join(''), fparts.slice(1).join('')].forEach(function (v) { add(v, '〔ご本人・名〕', parts.slice(1).join(''), true); });
    }
    if (kparts.length >= 2) {
      [kparts[0], kkparts[0]].forEach(function (v) { add(v, '〔ご本人・姓かな〕', kparts[0], true); });
      [kparts.slice(1).join(''), kkparts.slice(1).join('')].forEach(function (v) { add(v, '〔ご本人・名かな〕', kparts.slice(1).join(''), true); });
    }
  }
  var rows = list.filter(function (r) { return r && typeof r === 'object'; });
  var subj = null, i;
  for (i = 0; i < rows.length; i++) if (subjectId && s_(rows[i].masterId) === s_(subjectId)) { subj = rows[i]; break; }
  /* 名簿に無いご本人（退去後・名簿を読めない端末）も、計画書が持つ氏名・かなで伏せる */
  var extra = subjectExtra && typeof subjectExtra === 'object' ? subjectExtra : null;
  if (subj) addRow(subj, '〔ご本人〕', true);
  if (extra && (trim(extra.name) || trim(extra.kana))) addRow(extra, '〔ご本人〕', true);
  rows.forEach(function (r) {
    if (r === subj) return;
    if (!trim(r.name) && !trim(r.kana)) return;
    n++;
    addRow(r, '〔利用者' + n + '〕', false);
  });
  out.sort(function (a, b) { return b.term.length - a.term.length; });
  return out;
}
function aiHasSubject(terms) {
  return (Object.prototype.toString.call(terms) === '[object Array]' ? terms : []).some(function (x) { return x.token === '〔ご本人〕'; });
}
function aiMapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Object.prototype.toString.call(v) === '[object Array]') return v.map(function (x) { return aiMapStrings(x, fn); });
  if (v && typeof v === 'object') {
    var o = {}, k;
    for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = aiMapStrings(v[k], fn);
    return o;
  }
  return v;
}
function aiReEsc(t) { return s_(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* ── 敬称の前の名前の伏せ字（2026-10-08・監査10月版 #12）──
   名簿に無い名前（ご家族・職員・他事業所の人・愛称）も、敬称（さん・さま・様・氏・殿・くん・君・ちゃん・先生・サン 等）の
   直前の名前を〔人名1〕〔人名2〕…に置き換える（同じ書き方は同じ記号）。返事では元の書き方へ戻す。
   ★考え方は「迷ったら伏せる」。伏せすぎた分は返事で元に戻るので害が無く、漏れた名前は取り返せないため。
   ・名前の形: 漢字（異体字・互換漢字を含む）・カタカナ（半角を含む）の後ろにひらがなの名が続いてよい形と、ひらがなだけ（2〜10字）の形。
     姓と名の間の区切り（空白・改行なし空白・中黒・＝ 等）1つも含める（「架山 太郎さん」「かやま・たろうさん」）
   ・前に付いた助詞などのひらがな（「と架山さん」の「と」）は、後ろに漢字・カタカナがある時だけ外す
   ・続柄・職種・一般の語（AI_HONOR_STOP）は、その語そのものなら伏せない（娘さん・看護師さん・皆様・おばあさん など）。
     名前の後ろに2字以上の語が付いている時は、名前の部分だけを伏せる（「架山看護師さん」「架山 看護師さん」→「〔人名1〕看護師さん」）。
     名前の部分が1字のひらがな（助詞）だけになる時は伏せない（「…とおじいさん」）
   ・様子・様式・様々・氏名 は敬称と見なさない（様・氏の時だけ。「〇〇さん相談」「〇〇さん名義」は伏せる）
   ・敬称の前の空白（「架山 太郎 様」）・呼びかけの伸ばし（さーん）・せんせい・夫人・女史・嬢・旧字の樣も見る
   ・番号は、送る文に既に残っている〔人名N〕（崩れた形も含む）より大きい番号から振る（前回戻し損ねた記号と混ざらない）
   ★機械的な目安なので取りこぼしはある（敬称の付かない名前・名前と敬称の間に読み仮名や記号が入る書き方・英字など）。
     確認画面で伝え、自由記入に名前を書かないよう促す */
var AI_HONOR_K = '[一-龥㐀-䶵豈-﫿々〆ヵヶァ-ヴーｦ-ﾟ]';   // 漢字・カタカナ
var AI_HONOR_H = '(?:(?!さん|さま|くん|ちゃん)[ぁ-ゖ])';   // ひらがな（前の名前の敬称は含めない）
var AI_HONOR_K0 = '(?![様氏殿君])' + AI_HONOR_K;           // 姓の側の漢字（前の名前の敬称は含めない）
var AI_HONOR_SEP = '[\\s\u00a0・･·＝=－\\-/／_]';           // 姓と名の区切り（空白・タブ・改行・改行なし空白・中黒・＝・ハイフン・／・＿）
/* 名前の形（どれか）: ①ひらがなの後ろに漢字・カタカナ（よし子・はる美・架山よし子・はなこ看護師・架山はなこ看護師）
   ②漢字・カタカナの後ろにひらがなの名が続いてよい ③ひらがなだけ（2〜10字）。前に姓・前の名＋区切り（2つまで・区切りは3字まで）が付いてよい。名前と敬称の間の空白（2字まで）も許す */
var AI_HONOR_RE = new RegExp(
  '((?:(?:' + AI_HONOR_K0 + '|' + AI_HONOR_H + '){1,10}' + AI_HONOR_SEP + '{1,3}){0,2}(?:' + AI_HONOR_K + '{0,10}' + AI_HONOR_H + '{1,10}' + AI_HONOR_K + '{1,10}|' + AI_HONOR_K + '{1,10}' + AI_HONOR_H + '{0,8}|' + AI_HONOR_H + '{2,10}))' +
  '([ 　\u00a0]{0,2})' +
  '(さー*ん|くー*ん|ちゃー*ん|さま|君|殿|先生|せんせい|センセイ|夫人|女史|嬢|サン|サマ|クン|チャン|ｻﾝ|ｻﾏ|ｸﾝ|ﾁｬﾝ|[様樣](?![子式々相態])|氏(?!名))', 'g');
/* 1字の続柄（区切りの後ろ・ひらがなの後ろにある時は「〇〇の娘さん」「架山 奥さん」の続柄として扱う） */
var AI_HONOR_KIN1 = '娘嫁孫奥兄姉弟妹父母婿';
var AI_HONOR_STOP = ['皆', '奥', '娘', '息子', '嫁', '婿', '孫', '兄', '姉', '弟', '妹', '父', '母', '子', '祖父', '祖母', '叔父', '叔母', '伯父', '伯母',
  '長男', '長女', '次男', '次女', '三男', '三女', '本人', 'ご本人', '爺', '婆', '旦那', '主人', 'ご主人', '家族', 'ご家族', '親戚', '子供', '友人', '近所', '隣', '同室', '他', '客', 'お客', '神', '仏', '殿',
  '先生', '看護師', '看護婦', '保健師', '看護', '職員', '患者', '利用者', 'ご利用者', '入居者', '担当', '医師', '主治医', '歯科医', '薬剤師', '介護士', '相談員', '栄養士',
  '理学療法士', '作業療法士', '言語聴覚士', '管理者', '事務', '社長', '店員', '運転手', '大工', '大家', '御', '各位', '先輩', '後輩', 'お医者', 'お疲れ', 'ご苦労', '医者', '疲れ', '苦労', 'ご馳走', '馳走', '世話', 'お世話',
  '同', '異', '仕', '多', '模', '有', '左', '右', '各', '諸', '彼', '某',
  'ヘルパー', 'ケアマネ', 'ケアマネジャー', 'ケアマネージャー', 'マネージャー', 'ドクター', 'スタッフ', 'ナース', 'セラピスト', 'ボランティア', 'パパ', 'ママ', 'オーナー', 'リハ',
  'おばあ', 'おじい', 'おばあちゃ', 'おじいちゃ', 'おば', 'おじ', 'おねえ', 'おにい', 'みな', 'みなさ', 'おくさ', 'おかあ', 'おとう', 'あかちゃ', 'おこ', 'こども', 'おきゃく', 'おいしゃ', 'かんごし',
  'ばあ', 'じい', 'ねえ', 'にい', 'かあ', 'とう', 'お子', 'お嬢', '嬢', '赤', 'ワン', '猫', '犬', 'お孫', 'お姉', 'お兄', 'お母', 'お父', 'お爺', 'お婆'];
/* ひらがなの短い語（とう・おこ・ばあ 等）は、その語そのものの時だけ伏せない。名前の末尾から外すのは3字以上のひらがなの語と、
   漢字・カタカナを含む2字以上の語だけ（「さとう」「なおこ」を「さ」「な」＋続柄と読まない） */
function aiHonorStripOk(w) { return w.length >= 3 || (w.length >= 2 && /[^ぁ-ゖ]/.test(w)); }
var AI_HONOR_SEP_RE = new RegExp(AI_HONOR_SEP + '+', 'g');
function aiHonorIsStop(w) { for (var i = 0; i < AI_HONOR_STOP.length; i++) if (w === AI_HONOR_STOP[i]) return true; return false; }
/* 名前の部分を返す（伏せないなら ''）。 */
function aiHonorName(cap) {
  var c = s_(cap).replace(new RegExp(AI_HONOR_SEP + '+$'), '');
  /* 前に付いた助詞などのひらがなは、後ろに漢字・カタカナがある時だけ外す（「と架山」→「架山」） */
  /* 外すのは、区切りを挟まずに漢字・カタカナ2字以上が続く時だけ（「よし子」「たろう・架山」の名前のひらがなは外さない） */
  var lead = c.match(/^[ぁ-ゖ]+/);
  if (lead && lead[0].length < c.length) {
    var tail = c.slice(lead[0].length);
    if (!new RegExp('^' + AI_HONOR_SEP).test(tail) && /^[^ぁ-ゖ]{2,}$/.test(tail)) {
      /* 残りが職種・続柄（「はなこ看護師」の「看護師」）なら、外した側のひらがなが名前（2字以上の時） */
      if (aiHonorIsStop(tail)) return lead[0].length >= 2 && !aiHonorIsStop(lead[0]) ? lead[0] : '';
      c = tail;
    }
  }
  /* 漢字の間に助詞1字（は・が・を・に・で・と・も・へ・や）だけが挟まり、後ろが漢字・カタカナ2字以上なら、後ろだけが名前
     （「今回は架山」→「架山」）。ひらがな＋漢字1字の名前（よし子・はる美）はこの形にならない */
  var pm = c.match(/^(.*[^ぁ-ゖ\s])([はがをにでともへや])([^ぁ-ゖ\s]{2,})$/);
  if (pm) c = pm[3];
  var bare = c.replace(AI_HONOR_SEP_RE, '');
  if (!bare || aiHonorIsStop(bare)) return '';
  /* 末尾の「の」は助詞のことがある（「医師の先生」）。外した残りが続柄・職種なら伏せない。そうでなければ「の」ごと名前（「あやの」） */
  if (/の$/.test(bare) && aiHonorIsStop(bare.slice(0, -1))) return '';
  /* 区切りの後ろが1字の語: 続柄（奥・娘 など）なら区切りの前が名前（「架山 奥さん」→「架山」）。一般語（「様子・氏名・同様」の「同」）なら名前ではない */
  var segs = c.split(AI_HONOR_SEP_RE);
  if (segs.length > 1) {
    var last = segs[segs.length - 1];
    if (last.length === 1 && AI_HONOR_KIN1.indexOf(last) >= 0) {
      var hd = c.slice(0, c.length - 1).replace(new RegExp(AI_HONOR_SEP + '+$'), '');
      return (hd && !aiHonorIsStop(hd.replace(AI_HONOR_SEP_RE, ''))) ? hd : '';
    }
    if (last.length === 1 && aiHonorIsStop(last)) return '';
  }
  /* ひらがなの後ろの1字の続柄（「来た娘」「〇〇の娘」）は続柄。名前ではない */
  if (bare.length >= 2 && AI_HONOR_KIN1.indexOf(bare.slice(-1)) >= 0 && /[ぁ-ゖ]/.test(bare.slice(-2, -1))) return '';
  /* 末尾の続柄・職種（2字以上）を外す。区切りの後ろの語が丸ごとそうなら、区切りの前を名前にする */
  var best = c;
  for (var j = 0; j < AI_HONOR_STOP.length; j++) {
    var w = AI_HONOR_STOP[j];
    if (!aiHonorStripOk(w) || c.length <= w.length || c.slice(c.length - w.length) !== w) continue;
    var head = c.slice(0, c.length - w.length).replace(new RegExp(AI_HONOR_SEP + '+$'), '');
    if (head.length < best.length) best = head;
  }
  if (best !== c) {
    var hb = best.replace(AI_HONOR_SEP_RE, '');
    if (!hb || aiHonorIsStop(hb) || /^[ぁ-ゖ]$/.test(hb)) return '';
  }
  return best;
}
function aiMaskHonor(str, u) {
  return str.replace(AI_HONOR_RE, function (all, cap, gap, honor) {
    var name = aiHonorName(cap);
    if (!name) return all;
    var at = cap.lastIndexOf(name);
    var pre = cap.slice(0, at), rest = cap.slice(at + name.length);   // 前の助詞・後ろの職種などはそのまま残す
    var tok = null, k, n = (typeof u.__honorBase === 'number') ? u.__honorBase : 0;
    for (k in u) if (Object.prototype.hasOwnProperty.call(u, k) && k.indexOf('〔人名') === 0) { n++; if (u[k] === name) tok = k; }
    if (!tok) { tok = '〔人名' + (n + 1) + '〕'; u[tok] = name; }
    return pre + tok + rest + gap + honor;
  });
}
/* 記号〔人名N〕の崩れた形（［］・[]・【】・全角数字・先頭の0）も同じ番号として読む */
var AI_HONOR_TOKEN_RE = /[〔［\[【]人名([0-9０-９]+)[〕］\]】]/g;
function aiHonorNum(d) {
  return String(parseInt(s_(d).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }), 10));
}
/* 送る文に既に残っている〔人名N〕の最大の番号（前回戻し損ねた記号。新しい番号はこれより大きくする） */
function aiHonorBase(obj) {
  var max = 0;
  aiMapStrings(obj, function (str) {
    str.replace(AI_HONOR_TOKEN_RE, function (a, d) { var v = parseInt(aiHonorNum(d), 10); if (v > max) max = v; return a; });
    return str;
  });
  return max;
}
/* used（任意）に「記号 → 送る時に実際に置き換えた書き方」を控える（戻す時に職員の書き方へ戻すため） */
function aiMaskDeep(obj, terms, used) {
  var ts = Object.prototype.toString.call(terms) === '[object Array]' ? terms : [];
  var u = (used && typeof used === 'object') ? used : {};
  /* 敬称の前の名前の番号の起点（控えに隠して持つ＝戻す時の対応表には入らない） */
  if (typeof u.__honorBase !== 'number') Object.defineProperty(u, '__honorBase', { value: aiHonorBase(obj), writable: true, enumerable: false });
  return aiMapStrings(obj, function (str) {
    for (var i = 0; i < ts.length; i++) {
      var x = ts[i];
      if (str.indexOf(x.term) < 0) continue;
      var hit = false;
      if (x.part) {
        str = str.replace(new RegExp(aiReEsc(x.term) + '(?![' + AI_MASK_PART_STOP + '])', 'g'), function () { hit = true; return x.token; });
      } else {
        str = str.split(x.term).join(x.token); hit = true;
      }
      if (hit && !Object.prototype.hasOwnProperty.call(u, x.token)) u[x.token] = x.term;
    }
    return aiMaskHonor(str, u);   // 名簿で伏せた後に、敬称の前の名前を伏せる（名簿の記号〔…〕は漢字・カタカナではないので二重に伏せない）
  });
}
function aiUnmaskDeep(obj, terms, used) {
  var ts = Object.prototype.toString.call(terms) === '[object Array]' ? terms : [];
  var u = (used && typeof used === 'object') ? used : {};
  var map = {}, toks = [];
  ts.forEach(function (x) {
    if (Object.prototype.hasOwnProperty.call(map, x.token)) return;
    map[x.token] = Object.prototype.hasOwnProperty.call(u, x.token) ? u[x.token] : x.orig;
    toks.push(x.token);
  });
  /* 敬称の前で伏せた名前（〔人名N〕）も戻す */
  var honor = {};
  for (var hk in u) if (Object.prototype.hasOwnProperty.call(u, hk) && hk.indexOf('〔人名') === 0 && !Object.prototype.hasOwnProperty.call(map, hk)) { map[hk] = u[hk]; toks.push(hk); honor[hk.replace(/\D/g, '')] = u[hk]; }
  toks.sort(function (a, b) { return b.length - a.length; });
  return aiMapStrings(obj, function (str) {
    for (var i = 0; i < toks.length; i++) if (str.indexOf(toks[i]) >= 0) str = str.split(toks[i]).join(map[toks[i]]);
    /* AI が記号の形を少し崩して返した〔人名N〕（［人名1］・〔人名１〕・[人名1]）も、送った番号なら戻す */
    str = str.replace(AI_HONOR_TOKEN_RE, function (a, d) {
      var k = aiHonorNum(d);
      return Object.prototype.hasOwnProperty.call(honor, k) ? honor[k] : a;
    });
    return str;
  });
}

global.TP = {
  ID_RE: ID_RE, YMD_RE: YMD_RE, STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL,
  DUE_RULES: DUE_RULES, STATE_RANK: STATE_RANK, PLAN_MONTHS: PLAN_MONTHS, PLAN_DAYS: PLAN_DAYS,
  DEMENTIA_RANKS: DEMENTIA_RANKS, BEDRIDDEN_RANKS: BEDRIDDEN_RANKS,
  isYmd: isYmd, toYmd: toYmd, parseYmd: parseYmd, daysInMonth: daysInMonth, addMonthsClamp: addMonthsClamp,
  addDays: addDays, diffDays: diffDays, cmpYmd: cmpYmd,
  nextDueOf: nextDueOf, dueState: dueState, buildAlerts: buildAlerts, alertCounts: alertCounts, menuDueSummary: menuDueSummary,
  normalizeName: normalizeName, foldName: foldName, splitSentences: splitSentences, diffSentences: diffSentences,
  normDementiaRank: normDementiaRank, normCareLevel: normCareLevel, normBedriddenRank: normBedriddenRank, isKnownRank: isKnownRank,
  emptyPlan: emptyPlan, emptyProgram: emptyProgram, normalizePlan: normalizePlan, normalizeTrash: normalizeTrash, isRetro: isRetro,
  prevDateMismatches: prevDateMismatches, expectedPeriods: expectedPeriods, goalRepeats: goalRepeats,
  prevNeighborMap: prevNeighborMap, autoPrevDateFixes: autoPrevDateFixes,
  validateImport: validateImport, mergeImport: mergeImport,
  applyPrintKind: applyPrintKind, reportExplainedDate: reportExplainedDate,
  achievementValid: achievementValid, changesHasPrefixes: changesHasPrefixes, goalHasPrefix: goalHasPrefix,
  aiMaskTerms: aiMaskTerms, aiMaskDeep: aiMaskDeep, aiUnmaskDeep: aiUnmaskDeep, aiHasSubject: aiHasSubject, aiToKatakana: aiToKatakana,
  aiMaskHonor: aiMaskHonor,
  STOP_REASONS: STOP_REASONS, STOP_LABEL: STOP_LABEL, STOP_SHORT: STOP_SHORT, STOP_NOTE_MAX: STOP_NOTE_MAX,
  normalizeStop: normalizeStop, stopLimitYmd: stopLimitYmd, stopActiveOn: stopActiveOn
};
})(typeof window !== 'undefined' ? window : this);
