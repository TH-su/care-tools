// 接続診断の中身。
// ターミナル（npm run diag）と画面の「接続を診断」の両方がここを使う。
// 二つが別々の判定を持つと、どちらを信じればよいのか分からなくなるため。
//
// 返す形は表示から独立させ、呼び出し側が好きに描けるようにする。
//   { build, dataDir, redirectUri, sections: [{ title, items: [...] }], todos: [...] }
// items: { ok, label, note, mono }   mono は等幅で見せたい値（クライアントIDなど）
// todos: { what, url }               次にやること
import { DATA_DIR, getGoogleDraft, listCalendarSources, getCalendarSecrets } from './store.js';
import * as google from './google.js';
import { BUILD } from './build.js';

// 秘密の値は、長さと末尾4文字だけにする（この結果はそのまま共有される想定）
export function mask(v) {
  const t = String(v || '');
  if (!t) return '（無し）';
  return t.length > 8 ? `${t.length}文字（末尾 ${t.slice(-4)}）` : `${t.length}文字`;
}

// 見えない文字が混ざっていないか。混ざっていても目では分からないため、名前で出す
const HIDDEN = [
  [/[​-‍﻿]/, 'ゼロ幅文字'],
  [/　/, '全角空白'],
  [/ /, '改行なし空白'],
  [/[\r\n\t]/, '改行またはタブ'],
  [/^\s|\s$/, '前後の空白'],
];

export function hiddenIn(v) {
  const t = String(v || '');
  const found = HIDDEN.filter(([re]) => re.test(t)).map(([, name]) => name);
  // 全角空白などは「前後の空白」にも当たる。具体的な名前が出ているなら、そちらだけ残す
  return found.length > 1 ? found.filter(n => n !== '前後の空白') : found;
}

const API_PROBES = [
  { label: 'Google Calendar API', api: 'calendar', path: '/users/me/calendarList', service: 'calendar-json.googleapis.com' },
  { label: 'Google Tasks API', api: 'tasks', path: '/users/@me/lists', service: 'tasks.googleapis.com' },
];

export async function diagnose({ redirectUri }) {
  const todos = [];
  const add = (what, url = '') => { todos.push({ what, url }); };
  const sections = [];

  // ── 1. 手元に保存されている設定 ──────────────────────────────
  const draft = await getGoogleDraft();
  const clientId = draft.clientId || '';
  const clientSecret = draft.clientSecret || '';
  const settings = { title: '設定の控え', items: [] };
  sections.push(settings);

  if (!clientId) {
    settings.items.push({ ok: false, label: 'クライアントID', note: '（未入力）' });
    add('「カレンダーとToDoの接続」から、クライアントIDを入力してください');
  } else {
    const dirt = hiddenIn(clientId);
    const truncated = google.looksTruncatedClientId(clientId);
    settings.items.push({
      ok: dirt.length === 0 && !truncated,
      label: 'クライアントID', note: `${clientId.length}文字`, mono: clientId,
    });
    if (dirt.length) add(`IDに${dirt.join('・')}が混ざっています。コピーアイコンで取り直してください`);
    if (truncated) add('IDの末尾が .apps.googleusercontent.com で終わっていません。コピーの途中で切れています');
  }

  if (!clientSecret) {
    settings.items.push({ ok: false, label: 'シークレット', note: '（未入力）' });
    add('認証情報の画面で「シークレットを追加」から発行し、貼り付けてください');
  } else {
    const dirt = hiddenIn(clientSecret);
    settings.items.push({ ok: dirt.length === 0, label: 'シークレット', note: mask(clientSecret) });
    if (dirt.length) add(`シークレットに${dirt.join('・')}が混ざっています。コピーアイコンで取り直してください`);
  }

  // ── 2. Googleに直接聞く ──────────────────────────────────────
  if (clientId) {
    const ask = { title: 'Googleへの問い合わせ', items: [] };
    sections.push(ask);
    const v = await google.verifyClient({ clientId, clientSecret, redirectUri });
    if (v.ok) {
      ask.items.push({ ok: true, label: 'クライアントID・シークレット・リダイレクトURI', note: 'すべて一致' });
    } else if (v.cause === 'clientId') {
      ask.items.push({ ok: false, label: 'クライアントID', note: 'Googleに見つかりません' });
      add('認証情報の画面のコピーアイコンでIDを取り直して貼り直してください');
    } else if (v.cause === 'clientSecret') {
      ask.items.push({ ok: true, label: 'クライアントID', note: 'Googleに登録されています' });
      ask.items.push({ ok: false, label: 'シークレット', note: '一致しません' });
      add('「シークレットを追加」から新しく発行し、コピーアイコンで取得して貼り直してください');
    } else if (v.code === 'redirect_uri_mismatch') {
      ask.items.push({ ok: true, label: 'クライアントID・シークレット', note: '一致' });
      ask.items.push({ ok: false, label: 'リダイレクトURI', note: '登録されていません' });
      add(`「承認済みのリダイレクト URI」に ${redirectUri} を末尾スラッシュなしで登録してください`);
    } else if (v.code === 'network') {
      ask.items.push({ ok: false, label: 'Googleへの接続', note: v.message });
    } else {
      ask.items.push({ ok: false, label: '設定の確認', note: v.message });
    }
  }

  // ── 3. 連携済みカレンダーが、実際に読めるか ──────────────────
  const sources = listCalendarSources().filter(s => s.type === 'google');
  const linked = { title: `連携済みのGoogleカレンダー（${sources.length}件）`, items: [] };
  sections.push(linked);

  if (sources.length === 0) {
    linked.items.push({
      ok: false, label: 'まだ連携されていません',
      note: '「Googleにログインして許可する」から接続してください',
    });
  }

  for (const source of sources) {
    const name = source.name || source.email || source.id;
    const creds = await getCalendarSecrets(source);
    // 名前は見出しとして一度だけ。行ごとに繰り返すと読みにくい
    linked.items.push({ heading: true, label: name });

    if (!creds.clientId || !creds.refreshToken) {
      const missing = !creds.clientId ? '保存されたクライアントID' : '更新用トークン';
      linked.items.push({ ok: false, label: missing, note: '読み出せません' });
      add('接続画面から、もう一度連携し直してください');
      continue;
    }

    try {
      google.forgetToken(source.id);
      await google.refreshAccessToken({
        clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken,
      });
      linked.items.push({ ok: true, label: '認証', note: 'アクセストークンを取得できました' });
    } catch (err) {
      const cause = google.invalidClientCause(err.googleDescription);
      linked.items.push({ ok: false, label: '認証', note: err.message });
      if (cause === 'clientId') add('保存されたクライアントIDがGoogleに見つかりません。連携し直してください');
      else if (cause === 'clientSecret') add('シークレットを発行し直して、連携し直してください');
      else add('接続画面から、もう一度連携し直してください');
      continue;
    }

    for (const probe of API_PROBES) {
      try {
        await google.googleFetch(source, creds, probe.api, probe.path, { query: { maxResults: 1 } });
        linked.items.push({ ok: true, label: probe.label, note: '読み取れました' });
      } catch (err) {
        linked.items.push({
          ok: false, label: probe.label,
          note: err.apiDisabled ? '有効になっていません' : err.message,
        });
        if (err.apiDisabled) {
          const project = err.apiDisabled.project;
          add(`${probe.label} を有効にしてください（反映まで数分かかることがあります）`,
            `https://console.cloud.google.com/apis/library/${probe.service}${project ? `?project=${project}` : ''}`);
        }
      }
    }
  }

  return { build: BUILD, dataDir: DATA_DIR, redirectUri, sections, todos };
}
