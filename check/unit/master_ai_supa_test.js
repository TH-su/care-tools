/* 入居者マスタの「薬効の下書き」の AI の中継を、新しい受け口（su-ai・統合 0028）から送る道の試験（2026-11-01 代表者「今作り、切で置く」）。
   守りたいこと:
     A スイッチ master_ai が切・無い時は、今までどおり計画書の GAS へ送る（su-ai は呼ばない）
     B 入の時は su-ai へ用途 med_effect つきで本文をそのまま送る（合言葉・GAS の action を付けない）。応答は GAS の時と同じ読み方
     C ログインしていない時は送らない（AI_LOGIN）
     D 受け口に届く前に切れた時だけ2秒待って1回だけ送り直す。受け口が答えた失敗（500）は送り直さない
     E su-ai だけが返す断り（お名前が残っていた・使えないアカウント）を画面の言葉にする
   ★画面の本物の関数（mdAiViaSupa_・mdAiSupa_・mdAiSupaRun_・mdAiProxy_・mdAiWhy_）を切り出して動かす。偽物にするのは fetch・ログインの部品・端末の控えだけ。
   実行: node check/unit/master_ai_supa_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

function cutF(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('見つかりません: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('終わりが見つかりません: ' + name);
}

const BODY = { model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: '見本薬A\n見本薬B' }] };
const OKDATA = { ok: true, status: 200, data: { content: [{ type: 'text', text: '[]' }] } };

function box(o) {
  o = o || {};
  const store = {};
  if (o.flags !== undefined) store.su_backend_flags = JSON.stringify(o.flags);
  store.tp_cfg = JSON.stringify({ url: 'https://script.google.com/macros/s/EXAMPLE_TP/exec', token: 'tok-tp' });
  const posts = [], invokes = [];
  let n = 0;
  const w = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: (url, init) => { posts.push({ url, body: init.body }); return Promise.resolve({ ok: true, json: () => Promise.resolve(OKDATA) }); },
    msAuthLoad_: () => Promise.resolve(),
    MD_AI_TIMEOUT: 150000,
    Promise, JSON, Object, Array, String, Number, Error, setTimeout, clearTimeout
  };
  w.SUAuth = {
    STATUS: { OK: 'ok' },
    check: async () => (o.signedOut ? { status: 'signed_out' } : { status: 'ok', role: 'office' }),
    client: () => ({ functions: { invoke: async (fn, opt) => {
      n++; invokes.push({ fn, body: JSON.parse(JSON.stringify(opt.body)) });
      const r = typeof o.reply === 'function' ? o.reply(n) : o.reply;
      return r || { data: OKDATA, error: null };
    } } })
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(['mdAiCfg', 'mdAiViaSupa_', 'mdAiSupa_', 'mdAiProxy_', 'mdAiSupaRun_', 'mdAiWhy_'].map(f => cutF(HTML, f)).join('\n'), w);
  return { w, posts, invokes };
}
async function run(x) { try { return { r: await x.w.mdAiProxy_(BODY) }; } catch (e) { return { e: e.message }; } }

(async () => {
  console.log('A スイッチが切・無い時は計画書の GAS');
  for (const flags of [undefined, { supabase: { master_ai: false } }]) {
    const x = box({ flags });
    const r = await run(x);
    t('スイッチ' + (flags ? 'が切' : 'が無い') + ' → GAS へ送り、su-ai は呼ばない', r.r && x.posts.length === 1 && JSON.parse(x.posts[0].body).action === 'ai' && x.invokes.length === 0, [r, x.posts.length, x.invokes.length]);
  }
  console.log('B スイッチが入なら su-ai');
  {
    const x = box({ flags: { supabase: { master_ai: true } } });
    const r = await run(x);
    t('su-ai へ用途 med_effect つきで本文をそのまま送る・GAS へは送らない・答えを返す', r.r && r.r.content && x.invokes.length === 1 && x.invokes[0].fn === 'su-ai'
      && JSON.stringify(x.invokes[0].body) === JSON.stringify({ purpose: 'med_effect', body: BODY }) && x.posts.length === 0, [r, x.invokes]);
  }
  {
    const x = box({ flags: { supabase: { master_ai: true } } });
    x.w.localStorage.getItem = k => (k === 'tp_cfg' ? null : (k === 'su_backend_flags' ? JSON.stringify({ supabase: { master_ai: true } }) : null));
    const r = await run(x);
    t('su-ai の時は、計画書の接続先が無い端末でも送れる', r.r && x.invokes.length === 1, r);
  }
  console.log('C ログインしていない');
  {
    const x = box({ flags: { supabase: { master_ai: true } }, signedOut: true });
    const r = await run(x);
    t('ログインしていない → AI_LOGIN・送らない', r.e === 'AI_LOGIN' && x.invokes.length === 0 && x.posts.length === 0, r);
  }
  console.log('D 送り直し');
  {
    const x = box({ flags: { supabase: { master_ai: true } }, reply: n => (n === 1 ? { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } } : null) });
    const r = await run(x);
    t('受け口に届く前に切れた時は、1回だけ送り直す（2回目で答えれば成功）', r.r && x.invokes.length === 2, [r, x.invokes.length]);
  }
  {
    const x = box({ flags: { supabase: { master_ai: true } }, reply: { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } } });
    const r = await run(x);
    t('2回とも届かない → AI_NETWORK・送るのは2回まで', r.e === 'AI_NETWORK' && x.invokes.length === 2, [r, x.invokes.length]);
  }
  {
    const x = box({ flags: { supabase: { master_ai: true } }, reply: { data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status: 500, json: async () => null } } } });
    const r = await run(x);
    t('受け口が 500 で答えた → 送り直さない', r.e === 'AI_NETWORK' && x.invokes.length === 1, [r, x.invokes.length]);
  }
  console.log('E su-ai だけが返す断り');
  for (const [err, code] of [['ai_name_found', 'AI_NAME_FOUND'], ['ai_forbidden', 'AI_FORBIDDEN'], ['login', 'AI_LOGIN'], ['ai_limit', 'AI_LIMIT'], ['ai_no_key', 'AI_NO_KEY']]) {
    const x = box({ flags: { supabase: { master_ai: true } }, reply: { data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status: err === 'login' ? 401 : 200, json: async () => ({ ok: false, error: err }) } } } });
    const r = await run(x);
    t(err + ' → ' + code + '・職員向けの文がある', r.e === code && !/^AIに尋ねられませんでした（/.test(x.w.mdAiWhy_(code)), [r, x.w.mdAiWhy_(code)]);
  }
  t('ログインなし・使えないアカウントは、まとめて尋ねる時もそこで止める', /AI_FETCH\|AI_LOGIN\|AI_FORBIDDEN\|STALE\)\$\/\.test\(em\)\) throw e;/.test(HTML));

  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
