/* 使い方の頁の「はじめて使う時（ログインと端末の登録）」（2026-11-12 商用化の見直し）の試験。
 * 確かめること: 節がいちばん上にある／事務所PCは Google・現場の端末は端末登録の QR／QR の決まり（1回だけ・10分・180日）が CLAUDE.md の決まりと同じ／
 *   10月の移行の頃の言い方と、現場の端末では保存しないという古い文（2026-11-08 A と食い違う）が残っていない */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const H = fs.readFileSync(path.join(ROOT, 'help.html'), 'utf8');
let ok = 0, ng = 0;
function t(name, cond){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name); } }
const s = H.indexOf('id="h-start"'), tr = H.indexOf('id="h-trouble"');
t('「はじめて使う時」の節がいちばん上（困った時より前）にある', s > 0 && tr > s);
const sec = H.slice(s, H.indexOf('</section>', s));
t('事務所PCは Google でログインする', /事務所PC[\s\S]*Google/.test(sec));
t('現場の端末は端末登録の QR を「使える人の管理」で出してもらう', /端末登録の QR/.test(sec) && /使える人の管理/.test(sec));
t('QR は1回だけ・10分、ログインは最後に使ってから180日で切れる（CLAUDE.md の決まりと同じ）', /1回だけ/.test(sec) && /10分/.test(sec) && /180日/.test(sec));
t('10月の移行の頃の言い方が残っていない', H.indexOf('2026年10月から新しくなりました') < 0);
t('「現場の端末では保存せず」の古い文が残っていない（2026-11-08 A）', H.indexOf('その端末では保存せず') < 0);
t('ログインの帯の節は残っている（帯のボタンの文言「ログインする」）', /id="h-login"/.test(H) && /<span class="key">ログインする<\/span>/.test(H));
console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
process.exit(ng ? 1 : 0);
