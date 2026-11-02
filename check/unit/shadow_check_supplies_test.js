/* 写しの見比べ（shadow-check）の「備品の写し」（統合 0046・2026-11-02 新設）。
   守りたいこと:
     A 最後の写しが届いて75分以内なら「届いています」・それより古ければ警告・まだ写していない・0046 の前 を分ける
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す
     C Google へは何も送らない（合言葉・接続先を使わない）
     D 出すのは数・時刻・種類だけ（呼ぶのは様子の口と記録の一覧だけ）
   ★画面の本物の関数（loadSup）を切り出して、データベースの応答だけ偽物にして動かす。
   実行: node check/unit/shadow_check_supplies_test.js
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
const NOW = Date.parse('2026-11-02T12:00:00Z');
function box(o) {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, className: '', textContent: '', kids: [], replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['sup-kpis', 'sup-verdict', 'sup-runs'].forEach(mk);
  const sent = [], rpcs = [];
  const env = {
    $: (id) => nodes[id],
    el: (tag, cls, text) => ({ tag, cls, textContent: text || '', kids: [], appendChild(c) { this.kids.push(c); return c; } }),
    kpi: (label, value, unit) => ({ label, value, unit }),
    fmtTime: (x) => (x ? 'T' : '-'),
    ADM_RESULT: { inserted: '初めて写した', updated: '直した', unchanged: '変化なし' },
    fetch: (url) => { sent.push(url); return Promise.reject(new Error('no')); },
    localStorage: { getItem: () => { sent.push('ls'); return null; } },
    JSON, String, Object, Promise, Error, Date, isNaN
  };
  vm.createContext(env);
  vm.runInContext(['var SUP_FRESH_MS = ' + /var SUP_FRESH_MS = ([^;]*);/.exec(SRC)[1] + ';',
    'var SUP_REFUSED = ' + /var SUP_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';', fn('loadSup')].join('\n'), env);
  const sb = {
    rpc: (n) => { rpcs.push(n); return Promise.resolve(o.statusErr ? { error: { code: 'PGRST202' } } : { data: o.status }); },
    from: (tbl) => { rpcs.push('from:' + tbl); return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: o.runs || [] }) }) }) }; }
  };
  return { nodes, sent, rpcs, run: () => env.loadSup(sb, NOW) };
}
const V = (b) => b.nodes['sup-verdict'];
const ago = (min) => new Date(NOW - min * 60000).toISOString();

(async () => {
  console.log('— A 届いているか —');
  {
    const b = box({ status: { ok: true, ver: 1, items: 40, moves: 900, lastAt: ago(30), lastStatus: 'done' }, runs: [{ at: 'x', status: 'done', result: 'unchanged', items: 40, moves: 900 }] });
    await b.run();
    t('A 30分前の写し → 届いています（ok）', /届いています/.test(V(b).textContent) && /ok/.test(V(b).className), V(b));
    t('A 品目の数・出庫の行数を出す', JSON.stringify(b.nodes['sup-kpis'].kids.map(k => k.value)) === '[40,900]');
    t('A 記録の一覧は数・結果だけ', b.nodes['sup-runs'].kids[0].kids[0].kids[1].textContent === '品目 40件／出庫 900行／変化なし');
  }
  {
    const b = box({ status: { ok: true, ver: 1, items: 40, moves: 900, lastAt: ago(120), lastStatus: 'done' } });
    await b.run();
    t('A 2時間前の写し → しばらく写っていない（警告）', /しばらく写っていません/.test(V(b).textContent) && /warn/.test(V(b).className));
  }
  {
    const b = box({ status: { ok: true, ver: null } });
    await b.run();
    t('A まだ写していない → 案内', /まだ写していません/.test(V(b).textContent));
  }
  {
    const b = box({ statusErr: true });
    await b.run();
    t('A 0046 の前 → 準備はまだ', /0046/.test(V(b).textContent));
  }
  console.log('\n— B 断った写し —');
  {
    const b = box({ status: { ok: true, ver: 1, items: 40, moves: 900, lastAt: ago(10), lastStatus: 'refused', lastRefused: 'shrink' }, runs: [{ at: 'x', status: 'refused', refused: 'shrink' }] });
    await b.run();
    t('B 断った種類を職員向けの言葉で（急に減った）', /受け付けませんでした（急に減った）/.test(V(b).textContent) && /warn/.test(V(b).className));
    t('B 記録の一覧にも種類', b.nodes['sup-runs'].kids[0].kids[0].kids[1].textContent === '受け付けず（急に減った）');
  }
  console.log('\n— C・D —');
  {
    const b = box({ status: { ok: true, ver: 1, items: 1, moves: 1, lastAt: ago(5), lastStatus: 'done' } });
    await b.run();
    t('C Google へ何も送らない・端末の接続先も読まない', b.sent.length === 0, b.sent);
    t('D 呼ぶのは様子の口と記録の一覧だけ', JSON.stringify(b.rpcs) === '["sup_shadow_status","from:sup_sync_runs"]', b.rpcs);
    t('D 画面に欄がある', /id="sup-kpis"/.test(HTML) && /id="sup-verdict"/.test(HTML) && /id="sup-runs"/.test(HTML));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
