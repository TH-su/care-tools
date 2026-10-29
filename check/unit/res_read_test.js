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
   ★架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.RES_READ_JS || path.join(ROOT, 'su-res-read.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });

function load(o) {
  o = o || {};
  const writes = [];
  const store = { su_backend_flags: o.flags === undefined ? null : JSON.stringify(o.flags) };
  const ctx = {
    window: {}, JSON, Object, Array, String, Number, Math, Error, Promise, Date, RegExp, isNaN, isFinite, parseInt, setTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { writes.push(k); store[k] = v; }, removeItem: k => { writes.push(k); } },
    fetch: () => Promise.reject(new Error('no network'))
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { R: ctx.window.SUResRead, writes };
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
    const H = fs.readFileSync(path.join(ROOT, f), 'utf8');
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
    const H = fs.readFileSync(path.join(ROOT, f), 'utf8');
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

  console.log('H 端末に保存しない');
  t('localStorage へ書かない', writes.length === 0 && !/setItem/.test(SRC));

  finished = true;
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
