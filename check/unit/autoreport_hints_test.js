/* 不具合の自動報告に「手がかり」と「画面の公開時刻」を付ける試験（2026-11-21 新設・代表者の決定「案1」）
   実行: node check/unit/autoreport_hints_test.js
   なぜ要るか: 自動報告はエラーの種類と場所しか送らず、夜間修復が原因を決められないまま「要情報」に戻していた
     （2026-10〜11 の8件。原因は人が本番の記録を引いて決めた: 401 PGRST303・時間切れ・404 PGRST202 など）。
   守りたいこと:
     1. su-errors.js の hintOf が、例外の物から決まった形の値（区分・HTTP の番号・データベースの符号）だけを取り出す。
        文の中身（氏名などが入りうる message）は手がかりに入らない
     2. 本物の supabase-js-2.112.4.js が返す通信の失敗・断り・関数が無い時の物が、それぞれの区分になる
     3. onReport の記録先に5つ目として渡る（note と report の両方・登録より前の分も）。古い記録先（3つ・4つ目まで）は今までどおり
     4. su-report.js の hintLine が送ってよい形（allowlist）だけを1行にする。形の違う値は捨てる
     5. 自動報告の本文: 「エラー:」の行は今までと同じ（受け口が題名と束ね方をこの行から作る）・その次に「手がかり:」の行
     6. 版の行: build/version の印が無い画面は、画面の公開時刻（document.lastModified）。印が無く「今」が返る時は「記載なし」 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
let finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 途中で止まりました'); process.exitCode = 3; } });

function cut(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); }
  throw new Error('閉じない: ' + head);
}

/* su-errors.js を箱で動かす。window の error の受け手も取り出す */
function errorsBox() {
  const listeners = {};
  let now = 1000000;
  const ctx = { console: { warn() {}, error() {}, log() {} }, Date: { now: () => now }, String, JSON, Object, Number, Math, Error, TypeError, setTimeout: () => 0, clearTimeout() {},
    document: { body: null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, style: {} }), querySelector: () => null, addEventListener() {} },
    addEventListener: (k, f) => { listeners[k] = f; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('su-errors.js'), ctx, { filename: 'su-errors.js' });
  return { E: ctx.SUErrors, listeners, ctx, tick: (ms) => { now += ms; } };
}
/* 箱の中の Error（instanceof を箱の中で効かせる） */
const inBox = (B, expr) => vm.runInContext(expr, B.ctx);

function supabaseBox() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Headers, Request, Response, AbortController,
    TextEncoder, TextDecoder, fetch, structuredClone, queueMicrotask, atob, btoa, crypto: globalThis.crypto, navigator: { userAgent: 'node' }, WebSocket: function () {} };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('supabase-js-2.112.4.js'), ctx);
  return ctx.supabase;
}

(async () => {
  console.log('\n— 1. 例外の物から決まった形の値だけを取り出す（su-errors.js の hintOf）—');
  const B = errorsBox();
  const got = [];
  B.E.onReport((k, b, w, from, hint) => got.push({ k, w, from, hint }));
  let seq = 0;
  /* note の間引き（同じ組み合わせは30秒に1回）に当たらないよう、場所を毎回変える */
  const hintOfNote = (x) => { B.E.note('保存・同期の失敗', x, 'test:' + (++seq)); return got[got.length - 1].hint; };
  const H = (x) => { const h = hintOfNote(x); return h.cls + '|' + h.status + '|' + h.code; };
  t('supabase-js の通信の失敗（素の物）→ 通信の失敗', H({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }) === '通信の失敗|0|');
  t('Safari の通信の失敗（Load failed）→ 通信の失敗', H({ message: 'TypeError: Load failed' }) === '通信の失敗|0|');
  t('fetch が投げる TypeError（Failed to fetch）も 通信の失敗', H(inBox(B, "new TypeError('Failed to fetch')")) === '通信の失敗|0|');
  t('名前が NetworkError（ワークスケジュールの記録）→ 通信の失敗', H(inBox(B, "(function(){var e=new Error('通信失敗');e.name='NetworkError';return e;})()")) === '通信の失敗|0|');
  t('★券の発行時刻の断り（401・PGRST303）→ 断り・HTTP 401・符号 PGRST303', H({ status: 401, code: 'PGRST303', message: 'JWT issued at future' }) === '断り|401|PGRST303');
  t('権限の断り（42501）→ 断り・符号 42501', H({ code: '42501', message: '勤怠の管理を許された事務所・管理者だけが使えます' }) === '断り|0|42501');
  t('Error の timeout → 時間切れ', H(inBox(B, "new Error('timeout')")) === '時間切れ|0|');
  t('名前が AbortError → 時間切れ', H(inBox(B, "(function(){var e=new Error('The user aborted a request.');e.name='AbortError';return e;})()")) === '時間切れ|0|');
  t('QuotaExceededError → 端末の保存領域', H(inBox(B, "(function(){var e=new Error('The quota has been exceeded.');e.name='QuotaExceededError';return e;})()")) === '端末の保存領域|0|');
  t('サーバーの失敗（HTTP 503）→ サーバーの失敗', H({ status: 503, message: 'Service Unavailable' }) === 'サーバーの失敗|503|');
  t('★画面のコードの例外（TypeError）→ コードの例外', H(inBox(B, "new TypeError('x is not a function')")) === 'コードの例外|0|');
  t('関数が無い（PGRST202・404）→ 不明・HTTP 404・符号 PGRST202', H({ status: 404, code: 'PGRST202', message: 'Could not find the function' }) === '不明|404|PGRST202');
  t('文字だけ・null → 不明（番号・符号なし）', H('保存できませんでした') === '不明|0|' && H(null) === '不明|0|');
  t('文字だけの「タイムアウト」→ 時間切れ（反証レビュー）', H('タイムアウト') === '時間切れ|0|' && H('時間切れ') === '時間切れ|0|');
  t('Error の「タイムアウト」→ 時間切れ', H(inBox(B, "new Error('タイムアウト')")) === '時間切れ|0|');
  t('画面が作り直した Error(network) → 通信の失敗（反証レビュー）', H(inBox(B, "new Error('network')")) === '通信の失敗|0|');
  t('文字だけの通信の決まり文句 → 通信の失敗', H('TypeError: Failed to fetch') === '通信の失敗|0|');
  t('文の途中にタイムアウトがあるだけの文字は 不明（決まり文句だけ）', H('保存がタイムアウトしました。見本 太郎') === '不明|0|');
  {
    const h = hintOfNote({ status: '401abc', code: '見本 太郎', name: 'X', message: '見本 太郎 様の記録 "{"name":"見本"}"' });
    t('★形の違う番号・符号は入れない（文の中身は手がかりに入らない）', h.status === 0 && h.code === '' && h.cls === '不明', h);
    t('手がかりの中身は cls・status・code の3つだけ', JSON.stringify(Object.keys(h).sort()) === JSON.stringify(['cls', 'code', 'status']), Object.keys(h));
    t('手がかりのどこにも文の中身が無い', !/見本/.test(JSON.stringify(h)), h);
  }
  t('小文字や長さの違う符号は入れない', hintOfNote({ code: 'pgrst303' }).code === '' && hintOfNote({ code: '425011' }).code === '' && hintOfNote({ code: 'PGRST3030' }).code === '');
  t('番号は 100〜599 の整数だけ', hintOfNote({ status: 99 }).status === 0 && hintOfNote({ status: 600 }).status === 0 && hintOfNote({ status: 401.5 }).status === 0 && hintOfNote({ status: '403' }).status === 403);

  console.log('\n— 2. 本物の supabase-js が返す物の区分 —');
  {
    const sb = supabaseBox();
    const mk = (f) => sb.createClient('https://example.supabase.co', 'anon', { global: { fetch: f }, auth: { persistSession: false, autoRefreshToken: false } });
    const json = (status, body) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    const net = await mk(() => Promise.reject(new TypeError('Failed to fetch'))).rpc('kv_get', {});
    const den = await mk(json(403, { code: '42501', message: 'permission denied', details: null, hint: null })).rpc('kv_get', {});
    const skew = await mk(json(401, { code: 'PGRST303', message: 'JWT issued at future', details: null, hint: null })).rpc('kv_get', {});
    const gone = await mk(json(404, { code: 'PGRST202', message: 'Could not find the function public.kv_get', details: null, hint: null })).rpc('kv_get', {});
    t('通信の失敗 → 通信の失敗', H(net.error) === '通信の失敗|0|', net.error);
    t('403・42501 → 断り・符号 42501（supabase-js の失敗の物は status を持たない＝番号は 0）', H(den.error) === '断り|0|42501', den.error);
    t('★401・PGRST303 → 断り・符号 PGRST303', H(skew.error) === '断り|0|PGRST303', skew.error);
    t('404・PGRST202 → 不明・符号 PGRST202', H(gone.error) === '不明|0|PGRST202', gone.error);
    const fn = (f) => mk(f).functions.invoke('su-report', { body: { x: 1 } });
    const f401 = await fn(json(401, { msg: 'Invalid JWT' }));
    const f500 = await fn(json(500, { error: 'boom' }));
    const fnet = await fn(() => Promise.reject(new TypeError('Failed to fetch')));
    t('★関数の 401（FunctionsHttpError・番号は context.status）→ 断り・HTTP 401（反証レビュー）', H(f401.error) === '断り|401|', [f401.error && f401.error.name, H(f401.error)]);
    t('関数の 500 → サーバーの失敗・HTTP 500', H(f500.error) === 'サーバーの失敗|500|', H(f500.error));
    t('★関数への通信の失敗（FunctionsFetchError）→ 通信の失敗', H(fnet.error) === '通信の失敗|0|', [fnet.error && fnet.error.name, H(fnet.error)]);
  }

  console.log('\n— 3. 記録先へ5つ目として渡る —');
  {
    const C = errorsBox();
    C.E.note('保存・同期の失敗', { code: '42501', message: 'x' }, 'early:1');   // 登録より前
    const all = [], old = [];
    C.E.onReport(function () { all.push(Array.prototype.slice.call(arguments)); });
    C.E.onReport((k, b, w) => old.push([k, b, w]));
    t('登録より前の note も5つ目に手がかりが付いて渡る', all.length === 1 && all[0][3] === 'note' && all[0][4] && all[0][4].code === '42501', all);
    C.E.report('保存の失敗', inBox(C, "new TypeError('x is not a function')"), 'rep:1');
    const r = all[all.length - 1];
    t('report は4つ目が無く（undefined）・5つ目に手がかり', r[3] === undefined && r[4] && r[4].cls === 'コードの例外', r);
    t('古い記録先（3つだけ読む）は今までどおり種類・要約・場所を受け取る', old.length === 2 && old[1][0] === '保存の失敗' && old[1][1] === 'x is not a function' && old[1][2] === 'rep:1', old);
    C.listeners.error({ message: 'Script error.', filename: '', lineno: 0, error: null });
    const w = all[all.length - 1];
    t('★物も場所も無いスクリプトエラー → ブラウザが伏せた例外', w[0] === 'スクリプトエラー' && w[4] && w[4].cls === 'ブラウザが伏せた例外', w);
    C.tick(31000);
    C.listeners.error({ message: 'Uncaught TypeError: a is undefined', filename: 'https://x/care-tools/weight-record.html?id=1', lineno: 12, error: inBox(C, "new TypeError('a is undefined')") });
    const w2 = all[all.length - 1];
    t('物のあるスクリプトエラー → 物から区分（コードの例外）', w2[2] === 'weight-record.html:12' && w2[4].cls === 'コードの例外', w2);
    C.tick(31000);
    C.listeners.unhandledrejection({ reason: { message: 'TypeError: Failed to fetch' } });
    const u = all[all.length - 1];
    t('未処理の失敗も理由の物から区分（通信の失敗）', u[0] === '未処理の失敗' && u[4].cls === '通信の失敗', u);
  }

  console.log('\n— 4. 送ってよい形だけを1行にする（su-report.js の hintLine）—');
  const R = read('su-report.js');
  const rep = new Function((R.match(/var HINT_CLS = \[[^\]]*\];/) || [''])[0] + '\n' + cut(R, 'function hintLine(') + '\nreturn { hintLine: hintLine };')();
  t('★区分・番号・符号がそろう時', rep.hintLine({ cls: '断り', status: 401, code: 'PGRST303' }) === '区分 断り ／ HTTP 401 ／ 符号 PGRST303', rep.hintLine({ cls: '断り', status: 401, code: 'PGRST303' }));
  t('番号・符号が無い時は区分だけ', rep.hintLine({ cls: '時間切れ', status: 0, code: '' }) === '区分 時間切れ');
  t('★知らない区分（文の中身など）は行を出さない', rep.hintLine({ cls: '見本 太郎 様', status: 401, code: '42501' }) === '' && rep.hintLine(null) === '' && rep.hintLine('断り') === '');
  t('★形の違う番号・符号は捨てる', rep.hintLine({ cls: '不明', status: '401 見本', code: '見本 太郎' }) === '区分 不明' && rep.hintLine({ cls: '不明', status: 4010, code: 'pgrst303' }) === '区分 不明');
  t('区分の言葉は su-errors.js と su-report.js で同じ8つ', (read('su-errors.js').match(/var HINT_CLS = \[[^\]]*\];/) || [''])[0] === (R.match(/var HINT_CLS = \[[^\]]*\];/) || ['x'])[0]);

  console.log('\n— 5. 自動報告の本文 —');
  {
    const fx = new Function('TOOL', 'FILE', 'facts', 'hintLine',
      cut(R, 'function composeAuto(') + '\nreturn composeAuto;');
    const composeAuto = fx('勤怠管理', 'kintai.html', () => ['端末: Mac / Chrome / 画面 1×1（倍率1）', '役割: 事務所端末 ／ 接続: 設定あり', '版: 記載なし ／ この画面を開いてから 0分'], rep.hintLine);
    const withH = composeAuto('保存・同期の失敗：NetworkError', 'ws:勤務表の読み取り', { cls: '断り', status: 0, code: 'PGRST303' }).split('\n');
    const noH = composeAuto('保存・同期の失敗：NetworkError', 'ws:勤務表の読み取り').split('\n');
    t('★「エラー:」の行は手がかりがあっても無くても同じ（受け口の題名・束ね方は変わらない）', withH[2] === noH[2] && withH[2] === 'エラー: 保存・同期の失敗：NetworkError（ws:勤務表の読み取り）', [withH[2], noH[2]]);
    t('★その次の行に「手がかり:」', withH[3] === '手がかり: 区分 断り ／ 符号 PGRST303', withH[3]);
    t('手がかりが無ければ行を足さない（今までの本文と同じ）', noH[3] === '──── 自動で付いた情報 ────', noH[3]);
    t('受け口が拾う見出し（エラー:・端末:・ツール:）と手がかりの行が重ならない', !/^(エラー|端末|ツール): /.test(withH[3]));
  }

  console.log('\n— 6. 版の行（画面の公開時刻）—');
  {
    const T0 = Date.parse('2026-11-21T03:10:00Z');
    const mkBuild = (meta, lm) => new Function('document', 'T0', cut(R, 'function pad2(') + '\n' + cut(R, 'function build(') + '\nreturn build;')(
      { querySelector: () => (meta ? { content: meta } : null), lastModified: lm }, T0);
    const d = new Date(T0 - 3600 * 1000);
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const want = '画面の公開 ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const lm = pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    t('★印の無い画面は公開時刻（document.lastModified）', mkBuild(null, lm)() === want, [mkBuild(null, lm)(), want]);
    t('印（meta build）がある画面は今までどおり印', mkBuild('2026-11-21.3', lm)() === '2026-11-21.3');
    const nowLm = new Date();   /* 読んだ時刻（今）。開いた時刻（T0）ではなく、読んだ時刻と比べる（反証レビュー） */
    const nowStr = pad(nowLm.getMonth() + 1) + '/' + pad(nowLm.getDate()) + '/' + nowLm.getFullYear() + ' ' + pad(nowLm.getHours()) + ':' + pad(nowLm.getMinutes()) + ':' + pad(nowLm.getSeconds());
    t('最終更新の印が無く「今」が返る時は 記載なし', mkBuild(null, nowStr)() === '記載なし', mkBuild(null, nowStr)());
    t('読めない値は 記載なし', mkBuild(null, 'abc')() === '記載なし' && mkBuild(null, undefined)() === '記載なし');
    {
      /* 最終更新の印が無い所では、ブラウザは読むたびに「今」を返す。開いてから10秒後に起きたエラーでも 記載なし（反証レビュー） */
      const doc = { querySelector: () => null };
      Object.defineProperty(doc, 'lastModified', { get() { const n = new Date(); return pad(n.getMonth() + 1) + '/' + pad(n.getDate()) + '/' + n.getFullYear() + ' ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds()); } });
      const b2 = new Function('document', 'T0', cut(R, 'function pad2(') + '\n' + cut(R, 'function build(') + '\nreturn build;')(doc, Date.now() - 10000);
      t('★読むたびに「今」が返る時は、開いてから時間がたっていても 記載なし', b2() === '記載なし', b2());
    }
  }

  console.log('\n— 7. 記録から送る本文まで（su-errors.js の note → su-report.js の受け手 → autoSend → send）—');
  {
    const C = errorsBox();
    const sent = [];
    const pick = (re) => (R.match(re) || [''])[0];
    const code = [
      "var TOOL = '見本の画面', FILE = 'kintai.html';",
      pick(/var NOTE_KIND = '[^']*';/), pick(/var AUTO_NOTE_MAX = \d+;/), pick(/var AUTO_MAX_PER_LOAD = \d+;/),
      'var ERRORS = [], NOTES = [], autoSent = 0, autoNoteSent = 0, autoNoteWhere = {};',
      pick(/var HINT_CLS = \[[^\]]*\];/),
      'function canSend() { return true; } function autoThrottled() { return false; }',
      "function facts() { return ['端末: Mac / Chrome', '版: 記載なし ／ この画面を開いてから 0分']; }",
      'function send(b) { sent.push(b); return Promise.resolve(); }',
      cut(R, 'function errType('), cut(R, 'function cleanWhere('), cut(R, 'function pushErr('), cut(R, 'function hintLine('),
      cut(R, 'function composeAuto('), cut(R, 'function autoSend('),
      cut(R, 'window.SUErrors.onReport(function') + ');'
    ].join('\n');
    new Function('window', 'sent', code)({ SUErrors: C.E }, sent);
    C.E.note('保存・同期の失敗', { code: 'PGRST303', message: 'JWT issued at future 見本 太郎' }, 'kintai:読み込み');
    const body = sent[0] || '';
    const L = body.split('\n');
    t('★記録が受け手を通って送る本文になり、「エラー:」の次に「手がかり:」が出る', L[2] === 'エラー: 保存・同期の失敗：エラー（kintai:読み込み）' && L[3] === '手がかり: 区分 断り ／ 符号 PGRST303', L.slice(2, 4));
    t('★送る本文のどこにも文の中身（氏名）が無い', sent.length === 1 && !/見本 太郎|issued/.test(body), body);
    C.E.report('保存の失敗', 'ただの文字', 'kintai:保存');
    t('手がかりの区分が 不明 の時も行は出る（区分 不明）', /\n手がかり: 区分 不明\n/.test(sent[1] || ''), sent[1]);
  }

  finished = true;
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外: ' + (e && e.stack || e)); finished = true; process.exit(1); });
