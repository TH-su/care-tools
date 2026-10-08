/* 入居者マスタ（resident-master.html）の定期薬の入力パネル（mpk・2026-10-01）と候補データ
   meds-yakka-naiyo.js のテスト。
   実行: node check/unit/meds_picker_test.js
         MASTER_HTML=<別の作業コピー>/resident-master.html node check/unit/meds_picker_test.js
         （meds-effect-dict.js と meds-yakka-naiyo.js は既定で HTML と同じフォルダから読む。
           個別に差し替える時は MEDS_FX_JS / MEDS_YAKKA_JS）

   最重要:
     ①パネルが作る1行は、既存の用法の読み取り（medSlotsFromText・許可リスト方式）で必ず 'ok' になり、
       選んだ時間帯と一致する（時間帯15通り×食後/食前の全30通り）。読み取り側は変えない
     ②textarea の文字列操作は、触った行以外を1文字も変えない
     ③パネルの部品に data-k が付かない（collectForm が保存項目として拾ってしまう）
     ④候補データは公的リストの加工物で、全角英数が残らず・重複が無く・出典が書いてある

   ★出力に console を使わない（gas/tests にあった頃からの決まり。個人情報を出力に流さないため）。
     薬剤名は一般的な品名だけで、実在の入居者の処方は1件も含まない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const DIR = path.dirname(HTML_PATH);
const FX_PATH = process.env.MEDS_FX_JS || path.join(DIR, 'meds-effect-dict.js');
const YK_PATH = process.env.MEDS_YAKKA_JS || path.join(DIR, 'meds-yakka-naiyo.js');
const src = fs.readFileSync(HTML_PATH, 'utf8');

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond, info){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '\n    → ' + JSON.stringify(info) : '')); } }
function eq(label, got, want){ const g = JSON.stringify(got), w = JSON.stringify(want); t(label, g === w, g === w ? undefined : { 期待: want, 実際: got }); }

/* 関数を名前で切り出す（HTML ごと評価すると DOM 依存の初期化まで走る）。master_confirm_test.js と同じ作法 */
function grabFn(name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for(let i = start; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
/* var を切り出す（行末が ; の行まで。MED_SLOT_TOK のように複数行のものもある） */
function grabVar(name){
  const start = src.indexOf('\nvar ' + name + '=');
  if(start < 0) throw new Error('変数が見つかりません: ' + name);
  const lines = src.slice(start + 1).split('\n'), out = [];
  for(const l of lines){ out.push(l); if(/;\s*(?:\/\*.*\*\/\s*)?$/.test(l)) break; }
  return out.join('\n');
}
function between(a, b){
  const i = src.indexOf(a), j = src.indexOf(b);
  if(i < 0 || j < 0 || j < i) throw new Error('印が見つかりません: ' + a + ' / ' + b);
  return src.slice(i, j + b.length);
}

/* ── 読み込み ── */
const box = { window: {} };
vm.createContext(box);
vm.runInContext(fs.readFileSync(FX_PATH, 'utf8'), box, { filename: 'meds-effect-dict.js' });
vm.runInContext('var MedsEffect = window.MedsEffect;', box);
const MED_VARS = ['MED_USE_RE','MED_SLOT_KEYS','MED_SLOT_LBL','MED_PRN_RE','MED_NONE_RE','MED_SLOT_TOK','MED_SLOT_ONE','MED_DOSE_RE','MED_FREQ_RE','MED_SEP_RE'];
const MED_FNS = ['mdKey','medSplit_','medAlnumHalf_','medPrnWhen_','medTokHead_','medUseParse_','medSlotRows_','medSlotsFromText'];
vm.runInContext(MED_VARS.map(grabVar).join('\n') + '\n' + MED_FNS.map(grabFn).join('\n'), box, { filename: 'resident-master.html(med)' });
const PURE = between('/* ══ mpk-pure-begin ══ */', '/* ══ mpk-pure-end ══ */');
vm.runInContext(PURE, box, { filename: 'resident-master.html(mpk)' });
const { mpkNorm, mpkSearch, mpkLine, mpkAppend, mpkRemoveAt, mpkReplaceAt, mpkLines, medSlotsFromText, mpkUsedNames, mpkUnitOf, mpkSearchAll, mpkNameSafe, mpkLineCheck, mpkEditName, mpkLineRange, mpkFreeCheck } = box;

group('読み込み');
t('純関数が揃っている', [mpkNorm, mpkSearch, mpkLine, mpkAppend, mpkRemoveAt, mpkReplaceAt, mpkLines, mpkUsedNames, mpkUnitOf, mpkSearchAll].every(f => typeof f === 'function'));
t('純関数の区画が全件データ・氏名に触れない（fullMap／fullOf／shBase／medsRegular を参照しない）', !/fullMap|fullOf|shBase|medsRegular|roster/.test(PURE.replace(/\/\*[\s\S]*?\*\//g, '')));
t('純関数の区画に DOM・保存・console が無い', !/document\.|\$\(|localStorage|sessionStorage|console\./.test(PURE));

/* ── ① 全30通りの往復 ── */
group('① mpkLine → medSlotsFromText（時間帯15通り×食後/食前＝30通り）');
const SL = ['朝','昼','夕','眠前'], KEY = { 朝:'morning', 昼:'noon', 夕:'evening', 眠前:'bedtime' };
const ORDER = ['morning','noon','evening','bedtime'];
function combos(){ const out = []; for(let m = 1; m < 16; m++) out.push(SL.filter((_, i) => m & (1 << i))); return out; }
const seen = new Set();
let n30 = 0;
for(const meal of ['食後','食前']){
  for(const slots of combos()){
    const line = mpkLine({ name:'アムロジピンOD錠5mg', dose:1, unit:'錠', slots, meal });
    const r = medSlotsFromText(line);
    const want = ORDER.filter(k => slots.some(s => KEY[s] === k));
    const good = !!line && r.lines.length === 1 && r.lines[0].status === 'ok' && JSON.stringify(r.slots) === JSON.stringify(want);
    t(slots.join('') + '/' + meal + ' → ' + line, good, { line, r, want });
    if(good) n30++;
    seen.add(line);
  }
}
eq('30通りすべて ok', n30, 30);
eq('眠前だけは食後/食前で同じ行（30通りで異なる行は29）', seen.size, 29);
/* 単位・メーカー・小数でも同じく ok（部品の組み合わせで読み取りが崩れないこと） */
{
  let bad = [];
  for(const unit of ['錠','包','カプセル','g','mL']) for(const dose of [0.5, 1, 1.5, 2, 3]) for(const maker of ['', 'サワイ', 'YD']) for(const meal of ['食後','食前']) for(const slots of combos()){
    const line = mpkLine({ name:'酸化マグネシウム錠330mg', maker, dose, unit, slots, meal });
    const r = medSlotsFromText(line);
    const want = ORDER.filter(k => slots.some(s => KEY[s] === k));
    if(!(r.lines[0] && r.lines[0].status === 'ok' && JSON.stringify(r.slots) === JSON.stringify(want))) bad.push(line);
  }
  eq('単位5×1回量5×メーカー3×30通り＝2250行がすべて ok', bad.slice(0, 5), []);
}

group('mpkLine の形');
eq('例1', mpkLine({ name:'アムロジピンOD錠5mg', dose:1, unit:'錠', slots:['朝'], meal:'食後' }), 'アムロジピンOD錠5mg 1錠分1 朝食後');
eq('例2', mpkLine({ name:'酸化マグネシウム錠330mg', dose:1, unit:'錠', slots:['朝','夕'], meal:'食後' }), '酸化マグネシウム錠330mg 2錠分2 朝夕食後');
eq('3つ→毎食後', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['夕','朝','昼'], meal:'食後' }), 'テスト錠 3錠分3 毎食後');
eq('毎食後・就寝前', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['朝','昼','夕','眠前'], meal:'食後' }), 'テスト錠 4錠分4 毎食後・就寝前');
eq('食前', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['朝','夕'], meal:'食前' }), 'テスト錠 2錠分2 朝夕食前');
eq('眠前だけ（食事の指定は使わない）', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['眠前'], meal:'食前' }), 'テスト錠 1錠分1 就寝前');
eq('眠前だけなら食事の指定が無くても作れる', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['眠前'] }), 'テスト錠 1錠分1 就寝前');
eq('朝＋眠前', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['眠前','朝'], meal:'食後' }), 'テスト錠 2錠分2 朝食後・就寝前');
eq('小数 0.5×2＝1', mpkLine({ name:'テスト錠', dose:0.5, unit:'錠', slots:['朝','夕'], meal:'食後' }), 'テスト錠 1錠分2 朝夕食後');
eq('小数 0.5×3＝1.5', mpkLine({ name:'テスト錠', dose:0.5, unit:'錠', slots:['朝','昼','夕'], meal:'食後' }), 'テスト錠 1.5錠分3 毎食後');
eq('小数 0.5×1＝0.5', mpkLine({ name:'テスト錠', dose:0.5, unit:'錠', slots:['朝'], meal:'食後' }), 'テスト錠 0.5錠分1 朝食後');
eq('1.5×2＝3', mpkLine({ name:'テスト散', dose:1.5, unit:'g', slots:['朝','夕'], meal:'食後' }), 'テスト散 3g分2 朝夕食後');
eq('メーカー付き', mpkLine({ name:'アムロジピン錠5mg', maker:'サワイ', dose:1, unit:'錠', slots:['朝'], meal:'食後' }), 'アムロジピン錠5mg「サワイ」 1錠分1 朝食後');
eq('手書きの用法（前後の空白は除く・時間帯より優先）', mpkLine({ name:'アレンドロン酸錠35mg', free:'  1錠 週1回 起床時 ', dose:1, unit:'錠', slots:['朝'], meal:'食後' }), 'アレンドロン酸錠35mg 1錠 週1回 起床時');
eq('手書きの用法＋メーカー', mpkLine({ name:'テスト錠', maker:'トーワ', free:'隔日 朝食後' }), 'テスト錠「トーワ」 隔日 朝食後');
eq('改行は1行に畳む', mpkLine({ name:'テスト錠\n', free:'週1回\n月曜' }), 'テスト錠 週1回 月曜');
eq('薬剤名なし→空', mpkLine({ name:'  ', dose:1, unit:'錠', slots:['朝'], meal:'食後' }), '');
eq('時間帯なし・手書きなし→空', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:[], meal:'食後' }), '');
eq('1回量なし→空', mpkLine({ name:'テスト錠', unit:'錠', slots:['朝'], meal:'食後' }), '');
eq('1回量0→空', mpkLine({ name:'テスト錠', dose:0, unit:'錠', slots:['朝'], meal:'食後' }), '');
eq('朝昼夕があるのに食後/食前が無い→空', mpkLine({ name:'テスト錠', dose:1, unit:'錠', slots:['朝'] }), '');
eq('引数なし→空', mpkLine(), '');

/* ── mpkNorm / mpkSearch ── */
group('mpkNorm');
eq('全角英数→半角・小文字', mpkNorm('ＡＢＣ１２３ｄｅ'), 'abc123de');
eq('ひらがな→カタカナ', mpkNorm('あむろじぴん'), 'アムロジピン');
eq('半角カナ→全角カナ（濁点・半濁点も）', mpkNorm('ｱﾑﾛｼﾞﾋﾟﾝ'), 'アムロジピン');
eq('空白と中黒を除く', mpkNorm(' フェロ・グラデュメット　錠 '), 'フェログラデュメット錠');
eq('半角の中黒も除く', mpkNorm('ﾌｪﾛ･ｸﾞﾗﾃﾞｭﾒｯﾄ'), 'フェログラデュメット');
eq('英字は小文字', mpkNorm('OD錠'), 'od錠');
eq('null は空', mpkNorm(null), '');

group('mpkSearch');
{
  const items = [
    ['ノルアムロジピン錠', '錠', []],
    ['アムロジピン錠2.5mg', '錠', ['サワイ']],
    ['ベシル酸アムロジピン錠', '錠', []],
    ['アムロジピンOD錠5mg', '錠', []],
    ['アスピリン', 'g', []],
    ['テスト用アムロ', '錠', []]
  ];
  const used = n => n === 'アムロジピンOD錠5mg' || n === 'テスト用アムロ';
  eq('前方一致が先・その中で使用中が先・部分一致はその後（使用中が先）',
    mpkSearch('アムロ', items, used).map(x => x[0]),
    ['アムロジピンOD錠5mg', 'アムロジピン錠2.5mg', 'テスト用アムロ', 'ノルアムロジピン錠', 'ベシル酸アムロジピン錠']);
  eq('isUsed なしでも元の並びで返す', mpkSearch('アムロ', items).map(x => x[0]),
    ['アムロジピン錠2.5mg', 'アムロジピンOD錠5mg', 'ノルアムロジピン錠', 'ベシル酸アムロジピン錠', 'テスト用アムロ']);
  eq('1文字では探さない', mpkSearch('ア', items, used), []);
  eq('空白だけでは探さない', mpkSearch('  ', items, used), []);
  eq('ひらがなで探せる', mpkSearch('あむろじぴんod', items).map(x => x[0]), ['アムロジピンOD錠5mg']);
  eq('全角で探せる', mpkSearch('ＯＤ錠', items).map(x => x[0]), ['アムロジピンOD錠5mg']);
  eq('上限（limit=2）', mpkSearch('アムロ', items, used, 2).map(x => x[0]), ['アムロジピンOD錠5mg', 'アムロジピン錠2.5mg']);
  const many = Array.from({ length: 20 }, (_, i) => ['テスト錠' + i, '錠', []]);
  eq('既定の上限は8件', mpkSearch('テスト', many).length, 8);
  t('戻り値は元の要素そのもの（単位・メーカーが付いてくる）', mpkSearch('アムロジピン錠2', items)[0] === items[1]);
  eq('isUsed が例外を投げても止まらない', mpkSearch('アスピ', items, () => { throw new Error('x'); }).map(x => x[0]), ['アスピリン']);
}

/* ── ② 文字列操作 ── */
group('mpkAppend');
const L = 'テスト錠 1錠分1 朝食後';
eq('空', mpkAppend('', L), L);
eq('空白だけ', mpkAppend(' \n ', L), L);
eq('「なし」だけ→置き換え', mpkAppend('なし', L), L);
eq('「特になし」＋前後の空白・改行→置き換え', mpkAppend('  特になし\n', L), L);
eq('既存あり→改行して足す', mpkAppend('A錠 1錠分1 朝食後', L), 'A錠 1錠分1 朝食後\n' + L);
eq('末尾改行あり→そのまま足す', mpkAppend('A錠 1錠分1 朝食後\n', L), 'A錠 1錠分1 朝食後\n' + L);
eq('CRLF の既存行は1文字も変えない', mpkAppend('A\r\nB', L), 'A\r\nB\n' + L);
eq('「なし」を含む複数行は置き換えない', mpkAppend('なし\nB錠', L), 'なし\nB錠\n' + L);
eq('足す行が空なら何もしない', mpkAppend('A', ''), 'A');
eq('null の text', mpkAppend(null, L), L);

group('mpkLines / mpkRemoveAt / mpkReplaceAt');
const TX = 'A錠 1錠分1 朝食後\n\n  \nB錠　2錠分2 朝夕食後 \r\nC散 1g分1 就寝前';
eq('空行を除いた行（中身は元のまま）', mpkLines(TX), ['A錠 1錠分1 朝食後', 'B錠　2錠分2 朝夕食後 ', 'C散 1g分1 就寝前']);
eq('空', mpkLines(''), []);
eq('真ん中を消す（空行・CRLF・他の行はそのまま）', mpkRemoveAt(TX, 1), 'A錠 1錠分1 朝食後\n\n  \nC散 1g分1 就寝前');
eq('最後を消す（末尾に改行を残さない）', mpkRemoveAt(TX, 2), 'A錠 1錠分1 朝食後\n\n  \nB錠　2錠分2 朝夕食後 ');
eq('先頭を消す', mpkRemoveAt(TX, 0), '\n  \nB錠　2錠分2 朝夕食後 \r\nC散 1g分1 就寝前');
eq('1行だけを消すと空', mpkRemoveAt('A錠', 0), '');
eq('末尾改行つきの最後の行', mpkRemoveAt('A\nB\n', 1), 'A\n');
eq('範囲外は何もしない', mpkRemoveAt(TX, 3), TX);
eq('負の位置は何もしない', mpkRemoveAt(TX, -1), TX);
eq('置き換え（改行・他の行はそのまま）', mpkReplaceAt(TX, 1, 'X錠 1錠分1 朝食後'), 'A錠 1錠分1 朝食後\n\n  \nX錠 1錠分1 朝食後\r\nC散 1g分1 就寝前');
eq('置き換え（最後の行）', mpkReplaceAt(TX, 2, 'Y'), 'A錠 1錠分1 朝食後\n\n  \nB錠　2錠分2 朝夕食後 \r\nY');
eq('置き換え（範囲外は何もしない）', mpkReplaceAt(TX, 9, 'Y'), TX);
eq('置き換え（空の行では置き換えない）', mpkReplaceAt(TX, 0, '  '), TX);
eq('置き換えの行に改行があっても1行に畳む', mpkReplaceAt('A\nB', 0, 'X\nY'), 'X Y\nB');
/* 総当たり: どの行を消しても・置き換えても、他の行の文字は1文字も変わらない */
{
  const parts = ['A錠', '', ' ', 'B錠 1錠分1 朝食後', 'C　D', 'なし'], eols = ['\n', '\r\n', '\r'];
  let bad = 0, cases = 0;
  for(let seed = 1; seed <= 400; seed++){
    let x = seed, s = '';
    const rnd = k => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % k; };
    const n = 1 + rnd(6);
    for(let i = 0; i < n; i++) s += parts[rnd(parts.length)] + (i < n - 1 || rnd(2) ? eols[rnd(3)] : '');
    const ls = mpkLines(s);
    for(let i = 0; i < ls.length; i++){
      cases++;
      const r1 = mpkLines(mpkRemoveAt(s, i)), w1 = ls.slice(0, i).concat(ls.slice(i + 1));
      const r2 = mpkLines(mpkReplaceAt(s, i, 'Z錠')), w2 = ls.slice(0, i).concat(['Z錠'], ls.slice(i + 1));
      if(JSON.stringify(r1) !== JSON.stringify(w1) || JSON.stringify(r2) !== JSON.stringify(w2)) bad++;
    }
  }
  t('総当たり ' + cases + ' 件で他の行が変わらない', bad === 0 && cases > 500, { bad, cases });
}

/* ── ③ 画面の部品 ── */
group('画面の部品（data-k を付けない・置き場所・紙に出さない）');
{
  /* コメントを除いたコード本体で見る（コメントには「data-k を付けない」等の説明が書いてある） */
  const noCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const SEC = noCmt(between('/* ══════════ 定期薬の入力パネル', '\nfunction mpkInit_(') + grabFn('mpkInit_'));
  const sb = { window: {} };
  vm.createContext(sb);
  /* esc は1行の関数で、正規表現に引用符を含む（かっこ数えの切り出しが使えない）ので行で切り出す */
  const escLine = (src.match(/\nfunction esc\(s\)\{[^\n]*\}\n/) || [''])[0];
  vm.runInContext(escLine + '\n' + grabVar('MPK_DOSES') + '\n' + grabFn('mpkChips_') + '\n' + grabFn('mpkPanelHtml_'), sb);
  const panel = vm.runInContext('mpkPanelHtml_()', sb);
  t('パネルに data-k が無い', !/data-k\b/.test(panel));
  t('パネルに他の保存項目の印（data-rhythm/consent/bf*/target/psec/xref）が無い', !/data-(?:rhythm|consent|bf|target|psec|xref)/.test(panel));
  t('mpk の区画で data-k を読むのは textarea の取得1か所だけ（付けない）', (SEC.match(/data-k\b/g) || []).length === 1 && SEC.indexOf('textarea[data-k="medsRegular"]') >= 0);
  t('パネルの見出しは h3 ではない（編集画面の見出しタブを増やさない）', !/<h3/i.test(panel));
  t('薬剤名欄: type=text・autocomplete=off', /<input type="text" id="mpkName" autocomplete="off"/.test(panel));
  t('プレビューは aria-live=polite', /id="mpkPreview" aria-live="polite"/.test(panel));
  t('チップは aria-pressed を持つ', (panel.match(/aria-pressed="false"/g) || []).length === 4 + 5 + 1 + 4 + 2);
  t('1回量 0.5/1/2/3・単位 錠/包/カプセル/g/mL・朝/昼/夕/眠前・食後/食前',
    ['0.5','1','2','3'].every(v => panel.includes('data-mpk-dose="' + v + '"')) &&
    ['錠','包','カプセル','g','mL'].every(v => panel.includes('data-mpk-unit="' + v + '"')) &&
    ['朝','昼','夕','眠前'].every(v => panel.includes('data-mpk-slot="' + v + '"')) &&
    ['食後','食前'].every(v => panel.includes('data-mpk-meal="' + v + '"')));
  t('「その他」の1回量は 0.5 刻み', /id="mpkDoseOther" min="0.5" step="0.5"/.test(panel));
  t('mpk の区画に localStorage・console が無い', !/localStorage|sessionStorage|console\./.test(SEC));
  t('confirm() を使わない', !/\bconfirm\(/.test(SEC));
  t('textarea を書き換えたら input イベントを出す', /dispatchEvent\(ev\)/.test(grabFn('mpkSetTa_')) && /'input'/.test(grabFn('mpkSetTa_')));
  const oe = grabFn('openEdit');
  t('パネルは「薬剤情報（定期）」の欄のすぐ上', /mpkPanelHtml_\(\)\+\n\s*fld\('medsRegular','薬剤情報（定期）',r\.medsRegular,'textarea'\)\+/.test(oe));
  t('既存の欄（ラベル・data-k・並び）はそのまま', /fld\('medsRegular','薬剤情報（定期）',r\.medsRegular,'textarea'\)\+\n\s*fld\('medsNotes','薬備考',r\.medsNotes,'textarea'\)\+/.test(oe));
  t('openEdit が innerHTML の後で mpkInit_ を呼ぶ', oe.indexOf("$('editBox').innerHTML=h;") >= 0 && oe.indexOf('mpkInit_();') > oe.indexOf("$('editBox').innerHTML=h;"));
  t('印刷には出さない', /@media print\{\.mpk\{display:none !important\}\}/.test(src));
  t('タップ領域44px以上（チップ・候補・入力欄）', /\.mpk \.chip\{min-height:44px; min-width:44px/.test(src) && /\.mpk-cand button\{min-height:44px/.test(src) && /\.mpk input\[type=text\],\.mpk input\[type=number\],\.mpk select\{font-size:1rem; min-height:44px/.test(src));
  t('選択中のチップは色だけにしない（✓＋太字）', /\.mpk \.chip\.on\{font-weight:700\}/.test(src) && /\.mpk \.chip\.on::before\{content:"✓"/.test(src));
}

/* ── ④ 候補データ ── */
group('候補データ meds-yakka-naiyo.js');
{
  const yk = fs.readFileSync(YK_PATH, 'utf8');
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(yk, sb, { filename: 'meds-yakka-naiyo.js' });
  const Y = sb.window.MedsYakka;
  t('window.MedsYakka が生える', !!Y && Array.isArray(Y.items));
  const items = (Y && Y.items) || [];
  t('件数 1000 以上（' + items.length + '件）', items.length >= 1000, items.length);
  t('版は YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(Y.version), Y.version);
  t('出典コメント（PDL1.0 の条件）', /^\/\* 出典：厚生労働省 薬価基準収載品目リスト（内用薬・令和\d+年\d+月\d+日適用）を加工して作成/.test(yk));
  t('source に出典', /厚生労働省 薬価基準収載品目リスト（内用薬・/.test(Y.source || ''));
  t('形 [品名, 単位, [メーカー…]]', items.every(i => Array.isArray(i) && i.length === 3 && typeof i[0] === 'string' && i[0] && typeof i[1] === 'string' && Array.isArray(i[2]) && i[2].every(m => typeof m === 'string' && m)));
  const FW = /[０-９Ａ-Ｚａ-ｚ．％]/;
  eq('品名・メーカーに全角英数・．・％が残っていない', items.filter(i => FW.test(i[0]) || i[2].some(m => FW.test(m))).slice(0, 5), []);
  const names = items.map(i => i[0]);
  eq('品名の重複なし', names.filter((n, k) => names.indexOf(n) !== k).slice(0, 5), []);
  eq('品名の末尾にメーカー「」が残っていない', names.filter(n => /「[^「」]*」$/.test(n)).slice(0, 5), []);
  eq('単位は 錠/カプセル/包/g/mL のどれか', items.filter(i => ['錠','カプセル','包','g','mL'].indexOf(i[1]) < 0).slice(0, 5), []);
  eq('前後に空白のある品名なし', names.filter(n => n !== n.trim()).slice(0, 5), []);
  const v = (src.match(/var MPK_YAKKA_SRC='meds-yakka-naiyo\.js\?v=([^']+)'/) || [])[1];
  eq('読み込みの ?v= がデータの版と同じ', v, Y.version);
  t('一般的な品目が入っている（酸化マグネシウム330mg錠・アムロジピンOD錠10mg）', names.indexOf('酸化マグネシウム330mg錠') >= 0 && names.indexOf('アムロジピンOD錠10mg') >= 0);
  /* 実データ全件: 1日1回朝食後の行を作って読み取りに通す（情報として件数を出す） */
  let okN = 0; const notOk = [];
  for(const it of items){
    const line = mpkLine({ name: it[0], maker: it[2][0] || '', dose: 1, unit: it[1], slots: ['朝'], meal: '食後' });
    const r = medSlotsFromText(line);
    if(r.lines[0] && r.lines[0].status === 'ok' && r.slots.join() === 'morning') okN++; else notOk.push(it[0]);
  }
  const spaced = notOk.filter(n => /[\s　]/.test(n)).length;
  say('    （参考）全' + items.length + '品目で「1錠分1 朝食後」を作ると ok ' + okN + '件・ok にならない ' + notOk.length + '件（うち品名に空白を含む ' + spaced + '件）');
  /* 品名に空白がある品（例 漢方の生薬「ホリエ　◯◯K」）は、既存の読み取りが最初の空白から先を用法とみなすため
     'review'（要確認）になる。読み取り側は変えない約束なので、それ以外に ok にならない品が無いことだけを確かめる */
  eq('ok にならないのは品名に空白を含む品だけ', notOk.filter(n => !/[\s\u3000]/.test(n)).slice(0, 5), []);
  t('ok にならない品目は 2% 未満', notOk.length < items.length * 0.02, notOk.length);
  { let mis = 0, rev = 0; for(const it of items){ for(const sl of [['朝'], ['夕'], ['眠前'], ['朝','昼','夕']]){ const c = mpkLineCheck(mpkLine({ name: it[0], maker: it[2][0] || '', dose: 1, unit: it[1], slots: sl, meal: '食前' }), sl); if(c === 'mismatch') mis++; else if(c === 'review') rev++; } }
    eq('全品目×4通りで mismatch（誤った時間帯で ok）は0件', mis, 0); say('    （参考）review は ' + rev + ' 行（品名に空白を含む品）'); }
}

/* ── 追加（2026-10-01 検収指示）: 施設で使っている書き方・並び・単位・手書き用法で1回量なし ── */
group('mpkUsedNames（施設で使っている書き方）');
{
  /* 架空の3人ぶんの定期薬（行の配列だけを渡す。氏名・id は渡さない） */
  const A = ['アムロジピンOD錠5mg 1錠分1 朝食後', '酸化マグネシウム錠330mg「ケンエー」 2錠分2 朝夕食後', 'なし', '', 'テスト錠10mg', 'アムロジピンOD錠5mg 1錠分1 朝食後'];
  const B = ['アムロジピンOD錠5mg 1錠分1 夕食後', 'センノシド錠12mg：1日1回 就寝前', '〇〇散1g 1包 朝食後'];
  const C = ['酸化マグネシウム錠330mg「ケンエー」 3錠分3 毎食後', 'ビタミン剤（院外）'];
  const r = mpkUsedNames([A, B, C]);
  eq('重複は1件・人数（1人の中の重複は1と数える）・人数の多い順', r, [
    { name: 'アムロジピンOD錠5mg', n: 2 },
    { name: '酸化マグネシウム錠330mg「ケンエー」', n: 2 },
    { name: 'センノシド錠12mg', n: 1 }
  ]);
  t('「メーカー」付きはそのまま残す', r.some(x => x.name === '酸化マグネシウム錠330mg「ケンエー」'));
  t('用法の無い行（テスト錠10mg・ビタミン剤（院外））と「なし」は候補にしない', !r.some(x => /テスト錠|ビタミン|なし/.test(x.name)));
  t('左側に空白を含む名前（〇〇散1g 1包）は候補にしない（作った行が要確認になるため）', !r.some(x => /〇〇散/.test(x.name)));
  t('結果は name と n だけ', r.every(x => JSON.stringify(Object.keys(x)) === '["name","n"]'));
  eq('氏名つきの記録（オブジェクト）を渡しても読まない', mpkUsedNames([{ name: '試験 太郎', medsRegular: 'アムロジピンOD錠5mg 1錠分1 朝食後' }]), []);
  eq('行の文字列（配列でない）を渡しても読まない', mpkUsedNames(['アムロジピンOD錠5mg 1錠分1 朝食後']), []);
  eq('引数1つだけ', mpkUsedNames.length, 1);
  eq('空・null', [mpkUsedNames([]), mpkUsedNames(null)], [[], []]);
  /* 施設の書き方で作った1行も読み取りで ok になる */
  const okAll = r.every(x => { const l = mpkLine({ name: x.name, dose: 1, unit: mpkUnitOf(x.name), slots: ['朝','夕'], meal: '食後' }); const q = medSlotsFromText(l); return q.lines[0].status === 'ok' && q.slots.join() === 'morning,evening'; });
  t('施設の書き方で作った行も medSlotsFromText で ok', okAll);
}
group('mpkUnitOf（名前から単位）');
eq('カプセル', mpkUnitOf('テストカプセル10mg'), 'カプセル');
eq('顆粒→g', mpkUnitOf('テスト顆粒20%'), 'g');
eq('散→g', mpkUnitOf('テスト散1%'), 'g');
eq('細粒→g', mpkUnitOf('テスト細粒10%'), 'g');
eq('シロップ→mL', mpkUnitOf('テストシロップ2%'), 'mL');
eq('液→mL', mpkUnitOf('テスト内用液0.1%'), 'mL');
eq('それ以外→錠', mpkUnitOf('アムロジピンOD錠5mg'), '錠');
eq('ドライシロップは mL（名前の規則どおり）', mpkUnitOf('テストドライシロップ'), 'mL');
group('mpkSearchAll（①施設で使用中→②厚労省リスト）');
{
  const used = [{ name: 'ノルアムロジピン錠1mg', n: 5 }, { name: 'アムロジピンOD錠5mg', n: 2 }, { name: 'アムロジピン錠2.5mg「サワイ」', n: 3 }, { name: 'テスト散1%', n: 1 }];
  const items = [['アムロジピンOD錠5mg', '錠', ['トーワ']], ['アムロジピンベシル酸塩5mg口腔内崩壊錠', '錠', []], ['ベシル酸アムロジピン', '錠', []]];
  const r = mpkSearchAll('アムロジピン', used, items);
  eq('①前方一致（人数順）→①部分一致→②（同名は①だけ）', r.map(x => x.src + ':' + x.name), [
    'used:アムロジピン錠2.5mg「サワイ」', 'used:アムロジピンOD錠5mg', 'used:ノルアムロジピン錠1mg',
    'yakka:アムロジピンベシル酸塩5mg口腔内崩壊錠', 'yakka:ベシル酸アムロジピン'
  ]);
  eq('①は人数を持ち・メーカー欄なし・単位は名前から', r[0], { src: 'used', name: 'アムロジピン錠2.5mg「サワイ」', unit: '錠', makers: [], n: 3 });
  eq('②は単位とメーカーを持つ', r[3], { src: 'yakka', name: 'アムロジピンベシル酸塩5mg口腔内崩壊錠', unit: '錠', makers: [], n: 0 });
  eq('合計の上限（limit=2）は①から埋まる', mpkSearchAll('アムロジピン', used, items, 2).map(x => x.src), ['used', 'used']);
  const many = Array.from({ length: 20 }, (_, i) => ['テスト錠' + i, '錠', []]);
  eq('既定の上限は合計8件', mpkSearchAll('テスト', used, many).length, 8);
  eq('①の後に②が続く（テスト散1% → テスト錠0…）', mpkSearchAll('テスト', used, many).slice(0, 2).map(x => x.name), ['テスト散1%', 'テスト錠0']);
  eq('施設の一覧が無くても②だけで出る（前方一致→部分一致）', mpkSearchAll('ベシル酸', null, items).map(x => x.name), ['ベシル酸アムロジピン', 'アムロジピンベシル酸塩5mg口腔内崩壊錠']);
  eq('厚労省の一覧が無くても①だけで出る', mpkSearchAll('アムロジピンod', used, null).map(x => x.name), ['アムロジピンOD錠5mg']);
  eq('1文字では探さない', mpkSearchAll('ア', used, items), []);
}
group('手書きの用法なら1回量なしでも追加できる（修正2）');
{
  eq('mpkLine は1回量なしでも free で作れる', mpkLine({ name: 'アレンドロン酸錠35mg', free: '1錠 週1回 起床時' }), 'アレンドロン酸錠35mg 1錠 週1回 起床時');
  const cm = grabFn('mpkCommit_');
  t('追加の検査: 1回量は free が空の時だけ必須', /if\(!c\.free&&!\(c\.dose>0\)\)/.test(cm));
  t('エラー文に「手で書く時は不要」と書く', /「用法を手で書く」に入れた時は不要です/.test(cm));
}
group('画面: 施設で使っている薬の読み込み');
{
  const SEC2 = between('/* ══════════ 定期薬の入力パネル', '\nfunction mpkInit_(') + grabFn('mpkInit_');
  t('mdMap 由来の「施設で使用中」の印は外した', !/mdMap/.test(SEC2.replace(/\/\*[\s\S]*?\*\//g, '')));
  t('薬剤名欄に触れた時に全件データを読む（既存の fullEnsure を呼ぶ・読み込み中/済みなら呼ばない）', /if\(!fullLoading\)\{ try\{ fullEnsure\(false\); \}/.test(grabFn('mpkFullLoad_')) && /if\(fullMap\)\{ mpk\.fl='ok'/.test(grabFn('mpkFullLoad_')));
  t('読み込み中・失敗の文言', SEC2.includes('施設で使っている薬を読み込み中…') && SEC2.includes('施設で使っている薬を読み込めませんでした（厚労省の一覧から選べます）'));
  t('施設の候補は「施設で使用中（N名）」', SEC2.includes("'施設で使用中（'+c.n+'名）'"));
  t('mpkUsedList_ は行の文字だけを mpkUsedNames へ渡す（氏名を渡さない）', /mpkUsedNames\(shBase\(\)\.map\(function\(r\)\{\s*var rec=fullOf\(r\);\s*return rec\?String\(rec\.medsRegular/.test(grabFn('mpkUsedList_')) && !/\.name\b|\.kana\b|\.room\b/.test(grabFn('mpkUsedList_')));
  t('現場端末では全件データを取りに行かない', /getDeviceRole\(\)==='field'/.test(grabFn('mpkFullLoad_')) && /getDeviceRole\(\)==='field'/.test(grabFn('mpkUsedList_')));
}

/* ── 反証レビューの指摘（2026-10-01）: 薬剤名に用法の語が混ざった行を誤った時間帯のまま 'ok' で作らせない ── */
group('反証レビュー: 候補にしない名前（p3.js・p4.js の再現例）');
{
  eq('「：朝食前」「：朝昼夕食前」「：朝1錠分1」由来の名前は候補にならない',
    mpkUsedNames([['◯◯錠50mg：朝食前'], ['◯◯錠0.2mg：朝昼夕食前'], ['◯◯錠20mg：朝1錠分1'], ['◯◯錠0.2mg：朝昼夕食前']]), []);
  eq('括弧・記号で始まる名前は候補にならない',
    mpkUsedNames([['（夕のみ）テスト錠5mg 1錠分1 夕食後'], ['【般】テスト錠5mg 1錠分1 朝食後'], ['※テスト錠 1錠分1 朝食後'], ['・テスト錠 1錠分1 朝食後']]), []);
  eq('安全な名前は従来どおり候補になる', mpkUsedNames([['テスト錠5mg「サワイ」 1錠分1 朝食後', 'センノシド錠12mg：1日1回 就寝前']]).map(x => x.name), ['テスト錠5mg「サワイ」', 'センノシド錠12mg']);
}
group('mpkNameSafe');
{
  for(const n of ['アムロジピンOD錠5mg', 'アムロジピンOD錠5mg「サワイ」', 'センノシド錠12mg', '酸化マグネシウム330mg錠', 'テスト散1%'])
    t('安全: ' + n, mpkNameSafe(n) === true);
  for(const n of ['◯◯錠50mg：朝', '◯◯錠0.2mg：朝昼夕', '◯◯錠20mg：朝', 'テスト錠5mg 1錠 眠前', 'テスト錠1mg 朝2錠', 'テスト錠0.2mg 朝', 'ホリエ　オウゴンK', 'テスト錠:夕',
                  '（夕のみ）テスト錠', '(注)テスト錠', '【般】テスト錠', '[注]テスト錠', '＜院外＞テスト錠', '<院外>テスト錠', '※テスト錠', '★テスト錠', '●テスト錠', '・テスト錠', '', '  '])
    t('安全でない: ' + JSON.stringify(n), mpkNameSafe(n) === false);
}
group('mpkLineCheck（3値）');
eq('ok', mpkLineCheck('テスト錠5mg 1錠分2 朝夕食後', ['朝', '夕']), 'ok');
eq('ok（順不同）', mpkLineCheck('テスト錠5mg 2錠分2 朝食後・就寝前', ['眠前', '朝']), 'ok');
eq('mismatch（名前の「：朝」が用法として読まれる）', mpkLineCheck('◯◯錠50mg：朝 1錠分1 夕食前', ['夕']), 'mismatch');
eq('mismatch（名前に「眠前」が残る）', mpkLineCheck('テスト錠5mg 1錠 眠前 1錠分1 朝食後', ['朝']), 'mismatch');
eq('review（名前に空白→要確認）', mpkLineCheck('ホリエ　オウゴンK 1錠分1 朝食後', ['朝']), 'review');
eq('review（時間帯の語なし）', mpkLineCheck('テスト錠 1錠 週1回', ['朝']), 'review');
eq('review（頓用）', mpkLineCheck('テスト錠 1錠 頓用', ['朝']), 'review');
{
  /* 30通り×安全な名前はすべて ok。mismatch が出る名前は mpkNameSafe が必ず false */
  let bad = 0;
  for(const meal of ['食後', '食前']) for(const slots of combos()){
    const l = mpkLine({ name: 'テスト錠5mg「サワイ」', dose: 1, unit: '錠', slots, meal });
    if(mpkLineCheck(l, slots) !== 'ok') bad++;
  }
  eq('安全な名前（メーカー付き）の30通りはすべて ok', bad, 0);
  let leak = 0;
  for(const n of ['◯◯錠50mg：朝', 'テスト錠5mg 1錠 眠前', 'テスト錠1mg 朝2錠', 'テスト錠0.2mg 朝', 'テスト錠：夕', 'テスト錠 昼'])
    for(const meal of ['食後', '食前']) for(const slots of combos()){
      const l = mpkLine({ name: n, dose: 1, unit: '錠', slots, meal });
      if(mpkLineCheck(l, slots) === 'ok' && mpkNameSafe(n)) leak++;
    }
  eq('危ない名前が ok で素通りしない（6名前×30通り）', leak, 0);
}
group('「直す」の組み立てに入るか（mpkEditName）');
eq('「◯◯錠5mg 1錠 眠前」は入らない', mpkEditName('◯◯錠5mg 1錠 眠前'), '');
eq('「◯◯錠1mg 朝2錠」は入らない', mpkEditName('◯◯錠1mg 朝2錠'), '');
eq('「◯◯錠0.2mg 朝食前」は入らない', mpkEditName('◯◯錠0.2mg 朝食前'), '');
eq('「◯◯錠50mg：朝食前」は入らない', mpkEditName('◯◯錠50mg：朝食前'), '');
eq('用法と分けられない行は入らない', mpkEditName('ビタミン剤（院外）'), '');
eq('「メーカー」付きの行は「メーカー」を残して入る', mpkEditName('アムロジピンOD錠5mg「サワイ」 1錠分1 朝食後'), 'アムロジピンOD錠5mg「サワイ」');
{
  const nm = mpkEditName('アムロジピンOD錠5mg「サワイ」 1錠分1 朝食後');
  const l = mpkLine({ name: nm, dose: 1, unit: '錠', slots: ['夕'], meal: '食後' });
  eq('直した行にも「メーカー」が残り、選んだ時間帯で ok', [l, mpkLineCheck(l, ['夕'])], ['アムロジピンOD錠5mg「サワイ」 1錠分1 夕食後', 'ok']);
}
eq('mpkLineRange（空行を飛ばした2行目）', mpkLineRange('A\n\nBC\r\nD', 1), [3, 5]);
eq('mpkLineRange（範囲外）', mpkLineRange('A', 3), null);
group('反証レビュー: 画面側');
{
  const noCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const cm = noCmt(grabFn('mpkCommit_'));
  t('追加の直前に確かめ、mismatch なら止める（時間帯ボタンの時は mpkLineCheck・手書きの用法の時は mpkFreeCheck＝最終巡で追加）', /:\(mpkCheck_\(line, c\.slots\)==='mismatch'\)\)\{/.test(cm) && /return;\s*\}/.test(cm));
  t('mismatch の文言', cm.includes("薬剤名に『朝』『夕』などの言葉や『：』が入っているため、時間帯を正しく読み取れません。薬剤名を直してください"));
  t('プレビューに要確認の予告', grabFn('mpkPaint_').includes('この行は、与薬チェックへ送る時に『要確認』になります'));
  const es = noCmt(grabFn('mpkEditStart_'));
  t('「直す」は mpkEditName を使い、取り出せない行は欄へ案内（行は変えない）', es.includes('mpkEditName(ls[i])') && es.includes('この行は書き方が特殊なため、下の欄で直接直してください') && !/medSplit_/.test(es) && !/mpkSetTa_/.test(es));
  t('MedsEffect が読めない時は施設の候補・「直す」・行の確認を使わない（例外で止めない）',
    /!mpkFxOk_\(\)\) return \[\]/.test(grabFn('mpkUsedList_')) && /if\(mpkFxOk_\(\)\)\{ try\{ nm=mpkEditName/.test(es) && /if\(!mpkFxOk_\(\)\) return 'nofx'/.test(grabFn('mpkCheck_')));
  const rc = noCmt(grabFn('mpkRenderCand_'));
  t('候補の内容が前回と同じなら DOM を作り直さない', /if\(sig===mpk\.candSig&&box\.childNodes\.length===cands\.length\) return;/.test(rc) && rc.indexOf('box.textContent=') > rc.indexOf('mpk.candSig=sig'));
  const ini = noCmt(grabFn('mpkInit_'));
  t('変換中も描く（isComposing で止めない）・compositionend でも描く', !/isComposing/.test(ini) && /addEventListener\('input',onName\)/.test(ini) && /addEventListener\('compositionend',onName\)/.test(ini));
  const sb = { window: {} }; vm.createContext(sb);
  const escLine = (src.match(/\nfunction esc\(s\)\{[^\n]*\}\n/) || [''])[0];
  vm.runInContext(escLine + '\n' + grabVar('MPK_DOSES') + '\n' + grabFn('mpkChips_') + '\n' + grabFn('mpkPanelHtml_'), sb);
  const panel = vm.runInContext('mpkPanelHtml_()', sb);
  t('エラー欄3つは role="alert"', ['mpkErrName', 'mpkErrDose', 'mpkErrWhen'].every(id => panel.includes('id="' + id + '" role="alert"')));
  t('フォーカスを移す部品がエラー欄を参照する（薬剤名・1回量のチップ・時間帯のチップ・手書きの用法）',
    /id="mpkName"[^>]*aria-describedby="mpkCandMsg mpkErrName"/.test(panel) &&
    (panel.match(/data-mpk-dose="[^"]+" aria-pressed="false" aria-describedby="mpkErrDose"/g) || []).length === 4 &&
    (panel.match(/data-mpk-slot="[^"]+" aria-pressed="false" aria-describedby="mpkErrWhen"/g) || []).length === 4 &&
    /id="mpkFree"[^>]*aria-describedby="mpkErrWhen"/.test(panel));
  t('注意の文字色は --mpk-warn（#8a3a00）', /\.mpk\{--mpk-warn:#8a3a00;/.test(src) && /\.mpk-editing\{[^}]*color:var\(--mpk-warn\)/.test(src) && /\.mpk-ls \.tag-ed\{[^}]*color:var\(--mpk-warn\)/.test(src));
}

/* ── 再点検（2026-10-01 最終巡）── */
group('mpkFreeCheck（手書きの用法の時の確認）');
eq('「◯◯錠50mg：朝」＋「夕食後」→ mismatch', mpkFreeCheck('◯◯錠50mg：朝', '夕食後'), 'mismatch');
eq('「◯◯錠330mg 朝」＋「夕食後」→ mismatch', mpkFreeCheck('◯◯錠330mg 朝', '夕食後'), 'mismatch');
eq('「◯◯錠50mg：朝」＋「1錠 夕食前」→ mismatch', mpkFreeCheck('◯◯錠50mg：朝', '1錠 夕食前'), 'mismatch');
eq('「◯◯錠5mg」＋「1錠 週1回 起床時」→ ok（止めない）', mpkFreeCheck('◯◯錠5mg', '1錠 週1回 起床時'), 'ok');
eq('名前に用法の語があっても、free が要確認になる時は止めない（読み取りが ok でない）', mpkFreeCheck('◯◯錠50mg：朝', '週1回 月曜'), 'ok');
{
  const FREES = ['夕食後', '1錠 夕食前', '朝夕食後', '1錠分1 就寝前', '2錠分2 朝食後・就寝前', '1錠 週1回 起床時', '隔日 朝食後', '食間', '1包 毎食前', '頓用', '0.5錠 夕'];
  const SAFE = ['アムロジピンOD錠5mg', 'テスト錠5mg「サワイ」', '酸化マグネシウム330mg錠', 'テスト散1%', 'センノシド錠12mg'];
  let bad = [];
  for(const n of SAFE) for(const f of FREES) if(mpkFreeCheck(n, f) !== 'ok') bad.push(n + '+' + f);
  eq('安全な名前（mpkNameSafe が true）は free が何でも ok（5名前×11通り）', bad, []);
  t('上の名前はすべて mpkNameSafe が true', SAFE.every(n => mpkNameSafe(n)));
}
group('再点検: 画面側');
{
  const noCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const cm = noCmt(grabFn('mpkCommit_'));
  const NOFX = '部品を読み込めていないため、ここからは追加できません。画面を再読み込みするか、下の欄に直接書いてください';
  t('MedsEffect が読めない時は追加・置き換えを止める（最初に確かめて return）',
    /mpkClearErr_\(\);\s*if\(!mpkFxOk_\(\)\)\{\s*mpkErr_\('mpkErrAdd','部品を読み込めていないため、ここからは追加できません。画面を再読み込みするか、下の欄に直接書いてください'\);[\s\S]*?return;\s*\}\s*var c=mpkCur_\(\);/.test(cm));
  t('プレビューの文言も合わせる', grabFn('mpkPaint_').includes(NOFX) && !grabFn('mpkPaint_').includes('確かめられません'));
  t('手書きの用法がある時は mpkFreeCheck で確かめて止める（追加・置き換えの両方を通る位置）',
    /if\(c\.free\?\(mpkFreeCk_\(mpkHead_\(c\), c\.free\)==='mismatch'\):\(mpkCheck_\(line, c\.slots\)==='mismatch'\)\)\{/.test(cm) &&
    cm.indexOf("mpkFreeCk_(mpkHead_(c), c.free)") < cm.indexOf('if(mpk.editIdx>=0)'));
  t('プレビューでも同じ判定で予告する', /c\.free\?mpkFreeCk_\(mpkHead_\(c\), c\.free\):mpkCheck_\(line, c\.slots\)/.test(grabFn('mpkPaint_')));
  t('mpkFreeCk_ は部品が無い時 nofx（例外で止めない）', /if\(!mpkFxOk_\(\)\) return 'nofx';/.test(grabFn('mpkFreeCk_')) && /try\{ return mpkFreeCheck/.test(grabFn('mpkFreeCk_')));
  const es = noCmt(grabFn('mpkEditStart_'));
  t('安全な名前を取り出せない行の「直す」は、直し中を終えて薬剤名・メーカーも空に戻す', /if\(!nm\)\{\s*mpkEditEnd_\(\); mpkResetName_\(\);/.test(es));
  const sb = { window: {} }; vm.createContext(sb);
  const escLine = (src.match(/\nfunction esc\(s\)\{[^\n]*\}\n/) || [''])[0];
  vm.runInContext(escLine + '\n' + grabVar('MPK_DOSES') + '\n' + grabFn('mpkChips_') + '\n' + grabFn('mpkPanelHtml_'), sb);
  const panel = vm.runInContext('mpkPanelHtml_()', sb);
  t('追加ボタンのそばのエラー欄（role=alert）をボタンが参照する', panel.includes('id="mpkAdd" aria-describedby="mpkErrAdd"') && panel.includes('id="mpkErrAdd" role="alert"'));
}

/* ── 1回量・単位の横並びと「毎」ボタン（2026-10-01）── */
group('「毎」ボタンと横並び');
{
  const noCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const sb = { window: {} }; vm.createContext(sb);
  const escLine = (src.match(/\nfunction esc\(s\)\{[^\n]*\}\n/) || [''])[0];
  vm.runInContext(escLine + '\n' + grabVar('MPK_DOSES') + '\n' + grabFn('mpkChips_') + '\n' + grabFn('mpkPanelHtml_'), sb);
  const panel = vm.runInContext('mpkPanelHtml_()', sb);
  const allBtns = panel.match(/<button[^>]*data-mpk-all="1"[^>]*>毎<\/button>/g) || [];
  eq('パネルに data-mpk-all のボタンが1つ', allBtns.length, 1);
  t('「毎」は data-mpk-slot の最初のボタンより前', panel.indexOf('data-mpk-all') >= 0 && panel.indexOf('data-mpk-all') < panel.indexOf('data-mpk-slot'));
  t('「毎」は aria-pressed・読み上げ名・エラー欄の参照を持つ',
    /data-mpk-all="1" aria-pressed="false" aria-label="毎（朝・昼・夕の3回）" aria-describedby="mpkErrWhen"/.test(panel));
  eq('MPK_SLOTS は朝・昼・夕・眠前のまま（「毎」を足さない）', vm.runInContext('MPK_SLOTS', sb), ['朝', '昼', '夕', '眠前']);
  t('パネルの時間帯チップは4つのまま', (panel.match(/data-mpk-slot="/g) || []).length === 4);
  t('見出しの文言', panel.includes('<span class="mpk-lb" id="mpkWhenLb">いつ飲むか（時間帯は複数選べます。「毎」は朝・昼・夕）</span>'));
  t('「1回量」「単位」の欄に mpk-inline が付く',
    panel.includes('<div class="mpk-f mpk-inline" role="group" aria-labelledby="mpkDoseLb">') &&
    panel.includes('<div class="mpk-f mpk-inline" role="group" aria-labelledby="mpkUnitLb">'));
  t('「いつ飲むか」には mpk-inline が付かない', panel.includes('<div class="mpk-f" role="group" aria-labelledby="mpkWhenLb">') && (panel.match(/mpk-inline/g) || []).length === 2);
  t('横並びの CSS（見出し幅3.5em・選択肢は残りの幅・エラー文は下の行いっぱい）',
    /\.mpk-inline\{display:flex; flex-wrap:wrap; align-items:center; column-gap:10px; row-gap:4px\}/.test(src) &&
    /\.mpk-inline>\.mpk-lb\{margin:0; flex:0 0 3\.5em\}/.test(src) &&
    /\.mpk-inline>\.mpk-row\{flex:1 1 12em; min-width:0\}/.test(src) &&
    /\.mpk-inline>\.mpk-err\{flex:0 0 100%\}/.test(src));
  const PURE_NC = noCmt(PURE);
  t('mpk-pure 区間は「毎」を知らない（mpkAll／data-mpk-all を含まない）', !/mpkAll|data-mpk-all/.test(PURE_NC));
  t('mpkAllOn_／mpkAllToggle_ は mpk-pure 区間の外', !PURE.includes('function mpkAllOn_(') && !PURE.includes('function mpkAllToggle_('));
  t('mpkCur_ は MPK_SLOTS から時間帯を組み立てるまま（「毎」を参照しない）',
    /slots:MPK_SLOTS\.filter\(function\(k\)\{ return !!mpk\.slots\[k\]; \}\)/.test(grabFn('mpkCur_')) && !/mpkAll|毎/.test(noCmt(grabFn('mpkCur_'))));
  /* クリック処理（パネルの click リスナー）を切り出して確かめる */
  const ck = noCmt(src);
  const clickLine = (ck.match(/\n[^\n]*getAttribute\('data-mpk-all'\)[^\n]*\n/) || [''])[0];
  t('クリック処理に data-mpk-all の分岐がある（mpkAllToggle_ → エラー欄を消す → 描き直し → return）',
    /if\(t\.getAttribute\('data-mpk-all'\)!==null\)\{ mpkAllToggle_\(mpk\.slots\); mpkErr_\('mpkErrWhen',''\); mpkPaint_\(\); return; \}/.test(clickLine));
  t('data-mpk-all の分岐は data-mpk-slot の分岐より前', ck.indexOf("getAttribute('data-mpk-all')!==null") < ck.indexOf("getAttribute('data-mpk-slot'))!==null"));
  const tg = noCmt(grabFn('mpkAllToggle_')) + noCmt(grabFn('mpkAllOn_'));
  t('切替は朝・昼・夕の3つだけを書き換える（眠前・食後/食前を書き換えない）',
    /\['朝','昼','夕'\]\.forEach\(function\(k\)\{ slots\[k\]=v; \}\)/.test(tg) && !/眠前|meal|食後|食前/.test(tg));
  t('描き直しで「毎」の選択表示を slots から求める', /set\('data-mpk-all',function\(\)\{ return mpkAllOn_\(mpk\.slots\); \}\);/.test(grabFn('mpkPaint_')));
  /* 切替の関数を取り出して実行する */
  const fb = {}; vm.createContext(fb);
  vm.runInContext(grabFn('mpkAllOn_') + '\n' + grabFn('mpkAllToggle_'), fb);
  const run = o => { const r = vm.runInContext('(function(o){ return mpkAllToggle_(o); })', fb)(o); return JSON.parse(JSON.stringify(r)); };
  const onOf = o => ['朝', '昼', '夕', '眠前'].filter(k => !!o[k]);
  eq('空 → 朝・昼・夕が on', onOf(run({})), ['朝', '昼', '夕']);
  eq('朝・夕が on → 朝・昼・夕が on', onOf(run({ '朝': true, '夕': true })), ['朝', '昼', '夕']);
  eq('朝・昼・夕が on → 3つとも off', onOf(run({ '朝': true, '昼': true, '夕': true })), []);
  eq('眠前が on のまま切り替えても眠前は変わらない（空 → 3つ on）', onOf(run({ '眠前': true })), ['朝', '昼', '夕', '眠前']);
  eq('眠前が on のまま切り替えても眠前は変わらない（3つ on → off）', onOf(run({ '朝': true, '昼': true, '夕': true, '眠前': true })), ['眠前']);
  eq('眠前が off のまま切り替えても眠前は増えない', onOf(run({ '朝': true, '眠前': false })), ['朝', '昼', '夕']);
  {
    const o = { '朝': true, '昼': true, '夕': true };
    const r = vm.runInContext('(function(o){ return mpkAllToggle_(o); })', fb)(o);
    t('渡した slots そのものを書き換える（mpk.slots に効く）', r === o && !o['朝'] && !o['昼'] && !o['夕']);
  }
  const isOn = vm.runInContext('mpkAllOn_', fb);
  t('「毎」の選択表示は3つそろった時だけ', isOn({ '朝': true, '昼': true, '夕': true }) === true && isOn({ '朝': true, '昼': true }) === false && isOn({ '眠前': true }) === false && isOn({}) === false);
}

/* ── .gitignore（公開ホワイトリスト） ── */
group('.gitignore');
{
  const gi = path.join(DIR, '.gitignore');
  const g = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  t('!/meds-yakka-naiyo.js がホワイトリストにある', /^!\/meds-yakka-naiyo\.js$/m.test(g));
}

say('\n結果: ' + ok + ' 件 OK / ' + ng + ' 件 NG');
process.exitCode = ng ? 1 : 0;
