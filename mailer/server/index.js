// SilverMail サーバー本体
// 127.0.0.1 のみで待ち受けるローカルアプリ。外部公開しないこと。
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { api } from './api.js';
import { closeAll } from './imap.js';
import {
  DATA_DIR, listAccounts, saveAccount,
  listLocalEvents, saveLocalEvent, listLocalTasks, saveLocalTask,
} from './store.js';
import { DEMO_ACCOUNTS, demoEvents, demoTasks } from './demo.js';
import { ensureLocalSource, LOCAL_SOURCE_ID } from './calendar.js';
import { buildLine } from './build.js';

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
  // 予定とToDoも、まだ何も無いときだけサンプルを入れる
  ensureLocalSource();
  if (listLocalEvents().length === 0) {
    for (const ev of demoEvents()) saveLocalEvent({ ...ev, sourceId: LOCAL_SOURCE_ID });
  }
  if (listLocalTasks().length === 0) {
    for (const t of demoTasks()) saveLocalTask(t);
  }
  console.log('  デモモード: デモアカウント・サンプルの予定/ToDoを追加しました');
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
  console.log(`  アプリの版  : ${buildLine()}`);
  console.log(`  データ保存先: ${DATA_DIR}`);
  console.log('  終了するには Ctrl+C を押してください');
  console.log('');
  // macOSでは既定のブラウザを自動で開く（--no-open で抑制）
  if (process.platform === 'darwin' && !process.argv.includes('--no-open')) {
    execFile('open', [`http://localhost:${PORT}`], () => {});
  }
});

// 起動できなかった場合は、安全網に飲み込ませず具体的な対処を案内して終了する
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ポート ${PORT} はすでに使用中です。`);
    console.error('  古いSilverMailが起動したまま残っている可能性があります。');
    console.error('  （その場合、ブラウザに表示されているのは更新前の古い画面です）');
    console.error('');
    console.error('  対処1: 古いSilverMailを終了してから起動し直す');
    console.error('      npm run stop');
    console.error('      npm start');
    console.error('');
    console.error('  対処2: 別のポートで起動する');
    console.error(`      PORT=${PORT + 1} npm start`);
    console.error('');
  } else if (err.code === 'EACCES') {
    console.error(`\n  ポート ${PORT} を使用する権限がありません。PORT=8745 npm start のように別のポートをお試しください。\n`);
  } else {
    console.error('\n  サーバーを起動できませんでした:', err.message, '\n');
  }
  process.exit(1);
});

async function shutdown() {
  console.log('\n  接続を閉じています…');
  server.close();
  await closeAll().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
