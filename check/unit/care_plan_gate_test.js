/* 週間計画（care-schedule.html）・デイ利用表（daycare-roster.html）── 共通 DB の口 cs_plan_gate の確かめの試験（2026-11-27 新設）
   実行: node check/unit/care_plan_gate_test.js（環境変数 CS_HTML・DCR_HTML で別の版を当てられる）

   守りたいこと（両方の画面で同じ）:
     1. 口が ok:true を返した時だけ「あり」と覚える。エラー・例外・ok が true でない時は「なし」の時刻を付ける
     2. ログインの部品（SUAuth）が無い・新しい保存先へ切り替えていない時は口を呼ばず、「なし」の時刻も付けない
     3. 答えが来ない時は15秒で打ち切り、確かめの約束を空に戻して「なし」の時刻を付ける。打ち切りの後に届いた ok:true は「あり」と覚える。
        遅れて届いた古い答えが、打ち切りの後に始めた新しい確かめを消さない
     4. 「なし」の後は5分たつまで口を呼ばず、5分たつと確かめ直す
     5. 同時の確かめは1本にまとめる
     6. 送り直しの前の確かめ直し（Recheck）は5分の待ちを素通りし、最大10秒待つ。送る前の待ち（Wait）は最大3秒
   ★実物の関数を HTML から切り出して、偽の時計（setTimeout・Date.now）の vm で動かす。データは使わない（氏名なし）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CS_SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');
const DCR_SRC = fs.readFileSync(process.env.DCR_HTML || path.join(ROOT, 'daycare-roster.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + JSON.stringify(info))); }
}

/* ── 切り出し（care_plan_merge_test.js と同じ方式）── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(src, name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = src.indexOf('\nasync function ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(src, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(start, end + 1);
}
function grabLine(src, name) {
  const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=[^\\n]*', 'm').exec(src);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  return m[0].replace(/^(?:const|let)\s/, 'var ');
}

/* ── 偽の時計 ── */
function makeClock() {
  let now = 1700000000000, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (Number(ms) || 0), fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [id, tm];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
function deferred() { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; }

/* 画面ごとの名前 */
const PAGES = [
  { label: '週間計画', src: CS_SRC, state: 'csPlanGate_', probe: 'csPlanGateProbe_', wait: 'csPlanGateWait_', recheck: 'csPlanGateRecheck_', auth: 'csAuthLoad_',
    consts: ['CS_PLAN_GATE_RECHECK_MS', 'CS_PLAN_GATE_WAIT_MS', 'CS_PLAN_GATE_TIMEOUT_MS', 'CS_PLAN_GATE_RETRY_WAIT_MS'], note: null },
  { label: 'デイ利用表', src: DCR_SRC, state: 'dcrGate_', probe: 'dcrGateProbe_', wait: 'dcrGateWait_', recheck: 'dcrGateRecheck_', auth: 'dcrAuthLoad_',
    consts: ['DCR_GATE_RECHECK_MS', 'DCR_GATE_WAIT_MS', 'DCR_GATE_TIMEOUT_MS', 'DCR_GATE_RETRY_WAIT_MS'], note: 'dcrGateNote_' },
];

/* rpc … 呼ばれるたびに答えを返す関数（Promise でもよい）。opts.noAuth … SUAuth が無い。opts.notRouted … 新しい保存先へ切り替えていない */
function makeEnv(pg, rpc, opts = {}) {
  const clock = makeClock();
  const notes = [];
  const calls = [];
  const FakeDate = function () { return new Date(clock.now()); };
  FakeDate.now = () => clock.now();
  const win = {
    SUKv: { routed: (k) => !opts.notRouted && k === 'care_schedule_v2' },
    SUErrors: { note: (where, e) => notes.push(String(where)) },
  };
  if (!opts.noAuth) win.SUAuth = { client: () => ({ rpc: (fn) => { calls.push(fn); return rpc(calls.length); } }) };
  const ctx = {
    window: win, Date: FakeDate, Promise, Object, Array, Number, String, Error, Math, JSON,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
  ctx.SUKv = win.SUKv; ctx.SUErrors = win.SUErrors;
  if (win.SUAuth) ctx.SUAuth = win.SUAuth;
  vm.createContext(ctx);
  let code = "var LS_KEY = 'care_schedule_v2';\n";
  code += 'function ' + pg.auth + '() { return Promise.resolve(); }\n';
  if (!pg.note) code += 'function csNote_(where, e) { window.SUErrors.note(where, e); }\n';
  else code += grabFn(pg.src, pg.note) + '\n';
  pg.consts.forEach((c) => { code += grabLine(pg.src, c) + '\n'; });
  code += grabLine(pg.src, pg.state) + '\n';
  [pg.probe, pg.wait, pg.recheck].forEach((f) => { code += grabFn(pg.src, f) + '\n'; });
  code += 'var __api = { probe: ' + pg.probe + ', wait: ' + pg.wait + ', recheck: ' + pg.recheck + ', st: function () { return ' + pg.state + '; } };';
  vm.runInContext(code, ctx);
  return { api: ctx.__api, clock, notes, calls, consts: Object.fromEntries(pg.consts.map((c) => [c, vm.runInContext(c, ctx)])) };
}
/* 約束が決まったかを、偽の時計を進めずに見る */
function watch(p) { const w = { done: false, v: undefined }; Promise.resolve(p).then((v) => { w.done = true; w.v = v; }); return w; }

const OK = () => ({ data: { ok: true, minAppVer: 2026112701 }, error: null });
const MIN5 = 5 * 60 * 1000;

(async () => {
  for (const pg of PAGES) {
    console.log('\n— ' + pg.label + ' —');
    {
      const e = makeEnv(pg, () => null);
      const [rk, wt, to, rw] = pg.consts.map((c) => e.consts[c]);
      t(pg.label + ': 決まりの数（5分・3秒・15秒・10秒）', rk === MIN5 && wt === 3000 && to === 15000 && rw === 10000, e.consts);
    }
    /* 1 ok:true */
    {
      const e = makeEnv(pg, OK);
      const w = watch(e.api.probe()); await flush();
      t(pg.label + ': ok:true → 「あり」と覚える・約束を空に戻す・打ち切りの時計が残らない', w.done && w.v === true && e.api.st().yes === true && e.api.st().p === null && e.clock.pending() === 0, { w, st: e.api.st(), timers: e.clock.pending() });
      const w2 = watch(e.api.probe()); await flush();
      t(pg.label + ': 「あり」の後は口を呼ばずに true', w2.v === true && e.calls.length === 1, e.calls);
      const w3 = watch(e.api.recheck()); await flush();
      t(pg.label + ': 確かめ直しも「あり」ならすぐ true（口を呼ばない）', w3.done && w3.v === true && e.calls.length === 1, e.calls);
    }
    /* 2 エラー・3 例外・4 ok が true でない */
    for (const [name, rpc] of [
      ['エラー', () => ({ data: null, error: { message: 'function not found' } })],
      ['例外', () => Promise.reject(new Error('Failed to fetch'))],
      ['ok:false', () => ({ data: { ok: false }, error: null })],
      ['ok が文字の "true"', () => ({ data: { ok: 'true' }, error: null })],
      ['答えが空', () => null],
    ]) {
      const e = makeEnv(pg, rpc);
      const w = watch(e.api.probe()); await flush();
      t(pg.label + ': ' + name + ' → false・「なし」の時刻・「あり」と覚えない・約束を空に戻す', w.done && w.v === false && e.api.st().yes === false && e.api.st().noAt === e.clock.now() && e.api.st().p === null, { w, st: e.api.st() });
      if (name === '例外') t(pg.label + ': 例外は記録に残す', e.notes.some((n) => /版の確かめ/.test(n)), e.notes);
    }
    /* 5 SUAuth が無い・切り替えていない */
    {
      const e = makeEnv(pg, OK, { noAuth: true });
      const w = watch(e.api.probe()); await flush();
      t(pg.label + ': SUAuth が無い → false・口を呼ばない・「なし」の時刻を付けない（まだ確かめていない）', w.done && w.v === false && e.calls.length === 0 && e.api.st().noAt === 0 && e.api.st().p === null, e.api.st());
      const w2 = watch(e.api.probe()); await flush();
      t(pg.label + ': SUAuth が無い時は次の確かめも5分待たない（また試す）', w2.done && w2.v === false && e.api.st().noAt === 0);
    }
    {
      const e = makeEnv(pg, OK, { notRouted: true });
      const w = watch(e.api.probe()); await flush();
      t(pg.label + ': 新しい保存先へ切り替えていない → false・口を呼ばない', w.done && w.v === false && e.calls.length === 0 && e.api.st().noAt === 0);
    }
    /* 6 答えない → 15秒で打ち切り */
    {
      const d1 = deferred();
      const e = makeEnv(pg, () => d1.p);
      const w = watch(e.api.probe()); await flush();
      const p1 = e.api.st().p;
      await e.clock.advance(14999);
      t(pg.label + ': 答えが来ない間（14.999秒）は確かめの最中のまま', !w.done && e.api.st().p === p1 && p1 !== null && e.api.st().noAt === 0);
      const wSame = watch(e.api.probe()); await flush();
      t(pg.label + ': 確かめの最中は同じ約束を返す（口は1回）', e.calls.length === 1 && !wSame.done);
      await e.clock.advance(1);
      t(pg.label + ': 15秒で打ち切る → false・約束を空に戻す・「なし」の時刻・記録に残す', w.done && w.v === false && wSame.v === false && e.api.st().p === null && e.api.st().noAt === e.clock.now() && e.notes.some((n) => /答えが来ない/.test(n)), { w, st: e.api.st(), notes: e.notes });
      const w2 = watch(e.api.probe()); await flush();
      t(pg.label + ': 打ち切りの後、5分の間は口を呼ばない', w2.done && w2.v === false && e.calls.length === 1);
      d1.res(OK()); await flush();
      t(pg.label + ': 打ち切りの後に届いた ok:true は「あり」と覚える', e.api.st().yes === true, e.api.st());
      const w3 = watch(e.api.probe()); await flush();
      t(pg.label + ': その後の確かめは口を呼ばずに true', w3.v === true && e.calls.length === 1);
    }
    /* 6b 遅れて届いた古い答えが、新しい確かめの約束を消さない */
    {
      const ds = [deferred(), deferred()];
      const e = makeEnv(pg, (n) => ds[n - 1].p);
      e.api.probe(); await flush();
      await e.clock.advance(15000);
      await e.clock.advance(MIN5);
      const w2 = watch(e.api.probe()); await flush();
      const p2 = e.api.st().p;
      t(pg.label + ': 5分後に新しい確かめが始まる（口は2回目）', e.calls.length === 2 && p2 !== null && !w2.done);
      ds[0].res({ data: { ok: false }, error: null }); await flush();
      t(pg.label + ': 遅れて届いた古い答え（なし）は、新しい確かめの約束を消さない', e.api.st().p === p2 && !w2.done, { same: e.api.st().p === p2 });
      ds[1].res(OK()); await flush();
      t(pg.label + ': 新しい確かめの ok:true で「あり」・約束を空に戻す', w2.done && w2.v === true && e.api.st().yes === true && e.api.st().p === null);
    }
    /* 7 5分後の確かめ直し */
    {
      let n = 0;
      const e = makeEnv(pg, () => (++n === 1 ? { data: { ok: false }, error: null } : OK()));
      await watch(e.api.probe()); await flush();
      await e.clock.advance(MIN5 - 1);
      const w1 = watch(e.api.probe()); await flush();
      t(pg.label + ': 「なし」の後 4分59.999秒は口を呼ばずに false', w1.done && w1.v === false && e.calls.length === 1);
      await e.clock.advance(1);
      const w2 = watch(e.api.probe()); await flush();
      t(pg.label + ': 5分たつと口を呼び直し、ok:true で「あり」', w2.done && w2.v === true && e.calls.length === 2 && e.api.st().yes === true);
    }
    /* 8 同時の確かめは1本 */
    {
      const d = deferred();
      const e = makeEnv(pg, () => d.p);
      const ws = [watch(e.api.probe()), watch(e.api.probe()), watch(e.api.probe())]; await flush();
      t(pg.label + ': 同時に3回確かめても口は1回', e.calls.length === 1 && ws.every((w) => !w.done), e.calls);
      d.res(OK()); await flush();
      t(pg.label + ': 3つとも同じ答え（true）', ws.every((w) => w.done && w.v === true));
    }
    /* 9 送る前の待ちは最大3秒 */
    {
      const d = deferred();
      const e = makeEnv(pg, () => d.p);
      const w = watch(e.api.wait(e.api.probe())); await flush();
      await e.clock.advance(2999);
      t(pg.label + ': 送る前の待ちは 2.999秒ではまだ決まらない', !w.done);
      await e.clock.advance(1);
      t(pg.label + ': 送る前の待ちは3秒で false（印なし）・確かめは続く', w.done && w.v === false && e.api.st().p !== null);
    }
    /* 10 確かめ直しは5分の待ちを素通りする */
    {
      let n = 0;
      const e = makeEnv(pg, () => (++n === 1 ? { data: null, error: { message: 'temporary' } } : OK()));
      await watch(e.api.probe()); await flush();
      t(pg.label + ': 1回目はエラーで「なし」', e.api.st().noAt > 0 && e.api.st().yes === false);
      await e.clock.advance(60 * 1000);
      const w = watch(e.api.recheck()); await flush();
      t(pg.label + ': 確かめ直しは5分の間でも口を呼び直し、ok:true で true', w.done && w.v === true && e.calls.length === 2 && e.api.st().yes === true, { w, calls: e.calls.length });
    }
    {
      const e = makeEnv(pg, () => ({ data: { ok: false }, error: null }));
      await watch(e.api.probe()); await flush();
      const w = watch(e.api.recheck()); await flush();
      t(pg.label + ': 確かめ直しても「なし」なら false', w.done && w.v === false && e.calls.length === 2 && e.api.st().yes === false);
    }
    /* 11 確かめ直しの最中に確かめがあれば、それを待つ（口を重ねない）・最大10秒 */
    {
      const d = deferred();
      const e = makeEnv(pg, () => d.p);
      e.api.probe(); await flush();
      const w = watch(e.api.recheck()); await flush();
      t(pg.label + ': 確かめの最中の確かめ直しは口を重ねない', e.calls.length === 1 && !w.done);
      await e.clock.advance(9999);
      t(pg.label + ': 確かめ直しは 9.999秒ではまだ決まらない', !w.done);
      await e.clock.advance(1);
      t(pg.label + ': 確かめ直しは10秒で false', w.done && w.v === false);
    }
    {
      const d = deferred();
      const e = makeEnv(pg, () => d.p);
      e.api.probe(); await flush();
      const w = watch(e.api.recheck()); await flush();
      await e.clock.advance(4000);
      d.res(OK()); await flush();
      t(pg.label + ': 確かめ直しの間に ok:true が届けば true', w.done && w.v === true);
    }
  }
  /* 両方の画面で同じ決まり（数）であること */
  console.log('\n— 両方の画面で同じ数 —');
  const v = (src, n) => (new RegExp('^var\\s+' + n + '\\s*=\\s*([^;\\n]+)', 'm').exec(src) || [])[1];
  t('週間計画とデイ利用表で、5分・3秒・15秒・10秒が同じ', ['RECHECK_MS', 'WAIT_MS', 'TIMEOUT_MS', 'RETRY_WAIT_MS'].every((k) => v(CS_SRC, 'CS_PLAN_GATE_' + k) && v(CS_SRC, 'CS_PLAN_GATE_' + k) === v(DCR_SRC, 'DCR_GATE_' + k)));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('✗ 試験の途中で止まりました: ' + (e && e.stack || e)); process.exit(1); });
