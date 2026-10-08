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
t('★他の利用者の姓だけは伏せない（一般語を壊さないため）', byTerm['見本'] === undefined);
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

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
console.log('対象: ' + HTML);
process.exit(fail ? 1 : 0);
