/* 全支援俯瞰・訪問俯瞰：見出しに、いま出ている盤面をどこから・いつ読んだかを小さく出す（代表者の指示 2026-11-13）の試験。
 * 実物の HTML から関数を切り出して動かす（写経しない）。架空の値だけ。
 * 確かめること:
 *   1. 札を作る関数（ovSrcText_・ovShowSrc_）が2画面で一字一句同じ
 *   2. 文: 新しい保存先／Google／Google の写し／混ざった時、時刻は H:MM。読んでいない時は空
 *   3. 札の要素は見出しの中で、初めは隠れている（読んでいない時は出さない）。印刷では出さない・画面だけの指定
 *   4. 訪問俯瞰: 読み先は帯と同じ条件（切り替えた後のキーを Google から読んだ時だけ「写し」）
 *   5. 全支援俯瞰: 読むたびの控え（noteCopyRead_）で、新しい保存先・Google・写しを分けて数える
 *   6. 職員に見える文に技術用語を出さない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
let ok = 0, ng = 0;
function t(name, cond, extra) { if (cond) { ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }

function cut(src, name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) return null;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  return null;
}
const SO = fs.readFileSync(path.join(ROOT, 'support-overview.html'), 'utf8');
const VO = fs.readFileSync(path.join(ROOT, 'visit-overview.html'), 'utf8');
const TECH = /Supabase|GAS|トークン|token|JSON|API|localStorage|HTTP|fetch|キャッシュ/i;

console.log('— 1. 2画面で同じ関数 —');
for (const fn of ['ovSrcText_', 'ovShowSrc_']) {
  const a = cut(SO, fn), b = cut(VO, fn);
  t('1 ' + fn + ' が2画面にあり一字一句同じ', !!a && a === b);
}

function mk(code, extra) {
  const els = { srcState: { textContent: '', hidden: true } };
  const ctx = Object.assign({ document: { getElementById: (id) => els[id] || null }, window: {}, Date, isNaN }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, els };
}
const at = new Date(2026, 10, 13, 7, 5);

console.log('— 2. 文 —');
{
  const { ctx, els } = mk(cut(SO, 'ovSrcText_') + '\n' + cut(SO, 'ovShowSrc_'));
  t('2-1 新しい保存先', ctx.ovSrcText_({ fresh: true }, at) === '新しい保存先から読みました 7:05', ctx.ovSrcText_({ fresh: true }, at));
  t('2-2 Google', ctx.ovSrcText_({ google: true }, at) === 'Google から読みました 7:05');
  t('2-3 Google の写し（写しの帯と同じ語）', ctx.ovSrcText_({ copy: true }, at) === 'Google の写しから読みました 7:05');
  t('2-4 新しい保存先と Google が混ざる', ctx.ovSrcText_({ fresh: true, google: true }, at) === '新しい保存先と Google から読みました 7:05');
  t('2-5 写しが混ざれば写しと言う', ctx.ovSrcText_({ fresh: true, google: true, copy: true }, at) === '新しい保存先と Google の写しから読みました 7:05');
  t('2-6 2桁の時刻', ctx.ovSrcText_({ fresh: true }, new Date(2026, 10, 13, 17, 42)) === '新しい保存先から読みました 17:42');
  t('2-7 読んでいない時は空', ctx.ovSrcText_(null, at) === '' && ctx.ovSrcText_({}, at) === '' && ctx.ovSrcText_({ fresh: true }, null) === '' && ctx.ovSrcText_({ fresh: true }, new Date(NaN)) === '');
  ctx.ovShowSrc_({ copy: true }, at);
  t('2-8 出す時は札を見せる', els.srcState.hidden === false && els.srcState.textContent === 'Google の写しから読みました 7:05');
  ctx.ovShowSrc_(null);
  t('2-9 盤面を空にした時は札を隠して文を消す', els.srcState.hidden === true && els.srcState.textContent === '');
  const words = [{ fresh: true }, { google: true }, { copy: true }, { fresh: true, google: true, copy: true }].map((s) => ctx.ovSrcText_(s, at));
  t('6 職員に見える文に技術用語が無い', words.every((w) => !TECH.test(w)), words);
}

console.log('— 3. 要素と見た目 —');
for (const [file, src] of [['support-overview.html', SO], ['visit-overview.html', VO]]) {
  const hdr = (src.match(/<header class="hdr">([\s\S]*?)<\/header>/) || [, ''])[1];
  t('3-1 ' + file + ' 札は見出しの最後の部品で、初めは隠れている（出す時に下の1行になり、ボタンを動かさない）',
    /<span class="src-state" id="srcState" role="status" hidden><\/span>[^<\n]*(?:<!--[^\n]*-->)?\s*$/.test(hdr) && src.indexOf('.src-state { flex: 0 0 100%;') >= 0);
  t('3-2 ' + file + ' 隠した時は必ず隠れる', src.indexOf('.src-state[hidden] { display: none !important; }') >= 0);
  t('3-3 ' + file + ' 見た目は画面だけ・印刷に出さない',
    src.indexOf('@media screen { .src-state {') >= 0 && src.indexOf('@media print { .src-state { display: none !important; } }') >= 0);
  t('3-4 ' + file + ' 札を出すのは盤面を描き直した所だけ（ovShowSrc_ に時刻を渡すのは1か所）', (src.match(/^.*ovShowSrc_\(.*new Date\(\)\);.*$/gm) || []).length === 1);
}

console.log('— 4. 訪問俯瞰の読み先 —');
{
  const code = 'var LS_KEY = "care_schedule_v2";\n' + cut(VO, 'voSrcOf_');
  const run = (routed) => { const { ctx } = mk(code, { window: { SUKv: { routed: () => routed } } }); ctx.SUKv = ctx.window.SUKv; return ctx; };
  t('4-1 新しい保存先から読めた', JSON.stringify(run(true).voSrcOf_(false)) === '{"fresh":true}');
  t('4-2 切り替える前のキーを Google から＝Google', JSON.stringify(run(false).voSrcOf_(true)) === '{"google":true}');
  t('4-3 切り替えた後のキーを Google から＝写し', JSON.stringify(run(true).voSrcOf_(true)) === '{"copy":true}');
  const { ctx } = mk(code);
  t('4-4 部品が無い時は Google（写しと言わない）', JSON.stringify(ctx.voSrcOf_(true)) === '{"google":true}');
  t('4-5 帯と同じ印（remoteFromCopy_）から決める', /showCopyBand_\(\[LS_KEY\], remoteFromCopy_\);[^\n]*\n\s*ovShowSrc_\(voSrcOf_\(remoteFromCopy_\), new Date\(\)\);/.test(VO));
}

console.log('— 5. 全支援俯瞰の控え —');
{
  const code = 'var copyUsed_ = false;\nvar srcFresh_ = false, srcGoogle_ = false;\n' + cut(SO, 'noteCopyRead_') + '\nthis.__s = function(){ return { fresh: srcFresh_, google: srcGoogle_, copy: copyUsed_ }; };';
  const run = (routedKeys, reads) => {
    const win = { SUKv: { routed: (k) => routedKeys.indexOf(k) >= 0 } };
    const { ctx } = mk(code, { window: win });
    ctx.SUKv = win.SUKv;
    reads.forEach((r) => ctx.noteCopyRead_(r[0], r[1]));
    return JSON.stringify(ctx.__s());
  };
  t('5-1 全部新しい保存先', run(['a', 'b'], [[['a'], false], [['b'], false]]) === '{"fresh":true,"google":false,"copy":false}');
  t('5-2 予定の型は新しい保存先・日ごとは切り替える前で Google', run(['a'], [[['a'], false], [['d1'], true]]) === '{"fresh":true,"google":true,"copy":false}');
  t('5-3 切り替えた後を Google から＝写し', run(['a', 'd1'], [[['d1'], true]]) === '{"fresh":false,"google":false,"copy":true}');
  t('5-4 表示の取り直しの始めで控えを戻す', /showCsLink_\(false\);[^\n]*\n\s*srcFresh_ = false; srcGoogle_ = false;/.test(SO));
  t('5-5 盤面を空にする2か所で札も消す', (SO.match(/applyCopyBand_\(false\);[^\n]*\n\s*ovShowSrc_\(null\);/g) || []).length === 2);
}

console.log(`\n${ok} 合格 / ${ng} 不合格`);
process.exitCode = ng ? 1 : 0;
