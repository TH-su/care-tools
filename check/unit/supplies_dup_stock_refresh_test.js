/* 消耗品管理（supplies.html）の「すでに登録済みの時に在庫の数を取り直す」のテスト（2026-11-02・品質改善 第2期 便4）。
   守りたいのは次のこと:
     1. 送った記録に「すでに登録済み」（existing）が1件でもあれば、品目の一覧の読み取り（list）から在庫の数だけを取り直し、
        画面の在庫を描き直すこと（サーバーの応答の在庫は今回書いた品目の分だけで、登録済みの品目の在庫は入らないため）
     2. 登録済みが無ければ読みに行かないこと（通信を増やさない）
     3. 読み取りを待つ間に在庫が入れ替わったら、古い値で上書きしないこと。比べるのは品目ごと
        （別の品目の送信が間に入っても、押し直した品目は直す）。一覧を読み直した時は全部そちらを使う
     3の2. 一覧で改定行を打っている間は一覧を描き直さない・詳細画面を開いていれば詳細の在庫を描き直す
     4. 読み取りに失敗した時・応答に在庫が無い時は、今の在庫のまま残し、失敗の記録だけ残すこと
     5. 在庫のほか（品目・価格・知らせ・入力欄）は触らないこと（一覧を丸ごと読み直すと知らせと入力欄が消えるため）
     6. 入出庫の送信・送信待ちの出庫の送り直し・前月の複写の3か所から呼ばれること
   画面の実関数（mergeStock・refreshStockAfterDup・sendMoves・flushPending）を名前で切り出し、通信と描画は架空のものに差し替えて呼ぶ。
   外部ライブラリなし・実データなし（品目は「見本品A」）。
   実行: node "…/check/unit/supplies_dup_stock_refresh_test.js"
     （読む HTML は環境変数 SPL_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.SPL_HTML || path.join(__dirname, '..', '..', 'supplies.html');
const src = fs.readFileSync(HTML, 'utf8');

/* 関数を名前で切り出す（supplies_retry_same_id_test.js と同じ数え方。文字列とコメントの中のかっこは数えない） */
function grabFn(name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false;
  for(let i = start; i < src.length; i++){
    const c = src[i];
    if(c === "'" || c === '"' || c === '`'){
      for(i++; i < src.length && src[i] !== c; i++){ if(src[i] === '\\') i++; }
      continue;
    }
    if(c === '/' && src[i + 1] === '*'){ const e = src.indexOf('*/', i + 2); i = (e < 0) ? src.length : e + 1; continue; }
    if(c === '/' && src[i + 1] === '/'){ const e = src.indexOf('\n', i); i = (e < 0) ? src.length : e; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}

let ok = 0, ng = 0;
function eq(label, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w){ ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function t(label, cond, detail){
  if(cond){ ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + (detail !== undefined ? ('\n    実際: ' + JSON.stringify(detail)) : '') + '\n'); }
}
function group(name){ process.stdout.write('\n■ ' + name + '\n'); }

let PARTS;
try { PARTS = [grabFn('txt'), grabFn('mergeStock'), grabFn('refreshStockAfterDup'), grabFn('sendMoves'), grabFn('flushPending')]; }
catch(e){ process.stdout.write('  ✗ 関数を切り出せません（' + e.message + '）\n\n合計: 0 件成功 / 1 件失敗\n'); process.exit(1); }

/* 架空の画面。apiPost は台本どおりに答える（answer: 関数 or 'hang'） */
function makeCtx(opts){
  opts = opts || {};
  const calls = [], notes = [], drawn = { list: 0, stock: 0 }, states = [];
  const pend = [];
  const els = {};
  function el(id){ return els[id] || (els[id] = { value: 'x', disabled: false, textContent: '', contains: (x) => !!(x && x.inProf) }); }
  const ctx = {
    ST: { stock: { A: { qty: 40 }, B: { qty: 7 } }, stockGen: 0, stockAt: {}, stockAll: 0, busy: false, retryMove: null,
          edit: opts.edit || null, screen: opts.screen || 'stock', items: [{ id: 'A', name: '見本品A' }, { id: 'B', name: '見本品B' }] },
    calls, notes, drawn, states, pend,
    cfgReady: () => opts.cfg !== false,
    apiPost: (action, body) => {
      calls.push({ action, body });
      const a = (opts.answer || {})[action];
      if(a === 'hang') return new Promise((res, rej) => { pend.push({ res, rej }); });
      if(typeof a === 'function') return a(body);
      return Promise.resolve({});
    },
    renderList: () => { drawn.list++; },
    renderStock: () => { drawn.stock++; },
    renderDetail: () => { drawn.detail = (drawn.detail || 0) + 1; },
    renderPreview: () => { drawn.preview = (drawn.preview || 0) + 1; },
    document: { activeElement: opts.focus || null },
    setState: (id, kind, title, hint) => { states.push({ id, kind, title }); },
    toast: () => {},
    reportMoveResults: () => {},
    addPending: () => {}, dropPending: () => {},
    readPending: () => opts.pending || [],
    syncResidentNo: () => {}, askRepriceAfterIn: () => {},
    rejectText: () => '登録できませんでした',
    moveFingerprint: () => 'fp', errText: () => 'x', errHint: () => '',
    $: el, els,
    window: { SUErrors: { note: (kind, e, where) => notes.push({ kind, where }) } },
    Promise, Array, Object, JSON, String, Number
  };
  vm.createContext(ctx);
  vm.runInContext(PARTS.join('\n'), ctx);
  return ctx;
}
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  group('1. 登録済みがあれば在庫の数だけを取り直す');
  {
    const c = makeCtx({ answer: { list: () => Promise.resolve({ items: [{ id: 'Z' }], stock: { A: { qty: 20 } } }) } });
    const r = await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('戻り値は true', r, true);
    eq('list を1回だけ読む', c.calls.map(x => x.action), ['list']);
    eq('在庫が正しい数になる', c.ST.stock.A.qty, 20);
    eq('一覧と在庫を描き直す', [c.drawn.list, c.drawn.stock], [1, 1]);
    eq('品目は差し替えない（在庫のほかは触らない）', c.ST.items.map(x => x.id), ['A', 'B']);
    eq('知らせを出し直さない', c.states.length, 0);
  }

  group('2. 登録済みが無ければ読みに行かない');
  for (const res of [[{ id: 'm1', status: 'applied' }], [{ id: 'm1', status: 'rejected' }], [{ id: 'm1', status: 'existing_voided' }], [], null]) {
    const c = makeCtx();
    const r = await c.refreshStockAfterDup(res);
    t('通信 0回（' + JSON.stringify(res) + '）', c.calls.length === 0 && r === false, c.calls);
  }
  {
    const c = makeCtx({ cfg: false });
    await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('接続先が無い端末では読みに行かない', c.calls.length, 0);
  }

  group('3. 待つ間に在庫が入れ替わったら古い値で上書きしない（品目ごとに比べる）');
  {
    const c = makeCtx({ answer: { list: 'hang' } });
    const p = c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    c.mergeStock({ A: { qty: 55 } });                 /* 同じ品目の別の送信の応答が先に届いた */
    c.pend[0].res({ stock: { A: { qty: 20 } } });       /* 古い読み取りが後から届く */
    eq('戻り値は false', await p, false);
    eq('新しい在庫のまま', c.ST.stock.A.qty, 55);
    eq('描き直さない', [c.drawn.list, c.drawn.stock], [0, 0]);
  }
  {
    const c = makeCtx({ answer: { list: 'hang' } });
    const p = c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    c.mergeStock({ B: { qty: 9 } });                  /* 別の品目（B）の送信の応答が先に届いた */
    c.pend[0].res({ stock: { A: { qty: 20 }, B: { qty: 8 } } });
    eq('戻り値は true', await p, true);
    eq('押し直した品目（A）は正しい数になる', c.ST.stock.A.qty, 20);
    eq('先に届いた品目（B）は新しい方のまま', c.ST.stock.B.qty, 9);
  }
  {
    const c = makeCtx({ answer: { list: 'hang' } });
    const p = c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    c.ST.stockGen++; c.ST.stockAt = {}; c.ST.stockAll = c.ST.stockGen;   /* 一覧の読み込み（loadList）と同じ進め方 */
    c.ST.stock = { A: { qty: 33 }, B: { qty: 7 } };
    c.pend[0].res({ stock: { A: { qty: 20 }, B: { qty: 7 } } });
    eq('一覧を読み直した後は捨てる', await p, false);
    eq('一覧の値のまま', c.ST.stock.A.qty, 33);
  }

  group('3の2. 改定行と詳細画面');
  {
    const c = makeCtx({ edit: { itemId: 'A' }, screen: 'list', answer: { list: () => Promise.resolve({ stock: { A: { qty: 20 } } }) } });
    await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('改定行を開いている間は一覧を描き直さない（在庫は描き直す）', [c.drawn.list, c.drawn.stock], [0, 1]);
    eq('在庫の値は正しい数になる', c.ST.stock.A.qty, 20);
  }
  {
    const c = makeCtx({ screen: 'detail', answer: { list: () => Promise.resolve({ stock: { A: { qty: 20 } } }) } });
    await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('詳細画面を開いていれば詳細も描き直す', c.drawn.detail, 1);
    eq('入出庫の見込み（今の在庫）も描き直す', c.drawn.preview, 1);
  }
  {
    const c = makeCtx({ edit: { itemId: 'A' }, screen: 'stock', answer: { list: () => Promise.resolve({ stock: { A: { qty: 20 } } }) } });
    await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('改定行を開いたまま別の画面にいる時は一覧も描き直す（戻った時に古い数を出さない）', c.drawn.list, 1);
  }
  {
    const c = makeCtx({ screen: 'detail', focus: { inProf: true }, answer: { list: () => Promise.resolve({ stock: { A: { qty: 20 } } }) } });
    await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('詳細画面で月額の設定の欄に打っている間は詳細を描き直さない', c.drawn.detail, undefined);
    eq('在庫の値は正しい数になる', c.ST.stock.A.qty, 20);
  }

  group('4. 失敗・在庫の無い応答では今の在庫のまま');
  {
    const c = makeCtx({ answer: { list: () => Promise.reject(new Error('timeout')) } });
    const r = await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    eq('戻り値は false（例外を外に出さない）', r, false);
    eq('在庫はそのまま', c.ST.stock.A.qty, 40);
    eq('失敗の記録を1件残す', c.notes.map(n => n.where), ['supplies:refreshStockAfterDup']);
    eq('画面の知らせは出さない', c.states.length, 0);
  }
  for (const d of [{}, { stock: null }, { stock: 'x' }, null]) {
    const c = makeCtx({ answer: { list: () => Promise.resolve(d) } });
    const r = await c.refreshStockAfterDup([{ id: 'm1', status: 'existing' }]);
    t('応答 ' + JSON.stringify(d) + ' では在庫はそのまま', r === false && c.ST.stock.A.qty === 40, c.ST.stock);
  }

  group('5. 入出庫の送信から呼ばれる');
  {
    const c = makeCtx({ answer: {
      addMoves: () => Promise.resolve({ ok: true, results: [{ id: 'm1', status: 'existing' }], stock: {} }),
      list: () => Promise.resolve({ stock: { A: { qty: 20 } } })
    } });
    c.sendMoves([{ id: 'm1', itemId: 'A', type: 'in', qty: 20 }], false);
    for (let i = 0; i < 5; i++) await tick();
    eq('addMoves の後に list を読む', c.calls.map(x => x.action), ['addMoves', 'list']);
    eq('在庫が正しい数になる', c.ST.stock.A.qty, 20);
    eq('入力欄は送信の後の空のまま（読み直しで戻さない）', c.els.mvQty.value, '');
  }
  {
    const c = makeCtx({ answer: {
      addMoves: () => Promise.resolve({ ok: true, results: [{ id: 'm1', status: 'applied' }], stock: { A: { qty: 60 } } })
    } });
    c.sendMoves([{ id: 'm1', itemId: 'A', type: 'in', qty: 20 }], false);
    for (let i = 0; i < 5; i++) await tick();
    eq('通った時は list を読まない（応答の在庫を使う）', c.calls.map(x => x.action), ['addMoves']);
    eq('応答の在庫を使う', c.ST.stock.A.qty, 60);
  }

  group('6. 送信待ちの出庫の送り直しから呼ばれる');
  {
    const c = makeCtx({ pending: [{ id: 'm9', itemId: 'A', type: 'out', qty: 1 }], answer: {
      addMoves: () => Promise.resolve({ ok: true, results: [{ id: 'm9', status: 'existing' }], stock: {} }),
      list: () => Promise.resolve({ stock: { A: { qty: 39 } } })
    } });
    await c.flushPending();
    for (let i = 0; i < 5; i++) await tick();
    eq('addMoves の後に list を読む', c.calls.map(x => x.action), ['addMoves', 'list']);
    eq('在庫が正しい数になる', c.ST.stock.A.qty, 39);
  }

  group('7. 前月の複写の後にも呼ぶ（形の確かめ）');
  t('複写の報告の後に refreshStockAfterDup(acc) がある',
    /reportMoveResults\(acc\);\s*renderList\(\);\s*renderStock\(\);\s*refreshStockAfterDup\(acc\);/.test(src));
  t('一覧の読み込み（loadList）で在庫を入れ替えた時は、全部を入れ替えた印を進める（上の3の3件目と同じ進め方）',
    /ST\.stock = \(d\.stock && typeof d\.stock === 'object'\) \? d\.stock : \{\};\s*ST\.stockGen\+\+;\s*ST\.stockAt = \{\};\s*ST\.stockAll = ST\.stockGen;/.test(src));

  process.stdout.write('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────\n');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
