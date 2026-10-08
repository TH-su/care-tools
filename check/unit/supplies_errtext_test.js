/* 消耗品管理（supplies.html）のエラー表のテスト（2026-09-23・ロック解放前の flush の横展開）。
   守りたいのは3つ:
     ①サーバー（supplies-api.gs）が flush を確かめられなかった時の error コード flush_fail が、
       表から日本語で引けること。表に無いと「サーバーが処理を断りました（flush_fail）」と出て、
       現場は「断られた＝入っていない」と読んで同じ操作をやり直す（新しい品目は二重登録になる）
     ②表に足したことで既存の項目が壊れていないこと（文言の表とヒントの表が同じ項目を持つ・
       ヒントはすべて「。」で終わる）
     ③台帳を動かす動作（addMoves・voidMove・repriceMoves）が flush_fail で返った時は、
       明細に「古い」印（ST.billStale）を立てること。台帳が書けていることがあるので、
       明細を開いた時に読み直させる。他の動作・他のエラーでは立てない
   画面の実関数（serverErrText・serverErrHint・mkErr・errText・errHint・markBillStale・apiPost）を
   名前で切り出して呼ぶ。
   外部ライブラリなし・実データなし。
   実行: node "…/check/unit/supplies_errtext_test.js"
     （読む HTML は環境変数 SPL_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.SPL_HTML || path.join(__dirname, '..', '..', 'supplies.html');
const src = fs.readFileSync(HTML, 'utf8');

/* 関数を名前で切り出す（HTML ごと評価すると DOM 依存の初期化まで走る）。
   波かっこを数えて終端を探す。文字列とコメントの中のかっこは数えない。 */
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
/* var の宣言を1つ切り出す（表は「var 名前 = {」から行頭の「};」まで。1行の宣言は行末まで） */
function grabVar(name){
  const m = src.match(new RegExp('\\nvar ' + name + ' = (\\{[\\s\\S]*?\\n\\};|[^\\n]*;)'));
  if(!m) throw new Error('宣言が見つかりません: ' + name);
  return m[0];
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

const TEXT = '保存できたか確かめられませんでした';
const HINT = '一覧を取り直して、入っているか確かめてから操作してください（新しい品目は、もう一度登録する前に一覧で確かめる）。';
const ERR_PARTS = [grabFn('txt'), grabFn('mkErr'), grabFn('errText'), grabFn('errHint'),
  grabVar('ERR_TEXT'), grabVar('ERR_HINT'), grabFn('serverErrText'), grabFn('serverErrHint')];

const sb = {};
vm.createContext(sb);
vm.runInContext(ERR_PARTS.join('\n'), sb);

/* ═══ 1. 表から引ける ═══ */
group('flush_fail が表から引ける');
const FF = {ok:false, error:'flush_fail'};
eq('本文は「保存できたか確かめられませんでした」', sb.serverErrText(FF), TEXT);
t('コードのまま出さない（「サーバーが処理を断りました（flush_fail）」にならない）',
  sb.serverErrText(FF).indexOf('flush_fail') < 0 && sb.serverErrText(FF).indexOf('断りました') < 0, sb.serverErrText(FF));
eq('サーバーがヒントを添えない時は表のヒント', sb.serverErrHint(FF), HINT);
eq('ヒントが空文字の時も表のヒント', sb.serverErrHint({ok:false, error:'flush_fail', hint:''}), HINT);
/* サーバーが hint を添えた時はそちらが先（serverErrHint の従来の優先順位。今回は変えていない） */
eq('サーバーが添えたヒントがあればそちらを出す（従来の優先順位のまま）',
  sb.serverErrHint({ok:false, error:'flush_fail', hint:'テスト用のヒント'}), 'テスト用のヒント');
const e1 = sb.mkErr(sb.serverErrText(FF), sb.serverErrHint(FF));
eq('画面が出す本文（errText）', sb.errText(e1), TEXT);
eq('画面が出すヒント（errHint）', sb.errHint(e1), HINT);

/* ═══ 2. 既存の表を壊していない ═══ */
group('既存の表');
const textKeys = Object.keys(sb.ERR_TEXT).sort(), hintKeys = Object.keys(sb.ERR_HINT).sort();
eq('文言の表とヒントの表は同じ項目を持つ', textKeys, hintKeys);
t('flush_fail は両方の表にある', textKeys.indexOf('flush_fail') >= 0 && hintKeys.indexOf('flush_fail') >= 0, textKeys);
eq('直前の項目（busy）の本文はそのまま', sb.serverErrText({ok:false, error:'busy'}), 'ほかの人が同時に書き込んでいます');
eq('直前の項目（busy）のヒントはそのまま', sb.serverErrHint({ok:false, error:'busy'}), '少し待ってから、もう一度お試しください。');
eq('表に無いコードは従来どおりコード付きで出す', sb.serverErrText({ok:false, error:'no_such_code'}), 'サーバーが処理を断りました（no_such_code）');
t('flush_fail のヒントの末尾は「。」（既存のヒントの流儀）', /。$/.test(sb.ERR_HINT.flush_fail), sb.ERR_HINT.flush_fail);
const noPeriod = Object.keys(sb.ERR_HINT).filter(k => !/。$/.test(sb.ERR_HINT[k]));
eq('ヒントの表はすべて「。」で終わる（終わらない項目）', noPeriod, []);

/* ═══ 3. 版の目印 ═══ */
group('版の目印');
const meta = (src.match(/<meta name="spl-build" content="([^"]*)">/) || [])[1];
const build = (src.match(/\nvar BUILD = '([^']*)';/) || [])[1];
t('meta spl-build と BUILD が同じ（食い違わせない）', !!meta && meta === build, {meta, build});

/* ═══ 4. 通信の口（apiPost）を通しても同じ文言になる・明細の「古い」印 ═══
   偽物の fetch で応答を返し、画面が受け取る例外と ST.billStale を確かめる。
   印は実物の markBillStale で立てる（ST だけ偽物） */
function makeApi(resp){
  const box = {
    ST: {billStale:false},
    loadCfg: () => ({url:'https://example.invalid/exec', token:'test', by:''}),
    fetch: () => Promise.resolve({ok:true, status:200, text: () => Promise.resolve(JSON.stringify(resp))})
  };
  vm.createContext(box);
  vm.runInContext(ERR_PARTS.concat([grabVar('URL_OK_RE'), grabVar('MOVE_WRITERS'),
    grabFn('markBillStale'), grabFn('apiPost')]).join('\n'), box);
  return box;
}
async function caught(resp, action){
  const box = makeApi(resp);
  try { await box.apiPost(action || 'addMoves', {moves:[]}); return {box, e:null}; }
  catch(e){ return {box, e}; }
}
async function runApiCases(){
  group('apiPost を通した時');
  const r1 = await caught({ok:false, error:'flush_fail'});
  t('失敗として例外で返る', !!r1.e);
  eq('例外のコードは flush_fail（呼び出し側がコードで見分けられる）', r1.e && r1.e.code, 'flush_fail');
  eq('本文（errText）', r1.e && r1.box.errText(r1.e), TEXT);
  eq('ヒント（errHint）', r1.e && r1.box.errHint(r1.e), HINT);
  const r2 = await caught({ok:false, error:'flush_fail', hint:'テスト用のヒント'});
  eq('サーバーのヒントがあればそちら（本文は表のまま）',
    r2.e && [r2.box.errText(r2.e), r2.box.errHint(r2.e)], [TEXT, 'テスト用のヒント']);

  group('明細の「古い」印（flush_fail は台帳が書けていることがある）');
  for(const act of ['addMoves', 'voidMove', 'repriceMoves']){
    const r = await caught({ok:false, error:'flush_fail'}, act);
    t(act + ' が flush_fail → 印が立つ（明細を開いた時に読み直す）', r.box.ST.billStale === true, r.box.ST);
    eq(act + ' が flush_fail → 失敗としては従来どおり投げる（コード flush_fail）', r.e && r.e.code, 'flush_fail');
  }
  const rItem = await caught({ok:false, error:'flush_fail'}, 'saveItem');
  t('台帳を動かさない動作（saveItem）の flush_fail → 印は立たない',
    rItem.box.ST.billStale === false && !!rItem.e, rItem.box.ST);
  for(const code of ['busy', 'conflict', '']){
    const r = await caught(code ? {ok:false, error:code} : {ok:false}, 'addMoves');
    t('addMoves でも flush_fail 以外の失敗（' + (code || 'error なし') + '）→ 印は立たない',
      r.box.ST.billStale === false && !!r.e, r.box.ST);
  }
  const rOk = await caught({ok:true, results:[]}, 'addMoves');
  t('成功時の既存の印付けはそのまま（addMoves 成功 → 立つ）', rOk.box.ST.billStale === true && !rOk.e, rOk.e && rOk.e.message);
  const rOk2 = await caught({ok:true}, 'saveItem');
  t('成功でも台帳を動かさない動作（saveItem）→ 立たない', rOk2.box.ST.billStale === false && !rOk2.e, rOk2.e && rOk2.e.message);
}

process.on('unhandledRejection', e => { ng++; process.stdout.write('  ✗ 処理されなかった失敗: ' + ((e && e.stack) || e) + '\n'); });
runApiCases().catch(e => {
  ng++; process.stdout.write('  ✗ 走らせる途中で止まりました: ' + ((e && e.stack) || e) + '\n');
}).then(() => {
  process.stdout.write('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────\n');
  process.exit(ng ? 1 : 0);
});
