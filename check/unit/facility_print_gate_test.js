/* 印刷の前に施設情報を待つ（2026-10-14 新設・代表者の依頼）。
   守りたいこと:
     A 入居者マスタ・デイ利用表・フェイスシートの suFacReady_ は一字一句同じ
     B suFacReady_: 読めていればすぐ true／まだなら SUFacility.onReady を最大3秒待つ／読めないと分かればその時点で false／
       su-facility.js が無い・応答しない・例外でも false（止まらない）／結果は1回だけ
     C 入居者マスタの A4様式（a4Print）: 読めなければ「施設情報が読めません」と出して刷らない。読めれば1回だけ刷る
     D デイ利用表の印刷ボタン: 読めなければ刷らずに知らせる。読めたら表題を施設の名前にしてから印刷の画面を開く
     E フェイスシート: 印刷・まとめて印刷・誕生日一覧・食形態一覧の4つのボタンが同じ関門（fsFacGate_）を通る
     F 待つ間の二重押しを無視し、待った後のデイ利用表は本文も描き直す（2026-10-14 監査10月版 第4版 7）
   ★画面の本物の関数を切り出して動かす。偽物にするのは SUFacility・タイマー・印刷・知らせだけ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

/* 文字列・コメント・正規表現の中のかっこを数えない切り出し */
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:!&|?{};\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && n !== '/' && n !== '*') {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) { const d = src[j]; if (d === '\\') { j++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; }
      if (src[j] === '/') { i = j; continue; }
    }
    if (c === '{') { depth++; seen = true; } else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grab(src, header) {
  const s = src.indexOf(header);
  if (s < 0) throw new Error('見つかりません: ' + header);
  return src.slice(s, scanBlock(src, s) + 1);
}
/* 待つ関数とその定数（var SU_FAC_WAIT_MS から suFacReady_ の終わりまで） */
function helperOf(src) {
  const s = src.indexOf('var SU_FAC_WAIT_MS');
  if (s < 0) throw new Error('SU_FAC_WAIT_MS が見つかりません');
  const f = src.indexOf('function suFacReady_(', s);
  return src.slice(s, scanBlock(src, f) + 1);
}
const PAGES = { master: read('resident-master.html'), day: read('daycare-roster.html'), face: read('facesheet.html') };
const H = {}; for (const k in PAGES) H[k] = helperOf(PAGES[k]);

console.log('\n— A. 3つの画面で同じ中身 —');
t('入居者マスタ・デイ利用表・フェイスシートの suFacReady_（定数とも）は一字一句同じ', H.master === H.day && H.day === H.face);
t('待つのは3秒・知らせの文は「施設情報が読めません」で始まる', /var SU_FAC_WAIT_MS = 3000;/.test(H.master) && /SU_FAC_NG_MSG = '⚠️ 施設情報が読めません。/.test(H.master));

/* 偽のタイマー（時計を手で進める）と偽の SUFacility */
function makeBox(fac) {
  const timers = [];
  const box = {
    Promise, console,
    setTimeout: (fn, ms) => { const h = { fn, ms, on: true }; timers.push(h); return h; },
    clearTimeout: h => { if (h) h.on = false; },
    window: {}
  };
  if (fac) box.window.SUFacility = fac;
  vm.createContext(box);
  vm.runInContext(H.master, box);
  box.fire = () => timers.forEach(h => { if (h.on) { h.on = false; h.fn(); } });
  box.timers = timers;
  return box;
}
function fakeFac(o) {
  o = o || {};
  const f = { data: !!o.ready, waiters: [], settled: !!o.settled,
    ready() { if (o.readyThrows) throw new Error('壊れた'); return this.data; },
    onReady(fn) { if (o.onReadyThrows) throw new Error('壊れた'); if (this.settled) fn(); else this.waiters.push(fn); },
    settle(ok) { this.data = ok; this.settled = true; const w = this.waiters; this.waiters = []; w.forEach(fn => fn()); } };
  if (o.noOnReady) delete f.onReady;
  return f;
}

console.log('\n— B. suFacReady_（待ち方）—');
(async () => {
  {
    const b = makeBox(fakeFac({ ready: true })); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    t('読めていればすぐ true（時計を待たない）', r === true && b.timers.length === 0, [r, b.timers.length]);
  }
  {
    const fac = fakeFac(), b = makeBox(fac); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    const waiting = r === undefined && b.timers.length === 1 && b.timers[0].ms === 3000;
    fac.settle(true); await settle();
    t('まだなら3秒の時計をかけて待ち、途中で読めたら true（時計は止める）', waiting && r === true && b.timers[0].on === false, [waiting, r]);
  }
  {
    const fac = fakeFac(), b = makeBox(fac); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    fac.settle(false); await settle();
    t('読めないと分かった時点で false（3秒を待たない）', r === false && b.timers[0].on === false, r);
  }
  {
    const b = makeBox(fakeFac({ settled: true, ready: false })); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    t('もう読めないと決まっている（控えも無く取得も失敗済み）なら、すぐ false', r === false, r);
  }
  {
    const b = makeBox(fakeFac()); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    const before = r;
    b.fire(); await settle();
    t('応答が無ければ3秒で false', before === undefined && r === false, [before, r]);
  }
  {
    const fac = fakeFac(), b = makeBox(fac); const rs = [];
    b.suFacReady_().then(v => rs.push(v)); await settle();
    b.fire(); fac.settle(true); await settle();
    t('時計と onReady の両方が来ても、結果は1回だけ（先に来た時計で false）', rs.length === 1 && rs[0] === false, rs);
  }
  {
    const b = makeBox(null); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    t('su-facility.js が無ければ false', r === false, r);
  }
  {
    const b = makeBox(fakeFac({ readyThrows: true })); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    t('ready() が例外でも止まらず false', r === false, r);
  }
  {
    const b = makeBox(fakeFac({ onReadyThrows: true })); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    b.fire(); await settle();
    t('onReady が例外でも、3秒で false', r === false, r);
  }
  {
    const b = makeBox(fakeFac({ noOnReady: true })); let r;
    b.suFacReady_().then(v => { r = v; }); await settle();
    b.fire(); await settle();
    t('古い su-facility.js（onReady が無い）でも、3秒で読めたかを返す', r === false, r);
  }
  {
    const b = makeBox(fakeFac()); let r;
    b.suFacReady_(500).then(v => { r = v; }); await settle();
    t('待つ長さは引数で変えられる', b.timers[0].ms === 500);
  }

  console.log('\n— C. 入居者マスタの A4様式（a4Print）—');
  async function runA4(facOk, sameId) {
    const out = { toasts: [], printed: 0 };
    const box = {
      Promise, console,
      curResident: { id: 7 },
      a4Printing: false,
      duFresh: () => true,
      toast: m => out.toasts.push(m),
      a4EnsureDayMap: () => Promise.resolve(''),
      a4PrintNow: () => { out.printed++; },
      suFacReady_: () => Promise.resolve(facOk),
      SU_FAC_NG_MSG: '⚠️ 施設情報が読めません。'
    };
    vm.createContext(box);
    vm.runInContext(grab(PAGES.master, 'function a4Print(){') + '\n' + grab(PAGES.master, 'function a4CurId_(){'), box);
    if (sameId === false) box.a4EnsureDayMap = () => { box.curResident = { id: 8 }; return Promise.resolve(''); };
    box.a4Print(); await settle();
    out.printing = box.a4Printing;
    return out;
  }
  let o = await runA4(false);
  t('施設情報が読めない → 「施設情報が読めません」と出して刷らない・連打の止めも外す', o.printed === 0 && o.toasts.some(m => /施設情報が読めません/.test(m)) && o.printing === false, o);
  o = await runA4(true);
  t('読めた → 1回だけ刷る', o.printed === 1 && !o.toasts.some(m => /施設情報/.test(m)), o);
  o = await runA4(true, false);
  t('待つ間に別の方へ移ったら、今までどおり中止を知らせて刷らない', o.printed === 0 && o.toasts.some(m => /別の方の画面へ移った/.test(m)), o);
  t('帳票の施設名・電話（a4Facility）は今までどおり施設情報から引く', /function a4Facility\(\)\{\n  var o=\(window\.SUFacility && SUFacility\.ready\(\)\) \? SUFacility\.office\('施設'\)/.test(PAGES.master));

  console.log('\n— D. デイ利用表の印刷ボタン —');
  /* opts: ready＝押した時に読めていたか／redrawn＝☆の確かめで描き直したか／gate＝待ちの結果を外から決める（二重押しの試験） */
  function mkDay(facOk, opts) {
    opts = opts || {};
    const out = { toasts: [], opened: [], titles: 0, order: [], renders: 0 };
    const handlers = {};
    const box = {
      Promise, console,
      $: id => ({ addEventListener: (ev, fn) => { handlers[id] = fn; } }),
      window: { SUPrint: { openDialog: tab => { out.opened.push(tab); out.order.push('open'); } },
                SUFacility: { ready: () => opts.ready !== false } },
      activeTab: () => 'sc-roster',
      toast: (m, ng) => out.toasts.push([m, ng]),
      applyDcrTitles: () => { out.titles++; out.order.push('titles'); },
      renderAll: () => { out.renders++; out.order.push('render'); },
      DB: { residents: [] },
      dcrPrintWaiting: false,
      dcrRefreshStarsIfStale_: () => { out.order.push('stars'); return Promise.resolve(!!opts.redrawn); },
      suFacReady_: () => opts.gate ? opts.gate() : Promise.resolve(facOk),
      SU_FAC_NG_MSG: '⚠️ 施設情報が読めません。'
    };
    box.SUPrint = box.window.SUPrint; box.SUFacility = box.window.SUFacility;
    vm.createContext(box);
    const src = grab(PAGES.day, "  $('btnPrint').addEventListener('click', () => {");
    vm.runInContext(src + ');', box);
    return { box, out, press: () => handlers.btnPrint() };
  }
  async function runDay(facOk, opts) { const d = mkDay(facOk, opts); d.press(); await settle(); d.out.waiting = d.box.dcrPrintWaiting; return d.out; }
  o = await runDay(false);
  t('施設情報が読めない → 印刷の画面を開かず、「施設情報が読めません」を赤で出す', o.opened.length === 0 && o.toasts.length === 1 && /施設情報が読めません/.test(o.toasts[0][0]) && o.toasts[0][1] === true, o);
  o = await runDay(true);
  t('読めた → 表題を施設の名前にしてから、押した時のタブで印刷の画面を開く', o.opened.length === 1 && o.opened[0] === 'sc-roster' && o.titles === 1, o);
  t('印刷の画面を開く前に、☆の医療機関が変わっていないかを確かめる（2026-10-14 第4版 3）', o.order.join() === 'stars,titles,open', o.order);

  console.log('\n— E. フェイスシートの4つの印刷ボタン —');
  {
    const out = { toasts: [], went: 0 };
    const mk = ok => {
      const box = { Promise, toast: m => out.toasts.push(m), suFacReady_: () => Promise.resolve(ok), SU_FAC_NG_MSG: '⚠️ 施設情報が読めません。' };
      vm.createContext(box);
      vm.runInContext('var fsFacWaiting_=false;\n' + grab(PAGES.face, 'function fsFacGate_(go){'), box);
      return box;
    };
    mk(false).fsFacGate_(() => { out.went++; }); await settle();
    const ngOk = out.went === 0 && /施設情報が読めません/.test(out.toasts[0] || '');
    mk(true).fsFacGate_(() => { out.went++; }); await settle();
    t('関門（fsFacGate_）: 読めなければ知らせて止め、読めたら進む', ngOk && out.went === 1, out);
  }
  const F = PAGES.face;
  t('誕生日一覧の印刷ボタンが関門を通る', /\$\('bdayPrint'\)\.addEventListener\('click',function\(\)\{fsFacGate_\(bdayPrintGo_\)\}\);/.test(F));
  t('食形態一覧の印刷ボタンが関門を通る', /\$\('mealPrint'\)\.addEventListener\('click',function\(\)\{fsFacGate_\(fsPrintMeal\)\}\);/.test(F));
  t('フェイスシートの印刷ボタンが関門を通る（その後は今までどおり）', /\$\('printBtn'\)\.addEventListener\('click',function\(\)\{fsFacGate_\(function\(\)\{fsMdPrintGate_\(/.test(F));
  t('まとめて印刷ボタンが関門を通る（その後は今までどおり）', /\$\('printAllBtn'\)\.addEventListener\('click',function\(\)\{fsFacGate_\(function\(\)\{fsMdPrintGate_\(/.test(F));
  t('関門を通らずに刷るボタンが残っていない（click から直接 print 系を呼ばない）',
    !/addEventListener\('click',\s*(function\(\)\{)?\s*(bdayPrintGo_|fsPrintMeal|fsMdPrintGate_|window\.print)/.test(F));

  console.log('\n— F. 待つ間の二重押し・待った後の描き直し（第4版 7）—');
  {
    let rel = [];
    const d = mkDay(true, { ready: false, gate: () => new Promise(r => rel.push(r)) });
    d.press(); d.press(); d.press();
    t('デイ利用表: 待っている間に3回押しても、待ちは1本だけ', rel.length === 1, rel.length);
    rel[0](true); await settle();
    t('デイ利用表: 待ちが終わると、印刷の画面は1回だけ開く', d.out.opened.length === 1, d.out.opened);
    t('デイ利用表: 終わったら二重押しの止めを外す（次は押せる）', d.box.dcrPrintWaiting === false);
    d.press(); rel[1](true); await settle();
    t('デイ利用表: 止めを外した後の押下は、もう一度印刷の画面を開く', d.out.opened.length === 2, d.out.opened);
  }
  o = await runDay(true, { ready: false });
  t('デイ利用表: 押した時に施設情報がまだで、待っている間に読めた → 本文を描き直してから印刷の画面を開く', o.order.join() === 'stars,render,titles,open' && o.renders === 1, o.order);
  o = await runDay(true, { ready: true });
  t('デイ利用表: 押した時に読めていた → 描き直さずに開く（今までどおり）', o.renders === 0 && o.opened.length === 1, o.order);
  o = await runDay(true, { ready: false, redrawn: true });
  t('デイ利用表: ☆の確かめで描き直した時は、重ねて描き直さない', o.renders === 0 && o.opened.length === 1, o.order);
  o = await runDay(false, { ready: false });
  t('デイ利用表: 読めなかった時も止めを外す（次に押せる）', o.waiting === false && o.opened.length === 0, o);
  {
    const d = mkDay(true, { ready: false });
    d.box.dcrRefreshStarsIfStale_ = () => Promise.reject(new Error('x'));
    d.press(); await settle();
    t('デイ利用表: ☆の確かめが失敗しても、描き直して印刷の画面を開く（止めも外す）', d.out.opened.length === 1 && d.out.renders === 1 && d.box.dcrPrintWaiting === false, d.out);
  }
  {
    const out = { toasts: [], went: 0 };
    let rel = [];
    const box = { Promise, toast: m => out.toasts.push(m), suFacReady_: () => new Promise(r => rel.push(r)), SU_FAC_NG_MSG: '⚠️ 施設情報が読めません。' };
    vm.createContext(box);
    vm.runInContext(lineOfFace() + '\n' + grab(PAGES.face, 'function fsFacGate_(go){'), box);
    box.fsFacGate_(() => { out.went++; }); box.fsFacGate_(() => { out.went++; });
    t('フェイスシート: 待っている間の2回目の押下は無視する（待ちは1本）', rel.length === 1, rel.length);
    rel[0](true); await settle();
    t('フェイスシート: 待ちが終わると1回だけ進む', out.went === 1, out);
    box.fsFacGate_(() => { out.went++; }); rel[1](false); await settle();
    t('フェイスシート: 読めなかった時も止めを外す（その次は押せる）', out.went === 1 && box.fsFacWaiting_ === false && rel.length === 2, out);
    box.fsFacGate_(() => { out.went++; });
    t('フェイスシート: 止めを外した後は、また待ちを始める', rel.length === 3);
  }
  function lineOfFace() { const m = /var fsFacWaiting_=false;/.exec(PAGES.face); if (!m) throw new Error('fsFacWaiting_ が見つかりません'); return m[0]; }
  t('入居者マスタの A4様式は、今までどおり待つ間の連打を無視する（a4Printing）', /if\(a4Printing\)return;\n  a4Printing=true;/.test(PAGES.master));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
