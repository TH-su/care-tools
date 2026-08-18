// アカウント・設定の永続化層
// 保存先は既定で ~/.silvermail/（リポジトリ外）。パスワードは macOS では
// キーチェーンに保存し、他OS/失敗時のみ 0600 のローカルファイルに保存する。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const DATA_DIR = process.env.SILVERMAIL_DATA
  || path.join(os.homedir(), '.silvermail');

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const KEYCHAIN_SERVICE = 'SilverMail';

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows等では不可 */ }
}

// ── macOS キーチェーン ─────────────────────────────────────────
function security(args) {
  return new Promise((resolve, reject) => {
    execFile('security', args, { timeout: 10000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// key はキーチェーン上の「アカウント名」。メールはアカウントID、
// カレンダー連携は 'cal:{id}:refresh' のように用途を前置きして使う。
async function keychainSet(key, secret) {
  if (process.platform !== 'darwin') return false;
  try {
    await security(['add-generic-password', '-U',
      '-s', KEYCHAIN_SERVICE, '-a', key, '-w', secret]);
    return true;
  } catch {
    return false;
  }
}

async function keychainGet(key) {
  if (process.platform !== 'darwin') return null;
  try {
    const out = await security(['find-generic-password',
      '-s', KEYCHAIN_SERVICE, '-a', key, '-w']);
    return out.replace(/\n$/, '');
  } catch {
    return null;
  }
}

async function keychainDelete(key) {
  if (process.platform !== 'darwin') return;
  try {
    await security(['delete-generic-password',
      '-s', KEYCHAIN_SERVICE, '-a', key]);
  } catch { /* 未登録なら何もしない */ }
}

// ── アカウント ────────────────────────────────────────────────
// account = { id, type: 'imap'|'demo', name, email, color,
//   imap: {host, port, secure}, smtp: {host, port, secure},
//   user, signature, skipSentAppend, createdAt,
//   password?(ファイル保存時のみ), passwordInKeychain? }

export function listAccounts() {
  return readJson(ACCOUNTS_FILE, []);
}

// パスワード等の秘匿情報を落としたクライアント向け表現
export function publicAccount(a) {
  const { password, passwordInKeychain, ...rest } = a;
  return { ...rest, hasPassword: Boolean(password) || Boolean(passwordInKeychain) };
}

export async function getPassword(account) {
  if (account.type === 'demo') return '';
  if (account.passwordInKeychain) {
    const pw = await keychainGet(account.id);
    if (pw !== null) return pw;
  }
  return account.password || '';
}

export async function saveAccount(input, password) {
  const accounts = listAccounts();
  const existing = input.id ? accounts.find(a => a.id === input.id) : null;
  const account = {
    ...(existing || {}),
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  if (password !== undefined && password !== null && password !== '') {
    const inKeychain = await keychainSet(account.id, password);
    if (inKeychain) {
      account.passwordInKeychain = true;
      delete account.password;
    } else {
      account.password = password;
      delete account.passwordInKeychain;
    }
  }

  const idx = accounts.findIndex(a => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  writeJson(ACCOUNTS_FILE, accounts);
  return account;
}

export async function deleteAccount(id) {
  const accounts = listAccounts().filter(a => a.id !== id);
  await keychainDelete(id);
  writeJson(ACCOUNTS_FILE, accounts);
}

export function getAccount(id) {
  return listAccounts().find(a => a.id === id) || null;
}

// ── 設定 ─────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  theme: 'auto',            // 'auto' | 'light' | 'dark'
  checkIntervalMin: 3,      // 新着チェック間隔（分）
  remoteImages: 'block',    // 'block' | 'allow'
  notifications: false,     // デスクトップ通知
  defaultAccountId: null,   // 既定の差出人
  panelTab: 'calendar',     // 右パネルの表示（'calendar' | 'tasks'）
  panelOpen: true,          // 右パネルを開いておくか
  defaultCalendar: null,    // 予定の既定の登録先 {sourceId, calendarId}
  defaultTaskList: null,    // ToDoの既定の保存先 {sourceId, listId}
  weekStart: 0,             // 週の開始（0=日曜, 1=月曜）
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

// ── 秘匿情報（カレンダー連携のトークン等） ─────────────────────
// 返り値 true = キーチェーンに入った。false のときは呼び出し側が
// 設定ファイル側（0600）に持たせる。
export async function setSecret(key, value) {
  return keychainSet(key, value);
}
export async function getSecret(key) {
  return keychainGet(key);
}
export async function deleteSecret(key) {
  return keychainDelete(key);
}

// ── カレンダー連携元（Google / 購読URL / このMac内） ────────────
// source = { id, type:'google'|'ics'|'local', name, color, enabled,
//   email?, clientId?, calendars?: [{id,summary,selected,...}], defaultCalendarId?,
//   url?, createdAt,
//   clientSecret?/refreshToken?（キーチェーンに入らなかった場合のみファイル保存） }
const CALENDARS_FILE = path.join(DATA_DIR, 'calendars.json');
const LOCAL_EVENTS_FILE = path.join(DATA_DIR, 'local-events.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

const secretKey = (id, kind) => `cal:${id}:${kind}`;

export function listCalendarSources() {
  return readJson(CALENDARS_FILE, []);
}

export function getCalendarSource(id) {
  return listCalendarSources().find(s => s.id === id) || null;
}

export function publicCalendarSource(s) {
  const { clientSecret, refreshToken, ...rest } = s;
  return { ...rest, connected: s.type !== 'google' || Boolean(refreshToken) || Boolean(s.refreshTokenInKeychain) };
}

// secrets = { clientSecret?, refreshToken? }（渡された分だけ更新）
export async function saveCalendarSource(input, secrets = {}) {
  const sources = listCalendarSources();
  const existing = input.id ? sources.find(s => s.id === input.id) : null;
  const source = {
    color: '#0a7aff',
    enabled: true,
    ...(existing || {}),
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  for (const kind of ['clientSecret', 'refreshToken']) {
    const value = secrets[kind];
    if (value === undefined || value === null || value === '') continue;
    const stored = await keychainSet(secretKey(source.id, kind), value);
    if (stored) {
      source[`${kind}InKeychain`] = true;
      delete source[kind];
    } else {
      source[kind] = value;
      delete source[`${kind}InKeychain`];
    }
  }
  const idx = sources.findIndex(s => s.id === source.id);
  if (idx >= 0) sources[idx] = source;
  else sources.push(source);
  writeJson(CALENDARS_FILE, sources);
  return source;
}

export async function getCalendarSecrets(source) {
  const out = {};
  for (const kind of ['clientSecret', 'refreshToken']) {
    if (source[`${kind}InKeychain`]) {
      const v = await keychainGet(secretKey(source.id, kind));
      if (v !== null) { out[kind] = v; continue; }
    }
    out[kind] = source[kind] || '';
  }
  return out;
}

export async function deleteCalendarSource(id) {
  const sources = listCalendarSources().filter(s => s.id !== id);
  await keychainDelete(secretKey(id, 'clientSecret'));
  await keychainDelete(secretKey(id, 'refreshToken'));
  writeJson(CALENDARS_FILE, sources);
  // このMac内カレンダーを消したら、その予定も残さない
  const events = listLocalEvents().filter(e => e.sourceId !== id);
  writeJson(LOCAL_EVENTS_FILE, events);
}

// ── このMac内の予定（連携なしでも使えるカレンダー） ─────────────
export function listLocalEvents() {
  return readJson(LOCAL_EVENTS_FILE, []);
}

export function saveLocalEvent(input) {
  const events = listLocalEvents();
  const existing = input.id ? events.find(e => e.id === input.id) : null;
  const event = {
    ...(existing || {}),
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idx = events.findIndex(e => e.id === event.id);
  if (idx >= 0) events[idx] = event;
  else events.push(event);
  writeJson(LOCAL_EVENTS_FILE, events);
  return event;
}

export function deleteLocalEvent(id) {
  writeJson(LOCAL_EVENTS_FILE, listLocalEvents().filter(e => e.id !== id));
}

// ── ToDo（このMac内） ─────────────────────────────────────────
// task = { id, title, notes, due(ISO|null), done, doneAt, createdAt, sourceMail? }
export function listLocalTasks() {
  return readJson(TASKS_FILE, []);
}

export function saveLocalTask(input) {
  const tasks = listLocalTasks();
  const existing = input.id ? tasks.find(t => t.id === input.id) : null;
  const task = {
    done: false,
    notes: '',
    due: null,
    ...(existing || {}),
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (task.done && !task.doneAt) task.doneAt = new Date().toISOString();
  if (!task.done) task.doneAt = null;
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  writeJson(TASKS_FILE, tasks);
  return task;
}

export function deleteLocalTask(id) {
  writeJson(TASKS_FILE, listLocalTasks().filter(t => t.id !== id));
}

export { DATA_DIR };
