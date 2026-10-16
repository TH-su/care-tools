/* 写しの見比べ（shadow-check）の結果の文を、押したボタンのすぐ下にも出す（2026-10-16 新設）。
   守りたいこと:
     A 下の方のボタン（v-main の中）を押した後の結果は、最上部の欄と、そのボタンの並びのすぐ下の両方に出る
     B 空の文（msg('')）は、近くの写しも消す
     C 最上部の「見比べ直す」など v-main の外のボタンでは、近くの写しを出さない（最上部の欄だけ）
     D 近くの写しは読み上げない（aria-hidden）・最上部の欄は role=alert のまま
     E 画面の文言に丸囲み数字が残っていない（コメントは除く）
   ★画面の本物の msg を切り出して、偽物の DOM で動かす。
   実行: node check/unit/shadow_check_msg_near_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const JS = fs.readFileSync(path.join(ROOT, 'shadow-check.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'shadow-check.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const i0 = JS.indexOf('  var msgAnchor = null;'), i1 = JS.indexOf('  function view(name)');
const SEG = JS.slice(i0, i1);
t('msg と msgAnchor の区間を切り出せる', i0 > 0 && i1 > i0 && /function msg\(text, kind\)/.test(SEG));

/* 偽物の DOM: 要素は parentNode・children・closest を持つだけ */
function el(id, cls, parent) {
  const e = { id, className: cls || '', textContent: '', children: [], parentNode: null };
  Object.defineProperty(e, 'nextSibling', { get: () => { const q = e.parentNode; if (!q) return null; return q.children[q.children.indexOf(e) + 1] || null; } });
  e.closest = sel => { for (let x = e; x; x = x.parentNode) { if (sel === '#' + x.id || sel === '.' + x.className || sel === x.tag) return x; } return null; };
  if (parent) { e.parentNode = parent; parent.children.push(e); }
  return e;
}
function mkPage() {
  const body = el('body');
  const top = el('msg', 'msg', body);
  const head = el('head', 'hd', body); const headActs = el('ha', 'acts', head);
  const main = el('v-main', '', body);
  const near = el('msg-near', 'msg', main);
  const sec = el('sec', 'cd', main);
  const acts1 = el('a1', 'acts', sec); const btn1 = el('b-live-shift', '', acts1); btn1.tag = 'button';
  const acts2 = el('a2', 'acts', sec); const btn2 = el('b-lock-on', '', acts2); btn2.tag = 'button';
  const btnTop = el('b-reload', '', headActs); btnTop.tag = 'button';
  function sib(n) { const p = n.parentNode; if (!p) return null; const k = p.children.indexOf(n); return k > 0 ? p.children[k - 1] : null; }
  for (const n of [near]) Object.defineProperty(n, 'previousElementSibling', { get: () => sib(n) });
  const all = { msg: top, 'msg-near': near };
  let handler = null;
  const env = {
    $: id => all[id] || null,
    document: { addEventListener: (ev, fn) => { if (ev === 'click') handler = fn; } }
  };
  function insertBefore(parent) { parent.insertBefore = (node, ref) => { const op = node.parentNode; if (op) op.children.splice(op.children.indexOf(node), 1); const k = ref ? parent.children.indexOf(ref) : parent.children.length; parent.children.splice(k < 0 ? parent.children.length : k, 0, node); node.parentNode = parent; }; }
  [body, main, sec, head].forEach(insertBefore);
  vm.createContext(env);
  vm.runInContext(SEG + '\nthis.__msg = msg;', env);
  return { env, top, near, sec, acts1, acts2, btn1, btn2, btnTop, click: b => handler({ target: b }) };
}

{
  const p = mkPage();
  p.click(p.btn1);
  p.env.__msg('先に「切り替え前の点検をする」を押して、勤務表がそろっていることを確かめてください。', 'warn');
  const k = p.sec.children.indexOf(p.near);
  t('★A 下のボタンを押した後の断りの文が、最上部の欄に出る', /先に「切り替え前の点検をする」/.test(p.top.textContent) && p.top.className === 'msg warn');
  t('★A 同じ文が、押したボタンの並びのすぐ下にも出る', p.near.parentNode === p.sec && p.sec.children[k - 1] === p.acts1 && p.near.textContent === p.top.textContent && p.near.className === 'msg warn', { k, cls: p.near.className });
  p.click(p.btn2);
  p.env.__msg('Supabase 側の勤務表を厳格モードにしました。', 'ok');
  const k2 = p.sec.children.indexOf(p.near);
  t('A 別のボタンを押すと、近くの写しはそのボタンの下へ動く（1つだけ）', p.sec.children[k2 - 1] === p.acts2 && p.sec.children.filter(x => x.id === 'msg-near').length === 1 && p.near.className === 'msg ok');
  p.env.__msg('');
  t('★B 空の文は、最上部と近くの写しの両方を消す', p.top.textContent === '' && p.near.textContent === '');
}
{
  const p = mkPage();
  p.click(p.btnTop);
  p.env.__msg('読み込めませんでした: テスト');
  t('★C v-main の外のボタン（見比べ直す）では、近くの写しを出さない', p.top.textContent !== '' && p.near.textContent === '');
  p.click(null);
  p.env.__msg('どこも押していない時の文');
  t('C ボタン以外（何も押していない・非同期の後）の文は、近くの写しを出さない', p.near.textContent === '');
}
t('★D 近くの写しは読み上げない（aria-hidden）・v-main の中にある', /<section id="v-main" hidden>\s*<!--[^>]*-->\s*<p id="msg-near" class="msg" aria-hidden="true"><\/p>/.test(HTML));
t('D 最上部の欄は role=alert のまま', /<div id="msg" class="msg" role="alert" aria-live="assertive"><\/div>/.test(HTML));
{
  const visible = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/<head>[\s\S]*?<\/head>/, '');
  const jsStrings = (JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').match(/'[^'\n]*'/g) || []).join('\n');
  t('★E 画面の文言（コメント以外）に丸囲み数字が無い', !/[①-⑳]/.test(visible) && !/[①-⑳]/.test(jsStrings), (visible.match(/.{0,20}[①-⑳].{0,20}/) || jsStrings.match(/.{0,20}[①-⑳].{0,20}/) || [''])[0]);
}
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
