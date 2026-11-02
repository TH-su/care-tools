/* 写しの見比べ（shadow-check）の「職員マスタの写し」（統合 0044・2026-11-02 新設）。
   守りたいこと:
     A 写しの版と、この端末の職員マスタの接続先（Google）の今の版をそろえて「一致」・Google が新しい・写しが新しい・読めない を分ける
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す
     C Google へは ping だけを送る（合言葉・証明を送らない）。接続先の形が違えば送らない
     D 出すのは人数・版・時刻・種類だけ（氏名・中身を出さない＝写しの中身を読む口を呼ばない）
   ★画面の本物の関数（loadStf・stfUrl・stfPing）を切り出して、データベースと Google の応答だけ偽物にして動かす。
   実行: node check/unit/shadow_check_staff_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'shadow-check.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'shadow-check.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
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
const GAS = 'https://script.google.com/macros/s/EXAMPLE_STAFF/exec';

const PREP_SRC = ['var DB_PREP = ' + /var DB_PREP = (\{[\s\S]*?\});/.exec(SRC)[1] + ';', 'var prepMissing = {};', fn('dbErrKind'), fn('notePrep'), fn('renderPrep'), fn('dbErrText')].join('\n');
function box(o) {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, className: '', textContent: '', kids: [], replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['stf-kpis', 'stf-verdict', 'stf-runs', 'db-prep'].forEach(mk);
  const sent = [], rpcs = [];
  const store = { stfm_cfg: o.cfg === undefined ? JSON.stringify({ url: GAS, token: 'tok-staff' }) : o.cfg };
  const env = {
    $: (id) => nodes[id],
    el: (tag, cls, text) => ({ tag, cls, textContent: text || '', kids: [], appendChild(c) { this.kids.push(c); return c; } }),
    kpi: (label, value, unit) => ({ label, value, unit }),
    fmtTime: (x) => (x ? 'T' : '-'),
    ADM_RESULT: { inserted: '初めて写した', updated: '直した', unchanged: '変化なし' },
    RMASTER_RE: /^https:\/\/script\.google\.com\/[^?#\s]*\/exec$/,
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: () => 0, clearTimeout: () => {},
    fetch: (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return o.gasDown ? Promise.reject(new Error('x')) : Promise.resolve({ json: () => Promise.resolve({ ok: true, ver: o.gver }) }); },
    me: { role: 'admin' }, window: {},
    JSON, String, Object, Promise, Error, RegExp
  };
  vm.createContext(env);
  vm.runInContext([PREP_SRC, 'var STF_REFUSED = ' + /var STF_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';', fn('stfUrl'), fn('stfPing'), fn('loadStf')].join('\n'), env);
  const sb = {
    rpc: (n) => { rpcs.push(n); return Promise.resolve(o.statusErr ? { error: { code: 'PGRST202' } } : { data: o.status }); },
    from: (tbl) => { rpcs.push('from:' + tbl); return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: o.runs || [] }) }) }) }; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadStf(sb) };
}
const V = (b) => b.nodes['stf-verdict'];

(async () => {
  console.log('— A 版の見比べ —');
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, updatedAt: 'x', lastStatus: 'done' }, gver: 12, runs: [{ at: 'x', status: 'done', result: 'updated', ver: 12, staff: 30 }] });
    await b.run();
    t('A 版がそろえば「一致」（ok）', /一致しています/.test(V(b).textContent) && /ok/.test(V(b).className), V(b));
    t('A 人数・写しの版・Google の版を出す', JSON.stringify(b.nodes['stf-kpis'].kids.map(k => k.value)) === '[30,12,12]', b.nodes['stf-kpis'].kids);
    t('A 記録の一覧は版・人数・結果', b.nodes['stf-runs'].kids.length === 1 && b.nodes['stf-runs'].kids[0].kids[0].kids[1].textContent === '版 12／職員 30人／直した');
  }
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, lastStatus: 'done' }, gver: 13 });
    await b.run();
    t('A Google が新しい → 次の自動でそろう（警告にしない）', /次の自動の写し/.test(V(b).textContent) && !/warn/.test(V(b).className));
  }
  {
    const b = box({ status: { ok: true, ver: 14, staff: 30, lastStatus: 'done' }, gver: 13 });
    await b.run();
    t('A 写しが新しい → 警告', /写しの版が Google より新しく/.test(V(b).textContent) && /warn/.test(V(b).className));
  }
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, lastStatus: 'done' }, gasDown: true });
    await b.run();
    t('A Google を読めない → 警告・写しの版だけ', /Google の版を読めませんでした/.test(V(b).textContent) && b.nodes['stf-kpis'].kids.length === 2);
  }
  {
    const b = box({ status: { ok: true, ver: null } });
    await b.run();
    t('A まだ写していない → 案内（Google へ送らない）', /まだ写していません/.test(V(b).textContent) && b.sent.length === 0);
  }
  {
    const b = box({ statusErr: true });
    await b.run();
    t('A 0044 の前 → 準備はまだ', /0044/.test(V(b).textContent));
  }
  console.log('\n— B 断った写し —');
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, lastStatus: 'refused', lastRefused: 'shrink' }, gver: 12, runs: [{ at: 'x', status: 'refused', refused: 'shrink' }] });
    await b.run();
    t('B 断った種類を職員向けの言葉で出す（急に減った）', /受け付けませんでした（急に減った）/.test(V(b).textContent) && /warn/.test(V(b).className));
    t('B 記録の一覧にも種類', b.nodes['stf-runs'].kids[0].kids[0].kids[1].textContent === '受け付けず（急に減った）');
  }
  console.log('\n— C Google へ送るもの —');
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, lastStatus: 'done' }, gver: 12 });
    await b.run();
    const s = b.sent[0];
    t('C ping だけ・合言葉も証明も送らない', b.sent.length === 1 && JSON.stringify(s.body) === '{"action":"ping"}' && s.url === GAS);
    t('C 送り方は GAS と同じ（POST・text/plain・redirect follow）', s.init.method === 'POST' && s.init.headers['Content-Type'] === 'text/plain;charset=utf-8' && s.init.redirect === 'follow');
  }
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, lastStatus: 'done' }, cfg: JSON.stringify({ url: 'https://example.com/x', token: 't' }) });
    await b.run();
    t('C 接続先の形が違えば送らない（見比べずに案内）', b.sent.length === 0 && /接続先が無いので/.test(V(b).textContent));
  }
  console.log('\n— D 中身を読まない —');
  {
    const b = box({ status: { ok: true, ver: 12, staff: 30, lastStatus: 'done' }, gver: 12 });
    await b.run();
    t('D 呼ぶのは様子の口と記録の一覧だけ', JSON.stringify(b.rpcs) === '["stf_shadow_status","from:stf_sync_runs"]', b.rpcs);
    t('D 画面に欄がある', /id="stf-kpis"/.test(HTML) && /id="stf-verdict"/.test(HTML) && /id="stf-runs"/.test(HTML));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
