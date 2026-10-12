/* 共通部品の版の印（?v=）が画面ごとにばらけていないかの試験（2026-10-12・監査10月版 第3版 4）。
   守ること:
     1. テーマで直接作る画面では、su-facility.js・su-kv.js・su-kv-shadow.js・su-errors.js を読む ?v= が部品ごとに1種類だけ
        （ばらけると、古い印の画面を開いた端末が古い部品を使い続け、施設情報の新しい項目（apps など）を読めない。
         su-errors.js は 10/04 版に記録の口 note が無く、古い印の画面では保存・同期の失敗が記録に残らない＝2026-10-13 に足す）
     2. 正本の deploy.sh で作る画面（シフト作成・シフト分析・ワークスケジュール）は、正本の build スクリプトが
        公開中の画面から版を読む形なので、この試験では数えない（次の配信でそろう）
   実行: node check/unit/shared_version_test.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const DEPLOY_BUILT = ['shift-app.html', 'shift-analyzer.html', 'work-schedule.html'];
const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f) && DEPLOY_BUILT.indexOf(f) < 0);
for (const part of ['su-facility.js', 'su-kv.js', 'su-kv-shadow.js', 'su-errors.js']) {
  const re = new RegExp('<script src="' + part.replace(/\./g, '\\.') + '\\?v=([0-9A-Za-z._-]+)"', 'g');
  const seen = {};
  for (const p of pages) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    let m; while ((m = re.exec(src))) (seen[m[1]] = seen[m[1]] || []).push(p);
  }
  const vers = Object.keys(seen);
  t(part + ' を読む画面の版の印は1種類（' + (vers[0] || 'なし') + '・' + pages.filter(p => vers.some(v => seen[v].indexOf(p) >= 0)).length + '画面）', vers.length <= 1, seen);
}
t('正本の deploy.sh で作る画面は数えない（3画面）', DEPLOY_BUILT.every(f => fs.existsSync(path.join(ROOT, f))));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
