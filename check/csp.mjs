/* check/csp.mjs — 業務画面の CSP（読み込み元を自サイトと Supabase・Google の受け口に絞る）を作る・確かめる（2026-10-15 代表者の依頼）
 *
 *   node check/csp.mjs --write            対象の全画面の CSP の meta を作り直す（画面のスクリプトを直したら必ず回す）
 *   node check/csp.mjs --write a.html     指定した画面だけ（配信で作る画面の組み立てからも呼ぶ）
 *   node check/csp.mjs --check            全画面の CSP が今の中身と合っているかを確かめる（CI の試験 csp_test も同じ判定）
 *
 * 決まり:
 *   ・画面の中のスクリプト（インラインの <script>）は、中身の指紋（sha256）で許す（代表者の選択 2026-10-15）。
 *     中身を1文字でも変えたら指紋が変わり、--write し直さないとそのスクリプトは動かない（CI の csp_test が落ちて知らせる）
 *   ・インラインのイベント属性（onclick= など）は使わない（CSP で止まる。週間計画は data-on-click と受け口の表に置き換えた）
 *   ・読み込み元: スクリプト・画像・部品は自サイトだけ。通信は自サイト・Google の受け口（GAS）・Supabase だけ
 *   ・スタイルの属性（style="…"）は多くの画面が使うので 'unsafe-inline' を残す（スクリプトは残さない）
 *   ・HTML のコメントの中の「<script>」の文字は数えない（ブラウザもスクリプトとして扱わない）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUPABASE = 'https://jhbernqawjrzqwrmqrih.supabase.co';
/* 対象: テーマで作る業務画面。すでに自分の CSP を持つ画面（accounts・help・login・perf-report・shadow-check）は触らない。
   配信で作る3画面（work-schedule・shift-app・shift-analyzer）は、それぞれの組み立て（build）がこの道具を呼ぶ */
export const PAGES = [
  'admission-flow.html', 'care-schedule.html', 'connection-settings.html', 'daycare-roster.html', 'facesheet.html',
  'genogram.html', 'index.html', 'moushiokuri-viewer.html', 'overview-compare.html', 'patch-calendar.html',
  'resident-master.html', 'staff-master.html', 'supplies.html', 'support-overview.html', 'training-plan.html',
  'visit-overview.html', 'weight-record.html',
];
export const DEPLOY_BUILT = ['work-schedule.html', 'shift-app.html', 'shift-analyzer.html'];

/* 実行されるインラインのスクリプトの中身（コメントの中は飛ばす・src 付きは数えない） */
export function inlineScripts(html) {
  const out = [];
  let i = 0;
  const low = html.replace(/[A-Z]/g, ch => ch.toLowerCase());   // 英字だけ小文字に（toLowerCase は文字によって長さが変わり、位置がずれる＝İ など）
  while (i < html.length) {
    const c = low.indexOf('<!--', i), s = low.indexOf('<script', i);
    if (s < 0) break;
    if (c >= 0 && c < s) { const e = low.indexOf('-->', c + 4); if (e < 0) break; i = e + 3; continue; }
    const gt = html.indexOf('>', s);
    if (gt < 0) break;
    const attrs = html.slice(s + 7, gt);
    const end = low.indexOf('</script', gt + 1);
    if (end < 0) break;
    const body = html.slice(gt + 1, end);
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1];
    const runs = !/\bsrc\s*=/i.test(attrs) && (!type || /^(text\/javascript|module|application\/javascript)$/i.test(type));
    if (runs) out.push(body);
    i = end + 9;
  }
  return out;
}
export function hashOf(body) { return "'sha256-" + crypto.createHash('sha256').update(body, 'utf8').digest('base64') + "'"; }
export function policy(html) {
  const hashes = [...new Set(inlineScripts(html).map(hashOf))];
  return [
    "default-src 'self'",
    "script-src 'self'" + (hashes.length ? ' ' + hashes.join(' ') : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://script.google.com https://script.googleusercontent.com " + SUPABASE + ' ' + SUPABASE.replace('https://', 'wss://'),
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}
const META_RE = /<meta http-equiv="Content-Security-Policy" data-su-csp content="[^"]*">\n?/;
export function metaOf(html) { return '<meta http-equiv="Content-Security-Policy" data-su-csp content="' + policy(html) + '">'; }
/* meta を入れる（あれば置き換える）。置き場所は <meta charset> の直後＝どのスクリプトよりも前 */
export function withMeta(html) {
  const meta = metaOf(html.replace(META_RE, ''));
  if (META_RE.test(html)) return html.replace(META_RE, meta + '\n');
  const m = /<meta charset="[^"]*">\n?/i.exec(html);
  if (!m) throw new Error('<meta charset> がありません');
  const at = m.index + m[0].length;
  return html.slice(0, at) + (m[0].endsWith('\n') ? '' : '\n') + meta + '\n' + html.slice(at);
}
export function checkPage(html) {
  const m = META_RE.exec(html);
  if (!m) return 'CSP の meta がありません';
  if (m[0].trim() !== metaOf(html.replace(META_RE, ''))) return 'CSP の指紋が中身と合っていません（node check/csp.mjs --write を回す）';
  const low = html.replace(/[A-Z]/g, ch => ch.toLowerCase());
  const cs = low.indexOf('<meta charset'), mi = m.index, first = low.indexOf('<script');
  if (cs < 0 || mi < cs || (first >= 0 && first < mi)) return 'CSP の meta が <meta charset> の直後（どのスクリプトよりも前）にありません';
  return '';
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const mode = args.find(a => a === '--write' || a === '--check');
  const files = args.filter(a => !a.startsWith('--'));
  const list = files.length ? files : PAGES.map(p => path.join(ROOT, p));
  let bad = 0;
  for (const f of list) {
    const html = fs.readFileSync(f, 'utf8');
    if (mode === '--write') {
      const next = withMeta(html);
      if (next !== html) { fs.writeFileSync(f, next); console.log('書き直した: ' + path.basename(f) + '（スクリプト ' + inlineScripts(next).length + '本）'); }
    } else {
      const why = checkPage(html);
      if (why) { bad++; console.log('✗ ' + path.basename(f) + ': ' + why); }
    }
  }
  if (mode !== '--write') console.log(bad ? 'CSP の不一致 ' + bad + ' 画面' : 'CSP は ' + list.length + ' 画面とも中身と一致');
  process.exit(bad ? 1 : 0);
}
