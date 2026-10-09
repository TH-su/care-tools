/* 接続設定（connection-settings.html）の初回の案内（2026-10-09・監査10月版 #13・本人決定 1a）。
   1. 段は 施設情報 → 統合同期 → 入居者マスタ → 専用GAS の順。専用GAS は残りの全系統（不具合の報告先まで）
   2. 確かめ方は各欄と同じ probe（合言葉は送らない）。結果は ✓／✕ と文で出す（色だけにしない）
   3. 接続先が1つも無い端末でだけ自動で開く。閉じた印（cs_wiz_hidden）は UI 状態だけで、接続先・合言葉は保存しない
   4. 文字は textContent（el()）で入れ、innerHTML を使わない */
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

/* 系統の一覧と案内の段を、実物から読んで突き合わせる */
const box = { RE_GAS_EXEC: /x/, RE_GAS_ANY: /x/ };
vm.createContext(box);
vm.runInContext(grab(/var SYSTEMS = \[[\s\S]*?\n\];/).replace('var SYSTEMS', 'this.SYSTEMS') + '\n' + grab(/var WIZ_STEPS = \[[\s\S]*?\n\];/).replace('var WIZ_STEPS', 'this.WIZ_STEPS'), box);
const sysIds = box.SYSTEMS.map(s => s.id);
const steps = box.WIZ_STEPS;

console.log('\n— 1. 段の順番と中身 —');
t('段は 施設情報・統合同期・入居者マスタ・専用GAS の順', steps.map(s => s.id).join() === 'fac,ws,master,own', steps.map(s => s.id));
const covered = [].concat.apply([], steps.filter(s => s.sys).map(s => s.sys)).sort();
t('案内は全部の系統を1回ずつ扱う（足りない・重なりが無い）', covered.join() === sysIds.slice().sort().join(), { covered, sysIds });
t('統合同期は ws、入居者マスタは master', steps[1].sys.join() === 'ws' && steps[2].sys.join() === 'master', '');

console.log('\n— 2. 自動で開く条件 —');
{
  const store = {};
  const b = { SYSTEMS: box.SYSTEMS, localStorage: { getItem: k => (k in store ? store[k] : null) }, JSON, String };
  vm.createContext(b);
  vm.runInContext([cut('lsGetStr'), cut('lsGetObj'), cut('readCur'), cut('anyConfigured')].join('\n'), b);
  t('何も入っていなければ「未設定」＝自動で開く', b.anyConfigured() === false, '');
  store.rmaster_cfg = JSON.stringify({ url: 'https://script.google.com/macros/s/X/exec', token: 't' });
  t('どれか1つでも入っていれば自動では開かない', b.anyConfigured() === true, '');
  delete store.rmaster_cfg; store.hbcr_api_url = 'https://script.google.com/macros/s/Y/exec';
  t('文字列で持つ系統（排泄）でも数える', b.anyConfigured() === true, '');
}
t('自動で開くのは「未設定」かつ「閉じた印が無い」時', /var open = !anyConfigured\(\) && !hidden;/.test(src), '');
t('閉じた印は cs_wiz_hidden の "1" だけ（接続先・合言葉は書かない）', /localStorage\.setItem\(WIZ_HIDDEN_KEY,'1'\)/.test(src) && (src.match(/localStorage\.setItem\(WIZ_HIDDEN_KEY/g) || []).length === 1, '');
t('「初回の案内を開く」で開き直せる（印を消す）', /id="wizOpen">初回の案内を開く<\/button>/.test(src) && /localStorage\.removeItem\(WIZ_HIDDEN_KEY\)/.test(src), '');

console.log('\n— 3. 確かめ方と表示 —');
const check = cut('wizCheck');
t('確かめるのは各欄と同じ probe（合言葉は送らない）', /probe\(x\.u\)/.test(check) && !/token/.test(check), check.slice(0, 200));
const render = cut('wizRender');
t('結果は ✓／✕ と文で出す（色だけにしない）', /'✓'/.test(render) && /'✕'/.test(render) && /el\('p','msg',st\.msg\)/.test(render), '');
t('結果の文は読み上げの対象（role=status）', /m\.setAttribute\('role','status'\)/.test(render), '');
const wizBlock = src.slice(src.indexOf('/* ═══════════ 初回の案内'), src.indexOf('/* ═══════════ 初期化 ═══════════ */'));
t('案内の処理は innerHTML を使わない', !/innerHTML/.test(wizBlock), '');
t('各欄に「この欄へ」で飛べる（欄に card-<系統> の id）', /cd\.id='card-'\+sys\.id;/.test(src) && /\$\('card-'\+step\.sys\[0\]\)/.test(render), '');
t('欄を保存したら案内の表示も取り直す', /buildCard\(SYSTEMS\[i\], function\(\)\{ remember\(\); wizRefresh\(\); \}\)/.test(src), '');

console.log('\n— 4. 審査の指摘（2026-10-09）—');
{
  const b = { SYNC_SERVER_ID: (src.match(/var SYNC_SERVER_ID\s*=\s*'([^']+)'/) || [])[1] };
  vm.createContext(b);
  vm.runInContext(cut('syncForeign'), b);
  t('統合同期の判定（別アプリのGAS）: 認証エラー・不明なaction・違う名乗りは別アプリ', b.syncForeign({ error: '認証エラー' }) && b.syncForeign({ error: '不明なaction' }) && b.syncForeign({ ok: true, server: 'other' }), b.SYNC_SERVER_ID);
  t('合言葉なしの unauthorized・正しい名乗りは別アプリと見なさない', !b.syncForeign({ ok: false, error: 'unauthorized' }) && !b.syncForeign({ ok: true, server: b.SYNC_SERVER_ID }) && !b.syncForeign(null), '');
  t('カードの［接続を確認］と案内の「確かめる」は同じ判定（syncForeign）を使う', /if\(syncForeign\(out\.json\)\)\{/.test(src) && /syncForeign\(r\.json\)/.test(cut('wizCheck')), '');
  t('★一括保存（控えからの復元もこの経路）のあとに案内を取り直す', /toast\('入力がないため、何も変更していません'\);\s*wizRefresh\(\);/.test(src), '');
  t('★他のタブの書き戻しを知らせた時も案内を取り直す', /cards\[i\]\.refresh\(\);\s*wizRefresh\(\);/.test(src), '');
  t('確かめている間に設定が変わったら、古い結果は出さない', /var gen=wizGen;/.test(cut('wizCheck')) && /if\(gen!==wizGen\) return;/.test(cut('wizCheck')) && /function wizRefresh\(\)\{ wizGen\+\+;/.test(src), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
