// Google OAuth 2.0（デスクトップアプリ方式・PKCE＋ループバック受け取り）と
// Google Calendar / Google Tasks への API 呼び出し。
// テストではエンドポイントを環境変数で差し替えてモックサーバーへ向ける。
import crypto from 'node:crypto';

const E = process.env;
export const ENDPOINTS = {
  auth: E.SILVERMAIL_GOOGLE_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: E.SILVERMAIL_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token',
  revoke: E.SILVERMAIL_GOOGLE_REVOKE || 'https://oauth2.googleapis.com/revoke',
  calendar: E.SILVERMAIL_GOOGLE_CALENDAR || 'https://www.googleapis.com/calendar/v3',
  tasks: E.SILVERMAIL_GOOGLE_TASKS || 'https://tasks.googleapis.com/tasks/v1',
  userinfo: E.SILVERMAIL_GOOGLE_USERINFO || 'https://www.googleapis.com/oauth2/v3/userinfo',
};

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'openid', 'email',
].join(' ');

// ── 認証フローの一時保管（サーバー再起動で消えてよい） ─────────
const pending = new Map(); // state → {clientId, clientSecret, verifier, redirectUri, status, error, sourceId}

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function startAuth({ clientId, clientSecret, redirectUri }) {
  const state = base64url(crypto.randomBytes(24));
  // PKCEはシークレットを持たないクライアント（デスクトップ等）のための仕組み。
  // シークレットありの「ウェブ アプリケーション」に付けると、Googleはクライアントを
  // 照合できず invalid_client（The OAuth client was not found.）を返す。
  const usePkce = !clientSecret;
  const verifier = usePkce ? base64url(crypto.randomBytes(48)) : null;
  const challenge = verifier ? base64url(crypto.createHash('sha256').update(verifier).digest()) : null;
  pending.set(state, { clientId, clientSecret, verifier, redirectUri, status: 'waiting' });
  // 10分で失効
  setTimeout(() => pending.delete(state), 10 * 60 * 1000).unref?.();

  const url = new URL(ENDPOINTS.auth);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  if (challenge) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return { state, authUrl: url.toString() };
}

export function getPending(state) {
  return pending.get(state) || null;
}

export function finishAuth(state, patch) {
  const p = pending.get(state);
  if (p) Object.assign(p, patch);
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* HTMLエラーページ等 */ }
  if (!res.ok) {
    const detail = data?.error_description || data?.error || text.slice(0, 200);
    // 種別（invalid_client など）まで出す。説明文だけでは原因を絞れないため。
    const kind = data?.error && data.error_description ? `${data.error} / ` : '';
    const err = new Error(`Googleの認証に失敗しました: ${kind}${detail}`);
    err.status = res.status === 401 || res.status === 400 ? 401 : 502;
    err.authFailed = true;
    err.googleStatus = res.status;
    err.googleError = data?.error || null;
    err.googleDescription = data?.error_description || null;
    err.googleBody = text.slice(0, 400);
    throw err;
  }
  return data || {};
}

export function exchangeCode({ clientId, clientSecret, code, redirectUri, verifier }) {
  return postForm(ENDPOINTS.token, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code,
    // 認可時にPKCEを使ったときだけ添える（使っていないのに送ると照合に失敗する）
    ...(verifier ? { code_verifier: verifier } : {}),
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
}

export function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  return postForm(ENDPOINTS.token, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

export async function revokeToken(token) {
  try {
    await postForm(ENDPOINTS.revoke, { token });
  } catch { /* 失効済みでも問題ないので無視する */ }
}

// ── アクセストークンのキャッシュ ──────────────────────────────
const tokenCache = new Map(); // sourceId → {token, expiresAt}

export function forgetToken(sourceId) {
  tokenCache.delete(sourceId);
}

async function accessTokenFor(source, creds) {
  const cached = tokenCache.get(source.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!creds.refreshToken) {
    const err = new Error('Googleとの連携が切れています。設定から接続し直してください。');
    err.status = 401; err.authFailed = true;
    throw err;
  }
  const r = await refreshAccessToken({
    clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken,
  });
  const token = r.access_token;
  tokenCache.set(source.id, { token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
  return token;
}

/**
 * Google APIを叩く。401なら1度だけトークンを取り直して再試行する。
 * @param {'calendar'|'tasks'|'userinfo'} api
 */
export async function googleFetch(source, creds, api, path, { method = 'GET', query, body } = {}) {
  const run = async (token) => {
    const base = ENDPOINTS[api];
    const url = new URL(api === 'userinfo' ? base : `${base}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return {};
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 空応答 */ }
    return { res, data, text };
  };

  let token = await accessTokenFor(source, creds);
  let out = await run(token);
  if (out.res && out.res.status === 401) {
    tokenCache.delete(source.id);
    token = await accessTokenFor(source, creds);
    out = await run(token);
  }
  if (!out.res) return out;
  if (!out.res.ok) {
    const msg = out.data?.error?.message || out.text?.slice(0, 200) || `HTTP ${out.res.status}`;
    const err = new Error(`Google APIエラー: ${msg}`);
    err.status = out.res.status === 401 || out.res.status === 403 ? 401 : 502;
    err.authFailed = out.res.status === 401;
    throw err;
  }
  return out.data || {};
}

// 認可直後（アクセストークンだけ手元にある状態）でメールアドレスを引く
export async function fetchUserinfo(accessToken) {
  try {
    const res = await fetch(ENDPOINTS.userinfo, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

// ── invalid_client の読み分け ────────────────────────────────
// Googleは invalid_client をふたつの意味で返す。説明文で確実に見分けられる。
//   "The OAuth client was not found."        → クライアントIDが見つからない
//   "The provided client secret is invalid." → IDは実在し、シークレットだけが違う
// この二つを一緒くたにすると、正しいIDを何度も貼り直すことになる。
export function invalidClientCause(description) {
  const d = String(description || '').toLowerCase();
  if (d.includes('client was not found')) return 'clientId';
  if (d.includes('client secret') || d.includes('unauthorized')) return 'clientSecret';
  return 'unknown';
}

// クライアントIDは「番号-英数字.apps.googleusercontent.com」の形。
// 末尾が1文字欠けただけでもGoogleは別物として扱うが、見た目ではまず気付けない。
// 接尾辞を付けない短い形はGoogle側も受け付けるため、そこは指摘しない。
export function looksTruncatedClientId(clientId) {
  const t = String(clientId || '');
  return t.includes('.') && !/\.apps\.googleusercontent\.com$/.test(t);
}

// クライアントIDが見つからないときの案内。原因の見当まで添える。
export function clientIdNotFoundMessage(clientId) {
  const hint = looksTruncatedClientId(clientId)
    ? 'クライアントIDの末尾が「.apps.googleusercontent.com」で終わっていません。コピーの途中で切れています。'
    : 'IDに余分な空白・全角空白・見えない文字が混ざっているか、末尾が欠けている可能性があります。';
  return `クライアントIDがGoogleに見つかりません。${hint}`
    + '認証情報の画面のコピーアイコンで取り直して貼り直してください'
    + '（そのクライアントを削除した場合も、同じエラーになります）。';
}

// ── 接続前の設定チェック ──────────────────────────────────────
// ブラウザの許可画面へ行く前に、実際の接続と「同じ方式」で設定を確かめる。
// わざと通らない認可コードを送り、返るエラーの種類で判定する（トークンは発行されない）。
//
// grant_type は authorization_code でなければならない。refresh_token で問い合わせると
// Googleはシークレットより先にトークンを弾くため、シークレットの誤りを見逃す。
export async function verifyClient({ clientId, clientSecret, redirectUri }) {
  let res;
  let data = null;
  let text = '';
  try {
    res = await fetch(ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        grant_type: 'authorization_code',
        code: 'silvermail-connection-probe',
        // 本番と同じ形にする。シークレットが無いときだけPKCEを使うため、
        // ここでも同じ条件でダミーの検証子を添える
        ...(clientSecret ? {} : { code_verifier: 'silvermail-connection-probe-verifier' }),
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      }).toString(),
    });
    text = await res.text();
    try { data = JSON.parse(text); } catch { /* HTMLエラーページ等 */ }
  } catch (err) {
    return {
      ok: false, code: 'network',
      message: `Googleに接続できませんでした（${err.message}）。ネットワークやプロキシの設定をご確認ください。`,
    };
  }

  const code = data?.error || (res.ok ? 'ok' : `http_${res.status}`);
  const detail = data?.error_description || '';

  // invalid_grant = 「わざと無効にした認可コード」が拒まれただけ。
  // ここまで来たなら、ID・シークレット・リダイレクトURIはすべて通っている。
  if (code === 'invalid_grant' || code === 'ok') {
    return { ok: true, code, message: 'クライアントID・シークレット・リダイレクトURIのすべてを確認できました。' };
  }
  if (code === 'invalid_client') {
    const cause = invalidClientCause(detail);
    if (cause === 'clientId') {
      return { ok: false, code, cause, detail, message: clientIdNotFoundMessage(clientId) };
    }
    if (cause === 'clientSecret') {
      return {
        ok: false, code, cause, detail,
        message: 'クライアントIDは見つかりましたが、シークレットが一致しません。認証情報の画面で「シークレットを追加」から新しく発行し、コピーアイコンで取得して貼り直してください。',
      };
    }
    return {
      ok: false, code, cause, detail,
      message: 'クライアントIDかシークレットが一致しません。認証情報の画面で「シークレットを追加」から新しく発行し、コピーアイコンで取得して貼り直してください（IDとシークレットが同じクライアントのものかもご確認ください）。',
    };
  }
  if (code === 'redirect_uri_mismatch') {
    return {
      ok: false, code, detail,
      message: `リダイレクトURIが登録されていません。認証情報の画面で「承認済みのリダイレクト URI」に ${redirectUri || 'このアプリのURI'} を追加してください（末尾のスラッシュなし）。`,
    };
  }
  if (code === 'unauthorized_client') {
    return {
      ok: false, code, detail,
      message: 'このクライアントでは今回の方式が許可されていません。種類を「ウェブ アプリケーション」にして作り直してください。',
    };
  }
  return {
    ok: false, code, detail,
    message: `Googleから予期しない応答がありました（${code}${detail ? `: ${detail}` : ''}）。`,
  };
}
