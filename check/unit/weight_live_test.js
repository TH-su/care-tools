/* 体重管理の保存先の切り替え（su-weight-live.js・統合 0032）の試験（2026-10-28 新設）
   実行: node check/unit/weight_live_test.js
   対象を差し替える（壊した版で落ちることを確かめる）:
     WEIGHT_LIVE_JS=/tmp/変異版.js node check/unit/weight_live_test.js
     WEIGHT_HTML=/tmp/変異版.html  WEIGHT_SHADOW_JS=/tmp/変異版.js も同じ

   守ること:
     A スイッチ（su-backend.json の supabase.weight）が切・無い・読めない時は、読む・書くとも null（＝今までどおり Google）。
       データベースもログインの部品も呼ばない
     B スイッチが入でも、データベースが写しの期間（'shadow'）・関数がまだ無い（PGRST202・42883）時は null（Google）
     C スイッチが入でログインの控えが無い時は、Google へ流さず「ログインしてください」の失敗（読む・書くとも）
     D 切り替え後の読み込みは GAS の getAll と同じ形（ok・ver 2・全部の行に同じ項目＝無い値は null・基準値）
     E 切り替え後の書き込みは weight_write へ送り、成功した時だけ Google への写し返しを積む。写し返しは元の書き込み（data）を
       そのまま送り、Google が受け取った時だけ外す。失敗したら残し、順番を入れ替えない
     F データベースに断られた時（権限 42501・消しすぎ・形の違い・ログインの切れ）は Google へ流さず、写し返しも積まず、
       職員向けの文で失敗を返す
     G スイッチを切った後・写しの期間に戻った後は、Google へ直接送る前に残っている写し返しを先に送る
     H 応答が来ない時は時間切れの失敗（画面の失敗の扱いへ）
     I 画面のつなぎ: apiGet・apiPost の入口だけで呼び、Google へ送る形（apiPostGas_）は前と1文字も変えていない。
       アラートの確認（alertAck）を外した入居者を送る。写しの部品は Supabase から読んだ中身を写さない
   ★本物のファイルを砂場で動かす。架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(ROOT, f), 'utf8');
const LIVE = read('WEIGHT_LIVE_JS', 'su-weight-live.js');
const PAGE = read('WEIGHT_HTML', 'weight-record.html');
const SHADOW = read('WEIGHT_SHADOW_JS', 'su-weight-shadow.js');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

const SESSION = 'sb-abcdefgh-auth-token';
/* 砂場: o.flags（supabase の中身。null＝読めない）・o.session（ログインの控え）・o.rpc(name, args)（データベースの応答）・
   o.gas(action, data)（Google の応答）・o.store（localStorage）。rpcs・gas・loads に呼ばれた記録が残る */
function box(o) {
  o = o || {};
  const store = Object.assign({}, o.store || {});
  if (o.session) store[SESSION] = '{"x":1}';
  const rpcs = [], gas = [], loads = [], fetches = [];
  const ls = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i],
    get length() { return Object.keys(store).length; }
  };
  const timers = [];
  const ctx = {
    localStorage: ls,
    document: {
      hidden: false,
      getElementsByTagName: () => [],
      createElement: () => ({}),
      head: { appendChild: s => { loads.push(s.src); setTimeout(() => { ctx.window.supabase = {}; ctx.window.SUAuth = auth; s.onload && s.onload(); }, 0); } },
      addEventListener: () => {}
    },
    fetch: (u) => {
      fetches.push(u);
      if (o.flags === null) return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: o.flags || {} }) });
    },
    setTimeout: (f, ms) => { if (ms >= 1000) { timers.push([f, ms]); return timers.length; } return setTimeout(f, 0); },
    clearTimeout: () => {},
    console, JSON, Date, Promise, Object, Array, String, Number, Math, Error
  };
  if (o.locks) ctx.navigator = { locks: { request: (name, fn) => { (b0.lockNames = b0.lockNames || []).push(name); return Promise.resolve().then(fn); } } };
  const b0 = {};
  const auth = {
    client: () => ({ rpc: (name, args) => { rpcs.push([name, JSON.parse(JSON.stringify(args))]); return Promise.resolve(o.rpc ? o.rpc(name, args) : { data: null, error: { code: 'x' } }); } })
  };
  ctx.window = ctx;
  if (o.authLoaded !== false) { ctx.window.supabase = {}; ctx.window.SUAuth = auth; }
  vm.createContext(ctx);
  vm.runInContext(LIVE, ctx);
  const post = (action, data) => { gas.push([action, JSON.parse(JSON.stringify(data))]); return Promise.resolve(o.gas ? o.gas(action, data) : { ok: true, ver: 2 }); };
  return { L: ctx.window.SUWeightLive, store, rpcs, gas, loads, fetches, post, timers, o, b0 };
}
const mirror = b => JSON.parse(b.store.wtmgr_mirror_q || '[]');
const LIVE_ALL = { ok: true, ver: 2, residents: [{ id: 'r1', name: '見本A', room: '101' }, { id: 'r2', name: '見本B', wheelchairKg: 12 }],
                   records: [{ id: 'w1', residentId: 'r1', weight: 40 }, { id: 'w2', note: 'x' }], thresholds: { m1: { warn: 2 } } };
const liveRpc = (name, args) => name === 'weight_get_all' ? { data: LIVE_ALL, error: null } : { data: { ok: true, ver: 2 }, error: null };

(async () => {
  console.log('A スイッチが切');
  for (const [lbl, fl] of [['無い', {}], ['false', { weight: false }], ['文字の "true"', { weight: 'true' }], ['読めない', null]]) {
    const b = box({ flags: fl, session: true, rpc: liveRpc });
    const g = await b.L.getAll(b.post), p = await b.L.post('saveRecord', { record: { id: 'w1' } }, { record: { id: 'w1' } }, b.post);
    t('A ' + lbl + ': 読む・書くとも null（Google）', g === null && p === null, [g, p]);
    t('A ' + lbl + ': データベースを呼ばない', b.rpcs.length === 0, b.rpcs);
    t('A ' + lbl + ': 写し返しを積まない', mirror(b).length === 0);
  }
  {
    const b = box({ flags: {}, session: true, authLoaded: false });
    await b.L.getAll(b.post); await b.L.post('delRecord', { id: 'w1' }, { id: 'w1' }, b.post);
    t('A スイッチが切ならログインの部品も読み込まない', b.loads.length === 0, b.loads);
    t('A スイッチの読み込みに ?t= を付ける', /^su-backend\.json\?t=\d+$/.test(b.fetches[0] || ''), b.fetches);
  }

  console.log('B 写しの期間・関数がまだ無い');
  for (const [lbl, rep] of [['shadow', { data: { ok: false, error: 'shadow' }, error: null }], ['PGRST202', { data: null, error: { code: 'PGRST202' } }],
                            ['42883', { data: null, error: { code: '42883' } }]]) {
    const b = box({ flags: { weight: true }, session: true, rpc: () => rep });
    const g = await b.L.getAll(b.post), p = await b.L.post('saveRecord', { record: { id: 'w1' } }, { record: { id: 'w1' } }, b.post);
    t('B ' + lbl + ': 読む・書くとも null（Google）', g === null && p === null, [g, p]);
    t('B ' + lbl + ': 写し返しを積まない・Supabase から読んだ印を付けない', mirror(b).length === 0 && !b.L.readFromSupabase());
  }

  console.log('C ログインの控えが無い');
  {
    const b = box({ flags: { weight: true }, session: false, rpc: liveRpc, authLoaded: false });
    const g = await b.L.getAll(b.post), p = await b.L.post('saveRecord', { record: { id: 'w1' } }, { record: { id: 'w1' } }, b.post);
    t('C 読むと「ログイン」の失敗（Google へ流さない）', g && /ログイン/.test(g.error || ''), g);
    t('C 書くと「ログイン」の失敗（Google へ流さない）', p && p.ok === false && /ログイン/.test(p.error || ''), p);
    t('C データベースも Google も呼ばない・部品も読まない', b.rpcs.length === 0 && b.gas.length === 0 && b.loads.length === 0);
  }

  console.log('D 切り替え後の読み込み');
  {
    const b = box({ flags: { weight: true }, session: true, rpc: liveRpc });
    const g = await b.L.getAll(b.post);
    t('D 形は GAS の getAll と同じ', g && g.ok === true && g.ver === 2 && Array.isArray(g.residents) && Array.isArray(g.records), g);
    t('D 入居者の全部の行に同じ項目（無い値は null）', JSON.stringify(g.residents) === JSON.stringify([
      { id: 'r1', name: '見本A', room: '101', wheelchairKg: null }, { id: 'r2', name: '見本B', room: null, wheelchairKg: 12 }]), g.residents);
    t('D 記録の全部の行に同じ項目', JSON.stringify(g.records[1]) === JSON.stringify({ id: 'w2', residentId: null, weight: null, note: 'x' }), g.records);
    t('D 基準値をそのまま返す', JSON.stringify(g.thresholds) === JSON.stringify({ m1: { warn: 2 } }));
    t('D 呼んだのは weight_get_all だけ', b.rpcs.length === 1 && b.rpcs[0][0] === 'weight_get_all', b.rpcs);
    t('D Supabase から読んだ印が付く（写しの部品は写さない）', b.L.readFromSupabase() === true);
    t('D 読み込みでは Google へ送らない', b.gas.length === 0);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: () => ({ data: null, error: { code: '42501' } }) });
    const g = await b.L.getAll(b.post);
    t('D 読む権限が無い時は失敗の文（Google へ流さない）', g && /保存できません/.test(g.error || '') && b.gas.length === 0, g);
  }

  console.log('E 切り替え後の書き込みと写し返し');
  {
    const b = box({ flags: { weight: true }, session: true, rpc: liveRpc });
    const data = { record: { id: 'w9', weight: 41 }, extra: 1 };
    const p = await b.L.post('saveRecord', { record: { id: 'w9', weight: 41 } }, data, b.post);
    await settle();
    t('E 成功は {ok:true, ver:2}', p && p.ok === true && p.ver === 2, p);
    t('E weight_write に操作と中身を送る', b.rpcs[0] && b.rpcs[0][0] === 'weight_write' && b.rpcs[0][1].p_action === 'saveRecord'
      && JSON.stringify(b.rpcs[0][1].p_payload) === JSON.stringify({ record: { id: 'w9', weight: 41 } }), b.rpcs);
    t('E Google へ元の書き込みをそのまま写し返す', b.gas.length === 1 && b.gas[0][0] === 'saveRecord' && JSON.stringify(b.gas[0][1]) === JSON.stringify(data), b.gas);
    t('E Google が受け取ったら送信待ちから外す', mirror(b).length === 0 && b.L.mirrorPending() === 0);
  }
  {
    let gasOk = false;
    const b = box({ flags: { weight: true }, session: true, rpc: liveRpc, gas: () => (gasOk ? { ok: true } : { ok: false, error: 'flush_fail' }) });
    await b.L.post('saveRecord', { record: { id: 'a' } }, { record: { id: 'a' } }, b.post); await settle();
    await b.L.post('delRecord', { id: 'b' }, { id: 'b' }, b.post); await settle();
    t('E Google が受け取らなければ送信待ちに残る（2件・順番どおり）', mirror(b).map(x => x.action).join() === 'saveRecord,delRecord', mirror(b));
    t('E 失敗したら先頭で止める（後ろを先に送らない）', b.gas.every(g => g[0] === 'saveRecord'), b.gas);
    t('E 送り直しの時計を掛ける', b.timers.some(x => x[1] === 60000));
    gasOk = true;
    await b.L._drainMirror(); await settle();
    t('E 受け取れるようになったら順番どおりに送って全部外す', mirror(b).length === 0 && b.gas.slice(-2).map(g => g[0]).join() === 'saveRecord,delRecord', b.gas);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: liveRpc, gas: () => { throw new Error('net'); } });
    await b.L.post('saveRecord', { record: { id: 'a' } }, { record: { id: 'a' } }, b.post); await settle();
    t('E Google への通信が例外でも書き込みは成功のまま・送信待ちに残る', mirror(b).length === 1);
  }

  console.log('F データベースに断られた時');
  for (const [lbl, rep, re] of [
    ['権限（42501）', { data: null, error: { code: '42501', message: 'not allowed' } }, /保存できません/],
    ['ログインの切れ', { data: null, error: { code: 'PGRST301', message: 'JWT expired' } }, /ログイン/],
    ['消しすぎ', { data: { ok: false, error: 'toomany' }, error: null }, /多すぎる/],
    ['形の違い', { data: { ok: false, error: 'badrow' }, error: null }, /形が正しくない/],
    ['大きすぎ', { data: { ok: false, error: 'toolarge' }, error: null }, /大きすぎる/],
    ['知らない操作', { data: { ok: false, error: 'unknown action: x' }, error: null }, /unknown action/],
    ['サーバーの不具合（500）', { data: null, error: { code: 'XX000', message: 'internal' } }, /サーバーで保存できません/]]) {
    const b = box({ flags: { weight: true }, session: true, rpc: () => rep });
    const p = await b.L.post('delRecord', { id: 'w1' }, { id: 'w1' }, b.post);
    await settle();
    t('F ' + lbl + ': 失敗を返す（職員向けの文）', p && p.ok === false && re.test(p.error || ''), p);
    t('F ' + lbl + ': Google へ流さない・写し返しも積まない', b.gas.length === 0 && mirror(b).length === 0, b.gas);
  }

  console.log('G 切った後は残りの写し返しを先に送る');
  {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { id: 'm1' } }, at: 1 }, { action: 'delRecord', data: { id: 'm2' }, at: 2 }]) };
    const b = box({ flags: {}, session: true, store });
    const p = await b.L.post('saveRecord', { record: { id: 'new' } }, { record: { id: 'new' } }, b.post);
    t('G スイッチが切: 残りを先に送ってから null（Google へ直接）', p === null && b.gas.map(g => g[0] + ':' + (g[1].id || g[1].record.id)).join() === 'saveRecord:m1,delRecord:m2', b.gas);
    t('G 送れた分は外れる', mirror(b).length === 0);
  }
  {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveThr', data: { thresholds: { m1: {} } }, at: 1 }]) };
    const b = box({ flags: { weight: true }, session: true, store, rpc: () => ({ data: { ok: false, error: 'shadow' }, error: null }) });
    const g = await b.L.getAll(b.post);
    t('G 写しの期間に戻った後の読み込みも、残りを先に送ってから null', g === null && b.gas.length === 1 && b.gas[0][0] === 'saveThr', b.gas);
  }

  {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { id: 'm1' } }, at: 1 }]) };
    const b = box({ flags: {}, session: true, store, gas: () => ({ ok: false, error: 'timeout' }) });
    const p = await b.L.post('saveRecord', { record: { id: 'new' } }, { record: { id: 'new' } }, b.post);
    t('G 残りの写し返しを送れない時は、Google へ直接送らず失敗（順番を入れ替えない）', p && p.ok === false && /まだ送れていない/.test(p.error)
      && b.gas.length === 1 && b.gas[0][1].record.id === 'm1', [p, b.gas]);
    const g = await b.L.getAll(b.post);
    t('G 残りを送れない時は、Google から読まない（古い中身で戻さない）', g && /まだ送れていない/.test(g.error || '') && !b.gas.some(x => x[0] === 'getAll'), g);
  }
  {
    const many = []; for (let i = 0; i < 2000; i++) many.push({ action: 'saveRecord', data: { record: { id: 'q' + i } }, at: i });
    const b = box({ flags: { weight: true }, session: true, rpc: liveRpc, store: { wtmgr_mirror_q: JSON.stringify(many) }, gas: () => ({ ok: false }) });
    const p = await b.L.post('saveRecord', { record: { id: 'x' } }, { record: { id: 'x' } }, b.post);
    t('G 写し返しが2000件たまったら、Supabase へ書く前に断る（捨てない）', p && p.ok === false && /多すぎる/.test(p.error) && !b.rpcs.some(x => x[0] === 'weight_write') && mirror(b).length === 2000, p);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: liveRpc, locks: true });
    await b.L.post('saveRecord', { record: { id: 'a' } }, { record: { id: 'a' } }, b.post); await settle();
    t('G タブが2つでも1つだけが送る（ブラウザの鍵 wtmgr_mirror_q を取って送る）', (b.b0.lockNames || []).indexOf('wtmgr_mirror_q') >= 0 && mirror(b).length === 0, b.b0);
  }

  console.log('H 応答が来ない');
  {
    const b = box({ flags: { weight: true }, session: true, rpc: () => new Promise(() => {}) });
    const pr = b.L.post('saveRecord', { record: { id: 'w1' } }, { record: { id: 'w1' } }, b.post);
    await settle();
    const tm = b.timers.find(x => x[1] === 15000);
    t('H 15秒の時間切れを掛ける', !!tm);
    if (tm) tm[0]();
    let err = null; try { await pr; } catch (e) { err = e; }
    t('H 時間切れは失敗（例外）として返す・Google へ流さない', err && /時間内/.test(err.message) && b.gas.length === 0, err && err.message);
  }

  console.log('I 画面のつなぎ');
  {
    t('I 部品を読み込む（写しの部品の直後）', /<script src="su-weight-shadow\.js\?v=2026-10-28"><\/script>\n<script src="su-weight-live\.js\?v=2026-10-28"><\/script>/.test(PAGE));
    const getBody = PAGE.slice(PAGE.indexOf('async function apiGet(){'), PAGE.indexOf('async function apiGet(){') + 2400);
    const iLive = getBody.indexOf('SUWeightLive.getAll(apiPostGas_)'), iGas = getBody.indexOf('fetchTO(');
    t('I 読み込みは Google の前に切り替えを確かめる', iLive > 0 && iGas > iLive);
    const m = PAGE.match(/async function apiPost\(action, data\)\{([\s\S]*?)\n\}\nasync function apiPostGas_\(action, data\)\{/);
    t('I apiPost は切り替えを確かめてから apiPostGas_', !!m && /SUWeightLive\.post\(action, \{ resident: wrResForSend_\(data\), record: data\.record, id: data\.id, thresholds: data\.thresholds \}, data, apiPostGas_\)/.test(m[1])
      && /return apiPostGas_\(action, data\);/.test(m[1]));
    let old = '';
    try { old = cp.execSync('git show 62c7410:weight-record.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { old = ''; }
    if (old) {
      const cut = (src, head) => { const i = src.indexOf(head); return i < 0 ? null : src.slice(i + head.length, src.indexOf('\n}\n', i)); };
      t('I Google へ送る形（apiPostGas_ の中身）は前の apiPost と1文字も変えていない',
        cut(PAGE, 'async function apiPostGas_(action, data){') === cut(old, 'async function apiPost(action, data){'));
    } else {
      t('I （前の版を読めない環境）apiPostGas_ が text/plain で送る', /async function apiPostGas_[\s\S]{0,1600}'Content-Type':'text\/plain;charset=utf-8'/.test(PAGE));
    }
    t('I 写しの部品は Supabase から読んだ中身を写さない', /if \(window\.SUWeightLive && window\.SUWeightLive\.readFromSupabase\(\)\) return;/.test(SHADOW));
    t('I 部品は console.log を使わない', !/console\.log/.test(LIVE));
    // ログインしていない端末の帯（2026-10-28 本人指示・文言は一字も変えない）
    t('I 帯の文言は指示どおり・最初は隠れている', PAGE.indexOf('<div class="wr-nologin" id="wrNoLogin" role="status" hidden>この端末はログインしていません。体重の保存先を切り替えた後は、ログインしていないと体重をサーバーへ送れません。メニューの『ログイン』からログインしてください。</div>') > 0);
    t('I 帯は見出しのすぐ下', /<\/header>\n<div class="wr-nologin" id="wrNoLogin"/.test(PAGE));
    t('I 帯は印刷しない・hidden で必ず隠れる', /@media print\{\.wr-nologin\{display:none !important\}\}/.test(PAGE) && /\.wr-nologin\[hidden\]\{display:none\}/.test(PAGE));
    t('I ログインの控えが無ければ帯を出す', /if\(!has\)\{ wrWhoAcct_ = ''; wrNoLoginBand_\(true\); return; \}/.test(PAGE));
    t('I 確かめられない時（通信の失敗）は帯を消す', /if\(!st \|\| st\.status === 'error'\)\{ wrNoLoginBand_\(false\); return; \}/.test(PAGE));
    t('I 帯を出すのは「ログインしていない」「使えないアカウント」と確かめた時だけ', /wrNoLoginBand_\(st\.status === 'signed_out' \|\| st\.status === 'denied'\);/.test(PAGE));
    t('I 戻るボタンで戻った時も確かめ直す', /addEventListener\('pageshow', function\(e\)\{ if\(e && e\.persisted\)\{ try\{ wrResolveWho_\(\); \}/.test(PAGE));
    t('I 部品は2回読み込んでも1つ', /if \(window\.SUWeightLive\) return;/.test(LIVE));
  }
  {
    // 写しの部品: Supabase から読んだ印がある時は写さない（実際に動かす）
    const store = { 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}' };
    const ctx = { localStorage: { getItem: k => store[k] || null, setItem: () => {}, removeItem: () => {}, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
                  document: { createElement: () => ({}), head: { appendChild: () => {} } }, setTimeout: (f) => { ctx.fired = (ctx.fired || 0) + 1; return 1; }, clearTimeout: () => {},
                  JSON, Date, Math, Promise, Object, Array };
    ctx.window = ctx;
    ctx.SUWeightLive = { readFromSupabase: () => true };
    vm.createContext(ctx); vm.runInContext(SHADOW, ctx);
    ctx.SUWeightShadow.fromGetAll([{ id: 'r1' }], [{ id: 'w1' }], null);
    t('I 写しの部品: 切り替え後の読み込みでは写しの予約をしない', !ctx.fired);
    ctx.SUWeightLive = { readFromSupabase: () => false };
    ctx.SUWeightShadow.fromGetAll([{ id: 'r1' }], [{ id: 'w1' }], null);
    t('I 写しの部品: Google から読んだ時は今までどおり写しを予約する', ctx.fired === 1);
  }

  finished = true;
  console.log('\n' + (fail ? '✗' : '✓') + ' 体重の切り替え: ' + pass + '件合格・' + fail + '件不合格');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { finished = true; console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exitCode = 2; });
