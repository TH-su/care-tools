/* check/annot-render.mjs — 「画面の指摘」の配置図を PNG の絵にする（2026-10-04 新設・提案3）
 *
 *   node check/annot-render.mjs --body issue.txt --out check/out/annot.png      （Issue の本文を保存したファイルから）
 *   node check/annot-render.mjs --event "$GITHUB_EVENT_PATH" --out x.png         （GitHub Actions の中で。issue.body を読む）
 *
 * ・本文の中の「SU-LAYOUT-V1 {…}」の1行を取り出し、su-annot.js と同じ決まり（SUAnnot.clean）で形を確かめてから、
 *   同じ描き方（SUAnnot.draw）で絵にする。数値と色だけを描く＝文字は描かない（指摘の番号の数字だけ）
 * ・幅が 800px 未満（iPhone など）の配置図は 2 倍の大きさで描く（--scale で変えられる）
 * ・指摘の番号と、配置図の中の位置（x・y・幅・高さ）を出力に出す（夜の定期タスクが再現の手がかりにする）
 * ・終了コード: 描けたら 0、配置図が無い・形が違うなら 1
 * 架空データも本番の接続先も使わない（本文の数値だけを使う）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, parseArgs, ensureDir } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const annotJs = path.join(here, '..', 'su-annot.js');
const outFile = path.resolve(args.out || 'check/out/annot.png');

let body = '';
try {
  if (args.event) { const ev = JSON.parse(fs.readFileSync(args.event, 'utf8')); body = String((ev.issue && ev.issue.body) || ''); }
  else if (args.body) body = fs.readFileSync(args.body, 'utf8');
  else { console.log('--body か --event を指定してください'); process.exit(1); }
} catch (e) { console.log('本文を読めません: ' + e.message); process.exit(1); }

/* 配置図の行を探す。Issue では受け口が付けた印（<!-- su-layout-v1 -->）の【最後のもの】の後ろだけを見る
   （報告の本文の中に偽の行や印を書かれても、受け口の印は本文より後ろにあるため）。印が無い時（送る前の本文そのもの）は、
   改行（\n）で区切った行のうち最後の「SU-LAYOUT-V1 」で始まる行を使う */
const MARK = '<!-- su-layout-v1 -->';
const at = body.lastIndexOf(MARK);
const lines = (at === -1 ? body : body.slice(at + MARK.length)).split('\n').map((l) => l.replace(/\r$/, ''));
const cand = lines.filter((l) => l.startsWith('SU-LAYOUT-V1 '));
const line = at === -1 ? cand[cand.length - 1] : cand[0];
if (!line || line.length > 120020) { console.log('配置図（SU-LAYOUT-V1）が本文にありません'); process.exit(1); }
let raw;
try { raw = JSON.parse(line.slice(13)); } catch (e) { console.log('配置図を読めません（JSON の形が違う）'); process.exit(1); }

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let code = 1;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>');
  await page.addScriptTag({ content: fs.readFileSync(annotJs, 'utf8') });
  const r = await page.evaluate(([L, scale]) => {
    const c = window.SUAnnot.clean(L);
    if (!c) return { ok: false };
    const s = scale > 0 ? scale : (c.w < 800 ? 2 : 1);
    const cv = document.getElementById('c');
    if (!window.SUAnnot.draw(cv, c, s)) return { ok: false };
    return { ok: true, w: c.w, h: c.h, rects: c.r.length, marks: c.m, png: cv.toDataURL('image/png') };
  }, [raw, Number(args.scale || 0)]);
  if (!r.ok) console.log('配置図の形が違うため描けません');
  else {
    ensureDir(path.dirname(outFile));
    fs.writeFileSync(outFile, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(`配置図: 幅${r.w}×高さ${r.h}（CSS px）・四角 ${r.rects}個 → ${path.relative(process.cwd(), outFile)}`);
    for (const k of r.marks) console.log(`  指摘 ${k[0]}: x${k[1]} y${k[2]} 幅${k[3]} 高さ${k[4]}`);
    code = 0;
  }
} finally { await browser.close(); }
process.exit(code);
