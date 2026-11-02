/* 消耗品管理（supplies.html）：職員に見える文に技術用語を出さない（品質改善 第3期 便7）。
   守りたいこと:
     1. 起動時の止め（#calcBlock）と明細の止めに、ファイル名（supplies-calc.js）・「計算モジュール」を出さない
     2. サーバーがうまく応答しない時の文に「HTTP」と番号を出さない（4xx は接続先の確かめ方を出す）
     3. 職員向けの文（mkErr）の無い例外（TypeError 等）は、英語の例外文を出さずに職員向けの文にし、
        不具合報告の記録（SUErrors.note）に1回だけ残す。mkErr の文・文字列はそのまま
     4. 接続の確認で断られた時、英語の符号をそのまま出さない（表にある符号は日本語・無い符号は「接続できませんでした」）
     5. 接続先が無い時の案内（一覧・在庫）は、何を入れるかと「設定を開く」を出す
        （この画面の接続先はこの画面の「設定」で入れる。接続設定の画面には消耗品管理の欄が無いのでリンクしない）
     6. 見出しのすぐ下に「この画面でできること」の1行がある（画面だけ・.noprint で印刷しない）
   画面の実関数（txt・mkErr・errText・errHint・apiPost・apiPing）を名前で切り出して vm で動かす。
   外部ライブラリなし・実データなし。
   実行: node check/unit/supplies_staff_words_test.js
     （読む HTML は環境変数 SPL_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.SPL_HTML || path.join(__dirname, '..', '..', 'supplies.html');
const src = fs.readFileSync(HTML, 'utf8');

function grabFn(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) { if (src[i] === '\\') i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = (e < 0) ? src.length : e + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = (e < 0) ? src.length : e; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
function grabVar(name) {
  const m = src.match(new RegExp('\\nvar ' + name + ' = (\\{[\\s\\S]*?\\n\\};|[^\\n]*;)'));
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  return m[0];
}

let ok = 0, ng = 0;
function t(label, cond, detail) {
  if (cond) ok++;
  else { ng++; process.stdout.write('  ✗ ' + label + (detail !== undefined ? ('\n    実際: ' + JSON.stringify(detail)) : '') + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

const TECH = /GAS|Supabase|JSON|トークン|token|API|HTTP|localStorage|fetch|null|undefined|TypeError|is not a function|Cannot read|supplies-calc\.js|計算モジュール/;
const visible = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/* ═══ 1. 起動時の止め・明細の止め ═══ */
group('起動時の止め・明細の止め');
{
  const m = src.match(/<div id="calcBlock">([\s\S]*?)<\/div>/);
  const block = m ? m[1] : '';
  t('1-1 起動時の止めがある', !!m);
  t('1-2 起動時の止めにファイル名・「計算モジュール」が無い', !!m && !/supplies-calc\.js|計算モジュール/.test(block), block);
  t('1-3 起動時の止めは「画面の部品を読み込めませんでした」と次にすること', /画面の部品を読み込めませんでした/.test(block) && /再読み込み/.test(block) && /管理者へ知らせて/.test(block), block);
  let bill = '';
  try { bill = grabFn('billCalcReady'); } catch (e) { bill = ''; }
  const billShown = (bill.match(/'[^'\n]*'/g) || []).join(' ');
  t('1-4 明細の止めにファイル名・「計算モジュール」が無い', !!bill && !/supplies-calc\.js|計算モジュール/.test(billShown), billShown);
  t('1-5 明細の止めは「画面の部品が古い版のままです」', /画面の部品が古い版のままです/.test(billShown), billShown);
}

/* ═══ 2〜4. 通信の口とエラーの文 ═══ */
/* 「もう入っていることがあります」の一文（反証レビューの後に足した）。前の版には無いので、ある時だけ読む */
const MAYBE = src.indexOf('\nvar MOVE_MAYBE_DONE = ') >= 0 ? [grabVar('MOVE_MAYBE_DONE')] : [];
const PARTS = [grabFn('txt'), grabFn('mkErr'), ...MAYBE, grabFn('errText'), grabFn('errHint'),
  grabVar('ADMIN_GAS_ASK'), grabVar('CFG_URL_CHECK'), grabVar('ADMIN_ACCESS_ASK'),
  grabVar('ERR_TEXT'), grabVar('ERR_HINT'), grabFn('serverErrText'), grabFn('serverErrHint'),
  grabVar('URL_OK_RE'), grabVar('MOVE_WRITERS'), grabVar('SPL_WRITE_ACTIONS'), grabVar('SPL_SESSION_RE'),
  grabFn('splHasLogin_'), grabFn('markBillStale'), grabFn('apiPost'), grabFn('apiPing')].join('\n');

function makeBox(fetchImpl, withWindow) {
  const notes = [];
  const box = {
    ST: { billStale: false },
    loadCfg: () => ({ url: 'https://example.invalid/exec', token: 'test', by: '' }),
    fetch: fetchImpl || (() => Promise.reject(new TypeError('Failed to fetch'))),
    setTimeout, clearTimeout
  };
  if (withWindow) box.window = { SUErrors: { note: (label, e, where) => notes.push([label, e && e.message, where]) } };
  vm.createContext(box);
  vm.runInContext(PARTS, box);
  box.notes = notes;
  return box;
}
async function thrown(p) { try { await p; return null; } catch (e) { return e; } }

async function run() {
  group('サーバーがうまく応答しない時');
  for (const st of [500, 404]) {
    const box = makeBox(() => Promise.resolve({ ok: false, status: st, text: () => Promise.resolve('') }), true);
    const e1 = await thrown(box.apiPost('list', {}));
    const m1 = e1 && box.errText(e1), h1 = e1 && box.errHint(e1);
    t('2-1 書き読みの口（' + st + '）の文に「HTTP」・番号が無い', !!e1 && !TECH.test(m1) && m1.indexOf(String(st)) < 0, m1);
    t('2-2 書き読みの口（' + st + '）は「サーバーがうまく応答しませんでした」', m1 === 'サーバーがうまく応答しませんでした', m1);
    if (st === 404) t('2-3 4xx は接続先の確かめ方を出す', h1 === box.CFG_URL_CHECK, h1);
    else t('2-3 5xx は通信環境を確かめる案内のまま', /通信環境/.test(h1), h1);
    const e2 = await thrown(box.apiPing());
    const m2 = e2 && box.errText(e2);
    t('2-4 接続の確認（' + st + '）の文に「HTTP」・番号が無い', !!e2 && !TECH.test(m2) && m2.indexOf(String(st)) < 0, m2);
    t('2-5 通信の失敗は記録に流さない（' + st + '）', box.notes.length === 0, box.notes);
  }
  {
    const box = makeBox(null, true);
    const e = await thrown(box.apiPost('list', {}));
    t('2-6 通信の失敗は「通信に失敗しました」のまま・記録に流さない', !!e && box.errText(e) === '通信に失敗しました' && box.notes.length === 0, [e && box.errText(e), box.notes]);
  }

  group('職員向けの文の無い例外');
  {
    const box = makeBox(null, true);
    const te = new TypeError('Cannot read properties of undefined (reading \'name\')');
    const m = box.errText(te), h = box.errHint(te);
    t('3-1 英語の例外文を出さない', !TECH.test(m) && !/[A-Za-z]{3,}/.test(m), m);
    t('3-2 「画面の中で思わぬエラーが起きました」', m === '画面の中で思わぬエラーが起きました', m);
    /* 反証レビュー: 書く操作ではサーバーが受け付けた後の描き直しで起きることがある＝押し直し・読み込み直しを勧めない */
    t('3-3 次にすることは一覧で確かめる・管理者へ知らせる（読み込み直し・押し直しを勧めない）',
      /一覧で入っているか確かめて/.test(h) && /管理者へ知らせて/.test(h) && !/再読み込み|読み込み直して|もう一度お試し/.test(h) && !TECH.test(h), h);
    t('3-4 記録（SUErrors.note）に1回残す', box.notes.length === 1 && box.notes[0][1] === te.message, box.notes);
    box.errText(te);
    t('3-5 同じ例外を2回出しても記録は1回', box.notes.length === 1, box.notes.length);
    const me = box.mkErr('ほかの端末が先に更新しました', '画面を読み直してから、もう一度やり直してください。');
    t('3-6 mkErr の文はそのまま', box.errText(me) === 'ほかの端末が先に更新しました' && box.errHint(me) === '画面を読み直してから、もう一度やり直してください。', [box.errText(me), box.errHint(me)]);
    t('3-7 mkErr の文は記録に流さない', box.notes.length === 1, box.notes.length);
    t('3-8 文字列はそのまま', box.errText('付け直せませんでした') === '付け直せませんでした');
    const nb = makeBox(null, false);
    let threw = false, mm = '';
    try { mm = nb.errText(new Error('x is not a function')); } catch (e) { threw = true; }
    t('3-9 記録の部品が無くても例外を外に出さず職員向けの文', !threw && mm === '画面の中で思わぬエラーが起きました', mm);
  }

  group('接続の確認で断られた時');
  {
    const resp = (code) => () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: false, error: code })) });
    const b1 = makeBox(resp('unauthorized'), true);
    const e1 = await thrown(b1.apiPing());
    t('4-1 表にある符号は日本語（unauthorized → 合言葉が違います）', !!e1 && b1.errText(e1) === '合言葉が違います', e1 && b1.errText(e1));
    const b2 = makeBox(resp('some_new_code'), true);
    const e2 = await thrown(b2.apiPing());
    t('4-2 表に無い符号はそのまま出さない', !!e2 && b2.errText(e2) === '接続できませんでした', e2 && b2.errText(e2));
    const b3 = makeBox(resp('constructor'), true);
    const e3 = await thrown(b3.apiPing());
    t('4-3 表の外の名前（constructor）でも「接続できませんでした」', !!e3 && b3.errText(e3) === '接続できませんでした', e3 && b3.errText(e3));
  }

  /* ═══ 4b. 出庫の記録の後の画面の中のエラー（反証レビューの指摘・二重登録を防ぐ） ═══
     apiPost は自分の失敗を必ず職員向けの文（userMsg）に包む。userMsg の無い例外が届くのは、サーバーが受け付けた後の
     描き直し（reportMoveResults・renderList 等）＝記録は入っている。読み込み直しを勧めると送り直しの控え（ST.retryMove）が消え、
     入れ直すと新しい番号で2件目になる */
  group('出庫の記録の後の画面の中のエラー');
  {
    const mkMoveBox = (apiImpl, boomAt) => {
      const states = [], els = {};
      const el = () => ({ disabled: false, value: 'x' });
      const box = {
        ST: { busy: false, retryMove: null },
        $: (id) => (els[id] || (els[id] = el())),
        addPending() {}, dropPending() {}, mergeStock() {}, syncResidentNo() {}, renderPreview() {},
        refreshStockAfterDup() { return Promise.resolve(false); }, askRepriceAfterIn() {}, renderStock() {},
        reportMoveResults() { if (boomAt === 'report') throw new TypeError("Cannot read properties of undefined (reading 'x')"); },
        renderList() { if (boomAt === 'render') throw new TypeError('renderList is not a function'); },
        moveFingerprint: (m) => 'fp:' + m.itemId, readPending: () => [{ id: 'P1', itemId: 'I1' }], cfgReady: () => true,
        toast() {}, rejectText: () => '',
        setState: (id, kind, title, detail) => states.push({ id, kind, title, detail }),
        apiPost: apiImpl, window: { SUErrors: { note() {} } }
      };
      vm.createContext(box);
      vm.runInContext([grabFn('txt'), grabFn('mkErr'), grabVar('CFG_URL_CHECK'), ...MAYBE,
        grabFn('errText'), grabFn('errHint'), grabFn('sendMoves'), grabFn('flushPending')].join('\n'), box);
      box.states = states;
      return box;
    };
    const settle = () => new Promise((r) => setImmediate(r));
    const okApi = (a, body) => Promise.resolve({ ok: true, results: body.moves.map((m) => ({ id: m.id, status: 'applied' })) });
    const mv = { id: 'MV-1', itemId: 'I1' };

    const b1 = mkMoveBox(okApi, 'report');
    b1.sendMoves([mv], true); await settle(); await settle();
    const s1 = b1.states[b1.states.length - 1] || {};
    t('4b-1 出庫の後の画面の中のエラーで「記録できませんでした」と言わない', !/記録できませんでした/.test(s1.title || ''), s1);
    t('4b-2 「記録は入っている可能性があります」と出す', /記録は入っている可能性があります/.test(s1.title || ''), s1);
    t('4b-3 読み込み直し・押し直しを勧めない', !/再読み込み|読み込み直して|もう一度お試し/.test(s1.detail || ''), s1.detail);
    t('4b-4 一覧（最近の入出庫）で確かめる案内', /最近の入出庫/.test(s1.detail || '') && /確かめて/.test(s1.detail || ''), s1.detail);
    t('4b-5 送り直しの控え（同じ番号）は残る', b1.ST.retryMove && b1.ST.retryMove.id === 'MV-1', b1.ST.retryMove);
    t('4b-6 案内に技術用語が無い', !TECH.test((s1.title || '') + (s1.detail || '')), s1);

    const b2 = mkMoveBox(() => Promise.reject(Object.assign(new Error('通信に失敗しました'), { userMsg: '通信に失敗しました', hint: '通信環境を確かめ、時間をおいてもう一度お試しください。' })), null);
    b2.sendMoves([mv], true); await settle(); await settle();
    const s2 = b2.states[b2.states.length - 1] || {};
    t('4b-7 通信の失敗は前のまま「記録できませんでした（通信に失敗しました）」', s2.title === '記録できませんでした（通信に失敗しました）', s2);

    const b3 = mkMoveBox(okApi, 'render');
    await b3.flushPending(); await settle();
    const s3 = b3.states[b3.states.length - 1] || {};
    t('4b-8 送り直しの後の画面の中のエラーで「送り直せませんでした」「控えは残してあります」と言わない',
      !/送り直せませんでした|控えは残してあります/.test((s3.title || '') + (s3.detail || '')), s3);
    t('4b-9 送り直しの後は「送れている可能性があります」と一覧で確かめる案内', /送れている可能性があります/.test(s3.title || '') && /最近の入出庫/.test(s3.detail || ''), s3);
    t('4b-10 送り直しの後も読み込み直しを勧めない', !/再読み込み|読み込み直して|開き直して|もう一度お試し/.test(s3.detail || ''), s3.detail);
  }

  /* ═══ 5. 接続先が無い時の案内 ═══ */
  group('接続先が無い時の案内');
  {
    const fn = grabFn('loadList');
    const head = fn.slice(0, fn.indexOf('ST.loading = true'));
    const MSG = '下の「設定」で、管理者から受け取った接続先URLと合言葉を入れて保存してください。';
    t('5-1 一覧の案内に何を入れるかがある', head.indexOf("'listState', 'warn', '接続先がまだ設定されていません',\n      '" + MSG + "'") >= 0, head.slice(0, 400));
    t('5-2 在庫の案内も同じ文', head.indexOf("'stockState', 'warn', '接続先がまだ設定されていません', '" + MSG + "'") >= 0, head.slice(0, 600));
    t('5-3 どちらにも「設定を開く」がある', (head.match(/'設定を開く', function \(\) \{ showScreen\('settings'\); \}/g) || []).length === 2);
    t('5-4 下のナビに「設定」がある（現場端末でも出す＝adm を付けない）', /<button type="button" data-scr="settings" id="navSettings">[^<]*<span[^>]*>[^<]*<\/span>設定<\/button>/.test(src));
    t('5-5 案内の文に技術用語が無い', !TECH.test(head.replace(/\/\*[\s\S]*?\*\//g, '').match(/'[^'\n]*'/g).join(' ')));
  }

  /* ═══ 6. この画面でできること ═══ */
  group('この画面でできること');
  {
    const i = src.indexOf('</header>');
    const after = src.slice(i, i + 400);
    const m = after.match(/<p class="purpose noprint"(?: data-su-intro-after)?>(この画面でできること：[^<]+)<\/p>/);
    t('6-1 見出しのすぐ下に「この画面でできること」の1行がある', !!m, after);
    t('6-2 印刷では消す（.noprint が @media print で隠れる）', /@media print\{[\s\S]*?\.noprint\{display:none !important\}/.test(src));
    t('6-3 1行に技術用語が無い', !!m && !TECH.test(m[1]), m && m[1]);
    t('6-4 見た目の指定（.purpose）がある', /\n\.purpose\{[^}]+\}/.test(src));
  }

  /* ═══ 7. 画面全体 ═══ */
  group('画面全体');
  {
    const shown = visible.replace(/placeholder="[^"]*"/g, '');
    t('7-1 「（HTTP 」の文が無い', shown.indexOf("（HTTP '") < 0);
    t('7-2 e.message をそのまま出す形（userMsg || message）が無い', !/\(e && e\.userMsg\) \|\| \(e && e\.message\)/.test(src));
  }

  process.stdout.write('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────\n');
  process.exit(ng ? 1 : 0);
}
run().catch((e) => { process.stdout.write('試験が止まりました: ' + (e && e.message) + '\n'); process.exit(1); });
