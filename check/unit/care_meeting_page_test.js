/* 担当者会議の記録のページ（care-meeting.html）の配線の試験（2026-10-23 新設・段階2・代表者の決定）
   実行: node check/unit/care_meeting_page_test.js
   やり方: ページの HTML から画面のスクリプトを読み、トップレベルの関数と var を1つずつ切り出して vm で動かす
          （care_history_changedby_test.js の cutF と同じ作法。HTML 全体は評価しない。通信・画面の部品は偽物）。
          計算の部品は本物の care-meeting-calc.js を使う。
   守ること（段階2の仕様 §8）:
     1. 現場端末では取りに行かない（取得の関数が field で何もしない・用途が現場に変わったら読み込み直す）
     2. 遅れて届いた応答を世代で捨てる
     3. localStorage / sessionStorage に書くのは UI の状態だけ（書くキーの一覧を照合）
     4. 通信の形（POST・text/plain・redirect:'follow'・本文の token）。読み取りは1回だけやり直し、書き込みはやり直さない
     5. 描画の関数が esc を通す（氏名に <b> を入れても、そのまま文字で出る）
     6. 確定の前に checkFinal を通す・利用者名が合わない／同じ名前の方が2人いる時は確かめの印が要る
     7. 保存の前に checkSave を通す（上限を超えた欄・21名以上の出席者は送らない）
     8. 新しい記録の clientKey は送り直しても変わらない。直す時は変えた欄だけを送る
     9. 知らせの reason から「臨時の会議を記録」を押すと、開催の理由が選ばれた状態で開く
    10. 応答の読み分けは ok と code だけ（error の文で分けない）
     ほか: 読み込む部品の並び（§2）・紙面（§7）・未保存の止め（§5）・再読み込みで戻す（§6）
    12. innerHTML の全数点検（2026-10-25 本人指示・xss_facesheet_admission_test.js と同じやり方）
    13. 出席者の✔︎（この方の前回までの出席者から選ぶ）・印刷を A4 横いっぱいに・過去の記録の取り込み（管理者だけ）（2026-10-25 代表者の決定）

   ── 12 の点検表（innerHTML への代入17か所。insertAdjacentHTML・outerHTML は0か所。行番号は 2026-10-25 時点の目安） ──
   画面のスクリプトの innerHTML への代入を全部洗い、入る値が記録・名簿・自由入力・サーバーの文に由来するものは
   esc を通っていることを確かめた。漏れは見つからなかった（直した所なし）。
      1 showFieldOnly_  6つの箱を空にする（''）                         … 固定文だけ
      2 showFieldOnly_  現場端末の案内                                    … 固定文だけ
      3 showGate_       接続設定が無い時の案内                            … 固定文だけ
      4 paintPicker_    pickerHtml_（名簿の氏名・居室・最終開催日・下書きの件数・読めない理由） … esc を通る
      5 paintWho_       whoHtml_（開いている方の氏名・居室・介護度・読めない理由）          … esc を通る
      6 paintAlerts_    空にする（''）                                    … 固定文だけ
      7 paintAlerts_    一覧を読めていない時の案内                        … 固定文だけ
      8 paintAlerts_    alertsHtml_（知らせの文・開催の理由＝data-reason の属性）           … esc を通る（段階は表で決めた文字だけ）
      9 paintList_      listHtml_（開催日・開催の理由・回数・結論の頭・会議の番号＝data-mid・読めない理由） … esc を通る
     10 paintPrev_      空にする（''）                                    … 固定文だけ
     11 paintPrev_      prevHtml_（前回の記録の開催日・開催の理由・結論・残された課題・検討した項目） … esc を通る
     12 paintEditor_    editorHtml_（入力欄の value・textarea の中身・貼り付け欄・振り分けの知らせ・
                        ほかの端末との見比べ・確定した記録の表示・知らせの文・閉じた理由）  … esc を通る
     13 paintNameBand_  nameStateHtml_（議事録の利用者名・開いている方の氏名。文を組んでから esc）… esc を通る
     14 openDlg_        確かめの窓（題・各行・ボタンの文字。行に記録の値が入ることがある） … esc を通る
     15 openDlg_        閉じた時に空にする（''）                          … 固定文だけ
     16 definePrint_    印刷の前の紙面 printHtml_（利用者名と記録の全欄・出席者の続き）     … esc を通る
     17 definePrint_    印刷の後に空にする（''）                          … 固定文だけ
   固定する約束（記録の各欄・NotebookLM から振り分ける欄・名簿・サーバーの文に <img src=x onerror=…> や "><script> を
   入れても、出来上がった HTML に実行される形＝img・script 要素や属性を抜けた on〜 が入らない。値は文字として残る）。
   CARE_MEETING_HTML で差し替えるのは、わざと esc を外した版で落ちるかの確認用（既定は care-meeting.html）。
   ★氏名・本文はすべて架空。出力に console を使わない（個人情報を出力に流さない作法に合わせる）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(process.env.CARE_MEETING_HTML || path.join(ROOT, 'care-meeting.html'), 'utf8');
const CALC = require(path.join(ROOT, 'care-meeting-calc.js'));

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

/* 画面のスクリプト（'use strict' で始まるインラインの1本） */
const SM = /<script>\n'use strict';\n([\s\S]*?)<\/script>/.exec(HTML);
if (!SM) throw new Error('画面のスクリプトが見つかりません');
const S = SM[1];
/* 関数を名前で切り出す（行頭の function だけ・括弧の深さで終わりを決める） */
function cutF(src, name) {
  const h = src.indexOf('\nfunction ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h + 1, i + 1); } }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
/* トップレベルの var（1行、または「={」で始まり「};」で終わる塊） */
function topVars(src) {
  const lines = src.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^var /.test(lines[i])) continue;
    if (/=\{\s*$/.test(lines[i])) { const blk = [lines[i]]; while (!/^\};/.test(lines[++i])) blk.push(lines[i]); blk.push(lines[i]); out.push(blk.join('\n')); }
    else out.push(lines[i]);
  }
  return out.join('\n');
}
const FN_NAMES = [...S.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
const CODE = "'use strict';\n" + topVars(S) + '\n' + FN_NAMES.map((n) => cutF(S, n)).join('\n');

const URL0 = 'https://script.google.com/macros/s/KAKUU/exec';
const NET = Symbol('通信の失敗');
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 30); i++) await tick(); }

function fakeStorage(log, kind) {
  const m = new Map();
  return {
    m,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { log.push([kind, 'set', k, String(v)]); m.set(k, String(v)); },
    removeItem(k) { log.push([kind, 'remove', k]); m.delete(k); },
    clear() { log.push([kind, 'clear']); m.clear(); },
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] || null; }
  };
}
/* 偽物の部品で画面のスクリプトを読み込む。handler(body) は応答の値・NET（通信の失敗）・Promise を返す */
function load(opt) {
  opt = opt || {};
  const writes = [];
  const ls = fakeStorage(writes, 'local'), ss = fakeStorage(writes, 'session');
  if (opt.role) ls.m.set('su_device_role', opt.role);
  ls.m.set('rmaster_cfg', JSON.stringify({ url: URL0, token: 'tok-kakuu' }));
  if (opt.roster !== undefined) ls.m.set('su_residents_common', JSON.stringify(opt.roster));
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', className: '', hidden: false, disabled: false, style: {},
    classList: { add() {}, remove() {} }, contains() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, getAttribute() { return null; } });
  const calls = [];
  const cnt = { reload: 0, replace: [], ask: [], toast: [], created: [], gate: [] };
  const ctx = {
    Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error, Uint8Array, parseInt, encodeURIComponent, isNaN,
    crypto: nodeCrypto.webcrypto,
    setTimeout(fn, ms) { if (!(ms >= 5000)) setImmediate(fn); return 0; },
    clearTimeout() {},
    localStorage: ls, sessionStorage: ss,
    /* ログインの役割の確かめ（su-app-gate.js・2026-10-29）は偽物。既定は「開ける」。opt.gate: false＝部品なし、'block'＝開けない */
    window: Object.assign({ addEventListener() {} },
      opt.gate === false ? {} : { SUAppGate: { run(key) { cnt.gate.push(key); return Promise.resolve(opt.gate !== 'block'); } } }, opt.window || {}),
    document: { activeElement: null, body: { textContent: '', kids: [], appendChild(x) { this.kids.push(x); } }, getElementById: el, querySelector() { return null; }, querySelectorAll() { return []; }, scripts: [],
      createElement(tag) { const x = { tag, setAttribute() {} }; cnt.created.push(x); return x; },
      head: { appendChild(x) { if (x && x.onerror) setImmediate(() => x.onerror()); } } },
    location: { search: opt.search || '', pathname: '/care-meeting.html', reload() { cnt.reload++; } },
    history: { replaceState(a, b, u) { cnt.replace.push(u); } },
    URLSearchParams,
    CareMeetingCalc: opt.calc || CALC,
    fetch(url, o) {
      const body = JSON.parse(o.body);
      calls.push({ url, opt: o, body });
      const r = (opt.handler || (() => ({ ok: true, rows: [] })))(body);
      const wrap = (v) => (v === NET ? Promise.reject(new Error('通信の失敗')) : Promise.resolve({ text: () => Promise.resolve(JSON.stringify(v)) }));
      return r && typeof r.then === 'function' ? r.then(wrap) : wrap(r);
    }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'care-meeting.html（切り出し）' });
  /* 確かめの窓は偽物（答えは opt.answer で決める。呼ばれた題と文を控える） */
  ctx.askConfirm_ = function (title, lines) { cnt.ask.push({ title, lines }); return Promise.resolve(opt.answer !== undefined ? opt.answer : true); };
  ctx.askText_ = function (title, msg) { cnt.ask.push({ title, lines: [msg] }); return Promise.resolve(opt.text !== undefined ? opt.text : '架空の理由'); };
  ctx.toast = function (m) { cnt.toast.push(String(m)); };
  ctx.CFG.url = URL0; ctx.CFG.token = 'tok-kakuu';
  const meetCalls = () => calls.filter((c) => c.body.action === 'meeting');
  const ops = () => meetCalls().map((c) => c.body.op);
  /* 書き込み（save・setStatus・remove）だけ */
  const sent = () => meetCalls().filter((c) => ['save', 'setStatus', 'remove'].indexOf(c.body.op) >= 0);
  return { ctx, ls, ss, writes, calls, cnt, el, els, meetCalls, ops, sent };
}

/* 架空の入居者・記録 */
const TODAY = CALC.todayJST();
const daysAgo = (n) => CALC.todayJST(Date.now() - n * 86400000);
const RES = {
  901: { id: 901, name: '架空 一郎', room: '101', careLevel: '要介護2', careCertStart: '2026-04-01', careCertEnd: '2027-03-31', hospitalized: false,
    stateLog: [{ field: 'hospitalized', val: false, ts: '2026-01-10T01:00:00Z', src: 'master' }],
    careLevelHistory: [{ value: '要介護1', changedAt: '2026-03-01', note: '' }], family: [{ name: '架空 家族' }], medsRegular: '架空薬' },
  902: { id: 902, name: '架空 二郎', room: '102', careLevel: '要介護1' },
  903: { id: 903, name: '架空 三郎', room: '103', careLevel: '要支援2' }
};
const ROSTER = { v: 1, residents: [
  { masterId: '901', name: '架空 一郎', room: '101', active: true },
  { masterId: '902', name: '架空 二郎', room: '102', active: true },
  { masterId: '903', name: '架空 三郎', room: '103', active: false } ] };
function row(o) {
  return Object.assign({ meetingId: 'M20260401100000' + String(Math.floor(Math.random() * 9000) + 1000), residentId: '901', residentName: '架空 一郎', status: 'final', kind: '認定の更新',
    heldDate: '2026-04-01', place: '架空の会議室', timeText: '14:00〜15:00', count: '3', author: '架空 担当', createdDate: '2026-04-02',
    attendees: [{ role: '介護支援専門員', name: '架空 担当' }], items: '架空の項目', content: '架空の内容', conclusion: '架空の結論', issues: 'なし', nextText: '6か月後',
    sourceName: '架空 一郎', nameChecked: false, clientKey: '', rev: 2, createdAt: '2026-04-02T01:00:00Z', updatedAt: '2026-04-02T01:00:00Z', updatedBy: '', deleted: false, editNote: '', source: '画面' }, o || {});
}
/* 確定できる中身の記録 */
function fullRec(ctx, o) {
  const r = ctx.emptyRec_('');
  Object.assign(r, { heldDate: daysAgo(1), createdDate: daysAgo(0), place: '架空の会議室', timeText: '14:00〜15:00', count: '1', author: '架空 担当',
    attendees: [{ role: '介護支援専門員', name: '架空 担当' }, { role: '家族', name: '架空 家族' }], items: '架空の項目', content: '架空の内容', conclusion: '架空の結論',
    issues: 'なし', nextText: '6か月後', sourceName: '架空 一郎', kind: '新規' }, o || {});
  return r;
}
/* GAS の偽物。opts の op ごとの関数で応答を決める（無ければ既定） */
function gas(opts) {
  opts = opts || {};
  return function (b) {
    if (b.action === 'getResident') return opts.getResident ? opts.getResident(b) : { record: RES[b.id] ? JSON.parse(JSON.stringify(RES[b.id])) : null };
    if (b.action === 'meeting') {
      if (opts[b.op]) return opts[b.op](b);
      if (b.op === 'list') return { ok: true, rows: [] };
      if (b.op === 'summary') return { ok: true, residents: {} };
      if (b.op === 'save') return { ok: true, record: row(Object.assign({}, b.rec, { meetingId: b.meetingId || 'M20261023090000' + '0001', status: 'draft', rev: (Number(b.baseRev) || 0) + 1, clientKey: b.clientKey || '' })) };
      if (b.op === 'setStatus') return { ok: true, record: row({ meetingId: b.meetingId, status: b.status, rev: Number(b.baseRev) + 1 }) };
      if (b.op === 'remove') return { ok: true, record: row({ meetingId: b.meetingId, deleted: true, rev: Number(b.baseRev) + 1 }) };
    }
    return { error: '不明なaction' };
  };
}
/* 入居者を開いた状態を作る */
async function opened(opt) {
  const T = load(Object.assign({ roster: ROSTER }, opt || {}, { handler: (opt && opt.handler) || gas(opt && opt.gas) }));
  await T.ctx.openPerson_('901'); await settle();
  return T;
}

(async () => {
  group('0. 読み込む部品の並び（仕様 §2）');
  {
    const head = HTML.slice(0, HTML.indexOf('</head>'));
    const srcs = [...head.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    t('head の部品は su-errors → su-gas-auth → su-cfg-hint → su-perf → su-app-gate → su-facility → su-print → care-meeting-calc の順（su-cfg-hint は改善プロンプト第6弾の2・su-gas-auth は 2026-10-29）', JSON.stringify(srcs) === JSON.stringify(
      ['su-errors.js?v=2026-10-27', 'su-gas-auth.js?v=2026-10-29', 'su-cfg-hint.js?v=2026-10-27', 'su-perf.js?v=2026-10-27', 'su-app-gate.js?v=2026-10-29', 'su-facility.js?v=2026-10-26', 'su-print.js?v=2026-09-12', 'care-meeting-calc.js?v=2026-10-25']), srcs);
    t('su-print.css を読み、su-errors.js より前にスクリプトが無い', /<link rel="stylesheet" href="su-print\.css\?v=2026-09-12">/.test(head) && head.indexOf('<script') === head.indexOf('<script src="su-errors.js'));
    t('CSP・拡大を禁止しない viewport・no-store・noindex・題', /data-su-csp/.test(head) && /<meta name="viewport" content="width=device-width,initial-scale=1">/.test(head) && !/user-scalable=no|maximum-scale=1[^.0-9]/.test(head) &&
      /Cache-Control" content="no-store"/.test(head) && /robots" content="noindex/.test(head) && /<title>担当者会議の記録<\/title>/.test(head));
    t('</body> の直前に su-report.js（data-tool="担当者会議の記録"）', /<script src="su-report\.js\?v=2026-10-28" data-tool="担当者会議の記録"><\/script>\n<\/body>/.test(HTML));
    t('インラインのイベント属性・javascript: を使わない', !/\son[a-z]+=["']/.test(HTML) && !/javascript:/i.test(HTML));
    t('console を足していない', !/console\./.test(S));
    t('切り出した関数が揃う（' + FN_NAMES.length + '本）', FN_NAMES.length > 80 && ['boot', 'openPerson_', 'cmSave_', 'cmFinal_', 'classify_', 'printHtml_'].every((n) => FN_NAMES.indexOf(n) >= 0));
  }

  group('0b. ログインの役割の確かめ（su-app-gate.js・2026-10-29 代表者の決定）');
  {
    const A = load({ roster: ROSTER, handler: gas({ list: () => ({ ok: true, rows: [R1] }) }), gate: 'block', search: '?resident=901' });
    A.ctx.boot(); await settle();
    t('開けない時は何も読まない（通信 0回・入居者も開かない）', A.calls.length === 0 && A.ctx.cur === null && A.cnt.gate[0] === 'care-meeting', A.calls.map((c) => c.body.action));
    const B = load({ roster: ROSTER, handler: gas({ list: () => ({ ok: true, rows: [R1] }) }), gate: false, search: '?resident=901' });
    B.ctx.boot(); await settle();
    t('部品が読めない時も開かない（通信 0回・画面は案内だけ）', B.calls.length === 0 && B.ctx.cur === null && B.ctx.document.body.kids.length === 1 && /読み込めませんでした/.test(B.ctx.document.body.kids[0].textContent));
    const C = load({ role: 'field', roster: ROSTER, handler: gas(), search: '?resident=901' });
    C.ctx.boot(); await settle();
    t('現場端末は確かめより先に止まる（確かめを呼ばない）', C.cnt.gate.length === 0 && C.calls.length === 0);
    const D = load({ roster: ROSTER, handler: gas({ list: () => ({ ok: true, rows: [R1] }) }), search: '?resident=901' });
    D.ctx.boot(); await settle();
    t('開ける時だけ読む（入居者を開く）', D.cnt.gate[0] === 'care-meeting' && D.ctx.cur && D.ctx.cur.id === '901');
  }

  group('1. 現場端末では取りに行かない');
  {
    const T = load({ role: 'field', roster: ROSTER, handler: gas() });
    T.ctx.boot();
    await T.ctx.openPerson_('901'); await T.ctx.showPicker_();
    T.ctx.cur = { id: '901', name: '架空 一郎' };
    const r = await T.ctx.loadList_();
    t('起動・入居者を開く・選ぶ一覧・一覧の取り直しのどれも通信しない（0回）', T.calls.length === 0, T.calls.map((c) => c.body.action));
    t('案内だけを出す「担当者会議の記録は事務所PCだけで使えます」', /担当者会議の記録は事務所PCだけで使えます/.test(T.el('cm-gate').innerHTML) && T.el('cm-person').hidden === true && T.el('cm-pick').hidden === true);
    t('一覧の取り直しは false を返す', r === false);
    t('現場端末では接続設定も読まない（CFG は空のまま起動時に止まる）', T.ctx.cmView === 'field');
  }
  {
    const T = await opened();
    T.ctx.applyRole_();
    T.ctx.ed = T.ctx.newEditor_('');
    const g0 = T.ctx.gen;
    T.ls.m.set('su_device_role', 'field');
    T.ctx.onDeviceRoleChange_({ key: 'su_device_role' });
    t('用途が現場に変わったら読み込み直す（1回）', T.cnt.reload === 1, T.cnt.reload);
    t('読み込み直す前に世代を進め、開いていた方・記録をメモリから捨てる', T.ctx.gen > g0 && T.ctx.cur === null && T.ctx.ed === null && T.ctx.meetings.length === 0);
    t('画面の中身も消す（案内だけ）', T.el('cm-who').innerHTML === '' && T.el('cm-detail').innerHTML === '' && /事務所PCだけ/.test(T.el('cm-gate').innerHTML));
    T.ctx.onDeviceRoleChange_({ key: 'su_device_role' });
    t('現場として描いた後は繰り返さない', T.cnt.reload === 1);
    const U = await opened();
    U.ctx.applyRole_();
    U.ctx.onDeviceRoleChange_({ key: 'other_key' });
    U.ls.m.set('su_device_role', 'office');
    U.ctx.onDeviceRoleChange_({ key: 'su_device_role' });
    t('ほかのキー・事務所PCのままの知らせでは何もしない', U.cnt.reload === 0 && U.ctx.cur && U.ctx.cur.id === '901');
    t('storage と pageshow の受け口がトップレベルにある', /\nwindow\.addEventListener\('storage',function\(e\)\{ try\{ onDeviceRoleChange_\(e\); \}/.test(S) &&
      /\nwindow\.addEventListener\('pageshow',function\(e\)\{ try\{ if\(e&&e\.persisted\) onDeviceRoleChange_\(\{key:DEVICE_KEY\}\);/.test(S));
  }

  group('2. 遅れて届いた応答を世代で捨てる');
  {
    const pend = [];
    const T = load({ roster: ROSTER, handler: (b) => new Promise((res) => pend.push({ b, res })) });
    T.ctx.openPerson_('901');
    T.ctx.openPerson_('902');
    await settle();
    const of = (id) => pend.filter((p) => String(p.b.id) === id);
    of('902').forEach((p) => p.res(p.b.action === 'getResident' ? { record: RES[902] } : { ok: true, rows: [row({ residentId: '902', meetingId: 'M902' })] }));
    await settle();
    of('901').forEach((p) => p.res(p.b.action === 'getResident' ? { record: RES[901] } : { ok: true, rows: [row({ meetingId: 'M901' })] }));
    await settle();
    t('後から開いた方（902）だけが残る（先に開いた方の遅れた応答は捨てる）', T.ctx.cur && T.ctx.cur.id === '902' && T.ctx.cur.name === '架空 二郎', T.ctx.cur);
    t('記録の一覧も 902 のまま', T.ctx.meetings.length === 1 && T.ctx.meetings[0].meetingId === 'M902');
  }
  {
    const pend = [];
    const T = await opened({ handler: (b) => (b.action === 'meeting' && b.op === 'list' && pend.hold ? new Promise((res) => pend.push(res)) : gas()(b)) });
    pend.hold = true;
    T.ctx.loadList_();
    await settle();
    pend.hold = false;
    await T.ctx.openPerson_('902'); await settle();
    pend.forEach((res) => res({ ok: true, rows: [row({ meetingId: 'M-OLD' })] }));
    await settle();
    t('入居者を切り替えた後に届いた前の方の一覧は捨てる', T.ctx.cur.id === '902' && !T.ctx.meetings.some((m) => m.meetingId === 'M-OLD'));
  }
  {
    const pend = [];
    const T = load({ roster: ROSTER, handler: (b) => new Promise((res) => pend.push({ b, res })) });
    T.ctx.applyRole_();
    T.ctx.openPerson_('901');
    await settle();
    T.ls.m.set('su_device_role', 'field');
    T.ctx.onDeviceRoleChange_({ key: 'su_device_role' });
    pend.forEach((p) => p.res(p.b.action === 'getResident' ? { record: RES[901] } : { ok: true, rows: [row()] }));
    await settle();
    t('現場に変わった後に届いた応答は画面にもメモリにも入れない', T.ctx.cur === null && T.ctx.meetings.length === 0 && T.el('cm-who').innerHTML === '');
  }
  {
    const pend = [];
    const T = await opened({ handler: (b) => (b.op === 'summary' ? new Promise((res) => pend.push(res)) : gas()(b)) });
    T.ctx.showPicker_();
    await settle();
    await T.ctx.openPerson_('901'); await settle();
    pend.forEach((res) => res({ ok: true, residents: { 901: { lastHeld: '2026-04-01', count: 1, drafts: 0 } } }));
    await settle();
    t('選ぶ一覧の最終開催日の応答も、閉じた後なら捨てる', T.ctx.cmView === 'person' && T.ctx.summary === null);
  }

  group('3. 端末に書くのは UI の状態だけ');
  {
    t('localStorage に書く・消す所が無い', !/localStorage\.(setItem|removeItem|clear)\(/.test(S) && !/localStorage\[/.test(S));
    const ss = [...S.matchAll(/sessionStorage\.(setItem|removeItem)\(([^,)]+)/g)].map((m) => m[2]);
    t('sessionStorage に書くのは OPEN_KEY だけ', ss.length === 2 && ss.every((k) => k === 'OPEN_KEY'), ss);
    t("OPEN_KEY は 'cm_open_meeting'", /\nvar OPEN_KEY='cm_open_meeting';/.test(S));
    t('ほかの保存先（indexedDB・cookie）を使わない', !/indexedDB|document\.cookie/.test(S));
    t('setItem はこの1か所だけ', (S.match(/\.setItem\(/g) || []).length === 1);
  }
  {
    const R1 = row({ meetingId: 'M20260401100000' + '1111', status: 'draft' }), R2 = row({ meetingId: 'M20251001100000' + '2222', heldDate: '2025-10-01' });
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R1, R2] }) } });
    await T.ctx.openMeeting_(R1.meetingId, false);
    T.ctx.setField_('conclusion', '架空の結論を直した');
    await T.ctx.cmSave_(); await settle();
    T.ctx.ed.view = false;
    await T.ctx.openNew_('区分変更');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    await T.ctx.cmFinal_(); await settle();
    const local = T.writes.filter((w) => w[0] === 'local'), sess = T.writes.filter((w) => w[0] === 'session');
    t('入居者を開く・記録を開く・保存・確定の間に localStorage へ1回も書かない', local.length === 0, local);
    t('sessionStorage に書くのは cm_open_meeting だけ', sess.length > 0 && sess.every((w) => w[2] === 'cm_open_meeting'), sess.map((w) => w[2]));
    t('書く値は会議の番号の形だけ（氏名・本文を含まない）', sess.filter((w) => w[1] === 'set').every((w) => /^[0-9A-Za-z_-]{1,40}$/.test(w[3]) && w[3].indexOf('架空') < 0), sess);
    t('入院の記録・介護度の履歴は知らせの計算に要る項目だけをメモリに持つ（家族・処方は持たない）',
      !('family' in T.ctx.cur) && !('medsRegular' in T.ctx.cur) && T.ctx.cur.stateLog.length === 1 && Object.keys(T.ctx.cur.stateLog[0]).sort().join() === 'field,ts,val');
    T.ctx.saveOpenMeeting_('<b>架空</b>');
    t('番号の形でない値は書かずに消す', T.ss.getItem('cm_open_meeting') === null);
  }
  {
    const R1 = row({ meetingId: 'M20260401100000' + '3333', status: 'draft' });
    const T = load({ roster: ROSTER, handler: gas({ list: () => ({ ok: true, rows: [R1] }) }) });
    T.ss.m.set('cm_open_meeting', R1.meetingId);
    await T.ctx.openPerson_('901'); await settle();
    t('再読み込み：一覧にある番号なら、その記録を開き直す（原則11）', T.ctx.ed && T.ctx.ed.meetingId === R1.meetingId);
    const U = load({ roster: ROSTER, handler: gas({ list: () => ({ ok: true, rows: [R1] }) }) });
    U.ss.m.set('cm_open_meeting', 'M-NAI');
    await U.ctx.openPerson_('901'); await settle();
    t('一覧に無い番号は開かずに消す', U.ctx.ed === null && U.ss.getItem('cm_open_meeting') === null);
    const V = load({ roster: ROSTER, handler: gas(), search: '?resident=901' });
    V.ctx.boot(); await settle();
    t('利用者No は URL の resident で戻る（2026-10-25 本人指示で masterId から変えた）', V.ctx.cur && V.ctx.cur.id === '901');
    const W = load({ roster: ROSTER, handler: gas(), search: '?resident=%3Cb%3E' });
    W.ctx.boot(); await settle();
    t('形の合わない resident は開かずに知らせ、選ぶ一覧を出す', W.ctx.cur === null && W.ctx.cmView === 'pick' && W.cnt.toast.some((m) => /形が違う/.test(m)) && !W.calls.some((c) => c.body.action === 'getResident'));
    const M = load({ roster: ROSTER, handler: gas(), search: '?masterId=901' });
    M.ctx.boot(); await settle();
    t('masterId= は読まない＝引数なしと同じ（選ぶ一覧・知らせなし・入居者を読みに行かない）',
      M.ctx.cur === null && M.ctx.cmView === 'pick' && M.cnt.toast.length === 0 && !M.calls.some((c) => c.body.action === 'getResident'), [M.ctx.cmView, M.cnt.toast]);
    const M2 = load({ roster: ROSTER, handler: gas(), search: '?masterId=%3Cb%3E' });
    M2.ctx.boot(); await settle();
    t('形の合わない masterId= も読まない（形が違うの知らせも出さない）', M2.ctx.cur === null && M2.ctx.cmView === 'pick' && M2.cnt.toast.length === 0);
    const P = load({ roster: ROSTER, handler: gas() });
    P.ctx.pickPerson_('902'); await settle();
    t('一覧から選んだ時に書き換える URL も ?resident= だけ', P.cnt.replace.length === 1 && P.cnt.replace[0] === '?resident=902', P.cnt.replace);
    t('氏名は URL ではなくサーバーの値を出す', /架空 一郎/.test(V.el('cm-who').innerHTML));
  }

  group('4. 通信の形');
  {
    const T = load({ handler: () => ({ record: null }) });
    await T.ctx.apiGet({ action: 'getResident', id: 901 });
    const c = T.calls[0];
    t('入居者の読み取り：POST・text/plain;charset=utf-8・redirect:follow', c.url === URL0 && c.opt.method === 'POST' && c.opt.headers['Content-Type'] === 'text/plain;charset=utf-8' && c.opt.redirect === 'follow', c.opt);
    t('合言葉は本文に入れ、URL に載せない', c.body.token === 'tok-kakuu' && c.url.indexOf('tok') < 0 && c.body.id === '901');
    await T.ctx.meetingPost_({ action: 'meeting', op: 'save', id: '901', rec: { attendees: [{ role: 'a', name: 'b' }], nameChecked: true }, clientKey: 'cm-kakuu-0001' });
    const w = T.calls[1];
    t('会議の受け口も同じ形（POST・text/plain・redirect:follow・本文に token）', w.opt.method === 'POST' && w.opt.headers['Content-Type'] === 'text/plain;charset=utf-8' && w.opt.redirect === 'follow' && w.body.token === 'tok-kakuu' && w.url === URL0);
    t('会議の本文は形をそのまま送る（rec は入れ子・nameChecked は真偽）', w.body.rec.nameChecked === true && Array.isArray(w.body.rec.attendees) && w.body.action === 'meeting');
  }
  {
    const T = load({ handler: () => NET });
    let e1 = null; await T.ctx.meetingRead_({ action: 'meeting', op: 'list', id: '901' }).catch((e) => { e1 = e; });
    t('読み取り（list）は1回だけやり直す（2回送る）', T.calls.length === 2 && !!e1, T.calls.length);
    let e2 = null; await T.ctx.meetingPost_({ action: 'meeting', op: 'save' }).catch((e) => { e2 = e; });
    t('書き込みはやり直さない（1回だけ送る）', T.calls.length === 3 && !!e2);
    let e3 = null; await T.ctx.apiGetRetry({ action: 'getResident', id: '901' }).catch((e) => { e3 = e; });
    t('入居者の読み取りも1回だけやり直す', T.calls.length === 5 && !!e3);
    t('書き込みの関数は meetingRead_ を通さない（save・setStatus・remove は writeOp_ → meetingPost_）', /return meetingPost_\(body\)\.then/.test(cutF(S, 'writeOp_')) && !/meetingRead_/.test(cutF(S, 'writeOp_')));
  }

  group('5. 描画は esc を通す');
  {
    const X = '<b>架空</b>', XE = '&lt;b&gt;架空&lt;/b&gt;';
    const T = await opened();
    const c = { id: '901', name: X, room: X, careLevel: X };
    const ok = (h) => h.indexOf('<b>架空') < 0 && h.indexOf(XE) >= 0;
    const r = row({ kind: X, count: X, conclusion: X, issues: X, items: X, content: X, place: X, author: X, sourceName: X, nextText: X, timeText: X,
      attendees: Array.from({ length: 12 }, () => ({ role: X, name: X })) });
    t('開いている方の名前・居室・介護度', ok(T.ctx.whoHtml_(c)));
    t('記録の一覧', ok(T.ctx.listHtml_([r], '', 'ok')));
    t('期限の知らせ（文と開催の理由）', ok(T.ctx.alertsHtml_([{ kind: 'x', level: 'high', text: X, reason: X }])));
    t('前回の記録', ok(T.ctx.prevHtml_(r)));
    t('入居者を選ぶ一覧', ok(T.ctx.pickerHtml_({ ok: true, residents: [{ masterId: '901', name: X, room: X, active: true }] }, { 901: { lastHeld: '2026-04-01', drafts: 1 } }, 'ok')));
    t('紙面（出席者の10名目からの続きも）', ok(T.ctx.printHtml_(c, T.ctx.recOf_(r), 'draft')) && (T.ctx.printHtml_(c, T.ctx.recOf_(r), 'draft').match(/&lt;b&gt;/g) || []).length > 20);
    t('確定した記録の表示', ok(T.ctx.viewHtml_(T.ctx.recOf_(r))));
    const e = T.ctx.newEditor_('');
    e.rec = T.ctx.recOf_(r); e.rec.content = '</textarea><b>架空</b>'; e.paste = '</textarea><script>x()</script>';
    e.parse = { warns: [X], unknown: [{ label: X, in: 'conclusion' }, { label: X, in: '' }], missing: ['author'], preamble: X };
    T.ctx.cur.name = X;
    const h = T.ctx.editorHtml_(e, T.ctx.cur);
    t('作成・手直しの欄（入力の値・textarea の中身・振り分けの知らせ）', ok(h) && h.indexOf('</textarea><b>') < 0 && h.indexOf('<script>') < 0 && h.indexOf('&lt;/textarea&gt;') >= 0);
    e.conflict = row({ conclusion: X, attendees: [{ role: X, name: X }] });
    t('ほかの端末で直された時の見比べ', ok(T.ctx.conflictHtml_(e)));
    t('振り分けの知らせ', ok(T.ctx.parseNoticeHtml_(e.parse)));
    t('サーバーの断りの文も esc して出す', ok(T.ctx.actionsHtml_(Object.assign(T.ctx.newEditor_(''), { msg: T.ctx.codeMsg_('error', { error: X }), msgKind: 'ng' }))));
  }

  group('6. 確定の前に checkFinal・利用者名の確かめ');
  {
    const seen = [];
    const spy = Object.assign({}, CALC, { checkFinal(rec, ctx) { seen.push(ctx); return CALC.checkFinal(rec, ctx); } });
    const T = await opened({ calc: spy });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { sourceName: '架空 三郎' }); T.ctx.ed.touched = true;
    await T.ctx.cmFinal_(); await settle();
    t('利用者名が合わない：送らない（0回）', T.sent().length === 0, T.ops());
    t('合わない理由を出す', /一致しません/.test(T.ctx.ed.msg), T.ctx.ed.msg);
    t('checkFinal を通している（ctx.residentOk=false・ctx.today は今日）', seen.length === 1 && seen[0].residentOk === false && seen[0].today === TODAY, seen);
    t('赤い帯と「原本で確かめた」の印を出す', /nb-ng/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)) && /原本で、この方の会議の記録だと確かめた/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)));
    T.ctx.setField_('nameChecked', true);
    await T.ctx.cmFinal_(); await settle();
    t('確かめの印を付けると確定できる（保存→確定の順に送る）', JSON.stringify(T.ops()) === JSON.stringify(['save', 'list', 'setStatus', 'list']) || JSON.stringify(T.ops().filter((o) => o !== 'list')) === JSON.stringify(['save', 'setStatus']), T.ops());
    const sv = T.meetCalls().find((c) => c.body.op === 'save'), st = T.meetCalls().find((c) => c.body.op === 'setStatus');
    t('確定は保存で返った番号と版で送る（status:final）', st && st.body.status === 'final' && st.body.meetingId === 'M20261023090000' + '0001' && st.body.baseRev === 1 && st.body.name === '架空 一郎', st && st.body);
    t('保存の本文の nameChecked は真偽の true', sv && sv.body.rec.nameChecked === true);
    t('確定した後は表示だけ（確定した記録）', T.ctx.ed.view === true && T.ctx.ed.status === 'final');
  }
  {
    const dupe = { v: 1, residents: ROSTER.residents.concat([{ masterId: '904', name: '架空　一郎', room: '104', active: false }]) };
    const T = await opened({ roster: dupe });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    t('同じ名前の方が名簿に2人（退去した方を含む）：一致にしない（reason dupe）', T.ctx.nameState_('架空 一郎').reason === 'dupe' && T.ctx.residentOk_(T.ctx.ed.rec) === false);
    await T.ctx.cmFinal_(); await settle();
    t('同じ名前の方が2人：確かめの印が無ければ送らない', T.sent().length === 0 && /一致しません/.test(T.ctx.ed.msg));
    T.ctx.setField_('nameChecked', true);
    await T.ctx.cmFinal_(); await settle();
    t('確かめの印を付けると送る', T.ops().filter((o) => o !== 'list').join() === 'save,setStatus', T.ops());
  }
  {
    const T = await opened({ roster: null });
    T.ls.m.delete('su_residents_common'); T.ctx.roster = T.ctx.readRoster_();
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    t('名簿が読めない時は、名前が同じでも一致にしない（noRoster）', T.ctx.nameState_('架空 一郎').reason === 'noRoster');
    await T.ctx.cmFinal_(); await settle();
    t('名簿が読めない時は確かめの印が無ければ送らない', T.sent().length === 0);
    const U = await opened({ roster: { v: 1, residents: [{ masterId: '902', name: '架空 二郎', active: true }] } });
    t('名簿に開いている方がいない時も一致にしない', U.ctx.nameState_('架空 一郎').ok === false);
  }
  {
    const T = await opened();
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { sourceName: '架空 三郎' }); T.ctx.setField_('nameChecked', true);
    T.ctx.setField_('sourceName', '架空 四郎');
    t('議事録の利用者名を書き換えたら「確かめた」印を外す', T.ctx.ed.rec.nameChecked === false && T.ctx.ed.nameNote === true);
    T.ctx.setField_('nameChecked', true);
    const res = CALC.parse('◆利用者名：架空 五郎\n◆開催日：2026/04/01');
    T.ctx.applyParse_(T.ctx.ed, res);
    t('振り分けで利用者名が変わった時も印を外す', T.ctx.ed.rec.nameChecked === false && T.ctx.ed.rec.sourceName === '架空 五郎');
  }
  {
    const T = await opened({ answer: false });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { issues: '', place: '' }); T.ctx.ed.touched = true;
    await T.ctx.cmFinal_(); await settle();
    const a = T.cnt.ask[T.cnt.ask.length - 1];
    t('確定は確かめの一言を挟み、warns をそこに出す', a && /確定しますか/.test(a.title) && a.lines.some((l) => /残された課題/.test(l)) && a.lines.some((l) => /開催場所/.test(l)), a);
    t('「やめる」なら送らない', T.sent().length === 0);
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { heldDate: CALC.todayJST(Date.now() + 3 * 86400000) });
    T.cnt.ask.length = 0;
    await T.ctx.cmFinal_(); await settle();
    t('開催日が今日より後なら、確かめの前に止める', T.cnt.ask.length === 0 && /今日より後/.test(T.ctx.ed.msg));
  }

  group('7. 保存の前に checkSave');
  {
    let n = 0;
    const spy = Object.assign({}, CALC, { checkSave(rec) { n++; return CALC.checkSave(rec); } });
    const T = await opened({ calc: spy });
    await T.ctx.openNew_('');
    T.ctx.ed.rec.conclusion = 'あ'.repeat(3001); T.ctx.ed.touched = true;
    await T.ctx.cmSave_(); await settle();
    t('上限（結論 3000 字）を超えた欄は送らない', T.sent().length === 0 && /3000/.test(T.ctx.ed.msg) && n === 1, T.ctx.ed.msg);
    T.ctx.ed.rec.conclusion = '架空の結論';
    T.ctx.ed.rec.attendees = Array.from({ length: 21 }, (_, i) => ({ role: '架空', name: '架空' + i }));
    await T.ctx.cmSave_(); await settle();
    t('21名以上の出席者は送らない', T.sent().length === 0 && /20 名まで/.test(T.ctx.ed.msg), T.ctx.ed.msg);
    T.ctx.ed.rec.attendees = [{ role: '架空', name: 'い'.repeat(41) }];
    await T.ctx.cmSave_(); await settle();
    t('出席者の氏名が 40 字を超えたら送らない', T.sent().length === 0 && /40 字まで/.test(T.ctx.ed.msg));
    T.ctx.ed.rec.attendees = [{ role: '架空', name: '架空' }];
    await T.ctx.cmSave_(); await settle();
    t('直せば送る（下書き保存）', T.ops().filter((o) => o !== 'list').join() === 'save');
    t('「残り何字」を出し、切り詰めない', T.ctx.cntText_('conclusion', 'あ'.repeat(3005)).ng === true && /5 字超えています/.test(T.ctx.cntText_('conclusion', 'あ'.repeat(3005)).t) && T.ctx.cntText_('place', 'あい').t === '残り 98 字');
  }

  group('8. clientKey は送り直しても変わらない・直す時は変えた欄だけ');
  {
    let fails = 1;
    const T = await opened({ gas: { save: (b) => (fails-- > 0 ? NET : gas()(b)) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    const key0 = T.ctx.ed.clientKey;
    await T.ctx.cmSave_(); await settle();
    t('通信が切れた → 一覧を取り直して「保存できませんでした」（自動でやり直さない）', /保存できませんでした/.test(T.ctx.ed.msg) && T.ops().join() === 'list,save,list' && T.ctx.ed.mode === 'new', [T.ctx.ed.msg, T.ops()]);
    await T.ctx.cmSave_(); await settle();
    const saves = T.meetCalls().filter((c) => c.body.op === 'save');
    t('送り直しても同じ clientKey（同じ下書きを2行にしない）', saves.length === 2 && saves[0].body.clientKey === key0 && saves[1].body.clientKey === key0, saves.map((s) => s.body.clientKey));
    t('clientKey は英数字と - _ の 8〜40 字', /^[0-9A-Za-z_-]{8,40}$/.test(key0), key0);
    t('新しい記録の本文は {op:save, id, name, rec, clientKey}（名前の by は送らない）', Object.keys(saves[0].body).sort().join() === ['action', 'clientKey', 'id', 'name', 'op', 'rec', 'token'].sort().join() && saves[0].body.name === '架空 一郎');
    t('保存できたら直す記録になり、送信の印はもう使わない', T.ctx.ed.mode === 'edit' && T.ctx.ed.clientKey === '' && /保存しました/.test(T.ctx.ed.msg));
    const k1 = T.ctx.newEditor_('').clientKey, k2 = T.ctx.newEditor_('').clientKey;
    t('「新しい記録」を開くたびに別の clientKey', k1 !== k2);
  }
  {
    let key = '';
    const T = await opened({ gas: { save: (b) => { key = b.clientKey; return NET; }, list: () => ({ ok: true, rows: key ? [row({ meetingId: 'M-SAVED', status: 'draft', clientKey: key, rev: 1 })] : [] }) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    T.ctx.setField_('conclusion', '架空の結論（あとで直した）');
    await T.ctx.cmSave_(); await settle();
    t('通信が切れたが一覧に同じ clientKey の行がある → 「保存されていました」', /保存されていました/.test(T.ctx.ed.msg) && T.ctx.ed.mode === 'edit' && T.ctx.ed.meetingId === 'M-SAVED', T.ctx.ed.msg);
    t('同じ保存を自動でやり直さない（save は1回）', T.ops().filter((o) => o === 'save').length === 1);
    t('入力は消さずに残す', T.ctx.ed.rec.conclusion === '架空の結論（あとで直した）');
  }
  {
    const T = await opened({ gas: { save: (b) => ({ ok: true, existing: true, record: row({ meetingId: 'M-EX', status: 'draft', rev: 1, clientKey: b.clientKey, conclusion: '前に送った結論' }) }) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { conclusion: '今の結論' }); T.ctx.ed.touched = true;
    await T.ctx.cmSave_(); await settle();
    t('existing:true は「前に送った分が保存されていた」として扱い、今の入力との違いは残す', /前に送った分が保存されていました/.test(T.ctx.ed.msg) && T.ctx.ed.meetingId === 'M-EX' && T.ctx.ed.rec.conclusion === '今の結論' && T.ctx.isDirty_(T.ctx.ed));
  }
  {
    const T = await opened({ gas: { save: () => ({ ok: false, code: 'deleted', error: '取り消されています' }) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    const key0 = T.ctx.ed.clientKey;
    await T.ctx.cmSave_(); await settle();
    t('code deleted：「この下書きは取り消されています。新しい記録として開き直してください」', T.ctx.ed.msg === 'この下書きは取り消されています。新しい記録として開き直してください', T.ctx.ed.msg);
    t('clientKey を作り直して新しい記録として開き直す（入力は残す）', T.ctx.ed.mode === 'new' && T.ctx.ed.clientKey !== key0 && /^[0-9A-Za-z_-]{8,40}$/.test(T.ctx.ed.clientKey) && T.ctx.ed.rec.conclusion === '架空の結論');
  }
  {
    const R = row({ meetingId: 'M-EDIT', status: 'draft', rev: 4 });
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R] }) } });
    await T.ctx.openMeeting_('M-EDIT', false);
    t('開いただけでは何も送らない（変わった所なし）', T.ctx.saveBody_(T.ctx.ed, T.ctx.cur) === null);
    T.ctx.setField_('conclusion', '架空の結論（直した）');
    let b = T.ctx.saveBody_(T.ctx.ed, T.ctx.cur);
    t('直す時は rec に変えた欄だけ（結論だけ）', JSON.stringify(Object.keys(b.rec)) === '["conclusion"]' && b.meetingId === 'M-EDIT' && b.baseRev === 4 && !('clientKey' in b), b);
    T.ctx.setField_('sourceName', '架空　一郎');
    b = T.ctx.saveBody_(T.ctx.ed, T.ctx.cur);
    t('利用者名を直したら「確かめた」印も一緒に送る', Object.keys(b.rec).sort().join() === 'conclusion,nameChecked,sourceName' && b.rec.nameChecked === false, b.rec);
    T.ctx.ed.rec.attendees.push({ role: '', name: '' });
    t('空の出席者の行は「変わった所」にしない', !('attendees' in T.ctx.saveBody_(T.ctx.ed, T.ctx.cur).rec));
    T.ctx.ed.rec.attendees.push({ role: '家族', name: '架空 家族' });
    t('出席者を足したら出席者の表ごと送る', T.ctx.saveBody_(T.ctx.ed, T.ctx.cur).rec.attendees.length === 2);
    T.ctx.ed.rec = T.ctx.recOf_(R);
    await T.ctx.cmSave_(); await settle();
    t('変わった所が無ければ送らない', T.meetCalls().filter((c) => c.body.op === 'save').length === 0 && /変わった所はありません/.test(T.ctx.ed.msg));
  }
  {
    /* 直した記録で届いたか分からない時：版が上がり、送った値が入っていれば保存されていた・違えばほかの端末の手直し */
    const R = row({ meetingId: 'M-UN', status: 'draft', rev: 4 });
    let listRow = R;
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [listRow] }), save: () => ({ ok: false, code: 'unknown', unknown: true, error: 'x' }) } });
    await T.ctx.openMeeting_('M-UN', false);
    T.ctx.setField_('conclusion', '架空の結論A');
    listRow = Object.assign({}, R, { rev: 5, conclusion: '架空の結論A' });
    await T.ctx.cmSave_(); await settle();
    t('unknown → 版が上がり送った値が入っている → 保存されていました', /保存されていました/.test(T.ctx.ed.msg) && T.ctx.ed.baseRev === 5, T.ctx.ed.msg);
    T.ctx.setField_('conclusion', '架空の結論B');
    listRow = Object.assign({}, R, { rev: 6, conclusion: '別の端末の結論' });
    await T.ctx.cmSave_(); await settle();
    t('unknown → 版が上がったが値が違う → ほかの端末で直された（入力は残す）', !!T.ctx.ed.conflict && T.ctx.ed.rec.conclusion === '架空の結論B', T.ctx.ed.msg);
    const U = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), save: () => NET } });
    await U.ctx.openMeeting_('M-UN', false);
    U.ctx.setField_('conclusion', '架空の結論C');
    await U.ctx.cmSave_(); await settle();
    t('通信の失敗 → 版が同じ → 保存できませんでした', /保存できませんでした/.test(U.ctx.ed.msg) && U.ctx.ed.baseRev === 4);
  }
  {
    const R = row({ meetingId: 'M-CF', status: 'draft', rev: 4 });
    const cur = row({ meetingId: 'M-CF', status: 'draft', rev: 5, conclusion: '別の端末の結論' });
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), save: () => ({ ok: false, code: 'conflict', conflict: true, current: cur, error: 'x' }) } });
    await T.ctx.openMeeting_('M-CF', false);
    T.ctx.setField_('conclusion', '自分の結論');
    await T.ctx.cmSave_(); await settle();
    t('conflict：「ほかの端末で直されました」・今の記録を横に並べ、自分の入力は残す', /ほかの端末で直されました/.test(T.ctx.ed.msg) && T.ctx.ed.conflict.rev === 5 && T.ctx.ed.rec.conclusion === '自分の結論' &&
      /今の記録で開き直す/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)) && /別の端末の結論/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)));
    const before = T.meetCalls().length;
    await T.ctx.cmSave_(); await settle();
    t('見比べの間は保存を送らない', T.meetCalls().length === before);
    await T.ctx.reopenCurrent_(); await settle();
    t('「今の記録で開き直す」で今の版から開き直す', T.ctx.ed.baseRev === 5 && T.ctx.ed.conflict === null && T.ctx.ed.rec.conclusion === '別の端末の結論');
  }
  {
    /* 同じ保存が2回届いた（通信が切れた後にブラウザが送り直した等）：conflict でも、今の記録に送った値が入っていれば保存されていた扱い */
    const R = row({ meetingId: 'M-RT', status: 'draft', rev: 4 });
    let sentRec = null;
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), save: (b) => { sentRec = b.rec; return { ok: false, code: 'conflict', conflict: true, error: 'x',
      current: Object.assign({}, R, b.rec, { rev: 5, place: '別の端末で直した場所' }) }; } } });
    await T.ctx.openMeeting_('M-RT', false);
    T.ctx.setField_('conclusion', '架空の結論（2回届いた）');
    await T.ctx.cmSave_(); await settle();
    t('conflict でも今の記録に送った値が入っていれば「保存されていました」', /保存されていました/.test(T.ctx.ed.msg) && T.ctx.ed.conflict === null && T.ctx.ed.baseRev === 5, T.ctx.ed.msg);
    t('その時は今の記録を土台にし、ほかの端末が直した欄を古い入力で上書きしない', T.ctx.ed.rec.place === '別の端末で直した場所' && T.ctx.isDirty_(T.ctx.ed) === false && sentRec && Object.keys(sentRec).join() === 'conclusion');
  }

  group('9. 知らせの「臨時の会議を記録」');
  {
    const T = await opened();
    const h = T.ctx.alertsHtml_([{ kind: 'careChange', level: 'high', reason: '区分変更', text: '区分変更の前後に会議の記録がありません' }, { kind: 'interval', level: 'mid', reason: '', text: '間もなく6か月' }]);
    t('reason がある知らせの横に「臨時の会議を記録」', /data-act="extra" data-reason="区分変更"[^>]*>臨時の会議を記録<\/button>/.test(h) && (h.match(/臨時の会議を記録<\/button>/g) || []).length === 1, h);
    t('強い・中・お知らせを文字と記号で示す（色だけに頼らない）', /⚠ 急ぎ/.test(h) && /● 時期/.test(h) && /ℹ お知らせ/.test(T.ctx.alertsHtml_([{ level: 'info', text: 'x', reason: '' }])));
    const fakeBtn = { getAttribute: (k) => (k === 'data-reason' ? '区分変更' : null) };
    T.ctx.onAlertsClick_({ target: { closest: (sel) => (sel === '[data-act="extra"]' ? fakeBtn : null) } });
    await settle();
    t('押すと、開催の理由が選ばれた状態で新しい記録が開く', T.ctx.ed && T.ctx.ed.mode === 'new' && T.ctx.ed.rec.kind === '区分変更');
    t('欄の「開催の理由」で選ばれている', /<option value="区分変更" selected>/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)));
    t('理由を選んだだけでは「未保存の入力」にしない', T.ctx.isDirty_(T.ctx.ed) === false);
    await T.ctx.openNew_('<b>架空</b>');
    t('決まりに無い理由は選ばない', T.ctx.ed.rec.kind === '');
  }
  {
    const T = await opened({ answer: false });
    await T.ctx.openNew_('');
    T.ctx.setField_('content', '書きかけの架空の内容');
    const e0 = T.ctx.ed;
    await T.ctx.openNew_('退院・退所');
    t('書きかけがある時は確かめ、やめたら移らない', T.ctx.ed === e0 && T.cnt.ask.some((a) => /保存していない入力/.test(a.title)));
    const ev = { prevented: false, preventDefault() { this.prevented = true; } };
    T.ctx.onBeforeUnload_(ev);
    t('書きかけがある時は beforeunload で止める', ev.prevented === true);
    const ev2 = { prevented: false, preventDefault() { this.prevented = true; } };
    T.ctx.ed = null; T.ctx.onBeforeUnload_(ev2);
    t('書きかけが無ければ止めない', ev2.prevented === false);
  }
  {
    const T = await opened();
    const c = Object.assign({}, T.ctx.cur, { careCertStart: daysAgo(10), careCertEnd: '2099-12-31', careLevelHistory: [{ note: '区分変更（自動記録）', changedAt: daysAgo(5) }] });
    const a = T.ctx.alertsFor_(c, [], TODAY), kinds = a.map((x) => x.kind);
    t('認定の始まりと区分変更が両方出る時は、区分変更だけを出す', kinds.indexOf('careChange') >= 0 && kinds.indexOf('certStart') < 0, kinds);
    const b = T.ctx.alertsFor_(Object.assign({}, c, { careLevelHistory: [] }), [], TODAY).map((x) => x.kind);
    t('区分変更が無ければ認定の始まりは出す', b.indexOf('certStart') >= 0, b);
  }

  group('10. 応答の読み分けは ok と code だけ');
  {
    const T = load();
    const C = T.ctx.classify_;
    t('code があれば error の文に関係なく code で分ける', C({ ok: false, code: 'conflict', error: '保存しました' }) === 'conflict' && C({ ok: false, code: 'busy', error: 'deleted' }) === 'busy');
    t('ok===true だけが成功（error が付いていても）', C({ ok: true, error: 'conflict' }) === 'ok' && C({ ok: 'true' }) === 'error' && C({ ok: 1 }) === 'error');
    t('code の無い断り・知らない code は「受け付けなかった」', C({ error: 'conflict' }) === 'error' && C({ ok: false, code: 'nope' }) === 'error' && C(null) === 'error');
    const body = S.replace(cutF(S, 'parseJson'), '').replace(cutF(S, 'codeMsg_'), '');
    t('error の文を読むのは表示の codeMsg_ と入居者の読み取りの parseJson だけ', !/\.error\b/.test(body) && !/\['error'\]/.test(body), (body.match(/.{30}\.error\b.{10}/g) || []));
  }
  {
    const T = await opened({ gas: { save: () => ({ ok: false, code: 'busy', error: 'conflict deleted 保存しました' }) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    const key0 = T.ctx.ed.clientKey;
    await T.ctx.cmSave_(); await settle();
    t('busy の断りは文に「conflict」「deleted」があっても busy として出す', T.ctx.ed.msg === T.ctx.CODE_MSG.busy && T.ctx.ed.conflict === null && T.ctx.ed.clientKey === key0 && T.ctx.ed.mode === 'new');
  }
  {
    const T = await opened({ gas: { save: () => ({ ok: false, code: 'head_mismatch', error: 'x' }) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    await T.ctx.cmSave_(); await settle();
    const n = T.meetCalls().length;
    await T.ctx.cmSave_(); await T.ctx.cmFinal_(); await settle();
    t('head_mismatch：「記録のタブの列が変わっています。管理者に知らせてください」と出し、書く操作を止める', T.ctx.writeStop === true && T.meetCalls().length === n &&
      /記録のタブの列が変わっています。管理者に知らせてください/.test(T.ctx.actionsHtml_(T.ctx.ed)) && / data-act="save" disabled/.test(T.ctx.actionsHtml_(T.ctx.ed)));
    const U = await opened({ gas: { list: () => ({ ok: false, code: 'head_mismatch', error: 'x' }) } });
    t('一覧の取得で head_mismatch でも書く操作を止める', U.ctx.writeStop === true && U.ctx.listState === 'head');
    const V = await opened({ gas: { save: () => ({ error: '認証エラー' }) } });
    await V.ctx.openNew_('');
    V.ctx.ed.rec = fullRec(V.ctx); V.ctx.ed.touched = true;
    await V.ctx.cmSave_(); await settle();
    t('code の無い断り（認証エラーなど）は文をそのまま見せる（届いたか分からない扱いにしない）', /サーバーが受け付けませんでした：認証エラー/.test(V.ctx.ed.msg) && V.ops().filter((o) => o === 'list').length === 1);
  }

  group('11. 直し（反証レビューとヘッドレス検収の指摘・2026-10-23）');
  {
    /* (1) 新しい記録：existing で返った行の版が 1 より大きい＝ほかの端末で手が入った → 並べた表示（黙って差分で戻さない） */
    const T = await opened({ gas: { save: (b) => ({ ok: true, existing: true, record: row({ meetingId: 'M-EX2', status: 'draft', rev: 3, clientKey: b.clientKey, conclusion: 'ほかの端末で直した結論' }) }) } });
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { conclusion: '自分の結論' }); T.ctx.ed.touched = true;
    await T.ctx.cmSave_(); await settle();
    const h = T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur);
    t('(1) existing で版が 1 より大きい → 「ほかの端末で直されました」の並べた表示', !!T.ctx.ed.conflict && T.ctx.ed.msg === T.ctx.CODE_MSG.conflict && /ほかの端末で直した結論/.test(h) && /今の記録で開き直す/.test(h), T.ctx.ed.msg);
    t('(1) 自分の入力は残し、保存・確定は止める', T.ctx.ed.rec.conclusion === '自分の結論' && / data-act="save" disabled/.test(h) && / data-act="final" disabled/.test(h));
    const n = T.sent().length;
    await T.ctx.cmSave_(); await T.ctx.cmFinal_(); await settle();
    t('(1) 並べた表示の間は送らない（ほかの端末の手直しを差分で戻さない）', T.sent().length === n);
    const U = await opened({ gas: { save: (b) => ({ ok: true, existing: true, record: row({ meetingId: 'M-EX1', status: 'draft', rev: 1, clientKey: b.clientKey, conclusion: '前に送った結論' }) }) } });
    await U.ctx.openNew_('');
    U.ctx.ed.rec = fullRec(U.ctx, { conclusion: '今の結論' }); U.ctx.ed.touched = true;
    await U.ctx.cmSave_(); await settle();
    t('(1) 版が 1 のまま（誰も手を入れていない）なら従来どおり「前に送った分が保存されていました」', !U.ctx.ed.conflict && /前に送った分が保存されていました/.test(U.ctx.ed.msg));
    let key = '';
    const V = await opened({ gas: { save: (b) => { key = b.clientKey; return NET; }, list: () => ({ ok: true, rows: key ? [row({ meetingId: 'M-UN2', status: 'draft', rev: 2, clientKey: key, conclusion: 'ほかの端末で直した結論' })] : [] }) } });
    await V.ctx.openNew_('');
    V.ctx.ed.rec = fullRec(V.ctx, { conclusion: '自分の結論' }); V.ctx.ed.touched = true;
    await V.ctx.cmSave_(); await settle();
    t('(1) 一覧の読み直しで見つけた行の版が 1 より大きい時も並べた表示（savedAfter_）', !!V.ctx.ed.conflict && V.ctx.ed.meetingId === 'M-UN2' && V.ctx.ed.rec.conclusion === '自分の結論' && !/保存されていました/.test(V.ctx.ed.msg));
  }
  {
    /* (2) 確定でぶつかった時：今の行が final でも、中身が押した時に確かめていた記録と違えば並べた表示 */
    const R = row({ meetingId: 'M-F2', status: 'draft', rev: 4 });
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), setStatus: () => ({ ok: false, code: 'conflict', error: 'x', current: Object.assign({}, R, { status: 'final', rev: 5, conclusion: 'ほかの端末の結論' }) }) } });
    await T.ctx.openMeeting_('M-F2', false);
    T.ctx.setField_('sourceName', '架空 一郎');
    await T.ctx.cmFinal_(); await settle();
    t('(2) final でぶつかり中身が違う → 並べた表示（「確定されていました」と出さない）', !!T.ctx.ed.conflict && !/確定されていました/.test(T.ctx.ed.msg) && T.ctx.ed.msg === T.ctx.CODE_MSG.conflict, T.ctx.ed.msg);
    const U = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), setStatus: () => ({ ok: false, code: 'conflict', error: 'x', current: Object.assign({}, R, { status: 'final', rev: 5 }) }) } });
    await U.ctx.openMeeting_('M-F2', false);
    await U.ctx.cmFinal_(); await settle();
    t('(2) 中身が同じで final なら「確定されていました」', /確定されていました/.test(U.ctx.ed.msg) && U.ctx.ed.view === true && !U.ctx.ed.conflict, U.ctx.ed.msg);
    let st = 0;
    const V = await opened({ gas: { list: () => ({ ok: true, rows: [st ? Object.assign({}, R, { status: 'final', rev: 5, items: 'ほかの端末の項目' }) : R] }), setStatus: () => { st = 1; return NET; } } });
    await V.ctx.openMeeting_('M-F2', false);
    await V.ctx.cmFinal_(); await settle();
    t('(2) 確定の通信が切れ、一覧の行が final でも中身が違う → 並べた表示', !!V.ctx.ed.conflict && !/確定されていました/.test(V.ctx.ed.msg));
    const W = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), save: (b) => ({ ok: false, code: 'conflict', error: 'x', current: Object.assign({}, R, b.rec, { status: 'final', rev: 6 }) }) } });
    await W.ctx.openMeeting_('M-F2', false);
    W.ctx.setField_('conclusion', '架空の結論（確定の前に直した）');
    await W.ctx.cmFinal_(); await settle();
    const wh = W.ctx.editorHtml_(W.ctx.ed, W.ctx.cur);
    t('(2) 確定の流れの保存で、行がすでに final → 並べた表示（確定ボタンの無い画面で「もう一度『確定』を」と出さない）',
      !!W.ctx.ed.conflict && !/もう一度「確定」/.test(W.ctx.ed.msg) && /今の記録で開き直す/.test(wh) && !W.sent().some((c) => c.body.op === 'setStatus'), W.ctx.ed.msg);
  }
  {
    /* (3) 「◆利用者名」の無い議事録を貼り直す → 名前を空にし、印を外し、帯を赤にする。残る欄は確かめの窓に並べる */
    const T = await opened();
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx, { sourceName: '架空 三郎' }); T.ctx.setField_('nameChecked', true);
    T.el('cm-paste').value = '◆開催日：2026/04/01\n◆結論：貼り直した結論';
    await T.ctx.cmParse_(); await settle();
    const a = T.cnt.ask[T.cnt.ask.length - 1] || { lines: [] };
    t('(3) 利用者名の行が無い → 名前を空にし「確かめた」印を外す', T.ctx.ed.rec.sourceName === '' && T.ctx.ed.rec.nameChecked === false && T.ctx.nameState_('').reason === 'empty');
    t('(3) 名前の帯を赤にする', /nb-ng/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)) && /議事録の利用者名が空です/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)));
    t('(3) 確かめの窓に「貼った文章に無いため、前の内容のまま残る欄：…」を並べる（消さない）', a.lines.some((l) => /^貼った文章に無いため、前の内容のまま残る欄：/.test(l) && /作成担当者/.test(l) && /出席者/.test(l) && !/結論/.test(l)) &&
      a.lines.some((l) => /利用者名（貼った文章に無いため空にします）/.test(l)) && T.ctx.ed.rec.author === '架空 担当' && T.ctx.ed.rec.conclusion === '貼り直した結論', a.lines);
  }
  {
    /* (4) 表示中・取り消す・下書きへ戻すで deleted → 新しい記録に化けさせず閉じる */
    const R = row({ meetingId: 'M-DEL', status: 'final', rev: 7 });
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), setStatus: () => ({ ok: false, code: 'deleted', error: 'x' }) } });
    await T.ctx.openMeeting_('M-DEL', false);
    await T.ctx.cmToDraft_(); await settle();
    t('(4) 表示中の記録で deleted → 新しい記録に化けない（閉じる）', T.ctx.ed === null && T.ss.getItem('cm_open_meeting') === null);
    t('(4) 「この記録はほかの端末で取り消されていました」と出し、一覧を取り直す', /この記録はほかの端末で取り消されていました/.test(T.ctx.editorHtml_(null, T.ctx.cur)) && T.ops().filter((o) => o === 'list').length >= 2);
    const U = await opened({ gas: { list: () => ({ ok: true, rows: [R] }), remove: () => ({ ok: false, code: 'deleted', error: 'x' }) } });
    await U.ctx.openMeeting_('M-DEL', false);
    await U.ctx.cmRemove_(); await settle();
    t('(4) 取り消すで deleted → 閉じる（新しい記録にしない）', U.ctx.ed === null);
    const D = row({ meetingId: 'M-DD', status: 'draft', rev: 2 });
    const W = await opened({ gas: { list: () => ({ ok: true, rows: [D] }), save: () => ({ ok: false, code: 'deleted', error: 'x' }) } });
    await W.ctx.openMeeting_('M-DD', false);
    W.ctx.setField_('conclusion', '直している結論');
    await W.ctx.cmSave_(); await settle();
    t('(4) 下書きを直している最中の保存で deleted だけは、入力を残して新しい記録として開き直す', W.ctx.ed && W.ctx.ed.mode === 'new' && W.ctx.ed.rec.conclusion === '直している結論');
    let gone = false;
    const X = await opened({ gas: { list: () => ({ ok: true, rows: gone ? [] : [Object.assign({}, D)] }), setStatus: () => { gone = true; return NET; } } });
    await X.ctx.openMeeting_('M-DD', false);
    await X.ctx.cmFinal_(); await settle();
    t('(4) 確定の通信が切れ、一覧から消えていた → 閉じる（新しい記録にしない）', X.ctx.ed === null);
  }
  {
    /* (5) 1行の欄の改行 */
    const T = await opened();
    await T.ctx.openNew_('');
    T.ctx.applyParse_(T.ctx.ed, CALC.parse('◆利用者名：架空\n一郎\n◆開催場所：架空の\n会議室\n◆次回の開催時期：\n6か月後\nまたは状態の変化時'));
    t('(5) 振り分けで1行の欄に入る値は、改行を空白1つにする', T.ctx.ed.rec.place === '架空の 会議室' && T.ctx.ed.rec.nextText === '6か月後 または状態の変化時' && T.ctx.ed.rec.sourceName === '架空 一郎', T.ctx.ed.rec);
    T.ctx.setField_('author', '架空\n\n担当');
    const b = T.ctx.saveBody_(T.ctx.ed, T.ctx.cur);
    t('(5) 手で入れた値も保存の前に同じ扱い', b.rec.author === '架空 担当');
    t('(5) 紙も同じ値', /<td>架空の 会議室<\/td>/.test(T.ctx.printHtml_(T.ctx.cur, T.ctx.ed.rec, 'draft')));
    t('(5) 複数行の欄（結論など）は改行のまま', T.ctx.sendRec_({ conclusion: 'a\nb' }).conclusion === 'a\nb');
  }
  {
    /* (6) 貼っただけで未保存 */
    const T = await opened({ answer: false });
    await T.ctx.openNew_('');
    t('(6) 開いただけは未保存ではない', T.ctx.isDirty_(T.ctx.ed) === false);
    T.ctx.onEdInput_({ target: { id: 'cm-paste', value: '◆結論：貼っただけ', getAttribute() { return null; }, style: {} } });
    t('(6) 貼り付け欄に文字を貼った時点で未保存の入力に数える', T.ctx.isDirty_(T.ctx.ed) === true);
    const e0 = T.ctx.ed;
    await T.ctx.openNew_('');
    t('(6) 別の記録へ移る時に確かめる（やめたら移らない）', T.ctx.ed === e0 && T.cnt.ask.some((x) => /保存していない入力/.test(x.title)));
    const R = row({ meetingId: 'M-P', status: 'draft', rev: 2 });
    const U = await opened({ gas: { list: () => ({ ok: true, rows: [R] }) } });
    await U.ctx.openMeeting_('M-P', false);
    U.ctx.ed.paste = '◆結論：貼っただけ';
    t('(6) 下書きを直している時も、貼っただけで未保存', U.ctx.isDirty_(U.ctx.ed) === true);
  }
  {
    /* (7) 記録した人：by を送らず、ログイン中だけ証明（accessToken）を添える */
    const T = await opened();
    await T.ctx.openNew_('');
    T.ctx.ed.rec = fullRec(T.ctx); T.ctx.ed.touched = true;
    await T.ctx.cmSave_(); await settle();
    const b = T.sent()[0] && T.sent()[0].body;
    t('(7) ログインの印が無い時は su-auth を読み込まない', T.cnt.created.length === 0 && T.ctx.cmHasLogin_() === false);
    t('(7) ログインの印が無い時は accessToken を付けず、by も送らない', b && !('accessToken' in b) && !('by' in b), b && Object.keys(b));
    const U = await opened();
    U.ls.m.set('sb-kakuu-auth-token', '{}');
    U.ctx.window.SUAuth = { client() { return { auth: { getSession() { return Promise.resolve({ data: { session: { access_token: 'aaa.bbb.ccc' } } }); } } }; } };
    await U.ctx.openNew_('');
    U.ctx.ed.rec = fullRec(U.ctx); U.ctx.ed.touched = true;
    await U.ctx.cmSave_(); await settle();
    const ub = U.sent()[0] && U.sent()[0].body;
    t('(7) ログイン中は証明を accessToken として添える（by は送らない）', ub && ub.accessToken === 'aaa.bbb.ccc' && !('by' in ub));
    const R = row({ meetingId: 'M-AT', status: 'final', rev: 3 });
    const V = await opened({ gas: { list: () => ({ ok: true, rows: [R] }) } });
    V.ls.m.set('sb-kakuu-auth-token', '{}');
    V.ctx.window.SUAuth = { client() { return { auth: { getSession() { return Promise.resolve({ data: { session: { access_token: 'ddd.eee.fff' } } }); } } }; } };
    await V.ctx.openMeeting_('M-AT', false);
    await V.ctx.cmToDraft_(); await settle();
    await V.ctx.cmRemove_(); await settle();
    t('(7) setStatus・remove にも添える', V.sent().length === 2 && V.sent().every((c) => c.body.accessToken === 'ddd.eee.fff' && !('by' in c.body)), V.sent().map((c) => c.body.op));
    const W = await opened();
    W.ls.m.set('sb-kakuu-auth-token', '{}');
    W.ctx.window.SUAuth = { client() { return { auth: { getSession() { return new Promise(() => {}); } } }; } };
    await W.ctx.openNew_('');
    W.ctx.ed.rec = fullRec(W.ctx); W.ctx.ed.touched = true;
    await W.ctx.cmSave_(); await settle();
    t('(7) 証明が3秒で返らなければ添えずに送る', W.sent().length === 1 && !('accessToken' in W.sent()[0].body));
    t('(7) 証明は端末に控えない', [T, U, V, W].every((x) => x.writes.every((w) => w[2] === 'cm_open_meeting')));
    t('(7) 画面に by・CM_BY が残っていない', !/CM_BY|\bby:/.test(S));
    t('(7) 3秒で諦める・ログインの印の形は入居者マスタと同じ', /setTimeout\(function\(\)\{ ok\(''\); \}, 3000\)/.test(cutF(S, 'cmAccessToken_')) && /\^sb-\[a-z0-9\]\+-auth-token\$/.test(cutF(S, 'cmHasLogin_')));
  }
  {
    /* (8) 紙の出席者の表：空の枠も人が入った枠と同じ高さ（空白1文字を置く） */
    const T = await opened();
    const r = T.ctx.recOf_(row({ attendees: [{ role: '介護支援専門員', name: '架空 担当' }, { role: '家族', name: '架空 家族' }] }));
    const h = T.ctx.printHtml_(T.ctx.cur, r, 'final');
    const cells = h.match(/<td class="pv-ac">[^<]*<\/td>/g) || [];
    t('(8) 出席者の枠は3段×3組（18枠）', cells.length === 18, cells.length);
    t('(8) 空の枠（14枠）には空白1文字を置き、段が潰れない', cells.filter((c) => c === '<td class="pv-ac">&nbsp;</td>').length === 14);
  }

  group('ほか: 下書きへ戻す・取り消す（理由・確かめ）');
  {
    const R = row({ meetingId: 'M-FIN', status: 'final', rev: 7 });
    const T = await opened({ gas: { list: () => ({ ok: true, rows: [R] }) } });
    await T.ctx.openMeeting_('M-FIN', false);
    t('確定した記録は表示だけ（下書きへ戻す・取り消す・印刷）', T.ctx.ed.view === true && /data-act="draft"/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)) && !/data-act="save"/.test(T.ctx.editorHtml_(T.ctx.ed, T.ctx.cur)));
    await T.ctx.cmToDraft_(); await settle();
    const st = T.meetCalls().find((c) => c.body.op === 'setStatus');
    t('下書きへ戻すは理由を聞いて送る（status:draft・editNote）', st && st.body.status === 'draft' && st.body.editNote === '架空の理由' && st.body.baseRev === 7, st && st.body);
    const U = await opened({ gas: { list: () => ({ ok: true, rows: [R] }) }, text: null });
    await U.ctx.openMeeting_('M-FIN', false);
    await U.ctx.cmToDraft_(); await U.ctx.cmRemove_(); await settle();
    t('理由を書かずにやめたら送らない', U.meetCalls().filter((c) => c.body.op !== 'list').length === 0);
    let gone = false;
    const V = await opened({ gas: { list: () => ({ ok: true, rows: gone ? [] : [R] }), remove: (b) => { gone = true; return { ok: true, record: row({ meetingId: b.meetingId, deleted: true, rev: 8 }) }; } } });
    await V.ctx.openMeeting_('M-FIN', false);
    await V.ctx.cmRemove_(); await settle();
    const rm = V.meetCalls().find((c) => c.body.op === 'remove');
    t('確定済みの取り消しは理由つき', rm && rm.body.editNote === '架空の理由' && rm.body.meetingId === 'M-FIN');
    t('取り消したら一覧と右側から消え、番号も端末から消す', V.ctx.ed === null && !V.ctx.meetings.some((m) => m.meetingId === 'M-FIN') && V.ss.getItem('cm_open_meeting') === null);
    const D = row({ meetingId: 'M-DR', status: 'draft', rev: 2 });
    const W = await opened({ gas: { list: () => ({ ok: true, rows: [D] }) } });
    await W.ctx.openMeeting_('M-DR', false);
    await W.ctx.cmRemove_(); await settle();
    const rm2 = W.meetCalls().find((c) => c.body.op === 'remove');
    t('下書きの取り消しは確かめだけ（理由は送らない）', rm2 && !('editNote' in rm2.body) && W.cnt.ask.some((a) => /取り消しますか/.test(a.title)));
  }

  group('12. innerHTML の全数点検（17か所・2026-10-25）');
  {
    const EVIL = '<img src=x onerror=alert(1)>', BREAK = '"><script>alert(1)</script>', ATTR = '" onmouseover="alert(1)';
    /* 実行される形が入っていないこと。esc を通った値は &lt;img … の文字になり、ここには当たらない
       （欄名の空白を詰めた「<imgsrc=…」も拾えるよう \b を付けない） */
    const unsafe = (h) => /<img/i.test(h) || /<script/i.test(h) || /["']\s*on[a-z]+\s*=/i.test(h) || /<\/textarea>\s*</i.test(h.replace(/<\/textarea>(?=<(?:span|\/div|div|button)\b)/g, ''));
    const kept = (h) => h.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0;
    const kept2 = (h) => h.indexOf('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;') >= 0;
    const okH = (h) => !unsafe(h) && kept(h);

    /* 全数: 代入の数と、固定文だけの代入が本当に固定文か */
    const assigns = S.split('\n').filter((l) => /\.innerHTML\s*=(?!=)/.test(l)).reduce((n, l) => n + (l.match(/\.innerHTML\s*=(?!=)/g) || []).length, 0);
    t('innerHTML への代入は17か所（増えたら点検表に足す）', assigns === 17, assigns);
    t('insertAdjacentHTML・outerHTML・document.write は使わない', !/insertAdjacentHTML|outerHTML|document\.write/.test(S));
    const fixed = [...S.matchAll(/\.innerHTML\s*=\s*('(?:[^'\\]|\\.)*')\s*;/g)].map((m) => m[1]);
    t('固定文だけの代入は8か所で、文字列に値をつないでいない', fixed.length === 8 && fixed.every((x) => x.indexOf("'+") < 0), fixed.length);

    /* 名簿・入居者・記録・サーバーの文のすべてに入れる */
    const ROS = { v: 1, residents: [{ masterId: '901', name: EVIL, room: BREAK, active: true }, { masterId: '902', name: BREAK, room: ATTR, active: true }] };
    const bad = row({ meetingId: 'M20260401100000' + '7001', status: 'final', heldDate: '2026-04-01', kind: EVIL, count: BREAK, place: EVIL, timeText: BREAK, author: EVIL,
      sourceName: EVIL, items: EVIL, content: BREAK, conclusion: EVIL, issues: BREAK, nextText: EVIL, createdDate: EVIL,
      attendees: Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? EVIL : BREAK, name: i % 2 ? BREAK : EVIL })) });
    const badDraft = Object.assign({}, bad, { meetingId: 'M20260501100000' + '7002', status: 'draft', heldDate: '2026-05-01' });
    const RESX = { id: 901, name: EVIL, room: BREAK, careLevel: ATTR, careCertStart: '2026-04-01', careCertEnd: '2027-03-31' };
    const T = await opened({ roster: ROS, gas: { getResident: () => ({ record: JSON.parse(JSON.stringify(RESX)) }), list: () => ({ ok: true, rows: [bad, badDraft] }) } });

    /* 5 paintWho_ */
    t('5 開いている方（paintWho_→whoHtml_）：氏名・居室・介護度', okH(T.el('cm-who').innerHTML) && kept2(T.el('cm-who').innerHTML), T.el('cm-who').innerHTML);
    /* 9 paintList_ */
    t('9 記録の一覧（paintList_→listHtml_）：開催の理由・回数・結論', okH(T.el('cm-list').innerHTML) && kept2(T.el('cm-list').innerHTML), T.el('cm-list').innerHTML);
    /* 9 会議の番号（data-mid の属性）。サーバーが返した番号は一覧では形を絞らない＝守りは esc だけ（10/25 反証レビュー指摘） */
    {
      const midA = Object.assign({}, badDraft, { meetingId: ATTR, heldDate: '2026-06-01' }), midB = Object.assign({}, badDraft, { meetingId: BREAK, heldDate: '2026-06-02' });
      const TM = await opened({ roster: ROS, gas: { getResident: () => ({ record: JSON.parse(JSON.stringify(RESX)) }), list: () => ({ ok: true, rows: [bad, midA, midB] }) } });
      const lh = TM.el('cm-list').innerHTML;
      t('9 記録の一覧：会議の番号（data-mid の属性）に壊れた値が来ても属性を抜けない', okH(lh) && lh.indexOf('data-mid="&quot; onmouseover=&quot;alert(1)"') >= 0, lh.slice(0, 600));
    }
    /* 8 paintAlerts_ と alertsHtml_（知らせの文・開催の理由は属性にも入る） */
    t('8 期限の知らせ（paintAlerts_）', !unsafe(T.el('cm-alerts').innerHTML), T.el('cm-alerts').innerHTML);
    const al = T.ctx.alertsHtml_([{ kind: 'x', level: ATTR, text: EVIL, reason: ATTR }, { kind: 'y', level: 'high', text: BREAK, reason: BREAK }]);
    t('8 期限の知らせ（alertsHtml_）：文・開催の理由（data-reason・aria-label の属性）・段階', okH(al) && kept2(al), al);
    /* 12 paintEditor_（下書きを開く＝入力欄の value・textarea） */
    await T.ctx.openMeeting_(badDraft.meetingId, true); T.ctx.paintEditor_();
    const edH = T.el('cm-detail').innerHTML;
    t('12 下書きの入力欄（paintEditor_→editorHtml_）：value 属性・textarea の中身・開催の理由の選択肢・出席者', okH(edH) && kept2(edH) && edH.indexOf('value="&quot;&gt;&lt;script&gt;') >= 0, edH.slice(0, 400));
    /* 11 paintPrev_（下書きより前の確定＝bad） */
    T.ctx.paintPrev_();
    t('11 前回の記録（paintPrev_→prevHtml_）：開催の理由・結論・残された課題・検討した項目', okH(T.el('cm-prev').innerHTML) && kept2(T.el('cm-prev').innerHTML), T.el('cm-prev').innerHTML);
    /* 13 paintNameBand_（議事録の利用者名が開いている方と違う＝文に両方の名前が入る） */
    T.ctx.ed.rec.sourceName = BREAK; T.ctx.paintNameBand_();
    t('13 利用者名の帯（paintNameBand_→nameStateHtml_）：議事録の利用者名・開いている方の氏名', okH(T.el('cm-nb-st').innerHTML) && kept2(T.el('cm-nb-st').innerHTML), T.el('cm-nb-st').innerHTML);
    T.ctx.ed.rec.sourceName = EVIL; T.ctx.paintNameBand_();
    t('13 利用者名の帯（一致した時の文）', okH(T.el('cm-nb-st').innerHTML), T.el('cm-nb-st').innerHTML);
    /* 12 ほかの端末との見比べ・知らせの文（サーバーの文）・ほかの方の閉じた理由 */
    T.ctx.ed.conflict = bad; T.ctx.ed.msg = T.ctx.codeMsg_('error', { error: EVIL + BREAK }); T.ctx.ed.msgKind = ATTR; T.ctx.paintEditor_();
    t('12 ほかの端末との見比べ・サーバーの断りの文・知らせの種類', okH(T.el('cm-detail').innerHTML) && kept2(T.el('cm-detail').innerHTML), T.el('cm-detail').innerHTML.slice(0, 400));
    T.ctx.ed.conflict = null; T.ctx.ed.msg = '';
    /* 12 確定した記録の表示 */
    await T.ctx.openMeeting_(bad.meetingId, true); T.ctx.paintEditor_();
    t('12 確定した記録の表示（viewHtml_）：全部の欄と出席者', okH(T.el('cm-detail').innerHTML) && kept2(T.el('cm-detail').innerHTML) && T.ctx.ed.view === true, T.el('cm-detail').innerHTML.slice(0, 400));
    /* 16・17 印刷の紙面（SUPrint の before / after を偽物で受けて実行する） */
    let pdef = null;
    T.ctx.SUPrint = { define(n, d) { pdef = d; } }; T.ctx.window.SUPrint = T.ctx.SUPrint;
    T.ctx.definePrint_();
    pdef.before();
    const pv = T.el('cm-print').innerHTML;
    t('16 印刷の紙面（definePrint_ の before→printHtml_）：利用者名・全欄・出席者の表と続き', okH(pv) && kept2(pv) && /class="pv-more"/.test(pv), pv.slice(0, 400));
    pdef.after();
    t('17 印刷の後は紙面を空にする', T.el('cm-print').innerHTML === '');
    /* 12 NotebookLM の議事録を貼って振り分ける（cmParse_ → applyParse_ → paintEditor_） */
    await T.ctx.openNew_('');
    T.el('cm-paste').value = [EVIL + '最初の印より前', '◆利用者名：' + EVIL, '◆開催の理由：' + BREAK, '◆作成担当者：' + EVIL, '◆作成年月日：' + EVIL,
      '◆開催日：2026/04/01', '◆開催場所：' + BREAK, '◆開催時間：' + EVIL, '◆開催回数：' + BREAK, '◆出席者：', EVIL + '／' + BREAK, BREAK + '／' + EVIL,
      '◆検討した項目：' + EVIL, '◆' + EVIL + '：知らない印', '◆検討内容：' + BREAK, '◆結論：' + EVIL, '◆残された課題：' + BREAK, '◆次回の開催時期：' + EVIL].join('\n');
    const parsed = await T.ctx.cmParse_();
    const pz = T.el('cm-detail').innerHTML;
    t('12 振り分けた後の入力欄・振り分けの知らせ（知らない印・前書き・読めない日付）・貼り付け欄', parsed === true && okH(pz) && kept2(pz) &&
      T.ctx.ed.rec.items.indexOf(EVIL) === 0 && T.ctx.ed.parse.unknown.length === 1 && !!T.ctx.ed.parse.preamble, pz.slice(0, 600));
    /* 14・15 確かめの窓（題・行・ボタンに記録の値が入っても） */
    const dlg = T.el('cm-dlg'); dlg.showModal = () => {}; dlg.removeEventListener = () => {};
    const realDlg = vm.runInContext('openDlg_', T.ctx);
    realDlg({ title: EVIL, lines: [BREAK, EVIL], ok: ATTR, danger: true, input: true });
    t('14 確かめの窓（openDlg_）：題・各行・ボタンの文字', okH(dlg.innerHTML) && kept2(dlg.innerHTML), dlg.innerHTML);
    t('15 確かめの窓を閉じた時は空の固定文（\'\'）', /d\.innerHTML='';/.test(cutF(S, 'openDlg_')));
    /* 4 paintPicker_（名簿の氏名・居室・最終開催日・下書きの件数・読めない理由） */
    const P = load({ roster: ROS, handler: gas({ summary: () => ({ ok: true, residents: { 901: { lastHeld: EVIL, drafts: BREAK } } }) }) });
    await P.ctx.showPicker_(); await settle();
    t('4 入居者を選ぶ一覧（paintPicker_→pickerHtml_）：氏名・居室・最終開催日・下書きの件数', okH(P.el('cm-pick').innerHTML) && kept2(P.el('cm-pick').innerHTML), P.el('cm-pick').innerHTML);
    const Q = load({ roster: ROS, handler: gas({ summary: () => ({ ok: false, code: 'bad_input', error: EVIL }) }) });
    await Q.ctx.showPicker_(); await settle();
    t('4 入居者を選ぶ一覧：読めない理由（サーバーの文）', okH(Q.el('cm-pick').innerHTML), Q.el('cm-pick').innerHTML);
    /* 5・9 読めない理由（サーバーの文・通信の失敗の文） */
    const R = load({ roster: ROS, handler: (b) => (b.action === 'getResident' ? Promise.reject(new Error(EVIL)) : { ok: false, code: 'bad_input', error: BREAK }) });
    await R.ctx.openPerson_('901'); await settle();
    t('5 開いている方を読めない理由', okH(R.el('cm-who').innerHTML), R.el('cm-who').innerHTML);
    const R2 = load({ roster: ROS, handler: gas({ list: () => ({ ok: false, code: 'bad_input', error: EVIL }) }) });
    await R2.ctx.openPerson_('901'); await settle();
    t('9 記録の一覧を読めない理由', okH(R2.el('cm-list').innerHTML), R2.el('cm-list').innerHTML);
    /* 12 ほかの端末で取り消されて閉じた理由（edNotice） */
    R2.ctx.ed = null; R2.ctx.edNotice = EVIL; R2.ctx.paintEditor_();
    t('12 閉じた理由の知らせ（edNotice）', okH(R2.el('cm-detail').innerHTML), R2.el('cm-detail').innerHTML);
    /* 1・2・3・6・7・10 固定文 */
    R2.ctx.showGate_('nocfg');
    t('3 接続設定の案内は固定文', R2.el('cm-gate').innerHTML.indexOf('接続設定を開く') >= 0 && !unsafe(R2.el('cm-gate').innerHTML));
    const F = load({ role: 'field', roster: ROS, handler: gas() }); F.ctx.boot();
    t('1・2 現場端末は箱を空にして固定の案内だけ', F.el('cm-who').innerHTML === '' && F.el('cm-pick').innerHTML === '' && /事務所PCだけで使えます/.test(F.el('cm-gate').innerHTML));
  }

  group('ほか: 紙面（仕様 §7）');
  {
    const T = await opened();
    const r = T.ctx.recOf_(row({ kind: '区分変更', attendees: Array.from({ length: 11 }, (_, i) => ({ role: '職種' + i, name: '架空' + i })) }));
    const d = T.ctx.printHtml_(T.ctx.cur, r, 'draft'), f = T.ctx.printHtml_(T.ctx.cur, r, 'final');
    t('表題「サービス担当者会議の要点」・下書きは表題の横に「下書き」', /サービス担当者会議の要点<\/span><span class="pv-draft">下書き<\/span>/.test(d) && !/pv-draft/.test(f));
    t('開催の理由は紙に出さない', d.indexOf('区分変更') < 0 && d.indexOf('開催の理由') < 0);
    t('出席者の表は9名、10名目からは表の下に続けて書く', /架空8<\/td>/.test(d) && /class="pv-more">（出席者の続き）職種9／架空9、職種10／架空10</.test(d));
    t('見出しの欄（利用者名・作成担当者・作成年月日・開催日・開催場所・開催時間・開催回数・検討した項目・検討内容・結論・残された課題・次回の開催時期）',
      ['利用者名', '作成担当者', '作成年月日', '開催日', '開催場所', '開催時間', '開催回数', '会議出席者', '検討した項目', '検討内容', '結論', '残された課題', '次回の開催時期'].every((w) => d.indexOf('<th>' + w + '</th>') >= 0 || d.indexOf('>' + w + '</th>') >= 0));
    t('SUPrint.define は A4 横・余白8・root #cm-print・--cm-fs で高さに合わせる（7〜16px・0.25刻み・当て方は cmFitApply_・2026-10-25 A4 横に目一杯）',
      /SUPrint\.define\('meeting',\{label:'担当者会議の要点',paper:'A4 landscape',margin:8,root:'#cm-print',\n[^\n]*\n    fit:\{mode:'height',cssVar:'--cm-fs',base:12,min:7,max:16,step:0\.25,slack:\{h:24\},apply:cmFitApply_\}/.test(S) && /var CM_STRETCH_SAFE=24;/.test(S));
    t('印刷の前に SUPrint.estimate で枚数を見て、2枚以上なら「1枚に収まりません（約Nページ）」', /SUPrint\.estimate\('meeting'\)/.test(cutF(S, 'cmPrint_')) && /'1枚に収まりません（約'\+est\.pages\+'ページ）'/.test(cutF(S, 'cmPrint_')));
    const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
    t('zoom・transform:scale を使わず、画面だけの部品は @media print で消す', !/zoom\s*:|scale\(/.test(css) && /@media print\{[\s\S]*\.hdr,#cm-main,#toast,\.dlg\{display:none !important\}/.test(css));
    t('印刷の後は紙面を空にする（氏名を DOM に残さない）', /after:function\(\)\{ var p=\$\('cm-print'\); if\(p\) p\.innerHTML=''; \}/.test(S));
  }


  group('13. 出席者の✔︎・印刷を A4 横いっぱいに・過去の記録の取り込み（2026-10-25 代表者の決定）');
  {
    /* 13-1. 候補の並べ方（計算の部品） */
    const L = [
      row({ meetingId: 'M1', heldDate: '2026-03-01', attendees: [{ role: '本人', name: '架空 一郎' }, { role: '施設', name: '架空 看護' }] }),
      row({ meetingId: 'M2', heldDate: '2026-09-01', attendees: [{ role: '本人', name: '架空　一郎' }, { role: '長女', name: '架空 花子' }, { role: '', name: '' }] }),
      row({ meetingId: 'M3', heldDate: '2026-10-01', deleted: true, attendees: [{ role: '取り消し', name: '架空 消し' }] }),
      row({ meetingId: 'M4', heldDate: '2026-10-10', attendees: [{ role: '開いている記録', name: '架空 今' }] })
    ];
    const C = CALC.attendeeCandidates(L, 'M4', 30);
    t('候補は新しい会議の出席者から並べ、所属と氏名の組で重ねない（全角の空白も同じ人）', JSON.stringify(C.map((x) => x.role + '／' + x.name)) === JSON.stringify(['本人／架空　一郎', '長女／架空 花子', '施設／架空 看護']), C);
    t('取り消し済みの記録・開いている記録の出席者・空の行は候補にしない', !C.some((x) => /消し|今/.test(x.name)) && !C.some((x) => !x.role && !x.name));
    t('候補は max 名まで', CALC.attendeeCandidates(L, '', 2).length === 2);
    t('同じ組の見分けは互換の文字と空白をそろえる', CALC.attKey({ role: '施設', name: '架空　看護' }) === CALC.attKey({ role: ' 施設', name: '架空 看護 ' }));
  }
  {
    /* 13-2. 画面: 新しい記録で✔︎を付ける・外す */
    const rows = [row({ meetingId: 'M20260901100000' + '1111', heldDate: '2026-09-01', attendees: [{ role: '本人', name: '架空 一郎' }, { role: '長女', name: '架空 <b>花子</b>' }] })];
    const T = await opened({ gas: { list: () => ({ ok: true, rows }) } });
    await T.ctx.openNew_(''); await settle();
    const h = T.el('cm-detail').innerHTML;
    const K = (i) => CALC.attKey(T.ctx.attCands_(T.ctx.ed)[i]);
    t('「前回までの出席者から選ぶ」に、前回の出席者が✔︎の候補で出る（印は並びの番号ではなく組の印）', /前回までの出席者から選ぶ/.test(h) && (h.match(/data-apk="/g) || []).length === 2 && h.indexOf('data-apk="本人|架空一郎"') >= 0, h.match(/data-apk="[^"]*"/g));
    t('候補の文字は esc を通る', h.indexOf('<b>花子</b>') < 0 && h.indexOf('&lt;b&gt;花子&lt;/b&gt;') >= 0);
    T.ctx.attAdd_();   // 「＋ 出席者を足す」で空の行が2つある状態
    T.ctx.attPick_(K(1), true);
    t('✔︎を付けると、空の行があればそこへ入る（行が増えすぎない）', T.ctx.ed.rec.attendees.length === 2 && T.ctx.ed.rec.attendees[0].role === '長女' && T.ctx.ed.rec.attendees[0].name === '架空 <b>花子</b>' && T.ctx.ed.touched === true, T.ctx.ed.rec.attendees);
    T.ctx.attPick_(K(0), true);
    t('続けて付けると、残りの空の行に入る', T.ctx.ed.rec.attendees.map((a) => a.role).join(',') === '長女,本人', T.ctx.ed.rec.attendees);
    const h2 = T.el('cm-detail').innerHTML;
    t('入っている人の✔︎は付いた形で出る（色だけでなく「✔︎」の字でも）', /data-apk="本人\|架空一郎" checked/.test(h2) && /class="ap on"><input type="checkbox" data-apk="長女\|架空&lt;b&gt;花子&lt;\/b&gt;" checked><span>✔︎ /.test(h2), h2.match(/<label class="ap[^]*?<\/label>/g));
    T.ctx.attPick_(K(1), false);
    t('✔︎を外すと、その人の行が消える', !T.ctx.ed.rec.attendees.some((a) => a.role === '長女'), T.ctx.ed.rec.attendees);
    T.ctx.attPick_(K(0), true);
    t('もう入っている人を付け直しても2行にしない', T.ctx.ed.rec.attendees.filter((a) => a.role === '本人').length === 1);
    T.ctx.ed.rec.attendees = Array.from({ length: 20 }, (_, i) => ({ role: '職種' + i, name: '架空' + i }));
    T.ctx.attPick_(K(1), true);
    t('20名いる時は足さずに知らせる', T.ctx.ed.rec.attendees.length === 20 && T.cnt.toast.some((m) => /20 名まで/.test(m)));
    T.ctx.listState = 'error';
    t('一覧を読めていない時は候補を出さない', T.ctx.attCands_(T.ctx.ed).length === 0);
    T.ctx.listState = 'ok';
    T.ctx.ed.rec.attendees = [{ role: '本人', name: '架空 一郎' }];
    T.ctx.ed.view = true; const before = JSON.stringify(T.ctx.ed.rec.attendees); T.ctx.attPick_(K(0), false);
    t('確定した記録の表示中は✔︎で変えない', JSON.stringify(T.ctx.ed.rec.attendees) === before);
    t('受け口: 変更の時に data-apk（組の印）を見て attPick_ へ', /var ak=t\.getAttribute\('data-apk'\); if\(ak!=null\)\{ attPick_\(String\(ak\),t\.checked===true\); return; \}/.test(cutF(S, 'onEdChange_')));
    T.ctx.ed.view = false; T.ctx.ed.rec.attendees = [];
    T.ctx.attPick_('ほかの人|架空', true);
    t('★今の候補に無い印（並びが変わった後の古い画面）では、だれも入れない', T.ctx.ed.rec.attendees.length === 0);
    t('★一覧を読み直した後は、編集の欄（✔︎の候補）も描き直す', /paintAlerts_\(\); paintList_\(\); paintPrev_\(\);\n    if\(ed&&!ed\.view&&!ed\.busy\) paintEditor_\(\);/.test(cutF(S, 'loadList_')));
    const rows2 = [row({ meetingId: 'M20260902100000' + '2222', heldDate: '2026-09-02', attendees: [{ role: '主治医', name: '' }] })];
    const T2 = await opened({ gas: { list: () => ({ ok: true, rows: rows2 }) } });
    await T2.ctx.openNew_(''); await settle();
    t('氏名の無い候補は「主治医」だけで出す（末尾に「／」を付けない）', /<span>主治医<\/span>/.test(T2.el('cm-detail').innerHTML), T2.el('cm-detail').innerHTML.match(/<label class="ap[^]*?<\/label>/g));
    const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
    t('✔︎の候補は押せる所が 44px 以上', /\.ap\{display:inline-flex; align-items:center; gap:8px; min-height:44px;/.test(css));
  }
  {
    /* 13-3. 印刷: 文字を当て、確定の時だけ余った高さを本文の4欄へ配る */
    const T = load();
    const mkRoot = (base, hs, k) => {
      const vars = {};
      const cells = hs.map((h) => ({ h, style: { height: '' }, getBoundingClientRect() { return { height: this.h }; } }));
      const cur = (c) => (c.style.height ? parseFloat(c.style.height) : c.h);
      return { cells, vars, style: { setProperty(n, v) { vars[n] = v; }, removeProperty(n) { delete vars[n]; } },
        querySelectorAll(sel) { return sel === '.pv-body td' ? cells : []; },
        get scrollHeight() { return base + cells.reduce((s, c) => s + cur(c), 0) * (k || 1); } };
    };
    const st = { metrics: { hPx: 733 } };
    let R = mkRoot(200, [40, 120, 60, 30]);
    T.ctx.cmFitApply_(12, R, st, false);
    t('探している間は文字の大きさだけを当て、高さは配らない', R.vars['--cm-fs'] === '12px' && R.cells.every((c) => c.style.height === ''));
    T.ctx.cmFitApply_(14, R, st, true);
    const sum = R.cells.reduce((s, c) => s + parseFloat(c.style.height || c.h), 0);
    t('確定の時は、紙の高さの残り（余裕24px）を本文の4欄へ配り、紙の高さを超えない', R.vars['--cm-fs'] === '14px' && Math.abs(R.scrollHeight - (733 - 24)) <= 1 && R.scrollHeight <= 733 - 24, [R.scrollHeight, sum]);
    const ratio = parseFloat(R.cells[1].style.height) / parseFloat(R.cells[0].style.height);
    t('配る高さは各欄の今の高さの比（検討内容が多ければ多く伸ばす）', Math.abs(ratio - 3) < 0.01, ratio);
    T.ctx.cmFitApply_(13, R, st, false);
    t('次に探す時は、配った高さを先に外してから測る', R.cells.every((c) => c.style.height === ''));
    T.ctx.cmFitApply_(null, R, st, false);
    t('後始末（px=null）は文字の大きさも外す', !('--cm-fs' in R.vars) && R.cells.every((c) => c.style.height === ''));
    R = mkRoot(700, [10, 10, 10, 10]);
    T.ctx.cmFitApply_(12, R, st, true);
    t('余りが無い（4px 以下）時は配らない', R.cells.every((c) => c.style.height === ''));
    R = mkRoot(-1500, [100, 100, 100, 100], 5);
    T.ctx.cmFitApply_(12, R, st, true);
    t('配ると紙を超えてしまう時は、減らしても超えるなら配らない（2枚目へ落とさない）', R.scrollHeight <= 733 - 24 || R.cells.every((c) => c.style.height === ''), R.scrollHeight);
    t('本文の表には pv-body の印がある（配る相手）', /<table class="pv-t pv-body">/.test(cutF(S, 'printHtml_')));
  }
  {
    /* 13-4. 過去の記録の取り込み（管理者だけ） */
    const SU = (role) => ({ STATUS: { OK: 'ok' }, check: () => Promise.resolve({ status: 'ok', role }), client: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'at-kakuu' } } }) } }) });
    const items = [
      { gid: '11', tab: 'R8.1.28架空', residentId: '901', residentName: '架空 一郎', sourceName: '架空　一郎', heldDate: '2026-01-28', attendees: 3, missing: [], status: 'new' },
      { gid: '12', tab: 'R8.2.3<b>架空</b>', residentId: '', residentName: '', sourceName: '架空 太郎', heldDate: '2026-02-03', attendees: 2, missing: ['結論'], status: 'unmatched' },
      { gid: '13', tab: 'R8.2.4架空', residentId: '902', residentName: '架空 二郎', sourceName: '架空 二郎', heldDate: '', attendees: 0, missing: ['開催日', '出席者'], status: 'new' },
      { gid: '14', tab: 'R8.1.5架空', residentId: '901', residentName: '架空 一郎', sourceName: '架空 一郎', heldDate: '2026-01-05', attendees: 4, missing: [], status: 'exists' }
    ];
    const scanRes = { ok: true, total: 4, counts: { new: 2, exists: 1, unmatched: 1, ambiguous: 0, toolong: 0 }, items };
    const mk = async (role, gasOpt, extra) => {
      const T = load(Object.assign({ roster: ROSTER, window: { SUAuth: SU(role) }, handler: gas(gasOpt) }, extra || {}));
      T.ls.m.set('sb-kakuu-auth-token', '{}');
      T.ctx.showPicker_(); await settle();
      await T.ctx.impGate_(); await settle();
      return T;
    };
    const N = await mk('office', {});
    t('管理者でない時は、取り込みの欄を出さない', N.ctx.impAdmin === false && !/過去の記録の取り込み/.test(N.el('cm-pick').innerHTML));
    const N2 = load({ roster: ROSTER, handler: gas({}) }); N2.ctx.showPicker_(); await settle(); await N2.ctx.impGate_();
    t('ログインの印が端末に無ければ、管理者か確かめに行かない（部品も読み込まない）', N2.ctx.impAdmin === false && N2.cnt.created.length === 0);
    const A = await mk('admin', { importScan: () => scanRes, importApply: (b) => ({ ok: true, written: b.gids.length, counts: scanRes.counts }) });
    t('管理者なら、選ぶ一覧の下に「過去の記録の取り込み」と「一覧を作る（書かない）」が出る', A.ctx.impAdmin === true && /過去の記録の取り込み（E表別紙・管理者だけ）/.test(A.el('cm-pick').innerHTML) && /data-act="imp-scan"/.test(A.el('cm-pick').innerHTML));
    await A.ctx.impScan_(); await settle();
    const sc = A.meetCalls().filter((c) => c.body.op === 'importScan');
    t('「一覧を作る」は importScan を1回だけ送り、ログインの証明を添える（gids は送らない）', sc.length === 1 && sc[0].body.accessToken === 'at-kakuu' && !('gids' in sc[0].body));
    t('送り終えたら、証明を本文から外す（控えない）', /\.then\(function\(r\)\{ delete body\.accessToken; return r; \}\)/.test(cutF(S, 'impPost_')));
    const ph = A.el('cm-pick').innerHTML;
    t('一覧の件数と、取り込める・照合できない・取り込み済みの表が出る（タブ名は esc を通る）', /タブ 4 件：取り込める 2 件／名簿と照合できない 1 件／名簿に同じ名前の方が2人以上 0 件／欄が長すぎる 0 件／開催日が先の日付 0 件／同じ方・同じ開催日の記録がある 0 件／取り込み済み 1 件/.test(ph) &&
      ph.indexOf('<b>架空</b>') < 0 && ph.indexOf('&lt;b&gt;架空&lt;/b&gt;') >= 0 && /（読めない）/.test(ph) && /開催日・出席者/.test(ph), ph.slice(0, 400));
    t('取り込める件数のボタンが出る', /data-act="imp-apply">取り込める 2 件を取り込む（確定）</.test(ph));
    t('取り込める行には✔︎が付いて出る（最初は全部）・ほかの組には付けない', (ph.match(/data-impg="/g) || []).length === 2 && /data-impg="11" checked/.test(ph) && /data-impg="13" checked/.test(ph) && ph.indexOf('data-impg="12"') < 0);
    A.ctx.onPickChange_({ target: { getAttribute: (k) => (k === 'data-impg' ? '13' : null), checked: false } });
    t('★✔︎を外すと、ボタンの件数が減る', /data-act="imp-apply">取り込める 1 件を取り込む（確定）</.test(A.el('cm-pick').innerHTML) && /data-impg="13" aria-label="[^"]*">外す/.test(A.el('cm-pick').innerHTML), (A.el('cm-pick').innerHTML.match(/data-act="imp-apply">[^<]*|data-impg="13"[^<]*/g)));
    A.ctx.onPickChange_({ target: { getAttribute: (k) => (k === 'data-impg' ? '13' : null), checked: true } });
    A.ctx.onPickChange_({ target: { getAttribute: (k) => (k === 'data-impg' ? '11' : null), checked: false } });
    await A.ctx.impApply_(); await settle();
    const ap = A.meetCalls().filter((c) => c.body.op === 'importApply');
    t('取り込む前に確かめの窓を出す（✔︎の付いた件数で）', A.cnt.ask.some((x) => x.title === '過去の記録を取り込みます' && /1 件を「確定」として/.test(x.lines[0])));
    t('★importApply は「取り込める」で✔︎の付いた gid だけを送る（外した行・照合できない・取り込み済みは送らない）', ap.length === 1 && JSON.stringify(ap[0].body.gids) === JSON.stringify(['13']) && ap[0].body.accessToken === 'at-kakuu', ap.map((c) => c.body.gids));
    t('取り込んだ件数を知らせ、一覧の最終開催日を読み直す', /1 件を取り込みました/.test(A.el('cm-pick').innerHTML) && A.ops().filter((o) => o === 'summary').length >= 2, A.ops());
    const G = await mk('admin', { importScan: () => scanRes, importApply: () => ({ ok: true, written: 1, changed: 1 }) });
    await G.ctx.impScan_(); await settle(); await G.ctx.impApply_(); await settle();
    t('取り込みの間に名簿が変わって入れなかった数を知らせる', /名簿が変わった 1 件は入れていません/.test(G.el('cm-pick').innerHTML));
    t('受け口: 選ぶ一覧の変更で data-impg を見る', /\$\('cm-pick'\)\.addEventListener\('change',onPickChange_\)/.test(cutF(S, 'bindEvents_')));
    t('取り込みの間も localStorage・sessionStorage に書かない（選ぶ一覧へ戻る時に「開いていた会議の番号」を消すだけ）', A.writes.every((w) => w[1] === 'remove' && w[2] === 'cm_open_meeting'), A.writes);
    const Q = await mk('admin', { importScan: () => scanRes }, { answer: false });
    await Q.ctx.impScan_(); await settle(); await Q.ctx.impApply_(); await settle();
    t('確かめの窓で「やめる」を押したら送らない', Q.ops().indexOf('importApply') < 0);
    const U = await mk('admin', { importScan: () => scanRes, importApply: () => NET });
    await U.ctx.impScan_(); await settle(); await U.ctx.impApply_(); await settle();
    t('通信が切れたら「取り込めたか分かりません」と出し、やり直さない（一覧を作り直せば入った分が分かる）', /取り込めたか分かりません/.test(U.el('cm-pick').innerHTML) && U.ops().filter((o) => o === 'importApply').length === 1);
    const D = await mk('admin', { importScan: () => ({ ok: false, code: 'not_admin', error: 'x' }) });
    await D.ctx.impScan_(); await settle();
    t('GAS が管理者でないと断ったら、分かる言葉で出す', /管理者（Google＋2段階認証）でログインしている時だけ使えます/.test(D.el('cm-pick').innerHTML));
    const B = await mk('admin', { importScan: () => scanRes, importApply: () => new Promise(() => {}) });
    await B.ctx.impScan_(); await settle(); B.ctx.impApply_(); await settle();
    const ev = { prevented: false, preventDefault() { this.prevented = true; } };
    B.ctx.onBeforeUnload_(ev);
    t('取り込みの途中は、閉じる・読み込み直す前に止める', ev.prevented === true && B.ctx.impSt.phase === 'applying');
    t('取り込みの途中はボタンを押せない', !/data-act="imp-scan">/.test(B.el('cm-pick').innerHTML) || /data-act="imp-scan" disabled/.test(B.el('cm-pick').innerHTML));
    B.ctx.showFieldOnly_();
    t('現場用へ切り替わったら、取り込みの一覧（タブ名・氏名）も管理者の印も捨てる', B.ctx.impSt === null && B.ctx.impAdmin === false);
    t('受け口: 選ぶ一覧のクリックで imp-scan・imp-apply を見分ける', /act==='imp-scan'/.test(cutF(S, 'onPickClick_')) && /act==='imp-apply'/.test(cutF(S, 'onPickClick_')));
    t('選ぶ一覧を出すたびに、まだ確かめていなければ管理者か確かめる（入居者マスタから来て「ほかの方を選ぶ」で戻った時も）', /if\(!impAdmin\) impGate_\(\);/.test(cutF(S, 'showPicker_')) && !/impGate_/.test(cutF(S, 'boot')));
    t('「取り込める」の表も開いて出す（確定で書く中身を見てから押せる）', /\['new','取り込める（名簿の1名に一致・まだ入っていない）',true\]/.test(S));
    t('取り込みは GAS の上限（6分）より長く待つ', /meetingPost_\(body,380000\)/.test(cutF(S, 'impPost_')));
    t('分からない時は code unknown でも見分ける', /classify_\(r\.d\)==='unknown'/.test(cutF(S, 'impApply_')));
  }

  say('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('✗ 試験そのものが止まりました: ' + (e && e.stack || e)); process.exit(1); });
