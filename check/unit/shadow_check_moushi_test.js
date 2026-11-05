/* 写しの見比べ（shadow-check）の「申し送りの写し」（統合 0067・2026-11-05 新設）。
   守りたいこと:
     A 最後の写しが75分以内なら「Google と同じ」・古ければ警告・まだ写していない・0067 の前（準備はまだ＋最上部に 0067）・権限の断り
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す
     C 食い違い・初めの写しの途中・空にしなかった日・使えない形の行・日付の無い行を種類ごとに知らせる
     D 出すのは日数・照らし合わせ・時刻・写し始めてからの日数だけ（氏名・本文は出さない）。Google・端末の控えには触らない
     H 画面: 欄・準備の帯の番号（0067）・起動時に読む・版
   ★画面の本物の関数を切り出して、データベースの応答だけ偽物にして動かす。
   実行: node check/unit/shadow_check_moushi_test.js
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
const PREP_SRC = ['var DB_PREP = ' + /var DB_PREP = (\{[\s\S]*?\});/.exec(SRC)[1] + ';', 'var prepMissing = {};', fn('dbErrKind'), fn('notePrep'), fn('renderPrep'), fn('dbErrText')].join('\n');
const NOW = Date.parse('2026-11-20T12:00:00Z');
function box(o) {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, className: '', textContent: '', kids: [], replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['ho-kpis', 'ho-verdict', 'ho-detail', 'db-prep'].forEach(mk);
  const sent = [], rpcs = [];
  const env = {
    $: (id) => nodes[id],
    kpi: (label, value, unit) => ({ label, value, unit }),
    el: (tag, cls, text) => ({ tag, className: cls || '', textContent: text || '', kids: [], appendChild(c) { this.kids.push(c); return c; } }),
    fmtTime: (x) => (x ? 'T' : '-'),
    fetch: (url) => { sent.push(url); return Promise.reject(new Error('no')); },
    localStorage: { getItem: () => { sent.push('ls'); return null; }, setItem: () => { sent.push('ls-set'); } },
    me: { role: 'admin' }, notes: [],
    JSON, String, Object, Promise, Error, Date, isNaN, Number, Math, RegExp, Array
  };
  env.window = { SUErrors: { note: (k, m) => env.notes.push([k, m]) } };
  vm.createContext(env);
  vm.runInContext([PREP_SRC, 'var SA_FRESH_MS = ' + /var SA_FRESH_MS = ([^;]*);/.exec(SRC)[1] + ';',
    'var HO_KIND = ' + /var HO_KIND = (\[[^;]*\]);/.exec(SRC)[1] + ';',
    'var HO_REFUSED = ' + /var HO_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';', fn('loadHo')].join('\n'), env);
  const sb = {
    rpc: (n) => { rpcs.push(n); return Promise.resolve(o.statusErr ? { error: { code: o.errCode || 'PGRST202' } } : { data: o.status }); },
    from: (tbl) => { rpcs.push('from:' + tbl); return {}; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadHo(sb, NOW) };
}
const V = (b) => b.nodes['ho-verdict'], D = (b) => b.nodes['ho-detail'];
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const KS = (k) => Object.assign({ verified14: 0, mismatch14: 0 }, k);
const KST = (s) => Object.assign({ diff: 1, sent: 1, rowsSent: 3, left: 0, emptyHeld: 0, stale: 0, verify: 4, mismatched: 0, nodate: 0, bad: 0, days: 150, rows: 3000 }, s || {});
const ST = (x, s) => Object.assign({ ok: true,
  kinds: { ev: KS({ days: 150, rows: 3000, verified14: 50 }), vt: KS({ days: 140, rows: 5000, verified14: 40 }), ml: KS({ days: 140, rows: 5000, verified14: 30 }) },
  stat: Object.assign({ ev: KST(), vt: KST({ days: 140, rows: 5000 }), ml: KST({ days: 140, rows: 5000 }), cleaned: 0, ms: 9000 }, s || {}),
  lastAt: ago(10), lastKind: 'meta', lastStatus: 'done', lastRefused: null, refused24h: 0, since: ago(17 * 24 * 60) }, x || {});

(async () => {
  console.log('— A 届いているか —');
  {
    const b = box({ status: ST() }); await b.run();
    t('A 75分以内・食い違い0 → Google と同じ（ok）・写し始めてからの日数', /Google と同じ/.test(V(b).textContent) && /写し始めてから 17日/.test(V(b).textContent) && V(b).className === 'msg ok', V(b));
    t('A 種類ごとの日・照らし合わせ・食い違い・写し始めてからを出す', JSON.stringify(b.nodes['ho-kpis'].kids.map(k => k.value)) === '[150,140,140,120,0,17]', b.nodes['ho-kpis'].kids);
    t('A 種類ごとの最後の回の数を出す', /出来事: Google 150日・3000行／最後の回 違った日 1日・写した日 1日・照らし合わせ 4日/.test(D(b).textContent) && /食事量: /.test(D(b).textContent) && D(b).className === 'msg', D(b).textContent);
    const b2 = box({ status: ST({ lastAt: ago(120) }) }); await b2.run();
    t('A 古い → 自動が止まっていないか警告', /しばらく写っていません/.test(V(b2).textContent) && /hoShadowTick/.test(V(b2).textContent) && /warn/.test(V(b2).className));
    const b3 = box({ status: { ok: true, kinds: {}, lastAt: null } }); await b3.run();
    t('A まだ写していない（入れる部品の名前を出す）', /まだ写していません/.test(V(b3).textContent) && /shadow\.gs/.test(V(b3).textContent) && /setupHoShadow/.test(V(b3).textContent));
    const b4 = box({ statusErr: true }); await b4.run();
    t('A 0067 の前 → 準備はまだ・最上部に統合 0067', /0067）はまだです/.test(V(b4).textContent) && /統合 0067/.test(b4.nodes['db-prep'].textContent), [V(b4).textContent, b4.nodes['db-prep'].textContent]);
    const b5 = box({ statusErr: true, errCode: '42501' }); await b5.run();
    t('A 権限で断られた → ログインの文', /ログインしてください/.test(V(b5).textContent));
    const b6 = box({ status: ST({ kinds: null, stat: null }) }); await b6.run();
    t('A 種類の数が欠けても止まらず0で出す', JSON.stringify(b6.nodes['ho-kpis'].kids.map(k => k.value)) === '[0,0,0,0,0,17]', b6.nodes['ho-kpis'].kids);
  }
  console.log('— B 断った種類 —');
  {
    const b = box({ status: ST({ lastStatus: 'refused', lastRefused: 'badkind' }) }); await b.run();
    t('B 断った種類を職員向けの言葉で', /受け付けませんでした（種類の違い）/.test(V(b).textContent) && /warn/.test(V(b).className), V(b));
    const b2 = box({ status: ST({ lastStatus: 'refused', lastRefused: 'shrink' }) }); await b2.run();
    t('B 急に減った', /（急に減った）/.test(V(b2).textContent));
  }
  console.log('— C 知らせ —');
  {
    const k = ST().kinds; k.vt.mismatch14 = 2;
    const b = box({ status: ST({ kinds: k }) }); await b.run();
    t('C 食い違いがあれば警告（写しは直してある）', /中身が違った日が 2日/.test(V(b).textContent) && /warn/.test(V(b).className));
    const b2 = box({ status: ST({}, { ev: KST({ left: 60 }), ml: KST({ left: 10 }) }) }); await b2.run();
    t('C 初めの写しの途中（種類の合計）', /初めの写しの途中/.test(V(b2).textContent) && /まだ写していない日が 70日/.test(D(b2).textContent));
    const b3 = box({ status: ST({}, { vt: KST({ emptyHeld: 15, bad: 1, nodate: 2 }) }) }); await b3.run();
    t('C 空にしなかった日・使えない形・日付の無い行を種類の名前つきで', /バイタルで Google の行が無くなった日が 15日/.test(D(b3).textContent) && /バイタルに新しい保存先で使えない形の行が 1行/.test(D(b3).textContent)
      && /バイタルに日付の入っていない行が 2行/.test(D(b3).textContent) && /warn/.test(D(b3).className), D(b3).textContent);
    t('C 知らせがある時は「Google と同じ」と言わない', !/Google と同じ/.test(V(b3).textContent) && /warn/.test(V(b3).className), V(b3).textContent);
    const b4 = box({ status: ST({ refused24h: 3 }) }); await b4.run();
    t('C この24時間の断りを知らせる', /受け付けなかった写しが 3回/.test(D(b4).textContent));
  }
  console.log('— D 出さないもの —');
  {
    const b = box({ status: ST() }); await b.run();
    t('D Google・端末の控えに触らない・様子の口だけを呼ぶ', b.sent.length === 0 && JSON.stringify(b.rpcs) === '["ho_shadow_status"]', [b.sent, b.rpcs]);
    t('D 本文の作り方に氏名・本文を使わない', !/\.name\b|\.body\b|\.residents\b|\.events\b|\.reporter\b/.test(fn('loadHo')));
  }
  console.log('— H 画面 —');
  {
    t('H 欄がある（見出し・数・結果・その回の数）', /<h2>申し送りの写し<\/h2>/.test(HTML) && /id="ho-kpis"/.test(HTML) && /id="ho-verdict"/.test(HTML) && /id="ho-detail"/.test(HTML));
    t('H 切り替えのボタンは無い（写しの期間だけ）', !/id="b-ho-/.test(HTML));
    t('H 準備の帯の番号 0067', /ho_shadow_status: '0067'/.test(SRC));
    t('H 起動時に読む（読めない時は文を出す）', /try \{ await loadHo\(sb\); \} catch \(e\) \{ \$\('ho-verdict'\)/.test(SRC));
    t('H 版を上げた（shadow-check.js?v=2026-11-05.2 以降）', /shadow-check\.js\?v=2026-11-(05\.([2-9]|\d{2,})|0[6-9]|[1-3]\d)/.test(HTML));
  }
  console.log('\n' + pass + ' 件合格・' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})();
