/* 設備・修繕の記録のページ（equip-log.html）の配線の試験（2026-11-03 新設・本人の決定 2026-11-03）
   実行: node check/unit/equip_page_test.js
   やり方: ページの HTML から画面のスクリプトを読み、トップレベルの関数と var を1つずつ切り出して vm で動かす
          （ats_page_test.js と同じ作法。HTML 全体は評価しない。通信・画面の部品は偽物）。計算の部品は本物の equip-calc.js。
   守ること:
     1. 現場端末では通信0（データベース・ログインの役割の確かめのどれも呼ばない）・端末に何も書かない
     2. ログインの役割で開けない時・確かめる部品が無い時は何も読まない
     3. 開けた時は eq_list を1回だけ呼び、図面の部屋を押すとその部屋の設備と記録が出る（氏名は扱わない）
     4. 設備・対応の記録（故障日・依頼日・対応日・完了日・増やした項目）を保存すると一覧・時系列・予定・費用・CSV に出る
     5. 古い版の保存は「他で直されました。読み直してください」を出して行を差し替える（入力は残す）
     6. 取り消した記録は印つきで残り、費用の合計から外れる
     7. 準備中（PGRST202・PGRST205・42P01）は帯を出し、保存・追加・取り消し・項目の設定を押せない。ほかの失敗は通常のエラー
     8. 端末に残すのは eql_tab・eql_floor・eql_filter だけ（UI 状態の復元のホワイトリスト・未知値は既定へ）
     9. 危険な値（<img onerror> など）がエスケープされる
    10. 増やした項目の値が種類違いなら保存の前に断る・「使わない」は値を消さない・削除の操作は無い
    11. 添付は JPEG・PNG・PDF・10MB まで・台帳 → 置き場の順・置けなければ台帳から外す
    13. 使いやすさ（2026-11-03 追補 U1〜U8）: どのタブからも押せる「＋ 記録を足す」「＋ 設備を足す」（選んだ場所入り）・上部の検索1つ
        （設備・対応の記録・予定を絞る・端末に保存しない）・図面の印（期限切れ・修理中・凡例・階の名前）・設備のカルテ
        （保証の残り・累計費用・時系列・添付の数）・業者のその場の追加と直前の記録の続き・閉じる／タブを移る前の窓の中の確かめ・
        空の時の案内・幅 900px 未満の札の表示
     ほか: 読み込む部品の並び・CSP・インラインの on〜 なし・console なし
   ★データはすべて架空（業者「架空設備」・部屋 101 など）。出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.EQUIP_HTML || path.join(ROOT, 'equip-log.html'), 'utf8');
const CALC = require(path.join(ROOT, 'equip-calc.js'));

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

const SM = /<script>\n'use strict';\n([\s\S]*?)<\/script>/.exec(HTML);
if (!SM) throw new Error('画面のスクリプトが見つかりません');
const S = SM[1];
/* 文字列・コメント・正規表現の中のかっこを数えない切り出し（ats_page_test.js と同じ作り） */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function cutF(src, name) {
  const h = src.indexOf('\nfunction ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  return src.slice(h + 1, scanBlock(src, h + 1) + 1);
}
const VARS = S.split('\n').filter((l) => /^var /.test(l)).join('\n');
const FN_NAMES = [...S.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
const CODE = "'use strict';\n" + VARS + '\n' + FN_NAMES.map((n) => cutF(S, n)).join('\n');

const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 40); i++) await tick(); }

function fakeStorage(log, init) {
  const m = new Map(Object.entries(init || {}));
  return {
    m,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { log.push(['set', k, String(v)]); m.set(k, String(v)); },
    removeItem(k) { log.push(['remove', k]); m.delete(k); },
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] || null; }
  };
}
/* 架空の間取り（1階・2階・名前の箱）。部屋番号と名前の箱だけで、氏名は無い */
const PLAN = {
  f1: { title: '1階', cols: [40, 180, 180, 40], rows: [40, 120, 120], cells: [{ r: 1, c: 1, rs: 1, cs: 1, room: '101' }, { r: 1, c: 2, rs: 1, cs: 1, room: '102' }, { r: 2, c: 1, rs: 1, cs: 2, t: '厨房' }] },
  f2: { title: '2階', cols: [40, 180, 180, 40], rows: [40, 120], cells: [{ r: 1, c: 1, rs: 1, cs: 1, room: '201' }, { r: 1, c: 2, rs: 1, cs: 1, room: '202' }] }
};
const OFFICE = { 施設: '施設の名前', 訪問: '訪問の名前', 通所: '通所の名前' };
function baseData() {
  return {
    ok: true,
    assets: [{ id: 'a1', kind: 'facility', place_key: 'room:101', category: 'aircon', name: '架空エアコン', status: 'active', cycle_months: 6, bought_on: '2026-04-10', rev: 1, extra: {} }],
    events: [{ id: 'e1', asset_id: 'a1', place_key: 'room:101', etype: 'repair', found_on: '2026-05-01', handled_on: '2026-05-03', amount: 11000, vendor_id: 'v1', body: '架空の修理', rev: 1, extra: {} }],
    vendors: [{ id: 'v1', name: '架空設備', field: '空調', rev: 1 }],
    places: [{ id: 'p1', kind: 'visit', name: '訪問の車', sort: 10, rev: 1 }],
    fields: [
      { id: 'fd1', target: 'event', name: '見積受領日', ftype: 'date', sort: 10, disabled: false, rev: 1 },
      { id: 'fd2', target: 'event', name: '緊急度', ftype: 'select', options: ['高', '低'], sort: 20, disabled: false, rev: 1 },
      { id: 'fa1', target: 'asset', name: '資産番号', ftype: 'text', sort: 10, disabled: false, rev: 1 }
    ]
  };
}
function load(opt) {
  opt = opt || {};
  const writes = [], log = [];
  const ls = fakeStorage(writes, opt.local || {});
  if (opt.role) ls.m.set('su_device_role', opt.role);
  const els = {};
  const mk = (id) => {
    const attrs = {};
    return { id, innerHTML: '', textContent: '', className: '', hidden: id === 'e-app' || id === 'e-gate' || id === 'e-band', disabled: false, value: '', checked: false, files: [], style: {}, open: false,
      classList: { add() {}, remove() {} }, setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
      addEventListener() {}, focus() {}, click() { log.push({ kind: 'click', id }); }, showModal() { this.open = true; }, close() { this.open = false; } };
  };
  const el = (id) => (els[id] = els[id] || mk(id));
  const rpcFn = opt.rpc || {};
  const db = {
    rpc(name, args) {
      log.push({ kind: 'rpc', name, args: JSON.parse(JSON.stringify(args || {})) });
      const f = rpcFn[name];
      const v = f ? f(args) : { ok: true };
      return Promise.resolve(v && v.__error ? { data: null, error: v.__error } : { data: v, error: null });
    },
    /* 表から読むのは添付の台帳（eq_files）だけ。opt.tables で行を差し替える */
    from(table) {
      const b = { ops: [] };
      ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete', 'upsert'].forEach((k) => { b[k] = function () { b.ops.push([k].concat([].slice.call(arguments))); return b; }; });
      b.then = function (ok, ng) { log.push({ kind: 'table', table, ops: b.ops }); return Promise.resolve({ data: JSON.parse(JSON.stringify((opt.tables || {})[table] || [])), error: null }).then(ok, ng); };
      return b;
    },
    storage: {
      from(bucket) {
        const st = opt.storage || {};
        const call = (op, args, def) => { log.push({ kind: 'storage', bucket, op, args }); const f = st[op]; return Promise.resolve(f ? f.apply(null, args) : def); };
        return {
          upload(key, file, o) { return call('upload', [key, file && file.name, o], { data: { path: key }, error: null }); },
          remove(keys) { return call('remove', [keys], { data: keys.map((k) => ({ name: k })), error: null }); },
          createSignedUrl(key, sec) { return call('createSignedUrl', [key, sec], { data: { signedUrl: 'https://kakuu.example/s/' + key }, error: null }); }
        };
      }
    }
  };
  const gateCalls = [];
  const SUAppGate = { run(key, o) { gateCalls.push({ key, o }); return Promise.resolve(opt.gate === undefined ? true : opt.gate); } };
  const SUFacility = { roomPlan() { return opt.noPlan ? null : JSON.parse(JSON.stringify(opt.plan || PLAN)); }, officeName(k) { return OFFICE[k] || ''; }, onReady(fn) { fn(); } };
  const win = { addEventListener() {}, SUAuth: { client() { return db; } }, SUAppGate: opt.noGate ? undefined : SUAppGate, SUFacility, confirm() { return opt.confirm === undefined ? true : opt.confirm; },
    open() { return { closed: false, location: { replace(u) { log.push({ kind: 'open', url: u }); } } }; } };
  const body = { textContent: '', appendChild(x) { log.push({ kind: 'body-append', tag: x && x.tag }); }, removeChild() {} };
  const ctx = {
    Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error, parseInt, isFinite, encodeURIComponent, Blob,
    URL: { createObjectURL: () => 'blob:kakuu-1', revokeObjectURL() {} },
    setTimeout(fn, ms) { if (!(ms >= 1000)) setImmediate(fn); return 0; }, clearTimeout() {},
    localStorage: ls, window: win, EquipCalc: CALC,
    document: { hidden: false, getElementById: el, body, createElement(tag) { return { tag, setAttribute() {}, click() { log.push({ kind: 'download', name: this.download }); } }; }, addEventListener() {} },
    location: { hash: '', reload() { log.push({ kind: 'reload' }); } }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'equip-log.html（切り出し）' });
  const toasts = [];
  ctx.toast = (m) => toasts.push(String(m));
  const rpcs = (n) => log.filter((x) => x.kind === 'rpc' && (!n || x.name === n));
  return { ctx, ls, writes, log, el, els, toasts, rpcs, gateCalls, stores: () => log.filter((x) => x.kind === 'storage') };
}
const okList = (d) => () => Object.assign(baseData(), d || {});
/* 保存の偽物: 版が合えば rev+1 の行を返し、違えば {conflict:true, row:今の行} */
function saver(store) {
  let n = 0;
  return (a) => {
    const cur = a.p_row.id != null ? store[a.p_row.id] : null;
    if (cur && cur.rev !== a.p_rev) return { ok: false, conflict: true, row: cur };
    const row = Object.assign({}, cur || {}, a.p_row, { id: a.p_row.id || ('new-' + (++n)), rev: (cur ? cur.rev : 0) + 1, created_at: '2026-11-03T00:00:0' + n + 'Z' });
    store[row.id] = row;
    return { ok: true, row };
  };
}
async function opened(opt) {
  const L = load(Object.assign({ rpc: { eq_list: okList() } }, opt || {}));
  await L.ctx.boot_(); await settle();
  return L;
}
const BAD = '<img src=x onerror=alert(1)>"><script>alert(2)</script>';
const allPanels = (L) => { const out = []; for (const tb of CALC.TABS) { L.ctx.tab = tb; L.ctx.paintAll_(); out.push(L.els['p-' + tb].innerHTML); } return out.join('\n'); };

(async () => {
  group('1. 現場端末では通信0');
  {
    const L = load({ role: 'field', rpc: { eq_list: okList() } });
    const r = await L.ctx.boot_(); await settle();
    t('現場端末: 起動は field で止まり、覆い（案内）だけを出す', r === 'field' && !L.els['e-gate'].hidden && /事務所のパソコン/.test(L.els['e-gate'].innerHTML) && L.el('e-app').hidden, r);
    t('現場端末: データベース・ログインの役割の確かめのどれも呼ばない', L.log.length === 0 && L.gateCalls.length === 0, { log: L.log.length, gate: L.gateCalls.length });
    t('現場端末: 端末に何も書かない', L.writes.length === 0, L.writes);
  }

  group('2. ログインの役割で開けない時は何も読まない');
  {
    const L = load({ gate: false, rpc: { eq_list: okList() } });
    const r = await L.ctx.boot_(); await settle();
    t('開けない: su-app-gate の equip-log で確かめ、覆いのまま（記録を読まない）', r === 'gate' && L.gateCalls.length === 1 && L.gateCalls[0].key === 'equip-log' && L.rpcs().length === 0 && L.el('e-app').hidden, r);
    t('開けない: 保存していない入力があるかの問い合わせ（dirty）を渡す', typeof L.gateCalls[0].o.dirty === 'function' && L.gateCalls[0].o.dirty() === false);
    const N = load({ noGate: true, rpc: { eq_list: okList() } });
    const r2 = await N.ctx.boot_(); await settle();
    t('確かめる部品が無い: 開かず、何も読まない', r2 === 'nogate' && N.rpcs().length === 0 && N.log.some((x) => x.kind === 'body-append' && x.tag === 'p'), r2);
  }

  group('3. 開けた時: 一覧を読み、図面の部屋を押すとその部屋の設備と履歴が出る');
  {
    const L = await opened();
    t('起動: eq_list を1回（全部の事業所 p_kind=null）だけ呼ぶ・表は直接読まない', L.rpcs().length === 1 && L.rpcs()[0].name === 'eq_list' && L.rpcs()[0].args.p_kind === null && !L.log.some((x) => x.kind === 'table'), L.rpcs());
    t('起動: アプリの欄を出し、準備中の帯は出さない', !L.els['e-app'].hidden && L.els['e-gate'].hidden && L.els['e-band'].hidden && L.ctx.dbState === 'ok');
    const map = L.els['p-map'].innerHTML;
    t('図面: 部屋番号と名前の箱を 44px 以上のボタンで描く（1階の 101・102・厨房）', /data-key="room:101"/.test(map) && /data-key="room:102"/.test(map) && /data-key="area:f1:厨房"/.test(map) && !/room:201/.test(map));
    t('図面: 箱の置き場所は施設情報の r・c をそのまま使う（1から数える・resident-master と同じ）', /grid-row:1 \/ span 1;grid-column:1 \/ span 1" data-act="place" data-key="room:101"/.test(map) && /grid-row:1 \/ span 1;grid-column:2 \/ span 1" data-act="place" data-key="room:102"/.test(map) && /grid-row:2 \/ span 1;grid-column:1 \/ span 2" data-act="place" data-key="area:f1:厨房"/.test(map), map.slice(0, 600));
    t('図面: その他の場所（eq_places）を名前で出す', /data-key="place:p1"/.test(map) && /訪問の車/.test(map));
    L.ctx.act_('place', { getAttribute: (k) => (k === 'data-key' ? 'room:101' : null) });
    const side = L.els['p-map'].innerHTML;
    t('図面の部屋を押すとその部屋の設備と履歴が出る', /架空エアコン/.test(side) && /架空の修理/.test(side) && /aria-pressed="true"/.test(side), side.slice(-400));
    L.ctx.act_('floor', { getAttribute: (k) => (k === 'data-floor' ? 'f2' : null) });
    t('階の切替: 2階の部屋を出し、階を端末に控える（eql_floor）', /room:201/.test(L.els['p-map'].innerHTML) && L.ls.getItem('eql_floor') === 'f2');
    const N = await opened({ noPlan: true });
    t('間取り図が無い時も落ちずに「その他の場所」を出す', /間取り図がありません/.test(N.els['p-map'].innerHTML) && /訪問の車/.test(N.els['p-map'].innerHTML));
  }

  group('4. 設備を登録し対応の記録を保存すると一覧・時系列・予定・費用集計・CSV に反映される');
  {
    const store = {};
    const L = await opened({ rpc: { eq_list: okList(), eq_save_asset: saver(store), eq_save_event: saver(store) } });
    L.ctx.openAsset_(null, 'room:102');
    t('設備の入力: 種類は 10 種・場所は押した部屋・増やした項目（資産番号）の欄がある', /id="a-category"/.test(L.els['e-dlg'].innerHTML) && (L.els['e-dlg'].innerHTML.match(/<option value="(aircon|kitchen|it|furniture|water|electric|fire|building|vehicle|other)"/g) || []).length === 10 && /資産番号/.test(L.els['e-dlg'].innerHTML));
    L.el('a-name').value = '架空冷蔵庫'; L.el('a-category').value = 'kitchen'; L.el('a-place').value = 'room:102'; L.el('a-kind').value = 'facility';
    L.el('a-purchased').value = '2026-04-01'; L.el('a-price').value = '120,000'; L.el('a-vendor').value = 'v1'; L.el('a-interval').value = '3'; L.el('a-status').value = 'active'; L.el('fx-0').value = 'K-001';
    t('周期から次回予定日を出す（購入日 2026-04-01 + 3か月）', L.ctx.calcNext_() === '2026-07-01' && L.el('a-next').value === '2026-07-01');
    const ok = await L.ctx.saveForm_(); await settle();
    const sa = L.rpcs('eq_save_asset')[0];
    t('設備の保存: eq_save_asset に p_row と p_rev（新しい行は null）を送る', ok === true && sa && sa.args.p_rev === null && sa.args.p_row.name === '架空冷蔵庫' && sa.args.p_row.price === 120000 && sa.args.p_row.extra.fa1 === 'K-001' && sa.args.p_row.place_key === 'room:102', sa && sa.args);
    t('設備の保存: 一覧に出て、窓を閉じ「保存しました」', L.ctx.data.assets.some((a) => a.name === '架空冷蔵庫') && L.ctx.form === null && L.toasts.some((x) => /保存しました/.test(x)));
    const aid = L.ctx.data.assets.find((a) => a.name === '架空冷蔵庫').id;
    L.ctx.openEvent_(null, 'room:102', aid);
    const dlg = L.els['e-dlg'].innerHTML;
    t('対応の記録の入力: 故障日・依頼日・対応日・完了日の 4 欄（各欄に「今日」）', ['v-found', 'v-requested', 'v-handled', 'v-done'].every((id) => new RegExp('id="' + id + '" type="date"').test(dlg) && new RegExp('data-act="today" data-for="' + id + '"').test(dlg)));
    t('対応の記録の入力: 増やした項目を種類に合う欄で並び順に出す（見積受領日=日付・緊急度=選択肢）', /id="fx-0" type="date"/.test(dlg) && /<select id="fx-1">/.test(dlg) && dlg.indexOf('見積受領日') < dlg.indexOf('緊急度'));
    L.el('v-place').value = 'room:102'; L.el('v-asset').value = aid; L.el('v-etype').value = 'repair';
    L.el('v-found').value = '2026-06-10'; L.el('v-requested').value = '2026-06-11'; L.el('v-handled').value = '2026-06-09'; L.el('v-done').value = '2026-06-20';
    L.el('v-amount').value = '33000'; L.el('v-vendor').value = 'v1'; L.el('v-content').value = '架空の部品交換'; L.el('v-next').value = '2026-12-01';
    L.el('fx-0').value = '2026-06-12'; L.el('fx-1').value = '高';
    L.ctx.act_('today', { getAttribute: (k) => (k === 'data-for' ? 'v-done' : null) });
    t('「今日」ボタンで今日の日付を入れる', L.el('v-done').value === CALC.todayJST());
    L.el('v-done').value = '2026-06-20';
    L.ctx.paintWarn_();
    t('日付の順の逆転は黄色で知らせる（対応日が依頼日より前）', /warn/.test(L.els['d-warn'].className) && /対応日/.test(L.els['d-warn'].textContent), L.els['d-warn'].textContent);
    const ok2 = await L.ctx.saveForm_(); await settle();
    const se = L.rpcs('eq_save_event')[0];
    t('日付の順の逆転でも保存は止めない', ok2 === true && !!se);
    t('記録の保存: 4つの日付・金額・業者・増やした項目（extra）を送る', se && se.args.p_row.found_on === '2026-06-10' && se.args.p_row.requested_on === '2026-06-11' && se.args.p_row.handled_on === '2026-06-09' && se.args.p_row.done_on === '2026-06-20'
      && se.args.p_row.amount === 33000 && se.args.p_row.vendor_id === 'v1' && se.args.p_row.extra.fd1 === '2026-06-12' && se.args.p_row.extra.fd2 === '高' && se.args.p_row.kind === 'facility', se && se.args.p_row);
    t('送る項目の名前は共通 DB（eq_*）の書ける項目だけ（設備・記録）', Object.keys(sa.args.p_row).every((k) => ['id', 'kind', 'place_key', 'place_name', 'category', 'name', 'maker', 'model', 'serial', 'bought_on', 'price', 'vendor_id', 'warranty_until', 'cycle_months', 'next_due', 'status', 'note', 'extra'].includes(k))
      && Object.keys(se.args.p_row).every((k) => ['id', 'asset_id', 'kind', 'place_key', 'etype', 'found_on', 'requested_on', 'handled_on', 'done_on', 'amount', 'vendor_id', 'staff_name', 'body', 'next_due', 'extra'].includes(k)), { a: Object.keys(sa.args.p_row), e: Object.keys(se.args.p_row) });
    L.ctx.tab = 'events'; L.ctx.paintAll_();
    const ev = L.els['p-events'].innerHTML;
    t('時系列: 新しい記録が出て、増やした項目の列（見積受領日・緊急度）がある', /架空の部品交換/.test(ev) && /<th scope="col">見積受領日<\/th>/.test(ev) && /<td data-label="見積受領日"><div class="v">2026-06-12<\/div><\/td>/.test(ev) && ev.indexOf('架空の部品交換') < ev.indexOf('架空の修理'));
    L.ctx.tab = 'sched'; L.ctx.paintAll_();
    t('予定: 記録の次回予定日（2026-12-01）が出る', /2026-12-01/.test(L.els['p-sched'].innerHTML));
    L.ctx.tab = 'cost'; L.ctx.paintAll_();
    L.ctx.costFy = 2026; L.ctx.paintAll_();
    t('費用: 2026年度の合計に入る（11000 + 33000 = 44,000円）', /合計 44,000円/.test(L.els['p-cost'].innerHTML), (L.els['p-cost'].innerHTML.match(/合計[^<]*/) || [])[0]);
    const csv = L.ctx.downloadCsv_();
    t('CSV: 書き出しに増やした項目の列と新しい記録が入る', /見積受領日,緊急度/.test(csv.split('\r\n')[0]) && /架空の部品交換/.test(csv) && L.log.some((x) => x.kind === 'download' && x.name === 'equip-log-2026.csv'));
  }

  group('4b. 業者・場所の保存');
  {
    const L = await opened({ rpc: { eq_list: okList(), eq_save_vendor: saver({}), eq_save_place: saver({}) } });
    L.ctx.openVendor_(null);
    L.el('n-name').value = '架空設備2'; L.el('n-field').value = '電気'; L.el('n-tel').value = '000-0000-0009'; L.el('n-contact').value = '架空 担当'; L.el('n-memo').value = 'メモ'; L.el('n-inactive').checked = true;
    const ok = await L.ctx.saveForm_(); await settle();
    const sv = L.rpcs('eq_save_vendor')[0];
    t('業者の保存: 送る項目の名前は共通 DB（eq_*）の書ける項目だけ（name・field・phone・contact・note・disabled）', ok === true && sv && Object.keys(sv.args.p_row).sort().join() === 'contact,disabled,field,name,note,phone' && sv.args.p_row.phone === '000-0000-0009' && sv.args.p_row.disabled === true, sv && sv.args.p_row);
    L.ctx.openPlace_();
    L.el('l-name').value = '架空の駐車場'; L.el('l-kind').value = 'daycare';
    const ok2 = await L.ctx.saveForm_(); await settle();
    const sp = L.rpcs('eq_save_place')[0];
    t('場所の保存: kind・name・sort だけを送り、図面の「その他の場所」に出る', ok2 === true && sp && Object.keys(sp.args.p_row).sort().join() === 'kind,name,sort' && /架空の駐車場/.test(L.els['p-map'].innerHTML), sp && sp.args.p_row);
  }

  group('5. 古い版の保存は差し替えて知らせる');
  {
    const cur = Object.assign(baseData().assets[0], { rev: 5, name: '他で直した名前' });
    const L = await opened({ rpc: { eq_list: okList(), eq_save_asset: () => ({ ok: false, conflict: true, row: cur }) } });
    L.ctx.openAsset_('a1');
    L.el('a-name').value = '私の直し'; L.el('a-place').value = 'room:101'; L.el('a-kind').value = 'facility'; L.el('a-status').value = 'active';
    L.ctx.form.dirty = true;
    const ok = await L.ctx.saveForm_(); await settle();
    t('古い rev: 送った版は開いた時の 1', L.rpcs('eq_save_asset')[0].args.p_rev === 1);
    t('古い rev: 「他で直されました。読み直してください」を出し、行を今の行に差し替える', ok === false && /他で直されました。読み直してください/.test(L.els['d-msg'].textContent) && L.ctx.data.assets[0].name === '他で直した名前' && L.ctx.data.assets[0].rev === 5);
    t('古い rev: 窓は閉じず、入力は残す（黙って捨てない）', L.ctx.form && L.ctx.form.kind === 'asset' && L.el('a-name').value === '私の直し' && L.ctx.isDirty_() === true);
  }

  group('6. 取り消した記録は印つきで残り集計から外れる');
  {
    const store = { e1: Object.assign(baseData().events[0]) };
    const L = await opened({ rpc: { eq_list: okList(), eq_cancel_event: (a) => ({ ok: true, row: Object.assign({}, store.e1, { cancelled_at: '2026-11-03T01:00:00Z', cancelled_by: 'u-kakuu', rev: a.p_rev + 1 }) }) } });
    L.ctx.costFy = 2026; L.ctx.tab = 'cost'; L.ctx.paintAll_();
    t('取り消しの前: 費用の合計は 11,000円', /合計 11,000円/.test(L.els['p-cost'].innerHTML));
    const p = L.ctx.cancelEvent_('e1'); await settle();
    t('取り消しの確かめの窓を出す', /取り消しますか/.test(L.els['e-dlg'].innerHTML));
    L.ctx.act_('confirm-ok', {}); await p; await settle();
    const c = L.rpcs('eq_cancel_event')[0];
    t('取り消し: eq_cancel_event に p_id と p_rev を送る', c && c.args.p_id === 'e1' && c.args.p_rev === 1, c && c.args);
    L.ctx.tab = 'cost'; L.ctx.paintAll_();
    t('取り消しの除外: 費用の合計から外れる（0円）', /合計 0円/.test(L.els['p-cost'].innerHTML));
    L.ctx.tab = 'events'; L.ctx.paintAll_();
    t('取り消した記録は消えずに印つき（取り消し）で残り、取り消すボタンは出さない', /class="cxl"/.test(L.els['p-events'].innerHTML) && /取り消し<\/span>/.test(L.els['p-events'].innerHTML) && !/data-act="event-cancel"/.test(L.els['p-events'].innerHTML));
  }

  group('7. 準備中（共通 DB に関数が無い）');
  for (const code of ['PGRST202', 'PGRST205', '42P01']) {
    const L = await opened({ rpc: { eq_list: () => ({ __error: { code, message: 'not found' } }) } });
    const all = allPanels(L);
    t('準備中 ' + code + ': 帯を出す', L.ctx.dbState === 'nodb' && !L.els['e-band'].hidden && /準備中/.test(L.els['e-band'].textContent));
    const btns = all.match(/<button[^>]*data-act="(asset-new|event-new|place-new|vendor-new|field-new|asset-retire|event-cancel|field-toggle|field-edit)"[^>]*>/g) || [];
    t('準備中 ' + code + ': 追加・取り消し・項目の設定のボタンは全部押せない', btns.length > 0 && btns.every((b) => /disabled/.test(b)), btns.filter((b) => !/disabled/.test(b)));
    if (code === 'PGRST202') {
      L.ctx.openVendor_(null); L.el('n-name').value = '架空';
      const ok = await L.ctx.saveForm_(); await settle();
      t('準備中: 保存ボタンも押せず、呼んでも保存しない（RPC を送らない）', /data-act="dlg-save" disabled/.test(L.els['e-dlg'].innerHTML) && ok === false && L.rpcs('eq_save_vendor').length === 0);
    }
  }
  {
    const L = await opened({ rpc: { eq_list: () => ({ __error: { code: '500', message: 'Failed to fetch' } }) } });
    t('ほかの失敗: 準備中の帯は出さず、通常のエラー（読み直す）', L.ctx.dbState === 'error' && L.els['e-band'].hidden && /通信できませんでした/.test(L.els['e-msg'].textContent) && /data-act="reload"/.test(L.els['p-map'].innerHTML));
  }

  group('8. UI 状態の復元のホワイトリスト（未知値は既定へ）・端末に残すもの');
  {
    const L = await opened({ local: { eql_tab: 'cost', eql_floor: 'f2', eql_filter: JSON.stringify({ etype: 'repair', vendor: 'v1', fy: '2026' }) } });
    t('再読み込み: 同じタブ（費用）・同じ階（2階）のまま', L.ctx.tab === 'cost' && L.ctx.floor === 'f2' && !L.els['p-cost'].hidden && L.ctx.filter.etype === 'repair');
    const B = await opened({ local: { eql_tab: '<script>', eql_floor: 'f9', eql_filter: '{壊れ' } });
    t('UI 状態の復元のホワイトリスト（未知値は既定へ）: 図面・1階・絞り込みなし', B.ctx.tab === 'map' && B.ctx.floor === 'f1' && JSON.stringify(B.ctx.filter) === JSON.stringify(CALC.FILTER_DEF));
    B.ctx.setTab_('events');
    B.ctx.onChange_({ target: { getAttribute: (k) => (k === 'data-filter' ? 'etype' : null), value: 'cleaning' } });
    B.ctx.onChange_({ target: { getAttribute: (k) => (k === 'data-filter' ? 'kind' : null), value: '<b>' } });
    t('絞り込み: 既知の値だけを控える（不正な値は空に戻す）', JSON.parse(B.ls.getItem('eql_filter')).etype === 'cleaning' && JSON.parse(B.ls.getItem('eql_filter')).kind === '');
    const keys = [...new Set(B.writes.filter((w) => w[0] === 'set').map((w) => w[1]))].sort();
    t('端末に書く鍵は eql_tab・eql_floor・eql_filter だけ（記録・業者・氏名は書かない）', keys.every((k) => /^eql_(tab|floor|filter)$/.test(k)) && !B.writes.some((w) => /架空/.test(w[2] || '')), keys);
  }

  group('9. 危険な値（<img onerror>）がエスケープされる');
  {
    const d = baseData();
    d.assets[0] = Object.assign(d.assets[0], { name: BAD, maker: BAD, note: BAD, extra: { fa1: BAD } });
    d.events[0] = Object.assign(d.events[0], { body: BAD, staff_name: BAD, extra: { fd2: BAD } });
    d.vendors[0] = Object.assign(d.vendors[0], { name: BAD, field: BAD, phone: BAD });
    d.places[0] = Object.assign(d.places[0], { name: BAD });
    d.fields[0] = Object.assign(d.fields[0], { name: BAD });
    d.fields[1] = Object.assign(d.fields[1], { options: [BAD] });
    d.events.push({ id: 'e9', asset_id: null, place_key: 'area:' + BAD, etype: BAD, amount: 1, handled_on: '2026-06-01', rev: 1 });
    const L = await opened({ rpc: { eq_list: () => d } });
    L.ctx.selPlace = 'room:101';
    L.ctx.filter = { etype: '', kind: '', place: '', vendor: '', fy: '' };
    let all = allPanels(L);
    L.ctx.fieldTarget = 'asset'; L.ctx.tab = 'fields'; L.ctx.paintAll_(); all += L.els['p-fields'].innerHTML;
    L.ctx.openAsset_('a1'); all += L.els['e-dlg'].innerHTML;
    L.ctx.openEvent_('e1'); all += L.els['e-dlg'].innerHTML;
    L.ctx.openVendor_('v1'); all += L.els['e-dlg'].innerHTML;
    t('<img onerror> がエスケープされる（img・script の要素が生まれない）', !/<img|<script/i.test(all), (all.match(/<(img|script)[^>]*/gi) || []).slice(0, 3));
    t('タグの中に onerror= が入らない（属性の値の中は数えない）', !/<[^>]*onerror=/i.test(all.replace(/"[^"]*"/g, '""')));
    t('値は文字として残る', (all.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 8, (all.match(/&lt;img/g) || []).length);
  }

  group('10. 増やした項目の値の確かめ・「使わない」・削除なし');
  {
    const store = {};
    const L = await opened({ rpc: { eq_list: okList(), eq_save_event: saver(store), eq_save_field: saver(Object.fromEntries(baseData().fields.map((f) => [f.id, f]))) } });
    L.ctx.openEvent_(null, 'room:101', 'a1');
    L.el('v-place').value = 'room:101'; L.el('v-etype').value = 'repair'; L.el('v-amount').value = '0'; L.el('fx-0').value = '2026/06/12';
    let ok = await L.ctx.saveForm_(); await settle();
    t('増やした項目 date: YYYY-MM-DD でない値は保存の前に断る（RPC を送らない）', ok === false && L.rpcs('eq_save_event').length === 0 && /見積受領日/.test(L.els['d-msg'].textContent), L.els['d-msg'].textContent);
    L.el('fx-0').value = ''; L.el('v-amount').value = '-5';
    ok = await L.ctx.saveForm_(); await settle();
    t('金額が負なら保存の前に断る', ok === false && L.rpcs('eq_save_event').length === 0 && /金額/.test(L.els['d-msg'].textContent));
    L.el('v-amount').value = '1000';
    ok = await L.ctx.saveForm_(); await settle();
    t('正しい値なら保存する', ok === true && L.rpcs('eq_save_event').length === 1);
    L.ctx.closeDlg_();
    await L.ctx.toggleField_('fd2'); await settle();
    const tf = L.rpcs('eq_save_field')[0];
    t('「使わない」: eq_save_field に disabled=true を送る（名前・種類・選択肢はそのまま・書ける項目だけ）', tf && tf.args.p_row.disabled === true && tf.args.p_row.name === '緊急度' && tf.args.p_row.ftype === 'select' && tf.args.p_rev === 1
      && Object.keys(tf.args.p_row).every((k) => ['id', 'target', 'name', 'ftype', 'options', 'sort', 'disabled'].includes(k)), tf && tf.args);
    t('「使わない」の項目に値がある記録は、列と入力に値を残す（入力は読むだけ）', (() => {
      L.ctx.data.events[0].extra = { fd2: '高' };
      L.ctx.tab = 'events'; L.ctx.paintAll_();
      const h = L.els['p-events'].innerHTML;
      L.ctx.openEvent_('e1');
      return /<th scope="col">緊急度<\/th>/.test(h) && /value="高" readonly/.test(L.els['e-dlg'].innerHTML);
    })());
    L.el('v-place').value = 'room:101'; L.el('v-etype').value = 'repair'; L.el('v-amount').value = '11000';
    const n0 = L.rpcs('eq_save_event').length;
    ok = await L.ctx.saveForm_(); await settle();
    const last = L.rpcs('eq_save_event')[n0];
    t('「使わない」の項目の今の値は保存しても消えない', ok === true && last && last.args.p_row.extra.fd2 === '高', last && last.args.p_row.extra);
    {
      /* 選択肢から外した値を持つ記録を開いて保存しても、その値は消えない */
      const X = await opened({ rpc: { eq_list: okList(), eq_save_event: saver({}) } });
      X.ctx.data.fields.forEach((f) => { if (f.id === 'fd2') f.options = ['低']; });
      X.ctx.data.events[0].extra = { fd2: '高' };
      X.ctx.openEvent_('e1');
      const h = X.els['e-dlg'].innerHTML;
      const sel = /<select id="fx-1">([\s\S]*?)<\/select>/.exec(h);
      const picked = sel && /<option value="([^"]*)" selected>/.exec(sel[1]);
      t('選択肢から外した今の値は、候補に残して選ばれた状態で開く', !!picked && picked[1] === '高' && /今は無い選択肢/.test(sel[1]), sel && sel[1]);
      X.el('v-place').value = 'room:101'; X.el('v-etype').value = 'repair'; X.el('v-amount').value = '11000'; X.el('fx-1').value = picked ? picked[1] : '';
      const okx = await X.ctx.saveForm_(); await settle();
      const sx = X.rpcs('eq_save_event')[0];
      t('選択肢から外した値を持つ記録を開いて保存すると、extra にその値が残る', okx === true && sx && sx.args.p_row.extra.fd2 === '高', sx && sx.args.p_row.extra);
    }
    t('削除の操作（eq_hard_delete・項目の削除）は画面に無い', !/eq_hard_delete/.test(S) && !/data-act="field-del/.test(S));
  }

  group('11. 添付（JPEG・PNG・PDF・10MB まで）');
  {
    const L = await opened({ rpc: { eq_list: okList(), eq_register_file: (a) => ({ ok: true, row: { id: 'fl1', event_id: a.p_event_id, name: a.p_name, mime: a.p_mime, size: a.p_size, object_key: 't1/e1/fl1.' + (a.p_mime === 'application/pdf' ? 'pdf' : 'jpg') } }), eq_remove_file: () => ({ ok: true }) } });
    L.ctx.openEvent_('e1'); await settle();
    const tr = L.log.filter((x) => x.kind === 'table');
    t('記録を開くと添付の台帳（eq_files）をその記録の分だけ読む（表へは書かない）', tr.length === 1 && tr[0].table === 'eq_files' && tr[0].ops.some((o) => o[0] === 'eq' && o[1] === 'event_id' && o[2] === 'e1') && !tr[0].ops.some((o) => /insert|update|delete|upsert/.test(o[0])), tr);
    await L.ctx.uploadFiles_([{ name: '架空.gif', type: 'image/gif', size: 10 }, { name: '大きい.pdf', type: 'application/pdf', size: 10485761 }]); await settle();
    t('種類違い・10MB 超えは台帳にも置き場にも送らない', L.rpcs('eq_register_file').length === 0 && L.stores().length === 0 && /JPEG・PNG・PDF/.test(L.els['d-fmsg'].textContent) && /10MB/.test(L.els['d-fmsg'].textContent));
    await L.ctx.uploadFiles_([{ name: '領収書.pdf', type: 'application/pdf', size: 2048 }]); await settle();
    const up = L.stores().find((x) => x.op === 'upload');
    t('台帳 → 置き場の順で、受け取った鍵で置く（eq-files）', L.rpcs('eq_register_file').length === 1 && up && up.bucket === 'eq-files' && up.args[0] === 't1/e1/fl1.pdf' && L.ctx.data.files.length === 1);
    const F = await opened({ rpc: { eq_list: okList(), eq_register_file: () => ({ ok: true, row: { id: 'fl2', event_id: 'e1', name: 'x.jpg', object_key: 't1/e1/fl2.jpg' } }), eq_remove_file: () => ({ ok: true }) }, storage: { upload: () => ({ data: null, error: { message: 'boom' } }) } });
    F.ctx.openEvent_('e1'); await settle();
    await F.ctx.uploadFiles_([{ name: 'x.jpg', type: 'image/jpeg', size: 100 }]); await settle();
    t('置けなかった時は台帳から外す（eq_remove_file）', F.rpcs('eq_remove_file').length === 1 && F.rpcs('eq_remove_file')[0].args.p_file_id === 'fl2' && F.ctx.data.files.length === 0);
    const btn = (fid) => ({ getAttribute: (k) => (k === 'data-fid' ? fid : null) });
    const rmCount = () => L.stores().filter((x) => x.op === 'remove').length;
    L.ctx.act_('file-del', btn('fl1')); await settle();
    t('「外す」を1回押しただけでは置き場から消さず、確認を出す（元に戻せないため・dev-principles 4）', rmCount() === 0 && L.rpcs('eq_remove_file').length === 0 && /元に戻せません/.test(L.els['d-files'].innerHTML) && /data-act="file-del-ok"/.test(L.els['d-files'].innerHTML));
    L.ctx.act_('file-del-no', btn('fl1')); await settle();
    t('確認で「やめる」を押すと何も消さず、確認も消える', rmCount() === 0 && L.ctx.data.files.length === 1 && !/元に戻せません/.test(L.els['d-files'].innerHTML));
    L.ctx.act_('file-del', btn('fl1')); await settle();
    await L.ctx.act_('file-del-ok', btn('fl1')); await settle();
    t('確認で「外す」を押すと置き場 → 台帳の順で外す', rmCount() === 1 && L.rpcs('eq_remove_file').length === 1 && L.ctx.data.files.length === 0);
  }

  group('11b. 共通 DB が ok:false を返した時');
  {
    const N = await opened({ rpc: { eq_list: okList(), eq_save_vendor: () => ({ ok: false, error: 'notfound' }) } });
    const notes = []; N.ctx.window.SUErrors = { note: (tool, e, where) => notes.push([tool, e && e.message, where]) };
    N.ctx.form = { kind: 'vendor', row: {}, rev: null, dirty: true, busy: false };
    const ok = await N.ctx.saveRow_('vendor', { name: '架空設備' }, null, []); await settle();
    t('保存しない・理由に合う言葉を出す（notfound → 読み直しを促す）', ok === false && /見つかりませんでした/.test(N.el('d-msg').textContent), [ok, N.el('d-msg').textContent]);
    t('不具合の記録（SUErrors.note）に残す（何度試しても通らない原因を見えるようにする）', notes.length === 1 && notes[0][2] === 'equip:eq_save_vendor' && /notfound/.test(notes[0][1]), notes);
  }

  group('13a. U1 どのタブからも押せる主ボタン（選んだ場所入り・3手）');
  {
    const store = {};
    const L = await opened({ rpc: { eq_list: okList(), eq_save_event: saver(store) } });
    t('主ボタン: タブ列の下に「＋ 記録を足す」「＋ 設備を足す」があり、タブの中（p-*）ではない', /<\/nav>\n    <div class="tools">[\s\S]*?<button type="button" class="btn pri" id="e-add-ev" data-act="event-new">＋ 記録を足す<\/button>\n        <button type="button" class="btn pri" id="e-add-as" data-act="asset-new">＋ 設備を足す<\/button>/.test(HTML));
    t('主ボタン: 読み込めた時は押せる', L.els['e-add-ev'].disabled === false && L.els['e-add-as'].disabled === false);
    L.ctx.act_('place', { getAttribute: (k) => (k === 'data-key' ? 'room:101' : null) });
    t('主ボタン: 図面で場所を選ぶと名前に場所を添える', L.els['e-add-ev'].textContent === '＋ 記録を足す（101）' && L.els['e-add-as'].textContent === '＋ 設備を足す（101）', [L.els['e-add-ev'].textContent, L.els['e-add-as'].textContent]);
    L.ctx.tab = 'cost'; L.ctx.paintAll_();
    L.ctx.act_('event-new', { getAttribute: () => null });
    t('主ボタン: 別のタブ（費用）から押しても、選んだ場所（101）入りの記録の窓で開く', L.ctx.form && L.ctx.form.kind === 'event' && L.ctx.form.row.place_key === 'room:101' && /<option value="room:101" selected>/.test(L.els['e-dlg'].innerHTML));
    L.el('v-place').value = 'room:101'; L.el('v-etype').value = 'repair'; L.el('v-amount').value = '0';
    const ok = await L.ctx.saveForm_(); await settle();
    t('3手: 場所を選ぶ → 「＋ 記録を足す」→ 保存 で記録が残る', ok === true && L.rpcs('eq_save_event').length === 1 && L.rpcs('eq_save_event')[0].args.p_row.place_key === 'room:101');
    L.ctx.act_('asset-new', { getAttribute: () => null });
    t('「＋ 設備を足す」も選んだ場所で開く', L.ctx.form && L.ctx.form.kind === 'asset' && L.ctx.form.row.place_key === 'room:101');
    const N = await opened({ rpc: { eq_list: () => ({ __error: { code: 'PGRST202', message: 'not found' } }) } });
    t('主ボタン: 準備中（共通 DB に仕組みが無い）は押せない', N.els['e-add-ev'].disabled === true && N.els['e-add-as'].disabled === true);
  }

  group('13b. U2 上部の検索1つ（設備・対応の記録・予定を絞る・端末に保存しない）');
  {
    const d = () => {
      const x = baseData();
      x.vendors.push({ id: 'v2', name: '架空冷凍サービス', rev: 1 });
      x.assets.push({ id: 'a2', kind: 'facility', place_key: 'room:102', category: 'kitchen', name: '架空冷蔵庫', maker: 'レイゾウ工業', model: 'RF-9', serial: 'SN-55', vendor_id: 'v2', status: 'active', next_due: '2027-01-10', rev: 1, extra: { fa1: 'K-777' } });
      x.events.push({ id: 'e2', asset_id: 'a2', place_key: 'room:102', etype: 'cleaning', handled_on: '2026-06-01', amount: 3000, body: '架空の霜取り', rev: 1, extra: { fd2: '低' } });
      return x;
    };
    const L = await opened({ rpc: { eq_list: d } });
    t('検索の欄: type="search"・aria-label あり・見える名前（探す）・タブの外に1つだけ', (HTML.match(/type="search"/g) || []).length === 1 && /<label for="e-q">探す<\/label><input id="e-q" type="search" maxlength="100" autocomplete="off" aria-label="[^"]+"/.test(HTML));
    const q = (v) => L.ctx.onAppInput_({ target: { id: 'e-q', value: v } });
    L.ctx.tab = 'assets'; q('rf-9');
    let h = L.els['p-assets'].innerHTML;
    t('設備: 型番（大文字・小文字をそろえる）で絞る → 架空冷蔵庫だけ・1件', /架空冷蔵庫/.test(h) && !/架空エアコン/.test(h) && /「rf-9」で絞り込み中：1件/.test(h) && /data-act="q-clear"/.test(h));
    for (const [w, want] of [['SN-55', 'a2'], ['レイゾウ', 'a2'], ['架空冷凍', 'a2'], ['K-777', 'a2']]) {
      q(w); h = L.els['p-assets'].innerHTML;
      t('設備: 「' + w + '」（製造番号・メーカー・業者名・増やした項目）で ' + want + ' だけ', /data-id="a2"/.test(h) && !/data-id="a1"/.test(h));
    }
    L.ctx.tab = 'events'; q('霜取り');
    h = L.els['p-events'].innerHTML;
    t('対応の記録: 内容で絞る → 霜取りだけ', /架空の霜取り/.test(h) && !/架空の修理/.test(h));
    q('架空設備'); h = L.els['p-events'].innerHTML;
    t('対応の記録: 業者名で絞る → 架空設備の記録だけ', /架空の修理/.test(h) && !/架空の霜取り/.test(h));
    q('低'); h = L.els['p-events'].innerHTML;
    t('対応の記録: 増やした項目（選択肢）の値で絞る', /架空の霜取り/.test(h) && !/架空の修理/.test(h));
    q('架空冷蔵庫 霜'); h = L.els['p-events'].innerHTML;
    t('対応の記録: 付いている設備の名前と内容の AND', /架空の霜取り/.test(h) && !/架空の修理/.test(h));
    q('該当なしの語'); h = L.els['p-events'].innerHTML;
    t('合わない時は「検索と絞り込みに合う記録がありません」', /検索と絞り込みに合う記録がありません/.test(h) && !/<table/.test(h));
    L.ctx.tab = 'sched'; q('RF-9');
    h = L.els['p-sched'].innerHTML;
    t('予定: 設備の語で絞る → 架空冷蔵庫の予定だけ', /data-asset="a2"/.test(h) && !/data-asset="a1"/.test(h) && /2027-01-10/.test(h));
    L.ctx.act_('q-clear', {});
    h = L.els['p-sched'].innerHTML;
    t('「検索を消す」で全部に戻り、欄も空になる', L.ctx.query === '' && L.els['e-q'].value === '' && /data-asset="a1"/.test(h) && /data-asset="a2"/.test(h));
    t('検索語は端末に保存しない（書いたのは eql_ の鍵だけ・検索語の文字が無い）', L.writes.every((w) => /^eql_(tab|floor|filter)$/.test(w[1])) && !L.writes.some((w) => /RF-9|霜取り|架空設備/.test(w[2] || '')), L.writes);
    t('検索の欄以外の入力（id が e-q でない）は受け付けない', L.ctx.onAppInput_({ target: { id: 'x', value: 'abc' } }) === false && L.ctx.query === '');
  }

  group('13c. U3 図面の印（期限切れ・修理中・凡例）と階の切替');
  {
    const d = () => {
      const x = baseData();
      x.assets[0].status = 'repairing';
      x.assets.push({ id: 'a2', kind: 'facility', place_key: 'room:102', category: 'kitchen', name: '架空冷蔵庫', status: 'active', next_due: '2020-01-01', rev: 1, extra: {} });
      return x;
    };
    const plan = JSON.parse(JSON.stringify(PLAN)); plan.f1.title = '本館１階（居室）'; plan.f2.title = '別館';
    const L = await opened({ rpc: { eq_list: d }, plan });
    const map = L.els['p-map'].innerHTML;
    const box = (k) => (new RegExp('<button type="button" class="pl[^"]*" style="[^"]*" data-act="place" data-key="' + k + '"[^>]*>[\\s\\S]*?</button>').exec(map) || [''])[0];
    t('修理中の設備がある部屋に「修理中」の印（文字つき・黄系）', /<span class="mk rep">修理中<\/span>/.test(box('room:101')) && !/mk over/.test(box('room:101')), box('room:101'));
    t('期限切れの予定がある部屋に「！期限切れ」の印（文字つき・赤系の枠）', /<span class="mk over">！期限切れ<\/span>/.test(box('room:102')) && /class="pl has-over"/.test(box('room:102')) && /設備 1/.test(box('room:102')), box('room:102'));
    t('印の無い箱には印を出さない（厨房）', !/class="mk/.test(box('area:f1:厨房')) && box('area:f1:厨房') !== '');
    t('図面の下に凡例（印の意味を文字で）', /<ul class="legend" aria-label="図面の印の意味">/.test(map) && /！期限切れ<\/span> 点検・清掃などの予定日を過ぎている/.test(map) && /修理中<\/span> 状態が「修理中」の設備がある/.test(map) && map.indexOf('class="legend"') > map.indexOf('class="plan"'));
    t('階の切替の名前: title から「N階」を抜く（本館１階（居室）→ 1階）・抜けなければ title のまま（別館）', /data-floor="f1" aria-pressed="true">1階<\/button>/.test(map) && /data-floor="f2" aria-pressed="false">別館<\/button>/.test(map), (map.match(/data-floor="[^<]*<\/button>/g) || []));
    t('押している切替に押した見た目（CSS の .btn[aria-pressed="true"] と ✓）', /\.btn\[aria-pressed="true"\]\{background:var\(--pri\); border-color:var\(--pri\); color:#fff\}/.test(HTML) && /\.btn\[aria-pressed="true"\]::before\{content:"✓ "\}/.test(HTML));
    t('印の色は今の色の名前だけ（新しい色コードを足さない）', /\.mk\.over\{background:var\(--ng-l\); color:var\(--ng\); border-color:var\(--ng\)\}/.test(HTML) && /\.mk\.rep\{background:var\(--warn-bg\); color:var\(--warn-tx\); border-color:var\(--warn-tx\)\}/.test(HTML));
  }

  group('13d. U7 設備のカルテ（読む画面）');
  {
    const soon = CALC.addDays(CALC.todayJST(), 10), past = CALC.addDays(CALC.todayJST(), -3);
    const d = () => {
      const x = baseData();
      Object.assign(x.assets[0], { maker: 'カクウ電機', model: 'AC-100', serial: 'SN-77', price: 98000, vendor_id: 'v1', warranty_until: soon, extra: { fa1: 'K-001' } });
      x.assets.push({ id: 'a2', kind: 'facility', place_key: 'room:102', category: 'kitchen', name: '架空冷蔵庫', status: 'active', warranty_until: past, rev: 1, extra: {} });
      x.events.push({ id: 'e3', asset_id: 'a1', place_key: 'room:101', etype: 'inspection', handled_on: '2026-08-01', amount: 5000, cancelled_at: '2026-08-02T00:00:00Z', rev: 2, extra: {} });
      x.events.push({ id: 'e4', asset_id: 'a1', place_key: 'room:101', etype: 'cleaning', handled_on: '2026-09-01', amount: 2200, body: '架空の清掃', rev: 1, extra: {} });
      return x;
    };
    const L = await opened({ rpc: { eq_list: d }, tables: { eq_files: [{ id: 'f1', event_id: 'e1' }, { id: 'f2', event_id: 'e1' }] } });
    L.ctx.act_('asset-edit', { getAttribute: (k) => (k === 'data-id' ? 'a1' : null) });
    let c = L.els['e-dlg'].innerHTML;
    t('設備の「開く」は、まずカルテ（読む画面）を出す（編集の欄は無い）', L.ctx.form && L.ctx.form.kind === 'card' && /<h2 id="e-dlg-h">架空エアコン<\/h2>/.test(c) && !/id="a-name"/.test(c));
    t('カルテ: 基本情報（メーカー・型番・製造番号・購入金額の桁区切り・購入先の業者・増やした項目）', /<dt>メーカー<\/dt><dd>カクウ電機<\/dd>/.test(c) && /<dt>型番<\/dt><dd>AC-100<\/dd>/.test(c) && /<dt>製造番号<\/dt><dd>SN-77<\/dd>/.test(c)
      && /<dt>購入金額<\/dt><dd>98,000円<\/dd>/.test(c) && /<dt>購入先の業者<\/dt><dd>架空設備<\/dd>/.test(c) && /<dt>資産番号<\/dt><dd>K-001<\/dd>/.test(c));
    t('カルテ: 状態・次回予定日', /<dt>状態<\/dt><dd>使用中<\/dd>/.test(c) && /<dt>次回予定日<\/dt><dd>/.test(c));
    t('カルテ: 保証の残り（あと10日・30日以内の印）', new RegExp('<dt>保証の残り</dt><dd>' + soon + 'まで（あと10日） <span class="tag soon">30日以内</span></dd>').test(c), (c.match(/<dt>保証の残り<\/dt><dd>[^]*?<\/dd>/) || [])[0]);
    t('カルテ: 累計費用は取り消しを除く（11,000 + 2,200 = 13,200円・2件）', /<dt>累計費用<\/dt><dd>13,200円（2件・取り消した記録を除く）<\/dd>/.test(c));
    const tl = /<div id="d-card-ev">([\s\S]*?)<\/div><div class="dlg-btns">/.exec(c);
    t('カルテ: その設備の対応の時系列（新しい順・取り消しも印つきで残す・ほかの設備の記録は出さない）', !!tl && tl[1].indexOf('data-id="e4"') < tl[1].indexOf('data-id="e3"') && tl[1].indexOf('data-id="e3"') < tl[1].indexOf('data-id="e1"') && /class="cxl"/.test(tl[1]) && /取り消し<\/span>/.test(tl[1]), tl && tl[1].slice(0, 300));
    t('カルテ: 「直す」「＋ 記録を足す」（設備・場所入り）「廃棄にする」のボタン', /data-act="asset-fix" data-id="a1">直す<\/button>/.test(c) && /data-act="event-new" data-key="room:101" data-asset="a1">＋ 記録を足す<\/button>/.test(c) && /data-act="asset-retire" data-id="a1">廃棄にする<\/button>/.test(c));
    await settle();
    const tr = L.log.filter((x) => x.kind === 'table');
    t('カルテ: 添付の台帳を1回だけ読む（その設備の記録の id で in・表へは書かない）', tr.length === 1 && tr[0].table === 'eq_files' && tr[0].ops.some((o) => o[0] === 'select' && o[1] === 'id,event_id')
      && tr[0].ops.some((o) => o[0] === 'in' && o[1] === 'event_id' && JSON.stringify(o[2]) === JSON.stringify(['e4', 'e3', 'e1'])) && !tr[0].ops.some((o) => /insert|update|delete|upsert/.test(o[0])), tr);
    c = L.els['d-card-ev'].innerHTML;
    t('カルテ: 記録ごとの添付の数（e1 は 2件・e4 は 添付なし）', /data-id="e1"/.test(c) && /架空設備・添付 2件/.test(c) && /2,200円・添付なし/.test(c), c.slice(0, 400));
    L.ctx.act_('asset-fix', { getAttribute: (k) => (k === 'data-id' ? 'a1' : null) });
    t('「直す」で今の編集の窓を開く', L.ctx.form && L.ctx.form.kind === 'asset' && L.ctx.form.row.id === 'a1' && /id="a-name"/.test(L.els['e-dlg'].innerHTML));
    L.ctx.closeDlg_();
    L.ctx.act_('asset-edit', { getAttribute: (k) => (k === 'data-id' ? 'a1' : null) });
    L.ctx.act_('event-new', { getAttribute: (k) => (k === 'data-key' ? 'room:101' : k === 'data-asset' ? 'a1' : null) });
    t('カルテの「＋ 記録を足す」は設備・場所が入った状態で開く', L.ctx.form && L.ctx.form.kind === 'event' && L.ctx.form.row.asset_id === 'a1' && L.ctx.form.row.place_key === 'room:101');
    L.ctx.closeDlg_();
    L.ctx.act_('asset-edit', { getAttribute: (k) => (k === 'data-id' ? 'a2' : null) });
    c = L.els['e-dlg'].innerHTML;
    t('カルテ: 保証が切れている時は「保証切れ」（何日前か）と出す・記録0件の案内', new RegExp('<dt>保証の残り</dt><dd>' + past + 'まで <span class="tag over">保証切れ</span>（3日前に終わりました）</dd>').test(c) && /この設備の記録はまだありません/.test(c));
    const E = await opened({ rpc: { eq_list: d } });
    E.ctx.db_ = () => ({ from() { const b = { select() { return b; }, in() { return b; }, then(ok, ng) { return Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'x' } }).then(ok, ng); } }; return b; } });
    E.ctx.openCard_('a1'); await settle();
    t('カルテ: 添付の台帳が準備中の時は「添付の置き場は準備中」（落ちない）', /添付の置き場は準備中/.test(E.els['d-card-ev'].innerHTML) && E.ctx.cardState === 'nodb');
  }

  group('13e. U4 業者のその場の追加・直前の記録の続き');
  {
    const vstore = {}, estore = {};
    const L = await opened({ rpc: { eq_list: okList(), eq_save_vendor: saver(vstore), eq_save_event: saver(estore) } });
    L.ctx.openEvent_(null, 'room:101', 'a1');
    const f0 = L.ctx.form;
    t('業者の欄: 前に使った業者から選ぶ select と「＋ 新しい業者」', /<div class="fi" id="v-vendor-w"><label for="v-vendor">業者<\/label><select id="v-vendor"><option value="" selected>（業者なし）<\/option><option value="v1">架空設備<\/option><\/select><button type="button" class="btn sm" data-act="vq-open" data-for="v-vendor">＋ 新しい業者<\/button><\/div>/.test(L.els['e-dlg'].innerHTML));
    L.el('v-content').value = '途中の入力'; L.ctx.onDlgInput_({ target: { id: 'v-content' } });
    L.ctx.act_('vq-open', { getAttribute: (k) => (k === 'data-for' ? 'v-vendor' : null) });
    t('「＋ 新しい業者」で、窓の中に名前の欄を出す（記録の窓は閉じない）', L.ctx.form === f0 && /<input id="d-vq-name" type="text" maxlength="80">/.test(L.els['v-vendor-w'].innerHTML) && /data-act="vq-save" data-for="v-vendor"/.test(L.els['v-vendor-w'].innerHTML));
    L.el('d-vq-name').value = '  ';
    let ok = await L.ctx.vqSave_('v-vendor'); await settle();
    t('名前が空なら保存しない（RPC を送らない）', ok === false && L.rpcs('eq_save_vendor').length === 0 && /業者の名前を入れてください/.test(L.els['d-vq-msg'].textContent));
    L.el('d-vq-name').value = '架空の新しい業者';
    L.ctx.onDlgInput_({ target: { id: 'd-vq-name' } });
    ok = await L.ctx.vqSave_('v-vendor'); await settle();
    const sv = L.rpcs('eq_save_vendor')[0];
    const nv = L.ctx.data.vendors.find((v) => v.name === '架空の新しい業者');
    t('名前だけで業者を保存する（送る項目は業者の保存と同じ6つ・新しい行）', ok === true && sv && Object.keys(sv.args.p_row).sort().join() === 'contact,disabled,field,name,note,phone' && sv.args.p_row.name === '架空の新しい業者' && sv.args.p_rev === null, sv && sv.args);
    t('保存した業者が選ばれた状態に戻り、名前の欄は閉じる', !!nv && L.el('v-vendor').value === String(nv.id) && /<option value="[^"]+" selected>架空の新しい業者<\/option>/.test(L.els['v-vendor-w'].innerHTML) && !/d-vq-name/.test(L.els['v-vendor-w'].innerHTML));
    t('未保存の記録の入力は消さない（同じ窓・内容の欄の値のまま・保存していない印のまま）', L.ctx.form === f0 && L.el('v-content').value === '途中の入力' && L.ctx.form.dirty === true && L.rpcs('eq_save_event').length === 0);
    L.el('v-place').value = 'room:101'; L.el('v-etype').value = 'inspection'; L.el('v-amount').value = '0';
    ok = await L.ctx.saveForm_(); await settle();
    L.ctx.openEvent_(null, 'room:102');
    t('直前に保存した記録の種類・業者を、次の新しい記録の初期値にする', ok === true && L.ctx.form.row.etype === 'inspection' && L.ctx.form.row.vendor_id === nv.id && /<option value="inspection" selected>/.test(L.els['e-dlg'].innerHTML) && /直前に保存した記録と同じにしています/.test(L.els['e-dlg'].innerHTML));
    L.ctx.closeDlg_();
    L.ctx.openEvent_('e1');
    t('今ある記録を開く時は、その記録の種類・業者のまま', L.ctx.form.row.etype === 'repair' && L.ctx.form.row.vendor_id === 'v1' && !/直前に保存した記録と同じ/.test(L.els['e-dlg'].innerHTML));
    t('直前の記録の続きは端末に保存しない（eql_ の鍵だけ）', L.writes.every((w) => /^eql_(tab|floor|filter)$/.test(w[1])), L.writes);
    const N = await opened({ rpc: { eq_list: okList(), eq_save_vendor: () => ({ __error: { code: '500', message: 'Failed to fetch' } }) } });
    N.ctx.openAsset_(null, 'room:101');
    t('設備の窓の「購入先の業者」も同じ作り', /<div class="fi" id="a-vendor-w"><label for="a-vendor">購入先の業者<\/label>/.test(N.els['e-dlg'].innerHTML));
    N.ctx.act_('vq-open', { getAttribute: (k) => (k === 'data-for' ? 'a-vendor' : null) });
    N.el('d-vq-name').value = '架空';
    const okn = await N.ctx.vqSave_('a-vendor'); await settle();
    t('業者を保存できなかった時は理由を出し、名前の欄と記録の窓はそのまま', okn === false && /通信できませんでした/.test(N.els['d-vq-msg'].textContent) && N.ctx.form && N.ctx.form.kind === 'asset' && N.ctx.vqOpen === 'a-vendor');
    t('知らない欄の id では開かない', N.ctx.vqOpen_('x-vendor') === false);
  }

  group('13f. U5 保存していない入力を閉じる・タブを移る前の確かめ（窓の中の2段）');
  {
    const L = await opened();
    L.ctx.tab = 'map'; L.ctx.paintAll_();
    L.ctx.openEvent_(null, 'room:101');
    const f0 = L.ctx.form;
    L.el('v-content').value = '書きかけ'; L.ctx.onDlgInput_({ target: { id: 'v-content' } });
    const r1 = L.ctx.act_('dlg-close', {});
    t('閉じる: 保存していない入力がある時は閉じず、窓の中に「保存せずに閉じますか？」を出す', r1 === false && L.ctx.form === f0 && L.els['d-ask'].hidden === false && /保存せずに閉じますか？/.test(L.els['d-ask'].innerHTML)
      && /data-act="ask-no">入力に戻る<\/button>/.test(L.els['d-ask'].innerHTML) && /data-act="ask-ok">保存せずに閉じる<\/button>/.test(L.els['d-ask'].innerHTML));
    t('閉じる前の確かめの欄は保存の窓の決まった場所にある（保存のボタンの前）', /<div class="ask" id="d-ask" role="alert" hidden><\/div><div class="dlg-btns">/.test(L.els['e-dlg'].innerHTML));
    L.ctx.act_('ask-no', {});
    t('「入力に戻る」: 確かめを消し、入力はそのまま', L.els['d-ask'].hidden === true && L.ctx.form === f0 && L.el('v-content').value === '書きかけ' && L.ctx.askFor === null);
    const r2 = L.ctx.setTab_('cost');
    t('タブを移る: 保存していない入力がある時は移らず、同じ確かめを出す', r2 === false && L.ctx.tab === 'map' && L.els['d-ask'].hidden === false && L.ctx.askFor === 'cost');
    L.ctx.act_('ask-ok', {});
    t('「保存せずに閉じる」: 窓を閉じ、選んだタブ（費用）へ移る', L.ctx.form === null && L.ctx.tab === 'cost' && L.ls.getItem('eql_tab') === 'cost' && !L.els['p-cost'].hidden);
    L.ctx.openEvent_(null, 'room:101');
    const r3 = L.ctx.setTab_('events');
    t('保存していない入力が無い時は、確かめずに閉じて移る', r3 === true && L.ctx.form === null && L.ctx.tab === 'events');
    L.ctx.act_('asset-edit', { getAttribute: (k) => (k === 'data-id' ? 'a1' : null) });
    L.ctx.onDlgInput_({ target: { id: 'x' } });
    t('カルテ（読む画面）は入力が無いので、閉じる時に確かめない', L.ctx.act_('dlg-close', {}) === true && L.ctx.form === null);
    L.ctx.openEvent_(null, 'room:101');
    L.ctx.onDlgInput_({ target: { id: 'v-content' } });
    L.ctx.closeAsk_();
    t('Esc（窓の cancel）も同じ確かめを通る', L.ctx.form && L.els['d-ask'].hidden === false && L.ctx.askFor === '');
    t('window.confirm を使わない（入力が消える別の窓を出さない）', !/window\.confirm/.test(S));
  }

  group('13g. U6 空の時の案内（次に押すボタンつき）');
  {
    const empty = () => ({ ok: true, assets: [], events: [], vendors: [], places: [], fields: [] });
    const L = await opened({ rpc: { eq_list: empty } });
    const panel = (tb) => { L.ctx.tab = tb; L.ctx.paintAll_(); return L.els['p-' + tb].innerHTML; };
    const g = (h) => (/<div class="guide">[\s\S]*?<\/div>/.exec(h) || [''])[0];
    t('設備0件: 案内と「＋ 最初の設備を足す」', /設備はまだありません/.test(g(panel('assets'))) && /<button type="button" class="btn pri" data-act="asset-new">＋ 最初の設備を足す<\/button>/.test(g(panel('assets'))));
    t('記録0件: 案内と「＋ 最初の記録を足す」', /対応の記録はまだありません/.test(g(panel('events'))) && /<button type="button" class="btn pri" data-act="event-new">＋ 最初の記録を足す<\/button>/.test(g(panel('events'))));
    t('業者0件: 案内と「＋ 最初の業者を足す」', /業者はまだありません/.test(g(panel('vendors'))) && /<button type="button" class="btn pri" data-act="vendor-new">＋ 最初の業者を足す<\/button>/.test(g(panel('vendors'))));
    t('予定0件（設備も0件）: 案内と「＋ 設備を足す」', /予定はまだありません/.test(g(panel('sched'))) && /<button type="button" class="btn pri" data-act="asset-new">＋ 設備を足す<\/button>/.test(g(panel('sched'))));
    t('項目0件: 案内と「＋ 項目を足す」', /項目はまだありません/.test(g(panel('fields'))) && /<button type="button" class="btn pri" data-act="field-new">＋ 項目を足す<\/button>/.test(g(panel('fields'))));
    const A = await opened({ rpc: { eq_list: () => Object.assign(empty(), { assets: [{ id: 'a1', place_key: 'room:101', name: '架空', status: 'active', rev: 1 }] }) } });
    A.ctx.tab = 'sched'; A.ctx.paintAll_();
    t('予定0件（設備はある）: 周期の入れ方の案内と「設備の一覧を開く」（タブを移る）', /周期（月）/.test(A.els['p-sched'].innerHTML) && /<button type="button" class="btn pri" data-tab="assets">設備の一覧を開く<\/button>/.test(A.els['p-sched'].innerHTML));
    const N = await opened({ rpc: { eq_list: () => ({ __error: { code: 'PGRST205', message: 'x' } }) } });
    const all = allPanels(N);
    const gb = all.match(/<div class="guide">[\s\S]*?<\/div>/g) || [];
    t('準備中: 案内のボタン（足す）も押せない', gb.length >= 4 && gb.every((x) => (x.match(/data-act="[a-z-]+-new"[^>]*>/g) || []).every((b) => /disabled/.test(b))), gb.length);
  }

  group('13h. 幅 900px 未満では表を札（1件1枚・見出し：値）にする・XSS');
  {
    const L = await opened();
    L.ctx.costFy = 2026;
    const all = allPanels(L);
    const tds = all.match(/<td[^>]*>/g) || [];
    t('一覧の td は全部 data-label（札の見出し）を持つ（空の年度の1行だけ colspan）', tds.length > 20 && tds.every((x) => /^<td data-label="[^"]+"/.test(x) || /^<td colspan="3"/.test(x)), tds.filter((x) => !/data-label|colspan/.test(x)).slice(0, 3));
    const mq = /@media \(max-width:899px\)\{([\s\S]*?)\n\}/.exec(HTML);
    t('幅 899px 以下: 表を札に切り替え、見出しを td::before に出し、横に流さない', !!mq && /\.tbl,\.tbl tbody,\.tbl tr,\.tbl td\{display:block; width:100%\}/.test(mq[1]) && /\.tbl td::before\{content:attr\(data-label\)/.test(mq[1])
      && /\.tbl thead\{position:absolute; width:1px; height:1px; overflow:hidden/.test(mq[1]) && /\.tbl-wrap\{overflow-x:visible\}/.test(mq[1]));
    const d = baseData();
    d.assets[0] = Object.assign(d.assets[0], { name: BAD, maker: BAD, model: BAD, serial: BAD, note: BAD, warranty_until: BAD, extra: { fa1: BAD } });
    d.events[0] = Object.assign(d.events[0], { body: BAD, extra: { fd2: BAD } });
    d.vendors[0] = Object.assign(d.vendors[0], { name: BAD });
    d.fields[2] = Object.assign(d.fields[2], { name: BAD });
    const X = await opened({ rpc: { eq_list: () => d, eq_save_vendor: () => ({ ok: true, row: { id: 'v9', name: BAD, rev: 1 } }) }, tables: { eq_files: [{ id: 'f1', event_id: 'e1' }] } });
    X.ctx.onAppInput_({ target: { id: 'e-q', value: BAD } });
    let h = allPanels(X);
    X.ctx.openCard_('a1'); await settle(); h += X.els['e-dlg'].innerHTML + X.els['d-card-ev'].innerHTML;
    X.ctx.openEvent_(null, 'room:101'); X.ctx.vqOpen_('v-vendor'); X.el('d-vq-name').value = BAD; await X.ctx.vqSave_('v-vendor'); await settle(); h += X.els['e-dlg'].innerHTML + X.els['v-vendor-w'].innerHTML;
    X.ctx.onDlgInput_({ target: { id: 'v-content' } }); X.ctx.closeAsk_(''); h += X.els['d-ask'].innerHTML;
    t('検索語・カルテ・業者のその場の追加・確かめに <img onerror> が入っても要素が生まれない', !/<img|<script/i.test(h) && (h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 8, (h.match(/<(img|script)[^>]*/gi) || []).slice(0, 3));
  }

  group('12. 読み込む部品の並び・CSP・作法');
  {
    const srcs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    t('su-errors.js が最初の script', srcs[0] === 'su-errors.js?v=2026-10-27', srcs);
    t('su-app-gate.js・su-facility.js・equip-calc.js を読む', srcs.includes('su-app-gate.js?v=2026-11-03') && srcs.includes('su-facility.js?v=2026-11-02.3') && srcs.some((s) => /^equip-calc\.js\?v=/.test(s)), srcs);
    t('su-report.js（data-tool="設備・修繕の記録"）が </body> の直前', /<script src="su-report\.js\?v=2026-10-28" data-tool="設備・修繕の記録"><\/script>\n<\/body>/.test(HTML));
    t('<html lang="ja" data-su-theme> と su-theme.css', /<html lang="ja" data-su-theme>/.test(HTML) && /<link rel="stylesheet" href="su-theme\.css\?v=/.test(HTML));
    t('Content-Security-Policy の meta が <meta charset> の直後', /<meta charset="UTF-8">\n<meta http-equiv="Content-Security-Policy" data-su-csp content="/.test(HTML));
    t('SUAppGate.run(\'equip-log\'', /SUAppGate\.run\('equip-log'/.test(S));
    t('console を使わない・インラインの on〜 が無い', !/console\./.test(S) && !/[\s"']on(click|change|input|load|error)=["']/.test(HTML));
    const sets = [...S.matchAll(/localStorage\.setItem\(([^,]*)/g)].map((m) => m[1]);
    t('localStorage に書く鍵は全部 eql_ 始まりの文字列', sets.length === 3 && sets.every((k) => /^'eql_(tab|floor|filter)'$/.test(k)), sets);
    t('施設名・事業所名を書かず、施設情報（SUFacility.officeName）から読む', /SUFacility\.officeName/.test(S));
    t('名簿を読まない（入居者の氏名の読み口を使わない）', !/getRoster|roster|resident/i.test(S));
  }

  group('14. 別の階の同じ名前の箱は別の場所（名前の箱の鍵は area:<階キー>:<名前>・2026-11-03）');
  {
    const plan = JSON.parse(JSON.stringify(PLAN));
    plan.f1.cells.push({ r: 3, c: 1, rs: 1, cs: 1, t: 'トイレ' });
    plan.f2.cells.push({ r: 2, c: 1, rs: 1, cs: 1, t: 'トイレ' });
    const store = {};
    const L = await opened({ rpc: { eq_list: okList(), eq_save_event: saver(store) }, plan });
    const side = () => (/<aside class="side cd" aria-live="polite">([\s\S]*)<\/aside>/.exec(L.els['p-map'].innerHTML) || ['', ''])[1];
    const h2 = () => (/<h2>([^<]*)<\/h2>/.exec(side()) || ['', null])[1];
    const box = (k) => (new RegExp('<button type="button" class="pl[^"]*" style="[^"]*" data-act="place" data-key="' + k + '"[^>]*>[\\s\\S]*?</button>').exec(L.els['p-map'].innerHTML) || [''])[0];
    t('1階の図面: トイレの箱の鍵は area:f1:トイレ・箱の中の文字は「トイレ」だけ（階を付けない）', /<span>トイレ<\/span>/.test(box('area:f1:トイレ')) && box('area:トイレ') === '' && box('area:f2:トイレ') === '', box('area:f1:トイレ'));
    L.ctx.act_('place', { getAttribute: (k) => (k === 'data-key' ? 'area:f1:トイレ' : null) });
    t('1階のトイレを押す: 見出しは「トイレ（1階）」・記録はまだ無い', h2() === 'トイレ（1階）' && /この場所の記録はまだありません。/.test(side()), h2());
    t('主ボタンにも「トイレ（1階）」を添える', L.els['e-add-ev'].textContent === '＋ 記録を足す（トイレ（1階））', L.els['e-add-ev'].textContent);
    L.ctx.act_('event-new', { getAttribute: () => null });
    const dlg = L.els['e-dlg'].innerHTML;
    t('記録の窓: 場所の選択肢は階ごとに別（1階のトイレを選んだ状態・2階のトイレは別の選択肢）', L.ctx.form && L.ctx.form.row.place_key === 'area:f1:トイレ'
      && /<option value="area:f1:トイレ" selected>トイレ（1階）<\/option>/.test(dlg) && /<option value="area:f2:トイレ">トイレ（2階）<\/option>/.test(dlg) && !/value="area:トイレ"/.test(dlg));
    L.el('v-place').value = L.ctx.form.row.place_key; L.el('v-etype').value = 'cleaning'; L.el('v-amount').value = '500'; L.el('v-content').value = '架空の1階トイレ清掃';
    const ok = await L.ctx.saveForm_(); await settle();
    const se = L.rpcs('eq_save_event');
    t('保存: p_row.place_key は area:f1:トイレ', ok === true && se.length === 1 && se[0].args.p_row.place_key === 'area:f1:トイレ', se.map((x) => x.args.p_row.place_key));
    L.ctx.tab = 'map'; L.ctx.paintAll_();
    t('1階のトイレの見出し・一覧にその記録が出る', h2() === 'トイレ（1階）' && /架空の1階トイレ清掃/.test(side()), side());
    L.ctx.act_('floor', { getAttribute: (k) => (k === 'data-floor' ? 'f2' : null) });
    t('2階に切り替える: 2階のトイレの箱の鍵は area:f2:トイレ', box('area:f2:トイレ') !== '' && box('area:f1:トイレ') === '');
    L.ctx.act_('place', { getAttribute: (k) => (k === 'data-key' ? 'area:f2:トイレ' : null) });
    t('2階のトイレを押す: 見出しは「トイレ（2階）」・1階の記録は出ない', h2() === 'トイレ（2階）' && /この場所の記録はまだありません。/.test(side()) && !/架空の1階トイレ清掃/.test(side()), side());
    L.ctx.tab = 'events'; L.ctx.paintAll_();
    const ev = L.els['p-events'].innerHTML;
    t('対応の記録の一覧: 場所の列は「トイレ（1階）」・絞り込みの場所に 1階・2階のトイレが別々に並ぶ', /<td data-label="場所"><div class="v">トイレ（1階）<\/div><\/td>/.test(ev)
      && /<option value="area:f1:トイレ">トイレ（1階）<\/option>/.test(ev) && /<option value="area:f2:トイレ">トイレ（2階）<\/option>/.test(ev), (ev.match(/area:f[12]:トイレ[^<]*/g) || []));
  }

  say('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('  ✗ 試験が途中で止まりました: ' + (e && e.stack || e)); process.exit(1); });
