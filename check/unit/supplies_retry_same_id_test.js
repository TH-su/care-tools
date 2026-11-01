/* 消耗品管理（supplies.html）の「送り直しは同じ番号で」のテスト（2026-11-01・品質改善 第2期 便2）。
   守りたいのは次のこと:
     ①入庫を送って応答が来ずに失敗した後、同じ入力のまま「記録する」を押し直すと、
       前と同じ番号（id）で送ること。サーバーは同じ番号を二重に登録しないので、
       実は届いていた時も在庫が2倍にならない（直す前は新しい番号で送り、40→80 になっていた）
     ②中身が違えば新しい番号で送ること（別の記録を「登録済み」で捨てさせない）
     ③送信が通った後は、同じ中身でも新しい番号で送ること（続けて同じ入庫を入れられる）
     ④サーバーから読み直した後（一覧の読み直し・品目の入出庫の読み込み・送信待ちの出庫の送り直しの応答）は、
       控えを捨てて新しい番号で送ること（届いたのを確かめてから本当にもう1件入れる時に「登録済み」で捨てさせない）
     ⑤出庫でも同じ番号で送り直し、送信待ちの控え（spl_pending）には同じ番号を1件だけ持つこと
       （「未送信の出庫 2件」と実際より多く出さない）
   画面の実関数（submitMove・sendMoves・newMoveId・moveFingerprint・送信待ちの控えの関数・
   flushPending・loadList・loadDetailMoves）を名前で切り出し、
   入力欄と通信は架空のものに差し替えて呼ぶ。送る本文の形（{moves:[...]}）も確かめる。
   外部ライブラリなし・実データなし（品目は「見本品A」）。
   実行: node "…/check/unit/supplies_retry_same_id_test.js"
     （読む HTML は環境変数 SPL_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.SPL_HTML || path.join(__dirname, '..', '..', 'supplies.html');
const src = fs.readFileSync(HTML, 'utf8');

/* 関数を名前で切り出す（supplies_errtext_test.js と同じ数え方。文字列とコメントの中のかっこは数えない） */
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

/* ── 走らせ方 ── */
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

/* 古い版の画面には moveFingerprint が無いので、ある時だけ読む（直す前の版で①が落ちることを確かめるため） */
const PARTS = [grabFn('txt'), grabFn('newMoveId'), grabFn('submitMove'), grabFn('sendMoves'),
  grabFn('readPending'), grabFn('writePending'), grabFn('addPending'), grabFn('dropPending'),
  grabFn('flushPending'), grabFn('loadList'), grabFn('loadDetailMoves'),
  ...(src.indexOf('\nfunction moveFingerprint(') >= 0 ? [grabFn('moveFingerprint')] : [])];

/* 架空の入力欄（値と disabled・focus だけ持つ） */
function makeEl(v){ return { value: v, disabled: false, hidden: false, textContent: '', focus(){} }; }
const ITEM = { id: 'it_mihon_a', name: '見本品A' };

function makeSandbox(){
  const els = {
    mvItem: makeEl(ITEM.id), mvDate: makeEl('2026-10-01'), mvNote: makeEl(''),
    mvQty: makeEl('40'), mvUnit: makeEl('0'), mvCost: makeEl(''), mvResident: makeEl(''),
    mvResidentNo: makeEl(''), mvDose: makeEl(''), mvTimes: makeEl(''), mvDays: makeEl(''),
    mvProfile: makeEl(''), mvSubmit: makeEl(''), mvErr: makeEl(''), mvState: makeEl('')
  };
  const sent = [];
  let nextFail = false;
  const store = {};                /* 架空の sessionStorage */
  const noop = () => {};
  const sb = {
    sessionStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }
    },
    PENDING_KEY: 'spl_pending', MAX_MOVES: 200,
    updatePendingLabel: noop, cfgReady: () => true, toast: noop, rejectText: () => '',
    normItem: (x) => x, applyRole: noop, fillCatSelect: noop, fillItemSelects: noop, buildListHead: noop,
    fillSettingsData: noop, renderDetail: noop, renderBillControls: noop, renderDetailMoves: noop,
    ADMIN_GAS_ASK: '',
    window: {
      crypto: { getRandomValues(buf){ for(let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256); return buf; } },
      confirm(){ return true; }
    },
    ST: { busy: false, loading: false, role: 'office', items: [], item: ITEM.id, screen: 'list' },
    NOTE_MAX: 200, RESIDENT_MANUAL: '__manual__',
    $: (id) => { if(!els[id]) throw new Error('架空の入力欄が無い: ' + id); return els[id]; },
    itemById: (id) => (id === ITEM.id ? ITEM : null),
    currentType: () => sb.__type,
    SPL: () => ({ isYmd: (d) => /^\d{4}-\d{2}-\d{2}$/.test(d), today: () => '2026-11-01',
      convertQty: (o) => Number(o.qtyEntered), profileQtyAmount: () => null,
      prevMonth: (ym) => ym, monthRange: (ym) => ({ from: ym + '-01', to: ym + '-28' }) }),
    isClosed: () => false, ymOf: (d) => d.slice(0, 7), isAdmin: () => false, isProfile: () => false,
    parseIntStrict: (v) => (/^\d+$/.test(String(v)) ? Number(v) : null), parseDec1: () => null,
    minIdxOf: () => 0, unitsOf: () => [], adjSign: () => 1, residentIdForMove: () => '',
    willGoNegative: () => false, showMoveErr(){}, setState(){},
    mergeStock(){}, refreshStockAfterDup(){ return Promise.resolve(false); },   /* 登録済みの時の在庫の取り直しは supplies_dup_stock_refresh_test.js で確かめる */
    reportMoveResults(){}, renderList(){}, renderStock(){}, syncResidentNo(){},
    renderPreview(){}, askRepriceAfterIn(){},
    errText: () => '応答がないため中断しました', errHint: () => '',
    apiPost: (action, body) => {
      if(action === 'list') return Promise.resolve({ ok: true, items: [ITEM], stock: {} });
      if(action === 'listMoves') return Promise.resolve({ ok: true, moves: [] });
      sent.push({ action: action, body: JSON.parse(JSON.stringify(body)) });
      if(nextFail){ nextFail = false; return Promise.reject(new Error('timeout')); }
      return Promise.resolve({ ok: true, results: body.moves.map((m) => ({ id: m.id, status: 'applied' })) });
    }
  };
  sb.__type = 'in';
  vm.createContext(sb);
  vm.runInContext(PARTS.join('\n'), sb);
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    sb, els, sent,
    failNext(){ nextFail = true; },
    pending(){ return JSON.parse(store.spl_pending || '[]'); },
    async loadList(){ await sb.loadList(true); await settle(); },
    async loadDetail(){ sb.loadDetailMoves(); await settle(); },
    async flush(){ await sb.flushPending(); await settle(); },
    /* 押して、応答（成功・失敗）の後始末まで待つ */
    async press(){ sb.submitMove(); await new Promise((r) => setImmediate(r)); }
  };
}
const idOf = (s) => s.body.moves[0].id;
const noId = (s) => Object.assign({}, s.body.moves[0], { id: '' });

(async () => {
  /* ═══ 1. 失敗の後に同じ中身で押し直す ═══ */
  group('時間切れの後に同じ入力で押し直すと、同じ番号で送る');
  {
    const h = makeSandbox();
    h.failNext();
    await h.press();
    await h.press();
    eq('2回とも送った', h.sent.length, 2);
    t('2回目は1回目と同じ番号（サーバーは「すでに登録済み」で受ける）', h.sent.length === 2 && idOf(h.sent[0]) === idOf(h.sent[1]),
      h.sent.map(idOf));
    eq('送る本文の形は {moves:[1件]} のまま', h.sent[1] && [Object.keys(h.sent[1].body), h.sent[1].body.moves.length], [['moves'], 1]);
    eq('動作は addMoves', h.sent[1] && h.sent[1].action, 'addMoves');
    eq('番号以外の中身も同じ', h.sent[1] && noId(h.sent[1]), noId(h.sent[0]));
    h.els.mvQty.value = '40';      /* 成功でフォームの数量が空になるので入れ直す */
    await h.press();
    t('押し直しが通った後は、同じ中身でも新しい番号', h.sent.length === 3 && idOf(h.sent[2]) !== idOf(h.sent[1]), h.sent.map(idOf));
  }
  {
    const h = makeSandbox();
    h.failNext(); await h.press();
    h.failNext(); await h.press();
    await h.press();
    t('2回続けて失敗しても、3回目まで同じ番号', h.sent.length === 3 && idOf(h.sent[0]) === idOf(h.sent[1]) && idOf(h.sent[1]) === idOf(h.sent[2]),
      h.sent.map(idOf));
  }

  /* ═══ 2. 中身が違えば新しい番号 ═══ */
  group('中身が違えば新しい番号で送る');
  {
    const h = makeSandbox();
    h.failNext(); await h.press();
    h.els.mvQty.value = '30';
    await h.press();
    t('数量を変えたら新しい番号', idOf(h.sent[0]) !== idOf(h.sent[1]), h.sent.map(idOf));
    h.els.mvQty.value = '40';
    await h.press();
    t('一度違う中身を送った後は、元の中身に戻しても新しい番号（控えは捨てた）', idOf(h.sent[2]) !== idOf(h.sent[0]), h.sent.map(idOf));
  }
  {
    const h = makeSandbox();
    h.failNext(); await h.press();
    h.els.mvNote.value = '見本のメモ';
    await h.press();
    t('メモを変えたら新しい番号', idOf(h.sent[0]) !== idOf(h.sent[1]), h.sent.map(idOf));
  }
  {
    const h = makeSandbox();
    h.failNext(); await h.press();
    h.els.mvDate.value = '2026-10-02';
    await h.press();
    t('日付を変えたら新しい番号', idOf(h.sent[0]) !== idOf(h.sent[1]), h.sent.map(idOf));
  }

  /* ═══ 3. 成功の後は新しい番号 ═══ */
  group('送信が通った後は、同じ中身でも新しい番号で送る');
  {
    const h = makeSandbox();
    await h.press();
    h.els.mvQty.value = '40';      /* 成功でフォームの数量が空になるので入れ直す */
    await h.press();
    eq('2回とも送った', h.sent.length, 2);
    t('続けて同じ入庫を入れたら新しい番号（2件目として登録される）', idOf(h.sent[0]) !== idOf(h.sent[1]), h.sent.map(idOf));
    eq('番号以外の中身は同じ', noId(h.sent[1]), noId(h.sent[0]));
  }

  /* ═══ 4. サーバーから読み直した後は新しい番号 ═══ */
  group('サーバーから読み直した後は、同じ中身でも新しい番号で送る');
  {
    const h = makeSandbox();
    h.failNext(); await h.press();
    await h.loadList();
    await h.press();
    t('失敗 → 一覧の読み直し（⟳）→ 同じ中身は新しい番号', h.sent.length === 2 && idOf(h.sent[0]) !== idOf(h.sent[1]), h.sent.map(idOf));
  }
  {
    const h = makeSandbox();
    h.failNext(); await h.press();
    await h.loadDetail();
    await h.press();
    t('失敗 → 品目の入出庫の読み込み → 同じ中身は新しい番号', h.sent.length === 2 && idOf(h.sent[0]) !== idOf(h.sent[1]), h.sent.map(idOf));
  }
  {
    const h = makeSandbox();
    h.sb.__type = 'out';
    h.els.mvResident.value = 'shared';
    h.failNext(); await h.press();
    await h.flush();
    h.els.mvQty.value = '40'; h.els.mvResident.value = 'shared';
    await h.press();
    eq('送信待ちの出庫を送り直した', h.sent.length >= 2 && h.sent[1].body.moves.map((m) => m.id), [idOf(h.sent[0])]);
    t('失敗 → 送信待ちの送り直しの応答 → 同じ中身は新しい番号', h.sent.length === 3 && idOf(h.sent[2]) !== idOf(h.sent[0]), h.sent.map(idOf));
  }

  /* ═══ 5. 出庫 ═══ */
  group('出庫でも同じ番号で送り、送信待ちには1件だけ控える');
  {
    const h = makeSandbox();
    h.sb.__type = 'out';
    h.els.mvResident.value = 'shared';
    h.failNext(); await h.press();
    h.failNext(); await h.press();
    t('出庫の押し直しも同じ番号', h.sent.length === 2 && idOf(h.sent[0]) === idOf(h.sent[1]), h.sent.map(idOf));
    eq('出庫を2回失敗しても、送信待ちの同じ番号は1件', h.pending().map((m) => m.id), [idOf(h.sent[0])]);
    await h.press();
    eq('3回目が通ったら送信待ちは空', h.pending().length, 0);
  }

  /* ═══ 6. 控えは端末に書かない ═══ */
  group('控えは画面のメモリだけ（端末の保存領域に書かない）');
  {
    const body = grabFn('submitMove') + grabFn('sendMoves');
    t('submitMove・sendMoves に localStorage が無い', body.indexOf('localStorage') < 0);
    t('submitMove・sendMoves に sessionStorage が無い（出庫の控えは addPending のまま）', body.indexOf('sessionStorage') < 0);
  }

  process.stdout.write('\n' + (ng ? '✗' : '✓') + ' 送り直しの番号: 成功 ' + ok + '件／失敗 ' + ng + '件\n');
  process.exit(ng ? 1 : 0);
})().catch((e) => { process.stdout.write('✗ 試験が途中で止まりました: ' + e.message + '\n'); process.exit(1); });
