/* su-kv.js の Google への写し返しの取りこぼし対策（2026-10-16 新設・代表者の決定）。
   写しの見比べの「本番の中身の見比べ」で、Google が古いまま（週の型1件・日ごと2件）が見つかった。
   保存の20秒後に写し返す作りで、待ちの間に画面を閉じると届かなかった。
   守りたいこと:
     A 保存できたら、写し返しの予定を端末に控える（キーと時刻だけ・中身は持たない）。Google が受け取ったら控えを消す
     B Google が断った・通信に失敗した時は控えを残す（成功扱いにしない）
     C 画面を隠した時（別のアプリ・タブへ移る・閉じる）は、20秒を待たずにその場で写し返す
     D 次にその端末で保存できた時、控えに残っている他のキーも写し返す（7日より古い控え・扱わないキーは捨てる）
     E 写している間に新しく保存された分の控えは消さない（まだ届いていない）
     F 読み込みだけでは、控えの残りを写し返さない（読むだけの画面の送り方で Google へ書かない）
   ★本物の su-kv.js を砂場で動かす。偽物にするのは、ログインの状態・データベース・Google への送信・時計だけ。
   実行: node check/unit/sukv_mirror_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-kv.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const clone = v => JSON.parse(JSON.stringify(v));
const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 12; i++) await tick(); }
const LS_KEY = 'su_kv_mirror_pending';

function make(o) {
  o = o || {};
  const ls = new Map(o.ls || []);
  ls.set('su_backend_flags', JSON.stringify({ supabase: { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false } }));
  let now = o.now || Date.parse('2026-10-16T12:00:00Z');
  const timers = [], listeners = {}, raws = [], rpcs = [];
  const db = { rev: 5, data: { 'care_schedule_v2': { v: 'care' }, 'ws_weekly_master_v1': { v: 'master' }, 'wsday_2026-10-19': { v: 'd19' } } };
  const sb = {
    rpc(name, args) {
      rpcs.push(name);
      if (name === 'kv_get') return Promise.resolve({ data: { ok: true, rev: db.rev, data: clone(db.data[args.p_key] || { v: 'x' }), updatedAt: 'x' } });
      if (name === 'kv_put') { db.rev++; db.data[args.p_key] = clone(args.p_data); return Promise.resolve({ data: { ok: true, rev: db.rev } }); }
      return Promise.resolve({ data: null });
    }
  };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const box = {
    console, JSON, Math, Number, String, Array, Object, Promise, Error, Date: FakeDate,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), key: () => null, length: 0 },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { care_schedule_v2: true, ws_weekly_master_v1: true, wsday: true, shift: false } }) }),
    setTimeout: (f, ms) => { timers.push({ f, ms, live: true }); return timers.length; },
    clearTimeout: id => { if (id && timers[id - 1]) timers[id - 1].live = false; },
    setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/care-tools/work-schedule.html' },
    addEventListener: (ev, f) => { (listeners['w:' + ev] = listeners['w:' + ev] || []).push(f); },
    document: {
      visibilityState: 'visible',
      body: { appendChild() {} }, head: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' }),
      addEventListener: (ev, f) => { (listeners['d:' + ev] = listeners['d:' + ev] || []).push(f); }
    }
  };
  box.window = box;
  box.SUAuth = { STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_VERIFY: 'mfa_verify', MFA_ENROLL: 'mfa_enroll' },
    check: () => Promise.resolve({ status: 'ok', role: 'office' }), client: () => sb };
  vm.createContext(box);
  vm.runInContext(SRC, box, { filename: 'su-kv.js' });
  const gasReply = { ok: o.gasOk !== false };
  const raw = p => { raws.push(clone(p)); return Promise.resolve(o.gasThrow ? Promise.reject(new Error('net')) : gasReply); };
  return {
    kv: box.SUKv, ls, timers, raws, rpcs, raw, db, gasReply,
    pending: () => JSON.parse(ls.get(LS_KEY) || '{}'),
    advance: ms => { now += ms; },
    fire: async ms => { for (const x of timers.slice()) if (x.live && x.ms === ms) { x.live = false; x.f(); } await settle(); },
    hide: async () => { box.document.visibilityState = 'hidden'; (listeners['d:visibilitychange'] || []).forEach(f => f()); await settle(); },
    pagehide: async () => { (listeners['w:pagehide'] || []).forEach(f => f()); await settle(); },
    liveTimers: ms => timers.filter(x => x.live && (ms == null || x.ms === ms)).length
  };
}
const put = (key, rev) => ({ action: 'put', key, rev: rev == null ? 5 : rev, data: { v: 'new-' + key } });

(async () => {
  console.log('— A・B 控えと完了 —');
  {
    const k = make();
    const r = await k.kv.call(put('ws_weekly_master_v1'), k.raw);
    t('保存できる（前提）', r && r.ok === true, r);
    t('★A 保存できたら控えを残す（キーと時刻だけ）', typeof k.pending()['ws_weekly_master_v1'] === 'number' && Object.keys(k.pending()).length === 1, k.pending());
    t('A 写し返しは20秒後に予約（すぐには送らない）', k.raws.length === 0 && k.liveTimers(20000) === 1);
    await k.fire(20000);
    t('A 20秒後に Supabase の最新を force・版0 で Google へ', k.raws.length === 1 && k.raws[0].action === 'put' && k.raws[0].force === true && k.raws[0].rev === 0 && k.raws[0].data.v === 'new-ws_weekly_master_v1', k.raws);
    t('★A Google が受け取ったら控えを消す', Object.keys(k.pending()).length === 0 && !k.ls.has(LS_KEY), k.pending());
  }
  {
    const k = make({ gasOk: false });
    await k.kv.call(put('wsday_2026-10-19'), k.raw); await k.fire(20000);
    t('★B Google が断ったら控えを残す', k.raws.length === 1 && 'wsday_2026-10-19' in k.pending());
    const k2 = make({ gasThrow: true });
    await k2.kv.call(put('wsday_2026-10-19'), k2.raw); await k2.fire(20000);
    t('★B 通信に失敗したら控えを残す', k2.raws.length === 1 && 'wsday_2026-10-19' in k2.pending());
  }
  console.log('\n— C 画面を隠した時 —');
  {
    const k = make();
    await k.kv.call(put('care_schedule_v2'), k.raw);
    await k.hide();
    t('★C 隠したら20秒を待たずに写し返す', k.raws.length === 1 && k.raws[0].key === 'care_schedule_v2' && k.raws[0].force === true, k.raws);
    t('C 写した後は20秒の予約が残らない（二重に送らない）', k.liveTimers(20000) === 0);
    t('C 受け取ったら控えを消す', !('care_schedule_v2' in k.pending()));
    const k2 = make();
    await k2.kv.call(put('care_schedule_v2'), k2.raw);
    await k2.pagehide();
    t('C 閉じる（pagehide）でもその場で写し返す', k2.raws.length === 1);
    const k3 = make();
    await k3.hide();
    t('C 予定が無ければ隠しても何も送らない', k3.raws.length === 0);
  }
  console.log('\n— D 次の保存で残りを写す —');
  {
    const old = Date.parse('2026-10-16T11:00:00Z');
    const k = make({ ls: [[LS_KEY, JSON.stringify({ 'wsday_2026-10-19': old, 'ws_weekly_master_v1': old - 8 * 864e5, staff: old, 'genogram_x': old })]] });
    await k.kv.call({ action: 'get', key: 'care_schedule_v2' }, k.raw);
    t('★F 読み込みだけでは残りを写さない（写し返しの予約が無い）', k.liveTimers(5000) + k.liveTimers(20000) === 0 && k.raws.length === 0, k.timers.map(x => x.ms));
    await k.kv.call(put('care_schedule_v2'), k.raw);
    t('★D 保存できた時、控えの残り（10/19）を5秒後に写す予約をする', k.liveTimers(5000) === 1 && k.liveTimers(20000) === 1, k.timers.filter(x => x.live).map(x => x.ms));
    t('★D 7日より古い控え・扱わないキー（勤務表・ほかのアプリ）は捨てる', JSON.stringify(Object.keys(k.pending()).sort()) === JSON.stringify(['care_schedule_v2', 'wsday_2026-10-19']), k.pending());
    await k.fire(5000);
    t('D 残りの10/19を Supabase の最新で Google へ写し、控えを消す', k.raws.length === 1 && k.raws[0].key === 'wsday_2026-10-19' && k.raws[0].data.v === 'd19' && !('wsday_2026-10-19' in k.pending()), k.raws);
    await k.kv.call(put('wsday_2026-10-19'), k.raw);
    t('D 残りを写すのは1つの画面で1回だけ', k.liveTimers(5000) === 0);
  }
  console.log('\n— E 写している間の保存 —');
  {
    const k = make();
    await k.kv.call(put('ws_weekly_master_v1'), k.raw);
    let release;
    const slow = p => { k.raws.push(clone(p)); return new Promise(r => { release = () => r({ ok: true }); }); };
    // 予約した写し返しを、遅い Google で走らせる
    k.timers.forEach(x => { x.live = false; });
    await k.kv.call(put('ws_weekly_master_v1', 6), slow);
    k.advance(1000);
    const x = k.timers.filter(y => y.live && y.ms === 20000).pop(); x.live = false; x.f(); await settle();
    k.advance(1000);
    await k.kv.call(put('ws_weekly_master_v1', 7), slow);   // 写している間に新しく保存
    release(); await settle();
    t('★E 写している間に新しく保存された控えは消さない', 'ws_weekly_master_v1' in k.pending(), k.pending());
    t('E 新しい保存の写し返しも予約されている', k.liveTimers(20000) === 1);
  }
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
