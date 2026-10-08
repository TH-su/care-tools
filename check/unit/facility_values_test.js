/* 施設固有の値を施設情報（facility-profile.json・su-facility.js）へ移したことの検証（2026-10-08・監査10月版 #10・本人決定 7a＝画面だけ）。
   実物の su-facility.js を vm で動かし、画面の関数は HTML から切り出す（写経しない）。

   守りたいこと:
   1. su-facility.js が municipality（市区町村）を読み、形の崩れた値は捨てる
   2. デイ利用表の曜日の列の数（6）は帳票の形なので施設情報へ移さない（5日・7日は表の組み直しが要る）
   3. 週間計画の報酬マスタの「自治体」は、保存済みの値を優先し、無ければ施設情報から（コードに市の名前を書かない）
   4. 入居者マスタのデイの判定は、以前の /デイ|せせらぎ/ と同じ結果を、事業所の名前をコードに書かずに出す
   5. 週間計画・入居者マスタに以前の直書き（'熊本市'・デイの判定の事業所名）が残っていない
   ★配っている facility-profile.json の値そのもの（市の名前など）には縛らない＝外販で差し替えても落ちない */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PROFILE = JSON.parse(read('facility-profile.json'));

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}
function cutFrom(src, name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', head), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(head, i + 1); } }
  throw new Error('終端が見つからない: ' + name);
}
/* 実物の su-facility.js を、控え（localStorage）に入れた設定で起動する。fetch は無し＝控えだけで決まる */
function facility(profile) {
  const store = {};
  if (profile !== undefined) store.su_facility_json_v1 = JSON.stringify(profile);
  const win = {};
  const ctx = { window: win, localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {} }, JSON, Math, String, Array, Object, parseInt };
  vm.createContext(ctx);
  vm.runInContext(read('su-facility.js'), ctx, { filename: 'su-facility.js' });
  return win.SUFacility;
}

console.log('\n— 1. 施設情報の読み口 —');
{
  const F = facility(PROFILE);
  t('配っている facility-profile.json の市区町村（文字）をそのまま返す', typeof PROFILE.municipality === 'string' && F.municipality() === PROFILE.municipality, F.municipality());
  const other = JSON.parse(JSON.stringify(PROFILE)); other.municipality = '架空市';
  t('別の施設の設定ならその市区町村', facility(other).municipality() === '架空市', facility(other).municipality());
  const bad = JSON.parse(JSON.stringify(PROFILE)); bad.municipality = 123;
  t('文字でない市区町村は捨てる（空）', facility(bad).municipality() === '', facility(bad).municipality());
  const N = facility(undefined);
  t('設定が無ければ空', N.municipality() === '', N.municipality());
  t('営業日の数の項目は持たない（帳票の形なので施設情報へは移さない）', !('weekDays' in N) && !/weekDays/.test(read('su-facility.js')), '');
}

console.log('\n— 2. デイ利用表の曜日の列 —');
{
  const src = read('daycare-roster.html');
  t('NDAY は帳票の形として 6 のまま（理由を注記）', /帳票の形[\s\S]{0,200}\nconst NDAY\s*=\s*6;/.test(src), '');
}

console.log('\n— 3. 週間計画の報酬マスタの「自治体」—');
{
  const src = read('care-schedule.html');
  const def = src.match(/const RATE_MASTER_DEFAULT = \{[\s\S]*?\n  municipality: ([^,]+),/);
  t('既定に市の名前を書かない（空）', !!def && def[1].trim() === "''", def && def[1]);
  const fn = cutFrom(src, 'csProfileMunicipality_');
  const run = (F) => { const c = { window: { SUFacility: F }, SUFacility: F }; vm.createContext(c); vm.runInContext(fn, c); return c.csProfileMunicipality_(); };
  t('施設情報の市区町村を返す', run(facility(PROFILE)) === PROFILE.municipality, run(facility(PROFILE)));
  const alt = JSON.parse(JSON.stringify(PROFILE)); alt.municipality = '架空市';
  t('別の施設の設定ならその市区町村', run(facility(alt)) === '架空市', run(facility(alt)));
  t('施設情報が無い時は空（例外を出さない）', run(undefined) === '' && run(facility(undefined)) === '', '');
  const norm = cutFrom(src, 'normalizeRateMaster_');
  t('保存済みの値を優先し、無い・空の時だけ施設情報を使う', /src\.municipality\s*\?\s*src\.municipality\s*:\s*\(d\.municipality \|\| csProfileMunicipality_\(\)\)/.test(norm)
    && /if \(!m0\.municipality\) m0\.municipality = csProfileMunicipality_\(\);/.test(norm), '');
  t('施設情報が後から届いた端末でも、空のままにしない（届いた時に空なら入れる）', /SUFacility\.onReady\(function \(\) \{\s*try \{ if \(typeof DB === 'object' && DB && DB\.rateMaster && !DB\.rateMaster\.municipality\) DB\.rateMaster\.municipality = csProfileMunicipality_\(\);/.test(src), '');
  t('su-facility.js を読み込む（記録の口より後）', src.indexOf('<script src="su-facility.js?v=2026-10-08"></script>') > src.indexOf('function csNote_('), '');
}

console.log('\n— 4. 入居者マスタのデイの判定 —');
{
  const src = read('resident-master.html');
  const fn = cutFrom(src, 'mcIsDayFacility_');
  const run = (F, f) => { const c = { window: { SUFacility: F }, SUFacility: F, String }; vm.createContext(c); vm.runInContext(fn, c); return c.mcIsDayFacility_(f); };
  const F = facility(PROFILE);
  const day = PROFILE.offices.find(o => o.kind === '通所');
  const others = PROFILE.offices.filter(o => o.kind !== '通所');
  const cases = ['デイ', 'デイ' + day.name, day.name, day.formalName, day.name + '（入浴）', '', null]
    .concat(others.map(o => o.name)).concat(others.map(o => o.formalName));
  const old = f => new RegExp('デイ|' + day.name).test(String(f || ''));
  const diff = cases.filter(c => old(c) !== run(F, c));
  t('配っている設定で、以前の判定（デイ|通所の名前）と全部同じ（' + cases.length + '通り）', diff.length === 0, diff);
  const other = JSON.parse(JSON.stringify(PROFILE));
  other.offices.forEach(o => { if (o.kind === '通所') { o.name = 'ひだまり'; o.formalName = 'ひだまり通所'; o.aliases = ['陽だまり']; } });
  const G = facility(other);
  t('別の施設の設定では、その施設の通所の名前・正式名・別名で見分ける', run(G, 'ひだまり') && run(G, '陽だまり') && !run(G, day.name), [run(G, 'ひだまり'), run(G, '陽だまり'), run(G, day.name)]);
  const notReady = { ready: () => false, office: () => ({ name: '', formalName: '', aliases: [] }) };
  t('施設情報が読めない時は「デイ」と「通所」の語で見る', run(notReady, '通所') === true && run(notReady, 'デイ') === true && run(notReady, '訪問') === false, '');
  t('以前の /デイ|せせらぎ/ の直書きが無い', !/デイ\|せせらぎ/.test(src), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
