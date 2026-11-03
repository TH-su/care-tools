/* 正本を切り替える前の確かめの表（su-cutover-gate.js・写しの見比べ・2026-11-03 代表者の依頼）の試験
   実行: node check/unit/cutover_gate_test.js
   守りたいこと:
     A 差が0件の連続日数: ちょうど3日で満たす・2日では満たさない・途中に差のある日／見比べなかった日があれば数え直し・
       今日まだ見比べていなければ昨日までで数える・今日の見比べで差があれば0日。準備（0055）がまだ・読めない時は満たさない
     B ログインしていない端末: この7日に0台で満たす・1台でも満たさない・数が分からない（行が無い・この7日に1台も届いていない・0048 がまだ・断られた）時は満たさない
     C 毎晩の通し試験: 毎晩の回（と手で回した回）の最新が合格かつ26時間以内で満たす。PR の回は数えない。不合格・古い・読めない時は満たさない
     D 1日1つ: 今日（日本時間）別の正本を「本番にした」記録があれば満たさない。戻した記録・同じ正本・昨日の記録は数えない。
       週間計画などの記録（kv_families・mode:live）も、一覧に無い *_mode（家族構成図など）も数える。日本時間の0時の境目（UTC 15:00）で日付が変わる
     E 4つ全部そろった時だけ ok。理由は満たさない項目にだけ付く
     F 画面のつなぎ（shadow-check.js の本物の関数）: 表はボタンが出ている時だけ出し、そろわない時はボタンを押せなくする。
       読めない時（gateIn が無い）は押せない側に倒す。押した時は読み直して確かめる。5つのボタンだけに付き、戻すボタン・備品・シフト分析には付けない
     G 差の記録: 入居者マスタ・計画書・入居調整の写し（run）は、読み直した差の件数を shadow_diff_note へ残す。残せなくても写しの結果は返す
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const G = require(path.join(ROOT, 'su-cutover-gate.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'shadow-check.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'shadow-check.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 300) : '')); } }

const NOW = Date.parse('2026-11-03T11:00:00Z');   // 日本時間 11/3 20:00
const TODAY = '2026-11-03';
const day = (n) => new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const rows = (kind, list) => list.map(([n, worst, checks]) => ({ kind, day: day(n), checks: checks == null ? 1 : checks, worst }));
const FLOW_OK = [{ event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-11-02T17:47:00Z' }];
const DEV0 = { rows: [{ role: 'office', login: true, d1: 2, d7: 3, d30: 3 }, { role: 'field', login: false, d1: 0, d7: 0, d30: 2 }] };
const CUT0 = { audit: [] };
const base = (o) => Object.assign({ kind: 'tp', now: NOW, today: TODAY, diff: { rows: rows('tp', [[0, 0], [1, 0], [2, 0]]) }, dev: { data: DEV0 }, flow: { runs: FLOW_OK }, cut: CUT0 }, o || {});
const item = (v, k) => v.items.filter((x) => x.key === k)[0];

console.log('A 差が0件の連続日数');
{
  const s = (list, kind) => G.streak(rows(kind || 'tp', list), 'tp', TODAY).days;
  t('今日・昨日・一昨日の3日で3日', s([[0, 0], [1, 0], [2, 0]]) === 3);
  t('2日では2日', s([[0, 0], [1, 0]]) === 2);
  t('途中（2日前）に差があれば、そこで止まる', s([[0, 0], [1, 0], [2, 4], [3, 0], [4, 0]]) === 2);
  t('見比べなかった日（2日前）があれば、そこで止まる', s([[0, 0], [1, 0], [3, 0], [4, 0]]) === 2);
  t('今日まだ見比べていなければ、昨日までの3日で3日', s([[1, 0], [2, 0], [3, 0]]) === 3);
  t('今日の見比べで差があれば0日', s([[0, 2], [1, 0], [2, 0], [3, 0]]) === 0 && G.streak(rows('tp', [[0, 2]]), 'tp', TODAY).todayWorst === 2);
  t('見比べの回数が0の行は数えない', s([[0, 0], [1, 0, 0], [2, 0]]) === 1);
  t('ほかの種類の行は数えない', G.streak(rows('adm', [[0, 0], [1, 0], [2, 0]]), 'tp', TODAY).days === 0);
  t('行が無ければ0日', G.streak([], 'tp', TODAY).days === 0 && G.streak(null, 'tp', TODAY).days === 0);
  const v2 = G.judge(base({ diff: { rows: rows('tp', [[0, 0], [1, 0]]) } }));
  t('2日では満たさず、あと何日かを出す', !item(v2, 'diff').ok && item(v2, 'diff').value === '2日' && /あと 1日/.test(item(v2, 'diff').why), item(v2, 'diff'));
  t('今日の差の件数を理由に出す', /差が 5件/.test(item(G.judge(base({ diff: { rows: rows('tp', [[0, 5]]) } })), 'diff').why));
  t('0055 がまだなら満たさない（準備の番号を出す）', !item(G.judge(base({ diff: { error: 'missing' } })), 'diff').ok && /0055/.test(item(G.judge(base({ diff: { error: 'missing' } })), 'diff').why));
  t('読めない時は満たさない', !item(G.judge(base({ diff: { error: 'other' } })), 'diff').ok && !item(G.judge(base({ diff: {} })), 'diff').ok);
  t('知らない種類は満たさない', !item(G.judge(base({ kind: 'sup' })), 'diff').ok);
}

console.log('B ログインしていない端末');
{
  t('この7日に0台なら満たす', item(G.judge(base()), 'device').ok && item(G.judge(base()), 'device').value === '0台');
  const one = { rows: [{ role: 'field', login: false, d1: 0, d7: 1, d30: 1 }, { role: 'office', login: false, d1: 0, d7: 0, d30: 4 }] };
  const v = G.judge(base({ dev: { data: one } }));
  t('1台でも満たさず、台数を出す', !item(v, 'device').ok && item(v, 'device').value === '1台' && /1台/.test(item(v, 'device').why), item(v, 'device'));
  t('30日前だけの端末は数えない（7日で数える）', G.unlogged({ rows: [{ login: true, d7: 2 }, { login: false, d7: 0, d30: 5 }] }) === 0);
  const stale = G.judge(base({ dev: { data: { rows: [{ role: 'office', login: true, d1: 0, d7: 0, d30: 3 }, { role: 'field', login: false, d1: 0, d7: 0, d30: 4 }] } } }));
  t('この7日に1台も届いていない（送るのが止まった）時は0台とみなさず満たさない', !item(stale, 'device').ok && item(stale, 'device').value === '—' && G.unlogged({ rows: [{ login: false, d7: 0, d30: 5 }] }) === null, item(stale, 'device'));
  t('ログイン中の端末は数えない', G.unlogged({ rows: [{ login: true, d7: 9 }] }) === 0);
  const none = G.judge(base({ dev: { data: { ok: true, rows: [] } } }));
  t('行が無い（数が届いていない）時は0台とみなさず満たさない', !item(none, 'device').ok && item(none, 'device').value === '—' && /device_seen/.test(item(none, 'device').why), item(none, 'device'));
  t('0048 がまだなら満たさない', !item(G.judge(base({ dev: { error: 'missing' } })), 'device').ok && /0048/.test(item(G.judge(base({ dev: { error: 'missing' } })), 'device').why));
  t('断られた時は満たさない', !item(G.judge(base({ dev: { error: 'denied' } })), 'device').ok);
}

console.log('C 毎晩の通し試験');
{
  t('最新の毎晩の回が合格・26時間以内なら満たす', item(G.judge(base()), 'flow').ok && /合格（11\/3 2:47）/.test(item(G.judge(base()), 'flow').value), item(G.judge(base()), 'flow'));
  const stale = [{ event: 'schedule', status: 'completed', conclusion: 'success', created_at: new Date(NOW - 27 * 3600 * 1000).toISOString() }];
  t('27時間前の合格は満たさない', !item(G.judge(base({ flow: { runs: stale } })), 'flow').ok && /26時間/.test(item(G.judge(base({ flow: { runs: stale } })), 'flow').why));
  const failed = [{ event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-02T17:47:00Z' },
                  { event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-11-01T17:47:00Z' }];
  t('最新が不合格なら、前の合格があっても満たさない', !item(G.judge(base({ flow: { runs: failed } })), 'flow').ok && /不合格/.test(item(G.judge(base({ flow: { runs: failed } })), 'flow').value));
  const pr = [{ event: 'pull_request', status: 'completed', conclusion: 'success', created_at: '2026-11-03T10:00:00Z' },
              { event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-11-02T17:47:00Z' }];
  t('PR の回は数えない', G.lastNightly(pr).event === 'schedule' && !item(G.judge(base({ flow: { runs: pr } })), 'flow').ok);
  const running = [{ event: 'schedule', status: 'in_progress', conclusion: null, created_at: '2026-11-03T10:00:00Z' }].concat(FLOW_OK);
  t('走っている途中の回は飛ばして、終わった最新を見る', item(G.judge(base({ flow: { runs: running } })), 'flow').ok);
  t('手で回した回（workflow_dispatch）も数える', G.lastNightly([{ event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-11-03T09:00:00Z' }].concat(FLOW_OK)).event === 'workflow_dispatch');
  t('結果が無い時は満たさない', !item(G.judge(base({ flow: { runs: [] } })), 'flow').ok);
  t('GitHub に届かない時は満たさない', !item(G.judge(base({ flow: { error: 'other' } })), 'flow').ok);
}

console.log('D 1日1つ');
{
  const live = (entity, at) => ({ at, entity, entity_ids: ['live'] });
  t('今日の記録が無ければ満たす', item(G.judge(base()), 'oneday').ok && item(G.judge(base()), 'oneday').value === 'なし');
  const v = G.judge(base({ cut: { audit: [live('adm_mode', '2026-11-03T01:00:00Z')] } }));
  t('今日、別の正本（入居調整）を本番にしていれば満たさない', !item(v, 'oneday').ok && /入居調整/.test(item(v, 'oneday').why) && /1日1つ/.test(item(v, 'oneday').why), item(v, 'oneday'));
  t('同じ正本の切り替え直しは数えない', item(G.judge(base({ cut: { audit: [live('tp_mode', '2026-11-03T01:00:00Z')] } })), 'oneday').ok);
  t('写しの期間に戻した記録は数えない', item(G.judge(base({ cut: { audit: [{ at: '2026-11-03T01:00:00Z', entity: 'res_mode', entity_ids: ['shadow'] }] } })), 'oneday').ok);
  t('写し返しの記録（mirrored）は数えない', item(G.judge(base({ cut: { audit: [{ at: '2026-11-03T01:00:00Z', entity: 'res_mode', entity_ids: ['mirrored'] }] } })), 'oneday').ok);
  t('昨日（日本時間）の記録は数えない', item(G.judge(base({ cut: { audit: [live('stf_mode', '2026-11-02T14:59:00Z')] } })), 'oneday').ok);
  t('日本時間の0時（UTC 15:00）を過ぎた記録は今日', !item(G.judge(base({ cut: { audit: [live('stf_mode', '2026-11-02T15:00:00Z')] } })), 'oneday').ok);
  t('備品・シフト分析を本番にした日も満たさない', !item(G.judge(base({ cut: { audit: [live('sup_mode', '2026-11-03T02:00:00Z')] } })), 'oneday').ok
    && !item(G.judge(base({ cut: { audit: [live('sa_mode', '2026-11-03T02:00:00Z')] } })), 'oneday').ok);
  const kvRow = (fam, mode, at) => ({ at, entity: 'kv_families', entity_ids: [fam], fields: ['mode:' + mode] });
  const vk = G.judge(base({ cut: { audit: [kvRow('shift', 'live', '2026-11-03T03:00:00Z')] } }));
  t('勤務表を今日本番にした記録（kv_families・mode:live）があれば満たさない', !item(vk, 'oneday').ok && /勤務表/.test(item(vk, 'oneday').why), item(vk, 'oneday'));
  t('週間計画を写しの期間に戻した記録（mode:shadow）は数えない', item(G.judge(base({ cut: { audit: [kvRow('care', 'shadow', '2026-11-03T03:00:00Z')] } })), 'oneday').ok);
  t('一覧に無い *_mode（家族構成図）も数える', !item(G.judge(base({ cut: { audit: [live('geno_mode', '2026-11-03T02:00:00Z'), live('zzz_mode', '2026-11-03T02:00:00Z')] } })), 'oneday').ok
    && G.cutsToday([live('geno_mode', '2026-11-03T02:00:00Z'), live('zzz_mode', '2026-11-03T02:00:00Z')], TODAY, 'tp').join() === '家族構成図,zzz_mode');
  t('*_mode でない記録（res_core など）は数えない', item(G.judge(base({ cut: { audit: [live('res_core', '2026-11-03T02:00:00Z')] } })), 'oneday').ok);
  t('今日本番にしてから戻した日も数える', !item(G.judge(base({ cut: { audit: [live('adm_mode', '2026-11-03T01:00:00Z'), { at: '2026-11-03T02:00:00Z', entity: 'adm_mode', entity_ids: ['shadow'] }] } })), 'oneday').ok);
  t('同じ日の記録が2つでも名前は1回', G.cutsToday([live('adm_mode', '2026-11-03T01:00:00Z'), live('adm_mode', '2026-11-03T02:00:00Z')], TODAY, 'tp').length === 1);
  t('読めない時は満たさない', !item(G.judge(base({ cut: { error: 'other' } })), 'oneday').ok && !item(G.judge(base({ cut: {} })), 'oneday').ok);
  t('日本時間の日付: 23:30 UTC は翌日', G.jstDay('2026-11-02T23:30:00Z') === '2026-11-03' && G.jstDay('2026-11-02T14:59:59Z') === '2026-11-02' && G.jstDay('x') === '');
  t('今日の0時（日本時間）は前日 15:00 UTC', G.jstDayStartIso('2026-11-03') === '2026-11-02T15:00:00.000Z' && G.jstDayStartIso('bad') === '');
  t('today が無ければ now から日本時間で決める', G.judge(Object.assign(base(), { today: undefined, now: Date.parse('2026-11-02T15:30:00Z') })).items.length === 4
    && item(G.judge(Object.assign(base(), { today: undefined, now: Date.parse('2026-11-02T15:30:00Z') })), 'diff').ok);
}

console.log('E まとめ');
{
  const v = G.judge(base());
  t('4つそろえば ok・理由は空', v.ok && v.items.length === 4 && v.items.every((x) => x.ok && !x.why), v);
  const n = G.judge(base({ dev: { data: { rows: [] } }, flow: { error: 'other' } }));
  t('1つでも欠ければ ok でなく、欠けた項目にだけ理由', !n.ok && item(n, 'diff').ok && !item(n, 'diff').why && !!item(n, 'device').why && !!item(n, 'flow').why && item(n, 'oneday').ok);
  t('項目の順と名前（依頼の4つ）', v.items.map((x) => x.key).join() === 'diff,device,flow,oneday'
    && /3日以上/.test(v.items[0].label) && /0台/.test(v.items[1].label) && /flow-check/.test(v.items[2].label) && /1日1つ/.test(v.items[3].label));
  t('丸囲み数字を使わない', !/[①-⓿❶-➓]/.test(fs.readFileSync(path.join(ROOT, 'su-cutover-gate.js'), 'utf8')));
}

/* ── F 画面のつなぎ（本物の関数を切り出して動かす）── */
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
function glue(o) {
  o = o || {};
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || { id, hidden: false, disabled: false, kids: [], className: '', textContent: '',
    replaceChildren() { this.kids = []; }, appendChild(c) { this.kids.push(c); return c; } });
  ['b-res-cut', 'b-tp-cut', 'b-adm-cut', 'b-stf-cut', 'b-live-weight', 'wt-admin', 'gate-res', 'gate-tp', 'gate-adm', 'gate-stf', 'gate-weight', 'db-prep'].forEach(node);
  Object.keys(o.hidden || {}).forEach((k) => { nodes[k].hidden = o.hidden[k]; });
  const calls = [];
  const sb = {
    rpc: async (name, args) => { calls.push(name); return o.rpc && o.rpc[name] ? o.rpc[name](args) : { data: null, error: { code: 'PGRST202' } }; },
    from: (tbl) => { const q = { select() { return q; }, eq() { return q; }, or(f) { calls.push('or:' + f); return q; }, gte() { return q; }, limit() { return q; }, then(ok, ng) { calls.push(tbl); return Promise.resolve(o.from && o.from[tbl] ? o.from[tbl] : { data: [], error: null }).then(ok, ng); } }; return q; }
  };
  const ctx = {
    $: (id) => nodes[id],
    el: (tag, cls, text) => ({ tag, cls, textContent: text == null ? '' : text, kids: [], appendChild(c) { this.kids.push(c); return c; } }),
    SUCutGate: G, SUAuth: { client: () => sb }, me: { role: o.role || 'admin' }, weightMode: o.weightMode || 'shadow',
    Date: { now: () => NOW, parse: Date.parse }, Object, Array, String, Number, Promise, JSON, AbortController, setTimeout, clearTimeout,
    fetch: async () => (o.fetchFail ? Promise.reject(new Error('net')) : { ok: true, json: async () => ({ workflow_runs: o.runs || FLOW_OK }) })
  };
  vm.createContext(ctx);
  const code = [
    'var DB_PREP = ' + /var DB_PREP = (\{[\s\S]*?\});/.exec(SRC)[1] + ';', 'var prepMissing = {};',
    fn('dbErrKind'), fn('notePrep'), fn('renderPrep'),
    /var GATE = \{[^\n]*\};/.exec(SRC)[0], /var GATE_NG = [^\n]*;/.exec(SRC)[0], /var FLOW_RUNS = [^\n]*;/.exec(SRC)[0], 'var gateIn = null;',
    fn('readFlowRuns'), fn('gateSafe'), fn('gateErr'), fn('loadGate'), fn('gateShown'), fn('gateApply'), fn('renderGate'), fn('gateRefresh'), fn('gatePass'),
    'this.loadGate = loadGate; this.gatePass = gatePass; this.gateApply = gateApply; this.getIn = function () { return gateIn; }; this.prep = function () { return prepMissing; };'
  ].join('\n');
  vm.runInContext(code, ctx);
  return { ctx, nodes, calls, sb };
}
const OKRPC = {
  shadow_diff_days: () => ({ data: { ok: true, today: TODAY, rows: ['res', 'tp', 'adm', 'stf', 'weight'].flatMap((k) => rows(k, [[0, 0], [1, 0], [2, 0]])) }, error: null }),
  device_seen_summary: () => ({ data: DEV0, error: null })
};
const texts = (n) => [n.textContent].concat((n.kids || []).flatMap(texts));

(async () => {
  console.log('F 画面のつなぎ');
  {
    const g = glue({ rpc: OKRPC });
    await g.ctx.loadGate(g.sb);
    const five = ['res', 'tp', 'adm', 'stf', 'weight'];
    t('4つそろえば5つの表を出し、ボタンを押せる', five.every((k) => !g.nodes['gate-' + k].hidden) && ['b-res-cut', 'b-tp-cut', 'b-adm-cut', 'b-stf-cut', 'b-live-weight'].every((id) => !g.nodes[id].disabled));
    const all = texts(g.nodes['gate-tp']).join('|');
    t('表に4項目・今の値・判定が出る', /1\. 写しと正本の差/.test(all) && /4\. 今日すでに/.test(all) && /3日/.test(all) && /0台/.test(all) && /満たす/.test(all), all.slice(0, 200));
    t('読むのは差の記録・端末の数・操作の記録・GitHub だけ', ['shadow_diff_days', 'device_seen_summary', 'audit_log'].every((x) => g.calls.indexOf(x) >= 0) && g.calls.indexOf('kv_families') < 0, g.calls);
    t('操作の記録は *_mode と kv_families だけを読む', g.calls.indexOf('or:entity.like.*_mode,entity.eq.kv_families') >= 0, g.calls);
    t('通し試験の結果は公開の GitHub の決まった住所から読む（ログインの情報を付けない）', /^https:\/\/api\.github\.com\/repos\/TH-su\/care-tools\/actions\/workflows\/flow-check\.yml\/runs\?branch=main/.test(/var FLOW_RUNS = '([^']+)'/.exec(SRC)[1]) && /credentials: 'omit'/.test(fn('readFlowRuns')));
  }
  {
    const g = glue({ rpc: { shadow_diff_days: OKRPC.shadow_diff_days } });   // 端末の数が無い（0048 の前）
    await g.ctx.loadGate(g.sb);
    t('1項目でも欠ければ5つとも押せない', ['b-res-cut', 'b-tp-cut', 'b-adm-cut', 'b-stf-cut', 'b-live-weight'].every((id) => g.nodes[id].disabled));
    t('欠けた理由を表に出す', /0048/.test(texts(g.nodes['gate-res']).join('|')));
    t('準備が足りない番号（0048）を最上部の帯に足す', g.ctx.prep()['0048'] === 1);
    t('押した時は読み直して確かめ、そろっていなければ false', (await g.ctx.gatePass('res')) === false && g.calls.filter((c) => c === 'device_seen_summary').length === 2);
  }
  {
    const g = glue({ rpc: OKRPC, hidden: { 'b-res-cut': true, 'b-adm-cut': true } });
    await g.ctx.loadGate(g.sb);
    t('ボタンが出ていない時は表も出さない', g.nodes['gate-res'].hidden && g.nodes['gate-adm'].hidden && !g.nodes['gate-tp'].hidden);
  }
  {
    const g = glue({ rpc: OKRPC, weightMode: 'live' });
    await g.ctx.loadGate(g.sb);
    t('体重が本番の後は体重の表を出さない', g.nodes['gate-weight'].hidden);
  }
  {
    const g = glue({ rpc: OKRPC, role: 'office' });
    await g.ctx.loadGate(g.sb);
    t('事務所のアカウントには表を出さず、何も読まない', ['res', 'tp', 'adm', 'stf', 'weight'].every((k) => g.nodes['gate-' + k].hidden) && g.calls.length === 0);
  }
  {
    const g = glue({ rpc: OKRPC, fetchFail: true });
    await g.ctx.loadGate(g.sb);
    t('GitHub に届かない時は押せない', g.nodes['b-tp-cut'].disabled && /GitHub に届きません/.test(texts(g.nodes['gate-tp']).join('|')));
    t('押した時も false', (await g.ctx.gatePass('tp')) === false);
  }
  {
    const g = glue({ rpc: OKRPC });
    g.ctx.gateApply();   // まだ読んでいない（gateIn が無い）
    t('表を読めていない時は押せない側に倒す', g.nodes['b-tp-cut'].disabled && /読めませんでした/.test(texts(g.nodes['gate-tp']).join('|')));
  }
  {
    const g = glue({ rpc: OKRPC, from: { audit_log: { data: [{ at: '2026-11-03T01:00:00Z', entity: 'adm_mode', entity_ids: ['live'] }], error: null } } });
    await g.ctx.loadGate(g.sb);
    t('今日入居調整を切り替えた後は、ほかの4つは押せず、入居調整は押せる', g.nodes['b-tp-cut'].disabled && g.nodes['b-res-cut'].disabled && g.nodes['b-stf-cut'].disabled && g.nodes['b-live-weight'].disabled && !g.nodes['b-adm-cut'].disabled);
  }
  {
    const g = glue({ rpc: OKRPC, from: { audit_log: { data: null, error: { code: '42501' } } } });
    await g.ctx.loadGate(g.sb);
    t('操作の記録を読めない時は押せない', g.nodes['b-tp-cut'].disabled);
  }

  console.log('F2 押した時の確かめが5つの操作の入口にある');
  {
    const at = (name, needle) => { const b = fn(name); const i = b.indexOf(needle), j = b.indexOf('confirm('); return i > 0 && j > i; };
    t('入居者マスタ（runResOp）', at('runResOp', "gatePass('res')"));
    t('計画書（runTpOp）', at('runTpOp', "gatePass('tp')"));
    t('入居調整（runAdmOp）', at('runAdmOp', "gatePass('adm')"));
    t('職員マスタ（runStfOp）', at('runStfOp', "gatePass('stf')"));
    t('体重（setWeightMode・本番にする時だけ）', at('setWeightMode', "mode === 'live' && !(await gatePass('weight'))"));
    t('備品・シフト分析には付けない（依頼の外）', fn('runSupOp').indexOf('gatePass') < 0 && fn('runSaOp').indexOf('gatePass') < 0);
    t('操作の後は、読み直しが途中で止まっても表とボタンを新しくする（後始末で gateRefresh を別に呼ぶ）', ['runResOp', 'runTpOp', 'runAdmOp', 'runStfOp'].every((n) => /\} catch \(e\) \{[^\n]*\}\n\s*await gateRefresh\(sb\);/.test(fn(n))));
    t('押した時はまずボタンを押せなくしてから読み直す（二度押し防止）', /b\.disabled = true;\s*await gateRefresh/.test(fn('gatePass')));
    t('戻す時は確かめない（切り替える時だけ）', ['runResOp', 'runTpOp', 'runAdmOp', 'runStfOp'].every((n) => { const b = fn(n); return b.indexOf('gatePass') > b.indexOf("if (kind === 'cut') {"); }));
    t('表の置き場所が5つのボタンの前にある', ['res', 'tp', 'adm', 'stf'].every((k) => HTML.indexOf('id="gate-' + k + '"') > 0 && HTML.indexOf('id="gate-' + k + '"') < HTML.indexOf('id="b-' + k + '-cut"'))
      && HTML.indexOf('id="gate-weight"') > 0 && HTML.indexOf('id="gate-weight"') < HTML.indexOf('id="b-live-weight"'));
    t('判定の部品を写しの見比べより先に読み込む', HTML.indexOf('src="su-cutover-gate.js') > 0 && HTML.indexOf('src="su-cutover-gate.js') < HTML.indexOf('src="shadow-check.js'));
    t('CSP の通信先に GitHub の API を足した', /connect-src [^;]*https:\/\/api\.github\.com/.test(HTML));
  }

  console.log('H 小さな穴の直し（統合 0058・2026-11-03）');
  {
    const ctx = { SUCutGate: G, me: null, calls: [] };
    vm.createContext(ctx);
    vm.runInContext(['function dbErrKind() { return "other"; }', 'function notePrep() {}', fn('noteDiff'), fn('weightRefusedToday'),
      'this.noteDiff = noteDiff; this.weightRefusedToday = weightRefusedToday;'].join('\n'), ctx);
    const sb = { rpc: async (n, a) => { ctx.calls.push([n, a]); return { data: { ok: true }, error: null }; } };
    ctx.me = { role: 'office' }; await ctx.noteDiff(sb, 'stf', 0);
    t('事務所のアカウントでは差を残さない（データベースも管理者だけ）', ctx.calls.length === 0);
    ctx.me = null; await ctx.noteDiff(sb, 'stf', 0);
    t('ログインの状態が分からない時も残さない', ctx.calls.length === 0);
    ctx.me = { role: 'admin' }; await ctx.noteDiff(sb, 'stf', 0);
    t('管理者なら種類と件数だけを残す', ctx.calls.length === 1 && JSON.stringify(ctx.calls[0]) === '["shadow_diff_note",{"p_kind":"stf","p_diffs":0}]', ctx.calls);
    const W = ctx.weightRefusedToday;
    const runs = [{ at: '2026-11-03T05:00:00Z', refused: null }, { at: '2026-11-03T02:00:00Z', refused: 'shrink' }, { at: '2026-11-02T14:00:00Z', refused: 'stale' }];
    t('体重: 最後の写しを受け付けても、今日の先の写しで断っていれば差に数える', W(runs, TODAY) === 1);
    t('体重: 昨日（日本時間）の断りは数えない', W([{ at: '2026-11-02T14:59:00Z', refused: 'stale' }], TODAY) === 0);
    t('体重: 全部受け付けていれば0件', W([{ at: '2026-11-03T05:00:00Z', refused: null }], TODAY) === 0 && W(null, TODAY) === 0);
    t('体重: 今日の写しを全部読んでから残す（最後の1回だけで決めない）', /weight_sync_runs'\)\.select\('at,refused'\)\.gte\('at'/.test(SRC) && /noteDiff\(sb, 'weight', weightRefusedToday\(/.test(SRC));
  }

  console.log('G 差の記録（写しの部品・統合 0055）');
  for (const [file, globalName, kind] of [['su-adm-full.js', 'SUAdmFull', 'adm'], ['su-tp-full.js', 'SUTpFull', 'tp'], ['su-res-full.js', 'SUResFull', 'res']]) {
    const S = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const i = S.indexOf('async function noteDiff(io, n)');
    t(file + ': 差の件数を shadow_diff_note（種類 ' + kind + '）へ残す', i > 0 && S.indexOf("p_kind: '" + kind + "'", i) > i && S.indexOf("p_kind: '" + kind + "'", i) < i + 200);
    t(file + ': 写しの結果を返す前に残す', /await noteDiff\(io, /.test(S) && S.indexOf('await noteDiff(io, ') > S.indexOf('async function run(io)'));
  }
  {
    // 入居調整の写しを本物で動かす: 一致なら0件・違いがあれば件数を残し、残すのに失敗しても結果は返す
    const S = fs.readFileSync(path.join(ROOT, 'su-adm-full.js'), 'utf8');
    const ctx = { window: {}, TextEncoder, Promise, JSON, Object, Array, String, Number, Math, Error, Date, setTimeout };
    vm.createContext(ctx); vm.runInContext(S, ctx);
    const R = ctx.window.SUAdmFull;
    const LEDGER = { v: 1, updatedAt: '2026-10-01T00:00:00.000Z', candidates: [{ id: 'c1' }] };
    const run = async (mangle, noteFails) => {
      const notes = []; let db = null;
      const res = await R.run({
        gas: async () => ({ ok: true, rev: 5, data: JSON.parse(JSON.stringify(LEDGER)), updatedAt: '2026-10-01T09:00:00.000Z' }),
        rpc: async (name, args) => {
          if (name === 'adm_import') { db = { rev: args.p_rev, data: args.p_data, updatedAt: args.p_updated }; return { data: { ok: true, result: 'inserted' }, error: null }; }
          if (name === 'adm_get') return { data: Object.assign({ ok: true }, mangle ? mangle(db) : db), error: null };
          if (name === 'shadow_diff_note') { notes.push(args); if (noteFails) throw new Error('net'); return { data: { ok: true }, error: null }; }
          return { data: null, error: { code: 'PGRST202' } };
        }
      });
      return { res, notes };
    };
    const a = await run();
    t('一致: 差0件を1回残す', a.res.ok && a.res.diff.length === 0 && a.notes.length === 1 && a.notes[0].p_kind === 'adm' && a.notes[0].p_diffs === 0, a);
    const b = await run((db) => Object.assign({}, db, { rev: 4 }));
    t('違い: 違いの数を残す', b.res.ok && b.res.diff.length > 0 && b.notes.length === 1 && b.notes[0].p_diffs === b.res.diff.length, b);
    const c = await run(null, true);
    t('残すのに失敗しても写しの結果は返す', c.res.ok && c.res.diff.length === 0);
  }

  console.log('\n合格 ' + pass + ' / 不合格 ' + fail);
  process.exitCode = fail ? 1 : 0;
})();
