// Googleのエラー文言が、こちらの読み分けと合っているかを実サービスで確かめる。
//
//   npm run check:google
//
// このアプリは invalid_client を「IDが違う」と「シークレットが違う」に読み分けている。
// その根拠はGoogleが返す説明文だけで、仕様として約束されたものではない。
// 文言が変われば、静かに誤った案内を出し続けることになる。
//
// ここでは実際のGoogleへ、わざと通らない値を送って応答を確かめる。
// トークンは一切発行されない。送るのは、存在しないクライアントと、
// 実在するクライアントID（秘密ではない）＋でたらめなシークレットだけ。
//
// 実在するIDは、環境変数で渡すか、保存済みの控えから拾う。
//   SILVERMAIL_CHECK_CLIENT_ID=... npm run check:google
import { getGoogleDraft } from '../server/store.js';
import { ENDPOINTS, invalidClientCause } from '../server/google.js';

const line = (s = '') => console.log(s);
const results = [];
const record = (ok, name, got) => { results.push(ok); line(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) line(`      実際: ${got}`); };

async function token(params) {
  const res = await fetch(ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: `HTTP ${res.status}`, error_description: text.slice(0, 120) }; }
}

line();
line('  Googleのエラー文言の点検');
line('  ' + '─'.repeat(52));
line(`  問い合わせ先  ${ENDPOINTS.token}`);
line();

// 1. 存在しないクライアント → 「見つからない」と言われること
{
  const d = await token({
    client_id: '000000000000-silvermail-does-not-exist.apps.googleusercontent.com',
    client_secret: 'GOCSPX-nonexistent',
    grant_type: 'refresh_token', refresh_token: 'dummy',
  });
  const cause = invalidClientCause(d.error_description);
  record(d.error === 'invalid_client' && cause === 'clientId',
    '存在しないIDを「クライアントIDの側」と読める',
    `${d.error} / ${d.error_description}`);
}

// 2. 実在するクライアント＋でたらめなシークレット → 「シークレットの側」と言われること
const clientId = process.env.SILVERMAIL_CHECK_CLIENT_ID || (await getGoogleDraft()).clientId;
if (!clientId) {
  line('  － 実在するクライアントIDが無いため、シークレット側の点検は省略しました');
  line('     （SILVERMAIL_CHECK_CLIENT_ID=... を付けて実行すると点検できます）');
} else {
  for (const [label, grant] of [['更新方式', 'refresh_token'], ['認可コード方式', 'authorization_code']]) {
    const d = await token({
      client_id: clientId,
      client_secret: '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secret',
      grant_type: grant,
      ...(grant === 'refresh_token' ? { refresh_token: 'dummy' } : { code: 'silvermail-check' }),
    });
    const cause = invalidClientCause(d.error_description);
    record(d.error === 'invalid_client' && cause === 'clientSecret',
      `${label}：誤ったシークレットを「シークレットの側」と読める`,
      `${d.error} / ${d.error_description}`);
  }
}

line();
line('  ' + '─'.repeat(52));
const bad = results.filter(r => !r).length;
if (bad === 0) {
  line('  ✓ 読み分けは、いまのGoogleの応答と合っています。');
} else {
  line(`  ✗ ${bad}件、想定と違いました。`);
  line('    Googleが文言を変えた可能性があります。server/google.js の');
  line('    invalidClientCause() を、上の「実際」の文言に合わせてください。');
}
line();
process.exit(bad ? 1 : 0);
