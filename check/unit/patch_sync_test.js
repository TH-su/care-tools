/* 貼り薬カレンダーの設定を Supabase へ送る部品（su-patch-sync.js・段階2「送るだけ」）の試験（2026-10-17 新設）
   実行: node check/unit/patch_sync_test.js
   対象を差し替える（壊した版で落ちることを確かめる）:
     PATCH_SYNC_JS=/tmp/変異版.js node check/unit/patch_sync_test.js
     PATCH_HTML=/tmp/変異版.html  SHADOW_JS=/tmp/変異版.js も同じ

   守ること:
     A 送る中身は6つ（入居者ID・開始日・場所・前日の場所・設定した人・日時）だけ。氏名のキーは送らない
     B スイッチ（su-backend.json の supabase.patch_push）が false・読めない時は何も送らない（送信待ちにも残さない）
     C 日時の無い古い設定・手入力の設定（apc2_start/no/prev/setby）・移し済みの印（apc2_res_moved）は送らない
     D 送れなかった分は送信待ちに残り、ok（書いた・作った・同じ・サーバーの方が新しい）を受け取った時だけ外れる。
       送っている間に保存し直された分は外さない
     E 形の断り（bad*・futureat）は送信待ちから外して記録だけ残す。同じ日時の設定は送り直さない
     F ログインの控えが無い・確かめられない端末は黙って送らない（帯を出さない・ログインの部品も読み込まない）
     G ログインの部品（supabase-js・su-auth.js）を二重に読まない（札があれば入れ直さず待つ）
     H 起動時の送信（pushAll）は控え（apc2_res）を書き換えず、画面の表示にも触れない。読み込んだだけでは何も送らない
     I 写しの見比べの差の数え方（端末だけ・サーバーだけ・違う・日時なしは別）と、その画面のつなぎ（読むだけ・IDだけ）
     J 画面のつなぎ（保存の後・起動の後に送る・スイッチは false で出す・公開の許可リスト）
     K 反証レビューの直し（2026-10-17）: スイッチ切の時はログインの部品も足さない・写しの見比べはスイッチ切の間 warn にしない・
       形で断られた方を差と断りの欄で二重に数えない・中身の違いを日時で「未送信」と「ほかの端末で新しい」に分ける・
       送信済みの控え（apc2_sync_sent）で起動時の送り直しを止める（同じ日時は送らない・新しい日時は送る・控えが壊れていたら全員）
     L 現場の端末と権限の断り（2026-10-22 代表者の決定）: 現場の端末（su_device_role=field）は開いた後に全員分を送らず送信待ちの方だけ・
       保存の後は送る／権限の断り（42501）は送信待ちに残して denied を記録し、保存の後は送り直さず、開いた時（現場も事務所も）に1回送り直す・
       載ったら denied の記録を外す
     M まとめて送る（統合 0021・2026-10-24 代表者の決定）: 開いた後の送信は patch_put_many を1往復（50人ずつに分ける）・
       中身は1人ずつの時と同じ6つ・載らなかった方だけ送信待ちに残る・全体の失敗は全員に同じ扱い・
       関数が無い時（古いデータベース）はその画面を開いている間だけ1人ずつ patch_put に戻る・保存の後の送信は1人ずつのまま
   ★本物のファイルを砂場で動かす。架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(ROOT, f), 'utf8');
const SYNC = read('PATCH_SYNC_JS', 'su-patch-sync.js');
const PAGE = read('PATCH_HTML', 'patch-calendar.html');
const SHJS = read('SHADOW_JS', 'shadow-check.js');
const SHHTML = fs.readFileSync(path.join(ROOT, 'shadow-check.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const J = JSON.stringify;
/* 待ちが解けずに途中で止まった（送る処理が返ってこない）時、node は黙って終了コード 0 で終わる。それを成功にしない */
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました（返ってこない待ちがある）'); process.exitCode = 3; } });

const AT1 = '2026-10-15T01:00:00.000Z', AT2 = '2026-10-16T01:00:00.000Z';
/* 砂場: o.store（localStorage の中身）・o.flags（su-backend.json の supabase。null＝読めない）・o.status（ログインの状態）・
   o.reply（patch_put の応答を返す関数）・o.tags（すでにある札）・o.noAuth（SUAuth をまだ持たない）・
   o.noMany（patch_put_many が無い古いデータベース＝PGRST202 を返す。'42883' ならその code・'msg' なら code なしで文言だけ）・
   o.manyReply（patch_put_many の応答をそのまま返す関数。無ければデータベースと同じく、中で1人ずつ o.reply に通して配列で返す）
   calls はデータベースの patch_put が受けた1人分ずつ（まとめて送った分も1人ずつ並ぶ・many:true）、rpcs は往復そのもの */
function box(o) {
  o = o || {};
  const store = Object.assign({}, o.store || {});
  const writes = [], calls = [], rpcs = [], appended = [], bodyAdds = [], els = [];
  const tags = (o.tags || []).slice();
  const ls = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: k => { writes.push('-' + k); delete store[k]; },
    key: i => Object.keys(store)[i]
  };
  Object.defineProperty(ls, 'length', { get: () => Object.keys(store).length });
  const auth = {
    STATUS: { OK: 'ok', SIGNED_OUT: 'signed_out', DENIED: 'denied', MFA_VERIFY: 'mfa_verify', MFA_ENROLL: 'mfa_enroll', ERROR: 'error' },
    check: () => Promise.resolve({ status: o.status || 'ok', role: 'field' }),
    client: () => ({ rpc: (name, args) => {
      const reply = o.reply || (() => ({ data: { ok: true, written: true } }));
      rpcs.push({ name, args });
      if (name === 'patch_put_many') {
        if (o.noMany) return Promise.resolve({ data: null, error: o.noMany === 'msg' ? { message: 'Could not find the function public.patch_put_many(items) in the schema cache' }
          : { code: o.noMany === '42883' ? '42883' : 'PGRST202', message: 'Could not find the function public.patch_put_many(items) in the schema cache' } });
        if (o.manyReply) return Promise.resolve().then(() => o.manyReply(args, rpcs.length));
        // データベース（0021）と同じく、中で1人ずつ patch_put を呼んだ応答を並べる。呼び出しの失敗（通信・42501）が1つでもあれば全体の失敗
        const rs = (args.items || []).map(a => { calls.push({ name: 'patch_put', args: a, many: true }); return reply('patch_put', a, calls.length); });
        const er = rs.find(x => x && x.error);
        return Promise.resolve(er ? { data: null, error: er.error } : { data: rs.map(x => x.data), error: null });
      }
      calls.push({ name, args }); return Promise.resolve(reply(name, args, calls.length));
    } })
  };
  const sb = {
    console, JSON, Math, Date, Number, String, Array, Object, Promise, Error, isFinite, isNaN, setTimeout, clearTimeout,
    localStorage: ls,
    fetch: () => (o.flags === null ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true, json: () => Promise.resolve({ supabase: o.flags || { patch_push: true } }) })),
    document: {
      head: { appendChild(s) { appended.push(s.src); tags.push(s.src); els.push(s); } },
      body: { appendChild(x) { bodyAdds.push(x); } },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      getElementsByTagName: () => tags.map(src => ({ getAttribute: () => src }))
    }
  };
  sb.window = sb;
  if (!o.noAuth) sb.SUAuth = auth;
  vm.createContext(sb);
  vm.runInContext(SYNC, sb, { filename: 'su-patch-sync.js' });
  return { sb, store, writes, calls, rpcs, appended, bodyAdds, els, auth, api: sb.SUPatchSync };
}
const SESSION = { 'sb-jhbernqawjrzqwrmqrih-auth-token': '{}' };
const res = r => J({ v: 1, r });
const q = b => { try { return Object.keys(JSON.parse(b.store.apc2_sync_q || '{"q":{}}').q).sort(); } catch (e) { return ['壊れ']; } };
const ng = b => { try { return JSON.parse(b.store.apc2_sync_ng || '{"r":{}}').r; } catch (e) { return { 壊れ: 1 }; } };

(async () => {
  console.log('— A 送る中身 —');
  {
    const b = box({ store: Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 1, by: '職員甲', at: AT1, name: '見本 甲', nm: '見本 甲', kana: 'みほん' } }) }, SESSION) });
    await b.api.pushOne('r1'); await settle();
    const a = b.calls[0] && b.calls[0].args;
    t('★A patch_put を1回だけ呼ぶ', b.calls.length === 1 && b.calls[0].name === 'patch_put', b.calls);
    t('★A 送る中身は6つのキーだけ（氏名・かなのキーは無い）', a && J(Object.keys(a).sort()) === J(['p_at', 'p_by', 'p_no', 'p_prev', 'p_resident_id', 'p_start']), a);
    t('A 値は控えのまま（入居者IDは控えのキー）', a && a.p_resident_id === 'r1' && a.p_start === '2026-10-01' && a.p_no === 2 && a.p_prev === 1 && a.p_by === '職員甲' && a.p_at === AT1, a);
    t('A 送った中身に氏名の文字が無い', a && J(a).indexOf('見本') < 0 && J(a).indexOf('みほん') < 0);
    const b2 = box({ store: Object.assign({ apc2_res: res({ r2: { start: '2026-10-01', no: '3', at: AT1, by: 'あ'.repeat(82) } }) }, SESSION) });
    await b2.api.pushOne('r2'); await settle();
    const a2 = b2.calls[0] && b2.calls[0].args;
    t('A 前日の場所が無い設定は0（画面の読み方と同じ）・場所は数に直す', a2 && a2.p_prev === 0 && a2.p_no === 3, a2);
    t('A 設定した人は60字までに切る（ログインの表示名は82字になりうる・画面の pcSetByOf と同じ）', a2 && a2.p_by.length === 60, a2 && a2.p_by.length);
  }

  console.log('\n— B スイッチ —');
  {
    const st = Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 } }) }, SESSION);
    const off = box({ store: st, flags: { patch_push: false } });
    await off.api.pushOne('r1'); await off.api.pushAll(); await settle();
    t('★B スイッチが false なら何も送らない', off.calls.length === 0, off.calls);
    t('B スイッチが false なら送信待ちにも残さない（控えに何も書かない）', !off.writes.some(k => /apc2_/.test(k)), off.writes);
    const none = box({ store: st, flags: null });
    await none.api.pushAll(); await settle();
    t('★B スイッチが読めず、前に読めた値も無ければ送らない', none.calls.length === 0, none.calls);
    const lastOff = box({ store: Object.assign({ su_backend_flags: J({ supabase: { patch_push: false } }) }, st), flags: null });
    await lastOff.api.pushAll(); await settle();
    t('B 読めない時は最後に読めた値（false）＝送らない', lastOff.calls.length === 0);
    const lastOn = box({ store: Object.assign({ su_backend_flags: J({ supabase: { patch_push: true } }) }, st), flags: null });
    await lastOn.api.pushAll(); await settle();
    t('B（対照）最後に読めた値が true なら送る（su-kv.js と同じ読み方）', lastOn.calls.length === 1);
    const freshOff = box({ store: Object.assign({ su_backend_flags: J({ supabase: { patch_push: true } }) }, st), flags: { patch_push: false } });
    await freshOff.api.pushAll(); await settle();
    t('B 新しく読めた値（false）が前の値（true）より優先', freshOff.calls.length === 0);
    const strTrue = box({ store: st, flags: { patch_push: 'true' } });
    await strTrue.api.pushAll(); await settle();
    t('B true（真偽）以外は切とみなす', strTrue.calls.length === 0);
    const missing = box({ store: st, flags: { care_schedule_v2: true } });
    await missing.api.pushAll(); await settle();
    t('B スイッチの項目が無ければ送らない', missing.calls.length === 0);
  }

  console.log('\n— C 送らない設定 —');
  {
    const b = box({ store: Object.assign({
      apc2_res: res({
        old: { start: '2026-09-01', no: 1, prev: 0 },                         // 2026-10-11 より前の形（日時なし）
        bad: { start: '2026-09-01', no: 1, prev: 0, by: 'x', at: 'こわれた' },
        ok1: { start: '2026-10-01', no: 4, prev: 3, by: 'x', at: AT1 }
      }),
      apc2_start: '2026-08-10', apc2_no: '5', apc2_prev: '2', apc2_setby: J({ by: '職員甲', at: AT1 }), apc2_res_moved: 'mv1'
    }, SESSION) });
    await b.api.pushAll(); await settle();
    const ids = b.calls.map(c => c.args.p_resident_id);
    t('★C 日時の無い古い設定・日時の読めない設定は送らない', J(ids) === J(['ok1']), ids);
    t('★C 手入力の設定・移し済みの印は送らない（入居者IDを持たない）', ids.indexOf('mv1') < 0 && !b.calls.some(c => c.args.p_start === '2026-08-10'));
    await b.api.pushOne('old'); await settle();
    t('C 日時の無い方を保存の経路で渡されても送らない（送信待ちにも残さない）', b.calls.length === 1 && q(b).indexOf('old') < 0, q(b));
    const b2 = box({ store: Object.assign({ apc2_res: res({ old: { start: '2026-09-01', no: 1, prev: 0 } }), apc2_sync_q: J({ v: 1, q: { old: AT1 } }) }, SESSION) });
    await b2.api.pushAll(); await settle();
    t('C 送信待ちに残っていても、今の控えに日時が無ければ送らず外す', b2.calls.length === 0 && q(b2).length === 0, q(b2));
  }

  console.log('\n— D 送信待ちと完了 —');
  {
    const st = Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 }, r2: { start: '2026-10-02', no: 3, prev: 2, by: 'x', at: AT1 } }) }, SESSION);
    const net = box({ store: st, reply: () => ({ error: { message: 'Failed to fetch' } }) });
    await net.api.pushAll(); await settle();
    t('★D 通信の失敗は送信待ちに残る', J(q(net)) === J(['r1', 'r2']), q(net));
    const den = box({ store: st, reply: () => ({ error: { code: '42501', message: 'not allowed' } }) });
    await den.api.pushOne('r1'); await settle();
    t('D 断り（42501・許可リストに無い・ログインの切れ）は送信待ちに残し、denied を記録する（2026-10-22・L を参照）', J(q(den)) === J(['r1']) && ng(den).r1 && ng(den).r1.e === 'denied', { q: q(den), ng: ng(den) });
    const odd = box({ store: st, reply: () => ({ data: { ok: false, error: 'something' } }) });
    await odd.api.pushOne('r1'); await settle();
    t('D 知らない断りは外さない（送信待ちに残す）', J(q(odd)) === J(['r1']), q(odd));
    for (const kind of ['written', 'created', 'unchanged', 'stale']) {
      const b = box({ store: Object.assign({}, st, { apc2_sync_q: J({ v: 1, q: { r1: AT1, r2: AT1 } }) }), reply: (n, a) => ({ data: Object.assign({ ok: true }, { [kind]: true }) }) });
      await b.api.pushOne('r1'); await settle();
      t('★D 応答 ' + kind + ' を受け取ったら送信待ちから外れる（保存の時は送信待ちの方も送る）', q(b).length === 0 && b.calls.length === 2, { q: q(b), n: b.calls.length });
    }
    // 失敗→次の保存で送り直して外れる
    let fails = true;
    const b = box({ store: st, reply: () => (fails ? { error: { message: 'Failed to fetch' } } : { data: { ok: true, unchanged: true } }) });
    await b.api.pushOne('r1'); await settle();
    t('D 1回目は失敗して残る', J(q(b)) === J(['r1']));
    fails = false;
    await b.api.pushOne('r2'); await settle();
    t('★D 次の保存で送信待ちの分も送り直し、届いたら外れる', q(b).length === 0 && b.calls.filter(c => c.args.p_resident_id === 'r1').length === 2, b.calls.map(c => c.args.p_resident_id));
    // 送っている間に保存し直された分は外さない
    const b3 = box({ store: Object.assign({}, st), reply: (n, a, i) => {
      if (i === 1) { b3.store.apc2_sync_q = J({ v: 1, q: { r1: AT2 } }); }   // 応答が返る前に、新しい日時で送信待ちに入った
      return { data: { ok: true, written: true } };
    } });
    await b3.api.pushOne('r1'); await settle();
    t('★D 送った日時より新しい保存は送信待ちに残る（観測してから完了）', J(q(b3)) === J(['r1']), q(b3));
  }

  console.log('\n— E 形の断り —');
  {
    for (const err of ['badid', 'badstart', 'badno', 'badprev', 'badby', 'badat', 'futureat']) {
      const b = box({ store: Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 } }), apc2_sync_q: J({ v: 1, q: { r1: AT1 } }) }, SESSION),
        reply: () => ({ data: { ok: false, error: err } }) });
      await b.api.pushOne('r1'); await settle();
      t('★E ' + err + ' は送信待ちから外し、記録を残す', q(b).length === 0 && ng(b).r1 && ng(b).r1.e === err && ng(b).r1.at === AT1, { q: q(b), ng: ng(b) });
    }
    const b = box({ store: Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 } }) }, SESSION), reply: () => ({ data: { ok: false, error: 'badstart' } }) });
    await b.api.pushOne('r1'); await settle();
    await b.api.pushAll(); await settle();
    await b.api.pushOne('r1'); await settle();
    t('★E 同じ日時の設定は送り直さない（無限に送らない）', b.calls.length === 1, b.calls.length);
    t('E 記録には入居者IDと断りの名前と日時だけ（値・氏名は残さない）', J(Object.keys(ng(b).r1).sort()) === J(['at', 'e', 't']), ng(b).r1);
    b.store.apc2_res = res({ r1: { start: '2026-10-03', no: 2, prev: 0, by: 'x', at: AT2 } });
    await b.api.pushOne('r1'); await settle();
    t('E 設定を直して日時が変われば、また送る', b.calls.length === 2);
    t('E 写しの見比べ用に断られた一覧（IDと断りの名前）を返す', J(b.api.refused()) === J([{ id: 'r1', error: 'badstart' }]), b.api.refused());
  }

  console.log('\n— F ログイン —');
  {
    const st = { apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 } }) };
    const nos = box({ store: st, noAuth: true });
    await nos.api.pushAll(); await settle();
    t('★F ログインの控えが無い端末は送らない', nos.calls.length === 0);
    t('★F 帯を出さない（画面に何も足さない）', nos.bodyAdds.length === 0);
    t('F ログインの控えが無ければ、ログインの部品も読み込まない', nos.appended.length === 0, nos.appended);
    t('F 入力は端末に残る（送信待ちに残す・控えはそのまま）', J(q(nos)) === J(['r1']) && nos.store.apc2_res === st.apc2_res, q(nos));
    for (const s of ['signed_out', 'denied', 'mfa_verify', 'mfa_enroll', 'error']) {
      const b = box({ store: Object.assign({}, st, SESSION), status: s });
      await b.api.pushAll(); await settle();
      t('F ログインの状態が ' + s + ' なら黙って送らない（帯なし）', b.calls.length === 0 && b.bodyAdds.length === 0 && J(q(b)) === J(['r1']));
    }
    const fld = box({ store: Object.assign({}, st, SESSION), status: 'ok' });
    await fld.api.pushAll(); await settle();
    t('F 現場のアカウント（role field）も送る（書けるかはデータベースが決める）', fld.calls.length === 1);
  }

  console.log('\n— G ログインの部品を二重に読まない —');
  {
    const st = Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 } }) }, SESSION);
    const b = box({ store: st, noAuth: true, tags: ['supabase-js-2.112.4.js', 'su-auth.js?v=2026-10-20'] });
    const p = b.api.pushAll();
    await settle();
    t('★G 札がすでにある時は supabase-js も su-auth.js も入れ直さない', b.appended.length === 0, b.appended);
    b.sb.SUAuth = b.auth;
    await new Promise(r => setTimeout(r, 250)); await settle(); await p; await settle();
    t('G 読み終わるのを待ってから送る', b.calls.length === 1, b.calls.length);
    const b2 = box({ store: st, noAuth: true, tags: ['supabase-js-2.112.4.js'] });
    const p2 = b2.api.pushAll();
    await settle();
    t('G ライブラリの札だけある時は入れ直さずに待つ', b2.appended.length === 0, b2.appended);
    b2.sb.supabase = { createClient() {} };
    await new Promise(r => setTimeout(r, 250)); await settle();
    t('G ライブラリが読めたら su-auth.js を1本だけ入れる（画面の pcAuthLoad と同じ札の名前）', J(b2.appended) === J(['su-auth.js?v=2026-10-20']), b2.appended);
    b2.sb.SUAuth = b2.auth;
    b2.els.forEach(e => e.onload && e.onload());   // 入れた札が読み終わった
    await p2; await settle();
    t('G 読み終わったら送る', b2.calls.length === 1, b2.calls.length);
    const b3 = box({ store: st, noAuth: true, tags: [] });
    b3.api.pushAll(); await settle();
    t('G（対照）札が無ければ supabase-js を1本入れる', J(b3.appended) === J(['supabase-js-2.112.4.js']), b3.appended);
    const pc = /function pcAuthLoad\(\) \{[\s\S]*?\n\}/.exec(PAGE);
    t('G 画面の pcAuthLoad も同じ札を見て入れ直さない（両方が読んでも1本ずつ）', !!pc && /has\(\/\^supabase-js-\/\)/.test(pc[0]) && /has\(\/\^su-auth\\\.js\/\)/.test(pc[0]) && /load\('su-auth\.js\?v=2026-10-24'\)/.test(pc[0]));
  }

  console.log('\n— H 起動時の送信は読むだけ —');
  {
    const r0 = res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 }, r2: { start: '2026-10-05', no: 1, prev: 0, by: 'y', at: AT1 } });
    const b = box({ store: Object.assign({ apc2_res: r0 }, SESSION), reply: (n, a) => ({ data: { ok: true, stale: true, start: '2027-01-01', no: 8, prev: 7, by: 'z', at: AT2 } }) });
    t('H 読み込んだだけでは何も送らない', b.calls.length === 0);
    await b.api.pushAll(); await settle();
    t('★H 起動時は控えの全員分を1回ずつ送る', J(b.calls.map(c => c.args.p_resident_id)) === J(['r1', 'r2']));
    t('★H サーバーの方が新しくても控え（apc2_res）を書き換えない', b.store.apc2_res === r0 && b.writes.indexOf('apc2_res') < 0, b.writes);
    t('H 書くのは送信待ち・断りの記録・送信済みの控え・スイッチの控えだけ', b.writes.every(k => /^-?(apc2_sync_q|apc2_sync_ng|apc2_sync_sent|su_backend_flags)$/.test(k)), b.writes);
    t('H 部品は patch_get を呼ばない（表示へ取り込むのは段階3）', SYNC.indexOf('patch_get') < 0 || !/rpc\('patch_get'/.test(SYNC));
    const fnPush = /setTimeout\(function \(\) \{ try \{ window\.SUPatchSync\.pushAll\(\); \}[^\n]*/.exec(PAGE);
    t('★H 画面の起動の送信は pushAll だけを呼び、戻り値で表示を変えない', !!fnPush && !/\.then\(/.test(fnPush[0]), fnPush && fnPush[0]);
    t('H 部品は画面の関数（render・selectResident 等）を呼ばない', !/render\(|selectResident|loadState|innerHTML|textContent/.test(SYNC));
  }

  console.log('\n— I 写しの見比べの差の数え方 —');
  {
    const b = box({ store: {} });
    const local = {
      same: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 },
      lonly: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 },
      diffNo: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 },
      diffStart: { start: '2026-10-02', no: 2, prev: 1, by: 'x', at: AT1 },
      diffPrev: { start: '2026-10-01', no: 2, by: 'x', at: AT1 },
      noat: { start: '2026-10-01', no: 2, prev: 1 }
    };
    const rows = {
      same: { start: '2026-10-01', no: 2, prev: 1, by: '別の人', at: AT2 },   // 設定した人・日時の違いは中身の違いに数えない
      diffNo: { start: '2026-10-01', no: 3, prev: 1, by: 'x', at: AT1 },
      diffStart: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 },
      diffPrev: { start: '2026-10-01', no: 2, prev: 4, by: 'x', at: AT1 },
      sonly: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 }
    };
    const d = b.api.diff(local, rows);
    t('★I 端末だけにある', J(d.onlyLocal) === J(['lonly']), d.onlyLocal);
    t('★I サーバーだけにある', J(d.onlyServer) === J(['sonly']), d.onlyServer);
    t('★I 中身が違う（開始日・場所・前日の場所）', J(d.differ) === J(['diffNo', 'diffPrev', 'diffStart']), d.differ);
    t('I 一致', J(d.same) === J(['same']), d.same);
    t('★I 日時の無い古い設定は差に数えず別に出す', J(d.noAt) === J(['noat']), d.noAt);
    t('I 応答が壊れていても落ちない（全部「端末だけ」）', J(b.api.diff(local, 'x').onlyLocal.length) === '5');
    t('I 控えの読み方: 壊れた控えは空・形の違う1人分は外す', J(box({ store: { apc2_res: '{' } }).api.readLocal()) === '{}'
      && J(Object.keys(box({ store: { apc2_res: res({ a: { start: '2026-10-01' }, b: 'x' }) } }).api.readLocal())) === J(['a']));

    // 写しの見比べの画面の loadPatch を切り出して動かす（偽のデータベース・偽の画面）
    function fn(name) {
      const i = SHJS.lastIndexOf('function ' + name + '(');
      if (i < 0) throw new Error('no ' + name);
      const st = SHJS.lastIndexOf('\n', i) + 1;
      let dd = 0, seen = false, qq = null;
      for (let k = SHJS.indexOf('{', i); k < SHJS.length; k++) {
        const c = SHJS[k];
        if (qq) { if (c === '\\') { k++; continue; } if (c === qq) qq = null; continue; }
        if (c === "'" || c === '"') { qq = c; continue; }
        if (c === '{') { dd++; seen = true; } else if (c === '}') { dd--; if (seen && !dd) return SHJS.slice(st, k + 1); }
      }
      throw new Error('unterminated ' + name);
    }
    function node(tag) {
      return { tag, className: '', textContent: '', children: [], appendChild(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; } };
    }
    const allText = n => (n.textContent || '') + ' ' + n.children.map(allText).join(' ');
    const ids = { 'pt-kpis': node('div'), 'pt-verdict': node('p'), 'pt-list': node('ul'), 'pt-open': node('a') };
    const sh = box({ store: { apc2_res: res(local), apc2_sync_q: J({ v: 1, q: { lonly: AT1 } }), su_backend_flags: J({ supabase: { patch_push: false } }) } });
    const rpcCalls = [];
    const env = { Object, Array, String, Number, JSON, Error, Promise, SUPatchSync: sh.api,
      $: id => ids[id], document: { createElement: tag => node(tag) } };
    env.window = env;
    vm.createContext(env);
    vm.runInContext('var PT_LIST_MAX = ' + (/var PT_LIST_MAX = (\d+);/.exec(SHJS) || [0, '50'])[1] + ';\n' +
      [fn('el'), fn('kpi'), fn('patchRows'), fn('loadPatch')].join('\n'), env);
    await env.loadPatch({ rpc: (n, a) => { rpcCalls.push(n); return Promise.resolve({ data: { ok: true, ver: 1, rows } }); } });
    const kp = ids['pt-kpis'].children.map(k => allText(k).replace(/\s+/g, ''));
    t('★I 画面はサーバーの行数を出す（patch_get を1回だけ・書く関数は呼ばない）', J(rpcCalls) === J(['patch_get']) && kp.indexOf('サーバーの行数5人') >= 0, { rpcCalls, kp });
    t('★I 画面に差の内訳を出す（端末だけ1・サーバーだけ1・違う3＝同じ日時なのでほかの端末側・日時なし1）',
      ['端末だけにある1人', 'サーバーだけにある1人', '未送信（この端末の方が新しい）0人', 'ほかの端末で新しい設定3人', '送らない（日時なし）1人', '一致1人', 'この端末の送信待ち1人', '送るスイッチ切'].every(x => kp.indexOf(x) >= 0), kp);
    t('★K スイッチが切の間は warn にせず「まだ送っていません（差は想定どおり）」と出す', !/warn/.test(ids['pt-verdict'].className)
      && ids['pt-verdict'].textContent.indexOf('送るスイッチが切のため、まだ送っていません（差は想定どおり）') === 0, { c: ids['pt-verdict'].className, t: ids['pt-verdict'].textContent });
    t('★K スイッチが切の間のボタンは送らないことが分かる文言（「送り直す」と言わない）', /送りません/.test(ids['pt-open'].textContent) && !/送り直す/.test(ids['pt-open'].textContent), ids['pt-open'].textContent);
    const lt = allText(ids['pt-list']);
    t('I 一覧は入居者IDと理由だけ', /入居者ID lonly/.test(lt) && /入居者ID sonly/.test(lt) && lt.indexOf('noat') < 0);
    // スイッチが入の時: 未送信があれば warn・ほかの端末側だけなら ok
    ids['pt-list'].replaceChildren();
    const onFlags = J({ supabase: { patch_push: true } });
    env.SUPatchSync = box({ store: { apc2_res: res(local), su_backend_flags: onFlags } }).api;
    await env.loadPatch({ rpc: () => Promise.resolve({ data: { ok: true, ver: 1, rows } }) });
    t('★K スイッチが入で端末だけにある（未送信）方があれば warn', /warn/.test(ids['pt-verdict'].className) && /未送信の設定が 1件/.test(ids['pt-verdict'].textContent), ids['pt-verdict'].textContent);
    t('K スイッチが入のボタンは「送り直す」', /送り直す/.test(ids['pt-open'].textContent), ids['pt-open'].textContent);
    ids['pt-list'].replaceChildren();
    const lo2 = { a: { start: '2026-10-01', no: 2, prev: 1, by: 'x', at: AT1 } };
    env.SUPatchSync = box({ store: { apc2_res: res(lo2), su_backend_flags: onFlags } }).api;
    await env.loadPatch({ rpc: () => Promise.resolve({ data: { ok: true, ver: 1, rows: { a: { start: '2026-10-09', no: 5, prev: 4, by: 'y', at: AT2 }, z: rows.sonly } } }) });
    t('★K ほかの端末で新しい設定・サーバーだけの差しか無ければ warn にしない', !/warn/.test(ids['pt-verdict'].className) && /未送信は0件/.test(ids['pt-verdict'].textContent), { c: ids['pt-verdict'].className, t: ids['pt-verdict'].textContent });
    t('K 一覧に「ほかの端末で新しい設定（段階3で取り込む）」', /ほかの端末で新しい設定（段階3で取り込む）/.test(allText(ids['pt-list'])));
    ids['pt-list'].replaceChildren();
    env.SUPatchSync = box({ store: { apc2_res: res(lo2), su_backend_flags: onFlags } }).api;
    await env.loadPatch({ rpc: () => Promise.resolve({ data: { ok: true, ver: 1, rows: { a: { start: '2026-10-09', no: 5, prev: 4, by: 'y', at: '2026-10-14T01:00:00.000Z' } } } }) });
    t('★K 端末の方が新しい中身の違いは「未送信」で warn', /warn/.test(ids['pt-verdict'].className) && /未送信（この端末の方が新しい）/.test(allText(ids['pt-list']))
      && ids['pt-kpis'].children.map(k => allText(k).replace(/\s+/g, '')).indexOf('未送信（この端末の方が新しい）1人') >= 0, ids['pt-verdict'].textContent);
    // 形で断られた方は断りの欄だけで数える
    ids['pt-list'].replaceChildren();
    env.SUPatchSync = box({ store: { apc2_res: res(lo2), su_backend_flags: onFlags, apc2_sync_ng: J({ v: 1, r: { a: { e: 'badstart', at: AT1, t: AT1 } } }) } }).api;
    await env.loadPatch({ rpc: () => Promise.resolve({ data: { ok: true, ver: 1, rows: {} } }) });
    const kp2 = ids['pt-kpis'].children.map(k => allText(k).replace(/\s+/g, ''));
    const lt2 = allText(ids['pt-list']);
    t('★K 形で断られた方は差に数えない（端末だけ0・断り1・一覧に1回だけ）', kp2.indexOf('端末だけにある0人') >= 0 && kp2.indexOf('形の違いで断られた1人') >= 0
      && (lt2.match(/入居者ID a/g) || []).length === 1 && /形の違いで断られた（badstart）/.test(lt2) && /差は0件/.test(ids['pt-verdict'].textContent), { kp2, lt2 });
    // 断られた後に直して日時が変わった方は、断りの欄に出さず「端末だけ」1回だけ
    ids['pt-list'].replaceChildren();
    env.SUPatchSync = box({ store: { apc2_res: res({ a: Object.assign({}, lo2.a, { at: AT2 }) }), su_backend_flags: onFlags, apc2_sync_ng: J({ v: 1, r: { a: { e: 'badstart', at: AT1, t: AT1 } } }) } }).api;
    await env.loadPatch({ rpc: () => Promise.resolve({ data: { ok: true, ver: 1, rows: {} } }) });
    const kp3 = ids['pt-kpis'].children.map(k => allText(k).replace(/\s+/g, '')), lt3 = allText(ids['pt-list']);
    t('K 直して日時が変わった方は断りの欄に数えない（一覧に1回だけ・未送信として）', kp3.indexOf('端末だけにある1人') >= 0 && kp3.indexOf('形の違いで断られた0人') >= 0
      && (lt3.match(/入居者ID a/g) || []).length === 1 && !/断られた/.test(lt3), { kp3, lt3 });
    ids['pt-list'].replaceChildren();
    const sh2 = box({ store: { apc2_res: res({ same: local.same }) } });
    env.SUPatchSync = sh2.api;
    await env.loadPatch({ rpc: () => Promise.resolve({ data: { ok: true, ver: 1, rows: { same: rows.same } } }) });
    t('I 差が0件なら ok', /ok/.test(ids['pt-verdict'].className) && /差は0件/.test(ids['pt-verdict'].textContent), ids['pt-verdict'].textContent);
    let threw = false;
    try { await env.loadPatch({ rpc: () => Promise.resolve({ data: 'こわれた' }) }); } catch (e) { threw = true; }
    t('I 応答の形が違えば読めなかった扱い（「サーバーは空」と取り違えない）', threw);
    t('★I 写しの見比べの画面からは送らない（pushOne・pushAll を呼ばない）', !/pushOne|pushAll|patch_put/.test(SHJS));
    t('I 一覧は textContent で出す（innerHTML を使わない）', !/innerHTML/.test(fn('loadPatch')));
    t('I 画面の欄と部品の読み込み（shadow-check.js より前）', /id="pt-kpis"/.test(SHHTML) && /id="pt-verdict"/.test(SHHTML) && /id="pt-list"/.test(SHHTML)
      && SHHTML.indexOf('<script src="su-patch-sync.js') > 0 && SHHTML.indexOf('<script src="su-patch-sync.js') < SHHTML.indexOf('<script src="shadow-check.js'));
    t('I 読み込みは load() の中で、失敗しても他の見比べを止めない', /try \{ await loadPatch\(sb\); \}\s*catch \(e\) \{[^}]*pt-verdict/.test(SHJS));
  }

  console.log('\n— K 反証レビューの直し —');
  {
    // 1. スイッチが切ならログインの部品（script の札）を足さない
    const st = Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1 } }) }, SESSION);
    const off = box({ store: st, noAuth: true, tags: [], flags: { patch_push: false } });
    await off.api.pushAll(); await off.api.pushOne('r1'); await settle();
    t('★K スイッチが切の時はログインの部品（supabase-js・su-auth.js）の札を足さない', off.appended.length === 0 && off.calls.length === 0, off.appended);

    // 2. 断りの記録と日時が同じ方だけ差から外す（直して日時が変われば差に戻る）
    const d2 = box({ store: { apc2_sync_ng: J({ v: 1, r: { a: { e: 'badstart', at: AT1, t: AT1 }, b: { e: 'badno', at: AT1, t: AT1 }, c: { e: 'badno', at: AT1, t: AT1 } } }) } }).api.diff(
      { a: { start: '2026-10-01', no: 2, prev: 1, at: AT1 }, b: { start: '2026-10-01', no: 2, prev: 1, at: AT2 }, c: { start: '2026-10-01', no: 2, prev: 1, at: AT1 } },
      { c: { start: '2026-10-01', no: 9, prev: 1, at: '2026-10-10T00:00:00.000Z' } });
    t('★K 形で断られた方（同じ日時）は「端末だけ」「中身が違う」に数えず refused にだけ出す', J(d2.refused) === J([{ id: 'a', error: 'badstart' }, { id: 'c', error: 'badno' }])
      && d2.onlyLocal.indexOf('a') < 0 && d2.differ.indexOf('c') < 0 && d2.differLocal.indexOf('c') < 0, d2);
    t('K 断られた後に直して日時が変わった方は差に戻る（断りには数えない）', J(d2.onlyLocal) === J(['b']), d2);

    // 3. 中身の違いを日時で分ける
    const T0 = '2026-10-14T01:00:00.000Z';
    const d3 = box({ store: {} }).api.diff({
      newer: { start: '2026-10-01', no: 2, prev: 1, at: AT2 }, older: { start: '2026-10-01', no: 2, prev: 1, at: T0 },
      eq: { start: '2026-10-01', no: 2, prev: 1, at: AT1 }, broken: { start: '2026-10-01', no: 2, prev: 1, at: AT1 }
    }, {
      newer: { start: '2026-10-01', no: 3, prev: 1, at: AT1 }, older: { start: '2026-10-01', no: 3, prev: 1, at: AT1 },
      eq: { start: '2026-10-01', no: 3, prev: 1, at: AT1 }, broken: { start: '2026-10-01', no: 3, prev: 1, at: 'こわれた' }
    });
    t('★K 端末の方が新しい中身の違いは differLocal（未送信）', J(d3.differLocal) === J(['broken', 'newer']), d3.differLocal);
    t('★K サーバーの方が新しい・同じ日時は differServer（ほかの端末の設定）', J(d3.differServer) === J(['eq', 'older']), d3.differServer);
    t('K differ は両方を合わせたもの', J(d3.differ) === J(['broken', 'eq', 'newer', 'older']), d3.differ);

    // 4. 送信済みの控え
    const st4 = Object.assign({ apc2_res: res({ r1: { start: '2026-10-01', no: 2, prev: 0, by: 'x', at: AT1, name: '見本 甲' }, r2: { start: '2026-10-02', no: 3, prev: 2, by: 'y', at: AT1 } }) }, SESSION);
    const s4 = box({ store: st4 });
    await s4.api.pushAll(); await settle();
    const sent = (() => { try { return JSON.parse(s4.store.apc2_sync_sent).s; } catch (e) { return null; } })();
    t('★K ok を受け取ったら送信済みの控えに（入居者ID → 日時）だけ残す（氏名なし）', J(sent) === J({ r1: AT1, r2: AT1 }) && s4.store.apc2_sync_sent.indexOf('見本') < 0, s4.store.apc2_sync_sent);
    await s4.api.pushAll(); await settle();
    t('★K 開いた後の送信は、送信済みと日時が同じ方を送らない', s4.calls.length === 2, s4.calls.map(c => c.args.p_resident_id));
    s4.store.apc2_res = res({ r1: { start: '2026-10-05', no: 2, prev: 0, by: 'x', at: AT2 }, r2: { start: '2026-10-02', no: 3, prev: 2, by: 'y', at: AT1 } });
    await s4.api.pushAll(); await settle();
    t('★K 日時が新しくなった方は送る（その方だけ）', J(s4.calls.slice(2).map(c => c.args.p_resident_id)) === J(['r1']), s4.calls.map(c => c.args.p_resident_id));
    await s4.api.pushOne('r2'); await settle();
    t('★K 保存の後の送信（その方）は送信済みでも今までどおり送る', s4.calls.length === 4 && s4.calls[3].args.p_resident_id === 'r2', s4.calls.map(c => c.args.p_resident_id));
    for (const bad of ['{', J({ v: 1, s: [] }), J('x'), J({ v: 1 })]) {
      const b = box({ store: Object.assign({}, st4, { apc2_sync_sent: bad }) });
      await b.api.pushAll(); await settle();
      t('★K 送信済みの控えが壊れていたら全員分を送る（' + bad + '）', b.calls.length === 2, b.calls.length);
    }
    const qd = box({ store: Object.assign({}, st4, { apc2_sync_sent: J({ v: 1, s: { r1: AT1, r2: AT1 } }), apc2_sync_q: J({ v: 1, q: { r1: AT1 } }) }) });
    await qd.api.pushAll(); await settle();
    t('K 送信済みでも送信待ちに残っている方は送る', J(qd.calls.map(c => c.args.p_resident_id)) === J(['r1']), qd.calls.map(c => c.args.p_resident_id));
    const nf = box({ store: st4, reply: () => ({ error: { message: 'Failed to fetch' } }) });
    await nf.api.pushAll(); await settle();
    t('K 送れなかった方は送信済みに残さない', !('apc2_sync_sent' in nf.store), nf.store.apc2_sync_sent);
    const rf = box({ store: st4, reply: () => ({ data: { ok: false, error: 'badstart' } }) });
    await rf.api.pushAll(); await settle();
    t('K 形で断られた方は送信済みに残さない（断りの記録の方で止める）', !('apc2_sync_sent' in rf.store), rf.store.apc2_sync_sent);
    const offS = box({ store: st4, flags: { patch_push: false } });
    await offS.api.pushAll(); await settle();
    t('K スイッチが切なら送信済みの控えも書かない', !('apc2_sync_sent' in offS.store));
  }

  console.log('\n— J 画面のつなぎ・スイッチ・公開 —');
  {
    const save = (/\nfunction saveSettings\(\) \{[\s\S]*?\n\}/.exec(PAGE) || [''])[0];
    t('★J 入居者ごとの設定を端末に保存できた後に送る（保存の行の後ろ・同じ try の中）', /setItem\(LS_BYRES[^;]*;\s*state\.setBy = by; state\.setAt = at; pcPush\(state\.rid\); \}/.test(save), save.slice(0, 0));
    t('J 手入力の設定の保存からは送らない', (save.match(/pcPush\(/g) || []).length === 1);
    const pcPush = (/\nfunction pcPush\(rid\) \{[\s\S]*?\n\}/.exec(PAGE) || [''])[0];
    t('J 送る関数は部品が無くても画面を止めない', /if \(rid && window\.SUPatchSync\) \{ try \{ window\.SUPatchSync\.pushOne\(rid\); \} catch/.test(pcPush), pcPush);
    const boot = PAGE.indexOf('/* ── 起動 ── */'), call = PAGE.indexOf('window.SUPatchSync.pushAll()');
    t('★J 画面を開いた後（最初の描画の後）に1回だけ全員分を送る', boot > 0 && call > PAGE.indexOf('render();', boot) && (PAGE.match(/SUPatchSync\.pushAll\(\)/g) || []).length === 1);
    const tag = PAGE.indexOf('<script src="su-patch-sync.js?v='), inline = PAGE.indexOf("<script>\n'use strict';");
    t('J 部品は画面のスクリプトより前に読む', tag > 0 && inline > tag);
    t('J 印刷の欄・紙の見出しには触れない（部品は p-by 等を知らない）', !/p-by|p-nm|print/.test(SYNC));
    const be = JSON.parse(fs.readFileSync(path.join(ROOT, 'su-backend.json'), 'utf8'));
    /* 段階2の公開（PR #172）では false、その後のスイッチを入れる PR（2026-10-17）で true。入切は代表者の判断なので、値は固定せず「真偽値で置かれている」ことだけを守る */
    t('★J スイッチ patch_push は su-backend.json の supabase の中に真偽値で置かれている', be.supabase && typeof be.supabase.patch_push === 'boolean', be.supabase);
    t('J ほかのスイッチは変えていない', be.supabase.care_schedule_v2 === true && be.supabase.ws_weekly_master_v1 === true && be.supabase.wsday === true && be.supabase.shift === true);
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    t('J 公開の許可リストに部品がある（無いと公開されず、構文の点検からも漏れる）', /^!\/su-patch-sync\.js$/m.test(gi));
    t('J 部品は氏名の名簿（su_residents_common）を読まない', SYNC.indexOf('su_residents_common') < 0);
  }

  console.log('\n— L 現場の端末と権限の断り —');
  {
    const three = { r1: { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: AT1 }, r2: { start: '2026-10-02', no: 2, prev: 1, by: 'x', at: AT1 }, r3: { start: '2026-10-03', no: 3, prev: 2, by: 'x', at: AT1 } };
    const fieldSt = Object.assign({ apc2_res: res(three), su_device_role: 'field' }, SESSION);
    const f1 = box({ store: fieldSt });
    await f1.api.pushAll(); await settle();
    t('★L 現場の端末は、開いた後に控えの全員分を送らない', f1.calls.length === 0, f1.calls.map(c => c.args.p_resident_id));
    const f2 = box({ store: Object.assign({}, fieldSt, { apc2_sync_q: J({ v: 1, q: { r2: AT1 } }) }) });
    await f2.api.pushAll(); await settle();
    t('★L 現場の端末でも、送信待ちに残っている方は開いた後に送る', J(f2.calls.map(c => c.args.p_resident_id)) === J(['r2']), f2.calls.map(c => c.args.p_resident_id));
    const f3 = box({ store: fieldSt });
    await f3.api.pushOne('r3'); await settle();
    t('★L 現場の端末でも、保存した方は送る（保存した方だけ送る）', J(f3.calls.map(c => c.args.p_resident_id)) === J(['r3']));
    const o1 = box({ store: Object.assign({}, fieldSt, { su_device_role: 'office' }) });
    await o1.api.pushAll(); await settle();
    t('L（対照）事務所PCは開いた後に全員分を送る', o1.calls.length === 3);
    const o2 = box({ store: Object.assign(J ? { apc2_res: res(three) } : {}, SESSION) });
    await o2.api.pushAll(); await settle();
    t('L（対照）用途が未設定の端末は事務所PCと同じ（全員分）', o2.calls.length === 3);

    const deny = () => ({ data: null, error: { code: '42501', message: 'not allowed' } });
    const d1 = box({ store: Object.assign({ apc2_res: res({ r1: three.r1, r2: three.r2 }) }, SESSION), reply: (n, a) => (a.p_resident_id === 'r1' ? deny() : { data: { ok: true, written: true } }) });
    await d1.api.pushOne('r1'); await settle();
    t('★L 権限で断られても送信待ちに残す（消さない）', J(q(d1)) === J(['r1']), q(d1));
    t('★L 権限で断られたら denied を記録する（日時つき）', ng(d1).r1 && ng(d1).r1.e === 'denied' && ng(d1).r1.at === AT1, ng(d1));
    await d1.api.pushOne('r1'); await d1.api.pushOne('r2'); await settle();
    t('★L 同じ日時の設定は、保存の後には送り直さない（保存のたびに送り続けない）', d1.calls.filter(c => c.args.p_resident_id === 'r1').length === 1, d1.calls.map(c => c.args.p_resident_id));
    t('L ほかの方の保存は送れる（断られた方に引きずられない）・断られた方は送信待ちのまま', d1.calls.some(c => c.args.p_resident_id === 'r2') && J(q(d1)) === J(['r1']), q(d1));
    t('L 写しの見比べでは断りの欄に出る', J(d1.api.refused()) === J([{ id: 'r1', error: 'denied' }]));
    const before = d1.calls.length;
    await d1.api.pushAll(); await settle();
    t('★L 事務所PCで開いた時は1回だけ送り直す', d1.calls.filter((c, i) => i >= before && c.args.p_resident_id === 'r1').length === 1);
    const fd = box({ store: Object.assign({}, d1.store, { su_device_role: 'field' }), reply: deny });
    await fd.api.pushAll(); await settle();
    t('★L 現場の端末でも、開いた時に送信待ちの denied を1回送り直す（現場で直した設定を失わない）', J(fd.calls.map(c => c.args.p_resident_id)) === J(['r1']), fd.calls.map(c => c.args.p_resident_id));
    const ok2 = box({ store: Object.assign({}, fd.store, { su_device_role: 'field' }) });
    await ok2.api.pushAll(); await settle();
    t('★L 許可が戻れば（ログインし直せば）、開いた時に載り、送信待ちと denied の記録が外れる',
      ok2.calls.length === 1 && J(q(ok2)) === J([]) && !ng(ok2).r1 && JSON.parse(ok2.store.apc2_sync_sent || '{"s":{}}').s.r1 === AT1, { q: q(ok2), ng: ng(ok2) });
    d1.store.apc2_res = res({ r1: Object.assign({}, three.r1, { at: AT2 }), r2: three.r2 });
    const n0 = d1.calls.length;
    await d1.api.pushOne('r1'); await settle();
    t('L 設定を直して日時が変われば、保存の後にまた送る', d1.calls.length === n0 + 1);
    const jwt = () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
    const j1 = box({ store: Object.assign({ apc2_res: res({ r1: three.r1 }) }, SESSION), reply: jwt });
    await j1.api.pushOne('r1'); await settle();
    t('★L ログインの切れ（42501 以外）は送信待ちに残す（記録しない）', J(q(j1)) === J(['r1']) && !ng(j1).r1, { q: q(j1), ng: ng(j1) });
    t('L 部品は端末の用途を送る時に読む（su_device_role）', /lsGet\('su_device_role'\) === 'field'/.test(SYNC));
  }

  console.log('\n— M まとめて送る（統合 0021・2026-10-24）—');
  {
    const three = { r1: { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: AT1, name: '見本 甲' }, r2: { start: '2026-10-02', no: 2, prev: 1, by: 'x', at: AT1 }, r3: { start: '2026-10-03', no: 3, prev: 2, by: 'x', at: AT1 } };
    const st = Object.assign({ apc2_res: res(three) }, SESSION);
    const names = b => b.rpcs.map(r => r.name);
    const ids = r => ((r && r.args && r.args.items) || []).map(a => a.p_resident_id);
    const sentOf = b => { try { return JSON.parse(b.store.apc2_sync_sent).s; } catch (e) { return {}; } };

    // 1. まとめて1往復・中身は1人ずつの時と同じ6つ
    const b1 = box({ store: st });
    await b1.api.pushAll(); await settle();
    const items = (b1.rpcs[0] && b1.rpcs[0].args.items) || [];
    t('★M 開いた後の送信は patch_put_many を1回だけ呼ぶ（3人で1往復）', J(names(b1)) === J(['patch_put_many']) && J(ids(b1.rpcs[0])) === J(['r1', 'r2', 'r3']), names(b1));
    t('★M 送るのは { items: [1人分ずつ] } だけ・1人分は6つのキーだけ（氏名のキーも文字も無い）',
      J(Object.keys(b1.rpcs[0].args)) === J(['items']) && items.length === 3
      && items.every(a => J(Object.keys(a).sort()) === J(['p_at', 'p_by', 'p_no', 'p_prev', 'p_resident_id', 'p_start'])) && J(items).indexOf('見本') < 0, items);
    const one = box({ store: st });
    await one.api.pushOne('r2'); await settle();
    t('M 1人分の中身は、保存の後の送信（patch_put）と同じ', J(items[1]) === J(one.calls[0] && one.calls[0].args), { many: items[1], one: one.calls[0] && one.calls[0].args });
    t('★M 全員載ったら送信済みに残り、送信待ちは空', J(sentOf(b1)) === J({ r1: AT1, r2: AT1, r3: AT1 }) && q(b1).length === 0, { s: sentOf(b1), q: q(b1) });
    await b1.api.pushAll(); await settle();
    t('M 送るものが無ければ呼ばない（2回目の開いた後）', b1.rpcs.length === 1, names(b1));

    // 2. 失敗した分だけ送信待ちに残る
    const part = box({ store: st, manyReply: () => ({ data: [{ ok: true, written: true }, { ok: false, error: 'failed' }, { ok: false, error: 'badno' }], error: null }) });
    await part.api.pushAll(); await settle();
    t('★M 載った方（r1）は送信済み・送信待ちに無い', sentOf(part).r1 === AT1 && q(part).indexOf('r1') < 0, { s: sentOf(part), q: q(part) });
    t('★M 1人だけ失敗した方（r2・failed）は送信待ちに残り、送信済みにしない', J(q(part)) === J(['r2']) && !('r2' in sentOf(part)) && !ng(part).r2, { q: q(part), ng: ng(part) });
    t('★M 形で断られた方（r3・badno）は今までどおり送信待ちから外して記録だけ残す', ng(part).r3 && ng(part).r3.e === 'badno' && ng(part).r3.at === AT1 && !('r3' in sentOf(part)), ng(part));
    await part.api.pushAll(); await settle();
    t('M 次に開いた時は、送信待ちに残った方（r2）だけをまとめて送る（断られた方は送り直さない）', J(ids(part.rpcs[1])) === J(['r2']), part.rpcs.map(ids));
    const hole = box({ store: st, manyReply: () => ({ data: [{ ok: true, written: true }, null, { ok: true, unchanged: true }], error: null }) });
    await hole.api.pushAll(); await settle();
    t('M 応答の1人分が壊れている方だけ送信待ちに残る', J(q(hole)) === J(['r2']) && J(Object.keys(sentOf(hole)).sort()) === J(['r1', 'r3']), { q: q(hole), s: sentOf(hole) });

    // 3. 呼び出し全体の失敗は、その回の全員に同じ扱い（今の1人ずつの失敗と同じ）
    for (const [label, mr] of [
      ['通信の失敗', () => ({ data: null, error: { message: 'Failed to fetch' } })],
      ['例外（呼び出しが返らずに失敗）', () => { throw new Error('offline'); }],
      ['ログインの切れ（PGRST301）', () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } })],
      ['配列でない応答（toomany 等の全体の断り）', () => ({ data: { ok: false, error: 'toomany' }, error: null })],
      ['人数の合わない応答', () => ({ data: [{ ok: true, written: true }], error: null })],
      ['空の応答', () => ({ data: null, error: null })]
    ]) {
      const b = box({ store: st, manyReply: mr });
      await b.api.pushAll(); await settle();
      t('★M 全体の失敗（' + label + '）は全員送信待ちに残り、送信済み・断りの記録にしない', J(q(b)) === J(['r1', 'r2', 'r3']) && !('apc2_sync_sent' in b.store) && Object.keys(ng(b)).length === 0, { q: q(b), ng: ng(b) });
    }
    const den = box({ store: st, manyReply: () => ({ data: null, error: { code: '42501', message: 'not allowed' } }) });
    await den.api.pushAll(); await settle();
    t('★M 権限の断り（42501）は全員を送信待ちに残し、denied を記録する（1人ずつの時と同じ）',
      J(q(den)) === J(['r1', 'r2', 'r3']) && ['r1', 'r2', 'r3'].every(k => ng(den)[k] && ng(den)[k].e === 'denied' && ng(den)[k].at === AT1), { q: q(den), ng: ng(den) });
    t('M 権限の断りでは1人ずつの patch_put に切り替えない（関数が無い時だけ）', J(names(den)) === J(['patch_put_many']), names(den));

    // 4. 関数が無い（0021 を流す前のデータベース）→ この画面を開いている間は1人ずつ
    const old = box({ store: st, noMany: true });
    await old.api.pushAll(); await settle();
    t('★M 関数が無い時（PGRST202）は、同じ送信の中で1人ずつ patch_put に戻って全員送る', J(names(old)) === J(['patch_put_many', 'patch_put', 'patch_put', 'patch_put'])
      && J(old.calls.map(c => c.args.p_resident_id)) === J(['r1', 'r2', 'r3']) && q(old).length === 0 && J(Object.keys(sentOf(old)).sort()) === J(['r1', 'r2', 'r3']), names(old));
    old.store.apc2_res = res(Object.assign({}, three, { r1: Object.assign({}, three.r1, { at: AT2 }) }));
    await old.api.pushAll(); await settle();
    t('★M 同じ画面で次に開いた後の送信も、patch_put_many を呼び直さず1人ずつ', J(names(old).slice(4)) === J(['patch_put']) && old.calls[3].args.p_resident_id === 'r1', names(old));
    t('★M 関数が無かったことは端末に覚えない（書くのは送信待ち・断り・送信済み・スイッチの控えだけ）',
      old.writes.every(k => /^-?(apc2_sync_q|apc2_sync_ng|apc2_sync_sent|su_backend_flags)$/.test(k)), old.writes);
    const reopen = box({ store: Object.assign({}, old.store, { apc2_res: res(Object.assign({}, three, { r1: Object.assign({}, three.r1, { at: AT2 }), r2: Object.assign({}, three.r2, { at: AT2 }) })) }) });
    await reopen.api.pushAll(); await settle();
    t('M 画面を開き直せば（0021 を流した後）またまとめて送る', J(names(reopen)) === J(['patch_put_many']) && J(ids(reopen.rpcs[0])) === J(['r2']), names(reopen));
    for (const kind of ['42883', 'msg']) {
      const b = box({ store: st, noMany: kind });
      await b.api.pushAll(); await settle();
      t('M 関数が無い時の見分け（' + (kind === 'msg' ? 'code が無く文言だけ' : 'code ' + kind) + '）でも1人ずつに戻る', J(names(b)) === J(['patch_put_many', 'patch_put', 'patch_put', 'patch_put']) && q(b).length === 0, names(b));
    }
    const oldNet = box({ store: st, noMany: true, reply: () => ({ error: { message: 'Failed to fetch' } }) });
    await oldNet.api.pushAll(); await settle();
    t('M 1人ずつに戻った後の失敗の扱いは今と同じ（通信の失敗は送信待ちに残る）', J(q(oldNet)) === J(['r1', 'r2', 'r3']), q(oldNet));
    const oldDen = box({ store: st, noMany: true, reply: (n, a) => (a.p_resident_id === 'r2' ? { data: null, error: { code: '42501' } } : { data: { ok: true, written: true } }) });
    await oldDen.api.pushAll(); await settle();
    t('M 1人ずつに戻った後の権限の断りも今と同じ（その方だけ denied・送信待ち）', J(q(oldDen)) === J(['r2']) && ng(oldDen).r2 && ng(oldDen).r2.e === 'denied', { q: q(oldDen), ng: ng(oldDen) });

    // 5. 50 人ずつに分ける
    const many = (n) => { const r = {}; for (let i = 1; i <= n; i++) r['m' + String(i).padStart(3, '0')] = { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: AT1 }; return r; };
    const b50 = box({ store: Object.assign({ apc2_res: res(many(50)) }, SESSION) });
    await b50.api.pushAll(); await settle();
    t('★M 50 人ちょうどは1往復', b50.rpcs.length === 1 && ids(b50.rpcs[0]).length === 50 && q(b50).length === 0, b50.rpcs.map(r => ids(r).length));
    const b51 = box({ store: Object.assign({ apc2_res: res(many(51)) }, SESSION) });
    await b51.api.pushAll(); await settle();
    t('★M 51 人は2往復（50・1）', J(b51.rpcs.map(r => ids(r).length)) === J([50, 1]) && q(b51).length === 0, b51.rpcs.map(r => ids(r).length));
    const b105 = box({ store: Object.assign({ apc2_res: res(many(105)) }, SESSION) });
    await b105.api.pushAll(); await settle();
    t('★M 上限（50 人）を超える時は分けて送る（105 人＝50・50・5）', J(b105.rpcs.map(r => ids(r).length)) === J([50, 50, 5]) && J(names(b105)) === J(['patch_put_many', 'patch_put_many', 'patch_put_many']), b105.rpcs.map(r => ids(r).length));
    t('M 分けても全員が1回ずつ・控えの順に送られ、全員送信済み', J([].concat(...b105.rpcs.map(ids))) === J(Object.keys(many(105))) && Object.keys(sentOf(b105)).length === 105 && q(b105).length === 0);
    const b105f = box({ store: Object.assign({ apc2_res: res(many(105)) }, SESSION), manyReply: (a, i) => (i === 2 ? { data: null, error: { message: 'Failed to fetch' } } : { data: a.items.map(() => ({ ok: true, written: true })), error: null }) });
    await b105f.api.pushAll(); await settle();
    t('★M 分けた2回目だけ失敗したら、その 50 人だけ送信待ちに残り、1回目・3回目の分は送信済み',
      q(b105f).length === 50 && J(q(b105f)) === J(Object.keys(many(105)).slice(50, 100)) && Object.keys(sentOf(b105f)).length === 55 && b105f.rpcs.length === 3, { q: q(b105f).length, s: Object.keys(sentOf(b105f)).length });
    t('M 部品の上限は 0021 と同じ 50（区切りが 64 を超えない）', /var MANY_MAX = 50;/.test(SYNC));

    // 6. 保存の後の送信・現場の端末・送っている間の保存
    const save = box({ store: Object.assign({}, st, { apc2_sync_q: J({ v: 1, q: { r3: AT1 } }) }) });
    await save.api.pushOne('r1'); await settle();
    t('★M 保存の後の送信（pushOne）は今までどおり1人ずつ patch_put（送信待ちの方も）', J(names(save)) === J(['patch_put', 'patch_put']) && J(save.calls.map(c => c.args.p_resident_id)) === J(['r1', 'r3']), names(save));
    const fld = box({ store: Object.assign({}, st, { su_device_role: 'field', apc2_sync_q: J({ v: 1, q: { r2: AT1, r3: AT1 } }) }) });
    await fld.api.pushAll(); await settle();
    t('M 現場の端末の開いた後の送信（送信待ちの方だけ）もまとめて1往復', J(names(fld)) === J(['patch_put_many']) && J(ids(fld.rpcs[0])) === J(['r2', 'r3']) && q(fld).length === 0, names(fld));
    const skip = box({ store: Object.assign({}, st, { apc2_sync_ng: J({ v: 1, r: { r3: { e: 'badstart', at: AT1, t: AT1 } } }) }) });
    await skip.api.pushAll(); await settle();
    t('M 同じ日時で形を断られた方はまとめる前に外す（送らない）', J(ids(skip.rpcs[0])) === J(['r1', 'r2']), skip.rpcs.map(ids));
    const late = box({ store: st, manyReply: (a) => { late.store.apc2_sync_q = J({ v: 1, q: { r1: AT2 } }); return { data: a.items.map(() => ({ ok: true, written: true })), error: null }; } });
    await late.api.pushAll(); await settle();
    t('★M 送っている間に新しい日時で保存し直された方は送信待ちから外さない（観測してから完了）', J(q(late)) === J(['r1']), q(late));
    t('M 部品はまとめて送る関数の名前を1か所でだけ呼ぶ（開いた後の送信だけ）', (SYNC.match(/rpc\('patch_put_many'/g) || []).length === 1);
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  finished = true;
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); finished = true; process.exit(2); });
