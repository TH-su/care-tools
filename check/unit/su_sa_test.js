/* 過去シフト・アナライザのクラウド同期の保存先の切り替えの入口（su-sa.js・統合 0050・0051・2026-11-03）の試験。架空データのみ。
   守ること:
     A スイッチ analyzer が切・無い時は、Google へ送る関数をそのまま呼ぶ（データベースを呼ばない）
     B スイッチが入でも、印が写しの期間・0051 の前（関数が無い）は Google
     C 印が「切り替えた後」ならデータベースの関数（sa_ping・sa_pull・sa_head・sa_push）を呼び、Google を呼ばない。合言葉は送らない。
       答えは GAS と同じ形のまま返す（conflict・ok・entries・revs）
     D スイッチが入の時、断り（印を確かめられない・2段階認証がまだ・入りきらない・形の違い）は Google へ流さず {error:職員向けの文} で返す。
       見えない文字（sa_badchar）はデータベースの文をそのまま返す
     E データベースに届かない・時間切れは例外（職員向けの文）。Google へ流さない
     F データベースが「写しの期間」（sa_not_live）と答えたら、印を捨てて Google へ送る。Google が「切り替えた後」（sa_switched）と断ったら印を捨てる
     G ログインしていない端末・現場のアカウント（印を読めない）は印だけの口（sa_mode_public）を読み、切り替えた後なら Google へ送らずに断る。
       印が分からない時は保存を送らない（読み取りは Google）。Google の sa_switched（読み取りも）は中身を渡さずに同じ断りへ（反証レビュー 指摘1・2・5）
     K 現場の端末（su_device_role field）はスイッチが入の間クラウド同期を使わない（probe 偽・blocked 真・指摘3）
     M データベースが番号つきで断った時は「受け付けませんでした」、番号の無い失敗は通信の失敗（指摘7）。渡したキーが全部形違いなら空の答え（指摘8）
     H 読み取りの前は印を読み直す・保存は1分覚える／ログインの部品は1回だけ読む／端末に書くのはスイッチの控えだけ
     L 切り替えた後は URL・合言葉の無い端末でも同期してよい（liveHint・probe）
     S 画面（shift-analyzer.html）: cloudApi を SUSa に通し、Google へ送る関数は今までの fetch のまま
   実行: node check/unit/su_sa_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-sa.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'shift-analyzer.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }

function box(o) {
  o = o || {};
  const store = { su_backend_flags: JSON.stringify({ supabase: o.flags || {} }) };
  if (o.field) store.su_device_role = 'field';
  const writes = [], rpcs = [];
  const A = {
    STATUS: { SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_ENROLL: 'mfa_enroll', MFA_VERIFY: 'mfa_verify', OK: 'ok', ERROR: 'error' },
    check: () => (o.checkReject ? Promise.reject(new Error('x')) : Promise.resolve({ status: o.status || 'ok', role: 'office' })),
    client: () => ({
      rpc: (n, a) => {
        rpcs.push({ n, a: JSON.parse(JSON.stringify(a || {})) });
        if (n === 'sa_mode_public') {
          if (o.pubReject) return Promise.reject(new Error('offline'));
          if (o.pubErr) return Promise.resolve({ error: o.pubErr });
          return Promise.resolve({ data: { ok: true, mode: o.pub || 'shadow' } });
        }
        if (n === 'sa_mode_get') {
          if (o.modeErr) return Promise.resolve({ error: o.modeErr });
          return Promise.resolve({ data: { ok: true, mode: (o.modeRef ? o.modeRef.m : o.mode) || 'shadow', version: 3 } });
        }
        if (o.rpcHang) return new Promise(() => {});
        if (o.rpcReject) return Promise.reject(new Error('Failed to fetch'));
        if (o.rpcErr) return Promise.resolve({ error: o.rpcErr });
        if ('reply' in o) return Promise.resolve({ data: typeof o.reply === 'function' ? o.reply(n, a) : o.reply });
        if (n === 'sa_push') return Promise.resolve({ data: { ok: true, rev: 1004, role: 'rw' } });
        if (n === 'sa_head') return Promise.resolve({ data: { ok: true, revs: { months: 1004 }, role: 'rw' } });
        if (n === 'sa_pull') return Promise.resolve({ data: { ok: true, entries: { months: { key: 'months', rev: 1004, updatedAt: 'x', data: { months: [] } } }, role: 'rw' } });
        return Promise.resolve({ data: { ok: true, server: 'shiftanalyzer-supabase', role: 'rw' } });
      }
    })
  };
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k) => writes.push(k), removeItem: (k) => writes.push(k) },
    fetch: (url) => /su-backend\.json/.test(url) ? Promise.resolve({ ok: true, json: async () => ({ supabase: o.flags || {} }) }) : Promise.reject(new Error('fetch ' + url)),
    setTimeout, clearTimeout, Promise, JSON, Object, Error, String, Number, Date, Math, Array, isFinite
  };
  if (o.noAuthYet) {
    w.supabase = {};
    w.document = { head: { appendChild: (sc) => { (o.scripts = o.scripts || []).push(sc.src); setTimeout(() => { w.SUAuth = A; sc.onload(); }, 5); } }, createElement: () => ({}) };
  } else w.SUAuth = A;
  w.window = w;
  vm.createContext(w);
  vm.runInContext(SRC, w);
  let gasCalls = 0;
  const gasCall = () => { gasCalls++; return Promise.resolve(o.gasReply || { ok: true, via: 'gas', role: 'rw' }); };
  const call = async (body) => { try { return { d: await w.SUSa.call(body, gasCall) }; } catch (e) { return { e }; } };
  return { w, call, writes, rpcs, gas: () => gasCalls, names: () => rpcs.map(r => r.n) };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const PUSH = () => ({ action: 'push', key: 'months', data: { months: [{ label: '2026-10' }], qualMaster: { 'ｶｸｳ': { name: '架空', quals: ['介護福祉士'] } } }, baseRev: 1003, force: false });

(async () => {
  console.log('A Google のまま');
  for (const [label, o] of [['スイッチが無い', {}], ['スイッチが切', { flags: { analyzer: false } }], ['ほかのスイッチだけ入', { flags: { supplies: true }, mode: 'live' }]]) {
    const b = box(o);
    const x = await b.call(PUSH());
    t('A ' + label + ' → Google へ1回・データベースを呼ばない', x.d && x.d.via === 'gas' && b.gas() === 1 && b.rpcs.length === 0, [x, b.rpcs]);
  }
  {
    const b = box({ flags: { analyzer: true }, mode: 'live' });
    const x = await b.call(null);
    t('A 本文が無い・形が違う時も Google の関数のまま', x.d.via === 'gas' && b.rpcs.length === 0);
  }
  console.log('B 写しの期間・0051 の前');
  {
    const b = box({ flags: { analyzer: true }, mode: 'shadow' });
    const x = await b.call(PUSH());
    t('B 印が写しの期間 → Google', x.d.via === 'gas' && b.gas() === 1 && b.names().join() === 'sa_mode_get');
    const b2 = box({ flags: { analyzer: true }, modeErr: { code: 'PGRST202' } });
    const y = await b2.call(PUSH());
    t('B 関数が無い（0051 の前）→ Google', y.d.via === 'gas' && b2.gas() === 1);
  }
  console.log('C 切り替えた後');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live' });
    const x = await b.call(PUSH());
    const r = b.rpcs.find(q => q.n === 'sa_push');
    t('C 保存は sa_push（キー・中身・版・force をそのまま）・Google を呼ばない', b.gas() === 0 && r && r.a.p_key === 'months' && r.a.p_base_rev === 1003 && r.a.p_force === false && r.a.p_data.months[0].label === '2026-10', r);
    t('C 合言葉（token）を送らない', !JSON.stringify(b.rpcs).includes('token'));
    t('C 答えは GAS と同じ形（ok・rev・role）', x.d.ok === true && x.d.rev === 1004 && x.d.role === 'rw', x);
    const p2 = PUSH(); p2.token = 'tok-analyzer-rw'; p2.force = true;
    const b2 = box({ flags: { analyzer: true }, mode: 'live' });
    await b2.call(p2);
    t('C 画面が合言葉を付けていても送らない・force は真偽で渡す', !JSON.stringify(b2.rpcs).includes('tok-analyzer') && b2.rpcs.find(q => q.n === 'sa_push').a.p_force === true);
    const b3 = box({ flags: { analyzer: true }, mode: 'live' });
    const h = await b3.call({ action: 'head', keys: ['months'] });
    const p = await b3.call({ action: 'pull', keys: ['months'] });
    const g = await b3.call({ action: 'ping' });
    t('C head・pull・ping も同じ形で返す', h.d.revs.months === 1004 && p.d.entries.months.rev === 1004 && g.d.role === 'rw', [h, p, g]);
    t('C キーはそのまま渡す（形の違うキーは外す）', b3.rpcs.find(q => q.n === 'sa_head').a.p_keys.join() === 'months');
    const b4 = box({ flags: { analyzer: true }, mode: 'live', reply: { conflict: true, serverRev: 1010, role: 'rw' } });
    const c = await b4.call(PUSH());
    t('C 競合（conflict）は GAS と同じ形で返す（画面が取得→統合→再送する）', c.d.conflict === true && c.d.serverRev === 1010 && !c.d.error);
    const b5 = box({ flags: { analyzer: true }, mode: 'live' });
    const u = await b5.call({ action: 'saMirror' });
    t('C 知らない操作は GAS と同じ unknown action（データベースの関数を呼ばない）', u.d.error === 'unknown action' && b5.names().join() === 'sa_mode_get');
  }
  console.log('D 断り（Google へ流さない）');
  {
    const cases = [
      ['入りきらない', { reply: { error: 'toolarge' } }, /入りきらなく/],
      ['形の違い', { reply: { error: 'bad-request' } }, /受け付けない形/],
      ['使えないアカウント（42501）', { rpcErr: { code: '42501' } }, /使えません/],
      ['空の応答', { reply: null }, /空でした/]
    ];
    for (const [label, o, re] of cases) {
      const b = box(Object.assign({ flags: { analyzer: true }, mode: 'live' }, o));
      const x = await b.call(PUSH());
      t('D ' + label + ' → 職員向けの文・Google へ流さない', x.d && re.test(x.d.error) && b.gas() === 0, x);
    }
    const bc = box({ flags: { analyzer: true }, mode: 'live', reply: { error: '保存する中身に、保存できない見えない文字が入っています。この保存は入っていません。管理者へ連絡してください', code: 'sa_badchar' } });
    const xc = await bc.call(PUSH());
    t('D 見えない文字（sa_badchar）はデータベースの文をそのまま', /見えない文字/.test(xc.d.error) && bc.gas() === 0);
    const bm = box({ flags: { analyzer: true }, status: 'mfa_verify', modeErr: { code: '42501' } });
    const xm = await bm.call(PUSH());
    t('D 2段階認証がまだ・印を読めない → 「2段階認証を済ませて」', /2段階認証/.test(xm.d.error) && bm.gas() === 0);
    const bm2 = box({ flags: { analyzer: true }, status: 'mfa_verify', mode: 'live', rpcErr: { code: '42501' } });
    const xm2 = await bm2.call(PUSH());
    t('D 2段階認証がまだでデータベースが断った → 「2段階認証を済ませて」', /2段階認証/.test(xm2.d.error) && bm2.gas() === 0);
    const be = box({ flags: { analyzer: true }, status: 'error' });
    const xe = await be.call(PUSH());
    t('D ログインを確かめられない → もう一度（Google へ流さない）', /確かめられません/.test(xe.d.error) && be.gas() === 0);
    const br = box({ flags: { analyzer: true }, checkReject: true });
    const xr = await br.call(PUSH());
    t('D 確かめが例外 → もう一度（Google へ流さない）', /確かめられません/.test(xr.d.error) && br.gas() === 0);
    const bx = box({ flags: { analyzer: true }, modeErr: { code: '500' } });
    const xx = await bx.call(PUSH());
    t('D 印が読めない（ほかの失敗）→ もう一度（Google へ流さない）', /確かめられません/.test(xx.d.error) && bx.gas() === 0);
  }
  console.log('E 届かない・時間切れ');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live', rpcReject: true });
    const x = await b.call(PUSH());
    t('E 届かない → 例外（職員向けの文）・Google へ流さない', x.e && /届きません/.test(x.e.message) && b.gas() === 0, x);
    const b2 = box({ flags: { analyzer: true }, mode: 'live', rpcErr: { code: '', message: 'TypeError: Failed to fetch' } });
    const y = await b2.call(PUSH());
    t('E 番号の無い失敗（届かない）→ 例外・Google へ流さない', y.e && /届きません/.test(y.e.message) && b2.gas() === 0, y);
    t('E 時間切れの文は「取得してから確かめて」', /timeout: '[^']*取得してから確かめて/.test(SRC));
  }
  console.log('F 写しの期間へ戻っていた・Google が切り替えた後と断った');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live', reply: { error: 'sa_not_live' } });
    const x = await b.call(PUSH());
    t('F データベースが「写しの期間」→ Google へ送る', x.d.via === 'gas' && b.gas() === 1);
    await b.call(PUSH());
    t('F 印を捨てて読み直す', b.names().filter(n => n === 'sa_mode_get').length === 2);
    const ref = { m: 'shadow' };
    const b2 = box({ flags: { analyzer: true }, modeRef: ref, gasReply: { error: '切り替えた後です', code: 'sa_switched' } });
    const y = await b2.call(PUSH());
    ref.m = 'live';
    await b2.call(PUSH());
    t('F Google の「切り替えた後」の断りはそのまま返し、印を捨てて次はデータベースへ', y.d.code === 'sa_switched' && b2.names().filter(n => n === 'sa_mode_get').length === 2 && b2.names().includes('sa_push'), b2.names());
  }
  console.log('G ログインしていない・現場のアカウント');
  {
    const b = box({ flags: { analyzer: true }, status: 'signed_out' });
    const x = await b.call({ action: 'pull', keys: ['months'] });
    t('G ログインしていない端末（写しの期間）→ 印だけの口を読んで Google のまま使える', x.d.via === 'gas' && b.gas() === 1 && b.names().join() === 'sa_mode_public', b.names());
    const b2 = box({ flags: { analyzer: true }, status: 'signed_out', pub: 'live' });
    const y = await b2.call(PUSH());
    const y2 = await b2.call({ action: 'pull', keys: ['months'] });
    t('G 切り替えた後（印だけの口が live）→ 保存も読み取りも Google へ送らずに「ログインしてください」（古いデプロイにも送らない・指摘2・5）', /ログインしていません/.test(y.d.error) && /ログインしていません/.test(y2.d.error) && b2.gas() === 0, [y, y2]);
    const b3 = box({ flags: { analyzer: true }, modeErr: { code: '42501' }, pub: 'live' });
    const z = await b3.call(PUSH());
    t('G 現場のアカウント・切り替えた後 → 「このアカウントでは使えません」・Google へ送らない', /使えません/.test(z.d.error) && b3.gas() === 0, z);
    const b4 = box({ flags: { analyzer: true }, status: 'denied' });
    const z2 = await b4.call(PUSH());
    t('G 使える人に無いアカウント（写しの期間）→ Google のまま', z2.d.via === 'gas');
    for (const [label, o] of [['届かない', { pubReject: true }], ['読めない', { pubErr: { code: '500' } }]]) {
      const b5 = box(Object.assign({ flags: { analyzer: true }, status: 'signed_out' }, o));
      const w1 = await b5.call(PUSH());
      const w2 = await b5.call({ action: 'head', keys: ['months'] });
      t('G 印が分からない（' + label + '）→ 保存は送らずに断る・読み取りは Google が決める（指摘2）', /確かめられません/.test(w1.d.error) && w2.d.via === 'gas' && b5.gas() === 1, [w1, w2]);
    }
    const b6 = box({ flags: { analyzer: true }, status: 'signed_out', pubErr: { code: 'PGRST202' } });
    const w3 = await b6.call(PUSH());
    t('G 印だけの口が無い（0051 の前）→ Google のまま', w3.d.via === 'gas');
    const b7 = box({ flags: { analyzer: true }, status: 'signed_out', gasReply: { error: '切り替えた後です', code: 'sa_switched' } });
    const w4 = await b7.call({ action: 'pull', keys: ['months'] });
    t('G Google が読み取りを sa_switched で断った → 「ログインしてください」・中身は渡さない（指摘1）', /ログインしていません/.test(w4.d.error) && !w4.d.entries && !w4.d.code, w4);
    const b8 = box({ flags: { analyzer: true }, modeErr: { code: '42501' }, gasReply: { error: '切り替えた後です', code: 'sa_switched' } });
    const w5 = await b8.call({ action: 'head', keys: ['months'] });
    t('G 現場のアカウントで Google が sa_switched → 「使えません」', /使えません/.test(w5.d.error) && !w5.d.revs, w5);
  }
  console.log('K 現場の端末');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live', field: true });
    const x = await b.call(PUSH());
    const y = await b.call({ action: 'pull', keys: ['months'] });
    t('K スイッチが入・現場の端末 → 保存も読み取りも断る（Google にもデータベースにも送らない）', /現場/.test(x.d.error) && /現場/.test(y.d.error) && b.gas() === 0 && b.rpcs.length === 0, b.rpcs);
    t('K probe は偽・blocked は真・liveHint は偽', (await b.w.SUSa.probe()) === false && b.w.SUSa.blocked() === true && b.w.SUSa.liveHint() === false && b.rpcs.length === 0);
    const b2 = box({ flags: {}, field: true });
    const z = await b2.call(PUSH());
    t('K スイッチが切なら現場の端末も今までどおり（Google の関数のまま・blocked は偽）', z.d.via === 'gas' && b2.w.SUSa.blocked() === false);
  }
  console.log('M データベースの断り・キー');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live', rpcErr: { code: 'PGRST301', message: 'x' } });
    const x = await b.call(PUSH());
    t('M 番号つきの断り（42501・関数が無い以外）→ 「受け付けませんでした」・Google へ流さない', x.d && /受け付けませんでした/.test(x.d.error) && b.gas() === 0, x);
    const b2 = box({ flags: { analyzer: true }, mode: 'live' });
    const p = await b2.call({ action: 'pull', keys: ['a/b', '../x'] });
    const h = await b2.call({ action: 'head', keys: ['a/b'] });
    t('M 渡したキーが全部形違い → 空の答え（全部を返す p_keys=[] を送らない）', JSON.stringify(p.d) === '{"ok":true,"entries":{},"role":"rw"}' && JSON.stringify(h.d) === '{"ok":true,"revs":{},"role":"rw"}'
      && !b2.names().includes('sa_pull') && !b2.names().includes('sa_head'), [p, h, b2.names()]);
    const b3 = box({ flags: { analyzer: true }, mode: 'live' });
    await b3.call({ action: 'pull', keys: [] });
    await b3.call({ action: 'pull' });
    const pulls = b3.rpcs.filter(q => q.n === 'sa_pull');
    t('M キーを渡さない・空の配列は今までどおり（全部）', pulls.length === 2 && pulls[1].a.p_keys === null, pulls);
  }
  console.log('H 印の覚え方・読み込み・書き込み');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live' });
    await b.call(PUSH()); await b.call(PUSH());
    t('H 保存は印を1分覚える', b.names().filter(n => n === 'sa_mode_get').length === 1);
    await b.call({ action: 'head', keys: ['months'] }); await b.call({ action: 'pull', keys: ['months'] });
    t('H 読み取りの前は印を読み直す', b.names().filter(n => n === 'sa_mode_get').length === 3);
    const o = { flags: { analyzer: true }, mode: 'live', noAuthYet: true };
    const b2 = box(o);
    await Promise.all([b2.call(PUSH()), b2.call(PUSH()), b2.call({ action: 'head', keys: ['months'] })]);
    t('H ログインの部品は同時に何度送っても1回だけ読む', (o.scripts || []).filter(s => /su-auth/.test(s)).length === 1, o.scripts);
    t('H 端末に書くのはスイッチの控えだけ', b.writes.every(k => k === 'su_backend_flags') && (SRC.match(/setItem\(/g) || []).length === 1 && !/sessionStorage/.test(SRC));
    t('H 二重に動かさない', /if \(root\.SUSa\) return;/.test(SRC));
    t('H Google への写し返しを画面から頼まない', !/saMirror/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
    t('H 空の catch で捨てない（記録へ）', /SUErrors\.note/.test(SRC));
  }
  console.log('L URL・合言葉の無い端末');
  {
    const b = box({ flags: { analyzer: true }, mode: 'live' });
    t('L 印を確かめる前は liveHint が偽', b.w.SUSa.liveHint() === false);
    const live = await b.w.SUSa.probe();
    t('L 起動の確かめ（probe）で live → liveHint が真', live === true && b.w.SUSa.liveHint() === true);
    const b2 = box({ flags: { analyzer: true }, status: 'signed_out' });
    t('L ログインしていない端末は probe が偽', (await b2.w.SUSa.probe()) === false);
    const b3 = box({ flags: {} , mode: 'live' });
    t('L スイッチが切なら probe が偽（データベースを呼ばない）', (await b3.w.SUSa.probe()) === false && b3.rpcs.length === 0);
  }
  console.log('S 画面（shift-analyzer.html）');
  {
    t('S su-sa.js を読む（版の印つき・画面の処理より前）', /<script src="su-sa\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/.test(PAGE) && PAGE.indexOf('su-sa.js?v=') < PAGE.indexOf('function cloudApi('));
    const m = /function cloudApi\(payload\) \{([\s\S]*?)\n  \}\n  function cloudErrMsg/.exec(PAGE);
    t('S cloudApi は SUSa に通し、無ければ Google へ送る関数を直接呼ぶ', !!m && /window\.SUSa \? window\.SUSa\.call\(payload, viaGas\) : viaGas\(\)/.test(m[1]), m && m[1]);
    t('S Google への送り方は今までどおり（POST・text/plain・redirect follow・本文は JSON の文字・合言葉は Google へだけ）', !!m && /method: 'POST',\n\s+headers: \{ 'Content-Type': 'text\/plain;charset=UTF-8' \}, \/\* CORSプリフライト回避 \*\/\n\s+body: JSON\.stringify\(payload\),\n\s+redirect: 'follow'/.test(m[1]) && /function viaGas\(\) \{[\s\S]*payload\.token = c\.token;[\s\S]*fetch\(c\.url/.test(m[1]));
    t('S 答えの error は今までどおり例外にする', !!m && /if \(j && j\.error\) throw new Error\(cloudErrMsg\(j\.error\)\)/.test(m[1]));
    t('S 現場の端末はスイッチが入の間「設定済み」にしない（自動同期しない）', /function cloudConfigured\(\) \{[\s\S]*?if \(window\.SUSa && window\.SUSa\.blocked\(\)\) return false;[\s\S]*?liveHint/.test(PAGE));
    t('S 切り替えた後は URL・合言葉が無くても「設定済み」', /function cloudConfigured\(\) \{[\s\S]*?window\.SUSa\.liveHint\(\)[\s\S]*?\n  \}/.test(PAGE));
    t('S 起動時に probe して、live なら自動同期を始める', /window\.SUSa\.probe\(\)\.then\(function \(live\) \{ if \(live && autoEnabled\(\)\)/.test(PAGE));
    t('S 不具合を報告のボタンは今までどおり', /<script src="su-report\.js\?v=[^"]+" data-tool="過去シフト・アナライザ"><\/script>/.test(PAGE));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
