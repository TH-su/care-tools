// iCalendar(.ics)の解析 — Googleカレンダーの「限定公開URL」やその他の購読URLを読むための最小実装。
// 対応: VEVENT / 終日・時刻指定 / TZID / UTC / RRULE(FREQ,INTERVAL,COUNT,UNTIL,BYDAY,BYMONTHDAY,BYMONTH)
//       EXDATE / RDATE / RECURRENCE-ID による個別変更
import { zonedToUtc, localTimeZone } from './datetime.js';

const MAX_OCCURRENCES = 2000; // 暴走防止

// ── 行の復元（折り返しの解除）とプロパティ分解 ───────────────
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeValue(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// "DTSTART;TZID=Asia/Tokyo:20260820T140000" → {name, params, value}
function parseLine(line) {
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const segs = [];
  let cur = '';
  inQuote = false;
  for (const c of head) {
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === ';' && !inQuote) { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  const name = segs[0].toUpperCase();
  const params = {};
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  return { name, params, value };
}

// VCALENDARを入れ子のコンポーネントへ
function parseComponents(text) {
  const root = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const raw of unfold(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const node = { name: p.value.toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].props.push(p);
    }
  }
  return root;
}

function collect(node, name) {
  return node.props.filter(p => p.name === name);
}
function first(node, name) {
  return node.props.find(p => p.name === name) || null;
}
function textOf(node, name) {
  const p = first(node, name);
  return p ? unescapeValue(p.value) : '';
}

// ── 日時の解釈 ────────────────────────────────────────────────
// 戻り値: { parts:{year,month,day,hour,minute,second}, allDay, tz }
function parseDateValue(prop, defaultTz) {
  const v = prop.value.trim();
  const isDateOnly = prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const parts = {
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour: Number(m[4] || 0), minute: Number(m[5] || 0), second: Number(m[6] || 0),
  };
  const tz = m[7] === 'Z' ? 'UTC' : (prop.params.TZID || defaultTz);
  return { parts, allDay: isDateOnly, tz };
}

// TZIDにはWindows表記など不明な値も来るため、変換できなければ既定TZへ落とす
function safeZonedToUtc(parts, tz, fallbackTz) {
  try {
    return zonedToUtc(parts, tz);
  } catch {
    return zonedToUtc(parts, fallbackTz);
  }
}

// ── RRULE ─────────────────────────────────────────────────────
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseRRule(value) {
  const rule = {};
  for (const kv of value.split(';')) {
    const [k, v] = kv.split('=');
    if (!k || v === undefined) continue;
    rule[k.toUpperCase()] = v;
  }
  return {
    freq: (rule.FREQ || '').toUpperCase(),
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: rule.COUNT ? Number(rule.COUNT) : null,
    until: rule.UNTIL || null,
    byDay: rule.BYDAY ? rule.BYDAY.split(',').map(s => s.trim().toUpperCase()) : null,
    byMonthDay: rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null,
    byMonth: rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null,
  };
}

const dayOfWeek = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shiftDay = (y, m, d, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};

// BYDAY「3MO」「-1FR」からその月の該当日を求める
function nthWeekdayOfMonth(year, month, token) {
  const m = token.match(/^([+-]?\d+)?([A-Z]{2})$/);
  if (!m) return [];
  const wd = WEEKDAYS.indexOf(m[2]);
  if (wd < 0) return [];
  const days = [];
  const last = daysInMonth(year, month);
  for (let d = 1; d <= last; d++) if (dayOfWeek(year, month, d) === wd) days.push(d);
  if (!m[1]) return days;
  const n = Number(m[1]);
  const picked = n > 0 ? days[n - 1] : days[days.length + n];
  return picked ? [picked] : [];
}

// 繰り返しの「日付」だけを列挙する（時刻はDTSTARTのものを引き継ぐ）
function* recurDates(rule, start, windowEndKey) {
  const { freq, interval } = rule;
  const emitted = new Set();
  let cursor = { y: start.year, m: start.month, d: start.day };
  let guard = 0;

  const inByMonth = (m) => !rule.byMonth || rule.byMonth.includes(m);

  while (guard++ < MAX_OCCURRENCES * 4) {
    let candidates = [];
    if (freq === 'DAILY') {
      candidates = [[cursor.y, cursor.m, cursor.d]];
    } else if (freq === 'WEEKLY') {
      const base = dayOfWeek(cursor.y, cursor.m, cursor.d);
      const targets = rule.byDay ? rule.byDay.map(t => WEEKDAYS.indexOf(t.replace(/^[+-]?\d+/, ''))).filter(i => i >= 0)
        : [dayOfWeek(start.year, start.month, start.day)];
      for (const wd of targets.sort((a, b) => a - b)) {
        candidates.push(shiftDay(cursor.y, cursor.m, cursor.d, wd - base));
      }
    } else if (freq === 'MONTHLY') {
      if (rule.byDay) {
        for (const token of rule.byDay) {
          for (const d of nthWeekdayOfMonth(cursor.y, cursor.m, token)) candidates.push([cursor.y, cursor.m, d]);
        }
      } else if (rule.byMonthDay) {
        for (const md of rule.byMonthDay) {
          const last = daysInMonth(cursor.y, cursor.m);
          const d = md > 0 ? md : last + md + 1;
          if (d >= 1 && d <= last) candidates.push([cursor.y, cursor.m, d]);
        }
      } else if (start.day <= daysInMonth(cursor.y, cursor.m)) {
        candidates.push([cursor.y, cursor.m, start.day]);
      }
    } else if (freq === 'YEARLY') {
      const months = rule.byMonth || [start.month];
      for (const mo of months) {
        if (rule.byDay) {
          for (const token of rule.byDay) {
            for (const d of nthWeekdayOfMonth(cursor.y, mo, token)) candidates.push([cursor.y, mo, d]);
          }
        } else if (start.day <= daysInMonth(cursor.y, mo)) {
          candidates.push([cursor.y, mo, start.day]);
        }
      }
    } else {
      return; // 未対応のFREQ（SECONDLY等）は1件だけ扱う
    }

    candidates.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
    for (const [y, m, d] of candidates) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (emitted.has(key)) continue;
      if (key < `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`) continue;
      if (!inByMonth(m)) continue;
      emitted.add(key);
      yield { year: y, month: m, day: d, key };
    }

    // 次の周期へ
    if (freq === 'DAILY') [cursor.y, cursor.m, cursor.d] = shiftDay(cursor.y, cursor.m, cursor.d, interval);
    else if (freq === 'WEEKLY') [cursor.y, cursor.m, cursor.d] = shiftDay(cursor.y, cursor.m, cursor.d, 7 * interval);
    else if (freq === 'MONTHLY') {
      const total = (cursor.y * 12) + (cursor.m - 1) + interval;
      cursor = { y: Math.floor(total / 12), m: (total % 12) + 1, d: 1 };
    } else if (freq === 'YEARLY') cursor = { y: cursor.y + interval, m: 1, d: 1 };

    const cursorKey = `${cursor.y}-${String(cursor.m).padStart(2, '0')}-01`;
    if (cursorKey > windowEndKey) return;
  }
}

// ── VEVENT → 正規化イベント ──────────────────────────────────
function eventShell(node, defaultTz) {
  const dtStartProp = first(node, 'DTSTART');
  if (!dtStartProp) return null;
  const s = parseDateValue(dtStartProp, defaultTz);
  if (!s) return null;

  const dtEndProp = first(node, 'DTEND');
  let durationMs = null;
  let e = dtEndProp ? parseDateValue(dtEndProp, defaultTz) : null;
  if (!e) {
    const dur = first(node, 'DURATION');
    if (dur) durationMs = parseDuration(dur.value);
  }

  return {
    uid: textOf(node, 'UID') || null,
    title: textOf(node, 'SUMMARY'),
    description: textOf(node, 'DESCRIPTION'),
    location: textOf(node, 'LOCATION'),
    status: (textOf(node, 'STATUS') || '').toUpperCase(),
    start: s,
    end: e,
    durationMs,
    allDay: s.allDay,
  };
}

function parseDuration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const ms = ((Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 86400
    + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000;
  return sign * ms;
}

/**
 * ICSテキストから、指定期間に重なるイベントを取り出す。
 * @param {string} text .icsの中身
 * @param {{from: Date, to: Date, timeZone?: string, calendarId?: string}} opts
 */
export function parseIcs(text, { from, to, timeZone } = {}) {
  const defaultTz = timeZone || localTimeZone();
  const root = parseComponents(text);
  const cal = root.children.find(c => c.name === 'VCALENDAR') || root;
  const calName = textOf(cal, 'X-WR-CALNAME') || textOf(cal, 'NAME') || '';
  const calTz = textOf(cal, 'X-WR-TIMEZONE') || defaultTz;

  const vevents = cal.children.filter(c => c.name === 'VEVENT');
  // RECURRENCE-ID を持つものは「繰り返しの一部を変更した予定」
  const overrides = new Map(); // `${uid}|${recurrenceKey}` → node
  const masters = [];
  for (const node of vevents) {
    const rid = first(node, 'RECURRENCE-ID');
    if (rid) {
      const uid = textOf(node, 'UID');
      const parsed = parseDateValue(rid, calTz);
      const k = parsed ? `${parsed.parts.year}-${String(parsed.parts.month).padStart(2, '0')}-${String(parsed.parts.day).padStart(2, '0')}` : '';
      overrides.set(`${uid}|${k}`, node);
    } else {
      masters.push(node);
    }
  }

  const out = [];
  const windowEndKey = `${to.getUTCFullYear() + 1}-01-01`;

  const push = (shell, dateParts, seq) => {
    const startParts = { ...dateParts, hour: shell.start.parts.hour, minute: shell.start.parts.minute, second: shell.start.parts.second };
    const startUtc = shell.allDay
      ? safeZonedToUtc({ ...dateParts, hour: 0, minute: 0, second: 0 }, calTz, defaultTz)
      : safeZonedToUtc(startParts, shell.start.tz, defaultTz);

    let endUtc;
    if (shell.end) {
      const baseStart = safeZonedToUtc(shell.start.parts, shell.start.tz, defaultTz);
      const baseEnd = safeZonedToUtc(shell.end.parts, shell.end.tz, defaultTz);
      endUtc = new Date(startUtc.getTime() + (baseEnd.getTime() - baseStart.getTime()));
    } else if (shell.durationMs != null) {
      endUtc = new Date(startUtc.getTime() + shell.durationMs);
    } else {
      endUtc = new Date(startUtc.getTime() + (shell.allDay ? 86400000 : 3600000));
    }
    if (endUtc <= from || startUtc >= to) return;
    out.push({
      id: `${shell.uid || 'ics'}${seq ? `_${seq}` : ''}`,
      uid: shell.uid,
      title: shell.title,
      description: shell.description,
      location: shell.location,
      start: startUtc.toISOString(),
      end: endUtc.toISOString(),
      allDay: shell.allDay,
      cancelled: shell.status === 'CANCELLED',
    });
  };

  for (const node of masters) {
    const shell = eventShell(node, calTz);
    if (!shell) continue;

    const rrule = first(node, 'RRULE');
    if (!rrule) {
      push(shell, shell.start.parts, null);
      continue;
    }

    const rule = parseRRule(rrule.value);
    const exDates = new Set();
    for (const p of collect(node, 'EXDATE')) {
      for (const v of p.value.split(',')) {
        const parsed = parseDateValue({ ...p, value: v }, calTz);
        if (parsed) exDates.add(`${parsed.parts.year}-${String(parsed.parts.month).padStart(2, '0')}-${String(parsed.parts.day).padStart(2, '0')}`);
      }
    }
    const untilUtc = rule.until
      ? (() => {
        const parsed = parseDateValue({ params: {}, value: rule.until }, calTz);
        return parsed ? safeZonedToUtc(parsed.parts, parsed.tz, defaultTz) : null;
      })()
      : null;

    let n = 0;
    for (const d of recurDates(rule, shell.start.parts, windowEndKey)) {
      if (rule.count != null && n >= rule.count) break;
      n += 1;
      const occStart = safeZonedToUtc({ ...d, hour: shell.start.parts.hour, minute: shell.start.parts.minute, second: shell.start.parts.second }, shell.start.tz, defaultTz);
      if (untilUtc && occStart > untilUtc) break;
      if (occStart >= to) break;
      if (exDates.has(d.key)) continue;

      const ov = overrides.get(`${shell.uid}|${d.key}`);
      if (ov) {
        const ovShell = eventShell(ov, calTz);
        if (ovShell) push(ovShell, ovShell.start.parts, d.key);
        continue;
      }
      push(shell, d, d.key);
      if (out.length > MAX_OCCURRENCES) break;
    }
  }

  return { name: calName, timeZone: calTz, events: out.filter(e => !e.cancelled) };
}
