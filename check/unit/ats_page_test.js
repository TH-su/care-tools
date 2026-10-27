/* 採用管理のページ（ats.html）の配線の試験（2026-10-26 新設・代表者承認の凍結仕様 v1）
   実行: node check/unit/ats_page_test.js
   やり方: ページの HTML から画面のスクリプトを読み、トップレベルの関数と var を1つずつ切り出して vm で動かす
          （care_meeting_page_test.js と同じ作法。HTML 全体は評価しない。通信・画面の部品は偽物）。計算の部品は本物の ats-calc.js。
   守ること:
     1. 現場端末では通信0（データベース・職員マスタ・ログインの部品の読み込みのどれも呼ばない）
     2. 管理者＋2段階認証でない時は案内だけ（アプリの欄は隠したまま・応募者を読まない）
     3. 危険な値（氏名に <img onerror> など）が文字のまま出る
     4. タブは hash → 端末の控え → 選考 の順で戻す（既知の名前だけ）。端末に書くのは UI の状態だけ
     5. 職員マスタへの登録の全経路で「登録しました」と偽らない
        （ok／ok:false／応答なし／FLUSH／処理中／保留の印を保存できない／確かめ: 1件・0件で8分未満・8分以上・2件以上／
         同じ受付番号の送り直し／2回押し）
     6. 送り方は職員マスタの apiPost と同じ形（POST・本文は JSON の文字列・redirect:'follow'・Content-Type を足さない）
     7. FLUSH_FAIL_MSG は職員マスタの画面の写し（＝GAS の定数）と1文字も違わない
     8. 評価は面接官ごと（p_interviewer）。ほかの評価を見た後は own の版で保存する
     9. 取り込みの試算は職員マスタの一覧を1回読む（読めなければ職員IDなし）・まとめの件数・ボードに出さない入職完了・採用率と年ごと（2026-10-27）
     ほか: 読み込む部品の並び・CSP・インラインの on〜 なし・console なし
   ★氏名・電話・メールはすべて架空（甲野 一郎・000-0000-0001・x@example.com）。出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.ATS_HTML || path.join(ROOT, 'ats.html'), 'utf8');
const CALC = require(path.join(ROOT, 'ats-calc.js'));

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
/* 文字列・コメント・正規表現の中のかっこを数えない切り出し（facility_print_gate_test.js と同じ作り） */
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
const STF_URL = 'https://script.google.com/macros/s/KAKUU/exec';
const FLUSH = /var FLUSH_FAIL_MSG='([^']+)';/.exec(S)[1];

function fakeStorage(log, kind, init) {
  const m = new Map(Object.entries(init || {}));
  return {
    m,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { log.push([kind, 'set', k, String(v)]); m.set(k, String(v)); },
    removeItem(k) { log.push([kind, 'remove', k]); m.delete(k); },
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] || null; }
  };
}
/* 偽のデータベース（表の読み書きと RPC）。tables は表の名前 → 行、rpc は名前 → 応答を返す関数 */
function fakeDb(opt, log) {
  const tables = opt.tables || {};
  function builder(table) {
    const b = { table, ops: [] };
    const chain = ['select', 'eq', 'order', 'insert', 'update', 'gte', 'lte'];
    chain.forEach((k) => { b[k] = function () { b.ops.push([k].concat([].slice.call(arguments))); return b; }; });
    b.then = function (ok, ng) {
      log.push({ kind: 'table', table, ops: b.ops });
      const ins = b.ops.find((o) => o[0] === 'insert');
      const data = ins ? [Object.assign({ id: 'new-' + table }, ins[1])] : (tables[table] || []);
      return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null }).then(ok, ng);
    };
    return b;
  }
  return {
    from(table) { return builder(table); },
    rpc(name, args) {
      log.push({ kind: 'rpc', name, args: JSON.parse(JSON.stringify(args)) });
      const f = (opt.rpc || {})[name];
      const v = f ? f(args) : { ok: true };
      return Promise.resolve(v && v.__error ? { data: null, error: v.__error } : { data: v, error: null });
    },
    auth: { getSession() { return Promise.resolve({ data: { session: { access_token: 'at-kakuu', user: { id: 'u-kakuu' } } } }); } }
  };
}
const OK_ST = { status: 'ok', role: 'admin', mfa: true };
function load(opt) {
  opt = opt || {};
  const writes = [], log = [], fetches = [], created = [];
  const ls = fakeStorage(writes, 'local', Object.assign({ stfm_cfg: JSON.stringify({ url: STF_URL, token: 'tok-kakuu' }) }, opt.local || {}));
  const ss = fakeStorage(writes, 'session', opt.session || {});
  if (opt.role) ls.m.set('su_device_role', opt.role);
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', className: '', hidden: id === 'a-app' || id === 'a-gate' || id === 'a-pane', disabled: false, value: '', style: {},
    classList: { add() {}, remove() {} }, setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, focus() {} });
  const db = fakeDb(opt, log);
  const SUAuth = { STATUS: { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' },
    check() { log.push({ kind: 'check' }); return Promise.resolve(opt.status || OK_ST); }, client() { return db; } };
  const win = { addEventListener() {}, SUAuth: opt.noAuth ? undefined : SUAuth, supabase: {} };
  const ctx = {
    Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error, Uint8Array, parseInt, isFinite, encodeURIComponent,
    crypto: nodeCrypto.webcrypto, TextDecoder,
    setTimeout(fn, ms) { if (!(ms >= 3000)) setImmediate(fn); return 0; }, clearTimeout() {},
    localStorage: ls, sessionStorage: ss, window: win,
    document: { activeElement: null, getElementById: el, querySelector() { return null; }, querySelectorAll() { return []; }, scripts: [], addEventListener() {},
      createElement(tag) { const x = { tag, setAttribute() {} }; created.push(x); return x; }, head: { appendChild() {} } },
    location: { hash: opt.hash || '', reload() {} },
    history: { replaceState(a, b, u) { ctx.location.hash = u; } },
    AtsCalc: CALC,
    fetch(url, o) {
      fetches.push({ url, opt: o, body: JSON.parse(o.body) });
      const r = (opt.stf || (() => ({ ok: true })))(JSON.parse(o.body));
      if (r === 'NET') return Promise.reject(new Error('通信の失敗'));
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(typeof r === 'string' ? r : JSON.stringify(r)) });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'ats.html（切り出し）' });
  const toasts = [], asks = [];
  ctx.toast = (m) => toasts.push(String(m));
  ctx.openDlg_ = (o) => { asks.push(o); return Promise.resolve(opt.answer === undefined ? (o.collect ? null : true) : opt.answer); };
  const rpcs = () => log.filter((x) => x.kind === 'rpc');
  const reads = () => log.filter((x) => x.kind === 'table');
  return { ctx, ls, ss, writes, log, fetches, created, el, els, toasts, asks, rpcs, reads, db };
}
const UID = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOW_ISO = new Date().toISOString();
function app(o) {
  return Object.assign({ id: UID(1), no: 1, name: '甲野 一郎', kana: 'コウノ イチロウ', gender: 'M', birth_date: '1990-04-01', received_on: CALC.todayJST(), sources: ['紹介'], jobs: ['介護職'],
    phones: [{ num: '000-0000-0001', label: '' }], email: 'x@example.com', wish_text: '夜勤なしの希望', cond_text: '架空の条件', note_text: '架空の備考', stage: 'prep', rev: 3, start_on: CALC.addDays(CALC.todayJST(), 10),
    prep: { employmentType: 'part', workStyle: 'part_ded', sites: { facility: true }, primarySite: 'facility' }, staff_id: null, staff_pending_at: null, created_at: NOW_ISO, first_contact_at: NOW_ISO }, o || {});
}
const ENUMS = { employmentType: [{ code: 'regular', label: '正社員' }, { code: 'part', label: 'パート' }], qualCodes: [{ code: 'cw', label: '介護福祉士' }] };
/* 開いた状態を作る（読み込み済み・詳細を開いた） */
async function opened(opt) {
  const L = load(Object.assign({ tables: { ats_applicants: [opt && opt.row || app()], ats_interviews: [], ats_settings: [], staff_names: [], ats_contacts: [] } }, opt || {}));
  await L.ctx.boot_(); await settle();
  L.ctx.curId = (opt && opt.row || app()).id;
  L.ctx.enums = ENUMS; L.ctx.enumsState = 'ok';
  return L;
}
const LIST0 = (b) => b.action === 'list' ? { ok: true, rows: [] } : { ok: true };
const stfCalls = (L) => L.fetches.map((f) => f.body.action);
const bodiesOf = (L, act) => L.fetches.filter((f) => f.body.action === act).map((f) => f.body);
const regMsg = (L, id) => String(L.ctx.reg[id || UID(1)] && L.ctx.reg[id || UID(1)].msg || '');

(async () => {
  group('1. 現場端末では通信0');
  {
    const L = load({ role: 'field' });
    const r = await L.ctx.boot_(); await settle();
    t('現場端末: 起動は field で止まる', r === 'field', r);
    t('現場端末: データベース・RPC・ログインの確かめ・職員マスタのどれも呼ばない', L.log.length === 0 && L.fetches.length === 0, { log: L.log.length, fetch: L.fetches.length });
    t('現場端末: ログインの部品を読み込まない（script を作らない）', L.created.length === 0, L.created.length);
    t('現場端末: 案内を出し、アプリの欄は隠したまま', !L.els['a-gate'].hidden && /事務所のパソコン/.test(L.els['a-gate'].innerHTML) && L.els['a-app'].hidden);
    t('現場端末: 端末に何も書かない', L.writes.length === 0, L.writes);
  }

  group('2. 管理者＋2段階認証でない時は案内だけ');
  for (const [label, st] of [['ログインしていない', { status: 'signed_out' }], ['管理者で6桁が未入力', { status: 'mfa_verify' }], ['事務所の役割', { status: 'ok', role: 'office', mfa: false }], ['管理者でも2段階認証なし', { status: 'ok', role: 'admin', mfa: false }]]) {
    const L = load({ status: st });
    const r = await L.ctx.boot_(); await settle();
    t(label + ': 案内だけ（アプリの欄は隠したまま・応募者を読まない・RPC なし）', r === 'gate' && L.els['a-app'].hidden && !L.els['a-gate'].hidden && L.reads().length === 0 && L.rpcs().length === 0, { r, reads: L.reads().length });
  }
  {
    const L = load({ tables: { ats_applicants: [app()] } });
    const r = await L.ctx.boot_(); await settle();
    t('管理者＋2段階認証: 読み込んでアプリの欄を出す', r === 'app' && !L.els['a-app'].hidden && L.els['a-gate'].hidden && L.ctx.apps.length === 1, r);
    t('読むのは応募者・面接・設定・面接官の候補（表から読むだけ・RPC は呼ばない）', L.reads().map((x) => x.table).sort().join() === 'ats_applicants,ats_interviews,ats_settings,staff_names' && L.rpcs().length === 0, L.reads().map((x) => x.table));
    t('起動では職員マスタへ送らない', L.fetches.length === 0);
  }

  group('3. 危険な値は文字のまま');
  {
    const BAD = '<img src=x onerror=alert(1)>"><script>alert(2)</script>';
    const L = await opened({ row: app({ name: BAD, jobs: [BAD], sources: [BAD], wish_text: BAD, note_text: BAD, address: BAD, stage: 'applied', reply_due: BAD }) });
    L.ctx.ivs = [{ id: UID(9), applicant_id: UID(1), round: 1, held_at: new Date(Date.now() + 3600000).toISOString(), place: BAD, interviewers: [BAD], memo: BAD }];
    L.ctx.staffNames = [BAD];
    const outs = [L.ctx.boardHtml_(), L.ctx.detailHtml_(L.ctx.rowById_(UID(1)))];
    L.ctx.showEnded = true; outs.push(L.ctx.boardHtml_());
    L.ctx.paintSched_(); outs.push(L.els['p-sched'].innerHTML);
    outs.push(L.ctx.printSchedHtml_(), L.ctx.printSheetHtml_(UID(9)));
    L.ctx.evalCtx = { iv: L.ctx.ivs[0], mine: [], who: BAD, row: null, scores: {}, overall: null, comment: BAD, peek: [{ interviewer: BAD, overall: 3, scores: {}, comment: BAD, status: 'submitted' }], msg: BAD };
    outs.push(L.ctx.evalHtml_());
    L.ctx.importPlan = CALC.planImport('氏名,受付日,経路\n"' + BAD.replace(/"/g, '""') + '",2026/10/01,x', CALC.todayJST(), CALC.DEFAULT_SETTINGS, []);
    L.ctx.paintImport_(); outs.push(L.els['p-import'].innerHTML);
    L.ctx.apps[0].retain_until = '2000-01-01'; L.ctx.apps[0].stage = 'lost'; L.ctx.paintExpire_(); outs.push(L.els['p-expire'].innerHTML);
    const all = outs.join('\n');
    t('img・script の要素が生まれない（すべて &lt; になる）', !/<img|<script/i.test(all), (all.match(/<(img|script)[^>]*/gi) || []).slice(0, 3));
    t('タグの中に onerror= が入らない（属性の値の中は " で閉じられないので数えない）', !/<[^>]*onerror=/i.test(all.replace(/"[^"]*"/g, '""')), (all.replace(/"[^"]*"/g, '""').match(/<[^>]*onerror=[^>]*>/i) || [])[0]);
    t('値は文字として残る', (all.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 8, (all.match(/&lt;img/g) || []).length);
  }

  group('4. タブの復元と端末に残すもの');
  {
    let L = load({ hash: '#dash' }); L.ctx.restoreUi_();
    t('hash の既知の名前を使う', L.ctx.tab === 'dash');
    L = load({ hash: '#zzz', local: { ats_view: 'import' } }); L.ctx.restoreUi_();
    t('知らない hash は端末の控えへ', L.ctx.tab === 'import');
    L = load({ hash: '', local: { ats_view: '<x>' } }); L.ctx.restoreUi_();
    t('控えも知らない名前なら選考へ', L.ctx.tab === 'board');
    L = await opened();
    L.ctx.setTab_('expire');
    t('タブを変えると hash と ats_view に入る', L.ctx.location.hash === '#expire' && L.ls.m.get('ats_view') === 'expire');
    L.ctx.setTab_('evil');
    t('知らないタブの名前は選考にする', L.ctx.tab === 'board');
    L.ctx.filter = { job: '介護職', src: '' }; L.ctx.saveFilter_();
    L.ctx.openDetail_(UID(1)); await settle();
    L.ctx.saveOpen_('甲野 一郎');
    const keys = [...new Set(L.writes.filter((w) => w[1] === 'set').map((w) => w[0] + ':' + w[2]))].sort();
    t('端末に書くのは ats_view・ats_open・ats_filter だけ', keys.join() === ['local:ats_view', 'session:ats_filter', 'session:ats_open'].join(), keys);
    t('開いている応募者の控えは id の形の時だけ（氏名は書かない）', !L.writes.some((w) => /甲野/.test(w[3] || '')), L.writes.filter((w) => w[2] === 'ats_open'));
    t('応募者の情報（氏名・希望・電話・メール）を端末に書かない', !L.writes.some((w) => /甲野|夜勤なし|000-0000-0|example/.test(w[3] || '')), L.writes);
  }

  group('5. 職員マスタへの登録（「登録しました」と偽らない）');
  const pendOk = (a) => ({ ok: true, row: Object.assign(app(), { staff_pending_at: new Date().toISOString(), staff_req_id: a.p_req_id, staff_sent_key: a.p_sent_key, rev: 4 }) });
  const markOk = (a) => ({ ok: true, row: Object.assign(app(), { staff_id: a.p_staff_id, stage: 'hired', rev: 5 }) });
  const clearOk = () => ({ ok: true, row: Object.assign(app(), { staff_pending_at: null, rev: 6 }) });
  {
    const L = await opened({ rpc: { ats_mark_staff_pending: pendOk, ats_mark_staff: markOk }, stf: (b) => b.action === 'bulkSave' ? { ok: true, created: [{ tempId: 'ats1', id: 'S0101', rev: 1 }] } : { ok: true, rows: [] } });
    const r = await L.ctx.regStart_(); await settle();
    const names = L.rpcs().map((x) => x.name);
    t('ok で職員IDを受け取った → 控えてから「登録しました」', r === 'ok' && names.join() === 'ats_mark_staff_pending,ats_mark_staff' && regMsg(L) === '登録しました。' && L.ctx.rowById_(UID(1)).staff_id === 'S0101', { r, names, msg: regMsg(L) });
    t('確認の窓を先に出す（本人希望などの文章は送らない旨）', L.asks.length === 1 && /本人希望などの文章は送りません/.test(L.asks[0].lines.join()) && /職員マスタの欄/.test(L.asks[0].bodyHtml));
    const b = bodiesOf(L, 'bulkSave')[0], f = L.fetches.find((x) => x.body.action === 'bulkSave');
    t('送り方は職員マスタと同じ（POST・本文は JSON の文字列・redirect follow・Content-Type を足さない）', f.opt.method === 'POST' && typeof f.opt.body === 'string' && f.opt.redirect === 'follow' && !f.opt.headers && f.url === STF_URL, f.opt);
    t('本文: action・token・creates[{tempId,fields}]・reqId（保留の印と同じ番号）', b.action === 'bulkSave' && b.token === 'tok-kakuu' && b.creates.length === 1 && b.creates[0].tempId && b.creates[0].fields.name === '甲野 一郎' && /^[0-9a-f]{32}$/.test(b.reqId) && b.reqId === L.rpcs()[0].args.p_req_id, b);
    t('本人希望・条件・備考・メールの文章を送らない', !/夜勤なし|架空の条件|架空の備考|example\.com/.test(JSON.stringify(b)));
    t('保留の印（送る内容の指紋）を送る前に保存', L.log.findIndex((x) => x.name === 'ats_mark_staff_pending') >= 0 && L.rpcs()[0].args.p_sent_key === CALC.sentKey(b.creates[0].fields));
  }
  {
    const L = await opened({ rpc: { ats_mark_staff_pending: () => ({ ok: false, conflict: true, row: app({ rev: 9 }) }) }, stf: LIST0 });
    const r = await L.ctx.regStart_(); await settle();
    t('保留の印を保存できない → 職員マスタへ送らない', r === 'nomark' && bodiesOf(L, 'bulkSave').length === 0 && !/登録しました/.test(regMsg(L)), { r, f: L.fetches.length });
  }
  {
    const L = await opened({ rpc: { ats_mark_staff_pending: () => ({ __error: { message: 'Failed to fetch' } }) }, stf: LIST0 });
    const r = await L.ctx.regStart_(); await settle();
    t('保留の印の保存が通信で失敗 → 送らない', r === 'nomark' && bodiesOf(L, 'bulkSave').length === 0);
  }
  {
    const L = await opened({ rpc: { ats_mark_staff_pending: pendOk, ats_clear_staff_pending: clearOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: [] } : ({ ok: false, error: '合言葉が違います' }) });
    const r = await L.ctx.regStart_(); await settle();
    t('ok:false（partial なし）→ 保留を外して「登録できませんでした（理由）」', r === 'ng' && L.rpcs().map((x) => x.name).join() === 'ats_mark_staff_pending,ats_clear_staff_pending' && /^登録できませんでした（合言葉が違います）/.test(regMsg(L)), { r, m: regMsg(L) });
  }
  for (const [label, stf] of [['応答なし（通信の失敗）', () => 'NET'], ['読めない応答', () => '<html>'], ['FLUSH_FAIL_MSG', () => ({ ok: false, error: FLUSH })],
    ['処理中（inProgress）', () => ({ ok: false, inProgress: true, error: '処理中' })], ['partial で id なし', () => ({ ok: false, partial: true, created: [] })],
    ['partial で id あり', () => ({ ok: false, partial: true, created: [{ id: 'S0102' }], error: FLUSH })], ['ok なのに id なし', () => ({ ok: true, created: [] })]]) {
    const L = await opened({ rpc: { ats_mark_staff_pending: pendOk }, stf: (b) => b.action === 'bulkSave' ? stf() : { ok: true, rows: [] } });
    const r = await L.ctx.regStart_(); await settle();
    const html = L.ctx.regHtml_(L.ctx.rowById_(UID(1)));
    t(label + ' → 「確かめ中」（保留は外さない・控えない・登録しましたと言わない）', r === 'unsure' && !L.rpcs().some((x) => x.name === 'ats_clear_staff_pending' || x.name === 'ats_mark_staff') && !/登録しました/.test(regMsg(L) + html) && /確かめ中/.test(html) && /data-act="reg-check"/.test(html) && !/data-act="reg-start"/.test(html), { r, m: regMsg(L) });
  }
  {
    const L = await opened({ row: app({ staff_pending_at: new Date().toISOString() }) });
    t('2回押し: 保留の印がある間は登録のボタンを出さず、押しても送らない', !/data-act="reg-start"/.test(L.ctx.regHtml_(L.ctx.rowById_(UID(1)))) && (await L.ctx.regStart_()) === 'blocked' && L.fetches.filter((f) => f.body.action === 'bulkSave').length === 0);
    const L2 = await opened({ row: app({ staff_id: 'S0001', stage: 'hired' }) });
    t('登録済みは「✓ 登録済み」とリンクだけ（ボタンなし）', /✓ 登録済み/.test(L2.ctx.regHtml_(L2.ctx.rowById_(UID(1)))) && !/reg-start/.test(L2.ctx.regHtml_(L2.ctx.rowById_(UID(1)))) && (await L2.ctx.regStart_()) === 'blocked');
    let release; const gate = new Promise((r) => { release = r; });
    const L3 = await opened({ rpc: { ats_mark_staff_pending: pendOk, ats_mark_staff: markOk }, stf: () => gate.then(() => ({ ok: true, created: [{ id: 'S0103' }] })) });
    L3.ctx.fetch = function (u, o) { L3.fetches.push({ url: u, opt: o, body: JSON.parse(o.body) }); if (JSON.parse(o.body).action === 'list') return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"rows":[]}') }); return gate.then(() => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, created: [{ id: 'S0103' }] })) })); };
    const p1 = L3.ctx.regStart_(); await settle();
    const r2 = await L3.ctx.regStart_();
    release(); await p1; await settle();
    t('2回押し: 送っている間の2回目は送らない', r2 === 'blocked' || r2 === 'busy', r2);
    t('2回押し: 職員マスタへの送信は1回だけ', L3.fetches.filter((f) => f.body.action === 'bulkSave').length === 1);
  }
  group('5b. 職員マスタを読み直して確かめる');
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const LIST1 = [{ id: 'S0201', name: '甲野　一郎', hireDate: app().start_on, birthDate: '1990-04-01' }];
  {
    const L = await opened({ row: app({ staff_pending_at: ago(1), staff_req_id: 'a'.repeat(32) }), rpc: { ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1 } : { ok: true } });
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('1件見つかった → 控えて「登録を確かめました」', r === 'ok' && L.rpcs().map((x) => x.name).join() === 'ats_mark_staff' && L.rpcs()[0].args.p_staff_id === 'S0201' && /登録を確かめました/.test(regMsg(L)), { r, m: regMsg(L) });
    t('確かめは list を読むだけ（書く送信をしない）', stfCalls(L).join() === 'list');
  }
  {
    const L = await opened({ row: app({ staff_pending_at: ago(2), staff_req_id: 'b'.repeat(32) }), stf: (b) => b.action === 'list' ? { ok: true, rows: [] } : { ok: true } });
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('0件・送ってから8分未満 → 待つ（保留を外さない・送り直さない）', r === 'wait' && L.rpcs().length === 0 && /分ほど待って/.test(regMsg(L)) && !/登録しました/.test(regMsg(L)), { r, m: regMsg(L) });
  }
  {
    const REQ = 'c'.repeat(32);
    const L = await opened({ row: app({ staff_pending_at: ago(9), staff_req_id: REQ, staff_sent_key: CALC.sentKey(CALC.buildStaffCreate(app(), ENUMS).fields) }),
      rpc: { ats_clear_staff_pending: clearOk, ats_mark_staff_pending: pendOk, ats_mark_staff: markOk },
      stf: (b) => b.action === 'list' ? { ok: true, rows: [] } : { ok: true, created: [{ id: 'S0301' }] } });
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('0件・8分以上 → 保留を外し（自分の受付番号を添える）「同じ受付番号で送り直す」を出す', r === 'absent' && L.rpcs().map((x) => x.name).join() === 'ats_clear_staff_pending' && L.rpcs()[0].args.p_req_id === REQ && /data-act="reg-resend"/.test(L.ctx.regHtml_(L.ctx.rowById_(UID(1)))) && !/登録しました/.test(regMsg(L)), { r, m: regMsg(L) });
    const r2 = await L.ctx.regResend_(); await settle();
    const b = bodiesOf(L, 'bulkSave')[0];
    t('送り直しは同じ受付番号（保留の印も同じ番号）', r2 === 'ok' && b && b.reqId === REQ && L.rpcs().find((x) => x.name === 'ats_mark_staff_pending').args.p_req_id === REQ, { r2, req: b && b.reqId });
    t('送り直しも送る前に職員マスタの一覧で照合する', stfCalls(L).filter((x) => x === 'list').length === 2 && stfCalls(L).indexOf('bulkSave') > stfCalls(L).lastIndexOf('list'));
  }
  for (const [label, listRes, want] of [['送り直しの前の照合で1人見つかった → 送らずにつなぐ窓', { ok: true, rows: [{ id: 'S0401', name: '甲野 一郎', hireDate: app().start_on, birthDate: '1990-04-01' }] }, 'cancel'],
    ['送り直しの前の照合で2人以上 → 送らない', { ok: true, rows: [{ id: 'S0401', name: '甲野 一郎', hireDate: app().start_on, birthDate: '1990-04-01' }, { id: 'S0402', name: '甲野 一郎', hireDate: app().start_on, birthDate: '1990-04-01' }] }, 'many'],
    ['送り直しの前の照合で一覧を読めない → 送らない', 'NET', 'nolist']]) {
    const REQ = 'g'.repeat(32);
    let n = 0;
    const L = await opened({ answer: false, row: app({ staff_pending_at: ago(9), staff_req_id: REQ }), rpc: { ats_clear_staff_pending: clearOk, ats_mark_staff_pending: pendOk },
      stf: (b) => { if (b.action !== 'list') return { ok: true, created: [{ id: 'S0999' }] }; n++; return n === 1 ? { ok: true, rows: [] } : listRes; } });
    await L.ctx.regCheck_(UID(1), false); await settle();
    const r2 = await L.ctx.regResend_(); await settle();
    t(label, r2 === want && bodiesOf(L, 'bulkSave').length === 0 && !L.rpcs().some((x) => x.name === 'ats_mark_staff_pending'), { r2 });
  }
  {
    const L = await opened({ row: app({ staff_pending_at: ago(9), staff_req_id: 'h'.repeat(32) }), rpc: { ats_clear_staff_pending: () => ({ ok: false, reason: 'other_send' }) }, stf: LIST0 });
    const reads0 = L.reads().length;
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('保留を外す時に reason:other_send → 「ほかの画面で送り直しています。読み直しました」と出して読み直す（送り直しは出さない）', r === 'other_send' && /ほかの画面で送り直しています。読み直しました/.test(regMsg(L)) && L.reads().length > reads0 && !L.ctx.reg[UID(1)].resend, { r, m: regMsg(L) });
  }
  {
    const L = await opened({ row: app({ staff_pending_at: ago(9), staff_req_id: 'd'.repeat(32), staff_sent_key: 'old-key' }),
      rpc: { ats_clear_staff_pending: clearOk, ats_mark_staff_pending: pendOk, ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: [] } : { ok: true, created: [{ id: 'S0302' }] } });
    await L.ctx.regCheck_(UID(1), false); await settle();
    await L.ctx.regResend_(); await settle();
    t('入職準備の中身が変わっていれば新しい番号で送る（前の答えを返されないように）', bodiesOf(L, 'bulkSave')[0].reqId !== 'd'.repeat(32));
  }
  {
    const L = await opened({ row: app({ staff_pending_at: ago(9), staff_req_id: 'e'.repeat(32) }), stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1.concat([Object.assign({}, LIST1[0], { id: 'S0202' })]) } : { ok: true } });
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('2件以上 → 止めて「職員マスタで確かめてください」（控えない・外さない）', r === 'many' && L.rpcs().length === 0 && /職員マスタで確かめてください/.test(regMsg(L)), { r, m: regMsg(L) });
  }
  {
    const L = await opened({ row: app({ staff_pending_at: ago(9) }), stf: () => 'NET' });
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('一覧を読めない → 確かめ中のまま（外さない）', r === 'error' && L.rpcs().length === 0 && !/登録しました/.test(regMsg(L)));
  }
  {
    const L = await opened({ local: { stfm_cfg: '' } });
    L.ctx.enums = null; L.ctx.enumsState = 'idle';
    await L.ctx.loadEnums_();
    t('職員マスタの接続先が無い → 「職員マスタの接続先が見つかりません（接続設定）」・登録のボタンは押せない', L.ctx.enumsState === 'nocfg' && /職員マスタの接続先が見つかりません（接続設定）/.test(L.ctx.regHtml_(L.ctx.rowById_(UID(1)))) && !/data-act="reg-start"/.test(L.ctx.regHtml_(L.ctx.rowById_(UID(1)))) && L.fetches.length === 0);
    const L2 = await opened({ row: app({ prep: { workStyle: 'part_ded', sites: { facility: true }, primarySite: 'facility' }, start_on: null }) });
    const h = L2.ctx.regHtml_(L2.ctx.rowById_(UID(1)));
    t('必須がそろうまでボタンは無効・「あと2項目（雇用形態・入職日）」', /あと2項目（雇用形態・入職日）/.test(h) && /data-act="reg-start" disabled/.test(h), h.slice(0, 300));
  }

  group('5b2. 外すかどうかは、その場で読み直した行の印で決める（最終の指摘）');
  /* 画面B（古い控えの行を持つ）が開いた時、データベースの今の行を偽物で差し替える */
  const dbNow = (L, rowFn) => { L.db.from = ((orig) => (tb) => { const b = orig(tb); if (tb === 'ats_applicants' && b) { const th = b.then; b.then = (ok, ng) => { const o = b.ops.find((x) => x[0] === 'eq'); if (!o) return th.call(b, ok, ng); L.log.push({ kind: 'table', table: tb, ops: b.ops }); return Promise.resolve({ data: [rowFn()].filter(Boolean), error: null }).then(ok, ng); }; } return b; })(L.db.from.bind(L.db)); };
  {
    const REQ = 'k'.repeat(32), OLD = ago(9), NEW = ago(1);
    /* 偽のデータベースの今の印。ats_clear_staff_pending は受付番号と時刻の両方が今の印と同じ時だけ外す */
    const cur = { req: REQ, at: NEW };
    const clears = [];
    const L = await opened({ row: app({ staff_pending_at: OLD, staff_req_id: REQ }), stf: LIST0,
      rpc: { ats_clear_staff_pending: (a) => { clears.push(a); return (a.p_req_id === cur.req && a.p_pending_at === cur.at) ? clearOk() : { ok: false, reason: 'other_send' }; } } });
    dbNow(L, () => app({ staff_pending_at: cur.at, staff_req_id: cur.req }));
    L.ctx.curId = ''; L.ctx.reg = {};
    await L.ctx.openDetail_(UID(1)); await settle(60);
    t('画面Aが同じ番号で送り直して印の時刻が新しくなった後、古い控えの画面Bが開いても外さない（読み直して8分未満＝待つ）', clears.length === 0 && /分ほど待って/.test(regMsg(L)) && L.ctx.rowById_(UID(1)).staff_pending_at === NEW, { clears, m: regMsg(L) });
    cur.at = ago(10);
    const L2 = await opened({ row: app({ staff_pending_at: OLD, staff_req_id: REQ }), stf: LIST0,
      rpc: { ats_clear_staff_pending: (a) => { clears.push(a); return (a.p_req_id === cur.req && a.p_pending_at === NEW) ? clearOk() : { ok: false, reason: 'other_send' }; } } });
    dbNow(L2, () => app({ staff_pending_at: cur.at, staff_req_id: cur.req }));
    const r2 = await L2.ctx.regCheck_(UID(1), true); await settle();
    const c2 = clears[clears.length - 1];
    t('外す時は読み直した行の受付番号と時刻をそのまま渡す（{p_id, p_req_id, p_pending_at}）', c2 && Object.keys(c2).sort().join() === 'p_id,p_pending_at,p_req_id' && c2.p_req_id === REQ && c2.p_pending_at === cur.at, c2);
    t('データベースの印と合わない（その間に送り直された）→ other_send の文言で読み直す・送り直しは出さない', r2 === 'other_send' && /ほかの画面で送り直しています。読み直しました/.test(regMsg(L2)) && !L2.ctx.reg[UID(1)].resend, { r2, m: regMsg(L2) });
  }
  {
    /* データベースの時刻はマイクロ秒まで持つ。読んだ文字列をそのまま渡す（Date に通すとマイクロ秒が落ちて一致しない） */
    const d = new Date(Date.now() - 10 * 60000), MICRO = d.toISOString().slice(0, 19) + '.123456+00:00';
    const got = [];
    const L = await opened({ row: app({ staff_pending_at: MICRO, staff_req_id: 'n'.repeat(32) }), stf: LIST0, rpc: { ats_clear_staff_pending: (x) => { got.push(x); return x.p_pending_at === MICRO ? clearOk() : { ok: false, reason: 'other_send' }; } } });
    dbNow(L, () => app({ staff_pending_at: MICRO, staff_req_id: 'n'.repeat(32) }));
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('印の時刻はマイクロ秒つきの文字列のまま渡す（作り直さない）', r === 'absent' && got.length === 1 && got[0].p_pending_at === MICRO, { r, got });
  }
  {
    /* other_send が続いても、読み直し→開く→自動の確かめ…を繰り返さない */
    let n = 0;
    const L = await opened({ row: app({ staff_pending_at: ago(9), staff_req_id: 'p'.repeat(32) }), stf: LIST0, rpc: { ats_clear_staff_pending: () => { n++; return { ok: false, reason: 'other_send' }; } } });
    L.ctx.saveOpen_(UID(1));
    L.ctx.curId = ''; L.ctx.reg = {};
    await L.ctx.openDetail_(UID(1)); await settle(120);
    t('other_send の後の読み直しでは、開いた時の自動の確かめを走らせない（外す呼び出しは1回だけ）', n === 1, n);
  }
  {
    const L = await opened({ row: app({ staff_pending_at: ago(9), staff_req_id: 'm'.repeat(32) }), stf: LIST0, rpc: { ats_clear_staff_pending: clearOk } });
    dbNow(L, () => app({ staff_pending_at: null, staff_req_id: null }));
    const r = await L.ctx.regCheck_(UID(1), false); await settle();
    t('読み直した行に印が無い → 外さず、印の無い表示に直す', r === 'cleared' && !L.rpcs().length && !L.ctx.rowById_(UID(1)).staff_pending_at && /data-act="reg-start"/.test(L.ctx.regHtml_(L.ctx.rowById_(UID(1)))), { r });
    const L2 = await opened({ row: app({ staff_pending_at: ago(9) }), stf: LIST0, rpc: { ats_clear_staff_pending: clearOk } });
    dbNow(L2, () => app({ staff_pending_at: null, staff_id: 'S0700', stage: 'hired' }));
    const r2 = await L2.ctx.regCheck_(UID(1), false); await settle();
    t('読み直した行に職員IDがある → 外さず「登録済み」に直す', r2 === 'registered' && !L2.rpcs().length && /✓ 登録済み/.test(L2.ctx.regHtml_(L2.ctx.rowById_(UID(1)))), { r2 });
  }

  group('5c. 確かめ中は送った中身を直させない（反証レビュー 2026-10-26）');
  {
    const PEND = app({ staff_pending_at: ago(1), staff_req_id: 'f'.repeat(32) });
    const L = await opened({ row: PEND, rpc: { ats_put: () => ({ ok: false, reason: 'pending', row: PEND }), ats_set_stage: () => ({ ok: false, reason: 'pending', row: PEND }) }, stf: LIST0 });
    const h = L.ctx.detailHtml_(L.ctx.rowById_(UID(1)));
    const dis = (id) => new RegExp('id="' + id + '"[^>]*disabled').test(h);
    t('氏名・カナ・生年月日・性別・職種・電話・住所・入職予定日は入力できない', ['f-name', 'f-kana', 'f-birth', 'f-gender', 'f-jobs', 'f-phones', 'f-addr', 'f-start'].every(dis), ['f-name', 'f-kana', 'f-birth', 'f-gender', 'f-jobs', 'f-phones', 'f-addr', 'f-start'].filter((x) => !dis(x)));
    t('受付日・本人希望などは入力できる', !dis('f-recv') && !dis('f-wish') && !dis('f-email'));
    t('入職準備は全部入力できない（項目の枠ごと止める）', /<fieldset class="lockfs" disabled>/.test(h));
    t('「職員マスタへの登録を確かめ中のため直せません」と出す', /職員マスタへの登録を確かめ中のため直せません/.test(h));
    t('［終わりにする…］を出さない', !/data-act="end"/.test(h));
    L.ctx.readBasic_ = () => ({ id: UID(1), name: '別の名前', kana: 'x', gender: 'F', jobs: ['別の職種'], birth_date: '1991-01-01', phones: [], address: 'x', start_on: '2030-01-01', received_on: '2026-10-01', wish_text: '架空', email: null });
    const r = await L.ctx.saveBasic_(); await settle();
    const put = L.rpcs().find((x) => x.name === 'ats_put');
    t('確かめ中の保存は、直せない項目を送らない', put && ['name', 'kana', 'gender', 'birth_date', 'jobs', 'phones', 'address', 'start_on', 'prep'].every((k) => !(k in put.args.p_row)) && put.args.p_row.received_on === '2026-10-01', put && Object.keys(put.args.p_row));
    t('ats_put が reason:pending → 同じ文言', r === 'pending');
    const before = L.rpcs().length;
    t('入職準備の保存は送らない', (await L.ctx.savePrep_()) === 'pending' && L.rpcs().length === before);
    t('同じ受付番号の送り直しは確かめ中には出せない（保留を外した後だけ）', (await L.ctx.regResend_()) === 'blocked' && (await L.ctx.regStart_()) === 'blocked');
    await L.ctx.moveStage_(UID(1), 'offer', '', '', false); await settle();
    t('段階を動かして reason:pending → 文言を出す', /確かめ中のため直せません/.test(L.els['a-msg'].textContent));
    const old = L.ctx.apps[0]; L.ctx.apps = [old, app({ id: UID(2), stage: 'lost', retain_until: '2000-01-01', staff_pending_at: NOW_ISO }), app({ id: UID(3), stage: 'lost', retain_until: '2000-01-01' })];
    L.ctx.paintExpire_();
    const ex = L.els['p-expire'].innerHTML;
    t('保管期限の一覧: 確かめ中の方には✔を出さない', !ex.includes('data-exp="' + UID(2) + '"') && ex.includes('data-exp="' + UID(3) + '"') && /登録を確かめ中/.test(ex));
    L.ctx.expireSel = { [UID(2)]: true, [UID(3)]: true };
    L.asks.length = 0;
    await L.ctx.runPurge_(); await settle();
    const pg = L.rpcs().find((x) => x.name === 'ats_purge');
    t('消す時も確かめ中の方を入れない', pg && JSON.stringify(pg.args.p_ids) === JSON.stringify([UID(3)]), pg && pg.args);
    const L9 = await opened({ rpc: { ats_purge: () => ({ ok: true, deleted: 1, skipped_pending: 2 }) } });
    L9.ctx.apps = [app({ id: UID(3), stage: 'lost', retain_until: '2000-01-01' })]; L9.ctx.expireSel = { [UID(3)]: true };
    await L9.ctx.runPurge_(); await settle();
    t('削除の結果に skipped_pending が1件以上 → 「確かめ中の n件は消しませんでした」を添える', /1件を消しました。確かめ中の2件は消しませんでした。/.test(L9.els['a-msg'].textContent), L9.els['a-msg'].textContent);
  }
  {
    const L = load({ row: null, tables: { ats_applicants: [app({ staff_pending_at: ago(1) })], ats_interviews: [], ats_settings: [], staff_names: [], ats_contacts: [] },
      rpc: { ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1 } : { ok: true }, session: { ats_open: UID(1) } });
    await L.ctx.boot_(); await settle(60);
    t('開き直した時は先に照合する（送った時の値＝確かめ中は変わらない値で）', L.ctx.curId === UID(1) && stfCalls(L).indexOf('list') >= 0 && stfCalls(L).indexOf('bulkSave') < 0 && L.rpcs().some((x) => x.name === 'ats_mark_staff' && x.args.p_staff_id === 'S0201'), { f: stfCalls(L), r: L.rpcs().map((x) => x.name) });
  }
  group('5d. 送る前に職員マスタの一覧で同じ方を探す');
  {
    const L = await opened({ rpc: { ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1 } : { ok: true, created: [{ id: 'S0999' }] } });
    const r = await L.ctx.regStart_(); await settle();
    t('1件いる → 「職員マスタにもういらっしゃいます」→ つなぐ（新しく作らない・保留の印も使わない）', r === 'ok' && /もういらっしゃいます/.test(L.asks[0].title) && bodiesOf(L, 'bulkSave').length === 0 && L.rpcs().map((x) => x.name).join() === 'ats_mark_staff' && L.rpcs()[0].args.p_staff_id === 'S0201' && /つなぎました/.test(regMsg(L)), { r, n: L.rpcs().map((x) => x.name), m: regMsg(L) });
    const L2 = await opened({ answer: false, stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1 } : { ok: true } });
    t('つながないを選ぶ → 何も書かない・送らない', (await L2.ctx.regStart_()) === 'cancel' && L2.rpcs().length === 0 && bodiesOf(L2, 'bulkSave').length === 0);
    const L3 = await opened({ stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1.concat([Object.assign({}, LIST1[0], { id: 'S0202' })]) } : { ok: true } });
    t('2件以上 → 止めて「職員マスタで確かめてください」', (await L3.ctx.regStart_()) === 'many' && L3.rpcs().length === 0 && bodiesOf(L3, 'bulkSave').length === 0 && /職員マスタで確かめてください/.test(regMsg(L3)));
    const L4 = await opened({ stf: () => 'NET' });
    t('一覧を読めない → 送らない（保留の印も付けない）', (await L4.ctx.regStart_()) === 'nolist' && L4.rpcs().length === 0 && bodiesOf(L4, 'bulkSave').length === 0 && !/登録しました/.test(regMsg(L4)));
    const L5 = await opened({ stf: (b) => b.action === 'list' ? { ok: true, rows: [{ id: 'S0203', name: '甲野一郎', hireDate: app().start_on, birthDate: '' }] } : { ok: true } , row: app({ birth_date: null }), rpc: { ats_mark_staff: markOk } });
    t('生年月日が無い方は氏名＋入職日で探す', (await L5.ctx.regStart_()) === 'ok' && L5.rpcs()[0].args.p_staff_id === 'S0203');
  }
  {
    const L = await opened({ rpc: { ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: [Object.assign({ kana: 'コウノ イチロウ' }, LIST1[0])] } : { ok: true } });
    await L.ctx.regStart_(); await settle();
    const body = L.asks[0] && L.asks[0].bodyHtml || '';
    t('つなぐ窓は採用管理と職員マスタの氏名・フリガナ・生年月日・入職日を並べる', /<th>採用管理<\/th><th>職員マスタ（職員ID S0201）<\/th>/.test(body) && ['氏名', 'フリガナ', '生年月日', '入職日'].every((k) => body.includes('<td>' + k + '</td>')) && body.includes('甲野　一郎') && body.includes('甲野 一郎'), body.slice(0, 300));
    t('つなぐ直前に応募者の行を読み直す', L.reads().some((x) => x.table === 'ats_applicants' && x.ops.some((o) => o[0] === 'eq' && o[2] === UID(1))));
    const L2 = await opened({ rpc: { ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1 } : { ok: true } });
    L2.db.from = ((orig) => (tb) => { const b = orig(tb); if (tb === 'ats_applicants') b.then = (ok, ng) => Promise.resolve({ data: [app({ name: '甲野 二郎' })], error: null }).then(ok, ng); return b; })(L2.db.from.bind(L2.db));
    const r2 = await L2.ctx.regStart_(); await settle();
    t('窓を開いた後に氏名・入職日・生年月日が変わっていた → 止めて「内容が変わりました。もう一度押してください」（つながない）', r2 === 'changed' && L2.rpcs().length === 0 && regMsg(L2) === '内容が変わりました。もう一度押してください。', { r2, m: regMsg(L2) });
    const L3 = await opened({ rpc: { ats_mark_staff_pending: pendOk, ats_mark_staff: markOk }, stf: (b) => b.action === 'list' ? { ok: true, rows: [Object.assign({}, LIST1[0], { retireDate: '2025-03-31' })] } : { ok: true, created: [{ id: 'S0501' }] } });
    const r3 = await L3.ctx.regStart_(); await settle();
    t('退職日のある職員は照合から外す（つながず新しく登録する）', r3 === 'ok' && bodiesOf(L3, 'bulkSave').length === 1 && !/もういらっしゃいます|同じ氏名/.test(L3.asks.map((x) => x.title).join()), { r3, asks: L3.asks.map((x) => x.title) });
    const L4 = await opened({ answer: false, stf: (b) => b.action === 'list' ? { ok: true, rows: [{ id: 'S0601', name: '甲野 一郎', hireDate: '2020-04-01', birthDate: '1980-01-01' }] } : { ok: true } });
    const r4 = await L4.ctx.regStart_(); await settle();
    t('氏名だけ一致する在籍の職員 → 「同じ氏名の職員がいます（入職日が違います）」と聞く・やめれば送らない', r4 === 'cancel' && L4.asks[0].title === '同じ氏名の職員がいます（入職日が違います）' && /それでも新しく登録しますか/.test(L4.asks[0].lines.join()) && bodiesOf(L4, 'bulkSave').length === 0 && L4.rpcs().length === 0, { r4 });
  }
  group('5e. すでに登録済み・開いていた行が消えた時');
  {
    const L = await opened({ rpc: { ats_mark_staff_pending: () => ({ ok: false, reason: 'registered', row: app({ staff_id: 'S0001', stage: 'hired' }) }) }, stf: LIST0 });
    const reads0 = L.reads().length;
    const r = await L.ctx.regStart_(); await settle();
    t('保留の印で reason:registered → 「すでに…登録が済んでいます」と出して読み直す（送らない）', r === 'registered' && /すでに職員マスタへの登録が済んでいます/.test(regMsg(L)) && L.reads().length > reads0 && bodiesOf(L, 'bulkSave').length === 0, { r, m: regMsg(L) });
    const L2 = await opened({ rpc: { ats_mark_staff: () => ({ ok: false, reason: 'registered' }) }, stf: (b) => b.action === 'list' ? { ok: true, rows: LIST1 } : { ok: true } });
    t('職員IDを控えて reason:registered → 同じく読み直す（控えられませんでしたと言わない）', (await L2.ctx.regStart_()) === 'registered' && !/控えられませんでした/.test(regMsg(L2)));
    const L3 = await opened({ rpc: { ats_purge: () => ({ ok: true, deleted: 1 }) } });
    L3.ctx.openDetail_(UID(1)); await settle();
    L3.db.from = ((orig) => (tb) => { const b = orig(tb); if (tb === 'ats_applicants') { b.then = (ok, ng) => Promise.resolve({ data: [], error: null }).then(ok, ng); } return b; })(L3.db.from.bind(L3.db));
    await L3.ctx.loadAll_(); await settle();
    t('読み直して開いていた方の行が消えた → 詳細の板を閉じる', L3.ctx.curId === '' && L3.els['a-pane'].hidden === true);
  }
  {
    const L = await opened();
    const h = L.ctx.detailHtml_(L.ctx.rowById_(UID(1)));
    t('入力の上限をデータベースに合わせる（氏名80・住所200・メール200・本人希望・条件・備考は2万字＝0030）', /id="f-name"[^>]*maxlength="80"/.test(h) && /id="f-addr"[^>]*maxlength="200"/.test(h) && /id="f-email"[^>]*maxlength="200"/.test(h) && ['f-wish', 'f-cond', 'f-note'].every((k) => new RegExp('id="' + k + '"[^>]*maxlength="20000"').test(h)) && /id="i-place"[^>]*maxlength="200"/.test(h));
  }

  group('6. 評価（面接官ごと・見た後は own の版）');
  {
    const IV = { id: UID(7), applicant_id: UID(1), round: 1, held_at: NOW_ISO, interviewers: ['乙川 花子', '丙山 三郎'] };
    const L = await opened({ tables: { ats_applicants: [app()], ats_evaluations: [{ id: 'e1', interview_id: UID(7), interviewer: '乙川 花子', status: 'submitted', rev: 2, scores: {}, overall: 4 }] },
      rpc: { ats_eval_put: (a) => ({ ok: true, row: { id: 'e2', interview_id: UID(7), interviewer: a.p_interviewer, status: a.p_submit ? 'submitted' : 'draft', rev: 1, scores: a.p_scores, overall: a.p_overall } }),
        ats_eval_peek: (a) => (Object.keys(a).join() === 'p_interview_id' ? { ok: true, own: [{ id: 'e1', interview_id: UID(7), interviewer: '乙川 花子', status: 'submitted', rev: 3, peeked_at: NOW_ISO, scores: {} }], rows: [{ interviewer: '丁田 四郎', status: 'submitted', overall: 5, scores: {}, edited_after_peek: true }] } : { ok: false }),
        ats_eval_status: () => ({ ok: true, submitted: 1, drafts: 0, interviewers: 2 }) } });
    L.ctx.ivs = [IV];
    await L.ctx.openEval_(UID(7)); await settle();
    t('開いた時は、まだ入れていない面接官を選ぶ', L.ctx.evalCtx.who === '丙山 三郎' && L.ctx.evalCtx.row === null);
    L.ctx.evalCtx.overall = 3;
    await L.ctx.saveEval_(false); await settle();
    const put = L.rpcs().find((x) => x.name === 'ats_eval_put');
    t('保存は面接官の名前（p_interviewer）つき・新しい行は版なし', put && put.args.p_interviewer === '丙山 三郎' && put.args.p_rev === null && put.args.p_submit === false, put && put.args);
    t('提出は全部の点が要る（足りなければ送らない）', (await L.ctx.saveEval_(true)) === false && L.rpcs().filter((x) => x.name === 'ats_eval_put').length === 1);
    await L.ctx.evalSwitch_('乙川 花子'); await settle();
    t('面接官を選び直すと、その面接官の行を使う', L.ctx.evalCtx.row && L.ctx.evalCtx.row.id === 'e1');
    await L.ctx.peekEval_(); await settle();
    t('ほかの評価を見る → 提出済みだけ出し、自分の行は own の版にする', L.ctx.evalCtx.peek.length === 1 && L.ctx.evalCtx.row.rev === 3, L.ctx.evalCtx.row);
    L.ctx.evalCtx.overall = 4; settingsAll(L.ctx);
    await L.ctx.saveEval_(true); await settle();
    const put2 = L.rpcs().filter((x) => x.name === 'ats_eval_put').pop();
    t('見た後の保存は own の版（3）で送る', put2.args.p_rev === 3 && put2.args.p_interviewer === '乙川 花子', put2.args);
    t('見た後に入れた評価には「ほかの評価を見た後に入力」と出す', /ほかの評価を見た後に入力/.test(L.ctx.evalHtml_()));
    const L2 = await opened({ rpc: { ats_eval_put: () => ({ ok: false, reason: 'other_author' }) } });
    L2.ctx.ivs = [IV];
    await L2.ctx.openEval_(UID(7)); await settle();
    L2.ctx.evalCtx.overall = 2;
    L2.ctx.evalCtx.who = '手で入れた名前';
    const nPut = L2.rpcs().length;
    t('面接官は、その面接の面接官からだけ（それ以外は送らない）', (await L2.ctx.saveEval_(false)) === false && L2.rpcs().length === nPut && /この面接の面接官から選んで/.test(L2.ctx.evalCtx.msg));
    L2.ctx.evalCtx.who = '丙山 三郎';
    t('ほかの方が入れた評価を直そうとした → 「この評価はほかの方が入れたため直せません」', (await L2.ctx.saveEval_(false)) === false && L2.ctx.evalCtx.msg === 'この評価はほかの方が入れたため直せません。');
    await L.ctx.loadEvalStat_(UID(1)); await settle();
    t('評価の件数は submitted と interviewers から（2人中1人提出）', JSON.stringify(L.ctx.evalStat[UID(7)]) === JSON.stringify({ submitted: 1, total: 2 }), L.ctx.evalStat);
  }

  group('6b. 面接者ノートの取り込み・ボード・集計（2026-10-27 本人指示）');
  {
    const T = CALC.todayJST();
    const old = CALC.addDays(T, -61), recent = CALC.addDays(T, -10);
    const rows = [
      app({ id: UID(1), name: '甲野 一郎', stage: 'hired', staff_id: 'S0001', start_on: recent }),
      app({ id: UID(2), name: '乙川 花子', stage: 'hired', staff_id: 'S0002', start_on: old }),
      app({ id: UID(3), name: '丙山 三郎', stage: 'hired', legacy_hired: true, staff_id: null, start_on: '2019-05-01', received_on: '2019-04-01', retain_until: null, closed_on: '2019-04-15' }),
      app({ id: UID(4), name: '丁田 四郎', stage: 'lost', received_on: '2019-07-04', retain_until: null, closed_on: '2019-07-04' })
    ];
    const L = await opened({ tables: { ats_applicants: rows, ats_interviews: [], ats_settings: [], staff_names: [], ats_contacts: [] } });
    L.ctx.tab = 'board'; L.ctx.showEnded = true; L.ctx.paintBoard_();
    const b = L.els['p-board'].innerHTML;
    const cols = b.slice(b.indexOf('<div class="cols">'));
    const endTbl = b.slice(0, b.indexOf('<div class="cols">'));
    t('ボード: 入職日が60日以内の入職完了は「6. 入職完了」に出す', cols.includes('data-id="' + UID(1) + '"'));
    t('ボード: 取り込み元で入職済み・入職日が60日より前の入職完了は列に出さない', !cols.includes('data-id="' + UID(2) + '"') && !cols.includes('data-id="' + UID(3) + '"'));
    t('「終わった人」に入職完了（隠した方）も出し、開くボタンを付ける', endTbl.includes('data-act="open" data-id="' + UID(2) + '"') && endTbl.includes('data-act="open" data-id="' + UID(3) + '"') && /取り込み元で入職済み/.test(endTbl) && !endTbl.includes('data-id="' + UID(1) + '"'), endTbl.slice(0, 400));
    t('「終わった人」の件数に隠した入職完了を含める（連絡途絶1＋入職完了2）', /終わった人 3件/.test(b));
    t('取り込み元で入職済みの方は職員マスタへ登録するボタンを出さない・押しても送らない', (L.ctx.curId = UID(3), !/data-act="reg-start"/.test(L.ctx.regHtml_(L.ctx.rowById_(UID(3))))) && (await L.ctx.regStart_()) === 'blocked' && L.fetches.length === 0);
    L.ctx.paintExpire_();
    t('保管期限: 取り込んだ記録（retain_until が空）は消せる一覧に出ない', !L.els['p-expire'].innerHTML.includes(UID(3)) && !L.els['p-expire'].innerHTML.includes(UID(4)) && /保管期限を過ぎた方はいません/.test(L.els['p-expire'].innerHTML));

    /* 集計 */
    L.ctx.stageLog = []; L.ctx.dashPeriod = ''; L.ctx.ivs = [];
    L.ctx.apps = rows.map((r) => Object.assign({}, r, { received_on: r.received_on === T ? '2019-01-01' : r.received_on }));
    L.ctx.paintDash_();
    let d = L.els['p-dash'].innerHTML;
    t('集計: 今月に1件も無い時は期間の既定を全期間にする', L.ctx.dashPeriod === 'all' && /<option value="all" selected>全期間/.test(d));
    t('集計: 経路ごとの表に採用率の列・定義を1行ずつ', /<th class="num">採用率<\/th>/.test(d) && ['面接率＝', '内定率＝', '採用率＝', '入職率＝', '辞退率＝'].every((k) => d.includes('<p class="hint">' + k)), d.slice(-900));
    t('集計: 期間の選択に「年ごと」', /<option value="year">年ごと<\/option>/.test(d));
    L.ctx.dashPeriod = 'year'; L.ctx.paintDash_(); d = L.els['p-dash'].innerHTML;
    t('年ごと: 年×（応募・面接・採用・入職・辞退）の表を出す', /<h3>年ごと（受付日の年）<\/h3>/.test(d) && /<th>年<\/th><th class="num">応募<\/th><th class="num">面接<\/th><th class="num">採用<\/th><th class="num">入職<\/th><th class="num">辞退<\/th>/.test(d) && /<td>2019<\/td><td class="num">4<\/td><td class="num">0<\/td><td class="num">3<\/td><td class="num">3<\/td><td class="num">0<\/td>/.test(d), d.slice(0, 900));
    L.ctx.onChange_({ target: { id: 'dash-per', value: 'zzz', hasAttribute() { return false; } } });
    t('知らない期間の値は今月にする', L.ctx.dashPeriod === 'month');
    L.ctx.apps = rows; L.ctx.dashPeriod = ''; L.ctx.paintDash_();
    t('今月に応募があれば既定は今月', L.ctx.dashPeriod === 'month');
  }
  {
    const CSVN = 'No,受付日,求人媒体,氏名,性別,年齢,面接日,採用可否,可否連絡日,就業開始日,備考\n' +
      '1,2019/04/01,job Medley,甲野 一郎,男,40,4/10,採用,4/15,5/1,架空の備考\n' +
      '2,,タウン情報,乙川 花子,女,,2020/3/3,不採用,,,\n' +
      '3,2019/06/01,知人紹介,丙山 三郎,男,,,,,7/1,\n' +
      '4,2019/06/02,Indeed,,男,,,,,,';
    const STF = [{ id: 'S0101', name: '甲野一郎', hireDate: '2019-05-10', retireDate: '2020-01-31' }];
    const L = await opened({ stf: (b) => b.action === 'list' ? { ok: true, rows: STF } : { ok: true }, rpc: { ats_import: () => ({ ok: true, inserted: 3, skipped: 0 }) } });
    L.ctx.tab = 'import';
    const r = await L.ctx.planFromText_(CSVN); await settle();
    const h = L.els['p-import'].innerHTML;
    t('試算の前に職員マスタの一覧を1回だけ読む（list だけ・書く送信なし）', r === true && stfCalls(L).join() === 'list', stfCalls(L));
    t('取り込み元で入職済みの方に職員IDを付ける（退職した方も探す）', L.ctx.importPlan.items[0].row.staff_id === 'S0101' && L.ctx.importPlan.items[0].row.legacy_hired === true);
    t('試算のまとめ: 段階ごと・職員マスタで見つかった／見つからなかった・面接日・入れられない理由・経路ごと',
      /段階ごと（入れられる行）/.test(h) && /<td>6\. 入職完了<\/td><td class="num">2<\/td>/.test(h) && /<td>職員マスタで見つかった<\/td><td class="num">1<\/td>/.test(h) && /<td>見つからなかった<\/td><td class="num">1<\/td>/.test(h)
      && /<td>面接日のある行（面接の記録を作る）<\/td><td class="num">2<\/td>/.test(h) && /<td>氏名がありません<\/td><td class="num">1<\/td>/.test(h) && /<td>ジョブメドレー<\/td><td class="num">1<\/td>/.test(h), h.slice(0, 1500));
    t('その他にした元の書き方を種類の数つきで一覧に出す', /その他にした元の書き方（1種類）/.test(h) && /<li>タウン情報（1件）<\/li>/.test(h));
    t('「取り込んだ記録は保管期限の対象外です（ずっと残ります）」と1行出す', (h.match(/取り込んだ記録は保管期限の対象外です（ずっと残ります）。/g) || []).length === 1);
    t('受付日が空の行も入れられる（面接日の日付を受付日に）', L.ctx.importPlan.items[1].ok && L.ctx.importPlan.items[1].row.received_on === '2020-03-03');
    await L.ctx.runImport_(); await settle();
    const imp = L.rpcs().find((x) => x.name === 'ats_import');
    const sent = imp && imp.args.p_rows;
    t('取り込み: ✔ の行だけ・取り込み元で入職済みの項目と面接日をそのまま送る', sent && sent.length === 3 && sent[0].legacy_hired === true && sent[0].staff_id === 'S0101' && sent[0].legacy_result === '採用' && sent[0].interview_on === '2019-04-10' && sent[0].closed_on === null && sent[1].closed_on === '2020-03-03' && sent[2].legacy_hired === true && !('staff_id' in sent[2]), sent && sent.map((x) => Object.keys(x)));
    const Lx = await opened({ stf: (b) => b.action === 'list' ? { ok: true, rows: STF } : { ok: true }, rpc: { ats_import: () => ({ ok: false, error: 'badvalue', index: 1 }) } });
    Lx.ctx.tab = 'import';
    await Lx.ctx.planFromText_(CSVN); await settle();
    await Lx.ctx.runImport_(); await settle();
    t('データベースが1行を断った → 「1件も入っていません」と CSV の何行目かを出す（取り込みましたと言わない）', /取り込めませんでした（1件も入っていません）。CSV の 3行目の値/.test(Lx.els['a-msg'].textContent) && Lx.ctx.importPlan !== null, Lx.els['a-msg'].textContent);
    t('取り込みで本人希望などを端末に書かない', !L.writes.some((w) => /甲野|架空の備考|タウン情報/.test(w[3] || '')));
    const L2 = await opened({ stf: () => 'NET' });
    L2.ctx.tab = 'import';
    await L2.ctx.planFromText_(CSVN); await settle();
    const h2 = L2.els['p-import'].innerHTML;
    t('職員マスタの一覧を読めない → 職員IDを付けずに試算し、そう知らせる', L2.ctx.importPlan.count === 3 && L2.ctx.importPlan.items.every((x) => !('staff_id' in x.row)) && /職員マスタの一覧を読めなかったため、職員IDは付けず「取り込み元で入職済み」の印だけで入れます/.test(h2));
    const L3 = await opened({ local: { stfm_cfg: '{}' } });
    L3.ctx.tab = 'import';
    await L3.ctx.planFromText_(CSVN); await settle();
    t('職員マスタの接続先が無い → 送らずに試算し「接続先が見つからない」と知らせる', L3.fetches.length === 0 && L3.ctx.importPlan.count === 3 && /職員マスタの接続先が見つからないため（接続設定）/.test(L3.els['p-import'].innerHTML));
    const L4 = await opened({ stf: (b) => b.action === 'list' ? { ok: true, rows: STF } : { ok: true } });
    L4.ctx.tab = 'import';
    const p4 = L4.ctx.planFromText_(CSVN); L4.ctx.gen++; const r4 = await p4; await settle();
    t('一覧を待つ間に世代が変わった → 試算を捨てる', r4 === false && L4.ctx.importPlan === null);
    const BAD = '<img src=x onerror=alert(1)>';
    const L5 = await opened({ stf: (b) => b.action === 'list' ? { ok: true, rows: [] } : { ok: true } });
    L5.ctx.tab = 'import';
    await L5.ctx.planFromText_('氏名,受付日,求人媒体,性別\n甲野 一郎,2019/01/01,"' + BAD.replace(/"/g, '""') + '","' + BAD.replace(/"/g, '""') + '"');
    await settle();
    t('その他にした元の書き方・備考に残した値も文字のまま出す', !/<img/i.test(L5.els['p-import'].innerHTML) && /&lt;img src=x onerror=alert\(1\)&gt;（1件）/.test(L5.els['p-import'].innerHTML));
  }

  group('7. 文字・部品・CSP');
  const SMH = fs.readFileSync(path.join(ROOT, 'staff-master.html'), 'utf8');
  t('FLUSH_FAIL_MSG は職員マスタの画面の写し（＝GAS の定数）と1文字も違わない', FLUSH === /var FLUSH_FAIL_MSG = '([^']+)';/.exec(SMH)[1]);
  const scripts = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  t('su-errors.js がいちばん先・su-report.js が </body> の直前', /^su-errors\.js\?v=/.test(scripts[0]) && /<script src="su-report\.js\?v=[^"]+" data-tool="採用管理"><\/script>\n<\/body>/.test(HTML), scripts);
  t('日付の規則は職員マスタの算出モジュール（同じ版）を読む', scripts.indexOf('staff-master-calc.js?v=' + /staff-master-calc\.js\?v=([^"]+)"/.exec(SMH)[1]) >= 0 && scripts.indexOf('staff-master-calc.js?v=' + /staff-master-calc\.js\?v=([^"]+)"/.exec(SMH)[1]) < scripts.findIndex((s) => /^ats-calc\.js/.test(s)));
  t('ログインの部品は事務所PCで初めて読む（<script src> で先に読まない）', !scripts.some((s) => /^(su-auth|supabase-js)/.test(s)));
  t('インラインの on〜・console を使わない', !/\son[a-z]+=["']/.test(HTML) && !/console\./.test(HTML));
  t('丸囲み数字を使わない', !/[①-⑳⓪❶-❿]/.test(HTML + fs.readFileSync(path.join(ROOT, 'ats-calc.js'), 'utf8')));
  t('[hidden] を必ず隠す指定がある', /\[hidden\]\{display:none !important\}/.test(HTML));
  t('iPhone（700px 以下）だけで事務所の操作を隠す', /@media \(max-width:700px\)\{[\s\S]*?\.pc-only\{display:none !important\}/.test(HTML));
  t('URL に氏名・番号を載せない（hash はタブの名前だけ）', /history\.replaceState\(null,'','#'\+t\)/.test(S) && !/location\.hash\s*=/.test(S));

  say('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('  ✗ 試験が途中で止まりました: ' + (e && e.stack || e)); process.exit(1); });

/* 提出の試験で全部の点を入れる */
function settingsAll(ctx) { ctx.settings.evalItems.forEach((k) => { ctx.evalCtx.scores[k] = 4; }); }
