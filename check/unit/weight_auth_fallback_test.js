/* weight-record.html の「合言葉まわりの経路選択とエラー表示」の検証。
   HTML から対象関数だけを切り出して eval する（写経しない＝実物を試す）。

   2026-08-13 の実害から作った回帰テスト。守りたいのは3点:
   1. 合言葉を持つ端末を、合言葉を載せられない GET へ落とさない
      （落ちた先が100%失敗する＝フォールバックとして成立していない）
   2. かといって、本当に旧サーバー（版1へ戻した時）へは POST を投げない
      （手順書が保証する「デプロイを1つ前へ戻せばアプリを触らず復帰できる」を壊さない）
   3. 同じ unauthorized でも原因は3つある。文言を分けないと現場が切り分けられない

   対象HTMLは環境変数 WEIGHT_HTML で差し替えられる（worktree で検証するため）。 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = process.env.WEIGHT_HTML || path.join(__dirname, '..', '..', 'weight-record.html');
const src = fs.readFileSync(HTML, 'utf8');

/* 対象関数だけを名前で抜き出す。async 付きの関数は `async` ごと持ち出す
   （落とすと本体の await が構文エラーになる）。 */
function cut(name) {
  let head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('関数が見つからない: ' + name);
  if (src.slice(Math.max(0, head - 6), head) === 'async ') head -= 6;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  throw new Error('関数の終端が見つからない: ' + name);
}

// ── 依存の最小モック ──
let calls = [];
let responses = [];              // 応答を順に差し込む。空なら { ok:true }
let probeResult = null;          // apiProbe が観測に成功した時に入れる apiCaps（null＝観測失敗）
let probeCount = 0;
global.apiUrl = 'https://script.google.com/macros/s/TEST/exec';
global.apiToken = '';
global.apiCaps = { ver: 0, caps: [], authRequired: false, seen: false };
global.apiCan = (cap) => apiCaps.seen && apiCaps.caps.indexOf(cap) >= 0;
global.fetchTO = (url, opts) => { calls.push({ url, opts: opts || {} }); return Promise.resolve({ __mock: true }); };
global._parseApiResponse = () => Promise.resolve(responses.length ? responses.shift() : { ok: true });
/* 実物の apiProbe は疎通確認を1回投げて apiCaps を書き換える。ここでは
   「観測できた／できなかった」の2通りだけを再現する（通信は上の fetchTO が担う範囲外）。 */
global.apiProbe = () => { probeCount++; if (probeResult) global.apiCaps = probeResult; return Promise.resolve(global.apiCaps); };

global.$ = () => null;           // apiDiagnose は入力欄を見に行く。テストでは常に「欄なし」＝保存済みの値を使う

/* 個人データの形跡を見る正規表現は【実物から読み取る】。テスト側に書き写すと、
   本体の式を緩めた時にテストが気づかなくなる。 */
const mRe = src.match(/var\s+_RE_PERSONAL_BODY\s*=\s*(\/[^\n]*\/[a-z]*)\s*;/);
if (!mRe) throw new Error('_RE_PERSONAL_BODY が見つからない');
global._RE_PERSONAL_BODY = eval(mRe[1]);

(0, eval)(cut('_stripBom'));
(0, eval)(cut('_safeBodyPreview'));
(0, eval)(cut('apiGet'));
(0, eval)(cut('apiFriendlyError_'));
(0, eval)(cut('_classifyApiError'));
(0, eval)(cut('apiDiagnose'));
/* _parseApiResponse は apiGet 用にモックしてあるので、実物は別名で持つ（差し替えない）。 */
const realParse = eval('(' + cut('_parseApiResponse') + ')');

// ── テスト基盤 ──
let pass = 0, fail = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; failures.push(`${label}\n    期待: ${e}\n    実際: ${a}`);
}
function ok(cond, label) { eq(!!cond, true, label); }

function setup(token, seen, caps) {
  calls = [];
  responses = [];
  probeResult = null;
  probeCount = 0;
  global.apiToken = token;
  global.apiCaps = { ver: seen ? 2 : 0, caps: caps || [], authRequired: false, seen: !!seen };
}
const last = () => calls[calls.length - 1];
const method = () => (last().opts.method || 'GET');
const bodyOf = () => JSON.parse(last().opts.body || '{}');

(async function run() {

  /* ── 1. 観測できていない × 合言葉あり → POST（今回の実害の本体）── */
  setup('secret', false, []);
  await apiGet();
  eq(method(), 'POST', '1-1 合言葉を持ち、サーバーを観測できていない時は POST で送る');
  eq(bodyOf().token, 'secret', '1-2 合言葉を載せる');
  eq(last().url.indexOf('?action=getAll'), -1, '1-3 合言葉をURLに載せない');

  /* ── 2. 観測できていない × 合言葉なし → 従来どおり GET ── */
  setup('', false, []);
  await apiGet();
  eq(method(), 'GET', '2-1 合言葉が無ければ従来どおり GET');
  ok(last().url.indexOf('?action=getAll') > 0, '2-2 GET はクエリで action を渡す');

  /* ── 3. 観測できた × postGetAll あり → POST（従来どおり）── */
  setup('secret', true, ['fieldMerge', 'postGetAll']);
  await apiGet();
  eq(method(), 'POST', '3-1 対応を観測できていれば POST');
  eq(bodyOf().token, 'secret', '3-2 合言葉を載せる');

  /* ── 4. 観測できた × postGetAll なし → GET（版1へ戻した時の復帰路を壊さない）──
     ここを POST にすると旧サーバーが unknown action で落ち、
     「デプロイを1つ前へ戻せばアプリを触らず復帰できる」という手順書の保証が崩れる。 */
  setup('secret', true, []);
  await apiGet();
  eq(method(), 'GET', '4-1 旧サーバーと観測できた時は、合言葉があっても GET へ落とす');

  /* ── 5. 観測できた × postGetAll あり × 合言葉なし ── */
  setup('', true, ['postGetAll']);
  await apiGet();
  eq(method(), 'POST', '5-1 合言葉が無くても POST 取得は使う');
  eq(bodyOf().token, undefined, '5-2 未設定の合言葉は送らない（移行中のサーバーは素通しする）');

  /* ── 6. URL 未設定なら何も送らない ── */
  calls = [];
  global.apiUrl = '';
  eq(await apiGet(), null, '6-1 URL 未設定は null を返す');
  eq(calls.length, 0, '6-2 URL 未設定では通信しない');
  global.apiUrl = 'https://script.google.com/macros/s/TEST/exec';

  /* ── 7. unauthorized の原因を3つに書き分ける ── */
  setup('', true, ['postGetAll']);
  ok(/保存されていません/.test(apiFriendlyError_('Error: unauthorized')), '7-1 合言葉が未保存の端末には保存操作を促す');
  ok(/URLを保存・接続/.test(apiFriendlyError_('Error: unauthorized')), '7-2 押すボタンまで書く（入力だけでは保存されないため）');
  setup('secret', false, []);
  ok(/確認できない/.test(apiFriendlyError_('Error: unauthorized')), '7-3 サーバー未観測なら再読み込みへ誘導する');
  setup('secret', true, ['postGetAll']);
  ok(/一致しません/.test(apiFriendlyError_('Error: unauthorized')), '7-4 観測できて合言葉もあるなら「値の不一致」と言い切る');
  ok(/空白/.test(apiFriendlyError_('Error: unauthorized')), '7-5 いちばん多い原因（前後の空白）を名指しする');
  eq(apiFriendlyError_('HTTP 500: boom'), 'HTTP 500: boom', '7-6 知らないエラーは翻訳せずそのまま出す');
  eq(apiFriendlyError_(null), '', '7-7 空でも落ちない');
  /* 現場端末（2026-09-24〜 記録可）では設定画面も接続設定も開けない＝行けない先を案内しない */
  global.wrIsField = () => true;
  setup('', true, ['postGetAll']);
  ok(/事務所に連絡/.test(apiFriendlyError_('Error: unauthorized')) && !/「設定」/.test(apiFriendlyError_('Error: unauthorized')), '7-8 現場端末で合言葉が無い時は事務所へ（開けない設定画面を指さない）');
  setup('secret', true, ['postGetAll']);
  ok(/事務所に連絡/.test(apiFriendlyError_('Error: unauthorized')), '7-9 現場端末で合言葉が違う時も事務所へ');
  setup('secret', false, []);
  ok(/確認できない/.test(apiFriendlyError_('Error: unauthorized')), '7-10 現場端末でも未観測なら再読み込みへ（端末で直せる）');
  delete global.wrIsField;

  /* ── 9. 推測でPOSTを選ぶ前に、もう一度だけ観測する（レビュー指摘・中1）── */
  setup('secret', false, []);
  probeResult = { ver: 0, caps: [], authRequired: false, seen: true };   // 観測できた＝版1と判明
  await apiGet();
  eq(probeCount, 1, '9-1 未観測かつ合言葉ありなら、送る前にもう一度観測する');
  eq(method(), 'GET', '9-2 観測の結果が版1なら GET へ落とす（復帰路を壊さない）');

  setup('secret', true, ['postGetAll']);
  await apiGet();
  eq(probeCount, 0, '9-3 観測済みなら余計な疎通確認を挟まない');

  setup('', false, []);
  await apiGet();
  eq(probeCount, 0, '9-4 合言葉が無ければ従来どおり（観測もPOSTもしない）');

  /* ── 10. 賭けが外れた時は GET で取り直す（版1へ戻した端末の復帰路）──
     観測できないまま POST に賭けて、相手が版1だった場合。版1は getAll を知らないので
     unknown action を返す（書き込みは起きない）。ここで GET へ取り直せないと、
     手順書の「デプロイを1つ前へ戻せばアプリを触らず復帰する」が成り立たなくなる。 */
  setup('secret', false, []);
  probeResult = null;                                        // 観測できないまま
  responses = [
    { ok: false, error: 'Error: unknown action: getAll' },    // ① 投機POSTへの版1の答え
    { residents: [{ id: 'r1' }], records: [] }                // ② GETで取り直した結果
  ];
  const got = await apiGet();
  eq(calls.length, 2, '10-1 POST が外れたら、もう1回だけ取りに行く');
  eq(calls[0].opts.method, 'POST', '10-2 1回目は投機のPOST');
  eq((calls[1].opts.method || 'GET'), 'GET', '10-3 2回目は GET');
  ok(calls[1].url.indexOf('?action=getAll') > 0, '10-4 GET はクエリで action を渡す');
  eq((got.residents || []).length, 1, '10-5 取り直した結果を返す（同期が成立する）');
  eq(apiCaps.seen, true, '10-6 以後は版1と確定して扱う（毎回2往復しない）');
  eq(apiCaps.caps, [], '10-7 部分送信の対応も取り下げる＝行全体の送信に戻る');

  /* unauthorized は「版1だった」ではないので、取り直さずそのまま返す（合言葉の問題を隠さない）。 */
  setup('secret', false, []);
  probeResult = null;
  responses = [{ error: 'Error: unauthorized' }];
  const un = await apiGet();
  eq(calls.length, 1, '10-8 unauthorized では取り直さない');
  eq(un.error, 'Error: unauthorized', '10-9 合言葉のエラーはそのまま呼び出し元へ返す');

  /* ── 8. 404 は本文がHTMLでも「アクセス権」と言わない（誤誘導の除去）── */
  const htmlBody = '<!DOCTYPE html><html lang="ja"><head><script>window["ppConfig"]={}</script></head></html>';
  ok(/404/.test(_classifyApiError(404, htmlBody)), '8-1 404+HTML は 404 として案内する');
  ok(!/アクセス権/.test(_classifyApiError(404, htmlBody)), '8-2 404 で権限設定を触らせない');
  ok(/アクセス権/.test(_classifyApiError(200, '<html>… accounts.google.com/ServiceLogin …</html>')), '8-3 ログインへの誘導は従来どおり権限エラーと判定する');
  ok(/アクセス権/.test(_classifyApiError(403, '<html>… sign in …</html>')), '8-4 403+ログイン画面も従来どおり');
  eq(_classifyApiError(200, '{"ok":true}'), null, '8-5 正常な JSON は分類しない');

  /* ── 11. 接続診断が応答本文に氏名を出さない（個人情報・2026-08-13）──
     診断は getAll を投げるので、成功応答をそのまま出すと入居者の氏名・居室が画面に載る。
     同期に失敗すると診断は自動で走るため、表示機会は少なくない。 */
  const diagWith = (status, body) => {
    global.fetchTO = () => Promise.resolve({ status, text: () => Promise.resolve(body) });
    return apiDiagnose('https://script.google.com/macros/s/TEST/exec');
  };
  const savedFetch = global.fetchTO;
  setup('secret', true, ['postGetAll']);

  const okBody = JSON.stringify({
    residents: [{ id:'r1', name:'架空 太郎', room:'101' }, { id:'r2', name:'架空 花子', room:'102' }],
    records: [{ id:'rec1', kg: 52.3 }], thresholds: { lo: 2 }, ver: 2
  });
  let d = await diagWith(200, okBody);
  const joined = d.lines.join('\n');
  eq(d.ok, true, '11-1 正常な応答は診断成功として扱う');
  ok(joined.indexOf('架空') < 0, '11-2 応答本文の氏名を画面に出さない');
  ok(joined.indexOf('101') < 0, '11-3 居室も出さない');
  ok(/residents 2件/.test(joined), '11-4 代わりに件数を出す（切り分けにはこれで足りる）');
  ok(/records 1件/.test(joined), '11-5 records も件数で出す');
  ok(joined.indexOf('本文の先頭') < 0, '11-6 自分たちのJSONなら生の本文行を出さない');

  /* JSON として読めない応答（ログイン画面・エラーページ）は、原因究明に本文そのものが要る。
     ここには入居者データは入らないので従来どおり出す。 */
  d = await diagWith(200, '<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head></html>');
  const joined2 = d.lines.join('\n');
  eq(d.ok, false, '11-7 HTML応答は失敗として扱う');
  ok(/本文の先頭/.test(joined2), '11-8 JSONでない時は従来どおり本文の先頭を出す（原因究明に要る）');
  ok(/アクセス権/.test(joined2), '11-9 ログイン画面は権限エラーとして案内する');

  /* ★JSON として読めない【壊れた】応答こそ本文を出す側に落ちる。中身が個人データなら
     読めなくても出してはいけない（2026-08-13 レビュー指摘・高1）。 */
  d = await diagWith(200, '﻿' + okBody);                    // BOM 付き（parse が失敗する）
  const bom = d.lines.join('\n');
  ok(bom.indexOf('架空') < 0, '11-12 BOM付きの応答でも氏名を出さない');
  ok(/表示しません/.test(bom), '11-13 出さなかったことを画面に明示する');

  d = await diagWith(200, okBody.slice(0, 60));                  // 途中で切れた応答
  const cut2 = d.lines.join('\n');
  ok(cut2.indexOf('架空') < 0, '11-14 途中で切れた応答でも氏名を出さない');

  /* 自分たちの形でないJSON。要約に入れると無意味な行になるので本文側へ回すが、
     その本文に氏名が含まれていれば同じくガードが効くこと。 */
  /* 既知の限界を明示的に固定しておく: 裸のJSON文字列（例 "架空 太郎"）は
     `"name":` のような形跡を持たないため本文側に出る。体重GASはこの形を返さないので
     実害は無いが、「ガードは形跡ベース＝万能ではない」ことをテストで見えるようにしておく。 */
  d = await diagWith(200, '"API ready"');
  ok(/本文の先頭/.test(d.lines.join('\n')), '11-15 裸のスカラーJSONは要約でなく本文側へ回る（構造の性質だけを固定する）');
  d = await diagWith(200, JSON.stringify([{ name: '架空 太郎' }]));
  const arr = d.lines.join('\n');
  ok(!/residents — \/ records —/.test(arr), '11-16 配列を「件数の要約」に入れない（無意味な行を作らない）');
  ok(arr.indexOf('架空') < 0, '11-17 配列で来た個人データも出さない');

  /* 合言葉が違う時。error は出すが、これは個人情報ではない。 */
  d = await diagWith(200, JSON.stringify({ error: 'Error: unauthorized' }));
  const joined3 = d.lines.join('\n');
  eq(d.ok, false, '11-10 unauthorized は失敗として扱う');
  ok(/エラー Error: unauthorized/.test(joined3), '11-11 サーバーのエラー内容は要約行に残す');

  global.fetchTO = savedFetch;

  /* ── 12. 同期失敗のトースト・接続状態欄に氏名を出さない（レビュー指摘・高2）──
     _parseApiResponse は「JSONとして読めない応答」の本文を例外メッセージへ埋めており、
     syncFromAPI の catch がそれをトーストと接続状態欄に出す。診断より【先に】画面へ出る。 */
  const resp = (status, body, okFlag) => ({
    status, ok: okFlag !== undefined ? okFlag : (status >= 200 && status < 300),
    statusText: 'x', text: () => Promise.resolve(body)
  });
  async function parseErr(status, body, okFlag){
    try{ await realParse(resp(status, body, okFlag)); return null; }
    catch(e){ return e.message; }
  }
  /* ★BOM 付きは【例外にならない】のが正しい姿（レビュー指摘・中3 の修正後）。
     以前は parse に失敗して「JSONではありません」＋本文つきで落ちていた。
     いまは BOM を落としてから読むので、同期はそのまま成立する。 */
  const bomOk = await realParse(resp(200, '﻿' + okBody));
  eq((bomOk.residents || []).length, 2, '12-1 BOM付きでも同期が成立する（例外にしない）');
  eq(await parseErr(200, '﻿' + okBody), null, '12-2 したがって例外メッセージ自体が発生しない');
  let m = await parseErr(200, okBody.slice(0, 60));
  ok(m && m.indexOf('架空') < 0, '12-3 途中で切れた応答でも氏名を入れない');
  /* HTTPエラー側の分岐。有効なJSONは例外にならずそのまま返るので、この分岐に入るのは
     【読めない】本文だけ。★400 を使う。500・401・403・404 は _classifyApiError が
     先に拾うため、目的の `HTTP xxx: 本文` 分岐に一度も入らない（レビュー指摘・低4）。 */
  m = await parseErr(400, '{"residents":[{"name":"架空 太郎"}');
  ok(m && m.indexOf('架空') < 0, '12-4 HTTPエラー側の分岐も同じくガードする');
  ok(m && /HTTP 400/.test(m), '12-6 ステータスは残す（切り分けに要る）');
  /* 低1: 本文が空の時は statusText へフォールバックできること
     （_safeBodyPreview が '（空）' を返すとこの経路が死ぬ）。 */
  m = await parseErr(400, '');
  ok(m && /Bad|応答なし|x/.test(m), '12-7 本文が空なら statusText 等へフォールバックする');
  /* 低2: HTML は伏せない（原因究明に本文が要る。入居者データは載らない）。
     ★_parseApiResponse 経由だと _classifyApiError が先に定型文を返すので、
       ガード本体を直接呼んで確かめる。 */
  ok(/name/.test(_safeBodyPreview('<html><script>var a={"name":"foo"};</script></html>', 140)),
     '12-8 HTMLの本文はガードしない（誤爆させない）');
  ok(/表示しません/.test(_safeBodyPreview('{"residents":[{"name":"架空 太郎"}]}', 140)),
     '12-9 我々のJSONの形跡があれば伏せる');
  eq(_safeBodyPreview('', 140), '', '12-10 空本文は空文字（呼び出し側のフォールバックを殺さない）');
  ok(/表示しません/.test(_safeBodyPreview('{"roster":[{"name":"架空 太郎"}]}', 140)),
     '12-11 代理名簿の形（roster）も伏せる');
  m = await parseErr(200, 'not json at all');
  ok(m && /not json at all/.test(m), '12-5 個人データの形跡が無い本文は従来どおり出す（原因究明に要る）');

  // ── 結果 ──
  console.log(`\nweight-record 合言葉の経路とエラー表示  pass ${pass} / fail ${fail}`);
  if (fail) { console.log('\n失敗:\n' + failures.map(f => '  ✖ ' + f).join('\n')); process.exit(1); }
})();
