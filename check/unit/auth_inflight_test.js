/* ログインの確かめ（SUAuth.check）の「走っている確かめの使い回し」（2026-10-28 新設・本人指示）。
   週間計画・ワークスケジュールの起動の時に、同期の部品（su-kv.js）と画面が同時に check() を呼び、
   控えが書かれる前に全部がデータベースへ確かめに行っていた（my_account・allowed_accounts が2本ずつ）。
   守りたいこと:
     A 同時に2回呼ぶと、my_account と allowed_accounts は1本ずつで、2回とも同じ答え（別の入れ物）になる
     B 終わった後に呼ぶと、控えの規則どおり（使える＝控えを使う／確かめられなかった＝また確かめる）
     C 1本目が失敗（例外）した後の呼び出しは、新しく確かめる（失敗を貼り付けない）
     D 強制（fresh）の呼び出しは相乗りしない（強制どうしも毎回聞く＝ログイン画面の再試行を止まった通信につながせない）。強制でない呼び出しも強制に相乗りしない
     G 出てから8秒を過ぎた確かめには相乗りしない（止まった通信に後の呼び出しをつながない）
     E ログアウト・アカウントの切り替え・2段階認証の後・別のタブでログインの印が変わった後は、古い約束を使わず、古い答えを控えに書かない
   ★本物の su-auth.js を砂場で動かす。偽物にするのは、supabase（ログイン・データベース）・時計・sessionStorage だけ。
   ★データベースの応答は外から解いて返す（走っている間に2本目が来たことを本当に作る）。
   変異テスト: SU_AUTH_SRC=<別の su-auth.js> node check/unit/auth_inflight_test.js で直す前の版を読ませると落ちる。
   実行: node check/unit/auth_inflight_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.SU_AUTH_SRC || path.join(ROOT, 'su-auth.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const MEMO_KEY = 'su_auth_ok_v1';

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function session(id, email, aal) {
  return { user: { id, email }, access_token: b64url({ alg: 'none' }) + '.' + b64url({ sub: id, aal: aal || 'aal1', amr: [{ method: 'oauth', timestamp: 1 }].concat(aal === 'aal2' ? [{ method: 'totp', timestamp: 2 }] : []) }) + '.sig' };
}
const UA = '00000000-0000-4000-8000-0000000000a1', UB = '00000000-0000-4000-8000-0000000000b2';
const tick = async (n) => { for (let i = 0; i < (n || 20); i++) await new Promise(r => setImmediate(r)); };

function make(o) {
  o = o || {};
  let now = Date.parse('2026-10-28T09:00:00Z');
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const ss = new Map(), wl = {};
  const st = {
    session: o.session === undefined ? session(UA, 'office-a@example.jp') : o.session,
    account: o.account === undefined ? { email: 'office-a@example.jp', role: 'office', mfa: false } : o.account,
    row: o.row === undefined ? { role: 'office', label: '事務所A' } : o.row,
    accErr: false, rpcThrow: false, factors: o.factors || [],
    hold: true, waiting: [],
    n: { rpc: 0, from: 0, factors: 0, getSession: 0 }
  };
  /* 応答は「出した時」の中身で作り、release() まで返さない */
  function later(make, tag) {
    const v = make();
    if (!st.hold) return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    return new Promise((res, rej) => { const f = () => (v instanceof Error ? rej(v) : res(v)); f.tag = tag; st.waiting.push(f); });
  }
  const client = {
    auth: {
      getSession: () => { st.n.getSession++; return Promise.resolve({ data: { session: st.session }, error: null }); },
      signOut: () => { st.session = null; return Promise.resolve({ error: null }); },
      mfa: {
        listFactors: () => { st.n.factors++; return Promise.resolve({ data: { totp: st.factors, all: st.factors } }); },
        challengeAndVerify: () => Promise.resolve({ data: {}, error: null })
      }
    },
    rpc: () => { st.n.rpc++; const acc = st.account, err = st.accErr, thr = st.rpcThrow;
      return later(() => thr ? new TypeError('Failed to fetch') : (err ? { data: null, error: { message: 'Failed to fetch' } } : { data: acc, error: null }), acc && acc.email); },
    from: () => {
      st.n.from++;
      const row = st.row, tag = st.account && st.account.email;
      const api = { select() { return api; }, eq() { return api; }, maybeSingle: () => later(() => ({ data: row, error: null }), tag) };
      return api;
    }
  };
  const box = {
    console, Promise, JSON, Object, String, Error, TypeError, Math, Date: FakeDate, setTimeout, clearTimeout, URLSearchParams, atob,
    location: { href: 'https://x/care-tools/index.html', search: '', hash: '', pathname: '/care-tools/index.html', origin: 'https://x' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: k => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => { ss.set(k, String(v)); }, removeItem: k => { ss.delete(k); } },
    addEventListener: (ev, f) => { (wl[ev] = wl[ev] || []).push(f); },
    document: { addEventListener() {} },
    supabase: { createClient: () => client }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(SRC, box, { filename: 'su-auth.js' });
  /* 待たせている応答を全部返す（返した結果でまた出た分も返す） */
  /* only を渡した時は、その印（出した時のアカウントのメール）の応答だけを返す */
  async function release(only) {
    const pick = f => !only || f.tag === only;
    for (let i = 0; i < 50; i++) {
      await tick(5);
      if (!st.waiting.some(pick)) { await tick(5); if (!st.waiting.some(pick)) return; }
      const w = st.waiting.filter(pick); st.waiting = st.waiting.filter(f => !pick(f)); w.forEach(f => f());
    }
  }
  const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e && e.message || e) }));
  return {
    A: box.SUAuth, st, ss, release, settle, later: ms => { now += ms; },
    acc: () => st.n.rpc, rows: () => st.n.from,
    memo: () => { const v = ss.get(MEMO_KEY); return v == null ? null : JSON.parse(v); },
    storage: key => (wl.storage || []).forEach(f => f({ key }))
  };
}
const asB = k => {
  k.st.session = session(UB, 'office-b@example.jp');
  k.st.account = { email: 'office-b@example.jp', role: 'office', mfa: false };
  k.st.row = { role: 'office', label: '事務所B' };
};

(async () => {
  console.log('— A 同時に2回呼ぶと1本にまとまる —');
  {
    const k = make();
    const p1 = k.A.check(), p2 = k.A.check();
    await tick();
    t('★A 走っている間に2回目が来ても my_account は1本', k.acc() === 1, k.st.n);
    await k.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    t('★A allowed_accounts（本人の行）も1本', k.rows() === 1, k.st.n);
    t('★A 2回とも同じ答え（状態・役割・表示名・メール）', r1.status === 'ok' && r1.role === 'office' && r1.label === '事務所A' && JSON.stringify(r1) === JSON.stringify(r2), [r1, r2]);
    t('A 答えは呼び出しごとに別の入れ物（片方を書き換えても、もう片方は変わらない）', r1 !== r2 && (r1.role = 'x', r2.role === 'office'));
    t('A 端末の中のログイン（getSession）は呼び出しごとに読む（今までどおり）', k.st.n.getSession === 2, k.st.n);
    t('A 控えは1回だけ書かれ、使える（OK）の中身', !!k.memo() && k.memo().r === 'office', k.memo());
  }
  {
    const k = make();
    const ps = [k.A.check(), k.A.check(), k.A.check(), k.A.check(), k.A.check()];
    await k.release();
    const rs = await Promise.all(ps);
    t('A 5回同時でも my_account・allowed_accounts は1本ずつ', k.acc() === 1 && k.rows() === 1 && rs.every(r => r.status === 'ok'), k.st.n);
    t('A 相乗りした呼び出しどうしも別の入れ物', rs[1] !== rs[2] && rs[2] !== rs[3] && (rs[1].label = 'x', rs[2].label === '事務所A'));
  }

  console.log('\n— B 終わった後に呼ぶと、控えの規則どおり —');
  {
    const k = make();
    const p1 = k.A.check(), p2 = k.A.check();
    await k.release(); await Promise.all([p1, p2]);
    const r3 = await k.A.check();
    t('B 使える（OK）で終わった後は控えを使う（データベースに聞かない）', k.acc() === 1 && k.rows() === 1 && r3.status === 'ok', k.st.n);
  }
  {
    const k = make();
    k.st.accErr = true;
    const p1 = k.A.check(), p2 = k.A.check();
    await k.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    t('B 確かめられなかった（ERROR）答えも同時の2回で1本・同じ答え', k.acc() === 1 && r1.status === 'error' && r2.status === 'error', k.st.n);
    k.st.accErr = false;
    const p3 = k.A.check();
    await k.release();
    const r3 = await p3;
    t('★B ERROR で終わった後は、また確かめる（約束を外している）', k.acc() === 2 && r3.status === 'ok', k.st.n);
  }
  {
    const k = make({ account: null, row: null });
    const p1 = k.A.check(), p2 = k.A.check();
    await k.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const p3 = k.A.check(); await k.release(); const r3 = await p3;
    t('B 許可リスト外（DENIED）は同時の2回で1本・終わった後はまた確かめる（控えない）', r1.status === 'denied' && r2.status === 'denied' && r3.status === 'denied' && k.acc() === 2 && k.memo() === null, k.st.n);
  }

  console.log('\n— C 1本目が失敗した後は新しく確かめる —');
  {
    const k = make();
    k.st.rpcThrow = true;
    const p1 = k.settle(k.A.check()), p2 = k.settle(k.A.check());
    await k.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    t('C 失敗（例外）は相乗りした呼び出しにも同じく伝わる（1本だけ出す）', !r1.ok && !r2.ok && k.acc() === 1, [r1, r2, k.st.n]);
    t('C 失敗の時は控えを残さない', k.memo() === null);
    k.st.rpcThrow = false;
    const p3 = k.A.check();
    await k.release();
    const r3 = await p3;
    t('★C 失敗の後の呼び出しは新しく確かめて、使える答えを返す（失敗を貼り付けない）', k.acc() === 2 && r3.status === 'ok', [k.st.n, r3]);
  }

  console.log('\n— D 強制（fresh）の確かめは相乗りしない —');
  {
    const k = make();
    const pN = k.A.check();
    await tick();
    const pF = k.A.check({ fresh: true });
    await tick();
    t('★D 走っている強制でない確かめに、強制の呼び出しは相乗りしない（my_account が2本）', k.acc() === 2, k.st.n);
    await k.release();
    const [rN, rF] = await Promise.all([pN, pF]);
    t('D どちらも使える答え', rN.status === 'ok' && rF.status === 'ok');
  }
  {
    const k = make();
    const p1 = k.A.check({ fresh: true }), p2 = k.A.check({ fresh: true });
    await tick();
    t('★D 強制どうしも相乗りしない（再試行は毎回データベースに聞く）', k.acc() === 2, k.st.n);
    await k.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    t('D どちらも使える答え', r1.status === 'ok' && r2.status === 'ok');
  }
  console.log('\n— G 出てから8秒を過ぎた確かめには相乗りしない —');
  {
    const k = make();
    const p1 = k.A.check();
    await tick();
    k.later(9000);
    const p2 = k.A.check();
    await tick();
    t('★G 8秒を過ぎて止まったままの確かめにはつながず、新しく聞く（my_account が2本）', k.acc() === 2, k.st.n);
    await k.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    t('G どちらも使える答え', r1.status === 'ok' && r2.status === 'ok');
  }
  {
    const k = make();
    const p1 = k.A.check();
    await tick();
    k.later(7000);
    const p2 = k.A.check();
    await tick();
    t('G 8秒以内なら相乗りする（my_account が1本）', k.acc() === 1, k.st.n);
    await k.release();
    await Promise.all([p1, p2]);
  }
  {
    const k = make();
    const pF = k.A.check({ fresh: true });
    await tick();
    const pN = k.A.check();
    await tick();
    t('D 強制でない呼び出しも、走っている強制の確かめには相乗りしない（今までどおり別に確かめる）', k.acc() === 2, k.st.n);
    await k.release(); await Promise.all([pF, pN]);
  }
  {
    /* 2段階認証の前（aal1）に走り出した確かめ（管理者は6桁待ち）に、通した後の強制の確かめが古い答えをもらわない */
    const adminAcc = { email: 'admin-a@example.jp', role: 'office', mfa: false };
    const k = make({ session: session(UA, 'admin-a@example.jp', 'aal1'), account: adminAcc, row: { role: 'admin', label: '管理者A' }, factors: [{ id: 'f1', status: 'verified' }] });
    const pOld = k.A.check({ fresh: true });
    await tick();
    await k.A.verifyTotp('f1', '123456');
    k.st.session = session(UA, 'admin-a@example.jp', 'aal2');
    k.st.account = { email: 'admin-a@example.jp', role: 'admin', mfa: true };
    const pNew = k.A.check({ fresh: true });
    await tick();
    t('★D 2段階認証の後の強制の確かめは、前に走り出した強制の確かめに相乗りしない', k.acc() === 2, k.st.n);
    await k.release();
    const [rOld, rNew] = await Promise.all([pOld, pNew]);
    t('D 前の確かめは6桁待ち・後の確かめは管理者として使える', rOld.status === 'mfa_verify' && rNew.status === 'ok' && rNew.role === 'admin', [rOld.status, rNew.status, rNew.role]);
  }

  console.log('\n— E ログアウト・アカウントの切り替えの後は古い約束を使わない —');
  {
    const k = make();
    const pA = k.A.check();
    await tick();
    await k.A.signOut();
    asB(k);   // 同じ端末で別のアカウントでログインし直した
    const pB = k.A.check();
    await tick();
    t('★E ログアウトの後の呼び出しは、前の人の走っている確かめに相乗りしない', k.acc() === 2, k.st.n);
    await k.release();
    const [rA, rB] = await Promise.all([pA, pB]);
    t('★E 後の呼び出しの答えは新しいアカウントのもの', rB.email === 'office-b@example.jp' && rB.label === '事務所B', rB);
    t('E 前の人の答えは前の人のもの（入れ替わらない）', rA.email === 'office-a@example.jp', rA);
    t('E 控えは新しいアカウントのものだけ（前の人の答えを後から書き戻さない）', !!k.memo() && k.memo().l === '事務所B', k.memo());
  }
  {
    /* 新しいアカウントの確かめが先に終わり、前の人の確かめが後から終わった時 */
    const k = make();
    const pA = k.A.check();
    await tick();
    await k.A.signOut();
    asB(k);
    const pB = k.A.check();
    await tick();
    await k.release('office-b@example.jp');   // 新しいアカウントの確かめを先に終わらせる
    await pB;
    await k.release();                        // 前の人の確かめが後から終わる
    await pA;
    const n = k.acc();
    k.st.hold = false;
    const r = await k.A.check();
    t('★E 前の人の確かめが後から終わっても、その答えを控えに書き戻さない（新しいアカウントの控えが残り、次は聞かない）', k.acc() === n && r.status === 'ok' && r.email === 'office-b@example.jp', [k.st.n, n]);
  }
  {
    /* 同じアカウントでログアウト→ログインし直した時も、ログアウトの前の確かめには相乗りしない */
    const k = make();
    const p1 = k.A.check();
    await tick();
    await k.A.signOut();
    k.st.session = session(UA, 'office-a@example.jp');
    const p2 = k.A.check();
    await tick();
    t('★E 同じアカウントで入り直しても、ログアウトの前の確かめには相乗りしない', k.acc() === 2, k.st.n);
    await k.release(); await Promise.all([p1, p2]);
  }
  {
    const k = make();
    const pA = k.A.check();
    await tick();
    asB(k);   // 別のタブで別のアカウントに切り替わった（ログアウトを通らない）
    const pB = k.A.check();
    await tick();
    t('E 端末の中のログインが別の利用者に変われば、走っている確かめに相乗りしない', k.acc() === 2, k.st.n);
    await k.release();
    const [, rB] = await Promise.all([pA, pB]);
    t('E 答えは新しい利用者のもの', rB.label === '事務所B', rB);
  }
  {
    const k = make();
    const p1 = k.A.check();
    await tick();
    k.storage('sb-jhbernqawjrzqwrmqrih-auth-token');   // 別のタブでログインの印が変わった
    const p2 = k.A.check();
    await tick();
    t('E 別のタブでログインの印が変わった後は、走っている確かめに相乗りしない', k.acc() === 2, k.st.n);
    await k.release(); await Promise.all([p1, p2]);
  }
  {
    const k = make();
    const p1 = k.A.check();
    await tick();
    k.storage('some_other_key');   // ログインに関係のない書き込み
    const p2 = k.A.check();
    await tick();
    t('E ログインに関係のない書き込みでは、今までどおり相乗りする', k.acc() === 1, k.st.n);
    await k.release(); await Promise.all([p1, p2]);
  }

  t('部品は console.log を使わない', !/console\.log/.test(SRC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
