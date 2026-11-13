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

/* 名簿（反証レビューの道具の名簿を合わせたもの）。ご本人は先頭 */
const ROSTERS = [
  [{ masterId: 'S', name: '甲 一郎', kana: 'こう いちろう' }, { masterId: 'O1', name: '見本 花子', kana: 'みほん はなこ' }, { masterId: 'O2', name: '乙 二郎', kana: 'おつ じろう' },
   { masterId: 'O3', name: '丙野 三子', kana: '' }, { masterId: 'O4', name: '髙架 よし子', kana: 'こうか よしこ' }],
  [{ masterId: 'S', name: '試験 一郎', kana: '' }, { masterId: 'O1', name: '見本 花子', kana: '' }, { masterId: 'O2', name: '乙 二郎', kana: '' }, { masterId: 'O3', name: '丙野 三子', kana: '' },
   { masterId: 'O4', name: '架空 かな', kana: 'かくう かな' }, { masterId: 'O5', name: '模擬 きく', kana: 'もぎ きく' }],
  [{ masterId: 'S', name: '試験 一郎', kana: 'しけん いちろう' }, { masterId: 'A', name: '見本 きく', kana: 'みほん きく' }, { masterId: 'B', name: '架空 ハル', kana: '' },
   { masterId: 'C', name: '甲 とめ', kana: '' }, { masterId: 'D', name: '乙 二郎', kana: '' }, { masterId: 'E', name: '乙 五郎', kana: '' }],
  /* 2回目の反証レビュー: 送り仮名の付く語に当たる1文字の姓・異体字の1文字の姓・ノの入る姓 */
  [{ masterId: 'S', name: '試験 一郎', kana: '' }, { masterId: 'G1', name: '上 一', kana: '' }, { masterId: 'G2', name: '長 二', kana: '' }, { masterId: 'G3', name: '関 三', kana: '' },
   { masterId: 'G4', name: '髙 四', kana: '' }, { masterId: 'G5', name: '一ノ瀬 五', kana: '' }, { masterId: 'G6', name: '見本 花子', kana: '' }]
];
/* 名簿に無い名前（ご家族・職員などの想定。名簿の語の前に付けて、取り残されないかを見る） */
const OFF = ['架山', 'カヤマ', 'かやま', '架川太郎'];
const CTX = ['', 'さん', '様', '氏', 'と', 'は', '。', '、', '〔', '〕', '（', '）', ' ', '先生', 'くん', 'ちゃん', '市', 'が来た', 'の娘さん', '看護師さん', '家', '\n', 'い', 'がり'];
const PRE = CTX.concat(OFF, ['娘の架山', '架山 ', '立ち']);
/* 後ろの語。SAME は同じ語をもう一度（1つの文に同じ名前が2回出る場面）・SAME2 は句読点を挟んでもう一度 */
const SAME = {}, SAME2 = {};
const TAIL = ['', '乙', '見本さん', '甲', '花子さん', 'を声をきく', '高い。', SAME, SAME2];

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

/* 総当たりで main の版（OLD）と比べる。stopAtFirst は、わざと弱くした版の確かめで最初の1件で止める（速く回すため） */
function compare(TPX, stopAtFirst) {
  const r = { cases: 0, worse: 0, round: 0, worseEx: [], roundEx: [] };
  for (let ri = 0; ri < ROSTERS.length; ri++) {
    const R = ROSTERS[ri];
    const tOld = OLD.aiMaskTerms(R, 'S'), tNow = TPX.aiMaskTerms(R, 'S');
    const words = wordsOf(R);
    const watch = words.concat(OFF, ['架川']);   // 見張る語（名簿の語・名簿に無い名前）
    for (const w of words) for (const p of PRE) for (const s of CTX) for (const w2 of TAIL) {
      const str = p + w + s + (w2 === SAME ? w : w2 === SAME2 ? '、' + w : w2);
      r.cases++;
      const mo = OLD.aiMaskDeep({ a: str }, tOld, {}).a;
      const un = {};
      const mn = TPX.aiMaskDeep({ a: str }, tNow, un).a;
      if (mo !== mn) {
        for (let k = 0; k < watch.length; k++) {
          const nm = watch[k];
          /* 名前の語が出てくる回数で比べる（同じ名前が2回の時、1か所だけ伏せて残した分も数える） */
          const cnt = function (x) { return x.split(nm).length - 1; };
          if (cnt(str) > 0 && cnt(mn) > cnt(mo)) {
            r.worse++; if (r.worseEx.length < 10) r.worseEx.push({ 名簿: ri + 1, 文: str, main: mo, 今: mn, 残った語: nm });
            break;
          }
        }
      }
      const back = TPX.aiUnmaskDeep({ a: mn }, tNow, un).a;
      if (back !== str) { r.round++; if (r.roundEx.length < 10) r.roundEx.push({ 名簿: ri + 1, 文: str, 送る文: mn, 戻した文: back }); }
      if (stopAtFirst && (r.worse || r.round)) return r;
    }
  }
  return r;
}

console.log('\n【1】総当たり: main の版より伏せ方が弱くならない（悪くなる例0件）');
const t0 = Date.now();
const res = compare(NOW, false);
const ms = Date.now() - t0;
t('組み合わせを作れた（' + res.cases + ' 通り・' + ms + 'ms）', res.cases > 50000, res.cases);
t('★main の版で伏せていた名前の語が、今の版の送る文に1つも残らない（悪くなる例 ' + res.worse + ' 件）', res.worse === 0, res.worseEx);
t('★今の版で伏せて戻すと元の文にちょうど戻る（戻らない例 ' + res.round + ' 件）', res.round === 0, res.roundEx);

console.log('\n【2】見張りが効いていることの確かめ（わざと弱くした版は落ちる）');
{
  /* 見張りが空振りしていないこと: 今の版の語の一覧から「他の利用者の氏名」を抜くと、main より悪くなる例が出る */
  const R = ROSTERS[0];
  const tOld = OLD.aiMaskTerms(R, 'S');
  const weak = NOW.aiMaskTerms(R, 'S').filter(function (x) { return x.token.indexOf('〔利用者1') !== 0; });
  const str = '見本花子が来た';
  const mo = OLD.aiMaskDeep({ a: str }, tOld, {}).a, mw = NOW.aiMaskDeep({ a: str }, weak, {}).a;
  t('弱くした語の一覧では、main で消えていた「見本花子」が残る（同じ比べ方で見つけられる）', mo.indexOf('見本花子') < 0 && mw.indexOf('見本花子') >= 0, [mo, mw]);
  /* 今の画面の文を書き換えて、わざと弱くした版を作る（手元のファイルに頼らない）。同じ総当たりで必ず見つかること */
  const rawNow = fs.readFileSync(HTML, 'utf8');
  const MUT = [
    ['名簿の語を全部、敬称の処理の前に置き換える版', 'if (x.late || str.indexOf(x.term) < 0) continue;', 'if (str.indexOf(x.term) < 0) continue;'],
    ['フルネームを最初の1か所だけ置き換える版', 'str = str.split(x.term).join(x.token); hit = true;', 'str = str.replace(x.term, x.token); hit = true;']
  ];
  MUT.forEach(function (m) {
    const at = rawNow.indexOf(m[1]);
    if (at < 0 || rawNow.indexOf(m[1], at + 1) >= 0) { t(m[0] + ': 書き換える所が1か所だけある', false, m[1]); return; }
    const tmp = path.join(require('os').tmpdir(), 'tp_mask_mut_' + process.pid + '.html');
    fs.writeFileSync(tmp, rawNow.slice(0, at) + m[2] + rawNow.slice(at + m[1].length));
    let W = null;
    try { W = loadTP(tmp); } finally { fs.unlinkSync(tmp); }
    const rw = W ? compare(W, true) : null;
    t('★' + m[0] + 'は、同じ総当たりで悪くなる例か戻らない例が見つかる', !!rw && (rw.worse > 0 || rw.round > 0), rw && (rw.worseEx[0] || rw.roundEx[0]));
  });
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
console.log('対象: ' + HTML + '／比べる相手: ' + MAIN);
process.exit(fail ? 1 : 0);
