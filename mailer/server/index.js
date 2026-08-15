// SilverMail サーバー本体
// 127.0.0.1 のみで待ち受けるローカルアプリ。外部公開しないこと。
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { api } from './api.js';
import { closeAll } from './imap.js';
import { DATA_DIR, listAccounts, saveAccount } from './store.js';
import { DEMO_ACCOUNTS } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8744;
const HOST = '127.0.0.1';

// 手元で動かすアプリなので「落ちない」ことを最優先する安全網。
// メールサーバー側の切断など想定外のエラーでプロセスが終了すると、
// 画面は開いたままなのに操作が一切できなくなるため、記録だけして動き続ける。
process.on('uncaughtException', (err) => {
  console.error('  [警告] 想定外のエラーが発生しました（サーバーは継続します）:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('  [警告] 未処理のエラーが発生しました（サーバーは継続します）:', reason?.message || reason);
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' })); // 添付のbase64を考慮

// 悪意あるWebページからの localhost への横撃ち（CSRF/DNSリバインディング）対策:
// Host と Origin がローカル以外のリクエストを拒否する
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, 'localhost', '127.0.0.1']);
app.use((req, res, next) => {
  const host = String(req.headers.host || '');
  if (!LOCAL_HOSTS.has(host)) {
    return res.status(403).json({ error: 'ローカルホスト以外からのアクセスは許可されていません' });
  }
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ''))) {
    return res.status(403).json({ error: '許可されていないオリジンです' });
  }
  next();
});

app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPAフォールバック
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --demo 起動: デモアカウントを自動投入
async function setupDemo() {
  if (!process.argv.includes('--demo') && process.env.SILVERMAIL_DEMO !== '1') return;
  const existing = new Set(listAccounts().map(a => a.id));
  for (const demo of DEMO_ACCOUNTS) {
    if (!existing.has(demo.id)) await saveAccount(demo);
  }
  console.log('  デモモード: デモアカウントを追加しました');
}

const server = app.listen(PORT, HOST, async () => {
  await setupDemo();
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │                                              │');
  console.log('  │   ✉  SilverMail                              │');
  console.log('  │                                              │');
  console.log(`  │   ブラウザで開く → http://localhost:${PORT}      │`);
  console.log('  │                                              │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  console.log(`  データ保存先: ${DATA_DIR}`);
  console.log('  終了するには Ctrl+C を押してください');
  console.log('');
  // macOSでは既定のブラウザを自動で開く（--no-open で抑制）
  if (process.platform === 'darwin' && !process.argv.includes('--no-open')) {
    execFile('open', [`http://localhost:${PORT}`], () => {});
  }
});

async function shutdown() {
  console.log('\n  接続を閉じています…');
  server.close();
  await closeAll().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
