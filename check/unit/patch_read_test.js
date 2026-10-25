/* 貼り薬カレンダーの段階3「サーバーの値で表示する」（su-patch-sync.js の pull・merge と、patch-calendar.html の pcPull 等）の試験（2026-10-25 新設）
   実行: node check/unit/patch_read_test.js
   対象を差し替える（壊した版で落ちることを確かめる）:
     PATCH_SYNC_JS=/tmp/変異版.js node check/unit/patch_read_test.js
     PATCH_HTML=/tmp/変異版.html も同じ

   守ること（2026-10-25 代表者の決定）:
     A スイッチ（su-backend.json の supabase.patch_read）が true の時だけ読む。無い・true 以外・読めず前の値も無い＝読まない・帯も出さない
     B 現場の端末（su_device_role=field）では patch_get を呼ばない・帯も出さない・ログインの部品も読み込まない
     C 事務所PCでスイッチ入なら読んで、控え（apc2_res）をサーバーの値にし、選んでいる方を描き直す（表示がサーバーの値になる）
     D 手元のままにする方: 送信待ち（apc2_sync_q）にある方・サーバーに無い方・日時（at）の無い控え・手元の日時の方が新しい方
     E 空の応答・形の違う応答・42501・通信の失敗・未ログイン・時間切れでは控えを消さず（書かず）、帯の文言が出る。届いたら帯が消える
     F 遅れて届いた応答（後から読み直した・用途が現場へ変わった後）は捨てる
     G 印刷で帯が出ない（@media print で消す）・最初は出ていない
     H 引数を送らない（氏名も入居者IDも送らない）・控え以外を書かない・控えが読めない時は書かない・形の違う行は使わない
     I 反証レビューの直し（2026-10-25）: 手元が新しくても残すのは「送信待ち」か「今から10分以内で断られていない」方だけ
       （日時が同じで値が違う・断られた・10分より前はサーバーの値）／保存の後の送信が stale ならその場で読み直す／
       15秒の見切りはログインの確かめを含む全体／帯が出ている間は60秒ごとに読み直し、消えたら止める（現場の端末では回さない）／
       応答が届いても控えを読めない・書けない時は帯を消さない
   ★本物のファイルを砂場で動かす。架空データのみ（氏名は使わない・入居者IDは記号）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(ROOT, f), 'utf8');
const SYNC = read('PATCH_SYNC_JS', 'su-patch-sync.js');
const PAGE = read('PATCH_HTML', 'patch-calendar.html');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const J = JSON.stringify;
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

const BAND_TEXT = 'サーバーに届かないため、この端末の控えを表示しています';
const AT0 = '2026-10-14T01:00:00.000Z', AT1 = '2026-10-15T01:00:00.000Z', AT2 = '2026-10-16T01:00:00.000Z';
const SESSION = { 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}' };
const res = r => J({ v: 1, r });
const ON = { patch_push: true, patch_read: true };
const ago = min => new Date(Date.now() - min * 60000).toISOString();   // 今から min 分前（送っている最中かの判定用）

/* 画面の関数を本物の HTML から切り出す（トップレベルの function 名(…) { … \n}） */
function grab(name) {
  const m = new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}').exec(PAGE);
  if (!m) throw new Error('画面に関数がありません: ' + name);
  return m[0];
}
const PAGE_FNS = ['pcIsField', 'pcBand', 'pcPull', 'pcPullApply', 'pcPullRetry', 'pcPush', 'pcPushed', 'readByRes', 'resSetting', 'parseISODate', 'parseNo', 'utcNoon', 'pcSetByOf'];

/* 砂場: 部品（su-patch-sync.js）と画面の関数を同じ localStorage で動かす。
   o.store・o.flags（su-backend.json の supabase。null＝読めない）・o.status（ログインの状態）・
   o.get（patch_get の応答を返す関数。Promise を返してもよい）・o.hang（patch_get が返ってこない）・o.hangAuth（ログインの確かめが返ってこない）・
   o.put（patch_put の応答を返す関数）・o.noWrite（apc2_res を書けない）・o.rid（選んでいる入居者ID）
   ivs は画面が回す定期の読み直し（setInterval）。tick() で1回分を進める */
function box(o) {
  o = o || {};
  const store = Object.assign({}, o.store || {});
  const writes = [], rpcs = [], appended = [], selected = [], ivs = [];
  const band = { hidden: true };
  const ls = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { if (o.noWrite && k === 'apc2_res') throw new Error('QuotaExceededError'); writes.push(k); store[k] = String(v); },
    removeItem: k => { writes.push('-' + k); delete store[k]; },
    key: i => Object.keys(store)[i]
  };
  Object.defineProperty(ls, 'length', { get: () => Object.keys(store).length });
  const auth = {
    STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out', DENIED: 'denied', ERROR: 'error' },
    check: () => (o.hangAuth ? new Promise(() => {}) : Promise.resolve({ status: o.status || 'ok' })),
    client: () => ({ rpc: (name, args) => {
      rpcs.push({ name, args });
      if (name === 'patch_get') {
        if (o.hang) return new Promise(() => {});
        return Promise.resolve().then(() => (o.get ? o.get(rpcs.length) : { data: { ok: true, ver: 1, rows: {} }, error: null }));
      }
      return Promise.resolve(o.put ? o.put(name, args) : { data: { ok: true, unchanged: true } });
    } })
  };
  const sb = {
    console, JSON, Math, Date, Number, String, Array, Object, Promise, Error, isFinite, isNaN, RegExp,
    clearTimeout,
    // 時間切れの試験（o.hang）だけ、15秒（patch_get の見切り）をすぐ来たことにする（試験を待たせない）。他の待ちは本物
    setTimeout: (fn, ms) => ((o.hang || o.hangAuth) && ms >= 15000 ? setImmediate(fn) : setTimeout(fn, ms)),
    setInterval: (fn, ms) => { ivs.push({ fn, ms, on: true }); return ivs.length; },
    clearInterval: id => { if (ivs[id - 1]) ivs[id - 1].on = false; },
    localStorage: ls,
    fetch: () => (o.flags === null ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: o.flags || ON }) })),
    document: {
      head: { appendChild(s) { appended.push(s.src); } },
      body: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      getElementsByTagName: () => [],
      getElementById: id => (id === 'svband' ? band : null)
    }
  };
  sb.window = sb;
  if (!o.noAuth) sb.SUAuth = auth;
  vm.createContext(sb);
  vm.runInContext(SYNC, sb, { filename: 'su-patch-sync.js' });
  const gen = ((/\nvar pcPullGen = [^\n]*/.exec(PAGE) || [''])[0]) + '\n' + ((/\nvar PC_RETRY_MS = [^\n]*/.exec(PAGE) || [''])[0]) + '\n';
  vm.runInContext(gen + "var LS_BYRES = 'apc2_res'; var CYCLE = 8; var state = { rid: " + J(o.rid || '') + " };\n" +
    'var __sel = [];\nfunction selectResident(r) { __sel.push(r); }\n' + PAGE_FNS.map(grab).join('\n'), sb, { filename: 'patch-calendar.html' });
  return { sb, store, writes, rpcs, appended, band, auth, ivs, live: () => ivs.filter(i => i.on),
    tick: async () => { ivs.filter(i => i.on).forEach(i => i.fn()); await settle(); }, sel: () => sb.__sel.slice(), api: sb.SUPatchSync,
    pull: async () => { vm.runInContext('pcPull()', sb); await settle(); }, run: s => vm.runInContext(s, sb) };
}
const rowsOf = b => { try { return JSON.parse(b.store.apc2_res).r; } catch (e) { return '壊れ'; } };
const gets = b => b.rpcs.filter(r => r.name === 'patch_get').length;
const ok = rows => () => ({ data: { ok: true, ver: 1, rows }, error: null });

(async () => {
  console.log('— A スイッチ —');
  {
    const st = Object.assign({ apc2_res: res({ a1: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 } }) }, SESSION);
    const srv = ok({ a1: { start: '2026-10-05', no: 6, prev: 5, by: 'y', at: AT2 } });
    for (const [label, flags] of [['項目が無い（patch_push だけ）', { patch_push: true }], ['false', { patch_push: true, patch_read: false }], ['文字の "true"', { patch_read: 'true' }]]) {
      const b = box({ store: st, flags, get: srv, rid: 'a1' });
      await b.pull();
      t('★A スイッチが ' + label + ' なら patch_get を呼ばず、控えも書かず、帯も出さない', gets(b) === 0 && !b.writes.some(k => /apc2_res/.test(k)) && b.band.hidden && b.sel().length === 0, { g: gets(b), w: b.writes });
    }
    const none = box({ store: st, flags: null, get: srv });
    await none.pull();
    t('A スイッチが読めず、前に読めた値も無ければ読まない（帯も出さない）', gets(none) === 0 && none.band.hidden);
    const lastOn = box({ store: Object.assign({ su_backend_flags: J({ supabase: ON }) }, st), flags: null, get: srv });
    await lastOn.pull();
    t('A（対照）読めない時は最後に読めた値（入）で読む', gets(lastOn) === 1);
    const noSess = box({ store: { apc2_res: st.apc2_res }, flags: { patch_push: true }, get: srv, noAuth: true });
    await noSess.pull();
    t('A スイッチ切ならログインの部品も読み込まない', noSess.appended.length === 0, noSess.appended);
    t('A 送るスイッチ（switchOn）の意味は変えない（patch_push のまま）', box({ flags: { patch_read: true } }).api.switchOn() === false);
  }

  console.log('\n— B 現場の端末 —');
  {
    const st = Object.assign({ su_device_role: 'field', apc2_res: res({ a1: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 } }) }, SESSION);
    const b = box({ store: st, get: ok({ a1: { start: '2026-10-05', no: 6, prev: 5, by: 'y', at: AT2 } }), rid: 'a1' });
    await b.pull();
    t('★B 現場の端末は patch_get を呼ばない', gets(b) === 0, b.rpcs);
    t('★B 現場の端末は帯を出さず、控えも書かない（今までどおり控えで表示）', b.band.hidden && !b.writes.some(k => /apc2_res/.test(k)) && b.sel().length === 0);
    const nl = box({ store: { su_device_role: 'field', apc2_res: st.apc2_res }, get: ok({}), noAuth: true });
    await nl.pull();
    t('B 現場の端末はログインが無くても帯を出さない・ログインの部品も読み込まない', nl.band.hidden && nl.appended.length === 0, nl.appended);
    const na = box({ store: st, get: ok({}), noAuth: true });
    await na.pull();
    t('★B 現場の端末はログインの控えがあっても、ログインの部品を読み込まない（確かめる前に止める）', na.appended.length === 0 && gets(na) === 0, na.appended);
  }

  console.log('\n— C 事務所PCで読んで表示する —');
  {
    const local = { a1: { start: '2026-10-01', no: 2, prev: 1, by: '職員甲', at: AT1 } };
    const srv = { a1: { start: '2026-10-05', no: 6, prev: 5, by: '職員乙', at: '2026-10-16T01:00:00+00:00', receivedAt: '2026-10-16T01:00:05+00:00' },
                  a2: { start: '2026-10-07', no: 3, prev: 0, by: '職員乙', at: '2026-10-16T02:00:00.123456+00:00', receivedAt: '2026-10-16T02:00:05+00:00' } };
    const b = box({ store: Object.assign({ apc2_res: res(local) }, SESSION), get: ok(srv), rid: 'a1' });
    await b.pull();
    const r = rowsOf(b);
    t('★C patch_get を1回呼ぶ', gets(b) === 1);
    t('★C 控えの値がサーバーの値になる（開始日・場所・前日の場所・設定した人）', r.a1 && r.a1.start === '2026-10-05' && r.a1.no === 6 && r.a1.prev === 5 && r.a1.by === '職員乙', r.a1);
    t('C サーバーにだけある方も控えに入る（新しい端末でもすぐ表示できる）', r.a2 && r.a2.start === '2026-10-07' && r.a2.no === 3, r.a2);
    t('C 日時は端末の書き方（toISOString）にそろえる', r.a1.at === AT2 && r.a2.at === '2026-10-16T02:00:00.123Z', [r.a1.at, r.a2.at]);
    t('C 控えに入れるのは5つ（受け取った時刻などは入れない）', J(Object.keys(r.a1).sort()) === J(['at', 'by', 'no', 'prev', 'start']), Object.keys(r.a1));
    t('★C 選んでいる方を描き直す（表示がサーバーの値になる）', J(b.sel()) === J(['a1']), b.sel());
    const shown = b.run("resSetting('a1')");
    t('★C 描き直しが読む値（resSetting）がサーバーの値', shown && shown.start.iso === '2026-10-05' && shown.no === 6 && shown.prev === 5, shown && { s: shown.start.iso, n: shown.no });
    t('C 帯は出さない', b.band.hidden);
    const other = box({ store: Object.assign({ apc2_res: res(local) }, SESSION), get: ok(srv), rid: 'zz' });
    await other.pull();
    t('C 選んでいる方が変わらなければ描き直さない（控えは書く）', other.sel().length === 0 && rowsOf(other).a1.no === 6);
    const same = box({ store: Object.assign({ apc2_res: res(local) }, SESSION), get: ok({ a1: { start: '2026-10-01', no: 2, prev: 1, by: '職員乙', at: AT2 } }), rid: 'a1' });
    await same.pull();
    t('C 値が同じなら控えを書かない・描き直さない', !same.writes.includes('apc2_res') && same.sel().length === 0, same.writes);
  }

  console.log('\n— D 手元のままにする方 —');
  {
    const local = {
      q1: { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: AT1 },     // 送信待ち
      lo: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 },     // サーバーに無い
      na: { start: '2026-10-01', no: 3, prev: 2 },                        // 日時の無い古い控え
      nw: { start: '2026-10-01', no: 4, prev: 3, by: 'x', at: ago(1) },  // 手元の方が新しい（1分前に保存・送っている最中）
      sv: { start: '2026-10-01', no: 5, prev: 4, by: 'x', at: AT0 }      // サーバーの方が新しい（対照）
    };
    const srv = {
      q1: { start: '2026-10-09', no: 8, prev: 7, by: 'y', at: AT2 },
      na: { start: '2026-10-09', no: 8, prev: 7, by: 'y', at: AT2 },
      nw: { start: '2026-10-09', no: 8, prev: 7, by: 'y', at: AT1 },
      sv: { start: '2026-10-09', no: 8, prev: 7, by: 'y', at: AT1 }
    };
    const b = box({ store: Object.assign({ apc2_res: res(local), apc2_sync_q: J({ v: 1, q: { q1: AT1 } }) }, SESSION), get: ok(srv) });
    await b.pull();
    const r = rowsOf(b);
    t('★D 送信待ちの方は手元の値のまま', J(r.q1) === J(local.q1), r.q1);
    t('★D サーバーに無い方は手元のまま（消さない）', J(r.lo) === J(local.lo), r.lo);
    t('★D 日時の無い古い控えは手元のまま', J(r.na) === J(local.na), r.na);
    t('★D 手元の日時の方が新しく10分以内の方（保存の直後で送っている最中）は手元のまま', J(r.nw) === J(local.nw), r.nw);
    t('D（対照）サーバーの方が新しい方はサーバーの値', r.sv.no === 8 && r.sv.at === AT1, r.sv);
    t('D 送信待ちは書き換えない', b.store.apc2_sync_q === J({ v: 1, q: { q1: AT1 } }));
    const m = box({}).api.merge(local, srv, ['q1']);
    t('D 混ぜる関数（merge）は変わった方だけを返す', J(m.changed) === J(['sv']), m.changed);
  }

  console.log('\n— E 届かない時は控えを消さず帯を出す —');
  {
    const local = { a1: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 }, a2: { start: '2026-10-02', no: 3, prev: 2, by: 'x', at: AT1 } };
    const st = Object.assign({ apc2_res: res(local) }, SESSION);
    const cases = [
      ['空の応答（行が0）', { get: ok({}) }, false],
      ['応答が null', { get: () => ({ data: null, error: null }) }, true],
      ['ok が false', { get: () => ({ data: { ok: false }, error: null }) }, true],
      ['rows が配列', { get: () => ({ data: { ok: true, ver: 1, rows: [] }, error: null }) }, true],
      ['rows が無い', { get: () => ({ data: { ok: true, ver: 1 }, error: null }) }, true],
      ['42501（許可が無い）', { get: () => ({ data: null, error: { code: '42501', message: 'not allowed' } }) }, true],
      ['ほかのエラー', { get: () => ({ data: null, error: { message: 'Failed to fetch' } }) }, true],
      ['通信の失敗（例外）', { get: () => { throw new Error('offline'); } }, true],
      ['返ってこない（時間切れ）', { hang: true }, true],
      ['ログインの控えが無い', { store: { apc2_res: res(local) } }, true],
      ['ログインを確かめられない', { status: 'signed_out' }, true]
    ];
    for (const [label, opt, banner] of cases) {
      const b = box(Object.assign({ store: st }, opt));
      await b.pull();
      t((banner ? '★E ' : 'E ') + label + ': 控えを書かない（消さない）' + (banner ? '・帯を出す' : '・届いたので帯は出さない'),
        b.store.apc2_res === st.apc2_res && !b.writes.includes('apc2_res') && b.band.hidden === !banner, { w: b.writes, hidden: b.band.hidden });
    }
    const nosess = box({ store: { apc2_res: res(local) } });
    await nosess.pull();
    t('E ログインの控えが無い時は patch_get を呼ばない', gets(nosess) === 0);
    const m = /<p class="([^"]*)" id="svband"([^>]*)>([^<]*)<\/p>/.exec(PAGE);
    t('★E 帯の文言はこのまま（代表者の決定の文言）', !!m && m[3] === BAND_TEXT, m && m[3]);
    t('E 帯は読み上げに伝わる（role="status"）', !!m && /role="status"/.test(m[2]));
    // 届いたら帯が消える
    let down = true;
    const b = box({ store: st, get: () => (down ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true, ver: 1, rows: { a1: { start: '2026-10-09', no: 7, prev: 6, by: 'y', at: AT2 } } }, error: null }), rid: 'a1' });
    await b.pull();
    t('E 1回目は届かず帯が出る', !b.band.hidden);
    down = false;
    b.run('pcPullRetry()'); await settle();
    t('★E 読み直して届いたら帯が消え、サーバーの値で描き直す', b.band.hidden && rowsOf(b).a1.no === 7 && J(b.sel()) === J(['a1']), { h: b.band.hidden, s: b.sel() });
    const n0 = gets(b);
    b.run('pcPullRetry()'); await settle();
    t('E 帯が出ていない時は読み直さない（読み直すのは帯が出ている間だけ）', gets(b) === n0);
  }

  console.log('\n— F 遅れて届いた応答を捨てる —');
  {
    const local = { a1: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT0 } };
    const st = Object.assign({ apc2_res: res(local) }, SESSION);
    let release1;
    const first = new Promise(r => { release1 = r; });
    const b = box({ store: st, rid: 'a1', get: n => (n === 1
      ? first
      : { data: { ok: true, ver: 1, rows: { a1: { start: '2026-10-05', no: 5, prev: 4, by: 'y', at: AT2 } } }, error: null }) });
    b.run('pcPull()'); await settle();
    b.run('pcPull()'); await settle();
    t('F 2回目の応答で描き直す', rowsOf(b).a1.no === 5);
    release1({ data: { ok: true, ver: 1, rows: { a1: { start: '2026-10-03', no: 3, prev: 2, by: 'z', at: AT1 } } }, error: null });
    await settle();
    t('★F 1回目（古い世代）の応答が後から届いても使わない', rowsOf(b).a1.no === 5 && J(b.sel()) === J(['a1']), { r: rowsOf(b).a1, s: b.sel() });
    // 古い世代の「届かない」も帯を出さない
    const b2 = box({ store: st });
    b2.run('pcPullGen = 2; pcPullApply({ status: "unreachable" }, 1)');
    t('F 古い世代の「届かない」でも帯を出さない', b2.band.hidden);
    // 用途が現場へ変わった後に届いた応答
    let release2;
    const late = new Promise(r => { release2 = r; });
    const c = box({ store: st, rid: 'a1', get: () => late });
    c.run('pcPull()'); await settle();
    t('F（前提）呼んだ時は事務所PC', gets(c) === 1);
    c.store.su_device_role = 'field';
    release2({ data: { ok: true, ver: 1, rows: { a1: { start: '2026-10-05', no: 5, prev: 4, by: 'y', at: AT2 } } }, error: null });
    await settle();
    let release3;
    const late3 = new Promise(r => { release3 = r; });
    const m3 = box({ store: st, get: () => late3 });
    const pr3 = m3.api.pull(); await settle();
    m3.store.su_device_role = 'field';
    release3({ data: { ok: true, ver: 1, rows: {} }, error: null });
    const got3 = await pr3;
    t('★F 部品も、待っている間に現場へ変わったら応答を返さない（field）', got3 && got3.status === 'field' && !('rows' in got3), got3);
    t('★F 用途が現場へ変わった後に届いた応答は使わない（控えを書かない・描き直さない・帯も出さない）', !c.writes.includes('apc2_res') && c.sel().length === 0 && c.band.hidden, { w: c.writes, s: c.sel(), h: c.band.hidden });
    // 部品を通さずに画面だけで確かめる（部品の確かめが外れても画面が捨てる）
    const d = box({ store: Object.assign({ su_device_role: 'field' }, st), rid: 'a1' });
    d.run('pcPullApply({ status: "ok", rows: { a1: { start: "2026-10-05", no: 5, prev: 4, by: "y", at: "' + AT2 + '" } } }, pcPullGen)');
    t('F 画面も届いた時に用途を読み直して捨てる', !d.writes.includes('apc2_res') && d.band.hidden);
    const e = box({ store: Object.assign({ su_device_role: 'field' }, st) });
    e.run('pcPullApply({ status: "unreachable" }, pcPullGen)');
    t('F 現場の端末では「届かない」が届いても帯を出さない', e.band.hidden);
    // 画面のつなぎ: 用途が現場へ変わったら世代を進めて読み込み直す
    const h = /window\.addEventListener\('storage', function \(e\) \{\n  if \(!e \|\| !e\.key\) return;\n  if \(e\.key === 'su_device_role' && e\.newValue === 'field'\) \{\n    pcPullGen\+\+;\n    if \([^\n]*readSwitchOn\(\)\) \{ try \{ location\.reload\(\); \}/.exec(PAGE);
    t('★F 用途が現場へ変わったら世代を進め、読むスイッチが入なら読み込み直す（CLAUDE.md §2-5）', !!h);
  }

  console.log('\n— G 印刷・最初の表示 —');
  {
    const m = /<p class="([^"]*)" id="svband"([^>]*)>/.exec(PAGE);
    t('★G 帯は最初は出ていない（hidden）', !!m && /\shidden(\s|$)/.test(m[2]), m && m[2]);
    t('G 帯は画面だけの部品（noprint）', !!m && /\bnoprint\b/.test(m[1]));
    const pr = PAGE.indexOf('@media print {'), prEnd = PAGE.indexOf('\n}', pr);
    const block = pr > 0 ? PAGE.slice(pr, prEnd) : '';
    t('★G 印刷では帯を消す（@media print の中で display:none）', /\.noprint \{ display: none !important; \}/.test(block) && /\.svband \{ display: none !important; \}/.test(block), block);
    t('G 帯は紙の中（#sheet）に置かない', PAGE.indexOf('id="svband"') < PAGE.indexOf('id="sheet"') && PAGE.indexOf('id="svband"') > PAGE.indexOf('<div class="ctl noprint">'));
    const boot = PAGE.indexOf('/* ── 起動 ── */');
    const firstRender = PAGE.indexOf('\nrender();', boot), call = PAGE.indexOf('\npcPull();', boot);
    t('★G 開いた時はまず控えで描き、その後に読む（起動の render の後に pcPull を1回）', boot > 0 && firstRender > boot && call > firstRender && (PAGE.match(/\npcPull\(\);/g) || []).length === 1);
  }

  console.log('\n— H 送るもの・書くもの —');
  {
    const local = { a1: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT0 } };
    const b = box({ store: Object.assign({ apc2_res: res(local) }, SESSION), get: ok({ a1: { start: '2026-10-05', no: 5, prev: 4, by: 'y', at: AT2 } }) });
    await b.pull();
    const g = b.rpcs.find(r => r.name === 'patch_get');
    t('★H patch_get には何も渡さない（氏名も入居者IDも送らない）', g && g.args === undefined, g);
    t('H 書くのは控え（apc2_res）とスイッチの控えだけ', b.writes.every(k => /^(apc2_res|su_backend_flags)$/.test(k)), b.writes);
    t('H 読むだけでは送らない（patch_put を呼ばない）', !b.rpcs.some(r => /patch_put/.test(r.name)));
    const bad = box({ store: Object.assign({ apc2_res: '{こわれた' }, SESSION), get: ok({ a1: { start: '2026-10-05', no: 5, prev: 4, by: 'y', at: AT2 } }) });
    await bad.pull();
    t('★H 控えが読めない（壊れている）時は書かない', bad.store.apc2_res === '{こわれた' && !bad.writes.includes('apc2_res'));
    const api = box({}).api;
    const keep = { a1: local.a1, junk: 'x' };
    const mm = api.merge(keep, {
      'あ': { start: '2026-10-05', no: 5, prev: 4, by: 'y', at: AT2 },
      b1: { start: '2026-02-30', no: 5, prev: 4, by: 'y', at: AT2 },
      b2: { start: '2026-10-05', no: 9, prev: 4, by: 'y', at: AT2 },
      b3: { start: '2026-10-05', no: 5, prev: -1, by: 'y', at: AT2 },
      b4: { start: '2026-10-05', no: '5', prev: 4, by: 'y', at: AT2 },
      b5: { start: '2026-10-05', no: 5, prev: 4, by: 'y' },
      b6: null,
      ok1: { start: '2026-10-05', no: 5, prev: 4, at: AT2 }
    }, []);
    t('★H 形の違う行（ID・開始日・場所・前日の場所・日時）は使わない', J(mm.changed) === J(['ok1']), mm.changed);
    t('H 設定した人が無い行は空の文字にする', mm.merged.ok1 && mm.merged.ok1.by === '', mm.merged.ok1);
    t('H 控えの方は消さない（読めない欄も残す）', mm.merged.a1 === local.a1 && mm.merged.junk === 'x');
    const e1 = api.merge(local, null, []), e2 = api.merge(local, [], []), e3 = api.merge(null, { a1: local.a1 }, []);
    t('H 形の違う rows では何も変えない', e1.changed.length === 0 && e2.changed.length === 0 && J(e1.merged) === J(local));
    t('H 控えが無くてもサーバーの行を入れられる', J(e3.changed) === J(['a1']));
    t('H 部品は氏名の名簿（su_residents_common）を読まない・画面の描画に触れない', SYNC.indexOf('su_residents_common') < 0 && !/render\(|selectResident|innerHTML|textContent|svband/.test(SYNC));
  }

  console.log('\n— I 反証レビューの直し（2026-10-25）—');
  {
    const api = box({}).api, now = Date.parse('2026-10-25T03:00:00.000Z');
    const srvAt = '2026-10-25T02:00:00.000Z';
    const S = { start: '2026-10-20', no: 7, prev: 6, by: 'y', at: srvAt };
    const L = at => ({ start: '2026-10-01', no: 2, prev: 1, by: 'x', at });
    const m1 = api.merge({ a: L(srvAt) }, { a: S }, [], {}, now);
    t('★I 日時が同じで値が違う時はサーバーの値（サーバーは stale で自分の値を残す）', J(m1.changed) === J(['a']) && m1.merged.a.no === 7, m1.changed);
    const fresh = '2026-10-25T02:55:00.000Z', old = '2026-10-25T02:40:00.000Z';
    const m1b = api.merge({ a: L(fresh) }, { a: Object.assign({}, S, { at: fresh }) }, [], {}, now);
    t('★I 日時が同じで値が違う時は、保存の直後（10分以内）でもサーバーの値', J(m1b.changed) === J(['a']) && m1b.merged.a.no === 7, m1b.changed);
    const m2 = api.merge({ a: L(fresh) }, { a: S }, [], {}, now);
    t('★I 手元の方が新しく今から10分以内（送っている最中）は手元のまま', m2.changed.length === 0, m2.changed);
    const m3 = api.merge({ a: L(old) }, { a: S }, [], {}, now);
    t('★I 手元の方が新しくても10分より前の値はサーバーの値', J(m3.changed) === J(['a']) && m3.merged.a.no === 7, m3.changed);
    for (const e of ['futureat', 'badstart', 'badno', 'badat']) {
      const m4 = api.merge({ a: L(fresh) }, { a: S }, [], { a: { e, at: fresh, t: fresh } }, now);
      t('★I ' + e + ' で断られた手元の値はサーバーの値', J(m4.changed) === J(['a']), m4.changed);
    }
    const m5 = api.merge({ a: L(fresh) }, { a: S }, [], { a: { e: 'badno', at: old, t: old } }, now);
    t('I 前の日時の断りは今の値に効かない（10分以内は手元のまま）', m5.changed.length === 0);
    const m6 = api.merge({ a: L(old) }, { a: S }, ['a'], {}, now);
    t('I 送信待ちにある方は10分より前でも手元のまま', m6.changed.length === 0);
    const fut = '2026-10-25T05:00:00.000Z';
    const m7 = api.merge({ a: L(fut) }, { a: S }, [], { a: { e: 'futureat', at: fut, t: fut } }, now);
    t('I 未来の日時で断られた手元の値はサーバーの値', J(m7.changed) === J(['a']));

    // 画面: 控え全体で（断りの記録も読む）
    const atF = ago(1);
    const fst = Object.assign({ apc2_res: res({ a1: L(atF) }), apc2_sync_ng: J({ v: 1, r: { a1: { e: 'futureat', at: atF, t: AT1 } } }) }, SESSION);
    const fb = box({ store: fst, get: ok({ a1: S }), rid: 'a1' });
    await fb.pull();
    t('★I 画面も断りの記録（apc2_sync_ng）を渡して、断られた手元の値をサーバーの値にする', rowsOf(fb).a1.no === 7 && J(fb.sel()) === J(['a1']), rowsOf(fb).a1);

    // stale の後に読み直す
    const st0 = Object.assign({ apc2_res: res({ a1: L(ago(0.5)) }) }, SESSION);
    const sb1 = box({ store: st0, rid: 'a1', put: () => ({ data: { ok: true, stale: true }, error: null }), get: ok({ a1: Object.assign({}, S, { at: new Date().toISOString() }) }) });
    sb1.run("pcPush('a1')"); await settle(); await new Promise(r => setTimeout(r, 30)); await settle();
    t('★I 保存の後の送信が stale なら、その場で読み直して表示をサーバーの値にそろえる', gets(sb1) === 1 && rowsOf(sb1).a1.no === 7 && J(sb1.sel()) === J(['a1']), { g: gets(sb1), r: rowsOf(sb1).a1 });
    const sb2 = box({ store: st0, rid: 'a1', put: () => ({ data: { ok: true, written: true }, error: null }), get: ok({ a1: S }) });
    sb2.run("pcPush('a1')"); await settle(); await new Promise(r => setTimeout(r, 30)); await settle();
    t('I（対照）書けた（written）時は読み直さない', gets(sb2) === 0);
    const sb3 = box({ store: st0, flags: { patch_push: true }, rid: 'a1', put: () => ({ data: { ok: true, stale: true }, error: null }), get: ok({ a1: S }) });
    sb3.run("pcPush('a1')"); await settle(); await new Promise(r => setTimeout(r, 30)); await settle();
    t('I 読むスイッチが切なら stale でも読まない', gets(sb3) === 0 && sb3.band.hidden);
    const sb4 = box({ store: Object.assign({ su_device_role: 'field' }, st0), rid: 'a1', put: () => ({ data: { ok: true, stale: true }, error: null }), get: ok({ a1: S }) });
    sb4.run("pcPush('a1')"); await settle(); await new Promise(r => setTimeout(r, 30)); await settle();
    t('I 現場の端末は stale でも読まない', gets(sb4) === 0 && sb4.band.hidden);

    // ログインの確かめが返らない時に15秒で帯
    const ha = box({ store: Object.assign({ apc2_res: res({ a1: L(AT1) }) }, SESSION), hangAuth: true, noAuth: false });
    await ha.pull();
    t('★I ログインの確かめ（SUAuth.check）が返らない時も15秒で見切って帯を出す（patch_get は呼ばない）', !ha.band.hidden && gets(ha) === 0, { h: ha.band.hidden, g: gets(ha) });

    // 帯が出ている間の定期の読み直し
    let down = true;
    const pb = box({ store: Object.assign({ apc2_res: res({ a1: L(AT1) }) }, SESSION), rid: 'a1',
      get: () => (down ? { data: null, error: { message: 'Failed to fetch' } } : { data: { ok: true, ver: 1, rows: { a1: S } }, error: null }) });
    await pb.pull();
    t('★I 帯が出ると60秒ごとの読み直しを1本だけ回す', !pb.band.hidden && pb.live().length === 1 && pb.live()[0].ms === 60000, pb.ivs);
    await pb.tick();
    t('I 届かない間は60秒ごとに読み直し続ける（1本のまま）', gets(pb) === 2 && pb.live().length === 1 && !pb.band.hidden);
    down = false;
    await pb.tick();
    t('★I 届いたら帯が消え、定期の読み直しが止まる', pb.band.hidden && pb.live().length === 0 && rowsOf(pb).a1.no === 7, { h: pb.band.hidden, live: pb.live().length });
    const n = gets(pb);
    pb.ivs.forEach(i => i.fn()); await settle();
    t('I 止めた後に古い呼び出しが来ても、帯が出ていなければ読まない', gets(pb) === n);
    const fd = box({ store: Object.assign({ su_device_role: 'field', apc2_res: res({ a1: L(AT1) }) }, SESSION) });
    fd.run('pcBand(true)');
    t('I 現場の端末では定期の読み直しを回さない', fd.live().length === 0);
    const g0 = fd.run('pcPullGen');
    fd.run('pcPullRetry()'); await settle();
    t('I 現場の端末では帯が出ていても読み直さない（読む処理を始めない）', gets(fd) === 0 && fd.run('pcPullGen') === g0);

    // 控えに書けない・読めない時は帯を消さない
    const nw = box({ store: Object.assign({ apc2_res: res({ a1: L(AT1) }) }, SESSION), rid: 'a1', noWrite: true, get: ok({ a1: S }) });
    nw.run('pcBand(true)');
    await nw.pull();
    t('★I 応答は届いたが控えに書けない時は帯を消さない', !nw.band.hidden && nw.sel().length === 0, { h: nw.band.hidden });
    const nr = box({ store: Object.assign({ apc2_res: '{こわれた' }, SESSION), get: ok({ a1: S }) });
    nr.run('pcBand(true)');
    await nr.pull();
    t('★I 応答は届いたが控えを読めない時は帯を消さない', !nr.band.hidden);
    const nc = box({ store: Object.assign({ apc2_res: res({ a1: S }) }, SESSION), get: ok({ a1: S }) });
    nc.run('pcBand(true)');
    await nc.pull();
    t('I（対照）届いて変わる方がいない時は帯を消す', nc.band.hidden && nc.live().length === 0);
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  finished = true;
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); finished = true; process.exit(2); });
