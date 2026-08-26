// 動いているアプリが「どの版か」を答えるための情報。
// 直したはずの不具合が直っていないとき、原因の大半は
// 「git pull していない」「サーバーを再起動していない」のどちらかで、
// 画面からは見分けが付かない。版を表に出して、この迷いを無くす。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', timeout: 3000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function readVersion() {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkg, 'utf8')).version || null;
  } catch { return null; }
}

// 起動時に一度だけ調べる（以後は変わらない。変えたければ再起動が要る＝それが知りたいこと）
export const BUILD = (() => {
  const version = readVersion();
  const startedAt = new Date().toISOString();
  try {
    const commit = git(['rev-parse', '--short', 'HEAD']);
    const date = git(['log', '-1', '--date=format:%Y-%m-%d %H:%M', '--format=%cd']);
    // 手元で編集中のファイルがあると、コミット番号だけでは中身を保証できない
    const dirty = git(['status', '--porcelain']).length > 0;
    return {
      id: dirty ? `${commit}+編集中` : commit,
      commit, date, dirty, version, startedAt,
    };
  } catch {
    // gitが無い／リポジトリ外に展開された場合。版が分からないことを隠さない
    return { id: version ? `v${version}` : '不明', commit: null, date: null, dirty: false, version, startedAt };
  }
})();

export function buildLine() {
  return BUILD.date ? `${BUILD.id}（${BUILD.date}）` : BUILD.id;
}
