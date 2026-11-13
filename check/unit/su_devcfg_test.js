/* 管理者が配った接続先と合言葉を、ログインした端末が役割ごとに受け取る部品（su-devcfg.js・統合 0080・代表者の決定 2026-11-08）の試験。架空のデータだけを使う。
   1. 受け取り: ログインの印が無い端末は呼ばない・何も返さない／受け取った値を get で返す／形の違う値は落とす／localStorage に書かない
   2. 現場の端末: ws_field・master_field・haiben だけ（get('ws')→ws_field・get('master')→master_field）・事務所の分は控えにも残さない
      事務所の端末: get('ws_field')・get('master_field') は null
   3. 同じタブの控え: 同じアカウントなら呼ばずに使う・アカウントが違えば使わない・30分を過ぎたら読み直す
   4. 失敗: 関数が無い・断られた時は何も返さない／通信の失敗は前の値のまま／例外を外に出さない
   5. 画面の静的な確かめ: 各画面の接続先を読む所が先に SUDevCfg を見る・入力欄に配った値を出さない・su-errors.js の直後で読む・connection-settings の配る欄は管理者＋2段階認証だけ
   実行: node check/unit/su_devcfg_test.js
   ★出力に console を使わない（個人情報を出力に流さない作法をそろえる）。 */
'use strict';
const fs = require('fs');
/* 入居者マスタの画面のスクリプトは 2026-11-13 に resident-master.js へ移した（判定の区間 MC-JUDGE だけ HTML に残す）。移す前と同じ文字に戻して確かめる */
const { readMaster } = require('../master-page.cjs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-devcfg.js'), 'utf8');
const read = (f) => readMaster(path.join(ROOT, f));
let ok = 0, ng = 0, finished = false;
process.on('exit', () => { if (!finished) { process.stdout.write('\n試験が終わる前に止まりました\n'); process.exitCode = 1; } });
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

const U1 = 'https://script.google.com/macros/s/KAKUU_ws_0000000001/exec';
const U2 = 'https://script.google.com/macros/s/KAKUU_ms_0000000002/exec';
const U3 = 'https://script.google.com/macros/s/KAKUU_hb_0000000003/exec';
const U4 = 'https://script.google.com/a/macros/example.jp/s/KAKUU_wf_0000000004/exec';
const sess = (id) => JSON.stringify({ access_token: 'x', user: { id } });
const SKEY = 'sb-kakuu-auth-token';

function load(opt) {
  opt = opt || {};
  const ls = new Map(Object.entries(opt.ls || {}));
  const ss = opt.ss || new Map();
  const cnt = { rpc: 0, lsSet: 0, ssSet: 0 };
  const listeners = {};
  let now = opt.now || 1700000000000;
  const answer = opt.answer || (() => ({ data: { ok: true, role: 'office', items: {}, ver: null } }));
  const win = {
    addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
    supabase: {},
    SUAuth: {
      client() {
        return {
          auth: { getSession: () => Promise.resolve({ data: { session: ls.get(SKEY) ? {} : null } }) },
          rpc(fn) { cnt.rpc++; cnt.last = fn; return Promise.resolve(answer(fn)); }
        };
      }
    }
  };
  const DateX = class extends Date { static now() { return now; } };
  const ctx = {
    window: win, Promise, JSON, Object, Array, String, Error, RegExp, Math, Date: DateX,
    setTimeout(fn) { return setImmediate(fn); }, setInterval() { return 0; },
    localStorage: {
      get length() { return ls.size; },
      key(i) { return [...ls.keys()][i] || null; },
      getItem(k) { return ls.has(k) ? ls.get(k) : null; },
      setItem(k, v) { cnt.lsSet++; ls.set(k, String(v)); }, removeItem(k) { ls.delete(k); }
    },
    sessionStorage: {
      getItem(k) { return ss.has(k) ? ss.get(k) : null; },
      setItem(k, v) { cnt.ssSet++; ss.set(k, String(v)); }, removeItem(k) { ss.delete(k); }
    },
    document: { scripts: [], head: { appendChild() {} }, createElement() { return {}; }, hidden: false }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'su-devcfg.js' });
  return { D: win.SUDevCfg, win, cnt, ls, ss, setNow: (v) => { now = v; }, fire: (n, e) => (listeners[n] || []).forEach((f) => f(e)) };
}
const settle = () => new Promise((r) => setTimeout(r, 15));
const items = (o) => () => ({ data: { ok: true, role: 'office', items: o, ver: '2026-11-08T00:00:00Z' } });

(async () => {
  group('1. 受け取り');
  {
    const x = load({ ls: {} });
    await x.D.ready(50);
    t('部品は get・ready・onChange・refresh・forget を出す', ['get', 'ready', 'onChange', 'refresh', 'forget'].every((k) => typeof x.D[k] === 'function'));
    t('ログインの印が無い端末は呼ばない', x.cnt.rpc === 0, x.cnt);
    t('ログインの印が無い端末は何も返さない', x.D.get('ws') === null);
  }
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-1') }, answer: items({ ws: { url: U1, token: 'kakuu-token-ws' }, master: { url: U2, token: 'kakuu-token-ms' }, moushi: { url: 'http://example.invalid/exec', token: 'kakuu-token-xx' }, med: { url: U2, token: 'a b c d e f g h' }, haiben: { url: U3 } }) });
    await x.D.ready(50); await settle();
    t('device_config_get を1回だけ呼ぶ', x.cnt.rpc === 1 && x.cnt.last === 'device_config_get', x.cnt);
    t('ws を返す', JSON.stringify(x.D.get('ws')) === JSON.stringify({ url: U1, token: 'kakuu-token-ws' }));
    t('master を返す', x.D.get('master') && x.D.get('master').url === U2);
    t('GAS の /exec でない接続先は落とす', x.D.get('moushi') === null);
    t('空白を含む合言葉は落とす', x.D.get('med') === null);
    t('合言葉の無い系統は返さない（端末の値で動く）', x.D.get('haiben') === null);
    t('配っていない系統は null', x.D.get('weight') === null && x.D.get('nai') === null);
    t('localStorage に書かない', x.cnt.lsSet === 0, x.cnt);
    t('同じタブの控え（sessionStorage）に置く', x.ss.has('su_devcfg_v1'));
  }

  group('2. 端末の用途');
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-2'), su_device_role: 'field' }, answer: items({ ws: { url: U1, token: 'kakuu-token-ws' }, ws_field: { url: U4, token: 'kakuu-token-wf' }, master_field: { url: U2, token: 'kakuu-token-mf' }, haiben: { url: U3, token: 'kakuu-token-hb' }, moushi: { url: U2, token: 'kakuu-token-mo' } }) });
    await x.D.ready(50); await settle();
    t('現場の端末の get(ws) は ws_field（Workspace の形も通す）', x.D.get('ws') && x.D.get('ws').url === U4 && x.D.get('ws').token === 'kakuu-token-wf');
    t('現場の端末の get(master) は master_field', x.D.get('master') && x.D.get('master').token === 'kakuu-token-mf');
    t('現場の端末でも haiben は使う', x.D.get('haiben') && x.D.get('haiben').url === U3);
    t('現場の端末では moushi を使わない', x.D.get('moushi') === null);
    const memo = x.ss.get('su_devcfg_v1') || '';
    t('現場の端末の控えに事務所の合言葉を残さない', memo.indexOf('kakuu-token-ws') < 0 && memo.indexOf('kakuu-token-mo') < 0 && memo.indexOf('kakuu-token-wf') >= 0);
  }
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-3') }, answer: items({ ws_field: { url: U4, token: 'kakuu-token-wf' }, master_field: { url: U2, token: 'kakuu-token-mf' } }) });
    await x.D.ready(50); await settle();
    t('事務所の端末は ws_field・master_field を使わない', x.D.get('ws') === null && x.D.get('ws_field') === null && x.D.get('master') === null && x.D.get('master_field') === null);
  }
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-4') }, answer: items({ ws: { url: U1, token: 'kakuu-token-ws' }, haiben: { url: U3, token: 'kakuu-token-hb' } }) });
    await x.D.ready(50); await settle();
    x.ls.set('su_device_role', 'field');
    t('事務所から現場の端末になった後は事務所の分を返さない', x.D.get('ws') === null && x.D.get('haiben') !== null);
    x.fire('storage', { key: 'su_device_role' });
    await settle();
    t('現場の端末になった知らせで控えからも事務所の分を捨てる', (x.ss.get('su_devcfg_v1') || '').indexOf('kakuu-token-ws') < 0);
  }

  group('3. 同じタブの控え');
  {
    const ss = new Map();
    const a = load({ ls: { [SKEY]: sess('kakuu-5') }, ss, answer: items({ ws: { url: U1, token: 'kakuu-token-ws' } }) });
    await a.D.ready(50); await settle();
    const b = load({ ls: { [SKEY]: sess('kakuu-5') }, ss, answer: items({}) });
    await b.D.ready(50); await settle();
    t('同じアカウントの次の画面は呼ばずに控えを使う', b.cnt.rpc === 0 && b.D.get('ws') && b.D.get('ws').url === U1, b.cnt);
    const c = load({ ls: { [SKEY]: sess('kakuu-6') }, ss, answer: items({}) });
    await c.D.ready(50); await settle();
    t('アカウントが違えば控えを使わない（読み直す）', c.cnt.rpc === 1 && c.D.get('ws') === null);
    t('控えに利用者 id を置かない', (ss.get('su_devcfg_v1') || '').indexOf('kakuu-5') < 0 && (ss.get('su_devcfg_v1') || '').indexOf('kakuu-6') < 0);
  }
  {
    const ss = new Map();
    const a = load({ ls: { [SKEY]: sess('kakuu-7') }, ss, answer: items({ ws: { url: U1, token: 'kakuu-token-ws' } }), now: 1700000000000 });
    await a.D.ready(50); await settle();
    const b = load({ ls: { [SKEY]: sess('kakuu-7') }, ss, answer: items({ ws: { url: U2, token: 'kakuu-token-w2' } }), now: 1700000000000 + 31 * 60 * 1000 });
    await b.D.ready(50); await settle();
    t('30分を過ぎた控えは読み直す', b.cnt.rpc === 1 && b.D.get('ws').url === U2);
  }
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-8') }, answer: items({ ws: { url: U1, token: 'kakuu-token-ws' } }) });
    await x.D.ready(50); await settle();
    let n = 0; x.D.onChange(() => { n++; });
    x.ls.delete(SKEY);
    t('ログアウトした後は返さない', x.D.get('ws') === null);
    x.ls.set(SKEY, sess('kakuu-9'));
    t('別のアカウントでログインした後は前の人の値を返さない', x.D.get('ws') === null);
    x.fire('storage', { key: SKEY }); await settle();
    t('ログインが変わった知らせで読み直し、変わったことを知らせる', x.cnt.rpc === 2 && n >= 1, { rpc: x.cnt.rpc, n });
  }

  group('4. 失敗');
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-10') }, answer: () => ({ error: { code: 'PGRST202', message: 'nai' } }) });
    await x.D.ready(50); await settle();
    t('関数が無い時は何も返さない', x.D.get('ws') === null);
  }
  {
    let mode = 'ok';
    const ss = new Map();
    const x = load({ ls: { [SKEY]: sess('kakuu-11') }, ss, answer: () => (mode === 'ok' ? items({ ws: { url: U1, token: 'kakuu-token-ws' } })() : mode === 'net' ? { error: { code: '', message: 'Failed to fetch' } } : { error: { code: '42501' } }) });
    await x.D.ready(50); await settle();
    mode = 'net'; await x.D.refresh(); await settle();
    t('通信の失敗は前の値のまま', x.D.get('ws') && x.D.get('ws').url === U1);
    mode = 'deny'; await x.D.refresh(); await settle();
    t('断られた時は何も返さない', x.D.get('ws') === null);
    mode = 'ok'; await x.D.refresh(); await settle();
    x.D.forget();
    t('forget の後は返さず、控えも消える', x.D.get('ws') === null && !ss.has('su_devcfg_v1'));
  }
  {
    const x = load({ ls: { [SKEY]: sess('kakuu-12') }, answer: () => { throw new Error('boom'); } });
    let threw = false;
    try { await x.D.ready(50); await settle(); x.D.get('ws'); } catch (e) { threw = true; }
    t('例外を外に出さない', !threw && x.D.get('ws') === null);
  }
  {
    const x = load({ ls: { [SKEY]: '{壊れた' } });
    await x.D.ready(50);
    t('ログインの印が壊れていても止まらず、呼ばない', x.cnt.rpc === 0 && x.D.get('ws') === null);
  }
  t('部品は console を使わない・localStorage に書かない', !/console\./.test(SRC) && !/localStorage\.setItem/.test(SRC));

  group('5. 画面の静的な確かめ');
  const PAGES = ['care-schedule.html', 'daycare-roster.html', 'support-overview.html', 'visit-overview.html', 'weight-record.html', 'admission-flow.html',
    'care-meeting.html', 'resident-master.html', 'facesheet.html', 'training-plan.html', 'moushiokuri-viewer.html', 'connection-settings.html'];
  for (const p of PAGES) {
    const h = read(p);
    t(p + ' は su-errors.js の直後で su-devcfg.js を読む', h.indexOf('<script src="su-errors.js?v=2026-11-12"></script>\n<script src="su-devcfg.js?v=2026-11-08"></script>') >= 0);
  }
  const fnBody = (h, head) => { const i = h.indexOf(head); return i < 0 ? '' : h.slice(i, i + 600); };
  const firstGet = (body, key) => { const i = body.indexOf("SUDevCfg.get('" + key + "')"), j = body.indexOf('localStorage'); return i >= 0 && (j < 0 || i < j); };
  const CS = read('care-schedule.html');
  t('週間計画: 同期先（target）は配った ws を先に見る', firstGet(fnBody(CS, '  target() {'), 'ws'));
  t('週間計画: 同期の画面の入力欄は端末の値だけ（targetLocal）', /const t0 = SYNC\.targetLocal\(\);/.test(CS) && /const t = SYNC\.targetLocal\(\);\n  return url !== t\.endpoint/.test(CS));
  t('週間計画: 配った接続先を使っている間は端末の接続先を書き換えない', /async healStaleTarget\(\) \{\n    try \{ if \(window\.SUDevCfg && window\.SUDevCfg\.get\('ws'\)\) return false;/.test(CS));
  t('週間計画: 入居者マスタの接続先も配った値を先に見る', firstGet(fnBody(CS, 'function csGetMasterCfg(){'), 'master'));
  for (const [p, head, key] of [['daycare-roster.html', 'function syncTarget() {', 'ws'], ['support-overview.html', 'function syncTarget() {', 'ws'], ['visit-overview.html', 'function syncTarget() {', 'ws'],
    ['daycare-roster.html', 'function dcrGetMasterCfg(){', 'master'], ['support-overview.html', 'function soMasterCfg(){', 'master'], ['visit-overview.html', 'function voMasterCfg(){', 'master'],
    ['weight-record.html', 'function wrMasterCfg(){', 'master'], ['weight-record.html', 'function wrProxyCreds(){', 'haiben'], ['admission-flow.html', 'function masterCfg() {', 'master'],
    ['care-meeting.html', 'function readCfg_(){', 'master'], ['resident-master.html', 'function mcMskCfg_(){', 'moushi'], ['facesheet.html', 'function a4SyncTarget(){', 'ws'], ['resident-master.html', 'function a4SyncTarget(){', 'ws'],
    ['moushiokuri-viewer.html', 'function loadCfg(){', 'moushi'], ['moushiokuri-viewer.html', 'function excReadCfg(get){', 'haiben']]) {
    t(p + ' の ' + head.replace(/\s*\{$/, '') + ' は配った ' + key + ' を先に見る', firstGet(fnBody(read(p), head), key));
  }
  const MV = read('moushiokuri-viewer.html');
  t('申送ビューア: 設定の入力欄は端末の値だけ（loadCfgLocal_）', /var cfg = loadCfgLocal_\(\);\n  \$\('cfgUrl'\)\.value = cfg\.url;/.test(MV));
  const RM = read('resident-master.html'), FS = read('facesheet.html');
  t('入居者マスタ: 設定の窓の入力欄は端末の値だけ（合言葉の欄は空のまま・2026-11-12 商用化の見直し）', /function openSync\(\)\{var _lc=rmLocalCfg_\(\);\$\('cfgUrl'\)\.value=_lc\.url;\$\('cfgToken'\)\.value='';/.test(RM));
  t('入居者マスタ: 合言葉の欄は伏せ字・空欄の保存とテストはこの端末に保存済みの合言葉を使い、配った合言葉を入れた住所へ送らない（2026-11-12）', /<input id="cfgToken" type="password" autocomplete="new-password"/.test(RM) && /CFG\.token=_tkIn\|\|\(CFG\.url\?_oldLc\.token\.trim\(\):''\);/.test(RM) && /CFG\.token=\$\('cfgToken'\)\.value\.trim\(\)\|\|rmLocalCfg_\(\)\.token\.trim\(\);   \/\* 空欄なら、この端末に/.test(RM) && !/String\(saved\.token/.test(RM.slice(RM.indexOf('function testSync(){'), RM.indexOf('function testSync(){')+900)));
  t('フェイスシート: 接続テストの空欄は端末に保存した合言葉だけ（配った合言葉を入れた住所へ送らない・2026-11-12）', /token:\(\$\('cfgToken'\)\.value\|\|''\)\.trim\(\)\|\|String\(readSavedCfg_\(\)\.token\|\|''\)\.trim\(\)\};/.test(FS));
  t('フェイスシート: 設定の窓の入力欄は端末の値だけ（合言葉の欄は空のまま・2026-11-08 商用化の点検）', /function openSync\(\)\{\n[\s\S]{0,400}?var _lc=readSavedCfg_\(\);\$\('cfgUrl'\)\.value=_lc\.url;\$\('cfgToken'\)\.value='';/.test(FS));
  t('入居者マスタ・フェイスシート: 使う接続先は配った値が先', /function rmDistCfg_\(\)\{try\{var d=window\.SUDevCfg&&window\.SUDevCfg\.get\('master'\)/.test(RM) && /function fsEffCfg_\(\)\{ return fsDistCfg_\(\)\|\|readSavedCfg_\(\); \}/.test(FS));
  const TP = read('training-plan.html');
  t('計画書: 入居者マスタ・週間計画の接続先は配った値が先', /SUDevCfg\.get\('master'\); if \(dm\)/.test(TP) && /SUDevCfg\.get\('ws'\); if \(dw\)/.test(TP));
  t('写し返し（su-res-read.js）は配った master を先に見る', /root\.SUDevCfg && root\.SUDevCfg\.get\('master'\)\) \|\| JSON\.parse\(localStorage\.getItem\('rmaster_cfg'\)/.test(read('su-res-read.js')));
  const CON = read('connection-settings.html');
  t('接続設定: 配る欄は管理者＋2段階認証の時だけ作る', /if\(!st \|\| st\.status!=='ok' \|\| st\.role!=='admin' \|\| !st\.mfa\) return null;/.test(CON));
  t('接続設定: 配る欄は HTML に置かず、作る時だけ足す（管理者でない時は見た目が変わらない）', !/id="dist"/.test(CON));
  t('接続設定: 送る前に確かめる（統合同期・入居者マスタ・ほか）', /function distVerify_/.test(CON) && /verifySyncPair\(url, token\)/.test(CON) && /verifyMasterUrl\(url\)\.then/.test(CON));
  t('接続設定: 配る欄は innerHTML を使わない', !/innerHTML/.test(CON.slice(CON.indexOf('全端末へ配る（統合 0080'), CON.indexOf('設定の控え（2026-09-27）═'))));
  t('接続設定: 一覧・配る・やめるの口を使う', /device_config_list/.test(CON) && /device_config_set/.test(CON) && /device_config_del/.test(CON));

  finished = true;
  say('\n成功 ' + ok + ' 件／失敗 ' + ng + ' 件');
  process.exitCode = ng ? 1 : 0;
})();
