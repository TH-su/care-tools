/* 訪問日・かかりつけ病院の写し（移行 0022・代表者の決定 2026-10-24 の決定4・アプリ間連携と軽量化 段2b・2026-10-24 新設）
   守りたいこと:
     A 名簿の読み取りの入口（su-roster.js）: 呼び出し側が { care: true } を渡した時だけ master_residents_care も同時に取り、
       利用者No で visitDay・hospital を重ねる。渡さない画面は今までどおり（表を読まない・応答の形も同じ）
     B care を取れない（表が無い・断り・形の違い・誰か1人でも行が無い・通信の失敗）時は、写し全体を使わず Google へ戻す。
       表が無い・行が無いは記録しない。それ以外は roster:画面.care を1回記録する
     C スイッチ master_care_read が切（無い・false・文字）なら、master_roster_read が入りでも care の呼び出しは Google（待ちを足さない）
     D { withRev: true } の時だけ、写しの記録の版数を stateRev（数）・srev（数）で添える。渡さない時・Google へ戻した時は今までと同じ
     E 写しの部品（su-master-shadow.js）: { care: 正規化する前の名簿 } で、利用者No と2項目（と正本の更新時刻）だけを書く。氏名は送らない。
       変わった行だけ・空（''）は書く・キーが無い人は書かない（古い行が残るなら失敗に数える）・表が無い時は黙る（note だけ・失敗に数えない）・
       書けなかった人数は記録の care_failed に数え、基本項目の failed には足さない（差分審査 中2）・2項目を書かない写しは care_failed を送らない（null）・
       care_failed の列が無い時は外して残し直す（版数は残す）・10分の間引きは2項目の変化も見る
     I 写しの記録の care_failed（差分審査 中2）: 2項目を求める画面は care_failed が 0 の記録の写しだけを使う（null・1以上・列が無いは Google・記録しない）。
       2項目を求めない画面（訪問・全支援の週間俯瞰）は care_failed を読まず、2項目の失敗があっても今までどおり写しを使う
     F 通所 利用表（daycare-roster）: Google 経由と写し経由（入居者マスタが写した後）で、☆・入院・居室・姓名の切れ目・見張りの基準が同じ。
       スイッチ切では Google への要求が今までと同じ1回だけ。入居者マスタは正規化する前の名簿を写しの部品に渡す
     G 写しの見比べ（shadow-check）: Google の名簿と写しを利用者No で突き合わせ、人数と利用者No と項目名だけを返す（値を返さない）
     H 版の印: 変えた部品を読む全画面が新しい ?v= を読む
   ★部品・画面の本物を vm で動かす。偽物にするのは、スイッチ・ログインの状態・データベース（記憶の中の表）・Google の応答・施設情報だけ。
   実行: node check/unit/roster_care_test.js
   架空データのみ（架空の氏名・架空病院・見本クリニック）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ROSTER_SRC = read('su-roster.js'), SHADOW_SRC = read('su-master-shadow.js');
const DCR = read('daycare-roster.html'), RM = read('resident-master.html'), SC = read('shadow-check.js');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
const WHERE_RE = /^[a-z]{2,12}:[^\s:/?#<>"'&]{1,40}$/;

/* 架空の正本（入居者マスタの getRoster・事務所の合言葉の応答の形。id は番号・居室も番号のことがある） */
const MURL = 'https://script.google.com/macros/s/FAKE/exec';
const REV = { rev: 41, srev: 1761100000000 };
function gasRoster() {
  return [
    { id: 101, name: '架空 一郎', kana: 'かくう いちろう', room: 101, gender: '男', careLevel: '要介護1', active: true, updatedAt: '2026-10-20T01:00:00.000Z',
      targetApps: '', hospitalized: false, birthDate: '1940-01-01', height: '160', dischargeDate: '', doctor: '架空医師', visitDay: '火', hospital: '見本クリニック（内科）' },
    { id: 102, name: '架空 花子', kana: 'かくう はなこ', room: '102', gender: '女', careLevel: '要介護3', active: true, updatedAt: '2026-10-21T01:00:00.000Z',
      targetApps: 'weight,visit', hospitalized: true, birthDate: '', height: '', dischargeDate: '', doctor: '', visitDay: '水', hospital: '架空病院' },
    { id: 103, name: '架空　三郎', kana: '', room: '', gender: '男', careLevel: '', active: false, updatedAt: '2026-09-30T00:00:00.000Z',
      targetApps: '', birthDate: '1935-05-05', height: '170', dischargeDate: '2026-09-30', doctor: '', visitDay: '', hospital: '' },
    { id: 104, name: '架空四郎', kana: '', room: '201', gender: '男', careLevel: '要支援2', active: true, updatedAt: '',
      targetApps: '', hospitalized: false, birthDate: '', height: '', dischargeDate: '', doctor: '', visitDay: '他', hospital: '見本クリ' },
    { id: 'R105', name: '架空 五子', kana: '', room: '202', gender: '女', careLevel: '要介護2', active: true, updatedAt: '',
      targetApps: '', birthDate: '', height: '', dischargeDate: '', doctor: '', visitDay: '金', hospital: '見本クリ 架空病院' }
  ];
}
/* 入居者マスタの一覧の正規化（画面の本物の normRosterRow を切り出す） */
function grabFrom(src, name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('見つかりません: ' + name);
  return src.slice(s, src.indexOf('\n}', s) + 2);
}
/* 字下げのある関数（IIFE の中）を、かっこの対応で切り出す（文字列の中のかっこは数えない） */
function grabIndented(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('見つかりません: ' + name);
  let d = 0, seen = false, q = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && !d) return src.slice(i, k + 1); }
  }
  throw new Error('閉じていません: ' + name);
}
const NORM = {};
vm.createContext(NORM);
vm.runInContext([grabFrom(RM, '_toTargetArr'), grabFrom(RM, '_ymd'), grabFrom(RM, 'normRosterRow')].join('\n'), NORM);

/* 記憶の中のデータベース（3つの表）。selectErr・upsertErr で表ごとに断らせる。careRows で読まれる care の行を差し替える。
   noCareFailedCol で「写しの記録に care_failed の列が無い（0022 を流す前）」を真似る */
function fakeDb(o) {
  o = o || {};
  const T = { master_residents: [], master_residents_care: [], master_sync_runs: [] };
  const log = { upserts: [], inserts: [], selects: [], events: [] };
  function from(table) {
    const st = { lim: null, cols: '' };
    const api = {
      select(c) { st.cols = c; log.selects.push(table + ':' + c); return api; },
      order() { return api; },
      limit(n) { st.lim = n; return api; },
      upsert(rows, opt) {
        log.upserts.push({ table, rows: JSON.parse(JSON.stringify(rows)), opt });
        const err = o.upsertErr && o.upsertErr[table];
        if (err) return Promise.resolve({ error: err });
        rows.forEach(r => {
          const i = T[table].findIndex(x => x.source_id === r.source_id);
          if (i >= 0) T[table][i] = Object.assign({}, T[table][i], r); else T[table].push(Object.assign({}, r));
        });
        return Promise.resolve({ error: null });
      },
      insert(row) {
        log.inserts.push({ table, row: JSON.parse(JSON.stringify(row)) });
        if (o.noCareFailedCol && table === 'master_sync_runs' && 'care_failed' in row) {
          return Promise.resolve({ error: { code: 'PGRST204', message: "Could not find the 'care_failed' column of 'master_sync_runs' in the schema cache" } });
        }
        T[table].push(Object.assign({ at: new Date().toISOString() }, row));
        return Promise.resolve({ error: null });
      },
      then(ok, ng) {
        log.events.push('start:' + table);
        const err = o.selectErr && o.selectErr[table];
        let v;
        if (err === 'reject') return new Promise((r, j) => setTimeout(() => j(new TypeError('Failed to fetch')), o.delay || 0)).then(ok, ng);
        if (err) v = { error: err };
        else if (o.noCareFailedCol && table === 'master_sync_runs' && /care_failed/.test(st.cols)) v = { error: { code: '42703', message: 'column master_sync_runs.care_failed does not exist' } };
        else {
          let data = T[table].slice();
          if (table === 'master_sync_runs') data = data.reverse().slice(0, st.lim || data.length);
          if (table === 'master_residents_care' && o.careRows) data = o.careRows(data);
          v = { data: JSON.parse(JSON.stringify(data)) };
        }
        return new Promise(r => setTimeout(() => { log.events.push('end:' + table); r(v); }, o.delay || 0)).then(ok, ng);
      }
    };
    return api;
  }
  return { T, log, from };
}

/* 砂場: su-master-shadow.js と su-roster.js を同じ window で動かす */
function sandbox(cfg) {
  cfg = cfg || {};
  const ls = {};
  if (cfg.flagsLs !== undefined) ls.su_backend_flags = JSON.stringify(cfg.flagsLs);
  if (cfg.device) ls.su_device_role = cfg.device;
  const db = cfg.db || fakeDb(cfg.dbOpts);
  const notes = [], gets = [];
  let flagFetches = 0;
  const win = {
    SUAuth: { STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out' }, check: () => Promise.resolve(cfg.auth || { status: 'ok', role: 'office' }), client: () => ({ from: db.from }) },
    SUErrors: { note(kind, msg, where) { notes.push({ kind, msg, where }); } },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    document: { getElementsByTagName: () => [], head: { appendChild() {} }, createElement: () => ({}), hidden: false },
    fetch: (url) => {
      if (/facility-profile/.test(String(url))) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });   // 施設情報は端末の控え（架空の見本）だけ
      if (/action=stateRev/.test(String(url))) { gets.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.assign({ ok: true }, cfg.gasRev || REV)) }); }
      flagFetches++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(cfg.flagsFile || { supabase: {} }) });
    },
    setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array, isFinite, console
  };
  if (cfg.flags !== undefined) win.SUKv = { _flags: () => cfg.flags };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SHADOW_SRC, win, { filename: 'su-master-shadow.js' });
  vm.runInContext(ROSTER_SRC, win, { filename: 'su-roster.js' });
  let gasCalls = 0;
  const GAS = { roster: gasRoster(), stateRev: REV.rev, srev: REV.srev };
  const gas = () => { gasCalls++; return Promise.resolve(GAS); };
  return { win, db, ls, notes, gets, GAS, gas, R: win.SURoster, M: win.SUMasterShadow,
    get gasCalls() { return gasCalls; }, get flagFetches() { return flagFetches; } };
}
const BOTH = { supabase: { master_roster_read: true, master_care_read: true } };
const OPT = o => Object.assign({ where: 'daycare', masterUrl: MURL, care: true, withRev: true }, o || {});
/* 入居者マスタが一覧を読んだ時と同じ写し方で、記憶の中の表を埋める（本物の push） */
async function seed(s, roster, opts) {
  const g = roster || gasRoster();
  return s.M.push(g.map(r => NORM.normRosterRow(r)), Object.assign({ stateRev: REV.rev, srev: REV.srev, care: g }, opts || {}));
}

(async () => {
  console.log('E 写しの部品（su-master-shadow.js）');
  {
    const s = sandbox({ flags: BOTH });
    const r = await seed(s);
    const up = s.db.log.upserts.filter(x => x.table === 'master_residents_care');
    t('★E 2項目を master_residents_care へ1回で書く（5名とも新規）', r.status === 'ok' && up.length === 1 && up[0].rows.length === 5 && r.care && r.care.inserted === 5, r);
    t('★E 送るのは利用者No と2項目と正本の更新時刻だけ（氏名・主治医・かな・居室を送らない）',
      up[0].rows.every(x => Object.keys(x).join() === 'source_id,visit_day,hospital,source_updated_at') && !/架空 一郎|架空医師|かくう/.test(JSON.stringify(up[0].rows)), up[0].rows[0]);
    t('E 利用者No は文字（番号の人も）・値は正本のまま・空は空文字で書く',
      up[0].rows[0].source_id === '101' && up[0].rows[0].visit_day === '火' && up[0].rows[0].hospital === '見本クリニック（内科）' &&
      up[0].rows[2].visit_day === '' && up[0].rows[2].hospital === '', up[0].rows);
    t('E 重ね書き（upsert）の衝突先は事業者×利用者No', up[0].opt && up[0].opt.onConflict === 'tenant_id,source_id');
    const run = s.db.T.master_sync_runs[0];
    t('E 写しの記録は今までどおり1件・失敗0・版数つき', s.db.T.master_sync_runs.length === 1 && run.failed === 0 && run.state_rev === 41 && run.srev === '1761100000000', run);
    t('★E 2項目を全員書けた写しは、記録の care_failed を 0 で残す', run.care_failed === 0, run);
    t('E 端末の控え（su_shadow_last）に病院名・曜日・氏名を残さない', !/架空|見本|火/.test(s.ls.su_shadow_last || ''), s.ls.su_shadow_last);
    t('E 基本項目の写し（master_residents）にも2項目を入れない', s.db.T.master_residents.every(x => !('visit_day' in x) && !('hospital' in x) && !('visitDay' in x)));

    // 変わった行だけ
    const g2 = gasRoster(); g2[1].hospital = '架空医院'; g2[0].visitDay = '';
    const r2 = await seed(s, g2, { stateRev: 42 });
    const up2 = s.db.log.upserts.filter(x => x.table === 'master_residents_care');
    t('★E 2回目は変わった行だけを書く（2名）・ほかは変化なし', r2.status === 'ok' && up2.length === 2 && up2[1].rows.map(x => x.source_id).join() === '101,102' && r2.care.updated === 2 && r2.care.unchanged === 3, [r2.care, up2[1] && up2[1].rows.map(x => x.source_id)]);
    t('★E 正本で空になった訪問日は空を書く（「空にせよ」）', s.db.T.master_residents_care.find(x => x.source_id === '101').visit_day === '', s.db.T.master_residents_care);
    // キーが無い人は書かない（古い行が残るので失敗に数える）
    const g3 = gasRoster(); g3[1].hospital = '架空病院B'; delete g3[2].visitDay; delete g3[2].hospital;
    const r3 = await seed(s, g3, { stateRev: 43 });
    const c103 = s.db.T.master_residents_care.find(x => x.source_id === '103');
    t('★E 2項目のキーが無い人は書かない（今の値を消さない＝「持たない」）', c103 && c103.visit_day === '' && !s.db.log.upserts.slice(-1)[0].rows.some(x => x.source_id === '103'), s.db.log.upserts.slice(-1)[0]);
    const last3 = s.db.T.master_sync_runs.slice(-1)[0];
    t('★E キーが無い人に写しの行が既にある時は、古いまま残るので失敗に数え、記録の care_failed に残す（基本項目の failed には足さない）',
      r3.care.failed === 1 && last3.care_failed === 1 && last3.failed === 0, [r3.status, r3.care, last3]);
    t('E キーが無い・長すぎは写し直しても同じなので、今までどおり10分の間引きに入る（データベースの断りとは分ける）', r3.status === 'ok' && JSON.parse(s.ls.su_shadow_last).rev === 43, [r3.status, s.ls.su_shadow_last]);
  }
  {
    const s = sandbox({ flags: BOTH });
    const g = gasRoster().map(r => { delete r.visitDay; delete r.hospital; return r; });
    const r = await seed(s, g);
    t('E 古い GAS（全員2項目のキーが無い）で写しの行も無い時は、何も書かず失敗にも数えない',
      r.status === 'ok' && !s.db.log.upserts.some(x => x.table === 'master_residents_care') && s.db.T.master_sync_runs[0].failed === 0 && s.db.T.master_sync_runs[0].care_failed === 0, r);
  }
  {
    const s = sandbox({ flags: BOTH });
    const r = await s.M.push(gasRoster().map(r => NORM.normRosterRow(r)), { stateRev: 41, srev: 1 });
    t('★E care を渡さない呼び方（今までの画面）は、2項目の表を読みも書きもしない', r.status === 'ok' && !s.db.log.selects.some(x => /master_residents_care/.test(x)) && !s.db.log.upserts.some(x => x.table === 'master_residents_care') && !r.care, s.db.log.selects);
    t('★E care を渡さない呼び方は、記録に care_failed を送らない（null のまま＝2項目を求める読み手は Google）', s.db.log.inserts.length === 1 && !('care_failed' in s.db.log.inserts[0].row), s.db.log.inserts);
  }
  for (const [label, err] of [['PGRST205（表がスキーマに無い）', { code: 'PGRST205', message: "Could not find the table 'public.master_residents_care' in the schema cache" }],
    ['42P01（表が無い）', { code: '42P01', message: 'relation "public.master_residents_care" does not exist' }]]) {
    const s = sandbox({ flags: BOTH, dbOpts: { selectErr: { master_residents_care: err } } });
    const r = await seed(s);
    const r2 = await seed(s, null, { stateRev: 99 });
    t('★E 表が無い（' + label + '）時は黙って書かず、基本項目の写しと記録は続ける（失敗に数えない）',
      r.status === 'ok' && r.care.absent === true && !s.db.log.upserts.some(x => x.table === 'master_residents_care') &&
      s.db.T.master_residents.length === 5 && s.db.T.master_sync_runs[0].failed === 0 && !('care_failed' in s.db.log.inserts[0].row), [r, s.db.T.master_sync_runs[0]]);
    t('E 表が無いことは su-errors の note に1画面1回だけ残す（保存・同期の失敗・shadow:care.absent）',
      s.notes.length === 1 && s.notes[0].kind === '保存・同期の失敗' && s.notes[0].where === 'shadow:care.absent' && WHERE_RE.test(s.notes[0].where) && r2.status === 'ok', s.notes);
  }
  {
    const s = sandbox({ flags: BOTH, dbOpts: { upsertErr: { master_residents_care: { code: '42501', message: 'new row violates row-level security policy' } } } });
    const r = await seed(s);
    t('★E 2項目を書けなかった（断り）時は、その人数を記録の care_failed に数え、基本項目の failed には足さない',
      r.status === 'error' && r.care.failed === 5 && s.db.T.master_sync_runs[0].care_failed === 5 && s.db.T.master_sync_runs[0].failed === 0 && s.notes.length === 0, [r, s.db.T.master_sync_runs[0]]);
    t('E データベースの断りの時は端末の控えを更新しない（次に一覧を読んだ時に写し直す）', !s.ls.su_shadow_last, s.ls.su_shadow_last);
    t('E 基本項目の写しは書けている（2項目の失敗で止めない）', s.db.T.master_residents.length === 5);
  }
  {
    const s = sandbox({ flags: BOTH, dbOpts: { selectErr: { master_residents_care: { code: '500', message: 'boom' } } } });
    const r = await seed(s);
    t('E 2項目の表を読めない（表が無い以外）時は書かず、全員を care_failed に数える', r.status === 'error' && r.care.failed === 5 && s.db.T.master_sync_runs[0].care_failed === 5 && s.db.T.master_sync_runs[0].failed === 0, r);
  }
  {
    const s = sandbox({ flags: BOTH });
    const g = gasRoster(); g[0].hospital = '架'.repeat(201); g[1].visitDay = '月'.repeat(41);
    const r = await seed(s, g);
    t('E 長すぎ（病院 201 字・訪問日 41 字）は書かずに失敗に数える（データベースの上限と同じ 200・40）',
      r.care.failed === 2 && r.care.inserted === 3 && s.db.T.master_sync_runs[0].care_failed === 2 && s.db.T.master_sync_runs[0].failed === 0 && s.M.CARE_LIMITS.hospital === 200 && s.M.CARE_LIMITS.visit_day === 40, r.care);
  }
  {
    const s = sandbox({ flags: BOTH, dbOpts: { noCareFailedCol: true } });
    const r = await seed(s);
    const ins = s.db.log.inserts.filter(x => x.table === 'master_sync_runs');
    t('★E 写しの記録に care_failed の列が無い時は、その列だけ外して残し直す（版数は残す）',
      r.status === 'ok' && ins.length === 2 && ins[0].row.care_failed === 0 && !('care_failed' in ins[1].row) && ins[1].row.state_rev === 41 && ins[1].row.srev === '1761100000000', ins.map(x => x.row));
  }
  {
    const s = sandbox({ flags: BOTH });
    await seed(s);
    const r2 = await seed(s);
    t('E 同じ内容・同じ版数を10分以内に写す時は今までどおり何もしない', r2.status === 'skipped' && r2.reason === 'same' && s.db.log.upserts.length === 2);
    const g = gasRoster(); g[3].hospital = '見本クリニック';
    const r3 = await seed(s, g);
    t('★E 版数が同じでも2項目が変わっていれば写し直す（指紋に2項目も入れる）', r3.status === 'ok' && r3.care.updated === 1, r3);
  }

  console.log('\nA 名簿の読み取りの入口: 2項目を重ねる');
  {
    const s = sandbox({ flags: BOTH, dbOpts: { delay: 10 } });
    await seed(s);
    const before = s.db.log.events.length;
    const j = await s.R.getRoster(s.gas, OPT());
    const ev = s.db.log.events.slice(before);
    t('★A care:true では Google を呼ばず、写しに2項目を重ねて返す', s.gasCalls === 0 && j && j.roster && j.roster.length === 5 && s.notes.length === 0, j && Object.keys(j));
    const a = j.roster[0];
    t('★A キーの並びは getRoster（事務所）と同じ順で、最後に visitDay・hospital（主治医は出さない）',
      Object.keys(a).join() === 'id,name,kana,room,gender,careLevel,active,updatedAt,targetApps,hospitalized,birthDate,height,dischargeDate,visitDay,hospital', Object.keys(a));
    t('★A 利用者No で正しい人に重ねる（値は正本のまま・空は空）',
      j.roster.map(r => r.id + ':' + r.visitDay + ':' + r.hospital).join('|') === '101:火:見本クリニック（内科）|102:水:架空病院|103::|104:他:見本クリ|R105:金:見本クリ 架空病院',
      j.roster.map(r => r.id + ':' + r.visitDay + ':' + r.hospital));
    const iCare = ev.indexOf('start:master_residents_care'), iRunsEnd = ev.indexOf('end:master_sync_runs');
    t('★A 2項目の表は、写しの記録・本体と同時に取り始める', iCare >= 0 && iRunsEnd >= 0 && iCare < iRunsEnd, ev);
    t('A 2項目の表で読む列は利用者No と2項目だけ', s.db.log.selects.indexOf('master_residents_care:source_id,visit_day,hospital') >= 0, s.db.log.selects);
  }
  {
    const s = sandbox({ flags: BOTH });
    await seed(s);
    const sel0 = s.db.log.selects.length;
    const j = await s.R.getRoster(s.gas, { where: 'visit', masterUrl: MURL });
    t('★A care を渡さない画面（訪問・全支援 俯瞰）は2項目の表を読まず、応答も今までどおり { roster } だけ・2項目なし',
      j && Object.keys(j).join() === 'roster' && !s.db.log.selects.slice(sel0).some(x => /master_residents_care/.test(x)) && !('visitDay' in j.roster[0]) && !('hospital' in j.roster[0]), [Object.keys(j), s.db.log.selects.slice(sel0)]);
  }

  console.log('\nB care を取れない時は写し全体を使わず Google');
  const cases = [
    ['表が無い（PGRST205）', { selectErr: { master_residents_care: { code: 'PGRST205', message: 'Could not find the table' } } }, null],
    ['表が無い（42P01）', { selectErr: { master_residents_care: { code: '42P01', message: 'relation does not exist' } } }, null],
    ['権限で断られた（42501）', { selectErr: { master_residents_care: { code: '42501', message: 'permission denied' } } }, ['care', 'DataError']],
    ['RLS で0件（現場の権限・表が空）', { careRows: () => [] }, null],
    ['1人だけ行が無い（入居者マスタを開く前に足した人）', { careRows: d => d.filter(x => x.source_id !== '104') }, null],
    ['訪問日が文字でない', { careRows: d => d.map(x => x.source_id === '102' ? Object.assign({}, x, { visit_day: null }) : x) }, ['care', 'ShapeError']],
    ['利用者No が重複', { careRows: d => d.concat([Object.assign({}, d[0])]) }, ['care', 'ShapeError']],
    ['通信の失敗で読めない', { selectErr: { master_residents_care: 'reject' } }, ['care', 'NetworkError']]
  ];
  for (const [label, dbOpts, expect] of cases) {
    const db = fakeDb();
    const s0 = sandbox({ flags: BOTH, db });
    await seed(s0);
    Object.assign(db, fakeDbWith(db, dbOpts));
    const s = sandbox({ flags: BOTH, db });
    const j = await s.R.getRoster(s.gas, OPT());
    t('★B ' + label + ': Google の応答を1回だけ読んでそのまま返す（☆が黙って消えない）', j === s.GAS && s.gasCalls === 1, { gas: s.gasCalls, keys: j && Object.keys(j) });
    if (!expect) t('B ' + label + ': 予想どおりの戻りなので記録しない', s.notes.length === 0, s.notes);
    else {
      const n = s.notes[0] || {};
      t('B ' + label + ': roster:daycare.' + expect[0] + '・' + expect[1] + ' を1件だけ記録（報告の式に合う）',
        s.notes.length === 1 && n.kind === '保存・同期の失敗' && n.where === 'roster:daycare.' + expect[0] && WHERE_RE.test(n.where) && n.msg && n.msg.name === expect[1], s.notes.map(x => [x.where, x.msg && x.msg.name]));
    }
  }
  {
    const db = fakeDb({ upsertErr: { master_residents_care: { code: '42501', message: 'x' } } });
    const s0 = sandbox({ flags: BOTH, db });
    await seed(s0);
    const s = sandbox({ flags: BOTH, db });
    const j = await s.R.getRoster(s.gas, OPT());
    t('★I 写しの部品が2項目を書けなかった（記録の care_failed 5）後は、2項目を求める画面は Google（記録しない）',
      j === s.GAS && s.gasCalls === 1 && s.db.T.master_sync_runs[0].care_failed === 5 && s.notes.length === 0, s.db.T.master_sync_runs[0]);
    const sel0 = s.db.log.selects.length;
    const j2 = await s.R.getRoster(s.gas, { where: 'visit', masterUrl: MURL });
    t('★I 同じ記録でも、2項目を求めない画面（週間俯瞰）は今までどおり写しから読む（基本項目の failed は 0）',
      j2 && j2.roster && j2.roster.length === 5 && s.gasCalls === 1 && s.db.T.master_sync_runs[0].failed === 0, Object.keys(j2));
    t('I 2項目を求めない画面は care_failed を読まない（写しの記録の列は今までと同じ）',
      s.db.log.selects.slice(sel0).indexOf('master_sync_runs:at,source_count,missing,failed,state_rev,srev') >= 0, s.db.log.selects.slice(sel0));
  }
  {
    const db = fakeDb();
    const s0 = sandbox({ flags: BOTH, db });
    await seed(s0);
    const s = sandbox({ flags: BOTH, db });
    await s.R.getRoster(s.gas, OPT());
    t('I 2項目を求める画面は写しの記録の care_failed も読む', s.db.log.selects.indexOf('master_sync_runs:at,source_count,missing,failed,state_rev,srev,care_failed') >= 0, s.db.log.selects);
    // 古い画面（care を渡さない入居者マスタのタブ）が後から写した＝最新の記録の care_failed が null
    await s0.M.push(gasRoster().map(r => NORM.normRosterRow(r)), { stateRev: 41, srev: REV.srev, force: true });
    const last = db.T.master_sync_runs.slice(-1)[0];
    const j = await s.R.getRoster(s.gas, OPT());
    t('★I 最新の記録の care_failed が null（2項目を書いていない写し）なら、2項目を求める画面は Google（記録しない）',
      last.care_failed === undefined && j === s.GAS && s.gasCalls === 1 && s.notes.length === 0, { last, gas: s.gasCalls });
    const j2 = await s.R.getRoster(s.gas, { where: 'support', masterUrl: MURL });
    t('I その時も、2項目を求めない画面は写しから読む', j2 && j2.roster && j2.roster.length === 5 && s.gasCalls === 1);
  }
  {
    const db = fakeDb();
    const s0 = sandbox({ flags: BOTH, db });
    await seed(s0);
    Object.assign(db, fakeDbWith(db, { noCareFailedCol: true }));
    const s = sandbox({ flags: BOTH, db });
    const j = await s.R.getRoster(s.gas, OPT());
    t('★I 写しの記録に care_failed の列が無い（0022 を流す前）時は、2項目を求める画面は Google（記録しない）', j === s.GAS && s.gasCalls === 1 && s.notes.length === 0, s.notes);
    const j2 = await s.R.getRoster(s.gas, { where: 'visit', masterUrl: MURL });
    t('I その時も、2項目を求めない画面は care_failed を読まないので写しから読める', j2 && j2.roster && j2.roster.length === 5 && s.gasCalls === 1);
  }

  console.log('\nC スイッチ master_care_read');
  for (const [label, flags] of [['無い', { supabase: { master_roster_read: true } }], ['false', { supabase: { master_roster_read: true, master_care_read: false } }],
    ['文字の "true"', { supabase: { master_roster_read: true, master_care_read: 'true' } }], ['master_roster_read が切', { supabase: { master_roster_read: false, master_care_read: true } }]]) {
    const s = sandbox({ flags });
    await seed(s);
    const sel0 = s.db.log.selects.length;
    let sync = false;
    const p = s.R.getRoster(() => { sync = true; return s.gas(); }, OPT());
    t('★C master_care_read ' + label + ': care の呼び出しは Google をその場で1回呼ぶ（待ちを足さない）', sync && s.gasCalls === 1);
    const j = await p;
    t('C master_care_read ' + label + ': 応答は Google のもの・写しを読まない・記録しない', j === s.GAS && s.db.log.selects.length === sel0 && s.notes.length === 0);
  }
  {
    const s = sandbox({ flags: { supabase: { master_roster_read: true } } });
    await seed(s);
    const j = await s.R.getRoster(s.gas, { where: 'visit', masterUrl: MURL });
    t('C master_care_read が無くても、care を求めない画面は今までどおり写しから（段階1の動きを変えない）', j && j.roster && j.roster.length === 5 && s.gasCalls === 0);
  }
  {
    const s = sandbox({ flagsLs: BOTH, flagsFile: { supabase: { master_roster_read: true, master_care_read: false } } });
    await seed(s);
    const j = await s.R.getRoster(s.gas, OPT());
    t('C su-kv.js が無い画面で、控えは入りでも読み直したら master_care_read が切なら Google（記録しない）', j === s.GAS && s.flagFetches === 1 && s.notes.length === 0);
  }
  {
    const s = sandbox({ flags: BOTH, device: 'field' });
    await seed(s);
    const sel0 = s.db.log.selects.length;
    const j = await s.R.getRoster(s.gas, OPT());
    t('C 現場の端末は両方のスイッチが入りでも Google（写しを読まない）', j === s.GAS && s.db.log.selects.length === sel0);
  }
  {
    const s = sandbox({ flags: BOTH });
    await seed(s);
    s.win.SUAuth.check = () => Promise.resolve({ status: 'ok', role: 'field' });
    const j = await s.R.getRoster(s.gas, OPT());
    t('C 現場のアカウントは Google（記録しない）', j === s.GAS && s.notes.length === 0);
  }

  console.log('\nD 版数を添える');
  {
    const s = sandbox({ flags: BOTH });
    await seed(s);
    const j = await s.R.getRoster(s.gas, OPT());
    t('★D withRev の時は写しの記録の版数を stateRev・srev（どちらも数）で添える', j.stateRev === 41 && j.srev === 1761100000000 && typeof j.srev === 'number', { stateRev: j.stateRev, srev: j.srev });
    t('D 応答のキーは roster・stateRev・srev だけ', Object.keys(j).join() === 'roster,stateRev,srev', Object.keys(j));
    const j2 = await s.R.getRoster(s.gas, OPT({ withRev: false }));
    t('D withRev を渡さなければ版数を付けない', Object.keys(j2).join() === 'roster', Object.keys(j2));
  }
  {
    const s = sandbox({ flags: BOTH, gasRev: { rev: 42, srev: REV.srev } });
    await seed(s);
    const j = await s.R.getRoster(s.gas, OPT());
    t('D Google の版数が進んでいる時は Google の応答そのまま（版数も Google のもの）', j === s.GAS && j.stateRev === 41 && s.gasCalls === 1);
  }

  console.log('\nF 通所 利用表: Google 経由と写し経由で同じ');
  const SAMPLE = JSON.parse(read('facility-profile.sample.json'));
  function dcrBox(flags, opts) {
    opts = opts || {};
    const s = sandbox({ flags, db: opts.db });
    const calls = [];
    const box = s.win;
    box.localStorage.setItem('rmaster_cfg', JSON.stringify({ url: MURL, token: 'tok-dummy' }));
    box.localStorage.setItem('su_facility_json_v1', JSON.stringify(SAMPLE));
    vm.runInContext(read('su-facility.js'), box);
    box.SU = { data: { getRoster: (o) => { calls.push(JSON.stringify(o)); return Promise.resolve({ roster: gasRoster(), stateRev: REV.rev, srev: REV.srev }); } } };
    box.suFacReady_ = () => Promise.resolve(true);
    vm.runInContext([
      "var DCR_RMASTER_CFG_KEY = 'rmaster_cfg';",
      'var DCR_HOSP_TTL_MS = 60000, dcrHospMap = null, dcrVmedMap = null, dcrRoomMap = null, dcrNameCutMap = null, dcrHospAt = 0, dcrHospRev = null, dcrHospBusy = false, dcrClinicSigUsed = null;',
      grabFrom(DCR, 'dcrGetMasterCfg'), grabFrom(DCR, 'dcrClinicOf_'), grabFrom(DCR, 'dcrClinicSig_'), grabFrom(DCR, 'dcrOverlayMaster'), grabFrom(DCR, 'dcrFetchMasterHosp'),
      'this.__state = function () { return JSON.stringify({ hosp: dcrHospMap, vmed: dcrVmedMap, room: dcrRoomMap, cut: dcrNameCutMap, rev: dcrHospRev }); };'
    ].join('\n'), box);
    return { s, box, calls };
  }
  /* 週間計画の利用者（masterId で入居者マスタとつながる・架空） */
  const CARE_DB = { residents: [101, 102, 103, 104, 'R105'].map((id, i) => ({ id: 'c' + i, name: '架空' + i, masterId: id, room: '', hospitalized: false, visitingMed: '' })) };
  const g = dcrBox({ supabase: { master_roster_read: true } });
  const okG = await g.box.dcrFetchMasterHosp(true);
  const stG = g.box.__state();
  const ovG = JSON.stringify(g.box.dcrOverlayMaster(CARE_DB));
  t('F スイッチ切（master_care_read なし）: Google の名簿の読み取りは今までと同じ1回・同じ引数（接続先と合言葉）',
    okG === true && g.calls.length === 1 && g.calls[0] === JSON.stringify({ endpoint: MURL, token: 'tok-dummy' }) && g.s.db.log.selects.length === 0, g.calls);
  t('F 前提: 架空の名簿で☆が付くのは見本クリニックで曜日1文字の2名（101 火・R105 金）', JSON.stringify(JSON.parse(stG).vmed) === '{"101":"火","R105":"金"}', JSON.parse(stG).vmed);
  {
    const db = fakeDb();
    const w = dcrBox(BOTH, { db });
    await seed(w.s);                                    // 入居者マスタを事務所で開いた＝写しが書かれた
    const okS = await w.box.dcrFetchMasterHosp(true);
    const stS = w.box.__state();
    const ovS = JSON.stringify(w.box.dcrOverlayMaster(CARE_DB));
    t('★F 写し経由: Google の名簿を呼ばずに読む', okS === true && w.calls.length === 0 && w.s.gasCalls === 0, w.calls);
    t('★F ☆（訪問診療）・入院・居室・姓名の切れ目・見張りの基準（stateRev・srev）が Google 経由とまったく同じ', stS === stG, { google: JSON.parse(stG), shadow: JSON.parse(stS) });
    t('★F 描画用に重ねた週間計画の利用者（☆・入院・居室）も Google 経由と同じ', ovS === ovG, { google: JSON.parse(ovG).residents, shadow: JSON.parse(ovS).residents });
    t('F 見張りの基準は数値2つ（rev 41・srev 1761100000000）', JSON.stringify(JSON.parse(stS).rev) === '{"rev":41,"srev":1761100000000}');
  }
  {
    const db = fakeDb({ selectErr: { master_residents_care: { code: 'PGRST205', message: 'Could not find the table' } } });
    const w = dcrBox(BOTH, { db });
    await seed(w.s);
    const okS = await w.box.dcrFetchMasterHosp(true);
    t('★F 写しはあるが2項目の表が無い時は Google から読み、☆は Google 経由と同じ（黙って消えない）',
      okS === true && w.calls.length === 1 && w.box.__state() === stG, w.calls.length);
  }
  {
    const w = dcrBox(BOTH);
    const okS = await w.box.dcrFetchMasterHosp(true);
    t('F 写しがまだ無い（記録なし）時は Google から読む', okS === true && w.calls.length === 1 && w.box.__state() === stG);
  }
  {
    const w = dcrBox({ supabase: { master_roster_read: true, master_care_read: true } });
    delete w.box.SURoster;
    const okS = await w.box.dcrFetchMasterHosp(true);
    t('F 入口の部品が読み込めない時は Google から読む（今までどおり）', okS === true && w.calls.length === 1 && w.box.__state() === stG);
  }
  t('★F 通所 利用表は名簿を入口から { care: true, withRev: true } で読み、場所は daycare',
    /window\.SURoster\.getRoster\(raw, \{ where: 'daycare', masterUrl: cfg\.url, care: true, withRev: true \}\)/.test(DCR));
  t('F 通所 利用表は su-roster.js を su-kv.js の後に新しい版で読む', /<script src="su-kv\.js\?v=[^"]+"><\/script>\n<!--[^\n]*-->\n<script src="su-roster\.js\?v=2026-10-24\.2"><\/script>/.test(DCR));
  t('★F 入居者マスタは正規化する前の名簿（list）を写しの部品に渡す（一覧・共有名簿には2項目を入れない）',
    RM.indexOf("SUMasterShadow.push(roster,{stateRev:d&&d.stateRev,srev:srevPickMeta(d),care:list})") >= 0 && !/visitDay/.test(grabFrom(RM, 'normRosterRow')));

  console.log('\nG 写しの見比べ');
  {
    const env = {};
    vm.createContext(env);
    vm.runInContext([/var CARE_CMP = [^\n]*\n/.exec(SC)[0], grabIndented(SC, 'careCompare')].join('\n'), env);
    const care = [
      { source_id: '101', visit_day: '火', hospital: '見本クリニック（内科）' },
      { source_id: '102', visit_day: '水', hospital: '架空医院' },
      { source_id: '103', visit_day: '', hospital: '' },
      { source_id: '999', visit_day: '月', hospital: '架空病院' }
    ];
    const gr = gasRoster(); delete gr[3].visitDay;
    const d = env.careCompare(gr, care);
    t('★G 一致・違いあり（項目名）・写しに無い・正本に無い・正本に項目が無いを利用者No で分ける',
      d.same === 2 && JSON.stringify(d.diff) === '[{"id":"102","fields":["かかりつけ病院"]}]' && JSON.stringify(d.notInCopy) === '["R105"]' &&
      JSON.stringify(d.notInSource) === '["999"]' && JSON.stringify(d.noField) === '["104"]', d);
    t('★G 結果に病院名・曜日・氏名の中身を入れない（人数・利用者No・項目名だけ）', !/架空|見本|火|水|月/.test(JSON.stringify(d)), d);
    const all = env.careCompare(gasRoster(), gasRoster().map(r => ({ source_id: String(r.id), visit_day: r.visitDay, hospital: r.hospital })));
    t('G 写しの部品が書いたとおりなら全員一致', all.same === 5 && !all.diff.length && !all.notInCopy.length && !all.notInSource.length && !all.noField.length, all);
    t('G 見比べは Google の名簿をボタンを押した時だけ読み、合言葉は本文で Google へだけ送る（各画面の getRoster と同じ送り方）',
      /body: JSON\.stringify\(\{ action: 'getRoster', token: tgt\.token \}\)/.test(SC) && /'Content-Type': 'text\/plain;charset=utf-8'/.test(SC) &&
      /\$\('b-care-check'\)\.addEventListener\('click'/.test(SC));
    // 砂場: ボタンを押した時の流れ（Google・データベースの応答だけ偽物）。画面に出る文字に値が入らないこと
    async function scRun(o) {
      const els = {};
      const E = id => els[id] || (els[id] = { id, className: '', textContent: '', disabled: false, children: [],
        replaceChildren() { this.children = []; }, appendChild(x) { this.children.push(x); return x; } });
      const posts = [];
      const box = {
        $: E, JSON, String, Object, Array, Promise, setTimeout, clearTimeout, console,
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        document: { createElement: tag => ({ tag, className: '', textContent: '', children: [], appendChild(x) { this.children.push(x); return x; } }) },
        localStorage: { getItem: k => (k === 'rmaster_cfg' && o.cfg ? JSON.stringify(o.cfg) : null) },
        fetch: (url, opt) => { posts.push([url, opt]); return Promise.resolve({ ok: true, json: () => Promise.resolve(o.gas) }); },
        SUAuth: { client: () => ({ from: () => ({ select: () => Promise.resolve(o.care) }) }) }
      };
      vm.createContext(box);
      vm.runInContext([/var CARE_CMP = [^\n]*\n/.exec(SC)[0], /var RMASTER_RE = [^\n]*\n/.exec(SC)[0], 'var CARE_LIST_MAX = 50;',
        grabIndented(SC, 'el'), grabIndented(SC, 'kpi'), grabIndented(SC, 'careCompare'), grabIndented(SC, 'rmasterTarget'),
        grabIndented(SC, 'rmasterRoster'), grabIndented(SC, 'careNoTable'), 'async ' + grabIndented(SC, 'runCareCheck')].join('\n'), box);
      await box.runCareCheck();
      const text = x => (x.textContent || '') + (x.children || []).map(text).join('');
      return { els, posts, all: Object.values(els).map(text).join('|') };
    }
    const CFG = { url: MURL, token: 'tok-dummy' };
    {
      const careRows = gasRoster().map(r => ({ source_id: String(r.id), visit_day: r.visitDay, hospital: r.hospital }));
      careRows[1].hospital = '架空医院';
      const r = await scRun({ cfg: CFG, gas: { roster: gasRoster(), stateRev: 41, srev: 1 }, care: { data: careRows } });
      t('★G ボタン: Google へは getRoster を1回・POST・text/plain・合言葉は本文だけ',
        r.posts.length === 1 && r.posts[0][0] === MURL && r.posts[0][1].method === 'POST' && r.posts[0][1].headers['Content-Type'] === 'text/plain;charset=utf-8' &&
        r.posts[0][1].body === JSON.stringify({ action: 'getRoster', token: 'tok-dummy' }) && r.posts[0][1].redirect === 'follow', r.posts.map(x => [x[0], x[1].method]));
      t('★G ボタン: 画面に出るのは人数・利用者No・項目名だけ（病院名・曜日・氏名を出さない）',
        /一致4人/.test(r.all) && /利用者No 102/.test(r.all) && /違う項目: かかりつけ病院/.test(r.all) && !/架空|見本|火|水|金|tok-dummy/.test(r.all), r.all);
      t('G ボタン: 違いがある時は warn・押し終えたらボタンを戻す', r.els['care-verdict'].className === 'msg warn' && r.els['b-care-check'].disabled === false);
    }
    {
      const r = await scRun({ cfg: CFG, gas: { roster: gasRoster() }, care: { error: { code: 'PGRST205', message: 'x' } } });
      t('G ボタン: 写しの表が無い時は「0022 が未適用の可能性」と出す', /0022 が未適用の可能性/.test(r.els['care-verdict'].textContent), r.els['care-verdict'].textContent);
    }
    {
      const r = await scRun({ cfg: null, gas: {}, care: { data: [] } });
      t('G ボタン: 入居者マスタの接続先が無い端末では Google に聞かずに案内だけ', r.posts.length === 0 && /接続先（Google）がありません/.test(r.els['care-verdict'].textContent));
    }
    {
      const r = await scRun({ cfg: CFG, gas: { error: '認証エラー' }, care: { data: [] } });
      t('G ボタン: Google が断った時は止まって知らせる（写しと比べない）', /見比べられませんでした/.test(r.els['care-verdict'].textContent) && !r.els['care-kpis'].children.length);
    }
    {
      const ok = gasRoster().map(r => ({ source_id: String(r.id), visit_day: r.visitDay, hospital: r.hospital }));
      const r = await scRun({ cfg: { url: 'https://script.google.com/a/macros/example.invalid/s/FAKE/exec', token: 'tok-dummy' }, gas: { roster: gasRoster() }, care: { data: ok } });
      t('G ボタン: Workspace の形の接続先も使え、全員一致なら ok', r.posts.length === 1 && r.els['care-verdict'].className === 'msg ok' && /一致しています（5人）/.test(r.els['care-verdict'].textContent), r.els['care-verdict']);
    }
    const HTMLSC = read('shadow-check.html');
    t('G 画面に見比べの欄（人数・判定・一覧・ボタン）がある', ['care-kpis', 'care-verdict', 'care-list', 'b-care-check'].every(id => HTMLSC.indexOf('id="' + id + '"') >= 0));
  }

  console.log('\nH 版の印');
  for (const f of ['visit-overview.html', 'support-overview.html', 'daycare-roster.html']) {
    t('H ' + f + ' は su-roster.js?v=2026-10-24.2 を読む', read(f).indexOf('<script src="su-roster.js?v=2026-10-24.2"></script>') >= 0);
  }
  for (const f of ['resident-master.html', 'shadow-check.html']) {
    t('H ' + f + ' は su-master-shadow.js?v=2026-10-24.2 を読む', read(f).indexOf('<script src="su-master-shadow.js?v=2026-10-24.2"></script>') >= 0);
  }
  t('部品は console.log を使わない', !/console\.log/.test(ROSTER_SRC) && !/console\.log/.test(SHADOW_SRC) && !/console\.log/.test(SC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });

/* 書き込み済みの記憶の表を残したまま、読む時の振る舞い（断り・差し替え）だけを変えた db を作る */
function fakeDbWith(db, o) {
  const d2 = fakeDb(o);
  d2.T.master_residents = db.T.master_residents;
  d2.T.master_residents_care = db.T.master_residents_care;
  d2.T.master_sync_runs = db.T.master_sync_runs;
  return { from: d2.from, log: d2.log };
}
