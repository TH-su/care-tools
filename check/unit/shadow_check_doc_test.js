/* 写しの見比べ（shadow-check）の「添付書類の写し（職員マスタ・入居調整）」（統合 0063・2026-11-03 新設）。
   守りたいこと:
     A 両方とも75分以内に写していて残り0なら「全部写してあります」・まだ写していない種類があれば知らせる・0063 の前（準備はまだ＋最上部に 0063）
     B 最後の写しを断っていたら種類を職員向けの言葉で・古ければ警告・読めなかった書類があれば警告・初めの写しの途中
     C 出すのは件数・時刻だけ（書類の名前・氏名・持ち主は出さない）。Google・端末の控えには触らない
     H 画面: 欄・準備の帯の番号（0063）・版
     L 切り替えた後の種類（doc_mode_get の印が live）は、写しが止まっていても知らせない。写し返しの残りがあり75分を超えて遅れた時だけ知らせる（2026-11-14）
   実行: node check/unit/shadow_check_doc_test.js
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
const PREP_SRC = ['var DB_PREP = ' + /var DB_PREP = (\{[\s\S]*?\});/.exec(SRC)[1] + ';', 'var prepMissing = {};', fn('dbErrKind'), fn('notePrep'), fn('renderPrep'), fn('dbErrText'), fn('refusedWord')].join('\n');
const NOW = Date.parse('2026-11-20T12:00:00Z');
function box(o) {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, className: '', textContent: '', kids: [], replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['doc-kpis', 'doc-verdict', 'doc-detail', 'db-prep'].forEach(mk);
  const sent = [], rpcs = [];
  const env = {
    $: (id) => nodes[id],
    kpi: (label, value, unit) => ({ label, value, unit }),
    el: (tag, cls, text) => ({ tag, className: cls || '', textContent: text || '', kids: [], appendChild(c) { this.kids.push(c); return c; } }),
    fmtTime: (x) => (x ? 'T' : '-'),
    fetch: (url) => { sent.push(url); return Promise.reject(new Error('no')); },
    localStorage: { getItem: () => { sent.push('ls'); return null; }, setItem: () => { sent.push('ls-set'); } },
    me: { role: 'admin' }, notes: [], genoNote: () => {},
    JSON, String, Object, Promise, Error, Date, isNaN, Number, Math, RegExp, Array
  };
  env.window = { SUErrors: { note: (k, m) => env.notes.push([k, m]) } };
  vm.createContext(env);
  vm.runInContext([PREP_SRC, 'var SA_FRESH_MS = ' + /var SA_FRESH_MS = ([^;]*);/.exec(SRC)[1] + ';',
    'var DOC_KIND = ' + /var DOC_KIND = (\{[^;]*\});/.exec(SRC)[1] + ';', 'var DOC_REFUSED = ' + /var DOC_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';',
    fn('loadDoc')].join('\n'), env);
  const sb = {
    rpc: (n) => {
      rpcs.push(n);
      if (n === 'doc_mode_get') return Promise.resolve(o.mode ? { data: o.mode } : { error: { code: 'PGRST202' } });
      return Promise.resolve(o.statusErr ? { error: { code: o.errCode || 'PGRST202' } } : { data: o.status });
    },
    from: (tbl) => { rpcs.push('from:' + tbl); return {}; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadDoc(sb, NOW) };
}
const V = (b) => b.nodes['doc-verdict'], D = (b) => b.nodes['doc-detail'];
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const K = (x) => Object.assign({ have: 40, bytes: 100, lastAt: ago(10), lastStatus: 'done', lastRefused: null, catalog: 40, copied: 0, left: 0, failed: 0, gone: 0 }, x || {});
const ST = (s, a) => ({ ok: true, stf: K(s), adm: K(a) });

(async () => {
  console.log('— A —');
  {
    const b = box({ status: ST({}, { have: 12, catalog: 12 }) }); await b.run();
    t('A 両方とも写してあれば「全部写してあります」（ok）', /全部写してあります/.test(V(b).textContent) && V(b).className === 'msg ok', V(b));
    t('A 種類ごとの写した書類の数', JSON.stringify(b.nodes['doc-kpis'].kids.map(k => k.label + '=' + k.value)) === '["職員マスタ・写した書類=40","入居調整・写した書類=12"]', b.nodes['doc-kpis'].kids);
    t('A 種類ごとの目録・残り・読めなかった件数', /職員マスタ: 目録 40件・写した書類 40件・残り 0件・読めなかった書類 0件/.test(D(b).textContent) && /入居調整: 目録 12件/.test(D(b).textContent), D(b).textContent);
    const b2 = box({ status: { ok: true, stf: K(), adm: { have: 0 } } }); await b2.run();
    t('A まだ写していない種類があれば知らせる（貼る部品の名前）', /入居調整はまだ写していません/.test(V(b2).textContent) && /docshadow\.gs/.test(V(b2).textContent) && /warn/.test(V(b2).className), V(b2).textContent);
    const b3 = box({ statusErr: true }); await b3.run();
    t('A 0063 の前 → 準備はまだ・最上部に統合 0063', /0063）はまだです/.test(V(b3).textContent) && /統合 0063/.test(b3.nodes['db-prep'].textContent), [V(b3).textContent, b3.nodes['db-prep'].textContent]);
  }
  console.log('— B —');
  {
    const b = box({ status: ST({ lastStatus: 'refused', lastRefused: 'shrink' }) }); await b.run();
    t('B 断った種類を職員向けの言葉で', /職員マスタの最後の写しは受け付けませんでした（目録が急に減った）/.test(V(b).textContent) && /warn/.test(V(b).className), V(b).textContent);
    const b2 = box({ status: ST({}, { lastAt: ago(200) }) }); await b2.run();
    t('B 古ければ自動が止まっていないか警告', /入居調整の写しがしばらく届いていません/.test(V(b2).textContent));
    const b3 = box({ status: ST({ failed: 2 }) }); await b3.run();
    t('B 読めなかった書類があれば警告', /ドライブで読めない書類が 2件/.test(V(b3).textContent) && /warn/.test(V(b3).className));
    const b4 = box({ status: ST({ left: 30 }) }); await b4.run();
    t('B 初めの写しの途中', /初めの写しの途中/.test(V(b4).textContent) && V(b4).className === 'msg ok');
  }
  console.log('— C —');
  {
    const b = box({ status: ST() }); await b.run();
    // 2026-11-14: 切り替えた後かを見るため、印の口（doc_mode_get・読むだけ）も呼ぶようにした
    t('C Google・端末の控えに触らない・様子の口と印の口だけを呼ぶ', b.sent.length === 0 && JSON.stringify(b.rpcs) === '["doc_shadow_status","doc_mode_get"]', [b.sent, b.rpcs]);
    t('C 本文の作り方に名前・持ち主を使わない', !/\.name\b|\.owner\b|\.fid\b|\.meta\b/.test(fn('loadDoc')));
  }
  console.log('— L —');
  {
    const M = (s, a) => ({ ok: true, tenant: 'x', stf: Object.assign({ mode: 'live', version: 1, mirroredVer: 1, mirroredAt: null }, s || {}), adm: Object.assign({ mode: 'live', version: 1, mirroredVer: 1, mirroredAt: null }, a || {}) });
    const b = box({ status: ST({ lastAt: ago(60 * 24 * 8) }, { lastAt: ago(60 * 24 * 8) }), mode: M() }); await b.run();
    t('L 両方とも切り替え済みなら、写しが8日前でも知らせない（ok）', V(b).className === 'msg ok' && !/しばらく届いていません/.test(V(b).textContent) && /切り替え済み/.test(V(b).textContent), V(b));
    t('L 写し返しの残りと遅れは「本番の健康」の表に任せる（この欄では「遅れはありません」と言わない）', /本番の健康/.test(V(b).textContent) && !/遅れはありません/.test(V(b).textContent), V(b).textContent);
    t('L 種類ごとに切り替え済みと出す', /職員マスタ: 切り替え済みです/.test(D(b).textContent) && /入居調整: 切り替え済みです/.test(D(b).textContent), D(b).textContent);
    const b2 = box({ status: ST({ lastAt: ago(60 * 24 * 8) }), mode: M({ version: 3, mirroredVer: 1, mirroredAt: ago(200) }) }); await b2.run();
    t('L 版の差では遅れを知らせない（版の差は書類の残りではないため・反証レビュー指摘1〜3）', !/warn/.test(V(b2).className) && !/遅れています/.test(V(b2).textContent), V(b2));
    const b4 = box({ status: ST({}, { lastAt: ago(200) }), mode: M({}, { mode: 'shadow' }) }); await b4.run();
    t('L 写しの期間の種類（入居調整）は今までどおり写しの遅れを知らせる', /入居調整の写しがしばらく届いていません/.test(V(b4).textContent), V(b4).textContent);
  }
  console.log('— H —');
  {
    t('H 欄がある', /<h2>添付書類の写し（職員マスタ・入居調整）<\/h2>/.test(HTML) && /id="doc-kpis"/.test(HTML) && /id="doc-verdict"/.test(HTML) && /id="doc-detail"/.test(HTML));
    t('H 準備の帯の番号 0063', /doc_shadow_status: '0063'/.test(SRC));
    t('H 起動時に読む（読めない時は文を出す）', /try \{ await loadDoc\(sb\); \} catch \(e\) \{ \$\('doc-verdict'\)/.test(SRC));
    t('H 版を上げた（shadow-check.js?v=2026-11-03.9 以降）', /shadow-check\.js\?v=2026-11-(03\.(9|\d{2,})|0[4-9]|[1-3]\d)/.test(HTML));
  }
  console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
  process.exit(fail ? 1 : 0);
})();
