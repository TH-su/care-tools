/* 写しの見比べ（shadow-check）で、英語の文を画面に出さない（代表者の指示 2026-11-13・文は仮置き）。
   守りたいこと:
     A 画面へ出す所（say・msg・shbMsg・wbMsg・textContent・AI の確かめの文）に、例外の文（e.message・String(e)）・
       部品の理由（res.why）・データベースの番号（why）を jaWhy を通さずに渡していない
     B 画面へ出す所に、日本語を含まない英語の直書きの文を渡していない
     C jaWhy: 英語の例外文（Failed to fetch・Load failed・時間切れ・権限・準備がまだ・そのほか）は、英字の無い日本語の文に替え、
       元の文は su-errors の記録（note）に残す。日本語を含む文はそのまま返す
     D refusedWord: 表に無い英字の断りの印は「ほかの理由」と出し、印は記録に残す
     E AI の受け口の確かめ（aiProbeText）: 英語の断りの文・例外の名前を画面の文に入れない（状態の番号と秒は残す）
   ★画面の本物の関数を切り出して動かす。読むファイルは環境変数 SC_JS で差し替えられる（直す前の版で落ちることを確かめるため）。
   実行: node check/unit/shadow_check_ja_msg_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(process.env.SC_JS || path.join(__dirname, '..', '..', 'shadow-check.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function fn(name) {
  const i = SRC.lastIndexOf('function ' + name + '(');
  if (i < 0) return '';
  const st = SRC.lastIndexOf('\n', i) + 1;
  let d = 0, seen = false, q = null;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    const c = SRC[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && !d) return SRC.slice(st, k + 1); }
  }
  return '';
}
const JA = /[぀-ヿ㐀-鿿]/;

/* ── A・B 画面へ出す所の点検（行ごと） ── */
/* 文字列とコメントを伏せた行（かっこの対応を数えるため） */
function stripCalls(line, name) {
  // name( … ) の呼び出しを、かっこの対応を数えて丸ごと消す（文字列の中のかっこは数えない）
  let out = '', i = 0;
  while (i < line.length) {
    const k = line.indexOf(name + '(', i);
    if (k < 0 || (k > 0 && /[\w$.]/.test(line[k - 1]))) { if (k < 0) { out += line.slice(i); break; } out += line.slice(i, k + 1); i = k + 1; continue; }
    out += line.slice(i, k);
    let d = 0, q = null, j = k + name.length;
    for (; j < line.length; j++) {
      const c = line[j];
      if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '(') d++; else if (c === ')') { d--; if (!d) break; }
    }
    out += '「済」'; i = j + 1;
  }
  return out;
}
const SINK = /\b(say|msg|shbMsg|wbMsg)\(|\.textContent\s*=|\bt:\s*'|\bwarn\.push\(|\bel\('div', '(em|nm)'/;
/* 部品が作る日本語の理由（受け口の確かめ v.why・切り替え前の確かめの表 x.why）は日本語の文なので、そのまま出してよい */
const ALLOW_WHY = /\bv\.why\b|\bx\.why\b/;
const bad = [], badLit = [];
/* 文ごとに見る: 行頭が「:」「?」「+」の続きの行は、前の行につなげる（行番号は文の頭の行） */
const STMTS = [];
SRC.split('\n').forEach(function (line, n) {
  if (STMTS.length && /^\s*[:?+]/.test(line)) STMTS[STMTS.length - 1][0] += ' ' + line.trim();
  else STMTS.push([line, n]);
});
STMTS.forEach(function (st) {
  let line = st[0]; const n = st[1];
  const s = line.trim();
  if (!s || s.startsWith('/*') || s.startsWith('*') || s.startsWith('//')) return;
  // 記録（画面には出ない）の部分は除いて見る。同じ行に画面へ出す所があれば、そこは見る（反証レビューの指摘 2026-11-13）
  line = stripCalls(line, 'window.SUErrors.note');
  if (!SINK.test(line)) return;
  if (/^\s*function (say|msg|shbMsg|wbMsg)\(/.test(line) || /function \(t(, k(ind)?)?\) \{ say\(t\)/.test(line)) return;   // 出す関数そのもの・進み具合の受け渡し
  let x = stripCalls(stripCalls(line, 'jaWhy'), 'aiWhyTail');
  x = x.replace(/\/[^/\n]*\/\.test\(why\)/g, '').replace(/\bwhy === '[^']*'/g, '')   // 既知の番号の分かれ道（判定だけ）
    .replace(/typeof [\w.]+\.message === 'string'/g, '').replace(/[\w.]+\.message \?/g, '');   // 有る無しの判定だけ
  const hit = /\.message\b|String\(e\b|String\(err\b|res\.why|\+ ?why\b|: why\b|lastRefused \|\||String\([^)]*\.error\.code|String\(d\.error\b|String\(x\.refused\b|nm \|\| 'error'/.exec(x);
  if (hit && !ALLOW_WHY.test(line)) bad.push((n + 1) + ': ' + s.slice(0, 120));
  /* B 呼び出しの最初の直書きの文が、英字の語を持ち日本語を持たない */
  const m = /\b(?:say|msg|shbMsg|wbMsg)\('((?:[^'\\]|\\.)*)'/.exec(line);
  if (m && m[1] && /[A-Za-z]{3,}/.test(m[1]) && !JA.test(m[1])) badLit.push((n + 1) + ': ' + m[1].slice(0, 80));
});
t('★A 画面へ出す所に、例外の文・部品の理由・番号を jaWhy を通さずに渡していない', bad.length === 0, bad.slice(0, 12));
t('★B 画面へ出す所に、英語の直書きの文を渡していない', badLit.length === 0, badLit.slice(0, 12));

/* ── C・D jaWhy・refusedWord を動かす ── */
const notes = [];
const box = { window: { SUErrors: { note: (a, b) => notes.push([a, b]) } }, String };
vm.createContext(box);
/* JA_CHAR から jaWhy の終わりまで（文の表・種類分け・英語の連なりの見分けを含む）を1つの塊で切り出す */
const hA = SRC.indexOf('  var JA_CHAR = '), hB = SRC.indexOf('  /* 写しの断りの印');
const HELP = hA > 0 && hB > hA ? SRC.slice(hA, hB) : '';
const haveHelpers = !!(HELP && /function jaWhy\(/.test(HELP) && fn('refusedWord'));
t('jaWhy・refusedWord と文の表を切り出せる', haveHelpers);
if (haveHelpers) {
  vm.runInContext([HELP, fn('refusedWord'), fn('aiWhyTail'), fn('aiProbeText'),
    'this.__j = jaWhy; this.__r = refusedWord; this.__a = aiProbeText;'].join('\n'), box);
  const noAscii = s => typeof s === 'string' && s.length > 0 && !/[A-Za-z]{2,}/.test(s) && JA.test(s);
  const cases = [
    ['通信の失敗（Chrome）', new TypeError('Failed to fetch'), /つながりませんでした/],
    ['通信の失敗（Safari）', new TypeError('Load failed'), /つながりませんでした/],
    ['通信の失敗（Firefox）', new TypeError('NetworkError when attempting to fetch resource.'), /つながりませんでした/],
    ['時間切れ', Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }), /時間切れ/],
    ['権限（データベースの断り）', { code: '42501', message: 'permission denied for function x' }, /権限がありません/],
    ['権限（番号だけ）', '42501', /権限がありません/],
    ['準備がまだ', { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' }, /準備がまだ/],
    ['そのほかの英語', new Error('Unexpected token < in JSON at position 0'), /うまくいきませんでした/],
    ['英字の印だけ（busy）', 'busy', /うまくいきませんでした/],
    ['空', '', /うまくいきませんでした/]
  ];
  cases.forEach(function (c) {
    notes.length = 0;
    const full = box.__j('試験', c[1]);
    const noted = notes.slice();
    const short = box.__j('試験', c[1], true);
    t('★C ' + c[0] + ' → 英字の無い日本語の文（' + full + '）・短い言い方は句点なし', noAscii(full) && c[2].test(full) && noAscii(short) && !/。$/.test(short), [full, short]);
    t('★C ' + c[0] + ' → 元の文を記録に残す（1回）', noted.length === 1 && /写しの見比べ: 試験/.test(noted[0][0]), noted);
  });
  notes.length = 0;
  t('★C 日本語を含む文はそのまま返す（記録しない）', box.__j('試験', new Error('Google の応答がありません（時間切れ）')) === 'Google の応答がありません（時間切れ）'
    && box.__j('試験', '別の画面で「切り替える」が動いています。') === '別の画面で「切り替える」が動いています。' && notes.length === 0, notes);
  /* 部品が英語の元の文に日本語の前後を付けた理由（反証レビューの指摘 2026-11-13） */
  const mixed = [
    ['データベースの断り（dbWhy）', 'データベースが受け付けませんでした（TypeError: Failed to fetch）。', 'データベースが受け付けませんでした（つながりませんでした）。'],
    ['戻す途中（back）', '写しの期間には戻しました。Google への写し返しが終わっていません: Load failed　もう一度「写しの期間に戻す」を押してください。',
      '写しの期間には戻しました。Google への写し返しが終わっていません: つながりませんでした　もう一度「写しの期間に戻す」を押してください。'],
    ['後片付け（undo）', 'permission denied for function stf_op_end（Google の保存を止めたままです）', 'この操作の権限がありません（Google の保存を止めたままです）'],
    ['例外の名前だけ', '止まりました（SyntaxError）', '止まりました（うまくいきませんでした）']
  ];
  mixed.forEach(function (c) {
    notes.length = 0;
    const r = box.__j('試験', c[1]);
    t('★C 混ざった文（' + c[0] + '）→ 英語の連なりだけを日本語にする', r === c[2], r);
    t('★C 混ざった文（' + c[0] + '）→ 元の文を記録に残す（1回）', notes.length === 1 && notes[0][1] === c[1], notes);
  });
  notes.length = 0;
  const keep = ['Google の名簿に訪問日がありません（入居者マスタの GAS が古い可能性）。', 'データベースが受け付けませんでした（P0001）。',
    '受け付けませんでした（busy）。', 'Google Drive へ写し返しています。', 'Supabase（本番）の印は KV_SWITCHED_FAMILIES から外してください。'];
  t('★C 1語の名前・番号・英字1語の印は残す（記録しない）', keep.every(k => box.__j('試験', k) === k) && notes.length === 0, keep.map(k => box.__j('試験', k)));
  /* 権限の番号の判定を絞る（反証レビューの指摘 2026-11-13） */
  t('★C 「position 401」は権限にしない', /うまくいきませんでした/.test(box.__j('試験', new Error('Unexpected token at position 401'))));
  const den = ['401', '403', 'status 401', 'HTTP/1.1 403 Forbidden', 'Request failed with status: 403'];
  t('★C 番号だけ・status 401・HTTP 403 は権限', den.every(x => /権限がありません/.test(box.__j('試験', x))), den.map(x => box.__j('試験', x)));
  notes.length = 0;
  t('★D 表にある印は表の言葉', box.__r({ shrink: '急に減った' }, 'shrink', '試験') === '急に減った' && notes.length === 0);
  t('★D 表に無い英字の印は「ほかの理由」・印は記録に残す', box.__r({ shrink: '急に減った' }, 'weird_code', '試験') === 'ほかの理由' && notes.length === 1 && notes[0][1] === 'weird_code', notes);
  t('★D 印が無い時は空（今までと同じ）', box.__r({}, '', '試験') === '');

  /* E AI の受け口の確かめ */
  (async function () {
    const ascii = s => /[A-Za-z]{3,}/.test(String(s.replace(/AI/g, '')));
    const r1 = await box.__a({ error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } }, 3);
    t('★E 受け口に届かない時: 例外の名前・英語の文を出さない・秒は出す', !ascii(r1.t) && /3秒/.test(r1.t) && /つながりませんでした/.test(r1.t), r1.t);
    const r2 = await box.__a({ error: { name: 'FunctionsRelayError', message: 'Relay Error invoking the Edge Function' } }, 4);
    t('★E 中継で止まった時: 英語の文を出さない', !ascii(r2.t) && /中継で止まりました（4秒）/.test(r2.t), r2.t);
    const r3 = await box.__a({ error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 403, json: () => Promise.resolve({ error: 'forbidden' }) } } }, 2);
    t('★E 受け口が断った時: 状態の番号と秒は出し、英語の断りの文は出さない', !ascii(r3.t) && /状態 403・2秒/.test(r3.t), r3.t);
    const r4 = await box.__a({ error: { name: 'FunctionsHttpError', message: 'x', context: { status: 429, json: () => Promise.resolve({ error: '使える回数を超えました' }) } } }, 2);
    t('★E 受け口の断りの文が日本語ならそのまま添える', /状態 429・使える回数を超えました・2秒/.test(r4.t), r4.t);
    const r5 = await box.__a({ data: { ok: false, error: 'not_allowed' } }, 1);
    t('★E 受け口が ok:false で英字の印を返した時: 印を出さない', !ascii(r5.t) && /断られました（1秒）/.test(r5.t), r5.t);
    done();
  })().catch(function (e) { fail++; console.log('  ✗ 例外: ' + (e && e.stack || e)); done(); });
} else done();

function done() {
  console.log('────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
}
