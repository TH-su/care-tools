/* 消耗品管理：保存していない入力の確かめ（2026-11-12 商用化の見直し 5）の試験。supplies.html の priceEditSnap〜beforeunload を切り出し、架空の document で動かす。
 * 確かめること: 開いた時のままの入力では聞かない／改定行・請求のメモ・プロファイル・分類・締めた月・入出庫の入力欄・「新しい品目」の窓に変更が残る時だけ聞く／
 *   「← メニュー」を押した時も同じ判定で聞き、「いいえ」で移らない・「はい」の直後の beforeunload では二重に聞かない／判定で例外が出ても聞かない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'supplies.html'), 'utf8');
let ok = 0, ng = 0;
function t(name, cond, extra){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }

const a = SRC.indexOf('function priceEditSnap(E) {');
const b = SRC.indexOf('function closeNew() {');
const code = a >= 0 && b > a ? SRC.slice(a, b) : '';
t('確かめの処理を切り出せる', !!code);
t('改定行を開いた時に控えを取る', /ST\.editSnap = priceEditSnap\(ST\.edit\);/.test(SRC));
t('請求のメモを開いた時に元の文を控える', /orig: txt\(r\.note\) \};/.test(SRC));
t('プロファイル・分類の写しを作った時に控える', /ST\.profSnap = JSON\.stringify\(ST\.profDraft\);/.test(SRC) && /ST\.catSnap = JSON\.stringify\(ST\.catDraft\);/.test(SRC));
t('beforeunload の登録はこの1か所だけ', (SRC.match(/addEventListener\('beforeunload'/g) || []).length === 1);

function make(over){
  const fields = Object.assign({ mvQty: '', mvNote: '', mvCost: '', mvResidentNo: '' }, (over && over.fields) || {});
  const els = {};
  Object.keys(fields).forEach((k) => { els[k] = { value: fields[k] }; });
  els.newDlg = { open: !!(over && over.dlgOpen), hasAttribute: () => false };
  els.ndSave = { disabled: !!(over && over.ndBusy) };
  const listeners = {};
  let answer = false, asked = 0;
  const ctx = {
    ST: Object.assign({ edit: null, editSnap: '', billEdit: null, profDraft: null, profSnap: '', catDraft: null, catSnap: '', closedDraft: null, closed: [] }, (over && over.st) || {}),
    ND_SNAP: over && over.ndSnap !== undefined ? over.ndSnap : null,
    newDlgSnap: () => (over && over.ndNow) || 'x',
    $: (id) => { if (over && over.throwOn === id) throw new Error('x'); return els[id] || null; },
    txt: (v) => (v === null || v === undefined) ? '' : String(v),
    setTimeout: () => 0,
    document: { addEventListener: (k, f) => { listeners['d:' + k] = f; } },
    window: { addEventListener: (k, f) => { listeners['w:' + k] = f; }, confirm: () => { asked++; return answer; } },
    JSON
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {
    ctx,
    unsaved: () => vm.runInContext('supUnsaved()', ctx),
    unload: () => { const ev = { prevented: false, preventDefault(){ this.prevented = true; }, returnValue: undefined }; listeners['w:beforeunload'](ev); return ev.prevented; },
    click: (yes, onLink, mods) => { answer = yes; const ev = Object.assign({ button: 0 }, mods || {}, { prevented: false, preventDefault(){ this.prevented = true; }, target: { closest: (sel) => onLink && sel === 'a.su-menu-back' ? {} : null } }); listeners['d:click'](ev); return ev.prevented; },
    asked: () => asked
  };
}

{
  const r = make();
  t('何も開いていない: 聞かない', !r.unsaved() && !r.unload());
  t('何も開いていない: 「← メニュー」でも聞かない', !r.click(false, true) && r.asked() === 0);
}
{
  const E = { cost: '100', unitPrice10: '12.0', billPrice: '', m1000: '20.0', effDate: '2099-01-01', reason: '仕入の変更', reasonText: '', basis: 'unit', editUnits: false, units: [{ name: '枚', per: 1 }], busy: false };
  const r = make({ st: { edit: E } });
  vm.runInContext('ST.editSnap = priceEditSnap(ST.edit);', r.ctx);
  t('改定行を開いただけ: 聞かない', !r.unsaved());
  r.ctx.ST.edit.cost = '120';
  t('改定行の仕入を変えた: 聞く', r.unsaved() && r.unload());
  r.ctx.ST.edit.cost = '100'; r.ctx.ST.edit.reasonText = 'メモ';
  t('改定行の理由の文を変えた: 聞く', r.unsaved());
  r.ctx.ST.edit.reasonText = ''; r.ctx.ST.edit.busy = true;
  t('改定行の登録中: 聞く', r.unsaved());
}
{
  const r = make({ st: { billEdit: { text: 'あ', orig: 'あ' } } });
  t('請求のメモを開いただけ: 聞かない', !r.unsaved());
  r.ctx.ST.billEdit.text = 'あい';
  t('請求のメモを書き換えた: 聞く', r.unsaved());
}
{
  const d = [{ id: 'p1', name: '架空', isDefault: true }];
  const r = make({ st: { profDraft: d, profSnap: JSON.stringify(d) } });
  t('プロファイルを開いただけ: 聞かない', !r.unsaved());
  r.ctx.ST.profDraft[0].name = '架空2';
  t('プロファイルの名前を変えた: 聞く', r.unsaved());
}
{
  const d = [{ id: 'c1', name: '紙類', order: '1' }];
  const r = make({ st: { catDraft: d, catSnap: JSON.stringify(d) } });
  t('分類を開いただけ: 聞かない', !r.unsaved());
  r.ctx.ST.catDraft.splice(0, 1);
  t('分類を消した（保存前）: 聞く', r.unsaved());
}
{
  const r = make({ st: { closed: ['2099-02', '2099-01'], closedDraft: ['2099-01', '2099-02'], closedSnap: '2099-01,2099-02' } });
  t('締めた月: 並びが違うだけなら聞かない', !r.unsaved());
  r.ctx.ST.closed = ['2099-01', '2099-02', '2099-04'];
  t('締めた月: ほかの端末が締めて読み直しただけなら聞かない（反証レビューの指摘）', !r.unsaved());
  r.ctx.ST.closedDraft.push('2099-03');
  t('締めた月を足した（保存前）: 聞く', r.unsaved());
}
for (const id of ['mvQty', 'mvNote', 'mvCost', 'mvResidentNo']) {
  const r = make({ fields: { [id]: '3' } });
  t('入出庫の ' + id + ' に入力が残る: 聞く', r.unsaved());
}
{
  const r = make({ fields: { mvQty: '   ' } });
  t('入出庫の数量が空白だけ: 聞かない', !r.unsaved());
}
{
  t('「新しい品目」の窓: 開いて入力が変わった時だけ聞く', make({ dlgOpen: true, ndSnap: 'a', ndNow: 'b' }).unsaved() && !make({ dlgOpen: true, ndSnap: 'a', ndNow: 'a' }).unsaved() && !make({ dlgOpen: false, ndSnap: 'a', ndNow: 'b' }).unsaved());
  t('「新しい品目」の窓: 登録中は聞く', make({ dlgOpen: true, ndSnap: 'a', ndNow: 'a', ndBusy: true }).unsaved());
}
{
  const r = make({ fields: { mvQty: '2' } });
  t('「← メニュー」・入力あり・「いいえ」: 移らない', r.click(false, true) === true && r.asked() === 1);
  t('「← メニュー」・入力あり・「はい」: 移る', r.click(true, true) === false && r.asked() === 2);
  t('「はい」の直後の beforeunload: 二重に聞かない', r.unload() === false);
  t('ほかのリンク・ボタンを押した時: 聞かない', r.click(false, false) === false && r.asked() === 2);
  t('Cmd・Ctrl を押しながら押した時（新しいタブで開く）: 聞かない（反証レビューの指摘）', r.click(false, true, { metaKey: true }) === false && r.click(false, true, { ctrlKey: true }) === false && r.asked() === 2);
}
{
  const r = make({ fields: { mvQty: '2' }, throwOn: 'mvQty' });
  t('判定で例外が出た時: 聞かない（画面を止めない）', !r.unsaved() && !r.unload());
}
console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
process.exit(ng ? 1 : 0);
