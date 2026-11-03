/* 入居者マスタの薬剤名リンク（お薬110番）で、サイトへ送る検索語の試験（2026-11-03 本人指示「リンクが切れている」）。
   守ること:
     1. 一般名処方の「口腔内崩壊錠」「腸溶性口腔内崩壊錠」や塩の名前を落とし、薬の名前の幹で引く
        （サイトの品名は「アムロジピンOD錠」の形で、取った語をそのまま送ると「該当がありません」になった）
     2. 落とすのは3字以上残る時だけ・「散」は落とさない（抑肝散・五苓散を別の語にしない）
     3. 行頭の「・」「1)」は飛ばす。注記（（院外）…）・用量だけの行はリンクを作らない
     4. 画面で下線を引く範囲は行頭の語のまま（送る語だけを変える）
     5. 送るのは薬剤名だけ（行の残り＝用量・用法はリンクの外に文字として出す）
   実行: node check/unit/master_okusuri_query_test.js（MASTER_HTML で別の resident-master.html を当てられる） */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const a = src.indexOf('var OKUSURI_FORMS'), b = src.indexOf('function openOkusuri');
t('検索語の関数の塊がある', a > 0 && b > a);
const l1 = src.indexOf('function medsLineHtml('), l2 = src.indexOf('/* map は省略時に画面の mdMap を使う', l1);
t('行の組み立て（medsLineHtml）がある', l1 > 0 && l2 > l1);
const ctx = {
  OKUSURI_FORM: 'http://example.invalid/form',
  esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + '\n' + src.slice(l1, l2), ctx);
const Q = s => ctx.medsDrugQuery(s);

console.log('1. 一般名処方・塩の名前は幹で引く');
[
  ['【般】アムロジピン口腔内崩壊錠5mg', 'アムロジピン'],
  ['【般】ドネペジル塩酸塩口腔内崩壊錠5mg', 'ドネペジル'],
  ['【般】ランソプラゾール腸溶性口腔内崩壊錠15mg', 'ランソプラゾール'],
  ['【般】メマンチン塩酸塩口腔内崩壊錠20mg', 'メマンチン'],
  ['【般】ピコスルファートナトリウム内用液0.75%', 'ピコスルファート'],
  ['ピタバスタチンカルシウム1mg錠', 'ピタバスタチン'],
  ['オルメサルタンメドキソミル20mg錠', 'オルメサルタン'],
  ['グルコン酸カルシウム水和物', 'グルコン酸'],
  ['アーチスト錠1.25mg 1錠 朝食後', 'アーチスト'],
  ['ミカムロ配合錠AP', 'ミカムロ'],
  ['ツムラ抑肝散エキス顆粒（医療用）', 'ツムラ抑肝散'],
  ['リスペリドン内用液分包3mg「アメル」', 'リスペリドン'],
  ['ジルテックドライシロップ1.25%', 'ジルテック']
].forEach(([l, want]) => t(l + ' → ' + want, Q(l) === want, Q(l)));

console.log('2. 3字以上残る時だけ落とす・「散」は落とさない');
[
  ['抑肝散', '抑肝散'], ['五苓散エキス顆粒', '五苓散'], ['当帰芍薬散', '当帰芍薬散'],
  ['炭酸カルシウム錠', '炭酸カルシウム'], ['塩化カリウム', '塩化カリウム'],
  ['酸化マグネシウム錠330mg', '酸化マグネシウム']
].forEach(([l, want]) => t(l + ' → ' + want, Q(l) === want, Q(l)));

console.log('3. 箇条の印は飛ばし、注記・用量だけの行はリンクを作らない');
[
  ['・アムロジピン錠5mg 1錠 朝', 'アムロジピン'],
  ['1) マグミット錠330mg 2錠', 'マグミット'],
  ['２．センノシド錠12mg', 'センノシド'],
  ['（院外）調剤薬局にて調整中', ''],
  ['1錠 朝食後', ''],
  ['1.5錠 朝', ''],
  ['', ''],
  ['L-アスパラギン酸カリウム', ''],
  ['・長男様管理', ''], ['＊残薬調整中', ''], ['1、朝食後', ''], ['・朝食後 1錠', ''],
  ['・酸化マグネシウム錠330mg', '酸化マグネシウム']
].forEach(([l, want]) => t(JSON.stringify(l) + ' → ' + JSON.stringify(want), Q(l) === want, Q(l)));

console.log('4・5. 下線は行頭の語のまま・送る語だけ幹・残りは文字のまま');
const h = ctx.medsLineHtml('【般】アムロジピン口腔内崩壊錠5mg 1錠 朝');
t('下線の文字は「アムロジピン口腔内崩壊錠」', />アムロジピン口腔内崩壊錠<\/a>/.test(h), h);
t('送る語（data-q）は「アムロジピン」', /data-q="アムロジピン"/.test(h), h);
t('用量・用法はリンクの外', /<\/a>5mg 1錠 朝$/.test(h), h);
t('【般】はリンクの外に文字で残る', /^【般】<a /.test(h), h);
const h2 = ctx.medsLineHtml('・アムロジピン錠5mg');
t('箇条の印はリンクの外に残る', /^・<a /.test(h2) && />アムロジピン錠<\/a>5mg$/.test(h2), h2);
t('注記の行はリンクなしの文字', ctx.medsLineHtml('（院外）調剤薬局にて調整中') === '（院外）調剤薬局にて調整中');
t('送る語は先頭の20字', Q('アイウエオカキクケコサシスセソタチツテトナニヌネノ') === 'アイウエオカキクケコサシスセソタチツテト', Q('アイウエオカキクケコサシスセソタチツテトナニヌネノ'));
t('印の無い漢字の行は今までどおりリンクになる（旧版と同じ）', Q('長男様管理') === '長男様管理', Q('長男様管理'));

console.log('6. 送る語は行頭の語の先頭部分（先頭一致なので、旧版より結果が狭くならない）');
['アムロジピン錠5mg', '【般】ドネペジル塩酸塩口腔内崩壊錠5mg', 'ツムラ抑肝散エキス顆粒', 'ロサルタンカリウム錠50mg', 'ポリスチレンスルホン酸カルシウム']
  .forEach(l => { const w = ctx.medsDrugRun(l), q = Q(l); t(l + ' の送る語は下線の語の先頭', !!q && w.indexOf(q) === 0, [w, q]); });

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
