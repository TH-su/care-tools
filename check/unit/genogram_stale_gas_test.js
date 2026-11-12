/* 家族構成図（genogram.html）── 受け口が古い版の時に同期を止め、消せない帯を出す試験（代表者の指示 2026-11-13 新設）
   実行: node check/unit/genogram_stale_gas_test.js
   対象を差し替える: GENO_HTML=/tmp/変異版.html node check/unit/genogram_stale_gas_test.js（変異試験用）
   守ること:
     1. ping が ok:true で auth が 'ok' 以外（無い・'grace' など）なら「古い」とし、一覧・読込・保存・削除を送らずに止める（e.stale）
     2. 止めている間は消せない帯（genoStaleBar）を出す。文に技術用語を出さない。ping が auth:'ok' に戻れば帯を消して同期を戻す
     3. ping の通信の失敗・合言葉の断りは「分からない」＝今の状態のまま（止めない・止めたままにする）
     4. 保存・削除は確かめの途中ならその答えを待ってから送る。読込は確かめと並べて送り、応答の後に確かめの答えを待って古いと分かったら捨てる
     5. 1時間ごとの確かめは画面が隠れている間は休み、1時間たつまでは打たない。起動の時は打つ
     6. 記録（note）は古いと分かった時に1回だけ。URL・合言葉を書かない
     7. 一覧・読込・保存・削除の入口が全部 syncCall を通る（ping は通さない＝止めても確かめ直せる）
   ★通信は全部偽物。氏名は「テスト 一郎」などの架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.GENO_HTML || path.join(ROOT, 'genogram.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(name, prefix) {
  const key = (prefix || '') + 'function ' + name + '(';
  const h = SRC.indexOf(key);
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = SRC.indexOf('{', h), d = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(h, i + 1); } }
  throw new Error('閉じていません: ' + name);
}
function cutLine(start) {
  const h = SRC.indexOf(start);
  if (h < 0) throw new Error('見つかりません: ' + start);
  return SRC.slice(h, SRC.indexOf('\n', h));
}
const tick = () => new Promise(r => setImmediate(r));

function box(opt) {
  const o = opt || {};
  const calls = [], notes = [], intervals = [], listeners = {};
  let resizes = 0;
  const bar = { hidden: true, textContent: '' };
  const doc = { hidden: !!o.hidden, getElementById: (id) => (id === 'genoStaleBar' ? bar : null),
    addEventListener: (k, fn) => { listeners[k] = fn; } };
  /* 偽の受け口: 答えを ans[action] から返す。関数なら呼んで返す（保留の答えを試すため） */
  const ans = o.ans || {};
  const b = {
    document: doc,
    window: { dispatchEvent: () => { resizes++; } },
    Event: function (k) { this.type = k; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    gasCall: (action, params) => {
      calls.push(action);
      const a = ans[action];
      if (typeof a === 'function') return a(params);
      if (a instanceof Error) return Promise.reject(a);
      return Promise.resolve(a === undefined ? { ok: true } : a);
    },
    genoNote_: (where, e) => { notes.push([where, (e && e.message) || String(e)]); },
    isConfigured: () => o.configured !== false,
    Promise, Date, String, Math, Array, Object, JSON, Number, Error
  };
  vm.createContext(b);
  vm.runInContext([
    cutLine('const GENO_WRITE_ACTIONS = '), cutLine('const GENO_STALE_MSG = '), cutLine('const GENO_PING_EVERY_MS = '),
    cutLine('let genoStale = false'),
    cutF('genoStaleErr_'), cutF('genoStaleBar_'), cutF('genoSetStale_'), cutF('ping', 'async '), cutF('syncCall', 'async '),
    cutF('authCheck'), cutF('authWatch'),
    'this.api = { ping, syncCall, authCheck, authWatch, stale: () => genoStale, setAt: (v) => { genoPingAt = v; }, MSG: GENO_STALE_MSG };'
  ].join('\n'), b);
  return { b, api: b.api, calls, notes, bar, intervals, listeners, doc, resizes: () => resizes };
}
const run = async (p) => { try { await p; return null; } catch (e) { return e; } };

(async function main() {
  const TECH = /GAS|Web ?App|localStorage|スプシ|JSON|HTTP|トークン|Supabase|API|貼り替え/;

  /* 1・2: auth が無い（合言葉に未対応の古い版） */
  {
    const x = box({ ans: { ping: { ok: true, time: 'T' }, get: { ok: true, doc: null }, list: { ok: true, items: [] } } });
    await x.api.ping();
    t('★auth の無い ping の答え → 古いとする', x.api.stale() === true);
    t('★  └ 帯を出す（消せない帯・文は職員の言葉）', x.bar.hidden === false && x.bar.textContent === x.api.MSG && !TECH.test(x.bar.textContent), x.bar);
    t('  └ 作図の枠を合わせ直す（resize を出す）', x.resizes() === 1);
    for (const a of ['list', 'get', 'save', 'delete']) {
      const before = x.calls.length;
      const e = await run(x.api.syncCall(a, {}));
      t('★  └ ' + a + ' を送らずに止める（e.stale・文は帯と同じ）', e && e.stale === true && !e.auth && !e.conflict && !e.refused && e.message === x.api.MSG && x.calls.length === before, [e && e.message, x.calls]);
    }
    t('★  └ 記録は1回だけ・URL と合言葉を書かない', x.notes.length === 1 && x.notes[0][0] === 'gas:ping' && /auth:なし/.test(x.notes[0][1]) && !/script\.google|aikotoba|token/i.test(JSON.stringify(x.notes)), x.notes);
    await x.api.ping();
    t('  └ 2回目の ping でも記録を増やさない', x.notes.length === 1, x.notes);
  }
  {
    const x = box({ ans: { ping: { ok: true, time: 'T', auth: 'grace', codeVersion: '2026-10-01.1' } } });
    await x.api.ping();
    t('★auth が "grace"（"ok" 以外）でも古いとする・記録に版表記を書く', x.api.stale() === true && /auth:grace/.test(x.notes[0][1]) && /2026-10-01\.1/.test(x.notes[0][1]), x.notes);
  }
  /* 2: 貼り替えた後は戻る */
  {
    const ans = { ping: { ok: true, time: 'T' }, get: { ok: true, doc: { clientName: 'テスト 一郎' } } };
    const x = box({ ans });
    await x.api.ping();
    ans.ping = { ok: true, time: 'T', auth: 'ok', role: 'full' };
    await x.api.ping();
    const r = await x.api.syncCall('get', { name: 'テスト 一郎' });
    t('★auth:"ok" に戻ったら帯を消し、読込を送る', x.api.stale() === false && x.bar.hidden === true && r && r.doc && x.calls.indexOf('get') >= 0, [x.bar, x.calls]);
  }
  /* 新しい答え（auth:'ok'）なら何も変わらない */
  {
    const x = box({ ans: { ping: { ok: true, time: 'T', auth: 'ok', role: 'full', codeVersion: '2026-11-03.1', cutover: false } } });
    await x.api.ping();
    const e = await run(x.api.syncCall('save', { doc: { clientName: 'テスト 一郎' } }));
    t('★auth:"ok" → 止めない・帯を出さない・記録しない', x.api.stale() === false && e === null && x.bar.hidden === true && x.notes.length === 0 && x.calls.join() === 'ping,save', [e, x.calls, x.notes]);
  }
  /* 3: 分からない時は今の状態のまま */
  {
    const ans = { ping: new Error('クラウドと通信できませんでした') };
    const x = box({ ans });
    await run(x.api.ping());
    t('★ping が届かない → 止めない（帯を出さない）', x.api.stale() === false && x.bar.hidden === true);
    const au = new Error('合言葉が違うか'); au.auth = true;
    ans.ping = au;
    await run(x.api.ping());
    t('★ping が合言葉で断られた → 古いとは決めない', x.api.stale() === false && x.bar.hidden === true);
    ans.ping = { ok: true, time: 'T' };
    await x.api.ping();
    ans.ping = new Error('クラウドと通信できませんでした');
    await run(x.api.ping());
    t('★古いと分かった後に ping が届かない → 止めたまま（帯も残す）', x.api.stale() === true && x.bar.hidden === false);
  }
  /* 4: 保存は確かめの途中なら答えを待つ・読込は待たずに応答の後で捨てる */
  {
    let release;
    const ans = { ping: () => new Promise(ok => { release = () => ok({ ok: true, time: 'T' }); }), save: { ok: true, saved: {} }, get: { ok: true, doc: null } };
    const x = box({ ans });
    const pp = x.api.ping();
    const sp = run(x.api.syncCall('save', { doc: {} }));
    const gp = run(x.api.syncCall('get', { name: 'テスト 一郎' }));
    await tick();
    t('★確かめの途中: 読込は待たずに送る・保存はまだ送らない', x.calls.indexOf('get') >= 0 && x.calls.indexOf('save') < 0, x.calls);
    release();
    await pp;
    const se = await sp, ge = await gp;
    t('★  └ 古いと分かった → 保存は送らずに止める', se && se.stale === true && x.calls.indexOf('save') < 0, [se && se.message, x.calls]);
    t('★  └ 先に送った読込は、応答の後に捨てる（e.stale）', ge && ge.stale === true, ge && ge.message);
  }
  {
    let release;
    const ans = { ping: () => new Promise(ok => { release = () => ok({ ok: true, time: 'T', auth: 'ok' }); }), save: { ok: true, saved: {} } };
    const x = box({ ans });
    const pp = x.api.ping();
    const sp = run(x.api.syncCall('save', { doc: {} }));
    await tick();
    release();
    await pp;
    t('★確かめの途中の保存 → auth:"ok" と分かったら送る', (await sp) === null && x.calls.join() === 'ping,save', x.calls);
  }
  {
    const ans = { ping: () => Promise.reject(new Error('クラウドと通信できませんでした')), save: { ok: true, saved: {} } };
    const x = box({ ans });
    const pp = run(x.api.ping());
    const sp = run(x.api.syncCall('save', { doc: {} }));
    await pp;
    t('★確かめが届かない → 保存は止めずに送る（分からない時は止めない）', (await sp) === null && x.calls.join() === 'ping,save', x.calls);
  }
  /* 5: 起動の時・1時間ごと・隠れている間は休む */
  {
    const x = box({ ans: { ping: { ok: true, time: 'T', auth: 'ok' } } });
    x.api.authWatch();
    await tick();
    t('★起動の時に1回 ping を打つ', x.calls.join() === 'ping', x.calls);
    t('  └ 1分ごとに「1時間たったか」を見る・見えた時にも見る', x.intervals.length === 1 && x.intervals[0].ms === 60000 && typeof x.listeners.visibilitychange === 'function');
    x.api.authWatch();
    t('  └ 2回呼んでも見張りは1つ', x.intervals.length === 1);
    x.intervals[0].fn(); await tick();
    t('★1時間たつまでは打たない', x.calls.length === 1, x.calls);
    x.api.setAt(Date.now() - 60 * 60 * 1000 - 1);
    x.doc.hidden = true;
    x.intervals[0].fn(); await tick();
    t('★隠れている間は1時間を過ぎても打たない', x.calls.length === 1, x.calls);
    x.doc.hidden = false;
    x.listeners.visibilitychange(); await tick();
    t('★見えた時に1時間を過ぎていれば1回打つ', x.calls.length === 2, x.calls);
    x.listeners.visibilitychange(); await tick();
    t('  └ 続けては打たない', x.calls.length === 2, x.calls);
    x.api.setAt(Date.now() - 60 * 60 * 1000 - 1);
    x.intervals[0].fn(); await tick();
    t('★見えている間は1時間ごとに打つ', x.calls.length === 3, x.calls);
  }
  {
    const x = box({ configured: false });
    x.api.authWatch(); await tick();
    t('接続先の無い端末では打たない', x.calls.length === 0, x.calls);
  }
  /* 7: 入口が全部 syncCall を通る */
  {
    const body = (n) => { try { return cutF(n, 'async '); } catch (e) { return ''; } };
    t('★一覧・読込・保存・削除は syncCall を通る', /syncCall\('list'/.test(body('list')) && /syncCall\('get'/.test(body('get')) && /syncCall\('save'/.test(body('save')) && /syncCall\('delete'/.test(body('del')), null);
    t('★ping は syncCall を通らない（止めた後も確かめ直せる）', /gasCall\('ping'/.test(body('ping')) && !/syncCall/.test(body('ping')));
    const callers = (SRC.match(/\bgasCall\('(\w+)'/g) || []).map((s) => s.replace(/.*'(\w+)'/, '$1'));
    t('★gasCall を直接呼ぶのは ping だけ', callers.length === 1 && callers[0] === 'ping', callers);
    /* 止めた保存・削除の扱い（端末には残す・保留に積まない・次の保存で突き合わせる印） */
    const sb = (SRC.match(/\} else if \(err && err\.stale\) \{([\s\S]*?)\} else if \(\(err && err\.auth\)/) || [])[1] || '';
    t('★止めた保存: 保留に積まず、突き合わせる印を残す（cloudUnverified・authUnverified・markConfirm）', sb !== '' && !/queuePending/.test(sb) && /cloudUnverified\.add\(name\)/.test(sb) && /authUnverified\.add\(name\)/.test(sb) && /CloudSync\.markConfirm\(name\)/.test(sb), sb.slice(0, 200));
    const db = (SRC.match(/if \(err && \(err\.auth \|\| err\.stale\)\) \{([\s\S]*?)return;/) || [])[1] || '';
    t('★止めた削除: 端末の図を消さず、保留に積まない', db !== '' && !/removeLocal|queuePending/.test(db), db.slice(0, 200));
    t('★保存の前の取得で止めた時も「競合なし」と読み替えない', (SRC.match(/if \(e && \(e\.auth \|\| e\.stale\)\) throw e;/g) || []).length === 2);
    t('帯は印刷しない・閉じるボタンを持たない', /@media print\{\.geno-stale-bar\{display:none !important\}\}/.test(SRC) && /<div class="geno-stale-bar" id="genoStaleBar" role="alert" hidden><\/div>/.test(SRC));
    t('起動の時に見張りを始める・接続先を保存したら確かめ直す', /CloudSync\.authWatch\(\);/.test(SRC) && /CloudSync\.authCheck\(true\);/.test(SRC));
  }
  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
