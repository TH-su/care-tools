/* 給与計算の反証の直しの試験（2026-11-21 新設）
   実行: node check/unit/payroll_fix6_test.js
   守りたいこと:
     A. 日給の法定休日: 実働が全部法定休日に入る日だけ基本給の日数から除く。一部だけかかる夜勤（土曜22時〜日曜7時）は基本給の日数に残し、休日労働はかかった分だけ
     B. 給与の照合（attSame）は holidayWorkDays・noSchedWorkMin も比べる（控えに鍵が無い時は比べない）
     C. 日給の半日有休は日給×0.5日（payroll_fix5_test の 4 にもある）
     D1. 口座の名義（カナ）は振込データと同じ字の直しで確かめ、使えない字・半角で30字を超える時は保存・取り込みをしない。振込データの知らせにどの職員かを添える
     D2. 率表・税額表・標準報酬が無い月の警告は、確定の窓で「確定できない警告」に分けて確定させない
     D3. 通勤手当の非課税限度（国税庁の表・支給日で選ぶ）
     D4. 乙欄では扶養の数を引かず、1以上なら警告（payroll_calc_test にもある）
     D5. 全銀の桁で切る時、濁点・半濁点の手前で切る。書き出しの警告を知らせに出す
   ★職員は架空。期待値は手で数えた数字。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const PC = require(path.join(ROOT, 'payroll-calc.js'));
const KC = require(path.join(ROOT, 'kintai-calc.js'));
const X = require(path.join(ROOT, 'payroll-export.js'));
const Rates = require(path.join(ROOT, 'payroll-rates.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
const between = (a, b) => { const i = J.indexOf(a), j = J.indexOf(b, i + 1); return i >= 0 && j > i ? J.slice(i, j) : ''; };
const attSrc = between('  var ATT_KEYS', '  function verifyKintai(');
const A = new Function('function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }\n' + attSrc + '\nreturn { attFromKintai: attFromKintai, attSame: attSame };')();
const kSrc = between('  function kanaCheck(', '  function bankGo(');
const eSrc = between('  var EXP_WHERE', '  function exportGo(');
const P = new Function('X', kSrc + eSrc + '\nreturn { kanaCheck: kanaCheck, expMsg: expMsg };')(() => X);

const PERIOD = { from: '2026-12-01', to: '2026-12-31' };
const run = (profile, att, payDate) => PC.computeItem({ ym: '2026-12', period: PERIOD, payDate: payDate || '2027-01-25', settings: {}, profile, allowanceDefs: [], att, adjustments: [] });
const L = (it, code) => { const l = it.lines.find((x) => x.code === code && x.sec !== 'att'); return l ? l.amount : undefined; };
const W = (it, code) => it.warnings.some((w) => w.code === code);
const WM = (it, code) => (it.warnings.find((w) => w.code === code) || {}).msg || '';
const DAILY = { pay_type: 'daily', base: 10000, day_hours: 8, ins: {}, tax: { col: 'none' } };
const at = (d, hm) => KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const PU = (d, k, hm) => ({ id: 'p' + (++pid), staff_id: 'x', kind: k, at: new Date(at(d, hm)).toISOString(), source: 'tablet' });
const snap = (o) => KC.snapshotOf(KC.computeMonth(Object.assign({ ym: '2026-12', staff: [{ staff_id: 'x', office: 'facility' }], schedule: [], punches: [], days: [], config: { legal_holiday: 0 }, now: Date.parse('2027-01-10') }, o))).rows[0];
const att = (r) => Object.assign(A.attFromKintai(r), { reviewCount: 0 });

console.log('\n— A. 日給の法定休日（全部が法定休日の日だけ基本給の日数から除く）—');
{
  /* 2026-12-05 は土曜・12-06 は日曜（法定休日） */
  const night = [{ staff_id: 'x', work_date: '2026-12-05', seq: 1, office: 'facility', kind: 'night', start_at: KC.iso(at('2026-12-05', '22:00')), end_at: KC.iso(at('2026-12-06', '7:00')), break_min: 60, paid_min: 0, symbol: '夜' }];
  const rN = snap({ schedule: night, punches: [PU('2026-12-05', 'in', '22:00'), PU('2026-12-06', 'out', '7:00')] });
  t('土曜22時〜日曜7時の夜勤: 実働480分のうち法定休日373分・法定休日に働いた日は0日（一部だけかかる日は数えない）', rN.workMin === 480 && rN.holidayMin === 373 && rN.holidayWorkDays === 0, rN);
  const iN = run(DAILY, att(rN));
  t('日給: 基本給は 10000円（その日を残す・前は 0円）・休日労働は373分の分 10491円', L(iN, 'basic') === 10000 && L(iN, 'ot_holiday') === 10491 && !W(iN, 'holiday_days_unknown'), iN.lines.filter((l) => l.sec === 'pay'));
  const rS = snap({ punches: [PU('2026-12-06', 'in', '9:00'), PU('2026-12-06', 'out', '18:00')] });
  t('日曜 9〜18時（全部が法定休日）は1日・日給の基本給は 0円・休日労働 13500円（今と同じ）', rS.holidayWorkDays === 1 && L(run(DAILY, att(rS)), 'basic') === 0 && L(run(DAILY, att(rS)), 'ot_holiday') === 13500, rS);
  const rSat = snap({ punches: [PU('2026-12-05', 'in', '9:00'), PU('2026-12-05', 'out', '18:00')] });
  t('土曜の日勤（法定休日にかからない）は0日', rSat.holidayWorkDays === 0 && rSat.holidayMin === 0);
}

console.log('\n— B. 給与の照合で holidayWorkDays・noSchedWorkMin も比べる —');
{
  const base = { workDays: 2, workMin: 960, holidayMin: 480, holidayWorkDays: 1, noSchedWorkMin: 0 };
  const a = A.attFromKintai(base);
  t('同じなら一致', A.attSame(a, A.attFromKintai(Object.assign({}, base))));
  t('法定休日に働いた日の数が違えば食い違い', !A.attSame(a, A.attFromKintai(Object.assign({}, base, { holidayWorkDays: 0 }))));
  t('予定の無い勤務の実働が違えば食い違い', !A.attSame(a, A.attFromKintai(Object.assign({}, base, { noSchedWorkMin: 60 }))));
  const old = Object.assign({}, base); delete old.holidayWorkDays; delete old.noSchedWorkMin;
  t('控えに鍵が無い時は比べない（古い控えと一致）', A.attSame(a, A.attFromKintai(old)) && A.attSame(A.attFromKintai(old), a));
}

console.log('\n— D1. 口座の名義（カナ）—');
{
  t('全角カタカナ・空白・括弧は通る（半角にして30字以内）', P.kanaCheck('カクウ　イチロウ') === '' && P.kanaCheck('ｶ)ｶｸｳ') === '');
  t('漢字・ひらがなは使えない字として止める（字を文に出す）', /使えない字があります（架 空）/.test(P.kanaCheck('架空')) && /使えない字/.test(P.kanaCheck('かくう')));
  t('境目: 半角で30字ちょうどは通る・31字は止める（全角のガは半角で2字に数える）', P.kanaCheck('ア'.repeat(30)) === '' && /長すぎます（半角にして 31 字/.test(P.kanaCheck('ア'.repeat(29) + 'ガ')), P.kanaCheck('ア'.repeat(29) + 'ガ'));
  t('部品が読めない時は保存させない', /確かめられませんでした/.test(new Function('X', kSrc + '\nreturn kanaCheck;')(() => null)('ｶｸｳ')));
  const bg = between('  function bankGo(', '  /* ── freee の書き出しを取り込む');
  t('口座の保存は名義を確かめてから送る（確かめに通らなければ rpc を呼ばない）', /kanaCheck\(acc\[i\]\.name_kana\)[\s\S]*?return; \}[\s\S]*rpc\('payroll_bank_put'/.test(bg) && bg.indexOf('kanaCheck(') < bg.indexOf("rpc('payroll_bank_put'"));
  t('取り込みも名義を確かめ、通らない口座は送らない', /else if \(kanaCheck\(bank\.name_kana\)\) \{ ch\.push\('⚠ 口座名義に振込で使えない字があるか、半角にして30字を超えるので、口座は送りません（口座の画面で入れてください）'\); bank = null; \}/.test(J));
  t('知らせの1行にどの職員か（明細の表示名）と欄の名前を添える', P.expMsg({ where: 'record2.name', msg: '30桁を超えたので切りました', who: '架空 二' }) === '架空 二 さん：口座の名義：30桁を超えたので切りました' && P.expMsg({ where: 'header.bank_name', msg: 'x' }) === 'x');
}

console.log('\n— D2. 確定できない警告 —');
{
  const oc = between('  var BLOCK_WARN', '  function confirmGo(');
  t('確定できない警告は rate_missing・emp_rate_missing・tax_table_missing・std_missing の4つ（最低賃金の未設定などは入れない）', /var BLOCK_WARN = \{ rate_missing: 1, emp_rate_missing: 1, tax_table_missing: 1, std_missing: 1 \};/.test(oc) && !/min_wage/.test(oc));
  t('確定の窓: 分けて出し、確定のボタンを押せなくする', /確定できない警告（/.test(oc) && /data-act="confirm-go"' \+ \(blk\.length \? ' disabled' : ''\)/.test(oc) && /block: blk\.length/.test(oc));
  const cg = between('  function confirmGo(', '  function openUnconfirm(') || between('  function confirmGo(', "    })['catch'](function (e) { done(); closeDlg(); return fail(e, '確定'); });");
  t('押された時も止める・読み直して数え直した後も止める', /if \(dlgCtx\.block \|\| blockWarns\(items\(\)\)\.length\)/.test(cg) && /if \(blockWarns\(now\)\.length\)/.test(cg) && cg.indexOf('blockWarns(now)') < cg.indexOf("rpc('payroll_run_confirm'"));
  const blockWarns = new Function('arr', between('  var BLOCK_WARN', '  function openConfirm(') + '\nreturn blockWarns;')((v) => (Array.isArray(v) ? v : []));
  t('分け方: 健保の標準報酬が空は止める・最低賃金の未設定は止めない', blockWarns([{ name: '架空 一', warnings: [{ code: 'std_missing', msg: 'm' }, { code: 'min_wage_unknown', msg: 'w' }] }]).join() === '架空 一：m');
}

console.log('\n— D3. 通勤手当の非課税限度 —');
{
  t('交通用具: 支給日 2025-03-25（改正前）12km＝7100・2025-04-25 12km＝7300', Rates.commuteLimit('2025-03-25', 'car', 12) === 7100 && Rates.commuteLimit('2025-04-25', 'car', 12) === 7300);
  t('交通用具の境目: 1.9km＝0（全額課税）・2km＝4200・9.9km＝4200・10km＝7300', Rates.commuteLimit('2026-12-25', 'car', 1.9) === 0 && Rates.commuteLimit('2026-12-25', 'car', 2) === 4200 && Rates.commuteLimit('2026-12-25', 'car', 9.9) === 4200 && Rates.commuteLimit('2026-12-25', 'car', 10) === 7300);
  t('55km以上: 支給日 2026-03-25＝38700（100kmも）・2026-04-01 から 65km＝45700・95km＝66400', Rates.commuteLimit('2026-03-25', 'car', 100) === 38700 && Rates.commuteLimit('2026-04-01', 'car', 65) === 45700 && Rates.commuteLimit('2026-04-25', 'car', 95) === 66400 && Rates.commuteLimit('2026-04-25', 'car', 64.9) === 38700);
  t('改正前の 55km以上＝31600・45〜55km＝28000', Rates.commuteLimit('2024-12-25', 'car', 60) === 31600 && Rates.commuteLimit('2024-12-25', 'car', 50) === 28000);
  t('駐車場（2026-04-01 から・2km以上）: 8km＋駐車場8000円＝4200＋5000・3000円なら＋3000・2026-03-25 は足さない・1km は足さない', Rates.commuteLimit('2026-12-25', 'car', 8, 8000) === 9200 && Rates.commuteLimit('2026-12-25', 'car', 8, 3000) === 7200 && Rates.commuteLimit('2026-03-25', 'car', 8, 8000) === 4200 && Rates.commuteLimit('2026-12-25', 'car', 1, 8000) === 0);
  t('公共交通は 150000・併用と距離の無い交通用具は null', Rates.commuteLimit('2026-12-25', 'public') === 150000 && Rates.commuteLimit('2026-12-25', 'mixed', 8) === null && Rates.commuteLimit('2026-12-25', 'car', NaN) === null);
  const M = (cm, pd) => run({ pay_type: 'monthly', base: 200000, ins: {}, tax: { col: 'none' }, commute: cm }, {}, pd);
  const c1 = M({ monthly: 10000, means: 'car', distance_km: 12 });
  t('月給・車12km・通勤10000円（支給日 2027-01-25）: 非課税 7300円・課税 2700円', c1.buckets.nontax === 7300 && c1.taxable === 202700 && !W(c1, 'commute_limit_unknown'), [c1.buckets, c1.taxable]);
  const c0 = M({ monthly: 10000, means: 'car', distance_km: 12 }, '2025-03-25');
  t('同じ人の支給日 2025-03-25 は改正前の 7100円', c0.buckets.nontax === 7100);
  const c2 = M({ monthly: 10000, means: 'car', distance_km: null });
  t('距離が空の車の人: 今の扱いのまま全額非課税・警告（距離が空）', c2.buckets.nontax === 10000 && /片道の距離が空/.test(WM(c2, 'commute_limit_unknown')));
  const c3 = M({ monthly: 10000 });
  t('手段が空の人: 全額非課税・警告（手段が空）', c3.buckets.nontax === 10000 && /手段が空/.test(WM(c3, 'commute_limit_unknown')));
  const c4 = M({ monthly: 160000, means: 'public' });
  t('公共交通 160000円: 非課税 150000円・課税 10000円', c4.buckets.nontax === 150000 && c4.taxable === 210000);
  const c5 = M({ monthly: 3000, means: 'car', distance_km: 1 });
  t('2km未満: 全額課税（非課税 0円）', c5.buckets.nontax === 0 && c5.taxable === 203000);
  const c6 = M({ monthly: 10000, means: 'mixed', distance_km: 8 });
  t('併用: 全額非課税のまま警告（併用）', c6.buckets.nontax === 10000 && /併用/.test(WM(c6, 'commute_limit_unknown')));
  const src = fs.readFileSync(path.join(ROOT, 'payroll-rates.js'), 'utf8');
  t('出典の URL をコメントに書いた', /https:\/\/www\.nta\.go\.jp\/users\/gensen\/2025tsukin\/index\.htm/.test(src) && /https:\/\/www\.nta\.go\.jp\/users\/gensen\/2026tsukin\/index\.htm/.test(src));
}

console.log('\n— D4. 乙欄の扶養の数 —');
{
  const O = (dep) => run({ pay_type: 'monthly', base: 300000, ins: {}, tax: { col: 'otsu', dependents: dep, dependents_checked: true } }, {}, '2026-12-25');
  t('乙欄 30万: 扶養0も2も所得税は同じ 53600円・2の時だけ警告', Math.abs(L(O(0), 'income_tax')) === 53600 && L(O(0), 'income_tax') === L(O(2), 'income_tax') && W(O(2), 'otsu_dependents') && !W(O(0), 'otsu_dependents'), [L(O(0), 'income_tax'), L(O(2), 'income_tax')]);
  t('警告の文', WM(O(1), 'otsu_dependents') === '乙欄では扶養の数を数えていません（従たる給与の申告書を出した方は代表者へ）');
}

console.log('\n— D5. 全銀の桁で切る所 —');
{
  const FROM = { consignor_code: '9000000001', consignor_kana: 'ｶ)ｼｹﾝ', bank_code: '9999', bank_name_kana: 'ｼｹﾝｷﾞﾝｺｳ', branch_code: '001', branch_name_kana: 'ﾎﾝﾃﾝ', type: '1', number: '1234567' };
  const rec = (nm) => ({ bank_code: '9998', bank_name_kana: 'ﾃｽﾄ', branch_code: '010', branch_name_kana: 'ﾐﾅﾐ', type: '1', number: '7654321', name_kana: nm, amount: 1000 });
  const nameOf = (z) => z.lines[1].slice(50, 80);
  const zg = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [rec('ア'.repeat(29) + 'ガ')] });
  t('30桁目が ｶ・31桁目が ﾞ の時は ｶ も残さない（29字＋空白）', zg.ok && nameOf(zg) === 'ｱ'.repeat(29) + ' ' && zg.lines[1].length === 120 && zg.warnings.length === 1, nameOf(zg));
  const zp = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [rec('ア'.repeat(29) + 'パ')] });
  t('半濁点（ﾊﾟ）も同じ', nameOf(zp) === 'ｱ'.repeat(29) + ' ');
  const z30 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [rec('ア'.repeat(28) + 'ガ' + 'ア')] });
  t('濁点まで入りきる時は今のまま（28字＋ｶﾞ＝30桁で切る）', nameOf(z30) === 'ｱ'.repeat(28) + 'ｶﾞ', nameOf(z30));
  const zh = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: Object.assign({}, FROM, { consignor_kana: 'ア'.repeat(39) + 'ダ' }), records: [rec('ｶｸｳ')] });
  t('振込元の名義（40桁）も同じ（39字＋空白）', zh.lines[0].slice(14, 54) === 'ｱ'.repeat(39) + ' ', zh.lines[0].slice(14, 54));
  const settings = { bank_from: { consignor_code: '9000000001', consignor_kana: 'ｶ)ｼｹﾝ', bank_code: '9999', bank_kana: 'ｼｹﾝｷﾞﾝｺｳ', branch_code: '001', branch_kana: 'ﾎﾝﾃﾝ', type: '1', number: '1234567' }, zengin: { kind: '21' } };
  const items = [{ staff_id: 'a', name: '架空 一', net: 1000, lines: [] }, { staff_id: 'b', name: '架空 二', net: 2000, lines: [] }];
  const acc = (kn) => ({ bank_code: '0001', branch_code: '002', type: '1', number: '1111111', name_kana: kn, amount_or_rest: 'rest' });
  const z = X.zengin({ ym: '2026-12', payDate: '2026-12-25', settings, items, rows: [{ staff_id: 'a', net: 1000, accounts: [acc('ｶｸｳ')] }, { staff_id: 'b', net: 2000, accounts: [acc('ア'.repeat(31))] }] });
  t('zengin の警告に職員の表示名（who）が付く', z.ok && z.warnings.length === 1 && z.warnings[0].who === '架空 二' && z.warnings[0].where === 'record2.name', z.warnings);
  const zb = X.zengin({ ym: '2026-12', payDate: '2026-12-25', settings, items, rows: [{ staff_id: 'a', net: 1000, accounts: [acc('架空')] }] });
  t('止まった時の知らせにも職員の表示名が付く', !zb.ok && zb.errors.some((e) => e.who === '架空 一' && /使えない文字/.test(e.msg)) && P.expMsg(zb.errors[0]) === '架空 一 さん：口座の名義：全銀で使えない文字があります: 架 空', zb.errors);
  const eg = between('  function exportGo(', '  /* ── 職員の給与設定 ── */');
  t('書き出しの知らせ: 止まった時は expMsg で職員を添え、作れた時は警告を窓で出す', /var why = arr\(res\.errors\)\.slice\(0, 5\)\.map\(expMsg\)/.test(eg) && /var ws = arr\(res\.warnings\)\.map\(expMsg\)/.test(eg) && /if \(ws\.length\) say\(/.test(eg));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
