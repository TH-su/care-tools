// APIクライアント — 全通信をここに集約（エラー整形込み）

async function request(path, { method = 'GET', body, query } = {}) {
  const qs = query
    ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))).toString()
    : '';
  let res;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('サーバーに接続できません。SilverMailが起動しているか確認してください。');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 非JSONレスポンス */ }
  if (!res.ok) {
    const err = new Error(data?.error || `エラーが発生しました (${res.status})`);
    err.status = res.status;
    err.authFailed = Boolean(data?.authFailed);
    throw err;
  }
  return data;
}

export const api = {
  bootstrap: () => request('/accounts'),
  saveAccount: (account, password) => request('/accounts', { method: 'POST', body: { account, password } }),
  updateAccount: (id, account, password) => request(`/accounts/${id}`, { method: 'PUT', body: { account, password } }),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  testAccount: (account, password, accountId) => request('/accounts/test', { method: 'POST', body: { account, password, accountId } }),
  autodetect: (email) => request('/autodetect', { method: 'POST', body: { email } }),
  addDemo: () => request('/demo', { method: 'POST' }),
  removeDemo: () => request('/demo', { method: 'DELETE' }),

  mailboxes: (account) => request('/mailboxes', { query: { account } }),
  counts: () => request('/counts'),
  messages: (params) => request('/messages', { query: params }),
  previews: (items) => request('/previews', { method: 'POST', body: { items } }),
  message: (account, mailbox, uid, images) => request('/message', { query: { account, mailbox, uid, images } }),
  action: (targets, op, moveTo) => request('/action', { method: 'POST', body: { targets, op, moveTo } }),
  send: (account, message) => request('/send', { method: 'POST', body: { account, message } }),
  saveDraft: (account, message) => request('/draft', { method: 'POST', body: { account, message } }),
  saveSettings: (patch) => request('/settings', { method: 'PUT', body: patch }),

  // ── カレンダー ──
  calendarSources: () => request('/calendar/sources'),
  addIcsSource: (name, url, color) => request('/calendar/sources', { method: 'POST', body: { type: 'ics', name, url, color } }),
  updateSource: (id, patch) => request(`/calendar/sources/${id}`, { method: 'PUT', body: patch }),
  deleteSource: (id) => request(`/calendar/sources/${id}`, { method: 'DELETE' }),
  syncSource: (id) => request(`/calendar/sources/${id}/sync`, { method: 'POST' }),
  googleVerify: (clientId, clientSecret) => request('/calendar/google/verify', { method: 'POST', body: { clientId, clientSecret } }),
  googleStart: (clientId, clientSecret) => request('/calendar/google/start', { method: 'POST', body: { clientId, clientSecret } }),
  googleStatus: (state) => request('/calendar/google/status', { query: { state } }),

  events: (from, to) => request('/calendar/events', { query: { from, to } }),
  createEvent: (sourceId, calendarId, event) => request('/calendar/events', { method: 'POST', body: { sourceId, calendarId, event } }),
  updateEvent: (sourceId, calendarId, eventId, event) => request('/calendar/events', { method: 'PUT', body: { sourceId, calendarId, eventId, event } }),
  deleteEvent: (sourceId, calendarId, eventId) => request('/calendar/events/delete', { method: 'POST', body: { sourceId, calendarId, eventId } }),

  // ── ToDo ──
  tasks: () => request('/tasks'),
  createTask: (sourceId, listId, task) => request('/tasks', { method: 'POST', body: { sourceId, listId, task } }),
  updateTask: (sourceId, listId, taskId, patch) => request('/tasks', { method: 'PUT', body: { sourceId, listId, taskId, patch } }),
  deleteTask: (sourceId, listId, taskId) => request('/tasks/delete', { method: 'POST', body: { sourceId, listId, taskId } }),
  moveTask: (from, to) => request('/tasks/move', { method: 'POST', body: { from, to } }),

  suggestSchedule: (subject, text, baseDate) => request('/schedule/suggest', { method: 'POST', body: { subject, text, baseDate } }),
};

export function attachmentUrl(accountId, mailbox, uid, index, inline) {
  const qs = new URLSearchParams({ account: accountId, mailbox, uid, index });
  if (inline) qs.set('disposition', 'inline');
  return `/api/attachment?${qs.toString()}`;
}
