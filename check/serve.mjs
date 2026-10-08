/* check/serve.mjs — 配布物をそのまま手元で開く（2026-10-04 新設）
 *   node check/serve.mjs [--port 8787] [--dir .]   → http://127.0.0.1:8787/
 * GitHub Pages と同じ「ファイルをそのまま返す」だけ。接続先の設定は端末の localStorage に入れるので、ここでは何もしない。
 */
import { parseArgs, startServer } from './lib.mjs';
const args = parseArgs(process.argv.slice(2));
const s = await startServer(args.dir || '.', Number(args.port || 8787));
console.log('開く: ' + s.url + '/   （止める: Ctrl+C）');
