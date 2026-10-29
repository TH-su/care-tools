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
     J 自動: 管理者が入居者マスタを開いた時、その日（日本時間）まだ写していなければ写す。前の試みから1時間は試さない。
       管理者でない・0034 が無い時は何もしない。全項目一致なら知らせず、違い・止まった時だけ帯（画面だけ・印刷しない）
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
  {
    const a = R._rosterIds([{ id: 3 }, { id: 1 }, { id: 2 }]), b = R._rosterIds([{ id: 3 }, { id: '' }, { id: ' 1' }, { id: 3 }, null, { id: 'x'.repeat(41) }, { id: 2 }]);
    t('並びは名簿のまま・数字も文字にそろえる', JSON.stringify(a.ids) === '["3","1","2"]' && a.bad.length === 0);
    t('空・前後の空白・重なり・41字以上は bad に入れる（黙って外さない）', b.bad.length === 5 && JSON.stringify(b.ids) === '["3","2"]', b);
    const w = world({ roster: [{ id: 1000 }, { id: ' 1001' }] });
    const r = await R.run(w);
    t('名簿の利用者No に形の違う方がいれば写しを始めない', !r.ok && /前後の空白/.test(r.why) && w.rpcs.length === 0, r);
  }

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
    t('失敗を返し、データベースを1回も呼ばない', !r.ok && w.rpcs.length === 0 && /写しは止めました/.test(r.why) && !/途中まで写した/.test(r.why), r);
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

  console.log('E 読む間に消えた方・会議の形・判断の上限・NUL');
  {


    const w2 = world({ n: 3 });
    const g0 = w2.gas;
    w2.gas = async (b) => (b.action === 'getResident' && String(b.id) === '1001') ? { record: null } : g0(b);
    const r = await R.run(w2);
    t('名簿にいるのに記録の無い方がいれば写しを始めない（黙って外さない）', !r.ok && /1001/.test(r.why) && w2.rpcs.length === 0, r);
  }

  {
    const w = world({ n: 2 });
    const g0 = w.gas;
    w.gas = async (b) => (b.action === 'meeting' && String(b.id) === '1001') ? { ok: false, code: 'bad_input', error: '利用者Noがありません' } : g0(b);
    const r = await R.run(w);
    t('担当者会議が利用者No の形で断った方は「会議なし」として写す', r.ok && r.residents === 2, r);
    const w2 = world({ n: 2 });
    const g2 = w2.gas;
    w2.gas = async (b) => b.action === 'meeting' ? { error: 'この入居者マスタは担当者会議の記録にまだ対応していません' } : g2(b);
    const r2 = await R.run(w2);
    t('担当者会議の口が無い古い GAS は、そう分かる文で止める', !r2.ok && /GAS が古い/.test(r2.why) && w2.rpcs.length === 0, r2);
    const w3 = world({ med: Array.from({ length: 3000 }, (_, i) => ({ srcKey: 'S|1000|2026-10-01|' + i, id: '1000' })) });
    const r3 = await R.run(w3);
    t('薬の判断が上限の3000件に届いたら写しを始めない（古い判断に消えた印を付けない）', !r3.ok && /3000/.test(r3.why) && w3.rpcs.length === 0, r3);
    const w4 = world({ recs: { 1001: { id: 1001, name: '見本', note: 'あ\u0000い' } } });
    const r4 = await R.run(w4);
    t('NUL の入った方がいれば利用者No と項目名を出して始めない', !r4.ok && /1001（note）/.test(r4.why) && w4.rpcs.length === 0, r4);
  }

  console.log('F データベースの断り');
  for (const [label, rpcOver, want, seq, part] of [
    ['begin が 42501', { res_import_begin: async () => ({ data: null, error: { code: '42501' } }) }, /管理者/, 'res_import_begin', false],
    ['0034 の前（関数が無い）', { res_import_begin: async () => ({ data: null, error: { code: 'PGRST202' } }) }, /0034/, 'res_import_begin', false],
    ['同時に別の写し（23505）', { res_import_begin: async () => ({ data: null, error: { code: '23505' } }) }, /同時に始まり/, 'res_import_begin', false],
    ['chunk が toolarge', { res_import_chunk: async () => ({ data: { ok: false, error: 'toolarge' }, error: null }) }, /大きすぎる/, 'res_import_begin,res_import_chunk,res_import_abort', true],
    ['chunk が 42501（例外）', { res_import_chunk: async () => ({ data: null, error: { code: '42501' } }) }, /管理者/, 'res_import_begin,res_import_chunk,res_import_abort', true],
    ['finish が incomplete', { res_import_finish: async () => ({ data: { ok: false, error: 'incomplete' }, error: null }) }, /写しきれません/, 'res_import_begin,res_import_chunk,res_import_finish,res_import_abort', true],
    ['finish が shrink', { res_import_finish: async () => ({ data: { ok: false, error: 'shrink' }, error: null }) }, /半分より少な/, 'res_import_begin,res_import_chunk,res_import_finish,res_import_abort', true],
  ]) {
    const w = world({ rpc: rpcOver });
    const r = await R.run(w);
    t(label + ' → 職員向けの文で止まり、その先を呼ばない（始めた後なら途中で止めた印を付け、途中まで写したと正直に言う）',
      !r.ok && want.test(r.why) && w.rpcs.map(x => x.name).join(',') === seq && /途中まで写した/.test(r.why) === part
      && !/前回のまま/.test(r.why), [r, w.rpcs.map(x => x.name)]);
  }
  {
    const w = world({ rpc: { res_get: async () => ({ data: null, error: { code: '42501' } }) } });
    const r = await R.run(w);
    t('写し終えた後の読み直しの失敗では取り消さない（写しは終わったと言う）', !r.ok && /写しは終わりましたが/.test(r.why) && !w.rpcs.some(x => x.name === 'res_import_abort'), r);
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

  console.log('J 自動で写す（代表者の決定 2026-10-29「自動で写す」）');
  {
    const NOW = Date.parse('2026-10-29T03:00:00Z');   // 日本時間 12:00
    const mkAuth = (role, runs, err) => {
      const calls = [];
      const A = { STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role }),
        client: () => ({ rpc: (n, a) => { calls.push(n); return w0.rpc(n, a); },
          from: () => ({ select: () => ({ order: () => ({ limit: async () => (err ? { error: { code: '42P01' } } : { data: runs }) }),
                                          eq: () => ({ limit: async () => ({ data: [{ unknown_keys: [] }] }) }) }) }) }) };
      return { A, calls };
    };
    let w0 = world({ n: 2 });
    for (const [label, role, runs, err, want] of [
      ['管理者でない（事務所）時は何もしない', 'office', [], false, 'role'],
      ['0034 の無いデータベースでは何もしない', 'admin', [], true, 'nodb'],
      ['今日（日本時間）もう写していれば何もしない', 'admin', [{ at: '2026-10-28T16:30:00Z', status: 'done' }], false, 'today'],
      ['前の試みから1時間たっていなければ試さない（止まった写しの繰り返しを防ぐ）', 'admin', [{ at: '2026-10-29T02:30:00Z', status: 'refused' }, { at: '2026-10-27T00:00:00Z', status: 'done' }], false, 'recent'],
    ]) {
      w0 = world({ n: 2 });
      const m = mkAuth(role, runs, err);
      const r = await R.auto({ gas: w0.gas, auth: async () => m.A, now: NOW });
      t(label, r.skip === want && m.calls.length === 0 && w0.gasCalls.length === 0, r);
    }
    w0 = world({ n: 2 });
    const m = mkAuth('admin', [{ at: '2026-10-28T14:59:00Z', status: 'done' }], false);   // 日本時間で前の日の 23:59
    const r = await R.auto({ gas: w0.gas, auth: async () => m.A, now: NOW });
    t('前の日に写した後なら写す（日本時間の日付で数える）', r.ok === true && r.cmp.same === 2 && m.calls.includes('res_import_finish'), r);
    t('全項目一致なら知らせない', R.autoNote(r) === '' && R.autoNote({ skip: 'today' }) === '');
    t('違いがある時・止まった時・区分の無い項目がある時は知らせる', /2人/.test(R.autoNote({ ok: true, cmp: { diff: [1], notInCopy: [1] }, run: { unknown: [] } }))
      && /取れませんでした/.test(R.autoNote({ ok: false, why: 'x' })) && /zzNew/.test(R.autoNote({ ok: true, cmp: { diff: [], notInCopy: [] }, run: { unknown: ['zzNew'] } })));
    const bad = await R.auto({ gas: w0.gas, auth: async () => { throw new Error('x'); } });
    t('例外は外へ出さない', bad.skip === 'error');
    t('日本時間の日付', R._jstDay('2026-10-28T15:00:00Z') === '2026-10-29' && R._jstDay('2026-10-28T14:59:59Z') === '2026-10-28');
  }
  {
    const RM = read('RESIDENT_MASTER_HTML', 'resident-master.html');
    const fn = RM.slice(RM.indexOf('function rmResFullAuto_'), RM.indexOf('function parseJson('));
    t('入居者マスタ: 部品を読み込む', /<script src="su-res-full\.js\?v=/.test(RM));
    t('入居者マスタ: 一覧をサーバーから読めた時に呼ぶ（写しの部品の直後）', /SUMasterShadow\.push\([^\n]*\n\s*if\(typeof rmResFullAuto_==='function'\)rmResFullAuto_\(\);/.test(RM));
    t('入居者マスタ: 1ページで1回・現場端末・接続先が無い時は何もしない', /rmResFullDone_\|\|!window\.SUResFull\|\|getDeviceRole\(\)==='field'\|\|!CFG\.url/.test(fn));
    t('入居者マスタ: 用途が変わった後（devGen）・画面が隠れている時は始めない', /dg!==devGen\|\|getDeviceRole\(\)==='field'\|\|document\.hidden/.test(fn));
    t('入居者マスタ: Google へは POST・text/plain・合言葉は本文・証明を添える', /method:'POST'/.test(fn) && /'Content-Type':'text\/plain;charset=utf-8'/.test(fn) && /token:CFG\.token/.test(fn) && /SUGasAuth/.test(fn));
    t('入居者マスタ: 帯は最初は隠し・印刷しない・文字は textContent', /id="rfBand" role="status" hidden/.test(RM) && /@media print\{\.rfband\{display:none !important\}\}/.test(RM)
      && /\.rfband\[hidden\]\{display:none !important\}/.test(RM) && /el\.textContent=t/.test(fn) && !/innerHTML/.test(fn));
  }

  console.log('K 切り替える・戻す（cutover・back）');
  function cw(o) {
    o = o || {};
    const order = [];
    const st = { switched: false, mode: 'shadow', tabs: {} };
    const w = world({ rpc: {
      res_import_mark_frozen: a => { order.push('frozen'); return { data: { ok: !o.frozenFail }, error: null }; },
      res_tabs_import: a => { order.push('tab:' + a.p_name); if (o.tabFail === a.p_name) return { data: { ok: false, error: 'live' }, error: null }; st.tabs[a.p_name] = a.p_rows; return { data: { ok: true }, error: null }; },
      res_set_mode: a => { order.push('mode:' + a.p_mode); if (o.modeErr && a.p_mode === 'live') return { data: { ok: false, error: o.modeErr }, error: null }; st.mode = a.p_mode; return { data: { ok: true, mode: a.p_mode }, error: null }; }
    }, mangle: o.mangle });
    const g0 = w.gas;
    w.gas = async body => {
      if (body.action === 'resCutover') {
        order.push('cut:' + body.on);
        if (body.accessToken !== 'h.p.s') return { error: 'Error: refused: ログイン' };
        if (body.on) { st.switched = true; return { ok: true, switched: true }; }
        if (o.mirrorMore && o.mirrorMore-- > 0) return { error: 'Error: refused: 写し返しが残っています。もう一度押してください' };
        st.switched = false; return { ok: true, switched: false, records: 2 };
      }
      if (body.action === 'exportTabs') { order.push('export'); return { ok: true, tabs: { med_dict: [['薬剤名'], ['見本薬']], meta: [[1]] } }; }
      return g0(body);
    };
    w.token = async () => (o.noToken ? null : 'h.p.s');
    return { w, order, st };
  }
  {
    const { w, order, st } = cw();
    const r = await R.cutover(w);
    t('切り替える: 止める→止めた後の写し→タブ7つ→切り替えの順', r.ok === true && order.join(',') === 'cut:true,frozen,export,tab:med_cand,tab:master_meeting,tab:master_meeting_hist,tab:master_yakujo_log,tab:master_dataJson_bak,tab:med_dict,tab:meta,mode:live'
      && st.mode === 'live' && st.switched === true && JSON.stringify(st.tabs.med_cand) === '[]' && JSON.stringify(st.tabs.med_dict) === '[["薬剤名"],["見本薬"]]', order);
    t('切り替える: 止めた後の写しは始まりの直後に印を付ける（写しの塊より前）', w.rpcs.map(x => x.name).indexOf('res_import_mark_frozen') === w.rpcs.map(x => x.name).indexOf('res_import_begin') + 1);
  }
  for (const [label, o, re] of [['写しが Google と違う方がいる', { mangle: r => Object.assign({}, r, { room: '違う' }) }, /違う方が 3人/],
                                ['止めた後の印を付けられない', { frozenFail: true }, /止めた後の写しの印/],
                                ['タブを写せない', { tabFail: 'med_dict' }, /もう切り替わっています/],
                                ['切り替えが断られた（notabs）', { modeErr: 'notabs' }, /タブ/]]) {
    const { w, order, st } = cw(o);
    const r = await R.cutover(w);
    t('切り替える: ' + label + ' → 止めて Google の保存を戻す', r.ok === false && re.test(r.why) && order[order.length - 1] === 'cut:false' && st.switched === false && st.mode === 'shadow', [r, order]);
  }
  {
    const { w, order } = cw({ noToken: true });
    const r = await R.cutover(w);
    t('切り替える: ログインの証明が無い時は何もしない', r.ok === false && /ログイン/.test(r.why) && order.length === 0 && w.rpcs.length === 0, [r, order]);
  }
  {
    const { w, order, st } = cw({ mirrorMore: 2 });
    st.mode = 'live'; st.switched = true;
    const r = await R.back(w);
    t('戻す: 写しの期間に戻してから、写し返しが残る間は続けて写し返し、印を外す', r.ok === true && r.records === 2 && order.join(',') === 'mode:shadow,cut:false,cut:false,cut:false'
      && st.mode === 'shadow' && st.switched === false, [r, order]);
  }
  {
    const { w, order, st } = cw({ noToken: true });
    st.mode = 'live'; st.switched = true;
    const r = await R.back(w);
    t('戻す: 写し返しが済まない時は、戻したことと押し直しを伝える', r.ok === false && /写しの期間には戻しました/.test(r.why) && st.mode === 'shadow' && st.switched === true, [r, order]);
  }
  t('切り替え・戻すは端末に保存しない', touched.length === 0);

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
