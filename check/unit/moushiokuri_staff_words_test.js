/* moushiokuri_staff_words_test.js — 申送ビューア：職員に見える文から技術の言葉を減らす（2026-11-02 品質改善 便6）
 *
 * 確かめること
 *   1. 言い換えた文の古い形（GAS・デプロイ・/exec を職員に見せる形）が残っていない
 *   2. 言い換えた後の文があり、技術の言葉を含まない
 *   3. apiErrMsg を vm で動かす: 印（NO_CFG・GAS_LOGIN・GAS_BAD_RESPONSE・API:）ごとに新しい文を返し、技術の言葉を出さない
 *      （印の名前そのものは送り直しの試験 msk_api_retry_test が照合しているので変えていない）
 *   4. 接続が無い時の案内: 設定タブの「はじめて使う時」に接続設定（connection-settings.html）へのリンクがあり、
 *      未設定の時の断り（NO_CFG）がその案内を指している。現場の端末は画面全体の覆い（#block）で止まる
 *   5. 排便記録の接続が無い時の案内（excCfgNotice）に接続設定へのリンクがある（前からある・消されないように）
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html');
const S = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(JSON.stringify(info)).slice(0, 600))); }
}
function grabFn(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) return '';
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const TECH = /GAS|トークン|token|JSON|Supabase|HTTP|API|Apps Script|デプロイ|スクリプトプロパティ|Web App|ウェブアプリ|\/exec|undefined|null/;

console.log('\n【1】古い形が残っていない');
[
  '下の欄に GAS の URL と合言葉を入れて',
  '<label for="cfgUrl">GAS ウェブアプリ URL</label>',
  "'接続先が未設定です。「設定」タブで登録してください'",
  'GAS のアクセス権が「全員」になっていない可能性があります',
  'GAS から想定外の応答が返りました。デプロイURLを確認してください',
  "'サーバー側でエラーが発生しました'",
  'GAS を新しい版で再デプロイしてください',
  '（/exec で終わる必要があります）'
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));

console.log('\n【2】言い換えた後の文がある（技術の言葉を含まない）');
const NEW = [
  ['はじめて使う時の手順2', '控えが無い時は、下の欄に Google の受け口の URL と合言葉を入れて「保存」を押します。'],
  ['設定タブの URL 欄の見出し', '<label for="cfgUrl">接続先の URL（Google の受け口）</label>'],
  ['接続先が無い時', '接続先と合言葉が入っていません。「設定」タブの「はじめて使う時」の手順で入れてください'],
  /* 2026-11-13（代表者の指示）: 受け口の公開の設定・URL を職員に見せない文に改めた。古い文は下の【1b】で残っていないことを確かめる */
  ['ログインを求められた時', '申し送りの Google の受け口から、ログインを求める画面が返りました。接続先の設定が古くなっているかもしれません。管理者に連絡してください'],
  ['思っていた形と違う返事', '申し送りの Google の受け口から、思っていた形と違う返事が届きました。接続先が古くなっているかもしれません。「設定」タブの接続先が正しいか確かめてください'],
  ['受け口で問題が起きた時', '申し送りの Google の受け口で問題が起きました。しばらくしてからもう一度お試しください'],
  ['取込状況を返さない古い版', '申し送りの Google の受け口が古い版のため、取り込みの状況が分かりません。管理者に受け口の更新を頼んでください'],
  ['URL の形が違う時', 'URL の形が違います。管理者から受け取った Google の受け口の URL を、最後まで貼ってください']
];
NEW.forEach(([name, w]) => {
  t(name + ': 文がある', S.indexOf(w) >= 0, w);
  /* 見出しのタグ・例の URL の形は文の一部ではないので外して見る */
  const words = w.replace(/<[^>]+>/g, '').replace(/https:\/\/script\.google\.com\/macros\/s\//g, '');
  t(name + ': 技術の言葉が無い', !TECH.test(words), words);
});

console.log('\n【1b】2026-11-13 古い形が残っていない');
[
  '受け口の公開の設定が「全員」になっているか',
  '「設定」タブの URL が正しいか確かめてください'
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));
t('思っていた形と違う返事の文は2か所（印の時と返事が崩れた時）で同じ', S.split("'" + NEW[4][1] + "'").length - 1 === 2);

console.log('\n【1c】2026-11-13 読み取りの関数の名前は apiRead（中身は POST の読み取り）');
t('apiRead・apiReadOnce がある', /\nfunction apiRead\(/.test(S) && /\nfunction apiReadOnce\(/.test(S));
t('apiGet の名前で呼んでいる所が残っていない（改めた経緯の注記は除く）', !/\bapiGet(Once)?\(/.test(S));

console.log('\n【3】apiErrMsg を動かす');
const fnSrc = grabFn(S, 'apiErrMsg');
t('apiErrMsg がある', !!fnSrc);
const box = {};
vm.createContext(box);
vm.runInContext(fnSrc, box);
const call = m => box.apiErrMsg(new Error(m));
const cases = [
  ['NO_CFG', NEW[2][1]],
  ['GAS_LOGIN', NEW[3][1]],
  ['GAS_BAD_RESPONSE', NEW[4][1]],
  ['API:何かの断り', NEW[5][1]],
  ['API:認証エラー', '合言葉が違います。「設定」タブで確認してください']
];
cases.forEach(([m, want]) => {
  const got = call(m);
  t(m + ' → 職員向けの文', got === want, got);
  t(m + ' → 技術の言葉を出さない', !TECH.test(got), got);
});
/* 後ろに「「読み込み」をもう一度押してください」が付く所（rgStaleInto）へ埋め込むので、文の終わりに「。」を付けない */
cases.forEach(([m]) => { const got = call(m); t(m + ' → 文の終わりに「。」を付けない', !/。$/.test(got), got); });
t('印の名前は変えていない（送り直しの試験が照合している）',
  ["throw new Error('GAS_LOGIN')", "throw new Error('GAS_BAD_RESPONSE')", "new Error('API:' + o.error)", "new Error('NO_CFG')"].every(w => S.indexOf(w) >= 0));

console.log('\n【4】接続が無い時の案内');
const gm = /<div[^>]*id="cfgGuide"[^>]*>([\s\S]*?)<\/ol>\s*<\/div>/.exec(S);
const guide = gm ? gm[1] : '';
t('はじめて使う時の案内に接続設定へのリンクがある', /<a\s+href="connection-settings\.html">接続設定<\/a>/.test(guide));
t('案内の見出しの名前が、断りの文が指す名前と同じ（「はじめて使う時」）', S.indexOf('はじめて使う時（3ステップ）') >= 0 && NEW[2][1].indexOf('「はじめて使う時」') >= 0);
t('未設定で開いた時は設定タブへ移り、案内を出す（ログインだけで読めると確かめられた端末を除く・2026-11-08）',
  /function mskNoCfg_\(\)\{\s*goto\('scr-cfg', false\);/.test(S) && /if\(!cfg\.url \|\| !cfg\.token\)\{[\s\S]{0,400}if\(!hoLive\)\{ mskNoCfg_\(\);/.test(S) && S.indexOf('mskGuide_();') >= 0);
t('現場の端末は画面全体を覆って止める（接続設定へは案内しない）',
  S.indexOf("var blocked = (lsGet(ROLE_KEY) === 'field');") >= 0 && S.indexOf('申送ビューアは事務所端末専用です。') >= 0);

console.log('\n【5】排便記録の接続が無い時の案内（前からある）');
const exc = grabFn(S, 'excCfgNotice');
t('excCfgNotice に接続設定へのリンクがある', exc.indexOf("a.href = 'connection-settings.html'") >= 0 && exc.indexOf("'接続設定を開く'") >= 0);

/* ══ 便7（2026-11-02）: 残っていた技術の言葉・英語の失敗の文の分け方・「?」の説明 ══ */
const TECH7 = /GAS|サーバー|スプレッドシート|想定外|タイムアウト|JSON|HTTP|API|token|Failed|TypeError|undefined|null/;
console.log('\n【6】便7 古い形が残っていない');
[
  "'排便記録のサーバーが読み取りを受け付けませんでした。",
  "'排便記録のサーバーから想定外の応答が返りました。'",
  "'排便記録のサーバーから' + (EXC_TIMEOUT_MS / 1000)",
  "return '通信がタイムアウトしました';",
  '申し送りスプレッドシートの記録を',
  "brk = '（サーバー '",
  "'⚠️ 直近の自動取込で失敗がありました: ' + VM.fails",
  "info += '／失敗: ' + String(r.fails)"
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));

console.log('\n【7】便7 言い換えた後の文がある');
const NEW7 = [
  ['この画面について', '申し送りシートの記録を、入居者ごとにまとめて表示します。'],
  ['読み込み時間の内訳', "brk = '（受け口 '"],
  ['バイタルの取込の失敗', "'⚠️ 直近の自動取込で失敗がありました。続くようなら管理者へ連絡してください（詳しい内容は「設定」タブの「接続テスト」で出ます）。'"],
  ['接続テストの失敗の中身は管理者向けと書く', "info += '／取込の失敗（管理者向けの詳しい内容）: ' + String(r.fails)"],
  ['「?」の説明', '「?」＝申し送りシートに書いてあるのに、数字として読めなかった所です（原本を確かめてください）。']
];
NEW7.forEach(([name, w]) => t(name + ': 文がある', S.indexOf(w) >= 0, w));
t('バイタルの帯に失敗の符号（VM.fails）をそのまま出さない', !/textContent\s*=[^;]*VM\.fails/.test(S));

/* apiErrMsg・excErrMsg を、記録（SUErrors.note）を差し替えた箱で動かす */
function runner(fnName, extra) {
  const notes = [];
  const box = { SUErrors: { note: (k, e, w) => notes.push([k, w]) }, EXC_TIMEOUT_MS: 30000 };
  vm.createContext(box);
  vm.runInContext(grabFn(S, fnName), box);
  return (e) => { notes.length = 0; const msg = box[fnName](e); return { msg, noted: notes.length }; };
}
function errOf(name, message) { const e = new Error(message); e.name = name; return e; }
console.log('\n【8】apiErrMsg の英語の失敗の分け方');
{
  const run = runner('apiErrMsg');
  const net = ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'network error', 'Error in body stream', 'The network connection was lost.'];
  net.forEach(m => {
    const r = run(errOf('TypeError', m));
    t('通信の失敗「' + m + '」→ 通信の文・記録しない', r.msg === '読み込みに失敗しました。通信環境を確認してください' && r.noted === 0, r);
  });
  let r = run(errOf('AbortError', 'The user aborted a request.'));
  t('時間切れ → 時間内に返事が無い文・記録しない', r.msg === '時間内に返事がありませんでした。通信状況を確かめてください' && r.noted === 0, r);
  r = run(errOf('SyntaxError', 'Unexpected token < in JSON at position 0'));
  t('返事の形が崩れている → 受け口の設定の文・記録しない', /思っていた形と違う返事/.test(r.msg) && r.noted === 0, r);
  r = run(errOf('TypeError', "Cannot read properties of undefined (reading 'x')"));
  t('画面の中のエラー → 読み込み直しの文・記録に残す', r.msg === '画面の中で思わぬエラーが起きました。画面を読み込み直してください' && r.noted === 1, r);
  r = run(errOf('Error', 'Something odd'));
  t('ほかの英語の文 → 一般の文・記録に残す', r.msg === '読み込めませんでした。しばらくしてからもう一度お試しください' && r.noted === 1, r);
  r = run(new Error('API:認証エラー'));
  t('日本語の断り（合言葉違い）は記録しない', r.noted === 0, r);
  ['Failed to fetch', 'x', 'Unexpected token'].forEach(m => {
    const g = run(errOf(m === 'x' ? 'RangeError' : (m === 'Unexpected token' ? 'SyntaxError' : 'TypeError'), m)).msg;
    t('出す文に技術の言葉・英語が無い（' + m + '）', !TECH7.test(g), g);
  });
}
console.log('\n【9】excErrMsg の英語の失敗の分け方');
{
  const run = runner('excErrMsg');
  let r;
  ['Failed to fetch', 'network error', 'Error in body stream'].forEach(m => {
    r = run(errOf('TypeError', m));
    t('通信の失敗「' + m + '」→ 通信の文・記録しない', r.msg === '排便記録を読み込めませんでした。通信状況を確認して「読み込み」を押してください。' && r.noted === 0, r);
  });
  r = run(new Error('EXC_HTTP'));
  t('EXC_HTTP → 接続設定を確かめる文・記録しない', /返事を読めませんでした/.test(r.msg) && /接続設定/.test(r.msg) && r.noted === 0, r);
  r = run(new Error('EXC_FORMAT'));
  t('EXC_FORMAT → 思っていた形と違う返事・記録しない', /思っていた形と違う返事/.test(r.msg) && r.noted === 0, r);
  r = run(new Error('EXC_REFUSED'));
  t('EXC_REFUSED → 受け付けなかった文・記録しない', /受け付けませんでした/.test(r.msg) && r.noted === 0, r);
  r = run(new Error('EXC_AUTH'));
  t('EXC_AUTH → 合言葉の文（前のまま）・記録しない', r.msg === '排便記録の合言葉が違います。排便記録のアプリの接続設定をご確認ください。' && r.noted === 0, r);
  r = run(errOf('AbortError', 'The user aborted a request.'));
  t('時間切れ → 30秒以内に返事が無い文・記録しない', r.msg.indexOf('30秒以内に返事がありませんでした') >= 0 && r.noted === 0, r);
  r = run(errOf('TypeError', "Cannot read properties of null (reading 'x')"));
  t('画面の中のエラー → 読み込み直しの文・記録に残す', /画面の中で思わぬエラー/.test(r.msg) && r.noted === 1, r);
  r = run(errOf('Error', 'odd'));
  t('ほかの英語の文 → 一般の文・記録に残す', r.msg === '排便記録を読み込めませんでした。時間をおいて「読み込み」を押してください。' && r.noted === 1, r);
  ['EXC_HTTP', 'EXC_FORMAT', 'EXC_REFUSED'].forEach(m => { const g = run(new Error(m)).msg; t(m + ' の文に技術の言葉が無い', !TECH7.test(g), g); });
  t('記録の失敗は印付きで捨てる（空の catch にしない）', (S.match(/catch\(_\)\{ \/\* 捨ててよい: 記録できなくても断りの文は出す \*\/ \}/g) || []).length === 2);
}
console.log('\n【10】「?」の説明は「?」が出る時だけ・画面だけ');
{
  const at = S.indexOf('function vmUnreadNote(');
  let src = '';
  if (at >= 0) { let d = 0, seen = false; for (let i = at; i < S.length; i++) { const c = S[i]; if (c === '{') { d++; seen = true; } else if (c === '}') { d--; if (seen && d === 0) { src = S.slice(at, i + 1); break; } } } }
  t('vmUnreadNote がある', !!src);
  const mk = () => { const kids = []; return { kids, appendChild: (x) => kids.push(x) }; };
  const box = { dates: ['2026-01-01', '2026-01-02'], document: { createElement: () => ({ className: '', textContent: '' }) } };
  vm.createContext(box);
  if (src) vm.runInContext(src, box);
  const defs = [{ key: 'temp' }, { key: 'pulse' }];
  const s1 = mk(); if (src) box.vmUnreadNote(defs, { '2026-01-02': { temp: null, flags: ['temp'] } }, s1);
  t('値が無く印がある → 説明を1つ足す・印刷に出さない', s1.kids.length === 1 && /\bnoprint\b/.test(s1.kids[0].className), s1.kids);
  const s2 = mk(); if (src) box.vmUnreadNote(defs, { '2026-01-02': { temp: 36.5, flags: ['temp'] } }, s2);
  t('値が読めている時は出さない（表にも「?」が出ない）', s2.kids.length === 0);
  const s3 = mk(); if (src) box.vmUnreadNote(defs, { '2026-01-02': { temp: null } }, s3);
  t('印が無い時は出さない（表は「−」）', s3.kids.length === 0);
  const s4 = mk(); if (src) box.vmUnreadNote(defs, { '2026-01-02': { spo2: null, flags: ['spo2'] } }, s4);
  t('その表に無い項目の印では出さない', s4.kids.length === 0);
  t('バイタル・食事の両方の表の下で呼ぶ', S.indexOf('vmUnreadNote(VM_SERIES, vBy, sec1);') >= 0 && S.indexOf('vmUnreadNote(VM_MEALS, mBy, sec2);') >= 0);
  t('表の「?」の条件は前のまま（説明と同じ条件）', S.indexOf("if(row && row.flags && row.flags.indexOf(sd.key) >= 0){ td.textContent = '?'; td.className = 'bad'; }") >= 0);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格・' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
