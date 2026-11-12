/* シフト分析 ── 施設情報が遅れて届いた時に行が消えない（2026-11-13 新設・代表者の指示 2026-11-13）
   実行: node check/unit/analyzer_facility_late_test.js

   シフト分析は、区分の列の「事業所の名前」を施設情報（su-facility.js）の呼び名で訪問／施設／通所に読み替える。
   施設情報が届く前に集計すると、その行を判定できずに捨てていた（画面には何も出なかった）。
   守ること:
     1 施設情報が届いた後に、届く前の集計を同じ文字で集計し直し、捨てていた行が戻る
     2 全部の行が事業所の名前で「区分の列を特定できません」になった集計も、届いた後に戻る
     3 集計し直しても結果は1回分だけ（二重に描かない）・入力欄の文字は変えない
     4 集計し直しに使うのは集計した時の文字（入力欄を貼り替え途中でも、その文字を勝手に集計しない）
     5 消すボタンの後・施設情報が読めなかった時は、集計し直さない
     6 判定できなかった行の数と例（行・列の番号と区分の列の文字だけ・最大3つ）を印刷しない枠に出し、氏名の列の文字は出さない
   実物の画面のソースから部品を切り出して動かす（写経しない）。氏名は架空の記号的な名前だけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const ANA = fs.readFileSync(process.env.SHIFT_ANALYZER_HTML || path.join(ROOT, 'shift-analyzer.html'), 'utf8');

function section(src, file) {
  const mark = '/* ===== ' + file + ' ===== */';
  const s = src.indexOf(mark);
  if (s < 0) throw new Error('部品が見つかりません: ' + file);
  let e = src.indexOf('\n/* ===== src/', s + mark.length);
  const e2 = src.indexOf('</script>', s);
  if (e < 0 || (e2 >= 0 && e2 < e)) e = e2;
  return src.slice(s, e);
}

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(String(info).slice(0, 400)) : '')); }
}

/* 画面の部品の代わり。押した時の処理（click）を覚え、innerHTML を受ける */
function mkEl(id) {
  const ls = {};
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, disabled: false, hidden: false, open: false,
    className: '', style: {}, dataset: {}, files: null, children: [], parentNode: null,
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, appendChild(c) { return c; }, insertBefore(c) { return c; },
    addEventListener(type, fn) { (ls[type] = ls[type] || []).push(fn); },
    fire(type) { (ls[type] || []).forEach((fn) => fn.call(this, { type })); },
    querySelector() { return null; }, querySelectorAll() { return []; }, scrollIntoView() {}, focus() {}, click() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    insertAdjacentHTML(pos, h) { this.innerHTML = pos === 'afterbegin' ? h + this.innerHTML : this.innerHTML + h; }
  };
}

/* 施設情報の代わり。onReady は待ちを溜め、settle() で後から呼ぶ（届いた時・読めなかった時） */
function fakeFacility(aliases) {
  let data = null, settled = false, waiters = [];
  return {
    ready: () => !!data,
    aliases: () => JSON.parse(JSON.stringify(data || {})),
    onReady(fn) { if (settled) fn(); else waiters.push(fn); },
    settle(ok) { if (ok) data = aliases; settled = true; const w = waiters; waiters = []; w.forEach((fn) => fn()); },
    waiting: () => waiters.length
  };
}

function boot(fac) {
  const els = new Proxy({}, { get: (o, k) => (typeof k !== 'string' ? o[k] : (o[k] = o[k] || mkEl(k))) });
  const data = {};
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); }, removeItem(k) { delete data[k]; },
    key(i) { return Object.keys(data)[i]; }, get length() { return Object.keys(data).length; }
  };
  const document = {
    readyState: 'complete', documentElement: { clientWidth: 1200 },
    getElementById: (id) => els[id],
    querySelector: () => null, querySelectorAll: () => [], createElement: (tag) => mkEl(tag), createTextNode: () => mkEl(), addEventListener() {}
  };
  document.body = mkEl('body');
  const win = { document, localStorage: ls, SUFacility: fac, addEventListener() {}, removeEventListener() {},
                setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
                alert() {}, confirm() { return true; }, prompt() { return null; }, console: { log() {}, warn() {}, error() {} } };
  win.window = win;
  vm.createContext(win);
  ['src/logic/symbols.js', 'src/logic/timecalc.js', 'src/logic/aggregate.js', 'src/logic/analyzer-import.js', 'src/analyzer-ui.js']
    .forEach((f) => vm.runInContext(section(ANA, f), win, { filename: f }));
  return { win, els };
}

/* 架空の勤務表。区分の列に事業所の名前（見本の家＝施設・見本ヘルパー＝訪問）を使う */
const ALIASES = { '見本の家': '施設', '見本ヘルパー': '訪問' };
const HDR = ['', '氏名', '区分', '7/1', '7/2', '7/3', '介護福祉士'].join('\t');
const MIXED = [HDR,
  ['', '見本甲', '見本の家', '9:00-18:00', '9:00-18:00', '', '○'].join('\t'),
  ['', '', '訪問', '', '', '9:00-12:00', ''].join('\t'),
  ['', '見本乙', '見本ヘルパー', '9:00-18:00', '', '', ''].join('\t'),
  ['', '見本丙', '訪問', '9:00-12:00', '', '', ''].join('\t')].join('\n');
const ALLNAMED = [HDR,
  ['', '見本甲', '見本の家', '9:00-18:00', '', '', '○'].join('\t'),
  ['', '見本乙', '見本ヘルパー', '9:00-18:00', '', '', ''].join('\t')].join('\n');
const count = (h, s) => h.split(s).length - 1;

/* 1・3・6 一部の行が事業所の名前の表 */
{
  const fac = fakeFacility(ALIASES);
  const { win, els } = boot(fac);
  t('起動の時に施設情報の届きを待つ（onReady に1回だけ登録）', fac.waiting() === 1, fac.waiting());
  els.pasteArea.value = MIXED;
  els.runBtn.fire('click');
  const before = els.results.innerHTML;
  t('届く前: 判定できなかった行の数を出す（3行のうち事業所の名前の2行）', before.includes('区分を判定できなかった行 2 行'), before.slice(0, 300));
  t('届く前: 例に行・列の番号と区分の列の文字を出す', before.includes('2行目・3列目（区分の列）「見本の家」') && before.includes('4行目・3列目（区分の列）「見本ヘルパー」'), before.slice(0, 600));
  const box = (before.match(/<section class="card warn noprint"[^>]*>[^]*?<\/section>/) || [''])[0];
  t('届く前: 知らせは印刷しない枠（noprint）', box.includes('区分を判定できなかった行'), box);
  t('届く前: 知らせの枠に氏名の列の文字を出さない', !/見本甲|見本乙|見本丙/.test(box), box);
  t('届く前: 見本甲・見本乙の行は集計から抜けている', !before.includes('見本乙'), '');
  fac.settle(true);
  const after = els.results.innerHTML;
  t('届いた後: 捨てていた行が戻る（見本甲・見本乙が集計に入る）', after.includes('見本甲') && after.includes('見本乙') && after.includes('見本丙'), '');
  t('届いた後: 判定できなかった行の知らせは消える', !after.includes('区分を判定できなかった行'), '');
  t('届いた後: 結果は1回分だけ（月次サマリの見出しが1つ）', count(after, '月次サマリ（訪問介護）') === 1, count(after, '月次サマリ（訪問介護）'));
  t('届いた後: 入力欄の文字は変えない', els.pasteArea.value === MIXED, '');
}

/* 2・4 全部の行が事業所の名前の表（届く前は区分の列を特定できない）。届く前に入力欄を貼り替え途中でも、集計した文字で集計し直す */
{
  const fac = fakeFacility(ALIASES);
  const { els } = boot(fac);
  els.pasteArea.value = ALLNAMED;
  els.runBtn.fire('click');
  const before = els.results.innerHTML;
  t('全部が事業所の名前: 届く前は「区分列を特定できません」', before.includes('区分列(訪問/施設/通所)または氏名列を特定できません'), before);
  els.pasteArea.value = '貼り替え途中';
  fac.settle(true);
  const after = els.results.innerHTML;
  t('全部が事業所の名前: 届いた後に集計し直し、行が戻る', after.includes('見本甲') && after.includes('見本乙') && !after.includes('特定できません'), after.slice(0, 300));
  t('集計し直しは集計した時の文字で行い、入力欄の文字は変えない', els.pasteArea.value === '貼り替え途中' && !after.includes('貼り替え途中'), '');
}

/* 5 消すボタンの後・施設情報が読めなかった時・捨てた行の無い集計 */
{
  const fac = fakeFacility(ALIASES);
  const { els } = boot(fac);
  els.pasteArea.value = MIXED;
  els.runBtn.fire('click');
  els.clearBtn.fire('click');
  fac.settle(true);
  t('消すボタンの後に届いても、何も描かない', els.results.innerHTML === '', els.results.innerHTML);
}
{
  const fac = fakeFacility(ALIASES);
  const { els } = boot(fac);
  els.pasteArea.value = MIXED;
  els.runBtn.fire('click');
  const before = els.results.innerHTML;
  fac.settle(false);
  t('施設情報が読めなかった時は今の結果のまま（知らせも残る）', els.results.innerHTML === before && before.includes('区分を判定できなかった行 2 行'), '');
}
{
  const fac = fakeFacility(ALIASES);
  const { els } = boot(fac);
  const plain = [HDR, ['', '見本丙', '訪問', '9:00-12:00', '', '', ''].join('\t')].join('\n');
  els.pasteArea.value = plain;
  els.runBtn.fire('click');
  const before = els.results.innerHTML;
  t('捨てた行の無い集計には知らせを出さない', !before.includes('区分を判定できなかった行'), '');
  els.results.innerHTML = before + '<!--描き直していない印-->';
  fac.settle(true);
  t('捨てた行の無い集計は、届いても描き直さない', els.results.innerHTML.endsWith('<!--描き直していない印-->'), '');
}

/* 6 例は最大3つ（数は全部数える） */
{
  const fac = fakeFacility(ALIASES);
  const { els } = boot(fac);
  const rows = [HDR, ['', '見本丙', '訪問', '9:00-12:00', '', '', ''].join('\t')];
  for (let i = 0; i < 5; i++) rows.push(['', '見本' + i, '見本の家', '9:00-18:00', '', '', ''].join('\t'));
  els.pasteArea.value = rows.join('\n');
  els.runBtn.fire('click');
  const h = els.results.innerHTML;
  t('5行を捨てた時: 数は5行・例は3つまで', h.includes('区分を判定できなかった行 5 行') && count(h, '列目（区分の列）') === 3, h.slice(0, 800));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
