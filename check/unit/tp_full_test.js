/* 個別機能訓練計画書の写し（su-tp-full.js・統合 0037）の試験（2026-10-29 新設）
   実行: node check/unit/tp_full_test.js
   対象を差し替える（壊した版で落ちることを確かめる）: TP_FULL_JS=/tmp/変異版.js node check/unit/tp_full_test.js

   守ること:
     A 写すキーは索引のキー＋索引の行＋名簿の利用者No の和（重ねない・形の合わない番号は外して数える）
     B 全部を Google から読めてから写し始める。1件でも読めなければデータベースを呼ばない。中身の無いキーは写さない
     C 写しは begin → chunk（50件ずつ）→ finish（写した全部のキー）→ tp_get（画面の名前つき）の順。データベースの断りは職員向けの文
     D 見比べは版・中身（キーの並びは問わない）・更新の時刻。返すのはキーと違いの種類だけ
     E 自動: 管理者だけ・その日（日本時間）まだ写していなければ・前の試みから1時間は試さない・0037 が無ければ何もしない
     F 端末に保存しない。Google へは読む操作（get）だけ
     G 画面: 計画書は1ページで1回・現場の端末・接続先が無い時は写さない。帯は最初は隠し・印刷しない・textContent。写しの見比べのボタンは管理者だけ
   ★架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(ROOT, f), 'utf8');
const SRC = read('TP_FULL_JS', 'su-tp-full.js');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

function load() {
  const touched = [];
  const trap = new Proxy({}, { get(_, k) { touched.push(String(k)); return () => null; } });
  const ctx = { window: {}, TextEncoder, Promise, JSON, Object, Array, String, Math, Error, Date, setTimeout, localStorage: trap, sessionStorage: trap };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUTpFull, touched };
}
function world(o) {
  o = o || {};
  const docs = Object.assign({
    'training_plan:index': { ok: true, rev: 4, data: { v: 1, rows: { t1: {}, t3: {} } }, updatedAt: '2026-10-01T00:00:00.000Z' },
    'training_plan:t1': { ok: true, rev: 2, data: { plans: [{ goal: '見本の目標' }] }, updatedAt: '2026-10-02T00:00:00.000Z' },
    'training_plan:t2': { ok: true, rev: 0, data: null },
    'training_plan:t3': { ok: true, rev: 1, data: { plans: [] }, updatedAt: '' }
  }, o.docs || {});
  const gasCalls = [], rpcs = [], db = {};
  const gas = async body => {
    gasCalls.push(JSON.parse(JSON.stringify(body)));
    if (o.gasFail === body.key) throw new Error('Google に届きませんでした');
    return docs[body.key] || { ok: true, rev: 0, data: null };
  };
  const rpc = async (name, args) => {
    rpcs.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (o.rpc && o.rpc[name]) return o.rpc[name](args);
    if (name === 'tp_import_begin') return { data: { ok: true, run: 9 }, error: null };
    if (name === 'tp_import_chunk') { args.p_rows.forEach(r => { db[r.key] = JSON.parse(JSON.stringify(r)); }); return { data: { ok: true, inserted: args.p_rows.length, updated: 0, unchanged: 0 }, error: null }; }
    if (name === 'tp_import_finish') return { data: { ok: true, docs: args.p_keys.length, missing: 0 }, error: null };
    if (name === 'tp_get') return { data: { ok: true, rows: args.p_keys.filter(k => db[k]).map(k => o.mangle ? o.mangle(db[k]) : db[k]) }, error: null };
    return { data: null, error: { code: 'PGRST202' } };
  };
  return { gas, rpc, gasCalls, rpcs, db, rosterIds: async () => o.roster || ['t1', 't2', ' t4', '山田', 't1'], progress: () => {} };
}

(async () => {
  const { R, touched } = load();
  console.log('A 写すキー');
  {
    const k = R._keysOf({ rows: { t1: {}, 'x y': {} } }, ['t2', 't1', '', '山田']);
    t('索引＋索引の行＋名簿の和・重ねない・形の合わない番号は外して数える', JSON.stringify(k.keys) === '["training_plan:index","training_plan:t1","training_plan:t2"]' && k.bad === 3, k);
  }
  console.log('B・C 写す');
  {
    const w = world();
    const r = await R.run(w);
    t('中身のあるキーだけ写す（t2・t4 は中身なし）・名簿の前後の空白は外して読む', r.ok === true && r.docs === 3 && JSON.stringify(Object.keys(w.db).sort()) === '["training_plan:index","training_plan:t1","training_plan:t3"]'
      && w.gasCalls.some(b => b.key === 'training_plan:t4') && r.badIds === 1, [r, Object.keys(w.db)]);
    t('Google へは get だけ・索引は1回だけ読む', w.gasCalls.every(b => b.action === 'get') && w.gasCalls.filter(b => b.key === 'training_plan:index').length === 1);
    t('データベースは begin → chunk → finish → tp_get の順・finish には写した全部のキー', w.rpcs.map(x => x.name).join(',') === 'tp_import_begin,tp_import_chunk,tp_import_finish,tp_get'
      && JSON.stringify(w.rpcs[2].args.p_keys) === JSON.stringify(w.rpcs[1].args.p_rows.map(x => x.key)) && w.rpcs[3].args.p_screen === 'shadow-check');
    t('全件一致', r.cmp.same === r.docs && r.cmp.diff.length === 0 && r.cmp.notInCopy.length === 0, r.cmp);
  }
  {
    const w = world({ gasFail: 'training_plan:t3' });
    const r = await R.run(w);
    t('1件でも Google から読めなければ、データベースを呼ばない', r.ok === false && w.rpcs.length === 0, r);
  }
  {
    const w = world({ rpc: { tp_import_finish: () => ({ data: { ok: false, error: 'shrink' }, error: null }), tp_import_abort: () => ({ data: { ok: true }, error: null }) } });
    const r = await R.run(w);
    t('データベースの断り（shrink）は職員向けの文にし、途中の写しを取り消す', r.ok === false && /半分より少なかった/.test(r.why) && w.rpcs.some(x => x.name === 'tp_import_abort'), r);
  }
  {
    const w = world({ rpc: { tp_import_begin: () => ({ data: null, error: { code: 'PGRST202' } }) } });
    const r = await R.run(w);
    t('0037 の前は「準備がまだ」', r.ok === false && /0037/.test(r.why), r);
  }
  {
    const big = { ok: true, rev: 1, data: { x: 'あ'.repeat(210000) }, updatedAt: '' };
    const w = world({ docs: { 'training_plan:t1': big } });
    const r = await R.run(w);
    t('大きすぎる計画書があれば写し始めない', r.ok === false && /大きすぎる/.test(r.why) && w.rpcs.length === 0, r);
  }
  {
    const many = {}; const ids = [];
    for (let i = 0; i < 120; i++) { many['training_plan:m' + i] = { ok: true, rev: 1, data: { plans: [] }, updatedAt: '' }; ids.push('m' + i); }
    const w = world({ docs: many, roster: ids });
    const r = await R.run(w);
    t('50件ずつ写す', r.ok === true && w.rpcs.filter(x => x.name === 'tp_import_chunk').every(x => x.args.p_rows.length <= 50) && w.rpcs.filter(x => x.name === 'tp_import_chunk').length === 3, r);
  }
  console.log('D 見比べ');
  {
    const w = world({ mangle: r => (r.key === 'training_plan:t1' ? Object.assign({}, r, { rev: 3 }) : r.key === 'training_plan:t3' ? Object.assign({}, r, { data: { plans: [1] } }) : r) });
    const r = await R.run(w);
    t('版・中身の違いをキーと種類だけで返す', r.ok === true && JSON.stringify(r.cmp.diff) === '[{"key":"training_plan:t1","why":["版"]},{"key":"training_plan:t3","why":["中身"]}]', r.cmp);
    const c = R._compare([{ key: 'k', rev: 1, data: { a: 1, b: 2 }, updatedAt: '' }], [{ key: 'k', rev: 1, data: { b: 2, a: 1 }, updatedAt: '' }]);
    t('キーの並びの違いは同じとみなす', c.same === 1);
  }
  console.log('E 自動');
  function authOf(role, runs, err) {
    return async () => ({ STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role }),
      client: () => ({ from: () => ({ select: () => ({ order: () => ({ limit: async () => (err ? { data: null, error: { code: '42P01' } } : { data: runs, error: null }) }) }) }), rpc: world().rpc }) });
  }
  {
    const now = Date.parse('2026-10-29T03:00:00Z');
    const a = await R.auto({ gas: world().gas, rosterIds: world().rosterIds, auth: authOf('office', []), now });
    const b = await R.auto({ gas: world().gas, rosterIds: world().rosterIds, auth: authOf('admin', [{ at: '2026-10-28T20:00:00Z', status: 'done' }]), now });
    const c = await R.auto({ gas: world().gas, rosterIds: world().rosterIds, auth: authOf('admin', [{ at: '2026-10-29T02:30:00Z', status: 'refused' }]), now });
    const d = await R.auto({ gas: world().gas, rosterIds: world().rosterIds, auth: authOf('admin', [], true), now });
    const e = await R.auto({ gas: world().gas, rosterIds: world().rosterIds, auth: authOf('admin', [{ at: '2026-10-27T20:00:00Z', status: 'done' }]), now });
    t('管理者でない → 何もしない', a.skip === 'role');
    t('日本時間で今日もう写した → 何もしない', b.skip === 'today');
    t('前の試みから1時間たっていない → 何もしない', c.skip === 'recent');
    t('0037 が無い → 何もしない', d.skip === 'nodb');
    t('前の日に写した後なら写す（画面の名前は training-plan）', e.ok === true, e);
    t('知らせ: 全件一致は出さない・違い・止まった時だけ', R.autoNote(e) === '' && /違う計画書が 1件/.test(R.autoNote({ ok: true, cmp: { diff: [1], notInCopy: [] } })) && /取れませんでした/.test(R.autoNote({ ok: false, why: 'x' })) && R.autoNote({ skip: 'today' }) === '');
  }
  console.log('F 端末に保存しない');
  t('localStorage・sessionStorage を使わない', touched.length === 0 && !/(localStorage|sessionStorage)\./.test(SRC));
  console.log('G 画面');
  {
    const TP = read('TP_HTML', 'training-plan.html');
    const fn = TP.slice(TP.indexOf('function tpFullAuto_'), TP.indexOf('function announceOverdue'));
    t('計画書: 部品を読み込む・1ページで1回・現場の端末・接続先・索引と名簿が読めない時は写さない', /<script src="su-tp-full\.js\?v=/.test(TP)
      && /tpFullDone_ \|\| !window\.SUTpFull \|\| isFieldDevice\(\) \|\| !CFG\.url \|\| !IDX_OK \|\| ROSTER_SRC !== 'gas'/.test(fn) && /tpFullAuto_\(\);/.test(TP));
    t('計画書: 帯は最初は隠し・印刷しない・textContent', /id="tpfBand" role="status" hidden/.test(TP) && /@media print\{\.tpf-band\{display:none !important\}\}/.test(TP)
      && /\.tpf-band\[hidden\]\{display:none !important\}/.test(TP) && /el\.textContent = t/.test(fn) && !/innerHTML/.test(fn));
    const SH = read('SHADOW_HTML', 'shadow-check.html'), SJ = read('SHADOW_JS', 'shadow-check.js');
    const sf = SJ.slice(SJ.indexOf('function tpTarget'), SJ.indexOf('/* 入居者マスタの正本の切り替え（統合 0036'));
    t('写しの見比べ: ボタンは最初は隠し・管理者だけ・現場の端末では断る・確かめてから写す', /id="b-tp-full" hidden>計画書を全部写す</.test(SH)
      && /\$\('b-tp-full'\)\.hidden = !\(me && me\.role === 'admin'\)/.test(sf) && /role === 'field'/.test(sf) && /confirm\(/.test(sf) && !/innerHTML/.test(sf)
      && SH.indexOf('su-tp-full.js?v=') > 0 && SH.indexOf('su-tp-full.js?v=') < SH.indexOf('shadow-check.js?v='));
    t('公開の許可リストに載っている', /^!\/su-tp-full\.js$/m.test(read('GITIGNORE', '.gitignore')));
  }

  console.log('K 切り替える・戻す（cutover・back）');
  function cw(o) {
    o = o || {};
    const order = [], st = { switched: false, mode: 'shadow' };
    const w = world({ rpc: {
      tp_op_begin: a => { order.push('op:' + a.p_op); return o.busy ? { data: { ok: false, error: 'busy' }, error: null } : { data: { ok: true, token: 'TK' }, error: null }; },
      tp_op_end: a => { order.push('end:' + a.p_token); return { data: { ok: true }, error: null }; },
      tp_mode_get: () => ({ data: { ok: true, mode: st.mode }, error: null }),
      tp_import_mark_frozen: () => { order.push('frozen'); return { data: { ok: !o.frozenFail }, error: null }; },
      tp_set_mode: a => { order.push('mode:' + a.p_mode); if (o.modeErr && a.p_mode === 'live') return { data: { ok: false, error: o.modeErr }, error: null };
        st.mode = a.p_mode; if (o.lostLive && a.p_mode === 'live') return { data: null, error: { message: 'Failed to fetch' } }; return { data: { ok: true, mode: a.p_mode }, error: null }; }
    }, mangle: o.mangle });
    const g0 = w.gas;
    w.gas = async body => {
      if (body.action === 'tpCutover') {
        order.push('cut:' + body.on);
        if (body.accessToken !== 'h.p.s' || body.opToken !== 'TK') return { ok: false, error: 'Error: refused: 切り替えの操作の札がありません' };
        if (body.on) { st.switched = true; if (o.lostOn) throw new Error('Google に届きませんでした'); return { ok: true, switched: true }; }
        if (o.mirrorMore && o.mirrorMore-- > 0) return { ok: false, error: 'Error: refused: 写し返しが残っています。もう一度押してください' };
        st.switched = false; return { ok: true, switched: false, docs: 2 };
      }
      return g0(body);
    };
    w.token = async () => (o.noToken ? null : 'h.p.s');
    return { w, order, st };
  }
  {
    const { w, order, st } = cw();
    const r = await R.cutover(w);
    t('切り替える: 札→止める→止めた後の写し→切り替え→札を返す', r.ok === true && order.join(',') === 'op:cutover,cut:true,frozen,mode:live,end:TK' && st.mode === 'live' && st.switched, [r, order]);
    t('切り替える: 止めた後の印は写しの始まりの直後', w.rpcs.map(x => x.name).indexOf('tp_import_mark_frozen') === w.rpcs.map(x => x.name).indexOf('tp_import_begin') + 1);
  }
  for (const [label, o, re] of [['写しが Google と違う', { mangle: r => Object.assign({}, r, { rev: 99 }) }, /違う計画書/], ['止めた後の印を付けられない', { frozenFail: true }, /止めた後/],
                                ['切り替えが断られた（noop）', { modeErr: 'noop' }, /時間切れ/], ['止める指示の応答が届かない', { lostOn: true }, /届きません/]]) {
    const { w, order, st } = cw(o);
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
    t('戻す: 札→写しの期間→写し返しが残る間は続けて→印を外す→札を返す', r.ok === true && r.docs === 2 && order.join(',') === 'op:back,mode:shadow,cut:false,cut:false,cut:false,end:TK' && !st.switched, [r, order]);
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
      client: () => ({ from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }), rpc: async (n) => { calls.push(n); return n === 'tp_op_busy' ? { data: true, error: null } : { data: null, error: { code: 'x' } }; } }) };
    const r = await R.auto({ gas: async () => ({}), rosterIds: async () => [], auth: async () => A });
    t('自動の写し: 切り替える・戻すが動いている間は写さない', r.skip === 'op' && calls.join(',') === 'tp_mode_get,tp_op_busy', [r, calls]);
  }
  {
    const SH = read('SHADOW_HTML', 'shadow-check.html'), SJ = read('SHADOW_JS', 'shadow-check.js');
    const fn = SJ.slice(SJ.indexOf('function trainingOn'), SJ.indexOf('/* 入居者マスタの正本の切り替え（統合 0036'));
    t('写しの見比べ: 計画書の切り替える・戻すのボタンは最初は隠し、管理者だけ・スイッチ training が入の時だけ切り替えを出す',
      /id="b-tp-cut" hidden>計画書を新しい保存先へ切り替える</.test(SH) && /id="b-tp-back" hidden>計画書を写しの期間に戻す</.test(SH)
      && /if \(!\(me && me\.role === 'admin'\)\) return;/.test(fn) && /bc\.hidden = live \|\| stuck \|\| !on \|\| !tt \|\| !mt;/.test(fn) && /bb\.hidden = !\(live \|\| stuck\) \|\| !tt;/.test(fn));
    t('写しの見比べ: 押した時も管理者・現場の端末・スイッチを確かめ、2回確かめてから行う・textContent', /me\.status === SUAuth\.STATUS\.OK/.test(fn) && /role === 'field'/.test(fn)
      && /if \(!trainingOn\(\)\)/.test(fn) && (fn.match(/confirm\(/g) || []).length === 3 && !/innerHTML/.test(fn));
  }

  {
    const A = { STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role: 'admin' }),
      client: () => ({ from: () => { throw new Error('読まない'); }, rpc: async (n) => (n === 'tp_mode_get' ? { data: { ok: true, mode: 'live' }, error: null } : { data: null, error: { code: 'x' } }) }) };
    const r = await R.auto({ gas: async () => { throw new Error('読まない'); }, rosterIds: async () => [], auth: async () => A });
    t('自動の写し: 切り替えた後は Google を読まずに何もしない', r.skip === 'live', r);
  }

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
