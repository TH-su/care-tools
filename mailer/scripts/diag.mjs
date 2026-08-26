// SilverMail 接続診断
//
// Google連携が繋がらないとき、原因を一度に突き止めるためのコマンド。
//   npm run diag
//
// 設定の控え → Googleへの問い合わせ → 連携済みカレンダーの疎通、の順に、
// 実際にGoogleへ送って確かめる。どこで止まっているかと、次にやることを出す。
//
// 出力はそのまま貼って共有できる。シークレットは長さと末尾4文字しか出さない。
import { DATA_DIR, getGoogleDraft, listCalendarSources, getCalendarSecrets } from '../server/store.js';
import * as google from '../server/google.js';
import { buildLine } from '../server/build.js';

const PORT = Number(process.env.PORT) || 8744;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/api/oauth/google/callback`;

const OK = '✓';
const NG = '✗';
const findings = [];   // 見つかった不具合と、次にやること

const line = (s = '') => console.log(s);
const head = (s) => { line(); line(`  ● ${s}`); };
const item = (ok, label, note = '') => line(`    ${ok ? OK : NG} ${label}${note ? `  ${note}` : ''}`);
const todo = (what, url = '') => {
  findings.push({ what, url });
  line(`       → ${what}`);
  if (url) line(`         ${url}`);
};

// 秘密の値は、長さと末尾4文字だけにする（この出力はそのまま共有される想定）
const mask = (v) => {
  const t = String(v || '');
  if (!t) return '（無し）';
  return t.length > 8 ? `${t.length}文字（末尾 ${t.slice(-4)}）` : `${t.length}文字`;
};

// 見えない文字が混ざっていないか。混ざっていても目では分からないため、名前で出す
const HIDDEN = [
  [/[​-‍﻿]/, 'ゼロ幅文字'],
  [/　/, '全角空白'],
  [/ /, '改行なし空白'],
  [/[\r\n\t]/, '改行またはタブ'],
  [/^\s|\s$/, '前後の空白'],
];
const hiddenIn = (v) => {
  const t = String(v || '');
  const found = HIDDEN.filter(([re]) => re.test(t)).map(([, name]) => name);
  // 全角空白などは「前後の空白」にも当たる。具体的な名前が出ているなら、そちらだけ残す
  return found.length > 1 ? found.filter(n => n !== '前後の空白') : found;
};

line();
line('  SilverMail 接続診断');
line('  ' + '─'.repeat(52));
line(`  アプリの版    ${buildLine()}`);
line(`  データ保存先  ${DATA_DIR}`);
line(`  リダイレクトURI ${REDIRECT_URI}`);

// ── 1. 手元に保存されている設定 ────────────────────────────────
head('設定の控え');
const draft = await getGoogleDraft();
const clientId = draft.clientId || '';
const clientSecret = draft.clientSecret || '';

if (!clientId) {
  item(false, 'クライアントID', '（未入力）');
  todo('SilverMailの「カレンダーとToDoの接続」から、クライアントIDを入力してください');
} else {
  const dirt = hiddenIn(clientId);
  const truncated = google.looksTruncatedClientId(clientId);
  const clean = dirt.length === 0 && !truncated;
  item(clean, 'クライアントID', `${clientId.length}文字`);
  line(`       ${clientId}`);
  if (dirt.length) todo(`IDに${dirt.join('・')}が混ざっています。コピーアイコンで取り直してください`);
  if (truncated) todo('IDの末尾が .apps.googleusercontent.com で終わっていません。コピーの途中で切れています');
}

if (!clientSecret) {
  item(false, 'シークレット', '（未入力）');
  todo('認証情報の画面で「シークレットを追加」から発行し、貼り付けてください');
} else {
  const dirt = hiddenIn(clientSecret);
  item(dirt.length === 0, 'シークレット', mask(clientSecret));
  if (dirt.length) todo(`シークレットに${dirt.join('・')}が混ざっています。コピーアイコンで取り直してください`);
}

// ── 2. Googleに直接聞く ────────────────────────────────────────
if (clientId) {
  head('Googleへの問い合わせ');
  const v = await google.verifyClient({ clientId, clientSecret, redirectUri: REDIRECT_URI });
  if (v.ok) {
    item(true, 'クライアントID・シークレット・リダイレクトURI', 'すべて一致');
  } else if (v.cause === 'clientId') {
    item(false, 'クライアントID', 'Googleに見つかりません');
    todo('認証情報の画面のコピーアイコンでIDを取り直して貼り直してください');
  } else if (v.cause === 'clientSecret') {
    item(true, 'クライアントID', 'Googleに登録されています');
    item(false, 'シークレット', '一致しません');
    todo('「シークレットを追加」から新しく発行し、コピーアイコンで取得して貼り直してください');
  } else if (v.code === 'redirect_uri_mismatch') {
    item(true, 'クライアントID・シークレット', '一致');
    item(false, 'リダイレクトURI', '登録されていません');
    todo(`「承認済みのリダイレクト URI」に ${REDIRECT_URI} を末尾スラッシュなしで登録してください`);
  } else if (v.code === 'network') {
    item(false, 'Googleへの接続', v.message);
  } else {
    item(false, '設定の確認', v.message);
  }
}

// ── 3. 連携済みカレンダーが、実際に読めるか ────────────────────
const sources = listCalendarSources().filter(s => s.type === 'google');
head(`連携済みのGoogleカレンダー（${sources.length}件）`);

if (sources.length === 0) {
  line('    まだありません。接続画面の「Googleにログインして許可する」から連携してください。');
}

for (const source of sources) {
  line(`    ${source.name || source.email || source.id}`);
  const creds = await getCalendarSecrets(source);

  if (!creds.clientId) {
    item(false, '保存されたクライアントID', '読み出せません');
    todo('接続画面から、もう一度連携し直してください');
    continue;
  }
  if (!creds.refreshToken) {
    item(false, '更新用トークン', '保存されていません');
    todo('接続画面から、もう一度連携し直してください');
    continue;
  }

  // アクセストークンを取れるか（ここが通れば認証は健全）
  try {
    google.forgetToken(source.id);
    await google.refreshAccessToken({
      clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken,
    });
    item(true, '認証', 'アクセストークンを取得できました');
  } catch (err) {
    const cause = google.invalidClientCause(err.googleDescription);
    item(false, '認証', err.message);
    if (cause === 'clientId') todo('保存されたクライアントIDがGoogleに見つかりません。連携し直してください');
    else if (cause === 'clientSecret') todo('シークレットを発行し直して、連携し直してください');
    else todo('接続画面から、もう一度連携し直してください');
    continue;
  }

  // 使うAPIが有効になっているか
  const probes = [
    ['Google Calendar API', 'calendar', '/users/me/calendarList', 'calendar-json.googleapis.com'],
    ['Google Tasks API', 'tasks', '/users/@me/lists', 'tasks.googleapis.com'],
  ];
  for (const [label, api, path, service] of probes) {
    try {
      await google.googleFetch(source, creds, api, path, { query: { maxResults: 1 } });
      item(true, label, '読み取れました');
    } catch (err) {
      item(false, label, err.apiDisabled ? '有効になっていません' : err.message);
      if (err.apiDisabled) {
        const project = err.apiDisabled.project;
        todo(`${label} を有効にしてください（反映まで数分かかることがあります）`,
          `https://console.cloud.google.com/apis/library/${service}${project ? `?project=${project}` : ''}`);
      }
    }
  }
}

// ── まとめ ────────────────────────────────────────────────────
line();
line('  ' + '─'.repeat(52));
if (findings.length === 0) {
  line(`  ${OK} 問題は見つかりませんでした。`);
} else {
  line(`  次にやること（${findings.length}件）`);
  findings.forEach((f, i) => {
    line(`   ${i + 1}. ${f.what}`);
    if (f.url) line(`      ${f.url}`);
  });
  line();
  line('  直したあと、もう一度 npm run diag を実行してください。');
}
line();
line('  この出力はそのまま貼って共有できます（シークレットは長さと末尾4文字だけです）。');
line();

process.exit(findings.length ? 1 : 0);
