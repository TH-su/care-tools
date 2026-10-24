/* su-perf.js の「見えている時／裏にある時」と GAS の種類の数え方の試験（2026-10-24・段0 速さの記録を測れる形にする）。
   実物の su-perf.js・su-data-gas.js を vm で動かし、架空の URL・架空の印だけを流す。

   守りたいこと:
   1. 純関数（印 PERF_PURE_BEGIN〜END の間）
      - 裏の時間帯の判定: 始まりは含み・終わりは含まない。終わりが無い＝今も裏。数でない時刻は「見えている時」
      - GET の action の取り出し: クエリの action の値だけ。英数字と _ の24字まで、合わなければ「その他」。action が無ければ null
      - 印の名前の取り出し: 'su:gas:<action>' だけ。ほかの印は null
      - 種類の一覧は上限を超えた新しい名前を「その他」にまとめる
   2. 記録（vm で起動 → visibilitychange を手で起こす）
      - 分類（GAS・Supabase・JSON・CDN 等）ごとに、見えている時／裏にある時の回数と ms を画面を閉じるまで数える
      - 開いた時に裏なら 0 から裏とみなす
      - JSON はファイル名ごと、GAS は種類ごと（GET はクエリの action・POST は印）に見えている時／裏にある時を数える
      - URL の全体・action 以外のクエリ・合言葉を残さない。裏にあった時間帯そのものも残さない
      - 起動20秒の明細の形（{s,d,ep} 等）は変えない。二重に数えない。__proto__ の名前でも壊れない
      - 印は前回読んだ件数から先だけを数える。同じ名前・同じ時刻の印2つ（同時に出した同じ action の POST）は2回、
        同じ印を2回読んでも1回（2026-10-24 審査の指摘。名前＋時刻で二重を防いでいた時は2本目を捨てていた）
      - 裏で数えた時は早めに保存する（1.5秒まとめ）
   3. su-data-gas.js の印
      - POST の直前に 'su:gas:<action>' の印を付ける（action が正規表現に合う時だけ）
      - 送る URL・メソッド・ヘッダー・本文・redirect は今までと1バイトも違わない。印が付けられない端末でも送る
   実行: node check/unit/su_perf_visibility_test.js
   （直す前の su-perf.js で試す時: SU_PERF_JS=<ファイル> node check/unit/su_perf_visibility_test.js） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.SU_PERF_JS || path.join(ROOT, 'su-perf.js'), 'utf8');
const SRC_GAS = fs.readFileSync(path.join(ROOT, 'su-data-gas.js'), 'utf8');
const ORIGIN = 'https://tools.example.test';
const GAS = 'https://script.google.com/macros/s/AKfyTESTdeploy1234/exec';

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}

/* ── 1. 純関数を印の間から取り出す ── */
const B = SRC.indexOf('/* PERF_PURE_BEGIN'), E = SRC.indexOf('/* PERF_PURE_END */');
if (B < 0 || E < 0) { console.log('PERF_PURE の印が見つからない'); process.exit(1); }
const pure = {};
vm.createContext(pure);
vm.runInContext(SRC.slice(B, E) + '\nthis.F = { visTotal, inHidden, actName, gasActionFromUrl, gasActionFromMark, bumpKind };', pure);
const F = pure.F;

/* ── 2. su-perf.js を起動する道具 ── */
function boot(opts) {
  opts = opts || {};
  const saved = [], timers = [], winL = {}, docL = {}, obs = {};
  const res = [], marks = [];
  let now = 0;
  const doc = {
    readyState: 'loading',
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    addEventListener(type, fn) { (docL[type] = docL[type] || []).push(fn); }
  };
  const store = { put(copy) { saved.push(copy); }, count() { return {}; } };
  const db = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }) };
  function FakePO(cb) { this.cb = cb; }
  FakePO.prototype.observe = function (o) { obs[o.type] = this.cb; };
  FakePO.supportedEntryTypes = ['resource', 'mark'];
  const ctx = {
    localStorage: { getItem: () => null },
    performance: {
      now: () => now,
      getEntriesByType: (type) => type === 'resource' ? res : (type === 'mark' ? marks : [])
    },
    indexedDB: {
      open() {
        const req = { result: db };
        Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess(); });
        return req;
      }
    },
    location: { origin: ORIGIN, pathname: '/visit-overview.html' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 },
    document: doc,
    addEventListener(type, fn) { winL[type] = fn; },
    setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {},
    URL
  };
  if (opts.observer) ctx.PerformanceObserver = FakePO;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'su-perf.js' });
  return {
    ctx, timers,
    at(ms) { now = ms; },
    res(url, startTime, duration) { res.push({ name: url, startTime, duration, initiatorType: 'fetch', transferSize: 0 }); },
    mark(name, startTime) { marks.push({ name, startTime, entryType: 'mark' }); },
    /* ブラウザと同じく、届いた印は先に一覧（getEntriesByType）へ入ってから見張りへ知らされる */
    emit(type, entries) { if (type === 'mark') entries.forEach((e) => marks.push(e)); if (obs[type]) obs[type]({ getEntries: () => entries }); },
    vis(state) { doc.visibilityState = state; (docL.visibilitychange || []).forEach((fn) => fn()); },
    save: async () => { winL.pagehide(); await new Promise((r) => setImmediate(r)); return JSON.parse(JSON.stringify(saved[saved.length - 1])); }
  };
}
const kind = (list, key, name) => (list || []).find((k) => k[key] === name) || null;

(async () => {
  console.log('\n— 1. 純関数 —');
  const spans = [[100, 200], [500, null]];
  t('裏の時間帯: 始まりは含む・終わりは含まない',
    F.inHidden(spans, 100) && F.inHidden(spans, 199.9) && !F.inHidden(spans, 200) && !F.inHidden(spans, 99.9),
    [F.inHidden(spans, 100), F.inHidden(spans, 199.9), F.inHidden(spans, 200), F.inHidden(spans, 99.9)]);
  t('裏の時間帯: 終わりが無い＝今も裏', F.inHidden(spans, 500) && F.inHidden(spans, 1e9) && !F.inHidden(spans, 499), null);
  t('裏の時間帯: 区間が無い・数でない時刻は「見えている時」',
    !F.inHidden([], 10) && !F.inHidden(spans, NaN) && !F.inHidden(spans, undefined) && !F.inHidden(spans, '150'), null);

  t('GET: クエリの action の値だけを取る（前後のクエリは読まない）',
    F.gasActionFromUrl(GAS + '?action=getAll&token=SECRET1') === 'getAll' &&
    F.gasActionFromUrl(GAS + '?token=SECRET2&action=stateRev') === 'stateRev' &&
    F.gasActionFromUrl(GAS + '?action=ping#x') === 'ping',
    [F.gasActionFromUrl(GAS + '?action=getAll&token=SECRET1'), F.gasActionFromUrl(GAS + '?token=SECRET2&action=stateRev')]);
  t('GET: action が無い（POST・別の名前・# の後）なら null',
    F.gasActionFromUrl(GAS) === null && F.gasActionFromUrl(GAS + '?actions=x&xaction=y') === null &&
    F.gasActionFromUrl(GAS + '#?action=get') === null && F.gasActionFromUrl(GAS + '?') === null, null);
  t('GET: 決まりに合わない値は「その他」（空・記号・25字以上・壊れた %）',
    ['?action=', '?action', '?action=a-b', '?action=a%2Fb', '?action=' + 'a'.repeat(25), '?action=%E0%A4%A', '?action=%3Cscript%3E']
      .every((q) => F.gasActionFromUrl(GAS + q) === 'その他'),
    ['?action=', '?action=a-b', '?action=%E0%A4%A'].map((q) => F.gasActionFromUrl(GAS + q)));
  t('GET: 24字ちょうど・英数字と _ は残す',
    F.gasActionFromUrl(GAS + '?action=' + 'A_9'.repeat(8)) === 'A_9'.repeat(8) && F.gasActionFromUrl(GAS + '?action=get%5Fx') === 'get_x', null);

  t('印: su:gas: の後ろを種類にする', F.gasActionFromMark('su:gas:getRoster') === 'getRoster' && F.gasActionFromMark('su:gas:list') === 'list', null);
  t('印: 合わない名前は「その他」・ほかの印は null',
    F.gasActionFromMark('su:gas:') === 'その他' && F.gasActionFromMark('su:gas:a b') === 'その他' &&
    F.gasActionFromMark('other:mark') === null && F.gasActionFromMark('xsu:gas:get') === null && F.gasActionFromMark(null) === null, null);
  t('種類の名前の決まり（actName）', F.actName('getRoster') === 'getRoster' && F.actName(undefined) === 'その他' && F.actName(12) === 'その他', null);

  const lst = [];
  for (let i = 0; i < 35; i++) F.bumpKind(lst, 'a', 'k' + i, i % 2 === 1, 30);
  F.bumpKind(lst, 'a', 'k0', true, 30);
  const other = lst.find((k) => k.a === 'その他');
  t('種類の一覧は30まで。31個目からは「その他」へまとめる（見えている時／裏にある時も分ける）',
    lst.length === 31 && other && other.v + other.h === 5 && other.h === 2 && other.v === 3, { n: lst.length, other });
  t('同じ名前は1行にまとめて数える', lst[0].a === 'k0' && lst[0].v === 1 && lst[0].h === 1, lst[0]);
  t('一覧の1行は {a, v, h} だけ', lst.every((k) => Object.keys(k).sort().join() === 'a,h,v'), lst[0]);

  console.log('\n— 2. 記録（開いた時は見えている） —');
  const P = boot();
  P.res(GAS + '?action=getAll&token=SECRET1', 100, 300);           /* 見えている時の GET */
  P.mark('su:gas:getRoster', 150);                                 /* 見えている時の POST の印 */
  P.res(GAS, 150, 280);                                            /* その POST の通信（クエリ無し＝種類は印で数える） */
  P.res(ORIGIN + '/su-backend.json?t=1', 120, 20);
  P.res('https://abcdefgh.supabase.co/rest/v1/rpc/kv_get?apikey=SECRET4', 130, 50);
  P.res('https://cdn.example.test/lib.js', 140, 10);
  P.mark('other:mark', 160);                                       /* ほかの印は数えない */
  P.at(1000); P.vis('hidden');                                     /* ここから裏 */
  P.res(GAS + '?action=ping', 1000, 40);                           /* 境目ちょうど＝裏 */
  P.res(GAS, 1500, 400);                                           /* 裏の POST */
  P.mark('su:gas:getRoster', 1500);
  P.mark('su:gas:stateRev', 1600);
  P.res(ORIGIN + '/su-backend.json?t=2', 1550, 25);
  P.res(GAS + '?token=SECRET3&action=bad-name!', 1700, 60);        /* 決まりに合わない＝その他 */
  P.res('https://abcdefgh.supabase.co/rest/v1/rpc/kv_head', 1800, 60);
  P.at(3000); P.vis('visible');                                    /* ここから見えている */
  P.res('https://abcdefgh.supabase.co/rest/v1/rpc/kv_get', 3000, 70);   /* 境目ちょうど＝見えている */
  P.res(ORIGIN + '/su-backend.json?t=3', 3500, 30);
  P.res(ORIGIN + '/data/facility-profile.json', 3600, 15);
  P.res(ORIGIN + '/su-backend.json?t=4', 25000, 35);               /* 起動20秒より後も合計には数える */
  P.at(26000);
  const r1 = await P.save();
  t('記録の版 v は 3', r1.v === 3, r1.v);
  t('GAS: 見えている時2回（GET と POST）・裏3回（境目ちょうどの ping・POST・その他）、ms も分ける',
    r1.vis.gas.vN === 2 && r1.vis.gas.vMs === 300 + 280 && r1.vis.gas.hN === 3 && r1.vis.gas.hMs === 40 + 400 + 60, r1.vis.gas);
  t('Supabase: 見えている時2回（境目ちょうどの復帰を含む）・裏1回',
    r1.vis.sb.vN === 2 && r1.vis.sb.vMs === 120 && r1.vis.sb.hN === 1 && r1.vis.sb.hMs === 60, r1.vis.sb);
  t('JSON: 見えている時4回（20秒より後も含む）・裏1回',
    r1.vis.json.vN === 4 && r1.vis.json.vMs === 20 + 30 + 15 + 35 && r1.vis.json.hN === 1 && r1.vis.json.hMs === 25, r1.vis.json);
  t('CDN 等: 見えている時1回・裏0回', r1.vis.ext.vN === 1 && r1.vis.ext.hN === 0 && r1.vis.ext.vMs === 10, r1.vis.ext);
  t('見えている時＋裏＝今までの合計（gasN・sbN・jsonN）',
    r1.vis.gas.vN + r1.vis.gas.hN === r1.gasN && r1.vis.sb.vN + r1.vis.sb.hN === r1.sbN && r1.vis.json.vN + r1.vis.json.hN === r1.jsonN &&
    r1.vis.gas.vMs + r1.vis.gas.hMs === r1.gasMs, [r1.gasN, r1.sbN, r1.jsonN, r1.gasMs]);
  const ga = r1.gasAct;
  t('GAS の種類: getAll（GET）は見えている時1回', JSON.stringify(kind(ga, 'a', 'getAll')) === '{"v":1,"h":0,"a":"getAll"}', kind(ga, 'a', 'getAll'));
  t('GAS の種類: getRoster（印）は見えている時1回・裏1回', JSON.stringify(kind(ga, 'a', 'getRoster')) === '{"v":1,"h":1,"a":"getRoster"}', kind(ga, 'a', 'getRoster'));
  t('GAS の種類: stateRev（印）・ping（GET・境目）は裏1回',
    kind(ga, 'a', 'stateRev').h === 1 && kind(ga, 'a', 'stateRev').v === 0 && kind(ga, 'a', 'ping').h === 1, [kind(ga, 'a', 'stateRev'), kind(ga, 'a', 'ping')]);
  t('GAS の種類: 決まりに合わない GET は「その他」で裏1回', JSON.stringify(kind(ga, 'a', 'その他')) === '{"v":0,"h":1,"a":"その他"}', kind(ga, 'a', 'その他'));
  t('GAS の種類: クエリの無い POST の通信そのものは種類に数えない（印だけ）・ほかの印も数えない',
    ga.length === 5 && ga.reduce((s, k) => s + k.v + k.h, 0) === 6, ga);
  t('JSON のファイル: su-backend.json は見えている時3回・裏1回',
    JSON.stringify(kind(r1.jsonF, 'f', 'su-backend.json')) === '{"v":3,"h":1,"f":"su-backend.json"}', r1.jsonF);
  t('JSON のファイル: facility-profile.json は見えている時1回（フォルダは残さない）',
    JSON.stringify(kind(r1.jsonF, 'f', 'facility-profile.json')) === '{"v":1,"h":0,"f":"facility-profile.json"}' && r1.jsonF.length === 2, r1.jsonF);
  t('起動20秒の明細の形は今までどおり（{s,d,ep}・{s,d,f}）',
    r1.gas.every((x) => Object.keys(x).join() === 's,d,ep') && r1.sb.every((x) => Object.keys(x).join() === 's,d,ep') &&
    r1.json.every((x) => Object.keys(x).join() === 's,d,f') && r1.json.length === 4 && r1.gas.length === 5, [r1.gas.length, r1.json.length]);
  t('今までの項目はそのまま残る（gasN・sbN・jsonN・gas・sb・json・ext・netDone）',
    ['gasN', 'gasMs', 'gas', 'sbN', 'sbMs', 'sb', 'jsonN', 'jsonMs', 'json', 'ext', 'netDone', 'gasDone', 'ready', 'tbt', 'app', 'dev', 'role'].every((k) => k in r1), Object.keys(r1));
  t('足した項目は vis・gasAct・jsonF の3つだけ（裏にあった時間帯そのものは残さない）',
    Object.keys(r1).filter((k) => ['vis', 'gasAct', 'jsonF'].indexOf(k) >= 0).length === 3 &&
    !Object.keys(r1).some((k) => /span|hidden/i.test(k)), Object.keys(r1));
  const txt = JSON.stringify(r1);
  t('記録に合言葉・action 以外のクエリ・URL の全体が無い',
    !/SECRET|token|apikey|bad-name|\?|script\.google|AKfyTEST|abcdefgh|https?:/.test(txt), txt.match(/SECRET|token|apikey|bad-name|\?|script\.google|AKfyTEST|abcdefgh|https?:/g));
  const r2 = await P.save();
  t('もう一度保存しても数は増えない（通信も印も二重に数えない）',
    JSON.stringify(r2.vis) === JSON.stringify(r1.vis) && JSON.stringify(r2.gasAct) === JSON.stringify(r1.gasAct) &&
    JSON.stringify(r2.jsonF) === JSON.stringify(r1.jsonF), [r2.vis.gas, r2.gasAct]);

  console.log('\n— 2b. 同時に出した同じ印 —');
  const D = boot();
  D.mark('su:gas:get', 100);
  D.mark('su:gas:getRoster', 100);
  D.mark('su:gas:get', 100);                                       /* 同じ action の POST を同時に2本（同じ時刻） */
  const d1 = await D.save();
  t('同じ名前・同じ時刻の印2つは2回と数える', kind(d1.gasAct, 'a', 'get') && kind(d1.gasAct, 'a', 'get').v === 2 && kind(d1.gasAct, 'a', 'getRoster').v === 1, d1.gasAct);
  const d2 = await D.save();
  t('同じ印を2回読んでも1回（保存を2回しても増えない）', kind(d2.gasAct, 'a', 'get').v === 2 && kind(d2.gasAct, 'a', 'getRoster').v === 1, d2.gasAct);
  D.mark('su:gas:get', 100);
  const d3 = await D.save();
  t('後から足された印だけを数える（前回読んだ件数から先・時刻が同じでも数える）', kind(d3.gasAct, 'a', 'get').v === 3 && kind(d3.gasAct, 'a', 'getRoster').v === 1, d3.gasAct);

  console.log('\n— 3. 開いた時に裏・__proto__・上限 —');
  const H = boot({ hidden: true });
  H.res(GAS + '?action=getAll', 10, 100);
  H.res(ORIGIN + '/su-backend.json', 5, 10);
  H.at(500); H.vis('visible');
  H.res(GAS + '?action=getAll', 600, 100);
  H.at(700); H.vis('hidden');
  H.at(900); H.vis('hidden');                                    /* 同じ状態の知らせが2回来ても区間を重ねない */
  H.res(ORIGIN + '/su-backend.json', 950, 10);
  const h1 = await H.save();
  t('開いた時に裏なら 0 から裏（起動直後の通信は裏）',
    h1.vis.gas.hN === 1 && h1.vis.gas.vN === 1 && kind(h1.gasAct, 'a', 'getAll').h === 1 && kind(h1.gasAct, 'a', 'getAll').v === 1, [h1.vis.gas, h1.gasAct]);
  t('もう一度裏になった後の通信は裏', h1.vis.json.hN === 2 && h1.vis.json.vN === 0, h1.vis.json);

  const X = boot();
  X.mark('su:gas:__proto__', 10);
  X.mark('su:gas:constructor', 11);
  X.mark('su:gas:hasOwnProperty', 12);
  for (let i = 0; i < 40; i++) X.mark('su:gas:k' + i, 100 + i);
  const x1 = await X.save();
  t('__proto__ などの名前でも1行として数え、入れ物を壊さない',
    kind(x1.gasAct, 'a', '__proto__') && kind(x1.gasAct, 'a', '__proto__').v === 1 && kind(x1.gasAct, 'a', 'constructor').v === 1 &&
    vm.runInContext('({}).v === undefined && ({}).h === undefined', X.ctx), x1.gasAct.slice(0, 3));
  t('種類は30まで＋「その他」（43種類のうち13種類をまとめる）',
    x1.gasAct.length === 31 && kind(x1.gasAct, 'a', 'その他').v === 13, x1.gasAct.length);

  console.log('\n— 4. 届いた時点で拾う・裏で数えたら早めに保存 —');
  const O = boot({ observer: true });
  O.at(30000);
  const before = O.timers.length;
  O.emit('resource', [{ name: GAS + '?action=getAll', startTime: 29000, duration: 100, initiatorType: 'fetch' }]);
  t('見えている時・起動20秒より後の通信では保存を急がない（今までどおり）', O.timers.length === before, O.timers.slice(before));
  O.at(31000); O.vis('hidden');
  const mid = O.timers.length;
  O.emit('resource', [{ name: GAS, startTime: 32000, duration: 100, initiatorType: 'fetch' }]);
  O.emit('mark', [{ name: 'su:gas:stateRev', startTime: 32000 }]);
  t('裏で数えたら1.5秒まとめの保存を予約する', O.timers.slice(mid).filter((ms) => ms === 1500).length === 2, O.timers.slice(mid));
  const o1 = await O.save();
  t('届いた時点で拾った分も、保存の時の拾い直しで二重にならない（GAS 見えている時1・裏1、stateRev 裏1）',
    o1.vis.gas.vN === 1 && o1.vis.gas.hN === 1 && kind(o1.gasAct, 'a', 'stateRev').h === 1 && kind(o1.gasAct, 'a', 'getAll').v === 1, [o1.vis.gas, o1.gasAct]);
  O.emit('mark', [{ name: 'su:gas:stateRev', startTime: 32000 }]);   /* 同じ action・同じ時刻の印がもう1本 */
  const o2 = await O.save();
  const o3 = await O.save();
  t('見張りに届いた印も数えるのは保存の時の1回だけ（同じ時刻の2本目は2回目・読み直しでは増えない）',
    kind(o2.gasAct, 'a', 'stateRev').h === 2 && kind(o3.gasAct, 'a', 'stateRev').h === 2, [kind(o2.gasAct, 'a', 'stateRev'), kind(o3.gasAct, 'a', 'stateRev')]);

  console.log('\n— 5. su-data-gas.js の印と送る形 —');
  function gasBoot(perf) {
    const calls = [], reg = {};
    const ctx = {
      SU: { data: { register(name, drv) { reg[name] = drv; } } },
      fetch(url, init) { calls.push({ url, init }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
      localStorage: { getItem: () => null }, navigator: {}
    };
    if (perf !== undefined) ctx.performance = perf;
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_GAS, ctx, { filename: 'su-data-gas.js' });
    return { calls, gas: reg.gas };
  }
  const T = { endpoint: GAS, token: 'TESTTOKEN' };
  const want = (body) => JSON.stringify({ url: GAS, init: { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' } });
  const marks = [];
  const G = gasBoot({ mark(n) { marks.push(n); } });
  await G.gas.kvGet('k1', T);
  await G.gas.kvPut('k2', { a: 1 }, 7, T);
  await G.gas.listResidents(T, { scope: 'safe' });
  await G.gas.kvRaw({ action: 'bad-name' }, T);
  await G.gas.kvRaw({ key: 'x' }, T);
  await G.gas.kvRaw({ action: 12 }, T);
  await G.gas.kvRaw({ action: 'a'.repeat(25) }, T);
  t('印は action が決まりに合う時だけ（get・put・getRoster）', JSON.stringify(marks) === '["su:gas:get","su:gas:put","su:gas:getRoster"]', marks);
  const sent = G.calls.map((c) => JSON.stringify(c));
  t('送る形は今までどおり（URL・POST・text/plain・本文・redirect の並びまで同じ）',
    sent[0] === want('{"action":"get","key":"k1","token":"TESTTOKEN"}') &&
    sent[1] === want('{"action":"put","key":"k2","data":{"a":1},"rev":7,"token":"TESTTOKEN"}') &&
    sent[2] === want('{"action":"getRoster","token":"TESTTOKEN"}') &&
    sent[3] === want('{"action":"bad-name","token":"TESTTOKEN"}') &&
    sent[4] === want('{"key":"x","token":"TESTTOKEN"}'), sent.slice(0, 2));
  const G2 = gasBoot({ mark() { throw new Error('mark できない端末'); } });
  await G2.gas.kvGet('k1', T);
  const G3 = gasBoot(undefined);
  await G3.gas.kvGet('k1', T);
  t('印が付けられない端末（mark が失敗・performance が無い）でも同じ形で送る',
    G2.calls.length === 1 && JSON.stringify(G2.calls[0]) === want('{"action":"get","key":"k1","token":"TESTTOKEN"}') &&
    G3.calls.length === 1 && JSON.stringify(G3.calls[0]) === want('{"action":"get","key":"k1","token":"TESTTOKEN"}'), [G2.calls.length, G3.calls.length]);
  const G4 = gasBoot({ mark(n) { marks.push(n); } });
  let rejected = false;
  await G4.gas.kvGet('k1', { endpoint: '' }).catch(() => { rejected = true; });
  t('同期先が無い時は送らず、印も付けない', rejected && G4.calls.length === 0 && marks.length === 3, [rejected, G4.calls.length, marks.length]);

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験が途中で止まった: ' + (e && e.stack || e)); process.exit(1); });
