/* 勤怠の「代替休暇」の純関数（kintai-daitai.js）と画面の組み込み（kintai.js・kintai.html）の試験（2026-11-25 新設）
   実行: node check/unit/kintai_daitai_test.js
   守りたいこと:
     1. 設定（fillConfig・readForm）: 既定は切・50%−25%＝換算率25%・1日か半日・2か月・合わせない。範囲の外は既定／入力は断る。取った時の率が大きい時は断る
     2. 期限（deadlineOf）: 60時間を超えた月分の終わりの翌日から2か月（15日締め・月末締め・応当日の無い月は末日）
     3. 付与（grantsOf）: 締めた月分は控え・段A2 の adj を先に読む・締めていない終わった月分は仮・途中の月分は付与しない・換算率を掛けて1分未満を切り捨て
     4. 台帳（ledger）: 期限の早い付与から当てる・前々月と前月を合わせて1日にできる・期限切れ・期限が近い・付与の無い日・足りない（合わせる設定の時は足りなくても取れる）・
        給与へ渡す印（取った分÷換算率・切り捨て・元の60時間超まで）・取り消した行と印の違う特別休暇は数えない
     5. 取る前の確かめ（checkTake）と箱（box）
     6. 画面の組み込み: kintai.html が kintai.js の前に読む・タブは初めは隠す・切の時はタブと箱を出さない・設定の保存に daitai を入れる・特別休暇の種類に印 daitai を使わせない・
        端末に残さない・kintai-calc.js と payroll を呼ばない
   ★架空データだけ（職員は sX… の番号）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const D = require(path.join(ROOT, 'kintai-daitai.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const H = 60;

console.log('1. 設定');
{
  const c = D.fillConfig({});
  t('既定は切', c.on === false);
  t('既定の換算率は25%', c.rate === 0.25 && c.rateNo === 50 && c.rateYes === 25);
  t('既定は1日か半日・2か月・合わせない', c.units === 'both' && c.months === 2 && c.combine === false);
  const c2 = D.fillConfig({ daitai: { on: true, rateNo: 60, rateYes: 30, units: 'day', months: 1, combine: true, warnDays: 7 } });
  t('入れた値を使う', c2.on && Math.abs(c2.rate - 0.3) < 1e-9 && c2.units === 'day' && c2.months === 1 && c2.combine && c2.warnDays === 7);
  const c3 = D.fillConfig({ daitai: { on: 'true', rateNo: 40, rateYes: 20, months: 3, units: 'x' } });
  t('崩れた値は既定（法の下限 50%・25% を下回らない）', c3.on === false && c3.rateNo === 50 && c3.rateYes === 25 && c3.months === 2 && c3.units === 'both');
  const c4 = D.fillConfig({ daitai: { rateNo: 50, rateYes: 50 } });
  t('取った時の率が同じ以上なら既定へ戻す（換算率0にしない）', c4.rate === 0.25);
  t('配列や文字の daitai は既定', D.fillConfig({ daitai: [] }).on === false && D.fillConfig({ daitai: 'on' }).on === false);
  const f = D.readForm({ on: true, rateNo: '50', rateYes: '25', months: '2', warnDays: '', units: 'half', combine: false });
  t('入力を受ける', f.vals && f.vals.on && f.vals.units === 'half' && f.vals.warnDays === 14 && !f.bad.length);
  t('範囲の外は断る', D.readForm({ rateNo: '45' }).bad.length === 1 && D.readForm({ months: '3' }).bad.length === 1 && D.readForm({ rateYes: '1.5' }).bad.length === 1);
  t('取った時の率が大きいと断る', D.readForm({ rateNo: '50', rateYes: '50' }).vals === null);
  t('説明の文', /換算率 25%/.test(D.describe(c)) && /2 か月/.test(D.describe(c)));
}

console.log('2. 期限');
t('15日締め: 12/15 の翌日 12/16 から2か月＝2/15', D.deadlineOf('2026-12-16', 2) === '2027-02-15');
t('月末締め: 12/31 の翌日 1/1 から2か月＝2/28', D.deadlineOf('2027-01-01', 2) === '2027-02-28');
t('月末締め（うるう年）: 1/1 から2か月＝2/29', D.deadlineOf('2028-01-01', 2) === '2028-02-29');
t('応当日の無い月は末日: 12/29 から2か月＝2/28', D.deadlineOf('2026-12-29', 2) === '2027-02-28');
t('11/30 締め: 12/1 から2か月＝1/31', D.deadlineOf('2026-12-01', 2) === '2027-01-31');
t('1か月: 1/16 から＝2/15', D.deadlineOf('2027-01-16', 1) === '2027-02-15');

/* 架空の月分 */
const per = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7), py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: py + '-' + String(pm).padStart(2, '0') + '-16', to: ym + '-15' }; };
const mon = (ym, state, rows) => ({ ym, period: per(ym), state, rows });
const cfgOn = D.fillConfig({ daitai: { on: true } });

console.log('3. 付与');
{
  const g = D.grantsOf([
    mon('2026-12', 'locked', [{ staff_id: 'sA', over60Min: 20 * H }, { staff_id: 'sB', over60Min: 0 }, { staff_id: 'sC', over60Min: 10 * H, adjOver60Min: 14 * H }]),
    mon('2027-01', 'ended', [{ staff_id: 'sA', over60Min: 7 }]),
    mon('2027-02', 'open', [{ staff_id: 'sA', over60Min: 30 * H }])
  ], cfgOn);
  t('20時間超 × 25% ＝ 5時間', g.sA[0].grantMin === 5 * H && g.sA[0].from === '2026-12-16' && g.sA[0].to === '2027-02-15' && g.sA[0].prov === false);
  t('60時間を超えない人は付与しない', !g.sB);
  t('段A2 の adj（会議を足した後）を先に読む', g.sC[0].over60Min === 14 * H && g.sC[0].grantMin === 3.5 * H);
  t('締めていない終わった月分は仮・1分未満は切り捨て（7分×25%＝1分）', g.sA[1].prov === true && g.sA[1].grantMin === 1);
  t('途中の月分は付与しない', g.sA.length === 2);
  t('期限の早い順', g.sA[0].ym === '2026-12');
}

console.log('4. 台帳');
const months = [mon('2026-12', 'locked', [{ staff_id: 'sA', over60Min: 20 * H }, { staff_id: 'sD', over60Min: 12 * H }]),
  mon('2027-01', 'locked', [{ staff_id: 'sA', over60Min: 16 * H }, { staff_id: 'sD', over60Min: 20 * H }])];
const use = (sid, date, minutes, extra) => Object.assign({ id: sid + date, staff_id: sid, date, kind: 'special', type_code: 'daitai', paid: true, minutes: minutes == null ? null : minutes }, extra || {});
{
  /* sA: 12月分 5時間・1月分 4時間（期限 3/15）。1日＝8時間を 1/20 に取る → 12月分 5h ＋ 1月分は 1/16 から使える 3h */
  const r = D.ledger({ cfg: cfgOn, months, today: '2027-01-25', dayMinOf: () => 8 * H, absences: [use('sA', '2027-01-20'), use('sX', '2027-01-21', null, { type_code: 'keicho' }), use('sA', '2027-01-22', 240, { voided_at: '2027-01-23' })] });
  const a = r.people.filter(p => p.staff_id === 'sA')[0];
  t('前々月と前月を合わせて1日（期限の早い付与から）', a.uses.length === 1 && a.uses[0].takenMin === 8 * H && a.uses[0].from[0].ym === '2026-12' && a.uses[0].from[0].takenMin === 5 * H && a.uses[0].from[1].takenMin === 3 * H);
  t('残りは1月分の1時間', a.remainMin === 1 * H && a.grants[0].state === 'used');
  t('印: 12月分は 5h÷25%＝20時間（元の60時間超まで）', r.marks[0].originYm === '2026-12' && r.marks[0].exemptMin === 20 * H);
  t('印: 1月分は 3h÷25%＝12時間', r.marks[1].originYm === '2027-01' && r.marks[1].exemptMin === 12 * H);
  t('元の月分ごとの足し', JSON.stringify(D.exemptByOrigin(r)) === JSON.stringify({ '2026-12': { sA: 20 * H }, '2027-01': { sA: 12 * H } }));
  t('印の違う特別休暇・取り消した行は数えない', !r.people.some(p => p.staff_id === 'sX') && a.uses.every(u => u.date !== '2027-01-22'));
}
{
  /* sD: 12月分 3時間・1月分 5時間。半日（4時間）を 12/20 に取る → 12月分の3時間しか無く足りない */
  const r = D.ledger({ cfg: cfgOn, months, today: '2027-02-10', dayMinOf: () => 8 * H, absences: [use('sD', '2026-12-20', 240)] });
  const d = r.people.filter(p => p.staff_id === 'sD')[0];
  t('足りない使用は要確認（合わせない設定）', d.uses[0].problem === 'short' && d.uses[0].takenMin === 3 * H && d.uses[0].shortMin === 1 * H);
  const dS = D.ledger({ cfg: cfgOn, months, today: '2027-03-05', dayMinOf: () => 8 * H, absences: [use('sD', '2026-12-20', 240)] }).people.filter(p => p.staff_id === 'sD')[0];
  t('期限が近い（1月分は 3/15 まで・14日以内）', dS.soon.length === 1 && dS.soon[0].ym === '2027-01' && dS.soon[0].remainMin === 5 * H);
  const r2 = D.ledger({ cfg: D.fillConfig({ daitai: { on: true, combine: true } }), months, today: '2027-02-10', dayMinOf: () => 8 * H, absences: [use('sD', '2026-12-20', 240)] });
  t('合わせる設定なら足りなくても要確認にしない（代わりに代えられるのは代替休暇の分だけ）', !r2.people.filter(p => p.staff_id === 'sD')[0].uses[0].problem && r2.marks[0].exemptMin === 12 * H);
  const r3 = D.ledger({ cfg: cfgOn, months, today: '2027-03-20', dayMinOf: () => 8 * H, absences: [] });
  const d3 = r3.people.filter(p => p.staff_id === 'sD')[0];
  t('期限が過ぎた残りは期限切れ', d3.expired.length === 2 && d3.remainMin === 0 && r3.counts.expired === 2);
  const r4 = D.ledger({ cfg: cfgOn, months, today: '2027-01-10', dayMinOf: () => 8 * H, absences: [use('sZ', '2027-01-05')] });
  t('付与の無い人の使用は付与の無い日', r4.people.filter(p => p.staff_id === 'sZ')[0].uses[0].problem === 'nogrant');
  const r5 = D.ledger({ cfg: cfgOn, months, today: '2027-01-10', dayMinOf: () => 8 * H, absences: [use('sA', '2026-12-10')] });
  t('期間の前（60時間を超えた月分の中）に取った日は付与の無い日', r5.people.filter(p => p.staff_id === 'sA')[0].uses[0].problem === 'nogrant' && !r5.marks.length);
  const r6 = D.ledger({ cfg: D.fillConfig({ daitai: { on: true, units: 'day' } }), months, today: '2027-01-10', dayMinOf: () => 4 * H, absences: [use('sA', '2026-12-20', 120)] });
  t('協定の単位と違う使用は要確認', r6.people.filter(p => p.staff_id === 'sA')[0].uses[0].problem === 'unit');
  t('取った分÷換算率が元の60時間超を超えない', (() => { const g = D.ledger({ cfg: D.fillConfig({ daitai: { on: true, rateNo: 50, rateYes: 49 } }), months: [mon('2026-12', 'locked', [{ staff_id: 'sQ', over60Min: 100 * H }])], today: '2026-12-20', dayMinOf: () => 60, absences: [use('sQ', '2026-12-17')] }); return g.marks[0].exemptMin <= 100 * H; })());
}

console.log('5. 確かめと箱');
{
  const r = D.ledger({ cfg: cfgOn, months, today: '2027-01-25', dayMinOf: () => 8 * H, absences: [] });
  const a = r.people.filter(p => p.staff_id === 'sA')[0];
  t('使える日なら null', D.checkTake(a, cfgOn, '2027-01-26', false, '2027-01-25', '2027-02-15') === null);
  t('期間の外は断る', /使える代替休暇がありません/.test(D.checkTake(a, cfgOn, '2027-04-01', false, '2027-01-25', '2027-05-15')));
  t('次の月分より先は断る', /まだ入れられません/.test(D.checkTake(a, cfgOn, '2027-03-01', false, '2027-01-25', '2027-02-15')));
  t('付与の無い人は断る', /取れる代替休暇がありません/.test(D.checkTake(null, cfgOn, '2027-01-26', false)));
  t('単位の違いは断る', /1日だけ/.test(D.checkTake(a, D.fillConfig({ daitai: { units: 'day' } }), '2027-01-26', true)));
  const d = r.people.filter(p => p.staff_id === 'sD')[0];
  t('残りが足りない時は断る（12/20 は12月分の3時間だけ）', /残りが足りません/.test(D.checkTake(d, cfgOn, '2026-12-20', false, '2026-12-19')));
  const b = D.box(D.ledger({ cfg: cfgOn, months, today: '2027-03-20', dayMinOf: () => 8 * H, absences: [] }));
  t('箱: 期限切れは要対応', b.level === 'alert' && b.count >= 2 && b.tab === 'daitai' && /期限切れ/.test(b.rows[0].text));
  t('箱: 何も無ければ なし', D.box({ people: [] }).level === 'ok');
}

console.log('6. 画面の組み込み');
{
  const html = read('kintai.html'), js = read('kintai.js'), src = read('kintai-daitai.js');
  const iD = html.indexOf('kintai-daitai.js?v='), iK = html.indexOf('kintai.js?v=');
  t('kintai.html が kintai.js の前に読む', iD > 0 && iD < iK);
  t('タブのボタンは初めは隠す', /data-tab="daitai"[^>]*hidden/.test(html));
  t('TABS に daitai', /var TABS = \[[^\]]*'daitai'/.test(js));
  t('切の時はタブを隠し・開こうとしたらホーム', /tab === 'daitai' && data && !dtOn\(\)\) tab = 'home'/.test(js) && /dtTab\.hidden = !dtv/.test(js));
  t('ホームの箱は入の時だけ', /function dtBoxHtml\(\) \{\s*if \(!dtOn\(\)\) return '';/.test(js));
  t('設定の保存に daitai を入れる', /outCfg\.daitai = dts\.vals/.test(js) && /concat\(dts \? \['daitai'\] : \[\]\)/.test(js));
  t('特別休暇の種類に印 daitai を使わせない', /cd === 'daitai'/.test(js));
  t('取る時は有給の特別休暇に印 daitai（DB も計算も今の道）', /p_kind: 'special'[^;]*p_paid: true[^;]*p_type_code: DT\.TYPE/.test(js));
  t('部品は端末に残さない', !/localStorage|sessionStorage/.test(src) && !/localStorage[^\n]*daitai/.test(js));
  t('部品は勤怠の数え方・給与を呼ばない', !/KintaiCalc|computeMonth|payroll/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  t('部品は名前を持たない', !/\.name\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  t('kintai-calc.js に代替休暇の手を入れていない', !/daitai|代替休暇/.test(read('kintai-calc.js')));
}

console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
process.exit(fail ? 1 : 0);
