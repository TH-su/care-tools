/* 施設情報の「画面ごとの設定の塊」（SUFacility.section）の試験（2026-11-02・品質改善 第3期 便3）
   守りたいこと:
     A 書いていなければ null（画面は今までの既定のまま動く）
     B scheduleColors は最上位、committeeDefaults は corpSettings の中から読む。返すのは写し（書き換えても元は変わらない）
     C 名前の一覧に無い名前・塊でない値（文字・数）・大きすぎる塊は null
     D 端末の控え（読めた設定を norm した形）から起動しても、塊を失わない
   架空データだけを使う。実行: node check/unit/facility_section_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const SAMPLE_SRC = read('facility-profile.sample.json');
function prof(edit) { const p = JSON.parse(SAMPLE_SRC); delete p.scheduleColors; if (p.corpSettings) delete p.corpSettings.committeeDefaults; edit(p); return p; }

/* 実物の su-facility.js を読む。cached は端末の控えの中身、remote は facility-profile.json の中身 */
function load(cached, remote) {
  const store = {};
  if (cached !== undefined) store.su_facility_json_v1 = JSON.stringify(cached);
  const box = { console, JSON, Promise,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } } };
  if (remote !== undefined) box.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(remote) });
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('su-facility.js'), box);
  return { F: box.SUFacility, store };
}
const flush = () => new Promise(r => setTimeout(r, 0));

(async () => {
  console.log('A 書いていない時');
  { const { F } = load(prof(() => {})); t('scheduleColors は null', F.section('scheduleColors') === null); t('committeeDefaults は null', F.section('committeeDefaults') === null); }
  { const { F } = load(undefined); t('設定が無い端末でも null で例外を出さない', F.section('scheduleColors') === null); }

  console.log('B 読む場所と写し');
  const COL = { visit: { time: '#112233', body: '#445566' } }, CMT = [{ code: 'x1', name: '見本の委員会' }];
  { const { F } = load(prof(p => { p.scheduleColors = COL; p.corpSettings = Object.assign({}, p.corpSettings, { committeeDefaults: CMT }); }));
    const a = F.section('scheduleColors');
    t('scheduleColors を最上位から読む', a && a.visit && a.visit.time === '#112233', a);
    a.visit.time = '#000000';
    t('返すのは写し（書き換えても次の読みは元のまま）', F.section('scheduleColors').visit.time === '#112233');
    const c = F.section('committeeDefaults');
    t('committeeDefaults を corpSettings の中から読む', Array.isArray(c) && c[0].code === 'x1', c);
    t('法人設定の既存の読み口は変わらない', typeof F.corpSettings().homeGuidelineName === 'string');
  }
  { const { F } = load(prof(p => { p.committeeDefaults = CMT; }));
    t('最上位に置いた committeeDefaults は読まない（法人設定の中だけ）', F.section('committeeDefaults') === null); }

  console.log('C 読まないもの');
  { const { F } = load(prof(p => { p.scheduleColors = COL; p.offices2 = { a: 1 }; }));
    t('名前の一覧に無い名前は null', F.section('offices2') === null && F.section('') === null && F.section(null) === null);
    t('組み込みの名前（toString 等）も null', F.section('toString') === null && F.section('hasOwnProperty') === null); }
  { const { F } = load(prof(p => { p.scheduleColors = '#FFFF00'; })); t('文字は塊でないので null', F.section('scheduleColors') === null); }
  { const { F } = load(prof(p => { p.scheduleColors = 5; })); t('数は塊でないので null', F.section('scheduleColors') === null); }
  { const big = {}; for (let i = 0; i < 2000; i++) big['k' + i] = '#ABCDEF'; const { F } = load(prof(p => { p.scheduleColors = big; }));
    t('大きすぎる塊（2万字超）は null', F.section('scheduleColors') === null); }

  console.log('D 端末の控えから起動');
  { const raw = prof(p => { p.scheduleColors = COL; p.corpSettings = Object.assign({}, p.corpSettings, { committeeDefaults: CMT }); });
    const first = load(undefined, raw); await flush(); await flush();
    t('読めた設定を控えに書く', !!first.store.su_facility_json_v1);
    const second = load(JSON.parse(first.store.su_facility_json_v1));
    const a = second.F.section('scheduleColors'), c = second.F.section('committeeDefaults');
    t('控えから起動しても scheduleColors が残る', a && a.visit && a.visit.body === '#445566', a);
    t('控えから起動しても committeeDefaults が残る', Array.isArray(c) && c.length === 1, c); }

  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})();
