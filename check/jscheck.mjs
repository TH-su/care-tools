/* check/jscheck.mjs — 「JS構文 OK」を機械で出す（2026-10-04 新設）
 *
 *   node check/jscheck.mjs [--dir .] [--files a.html,b.js]
 *
 * ・公開ホワイトリストの .js は node --check 相当（vm.Script で構文だけ読む）
 * ・HTML の中の <script>（src 無し・JSON やテンプレートでないもの）は切り出して同じく構文だけ読む
 * ・実行はしない。エラーは「ファイル:行」で出す（HTML の中なら HTML の行番号に直す）
 * 終了コード: エラーがあれば 1
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repoDir = path.resolve(args.dir || '.');

function whitelisted() {
  const gi = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  const out = [];
  for (const line of gi.split('\n')) { const m = line.match(/^!\/([A-Za-z0-9_.-]+\.(html|js))\s*$/); if (m) out.push(m[1]); }
  for (const f of fs.readdirSync(path.join(repoDir, 'check')).filter((f) => f.endsWith('.mjs'))) out.push('check/' + f);
  out.push('check/gas/report-inbox.gs');
  return out;
}
const files = args.files ? String(args.files).split(',').map((s) => s.trim()) : whitelisted();

let nFiles = 0, nBlocks = 0, nSkipped = 0, errors = [];
function check(code, label, lineOffset, isModule) {
  try {
    if (isModule) { new vm.SourceTextModule(code, { identifier: label }); }
    else new vm.Script(code, { filename: label, lineOffset });
  } catch (e) {
    if (isModule && /SourceTextModule is not a constructor|not defined/.test(String(e))) { nSkipped++; return; } // --experimental-vm-modules 無しでは module は読めない＝数えて飛ばす
    const m = String(e.stack || '').match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)'));
    errors.push(`${label}:${m ? m[1] : '?'} ${e.message}`);
  }
}
for (const f of files) {
  const full = path.join(repoDir, f);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  nFiles++;
  if (f.endsWith('.js') || f.endsWith('.gs')) { check(src, f, 0, false); continue; }
  if (f.endsWith('.mjs')) { check(src, f, 0, true); continue; }
  /* HTML のコメント（<!-- … -->）の中にある「<script>」という文字は読まない（説明文に出てくる）。
     コメントは script の外にあるものだけを飛ばす＝script の中身はそのまま読む */
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, pos = 0;
  while (true) {
    const cm = src.indexOf('<!--', pos);
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) break;
    if (cm !== -1 && cm < m.index) { const end = src.indexOf('-->', cm + 4); pos = end === -1 ? src.length : end + 3; continue; }
    pos = re.lastIndex;
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue;
    const line = src.slice(0, m.index).split('\n').length;   // <script> タグの行
    nBlocks++;
    check(m[2], f, line - 1, type === 'module');
  }
}
if (errors.length) { console.log(errors.join('\n')); console.log(`JS構文 エラー ${errors.length}件（${nFiles}ファイル・HTML内 ${nBlocks}ブロック）`); process.exit(1); }
console.log(`JS構文 OK（${nFiles}ファイル・HTML内 ${nBlocks}ブロック${nSkipped ? '・module ' + nSkipped + '件は未確認（node --experimental-vm-modules で読める）' : ''}）`);
