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
  const store = o.flagsFail ? {} : { su_backend_flags: JSON.stringify({ supabase: o.flags || {} }) };
  if (o.field) store.su_device_role = 'field';
  const writes = [], invokes = [], rpcs = [], fetches = [];
  const A = {
    STATUS: { OK: 'ok' },
    check: async () => { if (o.checkReject) throw new Error('net'); return (o.signedOut ? { status: 'signed_out' } : o.forbidden ? { status: 'forbidden' } : o.status ? { status: o.status } : { status: 'ok', role: o.role || 'office' }); },
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
      if (/su-backend\.json/.test(url)) return o.flagsFail ? Promise.reject(new Error('net')) : Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) });
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
  console.log('L ログインだけで使える（接続先・合言葉の無い端末・2026-11-08 代表者「端末ごとの設定を極限までなくす」）');
  {
    const cases = [
      ['スイッチが入・ログイン OK（事務所）・印が切り替えた後', { flags: { staff: true }, mode: 'live' }, true],
      ['管理者のアカウント', { flags: { staff: true }, mode: 'live', role: 'admin' }, true],
      ['スイッチが切', { flags: { staff: false }, mode: 'live' }, false],
      ['スイッチが無い', { mode: 'live' }, false],
      ['写しの期間', { flags: { staff: true }, mode: 'shadow' }, false],
      ['0045 の前（印の関数が無い）', { flags: { staff: true }, modeErr: { code: 'PGRST202' } }, false],
      ['印の口で断られた', { flags: { staff: true }, modeErr: { code: '42501' } }, false],
      ['印を読めない', { flags: { staff: true }, modeErr: { code: 'XX000' } }, false],
      ['現場の端末', { flags: { staff: true }, mode: 'live', field: true }, false],
      ['現場のアカウント', { flags: { staff: true }, mode: 'live', role: 'field' }, false],
      ['ログインしていない', { flags: { staff: true }, mode: 'live', signedOut: true }, false],
      ['2段階認証がまだ', { flags: { staff: true }, mode: 'live', status: 'mfa_verify' }, false],
      ['使えないアカウント', { flags: { staff: true }, mode: 'live', status: 'denied' }, false],
      ['ログインの確かめが失敗', { flags: { staff: true }, mode: 'live', checkReject: true }, false],
      ['スイッチを読めない（控えも無い）', { flagsFail: true, mode: 'live' }, false]
    ];
    for (const [label, o, want] of cases) {
      const b = box(o);
      let v, threw = false;
      try { v = await b.w.SUStf.liveReady(); } catch (e) { threw = true; }
      t('L ' + label + ' → ' + want + '（例外を出さない・受け口も Google も呼ばない・端末に書かない）',
        !threw && v === want && b.invokes.length === 0 && b.gas() === 0 && b.writes.length === 0 && b.fetches.every(f => /su-backend\.json/.test(f.url)), { v, threw, inv: b.invokes.length, w: b.writes });
    }
    {
      const b = box({ flags: { staff: true }, mode: 'live', reply: () => new Promise(() => {}) });
      b.w.SUAuth.check = () => new Promise(() => {});
      const st = Date.now();
      const v = await b.w.SUStf.liveReady();
      t('L 答えが来ない時は8秒で false（待ち続けない）', v === false && Date.now() - st >= 7900 && Date.now() - st < 9500, Date.now() - st);
    }
    {
      const b = box({ flags: { staff: true }, mode: 'live' });
      await b.w.SUStf.liveReady();
      let gasN = 0;
      const r = await b.w.SUStf.send({ action: 'list', token: '' }, () => { gasN++; return Promise.reject(new Error('nocfg')); }, { screen: 'staff-master', url: '' });
      const d = JSON.parse(await r.text());
      await tick(); await tick();
      t('L 使える時は接続先なしで受け口へ送れる（Google へ送る関数は呼ばない・写し返しは頼まない）', d.ok === true && b.invokes.length === 1 && gasN === 0 && b.fetches.filter(f => !/su-backend\.json/.test(f.url)).length === 0, d);
    }
  }
  console.log('L 画面の分け方（静的な確かめ）');
  {
    /* 職員マスタの画面のスクリプトは 2026-11-12 に staff-master.js へ移した。読み込みの札をその中身に戻し、移す前と同じ文字で確かめる */
    const stfmPage_ = (h) => h.replace(/<script src="staff-master\.js\?v=[^"]*"><\/script>/, () => '<script>\n' + fs.readFileSync(path.join(__dirname, '..', '..', 'staff-master.js'), 'utf8') + '</script>');
    const PAGE = stfmPage_(fs.readFileSync(path.join(__dirname, '..', '..', 'staff-master.html'), 'utf8'));
    const ATS = fs.readFileSync(path.join(__dirname, '..', '..', 'ats.html'), 'utf8');
    t('L 職員マスタ: 部品の版は2画面でそろう', /su-stf\.js\?v=2026-11-08"/.test(PAGE) && /su-stf\.js\?v=2026-11-08"/.test(ATS));
    t('L 職員マスタ: 接続先・合言葉が無くても ST.live の時だけ受け口へ送る（それ以外は今までと同じ断り）',
      /if \(noCfg && !\(ST\.live === true && window\.SUStf\)\) return Promise\.reject\(noCfg\);/.test(PAGE)
      && /if \(noCfg\) return window\.SUStf\.send\(p, function \(\) \{ return Promise\.reject\(noCfg\); \}, \{ screen: 'staff-master', url: ''/.test(PAGE));
    t('L 職員マスタ: 接続先が無い時は Google へ送らない（fetch(cfg.url) の前に noCfg で分ける）',
      PAGE.indexOf("if (noCfg) return window.SUStf.send(p,") > 0 && PAGE.indexOf("if (noCfg) return window.SUStf.send(p,") < PAGE.indexOf("if (window.SUStf) return window.SUStf.send(p, function () { return fetch(cfg.url, opt); }"));
    t('L 職員マスタ: 送れるかは cfgReady（接続先と合言葉、または ST.live）で見る',
      /function cfgReady\(\) \{ var c = loadCfg\(\); return \(URL_OK_RE\.test\(c\.url\) && !!c\.token\) \|\| ST\.live === true; \}/.test(PAGE));
    const fnBody = (src, name) => { const i = src.indexOf('function ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i)); };
    t('L 職員マスタ: corpWhy は接続先と合言葉、または ST.live で見る', /if \(\(!URL_OK_RE\.test\(cfg\.url\) \|\| !cfg\.token\) && ST\.live !== true\) return '接続先URLと合言葉を入れて保存してください';/.test(fnBody(PAGE, 'corpWhy')));
    t('L 職員マスタ: 初回の案内は、ログインだけで使える端末（ST.live）では始めない', /if \(\(URL_OK_RE\.test\(cfg\.url\) && cfg\.token\) \|\| ST\.live === true\) return false;/.test(fnBody(PAGE, 'startWizIfNew')));
    for (const fn of ['loadList', 'loadEnums', 'loadCorp', 'loadCommittees', 'cmtWhyNoEdit', 'updateEnumBtn']) {
      const b = fnBody(PAGE, fn);
      t('L 職員マスタ: ' + fn + ' は cfgReady で見る（接続先だけの確かめを残さない）', /cfgReady\(\)/.test(b) && !/URL_OK_RE\.test\(cfg\.url\) \|\| !cfg\.token/.test(b), b.slice(0, 200));
    }
    t('L 職員マスタ: 使えるかの確かめは起動の時に1回だけ（ST.liveTried）・その後に読み込む',
      /if \(!cfgReady\(\) && !ST\.liveTried\) \{\s*ST\.liveTried = true;[\s\S]{0,120}probeLive\(\)\.then\(startLoads_, startLoads_\);\s*\} else startLoads_\(\);/.test(PAGE));
    const ping = fnBody(PAGE, 'pingNow_');
    t('L 職員マスタ: 疎通確認は、接続先があれば今までどおり Google（apiPing）・無ければ ST.live の時だけ受け口・どちらでもなければ呼ばない',
      /if \(URL_OK_RE\.test\(loadCfg\(\)\.url\)\) return apiPing\(\);\s*if \(ST\.live === true\) return apiPost\('ping', \{\}\);\s*return null;/.test(ping));
    t('L 職員マスタ: apiPing（Google への GET）は変えていない', /function apiPing\(\) \{\n  var cfg = loadCfg\(\);\n  if \(!URL_OK_RE\.test\(cfg\.url\)\) \{/.test(PAGE));
    t('L 職員マスタ: ログインだけの端末に初回の案内（接続先の入力）を出さない',
      /var on = lsGet\(UI_KEYS\.wiz\) === '1' && ST\.live !== true;/.test(PAGE));
    t('L 職員マスタ: 書類は、ログインだけの端末では書類の正本も新しい保存先の時だけ押せる',
      /\(!URL_OK_RE\.test\(cfg\.url\) \|\| !cfg\.token\) && !\(ST\.live === true && window\.SUDocLive && window\.SUDocLive\.liveNow\('stf'\)\)/.test(PAGE));
    t('L 採用管理: 接続先が無くても stfLive の時だけ受け口へ送る（Google へ送る関数は断るだけ）',
      /if\(noCfg&&!\(stfLive===true&&window\.SUStf\)\) return Promise\.reject\(\{nocfg:true\}\);/.test(ATS)
      && /if\(noCfg\) return window\.SUStf\.send\(b,function\(\)\{ return Promise\.reject\(\{nocfg:true\}\); \},\{screen:'ats',url:''/.test(ATS)
      && ATS.indexOf('if(noCfg) return window.SUStf.send(b,') < ATS.indexOf("if(window.SUStf) return window.SUStf.send(b,function(){ return fetch(cfg.url,opt); }"));
    t('L 採用管理: 送れるかは接続先と合言葉、または stfLive・確かめは1回だけ',
      /function stfReady_\(\)\{ return stfCfgSet_\(\)\|\|stfLive===true; \}/.test(ATS) && /if\(stfReady_\(\)\|\|stfLiveTried\) return Promise\.resolve\(stfReady_\(\)\);/.test(ATS));
    t('L 採用管理: 「接続先が見つかりません」の断りは受け口の後でもそのまま伝える（届かないと取り違えない）', /if\(e&&\(e\.noAnswer\|\|e\.nocfg\)\) throw e;/.test(ATS));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
