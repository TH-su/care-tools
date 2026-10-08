/* 家族構成図（su_genograms）のキー取り違えテスト（2026-08-13）
   対象: resident-master.html / facesheet.html の getGenogram
         genogram.html の suGenoMasterIdFor / pruneWrongMasterGenograms
   実行: node check/unit/genogram_key_test.js

   背景（実際に起きたこと）:
     ジェノグラムアプリを ?resident=<Aさん>&name=<Aさん> 付きで開き、そのまま文書一覧から
     【Bさんの家系図】を読み込んで保存すると、su_genograms[AさんのID] にBさんの図が入った。
     window._suMasterId は起動時に一度決まるだけで、文書を切り替えても消えなかったため。
     読み手は masterId を先に見るので、入居者マスタ・フェイスシートのAさんの
     「家族構成図」欄にBさんの家族が表示された。

   ねらい:
     ・読み手が「誰の図か」を必ず突き合わせ、確かめられない図は出さないこと（出さない側へ倒す）
     ・書き手が別の方の masterId へ書かないこと
     ・既に混入した控えを、画像を1枚も失わずに切り離せること
   ★このファイルは gas/ 配下＝git 未追跡（公開しない）。氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = {
  master: fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8'),
  face: fs.readFileSync(path.join(ROOT, 'facesheet.html'), 'utf8'),
  geno: fs.readFileSync(path.join(ROOT, 'genogram.html'), 'utf8')
};

/* ── 宣言だけを取り出す（HTMLごと評価すると初期化処理まで走る） ── */
function grabVar(src, name){
  const re = new RegExp('^var ' + name + '\\s*=[\\s\\S]*?;[ \\t]*(//[^\\n]*)?$', 'm');
  const m = src.match(re);
  if(!m) throw new Error('変数が見つかりません: ' + name);
  return m[0];
}
/* 1行関数もあるので、行ではなく波かっこを数えて切り出す（文字列の中のかっこは数えない） */
function grabFn(src, name){
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

/* ── 走らせ方 ── */
let ok = 0, ng = 0;
function eq(label, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function group(name){ process.stdout.write('\n■ ' + name + '\n'); }

/* ── 差し替え可能な localStorage を持つ砂場を作る ── */
function makeBox(src, decls){
  const store = {};
  const box = { store, failWrite: false };   // failWrite=true で setItem が容量超過のように失敗する
  const sandbox = {
    localStorage: {
      getItem(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v){ if(box.failWrite) throw new Error('QuotaExceededError'); store[k] = String(v); },
      removeItem(k){ delete store[k]; }
    },
    window: {},
    flashStatus(){}
  };
  vm.createContext(sandbox);
  vm.runInContext(decls.map(d => (d.kind === 'var' ? grabVar(src, d.name) : grabFn(src, d.name))).join('\n'), sandbox);
  box.sandbox = sandbox;
  return box;
}

/* 架空の画像（本物の data URL である必要はない。中身の同一性だけ見る） */
const IMG_A = 'data:image/jpeg;base64,AAAA';
const IMG_B = 'data:image/jpeg;base64,BBBB';

/* ═══ 1. 読み手が2ファイルで逐語同一であること ═══ */
group('読み手の逐語同一（入居者マスタ ⇔ フェイスシート）');
const fnMaster = grabFn(SRC.master, 'getGenogram');
const fnFace = grabFn(SRC.face, 'getGenogram');
eq('getGenogram が2ファイルで同一', fnMaster === fnFace, true);

/* ═══ 2. getGenogram の挙動 ═══ */
group('読み手：誰の図かを突き合わせる');
const R = makeBox(SRC.master, [{kind:'var', name:'SU_GENO_KEY'}, {kind:'fn', name:'getGenogram'}]);
const { getGenogram } = R.sandbox;
function setGeno(obj){ R.store['su_genograms'] = JSON.stringify(obj); }

/* 正常：masterId のキーの氏名が本人と一致する */
setGeno({ '12': {image: IMG_A, name: '架空 太郎'} });
eq('氏名が一致 → その図を出す', getGenogram(12, '架空 太郎'), IMG_A);
eq('空白のゆれは吸収する', getGenogram(12, '架空太郎'), IMG_A);
setGeno({ '12': {image: IMG_A, name: '架空太郎'} });
eq('全角スペースも吸収する', getGenogram(12, '架空　太郎'), IMG_A);

/* ★中核：masterId のキーに別人の図が入っている（今回の実害と同じ状態） */
setGeno({ '12': {image: IMG_B, name: '架空 花子'} });
eq('別人の図は出さない（氏名キーも無い）', getGenogram(12, '架空 太郎'), null);
setGeno({ '12': {image: IMG_B, name: '架空 花子'}, 'name:架空太郎': {image: IMG_A, name: '架空 太郎'} });
eq('別人の図を捨てて本人の氏名キーへ回す', getGenogram(12, '架空 太郎'), IMG_A);
eq('別人（花子）本人が引く時は氏名キーで出る', getGenogram(99, '架空 花子'), null); // 花子の氏名キーは無い
setGeno({ '12': {image: IMG_B, name: '架空 花子'}, 'name:架空花子': {image: IMG_B, name: '架空 花子'} });
eq('花子は自分の氏名キーで出る', getGenogram(99, '架空 花子'), IMG_B);

/* 誰のものか確かめられない記録は使わない（出さない側へ倒す） */
setGeno({ '12': {image: IMG_A} });
eq('記録に氏名が無い → 使わない', getGenogram(12, '架空 太郎'), null);
setGeno({ '12': {image: IMG_A, name: ''} });
eq('記録の氏名が空 → 使わない', getGenogram(12, '架空 太郎'), null);
setGeno({ '12': {image: IMG_A, name: '架空 太郎'} });
eq('当人の氏名が空 → 使わない', getGenogram(12, ''), null);
eq('当人の氏名が null → 使わない', getGenogram(12, null), null);

/* 氏名キーだけがある（アプリを直接開いて作った図） */
setGeno({ 'name:架空太郎': {image: IMG_A, name: '架空 太郎'} });
eq('masterId のキーが無くても氏名で出る', getGenogram(12, '架空 太郎'), IMG_A);
eq('別人の氏名では出ない', getGenogram(12, '架空 花子'), null);

/* 壊れた入力で落ちない・出さない */
setGeno({ '12': {image: 123, name: '架空 太郎'} });
eq('画像が文字列でない → null', getGenogram(12, '架空 太郎'), null);
setGeno({ '12': {image: '', name: '架空 太郎'} });
eq('画像が空文字 → null', getGenogram(12, '架空 太郎'), null);
R.store['su_genograms'] = '{壊れたJSON';
eq('壊れたJSON → null', getGenogram(12, '架空 太郎'), null);
delete R.store['su_genograms'];
eq('キーが無い → null', getGenogram(12, '架空 太郎'), null);
R.store['su_genograms'] = '"文字列"';
eq('オブジェクトでない → null', getGenogram(12, '架空 太郎'), null);

/* ═══ 3. 書き手：masterId は URL の氏名の方に束縛する ═══ */
group('書き手：別の方の masterId へ書かない');
const W = makeBox(SRC.geno, [{kind:'fn', name:'suGenoNameKey'}, {kind:'fn', name:'suGenoMasterIdFor'}]);
const { suGenoMasterIdFor, suGenoNameKey } = W.sandbox;

eq('文書＝URLの方 → masterId を書く', suGenoMasterIdFor('架空 太郎', '12', '架空 太郎'), '12');
eq('空白のゆれは同一とみなす', suGenoMasterIdFor('架空太郎', '12', '架空　太郎'), '12');
/* ★中核：別の方の文書を保存した時に masterId を書かない */
eq('文書≠URLの方 → 書かない', suGenoMasterIdFor('架空 花子', '12', '架空 太郎'), '');
eq('URL に resident が無い → 書かない', suGenoMasterIdFor('架空 太郎', null, '架空 太郎'), '');
eq('URL に name が無い → 書かない', suGenoMasterIdFor('架空 太郎', '12', ''), '');
eq('文書名が空 → 書かない', suGenoMasterIdFor('', '12', '架空 太郎'), '');
eq('両方空でも書かない', suGenoMasterIdFor('', '12', ''), '');
eq('masterId が空文字 → 書かない', suGenoMasterIdFor('架空 太郎', '', '架空 太郎'), '');
eq('氏名キーの作り方は空白除去のみ', suGenoNameKey('架空　太郎 '), 'name:架空太郎');

/* 書き手が使う正規化と、読み手が使う正規化が一致すること（片方だけ直すと二度と見つからない） */
eq('書き手と読み手の正規化が一致', suGenoNameKey('架空 太郎'), 'name:' + '架空 太郎'.replace(/\s+/g, ''));

/* ★配線の固定。純関数だけを試すと、呼び出し側を旧実装へ戻しても全件合格してしまう
     （実際にこの2行のどちらを消しても実害が再発する・2026-08-13 レビュー指摘） */
eq('writeSuGenogram が束縛関数を通している',
   /suGenoMasterIdFor\(\s*name,\s*window\._suMasterId,\s*window\._suMasterName\s*\)/
     .test(grabFn(SRC.geno, 'writeSuGenogram')), true);
eq('writeSuGenogram が _suMasterId を直接使っていない',
   /window\._suMasterId/.test(grabFn(SRC.geno, 'writeSuGenogram').replace(/suGenoMasterIdFor\([^)]*\)/g, '')), false);
eq('init が _suMasterName を保持している',
   SRC.geno.indexOf('window._suMasterName = suName') >= 0, true);

/* ═══ 4. 既に混入した控えの始末 ═══ */
group('始末：画像を失わずに切り離す');
function makePrune(){
  const P = makeBox(SRC.geno, [{kind:'fn', name:'pruneWrongMasterGenograms'}]);
  P.setRoster = function(list){ P.store['su_residents_common'] = JSON.stringify({v:1, residents:list}); };
  P.setGeno = function(obj){ P.store['su_genograms'] = JSON.stringify(obj); };
  P.geno = function(){ return JSON.parse(P.store['su_genograms']); };
  return P;
}

/* ★中核：別人の記録を切り離す。消す前に必ず本人の氏名キーへ写す */
let P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}, {masterId:99, name:'架空 花子'}]);
P.setGeno({ '12': {image: IMG_B, name: '架空 花子'} });
eq('別人の記録を1件切り離した', P.sandbox.pruneWrongMasterGenograms(), 1);
eq('masterId のキーは消えた', Object.prototype.hasOwnProperty.call(P.geno(), '12'), false);
eq('画像は花子の氏名キーへ残った', P.geno()['name:架空花子'].image, IMG_B);

/* 本人の氏名キーが既にある時は上書きしない（新しい方を壊さない） */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ '12': {image: IMG_B, name: '架空 花子'}, 'name:架空花子': {image: IMG_A, name: '架空 花子'} });
eq('切り離しは1件', P.sandbox.pruneWrongMasterGenograms(), 1);
eq('既存の氏名キーは上書きしない', P.geno()['name:架空花子'].image, IMG_A);

/* 正しい記録・判定できない記録には触らない */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ '12': {image: IMG_A, name: '架空 太郎'} });
eq('氏名が一致 → 触らない', P.sandbox.pruneWrongMasterGenograms(), 0);
eq('記録はそのまま', P.geno()['12'].image, IMG_A);

P = makePrune();
P.setRoster([{masterId:12, name:'架空　太郎'}]);
P.setGeno({ '12': {image: IMG_A, name: '架空 太郎'} });
eq('空白のゆれだけ → 触らない', P.sandbox.pruneWrongMasterGenograms(), 0);

P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ '77': {image: IMG_B, name: '架空 花子'} });
eq('名簿に無い id → 触らない', P.sandbox.pruneWrongMasterGenograms(), 0);
eq('記録は残る', P.geno()['77'].image, IMG_B);

P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ '12': {image: IMG_B} });
eq('記録に氏名が無い → 触らない（誰の図か決められない）', P.sandbox.pruneWrongMasterGenograms(), 0);

P = makePrune();
P.setRoster([{masterId:12, name:''}]);
P.setGeno({ '12': {image: IMG_B, name: '架空 花子'} });
eq('名簿側の氏名が空 → 触らない', P.sandbox.pruneWrongMasterGenograms(), 0);

/* 氏名キーには一切触らない */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ 'name:架空花子': {image: IMG_B, name: '架空 花子'}, 'name:架空太郎': {image: IMG_A, name: '架空 太郎'} });
eq('氏名キーだけなら何もしない', P.sandbox.pruneWrongMasterGenograms(), 0);
eq('氏名キーは2件とも残る', Object.keys(P.geno()).sort(), ['name:架空太郎','name:架空花子']);

/* 名簿を確認できない時は判定しない（消さない側へ倒す） */
P = makePrune();
P.setGeno({ '12': {image: IMG_B, name: '架空 花子'} });
eq('名簿が無い → 何もしない', P.sandbox.pruneWrongMasterGenograms(), 0);
eq('記録は残る', P.geno()['12'].image, IMG_B);

P = makePrune();
P.store['su_residents_common'] = '{壊れたJSON';
P.setGeno({ '12': {image: IMG_B, name: '架空 花子'} });
eq('名簿が壊れている → 何もしない', P.sandbox.pruneWrongMasterGenograms(), 0);

P = makePrune();
P.setRoster([]);
P.setGeno({ '12': {image: IMG_B, name: '架空 花子'} });
eq('名簿が空 → 何もしない', P.sandbox.pruneWrongMasterGenograms(), 0);

/* 壊れた su_genograms で落ちない */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.store['su_genograms'] = '{壊れたJSON';
eq('図の控えが壊れている → 0件で戻る', P.sandbox.pruneWrongMasterGenograms(), 0);

/* 書き込みに失敗した時（容量超過など）は、既存データを1文字も変えない（原則4） */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
const before = JSON.stringify({'12': {image: IMG_B, name:'架空 花子'}});
P.store['su_genograms'] = before;
P.failWrite = true;
eq('書き込み失敗 → 0件で戻る', P.sandbox.pruneWrongMasterGenograms(), 0);
eq('書き込み失敗 → 既存データは無傷', P.store['su_genograms'], before);

/* prune は冪等（何度走らせても結果が変わらない・旧版タブとの競合から自己回復する） */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ '12': {image: IMG_B, name:'架空 花子'} });
eq('1回目は1件', P.sandbox.pruneWrongMasterGenograms(), 1);
eq('2回目は0件（冪等）', P.sandbox.pruneWrongMasterGenograms(), 0);

/* 写し先の方が新しければ上書きしない（新しい図を古い図で潰さない） */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({
  '12': {image: IMG_B, name:'架空 花子', updatedAt:'2026-08-01T00:00:00.000Z'},
  'name:架空花子': {image: IMG_A, name:'架空 花子', updatedAt:'2026-08-10T00:00:00.000Z'}
});
eq('古い方を切り離す', P.sandbox.pruneWrongMasterGenograms(), 1);
eq('新しい図は残る', P.geno()['name:架空花子'].image, IMG_A);
/* 逆：切り離す側の方が新しければ写す（氏名キーが古い版のまま取り残されない） */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({
  '12': {image: IMG_B, name:'架空 花子', updatedAt:'2026-08-10T00:00:00.000Z'},
  'name:架空花子': {image: IMG_A, name:'架空 花子', updatedAt:'2026-08-01T00:00:00.000Z'}
});
eq('新しい方で写し替える', P.sandbox.pruneWrongMasterGenograms(), 1);
eq('新しい図が残る', P.geno()['name:架空花子'].image, IMG_B);

/* プロトタイプ継承の罠：名簿に無い 'toString' 等のキーを「載っている」と誤判定しない */
P = makePrune();
P.setRoster([{masterId:12, name:'架空 太郎'}]);
P.setGeno({ 'toString': {image: IMG_B, name:'架空 花子'}, 'constructor': {image: IMG_A, name:'架空 一郎'} });
eq('継承プロパティを名簿の氏名と誤解しない', P.sandbox.pruneWrongMasterGenograms(), 0);
eq('記録はそのまま残る', Object.keys(P.geno()).sort(), ['constructor','toString']);

/* 複数件・混在 */
P = makePrune();
P.setRoster([{masterId:1, name:'架空 一郎'}, {masterId:2, name:'架空 二郎'}, {masterId:3, name:'架空 三郎'}]);
P.setGeno({
  '1': {image: IMG_A, name: '架空 一郎'},            // 正しい
  '2': {image: IMG_B, name: '架空 花子'},            // 別人
  '3': {image: IMG_B, name: '架空 一郎'},            // 別人
  'name:架空一郎': {image: IMG_A, name: '架空 一郎'}
});
eq('別人だけ2件を切り離す', P.sandbox.pruneWrongMasterGenograms(), 2);
eq('正しい記録は残る', P.geno()['1'].image, IMG_A);
eq('別人の記録は消えた', [Object.prototype.hasOwnProperty.call(P.geno(),'2'), Object.prototype.hasOwnProperty.call(P.geno(),'3')], [false,false]);
eq('花子の画像は氏名キーへ退避', P.geno()['name:架空花子'].image, IMG_B);
eq('一郎の氏名キーは上書きされない', P.geno()['name:架空一郎'].image, IMG_A);

/* ═══ 5. 契約：読み手が3ファイルだけであること ═══ */
group('契約');
/* ★列挙をハードコードしない。書き漏らしたファイルが将来 su_genograms を読み書きしても
     合格したまま通ってしまう（2026-08-13 レビュー指摘）。テーマ直下の *.html を実測で全部見る
   ★「触る」＝コードとして su_genograms を使うこと。数えないのは次の2つだけ（それ以外は全部数える＝迷ったら触る側）:
     ・引用符の無い言及（コメントの説明文。コードで使うには文字列か .su_genograms が要る）
     ・キー名との等値比較（k === 'su_genograms' など。work-schedule の使用量の内訳が全キーを分類する1行）
     変数に入れる（var K='su_genograms'）・getItem/setItem/removeItem・localStorage['su_genograms']・
     localStorage.su_genograms・テンプレート文字列は、読み書きの経路になりうるので数える（2026-09-23） */
function touchesGenoKey(src){
  if(/\.su_genograms\b/.test(src)) return true;                      // localStorage.su_genograms
  const LIT = /(['"`])su_genograms\1/g, CMP = /(?:[!=]==?)\s*$/, CMP_R = /^\s*[!=]==?/;
  let m;
  while((m = LIT.exec(src))){
    const before = src.slice(Math.max(0, m.index - 8), m.index);
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if(CMP.test(before) || CMP_R.test(after)) continue;               // 名前の比較だけ
    return true;
  }
  return false;
}
/* 判定器そのものの試験（読み書きの形を「比較だけ」と取り違えないこと） */
[
  ["localStorage.getItem('su_genograms')", true],
  ['localStorage.setItem("su_genograms", s)', true],
  ["localStorage.removeItem('su_genograms')", true],
  ["var SU_GENO_KEY='su_genograms';", true],
  ["localStorage['su_genograms']", true],
  ['localStorage.su_genograms', true],
  ['JSON.parse(localStorage.getItem(`su_genograms`))', true],
  ["if (k === 'su_genograms') g = 8; var x = localStorage.getItem('su_genograms');", true],
  ["else if (k.indexOf('genogram:') === 0 || k === 'su_genograms') g = 8;", false],
  ["if ('su_genograms' !== k) continue;", false],
  ['/* su_genograms へ書き出す */', false]
].forEach(([s, want]) => eq('判定: ' + s, touchesGenoKey(s), want));

const allHtml = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));
const mentions = allHtml.filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf('su_genograms') >= 0);
const readers = mentions.filter(f => touchesGenoKey(fs.readFileSync(path.join(ROOT, f), 'utf8')));
process.stdout.write('  （テーマ直下の *.html を ' + allHtml.length + '件 走査・名前が出るのは ' + mentions.length + '件'
  + (mentions.length > readers.length ? '＝比較・説明だけ: ' + mentions.filter(f => readers.indexOf(f) < 0).join(', ') : '') + '）\n');
eq('su_genograms に触るのは3ファイルだけ', readers.sort(),
  ['facesheet.html','genogram.html','resident-master.html']);
/* 書き込むのはジェノグラムだけ（読み手が書き手に化けていないこと・§2 の契約） */
['resident-master.html','facesheet.html'].forEach(f => {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  eq(f + ' は su_genograms へ書かない（読み取り専用）',
    /setItem\(\s*(SU_GENO_KEY|'su_genograms'|"su_genograms")/.test(s), false);
});

process.stdout.write('\n' + (ng ? '✗ ' : '✓ ') + '合格 ' + ok + ' / 不合格 ' + ng + '\n');
process.exit(ng ? 1 : 0);
