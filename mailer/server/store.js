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

async function keychainSet(accountId, password) {
  if (process.platform !== 'darwin') return false;
  try {
    await security(['add-generic-password', '-U',
      '-s', KEYCHAIN_SERVICE, '-a', accountId, '-w', password]);
    return true;
  } catch {
    return false;
  }
}

async function keychainGet(accountId) {
  if (process.platform !== 'darwin') return null;
  try {
    const out = await security(['find-generic-password',
      '-s', KEYCHAIN_SERVICE, '-a', accountId, '-w']);
    return out.replace(/\n$/, '');
  } catch {
    return null;
  }
}

async function keychainDelete(accountId) {
  if (process.platform !== 'darwin') return;
  try {
    await security(['delete-generic-password',
      '-s', KEYCHAIN_SERVICE, '-a', accountId]);
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
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

export { DATA_DIR };
