/* 写しの見比べ（shadow-check）の「備品の写し」（統合 0046・2026-11-02 新設）。
   守りたいこと:
     A 最後の写しが届いて75分以内なら「届いています」・それより古ければ警告・まだ写していない・0046 の前 を分ける
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す
     C Google へは何も送らない（合言葉・接続先を使わない）
     D 出すのは数・時刻・種類だけ（呼ぶのは様子の口・切り替えの印・記録の一覧だけ）
     E 記録の大きさ（統合 0047）: 上限に対する割合を出し、7割以上で警告する。0047 の前（大きさが無い）は出さない
     F 切り替えた後（sup_mode_get が live）は「切り替え済み」と出し、写しが古いことを警告しない
     G 戻すボタンは、接続先がある管理者にはデータベースが写しの期間でも出す（Google の保存が止まったまま＝戻すが途中で止まった時に押せるように・
       反証レビュー指摘3）。職員マスタも同じ
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
const PREP_SRC = ['var DB_PREP = ' + /var DB_PREP = (\{[\s\S]*?\});/.exec(SRC)[1] + ';', 'var prepMissing = {};', fn('dbErrKind'), fn('notePrep'), fn('renderPrep'), fn('dbErrText'), fn('refusedWord')].join('\n');
const NOW = Date.parse('2026-11-02T12:00:00Z');
function box(o) {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, className: '', textContent: '', kids: [], replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['sup-kpis', 'sup-verdict', 'sup-size', 'sup-runs', 'db-prep'].forEach(mk);
  const sent = [], rpcs = [];
  const env = {
    $: (id) => nodes[id],
    el: (tag, cls, text) => ({ tag, cls, textContent: text || '', kids: [], appendChild(c) { this.kids.push(c); return c; } }),
    kpi: (label, value, unit) => ({ label, value, unit }),
    fmtTime: (x) => (x ? 'T' : '-'),
    ADM_RESULT: { inserted: '初めて写した', updated: '直した', unchanged: '変化なし' },
    fetch: (url) => { sent.push(url); return Promise.reject(new Error('no')); },
    localStorage: { getItem: () => { sent.push('ls'); return null; } },
    me: { role: o.role || 'admin' }, notes: [],
    JSON, String, Object, Promise, Error, Date, isNaN, Number, Math, RegExp
  };
  env.window = { SUErrors: { note: (k, m) => env.notes.push([k, m]) } };
  vm.createContext(env);
  vm.runInContext([PREP_SRC, 'var SUP_FRESH_MS = ' + /var SUP_FRESH_MS = ([^;]*);/.exec(SRC)[1] + ';',
    'var SUP_REFUSED = ' + /var SUP_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';',
    'var SUP_SIZE_WARN = ' + /var SUP_SIZE_WARN = ([^;]*);/.exec(SRC)[1] + ';', fn('supSize'), fn('loadSup')].join('\n'), env);
  const sb = {
    rpc: (n) => {
      rpcs.push(n);
      if (n === 'sup_mode_get') return Promise.resolve(o.modeErr ? { error: { code: 'PGRST202' } } : { data: { ok: true, mode: o.mode || 'shadow', version: 1 } });
      return Promise.resolve(o.statusErr ? { error: { code: o.errCode || 'PGRST202' } } : { data: o.status });
    },
    from: (tbl) => { rpcs.push('from:' + tbl); return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: o.runs || [] }) }) }) }; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadSup(sb, NOW) };
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
    t('D 呼ぶのは様子の口と記録の一覧だけ', JSON.stringify(b.rpcs) === '["sup_shadow_status","sup_mode_get","from:sup_sync_runs"]', b.rpcs);
    t('D 画面に欄がある', /id="sup-kpis"/.test(HTML) && /id="sup-verdict"/.test(HTML) && /id="sup-runs"/.test(HTML));
  }
  console.log('\n— E 記録の大きさ —');
  {
    const MB = 1048576;
    const b = box({ status: { ok: true, ver: 1, items: 1, moves: 1, lastAt: ago(5), lastStatus: 'done', bytesTotal: 2 * MB, bytesLimit: 8 * MB } });
    await b.run();
    const z = b.nodes['sup-size'];
    t('E 25% → 割合を出す・警告しない', /2\.0MB／上限 8\.0MB（25%）/.test(z.textContent) && !/warn/.test(z.className), z);
    const b2 = box({ status: { ok: true, ver: 1, items: 1, moves: 1, lastAt: ago(5), lastStatus: 'done', bytesTotal: 6 * MB, bytesLimit: 8 * MB } });
    await b2.run();
    const z2 = b2.nodes['sup-size'];
    t('E 75% → 警告（上限に近づいています）', /75%/.test(z2.textContent) && /上限に近づいています/.test(z2.textContent) && /warn/.test(z2.className), z2);
    const b3 = box({ status: { ok: true, ver: 1, items: 1, moves: 1, lastAt: ago(5), lastStatus: 'done' } });
    await b3.run();
    t('E 0047 の前（大きさが無い）→ 何も出さない', b3.nodes['sup-size'].textContent === '');
    t('E 画面に欄がある', /id="sup-size"/.test(HTML));
  }
  console.log('\n— F 切り替えた後 —');
  {
    const b = box({ mode: 'live', status: { ok: true, ver: 1, items: 1, moves: 1, lastAt: ago(600), lastStatus: 'done' } });
    await b.run();
    t('F live → 切り替え済み（ok）・写しが古い警告は出さない', /切り替え済み/.test(V(b).textContent) && /ok/.test(V(b).className) && !/しばらく/.test(V(b).textContent), V(b));
    const b2 = box({ modeErr: true, status: { ok: true, ver: 1, items: 1, moves: 1, lastAt: ago(5), lastStatus: 'done' } });
    await b2.run();
    t('F 0047 の前（印の口が無い）→ 今までどおり', /届いています/.test(V(b2).textContent));
  }
  console.log('\n— G 戻すボタン —');
  for (const [label, o, cut, back] of [
    ['写しの期間・スイッチ入・接続先あり', { mode: 'shadow', on: true, cfg: true }, false, false],
    ['切り替えた後・接続先あり', { mode: 'live', on: true, cfg: true }, true, false],
    ['写しの期間・接続先なし', { mode: 'shadow', on: true, cfg: false }, true, true],
    ['管理者でない', { mode: 'shadow', on: true, cfg: true, role: 'office' }, true, true]]) {
    const nodes = {};
    ['sup-mode', 'b-sup-cut', 'b-sup-back'].forEach(id => (nodes[id] = { id, className: '', textContent: '', hidden: false }));
    const env = {
      $: (id) => nodes[id], me: { role: o.role || 'admin' },
      SUKv: { _flags: () => ({ supabase: { supplies: o.on } }) },
      localStorage: { getItem: (k) => (k === 'spl_cfg' && o.cfg ? JSON.stringify({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'x' }) : null) },
      RMASTER_RE: /^https:\/\/script\.google\.com\/[^?#\s]*\/exec$/, JSON, String, Promise
    };
    env.window = env;
    vm.createContext(env);
    vm.runInContext([fn('suppliesOn'), fn('supTarget'), fn('loadSupMode')].join('\n'), env);
    await env.loadSupMode({ rpc: async () => ({ data: { ok: true, mode: o.mode } }) });
    t('G ' + label + ' → 切り替えボタン' + (cut ? '隠す' : '出す') + '・戻すボタン' + (back ? '隠す' : '出す'), nodes['b-sup-cut'].hidden === cut && nodes['b-sup-back'].hidden === back, [nodes['b-sup-cut'].hidden, nodes['b-sup-back'].hidden]);
    if (label === '写しの期間・スイッチ入・接続先あり') t('G 写しの期間は、戻すボタンが途中で止まった時のためのものだと書く', /途中で止まり/.test(nodes['sup-mode'].textContent) && /何も変わりません/.test(nodes['sup-mode'].textContent));
  }
  {
    const body = fn('loadStfMode');
    t('G 職員マスタの戻すボタンも、接続先がある管理者にはいつも出す', /\n    bb\.hidden = !st;/.test(body) && !/bb\.hidden = !live/.test(body) && /途中で止まり/.test(body));
  }
  console.log('\n— H 断りの種類を分ける（2026-11-03） —');
  {
    const b = box({ statusErr: true });
    await b.run();
    const p = b.nodes['db-prep'];
    t('H 無い（PGRST202）→ 欄は準備はまだ・最上部に統合 0046', /0046）はまだです/.test(V(b).textContent) && p.hidden === false && /データベースの準備が足りません：統合 0046/.test(p.textContent), [V(b).textContent, p.textContent]);
    t('H 記録には残さない（無いのは準備の話）', b.env.notes.length === 0);
  }
  for (const code of ['PGRST205', '42883', '42P01']) {
    const b = box({ statusErr: true, errCode: code });
    await b.run();
    t('H ' + code + ' も準備はまだ', /0046）はまだです/.test(V(b).textContent) && /0046/.test(b.nodes['db-prep'].textContent));
  }
  {
    const b = box({ statusErr: true, errCode: '42501' });
    await b.run();
    t('H 権限で断られた（42501）→ ログインの文・準備の帯は出さない', /管理者か事務所のアカウントでログインしてください（2段階認証まで）/.test(V(b).textContent) && !/0046/.test(V(b).textContent) && b.nodes['db-prep'].textContent === '', V(b).textContent);
  }
  {
    const b = box({ statusErr: true, errCode: '57014' });
    await b.run();
    t('H それ以外 → 読めなかった文・記録に残す（種類の番号だけ）', /写しの様子を読めませんでした（少し待って読み込み直してください）/.test(V(b).textContent) && b.env.notes.length === 1 && b.env.notes[0][1] === '57014', [V(b).textContent, b.env.notes]);
    t('H それ以外 → 準備の帯は出さない', b.nodes['db-prep'].textContent === '');
  }
  {
    const b = box({ statusErr: true, role: 'office' });
    await b.run();
    t('H 事務所の人には準備の帯を出さない（SQL を流せるのは管理者）', b.nodes['db-prep'].hidden !== false && b.nodes['db-prep'].textContent === '');
  }
  {
    const env = { $: () => null, me: { role: 'admin' }, Object, String };
    vm.createContext(env);
    vm.runInContext(PREP_SRC, env);
    env.notePrep('sup_mode_get'); env.notePrep('stf_shadow_status'); env.notePrep('mirror_bot_me'); env.notePrep('unknown_fn');
    t('H 番号は重ねず小さい順', JSON.stringify(Object.keys(env.prepMissing).sort()) === '["0044","0047"]', env.prepMissing);
  }
  t('H 画面に準備の帯の欄があり、隠れた状態で始まる・文は textContent だけ', /<p id="db-prep" class="msg warn" hidden><\/p>/.test(HTML) && !/innerHTML/.test(fn('renderPrep')));
  t('H 印刷の間は帯を隠す', /beforeprint[\s\S]{0,120}db-prep[\s\S]{0,40}hidden = true/.test(SRC));
  t('H 職員マスタの欄・ほかの「準備はまだ」の欄も同じ分け方', /dbErrText\(st\.error, 'stf_shadow_status'/.test(SRC) && /dbErrText\(r\.error, 'res_sync_runs'/.test(SRC) && /dbErrText\(r\.error, 'tp_sync_runs'/.test(SRC) && /dbErrText\(r\.error, 'adm_sync_runs'/.test(SRC) && /dbErrText\(r\.error, 'weight_mode'/.test(SRC) && !/textContent = '[^']*はまだです/.test(SRC.replace(/dbErrText\([^)]*\)/g, '')));
  t('H 切り替えの印の口が無い時も準備の帯に足す', ['sup_mode_get', 'stf_mode_get', 'adm_mode_get', 'tp_mode_get', 'res_mode_get'].every(n => SRC.indexOf("notePrep('" + n + "')") >= 0));
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
