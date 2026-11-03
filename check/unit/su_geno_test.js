/* 家族構成図のクラウド同期の保存先の切り替えの入口（su-geno.js・統合 0053・0054・2026-11-03）の試験。架空データのみ。
   守ること:
     A スイッチ genogram が切・無い時は、Google へ送る関数をそのまま呼ぶ（データベースを呼ばない）
     B スイッチが入でも、印が写しの期間・0054 の前（関数が無い）は Google
     C 印が「切り替えた後」ならデータベースの関数（geno_ping・geno_list・geno_get・geno_save・geno_delete）を呼び、Google を呼ばない。
       合言葉は送らない。利用者No（p_resident_id）は画面が渡した時だけ添え、base は付けた時だけ添える。答えは GAS と同じ形のまま返す
     D 現場の端末（su_device_role field）・現場のアカウントは見るだけ: 保存・削除は送らずに「見るだけ」の断り。読み取りはデータベースから
     E データベースに届かない・時間切れは例外（職員向けの文）。Google へ流さない。番号つきの断りは「受け付けませんでした」（code 付き＝書いていない）
     F データベースが「写しの期間」（geno_not_live）と答えたら、印を捨てて Google へ送る
     G ログインしていない端末は印だけの口（geno_mode_public）を読み、切り替えた後なら Google へ送らずに断る。分からない時は保存・削除を送らない。
       Google の geno_switched（読み取りも）は中身を渡さずに同じ断りへ
     K 断りの形: code が文字・確かめられない断り（mode）だけ keep（画面は保留に残す）
     H 読み取りの前は印を読み直す・保存は1分覚える／端末に書くのはスイッチの控えだけ
     S 画面（genogram.html）: gasCall を SUGeno に通し、Google へ送る関数は今までの fetch のまま／利用者No は ?resident= の方の図だけ／
       code 付きの断りは保留から外す／GAS の写しは正本（care-backend gas/bound/genogram-sync/genogram-sync.gs）と一字一句同じ（指紋で照合）
   実行: node check/unit/su_geno_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-geno.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'genogram.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }

function box(o) {
  o = o || {};
  const store = { su_backend_flags: JSON.stringify({ supabase: o.flags || {} }) };
  if (o.field) store.su_device_role = 'field';
  const writes = [], rpcs = [];
  const A = {
    STATUS: { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' },
    check: () => Promise.resolve({ status: o.status || 'ok', role: o.role || 'office' }),
    client: () => ({
      rpc: (n, a) => {
        rpcs.push({ n, a: JSON.parse(JSON.stringify(a || {})) });
        if (n === 'geno_mode_public') {
          if (o.pubErr) return Promise.resolve({ error: o.pubErr });
          return Promise.resolve({ data: { ok: true, mode: o.pub || 'shadow' } });
        }
        if (n === 'geno_mode_get') {
          if (o.modeErr) return Promise.resolve({ error: o.modeErr });
          return Promise.resolve({ data: { ok: true, mode: o.mode || 'shadow', version: 3 } });
        }
        if (o.rpcHang) return new Promise(() => {});
        if (o.rpcReject) return Promise.reject(new Error('Failed to fetch'));
        if (o.rpcErr) return Promise.resolve({ error: o.rpcErr });
        if ('reply' in o) return Promise.resolve({ data: o.reply });
        if (n === 'geno_save') return Promise.resolve({ data: { ok: true, saved: { name: '架空 一郎', updatedAt: '2026-11-03T01:02:03.000Z' } } });
        if (n === 'geno_get') return Promise.resolve({ data: { ok: true, doc: { clientName: '架空 一郎' }, residentId: 'R1', otherResident: false, ambiguous: false } });
        if (n === 'geno_list') return Promise.resolve({ data: { ok: true, items: [{ name: '架空 一郎', updatedAt: 'x', updatedBy: '', residentId: 'R1' }] } });
        return Promise.resolve({ data: { ok: true, auth: 'ok', role: 'full', server: 'genogram-supabase' } });
      }
    })
  };
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) },
    fetch: (url) => /su-backend\.json/.test(url) ? Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) }) : Promise.reject(new Error('fetch ' + url)),
    setTimeout, clearTimeout, Promise, JSON, Object, Error, String, Number, Date, Math, Array, isFinite
  };
  w.SUAuth = A;
  w.window = w;
  vm.createContext(w);
  vm.runInContext(SRC, w);
  let gasCalls = 0;
  const gasCall = () => { gasCalls++; return Promise.resolve(o.gasReply || { ok: true, via: 'gas' }); };
  const call = async (action, params, ctx) => { try { return { d: await w.SUGeno.call(action, params || {}, gasCall, ctx) }; } catch (e) { return { e }; } };
  return { w, call, writes, rpcs, gas: () => gasCalls, names: () => rpcs.map(r => r.n) };
}
const ON = { genogram: true };
const DOC = { clientName: '架空 一郎', nodes: [], lines: [], updatedAt: '2026-11-03T00:00:00.000Z' };

(async () => {
  console.log('A Google のまま');
  for (const [label, o] of [['スイッチが無い', {}], ['スイッチが切', { flags: { genogram: false } }], ['ほかのスイッチだけ入', { flags: { analyzer: true }, mode: 'live' }]]) {
    const b = box(o);
    const r = await b.call('save', { doc: DOC });
    t('A ' + label + ' → Google へ（データベースを呼ばない）', b.gas() === 1 && r.d && r.d.via === 'gas' && b.rpcs.length === 0, b.names());
  }

  console.log('B 写しの期間・関数が無い');
  {
    const b = box({ flags: ON, mode: 'shadow' });
    const r = await b.call('get', { name: '架空 一郎' });
    t('B 印が写しの期間 → Google', b.gas() === 1 && r.d.via === 'gas' && b.names().join() === 'geno_mode_get', b.names());
    const c = box({ flags: ON, modeErr: { code: 'PGRST202' } });
    const r2 = await c.call('list', {});
    t('B 0054 の前（関数が無い）→ Google', c.gas() === 1 && r2.d.via === 'gas');
  }

  console.log('C 切り替えた後');
  {
    const b = box({ flags: ON, mode: 'live' });
    const r = await b.call('save', { doc: DOC, base: '2026-11-02T00:00:00.000Z' }, { residentId: 'R1' });
    const q = b.rpcs.find(x => x.n === 'geno_save');
    t('C 保存はデータベース（Google を呼ばない）', b.gas() === 0 && q && r.d.ok === true && r.d.saved.name === '架空 一郎', b.names());
    t('C 合言葉・証明は送らない／利用者No と base を添える', q && !('token' in q.a) && !('p_token' in q.a) && q.a.p_resident_id === 'R1' && q.a.p_base === '2026-11-02T00:00:00.000Z' && q.a.p_doc.clientName === '架空 一郎', q && q.a);
    const c = box({ flags: ON, mode: 'live' });
    await c.call('save', { doc: DOC });
    const q2 = c.rpcs.find(x => x.n === 'geno_save');
    t('C base を付けない保存は p_base を添えない（GAS と同じ無条件）・利用者No が無ければ null', q2 && !('p_base' in q2.a) && q2.a.p_resident_id === null, q2 && q2.a);
    const d = box({ flags: ON, mode: 'live' });
    const g = await d.call('get', { name: '架空 一郎' }, { residentId: ' R1 ' });
    const q3 = d.rpcs.find(x => x.n === 'geno_get');
    t('C 読込は geno_get（利用者No の前後の空白を除く）・答えの形をそのまま返す', q3 && q3.a.p_name === '架空 一郎' && q3.a.p_resident_id === 'R1' && g.d.doc.clientName === '架空 一郎' && g.d.residentId === 'R1');
    const e = box({ flags: ON, mode: 'live' });
    await e.call('delete', { name: '架空 一郎', base: '' }, { residentId: 'R1' });
    const q4 = e.rpcs.find(x => x.n === 'geno_delete');
    t('C 削除は geno_delete（base が空でも添える＝行が無い版）', q4 && q4.a.p_base === '' && q4.a.p_resident_id === 'R1' && q4.a.p_name === '架空 一郎', q4 && q4.a);
    const f = box({ flags: ON, mode: 'live' });
    const l = await f.call('list', {});
    t('C 一覧・ping もデータベース', l.d.items.length === 1 && f.names().includes('geno_list') && f.gas() === 0);
    const u = box({ flags: ON, mode: 'live' });
    const r5 = await u.call('rename', {});
    t('C 知らない操作は unknown action（データベースもGoogleも呼ばない）', r5.d.ok === false && /unknown action/.test(r5.d.error) && u.gas() === 0);
    const k = box({ flags: ON, mode: 'live', reply: { ok: false, error: 'この名前の図は、入居者マスタの別の方に結び付いています', code: 'geno_other_resident' } });
    const r6 = await k.call('save', { doc: DOC }, { residentId: 'R2' });
    t('C データベースの取り違えの守りの断りは、文と code をそのまま返す', r6.d.ok === false && r6.d.code === 'geno_other_resident' && /別の方/.test(r6.d.error));
  }

  console.log('D 現場は見るだけ');
  {
    const b = box({ flags: ON, mode: 'live', field: true });
    const r = await b.call('save', { doc: DOC });
    t('D 現場の端末の保存 → 送らずに「見るだけ」（Google にも送らない）', r.d.ok === false && r.d.code === 'su_view' && /見ることだけ/.test(r.d.error) && b.gas() === 0 && b.rpcs.length === 0, r.d);
    const r2 = await b.call('get', { name: '架空 一郎' });
    t('D 現場の端末の読込 → データベースから', r2.d.doc && b.names().includes('geno_get') && b.gas() === 0);
    const c = box({ flags: ON, mode: 'live', role: 'field' });
    const r3 = await c.call('delete', { name: '架空 一郎' });
    t('D 現場のアカウントの削除 → 送らずに「見るだけ」', r3.d.code === 'su_view' && !c.names().includes('geno_delete'));
    const r4 = await c.call('list', {});
    t('D 現場のアカウントの一覧 → データベースから', r4.d.items && c.names().includes('geno_list'));
    const d = box({ flags: ON, mode: 'live', rpcErr: { code: '42501' } });
    const r5 = await d.call('save', { doc: DOC });
    t('D データベースが権限で断った保存 → 「見るだけ」', r5.d.code === 'su_view');
    const e = box({ flags: ON, mode: 'live', status: 'mfa_verify', rpcErr: { code: '42501' } });
    const r6 = await e.call('save', { doc: DOC });
    t('D 2段階認証がまだ → 「2段階認証を済ませて」', r6.d.code === 'su_mfa' && /2段階認証/.test(r6.d.error));
  }

  console.log('E 届かない・時間切れ・番号つきの断り');
  {
    const b = box({ flags: ON, mode: 'live', rpcReject: true });
    const r = await b.call('save', { doc: DOC });
    t('E 届かない → 例外（職員向け）・Google へ流さない', r.e && /届きませんでした/.test(r.e.message) && b.gas() === 0);
    const c = box({ flags: ON, mode: 'live', rpcErr: { code: 'P0001' } });
    const r2 = await c.call('save', { doc: DOC });
    t('E 番号つきの断り → 「受け付けませんでした」（code 付き＝書いていない）', r2.d.code === 'su_db' && r2.d.keep === false && /受け付けませんでした/.test(r2.d.error) && c.gas() === 0);
    const d = box({ flags: ON, mode: 'live', rpcErr: { message: 'x' } });
    const r3 = await d.call('save', { doc: DOC });
    t('E 番号の無い失敗 → 通信の失敗（例外）', r3.e && /届きませんでした/.test(r3.e.message));
    const e = box({ flags: ON, mode: 'live', reply: null });
    const r4 = await e.call('get', { name: 'a' });
    t('E 空の応答 → 断り（中身を作らない）', r4.d.code === 'su_empty' && r4.d.ok === false);
  }

  console.log('F 写しの期間へ戻った');
  {
    const b = box({ flags: ON, mode: 'live', reply: { ok: false, error: 'geno_not_live' } });
    const r = await b.call('save', { doc: DOC });
    t('F geno_not_live → Google へ送る（データベースは書いていない）', b.gas() === 1 && r.d.via === 'gas');
  }

  console.log('G ログインしていない端末');
  {
    const b = box({ flags: ON, status: 'signed_out', pub: 'live' });
    const r = await b.call('get', { name: '架空 一郎' });
    t('G 切り替えた後 → 読込も Google へ送らずに「ログインしてください」', r.d.code === 'su_login' && /ログインしていません/.test(r.d.error) && b.gas() === 0 && b.names().join() === 'geno_mode_public', b.names());
    const c = box({ flags: ON, status: 'signed_out', pub: 'shadow' });
    const r2 = await c.call('save', { doc: DOC });
    t('G 写しの期間 → 今までどおり Google', c.gas() === 1 && r2.d.via === 'gas');
    const d = box({ flags: ON, status: 'signed_out', pubErr: { code: 'XX' } });
    const r3 = await d.call('save', { doc: DOC });
    t('G 印が分からない → 保存は送らない（確かめられない＝keep）', r3.d.code === 'su_mode' && r3.d.keep === true && d.gas() === 0);
    const r4 = await d.call('list', {});
    t('G 印が分からない → 読み取りは Google が決める', d.gas() === 1 && r4.d.via === 'gas');
    const e = box({ flags: ON, status: 'signed_out', pubErr: { code: 'XX' }, gasReply: { ok: false, error: '切り替え済み', code: 'geno_switched' } });
    const r5 = await e.call('get', { name: '架空 一郎' });
    t('G Google の geno_switched → 中身を渡さずログインの断りへ', r5.d.code === 'su_login' && !('doc' in r5.d));
    const f = box({ flags: ON, status: 'denied', pub: 'live' });
    const r6 = await f.call('list', {});
    t('G 使える人に無いアカウント → 「このアカウントでは使えません」', r6.d.code === 'su_role' && f.gas() === 0);
  }

  console.log('H 印の覚え方・端末に書くもの');
  {
    const b = box({ flags: ON, mode: 'live' });
    await b.call('save', { doc: DOC });
    await b.call('save', { doc: DOC });
    t('H 保存は印を1分覚える（2回目は印を読まない）', b.names().filter(n => n === 'geno_mode_get').length === 1, b.names());
    await b.call('get', { name: 'a' });
    t('H 読み取りの前は印を読み直す', b.names().filter(n => n === 'geno_mode_get').length === 2);
    t('H 端末に書くのはスイッチの控えだけ', b.writes.every(k => k === 'su_backend_flags'), b.writes);
    t('H liveHint・isLive は切り替えた後だけ真', b.w.SUGeno.liveHint() === true && b.w.SUGeno.isLive() === true && box({ flags: ON }).w.SUGeno.liveHint() === false);
  }

  console.log('S 画面');
  {
    t('S su-geno.js を読み込む', /<script src="su-geno\.js\?v=2026-11-03"><\/script>/.test(PAGE));
    t('S gasCall は SUGeno に通し、Google へ送る関数（gasCallGoogle）は今までの fetchWithRetry のまま', /window\.SUGeno\.call\(action, params \|\| \{\}, \(\) => gasCallGoogle\(action, params, opts\), \{ residentId: ridFor\(action, params\) \}\)/.test(PAGE)
      && /async function gasCallGoogle\(action, params, opts\) \{[\s\S]*?headers: \{ 'Content-Type': 'text\/plain;charset=utf-8' \}, redirect: 'follow' \};[\s\S]*?return await fetchWithRetry\(url, init, undefined, async \(res\) => \{\s*if \(!res\.ok\) throw new Error\('GAS HTTP ' \+ res\.status\);\s*return await res\.json\(\);/.test(PAGE));
    t('S 利用者No は ?resident= の方の図（suGenoMasterIdFor）と保留に積んだ時の値だけ', /function ridFor\(action, params\) \{[\s\S]*?flushRid && flushRid\.name === name[\s\S]*?suGenoMasterIdFor\(name, mid, window\._suMasterName\) \? String\(mid\) : null;/.test(PAGE)
      && /out\.rid = ridFor\(/.test(PAGE));
    t('S code 付きの断り（geno_・su_）は err.refused（keep は保留に残す）', /\/\^\(geno_\|su_\)\/\.test\(json\.code\)[\s\S]{0,200}err\.refused = !json\.keep;/.test(PAGE));
    t('S 保留の再送で断られた項目は外す・直接の保存は積まない・削除は端末の図を残す', /if \(e && e\.refused\) \{[\s\S]{0,300}done\.push\(\{ item, landed: null \}\)/.test(PAGE)
      && /\} else if \(err && err\.refused\) \{[\s\S]{0,600}クラウドへは保存されていません/.test(PAGE) && /if \(err && err\.refused\) \{[\s\S]{0,300}削除できませんでした（端末の図も残しています）/.test(PAGE));
    t('S この方に結び付いた図は、氏名が URL と違っても masterId のキーを書く', /var bd = window\._suGenoBound;\s*if \(bd && bd\.id === mid && bd\.name === String\(docName == null \? '' : docName\)\) return mid;/.test(PAGE));
    t('S 切り替えた後は受け口のコードをコピーしない', /if \(window\.SUGeno && window\.SUGeno\.isLive\(\)\) \{[\s\S]{0,200}この画面からはコピーしません/.test(PAGE));
    const m = PAGE.match(/const GAS_SCRIPT_CODE = (`[\s\S]*?\n`);/);
    const v = m ? vm.runInNewContext(m[1]) : '';
    const h = crypto.createHash('sha256').update(v).digest('hex');
    // 正本 care-backend gas/bound/genogram-sync/genogram-sync.gs（ba4321a・GENO_CODE_VERSION 2026-11-03.1）の指紋。正本を直したら写しと指紋を一緒に直す
    t('S GAS の写しは正本と一字一句同じ（指紋）', h === '0f95a555a09c4d10eda28a090b9281db4fc2f410d1fd0e357a18648d86c4369c' && /GENO_CODE_VERSION = '2026-11-03\.1'/.test(v), h);
    const be = path.join(ROOT, '..', 'care-backend', 'gas', 'bound', 'genogram-sync', 'genogram-sync.gs');
    if (fs.existsSync(be)) t('S （正本が隣にある時だけ）正本と同じ', fs.readFileSync(be, 'utf8') === v);
  }

  console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
  process.exit(fail ? 1 : 0);
})();
