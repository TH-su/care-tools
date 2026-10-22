/* copy_band_mirror_test.js — 切り替え後の Google 依存の片付け（2026-10-17 改善プロンプト第2弾の8・代表者の決定）
 * 守ること:
 *   1. 全支援俯瞰・週間計画俯瞰: 保存先が Supabase に切り替わっているキーを Google の写しから表示した時だけ「写しから表示中」の帯を出す。
 *      Supabase から読めたら消す。スイッチが切のキー（Google が本番）では出さない。印刷には出さない
 *   2. 写しの見比べ（shadow-check.js）: Google へ写す2か所（違う分を写す・日ごとを写し返す）に mirror の印。
 *      週間計画を写す時だけ、押した管理者のログインの証明を添える
 *   3. （2026-10-22 改善プロンプト第3弾の14）帯は Google の読みが成功した時（HTTP 2xx・本文が JSON・ok:true）だけ出す。
 *      ★帯は「いま画面に出ている盤面が写しから読んだものか」を表す（反証レビューの指摘で改めた）。帯は盤面を描き直した時にだけ、
 *      その描き直しに使ったデータの出どころで決める。取り直しが失敗して盤面を描き直さない時は帯に触れない（前の盤面＝前の帯のまま）。
 *      全支援俯瞰で盤面を空にした時（全週失敗・接続先なし）は消す
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


/* 帯の部品の模型（routedKeys＝保存先が Supabase に切り替わっているキー・noSukv＝su-kv が無い画面） */
function sandbox(routedKeys, noSukv) {
  const el = { hidden: true };
  const b = { document: { getElementById: id => (id === 'copyBand' ? el : null) },
              window: noSukv ? {} : { SUKv: { routed: k => routedKeys.indexOf(k) >= 0 } } };
  b.SUKv = b.window.SUKv;
  vm.createContext(b);
  return { b, el };
}
function commonChecks(src) {
  t('帯の部品は最初は隠れていて、読み上げの対象（role=status）', /<div id="copyBand" class="copy-band" role="status" aria-live="polite" hidden>/.test(src));
  t('印刷には出さない', /@media print \{ \.copy-band \{ display: none !important; \} \}/.test(src));
  t('隠れている時は場所を取らない（:not([hidden]) にだけ形を付ける）', /\.copy-band:not\(\[hidden\]\) \{/.test(src) && !/\.copy-band \{ *display: *block/.test(src));
}
const READ_OK = /if \(!res\.ok\) throw[^\n]*\n\s*const j = await res\.json\(\);\n\s*if \(!j\.ok\) throw[^\n]*\n\s*/;

console.log('\n— 全支援俯瞰 —');
{
  const src = read('support-overview.html');
  /* ★2026-10-22 意図的な更新（反証レビューの指摘・改善プロンプト第3弾の14）: 読んでいる間は出どころを控えるだけ（noteCopyRead_）、
     帯は盤面を描き直した時に applyCopyBand_ で決める形に分けた（旧 showCopyBand_ は読むたびに帯を書き換えていた） */
  function box(routedKeys, noSukv) {
    const x = sandbox(routedKeys, noSukv);
    vm.runInContext('var copyUsed_ = false;\n' + cutF(src, 'noteCopyRead_') + '\n' + cutF(src, 'applyCopyBand_'), x.b);
    return x;
  }
  function run(routedKeys, keys, fromCopy, noSukv) {
    const x = box(routedKeys, noSukv);
    x.b.noteCopyRead_(keys, fromCopy);
    vm.runInContext('applyCopyBand_(copyUsed_)', x.b);
    return x.el.hidden;
  }
  t('切り替え済みのキーを写しから表示 → 帯を出す', run(['care_schedule_v2'], ['care_schedule_v2'], true) === false);
  t('Supabase から読めた → 帯を出さない', run(['care_schedule_v2'], ['care_schedule_v2'], false) === true);
  t('スイッチが切（Google が本番）→ 写しから読んでも出さない', run([], ['care_schedule_v2'], true) === true);
  t('su-kv が無い画面の状態 → 出さない（例外も出さない）', run([], ['care_schedule_v2'], true, true) === true);
  commonChecks(src);
  {
    const x = box(['care_schedule_v2', 'wsday_2026-10-12']);
    x.b.noteCopyRead_(['care_schedule_v2'], true);
    x.b.noteCopyRead_(['wsday_2026-10-12'], false);
    vm.runInContext('applyCopyBand_(copyUsed_)', x.b);
    t('★1回の表示の中で一度でも写しから読んだら、後で Supabase から読めても出す（最後の1回で消さない）', x.el.hidden === false);
    const y = box(['care_schedule_v2']);
    y.el.hidden = false;
    y.b.noteCopyRead_(['care_schedule_v2'], false);
    t('★読んでいる間は帯に触れない（出どころを控えるだけ）', y.el.hidden === false);
  }
  t('表示の取り直し（refresh の始め）で控えを戻す', /async function refresh\(\) \{[\s\S]{0,240}copyUsed_ = false;/.test(src));
  const reader = cutF(src, 'gasCall');
  t('読む関数の中: Supabase から読めた時に「写しではない」、Google の応答を確かめた後に「写し」と控える（結線）',
    (reader.match(/noteCopyRead_\([^)]*, false\)/g) || []).length === 1 && (reader.match(/noteCopyRead_\([^)]*, true\)/g) || []).length === 1 && !/applyCopyBand_/.test(reader));
  t('Google の読みの成功＝HTTP 2xx・ok:true を確かめた後にだけ「写し」と控える', new RegExp(READ_OK.source + 'noteCopyRead_\\([^)]*, true\\);').test(reader));
  const ref = cutF(src, 'refresh');
  const ep = ref.slice(ref.indexOf('if (!t.endpoint) {'), ref.indexOf('TARGET = t;'));
  const zero = ref.slice(ref.indexOf('if (raw.weeksFetched === 0) {'), ref.indexOf('lastFetchFailed = false;'));
  const ok = ref.slice(ref.indexOf('lastFetchFailed = false;'), ref.lastIndexOf('} catch (e) {'));
  const cat = ref.slice(ref.lastIndexOf('} catch (e) {'));
  t('★盤面を描き直した直後に、その表示の出どころで帯を決める', /render\(model, N, VIEW\);\n\s*applyCopyBand_\(copyUsed_\);/.test(ok));
  t('★取り直しが例外で失敗した時は帯に触れない（盤面も前のまま）', !/applyCopyBand_|copyUsed_/.test(cat));
  t('週を1つも読めず盤面を空にした時は消す（予定の型だけ写しから読めても出さない）', /applyCopyBand_\(false\)/.test(zero));
  t('接続先が無く盤面を空にした時も消す', /applyCopyBand_\(false\)/.test(ep));
  t('帯を決めるのは上の3か所だけ（読んでいる途中では決めない）', (src.match(/applyCopyBand_\(/g) || []).length === 4);
}

let visitRuns = Promise.resolve();   // 訪問の refresh を動かす試験（非同期）。合計はこれを待ってから出す
console.log('\n— 訪問 週間俯瞰 —');
{
  const src = read('visit-overview.html');
  function run(routedKeys, keys, fromCopy, noSukv) {
    const x = sandbox(routedKeys, noSukv);
    vm.runInContext(cutF(src, 'showCopyBand_'), x.b);
    x.b.showCopyBand_(keys, fromCopy);
    return x.el.hidden;
  }
  t('切り替え済みのキーを写しから表示 → 帯を出す', run(['care_schedule_v2'], ['care_schedule_v2'], true) === false);
  t('Supabase から読めた → 帯を消す', run(['care_schedule_v2'], ['care_schedule_v2'], false) === true);
  t('スイッチが切（Google が本番）→ 写しから読んでも出さない', run([], ['care_schedule_v2'], true) === true);
  t('su-kv が無い画面の状態 → 出さない（例外も出さない）', run([], ['care_schedule_v2'], true, true) === true);
  commonChecks(src);
  /* ★2026-10-22 意図的な更新（反証レビューの指摘・改善プロンプト第3弾の14）: 読む関数（fetchRemote）は出どころを remoteFromCopy_ に控えるだけ。
     帯は refresh で盤面を描き直した時に決める */
  const reader = cutF(src, 'fetchRemote');
  t('読む関数の中では帯に触れず、Supabase から読めた時に「写しではない」と控える', !/showCopyBand_/.test(reader) && /if \(v\) \{ remoteFromCopy_ = false; return/.test(reader));
  t('Google の読みの成功＝HTTP 2xx・ok:true を確かめた後にだけ「写し」と控える', new RegExp(READ_OK.source + 'remoteFromCopy_ = true;').test(reader));
  /* 動かして確かめる: refresh を実物のまま切り出し、読みの結果（写し・Supabase・失敗・データなし）ごとに帯を見る */
  function refreshRun(initialHidden, outcome) {
    const x = sandbox(['care_schedule_v2']);
    const els = {};
    const $ = id => (els[id] = els[id] || { disabled: false, textContent: '' });
    Object.assign(x.b, { $, LS_KEY: 'care_schedule_v2', DB: null, busy: false, rendered: 0,
      render() { x.b.rendered++; }, toast() {}, setSyncState() {} });
    vm.runInContext('let remoteFromCopy_ = false;\n' + cutF(src, 'showCopyBand_') + '\nasync ' + cutF(src, 'refresh') +
      '\nvar fetchRemote; this.setFetch = f => { fetchRemote = f; }; this.go = () => refresh();', x.b);
    x.b.setFetch(async () => {
      if (outcome === 'fail') throw new Error('HTTP 500');
      if (outcome === 'empty') { vm.runInContext('remoteFromCopy_ = true', x.b); return null; }
      vm.runInContext('remoteFromCopy_ = ' + (outcome === 'copy'), x.b);
      return { residents: [] };
    });
    x.el.hidden = initialHidden;
    return x.b.go().then(() => ({ hidden: x.el.hidden, rendered: x.b.rendered }));
  }
  visitRuns = Promise.all([
    refreshRun(true, 'copy'), refreshRun(false, 'supa'), refreshRun(false, 'fail'), refreshRun(true, 'fail'), refreshRun(false, 'empty')
  ]).then(([c, s, f1, f2, e]) => {
    t('（動かして）写しから読んで描き直した → 帯を出す', c.rendered === 1 && c.hidden === false, c);
    t('（動かして）Supabase から読んで描き直した → 帯を消す', s.rendered === 1 && s.hidden === true, s);
    t('★（動かして）取り直しが失敗・前の盤面が写し → 帯は出たまま（注意書きの無い写しの盤面を残さない）', f1.rendered === 0 && f1.hidden === false, f1);
    t('（動かして）取り直しが失敗・前の盤面が写しでない → 帯は出ないまま', f2.rendered === 0 && f2.hidden === true, f2);
    t('（動かして）データが無く描き直さない → 帯に触れない', e.rendered === 0 && e.hidden === false, e);
  });
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

visitRuns.catch(e => { fail++; console.log('  ✗ 訪問の refresh を動かす試験が例外  → ' + String(e && e.message || e)); }).then(() => {
  console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
});
