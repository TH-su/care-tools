/* 写しの見比べ（shadow-check）の「排泄ケア記録の写し」（統合 0062・2026-11-03 新設）と、ログインしていない端末の数の「排泄ケア記録を開いた端末」。
   守りたいこと:
     A 最後の写しが75分以内なら「Google と同じ」・古ければ警告・まだ写していない・0062 の前（準備はまだ＋最上部に 0062）・権限の断り
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す
     C 照らし合わせで食い違いがあれば警告・初めの写しの途中・空にしなかった日・使えない番号・日付の無い記録を知らせる
     D 出すのは日数・件数・照らし合わせ・時刻・写し始めてからの日数だけ（氏名・記録の中身は出さない）。Google・端末の控えには触らない
     E 端末の数: 排泄ケア記録を開いた端末のログインしていない数・ログイン中の数を出す（0062 の前の答え＝hb が無い時は出さない）
     H 画面: 欄・準備の帯の番号（0062）・版
   ★画面の本物の関数を切り出して、データベースの応答だけ偽物にして動かす。
   実行: node check/unit/shadow_check_haiben_test.js
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
  ['hb-kpis', 'hb-verdict', 'hb-detail', 'db-prep', 'ds-kpis', 'ds-verdict', 'ds-rows'].forEach(mk);
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
    'var HB_REFUSED = ' + /var HB_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';', 'var DS_ROLE = ' + /var DS_ROLE = (\{[^;]*\});/.exec(SRC)[1] + ';',
    fn('loadHb'), fn('loadDeviceSeen')].join('\n'), env);
  const sb = {
    rpc: (n) => {
      rpcs.push(n);
      if (n === 'device_seen_summary') return Promise.resolve({ data: o.ds });
      return Promise.resolve(o.statusErr ? { error: { code: o.errCode || 'PGRST202' } } : { data: o.status });
    },
    from: (tbl) => { rpcs.push('from:' + tbl); return {}; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadHb(sb, NOW), runDs: () => env.loadDeviceSeen(sb) };
}
const V = (b) => b.nodes['hb-verdict'], D = (b) => b.nodes['hb-detail'];
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const STAT = { diff: 1, sent: 1, left: 0, emptyHeld: 0, verify: 5, mismatched: 0, nodate: 0, badId: 0, days: 400, rows: 21000 };
const ST = (x, s) => Object.assign({ ok: true, days: 400, rows: 21000, firstDay: '2025-09-01', lastDay: '2026-11-20', verified14: 380, mismatch14: 0, residents: 38,
  stat: Object.assign({}, STAT, s || {}), lastAt: ago(10), lastKind: 'meta', lastStatus: 'done', lastRefused: null, refused24h: 0, since: ago(17 * 24 * 60) }, x || {});

(async () => {
  console.log('— A 届いているか —');
  {
    const b = box({ status: ST() }); await b.run();
    t('A 75分以内・食い違い0 → Google と同じ（ok）・写し始めてからの日数', /Google と同じ/.test(V(b).textContent) && /写し始めてから 17日/.test(V(b).textContent) && V(b).className === 'msg ok', V(b));
    t('A 日数・記録・照らし合わせ・食い違い・写し始めてからを出す', JSON.stringify(b.nodes['hb-kpis'].kids.map(k => k.value)) === '[400,21000,380,0,17]', b.nodes['hb-kpis'].kids);
    t('A 最後の回の数を出す（違った日・写した日・照らし合わせ）', /違った日 1日・写した日 1日・照らし合わせ 5日/.test(D(b).textContent) && D(b).className === 'msg', D(b));
    const b2 = box({ status: ST({ lastAt: ago(120) }) }); await b2.run();
    t('A 古い → 自動が止まっていないか警告', /しばらく写っていません/.test(V(b2).textContent) && /warn/.test(V(b2).className));
    const b3 = box({ status: { ok: true, days: 0, rows: 0, lastAt: null } }); await b3.run();
    t('A まだ写していない（貼る部品の名前を出す）', /まだ写していません/.test(V(b3).textContent) && /shadow\.gs/.test(V(b3).textContent));
    const b4 = box({ statusErr: true }); await b4.run();
    t('A 0062 の前 → 準備はまだ・最上部に統合 0062', /0062）はまだです/.test(V(b4).textContent) && /統合 0062/.test(b4.nodes['db-prep'].textContent), [V(b4).textContent, b4.nodes['db-prep'].textContent]);
    const b5 = box({ statusErr: true, errCode: '42501' }); await b5.run();
    t('A 権限で断られた → ログインの文', /ログインしてください/.test(V(b5).textContent));
  }
  console.log('— B 断った種類 —');
  {
    const b = box({ status: ST({ lastStatus: 'refused', lastRefused: 'shrink' }) }); await b.run();
    t('B 断った種類を職員向けの言葉で', /受け付けませんでした（急に減った）/.test(V(b).textContent) && /warn/.test(V(b).className), V(b));
  }
  console.log('— C 知らせ —');
  {
    const b = box({ status: ST({ mismatch14: 2 }) }); await b.run();
    t('C 食い違いがあれば警告（写しは直してある）', /中身が違った日が 2日/.test(V(b).textContent) && /warn/.test(V(b).className));
    const b2 = box({ status: ST({}, { left: 120 }) }); await b2.run();
    t('C 初めの写しの途中', /初めの写しの途中/.test(V(b2).textContent) && /まだ写していない日が 120日/.test(D(b2).textContent));
    const b3 = box({ status: ST({}, { emptyHeld: 15, badId: 1, nodate: 2 }) }); await b3.run();
    t('C 空にしなかった日・使えない番号・日付の無い記録を知らせる', /15日あり、10日を超えるので/.test(D(b3).textContent) && /使えない形の記録が 1件/.test(D(b3).textContent)
      && /日付の入っていない記録が 2件/.test(D(b3).textContent) && /warn/.test(D(b3).className), D(b3).textContent);
    t('C 知らせがある時は「Google と同じ」と言わない（警告）', !/Google と同じ/.test(V(b3).textContent) && /このままでは切り替えられません/.test(V(b3).textContent) && /warn/.test(V(b3).className), V(b3).textContent);
    const b4 = box({ status: ST({}, { badRow: 1 }) }); await b4.run();
    t('C 大きすぎる記録を知らせる', /大きすぎる記録が 1件/.test(D(b4).textContent));
  }
  console.log('— D 出さないもの —');
  {
    const b = box({ status: ST() }); await b.run();
    t('D Google・端末の控えに触らない・様子の口だけを呼ぶ', b.sent.length === 0 && JSON.stringify(b.rpcs) === '["hb_shadow_status"]', [b.sent, b.rpcs]);
    t('D 本文の作り方に氏名・記録の中身を使わない', !/\.name\b|\.residents\b|\.records\b|\.notes\b/.test(fn('loadHb')));
  }
  console.log('— E 端末の数 —');
  {
    const rows = [{ role: 'field', login: false, d1: 1, d7: 2, d30: 3 }, { role: 'office', login: true, d1: 1, d7: 1, d30: 1 }];
    const b = box({ ds: { ok: true, rows, hb: [{ role: 'field', login: false, d1: 1, d7: 1, d30: 1 }, { role: 'field', login: true, d1: 3, d7: 4, d30: 4 }], lastAt: 'x' } }); await b.runDs();
    const kp = b.nodes['ds-kpis'].kids.map(k => k.label + '=' + k.value);
    t('E 排泄ケア記録・ログインしていない（7日）の数', kp.indexOf('排泄ケア記録・ログインしていない（7日）=1') >= 0, kp);
    const li = b.nodes['ds-rows'].kids[0];
    const txt = li.kids[0].kids.map(x => x.textContent).join(' ');
    t('E 一覧の先頭に「排泄ケア記録を開いた端末」（ログインしていない・ログイン中）', /排泄ケア記録を開いた端末/.test(txt) && /ログインしていない 1台／ログイン中 4台/.test(txt) && /ログインしてください/.test(txt), txt);
    const b2 = box({ ds: { ok: true, rows, hb: [{ role: 'field', login: true, d1: 3, d7: 4, d30: 4 }], lastAt: 'x' } }); await b2.runDs();
    const txt2 = b2.nodes['ds-rows'].kids[0].kids[0].kids.map(x => x.textContent).join(' ');
    t('E 全部ログイン中なら「すべてログインしています」', /すべてログインしています/.test(txt2), txt2);
    const b3 = box({ ds: { ok: true, rows, lastAt: 'x' } }); await b3.runDs();
    t('E 0062 の前（hb が無い）は排泄ケア記録の数を出さない', !b3.nodes['ds-kpis'].kids.some(k => /排泄/.test(k.label)) && !b3.nodes['ds-rows'].kids.some(li2 => /排泄/.test(JSON.stringify(li2))));
    const b5 = box({ ds: { ok: true, rows: [], hb: [{ role: 'field', login: false, d1: 1, d7: 1, d30: 1 }], lastAt: 'x' } }); await b5.runDs();
    t('E ほかの画面の記録が無くても、排泄ケア記録の数だけで出す', b5.nodes['ds-rows'].kids.length === 1 && !/まだ記録がありません/.test(b5.nodes['ds-verdict'].textContent));
    const b4 = box({ ds: { ok: true, rows, hb: [], lastAt: 'x' } }); await b4.runDs();
    t('E まだ届いていない時はそう出す', /まだ届いていません/.test(JSON.stringify(b4.nodes['ds-rows'].kids[0])));
  }
  console.log('— H 画面 —');
  {
    t('H 欄がある（見出し・数・結果・その回の数）', /<h2>排泄ケア記録の写し<\/h2>/.test(HTML) && /id="hb-kpis"/.test(HTML) && /id="hb-verdict"/.test(HTML) && /id="hb-detail"/.test(HTML));
    t('H 準備の帯の番号 0062', /hb_shadow_status: '0062'/.test(SRC));
    t('H 起動時に読む（読めない時は文を出す）', /try \{ await loadHb\(sb\); \} catch \(e\) \{ \$\('hb-verdict'\)/.test(SRC));
    t('H 版を上げた（shadow-check.js?v=2026-11-05 以降）', /shadow-check\.js\?v=2026-11-(0[5-9]|[1-3]\d)/.test(HTML));
    t('H 切り替え・戻すのボタンと印の行がある（既定で隠す）', /id="hb-mode"/.test(HTML) && /<button type="button" class="btn" id="b-hb-cut" hidden>排泄ケア記録を新しい保存先へ切り替える<\/button>/.test(HTML)
      && /<button type="button" class="btn" id="b-hb-back" hidden>排泄ケア記録を写しの期間に戻す<\/button>/.test(HTML));
    t('H su-hb-full.js は画面の動きより先に読む（版の印つき）', /<script src="su-hb-full\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/.test(HTML) && HTML.indexOf('su-hb-full.js?v=') < HTML.indexOf('shadow-check.js?v='));
    t('H 準備の帯の番号 0064・起動時に印を読む（読めない時はボタンを出さない）', /hb_mode_get: '0064'/.test(SRC) && /try \{ await loadHbMode\(sb\); \} catch \(e\)/.test(SRC));
    t('H ボタンは管理者だけ・切り替えはスイッチ haiben と接続先がある時だけ', /function loadHbMode[\s\S]*?if \(!\(me && me\.role === 'admin'\)\) return;[\s\S]*?bc\.hidden = live \|\| !on \|\| !st;/.test(SRC)
      && /sw\.supabase\.haiben === true/.test(SRC));
    t('H 接続先は排泄ケア記録の画面の控え（hbcr_api_url・hbcr_api_token）を読むだけ（書かない）', /localStorage\.getItem\('hbcr_api_url'\)/.test(SRC) && !/localStorage\.setItem\('hbcr_api/.test(SRC));
    t('H 実行は現場の端末では断り、2回確かめる', /function runHbOp[\s\S]*?role === 'field'[\s\S]*?confirm\('本当に実行しますか？/.test(SRC));
  }
  console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
  process.exit(fail ? 1 : 0);
})();
