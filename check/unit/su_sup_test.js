/* 消耗品管理（備品）の保存先の切り替えの入口（su-sup.js・統合 0047・2026-11-02）の試験。架空データのみ。
   守ること:
     A スイッチ supplies が切・無い時は、Google へ送る関数をそのまま呼ぶ（データベースも受け口も呼ばない）
     B スイッチが入でも、印が写しの期間・0047 の前（関数が無い）は Google
     C 印が「切り替えた後」なら受け口 sup-write へ送り、Google を呼ばない。合言葉 token・証明 accessToken は送らない。答えは fetch と同じ形。
       現場の端末も新しい保存先へ送る（入出庫を記録するため・職員マスタと違う所）。読み取りも新しい保存先から
     D スイッチが入の時、ログインしていない・使えないアカウント・印を確かめられない・受け口の断り（入りきらない を含む）は Google へ流さず、
       消耗品管理の GAS と同じ形 {ok:false, error:種類, hint:文} で返す
     E 受け口に届かない・時間切れは送信の失敗（AbortError）にする（画面が「書けたか分からない」として扱う）
     F 受け口が「写しの期間」と答えたら、印を捨てて Google へ送る。Google が「切り替えた後」と断ったら印を捨てる
     G 画面からは写し返しを頼まない（1時間ごとの自動に任せる）
     H 端末に書かない・二重に動かさない
     S 画面（supplies.html）: 送信を SUSup に通し、Google へ送る関数は今までの fetch(cfg.url, opt) のまま。断りの種類を職員向けの言葉にする
   実行: node check/unit/su_sup_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-sup.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'supplies.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }
const GAS = 'https://script.google.com/macros/s/EXAMPLE_SUPPLIES/exec';

function box(o) {
  o = o || {};
  const store = { su_backend_flags: JSON.stringify({ supabase: o.flags || {} }) };
  if (o.field) store.su_device_role = 'field';
  const writes = [], invokes = [], rpcs = [], fetches = [];
  const A = {
    STATUS: { OK: 'ok' },
    check: async () => (o.signedOut ? { status: 'signed_out' } : o.forbidden ? { status: 'forbidden' } : { status: 'ok', role: o.role || 'office' }),
    client: () => ({
      rpc: async (n) => { rpcs.push(n); if (o.modeErr) return { error: o.modeErr }; return { data: { ok: true, mode: (o.modeRef ? o.modeRef.m : o.mode) || 'shadow', version: 3 } }; },
      functions: { invoke: (fn, opt) => { invokes.push({ fn, body: JSON.parse(JSON.stringify(opt.body)) }); return typeof o.reply === 'function' ? o.reply(invokes.length) : Promise.resolve(o.reply || { data: { ok: true, rows: [] }, error: null }); } },
      auth: { getSession: async () => ({ data: { session: { access_token: 'h.p.s' } } }) }
    })
  };
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) },
    fetch: (url, init) => {
      fetches.push({ url, init });
      if (/su-backend\.json/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    },
    SUAuth: A, setTimeout, clearTimeout, Promise, JSON, Object, Error, String, Number, Date
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(SRC, w);
  let gasCalls = 0;
  const gasText = o.gasText || '{"ok":true,"via":"gas"}';
  const gasSend = () => { gasCalls++; return Promise.resolve({ ok: true, status: 200, text: async () => gasText, clone() { return { text: async () => gasText }; } }); };
  const send = async (body, opts) => {
    try { const r = await w.SUSup.send(body, gasSend, Object.assign({ screen: 'supplies' }, opts || {})); return { r, d: JSON.parse(await r.text()) }; }
    catch (e) { return { e }; }
  };
  return { w, send, writes, invokes, rpcs, fetches, gas: () => gasCalls };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const BODY = () => ({ action: 'addMoves', token: 'tok-supplies', by: '見本', accessToken: 'h.p.s', moves: [{ id: 'mv_0001', itemId: 'I0001', qty: 1, date: '2026-11-02' }] });

(async () => {
  console.log('A Google のまま');
  for (const [label, o] of [['スイッチが無い', {}], ['スイッチが切', { flags: { supplies: false } }], ['ほかのスイッチだけ入', { flags: { staff: true }, mode: 'live' }]]) {
    const b = box(o);
    const x = await b.send(BODY());
    t('A ' + label + ' → Google へ1回・受け口もデータベースも呼ばない', x.d && x.d.via === 'gas' && b.gas() === 1 && b.invokes.length === 0 && b.rpcs.length === 0, [x, b.rpcs]);
  }
  console.log('B 写しの期間');
  {
    const b = box({ flags: { supplies: true }, mode: 'shadow' });
    const x = await b.send(BODY());
    t('B 印が写しの期間 → Google', x.d.via === 'gas' && b.invokes.length === 0 && b.rpcs.join() === 'sup_mode_get');
    const b2 = box({ flags: { supplies: true }, modeErr: { code: 'PGRST202' } });
    const x2 = await b2.send(BODY());
    t('B 0047 の前（関数が無い）→ Google', x2.d.via === 'gas' && b2.invokes.length === 0);
  }
  console.log('C 切り替えた後');
  {
    const b = box({ flags: { supplies: true }, mode: 'live' });
    const x = await b.send(BODY());
    t('C 受け口 sup-write へ送り、Google を呼ばない', b.invokes.length === 1 && b.invokes[0].fn === 'sup-write' && b.gas() === 0, b.invokes);
    t('C 合言葉と証明は送らない・ほかの本文はそのまま', !('token' in b.invokes[0].body) && !('accessToken' in b.invokes[0].body) && b.invokes[0].body.moves[0].id === 'mv_0001' && b.invokes[0].body.action === 'addMoves');
    t('C 答えは fetch と同じ形（ok・status・text）', x.r.ok === true && x.r.status === 200 && x.d.ok === true);
    const x2 = await b.send({ action: 'list', token: 't' });
    t('C 読み取りも新しい保存先から・印は1分覚える', b.invokes.length === 2 && b.invokes[1].body.action === 'list' && b.rpcs.filter(n => n === 'sup_mode_get').length === 1 && x2.d.ok === true);
    const f = box({ flags: { supplies: true }, mode: 'live', field: true, role: 'field' });
    const y = await f.send(BODY());
    t('C 現場の端末も新しい保存先へ送る（入出庫の記録）', y.d.ok === true && f.invokes.length === 1 && f.gas() === 0);
  }
  console.log('D Google へ流さない断り');
  for (const [label, o, code, re] of [['ログインしていない', { signedOut: true }, 'login', /ログインしていません/], ['使えないアカウント', { forbidden: true }, 'role', /使えません/],
    ['印を確かめられない', { modeErr: { code: '500', message: 'x' } }, 'mode', /確かめられませんでした/], ['印の口で断られた', { modeErr: { code: '42501' } }, 'role', /使えません/]]) {
    const b = box(Object.assign({ flags: { supplies: true }, mode: 'live' }, o));
    const x = await b.send(BODY());
    t('D ' + label + ' → {ok:false, error:' + code + ', hint}・Google も受け口も呼ばない', x.d && x.d.ok === false && x.d.error === code && re.test(x.d.hint) && b.gas() === 0 && b.invokes.length === 0, x);
  }
  {
    const b = box({ flags: { supplies: true }, mode: 'live', field: true, signedOut: true });
    const x = await b.send(BODY());
    t('D 現場の端末でもログインしていなければ断る（Google へ流さない）', x.d.ok === false && x.d.error === 'login' && b.gas() === 0);
  }
  for (const [code, hint] of [['toolarge', '記録が多くなり、新しい保存先に入りきらなくなりました。この保存は入っていません。管理者へ連絡してください'], ['role', 'このアカウントでは消耗品管理を使えません'], ['action', 'この操作は新しい保存先では受け付けていません']]) {
    const b = box({ flags: { supplies: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsHttpError', context: { json: async () => ({ ok: false, error: code, hint, code }) } } } });
    const x = await b.send(BODY());
    t('D 受け口の断り（' + code + '）は GAS と同じ形（ok:false・種類・文）で返し、Google へ流さない', x.d.ok === false && x.d.error === code && x.d.hint === hint && b.gas() === 0, x);
  }
  {
    const b = box({ flags: { supplies: true }, mode: 'live', reply: { data: null, error: null } });
    const x = await b.send(BODY());
    t('D 受け口の応答が空 → ok:false（確かめるよう案内）', x.d.ok === false && /確かめて/.test(x.d.hint) && b.gas() === 0);
  }
  console.log('E 届かない・時間切れ');
  {
    const b = box({ flags: { supplies: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } } });
    const x = await b.send(BODY());
    t('E 届かない → 送信の失敗（Google へ流さない）', x.e && b.gas() === 0, x);
    const b2 = box({ flags: { supplies: true }, mode: 'live', reply: () => new Promise(() => {}) });
    const x2 = await b2.send(BODY(), { timeoutMs: 20 });
    t('E 時間切れ → AbortError（画面が「書けたか分からない」として扱う）', x2.e && x2.e.name === 'AbortError' && b2.gas() === 0, x2);
  }
  console.log('F 写しの期間へ戻っていた・Google が切り替えた後と断った');
  {
    const b = box({ flags: { supplies: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsHttpError', context: { json: async () => ({ ok: false, error: 'shadow', hint: '切り替える前です', code: 'shadow' }) } } } });
    const x = await b.send(BODY());
    t('F 受け口が「写しの期間」→ Google へ送る', x.d.via === 'gas' && b.gas() === 1);
    await b.send({ action: 'list', token: 't' });
    t('F 印を捨てて読み直す', b.rpcs.filter(n => n === 'sup_mode_get').length === 2);
    const ref = { m: 'shadow' };
    const b2 = box({ flags: { supplies: true }, modeRef: ref, gasText: '{"ok":false,"error":"sup_switched","hint":"切り替えた後です"}' });
    const y = await b2.send(BODY()); await tick(); await tick();
    ref.m = 'live';
    await b2.send(BODY());
    t('F Google の「切り替えた後」の断りはそのまま返し、覚えた印を捨てて次は新しい保存先へ', y.d.error === 'sup_switched' && b2.rpcs.filter(n => n === 'sup_mode_get').length === 2 && b2.invokes.length === 1, b2.rpcs);
  }
  console.log('G 写し返しを頼まない');
  {
    const b = box({ flags: { supplies: true }, mode: 'live' });
    await b.send(BODY()); await tick(); await tick(); await tick();
    t('G 書けた後も Google へは何も送らない（1時間ごとの自動に任せる）', b.fetches.filter(f => !/su-backend\.json/.test(f.url)).length === 0 && !/supMirror/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  }
  console.log('H 端末に書かない');
  {
    const b = box({ flags: { supplies: true }, mode: 'live' });
    await b.send(BODY());
    t('H localStorage へ書かない', b.writes.length === 0 && !/setItem|sessionStorage/.test(SRC));
    t('H 読み込み済みなら二重に動かさない', /if \(root\.SUSup\) return;/.test(SRC));
  }
  console.log('S 画面（supplies.html）');
  {
    t('S su-sup.js を読む（版の印つき・画面の処理より前）', /<script src="su-sup\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/.test(PAGE) && PAGE.indexOf('su-sup.js?v=') < PAGE.indexOf('function apiPost('));
    const m = /function send\(\) \{([\s\S]*?)\n  \}/.exec(PAGE);
    t('S 送信は SUSup に通し、Google へ送る関数は今までの fetch(cfg.url, opt) のまま', !!m && /window\.SUSup\.send\(payload, function \(\) \{ return fetch\(cfg\.url, opt\); \}/.test(m[1]) && /\n    return fetch\(cfg\.url, opt\);$/.test(m[1]), m && m[1]);
    t('S Google への本文・送り方は変えない（POST・redirect follow・本文は JSON の文字）', /var opt = \{ method: 'POST', body: JSON\.stringify\(payload\), redirect: 'follow' \};/.test(PAGE));
    const errText = /var ERR_TEXT = \{([\s\S]*?)\n\};/.exec(PAGE)[1];
    t('S 断りの種類を職員向けの言葉にする（入りきらない・ログイン・切り替えた後 など）', ['toolarge', 'login', 'role', 'noauth', 'mode', 'db', 'sup_switched', 'badrow'].every(k => new RegExp('\\b' + k + ': \'').test(errText)));
    t('S 不具合を報告のボタンは今までどおり', /<script src="su-report\.js\?v=[^"]+" data-tool="消耗品管理"><\/script>\s*<\/body>/.test(PAGE));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
