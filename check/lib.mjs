/* check/lib.mjs — 検証道具の共通部品（2026-10-04 新設）
 *
 * ・playwright は check/node_modules → /opt/node-tools（クラウドの作業環境）→ NODE_PATH の順で探す
 * ・静的サーバーは Node 標準の http だけで立てる（依存を増やさない）
 * ・画面の一覧 PAGES は「公開ホワイトリストにある HTML」から機械的に作る（移転案内の kotowaza は除く）
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  const c = ['playwright', '/opt/node-tools/node_modules/playwright'];
  for (const p of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) c.push(path.join(p, 'playwright'));
  for (const name of c) { try { return require(name); } catch (e) { /* 次を試す */ } }
  throw new Error('playwright が見つかりません。check/ で `npm install` を実行するか、NODE_PATH を設定してください。');
}

/* 検証の対象にする画面。ホワイトリスト（.gitignore の !/xxx.html）から読む */
export function listPages(repoDir) {
  const gi = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  const pages = [];
  for (const line of gi.split('\n')) {
    const m = line.match(/^!\/([A-Za-z0-9_.-]+\.html)\s*$/);
    if (m && m[1] !== 'kotowaza-jiten.html') pages.push(m[1]);
  }
  return pages.sort();
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

/* 配布物をそのまま配る静的サーバー。GitHub Pages と同じく「ファイルがあれば返す・無ければ 404」だけ */
export function startServer(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.normalize(path.join(root, p));
      if (!(file === root || file.startsWith(root + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(500); res.end('error'); }
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port;
      ok({ url, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/* PDF のページ数。pdfinfo があればそれを使い、無ければ /Type /Page の数を数える（Chromium の PDF は非圧縮で数えられる） */
export function pdfPages(file) {
  try {
    const out = execFileSync('pdfinfo', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/Pages:\s+(\d+)/);
    if (m) return Number(m[1]);
  } catch (e) { /* pdfinfo が無い */ }
  const buf = fs.readFileSync(file, 'latin1');
  const n = (buf.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  return n || null;
}

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
export function readJson(f, fallback = null) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } }
export function writeJson(f, obj) { fs.writeFileSync(f, JSON.stringify(obj, null, 2)); }

/* 画面の時計を止める日時（スクリーンショットの「印刷日」「今日」が走らないように） */
export const FIXED_TIME = new Date('2026-01-14T09:00:00+09:00');
