/* 入居者マスタ（resident-master.html）とフェイスシート（facesheet.html）の「食事の時刻の施設の既定」の試験（2026-11-02・品質改善 第3期 便8）。
   守りたいこと:
     A 印 MEAL-TIMES-BEGIN〜END の間（施設の既定を決める関数）が2画面で一字一句同じで、1つずつだけある
     B 施設情報（SUFacility.section('mealTimes')）に4つ全部が正しい時刻で書いてある時だけ差し替わる（2画面とも）
     C 崩れた塊（知らない項目・1つ欠け・文字でない・形の違い・24時・60分・配列・読み口の例外）は丸ごと捨てて今の既定に戻る
     D 塊が無い・読み口が無い時は今と一字一句同じ値（08:00・12:00・15:00・17:30・起床と就寝は空）
     E 入居者ごとに保存した時刻が必ず勝つ（施設の既定を書いてあっても）
     F 施設情報が後から届いた時、描いた時と既定が違う時だけ1回描き直す（現場端末・一覧の画面・編集画面では描き直さない）
   ★画面の本物の関数を切り出して vm で動かす。偽物にするのは SUFacility・画面の部品（$・描く関数）だけ。値はすべて架空。
   実行: node "…/check/unit/meal_times_facility_test.js"
     （読む HTML は環境変数 MASTER_HTML・FACESHEET_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
/* 入居者マスタの画面のスクリプトは 2026-11-13 に resident-master.js へ移した（判定の区間 MC-JUDGE だけ HTML に残す）。移す前と同じ文字に戻して確かめる */
const { readMaster } = require('../master-page.cjs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const MASTER = readMaster(process.env.MASTER_HTML || path.join(ROOT, 'resident-master.html'));
const FX = fs.readFileSync(process.env.FACESHEET_HTML || path.join(ROOT, 'facesheet.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, got, want) { const g = JSON.stringify(got), w = JSON.stringify(want); t(n, g === w, { 期待: want, 実際: got }); }
function group(name) { console.log('\n■ ' + name); }

/* 文字列・コメント・正規表現の中のかっこを数えない切り出し（facility_print_gate_test.js と同じ作法） */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grab(src, header) {
  const s = src.indexOf(header);
  if (s < 0) return null;
  const e = scanBlock(src, s);
  return e < 0 ? null : src.slice(s, e + 1);
}

const BLOCK_RE = /\/\* MEAL-TIMES-BEGIN[\s\S]*?\/\* MEAL-TIMES-END \*\//g;
const DEFAULTS_LINE = "var RHYTHM_DEFAULTS={breakfast:'08:00', lunch:'12:00', snack:'15:00', dinner:'17:30'};";
const RH_KEYS_LINE = (MASTER.match(/\nvar RHYTHM_KEYS=\[[^\n]*\];/) || [''])[0];
const DEF = { breakfast: '08:00', lunch: '12:00', snack: '15:00', dinner: '17:30' };
const DEF6 = { wake: '', breakfast: '08:00', lunch: '12:00', snack: '15:00', dinner: '17:30', sleep: '' };
const GOOD = { breakfast: '07:30', lunch: '11:45', snack: '14:30', dinner: '18:00' };   /* 架空の施設の時刻 */
const GOOD6 = { wake: '', breakfast: '07:30', lunch: '11:45', snack: '14:30', dinner: '18:00', sleep: '' };

/* ═══ A. 2画面で同じ ═══ */
group('A. 施設の既定を決める関数が2画面で一字一句同じ');
const bm = MASTER.match(BLOCK_RE) || [], bf = FX.match(BLOCK_RE) || [];
t('入居者マスタに印の区間が1つだけある', bm.length === 1, bm.length);
t('フェイスシートに印の区間が1つだけある', bf.length === 1, bf.length);
t('2画面の区間が一字一句同じ', bm.length === 1 && bf.length === 1 && bm[0] === bf[0]);
t('入居者マスタの既定の値は今のまま', MASTER.split(DEFAULTS_LINE).length === 2);
t('フェイスシートの既定の値は今のまま', FX.split(DEFAULTS_LINE).length === 2);
/* 既定を直接読むのは区間の中だけ（呼ぶ側が RHYTHM_DEFAULTS を直接読むと施設の値が効かない） */
const outside = (src, blk) => src.replace(blk || '', '').split('RHYTHM_DEFAULTS').length - 1;
eq('入居者マスタで RHYTHM_DEFAULTS を区間の外で読むのは宣言の1か所だけ', outside(MASTER, bm[0]), 1);
eq('フェイスシートで RHYTHM_DEFAULTS を区間の外で読むのは宣言の1か所だけ', outside(FX, bf[0]), 1);

/* ═══ 動かす道具 ═══ */
/* fac: undefined＝SUFacility が無い／関数＝section の中身／'nofn'＝section が関数でない／'throw'＝例外 */
function mkWin(fac) {
  if (fac === undefined) return {};
  if (fac === 'nofn') return { SUFacility: { section: 1 } };
  if (fac === 'throw') return { SUFacility: { section() { throw new Error('x'); } } };
  return { SUFacility: { section: (n) => (n === 'mealTimes' ? fac() : null) } };
}
function masterRhythm(fac, rec) {
  const ctx = { window: mkWin(fac) };
  ctx.SUFacility = ctx.window.SUFacility;
  vm.createContext(ctx);
  vm.runInContext(RH_KEYS_LINE + '\n' + DEFAULTS_LINE + '\n' + (bm[0] || '') + '\n' + grab(MASTER, '\nfunction rhythmOf(') + '\n;this.__f=rhythmOf;', ctx);
  return JSON.parse(JSON.stringify(ctx.__f(rec)));
}
/* フェイスシートは事務所の表示（renderOfficeView）の中の重ね合わせ（即時関数）を切り出して動かす */
const FS_IIFE = (() => {
  const s = FX.indexOf('var rhythm=(function(src){');
  if (s < 0) return null;
  const e = FX.indexOf('})(r.rhythm);', s);
  return e < 0 ? null : FX.slice(s, e + '})(r.rhythm);'.length);
})();
function fsRhythm(fac, rec) {
  const ctx = { window: mkWin(fac) };
  ctx.SUFacility = ctx.window.SUFacility;
  vm.createContext(ctx);
  vm.runInContext(DEFAULTS_LINE + '\nvar fsMealSig_=null;\n' + (bf[0] || '') + '\nfunction __f(r){ ' + FS_IIFE + ' return rhythm; }\nthis.__f=__f;', ctx);
  const out = ctx.__f(rec || {});
  /* 画面と同じ6項目の並びで見る（フェイスシートは値のある項目だけを出す） */
  const RH = ['wake', 'breakfast', 'lunch', 'snack', 'dinner', 'sleep'], o = {};
  RH.forEach((k) => { o[k] = out[k] || ''; });
  return { o, sig: ctx.fsMealSig_ };
}
t('入居者マスタの rhythmOf を切り出せる', !!grab(MASTER, '\nfunction rhythmOf('));
t('フェイスシートの重ね合わせを切り出せる', !!FS_IIFE);
function both(label, fac, rec, want6) {
  let m = null, f = null;
  try { m = masterRhythm(fac, rec); } catch (e) { m = 'ERR ' + e.message; }
  try { f = fsRhythm(fac, rec).o; } catch (e) { f = 'ERR ' + e.message; }
  eq('入居者マスタ: ' + label, m, want6);
  eq('フェイスシート: ' + label, f, want6);
}

/* ═══ D. 塊が無い時は今と同じ ═══ */
group('D. 塊が無い・読み口が無い時は今と一字一句同じ');
both('SUFacility が無い', undefined, {}, DEF6);
both('section が null を返す（書いていない）', () => null, {}, DEF6);
both('section が関数でない（古い施設情報の部品）', 'nofn', {}, DEF6);
both('section が例外を投げる', 'throw', {}, DEF6);
both('入居者の記録そのものが無い', () => null, null, DEF6);

/* ═══ B. 正しい塊で差し替わる ═══ */
group('B. 4つ全部が正しい時だけ差し替わる');
both('架空の施設の時刻', () => ({ ...GOOD }), {}, GOOD6);
both('境界の時刻 00:00 と 23:59', () => ({ breakfast: '00:00', lunch: '23:59', snack: '15:00', dinner: '17:30' }), {},
  { wake: '', breakfast: '00:00', lunch: '23:59', snack: '15:00', dinner: '17:30', sleep: '' });
both('並びが違っても同じ', () => ({ dinner: '18:00', snack: '14:30', lunch: '11:45', breakfast: '07:30' }), {}, GOOD6);
{
  /* 区間の関数を直接呼ぶ（返す塊の中身と、渡した塊を書き換えないこと） */
  const ctx = { window: mkWin(() => src) }; const src = { ...GOOD };
  ctx.SUFacility = ctx.window.SUFacility; vm.createContext(ctx);
  let got = null;
  try { vm.runInContext(DEFAULTS_LINE + '\n' + (bm[0] || '') + '\nthis.__g=mealTimeDefaults_();', ctx); got = JSON.parse(JSON.stringify(ctx.__g)); } catch (e) { got = 'ERR ' + e.message; }
  eq('mealTimeDefaults_ は4つの時刻だけを返す', got, GOOD);
  t('渡した塊を書き換えない', JSON.stringify(src) === JSON.stringify(GOOD));
}

/* ═══ C. 崩れた塊は丸ごと捨てる ═══ */
group('C. 1つでも崩れていれば丸ごと既定に戻る');
const BAD = [
  ['知らない項目がある', { ...GOOD, wake: '06:00' }],
  ['項目名の綴りが違う', { breakfast: '07:30', lunch: '11:45', snack: '14:30', diner: '18:00' }],
  ['1つ欠け（夕食なし）', { breakfast: '07:30', lunch: '11:45', snack: '14:30' }],
  ['空の塊', {}],
  ['数で書いた', { ...GOOD, lunch: 1145 }],
  ['null', { ...GOOD, snack: null }],
  ['時が1桁', { ...GOOD, breakfast: '7:30' }],
  ['24時', { ...GOOD, dinner: '24:00' }],
  ['60分', { ...GOOD, lunch: '12:60' }],
  ['長すぎる（秒つき）', { ...GOOD, snack: '14:30:00' }],
  ['前に空白', { ...GOOD, breakfast: ' 07:30' }],
  ['区切りが違う', { ...GOOD, dinner: '18.00' }],
  ['全角の数字', { ...GOOD, lunch: '１１:４５' }],
  ['配列', ['07:30', '11:45', '14:30', '18:00']],
  ['文字の塊', '07:30'],
  /* 項目名で4つを持たせた配列（番号の項目が無いので、配列であること自体で拒む） */
  ['項目名を持たせた配列', Object.assign([], GOOD)],
  /* 文字に見える値（文字にすると時刻の形になる塊）。文字でないものは形を見る前に拒む（例外で画面を止めない） */
  ['文字に見える塊', { ...GOOD, lunch: { toString() { return '11:45'; } } }],
];
for (const [label, blob] of BAD) both(label + '→既定', () => blob, {}, DEF6);
{
  /* 継承した項目（prototype）は数えない＝自分の項目が3つだけなら欠け扱い */
  const proto = { dinner: '18:00' };
  const blob = Object.assign(Object.create(proto), { breakfast: '07:30', lunch: '11:45', snack: '14:30' });
  both('継承した項目で4つ目を埋めても欠け扱い', () => blob, {}, DEF6);
}

/* ═══ E. 保存した時刻が勝つ ═══ */
group('E. 入居者ごとに保存した時刻が必ず勝つ');
const SAVED = { wake: '06:30', breakfast: '08:15', dinner: '19:00', sleep: '21:00' };
both('施設の既定を書いてあっても保存した時刻が勝つ（無い項目だけ施設の既定）', () => ({ ...GOOD }),
  { rhythm: SAVED }, { wake: '06:30', breakfast: '08:15', lunch: '11:45', snack: '14:30', dinner: '19:00', sleep: '21:00' });
both('塊が無い時は今の既定の上に保存した時刻', () => null,
  { rhythm: SAVED }, { wake: '06:30', breakfast: '08:15', lunch: '12:00', snack: '15:00', dinner: '19:00', sleep: '21:00' });
both('空欄で保存した項目は既定で埋める（今と同じ）', () => ({ ...GOOD }),
  { rhythm: { lunch: '  ', snack: '' } }, GOOD6);

/* ═══ F. 後から届いた時の描き直し ═══ */
group('F. 施設情報が後から届いた時の描き直し');
/* fac を後から差し替えられる偽物の SUFacility で、描いた→届いた→描き直すか を見る */
function redrawCase(scr, opts) {
  const isFs = scr === 'fs';
  const src = isFs ? FX : MASTER;
  const fnName = isFs ? 'fsMealOnFacility_' : 'rmMealOnFacility_';
  const fn = grab(src, '\nfunction ' + fnName + '(');
  if (!fn) return { missing: true };
  let blob = opts.before;
  const calls = [];
  const ctx = {
    window: { SUFacility: { section: (n) => (n === 'mealTimes' ? blob : null) } },
    document: { body: { classList: { contains: (c) => !!(opts.printing && c === 'su-printing') } } },
    setTimeout: (f) => { if (opts.runTimers) f(); },
    curRec: opts.open ? { id: 'R01' } : null, curResident: opts.open ? { id: 'R01' } : null,
    $: (id) => (id === 'sc-view' ? { classList: { contains: (c) => c === 'on' && opts.view !== false } } : null),
    isField: () => !!opts.field, getDeviceRole: () => (opts.field ? 'field' : 'office'),
    renderFaceSheet: (r) => { calls.push(r && r.id); ctx.fsMealSig_ = JSON.stringify(ctx.mealTimeDefaults_()); },
    renderView: (r) => { calls.push(r && r.id); ctx.rmMealSig_ = JSON.stringify(ctx.mealTimeDefaults_()); },
    fsNoteAs_: () => {},
  };
  ctx.SUFacility = ctx.window.SUFacility;
  vm.createContext(ctx);
  vm.runInContext(DEFAULTS_LINE + '\n' + (isFs ? bf[0] : bm[0]) + '\nvar ' + (isFs ? 'fsMealSig_' : 'rmMealSig_') + '=null;\n' + fn + '\nthis.mealTimeDefaults_=mealTimeDefaults_;', ctx);
  /* 描いた時（届く前） */
  if (opts.drawn !== false) ctx[isFs ? 'fsMealSig_' : 'rmMealSig_'] = JSON.stringify(ctx.mealTimeDefaults_());
  blob = opts.after;   /* 届いた */
  vm.runInContext(fnName + '();', ctx);
  vm.runInContext(fnName + '();', ctx);   /* 2回呼ばれても描き直しは1回 */
  return { calls };
}
for (const [scr, label] of [['fs', 'フェイスシート'], ['rm', '入居者マスタ']]) {
  const base = { before: null, after: { ...GOOD }, open: true };
  const r1 = redrawCase(scr, base);
  t(label + ': 描き直しの関数がある', !r1.missing);
  eq(label + ': 届いた既定が描いた時と違えば1回だけ描き直す', r1.calls, ['R01']);
  eq(label + ': 塊が無いまま届いた時は描き直さない（画面は変わらない）', redrawCase(scr, { ...base, after: null }).calls, []);
  eq(label + ': 崩れた塊が届いた時は描き直さない（既定のまま）', redrawCase(scr, { ...base, after: { ...GOOD, lunch: '25:00' } }).calls, []);
  eq(label + ': 届く前から同じ塊だった時は描き直さない', redrawCase(scr, { ...base, before: { ...GOOD } }).calls, []);
  eq(label + ': 現場端末では描き直さない', redrawCase(scr, { ...base, field: true }).calls, []);
  eq(label + ': 開いている方がいない時は描き直さない', redrawCase(scr, { ...base, open: false }).calls, []);
  eq(label + ': 詳細の画面でない時（一覧・編集）は描き直さない', redrawCase(scr, { ...base, view: false }).calls, []);
  eq(label + ': まだ一度も描いていない時は描き直さない', redrawCase(scr, { ...base, drawn: false }).calls, []);
}
eq('入居者マスタ: 印刷の準備中はその場では描き直さない（終わるのを待つ）', redrawCase('rm', { before: null, after: { ...GOOD }, open: true, printing: true }).calls, []);
t('フェイスシート: 描いた時に既定の印を残す（重ね合わせの中）', (() => { try { return fsRhythm(() => ({ ...GOOD }), {}).sig === JSON.stringify(GOOD); } catch (e) { return false; } })());
t('入居者マスタ: 詳細画面を描く時に既定の印を残す', /\nfunction renderView\(r\)\{[\s\S]*?rmMealSig_=JSON\.stringify\(mealTimeDefaults_\(\)\);/.test(MASTER));
t('フェイスシート: 施設情報が届いた時に描き直しを呼ぶ', /SUFacility\.onReady\(fsMealOnFacility_\)/.test(FX));
t('入居者マスタ: 施設情報が届いた時に描き直しを呼ぶ', /SUFacility\.onReady\(function\(\)\{ setTimeout\(rmMealOnFacility_,0\); \}\)/.test(MASTER));

console.log('\n' + (fail ? '✗ ' : '✓ ') + '食事の時刻の施設の既定: 合格 ' + pass + ' / 不合格 ' + fail);
process.exit(fail ? 1 : 0);
