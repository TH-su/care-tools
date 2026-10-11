/* 職員マスタの詳細画面に「最終更新（更新元・日時）」を出す試験（2026-10-11 新設・監査10月版 第2版 職員マスタ）
   実行: node check/unit/staff_updatedby_test.js
   対象を差し替える: STAFF_HTML=/tmp/変異版.html node check/unit/staff_updatedby_test.js（変異試験用）
   守ること:
     ①サーバーが書く updatedBy（設定の「この端末の名前」）と updatedAt を「最終更新 端末名　YYYY/M/D HH:MM」で出す
     ②更新元が空なら日時だけ・どちらも無い古い行は今までどおり「職員ID／版」だけ・壊れた日時は出さない
     ③保存に成功した時は手元で更新元と日時を入れて出す（確かめ中は入れない）。書類の追加・削除も同じ
     ④見出しの下の行は全部 dtMetaText を通す（textContent で出す）
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.STAFF_HTML || path.join(ROOT, 'staff-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }
function grab(name) {
  const i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('関数が見つかりません: ' + name);
  let d = 0, seen = false;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') { d++; seen = true; } else if (SRC[k] === '}') { d--; if (seen && d === 0) return SRC.slice(i, k + 1); }
  }
  throw new Error('終わりが見つかりません: ' + name);
}
const sb = { txt: (v) => (v === undefined || v === null ? '' : String(v)), cfgBy: '事務所PC', Date };
sb.loadCfg = () => ({ by: sb.cfgBy });
vm.createContext(sb);
vm.runInContext(['fmtUpdatedAt', 'dtMetaText', 'stampSavedRow'].map(grab).join('\n'), sb);

console.log('\n— 表示の文言 —');
t('更新元と日時を出す', sb.dtMetaText({ id: 'S001', rev: 3, updatedBy: '事務所PC', updatedAt: '2026-10-05T09:07:00+09:00' }).replace(/\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/, 'T') === '職員ID S001／版 3／最終更新 事務所PC　T');
t('更新元が空なら日時だけ', /^職員ID S001／版 3／最終更新 \d{4}\//.test(sb.dtMetaText({ id: 'S001', rev: 3, updatedBy: '', updatedAt: '2026-10-05T09:07:00+09:00' })));
t('どちらも無い古い行は今までどおり', sb.dtMetaText({ id: 'S001', rev: 3 }) === '職員ID S001／版 3');
t('日時が壊れていれば出さない', sb.dtMetaText({ id: 'S001', rev: 3, updatedBy: 'x', updatedAt: 'こわれた' }) === '職員ID S001／版 3');
t('行が無ければ「未登録」', sb.dtMetaText(null) === '未登録');
t('確かめ中などの添え書きは版の直後', /^職員ID S1／版 1（確かめ中）／最終更新/.test(sb.dtMetaText({ id: 'S1', rev: 1, updatedAt: '2026-10-05T00:00:00Z' }, '（確かめ中）')));
t('更新元の改行は空白にし40文字まで', sb.dtMetaText({ id: 'S1', rev: 1, updatedBy: 'a\nb' + 'x'.repeat(60), updatedAt: '2026-10-05T00:00:00Z' }).indexOf('\n') < 0
  && /最終更新 a bx{37}　/.test(sb.dtMetaText({ id: 'S1', rev: 1, updatedBy: 'a\nb' + 'x'.repeat(60), updatedAt: '2026-10-05T00:00:00Z' })));
t('日時の書き方 YYYY/M/D HH:MM', /^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(sb.fmtUpdatedAt('2026-10-05T09:07:00+09:00')) && sb.fmtUpdatedAt('') === '');

console.log('\n— 保存した時 —');
{
  const row = { id: 'S1', rev: 2, updatedBy: '古い端末', updatedAt: '2026-01-01T00:00:00Z' };
  sb.stampSavedRow(row);
  t('保存に成功したら更新元＝この端末の名前・日時＝今', row.updatedBy === '事務所PC' && Math.abs(Date.parse(row.updatedAt) - Date.now()) < 5000);
  sb.cfgBy = '';
  sb.stampSavedRow(row);
  t('端末の名前が空なら更新元も空（日時だけ出る）', row.updatedBy === '');
}

console.log('\n— つなぎ —');
t('見出しの下の行を書くのは全部 dtMetaText（未登録の1か所を除く）',
  (SRC.match(/\$\('dtMeta'\)\.textContent = /g) || []).length === (SRC.match(/\$\('dtMeta'\)\.textContent = dtMetaText\(/g) || []).length + 1
  && /\$\('dtMeta'\)\.textContent = '未登録';/.test(SRC));
t('保存に成功した3つの経路で手元の最終更新を入れる（確かめ中は入れない）',
  /if \(!unsure\) stampSavedRow\(nrow\);/.test(SRC) && /stampSavedRow\(row\);\n\s*\$\('dtMeta'\)\.textContent = dtMetaText\(row\);/.test(SRC)
  && /dt\.base = normRow\(nrow\);\n\s*stampSavedRow\(nrow\);/.test(SRC));
t('書類の追加・削除でも入れる', /filesJson = toArr\(row\.filesJson\);\n\s*stampSavedRow\(row\);/.test(SRC));
t('詳細を開いた時は保存されている値を出す', /\$\('dtMeta'\)\.textContent = dtMetaText\(row\);\n\s*setState\('dtState'/.test(SRC));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
