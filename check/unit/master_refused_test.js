/* 入居者マスタの GAS が中身を見て断った保存（2026-10-17）を、画面が理由つきで見せる試験。
   GAS（非公開の gas/master.gs）は、氏名が空・項目が少なすぎる・壊れた記録の控えを残せない時に
   'refused: <理由>' で断る（1文字も書かない）。画面がこれを取り直しの確認へ回すと、
   「サーバー側にも入っていない。もう一度お試しください」とだけ出て、理由が伝わらなかった（反証レビュー 2026-10-17 中）。
   守りたいこと:
     A 入居者マスタ: 'refused:' の断りは、取り直しへ進まず、理由をそのまま見せて止まる（conflict より前で判定）
     B 入居調整: お名前が空の案件は、入居者マスタへ送る前に止める（送ってから「登録確認待ち」で止まらない）
   ★画面の本物の関数を切り出して動かす。
   実行: node check/unit/master_refused_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
const AF = fs.readFileSync(path.join(ROOT, 'admission-flow.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

console.log('— A 入居者マスタ —');
{
  const i = RM.indexOf("var rf=m0.indexOf('refused:');"), j = RM.indexOf("if(m0.indexOf('conflict')>=0){", i);
  t('★A refused の判定がある', i > 0);
  t('★A refused の判定は conflict の判定より前', i > 0 && j > i);
  const seg = RM.slice(i, j);
  t('★A refused の時は理由を見せて return（取り直しへ進まない）', /alert\([^;]*m0\.slice\(rf\+8\)\.trim\(\)\);\s*return;/.test(seg), seg.slice(0, 300));
  /* 判定の部分だけを動かす */
  const shown = [];
  const box = { alert: m => shown.push(m), setSync: () => {}, String };
  vm.createContext(box);
  vm.runInContext('function h(e){ var m0=String((e&&e.message)||e);' + seg + ' return "next"; }; this.h=h;', box);
  t('A 理由の文が利用者に出る', box.h(new Error('refused: 氏名が空の保存は受け付けません')) === undefined && /氏名が空の保存は受け付けません/.test(shown[0]) && !/refused:/.test(shown[0]), shown);
  t('A refused でない失敗は従来どおり先へ進む', box.h(new Error('通信失敗')) === 'next');
  t('A conflict は従来どおり先へ進む（この後の conflict の判定へ）', box.h(new Error('conflict')) === 'next');
}
console.log('\n— B 入居調整 —');
{
  const i = AF.indexOf('function sendMasterRecord(c, adm) {'), seg = AF.slice(i, i + 600);
  t('★B お名前が空なら msRec を作る前・送る前に止める', /if \(!String\(\(c && c\.name\) \|\| ''\)\.trim\(\)\) \{ alert\([^)]*\); return Promise\.resolve\(\); \}\s*msRec = buildMasterRecord/.test(seg), seg.slice(0, 300));
  const box = { alerts: [], posted: 0 };
  box.alert = m => box.alerts.push(m);
  box.buildMasterRecord = () => ({ updatedAt: 'x' });
  box.masterPost = () => { box.posted++; return new Promise(() => {}); };
  box.touch = () => {}; box.renderView = () => {}; box.toast = () => {};
  vm.createContext(box);
  const L = AF.indexOf('function sendMasterRecord(c, adm) {');
  let d = 0, k = AF.indexOf('{', L), end = -1;
  for (; k < AF.length; k++) { if (AF[k] === '{') d++; else if (AF[k] === '}') { d--; if (!d) { end = k; break; } } }
  vm.runInContext('var msRec=null;' + AF.slice(L, end + 1) + '; this.s=sendMasterRecord;', box);
  box.s({ name: '  ' }, {});
  t('B お名前が空白だけでも送らず、案内を出す', box.posted === 0 && box.alerts.length === 1, box);
  box.s({ name: '架空花子' }, {});
  t('B お名前があれば送る（従来どおり）', box.posted === 1);
}
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
