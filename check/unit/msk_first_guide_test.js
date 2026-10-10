/* 申送ビューア 未接続の初回の案内（moushiokuri-viewer.html）のテスト（2026-10-10 新設・監査10月版 第2版 申送ビューア 第2手）
   実行: node check/unit/msk_first_guide_test.js
   対象を差し替える: MSK_HTML=/tmp/変異版.html node check/unit/msk_first_guide_test.js（変異試験用）

   守ること:
     ①案内は既定で隠れていて（hidden）、接続先と合言葉の両方がそろうまでだけ出る
     ②案内に接続設定（connection-settings.html）へのリンクと3つの手順がある・印刷には出さない
     ③起動時・保存の後・別のタブで接続設定が変わった時（storage）に出し入れを合わせる
     ④案内は読むだけで、接続設定（msk_cfg）を書かない
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}

console.log('\n— 案内の中身（HTML）—');
const gm = /<div[^>]*id="cfgGuide"[^>]*>([\s\S]*?)<\/ol>\s*<\/div>/.exec(SRC);
t('案内の箱がある', !!gm);
const tag = gm ? /<div[^>]*id="cfgGuide"[^>]*>/.exec(gm[0])[0] : '';
const body = gm ? gm[1] : '';
t('既定は hidden（接続済みの端末で一瞬でも出さない）', /\shidden(\s|>|=)/.test(tag), tag);
t('印刷に出さない（noprint）', /class="[^"]*\bnoprint\b/.test(tag), tag);
t('接続設定の画面へのリンクがある', /<a\s+href="connection-settings\.html"/.test(body));
t('手順は3つ', (body.match(/<li\b/g) || []).length === 3, (body.match(/<li\b/g) || []).length);
t('現場の端末には設定しない旨がある', body.indexOf('現場の端末には設定しません') >= 0);
t('「控えから戻す」を案内する（接続設定画面のボタン名と同じ）', body.indexOf('「控えから戻す」') >= 0);
const scrCfg = SRC.indexOf('id="scr-cfg"'), cfgCard = SRC.indexOf('id="cfgUrl"'), gpos = SRC.indexOf('id="cfgGuide"');
t('案内は設定タブの中・接続設定の欄より上', scrCfg >= 0 && scrCfg < gpos && gpos < cfgCard, [scrCfg, gpos, cfgCard]);

console.log('\n— 出し入れ（mskGuide_ を実際に動かす）—');
function make(store) {
  const el = { hidden: true };
  const writes = [];
  const sb = {
    LS_CFG: 'msk_cfg',
    $: id => (id === 'cfgGuide' ? el : null),
    lsGet: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    lsSet: (k, v) => writes.push([k, v])
  };
  vm.createContext(sb);
  vm.runInContext(grabFn('loadCfg') + '\n' + grabFn('mskGuide_'), sb);
  return { sb, el, writes };
}
{
  const e = make({});
  e.sb.mskGuide_();
  t('設定が無い → 出す', e.el.hidden === false);
  t('案内は設定を書かない', e.writes.length === 0, e.writes);
}
{
  const e = make({ msk_cfg: JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: '' }) });
  e.sb.mskGuide_();
  t('URL だけ（合言葉が空）→ 出す', e.el.hidden === false);
}
{
  const e = make({ msk_cfg: JSON.stringify({ url: '', token: 'k' }) });
  e.sb.mskGuide_();
  t('合言葉だけ（URL が空）→ 出す', e.el.hidden === false);
}
{
  const e = make({ msk_cfg: JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'k' }) });
  e.el.hidden = false;
  e.sb.mskGuide_();
  t('両方そろう → 隠す', e.el.hidden === true);
}
{
  const e = make({ msk_cfg: '{壊れた' });
  e.sb.mskGuide_();
  t('設定が壊れている → 出す（起動を止めない）', e.el.hidden === false);
}
{
  const sb = { $: () => null, loadCfg: () => { throw new Error('呼ばれてはいけない'); } };
  vm.createContext(sb);
  vm.runInContext(grabFn('mskGuide_'), sb);
  let ok = true;
  try { sb.mskGuide_(); } catch (err) { ok = false; }
  t('案内の箱が無い画面でも落ちない', ok);
}

console.log('\n— 呼ぶ場所 —');
const saveH = (() => {
  const i = SRC.indexOf("$('cfgSave').addEventListener('click'");
  if (i < 0) return '';
  const e = scanBlock(SRC, i, '{', '}');
  return SRC.slice(i, e + 1);
})();
t('保存の後に呼ぶ（saveCfg の後）', saveH.indexOf('saveCfg(') >= 0 && saveH.indexOf('mskGuide_()') > saveH.indexOf('saveCfg('));
const boot = SRC.indexOf("goto('scr-cfg', false);\n    $('cfgInfo').textContent");
const bootCall = SRC.lastIndexOf('\n  mskGuide_();\n', boot);   // 行の頭の単独の呼び出し（storage の中の呼び出しは数えない）
t('起動時に、未接続の分岐より前で呼ぶ', boot > 0 && bootCall > 0 && boot - bootCall < 600, [boot, bootCall]);
t('別のタブで msk_cfg が変わった時（storage）に呼ぶ',
  /addEventListener\('storage',\s*function\(e\)\{[^}]*e\.key === LS_CFG\)\s*mskGuide_\(\)/.test(SRC));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
