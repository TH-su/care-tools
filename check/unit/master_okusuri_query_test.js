/* 入居者マスタの薬剤名リンク（お薬110番）で、サイトへ送る検索語の試験（2026-11-03 本人指示「リンクが切れている」）。
   守ること:
     1. 一般名処方の「口腔内崩壊錠」「腸溶性口腔内崩壊錠」や塩の名前を落とし、薬の名前の幹で引く
        （サイトの品名は「アムロジピンOD錠」の形で、取った語をそのまま送ると「該当がありません」になった）
     2. 落とすのは3字以上残る時だけ・「散」は落とさない（抑肝散・五苓散を別の語にしない）
     3. 行頭の「・」「1)」は飛ばす。注記（（院外）…）・用量だけの行はリンクを作らない
     4. 画面で下線を引く範囲は行頭の語のまま（送る語だけを変える）
     5. 送るのは薬剤名だけ（行の残り＝用量・用法はリンクの外に文字として出す）
     7. 押した時はサーバーの受け口（okusuri-search）で先に調べ、1つならそのページ・複数なら候補・0件や失敗なら KEGG（2026-11-03 本人指示）
        お薬110番へのフォーム送信は使わない（画面の CSP form-action 'self' で止まり、Chrome は https→http のフォームに警告を出す・実測）
   実行: node check/unit/master_okusuri_query_test.js（MASTER_HTML で別の resident-master.html を当てられる） */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const a = src.indexOf('var OKUSURI_FIND'), b = src.indexOf('function openOkusuri');
t('検索語の関数の塊がある', a > 0 && b > a);
const l1 = src.indexOf('function medsLineHtml('), l2 = src.indexOf('/* map は省略時に画面の mdMap を使う', l1);
t('行の組み立て（medsLineHtml）がある', l1 > 0 && l2 > l1);
const ctx = {
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
  ['L-アスパラギン酸カリウム', '']
].forEach(([l, want]) => t(JSON.stringify(l) + ' → ' + JSON.stringify(want), Q(l) === want, Q(l)));

console.log('4・5. 下線は行頭の語のまま・送る語だけ幹・残りは文字のまま');
const h = ctx.medsLineHtml('【般】アムロジピン口腔内崩壊錠5mg 1錠 朝');
t('下線の文字は「アムロジピン口腔内崩壊錠」', />アムロジピン口腔内崩壊錠<\/a>/.test(h), h);
t('送る語（data-q）は「アムロジピン」', /data-q="アムロジピン"/.test(h), h);
t('用量・用法はリンクの外', /<\/a>5mg 1錠 朝$/.test(h), h);
t('リンクそのもの（ポップアップが塞がれた時・JS が動かない時）は KEGG の検索', h.indexOf('href="https://www.kegg.jp/medicus-bin/search_drug?display=med&amp;search_keyword=' + encodeURIComponent('アムロジピン') + '"') > 0, h);
t('【般】はリンクの外に文字で残る', /^【般】<a /.test(h), h);
const h2 = ctx.medsLineHtml('・アムロジピン錠5mg');
t('箇条の印はリンクの外に残る', /^・<a /.test(h2) && />アムロジピン錠<\/a>5mg$/.test(h2), h2);
t('注記の行はリンクなしの文字', ctx.medsLineHtml('（院外）調剤薬局にて調整中') === '（院外）調剤薬局にて調整中');
t('送る語は20字まで', Q('コタロー当帰四逆加呉茱萸生姜湯エキス細粒').length <= 20, Q('コタロー当帰四逆加呉茱萸生姜湯エキス細粒'));

console.log('7. 押した時の行き先（受け口の答え → 行き先）');
const P1 = 'http://www.okusuri110.jp/pc/dwm/se/se21/se2171022.html', P2 = 'http://www.okusuri110.jp/pc/dwm/se/se11/se1149019.html';
const K = ctx.okusuriKeggUrl('ロキソ');
const plan = r => JSON.parse(JSON.stringify(ctx.okusuriPlan('ロキソ', r)));
t('1つ → そのページ', plan({ ok: true, hit: 1, url: P1 }).go === P1);
t('複数 → 候補（品名つき）', JSON.stringify(plan({ ok: true, hit: 2, pages: [{ url: P1, name: 'ロキソニンゲル1%' }, { url: P2, name: 'ロキソニン細粒10%' }] }))
  === JSON.stringify({ list: [{ url: P1, name: 'ロキソニンゲル1%' }, { url: P2, name: 'ロキソニン細粒10%' }] }));
t('0品目 → KEGG', plan({ ok: true, hit: 0 }).go === K);
t('受け口の失敗・届かない → KEGG', plan({ ok: false, code: 'upstream' }).go === K && plan(null).go === K);
t('お薬110番の薬のページ以外の住所は使わない（KEGG へ）', plan({ ok: true, hit: 1, url: 'javascript:alert(1)' }).go === K
  && plan({ ok: true, hit: 1, url: 'https://evil.example/pc/dwm/a.html' }).go === K);
t('候補のうち形の合わない住所は捨てる（残りが1つならそのページ）', plan({ ok: true, hit: 2, pages: [{ url: 'http://evil.example/x.html', name: 'x' }, { url: P2, name: 'y' }] }).go === P2);
const op = src.slice(src.indexOf('function openOkusuri('), src.indexOf('/* A4に印刷した時'));
t('フォームでお薬110番へ送る処理は残っていない', !/createElement\('form'\)|acceptCharset|kana_ait/.test(op));
t('新しいタブはクリックの直後（受け口へ送る前）に開く', op.indexOf("window.open(") > 0 && op.indexOf("window.open(") < op.indexOf('fetch(OKUSURI_FIND'));
t('タブを開けない時は false（リンクのまま KEGG が開く）', /if\(!w\) return false;/.test(op));
t('クリックの受け口は、開けた時だけ既定の動きを止める', /if\(openOkusuri\(a\.getAttribute\('data-q'\)\)\) ev\.preventDefault\(\);/.test(src));
t('受け口の住所は care-backend の okusuri-search', /var OKUSURI_FIND = 'https:\/\/jhbernqawjrzqwrmqrih\.supabase\.co\/functions\/v1\/okusuri-search';/.test(src));
t('待つのは 6 秒まで', /var OKUSURI_WAIT_MS = 6000;/.test(src));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
