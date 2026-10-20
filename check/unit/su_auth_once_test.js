/* ログインの部品（su-auth.js）を二重に動かさない（2026-10-16 新設）。
   ワークスケジュールで su-kv.js と su-report.js が別々に supabase-js と su-auth.js を読み込み、
   ログインの窓口（GoTrueClient）が2つできていた（Console の「Multiple GoTrueClient instances」）。
   同じ保存場所の鍵の更新を2つが取り合うと、ログインが外れることがある。
   守りたいこと:
     A su-auth.js が2回読み込まれても、2回目は何もしない（窓口は1つ・SUAuth は最初のもの）
     B su-kv.js は、すでに札（<script src>）がある部品を入れ直さず、読み終わるのを待つ
     C su-report.js は、ライブラリを待っている間に su-auth.js の札が入っていたら、入れ直さずに待つ
   ★本物のファイルを砂場で動かす。
   実行: node check/unit/su_auth_once_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

console.log('— A su-auth.js の二度読み —');
{
  let made = 0;
  const box = { console, Promise, Date, JSON, Object, String, Error, setTimeout, clearTimeout, URLSearchParams, URL,
    location: { href: 'https://x/care-tools/work-schedule.html', search: '', hash: '', pathname: '/care-tools/work-schedule.html' },
    history: { replaceState() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {} } };
  box.window = box;
  box.supabase = { createClient: () => { made++; return { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange() {} } }; } };
  vm.createContext(box);
  vm.runInContext(read('su-auth.js'), box, { filename: 'su-auth.js#1' });
  const first = box.SUAuth;
  try { first.client(); } catch (e) { /* client が無い版でも数は数える */ }
  vm.runInContext(read('su-auth.js'), box, { filename: 'su-auth.js#2' });
  t('★A 2回目の読み込みは SUAuth を置き換えない', box.SUAuth === first);
  try { box.SUAuth.client(); } catch (e) { }
  t('★A ログインの窓口（createClient）は1つだけ', made === 1, made);
  t('A 二度目は先頭で戻る（印が su-auth.js の冒頭にある）', /'use strict';\n[^\n]*\n[^\n]*\n  if \(window\.SUAuth\) return;/.test(read('su-auth.js')));
}

function sandboxKv(tags) {
  const appended = [];
  const box = { console, JSON, Math, Date, Number, String, Array, Object, Promise, Error, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: k => (k === 'su_backend_flags' ? JSON.stringify({ supabase: { care_schedule_v2: true } }) : null), setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: { care_schedule_v2: true } }) }),
    location: { pathname: '/care-tools/work-schedule.html' },
    addEventListener() {},
    document: {
      addEventListener() {}, body: { appendChild() {} },
      head: { appendChild(s) { appended.push(s.src); tags.push(s.src); } },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      getElementsByTagName: () => tags.map(src => ({ getAttribute: () => src }))
    } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('su-kv.js'), box, { filename: 'su-kv.js' });
  return { box, appended };
}
(async () => {
  console.log('\n— B su-kv.js —');
  {
    const tags = ['supabase-js-2.112.4.js', 'su-auth.js?v=2026-10-20'];
    const k = sandboxKv(tags);
    const p = k.box.SUKv.call({ action: 'get', key: 'care_schedule_v2' }, () => Promise.resolve({ ok: true }));
    await settle();
    t('★B 札がすでにある時は、supabase-js も su-auth.js も入れ直さない', k.appended.length === 0, k.appended);
    k.box.SUAuth = { STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_VERIFY: 'mfa_verify', MFA_ENROLL: 'mfa_enroll' }, check: () => Promise.resolve({ status: 'signed_out' }), client: () => null };
    await new Promise(r => setTimeout(r, 250)); await settle();
    const r = await p;
    t('B 読み終わるのを待ってから進む（ログインの状態を聞く）', r && r.error === 'login', r);
  }
  {
    const k = sandboxKv(['supabase-js-2.112.4.js']);
    k.box.SUKv.call({ action: 'get', key: 'care_schedule_v2' }, () => Promise.resolve({ ok: true }));
    await settle();
    t('B ライブラリの札だけがある時は、それを入れ直さずに待つ', k.appended.length === 0, k.appended);
    k.box.supabase = { createClient() {} };
    await new Promise(r => setTimeout(r, 250)); await settle();
    t('B ライブラリが読み終わったら、su-auth.js を1本だけ入れる', JSON.stringify(k.appended) === '["su-auth.js?v=2026-10-20"]', k.appended);
  }
  {
    const k = sandboxKv([]);
    k.box.SUKv.call({ action: 'get', key: 'care_schedule_v2' }, () => Promise.resolve({ ok: true }));
    await settle();
    t('B（対照）札が無ければ supabase-js を入れる', JSON.stringify(k.appended) === '["supabase-js-2.112.4.js"]', k.appended);
  }
  console.log('\n— C su-report.js —');
  {
    const src = read('su-report.js');
    const i = src.indexOf('function loadAuth()'), seg = src.slice(i, i + 700);
    t('★C ライブラリを待った後、su-auth.js の札があれば入れ直さずに待つ', /lib\.then\(function \(\) \{\s*if \(window\.SUAuth\) return null;\s*if \(hasTag\('su-auth\.js'\)\) return waitFor/.test(seg), seg.slice(0, 300));
  }
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
