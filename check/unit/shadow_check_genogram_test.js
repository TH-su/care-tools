/* 写しの見比べ（shadow-check）の「家族構成図の写し」（統合 0053・0054・2026-11-03 新設）。
   守りたいこと:
     A 最後の写しが75分以内なら「届いています」・それより古ければ警告・まだ写していない・0053 の前（準備はまだ＋最上部に 0053）を分ける
     B 最後の写しを断っていたら、断った種類を職員向けの言葉で出す（同じ氏名の行が2つ＝dup は直し方まで）
     C Google へは何も送らない（様子を出すだけ）・出すのは図の枚数・結び付いた枚数・大きさ・時刻・種類だけ（氏名・家族の中身は出さない）
     D 記録の大きさ: 上限に対する割合を出し、7割以上で警告する
     E 切り替えた後は「切り替え済み」と出し、写しが古いことを警告しない。写し返しが75分を超えて遅れていたら警告する
     G 切り替えボタンはスイッチ genogram が入で接続先（URL と合言葉）がある管理者だけ。戻すボタンは接続先がある管理者にはいつも出す
     H 画面: 欄・ボタン・部品（su-geno-full.js は画面の動きより先）・準備の帯の番号（0053・0054）
   ★画面の本物の関数を切り出して、データベースの応答だけ偽物にして動かす。
   実行: node check/unit/shadow_check_genogram_test.js
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
const NOW = Date.parse('2026-11-03T12:00:00Z');
function box(o) {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, className: '', textContent: '', kids: [], replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['geno-kpis', 'geno-verdict', 'geno-size', 'db-prep'].forEach(mk);
  const sent = [], rpcs = [];
  const env = {
    $: (id) => nodes[id],
    kpi: (label, value, unit) => ({ label, value, unit }),
    fmtTime: (x) => (x ? 'T' : '-'),
    fetch: (url) => { sent.push(url); return Promise.reject(new Error('no')); },
    localStorage: { getItem: () => { sent.push('ls'); return null; } },
    me: { role: o.role || 'admin' }, notes: [],
    JSON, String, Object, Promise, Error, Date, isNaN, Number, Math, RegExp
  };
  env.window = { SUErrors: { note: (k, m) => env.notes.push([k, m]) } };
  vm.createContext(env);
  vm.runInContext([PREP_SRC, 'var SA_FRESH_MS = ' + /var SA_FRESH_MS = ([^;]*);/.exec(SRC)[1] + ';',
    'var GENO_REFUSED = ' + /var GENO_REFUSED = (\{[^;]*\});/.exec(SRC)[1] + ';', fn('genoNote'), fn('saSizeInto'), fn('loadGeno')].join('\n'), env);
  const sb = {
    rpc: (n) => {
      rpcs.push(n);
      if (n === 'geno_mode_get') return Promise.resolve({ data: Object.assign({ ok: true, mode: o.mode || 'shadow', version: 1, mirroredVer: 1, mirroredAt: null }, o.md || {}) });
      return Promise.resolve(o.statusErr ? { error: { code: o.errCode || 'PGRST202' } } : { data: o.status });
    },
    from: (tbl) => { rpcs.push('from:' + tbl); return {}; }
  };
  return { env, nodes, sent, rpcs, run: () => env.loadGeno(sb, NOW) };
}
const V = (b) => b.nodes['geno-verdict'];
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ST = (x) => Object.assign({ ok: true, ver: 1, docs: 30, linked: 26, unlinked: 4, lastAt: ago(10), lastStatus: 'done', lastResult: 'unchanged', bytesTotal: 50000, bytesLimit: 8 * 1048576 }, x || {});

(async () => {
  console.log('— A 届いているか —');
  {
    const b = box({ status: ST() }); await b.run();
    t('A 75分以内 → 届いています（ok）', /届いています/.test(V(b).textContent) && V(b).className === 'msg ok', V(b));
    t('A 図の枚数・結び付いた枚数・氏名だけの枚数を出す', JSON.stringify(b.nodes['geno-kpis'].kids.map(k => k.value)) === '[30,26,4]', b.nodes['geno-kpis'].kids);
    const b2 = box({ status: ST({ lastAt: ago(120) }) }); await b2.run();
    t('A 古い → 自動が止まっていないか警告', /しばらく写っていません/.test(V(b2).textContent) && /warn/.test(V(b2).className));
    const b3 = box({ status: { ok: true, ver: null, lastAt: null } }); await b3.run();
    t('A まだ写していない', /まだ写していません/.test(V(b3).textContent));
    const b4 = box({ statusErr: true }); await b4.run();
    t('A 0053 の前 → 準備はまだ・最上部に統合 0053', /0053）はまだです/.test(V(b4).textContent) && /統合 0053/.test(b4.nodes['db-prep'].textContent), [V(b4).textContent, b4.nodes['db-prep'].textContent]);
    const b5 = box({ statusErr: true, errCode: '42501' }); await b5.run();
    t('A 権限で断られた → ログインの文', /ログインしてください/.test(V(b5).textContent));
  }
  console.log('— B 断った種類 —');
  for (const [k, re] of [['stale', /前に読んだ写し/], ['shrink', /急に減った/], ['badrow', /読めない図/], ['future', /時刻が先/], ['toomany', /図が多すぎる/], ['badchar', /使えない文字/], ['dup', /同じ氏名の行が2つ[\s\S]*genograms/]]) {
    const b = box({ status: ST({ lastStatus: 'refused', lastRefused: k }) }); await b.run();
    t('B ' + k + ' → 職員向けの言葉', re.test(V(b).textContent) && /warn/.test(V(b).className), V(b).textContent);
  }
  console.log('— C 出すもの・送らないもの —');
  {
    const b = box({ status: ST() }); await b.run();
    t('C Google・端末の控えを使わない', b.sent.length === 0, b.sent);
    t('C 呼ぶのは様子の口と切り替えの印だけ（表を直接読まない）', JSON.stringify(b.rpcs) === '["geno_shadow_status","geno_mode_get"]', b.rpcs);
    t('C 中身（氏名・家族）を出す所が無い', !/\.name\b|clientName|\.doc\b|nodes/.test(fn('loadGeno')));
  }
  console.log('— D 大きさ —');
  {
    const b = box({ status: ST({ bytesTotal: 6 * 1048576 }) }); await b.run();
    t('D 7割以上 → 警告', /上限に近づいています/.test(b.nodes['geno-size'].textContent) && /warn/.test(b.nodes['geno-size'].className));
    const b2 = box({ status: ST() }); await b2.run();
    t('D 少ない時は割合だけ', /記録の大きさ: 0\.0MB／上限 8\.0MB（1%）。$/.test(b2.nodes['geno-size'].textContent), b2.nodes['geno-size'].textContent);
  }
  console.log('— E 切り替えた後 —');
  {
    const b = box({ status: ST({ lastAt: ago(600) }), mode: 'live' }); await b.run();
    t('E 切り替えた後は「切り替え済み」・古い警告を出さない', /切り替え済み/.test(V(b).textContent) && V(b).className === 'msg ok');
    const b2 = box({ status: ST(), mode: 'live', md: { version: 1012, mirroredVer: 1010, mirroredAt: ago(120) } }); await b2.run();
    t('E 写し返しが75分を超えて遅れている → 警告', /写し返しが75分を超えて遅れています/.test(V(b2).textContent) && /warn/.test(V(b2).className), V(b2).textContent);
    const b3 = box({ status: ST(), mode: 'live', md: { version: 1012, mirroredVer: 1010, mirroredAt: ago(30) } }); await b3.run();
    t('E 遅れが75分以内 → 警告しない', V(b3).className === 'msg ok');
    const b4 = box({ status: ST(), mode: 'live', md: { version: 1012, mirroredVer: 1012, mirroredAt: ago(600) } }); await b4.run();
    t('E 写し返しが追いついていれば、時刻が古くても警告しない', V(b4).className === 'msg ok');
  }
  console.log('— G ボタン —');
  for (const [label, o, cut, back] of [
    ['写しの期間・スイッチ入・接続先あり', { mode: 'shadow', on: true, cfg: true }, false, false],
    ['写しの期間・スイッチ切・接続先あり', { mode: 'shadow', on: false, cfg: true }, true, false],
    ['切り替えた後・接続先あり', { mode: 'live', on: true, cfg: true }, true, false],
    ['写しの期間・接続先なし', { mode: 'shadow', on: true, cfg: false }, true, true],
    ['合言葉が無い', { mode: 'shadow', on: true, cfg: 'notoken' }, true, true],
    ['管理者でない', { mode: 'shadow', on: true, cfg: true, role: 'office' }, true, true]]) {
    const nodes = {}, rpcs = [];
    ['geno-mode', 'b-geno-cut', 'b-geno-back', 'db-prep'].forEach(id => (nodes[id] = { id, className: '', textContent: '', hidden: false }));
    const env = {
      $: (id) => nodes[id], me: { role: o.role || 'admin' },
      SUKv: { _flags: () => ({ supabase: { genogram: o.on } }) },
      localStorage: { getItem: (k) => (k === 'genogram:cloudCfg' && o.cfg ? JSON.stringify({ gasUrl: 'https://script.google.com/macros/s/EXAMPLE_GENOGRAM/exec', gasToken: o.cfg === 'notoken' ? '' : 'x' }) : null) },
      RMASTER_RE: /^https:\/\/script\.google\.com\/[^?#\s]*\/exec$/, JSON, String, Promise, Object
    };
    env.window = env;
    vm.createContext(env);
    vm.runInContext([PREP_SRC, fn('genoOn'), fn('genoTarget'), fn('loadGenoMode')].join('\n'), env);
    await env.loadGenoMode({ rpc: async (n) => { rpcs.push(n); return { data: { ok: true, mode: o.mode } }; } });
    t('G ' + label + ' → 切り替えボタン' + (cut ? '隠す' : '出す') + '・戻すボタン' + (back ? '隠す' : '出す'), nodes['b-geno-cut'].hidden === cut && nodes['b-geno-back'].hidden === back, [nodes['b-geno-cut'].hidden, nodes['b-geno-back'].hidden]);
    if (label === '管理者でない') t('G 管理者でなければ印も読まない', rpcs.length === 0);
    if (label === '合言葉が無い') t('G 接続先が無い時は ⚙ 設定を案内', /⚙ 設定で URL と編集できる合言葉/.test(nodes['geno-mode'].textContent));
  }
  {
    const nodes = {};
    ['geno-mode', 'b-geno-cut', 'b-geno-back', 'db-prep'].forEach(id => (nodes[id] = { id, className: '', textContent: '', hidden: true }));
    const env = { $: (id) => nodes[id], me: { role: 'admin' }, SUKv: { _flags: () => ({ supabase: {} }) }, localStorage: { getItem: () => null }, RMASTER_RE: /x/, JSON, String, Promise, Object };
    env.window = env; vm.createContext(env);
    vm.runInContext([PREP_SRC, fn('genoOn'), fn('genoTarget'), fn('loadGenoMode')].join('\n'), env);
    await env.loadGenoMode({ rpc: async () => ({ error: { code: 'PGRST202' } }) });
    t('G 切り替えの印の口が無い（0054 の前）→ 準備の帯に 0054・ボタンは出さない', /0054/.test(nodes['db-prep'].textContent) && nodes['b-geno-cut'].hidden && nodes['b-geno-back'].hidden, nodes['db-prep'].textContent);
  }
  console.log('— H 画面 —');
  t('H 欄とボタン（初めは隠す）', /<h2>家族構成図の写し<\/h2>/.test(HTML) && /id="geno-kpis"/.test(HTML) && /id="geno-verdict"/.test(HTML) && /id="geno-size"/.test(HTML)
    && /<button type="button" class="btn" id="b-geno-cut" hidden>家族構成図を新しい保存先へ切り替える<\/button>/.test(HTML) && /<button type="button" class="btn" id="b-geno-back" hidden>家族構成図を写しの期間に戻す<\/button>/.test(HTML));
  t('H su-geno-full.js は画面の動きより先に読む（版の印つき）', /<script src="su-geno-full\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/.test(HTML) && HTML.indexOf('su-geno-full.js?v=') < HTML.indexOf('shadow-check.js?v='));
  t('H 準備の帯の番号に 0053・0054', /geno_shadow_status: '0053'/.test(SRC) && /geno_mode_get: '0054'/.test(SRC));
  t('H ボタンは画面の動きにつないである', /\$\('b-geno-cut'\)\.addEventListener\('click', function \(\) \{ msg\(''\); runGenoOp\('cut'\); \}\);/.test(SRC) && /\$\('b-geno-back'\)\.addEventListener\('click', function \(\) \{ msg\(''\); runGenoOp\('back'\); \}\);/.test(SRC));
  t('H 操作は管理者（2段階認証済み）・事務所PCだけ・スイッチが入の時だけ切り替える', /function runGenoOp\(kind\) \{[\s\S]*me\.status === SUAuth\.STATUS\.OK[\s\S]*role === 'field'[\s\S]*genoOn\(\)/.test(fn('runGenoOp')));
  t('N 切り替えの印の欄・読み直しの失敗を空の catch で捨てない（記録へ）', /try \{ await loadGenoMode\(sb\); \} catch \(e\) \{ genoNote\('印の欄', e\); \}/.test(SRC) && /try \{ await loadGenoMode\(sb\); await loadGeno\(sb\); \} catch \(e\) \{ genoNote\('読み直し', e\); \}/.test(SRC));
  t('H 欄の文は textContent だけ', !/innerHTML/.test(fn('loadGeno') + fn('loadGenoMode') + fn('runGenoOp') + fn('saSizeInto')));
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();
