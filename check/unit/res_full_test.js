/* 入居者マスタの全項目の写し（su-res-full.js・統合 0034）の試験（2026-10-29 新設）
   実行: node check/unit/res_full_test.js
   対象を差し替える（壊した版で落ちることを確かめる）:
     RES_FULL_JS=/tmp/変異版.js node check/unit/res_full_test.js
     SHADOW_JS=/tmp/変異版.js  SHADOW_HTML=/tmp/変異版.html も同じ

   守ること:
     A 名簿の利用者No は空・重なり・長すぎる物を除き、並びは名簿のまま
     B 塊は 50 名・大きさの目安で区切り、1名で大きすぎる方がいれば写さない（データベースへは何も送らない）
     C 全員分を Google から読めてから写し始める。途中で Google が失敗したら、データベースを呼ばない
     D 写しは begin → chunk（50名ずつ・会議と判断は別の塊）→ finish（読めた全員・会議・判断の印）→ res_get（画面の名前 shadow-check）の順
     E 名簿にいるのに記録の無い方（読む間に消えた方）は写さず、finish にも渡さない。会議・判断の重なりは1件にする
     F データベースの断り（42501・incomplete・shrink・0034 の前）は職員向けの文にし、その先へ進まない
     G 見比べは項目名だけを返す（値・氏名を返さない）。キーの並びの違いは同じとみなす
     H 端末に保存しない（localStorage・sessionStorage を使わない）。Google へは読む操作だけを送る
     I 画面: ボタンは管理者だけ・現場の端末では断る・Google へは入居者マスタの読み方と同じ形（POST・text/plain・合言葉は本文）
   ★架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(ROOT, f), 'utf8');
const SRC = read('RES_FULL_JS', 'su-res-full.js');
const SHADOW = read('SHADOW_JS', 'shadow-check.js');
const HTML = read('SHADOW_HTML', 'shadow-check.html');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

function load() {
  const touched = [];
  const trap = new Proxy({}, { get(_, k) { touched.push(String(k)); return () => null; } });
  const ctx = { window: {}, TextEncoder, Promise, JSON, Object, Array, String, Math, Error, setTimeout, localStorage: trap, sessionStorage: trap };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUResFull, touched };
}

/* 架空の Google と データベース。db は 0034 と同じく「写した記録を合わせて返す」 */
function world(o) {
  o = o || {};
  const n = o.n || 3;
  const roster = o.roster || Array.from({ length: n }, (_, i) => ({ id: 1000 + i, name: '見本' + i }));
  const recs = {};
  roster.forEach(r => { recs[String(r.id)] = { id: r.id, name: r.name, room: '1' + r.id, active: true, allergy: '見本', diseases: '見本の病名', family: [{ relation: '長女', emergency: true }] }; });
  Object.assign(recs, o.recs || {});
  const gasCalls = [], rpcs = [];
  const db = {};
  let gasN = 0;
  const gas = async (body) => {
    gasCalls.push(JSON.parse(JSON.stringify(body)));
    gasN++;
    if (o.gasFailAt && gasN === o.gasFailAt) throw new Error('Google に届きませんでした');
    if (body.action === 'getRoster') return { roster };
    if (body.action === 'getResident') return { record: Object.prototype.hasOwnProperty.call(recs, String(body.id)) ? recs[String(body.id)] : null };
    if (body.action === 'meeting') return o.meetingErr ? { ok: false, code: 'head_mismatch', rows: [] } : { ok: true, rows: (o.meetings || {})[body.id] || [] };
    if (body.action === 'medCand') return { ok: true, rows: o.med || [] };
    return { error: '不明なaction' };
  };
  const rpc = async (name, args) => {
    rpcs.push({ name, args: JSON.parse(JSON.stringify(args)) });
    if (o.rpc && o.rpc[name]) return o.rpc[name](args);
    if (name === 'res_import_begin') return { data: { ok: true, run: 7 }, error: null };
    if (name === 'res_import_chunk') { args.p_rows.forEach(r => { db[r.id] = JSON.parse(JSON.stringify(r)); }); return { data: { ok: true, inserted: args.p_rows.length, updated: 0, unchanged: 0 }, error: null }; }
    if (name === 'res_import_finish') return { data: { ok: true, residents: args.p_ids.length, missing: 0 }, error: null };
    if (name === 'res_get') return { data: { ok: true, rows: args.p_ids.filter(id => db[id]).map(id => o.mangle ? o.mangle(db[id]) : db[id]) }, error: null };
    return { data: null, error: { code: 'PGRST202' } };
  };
  return { gas, rpc, gasCalls, rpcs, db, lastRun: async () => ({ unknown_keys: ['zzNew'] }), progress: () => {} };
}

(async () => {
  const { R, touched } = load();
  console.log('A 名簿の利用者No');
  t('空・重なり・41字以上を除き、並びは名簿のまま', JSON.stringify(R._rosterIds([{ id: 3 }, { id: '' }, { id: ' 1 ' }, { id: 3 }, null, { id: 'x'.repeat(41) }, { id: 2 }])) === '["3","1","2"]');

  console.log('B 塊');
  const c1 = R._chunk(Array.from({ length: 120 }, (_, i) => ({ id: String(i) })), 50, 1e9);
  t('120名は 50・50・20 に分かれる', JSON.stringify(c1.chunks.map(c => c.length)) === '[50,50,20]');
  const c2 = R._chunk([{ id: 'a', s: 'x'.repeat(600) }, { id: 'b', s: 'x'.repeat(600) }, { id: 'c', s: 'x'.repeat(600) }], 50, 1300);
  t('大きさの目安でも区切る', c2.chunks.length === 2);
  const c3 = R._chunk([{ id: 'a' }, { id: 'big', s: 'あ'.repeat(200) }], 50, 1e9, 300);
  t('1件で上限を超える物は big に分ける', c3.big.length === 1 && c3.big[0].id === 'big' && c3.chunks[0].length === 1);
  {
    const w = world({ recs: { 1001: { id: 1001, name: '見本1', supportLog: 'あ'.repeat(130000) } } });
    const r = await R.run(w);
    t('大きすぎる方がいれば写さず、データベースを呼ばない', !r.ok && /1001/.test(r.why) && w.rpcs.length === 0, r);
  }

  console.log('C Google が途中で失敗');
  {
    const w = world({ n: 6, gasFailAt: 5 });
    const r = await R.run(w);
    t('失敗を返し、データベースを1回も呼ばない', !r.ok && w.rpcs.length === 0 && /途中で止めました/.test(r.why), r);
    const w2 = world({ meetingErr: true });
    const r2 = await R.run(w2);
    t('担当者会議が読めない時も写さない', !r2.ok && w2.rpcs.length === 0, r2);
  }

  console.log('D 写す順番');
  {
    const meetings = { 1000: [{ meetingId: 'M1', residentId: '1000', status: 'final' }], 1001: [{ meetingId: 'M2' }] };
    const med = [{ srcKey: 'S|1000|2026-10-01|0000abcd', id: '1000', status: '反映' }, { srcKey: 'S|1000|2026-10-01|0000abcd', id: '1000' }, { srcKey: '', id: '1' }];
    const w = world({ n: 120, meetings, med });
    const r = await R.run(w);
    const names = w.rpcs.map(x => x.name);
    t('成功する', r.ok === true, r);
    t('begin → chunk ×4（50・50・20 名と会議の塊・判断の塊）→ finish → res_get', names.join(',') ===
      'res_import_begin,res_import_chunk,res_import_chunk,res_import_chunk,res_import_chunk,res_import_chunk,res_import_finish,res_get', names);
    const ch = w.rpcs.filter(x => x.name === 'res_import_chunk');
    t('人の塊は 50 名まで・写しの番号つき', ch.slice(0, 3).every(x => x.args.p_run === 7 && x.args.p_rows.length <= 50 && x.args.p_meetings.length === 0));
    t('会議は入居者の利用者No を付けて別の塊', JSON.stringify(ch[3].args.p_meetings.map(m => [m.meetingId, m.residentId])) === '[["M1","1000"],["M2","1001"]]' && ch[3].args.p_rows.length === 0);
    t('判断は重なりと印の無い物を除いて別の塊', ch[4].args.p_med.length === 1 && ch[4].args.p_med[0].srcKey === 'S|1000|2026-10-01|0000abcd');
    const fin = w.rpcs.find(x => x.name === 'res_import_finish').args;
    t('finish には全員の利用者No（文字）・会議・判断の印', fin.p_ids.length === 120 && fin.p_ids.every(x => typeof x === 'string')
      && JSON.stringify(fin.p_meeting_ids) === '["M1","M2"]' && JSON.stringify(fin.p_med_keys) === '["S|1000|2026-10-01|0000abcd"]');
    const g = w.rpcs.find(x => x.name === 'res_get').args;
    t('読み直しは画面の名前 shadow-check・1回 200 名まで', g.p_screen === 'shadow-check' && g.p_ids.length === 120);
    t('写した記録の利用者No は文字にそろえる（シートの数字でも同じ方）', ch[0].args.p_rows[0].id === '1000');
    t('全員一致・件数・分からない項目の名前', r.cmp.same === 120 && r.cmp.diff.length === 0 && r.meetings === 2 && r.medDecisions === 1
      && JSON.stringify(r.run.unknown) === '["zzNew"]' && r.run.inserted === 120);
    const acts = [...new Set(w.gasCalls.map(b => b.action + (b.op ? ':' + b.op : '')))].sort();
    t('Google へは読む操作だけ（getRoster・getResident・meeting:list・medCand:list）', JSON.stringify(acts) === '["getResident","getRoster","medCand:list","meeting:list"]', acts);
    t('Google へ送る本文に合言葉は入れない（画面のつなぎが足す）', w.gasCalls.every(b => !('token' in b)));
  }

  console.log('E 読む間に消えた方');
  {


    const w2 = world({ n: 3 });
    const g0 = w2.gas;
    w2.gas = async (b) => (b.action === 'getResident' && String(b.id) === '1001') ? { record: null } : g0(b);
    const r = await R.run(w2);
    const fin = w2.rpcs.find(x => x.name === 'res_import_finish').args;
    t('記録の無い方は写さず finish にも渡さない', r.ok && JSON.stringify(fin.p_ids) === '["1000","1002"]' && JSON.stringify(r.gone) === '["1001"]', r);
  }

  console.log('F データベースの断り');
  for (const [label, rpcOver, want, stopAt] of [
    ['begin が 42501', { res_import_begin: async () => ({ data: null, error: { code: '42501' } }) }, /管理者/, 'res_import_begin'],
    ['0034 の前（関数が無い）', { res_import_begin: async () => ({ data: null, error: { code: 'PGRST202' } }) }, /0034/, 'res_import_begin'],
    ['chunk が badrow', { res_import_chunk: async () => ({ data: { ok: false, error: 'badrow' }, error: null }) }, /形の合わない/, 'res_import_chunk'],
    ['finish が incomplete', { res_import_finish: async () => ({ data: { ok: false, error: 'incomplete' }, error: null }) }, /写しきれません/, 'res_import_finish'],
    ['finish が shrink', { res_import_finish: async () => ({ data: { ok: false, error: 'shrink' }, error: null }) }, /半分より少な/, 'res_import_finish'],
  ]) {
    const w = world({ rpc: rpcOver });
    const r = await R.run(w);
    t(label + ' → 職員向けの文で止まり、その先を呼ばない', !r.ok && want.test(r.why) && w.rpcs[w.rpcs.length - 1].name === stopAt, [r, w.rpcs.map(x => x.name)]);
  }

  console.log('G 見比べ');
  t('キーの並びの違いは同じ', R._diffKeys({ a: { x: 1, y: [1, { p: 2, q: 3 }] } }, { a: { y: [1, { q: 3, p: 2 }], x: 1 } }).length === 0);
  t('違う項目・片方にしか無い項目の名前だけ', JSON.stringify(R._diffKeys({ a: 1, b: '見本', c: null }, { a: 1, b: '別', d: 0 })) === '["b","c","d"]');
  {
    const w = world({ n: 2, mangle: r => r.id === '1001' ? Object.assign({}, r, { diseases: '違う' }) : r });
    const r = await R.run(w);
    t('写しと違う方は利用者No と項目名だけを返す（値は返さない）', r.ok && JSON.stringify(r.cmp.diff) === '[{"id":"1001","keys":["diseases"]}]'
      && !JSON.stringify(r.cmp).includes('違う') && !JSON.stringify(r.cmp).includes('見本'), r.cmp);
  }

  console.log('H 端末に保存しない');
  t('localStorage・sessionStorage に触れない', touched.length === 0, touched);
  t('ファイルに localStorage・sessionStorage・indexedDB の語が無い', !/localStorage|sessionStorage|indexedDB/.test(SRC));
  {
    let started = 0, maxRun = 0, running = 0;
    const p = R._pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (x) => { started++; running++; maxRun = Math.max(maxRun, running); await new Promise(r => setTimeout(r, 2)); running--; if (x === 2) throw new Error('x'); });
    let rejected = false; try { await p; } catch (e) { rejected = true; }
    await new Promise(r => setTimeout(r, 20));
    t('同時に3本まで・1本失敗したら残りを始めない', rejected && maxRun <= 3 && started < 8, { started, maxRun });
  }

  console.log('I 画面のつなぎ');
  t('ボタンは最初は隠し、管理者の時だけ出す', /id="b-res-full" hidden/.test(HTML) && /\$\('b-res-full'\)\.hidden = !\(me && me\.role === 'admin'\)/.test(SHADOW));
  t('部品は画面の動きより先に読む', HTML.indexOf('su-res-full.js?v=') > 0 && HTML.indexOf('su-res-full.js?v=') < HTML.indexOf('shadow-check.js?v='));
  const fn = SHADOW.slice(SHADOW.indexOf('async function runResFull'), SHADOW.indexOf('/* 体重の切り替え（統合 0032）'));
  t('押した時に管理者（2段階）を確かめる', /me\.role === 'admin' && me\.status === SUAuth\.STATUS\.OK/.test(fn));
  t('現場の端末では断る', /su_device_role[\s\S]*=== 'field'/.test(fn));
  const post = SHADOW.slice(SHADOW.indexOf('function rmasterPost'), SHADOW.indexOf('async function loadResFullRuns'));
  t('Google へは POST・text/plain・redirect follow・合言葉は本文', /method: 'POST'/.test(post) && /'Content-Type': 'text\/plain;charset=utf-8'/.test(post)
    && /redirect: 'follow'/.test(post) && /token: tgt\.token/.test(post) && /SUGasAuth/.test(post) && !/\?token|&token/.test(post));
  t('接続先は入居者マスタの接続先（rmaster_cfg）', /var tgt = rmasterTarget\(\)/.test(fn));
  t('結果は textContent で出す（innerHTML を使わない）', !/innerHTML/.test(fn) && !/innerHTML/.test(SRC));

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
