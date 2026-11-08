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
     H 端末に書くのはスイッチの控え（su_backend_flags・su-kv.js と同じ）だけ・二重に動かさない
     R 反証レビュー 1回（指摘10件）: ログインしていない端末は印が分からないので Google（切り替えた後は Google の断りを「ログインして」に置き換える）／
       ログインの状態ごとの扱い（denied・error・2段階認証がまだ・確かめが失敗）／送る前の時間切れは通信の失敗（AbortError にしない）／
       読み取りの前は印を読み直す／ログインの部品は1回だけ読み込む／入口の 401 はログイン／forbidden は合言葉の話を出さない
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
    STATUS: { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' },
    check: () => (o.checkHang ? new Promise(() => {}) : o.checkReject ? Promise.reject(new Error('x')) : Promise.resolve(o.signedOut ? { status: 'signed_out' } : o.status ? { status: o.status } : { status: 'ok', role: o.role || 'office' })),
    client: () => ({
      rpc: async (n) => { rpcs.push(n); if (o.modeErr) return { error: o.modeErr }; return { data: { ok: true, mode: (o.modeRef ? o.modeRef.m : o.mode) || 'shadow', version: 3 } }; },
      functions: { invoke: (fn, opt) => { invokes.push({ fn, body: JSON.parse(JSON.stringify(opt.body)) }); return typeof o.reply === 'function' ? o.reply(invokes.length) : Promise.resolve(o.reply || { data: { ok: true, rows: [] }, error: null }); } },
      auth: { getSession: async () => ({ data: { session: { access_token: 'h.p.s' } } }) }
    })
  };
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); if (o.lsKeep) store[k] = v; }, removeItem: (k) => writes.push(k) },
    fetch: (url, init) => {
      fetches.push({ url, init });
      if (/su-backend\.json/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    },
    setTimeout, clearTimeout, Promise, JSON, Object, Error, String, Number, Date, Math
  };
  if (o.noAuthYet) {
    w.supabase = {};
    w.document = { head: { appendChild: (sc) => { (o.scripts = o.scripts || []).push(sc.src); setTimeout(() => { w.SUAuth = A; sc.onload(); }, 5); } }, createElement: () => ({}) };
  } else w.SUAuth = A;
  if (o.flagsFail) w.fetch = (url, init) => { fetches.push({ url, init }); return Promise.reject(new Error('offline')); };
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
    await b.send(BODY());
    t('C 読み取りも新しい保存先から（読み取りは印を読み直す）・書き込みは印を1分覚える', b.invokes.length === 3 && b.invokes[1].body.action === 'list' && b.rpcs.filter(n => n === 'sup_mode_get').length === 2 && x2.d.ok === true, b.rpcs);
    const f = box({ flags: { supplies: true }, mode: 'live', field: true, role: 'field' });
    const y = await f.send(BODY());
    t('C 現場の端末も新しい保存先へ送る（入出庫の記録）', y.d.ok === true && f.invokes.length === 1 && f.gas() === 0);
  }
  console.log('D Google へ流さない断り');
  for (const [label, o, code, re] of [['使えないアカウント（denied）', { status: 'denied' }, 'role', /使えません/], ['ログインを確かめられない（error）', { status: 'error' }, 'mode', /確かめられませんでした/],
    ['ログインの確かめが失敗（例外）', { checkReject: true }, 'mode', /確かめられませんでした/],
    ['印を確かめられない', { modeErr: { code: '500', message: 'x' } }, 'mode', /確かめられませんでした/], ['印の口で断られた', { modeErr: { code: '42501' } }, 'role', /使えません/]]) {
    const b = box(Object.assign({ flags: { supplies: true }, mode: 'live' }, o));
    const x = await b.send(BODY());
    t('D ' + label + ' → {ok:false, error:' + code + ', hint}・Google も受け口も呼ばない', x.d && x.d.ok === false && x.d.error === code && re.test(x.d.hint) && b.gas() === 0 && b.invokes.length === 0, x);
  }
  console.log('R1 ログインしていない端末');
  {
    const b = box({ flags: { supplies: true }, mode: 'shadow', field: true, signedOut: true });
    const x = await b.send(BODY());
    t('R1 スイッチが入っただけ（写しの期間）→ 今までどおり Google へ送る（「切り替わっています」と言わない）', x.d.via === 'gas' && b.gas() === 1 && b.invokes.length === 0 && b.rpcs.length === 0, x);
    const b2 = box({ flags: { supplies: true }, signedOut: true, gasText: '{"ok":false,"error":"sup_switched","hint":"切り替えた後です"}' });
    const y = await b2.send(BODY());
    t('R1 切り替えた後（Google が sup_switched で断った）→ 「ログインしていません」に置き換える', y.d.ok === false && y.d.error === 'login' && /ログインしていません/.test(y.d.hint) && b2.invokes.length === 0, y);
    const z = await b2.send(BODY());
    t('R1 切り替えた後と分かった後は、Google へ送らずに「ログインして」と断る', z.d.error === 'login' && b2.gas() === 1, [z, b2.gas()]);
  }
  console.log('R2 2段階認証がまだ');
  for (const st of ['mfa_verify', 'mfa_enroll']) {
    const b = box({ flags: { supplies: true }, mode: 'live', status: st });
    const x = await b.send(BODY());
    t('R2 ' + st + ' → ログインしているとみなし、受け口に任せる', x.d.ok === true && b.invokes.length === 1);
    const b2 = box({ flags: { supplies: true }, mode: 'live', status: st, reply: { data: null, error: { name: 'FunctionsHttpError', context: { status: 403, json: async () => ({ ok: false, error: 'role', hint: 'このアカウントでは消耗品管理を使えません', code: 'role' }) } } } });
    const y = await b2.send(BODY());
    t('R2 ' + st + ' で受け口に断られた → 「2段階認証を済ませてください」', y.d.ok === false && y.d.error === 'mfa' && /2段階認証を済ませてください/.test(y.d.hint), y);
    const b3 = box({ flags: { supplies: true }, status: st, modeErr: { code: '42501' } });
    const z = await b3.send(BODY());
    t('R2 ' + st + ' で印の口に断られた → 「2段階認証を済ませてください」', z.d.error === 'mfa' && b3.gas() === 0);
  }
  console.log('R4 送る前の時間切れ');
  {
    const b = box({ flags: { supplies: true }, mode: 'live', checkHang: true });
    const x = await b.send(BODY(), { timeoutMs: 30 });
    t('R4 送る前に時間が切れた → 通信の失敗（AbortError ではない＝「入っていることがある」と言わない）・何も送らない', x.e && x.e.name !== 'AbortError' && b.gas() === 0 && b.invokes.length === 0, x);
  }
  console.log('R6 読み取りの前は印を読み直す・スイッチの控え');
  {
    const ref = { m: 'shadow' };
    const b = box({ flags: { supplies: true }, modeRef: ref });
    await b.send({ action: 'list', token: 't' });
    ref.m = 'live';
    const x = await b.send({ action: 'list', token: 't' });
    t('R6 1分以内でも、読み取りは印を読み直す（切り替えた直後に Google から読まない）', x.d.ok === true && b.invokes.length === 1 && b.rpcs.filter(n => n === 'sup_mode_get').length === 2);
    const b2 = box({ flags: { supplies: true }, mode: 'live' });
    await b2.send(BODY());
    t('R6 su-backend.json を読めたら、su-kv.js と同じ控え（su_backend_flags）に残す', JSON.stringify(b2.writes) === '["su_backend_flags"]', b2.writes);
    const b3 = box({ flags: { supplies: true }, mode: 'live', flagsFail: true });
    const y = await b3.send(BODY());
    t('R6 su-backend.json を読めない時は、最後に読めた控えのスイッチを使う', y.d.ok === true && b3.invokes.length === 1 && b3.writes.length === 0);
  }
  console.log('R8 ログインの部品は1回だけ読み込む');
  {
    const o = { flags: { supplies: true }, mode: 'live', noAuthYet: true };
    const b = box(o);
    const [x, y] = await Promise.all([b.send(BODY()), b.send({ action: 'list', token: 't' })]);
    t('R8 同時に2回送っても、su-auth.js は1本だけ足す', (o.scripts || []).length === 1 && /su-auth\.js/.test(o.scripts[0]) && x.d.ok === true && y.d.ok === true, o.scripts);
  }
  console.log('R9 入口の 401・R7 forbidden');
  {
    const b = box({ flags: { supplies: true }, mode: 'live', reply: { data: null, error: { name: 'FunctionsHttpError', context: { status: 401, json: async () => ({ code: 401, message: 'Invalid JWT' }) } } } });
    const x = await b.send(BODY());
    t('R9 受け口の入口がログインの証明を断った（401）→ ログインの断り（通信の失敗にしない）', x.d && x.d.ok === false && x.d.error === 'login' && b.gas() === 0, x);
    const b2 = box({ flags: { supplies: true }, mode: 'live', role: 'field', reply: { data: { ok: false, error: 'forbidden', hint: 'この操作には管理者の合言葉が必要です' }, error: null } });
    const y = await b2.send({ action: 'saveItem', token: 't', item: {} });
    t('R7 切り替えた後の forbidden は、合言葉の話を出さずにログインの役割の話にする', y.d.error === 'forbidden' && !/合言葉/.test(y.d.hint) && /事務所か管理者のアカウント/.test(y.d.hint), y);
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
    t('H 端末に書くのはスイッチの控えだけ（sessionStorage も使わない）', b.writes.every(k => k === 'su_backend_flags') && (SRC.match(/setItem\(/g) || []).length === 1 && /setItem\(FLAGS_LS,/.test(SRC) && !/sessionStorage/.test(SRC));
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
    t('S 新しい保存先で確定できたか分からない（db）時も、明細に「古い」印を付ける', /\(d\.error === 'flush_fail' \|\| d\.error === 'db'\) && MOVE_WRITERS\.indexOf\(action\) >= 0\) markBillStale\(\)/.test(PAGE));
    t('S 2段階認証の断りの言葉がある', /\bmfa: '2段階認証が済んでいません'/.test(PAGE));
    t('S 不具合を報告のボタンは今までどおり', /<script src="su-report\.js\?v=[^"]+" data-tool="消耗品管理"><\/script>\s*<\/body>/.test(PAGE));
  }
  console.log('L ログインだけで使える（接続先・合言葉の無い端末・2026-11-08 代表者「端末ごとの設定を極限までなくす」）');
  {
    const cases = [
      ['スイッチが入・ログイン OK・印が切り替えた後', { flags: { supplies: true }, mode: 'live' }, true],
      ['スイッチが切', { flags: { supplies: false }, mode: 'live' }, false],
      ['写しの期間', { flags: { supplies: true }, mode: 'shadow' }, false],
      ['ログインしていない', { flags: { supplies: true }, mode: 'live', signedOut: true }, false],
      ['2段階認証がまだ', { flags: { supplies: true }, mode: 'live', status: 'mfa_verify' }, false],
      ['使えないアカウント', { flags: { supplies: true }, mode: 'live', status: 'denied' }, false],
      ['ログインの確かめが失敗', { flags: { supplies: true }, mode: 'live', checkReject: true }, false],
      ['印を読めない', { flags: { supplies: true }, mode: 'live', modeErr: { code: 'XX000' } }, false],
      ['スイッチを読めない（控えも無い）', { flagsFail: true, mode: 'live' }, false]
    ];
    for (const [label, o, want] of cases) {
      const b = box(o);
      let v, threw = false;
      try { v = await b.w.SUSup.liveReady(); } catch (e) { threw = true; }
      t('L ' + label + ' → ' + want + '（例外を出さない・受け口も Google も呼ばない・端末にはスイッチの控えしか書かない）',
        !threw && v === want && b.invokes.length === 0 && b.gas() === 0 && b.writes.every(k => k === 'su_backend_flags'), { v, threw });
    }
    t('L 画面: 接続先・合言葉が無くても ST.live の時だけ受け口へ送る（それ以外は今までと同じ断り）',
      /if \(noCfg && !\(ST\.live === true && typeof window !== 'undefined' && window\.SUSup\)\) return Promise\.reject\(noCfg\);/.test(PAGE)
      && /if \(noCfg\) return window\.SUSup\.send\(payload, function \(\) \{ return Promise\.reject\(noCfg\); \}/.test(PAGE));
    t('L 画面: 接続先が無い時は Google へ送らない（fetch(cfg.url) を呼ぶ前に noCfg で分ける）',
      PAGE.indexOf('if (noCfg) return window.SUSup.send(') < PAGE.indexOf('return window.SUSup.send(payload, function () { return fetch(cfg.url, opt); }'));
    t('L 画面: 使えるかの確かめは一覧の読み込みで1回だけ（ST.liveTried）・使える時だけ cfgReady が通る',
      /function cfgReady\(\) \{ var c = loadCfg\(\); return \(URL_OK_RE\.test\(c\.url\) && !!c\.token\) \|\| ST\.live === true; \}/.test(PAGE)
      && /if \(!cfgReady\(\) && !ST\.liveTried\) \{\s*ST\.liveTried = true;\s*return probeLive\(\)/.test(PAGE));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
