/* 切り替えスイッチ（su-backend.json）の1分ごとの読み直しを、裏のタブで休ませる（2026-10-24 新設・アプリ間連携の見直し 段1）。
   守りたいこと:
     A 起動時に1回読む。読む URL には ?t=（GitHub Pages の控えを挟まない印）を付け、cache: 'no-store' で読む
     B 1分ごとの読み直しは、画面が隠れている間は読まない。見えている間は今までどおり読む
     C 隠れていた画面が見えた時、前回から1分を過ぎていれば1回だけ読む（続けて見えても2回目は読まない）。1分以内なら読まない
     D 保存・読み込みの入口（ensureFlags）は、隠れていても「1分を過ぎていれば読み直す」のまま（写し返しが古いスイッチで動かない）
   ★本物の su-kv.js を砂場で動かす。偽物にするのは、時計・タイマー・画面の見え方・通信・ログインの状態だけ。
   実行: node check/unit/sukv_flags_hidden_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-kv.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

function make() {
  let now = Date.parse('2026-10-24T09:00:00Z');
  const fetches = [], intervals = [], listeners = {};
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const ls = new Map([['su_backend_flags', JSON.stringify({ supabase: { care_schedule_v2: true } })]]);
  const box = {
    console, JSON, Math, Number, String, Array, Object, Promise, Error, Date: FakeDate,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    fetch: (url, o) => { fetches.push({ url: String(url), o }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { care_schedule_v2: true } }) }); },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout,
    setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, clearInterval() {},
    location: { pathname: '/care-tools/care-schedule.html' },
    addEventListener() {},
    document: {
      visibilityState: 'visible',
      body: { appendChild() {} }, head: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' }),
      getElementsByTagName: () => [],
      addEventListener: (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); }
    }
  };
  box.window = box;
  box.SUAuth = { STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_VERIFY: 'mfa_verify', MFA_ENROLL: 'mfa_enroll' },
    check: () => Promise.resolve({ status: 'signed_out' }), client: () => null };
  vm.createContext(box);
  vm.runInContext(SRC, box, { filename: 'su-kv.js' });
  const flagFetches = () => fetches.filter(x => /su-backend\.json/.test(x.url)).length;
  const minute = intervals.filter(x => x.ms === 60000);
  return {
    box, fetches, flagFetches, minute,
    advance: ms => { now += ms; },
    tickMinute: async () => { minute.forEach(x => x.f()); await settle(); },
    show: async () => { box.document.visibilityState = 'visible'; (listeners.visibilitychange || []).forEach(f => f()); await settle(); },
    hide: async () => { box.document.visibilityState = 'hidden'; (listeners.visibilitychange || []).forEach(f => f()); await settle(); }
  };
}

(async () => {
  console.log('— A 起動時 —');
  {
    const k = make();
    await settle();
    t('A 起動時に1回読む', k.flagFetches() === 1, k.fetches);
    t('★A 読む URL の ?t= は外さない（GitHub Pages の控えを挟まない）・cache は no-store', /^su-backend\.json\?t=\d+$/.test(k.fetches[0].url) && k.fetches[0].o && k.fetches[0].o.cache === 'no-store', k.fetches[0]);
    t('A 1分ごとの読み直しのタイマーは1本', k.minute.length === 1);
  }

  console.log('\n— B 1分ごとの読み直し —');
  {
    const k = make();
    await settle();
    k.advance(61000);
    await k.tickMinute();
    t('B 見えている間は1分ごとに読む（今までどおり）', k.flagFetches() === 2);
    t('B 読み直しの URL にも ?t= を付ける', /^su-backend\.json\?t=\d+$/.test(k.fetches[1].url), k.fetches[1].url);
    await k.hide();
    t('B 隠した瞬間には読まない', k.flagFetches() === 2);
    for (let i = 0; i < 5; i++) { k.advance(60000); await k.tickMinute(); }
    t('★B 隠れている間は5分たっても読まない', k.flagFetches() === 2, k.flagFetches());
  }

  console.log('\n— C 見えた時 —');
  {
    const k = make();
    await settle();
    await k.hide();
    k.advance(3 * 60000);
    await k.tickMinute();
    t('C（前提）隠れている間は読まない', k.flagFetches() === 1);
    await k.show();
    t('★C 見えた時、前回から1分を過ぎていれば1回読む', k.flagFetches() === 2, k.flagFetches());
    t('C 見えた時の読み直しにも ?t= を付ける', /^su-backend\.json\?t=\d+$/.test(k.fetches[1].url), k.fetches[1].url);
    await k.show();
    t('C 続けて見えても2回目は読まない（1分以内）', k.flagFetches() === 2, k.flagFetches());
    await k.hide();
    k.advance(30000);
    await k.show();
    t('C 前回から1分以内に見えた時は読まない', k.flagFetches() === 2, k.flagFetches());
    k.advance(31000);
    await k.tickMinute();
    t('C 見えている間の1分ごとの読み直しは続く', k.flagFetches() === 3, k.flagFetches());
  }

  console.log('\n— D 保存・読み込みの入口 —');
  {
    const k = make();
    await settle();
    await k.hide();
    k.advance(2 * 60000);
    const r = await k.box.SUKv.call({ action: 'get', key: 'care_schedule_v2' }, () => Promise.resolve({ ok: true }));
    t('★D 隠れていても、保存・読み込みの入口は1分を過ぎていればスイッチを読み直す（今までどおり）', k.flagFetches() === 2, k.flagFetches());
    t('D 入口の応答は今までどおり（未ログインは login）', r && r.error === 'login', r);
    await k.box.SUKv.call({ action: 'get', key: 'care_schedule_v2' }, () => Promise.resolve({ ok: true }));
    t('D 1分以内の2回目は読み直さない（今までどおり）', k.flagFetches() === 2, k.flagFetches());
  }

  t('部品は console.log を使わない', !/console\.log/.test(SRC));
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
