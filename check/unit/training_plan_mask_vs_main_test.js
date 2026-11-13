/* training_plan_mask_vs_main_test.js — 個別機能訓練計画書（training-plan.html）の外部AIへ送る前の伏せ字が、
   直す前（main の版・check/fixtures/training-plan-mask-main.mjs に固定した写し）より弱くならないことを総当たりで確かめる。
   ・名簿の語・名簿に無い名前・前後の文脈・後ろに続く語を組み合わせた文を両方の版で伏せ、
     「main の版で消えていた名前の語が、今の版の送る文に残る」例が0件であること（悪くなる例0件）
   ・今の版で伏せて戻すと、元の文にちょうど戻ること
   組み合わせは反証レビュー（2026-11-13）の道具（名簿外の姓の取り残し・かなの名・記号の中の語）から作った。
   対象HTMLは環境変数 TP_HTML で差し替えられる。比べる相手は手元のファイルや git の履歴に頼らず、固定した写しを読む。
   ★名前はすべて記号的な架空のもの。実在の利用者名を書かないこと。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTP(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const mark = raw.indexOf('TP_PURE_MODULE');
  const OPEN = raw.indexOf('(function (global) {', mark < 0 ? 0 : mark);
  const END = "})(typeof window !== 'undefined' ? window : this);";
  const CLOSE = raw.indexOf(END, OPEN);
  if (OPEN < 0 || CLOSE < 0) return null;
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(raw.slice(OPEN, CLOSE + END.length), sb);
  return sb.TP || null;
}
const HTML = process.env.TP_HTML || path.join(__dirname, '..', '..', 'training-plan.html');
const MAIN = path.join(__dirname, '..', 'fixtures', 'training-plan-mask-main.mjs');
const NOW = loadTP(HTML), OLD = loadTP(MAIN);

let pass = 0, fail = 0;
function t(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
}

console.log('\n【0】読み込み');
t('今の版を評価できた', !!NOW && typeof NOW.aiMaskDeep === 'function');
t('main の版の写しを評価できた（1文字の語を外していた版）', !!OLD && typeof OLD.aiMaskDeep === 'function' && /term\.length < 2/.test(fs.readFileSync(MAIN, 'utf8')));
if (!NOW || !OLD || typeof NOW.aiMaskDeep !== 'function' || typeof OLD.aiMaskDeep !== 'function') {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + (fail || 1) + ' 件失敗 ──────────');
  process.exit(1);
}

/* 名簿（反証レビューの4つの道具の名簿を合わせたもの）。ご本人は先頭 */
const ROSTERS = [
  [{ masterId: 'S', name: '甲 一郎', kana: 'こう いちろう' }, { masterId: 'O1', name: '見本 花子', kana: 'みほん はなこ' }, { masterId: 'O2', name: '乙 二郎', kana: 'おつ じろう' },
   { masterId: 'O3', name: '丙野 三子', kana: '' }, { masterId: 'O4', name: '髙架 よし子', kana: 'こうか よしこ' }],
  [{ masterId: 'S', name: '試験 一郎', kana: '' }, { masterId: 'O1', name: '見本 花子', kana: '' }, { masterId: 'O2', name: '乙 二郎', kana: '' }, { masterId: 'O3', name: '丙野 三子', kana: '' },
   { masterId: 'O4', name: '架空 かな', kana: 'かくう かな' }, { masterId: 'O5', name: '模擬 きく', kana: 'もぎ きく' }],
  [{ masterId: 'S', name: '試験 一郎', kana: 'しけん いちろう' }, { masterId: 'A', name: '見本 きく', kana: 'みほん きく' }, { masterId: 'B', name: '架空 ハル', kana: '' },
   { masterId: 'C', name: '甲 とめ', kana: '' }, { masterId: 'D', name: '乙 二郎', kana: '' }, { masterId: 'E', name: '乙 五郎', kana: '' }]
];
/* 名簿に無い名前（ご家族・職員などの想定。名簿の語の前に付けて、取り残されないかを見る） */
const OFF = ['架山', 'カヤマ', 'かやま', '架川太郎'];
const CTX = ['', 'さん', '様', '氏', 'と', 'は', '。', '、', '〔', '〕', '（', '）', ' ', '先生', 'くん', 'ちゃん', '市', 'が来た', 'の娘さん', '看護師さん', '家', '\n'];
const PRE = CTX.concat(OFF, ['娘の架山', '架山 ']);
const TAIL = ['', '乙', '見本さん', '甲', '花子さん', 'を声をきく'];

function wordsOf(R) {
  const w = new Set();
  R.forEach(function (r) {
    const nm = r.name.trim(), parts = nm.split(/[\s　]+/), kn = (r.kana || '').trim(), kp = kn ? kn.split(/[\s　]+/) : [];
    w.add(nm); w.add(parts.join('')); parts.forEach(function (p) { w.add(p); w.add(NOW.foldName(p)); });
    w.add(NOW.foldName(parts.join('')));
    if (kn) { w.add(kp.join('')); w.add(NOW.aiToKatakana(kp.join(''))); kp.forEach(function (p) { w.add(p); w.add(NOW.aiToKatakana(p)); }); }
  });
  return Array.from(w).filter(Boolean);
}

console.log('\n【1】総当たり: main の版より伏せ方が弱くならない（悪くなる例0件）');
const t0 = Date.now();
let cases = 0, worse = 0, round = 0;
const worseEx = [], roundEx = [];
ROSTERS.forEach(function (R, ri) {
  const tOld = OLD.aiMaskTerms(R, 'S'), tNow = NOW.aiMaskTerms(R, 'S');
  const words = wordsOf(R);
  const watch = words.concat(OFF, ['架川']);   // 見張る語（名簿の語・名簿に無い名前）
  words.forEach(function (w) {
    PRE.forEach(function (p) {
      CTX.forEach(function (s) {
        TAIL.forEach(function (w2) {
          const str = p + w + s + w2;
          cases++;
          const mo = OLD.aiMaskDeep({ a: str }, tOld, {}).a;
          const un = {};
          const mn = NOW.aiMaskDeep({ a: str }, tNow, un).a;
          if (mo !== mn) {
            for (let k = 0; k < watch.length; k++) {
              const nm = watch[k];
              if (str.indexOf(nm) >= 0 && mo.indexOf(nm) < 0 && mn.indexOf(nm) >= 0) {
                worse++; if (worseEx.length < 10) worseEx.push({ 名簿: ri + 1, 文: str, main: mo, 今: mn, 残った語: nm });
                break;
              }
            }
          }
          const back = NOW.aiUnmaskDeep({ a: mn }, tNow, un).a;
          if (back !== str) { round++; if (roundEx.length < 10) roundEx.push({ 名簿: ri + 1, 文: str, 送る文: mn, 戻した文: back }); }
        });
      });
    });
  });
});
const ms = Date.now() - t0;
t('組み合わせを作れた（' + cases + ' 通り・' + ms + 'ms）', cases > 50000, cases);
t('★main の版で伏せていた名前の語が、今の版の送る文に1つも残らない（悪くなる例 ' + worse + ' 件）', worse === 0, worseEx);
t('★今の版で伏せて戻すと元の文にちょうど戻る（戻らない例 ' + round + ' 件）', round === 0, roundEx);

console.log('\n【2】見張りが効いていることの確かめ（わざと弱くした版は落ちる）');
{
  /* 見張りが空振りしていないこと: 今の版の語の一覧から「他の利用者の氏名」を抜くと、main より悪くなる例が出る */
  const R = ROSTERS[0];
  const tOld = OLD.aiMaskTerms(R, 'S');
  const weak = NOW.aiMaskTerms(R, 'S').filter(function (x) { return x.token.indexOf('〔利用者1') !== 0; });
  const str = '見本花子が来た';
  const mo = OLD.aiMaskDeep({ a: str }, tOld, {}).a, mw = NOW.aiMaskDeep({ a: str }, weak, {}).a;
  t('弱くした語の一覧では、main で消えていた「見本花子」が残る（同じ比べ方で見つけられる）', mo.indexOf('見本花子') < 0 && mw.indexOf('見本花子') >= 0, [mo, mw]);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
console.log('対象: ' + HTML + '／比べる相手: ' + MAIN);
process.exit(fail ? 1 : 0);
