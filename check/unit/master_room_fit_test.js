/* 入居者マスタ：居室一覧の文字の大きさを、文字の幅を測らずに計算で決める・氏名に「様」を付けない
   （2026-10-23 本人指示・代表者の決定。2回目「Windows で拡大縮小のたびに大きすぎる・小さすぎるになる、紙は大きすぎる」）
   実行: node check/unit/master_room_fit_test.js（環境変数 MASTER_HTML で別の版を当てられる）
   守ること:
     1. 文字数の数え方（rpEmLen_）: 漢字・かな・全角の記号・全角の空白は1字、半角の文字は 0.62字、2つで1文字の漢字は1字
     2. 大きさの計算（roomFontPx_）: 間取りの比と氏名の文字数だけで決まる（文字の幅を測らない）。
        いちばん長い氏名が「マスの中の幅 × 0.95」に収まる・番号と氏名が重ならない高さ・固定の名前は折り返して高さに収まる。
        全体で1つ（1階・2階の両方を見て1つ）。0.25px 刻みに切り下げ・5〜26px
     3. 当て方（fitRoomSheets）: 紙の幅に対する割合（--rpk）を2枚とも同じに当てる。割合は窓の幅・拡大縮小に関係なく同じ。
        紙の高さに入らない時だけ 0.25px ずつ下げる。非表示でも割合は当て、紙の高さの確かめは表示されてから
     4. 画面の守り（あふれを測って下げる）・窓の大きさの変化での測り直しは使わない（拡大縮小で大きさが揺れる元だった）
     5. 居室一覧の氏名の後ろに「様」を付けない（画面・紙とも）。氏名の文字（空白・異体字）は直さない
   実物のソースから関数を切り出して vm で動かす（写経しない）。氏名はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(process.env.MASTER_HTML || path.join(ROOT, 'resident-master.html'), 'utf8');
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
const PW = Math.round((297 - 20) * 96 / 25.4);   /* 既定の紙幅（1047px） */
const PH = (210 - 20) * 96 / 25.4;

/* 架空の間取り（実物と同じ形の持ち方: 列・行の比・縦横比・マス）。居室の枠は図の幅の約8%（実物に近い比）。
   居室は 101〜104・201〜202、固定の名前の箱が2つ。CW＝列の合計・RH＝行の合計（＝縦横比） */
const CW = 2180, RH = 1100;
function plan() {
  return {
    f1: { cols: [170, 170, 170, 170, 170, 170, 170, 170, 60, 760], rows: [160, 40, 160, 740], ar: [CW, RH], cells: [
      { r: 1, c: 1, room: '101' }, { r: 1, c: 2, room: '102' }, { r: 1, c: 3, room: '103', note: '（倉庫）' },
      { r: 3, c: 1, room: '104' }, { r: 1, c: 9, rs: 3, t: 'キッチン' }] },
    f2: { cols: [170, 170, 1840], rows: [160, 940], ar: [CW, RH], cells: [
      { r: 1, c: 1, room: '201' }, { r: 1, c: 2, room: '202' }, { r: 2, c: 3, t: '食堂' }] }
  };
}
function env(opt) {
  opt = opt || {};
  const sets = {};
  const mk = (id) => {
    const sh = { id, vars: {}, offsetParent: opt.hidden ? null : {},
      style: { width: '', padding: '', setProperty(k, v) { sh.vars[k] = String(v); sets[id] = (sets[id] || 0) + 1; } },
      /* 紙の高さ: 文字が大きいほど表題が高くなる（表題 1.5字×1.5行＋余白 1.4字＋図の高さ） */
      get scrollHeight() { const f = parseFloat(sh.vars['--rpk'] || '1') * (sh.style.width ? parseFloat(sh.style.width) : 948) / 100; return Math.round((opt.tall || 0) + 3.65 * f + (sh.style.width ? parseFloat(sh.style.width) : 948) * 0.5); },
      querySelector(sel) { return sel === '.rp-grid' ? { offsetWidth: 948 } : null; } };
    return sh;
  };
  const els = { roomSheet_f1: mk('roomSheet_f1'), roomSheet_f2: mk('roomSheet_f2') };
  const b = { Math, Number, String, Object, Array, isFinite, parseFloat, JSON,
    $: (id) => els[id] || null,
    roomPlanData: () => opt.plan || plan(),
    roomOccupants: () => opt.occ || {},
    els, sets };
  vm.createContext(b);
  vm.runInContext([cutF(RM, 'rpNum_'), line(RM, /var RP_EM_HALF=0\.62, RP_SAFE=0\.95, RP_PX_MIN=5, RP_PX_MAX=26;/),
    cutF(RM, 'rpEmLen_'), cutF(RM, 'roomFontPx_'), cutF(RM, 'fitRoomSheets'),
    line(RM, /var roomFitWait_=false;/), cutF(RM, 'fitRoomScreen_')].join('\n'), b);
  return b;
}
const kOf = (px, W) => Math.round(px * 100 / (W || PW) * 1000) / 1000;
const occOf = (m) => { const o = {}; for (const k of Object.keys(m)) o[k] = m[k].map((n) => ({ name: n })); return o; };

console.log('\n— 1. 文字数の数え方 —');
{
  const b = env();
  t('漢字・かなは1字ずつ', b.rpEmLen_('架空一郎') === 4 && b.rpEmLen_('かくう') === 3);
  t('全角の空白は1字', b.rpEmLen_('架空　一郎') === 5);
  t('半角の空白・英数字は 0.62字', Math.abs(b.rpEmLen_('架空 一郎') - 4.62) < 1e-9 && Math.abs(b.rpEmLen_('AB') - 1.24) < 1e-9);
  t('半角カナは 0.62字', Math.abs(b.rpEmLen_('ｶｸｳ') - 1.86) < 1e-9);
  t('2つで1文字の漢字（𠮷）は1字', b.rpEmLen_('𠮷田') === 2, b.rpEmLen_('𠮷田'));
  t('空・null は0', b.rpEmLen_('') === 0 && b.rpEmLen_(null) === 0);
}

console.log('\n— 2. 大きさの計算（文字の幅を測らない）—');
{
  const b = env();
  const W = PW;
  /* 居室のマスの中の幅＝ 170/740×W − 4。氏名は全角5字 */
  const inW = 170 / CW * W - 4, inH = 160 / RH * (W * RH / CW) - 4;
  const occ = occOf({ '101': ['架空　一郎'], '102': ['見本　花子'], '201': ['架空　二郎'] });
  const f = b.roomFontPx_(plan(), occ, W);
  const exp = Math.floor(Math.min(26, inW * 0.95 / 5, inH / 4.35, inW * 0.95 / 4) * 4) / 4;   /* 4字の（倉庫）も見る */
  t('いちばん長い氏名が「マスの中の幅 × 0.95」に収まる大きさ（0.25px 刻みに切り下げ）', f === exp, [f, exp]);
  t('いちばん長い氏名の幅はマスの中の幅を超えない', f * 5 <= inW, [f * 5, inW]);
  const longer = b.roomFontPx_(plan(), occOf({ '101': ['架空　一郎'], '202': ['試験川　健太郎丸'] }), W);
  t('★全体で1つ: 2階に長い氏名があれば1階も含め全体が小さくなる（階ごと・氏名ごとに変えない）', longer < f && longer === Math.floor(inW * 0.95 / 8 * 4) / 4, [longer, f]);
  const longer1 = b.roomFontPx_(plan(), occOf({ '101': ['試験川　健太郎丸'], '201': ['架空　二郎'] }), W);
  t('★全体で1つ: 1階に長い氏名があっても同じ（後に見る2階の分だけで決めない）', longer1 === longer, [longer1, longer]);
  const half = b.roomFontPx_(plan(), occOf({ '101': ['架空 一郎'] }), W);
  t('半角の空白は全角より小さく数える（同じ字数でも大きくできる）', half >= f, [half, f]);
  const dup = b.roomFontPx_(plan(), occOf({ '101': ['架', '空'] }), W);
  t('★同じ居室に2名の時は、番号と2行の氏名が重ならない高さで抑える', dup <= Math.floor(inH / (3.1 + 2.5) * 4) / 4, [dup, inH / 5.6]);
  const lone = b.roomFontPx_(plan(), occOf({ '101': ['架'] }), W);
  t('★氏名が短い時は、番号と氏名が重ならない高さで抑える（1行）', lone <= inH / 4.35 + 1e-9, [lone, inH / 4.35]);
  /* 固定の名前の箱: 折り返してよいが高さに収まる。低いマス（行2＝40）に長い名前を置いて確かめる */
  const narrow = plan(); narrow.f1.cells[4] = { r: 2, c: 9, t: 'キッチンキッチン' };
  const lb = b.roomFontPx_(narrow, occOf({ '101': ['架'] }), W);
  const lw = 60 / CW * W - 4, lh = 40 / RH * (W * RH / CW) - 6, per = Math.floor(lw * 0.95 / lb);
  t('★固定の名前は折り返してよいが、行数×1.25字がマスの高さに収まる', per >= 1 && Math.ceil(8 / per) * 1.25 * lb <= lh, [lb, per, lh]);
  t('大きさは 5〜26px に収める', b.roomFontPx_(plan(), occOf({ '101': ['架空'.repeat(40)] }), W) === 5 && b.roomFontPx_({}, {}, W) === 26);
  t('空室の用途（倉庫）も1行として見る', b.roomFontPx_(plan(), {}, W) <= Math.floor(inW * 0.95 / 4 * 4) / 4 + 1e-9);
  const longNote = plan(); longNote.f1.cells[2] = { r: 1, c: 3, room: '103', note: '（長い用途の名前）' };
  t('★空室の用途が長い時は、用途の字数で全体が小さくなる', b.roomFontPx_(longNote, {}, W) === Math.floor(inW * 0.95 / 9 * 4) / 4, [b.roomFontPx_(longNote, {}, W), inW * 0.95 / 9]);
  const a = b.roomFontPx_(plan(), occ, 1047), c = b.roomFontPx_(plan(), occ, 1200);
  t('紙の幅が変わっても、紙の幅に対する割合はほぼ同じ（罫線と余白の数px だけの差）', Math.abs(kOf(a, 1047) - kOf(c, 1200)) / kOf(a, 1047) < 0.03, [kOf(a, 1047), kOf(c, 1200)]);
  const src = cutF(RM, 'roomFontPx_');
  t('★計算は文字の幅を測らない（scrollWidth・getBoundingClientRect・measureText を使わない）', !/scrollWidth|clientWidth|getBoundingClientRect|measureText|offsetWidth/.test(src), '');
}

console.log('\n— 3. 当て方（2枚とも同じ割合・窓の幅に関係しない）—');
{
  const occ = occOf({ '101': ['架空　一郎'], '201': ['架空　二郎'] });
  const b = env({ occ });
  const rs = b.fitRoomSheets();
  const f = b.roomFontPx_(plan(), occ, PW);
  t('計算した大きさを、紙の幅に対する割合で2枚とも同じに当てる', rs[0].size === f && b.els.roomSheet_f1.vars['--rpk'] === String(kOf(f)) && b.els.roomSheet_f2.vars['--rpk'] === String(kOf(f)), [rs[0], b.els.roomSheet_f1.vars]);
  t('採寸の後は元の幅・余白へ戻す', b.els.roomSheet_f1.style.width === '' && b.els.roomSheet_f1.style.padding === '');
  const p = b.fitRoomSheets({ wPx: PW, hPx: PH });
  t('★紙（su-print の用紙）でも同じ大きさ・同じ割合', p[0].size === f && b.els.roomSheet_f1.vars['--rpk'] === String(kOf(f)), p[0]);
  /* 紙の高さに入らない（表題が高い）時だけ下げる */
  const tall = env({ occ, tall: 160 });
  const rt = tall.fitRoomSheets();
  t('★紙の高さに入らない時だけ 0.25px ずつ下げ、2枚とも同じ割合', rt[0].size < f && tall.els.roomSheet_f1.vars['--rpk'] === tall.els.roomSheet_f2.vars['--rpk']
    && Math.abs(((f - rt[0].size) / 0.25) - Math.round((f - rt[0].size) / 0.25)) < 1e-9, [rt[0].size, f]);
  /* 非表示: 割合は当てる・紙の高さは見えてから（印を立てる） */
  const h = env({ occ, hidden: true });
  const r0 = h.fitRoomScreen_();
  t('★非表示でも割合は当てる（表示した時に古い大きさが出ない）', r0 === null && h.els.roomSheet_f1.vars['--rpk'] === String(kOf(f)), h.els.roomSheet_f1.vars);
  t('非表示の時は印を立て、一覧が表示されたら確かめ直す', vm.runInContext('roomFitWait_', h) === true
    && /if\(curView==='room'&&roomFitWait_\)\{ try\{ fitRoomScreen_\(\); \}catch\(e\)\{\} \}/.test(cutF(RM, 'showScreen')));
  h.els.roomSheet_f1.offsetParent = {};
  h.fitRoomScreen_();
  t('表示されて確かめたら印を下ろす', vm.runInContext('roomFitWait_', h) === false);
  t('描画（renderRoster）は fitRoomScreen_ を通す', /if\(curView==='room'\) fitRoomScreen_\(\);/.test(cutF(RM, 'renderRoster')));
  t('印刷の入口は今までどおり fitRoomSheets(st.metrics)', /var rs=fitRoomSheets\(st\.metrics\);/.test(RM));
}

console.log('\n— 4. 画面の守り・窓の大きさでの測り直しを使わない —');
{
  t('★画面であふれを測って下げる守り（roomScreenGuard_）が無い', RM.indexOf('roomScreenGuard_') < 0);
  t('★窓の大きさの変化・文字の読み込みで居室一覧を測り直さない', RM.indexOf('roomOnResize_') < 0 && !/fonts\.ready\.then\(function\(\)\{\s*if\(curView==='room'/.test(RM));
  t('fitRoomSheets はマスのあふれを測らない（紙の高さだけ）', !/scrollWidth|clientWidth/.test(cutF(RM, 'fitRoomSheets')));
}

console.log('\n— 5. 居室一覧の氏名に「様」を付けない —');
{
  const b = { String, Array, Object, Math, Number, isFinite };
  vm.createContext(b);
  vm.runInContext([cutF(RM, 'esc'), cutF(RM, 'rpNum_'), cutF(RM, 'roomSideCls'), cutF(RM, 'roomCellHtml')].join('\n'), b);
  const cell = { r: 1, c: 1, room: '101' };
  const one = b.roomCellHtml(cell, { '101': [{ name: '架空　一郎' }] });
  t('氏名だけを出す（「様」を付けない）', /<div class="rp-nm">架空　一郎<\/div>/.test(one) && one.indexOf('様') < 0, one);
  const sp = b.roomCellHtml(cell, { '101': [{ name: '架空 二郎' }] });
  t('名前の中の空白（半角）は直さない', /<div class="rp-nm">架空 二郎<\/div>/.test(sp), sp);
  const ix = b.roomCellHtml(cell, { '101': [{ name: '架空　髙﨑𠮷' }] });
  t('異体字は直さない（そのまま出す）', /<div class="rp-nm">架空　髙﨑𠮷<\/div>/.test(ix), ix);
  const two = b.roomCellHtml(cell, { '101': [{ name: '架空　一郎' }, { name: '架空　花子' }] });
  t('同じ居室に2名の時は今までどおり（改行で並べる・rp-dup）', /class="rp-cell rp-room rp-dup"/.test(two)
    && /<div class="rp-nm">架空　一郎<br>架空　花子<\/div>/.test(two) && two.indexOf('様') < 0, two);
  const evil = b.roomCellHtml(cell, { '101': [{ name: '<b>架空</b>' }] });
  t('氏名は今までどおりエスケープする', evil.indexOf('<b>') < 0 && evil.indexOf('&lt;b&gt;架空&lt;/b&gt;') >= 0, evil);
  const empty = b.roomCellHtml({ r: 1, c: 1, room: '102', note: '倉庫' }, {});
  t('空室の用途の表示は今までどおり', /<div class="rp-nm">倉庫<\/div>/.test(empty), empty);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
