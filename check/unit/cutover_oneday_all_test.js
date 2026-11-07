/* 写しの見比べの「切り替える」は、どの正本でも「1日1つまで」を確かめてから確認の窓を出す（2026-11-07）の試験
   実行: node check/unit/cutover_oneday_all_test.js
   守りたいこと:
     A 切り替えのボタンの処理（shadow-check.js の run*Op）は全部、切り替えの時だけ、最初の確認の窓より前に
       「1日1つまで」の確かめ（oneDayOk(種類) か、判定表ごと確かめる gatePass(種類)）を通る。種類の名前は自分の種類
     B 「写しの期間に戻す」の側には付けない（今日ほかを切り替えていても戻せる）
     C 備品・シフト分析・家族構成図の「本番にした」記録を、別の種類の切り替えで数え、同じ種類では数えない（su-cutover-gate.js の cutsToday）
   架空データのみ。通信なし。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const G = require(path.join(ROOT, 'su-cutover-gate.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'shadow-check.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }

function fn(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, seen = false, q = null;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    const c = SRC[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && !d) return SRC.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
}

/* 関数名 → 種類 */
const OPS = { runSupOp: 'sup', runSaOp: 'sa', runHbOp: 'hb', runDocOp: 'doc', runGenoOp: 'geno', runStfOp: 'stf', runAdmOp: 'adm', runTpOp: 'tp', runResOp: 'res' };

console.log('A 切り替えの時は、最初の確認の窓より前に「1日1つまで」を確かめる');
const found = (SRC.match(/async function run[A-Z][A-Za-z]*Op\(/g) || []).map((s) => s.replace('async function ', '').replace('(', ''));
t('切り替えのボタンの処理を全部知っている（新しく足した時はこの表にも足す）', found.length === Object.keys(OPS).length && found.every((f) => OPS[f]), found);
Object.keys(OPS).forEach((name) => {
  const k = OPS[name], body = fn(name);
  /* 添付書類だけ、種類（職員マスタ・入居調整）を kind、切り替えか戻すかを op で受ける */
  const cutAt = name === 'runDocOp' ? body.indexOf("if (op === 'cut') {") : body.indexOf("if (kind === 'cut') {");
  const elseAt = body.indexOf('} else {', cutAt);
  t(name + ': 切り替えの分かれ道がある', cutAt >= 0 && elseAt > cutAt);
  const cut = body.slice(cutAt, elseAt), back = body.slice(elseAt);
  const guard = Math.max(cut.indexOf("oneDayOk('" + k + "'"), cut.indexOf("gatePass('" + k + "')"));
  const conf = cut.indexOf('confirm(');
  t(name + ': 切り替えの側で自分の種類（' + k + '）の「1日1つまで」を確かめる', guard >= 0);
  t(name + ': その確かめは最初の確認の窓より前', guard >= 0 && conf > guard);
  t(name + ': 戻す側には付けない', back.indexOf('oneDayOk(') < 0 && back.indexOf('gatePass(') < 0);
});

console.log('B 確かめの中身（oneDayOk）');
const od = fn('oneDayOk');
t('記録を読めない時は進めない（false を返す）', /if \(!c \|\| c\.error \|\| !Array\.isArray\(c\.audit\)\)[^\n]*return false;/.test(od));
t('今日すでに別の正本を切り替えていれば進めない', /if \(done\.length\)[^\n]*return false;/.test(od));
t('数えるのは su-cutover-gate.js の cutsToday', od.indexOf('SUCutGate.cutsToday(c.audit, gateIn.today, kind)') >= 0);

console.log('C 備品・シフト分析・家族構成図の記録の数え方');
const day = '2026-11-07';
const at = '2026-11-07T01:00:00Z'; /* 日本時間 10:00 */
function row(ent) { return { at: at, entity: ent, entity_ids: ['live'], fields: [] }; }
t('備品を切り替えた日は、シフト分析の切り替えで「備品」と数える', JSON.stringify(G.cutsToday([row('sup_mode')], day, 'sa')) === '["備品"]');
t('備品を切り替えた日でも、備品自身の切り替え（やり直し）では数えない', G.cutsToday([row('sup_mode')], day, 'sup').length === 0);
t('シフト分析を切り替えた日は、家族構成図の切り替えで「シフト分析」と数える', JSON.stringify(G.cutsToday([row('sa_mode')], day, 'geno')) === '["シフト分析"]');
t('家族構成図を切り替えた日は、備品の切り替えで「家族構成図」と数える', JSON.stringify(G.cutsToday([row('geno_mode')], day, 'sup')) === '["家族構成図"]');
t('前の日の切り替えは数えない', G.cutsToday([{ at: '2026-11-06T01:00:00Z', entity: 'sup_mode', entity_ids: ['live'], fields: [] }], day, 'sa').length === 0);
t('写しの期間に戻した記録（live の無い記録）は数えない', G.cutsToday([{ at: at, entity: 'sup_mode', entity_ids: ['shadow'], fields: [] }], day, 'sa').length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
