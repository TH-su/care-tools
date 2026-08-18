// メール本文から日時らしい表現を拾い、予定の下書きを作る。
// 例: 「8月20日(水) 14:00〜15:00」「明日 15時から」「2026/9/1 終日」
// 誤検出で予定が勝手に入ることはない（あくまで作成画面の初期値を埋めるだけ）。
import { zonedToUtc, wallClock, localTimeZone } from './datetime.js';

// 全角英数字・記号を半角へ寄せる（「１４：００」対策）
function normalize(s) {
  return String(s || '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/[−–—ｰ]/g, '-')
    .replace(/[～]/g, '〜')
    .replace(/ /g, ' ');
}

const WEEKDAY_JP = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
const RANGE_SEP = '(?:\\s*(?:〜|~|-|から|より|to)\\s*)';

// ── 時刻 ─────────────────────────────────────────────────────
// 「14:00」「14時」「14時30分」「14時半」「午後2時」を {hour, minute} に
function parseClock(text) {
  const t = text.trim();
  let m = t.match(/^(午前|午後|AM|PM|am|pm)?\s*(\d{1,2})\s*(?::|時)\s*(\d{1,2})?\s*(?:分)?\s*(半)?/);
  if (!m) {
    m = t.match(/^(午前|午後|AM|PM|am|pm)?\s*(\d{1,2})\s*時\s*(半)?/);
    if (!m) return null;
    m = [m[0], m[1], m[2], undefined, m[3]];
  }
  let hour = Number(m[2]);
  let minute = m[3] !== undefined && m[3] !== '' ? Number(m[3]) : (m[4] ? 30 : 0);
  const mer = (m[1] || '').toLowerCase();
  if ((mer === '午後' || mer === 'pm') && hour < 12) hour += 12;
  if ((mer === '午前' || mer === 'am') && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, length: m[0].length };
}

const CLOCK_SRC = '(?:午前|午後|AM|PM|am|pm)?\\s*\\d{1,2}\\s*(?::\\s*\\d{1,2}|時(?:\\s*\\d{1,2}\\s*分?|\\s*半)?)';

// 「から1時間半」「30分ほど」→ ミリ秒。読めなければ既定の1時間。
function durationMs(rest) {
  const m = String(rest).match(/^[\s　]*(?:から|より|、|,)?[\s　]*(?:およそ|約)?[\s　]*(?:(\d{1,2})[\s　]*時間[\s　]*(?:(\d{1,2})[\s　]*分|(半))?|(\d{1,3})[\s　]*分)(?:間)?/);
  if (!m) return 3600000;
  if (m[4]) return Math.min(Number(m[4]), 600) * 60000;
  const hours = Number(m[1] || 0);
  const mins = m[3] ? 30 : Number(m[2] || 0);
  const ms = (hours * 60 + mins) * 60000;
  return ms > 0 ? Math.min(ms, 12 * 3600000) : 3600000;
}

// ── 日付 ─────────────────────────────────────────────────────
// 年の指定がない場合、基準日より1か月以上前になるなら翌年とみなす
function inferYear(baseParts, month, day) {
  const candidate = new Date(Date.UTC(baseParts.year, month - 1, day));
  const base = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day));
  if (candidate.getTime() < base.getTime() - 31 * 86400000) return baseParts.year + 1;
  return baseParts.year;
}

function addDays(parts, n) {
  const t = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function weekdayOf(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

// テキスト中の日付表現をすべて拾う → [{index, length, date:{year,month,day}, kind}]
function findDates(text, baseParts) {
  const hits = [];
  const push = (index, length, date, kind) => {
    if (!date || date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return;
    hits.push({ index, length, date, kind });
  };

  // 令和8年9月10日（木） — 行政文書でよく使う和暦
  const ERA_BASE = { 令和: 2018, 平成: 1988, 昭和: 1925 };
  for (const m of text.matchAll(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*[日月火水木金土]\s*[）)])?/g)) {
    const n = m[2] === '元' ? 1 : Number(m[2]);
    push(m.index, m[0].length, { year: ERA_BASE[m[1]] + n, month: Number(m[3]), day: Number(m[4]) }, 'absolute');
  }
  // 2026年8月20日 / 8月20日 （曜日カッコは長さに含める）
  for (const m of text.matchAll(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*[日月火水木金土]\s*[）)])?/g)) {
    const year = m[1] ? Number(m[1]) : inferYear(baseParts, Number(m[2]), Number(m[3]));
    push(m.index, m[0].length, { year, month: Number(m[2]), day: Number(m[3]) }, m[1] ? 'absolute' : 'monthday');
  }
  // 2026/8/20 / 2026-08-20 / 8/20
  for (const m of text.matchAll(/(?:(\d{4})\s*[/.-]\s*)?(\d{1,2})\s*[/.-]\s*(\d{1,2})(?![/.\d-])(?:\s*[（(]\s*[日月火水木金土]\s*[）)])?/g)) {
    const a = Number(m[2]);
    const b = Number(m[3]);
    if (!m[1] && (a > 12 || b > 31)) continue;
    const year = m[1] ? Number(m[1]) : inferYear(baseParts, a, b);
    push(m.index, m[0].length, { year, month: a, day: b }, m[1] ? 'absolute' : 'monthday');
  }
  // 本日 / 今日 / 明日 / 明後日 / 翌日
  const RELATIVE = { 本日: 0, 今日: 0, 明日: 1, あす: 1, 翌日: 1, 明後日: 2, あさって: 2 };
  for (const [word, offset] of Object.entries(RELATIVE)) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(word, from);
      if (i < 0) break;
      push(i, word.length, addDays(baseParts, offset), 'relative');
      from = i + word.length;
    }
  }
  // 今週金曜 / 来週の月曜日 / 次の火曜 / 今度の日曜日
  for (const m of text.matchAll(/(今週|来週|再来週|次|今度)\s*の?\s*([日月火水木金土])曜(?:日)?/g)) {
    const target = WEEKDAY_JP[m[2]];
    // 「次の」「今度の」はいちばん近い該当曜日、「来週」は1週間先
    const weekOffset = m[1] === '来週' ? 1 : (m[1] === '再来週' ? 2 : 0);
    const cur = weekdayOf(baseParts);
    let delta = target - cur + weekOffset * 7;
    if (delta <= 0 && weekOffset === 0) delta += 7;
    push(m.index, m[0].length, addDays(baseParts, delta), 'relative');
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * 本文・件名から予定の候補を作る。
 * @param {{subject?:string, text?:string, baseDate?:string, timeZone?:string, limit?:number}} input
 * @returns {Array<{start,end,allDay,title,matched,confidence}>}
 */
export function extractSchedule({ subject = '', text = '', baseDate, timeZone, limit = 4 } = {}) {
  const tz = timeZone || localTimeZone();
  const base = baseDate ? new Date(baseDate) : new Date();
  const baseParts = wallClock(Number.isNaN(base.getTime()) ? new Date() : base, tz);
  // 件名を先に見る（件名の日付のほうが本題であることが多い）
  const haystack = normalize(`${subject}\n${(text || '').slice(0, 4000)}`);

  const dates = findDates(haystack, baseParts);
  const out = [];
  const seen = new Set();

  const add = (cand) => {
    const key = `${cand.start}|${cand.end}|${cand.allDay}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cand);
  };

  for (const hit of dates) {
    const tail = haystack.slice(hit.index + hit.length, hit.index + hit.length + 40);
    const head = haystack.slice(Math.max(0, hit.index - 12), hit.index);

    // 「14:00〜15:00」
    // 後半に (?!\s*間) を付けて「15時から1時間」の“1時”を終了時刻と誤読しないようにする
    const rangeRe = new RegExp(`^[\\s　]*(?:の|は|に|より)?[\\s　]*(${CLOCK_SRC})${RANGE_SEP}(${CLOCK_SRC})(?![\\s　]*間)`);
    const oneRe = new RegExp(`^[\\s　]*(?:の|は|に|から|より)?[\\s　]*(${CLOCK_SRC})`);

    const range = tail.match(rangeRe);
    const one = range ? null : tail.match(oneRe);
    // 「14:00からの打合せは8月20日」のように時刻が前にある書き方も拾う
    const before = !range && !one ? head.match(new RegExp(`(${CLOCK_SRC})[\\s　]*(?:に|から)?[\\s　]*$`)) : null;

    const dayStart = (h, mi) => zonedToUtc({ ...hit.date, hour: h, minute: mi }, tz).toISOString();
    const relBonus = hit.kind === 'relative' ? -0.05 : 0;

    if (range) {
      const s = parseClock(range[1]);
      const e = parseClock(range[2]);
      if (s && e) {
        let endIso = dayStart(e.hour, e.minute);
        if (endIso <= dayStart(s.hour, s.minute)) {
          endIso = zonedToUtc({ ...addDays(hit.date, 1), hour: e.hour, minute: e.minute }, tz).toISOString();
        }
        add({
          start: dayStart(s.hour, s.minute), end: endIso, allDay: false,
          matched: `${haystack.slice(hit.index, hit.index + hit.length)} ${range[0].trim()}`.trim(),
          confidence: 0.95 + relBonus,
        });
        continue;
      }
    }
    const single = one || before;
    if (single) {
      const s = parseClock(single[1]);
      if (s) {
        const startIso = dayStart(s.hour, s.minute);
        const rest = one ? tail.slice(one[0].length) : '';
        add({
          start: startIso,
          end: new Date(new Date(startIso).getTime() + durationMs(rest)).toISOString(),
          allDay: false,
          matched: `${haystack.slice(hit.index, hit.index + hit.length)} ${single[1].trim()}`.trim(),
          confidence: 0.85 + relBonus,
        });
        continue;
      }
    }
    // 日付だけ → 終日
    add({
      start: dayStart(0, 0),
      end: zonedToUtc({ ...addDays(hit.date, 1), hour: 0, minute: 0 }, tz).toISOString(),
      allDay: true,
      matched: haystack.slice(hit.index, hit.index + hit.length),
      confidence: 0.55 + relBonus,
    });
  }

  const title = (subject || '').replace(/^\s*(?:re|fwd?)\s*:\s*/i, '').trim();
  return out
    .sort((a, b) => b.confidence - a.confidence || a.start.localeCompare(b.start))
    .slice(0, limit)
    .map(c => ({ ...c, title }));
}
