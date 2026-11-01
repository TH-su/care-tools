/* 共通データ部品の名前付きの入口（SU.data.training）と Supabase の道の空の枠の試験（2026-10-27・M1 段0 の設計 v3 2.2 の2〜4）。
   守りたいこと:
     A 訓練計画書の専用GASへ送る本文が、入口へ置き換える前と一字一句同じ（get・put・put＋証明・完全に削除・ping・ai・閉じる直前の送信）
       期待する文字列は置き換え前のコード（kvGet・kvRaw・kvPutBeacon を直接呼んでいた形）から書き写したもの
     B スイッチが切・無い・読めない・Supabase の道が読み込まれていない時は gas の道
     C スイッチが入なら Supabase の道へ。ログインできない時は断り、Google へは流さない（AI の中継はスイッチ training_ai で su-ai へ・2026-10-30）
     F 計画書の道（2026-10-29）: 印が切り替える前・0038 の前なら gas の道を同じ本文で。切り替えた後は tp-write へ（合言葉なし）、保存できたら写し返し
     D 入口を通らない呼び出し（kvGet・kvRaw・入居者の4つ・context）は、端末の su_backend が 'supabase' でもスイッチが入でも gas の道
       （入居者マスタの GAS 宛ての mGet は巻き込まれない）
     E 読み込んだだけでは通信しない。スイッチの読み直しは入口が呼ばれた時だけ・1分に1回
   ★画面の本物の関数（tpGet・tpPutBody_・tpPut・tpPutAllowDrop・tpPing・mGet）を切り出して動かす。偽物にするのは fetch・sendBeacon・端末の控えだけ。
   実行: node check/unit/su_data_entry_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('training-plan.html');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 20); i++) await tick(); }

function cutF(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('見つかりません: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('終わりが見つかりません: ' + name);
}

const TP_URL = 'https://script.google.com/macros/s/EXAMPLE_TP/exec';
const MS_URL = 'https://script.google.com/macros/s/EXAMPLE_MASTER/exec';

function box(o) {
  o = o || {};
  const store = {};
  if (o.flags !== undefined) store.su_backend_flags = JSON.stringify(o.flags);
  if (o.suBackend) store.su_backend = o.suBackend;
  const posts = [], flagFetches = [], beacons = [];
  let now = 1700000000000;
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    performance: { mark() {} },
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } },
    fetch: (url, init) => {
      if (/^su-backend\.json\?t=/.test(url)) {
        flagFetches.push({ url, init });
        if (o.remote === 'fail') return Promise.reject(new Error('net'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(o.remote || o.flags || { supabase: {} }) });  /* 既定は控えと同じスイッチ（公開ファイルと控えがそろっている状態） */
      }
      posts.push({ url, method: init.method, ct: init.headers['Content-Type'], redirect: init.redirect, body: init.body, keys: Object.keys(init).join(',') });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, rev: 4, data: null }) });
    },
    Blob: function (parts, opt) { this.text = parts.join(''); this.type = opt && opt.type; },
    Date: { now: () => now },
    Promise, JSON, Object, Array, String, Number, Error, setTimeout, clearTimeout
  };
  if (o.auth) w.SUAuth = o.auth;
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('su-data.js'), w);
  vm.runInContext(read('su-data-gas.js'), w);
  if (o.supa !== false) vm.runInContext(read('su-data-supabase.js'), w);
  /* 画面の本物の関数 */
  w.CFG = { url: TP_URL, token: 'tok-tp' };
  w.MCFG = { url: MS_URL, token: 'tok-ms' };
  w.SU_READY = true;
  w.s_ = v => (v == null ? '' : String(v));
  w.__at = o.accessToken || '';
  w.tpAccessToken_ = () => Promise.resolve(w.__at);
  vm.runInContext(['tpTarget', 'withTimeout', 'tpGet', 'tpPutBody_', 'tpPut', 'tpPing', 'tpPutAllowDrop', 'mGet'].map(n => cutF(HTML, n)).join('\n'), w);
  return { w, posts, flagFetches, beacons, store, advance: ms => { now += ms; } };
}

const DOC = { plans: [{ id: 'p1', memo: '架空' }], trash: [] };
const AIB = { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] };
/* 置き換え前の本文（kvGet・kvRaw に渡していた payload ＋ su-data-gas.js の post() が最後に足す token） */
const EXP = {
  get: '{"action":"get","key":"training_plan:index","token":"tok-tp"}',
  put: '{"action":"put","key":"training_plan:M1","data":' + JSON.stringify(DOC) + ',"rev":3,"token":"tok-tp"}',
  putAt: '{"action":"put","key":"training_plan:M1","data":' + JSON.stringify(DOC) + ',"rev":3,"accessToken":"aaa.bbb.ccc","token":"tok-tp"}',
  drop: '{"action":"put","key":"training_plan:M1","data":' + JSON.stringify(DOC) + ',"rev":3,"allowDrop":true,"token":"tok-tp"}',
  dropAt: '{"action":"put","key":"training_plan:M1","data":' + JSON.stringify(DOC) + ',"rev":3,"allowDrop":true,"accessToken":"aaa.bbb.ccc","token":"tok-tp"}',
  ping: '{"action":"ping","token":"tok-tp"}',
  ai: '{"action":"ai","body":' + JSON.stringify(AIB) + ',"token":"tok-tp"}',
  beacon: '{"action":"put","key":"training_plan:M1","token":"tok-tp","rev":3,"data":' + JSON.stringify(DOC) + '}'
};

async function sendAll(x) {
  const r = {};
  await x.w.tpGet('training_plan:index'); r.get = x.posts.slice(-1)[0];
  await x.w.tpPut('training_plan:M1', DOC, 3); r.put = x.posts.slice(-1)[0];
  await x.w.tpPutAllowDrop('training_plan:M1', DOC, 3); r.drop = x.posts.slice(-1)[0];
  await x.w.tpPing(); r.ping = x.posts.slice(-1)[0];
  await x.w.SU.data.training.ai(AIB, x.w.tpTarget()); r.ai = x.posts.slice(-1)[0];
  r.beaconOk = x.w.SU.data.training.putBeacon('training_plan:M1', DOC, 3, x.w.tpTarget());
  r.beacon = x.beacons.slice(-1)[0];
  return r;
}
function sameShape(p) { return p && p.url === TP_URL && p.method === 'POST' && p.ct === 'text/plain;charset=utf-8' && p.redirect === 'follow' && p.keys === 'method,headers,body,redirect'; }

(async function main() {
  console.log('\n— A. 送る本文が置き換え前と一字一句同じ（gas の道）—');
  for (const variant of [{ name: 'Supabase の道なし', o: { supa: false } }, { name: 'Supabase の道あり・スイッチ切', o: { flags: { supabase: { training: false, training_ai: false } } } }]) {
    const x = box(variant.o);
    const r = await sendAll(x);
    t(variant.name + ': get', r.get && r.get.body === EXP.get && sameShape(r.get), r.get);
    t(variant.name + ': put（証明なし）', r.put && r.put.body === EXP.put && sameShape(r.put), r.put && r.put.body);
    t(variant.name + ': 完全に削除（allowDrop）', r.drop && r.drop.body === EXP.drop && sameShape(r.drop), r.drop && r.drop.body);
    t(variant.name + ': ping', r.ping && r.ping.body === EXP.ping && sameShape(r.ping), r.ping);
    t(variant.name + ': ai', r.ai && r.ai.body === EXP.ai && sameShape(r.ai), r.ai && r.ai.body);
    t(variant.name + ': 閉じる直前の送信', r.beaconOk === true && r.beacon && r.beacon.url === TP_URL && r.beacon.blob.text === EXP.beacon && r.beacon.blob.type === 'text/plain;charset=utf-8', r.beacon);
    t(variant.name + ': 送り先はすべて計画書の GAS', x.posts.every(p => p.url === TP_URL) && x.posts.length === 5, x.posts.map(p => p.url));
  }
  {
    const x = box({ accessToken: 'aaa.bbb.ccc' });
    await x.w.tpPut('training_plan:M1', DOC, 3);
    t('put＋ログインの証明: accessToken は rev の後・token の前', x.posts[0].body === EXP.putAt, x.posts[0].body);
    await x.w.tpPutAllowDrop('training_plan:M1', DOC, 3);
    t('完全に削除＋証明: allowDrop → accessToken → token の順', x.posts[1].body === EXP.dropAt, x.posts[1].body);
  }

  console.log('\n— B. スイッチが切・無い・読めない時は gas の道 —');
  for (const c of [
    { name: '控えが無い', o: {} },
    { name: '控えが壊れている', o: {}, broken: true },
    { name: 'training が true 以外（"true" の文字）', o: { flags: { supabase: { training: 'true' } } } },
    { name: 'Supabase の道が読み込まれていない（スイッチ入）', o: { supa: false, flags: { supabase: { training: true, training_ai: true } } } }
  ]) {
    const x = box(c.o);
    if (c.broken) x.store.su_backend_flags = '{壊れ';
    await x.w.tpGet('training_plan:index');
    await x.w.tpPing();
    t(c.name + ' → gas', x.posts.length === 2 && x.w.SU.data._entryRoute('training') === 'gas', x.posts.length);
  }

  console.log('\n— C. スイッチが入なら断る・Google へ流さない —');
  {
    const x = box({ flags: { supabase: { training: true, training_ai: false } } });
    const errs = [];
    for (const f of [() => x.w.tpGet('training_plan:index'), () => x.w.tpPut('training_plan:M1', DOC, 3), () => x.w.tpPutAllowDrop('training_plan:M1', DOC, 3), () => x.w.tpPing()]) {
      try { await f(); errs.push('OK'); } catch (e) { errs.push(String(e && e.message)); }
    }
    t('ログインの部品が無い時、get・put・完全に削除・ping はすべて断る', errs.length === 4 && errs.every(m => /ログイン/.test(m)), errs);
    t('計画書の GAS へは1本も送らない', x.posts.length === 0, x.posts);
    t('閉じる直前の送信もしない（false）', x.w.SU.data.training.putBeacon('training_plan:M1', DOC, 3, x.w.tpTarget()) === false && x.beacons.length === 0);
    await x.w.SU.data.training.ai(AIB, x.w.tpTarget());
    t('AI の中継は自分のスイッチ（training_ai）が切なら gas', x.posts.length === 1 && x.posts[0].body === EXP.ai, x.posts);
  }
  {
    const x = box({ flags: { supabase: { training: false, training_ai: true } } });
    let m = 'OK'; try { await x.w.SU.data.training.ai(AIB, x.w.tpTarget()); } catch (e) { m = e.message; }
    t('training_ai が入でログインの部品が無ければ AI の中継だけ断る・Google へ流さない', /ログイン/.test(m) && x.posts.length === 0, [m, x.posts.length]);
    await x.w.tpPing();
    t('その時も ping（training は切）は gas', x.posts.length === 1 && x.posts[0].body === EXP.ping);
  }
  {
    const x = box({ flags: { supabase: { training: true } } });
    let threw = false, isP = false;
    try { const p = x.w.SU.data.training.put('k', {}, 1, {}, x.w.tpTarget()); isP = !!(p && typeof p.then === 'function'); await p.catch(() => {}); } catch (e) { threw = true; }
    t('断りは同期に throw せず Promise で返す', isP && !threw);
  }

  console.log('\n— F. 計画書の道（スイッチ training が入）—');
  function fakeAuth(o) {
    const calls = [];
    return { calls, A: {
      STATUS: { OK: 'ok' },
      check: async () => (o.signedOut ? { status: 'signed_out' } : { status: 'ok', role: 'office' }),
      client: () => ({
        rpc: async (n) => { calls.push(['rpc', n]); return o.modeErr ? { data: null, error: o.modeErr } : { data: { ok: true, mode: o.mode || 'shadow' }, error: null }; },
        functions: { invoke: async (name, opt) => { calls.push(['invoke', name, JSON.parse(JSON.stringify(opt.body))]);
          if (o.netErr) return { data: null, error: { message: 'x' } };
          if (o.refuse) return { data: null, error: { context: { json: async () => o.refuse } } };
          return { data: o.reply || { ok: true, rev: 4 }, error: null }; } },
        auth: { getSession: async () => ({ data: { session: { access_token: 'jwt.h.s' } } }) }
      }) } };
  }
  {
    const f = fakeAuth({ signedOut: true });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A });
    let m = 'OK'; try { await x.w.tpPut('training_plan:M1', DOC, 3); } catch (e) { m = e.message; }
    t('ログインしていない → 断る・Google へ流さない', /ログインしていません/.test(m) && x.posts.length === 0, [m, x.posts.length]);
  }
  for (const [label, o] of [['印が切り替える前', { mode: 'shadow' }], ['0038 の前（関数が無い）', { modeErr: { code: 'PGRST202' } }]]) {
    const f = fakeAuth(o);
    const x = box({ flags: { supabase: { training: true } }, auth: f.A, accessToken: 'aaa.bbb.ccc' });
    await x.w.tpGet('training_plan:index');
    await x.w.tpPut('training_plan:M1', DOC, 3);
    t(label + ' → gas の道を置き換え前と一字一句同じ本文で・tp-write は呼ばない', x.posts.length === 2 && x.posts[0].body === EXP.get && x.posts[1].body === EXP.putAt
      && sameShape(x.posts[1]) && !f.calls.some(c => c[0] === 'invoke'), x.posts.map(p => p.body));
  }
  {
    const f = fakeAuth({ mode: 'live' });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A, accessToken: 'aaa.bbb.ccc' });
    const r = await x.w.tpPut('training_plan:M1', DOC, 3);
    await settle(30);
    const inv = f.calls.filter(c => c[0] === 'invoke');
    t('切り替えた後: 保存は tp-write へ同じ本文（合言葉なし）・応答をそのまま返す', inv.length === 1 && inv[0][1] === 'tp-write'
      && JSON.stringify(inv[0][2]) === '{"action":"put","key":"training_plan:M1","data":' + JSON.stringify(DOC) + ',"rev":3,"accessToken":"aaa.bbb.ccc"}' && r && r.ok === true, [inv, r]);
    t('保存できたら計画書の GAS へ写し返し（tpMirror・ログインの証明・合言葉は GAS へだけ）', x.posts.length === 1 && x.posts[0].url === TP_URL
      && x.posts[0].body === '{"action":"tpMirror","accessToken":"jwt.h.s","token":"tok-tp"}', x.posts.map(p => p.body));
    await x.w.tpGet('training_plan:M1');
    await x.w.tpGet('training_plan:M2');
    await settle(30);
    t('開いた時（最初の読み取り）に1回だけ写し返しの残りを追いつかせる', x.posts.length === 2 && f.calls.filter(c => c[0] === 'invoke').length === 3, x.posts.length);
  }
  {
    const f = fakeAuth({ mode: 'live', refuse: { ok: false, error: '保存できませんでした（新しい保存先が受け付けませんでした）', code: 'badrow' } });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A });
    const r = await x.w.SU.data.training.put('training_plan:M1', DOC, 3, {}, x.w.tpTarget());
    await settle(30);
    t('tp-write の断りは GAS と同じ形のまま返す・写し返しは送らない', r && r.ok === false && r.code === 'badrow' && x.posts.length === 0, [r, x.posts.length]);
  }
  {
    const f = fakeAuth({ mode: 'live', netErr: true });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A });
    let m = 'OK'; try { await x.w.SU.data.training.put('training_plan:M1', DOC, 3, {}, x.w.tpTarget()); } catch (e) { m = e.message; }
    t('届かない時は失敗・Google へ流さない', /届きませんでした/.test(m) && x.posts.length === 0, [m, x.posts.length]);
  }
  console.log('\n— G. AI の中継（スイッチ training_ai が入・su-ai・2026-10-30）—');
  for (const mode of ['live', 'shadow']) {
    const f = fakeAuth({ mode, reply: { ok: true, status: 200, data: { content: [] } } });
    const x = box({ flags: { supabase: { training: true, training_ai: true } }, auth: f.A });
    const r = await x.w.SU.data.training.ai(AIB, x.w.tpTarget());
    const inv = f.calls.filter(c => c[0] === 'invoke');
    t('印が ' + mode + ' でも su-ai へ用途つきで本文をそのまま送る（合言葉・GAS の action を付けない）・応答はそのまま返す', inv.length === 1 && inv[0][1] === 'su-ai'
      && JSON.stringify(inv[0][2]) === JSON.stringify({ purpose: 'training_plan', body: AIB }) && r && r.ok === true && r.status === 200
      && x.posts.length === 0 && !f.calls.some(c => c[0] === 'rpc'), [inv, r, x.posts.length]);
  }
  {
    const f = fakeAuth({ signedOut: true });
    const x = box({ flags: { supabase: { training_ai: true } }, auth: f.A });
    const r = await x.w.SU.data.training.ai(AIB, x.w.tpTarget());
    t('ログインしていない → {ok:false, error:login}・送らない・Google へ流さない', r && r.ok === false && r.error === 'login' && f.calls.length === 0 && x.posts.length === 0, [r, f.calls]);
  }
  {
    const f = fakeAuth({ refuse: { ok: false, error: 'ai_name_found' } });
    const x = box({ flags: { supabase: { training_ai: true } }, auth: f.A });
    const r = await x.w.SU.data.training.ai(AIB, x.w.tpTarget());
    t('su-ai の断りは GAS と同じ形のまま返す', r && r.ok === false && r.error === 'ai_name_found' && x.posts.length === 0, r);
  }
  {
    const f = fakeAuth({ netErr: true });
    const x = box({ flags: { supabase: { training_ai: true } }, auth: f.A });
    let m = 'OK'; try { await x.w.SU.data.training.ai(AIB, x.w.tpTarget()); } catch (e) { m = e.message; }
    t('届かない時は失敗・Google へ流さない', /届きませんでした/.test(m) && x.posts.length === 0, [m, x.posts.length]);
  }
  {
    let n = 0;
    const f = fakeAuth({});
    f.A.client = () => ({ functions: { invoke: async () => (++n === 1 ? { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } } : { data: { ok: true, status: 200, data: {} }, error: null }) } });
    const x = box({ flags: { supabase: { training_ai: true } }, auth: f.A });
    const r = await x.w.SU.data.training.ai(AIB, x.w.tpTarget());
    t('受け口に届く前に切れた時は、少し待って1回だけ送り直す（2回目で答えれば成功）', n === 2 && r && r.ok === true && x.posts.length === 0, [n, r]);
  }
  for (const [label, err, retried] of [['2回とも届かない', { name: 'FunctionsFetchError', message: 'Failed to fetch' }, 2],
                                       ['受け口が 500 で答えた', { name: 'FunctionsHttpError', message: 'x', context: { status: 500, json: async () => null } }, 1],
                                       ['手前の中継で止まった', { name: 'FunctionsRelayError', message: 'x' }, 1]]) {
    let n = 0;
    const f = fakeAuth({});
    f.A.client = () => ({ functions: { invoke: async () => { n++; return { data: null, error: err }; } } });
    const x = box({ flags: { supabase: { training_ai: true } }, auth: f.A });
    try { await x.w.SU.data.training.ai(AIB, x.w.tpTarget()); } catch (e) { /* 失敗 */ }
    t('AI の中継が ' + label + ' → 送るのは ' + retried + '回まで', n === retried, n);
  }
  for (const [label, err, code] of [['通信の段階で止まった', { name: 'FunctionsFetchError', message: 'Failed to fetch' }, 'ai_fetch'],
                                    ['入口が 401 で断った（答えが読めない形）', { name: 'FunctionsHttpError', message: 'x', context: { status: 401, json: async () => ({ code: 401, message: 'Invalid JWT' }) } }, 'ai_401'],
                                    ['手前の中継で止まった', { name: 'FunctionsRelayError', message: 'x' }, 'ai_relay']]) {
    const f = fakeAuth({});
    f.A.client = () => ({ functions: { invoke: async () => ({ data: null, error: err }) } });
    const x = box({ flags: { supabase: { training_ai: true } }, auth: f.A });
    let c = ''; try { await x.w.SU.data.training.ai(AIB, x.w.tpTarget()); } catch (e) { c = e.code; }
    t('AI の中継が ' + label + ' → 止まった段の印 ' + code + ' を付けて失敗', c === code, c);
  }
  {
    const x = box({ flags: { supabase: { training_ai: true } } });
    let c = ''; try { await x.w.SU.data.training.ai(AIB, x.w.tpTarget()); } catch (e) { c = e.code; }
    t('ログインの部品が無い時も印（ai_noauth）を付ける', c === 'ai_noauth', c);
  }
  {
    const f = fakeAuth({ mode: 'live', reply: { ok: true, server: 'silverunix-training' } });
    const x = box({ flags: { supabase: { training: true, training_ai: true } }, auth: f.A });
    const r = await x.w.tpPing();
    t('切り替えた後の ping: AI の中継が su-ai の時は「使える」とだけ返し、Google の ping は送らない', r && r.ai && r.ai.key === true && x.posts.length === 0, [r, x.posts.length]);
  }
  {
    const H = read('training-plan.html');
    t('画面: su-ai だけが返す断り（login・ai_forbidden・ai_name_found）を職員向けの文にする', /login: 'AI_LOGIN', ai_forbidden: 'AI_FORBIDDEN', ai_name_found: 'AI_NAME_FOUND'/.test(H)
      && /m === 'AI_LOGIN'/.test(H) && /m === 'AI_FORBIDDEN'/.test(H) && /m === 'AI_NAME_FOUND'/.test(H) && /AI_READROLE\|AI_LOGIN\|AI_FORBIDDEN\|/.test(H));
  }
  {
    const H = read('training-plan.html');
    t('画面: 接続できなかった時は、受け口が付けた印（ai_…）だけを文の末尾に出す', /var ne = new Error\('AI_NETWORK'\); ne\.code = s_\(e0 && e0\.code\)/.test(H)
      && /\(\/\^ai_\[a-z0-9\]\{1,20\}\$\/\.test\(s_\(e && e\.code\)\) \? '（受け口の状態 '/.test(H));
    const S = read('shadow-check.html'), J = read('shadow-check.js');
    t('写しの見比べ: 「AI の中継を確かめる」は最初は隠し・管理者だけ・確かめてから決まった短い依頼を su-ai へ1回', /id="b-tp-ai" hidden>AI の中継を確かめる</.test(S)
      && /async function runTpAi\(\)[\s\S]{0,400}me\.role === 'admin'[\s\S]{0,300}confirm\(/.test(J) && /functions\.invoke\('su-ai', \{ body: \{ purpose: 'training_plan',\s*body: \{ model: 'claude-sonnet-5', max_tokens: 16, messages: \[\{ role: 'user', content: '「はい」とだけ答えてください' \}\] \} \} \}\)/.test(J)
      && /\$\('b-tp-ai'\)\.addEventListener\('click'/.test(J));
  }

  {
    const f = fakeAuth({ mode: 'live', reply: { ok: true, server: 'silverunix-training', ai: { key: false } } });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A });
    x.w.fetch = ((orig) => (url, init) => { if (/^su-backend/.test(url)) return orig(url, init); x.posts.push({ url, body: init.body }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ai: { key: true, limit: 300, usedToday: 2 } }) }); })(x.w.fetch);
    const r = await x.w.tpPing();
    t('切り替えた後の ping: 守りの一覧は tp-write、AI の状態は Google の ping から（AI の中継はまだ Google）', r && r.server === 'silverunix-training' && r.ai && r.ai.key === true && r.ai.usedToday === 2
      && x.posts.length === 1 && x.posts[0].body === EXP.ping, [r, x.posts.map(p => p.body)]);
  }
  {
    const x = box({});
    x.w.fetch = ((orig) => (url, init) => { if (/^su-backend/.test(url)) return orig(url, init); x.posts.push({ url, body: init.body }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, rev: 4, data: { plans: [] }, switched: true }) }); })(x.w.fetch);
    let m = 'OK'; try { await x.w.tpGet('training_plan:M1'); } catch (e) { m = e.message; }
    t('gas の道で GAS が「切り替えた後・最中」（switched）と返したら、止まった中身を使わずに知らせる（送る本文は同じ）', /切り替えている最中か、切り替えた後/.test(m)
      && x.posts.length === 1 && x.posts[0].body === '{"action":"get","key":"training_plan:M1","token":"tok-tp"}', [m, x.posts]);
  }
  {
    const f = fakeAuth({ mode: 'shadow' });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A });
    t('スイッチ入・印が分からない間は閉じる直前の送信をしない', x.w.SU.data.training.putBeacon('training_plan:M1', DOC, 3, x.w.tpTarget()) === false && x.beacons.length === 0);
    await x.w.tpGet('training_plan:index');
    t('印が「切り替える前」と分かった後は、今までどおり Google へ閉じる直前の送信をする（同じ本文）', x.w.SU.data.training.putBeacon('training_plan:M1', DOC, 3, x.w.tpTarget()) === true
      && x.beacons.length === 1 && x.beacons[0].blob.text === EXP.beacon, x.beacons.length);
  }
  {
    const f = fakeAuth({ mode: 'live' });
    const x = box({ flags: { supabase: { training: true } }, auth: f.A });
    await x.w.tpGet('training_plan:index');
    t('印が「切り替えた後」なら閉じる直前の送信はしない', x.w.SU.data.training.putBeacon('training_plan:M1', DOC, 3, x.w.tpTarget()) === false && x.beacons.length === 0);
  }

  console.log('\n— D. 入口を通らない呼び出しは常に gas —');
  {
    const x = box({ suBackend: 'supabase', flags: { supabase: { training: true, training_ai: true } } });
    t('端末の su_backend が supabase でも driverName は gas', x.w.SU.data.driverName() === 'gas');
    await x.w.mGet({ action: 'getRoster' });
    await x.w.mGet({ action: 'getResident', id: 'R-001' });
    await x.w.mGet({ action: 'getBulk' });
    await x.w.mGet({ action: 'getSection', id: 'R-001', section: 'adl_detail' });
    t('入居者マスタ宛て（getRoster・getResident・getBulk・getSection）は入居者マスタの GAS へ同じ本文で',
      x.posts.length === 4 && x.posts.every(p => p.url === MS_URL) &&
      x.posts[0].body === '{"action":"getRoster","token":"tok-ms"}' &&
      x.posts[1].body === '{"action":"getResident","id":"R-001","token":"tok-ms"}' &&
      x.posts[2].body === '{"action":"getBulk","token":"tok-ms"}' &&
      x.posts[3].body === '{"action":"getSection","id":"R-001","section":"adl_detail","token":"tok-ms"}', x.posts.map(p => p.body));
    await x.w.SU.data.kvGet('training_plan:index', x.w.tpTarget());
    await x.w.SU.data.kvPut('k', { a: 1 }, 2, x.w.tpTarget());
    await x.w.SU.data.kvRaw({ action: 'ping' }, x.w.tpTarget());
    await x.w.SU.data.getRoster({ endpoint: MS_URL, token: 'tok-ms' });
    t('kvGet・kvPut・kvRaw・getRoster は gas（スイッチ入でも）', x.posts.length === 8 && x.posts[4].body === EXP.get && x.posts[6].body === EXP.ping, x.posts.length);
    const ctx = x.w.SU.data.context();
    t('context は gas の道の値', ctx && ctx.effective === 'full', ctx);
  }

  console.log('\n— E. 読み込んだだけでは通信しない・読み直しは1分に1回 —');
  {
    const x = box({ supa: false });
    await x.w.tpGet('training_plan:index');
    t('Supabase の道が無いページではスイッチを読みに行かない', x.flagFetches.length === 0, x.flagFetches.length);
  }
  {
    const x = box({ remote: { supabase: { training: true } } });
    t('読み込んだだけでは何も送らない', x.flagFetches.length === 0 && x.posts.length === 0);
    await x.w.tpGet('training_plan:index');
    t('最初の入口で読み直す（?t= 付き・no-store）', x.flagFetches.length === 1 && x.flagFetches[0].init.cache === 'no-store', x.flagFetches);
    t('その呼び出しは控え（無い＝gas）で決める＝待たせない', x.posts.length === 1 && x.posts[0].body === EXP.get);
    await settle();
    t('読めたスイッチを控えに書く', JSON.parse(x.store.su_backend_flags || 'null').supabase.training === true, x.store.su_backend_flags);
    let m = 'OK'; try { await x.w.tpPing(); } catch (e) { m = e.message; }
    t('次の呼び出しから新しいスイッチで決める（入＝新しい保存先の道・ログインの部品が無ければ断る）', /ログイン/.test(m) && x.posts.length === 1, m);
    t('1分以内は読み直さない', x.flagFetches.length === 1, x.flagFetches.length);
    x.advance(61000);
    try { await x.w.tpPing(); } catch (e) { /* 断り */ }
    t('1分を過ぎたら読み直す', x.flagFetches.length === 2, x.flagFetches.length);
  }
  {
    const x = box({ remote: 'fail', flags: { supabase: { training: false } } });
    await x.w.tpGet('training_plan:index'); await settle();
    t('読めない時は最後に読めた値のまま（gas）', x.posts.length === 1 && JSON.parse(x.store.su_backend_flags).supabase.training === false);
  }

  console.log('\n— 画面の置き換え —');
  t('訓練計画書は計画書の GAS 宛てを kvRaw・kvGet・kvPutBeacon で直接送らない',
    !/SU\.data\.kvRaw\(\s*body\s*,\s*tpTarget\(\)/.test(HTML) && !/SU\.data\.kvRaw\(\{\s*action:\s*'(ping|ai)'/.test(HTML) &&
    !/SU\.data\.kvGet\(key,\s*tpTarget\(\)\)/.test(HTML) && !/SU\.data\.kvPutBeacon\(/.test(HTML));
  t('AI の中継は入口（SU.data.training.ai）を通す', /SU\.data\.training\.ai\(body,\s*tpTarget\(\)\)/.test(HTML));
  t('入居者マスタ宛て（mGet）は kvRaw に入居者マスタの接続先を渡す形のまま', /SU\.data\.kvRaw\(body,\s*\{\s*endpoint:\s*MCFG\.url,\s*token:\s*MCFG\.token,\s*gasAuth:\s*true\s*\}\)/.test(HTML));   // gasAuth は証明を添えてよい宛先の印（本文には入らない・2026-10-29）
  t('読み込みの順: su-data.js → su-data-gas.js → su-data-supabase.js → su-kv.js',
    /su-data\.js\?v=[^"]+"><\/script>\s*<script src="su-data-gas\.js\?v=[^"]+"><\/script>\s*<script src="su-data-supabase\.js\?v=[^"]+"><\/script>[\s\S]*?su-kv\.js/.test(HTML));
  const SUPA = read('su-data-supabase.js');
  t('Supabase の道は KV の箱を持たない（kvGet・kvPut を登録しない）・fetch しない', !/\bkv(Get|Put|Raw)\s*:/.test(SUPA) && !/fetch\(/.test(SUPA));

  console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack)); process.exitCode = 1; });
