/* 未送信の一覧の読み取り（unsent-calc.js）と画面・メニューの札の試験（代表者の決定 2026-11-14【訂正】）
   実行: node check/unit/unsent_calc_test.js
   守ること:
     A 種類ごとに、各画面が今すでに残している控えの形から件数・いちばん古い時刻・1件ずつの日付と種類を読む
     B 控えに氏名・病名・記録の本文・入居者の番号が入っていても、返す値のどこにも出ない
     C 控えを書き換えない・消さない（setItem・removeItem・clear を一度も呼ばない）
     D 現場の端末では1件ずつを返さず、事務所向けの画面（入居調整）の控えは読みもしない。事務所PCでも入居調整の控えは、
       事務所・管理者としてログインしていると確かめた時だけ読む（§2.7・反証レビュー 2026-11-14）
     E 崩れた控え・読めない保存領域は「確かめられません」（bad）で、ほかの種類は読み続ける
     F メニューの札: 一覧の画面が数え終えた時に件数と数えた日だけの鍵（unsent_menu_due）を書き（現場の端末・読めない時は書かない）、
       メニューは数える部品も各画面の控えも読まず、ほかの札と同じ道（dueText・dueBadge）でその鍵だけを読む（代表者の決定 2026-11-14）
     G 画面（unsent.html・unsent.js）: 文字は textContent だけ・通信しない・書くのは件数の鍵だけ・印刷しない・公開の許可・メニューの入口
   架空データだけを使う。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const raw = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* コメントを除いたコード（説明文の語で見張りが誤って落ちないように） */
const code = (f) => raw(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
let pass = 0, fail = 0;
const pending = [];   // 非同期の確かめ（最後にまとめて待つ）
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

function load() {
  const win = {};
  const ctx = { window: win, Date, JSON, Object, Array, String, Number, isFinite, SyntaxError, Error };
  vm.createContext(ctx);
  vm.runInContext(raw('unsent-calc.js'), ctx);
  return win.SUUnsent;
}
/* 読むだけの保存領域。書く・消す操作は記録して落とす。reads は読んだ鍵 */
function store(obj, opts) {
  const o = opts || {};
  const calls = [], reads = [];
  return {
    calls, reads,
    getItem(k) { reads.push(k); if (o.throwOn === k) throw new Error('denied'); return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : null; },
    setItem(k) { calls.push(['set', k]); throw new Error('書いてはいけない'); },
    removeItem(k) { calls.push(['remove', k]); throw new Error('消してはいけない'); },
    clear() { calls.push(['clear']); throw new Error('消してはいけない'); },
    get length() { return Object.keys(obj).length; },
    key(i) { return Object.keys(obj)[i] === undefined ? null : Object.keys(obj)[i]; }
  };
}
const U = load();
t('部品を読める', !!U && typeof U.collect === 'function' && typeof U.total === 'function');

/* 架空の控え（氏名・病名・本文は架空。記号的な名前） */
const NAME = '甲野乙子', DIS = '架空病名A', BODY = '架空の記録の本文', RID = 'R-9901';
const T1 = Date.UTC(2026, 10, 10, 1, 0), T2 = Date.UTC(2026, 10, 12, 3, 30), T3 = Date.UTC(2026, 10, 13, 5, 0);
const iso = (ms) => new Date(ms).toISOString();
const admDb = { v: 2, updatedAt: '', candidates: [{ id: 'c1', name: NAME, note: DIS + BODY }] };
const LOCAL = {
  su_device_role: 'office',
  wtmgr_pq_v1: JSON.stringify([
    { action: 'saveRecord', data: { record: { id: 'w1', residentName: NAME, memo: BODY } }, at: T2 },
    { action: 'saveResident', data: { resident: { id: RID, name: NAME, disease: DIS } }, at: T1 },
    { action: 'mysteryAction', data: {}, at: 'これは時刻ではない' },
    { action: 'delRecord', data: { id: 'w0', by: NAME }, at: T3 }
  ]),
  apc2_sync_q: JSON.stringify({ v: 1, q: { [RID]: iso(T2), 'R-9902': iso(T3) } }),
  apc2_sync_ng: JSON.stringify({ v: 1, r: { [RID]: { e: 'denied', at: iso(T2), t: iso(T3) } } }),
  'genogram:pendingSync': JSON.stringify([
    { kind: 'save', name: NAME, doc: { clientName: NAME, memo: BODY }, queuedAt: iso(T3), rid: RID },
    { kind: 'delete', name: NAME, queuedAt: iso(T1) }
  ]),
  care_schedule_dirty_v1: '1',
  ws_dirty_v1: JSON.stringify({ days: { '2026-11-14': T2, '2026-11-15': T3 } }),
  ws_alt_pending_v2: JSON.stringify({ '2026-11-14|ab12': { date: '2026-11-14', id: 'ab12', seq: 3, at: iso(T1), board: { staff: [NAME], note: BODY } } }),
  ws_master_unsent_v1: '1',
  ws_care_ops_v1: JSON.stringify({ seq: 5, ops: [{ t: 'detail', id: RID, text: BODY, q: 4, ts: T2 }, { t: 'svc', id: RID, q: 5, ts: T3 }] }),
  ['shiftapp:v1:local:conflictRescue:sched:2026-10:' + T1]: '\u0001縮めた中身',
  ['shiftapp:v1:local:importRescue:req:' + NAME + ':' + T2]: '\u0001縮めた中身',
  'shiftapp:v1:_meta': '\u0001圧縮された中身',
  admf_cache: JSON.stringify({ db: admDb, rev: 12, dirty: true, at: iso(T2) }),
  wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { residentName: NAME } }, at: T1 }]),
  su_kv_mirror_pending: JSON.stringify({ care_schedule_v2: T3 })
};
const SESSION = { spl_pending: JSON.stringify([{ id: 'm1', date: '2026-11-13', itemId: 'it_x', type: 'out', note: NAME + BODY, residentNo: RID }]) };

console.log('A 種類ごとの読み取り');
const ls = store(LOCAL), ss = store(SESSION);
const rows = U.collect({ local: ls, session: ss, detail: true, admission: true });
const by = Object.fromEntries(rows.map((r) => [r.id, r]));
t('全部の種類が返る（事務所の端末）', ['weight', 'patch', 'genogram', 'care', 'ws-day', 'ws-alt', 'ws-care', 'ws-master', 'shift', 'shift-rescue', 'admission', 'supplies', 'weight-mirror', 'kv-mirror'].every((k) => by[k]), Object.keys(by));
t('体重管理: 4件・いちばん古いのは T1・種類の名前は決まった語（削除は delRecord）', by.weight.n === 4 && by.weight.oldest === T1 && JSON.stringify(by.weight.items.map((i) => i.label)) === JSON.stringify(['入居者の情報', '体重の記録', '体重の記録の削除', 'そのほかの変更']), by.weight.items);
t('体重管理: 時刻でない値は時刻なし（null）', by.weight.items[3].at === null);
t('ワークスケジュール（週間計画の変更）: 2件・記録した時刻', by['ws-care'].n === 2 && by['ws-care'].oldest === T2 && by['ws-care'].items.every((i) => i.label === '週間計画の変更'), by['ws-care']);
t('シフト作成（退避した編集）: 鍵の名前だけで2件・退避した時刻・自動では送らない組（held）', by['shift-rescue'].n === 2 && by['shift-rescue'].group === 'held' && by['shift-rescue'].oldest === T1 && by['shift-rescue'].items.some((i) => i.label === '競合解決前の勤務表' && i.day === '2026-10') && by['shift-rescue'].items.some((i) => i.label === '取込前の希望休' && i.day === ''), by['shift-rescue']);
t('貼り薬: 2件・断られた記録のある方は印つき', by.patch.n === 2 && by.patch.oldest === T2 && by.patch.items.some((i) => i.label === '貼り薬の設定（断られた記録あり）') && by.patch.items.some((i) => i.label === '貼り薬の設定'), by.patch);
t('家族構成図: 2件・保存と削除', by.genogram.n === 2 && by.genogram.oldest === T1 && by.genogram.items.map((i) => i.label).sort().join() === ['図の保存', '図の削除'].sort().join(), by.genogram);
t('家族構成図: 開いただけでは送らない種類（ボタンは確かめる・文は［↻ 同期］）', by.genogram.check === true && /［↻ 同期］を押すと送り直します/.test(by.genogram.why));
{
  const g = U.collect({ local: store({ 'genogram:pendingSync': JSON.stringify([{ kind: 'save', name: NAME, queuedAt: iso(T1), conflict: true }, { kind: 'save', name: '乙', queuedAt: iso(T2) }]) }), session: store({}), detail: true }).find((r) => r.id === 'genogram');
  t('家族構成図: 食い違いの印の付いた保留は別に数え、人が選ぶ必要があると分かる名前にする', g.n === 2 && g.conflict === 1 && g.items.some((i) => /食い違い・どちらを残すか人が選ぶ必要があります/.test(i.label)) && g.items.every((i) => !('conflict' in i)), g);
}
t('週間計画: 印があれば1件・時刻なし', by.care.n === 1 && by.care.oldest === null && by.care.state === 'some');
t('ワークスケジュール（日ごと）: 2件・対象の日', by['ws-day'].n === 2 && by['ws-day'].items.map((i) => i.day).join() === '2026-11-14,2026-11-15', by['ws-day']);
t('ワークスケジュール（控えの案）: 1件・対象の日・時刻', by['ws-alt'].n === 1 && by['ws-alt'].items[0].day === '2026-11-14' && by['ws-alt'].oldest === T1);
t('ワークスケジュール（支援マスタ）: 印があれば1件', by['ws-master'].n === 1);
t('シフト作成: 縮めた控えは「確かめられません」（数えない）', by.shift.state === 'unknown' && by.shift.n === null);
t('入居調整: 未送信の印があれば1件・控えた時刻', by.admission.n === 1 && by.admission.oldest === T2, by.admission);
t('消耗品管理: タブの中の控えから1件・出庫・対象の日', by.supplies.n === 1 && by.supplies.items[0].label === '出庫' && by.supplies.items[0].day === '2026-11-13' && by.supplies.session === true);
t('写し返しは別の組（mirror）', by['weight-mirror'].group === 'mirror' && by['kv-mirror'].group === 'mirror' && by['weight-mirror'].n === 1 && by['kv-mirror'].n === 1);
t('1件ずつは古い順（時刻なしは後ろ）', by.weight.items.map((i) => i.at).join() === [T1, T2, T3, null].join());
{
  const plain = U.collect({ local: store({ 'shiftapp:v1:_meta': JSON.stringify({ revs: {}, dirty: {}, queue: { 'sched:2026-11': { baseRev: 3, queuedAt: T2 }, staff: { baseRev: 1, queuedAt: T1 }, ['req:' + NAME]: { queuedAt: T3 } } }) }), session: store({}), detail: true });
  const sh = plain.find((r) => r.id === 'shift');
  t('シフト作成: 縮めていない控えは送信の列から数える・勤務表は月だけ', sh.n === 3 && sh.oldest === T1 && sh.items.some((i) => i.label === '勤務表' && i.day === '2026-11') && sh.items.some((i) => i.label === '職員'), sh);
  t('シフト作成: 鍵の後ろが月でない時は対象を出さない（鍵の名前をそのまま出さない）', JSON.stringify(sh).indexOf(NAME) < 0 && sh.items.some((i) => i.label === '希望休' && i.day === ''), sh.items);
}
{
  const r = U.collect({ local: store({ admf_cache: JSON.stringify({ db: admDb, rev: 3, dirty: false, at: iso(T1) }), wtmgr_pq_v1: '[]', care_schedule_dirty_v1: null }), session: store({}), admission: true });
  t('未送信の無い控え・空の列は「なし」', r.find((x) => x.id === 'admission').state === 'none' && r.find((x) => x.id === 'weight').state === 'none' && r.find((x) => x.id === 'care').state === 'none');
}

console.log('\nB 氏名・病名・本文・番号が出ない');
{
  const all = JSON.stringify(rows);
  t('返す値に氏名が無い', all.indexOf(NAME) < 0);
  t('返す値に病名・本文が無い', all.indexOf(DIS) < 0 && all.indexOf(BODY) < 0);
  t('返す値に入居者の番号が無い', all.indexOf(RID) < 0 && all.indexOf('R-9902') < 0 && all.indexOf('w0') < 0);
  t('1件ずつの欄は at・day・label だけ', rows.every((r) => r.items.every((i) => JSON.stringify(Object.keys(i).sort()) === JSON.stringify(['at', 'day', 'label']))));
}

console.log('\nC 控えを書き換えない・消さない');
t('事務所の端末で読んでも書く・消すを一度も呼ばない', ls.calls.length === 0 && ss.calls.length === 0, ls.calls.concat(ss.calls));
{
  const before = JSON.stringify(LOCAL);
  U.collect({ local: store(LOCAL), session: store(SESSION), detail: true });
  U.total({ local: store(LOCAL), session: store(SESSION) });
  t('控えの中身はそのまま', JSON.stringify(LOCAL) === before);
}
t('部品のコードに setItem・removeItem・clear・fetch が無い', !/setItem|removeItem|\.clear\(|fetch\(|XMLHttpRequest|sendBeacon/.test(code('unsent-calc.js')));

console.log('\nD2 入居調整は事務所・管理者のログインを確かめた時だけ読む（§2.7）');
{
  const l1 = store(LOCAL);
  const r1 = U.collect({ local: l1, session: store(SESSION), detail: true }).find((r) => r.id === 'admission');
  t('確かめていない時は読まずに「確かめられません」', r1.state === 'unknown' && r1.n === null && l1.reads.indexOf('admf_cache') < 0 && /この画面では確かめられません/.test(r1.why), r1);
  const l2 = store(LOCAL);
  const r2 = U.collect({ local: l2, session: store(SESSION), admission: 'yes' }).find((r) => r.id === 'admission');
  t('真（true）以外の印では読まない', r2.state === 'unknown' && l2.reads.indexOf('admf_cache') < 0);
}
console.log('\nD 現場の端末');
{
  const fl = store(Object.assign({}, LOCAL, { su_device_role: 'field' })), fs2 = store(SESSION);
  const fr = U.collect({ local: fl, session: fs2, detail: true });
  t('現場の端末では1件ずつを返さない（件数といちばん古い時刻だけ）', fr.every((r) => r.items.length === 0) && fr.find((r) => r.id === 'weight').n === 4 && fr.find((r) => r.id === 'weight').oldest === T1);
  t('現場の端末では入居調整の控えを読まない・一覧にも出さない', fl.reads.indexOf('admf_cache') < 0 && !fr.some((r) => r.id === 'admission'), fl.reads);
  t('現場の端末でも書く・消すを呼ばない', fl.calls.length === 0 && fs2.calls.length === 0);
  t('現場の端末の合計は入居調整を数えない（4+2+2+1+2+1+2+1+1=16）', U.total({ local: store(Object.assign({}, LOCAL, { su_device_role: 'field' })), session: store(SESSION) }) === 16);
}

console.log('\nE 崩れた控え');
{
  const bad = store({
    wtmgr_pq_v1: '{壊れた', apc2_sync_q: JSON.stringify({ v: 1, q: [] }), 'genogram:pendingSync': JSON.stringify({ a: 1 }),
    care_schedule_dirty_v1: 'yes', ws_dirty_v1: JSON.stringify({ days: [1] }), ws_alt_pending_v2: JSON.stringify({ k: 5 }),
    ws_master_unsent_v1: '2', ws_care_ops_v1: JSON.stringify({ ops: 'x' }), 'shiftapp:v1:_meta': '[', admf_cache: '{"db":{}}', wtmgr_mirror_q: JSON.stringify([1]), su_kv_mirror_pending: '[]'
  });
  const br = U.collect({ local: bad, session: store({ spl_pending: '"x"' }), detail: true, admission: true });
  const want = ['weight', 'patch', 'genogram', 'care', 'ws-day', 'ws-alt', 'ws-care', 'ws-master', 'shift', 'admission', 'supplies', 'weight-mirror', 'kv-mirror'];
  t('崩れた控えはどれも「確かめられません」（bad）・件数なし', want.every((k) => { const r = br.find((x) => x.id === k); return r && r.state === 'bad' && r.n === null && r.items.length === 0; }), br.map((r) => [r.id, r.state]));
  t('崩れていても書く・消すを呼ばない', bad.calls.length === 0);
  const thr = U.collect({ local: store(LOCAL, { throwOn: 'wtmgr_pq_v1' }), session: store(SESSION) });
  t('読めない鍵は bad・ほかの種類は読み続ける', thr.find((r) => r.id === 'weight').state === 'bad' && thr.find((r) => r.id === 'genogram').n === 2);
  const none = U.collect({ local: null, session: null, admission: true });
  t('保存領域が無い時は全部 bad（例外を外に出さない）', none.length > 0 && none.every((r) => r.state === 'bad'));
  t('合計は読めない時 0', U.total({ local: null, session: null }) === 0);
  const pa = U.collect({ local: store({ apc2_sync_q: JSON.stringify({ v: 1, q: { x: iso(T1) } }), apc2_sync_ng: '{壊れた' }), session: store({}) }).find((r) => r.id === 'patch');
  t('貼り薬: 断りの記録が崩れていても送信待ちは数える', pa.state === 'some' && pa.n === 1);
  const fut = U.collect({ local: store({ wtmgr_pq_v1: JSON.stringify([{ action: 'saveRecord', at: 9e15 }, { action: 'saveRecord', at: -5 }]) }), session: store({}) }).find((r) => r.id === 'weight');
  t('範囲の外の時刻は時刻なし', fut.n === 2 && fut.oldest === null);
}

console.log('\nF メニューの札の件数の鍵（代表者の決定 2026-11-14・メニューは控えを読まない）');
t('合計は写し返し・退避した編集・数えられない種類を数えない（4+2+2+1+2+1+2+1+1+1=17）', U.total({ local: store(LOCAL), session: store(SESSION), admission: true }) === 17);
t('何も無い端末は 0', U.total({ local: store({}), session: store({}) }) === 0);
{
  const rows = U.collect({ local: store(LOCAL), session: store(SESSION), admission: true });
  const v = U.menuDue(rows, '2026-11-14');
  t('鍵の中身はほかの札と同じ形で、件数と数えた日だけ（{"v":1,"at","unsent":true,"n"}）', v === '{"v":1,"at":"2026-11-14","unsent":true,"n":17}', v);
  t('鍵の名前は unsent_menu_due（メニューの札の鍵の形 [a-z0-9_]）', U.MENU_DUE_KEY === 'unsent_menu_due' && /^[a-z0-9_]{1,40}$/.test(U.MENU_DUE_KEY));
  t('鍵に種類名・氏名・番号を入れない', v.indexOf(NAME) < 0 && v.indexOf(RID) < 0 && !/体重|貼り薬|家族|週間|ワーク|シフト|入居|消耗/.test(v) && JSON.stringify(Object.keys(JSON.parse(v))) === '["v","at","unsent","n"]');
  t('0件の時も書く（札が消えるように）', U.menuDue(U.collect({ local: store({}), session: store({}) }), '2026-11-14') === '{"v":1,"at":"2026-11-14","unsent":true,"n":0}');
  t('全部の種類が読めない時は書かない（null）', U.menuDue(U.collect({ local: null, session: null }), '2026-11-14') === null);
  t('日付の形が違う・一覧が無い時は書かない（null）', U.menuDue(rows, '11/14') === null && U.menuDue([], '2026-11-14') === null && U.menuDue(null, '2026-11-14') === null);
}
/* 画面（unsent.js）を偽の画面で動かす。書くのは件数の鍵だけ・現場の端末では書かない */
function runPage(localObj, auth, timers) {
  const writes = [];
  const ls = store(localObj);
  ls.setItem = (k, v) => { writes.push([k, v]); localObj[k] = String(v); };
  const els = {};
  const mk = () => ({ textContent: '', hidden: false, className: '', kids: [], attrs: {}, appendChild(c) { this.kids.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {} });
  const doc = { readyState: 'complete', getElementById: (id) => (els[id] = els[id] || mk()), createElement: () => mk(), addEventListener() {} };
  const handlers = {};
  const win = { localStorage: ls, sessionStorage: store({}), addEventListener(k, fn) { (handlers[k] = handlers[k] || []).push(fn); } };
  /* auth は答え（オブジェクト）か、答えを返す関数（確かめの答えが返る時を試験で決めるため） */
  if (auth) win.SUAuth = { STATUS: { OK: 'ok' }, check: typeof auth === 'function' ? auth : () => Promise.resolve(auth) };
  /* timers を渡した時は時計を試験が進める（[{fn, ms}] に積む） */
  const st = timers ? (fn, ms) => { timers.push({ fn, ms }); return timers.length; } : setTimeout;
  const ct = timers ? () => {} : clearTimeout;
  const ctx = { window: win, document: doc, localStorage: ls, Date, JSON, Object, Array, String, Number, isFinite, SyntaxError, Error, Promise, setTimeout: st, clearTimeout: ct };
  vm.createContext(ctx);
  vm.runInContext(raw('unsent-calc.js'), ctx);
  ctx.SUUnsent = win.SUUnsent;
  if (auth) ctx.SUAuth = win.SUAuth;
  vm.runInContext(raw('unsent.js'), ctx);
  return { writes, ls, els, handlers, win };
}
{
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
  const obj = Object.assign({}, LOCAL);
  const p = runPage(obj);
  t('一覧を開いて数え終えると、件数の鍵だけを1回書く（ログインを確かめられない時は入居調整を数えない＝15）', p.writes.length === 1 && p.writes[0][0] === 'unsent_menu_due' && JSON.parse(p.writes[0][1]).n === 15 && JSON.parse(p.writes[0][1]).at === today, p.writes);
  t('ログインを確かめられない時は入居調整の控えを読まない', p.ls.reads.indexOf('admf_cache') < 0, p.ls.reads.filter((k) => k === 'admf_cache').length);
  t('ほかの控えは書き換えない・消さない', p.ls.calls.filter((c) => c[0] !== 'set').length === 0 && JSON.stringify(Object.keys(obj).filter((k) => k !== 'unsent_menu_due').sort()) === JSON.stringify(Object.keys(LOCAL).sort()));
  const p2 = runPage(obj);
  t('同じ件数の時は書かない', p2.writes.length === 0, p2.writes);
  const f = runPage(Object.assign({}, LOCAL, { su_device_role: 'field' }));
  t('現場の端末では件数の鍵を書かない', f.writes.length === 0, f.writes);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const variants = [['事務所', { status: 'ok', role: 'office' }, true], ['管理者', { status: 'ok', role: 'admin' }, true],
    ['現場のアカウント', { status: 'ok', role: 'field' }, false], ['ログインしていない', { status: 'signed_out' }, false],
    ['確かめられない', { status: 'error' }, false], ['2段階認証の前', { status: 'mfa_verify', role: 'admin' }, false]];
  pending.push((async () => {
    for (const [nm, a, want] of variants) {
      const q = runPage(Object.assign({}, LOCAL), a);
      await tick(); await tick();
      const read = q.ls.reads.indexOf('admf_cache') >= 0;
      t('入居調整: ' + nm + 'の時は' + (want ? '読んで数える（鍵は16）' : '読まない（鍵は15）'), read === want && JSON.parse(q.writes[q.writes.length - 1][1]).n === (want ? 16 : 15), [read, q.writes]);
    }
  })());
  pending.push((async () => {
    /* 反証レビュー 2026-11-14（低1）: 「戻る」で前の表示のまま戻った時（pageshow の persisted）は、役割を確かめ直す前に
       入居調整の控えを読まない（前の確かめの答えを使い回さない） */
    let ans = { status: 'ok', role: 'office' };
    const q = runPage(Object.assign({}, LOCAL), () => Promise.resolve(ans));
    await tick(); await tick();
    const before = q.ls.reads.filter((k) => k === 'admf_cache').length;
    ans = { status: 'signed_out' };   // 離れている間にログアウトした
    (q.handlers.pageshow || []).forEach((fn) => fn({ persisted: true }));
    const syncRead = q.ls.reads.filter((k) => k === 'admf_cache').length - before;
    await tick(); await tick();
    const afterRead = q.ls.reads.filter((k) => k === 'admf_cache').length - before;
    t('「戻る」で戻った時は、確かめ直す前に入居調整の控えを読まない（ログアウトした後も読まない）', before >= 1 && syncRead === 0 && afterRead === 0, [before, syncRead, afterRead]);
    t('「戻る」で戻ってログアウトしていた時の件数の鍵は入居調整を数えない（15）', JSON.parse(q.writes[q.writes.length - 1][1]).n === 15, q.writes);
  })());
  pending.push((async () => {
    /* 反証レビュー 2026-11-14（低2）: 事務所PCでは、ログインの確かめの答えが出る前に件数の鍵を書かない（答えの後に1回書く） */
    let resolve;
    const q = runPage(Object.assign({}, LOCAL), () => new Promise((r) => { resolve = r; }));
    await tick(); await tick();
    t('確かめの答えが出る前は件数の鍵を書かない', q.writes.length === 0, q.writes);
    resolve({ status: 'ok', role: 'office' });
    await tick(); await tick();
    t('答えが出た後に1回だけ書く（入居調整を数えた16）', q.writes.length === 1 && JSON.parse(q.writes[0][1]).n === 16, q.writes);
    let resolve2;
    const q2 = runPage(Object.assign({}, LOCAL), () => new Promise((r) => { resolve2 = r; }));
    await tick();
    t('使えない答えの前も書かない', q2.writes.length === 0, q2.writes);
    resolve2({ status: 'signed_out' });
    await tick(); await tick();
    t('使えない答えの後に1回だけ書く（入居調整を除いた15）', q2.writes.length === 1 && JSON.parse(q2.writes[0][1]).n === 15, q2.writes);
    const q3 = runPage(Object.assign({}, LOCAL), () => Promise.reject(new Error('通信の失敗')));
    await tick(); await tick();
    t('確かめられない（失敗）の答えの後に1回だけ書く（15）', q3.writes.length === 1 && JSON.parse(q3.writes[0][1]).n === 15, q3.writes);
  })());
  pending.push((async () => {
    /* CI の失敗 2026-11-14: ログインの確かめの答えが返らない・遅い端末では、上限（4秒・仮置き）を過ぎたら確かめられないとして
       入居調整を除いた件数で1回書き、後で答えが出れば書き直す */
    const timers = [];
    let resolve;
    const q = runPage(Object.assign({}, LOCAL, { unsent_menu_due: '{"v":1,"at":"2026-11-01","unsent":true,"n":9}' }), () => new Promise((r) => { resolve = r; }), timers);
    await tick();
    const w = timers.find((x) => x.ms === 4000);
    t('確かめの答えを待つ上限は4秒', !!w, timers.map((x) => x.ms));
    t('上限の前は書かない・数え終えた印も付けない', q.writes.length === 0 && q.els.when && q.els.when.attrs['data-done'] === undefined, [q.writes, q.els.when && q.els.when.attrs]);
    if (w) w.fn();
    t('上限を過ぎたら入居調整を除いた件数（15）で1回書き、数え終えた印を付ける', q.writes.length === 1 && JSON.parse(q.writes[0][1]).n === 15 && q.els.when.attrs['data-done'] === '1', q.writes);
    resolve({ status: 'ok', role: 'office' });
    await tick(); await tick();
    t('後で使える答えが出たら入居調整を数えて書き直す（16）', q.writes.length === 2 && JSON.parse(q.writes[1][1]).n === 16, q.writes);
    const timers2 = [];
    const q2 = runPage(Object.assign({}, LOCAL), { status: 'ok', role: 'office' }, timers2);
    await tick(); await tick();
    const w2 = timers2.find((x) => x.ms === 4000);
    const n2 = q2.writes.length;
    if (w2) w2.fn();
    t('答えが上限の前に出た時は、上限を過ぎても書き直さない（入居調整を外した数で上書きしない）', n2 === 1 && q2.writes.length === 1 && JSON.parse(q2.writes[0][1]).n === 16, q2.writes);
  })());
  t('一覧の画面に氏名が出ない', JSON.stringify(Object.values(p.els).map((e) => e.textContent)).indexOf(NAME) < 0);
}
{
  /* メニューの札の文（index.html の dueText）: 件数の鍵だけを読み、ほかの札と同じ守りで出す */
  const I = raw('index.html');
  const B = I.indexOf('DUE_TEXT_BEGIN'), E = I.indexOf('/* DUE_TEXT_END */');
  const box = {};
  vm.createContext(box);
  vm.runInContext(I.slice(I.indexOf('function dueText', B), E) + '\nthis.dueText = dueText;', box);
  const dt = box.dueText, J2 = (o) => JSON.stringify(o);
  t('札の文は「未送信n（m/d時点）」', dt(J2({ v: 1, at: '2026-11-14', unsent: true, n: 3 }), '2026-11-14', '') === '未送信3（11/14時点）', dt(J2({ v: 1, at: '2026-11-14', unsent: true, n: 3 }), '2026-11-14', ''));
  t('0件・形が違う・先の日付・整数でない時は札を出さない', ['{"v":1,"at":"2026-11-14","unsent":true,"n":0}', '{"v":1,"at":"2026-11-14","unsent":"yes","n":2}', '{"v":1,"at":"2026-11-15","unsent":true,"n":2}', '{"v":1,"at":"2026-11-14","unsent":true,"n":1.5}', '{"v":1,"at":"2026-11-14","unsent":true}', '{壊れた'].every((x) => dt(x, '2026-11-14', '') === ''));
  t('氏名などを入れられても札に出さない', !/甲野/.test(dt(J2({ v: 1, at: '2026-11-14', unsent: true, n: 1, name: NAME }), '2026-11-14', '')));
  const html = I.replace(/<!--[\s\S]*?-->/g, '');
  t('メニューは数える部品を読み込まない（unsent-calc.js・unsent-badge.js の読み込み・preload なし）', !/unsent-calc\.js|unsent-badge\.js/.test(html));
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  t('メニューは各画面の控えの鍵（氏名の入る控え）を読まない', !['wtmgr_pq_v1', 'genogram:pendingSync', 'apc2_sync_q', 'ws_alt_pending_v2', 'ws_care_ops_v1', 'admf_cache', 'spl_pending', 'shiftapp:v1', 'SUUnsent'].some((k) => scripts.indexOf(k) >= 0));
  const badge = I.slice(I.indexOf('function dueBadge'), I.indexOf('function dueBadge') + 600);
  t('札はほかの札と同じ道（dueBadge）で読み、現場端末（is-field）では読まない', /classList\.contains\('is-field'\)\) return null;/.test(badge));
}

console.log('\nG 画面・メニュー・公開');
{
  const H = raw('unsent.html'), J = code('unsent.js'), C = raw('unsent.css');
  t('画面は CSP を持ち、画面の中にスクリプトを書かない', /http-equiv="Content-Security-Policy"[^>]*script-src 'self';/.test(H) && !/<script>(?!<\/script>)|<script(?![^>]*\ssrc=)[^>]*>/.test(H));
  { const srcs = [...H.matchAll(/<script\b[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1]);
    t('su-errors.js がほかのスクリプトより前・数える部品が画面より前', srcs[0] === 'su-errors.js' && srcs.indexOf('unsent-calc.js') >= 0 && srcs.indexOf('unsent-calc.js') < srcs.indexOf('unsent.js'), srcs); }
  t('「不具合を報告」が </body> の直前の並びにある', /su-report\.js\?v=[0-9.-]+" data-tool="未送信の一覧"><\/script>\s*<\/body>/.test(H));
  t('見出しは共通の型（← メニュー・役割の札・su-shell.js）', /class="hdr su-shell-hdr"/.test(H) && /class="back su-menu-back" href="index.html"/.test(H) && /su-shell\.js\?v=/.test(H));
  t('画面のコードは innerHTML・document.write・console・通信・消す操作を使わない', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\.|fetch\(|XMLHttpRequest|sendBeacon|removeItem|\.clear\(/.test(J));
  t('画面が書くのは件数の鍵（U.MENU_DUE_KEY）の1か所だけ', (J.match(/setItem\(/g) || []).length === 1 && /st\.setItem\(U\.MENU_DUE_KEY, v\)/.test(J));
  t('ほかのタブの一覧が札の件数の鍵を書いた時は読み直さない（2つのタブで書き合いが止まらないため）', /if \(ev && ev\.key === U\.MENU_DUE_KEY\) return;\s*draw\(\);/.test(J));
  t('印刷では見出しと中身を消す', /@media print\s*\{[^}]*header, main \{ display: none !important; \}/.test(C));
  t('「この画面を開いて送る」は同じタブの移動だけ（target を付けない）', /'この画面を開いて送る'/.test(J) && !/target/.test(J));
  const G = raw('.gitignore');
  t('公開の許可リストに4つのファイル', ['unsent.html', 'unsent.js', 'unsent.css', 'unsent-calc.js'].every((f) => new RegExp('^!/' + f.replace('.', '\\.') + '$', 'm').test(G)));
  const I = raw('index.html');
  const def = JSON.parse((/<script type="application\/json" id="menuDef">([\s\S]*?)<\/script>/.exec(I) || [])[1] || '{}');
  const help = (def.sections || []).find((s) => s.id === 'sec-help');
  const tile = help && help.tiles.find((x) => x.href === 'unsent.html');
  t('メニューの「困った時」に入口がある（事務所専用の印なし＝現場端末でも出す）・札は件数の鍵', !!tile && !tile.officeOnly && !help.officeOnly && tile.nm === '未送信の一覧' && tile.due === 'unsent_menu_due', tile);
}

Promise.all(pending).then(() => {
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
}, (e) => { console.log('  ✗ 試験が途中で止まりました  → ' + String(e && e.stack || e)); process.exit(1); });
