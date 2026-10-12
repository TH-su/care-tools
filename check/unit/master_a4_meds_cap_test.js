/* 入居者マスタの A4 様式で、薬剤情報（定期）の列の幅の上限を守る試験（2026-10-12・監査10月版 第3版 9）。
   守ること:
     1. 薬剤の列は「いちばん長い1剤の行」に合わせて伸びる（flex-basis:auto）が、上限は 55%
        （70% だと長い1剤の方で薬備考・問題行動が各24mm＝1行7文字まで細り、頓服の指示が薬名の途中で割れた）
     2. 下限 36%（従来の幅）は変えない・薬の欄の3列は文字を切らずに折り返す（overflow で隠す前提の高さは a4Fit が持つ）
   実行: node check/unit/master_a4_meds_cap_test.js（MASTER_HTML で別の resident-master.html を当てられる） */
'use strict';
const fs = require('fs'), path = require('path');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const rule = /\.a4s \.a4-meds>div:first-child\{([^}]*)\}/.exec(src);
t('薬剤の列の CSS がある', !!rule);
const body = rule ? rule[1] : '';
const mx = /max-width:(\d+)%/.exec(body), mn = /min-width:(\d+)%/.exec(body);
t('上限は 55%（右の2列を1行10文字以上に保つ）', mx && mx[1] === '55', mx && mx[1]);
t('下限は 36%（従来の幅）のまま', mn && mn[1] === '36', mn && mn[1]);
t('上限は下限より大きい', mx && mn && +mx[1] > +mn[1]);
t('中身の長さに合わせて伸びる形（flex:0 1 auto）のまま', /flex:0 1 auto/.test(body));
t('薬剤情報は1剤1行のまま（pre-wrap の自由記述を esc して出す）', /■薬剤情報（定期）■<\/span><div class="a4-free" style="padding:0">'\+esc\(r\.medsRegular\|\|''\)/.test(src));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
