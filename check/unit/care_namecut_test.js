/* 週間名簿の「姓　名」を全端末で出す ── 姓と名の切れ目を共有データ経由で配る試験（2026-09-02 新設）
   実行: node check/unit/care_namecut_test.js
        （CS_HTML / DCR_HTML で対象ファイルを差し替えられる＝作業ツリーの版を試す時に使う）

   なぜ作るか:
     2026-09-01 の実装は、デイ利用表（daycare-roster.html）が入居者マスタへ直接つないで切れ目を借りる
     方式だった。接続設定(rmaster_cfg)は端末ごとの localStorage にしか無いため、設定の無い職員PCでは
     空白なしのまま＝「MacBookでは入るが他のPCでは入らない」の原因。
     直し方は入院・居室と同型: 週間計画(care-schedule.html)がマスタ取込のときに切れ目（数値2つ）を
     共有データ care_schedule_v2 の利用者へ写し、デイ利用表はマスタ接続が無い端末でもそれを読む。
   ここで守るのは次の4つ。
     ①週間計画: マスタの氏名に空白があり、空白を除いた氏名が一致する時だけ nameCut/nameCutLen を書く
       （name そのものは書き換えない＝名寄せの照合キーを壊さない）
     ②週間計画: マスタに空白が無い／氏名が食い違う時は古い切れ目を消す＝実在しない氏名を紙に出さない
     ③デイ利用表: マスタ接続の無い端末は共有データの切れ目で「姓　名」を出す（文字数が合う時だけ）
     ④デイ利用表: マスタ接続のある端末は従来どおりマスタ直読みを優先（挙動不変）
   ★このファイルは gas/ 配下＝公開リポジトリには載らない。氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CS_SRC  = fs.readFileSync(process.env.CS_HTML  || path.join(ROOT, 'care-schedule.html'),  'utf8');
const DCR_SRC = fs.readFileSync(process.env.DCR_HTML || path.join(ROOT, 'daycare-roster.html'), 'utf8');

/* ── 切り出し（care_field_merge_test.js と同じ方式・対象ファイルを引数で切り替える）── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabber(SRC) {
  function grabFn(name) {
    let start = SRC.indexOf('\nfunction ' + name + '(');
    if (start < 0) start = SRC.indexOf('\nasync function ' + name + '(');
    if (start < 0) throw new Error('関数が見つかりません: ' + name);
    const end = scanBlock(SRC, start, '{', '}');
    if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
    return SRC.slice(start, end + 1);
  }
  function grabDecl(name) {
    const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
    if (!m) throw new Error('宣言が見つかりません: ' + name);
    const vpos = m.index + m[0].length;
    const open = SRC[vpos];
    if (open === '{' || open === '[') {
      const end = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']');
      let j = end + 1;
      while (j < SRC.length && SRC[j] !== ';') j++;
      return SRC.slice(m.index, j + 1);
    }
    const eol = SRC.indexOf('\n', vpos);
    return SRC.slice(m.index, eol < 0 ? SRC.length : eol);
  }
  function grabDeclAsVar(name) { return grabDecl(name).replace(/^(?:const|let)\s/, 'var '); }
  return { grabFn, grabDeclAsVar };
}

let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

/* ═══════════════ A. 週間計画（care-schedule.html）── マスタ取込で切れ目を写す ═══════════════ */
const cs = grabber(CS_SRC);
const A = { JSON, Math, Date, Number, String, Array, Object, isFinite, parseInt, console };
vm.createContext(A);
vm.runInContext([
  'var SIM_ON = false;',
  'var DB = { residents: [] };',
  'var csStateRevCommon_ = null;',
  'var savedLocal = 0;',
  'var ruidSeq = 0;',
  'function ruid(){ return "r" + (++ruidSeq); }',
  'function saveLocalOnly(){ savedLocal++; }',
  'function csGetMasterCfg(){ return null; }',
  'var localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };',
  cs.grabFn('suNormName'),
  cs.grabFn('isScheduleTarget'),
  cs.grabFn('csApplyMasterHospitalized'),
  cs.grabDeclAsVar('SU_COMMON_KEY'),
  cs.grabFn('csApplyMasterNameCut'),
  cs.grabFn('mergeCommonSchedule')
].join('\n'), A);

/* 週間計画側の利用者（空白なし＝現場の実態: デイ母集団32名中31名が空白なし・2026-09-01 実測） */
function csDb(residents) {
  A.DB = { residents: residents.map(r => Object.assign({ events: [], careLevel: '', room: '', kana: '' }, r)) };
  return A.DB;
}
function merge(masterList) { return A.mergeCommonSchedule({ residents: masterList }); }   // マスタGASから今取った名簿（extData）
/* 起動時の経路: 共有名簿(LS su_residents_common)を読む＝resident-master を最後に開いた時点の写し（古いことがある） */
function mergeLS(masterList) {
  A.localStorage.getItem = function(k){ return k === 'su_residents_common' ? JSON.stringify({ residents: masterList, updatedAt: '2026-09-01T00:00:00.000Z' }) : null; };
  try { return A.mergeCommonSchedule(); } finally { A.localStorage.getItem = function(){ return null; }; }
}
const M = (o) => Object.assign({ active: true, careLevel: '', room: '', kana: '' }, o);

group('①マスタの氏名に空白があれば nameCut / nameCutLen を写す（name は書き換えない）');
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  const ch = merge([M({ masterId: 'm1', name: '架空　一郎' })]);
  const r = A.DB.residents[0];
  eq('変更ありとして返る', ch, true);
  eq('全角スペース: 姓の文字数が nameCut に入る', r.nameCut, 2);
  eq('空白を除いた文字数が nameCutLen に入る', r.nameCutLen, 4);
  eq('name そのものは空白なしのまま（名寄せの照合キーを壊さない）', r.name, '架空一郎');
  eq('ローカル保存が呼ばれる（次の push で全端末へ届く経路）', A.savedLocal > 0, true);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  merge([M({ masterId: 'm1', name: '架空 一郎' })]);
  eq('半角スペースでも同じ切れ目', A.DB.residents[0].nameCut, 2);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空院花子' }]);
  merge([M({ masterId: 'm1', name: '　架空院　花子　' })]);
  eq('前後の空白は数えない（頭出しがずれない）', [A.DB.residents[0].nameCut, A.DB.residents[0].nameCutLen], [3, 5]);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  merge([M({ masterId: 'm1', name: '架空　一　郎' })]);
  eq('空白が複数ある時は最初の空白を姓名の区切りにする（マスタ直読みと同じ）', [A.DB.residents[0].nameCut, A.DB.residents[0].nameCutLen], [2, 4]);
}
{
  csDb([{ id: 'a', name: '架空一郎' }]);   // masterId 無し＝氏名照合で紐づく
  merge([M({ masterId: 'm1', name: '架空　一郎' })]);
  eq('氏名照合で紐づいた利用者にも写る（照合は空白を除いて比較）', [A.DB.residents[0].masterId, A.DB.residents[0].nameCut], ['m1', 2]);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎', nameCut: 2, nameCutLen: 4 }]);
  const ch = merge([M({ masterId: 'm1', name: '架空　一郎' })]);
  eq('同じ切れ目を写し直しても「変更なし」（起動のたびに保存しない＝冪等）', ch, false);
}

group('②マスタに空白が無い／氏名が食い違う時は写さない・古い切れ目は消す');
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  merge([M({ masterId: 'm1', name: '架空一郎' })]);
  eq('マスタに空白が無ければ nameCut を作らない（文字数から推測しない）', 'nameCut' in A.DB.residents[0], false);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎', nameCut: 2, nameCutLen: 4 }]);
  const ch = merge([M({ masterId: 'm1', name: '架空一郎' })]);
  eq('マスタから空白が消えたら古い切れ目も消す', ['nameCut' in A.DB.residents[0], 'nameCutLen' in A.DB.residents[0]], [false, false]);
  eq('消した時は変更ありとして返る', ch, true);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空氏太郎', nameCut: 2, nameCutLen: 4 }]);
  merge([M({ masterId: 'm1', name: '架空　一郎' })]);
  eq('空白を除いた氏名が食い違う（改名・別人紐づけ）なら写さず、古い切れ目も消す', 'nameCut' in A.DB.residents[0], false);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  merge([M({ masterId: 'm1', name: '架空一郎　' })]);
  eq('末尾だけの空白は切れ目にならない', 'nameCut' in A.DB.residents[0], false);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  merge([M({ masterId: 'm1', name: '' })]);
  eq('氏名が空のマスタ行では何も写さない', 'nameCut' in A.DB.residents[0], false);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎', room: '201' }]);
  merge([M({ masterId: 'm1', name: '架空　一郎', room: '201', active: false })]);
  eq('退去（active=false）の経路は従来どおり（退去フラグのみ・切れ目は触らない）', [A.DB.residents[0].movedOut, 'nameCut' in A.DB.residents[0]], [true, false]);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎', room: '105', hospitalized: false }]);
  merge([M({ masterId: 'm1', name: '架空　一郎', room: '201', hospitalized: true })]);
  const r = A.DB.residents[0];
  eq('既存の master常勝項目（居室・入院）は従来どおり写る', [r.room, r.hospitalized, r.nameCut], ['201', true, 2]);
}

group('②-2 起動時の共有名簿(LS)は古いことがある＝写すだけで消さない（消失より復活）');
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎' }]);
  const ch = mergeLS([M({ masterId: 'm1', name: '架空　一郎' })]);
  eq('LS 経由でも空白があれば写す', [ch, A.DB.residents[0].nameCut, A.DB.residents[0].nameCutLen], [true, 2, 4]);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎', nameCut: 2, nameCutLen: 4 }]);
  const ch = mergeLS([M({ masterId: 'm1', name: '架空一郎' })]);
  eq('LS の名簿に空白が無くても既存の切れ目は消さない（古い写しで往復させない）', [ch, A.DB.residents[0].nameCut], [false, 2]);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空氏太郎', nameCut: 2, nameCutLen: 4 }]);
  mergeLS([M({ masterId: 'm1', name: '架空　一郎' })]);
  eq('LS の氏名が食い違っても消さない（消すのはマスタ直取得の時だけ）', A.DB.residents[0].nameCut, 2);
}
{
  csDb([{ id: 'a', masterId: 'm1', name: '架空一郎', nameCut: 2, nameCutLen: 4 }]);
  merge([M({ masterId: 'm1', name: '架空一郎' })]);
  eq('マスタ直取得（extData）なら従来どおり消す', 'nameCut' in A.DB.residents[0], false);
}

/* ═══════════════ B. デイ利用表（daycare-roster.html）── 共有データの切れ目で「姓　名」を出す ═══════════════ */
const dcr = grabber(DCR_SRC);
const B = { JSON, Math, Date, Number, String, Array, Object, isFinite, parseInt, console };
/* ★2026-09-24（段8-3・テーマ bb6cf78）: roomToFloor は window.SUFacility.floorOf（施設情報の floors）を先に見る。
   画面と同じく window を置き、実物の su-facility.js に facility-profile.json を読ませてから切り出す */
const FP_SRC = fs.readFileSync(path.join(ROOT, 'facility-profile.json'), 'utf8');
B.localStorage = { getItem: k => (k === 'su_facility_json_v1' ? FP_SRC : null), setItem() {} };
B.window = B;
vm.createContext(B);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'su-facility.js'), 'utf8'), B);
vm.runInContext([
  dcr.grabDeclAsVar('NDAY'),
  dcr.grabDeclAsVar('dupCount'),
  dcr.grabDeclAsVar('floorSrcCount'),
  dcr.grabDeclAsVar('dcrNameCutMap'),
  dcr.grabFn('toMin'),
  dcr.grabFn('roomToFloor'),
  dcr.grabFn('buildModel'),
  dcr.grabFn('wkNameSpaced')
].join('\n'), B);

/* デイ母集団に入る最小の利用者（月曜にデイ予定1件） */
function dcrRes(extra) {
  return Object.assign({ id: 'a', masterId: 'm1', name: '架空一郎', room: '201',
    events: [{ serviceType: 'daycare', dayOfWeek: 0, startTime: '09:00', endTime: '15:00' }] }, extra);
}
function shown(extra, map) {
  B.dcrNameCutMap = (map === undefined) ? null : map;
  const ppl = B.buildModel({ residents: [dcrRes(extra)] });
  return ppl.length ? B.wkNameSpaced(ppl[0]) : '(母集団に入らない)';
}

group('③マスタ接続の無い端末（dcrNameCutMap=null）は共有データの切れ目で「姓　名」を出す');
eq('nameCut/nameCutLen が揃えば全角スペースを差し込む', shown({ nameCut: 2, nameCutLen: 4 }), '架空　一郎');
eq('切れ目が無ければ従来どおり空白なし（推測しない）', shown({}), '架空一郎');
eq('文字数が合わない（改名後など）なら使わない', shown({ nameCut: 2, nameCutLen: 5 }), '架空一郎');
eq('nameCutLen が無い（片方だけ）なら使わない', shown({ nameCut: 2 }), '架空一郎');
eq('切れ目が末尾以降なら使わない', shown({ nameCut: 4, nameCutLen: 4 }), '架空一郎');
eq('切れ目が 0 以下なら使わない', shown({ nameCut: 0, nameCutLen: 4 }), '架空一郎');
eq('数値でない値（文字列）は使わない（受信データを信じない）', shown({ nameCut: '2', nameCutLen: '4' }), '架空一郎');
eq('小数は使わない', shown({ nameCut: 1.5, nameCutLen: 4 }), '架空一郎');
eq('氏名に既に空白がある時はその空白を全角に揃える（切れ目は使わない）', shown({ name: '架空 一郎', nameCut: 3, nameCutLen: 4 }), '架空　一郎');

group('④マスタ接続のある端末（dcrNameCutMap あり）は従来どおりマスタ直読みを優先');
eq('マスタの切れ目を使う（共有データより優先）', shown({ nameCut: 3, nameCutLen: 4 }, { m1: { cut: 2, len: 4 } }), '架空　一郎');
eq('マスタに切れ目が無い人は空白なし（共有データの古い値で出さない）', shown({ nameCut: 2, nameCutLen: 4 }, {}), '架空一郎');
eq('マスタの文字数が合わなければ空白なし', shown({}, { m1: { cut: 2, len: 5 } }), '架空一郎');

group('⑤模型の他の項目は変わらない');
{
  B.dcrNameCutMap = null;
  const ppl = B.buildModel({ residents: [dcrRes({ nameCut: 2, nameCutLen: 4, lunchMed: true, dcrStar: true })] });
  eq('階・昼食薬・☆は従来どおり', [ppl[0].floor, ppl[0].lunchMed, ppl[0].star], [2, true, true]);
  eq('デイ予定の無い人は母集団に入らない', B.buildModel({ residents: [{ id: 'b', name: '架空二郎', events: [] }] }).length, 0);
  /* 階の判定は施設情報の floors に従う（既定＝１階・２階）。施設情報の無い端末では従来の判定に戻る */
  eq('階は施設情報から（101→1・２０３→2・301→0）', ['101', '２０３', '301'].map(B.roomToFloor), [1, 2, 0]);
  const saved = B.SUFacility;
  B.SUFacility = { floorOf: () => 9 };
  eq('施設情報がある時は階の判定をそちらに委ねる', B.roomToFloor('101'), 9);
  B.SUFacility = undefined;   /* ★delete は vm の外から効かないので undefined を置く */
  eq('施設情報が無くても従来どおり（101→1・２０３→2・301→0）', ['101', '２０３', '301'].map(B.roomToFloor), [1, 2, 0]);
  B.SUFacility = saved;
}

process.stdout.write('\n合計: ok ' + ok + ' / ng ' + ng + '\n');
process.exit(ng ? 1 : 0);
