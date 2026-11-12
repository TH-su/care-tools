/* training_plan_mask_test.js — 個別機能訓練計画書（training-plan.html）の純関数層 TP_PURE_MODULE を
   Node の vm で評価し、外部AIへ送る前の氏名の伏せ字（aiMaskTerms / aiMaskDeep / aiUnmaskDeep）を確かめる。
   対象HTMLは環境変数 TP_HTML で差し替えられる（作業ツリーと本番配置の両方を検証するため）。
     TP_HTML=/path/to/training-plan.html node check/unit/training_plan_mask_test.js
   ★名簿はすべて架空の氏名。実在の利用者名を書かないこと。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.TP_HTML || path.join(__dirname, '..', '..', 'training-plan.html');
const raw = fs.readFileSync(HTML, 'utf8');
const mark = raw.indexOf('TP_PURE_MODULE');
const OPEN = raw.indexOf('(function (global) {', mark);
const END = "})(typeof window !== 'undefined' ? window : this);";
const CLOSE = raw.indexOf(END, OPEN);
if (mark < 0 || OPEN < 0 || CLOSE < 0) { console.log('TP_PURE_MODULE を切り出せない: ' + HTML); process.exit(1); }
const src = raw.slice(OPEN, CLOSE + END.length);
const sb = {};
vm.createContext(sb);
vm.runInContext(src, sb);
const TP = sb.TP;

let pass = 0, fail = 0;
function t(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
}

console.log('\n【0】切り出し');
t('TP を評価できた', !!TP);
['aiMaskTerms', 'aiMaskDeep', 'aiUnmaskDeep'].forEach(function (f) { t(f + ' がある', !!TP && typeof TP[f] === 'function'); });
if (!TP || typeof TP.aiMaskTerms !== 'function') {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + (fail || 1) + ' 件失敗 ──────────');
  process.exit(1);
}

const ROSTER = [
  { masterId: 'M1', name: '試験 一郎', kana: 'しけん いちろう' },
  { masterId: 'M2', name: '見本　花子', kana: 'みほん はなこ' },
  { masterId: 'M3', name: '仮名 次', kana: '' },
  { masterId: 'M4', name: '', kana: '' }
];

console.log('\n【1】伏せる語の一覧');
const terms = TP.aiMaskTerms(ROSTER, 'M1');
const byTerm = {};
terms.forEach(function (x) { byTerm[x.term] = x.token; });
t('ご本人の氏名（空白あり・なし）を〔ご本人〕にする', byTerm['試験 一郎'] === '〔ご本人〕' && byTerm['試験一郎'] === '〔ご本人〕', byTerm);
t('ご本人の姓・名だけでも伏せる（2文字以上・戻す時に姓/名だけに戻るよう別の記号）', byTerm['試験'] === '〔ご本人・姓〕' && byTerm['一郎'] === '〔ご本人・名〕', byTerm);
t('ご本人のかな（空白あり・なし）も伏せる', byTerm['しけん いちろう'] === '〔ご本人・かな〕' && byTerm['しけんいちろう'] === '〔ご本人・かな〕');
t('他の利用者のかなも伏せる', byTerm['みほんはなこ'] === '〔利用者1・かな〕', byTerm);
t('他の利用者はフルネームを番号付きの記号にする', byTerm['見本花子'] === '〔利用者1〕' && byTerm['見本　花子'] === '〔利用者1〕', byTerm);
/* 2026-11-13 代表者の指示で仕様が逆になった（旧: 他の利用者の姓だけは伏せない）。姓・名は2文字以上の漢字の書き方だけ・かなの姓/名だけは今までどおり伏せない */
t('★他の利用者の姓だけ・名だけも伏せる（2文字以上・別の記号）', byTerm['見本'] === '〔利用者1・姓〕' && byTerm['花子'] === '〔利用者1・名〕', byTerm);
t('他の利用者のかなの姓だけ・名だけは伏せない（ひらがな2〜3字は一般の語に多く当たるため）', byTerm['みほん'] === undefined && byTerm['はなこ'] === undefined, byTerm);
t('1文字の語は伏せない（「次」など）', byTerm['次'] === undefined);
t('空の名簿行は無視する', terms.every(function (x) { return x.term.length >= 2; }));
t('長い語から先に並ぶ（部分一致で短い語が先に食わない）', terms.every(function (x, i) { return i === 0 || terms[i - 1].term.length >= x.term.length; }));
t('ご本人が名簿に無くても動く（全員を番号付きで伏せる）', TP.aiMaskTerms(ROSTER, 'MX').some(function (x) { return x.term === '試験一郎' && /^〔利用者\d+〕$/.test(x.token); }));
t('名簿が壊れていても落ちない', Array.isArray(TP.aiMaskTerms(null, 'M1')) && Array.isArray(TP.aiMaskTerms([null, 1, 'x'], 'M1')));

console.log('\n【2】送る前に伏せる・返事で戻す');
const input = {
  mode: 'next',
  sample: { note: '試験さんは見本花子さんと体操に参加。しけんいちろう様は意欲的', adlNote: '一郎さんは杖で歩行', tags: ['試験 一郎'] },
  prev: { hopeSelf: '試験一郎として家に帰りたい', programs: [{ content: '見本　花子さんと一緒に歩く' }] },
  limits: { hopeSelf: 100 }
};
const masked = TP.aiMaskDeep(input, terms);
const wire = JSON.stringify(masked);
t('★送る文に氏名が1つも残らない', ['試験', '一郎', 'しけん', 'いちろう', '見本花子', '見本　花子'].every(function (w) { return wire.indexOf(w) < 0; }), wire);
t('記号に置き換わっている', masked.sample.note === '〔ご本人・姓〕さんは〔利用者1〕さんと体操に参加。〔ご本人・かな〕様は意欲的', masked.sample.note);
t('配列・入れ子の中も伏せる', masked.sample.tags[0] === '〔ご本人〕' && masked.prev.programs[0].content.indexOf('〔利用者1〕') === 0, masked.prev.programs[0]);
t('数値・キー名・mode は変えない', masked.limits.hopeSelf === 100 && masked.mode === 'next' && Object.keys(masked.prev).join() === 'hopeSelf,programs');
t('元の入力は書き換えない', input.sample.note.indexOf('試験さん') === 0);

const out = { plan: { hopeSelf: '〔ご本人〕として家に帰りたい', remarks: '〔利用者1〕さんと交流を続ける', note: '〔ご本人・姓〕さんは〔ご本人・名〕と呼ばれる' } };
const back = TP.aiUnmaskDeep(out, terms);
t('★返事の記号をご本人の名簿の氏名に戻す', back.plan.hopeSelf === '試験 一郎として家に帰りたい', back.plan.hopeSelf);
t('★他の利用者の記号も名簿の氏名に戻す', back.plan.remarks === '見本　花子さんと交流を続ける', back.plan.remarks);
t('★姓・名の記号は姓・名だけに戻る（「試験的に」のような語をフルネームに化けさせない）', back.plan.note === '試験さんは一郎と呼ばれる', back.plan.note);
t('記号が無い文はそのまま', TP.aiUnmaskDeep({ a: '見守りで安定' }, terms).a === '見守りで安定');
t('名簿に無い番号の記号は戻さず残す（取り違えない）', TP.aiUnmaskDeep({ a: '〔利用者9〕' }, terms).a === '〔利用者9〕');

console.log('\n【3】送る時の書き方に戻す（職員の文を名簿の表記に書き換えない）');
{
  const used = {};
  const m = TP.aiMaskDeep({ hopeSelf: '試験一郎として家に帰りたい', remarks: '見本花子さんと' }, terms, used);
  const b = TP.aiUnmaskDeep({ hopeSelf: m.hopeSelf, remarks: m.remarks }, terms, used);
  t('★空白なしで書いた氏名は空白なしのまま戻る', b.hopeSelf === '試験一郎として家に帰りたい', b.hopeSelf);
  t('★他の利用者も書いた形のまま戻る', b.remarks === '見本花子さんと', b.remarks);
  t('控え（used）に実際に置き換えた書き方が入る', used['〔ご本人〕'] === '試験一郎' && used['〔利用者1〕'] === '見本花子', used);
}

console.log('\n【4】名簿と違う書き方・名簿に無いご本人・地名');
{
  const R2 = [{ masterId: 'K1', name: '髙木 花子', kana: 'たかぎ はなこ' }, { masterId: 'K2', name: '菊池 次郎', kana: 'きくち じろう' }];
  const tk = TP.aiMaskTerms(R2, 'K1');
  const w1 = JSON.stringify(TP.aiMaskDeep({ a: '高木花子さんと散歩。タカギハナコ様。はなこさん。たかぎさん' }, tk));
  t('★異体字（髙→高）で書いてもご本人の氏名を伏せる', w1.indexOf('高木') < 0 && w1.indexOf('花子') < 0, w1);
  t('★かなのカタカナ書き・名だけのかな・姓だけのかなも伏せる', w1.indexOf('タカギ') < 0 && w1.indexOf('はなこ') < 0 && w1.indexOf('たかぎ') < 0, w1);
  const tk2 = TP.aiMaskTerms(R2, 'K2');
  const w2 = TP.aiMaskDeep({ a: '菊池市の娘宅へ外出したい。菊池さんは意欲的' }, tk2).a;
  t('★ご本人の姓が地名と同じでも「菊池市」は壊さない', w2.indexOf('菊池市') === 0, w2);
  t('地名でない所の姓は伏せる', w2.indexOf('〔ご本人・姓〕さん') >= 0, w2);
  const tk3 = TP.aiMaskTerms([], 'ZZ', { name: '退去 太郎', kana: 'たいきょ たろう' });
  t('★名簿に無いご本人も、計画書が持つ氏名・かなで伏せる', TP.aiMaskDeep({ a: '退去太郎さん' }, tk3).a === '〔ご本人〕さん' && TP.aiHasSubject(tk3));
  const tk4 = TP.aiMaskTerms([], 'ZZ', { name: '退去太郎', kana: '' });
  t('空白の無い氏名だけでもフルネームは伏せる', TP.aiMaskDeep({ a: '退去太郎さん' }, tk4).a === '〔ご本人〕さん');
  t('★ご本人の氏名がどこにも無ければ「ご本人なし」と分かる（送らない判断に使う）', TP.aiHasSubject(TP.aiMaskTerms([{ masterId: 'X', name: '他人 一', kana: '' }], 'ZZ', { name: '', kana: '' })) === false);
  t('カタカナ変換', TP.aiToKatakana('たかぎ はなこ') === 'タカギ ハナコ');
  const R3 = [{ masterId: 'S1', name: '主 体', kana: '' }, { masterId: 'O1', name: '髙橋 一郎', kana: 'たかはし いちろう' }];
  const w3 = TP.aiMaskDeep({ a: '高橋一郎さんとタカハシイチロウさん' }, TP.aiMaskTerms(R3, 'S1')).a;
  t('★他の利用者も異体字（髙→高）で書いたフルネームを伏せる', w3.indexOf('高橋') < 0, w3);
  t('★他の利用者もかなのカタカナ書きを伏せる', w3.indexOf('タカハシ') < 0, w3);
}

console.log('\n【5】1文字の姓・他の利用者の姓だけ／名だけ（2026-11-13 代表者の指示）');
{
  /* 名簿はすべて記号的な架空の氏名 */
  const R = [
    { masterId: 'P1', name: '甲 一郎', kana: 'こう いちろう' },
    { masterId: 'P2', name: '乙 二郎', kana: '' },
    { masterId: 'P3', name: '丙野 三子', kana: 'へいの みつこ' },
    { masterId: 'P4', name: '丁 四', kana: '' }
  ];
  const tk = TP.aiMaskTerms(R, 'P1');
  const bt = {}; tk.forEach(function (x) { bt[x.term] = x; });
  t('★ご本人の1文字の姓を、前後が漢字でない所だけ伏せる語として持つ', bt['甲'] && bt['甲'].token === '〔ご本人・姓〕' && bt['甲'].one === true, bt['甲']);
  t('★他の利用者の1文字の姓も同じ扱い（〔利用者N・姓〕）', bt['乙'] && bt['乙'].token === '〔利用者1・姓〕' && bt['乙'].one === true, bt['乙']);
  t('1文字の名・1文字のかなは今までどおり伏せない', bt['四'] === undefined && bt['こ'] === undefined, Object.keys(bt));
  t('1文字の語は一覧の最後（長い語が先に置き換わる）', tk.every(function (x, i) { return i === 0 || tk[i - 1].term.length >= x.term.length; }));
  const M = (x, u) => TP.aiMaskDeep({ a: x }, tk, u || {}).a;
  t('★「甲さん」「甲と乙が」の1文字の姓を伏せる', M('甲さんは乙と散歩') === '〔ご本人・姓〕さんは〔利用者1・姓〕と散歩', M('甲さんは乙と散歩'));
  t('★文の頭・終わり・記号の隣でも伏せる', M('甲。乙') === '〔ご本人・姓〕。〔利用者1・姓〕' && M('（丁）') === '（〔利用者3・姓〕）', [M('甲。乙'), M('（丁）')]);
  t('★熟語の中の同じ字は伏せない（甲状腺・甲高い・乙女・丙午・包丁・丁寧）', M('甲状腺の検査。甲高い声。乙女。丙午。包丁で丁寧に') === '甲状腺の検査。甲高い声。乙女。丙午。包丁で丁寧に', M('甲状腺の検査。甲高い声。乙女。丙午。包丁で丁寧に'));
  t('★他の利用者の姓だけ（丙野）・名だけ（三子）を伏せる', M('丙野さんと三子さん') === '〔利用者2・姓〕さんと〔利用者2・名〕さん', M('丙野さんと三子さん'));
  const bare = M('丙野と三子が体操。乙と丁も参加。甲は見学');
  t('★敬称の無い書き方でも、他の利用者の姓・名と1文字の姓を伏せる（直す前の版では漏れていた）', ['丙野', '三子', '乙', '丁', '甲'].every(function (w) { return bare.indexOf(w) < 0; }), bare);
  t('他の利用者の姓も地名（丙野市）は壊さない', M('丙野市へ外出').indexOf('丙野市') === 0, M('丙野市へ外出'));
  t('フルネームは今までどおりフルネームの記号（姓・名に分けない）', M('丙野三子さん・乙 二郎さん') === '〔利用者2〕さん・〔利用者1〕さん', M('丙野三子さん・乙 二郎さん'));
  t('先に置いた記号〔…〕の中の字は1文字の姓でも触らない', TP.aiMaskDeep({ a: '〔ご本人・名〕' }, [{ term: '名', token: '〔X・姓〕', orig: '名', part: true, one: true }], {}).a === '〔ご本人・名〕');
  /* 消し過ぎの例: 規則どおり前後が漢字でない一般の語は伏せる（送る文では伏せ、返事では元に戻る） */
  const u = {};
  const over = TP.aiMaskDeep({ a: '足の甲に湿布' }, tk, u);
  t('（残る消し過ぎ）前後が漢字でない一般の語の字も伏せるが、戻すと元の文になる', over.a === '足の〔ご本人・姓〕に湿布' && TP.aiUnmaskDeep(over, tk, u).a === '足の甲に湿布', over.a);
  /* 往復: 新しい記号すべてで、伏せて戻すと元の文・控えに書いた形 */
  const src = { a: '甲さんは乙さん・丁さんと体操。丙野さん、三子さん、髙丙野さんではない' };
  const u2 = {};
  const m2 = TP.aiMaskDeep(src, tk, u2);
  const wire = JSON.stringify(m2);
  t('★送る文に1文字の姓・他の利用者の姓・名が残らない', ['甲さん', '乙さん', '丁さん', '丙野', '三子'].every(function (w) { return wire.indexOf(w) < 0; }), wire);
  t('★戻すと送った文と同じになる', TP.aiUnmaskDeep(m2, tk, u2).a === src.a, TP.aiUnmaskDeep(m2, tk, u2).a);
  t('控え（used）に置き換えた形が入る', u2['〔ご本人・姓〕'] === '甲' && u2['〔利用者1・姓〕'] === '乙' && u2['〔利用者2・姓〕'] === '丙野' && u2['〔利用者2・名〕'] === '三子', u2);
  /* 消し過ぎの例: 一般の語を大量に伏せない（2文字以上・名簿の語だけ） */
  const plain = '本日は午前に歩行訓練、午後は体操に参加。食事は全量摂取。家族との面会あり。次回も継続する。';
  t('★名簿の語を含まない一般の文は1字も変えない', M(plain) === plain, M(plain));
  t('名簿に1文字の姓が無い時の語の数は今までと同じ形（1文字の語を作らない）', TP.aiMaskTerms([{ masterId: 'A', name: '丙野 三子', kana: '' }], 'A').every(function (x) { return x.term.length >= 2; }));
}

console.log('\n【敬称】名簿に無い名前も「〜さん・〜様・〜氏」の前で伏せる（2026-10-08・監査10月版 #12）');
{
  const R = [{ masterId: 'S1', name: '試験 一郎', kana: 'しけん いちろう' }];
  const tk = TP.aiMaskTerms(R, 'S1');
  const used = {};
  const input = { a: '面会に来た娘さんと架山さん。看護師さんが説明し、架山さんも同意', b: 'カザン様・架川氏・ケアマネさん・皆様・様子・氏名・同様に・仕様・多様', c: '試験さんは架空太郎くんと歩く' };
  const m = TP.aiMaskDeep(input, tk, used);
  const wire = JSON.stringify(m);
  t('★名簿に無い名前（漢字）を伏せる', wire.indexOf('架山') < 0 && m.a.indexOf('〔人名1〕さん') >= 0, m.a);
  t('同じ書き方は同じ記号', (m.a.match(/〔人名1〕さん/g) || []).length === 2, m.a);
  t('★カタカナの名前・〜氏も伏せる', wire.indexOf('カザン') < 0 && wire.indexOf('架川') < 0, m.b);
  t('続柄・職種・一般の語は伏せない（娘さん・看護師さん・ケアマネさん・皆様）', /娘さん/.test(m.a) && /看護師さん/.test(m.a) && /ケアマネさん/.test(m.b) && /皆様/.test(m.b), [m.a, m.b]);
  t('様子・氏名・同様・仕様・多様は敬称と見なさない', /様子/.test(m.b) && /氏名/.test(m.b) && /同様に/.test(m.b) && /仕様/.test(m.b) && /多様/.test(m.b), m.b);
  t('名簿の記号（〔ご本人・姓〕さん）は二重に伏せない', m.c.indexOf('〔ご本人・姓〕さん') === 0 && m.c.indexOf('〔人名') > 0, m.c);
  t('★元の入力は書き換えない', input.a.indexOf('架山さん') > 0);
  const back = TP.aiUnmaskDeep(m, tk, used);
  t('★返事の〔人名N〕を元の書き方に戻す（送った文と同じに戻る）', back.a === input.a && back.b === input.b, [back.a, back.b]);
  const reply = TP.aiUnmaskDeep({ x: '〔人名1〕さんとの面会を続ける' }, tk, used);
  t('★AIが返した文の〔人名1〕も戻る', reply.x === '架山さんとの面会を続ける', reply.x);
  t('漢字・カタカナが続く時は敬称の直前の10字まで（戻せば元の文）', (function () { const u = {}; const r = TP.aiMaskDeep({ a: '早朝今朝本日昨日面会架山さん' }, [], u); return r.a === '早朝〔人名1〕さん' && u['〔人名1〕'] === '今朝本日昨日面会架山' && TP.aiUnmaskDeep(r, [], u).a === '早朝今朝本日昨日面会架山さん'; })(), '');
  t('ひらがなの名前（2〜4字）も伏せる・続柄のひらがな（おばあさん等）は伏せない', TP.aiMaskDeep({ a: 'はなこさん' }, [], {}).a === '〔人名1〕さん' && TP.aiMaskDeep({ a: 'おばあさんとおじいさん' }, [], {}).a === 'おばあさんとおじいさん', [TP.aiMaskDeep({ a: 'はなこさん' }, [], {}).a, TP.aiMaskDeep({ a: 'おばあさんとおじいさん' }, [], {}).a]);
  t('used を渡さなくても動く', TP.aiMaskDeep({ a: '架山さん' }, []).a === '〔人名1〕さん');
}

console.log('\n【敬称・漏れの再現】2026-10-08 審査で漏れた書き方（すべて架空の名前）');
{
  const M = (x) => TP.aiMaskDeep({ a: x }, [], {}).a;
  const leaks = [
    ['長男の健一さんが来所', '健一'], ['架山健一さん', '架山健一'], ['本多さんと面会', '本多'], ['大神様より電話', '大神'],
    ['架山さん相談あり', '架山'], ['架山さん名義の口座', '架山'], ['架山さん子供連れ', '架山'],
    ['架山看護師さん', '架山'], ['架山ケアマネさん', '架山'], ['架山ヘルパーさん', '架山'], ['架山ハナさん', '架山'],
    ['架山たろうさん', '架山'], ['架山 太郎さん', '架山'], ['山﨑さん', '山﨑'], ['髙﨑さん', '髙﨑'], ['ｶｻﾞﾝさん', 'ｶｻﾞﾝ'], ['佐々木小次郎さん', '佐々木'],
    ['架山先生', '架山'], ['主治医の架山先生', '架山'], ['架山ケアマネジャーさん', '架山'], ['カザン・ハナコさん', 'カザン'], ['架山・花子さん', '架山'], ['たなか氏', 'たなか'],
    // 2回目の審査（ひらがなの名前・区切りの後の職種・長いひらがな・改行なし空白・愛称＋続柄・崩れた敬称）
    ['さとうさん', 'さとう'], ['いとうさん', 'いとう'], ['さいとうさん', 'さいとう'], ['ふじいさん', 'ふじい'], ['なおこさん', 'なおこ'],
    ['架山なおこさん', 'なおこ'], ['あやのさん', 'あやの'], ['ゆきのちゃん', 'ゆきの'], ['架山あやのさん', 'あやの'],
    ['架山 看護師さん', '架山'], ['架山・ヘルパーさん', '架山'], ['架山 太郎 ヘルパーさん', '太郎'], ['架山 主治医先生', '架山'],
    ['かやまたろうさん', 'かやま'], ['やまだはなこさん', 'やまだ'], ['架山たろうべえさん', 'たろうべえ'],
    ['かやま たろうさん', 'かやま'], ['かやま・たろうさん', 'かやま'], ['よしこおばあちゃん', 'よしこ'], ['はなこねえちゃん', 'はなこ'],
    ['架山\u00a0太郎さん', '架山'], ['ジョン＝スミスさん', 'ジョン'], ['王さん', '王'], ['架山サン', '架山'], ['架山太郎ｻﾝ', '架山'], ['ﾀﾛｳﾁｬﾝ', 'ﾀﾛｳ'], ['架山花子殿', '架山'],
    // 3回目の審査（ひらがな＋漢字の名前・敬称の前の空白・区切り2つ以上やタブ／改行／ハイフン・区切りの後の1字の続柄・敬称の種類）
    ['よし子さん', 'よし子'], ['ちよ子様', 'ちよ子'], ['さだ子さん', 'さだ子'], ['美よ子さん', '美よ子'], ['架山よし子さん', '架山'], ['架山 よし子さん', '架山'],
    ['はる美さん', 'はる'], ['きく江さん', 'きく'], ['はなこ看護師さん', 'はなこ'], ['さとうケアマネさん', 'さとう'], ['架山はなこ看護師さん', 'はなこ'], ['架山さんとよし子さん', 'よし子'],
    ['架山 太郎 様', '架山'], ['架山太郎 様', '架山'], ['架山 様', '架山'], ['架山 さん', '架山'], ['架山太郎 殿', '架山'], ['かやま たろう さま', 'かやま'],
    ['架山　　太郎さん', '架山'], ['架山\t太郎さん', '架山'], ['架山\n太郎さん', '架山'], ['架山-太郎さん', '架山'], ['架山／太郎さん', '架山'], ['架山_太郎さん', '架山'],
    ['マリア・クララ・サントスさん', 'マリア'], ['たろう・架山さん', 'たろう'],
    ['架山 奥さん', '架山'], ['架山 娘さん', '架山'], ['架山・嫁さん', '架山'], ['架山 孫さん', '架山'], ['さとう 奥さん', 'さとう'],
    ['「架山さーん」と呼ぶ', '架山'], ['架山くーん', '架山'], ['架山ちゃーん', '架山'], ['架山せんせい', '架山'], ['架山センセイ', '架山'], ['架山夫人', '架山'], ['架山女史', '架山'], ['架山嬢', '架山'], ['架山樣', '架山']
  ];
  const bad = leaks.filter(([x, nm]) => M(x).indexOf(nm) >= 0);
  t('★審査で漏れた ' + leaks.length + ' 通りがすべて伏せられる', bad.length === 0, bad.map(([x]) => [x, M(x)]));
  t('名前の後ろの職種は残す（文の意味を保つ）', M('架山看護師さん') === '〔人名1〕看護師さん' && M('架山ケアマネさん') === '〔人名1〕ケアマネさん', [M('架山看護師さん'), M('架山ケアマネさん')]);
  const keep = ['お嬢さん', '赤ちゃん', '朝ごはん', '様子・氏名・同様', 'お疲れ様', 'ご苦労様', 'お医者さん', '面会に来た娘さん', 'おばあさんとおじいさん', '娘さんと息子さん', '医師の先生', '先生', 'ご家族様', 'ご利用者様', 'お客さん', '神様', 'ご本人様', 'お子さん', '長男さん', '次男様', 'ケアマネジャーさん', '娘さん', '息子さん', '看護師さん', '皆様', '同様に', '仕様', '多様', '様子', '様々', '氏名', 'お母さん', 'おばあさん'];
  const over = keep.filter(x => M(x) !== x);
  t('続柄・職種・一般の語はそのまま（' + keep.length + ' 通り）', over.length === 0, over.map(x => [x, M(x)]));
  const u = {};
  const m2 = TP.aiMaskDeep({ a: '前回の〔人名1〕さん。今回は架山さん' }, [], u);
  t('★前回戻し損ねた〔人名1〕と、新しい名前の番号が重ならない', m2.a === '前回の〔人名1〕さん。今回は〔人名2〕さん' && TP.aiUnmaskDeep(m2, [], u).a === '前回の〔人名1〕さん。今回は架山さん', [m2.a, TP.aiUnmaskDeep(m2, [], u).a]);
  t('番号の起点は控えの対応表に入らない（戻す時に混ざらない）', Object.keys(u).join() === '〔人名2〕', Object.keys(u));
  const u3 = {}; TP.aiMaskDeep({ a: '架山さん' }, [], u3);
  const variants = TP.aiUnmaskDeep({ a: '［人名1］さん・〔人名１〕さん・[人名1]さん・【人名1】さん・〔人名9〕さん' }, [], u3).a;
  t('★AIが記号の形を崩しても（括弧・全角数字）送った番号なら戻す・送っていない番号はそのまま', variants === '架山さん・架山さん・架山さん・架山さん・〔人名9〕さん', variants);
  const u4 = {};
  const m4 = TP.aiMaskDeep({ a: '前回〔人名１〕さん、前回[人名2]さん、架山さん' }, [], u4);
  t('★崩れた形で残っていた記号も数えて、新しい番号は重ならない', m4.a === '前回〔人名１〕さん、前回[人名2]さん、〔人名3〕さん' && TP.aiUnmaskDeep(m4, [], u4).a === '前回〔人名１〕さん、前回[人名2]さん、架山さん', [m4.a, TP.aiUnmaskDeep(m4, [], u4).a]);
  const u5 = {}; TP.aiMaskDeep({ a: '架山さん' }, [], u5);
  t('先頭に0の付いた番号（〔人名01〕）も戻す', TP.aiUnmaskDeep({ a: '〔人名01〕さん' }, [], u5).a === '架山さん', TP.aiUnmaskDeep({ a: '〔人名01〕さん' }, [], u5).a);
  const big = ('架山さんは散歩した。ヘルパーさんと見本さんが付き添い、さとうさんの娘さんが面会。').repeat(1500);
  const t0 = Date.now(); const mb = TP.aiMaskDeep({ a: big }, [], {}); const ms = Date.now() - t0;
  t('約' + Math.round(big.length / 1000) + '千字でも1秒以内（' + ms + 'ms）', ms < 1000 && mb.a.indexOf('架山') < 0, ms);
}

console.log('\n【確認画面・設定】送信の説明と、設定画面の確認・取り消し（2026-10-08・監査10月版 #12）');
{
  t('★説明に「〜さん・〜様・〜氏の直前の名前も置き換える」「機械的な目安で取りこぼしがある」がある', /〜さん・〜様・〜氏/.test(raw) && /機械的な目安なので取りこぼしがあります/.test(raw));
  t('★AIへの指示に〔人名1〕も記号として載っている（形を崩さない）', /〔利用者1〕〔人名1〕などは、氏名を伏せた記号。記号は〔 〕も数字もそのままの形で使い/.test(raw));
  t('設定画面に確認の状態と、確認・取り消しのボタンがある', /id="aiConsentState"/.test(raw) && /id="btnAiConsent"/.test(raw) && /id="btnAiConsentRevoke"/.test(raw));
  t('ボタンに処理がつながっている', /\$\('btnAiConsent'\)\.addEventListener\('click', aiConsentStart\)/.test(raw) && /\$\('btnAiConsentRevoke'\)\.addEventListener\('click', aiConsentRevoke\)/.test(raw));
  /* 取り消しを実物で動かす */
  const cut = (name) => { const h = raw.indexOf('function ' + name + '('); let k = raw.indexOf('{', h), d = 0; for (; k < raw.length; k++) { if (raw[k] === '{') d++; else if (raw[k] === '}') { d--; if (d === 0) return raw.slice(h, k + 1); } } };
  const store = { tp_ai_notice_v1: '1' };
  const els = {};
  const el = id => (els[id] = els[id] || { textContent: '', hidden: false });
  const box = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    confirm: () => true, $: el, AI_NOTICE_KEY: 'tp_ai_notice_v1' };
  vm.createContext(box);
  vm.runInContext([cut('renderAiConsent'), cut('aiConsentRevoke')].join('\n'), box);
  box.renderAiConsent();
  t('確認済みの端末では「取り消す」だけが出る', els.btnAiConsent.hidden === true && els.btnAiConsentRevoke.hidden === false && /確認済み/.test(els.aiConsentState.textContent), els);
  box.aiConsentRevoke();
  t('★取り消すと印が消え、次に送る時にもう一度説明が出る状態になる', !('tp_ai_notice_v1' in store) && els.btnAiConsent.hidden === false && /取り消しました/.test(els.aiState.textContent), [store, els.aiState.textContent]);
  box.confirm = () => false; store.tp_ai_notice_v1 = '1';
  box.aiConsentRevoke();
  t('取り消しの確認で「キャンセル」なら何も変えない', store.tp_ai_notice_v1 === '1');
  t('★印に保存するのは「確認した」の1だけ（氏名・記録は保存しない）', /localStorage\.setItem\(AI_NOTICE_KEY, '1'\)/.test(raw));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
console.log('対象: ' + HTML);
process.exit(fail ? 1 : 0);
