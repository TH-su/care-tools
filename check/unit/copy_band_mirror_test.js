/* copy_band_mirror_test.js — 切り替え後の Google 依存の片付け（2026-10-17 改善プロンプト第2弾の8・代表者の決定）
 * 守ること:
 *   1. 全支援俯瞰・週間計画俯瞰: 保存先が Supabase に切り替わっているキーを Google の写しから表示した時だけ「写しから表示中」の帯を出す。
 *      Supabase から読めたら消す。スイッチが切のキー（Google が本番）では出さない。印刷には出さない
 *   2. 写しの見比べ（shadow-check.js）: Google へ写す2か所（違う分を写す・日ごとを写し返す）に mirror の印。
 *      週間計画を写す時だけ、押した管理者のログインの証明を添える
 * 実物のソースから関数を切り出して動かす（写経しない）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
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
  throw new Error('閉じていません: ' + name);
}

for (const [file, label] of [['support-overview.html', '全支援俯瞰'], ['visit-overview.html', '週間計画俯瞰']]) {
  console.log('\n— ' + label + ' —');
  const src = read(file);
  function box(routedKeys, noSukv) {
    const el = { hidden: true };
    const b = { document: { getElementById: id => (id === 'copyBand' ? el : null) },
                window: noSukv ? {} : { SUKv: { routed: k => routedKeys.indexOf(k) >= 0 } } };
    b.SUKv = b.window.SUKv;
    vm.createContext(b);
    const pre = /\nvar copyUsed_ = false;\n/.test(src) ? 'var copyUsed_ = false;\n' : '';
    vm.runInContext(pre + cutF(src, 'showCopyBand_'), b);
    return { b, el };
  }
  function run(routedKeys, keys, fromCopy, noSukv) {
    const x = box(routedKeys, noSukv);
    x.b.showCopyBand_(keys, fromCopy);
    return x.el.hidden;
  }
  t('切り替え済みのキーを写しから表示 → 帯を出す', run(['care_schedule_v2'], ['care_schedule_v2'], true) === false);
  t('Supabase から読めた → 帯を消す', run(['care_schedule_v2'], ['care_schedule_v2'], false) === true);
  t('スイッチが切（Google が本番）→ 写しから読んでも出さない', run([], ['care_schedule_v2'], true) === true);
  t('su-kv が無い画面の状態 → 出さない（例外も出さない）', run([], ['care_schedule_v2'], true, true) === true);
  t('帯の部品は最初は隠れていて、読み上げの対象（role=status）', /<div id="copyBand" class="copy-band" role="status" aria-live="polite" hidden>/.test(src));
  t('印刷には出さない', /@media print \{ \.copy-band \{ display: none !important; \} \}/.test(src));
  t('隠れている時は場所を取らない（:not([hidden]) にだけ形を付ける）', /\.copy-band:not\(\[hidden\]\) \{/.test(src) && !/\.copy-band \{ *display: *block/.test(src));
  if (file === 'support-overview.html') {
    const x = box(['care_schedule_v2', 'wsday_2026-10-12']);
    x.b.showCopyBand_(['care_schedule_v2'], true);
    x.b.showCopyBand_(['wsday_2026-10-12'], false);
    t('★1回の表示の中で一度でも写しから読んだら、後で Supabase から読めても出したまま（最後の1回で消さない）', x.el.hidden === false);
    t('表示の取り直し（refresh の始め）で戻す', /async function refresh\(\) \{[\s\S]{0,240}copyUsed_ = false;/.test(src));
  }
  t('Supabase から読めた時に消し、Google の応答を使う直前に出す（結線）',
    (src.match(/showCopyBand_\([^)]*, false\)/g) || []).length === 1 && (src.match(/showCopyBand_\([^)]*, true\)/g) || []).length === 1);
}

console.log('\n— 写しの見比べ（shadow-check.js）—');
{
  const s = read('shadow-check.js');
  const fix = cutF(s, 'runMirrorFix'), wb = cutF(s, 'writeBackWsday'), sh = cutF(s, 'writeBackShift');
  t('違う分を写す: mirror の印つきで送る', /\{ action: 'put', key: k, rev: 0, data: sd, force: true, mirror: true \}/.test(fix));
  t('違う分を写す: 証明は添えない（統合 GAS は印のある写し返しの「最後に直した人」を書き換えない・反証レビュー）', !/accessToken/.test(fix));
  t('戻す手順に、統合 GAS のプロパティから外す注意がある（画面の文言と確認の2か所）',
    /KV_SWITCHED_FAMILIES/.test(read('shadow-check.html')) && (s.match(/KV_SWITCHED_FAMILIES/g) || []).length >= 2);
  t('日ごとを写し返す: mirror の印つきで送る', /\{ action: 'put', key: k, rev: 0, data: sd, force: true, mirror: true \}/.test(wb));
  t('勤務表の写し返しは今までどおり（統合 GAS の断りは勤務表に掛からない）', /\{ action: 'push', key: k, baseRev: 0, data: sbEnts\[k\]\.data, force: true \}/.test(sh));
}

console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
