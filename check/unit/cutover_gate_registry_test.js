/* 写しの見比べの「切り替える／本番にする」ボタンが、切り替える前の確かめの表（GATE・su-cutover-gate.js の KINDS）に
   登録されているかの試験（2026-11-13 代表者の指示・cross 6）
   実行: node check/unit/cutover_gate_registry_test.js
   守りたいこと:
     A shadow-check.html の切り替えのボタン（id が b-…-cut か b-live…）は全部、GATE に登録されているか、
       下の「表を付けない種類」に理由つきで載っている。どちらにも無いボタンを足すと落ちる（足す時はどちらかに決めて足す）
     B GATE の種類と su-cutover-gate.js の KINDS は同じ組（片方だけに足すと落ちる）
     C GATE に登録した種類は、表の置き場所（gate-種類）がボタンより前にあり、ボタンの処理が切り替えの時に gatePass(種類) を通る
     D shadow-check.js の切り替えの処理（run…Op）は全部、どれかの切り替えのボタンから呼ばれる（ボタンの名前の付け方が違っても見落とさない）
     E この試験そのものが効くこと: GATE から排泄ケア記録を抜いた写しでは、A・B が落ちる
   読むのは公開の2つのファイルだけ。通信なし。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'shadow-check.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'shadow-check.html'), 'utf8');
const G = require(path.join(ROOT, 'su-cutover-gate.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }

/* 表を付けない切り替えのボタン（2026-11-13 時点・依頼の外）。ここに足すのは、表を付けないと決めた時だけ（理由を書く） */
const NOT_GATED = {
  'b-live': '週間計画・ワークスケジュール（kv の本番化・切り替え前の点検が別にある・依頼の外）',
  'b-live-shift': '勤務表（kv の本番化・切り替え前の点検が別にある・依頼の外）',
  'b-sup-cut': '備品（受け口の確かめと1日1つだけ・依頼の外）',
  'b-sa-cut': 'シフト分析（1日1つだけ・依頼の外）',
  'b-geno-cut': '家族構成図（1日1つだけ・依頼の外）',
  'b-doc-stf-cut': '添付書類・職員マスタ（1日1つだけ・依頼の外）',
  'b-doc-adm-cut': '添付書類・入居調整（1日1つだけ・依頼の外）'
};

function gateOf(src) {
  const m = /var GATE = (\{[^\n]*\});/.exec(src);
  if (!m) return null;
  const o = {};
  m[1].replace(/([a-z]+): '([a-z-]+)'/g, (_, k, id) => { o[k] = id; return ''; });
  return o;
}
function cutButtons(html) {
  const out = [];
  html.replace(/<button[^>]*\bid="(b-[a-z-]+)"/g, (_, id) => { if ((/-cut$/.test(id) || /^b-live(-|$)/.test(id)) && out.indexOf(id) < 0) out.push(id); return ''; });
  return out.sort();
}
function fn(src, name) {
  const i = src.lastIndexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, seen = false, q = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && !d) return src.slice(i, k + 1); }
  }
  return '';
}
/* ボタン → クリックで呼ぶ処理の名前（run…Op か set…Mode） */
function handlerOf(src, id) {
  const re = new RegExp("\\$\\('" + id.replace(/-/g, '\\-') + "'\\)\\.addEventListener\\('click', function \\(\\) \\{([^\\n]*)\\}\\);");
  const m = re.exec(src);
  if (!m) return '';
  const h = /\b(run[A-Z][A-Za-z]*Op|set[A-Za-z]*Mode)\(/.exec(m[1]);
  return h ? h[1] : '';
}
/* 登録の確かめ。返す: 問題の一覧（空なら合格） */
function problems(src, html, kinds) {
  const out = [], gate = gateOf(src);
  if (!gate) return ['GATE が見つかりません'];
  const ids = Object.keys(gate).map((k) => gate[k]);
  cutButtons(html).forEach((id) => {
    const inGate = ids.indexOf(id) >= 0, skip = Object.prototype.hasOwnProperty.call(NOT_GATED, id);
    if (!inGate && !skip) out.push('A 未登録の切り替えのボタン: ' + id);
    if (inGate && skip) out.push('A 両方に載っている: ' + id);
  });
  const gk = Object.keys(gate).sort().join(), kk = Object.keys(kinds).sort().join();
  if (gk !== kk) out.push('B GATE と KINDS の種類が違う: GATE=' + gk + ' KINDS=' + kk);
  return out;
}

console.log('A 切り替えのボタンは全部、表に登録されているか、付けない理由が書いてある');
const btns = cutButtons(HTML);
t('切り替えのボタンを見つけた（今は13個）', btns.length === 13, btns);
const p = problems(SRC, HTML, G.KINDS);
t('未登録のボタンが無い・GATE と KINDS が同じ組', p.length === 0, p);
t('付けない種類の一覧に、もう無いボタンが残っていない', Object.keys(NOT_GATED).every((id) => btns.indexOf(id) >= 0), Object.keys(NOT_GATED).filter((id) => btns.indexOf(id) < 0));
t('付けない種類には理由が書いてある', Object.keys(NOT_GATED).every((id) => String(NOT_GATED[id]).length >= 4));

console.log('B 排泄ケア記録が登録されている（2026-11-13）');
const gate = gateOf(SRC);
t('GATE に hb（b-hb-cut）がある', gate && gate.hb === 'b-hb-cut', gate);
t('KINDS に hb（排泄ケア記録）がある', G.KINDS.hb === '排泄ケア記録');

console.log('C 登録した種類は、表の置き場所と押した時の確かめがある');
Object.keys(gate || {}).forEach((k) => {
  const id = gate[k], h = handlerOf(SRC, id), body = fn(SRC, h);
  const gi = HTML.indexOf('id="gate-' + k + '"'), bi = HTML.indexOf('id="' + id + '"');
  t(k + ': 表の置き場所（gate-' + k + '）がボタンより前', gi > 0 && gi < bi);
  t(k + ': ボタンの処理（' + (h || '見つからない') + '）が gatePass(\'' + k + '\') を通り、確認の窓より前', !!body && body.indexOf("gatePass('" + k + "')") > 0 && body.indexOf("gatePass('" + k + "')") < body.indexOf('confirm('));
});

console.log('D 切り替えの処理は全部、切り替えのボタンから呼ばれる');
const ops = (SRC.match(/async function run[A-Z][A-Za-z]*Op\(/g) || []).map((s) => s.replace('async function ', '').replace('(', ''));
const bound = btns.map((id) => handlerOf(SRC, id));
t('切り替えのボタンは全部、処理につながっている', bound.every((h) => !!h), btns.filter((id, i) => !bound[i]));
t('run…Op は全部、切り替えのボタンのどれかから呼ばれる', ops.length > 0 && ops.every((o) => bound.indexOf(o) >= 0), ops.filter((o) => bound.indexOf(o) < 0));

console.log('E この試験が効くこと（架空の写しで確かめる）');
{
  const noHb = SRC.replace(", hb: 'b-hb-cut' }", ' }');
  const kNoHb = Object.assign({}, G.KINDS); delete kNoHb.hb;
  t('写しを作れた（GATE から hb を抜いた）', noHb !== SRC && gateOf(noHb) && !gateOf(noHb).hb);
  const p1 = problems(noHb, HTML, kNoHb);
  t('GATE と KINDS の両方から hb を抜くと、未登録のボタン（b-hb-cut）で落ちる', p1.some((x) => /未登録の切り替えのボタン: b-hb-cut/.test(x)), p1);
  const p2 = problems(noHb, HTML, G.KINDS);
  t('GATE からだけ抜くと、GATE と KINDS の違いでも落ちる', p2.some((x) => /^B /.test(x)), p2);
  const newBtn = HTML.replace('</main>', '<button type="button" class="btn" id="b-zzz-cut" hidden>架空の切り替え</button></main>');
  t('架空の新しい切り替えのボタンを足すと落ちる', newBtn !== HTML && problems(SRC, newBtn, G.KINDS).some((x) => /b-zzz-cut/.test(x)));
}

console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
process.exitCode = fail ? 1 : 0;
