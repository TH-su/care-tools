/* 接続設定（connection-settings.html）の初回の案内の「合言葉も確かめる」と「ログインで使えます（設定不要）」（2026-11-13 代表者の指示）。
   1. 合言葉は本文（text/plain の POST・{action:'ping', token}）で送り、URL に載せない。書く要求は送らない
   2. GAS は合言葉が違っても 200 で返す。本文の印（unauthorized・認証エラー・code:403）と、本当の 403 を「合言葉が違います」にする
   3. 決まった形でない答えは「確かめられません」（「通りました」と出さない）。ping の口が無い系統（排泄・体重・報告先）は送らない
   4. 統合同期・入居者マスタは、先に合言葉なしで別アプリと分かったら合言葉を送らない
   5. ログインで使える系統は段から外し、段の全部がそうなら段を飛ばす。対象は入居調整・計画書・家族構成図・過去シフトの4つだけ
   架空の接続先・合言葉だけを使う。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');
let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}
function grab(re) { const m = src.match(re); if (!m) throw new Error('見つからない: ' + re); return m[0]; }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
}
function line(re) { return grab(re); }

const URL_A = 'https://script.google.com/macros/s/FAKE_A/exec';
/* 系統ごとの架空の答え（各 GAS の ping の形を写したもの） */
function makeBox(store, answer) {
  const sent = [];
  const box = {
    RE_GAS_EXEC: /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/, RE_GAS_ANY: /^https:\/\/script\.google\.com\/.*\/exec(\?|#|$)/,
    localStorage: { getItem: k => (k in store ? store[k] : null) },
    JSON, String, Object, Promise, setTimeout, clearTimeout, isFinite, Number,
    fetch: function (url, opt) {
      sent.push({ url, opt });
      const body = JSON.parse(opt.body);
      const a = answer(body, url);
      return Promise.resolve({
        ok: a.status === 200, status: a.status,
        json: () => (a.json === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(a.json)),
        text: () => Promise.resolve(a.json === undefined ? '<html>' : JSON.stringify(a.json))
      });
    }
  };
  vm.createContext(box);
  vm.runInContext([
    grab(/var SYSTEMS = \[[\s\S]*?\n\];/),
    cut('lsGetStr'), cut('lsGetObj'), cut('readCur'), cut('sysById'),
    line(/var SYNC_SERVER_ID='[^']+';/), cut('syncTargetVerdict'), cut('syncTargetMessage'), cut('syncForeign'),
    cut('masterTargetVerdict'), line(/var MASTER_WRONG_MSG='[^']+';/), cut('verifyMasterUrl'), cut('probe'),
    line(/var WIZ_LIVE_MSG = '[^']+';/), line(/var WIZ_TOKEN_NG = '[^']+';/), 'var wizLive = {};',
    line(/var WIZ_TOKEN_SERVER = \{[^}]+\};/), cut('tokenVerdict_'), line(/var WIZ_TOKEN_UNSUPPORTED = \{[^}]+\};/),
    cut('tokenPing_'), cut('tokenMsg_'), cut('wizTokenOne_')
  ].join('\n') + '\nthis.SYSTEMS=SYSTEMS; this.sysById=sysById; this.wizLive=wizLive;', box);
  box.sent = sent;
  return box;
}
function cfg(store, id, url, token) {
  const k = { adm: 'adm_cfg', tp: 'tp_cfg', master: 'rmaster_cfg', msk: 'msk_cfg', ws: 'su_sync_common', analyzer: 'shiftanalyzer:v1:cloud', med: 'med_cfg' }[id];
  if (id === 'ws') store[k] = JSON.stringify({ endpoint: url, token });
  else if (id === 'geno') store['genogram:cloudCfg'] = JSON.stringify({ gasUrl: url, gasToken: token });
  else if (id === 'haiben') { store.hbcr_api_url = url; store.hbcr_api_token = token; }
  else if (id === 'weight') { store.wtmgr_api_url = url; store.wtmgr_api_token = token; }
  else if (id === 'report') { store.su_report_endpoint = url; store.su_report_token = token; }
  else store[k] = JSON.stringify({ url, token });
}

(async function main() {
  console.log('\n— 1. 送る形（本文・text/plain・ping だけ）—');
  {
    const store = {}; cfg(store, 'adm', URL_A, 'kasou-aikotoba-1');
    const b = makeBox(store, () => ({ status: 200, json: { ok: true, server: 'silverunix-admission' } }));
    const r = await b.wizTokenOne_(b.sysById('adm'));
    const s = b.sent[0] || {};
    t('POST・text/plain で送る', s.opt && s.opt.method === 'POST' && s.opt.headers['Content-Type'] === 'text/plain;charset=utf-8', s.opt);
    t('本文は {action:"ping", token} だけ（書く要求を送らない）', s.opt && JSON.stringify(JSON.parse(s.opt.body)) === JSON.stringify({ action: 'ping', token: 'kasou-aikotoba-1' }), s.opt && s.opt.body);
    t('合言葉を URL に載せない', s.url === URL_A && !/kasou/.test(s.url), s.url);
    t('正しい名乗りなら「合言葉が通りました」', r.ok === true && r.msg === '合言葉が通りました', r);
  }

  console.log('\n— 2. 200 と 403 の見分け（本文の印）—');
  const cases = [
    ['adm', { ok: false, error: 'unauthorized' }, 200, 'ng'],
    ['tp', { ok: true, server: 'silverunix-training' }, 200, 'ok'],
    ['tp', { ok: true, server: 'silverunix-admission' }, 200, 'wrong'],
    ['analyzer', { error: 'unauthorized' }, 200, 'ng'],
    ['analyzer', { ok: true, server: 'shiftanalyzer-gas', role: 'rw' }, 200, 'ok'],
    ['geno', { ok: false, error: 'unauthorized', code: 403 }, 200, 'ng'],
    ['geno', { ok: true, auth: 'ok', role: 'full' }, 200, 'ok'],
    ['master', { error: '認証エラー' }, 200, 'ng'],
    ['master', { ok: true, role: 'full', readRole: false }, 200, 'ok'],
    ['master', { ok: true, role: 'field', readRole: false }, 200, 'limited'],
    ['msk', { error: '認証エラー' }, 200, 'ng'],
    ['msk', { ok: true, role: 'full', ver: 'x' }, 200, 'ok'],
    ['msk', { ok: true, role: 'full', readRole: false }, 200, 'unknown'],
    ['med', { error: 'unauthorized' }, 200, 'ng'],
    ['med', { ok: true }, 200, 'ok'],
    ['ws', { ok: false, error: 'unauthorized' }, 200, 'ng'],
    ['ws', { ok: true, server: 'silverunix-sync' }, 200, 'ok'],
    ['ws', { ok: false, error: 'サーバ未設定: SYNC_TOKEN がありません' }, 200, 'unknown'],
    ['adm', null, 403, 'ng'],
    ['adm', { ok: false, error: '混み合っています' }, 200, 'unknown'],
    ['geno', { ok: true }, 200, 'unknown'],
    ['med', { ok: true, role: 'full' }, 200, 'unknown'],
    ['adm', null, 200, 'unknown']
  ];
  {
    const b = makeBox({}, () => ({ status: 200, json: {} }));
    const bad = cases.filter(c => b.tokenVerdict_(c[0], c[1], c[2]) !== c[3]).map(c => [c[0], c[1], c[2], c[3], b.tokenVerdict_(c[0], c[1], c[2])]);
    t('系統ごとの答えを見分ける（' + cases.length + '場面）', bad.length === 0, bad);
    t('合言葉が違う時の文は「合言葉が違います」', b.tokenMsg_('ng').msg === '合言葉が違います' && b.tokenMsg_('ng').ok === false, b.tokenMsg_('ng'));
    t('分からない時は「確かめられません」の側（✓ にしない）', b.tokenMsg_('unknown').ok === null && /確かめられません/.test(b.tokenMsg_('unknown').msg), b.tokenMsg_('unknown'));
  }
  {
    const store = {}; cfg(store, 'geno', URL_A, 'kasou-aikotoba-2');
    const b = makeBox(store, () => ({ status: 200, json: { ok: false, error: 'unauthorized', code: 403 } }));
    const r = await b.wizTokenOne_(b.sysById('geno'));
    t('通し: 家族構成図の code:403 は「合言葉が違います」', r.ok === false && r.msg === '合言葉が違います', r);
  }
  {
    const store = {}; cfg(store, 'tp', URL_A, 'kasou-aikotoba-3');
    const b = makeBox(store, () => ({ status: 403 }));
    const r = await b.wizTokenOne_(b.sysById('tp'));
    t('通し: 本当の 403 も「合言葉が違います」', r.ok === false && r.msg === '合言葉が違います', r);
  }

  console.log('\n— 3. 確かめられない系統は送らない —');
  for (const id of ['haiben', 'weight', 'report']) {
    const store = {}; cfg(store, id, URL_A, 'kasou-aikotoba-4');
    const b = makeBox(store, () => ({ status: 200, json: { ok: true } }));
    const r = await b.wizTokenOne_(b.sysById(id));
    t(id + ': 何も送らず「確かめられません」', b.sent.length === 0 && r.ok === null && /確かめられません/.test(r.msg), { sent: b.sent.length, r });
  }
  {
    const store = {}; store.adm_cfg = JSON.stringify({ url: URL_A });
    const b = makeBox(store, () => ({ status: 200, json: { ok: true } }));
    const r = await b.wizTokenOne_(b.sysById('adm'));
    t('合言葉が保存されていない時は送らない', b.sent.length === 0 && r.ok === false && /合言葉がまだ入っていません/.test(r.msg), r);
  }

  console.log('\n— 4. 別アプリと分かったら合言葉を送らない —');
  {
    const store = {}; cfg(store, 'ws', URL_A, 'kasou-aikotoba-5');
    const b = makeBox(store, () => ({ status: 200, json: { error: '不明なaction' } }));
    const r = await b.wizTokenOne_(b.sysById('ws'));
    t('統合同期: 合言葉なしの probe で別アプリ → 合言葉を送らない', b.sent.length === 1 && !('token' in JSON.parse(b.sent[0].opt.body)) && r.ok === false, { sent: b.sent.map(s => s.opt.body), r });
  }
  {
    const store = {}; cfg(store, 'ws', URL_A, 'kasou-aikotoba-6');
    const b = makeBox(store, body => (body.token ? { status: 200, json: { ok: false, error: 'unauthorized' } } : { status: 200, json: { ok: false, error: 'unauthorized' } }));
    const r = await b.wizTokenOne_(b.sysById('ws'));
    t('統合同期: 合言葉なし→合言葉あり の2回で「合言葉が違います」', b.sent.length === 2 && JSON.parse(b.sent[1].opt.body).token === 'kasou-aikotoba-6' && r.msg === '合言葉が違います', { n: b.sent.length, r });
  }
  {
    const store = {}; cfg(store, 'master', URL_A, 'kasou-aikotoba-7');
    const b = makeBox(store, () => ({ status: 200, json: { error: '不明なaction' } }));
    const r = await b.wizTokenOne_(b.sysById('master'));
    t('入居者マスタ: 版数の確かめで別アプリ → 合言葉を送らない', b.sent.length === 1 && JSON.parse(b.sent[0].opt.body).action === 'stateRev' && !('token' in JSON.parse(b.sent[0].opt.body)) && r.ok === false, { sent: b.sent.map(s => s.opt.body), r });
  }

  console.log('\n— 5. ログインで使える系統 —');
  t('文は「ログインで使えます（設定不要）」', /var WIZ_LIVE_MSG = 'ログインで使えます（設定不要）';/.test(src), '');
  const liveDef = grab(/var WIZ_LIVE_CHECKS = \{[\s\S]*?\n\};/);
  const liveIds = (liveDef.match(/^  ([a-z]+): function/mg) || []).map(s => s.trim().split(':')[0]);
  t('対象は入居調整・計画書・家族構成図・過去シフトの4つだけ（統合同期・入居者マスタ・体重・排泄・申送は入れない）', liveIds.join() === 'adm,tp,geno,analyzer', liveIds);
  t('持ち主の画面と同じ確かめ（liveReady／probe）を呼ぶ', /SU\.data\.admission\.liveReady\(\)/.test(liveDef) && /SU\.data\.training\.liveReady\(\)/.test(liveDef) && /SUGeno\.liveReady\(\)/.test(liveDef) && /SUSa\.probe\(\)/.test(liveDef), '');
  t('true の時だけ印を付ける（分からない・時間切れは付けない）', /if\(v!==true\) return;\s*wizLive\[id\]=true;/.test(cut('wizLiveStart')) && /ok\(false\); \}, 10000\)/.test(cut('wizLiveStart')), '');
  {
    const store = {}; store.adm_cfg = JSON.stringify({ url: URL_A, token: 'x' });
    const b = { localStorage: { getItem: k => (k in store ? store[k] : null) }, JSON, String, Object, window: {} };
    vm.createContext(b);
    vm.runInContext([grab(/var SYSTEMS = \[[\s\S]*?\n\];/).replace(/urlRe:RE_GAS_[A-Z]+/g, 'urlRe:null'), cut('lsGetStr'), cut('lsGetObj'), cut('readCur'), cut('sysById'),
      line(/var WIZ_LIVE_MSG = '[^']+';/), 'var wizLive = {}; var wizRes = {};', cut('wizState')].join('\n') + '\nthis.wizLive=wizLive; this.wizRes=wizRes;', b);
    const own = { id: 'own', sys: ['adm', 'tp'] };
    t('段の全部が使えない間は今までどおり', b.wizState(own).ok === null && !b.wizState(own).live, b.wizState(own));
    b.wizLive.adm = true;
    const part = b.wizState(own);
    t('一部が使える時は、その系統を外し「（ログインで使えます（設定不要）：入居調整）」を添える', part.ok === false && /まだ入っていません/.test(part.msg) && /（ログインで使えます（設定不要）：入居調整）$/.test(part.msg) && !part.live, part);
    b.wizLive.tp = true;
    const all = b.wizState(own);
    t('段の全部が使える時は ✓ で段を飛ばす', all.ok === true && all.live === true && /^ログインで使えます（設定不要）/.test(all.msg), all);
  }
  t('「確かめる」も「合言葉も確かめる」も、使える系統へは送らない', /if\(wizLive\[id\]\) return;/.test(cut('wizCheck')) && /if\(wizLive\[id\]\) return;/.test(cut('wizTokenCheck')), '');
  t('「この欄へ」はログインで使える系統の欄へ飛ばさない（使えない系統の最初の欄へ）', /var first=step\.sys\.filter\(function\(id\)\{ return !wizLive\[id\]; \}\)\[0\];/.test(cut('wizRender')) && /if\(first && \$\('card-'\+first\)\) c=\$\('card-'\+first\);/.test(cut('wizRender')), '');
  t('使えると届いたら、その系統を含む段の結果を捨て、途中の確かめも出さない', /wizGen\+\+;/.test(cut('wizLiveStart')) && /delete wizRes\[st\.id\]; delete wizTokRes\[st\.id\];/.test(cut('wizLiveStart')), '');
  t('接続先を入れていない系統は確かめない（✕ にしない）', /if\(s && readCur\(s\)\.url\) list\.push\(s\);/.test(cut('wizTokenCheck')), '');
  t('飛ばす段にはボタンを出さない', /if\(step\.sys && !st\.live\)\{/.test(cut('wizRender')), '');

  console.log('\n— 6. 画面の作り —');
  const render = cut('wizRender');
  t('「合言葉も確かめる」のボタン（押す所は .btn.sm＝44px）', /el\('button','btn sm','合言葉も確かめる'\)/.test(render) && /\.btn\.sm \{ min-height: 44px;/.test(src), '');
  t('読み上げの名前に段の名前を添える', /bTok\.setAttribute\('aria-label','合言葉も確かめる（'\+step\.title\+'）'\)/.test(render), '');
  t('結果は読み上げの対象（role=status）・文字で ✓／✕ を付ける', /tm\.setAttribute\('role','status'\)/.test(render) && /'✓ '/.test(cut('wizTokenCheck')) && /'✕ '/.test(cut('wizTokenCheck')), '');
  t('設定を取り直したら合言葉の結果も捨てる', /function wizRefresh\(\)\{ wizGen\+\+; wizRes=\{\}; wizTokRes=\{\}; wizRender\(\); \}/.test(src), '');
  t('確かめている間に設定が変わったら古い結果は出さない', /var gen=wizGen;/.test(cut('wizTokenCheck')) && /if\(gen!==wizGen\) return;/.test(cut('wizTokenCheck')), '');
  const blk = src.slice(src.indexOf('/* ═══════════ 初回の案内：合言葉も確かめる'), src.indexOf('function wizRender(){'));
  t('合言葉を console・端末の保存に出さない（console・setItem が無い）', !/console\./.test(blk) && !/setItem/.test(blk) && !/innerHTML/.test(blk), '');
  t('配った接続先（SUDevCfg）は案内で読まない', !/SUDevCfg/.test(blk), '');

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + e.message); process.exit(1); });
