// 日時ユーティリティ — カレンダーは「同じ壁掛け時計の時刻」を扱うため、
// IANAタイムゾーン付きのローカル日時 ⇔ UTC の相互変換をここに集約する。

// このMacのタイムゾーン（Asia/Tokyo など）。取得できない環境ではUTC。
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const FMT_CACHE = new Map();
function formatter(tz) {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    FMT_CACHE.set(tz, f);
  }
  return f;
}

// 指定タイムゾーンでの「壁掛け時計の時刻」を数値で取り出す
export function wallClock(date, tz) {
  const parts = formatter(tz).formatToParts(date);
  const g = (t) => Number(parts.find(p => p.type === t)?.value || 0);
  return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour'), minute: g('minute'), second: g('second') };
}

// そのUTC時刻における、タイムゾーンのUTCからのずれ（ミリ秒）
function offsetMs(date, tz) {
  const w = wallClock(date, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - date.getTime();
}

// 「2026-08-20 14:00 (Asia/Tokyo)」→ 実際のUTC時刻
// 夏時間の切り替わりを跨いでも合うよう、ずれを2回当てて収束させる。
export function zonedToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = naive - offsetMs(new Date(naive), tz);
  ts = naive - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

// UTC時刻 → 指定タイムゾーンでの日付キー（YYYY-MM-DD）
export function dateKey(date, tz) {
  const w = wallClock(date, tz);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

// YYYY-MM-DD → その日のタイムゾーン内での0時のUTC時刻
export function startOfDay(key, tz) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUtc({ year: y, month: m, day: d }, tz);
}

export function addDaysToKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// Googleカレンダーが返す日付／日時（date か dateTime）→ ISO文字列
export function googleTimeToIso(t, fallbackTz) {
  if (!t) return null;
  if (t.dateTime) return new Date(t.dateTime).toISOString();
  if (t.date) return startOfDay(t.date, t.timeZone || fallbackTz || localTimeZone()).toISOString();
  return null;
}

// ISO文字列 → Googleカレンダーのstart/end表現
export function isoToGoogleTime(iso, { allDay, timeZone }) {
  const tz = timeZone || localTimeZone();
  if (allDay) return { date: dateKey(new Date(iso), tz) };
  return { dateTime: new Date(iso).toISOString(), timeZone: tz };
}
