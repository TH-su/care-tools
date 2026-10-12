/* 入居調整（admission-flow.html）の保存・同期の失敗を記録に残す試験（2026-10-12・監査10月版 第3版 8）。
   守ること:
     1. 端末への保存（saveCache）が書けない・検証できない時は、画面の知らせに加えて SUErrors.note へ
        種類「保存・同期の失敗」・場所「admission:…」で渡す（不具合報告 su-report が拾う種類と同じ）。戻り値は今までどおり false
     2. 端末の控え・接続先が壊れていて読めない時も記録し、戻り値は今までどおり（null・空の接続先）
     3. 渡すのは例外だけ・場所は固定の文字（相談者の氏名などのデータを渡さない）
     4. su-errors.js が古い（note が無い）・無い端末では何もしない（例外を出さない）
     5. su-errors.js は note のある版（2026-10-08 以降）の印で読む
   実行: node check/unit/admission_note_test.js（ADMISSION_HTML で別の admission-flow.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.ADMISSION_HTML || path.join(__dirname, '..', '..', 'admission-flow.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}

function load(opts) {
  opts = opts || {};
  const ls = new Map(Object.entries(opts.ls || {}));
  const notes = [], toasts = [];
  const quota = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return e; };
  const window = {};
  if (opts.suErrors === 'old') window.SUErrors = { report() {}, onReport() {} };
  else if (opts.suErrors !== 'none') window.SUErrors = { note: (kind, msg, where) => notes.push({ kind, msg, where }) };
  const sb = {
    window, JSON, Error, String, Array,
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => { if (opts.full) throw quota(); ls.set(k, String(v)); }
    },
    toast: (m) => toasts.push(m),
    DB: { candidates: [{ id: 'c1', name: '見本 甲' }] }, kvRev: 1, dirty: false, nowIso: () => '2026-10-12T00:00:00Z',
    CACHE_KEY: 'adm_cache', CACHE_BAK: 'adm_cache_bak', CACHE_BAK2: 'adm_cache_bak2',
    SU_DATA_READY: true, KV_KEY: 'admission',
    SU: { data: { kvPutBeacon: () => { if (opts.beaconThrows) throw new Error('beacon'); } } }
  };
  vm.createContext(sb);
  for (const n of ['afNote_', 'cachePayload', 'saveCache', 'readCacheSlot', 'syncTarget', 'flushOnExit', 'masterCfg']) vm.runInContext(cut(n), sb);
  return { sb, notes, toasts };
}

console.log('\n— 1. 端末への保存が書けない時 —');
{
  const { sb, notes, toasts } = load({ full: true });
  t('saveCache は今までどおり false', vm.runInContext('saveCache()', sb) === false);
  t('画面の知らせは今までどおり出る', toasts.length === 1 && /端末に保存できませんでした/.test(toasts[0]), toasts);
  t('記録は「保存・同期の失敗」・admission:端末の保存', notes.length === 1 && notes[0].kind === '保存・同期の失敗' && notes[0].where === 'admission:端末の保存', notes.map(n => n.where));
  t('記録には例外そのものを渡す（データは渡さない）', notes[0] && notes[0].msg && notes[0].msg.name === 'QuotaExceededError');
}
{
  const { sb, notes } = load();
  t('書けた時は true で記録しない', vm.runInContext('saveCache()', sb) === true && notes.length === 0, notes);
}

console.log('\n— 2. 壊れた控え・接続先 —');
{
  const { sb, notes } = load({ ls: { adm_cache: '{壊れた', adm_cfg: '{壊れた', rmaster_cfg: '{壊れた' } });
  t('壊れた控えは null のまま', vm.runInContext("readCacheSlot('adm_cache')", sb) === null);
  t('壊れた接続先は空のまま', JSON.stringify(vm.runInContext('syncTarget()', sb)) === JSON.stringify({ endpoint: '', token: '' }));
  t('壊れた入居者マスタの接続先は空のまま', JSON.stringify(vm.runInContext('masterCfg()', sb)) === JSON.stringify({ url: '', token: '' }));
  t('3つとも記録する', JSON.stringify(notes.map(n => n.where)) === JSON.stringify(['admission:端末の控えの読み込み', 'admission:接続先の読み込み', 'admission:入居者マスタの接続先の読み込み']), notes.map(n => n.where));
}
{
  const { sb, notes } = load({ ls: { adm_cfg: '{"url":"https://example.invalid/exec","token":"x"}' } });
  vm.runInContext("readCacheSlot('adm_cache')", sb); vm.runInContext('syncTarget()', sb);
  t('無い・正しい時は記録しない', notes.length === 0, notes);
}
{
  const { sb, notes } = load({ beaconThrows: true });
  vm.runInContext('dirty = true; flushOnExit()', sb);
  t('離脱時の送信が投げたら記録する', notes.length === 1 && notes[0].where === 'admission:離脱時の送信', notes);
}

console.log('\n— 3. 場所の文字と送信の失敗 —');
{
  const calls = [...src.matchAll(/afNote_\('([^']*)'/g)].map(m => m[1]);
  t('記録の口は10か所以上', calls.length >= 10, calls.length);
  t('場所に日付・キーを入れない', calls.every(w => !/\d{4}-\d{2}|adm_|cache/.test(w)), calls);
  t('送信の失敗は、取り直しても入っていなかった時だけ記録する', /if \(done\) \{ setSync\('同期OK'\); return; \}\s*afNote_\('送信', e\)/.test(src));
  t('統合後の送信の失敗も記録する', /catch\(function \(e2\) \{ afNote_\('送信（統合後）', e2\)/.test(src));
  t('種類は su-report が拾う「保存・同期の失敗」', /note\('保存・同期の失敗', e, 'admission:' \+ where\)/.test(cut('afNote_')));
}

console.log('\n— 4. su-errors.js が古い・無い端末 —');
for (const mode of ['old', 'none']) {
  const { sb } = load({ full: true, suErrors: mode, ls: { adm_cfg: '{壊れた' } });
  let ok = true;
  try { ok = vm.runInContext('saveCache()', sb) === false && vm.runInContext('syncTarget()', sb).endpoint === ''; } catch (e) { ok = false; }
  t('su-errors が' + (mode === 'old' ? '古い' : '無い') + '時も例外を出さず動きは同じ', ok);
}

console.log('\n— 5. su-errors.js の版の印 —');
{
  const m = /su-errors\.js\?v=(\d{4}-\d{2}-\d{2})/.exec(src);
  t('note のある版（2026-10-08 以降）で読む', m && m[1] >= '2026-10-08', m && m[1]);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
