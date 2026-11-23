/* freee の明細の書き出しを読む・結ぶ・比べる・累計の行にする純関数（payroll-freee-slips.js）の試験（2026-11-23 新設・ROOT-yearend.md の B1）
   実行: node check/unit/payroll_freee_slips_test.js
   守りたいこと:
     1. parse: 見出しの揺れ（氏名／姓＋名・支給日／賞与支給日・課税支給額／課税支給額合計（課税対象額は当てない）・全角の括弧）・数の書き方（1,234・¥・円・-・△・(…)・空）・数でない値は bad
     2. 種類: 見出しに「賞与」があれば bonus・呼ぶ側の kind が勝つ
     3. match: 従業員番号で結ぶ・無ければ空白を除いた氏名がちょうど1人の時だけ・2人以上／0人は結ばない
     4. compare / compareSlips: 片方だけの人も出す・差のある行が上・tax_adjust（年末調整の精算）は除いて別の欄・賞与は住民税の項目なし
     5. toYtd: data の鍵へ写す・課税支給が無ければ 総支給−非課税・si_other は社保等の合計の列から（負は0と警告）・結べない／bad の行は入れない
     6. 個人情報: DOM・端末への保存・console・通信を使わない
     6b. A9 始まり（freee に登録の無い人）は対象外として別に数える・合格（1円まで一致）は比べた人1人以上・差0・対象外のほかに片方だけの人がいない時だけ
     6c. bonusToYtd・planBonusYtd・pickByDate（賞与の確定した明細を累計の app の行に・freee の行を支給日でしぼる）
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
t('課税支給額合計・健康保険・厚生年金・源泉所得税・総控除額 の揺れを読む', bon.rows[0].taxable === 300000 && bon.rows[0].si_health === 15000 && bon.rows[0].si_pension === 27450 && bon.rows[0].income_tax === 10000 && bon.rows[0].deduct_total === 57100, bon.rows[0]);
t('数でない値（abc）は bad の印・値は null', bon.rows[1].bad.length === 1 && bon.rows[1].income_tax === null, bon.rows[1]);
t('呼ぶ側の kind が勝つ', FS.parse(fx('freee-slips-bonus-2026-07.csv'), { kind: 'salary' }).kind === 'salary');
t('住民税の列が無ければ null（has に無い）', bon.rows[0].resident_tax === null && !bon.rows[0].has.resident_tax);

console.log('\n— 2b. parse（freee の賃金台帳の見出しの形・2026-11-23 に実物の見出しで確かめた・架空の金額） —');
/* 実物では 課税対象額＝課税支給額合計−社会保険料等控除合計・非課税支給額合計＝通勤手当 (非課税)＋交通費。手当の名前は汎用の物だけ */
const BOOK = '\uFEFF従業員名,従業員番号,基本給,課税支給額合計,通勤手当 (非課税),交通費,非課税支給額合計,総支給額,健康保険料,介護保険料,子ども・子育て支援金,厚生年金保険料,雇用保険料,社会保険料等控除合計,課税対象額,所得税,住民税,控除合計,差引支給金額\r\n'
  + '見本 一,E901,"200,000","200,000","3,000","2,000","5,000","205,000","10,000","1,600",400,"18,300","1,180","31,480","168,520","3,000","5,000","39,480","165,520"\r\n';
const book = FS.parse(BOOK), b1 = book.rows[0];
t('課税支給は「課税支給額合計」（社保を引いた後の「課税対象額」に当てない）', b1.taxable === 200000, b1.taxable);
t('非課税は「非課税支給額合計」（「通勤手当 (非課税)」だけに当てない）', b1.nontax === 5000, b1.nontax);
t('社保等の合計は「社会保険料等控除合計」・差引は「差引支給金額」', b1.si_total === 31480 && b1.net === 165520, [b1.si_total, b1.net]);
t('当てなかった「課税対象額」は items に名前のまま残る', b1.items['課税対象額'] === 168520, b1.items);
t('支給日の列が無い書き出しは支給日を missing に出す（行の支給日は null）', book.cols.missing.indexOf('支給日') >= 0 && b1.pay_date === null, book.cols.missing);
const onlyTaiShou = FS.parse('従業員番号,総支給額,課税対象額,所得税\r\nE901,"205,000","168,520","3,000"\r\n');
t('「課税対象額」しか無い書き出しは課税支給に使わず、課税支給額の列が無いと断る', onlyTaiShou.refused === true && onlyTaiShou.cols.required.indexOf('課税支給額（非課税支給額）') >= 0, onlyTaiShou.cols);

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
console.log('\n— 6b. freee に登録の無い人（A9 始まり）と合格の帯（2026-11-23） —');
const a9 = (sid, name, emp, o) => Object.assign(item(sid, name, o), { emp_num: emp });
const sOk = m.matched.filter((r) => r.staff_id === 's-1');
const ex1 = FS.compareSlips([a9('s-1', '見本 一', 'E901'), a9('s-a1', '契約 一', 'A901'), a9('s-a2', '契約 二', 'Ａ９０２')], sOk, 'salary');
t('A9 始まり（全角も）の人は「自社だけ」・対象外として別に数え、ほかが差0なら合格', ex1.pass === true && ex1.excluded === 2 && ex1.others === 0 && ex1.compared === 1 && ex1.diffCount === 0
  && ex1.unmatched.filter((u) => u.excluded).every((u) => u.side === 'ours'), [ex1.pass, ex1.excluded, ex1.unmatched]);
const ex2 = FS.compareSlips([a9('s-1', '見本 一', 'E901'), a9('s-x', '番号 無し', '')], sOk, 'salary');
t('番号が空の人は対象外にしない（自社だけの人が残るので合格にしない）', ex2.pass === false && ex2.excluded === 0 && ex2.others === 1, [ex2.pass, ex2.unmatched]);
const frA9 = Object.assign({}, sOk[0], { staff_id: 's-a1', emp_num: 'A901' });
const ex3 = FS.compareSlips([a9('s-1', '見本 一', 'E901'), a9('s-a1', '契約 一', 'A901')], sOk.concat([frA9]), 'salary');
t('A9 の人に結ぶ freee の行が来ても結ばない（自社だけ＝対象外・freee の行は「freee だけ」に残り合格にしない）', ex3.pass === false && ex3.unmatched.some((u) => u.side === 'ours' && u.staff_id === 's-a1' && u.excluded)
  && ex3.unmatched.some((u) => u.side === 'freee' && u.staff_id === 's-a1' && !u.excluded), ex3.unmatched);
const ex4 = FS.compareSlips([a9('s-a1', '契約 一', 'A901')], [], 'salary');
/* 検収（2026-11-23）: 「直す」で手で入れた A901（職員の給与設定の data.freee_emp_num）の人は、対象外になり合格が出る */
const exM = FS.compareSlips([Object.assign(item('s-1', '見本 一'), { emp_num: 'E901' }), Object.assign(item('s-c1', '契約 一'), { emp_num: { toString() { return 'A901'; } }.toString() })], sOk, 'salary');
t('手で入れた A901 の人は excluded・ほかが差0なら pass', exM.pass === true && exM.excluded === 1 && exM.unmatched[0].excluded === true, exM.unmatched);
t('比べた人が0人なら合格にしない（対象外だけ・CSV が空）', ex4.pass === false && ex4.compared === 0 && ex4.excluded === 1, ex4);
t('差が1つでもあれば合格にしない（所得税30円の差）', cs.pass === false && cs.diffCount === 1);
t('excluded の判定: 小文字・空白も（a9 01）・A8 は対象外でない', FS.excluded('a9 01') && FS.excluded(' A902') && !FS.excluded('A801') && !FS.excluded('') && !FS.excluded(null) && FS.EXCLUDE_PREFIX === 'A9');

console.log('\n— 6c. 賞与の確定した明細 → 累計の app の行（DB 0124 と同じ取り方） —');
const bItem = { staff_id: 's-1', gross: 300000, taxable: 300000, social: 47100, tax: 10000, ins: { health: 15000, care: 2400, support: 600, pension: 27450, emp: 1650 } };
const bd = FS.bonusToYtd(bItem);
t('総支給・課税・非課税0・社保5つ（和は social）・所得税・住民税0・その他0', bd.gross === 300000 && bd.taxable === 300000 && bd.nontax === 0 && bd.si_health === 15000 && bd.si_pension === 27450 && bd.si_emp === 1650
  && bd.si_health + bd.si_care + bd.si_support + bd.si_pension + bd.si_emp + bd.si_other === 47100 && bd.income_tax === 10000 && bd.resident_tax === 0 && bd.si_other === 0
  && Object.keys(bd).sort().join() === FS.YTD_KEYS.slice().sort().join(), bd);
t('課税支給が null・小数・負の時は総支給（DB と同じ）', FS.bonusToYtd(Object.assign({}, bItem, { taxable: null })).taxable === 300000 && FS.bonusToYtd(Object.assign({}, bItem, { taxable: 1.5 })).taxable === 300000
  && FS.bonusToYtd(Object.assign({}, bItem, { taxable: -1 })).taxable === 300000 && FS.bonusToYtd(Object.assign({}, bItem, { taxable: 290000 })).nontax === 10000);
t('ins が欠けた明細でも社保の和は social に合わせる（その他の社保に残り）', FS.bonusToYtd({ gross: 1000, social: 300, tax: 0, ins: { health: 100 } }).si_other === 200);
const ytdNow = { rows: [{ staff_id: 's-2', pay_date: '2026-12-24', kind: 'bonus', source: 'manual', data: { gross: 1 }, rev: 3 },
  { staff_id: 's-3', pay_date: '2026-12-24', kind: 'bonus', source: 'app', data: FS.bonusToYtd(Object.assign({}, bItem, { staff_id: 's-3' })), rev: 1 },
  { staff_id: 's-1', pay_date: '2026-06-25', kind: 'bonus', source: 'freee', data: { gross: 5 }, rev: 1 }],
  yearend: [{ staff_id: 's-4', status: 'final' }, { staff_id: 's-1', status: 'draft' }] };
const plan = FS.planBonusYtd([bItem, Object.assign({}, bItem, { staff_id: 's-2' }), Object.assign({}, bItem, { staff_id: 's-2', gross: 50000, taxable: 50000, social: 0, tax: 1000, ins: {} }),
  Object.assign({}, bItem, { staff_id: 's-3' }), Object.assign({}, bItem, { staff_id: 's-4' }), Object.assign({}, bItem, { staff_id: 's-5', gross: 0 })], '2026-12-24', ytdNow);
const pr = (sid) => plan.rows.find((r) => r.staff_id === sid);
t('新しい人は rev 0・形は payroll_ytd_put の p_rows（source=app・kind=bonus）', pr('s-1') && pr('s-1').rev === 0 && pr('s-1').source === 'app' && pr('s-1').kind === 'bonus' && pr('s-1').pay_date === '2026-12-24'
  && Object.keys(pr('s-1')).sort().join() === 'data,kind,pay_date,rev,source,src_fp,staff_id', pr('s-1'));
t('同じ支給日の2回にいる人は合算（DB と同じ）・手で足した行はその版で置き換え（replace に出す）', pr('s-2').data.gross === 350000 && pr('s-2').data.income_tax === 11000 && pr('s-2').rev === 3
  && plan.replace.length === 1 && plan.replace[0].staff_id === 's-2' && plan.replace[0].source === 'manual', [pr('s-2'), plan.replace]);
t('同じ値の app の行がある人は送らない（same）・年末調整を確定した人は送らない（final）・総支給0の人は送らない', !pr('s-3') && plan.same.join() === 's-3' && !pr('s-4') && plan.final.join() === 's-4' && !pr('s-5') && plan.rows.length === 2, plan);
const pk = FS.pickByDate([{ pay_date: '2026-06-25', x: 1 }, { pay_date: '2026-12-24', x: 2 }, { pay_date: null, x: 3 }], '2026-12-24');
t('pickByDate: 支給日が同じ行と、支給日の無い行だけ', pk.rows.map((r) => r.x).join() === '2,3' && !pk.off && pk.dates.join() === '2026-06-25,2026-12-24' && pk.nodate === 1, pk);
const pk2 = FS.pickByDate([{ pay_date: '2026-06-25' }], '2026-12-24'), pk3 = FS.pickByDate([{ pay_date: null }, { pay_date: null }], '2026-12-24');
t('pickByDate: 支給日がある行が1つも合わなければ off（夏の賞与の CSV で冬を比べない）・支給日の列が無ければしぼらない', pk2.off === true && pk3.off === false && pk3.rows.length === 2);
/* 反証レビュー（2026-11-23 画面）: 読めない支給日は「支給日の無い行」にしない／給与は月でしぼる／0円にした人の古い app の行 */
const bdP = FS.parse('氏名,賞与支給日,総支給額,課税支給額,所得税\n見本 一,R8.7.10,"300,000","300,000","10,000"\n', { kind: 'bonus' });
const pk4 = FS.pickByDate(bdP.rows, '2026-12-24');
t('pickByDate: 支給日の列はあるのに読めない行（R8.7.10）は badDate・比べない（off・why baddate）', bdP.rows[0].badDate === true && bdP.rows[0].pay_date === null && pk4.off === true && pk4.why === 'baddate' && pk4.baddate === 1 && pk4.rows.length === 0, pk4);
const pk5 = FS.pickByDate([{ pay_date: '2026-11-25' }, { pay_date: '2026-12-25' }], '2026-12', { month: true }), pk6 = FS.pickByDate([{ pay_date: '2026-11-25' }], '2026-12', { month: true });
t('pickByDate（month）: 給与は支給日の年月でしぼる・この月の行が無ければ off（前月の CSV で比べない）', pk5.rows.length === 1 && pk5.rows[0].pay_date === '2026-12-25' && !pk5.off && pk6.off === true && pk6.why === 'other');
const plan2 = FS.planBonusYtd([Object.assign({}, bItem, { staff_id: 's-1', gross: 0 }), Object.assign({}, bItem, { staff_id: 's-3' })], '2026-12-24',
  { rows: [{ staff_id: 's-1', pay_date: '2026-12-24', kind: 'bonus', source: 'app', data: { gross: 100000 }, rev: 1 }, ytdNow.rows[1], { staff_id: 's-9', pay_date: '2026-12-24', kind: 'bonus', source: 'manual', data: { gross: 1 }, rev: 1 }], yearend: [] });
t('planBonusYtd: 今は0円（支給なし）なのに累計に前の確定の app の行が残る人は stale（送らない・manual の行は対象外）', plan2.stale.join() === 's-1' && plan2.rows.length === 0 && plan2.same.join() === 's-3', plan2);

console.log('\n— 7. 個人情報・部品の作法 —');
t('DOM・端末への保存・console・通信を使わない', !/document\.|localStorage|sessionStorage|indexedDB|console\.|fetch\(|XMLHttpRequest/.test(SRC));
t('見出しの候補の表の頭に「未検証」の注記', /★未検証（事務担当が書き出した実物で確かめる）/.test(SRC) && /見出しの候補（★未検証/.test(SRC));
t('window.PayrollFreeeSlips と module.exports の両方', /root\.PayrollFreeeSlips = api/.test(SRC) && /module\.exports = api/.test(SRC));
t('架空の見本に本物らしい番号の形（12桁のマイナンバー）が無い', !/\b\d{12}\b/.test(fx('freee-slips-salary-2026-11.csv') + fx('freee-slips-bonus-2026-07.csv')));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
