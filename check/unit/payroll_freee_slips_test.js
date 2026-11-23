/* freee の明細の書き出しを読む・結ぶ・比べる・累計の行にする純関数（payroll-freee-slips.js）の試験（2026-11-23 新設・ROOT-yearend.md の B1）
   実行: node check/unit/payroll_freee_slips_test.js
   守りたいこと:
     1. parse: 見出しの揺れ（氏名／姓＋名・支給日／賞与支給日・課税支給額／課税対象額・全角の括弧）・数の書き方（1,234・¥・円・-・△・(…)・空）・数でない値は bad
     2. 種類: 見出しに「賞与」があれば bonus・呼ぶ側の kind が勝つ
     3. match: 従業員番号で結ぶ・無ければ空白を除いた氏名がちょうど1人の時だけ・2人以上／0人は結ばない
     4. compare / compareSlips: 片方だけの人も出す・差のある行が上・tax_adjust（年末調整の精算）は除いて別の欄・賞与は住民税の項目なし
     5. toYtd: data の鍵へ写す・課税支給が無ければ 総支給−非課税・si_other は社保等の合計の列から（負は0と警告）・結べない／bad の行は入れない
     6. 個人情報: DOM・端末への保存・console・通信を使わない
   ★架空の職員と架空の金額だけ（check/fixtures/freee-slips-*.csv） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const FS = require(path.join(ROOT, 'payroll-freee-slips.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'payroll-freee-slips.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }
const dec = (buf) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (_) { return new TextDecoder('shift_jis').decode(buf); } };
const fx = (f) => dec(fs.readFileSync(path.join(ROOT, 'check', 'fixtures', f)));

console.log('\n— 1. parse（給与・UTF-8 の BOM・CRLF） —');
const sal = FS.parse(fx('freee-slips-salary-2026-11.csv'));
t('3行を読む・種類は給与', sal.rows.length === 3 && sal.kind === 'salary', sal.rows.length);
const r1 = sal.rows[0];
t('従業員番号・氏名・支給日（2026/11/27 → 2026-11-27）', r1.emp_num === 'E901' && r1.name === '見本 一' && r1.pay_date === '2026-11-27', r1);
t('金額の列（引用符の中の読点）', r1.gross === 215000 && r1.taxable === 210000 && r1.nontax === 5000 && r1.si_health === 10000 && r1.si_care === 1600 && r1.si_support === 400 && r1.si_pension === 18300 && r1.si_emp === 1180 && r1.income_tax === 4770 && r1.resident_tax === 8000 && r1.deduct_total === 44250 && r1.net === 170750, r1);
t('全角の括弧の見出し「通勤手当（非課税）」を非課税にする', sal.cols.found.indexOf('nontax') >= 0);
t('上に無い列（基本給・資格手当）は名前→金額のまま items へ', r1.items['基本給'] === 200000 && r1.items['資格手当'] === 10000 && !('総支給額' in r1.items), r1.items);
t('空の欄は 0（bad にしない）・空の手当は items に入れない', sal.rows[1].si_care === 0 && sal.rows[1].bad.length === 0 && !('資格手当' in sal.rows[1].items));
t('主な見出しはすべて読めた（missing なし）', sal.cols.missing.length === 0, sal.cols.missing);

console.log('\n— 2. parse（賞与・Shift_JIS・姓＋名・見出しの揺れ） —');
const bon = FS.parse(fx('freee-slips-bonus-2026-07.csv'));
t('見出しの「賞与」で種類は賞与', bon.kind === 'bonus');
t('姓＋名を空白でつなぐ・「2026年7月10日」を日付に', bon.rows[0].name === '見本 一' && bon.rows[0].pay_date === '2026-07-10', bon.rows[0]);
t('課税対象額・健康保険・厚生年金・源泉所得税・総控除額 の揺れを読む', bon.rows[0].taxable === 300000 && bon.rows[0].si_health === 15000 && bon.rows[0].si_pension === 27450 && bon.rows[0].income_tax === 10000 && bon.rows[0].deduct_total === 57100, bon.rows[0]);
t('数でない値（abc）は bad の印・値は null', bon.rows[1].bad.length === 1 && bon.rows[1].income_tax === null, bon.rows[1]);
t('呼ぶ側の kind が勝つ', FS.parse(fx('freee-slips-bonus-2026-07.csv'), { kind: 'salary' }).kind === 'salary');
t('住民税の列が無ければ null（has に無い）', bon.rows[0].resident_tax === null && !bon.rows[0].has.resident_tax);

console.log('\n— 3. 数の書き方 —');
t('1,234 / ¥1,234 / ￥1,234円 / 1234', FS.toYen('1,234') === 1234 && FS.toYen('¥1,234') === 1234 && FS.toYen('￥1,234円') === 1234 && FS.toYen('1234') === 1234);
t('-1,234 / −1,234 / △1,234 / (1,234) は負', FS.toYen('-1,234') === -1234 && FS.toYen('−1,234') === -1234 && FS.toYen('△1,234') === -1234 && FS.toYen('(1,234)') === -1234);
t('空・空白・ハイフンだけ・（空） は 0', FS.toYen('') === 0 && FS.toYen('  ') === 0 && FS.toYen('-') === 0 && FS.toYen('（空）') === 0);
t('全角の数字も読む', FS.toYen('１２，３４５') === 12345);
t('数でない値・小数は NaN', isNaN(FS.toYen('abc')) && isNaN(FS.toYen('1.5')) && isNaN(FS.toYen('1,2a')));
t('日付: 2026/1/5・2026-01-05・2026年1月5日・2026.1.5／無い日は null', FS.toDate('2026/1/5') === '2026-01-05' && FS.toDate('2026-01-05') === '2026-01-05' && FS.toDate('2026年1月5日') === '2026-01-05' && FS.toDate('2026.1.5') === '2026-01-05' && FS.toDate('2026/2/30') === null && FS.toDate('11/27') === null);
t('CSV: 引用符・中の読点・二重の引用符・空行', JSON.stringify(FS.parseCsv('a,b\r\n"x, y","1,000"\n"q""r",2\n\n')) === JSON.stringify([['a', 'b'], ['x, y', '1,000'], ['q"r', '2']]));
t('見出しだけ・空の文字', FS.parse('').rows.length === 0 && FS.parse('氏名,総支給額\n').rows.length === 0);
const miss = FS.parse('名前だけ,何か\nA,1\n');
t('主な見出しが無ければ missing に出す', ['従業員番号・氏名', '支給日', '総支給額', '所得税'].every((x) => miss.cols.missing.indexOf(x) >= 0), miss.cols.missing);

console.log('\n— 4. match —');
const staff = [{ staff_id: 's-1', name: '見本 一', emp_num: 'E901' }, { staff_id: 's-2', name: '見本　二', data: { freee_emp_num: 'E902' } }, { staff_id: 's-3', name: '同名 太郎' }, { staff_id: 's-4', name: '同名太郎' }, { staff_id: 's-5', name: '架空 三郎' }];
const m = FS.match(sal.rows, staff);
t('従業員番号で結ぶ（profiles の data.freee_emp_num も読む）', m.matched.find((x) => x.emp_num === 'E901').staff_id === 's-1' && m.matched.find((x) => x.emp_num === 'E902').staff_id === 's-2' && m.matched.find((x) => x.emp_num === 'E902').how === 'emp');
t('番号が当たらなければ空白を除いた氏名がちょうど1人と同じ時だけ', m.matched.find((x) => x.emp_num === 'E999').staff_id === 's-5' && m.matched.find((x) => x.emp_num === 'E999').how === 'name');
const m2 = FS.match([{ name: '同名 太郎', emp_num: '' }, { name: '居ない 人', emp_num: '' }, { name: '', emp_num: '' }], staff);
t('同じ氏名が2人以上は結ばない（many）・0人も結ばない（none）・番号も氏名も無い（nokey）', m2.matched.length === 0 && m2.unmatched.map((u) => u.why).join() === 'many,none,nokey', m2.unmatched);
const m3 = FS.match([{ name: '見本 一', emp_num: 'E1' }], [{ staff_id: 'a', name: 'x', emp_num: 'E1' }, { staff_id: 'b', name: 'y', emp_num: 'E1' }]);
t('同じ番号の職員が2人なら結ばない（氏名に逃げない）', m3.matched.length === 0 && m3.unmatched[0].why === 'many');
t('結べない行は職員を作らない（staff_id を勝手に付けない）', m2.unmatched.every((u) => !u.row.staff_id));

console.log('\n— 5. compare / compareSlips —');
const item = (sid, name, o) => Object.assign({ staff_id: sid, name, gross: 215000, taxable: 210000, si_total: 31480, deduct: 44250, net: 170750,
  lines: [{ sec: 'pay', code: 'base', amount: 215000 }, { sec: 'deduct', code: 'health', amount: 10000 }, { sec: 'deduct', code: 'care', amount: 1600 }, { sec: 'deduct', code: 'support', amount: 400 },
    { sec: 'deduct', code: 'pension', amount: 18300 }, { sec: 'deduct', code: 'emp', amount: 1180 }, { sec: 'deduct', code: 'income_tax', amount: 4770 }, { sec: 'deduct', code: 'resident_tax', amount: 8000 }] }, o || {});
const ours = [item('s-1', '見本 一'), item('s-2', '見本 二', { gross: 183000, taxable: 180000, si_total: 26820, deduct: 36590, net: 146410,
  lines: [{ sec: 'deduct', code: 'health', amount: 9000 }, { sec: 'deduct', code: 'support', amount: 350 }, { sec: 'deduct', code: 'pension', amount: 16470 }, { sec: 'deduct', code: 'emp', amount: 1000 }, { sec: 'deduct', code: 'income_tax', amount: 3800 }, { sec: 'deduct', code: 'resident_tax', amount: 6000 }] }),
  item('s-9', '自社 だけ')];
const c = FS.compare(ours, m.matched);
const p1 = c.people.find((p) => p.staff_id === 's-1'), p2 = c.people.find((p) => p.staff_id === 's-2');
t('全項目が同じ人は差0', Object.keys(p1.cells).every((k) => p1.cells[k].diff === 0), p1.cells);
t('所得税が30円違う人は所得税の差30（控除の合計・差引は明細の値どおり）', p2.cells.income_tax.diff === 30 && p2.cells.income_tax.app === 3800 && p2.cells.income_tax.freee === 3770, p2.cells.income_tax);
t('どちらかにしか居ない人も出す（自社だけ・freee だけ）', c.people.some((p) => p.staff_id === 's-9' && p.only === 'app') && c.people.some((p) => p.staff_id === 's-5' && p.only === 'freee'));
t('合計の行と、項目ごとの一致／差ありの人数', c.totals.gross.app === 215000 * 2 + 183000 && c.totals.gross.freee === 215000 + 183000 + 100000 && c.counts.income_tax.same === 1 && c.counts.income_tax.diff === 1 && c.diffPeople === 1, [c.totals.gross, c.counts.income_tax]);
const cs = FS.compareSlips(ours, m.matched, 'salary');
const ITEM_ORDER = ['総支給', '課税の総支給', '健康保険', '介護保険', '子ども子育て支援金', '厚生年金', '雇用保険', '社保等の合計', '所得税', '住民税', '控除の合計', '差引の支給額'];
t('compareSlips: 1行＝1人×1項目・形は {staff_id, emp_num, name_short, item, ours, freee, diff}', cs.rows.length === 24 && ['staff_id', 'emp_num', 'name_short', 'item', 'ours', 'freee', 'diff'].every((k) => k in cs.rows[0]), cs.rows[0]);
t('compareSlips: 差のある行が上（所得税の差が先頭）・差の数・片方だけの人', cs.rows[0].item === '所得税' && cs.rows[0].diff === 30 && cs.diffCount === 1 && cs.unmatched.length === 2 && cs.unmatched.some((u) => u.side === 'ours' && u.staff_id === 's-9') && cs.unmatched.some((u) => u.side === 'freee'), [cs.rows[0], cs.diffCount, cs.unmatched]);
t('compareSlips: 項目の並びは固定（差の無い人の行で確かめる）', cs.rows.filter((r) => r.staff_id === 's-1').map((r) => r.item).join() === ITEM_ORDER.join(), cs.rows.filter((r) => r.staff_id === 's-1').map((r) => r.item));
t('compareSlips: 姓だけ（空白の前）', cs.rows.find((r) => r.staff_id === 's-1').name_short === '見本');
/* 年末調整の精算（tax_adjust）がある12月分: 精算を除いた控除の合計・差引で比べ、精算は別の欄（差の数に入れない） */
const dec12 = item('s-1', '見本 一', { deduct: 44250 - 12000, net: 170750 + 12000 });
dec12.lines = dec12.lines.concat([{ sec: 'deduct', code: 'tax_adjust', name: '年末調整の精算', amount: -12000 }]);
const cs12 = FS.compareSlips([dec12], m.matched.filter((r) => r.staff_id === 's-1'), 'salary');
t('tax_adjust のある明細: 控除の合計・差引・所得税は精算を除いて比べて一致・精算の額 −12,000 は別の欄', cs12.diffCount === 0 && cs12.rows.every((r) => r.settle === -12000) && cs12.settle === -12000
  && cs12.rows.find((r) => r.item === '控除の合計').ours === 44250 && cs12.rows.find((r) => r.item === '差引の支給額').ours === 170750 && cs12.rows.find((r) => r.item === '所得税').ours === 4770, cs12.rows.filter((r) => r.diff !== 0));
const bonusOurs = [{ staff_id: 's-1', name: '見本 一', gross: 300000, taxable: 300000, si_total: 47100, deduct: 57100, net: 242900, lines: [{ sec: 'deduct', code: 'health', amount: 15000 }, { sec: 'deduct', code: 'care', amount: 2400 }, { sec: 'deduct', code: 'support', amount: 600 }, { sec: 'deduct', code: 'pension', amount: 27450 }, { sec: 'deduct', code: 'emp', amount: 1650 }, { sec: 'deduct', code: 'income_tax', amount: 10000 }] }];
const csb = FS.compareSlips(bonusOurs, FS.match(bon.rows, staff).matched.filter((r) => r.staff_id === 's-1'), 'bonus');
t('賞与: 住民税の項目は無い（11項目）・架空の見本は全部一致', csb.rows.length === 11 && !csb.rows.some((r) => r.item === '住民税') && csb.diffCount === 0, csb.rows.filter((r) => r.diff !== 0));
/* 反証レビュー（2026-11-23）: 対にするのは match で結べた staff_id だけ。結べなかった freee の行は氏名・番号で自社の人に当てず「照合できません」 */
const nm1 = FS.compareSlips([item('s-1', '見本 一')], [sal.rows[0]], 'salary');
t('結べなかった freee の行（staff_id なし）は、同じ氏名・番号でも自社の人に当てない（自社だけ＋照合できない行）', nm1.rows.length === 0 && nm1.unmatched.length === 2 && nm1.unmatched.some((u) => u.side === 'ours' && u.staff_id === 's-1') && nm1.unmatched.some((u) => u.side === 'freee' && u.nomatch === true && !u.staff_id), nm1.unmatched);
/* 数でない値: 差の表のその項目に印（bad）・差の数に入れる */
const badRow = Object.assign({}, m.matched.find((r) => r.staff_id === 's-1'), { income_tax: null, bad: ['所得税'], badKeys: ['income_tax'] });
const csBad = FS.compareSlips([item('s-1', '見本 一')], [badRow], 'salary');
const bt = csBad.rows.find((r) => r.key === 'income_tax');
t('freee の側の数でない値は、その項目に bad の印（freee・差は null）・差の数に入れる・上に並ぶ', bt.bad === true && bt.freee === null && bt.diff === null && csBad.diffCount === 1 && csBad.rows[0].key === 'income_tax' && csBad.counts.income_tax.diff === 1, [bt, csBad.diffCount]);
t('数でない値の無い項目は一致のまま', csBad.rows.filter((r) => r.key !== 'income_tax').every((r) => r.diff === 0 && !r.bad));
/* 必須の見出し: 総支給額・所得税と、課税支給額か非課税支給額。無いファイルは行を作らずに断る */
const rf1 = FS.parse('氏名,支給日,総支給額,課税支給額\nA,2026/1/25,1,1\n'), rf2 = FS.parse('氏名,支給日,総支給額,所得税\nA,2026/1/25,1,0\n'), rf3 = FS.parse('氏名,支給日,所得税,非課税支給額\nA,2026/1/25,0,0\n');
const okN = FS.parse('氏名,支給日,総支給額,非課税支給額,所得税\nA,2026/1/25,"100,000","5,000",0\n');
t('必須の見出しが無いファイルは refused・行を作らない・読めなかった見出しを返す', rf1.refused && rf1.rows.length === 0 && rf1.cols.required.join() === '所得税' && rf2.refused && rf2.cols.required.join() === '課税支給額（非課税支給額）' && rf3.refused && rf3.cols.required.join() === '総支給額', [rf1.cols, rf2.cols, rf3.cols]);
t('非課税支給額だけでも読む（課税支給＝総支給−非課税）', !okN.refused && okN.rows.length === 1 && FS.toYtd([Object.assign({ staff_id: 's-1' }, okN.rows[0])], 'salary')[0].data.taxable === 95000);
t('見本の CSV（給与・賞与）は必須の見出しがそろう', !sal.refused && !bon.refused && sal.cols.required.length === 0);

console.log('\n— 6. toYtd —');
const ytd = FS.toYtd(m.matched.map((r) => Object.assign({ src_fp: '0123456789abcdef0011' }, r)), 'salary');
t('結べた3行を payroll_ytd_put の形にする（source=freee・rev 0・src_fp は16桁まで）', ytd.length === 3 && ytd.every((x) => x.source === 'freee' && x.kind === 'salary' && x.rev === 0 && x.src_fp.length === 16) && Object.keys(ytd[0]).sort().join() === 'data,kind,pay_date,rev,source,src_fp,staff_id', ytd[0]);
t('data の鍵は DB の白い一覧と同じ11個・全部0以上の整数', ytd.every((x) => Object.keys(x.data).sort().join() === FS.YTD_KEYS.slice().sort().join() && Object.values(x.data).every((v) => Number.isInteger(v) && v >= 0)), ytd[0].data);
t('写した値（総支給・課税・非課税・各社保・所得税・住民税）', ytd[0].data.gross === 215000 && ytd[0].data.taxable === 210000 && ytd[0].data.nontax === 5000 && ytd[0].data.si_pension === 18300 && ytd[0].data.income_tax === 4770 && ytd[0].data.resident_tax === 8000 && ytd[0].data.si_other === 0, ytd[0].data);
const noTax = FS.toYtd([{ staff_id: 's-1', pay_date: '2026-03-25', gross: 100000, nontax: 7000, taxable: null, bad: [] }], 'salary');
t('課税支給が無い時は 総支給−非課税', noTax[0].data.taxable === 93000);
const so = FS.toYtd([{ staff_id: 's-1', pay_date: '2026-03-25', gross: 100000, si_health: 5000, si_pension: 9000, si_total: 15500, bad: [] }, { staff_id: 's-2', pay_date: '2026-03-25', gross: 100000, si_health: 5000, si_total: 4000, bad: [] }], 'salary');
t('si_other は社保等の合計から各社保を引いた残り・負なら0と警告', so[0].data.si_other === 1500 && so[1].data.si_other === 0 && so.warnings.length === 1 && so.warnings[0].staff_id === 's-2', [so[0].data, so.warnings]);
const sk = FS.toYtd([{ name: 'x', pay_date: '2026-03-25', bad: [] }, { staff_id: 's-1', pay_date: null, bad: [] }, { staff_id: 's-1', pay_date: '2026-03-25', bad: ['所得税'] }, { staff_id: 's-1', pay_date: '2026-03-25', gross: -1, bad: [] }], 'salary');
t('結べない・支給日が無い・bad・負の値の行は入れない（skipped に理由）', sk.length === 0 && sk.skipped.map((x) => x.why).join() === 'nostaff,nodate,bad,negative', sk.skipped);
const bk = FS.toYtd(FS.match(bon.rows, staff).matched, 'bonus');
t('賞与の toYtd: kind=bonus・数でない値の行（2行目）は入れない', bk.length === 1 && bk[0].kind === 'bonus' && bk[0].pay_date === '2026-07-10', bk);
t('送る形にした時に warnings・skipped は JSON に入らない', JSON.stringify(so).indexOf('warnings') < 0);
const iy = FS.itemToYtd(dec12);
t('itemToYtd: 自社の明細 → data（tax_adjust は所得税に入れない）', iy.income_tax === 4770 && iy.gross === 215000 && iy.nontax === 5000 && iy.si_other === 0 && Object.keys(iy).sort().join() === FS.YTD_KEYS.slice().sort().join(), iy);

/* 反証レビュー（2026-11-23 の2回目）: 負の値の行は入れない・画面が出せるよう人・支給日・種類・項目・ファイル名を skipped に添える */
const negP = FS.parse('氏名,支給日,総支給額,課税支給額,所得税\n見本 一,2026/06/25,"200,000","200,000","-1,200"\n見本 二,2026/06/25,"180,000","180,000","3,000"\n');
const negM = FS.match(negP.rows, staff).matched.map((r) => Object.assign({ src_name: 'june.csv' }, r));
const negY = FS.toYtd(negM, 'salary');
t('負の値（所得税 −1,200）の行は入れず、skipped に人・支給日・種類・項目・ファイル名', negY.length === 1 && negY[0].staff_id === 's-2' && negY.skipped.length === 1
  && JSON.stringify(negY.skipped[0]) === JSON.stringify({ line: 2, why: 'negative', keys: ['income_tax'], staff_id: 's-1', pay_date: '2026-06-25', kind: 'salary', src_name: 'june.csv' }), negY.skipped);
console.log('\n— 7. 個人情報・部品の作法 —');
t('DOM・端末への保存・console・通信を使わない', !/document\.|localStorage|sessionStorage|indexedDB|console\.|fetch\(|XMLHttpRequest/.test(SRC));
t('見出しの候補の表の頭に「未検証」の注記', /★未検証（事務担当が書き出した実物で確かめる）/.test(SRC) && /見出しの候補（★未検証/.test(SRC));
t('window.PayrollFreeeSlips と module.exports の両方', /root\.PayrollFreeeSlips = api/.test(SRC) && /module\.exports = api/.test(SRC));
t('架空の見本に本物らしい番号の形（12桁のマイナンバー）が無い', !/\b\d{12}\b/.test(fx('freee-slips-salary-2026-11.csv') + fx('freee-slips-bonus-2026-07.csv')));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
