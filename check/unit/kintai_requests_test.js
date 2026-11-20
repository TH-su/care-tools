/* 勤怠管理の「申請」のタブ・ホームの申請の箱・締めの画面の数・職員のスマホの登録の試験（2026-11-21 新設・仕様書 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md の「段5」「段5 の設計の改め」・care-backend 統合 0114）
   実行: node check/unit/kintai_requests_test.js
   kintai.js の段5の関数の塊（「v5 段5: 職員の申請と承認」〜「操作」の前）と、それが使う今の部品（esc・断りの文・窓）を切り出し、偽の DOM・偽の rpc で動かす。架空の職員だけ。
   守りたいこと:
     1. 申請の一覧: 職員・種類・日付・中身（出勤か退勤と時刻／何時から・何時まで／月の確認）・本人の理由・出した時刻・状態を出し、本人のスマホから来た値は全部 esc を通る。
        承認待ちの打刻の直し・残業と早出だけに「承認」「差し戻し」を出す
     2. 断りの文: 申請の語（conflict・notfound・reason・locked）は申請の文、lead は NG の lead の文（f3c8869）のまま、スマホの語（toomany・busy・inactive）はスマホの文。
        本人の画面（kintai-self-calc.js）にも lead の文がある
     3. 承認: kintai_requests_decide に id・rev・承認か・メモを送り、成功したら月を読み直す（load(false)）。差し戻しは理由が無ければ送らない
     4. 「スマホを登録」は管理者（isAdmin）だけ・お休み中の人には出さない。「スマホの一覧」は勤怠の管理者ならだれでも
     5. QR の番号: 本人の画面の住所＋#c=番号 を絵にし、8文字は ABCD-EFGH の形で窓に出す。窓を閉じる（closeDlg・Esc の close）・別の窓・期限で、絵と番号を消してタイマーを止める
     6. 関数が無い（noDb）時: 申請の数・一覧・スマホの一覧に「データベースの更新がまだです」を出し、自動の報告（note）に回さず、もう聞かない
     7. 画面の形: 申請のタブ（要確認の次）・su-qr.js を kintai.js の前に読む・新しい部品の押す所は 699px 以下で 44px・印刷に出さない（no-print）
     9. 反証レビュー（2026-11-21）の直し: 一覧はタブに入る・箱から移る・読み直すで捨てて読み直し、古い答えで上書きしない／決めた後は前の数の答えを捨てる／
        差し戻しと取り消しの書きかけは確かめる／iPhone の幅でボタンを職員の欄の下に出す／本人の画面の時間単位の有休と締める前の目安の知らせ。
        本物の paint・setTab・bind・paintHome・dirty を偽の DOM で動かす（ホームの箱の件数・取り消しの送信も）。
        直す前の版で落ちることは KINTAI_JS=<直す前の kintai.js> KINTAI_HTML=… KINTAI_SELF_CALC=… で回して確かめる */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const C = require(path.join(ROOT, 'kintai-calc.js'));
/* 直す前の版で落ちることを確かめる時は KINTAI_JS・KINTAI_HTML・KINTAI_SELF_CALC で別のファイルを渡す（ふだんは使わない） */
const S = require(process.env.KINTAI_SELF_CALC || path.join(ROOT, 'kintai-self-calc.js'));
const MON = require(path.join(ROOT, 'kintai-monitor.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const K = process.env.KINTAI_JS ? fs.readFileSync(process.env.KINTAI_JS, 'utf8') : read('kintai.js');
const H = process.env.KINTAI_HTML ? fs.readFileSync(process.env.KINTAI_HTML, 'utf8') : read('kintai.html');
function cut(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); }
  throw new Error('閉じない: ' + head);
}
function between(src, a, b) { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('見つからない: ' + a); return src.slice(i, j); }

/* ── 偽の DOM（id で引く要素だけ）── */
function makeDom() {
  const els = {};
  const mkEl = (id) => {
    const e = { id, tag: 'div', className: '', textContent: '', innerHTML: '', hidden: false, disabled: false, children: [], value: '', open: false, scrollTop: 0,
      listeners: {}, parentNode: null, addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); },
      appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; this.textContent = ''; },
      querySelector() { return null; }, querySelectorAll() { return id === 'g-dlg-b' ? [$('e-rq-note'), $('e-reason')] : []; }, focus() {}, setAttribute() {}, removeAttribute() {},
      showModal() { this.open = true; }, close() { this.open = false; } };
    return e;
  };
  const $ = (id) => els[id] || (els[id] = mkEl(id));
  const kq = mkEl('kq');
  const docL = {};
  const document = { visibilityState: 'visible', createElement: (tag) => Object.assign(mkEl(''), { tag }), listeners: docL,
    addEventListener: (k, f) => { (docL[k] = docL[k] || []).push(f); },
    querySelector: (q) => (q === '#g-dlg-b .kq' ? kq : null), querySelectorAll: () => [] };
  return { els, $, document, kq };
}

/* ── kintai.js の段5の塊と、それが使う今の部品を箱で動かす ── */
const BLOCK = between(K, '  /* ── v5 段5: 職員の申請と承認', '  /* ── 操作 ── */');
const STATE = (K.match(/  var reqSt = null[^\n]*\n  var reqSum = null[^\n]*\n/) || [''])[0];
const PARTS = [
  cut(K, 'function esc('), cut(K, 'function noDb('), between(K, '  var NG = {', '  /* 有給の窓では'), cut(K, 'function friendly('), cut(K, 'function isNetErr('),
  (K.match(/var DENIED_MSG = '[^']*';/) || [''])[0], cut(K, 'function isDenied('), cut(K, 'function okOr('), cut(K, 'function msgOf('), cut(K, 'function mk('),
  cut(K, 'function pressBusy('), cut(K, 'function hm('), cut(K, 'function ms('), cut(K, 'function md('), "var WD = ['日', '月', '火', '水', '木', '金', '土'];", cut(K, 'function wd('),
  cut(K, 'function staffById('), cut(K, 'function dispName('), cut(K, 'function reasonRow('), cut(K, 'function needReason('),
  cut(K, 'function openDlg('), cut(K, 'function closeDlg('), cut(K, 'function formState('),
].join('\n');
/* opt.full: 画面の描き方（paint・paintTabs・ホーム）・タブの移り（setTab）・押す所の受け（bind）・窓の変更の確かめ（dirty）も本物を動かす。ほかのタブの描き方は空の偽物 */
const FULL = [
  (K.match(/  var TABS = \[[^\n]*/) || [''])[0], cut(K, 'function paint() {'), cut(K, 'function paintTabs('), cut(K, 'function setTab('), cut(K, 'function bind('),
  cut(K, 'function paintHome('), (K.match(/  var BOX_UNIT = [^\n]*/) || [''])[0], (K.match(/  var LV_JA = [^\n]*/) || [''])[0], cut(K, 'function boxHtml('), cut(K, 'function waitBox('),
  cut(K, 'function today()'), cut(K, 'function per()'), cut(K, 'function inPer('), (K.match(/  var DIRTY_MODES = [^\n]*/) || [''])[0], cut(K, 'function dirty('),
  'var month = OPT.month || null, selDate = null, setInit = null, LS_TAB = "kintai_tab", L = null, RUL = null, K36 = null, leaveSt = null, leaveBusy = false;',
  'var confirm = function (q) { LOG.confirms.push(q); return OPT.confirm ? OPT.confirm(q) : true; }, alert = function () {};',
  'function paintDay() { return "" } function paintReview() { return "" } function paintGrid() { return "" } function paintPerson() { return "" } function paintStaff() { return "" }',
  'function paintLeave() { return "" } function paintClose() { return reqCloseHtml(); } function paintSettings() { return "" } function bands() { return "" } function skel() {}',
  'function settingsState() { return null; } function settingsLeaveOk() { return true; } function settingsDirty() { return false; } function lsSet() {} function quietReload() {}',
  'function stampPrint() {} function endPrint() {} function isField() { return false; } function rawCfg() { return {}; } function loadLeave() {}',
].join('\n');
function box(opt = {}) {
  const dom = makeDom();
  const log = { rpc: [], notes: [], loads: [], drops: 0, paints: 0, toasts: [], timers: new Set(), cleared: [], confirms: [] };
  const env = {
    C, document: dom.document, $: dom.$,
    location: { href: 'https://example.invalid/care-tools/kintai.html?x=1#y' },
    window: { SUQr: opt.noQr ? null : { svg: (text, o) => ({ tag: 'svg', text, label: o && o.label }) }, addEventListener() {} }, MON, LOG: log,
    rpc: (name, args) => { log.rpc.push({ name, args }); return opt.rpc ? opt.rpc(name, args) : Promise.reject({ code: 'PGRST202', message: 'none' }); },
    note: (w) => log.notes.push(w), toast: (m) => log.toasts.push(m),
    paint: () => { log.paints++; }, paintTabs: () => {}, load: (w) => { log.loads.push(w); return Promise.resolve(); }, dropMonthCaches: () => { log.drops++; },
    perLabel: () => '2026年11月分', isAdmin: () => opt.admin !== false,
    setInterval: (f) => { const h = { f }; log.timers.add(h); return h; }, clearInterval: (h) => { log.cleared.push(h); log.timers.delete(h); },
  };
  const names = Object.keys(env);
  const src = PARTS + '\n' + STATE + (opt.full ? '\n' + FULL : '') + '\nvar view = "app", ym = "2026-11", busy = false, tab = OPT.tab || "requests", printAll = false, dlgCtx = null, editsCache = null, data = OPT.data || null;\n' + BLOCK +
    '\nreturn { paintRequests, reqMsg, selfMsg, selfBtns, openReqDecide, saveReqDecide, loadReqSum, loadReqs, reqCloseHtml, openEnroll, enrollTick, wipeEnroll, openDevices, closeDlg, openDlg, rqBody,' +
    ' paint: paint, setTab: typeof setTab === "function" ? setTab : null, bind: typeof bind === "function" ? bind : null, dirty: typeof dirty === "function" ? dirty : null, openRevoke, saveRevoke,' +
    ' get ym() { return ym; }, set ym(v) { ym = v; }, get tab() { return tab; }, set tab(v) { tab = v; }, get reqF() { return reqF; }, set reqF(v) { reqF = v; },' +
    ' get reqSt() { return reqSt; }, set reqSt(v) { reqSt = v; }, get reqSum() { return reqSum; }, set reqSum(v) { reqSum = v; }, get reqNoDb() { return reqNoDb; }, get enrollSt() { return enrollSt; }, get dlgCtx() { return dlgCtx; }, NG, NODB_REQ };';
  const api = new Function(...names, 'OPT', src)(...names.map((k) => env[k]), opt);
  return { api, dom, log, env };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const STAFF = [{ staff_id: 'sQ01', name: '見本 一子', active: true }, { staff_id: 'sQ02', name: '見本 二郎', active: false }];
const XSS = '<img src=x onerror=alert(1)>';
const ROWS = [
  { id: '00000000-0000-4000-8000-00000000r001', staff_id: 'sQ01', name: '見本 一子' + XSS, staff_active: true, kind: 'punch', work_date: '2026-11-05', ym: '2026-11', body: { kind: 'out', at: '2026-11-06T07:05:00+09:00' }, reason: '押し忘れ' + XSS, status: 'pending', rev: 1, created_at: '2026-11-06T08:00:00+09:00' },
  { id: '00000000-0000-4000-8000-00000000r002', staff_id: 'sQ01', name: '見本 一子', staff_active: true, kind: 'overtime', work_date: '2026-11-07', ym: '2026-11', body: { early_from: '2026-11-07T07:30:00+09:00', ot_until: '2026-11-07T19:00:00+09:00' }, reason: '見本の残業', status: 'pending', rev: 3, created_at: '2026-11-07T20:00:00+09:00' },
  { id: '00000000-0000-4000-8000-00000000r003', staff_id: 'sQ02', name: null, staff_active: false, kind: 'month', work_date: null, ym: '2026-11', body: {}, reason: null, status: 'approved', rev: 1, created_at: '2026-11-15T09:00:00+09:00' },
  { id: '00000000-0000-4000-8000-00000000r004', staff_id: 'sQ01', name: '見本 一子', staff_active: true, kind: 'overtime', work_date: '2026-11-08', ym: '2026-11', body: { ot_until: '2026-11-08T19:00:00+09:00' }, reason: 'x', status: 'rejected', rev: 2, created_at: '2026-11-08T20:00:00+09:00', decided_at: '2026-11-09T10:00:00+09:00', decided_by: 'check-office@example.invalid', decide_note: '見本の理由' + XSS },
];

(async () => {
  console.log('\n— 1. 申請の一覧の描き方 —');
  {
    const { api } = box();
    api.reqSt = { key: 'pending|all', rows: ROWS };
    const h = api.paintRequests();
    t('本人のスマホから来た値（氏名・理由・差し戻しの理由）は esc を通る（生の <img が無い）', h.indexOf('<img') < 0 && h.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0);
    t('打刻の直しの中身は「退勤」と時刻（その日と違う日は日付を添える）', api.rqBody(ROWS[0]) === '退勤 11/06 7:05' || api.rqBody(ROWS[0]) === '退勤 11/06 07:05', api.rqBody(ROWS[0]));
    t('残業と早出の中身は「早出 … から・残業 … まで」', /^早出 0?7:30 から・残業 19:00 まで$/.test(api.rqBody(ROWS[1])), api.rqBody(ROWS[1]));
    t('月の確認の中身は「2026年11月分の勤怠を確かめました」', api.rqBody(ROWS[2]) === '2026年11月分の勤怠を確かめました');
    t('種類・日付・状態の言葉が出る', /打刻の直し/.test(h) && /残業・早出/.test(h) && /月の勤怠の確認/.test(h) && /11\/05（木）/.test(h) && /承認待ち/.test(h) && /承認済み/.test(h) && /差し戻し<\/span>/.test(h));
    t('「承認」「差し戻し」は承認待ちの打刻の直し・残業と早出の2件だけ', (h.match(/data-act="rq-ok"/g) || []).length === 2 && (h.match(/data-act="rq-ng"/g) || []).length === 2 && h.indexOf('data-id="' + ROWS[2].id + '"') < 0);
    t('氏名が無い行は職員の番号・休止中の人に札', /sQ02 <span class="tag">休止中<\/span>/.test(h));
    t('差し戻した行に決めた人と理由', /差し戻しの理由: 見本の理由&lt;img/.test(h) && /check-office@example\.invalid/.test(h));
    t('一覧は印刷に出さない（no-print）・押す所に k5', /<div class="cd rq no-print">/.test(h) && /class="btn sm pri k5" data-act="rq-ok"/.test(h));
    api.reqSt = { key: 'pending|all', rows: [] };
    t('0件の時は「この条件の申請はありません」', /この条件の申請はありません/.test(api.paintRequests()));
  }

  console.log('\n— 2. 断りの文 —');
  {
    const { api } = box();
    const E = (k) => { const e = new Error(k); e.kintai = k; return e; };
    t('lead は main の NG の lead の文（次の月分の締めも解除する）のまま', api.reqMsg(E('lead')) === api.NG.lead && /次の月分の締めも解除/.test(api.reqMsg(E('lead'))));
    t('conflict・notfound・reason・locked は申請の文', /ほかの人が先に承認/.test(api.reqMsg(E('conflict'))) && /一覧を読み直して/.test(api.reqMsg(E('notfound'))) && /差し戻しの理由/.test(api.reqMsg(E('reason'))) && /承認できません/.test(api.reqMsg(E('locked'))));
    t('承認が中から返す打刻の語（badtime）は NG の文のまま', api.reqMsg(E('badtime')) === api.NG.badtime);
    t('関数が無い時は「データベースの更新がまだです」', /^データベースの更新がまだです/.test(api.reqMsg({ code: 'PGRST202' })));
    t('スマホの語 toomany・busy・inactive はスマホの文', /2台/.test(api.selfMsg(E('toomany'))) && /5つまで/.test(api.selfMsg(E('busy'))) && /お休み中/.test(api.selfMsg(E('inactive'))));
    t('管理者でない人が番号を出した時の断り（42501）は職員に分かる文', /管理者（2段階認証まで済んだ人）だけ/.test(api.selfMsg({ code: '42501', message: '職員のスマホの登録の番号を出せるのは管理者（二段階認証）だけです' })));
    t('本人の画面にも lead の文がある（申請の時・仮置き）', S.errorText('lead', 'request') === 'この日は締めた月分に近いため申請できません。事務所に知らせてください。' && !/[a-z_]{4,}/.test(S.ERR.lead));
  }

  console.log('\n— 3. 承認・差し戻しと月の読み直し —');
  {
    const calls = [];
    const { api, log, dom } = box({ rpc: (n, a) => { calls.push({ n, a }); return Promise.resolve({ ok: true, rev: 2, status: 'approved', applied: { punch_id: 9 } }); } });
    api.reqSt = { key: 'pending|all', rows: ROWS };
    api.openReqDecide(ROWS[0].id, true);
    t('承認の窓を開く（主ボタンは「承認する」）', api.dlgCtx && api.dlgCtx.mode === 'rq' && dom.els['g-dlg'].open);
    dom.$('e-rq-note').value = '  見本のメモ ';
    api.saveReqDecide(dom.$('btn'));
    await tick(); await tick();
    const c = calls.find((x) => x.n === 'kintai_requests_decide');
    t('kintai_requests_decide に id・rev・承認・メモ（前後の空白を落とす）を送る', c && c.a.p_id === ROWS[0].id && c.a.p_rev === 1 && c.a.p_approve === true && c.a.p_note === '見本のメモ', c && c.a);
    t('承認の後は月を読み直す（load(false)・月の控えを捨てる）', log.loads.length === 1 && log.loads[0] === false && log.drops === 1);
    t('承認の後は申請の一覧と数を読み直す印（reqSt・reqSum を空にする）・窓を閉じる', api.reqSt === null && api.reqSum === null && !dom.els['g-dlg'].open && api.dlgCtx === null);

    const b2 = box({ rpc: () => Promise.resolve({ ok: true }) });
    b2.api.reqSt = { key: 'pending|all', rows: ROWS };
    b2.api.openReqDecide(ROWS[1].id, false);
    b2.dom.$('e-rq-note').value = '   ';
    b2.api.saveReqDecide(b2.dom.$('btn'));
    await tick();
    t('差し戻しは理由が無ければ送らず、理由を求める', !b2.log.rpc.some((x) => x.name === 'kintai_requests_decide') && /差し戻しの理由/.test(b2.dom.$('e-msg').textContent));
    b2.dom.$('e-rq-note').value = '見本の差し戻し';
    b2.api.saveReqDecide(b2.dom.$('btn'));
    await tick(); await tick();
    const d2 = b2.log.rpc.find((x) => x.name === 'kintai_requests_decide');
    t('差し戻しは p_approve false・理由つきで送り、月は読み直さない', d2 && d2.args.p_approve === false && d2.args.p_note === '見本の差し戻し' && d2.args.p_rev === 3 && b2.log.loads.length === 0);

    const b3 = box({ rpc: () => Promise.resolve({ ok: false, error: 'lead', lead_ym: '2026-12' }) });
    b3.api.reqSt = { key: 'pending|all', rows: ROWS };
    b3.api.openReqDecide(ROWS[0].id, true);
    b3.api.saveReqDecide(b3.dom.$('btn'));
    await tick(); await tick();
    t('承認で lead が返ったら窓に NG の lead の文を出し、自動の報告に回さない', b3.dom.$('e-msg').textContent === b3.api.NG.lead && b3.log.notes.length === 0 && b3.log.loads.length === 0);
    const b4 = box({ rpc: () => Promise.resolve({ ok: false, error: 'conflict' }) });
    b4.api.reqSt = { key: 'pending|all', rows: ROWS };
    b4.api.openReqDecide(ROWS[0].id, true);
    b4.api.saveReqDecide(b4.dom.$('btn'));
    await tick(); await tick();
    t('conflict の時は申請の文を出し、一覧を読み直す印を付ける', /ほかの人が先に承認/.test(b4.dom.$('e-msg').textContent) && b4.api.reqSt === null);
    const b5 = box();
    b5.api.reqSt = { key: 'pending|all', rows: ROWS };
    b5.api.openReqDecide(ROWS[2].id, true);
    t('承認済みの行（月の確認）には承認の窓を開かない', b5.api.dlgCtx === null);
  }

  console.log('\n— 4. スマホを登録は管理者だけ —');
  {
    const a = box({ admin: true }).api, o = box({ admin: false }).api;
    t('管理者には「スマホを登録」と「スマホの一覧」', /data-act="sp-enroll" data-sid="sQ01"/.test(a.selfBtns(STAFF[0])) && /data-act="sp-list"/.test(a.selfBtns(STAFF[0])));
    t('管理者でない人には「スマホの一覧」だけ', !/sp-enroll/.test(o.selfBtns(STAFF[0])) && /data-act="sp-list"/.test(o.selfBtns(STAFF[0])));
    t('お休み中の人には「スマホを登録」を出さない', !/sp-enroll/.test(a.selfBtns(STAFF[1])));
    t('職員の番号は esc を通る', /data-sid="a&quot;b"/.test(a.selfBtns({ staff_id: 'a"b', active: true })));
    const b = box({ admin: false, data: { staff: STAFF }, rpc: () => Promise.resolve({ ok: true, code: 'a'.repeat(40), short: 'ABCDEFGH' }) });
    b.api.openEnroll('sQ01', b.dom.$('btn'));
    await tick();
    t('管理者でない時は押しても番号を出しに行かない', b.log.rpc.length === 0);
    t('職員と番号の行に selfBtns をつないだ', /staffMasterBtns\(s\) \+ selfBtns\(s\) \+ '<\/td><\/tr>'/.test(K));
  }

  console.log('\n— 5. QR の番号を窓を閉じたら消す —');
  {
    const CODE = '0123456789abcdef0123456789abcdef01234567';
    const exp = new Date(Date.now() + 600000).toISOString();
    const mkb = () => box({ data: { staff: STAFF }, rpc: (n) => n === 'kintai_self_enroll_issue' ? Promise.resolve({ ok: true, id: 7, code: CODE, short: 'ABCDHJKM', expiresAt: exp }) : Promise.resolve({ ok: true, devices: [], codes: [] }) });
    const b = mkb();
    b.api.openEnroll('sQ01', b.dom.$('btn'));
    await tick(); await tick();
    const svg = b.dom.$('e-sp-qr').children[0];
    t('kintai_self_enroll_issue に職員の番号だけを送る', b.log.rpc[0].name === 'kintai_self_enroll_issue' && JSON.stringify(b.log.rpc[0].args) === JSON.stringify({ p_staff_id: 'sQ01' }));
    t('QR は本人の画面の住所＋#c=番号（問い合わせの文字は付けない）', svg && svg.text === 'https://example.invalid/care-tools/kintai-self.html#c=' + CODE, svg && svg.text);
    t('8文字は ABCD-EFGH の形で窓に出し、番号の無い本人の画面の住所を添える', b.dom.$('e-sp-short').textContent === 'ABCD-HJKM' && b.dom.$('e-sp-sbox').hidden === false && b.dom.$('e-sp-url').textContent === 'https://example.invalid/care-tools/kintai-self.html');
    t('残りの時間を出す・番号は窓の状態に持たない', /あと (10|9)分/.test(b.dom.$('e-sp-exp').textContent) && JSON.stringify(b.api.enrollSt).indexOf(CODE) < 0 && JSON.stringify(b.api.enrollSt).indexOf('ABCD') < 0 && JSON.stringify(b.api.dlgCtx).indexOf(CODE) < 0);
    t('窓の中身は印刷に出さない（no-print）', /<div class="kq no-print">/.test(K));
    const timer = [...b.log.timers][0];
    b.api.closeDlg();
    t('閉じると QR の絵と8文字を消し、タイマーを止める', b.dom.$('e-sp-qr').children.length === 0 && b.dom.$('e-sp-short').textContent === '' && b.api.enrollSt === null && b.log.cleared.indexOf(timer) >= 0 && b.log.timers.size === 0);

    const b2 = mkb();
    b2.api.openEnroll('sQ01', b2.dom.$('btn'));
    await tick(); await tick();
    b2.api.openDlg('別の窓', '<p>見本</p>', true);
    t('別の窓を開くと QR と番号を先に消す', b2.dom.$('e-sp-qr').children.length === 0 && b2.dom.$('e-sp-short').textContent === '' && b2.api.enrollSt === null);
    t('Esc で閉じた時（dialog の close）も消す', /\$\('g-dlg'\)\.addEventListener\('close', function \(\) \{ wipeEnroll\(\); \}\);/.test(K) && /function closeDlg\(\) \{ wipeEnroll\(\);/.test(K) && /function openDlg\(title, b, lk, saveLabel, saveAct\) \{\s*wipeEnroll\(\);/.test(K));

    const b3 = box({ data: { staff: STAFF }, rpc: () => Promise.resolve({ ok: true, id: 8, code: CODE, short: null, expiresAt: new Date(Date.now() - 1000).toISOString() }) });
    b3.api.openEnroll('sQ01', b3.dom.$('btn'));
    await tick(); await tick();
    t('期限を過ぎた番号はすぐ消して知らせる', b3.dom.$('e-sp-qr').children.length === 0 && b3.api.enrollSt === null && b3.dom.kq.children.length === 1 && /期限（10分）が過ぎた/.test(b3.dom.kq.children[0].textContent));
    t('8文字を出せない時（short が null）は QR だけで、その知らせを出す', b3.dom.$('e-sp-sbox').hidden === true && b3.dom.$('e-sp-snone').hidden === false);
    const b4 = box({ data: { staff: STAFF }, rpc: () => Promise.resolve({ ok: true, id: 9, code: 'not-hex', short: 'ABCDEFGH' }) });
    b4.api.openEnroll('sQ01', b4.dom.$('btn'));
    await tick(); await tick();
    t('番号の形が違う応答では窓を開かない', b4.api.enrollSt === null && b4.log.toasts.length === 1);
  }

  console.log('\n— 6. 関数が無い（noDb）時の文 —');
  {
    const b = box();
    b.api.loadReqSum(true);
    await tick(); await tick();
    t('申請の数: 「データベースの更新がまだです」・報告しない', b.api.reqSum && b.api.reqSum.err === b.api.NODB_REQ && b.log.notes.length === 0 && b.api.reqNoDb === true);
    const n0 = b.log.rpc.length;
    b.api.loadReqSum(true); b.api.loadReqs();
    await tick();
    t('関数が無いと分かった後は聞き直さない（一覧も同じ文）', b.log.rpc.length === n0 && b.api.reqSt.err === b.api.NODB_REQ);
    t('締めの画面にも同じ文（締めは止めない）', b.api.reqCloseHtml().indexOf(b.api.NODB_REQ) >= 0);
    t('ホームの箱は読めない時「申請の承認待ち」の待ちの箱（読み直すボタンなし）', /else if \(reqSum\.err\) out\.push\(waitBox\('申請の承認待ち', reqSum\.err, false\)\);/.test(K));
    const d = box({ data: { staff: STAFF } });
    d.api.openDevices('sQ01');
    await tick(); await tick();
    t('スマホの一覧: 「データベースの更新がまだです」', d.dom.$('g-dlg-b').innerHTML.indexOf(d.api.NODB_REQ) >= 0 && d.log.notes.length === 0);
    const e = box({ data: { staff: STAFF }, rpc: () => Promise.reject({ code: 'PGRST202', message: 'x' }) });
    e.api.openEnroll('sQ01', e.dom.$('btn'));
    await tick(); await tick();
    t('スマホを登録: 関数が無い時は知らせだけ（報告しない）', /データベースの更新がまだです/.test(e.log.toasts[0] || '') && e.log.notes.length === 0);
  }

  console.log('\n— 7. 数とスマホの一覧の描き方 —');
  {
    const b = box({ rpc: () => Promise.resolve({ ok: true, rows: [ROWS[0], ROWS[1]], pending: 5, month_confirmed: 3, active_staff: 12 }) });
    b.api.loadReqSum(true);
    await tick(); await tick();
    t('承認待ちは事業者の全部の月分・この月分は行の数・確かめた人と在籍の人', b.api.reqSum.pending === 5 && b.api.reqSum.monthPending === 2 && b.api.reqSum.confirmed === 3 && b.api.reqSum.active === 12);
    t('kintai_requests_list に表示中の月分と承認待ちを聞く', JSON.stringify(b.log.rpc[0].args) === JSON.stringify({ p_ym: '2026-11', p_status: 'pending' }));
    const h = b.api.reqCloseHtml();
    t('締めの画面に「確かめた人 3／12」と承認待ちの件数・印刷に出さない', /確かめた人 3／12/.test(h) && /<b>2 件<\/b>（すべての月分で 5 件）/.test(h) && /<div class="cd no-print">/.test(h));
    const d = box({ data: { staff: STAFF }, rpc: () => Promise.resolve({ ok: true, devices: [
      { id: 11, staff_id: 'sQ01', created_at: '2026-11-01T09:00:00+09:00', last_used_at: '2026-11-20T09:00:00+09:00', revoked_at: null, state: 'active' },
      { id: 12, staff_id: 'sQ01', created_at: '2026-10-01T09:00:00+09:00', last_used_at: '2026-10-02T09:00:00+09:00', revoked_at: '2026-10-03T09:00:00+09:00', state: 'revoked' }], codes: [{ id: 1, staff_id: 'sQ01', state: 'open' }] }) });
    d.api.openDevices('sQ01');
    await tick(); await tick();
    const dh = d.dom.$('g-dlg-b').innerHTML;
    t('スマホの一覧: 作った日・最後に使った日・状態・取り消していない行にだけ「取り消す」', /使えます/.test(dh) && /取り消しました/.test(dh) && (dh.match(/data-act="sp-revoke"/g) || []).length === 1 && /data-id="11"/.test(dh) && /使われていない登録の番号が 1 つ/.test(dh));
    t('取り消しは理由が必ず・kintai_self_device_revoke（p_id は数・p_reason）', /rpc\('kintai_self_device_revoke', \{ p_id: Number\(ctx\.id\), p_reason: reason \}\)/.test(K) && /var ctx = dlgCtx, msg = \$\('e-msg'\), reason = needReason\(msg\);\s*if \(!reason\) return;/.test(K));
  }

  console.log('\n— 8. 画面の形 —');
  {
    t('申請のタブは要確認の次（TABS とボタン）・札 g-rq-n', /var TABS = \['home', 'day', 'review', 'requests', 'grid'/.test(K) && /data-tab="requests">申請<span class="tab-n" id="g-rq-n" aria-hidden="true"><\/span><\/button>/.test(H));
    t('su-qr.js（accounts.html と同じ版）を kintai.js の前に読む・kintai.js は 2026-11-21.5', /<script src="su-qr\.js\?v=2026-11-08"><\/script>\s*<script src="kintai\.js\?v=2026-11-21\.5"><\/script>/.test(H) && /su-qr\.js\?v=2026-11-08/.test(read('accounts.html')));
    /* ★反証レビュー（2026-11-21）の直し 6 で同じ @media の中に申請の一覧の並びの決まりを足したので、閉じかっこの代わりに改行で区切りを見る（44px・16px は同じ） */
    t('新しい部品の押す所は 699px 以下で 44px・入力の文字 16px', /@media \(max-width:699px\)\{\.btn\.k5,select\.k5,input\.k5\{min-height:44px\}select\.k5,input\.k5\{font-size:16px\}\n/.test(H));
    t('箱・締めの画面から申請のタブへは承認待ち・すべての月分で開く', /if \(b\.getAttribute\('data-rq'\) === 'pending'\) reqF = \{ status: 'pending', ym: '' \};/.test(K));
    t('Esc（cancel）で閉じる時はその場で QR と番号を消す（close の知らせは後から届くため）', /else \{ dlgCtx = null; wipeEnroll\(\); \} \}\);/.test(cut(K, 'function bind(')));
    t('描く時に承認待ちの数を読みに行く（申請のタブから開いてもタブの札が出る・1分より古い時だけ）', /if \(!month\) return;\s*if \(!reqSumFresh\(\)\) loadReqSum\(false\);/.test(cut(K, 'function paint(')));
    t('数を待つ間に月を替えたら今の月分を読み直す', /if \(atYm !== ym\) \{ loadReqSum\(false\); return; \}/.test(cut(K, 'function loadReqSum(')));
    t('申請の読み込みは月の読み込み（load）の鎖に入れない', !/kintai_requests_list/.test(cut(K, 'function load(')) && !/kintai_self_/.test(cut(K, 'function load(')));
    t('端末に申請・番号を残さない（段5の塊に localStorage・sessionStorage・lsSet が無い）', !/localStorage|sessionStorage|lsSet\(/.test(BLOCK));
    t('管理の口の名前（統合 0114）', ['kintai_requests_list', 'kintai_requests_decide', 'kintai_self_enroll_issue', 'kintai_self_devices', 'kintai_self_device_revoke'].every((n) => BLOCK.indexOf("rpc('" + n + "'") >= 0));
  }


  console.log('\n— 9. 反証レビュー（2026-11-21）の直しを動かして確かめる —');
  {
    const defer = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
    const per0 = C.periodOf('2026-11', null);
    const MONTH = C.computeMonth({ ym: '2026-11', period: per0, staff: [], schedule: [], punches: [], days: [], config: {}, now: Date.now() });
    const FRESH = () => ({ ym: '2026-11', at: Date.now(), pending: 3, monthPending: 1, confirmed: 2, active: 5 });
    const listOf = (rows) => ({ ok: true, rows, pending: rows.length, month_confirmed: null, active_staff: 5 });
    const tabCalls = (log) => log.rpc.filter((c) => c.name === 'kintai_requests_list' && c.args.p_ym === null);
    const fullBox = (o = {}) => { const b = box(Object.assign({ full: true, month: MONTH, data: { staff: STAFF, period: null } }, o)); return b; };
    const clickBtn = (b, attrs) => { const btn = { getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs }; b.dom.document.listeners.click.forEach((f) => f({ target: { closest: () => btn } })); };

    /* ホームの箱に件数が出る（本物の paint → paintHome → KintaiMonitor.boxes） */
    {
      const b = fullBox({ tab: 'home' });
      b.api.reqSum = FRESH();
      b.api.paint();
      const h = b.dom.$('g-main').innerHTML;
      t('ホームに「申請の承認待ち」の箱（3 件・押すと承認待ちで申請のタブへ）とタブの札 3', /class="hbox warn" data-tab="requests" data-rq="pending"><span class="ht"><span>申請の承認待ち<\/span><span class="hn">3 <small>件<\/small>/.test(h) && b.dom.$('g-rq-n').textContent === '3', h.slice(-600));
      b.api.reqSum = { ym: '2026-11', at: Date.now(), err: b.api.NODB_REQ };
      b.api.paint();
      const h2 = b.dom.$('g-main').innerHTML;
      t('関数が無い時のホーム: 「申請の承認待ち」の待ちの箱に同じ文・読み直すボタンなし・数の箱は出さない', h2.indexOf('<span>申請の承認待ち</span></span><span class="hl">' + b.api.NODB_REQ) >= 0 && h2.indexOf('lv-reload') < 0 && h2.indexOf('data-tab="requests"') < 0);
    }
    /* 描く時に承認待ちの数を読みに行く・待つ間に月を替えたら今の月分を読み直す */
    {
      const d1 = defer();
      const b = fullBox({ tab: 'grid', rpc: (n, a) => (a.p_ym === '2026-11' ? d1.p : Promise.resolve(listOf([]))) });
      b.api.paint();
      t('描くと（ほかのタブでも）承認待ちの数を読みに行く', b.log.rpc.some((c) => c.name === 'kintai_requests_list' && c.args.p_ym === '2026-11' && c.args.p_status === 'pending'));
      b.api.ym = '2026-12';
      d1.resolve(listOf([ROWS[0]]));
      await tick(); await tick(); await tick();
      t('待つ間に月を替えたら今の月分を読み直す（前の月分の数では描かない）', b.log.rpc.some((c) => c.args.p_ym === '2026-12') && (!b.api.reqSum || b.api.reqSum.ym === '2026-12'), b.api.reqSum);
    }
    /* 直し1: タブに入った時は一覧を捨てて読み直す */
    {
      const b = fullBox({ tab: 'home', rpc: () => Promise.resolve(listOf([ROWS[1]])) });
      b.api.reqSum = FRESH();
      b.api.reqSt = { key: 'pending|all', rows: [ROWS[0]] };
      b.api.setTab('requests');
      await tick(); await tick();
      t('直し1: 申請のタブに入ると一覧を読み直す（前に読んだ一覧を使い回さない）', tabCalls(b.log).length === 1 && b.api.reqSt && b.api.reqSt.rows[0].id === ROWS[1].id, b.api.reqSt && b.api.reqSt.rows.map((r) => r.id));
    }
    {
      const ds = [];
      const b = fullBox({ tab: 'requests', rpc: (n, a) => { if (a.p_ym !== null) return Promise.resolve(listOf([])); const d = defer(); ds.push(d); return d.p; } });
      b.api.reqSum = FRESH();
      b.api.paint();
      b.api.setTab('requests');
      t('直し1: 読み込み中にタブへ入り直すと、新しく読み直す', ds.length === 2, ds.length);
      if (ds[1]) ds[1].resolve(listOf([ROWS[1]]));
      await tick(); await tick();
      if (ds[0]) ds[0].resolve(listOf([ROWS[0]]));
      await tick(); await tick();
      t('直し1: 古い答え（先に出した読み込み）で上書きしない', b.api.reqSt && b.api.reqSt.rows.length === 1 && b.api.reqSt.rows[0].id === ROWS[1].id, b.api.reqSt && b.api.reqSt.rows.map((r) => r.id));
    }
    {
      const b = fullBox({ tab: 'close', rpc: () => Promise.resolve(listOf([ROWS[1]])) });
      b.api.bind();
      b.api.reqSum = FRESH();
      b.api.reqSt = { key: 'pending|all', rows: [ROWS[0]] };
      clickBtn(b, { 'data-tab': 'requests', 'data-rq': 'pending' });
      await tick(); await tick();
      t('直し1: 締めの画面・ホームの箱の「承認待ちの申請を見る」から移ると、承認待ち・すべての月分で読み直す', b.api.tab === 'requests' && b.api.reqF.status === 'pending' && b.api.reqF.ym === '' && tabCalls(b.log).length === 1 && b.api.reqSt.rows[0].id === ROWS[1].id);
    }
    {
      const ds = [];
      const b = fullBox({ tab: 'requests', rpc: (n, a) => { if (a.p_ym !== null) return Promise.resolve(listOf([])); const d = defer(); ds.push(d); return d.p; } });
      b.api.bind();
      b.api.reqSum = FRESH();
      b.api.paint();
      b.dom.$('g-reload').listeners.click.forEach((f) => f());
      t('直し1: 上の「読み直す」で月を読み直し、申請の一覧と数も捨てる', b.log.loads.length === 1 && b.api.reqSt === null && b.api.reqSum === null);
      ds[0].resolve(listOf([ROWS[0]]));
      await tick(); await tick();
      t('直し1: 「読み直す」の前に出した読み込みの答えは捨てる', b.api.reqSt === null, b.api.reqSt);
    }
    /* 直し4: 承認・差し戻しの直後は、決める前に出した数の読み込みの答えを捨てる */
    {
      const d = defer();
      const b = fullBox({ tab: 'requests', rpc: (n) => (n === 'kintai_requests_decide' ? Promise.resolve({ ok: true, rev: 2, status: 'approved', applied: {} }) : d.p) });
      b.api.loadReqSum(true);
      b.api.reqSt = { key: 'pending|all', rows: ROWS };
      b.api.openReqDecide(ROWS[0].id, true);
      b.api.saveReqDecide(b.dom.$('btn'));
      await tick(); await tick();
      d.resolve(listOf([ROWS[0], ROWS[1]]));
      await tick(); await tick();
      t('直し4: 決める前の数の答え（承認待ち 2）で、決めた後の数を上書きしない', !b.api.reqSum || b.api.reqSum.pending !== 2, b.api.reqSum);
    }
    /* 直し5: 差し戻し・承認のメモと取り消しの理由は、書きかけなら閉じる前に確かめる */
    {
      const b = fullBox({ tab: 'requests', confirm: () => false });
      b.api.bind();
      b.api.reqSt = { key: 'pending|all', rows: ROWS };
      b.api.openReqDecide(ROWS[1].id, false);
      t('直し5: 開いたばかりの差し戻しの窓は「書きかけ」ではない', b.api.dirty() === false);
      b.dom.$('e-rq-note').value = '見本の書きかけ';
      t('直し5: 差し戻しの理由を書きかけると「書きかけ」', b.api.dirty() === true);
      clickBtn(b, { 'data-act': 'dlg-close' });
      t('直し5: 「閉じる」は確かめを出し、やめたら窓を残す', b.log.confirms.length === 1 && b.dom.$('g-dlg').open === true && b.api.dlgCtx && b.api.dlgCtx.mode === 'rq');
      let prevented = false;
      b.dom.$('g-dlg').listeners.cancel.forEach((f) => f({ preventDefault() { prevented = true; } }));
      t('直し5: Esc も確かめを出し、やめたら閉じない', prevented && b.log.confirms.length === 2 && b.api.dlgCtx && b.api.dlgCtx.mode === 'rq');
    }
    {
      const b = fullBox({ tab: 'staff', rpc: () => Promise.resolve({ ok: true, devices: [{ id: 11, staff_id: 'sQ01', created_at: '2026-11-01T09:00:00+09:00', last_used_at: null, revoked_at: null, state: 'active' }], codes: [] }) });
      b.api.openDevices('sQ01');
      await tick(); await tick();
      b.api.openRevoke('11');
      t('直し5: 開いたばかりの取り消しの窓は「書きかけ」ではない', b.api.dirty() === false);
      b.dom.$('e-reason').value = '見本の理由';
      t('直し5: 取り消しの理由を書きかけると「書きかけ」', b.api.dirty() === true);
      /* 取り消しの送信（理由が無ければ送らない・あれば番号の数と理由を送り、一覧へ戻る） */
      b.dom.$('e-reason').value = '';
      b.api.saveRevoke(b.dom.$('btn'));
      await tick();
      t('取り消し: 理由が無ければ送らない', !b.log.rpc.some((c) => c.name === 'kintai_self_device_revoke') && /理由/.test(b.dom.$('e-msg').textContent));
      b.dom.$('e-reason').value = ' 見本の取り消し ';
      b.api.saveRevoke(b.dom.$('btn'));
      await tick(); await tick(); await tick();
      const rv = b.log.rpc.find((c) => c.name === 'kintai_self_device_revoke');
      t('取り消し: kintai_self_device_revoke に番号（数）と理由を送り、スマホの一覧へ戻る', rv && rv.args.p_id === 11 && rv.args.p_reason === '見本の取り消し' && b.api.dlgCtx && b.api.dlgCtx.mode === 'sp', rv && rv.args);
    }
    /* 窓の閉じ方（Esc の cancel・dialog の close）で QR と番号を消す */
    {
      const CODE = 'abcdef0123456789abcdef0123456789abcdef01';
      const mkE = () => fullBox({ tab: 'staff', rpc: (n) => (n === 'kintai_self_enroll_issue' ? Promise.resolve({ ok: true, id: 7, code: CODE, short: 'ABCDHJKM', expiresAt: new Date(Date.now() + 600000).toISOString() }) : Promise.resolve({ ok: true, devices: [], codes: [] })) });
      const b = mkE(); b.api.bind();
      b.api.openEnroll('sQ01', b.dom.$('btn')); await tick(); await tick();
      b.dom.$('g-dlg').listeners.cancel.forEach((f) => f({ preventDefault() {} }));
      t('Esc（cancel）の受けでその場で QR と8文字を消す', b.dom.$('e-sp-qr').children.length === 0 && b.dom.$('e-sp-short').textContent === '' && b.api.enrollSt === null);
      const b2 = mkE(); b2.api.bind();
      b2.api.openEnroll('sQ01', b2.dom.$('btn')); await tick(); await tick();
      b2.dom.$('g-dlg').listeners.close.forEach((f) => f());
      t('dialog の close でも QR と8文字を消す', b2.dom.$('e-sp-qr').children.length === 0 && b2.dom.$('e-sp-short').textContent === '' && b2.api.enrollSt === null);
    }
    /* 直し6: iPhone の幅では行を縦に積み、「承認」「差し戻し」を職員の欄のすぐ下に出す（PC の表は変えない・並びは HTML の @media で決める） */
    {
      const { api } = box();
      api.reqSt = { key: 'pending|all', rows: ROWS };
      const h = api.paintRequests();
      t('直し6: 職員の欄に印 rq-nm・ほかの欄に見出しの名前（data-l）・ボタンの欄 rq-btns', /<tr><td class="rq-nm">見本 一子/.test(h) && /<td data-l="中身">/.test(h) && /<td class="rq-btns"><button type="button" class="btn sm pri k5" data-act="rq-ok"/.test(h));
      const mq = (H.match(/@media \(max-width:699px\)\{\.btn\.k5[\s\S]*?\}\}\n/) || [''])[0];
      t('直し6: 699px 以下だけで、行を縦に積み、ボタンの欄（order:1）を職員の欄（order:0）のすぐ下に出す', /table\.rq-t tr\{display:flex;flex-direction:column/.test(mq) && /td\.rq-nm\{order:0/.test(mq) && /td\.rq-btns\{order:1;display:flex/.test(mq) && /table\.rq-t thead\{display:none\}/.test(mq) && !/table\.rq-t tr\{display:flex/.test(H.replace(mq, '')));
    }
    /* 本人の画面（直し2・3）: 時間単位の有休を使う施設だけ残りの近くに知らせ・締めていない月分だけ目安の知らせ */
    {
      t('直し2: 時間単位の有休を使う施設（どれかの月分の設定で true）だけ知らせる', S.hourlyLeaveOn && S.hourlyLeaveOn({ months: [{ ym: '2026-10', config: {} }, { ym: '2026-11', config: { hourlyPaidLeave: true } }] }) === true
        && S.hourlyLeaveOn({ months: [{ ym: '2026-11', config: { hourlyPaidLeave: false } }] }) === false && S.hourlyLeaveOn({}) === false && S.hourlyLeaveOn(null) === false);
      t('直し2: 文（仮置き）', S.HOURLY_NOTE === '時間単位で取った分は、ここの残りに入っていません。正しい残りは事務所で確かめてください。');
      t('直し3: 締めていない月分だけ「締める前の数字は目安です（締めた後に事務所の数字と同じになります）」', S.draftNote && S.draftNote({ locked: false }) === '締める前の数字は目安です（締めた後に事務所の数字と同じになります）' && S.draftNote({ locked: true }) === '');
    }
  }
  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
