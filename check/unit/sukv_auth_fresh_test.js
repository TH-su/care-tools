/* 同期データの保存先の切り替え（su-kv.js）がログインの状態を毎回ログインの部品（su-auth.js）に聞く（2026-10-24 新設・差分審査の指摘 低1）。
   それまで su-kv.js は確かめた結果を自分でも5分持っていて、su-auth.js の同じタブの控え（5分・代表者の決定5）と重なり、
   役割が最大約10分古くなっていた（控えが切れる直前に su-kv.js が受け取ると、そこからさらに5分使い回す）。
   守りたいこと:
     A 同じアカウントで続けて読み書きしても、データベースへのログインの確かめ（my_account・本人の行）は増えない。
       増えるのは、1回ごとの端末の中のログインの読み取り（getSession）と控えの読み取り（sessionStorage）だけ
     B 役割の古さは最長5分（su-auth.js の控えの期限）。控えが切れた後の次の読み書きでデータベースに聞き直す
     C アカウントが替わったら、次の読み書きで替わる（su-kv.js の中で前の人を使い回さない）
     D 確かめに失敗した時は今までどおり「通信失敗」を返し、次の読み書きで確かめ直す。確かめる前の印だけの判定（marksOnlyFor）は null のまま
     E 未ログインは毎回データベースに聞かない（端末の中のログインだけで分かる）
     F 参考: 許可リスト外・2段階認証待ちは su-auth.js が控えないため、読み書きのたびにデータベースに聞く（前は su-kv.js が5分持っていた）
   ★本物の su-auth.js と su-kv.js を同じ砂場で動かす。偽物にするのは、supabase（ログイン・データベース）・時計・通信・端末の保存だけ。
   実行: node check/unit/sukv_auth_fresh_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'su-auth.js'), 'utf8');
const KV = fs.readFileSync(process.env.SUKV_JS || path.join(ROOT, 'su-kv.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const MIN = 60000;
const KEY = 'wsday_2026-10-24';

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function session(id, email) {
  return { user: { id, email }, access_token: b64url({ alg: 'none' }) + '.' + b64url({ sub: id, aal: 'aal1', amr: [{ method: 'oauth', timestamp: 1 }] }) + '.sig' };
}
const UA = '00000000-0000-4000-8000-0000000000a1', UB = '00000000-0000-4000-8000-0000000000b2';

function make(o) {
  o = o || {};
  let now = Date.parse('2026-10-24T09:00:00Z');
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const ss = new Map(), wl = {};
  const ls = new Map([['su_backend_flags', JSON.stringify({ supabase: { care_schedule_v2: true, wsday: true } })]]);
  const st = {
    session: o.session === undefined ? session(UA, 'office-a@example.jp') : o.session,
    account: o.account === undefined ? { role: 'office', mfa: false } : o.account,
    row: o.row === undefined ? { role: 'office', label: '事務所A' } : o.row,
    getSessionThrows: false,
    n: { getSession: 0, myAccount: 0, row: 0, factors: 0, kvGet: 0, memoRead: 0 }
  };
  const client = {
    auth: {
      getSession: () => { st.n.getSession++; if (st.getSessionThrows) return Promise.reject(new TypeError('Failed to fetch')); return Promise.resolve({ data: { session: st.session }, error: null }); },
      signOut: () => Promise.resolve({ error: null }),
      mfa: { listFactors: () => { st.n.factors++; return Promise.resolve({ data: { totp: [], all: [] } }); } }
    },
    rpc: (name) => {
      if (name === 'my_account') { st.n.myAccount++; return Promise.resolve({ data: st.account, error: null }); }
      if (name === 'kv_get') { st.n.kvGet++; return Promise.resolve({ data: { ok: true, rev: 3, data: { v: 1 }, updatedAt: '' }, error: null }); }
      return Promise.resolve({ data: null, error: null });
    },
    from: () => {
      st.n.row++;
      const api = { select() { return api; }, eq() { return api; }, maybeSingle: () => Promise.resolve({ data: st.row, error: null }) };
      return api;
    }
  };
  const box = {
    console, Promise, JSON, Object, String, Number, Array, Error, Math, Date: FakeDate, URLSearchParams, atob,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    location: { href: 'https://x/care-tools/work-schedule.html', search: '', hash: '', pathname: '/care-tools/work-schedule.html', origin: 'https://x' },
    history: { replaceState() {} },
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    sessionStorage: {
      getItem: k => { if (k === 'su_auth_ok_v1') st.n.memoRead++; return ss.has(k) ? ss.get(k) : null; },
      setItem: (k, v) => ss.set(k, String(v)), removeItem: k => ss.delete(k)
    },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { care_schedule_v2: true, wsday: true } }) }),
    addEventListener: (ev, f) => { (wl[ev] = wl[ev] || []).push(f); },
    document: {
      visibilityState: 'visible', addEventListener() {}, body: { appendChild() {} }, head: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' }),
      getElementsByTagName: () => []
    },
    supabase: { createClient: () => client }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(AUTH, box, { filename: 'su-auth.js' });
  vm.runInContext(KV, box, { filename: 'su-kv.js' });
  const db = () => st.n.myAccount + st.n.row + st.n.factors;
  return {
    box, st, db,
    read: () => box.SUKv.call({ action: 'get', key: KEY }, () => Promise.resolve({ ok: true, via: 'gas' })),
    marks: () => box.SUKv.marksOnlyFor(KEY),
    advance: ms => { now += ms; }
  };
}

(async () => {
  console.log('— A 続けて読み書きしてもデータベースへの確かめは増えない —');
  {
    const k = make();
    await settle();
    const r1 = await k.read();
    t('A（前提）1回目はデータベースに確かめる（my_account・本人の行の2往復）', r1 && r1.ok === true && k.db() === 2 && k.st.n.kvGet === 1, k.st.n);
    const before = Object.assign({}, k.st.n);
    for (let i = 0; i < 4; i++) { k.advance(MIN); await k.read(); }
    const add = { getSession: k.st.n.getSession - before.getSession, memoRead: k.st.n.memoRead - before.memoRead,
      myAccount: k.st.n.myAccount - before.myAccount, row: k.st.n.row - before.row, kvGet: k.st.n.kvGet - before.kvGet };
    console.log('    計測: 4分の間に続けて4回読んだ時の増え方 ' + JSON.stringify(add));
    t('★A その後4分の間に4回読んでも、データベースへの確かめは0往復（su-auth.js の控えを使う）', add.myAccount === 0 && add.row === 0, add);
    t('★A 増えるのは1回ごとの端末の中のログインの読み取り（getSession）と控えの読み取り（sessionStorage）だけ', add.getSession === 4 && add.memoRead === 4 && add.kvGet === 4, add);
  }

  console.log('\n— B 役割の古さは最長5分 —');
  {
    const k = make();
    await settle();
    await k.box.SUAuth.check();                // ほかの部品（不具合の報告・記録者名など）が先に確かめた（控えを書いた）
    k.advance(1 * MIN);
    k.st.account = { role: 'field', mfa: false };   // 管理者が役割を「現場」に変えた（データベース側）
    k.st.row = { role: 'field', label: '事務所A' };
    k.advance(3 * MIN + 58000);                // 控えが切れる直前（4分58秒）に初めて読む
    await k.read();
    t('B（前提）控えが切れる前は控えの役割（事務所）＝印だけではない', k.marks() === false, k.marks());
    k.advance(3000);                           // 5分1秒＝ su-auth.js の控えが切れた
    const n0 = k.db();
    await k.read();
    t('★B 控えが切れた後の次の読み書きでデータベースに聞き直し、新しい役割（現場）になる＝役割の古さは最長5分', k.marks() === true && k.db() > n0, { marks: k.marks(), db: k.db() - n0 });
  }

  console.log('\n— C アカウントが替わったら次の読み書きで替わる —');
  {
    const k = make();
    await settle();
    await k.read();
    t('C（前提）事務所のアカウントでは印だけではない', k.marks() === false);
    k.advance(MIN);
    k.st.session = session(UB, 'field-b@example.jp');   // 同じ端末で現場のアカウントに替わった
    k.st.account = { role: 'field', mfa: false };
    k.st.row = { role: 'field', label: '現場タブレット（架空）' };
    await k.read();
    t('★C 1分後の次の読み書きで、替わったアカウント（現場）を使う（前の人を使い回さない）', k.marks() === true, k.marks());
  }

  console.log('\n— D 失敗した時・確かめる前 —');
  {
    const k = make();
    await settle();
    t('D 確かめる前は印だけの判定は null（今までどおり）', k.marks() === null);
    k.st.getSessionThrows = true;
    const r = await k.read();
    t('D 確かめに失敗したら「通信失敗」を返す（今までどおり）', r && r.ok === false && r.error === '通信失敗', r);
    t('D 失敗した時は印だけの判定を作らない（null のまま）', k.marks() === null);
    k.st.getSessionThrows = false;
    const r2 = await k.read();
    t('D 次の読み書きで確かめ直す（失敗を持ち越さない）', r2 && r2.ok === true && k.marks() === false, r2);
  }

  console.log('\n— E 未ログイン —');
  {
    const k = make({ session: null });
    await settle();
    const r1 = await k.read(), r2 = await k.read();
    t('E 未ログインは「login」を返し、データベースには聞かない（端末の中のログインだけで分かる）', r1.error === 'login' && r2.error === 'login' && k.db() === 0 && k.st.n.getSession === 2, k.st.n);
  }

  console.log('\n— F 参考: 許可リスト外 —');
  {
    const k = make({ account: null, row: null });
    await settle();
    await k.read(); await k.read(); await k.read();
    console.log('    計測: 許可リスト外で3回読んだ時のデータベースへの確かめ ' + k.db() + '往復（su-auth.js は OK 以外を控えない）');
    t('F 許可リスト外は読み書きのたびにデータベースに確かめる（3回で6往復）・応答は今までどおり login', k.db() === 6, k.st.n);
  }
  t('部品は console.log を使わない', !/console\.log/.test(KV));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
