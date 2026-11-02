/* 施設の差し替えの試験の土台（2026-11-02 新設・施設の導入手順）。
   facility-profile.json の差し替えだけで全アプリが動くかは check/facility-swap.mjs が20画面を開いて確かめる（時間がかかるので run-all には入れない）。
   ここでは、その道具が正しく組まれていることを軽く確かめる。
     A 手順書（施設の導入手順.md）・道具（check/facility-swap.mjs）・2つ目の架空の施設情報（check/fixtures/facility-profile.alt.mjs）が公開の許可に入っている
     B 2つ目の施設情報は見本と名前・事業所名・電話・市区町村・住所・階の見出しを共有しない（片方がもう片方を含む形も無い）。形は施設情報の確かめを通る
     C 道具の画面の表（PAGES）に、全アプリの20画面が過不足なく1回ずつある。「施設情報を読む」の印は画面が su-facility.js を読み込むかと一致する
     D 手元の配信（check/lib.mjs の startServer）は、施設情報を渡すとそれを返し、渡さない時は今までどおり（本番が無ければ見本）
     E 手順書が順番の要（形の確かめ・Secret・接続設定・端末の用途・使える人・最初に確かめる画面）を書いている
   実行: node check/unit/facility_swap_test.js */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 全アプリ＝20画面（採点の決まりの表と同じ） */
const ALL20 = ['care-schedule.html', 'weight-record.html', 'training-plan.html', 'supplies.html', 'shift-app.html', 'work-schedule.html',
  'staff-master.html', 'connection-settings.html', 'support-overview.html', 'moushiokuri-viewer.html', 'resident-master.html',
  'visit-overview.html', 'admission-flow.html', 'daycare-roster.html', 'facesheet.html', 'index.html', 'overview-compare.html',
  'genogram.html', 'patch-calendar.html', 'shift-analyzer.html'];
const DOC = '施設の導入手順.md';

function get(url) {
  return new Promise((ok, ng) => { http.get(url, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b })); }).on('error', ng); });
}

(async () => {
  console.log('\n— A. 公開の許可 —');
  const GI = read('.gitignore');
  t('.gitignore に手順書の許可（!/' + DOC + '）がある', GI.split('\n').some((l) => l.trim() === '!/' + DOC));
  t('.gitignore に道具の許可（!/check/facility-swap.mjs）がある', /^!\/check\/facility-swap\.mjs$/m.test(GI));
  t('2つ目の施設情報は材料の許可（!/check/fixtures/*.mjs）に入る名前', /^!\/check\/fixtures\/\*\.mjs$/m.test(GI) && fs.existsSync(path.join(ROOT, 'check', 'fixtures', 'facility-profile.alt.mjs')));
  t('手順書がある', fs.existsSync(path.join(ROOT, DOC)));

  const swap = await import(pathToFileURL(path.join(ROOT, 'check', 'facility-swap.mjs')).href);
  const alt = (await import(pathToFileURL(swap.ALT_PROFILE_FILE).href)).default;
  const sample = JSON.parse(read('facility-profile.sample.json'));

  console.log('\n— B. 2つ目の施設情報は見本と違う —');
  const words = (p) => {
    const w = swap.profileNames(p).slice();
    const add = (v) => { if (typeof v === 'string' && v.trim()) w.push(v.trim()); };
    add(p.municipality);
    for (const o of p.offices || []) { add(o.tel); add(o.address); }
    for (const f of p.floors || []) add(f.label);
    if (p.support) { add(p.support.contactTel); add(p.support.contactName); }
    for (const c of p.visitingClinics || []) for (const a of c.aliases || []) add(a);
    return [...new Set(w)];
  };
  const wa = words(alt), ws = words(sample);
  const shared = wa.filter((a) => ws.some((s) => a.includes(s) || s.includes(a)));
  t('名前・事業所名・電話・市区町村・住所・階の見出しを見本と共有しない（含む形も無い）', shared.length === 0, shared);
  t('見本の名前を数える語が空でない（法人名・施設名・事業所名・正式名）', swap.profileNames(sample).length >= 8, swap.profileNames(sample).length);
  t('2つ目の施設の名前を数える語が空でない', swap.displayNames(alt).length >= 6, swap.displayNames(alt).length);
  t('事業所の種類は 施設/訪問/通所 の3つ（見本と同じ形）', JSON.stringify((alt.offices || []).map((o) => o.kind)) === JSON.stringify(['施設', '訪問', '通所']));
  t('施設名・法人名・市区町村・階の見出しが見本と違う', alt.facilityName !== sample.facilityName && alt.corpName !== sample.corpName && alt.municipality !== sample.municipality
    && (alt.floors || []).every((f, i) => sample.floors[i] && f.label !== sample.floors[i].label));
  const { checkFacilityProfile } = await import(pathToFileURL(path.join(ROOT, 'check', 'facility-secret-check.mjs')).href);
  const chk = checkFacilityProfile(JSON.stringify(alt), read('facility-profile.sample.json'));
  t('2つ目の施設情報は施設情報の確かめ（facility-secret-check）を通る', chk.ok, chk.errors);

  console.log('\n— C. 20画面の表 —');
  const files = swap.PAGES.map((p) => p.file);
  t('表は20行', files.length === 20, files.length);
  t('全アプリの20画面が全部ある', ALL20.every((f) => files.includes(f)), ALL20.filter((f) => !files.includes(f)));
  t('表に20画面以外が無い・重なりが無い', files.every((f) => ALL20.includes(f)) && new Set(files).size === files.length);
  const loadsFacility = (f) => /<script[^>]*\bsrc="su-facility\.js[?"]/.test(read(f));
  const wrongReads = swap.PAGES.filter((p) => p.reads !== loadsFacility(p.file)).map((p) => p.file);
  t('「施設情報を読む」の印は画面が su-facility.js を読み込むかと一致する', wrongReads.length === 0, wrongReads);
  const badShows = swap.PAGES.filter((p) => p.shows && !p.reads).map((p) => p.file);
  t('「名前を出す」画面は施設情報を読む画面だけ', badShows.length === 0, badShows);
  t('メニューとデイ利用表は「名前を出す」画面', ['index.html', 'daycare-roster.html'].every((f) => swap.PAGES.find((p) => p.file === f).shows));
  t('どの行にも理由（why）がある', swap.PAGES.every((p) => typeof p.why === 'string' && p.why.length > 4));

  console.log('\n— D. 手元の配信の施設情報 —');
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'check', 'lib.mjs')).href);
  const s1 = await startServer(ROOT, 0, { facilityProfile: alt });
  try {
    const r = await get(s1.url + '/facility-profile.json?v=1');
    let j = null; try { j = JSON.parse(r.body); } catch (e) { j = null; }
    t('施設情報を渡すと /facility-profile.json はそれを返す', r.status === 200 && j && j.facilityName === alt.facilityName, r.status);
    const r2 = await get(s1.url + '/index.html');
    t('ほかのファイルは今までどおりファイルから返す', r2.status === 200 && r2.body.includes('<html'));
  } finally { await s1.close(); }
  const s2 = await startServer(ROOT);
  try {
    const hasProd = fs.existsSync(path.join(ROOT, 'facility-profile.json'));
    const r = await get(s2.url + '/facility-profile.json');
    let j = null; try { j = JSON.parse(r.body); } catch (e) { j = null; }
    if (hasProd) t('渡さない時は手元の facility-profile.json を返す（今までどおり）', r.status === 200 && j && typeof j === 'object');
    else t('渡さない時は今までどおり見本を返す', r.status === 200 && j && j.facilityName === sample.facilityName);
  } finally { await s2.close(); }

  console.log('\n— E. 手順書の要 —');
  const D = read(DOC);
  const need = ['facility-profile.sample.json', 'node check/facility-secret-check.mjs', 'FACILITY_PROFILE_JSON', 'pages.yml', 'connection-settings.html',
    'su_device_role', 'app-access.html', 'accounts.html', 'apps', 'scheduleColors', 'committeeDefaults', 'check/facility-swap.mjs'];
  const miss = need.filter((w) => !D.includes(w));
  t('手順書に順番の要がある', miss.length === 0, miss);
  const order = ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.', '## 8.'].map((h) => D.indexOf(h));
  t('手順は 1〜8 の順に並ぶ', order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), order);
  t('手順書に見本の施設名・事業所名を書いていない', swap.profileNames(sample).every((n) => !D.includes(n)));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験が止まった: ' + (e && e.message)); process.exit(1); });
