/* 入居者マスタ（resident-master.html）とフェイスシート（facesheet.html）の「アレルゲン・禁食の選択」の試験（2026-10-22 代表者の決定）。
   守りたいのは:
     1. 符号→名前の一覧（印 ALG-TAGS-BEGIN〜END の間）が2画面で一字一句同じで、中身が決定どおりであること
     2. 保存（collectForm）: 欄が描かれている時は必ず配列で送る（何も選ばなければ []）・画面で選ぶ符号は一覧で照合する。画面が知らない既存の符号は残す（反対側の一覧の符号は捨てる）／
        欄が描かれていない時は開いた時の値をそのまま引き継ぐ（dayUse と同じ作法）
     3. 2つのキーが SAFE_FIELDS（現場の安全情報・2画面で同じ）と ALLOWED_KEYS（保存のホワイトリスト）に入っていること
     4. 画面の「一目で」と現場のアレルギー欄は、選んだ品目を自由文より前に出し、選んでいない時は今までと同じであること
   実データは1件も含まない（値はすべて架空）。
   実行: node "…/check/unit/allergen_tags_test.js"
     （読む HTML は環境変数 MASTER_HTML・FACESHEET_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MASTER = fs.readFileSync(process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html'), 'utf8');
const FX = fs.readFileSync(process.env.FACESHEET_HTML || path.join(__dirname, '..', '..', 'facesheet.html'), 'utf8');

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

/* 関数を名前で切り出す（master_confirm_test.js と同じ作法） */
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
function grabVar(src, name){
  const m = src.match(new RegExp('\\nvar ' + name + '=\\[[\\s\\S]*?\\];'));
  if(!m) throw new Error('変数が見つかりません: ' + name);
  return m[0];
}
function listOf(src, name){
  return grabVar(src, name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .match(/\[([\s\S]*)\]/)[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
}
const BLOCK_RE = /\/\* ALG-TAGS-BEGIN[\s\S]*?\/\* ALG-TAGS-END \*\//g;
const ESC = "function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;')}";

/* ═══ 1. 一覧が2画面で同じ・決定どおり ═══ */
group('1. 符号→名前の一覧');
const bm = MASTER.match(BLOCK_RE) || [], bf = FX.match(BLOCK_RE) || [];
eq('入居者マスタに一覧が1つだけある', bm.length, 1);
eq('フェイスシートに一覧が1つだけある', bf.length, 1);
t('2画面の一覧が一字一句同じ', bm[0] === bf[0] && !!bm[0]);

const L = {};
vm.createContext(L);
vm.runInContext(bm[0] || '', L);
const ALL = JSON.parse(JSON.stringify(L.ALG_ALLERGENS));
const FG = JSON.parse(JSON.stringify(L.ALG_FORBIDDEN_GROUPS));
eq('アレルゲンは表示義務の8品目（決定どおりの符号・名前・順）', ALL, [
  ['ebi','えび'],['kani','かに'],['kurumi','くるみ'],['komugi','小麦'],['soba','そば'],
  ['tamago','卵'],['nyu','乳'],['rakkasei','落花生']]);
eq('禁食は3つのまとまり（決定どおりの符号・名前・順）', FG, [
  ['薬との飲み合わせ',[['grapefruit','グレープフルーツ'],['vitk','納豆・青汁など（ビタミンK）'],['dairy','牛乳などの乳製品'],['alcohol','アルコール'],['caffeine','カフェイン']]],
  ['食事の制限',[['salt','塩分'],['sugar','糖分'],['potassium','カリウム'],['protein','たんぱく質'],['water','水分']]],
  ['その他',[['raw','生もの'],['religion','宗教・信条']]]]);
eq('禁食を1列にすると12個（まとまりの順）', JSON.parse(JSON.stringify(L.algForbiddenList_())).map(p => p[0]),
  ['grapefruit','vitk','dairy','alcohol','caffeine','salt','sugar','potassium','protein','water','raw','religion']);
const codes = ALL.map(p => p[0]).concat(L.algForbiddenList_().map(p => p[0]));
eq('符号に重複が無い', new Set(codes).size, codes.length);

group('1-2. 照合（algPick_）と表示の行（algTagLines_）');
const pick = (c, l) => JSON.parse(JSON.stringify(L.algPick_(c, l)));
eq('未知の符号・重複を捨て、一覧の順にそろえる', pick(['tamago','peanut','ebi','tamago'], L.ALG_ALLERGENS), ['ebi','tamago']);
eq('文字列でないものは捨てる', pick([1, null, {}, 'soba'], L.ALG_ALLERGENS), ['soba']);
eq('配列でなければ []（文字列）', pick('ebi', L.ALG_ALLERGENS), []);
eq('配列でなければ []（未定義）', pick(undefined, L.ALG_ALLERGENS), []);
eq('オブジェクトの元からある名前を符号として通さない', pick(['constructor','toString','__proto__'], L.ALG_ALLERGENS), []);
eq('禁食の符号をアレルゲンの一覧で通さない', pick(['salt'], L.ALG_ALLERGENS), []);
const lines = r => JSON.parse(JSON.stringify(L.algTagLines_(r)));
eq('何も選んでいなければ []', lines({}), []);
eq('記録が無くても []', lines(undefined), []);
eq('アレルゲンと禁食を1行ずつ・名前で出す', lines({allergenTags:['tamago','ebi'], forbiddenTags:['salt','grapefruit','xx']}),
  ['アレルゲン：えび・卵','禁食：グレープフルーツ・塩分']);
eq('禁食だけ', lines({allergenTags:[], forbiddenTags:['religion']}), ['禁食：宗教・信条']);
eq('未知の符号だけなら []', lines({allergenTags:['peanut'], forbiddenTags:['zz']}), []);

/* ═══ 2. 保存（collectForm） ═══ */
group('2. 保存で送る内容（collectForm）');
/* master_editsave_hosp_test.js（gas/tests）と同じく、本物の collectForm を偽の編集画面で動かす */
function screen(form, checks){
  const inputs = Object.keys(form).map(k => ({ getAttribute: a => (a === 'data-k' ? k : null), value: form[k] }));
  const ck = (attr) => (checks ? checks.filter(c => c.attr === attr).map(c => ({ checked: !!c.on, getAttribute: a => (a === attr ? c.code : null) })) : []);
  const editBox = {
    querySelectorAll: sel => (sel === '[data-k]' ? inputs : sel === '[data-algtag]' ? ck('data-algtag') : sel === '[data-forbtag]' ? ck('data-forbtag') : []),
    querySelector: () => null
  };
  const box = {
    $: id => (id === 'editBox' ? editBox : null),
    editing: null,
    collectFam: () => [], collectSupport: () => [], collectMedLog: () => [], collectMedsPast: () => [],
    collectCareHist: () => [], clhEntryFor_: () => null
  };
  vm.createContext(box);
  const parts = [bm[0], grabVar(MASTER, 'ALLOWED_KEYS')];
  for(const v of ['BF_FORM_KEYS', 'BF_LEGACY_KEYS']) if(MASTER.indexOf('\nvar ' + v + '=') >= 0) parts.push(grabVar(MASTER, v));
  for(const f of ['bfArr', 'bfObj', 'bfPrune', 'bfSet', 'bfStr']) if(MASTER.indexOf('\nfunction ' + f + '(') >= 0) parts.push(grabFn(MASTER, f));
  parts.push(grabFn(MASTER, 'algKeepUnknown_'));
  parts.push(grabFn(MASTER, 'collectForm'));
  vm.runInContext(parts.join('\n'), box, { filename: 'resident-master.html(collectForm)' });
  return box;
}
function opened(rec){
  const e = JSON.parse(JSON.stringify(rec));
  for(const k of ['family', 'supportLog', 'medicalSupportLog', 'medsPastLog', 'careLevelHistory']) if(!Array.isArray(e[k])) e[k] = [];
  return e;
}
const FORM = { name: '架空 一郎', kana: 'かくう いちろう', room: '101', allergy: '架空の自由文' };
const ALLCK = (onA, onF) => ALL.map(p => ({ attr:'data-algtag', code:p[0], on: onA.indexOf(p[0]) >= 0 }))
  .concat(L.algForbiddenList_().map(p => ({ attr:'data-forbtag', code:p[0], on: onF.indexOf(p[0]) >= 0 })));
function run(form, checks, editing){
  const s = screen(form, checks);
  s.editing = opened(editing);
  return JSON.parse(JSON.stringify(s.collectForm()));
}
{
  const r = run(FORM, ALLCK(['tamago','ebi'], ['water','vitk']), { id: 1, name: '架空 一郎', allergenTags: ['soba'], forbiddenTags: [] });
  eq('描かれている: チェックした符号を一覧の順で送る（アレルゲン）', r.allergenTags, ['ebi','tamago']);
  eq('描かれている: チェックした符号を一覧の順で送る（禁食）', r.forbiddenTags, ['vitk','water']);
  eq('自由文の欄はそのまま送る', r.allergy, '架空の自由文');
}
{
  const r = run(FORM, ALLCK([], []), { id: 1, name: '架空 一郎', allergenTags: ['soba','kani'], forbiddenTags: ['salt'] });
  eq('描かれている・何も選ばない: 空の配列を送る（全部外すが効く）', [r.allergenTags, r.forbiddenTags], [[], []]);
}
{
  const ck = ALLCK(['nyu'], ['raw']).concat([{ attr:'data-algtag', code:'peanut', on:true }, { attr:'data-forbtag', code:'zz', on:true },
    { attr:'data-algtag', code:'salt', on:true }]);
  const r = run(FORM, ck, { id: 1, name: '架空 一郎' });
  eq('未知の符号・もう一方の一覧の符号は捨てる', [r.allergenTags, r.forbiddenTags], [['nyu'], ['raw']]);
}
{
  /* 2026-10-22: 画面が知らない既存の符号（後で品目を増やした時に古い画面で保存した場合など）は消さずに残す */
  const r = run(FORM, ALLCK(['ebi'], []), { id: 1, name: '架空 一郎', allergenTags: ['soba','peanut','peanut','BAD CODE','salt'], forbiddenTags: ['newcode','ebi'] });
  eq('描かれている: 外した既知の符号（soba）は消え、知らない既存の符号（peanut）は1つだけ残す・形の崩れた値は捨てる', r.allergenTags, ['ebi','peanut']);
  eq('描かれている: 禁食の知らない既存の符号も残す・反対側の一覧の符号（allergen の salt・禁食の ebi）は捨てる', r.forbiddenTags, ['newcode']);
}
{
  const r = run(FORM, null, { id: 1, name: '架空 一郎', allergenTags: ['soba','peanut'], forbiddenTags: [] });
  eq('描かれていない: 開いた時の値をそのまま引き継ぐ（アレルゲン）', r.allergenTags, ['soba','peanut']);
  eq('描かれていない: 開いた時の値をそのまま引き継ぐ（禁食・空の配列も）', r.forbiddenTags, []);
}
{
  const r = run(FORM, null, { id: 1, name: '架空 一郎' });
  t('描かれていない・元の値も無い: キーを送らない（サーバーが前の値を残す）',
    !Object.prototype.hasOwnProperty.call(r, 'allergenTags') && !Object.prototype.hasOwnProperty.call(r, 'forbiddenTags'), Object.keys(r));
}
t('collectForm の「描かれていない」側は一覧の関数に頼らない（古い試験の偽画面でも動く）',
  /\}else\{\s*if\(editing\.allergenTags!==undefined\)rec\.allergenTags=editing\.allergenTags;\s*if\(editing\.forbiddenTags!==undefined\)rec\.forbiddenTags=editing\.forbiddenTags;\s*\}/.test(grabFn(MASTER, 'collectForm')));

/* ═══ 3. 一覧への登録 ═══ */
group('3. SAFE_FIELDS・ALLOWED_KEYS');
const rmSafe = listOf(MASTER, 'SAFE_FIELDS'), fxSafe = listOf(FX, 'SAFE_FIELDS');
eq('安全情報は2画面で同じ並び', rmSafe, fxSafe);
eq('安全情報は30項目', rmSafe.length, 30);
t('安全情報に allergenTags・forbiddenTags がある', rmSafe.indexOf('allergenTags') >= 0 && rmSafe.indexOf('forbiddenTags') >= 0);
const allowed = listOf(MASTER, 'ALLOWED_KEYS');
t('保存のホワイトリストに allergenTags・forbiddenTags がある', allowed.indexOf('allergenTags') >= 0 && allowed.indexOf('forbiddenTags') >= 0);

/* ═══ 4. 表示 ═══ */
group('4. 編集画面の欄・一目で・現場のアレルギー欄');
{
  const s = { r: null };
  vm.createContext(s);
  vm.runInContext(ESC + '\n' + bm[0] + '\n' + grabFn(MASTER, 'algEditHtml_'), s);
  const h = s.algEditHtml_({ allergenTags: ['ebi','peanut'], forbiddenTags: ['salt'] });
  eq('チェックは20個（8＋12）', (h.match(/type="checkbox"/g) || []).length, 20);
  eq('選んである符号だけにチェックが付く（未知の符号は無視）', (h.match(/ checked/g) || []).length, 2);
  t('チェックに data-k を付けない', !/data-k=/.test(h));
  t('インラインの on…= を使わない（CSP）', !/\son[a-z]+=/i.test(h));
  t('押す所は .bfe（44px）', /<label class="bfe"><input type="checkbox" data-algtag="ebi" checked>えび<\/label>/.test(h), h.slice(0, 300));
  t('記録が無くても描ける', /data-forbtag="religion"/.test(s.algEditHtml_({})));
  t('幅700px以下は文字16px', /@media \(max-width:700px\)\{ \.algtags \.bfe\{font-size:1rem\} \}/.test(MASTER));
}
{
  const s = {};
  vm.createContext(s);
  const stub = 'function glanceItem_(k,v){return "<"+k+">"+v}function glanceVal_(t,c){return "["+(c||"")+"]"+t}' +
    'function glanceCert_(){return ""}function glanceWeight_(){return ""}function missingOf_(){return []}';
  vm.runInContext(ESC + '\n' + stub + '\n' + bm[0] + '\n' + grabFn(MASTER, 'glanceHtml_'), s);
  const g = r => (s.glanceHtml_(r).match(/<アレルギー・禁忌>([\s\S]*?)<食形態>/) || [])[1];
  eq('一目で: 選んでいなければ今までどおり（自由文だけ）', g({ allergy: '架空の自由文', sideEffects: '架空の禁忌' }), '[warn]アレルギー：架空の自由文\n禁忌等：架空の禁忌');
  eq('一目で: 何も無ければ「記載なし」のまま', g({}), '<span class="gv gnone">記載なし</span>');
  eq('一目で: 選んだ品目を自由文より前に出す', g({ allergy: '架空の自由文', allergenTags: ['ebi'], forbiddenTags: ['alcohol'] }),
    '[warn]アレルゲン：えび\n禁食：アルコール\nアレルギー：架空の自由文');
  eq('一目で: 選んだ品目だけでも出す', g({ allergenTags: ['rakkasei'] }), '[warn]アレルゲン：落花生');
}
{
  const s = {};
  vm.createContext(s);
  vm.runInContext(ESC + '\n' + grabFn(FX, 'full') + '\n' + bf[0] + '\n' + grabFn(FX, 'fieldAllergy_'), s);
  for(const r of [{ allergy: '架空の自由文' }, {}, { allergy: '' }, { allergenTags: [], forbiddenTags: ['zz'] }, { allergy: '架空', allergenTags: 'ebi' }]){
    eq('現場: 選んでいなければ今までと1文字も同じ ' + JSON.stringify(r), s.fieldAllergy_(r), s.full('アレルギー', r.allergy));
  }
  eq('現場: 選んだ品目を自由文より前に出す', s.fieldAllergy_({ allergy: '架空の自由文', allergenTags: ['komugi'], forbiddenTags: ['sugar'] }),
    s.full('アレルギー', 'アレルゲン：小麦\n禁食：糖分\n架空の自由文'));
  eq('現場: 選んだ品目だけでも出す', s.fieldAllergy_({ forbiddenTags: ['caffeine'] }), s.full('アレルギー', '禁食：カフェイン'));
  t('現場の表示が fieldAllergy_ を使う', /function renderFieldView\(r\)\{[\s\S]*?fieldAllergy_\(r\)\+/.test(FX));
}

process.stdout.write('\n結果: 成功 ' + ok + ' / 失敗 ' + ng + '\n');
process.exit(ng ? 1 : 0);
