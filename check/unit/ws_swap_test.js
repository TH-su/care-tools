/* ワークスケジュールの id・3者マージ・入れ替えの純関数を、架空データで大量に確かめる（2026-10-14 新設）。
   対象（公開中の work-schedule.html の本物の関数）:
     stableId            … 種から決まる id。同じ版から同じ操作をした2台が同じ id を作る（統合で二重にならない）
     rebaseDay           … 祖先・端末・サーバーの3者マージ（札は id 単位・印は欄ごと・確定の版はサーバー優先）
     classifySwapPos_    … 入替の新位置の重なりを「縮められる施設業務／自由枠」と「不可」に分ける
     planTraySwap        … トレイの支援を配置済みの支援と入れ替える計画
     swapTargetGroup     … まとめての入れ替えの相手（グループを途中で切らない）
     normalizeGroupSpan  … 2列にまたがったグループを1列へ整える（並び順に依らず同じ結果）
     stabilizeFillerIds_ … 作り直した施設業務の id を決まった値にする（2台で同じ id になる）
   やり方: work-schedule.html から部品（WSTime・WSModel・WSStore）の即時関数をそのまま切り出し、vm で動かす。
     外へ出していない関数（classifySwapPos_・stabilizeFillerIds_）は、部品の最後で api.__t に載せて取り出す。
     データは種を固定した擬似乱数で作る架空のもの（職員・利用者は「見本」）。どの件で落ちたかは種と番号で出す。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'work-schedule.html'), 'utf8');

let pass = 0, fail = 0, cases = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
/* n 件の架空データで同じ約束を確かめ、1行にまとめて出す。落ちた件は最初の3件まで中身を出す */
function many(name, n, fn) {
  const bad = [];
  for (let i = 0; i < n; i++) {
    let r;
    try { r = fn(i); } catch (e) { r = '例外: ' + e.message; }
    if (r !== true) bad.push({ i, why: r });
  }
  cases += n;
  t(name + '（' + n + '件）', bad.length === 0, bad.slice(0, 3));
}
const clone = o => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* 種を固定した擬似乱数（mulberry32） */
function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.shuffle = arr => { const o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
  return f;
}

/* ══ 砂場: work-schedule.html の部品をそのまま動かす ══ */
const EXPORT_LINE = "  if (typeof module !== 'undefined' && module.exports) module.exports = api;";
function moduleSrc(marker, expose) {
  const m = SRC.indexOf(marker);
  if (m < 0) throw new Error('部品が見つかりません: ' + marker);
  const start = SRC.lastIndexOf("(function () {\n  'use strict';", m);
  const end = SRC.indexOf('})();', m) + 5;
  if (start < 0 || end < 5) throw new Error('部品の切れ目が見つかりません: ' + marker);
  const code = SRC.slice(start, end);
  const e = code.lastIndexOf(EXPORT_LINE);
  if (e < 0) throw new Error('部品の出口が見つかりません: ' + marker);
  const inj = '  api.__t = {' + expose.map(n => n + ': (typeof ' + n + " === 'function' ? " + n + ' : undefined)').join(', ') + '};\n';
  return code.slice(0, e) + inj + code.slice(e);
}
const box = { console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN, isFinite, Infinity };
box.window = box;
vm.createContext(box);
vm.runInContext(moduleSrc('window.WSTime = api;', []), box);
vm.runInContext(moduleSrc('window.WSModel = api;', ['classifySwapPos_']), box);
vm.runInContext(moduleSrc('window.WSStore = api;', ['stabilizeFillerIds_']), box);
const M = box.WSModel;
const stableId = M.stableId, rebaseDay = M.rebaseDay, planTraySwap = M.planTraySwap,
      swapTargetGroup = M.swapTargetGroup, normalizeGroupSpan = M.normalizeGroupSpan;
const classifySwapPos_ = M.__t.classifySwapPos_, stabilizeFillerIds_ = box.WSStore.__t.stabilizeFillerIds_;

console.log('\n— 0. 砂場 —');
t('7つの関数を本物のまま取り出せる',
  [stableId, rebaseDay, planTraySwap, swapTargetGroup, normalizeGroupSpan, classifySwapPos_, stabilizeFillerIds_].every(f => typeof f === 'function'));

/* 架空の職員（列 col つき）。時刻は分（0〜1440） */
function mkStaff(n, o) {
  o = o || {};
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 'st' + i, name: '見本 職員' + i, col: i, workStart: o.ws != null ? o.ws : 480, workEnd: o.we != null ? o.we : 1080 });
  return out;
}
const care = (id, staffId, start, end, extra) => Object.assign({ id, kind: 'care', staffId, start, end, residentId: 'r_' + id, residentName: '見本 利用者' + id }, extra || {});
const facAuto = (id, staffId, start, end) => ({ id, kind: 'facility', staffId, start, end, src: 'facwork', label: '施設業務' });

/* ═══════════════ 1. stableId ═══════════════ */
console.log('\n— 1. stableId（種から決まる id）—');
{
  const seeds = [];
  for (let i = 0; i < 300; i++) seeds.push('f' + i + '|st' + (i % 7) + '|' + (480 + i) + '|' + (520 + i) + '|' + (i % 2 ? 'facility' : 'free'));
  many('同じ種からは何度でも同じ id・形は t_d＋英数字', seeds.length, i => {
    const a = stableId(seeds[i]), b = stableId(seeds[i]);
    return (a === b && /^t_d[0-9a-z]+$/.test(a)) || [a, b];
  });
  const ids = new Set(seeds.map(s => stableId(s)));
  cases++;
  t('300種の id はすべて違う（ぶつからない）', ids.size === seeds.length, ids.size);
  many('使われている id とぶつかれば ~1・~2 を足して避ける', 120, i => {
    const base = stableId(seeds[i]);
    const one = stableId(seeds[i], { ['.' + base]: 1 });
    const two = stableId(seeds[i], { ['.' + base]: 1, ['.' + base + '~1']: 1 });
    return (one === base + '~1' && two === base + '~2') || [base, one, two];
  });
  /* id は保存データに残り、版の違う端末どうしでも同じ値でなければならない（違うと統合で二重になる）。
     計算（32bit FNV-1a を種と種の逆順に1本ずつ・36進）を試験の側でも書き、一字一句同じかを見る＝計算を変えたら落ちる */
  const fnv2 = s => {
    let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0;
      h2 ^= s.charCodeAt(s.length - 1 - i); h2 = Math.imul(h2, 16777619) >>> 0;
    }
    return 't_d' + h1.toString(36) + h2.toString(36);
  };
  many('計算の決まり（FNV-1a を2本・36進）どおりの値（版の違う端末でも同じ id）', 150, i => {
    const s = i < 120 ? seeds[i] : '見本 職員' + i + '|施設業務|' + i;
    return stableId(s) === fnv2(s) || [stableId(s), fnv2(s)];
  });
  many('種の1文字違い・並べ替えでも別の id', 120, i => {
    const s = seeds[i], r = s.split('').reverse().join('');
    return (stableId(s) !== stableId(s + 'x') && (s === r || stableId(s) !== stableId(r))) || s;
  });
}

/* ═══════════════ 2. rebaseDay（3者マージ）═══════════════ */
console.log('\n— 2. rebaseDay（祖先・端末・サーバーの3者マージ）—');
/* 祖先の盤面: 職員4人・支援を職員ごとに 40 分刻みで重ならないように並べる（利用者は札ごとに別人＝重複の畳みは起きない） */
function ancestorDay(r) {
  const staff = mkStaff(4), tasks = [];
  let n = 0;
  for (const st of staff) {
    const k = r.int(2, 4);
    for (let j = 0; j < k; j++) { const s = 540 + j * 40; tasks.push(care('c' + (n++), st.id, s, s + 30, { memo: '' })); }
  }
  return { meta: { date: '2026-10-14', rev: 3 }, staff, columns: staff.map(s => s.id), tasks };
}
const CATS = ['keep', 'keep', 'lEdit', 'sEdit', 'both', 'lDel', 'sDel', 'lDelSEdit', 'lEditSDel', 'marks'];
function scenario(seed, serverWins) {
  const r = rng(seed), A = ancestorDay(r);
  const L = clone(A), S = clone(A), plan = {};
  A.tasks.forEach((tk, i) => { plan[tk.id] = i < 2 ? 'keep' : r.pick(CATS); });   /* 先頭2件は必ず残す＝全消失の守りに入らない */
  const edit = (day, id, f) => { const x = day.tasks.find(q => q.id === id); f(x); };
  const del = (day, id) => { day.tasks = day.tasks.filter(q => q.id !== id); };
  for (const id in plan) {
    const c = plan[id];
    if (c === 'lEdit') edit(L, id, x => { x.memo = '端末'; });
    if (c === 'sEdit') edit(S, id, x => { x.memo = 'サーバー'; });
    if (c === 'both') { edit(L, id, x => { x.memo = '端末'; }); edit(S, id, x => { x.memo = 'サーバー'; }); }
    if (c === 'lDel') del(L, id);
    if (c === 'sDel') del(S, id);
    if (c === 'lDelSEdit') { del(L, id); edit(S, id, x => { x.memo = 'サーバー'; }); }
    if (c === 'lEditSDel') { edit(L, id, x => { x.memo = '端末'; }); del(S, id); }
    if (c === 'marks') { edit(L, id, x => { x.done = true; }); edit(S, id, x => { x.comment = { text: '見本のコメント', size: '中' }; }); }
  }
  /* 新しい札: 端末は 15:00、サーバーは 16:40（同じ職員でも重ならない） */
  const lAdd = [], sAdd = [];
  for (let k = 0; k < r.int(0, 2); k++) { const st = 'st' + k; const x = care('L' + seed + '_' + k, st, 900, 930); L.tasks.push(x); lAdd.push(x.id); }
  for (let k = 0; k < r.int(0, 2); k++) { const st = 'st' + (3 - k); const x = care('S' + seed + '_' + k, st, 1000, 1030); S.tasks.push(x); sAdd.push(x.id); }
  const A0 = clone(A), L0 = clone(L), S0 = clone(S);
  const out = rebaseDay(A, L, S, serverWins ? { serverWinsBoard: true } : undefined);
  return { A, L, S, A0, L0, S0, out, plan, lAdd, sAdd };
}
function checkScenario(sc, serverWins) {
  const { out, plan, lAdd, sAdd } = sc;
  if (!same(sc.A, sc.A0) || !same(sc.L, sc.L0) || !same(sc.S, sc.S0)) return '入力を書き換えた';
  const by = {}; for (const x of out.tasks) { if (by[x.id]) return '同じ id が2枚: ' + x.id; by[x.id] = x; }
  for (const id in plan) {
    const c = plan[id], x = by[id];
    const want = {
      keep: ['有', ''], lEdit: ['有', '端末'], sEdit: ['有', 'サーバー'], both: ['有', serverWins ? 'サーバー' : '端末'],
      lDel: ['無'], sDel: ['無'], lDelSEdit: ['有', 'サーバー'], lEditSDel: serverWins ? ['無'] : ['有', '端末'], marks: ['有', '']
    }[c];
    if (want[0] === '無') { if (x) return c + ': 消えるはずの ' + id + ' が残った'; continue; }
    if (!x) return c + ': 残るはずの ' + id + ' が消えた';
    if (x.memo !== want[1]) return c + ': ' + id + ' の memo が ' + x.memo + '（期待 ' + want[1] + '）';
    if (c === 'marks' && !(x.done === true && x.comment && x.comment.text === '見本のコメント')) return 'marks: 端末の実施とサーバーのコメントの両方が残らない ' + JSON.stringify(x);
    const a = sc.A0.tasks.find(q => q.id === id);
    if (x.staffId !== a.staffId || x.start !== a.start || x.end !== a.end) return c + ': ' + id + ' の場所が動いた';
  }
  for (const id of lAdd.concat(sAdd)) if (!by[id]) return '新しい札 ' + id + ' が消えた';
  if (out.tasks.length !== Object.keys(plan).filter(id => by[id]).length + lAdd.length + sAdd.length) return '余分な札がある';
  if (out.dupRemoved !== 0 || out.wipeKept !== 0) return '畳み・全消失の守りが働いた（このデータでは起きないはず）';
  return true;
}
many('ふつうの日: 片方だけの変更は採る・両方の変更は端末・片方の削除は追従・削除×変更は残す・印は欄ごと', 200, i => checkScenario(scenario(1000 + i, false), false));
many('確定の版（serverWinsBoard）: 両方が変えた札と、端末だけが変えてサーバーが消した札はサーバーに従う', 120, i => checkScenario(scenario(5000 + i, true), true));
many('端末とサーバーが同じなら、その盤面がそのまま残る（id・順番・中身）', 120, i => {
  const r = rng(9000 + i), A = ancestorDay(r), X = clone(A);
  X.tasks.forEach((q, j) => { if (j % 3 === 0) q.memo = '見本' + j; });
  const out = rebaseDay(A, X, clone(X));
  return same(out.tasks.map(q => [q.id, q.memo]), X.tasks.map(q => [q.id, q.memo])) || out.tasks.map(q => q.id);
});
many('祖先が無くても札は消えない（両方の札が残る）', 100, i => {
  const r = rng(12000 + i), A = ancestorDay(r), L = clone(A), S = clone(A);
  L.tasks.push(care('Lx' + i, 'st0', 900, 930)); S.tasks.push(care('Sx' + i, 'st1', 1000, 1030));
  const ids = new Set(rebaseDay(null, L, S).tasks.map(q => q.id));
  return (A.tasks.every(q => ids.has(q.id)) && ids.has('Lx' + i) && ids.has('Sx' + i)) || [...ids];
});
{
  /* 全消失の守り: 統合で支援が0件になるのに端末に5件以上ある時は、端末の支援を残す */
  const A = ancestorDay(rng(1)), L = clone(A), S = clone(A);
  S.tasks = [];
  const out = rebaseDay(A, L, S);
  t('全消失の守り: サーバーが全部消しても、端末に5件以上の支援があれば残す', out.wipeKept === L.tasks.length && out.tasks.length === L.tasks.length, [out.wipeKept, out.tasks.length, L.tasks.length]);
}

/* ═══════════════ 3. swapTargetGroup ═══════════════ */
console.log('\n— 3. swapTargetGroup（まとめての入れ替えの相手）—');
function groupBoard(r) {
  const tasks = [], staff = mkStaff(3);
  let n = 0;
  for (const st of staff) {
    const k = r.int(3, 6);
    for (let j = 0; j < k; j++) {
      const s = 540 + j * 30, kind = r() < 0.15 ? 'facility' : 'care';
      const g = r() < 0.6 ? 'g' + st.id + '_' + r.int(0, 1) : null;
      tasks.push(kind === 'care' ? care('t' + (n++), st.id, s, s + 25, { groupId: g }) : { id: 't' + (n++), kind, staffId: st.id, start: s, end: s + 25, groupId: g, src: 'manual', label: '見本の業務' });
    }
  }
  for (let j = 0; j < r.int(0, 2); j++) tasks.push(care('tray' + j, null, 600, 630, { groupId: 'gst0_0' }));
  return { staff, tasks: r.shuffle(tasks) };
}
function oracleGroup(day, anchorId, ex) {
  const a = day.tasks.find(q => q.id === anchorId);
  if (!a || a.staffId == null || a.kind !== 'care' || ex.indexOf(a.id) >= 0) return null;
  if (!a.groupId) return [a.id];
  const mem = day.tasks.filter(q => q.staffId === a.staffId && q.groupId === a.groupId && ex.indexOf(q.id) < 0);
  if (mem.some(q => q.kind !== 'care')) return null;
  return mem.sort((x, y) => (x.start - y.start) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map(q => q.id);
}
many('相手は「同じ職員・同じグループの配置済み支援の全部」を開始順で（業務枠が混ざれば null・単独は自分だけ）', 200, i => {
  const r = rng(20000 + i), day = groupBoard(r), before = clone(day);
  const anchor = r() < 0.9 ? r.pick(day.tasks).id : 'none';
  const ex = r() < 0.3 ? [r.pick(day.tasks).id] : [];
  const got = swapTargetGroup(day, anchor, ex), want = oracleGroup(day, anchor, ex);
  if (!same(day, before)) return '盤面を書き換えた';
  return same(got && got.map(q => q.id), want) || { got: got && got.map(q => q.id), want };
});
t('トレイ（未配置）の札をアンカーにすると null', swapTargetGroup({ tasks: [care('x', null, 600, 630, { groupId: 'g' })] }, 'x') === null);

/* ═══════════════ 4. normalizeGroupSpan ═══════════════ */
console.log('\n— 4. normalizeGroupSpan（2列にまたがったグループを1列へ）—');
function spanBoard(r) {
  const staff = mkStaff(4), tasks = [];
  const gids = ['gA', 'gB', 'gC'];
  for (let n = 0; n < r.int(4, 14); n++) {
    const st = r() < 0.08 ? null : r.pick(staff).id;
    tasks.push(care('n' + n, st, 540 + r.int(0, 20) * 20, 0, { groupId: r() < 0.8 ? r.pick(gids) : null }));
    tasks[tasks.length - 1].end = tasks[tasks.length - 1].start + 20;
  }
  if (r() < 0.2) tasks.push(care('used', 'st0', 1000, 1020, { groupId: 'gA_c1' }));   /* 付け替え先の名前が使われている */
  return { staff, tasks };
}
const colOf = (staff, sid) => { const s = staff.find(x => x.id === sid); return s ? s.col : null; };
many('整えた後は、どのグループも1列だけ・札の数と順番・印以外の中身は変わらない・入力を書き換えない', 200, i => {
  const r = rng(30000 + i), d = spanBoard(r), before = clone(d.tasks);
  const res = normalizeGroupSpan(d.tasks, d.staff, null);
  if (!same(d.tasks, before)) return '入力を書き換えた';
  if (res.tasks.length !== before.length) return '札の数が変わった';
  const cols = {};
  for (let k = 0; k < res.tasks.length; k++) {
    const x = res.tasks[k], y = before[k];
    if (x.id !== y.id) return '順番が変わった';
    const xs = clone(x), ys = clone(y); delete xs.groupId; delete ys.groupId;
    if (!same(xs, ys)) return 'グループの印以外が変わった: ' + x.id;
    if (x.staffId == null) { if (x.groupId !== y.groupId) return 'トレイの札を触った'; continue; }
    if (x.groupId == null) continue;
    (cols[x.groupId] = cols[x.groupId] || new Set()).add(colOf(d.staff, x.staffId));
  }
  for (const g in cols) if (cols[g].size > 1) return 'グループ ' + g + ' がまだ ' + cols[g].size + ' 列にまたがる';
  return true;
});
many('元の印は「件数の多い列（同数なら早い開始・列番号の小さい方）」に残り、他の列は2件以上なら新しい印・1件なら印を外す', 200, i => {
  const r = rng(40000 + i), d = spanBoard(r);
  const res = normalizeGroupSpan(d.tasks, d.staff, null);
  const groups = {};
  d.tasks.forEach(q => { if (q.staffId == null || q.groupId == null) return; const c = colOf(d.staff, q.staffId); const g = groups[q.groupId] = groups[q.groupId] || {}; const e = g[c] = g[c] || { col: c, n: 0, min: Infinity, ids: [] }; e.n++; e.min = Math.min(e.min, q.start); e.ids.push(q.id); });
  const by = {}; res.tasks.forEach(q => { by[q.id] = q; });
  for (const gid in groups) {
    const list = Object.values(groups[gid]);
    if (list.length < 2) { if (list[0].ids.some(id => by[id].groupId !== gid)) return '1列だけのグループ ' + gid + ' を変えた'; continue; }
    list.sort((x, y) => (y.n - x.n) || (x.min - y.min) || (x.col - y.col));
    if (list[0].ids.some(id => by[id].groupId !== gid)) return '元の印が残る列が違う: ' + gid;
    for (const e of list.slice(1)) {
      const ng = e.ids.map(id => by[id].groupId);
      if (e.n === 1) { if (ng[0] !== null) return '1件の列は印を外すはず: ' + gid; }
      else if (!(new Set(ng).size === 1 && String(ng[0]).indexOf(gid + '_c' + e.col) === 0)) return '2件以上の列は ' + gid + '_c' + e.col + ' で始まる新しい印のはず: ' + ng;
    }
  }
  return true;
});
many('2回目は何もしない（同じ配列をそのまま返す）', 150, i => {
  const r = rng(50000 + i), d = spanBoard(r);
  const one = normalizeGroupSpan(d.tasks, d.staff, null), two = normalizeGroupSpan(one.tasks, d.staff, null);
  return (two.changed === false && two.tasks === one.tasks) || '2回目も変えた';
});
many('札の並び順を入れ替えても、どの札にどの印が付くかは同じ（2台が同じ結果に収束）', 150, i => {
  const r = rng(60000 + i), d = spanBoard(r);
  const m1 = {}, m2 = {};
  normalizeGroupSpan(d.tasks, d.staff, null).tasks.forEach(q => { m1[q.id] = q.groupId; });
  normalizeGroupSpan(r.shuffle(d.tasks), d.staff, null).tasks.forEach(q => { m2[q.id] = q.groupId; });
  return same(Object.keys(m1).sort().map(k => m1[k]), Object.keys(m1).sort().map(k => m2[k])) || { m1, m2 };
});
{
  const staff = mkStaff(3);
  const tasks = [care('a1', 'st0', 540, 560, { groupId: 'g' }), care('a2', 'st0', 560, 580, { groupId: 'g' }),
                 care('b1', 'st1', 500, 520, { groupId: 'g' }), care('b2', 'st1', 600, 620, { groupId: 'g' }),
                 care('c1', 'st2', 700, 720, { groupId: 'g' })];
  const res = normalizeGroupSpan(tasks, staff, null), g = {}; res.tasks.forEach(q => { g[q.id] = q.groupId; });
  t('同数の2列は開始の早い列に元の印（列1が 8:20 開始）・列0は g_c0・1件の列2は印なし',
    g.b1 === 'g' && g.b2 === 'g' && g.a1 === 'g_c0' && g.a2 === 'g_c0' && g.c1 === null, g);
}

/* ═══════════════ 5. classifySwapPos_ ═══════════════ */
console.log('\n— 5. classifySwapPos_（入替の新位置の重なりの分類）—');
function posBoard(r) {
  const tasks = [];
  let s = 480, n = 0;
  while (s < 1000) {
    const len = r.pick([20, 30, 40, 60]), kind = r.pick(['care', 'break', 'facAuto', 'facAuto', 'freeAuto', 'freeNamed', 'facNamed', 'facManual']);
    const id = 'p' + (n++);
    if (kind === 'care') tasks.push(care(id, 'st0', s, s + len));
    else if (kind === 'break') tasks.push({ id, kind: 'break', staffId: 'st0', start: s, end: s + len });
    else if (kind === 'facAuto') tasks.push(facAuto(id, 'st0', s, s + len));
    else if (kind === 'freeAuto') tasks.push({ id, kind: 'free', staffId: 'st0', start: s, end: s + len, src: 'facwork', label: '' });
    else if (kind === 'freeNamed') tasks.push({ id, kind: 'free', staffId: 'st0', start: s, end: s + len, src: 'facwork', label: '見本の自由枠' });
    else if (kind === 'facNamed') tasks.push({ id, kind: 'facility', staffId: 'st0', start: s, end: s + len, src: 'manual', label: '2階食事支援' });
    else tasks.push({ id, kind: 'facility', staffId: 'st0', start: s, end: s + len, src: 'manual', label: '施設業務' });
    s += len + r.pick([0, 0, 10]);
  }
  tasks.push(care('other', 'st1', 500, 1000));   /* 別の職員の札は数えない */
  return { tasks, staff: mkStaff(2) };
}
const shrinkable = q => (q.kind === 'facility' || q.kind === 'free') && !(q.kind === 'free' && String(q.label || '').trim()) &&
  (q.src === 'facwork' || (q.kind === 'facility' && q.label === '施設業務'));
many('重なる札が縮められる施設業務・自由枠だけなら null と区間の控え・ほかが混ざれば最初の1枚で staffdup', 250, i => {
  const r = rng(70000 + i), day = posBoard(r), before = clone(day);
  const st0 = r.int(480, 980), pos = { staffId: 'st0', start: st0, end: st0 + r.pick([20, 30, 45, 60, 90]) };
  const ig = r() < 0.3 ? [r.pick(day.tasks).id] : [];
  const fillers = {}, list = [];
  const got = classifySwapPos_(day, pos, { name: '見本 職員0' }, ig, fillers, list);
  if (!same(day, before)) return '盤面を書き換えた';
  const hits = day.tasks.filter(q => q.staffId === 'st0' && ig.indexOf(q.id) < 0 && q.start < pos.end && pos.start < q.end);
  const firstBad = hits.findIndex(q => !shrinkable(q));
  if (firstBad >= 0) {
    return (got && got.ok === false && got.code === 'staffdup' && got.conflicts[0].id === hits[firstBad].id &&
      /見本 職員0さん側で/.test(got.reason) && list.length === hits.slice(0, firstBad).length) || { got, hits: hits.map(q => q.id), firstBad };
  }
  const want = hits.map(q => q.id);
  return (got === null && same(list.map(f => f.fac.id), want) && list.every(f => same(f.ranges, [[pos.start, pos.end]]))) || { got, want, list: list.map(f => f.fac.id) };
});
{
  const day = { tasks: [facAuto('f', 'st0', 540, 660)] }, fillers = {}, list = [];
  classifySwapPos_(day, { staffId: 'st0', start: 540, end: 570 }, { name: '甲' }, [], fillers, list);
  classifySwapPos_(day, { staffId: 'st0', start: 600, end: 630 }, { name: '甲' }, [], fillers, list);
  t('同じ施設業務に2回重なると、控えは1つで区間が2つ積まれる', list.length === 1 && same(list[0].ranges, [[540, 570], [600, 630]]), list.map(f => f.ranges));
}

/* ═══════════════ 6. planTraySwap ═══════════════ */
console.log('\n— 6. planTraySwap（トレイの支援と配置済みの支援の入れ替え）—');
function trayBoard(r) {
  const staff = mkStaff(2, { ws: r.pick([480, 540]), we: r.pick([1020, 1080, 1440]) });
  const tasks = [];
  let s = staff[0].workStart, n = 0;
  while (s < staff[0].workEnd - 20) {
    const len = r.pick([20, 30, 40]), kind = r.pick(['care', 'care', 'care', 'facAuto', 'break']);
    const id = 'q' + (n++);
    if (kind === 'care') tasks.push(care(id, 'st0', s, s + len, { groupId: r() < 0.3 ? 'gb' : null }));
    else if (kind === 'facAuto') tasks.push(facAuto(id, 'st0', s, s + len));
    else tasks.push({ id, kind: 'break', staffId: 'st0', start: s, end: s + len });
    s += len;
  }
  const tray = care('tray', null, 0, r.pick([20, 30, 45, 60, 120]), { groupId: r() < 0.4 ? 'ga' : null });
  if (r() < 0.25) tray.residentId = 'r_dup';
  tasks.push(tray);
  if (r() < 0.25) tasks.push(care('dupR', 'st1', 480, 1440, { residentId: 'r_dup' }));   /* 同じ利用者が別の職員で終日 */
  return { staff, tasks };
}
function oracleTray(day, overId) {
  const a = day.tasks.find(q => q.id === 'tray'), b = day.tasks.find(q => q.id === overId), stB = day.staff.find(s => s.id === b.staffId);
  const nA = { start: b.start, end: b.start + (a.end - a.start) };
  if (b.kind !== 'care') return 'unassigned';
  if (nA.end > 1440) return 'range';
  if (nA.start < stB.workStart || nA.end > stB.workEnd) return 'worktime';
  const hits = day.tasks.filter(q => q.staffId === b.staffId && q.id !== a.id && q.id !== b.id && q.start < nA.end && nA.start < q.end);
  if (hits.some(q => !shrinkable(q))) return 'staffdup';
  if (a.residentId && day.tasks.some(q => q.kind === 'care' && q.residentId === a.residentId && q.staffId != null && q.id !== a.id && q.id !== b.id && q.start < nA.end && nA.start < q.end)) return 'residentdup';
  return { ok: true, splitIds: hits.map(q => q.id) };
}
many('入れ替えてよいか・理由・移動先（相手の職員と開始・自分の長さ・相手の印）・縮める施設業務を、決まりどおりに出す', 250, i => {
  const r = rng(80000 + i), day = trayBoard(r), before = clone(day);
  const over = r.pick(day.tasks.filter(q => q.staffId === 'st0'));
  const got = planTraySwap(day, 'tray', over.id), want = oracleTray(day, over.id);
  if (!same(day, before)) return '盤面を書き換えた';
  if (typeof want === 'string') return (got.ok === false && got.code === want) || { got, want };
  const a = day.tasks.find(q => q.id === 'tray');
  const m = got.moves && got.moves[0];
  return (got.ok === true && got.moves.length === 1 && m.id === 'tray' && m.staffId === 'st0' && m.start === over.start &&
    m.end === over.start + (a.end - a.start) && m.groupId === (over.groupId || null) && got.unassignId === over.id &&
    got.unassignGroupId === (a.groupId || null) && same(got.splits.map(s => s.facId), want.splitIds) &&
    got.splits.every(s => s.fragments.every(f => f[1] - f[0] >= 20))) || { got, want };
});
{
  const day = { staff: mkStaff(1), tasks: [care('a', null, 0, 30), care('b', 'st0', 600, 630), care('c', 'st0', 660, 690), { id: 'k', kind: 'break', staffId: 'st0', start: 700, end: 720 }] };
  t('相手が見つからない → notask', planTraySwap(day, 'a', 'zz').code === 'notask');
  t('同じ札どうし → same', planTraySwap(day, 'a', 'a').code === 'same');
  t('トレイにない支援を落とした → nottray', planTraySwap(day, 'c', 'b').code === 'nottray');
  t('休憩の上へ落とした → unassigned（配置済みの支援とだけ）', planTraySwap(day, 'a', 'k').code === 'unassigned');
  const nc = clone(day); nc.tasks[0].kind = 'free';
  t('落としたのが支援でない → notcare', planTraySwap(nc, 'a', 'b').code === 'notcare');
}

/* ═══════════════ 7. stabilizeFillerIds_ ═══════════════ */
console.log('\n— 7. stabilizeFillerIds_（作り直した施設業務の id を2台でそろえる）—');
let rid = 0;
const randId = () => 't_' + (++rid).toString(36) + '_' + Math.random().toString(36).slice(2, 8);
/* 操作前: 職員3人に自動の施設業務と支援。操作後: いくつかの施設業務が消え、空いた所に新しい（乱数 id の）施設業務ができる */
function fillerCase(r) {
  const before = [], staff = ['st0', 'st1', 'st2'];
  let n = 0;
  for (const st of staff) {
    before.push(care('cc' + st, st, 540, 570));
    for (let j = 0; j < r.int(1, 3); j++) before.push(facAuto('fa' + (n++), st, 600 + j * 60, 640 + j * 60));
  }
  const fac = before.filter(q => q.kind === 'facility');
  const goneIds = new Set(r.shuffle(fac).slice(0, r.int(0, fac.length)).map(q => q.id));
  const keep = before.filter(q => !goneIds.has(q.id));
  const shapes = [];
  for (let k = 0; k < r.int(0, goneIds.size + 1); k++) {
    const st = r.pick(staff), s = 800 + k * 40;
    shapes.push({ kind: r() < 0.85 ? 'facility' : 'free', staffId: st, start: s, end: s + 40, src: 'facwork', label: '施設業務' });
  }
  return { before, keep, shapes };
}
const build = (c) => c.keep.concat(c.shapes.map(s => Object.assign({ id: randId() }, s)));
/* 消えた枠より新しい枠が多い時、組めなかった分は乱数 id のまま（仕様）。どの枠が組めないかは並び（職員・開始・終了・種類）で
   決まり乱数 id に依らない＝2台で「同じ位置の枠が、同じ決まった id」か「両方とも乱数のまま」になる */
const isStable = id => /^t_d[0-9a-z]+(~\d+)?$/.test(id);
many('同じ操作から2台が別々の乱数 id で作り直しても、組めた枠の id は同じ（組めない枠は2台とも乱数のまま）', 200, i => {
  const r = rng(90000 + i), c = fillerCase(r);
  const o1 = stabilizeFillerIds_(c.before, build(c), {}, {}), o2 = stabilizeFillerIds_(c.before, build(c), {}, {});
  const ok = o1.every((q, k) => q.id === o2[k].id || (!isStable(q.id) && !isStable(o2[k].id) && k >= c.keep.length));
  return ok || { o1: o1.map(q => q.id), o2: o2.map(q => q.id) };
});
many('新しい枠が消えた枠の数以下なら、新しい枠はすべて決まった id になる（2台で完全に同じ）', 150, i => {
  const r = rng(93000 + i), c = fillerCase(r);
  const goneN = c.before.length - c.keep.length;
  c.shapes = c.shapes.slice(0, goneN).map(s => Object.assign(s, { kind: 'facility' }));
  const o1 = stabilizeFillerIds_(c.before, build(c), {}, {}), o2 = stabilizeFillerIds_(c.before, build(c), {}, {});
  return (same(o1.map(q => q.id), o2.map(q => q.id)) && o1.slice(c.keep.length).every(q => isStable(q.id))) || { o1: o1.map(q => q.id), o2: o2.map(q => q.id) };
});
many('変えるのは組めた新しい枠の id だけ（残った枠・支援・中身は同じ）・id はぶつからない・入力を書き換えない', 200, i => {
  const r = rng(95000 + i), c = fillerCase(r), after = build(c), a0 = clone(after), b0 = clone(c.before);
  const out = stabilizeFillerIds_(c.before, after, {}, {});
  if (!same(after, a0) || !same(c.before, b0)) return '入力を書き換えた';
  if (out.length !== after.length) return '枠の数が変わった';
  const goneN = c.before.length - c.keep.length, ids = new Set();
  let changed = 0;
  for (let k = 0; k < out.length; k++) {
    const x = out[k], y = after[k];
    if (ids.has(x.id)) return 'id がぶつかった: ' + x.id; ids.add(x.id);
    const xs = clone(x), ys = clone(y); delete xs.id; delete ys.id;
    if (!same(xs, ys)) return 'id 以外が変わった';
    if (k < c.keep.length) { if (x.id !== y.id) return '残った枠の id を変えた: ' + y.id; continue; }
    if (x.id !== y.id) { changed++; if (!/^t_d[0-9a-z]+(~\d+)?$/.test(x.id)) return '決まった id の形でない: ' + x.id; if (c.before.some(q => q.id === x.id)) return '消えた枠の id を使い回した'; }
  }
  const sameKind = c.shapes.length && goneN ? Math.min(c.shapes.filter(s => s.kind === 'facility').length, goneN) : 0;
  if (changed < sameKind) return '組めるはずの枠が組まれていない: ' + changed + ' < ' + sameKind;
  if (changed > Math.min(c.shapes.length, goneN)) return '組める数より多く変えた';
  if (!goneN && out !== after) return '消えた枠が無いのに作り直した（同じ配列を返すはず）';
  return true;
});
{
  const before = [facAuto('fa', 'st0', 600, 700), care('cc', 'st0', 540, 570)];
  const after = [care('cc', 'st0', 540, 570), facAuto('n1', 'st0', 640, 700)];
  const o = stabilizeFillerIds_(before, after, {}, {});
  t('同じ職員の消えた枠と組み、種（消えた枠の id・職員・区間・種類）から id を作る',
    o[1].id === M.stableId('fa|st0|640|700|facility', { '.fa': 1, '.cc': 1, '.n1': 1 }) && o[0] === after[0], o.map(q => q.id));
  /* 消えた枠は開始順で 職員1の 9:00 → 職員0の 10:00。職員をまたいで開始順に組むと、職員0の新しい枠が職員1の枠と組んでしまう */
  const bX = [facAuto('faB', 'st1', 540, 600), facAuto('faA', 'st0', 600, 660)];
  const aX = [facAuto('nA', 'st0', 700, 760), facAuto('nB', 'st1', 700, 760)];
  const oX = stabilizeFillerIds_(bX, aX, {}, {}), takenX = { '.faB': 1, '.faA': 1, '.nA': 1, '.nB': 1 };
  const idA = M.stableId('faA|st0|700|760|facility', takenX); takenX['.' + idA] = 1;
  t('同じ職員の消えた枠を先に組む（開始の早い別の職員の枠より優先）',
    oX[0].id === idA && oX[1].id === M.stableId('faB|st1|700|760|facility', takenX), oX.map(q => q.id));
  const o2 = stabilizeFillerIds_(before, after, { '.n1': 1 }, {});
  t('既に決まった id（decided）の枠は組ませない', o2 === after);
  const manual = [{ id: 'm', kind: 'facility', staffId: 'st0', start: 600, end: 700, src: 'manual', label: '施設業務' }];
  const o3 = stabilizeFillerIds_(manual, [facAuto('n2', 'st0', 600, 640)], {}, {});
  t('手で置いた枠は「消えた枠」に数えない（組まない）', o3[0].id === 'n2');
  const o4 = stabilizeFillerIds_(manual, [{ id: 'n3', kind: 'facility', staffId: 'st0', start: 640, end: 700, src: 'manual', label: '施設業務' }], {}, { '.n3': 1 });
  t('loose の切れ端は、操作前にその区間を覆っていた枠を種にする（手で置いた施設業務も）', o4[0].id === M.stableId('m|st0|640|700|facility', { '.m': 1, '.n3': 1 }) && o4[0].src === 'manual', o4[0]);
}

console.log('\n────────── 架空データ ' + cases + ' 件 ／ 合計: ' + pass + ' 項目成功 / ' + fail + ' 項目失敗 ──────────');
if (cases < 100) { console.log('  ✗ 架空データが100件に足りない'); fail++; }
process.exit(fail ? 1 : 0);
