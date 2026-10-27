/* 個別機能訓練計画書（training-plan.html）── 保存の要求にログインの証明を添える試験（2026-10-17 新設・改善プロンプト第2弾の6）
   実行: node check/unit/training_plan_editor_token_test.js
   守ること:
     1. 証明の取り出し: ログインの控え（sb-…-auth-token）が端末に無ければ問い合わせずに ''（supabase-js・su-auth.js も読み込まない）
        控えがあればセッションの access_token・取り出せない／失敗は ''・3秒の打ち切りを置く
     2. 保存（tpPut）と完全に削除（tpPutAllowDrop）の本文は従来と同じ形（action・key・data・rev／allowDrop）に、証明がある時だけ accessToken を足す
     3. 証明は端末の保存（localStorage）に残さない
     4. 共通データ層が無い時は今までどおり NO_DATA_LAYER で断る
   ★証明は試験用の作り物。氏名は使わない。TP_HTML で差し替えるのは、わざと壊した版で落ちるかの確認用。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* 本物の su-data.js（入口 SU.data.training）を読み、その先の kvRaw・kvPut だけを差し替える（2026-10-27・M1 段0） */
function realSuData(kvRaw, kvPut) {
  const w = { localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'su-data.js'), 'utf8'), { window: w });
  w.SU.data.kvRaw = kvRaw;
  if (kvPut) w.SU.data.kvPut = kvPut;
  return w.SU.data;
}

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.TP_HTML || path.join(ROOT, 'training-plan.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('閉じていません: ' + name);
}
function cutVar(src, name) {
  const m = src.match(new RegExp('var ' + name + ' = [\\s\\S]*?;\\n'));
  if (!m) throw new Error('変数が見つかりません: ' + name);
  return m[0];
}
const TOKEN = 'aaa.bbb.ccc';

function box(opt) {
  const o = opt || {};
  const store = {};
  if (o.login) store['sb-example123-auth-token'] = '{"x":1}';
  store.tp_ui_tab = 'list';
  const sets = [], sent = [], timers = [], loads = [];
  let gsCalls = 0;
  const auth = { client: () => ({ auth: { getSession: () => { gsCalls++;
    if (o.reject) return Promise.reject(new Error('x'));
    return Promise.resolve(o.session === undefined ? { data: { session: { access_token: TOKEN } } } : o.session); } } }) };
  const b = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { sets.push([k, v]); store[k] = String(v); },
      key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
    window: { SUAuth: auth, supabase: {} },
    document: { scripts: [], head: { appendChild: s => { loads.push(s.src); } }, createElement: () => ({}) },
    setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {},
    SU_READY: o.noLayer ? false : true,
    /* 本物の su-data.js の入口（SU.data.training.put）を通し、その先の kvRaw だけを偽物にする（2026-10-27） */
    SU: { data: realSuData((body, tgt) => { sent.push({ body: JSON.parse(JSON.stringify(body)), tgt }); return Promise.resolve({ ok: true, rev: 2 }); },
                  () => { throw new Error('kvPut は使わない'); }) },
    tpTarget: () => ({ endpoint: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'aikotoba' }),
    withTimeout: (p) => p,
    Promise, Date, String, Math, Array, Object, JSON, Number, Error
  };
  vm.createContext(b);
  vm.runInContext([cutVar(SRC, 'TP_SESSION_RE'), cutF(SRC, 'tpHasLogin_'), cutF(SRC, 'tpAuthLoad_'), cutF(SRC, 'tpAccessToken_'),
    cutF(SRC, 'tpPutBody_'), cutF(SRC, 'tpPut'), cutF(SRC, 'tpPutAllowDrop')].join('\n'), b);
  return { b, sets, sent, timers, loads, gs: () => gsCalls };
}

let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 試験が最後まで進まなかった（返らない約束がある）'); process.exitCode = 1; } });
(async function main() {
  console.log('\n— 1. 証明の取り出し —');
  {
    const x = box({});
    t('控えが無ければログインなし', x.b.tpHasLogin_() === false);
    const r = await x.b.tpAccessToken_();
    t('控えが無ければ問い合わせずに ""（読み込みもしない）', r === '' && x.gs() === 0 && x.loads.length === 0 && x.timers.length === 0, [r, x.gs(), x.loads]);
  }
  {
    const x = box({ login: true });
    t('控えがあればログインあり', x.b.tpHasLogin_() === true);
    t('ログイン中はセッションの access_token', (await x.b.tpAccessToken_()) === TOKEN);
    t('3秒の打ち切りを置く', x.timers.indexOf(3000) >= 0, x.timers);
    t('セッションが無ければ ""', (await box({ login: true, session: { data: { session: null } } }).b.tpAccessToken_()) === '');
    t('取り出しが失敗したら ""', (await box({ login: true, reject: true }).b.tpAccessToken_()) === '');
  }

  console.log('\n— 2. 保存の本文 —');
  {
    const x = box({ login: true });
    const r = await x.b.tpPut('training_plan:tp0001', { v: 1, plans: [] }, 3);
    const s = x.sent[0];
    t('保存は従来と同じ形＋accessToken', r.ok === true && x.sent.length === 1 && JSON.stringify(Object.keys(s.body)) === '["action","key","data","rev","accessToken"]'
      && s.body.action === 'put' && s.body.key === 'training_plan:tp0001' && s.body.rev === 3 && s.body.accessToken === TOKEN, s && s.body);
    t('接続先は計画書の接続先（tpTarget）', s.tgt.endpoint.indexOf('script.google.com') > 0, s.tgt);
    await x.b.tpPutAllowDrop('training_plan:tp0001', { v: 1, plans: [] }, 4);
    const d = x.sent[1].body;
    t('完全に削除は allowDrop:true のまま＋accessToken', d.action === 'put' && d.allowDrop === true && d.rev === 4 && d.accessToken === TOKEN, d);
    t('証明を端末に保存しない', x.sets.length === 0 && !Object.keys(x.b.localStorage).some(k => String(x.b.localStorage.getItem(k) || '').indexOf(TOKEN) >= 0), x.sets);
  }
  {
    const x = box({});
    await x.b.tpPut('training_plan:tp0001', { v: 1 }, 1);
    t('ログインしていない端末は accessToken を付けない（本文は従来と同じ4つ）', JSON.stringify(Object.keys(x.sent[0].body)) === '["action","key","data","rev"]', x.sent[0].body);
  }
  {
    const x = box({ noLayer: true });
    let err = null; try { await x.b.tpPut('k', {}, 0); } catch (e) { err = e; }
    t('共通データ層が無い時は NO_DATA_LAYER で断る（送らない）', !!err && err.message === 'NO_DATA_LAYER' && x.sent.length === 0, err && err.message);
  }
  finished = true;
  console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exitCode = fail ? 1 : 0;
})();
