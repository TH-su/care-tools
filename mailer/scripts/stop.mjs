// 起動中のSilverMailを終了する（npm run stop）
// ポートを掴んでいるプロセスを探して終了させる。古いSilverMailが残って
// 「ポートが使用中」になる状況を、利用者がコマンドを覚えずに解消できるようにする。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PORT = Number(process.env.PORT) || 8744;

async function pidsOnPort() {
  if (process.platform === 'win32') {
    const { stdout } = await run('netstat', ['-ano', '-p', 'TCP']).catch(() => ({ stdout: '' }));
    return [...new Set(stdout.split('\n')
      .filter(l => l.includes(`:${PORT}`) && /LISTENING/i.test(l))
      .map(l => l.trim().split(/\s+/).pop())
      .filter(p => p && p !== '0'))];
  }
  const { stdout } = await run('lsof', ['-ti', `tcp:${PORT}`]).catch(() => ({ stdout: '' }));
  return stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

const pids = await pidsOnPort();

if (pids.length === 0) {
  console.log(`  ポート ${PORT} で起動しているSilverMailはありません。`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (process.platform === 'win32') await run('taskkill', ['/PID', pid, '/F']);
    else process.kill(Number(pid), 'SIGTERM');
    console.log(`  SilverMail（プロセス ${pid}）を終了しました。`);
  } catch (err) {
    console.error(`  プロセス ${pid} を終了できませんでした: ${err.message}`);
  }
}

// SIGTERMで終わらない場合に備えて少し待ってから確認する
await new Promise(r => setTimeout(r, 700));
const remaining = await pidsOnPort();
if (remaining.length > 0) {
  for (const pid of remaining) {
    try {
      process.kill(Number(pid), 'SIGKILL');
      console.log(`  プロセス ${pid} を強制終了しました。`);
    } catch { /* 既に終了済み */ }
  }
}
console.log('  npm start で起動し直せます。');
