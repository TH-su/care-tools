/* 介護度の変更履歴の「記録した人」（2026-10-10 新設・監査10月版 第2版 フェイスシート 第1手）
   実行: node check/unit/care_history_changedby_test.js
   守ること:
     ①入居者マスタで介護度・認定期間が変わって保存した時の自動の履歴と、「＋履歴を追加」の行に changedBy（誰が）を載せる
     ②入居者マスタの詳細画面とフェイスシートの履歴に「記録した人 …」を出す（エスケープ・現在の行には出さない）
     ③紙には出さない（.clh-by を @media print で隠す）＝印刷のレイアウトは変えない
   ★氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
const FS = fs.readFileSync(path.join(ROOT, 'facesheet.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
}
const line = (src, re) => { const m = re.exec(src); if (!m) throw new Error('行が見つかりません: ' + re); return m[0]; };

console.log('\n— 1. 入居者マスタ：自動の履歴と「＋履歴を追加」に記録した人 —');
{
  const b = { Date, String, Array, editing: null, rmWho_: () => 'staff-a' };
  vm.createContext(b);
  vm.runInContext([line(RM, /var CLH_KEYS=[^\n]*/), cutF(RM, 'clhNorm_'), cutF(RM, 'clhSame_'), cutF(RM, 'clhOf_'), cutF(RM, 'clhEmpty_'), cutF(RM, 'todayISO'), cutF(RM, 'clhEntryFor_')].join('\n'), b);
  b.editing = { careLevel: '要介護1', careCertStart: '2025-04-01', careCertEnd: '2026-03-31', careLevelHistory: [] };
  const e = b.clhEntryFor_({ careLevel: '要介護2', careCertStart: '2025-10-01', careCertEnd: '2027-09-30' });
  t('介護度が変わった保存の自動の履歴に changedBy が入る', !!e && e.changedBy === 'staff-a' && e.value === '要介護1' && /自動記録/.test(e.note), e);
  b.rmWho_ = undefined;
  const e2 = b.clhEntryFor_({ careLevel: '要介護3' });
  t('誰がを取る関数が無い環境でも止まらない（空で入る）', !!e2 && e2.changedBy === '', e2);
  t('「＋履歴を追加」の行にも changedBy を入れる', /editing\.careLevelHistory\.unshift\(\{value:r\.careLevel\|\|'',certStart:'',certEnd:'',certDate:'',changedAt:todayISO\(\),changedBy:\(typeof rmWho_==='function'\)\?rmWho_\(\):'',note:''\}\)/.test(RM), '');
  t('入居者マスタの詳細画面の履歴に「記録した人」（エスケープ・現在の行は除く）', /\(\(!s\.__cur&&s\.changedBy\)\?'<span class="clh-by"> \/ 記録した人 '\+esc\(String\(s\.changedBy\)\.slice\(0,60\)\)\+'<\/span>':''\)/.test(RM), '');
}

console.log('\n— 2. フェイスシート：履歴に記録した人（画面だけ）—');
{
  const b = { String, Array, Math };
  vm.createContext(b);
  vm.runInContext([cutF(FS, 'esc'), cutF(FS, 'fmtJDate'), line(FS, /var CLH_KEYS=[^\n]*/), cutF(FS, 'clhNorm_'), cutF(FS, 'clhSame_'), cutF(FS, 'clhOf_'), cutF(FS, 'clhEmpty_'), cutF(FS, 'careHistHtml')].join('\n'), b);
  const r = { careLevel: '要介護2', careCertStart: '2025-10-01', careCertEnd: '2027-09-30',
    careLevelHistory: [{ value: '要介護1', certStart: '2025-04-01', certEnd: '2026-03-31', changedAt: '2025-10-01', note: '区分変更（自動記録）', changedBy: 'staff-a' },
                       { value: '要支援2', certStart: '2024-04-01', certEnd: '2025-03-31', changedAt: '2024-04-01', note: '', changedBy: '<b>x</b>' },
                       { value: '要支援1', certStart: '2023-04-01', certEnd: '2024-03-31', changedAt: '2023-04-01' }] };
  const h = b.careHistHtml(r);
  t('記録した人が履歴の行に出る', /<span class="clh-by"[^>]*> \/ 記録した人 staff-a<\/span>/.test(h), h.slice(0, 300));
  t('記録した人はエスケープして出す', h.indexOf('<b>x</b>') < 0 && h.indexOf('記録した人 &lt;b&gt;x&lt;/b&gt;') >= 0, '');
  t('記録した人の無い古い行には何も足さない', (h.match(/class="clh-by"/g) || []).length === 2, (h.match(/class="clh-by"/g) || []).length);
  t('現在の行（先頭）には出さない', h.split('logline')[1].indexOf('clh-by') < 0, h.split('logline')[1].slice(0, 200));
}

console.log('\n— 3. 紙には出さない —');
t('フェイスシート：.clh-by を @media print で隠す', /@media print\{\.clh-by\{display:none !important\}\}/.test(FS), '');
t('入居者マスタ：.clh-by を @media print で隠す', /@media print\{\.clh-by\{display:none !important\}\}/.test(RM), '');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
