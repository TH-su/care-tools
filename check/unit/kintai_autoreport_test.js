/* 勤怠管理の「不具合の自動報告」に、不具合でない失敗を回さない試験（2026-11-20 新設・夜間修復の要情報 reports#14・#15）
   実行: node check/unit/kintai_autoreport_test.js
   原因（本番の記録で確かめた）:
     #14 12:52 Windows: 「勤怠の管理者」に載っていない事務所のアカウントが開き、kintai_month_get が 403（42501）で断った
         → 画面は断りの帯を出したうえで note('読み込み') し、「勤怠管理：エラー（kintai:読み込み）」として自動報告された
     #15 17:14 Mac: 30秒ごとの読み直しの1回（08:14:23 UTC）だけがサーバーに届かず（前後は全部 200）
         → supabase-js が返す { message: 'TypeError: Failed to fetch' } を note('自動の読み直し') し、「TypeError」として自動報告された
   守りたいこと:
     1. 本物の supabase-js-2.112.4.js で、通信の失敗と 42501 の断りが「素のオブジェクト」で返ること（前提の確かめ）
     2. 直す前の流れで、2件の報告の文（種類と場所）が一字一句そろうこと（再現）
     3. isNetErr・isDenied が、通信の失敗・断りだけを拾い、画面のコードの例外（TypeError など）と okOr の断りは拾わないこと
     4. 読み直し: 1〜2回の通信の失敗は報告しない・3回続いたら1回だけ報告・読めたら数え直し・コードの例外は毎回報告
     5. 読み込み: 管理者でない人の断りと通信の失敗は報告せず帯で知らせる・管理者の断りとそのほかの失敗は報告する */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const K = read('kintai.js');

/* 関数を1つ、本文の波かっこを数えて切り出す（文字列の中の波かっこは数えない程度の簡単な数え方。対象の関数には波かっこ入りの文字列が無い） */
function cut(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); }
  throw new Error('閉じない: ' + head);
}

/* 本物の supabase-js を、ブラウザの代わりの箱で動かす */
function supabaseBox() {
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Headers, Request, Response, AbortController,
    TextEncoder, TextDecoder, fetch, structuredClone, queueMicrotask, atob, btoa, crypto: globalThis.crypto, navigator: { userAgent: 'node' },
    WebSocket: globalThis.WebSocket || function () {} };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('supabase-js-2.112.4.js'), ctx);
  return ctx.supabase;
}
/* su-errors.js を箱で動かし、note の要約（onReport に渡る brief）を受け取る */
function errorsBox() {
  const listeners = {};
  const ctx = { console: { warn() {}, error() {}, log() {} }, Date, String, JSON, setTimeout, clearTimeout,
    document: { body: null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, style: {} }), querySelector: () => null, addEventListener() {} },
    addEventListener: (k, f) => { listeners[k] = f; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('su-errors.js'), ctx);
  const got = [];
  ctx.SUErrors.onReport((kind, brief, where, from) => got.push({ kind, brief, where, from }));
  return { E: ctx.SUErrors, got };
}
/* su-report.js の「種類と場所だけ」にする関数（errType・cleanWhere）を取り出す */
const R = read('su-report.js');
const rep = new Function(cut(R, 'function errType(') + '\n' + cut(R, 'function cleanWhere(') + '\nreturn { errType: errType, cleanWhere: cleanWhere };')();
/* 自動報告の「エラー:」の行（su-report.js の autoSend → composeAuto と同じ組み立て） */
function reportLine(kind, brief, where) {
  const w = rep.cleanWhere(where);
  return String(kind || 'エラー') + '：' + rep.errType(brief) + (w ? '（' + w + '）' : '');
}
/* kintai.js の見分けの関数 */
const kh = new Function(cut(K, 'function isNetErr(') + '\n' + cut(K, 'function isDenied(') + '\n' + cut(K, 'function okOr(') + '\nreturn { isNetErr: isNetErr, isDenied: isDenied, okOr: okOr };')();

(async () => {
  console.log('\n— 1. 本物の supabase-js が返す失敗の形 —');
  const sb = supabaseBox();
  const mk = (f) => sb.createClient('https://example.supabase.co', 'anon', { global: { fetch: f }, auth: { persistSession: false, autoRefreshToken: false } });
  const net = await mk(() => Promise.reject(new TypeError('Failed to fetch'))).rpc('kintai_month_get', { p_ym: '2026-11' });
  const den = await mk(() => Promise.resolve(new Response(JSON.stringify({ code: '42501', message: '勤怠の管理を許された事務所・管理者だけが使えます', details: null, hint: null }),
    { status: 403, headers: { 'content-type': 'application/json' } }))).rpc('kintai_month_get', { p_ym: '2026-11' });
  const netErr = net.error, denErr = den.error;
  t('通信の失敗: status 0・素のオブジェクト・message は「TypeError: Failed to fetch」', net.status === 0 && netErr && !(netErr instanceof Error) && netErr.message === 'TypeError: Failed to fetch', netErr && netErr.message);
  t('権限の断り: status 403・素のオブジェクト・code 42501', den.status === 403 && denErr && !(denErr instanceof Error) && denErr.code === '42501', denErr);

  console.log('\n— 2. 直す前の流れで、2件の報告の文がそろう（再現）—');
  {
    const { E, got } = errorsBox();
    E.note('勤怠管理', denErr, 'kintai:読み込み');
    E.note('勤怠管理', netErr, 'kintai:自動の読み直し');
    t('#14 の文「勤怠管理：エラー（kintai:読み込み）」', got[0] && reportLine(got[0].kind, got[0].brief, got[0].where) === '勤怠管理：エラー（kintai:読み込み）', got[0] && reportLine(got[0].kind, got[0].brief, got[0].where));
    t('#15 の文「勤怠管理：TypeError（kintai:自動の読み直し）」', got[1] && reportLine(got[1].kind, got[1].brief, got[1].where) === '勤怠管理：TypeError（kintai:自動の読み直し）', got[1] && reportLine(got[1].kind, got[1].brief, got[1].where));
  }

  console.log('\n— 3. 見分けの関数 —');
  let codeErr = null; try { const o = undefined; o.x = 1; } catch (e) { codeErr = e; }
  let okOrErr = null; try { kh.okOr({ ok: false, error: 'badym' }); } catch (e) { okOrErr = e; }
  const abortErr = { message: 'AbortError: The user aborted a request.', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' };
  t('通信の失敗は isNetErr', kh.isNetErr(netErr) === true);
  t('Safari の言い方（TypeError: Load failed）も isNetErr', kh.isNetErr({ message: 'TypeError: Load failed', code: '' }) === true);
  t('42501 の断りは isDenied・isNetErr ではない', kh.isDenied(denErr) === true && kh.isNetErr(denErr) === false);
  t('画面のコードの例外（本物の TypeError）は、どちらでもない＝報告に残る', codeErr instanceof TypeError && kh.isNetErr(codeErr) === false && kh.isDenied(codeErr) === false);
  t('message が「Failed to fetch」の本物の TypeError（Error の形）も isNetErr にしない＝コード由来は隠さない', kh.isNetErr(new TypeError('Failed to fetch')) === false);
  t('okOr の断り（DB の答えが ok:false）は、どちらでもない', okOrErr && kh.isNetErr(okOrErr) === false && kh.isDenied(okOrErr) === false);
  t('Error の形の 42501 は isDenied にしない（素のオブジェクトだけ）', (function () { const e = new Error('x'); e.code = '42501'; return kh.isDenied(e) === false; })());
  t('空・文字列・null は どちらでもない', [null, undefined, '', 'Failed to fetch'].every((x) => kh.isNetErr(x) === false && kh.isDenied(x) === false));
  t('打ち切り（AbortError）は isNetErr ではない＝今までどおり報告（読み直しは打ち切りを付けていない）', kh.isNetErr(abortErr) === false);

  console.log('\n— 4. 読み直し（quietReload）の報告の出し方 —');
  {
    const src = cut(K, 'function quietOk(') + '\n' + cut(K, 'function quietReload(');
    const decl = /var quietBusy = 0, quietSeq = 0;\n\s*var quietNetFails = 0;/.test(K);
    t('数える変数 quietNetFails を quietBusy・quietSeq の次の行で持つ（読み直しの試験の目印の行は変えない）', decl);
    /* 箱: 読み直しが使う画面の状態と部品を差し替えて、quietReload を本物の本文のまま動かす */
    const box = new Function('kh', 'env', [
      'var isNetErr = kh.isNetErr, okOr = kh.okOr;',
      'var quietBusy = 0, quietSeq = 0, quietNetFails = 0;',
      "var view = 'app', busy = false, month = {}, data = {}, dlgCtx = null, printAll = false, tab = 'day', gen = 1, ym = '2026-11';",
      "var document = { visibilityState: 'visible', activeElement: null };",
      'function $() { return { contains: function () { return false; } }; }',
      'function rpc() { return env.next(); }',
      'function note(w, e) { env.notes.push(w); }',
      'function recompute() { env.recomputes++; if (env.boom) { env.boom = false; var o; o.x = 1; } }',
      'function paint() {}', 'function sync() {}', 'function isLocked() { return false; }', 'function hm() { return ""; }',
      src,
      'return { reload: quietReload, fails: function () { return quietNetFails; } };'].join('\n'));
    const env = { notes: [], recomputes: 0, boom: false, next: null };
    const q = box(kh, env);
    const tick = async (res) => { env.next = () => res; q.reload(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
    const NET = () => Promise.resolve().then(() => { throw netErr; });
    const OK = () => Promise.resolve({ ok: true, month: {} });
    await tick(NET()); await tick(NET());
    t('通信の失敗が1〜2回なら報告しない（#15 はここで止まる）', env.notes.length === 0 && q.fails() === 2, env.notes);
    await tick(OK());
    t('読めたら続けての回数を0に戻す', q.fails() === 0 && env.notes.length === 0);
    await tick(NET()); await tick(NET()); await tick(NET()); await tick(NET()); await tick(NET());
    t('3回続けて通信できない時だけ、1回報告する（4回目以降は出さない）', env.notes.length === 1 && env.notes[0] === '自動の読み直し（通信が3回続けて失敗）', env.notes);
    t('報告の場所は su-report の決まった言葉の形のまま送れる', rep.cleanWhere('kintai:' + env.notes[0]) === 'kintai:自動の読み直し（通信が3回続けて失敗）');
    env.notes.length = 0;
    await tick(OK());
    env.boom = true; await tick(OK());
    t('読めた後の数え直しで起きたコードの例外（TypeError）は、毎回すぐ報告する', env.notes.length === 1 && env.notes[0] === '自動の読み直し', env.notes);
    env.notes.length = 0;
    await tick(Promise.resolve().then(() => { throw denErr; }));
    t('DB の断り（通信以外）は今までどおり報告する', env.notes.length === 1 && env.notes[0] === '自動の読み直し', env.notes);
    env.notes.length = 0;
    await tick(Promise.resolve({ ok: false, error: 'badym' }));
    t('okOr の断りも今までどおり報告する', env.notes.length === 1 && env.notes[0] === '自動の読み直し', env.notes);
  }

  console.log('\n— 5. 読み込み（load）の報告の出し方 —');
  {
    const load = cut(K, 'function load(');
    const tail = load.slice(load.lastIndexOf("['catch'](function (e) {"));
    t("断りの見分けは「管理者でない」時だけ（var denied = isDenied(e) && role !== 'admin'）", /var denied = isDenied\(e\) && role !== 'admin';/.test(tail));
    t('断り（管理者でない）と通信の失敗は note しない・そのほかは note する', /if \(!denied && !isNetErr\(e\)\) note\('読み込み', e\);/.test(tail) && (tail.match(/note\(/g) || []).length === 1);
    t('断りの時は「勤怠の管理者」に載っていないことと、頼む先を帯で出す', /denied\s*\?\s*'このアカウントは「勤怠の管理者」に載っていないため、勤怠管理を開けません。/.test(tail) && /: msgOf\(e\)\) \+ '<\/div>'/.test(tail));
    /* 帯の出し方を箱で動かして確かめる（note の有無と帯の文） */
    const run = (e, role) => {
      const notes = [], main = { innerHTML: '', removeAttribute() {} };
      const f = new Function('kh', 'e', 'role', 'notes', 'main', [
        'var isNetErr = kh.isNetErr, isDenied = kh.isDenied, my = 1, gen = 1, busy, data, month;',
        'function note(w) { notes.push(w); } function sync() {} function $() { return main; }',
        'function esc(s) { return String(s); } function msgOf() { return "MSG"; }',
        '(' + tail.slice("['catch'](".length, tail.lastIndexOf(')')) + ')(e);'].join('\n'));
      f(kh, e, role, notes, main);
      return { notes, html: main.innerHTML };
    };
    const a = run(denErr, 'office'), b = run(denErr, 'admin'), c = run(netErr, 'office'), d = run(codeErr, 'office');
    t('事務所の人の断り: 報告しない・載っていない旨の帯（#14 はここで止まる）', a.notes.length === 0 && /「勤怠の管理者」に載っていない/.test(a.html), a);
    t('管理者の断り: 想定外なので報告する・帯は今までの文', b.notes.length === 1 && /MSG/.test(b.html), b);
    t('通信の失敗: 報告しない・帯は今までの文（通信できませんでした）', c.notes.length === 0 && /MSG/.test(c.html), c);
    t('コードの例外: 報告する', d.notes.length === 1 && d.notes[0] === '読み込み', d);
  }

  console.log('\n— 6. 配る版 —');
  t('kintai.html の kintai.js の ?v= を上げた（2026-11-20.30）', /<script src="kintai\.js\?v=2026-11-20\.30"><\/script>/.test(read('kintai.html')));

  console.log('\n結果: ' + pass + ' 合格 / ' + fail + ' 不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
