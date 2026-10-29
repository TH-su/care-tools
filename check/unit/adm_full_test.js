/* 入居調整の台帳の写し（su-adm-full.js・統合 0040）の試験（2026-10-29 新設）
   実行: node check/unit/adm_full_test.js
   対象を差し替える（壊した版で落ちることを確かめる）: ADM_FULL_JS=/tmp/変異版.js node check/unit/adm_full_test.js

   守ること:
     A Google から台帳を1回読み（get・admission_flow_v1）、読めない・台帳が無い時はデータベースを呼ばない
     B 写しは adm_import（GAS の版・中身・時刻のまま）→ adm_get（画面の名前つき）の順。データベースの断りは職員向けの文
     C 見比べは版・中身（キーの並びは問わない）・更新の時刻。返すのは違いの種類だけ
     D 自動: 管理者だけ・その日（日本時間）まだ写していなければ・前の試みから1時間は試さない・0040 が無ければ何もしない
     E 端末に保存しない。Google へは読む操作（get）だけ。件数の数え方は GAS と同じ（墓標を数えない）
     F 画面: 入居調整は1ページで1回・現場の端末・接続先が無い時は写さない。帯は最初は隠し・印刷しない・textContent。写しの見比べのボタンは管理者だけ
     K 切り替える・戻す（統合 0042）: 札→GAS の保存を止める→止めた後の写し→止めた後の印→切り替え→札を返す。途中で止まれば GAS の保存を戻す。
       戻す: 札→写しの期間→写し返しが残る間は続けて→印を外す→札を返す。自動の写しは切り替えた後・操作中は何もしない
   ★架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(ROOT, f), 'utf8');
const SRC = read('ADM_FULL_JS', 'su-adm-full.js');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

function load() {
  const touched = [];
  const trap = new Proxy({}, { get(_, k) { touched.push(String(k)); return () => null; } });
  const ctx = { window: {}, TextEncoder, Promise, JSON, Object, Array, String, Number, Math, Error, Date, setTimeout, localStorage: trap, sessionStorage: trap };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUAdmFull, touched };
}
const LEDGER = { v: 1, updatedAt: '2026-10-01T00:00:00.000Z', candidates: [{ id: 'c1', name: '見本 一郎' }, { id: 'c2', deleted: true }, { id: 'c3', deleted: false }] };
function world(o) {
  o = o || {};
  const gasCalls = [], rpcs = [];
  let db = null;
  const gas = async body => {
    gasCalls.push(JSON.parse(JSON.stringify(body)));
    if (o.gasFail) throw new Error('Google に届きませんでした');
    if (o.gasResp) return o.gasResp;
    return { ok: true, rev: 5, data: JSON.parse(JSON.stringify(LEDGER)), updatedAt: '2026-10-01T09:00:00.000Z' };
  };
  const rpc = async (name, args) => {
    rpcs.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (o.rpc && o.rpc[name]) return o.rpc[name](args);
    if (name === 'adm_import') { db = { rev: args.p_rev, data: args.p_data, updatedAt: args.p_updated }; return { data: { ok: true, result: 'inserted', rev: args.p_rev, active: 2 }, error: null }; }
    if (name === 'adm_get') { const d = o.mangle ? o.mangle(db) : db; return { data: Object.assign({ ok: true }, d || { rev: 0, data: null }), error: null }; }
    return { data: null, error: { code: 'PGRST202' } };
  };
  return { gas, rpc, gasCalls, rpcs };
}

(async () => {
  const { R, touched } = load();
  console.log('A 読む');
  {
    const w = world();
    const r = await R.run(w);
    t('台帳を get で1回だけ読む', w.gasCalls.length === 1 && JSON.stringify(w.gasCalls[0]) === '{"action":"get","key":"admission_flow_v1"}', w.gasCalls);
    t('写して読み直し、一致・墓標を数えない件数', r.ok === true && r.diff.length === 0 && r.active === 2 && r.rev === 5 && r.result === 'inserted', r);
    for (const [label, o] of [['届かない', { gasFail: true }], ['断られた', { gasResp: { ok: false, error: 'unauthorized' } }], ['台帳が無い', { gasResp: { ok: true, rev: 0, data: null } }], ['配列', { gasResp: { ok: true, rev: 1, data: [] } }]]) {
      const w2 = world(o);
      const r2 = await R.run(w2);
      t('Google が' + label + ' → データベースを呼ばない', r2.ok === false && w2.rpcs.length === 0, r2);
    }
    const big = world({ gasResp: { ok: true, rev: 1, data: { candidates: [], x: 'あ'.repeat(800000) } } });
    t('2MB（統合 0042 の上限）を超える台帳は写し始めない', (await R.run(big)).ok === false && big.rpcs.length === 0);
  }
  console.log('B 写す順と断り');
  {
    const w = world();
    await R.run(w);
    t('adm_import（版・中身・時刻のまま）→ adm_get（画面の名前）', w.rpcs.map(x => x.name).join(',') === 'adm_import,adm_get'
      && w.rpcs[0].args.p_rev === 5 && w.rpcs[0].args.p_updated === '2026-10-01T09:00:00.000Z' && w.rpcs[0].args.p_data.candidates.length === 3 && w.rpcs[1].args.p_screen === 'shadow-check', w.rpcs);
    for (const [code, re] of [['stale', /新しい版/], ['shrink', /半分/], ['nodata', /形/]]) {
      const w2 = world({ rpc: { adm_import: () => ({ data: { ok: false, error: code }, error: null }) } });
      const r = await R.run(w2);
      t('断り ' + code + ' → 職員向けの文・読み直さない', r.ok === false && re.test(r.why) && w2.rpcs.length === 1, r);
    }
    const w3 = world({ rpc: { adm_import: () => ({ data: null, error: { code: '42501' } }) } });
    t('管理者でない → 職員向けの文', /管理者/.test((await R.run(w3)).why));
    const w4 = world({ rpc: { adm_import: () => ({ data: null, error: { code: 'PGRST202' } }) } });
    t('0040 が無い → 準備がまだ', /0040/.test((await R.run(w4)).why));
  }
  console.log('C 見比べ');
  {
    const r1 = await R.run(world({ mangle: d => Object.assign({}, d, { rev: 4 }) }));
    const r2 = await R.run(world({ mangle: d => Object.assign({}, d, { data: { candidates: [] } }) }));
    const r3 = await R.run(world({ mangle: d => Object.assign({}, d, { updatedAt: '' }) }));
    const r4 = await R.run(world({ mangle: () => null }));
    t('版・中身・更新の時刻の違いを種類だけで返す', JSON.stringify([r1.diff, r2.diff, r3.diff, r4.diff]) === '[["版"],["中身"],["更新の時刻"],["写しにありません"]]', [r1, r2, r3, r4]);
    t('キーの並びの違いは同じとみなす', R._compare({ rev: 1, data: { a: 1, b: 2 }, updatedAt: '' }, { rev: 1, data: { b: 2, a: 1 }, updatedAt: '' }).length === 0);
    t('件数の数え方は GAS と同じ（墓標・物でない要素を数えない）', R._countActive({ candidates: [{}, { deleted: 1 }, null, 'x', { deleted: '' }] }) === 2 && R._countActive(null) === 0 && R._countActive({ candidates: {} }) === 0);
  }
  console.log('D 自動');
  function authOf(role, runs, err) {
    return async () => ({ STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role }),
      client: () => ({ from: () => ({ select: () => ({ order: () => ({ limit: async () => (err ? { data: null, error: { code: '42P01' } } : { data: runs, error: null }) }) }) }), rpc: world().rpc }) });
  }
  {
    const now = Date.parse('2026-10-29T03:00:00Z');
    const a = await R.auto({ gas: world().gas, auth: authOf('office', []), now });
    const b = await R.auto({ gas: world().gas, auth: authOf('admin', [{ at: '2026-10-28T20:00:00Z', status: 'done' }]), now });
    const c = await R.auto({ gas: world().gas, auth: authOf('admin', [{ at: '2026-10-29T02:30:00Z', status: 'refused' }]), now });
    const d = await R.auto({ gas: world().gas, auth: authOf('admin', [], true), now });
    const e = await R.auto({ gas: world().gas, auth: authOf('admin', [{ at: '2026-10-27T20:00:00Z', status: 'done' }]), now });
    t('管理者でない → 何もしない', a.skip === 'role');
    t('日本時間で今日もう写した → 何もしない', b.skip === 'today');
    t('前の試みから1時間たっていない → 何もしない', c.skip === 'recent');
    t('0040 が無い → 何もしない', d.skip === 'nodb');
    t('前の日に写した後なら写す', e.ok === true, e);
    t('知らせ: 一致は出さない・違い・止まった時だけ', R.autoNote(e) === '' && /違う所がありました（中身）/.test(R.autoNote({ ok: true, diff: ['中身'] })) && /取れませんでした/.test(R.autoNote({ ok: false, why: 'x' })) && R.autoNote({ skip: 'today' }) === '');
    const thrown = await R.auto({ gas: world().gas, auth: async () => { throw new Error('x'); } });
    t('例外を外へ出さない', thrown.skip === 'error');
  }
  console.log('E 端末に保存しない・読むだけ');
  t('localStorage・sessionStorage を使わない', touched.length === 0 && !/(localStorage|sessionStorage)\./.test(SRC));
  t('Google へ送る操作は get だけ', !/action:\s*'(put|uploadFile|removeFile|downloadFile|filesGet)'/.test(SRC));
  console.log('F 画面');
  {
    const AF = read('ADM_HTML', 'admission-flow.html');
    const fn = AF.slice(AF.indexOf('var admFullDone_'), AF.indexOf('/* 起動時は「サーバー版を無条件に採る」をしない'));
    t('入居調整: 部品を読み込む・1ページで1回・現場の端末・接続先が無い時は写さない・台帳が読めた時だけ', /<script src="su-adm-full\.js\?v=/.test(AF)
      && /admFullDone_ \|\| !window\.SUAdmFull \|\| !SU_DATA_READY \|\| admFullBlocked_\(\) \|\| !syncTarget\(\)\.endpoint/.test(fn)
      && /startupPull\(\)\.then\(function \(ok\) \{ if \(ok\) admFullAuto_\(\);/.test(AF) && /=== 'field'/.test(fn));
    t('入居調整: 帯は最初は隠し・印刷しない・textContent', /id="admfBand" role="status" hidden/.test(AF) && /@media print\{\.admf-band\{display:none !important\}\}/.test(AF)
      && /\.admf-band\[hidden\]\{display:none !important\}/.test(AF) && /el\.textContent = t/.test(fn) && !/innerHTML/.test(fn));
    const SH = read('SHADOW_HTML', 'shadow-check.html'), SJ = read('SHADOW_JS', 'shadow-check.js');
    const sf = SJ.slice(SJ.indexOf('function admTarget'), SJ.indexOf('/* 個別機能訓練計画書の正本の切り替え（統合 0038'));
    t('写しの見比べ: ボタンは最初は隠し・管理者だけ・現場の端末では断る・確かめてから写す', /id="b-adm-full" hidden>入居調整の台帳を写す</.test(SH)
      && /\$\('b-adm-full'\)\.hidden = !\(me && me\.role === 'admin'\)/.test(sf) && /role === 'field'/.test(sf) && /confirm\(/.test(sf) && !/innerHTML/.test(sf)
      && SH.indexOf('su-adm-full.js?v=') > 0 && SH.indexOf('su-adm-full.js?v=') < SH.indexOf('shadow-check.js?v='));
    t('公開の許可リストに載っている', /^!\/su-adm-full\.js$/m.test(read('GITIGNORE', '.gitignore')));
  }

  console.log('K 切り替える・戻す');
  function cw(o) {
    o = o || {};
    const order = [], st = { switched: false, mode: 'shadow' };
    const w = world({ mangle: o.mangle, rpc: {
      adm_op_begin: a => { order.push('op:' + a.p_op); return o.busy ? { data: { ok: false, error: 'busy' }, error: null } : { data: { ok: true, token: 'TK' }, error: null }; },
      adm_op_end: a => { order.push('end:' + a.p_token); return { data: { ok: true }, error: null }; },
      adm_mode_get: () => ({ data: { ok: true, mode: st.mode }, error: null }),
      adm_import: a => { order.push('import'); return { data: { ok: true, result: 'unchanged', rev: a.p_rev, active: 2, run: 41 }, error: null }; },
      adm_get: () => ({ data: { ok: true, rev: 5, data: JSON.parse(JSON.stringify(LEDGER)), updatedAt: '2026-10-01T09:00:00.000Z' }, error: null }),
      adm_import_mark_frozen: a => { order.push('frozen:' + a.p_run); return { data: { ok: !o.frozenFail }, error: null }; },
      adm_set_mode: a => { order.push('mode:' + a.p_mode); if (o.modeErr && a.p_mode === 'live') return { data: { ok: false, error: o.modeErr }, error: null };
        st.mode = a.p_mode; if (o.lostLive && a.p_mode === 'live') return { data: null, error: { message: 'Failed to fetch' } }; return { data: { ok: true, mode: a.p_mode }, error: null }; }
    } });
    const g0 = w.gas;
    w.gas = async body => {
      if (body.action === 'admCutover') {
        order.push('cut:' + body.on);
        if (body.accessToken !== 'h.p.s' || body.opToken !== 'TK') return { ok: false, error: 'Error: refused: 切り替えの操作の札がありません' };
        if (body.on) { st.switched = true; if (o.lostOn) throw new Error('Google に届きませんでした'); return { ok: true, switched: true }; }
        if (o.mirrorMore && o.mirrorMore-- > 0) return { ok: false, error: 'Error: refused: 写し返しが残っています。もう一度押してください' };
        st.switched = false; return { ok: true, switched: false, docs: 1 };
      }
      return g0(body);
    };
    w.token = async () => (o.noToken ? null : 'h.p.s');
    return { w, order, st };
  }
  {
    const { w, order, st } = cw();
    const r = await R.cutover(w);
    t('切り替える: 札→止める→止めた後の写し→止めた後の印（その写しの番号）→切り替え→札を返す', r.ok === true && order.join(',') === 'op:cutover,cut:true,import,frozen:41,mode:live,end:TK' && st.mode === 'live' && st.switched, [r, order]);
    t('切り替える: Google へは台帳の get と止める指示だけを送る（添付書類の操作を送らない）', w.gasCalls.every(b => b.action === 'get'), w.gasCalls);
  }
  for (const [label, o, re] of [['写しが Google と違う', { mangle: () => ({ rev: 99, data: LEDGER, updatedAt: '2026-10-01T09:00:00.000Z' }) }, /違った/], ['止めた後の印を付けられない', { frozenFail: true }, /止めた後/],
                                ['切り替えが断られた（noop）', { modeErr: 'noop' }, /時間切れ/], ['止める指示の応答が届かない', { lostOn: true }, /届きません/]]) {
    const { w, order, st } = cw(o);
    if (o.mangle) w.rpc = (orig => async (n, a) => (n === 'adm_get' ? { data: Object.assign({ ok: true }, o.mangle()), error: null } : orig(n, a)))(w.rpc);
    const r = await R.cutover(w);
    t('切り替える: ' + label + ' → 止めて Google の保存を戻し、札を返す', r.ok === false && re.test(r.why) && order.slice(-2).join(',') === 'cut:false,end:TK' && !st.switched && st.mode === 'shadow', [r, order]);
  }
  {
    const { w, st } = cw({ lostLive: true });
    const r = await R.cutover(w);
    t('切り替える: 応答が届かなくても読み直して切り替わっていれば成功', r.ok === true && st.mode === 'live', r);
  }
  {
    const { w, order } = cw({ busy: true });
    const r = await R.cutover(w);
    t('切り替える: 別の画面で動いている時は何もしない', r.ok === false && /別の画面/.test(r.why) && order.join(',') === 'op:cutover', [r, order]);
  }
  {
    const { w, order, st } = cw({ mirrorMore: 2 });
    st.mode = 'live'; st.switched = true;
    const r = await R.back(w);
    t('戻す: 札→写しの期間→写し返しが残る間は続けて→印を外す→札を返す', r.ok === true && r.docs === 1 && order.join(',') === 'op:back,mode:shadow,cut:false,cut:false,cut:false,end:TK' && !st.switched, [r, order]);
  }
  {
    const { w, st } = cw({ noToken: true });
    st.mode = 'live'; st.switched = true;
    const r = await R.back(w);
    t('戻す: 写し返しが済まない時は、戻したことと押し直しを伝える', r.ok === false && /写しの期間には戻しました/.test(r.why) && st.mode === 'shadow', r);
  }
  {
    const calls = [];
    const A = { STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role: 'admin' }),
      client: () => ({ from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }), rpc: async (n) => { calls.push(n); return n === 'adm_op_busy' ? { data: true, error: null } : { data: null, error: { code: 'x' } }; } }) };
    const r = await R.auto({ gas: async () => ({}), auth: async () => A });
    t('自動の写し: 切り替える・戻すが動いている間は写さない', r.skip === 'op' && calls.join(',') === 'adm_mode_get,adm_op_busy', [r, calls]);
    const A2 = { STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role: 'admin' }),
      client: () => ({ from: () => { throw new Error('読まない'); }, rpc: async (n) => (n === 'adm_mode_get' ? { data: { ok: true, mode: 'live' }, error: null } : { data: null, error: { code: 'x' } }) }) };
    const r2 = await R.auto({ gas: async () => { throw new Error('読まない'); }, auth: async () => A2 });
    t('自動の写し: 切り替えた後は Google を読まずに何もしない', r2.skip === 'live', r2);
  }

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
