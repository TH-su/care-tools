/* 写しの見比べ（shadow-check）の「薬学管理の写し」（統合 0092・2026-11-15 新設・排泄ケア記録の写しと同じ型）。
   守りたいこと:
     A 最後の写しが75分以内で知らせが無ければ「Google と同じ」・古ければ警告・まだ写していない・0092 の前（準備はまだ＋最上部に 0092）・権限の断り
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す（知らない印は「ほかの理由」で、印そのものは出さない）
     C 照らし合わせの食い違い・件数の違い・使えない形・重なり・無いタブ・送った後の要約の違い・照らし合わせが動いていない時は警告
     D 出すのは種類ごとの件数・一致したか・時刻・写し始めてからの日数だけ。答えに氏名・薬・理由・HTML が混ざっても画面に出さない。Google・端末の控えには触らない
     H 画面: 欄・準備の帯の番号（0092）・版・切り替えのボタンと確かめの表は無い
   ★画面の本物の関数を切り出して、データベースの応答だけ偽物にして動かす。
   実行: node check/unit/shadow_check_med_test.js
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
  ['med-kpis', 'med-verdict', 'med-detail', 'db-prep'].forEach(mk);
  const sent = [], rpcs = [];
  const env = {
    $: (id) => nodes[id],
    kpi: (label, value, unit) => ({ label, value, unit }),
    fmtTime: (x) => (x ? 'T' : '-'),
    fetch: (url) => { sent.push(url); return Promise.reject(new Error('no')); },
    localStorage: { getItem: () => { sent.push('ls'); return null; }, setItem: () => { sent.push('ls-set'); } },
    me: { role: o.role || 'admin' }, notes: [],
    JSON, String, Object, Promise, Error, Date, isNaN, Number, Math, RegExp, Array
  };
  env.window = { SUErrors: { note: (k, m) => env.notes.push([k, m]) } };
  vm.createContext(env);
  vm.runInContext([PREP_SRC, 'var SA_FRESH_MS = ' + /var SA_FRESH_MS = ([^;]*);/.exec(SRC)[1] + ';',
    'var MED_KIND = ' + /var MED_KIND = (\[[^;]*\]);/.exec(SRC)[1] + ';', 'var MED_REFUSED = ' + /var MED_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';',
    fn('loadMed')].join('\n'), env);
  const sb = {
    rpc: (n) => { rpcs.push(n); return Promise.resolve(o.statusErr ? { error: { code: o.errCode || 'PGRST202' } } : { data: o.status }); },
    from: (tbl) => { rpcs.push('from:' + tbl); return {}; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadMed(sb, NOW) };
}
const V = (b) => b.nodes['med-verdict'], D = (b) => b.nodes['med-detail'], K = (b) => b.nodes['med-kpis'].kids;
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const STAT = { meds: { rows: 38, bad: 0, dup: 0 }, events: { rows: 420, bad: 0, dup: 0 }, dict: { rows: 7, bad: 0, dup: 0 }, missing: 0, tooLarge: 0, afterDiff: 0, verify: 3, mismatched: 0 };
const KINDS = { meds: { rows: 38, match: true, verifiedAt: ago(10), mismatchAt: null }, events: { rows: 420, match: true, verifiedAt: ago(10), mismatchAt: null }, dict: { rows: 7, match: true, verifiedAt: ago(10), mismatchAt: null } };
const ST = (x, s, k) => Object.assign({ ok: true, kinds: JSON.parse(JSON.stringify(Object.assign({}, KINDS, k || {}))), verified14: 3, mismatch14: 0,
  stat: Object.assign(JSON.parse(JSON.stringify(STAT)), s || {}), metaAt: ago(10), lastAt: ago(10), lastKind: 'meta', lastStatus: 'done', lastRefused: null, refused24h: 0, since: ago(17 * 24 * 60) }, x || {});

(async () => {
  console.log('— A 届いているか —');
  {
    const b = box({ status: ST() }); await b.run();
    t('A 75分以内・知らせ無し → Google と同じ（ok）・写し始めてからの日数', /Google と同じ/.test(V(b).textContent) && /写し始めてから 17日/.test(V(b).textContent) && V(b).className === 'msg ok', V(b));
    t('A 種類ごとの件数・照らし合わせ・食い違い・写し始めてからを出す', JSON.stringify(K(b).map(k => k.label + '=' + k.value)) === JSON.stringify(['薬の記録=38', '変更の記録=420', 'タグの辞書=7', '中身まで照らし合わせた種類（14日）=3', '食い違い（14日）=0', '写し始めてから=17']), K(b));
    t('A 種類ごとに Google と写しの件数・一致したかを出す（知らせ無しは警告にしない）', /薬の記録: Google 38件／写し 38件・照らし合わせで一致/.test(D(b).textContent) && D(b).className === 'msg', D(b));
    const b2 = box({ status: ST({ lastAt: ago(120) }) }); await b2.run();
    t('A 古い → 自動（medShadowTick）が止まっていないか警告', /しばらく写っていません/.test(V(b2).textContent) && /medShadowTick/.test(V(b2).textContent) && /warn/.test(V(b2).className));
    const b3 = box({ status: { ok: true, kinds: {}, stat: {}, lastAt: null } }); await b3.run();
    t('A まだ写していない（貼る部品と自動の名前を出す）', /まだ写していません/.test(V(b3).textContent) && /shadow\.gs/.test(V(b3).textContent) && /setupMedShadow/.test(V(b3).textContent) && K(b3).length === 0, V(b3).textContent);
    const b4 = box({ statusErr: true }); await b4.run();
    t('A 0092 の前 → データベースの準備（0092）はまだです・最上部に統合 0092', /データベースの準備（0092）はまだです/.test(V(b4).textContent) && /統合 0092/.test(b4.nodes['db-prep'].textContent), [V(b4).textContent, b4.nodes['db-prep'].textContent]);
    const b4b = box({ statusErr: true, role: 'office' }); await b4b.run();
    t('A 0092 の前（事務所）→ 欄の文は出し、最上部の帯は管理者だけ', /データベースの準備（0092）はまだです/.test(V(b4b).textContent) && b4b.nodes['db-prep'].textContent === '');
    const b5 = box({ statusErr: true, errCode: '42501' }); await b5.run();
    t('A 権限で断られた → ログインの文（準備の帯には出さない）', /ログインしてください/.test(V(b5).textContent) && b5.nodes['db-prep'].textContent === '');
    const b6 = box({ statusErr: true, errCode: 'XX000' }); await b6.run();
    t('A そのほかの失敗 → 読めなかった文（種類だけ記録に残す）', /読めませんでした/.test(V(b6).textContent) && JSON.stringify(b6.env.notes) === JSON.stringify([['写しの見比べ: med_shadow_status', 'XX000']]), b6.env.notes);
  }
  console.log('— B 断った種類 —');
  {
    const b = box({ status: ST({ lastStatus: 'refused', lastRefused: 'shrink', refused24h: 1 }) }); await b.run();
    t('B 断った種類を職員向けの言葉で', /受け付けませんでした（急に減った）/.test(V(b).textContent) && /warn/.test(V(b).className) && /受け付けなかった写しが 1回/.test(D(b).textContent), V(b));
    const b2 = box({ status: ST({ lastStatus: 'refused', lastRefused: '<img src=x onerror=1>' }) }); await b2.run();
    t('B 知らない印は「ほかの理由」（印そのものは画面に出さない）', /ほかの理由/.test(V(b2).textContent) && !/img/.test(V(b2).textContent), V(b2).textContent);
  }
  console.log('— C 知らせ —');
  {
    const b = box({ status: ST({ mismatch14: 1 }, {}, { meds: { rows: 38, match: false } }) }); await b.run();
    t('C この14日に食い違い → 警告（写しは直してある）・その種類に食い違いの印', /中身が違った種類が 1つ/.test(V(b).textContent) && /warn/.test(V(b).className)
      && /薬の記録: Google 38件／写し 38件・照らし合わせで食い違い/.test(D(b).textContent), [V(b).textContent, D(b).textContent]);
    const cases = [
      ['件数が合わない', ST({}, { events: { rows: 421, bad: 0, dup: 0 } }), /変更の記録の Google と写しの件数が合っていません（Google 421件／写し 420件）/],
      ['使えない形の記録', ST({}, { meds: { rows: 38, bad: 2, dup: 0 } }), /薬の記録に新しい保存先で使えない形の記録が 2件/],
      ['同じ番号の重なり', ST({}, { meds: { rows: 38, bad: 0, dup: 1 } }), /同じ番号の記録が 1件重なっています/],
      ['無いタブ', ST({}, { missing: 1 }), /無いタブが 1つ/],
      ['大きすぎる種類', ST({}, { tooLarge: 1 }), /大きすぎて写せない種類が 1つ/],
      ['送った後の要約が合わない', ST({}, { afterDiff: 1 }), /写した後に照らした要約が 1種類で合いませんでした/],
      ['この24時間に断った回', ST({ refused24h: 2 }), /受け付けなかった写しが 2回/],
      ['照らし合わせが動いていない', ST({ verified14: 0 }), /中身の照らし合わせが動いていません/]
    ];
    for (const [name, st, re] of cases) {
      const w = box({ status: st }); await w.run();
      t('C ' + name + ' → 知らせ・「Google と同じ」と言わない', re.test(D(w).textContent) && /warn/.test(D(w).className) && !/Google と同じ/.test(V(w).textContent) && /warn/.test(V(w).className), [V(w).textContent, D(w).textContent]);
    }
    const wr = box({ status: ST({ refused24h: 1 }, { meds: { rows: 3, bad: 0, dup: 0, refused: true, shrink: true }, events: { rows: 420, refused: true, shrink: false }, refused: 2 }) }); await wr.run();
    t('C 急に減って断られた種類・ほかの理由で断られた種類を知らせる（最後の回の記録は数で受け付けていても「Google と同じ」と言わない）',
      /薬の記録が急に減ったので、最後の回は写していません（次の回も同じ件数なら/.test(D(wr).textContent) && /変更の記録は最後の回に受け付けられず/.test(D(wr).textContent)
      && !/Google と同じ/.test(V(wr).textContent) && /warn/.test(V(wr).className), [V(wr).textContent, D(wr).textContent]);
    const wk = box({ status: ST({ shrinkOk14: 2 }) }); await wk.run();
    t('C 減ったのを受け付けた回は件数だけ添える（それだけでは警告にしない）', /本当に減ったものとして受け付けた回が 2回/.test(D(wk).textContent) && /Google と同じ/.test(V(wk).textContent) && D(wk).className === 'msg', [V(wk).textContent, D(wk).textContent]);
    const w = box({ status: ST({}, {}, { dict: { rows: 7 } }) }); await w.run();
    t('C まだ照らし合わせていない種類はそう出す', /タグの辞書: Google 7件／写し 7件・まだ照らし合わせていません/.test(D(w).textContent), D(w).textContent);
  }
  console.log('— D 出さないもの —');
  {
    const evil = '<script>見本 甲</script>';
    const b = box({ status: ST({ lastKind: evil, name: evil, residents: [evil], drugName: '見本薬', reason: '見本の理由' },
      { meds: { rows: 38, bad: 0, dup: 0, name: evil, drugName: '見本薬' }, note: evil },
      { meds: { rows: 38, match: true, name: evil, reason: '見本の理由' }, other: { rows: 9, name: evil } }) });
    await b.run();
    const shown = JSON.stringify([K(b), V(b).textContent, D(b).textContent]);
    t('D 答えに氏名・薬・理由・HTML が混ざっても画面に出さない', !/見本|<script|script>|other/.test(shown), shown);
    const wn = box({ status: ST({}, {}, { meds: { rows: '<b>9</b>', match: true } }) }); await wn.run();
    t('D 数は数として出す（文字の数は 0 に直す）', K(wn)[0].value === 0 && !/<b>/.test(D(wn).textContent), [K(wn)[0], D(wn).textContent]);
    t('D Google・端末の控えに触らない・様子の口だけを呼ぶ', b.sent.length === 0 && JSON.stringify(b.rpcs) === '["med_shadow_status"]', [b.sent, b.rpcs]);
    t('D 画面への書き込みは textContent だけ（innerHTML を使わない）', !/innerHTML|insertAdjacentHTML|outerHTML/.test(fn('loadMed')));
    t('D 本文の作り方に氏名・薬・理由の項目を使わない', !/\.name\b|\.drugName\b|\.reason\b|\.currentMeds\b|\.label\b/.test(fn('loadMed')));
  }
  console.log('— H 画面 —');
  {
    t('H 欄がある（見出し・数・結果・その回の数）', /<h2>薬学管理の写し<\/h2>/.test(HTML) && /id="med-kpis"/.test(HTML) && /id="med-verdict"/.test(HTML) && /id="med-detail"/.test(HTML));
    t('H 準備の帯の番号 0092', /med_shadow_status: '0092'/.test(SRC));
    t('H 起動時に読む（読めない時は文を出す）', /try \{ await loadMed\(sb\); \} catch \(e\) \{ \$\('med-verdict'\)/.test(SRC));
    t('H 版を上げた（shadow-check.js?v=2026-11-15 以降）', /shadow-check\.js\?v=2026-11-(1[5-9]|[23]\d)/.test(HTML));
    t('H 切り替えのボタン・印の行・確かめの表は無い（写しの期間だけ）', !/id="b-med-|id="med-mode"|id="gate-med"/.test(HTML) && !/med_mode_get|med_set_mode|loadMedMode|runMedOp/.test(SRC));
    const gate = /var GATE = \{[\s\S]*?\n  \};/.exec(SRC);
    t('H 切り替える前の確かめの表（GATE）に薬学管理を足していない', !gate || !/\bmed\b|med_/.test(gate[0]));
  }
  console.log('\n' + pass + ' 件 合格 / ' + fail + ' 件 不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
