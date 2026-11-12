/* 入居者マスタを Supabase の正本から読む口（su-res-read.js・正本の切り替えの手順4）の試験（2026-10-29 新設）
   実行: node check/unit/res_read_test.js
   対象を差し替える: RES_READ_JS=/tmp/変異版.js node check/unit/res_read_test.js

   守ること:
     A 同じ形: 入居者マスタのシート（架空）から GAS の読み取り関数が返す応答と、写しの記録（全項目の写しと同じ作り方）から
       この部品が作る応答が、getRoster・getResident・getSection（事務所・現場の項目）・getBulk・getListFull・getMedsBulk で同じ
     B スイッチ master_live が切・読めない時は Google へ送る関数をそのまま呼ぶ（本文は同じもの・データベースを呼ばない）
     C スイッチが入でも、データベースの印が写しの期間・0036 の前（関数が無い）なら Google
     D スイッチが入で印が「切り替えた後」なら Supabase から読み、Google を呼ばない。断られた時も Google へ流さず失敗にする
     E スイッチが入の時、ログインしていない・印を読めない（通信の失敗）は Google へ流さずに失敗にする
     F 読み取り以外の本文（保存など）はこの部品を通っても Google へ送る関数をそのまま呼ぶ
     G 名簿は res_roster（開いた記録を残さない）、1人・一覧は res_get（画面の名前を付ける・200名ずつ）
     H 端末に保存しない（localStorage へは書かない）
     I 名簿だけを読む画面の入口（officeOnly・2026-11-02）: 事務所PCの事務所・管理者のログインで印が「切り替えた後」の時だけ Supabase。
       ログインしていない・確かめられない・現場のアカウント・現場の端末・写しの期間は Google（データベースの印も読まない）
     L 接続先の無い端末で、ログインだけで使えるか（liveReady・2026-11-08）: 5つがそろう時だけ true・例外を出さない・端末に書かない・8秒で打ち切り
       画面のつなぎ（入居者マスタ・フェイスシートの本物の関数）: 確かめは1回だけ・使える時だけ接続設定の帯を止める・起動は確かめてから進む・
       デイ利用日は新しい保存先から読めた時だけ使い Google へ送らない（2つの画面で同じ文面）・読み書きは新しい保存先だけで Google へ0件・
       Google へ直接行く所（全項目の写し・薬効辞書・薬の変更候補・薬情の取り込み）は今までどおり接続先がある時だけ
   ★架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
/* 入居者マスタの画面のスクリプトは 2026-11-13 に resident-master.js へ移した（判定の区間 MC-JUDGE だけ HTML に残す）。移す前と同じ文字に戻して確かめる */
const { readMaster } = require('../master-page.cjs');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.RES_READ_JS || path.join(ROOT, 'su-res-read.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });

function load(o) {
  o = o || {};
  const writes = [];
  const store = Object.assign({ su_backend_flags: o.flags === undefined ? null : JSON.stringify(o.flags) }, o.store || {});
  const ctx = {
    window: {}, JSON, Object, Array, String, Number, Math, Error, Promise, Date, RegExp, isNaN, isFinite, parseInt, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = v; }, removeItem: k => { writes.push(k); } },
    fetch: (u) => { fetches.push(String(u)); return Promise.reject(new Error('no network')); }
  };
  const fetches = [];
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUResRead, writes, win: ctx.window, fetches };
}

/* 架空の入居者マスタのシート（GAS の HEADERS の順）。形の違う値も混ぜる */
const D = (o) => JSON.stringify(o);
const SHEET = [
  ['r1', '見本 甲', 'みほん こう', '101', '男', '要介護2', true, '2026-10-01T00:00:00.000Z',
    D({ birthDate: '1940-01-01', height: 150, hospital: '見本病院\n第二', doctor: '見本医師', visitDay: '火', hospitalized: false,
        allergy: '見本', mealForm: 'きざみ', mealStaple: '粥', copayRate: 1, preferredName: 'こうさん', diseases: '見本の病名', medsRegular: '見本薬 1錠',
        medsHistory: [{ d: '2026-10-01', t: '見本' }], insuredNo: '0000000001', welfare: '見本', family: [{ name: '見本 乙', relation: '長女', phone: '000', emergency: 'true', kp: 1 }, { name: '' }],
        careOffice: '見本事業所', adlGrid: { a: 1 }, supportLog: [{ d: '2026-10-01' }], dischargeTo: '', zzNew: '見本' }), 'excretion,weight'],
  ['r2', '見本 丁', 'みほん てい', '102', '女', '要介護3', '退去', '2026-09-01T00:00:00.000Z',
    D({ dischargeDate: '2026-09-01', hospital: '見本病院', medsRegular: '', family: 'こわれた値' }), ''],
  ['r3', '見本 戊', '', '103', '', '', true, '', D({ hospitalized: 'true', height: '', visitDay: { x: 1 } }), 'schedule'],
  ['r4', '見本 己', 'みほん き', '104', '女', '要支援1', true, '2026-10-02T00:00:00.000Z', '{}', '']
];

(async () => {
  const { R, writes } = load();
  const G = R._gas;
  const j = (x) => JSON.parse(JSON.stringify(x));

  /* 正本: 架空のシートに GAS の読み取り関数を当てた応答 */
  G.setRows(SHEET.map(r => r.slice()));
  const want = {
    roster: j({ roster: G.getRoster() }),
    resident: SHEET.map(r => j({ record: G.getResident(r[0]) })),
    sectionFull: j({ section: G.getSection('r1', 'medical') }),
    bulk: j({ rows: G.getBulk() }),
    listFull: j({ rows: G.getListFull_() }),
    meds: j({ rows: G.getMedsBulk_('r1,r2,r3') }),
    meal: j({ rows: G.getMealList() })
  };
  G.setRows([]);
  /* 写し: 全項目の写し（su-res-full.js）と同じく getResident の記録を、利用者No を文字にそろえて持つ */
  const recs = want.resident.map(x => Object.assign({}, x.record, { id: String(x.record.id) }));
  /* 名簿の口（res_roster）が返す形: 基本の項目＋訪問日・かかりつけ病院・主治医（0036） */
  const ROSTER_KEYS = ['id', 'name', 'kana', 'room', 'gender', 'careLevel', 'active', 'updatedAt', 'targetApps', 'birthDate', 'height', 'dischargeDate', 'hospitalized', 'doctor', 'visitDay', 'hospital'];
  const rosterRecs = recs.map(r => { const o = {}; ROSTER_KEYS.forEach(k => { if (k in r) o[k] = r[k]; }); return o; });

  console.log('A 同じ形（架空のシート4名）');
  t('getRoster（名簿の口の項目だけから作っても同じ）', JSON.stringify(R._answer('getRoster', {}, rosterRecs)) === JSON.stringify(want.roster), [R._answer('getRoster', {}, rosterRecs), want.roster]);
  t('getRoster の since（更新の後だけ）', JSON.stringify(R._answer('getRoster', { since: '2026-09-15' }, rosterRecs).roster.map(r => r.id)) === '["r1","r4"]');
  SHEET.forEach((r, i) => {
    t('getResident ' + r[0], JSON.stringify(R._answer('getResident', { id: r[0] }, recs)) === JSON.stringify(want.resident[i]), [R._answer('getResident', { id: r[0] }, recs), want.resident[i]]);
  });
  t('getResident 無い方は null', JSON.stringify(R._answer('getResident', { id: 'r9' }, recs)) === '{"record":null}');
  t('getSection（事務所の項目）', JSON.stringify(R._answer('getSection', { id: 'r1', section: 'medical' }, recs)) === JSON.stringify(want.sectionFull));
  t('getBulk', JSON.stringify(R._answer('getBulk', {}, recs)) === JSON.stringify(want.bulk), [R._answer('getBulk', {}, recs), want.bulk]);
  t('getListFull', JSON.stringify(R._answer('getListFull', {}, recs)) === JSON.stringify(want.listFull));
  t('getMedsBulk', JSON.stringify(R._answer('getMedsBulk', { ids: 'r1,r2,r3' }, recs)) === JSON.stringify(want.meds));
  t('getMealList', JSON.stringify(R._answer('getMealList', {}, recs)) === JSON.stringify(want.meal));
  /* 現場: データベースは現場の項目だけを返す（res_get）。その記録から作る現場の項目の応答が、正本の現場の項目と同じ */
  G.setRows(SHEET.map(r => r.slice()));
  const wantSafe = j({ section: G.getSection('r1', 'facesheet_safe') });
  G.setRows([]);
  const FIELD_KEYS = ['id', 'name', 'kana', 'room', 'gender', 'careLevel', 'active', 'preferredName', 'hospitalized', 'allergy', 'allergenTags', 'forbiddenTags', 'infections', 'medicalCare', 'formAdjust', 'careHints', 'mealForm', 'thickener', 'swallow', 'denture', 'mobility', 'problemBehavior', 'medMgmt', 'medAssist', 'medRefusal', 'adlGrid', 'moveAid', 'excreteWay', 'bathPlace', 'medLevel', 'medExists', 'bpsd', 'night'];
  const fieldRec = (() => { const o = {}; FIELD_KEYS.forEach(k => { if (k in recs[0]) o[k] = recs[0][k]; }); o.emergencyContact = { relation: '長女', phone: '000' }; return o; })();
  t('getSection（現場の項目・現場のアカウントの記録から）', JSON.stringify(R._answer('getSection', { id: 'r1', section: 'facesheet_safe' }, [fieldRec])) === JSON.stringify(wantSafe), [R._answer('getSection', { id: 'r1', section: 'facesheet_safe' }, [fieldRec]), wantSafe]);
  t('仮の行は呼んだ後に空へ戻す（次の呼び出しへ残さない）', JSON.stringify(R._answer('getRoster', {}, [])) === '{"roster":[]}');

  /* ── 道の振り分け ── */
  function auth(o) {
    const calls = [];
    const A = { STATUS: { OK: 'ok' }, check: async () => (o.signedOut ? { status: 'signed_out' } : { status: 'ok', role: o.role || 'office' }),
      client: () => ({ rpc: async (n, a) => {
        calls.push([n, a]);
        if (n === 'res_mode_get') return o.modeErr ? { error: o.modeErr } : { data: { mode: o.mode || 'shadow' } };
        if (n === 'res_roster') return o.rosterErr ? { error: o.rosterErr } : { data: { ok: true, rows: rosterRecs } };
        if (n === 'res_get') return o.getErr ? { error: o.getErr } : { data: { ok: true, rows: recs.filter(r => a.p_ids.indexOf(r.id) >= 0) } };
        return { error: { code: 'PGRST202' } };
      } }) };
    return { io: { auth: async () => A }, calls };
  }
  const gasCalls = [];
  const gasFn = (b) => { gasCalls.push(b); return Promise.resolve({ via: 'gas' }); };

  console.log('B スイッチが切');
  for (const [label, flags] of [['スイッチが無い', null], ['master_live が切', { supabase: { master_live: false } }], ['形の違うスイッチ', { supabase: 'x' }]]) {
    const { R: R2 } = load({ flags });
    const a = auth({ mode: 'live' });
    gasCalls.length = 0;
    const body = { action: 'getResident', id: 'r1', token: 'x' };
    const r = await R2.call(body, gasFn, { screen: 'facesheet' }, a.io);
    t(label + ' → Google へ同じ本文で送り、データベースを呼ばない', r.via === 'gas' && gasCalls[0] === body && a.calls.length === 0);
  }

  console.log('C スイッチが入・印が写しの期間');
  for (const [label, o] of [['印が写しの期間', { mode: 'shadow' }], ['0036 の前（関数が無い）', { modeErr: { code: 'PGRST202' } }]]) {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = auth(o);
    gasCalls.length = 0;
    const r = await R2.call({ action: 'getRoster' }, gasFn, { screen: 'care-schedule' }, a.io);
    t(label + ' → Google', r.via === 'gas' && gasCalls.length === 1 && a.calls.every(c => c[0] === 'res_mode_get'));
  }

  console.log('D 切り替えた後');
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = auth({ mode: 'live' });
    gasCalls.length = 0;
    const r1 = await R2.call({ action: 'getResident', id: 'r1' }, gasFn, { screen: 'facesheet' }, a.io);
    t('getResident は Supabase から・Google を呼ばない・GAS と同じ形', gasCalls.length === 0 && JSON.stringify(r1) === JSON.stringify(want.resident[0]));
    t('res_get に画面の名前を付ける', a.calls.some(c => c[0] === 'res_get' && c[1].p_screen === 'facesheet' && JSON.stringify(c[1].p_ids) === '["r1"]'));
    const r2 = await R2.call({ action: 'getRoster' }, gasFn, { screen: 'care-schedule' }, a.io);
    t('getRoster は res_roster だけ（res_get を呼ばない＝開いた記録を残さない）', JSON.stringify(r2) === JSON.stringify(want.roster)
      && a.calls.filter(c => c[0] === 'res_get').length === 1);
    const r3 = await R2.call({ action: 'getBulk' }, gasFn, { screen: 'resident-master' }, a.io);
    t('getBulk は名簿の全員を res_get で読んで作る', JSON.stringify(r3) === JSON.stringify(want.bulk));
    t('印は1分のあいだ読み直さない', a.calls.filter(c => c[0] === 'res_mode_get').length === 1);
  }
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = auth({ mode: 'live', getErr: { code: '42501' } });
    gasCalls.length = 0;
    let err = null;
    try { await R2.call({ action: 'getResident', id: 'r1' }, gasFn, { screen: 'facesheet' }, a.io); } catch (e) { err = e; }
    t('断られた時は Google へ流さず、職員向けの文で失敗にする', err && /権限/.test(err.message) && gasCalls.length === 0, err && err.message);
  }
  {
    const many = Array.from({ length: 450 }, (_, i) => ({ id: 'm' + i, name: '見本', active: true }));
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const calls = [];
    const A = { STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role: 'office' }),
      client: () => ({ rpc: async (n, a) => { calls.push([n, a]); if (n === 'res_mode_get') return { data: { mode: 'live' } };
        if (n === 'res_roster') return { data: { ok: true, rows: many } };
        return { data: { ok: true, rows: many.filter(r => a.p_ids.indexOf(r.id) >= 0) } }; } }) };
    const r = await R2.call({ action: 'getListFull' }, gasFn, { screen: 'resident-master' }, { auth: async () => A });
    const gets = calls.filter(c => c[0] === 'res_get');
    t('一覧は 200名ずつ読む', gets.length === 3 && gets.every(c => c[1].p_ids.length <= 200) && r.rows.length === 450);
  }

  console.log('E ログインしていない・印を読めない');
  for (const [label, o, re] of [['ログインしていない', { signedOut: true }, /ログインしていません/], ['印を読めない（通信の失敗）', { modeErr: { code: '08006' } }, /読めませんでした/]]) {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = auth(o);
    gasCalls.length = 0;
    let err = null;
    try { await R2.call({ action: 'getResident', id: 'r1' }, gasFn, {}, a.io); } catch (e) { err = e; }
    t(label + ' → Google へ流さず失敗', err && re.test(err.message) && gasCalls.length === 0, err && err.message);
  }

  console.log('F 読み取り以外');
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = auth({ mode: 'live' });
    gasCalls.length = 0;
    const body = { action: 'saveResident', record: { id: 'r1' } };
    const r = await R2.call(body, gasFn, {}, a.io);
    t('保存の本文はそのまま Google へ（この部品は読み取りだけ）', r.via === 'gas' && gasCalls[0] === body && a.calls.length === 0);
  }

  console.log('I 画面のつなぎ（スイッチが切の間は今までの関数をそのまま呼ぶ）');
  for (const [f, fn, screen] of [['facesheet.html', 'apiGet', 'facesheet'], ['care-meeting.html', 'apiGet', 'care-meeting'], ['resident-master.html', 'apiGet', 'resident-master'],
                                 ['training-plan.html', 'mGet', 'training-plan'], ['admission-flow.html', 'masterGet', 'admission-flow']]) {
    const H = readMaster(path.join(ROOT, f));
    const line = (H.match(new RegExp('^' + fn + '=function\\(.*$', 'm')) || [''])[0];
    t(f + ': 部品を読み込み、' + fn + ' を口に通す（画面の名前 ' + screen + '）', /<script src="su-res-read\.js\?v=/.test(H)
      && new RegExp('^var ' + fn + 'Gas_=' + fn + ';$', 'm').test(H) && line.indexOf("{screen:'" + screen + "'}") > 0);
    // 部品が無い時・スイッチが切の時は、同じ引数で元の関数を呼ぶ（本文を作り直さない）
    const calls = [];
    const box = { window: {}, calls };
    vm.createContext(box);
    vm.runInContext('function ' + fn + '(a,b){calls.push([a,b]);return "gas";}\n' + H.match(new RegExp('^var ' + fn + 'Gas_=' + fn + ';$', 'm'))[0] + '\n' + line, box);
    const r0 = vm.runInContext(fn + '({action:"getResident",id:"r1"},123)', box);
    box.window.SUResRead = { call: (b, g, o) => { calls.push(['via', o.screen]); return g(b); } };
    const r1 = vm.runInContext(fn + '({action:"getRoster"},45)', box);
    t(f + ': 部品が無い時も口を通る時も、元の関数を同じ引数で呼ぶ', r0 === 'gas' && r1 === 'gas' && JSON.stringify(calls) === JSON.stringify([[{ action: 'getResident', id: 'r1' }, 123], ['via', screen], [{ action: 'getRoster' }, 45]]), calls);
  }

  console.log('J 保存（write）');
  function authW(o) {
    const calls = [];
    const A = { STATUS: { OK: 'ok' }, check: async () => (o.signedOut ? { status: 'signed_out' } : { status: 'ok', role: 'office' }),
      client: () => ({
        rpc: async (n) => { calls.push(['rpc', n]); return o.modeErr ? { error: o.modeErr } : { data: { mode: o.mode || 'shadow' } }; },
        functions: { invoke: async (name, opt) => { calls.push(['invoke', name, JSON.parse(JSON.stringify(opt.body))]);
          if (o.netErr) return { data: null, error: { message: 'x' } };
          if (o.refuse) return { data: null, error: { context: { json: async () => o.refuse } } };
          return { data: o.reply || { ok: true }, error: null }; } }
      }) };
    return { io: { auth: async () => A }, calls };
  }
  for (const [label, flags, o] of [['スイッチが切', null, { mode: 'live' }], ['印が写しの期間', { supabase: { master_live: true } }, { mode: 'shadow' }],
                                   ['0036 の前', { supabase: { master_live: true } }, { modeErr: { code: 'PGRST202' } }]]) {
    const { R: R2 } = load({ flags });
    const a = authW(o);
    gasCalls.length = 0;
    const body = { action: 'saveResident', record: { id: 'r1' }, token: 'x' };
    const r = await R2.write(body, gasFn, { screen: 'resident-master', parse: 'throw' }, a.io);
    t(label + ' → Google へ同じ本文で送り、res-write を呼ばない', r.via === 'gas' && gasCalls[0] === body && !a.calls.some(c => c[0] === 'invoke'));
  }
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = authW({ mode: 'live', reply: { record: { id: 'r1' } } });
    gasCalls.length = 0;
    const r = await R2.write({ action: 'saveResident', record: { id: 'r1' }, token: 'x', accessToken: 'a.b.c' }, gasFn, { screen: 'resident-master', parse: 'throw' }, a.io);
    const inv = a.calls.find(c => c[0] === 'invoke');
    t('切り替えた後: res-write へ同じ本文（合言葉だけ外す）・Google を呼ばない・応答をそのまま返す', gasCalls.length === 0 && inv && inv[1] === 'res-write'
      && JSON.stringify(inv[2]) === '{"action":"saveResident","record":{"id":"r1"},"accessToken":"a.b.c"}' && JSON.stringify(r) === '{"record":{"id":"r1"}}');
  }
  for (const [label, o, parse, check] of [
    ['res-write の断り（GAS と同じ {error}）は throw の読み方で失敗', { mode: 'live', refuse: { error: 'Error: conflict', code: 'x' } }, 'throw', (r, e) => e && e.message === 'Error: conflict'],
    ['raw の読み方: ok を持つ断りは返す', { mode: 'live', reply: { ok: false, error: '見本の断り' } }, 'raw', (r, e) => !e && r.ok === false],
    ['raw の読み方: ok を持たない断りは失敗', { mode: 'live', reply: { error: '見本の断り' } }, 'raw', (r, e) => e && e.message === '見本の断り'],
    ['json の読み方はそのまま', { mode: 'live', reply: { ok: false, code: 'conflict' } }, 'json', (r, e) => !e && r.code === 'conflict'],
    ['届かない時は Google へ流さず失敗', { mode: 'live', netErr: true }, 'json', (r, e) => e && /届きませんでした/.test(e.message)],
    ['ログインしていない時は Google へ流さず失敗', { signedOut: true }, 'json', (r, e) => e && /ログインしていません/.test(e.message)],
  ]) {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = authW(o);
    gasCalls.length = 0;
    let r = null, e = null;
    try { r = await R2.write({ action: 'setState', id: 'r1', token: 'x' }, gasFn, { screen: 'care-schedule', parse }, a.io); } catch (err) { e = err; }
    t(label, check(r, e) && gasCalls.length === 0, [r, e && e.message]);
  }
  for (const [f, fn, screen, parse] of [['resident-master.html', 'apiPost', 'resident-master', 'throw'], ['resident-master.html', 'apiPostRaw', 'resident-master', 'raw'],
                                        ['care-meeting.html', 'meetingPost_', 'care-meeting', 'json'], ['admission-flow.html', 'masterPost', 'admission-flow', 'throw']]) {
    const H = readMaster(path.join(ROOT, f));
    const line = (H.match(new RegExp('^' + fn.replace('$', '\\$') + '=function\\(.*$', 'm')) || [''])[0];
    t(f + ': ' + fn + ' を保存の口に通す（' + screen + '・' + parse + '）', new RegExp('^var ' + fn + 'Gas_=' + fn + ';$', 'm').test(H)
      && line.indexOf('SUResRead.write(') > 0 && line.indexOf("{screen:'" + screen + "',parse:'" + parse + "'}") > 0);
  }
  {
    const H = fs.readFileSync(path.join(ROOT, 'care-schedule.html'), 'utf8');
    t('週間計画: 入院の印は同じ本文（action・token・id・hospitalized・src の順）を保存の口に通す', /var msBody = \{ action: 'setState', token: cfg\.token, id: masterId, hospitalized: !!hospitalized, src: 'care' \};/.test(H)
      && /body: JSON\.stringify\(msBody\)/.test(H) && /window\.SUResRead\.write\(msBody, msSend, \{ screen: 'care-schedule', parse: 'json' \}\)/.test(H)
      && /<script src="su-res-read\.js\?v=/.test(H));
  }

  console.log('K Google への写し返し（resMirror）');
  function authM(o) {
    const a = authW(o);
    const A0 = a.io.auth;
    a.io.auth = async () => { const A = await A0(); const c = A.client; A.client = () => Object.assign(c(), { auth: { getSession: async () => ({ data: { session: o.noSession ? null : { access_token: 'h.p.s' } } }) } }); return A; };
    a.sent = [];
    a.io.cfg = () => (o.noCfg ? null : { url: 'https://script.example/exec', token: 'T' });
    a.io.fetch = async (url, opt) => { a.sent.push([url, opt]); if (o.gate) await o.gate; return { json: async () => ({ ok: true, records: 1 }) }; };
    return a;
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = authM({ mode: 'live', reply: { record: { id: 'r1' } } });
    await R2.write({ action: 'saveResident', record: { id: 'r1' }, token: 'x' }, gasFn, { screen: 'resident-master', parse: 'throw' }, a.io);
    for (let i = 0; i < 5; i++) await tick();
    const s0 = a.sent[0] || [];
    t('切り替えた後に保存できたら、Google へ写し返しを1回送る（各画面と同じ送り方・合言葉とログインの証明）', a.sent.length === 1 && s0[0] === 'https://script.example/exec'
      && s0[1].method === 'POST' && s0[1].headers['Content-Type'] === 'text/plain;charset=utf-8' && s0[1].redirect === 'follow'
      && s0[1].body === '{"action":"resMirror","token":"T","accessToken":"h.p.s"}', a.sent.map(x => x[1] && x[1].body));
  }
  for (const [label, flags, o] of [['スイッチが切', null, { mode: 'live' }], ['印が写しの期間', { supabase: { master_live: true } }, { mode: 'shadow' }],
                                   ['断られた保存', { supabase: { master_live: true } }, { mode: 'live', refuse: { error: 'Error: conflict' } }],
                                   ['接続先の無い端末', { supabase: { master_live: true } }, { mode: 'live', noCfg: true }],
                                   ['ログインの証明が無い', { supabase: { master_live: true } }, { mode: 'live', noSession: true }]]) {
    const { R: R2 } = load({ flags });
    const a = authM(o);
    try { await R2.write({ action: 'saveResident', record: { id: 'r1' }, token: 'x' }, gasFn, { screen: 'resident-master', parse: 'throw' }, a.io); } catch (e) { /* 断りは失敗のまま */ }
    for (let i = 0; i < 5; i++) await tick();
    t(label + ' → 写し返しを送らない', a.sent.length === 0);
  }
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    let open; const gate = new Promise(r => { open = r; });
    const a = authM({ mode: 'live', reply: { ok: true }, gate });
    for (let i = 0; i < 4; i++) await R2.write({ action: 'setState', id: 'r1', token: 'x' }, gasFn, { screen: 'care-schedule', parse: 'json' }, a.io);
    for (let i = 0; i < 5; i++) await tick();
    const during = a.sent.length;
    open();
    for (let i = 0; i < 10; i++) await tick();
    t('続けて保存しても、送っている間は待ち、終わった後にもう1回だけ送る', during === 1 && a.sent.length === 2, [during, a.sent.length]);
  }
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    const a = authM({ mode: 'live' });
    for (let i = 0; i < 2; i++) { try { await R2.call({ action: 'getRoster' }, gasFn, { screen: 'resident-master' }, a.io); } catch (e) { /* 名簿の口は模擬に無い */ } }
    for (let i = 0; i < 5; i++) await tick();
    t('切り替えた後に開いた時、1ページで1回だけ写し返しの残りを追いつかせる', a.sent.length === 1, a.sent.length);
  }
  {
    const { R: R2 } = load({ flags: { supabase: { master_live: true } } });
    let n = 0;
    const a = authM({ mode: 'live', reply: { ok: true } });
    a.io.fetch = async (url, opt) => { a.sent.push([url, opt]); n++; return { json: async () => ({ ok: true, more: n === 1 }) }; };
    await R2.write({ action: 'setState', id: 'r1', token: 'x' }, gasFn, { screen: 'care-schedule', parse: 'json' }, a.io);
    for (let i = 0; i < 10; i++) await tick();
    t('写しきれなかった残り（more）があれば続けて送る', a.sent.length === 2, a.sent.length);
  }

  console.log('I 名簿だけを読む画面の入口（officeOnly）');
  {
    const ON = { supabase: { master_live: true } };
    const run = async (o, store) => {
      const { R: R3 } = load({ flags: ON, store });
      const a = o === null ? { io: { auth: async () => null }, calls: [] } : auth(o);
      const before = gasCalls.length;
      let r, err = null;
      try { r = await R3.call({ action: 'getRoster' }, gasFn, { screen: 'daycare-roster', officeOnly: true }, a.io); } catch (e) { err = e; }
      return { r, err, gas: gasCalls.length - before, rpc: a.calls.map(c => c[0]) };
    };
    let x = await run({ mode: 'live', role: 'office' });
    t('事務所のログイン・切り替えた後 → Supabase の名簿（訪問日・かかりつけ病院つき）・Google を呼ばない',
      x.gas === 0 && x.r && JSON.stringify(x.r) === JSON.stringify(want.roster) && x.rpc.join() === 'res_mode_get,res_roster', x);
    x = await run({ mode: 'live', role: 'admin' });
    t('管理者のログインも同じ', x.gas === 0 && x.r && Array.isArray(x.r.roster), x);
    x = await run({ mode: 'shadow', role: 'office' });
    t('写しの期間 → Google', x.gas === 1 && x.r.via === 'gas', x);
    x = await run({ mode: 'live', signedOut: true });
    t('ログインしていない → Google（データベースを呼ばない）', x.gas === 1 && x.r.via === 'gas' && x.rpc.length === 0, x);
    x = await run(null);
    t('ログインの部品が読めない → Google', x.gas === 1 && x.r.via === 'gas', x);
    x = await run({ mode: 'live', role: 'field' });
    t('現場のアカウント → Google（データベースを呼ばない）', x.gas === 1 && x.rpc.length === 0, x);
    x = await run({ mode: 'live', role: 'office' }, { su_device_role: 'field' });
    t('現場の端末 → Google（データベースを呼ばない）', x.gas === 1 && x.rpc.length === 0, x);
    x = await run({ mode: 'live', role: 'office', rosterErr: { code: '42501' } });
    t('事務所のログインで切り替えた後に断られた → 失敗（Google へ流さない）', x.gas === 0 && x.err && /権限/.test(x.err.message), x);
    const { R: R4 } = load({ flags: { supabase: { master_live: false } } });
    const b0 = gasCalls.length;
    await R4.call({ action: 'getRoster' }, gasFn, { officeOnly: true }, auth({ mode: 'live' }).io);
    t('スイッチが切 → Google', gasCalls.length - b0 === 1);
  }

  console.log('L ログインだけで使える（入居者マスタの接続先・合言葉の無い端末・2026-11-08 代表者「端末ごとの設定を極限までなくす」）');
  {
    const ON = { supabase: { master_live: true } };
    const cases = [
      ['スイッチが入・事務所のログイン・切り替えた後', ON, { mode: 'live', role: 'office' }, null, true],
      ['管理者のログイン', ON, { mode: 'live', role: 'admin' }, null, true],
      ['スイッチが切', { supabase: { master_live: false } }, { mode: 'live' }, null, false],
      ['スイッチが無い', null, { mode: 'live' }, null, false],
      ['写しの期間', ON, { mode: 'shadow' }, null, false],
      ['0036 の前（関数が無い）', ON, { mode: 'live', modeErr: { code: 'PGRST202' } }, null, false],
      ['印を読めない', ON, { mode: 'live', modeErr: { code: 'XX000' } }, null, false],
      ['ログインしていない', ON, { mode: 'live', signedOut: true }, null, false],
      ['現場のアカウント', ON, { mode: 'live', role: 'field' }, null, false],
      ['現場の端末', ON, { mode: 'live' }, { su_device_role: 'field' }, false],
      ['ログインの部品が読めない', ON, null, null, false]
    ];
    for (const [label, flags, o, store, want] of cases) {
      const { R: R5, writes: w5 } = load({ flags, store });
      const a = o === null ? { io: { auth: async () => null }, calls: [] } : auth(o);
      const b0 = gasCalls.length;
      let v, threw = false;
      try { v = await R5.liveReady(a.io); } catch (e) { threw = true; }
      t('L ' + label + ' → ' + want + '（例外を出さない・名簿も Google も読まない・端末に書かない）',
        !threw && v === want && gasCalls.length === b0 && a.calls.every(c => c[0] === 'res_mode_get') && w5.length === 0, { v, threw, calls: a.calls });
    }
    {
      const { R: R6 } = load({ flags: ON });
      const A = { STATUS: { OK: 'ok' }, check: () => new Promise(() => {}), client: () => ({}) };
      const t0 = Date.now();
      const v = await R6.liveReady({ auth: async () => A });
      t('L ログインの確かめが返らない時は8秒で false', v === false && Date.now() - t0 >= 7900 && Date.now() - t0 < 12000, Date.now() - t0);
    }
  }

  console.log('L 画面のつなぎ（入居者マスタ・フェイスシートの本物の関数・接続先の無い端末・2026-11-08）');
  {
    const RM = readMaster(path.join(ROOT, 'resident-master.html'));
    const FS = fs.readFileSync(path.join(ROOT, 'facesheet.html'), 'utf8');
    const grab = (src, name) => {
      let i = src.indexOf('\nfunction ' + name + '(');
      /* 2026-11-13: 画面の中の窓（su-dialog.js）の答えを待つ関数は async になった。頭の async も一緒に切り出す（確かめる中身は同じ） */
      if (i < 0) i = src.indexOf('\nasync function ' + name + '(');
      if (i < 0) return '';
      let d = 0, q = null, k = src.indexOf('{', i);
      for (let p = k; p < src.length; p++) {
        const c = src[p];
        if (q) { if (c === '\\') { p++; continue; } if (c === q) q = null; continue; }
        if (c === "'" || c === '"') { q = c; continue; }
        if (c === '{') d++; else if (c === '}') { d--; if (!d) return src.slice(i + 1, p + 1); }
      }
      return '';
    };
    const line = (src, head) => { const i = src.indexOf('\n' + head); return i < 0 ? '' : src.slice(i + 1, src.indexOf('\n', i + 1)); };
    const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
    const PAGES = [
      { f: '入居者マスタ', src: RM, probe: 'rmProbeLive_', on: 'rmOn_', LIVE: 'RM_LIVE', tried: 'rmLiveTried_', head: 'var RM_LIVE=' },
      { f: 'フェイスシート', src: FS, probe: 'fsProbeLive_', on: 'fsOn_', LIVE: 'FS_LIVE', tried: 'fsLiveTried_', head: 'var FS_LIVE=' }
    ];
    /* L-a 確かめは1回だけ・使える時だけ帯を止める・例外を出さない */
    for (const P of PAGES) {
      const code = [line(P.src, P.head), grab(P.src, P.on), grab(P.src, P.probe)].join('\n');
      const mk = (o) => {
        const c = { n: 0, q: 0 };
        const box = { CFG: { url: o.url || '', token: '' }, Promise, setTimeout, window: {} };
        if (o.res !== undefined) box.window.SUResRead = { liveReady: () => { c.n++; if (o.res === 'throw') throw new Error('x'); return o.res === 'reject' ? Promise.reject(new Error('x')) : Promise.resolve(o.res); } };
        box.window.SUCfgHint = { quiet: () => { c.q++; } };
        vm.createContext(box); vm.runInContext(code, box);
        return { box, c, v: n => vm.runInContext(n, box) };
      };
      const cases = [
        ['使える・接続先なし', { res: true }, true, 1],
        ['使える・接続先あり（帯は今までどおり）', { res: true, url: 'https://example.invalid/exec' }, true, 0],
        ['使えない', { res: false }, false, 0],
        ['true 以外の答え', { res: 'yes' }, false, 0],
        ['確かめが失敗', { res: 'reject' }, false, 0],
        ['確かめが例外', { res: 'throw' }, false, 0],
        ['部品が無い', {}, false, 0]
      ];
      for (const [label, o, want, wantQ] of cases) {
        const L = mk(o);
        let threw = false, r;
        try { const p1 = L.box[P.probe](), p2 = L.box[P.probe](); r = await Promise.all([p1, p2]); } catch (e) { threw = true; }
        t('L ' + P.f + ' 確かめ: ' + label + ' → ' + want + '（確かめは1本・帯を止めるのは ' + wantQ + ' 回・例外を出さない）',
          !threw && r[0] === want && r[1] === want && L.v(P.LIVE) === want && L.v(P.tried) === true && L.c.n <= 1 && L.c.q === wantQ,
          { threw, r, n: L.c.n, q: L.c.q });
        t('L ' + P.f + ' ' + label + ': 使えるかの判定（' + P.on + '）', L.box[P.on]() === (want || !!o.url));
      }
    }
    /* L-b 入居者マスタ: 起動・同期設定の保存の後は、接続先の無い事務所PCだけ確かめてから進む */
    {
      const code = [line(RM, 'var RM_LIVE='), grab(RM, 'rmOn_'), grab(RM, 'rmProbeLive_'), grab(RM, 'rmLiveGate_')].join('\n');
      const mk = (url, role, res, flip) => {
        const c = { n: 0, fn: 0, sync: [] };
        const box = { CFG: { url, token: '' }, Promise, setTimeout, role,
          window: { SUResRead: { liveReady: () => { c.n++; if (flip) box.role = 'field'; return Promise.resolve(res); } } },
          setSync(m) { c.sync.push(m); } };
        vm.createContext(box); vm.runInContext(code + '\nfunction getDeviceRole(){ return role; }', box);   // 端末の用途は箱の role（確かめの途中で変えられる）
        return { box, c };
      };
      const run = async (url, role, res, flip) => { const L = mk(url, role, res, flip); L.box.rmLiveGate_(() => { L.c.fn++; }); const sync0 = L.c.fn; await settle(); return { L, sync0 }; };
      let r = await run('https://example.invalid/exec', 'office', true);
      t('L 入居者マスタ 起動: 接続先がある端末はその場で進む・確かめない（今までどおり）', r.sync0 === 1 && r.L.c.n === 0 && r.L.c.sync.length === 0);
      r = await run('', 'field', true);
      t('L 入居者マスタ 起動: 現場の端末は確かめない（今までどおり）', r.sync0 === 1 && r.L.c.n === 0);
      r = await run('', 'office', true);
      t('L 入居者マスタ 起動: 接続先の無い事務所PCは確かめ終わってから1回だけ進む（その間は「同期中…」）', r.sync0 === 0 && r.L.c.fn === 1 && r.L.c.n === 1 && r.L.c.sync[0] === '同期中…' && r.L.box.RM_LIVE === true);
      r.L.box.rmLiveGate_(() => { r.L.c.fn++; });
      t('L 入居者マスタ 起動: 2回目（同期設定の保存の後）は確かめ直さない', r.L.c.fn === 2 && r.L.c.n === 1);
      r = await run('', 'office', false);
      t('L 入居者マスタ 起動: 使えない時も進む（今までどおり「未接続」で止まる側へ）', r.L.c.fn === 1 && r.L.box.RM_LIVE === false);
      r = await run('', 'office', true, true);
      t('L 入居者マスタ 起動: 確かめている間に現場の端末へ変わったら進まない', r.L.c.fn === 0);
    }
    /* L-c デイ利用日（入居者マスタとフェイスシートで同じ文面）: 週間計画の接続先の無い端末は新しい保存先から読めた時だけ使い、Google へ送らない */
    {
      const NOEP = '週間計画の接続先が未設定のため、デイ利用欄は「未確認」で印刷します';
      const DB = { ok: true, rev: 3, data: { residents: [{ name: '見本 甲', masterId: 'r1', events: [{ serviceType: 'daycare', dayOfWeek: 0, startTime: '09:00', endTime: '16:00' }] }] } };
      const EP = 'https://script.google.com/macros/s/xxxx/exec';
      for (const P of PAGES) {
        const code = [line(P.src, 'var A4_GAS_RE='), ...['a4NmKey', 'a4SyncTarget', 'a4HM', 'a4BuildDayMap', 'a4EnsureDayMap', 'a4DayFail_'].map(n => grab(P.src, n))].join('\n');
        const mk = (ep, kv) => {
          const c = { fetch: [] };
          const store = ep ? { su_sync_common: JSON.stringify({ endpoint: ep, token: '見本の合言葉' }) } : {};
          const box = { Promise, setTimeout, JSON, Date, Object, Array, String, Number, isFinite, parseInt,
            A4_DAY_TTL: 600000, A4_DAY_FAIL_TTL: 30000, a4DayMap: null, a4DayPromise: null, a4DayFailAt: 0, a4DayFailMsg: '', devGen: 0,
            csRateMaster_: null, csShare_: null,
            localStorage: { getItem: k => (k in store ? store[k] : null) },
            getDeviceRole: () => 'office',
            fetchWithTimeout: (u, o) => { c.fetch.push([u, o]); return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(DB)) }); },
            window: {} };
          if (kv !== undefined) box.window.SUKv = box.SUKv = { readRouted: () => Promise.resolve(kv) };
          vm.createContext(box); vm.runInContext(code, box);
          return { box, c };
        };
        let L = mk('', DB);
        let m = await L.box.a4EnsureDayMap();
        t('L ' + P.f + ' デイ利用日: 接続先なし・新しい保存先から読めた → 使う・Google へ0件',
          m === '' && L.c.fetch.length === 0 && L.box.a4DayMap && L.box.a4DayMap.byMid.r1 && L.box.a4DayMap.byMid.r1.days[0] === '9-16', { m, n: L.c.fetch.length });
        L = mk('', null); m = await L.box.a4EnsureDayMap();
        t('L ' + P.f + ' デイ利用日: 接続先なし・読めない → 今までと同じ「接続先が未設定」・Google へ0件', m === NOEP && L.c.fetch.length === 0, m);
        L = mk('', undefined); m = await L.box.a4EnsureDayMap();
        t('L ' + P.f + ' デイ利用日: 接続先なし・部品が無い → 今までと同じ「接続先が未設定」・Google へ0件', m === NOEP && L.c.fetch.length === 0, m);
        L = mk(EP, null); m = await L.box.a4EnsureDayMap();
        t('L ' + P.f + ' デイ利用日: 接続先あり・新しい保存先で読めない → 今までどおり Google へ同じ本文で1回',
          m === '' && L.c.fetch.length === 1 && L.c.fetch[0][0] === EP && L.c.fetch[0][1].body === JSON.stringify({ action: 'get', key: 'care_schedule_v2', token: '見本の合言葉' })
          && L.c.fetch[0][1].headers['Content-Type'] === 'text/plain;charset=utf-8', L.c.fetch);
        L = mk(EP, DB); m = await L.box.a4EnsureDayMap();
        t('L ' + P.f + ' デイ利用日: 接続先あり・新しい保存先から読めた → Google へ0件（今までどおり）', m === '' && L.c.fetch.length === 0);
      }
      /* 収支の見通しの3行は入居者マスタだけの後処理（a4OnDayData_）へ移したので、除かずに一字一句同じを求める（2026-11-11） */
      t('L デイ利用日の処理は入居者マスタとフェイスシートで一字一句同じ',
        grab(RM, 'a4EnsureDayMap') === grab(FS, 'a4EnsureDayMap') && grab(RM, 'a4EnsureDayMap').length > 0);
      t('L 収支の見通しの報酬マスタは入居者マスタだけの後処理で持つ（フェイスシートには無い）',
        /function a4OnDayData_\(data\)\{[\s\S]*?csRateMaster_=[\s\S]*?csShare_=revBuildShare_\(data\)/.test(RM) && !/function a4OnDayData_/.test(FS));
    }
    /* L-d 接続先なし・ログインだけで使える端末の読み書き: 画面の本物の口 → この部品 → 新しい保存先だけ（Google へ0件） */
    {
      const ON = { supabase: { master_live: true } };
      for (const P of PAGES) {
        for (const mode of ['live', 'shadow']) {
          const part = load({ flags: ON });
          const inv = [];
          part.win.SUAuth = { STATUS: { OK: 'ok' }, check: async () => ({ status: 'ok', role: 'office' }),
            client: () => ({ rpc: async (n, a) => {
                if (n === 'res_mode_get') return { data: { mode, stateRev: 1 } };
                if (n === 'res_roster') return { data: { ok: true, rows: rosterRecs } };
                return { data: { ok: true, rows: recs.filter(r => a.p_ids.indexOf(r.id) >= 0) } }; },
              functions: { invoke: async (n, o) => { inv.push([n, o.body]); return { data: { ok: true, id: 'r1' } }; } },
              auth: { getSession: async () => ({ data: { session: { access_token: 'x' } } }) } }) };
          const gfetch = [];
          const box = { CFG: { url: '', token: '' }, Promise, setTimeout, clearTimeout, JSON, Object, String, Error,
            window: { SUResRead: part.R },
            fetchWithTimeout: (u) => { gfetch.push(String(u)); return Promise.reject(new Error('no')); }, parseJson: r => r };
          vm.createContext(box);
          const wrap = [grab(P.src, 'apiGet'), line(P.src, 'var apiGetGas_=apiGet;'), line(P.src, 'apiGet=function(params,timeoutMs){')];
          if (P.src === RM) wrap.push(grab(RM, 'apiPost'), line(RM, 'var apiPostGas_=apiPost;'), line(RM, 'apiPost=function(body,timeoutMs){'));
          vm.runInContext(wrap.join('\n'), box);
          let r = null, err = null;
          try { r = await box.apiGet({ action: 'getRoster' }); } catch (e) { err = e; }
          if (mode === 'live') {
            t('L ' + P.f + ' 接続先なし・切り替えた後: 名簿は新しい保存先から・Google へ0件',
              !err && r && JSON.stringify(r) === JSON.stringify(want.roster) && gfetch.length === 0, err && err.message);
            if (P.src === RM) {
              let w = null, we = null;
              try { w = await box.apiPost({ action: 'saveResident', token: '', record: { id: 'r1', name: '見本 甲' } }); } catch (e) { we = e; }
              await settle();
              t('L 入居者マスタ 接続先なし・切り替えた後: 保存は res-write へ（合言葉の欄は送らない）・Google へ0件（写し返しも送らない）',
                !we && w && w.ok === true && inv.length === 1 && inv[0][0] === 'res-write' && !('token' in inv[0][1]) && gfetch.length === 0 && part.fetches.length === 0,
                { we: we && we.message, inv, g: gfetch, g2: part.fetches });
            }
          } else {
            t('L ' + P.f + ' 接続先なし・途中で写しの期間へ戻っていた: 今までと同じ断り（NO_URL）・Google へ0件', err && err.message === 'NO_URL' && gfetch.length === 0, err && err.message);
          }
        }
      }
    }
    /* L-e 文面の分け方: 新しい保存先を通る所は rmOn_／fsOn_、Google へ直接行く所は今までどおり接続先がある時だけ */
    {
      const USE = ['refreshRoster', 'admEnsure', 'bkEnsure', 'fullEnsure', 'runMedsAudit', 'mealLoad', 'openResident', 'toggleHosp', 'saveResident', 'openBulk', 'loadData'];
      const bad = USE.filter(n => { const b = grab(RM, n); return !b || b.indexOf('rmOn_()') < 0 || /!CFG\.url\b/.test(b); });
      t('L 入居者マスタ: 新しい保存先を通る11か所は rmOn_ で分ける（' + USE.join('・') + '）', bad.length === 0, bad);
      const KEEP = ['rmResFullAuto_', 'mdLoad_', 'mdSave', 'mcStart', 'yjGate_', 'yjlLoad_'];
      const bad2 = KEEP.filter(n => { const b = grab(RM, n); return !b || !/!CFG\.url\b/.test(b) || b.indexOf('rmOn_') >= 0; });
      t('L 入居者マスタ: Google へ直接行く6か所（全項目の写し・薬効辞書の読み書き・薬の変更候補・薬情の取り込み・反映の記録）は今までどおり接続先がある時だけ', bad2.length === 0, bad2);
      t('L 入居者マスタ: 起動は確かめの待ち合わせを通る', /function rmStart_\(\)\{\n  rmGateOk_=true;\n[^\n]*\n  rmLiveGate_\(rmStartBody_\);\n\}/.test(RM));
      const st = grab(RM, 'srevTick');
      t('L 入居者マスタ: 版数の見張りは、ログインだけで使える端末でも動き、Google へは接続先がある時だけ聞く',
        /if\(!mu&&!RM_LIVE\)return;/.test(st) && /var gasRev=function\(\)\{if\(!mu\)return Promise\.reject\(new Error\('NO_URL'\)\);/.test(st));
      const FUSE = ['refreshRosterFromGas', 'mealLoad', 'openResident'];
      const bad3 = FUSE.filter(n => { const b = grab(FS, n); return !b || b.indexOf('fsOn_()') < 0 || /!CFG\.url\b/.test(b); });
      t('L フェイスシート: 新しい保存先を通る3か所は fsOn_ で分ける', bad3.length === 0, bad3);
      t('L フェイスシート: 起動は接続先の無い事務所PCだけ確かめてから始める', /function boot\(\)\{\n[^\n]*\n  if\(!CFG\.url&&!fsLiveTried_&&!isField\(\)\)\{ setSync\('同期中…'\); fsProbeLive_\(\)\.then\(function\(\)\{ boot\(\); \}\); return; \}/.test(FS));
      t('L フェイスシート: 現場の端末の名簿の道は今までどおり接続先がある時だけ', /else if\(!has&&CFG\.url\)refreshRosterFromGas\(\)/.test(FS));
      t('L フェイスシート: 薬効辞書（Google だけ）は接続先が無い時に今までと同じ「接続先が未設定」の文で断る',
        /if\(!CFG\.url\) return Promise\.reject\(new Error\(fsNoCfgMsg_\(true\)\)\);/.test(grab(FS, 'fsMdFetch_')));
      t('L 新しい文言を足していない（断りの文は今までの関数・文だけ）', !/接続先なしで使えます|ログインだけで使えます/.test(RM + FS));
    }
  }

  console.log('H 端末に保存しない');
  t('localStorage へ書かない', writes.length === 0 && !/setItem/.test(SRC));

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
