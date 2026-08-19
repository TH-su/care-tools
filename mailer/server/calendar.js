// カレンダー統合層 — Google / 購読URL(ICS) / このMac内 を同じ形に揃えて返す。
// メール一覧と同じく「1つが落ちても他は出す」方針で、失敗は errors に集める。
import {
  listCalendarSources, getCalendarSource, saveCalendarSource, getCalendarSecrets,
  listLocalEvents, saveLocalEvent, deleteLocalEvent, publicCalendarSource,
} from './store.js';
import { googleFetch } from './google.js';
import { parseIcs } from './ics.js';
import { googleTimeToIso, isoToGoogleTime, localTimeZone } from './datetime.js';

const ICS_CACHE_MS = 5 * 60 * 1000;
const icsCache = new Map(); // url → {text, at}

export const LOCAL_SOURCE_ID = 'local';

export function ensureLocalSource() {
  const existing = getCalendarSource(LOCAL_SOURCE_ID);
  if (existing) return existing;
  return saveCalendarSource({
    id: LOCAL_SOURCE_ID, type: 'local', name: 'このMacの予定', color: '#30D158', enabled: true,
  });
}

export function sourcesForClient() {
  ensureLocalSource();
  return listCalendarSources().map(publicCalendarSource);
}

// ── Google ───────────────────────────────────────────────────
export async function fetchGoogleCalendarList(source) {
  const creds = await getCalendarSecrets(source);
  const data = await googleFetch(source, creds, 'calendar', '/users/me/calendarList', {
    query: { maxResults: 250, minAccessRole: 'reader' },
  });
  return (data.items || []).map(c => ({
    id: c.id,
    summary: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor || null,
    primary: Boolean(c.primary),
    accessRole: c.accessRole || 'reader',
    timeZone: c.timeZone || null,
  }));
}

// 接続直後・再取得時に、選択状態を保ったままカレンダー一覧を更新する
export async function syncGoogleCalendars(source) {
  const list = await fetchGoogleCalendarList(source);
  const prev = new Map((source.calendars || []).map(c => [c.id, c]));
  const calendars = list.map(c => ({
    ...c,
    selected: prev.has(c.id) ? prev.get(c.id).selected !== false : (c.primary || list.length <= 3),
  }));
  const primary = calendars.find(c => c.primary) || calendars[0];
  return saveCalendarSource({
    ...source,
    calendars,
    defaultCalendarId: source.defaultCalendarId && calendars.some(c => c.id === source.defaultCalendarId)
      ? source.defaultCalendarId
      : primary?.id || null,
  });
}

const writableGoogle = (cal) => cal?.accessRole === 'owner' || cal?.accessRole === 'writer';

function normalizeGoogleEvent(source, cal, e) {
  const start = googleTimeToIso(e.start);
  const end = googleTimeToIso(e.end);
  if (!start) return null;
  return {
    id: `${source.id}::${cal.id}::${e.id}`,
    sourceId: source.id,
    sourceType: 'google',
    sourceName: source.name,
    calendarId: cal.id,
    calendarName: cal.summary,
    eventId: e.id,
    color: cal.color || source.color,
    title: e.summary || '（タイトルなし）',
    description: e.description || '',
    location: e.location || '',
    start,
    end: end || new Date(new Date(start).getTime() + 3600000).toISOString(),
    allDay: Boolean(e.start?.date),
    attendees: (e.attendees || []).map(a => ({ email: a.email, name: a.displayName || '', status: a.responseStatus || 'needsAction' })),
    organizer: e.organizer?.email || '',
    link: e.htmlLink || '',
    editable: writableGoogle(cal),
    recurring: Boolean(e.recurringEventId),
  };
}

async function googleEvents(source, from, to) {
  const creds = await getCalendarSecrets(source);
  const cals = (source.calendars || []).filter(c => c.selected !== false);
  const results = await Promise.all(cals.map(async (cal) => {
    const data = await googleFetch(source, creds, 'calendar', `/calendars/${encodeURIComponent(cal.id)}/events`, {
      query: {
        timeMin: from.toISOString(), timeMax: to.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: 250,
        showDeleted: 'false',
      },
    });
    return (data.items || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => normalizeGoogleEvent(source, cal, e))
      .filter(Boolean);
  }));
  return results.flat();
}

// ── 購読URL（ICS） ────────────────────────────────────────────
async function icsText(url) {
  const cached = icsCache.get(url);
  if (cached && Date.now() - cached.at < ICS_CACHE_MS) return cached.text;
  const res = await fetch(url, { headers: { Accept: 'text/calendar, text/plain' }, redirect: 'follow' });
  if (!res.ok) {
    const err = new Error(`カレンダーを取得できません（HTTP ${res.status}）。URLをご確認ください。`);
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('カレンダー形式（iCal）ではないURLです。「限定公開URL（iCal形式）」をご確認ください。');
  }
  icsCache.set(url, { text, at: Date.now() });
  return text;
}

export function clearIcsCache(url) {
  if (url) icsCache.delete(url);
  else icsCache.clear();
}

async function icsEvents(source, from, to) {
  const text = await icsText(source.url);
  const { events } = parseIcs(text, { from, to, timeZone: localTimeZone() });
  return events.map(e => ({
    id: `${source.id}::ics::${e.id}`,
    sourceId: source.id,
    sourceType: 'ics',
    sourceName: source.name,
    calendarId: 'ics',
    calendarName: source.name,
    eventId: e.id,
    color: source.color,
    title: e.title || '（タイトルなし）',
    description: e.description || '',
    location: e.location || '',
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    attendees: [],
    organizer: '',
    link: '',
    editable: false,   // 購読URLは読み取り専用
    recurring: false,
  }));
}

// ── このMac内 ────────────────────────────────────────────────
function localEvents(source, from, to) {
  return listLocalEvents()
    .filter(e => new Date(e.end || e.start) > from && new Date(e.start) < to)
    .map(e => ({
      id: `${source.id}::local::${e.id}`,
      sourceId: source.id,
      sourceType: 'local',
      sourceName: source.name,
      calendarId: 'local',
      calendarName: source.name,
      eventId: e.id,
      color: source.color,
      title: e.title || '（タイトルなし）',
      description: e.description || '',
      location: e.location || '',
      start: e.start,
      end: e.end,
      allDay: Boolean(e.allDay),
      attendees: e.attendees || [],
      organizer: '',
      link: '',
      editable: true,
      recurring: false,
      sourceMail: e.sourceMail || null,
    }));
}

// ── 一覧 ─────────────────────────────────────────────────────
export async function listEvents({ from, to }) {
  ensureLocalSource();
  const sources = listCalendarSources().filter(s => s.enabled !== false);
  const errors = [];
  const groups = await Promise.all(sources.map(async (source) => {
    try {
      if (source.type === 'google') return await googleEvents(source, from, to);
      if (source.type === 'ics') return await icsEvents(source, from, to);
      return localEvents(source, from, to);
    } catch (err) {
      errors.push({ sourceId: source.id, name: source.name, error: err.message, authFailed: Boolean(err.authFailed) });
      return [];
    }
  }));
  const events = groups.flat().sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { events, errors };
}

// ── 作成・更新・削除 ──────────────────────────────────────────
function requireSource(sourceId) {
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('カレンダーが見つかりません'); e.status = 404; throw e; }
  return source;
}

function googleBody(input, timeZone) {
  const body = {
    summary: input.title || '',
    description: input.description || '',
    location: input.location || '',
    start: isoToGoogleTime(input.start, { allDay: input.allDay, timeZone }),
    end: isoToGoogleTime(input.end, { allDay: input.allDay, timeZone }),
  };
  if (input.allDay) {
    // 終日はGoogleの仕様上 end が「翌日」になる
    const endKey = isoToGoogleTime(new Date(new Date(input.end).getTime() + 1).toISOString(), { allDay: true, timeZone });
    body.end = endKey;
  }
  if (input.attendees?.length) {
    body.attendees = input.attendees.map(a => (typeof a === 'string' ? { email: a } : { email: a.email, displayName: a.name || undefined }));
  }
  return body;
}

export async function createEvent({ sourceId, calendarId, event }) {
  const source = requireSource(sourceId);
  if (source.type === 'ics') { const e = new Error('購読しているカレンダーには追加できません'); e.status = 400; throw e; }
  if (source.type === 'local') {
    const saved = saveLocalEvent({ ...event, sourceId: source.id });
    return localEvents(source, new Date(0), new Date(8640000000000000)).find(e => e.eventId === saved.id);
  }
  const creds = await getCalendarSecrets(source);
  const cal = (source.calendars || []).find(c => c.id === calendarId) || (source.calendars || []).find(c => c.id === source.defaultCalendarId);
  if (!cal) { const e = new Error('登録先のカレンダーが選ばれていません'); e.status = 400; throw e; }
  const tz = cal.timeZone || localTimeZone();
  const created = await googleFetch(source, creds, 'calendar', `/calendars/${encodeURIComponent(cal.id)}/events`, {
    method: 'POST', body: googleBody(event, tz),
    query: event.attendees?.length ? { sendUpdates: 'all' } : undefined,
  });
  return normalizeGoogleEvent(source, cal, created);
}

export async function updateEvent({ sourceId, calendarId, eventId, event }) {
  const source = requireSource(sourceId);
  if (source.type === 'ics') { const e = new Error('購読しているカレンダーは編集できません'); e.status = 400; throw e; }
  if (source.type === 'local') {
    const saved = saveLocalEvent({ ...event, id: eventId, sourceId: source.id });
    return localEvents(source, new Date(0), new Date(8640000000000000)).find(e => e.eventId === saved.id);
  }
  const creds = await getCalendarSecrets(source);
  const cal = (source.calendars || []).find(c => c.id === calendarId);
  if (!cal) { const e = new Error('カレンダーが見つかりません'); e.status = 404; throw e; }
  const tz = cal.timeZone || localTimeZone();
  const updated = await googleFetch(source, creds, 'calendar', `/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH', body: googleBody(event, tz),
  });
  return normalizeGoogleEvent(source, cal, updated);
}

export async function removeEvent({ sourceId, calendarId, eventId }) {
  const source = requireSource(sourceId);
  if (source.type === 'ics') { const e = new Error('購読しているカレンダーは編集できません'); e.status = 400; throw e; }
  if (source.type === 'local') { deleteLocalEvent(eventId); return { ok: true }; }
  const creds = await getCalendarSecrets(source);
  await googleFetch(source, creds, 'calendar', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  return { ok: true };
}

// 予定の登録先の候補（書き込めるものだけ）
export function writableTargets() {
  ensureLocalSource();
  const out = [];
  for (const s of listCalendarSources()) {
    if (s.enabled === false) continue;
    if (s.type === 'local') out.push({ sourceId: s.id, calendarId: 'local', label: s.name, color: s.color });
    else if (s.type === 'google') {
      for (const c of s.calendars || []) {
        if (!writableGoogle(c)) continue;
        out.push({ sourceId: s.id, calendarId: c.id, label: `${c.summary}（${s.email || s.name}）`, color: c.color || s.color });
      }
    }
  }
  return out;
}
