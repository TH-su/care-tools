/* check/unit/run-all.mjs — 画面・共通部品の純関数の試験を全部回す（2026-10-08 新設）
 *
 *   node check/unit/run-all.mjs
 *
 * ・check/unit/*.js を1本ずつ別の node で実行する（試験どうしで状態を共有しない）
 * ・試験は公開されている画面・共通部品だけを読む。GAS の試験は公開しない方針なので、非公開の gas/tests に残し、
 *   毎朝の点検（fleet-check）で両方を回す
 * ・1本でも失敗（終了コード 0 以外・時間切れ）なら終了コード 1。試験が0本なら 2（空振りを成功にしない）
 * ・失敗した試験は、出力の終わり40行を出す（✗ の行が見えるように）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
if (!files.length) { console.log('試験が0本です（空振りを成功にしない）'); process.exit(2); }

let ng = 0;
const t0 = Date.now();
for (const f of files) {
  const s = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 180000, maxBuffer: 1 << 26 });
  const sec = ((Date.now() - s) / 1000).toFixed(1);
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) {
    const skip = /⏸ 省略/.test(out) ? '（省略）' : '';
    console.log(`✓ ${f}  ${sec}秒${skip}`);
  } else {
    ng++;
    const why = r.error ? (r.error.code === 'ETIMEDOUT' ? '時間切れ（180秒）' : String(r.error.message)) : `終了コード ${r.status}`;
    console.log(`✗ ${f}  ${sec}秒  ${why}`);
    console.log(out.split('\n').slice(-40).map((l) => '    ' + l).join('\n'));
  }
}
console.log(`\n試験 ${files.length} 本：成功 ${files.length - ng} 本／失敗 ${ng} 本（${((Date.now() - t0) / 1000).toFixed(0)}秒）`);
process.exit(ng ? 1 : 0);
