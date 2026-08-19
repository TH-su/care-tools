// カレンダー表示用のユーティリティ（すべてブラウザのローカル時刻で扱う）

export const DAY_MS = 86400000;
export const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'];

export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const addMonths = (d, n) => {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
};

export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const isSameDay = (a, b) => dayKey(a) === dayKey(b);
export const isToday = (d) => isSameDay(d, new Date());

export function startOfWeek(d, weekStart = 0) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
}

// 月表示の6週ぶん（42日）
export function monthGrid(anchor, weekStart = 0) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const fmtTime = (d) => new Date(d).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });

export const fmtDayLabel = (d) => {
  const x = new Date(d);
  return `${x.getMonth() + 1}月${x.getDate()}日(${WEEKDAY_JP[x.getDay()]})`;
};

export function relativeDayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  if (diff === 0) return '今日';
  if (diff === 1) return '明日';
  if (diff === -1) return '昨日';
  return fmtDayLabel(d);
}

export const fmtMonthTitle = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

// <input type="date"> / <input type="time"> と ISO文字列の相互変換
export const toDateInput = (iso) => dayKey(new Date(iso));
export const toTimeInput = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export function fromInputs(dateStr, timeStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).toISOString();
}

// 予定がその日に掛かっているか（終日は終了時刻ちょうどを含めない）
export function eventOnDay(ev, day) {
  const s = new Date(ev.start).getTime();
  const e = new Date(ev.end || ev.start).getTime();
  const ds = startOfDay(day).getTime();
  const de = ds + DAY_MS;
  return s < de && Math.max(e, s + 1) > ds;
}

export function groupByDay(events, days) {
  return days.map(day => ({ day, events: events.filter(ev => eventOnDay(ev, day)) }));
}

export function eventTimeLabel(ev) {
  if (ev.allDay) return '終日';
  const s = new Date(ev.start);
  const e = new Date(ev.end || ev.start);
  if (!ev.end || e <= s) return fmtTime(s);
  if (isSameDay(s, e)) return `${fmtTime(s)}–${fmtTime(e)}`;
  return `${fmtTime(s)} → ${fmtDayLabel(e)} ${fmtTime(e)}`;
}

// 終日予定・長い予定を先に、次に開始時刻順
export function sortEvents(list) {
  return [...list].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start.localeCompare(b.start) || String(a.title).localeCompare(String(b.title));
  });
}

// 期限の見え方（過ぎている / 今日 / 明日 / 日付）
export function dueLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  if (diff < 0) return { text: diff === -1 ? '昨日まで' : `${fmtDayLabel(d)}まで`, tone: 'overdue' };
  if (diff === 0) return { text: '今日まで', tone: 'today' };
  if (diff === 1) return { text: '明日まで', tone: 'soon' };
  return { text: `${fmtDayLabel(d)}まで`, tone: 'later' };
}

// 予定を1時間単位の位置に置くための比率（週表示用）
export function dayPosition(ev, day) {
  const ds = startOfDay(day).getTime();
  const s = Math.max(new Date(ev.start).getTime(), ds);
  const e = Math.min(new Date(ev.end || ev.start).getTime(), ds + DAY_MS);
  const top = (s - ds) / DAY_MS;
  const height = Math.max((e - s) / DAY_MS, 0.02);
  return { top, height };
}

// 同じ時間帯に重なる予定を横に並べるための列割り当て
export function layoutColumns(events) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const active = [];
  const out = [];
  for (const ev of sorted) {
    const s = new Date(ev.start).getTime();
    for (let i = active.length - 1; i >= 0; i--) {
      if (new Date(active[i].ev.end || active[i].ev.start).getTime() <= s) active.splice(i, 1);
    }
    const used = new Set(active.map(a => a.col));
    let col = 0;
    while (used.has(col)) col += 1;
    const entry = { ev, col };
    active.push(entry);
    const total = Math.max(...active.map(a => a.col), col) + 1;
    for (const a of active) a.total = Math.max(a.total || 1, total);
    out.push(entry);
  }
  return out.map(e => ({ ev: e.ev, col: e.col, total: e.total || 1 }));
}
