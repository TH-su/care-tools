/* シフト作成（shift-app.html）── 勤務記号の純関数（src/logic/symbols.js）を公開中の1枚から切り出して確かめる（2026-10-14 新設・代表者の依頼）
   実行: node check/unit/shift_sym_test.js

   守ること:
     1 正規化（全角→半角・空白を詰める）
     2 固定記号・別名（早＝7:00-16:00・希休→休み・有休→有給・公休）
     3 範囲記号（9-12・7-8:30・12-21 の長さと区分）
     4 夜勤（(21・全角（22・複合 8)(22・7)(有）と、夜勤上がりの残業の判定
     5 不明な記号はエラー・空は空
     6 おすすめ配色（元の配列を壊さない）・色を出す区分（colorDiv）
     7 時刻の変換（timeToMin・minToTime）が行き来で同じ値に戻る
   ★正本の試験（シフト作成のプロジェクト tests/symbols.test.js）とは別に、公開された1枚の中身をここで毎回確かめる。
   ★氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.SHIFT_HTML || path.join(ROOT, 'shift-app.html'), 'utf8');

function section(html, file) {
  const head = '/* ===== ' + file + ' ===== */';
  const s = html.indexOf(head);
  if (s < 0) throw new Error('shift-app.html に ' + file + ' がありません');
  const e = html.indexOf('\n/* ===== src/', s + head.length);   /* 区切りは行頭の「/* ===== src/…」だけ（中身のコメントの ===== で切らない） */
  return html.slice(s, e < 0 ? html.indexOf('</script>', s) : e);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

const box = { window: {}, Math, Date, String, Object, RegExp, Array, JSON, Number, isNaN, parseInt };
vm.createContext(box);
vm.runInContext(section(HTML, 'src/logic/symbols.js'), box, { filename: 'shift-app.html(symbols.js)' });
const S = box.window.ShiftSymbols;

console.log('\n— 0. 切り出せる —');
t('shift-app.html の symbols.js を切り出して動かすと window.ShiftSymbols が出る', !!S && typeof S.parseCell === 'function');
if (!S) { console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + (fail + 1) + ' 件失敗 ──────────'); process.exit(1); }
const P = v => S.parseCell(v);
const kinds = v => P(v).parts.map(p => p.kind);

console.log('\n— 1. 正規化 —');
t('全角のかっこ・数字・ハイフン・コロンを半角にし、空白を詰める',
  S.normalizeCell('（２１') === '(21' && S.normalizeCell('７）') === '7)' && S.normalizeCell('９－１２') === '9-12' &&
  S.normalizeCell(' 9 - 12 ') === '9-12' && S.normalizeCell('7：30') === '7:30',
  ['（２１', '７）', '９－１２', ' 9 - 12 ', '7：30'].map(S.normalizeCell));

console.log('\n— 2. 固定記号・別名 —');
{
  const p = P('早');
  t('早＝7:00〜16:00・早番の区分', p.parts.length === 1 && p.parts[0].kind === 'work' && p.parts[0].startMin === 420 && p.parts[0].endMin === 960 && p.parts[0].cat === 'early', p.parts);
  t('希休→休み・有休→有給・公休→公休', kinds('希休').join() === 'off' && kinds('有休').join() === 'paidOff' && kinds('公休').join() === 'publicOff', [kinds('希休'), kinds('有休'), kinds('公休')]);
  t('休・有・希・公はそれぞれ休みの種類だけ', kinds('休').join() === 'off' && kinds('有').join() === 'paidOff' && kinds('希').join() === 'off' && kinds('公').join() === 'publicOff');
}

console.log('\n— 3. 範囲記号 —');
{
  const a = P('9-12').parts[0], b = P('7-8:30').parts[0], c = P('12-21').parts[0], d = P('7-16').parts[0];
  t('9-12 は3時間・7-8:30 は1時間半', a.endMin - a.startMin === 180 && b.endMin - b.startMin === 90, [a, b]);
  t('12-21 は遅番・7-16 は早番の区分', c.cat === 'late' && d.cat === 'early', [c.cat, d.cat]);
}

console.log('\n— 4. 夜勤 —');
{
  const a = P('（21').parts[0];
  t('（21 は夜勤入り 21:00・上がりの定時 7:00', a.kind === 'nightIn' && a.startMin === 1260 && a.pairEndMin === 420, a);
  const b = P('8)(22').parts;
  t('8)(22 は上がり 8:00 と入り 22:00（定時 8:00）の2つ', b.length === 2 && b[0].kind === 'nightOut' && b[0].endMin === 480 && b[1].kind === 'nightIn' && b[1].startMin === 1320 && b[1].pairEndMin === 480, b);
  t('7)(有 は上がりと有給（夜勤の枠を有給で埋める）', kinds('7)(有').join() === 'nightOut,paidOff', kinds('7)(有'));
  t('8)(有 も勤務（上がり）を含む＝休みだけの日ではない', kinds('8)(有').indexOf('nightOut') >= 0);
  const L = (a1, b1) => S.leadingNightOutOvertime(a1, b1);
  t('夜勤上がりの残業: (21 の翌 8) は残業（先頭2文字）・(22 の翌 8) は定時', L('(21', '8)') === 2 && L('7)(21', '8)(21') === 2 && L('(22', '8)') === 0 && L('8)(22', '8)') === 0,
    [L('(21', '8)'), L('7)(21', '8)(21'), L('(22', '8)'), L('8)(22', '8)')]);
  t('夜勤上がりの残業: 7) は定時・前日が休みや空なら判定しない・全角 8） も読める・上がりで始まらない日は対象外',
    L('(21', '7)') === 0 && L('休', '8)') === 0 && L('', '8)') === 0 && L('(21', '8）') === 2 && L('(21', '7-16') === 0);
}

console.log('\n— 5. 不明な記号・空 —');
t('不明な記号はエラー', !!P('ぴよ').error);
t('空・null は空（エラーにしない）', P('').parts.length === 0 && P(null).parts.length === 0 && !P('').error);

console.log('\n— 6. 配色と色を出す区分 —');
{
  const base = [{ code: '早', cat: 'early', type: 'work' }, { code: '希', cat: 'off', type: 'off' }, { code: '9-12', cat: 'mid', type: 'work' }];
  const out = S.applyRecommendedColors(base);
  t('おすすめ配色: 早に色・希は太字・自作の記号も区分で色が付く', !!(out[0].color && out[0].textColor) && out[1].bold === true && !!(out[2].color && out[2].textColor), out);
  t('おすすめ配色: 元の配列を壊さない', base[0].color === undefined);
  const haya = (S.DEFAULT_SYMBOLS || []).find(s => s.code === '早');
  t('既定の記号は配色済み・色を出す区分を持たない', !!(haya && haya.color && haya.textColor) && (S.DEFAULT_SYMBOLS || []).every(s => !s.colorDiv));
  t('colorDiv が無い・空の記号は全区分で色を出す', S.colorAppliesTo({ code: '早' }, '施設') && S.colorAppliesTo({ code: '早' }, '通所') && S.colorAppliesTo({ colorDiv: '' }, '訪問') && S.colorAppliesTo({ colorDiv: null }, '訪問'));
  t('colorDiv=通所 は通所の行だけ', S.colorAppliesTo({ colorDiv: '通所' }, '通所') && !S.colorAppliesTo({ colorDiv: '通所' }, '施設') && !S.colorAppliesTo({ colorDiv: '通所' }, '訪問'));
}

console.log('\n— 7. 時刻の変換 —');
{
  const ts = ['0:00', '7:00', '8:30', '12:05', '21:00', '23:59'];
  const back = ts.map(x => S.minToTime(S.timeToMin(x)));
  t('timeToMin: 7:00＝420・21:00＝1260', S.timeToMin('7:00') === 420 && S.timeToMin('21:00') === 1260);
  t('timeToMin→minToTime で同じ時刻に戻る（時は先頭の0なしでも比べられる形）', back.every((v, i) => S.timeToMin(v) === S.timeToMin(ts[i])), back);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
