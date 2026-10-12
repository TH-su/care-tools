/* 家族構成図（genogram.html）のクラウド同期設定の初回の案内の試験（2026-10-12・監査10月版 v2 家族構成図 第2手）。
   守ること:
     1. 設定の画面の先頭に、職員が端末ごとにすること（URL と合言葉を受け取る→貼る→接続テスト）の3ステップがある
     2. GAS を作る手順は「管理者が施設で最初に1回だけ」と分かる。合言葉の名前（GENOGRAM_TOKEN）も案内に出す
     3. 設定済みの端末では管理者向けの準備（①）を閉じて開き、未設定なら開いて開く
     4. GAS のコードの写し（GAS_SCRIPT_CODE）とコピーのボタンは残っている
   実行: node check/unit/genogram_first_guide_test.js（GENO_HTML で別の genogram.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.GENO_HTML || path.join(__dirname, '..', '..', 'genogram.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}

console.log('\n— 1・2. 案内の中身 —');
const g = (/<div class="setup-first" id="cfgFirstGuide">([\s\S]*?)<\/div>/.exec(src) || [, ''])[1];
const steps = (g.match(/<li>/g) || []).length;
t('★設定の画面に職員向けの初回の案内がある（3ステップ）', steps === 3, steps);
t('受け取る→貼る→接続テストの順', /受け取ります[\s\S]*貼り付けます[\s\S]*接続テスト/.test(g));
t('接続設定でまとめて設定した端末は入れなくてよいと分かる', /接続設定の画面でまとめて設定した端末には、もう入っています/.test(g));
t('合言葉の誤りの時に、GAS 側の合言葉（GENOGRAM_TOKEN）も確かめると分かる', /GENOGRAM_TOKEN/.test(g));
t('★案内は管理者向けの準備（①）より前にある', src.indexOf('id="cfgFirstGuide"') > 0 && src.indexOf('id="cfgFirstGuide"') < src.indexOf('id="cfgAdminSetup"'));
t('★①は「管理者が施設で最初に1回だけ」と分かる', /id="cfgAdminSetup"[^>]*>\s*<summary>[\s\S]*?管理者が施設で最初に1回だけ[\s\S]*?<\/summary>/.test(src));

console.log('\n— 3. 設定済みかどうかで①の開き方を変える —');
function run(configured) {
  const els = { cfgGasUrl: { value: '' }, cfgGasToken: { value: '' }, cloudModal: { hidden: true }, cfgResult: { hidden: false }, cfgAdminSetup: { open: true } };
  const box = { $: id => els[id], CloudSync: { getCfg: () => (configured ? { gasUrl: 'https://script.google.com/macros/s/X/exec', gasToken: 't' } : {}), isConfigured: () => configured } };
  vm.createContext(box); vm.runInContext(cut('openCloudModal'), box); box.openCloudModal();
  return els;
}
const a = run(true), b = run(false);
t('★設定済みの端末では①を閉じて開く', a.cfgAdminSetup.open === false && a.cloudModal.hidden === false);
t('★未設定の端末では①を開いて開く', b.cfgAdminSetup.open === true && b.cloudModal.hidden === false);
t('入っている URL・合言葉は今までどおり入力欄に出す', a.cfgGasUrl.value.indexOf('script.google.com') > 0 && a.cfgGasToken.value === 't');

console.log('\n— 4. 既存の部品 —');
t('GAS のコードの写しとコピーのボタンは残っている', /const GAS_SCRIPT_CODE = `/.test(src) && /id="btnCopyGas"/.test(src));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
