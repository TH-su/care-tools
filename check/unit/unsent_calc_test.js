/* 未送信の一覧の読み取り（unsent-calc.js）と画面・メニューの札の試験（代表者の決定 2026-11-14【訂正】）
   実行: node check/unit/unsent_calc_test.js
   守ること:
     A 種類ごとに、各画面が今すでに残している控えの形から件数・いちばん古い時刻・1件ずつの日付と種類を読む
     B 控えに氏名・病名・記録の本文・入居者の番号が入っていても、返す値のどこにも出ない
     C 控えを書き換えない・消さない（setItem・removeItem・clear を一度も呼ばない）
     D 現場の端末では1件ずつを返さず、事務所向けの画面（入居調整）の控えは読みもしない
     E 崩れた控え・読めない保存領域は「確かめられません」（bad）で、ほかの種類は読み続ける
     F メニューの合計は写し返しと数えられない種類を数えない。札は合計の数だけを出す（0件・部品なしは出さない）
     G 画面（unsent.html・unsent.js）: 文字は textContent だけ・通信しない・端末に書かない・印刷しない・公開の許可・メニューの入口
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
const rows = U.collect({ local: ls, session: ss, detail: true });
const by = Object.fromEntries(rows.map((r) => [r.id, r]));
t('全部の種類が返る（事務所の端末）', ['weight', 'patch', 'genogram', 'care', 'ws-day', 'ws-alt', 'ws-care', 'ws-master', 'shift', 'shift-rescue', 'admission', 'supplies', 'weight-mirror', 'kv-mirror'].every((k) => by[k]), Object.keys(by));
t('体重管理: 4件・いちばん古いのは T1・種類の名前は決まった語（削除は delRecord）', by.weight.n === 4 && by.weight.oldest === T1 && JSON.stringify(by.weight.items.map((i) => i.label)) === JSON.stringify(['入居者の情報', '体重の記録', '体重の記録の削除', 'そのほかの変更']), by.weight.items);
t('体重管理: 時刻でない値は時刻なし（null）', by.weight.items[3].at === null);
t('ワークスケジュール（週間計画の変更）: 2件・記録した時刻', by['ws-care'].n === 2 && by['ws-care'].oldest === T2 && by['ws-care'].items.every((i) => i.label === '週間計画の変更'), by['ws-care']);
t('シフト作成（退避した編集）: 鍵の名前だけで2件・退避した時刻・自動では送らない組（held）', by['shift-rescue'].n === 2 && by['shift-rescue'].group === 'held' && by['shift-rescue'].oldest === T1 && by['shift-rescue'].items.some((i) => i.label === '競合解決前の勤務表' && i.day === '2026-10') && by['shift-rescue'].items.some((i) => i.label === '取込前の希望休' && i.day === ''), by['shift-rescue']);
t('貼り薬: 2件・断られた記録のある方は印つき', by.patch.n === 2 && by.patch.oldest === T2 && by.patch.items.some((i) => i.label === '貼り薬の設定（断られた記録あり）') && by.patch.items.some((i) => i.label === '貼り薬の設定'), by.patch);
t('家族構成図: 2件・保存と削除', by.genogram.n === 2 && by.genogram.oldest === T1 && by.genogram.items.map((i) => i.label).sort().join() === ['図の保存', '図の削除'].sort().join(), by.genogram);
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
  const r = U.collect({ local: store({ admf_cache: JSON.stringify({ db: admDb, rev: 3, dirty: false, at: iso(T1) }), wtmgr_pq_v1: '[]', care_schedule_dirty_v1: null }), session: store({}) });
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
  const br = U.collect({ local: bad, session: store({ spl_pending: '"x"' }), detail: true });
  const want = ['weight', 'patch', 'genogram', 'care', 'ws-day', 'ws-alt', 'ws-care', 'ws-master', 'shift', 'admission', 'supplies', 'weight-mirror', 'kv-mirror'];
  t('崩れた控えはどれも「確かめられません」（bad）・件数なし', want.every((k) => { const r = br.find((x) => x.id === k); return r && r.state === 'bad' && r.n === null && r.items.length === 0; }), br.map((r) => [r.id, r.state]));
  t('崩れていても書く・消すを呼ばない', bad.calls.length === 0);
  const thr = U.collect({ local: store(LOCAL, { throwOn: 'wtmgr_pq_v1' }), session: store(SESSION) });
  t('読めない鍵は bad・ほかの種類は読み続ける', thr.find((r) => r.id === 'weight').state === 'bad' && thr.find((r) => r.id === 'genogram').n === 2);
  const none = U.collect({ local: null, session: null });
  t('保存領域が無い時は全部 bad（例外を外に出さない）', none.length > 0 && none.every((r) => r.state === 'bad'));
  t('合計は読めない時 0', U.total({ local: null, session: null }) === 0);
  const pa = U.collect({ local: store({ apc2_sync_q: JSON.stringify({ v: 1, q: { x: iso(T1) } }), apc2_sync_ng: '{壊れた' }), session: store({}) }).find((r) => r.id === 'patch');
  t('貼り薬: 断りの記録が崩れていても送信待ちは数える', pa.state === 'some' && pa.n === 1);
  const fut = U.collect({ local: store({ wtmgr_pq_v1: JSON.stringify([{ action: 'saveRecord', at: 9e15 }, { action: 'saveRecord', at: -5 }]) }), session: store({}) }).find((r) => r.id === 'weight');
  t('範囲の外の時刻は時刻なし', fut.n === 2 && fut.oldest === null);
}

console.log('\nF メニューの合計と札');
t('合計は写し返し・退避した編集・数えられない種類を数えない（4+2+2+1+2+1+2+1+1+1=17）', U.total({ local: store(LOCAL), session: store(SESSION) }) === 17);
t('何も無い端末は 0', U.total({ local: store({}), session: store({}) }) === 0);
function fakeDom(hrefs) {
  const tiles = hrefs.map((h) => {
    const kids = [];
    return { kids, getAttribute: (k) => (k === 'href' ? h : null), appendChild(c) { c.parentNode = this; kids.push(c); },
      removeChild(c) { kids.splice(kids.indexOf(c), 1); } };
  });
  const root = {
    tiles,
    querySelectorAll(sel) {
      if (sel === 'a.tile') return tiles;
      if (sel === 'a.tile .unsb') return [].concat(...tiles.map((x) => x.kids.filter((c) => c.className === 'unsb')));
      return [];
    }
  };
  return root;
}
function runBadge(localObj, withCalc) {
  const win = { localStorage: store(localObj), sessionStorage: store({}), addEventListener() {} };
  const ctx = { window: win, document: { createElement: () => ({ className: '', textContent: '' }) }, Date, JSON, Object, Array, String, Number, isFinite, SyntaxError, Error };
  vm.createContext(ctx);
  if (withCalc) vm.runInContext(raw('unsent-calc.js'), ctx);
  vm.runInContext(raw('unsent-badge.js'), ctx);
  const root = fakeDom(['help.html', 'unsent.html', 'weight-record.html']);
  win.SUUnsentBadge.start(root);
  win.SUUnsentBadge.apply(root);
  return { root, win };
}
{
  const b = runBadge(LOCAL, true);
  const un = b.root.tiles[1].kids;
  t('札は「未送信の一覧」のタイルにだけ・1枚だけ', un.length === 1 && b.root.tiles[0].kids.length === 0 && b.root.tiles[2].kids.length === 0, b.root.tiles.map((x) => x.kids.length));
  t('札の文は「未送信16」（数だけ・この試験のタブに消耗品の控えは無い）', un[0] && un[0].textContent === '未送信16', un[0] && un[0].textContent);
  t('札を付けても書く・消すを呼ばない', b.win.localStorage.calls.length === 0);
  const z = runBadge({}, true);
  t('0件の時は札を出さない', z.root.tiles[1].kids.length === 0);
  const n = runBadge(LOCAL, false);
  t('数える部品が無い時は札を出さない', n.root.tiles[1].kids.length === 0);
  t('札の部品に setItem・removeItem・fetch・innerHTML が無い', !/setItem|removeItem|fetch\(|innerHTML/.test(code('unsent-badge.js')));
}

console.log('\nG 画面・メニュー・公開');
{
  const H = raw('unsent.html'), J = code('unsent.js'), C = raw('unsent.css');
  t('画面は CSP を持ち、画面の中にスクリプトを書かない', /http-equiv="Content-Security-Policy"[^>]*script-src 'self';/.test(H) && !/<script>(?!<\/script>)|<script(?![^>]*\ssrc=)[^>]*>/.test(H));
  { const srcs = [...H.matchAll(/<script\b[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1]);
    t('su-errors.js がほかのスクリプトより前・数える部品が画面より前', srcs[0] === 'su-errors.js' && srcs.indexOf('unsent-calc.js') >= 0 && srcs.indexOf('unsent-calc.js') < srcs.indexOf('unsent.js'), srcs); }
  t('「不具合を報告」が </body> の直前の並びにある', /su-report\.js\?v=[0-9.-]+" data-tool="未送信の一覧"><\/script>\s*<\/body>/.test(H));
  t('見出しは共通の型（← メニュー・役割の札・su-shell.js）', /class="hdr su-shell-hdr"/.test(H) && /class="back su-menu-back" href="index.html"/.test(H) && /su-shell\.js\?v=/.test(H));
  t('画面のコードは innerHTML・document.write・console・通信・保存を使わない', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\.|fetch\(|XMLHttpRequest|sendBeacon|setItem|removeItem/.test(J));
  t('印刷では見出しと中身を消す', /@media print\s*\{[^}]*header, main \{ display: none !important; \}/.test(C));
  t('「この画面を開いて送る」は同じタブの移動だけ（target を付けない）', /'この画面を開いて送る'/.test(J) && !/target/.test(J));
  const G = raw('.gitignore');
  t('公開の許可リストに5つのファイル', ['unsent.html', 'unsent.js', 'unsent.css', 'unsent-calc.js', 'unsent-badge.js'].every((f) => new RegExp('^!/' + f.replace('.', '\\.') + '$', 'm').test(G)));
  const I = raw('index.html');
  const def = JSON.parse((/<script type="application\/json" id="menuDef">([\s\S]*?)<\/script>/.exec(I) || [])[1] || '{}');
  const help = (def.sections || []).find((s) => s.id === 'sec-help');
  const tile = help && help.tiles.find((x) => x.href === 'unsent.html');
  t('メニューの「困った時」に入口がある（事務所専用の印なし＝現場端末でも出す）', !!tile && !tile.officeOnly && !help.officeOnly && tile.nm === '未送信の一覧', tile);
  t('メニューは数える部品と札の部品を読む', /<script src="unsent-calc\.js\?v=[0-9.-]+"><\/script>\s*<script src="unsent-badge\.js\?v=[0-9.-]+"><\/script>/.test(I));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
