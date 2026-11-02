/* 家族構成図（genogram.html）の職員に見える文の試験（2026-11-02・品質改善 C6・C1）。
   守ること:
     1. 職員が読む設定の案内・入力欄・知らせの文に、GAS・Web App・localStorage・スプシ・リトライキュー などの技術用語を出さない
     2. 接続先が入っていない時は「何が足りないか」と「次にすること」を出し、接続設定（connection-settings.html）へのリンクを置く
     3. 通信の失敗・受け口の返事の英語は画面に出さず、職員向けの一文に替える。元の文は su-errors.js の記録（note）に残す
        ただし回線の失敗（届かない・途中で切れた・時間切れ）は記録しない（圏外の端末で自動の不具合報告の種を増やさない・体重管理と同じ方針）
        （合言葉・食い違い・打ち切りの印と文はそのまま）
     4. 管理者が受け口を作る手順（① の中）と、画面の中に写した受け口のコード（GAS_SCRIPT_CODE）は対象の外
   実行: node check/unit/genogram_staff_words_test.js（GENO_HTML で別の genogram.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.GENO_HTML || path.join(__dirname, '..', '..', 'genogram.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name, prefix) {
  const key = (prefix || '') + 'function ' + name + '(';
  const h = src.indexOf(key);
  if (h < 0) return '';
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  return '';
}
function line(start) { const h = src.indexOf(start); return h < 0 ? '' : src.slice(h, src.indexOf('\n', h)); }
function block(re) { return (re.exec(src) || [, ''])[1]; }
const TECH = /GAS|Web ?App|localStorage|スプシ|リトライキュー|JSON|HTTP|\/exec|トークン|Supabase|API/;

console.log('\n— 1. 設定の画面（職員が読む所） —');
const modal = block(/<div class="modal-overlay" id="cloudModal" hidden>([\s\S]*?)<div class="main">/);
const first = block(/<div class="setup-first" id="cfgFirstGuide">([\s\S]*?)<\/div>/);
const firstText = first.replace(/<code>GENOGRAM_TOKEN<\/code>/g, '').replace(/<[^>]+>/g, '');
t('★初回の案内に技術用語が無い（合言葉の名前 GENOGRAM_TOKEN だけは管理者へ伝える名前として残す）', first !== '' && !TECH.test(firstText), firstText.match(TECH));
t('初回の案内は「Google の受け口の URL」と言う', /管理者から「Google の受け口の URL」と「合言葉」を受け取ります/.test(first));
const form = block(/<div class="setup-form">([\s\S]*?)<div class="setup-note">/);
t('★入力欄の名前・見本に技術用語が無い', form !== '' && !TECH.test(form.replace(/id="[^"]*"|class="[^"]*"|type="[^"]*"/g, '')), form.match(TECH));
t('URL の入力欄は「Google の受け口の URL」', /<label class="fl">① Google の受け口の URL <span class="req">\*<\/span><\/label>/.test(form));
t('URL の見本は管理者から受け取ると分かる（/exec の形を出さない）', /id="cfgGasUrl" placeholder="管理者から受け取った URL（https:\/\/script\.google\.com\/ で始まる）"/.test(form));
const note = block(/<div class="setup-note">([\s\S]*?)<\/div>/);
t('★「信頼性について」に localStorage・スプシ・リトライキュー・非同期 が無い', note !== '' && !/localStorage|スプシ|リトライキュー|非同期|バージョン/.test(note), note.match(/localStorage|スプシ|リトライキュー|非同期|バージョン/));
t('「信頼性について」は「この端末の中に保存」「保留」「設定をクリア」で言う', /まずこの端末の中にすぐ保存し/.test(note) && /「保留」として残し/.test(note) && /合言葉はこの端末の中に保存されます。共用のパソコンで使った後は「設定をクリア」を押してください/.test(note));
t('受け口のコードをコピーするボタンの文に GAS が無い（id は同じ）', /<button class="hbtn primary setup-copy" id="btnCopyGas">📋 受け口のコードをコピー<\/button>/.test(src));

console.log('\n— 2. 接続先が入っていない時の案内 —');
const nc = block(/<p class="setup-sub" id="cfgNoConnGuide">([\s\S]*?)<\/p>/);
t('★設定の画面に、入っていない時に何が起きるか（この端末にだけ保存・ほかの端末から見えない）がある', /URL と合言葉が入っていない間は、図はこの端末にだけ保存され、ほかの端末からは見えません/.test(nc));
t('★接続設定へのリンクと、入れる欄の名前（ジェノグラム（家族構成図））がある', /<a href="connection-settings\.html">接続設定<\/a>の画面の「ジェノグラム（家族構成図）」の欄に入れても/.test(nc));
t('その案内は設定の画面の中にある（開いた時の画面は変えない）', modal.indexOf('id="cfgNoConnGuide"') > 0);
const fs_ = cut('forceSync', 'async ');
t('★「↻ 同期」で未設定の時、次にすること（⚙ 設定か接続設定の欄に URL と合言葉）を出す', /クラウドの接続先がまだ入っていません。\\n「⚙ 設定」か接続設定の画面の「ジェノグラム（家族構成図）」の欄に、管理者から受け取った URL と合言葉を入れてください。/.test(fs_));
const tc = cut('testCloudConfig', 'async ');
t('接続テストで URL が空の時、管理者から受け取ること・接続設定の欄を出す（GAS・Web App を出さない）', /Google の受け口の URL を入れてください（管理者から受け取ります。接続設定の画面の「ジェノグラム（家族構成図）」の欄に入れても同じです）/.test(tc) && !/GAS Web App URL/.test(tc));

console.log('\n— 3. 接続テストの結果の文 —');
const tcMsgs = (tc.match(/(?:showCfgResult|results\.push)\([^;]*;/g) || []).join('\n');
t('★接続テストの結果の文に GAS・デプロイ設定の素の言い方が無い', tc !== '' && !/GAS/.test(tcMsgs), tcMsgs.match(/.*GAS.*/));
t('成功は「つながりました」', /✓ つながりました・合言葉OK/.test(tc) && /✓ つながりました \(/.test(tc));
t('失敗は「つながりませんでした」＋管理者向けの一言（Apps Script のデプロイ）', /✗ つながりませんでした（' \+ e\.message \+ '）。URL が正しいか確かめてください。\\n→ 管理者の方へ：/.test(tc));
const copyMsg = line("() => showCfgResult('ok', ");
t('コードのコピーの知らせに GAS が無い', copyMsg !== '' && !/GAS/.test(copyMsg), copyMsg);

console.log('\n— 4. 合言葉で断られた時・未設定の時の文 —');
function evalConst(name) {
  const l = line('const ' + name + ' = ');
  if (!l) return '';
  const b = {}; vm.createContext(b); vm.runInContext(l.replace('const ' + name, 'this.v'), b); return b.v;
}
const AUTH = evalConst('AUTH_ERR_MSG');
t('★合言葉の文に GAS・スクリプト プロパティ が無い', AUTH !== '' && !/GAS|スクリプト プロパティ/.test(AUTH), AUTH);
t('合言葉の文は今のボタン名（⚙ 設定）と、管理者に GENOGRAM_TOKEN を確かめてもらうことを言う', /⚙ 設定の「合言葉」/.test(AUTH) && /管理者に Google の受け口の側の合言葉（GENOGRAM_TOKEN）/.test(AUTH), AUTH);
const NOCFG = evalConst('GENO_NO_CFG_MSG');
t('★未設定で呼んだ時の文に GAS が無く、⚙ 設定・接続設定へ導く', NOCFG !== '' && !TECH.test(NOCFG) && /⚙ 設定か接続設定の画面で/.test(NOCFG), NOCFG);
t('未設定の時は GENO_NO_CFG_MSG を投げる（GAS URLが未設定です を出さない）', /if \(!cfg\.gasUrl\) throw new Error\(GENO_NO_CFG_MSG\);/.test(src) && src.indexOf('GAS URLが未設定です') < 0);

console.log('\n— 5. 通信の失敗は職員向けの一文に替え、回線でない失敗だけ元の文を記録に残す —');
function box(fetchImpl, json, withAbort) {
  const notes = [];
  const b = {
    window: { SUErrors: { note: (k, m, w) => { notes.push([k, (m && m.message) || String(m), w]); } } },
    localStorage: { getItem: () => '{"gasUrl":"https://script.google.com/macros/s/EXAMPLE/exec","gasToken":"aikotoba"}', length: 0, key: () => null },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 1; }, clearTimeout() {},
    fetch: fetchImpl || (() => Promise.resolve({ ok: true, json: () => Promise.resolve(json) })),
    URLSearchParams, Promise, Date, String, Math, Array, Object, JSON, Number, Error
  };
  if (withAbort) b.AbortController = AbortController;
  vm.createContext(b);
  vm.runInContext([
    "function getCfg() { return JSON.parse(localStorage.getItem('x')); }",
    line('const GAS_URL_RE = '), line('const GENO_NO_CFG_MSG = '), line('const GENO_NET_MSG = '), line('const GENO_SRV_MSG = '),
    cut('genoNote_'), cut('genoIsLineErr_'), cut('genoNetErr_'), line('const AUTH_ERR_MSG = '),
    line('const GENO_WRITE_ACTIONS = '), line('const GENO_SESSION_RE = '), cut('genoHasLogin_'),
    'function genoAccessToken_() { return Promise.resolve(""); }',
    line('const FETCH_TIMEOUT_MS = '), cut('fetchWithRetry', 'async '), cut('sleep'), cut('gasCall', 'async '),
    'this.gasCall = gasCall; this.NET = GENO_NET_MSG; this.SRV = GENO_SRV_MSG;'
  ].join('\n'), b);
  return { b, notes };
}
(async function main() {
  const run = async (x, action) => { try { await x.b.gasCall(action || 'save', { doc: { clientName: 'テスト 一郎' } }); return null; } catch (e) { return e; } };
  let ok = false;
  try { ok = typeof box().b.gasCall === 'function'; } catch (e) { ok = false; }
  t('★通信の部品を取り出して動かせる（GENO_NET_MSG・genoNote_・genoNetErr_ がある）', ok);
  if (ok) {
    const net = box(() => Promise.reject(new TypeError('Failed to fetch')));
    const e1 = await run(net);
    t('★回線が切れた時は「クラウドと通信できませんでした…」（Failed to fetch を出さない）', e1 && e1.message === net.b.NET && !/fetch/i.test(e1.message), e1 && e1.message);
    t('★  └ 届かない（回線の失敗）は記録しない', net.notes.length === 0, net.notes);
    const net2 = box(() => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')));
    const e1a = await run(net2);
    t('★  └ 届かない失敗は、例外の種類によらず記録しない（送れなかった＝回線）', e1a && e1a.message === net2.b.NET && net2.notes.length === 0, net2.notes);
    const cutBody = box(() => Promise.resolve({ ok: true, json: () => Promise.reject(new TypeError('network error')) }));
    const e1b = await run(cutBody);
    t('応答の途中で切れた時も同じ一文', e1b && e1b.message === cutBody.b.NET, e1b && e1b.message);
    t('★  └ 途中で切れた（回線の失敗）も記録しない', cutBody.notes.length === 0, cutBody.notes);
    /* 時間切れ: 打ち切りの時計だけすぐ鳴らし、届かない通信を打ち切りで止める */
    const hang = (url, init) => new Promise((ok, ng) => { init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; ng(e); }); });
    const to = box(hang, null, true);
    const e1c = await run(to);
    t('時間切れは今までどおり打ち切りの文と印（err.timeout）', e1c && e1c.timeout === true && /応答がありません/.test(e1c.message), e1c && e1c.message);
    t('★  └ 時間切れは記録しない', to.notes.length === 0, to.notes);
    const http = box(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    const e2 = await run(http);
    t('★応答がエラー（500 など）の時も同じ一文（GAS HTTP を出さない）', e2 && e2.message === http.b.NET, e2 && e2.message);
    t('★  └ 受け口が答えた失敗（GAS HTTP 500）は記録に残す（どの要求かは action だけ・合言葉や氏名を書かない）', http.notes.length === 1 && /GAS HTTP 500/.test(http.notes[0][1]) && http.notes[0][2] === 'genogram:gas:save' && !/aikotoba|テスト/.test(JSON.stringify(http.notes)), http.notes);
    const bad = box(() => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')) }));
    const e3 = await run(bad);
    t('応答が読めない時も同じ一文（Unexpected token を出さない）', e3 && e3.message === bad.b.NET, e3 && e3.message);
    t('★  └ 読めない答え（受け口の失敗）は記録に残す', bad.notes.length === 1 && /Unexpected token/.test(bad.notes[0][1]), bad.notes);
    const busy = box(null, { ok: false, error: 'busy' });
    const e4 = await run(busy);
    t('★受け口の返事の英語（busy など）は「受け付けませんでした」の一文に替える', e4 && e4.message === busy.b.SRV && !/busy/.test(e4.message) && !e4.auth && !e4.conflict, e4 && e4.message);
    t('  └ 元の返事（busy）は記録に残す', busy.notes.length === 1 && busy.notes[0][1] === 'busy' && busy.notes[0][2] === 'genogram:gas:save', busy.notes);
    const au = box(null, { ok: false, error: 'unauthorized' });
    const e5 = await run(au);
    t('合言葉で断られた時は今までどおり err.auth と合言葉の文（記録はしない）', e5 && e5.auth === true && e5.message === evalConst('AUTH_ERR_MSG') && au.notes.length === 0, e5 && e5.message);
    const cf = box(null, { ok: false, error: 'conflict', current: '2026-10-01T00:00:00.000+09:00' });
    const e6 = await run(cf);
    t('食い違いは今までどおり err.conflict・err.current を持つ', e6 && e6.conflict === true && e6.current === '2026-10-01T00:00:00.000+09:00' && cf.notes.length === 0, e6 && e6.message);
    const okb = box(null, { ok: true, items: [] });
    let r = null; try { r = await okb.b.gasCall('list', {}); } catch (e) { r = e; }
    t('成功の時は今までどおり応答をそのまま返す', r && r.ok === true && okb.notes.length === 0, r);
    const nocfg = box(); nocfg.b.getCfg = () => ({});
    vm.runInContext('getCfg = function () { return {}; };', nocfg.b);
    const e7 = await run(nocfg);
    t('★未設定の時は GENO_NO_CFG_MSG（通信しない）', e7 && e7.message === NOCFG, e7 && e7.message);
  }

  console.log('\n— 6. 画面に出す知らせの文 —');
  const sd = cut('saveDoc', 'async ');
  t('★端末へ保存できない時に英語の例外文（e.message）を出さず、次にすることを言う', sd !== '' && sd.indexOf("alert('端末への保存に失敗しました: ' + e.message)") < 0
    && /端末への保存に失敗しました。端末に保存できる量がいっぱいの可能性があります。使わなくなった図を削除してから、もう一度保存してください。/.test(sd));
  t('  └ 元の失敗は記録に残す', /window\.SUErrors\.note\('保存・同期の失敗', e, 'genogram:saveLocal'\)/.test(sd));
  /* 「同期失敗（キューに保留）」の文は、テーマ側の試験（genogram_cloud_screen_test）が文字で確かめているため変えない */
  t('保存・削除の失敗の状態は、職員向けに替えた理由の文を後ろに付ける（e.message の英語を出さない）', /'同期失敗（キューに保留）: ' \+ err\.message/.test(sd) && /'削除の同期失敗（キューに保留）: ' \+ err\.message/.test(cut('deleteCurrentDoc', 'async ')));
  /* 知らせを出す呼び出しの文字の中に技術用語が無い（写した受け口のコードは除く） */
  const gasStart = src.indexOf('const GAS_SCRIPT_CODE = `');
  const gasEnd = src.indexOf('\n`;', gasStart);
  const app = src.slice(0, gasStart) + src.slice(gasEnd + 3);
  const calls = app.split('\n').filter(l => /(?:alert|confirm|setSyncStatus|showCfgResult|flashStatus)\(/.test(l) && !/^\s*(?:\/\/|\/\*|\*)/.test(l) && !/function (?:setSyncStatus|showCfgResult|flashStatus)\(/.test(l));
  const bad2 = calls.filter(l => /['`"][^'`"]*(?:GAS|Web ?App|localStorage|スプシ|JSON|HTTP|トークン)[^'`"]*['`"]/.test(l));
  t('★alert・confirm・状態の帯・設定の結果の文に技術用語が無い（' + calls.length + ' か所）', calls.length > 20 && bad2.length === 0, bad2.map(s => s.trim().slice(0, 80)));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
