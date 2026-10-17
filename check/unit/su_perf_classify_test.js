/* su-perf.js の通信の分け方の試験（2026-10-17・Phase A0）。実物の su-perf.js を vm で動かし、架空の URL を流す。

   守りたいこと:
   1. Supabase（https://<名前>.supabase.co/）は sbN・sbMs に数え、起動時の分は sb に {s, d, ep} で残す。
      ep は URL の最後の空でない区切りだけ（24字まで）。URL の全体・クエリ・鍵・接続先の名前は残さない
   2. 同じサイトの通信は、クエリを除いたパスが .json で終わるものだけ jsonN・jsonMs に数え、起動時の分は
      json に {s, d, f} で残す（f はファイル名だけ・40字まで）。.js などほかの同じサイトのファイルは今までどおり数えない
   3. GAS は今までどおり（ep は配備IDの末尾4文字）。CDN などは ext。Supabase と JSON はもう ext に入れない
   4. netDone＝起動時の GAS・Supabase・JSON の明細すべての「開始＋所要」の最大（1件も無ければ null）。gasDone は今までどおり
   5. 記録の版 v は 2。同じ通信を2回数えない
   実行: node check/unit/su_perf_classify_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-perf.js'), 'utf8');
const ORIGIN = 'https://tools.example.test';

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}

/* entries: [url, startTime, duration, initiatorType] */
function run(entries) {
  const saved = [];
  const listeners = {};
  const res = entries.map(([name, startTime, duration, it]) =>
    ({ name, startTime, duration, initiatorType: it || 'fetch', transferSize: 0 }));
  const store = {
    put(copy) { saved.push(copy); },
    count() { return {}; }                       /* 古い分を詰める処理は動かさない（onsuccess を呼ばない） */
  };
  const db = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }) };
  const ctx = {
    localStorage: { getItem: () => null },
    performance: {
      now: () => 1000,
      getEntriesByType: (type) => type === 'resource' ? res : (type === 'navigation' ? [{ type: 'navigate', decodedBodySize: 2048, transferSize: 300, responseStart: 50, domContentLoadedEventEnd: 400, loadEventEnd: 500 }] : [])
    },
    indexedDB: {
      open() {
        const req = { result: db };
        Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess(); });
        return req;
      }
    },
    location: { origin: ORIGIN, pathname: '/care-schedule.html' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 },
    document: { readyState: 'loading', visibilityState: 'visible', addEventListener() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
    setTimeout: () => 0, clearTimeout() {},
    Promise, JSON, Math, Date, URL, String, Number, Object, Array, isFinite
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'su-perf.js' });
  return {
    save: async () => { listeners.pagehide(); await new Promise((r) => setImmediate(r)); return saved[saved.length - 1]; },
    SUPerf: ctx.SUPerf
  };
}

(async () => {
  console.log('\n— 1〜3. 分け方 —');
  const P = run([
    ['https://script.google.com/macros/s/AKfyTESTdeploy1234/exec?action=getAll&token=SECRET1', 100, 300],
    ['https://abcdefgh.supabase.co/rest/v1/rpc/kv_get?select=*&apikey=SECRET2', 50, 900],
    ['https://abcdefgh.supabase.co/auth/v1/token?grant_type=refresh_token', 10, 100],
    ['https://abcdefgh.supabase.co/rest/v1/kv_head/', 30, 40],
    ['https://abcdefgh.supabase.co/rest/v1/rpc/long_function_name_over_24_chars', 60, 10],
    ['https://abcdefgh.supabase.co/rest/v1/rpc/kv_get', 25000, 70],          /* 起動後（20秒より後）＝回数と合計だけ */
    [ORIGIN + '/su-backend.json?v=123', 5, 20],
    [ORIGIN + '/data/facility-profile.json#x', 7, 30],
    [ORIGIN + '/su-backend.json?v=124', 30000, 15],                          /* 起動後 */
    [ORIGIN + '/su-kv.js?v=2026-10-12.3', 3, 5, 'script'],                  /* 同じサイトの .js は数えない */
    [ORIGIN + '/api?file=a.json', 8, 5],                                     /* .json はクエリの中だけ＝数えない */
    ['https://cdn.example.test/lib.js', 1, 50, 'script'],
    ['http://plain.supabase.co/rest/v1/rpc/kv_get', 2, 5],                   /* https でない＝Supabase と見ない */
    ['https://evil.example.test/x.supabase.co/rest', 4, 5]                   /* 名前に含むだけ＝Supabase と見ない */
  ]);
  const r1 = await P.save();
  t('記録の版 v は 2', r1.v === 2, r1.v);
  t('GAS は今までどおり1件（ep は末尾4文字）', r1.gasN === 1 && r1.gas.length === 1 && r1.gas[0].ep === '…1234', r1.gas);
  t('Supabase の回数は起動後の分も含めて5回・合計ms', r1.sbN === 5 && r1.sbMs === 900 + 100 + 40 + 10 + 70, [r1.sbN, r1.sbMs]);
  t('Supabase の明細は起動時の4件だけ', r1.sb.length === 4, r1.sb);
  t('ep は最後の区切り（kv_get・token・末尾の / は飛ばして kv_head）',
    r1.sb[0].ep === 'kv_get' && r1.sb[1].ep === 'token' && r1.sb[2].ep === 'kv_head', r1.sb.map((x) => x.ep));
  t('ep は24字まで', r1.sb[3].ep === 'long_function_name_over_' && r1.sb[3].ep.length === 24, r1.sb[3].ep);
  t('Supabase の明細は {s, d, ep} だけ', r1.sb.every((x) => Object.keys(x).join() === 's,d,ep'), r1.sb);
  t('同じサイトの JSON は起動後の分も含めて3回・合計ms', r1.jsonN === 3 && r1.jsonMs === 20 + 30 + 15, [r1.jsonN, r1.jsonMs]);
  t('JSON の明細は起動時の2件で、ファイル名だけ（クエリ・# ・フォルダを落とす）',
    r1.json.length === 2 && r1.json[0].f === 'su-backend.json' && r1.json[1].f === 'facility-profile.json', r1.json);
  t('JSON の明細は {s, d, f} だけ', r1.json.every((x) => Object.keys(x).join() === 's,d,f'), r1.json);
  const hosts = r1.ext.map((x) => x.h);
  t('CDN・https でない・名前に含むだけの3件は ext', hosts.join() === 'cdn.example.test,plain.supabase.co,evil.example.test', hosts);
  t('Supabase と同じサイトは ext に入れない', !hosts.some((h) => /abcdefgh|tools\.example/.test(h)), hosts);
  const txt = JSON.stringify(r1);
  t('残した記録に鍵・合言葉・クエリが無い', !/SECRET|apikey|grant_type|select=|token=|\?/.test(txt), txt.match(/SECRET|apikey|grant_type|select=|token=|\?/g));
  t('残した記録に Supabase の接続先の名前と GAS の配備IDの全体が無い', !/abcdefgh|AKfyTEST/.test(txt), txt.match(/abcdefgh|AKfyTEST/g));

  console.log('\n— 4. 読み込み完了 —');
  t('gasDone は今までどおり GAS だけ（100+300）', r1.gasDone === 400, r1.gasDone);
  t('netDone は GAS・Supabase・JSON の最後（50+900）', r1.netDone === 950, r1.netDone);
  const E = run([['https://cdn.example.test/lib.js', 1, 50, 'script']]);
  const r2 = await E.save();
  t('起動時の通信が1件も無ければ netDone も gasDone も null', r2.netDone === null && r2.gasDone === null, [r2.netDone, r2.gasDone]);
  t('空でも sb・json は空の配列で残る', Array.isArray(r2.sb) && !r2.sb.length && Array.isArray(r2.json) && !r2.json.length && r2.sbN === 0 && r2.jsonN === 0, r2);
  const J = run([[ORIGIN + '/su-backend.json', 10, 990]]);
  const r3 = await J.save();
  t('JSON だけでも netDone が出る（10+990）', r3.netDone === 1000 && r3.gasDone === null, [r3.netDone, r3.gasDone]);

  console.log('\n— 5. 二重に数えない・ready —');
  const r4 = await P.save();
  t('もう一度保存しても回数は増えない', r4.sbN === 5 && r4.jsonN === 3 && r4.gasN === 1 && r4.sb.length === 4, [r4.sbN, r4.jsonN, r4.gasN]);
  P.SUPerf.ready(); P.SUPerf.ready();
  const r5 = await P.save();
  t('ready() は最初の1回の時刻を残す', r5.ready === 1000, r5.ready);

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験が途中で止まった: ' + (e && e.stack || e)); process.exit(1); });
