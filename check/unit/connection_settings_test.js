/* connection-settings.html の「保存で既存値を壊さない」検証。
   HTML から対象関数だけを切り出して eval する（写経しない＝実物を試す）。

   この画面は7系統ぶんの接続先と合言葉を書く唯一の集約点で、
   書き方を1つ間違えると複数アプリが同時に接続不能になる。守りたいのは3点:
   1. 空欄は「変更しない」＝既存値を消さない（dev-principles 原則4）
   2. オブジェクト形は read-modify-write ＝他アプリが入れた項目を消さない
   3. 不正なURLは書き込みの前に止まり、既存値が無傷で残る

   対象HTMLは環境変数 CONN_HTML で差し替えられる（worktree で検証するため）。 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = process.env.CONN_HTML || path.join(__dirname, '..', '..', 'connection-settings.html');
const src = fs.readFileSync(HTML, 'utf8');

function cut(name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  throw new Error('関数の終端が見つからない: ' + name);
}

/* 系統の定義も【実物から読み取る】。テスト側に書き写すと、定義を変えた時に気づけない。 */
function sysDef(id) {
  const at = src.indexOf("{ id:'" + id + "'");
  if (at < 0) throw new Error('系統が見つからない: ' + id);
  let i = at, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(at, i + 1);
}
const RE_GAS_ANY = eval(src.match(/var RE_GAS_ANY\s*=\s*(\/[^\n]*\/[a-z]*)\s*;/)[1]);
const RE_GAS_EXEC = eval(src.match(/var RE_GAS_EXEC\s*=\s*(\/[^\n]*\/[a-z]*)\s*;/)[1]);
const SYS = {
  weight: eval('(' + sysDef('weight') + ')'),
  haiben: eval('(' + sysDef('haiben') + ')'),
  master: eval('(' + sysDef('master') + ')')
};

// ── localStorage の最小モック ──
let STORE = {};
global.localStorage = {
  getItem: (k) => (k in STORE ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = String(v); },
  removeItem: (k) => { delete STORE[k]; }
};

(0, eval)(cut('lsGetStr'));
(0, eval)(cut('lsGetObj'));
(0, eval)(cut('readCur'));
(0, eval)(cut('writeSys'));
(0, eval)(cut('checkUrl'));

// ── テスト基盤 ──
let pass = 0, fail = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; failures.push(`${label}\n    期待: ${e}\n    実際: ${a}`);
}
function ok(cond, label) { eq(!!cond, true, label); }

const URL1 = 'https://script.google.com/macros/s/AAAA/exec';
const URL2 = 'https://script.google.com/macros/s/BBBB/exec';

/* ── 1. 体重が str2（URL＋合言葉）になっていること ── */
eq(SYS.weight.shape, 'str2', '1-1 体重管理は URL と合言葉の2キーを扱う');
eq(SYS.weight.key, 'wtmgr_api_url', '1-2 URLのキー');
eq(SYS.weight.tokenKey, 'wtmgr_api_token', '1-3 合言葉のキー（体重管理アプリと同じ名前）');
eq(SYS.weight.tokenOptional, true, '1-4 合言葉は任意（サーバーが未設定なら素通しするため）');
eq(SYS.haiben.shape, 'str2', '1-5 排泄も同じ形（既存の仕組みに乗せた）');

/* ── 2. 空欄は「変更しない」＝既存値を消さない（原則4）── */
STORE = {};
writeSys(SYS.weight, { url: URL1, token: 'himitsu9' });
eq(STORE['wtmgr_api_url'], URL1, '2-1 URLが保存される');
eq(STORE['wtmgr_api_token'], 'himitsu9', '2-2 合言葉が保存される');

writeSys(SYS.weight, { url: URL2, token: '' });
eq(STORE['wtmgr_api_url'], URL2, '2-3 URLだけ差し替えられる');
eq(STORE['wtmgr_api_token'], 'himitsu9', '2-4 合言葉が空欄なら既存値を消さない');

writeSys(SYS.weight, { url: '', token: 'himitsu-new' });
eq(STORE['wtmgr_api_url'], URL2, '2-5 URLが空欄なら既存値を消さない');
eq(STORE['wtmgr_api_token'], 'himitsu-new', '2-6 合言葉だけ差し替えられる');

writeSys(SYS.weight, { url: '', token: '' });
eq(STORE['wtmgr_api_url'], URL2, '2-7 両方空欄なら何も変えない（URL）');
eq(STORE['wtmgr_api_token'], 'himitsu-new', '2-8 両方空欄なら何も変えない（合言葉）');

/* ── 3. 読み戻しの検証が効いていること ── */
const r1 = writeSys(SYS.weight, { url: URL1, token: 'x' });
eq(r1.failed, [], '3-1 正常に書けたら failed は空');
ok(r1.changed >= 2, '3-2 書けた件数を返す');

const realSet = global.localStorage.setItem;
global.localStorage.setItem = () => {};          // 書けたふりをするストレージ（容量超過等の再現）
const r2 = writeSys(SYS.weight, { url: URL2, token: 'y' });
ok(r2.failed.length >= 1, '3-3 書けていないことを読み戻しで検出する（黙って成功と言わない）');
global.localStorage.setItem = realSet;

/* ── 4. オブジェクト形は他アプリの項目を消さない（read-modify-write）── */
STORE = { rmaster_cfg: JSON.stringify({ url: URL1, token: 't1', vmaUrl: 'https://vma.example/', 他アプリの項目: 'のこす' }) };
writeSys(SYS.master, { url: URL2, token: '', extra: '' });
const cfg = JSON.parse(STORE['rmaster_cfg']);
eq(cfg.url, URL2, '4-1 URLは差し替わる');
eq(cfg.token, 't1', '4-2 空欄の合言葉は既存値のまま');
eq(cfg.vmaUrl, 'https://vma.example/', '4-3 空欄の訪問診療URLも残る');
eq(cfg['他アプリの項目'], 'のこす', '4-4 知らない項目を消さない（丸ごと上書きしない）');

/* ── 5. 読み出し ── */
STORE = { wtmgr_api_url: URL1, wtmgr_api_token: 'himitsu9' };
eq(readCur(SYS.weight), { url: URL1, token: 'himitsu9', extra: '' }, '5-1 str2 はURLと合言葉を両方読む');
STORE = {};
eq(readCur(SYS.weight), { url: '', token: '', extra: '' }, '5-2 未設定なら空で返す（落ちない）');
STORE = { rmaster_cfg: 'これはJSONではない' };
eq(readCur(SYS.master).url, '', '5-3 壊れた値でも落ちずに空を返す');

/* ── 6. 不正なURLは checkUrl で止まる（書き込みの前）── */
eq(checkUrl(URL1, RE_GAS_ANY), null, '6-1 正しいGASのURLは通す');
ok(checkUrl('http://script.google.com/macros/s/A/exec', RE_GAS_ANY), '6-2 http は止める');
ok(checkUrl('https://script.google.com/macros/s/A/dev', RE_GAS_ANY), '6-3 /dev は止める');
ok(checkUrl('https://example.com/exec', RE_GAS_ANY), '6-4 GAS以外は止める');
eq(checkUrl('', RE_GAS_ANY), null, '6-5 空欄は「変更しない」＝エラーにしない');
/* su_sync_common だけは所有アプリと同一の厳しい式を使う（緩めると6アプリが一斉に誤接続） */
ok(checkUrl('https://script.google.com/a/macros/example.com/s/A/exec', RE_GAS_EXEC),
   '6-6 統合GASの式は Workspace 形式を通さない（所有アプリと同一の厳しさを保つ）');

// ── 結果 ──
console.log(`\nconnection-settings 保存の安全性  pass ${pass} / fail ${fail}`);
if (fail) { console.log('\n失敗:\n' + failures.map(f => '  ✖ ' + f).join('\n')); process.exit(1); }
