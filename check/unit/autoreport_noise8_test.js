/* 「要情報」の自動報告8件（2026-10-16〜11-19・reports#3・#4・#6・#7・#9・#10・#11・#13）の原因のうち、画面の部品で直す3つの試験（2026-11-21 新設）
   実行: node check/unit/autoreport_noise8_test.js
   原因（本番の記録で確かめた）:
     #4・#6・#7 ワークスケジュール: 開いた・PC が目覚めた直後に券を新しくし、その券で最初に出したログインの確かめ（my_account）だけが
         401（PGRST303「JWT issued at future」・本文79バイト）で断られた（10/22・10/24・10/27・11/17 2回・11/19。0.2秒後の同じ問い合わせは 200）。
         ログインの確かめが「確かめられない」になり、勤務表を Google の写しへ戻して「NetworkError」と報告していた
     #11 個別機能訓練計画書: 548分開いたままの PC が目覚めた直後の「アプリの使える人」の確かめ直しが15秒で打ち切られた（Error('timeout')）
     #13 入居者マスタ: Google の写し返しが前の写し返し（18:03 に読み始め 18:07 に済んだ印）の鍵を30秒待って
         「refused: ほかの保存が終わるのを待っています。…」で断った
   守りたいこと:
     1. 本物の supabase-js-2.112.4.js と su-auth.js で: この断りは1秒待って1回だけ聞き直す（直る）・続けて断られたら2回目の答えをそのまま返す・
        期限切れの券（JWT expired）・ほかの 401・403・データベース以外（関数・ログイン）の 401 は聞き直さない
     2. 直す前の su-auth.js では、同じ断りでログインの確かめが「確かめられない」になる（再現）。直した後は「使える」になる
     3. アプリの使える人: 確かめ直しの打ち切り・読み込めない・通信の失敗（素のオブジェクト）だけを記録しない。
        画面のコードの例外（TypeError など）・断りは記録する。開いた時の確かめは今までどおり全部記録する
     4. 入居者マスタの写し返し: この文の断りだけを記録しない。ほかの断り・中身のない失敗は記録する */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });

const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SKEW = () => json(401, { code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' });
const EXPIRED = () => json(401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' });

/* 本物の supabase-js と su-auth.js をブラウザの代わりの箱で動かす。fetch は箱の中の値（試験が差し替える） */
function authBox(authSrc, onFetch) {
  const store = {};
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const at = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'u-test', aal: 'aal1', exp: 4102444800, email: 'test@example.com', role: 'authenticated' }) + '.sig';
  store['sb-jhbernqawjrzqwrmqrih-auth-token'] = JSON.stringify({ access_token: at, refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
    expires_at: 4102444800, user: { id: 'u-test', email: 'test@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' } });
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; } };
  const ss = { getItem: () => null, setItem() {}, removeItem() {} };
  const calls = [];
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Headers, Request, Response, AbortController,
    TextEncoder, TextDecoder, structuredClone, queueMicrotask, atob, btoa, crypto: globalThis.crypto, navigator: { userAgent: 'node' },
    WebSocket: function () {}, localStorage: ls, sessionStorage: ss,
    location: { href: 'https://x/care-tools/work-schedule.html', search: '', hash: '', pathname: '/care-tools/work-schedule.html', origin: 'https://x' },
    history: { replaceState() {} }, document: { addEventListener() {}, visibilityState: 'visible' }, addEventListener() {}, removeEventListener() {} };
  ctx.fetch = (input, init) => { const u = String(typeof input === 'string' ? input : input.url); calls.push({ u, at: Date.now() }); return Promise.resolve(onFetch(u, init, calls)); };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('supabase-js-2.112.4.js'), ctx);
  vm.runInContext(authSrc, ctx, { filename: 'su-auth.js' });
  return { A: ctx.SUAuth, calls };
}
const myAcc = (calls) => calls.filter((c) => /\/rest\/v1\/rpc\/my_account/.test(c.u));
/* ログインの確かめが聞く2本: my_account（場面ごと）と本人の行（いつも 200） */
function server(myAccountReplies) {
  let n = 0;
  return (u) => {
    if (/\/rest\/v1\/rpc\/my_account/.test(u)) { const f = myAccountReplies[Math.min(n++, myAccountReplies.length - 1)]; return f(); }
    if (/\/rest\/v1\/allowed_accounts/.test(u)) return json(200, { role: 'office', label: '見本' });
    if (/\/rest\/v1\/rpc\//.test(u)) return json(200, { ok: true });
    return json(404, {});
  };
}
const OK = () => json(200, { email: 'test@example.com', role: 'office', mfa: false });

(async () => {
  const NEW = read('su-auth.js');
  console.log('\n— 1. 発行した直後の券の断りの聞き直し（本物の supabase-js と su-auth.js）—');
  {
    const { A, calls } = authBox(NEW, server([SKEW, OK]));
    const t0 = Date.now();
    const r = await A.client().rpc('my_account');
    const m = myAcc(calls);
    t('★断られた1本を1秒待って1回だけ聞き直し、2回目の答えを返す', !r.error && r.data && r.data.role === 'office' && m.length === 2, { error: r.error, n: m.length });
    t('聞き直すまで1秒ほど待つ（すぐには打たない）', m.length === 2 && m[1].at - m[0].at >= 900 && Date.now() - t0 < 5000, m.length === 2 ? m[1].at - m[0].at : null);
  }
  {
    const { A, calls } = authBox(NEW, server([SKEW, SKEW, OK]));
    const r = await A.client().rpc('my_account');
    t('続けて断られたら2回目の答え（401・PGRST303）をそのまま返す＝聞き直しは1回だけ', r.error && r.error.code === 'PGRST303' && r.status === 401 && myAcc(calls).length === 2, { e: r.error, n: myAcc(calls).length });
  }
  {
    const { A, calls } = authBox(NEW, server([EXPIRED, OK]));
    const r = await A.client().rpc('my_account');
    t('期限切れの券（JWT expired）は聞き直さない', r.error && /expired/.test(r.error.message) && myAcc(calls).length === 1, myAcc(calls).length);
  }
  {
    const { A, calls } = authBox(NEW, server([() => json(401, { code: 'PGRST301', message: 'JWSError JWSInvalidSignature' }), OK]));
    const r = await A.client().rpc('my_account');
    t('ほかの 401（署名の誤り）は聞き直さない', r.error && myAcc(calls).length === 1, myAcc(calls).length);
  }
  {
    const { A, calls } = authBox(NEW, server([() => json(403, { code: '42501', message: 'permission denied' }), OK]));
    const r = await A.client().rpc('my_account');
    t('403（42501 の断り）は聞き直さない', r.error && r.error.code === '42501' && myAcc(calls).length === 1, myAcc(calls).length);
  }
  {
    let n = 0;
    const { A, calls } = authBox(NEW, (u) => (/\/functions\/v1\//.test(u) ? (n++, SKEW()) : json(200, {})));
    await A.client().functions.invoke('report-submit', { body: { x: 1 } });
    t('データベース以外（/functions/v1/）の 401 は聞き直さない', n === 1, n);
  }
  {
    let body2 = null;
    const { A } = authBox(NEW, (u, init, calls) => {
      if (/apply_note_edits/.test(u)) { if (calls.filter((c) => /apply_note_edits/.test(c.u)).length === 1) return SKEW(); body2 = init && init.body; return json(200, { ok: true }); }
      return json(200, {});
    });
    const r = await A.client().rpc('apply_note_edits', { p_edits: [{ id: 1 }] });
    t('保存の問い合わせも同じ本文で聞き直す（断られた1本はデータベースで動いていない）', !r.error && body2 === JSON.stringify({ p_edits: [{ id: 1 }] }), { e: r.error, body2 });
  }

  console.log('\n— 2. ログインの確かめ（再現と直し）—');
  {
    const OLD = execFileSync('git', ['-C', ROOT, 'show', 'a1a43ed:su-auth.js'], { encoding: 'utf8' });
    t('前提: 直す前の su-auth.js には聞き直しが無い', !/issued at future/.test(OLD) && /issued at future/.test(NEW));
    const before = authBox(OLD, server([SKEW, OK]));
    const s0 = await before.A.check();
    t('★再現: 直す前は、最初の my_account が断られると「確かめられない」（error）になる', s0.status === 'error', s0.status);
    const after = authBox(NEW, server([SKEW, OK]));
    const s1 = await after.A.check();
    t('★直した後は、同じ断りでも「使える」（ok・事務所）になる', s1.status === 'ok' && s1.role === 'office', { s: s1.status, r: s1.role });
    const still = authBox(NEW, server([SKEW, SKEW, SKEW]));
    const s2 = await still.A.check();
    t('断りが続く時は今までどおり「確かめられない」（error）のまま＝ログインの判定は変えない', s2.status === 'error', s2.status);
  }

  console.log('\n— 3. アプリの使える人（su-app-gate.js）—');
  {
    const G = read('su-app-gate.js');
    const qs = G.slice(G.indexOf('function quietNet('));
    const body = qs.slice(0, qs.indexOf('\n  }\n') + 4);
    const quietNet = new Function(body + '\nreturn quietNet;')();
    t('★確かめ直しの打ち切り（Error timeout）は記録しない', quietNet(new Error('timeout')) === true);
    t('部品が読み込めない（Error load）は記録しない', quietNet(new Error('load')) === true);
    t('supabase-js の通信の失敗（素のオブジェクト・Failed to fetch）は記録しない', quietNet({ message: 'TypeError: Failed to fetch' }) === true);
    t('Safari の通信の失敗（素のオブジェクト・Load failed）は記録しない', quietNet({ message: 'TypeError: Load failed' }) === true);
    t('★画面のコードの例外（TypeError）は記録する', quietNet(new TypeError('x is not a function')) === false);
    t('Error の形の「Failed to fetch」も記録する（素のオブジェクトだけを通信の失敗とみなす）', quietNet(new TypeError('Failed to fetch')) === false);
    t('データベースの断り（42501）は記録する', quietNet({ code: '42501', message: 'permission denied' }) === false);
    t('空・文字だけは記録する', quietNet(null) === false && quietNet('timeout') === false);
    t('★確かめ直し（recheck）だけが黙る印を渡し、開いた時（run）は渡さない',
      /function recheck\([^)]*\) \{[\s\S]{0,120}probe\(key, fresh, true\)/.test(G) && /function run\([^)]*\) \{[\s\S]{0,200}probe\(key, false\)\.then/.test(G));
    t('probe の中の記録はすべて黙る判定を通る（中で note を同じ名前で包む）', /function probe\(key, fresh, again\) \{\n    function note\(where, e\) \{ if \(!\(again && quietNet\(e\)\)\) noteNow\(where, e\); \}/.test(G));

    /* 実際に動かして記録（SUErrors.note）の回数を数える（反証レビューの指摘・箱は app_gate_test と同じ作り） */
    function gate(rpcReply) {
      const listeners = {}, notes = [];
      const mkEl = (tag) => ({ tag, children: [], className: '', textContent: '', attrs: {}, classList: { add() {}, remove() {} },
        setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; }, removeChild() {}, addEventListener() {}, focus() {},
        hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; } });
      const body = mkEl('body'), head = mkEl('head');
      const win = { addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }, supabase: {},
        SUErrors: { note: (k, e) => notes.push([k, e]) },
        SUAuth: { check: () => Promise.resolve({ status: 'ok', role: 'office' }), client: () => ({ rpc: () => rpcReply.now() }) } };
      const store = new Map([['sb-kakuu-auth-token', '{}']]);
      const ctx = { window: win, SUErrors: win.SUErrors, Promise, JSON, Object, Array, String, Date, RegExp, Error,
        setTimeout(fn, ms) { if (!(ms >= 5000)) setImmediate(fn); return 0; },
        localStorage: { get length() { return store.size; }, key(i) { return [...store.keys()][i] || null; }, getItem(k) { return store.has(k) ? store.get(k) : null; } },
        document: { body, head, documentElement: { classList: { add() {}, remove() {} } }, scripts: [], hidden: false, createElement: mkEl,
          querySelector: () => null, querySelectorAll: () => [], addEventListener(k, fn) { (listeners['doc:' + k] = listeners['doc:' + k] || []).push(fn); } },
        location: { pathname: '/training-plan.html', reload() {} } };
      vm.createContext(ctx);
      vm.runInContext(G, ctx, { filename: 'su-app-gate.js' });
      return { G: win.SUAppGate, listeners, notes };
    }
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const OKR = () => Promise.resolve({ data: { ok: true, role: 'office' } });
    const CASES = [
      ['打ち切り（Error timeout）', () => Promise.reject(new Error('timeout')), 0],
      ['通信の失敗（素のオブジェクト）', () => Promise.resolve({ error: { message: 'TypeError: Failed to fetch' } }), 0],
      ['画面のコードの例外（TypeError）', () => Promise.reject(new TypeError('x is not a function')), 1],
      ['データベースの失敗（500）', () => Promise.resolve({ error: { code: '500', message: 'boom' } }), 1]
    ];
    for (const [label, bad, wantRecheck] of CASES) {
      const r = { now: bad };
      const open = gate(r);
      await open.G.run('training-plan', { dirty: () => false });
      t('開いた時の ' + label + ' は記録する（1回）', open.notes.length === 1, open.notes.length);
      const r2 = { now: OKR };
      const L = gate(r2);
      const opened = await L.G.run('training-plan', { dirty: () => false });
      r2.now = bad;
      L.listeners.storage.forEach((f) => f({ key: 'sb-kakuu-auth-token' })); await settle();
      t((wantRecheck ? '確かめ直しの ' + label + ' は記録する（1回）' : '★確かめ直しの ' + label + ' は記録しない（0回）'), opened === true && L.notes.length === wantRecheck, { opened, n: L.notes.length });
    }
  }

  console.log('\n— 4. 入居者マスタの写し返し（su-res-read.js）—');
  async function mirrorWith(reply) {
    const notes = [];
    const win = { SUErrors: { note: (k, m) => notes.push([k, m]) } };
    const ctx = { window: win, JSON, Object, Array, String, Number, Math, Error, Promise, Date, RegExp, isNaN, isFinite, parseInt, setTimeout, clearTimeout,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('no network')) };
    vm.createContext(ctx);
    vm.runInContext(read('su-res-read.js'), ctx);
    const io = { cfg: () => ({ url: 'https://script.example/exec', token: 'T' }),
      auth: async () => ({ client: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'h.p.s' } } }) } }) }),
      fetch: async () => ({ json: async () => reply }) };
    await win.SUResRead.mirror(io);
    return notes;
  }
  const BUSY = 'Error: refused: ほかの保存が終わるのを待っています。少し待ってからもう一度お試しください';
  t('★「ほかの保存が終わるのを待っています」の断りは記録しない', (await mirrorWith({ error: BUSY })).length === 0);
  t('先頭の「Error: 」が無い同じ文も記録しない', (await mirrorWith({ error: BUSY.replace(/^Error: /, '') })).length === 0);
  t('★ほかの断り（新しい保存先から受け取れない）は記録する', (await mirrorWith({ error: 'Error: refused: 新しい保存先から写し返す中身を受け取れませんでした' })).length === 1);
  t('定型文（サーバーで処理できませんでした）は記録する', (await mirrorWith({ error: 'サーバーで処理できませんでした。時間をおいてもう一度お試しください' })).length === 1);
  t('中身のない失敗（ok でない・error なし）は記録する', (await mirrorWith({ ok: false })).length === 1);
  t('文の途中に同じ言葉があるだけの断りは記録する（先頭で決める）', (await mirrorWith({ error: 'Error: 認証エラー refused: ほかの保存が終わるのを待っています。' })).length === 1);
  t('成功は記録しない', (await mirrorWith({ ok: true, records: 1 })).length === 0);

  finished = true;
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外: ' + (e && e.stack || e)); finished = true; process.exit(1); });
