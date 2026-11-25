/* 勤怠の休日の暦（kintai-holiday.js）の試験（2026-11-25 新設・ROOT-v7 段B「祝日の設定」）
   実行: node check/unit/kintai_holiday_test.js
   守りたいこと:
     1. 国の祝日は、内閣府の祝日の一覧（check/fixtures/holidays-jp-cao.csv）と 2000 年から一覧の最後の年まで、日付と名前が全件一致する
        （春分・秋分・振替休日・国民の休日・2019 の即位・2020〜2021 の五輪の特例を含む）
     2. 一覧の最後の年（CONFIRMED_THROUGH）より先は「見込み」の印・範囲の外の年は空
     3. 会社の休日の掃除（形の違う要素は読み飛ばす・件数・名前の字数・期間・事業所・止めた休日）と、毎年の休日の年またぎ・2/29
     4. 設定の大きさの見積もり（DB の jsonb の文字の大きさ以上に数える）
     5. 端末に残さない・通信しない・kintai-calc.js に触れない */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const H = require(path.join(ROOT, 'kintai-holiday.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

console.log('\n— 1. 内閣府の一覧と全件一致 —');
const csv = fs.readFileSync(path.join(ROOT, 'check/fixtures/holidays-jp-cao.csv'), 'utf8').trim().split('\n');
t('一覧の見出しは「国民の祝日・休日月日,国民の祝日・休日名称」', csv[0] === '国民の祝日・休日月日,国民の祝日・休日名称', csv[0]);
const rows = csv.slice(1).map((l) => { const [a, n] = l.split(','); const [y, m, d] = a.split('/').map(Number); return { y, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, name: n }; });
const lastY = Math.max(...rows.map((r) => r.y));
t('一覧の最後の年が CONFIRMED_THROUGH と同じ（一覧を取り直したら部品の印も直す）', lastY === H.CONFIRMED_THROUGH, [lastY, H.CONFIRMED_THROUGH]);
const bad = [];
let n = 0;
for (let y = H.MIN_YEAR; y <= lastY; y++) {
  const exp = rows.filter((r) => r.y === y).map((r) => r.date + ' ' + r.name);
  const got = H.nationalHolidays(y).map((r) => r.date + ' ' + r.name);
  n += exp.length;
  if (exp.join('|') !== got.join('|')) bad.push({ y, miss: exp.filter((x) => got.indexOf(x) < 0), extra: got.filter((x) => exp.indexOf(x) < 0) });
}
t('2000 年〜' + lastY + ' 年の ' + n + ' 日が、日付と名前まで全部一致', !bad.length && n === rows.filter((r) => r.y >= H.MIN_YEAR).length && n >= 480, bad);
const y19 = H.nationalHolidays(2019).map((r) => r.date);
t('2019: 即位の日（5/1）とその前後の休日（4/30・5/2）・即位礼正殿の儀（10/22）・天皇誕生日なし', ['2019-04-30', '2019-05-01', '2019-05-02', '2019-10-22'].every((d) => y19.includes(d)) && !y19.includes('2019-12-23') && !y19.includes('2019-02-23'));
const y21 = H.nationalHolidays(2021);
t('2021: 海の日 7/22・スポーツの日 7/23・山の日 8/8 と振替 8/9', ['2021-07-22 海の日', '2021-07-23 スポーツの日', '2021-08-08 山の日', '2021-08-09 休日'].every((x) => y21.some((r) => r.date + ' ' + r.name === x)));
const k26 = H.nationalHolidays(2026).filter((r) => r.date === '2026-09-22')[0];
t('2026-09-22 は国民の休日（敬老の日と秋分の日に挟まれた日）', k26 && k26.kind === 'bridge' && k26.name === '休日', k26);
const s25 = H.nationalHolidays(2025).filter((r) => r.date === '2025-11-24')[0];
t('2025-11-24 は振替休日（勤労感謝の日が日曜日）', s25 && s25.kind === 'substitute', s25);

console.log('\n— 2. 見込みと範囲の外 —');
t('一覧の年は見込みでない', H.nationalHolidays(lastY).every((r) => r.estimated === false));
t('一覧の次の年は全部「見込み」', H.nationalHolidays(lastY + 1).length >= 16 && H.nationalHolidays(lastY + 1).every((r) => r.estimated === true));
t('範囲の外（1999・2100・小数・文字）は空', [1999, 2100, 2026.5, '2026', null].every((y) => H.nationalHolidays(y).length === 0));
t('2030 年の春分・秋分（近似式の見込み）は 3/20・9/23', H.nationalHolidays(2030).some((r) => r.date === '2030-03-20' && r.name === '春分の日') && H.nationalHolidays(2030).some((r) => r.date === '2030-09-23' && r.name === '秋分の日'));

console.log('\n— 3. 会社の休日 —');
const list = [
  { md: '12-29', to: '01-03', name: '年末年始の休み', office: '', active: true },
  { date: '2026-08-14', name: '夏の休み', office: 'day' },
  { date: '2026-10-01', to: '2026-10-02', name: '研修', office: 'visit', active: false },
  { md: '02-29', name: 'うるう日', office: '' },
  null, 'x', [1],
  { date: '2026-02-30', name: '無い日' },
  { date: '2026-01-01', md: '01-01', name: '両方' },
  { date: '2026-03-01', to: '2026-02-28', name: '逆' },
  { date: '2026-03-01', to: '2026-04-15', name: '長い' },
  { md: '05-01', to: '05-01', name: '同じ日' },
  { date: '2026-03-01', name: '' },
  { date: '2026-03-01', name: 'あ'.repeat(17) },
  { date: '2026-03-01', name: '事業所', office: 'kitchen' },
  { date: '2026-03-01', name: '状態', active: 'yes' },
  { date: '2026-03-01', name: '  前後の空白  ' }
];
const cl = H.cleanCompany(list);
t('通る要素は5つ（形の違う要素は読み飛ばす）', cl.items.length === 5, cl.items);
t('読み飛ばした理由: 形3・日付3・終わりの日3・名前2・事業所1・状態1', JSON.stringify(cl.bad.map((b) => b.why)) === JSON.stringify(['shape', 'shape', 'shape', 'date', 'date', 'to', 'to', 'to', 'name', 'name', 'office', 'active']), cl.bad);
t('状態が無い要素は使う・名前の前後の空白は切る', cl.items[1].active === true && cl.items[4].name === '前後の空白');
t('配列でない時は空', H.cleanCompany(null).items.length === 0 && H.cleanCompany({ a: 1 }).items.length === 0);
const many = Array.from({ length: 35 }, (_, i) => ({ date: '2026-03-' + String(1 + (i % 28)).padStart(2, '0'), name: '休み' + i }));
const cm = H.cleanCompany(many);
t('30件まで（31件目から max）', cm.items.length === H.MAX_COMPANY && cm.bad.length === 5 && cm.bad.every((b) => b.why === 'max'));
const days26 = H.companyDays(cl.items, 2026);
const yearEnd = days26.filter((d) => d.name === '年末年始の休み').map((d) => d.date);
t('毎年の年またぎ（12/29〜1/3）は、その年の 1/1〜1/3 と 12/29〜12/31', JSON.stringify(yearEnd) === JSON.stringify(['2026-01-01', '2026-01-02', '2026-01-03', '2026-12-29', '2026-12-30', '2026-12-31']), yearEnd);
t('止めた休日は日に入れない', !days26.some((d) => d.name === '研修'));
t('毎年の 2/29 は、うるう年でない年は 2/28・うるう年は 2/29', days26.some((d) => d.date === '2026-02-28' && d.name === 'うるう日') && H.companyDays(cl.items, 2028).some((d) => d.date === '2028-02-29' && d.name === 'うるう日'));
const cfg = { companyHolidays: list };
const cal = H.yearCalendar(cfg, 2026, '');
const jan1 = cal.filter((c) => c.date === '2026-01-01')[0];
t('暦: 1/1 は国の祝日（元日）と会社の休日が1行にまとまる', jan1 && jan1.national && jan1.national.name === '元日' && jan1.company.length === 1);
t('暦: 事業所で絞ると、ほかの事業所だけの休日は出ない（全部の事業所の休日は出る）', !H.yearCalendar(cfg, 2026, 'facility').some((c) => c.company.some((x) => x.name === '夏の休み')) && H.yearCalendar(cfg, 2026, 'day').some((c) => c.company.some((x) => x.name === '夏の休み')) && H.yearCalendar(cfg, 2026, 'facility').some((c) => c.company.some((x) => x.name === '年末年始の休み')));
t('暦は日付の順', cal.every((c, i) => !i || cal[i - 1].date < c.date));
const di = H.dayInfo(cfg, '2026-01-01', '');
t('dayInfo: 国の祝日と会社の休日の両方', di.national && di.company && di.name === '元日・年末年始の休み', di);
t('dayInfo: 休日でない日・形の違う日', !H.dayInfo(cfg, '2026-06-10', '').national && !H.dayInfo(cfg, 'x', '').company);

console.log('\n— 4. 設定の大きさ —');
/* DB の jsonb の文字（例: {"a": 1, "b": [true, "あ"]}）以上に数える */
const pgText = (v) => { if (Array.isArray(v)) return '[' + v.map(pgText).join(', ') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).map((k) => JSON.stringify(k) + ': ' + pgText(v[k])).join(', ') + '}'; return JSON.stringify(v); };
const sample = { close_day: 15, csvTime: 'hmm', plusViews: true, companyHolidays: cl.items, agreement36: { startMonth: 4, special: false } };
const pgBytes = Buffer.byteLength(pgText(sample), 'utf8');
t('見積もりは jsonb の文字の大きさ以上（' + pgBytes + ' バイト）', H.jsonbBytes(sample) >= pgBytes, [H.jsonbBytes(sample), pgBytes]);
const full = { companyHolidays: Array.from({ length: 30 }, (_, i) => ({ md: '12-' + String(i + 1).padStart(2, '0'), to: '01-0' + (1 + (i % 9)), name: 'あ'.repeat(16), office: 'facility', active: false })) };
t('会社の休日を上限（30件・名前16字）まで入れても設定に入る', H.fitsConfig(full), H.jsonbBytes(full));
t('8KB を超える設定は入らない', !H.fitsConfig({ big: 'x'.repeat(8200) }));

console.log('\n— 5. 守り —');
const SRC = fs.readFileSync(path.join(ROOT, 'kintai-holiday.js'), 'utf8');
t('端末に残さない・通信しない・画面に触れない', !/localStorage|sessionStorage|fetch\(|XMLHttpRequest|document\.|rpc\(/.test(SRC));
t('kintai-calc.js を読まない（計算にまだつながない）', !/kintai-calc|KintaiCalc/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
