/* 入居者マスタの名簿の読み取りの入口（su-roster.js・入居者マスタの Supabase 移行 段階1・改善プロンプト第4弾の6・2026-10-22 新設）
   守りたいこと:
     A スイッチ切（無い・false・読めない）・現場の端末・差分の読み取りは、Google の読み取りをそのまま1回呼ぶ（待ちを足さない）
     B スイッチ入りでも、未ログイン・現場のアカウント・写しが古い・失敗の記録・版数の違い（移行 0019）・人数の違い・打ち切り・
       Supabase の失敗・形の違いは Google へ戻す
     C スイッチ入り・事務所のログイン・新しい写しなら、Google を呼ばずに写しの行を getRoster と同じ形（キー名・型）で返す
     D 結果は1回だけ（打ち切りの後に届いた写しの応答で二重に返さない・Google を2回呼ばない）
     F 訪問支援／全支援 週間俯瞰（voFetchHosp / soFetchHosp）: スイッチ切では Google への要求が今までと1バイトも同じ・
       部品が無くても同じ。スイッチ入りでは写しから入院の重ね表示の表を作る
     E 記録するのは想定外の戻り（打ち切り・ログインの確かめの失敗・通信・データベースの断り・形の違い）だけで1回だけ。種類は su-report.js の
       NOTE_KIND と同じ「保存・同期の失敗」、場所・例外の名前が報告の式に合う。予想どおりの戻り（スイッチ切・現場・未ログイン・
       古い写し・版数の違い・人数の違い）は記録しない（2026-10-22・反証レビューの指摘）
     G 写しの並びは利用者No の順（数字だけの番号は数の順）
     H 写しの記録と写しの本体は、ログインの確かめの後に同時に取る（2026-10-24・アプリ間連携の見直し 段2）。
       記録が古い・失敗あり・版数の違いの時は、取った本体を捨てて Google へ戻す（本体の失敗も記録しない）。判定・応答の形は今までと同じ
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
t('記録の種類は su-report.js の NOTE_KIND（場所ごとに1件・合計3件の扱い）と同じ', /var NOTE_KIND = '保存・同期の失敗';/.test(REP) && /var NOTE_KIND = '保存・同期の失敗';/.test(SRC));
const MURL = 'https://script.google.com/macros/s/FAKE/exec';
const OPT = (o) => Object.assign({ where: 'visit', masterUrl: MURL }, o || {});

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
function run(o) { return Object.assign({ at: iso(NOW - 60 * 60 * 1000), source_count: 3, missing: 0, failed: 0, state_rev: 41, srev: '1761100000000' }, o || {}); }
const REV = { ok: true, rev: 41, srev: 1761100000000 };

/* 砂場。cfg: flags（su_backend_flags の値）・device・auth（{status, role} / 'throw'）・runs・runsErr・rows・rowsErr・delay（ms）・sukv */
function sandbox(cfg) {
  cfg = cfg || {};
  const ls = {};
  if (cfg.flags !== undefined) ls.su_backend_flags = JSON.stringify(cfg.flags);
  if (cfg.device) ls.su_device_role = cfg.device;
  const notes = [], queries = [], events = [];
  let fetches = 0;
  const revCalls = [];
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
        events.push('start:' + table);
        return later(v).then(x => { events.push('end:' + table); return x; }).then(ok, ng);
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
    fetch: (url, o) => {
      if (/action=stateRev/.test(String(url))) {
        revCalls.push([url, o]);
        if (cfg.revErr) return Promise.reject(new TypeError('Failed to fetch'));
        const g = typeof cfg.gasRev === 'function' ? cfg.gasRev() : (cfg.gasRev !== undefined ? cfg.gasRev : REV);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(g) });
      }
      fetches++; return Promise.resolve({ ok: true, json: () => Promise.resolve(cfg.flagsFile || cfg.flags || { supabase: {} }) });
    },
    setTimeout, clearTimeout, Promise, Date, JSON
  };
  if (cfg.sukv) win.SUKv = { _flags: () => cfg.sukv };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'su-roster.js' });
  let gasCalls = 0;
  const GAS = { roster: [{ id: 1, name: 'Google の名簿' }], stateRev: 5, srev: 7 };
  const gas = () => { gasCalls++; return Promise.resolve(GAS); };
  return { R: win.SURoster, ctx: win, gas, GAS, notes, queries, events, ls, revCalls, get gasCalls() { return gasCalls; }, get fetches() { return fetches; } };
}
const ON = { supabase: { care_schedule_v2: true, master_roster_read: true } };

(async () => {
  console.log('A スイッチ切・現場の端末・差分は Google をそのまま');
  for (const [label, flags] of [['スイッチが無い', { supabase: { care_schedule_v2: true } }], ['false', { supabase: { master_roster_read: false } }],
    ['文字の "true"', { supabase: { master_roster_read: 'true' } }], ['控えが無い', undefined]]) {
    const s = sandbox({ flags });
    let sync = false;
    const p = s.R.getRoster(() => { sync = true; return s.gas(); }, OPT());
    t(label + ': Google の読み取りを同じ呼び出しの中で1回呼ぶ（待ちを足さない）', sync && s.gasCalls === 1);
    const j = await p;
    t(label + ': 応答は Google のもの（stateRev も含めそのまま）', j === s.GAS);
    t(label + ': Supabase に触らない・記録しない・スイッチを読みに行かない', s.queries.length === 0 && s.notes.length === 0 && s.fetches === 0);
  }
  {
    const s = sandbox({ flags: ON, device: 'field' });
    const j = await s.R.getRoster(s.gas, OPT());
    t('現場の端末（su_device_role=field）はスイッチ入りでも Google・写しを読まない', j === s.GAS && s.gasCalls === 1 && s.queries.length === 0 && s.notes.length === 0);
  }
  {
    const s = sandbox({ flags: ON });
    const j = await s.R.getRoster(s.gas, OPT({ since: '2026-10-01' }));
    t('差分の読み取り（since）は Google', j === s.GAS && s.queries.length === 0);
  }
  {
    const s = sandbox({ flags: { supabase: { master_roster_read: false } }, sukv: ON });
    const j = await s.R.getRoster(s.gas, OPT());
    t('su-kv.js があればその値を使う（控えより優先）', j && j.roster && j.roster.length === 3 && s.gasCalls === 0);
  }
  {
    const s = sandbox({ flags: ON, sukv: { supabase: { master_roster_read: false } } });
    const j = await s.R.getRoster(s.gas, OPT());
    t('su-kv.js の値が切なら、控えが入りでも Google', j === s.GAS && s.queries.length === 0);
  }
  {
    const s = sandbox({ flags: ON, flagsFile: { supabase: { master_roster_read: false } } });
    const j = await s.R.getRoster(s.gas, OPT());
    t('su-kv.js が無い画面で、控えは入りでも読み直したスイッチが切なら Google（記録しない）', j === s.GAS && s.fetches === 1 && s.queries.length === 0 && s.notes.length === 0);
  }

  console.log('B Google へ戻す場面');
  const cases = [
    ['未ログイン', { auth: { status: 'signed_out' } }, null],
    ['現場のアカウント', { auth: { status: 'ok', role: 'field' } }, null],
    ['ログインの確かめで例外', { auth: 'throw' }, ['auth', 'AuthError']],
    ['写しの記録が無い', { runs: [] }, null],
    ['写しの記録が24時間より古い', { runs: [run({ at: iso(NOW - 25 * 60 * 60 * 1000) })] }, null],
    ['写しの記録に失敗がある', { runs: [run({ failed: 1 })] }, null],
    ['写しの人数が記録の人数と違う（写しにだけ残る人）', { runs: [run({ source_count: 2, missing: 1 })] }, null],
    ['Google の版数（rev）が記録より進んでいる（入院・退院）', { gasRev: { ok: true, rev: 42, srev: 1761100000000 } }, null],
    ['Google の srev が記録と違う（排泄記録からの書き戻し）', { gasRev: { ok: true, rev: 41, srev: 1761100009999 } }, null],
    ['記録に版数が無い（0019 より前・古い画面の写し）', { runs: [run({ state_rev: null, srev: null })] }, null],
    ['記録に srev だけ無い', { runs: [run({ srev: null })] }, null],
    ['Google の版数の応答に srev が無い', { gasRev: { ok: true, rev: 41 } }, null],
    ['Google の版数の応答が ok でない', { gasRev: { ok: false } }, null],
    ['Google の版数が通信の失敗で読めない', { revErr: true }, ['network', 'NetworkError']],
    ['記録の読み取りで失敗', { runsErr: true }, ['db', 'DataError']],
    ['写しの読み取りで失敗', { rowsErr: true }, ['db', 'DataError']],
    ['写しが空', { rows: [] }, ['shape', 'ShapeError']],
    ['在籍が真偽でない', { rows: rows().map((r, i) => i === 1 ? Object.assign(r, { active: 'true' }) : r) }, ['shape', 'ShapeError']],
    ['利用者No が重複', { rows: rows().map((r, i) => i === 2 ? Object.assign(r, { source_id: 'R001' }) : r) }, ['shape', 'ShapeError']],
    ['入院が真偽でない', { rows: rows().map((r, i) => i === 0 ? Object.assign(r, { hospitalized: 'false' }) : r) }, ['shape', 'ShapeError']]
  ];
  for (const [label, cfg, expect] of cases) {
    const s = sandbox(Object.assign({ flags: ON }, cfg));
    const j = await s.R.getRoster(s.gas, OPT());
    t(label + ': Google の応答を1回だけ読んで返す', j === s.GAS && s.gasCalls === 1);
    if (!expect) t(label + ': 予想どおりの戻りなので記録しない', s.notes.length === 0, s.notes);
    else {
      const n = s.notes[0] || {};
      const w = String(n.where), ty = (String(n.msg && n.msg.name) + ': ' + String(n.msg && n.msg.message)).match(TYPE_RE);
      t(label + ': 「保存・同期の失敗」の種類で roster:visit.' + expect[0] + '・' + expect[1] + ' を1件だけ記録し、報告の式に合う',
        s.notes.length === 1 && n.kind === '保存・同期の失敗' && w === 'roster:visit.' + expect[0] && WHERE_RE.test(w) && ty && ty[1] === expect[1], s.notes.map(x => [x.kind, x.where, x.msg && x.msg.name]));
    }
  }
  {
    const s = sandbox({ flags: ON, rowsErr: true });
    await s.R.getRoster(s.gas, OPT());
    await s.R.getRoster(s.gas, OPT());
    t('同じ理由の記録は1画面1回', s.notes.length === 1 && s.gasCalls === 2);
  }
  {
    const s = sandbox({ flags: ON, rowsErr: true });
    await s.R.getRoster(s.gas, OPT({ where: 'BAD where' }));
    t('場所の名前が決まりに合わない時は page に置き換える（空白・データを場所に入れない）', s.notes[0] && s.notes[0].where === 'roster:page.db');
  }
  for (const [label, mu] of [['入居者マスタの URL が無い', ''], ['URL が https でない', 'http://example.invalid/exec']]) {
    const s = sandbox({ flags: ON });
    const j = await s.R.getRoster(s.gas, OPT({ masterUrl: mu }));
    t(label + ': 版数を確かめられないので Google（版数も写しも聞かない・記録しない）', j === s.GAS && s.revCalls.length === 0 && s.queries.length === 0 && s.notes.length === 0);
  }
  {
    const s = sandbox({ flags: ON });
    await s.R.getRoster(s.gas, OPT());
    t('版数は見張りと同じ送り方（GET・合言葉なし・action=stateRev だけ）で1回聞く',
      s.revCalls.length === 1 && s.revCalls[0][0] === MURL + '?action=stateRev' && JSON.stringify(s.revCalls[0][1]) === JSON.stringify({ method: 'GET', cache: 'no-store', redirect: 'follow' }), s.revCalls);
    const qs = s.queries.find(x => x.table === 'master_sync_runs');
    t('写しの記録は版数の列（state_rev・srev）も読む', qs && /,state_rev,srev$/.test(qs.sel), qs && qs.sel);
  }
  {
    const s = sandbox({ flags: ON, rowsErr: true });
    let err = null;
    await s.R.getRoster(() => Promise.reject(new Error('gas down')), OPT()).catch(e => { err = e; });
    t('Google も失敗した時は、今までどおり失敗として返す（例外を飲み込んで成功にしない）', err && err.message === 'gas down');
  }

  console.log('C 写しから getRoster と同じ形で返す');
  {
    const s = sandbox({ flags: ON });
    const j = await s.R.getRoster(s.gas, OPT());
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
    const j = await s.R.getRoster(s.gas, OPT({ where: 'support' }));
    t('管理者のログインでも写しから読む', j && j.roster && j.roster.length === 3 && s.gasCalls === 0);
  }

  console.log('D 結果は1回だけ');
  {
    const s = sandbox({ flags: ON, delay: 60 });
    let n = 0, got = null;
    s.R.getRoster(s.gas, OPT({ timeoutMs: 20 })).then(j => { n++; got = j; });
    await wait(200);
    t('打ち切り（試験は20ms）で Google へ戻し、遅れて届いた写しは捨てる', n === 1 && got === s.GAS && s.gasCalls === 1);
    t('打ち切りを TimeoutError・roster:visit.timeout で記録', s.notes.length === 1 && s.notes[0].where === 'roster:visit.timeout' && s.notes[0].msg.name === 'TimeoutError');
  }
  {
    const s = sandbox({ flags: ON, delay: 5, runs: [] });
    let n = 0;
    s.R.getRoster(s.gas, OPT({ timeoutMs: 40 })).then(() => { n++; });
    await wait(150);
    t('写しが古いと分かって Google へ戻した後、打ち切りの時刻が来ても Google を2回呼ばない・記録しない', n === 1 && s.gasCalls === 1 && s.notes.length === 0);
  }
  console.log('F 週間俯瞰2画面のつなぎ');
  for (const [file, pre] of [['visit-overview.html', 'vo'], ['support-overview.html', 'so']]) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const grab = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
    const code = 'var ' + pre.toUpperCase() + '_CFG_KEY=\'rmaster_cfg\';var ' + pre + 'HospMap=null,' + pre + 'HospRev=null,' + pre + 'HospBusy=false;' +
      'var DB=null;this.__renders=0;function render(){__renders++;}function refresh(){__renders++;}' +
      grab(pre + 'MasterCfg') + grab(pre + 'FetchHosp') + grab(pre + 'WatchState') +
      ';this.__get=function(){return {map:' + pre + 'HospMap,rev:' + pre + 'HospRev,busy:' + pre + 'HospBusy};};';
    t(file + ': su-roster.js を su-kv.js の後に読む', /<script src="su-kv\.js\?v=[^"]+"><\/script>\n<!--[^\n]*-->\n<script src="su-roster\.js\?v=2026-10-24"><\/script>/.test(html));
    async function go(withPart, cfg) {
      const s = sandbox(cfg);
      const calls = [];
      const ctx = s.ctx;
      ctx.localStorage.setItem('rmaster_cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/FAKE/exec', token: 'tok-dummy' }));
      ctx.gasNow = { rev: 41, srev: 1761100000000 };   // Google の今の版数（見張りの組み合わせで進める）
      ctx.fetch = (url, o) => {
        calls.push([url, o]);
        if (/action=stateRev/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, rev: ctx.gasNow.rev, srev: ctx.gasNow.srev }) });
        if (/su-backend\.json/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(cfg.flags) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ roster: [{ id: 7, hospitalized: true }, { id: 8 }], stateRev: ctx.gasNow.rev, srev: ctx.gasNow.srev }) });
      };
      ctx.document.hidden = false;
      if (!withPart) delete ctx.SURoster;
      vm.runInContext(code, ctx);
      const ok = await vm.runInContext(pre + 'FetchHosp()', ctx);
      return { ok, calls, st: ctx.__get(), s, ctx, code };
    }
    const before = { url: 'https://script.google.com/macros/s/FAKE/exec', o: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getRoster', token: 'tok-dummy' }), cache: 'no-store', redirect: 'follow' } };
    for (const withPart of [true, false]) {
      const r = await go(withPart, { flags: { supabase: { care_schedule_v2: true } } });
      t(file + (withPart ? '' : '（部品なし）') + ': スイッチ切では Google への要求が1回・URL・中身・順番まで今までと同じ',
        r.ok === true && r.calls.length === 1 && r.calls[0][0] === before.url && JSON.stringify(r.calls[0][1]) === JSON.stringify(before.o), r.calls);
      t(file + (withPart ? '' : '（部品なし）') + ': 入院の表と版数は Google の応答から作る（今までどおり）',
        JSON.stringify(r.st.map) === '{"7":true}' && r.st.rev.rev === 41 && r.st.rev.srev === 1761100000000 && r.st.busy === false);
    }
    {
      const r = await go(true, { flags: ON });
      const gasRoster = c => c[0] === before.url && c[1] && c[1].method === 'POST';
      t(file + ': スイッチ入り・事務所のログインでは Google の名簿を呼ばず、写しから入院の表を作る（入院の値が無い人は載せない）',
        r.ok === true && r.calls.filter(gasRoster).length === 0 && JSON.stringify(r.st.map) === '{"R001":false,"R002":true}' && r.st.rev === null && r.st.busy === false, r.st);
    }
    {
      const r = await go(true, { flags: ON, runs: [] });
      t(file + ': スイッチ入りでも写しが古ければ Google（要求は今までと同じ）',
        r.ok === true && r.calls.filter(c => c[0] === before.url).length === 1 && JSON.stringify(r.calls.find(c => c[0] === before.url)[1]) === JSON.stringify(before.o) && JSON.stringify(r.st.map) === '{"7":true}', r.calls.map(c => c[0]));
    }
    {
      /* 見張りとの組み合わせ: 朝に写し（版数 41）→ 画面を開くと写しから → 昼に入院で Google の版数が 42 へ → 見張りが気づいて読み直す → Google から */
      const r = await go(true, { flags: ON });
      const gasRoster = c => c[0] === before.url && c[1] && c[1].method === 'POST';
      t(file + ': 見張り: 朝の写しと版数が同じ間は写しから（Google の名簿は呼ばない）', r.calls.filter(gasRoster).length === 0 && JSON.stringify(r.st.map) === '{"R001":false,"R002":true}');
      vm.runInContext(pre + 'WatchState()', r.ctx);
      await wait(30);
      t(file + ': 見張り: 版数が変わらなければ読み直さない（1回目は基準を覚えて写しを読み直すだけ）', r.calls.filter(gasRoster).length === 0);
      r.ctx.gasNow = { rev: 42, srev: 1761100000000 };   // 昼に入院（setState）で版数が進んだ。写しはまだ朝のまま
      vm.runInContext(pre + 'WatchState()', r.ctx);
      await wait(30);
      const st = r.ctx.__get();
      t(file + ': 見張り: 版数が進んだら読み直しは Google から（写しの古い入院の表を使わない）',
        r.calls.filter(gasRoster).length === 1 && JSON.stringify(r.calls.filter(gasRoster)[0][1]) === JSON.stringify(before.o) && JSON.stringify(st.map) === '{"7":true}' && st.rev.rev === 42, st);
      t(file + ': 見張り: 予想どおりの戻りなので記録しない', r.s.notes.length === 0, r.s.notes);
    }
  }
  console.log('G 並び');
  {
    const ids = ['10', 'R002', '9', '100', 'R001', '2'];
    const rs = ids.map(id => Object.assign(rows()[0], { source_id: id }));
    const s = sandbox({ flags: ON, rows: rs, runs: [run({ source_count: ids.length })] });
    const j = await s.R.getRoster(s.gas, OPT());
    t('利用者No の順（数字だけの番号は数の順・その後に文字の番号を文字の順）', j && j.roster && j.roster.map(r => r.id).join() === '2,9,10,100,R001,R002', j && j.roster && j.roster.map(r => r.id));
  }
  console.log('H 写しの記録と本体を同時に取る');
  {
    const s = sandbox({ flags: ON, delay: 20 });
    const j = await s.R.getRoster(s.gas, OPT());
    const iRows = s.events.indexOf('start:master_residents'), iRunsEnd = s.events.indexOf('end:master_sync_runs');
    t('★H 写しの本体は、写しの記録の応答を待たずに取り始める（同時に取る）', iRows >= 0 && iRunsEnd >= 0 && iRows < iRunsEnd, s.events);
    t('H 同時に取っても、写しから返す応答は今までと同じ（Google を呼ばない・記録しない）', j && j.roster && j.roster.length === 3 && s.gasCalls === 0 && s.notes.length === 0);
    t('H 写しの記録・本体とも1回ずつだけ取る', s.queries.filter(x => x.table === 'master_sync_runs').length === 1 && s.queries.filter(x => x.table === 'master_residents').length === 1);
  }
  {
    const s = sandbox({ flags: ON, auth: { status: 'ok', role: 'field' } });
    await s.R.getRoster(s.gas, OPT());
    t('H ログインの確かめが通らない時は、記録も本体も取らない（今までどおり）', s.queries.length === 0 && s.gasCalls === 1);
  }
  for (const [label, cfg] of [
    ['Google の版数（rev）が記録と違う', { gasRev: { ok: true, rev: 42, srev: 1761100000000 } }],
    ['Google の srev が記録と違う', { gasRev: { ok: true, rev: 41, srev: 1761100009999 } }],
    ['記録に版数が無い', { runs: [run({ state_rev: null, srev: null })] }],
    ['写しの記録が古い', { runs: [run({ at: iso(NOW - 25 * 60 * 60 * 1000) })] }],
    ['写しの記録に失敗がある', { runs: [run({ failed: 1 })] }],
    ['写しの記録が無い', { runs: [] }]
  ]) {
    const s = sandbox(Object.assign({ flags: ON, delay: 5 }, cfg));
    const j = await s.R.getRoster(s.gas, OPT());
    t('★H ' + label + ': 同時に取った本体を捨てて Google へ戻す（記録しない）',
      j === s.GAS && s.gasCalls === 1 && s.queries.some(x => x.table === 'master_residents') && s.notes.length === 0, { gas: s.gasCalls, notes: s.notes.length, ev: s.events });
  }
  {
    const s = sandbox({ flags: ON, gasRev: { ok: true, rev: 42, srev: 1761100000000 }, rowsErr: true });
    const j = await s.R.getRoster(s.gas, OPT());
    t('H 版数が違う時は、本体の読み取りが失敗していても記録しない（本体を見ずに捨てる＝今までと同じ）', j === s.GAS && s.gasCalls === 1 && s.notes.length === 0, s.notes);
  }
  {
    const s = sandbox({ flags: ON, runsErr: true, rowsErr: true });
    await s.R.getRoster(s.gas, OPT());
    t('H 記録と本体の両方が失敗した時は、記録の失敗として1件だけ残す（今までと同じ理由の名前）', s.notes.length === 1 && s.notes[0].where === 'roster:visit.db' && s.gasCalls === 1, s.notes.map(x => x.where));
  }
  {
    const s = sandbox({ flags: ON, rows: rows().slice(0, 2) });
    const j = await s.R.getRoster(s.gas, OPT());
    t('H 人数が記録と違う時は Google（記録しない・今までどおり）', j === s.GAS && s.gasCalls === 1 && s.notes.length === 0);
  }
  {
    let unhandled = 0;
    const onU = () => { unhandled++; };
    process.on('unhandledRejection', onU);
    const rejectRows = sandbox({ flags: ON, runs: [] });
    rejectRows.ctx.SUAuth.client = () => ({ from: (table) => {
      const api = { select() { return api; }, order() { return api; }, limit() { return api; },
        then(ok, ng) { return (table === 'master_residents' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data: [] })).then(ok, ng); } };
      return api;
    } });
    const j = await rejectRows.R.getRoster(rejectRows.gas, OPT());
    await wait(30);
    process.removeListener('unhandledRejection', onU);
    t('H 捨てる本体の読み取りが例外で終わっても、未処理の失敗にしない・記録しない', j === rejectRows.GAS && unhandled === 0 && rejectRows.notes.length === 0, { unhandled, notes: rejectRows.notes.length });
  }
  t('打ち切りの既定は8秒・鮮度は24時間', sandbox().R.TIMEOUT_MS === 8000 && sandbox().R.FRESH_MS === 86400000);
  t('部品は console.log を使わない', !/console\.log/.test(SRC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
