/* 切り替える前に、その種類の受け口（Edge Function）が本番で答えるかを確かめる（su-cutover-gate.js の fnReady・写しの見比べ・2026-11-07）の試験
   実行: node check/unit/cutover_fn_ready_test.js
   守りたいこと:
     A 答えの見分け: 404 → 無い・2xx と 404 以外の 4xx → ある・5xx → 正しく動いていない・届かない／読めない／0 → 確かめられない
     B 送るのは決まった住所への中身の無い OPTIONS だけ（ログインの情報を付けない・書き込む操作を送らない）。名前の形が違えば送らない
     C 種類と受け口の対応（備品 sup-write・職員マスタ stf-write・入居調整 adm-write・計画書 tp-write・入居者マスタ res-write）。
       受け口を使わない種類（排泄ケア記録・添付書類・家族構成図・シフト分析・体重）は確かめない
     D 画面のつなぎ（shadow-check.js の本物の関数を切り出して動かす）: 受け口が無い・届かない時は、確認の窓も GAS も切り替え（opBegin を含む cutover）も呼ばずに断る。
       ある時は今までどおり進む。「写しの期間に戻す」には効かない（受け口が無くても戻せる）
     E 断る文は職員に分かる言葉（受け口の名前は括弧の中だけ）
   架空データのみ。通信は全部偽物。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const G = require(path.join(ROOT, 'su-cutover-gate.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'shadow-check.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'shadow-check.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }

function fn(name) {
  const i = SRC.lastIndexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  const st = SRC.lastIndexOf('\n', i) + 1;
  let d = 0, seen = false, q = null;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    const c = SRC[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && !d) return SRC.slice(st, k + 1); }
  }
  throw new Error('unterminated ' + name);
}

(async () => {
  console.log('A 答えの見分け');
  t('204（OPTIONS に答えた）→ ある', G.fnState(204) === 'ready');
  t('200 → ある', G.fnState(200) === 'ready');
  t('401・400・403・405 → ある（受け口は動いている）', [401, 400, 403, 405].every((s) => G.fnState(s) === 'ready'));
  t('404（NOT_FOUND）→ 無い', G.fnState(404) === 'missing');
  t('500・503・504・546 → 正しく動いていない', [500, 503, 504, 546].every((s) => G.fnState(s) === 'broken'));
  t('0・数でない・3xx・408・429 → 確かめられない', [0, undefined, null, NaN, 'x', 302, 408, 429, -1].every((s) => G.fnState(s) === 'unknown'));

  console.log('B 送るもの');
  {
    const sent = [];
    const r = await G.fnReady('sup-write', { fetch: async (u, init) => { sent.push([u, init]); return { status: 204 }; } });
    t('ある → ok', r.ok === true && r.state === 'ready' && r.status === 204 && r.why === '', r);
    t('1回だけ送る', sent.length === 1);
    t('住所は本番の受け口', sent[0][0] === 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/sup-write');
    t('中身の無い OPTIONS（本文も、ログインの情報も付けない）', sent[0][1].method === 'OPTIONS' && !('body' in sent[0][1]) && !('headers' in sent[0][1]) && sent[0][1].credentials === 'omit', sent[0][1]);
  }
  {
    const r = await G.fnReady('sup-write', { fetch: async () => ({ status: 404, json: async () => ({ code: 'NOT_FOUND', message: 'Requested function was not found' }) }) });
    t('404 → 断る（無い）', r.ok === false && r.state === 'missing' && /まだ本番に配られていません/.test(r.why), r);
    t('断る文の形（受け口の名前は括弧の中だけ）', r.why === '新しい保存先の受け口（sup-write）がまだ本番に配られていません。配った後に押してください。', r.why);
  }
  {
    const r = await G.fnReady('stf-write', { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    t('届かない → 断る（確かめられない）', r.ok === false && r.state === 'unknown' && /確かめられませんでした/.test(r.why), r);
    const o = await G.fnReady('stf-write', { fetch: async () => ({ type: 'opaque', status: 0 }) });
    t('中身を読めない答え → 断る', o.ok === false && o.state === 'unknown');
    const b = await G.fnReady('stf-write', { fetch: async () => ({ status: 503 }) });
    t('起動できない（503）→ 断る', b.ok === false && b.state === 'broken' && /正しく動いていません/.test(b.why));
    const n = await G.fnReady('stf-write', { fetch: async () => null });
    t('答えが空 → 断る', n.ok === false && n.state === 'unknown');
  }
  {
    let called = 0;
    const f = async () => { called++; return { status: 204 }; };
    const bad = await Promise.all(['', 'Sup-Write', '../x', 'a/b', 'x'.repeat(60), null].map((nm) => G.fnReady(nm, { fetch: f })));
    t('名前の形が違えば送らずに断る', called === 0 && bad.every((r) => !r.ok));
    t('io.fetch が無ければ断る（例外を出さない）', (await G.fnReady('sup-write', {})).ok === false && (await G.fnReady('sup-write')).ok === false);
  }

  console.log('C 種類と受け口');
  t('5つの種類の受け口', G.fnFor('sup') === 'sup-write' && G.fnFor('stf') === 'stf-write' && G.fnFor('adm') === 'adm-write' && G.fnFor('tp') === 'tp-write' && G.fnFor('res') === 'res-write');
  t('受け口を使わない種類は確かめない', ['hb', 'doc', 'geno', 'sa', 'weight', '', 'toString', '__proto__'].every((k) => G.fnFor(k) === ''));
  {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    t('受け口の名前は各画面の部品と同じ（su-sup.js・su-stf.js・su-data-supabase.js・su-res-read.js）',
      /functions\.invoke\('sup-write'/.test(read('su-sup.js')) && /functions\.invoke\('stf-write'/.test(read('su-stf.js'))
      && /fn: 'tp-write'/.test(read('su-data-supabase.js')) && /fn: 'adm-write'/.test(read('su-data-supabase.js')) && /functions\.invoke\('res-write'/.test(read('su-res-read.js')));
  }

  console.log('D 画面のつなぎ');
  const OPS = [
    { op: 'runSupOp', kind: 'sup', name: 'sup-write', btn: 'b-sup-cut', back: 'b-sup-back', msg: 'sup-mode', full: 'SUSupFull' },
    { op: 'runStfOp', kind: 'stf', name: 'stf-write', btn: 'b-stf-cut', back: 'b-stf-back', msg: 'stf-mode', full: 'SUStfFull' },
    { op: 'runAdmOp', kind: 'adm', name: 'adm-write', btn: 'b-adm-cut', back: 'b-adm-back', msg: 'admf-mode', full: 'SUAdmFull' },
    { op: 'runTpOp', kind: 'tp', name: 'tp-write', btn: 'b-tp-cut', back: 'b-tp-back', msg: 'tpf-mode', full: 'SUTpFull' },
    { op: 'runResOp', kind: 'res', name: 'res-write', btn: 'b-res-cut', back: 'b-res-back', msg: 'rf-mode', full: 'SUResFull' }
  ];
  function glue(o, answer) {
    const nodes = {};
    const node = (id) => (nodes[id] = nodes[id] || { id, hidden: false, disabled: false, className: '', textContent: '' });
    const log = [];
    const ok = { ok: true, rows: 1, active: 1, docs: 1, residents: 1, records: 1 };
    const full = () => ({ cutover: async (io) => { log.push('cutover'); await io.rpc && io.rpc('op_begin'); return ok; }, back: async () => { log.push('back'); return ok; } });
    const sb = { rpc: async (nm) => { log.push('rpc:' + nm); return { data: null, error: null }; }, auth: { getSession: async () => ({ data: { session: null } }) } };
    const ctx = {
      $: node, me: { role: 'admin', status: 'ok' }, SUAuth: { STATUS: { OK: 'ok' }, client: () => sb },
      localStorage: { getItem: () => 'office' }, window: { SUErrors: { note: (a, b) => log.push('note:' + b) } },
      confirm: () => { log.push('confirm'); return true; },
      fetch: async (u, init) => { log.push('fetch:' + init.method + ' ' + u); if (answer === 'throw') throw new TypeError('Failed to fetch'); return { status: answer }; },
      SUCutGate: G, Object, Array, String, Promise, JSON, AbortController, setTimeout, clearTimeout,
      SUSupFull: full(), SUStfFull: full(), SUAdmFull: full(), SUTpFull: full(), SUResFull: full(),
      rmasterPost: async () => { log.push('gas'); return {}; }
    };
    vm.createContext(ctx);
    const stubs = [
      'function supTarget() { return { url: "x" }; }', 'function stfTarget() { return { url: "x" }; }', 'function admTarget() { return { url: "x" }; }',
      'function tpTarget() { return { url: "x" }; }', 'function rmasterTarget() { return { url: "x" }; }',
      'function suppliesOn() { return true; }', 'function staffOn() { return true; }', 'function admissionOn() { return true; }',
      'function trainingOn() { return true; }', 'function masterLiveOn() { return true; }',
      'async function gatePass() { return true; }', 'async function oneDayOk() { return true; }', 'async function gateRefresh() {}',
      'async function loadSupMode() {}', 'async function loadSup() {}', 'async function loadStfMode() {}', 'async function loadStf() {}',
      'async function loadAdmMode() {}', 'async function loadAdmRuns() {}', 'async function loadTpMode() {}', 'async function loadTpRuns() {}',
      'async function loadResMode() {}', 'async function loadResFullRuns() {}',
      'function resOpIo(sb) { return { rpc: function (n, a) { return sb.rpc(n, a); } }; }',
      'var admState = null, tpState = null, resState = null;'
    ];
    vm.runInContext(stubs.concat([/var FN_MS = [^\n]*;/.exec(SRC)[0], fn('fnFetch'), fn('fnOk')], OPS.map((x) => fn(x.op))).join('\n')
      + '\nthis.ops = {' + OPS.map((x) => x.op + ':' + x.op).join(',') + '};', ctx);
    return { ctx, nodes, log };
  }
  for (const x of OPS) {
    {
      const g = glue(x, 404);
      await g.ctx.ops[x.op]('cut');
      t(x.op + ': 受け口が無い → 確認の窓も GAS も切り替えも呼ばずに断る', g.log.indexOf('confirm') < 0 && g.log.indexOf('gas') < 0 && g.log.indexOf('cutover') < 0 && !g.log.some((l) => /^rpc:/.test(l)), g.log);
      t(x.op + ': 送ったのは ' + x.name + ' への OPTIONS 1回だけ', g.log.filter((l) => /^fetch:/.test(l)).join() === 'fetch:OPTIONS https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/' + x.name, g.log);
      t(x.op + ': 断る文を出す', g.nodes[x.msg].textContent === '新しい保存先の受け口（' + x.name + '）がまだ本番に配られていません。配った後に押してください。' && /warn/.test(g.nodes[x.msg].className), g.nodes[x.msg].textContent);
      t(x.op + ': ボタンは元どおり押せる', g.nodes[x.btn].disabled === false);
      t(x.op + ': 記録（note）に残す', g.log.some((l) => l === 'note:' + x.name + ' missing 404'), g.log);
    }
    {
      const g = glue(x, 'throw');
      await g.ctx.ops[x.op]('cut');
      t(x.op + ': 届かない → 断る', g.log.indexOf('confirm') < 0 && g.log.indexOf('cutover') < 0 && g.log.indexOf('gas') < 0 && /確かめられませんでした/.test(g.nodes[x.msg].textContent), g.log);
    }
    {
      const g = glue(x, 503);
      await g.ctx.ops[x.op]('cut');
      t(x.op + ': 起動できない → 断る', g.log.indexOf('confirm') < 0 && g.log.indexOf('cutover') < 0);
    }
    {
      const g = glue(x, 204);
      await g.ctx.ops[x.op]('cut');
      const i = g.log.findIndex((l) => /^fetch:/.test(l)), j = g.log.indexOf('confirm'), k = g.log.indexOf('cutover');
      t(x.op + ': ある → 今までどおり進む（確かめ → 確認の窓 → 切り替え）', i >= 0 && j > i && k > j, g.log);
    }
    {
      const g = glue(x, 404);
      await g.ctx.ops[x.op]('back');
      t(x.op + ': 戻すには効かない（受け口が無くても戻せる・確かめに行かない）', g.log.indexOf('back') > 0 && !g.log.some((l) => /^fetch:/.test(l)), g.log);
    }
  }
  {
    const at = (name, needle) => { const b = fn(name); const c = b.indexOf("if (kind === 'cut') {"), i = b.indexOf(needle), j = b.indexOf('confirm('), e = b.indexOf('} else {', c); return c > 0 && i > c && i < e && j > i; };
    t('5つの「切り替える」の、確認の窓より前・切り替える時の枝の中で確かめる', OPS.every((x) => at(x.op, "fnOk('" + x.kind + "', '" + x.btn + "', say)")));
    t('受け口を使わない種類（排泄ケア記録・添付書類・家族構成図・シフト分析・体重）には付けない', ['runHbOp', 'runSaOp', 'setWeightMode'].every((n) => fn(n).indexOf('fnOk') < 0)
      && SRC.split('fnOk(').length - 1 === 1 + OPS.length);
    t('確かめる間はボタンを押せなくする（二度押し防止）', /b\.disabled = true;[\s\S]*SUCutGate\.fnReady/.test(fn('fnOk')));
    t('時間を区切る（10秒）', /var FN_MS = 10000;/.test(SRC) && /ac\.abort\(\)/.test(fn('fnFetch')));
  }

  console.log('E 版と決まり');
  t('部品の版を上げた（su-cutover-gate.js?v=2026-11-07 以降）', /su-cutover-gate\.js\?v=2026-11-(0[7-9]|[1-3]\d)/.test(HTML));
  t('画面の動きの版を上げた（shadow-check.js?v=2026-11-07 以降）', /shadow-check\.js\?v=2026-11-(0[7-9]|[1-3]\d)/.test(HTML));
  t('CSP の通信先に Supabase がある（受け口の確かめが届く）', /connect-src [^;]*https:\/\/jhbernqawjrzqwrmqrih\.supabase\.co/.test(HTML));
  t('console.log を足していない', !/console\.log/.test(fs.readFileSync(path.join(ROOT, 'su-cutover-gate.js'), 'utf8')) && !/console\.log/.test(fn('fnOk') + fn('fnFetch')));

  console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
  process.exitCode = fail ? 1 : 0;
})();
