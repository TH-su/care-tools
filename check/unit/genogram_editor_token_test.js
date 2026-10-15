/* 家族構成図（genogram.html）── 書く要求にログインの証明を添える・読込の一覧に「最後に直した人」を出す試験（2026-10-15 新設）
   実行: node check/unit/genogram_editor_token_test.js
   対象を差し替える: GENO_HTML=/tmp/変異版.html node check/unit/genogram_editor_token_test.js（変異試験用）
   守ること:
     1. 証明の取り出し: ログインの控え（sb-…-auth-token）が端末に無ければ問い合わせずに ''・控えがあれば access_token・
        取り出せない／失敗は ''・3秒で返らなければ ''
     2. 書く要求（save・delete）の POST 本文にだけ accessToken を添える。list・get・ping・ログインなしでは添えない。URL には載せない
     3. 読込の一覧に「最後に直した人: メール（時刻）」を textContent で添える。記録の無い図は何も足さない
   ★証明は試験用の作り物。氏名は「テスト 一郎」などの架空。 */
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
const TOKEN = 'aaa.bbb.ccc';
const tick = () => new Promise(r => setImmediate(r));

function box(opt) {
  const o = opt || {};
  const store = { 'genogram:cloudCfg': '{"gasUrl":"https://script.google.com/macros/s/EXAMPLE/exec","gasToken":"aikotoba"}' };
  if (o.login) store['sb-example123-auth-token'] = '{"x":1}';
  const sets = [], fetches = [], timers = [], loads = [];
  let gs = 0;
  const b = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { sets.push([k, v]); store[k] = String(v); },
      key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
    window: o.noAuth ? {} : { supabase: {}, SUAuth: { client: () => ({ auth: { getSession: () => { gs++;
      if (o.hang) return new Promise(() => {});
      return Promise.resolve(o.session === undefined ? { data: { session: { access_token: TOKEN } } } : o.session); } } }) } },
    document: { scripts: [], head: { appendChild: s => { loads.push(s.src); } }, createElement: () => ({}) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [], saved: {}, deleted: {} }) }); },
    URLSearchParams, Promise, Date, String, Math, isNaN, Array, Object, JSON, Number, Error
  };
  vm.createContext(b);
  vm.runInContext([
    "function getCfg() { return JSON.parse(localStorage.getItem('genogram:cloudCfg') || '{}'); }",
    "const AUTH_ERR_MSG = 'x';",
    'async function fetchWithRetry(url, init, attempts, read) { const res = await fetch(url, init); return read ? await read(res) : res; }',
    cutLine('const GAS_URL_RE = '), cutLine('const GENO_WRITE_ACTIONS = '), cutLine('const GENO_SESSION_RE = '),
    cutF('genoHasLogin_'), cutF('genoAuthLoad_'), cutF('genoAccessToken_'), cutF('gasCall', 'async ')
  ].join('\n'), b);
  return { b, sets, fetches, timers, loads, gs: () => gs };
}

/* 読込の一覧（refreshDocList）を偽物の部品で動かす */
function listBox(remote, local) {
  const sel = { innerHTML: '', options: [], appendChild(o) { this.options.push(o); } };
  const b = {
    $: () => sel, listDocs: () => local || [],
    CloudSync: { isConfigured: () => true, list: async () => remote },
    document: { createElement: () => ({ value: '', textContent: '' }) },
    Map, Array, Date, String, isNaN
  };
  vm.createContext(b);
  vm.runInContext([cutF('parseTs'), cutF('fmtTsLabel'), cutF('refreshDocList', 'async ')].join('\n'), b);
  return { b, sel };
}

(async function main() {
  console.log('\n— 1. 証明の取り出し —');
  {
    const x = box({});
    t('控えが無ければログインなし', x.b.genoHasLogin_() === false);
    const r = await x.b.genoAccessToken_();
    t('控えが無ければ問い合わせずに ""（読み込みもしない）', r === '' && x.gs() === 0 && x.loads.length === 0 && x.timers.length === 0);
  }
  {
    const x = box({ login: true });
    t('控えがあればログインあり', x.b.genoHasLogin_() === true);
    t('ログイン中はセッションの access_token', (await x.b.genoAccessToken_()) === TOKEN);
    t('3秒の打ち切りを置く', x.timers.some(tm => tm.ms === 3000), x.timers.map(tm => tm.ms));
    const y = box({ login: true, session: { data: { session: null } } });
    t('セッションが無ければ ""', (await y.b.genoAccessToken_()) === '');
  }
  {
    const x = box({ login: true, hang: true });
    const p = x.b.genoAccessToken_();
    await tick();
    const tm = x.timers.find(z => z.ms === 3000);
    if (tm) tm.fn();
    t('3秒で返らなければ ""', (await p) === '');
  }
  {
    const x = box({ login: true, noAuth: true });
    x.b.genoAccessToken_();
    await tick();
    t('su-auth・supabase-js が無ければ使う時にだけ読み込む', x.loads.some(s => /^supabase-js-/.test(s)), x.loads);
  }

  console.log('\n— 2. 書く要求にだけ添える —');
  for (const [a, p] of [['save', { doc: { clientName: 'テスト 一郎' } }], ['delete', { name: 'テスト 一郎' }]]) {
    const x = box({ login: true });
    await x.b.gasCall(a, p);
    const body = JSON.parse(x.fetches[0].init.body);
    t('書く ' + a + ': 本文に accessToken（URL には載せない）', body.accessToken === TOKEN && x.fetches[0].url.indexOf(TOKEN) < 0 && body.token === 'aikotoba', body);
    t('  └ 証明を端末に保存しない', !x.sets.some(s => String(s[1]).indexOf(TOKEN) >= 0), x.sets);
  }
  for (const [a, p] of [['list', {}], ['get', { name: 'テスト 一郎' }], ['ping', {}]]) {
    const x = box({ login: true });
    await x.b.gasCall(a, p);
    t('読む ' + a + ': 添えない・問い合わせない', !('accessToken' in JSON.parse(x.fetches[0].init.body)) && x.gs() === 0);
  }
  {
    const x = box({});
    await x.b.gasCall('save', { doc: { clientName: 'テスト 一郎' } });
    t('ログインなし: 添えずに送る', x.fetches.length === 1 && !('accessToken' in JSON.parse(x.fetches[0].init.body)));
    const y = box({ login: true, session: { data: { session: null } } });
    await y.b.gasCall('save', { doc: { clientName: 'テスト 一郎' } });
    t('証明を取り出せない時は添えずに送る（保存は止めない）', y.fetches.length === 1 && !('accessToken' in JSON.parse(y.fetches[0].init.body)));
  }
  t('保留の控え（queuePending）に証明を入れる所が無い', !/queuePending\([^)]*accessToken/.test(SRC));

  console.log('\n— 3. 読込の一覧に「最後に直した人」—');
  {
    const at = '2026-10-15T03:00:00.000Z';
    const L = listBox([{ name: 'テスト 一郎', updatedAt: at, updatedBy: 'office1@example.com' }, { name: 'テスト 花子', updatedAt: at, updatedBy: '' },
      { name: 'テスト 三郎', updatedAt: at }]);
    await L.b.refreshDocList();
    const txt = n => (L.sel.options.find(o => o.value === n) || {}).textContent || '';
    t('直した人がいる図: 「最後に直した人: メール（時刻）」を添える', /^☁only テスト 一郎  \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)　最後に直した人: office1@example\.com（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）$/.test(txt('テスト 一郎')), txt('テスト 一郎'));
    t('記録の無い図（"" や欄が無い古い GAS）は何も足さない', !/直した人/.test(txt('テスト 花子')) && !/直した人/.test(txt('テスト 三郎')), [txt('テスト 花子'), txt('テスト 三郎')]);
    const L2 = listBox([{ name: 'テスト 一郎', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: '未確認' }], [{ name: 'テスト 一郎', updatedAt: '2026-10-15T00:00:00.000Z' }]);
    await L2.b.refreshDocList();
    t('端末の方が新しい図でも、クラウドの版を直した人（「未確認」も）を出す', /最後に直した人: 未確認（2026-10-01 /.test(L2.sel.options[0].textContent), L2.sel.options[0].textContent);
    t('textContent で出す（innerHTML に名前を入れない）', /opt\.textContent = `\$\{tag\} \$\{e\.name\}  \(\$\{d\}\)\$\{who\}`;/.test(SRC));
  }

  finished = true;
  console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
/* 約束（Promise）が返らないまま空になると node は終了コード 0 で抜ける＝失敗を見落とす。最後まで来なければ失敗にする */
var finished = false;
process.on('exit', () => { if (!finished) { console.log('  ✗ 試験が最後まで進まなかった（返らない約束がある）'); process.exitCode = 1; } });
