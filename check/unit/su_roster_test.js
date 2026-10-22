/* 入居者マスタの名簿の読み取りの入口（su-roster.js・入居者マスタの Supabase 移行 段階1・改善プロンプト第4弾の6・2026-10-22 新設）
   守りたいこと:
     A スイッチ切（無い・false・読めない）・現場の端末・差分の読み取りは、Google の読み取りをそのまま1回呼ぶ（待ちを足さない）
     B スイッチ入りでも、未ログイン・現場のアカウント・写しが古い・失敗の記録・人数の違い・打ち切り・Supabase の失敗・形の違いは Google へ戻す
     C スイッチ入り・事務所のログイン・新しい写しなら、Google を呼ばずに写しの行を getRoster と同じ形（キー名・型）で返す
     D 結果は1回だけ（打ち切りの後に届いた写しの応答で二重に返さない・Google を2回呼ばない）
     F 訪問支援 週間俯瞰（voFetchHosp）: スイッチ切では Google への要求が今までと1バイトも同じ・
       部品が無くても同じ。スイッチ入りでは写しから入院の重ね表示の表を作る
     E 戻した理由の記録は「読み取りの切り替え」の種類で、場所・例外の名前が不具合報告（su-report.js）の式に合う。スイッチ切・未ログインは記録しない
   ★部品の本物を vm で動かす。偽物にするのは、スイッチの控え・ログインの状態・データベースの応答・Google の読み取りだけ。
   実行: node check/unit/su_roster_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-roster.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

/* su-report.js の式（場所・例外の名前）。部品の側で変わったら、この試験で気づけるように本物から読む */
const REP = fs.readFileSync(path.join(ROOT, 'su-report.js'), 'utf8');
const WHERE_RE = /^[a-z]{2,12}:[^\s:/?#<>"'&]{1,40}$/;
const TYPE_RE = /\b([A-Z][A-Za-z]*Error)\b/;
t('su-report.js の場所の式・種類の式がこの試験の写しと同じ', REP.indexOf(String(WHERE_RE)) >= 0 && REP.indexOf(String(TYPE_RE)) >= 0);

const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();
/* 架空の写し（3名・うち1名は退居・1名は入院の値が無い） */
function rows() {
  return [
    { source_id: 'R001', name: '架空 一郎', kana: 'かくう いちろう', room: '101', gender: '男', care_level: '要介護1', active: true,
      hospitalized: false, discharge_date: null, birth_date: '1940-01-01', height: '160', target_apps: ['weight', 'visit'], source_updated_at: '2026-10-20T01:00:00.000Z' },
    { source_id: 'R002', name: '架空 花子', kana: 'かくう はなこ', room: '102', gender: '女', care_level: '要介護3', active: true,
      hospitalized: true, discharge_date: null, birth_date: '', height: '', target_apps: null, source_updated_at: '' },
    { source_id: 'R003', name: '架空 三郎', kana: '', room: '', gender: '男', care_level: '', active: false,
      hospitalized: null, discharge_date: '2026-09-30', birth_date: '1935-05-05', height: '170', target_apps: [], source_updated_at: '2026-09-30T00:00:00.000Z' }
  ];
}
function run(o) { return Object.assign({ at: iso(NOW - 60 * 60 * 1000), source_count: 3, missing: 0, failed: 0 }, o || {}); }

/* 砂場。cfg: flags（su_backend_flags の値）・device・auth（{status, role} / 'throw'）・runs・runsErr・rows・rowsErr・delay（ms）・sukv */
function sandbox(cfg) {
  cfg = cfg || {};
  const ls = {};
  if (cfg.flags !== undefined) ls.su_backend_flags = JSON.stringify(cfg.flags);
  if (cfg.device) ls.su_device_role = cfg.device;
  const notes = [], queries = [];
  let fetches = 0;
  const later = v => new Promise(r => setTimeout(() => r(v), cfg.delay || 0));
  function q(table) {
    const b = { table, sel: '', ord: null, lim: null };
    queries.push(b);
    const api = {
      select(c) { b.sel = c; return api; },
      order(c, o) { b.ord = [c, o]; return api; },
      limit(n) { b.lim = n; return api; },
      then(ok, ng) {
        let v;
        if (table === 'master_sync_runs') v = cfg.runsErr ? { error: { code: 'X' } } : { data: cfg.runs !== undefined ? cfg.runs : [run()] };
        else v = cfg.rowsErr ? { error: { code: 'X' } } : { data: cfg.rows !== undefined ? cfg.rows : rows() };
        return later(v).then(ok, ng);
      }
    };
    return api;
  }
  const SUAuth = {
    STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out' },
    check() { if (cfg.auth === 'throw') return Promise.reject(new Error('boom')); return Promise.resolve(cfg.auth || { status: 'ok', role: 'office' }); },
    client() { return { from: q }; }
  };
  const win = {
    SUAuth, SUErrors: { note(kind, msg, where) { notes.push({ kind, msg, where }); } },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
    document: { getElementsByTagName: () => [], head: { appendChild() {} }, createElement: () => ({}) },
    fetch: () => { fetches++; return Promise.resolve({ ok: true, json: () => Promise.resolve(cfg.flagsFile || cfg.flags || { supabase: {} }) }); },
    setTimeout, clearTimeout, Promise, Date, JSON
  };
  if (cfg.sukv) win.SUKv = { _flags: () => cfg.sukv };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'su-roster.js' });
  let gasCalls = 0;
  const GAS = { roster: [{ id: 1, name: 'Google の名簿' }], stateRev: 5, srev: 7 };
  const gas = () => { gasCalls++; return Promise.resolve(GAS); };
  return { R: win.SURoster, ctx: win, gas, GAS, notes, queries, ls, get gasCalls() { return gasCalls; }, get fetches() { return fetches; } };
}
const ON = { supabase: { care_schedule_v2: true, master_roster_read: true } };

(async () => {
  console.log('A スイッチ切・現場の端末・差分は Google をそのまま');
  for (const [label, flags] of [['スイッチが無い', { supabase: { care_schedule_v2: true } }], ['false', { supabase: { master_roster_read: false } }],
    ['文字の "true"', { supabase: { master_roster_read: 'true' } }], ['控えが無い', undefined]]) {
    const s = sandbox({ flags });
    let sync = false;
    const p = s.R.getRoster(() => { sync = true; return s.gas(); }, { where: 'visit' });
    t(label + ': Google の読み取りを同じ呼び出しの中で1回呼ぶ（待ちを足さない）', sync && s.gasCalls === 1);
    const j = await p;
    t(label + ': 応答は Google のもの（stateRev も含めそのまま）', j === s.GAS);
    t(label + ': Supabase に触らない・記録しない・スイッチを読みに行かない', s.queries.length === 0 && s.notes.length === 0 && s.fetches === 0);
  }
  {
    const s = sandbox({ flags: ON, device: 'field' });
    const j = await s.R.getRoster(s.gas, { where: 'visit' });
    t('現場の端末（su_device_role=field）はスイッチ入りでも Google・写しを読まない', j === s.GAS && s.gasCalls === 1 && s.queries.length === 0 && s.notes.length === 0);
  }
  {
    const s = sandbox({ flags: ON });
    const j = await s.R.getRoster(s.gas, { where: 'visit', since: '2026-10-01' });
    t('差分の読み取り（since）は Google', j === s.GAS && s.queries.length === 0);
  }
  {
    const s = sandbox({ flags: { supabase: { master_roster_read: false } }, sukv: ON });
    const j = await s.R.getRoster(s.gas, { where: 'visit' });
    t('su-kv.js があればその値を使う（控えより優先）', j && j.roster && j.roster.length === 3 && s.gasCalls === 0);
  }
  {
    const s = sandbox({ flags: ON, sukv: { supabase: { master_roster_read: false } } });
    const j = await s.R.getRoster(s.gas, { where: 'visit' });
    t('su-kv.js の値が切なら、控えが入りでも Google', j === s.GAS && s.queries.length === 0);
  }
  {
    const s = sandbox({ flags: ON, flagsFile: { supabase: { master_roster_read: false } } });
    const j = await s.R.getRoster(s.gas, { where: 'visit' });
    t('su-kv.js が無い画面で、控えは入りでも読み直したスイッチが切なら Google（記録しない）', j === s.GAS && s.fetches === 1 && s.queries.length === 0 && s.notes.length === 0);
  }

  console.log('B Google へ戻す場面');
  const cases = [
    ['未ログイン', { auth: { status: 'signed_out' } }, null],
    ['現場のアカウント', { auth: { status: 'ok', role: 'field' } }, null],
    ['ログインの確かめで例外', { auth: 'throw' }, ['auth', 'AuthError']],
    ['写しの記録が無い', { runs: [] }, ['stale-old', 'StaleError']],
    ['写しの記録が24時間より古い', { runs: [run({ at: iso(NOW - 25 * 60 * 60 * 1000) })] }, ['stale-old', 'StaleError']],
    ['写しの記録に失敗がある', { runs: [run({ failed: 1 })] }, ['stale-failed', 'StaleError']],
    ['写しの人数が記録の人数と違う（写しにだけ残る人）', { runs: [run({ source_count: 2, missing: 1 })] }, ['stale-count', 'StaleError']],
    ['記録の読み取りで失敗', { runsErr: true }, ['db', 'DataError']],
    ['写しの読み取りで失敗', { rowsErr: true }, ['db', 'DataError']],
    ['写しが空', { rows: [] }, ['shape', 'ShapeError']],
    ['在籍が真偽でない', { rows: rows().map((r, i) => i === 1 ? Object.assign(r, { active: 'true' }) : r) }, ['shape', 'ShapeError']],
    ['利用者No が重複', { rows: rows().map((r, i) => i === 2 ? Object.assign(r, { source_id: 'R001' }) : r) }, ['shape', 'ShapeError']],
    ['入院が真偽でない', { rows: rows().map((r, i) => i === 0 ? Object.assign(r, { hospitalized: 'false' }) : r) }, ['shape', 'ShapeError']]
  ];
  for (const [label, cfg, expect] of cases) {
    const s = sandbox(Object.assign({ flags: ON }, cfg));
    const j = await s.R.getRoster(s.gas, { where: 'visit' });
    t(label + ': Google の応答を1回だけ読んで返す', j === s.GAS && s.gasCalls === 1);
    if (!expect) t(label + ': 失敗ではないので記録しない', s.notes.length === 0, s.notes);
    else {
      const n = s.notes[0] || {};
      const w = String(n.where), ty = (String(n.msg && n.msg.name) + ': ' + String(n.msg && n.msg.message)).match(TYPE_RE);
      t(label + ': 「読み取りの切り替え」の種類で roster:visit.' + expect[0] + '・' + expect[1] + ' を1件記録し、報告の式に合う',
        s.notes.length === 1 && n.kind === '読み取りの切り替え' && w === 'roster:visit.' + expect[0] && WHERE_RE.test(w) && ty && ty[1] === expect[1], s.notes.map(x => [x.kind, x.where, x.msg && x.msg.name]));
    }
  }
  {
    const s = sandbox({ flags: ON, runs: [] });
    await s.R.getRoster(s.gas, { where: 'visit' });
    await s.R.getRoster(s.gas, { where: 'visit' });
    t('同じ理由の記録は1画面1回', s.notes.length === 1 && s.gasCalls === 2);
  }
  {
    const s = sandbox({ flags: ON, runs: [] });
    await s.R.getRoster(s.gas, { where: 'BAD where' });
    t('場所の名前が決まりに合わない時は page に置き換える（空白・データを場所に入れない）', s.notes[0] && s.notes[0].where === 'roster:page.stale-old');
  }
  {
    const s = sandbox({ flags: ON, runs: [] });
    let err = null;
    await s.R.getRoster(() => Promise.reject(new Error('gas down')), { where: 'visit' }).catch(e => { err = e; });
    t('Google も失敗した時は、今までどおり失敗として返す（例外を飲み込んで成功にしない）', err && err.message === 'gas down');
  }

  console.log('C 写しから getRoster と同じ形で返す');
  {
    const s = sandbox({ flags: ON });
    const j = await s.R.getRoster(s.gas, { where: 'visit' });
    t('Google を呼ばない・記録しない', s.gasCalls === 0 && s.notes.length === 0);
    t('応答は { roster } だけ（stateRev・srev は付けない）', j && Object.keys(j).join() === 'roster' && j.roster.length === 3);
    const [a, b, c] = j.roster;
    t('キーの並びと名前が getRoster（事務所）と同じ・写しに無い主治医・訪問日・病院は出さない',
      Object.keys(a).join() === 'id,name,kana,room,gender,careLevel,active,updatedAt,targetApps,hospitalized,birthDate,height,dischargeDate', Object.keys(a));
    t('対象アプリはカンマ区切りの文字列・未設定は ""', a.targetApps === 'weight,visit' && b.targetApps === '' && c.targetApps === '');
    t('入院は写しに値がある人だけ真偽で載せ、値が無い人にはキーを作らない', a.hospitalized === false && b.hospitalized === true && !('hospitalized' in c));
    t('退居日は退居者だけ YYYY-MM-DD・在籍者は ""', c.dischargeDate === '2026-09-30' && a.dischargeDate === '' && c.active === false);
    t('文字の項目はすべて文字列（null を出さない）', j.roster.every(r => ['id', 'name', 'kana', 'room', 'gender', 'careLevel', 'updatedAt', 'targetApps', 'birthDate', 'height', 'dischargeDate'].every(k => typeof r[k] === 'string')));
    t('利用者No・介護度・更新時刻をそのまま写す', a.id === 'R001' && a.careLevel === '要介護1' && a.updatedAt === '2026-10-20T01:00:00.000Z');
    const qr = s.queries.find(x => x.table === 'master_residents'), qs = s.queries.find(x => x.table === 'master_sync_runs');
    t('写しの記録は最新の1件だけ読む', qs && qs.ord[0] === 'at' && qs.ord[1].ascending === false && qs.lim === 1);
    t('写しは基本項目の列だけを利用者No順で読む', qr && /^source_id,name,kana,room,gender,care_level,active,hospitalized,discharge_date,birth_date,height,target_apps,source_updated_at$/.test(qr.sel) && qr.ord[0] === 'source_id');
  }
  {
    const s = sandbox({ flags: ON, auth: { status: 'ok', role: 'admin' } });
    const j = await s.R.getRoster(s.gas, { where: 'support' });
    t('管理者のログインでも写しから読む', j && j.roster && j.roster.length === 3 && s.gasCalls === 0);
  }

  console.log('D 結果は1回だけ');
  {
    const s = sandbox({ flags: ON, delay: 60 });
    let n = 0, got = null;
    s.R.getRoster(s.gas, { where: 'visit', timeoutMs: 20 }).then(j => { n++; got = j; });
    await wait(200);
    t('打ち切り（試験は20ms）で Google へ戻し、遅れて届いた写しは捨てる', n === 1 && got === s.GAS && s.gasCalls === 1);
    t('打ち切りを TimeoutError・roster:visit.timeout で記録', s.notes.length === 1 && s.notes[0].where === 'roster:visit.timeout' && s.notes[0].msg.name === 'TimeoutError');
  }
  {
    const s = sandbox({ flags: ON, delay: 5, runs: [] });
    let n = 0;
    s.R.getRoster(s.gas, { where: 'visit', timeoutMs: 40 }).then(() => { n++; });
    await wait(150);
    t('写しが古いと分かって Google へ戻した後、打ち切りの時刻が来ても Google を2回呼ばない', n === 1 && s.gasCalls === 1 && s.notes.length === 1);
  }
  console.log('F 週間俯瞰2画面のつなぎ');
  for (const [file, pre] of [['visit-overview.html', 'vo']]) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const grab = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
    const code = 'var ' + pre.toUpperCase() + '_CFG_KEY=\'rmaster_cfg\';var ' + pre + 'HospMap=null,' + pre + 'HospRev=null,' + pre + 'HospBusy=false;' + grab(pre + 'MasterCfg') + grab(pre + 'FetchHosp') +
      ';this.__get=function(){return {map:' + pre + 'HospMap,rev:' + pre + 'HospRev,busy:' + pre + 'HospBusy};};';
    t(file + ': su-roster.js を su-kv.js の後に読む', /<script src="su-kv\.js\?v=[^"]+"><\/script>\n<!--[^\n]*-->\n<script src="su-roster\.js\?v=2026-10-22"><\/script>/.test(html));
    async function go(withPart, cfg) {
      const s = sandbox(cfg);
      const calls = [];
      const ctx = s.ctx;
      ctx.localStorage.setItem('rmaster_cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/FAKE/exec', token: 'tok-dummy' }));
      ctx.fetch = (url, o) => { calls.push([url, o]); return Promise.resolve({ ok: true, json: () => Promise.resolve({ roster: [{ id: 7, hospitalized: true }, { id: 8 }], stateRev: 3, srev: 4 }) }); };
      if (!withPart) delete ctx.SURoster;
      vm.runInContext(code, ctx);
      const ok = await vm.runInContext(pre + 'FetchHosp()', ctx);
      return { ok, calls, st: ctx.__get(), s };
    }
    const before = { url: 'https://script.google.com/macros/s/FAKE/exec', o: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getRoster', token: 'tok-dummy' }), cache: 'no-store', redirect: 'follow' } };
    for (const withPart of [true, false]) {
      const r = await go(withPart, { flags: { supabase: { care_schedule_v2: true } } });
      t(file + (withPart ? '' : '（部品なし）') + ': スイッチ切では Google への要求が1回・URL・中身・順番まで今までと同じ',
        r.ok === true && r.calls.length === 1 && r.calls[0][0] === before.url && JSON.stringify(r.calls[0][1]) === JSON.stringify(before.o), r.calls);
      t(file + (withPart ? '' : '（部品なし）') + ': 入院の表と版数は Google の応答から作る（今までどおり）',
        JSON.stringify(r.st.map) === '{"7":true}' && r.st.rev.rev === 3 && r.st.rev.srev === 4 && r.st.busy === false);
    }
    {
      const r = await go(true, { flags: ON });
      t(file + ': スイッチ入り・事務所のログインでは Google を呼ばず、写しから入院の表を作る（入院の値が無い人は載せない）',
        r.ok === true && r.calls.filter(c => /script\.google/.test(c[0])).length === 0 && JSON.stringify(r.st.map) === '{"R001":false,"R002":true}' && r.st.rev === null && r.st.busy === false, r.st);
    }
    {
      const r = await go(true, { flags: ON, runs: [] });
      t(file + ': スイッチ入りでも写しが古ければ Google（要求は今までと同じ）',
        r.ok === true && r.calls.filter(c => c[0] === before.url).length === 1 && JSON.stringify(r.calls.find(c => c[0] === before.url)[1]) === JSON.stringify(before.o) && JSON.stringify(r.st.map) === '{"7":true}', r.calls.map(c => c[0]));
    }
  }
  t('打ち切りの既定は8秒・鮮度は24時間', sandbox().R.TIMEOUT_MS === 8000 && sandbox().R.FRESH_MS === 86400000);
  t('部品は console.log を使わない', !/console\.log/.test(SRC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
