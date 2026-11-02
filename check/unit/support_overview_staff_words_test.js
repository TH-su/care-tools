/* 全支援俯瞰（support-overview.html）：職員に見える文から技術用語を減らし、接続が無い時の案内を出す（品質改善 第3期 便5）。
   実物の HTML を読み、変えた文ごとに「前の技術用語が無い」「新しい文がある」を確かめる。
   案内の文とリンクの出し分けは、実物の関数を切り出して動かす（写経しない）。
   対象 HTML は環境変数 SUPPORT_OVERVIEW_HTML で差し替えられる（直す前の版で落ちることを確かめるため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.SUPPORT_OVERVIEW_HTML || path.join(__dirname, '..', '..', 'support-overview.html');
const src = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const has = (s) => src.indexOf(s) >= 0;
const count = (s) => src.split(s).length - 1;

/* 関数を名前で切り出す（async 付きは async ごと） */
function cut(name) {
  let head = src.indexOf('function ' + name + '(');
  if (head < 0) return null;
  if (src.slice(Math.max(0, head - 6), head) === 'async ') head -= 6;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  return null;
}

const NO_TARGET_OFFICE = '週間計画・ワースケ・シフトの接続先が入っていません。接続設定の「週間計画・ワースケ・シフト」の欄に、接続先のURLと合言葉を入れてください。';
const NO_TARGET_FIELD = 'この端末には週間計画・ワースケ・シフトの接続先が入っていません。事務所に知らせてください。';
const FAIL_OFFICE = 'データを取得できませんでした。通信環境と、接続設定の「週間計画・ワースケ・シフト」の接続先のURL・合言葉をご確認ください。';
const FAIL_FIELD = 'データを取得できませんでした。通信環境をご確認ください。続く時は事務所に知らせてください。';
const TECH = /Supabase|GAS|トークン|token|JSON|API|localStorage|HTTP|fetch/i;

console.log('— 1. 写しから表示中の帯 —');
const mBand = src.match(/<div id="copyBand"[^>]*>([\s\S]*?)<\/div>/);
const band = mBand ? mBand[1] : '';
t('1-1 帯に「Supabase（本番）」が無い', !!mBand && !/Supabase/.test(band), band);
t('1-2 帯は「共通のデータベースから読めず、Google の写しから表示しています。」（後ろの文はそのまま）',
  band === '⚠️ 共通のデータベースから読めず、Google の写しから表示しています。写しは古いことがあります。ログインし直すか、時間をおいて読み込み直してください。', band);
t('1-3 帯は最初は隠れている（出る・消える条件は変えていない）', /<div id="copyBand" class="copy-band" role="status" aria-live="polite" hidden>/.test(src));

console.log('— 2. 接続先が無い時の案内 —');
t('2-1 「ワースケ等の設定で接続先URL／トークンを登録してください」を出さない', !has('接続先URL／トークンを登録してください'));
t('2-2 「同期先が未設定です」を出さない', !has("'同期先が未設定です"));
const fNo = cut('soNoTargetMsg_'), fFail = cut('soFetchFailMsg_'), fLink = cut('showCsLink_'), fField = cut('ovIsField_');
t('2-3 案内の関数がある', !!fNo && !!fFail && !!fLink && !!fField);
function runMsg(fn, role) {
  const ctx = { localStorage: { getItem: (k) => (k === 'su_device_role' ? role : null) } };
  vm.createContext(ctx);
  vm.runInContext(fField + '\n' + fn + '\nthis.__r = ' + fn.match(/function (\w+)/)[1] + '();', ctx);
  return ctx.__r;
}
if (fNo && fField) {
  const off = runMsg(fNo, 'office'), fld = runMsg(fNo, 'field'), none = runMsg(fNo, null);
  t('2-4 事務所PC: 何が足りないかと、接続設定のどの欄に何を入れるか', off === NO_TARGET_OFFICE, off);
  t('2-5 用途の印が無い端末も事務所PCと同じ', none === NO_TARGET_OFFICE, none);
  t('2-6 現場端末: 接続設定を案内せず、事務所に知らせる', fld === NO_TARGET_FIELD, fld);
  t('2-7 どちらの文にも技術用語が無い', !TECH.test(off) && !TECH.test(fld));
} else { t('2-4〜2-7 案内の関数を動かせる', false); }
t('2-8 接続先が無い時（更新・起動の2か所）は案内の関数を通し、リンクも出す', count("$('emptyMsg').textContent = soNoTargetMsg_(); showCsLink_(true);") === 2);

console.log('— 3. 読めなかった時の案内 —');
t('3-1 「通信環境・接続先URL／トークンをご確認ください」を出さない', !has('接続先URL／トークンをご確認ください'));
if (fFail && fField) {
  const off = runMsg(fFail, 'office'), fld = runMsg(fFail, 'field');
  t('3-2 事務所PC: 接続設定の欄の名前で確かめる所を書く', off === FAIL_OFFICE, off);
  t('3-3 現場端末: 事務所に知らせる', fld === FAIL_FIELD, fld);
  t('3-4 どちらの文にも技術用語が無い', !TECH.test(off) && !TECH.test(fld));
} else { t('3-2〜3-4 案内の関数を動かせる', false); }
t('3-5 全部の週が読めなかった時は案内の関数を通し、リンクも出す', has("$('emptyMsg').textContent = soFetchFailMsg_(); showCsLink_(true);"));

console.log('— 4. 接続設定へのリンク —');
const mEmpty = src.match(/<div class="board-empty" id="boardEmpty">([\s\S]*?)<\/main>/);
const emptyBox = mEmpty ? mEmpty[1] : '';
t('4-1 空の盤面の中に、接続設定の画面へのリンクがあり、最初は隠れている',
  /<a id="emptyCsLink" href="connection-settings\.html" hidden>接続設定の画面を開く<\/a>/.test(emptyBox));
t('4-2 隠した時に必ず隠れる指定がある', /#emptyCsLink\[hidden\] \{ display: none !important; \}/.test(src));
t('4-3 印刷には出さない', /@media print \{ #emptyCsLink \{ display: none !important; \} \}/.test(src));
if (fLink && fField) {
  function runLink(on, role) {
    const a = { hidden: true };
    const ctx = { localStorage: { getItem: (k) => (k === 'su_device_role' ? role : null) }, $: (id) => (id === 'emptyCsLink' ? a : null) };
    vm.createContext(ctx);
    vm.runInContext(fField + '\n' + fLink + '\nshowCsLink_(' + on + ');', ctx);
    return a.hidden;
  }
  t('4-4 事務所PCでは出す', runLink(true, 'office') === false);
  t('4-5 現場端末では出さない（接続設定は現場では開けない）', runLink(true, 'field') === true);
  t('4-6 出さない指示で隠す', runLink(false, 'office') === true);
} else { t('4-4〜4-6 リンクの関数を動かせる', false); }
const fRefresh = cut('refresh') || '';
t('4-7 更新を始める時にリンクを隠す（読めた後に残さない）', /copyUsed_ = false;[^\n]*\n\s*showCsLink_\(false\);/.test(fRefresh));

console.log('— 5. 画面に出る文に技術用語が残っていない —');
const shown = [];
src.replace(/(?:textContent = |toast\(|setSyncState\()'([^']*)'/g, function (_, s) { shown.push(s); return _; });
const bad = shown.filter(function (s) { return TECH.test(s); });
t('5-1 textContent・toast・状態の文に技術用語が無い', shown.length > 0 && bad.length === 0, bad);

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
