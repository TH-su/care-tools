/* ログインの確かめ（SUAuth.check）の結果の控え（2026-10-24 新設・代表者の決定5・アプリ間連携の見直し 段2）。
   同じタブでメニューから画面を移るたびに、データベースへの確かめ（my_account と allowed_accounts の2往復）を繰り返さないための控え。
   守りたいこと:
     A 同じ利用者・5分以内なら、2回目はデータベースに聞かずに控えを使う。応答の形と中身（メール・役割・表示名・2段階認証の印など）は1回目と同じ
     B 利用者が変わったら（端末の中のログインの利用者 id が控えと違う）控えを使わない
     C 控えるのは「使える（OK）」の時だけ。未ログイン・許可リスト外・2段階認証待ち・登録待ち・通信の失敗・本人の行を読めなかった OK は控えず、前の控えも消す
     D ログアウト（アカウントの切り替えもここを通る）・2段階認証を通した後・別のタブでログインの印が変わった時に消える
     E 管理者の2段階認証は控えに頼らず毎回確かめる（今のログインが aal2 の時だけ控えを使う。aal1 に変わればデータベースに聞き直す）
     F 期限は5分。時計が戻った時も使わない。ログイン画面の確かめ直し（check({ fresh: true })）は控えを使わない
     G 控えの中身は 状態・役割・表示名・期限・利用者 id の指紋だけ（id そのもの・メール・トークンは置かない）。sessionStorage が使えなくても動く
   ★本物の su-auth.js を砂場で動かす。偽物にするのは、supabase（ログイン・データベース）・時計・sessionStorage だけ。
   ★最終的な権限はデータベース（RLS・許可リスト）が決める。この控えは画面の振り分けにだけ使われる。
   実行: node check/unit/su_auth_memo_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-auth.js'), 'utf8');
const LOGIN = fs.readFileSync(path.join(ROOT, 'login.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const MEMO_KEY = 'su_auth_ok_v1';

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/* 架空のログイン（利用者 id・メールは架空）。aal は2段階認証の印 */
function session(id, email, aal) {
  return { user: { id, email }, access_token: b64url({ alg: 'none' }) + '.' + b64url({ sub: id, aal: aal || 'aal1', amr: [{ method: 'oauth', timestamp: 1 }].concat(aal === 'aal2' ? [{ method: 'totp', timestamp: 2 }] : []) }) + '.sig' };
}
const UA = '00000000-0000-4000-8000-0000000000a1', UB = '00000000-0000-4000-8000-0000000000b2';

function make(o) {
  o = o || {};
  let now = Date.parse('2026-10-24T09:00:00Z');
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const ss = new Map(), wl = {};
  const st = {
    session: o.session === undefined ? session(UA, 'office-a@example.jp') : o.session,
    account: o.account === undefined ? { email: 'office-a@example.jp', role: 'office', mfa: false } : o.account,
    accErr: !!o.accErr, row: o.row === undefined ? { role: 'office', label: '事務所A' } : o.row, rowErr: !!o.rowErr,
    factors: o.factors || [], verifyErr: !!o.verifyErr,
    n: { rpc: 0, from: 0, factors: 0, signOut: 0, verify: 0, getSession: 0 }
  };
  const client = {
    auth: {
      getSession: () => { st.n.getSession++; return Promise.resolve({ data: { session: st.session }, error: null }); },
      signOut: () => { st.n.signOut++; st.session = null; return o.signOutThrows ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ error: null }); },
      mfa: {
        listFactors: () => { st.n.factors++; return Promise.resolve({ data: { totp: st.factors, all: st.factors } }); },
        challengeAndVerify: () => { st.n.verify++; return Promise.resolve(st.verifyErr ? { error: { message: 'Invalid TOTP code' } } : { data: {}, error: null }); }
      }
    },
    rpc: () => { st.n.rpc++; return Promise.resolve(st.accErr ? { data: null, error: { message: 'Failed to fetch' } } : { data: st.account, error: null }); },
    from: () => {
      st.n.from++;
      const api = { select() { return api; }, eq() { return api; },
        maybeSingle: () => Promise.resolve(st.rowErr ? { data: null, error: { message: 'x' } } : { data: st.row, error: null }) };
      return api;
    }
  };
  const box = {
    console, Promise, JSON, Object, String, Error, Math, Date: FakeDate, setTimeout, clearTimeout, URLSearchParams, atob,
    location: { href: 'https://x/care-tools/index.html', search: '', hash: '', pathname: '/care-tools/index.html', origin: 'https://x' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: o.noSession ? undefined : {
      getItem: k => { if (o.ssThrows) throw new Error('SecurityError'); return ss.has(k) ? ss.get(k) : null; },
      setItem: (k, v) => { if (o.ssThrows) throw new Error('QuotaExceededError'); ss.set(k, String(v)); },
      removeItem: k => { if (o.ssThrows) throw new Error('SecurityError'); ss.delete(k); }
    },
    addEventListener: (ev, f) => { (wl[ev] = wl[ev] || []).push(f); },
    document: { addEventListener() {} },
    supabase: { createClient: () => client }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(SRC, box, { filename: 'su-auth.js' });
  const remote = () => st.n.rpc + st.n.from;
  return {
    A: box.SUAuth, st, ss, remote,
    memo: () => { const v = ss.get(MEMO_KEY); return v == null ? null : JSON.parse(v); },
    advance: ms => { now += ms; },
    storage: key => (wl.storage || []).forEach(f => f({ key }))
  };
}

(async () => {
  console.log('— A 同じ利用者・5分以内は控えを使う —');
  {
    const k = make();
    const r1 = await k.A.check();
    t('A（前提）1回目はデータベースに2回聞く（my_account・本人の行）', r1.status === 'ok' && r1.role === 'office' && k.remote() === 2, k.st.n);
    const r2 = await k.A.check();
    t('★A 2回目はデータベースに聞かない', k.remote() === 2, k.st.n);
    t('★A 2回目の応答は1回目と同じ（キーの並び・メール・役割・表示名・2段階認証の印・ログインの方法）', JSON.stringify(r2) === JSON.stringify(r1), [r1, r2]);
    t('A 控えを使う時も端末の中のログイン（getSession）は毎回読む', k.st.n.getSession === 2);
    k.advance(4 * 60000);
    await k.A.check();
    t('A 4分後も控えを使う', k.remote() === 2);
  }
  {
    const k = make({ session: session(UA, 'field-a@example.jp'), account: { role: 'field', mfa: false }, row: { role: 'field', label: '現場タブレット（架空）' } });
    const r1 = await k.A.check(), r2 = await k.A.check();
    t('A 現場のアカウントも同じ（表示名も控えから同じ文字で返す）', k.remote() === 2 && JSON.stringify(r1) === JSON.stringify(r2) && r2.role === 'field' && r2.label === '現場タブレット（架空）', r2);
  }

  console.log('\n— B 利用者が変わったら使わない —');
  {
    const k = make();
    await k.A.check();
    k.st.session = session(UB, 'office-b@example.jp');
    k.st.account = { email: 'office-b@example.jp', role: 'office', mfa: false };
    k.st.row = { role: 'office', label: '事務所B' };
    const r = await k.A.check();
    t('★B 利用者 id が違えば控えを使わずデータベースに聞く', k.remote() === 4, k.st.n);
    t('B 応答は新しい利用者のもの（前の人の表示名を出さない）', r.email === 'office-b@example.jp' && r.label === '事務所B', r);
    await k.A.check();
    t('B 新しい利用者の控えに置き換わる（その次は聞かない）', k.remote() === 4);
    k.st.session = session(UA, 'office-a@example.jp');
    k.st.account = { email: 'office-a@example.jp', role: 'office', mfa: false };
    k.st.row = { role: 'office', label: '事務所A' };
    const r3 = await k.A.check();
    t('B 前の利用者に戻しても、置き換わった控えは使わない', k.remote() === 6 && r3.label === '事務所A');
  }

  console.log('\n— C OK 以外は控えない —');
  for (const [label, cfg, status] of [
    ['許可リスト外（DENIED）', { account: null, row: null }, 'denied'],
    ['管理者で6桁待ち（MFA_VERIFY）', { account: { role: 'office', mfa: false }, row: { role: 'admin', label: '管理者' }, factors: [{ id: 'f1', status: 'verified' }] }, 'mfa_verify'],
    ['管理者で登録待ち（MFA_ENROLL）', { account: { role: 'office', mfa: false }, row: { role: 'admin', label: '管理者' } }, 'mfa_enroll'],
    ['通信の失敗（ERROR）', { accErr: true }, 'error']
  ]) {
    const k = make(cfg);
    const r1 = await k.A.check(); const n1 = k.remote();
    await k.A.check();
    t('★C ' + label + ' は控えない（2回目もデータベースに聞く）', r1.status === status && k.remote() === 2 * n1 && k.memo() === null, { status: r1.status, n: k.st.n });
  }
  {
    const k = make({ rowErr: true });
    const r1 = await k.A.check();
    await k.A.check();
    t('C 本人の行（管理者かどうか）を読めなかった時の OK は控えない', r1.status === 'ok' && k.remote() === 4 && k.memo() === null, k.st.n);
  }
  {
    const k = make();
    await k.A.check();
    t('C（前提）OK を控えた', k.memo() !== null);
    k.st.account = null; k.st.row = null;
    const r = await k.A.check({ fresh: true });
    t('C 確かめ直して OK でなくなったら、前の控えも消す', r.status === 'denied' && k.memo() === null);
    await k.A.check();
    t('C 消えた後は控えを使わない（データベースに聞く）', k.remote() === 6, k.st.n);
  }
  {
    const k = make();
    await k.A.check();
    k.st.session = null;
    const r = await k.A.check();
    t('C ログインが無くなったら未ログインを返し、控えを消す', r.status === 'signed_out' && k.memo() === null);
  }

  console.log('\n— D 消える場面 —');
  {
    const k = make();
    await k.A.check();
    await k.A.signOut();
    t('★D ログアウト（アカウントの切り替えも同じ入口）で消える', k.memo() === null && k.st.n.signOut === 1);
    k.st.session = session(UA, 'office-a@example.jp');
    await k.A.check();
    t('D ログアウトの後は同じ利用者でもデータベースに聞き直す', k.remote() === 4, k.st.n);
  }
  {
    const k = make({ signOutThrows: true });
    await k.A.check();
    let threw = false;
    try { await k.A.signOut(); } catch (e) { threw = true; }
    t('D ログアウトの通信に失敗しても控えは消える（失敗はそのまま返す＝今までどおり）', threw && k.memo() === null);
  }
  {
    const k = make();
    await k.A.check();
    await k.A.verifyTotp('f1', '123456');
    t('★D 2段階認証を通した後に消える', k.memo() === null && k.st.n.verify === 1);
    const k2 = make({ verifyErr: true });
    await k2.A.check();
    let threw = false;
    try { await k2.A.verifyTotp('f1', '000000'); } catch (e) { threw = /6桁/.test(e.message); }
    t('D 6桁が違った時も控えは消え、失敗は今までどおりの言葉で返す', threw && k2.memo() === null);
  }
  {
    const k = make();
    await k.A.check();
    k.storage('su_device_role');
    t('D 別のタブでほかの値が変わっただけなら消さない', k.memo() !== null);
    k.storage('sb-abcdefghijklmnop-auth-token');
    t('★D 別のタブでログインの印（sb-…-auth-token）が変わったら消える', k.memo() === null);
    await k.A.check();
    k.storage(null);
    t('D 別のタブで端末の記録が全部消された時（key が null）も消える', k.memo() === null);
  }
  {
    t('★D ログイン画面の確かめ直し（refresh）は控えを使わない（fresh）', /async function refresh\(\) \{[\s\S]{0,400}?SUAuth\.check\(\{ fresh: true \}\)/.test(LOGIN));
    t('D ログイン画面にほかの check の呼び出しは無い（全部 fresh）', (LOGIN.match(/SUAuth\.check\(/g) || []).length === 1);
    t('D ログイン画面のログアウト・アカウントの切り替えは SUAuth.signOut を通る（ここで控えが消える）',
      /if \(act === 'signout' \|\| act === 'switch'\) \{[\s\S]{0,200}?await SUAuth\.signOut\(\)/.test(LOGIN));
    t('D ログイン画面の2段階認証は SUAuth.verifyTotp を通り、その後の確かめ直しも fresh', /await SUAuth\.verifyTotp\(factorId, code\);[\s\S]{0,200}?await refresh\(\);/.test(LOGIN));
  }

  console.log('\n— E 管理者の2段階認証は毎回 —');
  {
    const k = make({ session: session(UA, 'admin-a@example.jp', 'aal2'), account: { role: 'admin', mfa: true }, row: { role: 'admin', label: '管理者' } });
    const r1 = await k.A.check(), r2 = await k.A.check();
    t('E 2段階認証を通した管理者は控えを使う（mfa の印も同じ）', r1.status === 'ok' && r1.role === 'admin' && k.remote() === 2 && JSON.stringify(r1) === JSON.stringify(r2) && r2.mfa === true, r2);
    k.st.session = session(UA, 'admin-a@example.jp', 'aal1');   // 同じ人がログインし直した（まだ6桁を入れていない）
    k.st.account = { role: 'office', mfa: false };
    k.st.factors = [{ id: 'f1', status: 'verified' }];
    const r3 = await k.A.check();
    t('★E 同じ管理者でも今のログインが aal2 でなければ控えを使わず、データベースの判定（6桁待ち）を返す', r3.status === 'mfa_verify' && k.remote() === 4, { status: r3.status, n: k.st.n });
    t('E 6桁待ちになったら控えは消える', k.memo() === null);
  }
  {
    const k = make({ session: session(UA, 'office-a@example.jp', 'aal2'), account: { role: 'office', mfa: true } });
    const r1 = await k.A.check(), r2 = await k.A.check();
    t('E 事務所の2段階認証の印（mfa）は、今のログインの aal から作る（データベースの my_account と同じ見方）', k.remote() === 2 && r1.mfa === true && r2.mfa === true);
    k.st.session = session(UA, 'office-a@example.jp', 'aal1');
    const r3 = await k.A.check();
    t('E 事務所は aal1 に変わっても控えを使い、mfa の印は今のログインに合わせて偽になる', k.remote() === 2 && r3.mfa === false && r3.aal === 'aal1');
  }

  console.log('\n— F 期限と確かめ直し —');
  {
    const k = make();
    await k.A.check();
    k.advance(5 * 60000 + 1);
    await k.A.check();
    t('★F 5分を過ぎたらデータベースに聞き直す', k.remote() === 4, k.st.n);
    k.advance(-10 * 60000);
    await k.A.check();
    t('F 時計が戻った時（期限が5分より先）も控えを使わない', k.remote() === 6, k.st.n);
  }
  {
    const k = make();
    await k.A.check();
    const u1 = k.memo().u;
    k.advance(1000);
    const r = await k.A.check({ fresh: true });
    t('★F check({ fresh: true }) は控えがあってもデータベースに聞く', r.status === 'ok' && k.remote() === 4, k.st.n);
    t('F 確かめ直して OK なら控えの期限を延ばす', k.memo().u === u1 + 1000);
  }

  console.log('\n— G 控えの中身 —');
  {
    const k = make();
    await k.A.check();
    const raw = k.ss.get(MEMO_KEY), m = k.memo();
    t('★G 控えの中身は 状態・役割・表示名・期限・利用者 id の指紋（と形の版）だけ', JSON.stringify(Object.keys(m)) === '["v","s","r","l","u","f"]' && m.s === 'ok' && m.r === 'office' && m.l === '事務所A' && m.u === Date.parse('2026-10-24T09:05:00Z'), m);
    t('★G 利用者 id・メール・トークンは置かない', raw.indexOf(UA) < 0 && raw.indexOf(UA.replace(/-/g, '')) < 0 && raw.indexOf('example.jp') < 0 && raw.indexOf('office-a') < 0 && raw.indexOf('.sig') < 0 && raw.indexOf(k.st.session.access_token.split('.')[1]) < 0, raw);
    const k2 = make({ session: session(UB, 'office-b@example.jp') });
    await k2.A.check();
    const k3 = make();
    await k3.A.check();
    t('G 指紋は利用者ごとに違い、同じ利用者なら同じ', typeof m.f === 'string' && m.f.length >= 8 && k2.memo().f !== m.f && k3.memo().f === m.f, [m.f, k2.memo().f, k3.memo().f]);
  }
  {
    const k = make();
    await k.A.check();
    k.ss.set(MEMO_KEY, JSON.stringify(Object.assign(k.memo(), { r: 'superuser' })));
    await k.A.check();
    t('G 知らない役割の控えは使わない（データベースに聞く）', k.remote() === 4);
    k.ss.set(MEMO_KEY, '{壊れた');
    const r = await k.A.check();
    t('G 壊れた控えは使わず、確かめ直して書き直す', k.remote() === 6 && r.status === 'ok' && k.memo().r === 'office');
  }
  for (const [label, cfg] of [['sessionStorage が例外を出す端末', { ssThrows: true }], ['sessionStorage が無い端末', { noSession: true }]]) {
    const k = make(cfg);
    const r1 = await k.A.check(), r2 = await k.A.check();
    t('G ' + label + 'でも動く（毎回データベースに聞く＝今までどおり）', r1.status === 'ok' && r2.status === 'ok' && k.remote() === 4, k.st.n);
  }
  t('部品は console.log を使わない', !/console\.log/.test(SRC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
