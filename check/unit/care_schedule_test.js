/* 週間計画（care-schedule.html）の純関数テスト（2026-08-29 新設）
   実行: node check/unit/care_schedule_test.js

   なぜ作るか:
     このファイルは 7,100行あり、過去に3度の消失事故（2026-08-03〜08-05 の通所入浴、
     2026-08-05 のロック済み支援枠）の現場そのものを含むのに、専用テストが1本も無かった。
     事故の対処コード（csRebaseEdits の入浴の和・undoBulk_ の「消さない側へ倒す」条件）は
     コメントで守られているだけで、機械的に確かめる手段が存在しない状態だった。

   何を守るか:
     ①競合リベースが「消失より復活」を守ること（和集合・入浴の和・server スカラー温存）
     ②貼り付け一括登録の解釈が変わらないこと（区切り・時刻・曜日・氏名の正規化）
     ③報酬マスタが壊れた値を受け取っても既定へ倒れ、倒したことを黙らないこと
     ④取り込みガード（_csBusyEditing）と全体エラー捕捉が外れていないこと（静的照合）

   方針:
     DOM も localStorage も無い node で動かすため、対象は【DBに触らない純関数】に限る。
     既存の試験（check/unit・gas/tests）と同じ vm 方式で、HTML から宣言だけを切り出して評価する。
   ★このファイルは公開リポジトリの check/unit にある（2026-10-08 に gas/tests から移した）。氏名は全て架空にすること。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
/* CS_HTML で対象を差し替えられる（変異試験は /tmp のコピーに対して行う＝正本は書き換えない）。 */
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

/* ── 切り出し（文字列とコメントの中のかっこを数えないスキャナ）──
   コメントを飛ばさないと、日本語コメント内の「{」やアポストロフィで数え間違える。 */
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
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
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
    if (end < 0) throw new Error('宣言の終わりが見つかりません: ' + name);
    let j = end + 1;
    while (j < SRC.length && SRC[j] !== ';') j++;
    return SRC.slice(m.index, j + 1);
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol < 0 ? SRC.length : eol);
}
/* vm は const / let の宣言を砂場のプロパティにしないので、評価する時だけ var へ置き換える。
   中身は1文字も変えない（テストが見ているのは値の挙動であって宣言の書き方ではない）。 */
function grabDeclAsVar(name) { return grabDecl(name).replace(/^(?:const|let)\s/, 'var '); }
/* SYNC はオブジェクトリテラルなので `function 名(` では取れない。メソッド定義を丸ごと切り出し、
   最小の SYNC を組み立て直して挙動を試せるようにする（依存は localStorage と定数だけ）。 */
function grabMethod(name) {
  const start = SRC.indexOf('\n  ' + name + '(');
  if (start < 0) throw new Error('メソッドが見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('メソッドの終わりが見つかりません: ' + name);
  return SRC.slice(start + 1, end + 1);
}

let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

/* ── 評価（純関数だけを載せた砂場を作る）── */
const box = { JSON, Math, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat, console };
vm.createContext(box);
vm.runInContext([
  'var csBathRestored_ = 0;',
  'var SOGO_VISIT_CODES = {};',          /* 総合事業コードは画面側で組み立てる。既定は空＝未登録の状態 */
  grabFn('csRebaseEdits'),
  grabFn('residentFingerprint_'),
  grabDeclAsVar('BULK_DOW'),
  grabFn('normTime_'),
  grabFn('normCat_'),
  grabDeclAsVar('normResidentName_'),
  grabFn('parseBulkLine_'),
  grabDeclAsVar('RATE_MASTER_SCHEMA_V'),
  grabDeclAsVar('RATE_MASTER_DEFAULT'),
  grabFn('rmClone_'),
  grabFn('rmNum_'),
  grabFn('rmIsFilledObj_'),
  grabFn('rmSafeKey_'),
  grabFn('rmNormUnitsTable_'),
  grabFn('normalizeRateMaster_')
].join('\n'), box);

/* ═══ 1. 競合リベース（過去3度の入浴消失の対処コード本体）═══ */
group('csRebaseEdits（消失より復活）');
const R = (s, m) => box.csRebaseEdits(s, m);

/* 壊れた入力では何もしない＝土台（server）をそのまま返す（受信データを信じない・原則10） */
eq('server が null なら server を返す', R(null, { residents: [] }), null);
eq('mine が null なら server を返す', R({ residents: [] }, null), { residents: [] });
eq('residents が配列でなければ server を返す',
   R({ residents: 'こわれた' }, { residents: [] }), { residents: 'こわれた' });

/* ★mine にしか居ない利用者は server へ足す（和集合）。
     ここを「server に無いから消す」にすると、他端末で追加した利用者が同期のたびに消える。 */
eq('自分にしか居ない利用者は追加される',
   R({ residents: [] }, { residents: [{ id: 'a', name: '架空 一郎', events: [] }] }).residents.length, 1);

/* イベントは id 単位で mine 優先・順序も mine 基準、server にしか無いものは残す */
{
  const server = { residents: [{ id: 'a', name: '架空 一郎', events: [
    { id: 'e1', startTime: '09:00' }, { id: 'e9', startTime: '18:00' }] }] };
  const mine = { residents: [{ id: 'a', name: '架空 一郎', events: [
    { id: 'e1', startTime: '10:00' }] }] };
  const out = R(server, mine);
  eq('同じidは自分の内容が勝つ', out.residents[0].events[0].startTime, '10:00');
  eq('サーバーにしか無い予定は残る', out.residents[0].events.map(e => e.id), ['e1', 'e9']);
}

/* ★入浴（加算の根拠）はフィールド単位で「和」を取る。どちらかが true なら true。
     ここが効かないと、入浴が欠けた古い端末の競合でサーバー側の復旧済みの入浴が消える。 */
{
  const server = { residents: [{ id: 'a', events: [{ id: 'e1', bathing: true }] }] };
  const mine   = { residents: [{ id: 'a', events: [{ id: 'e1', bathing: false }] }] };
  box.csBathRestored_ = 0;
  const out = R(server, mine);
  eq('サーバーにある入浴は自分が false でも戻る', out.residents[0].events[0].bathing, true);
  /* ★戻した件数を数えるのは、誤りの向きが「加算の過大計上側」だから。
       黙って倒さず、呼び出し元が必ず人に知らせるための材料にする。 */
  eq('戻した件数を数える', box.csBathRestored_, 1);
}
{
  const server = { residents: [{ id: 'a', events: [{ id: 'e1', bathing: false }] }] };
  const mine   = { residents: [{ id: 'a', events: [{ id: 'e1', bathing: true }] }] };
  box.csBathRestored_ = 0;
  eq('自分の入浴 true はそのまま通る', R(server, mine).residents[0].events[0].bathing, true);
  eq('通した場合は件数を数えない', box.csBathRestored_, 0);
}

/* ★利用者直下のスカラーは server を温存する。ここで mine を勝たせると、
     自分が編集していない既存値が他端末の正当な更新を黙って巻き戻す。 */
{
  const server = { residents: [{ id: 'a', careLevel: '要介護3', room: '201', events: [] }] };
  const mine   = { residents: [{ id: 'a', careLevel: '要介護1', room: '101', events: [] }] };
  const out = R(server, mine);
  eq('介護度はサーバー側を温存', out.residents[0].careLevel, '要介護3');
  eq('居室もサーバー側を温存', out.residents[0].room, '201');
}
/* 土台を壊さない（返り値は複製で、渡した server は書き換えない） */
{
  const server = { residents: [{ id: 'a', events: [{ id: 'e1', bathing: false }] }] };
  const mine   = { residents: [{ id: 'a', events: [{ id: 'e1', bathing: true }] }] };
  R(server, mine);
  eq('引数の server を書き換えない', server.residents[0].events[0].bathing, false);
}

/* ═══ 2. 取込取り消しの指紋（undoBulk_ が「消さない側へ倒す」判定材料）═══ */
group('residentFingerprint_');
const FP = box.residentFingerprint_;
eq('null は空文字', FP(null), '');
eq('介護度が入ると指紋が変わる',
   FP({ name: '架空 一郎' }) === FP({ name: '架空 一郎', careLevel: '要介護2' }), false);
eq('同じ内容なら同じ指紋',
   FP({ name: '架空 一郎', room: '101' }) === FP({ name: '架空 一郎', room: '101' }), true);
/* 負の福祉用具単位は 0 に丸める（指紋が壊れた値で毎回変わると、取り消しが常に「残す」側へ倒れる） */
eq('福祉用具単位の負値は0として扱う',
   FP({ welfareEquipUnits: -5 }) === FP({ welfareEquipUnits: 0 }), true);

/* ═══ 3. 貼り付け一括登録の解釈 ═══ */
group('parseBulkLine_ / normTime_');
const P = (line) => box.parseBulkLine_(line, 0);
eq('タブ区切り', P('架空 一郎\t月\t訪問\t9:00\t9:30').st, '09:00');
eq('カンマ区切り', P('架空 一郎,月,訪問,9:00,9:30').dow, 0);
eq('読点区切り', P('架空 一郎、火、訪問、9:00、9:30').dow, 1);
eq('2つ以上の空白で区切る', P('架空 一郎  水  訪問  9:00  9:30').dow, 2);
/* ★1つの空白では割らない。氏名の中の空白で列がずれると別人の予定になる */
eq('空白1つでは列として割らない', !!P('架空 一郎 水 訪問 9:00 9:30').err, true);
eq('「通所」は通所として扱う', P('架空 一郎\t月\t通所\t9:00\t16:00').stype, 'daycare');
eq('「デイ」も通所', P('架空 一郎\t月\tデイ\t9:00\t16:00').stype, 'daycare');
eq('それ以外は訪問', P('架空 一郎\t月\t身体01\t9:00\t9:30').stype, 'visit');
eq('通所ではサービス区分を持たない', P('架空 一郎\t月\t通所\t9:00\t16:00\t身体01').cat, '');
eq('曜日不明はエラー', !!P('架空 一郎\tX\t訪問\t9:00\t9:30').err, true);
eq('時刻が不正ならエラー', !!P('架空 一郎\t月\t訪問\t25:00\t9:30').err, true);
eq('氏名が空ならエラー', !!P('\t月\t訪問\t9:00\t9:30').err, true);
eq('列が足りなければエラー', !!P('架空 一郎\t月\t訪問').err, true);

const T = box.normTime_;
eq('1桁の時刻は0詰め', T('9:5'), '09:05');
eq('全角コロンも受ける', T('9：30'), '09:30');
eq('24時台は不正', T('24:00'), null);
eq('60分は不正', T('9:60'), null);
eq('空は不正', T(''), null);

/* ═══ 4. 氏名の正規化（2026-08-29 第1弾 D1 の回帰）═══ */
group('normResidentName_（表記ゆれの入口をふさぐ）');
const N = box.normResidentName_;
/* ★M-028（表記ゆれの片側統合でロック済み支援枠100件が消えた）と同型の入口。
     「架空 一郎」と「架空一郎」が別人として併存すると、以後の取込が別々の計画に当たる。 */
eq('半角空白を無視', N('架空 一郎'), '架空一郎');
eq('全角空白を無視', N('架空　一郎'), '架空一郎');
eq('前後の空白も無視', N('  架空 一郎  '), '架空一郎');
eq('null は空文字', N(null), '');

/* ═══ 5. 報酬マスタの正規化（受信データを信じない・請求根拠）═══ */
group('normalizeRateMaster_（壊れた値は既定へ倒し、倒したことを黙らない）');
const NR = box.normalizeRateMaster_;
/* ★一度も保存していない端末は「異常」ではないので警告を出さない（既定をそのまま使うのが正しい） */
eq('未保存（null）は既定・警告なし', NR(null).filled, []);
eq('配列は既定・警告なし', NR([]).filled, []);
eq('文字列は既定・警告なし', NR('こわれた').filled, []);
eq('未保存でも単価は既定値', NR(null).master.feePerUnit, box.RATE_MASTER_DEFAULT.feePerUnit);
/* ★入っているのに壊れている時だけ知らせる。金額に直結するので黙って既定へ戻さない */
{
  const r = NR({ feePerUnit: 0, unitPrice: 99999 });
  eq('範囲外の単価は既定へ倒す', r.master.feePerUnit, box.RATE_MASTER_DEFAULT.feePerUnit);
  eq('倒したことを filled に残す', r.filled.length > 0, true);
}
{
  const r = NR({ facilityType: '知らない類型' });
  eq('未知の施設類型は住宅型へ倒す', r.master.facilityType, 'jutaku');
  eq('倒した理由を残す', r.filled.some(s => String(s).indexOf('施設類型') >= 0), true);
}
eq('正しい施設類型はそのまま', NR({ facilityType: 'tokutei' }).master.facilityType, 'tokutei');
eq('版数は必ず現行スキーマ', NR({ v: 99 }).master.v, box.RATE_MASTER_SCHEMA_V);

/* ═══ 6. 取り込みガードと全体エラー捕捉（静的照合）═══ */
group('取り込みガード _csBusyEditing（2026-08-29 B1）');
const BUSY = grabFn('_csBusyEditing');
/* ★入力欄を持つモーダルが1つでも抜けると、それを開いたまま別タブへ切り替えて戻った時に
     画面だけ古いまま保存され、他端末の更新を巻き戻す。6つ全部が載っていることを機械照合する。
     ★2026-08-30 訂正: 当初は7つ載せたが、貼り付け一括登録(mk-bulk)は後の改修で意図的に外された
       （入力が手で貼ったテキストだけ＝取り込みで消えない。遅らせると古いDBに当たるだけで損）。 */
const BUSY_IDS = ['mk-event', 'mk-resident', 'mk-resident-bulk', 'mk-care-info',
                  'mk-office-info', 'mk-rm-preview'];
BUSY_IDS.forEach(id => {
  eq('保留対象に ' + id + ' が載っている', BUSY.indexOf("'" + id + "'") >= 0, true);
  /* ★id を照合しないと、HTML 側で改名した時に getElementById が null を返すだけで
       ガードが黙って死ぬ（テストは通り続ける）。実在も併せて確かめる。 */
  eq(id + ' が画面に実在する', SRC.indexOf('id="' + id + '"') >= 0, true);
});
/* ★DB 由来の値を入力欄に持たないモーダルは載せない（載せると取り込みが遅れるだけで守れるものが無い）。
     貼り付け一括登録は手で貼ったテキストだけを持ち、取り込み後の新しい DB に当たる方が正しい。 */
['mk-bulk', 'mk-sync', 'mk-sim-apply', 'mk-event-list'].forEach(id => {
  eq('保留対象に ' + id + ' を入れない', BUSY.indexOf("'" + id + "'") >= 0, false);
});
/* ★ここまでは「idが書いてあるか」の静的照合で、ループ本体（open クラスの判定）を壊しても
     素通りする。偽の document を与えて、真偽値の挙動そのものを確かめる。 */
{
  const busyBox = { document: null, editingEventId: null };
  vm.createContext(busyBox);
  vm.runInContext(grabFn('_csBusyEditing'), busyBox);
  const busyWith = (openId, editing, dragging) => {
    busyBox.editingEventId = editing || null;
    busyBox.document = {
      getElementById: (id) => ({ classList: { contains: (c) => c === 'open' && id === openId } }),
      body: { classList: { contains: () => !!dragging } }
    };
    return busyBox._csBusyEditing();
  };
  eq('何も開いていなければ取り込む', busyWith(null), false);
  BUSY_IDS.forEach(id => { eq(id + ' を開いている間は保留する', busyWith(id), true); });
  /* ★外したモーダルは「開いていても保留しない」まで確かめる（載せ直しの検知） */
  eq('mk-bulk を開いていても保留しない', busyWith('mk-bulk'), false);
  eq('予定を編集中なら保留する', busyWith(null, 'ev1'), true);
  eq('ドラッグ中なら保留する', busyWith(null, null, true), true);
}
eq('ドラッグ中も保留する', /is-dragging-move/.test(BUSY) && /is-dragging-resize/.test(BUSY), true);
eq('編集中の予定も保留する', /editingEventId != null/.test(BUSY), true);
/* ★別タブの書き込みを取り込む storage 経路が、このガードを通ること（B1 の穴はここだった） */
const ADOPT = grabFn('csScheduleStorageAdopt_');
eq('storage 経路がガードを通る', /_csBusyEditing\(\)/.test(ADOPT), true);

/* ★編集中に届いた書き込みを【捨てない】こと。storage イベントは再配送されず、
     版数 ws_sync_revs.care はタブ間共有で書いた側が既に進めているためポーリングも拾わない。
     ここで return すると更新は二度と入らず、次の保存で相手の書き込みを無音で上書きする。 */
eq('編集中は捨てずに待ち直す',
   /_csBusyEditing\(\) *\) *\{ *csScheduleStorageAdopt_\(\d+\); *return; *\}/.test(ADOPT), true);
/* ★未送信の自編集がある間も【捨てない】（2026-08-31 に方針変更）。
     従来はここで return しており、storage は再配送されず版数はタブ間共有のためポーリングも拾えず、
     相手の書き込みは二度と入らないまま次の保存で無音で上書きされていた（実測で消失を再現済み）。
     いまは未送信を保ったまま「相手の版を土台に自分の編集を載せ直す」= csAbsorbForeignWrite_ を通す。 */
eq('未送信中でも捨てずに取り込む（return しない）', /if \(SYNC\._dirty\) return;/.test(ADOPT), false);
eq('未送信中は相手の版を取り込んでから保存する',
   /SYNC\._dirty[\s\S]{0,200}csAbsorbForeignWrite_\(\)/.test(ADOPT), true);
/* ★取り込んで【変わった時だけ】書き戻す。無条件に書くと未送信どうしのタブが storage を
   叩き合って止まらない（2026-08-31 レビュー M-3）。 */
eq('変わった時だけ書き戻す（往復を作らない）',
   /r && r\.changed[\s\S]{0,120}saveLocalOnly\(\)/.test(ADOPT), true);
eq('試算中も取り込まない', /if \(SIM_ON\) return;/.test(ADOPT), true);
/* ★storage ハンドラ側で編集中を理由に捨てていないこと（捨てると待ち直しに入れない）
     切り出しは care_schedule_v2（LS_KEY）を見る受け口の本体だけにする。2026-09-25 の e77f644 で
     同期設定用の storage 受け口が前に増え、「最初の storage〜online」だと4,300行を拾って誤って落ちた。 */
const STORAGE_H = (() => {
  const k = SRC.indexOf("if (!e || e.key !== LS_KEY) return;");
  const a = k < 0 ? -1 : SRC.lastIndexOf("window.addEventListener('storage'", k);
  if (a < 0) throw new Error('care_schedule_v2 の storage 受け口が見つかりません');
  return SRC.slice(a, scanBlock(SRC, a, '(', ')') + 1);
})();
eq('storage ハンドラは編集中を理由に捨てない', /_csBusyEditing/.test(STORAGE_H), false);
eq('storage ハンドラは待ち直しへ渡す', /csScheduleStorageAdopt_\(/.test(STORAGE_H), true);

group('全体エラー捕捉（2026-08-29 E2）');
eq("window の 'error' を捕まえる", /window\.addEventListener\('error'/.test(SRC), true);
eq("window の 'unhandledrejection' を捕まえる", /window\.addEventListener\('unhandledrejection'/.test(SRC), true);
/* ★起動時の例外も拾うため、捕捉は定数定義より前（script の先頭）に置く。
     後ろへ動かすと boot の失敗を逃す。 */
eq('捕捉は起動処理より前に置く',
   SRC.indexOf("window.addEventListener('error'") < SRC.indexOf("const LS_KEY"), true);
/* ★画像・スクリプトの読み込み失敗（message を持たない）でトーストを出さない。
     現場が対処できない通知を出し続けると、本当のエラーが埋もれる。 */
eq('読み込み失敗は対象外にする', /if \(!e \|\| \(!e\.message && !e\.error\)\) return;/.test(SRC), true);
/* ★「_csErrLastSig という語がある」「30000 という数がある」だけでは空振りする
     （30000 はポーリング間隔にも一致し、変数宣言は抑制を消しても残る）。抑制の実体を照合する。 */
eq('同じ内容の連続表示を抑える',
   /if \(sig === _csErrLastSig && now - _csErrLastAt < 30000\) return;/.test(SRC), true);
eq('抑制の記憶を更新する', /_csErrLastSig = sig; _csErrLastAt = now;/.test(SRC), true);
eq('次にどうすればよいかを日本語で出す', /入力中の内容を控えて再読み込み/.test(SRC), true);

/* ═══ 6-2. 限度額の判定を画面内で1つに揃える（2026-08-30 管理者の裁定）═══
   裁定前は「サマリーの使用率は福祉用具と総合事業を含めて100%超なのに、盤面のコマは赤くならない」
   という二重基準だった。週枠の按分から、週次を通らずに先に消費される2つを引いて揃える。 */
group('getEventCoverage（限度額を超えたらコマも赤くする）');
const covBox = { JSON, Math, Number, String, Array, Object, isFinite };
vm.createContext(covBox);
vm.runInContext([
  'var SOGO_VISIT_CODES = { "A11": { units: 1000, name: "総合A11" } };',
  'var __limit = 10000;',
  'function effectiveCareLimit_(lv) { return __limit; }',
  'function getUnitBreakdown(ev, res) { return ev.__u; }',   /* 表示単位をそのまま返すスタブ */
  'function sumDisplayUnits(b) { return b; }',
  grabFn('sogoMonthlyUnits_'),
  grabFn('getEventCoverage')
].join('\n'), covBox);
const ev_ = (id, units, cat) => ({ id, dayOfWeek: 0, startTime: '09:00', serviceType: 'visit',
                                   category: cat || '身体１', __u: units });
const cov_ = (events, welfare, limit) => {
  covBox.__limit = (limit === undefined) ? 10000 : limit;
  const m = covBox.getEventCoverage(events, { careLevel: '要介護3', welfareEquipUnits: welfare || 0 });
  return m ? Array.from(m.values()) : m;
};
/* 限度額10000 → 週枠 10000/4.3 ≒ 2325。週2000 は収まる＝全量カバー */
eq('福祉用具なし・限度内なら全量カバー', cov_([ev_('e1', 2000)], 0), [2000]);
/* ★福祉用具5000 を引くと週枠は 5000/4.3 ≒ 1163。同じ2000のコマが一部カバー＝赤くなる */
eq('福祉用具の単位ぶん週枠が減る', cov_([ev_('e1', 2000)], 5000), [1163]);
/* ★福祉用具だけで限度額に達していれば、コマは最初から超過（0＝赤） */
eq('福祉用具だけで限度額に達したら全コマ超過', cov_([ev_('e1', 2000)], 10000), [0]);
/* 福祉用具が限度額を大きく超える異常値でも、結果は「全コマ超過」で安定する
   （週枠の0クランプは意味のない負の値を残さないためのもので、判定結果は同じ＝挙動不変）。 */
eq('限度額を大きく超える福祉用具でも全コマ超過で安定', cov_([ev_('e1', 2000)], 99999), [0]);
/* ★総合事業（月額包括）も週枠を消費しない側なので、同じく先に引く。
     引かないと A11 の1000単位が二重に「使えるもの」として数えられる。
     限度額10000 − 総合事業1000 = 9000 → 週枠 9000/4.3 ≒ 2093。
     2200 のコマは、引いた時だけ一部カバー（＝赤）になる（引かなければ週枠2325で全量カバー）。 */
eq('総合事業の月額ぶんも週枠から引く',
   cov_([ev_('s1', 0, 'A11'), ev_('e1', 2200)], 0), [0, 2093]);
eq('限度額が無ければ判定しない（従来どおり null）', cov_([ev_('e1', 2000)], 0, 0), null);

group('computeResidentSummary（報酬額と報酬額(想定)）');
const sumBox = { JSON, Math, Number, String, Array, Object, isFinite };
vm.createContext(sumBox);
vm.runInContext([
  'var FEE_PER_UNIT = 10;',
  'var __limit = 10000;',
  'function effectiveCareLimit_(lv) { return __limit; }',
  'function kaigoWeekUnits_(evs, res) { return res.__week || 0; }',   /* 週合計をテストから直接与える */
  'function sogoMonthlyUnits_(evs) { return 0; }',
  grabFn('computeResidentSummary')
].join('\n'), sumBox);
const sum_ = (week, welfare, limit) => {
  sumBox.__limit = (limit === undefined) ? 10000 : limit;
  return sumBox.computeResidentSummary({ careLevel: '要介護3', copayRate: 1,
                                         welfareEquipUnits: welfare || 0, events: [], __week: week });
};
/* ★限度額を超えていない方は、頭打ちも福祉用具の引き算も打ち消し合って報酬額と同額になる。
     ここが食い違うと「超えていないのに想定だけ少ない」という誤った数字を出す。 */
{
  const s = sum_(1000, 0);            // 月 = round(1000×4.3) = 4300
  eq('限度内: 使用単位(月)', s.monthUnits, 4300);
  eq('限度内: 報酬額', s.fee, 43000);
  eq('限度内: 想定は報酬額と同額', s.feeExpected, s.fee);
}
{
  const s = sum_(1000, 1000);         // 月4300 + 福祉用具1000 = 5300 ≤ 10000
  eq('限度内(福祉用具あり): 合計単位', s.totalUnits, 5300);
  eq('限度内(福祉用具あり): 想定は報酬額と同額', s.feeExpected, s.fee);
}
/* ★限度額を超えた方は、限度額で頭打ちにしてから福祉用具を引く＝実際に算定される額に近づく */
{
  const s = sum_(3000, 0);            // 月 = 12900 > 10000
  eq('超過: 報酬額は使用単位そのまま', s.fee, 129000);
  eq('超過: 想定は限度額で頭打ち', s.feeExpected, 100000);
  eq('超過: 想定は報酬額より小さい', s.feeExpected < s.fee, true);
}
{
  const s = sum_(3000, 1000);         // 合計13900 > 10000 → 頭打ち10000 − 福祉用具1000 = 9000
  eq('超過(福祉用具あり): 想定単位', s.expectedUnits, 9000);
  eq('超過(福祉用具あり): 想定額', s.feeExpected, 90000);
}
/* ★負担限度額が無い方（特定施設・介護度未設定）は頭打ちが働かない＝報酬額と同額 */
{
  const s = sum_(3000, 0, 0);
  eq('限度額なし: 使用率は出さない', s.pct, null);
  eq('限度額なし: 想定は報酬額と同額', s.feeExpected, s.fee);
}
/* ★異常値（福祉用具だけで限度額超）でも負の金額を出さない */
eq('福祉用具が限度額を超えても想定は0以上', sum_(0, 5000, 1000).feeExpected, 0);

/* 画面側の配線（列・合計・凡例が想定を出していること） */
group('利用者一覧の列（2026-08-30 追加）');
eq('列名は「報酬額」', /<th class="rl-fee-h">報酬額<br>\(円\)<\/th>/.test(SRC), true);
eq('その右に「報酬額(想定)」がある', /<th class="rl-fee-h">報酬額\(想定\)<br>\(円\)<\/th>/.test(SRC), true);
eq('行に想定のセルを出す', /rl-fee rl-fee-exp\$\{s\.feeExpected < s\.fee/.test(SRC), true);
/* ★列を1つ増やしたので、空行の colspan と合計行の桁が揃っていないと表がずれる */
eq('空行の colspan は15', /colspan="15">表示対象の利用者がいません/.test(SRC), true);
eq('合計行は 13 + 報酬額 + 想定 = 15列', /colspan="13">報酬額 合計/.test(SRC), true);
eq('合計行に想定の合計を出す', /rl-fee rl-fee-exp">\$\{totalFeeExp/.test(SRC), true);
/* ★「実際の請求額」と誤読されないよう、凡例で式を必ず示す（この一覧は請求根拠ではない） */
eq('凡例に想定の式を書く', /負担限度額で頭打ちにした単位から福祉用具単位を引いて算出/.test(SRC), true);
eq('同額になる条件も書く', /限度額を超えていない方・負担限度額が「—」の方は報酬額と同額/.test(SRC), true);
/* ★下線は装飾なので、意味を凡例に書かないと色・形だけで伝えることになる（介護現場要件4）。 */
eq('下線の意味を凡例に書く', /頭打ちが効いて報酬額と差が出た行は、想定額に下線を引く/.test(SRC), true);

/* ═══ 6-3. 予定の時間の食い違い警告（2026-08-30 レビュー指摘・中-2）═══
   第3弾で入った主要な新規ロジックなのに検査が1件も無かった。境界（120分ちょうど）と
   間隔の向き（候補が前か後か）を固定する。警告を出すだけで保存は止めない仕様。 */
group('planTimeWarnings_（重なりと2時間ルール）');
const planBox = { JSON, Math, Number, String, Array, Object, isNaN };
vm.createContext(planBox);
vm.runInContext([
  'var SOGO_VISIT_CODES = { "A11": { units: 1000, name: "総合A11" } };',
  grabDeclAsVar('DAYS_JA'),
  grabDeclAsVar('PLAN_INTERVAL_MIN'),
  grabFn('timeToMins'),
  grabFn('isSogoCat_'),
  grabFn('planTimeWarnings_')
].join('\n'), planBox);
const W = (evs, cand, excludeId) =>
  planBox.planTimeWarnings_({ events: evs }, cand, excludeId);
const v = (id, dow, st, en, cat) => ({ id, dayOfWeek: dow, startTime: st, endTime: en,
                                       serviceType: 'visit', category: cat || '身体１' });
const kinds = (out) => out.map(t => t.indexOf('時間が重なって') >= 0 ? '重なり'
                                 : t.indexOf('間隔が2時間未満') >= 0 ? '2時間' : '?');

/* 入力が揃わないうちは何も言わない（入力途中に警告を出し続けない） */
eq('曜日が未選択なら空', W([v('a',0,'09:00','10:00')], { dayOfWeek: null, startTime:'09:00', endTime:'10:00' }), []);
eq('時刻が空なら空', W([v('a',0,'09:00','10:00')], { dayOfWeek: 0, startTime:'', endTime:'10:00' }), []);
eq('開始≧終了なら空', W([v('a',0,'09:00','10:00')], v('c',0,'10:00','10:00')), []);

/* 重なり：同じ時間2つの支援は実施できない */
eq('時間が重なれば重なり警告', kinds(W([v('a',0,'09:00','10:00')], v('c',0,'09:30','10:30'))), ['重なり']);
eq('完全に同じ時間も重なり', kinds(W([v('a',0,'09:00','10:00')], v('c',0,'09:00','10:00'))), ['重なり']);
/* ★端が接するだけは「重なり」ではない（間隔0分の2時間ルール側へ倒れる） */
eq('端が接するだけなら2時間ルール', kinds(W([v('a',0,'09:00','10:00')], v('c',0,'10:00','11:00'))), ['2時間']);

/* ★境界：gap < 120 のときだけ警告。119分で出て 120分ちょうどで出ない */
eq('間隔119分は警告', kinds(W([v('a',0,'09:00','10:00')], v('c',0,'11:59','12:30'))), ['2時間']);
eq('間隔120分ちょうどは警告なし', W([v('a',0,'09:00','10:00')], v('c',0,'12:00','12:30')), []);
/* ★候補が【前】の場合も同じように測る（gap の向き判定） */
eq('候補が前でも119分なら警告', kinds(W([v('a',0,'12:00','13:00')], v('c',0,'09:30','10:01'))), ['2時間']);
eq('候補が前で120分なら警告なし', W([v('a',0,'12:00','13:00')], v('c',0,'09:30','10:00')), []);

/* ★総合事業（月額包括）は2時間ルールの対象外。どちらか一方でも外れれば出さない */
eq('既存が総合事業なら出さない', W([v('a',0,'09:00','10:00','A11')], v('c',0,'10:30','11:00')), []);
eq('候補が総合事業なら出さない', W([v('a',0,'09:00','10:00')], v('c',0,'10:30','11:00','A11')), []);
/* ★重なりの方は総合事業でも出す（同時刻に2つは実施できない＝算定方式と無関係） */
eq('総合事業でも重なりは出す', kinds(W([v('a',0,'09:00','10:00','A11')], v('c',0,'09:30','10:30'))), ['重なり']);

/* 通所が絡む組み合わせは2時間ルールの対象外（訪問同士の規定のため） */
{
  const dc = { id:'d', dayOfWeek:0, startTime:'09:00', endTime:'10:00', serviceType:'daycare' };
  eq('既存が通所なら2時間ルールは出さない', W([dc], v('c',0,'10:30','11:00')), []);
}

/* 別の曜日・自分自身は対象外 */
eq('別の曜日は見ない', W([v('a',1,'09:00','10:00')], v('c',0,'09:30','10:30')), []);
eq('編集中の自分自身は除外する', W([v('a',0,'09:00','10:00')], v('a',0,'09:00','10:00'), 'a'), []);

/* 重なりと2時間は同時に出うる（相手が別なら両方出る）。
   候補 09:30-10:20 は a(09:00-10:00) と重なり、b(10:30-11:00) とは間隔10分。 */
eq('重なりと2時間が同時に出る',
   kinds(W([v('a',0,'09:00','10:00'), v('b',0,'10:30','11:00')], v('c',0,'09:30','10:20'))).sort(),
   ['2時間','重なり'].sort());

/* ═══ 6-4. 送信する版数を「編集を始めた時点」で固定する（2026-08-30 レビュー指摘・中-1）═══
   版数キー ws_sync_revs.care はワースケと共有で、あちらが書き込むと進む。送信時に読み直すと
   「自分が編集を始めた後にワースケが進めた版」を名乗ってしまい、サーバーが競合と判定できず
   ワースケの変更を無音で上書きする（ワースケの差分ジャーナルは push 成功時に消えるので
   自己修復も効かない）。固定していればサーバーが conflict を返し csRebaseEdits が働く。 */
group('版数の固定（無音の上書きを競合へ倒す）');
{
  const store = new Map();
  const fakeLS = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  const syncBox = { JSON, localStorage: fakeLS, SIM_ON: false, CS_DIRTY_KEY: 'care_schedule_dirty_v1' };
  vm.createContext(syncBox);
  vm.runInContext('var SYNC = {\n  _dirty: false,\n  _baseRev: null,\n'
    + [grabMethod('loadCareRev'), grabMethod('markDirty'), grabMethod('clearDirty')].join(',\n') + '\n};', syncBox);
  const S = syncBox.SYNC;
  const setServerRev = (n) => fakeLS.setItem('ws_sync_revs', JSON.stringify({ care: n }));

  setServerRev(5);
  eq('編集前は固定していない', S._baseRev, null);
  S.markDirty();
  eq('編集を始めた時点の版数を取る', S._baseRev, 5);
  /* ★ここが本質: 編集中にワースケが書き込んで共有の版数が進んでも、送る版数は動かない。
       動いてしまうと「最新版を持っている」と名乗ることになり、サーバーが競合を返せない。 */
  setServerRev(6);
  eq('編集中に共有版数が進んでも固定値は動かない', S._baseRev, 5);
  S.markDirty();
  eq('編集を続けても固定値は取り直さない', S._baseRev, 5);
  /* 送信済みになったら解除＝次の編集で取り直す */
  S.clearDirty();
  eq('送信済みで固定を解除する', S._baseRev, null);
  eq('未送信フラグも降りる', S._dirty, false);
  S.markDirty();
  eq('次の編集は現在の版数で取り直す', S._baseRev, 6);
  /* 試算モード中は未送信フラグを立てない（既存仕様。固定もしない） */
  S.clearDirty(); syncBox.SIM_ON = true; S.markDirty();
  eq('試算中は固定しない', S._baseRev, null);
  syncBox.SIM_ON = false;
}
/* 配線（上の砂場では確かめられない送信側とadopt側を静的に固定する） */
const PUSH_REV = /const baseRev = \(this\._baseRev != null\) \? this\._baseRev : this\.loadCareRev\(\);/;
eq('push は固定値を優先して送る', PUSH_REV.test(SRC), true);
eq('push のペイロードは baseRev を渡す', /rev: baseRev, data: DB, force: !!force/.test(SRC), true);
/* ★送信時に読み直す形が残っていないこと（戻したら中-1が再発する） */
eq('送信時に読み直す形が残っていない', /rev: this\.loadCareRev\(\), data: DB/.test(SRC), false);
/* ★土台がサーバー版に変わったら固定を捨てる。捨てないと競合解消後の再pushが古い版で送られ、
     競合が解けずに往復し続ける。 */
/* ★ここは SRC 全体を見ると clearDirty 側の同じ並びに当たって素通りする（変異試験で実際に
     素通りした）。adopt の本体だけを切り出して確かめる。 */
{
  const ADOPT = grabMethod('adopt');
  eq('adopt が未送信フラグを降ろす', /this\._dirty = false;/.test(ADOPT), true);
  eq('adopt は固定も解除する', /this\._baseRev = null;/.test(ADOPT), true);
}
/* 離脱時の beacon も同じ基準で送る（片方だけ直すと閉じ際だけ無音上書きが残る） */
eq('離脱時の送信も固定値を使う',
   /rev: \(SYNC\._baseRev != null \? SYNC\._baseRev : SYNC\.loadCareRev\(\)\)/.test(SRC), true);

/* ═══ 7. 第1弾（利用者削除の安全化・b349356）の不変条件 ═══ */
group('利用者削除の安全化（2026-08-29 第1弾の回帰）');
const RM = grabFn('removeResident');
/* ★ここは「語が出てくるか」では守れない（コメントにも同じ語が出るため、条件式を false へ
     書き換えても素通りする＝変異試験で実際に素通りした）。条件式そのものと、
     実際に消す行より【前】に在ることの両方を見る。 */
const RM_DELETE = RM.indexOf('DB.residents = DB.residents.filter');
eq('利用者を消す行がある', RM_DELETE >= 0, true);

/* ★マスタ紐づきの利用者を消すと、次の名簿同期が予定ゼロの本人を作り直す＝
     本人は戻るが週間計画だけ消える（現場には「計画が消えた」としか見えない）。 */
const RM_GUARD = RM.indexOf("res.masterId != null && res.masterId !== ''");
eq('入居者マスタ紐づきの判定が実在する', RM_GUARD >= 0, true);
eq('その判定は削除より前にある', RM_GUARD >= 0 && RM_GUARD < RM_DELETE, true);
eq('紐づいていたら消さずに操作先を案内する',
   /res\.masterId[\s\S]{0,220}showToast\([\s\S]{0,120}一括編集[\s\S]{0,60}return;/.test(RM), true);

/* ★削除直後の saveDB() が端末バックアップを「削除後の名簿」で上書きするため、
     削除の【前】に全体を退避しておかないと、複数名のうち1名の削除は何にも救われない。 */
const RM_BACKUP = RM.indexOf("LS_KEY + '_backup_' + Date.now()");
eq('全体の退避が実在する', RM_BACKUP >= 0, true);
eq('退避は削除より前にある', RM_BACKUP >= 0 && RM_BACKUP < RM_DELETE, true);

/* ★何が消えるかを見せずに通さない（予定の件数を確認文に出す） */
eq('確認文に予定の件数を出す', /confirm\([\s\S]{0,200}予定 \$\{evN\}件/.test(RM), true);
/* ★1手Undo。予定の取り消しと違い利用者そのものが消えるので独立の種類で積む */
eq('取り消し履歴を積んでから消す',
   RM.indexOf("kind: 'resident'") >= 0 && RM.indexOf("kind: 'resident'") < RM_DELETE, true);
eq('取り消しの実装がある', SRC.indexOf('function undoRemoveResident_(') >= 0, true);

process.stdout.write('\n' + (ng ? '✗ ' : '✓ ') + '合格 ' + ok + ' / 不合格 ' + ng + '\n');
process.exit(ng ? 1 : 0);
