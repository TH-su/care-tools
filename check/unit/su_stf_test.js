/* 職員マスタの保存先の切り替えの入口（su-stf.js・統合 0045・2026-11-02）の試験。架空データのみ。
   守ること:
     A スイッチ staff が切・無い・現場の端末・添付（uploadFile・removeFile）は、Google へ送る関数をそのまま呼ぶ（データベースも受け口も呼ばない）
     B スイッチが入でも、印が写しの期間・0045 の前（関数が無い）は Google
     C 印が「切り替えた後」なら受け口 stf-write へ送り、Google を呼ばない。合言葉 token・証明 accessToken は送らない。答えは fetch と同じ形
     D スイッチが入の時、ログインしていない・使えないアカウント・印を確かめられない・受け口の断りは Google へ流さず、{ok:false, error} で返す
     E 受け口に届かない・時間切れは送信の失敗（AbortError）にする（画面が「書けたか分からない」として扱う）
     F 受け口が「写しの期間」と答えたら、印を捨てて Google へ送る
     G 新しい保存先で書けたら Google へ写し返しを頼む（stfMirror・合言葉と証明つき・読むだけの時は頼まない）
     I 同じ受付番号を、前と違う道（Google ↔ 新しい保存先）へ送らない（切り替えをまたいだ送り直しで2回書かない・反証レビューの指摘 A）
     H 端末に書かない
   実行: node check/unit/su_stf_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-stf.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }
const GAS = 'https://script.google.com/macros/s/EXAMPLE_STAFF/exec';

function box(o) {
  o = o || {};
  const store = { su_backend_flags: JSON.stringify({ supabase: o.flags || {} }) };
  if (o.field) store.su_device_role = 'field';
  const writes = [], invokes = [], rpcs = [], fetches = [];
  const A = {
    STATUS: { OK: 'ok' },
    check: async () => (o.signedOut ? { status: 'signed_out' } : o.forbidden ? { status: 'forbidden' } : { status: 'ok', role: 'office' }),
    client: () => ({
      rpc: async (n) => { rpcs.push(n); if (o.modeErr) return { error: o.modeErr }; return { data: { ok: true, mode: (o.modeRef ? o.modeRef.m : o.mode) || 'shadow', version: 3 } }; },
      functions: { invoke: (fn, opt) => { invokes.push({ fn, body: JSON.parse(JSON.stringify(opt.body)) }); return typeof o.reply === 'function' ? o.reply(invokes.length) : Promise.resolve(o.reply || { data: { ok: true, ver: 4, rows: [] }, error: null }); } },
      auth: { getSession: async () => ({ data: { session: { access_token: 'h.p.s' } } }) }
    })
  };
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) },
    fetch: (url, init) => {
      fetches.push({ url, init });
      if (/su-backend\.json/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, rows: 1 }) });
    },
    SUAuth: A, setTimeout, clearTimeout, Promise, JSON, Object, Error, String, Number, Date
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(SRC, w);
  let gasCalls = 0;
  const gasSend = () => { gasCalls++; return Promise.resolve({ ok: true, status: 200, text: async () => '{"ok":true,"via":"gas"}' }); };
  const send = async (body, opts) => {
    try { const r = await w.SUStf.send(body, gasSend, Object.assign({ screen: 'staff-master', url: GAS }, opts || {})); return { r, d: JSON.parse(await r.text()) }; }
    catch (e) { return { e }; }
  };
  return { w, send, writes, invokes, rpcs, fetches, gas: () => gasCalls };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const BODY = () => ({ action: 'bulkSave', token: 'tok-staff', accessToken: 'h.p.s', reqId: 'a'.repeat(32), rows: [], creates: [{ tempId: 't1', fields: { name: '見本 一郎' } }] });

(async () => {
  console.log('A Google のまま');
  for (const [label, o, body] of [['スイッチが無い', {}, BODY()], ['スイッチが切', { flags: { staff: false } }, BODY()],
    ['現場の端末', { flags: { staff: true }, mode: 'live', field: true }, BODY()],
    ['添付の追加', { flags: { staff: true }, mode: 'live' }, { action: 'uploadFile', token: 'x', id: 'S0001' }],
    ['添付の削除', { flags: { staff: true }, mode: 'live' }, { action: 'removeFile', token: 'x', id: 'S0001', fid: 'f' }]]) {
    const b = box(o);
    const x = await b.send(body);
    t('A ' + label + ' → Google へ1回・受け口もデータベースも呼ばない', x.d && x.d.via === 'gas' && b.gas() === 1 && b.invokes.length === 0 && b.rpcs.length === 0, [x, b.rpcs]);
  }
  console.log('B 写しの期間');
  {
    const b = box({ flags: { staff: true }, mode: 'shadow' });
    const x = await b.send(BODY());
    t('B 印が写しの期間 → Google', x.d.via === 'gas' && b.invokes.length === 0 && b.rpcs.join() === 'stf_mode_get');
    const b2 = box({ flags: { staff: true }, modeErr: { code: 'PGRST202' } });
    const x2 = await b2.send(BODY());
    t('B 0045 の前（関数が無い）→ Google', x2.d.via === 'gas' && b2.invokes.length === 0);
  }
  console.log('C 切り替えた後');
  {
    const b = box({ flags: { staff: true }, mode: 'live' });
    const x = await b.send(BODY());
    t('C 受け口 stf-write へ送り、Google を呼ばない', b.invokes.length === 1 && b.invokes[0].fn === 'stf-write' && b.gas() === 0, b.invokes);
    t('C 合言葉と証明は送らない・ほかの本文はそのまま', !('token' in b.invokes[0].body) && !('accessToken' in b.invokes[0].body) && b.invokes[0].body.reqId === 'a'.repeat(32) && b.invokes[0].body.creates[0].fields.name === '見本 一郎');
    t('C 答えは fetch と同じ形（ok・status・text）', x.r.ok === true && x.r.status === 200 && x.d.ok === true && x.d.ver === 4);
    const x2 = await b.send({ action: 'list', token: 't' });
    t('C 印は1分覚える（2回目は読み直さない）', b.rpcs.filter(n => n === 'stf_mode_get').length === 1 && x2.d.ok === true);
  }
  console.log('D Google へ流さない断り');
  for (const [label, o, re] of [['ログインしていない', { signedOut: true }, /ログインしていません/], ['使えないアカウント', { forbidden: true }, /使えません/],
    ['印を確かめられない', { modeErr: { code: '500', message: 'x' } }, /確かめられませんでした/], ['印の口で断られた', { modeErr: { code: '42501' } }, /使えません/]]) {
    const b = box(Object.assign({ flags: { staff: true }, mode: 'live' }, o));
    const x = await b.send(BODY());
    t('D ' + label + ' → {ok:false}・Google も受け口も呼ばない', x.d && x.d.ok === false && re.test(x.d.error) && b.gas() === 0 && b.invokes.length === 0, x);
  }
  {
    const b = box({ flags: { staff: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsHttpError', context: { json: async () => ({ error: 'この操作は受け付けていません', code: 'action' }) } } } });
    const x = await b.send(BODY());
    t('D 受け口の断りは GAS と同じ形（ok:false・文・種類）で返し、Google へ流さない', x.d.ok === false && x.d.error === 'この操作は受け付けていません' && x.d.code === 'action' && b.gas() === 0);
  }
  console.log('E 届かない・時間切れ');
  {
    const b = box({ flags: { staff: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } } });
    const x = await b.send(BODY());
    t('E 届かない → 送信の失敗（Google へ流さない）', x.e && b.gas() === 0, x);
    const b2 = box({ flags: { staff: true }, mode: 'live', reply: () => new Promise(() => {}) });
    const x2 = await b2.send(BODY(), { timeoutMs: 20 });
    t('E 時間切れ → AbortError（画面が「書けたか分からない」として扱う）', x2.e && x2.e.name === 'AbortError' && b2.gas() === 0, x2);
  }
  console.log('F 写しの期間へ戻っていた');
  {
    const b = box({ flags: { staff: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsHttpError', context: { json: async () => ({ error: '切り替える前です', code: 'shadow' }) } } } });
    const x = await b.send(BODY());
    t('F 受け口が「写しの期間」→ Google へ送る', x.d.via === 'gas' && b.gas() === 1);
    await b.send({ action: 'list', token: 't' });
    t('F 印を捨てて読み直す', b.rpcs.filter(n => n === 'stf_mode_get').length === 2);
  }
  console.log('G 写し返しを頼む');
  {
    const b = box({ flags: { staff: true }, mode: 'live' });
    await b.send(BODY()); await tick(); await tick(); await tick();
    const m = b.fetches.filter(f => f.url === GAS);
    t('G 書けた後に Google へ stfMirror を1回（合言葉と証明つき・送り方は GAS と同じ）', m.length === 1 && JSON.parse(m[0].init.body).action === 'stfMirror' && JSON.parse(m[0].init.body).token === 'tok-staff'
      && JSON.parse(m[0].init.body).accessToken === 'h.p.s' && m[0].init.method === 'POST' && m[0].init.redirect === 'follow', m);
    const b2 = box({ flags: { staff: true }, mode: 'live' });
    await b2.send({ action: 'list', token: 't' }); await tick(); await tick();
    t('G 読むだけの時は頼まない', b2.fetches.filter(f => f.url === GAS).length === 0);
    const b3 = box({ flags: { staff: true }, mode: 'live', reply: { data: { ok: false, error: '入力の誤り' }, error: null } });
    await b3.send(BODY()); await tick(); await tick();
    t('G 書けなかった時は頼まない', b3.fetches.filter(f => f.url === GAS).length === 0);
  }
  console.log('I 道をまたいだ送り直し');
  {
    const ref = { m: 'shadow' };
    const b = box({ flags: { staff: true }, modeRef: ref });
    const body = BODY();
    await b.send(Object.assign({}, body));
    ref.m = 'live'; b.w.SUStf._forgetMode();
    const x = await b.send(Object.assign({}, body));
    t('I Google へ送った番号を、切り替えた後に同じ番号で送り直す → 送らずに断る（読み込み直して一覧で確かめる）', x.d.ok === false && x.d.error === '保存できたか確かめられません。画面を読み込み直して、一覧で確かめてください' && b.invokes.length === 0 && b.gas() === 1, x);
    const y = await b.send(Object.assign({}, BODY(), { reqId: 'b'.repeat(32) }));
    t('I 新しい番号なら新しい保存先へ送る', y.d.ok === true && b.invokes.length === 1);
    ref.m = 'shadow'; b.w.SUStf._forgetMode();
    const z = await b.send(Object.assign({}, BODY(), { reqId: 'b'.repeat(32) }));
    t('I 新しい保存先へ送った番号を、戻した後に Google へ送り直す → 断る', z.d.ok === false && b.gas() === 1, z);
    const u = await b.send(Object.assign({}, BODY(), { reqId: 'b'.repeat(32), action: 'list' }));
    t('I 番号の覚えはこのページの間だけ（端末に書かない）', b.writes.length === 0 && u.d.ok === false);
  }
  {
    const b = box({ flags: { staff: true }, mode: 'live' });
    const body = BODY();
    await b.send(Object.assign({}, body));
    const x = await b.send(Object.assign({}, body));
    t('I 同じ道への送り直し（同じ番号）はそのまま送る（受け口が1回目の答えを返す）', x.d.ok === true && b.invokes.length === 2);
  }
  {
    const b = box({ flags: { staff: true }, mode: 'live', reply: (n) => Promise.resolve(n === 1 ? { data: null, error: { name: 'FunctionsHttpError', context: { json: async () => ({ error: '切り替える前です', code: 'shadow' }) } } } : { data: { ok: true }, error: null }) });
    const x = await b.send(BODY());
    t('I 受け口が「写しの期間」と断った番号（どこにも書いていない）は Google へ送れる', x.d.via === 'gas' && b.gas() === 1, x);
  }
  console.log('H 端末に書かない');
  {
    const b = box({ flags: { staff: true }, mode: 'live' });
    await b.send(BODY());
    t('H localStorage へ書かない', b.writes.length === 0 && !/setItem|sessionStorage/.test(SRC));
    t('H 読み込み済みなら二重に動かさない', /if \(root\.SUStf\) return;/.test(SRC));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
