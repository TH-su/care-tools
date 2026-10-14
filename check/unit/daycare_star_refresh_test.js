/* デイ利用表の☆（訪問診療）を、施設情報を取り直した後に計算し直す（2026-10-14 新設・監査10月版 第4版 3）。
   守りたいこと:
     A 端末の控えが古く（visitingClinics が無い）☆が0件で決まっても、施設情報を取り直して医療機関が分かったら、
       名簿を取り直して☆を付け、画面を描き直す
     B 医療機関が変わっていなければ、名簿を取り直さない（余分な通信をしない）
     C まだ☆を計算していない時（名簿の取得前）は何もしない（最初の計算に任せる）
     D 名簿の取り直しの最中なら、少し待ってからやり直す（取りこぼさない・最大5回）
     E 施設情報の onReady で、この確かめが動く
   ★画面の本物の関数（dcrFetchMasterHosp・dcrClinicOf_・dcrClinicSig_・dcrRefreshStarsIfStale_）と本物の su-facility.js を動かす。
     偽物にするのは、名簿の取得（SU.data.getRoster）・タイマー・描画だけ。利用者は架空。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

const SRC = read('daycare-roster.html');
const grab = name => {
  const s = SRC.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('見つかりません: ' + name);
  return SRC.slice(s, SRC.indexOf('\n}', s) + 2);
};
const SAMPLE = JSON.parse(read('facility-profile.sample.json'));
const OLD = JSON.parse(JSON.stringify(SAMPLE)); delete OLD.visitingClinics;     // 10/14 より前の控え（医療機関なし）
function facility(profile) {
  const box = { window: {}, console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('su-facility.js'), box);
  return box.SUFacility;
}

function makeBox() {
  const calls = { roster: 0, render: 0 }, timers = [];
  const box = {
    console, JSON, String, Object, Array, Date, Promise, Math, isFinite,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    window: {},
    DB: { residents: [] }, renderAll: () => { calls.render++; },
    dcrGetMasterCfg: () => ({ url: 'https://example.invalid/exec', token: '見本' }),
    suFacReady_: () => Promise.resolve(true),
    SU: { data: { getRoster: () => { calls.roster++; return Promise.resolve({ roster: [
      { masterId: 'm1', hospital: '見本クリニック（内科）', visitDay: '火', room: '101', name: '見本 甲' },
      { masterId: 'm2', hospital: 'ほかの病院', visitDay: '水', room: '201', name: '見本 乙' }
    ] }); } } }
  };
  vm.createContext(box);
  vm.runInContext([
    'var DCR_HOSP_TTL_MS = 60000, dcrHospMap = null, dcrVmedMap = null, dcrRoomMap = null, dcrNameCutMap = null, dcrHospAt = 0, dcrHospRev = null, dcrHospBusy = false, dcrClinicSigUsed = null;',
    grab('dcrClinicOf_'), grab('dcrClinicSig_'), grab('dcrRefreshStarsIfStale_'), grab('dcrFetchMasterHosp')
  ].join('\n'), box);
  const setFac = F => { box.window.SUFacility = F; box.SUFacility = F; };
  return { box, calls, timers, setFac };
}

(async () => {
  console.log('\n— A. 古い控え→☆なし→施設情報を取り直したら☆が付く —');
  {
    const { box, calls, setFac } = makeBox();
    setFac(facility(OLD));
    await box.dcrFetchMasterHosp(true); await settle();
    const before = JSON.stringify(box.dcrVmedMap);
    setFac(facility(SAMPLE));                                     // 取り直した施設情報（見本クリニックあり）
    const ok = await box.dcrRefreshStarsIfStale_(); await settle();
    t('古い控えでは☆は0件', before === '{}', before);
    t('取り直した後は、医療機関が当たる方に往診曜日の☆', JSON.stringify(box.dcrVmedMap) === JSON.stringify({ m1: '火' }), box.dcrVmedMap);
    t('名簿を取り直して画面を描き直した', ok === true && calls.roster === 2 && calls.render === 1, calls);
  }
  console.log('\n— B. 医療機関が変わっていなければ取り直さない —');
  {
    const { box, calls, setFac } = makeBox();
    setFac(facility(SAMPLE));
    await box.dcrFetchMasterHosp(true); await settle();
    const ok = await box.dcrRefreshStarsIfStale_();
    t('名簿の取得は最初の1回だけ・描き直しなし', ok === false && calls.roster === 1 && calls.render === 0, calls);
  }
  console.log('\n— C. まだ☆を計算していない時は何もしない —');
  {
    const { box, calls, setFac } = makeBox();
    setFac(facility(SAMPLE));
    const ok = await box.dcrRefreshStarsIfStale_();
    t('名簿を取らない', ok === false && calls.roster === 0, calls);
  }
  console.log('\n— D. 取り直しの最中なら待ってやり直す —');
  {
    const { box, calls, timers, setFac } = makeBox();
    setFac(facility(OLD));
    await box.dcrFetchMasterHosp(true); await settle();
    setFac(facility(SAMPLE));
    box.dcrHospBusy = true;                                       // ほかの取り直しが走っている
    const p = box.dcrRefreshStarsIfStale_();
    await settle();
    t('取り直しの最中は 1.5 秒待つ', timers.length === 1 && timers[0].ms === 1500, timers.map(x => x.ms));
    box.dcrHospBusy = false; timers[0].fn();
    const ok = await p; await settle();
    t('待った後にやり直して☆が付く', ok === true && JSON.stringify(box.dcrVmedMap) === JSON.stringify({ m1: '火' }) && calls.render === 1, [ok, box.dcrVmedMap, calls]);
  }
  console.log('\n— E. 施設情報の onReady で動く —');
  t('onReady に確かめの関数をつないでいる', /SUFacility\.onReady\(function \(\) \{ try \{ dcrRefreshStarsIfStale_\(\); \}/.test(SRC));
  t('☆の計算のたびに、使った医療機関を控える', /dcrClinicSigUsed = dcrClinicSig_\(\);/.test(SRC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
