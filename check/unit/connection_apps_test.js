/* 接続設定（connection-settings.html）を施設の「使うアプリ」で絞ること・端末の用途が未設定の時の注意の帯の試験
   （2026-10-12・監査10月版 v2 接続設定 第3手・本人決定: 使うアプリの項目を足す／用途は注意の帯だけ）。
   守ること:
     1. su-facility.js の SUFacility.apps(): facility-profile.json の apps（英小文字の id）だけを返す。書いていない・空・壊れた値は null＝全部使う
     2. 使わないアプリの欄と初回の案内の段は出さない。不具合の報告先は常に出す。施設情報を読めていない時は全部出す
     3. ★すでに URL が入っている欄は、使わないアプリでも隠さない。SYSTEMS そのもの（控え・復元・見張り）は絞らない
     4. 端末の用途が未設定の時だけ注意の帯を出す。帯に用途の切り替えボタンは置かない（切り替えは入居者マスタの1か所）
     5. この施設の facility-profile.json は apps を書かない＝全部使う（画面は今までどおり）
   実行: node check/unit/connection_apps_test.js */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CS = read('connection-settings.html');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}
function facility(profile) {
  const store = {};
  if (profile !== undefined) store.su_facility_json_v1 = JSON.stringify(profile);
  const win = {};
  const ctx = { window: win, localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {} }, JSON, Math, String, Array, Object, parseInt };
  vm.createContext(ctx);
  vm.runInContext(read('su-facility.js'), ctx, { filename: 'su-facility.js' });
  return win.SUFacility;
}
const BASE = { offices: [{ kind: '施設', name: '見本ホーム' }] };

console.log('\n— 1. SUFacility.apps() —');
t('★apps を書いていない＝null（全部使う）', facility(BASE).apps() === null);
t('apps の id だけを返す', JSON.stringify(facility(Object.assign({}, BASE, { apps: ['ws', 'msk'] })).apps()) === '["ws","msk"]');
t('★空の配列は null（書き損じで全部消さない）', facility(Object.assign({}, BASE, { apps: [] })).apps() === null);
t('英小文字の id 以外は捨てる', JSON.stringify(facility(Object.assign({}, BASE, { apps: ['ws', 'WS', '<x>', 3, 'msk'] })).apps()) === '["ws","msk"]');
t('配列でない値は null', facility(Object.assign({}, BASE, { apps: 'ws' })).apps() === null);
t('施設情報が無い時は null', facility().apps() === null);
{
  const F = facility(Object.assign({}, BASE, { apps: ['ws'] }));
  const a = F.apps(); a.push('msk');
  t('返した配列を書き換えても中身は変わらない', JSON.stringify(F.apps()) === '["ws"]');
}

console.log('\n— 2. 使うアプリで絞る（画面の表示だけ）—');
const WIZ = (/var WIZ_STEPS = \[[\s\S]*?\n\];/.exec(CS) || [''])[0];
function sandbox(apps) {
  const F = apps === undefined ? null : { apps: () => apps };
  const box = { window: F ? { SUFacility: F } : {}, Object };
  if (F) box.SUFacility = F;
  vm.createContext(box);
  vm.runInContext(WIZ + '\n' + cut(CS, 'csAppUsed_') + '\n' + cut(CS, 'wizSteps_'), box);
  return box;
}
{
  const b = sandbox(['ws', 'msk']);
  t('★使うアプリは出す・使わないアプリは出さない', b.csAppUsed_('ws') && b.csAppUsed_('msk') && !b.csAppUsed_('geno') && !b.csAppUsed_('master'));
  t('★不具合の報告先は apps に無くても出す', b.csAppUsed_('report') === true);
  const steps = b.wizSteps_().map(s => s.id + (s.sys ? ':' + s.sys.join('+') : ''));
  t('★初回の案内は使うアプリの段だけ（入居者マスタの段は出さない・専用GASの段は申送と報告先だけ）', JSON.stringify(steps) === JSON.stringify(['fac', 'ws:ws', 'own:msk+report']), steps);
  t('元の WIZ_STEPS は書き換えない', b.WIZ_STEPS[3].sys.length === 8, b.WIZ_STEPS[3].sys);
}
{
  const b = sandbox(null);
  t('★apps を書いていない施設は全部出す', ['ws', 'master', 'adm', 'tp', 'haiben', 'weight', 'msk', 'geno', 'analyzer'].every(id => b.csAppUsed_(id)) && b.wizSteps_().length === 4);
  const c = sandbox(undefined);
  t('施設情報の部品が無い時も全部出す', c.csAppUsed_('geno') === true && c.wizSteps_().length === 4);
}

console.log('\n— 3. 入っている設定は隠さない・SYSTEMS は絞らない —');
t('★欄を隠すのは「使わない」かつ「URL が入っていない」時だけ', /cards\[j\]\.node\.hidden = !\(csAppUsed_\(sy\.id\) \|\| !!readCur\(sy\)\.url\);/.test(CS));
t('施設情報が後から読めた時にもう一度当てる', /SUFacility\.onReady\(function\(\)\{ try\{ applyUsedApps\(\); \}catch\(e\)\{\} \}\);/.test(CS));
t('★控え・復元・見張りは今までどおり SYSTEMS 全部（csAppUsed_ を使わない）', !/csAppUsed_/.test(cut(CS, 'watchedKeys')) && (CS.match(/csAppUsed_/g) || []).length === 3, (CS.match(/csAppUsed_/g) || []).length);   /* 定義・初回の案内・欄の3か所だけ */
t('初回の案内は絞った段で描く', /wizSteps_\(\)\.forEach\(function\(step, i\)\{/.test(CS));

console.log('\n— 4. 端末の用途が未設定の時の帯 —');
const note = (/<div class="cd role-note" id="roleNote"[^>]*>([\s\S]*?)<\/div>/.exec(CS) || [, ''])[1];
t('★帯がある（最初は隠しておく）', /id="roleNote" role="note" hidden/.test(CS) && /用途[\s\S]*まだ決まっていません/.test(note));
t('★帯は元の値（su_device_role）が無い時だけ出す', /var rawRole=localStorage\.getItem\('su_device_role'\); \$\('roleNote'\)\.hidden = !!rawRole;/.test(CS));
t('★帯に切り替えのボタンを置かない（入居者マスタの「管理者の方（端末設定を変更）」へ案内）', !/<button/.test(note) && /管理者の方（端末設定を変更）/.test(note));
t('用途の判定（getDeviceRole の既定は事務所）は変えない', /function getDeviceRole\(\)\{ try\{ return localStorage\.getItem\('su_device_role'\)\|\|'office'; \}catch\(e\)\{ return 'office'; \} \}/.test(CS));

console.log('\n— 5. この施設の設定 —');
const prof = JSON.parse(read('facility-profile.sample.json'));
t('★見本は apps を書かない＝全部使う（本番も apps を書かず、画面は今までどおり）', !('apps' in prof));
t('apps の書き方の注記がある（id の一覧）', /apps に id の配列/.test(prof._noteApps || '') && /msk（申送ビューア）/.test(prof._noteApps || ''));
t('接続設定は新しい版の施設情報の部品を読む', /<script src="su-facility\.js\?v=2026-10-14"><\/script>/.test(CS));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
