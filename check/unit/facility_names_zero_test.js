/* facility_names_zero_test.js — 公開リポジトリに施設名・事業所名・会社名を書かない（2026-10-16・販売ゲート2「固有データ0件」）
 *
 * 監査10月版（第3・第4版）の数え方と同じ5語を、公開リポジトリに入るテキストのファイル全部で数え、0件であることを固定する。
 * 施設の名前は画面では施設情報（facility-profile.json・配信の時に Secret から置く）から読む。コメント・見本・試験にも書かない。
 * ★この試験の中にも語そのものは書かない（つなぎ合わせて作る）。非公開の gas/ は .gitignore で公開に入らないので数えない。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const WORDS = [['ラウレア', 'ハレ'], ['いず', 'み'], ['せせ', 'らぎ'], ['シルバー', 'ユニックス'], ['silver', '-unix']].map(a => a.join(''));
const TEXT = /\.(html?|js|mjs|cjs|jsx|ts|css|md|json|ya?ml|txt|svg)$/i;

let pass = 0, fail = 0;
function t(name, ok, info) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

function trackedFiles() {
  try {
    return cp.execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  } catch (e) {
    return null;   // git の無い所では数えられない＝失敗にする（空振りを成功にしない）
  }
}

const files = trackedFiles();
t('公開リポジトリのファイルの一覧を取れる', Array.isArray(files) && files.length > 50, files && files.length);
const hits = [];
let scanned = 0;
(files || []).filter(f => TEXT.test(f)).forEach(f => {
  let s;
  try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
  scanned++;
  s.split('\n').forEach((line, i) => { WORDS.forEach(w => { if (line.includes(w)) hits.push(f + ':' + (i + 1) + '（語' + (WORDS.indexOf(w) + 1) + '）'); }); });
});
t('テキストのファイルを数えた（空振りでない）', scanned > 50, scanned);
t('施設名・事業所名・会社名（5語）が公開リポジトリに0件', hits.length === 0, hits.slice(0, 10));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
