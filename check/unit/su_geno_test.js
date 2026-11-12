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
     L 接続先・合言葉の無い端末がログインだけで使えるか（liveReady・2026-11-08 代表者「端末ごとの設定を極限までなくす」）:
       スイッチが入・現場の端末でない・ログインを確かめられた（2段階認証がまだも含む・役割は送る時の決まりと同じ）・印が切り替えた後、の時だけ真。
       それ以外・分からない・時間切れ（8秒）は偽。時間切れの後に印が届いても使えるにしない。端末に書くのはスイッチの控えだけ・Google へ送らない・
       例外を出さない／画面: 起動の時に1回だけ確かめ、使える時だけ接続設定の帯を止めて同期の札をそろえ一覧を読み直す・設定の判定・初回の案内
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
  const writes = [], rpcs = [], fetches = [];
  const A = {
    STATUS: { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' },
    check: () => {
      if (o.checkThrow) throw new Error('check');
      if (o.checkReject) return Promise.reject(new Error('check'));
      if (o.checkLate) return new Promise((ok) => setTimeout(() => ok({ status: o.status || 'ok', role: o.role || 'office' }), o.checkLate));
      return Promise.resolve({ status: o.status || 'ok', role: o.role || 'office' });
    },
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
    localStorage: o.lsThrow
      ? { getItem: () => { throw new Error('ls'); }, setItem: () => { throw new Error('ls'); }, removeItem: () => { throw new Error('ls'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) },
    fetch: (url) => { fetches.push(String(url)); if (o.noFlags) return Promise.reject(new Error('fetch ' + url)); return /su-backend\.json/.test(url) ? Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) }) : Promise.reject(new Error('fetch ' + url)); },
    // 時間切れの試験だけ、8秒の打ち切りを 20ms に縮める（ほかの待ちはそのまま）
    setTimeout: o.fast ? (f, ms) => setTimeout(f, ms === 8000 ? 20 : ms) : setTimeout, clearTimeout, Promise, JSON, Object, Error, String, Number, Date, Math, Array, isFinite
  };
  if (!o.noAuth) w.SUAuth = A;
  if (o.noAuth) w.document = { head: { appendChild: (s) => setTimeout(() => s.onerror && s.onerror(), 0) }, createElement: () => ({}) };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(SRC, w);
  let gasCalls = 0;
  const gasCall = () => { gasCalls++; return Promise.resolve(o.gasReply || { ok: true, via: 'gas' }); };
  const call = async (action, params, ctx) => { try { return { d: await w.SUGeno.call(action, params || {}, gasCall, ctx) }; } catch (e) { return { e }; } };
  return { w, call, writes, rpcs, fetches, gas: () => gasCalls, names: () => rpcs.map(r => r.n) };
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
    t('D 事務所のアカウントがデータベースに権限で断られた保存 → 「このアカウントでは使えません」（見るだけではない・指摘8）', r5.d.code === 'su_role' && /使えません/.test(r5.d.error));
    const d2 = box({ flags: ON, mode: 'live', role: 'field', rpcErr: { code: '42501' } });
    const r5b = await d2.call('list', {});
    t('D 現場のアカウントが権限で断られた → 「見るだけ」', r5b.d.code === 'su_view');
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
    t('E 空の応答 → 断り（中身を作らない）・確かめられないので keep（保留に残す・指摘6）', r4.d.code === 'su_empty' && r4.d.ok === false && r4.d.keep === true && /読み込み直して/.test(r4.d.error));
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
    t('H isLive は切り替えた後だけ真・liveHint は liveReady が使えると答えるまで偽（2026-11-08）', b.w.SUGeno.isLive() === true && b.w.SUGeno.liveHint() === false && box({ flags: ON }).w.SUGeno.liveHint() === false);
    t('H liveReady が使えると答えた後の liveHint は真', (await b.w.SUGeno.liveReady()) === true && b.w.SUGeno.liveHint() === true);
    const fd = box({ flags: ON, mode: 'live', field: true });
    await fd.call('list', {});
    t('H 現場の端末は liveHint・probe とも偽（URL の無い現場の端末が新しく全件を読みに行かない・指摘9）', fd.w.SUGeno.liveHint() === false && (await fd.w.SUGeno.probe()) === false);
    const cb = box({ flags: ON });
    t('H コピーを止める: スイッチ入で印が分からない間は止める', cb.w.SUGeno.copyBlocked() === true);
    const cs = box({ flags: ON, mode: 'shadow' });
    await cs.call('list', {});
    t('H コピーを止める: 写しの期間と確かめた後は止めない・スイッチ切は止めない', cs.w.SUGeno.copyBlocked() === false && box({}).w.SUGeno.copyBlocked() === false);
    const lv = box({ flags: ON, mode: 'live' });
    await lv.call('list', {});
    t('H コピーを止める: 切り替えた後は止める（指摘10）', lv.w.SUGeno.copyBlocked() === true);
  }

  console.log('L 接続先・合言葉の無い端末がログインだけで使えるか（liveReady・2026-11-08）');
  {
    for (const [label, o] of [['事務所のアカウント', {}], ['管理者のアカウント', { role: 'admin' }], ['現場のアカウント（事務所PC・見るだけ。送る時の決まりと同じ）', { role: 'field' }], ['2段階認証がまだの管理者（送る時に「2段階認証を済ませて」）', { status: 'mfa_verify', role: 'admin' }]]) {
      const b = box(Object.assign({ flags: ON, mode: 'live' }, o));
      const v = await b.w.SUGeno.liveReady();
      t('L 使える: ' + label + ' → 真・liveHint も真・印（geno_mode_get）を読むだけ・Google へ送らない・端末に書くのはスイッチの控えだけ',
        v === true && b.w.SUGeno.liveHint() === true && b.names().join() === 'geno_mode_get' && b.gas() === 0 && b.writes.every(k => k === 'su_backend_flags') && b.fetches.every(u => /^su-backend\.json\?t=/.test(u)), { v, n: b.names(), w: b.writes, f: b.fetches });
    }
    const no = [
      ['スイッチが無い', { mode: 'live' }],
      ['スイッチが切', { flags: { genogram: false }, mode: 'live' }],
      ['ほかのスイッチだけ入', { flags: { analyzer: true }, mode: 'live' }],
      ['現場の端末（今の接続設定のまま・指摘9）', { flags: ON, mode: 'live', field: true }],
      ['現場の端末の現場のアカウント', { flags: ON, mode: 'live', field: true, role: 'field' }],
      ['ログインしていない', { flags: ON, mode: 'live', status: 'signed_out' }],
      ['使える人に無いアカウント', { flags: ON, mode: 'live', status: 'denied' }],
      ['2段階認証の登録がまだ以外の確かめられない状態', { flags: ON, mode: 'live', status: 'error' }],
      ['確かめが例外', { flags: ON, mode: 'live', checkThrow: true }],
      ['確かめが失敗', { flags: ON, mode: 'live', checkReject: true }],
      ['ログインの部品を読めない', { flags: ON, mode: 'live', noAuth: true }],
      ['印が写しの期間', { flags: ON, mode: 'shadow' }],
      ['印の関数が無い（0054 の前）', { flags: ON, modeErr: { code: 'PGRST202' } }],
      ['印を権限で断られた', { flags: ON, modeErr: { code: '42501' } }],
      ['印を読めない', { flags: ON, modeErr: { code: 'XX000' } }],
      ['端末の保存を読めず、スイッチも読めない', { flags: ON, mode: 'live', lsThrow: true, noFlags: true }]
    ];
    for (const [label, o] of no) {
      const b = box(o);
      let v, thrown = null;
      try { v = await b.w.SUGeno.liveReady(); } catch (e) { thrown = e; }
      t('L 使えない: ' + label + ' → 偽・liveHint も偽・例外を出さない・Google へ送らない', !thrown && v === false && b.w.SUGeno.liveHint() === false && b.gas() === 0, { v, thrown: thrown && thrown.message });
    }
    {
      const b = box({ flags: ON, mode: 'live', checkLate: 200, fast: true });
      const t0 = Date.now();
      const v = await b.w.SUGeno.liveReady();
      const quick = Date.now() - t0 < 180;
      await new Promise(ok => setTimeout(ok, 300));   // 打ち切りの後に印が届く
      t('L 時間切れ（8秒）→ 偽・後から印が届いても liveHint は偽のまま', v === false && quick && b.names().includes('geno_mode_get') && b.w.SUGeno.liveHint() === false, { v, quick, n: b.names() });
    }
    {
      const b = box({ flags: ON, mode: 'live' });
      await b.w.SUGeno.liveReady();
      b.w.SUGeno._forgetMode();
      t('L 使えると答えた後でも、印を忘れたら liveHint は偽（送る時の決まりで確かめ直す）', b.w.SUGeno.liveHint() === false);
      const c = box({ flags: ON, mode: 'live' });
      await c.w.SUGeno.liveReady();
      const r = await c.call('save', { doc: DOC });
      t('L 使える端末の保存はデータベースへ（Google へ送らない・合言葉を送らない）', r.d && r.d.ok === true && c.names().includes('geno_save') && c.gas() === 0 && !('token' in (c.rpcs.find(x => x.n === 'geno_save') || { a: {} }).a));
      const f = box({ flags: ON, mode: 'live', role: 'field' });
      await f.w.SUGeno.liveReady();
      const rf = await f.call('save', { doc: DOC });
      const rg = await f.call('list', {});
      t('L 使える端末でも現場のアカウントは見るだけ（保存は送らない・一覧は読む＝広げも狭めもしない）', rf.d.code === 'su_view' && !f.names().includes('geno_save') && rg.d.items && f.gas() === 0);
      t('L probe は liveReady と同じ関数（古い名前）', b.w.SUGeno.probe === b.w.SUGeno.liveReady);
    }

    // 画面: 設定済みかの判定（CloudSync.isConfigured を画面の本物の関数で）
    const iso = (PAGE.match(/  function getCfg\(\) \{[\s\S]*?\n  \}\n  function setCfg[\s\S]*?\n  \}\n  function isConfigured\(\) \{[\s\S]*?\n  \}\n/) || [''])[0];
    t('L 画面の設定の判定を切り出せる', !!iso);
    const isConf = (cfg, hint) => {
      const ctx = { localStorage: { getItem: () => (cfg ? JSON.stringify(cfg) : null), setItem: () => {} }, window: { SUGeno: hint === undefined ? undefined : { liveHint: () => hint } }, JSON, LS_CLOUD_CFG: 'genogram:cloudCfg' };
      vm.createContext(ctx);
      return vm.runInContext('const GAS_URL_RE = /^https:\\/\\/script\\.google\\.com\\//;\n' + iso + '\nisConfigured();', ctx);
    };
    t('L 画面: 接続先の無い端末は、使える時だけ設定済み（使えない時・部品が無い時は今までどおり未設定）',
      isConf(null, true) === true && isConf(null, false) === false && isConf(null, undefined) === false && isConf({ gasUrl: '' }, false) === false);
    t('L 画面: 接続先のある端末は今までどおり設定済み', isConf({ gasUrl: 'https://script.google.com/macros/s/X/exec', gasToken: 'x' }, false) === true && isConf({ gasUrl: 'https://example.com/' }, false) === false);

    // 画面: 起動の時の確かめ（init の SUGeno の段を画面の本物の文で）
    const h = PAGE.indexOf('  if (window.SUGeno) {\n    const wasConfigured');
    let blk = '';
    if (h >= 0) { let d = 0, i = PAGE.indexOf('{', h); for (; i < PAGE.length; i++) { if (PAGE[i] === '{') d++; else if (PAGE[i] === '}') { d--; if (d === 0) { blk = PAGE.slice(h, i + 1); break; } } } }
    t('L 画面の起動の段を切り出せる', !!blk);
    const boot = async (o) => {
      const n = { ready: 0, probe: 0, quiet: 0, ui: 0, list: 0, load: 0 };
      const G = { liveHint: () => false, probe: () => { n.probe++; return Promise.resolve(o.live); } };
      if (!o.old) G.liveReady = () => { n.ready++; return Promise.resolve(o.live); };
      const ctx = {
        window: { SUGeno: G, SUCfgHint: o.noHint ? undefined : { quiet: () => { n.quiet++; } }, SUErrors: { note: () => {} } },
        CloudSync: { isConfigured: () => !!o.was }, applyCloudConfigUI: () => { n.ui++; }, refreshDocList: () => { n.list++; },
        suName: o.name || '', bootLoad: null, state: { clientName: o.name || '' }, hasUnsavedChanges: () => !!o.dirty,
        loadDoc: () => { n.load++; return Promise.resolve(); }, Promise
      };
      vm.createContext(ctx);
      vm.runInContext(blk, ctx);
      await new Promise(ok => setTimeout(ok, 20));
      return n;
    };
    const a = await boot({ live: true });
    t('L 画面: 接続先の無い端末で使える → 確かめは1回・帯を止める・同期の札をそろえる・一覧を読み直す', a.ready === 1 && a.probe === 0 && a.quiet === 1 && a.ui === 1 && a.list === 1 && a.load === 0, a);
    const a2 = await boot({ live: true, name: '架空 一郎' });
    t('L 画面: ?resident= から開いて描き変えていなければ、この方の図を読み直す（前からの動き）', a2.load === 1 && a2.quiet === 1, a2);
    const a3 = await boot({ live: true, name: '架空 一郎', dirty: true });
    t('L 画面: 描き始めていたら読み直さない（前からの動き）', a3.load === 0 && a3.list === 1, a3);
    const b0 = await boot({ live: false });
    t('L 画面: 使えない → 帯も札も一覧も今までどおり（何もしない）', b0.ready === 1 && b0.quiet === 0 && b0.ui === 0 && b0.list === 0, b0);
    const c0 = await boot({ live: true, was: true });
    t('L 画面: 接続先のある端末 → 何も変えない（今までどおり）', c0.ready === 1 && c0.quiet === 0 && c0.ui === 0 && c0.list === 0, c0);
    const d0 = await boot({ live: true, old: true });
    t('L 画面: 古い部品（liveReady が無い）でも probe で同じに動く', d0.probe === 1 && d0.quiet === 1 && d0.ui === 1, d0);
    const e0 = await boot({ live: true, noHint: true });
    t('L 画面: 帯の部品が無くても止まらない', e0.ui === 1 && e0.list === 1, e0);

    // 画面: 設定の窓の初回の案内（接続先の無い使える端末だけ隠す）
    t('L 画面: 初回の案内は、接続先が無く使える端末（liveHint）だけ隠す', /\$\('cfgFirstGuide'\)\.hidden = !!\(!cfg\.gasUrl && window\.SUGeno && window\.SUGeno\.liveHint\(\)\);/.test(PAGE) && /\[hidden\]\{display:none !important\}/.test(PAGE));
    t('L 画面: Google へ送る関数は接続先が無ければ今までどおり送らずに断る（写しの期間へ戻った時）', /async function gasCallGoogle\(action, params, opts\) \{\s*const cfg = getCfg\(\);\s*if \(!cfg\.gasUrl\) throw new Error\(GENO_NO_CFG_MSG\);/.test(PAGE));
  }

  console.log('R 古い印で Google へ送った（切り替えた直後）');
  {
    let m = 'shadow';
    const b = box({ flags: ON, gasReply: { ok: false, error: '切り替え済み', code: 'geno_switched' } });
    // 1回目の印は shadow、Google が geno_switched → 印を読み直す（2回目は live）→ データベースへ
    const orig = b.w.SUAuth.client;
    b.w.SUAuth.client = () => { const c = orig(); const rpc = c.rpc; return { rpc: (n, a) => (n === 'geno_mode_get' ? (b.rpcs.push({ n, a: {} }), Promise.resolve({ data: { ok: true, mode: (m = m === 'shadow' ? 'live' : m, m === 'live' && b.rpcs.filter(x => x.n === 'geno_mode_get').length === 1 ? 'shadow' : 'live') } })) : rpc(n, a)) }; };
    const r = await b.call('save', { doc: DOC });
    t('R Google の geno_switched → 印を読み直して1回だけ決め直し、データベースへ送る（指摘4）', r.d && r.d.ok === true && r.d.saved && b.gas() === 1 && b.names().includes('geno_save'), b.names());
    const c = box({ flags: ON, mode: 'shadow', gasReply: { ok: false, error: '切り替え済み', code: 'geno_switched' } });
    const r2 = await c.call('save', { doc: DOC });
    t('R 決め直しても Google が断るなら、2回目でやめて断りを返す（回り続けない）', r2.d.code === 'geno_switched' && c.gas() === 2);
  }

  console.log('S 画面');
  {
    t('S su-geno.js を読み込む', /<script src="su-geno\.js\?v=2026-11-08"><\/script>/.test(PAGE));
    t('S gasCall は SUGeno に通し、Google へ送る関数（gasCallGoogle）は今までの fetchWithRetry のまま', /const rid = \(opts && 'rid' in opts\) \? \(opts\.rid \|\| null\) : ridFor\(action, params\);[\s\S]{0,120}window\.SUGeno\.call\(action, params \|\| \{\}, \(\) => gasCallGoogle\(action, params, opts\), \{ residentId: rid \}\)/.test(PAGE)
      && /async function gasCallGoogle\(action, params, opts\) \{[\s\S]*?headers: \{ 'Content-Type': 'text\/plain;charset=utf-8' \}, redirect: 'follow' \};[\s\S]*?return await fetchWithRetry\(url, init, undefined, async \(res\) => \{\s*if \(!res\.ok\) throw new Error\('GAS HTTP ' \+ res\.status\);\s*return await res\.json\(\);/.test(PAGE));
    t('S 利用者No は ?resident= の方の図（suGenoMasterIdFor）と保留に積んだ時の値だけ', /function ridFor\(action, params\) \{[\s\S]*?suGenoMasterIdFor\(name, mid, window\._suMasterName\) \? String\(mid\) : null;/.test(PAGE)
      && /out\.rid = ridFor\(/.test(PAGE));
    t('S 保留の再送は積んだ時の利用者No を送信ごとに明示して渡す（共有の変数を使わない・指摘7）', !/flushRid/.test(PAGE)
      && /const ro = \('rid' in item\) \? \{ rid: item\.rid \|\| null \} : undefined;[\s\S]{0,400}const get = \(n\) => getQ\(n, ro\);/.test(PAGE)
      && /await saveAndMarkBaseline\(doc, item\.base, item\.dirtySeq, ro\)/.test(PAGE) && /await del\(item\.name, \('base' in item\) \? item\.base : undefined, ro\)/.test(PAGE) && /await get\(item\.name, ro\)/.test(PAGE));
    t('S 保留から外す（err.refused）のは中身・取り違えの守りの断りだけ（ログイン・役割・混み合い等は残す・指摘4）', /const GENO_FINAL_CODES = \['geno_toolarge', 'geno_toomany', 'geno_badchar', 'geno_badname', 'geno_other_resident', 'geno_ambiguous', 'geno_name_taken_by_link', 'su_view'\];/.test(PAGE)
      && /err\.refused = GENO_FINAL_CODES\.indexOf\(json\.code\) >= 0;/.test(PAGE));
    t('S 保留の再送で断られた項目は外す・直接の保存は積まない・削除は端末の図を残す', /if \(e && e\.refused\) \{[\s\S]{0,300}done\.push\(\{ item, landed: null \}\)/.test(PAGE)
      && /\} else if \(err && err\.refused\) \{[\s\S]{0,600}クラウドへは保存されていません/.test(PAGE) && /if \(err && err\.refused\) \{[\s\S]{0,300}削除できませんでした（端末の図も残しています）/.test(PAGE));
    t('S この方に結び付いた図は、氏名が URL と違っても masterId のキーを書く', /var bd = window\._suGenoBound;\s*if \(bd && bd\.id === mid && bd\.name === dn\) return mid;/.test(PAGE));
    t('S 別の方・同姓同名の方の図の名前は、この方のキーを書かない（指摘2）', /if \(window\._suGenoBlocked && Object\.prototype\.hasOwnProperty\.call\(window\._suGenoBlocked, dn\)\) return '';/.test(PAGE));
    t('S 名前を直した方の図: 帯（本人確認）と古いサムネイルの片付けも結び付いた図を正しいとみなす（指摘3）', /bd && bd\.id === String\(id\) && bd\.name === state\.clientName/.test(PAGE) && /if \(bd && bd\.id === k && String\(bd\.name\)\.replace\(\/\\s\+\/g, ''\) === got\) return;/.test(PAGE));
    t('S 切り替えた後・分からない間は受け口のコードをコピーしない（ボタンも隠す・指摘10）', /if \(window\.SUGeno && window\.SUGeno\.copyBlocked\(\)\) \{[\s\S]{0,200}この画面からはコピーしません/.test(PAGE) && /\$\('btnCopyGas'\)\.hidden = !!\(window\.SUGeno && window\.SUGeno\.copyBlocked\(\)\)/.test(PAGE));
    t('S 名前の違う図を「届いていた」と見ない（中身の比べに氏名を入れる・指摘5）', /const pick = \(d\) => JSON\.stringify\(\{ clientName: d\.clientName, canvasSize/.test(PAGE));
    t('S 起動の後に切り替えた後と分かったら、描き変えていなければこの方の図を読み直す（指摘1）', /if \(suName\) \{\s*Promise\.resolve\(bootLoad\)[\s\S]{0,200}if \(state\.clientName === suName && !hasUnsavedChanges\(\)\) \{[\s\S]{0,200}return loadDoc\(suName, \{ silentIfMissing: true \}\);/.test(PAGE));
    /* 2026-11-12: 知らせは画面の中の窓（su-dialog.js）になり、答えを待つ形（await SUDialog.alert）で呼ぶ。確かめる場所・順番は今までどおり */
    const ld = (PAGE.match(/async function loadDoc\(name, opts\) \{[\s\S]*?\n\}\n/) || [''])[0];
    t('S 読込: 別の方・同姓同名の方の図は端末の図も使わず・基準も変えず・消えない帯と知らせで止める（指摘2）', /const blockedWhy = CloudSync\.blockedWhy\(name\);\s*if \(blockedWhy\) \{\s*setSyncStatus\('err', blockedWhy\);\s*await SUDialog\.alert\(blockedWhy\);[\s\S]{0,200}markClean\(\);\s*return;\s*\}/.test(ld)
      && ld.indexOf('CloudSync.blockedWhy(name)') < ld.indexOf('cloudSeenAt = remote.updatedAt'));
    t('S 読込: 名前を直した方の図は、その図の名前で読み直す（端末の控え・基準・最後に開いた図をそろえる・1回だけ・指摘3）', /if \(remote && remote\.clientName != null && String\(remote\.clientName\) !== String\(name\) && !\(opts && opts\._redirected\)\) \{\s*return await loadDoc\(String\(remote\.clientName\), Object\.assign\(\{\}, opts \|\| \{\}, \{ _redirected: true \}\)\);/.test(ld)
      && /CloudSync\.get\(name, \{ allowOther: true \}\)/.test(ld));
    t('S 保存の前の確かめ: 名前の違う図は別の図（null）として扱う（同じ図との食い違いにしない・指摘3）', /if \(d && d\.clientName != null && String\(d\.clientName\) !== String\(name\) && !\(opts && opts\.allowOther\)\) return null;/.test(PAGE));
    t('S 別の方・同姓同名の方の図の印は、この画面の間だけ持ち（端末に書かない）・その名前では保存しない（指摘2）', /window\._suGenoBlocked\[String\(name\)\] = why;\s*return null;/.test(PAGE) && !/localStorage\.setItem\([^)]*_suGenoBlocked/.test(PAGE)
      && /const blockedWhy = CloudSync\.blockedWhy\(name\);\s*if \(blockedWhy\) \{ await SUDialog\.alert\(/.test(PAGE));
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
