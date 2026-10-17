/* 申送ビューア 読み取りの送り直し（moushiokuri-viewer.html の apiGet）のテスト（2026-10-17 新設）
   実行: node check/unit/msk_api_retry_test.js
   対象を差し替える: MSK_HTML=/tmp/変異版.html node check/unit/msk_api_retry_test.js（変異試験用）

   守ること:
     ①GAS が「この読み取りは POST でだけ受け付けます。もう一度お試しください」と返した時（本文が落ちて GET で届いた時）だけ、
       最大2回まで同じ読み取りを送り直す（3回目の断りはそのまま失敗にする）
     ②ほかの失敗（合言葉違い・想定外の応答・通信の失敗）は送り直さない
     ③送り直しても、送る中身（action・期間・合言葉の置き場所）は1回目と同じ
   ★このファイルは公開リポジトリの check/unit にある。氏名・接続先・合言葉は架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}
function grabVar(name) {
  const m = SRC.match(new RegExp('\\nvar ' + name + ' = [^;]+;'));
  if (!m) throw new Error('定数が見つかりません: ' + name);
  return m[0];
}

const REFUSE = 'この読み取りは POST でだけ受け付けます。もう一度お試しください（何度も出る時は画面を再読み込みしてください）';

/* 応答の並び（answers）を順に返す偽の fetch。送った本文を控える */
function box(answers) {
  const sent = [];
  const sb = {
    console, JSON, String, Object, Date, Error, Promise, setTimeout, clearTimeout,
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    loadCfg: () => ({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'tok-example' }),
    fetch: (url, opt) => {
      sent.push(JSON.parse(opt.body));
      const a = answers.shift();
      if (a instanceof Error) return Promise.reject(a);
      return Promise.resolve({ text: () => Promise.resolve(typeof a === 'string' ? a : JSON.stringify(a)) });
    }
  };
  vm.createContext(sb);
  vm.runInContext([grabVar('API_GET_RETRY'), grabFn('fetchTO'), grabFn('parseJson'), grabFn('apiGet'), grabFn('apiGetOnce')].join('\n'), sb);
  return { sb, sent };
}
const run = (b) => b.sb.apiGet('events', { from: '2026-10-01', to: '2026-10-14' })
  .then((o) => ({ ok: true, o }), (e) => ({ ok: false, m: String(e && e.message || e) }));

(async () => {
  console.log('— 1. 断り（本文が落ちて GET で届いた）の時だけ送り直す');
  {
    const b = box([{ error: REFUSE }, { ok: true, events: [] }]);
    const r = await run(b);
    t('1回断られても2回目で読める', r.ok && r.o.ok === true, r);
    t('送ったのは2回', b.sent.length === 2, b.sent.length);
    t('送り直しも同じ中身（action・期間・合言葉は本文）', JSON.stringify(b.sent[0]) === JSON.stringify(b.sent[1]) && b.sent[1].action === 'events' && b.sent[1].token === 'tok-example', b.sent);
  }
  {
    const b = box([{ error: REFUSE }, { error: REFUSE }, { ok: true, events: [] }]);
    const r = await run(b);
    t('2回断られても3回目で読める', r.ok && b.sent.length === 3, [r, b.sent.length]);
  }
  {
    const b = box([{ error: REFUSE }, { error: REFUSE }, { error: REFUSE }, { ok: true }]);
    const r = await run(b);
    t('3回断られたら失敗のまま返す（送り直しは最大2回）', !r.ok && r.m.indexOf('POST でだけ') >= 0 && b.sent.length === 3, [r, b.sent.length]);
  }

  console.log('\n— 2. ほかの失敗は送り直さない');
  for (const [name, ans, want] of [
    ['合言葉違い', { error: '認証エラー' }, 'API:認証エラー'],
    ['サーバーのほかのエラー', { error: '不明なaction' }, 'API:不明なaction'],
    ['想定外の応答（HTML）', '<!DOCTYPE html><html></html>', 'GAS_LOGIN'],
    ['通信の失敗', new Error('Failed to fetch'), 'Failed to fetch']
  ]) {
    const b = box([ans, { ok: true }]);
    const r = await run(b);
    t(name + ': 1回で失敗を返す', !r.ok && r.m === want && b.sent.length === 1, [r, b.sent.length]);
  }

  console.log('\n— 3. 成功はそのまま');
  {
    const b = box([{ ok: true, events: [1] }]);
    const r = await run(b);
    t('1回で読めたら送り直さない', r.ok && b.sent.length === 1, b.sent.length);
  }

  console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
