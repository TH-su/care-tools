/* 貼り薬カレンダーの「入居者ごとに貼り薬の種類を選ぶ」（代表者の決定 2026-11-17 案A・PC-02）の試験
   実行: node check/unit/patch_kind_test.js
   対象を差し替える（壊した版で落ちることを確かめる）: PATCH_HTML=/tmp/変異版.html node check/unit/patch_kind_test.js

   守ること:
     1. 施設情報の kinds（pcKindsOf）: no は 2〜8 で重ならない・drug は必ず・sites は書けば 2〜8か所。1つでも崩れれば kinds だけ捨てる
     2. 表示の決まり（pcResolve・pcResolveManual）: 選びの行（<ID>:pk）の無い方は今までどおり既定の行。選びの行の指紋（開始日・場所）が
        設定の行と合う時だけその種類で確定。合わない・種類が施設情報に無い・行が崩れている時は既定に倒さず未設定（set が null）
     3. 保存（pcKindSave）: 既定の種類で選びの行の無い方は今までの道（選びの行を作らない＝今の施設の控えと送る中身は今と同じ）。
        別の種類は 設定の行（<ID>:pkr）→ 選びの行 の順に同じ日時で控えに書いて送る。手入力は apc2_m2 → apc2_mkind の順
     4. 共通 DB（統合 0016 の patch_put の判定どおりの偽物）を通して: A→B→A・2台・片方だけ載る・古い画面の書き込みで選びの行が消えない
     5. 書き出し・読み込み（版 v:1 のまま）: 行ごとの上限で確かめ（表示中の種類の数で黙って落とさない）
     6. 名簿の入居者ID が :pk・:pkr・:pkb で終わる方がいれば種類の機能を止める（今までどおりの道。帯は kinds を書いた施設だけ。別の種類に替えてあった方は確定にしない）
     8. 差分の審査 2026-11-17: 食い違い・無い種類の方は人が種類を選んだ時だけ保存する／既定の行の直しは写し（:pkb）と値で比べる
        （時計のずれ・同じ値の送り直しが unchanged で日時を進めないことに左右されない）／入れ直せば2台目でも警告が消える
     7. 画面のつなぎ: 選ぶ欄はスクリプトで作る（HTML に無い）・印刷の確かめの鍵に種類（既定の種類の時は今の鍵）・取り直しは3つの鍵
   ★本物のファイルを砂場で動かす。架空データのみ（氏名は使わない・入居者ID は記号・薬の名前は架空）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const PAGE = fs.readFileSync(process.env.PATCH_HTML || path.join(ROOT, 'patch-calendar.html'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'su-patch-sync.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const J = JSON.stringify;
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = PAGE.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('画面に関数がありません: ' + name);
  return PAGE.slice(start, scanBlock(PAGE, start) + 1);
}
function grabVar(name) {
  const m = PAGE.match(new RegExp('\\nvar ' + name + ' = [^\\n]*'));
  if (!m) throw new Error('画面に変数がありません: ' + name);
  return m[0];
}

/* 架空の種類: 2番＝6か所の架空テープ・3番＝場所を書かない架空パッチ（背中8箇所の図のまま） */
const sites = (n) => Array.from({ length: n }, (_, i) => ({ name: '場所' + (i + 1) }));
const KINDS_RAW = [{ no: 3, drug: '架空パッチ' }, { no: 2, drug: '架空テープ', sites: sites(6) }];

/* ── 純関数の砂場 ── */
const PURE = ['pcStr', 'pcCfgOf', 'pcKindsOf', 'pcRowOf', 'pcKindIn', 'pcResolve', 'pcSameRow', 'pcResolveManual', 'pcKindStopOf',
  'utcNoon', 'parseISODate', 'parseNo', 'pcSetByOf', 'ioEntry', 'ioExportObj', 'ioParse', 'ioNewer', 'ioPlan'];
const pure = { Date, JSON, Object, String, Number, isNaN, isFinite, Math, Array, RegExp };
vm.createContext(pure);
vm.runInContext([grabVar('PC_SITE_MIN'), grabVar('PC_BAD_CH'), grabVar('PC_KIND_MAX'),
  "var DEF_SITES = new Array(8), SITES = DEF_SITES; var IO_APP = 'patch-calendar', IO_VER = 1;",
  (PAGE.match(/\nvar CYCLE[^\n]*/) || [''])[0]].concat(PURE.map(grabFn)).join('\n'), pure);

console.log('— 1. 施設情報の kinds（pcKindsOf）—');
{
  const K = (kinds, extra) => pure.pcKindsOf(Object.assign({ kinds }, extra || {}));
  const ok = K(KINDS_RAW);
  t('正しい kinds は番号順に並べて使う（場所を書かない種類は sites が null）', ok && J(ok.map(x => x.no)) === J([2, 3]) && ok[0].drug === '架空テープ' && ok[0].sites.length === 6 && ok[1].sites === null, ok);
  t('書いていない（kinds が無い・塊でない）は null', pure.pcKindsOf(undefined) === null && pure.pcKindsOf(null) === null && pure.pcKindsOf({ drug: '架空テープ' }) === null && pure.pcKindsOf([]) === null);
  t('kinds が配列でない・空なら null', K('x') === null && K({ no: 2 }) === null && K([]) === null);
  for (const [label, bad] of [['no が 1', { no: 1, drug: 'あ' }], ['no が 9', { no: 9, drug: 'あ' }], ['no が小数', { no: 2.5, drug: 'あ' }],
    ['no が文字', { no: '2', drug: 'あ' }], ['no が無い', { drug: 'あ' }], ['drug が無い', { no: 2 }], ['drug が空', { no: 2, drug: '' }],
    ['drug が21字', { no: 2, drug: 'あ'.repeat(21) }], ['drug にタグ', { no: 2, drug: '<b>x</b>' }], ['場所が1か所', { no: 2, drug: 'あ', sites: sites(1) }],
    ['場所が9か所', { no: 2, drug: 'あ', sites: sites(9) }], ['場所の名前が同じ', { no: 2, drug: 'あ', sites: [{ name: '左' }, { name: '左' }] }], ['配列', [2, 'あ']], ['null', null]]) {
    t('★1つでも崩れていれば kinds を丸ごと捨てる（' + label + '）', K([{ no: 4, drug: '架空ゲル' }, bad]) === null);
  }
  t('番号が重なれば捨てる', K([{ no: 2, drug: 'あ' }, { no: 2, drug: 'い' }]) === null);
  t('種類は既定を含めて8つまで（別の種類は7つ・2〜8）', !!K([2, 3, 4, 5, 6, 7, 8].map(n => ({ no: n, drug: '架空' + n }))));
  t('既定の種類（drug・sites）は kinds と別に今までどおり読む（pcCfgOf は kinds を見ない）',
    J(pure.pcCfgOf({ drug: '架空テープ', kinds: 'こわれた' })) === J({ drug: '架空テープ', sites: null }) && pure.pcCfgOf({ kinds: KINDS_RAW }) === null);
  /* 崩れた時の帯の判定（pcReadKinds） */
  const rk = (pc) => { const c = { window: {}, SUFacility: { section: () => pc } }; c.window.SUFacility = c.SUFacility; vm.createContext(c);
    vm.runInContext([grabVar('PC_SITE_MIN'), grabVar('PC_BAD_CH'), grabVar('PC_KIND_MAX')].concat(['pcStr', 'pcCfgOf', 'pcKindsOf', 'pcReadKinds'].map(grabFn)).join('\n'), c);
    return c.pcReadKinds(); };
  t('崩れた kinds は bad（帯を出す）・書いていなければ bad でない', rk({ kinds: [{ no: 1 }] }).bad === true && rk({ kinds: [{ no: 1 }] }).list === null
    && rk({ drug: '架空テープ' }).bad === false && rk(null).bad === false && rk({ kinds: KINDS_RAW }).bad === false && rk({ kinds: KINDS_RAW }).list.length === 2);
}

console.log('\n— 2. 表示の決まり（pcResolve・pcResolveManual）—');
{
  const kinds = pure.pcKindsOf({ kinds: KINDS_RAW });
  const R = (all, n1) => pure.pcResolve(all, 'r1', kinds, n1 || 8);
  const row = (start, no, prev) => ({ start, no, prev: prev || 0, by: '職員甲', at: '2026-11-01T00:00:00.000Z' });
  const base = row('2026-11-01', 5, 4);
  let x = R({ r1: base });
  t('選びの行の無い方は既定の種類・既定の行のまま（今までと同じ）', x.kind === 1 && x.st === '' && x.set.start.iso === '2026-11-01' && x.set.no === 5 && x.set.prev === 4 && x.set.by === '職員甲', x);
  x = R({});
  t('設定の無い方は既定の種類・未設定（今までと同じ）', x.kind === 1 && x.st === '' && x.set === null);
  x = R({ r1: row('2026-11-01', 7) }, 6);
  t('既定の行の番号が既定の種類の場所の数を超える時は未設定（今までと同じ）', x.kind === 1 && x.st === '' && x.set === null);
  x = R({ r1: base, 'r1:pk': row('2026-11-01', 1, 5) });
  t('選びの行が1番で指紋（開始日・場所）が既定の行と合えば既定の種類で確定', x.kind === 1 && x.st === '' && x.set.no === 5);
  x = R({ r1: row('2026-11-03', 2), 'r1:pk': row('2026-11-01', 1, 5) });
  t('★選びの行が1番でも、既定の行が古い画面などで直されて指紋が合わなければ未設定＋警告（bad）', x.kind === 1 && x.st === 'bad' && x.set === null, x);
  const pkr = row('2026-11-10', 3, 2), pkb = row('2026-11-01', 5, 4);   /* pkb: 別の種類へ替えた時の既定の行の写し */
  x = R({ r1: base, 'r1:pkb': pkb, 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 2, 3) });
  t('選びの行が2番で指紋が別の種類の行と合えば2番で確定（既定の行は使わない）', x.kind === 2 && x.st === '' && x.set.start.iso === '2026-11-10' && x.set.no === 3 && x.set.prev === 2, x);
  /* 既定の行の直しは写し（:pkb）と値で比べる（差分の審査 2026-11-17・日時は使わない） */
  const at = (r, iso) => Object.assign({}, r, { at: iso });
  const pkAt = at(row('2026-11-10', 2, 3), '2026-11-10T00:00:00.000Z'), pkrAt = at(pkr, '2026-11-10T00:00:00.000Z');
  x = R({ r1: at(base, '2026-11-30T00:00:00.000Z'), 'r1:pkb': at(pkb, '2026-11-10T00:00:00.000Z'), 'r1:pkr': pkrAt, 'r1:pk': pkAt });
  t('★既定の行が写しと同じ値なら、日時が選びの行より新しくても警告しない（時計のずれに左右されない）', x.kind === 2 && x.st === '' && x.set.no === 3, x);
  x = R({ r1: at(row('2026-11-05', 2, 1), '2026-11-01T00:00:00.000Z'), 'r1:pkb': at(pkb, '2026-11-10T00:00:00.000Z'), 'r1:pkr': pkrAt, 'r1:pk': pkAt });
  t('★既定の行が写しと違う値なら、日時が古くても（時計の遅れた端末の直し）未設定＋警告', x.kind === 2 && x.st === 'bad' && x.set === null, x);
  x = R({ r1: row('2026-11-01', 5, 2), 'r1:pkb': pkb, 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 2, 3) });
  t('前日の場所だけ違っても値が違えば警告', x.st === 'bad');
  x = R({ r1: base, 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 2, 3) });
  t('★写しが無いのに既定の行がある（替えた後に既定の行ができた・写しが届いていない）時は警告', x.kind === 2 && x.st === 'bad', x);
  x = R({ 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 2, 3) });
  t('既定の行が無く写しも無い方は2番で確定', x.kind === 2 && x.st === '' && x.set.no === 3, x);
  x = R({ r1: { start: 'こわれた', no: 5 }, 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 2, 3) });
  t('読めない形の既定の行は比べない', x.kind === 2 && x.st === '', x);
  x = R({ r1: at(row('2026-11-05', 2, 1), '2026-11-11T00:00:00.000Z'), 'r1:pk': at(row('2026-11-05', 1, 2), '2026-11-10T00:00:00.000Z') });
  t('1番の方は今のまま（指紋が合えば写しも日時も見ない）', x.kind === 1 && x.st === '' && x.set.no === 2, x);
  x = R({ r1: at(base, '2026-11-11T00:00:00.000Z') });
  t('選びの行の無い方は今のまま（既定の行で確定）', x.kind === 1 && x.st === '' && x.set.no === 5, x);
  x = R({ r1: base, 'r1:pk': row('2026-11-10', 2, 3) });
  t('★別の種類の行がまだ届いていない時は既定に倒さず未設定＋警告', x.kind === 2 && x.st === 'bad' && x.set === null, x);
  x = R({ r1: base, 'r1:pkb': pkb, 'r1:pkr': row('2026-11-12', 3), 'r1:pk': row('2026-11-10', 2, 3) });
  t('★別の種類の行の開始日が指紋と違えば未設定＋警告', x.st === 'bad' && x.set === null);
  x = R({ r1: base, 'r1:pkb': pkb, 'r1:pkr': row('2026-11-10', 4), 'r1:pk': row('2026-11-10', 2, 3) });
  t('★別の種類の行の場所が指紋と違えば未設定＋警告', x.st === 'bad' && x.set === null);
  x = R({ r1: base, 'r1:pkb': pkb, 'r1:pkr': row('2026-11-10', 7), 'r1:pk': row('2026-11-10', 2, 7) });
  t('★別の種類の行の番号はその種類の場所の数（6）で確かめる（7番は未設定）', x.kind === 2 && x.st === 'bad' && x.set === null, x);
  x = R({ r1: base, 'r1:pkb': pkb, 'r1:pkr': row('2026-11-10', 8), 'r1:pk': row('2026-11-10', 3, 8) });
  t('場所を書かない種類（3番）は背中8箇所の数で確かめる（8番は使える）', x.kind === 3 && x.st === '' && x.set.no === 8, x);
  x = R({ r1: base, 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 5, 3) });
  t('★選びの行の種類が施設情報に無い時は既定に倒さず未設定（nokind）', x.kind === 1 && x.st === 'nokind' && x.set === null, x);
  x = pure.pcResolve({ r1: base, 'r1:pkr': pkr, 'r1:pk': row('2026-11-10', 2, 3) }, 'r1', null, 8);
  t('★施設情報から kinds が消えた（崩れた）時も、別の種類の方は既定に倒さない', x.st === 'nokind' && x.set === null, x);
  for (const [label, pk] of [['日付が壊れている', row('x', 2, 3)], ['番号が9', row('2026-11-10', 9, 3)], ['塊でない', 'x']]) {
    x = R({ r1: base, 'r1:pkr': pkr, 'r1:pk': pk });
    t('★選びの行が崩れている時は未設定＋警告（' + label + '）', x.st === 'bad' && x.set === null, x);
  }
  t('入れ物を書き換えない（純関数）', (() => { const a = { r1: base, 'r1:pk': row('2026-11-01', 1, 5) }, s = J(a); R(a); return J(a) === s; })());
  /* 手入力 */
  const M = (mk, m2, legacy) => pure.pcResolveManual(mk, m2, kinds, legacy);
  const lg = { start: pure.parseISODate('2026-11-01'), no: 4, prev: 3, by: '', at: '' };
  t('手入力: 種類の印が無い・1 なら今までどおりの手入力の設定', M(null, null, lg).set === lg && M('1', null, lg).kind === 1 && M('1', null, lg).st === '' && M(null, null, null).set === null);
  x = M('2', { kind: 2, start: '2026-11-10', no: 6, prev: 5, by: '職員甲', at: '2026-11-10T00:00:00.000Z' }, lg);
  t('手入力: 別の種類は apc2_m2 の設定（種類の番号が合う時だけ）', x.kind === 2 && x.st === '' && x.set.no === 6 && x.set.prev === 5, x);
  t('★手入力: apc2_m2 の種類の番号が違う・無い時は未設定＋警告', M('2', { kind: 3, start: '2026-11-10', no: 1, prev: 0 }, lg).st === 'bad' && M('2', null, lg).st === 'bad' && M('2', null, lg).set === null);
  t('★手入力: 番号の印が崩れている（9・x）時は未設定＋警告', M('9', null, lg).st === 'bad' && M('x', null, lg).st === 'bad');
  t('★手入力: 施設情報に無い種類は未設定（nokind）', M('5', { kind: 5, start: '2026-11-10', no: 1, prev: 0 }, lg).st === 'nokind');
  t('★手入力: 番号はその種類の場所の数で確かめる（6か所で7番は未設定）', M('2', { kind: 2, start: '2026-11-10', no: 7, prev: 0 }, lg).st === 'bad');
  /* 止める */
  t('名簿の入居者ID が :pk・:pkr・:pkb で終わる方がいれば止める', pure.pcKindStopOf([{ id: 'a1' }, { id: 'X:pk' }]) === true && pure.pcKindStopOf([{ id: 'X:pkr' }]) === true && pure.pcKindStopOf([{ id: 'X:pkb' }]) === true
    && pure.pcKindStopOf([{ id: 'a1' }, { id: 'pk' }, { id: 'X:pkx' }]) === false && pure.pcKindStopOf([]) === false);
}

console.log('\n— 5. 書き出し・読み込み（行ごとの上限）—');
{
  /* 既定の種類が4か所・表示中の種類が6か所の時でも、行ごとの上限で確かめる */
  vm.runInContext('PC_N1 = 4; CYCLE = 6;', pure);
  const all = {
    r1: { start: '2026-11-01', no: 4, prev: 3, by: '職員甲', at: '2026-11-01T00:00:00.000Z' },
    r2: { start: '2026-11-01', no: 6, prev: 0, by: '職員甲', at: '2026-11-01T00:00:00.000Z' },
    'r1:pkr': { start: '2026-11-10', no: 8, prev: 7, by: '職員甲', at: '2026-11-10T00:00:00.000Z' },
    'r1:pk': { start: '2026-11-10', no: 2, prev: 8, by: '職員甲', at: '2026-11-10T00:00:00.000Z' }
  };
  const o = pure.ioExportObj(all, null, '');
  t('写しの行（:pkb）も保存の上限（8）で確かめる', pure.ioEntry({ start: '2026-11-01', no: 8, prev: 0 }, 'r1:pkb') !== null);
  t('★別の種類の行・選びの行は保存の上限（8）で確かめて書き出す（表示中の種類の数で落とさない）', !!o.res['r1:pkr'] && o.res['r1:pkr'].no === 8 && !!o.res['r1:pk'] && o.res['r1:pk'].prev === 8, o.res);
  t('既定の行は既定の種類の場所の数（4）で確かめる（6番は書き出さない）', !!o.res.r1 && !o.res.r2, Object.keys(o.res));
  t('版は v:1 のまま', o.v === 1 && o.app === 'patch-calendar');
  const p = pure.ioParse({ app: 'patch-calendar', v: 1, res: { 'r1:pkr': all['r1:pkr'], 'r1:pk': all['r1:pk'], r2: all.r2, 'r3:pk': { start: '2026-11-10', no: 9, prev: 0 } } });
  t('読み込みも行ごとの上限で確かめ、読めない行は数える（黙って落とさない）', p.ok && !!p.res['r1:pkr'] && !!p.res['r1:pk'] && !p.res.r2 && p.bad === 2, p);
  const pl = pure.ioPlan({ 'r1:pkr': all['r1:pkr'] }, null, pure.ioParse({ app: 'patch-calendar', v: 1, res: { 'r1:pkr': Object.assign({}, all['r1:pkr'], { at: '2026-11-09T00:00:00.000Z', no: 7 }) } }));
  t('合わせる時も行ごとの上限で確かめる（端末の8番の行を壊れた行として置き換えない）', pl.keep === 1 && pl.replace === 0 && pl.merged['r1:pkr'].no === 8, pl);
  vm.runInContext('PC_N1 = 8; CYCLE = 8;', pure);
  t('番号の確かめ: 上限を渡した時はその上限（省くと表示中の種類の数 CYCLE）', pure.parseNo('8', 1, 8) === 8 && pure.parseNo('7', 1, 6) === null && pure.parseNo('0', 0, 6) === 0 && pure.parseNo('9', 1) === null && pure.parseNo('8', 1) === 8);
  const exp = grabFn('ioDoExport');
  t('書き出しの知らせ: 読めなかった行と手入力の別の種類は知らせる（無ければ今の文）', /読めなかった行 ' \+ drop \+ '件は書き出していません。'/.test(exp) && /手入力の設定は、既定でない種類のため書き出しません/.test(exp) && /if \(manOther\) obj\.manual = null;/.test(exp)
    && /'）。' \+ ioNote \+ '新しい端末のこの欄で読み込んでください。'/.test(exp));
}

/* ── 端末の砂場（本物の su-patch-sync.js と画面の保存・読み直しの関数。共通 DB は 0016 の判定どおりの偽物）── */
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
function makeServer() {
  const rows = {}, log = [];
  let failKey = null;
  function put(a) {
    log.push(a.p_resident_id);
    if (failKey && failKey(a.p_resident_id)) return { error: { message: 'Failed to fetch' } };
    if (!ID_RE.test(a.p_resident_id || '')) return { data: { ok: false, error: 'badid' } };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.p_start || '')) return { data: { ok: false, error: 'badstart' } };
    if (!(a.p_no >= 1 && a.p_no <= 8)) return { data: { ok: false, error: 'badno' } };
    if (!(a.p_prev >= 0 && a.p_prev <= 8)) return { data: { ok: false, error: 'badprev' } };
    if (isNaN(Date.parse(a.p_at))) return { data: { ok: false, error: 'badat' } };
    const cur = rows[a.p_resident_id];
    if (!cur) { rows[a.p_resident_id] = { start: a.p_start, no: a.p_no, prev: a.p_prev, by: a.p_by, at: a.p_at }; return { data: { ok: true, created: true } }; }
    if (cur.start === a.p_start && cur.no === a.p_no && cur.prev === a.p_prev) return { data: Object.assign({ ok: true, unchanged: true }, cur) };   // 値が同じ（日時の前後を問わない）
    if (Date.parse(a.p_at) <= Date.parse(cur.at)) return { data: Object.assign({ ok: true, stale: true }, cur) };                                   // 日時が古い・同じ
    rows[a.p_resident_id] = { start: a.p_start, no: a.p_no, prev: a.p_prev, by: a.p_by, at: a.p_at };
    return { data: { ok: true, written: true } };
  }
  return { rows, log, put, setFail: (f) => { failKey = f; } };
}
const DEV_FNS = ['pcStr', 'pcCfgOf', 'pcKindsOf', 'pcRowOf', 'pcKindIn', 'pcResolve', 'pcSameRow', 'pcResolveManual', 'pcKindFor', 'pcKindSave', 'pcPushKind', 'pcProvisional',
  'utcNoon', 'parseISODate', 'parseNo', 'pcSetByOf', 'pad2', 'readByRes', 'resSetting', 'legacySetting', 'saveSettings', 'pcPush', 'pcPushed',
  'pcIsField', 'pcBand', 'pcPull', 'pcPullApply', 'pcPullRetry'];
const clock = { now: Date.parse('2026-11-17T09:00:00+09:00') };
function dateWith(skewMin) {   /* 端末ごとの時計のずれ（分） */
  const off = (skewMin || 0) * 60000;
  return class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now + off); }
    static now() { return clock.now + off; }
  };
}
function device(srv, o) {
  o = o || {};
  const store = Object.assign({ 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}', su_device_role: 'office' }, o.store || {});
  const writes = [], sel = [];
  const ls = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: k => { writes.push('-' + k); delete store[k]; },
    key: i => Object.keys(store)[i]
  };
  Object.defineProperty(ls, 'length', { get: () => Object.keys(store).length });
  const rpcs = [];
  const sb = {
    console, JSON, Math, Date: dateWith(o.skew), Number, String, Array, Object, Promise, Error, isFinite, isNaN, RegExp, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {}, localStorage: ls,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { patch_push: true, patch_read: true } }) }),
    document: { head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      getElementsByTagName: () => [], getElementById: id => (id === 'svband' ? { hidden: true } : null) },
    SUAuth: { STATUS: { OK: 'ok' }, check: () => Promise.resolve({ status: 'ok' }),
      client: () => ({ rpc: (name, args) => {
        rpcs.push(name);
        if (name === 'patch_get') return Promise.resolve({ data: { ok: true, ver: 1, rows: JSON.parse(J(srv.rows)) }, error: null });
        if (name === 'patch_put') return Promise.resolve(srv.put(args));
        if (name === 'patch_put_many') { const rs = (args.items || []).map(a => srv.put(a)); if (rs.some(r => r.error)) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }); return Promise.resolve({ data: rs.map(r => r.data), error: null }); }
        return Promise.resolve({ data: null, error: { message: 'unknown' } });
      } }) }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SYNC, sb, { filename: 'su-patch-sync.js' });
  const vars = [grabVar('PC_SITE_MIN'), grabVar('PC_BAD_CH'), grabVar('PC_KIND_MAX'), grabVar('LS_MKIND'), grabVar('pcPullGen'), grabVar('PC_RETRY_MS'),
    "var LS_BYRES = 'apc2_res', LS_START = 'apc2_start', LS_NO = 'apc2_no', LS_PREV = 'apc2_prev', LS_SETBY = 'apc2_setby';",
    'var DEF_SITES = new Array(8), SITES = DEF_SITES, CYCLE = 8, PC_N1 = 8;',
    'var PKINDS = pcKindsOf(' + J({ kinds: o.kinds === undefined ? KINDS_RAW : o.kinds }) + '), pcKindsBad = false, pcKindCur = 1, pcKindStop = ' + J(!!o.stop) + ';',
    "var state = { rid: '', start: null, no: 1, prev: 0, confirmed: false, canSave: true, storeBad: false, setBy: '', setAt: '', kindSt: '' };",
    "function pcWho() { return '職員甲'; }",
    'var __sel = [];',
    /* 選び直し: 画面と同じく種類と設定を決め直して状態に入れる（描画はしない） */
    'function selectResident(r) { __sel.push(r); state.rid = r; var kr = pcKindFor(r); state.kindSt = kr.st; pcKindCur = kr.kind;'
      + ' if (kr.set) { state.start = kr.set.start; state.no = kr.set.no; state.prev = kr.set.prev; state.confirmed = true; } else { state.confirmed = false; } }'
  ].join('\n');
  vm.runInContext(vars + '\n' + DEV_FNS.map(grabFn).join('\n'), sb, { filename: 'patch-calendar.html' });
  const api = {
    sb, store, writes, rpcs, sel: () => sb.__sel.slice(),
    res: () => { try { return JSON.parse(store.apc2_res || 'null').r; } catch (e) { return '壊れ'; } },
    /* 画面で「種類 kind を選び（pick）、開始日・場所を入れて保存した」のと同じ。pick を省くと表示中の種類のまま直した */
    save: async (rid, kind, start, no, prev, pick, st) => {
      vm.runInContext('state.rid = ' + J(rid) + '; pcKindCur = ' + kind + "; state.kindSt = " + J(st !== undefined ? st : (pick ? 'pick' : '')) + '; state.confirmed = ' + J(st === undefined) + ';'
        + ' state.start = parseISODate(' + J(start) + '); state.no = ' + no + '; state.prev = ' + (prev || 0) + '; saveSettings();', sb);
      await settle();
    },
    resolve: (rid) => vm.runInContext('pcKindFor(' + J(rid) + ')', sb),
    pull: async (rid) => { if (rid !== undefined) vm.runInContext('state.rid = ' + J(rid), sb); vm.runInContext('pcPull()', sb); await settle(); },
    pushAll: async () => { await sb.SUPatchSync.pushAll(); await settle(); },
    run: (s) => vm.runInContext(s, sb)
  };
  return api;
}
const tick = (min) => { clock.now += (min || 30) * 60000; };

(async () => {
  console.log('\n— 3. 保存（既定の種類は今までの道・別の種類は別の枝）—');
  {
    const srv = makeServer(), d = device(srv);
    await d.save('r1', 1, '2026-11-01', 5, 4);
    t('★既定の種類で選びの行の無い方は、今までどおり既定の行だけを書く（選びの行を作らない）', J(Object.keys(d.res())) === J(['r1']) && d.res().r1.no === 5 && d.res().r1.by === '職員甲', d.res());
    t('★送るのも既定の行だけ（今と同じ6つの中身）', J(srv.log) === J(['r1']) && J(Object.keys(srv.rows)) === J(['r1']), srv.log);
    tick();
    await d.save('r1', 2, '2026-11-10', 3, 2, true);
    const r = d.res();
    t('★別の種類は、設定の行（:pkr）と選びの行（:pk）を同じ日時で書く・既定の行はそのまま', r['r1:pkr'] && r['r1:pk'] && r['r1:pkr'].at === r['r1:pk'].at && r.r1.start === '2026-11-01' && r.r1.no === 5, r);
    t('★選びの行の no は種類の番号・start と prev は選んだ設定の開始日と場所（指紋）', r['r1:pk'].no === 2 && r['r1:pk'].start === '2026-11-10' && r['r1:pk'].prev === 3 && r['r1:pkr'].no === 3 && r['r1:pkr'].prev === 2, r['r1:pk']);
    t('★送る順は 既定の行の写し → 設定の行 → 選びの行', J(srv.log.slice(1)) === J(['r1:pkb', 'r1:pkr', 'r1:pk']), srv.log);
    t('★既定の行の写し（:pkb）は既定の行と同じ値・同じ日時で書く', J([r['r1:pkb'].start, r['r1:pkb'].no, r['r1:pkb'].prev]) === J(['2026-11-01', 5, 4]) && r['r1:pkb'].at === r['r1:pk'].at, r['r1:pkb']);
    t('保存の後は確定（警告の状態を外す）', d.run('state.confirmed && state.kindSt === "" && state.setBy === "職員甲"') === true);
    const rv = d.resolve('r1');
    t('保存した方は2番・その設定で確定', rv.kind === 2 && rv.st === '' && rv.set.start.iso === '2026-11-10' && rv.set.no === 3, rv);
    /* 2番のまま場所だけ直す */
    tick();
    await d.save('r1', 2, '2026-11-10', 4, 3);
    t('2番のまま直した時も 設定の行 → 選びの行 を書き直す（指紋がそろう）', d.resolve('r1').st === '' && d.resolve('r1').set.no === 4 && d.res()['r1:pk'].prev === 4 && J(srv.log.slice(-2)) === J(['r1:pkr', 'r1:pk']), srv.log);
    /* 1番へ戻す（選びの行は消せないので種類 1 を書く） */
    tick();
    await d.save('r1', 1, '2026-11-20', 6, 5, true);
    const r2 = d.res(), v2 = d.resolve('r1');
    t('★1番へ戻すと既定の行と選びの行（種類1・指紋）を書く・別の種類の行は残す（消さない）', r2.r1.start === '2026-11-20' && r2['r1:pk'].no === 1 && r2['r1:pk'].prev === 6 && !!r2['r1:pkr'] && v2.kind === 1 && v2.st === '' && v2.set.no === 6, r2);
    tick();
    await d.save('r1', 1, '2026-11-20', 7, 6);
    t('選びの行のある1番の方を直した時も選びの行の指紋を書き直す', d.resolve('r1').st === '' && d.res()['r1:pk'].prev === 7 && J(srv.log.slice(-2)) === J(['r1', 'r1:pk']), srv.log.slice(-2));
    /* 手入力 */
    const m = device(makeServer());
    await m.save('', 1, '2026-11-01', 2, 1);
    t('★手入力の既定の種類は今までどおり apc2_start/no/prev だけ（種類の印を書かない）', m.store.apc2_no === '2' && !('apc2_mkind' in m.store) && !('apc2_m2' in m.store));
    m.writes.length = 0; tick();
    await m.save('', 3, '2026-11-05', 8, 7, true);
    t('★手入力の別の種類は apc2_m2 → apc2_mkind の順・今までの手入力の設定は残す', J(m.writes) === J(['apc2_m2', 'apc2_mkind']) && m.store.apc2_mkind === '3' && JSON.parse(m.store.apc2_m2).kind === 3 && m.store.apc2_no === '2', m.writes);
    t('手入力の別の種類で確定', m.resolve('').kind === 3 && m.resolve('').set.no === 8);
    tick();
    await m.save('', 1, '2026-11-25', 4, 0, true);
    t('手入力を既定の種類へ戻すと今までの手入力の設定を書き、種類の印を 1 にする', m.store.apc2_no === '4' && m.store.apc2_mkind === '1' && m.resolve('').kind === 1 && m.resolve('').set.no === 4);
    t('手入力は送らない（入居者ID を持たない）', m.rpcs.filter(n => n === 'patch_put').length === 0);
    /* 止めた時 */
    const s = device(makeServer(), { stop: true });
    await s.save('r1', 2, '2026-11-10', 3, 2, true);
    t('★種類の機能を止めている時は今までの道（既定の行だけ・選びの行を書かない）', J(Object.keys(s.res())) === J(['r1']), s.res());
  }

  console.log('\n— 4. 共通 DB を通して（A→B→A・2台・片方だけ・古い画面）—');
  {
    const srv = makeServer(), d1 = device(srv), d2 = device(srv);
    tick(); await d1.save('r1', 1, '2026-11-01', 5, 4);
    tick(); await d1.save('r1', 2, '2026-11-10', 3, 2, true);
    tick(); await d2.pull('r1');
    let v = d2.resolve('r1');
    t('★2台: 1台目で2番にした方は、2台目が読み直すと2番のその設定で確定', v.kind === 2 && v.st === '' && v.set.start.iso === '2026-11-10' && v.set.no === 3, v);
    t('★読み直しは今の方の別の鍵が変わった時も取り直す', d2.sel().indexOf('r1') >= 0, d2.sel());
    tick(); await d1.save('r1', 1, '2026-11-20', 6, 5, true);
    tick(); await d2.pull('r1');
    v = d2.resolve('r1');
    t('★A→B→A: 1番へ戻したのが2台目にも届き、既定の種類の新しい設定で確定', v.kind === 1 && v.st === '' && v.set.start.iso === '2026-11-20' && v.set.no === 6, v);
    tick(); await d1.save('r1', 2, '2026-11-10', 3, 2, true);
    const sel0 = d2.sel().length;
    tick(); await d2.pull('r1');
    v = d2.resolve('r1');
    t('★A→B→A→B: 別の種類の行が同じ値（サーバーは unchanged）でも、選びの行が変わるので2番で確定', v.kind === 2 && v.st === '' && v.set.no === 3, v);
    t('★選びの行だけが変わった時も、今の方を取り直す（既定の行の変化だけを見ない）', d2.sel().length === sel0 + 1 && d2.sel()[sel0] === 'r1', d2.sel());

    /* 片方だけ載る: 選びの行が届かない */
    srv.setFail(k => /:pk$/.test(k));
    tick(); await d1.save('r1', 2, '2026-11-15', 1, 3);
    tick(); await d2.pull('r1');
    v = d2.resolve('r1');
    t('★片方だけ載る（設定の行だけ）: 2台目は既定に倒さず未設定＋警告', v.st === 'bad' && v.set === null, v);
    t('届かなかった選びの行は1台目の送信待ちに残る', d1.sb.SUPatchSync.pending().indexOf('r1:pk') >= 0, d1.sb.SUPatchSync.pending());
    srv.setFail(null);
    tick(); await d1.pushAll();
    tick(); await d2.pull('r1');
    v = d2.resolve('r1');
    t('送り直して選びの行が載れば2台目も確定', v.kind === 2 && v.st === '' && v.set.start.iso === '2026-11-15' && v.set.no === 1, v);
    /* 片方だけ載る: 設定の行が届かない */
    srv.setFail(k => /:pkr$/.test(k));
    tick(); await d1.save('r1', 2, '2026-11-18', 2, 1);
    tick(); await d2.pull('r1');
    v = d2.resolve('r1');
    t('★片方だけ載る（選びの行だけ）: 2台目は前の設定を出さず未設定＋警告', v.st === 'bad' && v.set === null, v);
    srv.setFail(null);
    tick(); await d1.pushAll(); tick(); await d2.pull('r1');
    t('送り直して設定の行が載れば確定', d2.resolve('r1').st === '' && d2.resolve('r1').set.start.iso === '2026-11-18');

    /* 古い画面（種類を知らない画面）: 既定の行だけを今までの道で直し、選びの行・別の種類の行を消さない */
    const old = device(srv, { kinds: null, stop: true });   // 止めた道＝今までの保存の道（古い画面と同じ書き方）
    tick(); await old.pull('r1');
    t('★古い画面の読み直しでも選びの行・別の種類の行は控えに入り、消えない', !!old.res()['r1:pk'] && !!old.res()['r1:pkr'], Object.keys(old.res()));
    tick(); await old.save('r1', 1, '2026-11-19', 8, 7);
    t('★古い画面が既定の行を直しても、選びの行・別の種類の行は控えにもサーバーにも残る', !!old.res()['r1:pk'] && !!old.res()['r1:pkr'] && !!srv.rows['r1:pk'] && !!srv.rows['r1:pkr'] && srv.rows.r1.start === '2026-11-19');
    tick(); await d2.pull('r1');
    v = d2.resolve('r1');
    t('★古い画面が既定の行を直したら（写しと値が違う）、2番の方は既定の行に倒れず、黙って捨てずに未設定＋警告', v.kind === 2 && v.st === 'bad' && v.set === null, v);
    /* 差分の審査 2026-11-17 の3: 2台目が同じ種類・同じ値で入れ直しても、ほかの端末で警告が消える（写しの値が変わるので unchanged にならない） */
    tick(); vm.runInContext("state.rid = 'r1'; state.kindSt = 'bad';", d2.sb);
    const d2before = J(d2.res()), put0 = d2.rpcs.filter(n => n === 'patch_put').length;
    await d2.save('r1', 2, '2026-11-25', 5, 4, false, 'bad');   /* 今の値（11-18・2番）と違う値を入れる */
    t('★警告の方は、人が種類を選ばずに入れ直しても保存しない（控えを変えない・:pkr の開始日も変わらない・送らない）',
      J(d2.res()) === d2before && d2.res()['r1:pkr'].start === '2026-11-18' && d2.rpcs.filter(n => n === 'patch_put').length === put0, { r: d2.res()['r1:pkr'], rpcs: d2.rpcs });
    const before2 = J(srv.rows);
    tick(); await d2.save('r1', 2, '2026-11-18', 2, 1, true);
    t('★人が種類を選んで（同じ2番・同じ値で）入れ直すと、写しは今の既定の行の値になる', srv.rows['r1:pkb'] && srv.rows['r1:pkb'].start === '2026-11-19' && srv.rows['r1:pkb'].no === 8 && J(srv.rows) !== before2, srv.rows['r1:pkb']);
    tick(); await d1.pull('r1');
    v = d1.resolve('r1');
    t('★入れ直した後は、ほかの端末（1台目）でも警告が消えて2番で確定', v.kind === 2 && v.st === '' && v.set.start.iso === '2026-11-18', v);
    /* 時計の遅れた古い画面が直しても、値が違えば警告（日時に頼らない） */
    const midAt = Date.parse(srv.rows.r1.at) + 15 * 60000;   // 今より大きく遅れた時計（前の既定の行の書き込みの15分後の日時で書く）
    const slow = device(srv, { kinds: null, stop: true, skew: (midAt - (clock.now + 60 * 60000)) / 60000 });   // 既定の行の前の書き込みより後・選びの行より前の日時で書く端末（日時で比べると見逃す）
    tick(); await slow.pull('r1'); tick(); await slow.save('r1', 1, '2026-11-21', 3, 2);
    tick(); await d1.pull('r1');
    v = d1.resolve('r1');
    t('★時計の遅れた端末が既定の行を直しても、写しと値が違うので警告（日時に頼らない）', srv.rows.r1.start === '2026-11-21' && Date.parse(srv.rows.r1.at) < clock.now - 60 * 60000 && v.st === 'bad', { r: srv.rows.r1, v });
    /* 1番の方を古い画面が直すと指紋が合わず警告（安全側） */
    tick(); await d1.save('r2', 2, '2026-11-10', 3, 2, true);
    tick(); await d1.save('r2', 1, '2026-11-11', 4, 3, true);
    tick(); await old.pull('r2'); tick(); await old.save('r2', 1, '2026-11-12', 5, 4);
    tick(); await d2.pull('r2');
    v = d2.resolve('r2');
    t('★選びの行が1番の方を古い画面が直すと、指紋が合わず未設定＋警告（安全側）', v.kind === 1 && v.st === 'bad' && v.set === null, v);
    t('送る中身は今の6つのまま（部品は変えていない）', d1.rpcs.indexOf('patch_put') >= 0 && !/:pk/.test(SYNC));
  }

  console.log('\n— 8. 食い違い・無い種類・止めた方の保存（差分の審査 2026-11-17）—');
  {
    const at0 = '2026-11-10T00:00:00.000Z';
    const seed = { r1: { start: '2026-11-01', no: 5, prev: 4, by: 'x', at: at0 }, 'r1:pk': { start: '2026-11-10', no: 5, prev: 3, by: 'x', at: at0 },
      'r1:pkr': { start: '2026-11-10', no: 3, prev: 0, by: 'x', at: at0 } };
    const store = () => ({ apc2_res: J({ v: 1, r: seed }) });
    const srv = makeServer(), d = device(srv, { store: store() });
    t('施設情報に無い種類（5番）の方は nokind', d.resolve('r1').st === 'nokind');
    const w0 = d.writes.length;
    await d.save('r1', 1, '2026-11-20', 2, 0, false, 'nokind');
    t('★無い種類の方は、人が種類を選ばずに日付・場所を入れても保存しない（1番で確定して送らない）', d.writes.length === w0 && d.rpcs.indexOf('patch_put') < 0 && J(d.res()) === J(seed), d.writes.slice(w0));
    t('保存しない時は警告の状態のまま（確定にしない）', d.run("state.kindSt === 'nokind' && state.confirmed === false") === true);
    await d.save('r1', 1, '2026-11-20', 2, 0, true);
    t('人が種類（1番）を選べば保存する', d.res().r1.start === '2026-11-20' && d.res()['r1:pk'].no === 1 && d.resolve('r1').st === '', d.res());
    const b = device(makeServer(), { store: store() });
    await b.save('r1', 2, '2026-11-20', 2, 0, false, 'bad');
    t('★食い違いの方も、人が種類を選ばずに入れ直しても保存しない', J(b.res()) === J(seed) && b.rpcs.indexOf('patch_put') < 0);
    const m = device(makeServer(), { store: { apc2_mkind: '5', apc2_no: '3', apc2_start: '2026-11-01' } });
    await m.save('', 1, '2026-11-20', 2, 0, false, 'nokind');
    t('手入力でも、無い種類の時は人が選ぶまで保存しない', m.store.apc2_mkind === '5' && m.store.apc2_no === '3');
    /* 止めた時（kinds を書いた施設）: 別の種類に替えてあった方は確定にしない */
    const st = device(makeServer(), { store: store(), stop: true });
    t('★止めた時、別の種類に替えてあった方は確定にせず注意（stopk）', st.resolve('r1').st === 'stopk' && st.resolve('r1').set === null, st.resolve('r1'));
    await st.save('r1', 1, '2026-11-20', 2, 0, false, 'stopk');
    t('止めた時の別の種類の方は保存しない', J(st.res()) === J(seed));
    const st1 = device(makeServer(), { store: { apc2_res: J({ v: 1, r: { r1: seed.r1, 'r1:pk': { start: '2026-11-01', no: 1, prev: 5, by: 'x', at: at0 } } }) }, stop: true });
    t('止めた時、1番の方は今までどおり既定の行で確定', st1.resolve('r1').st === '' && st1.resolve('r1').set.no === 5);
    const nk = device(makeServer(), { store: store(), stop: true, kinds: null });
    t('★kinds を書いていない施設で止めた時は今までどおり（選びの行のような鍵があっても既定の行で確定）', nk.resolve('r1').st === '' && nk.resolve('r1').set.no === 5, nk.resolve('r1'));
  }

  console.log('\n— 9. 印刷の前の読み直し（失敗・時間切れ・成功）—');
  {
    const runFresh = async (pullImpl, o) => {
      o = o || {};
      const conf = [], prints = [];
      const c = { Promise, setTimeout, Error, String, window: {}, isoMonth: (y, m) => y + '-' + m, jpDate: (x) => x.iso, el: { nm: { value: '架空 一郎' } } };
      c.window.confirm = (m) => { conf.push(String(m)); return true; };
      c.window.print = () => { prints.push(1); };
      c.window.SUPatchSync = { pull: pullImpl, readSwitchOn: () => true };
      vm.createContext(c);
      vm.runInContext("var PC_FRESH_MS = 30, pcFreshWaiting = false, pcPullGen = 0, printAck = null, pcKindCur = 2;"
        + "var state = { rid: 'r1', y: 2026, m: 1, start: { iso: '2026-01-05' }, no: 3, prev: 0, confirmed: true, kindSt: '' };"
        + "function pcKindUiOn() { return " + J(o.kinds !== false) + "; } function pcIsField() { return false; }"
        + "function pcKindName() { return '架空テープ（6箇所）'; } var __ap = []; function pcPullApply(r, g) { __ap.push(r.status); }"
        + "var PC_KIND_STOPK_MSG = 'x';\n" + grabFn('pcPrintFresh') + '\n' + grabFn('pcPrint'), c);
      vm.runInContext('pcPrintFresh()', c);
      await new Promise(r => setTimeout(r, 80)); await settle();
      return { conf, prints, applied: c.__ap };
    };
    const LINE = 'ほかの端末の種類の変更を読み直せませんでした。今の表示で印刷します。';
    const okR = await runFresh(() => Promise.resolve({ status: 'ok', rows: {} }));
    t('★読み直せた時は窓に1行を足さずに刷る', okR.prints.length === 1 && okR.conf.length === 1 && okR.conf[0].indexOf(LINE) < 0 && J(okR.applied) === J(['ok']), okR);
    const ngR = await runFresh(() => Promise.resolve({ status: 'unreachable' }));
    t('★読み直しが失敗した時は窓に1行を足して、止めずに刷る', ngR.prints.length === 1 && ngR.conf.length === 1 && ngR.conf[0].indexOf(LINE) > 0, ngR);
    const rjR = await runFresh(() => Promise.reject(new Error('x')));
    t('読み直しが例外の時も1行を足して刷る', rjR.prints.length === 1 && rjR.conf.length === 1 && rjR.conf[0].indexOf(LINE) > 0, rjR);
    const lateR = await runFresh(() => new Promise(() => {}));
    t('★時間切れ（返ってこない）の時も1行を足して刷る', lateR.prints.length === 1 && lateR.conf.length === 1 && lateR.conf[0].indexOf(LINE) > 0 && lateR.applied.length === 0, lateR);
    const noK = await runFresh(() => Promise.resolve({ status: 'unreachable' }), { kinds: false });
    t('★kinds の無い施設は読み直さず、今の窓の文のまま刷る', noK.prints.length === 1 && noK.conf.length === 1 && noK.conf[0].indexOf(LINE) < 0 && noK.applied.length === 0, noK);
  }

  console.log('\n— 7. 画面のつなぎ —');
  {
    const save = grabFn('saveSettings');
    t('★保存の入口の最初で別の枝（pcKindSave）へ抜ける', /^\nfunction saveSettings\(\) \{\n  if \(pcKindSave\(\)\) return;/.test(save));
    t('今までの保存の道の文は残る（既定の種類の行・by・at）', /all\[state\.rid\] = \{ start: state\.start\.iso, no: state\.no, prev: state\.prev, by: by, at: at \};/.test(save) && (save.match(/pcPush\(/g) || []).length === 1);
    const ks = grabFn('pcKindSave');
    t('別の種類の保存は 設定の行 → 選びの行（同じ by・at）', /all\[k === 1 \? rid : rid \+ ':pkr'\] = \{ start: state\.start\.iso, no: state\.no, prev: state\.prev, by: by, at: at \};\n\s*all\[rid \+ ':pk'\] = \{ start: state\.start\.iso, no: k, prev: state\.no, by: by, at: at \};/.test(ks));
    t('★既定の種類で選びの行の無い方は今までの道へ', /if \(k === 1 && !hasPk && state\.kindSt !== 'pick'\) return false;/.test(ks) && /if \(all === null\) return false;/.test(ks));
    const pr = PAGE.slice(PAGE.indexOf('\nfunction pcPrint('), scanBlock(PAGE, PAGE.indexOf('\nfunction pcPrint(')) + 1);
    t('★印刷の確かめの鍵に種類（既定の種類の時は今の鍵のまま）', /\+ \(pcKindCur !== 1 \? '\|k' \+ pcKindCur : ''\);/.test(pr) && /\+ '\|' \+ \(state\.confirmed \? 1 : 0\)/.test(pr));
    t('種類を選べる施設では印刷の確かめに薬の名前を出す（選べない施設は今の文）', /if \(pcKindUiOn\(\)\) who \+= '・' \+ pcKindName\(pcKindCur\);/.test(pr));
    t('★取り直しは今の方の4つの鍵のどれかが変われば', /\[state\.rid, state\.rid \+ ':pk', state\.rid \+ ':pkr', state\.rid \+ ':pkb'\]\.some\(/.test(grabFn('pcPullApply')));
    t('★選ぶ欄は HTML に書かずスクリプトで作る（kinds を書いていない施設の画面は今のまま）', PAGE.indexOf('id="pcKind"') < 0 && PAGE.indexOf('id="pcKindRow"') < 0 && /sel\.id = 'pcKind';/.test(grabFn('pcKindUi')));
    t('選ぶ欄は kinds を書いて止めていない時だけ', /function pcKindUiOn\(\) \{ return !!PKINDS && !pcKindStop; \}/.test(PAGE) && /if \(!pcKindUiOn\(\)\)/.test(grabFn('pcKindUi')));
    const ui = ['pcKindUi', 'pcKindName', 'pcSetKind', 'pcKindPick'].map(grabFn).join('\n');
    t('外からの文字を innerHTML で入れない', !/innerHTML|insertAdjacentHTML|outerHTML/.test(ui) && /op\.textContent = pcKindName\(k\);/.test(ui));
    t('帯は画面だけ（noprint・svband）・止めた時と崩れた時だけ作る', /b\.className = 'hint warn svband noprint';/.test(grabFn('pcKindUi')) && /var msg = \(pcKindStop && \(PKINDS \|\| pcKindsBad\)\) \? PC_KIND_STOP_MSG : \(pcKindsBad \? PC_KIND_BAD_MSG : ''\);/.test(grabFn('pcKindUi')));
    t('★種類を当てる pcSetKind は葉（選び直し・描き直しを呼ばない＝作り直しとの循環を作らない）', !/selectResident|render\(\)|pcRebuild|loadState/.test(grabFn('pcSetKind')));
    t('選び直しで種類を当てる（selectResident → pcSetKind）', /var kr = pcKindFor\(rid\);\n\s*state\.kindSt = kr\.st;\n\s*pcSetKind\(kr\.kind\);/.test(grabFn('selectResident')));
    t('名簿を読んだ時に止めるかを決め、起動では名簿を状態より先に読む', /pcKindStop = pcKindStopOf\(roster\);/.test(grabFn('loadRoster')) && /\nloadRoster\(\);[^\n]*\nloadState\(\);/.test(PAGE));
    t('施設情報の印は kinds を書いた時だけ足す（書いていない施設は今と同じ）', /if \(kd\.list \|\| kd\.bad\) sig \+= '\|kinds:' \+ JSON\.stringify\(kd\);/.test(grabFn('pcApplyCfg')));
    t('警告の文（仮置き）が3つある', ['貼り薬の種類と、開始日・場所の設定が食い違っています', '選んであった貼り薬の種類が施設情報にありません', '貼り薬の種類を替えました。開始日と場所を入れ直してください'].every(s => grabFn('renderHeaderInfo').indexOf(s) > 0));
    t('★列の意味の流用（選びの行の no は種類の番号）を注釈に書いている', /<入居者ID>:pk   … 選びの行。★site_no（控えの no）は「種類の番号」/.test(PAGE));
    t('部品（su-patch-sync.js）は種類を知らない（:pk・:pkr の文字が無い）', !/:pkr?\b|pcKind/.test(SYNC));
    t('★食い違い・無い種類・止めた方は、人が選んだ時（pick）だけ保存（保存の入口の最初で止める）', /function pcKindSave\(\) \{\n(?:\s*\/\*[\s\S]*?\*\/\n)?\s*if \(state\.kindSt === 'bad' \|\| state\.kindSt === 'nokind' \|\| state\.kindSt === 'stopk'\) return true;/.test(PAGE));
    const hi = grabFn('renderHeaderInfo');
    t('警告の文は、選ぶ欄がある時は「選び直してから」、無い時は「保存できません」', /pcKindUiOn\(\) \? '「貼り薬の種類」で種類を選び直してから/.test(hi) && /施設情報が読めるまで（または管理者が貼り薬の種類を直すまで）、この方の設定は保存できません。/.test(hi));
    t('★食い違い・無い種類の時は選ぶ欄を「選び直してください」にする（同じ種類を選んでも選んだことになる）', /\(state\.kindSt === 'nokind' \|\| state\.kindSt === 'bad'\) \? '0'/.test(grabFn('pcSetKind')));
    t('★kinds の施設で、事務所PCで方を選んだ時に1回読み直す', /el\.rs\.addEventListener\('change', function \(\) \{ selectResident\(el\.rs\.value\); pcKindRefresh\(\); \}\);/.test(PAGE) && /if \(state\.rid && pcKindUiOn\(\) && !pcIsField\(\)\) pcPull\(\);/.test(grabFn('pcKindRefresh')));
    const pf = grabFn('pcPrintFresh');
    t('★kinds の施設で、事務所PC・読むスイッチが入の時は刷る前に1回読み直す（それ以外はその場で刷る・失敗でも刷る）',
      /if \(!state\.rid \|\| !pcKindUiOn\(\) \|\| pcIsField\(\) \|\| !sp \|\| !sp\.pull \|\| !sp\.readSwitchOn \|\| !sp\.readSwitchOn\(\)\) \{ pcPrint\(\); return; \}/.test(pf) && /\.then\(function \(\) \{ pcFreshWaiting = false; pcPrint\(ng\); \}\);/.test(pf)
      && (PAGE.match(/pcPrintFresh\(\);/g) || []).length === 2);
    const pr2 = PAGE.slice(PAGE.indexOf('\nfunction pcPrint('), scanBlock(PAGE, PAGE.indexOf('\nfunction pcPrint(')) + 1);
    t('現場の端末で kinds の施設の方を刷る時は確かめに1行・止めた方には注意', /if \(pcKindUiOn\(\) && pcIsField\(\)\) prov \+= '\\n\\nこの端末はほかの端末の種類の変更を受け取りません。';/.test(pr2) && /if \(state\.kindSt === 'stopk'\) prov \+= /.test(pr2));
    t('★手入力の保存の鍵は apc2_mkind・apc2_m2', /var LS_MKIND = 'apc2_mkind', LS_M2 = 'apc2_m2';/.test(PAGE));
  }

  finished = true;
  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { finished = true; console.log('  ✗ 例外: ' + (e && e.stack)); process.exit(1); });
