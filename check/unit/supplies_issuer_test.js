/* 消耗品管理（supplies.html）の明細・料金表の発行者と、事務所向けの案内の言い換え（2026-10-09・監査10月版 #14・本人決定 2a）。
   1. 施設名・住所・電話は施設情報（SUFacility.office('施設')）から、担当者はこの端末の設定（spl_issuer）から。無い項目は行ごと出さない
   2. 何も無ければ欄ごと出さない（紙面は以前のまま）。文字は textContent
   3. 画面の案内に「GAS の setup」「GAS のエディタ」のような技術用語を出さない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'supplies.html'), 'utf8');
let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
}
function makeBox(facOffice, facData, store) {
  const els = {};
  const mkEl = () => ({ children: [], hidden: true, textContent: '', value: '', appendChild(c) { this.children.push(c); } });
  const box = {
    JSON, String,
    window: { SUFacility: facOffice === undefined ? undefined : { office: () => facOffice, get: () => facData } },
    localStorage: null,
    store: store || {},
    document: { createElement: () => ({ textContent: '' }) },
    $: id => (els[id] = els[id] || mkEl()),
    clearNode: n => { if (n) n.children = []; },
    txt: v => (v == null ? '' : String(v)),
    lsGet: k => (k in box.store ? box.store[k] : null),
    lsSet: (k, v) => { box.store[k] = String(v); },
    ISSUER_KEY: 'spl_issuer'
  };
  box.SUFacility = box.window.SUFacility;
  vm.createContext(box);
  vm.runInContext([cut('issuerStaff'), cut('issuerLines'), cut('renderIssuer'), cut('renderIssuerSettings'), cut('onSaveIssuer')].join('\n'), box);
  box.els = els;
  return box;
}

console.log('\n— 1. 発行者の行 —');
{
  const b = makeBox({ name: '架空', formalName: '有料老人ホーム 架空', address: '架空市1-2-3', tel: '000-000-0000' }, { facilityName: '架空' }, { spl_issuer: JSON.stringify({ staff: '架空 花子' }) });
  t('施設の正式名・住所・TEL・担当の順', b.issuerLines().join('|') === '有料老人ホーム 架空|架空市1-2-3|TEL 000-000-0000|担当：架空 花子', b.issuerLines());
  b.renderIssuer('billIssuer');
  t('明細の欄に4行・出す', b.els.billIssuer.children.length === 4 && b.els.billIssuer.hidden === false, b.els.billIssuer);
  const b2 = makeBox({ name: '架空', formalName: '', address: '', tel: '000-000-0000' }, { facilityName: '架空ホーム' }, {});
  t('住所が無ければ住所の行は出さない・担当が空なら担当の行も出さない・正式名が無ければ施設名', b2.issuerLines().join('|') === '架空ホーム|TEL 000-000-0000', b2.issuerLines());
  const b3 = makeBox(undefined, null, {});
  b3.renderIssuer('sheetIssuer');
  t('施設情報も担当も無ければ欄ごと出さない（紙面は以前のまま）', b3.issuerLines().length === 0 && b3.els.sheetIssuer.hidden === true, b3.els.sheetIssuer);
}

console.log('\n— 2. 担当者の保存 —');
{
  const b = makeBox({ name: '', formalName: '', address: '', tel: '' }, {}, {});
  b.$('issuerStaff').value = '  架空 次郎  ';
  b.onSaveIssuer();
  t('前後の空白を落として spl_issuer に保存', JSON.parse(b.store.spl_issuer).staff === '架空 次郎', b.store);
  t('保存した担当者が印刷される内容に出る', /担当：架空 次郎/.test(b.els.issuerPreview.textContent), b.els.issuerPreview.textContent);
  b.$('issuerStaff').value = 'x'.repeat(80);
  b.onSaveIssuer();
  t('40字までに切る', JSON.parse(b.store.spl_issuer).staff.length === 40, '');
  const bad = makeBox(undefined, null, { spl_issuer: '{壊れた' });
  t('壊れた控えでも例外を出さず空として扱う', bad.issuerStaff() === '', '');
}

console.log('\n— 3. 紙面と案内 —');
t('明細と料金表の両方に発行者の欄がある（最初は hidden）', /<div class="issuer" id="billIssuer" hidden><\/div>/.test(src) && /<div class="issuer" id="sheetIssuer" hidden><\/div>/.test(src), '');
t('明細と料金表を作る時に発行者の欄を入れる', /\$\('billDate'\)\.textContent = [^\n]+\n\s*renderIssuer\('billIssuer'\);/.test(src) && /\$\('sheetDate'\)\.textContent = [^\n]+\n\s*renderIssuer\('sheetIssuer'\);/.test(src), '');
t('★入居者ごとに改ページで刷る時は、各人の紙に発行者の欄を入れる（上の1か所は隠す）', /var iss = issuerLines\(\);[\s\S]{0,200}sec\.appendChild\(ib\);/.test(cut('renderBillByResident')) && /if \(!on\) \$\('billIssuer'\)\.hidden = true; else renderIssuer\('billIssuer'\);/.test(cut('setBillFlat')), '');
t('担当者の欄は役職名を入れる運用と分かる（個人の氏名は入れない・本人決定）', /担当者（役職名。空なら印刷しない）/.test(src) && /個人の氏名は入れない/.test(src), '');
t('施設情報の部品を読み込む', /<script src="su-facility\.js\?v=[^"]+"><\/script>/.test(src), '');
const visible = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
t('画面の案内に「GAS の setup」「GAS のエディタ」「GAS の新しい版」を出さない', !/GAS の setup|GAS のエディタ|GAS の新しい版/.test(visible), (visible.match(/GAS の[^。'"]{0,20}/g) || []).slice(0, 5));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
