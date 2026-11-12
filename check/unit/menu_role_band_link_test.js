/* メニューの役割の帯の「ログインする」（2026-11-12 商用化の見直し）の試験。index.html の BAND と drawRole を切り出し、架空の document で動かす。
 * 確かめること: 帯の文そのものは変えない（本人承認 2026-10-29）／ログインしていない・確かめられない時だけリンクを足す／
 *   リンクの行き先は login.html?next=index.html／現場の端末ではリンクではなく QR の案内の文（ログインしていない時だけ）／
 *   ログイン中の役割（管理者・事務所・現場・確かめ中）では何も足さない／ログインの画面に現場の端末の QR の案内がある */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let ok = 0, ng = 0;
function t(name, cond, extra){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }

const bandSrc = (SRC.match(/  var BAND = \{[\s\S]*?\};\n/) || [''])[0];
const i = SRC.indexOf('  function drawRole(state) {');
const j = SRC.indexOf('\n  }\n', i);
const drawSrc = i >= 0 && j > i ? SRC.slice(i, j + 4) : '';
t('BAND と drawRole を切り出せる', !!bandSrc && !!drawSrc);

function run(state, field){
  const kids = [];
  const band = { textContent: '', hidden: true, attrs: {},
    setAttribute(k, v){ this.attrs[k] = v; },
    appendChild(n){ kids.push(n); return n; } };
  const document = {
    documentElement: { classList: { contains: (c) => c === 'is-field' && !!field } },
    getElementById: (id) => id === 'roleBand' ? band : null,
    createTextNode: (s) => ({ text: s }),
    createElement: (tag) => ({ tag, href: '', className: '', textContent: '' })
  };
  const ctx = vm.createContext({ document });
  vm.runInContext(bandSrc + drawSrc + '\ndrawRole(' + JSON.stringify(state) + ');', ctx);
  return { band, kids };
}

for (const [st, txt] of [['admin', '管理者としてログイン中'], ['office', '事務所としてログイン中'], ['field', '現場としてログイン中'], ['pending', 'ログインを確かめています…']]) {
  const r = run(st, false);
  t(st + ': 帯の文はそのまま・何も足さない', r.band.textContent === txt && r.kids.length === 0, r);
}
{
  const r = run('none', false);
  const a = r.kids.find((k) => k.tag === 'a');
  t('ログインしていない（事務所PC）: 帯の文はそのまま', r.band.textContent === 'ログインしていません');
  t('ログインしていない（事務所PC）: 「ログインする」のリンクを足す', !!a && a.textContent === 'ログインする');
  t('リンクの行き先はログインの画面（戻り先はメニュー）', !!a && a.href === 'login.html?next=index.html');
}
{
  const r = run('unsure', false);
  t('確かめられない（事務所PC）: リンクを足す', r.kids.some((k) => k.tag === 'a' && k.href === 'login.html?next=index.html'));
}
{
  const r = run('none', true);
  t('ログインしていない（現場の端末）: リンクではなく QR の案内の文', r.kids.length === 1 && !r.kids[0].tag && /端末登録の QR/.test(r.kids[0].text), r.kids);
}
{
  const r = run('unsure', true);
  t('確かめられない（現場の端末）: 何も足さない（ログインの記録はある）', r.kids.length === 0);
}
{
  const r = run('壊れた値', false);
  t('未知の値は「ログインしていません」に倒し、リンクを足す', r.band.textContent === 'ログインしていません' && r.kids.some((k) => k.tag === 'a'));
}
{
  const L = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
  const s = L.slice(L.indexOf('id="v-signedout"'), L.indexOf('</section>', L.indexOf('id="v-signedout"')));
  t('ログインの画面: 現場の端末は端末登録の QR でログインする案内がある', /端末登録の QR/.test(s) && /使える人の管理/.test(s));
}
console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
process.exit(ng ? 1 : 0);
