/* check/build-holidays-fixture.mjs — 内閣府の祝日の一覧（CSV・Shift_JIS）を取り直して、試験の材料 check/fixtures/holidays-jp-cao.csv（UTF-8・改行は LF）を作り直す（2026-11-25 新設）
 *
 * 実行: node check/build-holidays-fixture.mjs [取ってきた CSV のファイル]
 *   ファイルを渡さない時は内閣府の公開の一覧（https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv）を取りに行く。
 * 毎年2月ごろ（翌年の春分・秋分の日が官報に載った後）に回し、出た「最後の年」を kintai-holiday.js の CONFIRMED_THROUGH に書いて、
 * node check/unit/kintai_holiday_test.js が全部合格することを確かめる（法律が変わって合わない時は kintai-holiday.js の決まりを直す）。
 * 書くのは公開の資料（祝日の日付と名前）だけ。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'holidays-jp-cao.csv');
const SRC = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';

const arg = process.argv[2];
let buf;
if (arg) buf = fs.readFileSync(arg);
else {
  const res = await fetch(SRC);
  if (!res.ok) { console.log('取れませんでした（HTTP ' + res.status + '）'); process.exit(1); }
  buf = Buffer.from(await res.arrayBuffer());
}
const text = new TextDecoder('shift_jis').decode(buf).replace(/\r/g, '').trim();
const lines = text.split('\n');
if (lines[0] !== '国民の祝日・休日月日,国民の祝日・休日名称') { console.log('見出しが前と違います（形が変わったかもしれません）: ' + lines[0]); process.exit(1); }
const bad = lines.slice(1).filter((l) => !/^\d{4}\/\d{1,2}\/\d{1,2},[^,]+$/.test(l));
if (bad.length) { console.log('形の違う行が ' + bad.length + ' 行あります: ' + bad.slice(0, 3).join(' / ')); process.exit(1); }
fs.writeFileSync(OUT, lines.join('\n') + '\n');
const last = Math.max(...lines.slice(1).map((l) => +l.slice(0, 4)));
console.log('書きました: ' + path.relative(path.join(HERE, '..'), OUT) + '（' + (lines.length - 1) + ' 日・最後の年 ' + last + '）');
console.log('kintai-holiday.js の CONFIRMED_THROUGH を ' + last + ' にして、node check/unit/kintai_holiday_test.js を回してください。');
