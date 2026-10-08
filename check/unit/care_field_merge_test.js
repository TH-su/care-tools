/* 週間計画（care-schedule.html）── 相手の入力を消さない3-wayマージと、戻す側の試験（2026-08-31 新設）
   実行: node check/unit/care_field_merge_test.js

   なぜ作るか:
     2026-08-31 の監査で、対策のうち【戻す側】と【フィールド単位の保護】に試験が1件も無く、
     ガードを壊しても全テストが緑のまま通ることが分かった（変異試験51件中17件が生存）。
     ここで守るのは次の4つ。
       ①自分が触っていない支援内容(detail)・サービス区分(category)は、相手(server)の値を残す
         ＝ワースケが書いた入力を「別の予定を1つ保存しただけ」で消さない（件数が変わらないため
           サーバーの planshrink では止められない＝クライアントで止めるしかない）
       ②自分が変えたフィールドは従来どおり自分が勝つ（＝自分の編集は消えない）
       ③他タブが localStorage を書き換えていたら、保存の前に取り込む（指紋を自分で塗り潰さない）
       ④復元（足す／丸ごと）が、今ある予定を勝手に消さない・保存に失敗したら送信しない
   ★このファイルは公開リポジトリの check/unit にある（2026-10-08 に gas/tests から移した）。氏名は全て架空にすること。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

/* ── 切り出し（care_schedule_test.js と同じ方式・コメントと文字列の中のかっこを数えない）── */
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

let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

/* ── 砂場（localStorage と最小の DOM を偽装する）── */
const store = {};
const fakeLS = {
  getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; },
};
const els = {};
function mkClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c),
           toggle: (c, v) => { if (v) set.add(c); else set.delete(c); },
           contains: (c) => set.has(c), _set: set };
}
function el(id) {
  return (els[id] = els[id] || { id, style: {}, textContent: '', innerHTML: '', title: '',
                                 attrs: {}, classList: mkClassList(),
                                 setAttribute(k, v) { this.attrs[k] = String(v); },
                                 getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; } });
}
const toasts = [], logs = [], confirms = [];
const box = {
  JSON, Math, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat, console, Promise,
  localStorage: fakeLS,
  LS_KEY: 'care_schedule_v2',
  SIM_ON: false,
  DB: { residents: [] },
  showToast: (m) => { toasts.push(String(m)); },
  escHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  $: (sel) => el(String(sel).replace('#', '')),
  SYNC: { _dirty: false, log: (m) => { logs.push(String(m)); }, hasTarget: () => false, push: () => {}, gas: null },
  confirm: (q) => { confirms.push(String(q)); return box.__answerConfirm; },
  __answerConfirm: true,
  /* 復元経路が呼ぶ相手（呼ばれた回数だけ数える。DB を壊さない） */
  pushUndo: () => { box.__undo++; },
  recalcAllEventUnits: () => { box.__recalc++; box.recalcAllEventUnitsCalls++; },
  populateResidentSelect: () => {},
  renderAll: () => {},
  closeRestoreModal: () => { box.__closed++; },
  saveDB: () => { box.__saved++; return box.__saveOk; },
  saveLocalOnly: () => { box.__savedLocal++; },
  csLooksLikeSampleOnly: () => false,
  csRealResidentCount: (rs) => (Array.isArray(rs) ? rs.length : 0),
  recalcAllEventUnitsCalls: 0,
  __undo: 0, __recalc: 0, __closed: 0, __saved: 0, __savedLocal: 0, __saveOk: true,
  document: { body: { classList: mkClassList() } },
};
vm.createContext(box);
vm.runInContext([
  'var csBathRestored_ = 0;',
  'var SOGO_VISIT_CODES = {};',
  grabDeclAsVar('CS_LOCAL_FP_KEY'),
  grabDeclAsVar('CS_FIELD_BASE_KEY'),
  grabDeclAsVar('CS_MERGE_FIELDS'),
  'var CS_FIELD_BASE = null;',
  grabFn('csFingerprint_'),
  grabFn('csRememberLocalFp_'),
  grabFn('csFieldBaseBuild_'),
  grabFn('csFieldBaseSet_'),
  grabFn('csFieldBaseSnapshot_'),
  grabFn('csFieldBaseLoad_'),
  grabFn('csFieldBaseRec_'),
  grabFn('csPickField_'),
  "var DAYS_JA = ['月','火','水','木','金','土','日'];",
  grabDeclAsVar('CS_STAMP_AT'),
  grabDeclAsVar('CS_STAMP_FP'),
  grabFn('csAuthorFp_'),
  grabFn('csAuthoredAt_'),
  grabFn('csStampAuthored_'),
  grabFn('csPickFieldStamped_'),
  'var csFieldsKept_ = 0;',
  'var csFieldChanges_ = [];',
  grabFn('csFieldChangeText_'),
  grabFn('csLocalReplacedJson_'),
  grabFn('csCountEventsAll_'),
  grabFn('csRebaseEdits'),
  grabDeclAsVar('CS_WRITER_STAMP_KEY'),
  grabDeclAsVar('CS_TAB_ID'),
  grabDeclAsVar('CS_STAMP_FRESH_MS'),
  grabFn('csStampWriter_'),
  grabFn('csPeerIsOldVersion_'),
  grabFn('csNoteOldPeerWrite_'),
  'var _csOldPeerWarned = false;',
  'var _csAbsorbing = false;',
  grabFn('csMergeEventsFrom_'),
  grabFn('csAbsorbForeignWrite_'),
  grabFn('csRestoreAddOnly_'),
  grabDeclAsVar('CS_GENS_KEY'),
  grabDeclAsVar('CS_GENS_MAX'),
  grabDeclAsVar('CS_GENS_BUDGET'),
  grabDeclAsVar('CS_GENS_DAYS'),
  grabFn('csJstDay_'),
  grabFn('csReadGens_'),
  grabFn('csGensFirstOfDay_'),
  grabFn('csGenVictimIndex_'),
  grabFn('csTrimGens_'),
  grabFn('csWriteGens_'),
  grabFn('csPushBackupGen_'),
  grabFn('csEnsureDayAnchor_'),
  grabDeclAsVar('CS_LOCK_KEY'),
  'var BOARD_LOCKED = false;',
  'var _csLockToastAt = 0;',
  grabFn('csApplyBoardLock_'),
  grabFn('csLoadBoardLock_'),
  grabFn('toggleBoardLock'),
  grabFn('csBoardLockedBlock_'),
  grabFn('csEventIdSet_'),
  grabFn('csGenDiff_'),
  grabFn('csApplyRestore_'),
  grabFn('loadCloudHistory_'),
  grabFn('restoreFromCloud_'),
].join('\n'), box);

const R = (s, m) => box.csRebaseEdits(s, m);
const ev = (id, o) => Object.assign({ id, dayOfWeek: 1, serviceType: 'visit', category: '身体１',
  startTime: '08:00', endTime: '08:30', detail: '', notes: '', bathing: false }, o || {});
const withEvents = (evs) => ({ residents: [{ id: 'r1', name: '架空 一郎', events: evs }] });

/* ═══ 1. 3-way の判定本体（純関数）═══ */
group('csPickField_（土台と比べて、どちらの値を採るか）');
eq('土台を知らなければ自分の値（従来動作）',
   box.csPickField_('detail', 'わたし', 'あいて', null), { value: 'わたし', tookServer: false });
eq('土台にそのフィールドが無ければ自分の値',
   box.csPickField_('detail', 'わたし', 'あいて', { category: 'x' }), { value: 'わたし', tookServer: false });
eq('自分が触っていなければ相手の値を残す',
   box.csPickField_('detail', '', 'あいて', { detail: '' }), { value: 'あいて', tookServer: true });
eq('自分が変えていれば自分の値が勝つ',
   box.csPickField_('detail', 'わたし', 'あいて', { detail: '' }), { value: 'わたし', tookServer: false });
eq('両方同じなら何もしない',
   box.csPickField_('detail', '同じ', '同じ', { detail: '同じ' }), { value: '同じ', tookServer: false });
eq('null と空文字は同じ扱い（型で誤判定しない）',
   box.csPickField_('detail', null, 'あいて', { detail: '' }), { value: 'あいて', tookServer: true });

/* ═══ 2. 事故そのものの再現（ワースケが書いた入力を消さない）═══ */
group('csRebaseEdits × 土台（相手の入力を消さない）');
{
  /* 土台＝サーバーと一致していた時点（detail は空・区分は身体１） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(withEvents([ev('e1'), ev('e2')]));

  /* サーバーにはワースケが書いた支援内容と区分が入っている。自分の手元は古いまま。 */
  const server = withEvents([ev('e1'), ev('e2', { detail: '入浴介助', category: '身体２' })]);
  const mine   = withEvents([ev('e1', { startTime: '09:00' }), ev('e2')]);
  box.csFieldsKept_ = 0;
  const out = R(server, mine);
  const e2 = out.residents[0].events.find(e => e.id === 'e2');
  eq('触っていない支援内容は相手の値が残る', e2.detail, '入浴介助');
  eq('触っていないサービス区分も相手の値が残る', e2.category, '身体２');
  eq('残した件数が数えられている（人に知らせるため）', box.csFieldsKept_, 2);
  eq('自分が変えた時刻は自分の値が勝つ',
     out.residents[0].events.find(e => e.id === 'e1').startTime, '09:00');
}
{
  /* 自分が支援内容を書き換えていたら、自分の値が勝つ（相手に負けない） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(withEvents([ev('e1')]));
  const out = R(withEvents([ev('e1', { detail: 'あいての入力' })]),
                withEvents([ev('e1', { detail: 'わたしの入力' })]));
  eq('自分が変えた支援内容は自分が勝つ', out.residents[0].events[0].detail, 'わたしの入力');
}
{
  /* 土台を持たない端末（この版より前から動いている）は従来どおり mine 優先＝挙動不変 */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  const out = R(withEvents([ev('e1', { detail: 'あいて' })]), withEvents([ev('e1', { detail: '' })]));
  eq('土台が無ければ従来どおり自分優先', out.residents[0].events[0].detail, '');
}
{
  /* 既存の守り（入浴の和・server限定イベントの保持）を壊していないこと */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(withEvents([ev('e1')]));
  box.csBathRestored_ = 0;
  const out = R(withEvents([ev('e1', { bathing: true }), ev('e9')]),
                withEvents([ev('e1', { bathing: false })]));
  eq('入浴は従来どおり「和」を取る', out.residents[0].events[0].bathing, true);
  eq('入浴を戻した件数も従来どおり数える', box.csBathRestored_, 1);
  eq('サーバーにしか無い予定は残る', out.residents[0].events.map(e => e.id), ['e1', 'e9']);
}
{
  /* 新規作成した予定（土台に無い）は自分の値のまま＝新規入力が空に化けない */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(withEvents([ev('e1')]));
  const out = R(withEvents([ev('e1')]), withEvents([ev('e1'), ev('新規', { detail: '掃除' })]));
  eq('新規の予定の入力はそのまま残る',
     out.residents[0].events.find(e => e.id === '新規').detail, '掃除');
}

/* ═══ 2-b. 時刻・曜日の巻き戻り（2026-09-07 の事故の再現）═══
   事故の姿: 木曜の訪問を 10:00〜11:00 → 14:00〜15:00 へ変更し、同じ木曜に通所介護を追加して保存した。
   数日後、通所介護は残ったまま訪問だけが 10:00〜11:00 に戻っていた。
   原因: 予定の照合は id 単位で「自分が勝つ」設計だが、3-way の対象が detail と category しか
   なかったため、【自分が触っていない時刻】まで古いスナップショットの値で相手の保存を上書きしていた。
   追加された予定は server 限定なので残る＝「片方だけ戻る」という見え方になる。 */
group('時刻・曜日の巻き戻り（触っていない予定を古い値で上書きしない）');
{
  /* 土台＝この端末が最後に同期した時点（訪問は 10:00〜11:00・通所はまだ無い） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  const stale = ev('eA', { dayOfWeek: 3, startTime: '10:00', endTime: '11:00', category: '生活３' });
  box.csFieldBaseSnapshot_(withEvents([stale]));

  /* サーバー＝本人が時刻を変更し、通所を追加して保存済み */
  const server = withEvents([
    ev('eA', { dayOfWeek: 3, startTime: '14:00', endTime: '15:00', category: '生活３' }),
    ev('eB', { dayOfWeek: 3, serviceType: 'daycare', category: '', startTime: '09:00', endTime: '13:30' }),
  ]);
  /* 手元＝古いスナップショットのまま（この端末は何も触っていない） */
  const mine = withEvents([stale]);

  box.csFieldsKept_ = 0;
  const out = R(server, mine);
  const a = out.residents[0].events.find(e => e.id === 'eA');
  const b = out.residents[0].events.find(e => e.id === 'eB');
  eq('触っていない開始時刻は相手（保存済み）の値が残る', a.startTime, '14:00');
  eq('触っていない終了時刻も相手の値が残る', a.endTime, '15:00');
  eq('あとから足された通所も残る（従来どおり）', b ? b.startTime : null, '09:00');
  eq('残した件数が数えられている', box.csFieldsKept_ >= 2, true);
}
{
  /* 曜日の移動も同じ（木→金へ動かした保存が、古い端末の競合で木へ戻らない） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  const stale = ev('eA', { dayOfWeek: 3 });
  box.csFieldBaseSnapshot_(withEvents([stale]));
  const out = R(withEvents([ev('eA', { dayOfWeek: 4 })]), withEvents([stale]));
  eq('触っていない曜日は相手の値が残る', out.residents[0].events[0].dayOfWeek, 4);
}
{
  /* ★逆向きの守り: 自分が時刻を変えたなら、相手の値には負けない（既存の守りを壊さない） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(withEvents([ev('eA', { startTime: '10:00', endTime: '11:00' })]));
  const out = R(withEvents([ev('eA', { startTime: '08:00', endTime: '09:00' })]),
                withEvents([ev('eA', { startTime: '14:00', endTime: '15:00' })]));
  eq('自分が変えた開始時刻は自分が勝つ', out.residents[0].events[0].startTime, '14:00');
  eq('自分が変えた終了時刻も自分が勝つ', out.residents[0].events[0].endTime, '15:00');
}
{
  /* 土台を持たない端末（この版より前から動いている）は従来どおり自分優先＝挙動不変 */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  const out = R(withEvents([ev('eA', { startTime: '14:00' })]),
                withEvents([ev('eA', { startTime: '10:00' })]));
  eq('土台が無ければ従来どおり自分優先', out.residents[0].events[0].startTime, '10:00');
}
{
  /* サービス種別も同様（触っていなければ相手の値を残す） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  const stale = ev('eA');
  box.csFieldBaseSnapshot_(withEvents([stale]));
  const out = R(withEvents([ev('eA', { serviceType: 'daycare', category: '' })]), withEvents([stale]));
  eq('触っていないサービス種別は相手の値が残る', out.residents[0].events[0].serviceType, 'daycare');
}

/* ═══ 3. 土台を焼く場所（増やすと壊れる）═══ */
group('csFieldBaseBuild_ / Snapshot');
/* ★対象フィールドは CS_MERGE_FIELDS が正。ここを固定値で書くと、フィールドを足した時に
     このテストだけが落ちて「テストが古い」と片付けられ、足し忘れに気づけなくなる。
     一覧そのものを別に固定し、土台の中身は一覧から組み立てて突き合わせる。 */
eq('3-way の対象フィールド一覧（予定の中身は全部・導出値と照合キーは除く）',
   box.CS_MERGE_FIELDS,
   ['detail', 'category', 'startTime', 'endTime', 'dayOfWeek', 'serviceType', 'notes']);
{
  const src = ev('e1', { detail: 'あ', category: '身体２' });
  const want = {};
  box.CS_MERGE_FIELDS.forEach(k => { want[k] = src[k] == null ? '' : String(src[k]); });
  eq('土台は予定id→対象フィールドの対応表',
     box.csFieldBaseBuild_(withEvents([src])), { e1: want });
}
eq('壊れた入力でも落ちない', box.csFieldBaseBuild_(null), {});
eq('events が配列でなくても落ちない',
   box.csFieldBaseBuild_({ residents: [{ id: 'r1', events: 'こわれた' }] }), {});
{
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(withEvents([ev('e1', { detail: 'あ' })]));
  eq('土台は端末へ保存される（再起動後も効く）',
     JSON.parse(box.localStorage.getItem('cs_field_base_v1')).e1.detail, 'あ');
  box.CS_FIELD_BASE = null;
  eq('保存した土台を読み直せる', box.csFieldBaseRec_('e1').detail, 'あ');
}
/* ★静的照合: 土台を焼くのは「サーバーと一致した瞬間」の3か所だけ。
     保存のたびに焼くと自分の編集が土台に混ざり、相手の値を勝たせる誤りになる。 */
/* 焼いてよいのは「サーバーと一致した瞬間」の3経路だけ。増えると自分の編集が土台に混ざる。
   ★push と起動時は【送った内容／サーバーが返した内容】から作る（往復の間の編集を混ぜない）。 */
eq('採用(adopt)は今のDBから焼く', (SRC.match(/csFieldBaseSnapshot_\(DB\)/g) || []).length, 1);
eq('送信成功は「送った内容」から焼く', (SRC.match(/csFieldBaseSet_\(sentBase\)/g) || []).length, 1);
eq('起動時の一致はサーバーが返した内容から焼く',
   (SRC.match(/csFieldBaseSet_\(csFieldBaseBuild_\(j\.data\)\)/g) || []).length, 1);
eq('土台を確定する経路はこの3つだけ',
   (SRC.match(/csFieldBaseSet_\(|csFieldBaseSnapshot_\(/g) || []).length, 6);   /* 定義2 + 呼び出し3 + snapshot内1 */
eq('送信は応答を待つ前に土台を作る（往復中の編集を混ぜない）',
   /csFieldBaseBuild_\(DB\);[\s\S]{0,400}await this\.gas\(\{ action: 'put'/.test(SRC), true);
eq('saveDB は土台を焼かない', /function saveDB\(\)[\s\S]{0,1200}csFieldBaseSnapshot_/.test(SRC), false);

/* ═══ 4. 保存の前に他タブの書き込みを取り込む ═══ */
group('csAbsorbForeignWrite_（自分の保存で相手の書き込みを消さない）');
{
  box.localStorage.clear(); box.CS_FIELD_BASE = null; box.SYNC._dirty = false;
  box._csOldPeerWarned = false; els['cs-oldpeer-warn'] = null;
  const mineJson = JSON.stringify(withEvents([ev('e1')]));
  box.DB = JSON.parse(mineJson);
  box.localStorage.setItem('care_schedule_v2', mineJson);
  box.csRememberLocalFp_(mineJson);
  box.csFieldBaseSnapshot_(box.DB);
  eq('他タブが書いていなければ何もしない', box.csAbsorbForeignWrite_().changed, false);

  /* 他タブ（ワースケ）が支援内容を書き、予定も1件足した */
  const other = withEvents([ev('e1', { detail: '入浴介助' }), ev('e2', { detail: '送迎' })]);
  box.localStorage.setItem('care_schedule_v2', JSON.stringify(other));
  box.csFieldsKept_ = 0;
  const r1 = box.csAbsorbForeignWrite_();
  eq('相手が足した予定を取り込む', r1.gained, 1);
  eq('変わったことを呼び出し元へ返す（往復を止めるため）', r1.changed, true);
  eq('相手が書いた支援内容も残る',
     box.DB.residents[0].events.find(e => e.id === 'e1').detail, '入浴介助');
  eq('取り込んだことを人に知らせる', /別タブの更新を取り込みました/.test(toasts.join('|')), true);
}
{
  /* 未送信中に別タブが書いた＝相手は古い版。動かぬ証拠として警告を出す */
  box.SYNC._dirty = true; box._csOldPeerWarned = false; logs.length = 0;
  const warn = el('cs-oldpeer-warn'); warn.style.display = 'none'; warn.textContent = '';
  box.localStorage.setItem('care_schedule_v2', JSON.stringify(withEvents([ev('e1', { detail: 'x' })])));
  box.csAbsorbForeignWrite_();
  eq('古い版のタブがいることを画面に出す', warn.style.display, '');
  eq('文言は再読み込みを促す', /再読み込み/.test(warn.textContent), true);
  eq('同期ログにも残す', /古い版/.test(logs.join('|')), true);
  box.SYNC._dirty = false;
}
{
  /* 壊れた JSON を掴んでも DB を壊さない（受信データを信じない） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.DB = withEvents([ev('e1')]);
  box.csRememberLocalFp_('{"residents":[]}');
  box.localStorage.setItem('care_schedule_v2', '{こわれた');
  eq('壊れた内容は取り込まない', box.csAbsorbForeignWrite_().changed, false);
  eq('DB は無傷', box.DB.residents[0].events.length, 1);
}
/* ★静的照合: saveDB は「書く前に」取り込む（後ろに置くと自分の書き込みで相手を消してから取り込む） */
{
  const SAVE = grabFn('saveDB');
  eq('saveDB が取り込みを通す', /csAbsorbForeignWrite_\(\)/.test(SAVE), true);
  eq('取り込みは localStorage へ書く前',
     SAVE.indexOf('csAbsorbForeignWrite_') < SAVE.indexOf('localStorage.setItem'), true);
}

/* ═══ 4-2. 取り込みは「予定だけ」（レビュー H-1/H-2/H-3/M-1/M-3）═══ */
group('csMergeEventsFrom_（相手の版に丸ごと乗り換えない）');
{
  const mine = { residents: [{ id: 'r1', name: '架空 一郎', careLevel: '要介護3', copayRate: 2, events: [ev('e1')] }],
                 currentResidentId: 'r1', office: { name: '自分の事業所' },
                 rateMaster: { rev: 5 }, serviceDict: { v: 9 } };
  const other = { residents: [{ id: 'r1', name: '架空 一郎', careLevel: '要介護1', copayRate: 1,
                                events: [ev('e1', { detail: '相手の入力' }), ev('e2')] },
                              { id: 'r2', name: '架空 二郎', events: [ev('e3')] }],
                  currentResidentId: 'r2', office: { name: '相手の事業所' },
                  rateMaster: { rev: 1 }, serviceDict: { v: 1 } };
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  box.csFieldBaseSnapshot_(mine);
  const out = box.csMergeEventsFrom_(other, mine);
  eq('報酬マスタは自分の版のまま（請求の正本を巻き戻さない）', out.rateMaster, { rev: 5 });
  eq('サービス辞書も自分のまま', out.serviceDict, { v: 9 });
  eq('事業所情報も自分のまま', out.office, { name: '自分の事業所' });
  eq('表示中の利用者は自分のまま（取り違え防止）', out.currentResidentId, 'r1');
  eq('介護度など利用者直下の値も自分のまま', [out.residents[0].careLevel, out.residents[0].copayRate], ['要介護3', 2]);
  eq('予定は取り込む', out.residents[0].events.map(e => e.id).sort(), ['e1', 'e2']);
  eq('相手が書いた支援内容も残る', out.residents[0].events.find(e => e.id === 'e1').detail, '相手の入力');
  eq('相手にしか居ない利用者は足す（消失より復活）', out.residents.length, 2);
}
{
  /* 入浴（加算）を戻したら必ず知らせる。黙って加算側へ倒さない（既存規約の継承） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null; box.SYNC._dirty = false;
  const mine = withEvents([ev('e1', { serviceType: 'daycare', bathing: false })]);
  box.DB = JSON.parse(JSON.stringify(mine));
  const mineJson = JSON.stringify(box.DB);
  box.localStorage.setItem('care_schedule_v2', mineJson);
  box.csRememberLocalFp_(mineJson);
  box.csFieldBaseSnapshot_(box.DB);
  box.localStorage.setItem('care_schedule_v2',
    JSON.stringify(withEvents([ev('e1', { serviceType: 'daycare', bathing: true })])));
  toasts.length = 0; logs.length = 0; box.recalcAllEventUnitsCalls = 0;
  const r = box.csAbsorbForeignWrite_();
  eq('入浴を戻した件数を返す', r.bathRestored, 1);
  eq('入浴の復活を画面に出す', /入浴/.test(toasts.join('|')), true);
  eq('同期ログにも残す', /入浴/.test(logs.join('|')), true);
}
{
  /* 区分を相手の値に採ったら単位数を焼き直す（区分と単位の食い違いを他アプリへ流さない） */
  box.localStorage.clear(); box.CS_FIELD_BASE = null;
  const mine = withEvents([ev('e1', { category: '身体１', units: 777 })]);
  box.DB = JSON.parse(JSON.stringify(mine));
  const j2 = JSON.stringify(box.DB);
  box.localStorage.setItem('care_schedule_v2', j2);
  box.csRememberLocalFp_(j2);
  box.csFieldBaseSnapshot_(box.DB);
  box.localStorage.setItem('care_schedule_v2',
    JSON.stringify(withEvents([ev('e1', { category: '身体２', units: 999 })])));
  box.recalcAllEventUnitsCalls = 0;
  const r = box.csAbsorbForeignWrite_();
  eq('区分を採ったら単位数を焼き直す', box.recalcAllEventUnitsCalls, 1);
  eq('採った件数を返す', r.fieldsKept, 1);
}
{
  /* ★取り込み経路（saveDB から呼ばれる本番の入口）でも、守るのは events だけであること。
     ここを csRebaseEdits に戻すと、保存のたびに相手タブの報酬マスタ・表示中の利用者へ乗り換える。 */
  box.localStorage.clear(); box.CS_FIELD_BASE = null; box.SYNC._dirty = false;
  box.DB = { residents: [{ id: 'r1', name: '架空 一郎', careLevel: '要介護3', events: [ev('e1')] }],
             currentResidentId: 'r1', office: { name: '自分の事業所' },
             rateMaster: { rev: 5 }, serviceDict: { v: 9 } };
  const j3 = JSON.stringify(box.DB);
  box.localStorage.setItem('care_schedule_v2', j3);
  box.csRememberLocalFp_(j3);
  box.csFieldBaseSnapshot_(box.DB);
  box.localStorage.setItem('care_schedule_v2', JSON.stringify({
    residents: [{ id: 'r1', name: '架空 一郎', careLevel: '要介護1', events: [ev('e1'), ev('e2')] }],
    currentResidentId: 'rX', office: { name: '相手の事業所' }, rateMaster: { rev: 1 }, serviceDict: { v: 1 } }));
  const r = box.csAbsorbForeignWrite_();
  eq('取り込みで予定は増える', r.gained, 1);
  eq('取り込みで報酬マスタは巻き戻らない', box.DB.rateMaster, { rev: 5 });
  eq('取り込みでサービス辞書も巻き戻らない', box.DB.serviceDict, { v: 9 });
  eq('取り込みで事業所情報も巻き戻らない', box.DB.office, { name: '自分の事業所' });
  eq('取り込みで表示中の利用者は変わらない', box.DB.currentResidentId, 'r1');
  eq('取り込みで介護度も変わらない', box.DB.residents[0].careLevel, '要介護3');
}

group('古い版の判定（名乗りのある相手は警告しない）');
{
  box.localStorage.clear();
  box.SYNC._dirty = true; box._csOldPeerWarned = false;
  const warn = el('cs-oldpeer-warn'); warn.style.display = 'none';
  /* 同じ版の別タブが名乗って書いた場合＝警告しない */
  box.localStorage.setItem('cs_writer_stamp_v1', JSON.stringify({ app: 'care', tab: 'ほかのタブ', at: Date.now() }));
  eq('名乗りのある相手は古くない', box.csPeerIsOldVersion_(), false);
  box.csNoteOldPeerWrite_();
  eq('同じ版の別タブでは警告を出さない', warn.style.display, 'none');
  /* 名乗りが無い＝古い版 */
  box.localStorage.removeItem('cs_writer_stamp_v1');
  eq('名乗りが無ければ古い版', box.csPeerIsOldVersion_(), true);
  box.csNoteOldPeerWrite_();
  eq('古い版なら警告を出す', warn.style.display, '');
  /* 自分の名乗りだけでは「相手が名乗った」ことにならない */
  box._csOldPeerWarned = false; warn.style.display = 'none';
  box.csStampWriter_();
  eq('自分の名乗りは相手の証明にならない', box.csPeerIsOldVersion_(), true);
  /* 古い名乗りは無効（時間切れ） */
  box.localStorage.setItem('cs_writer_stamp_v1', JSON.stringify({ app: 'care', tab: 'ほかのタブ', at: Date.now() - 60000 }));
  eq('古い名乗りは無効', box.csPeerIsOldVersion_(), true);
  box.SYNC._dirty = false;
}

/* ═══ 5. 戻す側（ここに試験が1件も無かった）═══ */
group('csApplyRestore_（復元が今の予定を消さない）');
{
  box.DB = withEvents([ev('now1'), ev('now2')]);
  box.CS_FIELD_BASE = null; box.localStorage.clear();
  box.__undo = box.__recalc = box.__closed = box.__saved = 0; box.__saveOk = true; toasts.length = 0;
  const gen = [{ id: 'r1', name: '架空 一郎', events: [ev('old1'), ev('now1')] }];
  const okRet = box.csApplyRestore_(gen, false, '架空の時刻');
  eq('足すは true を返す', okRet, true);
  eq('控えにしか無い予定が戻る', box.DB.residents[0].events.map(e => e.id).sort(), ['now1', 'now2', 'old1']);
  eq('今ある予定は1件も消えない',
     ['now1', 'now2'].every(id => box.DB.residents[0].events.some(e => e.id === id)), true);
  eq('取り消せるように控えを積む', box.__undo, 1);
  eq('単位数を計算し直す', box.__recalc, 1);
  eq('保存する', box.__saved, 1);
  eq('モーダルを閉じる', box.__closed, 1);
}
{
  /* ★「今の予定は1件も消えません」は件数だけでなく中身も＝今あるコマの内容を控えで塗り替えない */
  box.DB = withEvents([ev('same', { detail: '今日打った内容', startTime: '10:00' })]);
  box.__saveOk = true;
  box.csApplyRestore_([{ id: 'r1', events: [ev('same', { detail: '古い内容', startTime: '08:00' }), ev('old2')] }],
                      false, '架空の時刻');
  const cur = box.DB.residents[0].events.find(e => e.id === 'same');
  eq('今あるコマの支援内容は塗り替えない', cur.detail, '今日打った内容');
  eq('今あるコマの時刻も塗り替えない', cur.startTime, '10:00');
  eq('控えにしか無いコマだけ足す', box.DB.residents[0].events.map(e => e.id).sort(), ['old2', 'same']);
}
{
  /* 丸ごと戻す＝置き換え（今だけにある予定は消える＝確認の文言で必ず件数を見せる前提） */
  box.DB = withEvents([ev('now1')]);
  box.__saved = 0; box.__saveOk = true;
  box.csApplyRestore_([{ id: 'r1', name: '架空 一郎', events: [ev('old1')] }], true, '架空の時刻');
  eq('丸ごと戻すは置き換える', box.DB.residents[0].events.map(e => e.id), ['old1']);
}
{
  /* 保存に失敗したらクラウドへ送らない（壊れた状態を配らない） */
  box.DB = withEvents([ev('now1')]);
  box.__saveOk = false; box.__saved = 0;
  let pushed = 0;
  box.SYNC.hasTarget = () => true; box.SYNC.push = () => { pushed++; };
  const ret = box.csApplyRestore_([{ id: 'r1', events: [ev('old1')] }], false, '架空の時刻');
  eq('保存に失敗したら false', ret, false);
  eq('保存に失敗したら送信しない', pushed, 0);
  box.__saveOk = true; box.SYNC.hasTarget = () => false;
}
{
  /* 空の控えは適用しない（空上書き保護と同じ思想） */
  box.DB = withEvents([ev('now1')]);
  eq('空の控えは適用しない', box.csApplyRestore_([], false, '架空の時刻'), false);
  eq('DB は無傷', box.DB.residents[0].events.length, 1);
}

/* ═══ 5-2. 日ごとの控え（「日ごとに1つは必ず残す」2026-08-31 本人指示）═══ */
group('csTrimGens_（同じ日に何度保存しても前日の姿を捨てない）');
{
  /* 1件あたり 200,000文字＝実データ相当（41名規模）。予算1,200,000 なら6件で満杯。 */
  const big = (day, at, tag) => ({ at: at, day: day, res: 41, ev: 568, json: tag + 'x'.repeat(200000) });
  let gens = [
    big('2026-08-25', 1, 'A'),   // 5日前の「その日の最初」
    big('2026-08-26', 2, 'B'),
    big('2026-08-27', 3, 'C'),
  ];
  /* 今日ぶんを12回保存する（監査が「12回で前日が消えた」と実測した条件） */
  for (let i = 0; i < 12; i++) gens.push(big('2026-08-31', 100 + i, 'T' + i));
  const out = box.csTrimGens_(gens);
  const days = out.map(g => g.day);
  eq('前日までの控えが1日1件ずつ残る',
     ['2026-08-25', '2026-08-26', '2026-08-27'].every(d => days.indexOf(d) >= 0), true);
  eq('最新の1件は必ず残る', out[out.length - 1].json[0] + out[out.length - 1].json[1], 'T1');
  /* 今日ぶんは「その日の最初(T0)」と「最新(T11)」の2件に絞られる＝
     事故の前（今日の始まり）と現在の両方へ戻れる。 */
  eq('今日の控えは「その日の最初」と最新の2件', days.filter(d => d === '2026-08-31').length, 2);
  eq('残った今日ぶんは その日の最初 と 最新',
     out.filter(g => g.day === '2026-08-31').map(g => g.json.slice(0, 3)), ['T0x', 'T11']);
  eq('予算を超えない', out.reduce((n, g) => n + g.json.length, 0) <= 1200000, true);
}
{
  /* 保持日数を超えた古い日から捨てる（新しい日の控えは守る） */
  const big = (day, at) => ({ at: at, day: day, res: 41, ev: 568, json: 'x'.repeat(200000) });
  const gens = [];
  for (let d = 20; d <= 31; d++) gens.push(big('2026-08-' + d, d));   // 12日ぶん＝予算超過
  const out = box.csTrimGens_(gens);
  const days = out.map(g => g.day).sort();
  eq('古い日から捨てる（残るのは新しい側）', days[0] >= '2026-08-26', true);
  eq('最新の日は必ず残る', days[days.length - 1], '2026-08-31');
  eq('予算に収まる件数まで減る', out.length <= 6, true);
}
{
  /* 捨てる順の固定: その日の最初でない控えが先に消える */
  const g = (day, at, tag) => ({ at: at, day: day, res: 1, ev: 1, json: tag + 'y'.repeat(300000) });
  const gens = [g('2026-08-30', 1, 'anchor30'), g('2026-08-30', 2, 'extra30'),
                g('2026-08-31', 3, 'anchor31'), g('2026-08-31', 4, 'latest')];
  const out = box.csTrimGens_(gens);
  const tags = out.map(x => x.json.slice(0, 8));
  eq('その日の最初でない控えから捨てる', tags.indexOf('extra30'), -1);
  eq('前日の「その日の最初」は残る', tags.indexOf('anchor30') >= 0, true);
}
eq('csGensFirstOfDay_ は各日の最初の添字を返す',
   box.csGensFirstOfDay_([{ day: 'A' }, { day: 'A' }, { day: 'B' }, { day: 'B' }]), { A: 0, B: 2 });
eq('日付が無い控えは「その日の最初」に数えない',
   box.csGensFirstOfDay_([{ at: 1 }, { day: 'A' }]), { A: 1 });
eq('捨ててよいものが無ければ -1（最新の日の控えと最新1件は守る）',
   box.csGenVictimIndex_([{ day: 'A', json: 'x' }, { day: 'A', json: 'y' }], false, 1), -1);

{
  /* 小さい施設（容量に余裕がある）でも、持つのは新しい方から CS_GENS_DAYS 日ぶんだけ。
     日ごとの控えで枠を埋め尽くすと、同じ日の途中の姿が1件も残らなくなる。 */
  const small = (day, at) => ({ at: at, day: day, res: 5, ev: 50, json: 'z'.repeat(500) });
  const gens = [];
  for (let d = 15; d <= 26; d++) gens.push(small('2026-08-' + d, d));   // 12日ぶん・合計6KB
  const out = box.csTrimGens_(gens);
  const days = out.map(g => g.day);
  eq('保持日数ぶんの日だけ残る', days.length, 7);
  eq('残るのは新しい側の7日', days[0], '2026-08-20');
  eq('最新の日は必ず残る', days[days.length - 1], '2026-08-26');
}

group('csEnsureDayAnchor_（その日の控えを編集より前に1件作る）');
{
  box.localStorage.clear();
  box.DB = { residents: [{ id: 'r1', name: '架空 一郎', events: [ev('e1')] }] };
  const today = box.csJstDay_(Date.now());
  /* 前日の控えだけがある状態＝今日の控えが無い */
  box.localStorage.setItem('cs_backup_gens_v1', JSON.stringify([
    { at: 1, day: '2026-01-01', res: 1, ev: 1, json: JSON.stringify(box.DB.residents) }]));
  box.csEnsureDayAnchor_();
  let gens = box.csReadGens_();
  eq('今日の控えが作られる', gens.length, 2);
  eq('内容が前日と同じでも作る（日付の付いた控えが無い日を作らない）', gens[1].day, today);
  /* 2回呼んでも増えない */
  box.csEnsureDayAnchor_();
  gens = box.csReadGens_();
  eq('今日の控えが既にあれば増やさない', gens.length, 2);
}
{
  /* 通常の保存は「内容が同じなら積まない」ままであること（同じ姿で埋め尽くさない） */
  box.localStorage.clear();
  box.DB = { residents: [{ id: 'r1', name: '架空 一郎', events: [ev('e1')] }] };
  box.csPushBackupGen_();
  box.csPushBackupGen_();
  eq('同じ内容は積まない', box.csReadGens_().length, 1);
  box.csPushBackupGen_(true);
  eq('force のときだけ同じ内容でも積む', box.csReadGens_().length, 2);
}
{
  /* 容量エラーでも、捨てるのは「その日の最初でない控え」から */
  const realSet = box.localStorage.setItem;
  const kept = [];
  box.localStorage.clear();
  let allow = 1;   // 1回目の書き込みは必ず失敗させる
  box.localStorage.setItem = (k, v) => {
    if (k === 'cs_backup_gens_v1' && allow-- > 0) { const e = new Error('QuotaExceededError'); throw e; }
    realSet(k, v);
  };
  const g = (day, at, tag) => ({ at: at, day: day, res: 1, ev: 1, json: tag });
  const ok = box.csWriteGens_([g('2026-08-30', 1, 'anchor30'), g('2026-08-30', 2, 'extra30'),
                               g('2026-08-31', 3, 'latest')]);
  box.localStorage.setItem = realSet;
  const saved = box.csReadGens_().map(x => x.json);
  eq('容量エラーでも書き込みは成功する', ok, true);
  eq('容量エラーで捨てるのは「その日の最初でない控え」', saved, ['anchor30', 'latest']);
}

/* ═══ 5-3. 盤面ロック（触るつもりが無いのに枠が動く事故を止める・2026-08-31 本人指示）═══ */
group('盤面ロック');
{
  box.localStorage.clear();
  box.BOARD_LOCKED = false;
  els['board-lock-btn'] = null;
  const btn = el('board-lock-btn');
  toasts.length = 0;

  eq('既定は解除＝これまでどおり動かせる', box.csBoardLockedBlock_(), false);

  box.toggleBoardLock();
  eq('押すとロックになる', box.BOARD_LOCKED, true);
  eq('ロック中は操作を止める', box.csBoardLockedBlock_(), true);
  eq('止めた理由と解除方法を出す（黙って効かないUIにしない）',
     /ロック中/.test(toasts.join('|')) && /解除/.test(toasts.join('|')), true);
  eq('端末に覚える（再読み込みで解除されない）', box.localStorage.getItem('cs_board_lock_v1'), '1');
  eq('ボタンの表示が変わる', btn.textContent, '🔒 ロック中');
  eq('読み上げにも状態を伝える', btn.getAttribute('aria-pressed'), 'true');
  eq('見た目でも分かる（色のクラス）', btn.classList.contains('on'), true);
  eq('画面全体にもロックの印を付ける', box.document.body.classList.contains('board-locked'), true);

  /* トーストは連打で溢れさせない（1.5秒に1回） */
  toasts.length = 0;
  box._csLockToastAt = 0;                      // 直前の案内から1.5秒経った状態にする
  box.csBoardLockedBlock_(); box.csBoardLockedBlock_(); box.csBoardLockedBlock_();
  eq('連打してもトーストは1回', toasts.length, 1);

  box.toggleBoardLock();
  eq('もう一度押すと解除', box.BOARD_LOCKED, false);
  eq('解除も端末に覚える', box.localStorage.getItem('cs_board_lock_v1'), '0');
  eq('解除したら止めない', box.csBoardLockedBlock_(), false);
  eq('ボタンの表示も戻る', btn.textContent, '🔓 移動ロック');
  eq('画面の印も外れる', box.document.body.classList.contains('board-locked'), false);
}
{
  /* 起動時に状態を戻す（dev-principles 原則11：再読み込みで現在地を失わない） */
  box.localStorage.clear();
  box.localStorage.setItem('cs_board_lock_v1', '1');
  box.BOARD_LOCKED = false;
  box.csLoadBoardLock_();
  eq('起動時にロックを戻す', box.BOARD_LOCKED, true);
  box.localStorage.setItem('cs_board_lock_v1', '0');
  box.csLoadBoardLock_();
  eq('解除の状態も戻す', box.BOARD_LOCKED, false);
  box.localStorage.removeItem('cs_board_lock_v1');
  box.csLoadBoardLock_();
  eq('覚えが無ければ解除（これまでどおり）', box.BOARD_LOCKED, false);
  /* 業務データを覚えないこと（原則11の但し書き・氏名や予定は保存しない） */
  eq('覚えるのは 0/1 だけ', /^(0|1)?$/.test(box.localStorage.getItem('cs_board_lock_v1') || ''), true);
}
/* ★静的照合: 止める場所は「入口」ではなく操作の本体。ここが外れると事故が戻る。 */
{
  const MOVE = grabFn('startMove'), RESIZE = grabFn('startResize');
  eq('ドラッグ移動を止める', /csBoardLockedBlock_\(\)/.test(MOVE), true);
  eq('時間の伸縮を止める', /csBoardLockedBlock_\(\)/.test(RESIZE), true);
  eq('移動は drag を作る前に止める',
     MOVE.indexOf('csBoardLockedBlock_') < MOVE.indexOf('drag = {'), true);
  eq('伸縮も drag を作る前に止める',
     RESIZE.indexOf('csBoardLockedBlock_') < RESIZE.indexOf('drag = {'), true);
  eq('空き枠のタップからの追加も止める',
     /csBoardLockedBlock_\(\)\) return;[\s\S]{0,300}openAddModal/.test(SRC), true);
  eq('長押し・右クリックのメニューも止める',
     /csBoardLockedBlock_\(\)\) return;[\s\S]{0,120}showCtxMenu/.test(SRC), true);
  /* ★止めてはいけないもの: 保存・同期・印刷・復元（ロックは「動かさない」だけ） */
  eq('保存はロックに影響されない', /csBoardLockedBlock_/.test(grabFn('saveDB')), false);
  eq('復元もロックに影響されない', /csBoardLockedBlock_/.test(grabFn('csApplyRestore_')), false);
  eq('起動時に状態を戻す配線がある', /csLoadBoardLock_\(\);/.test(SRC), true);
  /* 印刷CSSの中にロックの見た目を入れていない（紙は不変） */
  eq('印刷指定の中にロックの見た目を入れない',
     /@media print[\s\S]{0,4000}board-locked/.test(SRC), false);
}

/* ═══ 6. クラウドの履歴から戻す（サーバーの30世代＋日次を人が使えるようにした経路）═══ */
group('loadCloudHistory_ / restoreFromCloud_');
{
  const cbox = el('restore-cloud');
  box.SYNC.hasTarget = () => true;
  box.SYNC.gas = async () => ({ ok: true, generations: [
    { rev: 12, savedAt: '2026-08-30T02:00:00.000Z', bytes: 20480 },
    { day: '2026-08-30', savedAt: '2026-08-30T00:10:00.000Z', bytes: 20000 },
  ] });
  (async () => {
    await box.loadCloudHistory_();
    {
      eq('世代が一覧に出る', (cbox.innerHTML.match(/この版から戻す/g) || []).length, 2);
      eq('日次も一覧に出る', /日次 2026-08-30/.test(cbox.innerHTML), true);

      /* サーバーが history を知らない旧版なら、理由を出す（黙って空にしない） */
      box.SYNC.gas = async () => ({ ok: false, error: 'unknown action' });
      await box.loadCloudHistory_();
      eq('旧GASなら理由を出す', /planhistory/.test(cbox.innerHTML), true);

      /* 実際に戻す＝足す（今ある予定は消えない） */
      box.DB = withEvents([ev('now1')]);
      box.CS_FIELD_BASE = null;
      box.__saved = 0; box.__saveOk = true; box.__answerConfirm = true; confirms.length = 0;
      box.SYNC.gas = async () => ({ ok: true, rev: 12, updatedAt: '2026-08-30T02:00:00.000Z',
        data: withEvents([ev('old1'), ev('now1')]) });
      await box.restoreFromCloud_(null, 12);
      eq('確認してから戻す', confirms.length, 1);
      eq('確認文に件数を出す', /戻せる予定：1件/.test(confirms[0]), true);
      eq('クラウドの版から足せる', box.DB.residents[0].events.map(e => e.id).sort(), ['now1', 'old1']);

      /* 断ったら何もしない */
      box.DB = withEvents([ev('now1')]);
      box.__answerConfirm = false;
      await box.restoreFromCloud_(null, 12);
      eq('キャンセルしたら変えない', box.DB.residents[0].events.map(e => e.id), ['now1']);
      box.__answerConfirm = true;

      /* 差が無ければ何も聞かない */
      box.DB = withEvents([ev('now1')]);
      confirms.length = 0;
      box.SYNC.gas = async () => ({ ok: true, rev: 12, data: withEvents([ev('now1')]) });
      await box.restoreFromCloud_(null, 12);
      eq('差が無ければ確認も出さない', confirms.length, 0);

      /* 読めない応答は適用しない */
      box.DB = withEvents([ev('now1')]);
      box.SYNC.gas = async () => ({ ok: false, error: 'no such generation' });
      await box.restoreFromCloud_(null, 99);
      eq('読めない版は適用しない', box.DB.residents[0].events.map(e => e.id), ['now1']);

      /* ═══ 9. 著者印＝週間計画で入力した区分・支援内容を外部の書き込みから守る（2026-09-12）═══
         実害: ワークスケジュールが持っていた6月の支援マスタ由来の値が週間計画へ書き戻され、
         (月)生活３→身体１生活１ /(金)(日)生活２→身体０１ /「デイ/返却」→「返却」に化けた。
         週間計画の3-wayは「自分が触っていない欄は相手を採る」ため、外部の上書きを新しい入力と
         誤認して受け入れていた。ここでは「人がこの画面で入力した値が勝つ」ことを固定する。 */
      group('著者印（csStampAuthored_ / csAuthoredAt_ / csPickFieldStamped_）');
      {
        const now = 1757000000;
        /* 押す */
        const e0 = box.csStampAuthored_(null, { category: '生活３', detail: 'デイ/返却' }, now);
        eq('新規入力は区分にも支援内容にも印が付く', [e0.catAt, e0.detAt], [now, now]);
        eq('印には値の指紋が添う', e0.catFp, box.csAuthorFp_('生活３'));
        eq('押した印はそのまま読める', box.csAuthoredAt_(e0, 'category'), now);

        /* 値を変えなければ印は持ち越し、変えた欄だけ新しくなる */
        const e1 = box.csStampAuthored_(e0, Object.assign({}, e0, { detail: 'デイ/返却・掃除' }), now + 60);
        eq('触っていない区分の印は持ち越す', e1.catAt, now);
        eq('変えた支援内容の印は新しくなる', e1.detAt, now + 60);

        /* 印を残したまま値だけ書き換えた相手（＝ワースケ型の書き戻し）は無印として扱う */
        const forged = Object.assign({}, e0, { category: '身体０１' });   /* catFp は生活３のまま */
        eq('印の後で値だけ書き換えられていたら無印', box.csAuthoredAt_(forged, 'category'), 0);

        /* 判定本体 */
        eq('自分の印が新しければ自分の入力を守る',
           box.csPickFieldStamped_('category',
             { category: '生活３', catAt: now, catFp: box.csAuthorFp_('生活３') },
             { category: '身体０１' }, { category: '生活３' }).value, '生活３');
        eq('相手の印が新しければ相手の入力を採る（他端末で人が直した）',
           box.csPickFieldStamped_('category',
             { category: '生活３', catAt: now, catFp: box.csAuthorFp_('生活３') },
             { category: '生活２', catAt: now + 1, catFp: box.csAuthorFp_('生活２') },
             { category: '生活３' }).value, '生活２');
        /* ★土台判定だけでは足りない場合を固定する（土台と自分の値が違う＝自分も編集済みでも、
           相手の印の方が新しければ相手を採る）。この行が無いと、他端末の新しい入力を握り潰す。 */
        eq('自分も編集済みでも、相手の印が新しければ相手を採る',
           box.csPickFieldStamped_('category',
             { category: '生活３', catAt: now, catFp: box.csAuthorFp_('生活３') },
             { category: '生活２', catAt: now + 1, catFp: box.csAuthorFp_('生活２') },
             { category: '身体０１' }).value, '生活２');
        eq('印が無い同士は従来の土台判定のまま',
           box.csPickFieldStamped_('detail', { detail: '' }, { detail: 'ワースケの入力' },
             { detail: '' }), { value: 'ワースケの入力', tookServer: true, at: 0 });
        eq('印の対象外フィールドは従来どおり',
           box.csPickFieldStamped_('startTime', { startTime: '08:00' }, { startTime: '09:00' },
             { startTime: '08:00' }).value, '09:00');
      }

      /* 事故そのものの再現（マージ経由） */
      group('著者印 × csRebaseEdits（ワースケ型の上書きを弾く）');
      {
        const now = 1757000000;
        box.localStorage.clear(); box.CS_FIELD_BASE = null;
        const mineEv = box.csStampAuthored_(null,
          ev('e1', { category: '生活３', detail: 'デイ/返却' }), now);
        const mine = withEvents([mineEv]);
        /* 土台＝クラウドと一致していた時点（＝自分は触っていない、と判定される状態） */
        box.csFieldBaseSnapshot_(mine);
        /* ワースケが書き戻した版：値だけ6月マスタのものへ変わり、印は据え置き */
        const server = withEvents([Object.assign({}, mineEv,
          { category: '身体１生活１', detail: '返却' })]);
        box.csFieldsKept_ = 0; box.csFieldChanges_ = [];
        const out = R(server, mine);
        const got = out.residents[0].events[0];
        eq('区分は週間計画の入力のまま', got.category, '生活３');
        eq('支援内容も週間計画の入力のまま', got.detail, 'デイ/返却');
        eq('相手の値を採った件数は0', box.csFieldsKept_, 0);
        eq('守った値の印はそのまま残る', [got.catAt, got.catFp], [now, box.csAuthorFp_('生活３')]);

        /* 逆向き：他端末で人が直した（印が新しい）なら採る */
        const newer = withEvents([box.csStampAuthored_(mineEv,
          Object.assign({}, mineEv, { category: '生活２' }), now + 100)]);
        box.csFieldsKept_ = 0; box.csFieldChanges_ = [];
        const out2 = R(newer, mine);
        eq('他端末の新しい入力は採る', out2.residents[0].events[0].category, '生活２');
        eq('変わった中身を控えている', box.csFieldChanges_.length, 1);
        eq('中身は人が読める形', box.csFieldChangeText_(), '火 08:00 区分 生活３→生活２');
        eq('採った値の印も持ち越す',
           [out2.residents[0].events[0].catAt, out2.residents[0].events[0].catFp],
           [now + 100, box.csAuthorFp_('生活２')]);
      }

      /* 入力の経路が印を押し続けることを本体のソースで固定する（ここが外れると印が付かず、
         判定だけ残って守れなくなる。画面まわりは DOM 依存で読み込めないためソースで見る）。 */
      group('入力の3経路が著者印を押している（ソース検査）');
      {
        /* saveEvent は【更新】と【新規】の2か所。片方だけ外れても気づけるよう回数で見る。 */
        const count = (fn) => (grabFn(fn).match(/csStampAuthored_\s*\(/g) || []).length;
        eq('saveEvent は更新と新規の2か所で押す', count('saveEvent'), 2);
        eq('duplicateEvent で押す', count('duplicateEvent'), 1);
        eq('applyBulkImport で押す', count('applyBulkImport'), 1);
      }

      /* ★書き込み経路を増やしていないこと（history は読むだけ） */
      eq('history を書き込みに使っていない',
         /action: 'history'[\s\S]{0,400}force/.test(SRC), false);

      process.stdout.write(ng ? ('\n✗ 合格 ' + ok + ' / 不合格 ' + ng + '\n')
                              : ('\n✓ 合格 ' + ok + ' / 不合格 0\n'));
      process.exit(ng ? 1 : 0);
    }
  })().catch(e => { process.stdout.write('✗ 例外: ' + (e && e.stack || e) + '\n'); process.exit(1); });
}
