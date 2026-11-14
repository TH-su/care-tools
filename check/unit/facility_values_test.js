/* 施設固有の値を施設情報（facility-profile.json・su-facility.js）へ移したことの検証（2026-10-08・監査10月版 #10・本人決定 7a＝画面だけ）。
   実物の su-facility.js を vm で動かし、画面の関数は HTML から切り出す（写経しない）。

   守りたいこと:
   1. su-facility.js が municipality（市区町村）を読み、形の崩れた値は捨てる
   2. デイ利用表の曜日の列の数（6）は帳票の形なので施設情報へ移さない（5日・7日は表の組み直しが要る）
   3. 週間計画の報酬マスタの「自治体」は、保存済みの値を優先し、無ければ施設情報から（コードに市の名前を書かない）
   4. 入居者マスタのデイの判定は、以前の /デイ|（通所の事業所名）/ と同じ結果を、事業所の名前をコードに書かずに出す
   5. 週間計画・入居者マスタに以前の直書き（'熊本市'・デイの判定の事業所名）が残っていない
   6. 貼り薬カレンダーの薬の名前と貼る場所は、施設情報に書いた時だけ差し替わり、書いていない（見本）・崩れている時は既定（2026-11-13）
   7. 週間計画の単位単価は、施設情報の rateDefaults.unitPrice（1〜100 円）を保存の無い時の既定にだけ使い、保存済みの値・見本の時は今の 10.27（2026-11-13）
   ★配っている facility-profile.json の値そのもの（市の名前など）には縛らない＝外販で差し替えても落ちない */
'use strict';
const fs = require('fs');
/* 入居者マスタの画面のスクリプトは 2026-11-13 に resident-master.js へ移した（判定の区間 MC-JUDGE だけ HTML に残す）。移す前と同じ文字に戻して確かめる */
const { readMaster } = require('../master-page.cjs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => readMaster(path.join(ROOT, f));
const PROFILE = JSON.parse(read('facility-profile.sample.json'));

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

console.log('\n— 1b. 適格請求書発行事業者の登録番号（2026-11-13 第6段 SP-03）—');
{
  t('見本には登録番号の項目があり、空（見本の施設の紙には出ない）', Object.prototype.hasOwnProperty.call(PROFILE, 'invoiceNo') && PROFILE.invoiceNo === '' && facility(PROFILE).invoiceNo() === '', PROFILE.invoiceNo);
  const withNo = (v) => { const p = JSON.parse(JSON.stringify(PROFILE)); p.invoiceNo = v; return facility(p).invoiceNo(); };
  t('T と13桁の数字ならそのまま返す（架空の番号）', withNo('T0000000000001') === 'T0000000000001', withNo('T0000000000001'));
  t('空白・ハイフンは除いて読む', withNo(' T0000-0000-00001 ') === 'T0000000000001', withNo(' T0000-0000-00001 '));
  t('全角の英数字は半角に直して読む（貼る前の確かめと同じ読み方）', withNo('Ｔ００００００００００００１') === 'T0000000000001', withNo('Ｔ００００００００００００１'));
  t('桁が違う・T が無い・文字でない時は空（紙に出さない）', withNo('T000000000000') === '' && withNo('0000000000001') === '' && withNo(123) === '' && withNo('T00000000000001X') === '', '');
  t('書いていない施設は空', (() => { const p = JSON.parse(JSON.stringify(PROFILE)); delete p.invoiceNo; return facility(p).invoiceNo(); })() === '');
  t('設定が無ければ空', facility(undefined).invoiceNo() === '');
  /* 端末の控え（norm 済みの形）から読み直しても残る */
  const p2 = JSON.parse(JSON.stringify(PROFILE)); p2.invoiceNo = 'T0000000000002';
  const once = facility(p2).get();
  t('端末の控えから読み直しても登録番号は残る', facility(once).invoiceNo() === 'T0000000000002', once && once.invoiceNo);
}

console.log('\n— 2. デイ利用表の曜日の列 —');
{
  const src = read('daycare-roster.html');
  t('NDAY は帳票の幅の基準の 6 日のまま（理由を注記）', /帳票の形[\s\S]{0,200}\nconst NDAY\s*=\s*6;/.test(src), '');
  /* 曜日の列は営業曜日（dcrDays_・K5）で回す。NDAY の数で曜日を回す処理が残っていれば、7日・5日の施設で列がずれる */
  t('曜日の列を NDAY の数で回す処理は残っていない（営業曜日で回す）', !/for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*NDAY\b/.test(src) && /function dcrDays_\(/.test(src), (src.match(/for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*NDAY\b[^\n]*/g) || []));
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
  t('su-facility.js を読み込む（記録の口より後）', src.search(/<script src="su-facility\.js\?v=[0-9A-Za-z._-]+"><\/script>/) > src.indexOf('function csNote_('), '');
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
  /* 事業所名はこの試験にも書かない（公開リポジトリの固有データ0件・2026-10-16）。語はつなぎ合わせて作る */
  const DAY_OLD = new RegExp('デイ\\|' + 'せせ' + 'らぎ');
  t('以前の /デイ|（通所の事業所名）/ の直書きが無い', !DAY_OLD.test(src), '');
}

console.log('\n— 6. 貼り薬カレンダーの薬の名前と貼る場所（代表者の決定 2026-11-13） —');
{
  const src = read('patch-calendar.html');
  const varLine = (n) => (src.match(new RegExp('\\nvar ' + n + ' = [^\\n]*')) || [''])[0];
  const run = (F) => { const c = { window: { SUFacility: F }, SUFacility: F, Array, JSON, String }; vm.createContext(c);
    vm.runInContext([varLine('PC_SITE_MIN'), varLine('PC_BAD_CH'), cutFrom(src, 'pcStr'), cutFrom(src, 'pcCfgOf'), cutFrom(src, 'pcReadCfg')].join('\n'), c); return c.pcReadCfg(); };
  t('配っている見本（patchCalendar を書いていない）では既定＝null', run(facility(PROFILE)) === null);
  const six = JSON.parse(JSON.stringify(PROFILE));
  six.patchCalendar = { drug: '架空テープ', sites: ['左の肩', '右の肩', '左の背中', '右の背中', '左の腰', '右の腰'].map(n => ({ name: n })) };
  const r6 = run(facility(six));
  t('別の施設の設定（6か所）ならその名前と場所', r6 && r6.drug === '架空テープ' && r6.sites.length === 6 && r6.sites[3].full === '右の背中', r6);
  const ten = JSON.parse(JSON.stringify(PROFILE));
  ten.patchCalendar = { sites: Array.from({ length: 10 }, (_, i) => ({ name: '場所' + (i + 1) })) };
  t('10か所（保存の番号は 1〜8 だけ）は既定＝null', run(facility(ten)) === null);
  const bad = JSON.parse(JSON.stringify(PROFILE)); bad.patchCalendar = '架空テープ';
  t('塊でない値は既定＝null', run(facility(bad)) === null);
  t('施設情報が読めない（su-facility.js が無い）時は既定＝null', run(undefined) === null);
}

console.log('\n— 7. 週間計画の単位単価の既定（代表者の決定 2026-11-13・台帳 CS-02） —');
{
  const src = read('care-schedule.html');
  /* 報酬マスタの既定から単価の既定までを本物のまま切り出して動かす（写経しない） */
  const a = src.indexOf('const RATE_MASTER_SCHEMA_V'), b = src.indexOf('function rmDefaultUnitPrice_');
  const chunk = src.slice(a, src.indexOf('\n}\n', b) + 3);
  const boot = (F) => {
    const c = { window: { SUFacility: F }, SUFacility: F };
    vm.createContext(c);
    vm.runInContext(chunk + '\nthis.N = normalizeRateMaster_; this.B = rmBaseUnitPrice_; this.D = RATE_MASTER_DEFAULT;', c);
    return c;
  };
  const withUp = (v) => { const p = JSON.parse(JSON.stringify(PROFILE)); p.rateDefaults = { unitPrice: v }; return facility(p); };
  const S = boot(facility(PROFILE));
  t('コードの既定は今の 10.27 のまま', S.D.unitPrice === 10.27, S.D.unitPrice);
  t('配っている見本（rateDefaults を書いていない）では既定＝10.27', S.B() === 10.27 && S.N(null).master.unitPrice === 10.27, S.B());
  t('見本には rateDefaults そのものは書かない（撮影で見本が配られても画面と紙が変わらない）・書き方の説明はある',
    !('rateDefaults' in PROFILE) && typeof PROFILE._noteRateDefaults === 'string' && /unitPrice/.test(PROFILE._noteRateDefaults), '');
  const X = boot(withUp(10.84));
  t('施設情報に単価がある時、保存の無い報酬マスタの既定はその値', X.B() === 10.84 && X.N(null).master.unitPrice === 10.84, X.N(null).master.unitPrice);
  t('保存した報酬マスタに単価の欄が無い時も施設の既定', X.N({ revisionLabel: '架空' }).master.unitPrice === 10.84, '');
  t('保存済みの単価はそのまま（コードの既定と同じ 10.27 でも施設情報で上書きしない）', X.N({ unitPrice: 10.27 }).master.unitPrice === 10.27 && X.N({ unitPrice: 11.4 }).master.unitPrice === 11.4, '');
  const bad = X.N({ unitPrice: 'あ' });
  t('保存の単価が崩れている時は施設の既定に戻し、その値を知らせに書く', bad.master.unitPrice === 10.84 && bad.filled.some(f => /既定 10\.84 円/.test(f)), bad.filled);
  t('範囲外（1〜100 円の外）・数でない・0 の単価は捨てて 10.27', [0, 0.5, 101, '10.84', null, NaN].every(v => boot(withUp(v)).B() === 10.27), '');
  { const p = JSON.parse(JSON.stringify(PROFILE)); p.rateDefaults = 10.84; t('塊でない rateDefaults は捨てて 10.27', boot(facility(p)).B() === 10.27, ''); }
  t('施設情報が読めない（su-facility.js が無い）時は 10.27', boot(undefined).B() === 10.27, '');
  t('事業所情報の単位単価も、保存の無い時・欄の無い時だけ施設の既定（保存済みは || の左で残す）',
    /DB\.office = JSON\.parse\(JSON\.stringify\(DEFAULT_OFFICE\)\);\s*DB\.office\.unitPrice = rmBaseUnitPrice_\(\);/.test(src)
    && /DB\.office\.unitPrice\s*=\s*DB\.office\.unitPrice\s*\|\|\s*rmBaseUnitPrice_\(\);/.test(src)
    && /return Number\(DB\.rateMaster && DB\.rateMaster\.unitPrice\) \|\| rmBaseUnitPrice_\(\);/.test(src), '');
  /* 2026-11-13 反証レビュー 中: 施設情報の控えが無い端末の初回は、起動の時に既定で埋めた物に印を立て、届いた時にその物がそのまま・既定のままなら差し替える */
  const late = () => {
    let sec = null; const cbs = [];
    const F = { section: (n) => (n === 'rateDefaults' ? sec : null), municipality: () => '', onReady: (fn) => cbs.push(fn) };
    const c = { window: { SUFacility: F }, SUFacility: F };
    vm.createContext(c);
    vm.runInContext(chunk + '\nvar DB = { office: { unitPrice: 10.27 }, rateMaster: { unitPrice: 10.27, municipality: "架空市" } };'
      + '\nthis.setPending = function (o, m) { CS_UP_PENDING = { office: o ? DB.office : null, master: m ? DB.rateMaster : null }; };'
      + '\nthis.getDB = function () { return DB; }; this.pending = function () { return CS_UP_PENDING; };', c);
    return { c, arrive: (v) => { sec = v === undefined ? null : { unitPrice: v }; cbs.forEach((f) => f()); } };
  };
  { const L = late(); L.c.setPending(true, true); L.arrive(10.84);
    t('後から届いた時: 起動の時に既定で埋めた事業所情報・報酬マスタは施設の単価に差し替える', L.c.getDB().office.unitPrice === 10.84 && L.c.getDB().rateMaster.unitPrice === 10.84 && L.c.pending() === null, L.c.getDB()); }
  { const L = late(); L.c.setPending(true, true); const D = L.c.getDB(); D.office = { unitPrice: 10.27 }; D.rateMaster = Object.assign({}, D.rateMaster); L.arrive(10.84);
    t('後から届いた時: 保存・適用・共有の取り込みで別の物に替わっていれば差し替えない（10.27 で保存した値も残す）', D.office.unitPrice === 10.27 && D.rateMaster.unitPrice === 10.27, D); }
  { const L = late(); L.c.setPending(true, true); const D = L.c.getDB(); D.office.unitPrice = 11.4; L.arrive(10.84);
    t('後から届いた時: 単価が既定から変わっていれば差し替えない', D.office.unitPrice === 11.4 && D.rateMaster.unitPrice === 10.84, D); }
  { const L = late(); L.arrive(10.84);
    t('後から届いた時: 印が無ければ（既定で埋めていない・施設情報が先に読めていた）差し替えない', L.c.getDB().office.unitPrice === 10.27, ''); }
  { const L = late(); L.c.setPending(true, false); L.arrive(undefined);
    t('後から届いた時: 施設情報に単価が無ければ何もせず、印は下ろす', L.c.getDB().office.unitPrice === 10.27 && L.c.pending() === null, ''); }
  t('起動（loadDB）は、施設情報がまだ読めず単価を既定で埋めた時だけ印を立てる',
    /const upLate = csProfileUnitPrice_\(\) === null;/.test(src) && /CS_UP_PENDING = \(upLate && \(upOfficeFilled \|\| upMasterFilled\)\)/.test(src)
    && /const upMasterFilled = !\(DB\.rateMaster && rmNum_\(DB\.rateMaster\.unitPrice, 1, 100\)\);\s*RM_FILLED_AT_LOAD = ensureRateMaster_\(\);/.test(src), '');
  t('単位単価の説明文（unitPriceHint）は変えない', /unitPriceHint: '地域加算により変わります。1級地\(東京都特別区等\)=11\.40、2級地=11\.12、3級地=10\.84…標準=10\.00',/.test(src), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
