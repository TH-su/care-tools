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
     J 統合 0075: データベースの印（weight_mirror_state）が 'server'（GAS が写し返している）の時だけ、写し返しを積まず・残りも送らずに外す。
       印が読めない・関数が無い・'device'・形の違う答えは今までどおり端末が写し返す。印は1分だけ覚える（保存のたびに問い合わせない）
     L 2026-11-08（代表者の決定「端末ごとの設定を極限までなくす」）: 接続先の無い端末がログインだけで使えるか（liveReady）。
       スイッチが入・ログインの控え・ログインを確かめられた・GAS が写し返している（'server'）・データベースが切り替えた後、の5つがそろう時だけ真。
       時間切れ（8秒）は偽・後から届いても偽のまま・端末にはスイッチの控えしか書かない。接続先の無い端末の書き込みは 'server' の時だけ
       データベースへ書き、それ以外は書く前に断る（Google へも送らない・写し返しを積まない）。画面は接続先が無い時に Google へ送らない
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
    check: () => (o.check === null ? Promise.reject(new Error('net')) : Promise.resolve(o.check || { status: 'ok', role: 'office' })),
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

  console.log('J GAS が写し返している時（統合 0075）');
  const srvRpc = by => (name, args) => name === 'weight_get_all' ? { data: LIVE_ALL, error: null }
    : name === 'weight_mirror_state' ? (typeof by === 'function' ? by() : { data: { ok: true, by }, error: null }) : { data: { ok: true, ver: 2 }, error: null };
  {
    const b = box({ flags: { weight: true }, session: true, rpc: srvRpc('server') });
    const p = await b.L.post('saveRecord', { record: { id: 'w9' } }, { record: { id: 'w9' } }, b.post); await settle();
    t('J server: 書き込みは成功・Google へ送らない・写し返しを積まない', p && p.ok === true && b.gas.length === 0 && mirror(b).length === 0, [p, b.gas]);
    t('J server: 書いた後に印を読む（書く前ではない）', b.rpcs.map(x => x[0]).join() === 'weight_write,weight_mirror_state', b.rpcs);
    await b.L.post('saveRecord', { record: { id: 'w8' } }, { record: { id: 'w8' } }, b.post);
    t('J 印は覚えて使う（2回目の保存で問い合わせない）', b.rpcs.filter(x => x[0] === 'weight_mirror_state').length === 1 && b.L.mirrorBy() === 'server');
    t('J 印を覚えるのは1分（5秒で見切る）', b.timers.some(x => x[1] === 5000));
  }
  {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { id: 'm1' } }, at: 1 }]) };
    const b = box({ flags: { weight: true }, session: true, store, rpc: srvRpc('server') });
    await b.L.post('saveRecord', { record: { id: 'w9' } }, { record: { id: 'w9' } }, b.post); await settle();
    t('J server: 前から残っていた写し返しも送らずに外す（GAS が今の中身を写し返す）', mirror(b).length === 0 && b.gas.length === 0, b.gas);
  }
  {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { id: 'm1' } }, at: 1 }]) };
    const b = box({ flags: { weight: true }, session: true, store, rpc: srvRpc('server') });
    const g = await b.L.getAll(b.post); await settle();
    t('J server: 読み込みの後も残りを送らずに外す', g && g.ok === true && mirror(b).length === 0 && b.gas.length === 0, b.gas);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: srvRpc('server') });
    await b.L.getAll(b.post); await settle();
    t('J 残りが無い時の読み込みでは印を問い合わせない', !b.rpcs.some(x => x[0] === 'weight_mirror_state'), b.rpcs);
  }
  {
    const many = []; for (let i = 0; i < 2000; i++) many.push({ action: 'saveRecord', data: { record: { id: 'q' + i } }, at: i });
    const b = box({ flags: { weight: true }, session: true, store: { wtmgr_mirror_q: JSON.stringify(many) }, rpc: srvRpc('server'), gas: () => ({ ok: false }) });
    const p = await b.L.post('saveRecord', { record: { id: 'x' } }, { record: { id: 'x' } }, b.post); await settle();
    t('J server: 送信待ちがあふれていても、外してから書ける', p && p.ok === true && mirror(b).length === 0 && b.rpcs.some(x => x[0] === 'weight_write'), p);
  }
  for (const [lbl, rep] of [['device', { data: { ok: true, by: 'device' }, error: null }], ['関数が無い（0075 の前・戻した後）', { data: null, error: { code: 'PGRST202' } }],
                            ['権限', { data: null, error: { code: '42501' } }], ['形の違う答え', { data: { by: 'server' }, error: null }],
                            ['通信の失敗', () => { throw new Error('net'); }]]) {
    const b = box({ flags: { weight: true }, session: true, rpc: srvRpc(() => (typeof rep === 'function' ? rep() : rep)) });
    const p = await b.L.post('saveRecord', { record: { id: 'w9' } }, { record: { id: 'w9' } }, b.post); await settle();
    t('J ' + lbl + ': 今までどおり端末が写し返す', p && p.ok === true && b.gas.length === 1 && b.gas[0][0] === 'saveRecord' && mirror(b).length === 0, [p, b.gas]);
  }
  {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { id: 'm1' } }, at: 1 }]) };
    const b = box({ flags: {}, session: true, store, rpc: srvRpc('server') });
    const p = await b.L.post('saveRecord', { record: { id: 'new' } }, { record: { id: 'new' } }, b.post);
    t('J スイッチが切の時は、印を見ずに今までどおり残りを先に送る', p === null && b.gas.length === 1 && !b.rpcs.length, b.rpcs);
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
    t('I 部品を読み込む（写しの部品の直後）', /<script src="su-weight-shadow\.js\?v=2026-10-28\.2"><\/script>\n<script src="su-weight-live\.js\?v=2026-11-14"><\/script>/.test(PAGE));
    const getBody = PAGE.slice(PAGE.indexOf('async function apiGet(){'), PAGE.indexOf('async function apiGet(){') + 2400);
    const iLive = getBody.indexOf('SUWeightLive.getAll(apiPostGas_)'), iGas = getBody.indexOf('fetchTO(');
    t('I 読み込みは Google の前に切り替えを確かめる', iLive > 0 && iGas > iLive);
    const m = PAGE.match(/async function apiPost\(action, data\)\{([\s\S]*?)\n\}\nasync function apiPostGas_\(action, data\)\{/);
    t('I apiPost は切り替えを確かめてから apiPostGas_', !!m && /SUWeightLive\.post\(action, \{ resident: wrResForSend_\(data\), record: data\.record, id: data\.id, thresholds: data\.thresholds \}, data, apiPostGas_, !apiUrl\)/.test(m[1])
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

  console.log('L 接続先の無い端末がログインだけで使えるか（2026-11-08）');
  const lvRpc = (by, all) => (name) => name === 'weight_mirror_state' ? (typeof by === 'function' ? by() : { data: { ok: true, by }, error: null })
    : name === 'weight_get_all' ? (all === undefined ? { data: LIVE_ALL, error: null } : (typeof all === 'function' ? all() : all))
    : { data: { ok: true, ver: 2 }, error: null };
  for (const [lbl, st] of [['事務所', { status: 'ok', role: 'office' }], ['管理者', { status: 'ok', role: 'admin' }], ['現場のアカウント', { status: 'ok', role: 'field' }],
                           ['2段階認証がまだの管理者', { status: 'mfa_verify' }]]) {
    const b = box({ flags: { weight: true }, session: true, check: st, rpc: lvRpc('server') });
    const before = Object.keys(b.store).sort().join();
    const v = await b.L.liveReady();
    t('L ' + lbl + ': 使える', v === true, v);
    t('L ' + lbl + ': 端末にはスイッチの控えしか書かない', Object.keys(b.store).filter(k => k !== 'su_backend_flags').sort().join() === before.split(',').filter(k => k && k !== 'su_backend_flags').join(), Object.keys(b.store));
    t('L ' + lbl + ': Google へ送らない', b.gas.length === 0);
  }
  for (const [lbl, o] of [
    ['スイッチが切', { flags: {}, session: true }], ['スイッチが読めない', { flags: null, session: true }], ['ログインの控えが無い', { flags: { weight: true }, session: false }],
    ['ログインしていない', { flags: { weight: true }, session: true, check: { status: 'signed_out' } }],
    ['使えないアカウント', { flags: { weight: true }, session: true, check: { status: 'denied' } }],
    ['確かめられない（通信）', { flags: { weight: true }, session: true, check: { status: 'error' } }],
    ['確かめが例外', { flags: { weight: true }, session: true, check: null }],
    ['端末が写し返す（device）', { flags: { weight: true }, session: true, rpc: lvRpc('device') }],
    ['写し返しの印の関数が無い', { flags: { weight: true }, session: true, rpc: lvRpc(() => ({ data: null, error: { code: 'PGRST202' } })) }],
    ['写し返しの印が権限で読めない', { flags: { weight: true }, session: true, rpc: lvRpc(() => ({ data: null, error: { code: '42501' } })) }],
    ['写し返しの印が通信の失敗', { flags: { weight: true }, session: true, rpc: lvRpc(() => { throw new Error('net'); }) }],
    ['写しの期間（shadow）', { flags: { weight: true }, session: true, rpc: lvRpc('server', { data: { ok: false, error: 'shadow' }, error: null }) }],
    ['読む関数が無い', { flags: { weight: true }, session: true, rpc: lvRpc('server', { data: null, error: { code: 'PGRST202' } }) }],
    ['読むのを権限で断られた', { flags: { weight: true }, session: true, rpc: lvRpc('server', { data: null, error: { code: '42501' } }) }],
    ['読んだ答えの形が違う', { flags: { weight: true }, session: true, rpc: lvRpc('server', { data: { residents: [] }, error: null }) }],
    ['読むのが通信の失敗', { flags: { weight: true }, session: true, rpc: lvRpc('server', () => { throw new Error('net'); }) }]]) {
    const b = box(Object.assign({ rpc: lvRpc('server') }, o));
    const v = await b.L.liveReady();
    t('L ' + lbl + ': 使えない（今までどおり接続先を求める）', v === false, v);
    t('L ' + lbl + ': Google へ送らない', b.gas.length === 0);
  }
  {
    // 時間切れ（8秒）: 読み込みが後から届いても使えるにしない・その読み込みを使い回さない
    let release = null;
    const late = new Promise(r => { release = r; });
    const b = box({ flags: { weight: true }, session: true, rpc: (name) => name === 'weight_mirror_state' ? { data: { ok: true, by: 'server' }, error: null }
      : name === 'weight_get_all' ? late : { data: { ok: true, ver: 2 }, error: null } });
    const pr = b.L.liveReady(); await settle();
    const tm = b.timers.find(x => x[1] === 8000);
    t('L 8秒の時間切れを掛ける', !!tm);
    if (tm) tm[0]();
    const v = await pr;
    release({ data: LIVE_ALL, error: null }); await settle();
    t('L 時間切れは使えない', v === false, v);
    const n0 = b.rpcs.filter(x => x[0] === 'weight_get_all').length;
    await b.L.getAll(b.post);
    t('L 時間切れの後に届いた読み込みは使い回さない（読み直す）', b.rpcs.filter(x => x[0] === 'weight_get_all').length === n0 + 1, b.rpcs);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: lvRpc('server') });
    await b.L.liveReady();
    const g = await b.L.getAll(b.post);
    t('L 確かめの直後の読み込みは、確かめで読んだ中身を使い回す（2回読まない）', g && g.ok === true && g.residents.length === 2 && b.rpcs.filter(x => x[0] === 'weight_get_all').length === 1, b.rpcs);
    t('L 使い回した読み込みも Supabase から読んだ印を付ける', b.L.readFromSupabase() === true);
    await b.L.getAll(b.post);
    t('L 使い回すのは1回だけ（次は読み直す）', b.rpcs.filter(x => x[0] === 'weight_get_all').length === 2, b.rpcs);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: lvRpc('server') });
    const p = await b.L.post('saveRecord', { record: { id: 'n1' } }, { record: { id: 'n1' } }, b.post, true); await settle();
    t('L 接続先の無い端末: GAS が写し返している時はデータベースへ書く・Google へ送らない・写し返しを積まない',
      p && p.ok === true && b.rpcs.some(x => x[0] === 'weight_write') && b.gas.length === 0 && mirror(b).length === 0, [p, b.rpcs, b.gas]);
    t('L 接続先の無い端末: 書く前に写し返しの印を確かめる', b.rpcs.map(x => x[0]).indexOf('weight_mirror_state') < b.rpcs.map(x => x[0]).indexOf('weight_write'), b.rpcs);
  }
  for (const [lbl, by] of [['device', 'device'], ['関数が無い', () => ({ data: null, error: { code: 'PGRST202' } })], ['通信の失敗', () => { throw new Error('net'); }]]) {
    const store = { wtmgr_mirror_q: JSON.stringify([{ action: 'saveRecord', data: { record: { id: 'm1' } }, at: 1 }]) };
    const b = box({ flags: { weight: true }, session: true, store, rpc: lvRpc(by) });
    const p = await b.L.post('saveRecord', { record: { id: 'n1' } }, { record: { id: 'n1' } }, b.post, true); await settle();
    t('L 接続先の無い端末・写し返しが ' + lbl + ': 書く前に断る（データベースへも書かない・職員向けの文）',
      p && p.ok === false && /接続先が入っていない/.test(p.error || '') && !b.rpcs.some(x => x[0] === 'weight_write'), [p, b.rpcs]);
    t('L 接続先の無い端末・写し返しが ' + lbl + ': 残っている写し返しを捨てない・Google へ送らない', mirror(b).length === 1 && b.gas.length === 0, [mirror(b), b.gas]);
  }
  {
    const b = box({ flags: { weight: true }, session: true, rpc: lvRpc('device') });
    const p = await b.L.post('saveRecord', { record: { id: 'n1' } }, { record: { id: 'n1' } }, b.post); await settle();
    t('L 接続先のある端末は今までどおり（device なら書いて写し返す）', p && p.ok === true && b.gas.length === 1 && b.rpcs.some(x => x[0] === 'weight_write'), [p, b.gas]);
  }
  {
    const on = box({ flags: { weight: true }, session: true, store: { su_backend_flags: JSON.stringify({ supabase: { weight: true } }) } });
    const off1 = box({ flags: { weight: true }, session: false, store: { su_backend_flags: JSON.stringify({ supabase: { weight: true } }) } });
    const off2 = box({ flags: { weight: true }, session: true, store: { su_backend_flags: JSON.stringify({ supabase: { weight: false } }) } });
    t('L 起動の時の見込み（maybeLive）: スイッチの控えが入でログインの控えがある時だけ真・通信しない',
      on.L.maybeLive() === true && off1.L.maybeLive() === false && off2.L.maybeLive() === false && on.fetches.length === 0 && on.rpcs.length === 0);
  }
  {
    // 画面: 本物の apiGet・apiPost を動かす（接続先の有無 × ログインだけで使えるか）
    const cutFn = (head) => { const i = PAGE.indexOf(head); return i < 0 ? '' : PAGE.slice(i, PAGE.indexOf('\n}\n', i) + 2); };
    const src = cutFn('async function apiGet(){') + cutFn('async function apiPost(action, data){');
    const WRMSG = (PAGE.match(/const WR_NOGAS_MSG = '([^']+)';/) || [])[1] || '';
    t('L 画面: 接続先の無い時の断りは職員向けの文', /接続先が入っていない/.test(WRMSG) && !/[A-Za-z]/.test(WRMSG.replace(/Google/g, '')));
    const run = async (o) => {
      const calls = [];
      const c = { apiUrl: o.url || '', wrLiveOk_: !!o.live, WR_NOGAS_MSG: WRMSG, apiToken: '', apiCaps: { seen: true, caps: [] },
        apiCan: () => false, apiProbe: async () => null, wrResForSend_: d => d && d.resident,
        fetchTO: async (u) => { calls.push(['fetch', u]); return {}; }, _parseApiResponse: async () => ({ ok: true, from: 'gas' }),
        apiPostGas_: async (a) => { calls.push(['gas', a]); return { ok: true, from: 'gas' }; },
        SUWeightLive: { getAll: async () => o.lv, post: async (a, p, d, g, noGas) => { calls.push(['live', a, noGas]); return o.lv; } } };
      c.wrSyncOn_ = () => !!c.apiUrl || c.wrLiveOk_;
      vm.createContext(c); vm.runInContext(src + '\nthis.apiGet = apiGet; this.apiPost = apiPost;', c);
      return { g: await c.apiGet(), p: await c.apiPost('saveRecord', { record: { id: 'x' } }), calls };
    };
    let r = await run({ url: '', live: false, lv: { ok: true } });
    t('L 画面: 接続先が無く使えない端末は、今までどおり読み書きとも null（部品も Google も呼ばない）', r.g === null && r.p === null && r.calls.length === 0, r);
    r = await run({ url: '', live: true, lv: { ok: true, ver: 2, from: 'live' } });
    t('L 画面: 接続先が無く使える端末は新しい保存先で読み書きし、接続先が無いと部品に伝える', r.g.from === 'live' && r.p.from === 'live' && r.calls.length === 1 && r.calls[0][2] === true, r);
    r = await run({ url: '', live: true, lv: null });
    t('L 画面: 接続先が無い端末で部品が Google を指した時（写しの期間へ戻った等）は、Google へ送らず断る',
      r.g && r.g.error === WRMSG && r.p && r.p.ok === false && r.p.error === WRMSG && !r.calls.some(x => x[0] === 'fetch' || x[0] === 'gas'), r);
    r = await run({ url: 'https://script.google.com/macros/s/x/exec', live: false, lv: null });
    t('L 画面: 接続先のある端末は今までどおり（部品が Google を指せば Google・接続先はあると伝える）', r.g.from === 'gas' && r.p.from === 'gas' && r.calls.some(x => x[0] === 'live' && x[2] === false), r);
    // 起動の段
    const boot = PAGE.slice(PAGE.indexOf("}else if(typeof SUWeightLive !== 'undefined' && typeof SUWeightLive.liveReady === 'function'){"));
    const bb = boot.slice(0, boot.indexOf('updateAuthNote_();'));
    t('L 画面: 起動の確かめは接続先が無い時だけ（接続先のある道の else）', bb.length > 0 && /\n  \}else if\(typeof SUWeightLive/.test(PAGE));
    t('L 画面: 使えると分かった時だけ同期の印を立て、案内の帯を止め、同期する', /if\(!ok\)\{[\s\S]*?return;\s*\}\s*wrLiveOk_ = true;[\s\S]*SUCfgHint\.quiet\(\)[\s\S]*syncFromAPI\(/.test(bb));
    t('L 画面: 確かめの間に接続先を入れた時は今までどおりの道', /if\(apiUrl\) return;/.test(bb));
    t('L 画面: 使えない時は、見送った入居者の取り込みを今までどおり行う', /if\(wrBootNoAdd_\)\{ try\{ if\(mergeCommonWeight\(\)\) wrRefreshViews\(\);/.test(bb));
    t('L 画面: 起動の取り込みは、ログインだけで使えるかもしれない端末でも作らない（二重に作らない）', /mergeCommonWeight\(\{ noAdd: !!apiUrl \|\| wrBootNoAdd_ \}\)/.test(PAGE)
      && /wrBootNoAdd_ = !apiUrl && typeof SUWeightLive !== 'undefined' && typeof SUWeightLive\.maybeLive === 'function' && SUWeightLive\.maybeLive\(\) === true;/.test(PAGE));
    t('L 画面: 同期・送信・送り直し・まとめの前の同期・現場の帯は、接続先かログインだけで使えるかで決める',
      /async function _syncFromAPIImpl\(showLoader\)\{\n  if\(!wrSyncOn_\(\)\) return false;/.test(PAGE) && /if\(!wrSyncOn_\(\) \|\| _pqFlushing\) return;/.test(PAGE)
      && /function apiPush\(action, data\)\{\n  if\(!wrSyncOn_\(\)\) return;/.test(PAGE) && /nb\.hidden = !\(field && !wrSyncOn_\(\)\);/.test(PAGE)
      && (PAGE.match(/\n  if\(wrSyncOn_\(\)\)\{\n    let ok = false;/g) || []).length === 5 && !/\n  if\(apiUrl\)\{\n    let ok = false;/.test(PAGE));
    t('L 画面: Google の受け口を確かめる所（版の観測）は接続先のある時だけのまま', /async function apiProbe\(\)\{\n  if\(!apiUrl\) return null;/.test(PAGE));
  }

  finished = true;
  console.log('\n' + (fail ? '✗' : '✓') + ' 体重の切り替え: ' + pass + '件合格・' + fail + '件不合格');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { finished = true; console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exitCode = 2; });
