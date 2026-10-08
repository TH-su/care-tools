/* 入居者マスタ（resident-master.html）の「保存確認」と「楽観ロックの送り手」のテスト。
   守りたいのは3つ:
     ①保存が失敗と返っても、取り直した現物と突き合わせて「入っている方」だけを保存済みにすること
       （契約書 §13。全員を保存済み扱いにすると未保存の変更が黙って消える＝原則4違反）
     ②突き合わせに落ちた方は kept（未保存＝黄色のまま）に回すこと。迷ったら残す側へ倒す
     ③1人保存は編集画面を開いた時点の updatedAt を baseUpdatedAt として同送し、
       競合（conflict）を受けたら取り直し確認をせず・保存済み扱いにもしないこと（契約書 §14）
   追補（2026-09-23・ロック解放前の flush の横展開）は末尾の 8. を参照
     （新規登録の失敗は照会しない／一括編集・食形態一覧は flush を確かめられなかった時だけ見出しを変える）。
   実データは1件も含まない（氏名・居室・食事内容はすべてテスト用の架空値）。
   実行: node "…/check/unit/master_confirm_test.js"
     （読む HTML は環境変数 MASTER_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');

/* 関数を名前で切り出す（HTML ごと評価すると DOM 依存の初期化まで走る）。
   波かっこを数えて終端を探し、文字列の中のかっこは数えない（bf_form_test.js と同じ作法）。 */
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
/* text の pos 以降で最初に現れる { … } の塊を返す（if ブロックの中身を検査するため） */
function grabBlock(text, pos){
  let i = text.indexOf('{', pos);
  if(i < 0) return '';
  let depth = 0, q = null;
  for(; i < text.length; i++){
    const c = text[i], p = text[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0) return text.slice(text.indexOf('{', pos), i + 1); }
  }
  return '';
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(grabFn('verifyAppliedRows_'), sandbox);
const verifyAppliedRows_ = sandbox.verifyAppliedRows_;

const SAVE = grabFn('saveResident');
const OPEN = grabFn('openEdit');

/* ── 走らせ方 ── */
let ok = 0, ng = 0;
function eq(label, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function t(label, cond, detail){
  if(cond){ ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + (detail !== undefined ? ('\n    実際: ' + JSON.stringify(detail)) : '') + '\n'); }
}
function group(name){ process.stdout.write('\n■ ' + name + '\n'); }

/* ═══ 1. 全項目が一致した方だけを applied にする ═══ */
group('突き合わせの基本');
eq('①全項目一致 → applied',
  verifyAppliedRows_(
    [{id:1, name:'テスト 一郎', fields:{room:'101', careLevel:'要介護1'}}],
    [{id:1, name:'テスト 一郎', room:'101', careLevel:'要介護1'}]),
  {applied:['1'], kept:[]});

eq('②1項目でも違えば kept（未保存のまま残す）',
  verifyAppliedRows_(
    [{id:1, fields:{room:'102', careLevel:'要介護2'}}],
    [{id:1, room:'102', careLevel:'要介護1'}]),
  {applied:[], kept:['1']});

eq('③サーバーにその行が無い → kept',
  verifyAppliedRows_(
    [{id:9, fields:{room:'305'}}],
    [{id:1, room:'101'}]),
  {applied:[], kept:['9']});

eq('複数名: 入った方と入らなかった方を選り分ける',
  verifyAppliedRows_(
    [{id:1, fields:{room:'101'}}, {id:2, fields:{room:'202'}}, {id:3, fields:{room:'303'}}],
    [{id:1, room:'101'}, {id:2, room:'201'}]),
  {applied:['1'], kept:['2','3']});

/* ═══ 2. 型のゆれ（サーバーは boolean・数値で返すことがある） ═══ */
group('型のゆれ');
eq('④真偽値 true と文字列 "true" は一致とみなす',
  verifyAppliedRows_([{id:1, fields:{hospitalized:'true'}}], [{id:1, hospitalized:true}]),
  {applied:['1'], kept:[]});
eq('④逆向き（送信 true / サーバー "true"）も一致',
  verifyAppliedRows_([{id:1, fields:{hospitalized:true}}], [{id:1, hospitalized:'true'}]),
  {applied:['1'], kept:[]});
eq('④false と "false" も一致',
  verifyAppliedRows_([{id:1, fields:{hospitalized:false}}], [{id:1, hospitalized:'false'}]),
  {applied:['1'], kept:[]});
eq('★true と false は当然ながら不一致（kept）',
  verifyAppliedRows_([{id:1, fields:{hospitalized:true}}], [{id:1, hospitalized:false}]),
  {applied:[], kept:['1']});
eq('数値と文字列の介護度は一致（"1" と 1）',
  verifyAppliedRows_([{id:1, fields:{copayRate:'1'}}], [{id:1, copayRate:1}]),
  {applied:['1'], kept:[]});
eq('id が数値と文字列でも同じ方として突き合わせる',
  verifyAppliedRows_([{id:'7', fields:{room:'701'}}], [{id:7, room:'701'}]),
  {applied:['7'], kept:[]});

/* ═══ 3. 改行を含む値（食事備考・アレルギー） ═══ */
group('改行を含む値');
eq('⑤改行つきの値が同じなら applied',
  verifyAppliedRows_(
    [{id:1, fields:{mealNote:'はし・小スプーン\n汁にトロミ'}}],
    [{id:1, mealNote:'はし・小スプーン\n汁にトロミ'}]),
  {applied:['1'], kept:[]});
eq('改行の中身が違えば kept',
  verifyAppliedRows_(
    [{id:1, fields:{mealNote:'はし・小スプーン\n汁にトロミ'}}],
    [{id:1, mealNote:'はし・小スプーン\n汁はそのまま'}]),
  {applied:[], kept:['1']});
/* ★改行コードの違い（\r\n）は「同じ」と扱わない。安全側＝未保存のまま黄色で残し、
   もう一度保存させる（同じ値の上書きなので二重反映にならない）。 */
eq('改行コードだけ違う場合は安全側で kept',
  verifyAppliedRows_(
    [{id:1, fields:{mealNote:'1行目\n2行目'}}],
    [{id:1, mealNote:'1行目\r\n2行目'}]),
  {applied:[], kept:['1']});

/* ═══ 4. 空文字（＝消す指定）の確認 ═══ */
group('空にする指定');
eq('⑥空文字を送り、サーバーも空 → applied（消えたことを確認できた）',
  verifyAppliedRows_([{id:1, fields:{allergy:''}}], [{id:1, allergy:''}]),
  {applied:['1'], kept:[]});
eq('⑥サーバーが null を返しても「空」として一致',
  verifyAppliedRows_([{id:1, fields:{allergy:''}}], [{id:1, allergy:null}]),
  {applied:['1'], kept:[]});
eq('⑥サーバーがその項目を返さない（未定義）場合も「空」として一致',
  verifyAppliedRows_([{id:1, fields:{allergy:''}}], [{id:1, name:'テスト 二郎'}]),
  {applied:['1'], kept:[]});
eq('★消したはずが値が残っていれば kept',
  verifyAppliedRows_([{id:1, fields:{allergy:''}}], [{id:1, allergy:'卵'}]),
  {applied:[], kept:['1']});
eq('null を送ってサーバーが空 → 一致（null は「空」の意味で送られる）',
  verifyAppliedRows_([{id:1, fields:{allergy:null}}], [{id:1, allergy:''}]),
  {applied:['1'], kept:[]});
/* ★broken 行は getBulk が全項目を空で返す。空にする指定と「空⇔空」で一致してしまうため、
   保存済みと認めない（未保存の色のまま残す）。 */
eq('★保存データが壊れた行(broken)は値が一致しても kept',
  verifyAppliedRows_([{id:1, fields:{allergy:''}}], [{id:1, allergy:'', broken:true}]),
  {applied:[], kept:['1']});
eq('broken:false の行は通常どおり applied',
  verifyAppliedRows_([{id:1, fields:{allergy:''}}], [{id:1, allergy:'', broken:false}]),
  {applied:['1'], kept:[]});

/* ═══ 5. 端（空・欠損）で落ちない ═══ */
group('端の入力');
eq('⑦changes が空なら applied も kept も空', verifyAppliedRows_([], [{id:1, room:'101'}]), {applied:[], kept:[]});
eq('changes が null でも落ちない', verifyAppliedRows_(null, null), {applied:[], kept:[]});
eq('rows が空なら全員 kept',
  verifyAppliedRows_([{id:1, fields:{room:'101'}}, {id:2, fields:{room:'202'}}], []),
  {applied:[], kept:['1','2']});
eq('rows が null でも全員 kept（確認できていない＝残す）',
  verifyAppliedRows_([{id:1, fields:{room:'101'}}], null),
  {applied:[], kept:['1']});
eq('id の無い変更は数えない（applied にも kept にも入れない）',
  verifyAppliedRows_([{id:null, fields:{room:'101'}}, {id:1, fields:{room:'101'}}], [{id:1, room:'101'}]),
  {applied:['1'], kept:[]});
eq('fields が無い変更は「送った項目なし」＝行があれば applied',
  verifyAppliedRows_([{id:1}], [{id:1, room:'101'}]),
  {applied:['1'], kept:[]});
eq('サーバー側に id の無い行が混ざっていても落ちない',
  verifyAppliedRows_([{id:1, fields:{room:'101'}}], [null, {room:'101'}, {id:1, room:'101'}]),
  {applied:['1'], kept:[]});
/* 継承したプロパティは比べない（fields は素のオブジェクトとして扱う） */
const proto = Object.create({inherited:'x'}); proto.room = '101';
eq('プロトタイプ由来の項目は比べない',
  verifyAppliedRows_([{id:1, fields:proto}], [{id:1, room:'101'}]),
  {applied:['1'], kept:[]});

/* ═══ 6. 1人保存の楽観ロック（送り手の契約・ソース検査） ═══ */
group('saveResident の契約（§14 楽観ロック）');
t('(a) baseUpdatedAt は isFinite(Date.parse(…)) のガード付きで添える',
  /if\(isFinite\(Date\.parse\(editBaseUpdatedAt\)\)\)\s*body\.baseUpdatedAt=editBaseUpdatedAt;/.test(SAVE));
t('(a) baseUpdatedAt は record の【外】に添える（record 内に入れない）',
  SAVE.indexOf('rec.baseUpdatedAt') < 0 && /var body=\{action:'saveResident',record:rec\};/.test(SAVE));
t('(a) 送るのは body（record だけの旧形は残っていない）',
  /apiPost\(body\)/.test(SAVE) && SAVE.indexOf("apiPost({action:'saveResident'") < 0);

const catchAt = SAVE.indexOf('.catch(function(e){');
const confAt  = SAVE.indexOf("m0.indexOf('conflict')");
const checkAt = SAVE.indexOf("setSync('確認中…')");
t('(b) conflict の判定は catch の中にある', catchAt >= 0 && confAt > catchAt, {catchAt, confAt});
t('(b) conflict の判定は取り直し確認（確認中…）より前にある', confAt >= 0 && checkAt >= 0 && confAt < checkAt, {confAt, checkAt});

const confBlock = grabBlock(SAVE, confAt);
t('(c) 競合時は afterSaveOk_ を呼ばない', confBlock.length > 0 && confBlock.indexOf('afterSaveOk_') < 0, confBlock.slice(0, 60));
t('(c) 競合時は取り直し（apiGet）をしない', confBlock.indexOf('apiGet') < 0);
t('(c) 競合時はそこで抜ける（return がある）', /return;/.test(confBlock));
t('競合の案内は「保存されていない」と「次にどうするか」を書いている',
  confBlock.indexOf('保存されていません') >= 0 && confBlock.indexOf('開き直し') >= 0);
t('競合は同期表示にも出す', /setSync\('競合','err'\)/.test(confBlock));
/* 保存が通ったら基準を進める。進めないと、続けて2回目を保存した時に自分の1回目と競合する */
t('保存できたら editBaseUpdatedAt を最新へ進める',
  /editBaseUpdatedAt=String\(\(saved&&saved\.updatedAt\)\|\|rec\.updatedAt\|\|''\);/.test(SAVE));

group('openEdit の契約');
t('編集画面を開いた時点の updatedAt を editBaseUpdatedAt に控える',
  /editBaseUpdatedAt=\(rec&&rec\.updatedAt\)\?String\(rec\.updatedAt\):''/.test(OPEN));
t('新規（rec なし）では基準を空にする＝baseUpdatedAt を送らない',
  /editBaseUpdatedAt=\(rec&&/.test(OPEN));
t('editBaseUpdatedAt は空文字で宣言されている（未設定のまま送らない）',
  /var editing=null,\s*editBaseUpdatedAt='';/.test(src));

/* ═══ 7. 画面側の配線（3経路とも実物確認へつながっているか） ═══ */
group('保存失敗時の配線');
t('一括編集の catch は getBulk で取り直して突き合わせる',
  /apiGet\(\{action:'getBulk'\},30000\)[\s\S]{0,120}verifyAppliedRows_\(changes/.test(src));
t('食形態一覧の catch は getMealList で取り直して突き合わせる',
  /apiGet\(\{action:'getMealList'\},30000\)[\s\S]{0,400}verifyAppliedRows_\(changes/.test(src));
t('入院フラグの catch は getResident で取り直して現物で判定する',
  /apiGet\(\{action:'getResident',id:sid\},25000\)/.test(src));
t('旧GAS（saveMealList が無い版）の案内は残っている＝取り直さない',
  /if\(\/不明なaction\/\.test\(m\)\)\{/.test(src));
t('確認できなかった時は「失敗した」と断定しない（3経路とも確認できず表示）',
  (src.match(/setSync\('確認できず','err'\)/g) || []).length >= 3,
  (src.match(/setSync\('確認できず','err'\)/g) || []).length);

/* 保存中は「保存」と「閉じる」を両方止める。戻し忘れると、未保存の確認を挟むモーダルから
   出られなくなる（閉じる手段が死ぬ）。2026-08-27 追補。
   ★2026-09-02: 氏名の2段階目を自前モーダルにした際、saveBulk の送信部を saveBulkGo_ へ
     切り出した（native の confirm を2枚続けないため）。終端はすべてそちらにあるので、
     この検査の対象も saveBulkGo_ にする。不変条件そのものは1文字も変えていない。 */
const BULKSAVE = grabFn('saveBulkGo_');
const closeBack = (BULKSAVE.match(/if\(\$\('bulkClose'\)\) \$\('bulkClose'\)\.disabled=false;/g) || []).length;
/* ★2026-09-07: 家族を含む保存の前に割り込みを確かめる bulkFamGuard_ を足したので、
     「割り込みを見つけて中止した」終端が1つ増えて 5 になった。
     終端は ①割り込みで中止 ②保存中に閉じられた ③保存失敗 ④成功 ⑤確認後（catch の then）。
     数を決め打ちにしているのは、増減したら必ず人が中身を読み直すため（今回それが働いた）。 */
t('一括編集は全終端（割り込み中止・保存中に閉じられた・早期エラー・成功・確認後）で「閉じる」も再有効化する',
  closeBack === 5 && /\$\('bulkSave'\)\.disabled=false;\s*if\(\$\('bulkClose'\)\)/.test(BULKSAVE),
  {'再有効化の箇所数': closeBack});

/* ── 追補（2026-08-27 レビュー裁定） ── */
group('確認中の追い越し・誤報を防ぐ配線');
const MEALSAVE = grabFn('mealSaveGo');
const MCATCH = grabBlock(MEALSAVE, MEALSAVE.indexOf('.catch(function(e){'));
const MHEAD = MCATCH.slice(0, MCATCH.indexOf('var seq0=mealSeq;'));
t('【高1】確認の往復中は mealSaving を戻さない（catch 冒頭に mealSaving=false が無い）',
  MCATCH.indexOf('var seq0=mealSeq;') > 0 && MHEAD.indexOf('mealSaving=false') < 0);
t('【高1】mealSaving は全終端で戻す（旧GAS案内・取り直し検知・確認成功・確認できず）',
  (MCATCH.match(/mealSaving=false;/g) || []).length === 4
  && /mealSaving=false; paintMealBar\(\); return;/.test(MCATCH)
  && /mealSetMsg_\(''\); mealSaving=false; paintMealBar\(\); renderRoster\(\);/.test(MCATCH),
  {'mealSaving を戻す箇所数': (MCATCH.match(/mealSaving=false;/g) || []).length});
t('【高1】確認の .then 先頭で取り直しの追い越しを見る（seq ガード）',
  /getMealList'\},30000\)\.then\(function\(d\)\{\s*\/\*[\s\S]*?\*\/\s*if\(seq0!==mealSeq\)\{/.test(MEALSAVE));

t('【中2】一括編集の成功終端で保存ボタンの状態を描き直す（一部失敗をやり直せる）',
  /paintBulkDirty\(\);[^\n]*\n\s*renderBulk\(\);\s*\n\s*refreshRoster\(\);/.test(BULKSAVE));

const HOSP = grabFn('toggleHosp');
const HCATCH = grabBlock(HOSP, HOSP.indexOf('.catch(function(e){'));
t('【低7】入院フラグの成否は現物だけで決める（判定式に curResident を入れない）',
  /if\(got&&got\.hospitalized===want\)\{/.test(HCATCH)
  && HCATCH.indexOf('if(got&&(got.hospitalized===want)&&curResident') < 0);
/* 2026-10-02 から id 一致の判定を変数 same に入れてから使う（案内の文言の出し分けにも使うため）。どちらの書き方も認める */
t('【低7】画面の書き換え（renderView）だけを id 一致で条件付ける',
  /if\(curResident&&String\(curResident\.id\)===String\(sid\)\)\{[\s\S]*?renderView\(curResident\);[\s\S]*?\}/.test(HCATCH)
  || (/var same=!!\(curResident&&String\(curResident\.id\)===String\(sid\)\);/.test(HCATCH)
      && /if\(same\)\{[\s\S]*?renderView\(curResident\);[\s\S]*?\}/.test(HCATCH)));

/* ═══ 8. 保存が失敗扱いで返った時の分かれ道（2026-09-23・ロック解放前の flush の横展開） ═══
   ここは実関数を名前で切り出し、通信と画面の部品だけ偽物に差し替えて【実際に走らせる】。
   文字列の検査だけだと、分岐の順番や見出しの出し分けを取り違えても通ってしまうため。
     ④1人保存の新規登録（番号がまだ無い）は getResident で照会せず「確認できず」にする。
       番号なしの照会は必ず「無い」と返るので、入れ直させて別の番号で二重登録になる
     ⑤既存の方の失敗は従来どおり照会して現物で決める。競合（conflict）も従来どおり
     ⑥一括編集・食形態一覧は、サーバーが flush を確かめられなかった時だけ見出しを変え、
       他の失敗は従来の見出しのまま。見出し以外（未保存の印・ボタンの戻し方）は変えない */
const FLUSH_FAIL_MSG = '保存を確定できたか確かめられませんでした。画面を開き直して、保存されているか確かめてください';
const UNSURE_TOAST = '⚠️ 保存できたか確認できませんでした。画面を再読み込みして、内容が入っているか確かめてください（もう一度保存する前に必ず確認）';
const HEAD_OLD = '保存できませんでした。1文字も書き込んでいません。';
const HEAD_FLUSH = '保存できたか確かめられませんでした（書き込めている方もいます）。';
const OTHER_ERR = '混み合っています。少し待って再度お試しください';
const STAMP_FN = grabFn('saveStampSame_');
const FAMGUARD_FN = grabFn('bulkFamGuard_');
const rejectWith = m => () => Promise.reject(new Error(m));
const copy = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* 偽物の通信はすぐ返すので、マイクロタスクが掃けた後の1周で決着する。念のため数周待つ */
async function settle(){ for(let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); }

/* saveResident を1回走らせ、画面に出したものと通信の記録を返す */
async function runSave(opt){
  const log = {sync:[], toast:[], alert:[], get:[], post:[], okCalls:0, okArgs:[]};
  const btn = {disabled:false};
  /* ★2026-10-01（テーマ 9b60f5a）: saveResident は出した時の世代 devGen と編集対象 editing を控え、
     afterSaveOk_(rec,saved,dg,ed) へ渡すようになった（端末用途ガード）。偽物にも同じ2つを置く。
     事務所PCのまま＝世代は進まないので、ここでの分岐はすべて従来どおりに倒れる */
  const ED = {id:'（編集中の目印）'};
  const sb = {
    CFG: {url:'https://example.invalid/exec', token:'test'},
    editBaseUpdatedAt: opt.base || '',
    devGen: 7,
    editing: ED,
    $: id => (id === 'saveBtn' ? btn : null),
    collectForm: () => copy(opt.rec),
    setSync: (s, c) => { log.sync.push(c === undefined ? [s] : [s, c]); },
    toast: m => { log.toast.push(m); },
    alert: m => { log.alert.push(m); },
    afterSaveOk_: (r, s, dg, ed) => { log.okCalls++; log.okArgs.push({dg, edSame: ed === ED}); },
    apiPost: body => { log.post.push(copy(body)); return opt.post(body); },
    apiGet: (p, ms) => { log.get.push({p: copy(p), ms}); return opt.get ? opt.get(p, log) : Promise.reject(new Error('照会は呼ばれない想定')); }
  };
  vm.createContext(sb);
  vm.runInContext(STAMP_FN + '\n' + SAVE, sb);
  sb.saveResident();
  await settle();
  log.btnDisabled = btn.disabled;
  log.base = sb.editBaseUpdatedAt;
  return log;
}
/* saveBulkGo_ を1回走らせる（家族を含まない変更なので bulkFamGuard_ は素通し） */
const BULK_ROWS0 = [{id:1, name:'テスト 一郎', room:'101'}, {id:2, name:'テスト 二郎', room:'102'}];
const BULK_DIRTY0 = {'1':{room:'111'}, '2':{room:'122'}};
async function runBulk(resp){
  const log = {sync:[], toast:[], alert:[], names:0};
  const els = {bulkSave:{disabled:false}, bulkClose:{disabled:false}};
  const sb = {
    bulkGen: 0, bulkRows: copy(BULK_ROWS0), bulkDirty: copy(BULK_DIRTY0),
    $: id => els[id] || null,
    setSync: (s, c) => { log.sync.push(c === undefined ? [s] : [s, c]); },
    toast: m => { log.toast.push(m); },
    alert: m => { log.alert.push(m); },
    apiPostRaw: () => Promise.resolve(resp),
    apiGet: () => Promise.reject(new Error('照会は呼ばれない想定')),
    bulkNamed: s => String(s),
    refreshBulkNames_: () => { log.names++; },
    paintBulkDirty: () => {}, renderBulk: () => {}, refreshRoster: () => {},
    verifyAppliedRows_: verifyAppliedRows_
  };
  vm.createContext(sb);
  vm.runInContext(FAMGUARD_FN + '\n' + BULKSAVE, sb);
  sb.saveBulkGo_([{id:1, name:'テスト 一郎', fields:{room:'111'}}, {id:2, name:'テスト 二郎', fields:{room:'122'}}],
                 {spaceOnly:[], keyChanged:[]});
  await settle();
  log.dirty = copy(sb.bulkDirty); log.rows = copy(sb.bulkRows);
  log.saveDisabled = els.bulkSave.disabled; log.closeDisabled = els.bulkClose.disabled;
  return log;
}
/* mealSaveGo を1回走らせる（確認のダイアログは「はい」で進める） */
const MEAL_ROWS0 = {'1':{id:1, name:'テスト 一郎', mealForm:'常食'}, '2':{id:2, name:'テスト 二郎', mealForm:'刻み'}};
const MEAL_DIRTY0 = {'1':{mealForm:'刻み'}, '2':{mealForm:'ミキサー'}};
async function runMeal(resp){
  const log = {sync:[], toast:[], alert:[]};
  const rows = copy(MEAL_ROWS0);
  const sb = {
    mealSaving: false, mealSeq: 0, mealDirty: copy(MEAL_DIRTY0),
    MEAL_EDIT: ['mealForm'], MEAL_EDIT_LABEL: {mealForm:'食形態'}, MEAL_MAX_LEN: 200,
    document: {querySelectorAll: () => []},
    mealOnInput_: () => {},
    mealRowOf: id => rows[String(id)] || null,
    mealWho: id => '番号' + id,
    mealNamed: s => String(s),
    confirm: () => true,
    setSync: (s, c) => { log.sync.push(c === undefined ? [s] : [s, c]); },
    toast: m => { log.toast.push(m); },
    alert: m => { log.alert.push(m); },
    mealSetMsg_: () => {}, paintMealBar: () => {}, renderRoster: () => {},
    apiPostRaw: () => Promise.resolve(resp),
    apiGet: () => Promise.reject(new Error('照会は呼ばれない想定')),
    verifyAppliedRows_: verifyAppliedRows_
  };
  sb.mealDirtyCells = () => Object.keys(sb.mealDirty).reduce((n, k) => n + Object.keys(sb.mealDirty[k]).length, 0);
  vm.createContext(sb);
  vm.runInContext(MEALSAVE, sb);
  sb.mealSaveGo();
  await settle();
  log.dirty = copy(sb.mealDirty); log.rows = copy(rows); log.saving = sb.mealSaving;
  return log;
}

async function runFlushCases(){
  group('1人保存: 新規登録（番号なし）の失敗は照会しない（2026-09-23）');
  const NEW_CASES = [['番号が null（新規で開いた既定）', {id:null, name:'テスト 新規'}],
                     ['番号が空文字', {id:'', name:'テスト 新規'}],
                     ['番号のキーが無い', {name:'テスト 新規'}]];
  /* 番号なしで引いた時に実サーバーが返す形（master.gs の doGet は {record:null}）。
     旧実装はこれを見て「サーバー側にも入っていない」と断定していた */
  const NO_RECORD = () => Promise.resolve({record:null});
  for(const [label, rec] of NEW_CASES){
    const L = await runSave({rec, post: rejectWith('タイムアウト'), get: NO_RECORD});
    eq(label + ' → getResident を呼ばない', L.get.length, 0);
    eq(label + ' → 確認中…を経ずに「確認できず」で終える', L.sync, [['保存中…'], ['確認できず','err']]);
    eq(label + ' → 既存と同じ文言の案内を出す', L.toast, [UNSURE_TOAST]);
    t(label + ' → 保存済み扱いにも競合扱いにもしない', L.okCalls === 0 && L.alert.length === 0, L);
    t(label + ' → 保存ボタンは戻す（従来どおり）', L.btnDisabled === false);
  }
  const NF = await runSave({rec:{id:null, name:'テスト 新規'}, post: rejectWith(FLUSH_FAIL_MSG), get: NO_RECORD});
  t('新規＋サーバーが flush を確かめられなかった → 照会せず「確認できず」',
    NF.get.length === 0 && same(NF.sync, [['保存中…'], ['確認できず','err']]) && same(NF.toast, [UNSURE_TOAST]), NF);
  const NS = await runSave({rec:{id:null, name:'テスト 新規'},
    post: body => Promise.resolve({record: Object.assign(copy(body.record), {id:34})})});
  t('新規の保存が通った時は従来どおり（保存OK・照会なし）',
    NS.get.length === 0 && NS.okCalls === 1 && same(NS.sync, [['保存中…'], ['保存OK','ok']]), NS);
  /* 世代と編集対象を後処理へ渡す（渡さないと、切り替え後に届いた応答で名簿と画面が戻る＝9b60f5a の守りが空振り） */
  eq('保存が通った時、出した時の世代と編集対象を afterSaveOk_ へ渡す', NS.okArgs, [{dg:7, edSame:true}]);
  t('　事務所PCのまま（世代が同じ）なら照合用の時刻を従来どおり書き換える', NS.base !== '', NS);

  group('1人保存: 既存の方の失敗は従来どおり getResident で照会する');
  const echo = (p, log) => Promise.resolve({record:{id:p.id, name:'テスト 既存', updatedAt:log.post[0].record.updatedAt}});
  const E1 = await runSave({rec:{id:12, name:'テスト 既存'}, base:'2026-09-01T00:00:00.000Z', post: rejectWith('タイムアウト'), get: echo});
  eq('照会は1回・その方の番号で・25秒待ち', E1.get, [{p:{action:'getResident', id:12}, ms:25000}]);
  eq('今回の目印が入っていれば保存OK', E1.sync, [['保存中…'], ['確認中…'], ['保存OK','ok']]);
  t('保存OK と判定したら afterSaveOk_ を呼ぶ', E1.okCalls === 1);
  eq('　取り直しで確かめた時も世代と編集対象を渡す', E1.okArgs, [{dg:7, edSame:true}]);
  t('　その時も照合用の時刻を取り直した値へ書き換える', E1.base !== '2026-09-01T00:00:00.000Z' && E1.base !== '', E1);
  const E2 = await runSave({rec:{id:12, name:'テスト 既存'}, post: rejectWith('タイムアウト'),
    get: () => Promise.resolve({record:{id:12, updatedAt:'2000-01-01T00:00:00.000Z'}})});
  eq('目印が違えば「保存失敗」', E2.sync, [['保存中…'], ['確認中…'], ['保存失敗','err']]);
  t('その時の案内は「サーバー側にも入っていない」',
    E2.toast.length === 1 && E2.toast[0].indexOf('サーバー側にも入っていないことを確認しました') >= 0, E2.toast);
  const E3 = await runSave({rec:{id:12, name:'テスト 既存'}, post: rejectWith('タイムアウト'), get: rejectWith('タイムアウト')});
  eq('照会もできなければ「確認できず」', E3.sync, [['保存中…'], ['確認中…'], ['確認できず','err']]);
  eq('その時の案内は新規と同じ文言', E3.toast, [UNSURE_TOAST]);
  const E4 = await runSave({rec:{id:12, name:'テスト 既存'}, post: rejectWith(FLUSH_FAIL_MSG), get: echo});
  t('既存＋flush を確かめられなかった → 照会して現物で決める（入っていれば保存OK）',
    E4.get.length === 1 && same(E4.sync[E4.sync.length - 1], ['保存OK','ok']) && E4.okCalls === 1, E4);
  /* 番号 0 はサーバー（master.gs の saveResident）も新規と見なさない。判定をそろえている印 */
  const E5 = await runSave({rec:{id:0, name:'テスト 既存'}, post: rejectWith('タイムアウト'), get: rejectWith('タイムアウト')});
  eq('番号 0 は空とみなさず照会する（新規の判定は null・未定義・空文字だけ）', E5.get.map(g => g.p), [{action:'getResident', id:0}]);

  group('1人保存: 競合（conflict）は従来どおり');
  const C1 = await runSave({rec:{id:12, name:'テスト 既存'}, base:'2026-09-01T00:00:00.000Z', post: rejectWith('conflict')});
  eq('競合は照会しない', C1.get.length, 0);
  eq('同期表示は「競合」', C1.sync, [['保存中…'], ['競合','err']]);
  t('競合の案内を1回だけ出す', C1.alert.length === 1 && C1.alert[0].indexOf('他の端末がこの方を先に保存しています') >= 0, C1.alert);
  t('競合では「確認できず」の案内を出さず、保存済み扱いにもしない', C1.toast.length === 0 && C1.okCalls === 0, C1);
  t('競合でも保存ボタンは戻す', C1.btnDisabled === false);
  const C2 = await runSave({rec:{id:null, name:'テスト 新規'}, post: rejectWith('conflict')});
  eq('分岐の順は変えていない（conflict の判定が新規の判定より先）', C2.sync, [['保存中…'], ['競合','err']]);

  group('一括編集の保存: flush を確かめられなかった時だけ見出しを変える');
  const B1 = await runBulk({ok:false, error:FLUSH_FAIL_MSG});
  eq('flush → 見出しを「保存できたか確かめられませんでした（書き込めている方もいます）。」にする',
    B1.alert, [HEAD_FLUSH + '\n\n' + FLUSH_FAIL_MSG]);
  const B2 = await runBulk({ok:false, error:OTHER_ERR});
  eq('他の失敗 → 見出しは従来どおり', B2.alert, [HEAD_OLD + '\n\n' + OTHER_ERR]);
  const B3 = await runBulk({ok:false});
  eq('error の無い失敗 → 従来どおり（原因不明）', B3.alert, [HEAD_OLD + '\n\n原因不明']);
  const B4 = await runBulk(null);
  eq('応答が空 → 従来どおり（原因不明）', B4.alert, [HEAD_OLD + '\n\n原因不明']);
  const B5 = await runBulk({ok:false, error:FLUSH_FAIL_MSG, saved:2, warn:[], warnIds:[]});
  eq('flush の応答に件数が添えてあっても見出しと中身は同じ', B5.alert, [HEAD_FLUSH + '\n\n' + FLUSH_FAIL_MSG]);
  for(const [label, L] of [['flush', B1], ['他の失敗', B2], ['件数つきの flush', B5]]){
    eq(label + ' → 未保存の印は全員ぶん残す', L.dirty, BULK_DIRTY0);
    eq(label + ' → 表の値を焼き付けない', L.rows, BULK_ROWS0);
    t(label + ' → 「保存」と「閉じる」を戻す', L.saveDisabled === false && L.closeDisabled === false, L);
    eq(label + ' → 同期表示は従来どおり「保存失敗」', L.sync[L.sync.length - 1], ['保存失敗','err']);
    eq(label + ' → 成功の案内は出さない', L.toast, []);
  }
  const B6 = await runBulk({ok:false, error:'テスト用の失敗', detail:['テスト 一郎: 氏名が変わっています（別の方の可能性）']});
  t('氏名が変わっていた時の戻し方も従来どおり（取り直しへ回し、保存ボタンはその終端で戻す）',
    B6.names === 1 && B6.saveDisabled === true && B6.closeDisabled === false, B6);

  group('食形態一覧の保存: flush を確かめられなかった時だけ見出しを変える');
  const M1 = await runMeal({ok:false, error:FLUSH_FAIL_MSG});
  eq('flush → 見出しを変える', M1.alert, [HEAD_FLUSH + '\n\n' + FLUSH_FAIL_MSG]);
  const M2 = await runMeal({ok:false, error:OTHER_ERR});
  eq('他の失敗 → 見出しは従来どおり', M2.alert, [HEAD_OLD + '\n\n' + OTHER_ERR]);
  const M3 = await runMeal(null);
  eq('応答が空 → 従来どおり（原因不明）', M3.alert, [HEAD_OLD + '\n\n原因不明']);
  const M4 = await runMeal({ok:false, error:FLUSH_FAIL_MSG, detail:['テスト 一郎: 照合できませんでした']});
  eq('flush に内訳が付いていれば見出しの後ろへ従来どおり続ける',
    M4.alert, [HEAD_FLUSH + '\n\n' + FLUSH_FAIL_MSG + '\n\nテスト 一郎: 照合できませんでした']);
  for(const [label, L] of [['flush', M1], ['他の失敗', M2]]){
    eq(label + ' → 未保存の印は全員ぶん残す', L.dirty, MEAL_DIRTY0);
    eq(label + ' → 一覧の値を焼き付けない', L.rows, MEAL_ROWS0);
    t(label + ' → 保存中の印を戻す（保存ボタンが押せる）', L.saving === false);
    eq(label + ' → 同期表示は従来どおり「保存失敗」', L.sync[L.sync.length - 1], ['保存失敗','err']);
    eq(label + ' → 成功の案内は出さない', L.toast, []);
  }
}

/* 偽物の足りない所で落ちた時も、黙って合格にせず失敗として数える */
process.on('unhandledRejection', e => { ng++; process.stdout.write('  ✗ 処理されなかった失敗: ' + ((e && e.stack) || e) + '\n'); });
runFlushCases().catch(e => {
  ng++; process.stdout.write('  ✗ 走らせる途中で止まりました: ' + ((e && e.stack) || e) + '\n');
}).then(() => {
  process.stdout.write('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────\n');
  process.exit(ng ? 1 : 0);
});
