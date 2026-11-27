/* 出勤・退勤の打刻（kintai-clock.js）── 名前が分かった打刻を送る前に端末に控える試験（2026-11-28 新設・保存の穴の直し）
   実行: node check/unit/kintai_clock_queue_test.js（環境変数 KC_JS で別の版を当てられる）
   守りたいこと:
     1. 名前が分かった打刻は、送る前に端末の控え（kintai_clock_queue）に書く（送っている間に読み込み直す・タブを閉じても消えない）
     2. 控えに入るのは 番号・出勤か退勤か・控えの番号・端末の時刻 だけ（名前は入れない）
     3. 記録できた（ok）・断られた（notfound など）時は控えから消す。通信が切れた・止め（busy）の時は控えに1件だけ残す（二重に控えない）
     4. 送っている間は裏の送り直し（flush）がその控えを送らない（「控えから」の印で先に送らない）。送り直す時は同じ控えの番号（client_id）
     5. 送っている間（sending）も「保存していない入力がある」に数える（門番の dirty）
   やり方: kintai-clock.js 全体を偽の画面（document・localStorage・SUAuth・SUAppGate）の vm で動かし、
          最後の boot() の前に中の関数を取り出す口を1つだけ足す（中身は1字も変えない）。計算の部品は本物の kintai-calc.js。
   ★番号・名前は架空（1234・架空 一郎）。出力に console.log 以外を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.KC_JS || path.join(ROOT, 'kintai-clock.js'), 'utf8');
const CALC = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 20); i++) await tick(); }

const TAIL = '\n  boot();\n})();';
if (SRC.lastIndexOf(TAIL) < 0) throw new Error('kintai-clock.js の終わりの形が見つかりません');
const HOOK = '\n  globalThis.__clk = { punch: punch, flush: flush, set: function (o) { who = o.who; view = o.view; busyPunch = false; }, view: function () { return view; } };';
const CODE = SRC.slice(0, SRC.lastIndexOf(TAIL)) + HOOK + SRC.slice(SRC.lastIndexOf(TAIL));

function fakeEl(id) {
  const attrs = {};
  const e = { id, innerHTML: '', textContent: '', className: '', hidden: false, disabled: false, value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
    querySelector() { return fakeEl('q'); }, querySelectorAll() { return []; }, focus() {}, addEventListener() {} };
  return e;
}
/* rpc の答えは手で決める（送っている最中を作るため、打刻の答えは pending のまま止めておける） */
function load() {
  const store = new Map(), els = {}, calls = [];
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  let gateOpt = null;
  const answers = {};   /* name → 関数（args）→ Promise */
  const client = { rpc(name, args) { calls.push({ name, args }); const f = answers[name]; return f ? f(args) : Promise.resolve({ data: { ok: true, staff: [], items: [] }, error: null }); } };
  const ctx = {
    Promise, JSON, Object, Array, String, Number, Math, Date, RegExp, Error, Uint8Array, isNaN, parseInt,
    setTimeout(fn, ms) { return 0; }, clearTimeout() {}, setInterval() { return 0; },
    crypto: require('crypto').webcrypto,
    localStorage: ls,
    navigator: { onLine: true },
    document: { getElementById: (id) => (els[id] = els[id] || fakeEl(id)), querySelector() { return null; }, addEventListener() {}, visibilityState: 'visible' },
    KintaiCalc: CALC,
    SUAppGate: { run(name, opt) { gateOpt = opt; return new Promise(() => {}); } },   /* 門番の後（bind・flush の定期）は動かさない */
    SUAuth: { client: () => client }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'kintai-clock.js' });
  const q = () => JSON.parse(store.get('kintai_clock_queue') || '[]');
  return { ctx, C: ctx.__clk, store, q, calls, answers, gate: () => gateOpt, els };
}
const WHO = { code: '1234', name: '架空 一郎', state: 'none', flow: 'code', today: false, onShift: false };
const deferred = () => { let ok, ng; const p = new Promise((a, b) => { ok = a; ng = b; }); return { p, ok, ng }; };
const asData = (v) => ({ data: v, error: null });

(async () => {
  console.log('\n— 1. 送る前に控える・届いたら消す —');
  {
    const L = load();
    const d = deferred();
    L.answers.kintai_clock_punch = () => d.p;
    L.C.set({ who: Object.assign({}, WHO), view: 'who' });
    L.C.punch('in', true);
    await settle();
    const q0 = L.q();
    t('送っている最中に端末の控えへ1件書いてある（読み込み直しても残る）', q0.length === 1 && q0[0].code === '1234' && q0[0].kind === 'in' && typeof q0[0].id === 'string' && typeof q0[0].at === 'number', q0);
    t('控えに入るのは code・kind・id・at だけ（名前を入れない）', q0.length === 1 && Object.keys(q0[0]).sort().join() === 'at,code,id,kind' && !JSON.stringify(q0).includes('架空'), q0);
    t('送っている間（sending）は門番の dirty が「保存していない入力がある」と答える', L.C.view() === 'sending' && L.gate().dirty() === true, L.C.view());
    const sent = L.calls.filter((c) => c.name === 'kintai_clock_punch');
    t('打刻は控えと同じ控えの番号（client_id）で送る', sent.length === 1 && sent[0].args.p_client_id === q0[0].id && sent[0].args.p_offline === false);
    /* 送っている最中に裏の送り直しが走っても、その控えは送らない */
    await L.C.flush(); await settle();
    t('送っている最中の控えは裏の送り直しが送らない（「控えから」の印で先に送らない）', L.calls.filter((c) => c.name === 'kintai_clock_punch').length === 1 && L.q().length === 1);
    d.ok(asData({ ok: true, at: new Date().toISOString(), name: '架空 一郎', kind: 'in' }));
    await settle();
    t('記録できたら控えから消す', L.q().length === 0, L.q());
    t('… 完了の画面に移る（dirty は送信中でなくなる）', L.C.view() === 'done' && L.gate().dirty() === false, L.C.view());
  }

  console.log('\n— 2. 通信が切れた・止め・断られた時 —');
  {
    const L = load();
    L.answers.kintai_clock_punch = () => Promise.reject(new Error('Failed to fetch'));
    L.C.set({ who: Object.assign({}, WHO), view: 'who' });
    L.C.punch('out', true);
    await settle();
    const q1 = L.q();
    t('通信が切れた時は控えに1件だけ残す（二重に控えない）', q1.length === 1 && q1[0].kind === 'out', q1);
    /* つながった後の送り直しは同じ控えの番号で送り、届いたら消す */
    L.answers.kintai_clock_punch = (a) => Promise.resolve(asData({ ok: true, dup: true, at: new Date().toISOString(), name: '架空 一郎', kind: a.p_kind }));
    await L.C.flush(); await settle();
    const re = L.calls.filter((c) => c.name === 'kintai_clock_punch');
    t('送り直しは同じ控えの番号（client_id）で送る（データベースが1件にまとめる）', re.length === 2 && re[1].args.p_client_id === q1[0].id && re[1].args.p_offline === true, re.map((c) => c.args.p_client_id));
    t('… 届いたら控えから消える', L.q().length === 0);
  }
  {
    const L = load();
    L.answers.kintai_clock_punch = () => Promise.resolve(asData({ ok: false, error: 'busy' }));
    L.C.set({ who: Object.assign({}, WHO), view: 'who' });
    L.C.punch('in', true);
    await settle();
    t('番号の止め（busy）の時も控えに1件だけ残す', L.q().length === 1, L.q());
  }
  {
    const L = load();
    L.answers.kintai_clock_punch = () => Promise.resolve(asData({ ok: false, error: 'notfound' }));
    L.C.set({ who: Object.assign({}, WHO), view: 'who' });
    L.C.punch('in', true);
    await settle();
    t('断られた（番号が見つからない）時は控えから消す（画面で知らせて押し直してもらう・裏で送り続けない）', L.q().length === 0, L.q());
  }
  {
    const L = load();
    L.answers.kintai_clock_punch = () => Promise.reject(Object.assign(new Error('権限がありません'), { code: '42501' }));
    L.C.set({ who: Object.assign({}, WHO), view: 'who' });
    L.C.punch('in', true);
    await settle();
    t('通信でない失敗（権限）の時も控えから消す', L.q().length === 0, L.q());
  }
  {
    /* 送っている最中に別の画面へ移った（世代が変わった）後に届いても、控えは消す */
    const L = load();
    const d = deferred();
    L.answers.kintai_clock_punch = () => d.p;
    L.C.set({ who: Object.assign({}, WHO), view: 'who' });
    L.C.punch('in', true);
    await settle();
    L.C.set({ who: null, view: 'home' });
    d.ok(asData({ ok: true, at: new Date().toISOString(), name: '架空 一郎', kind: 'in' }));
    await settle();
    t('画面が移った後に届いた ok でも控えから消す（同じ打刻を後で送り直さない）', L.q().length === 0, L.q());
  }

  console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験が途中で止まりました: ' + (e && e.stack || e)); process.exit(1); });
