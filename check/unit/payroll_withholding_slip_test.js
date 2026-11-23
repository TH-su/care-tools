/* 源泉徴収票・合計表の値（payroll-withholding-slip.js）の試験（2026-11-23 新設・凍結仕様 ROOT-yearend.md の B3）
   実行: node check/unit/payroll_withholding_slip_test.js
   守りたいこと:
     1. 年末調整をした人は 源泉徴収税額＝年調年税額、控除後の金額・所得控除の合計を書く（手引 p.5 の欄5〜7）
     2. 年末調整をしない人は 支払金額・源泉徴収税額＝徴収済みの合計で、控除後の金額などは空
     3. マイナンバー・個人番号の欄を作らない。住所は空欄。文字はエスケープ。「様式の並びは未検証」を出す
     4. 合計表（375）: 総額の行は前職を含めず、提出する行は前職を含める（手引 p.31）。年の中途退職で30万円以下は提出しない（手引 p.3）
   ★人と金額は架空。設例の数字は冊子 p.57 の〔参考〕設例 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Y = require(path.join(ROOT, 'payroll-yearend.js'));
const S = require(path.join(ROOT, 'payroll-withholding-slip.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + b + '）', a === b, a); }
function row(d, pay, si, tax, kind) { return { pay_date: d, kind: kind || 'salary', data: { gross: pay, taxable: pay, si_health: si || 0, income_tax: tax || 0 } }; }

const exRows = [];
['01-20', '02-20', '03-19', '04-20', '05-20', '06-19', '07-17', '08-20', '09-18', '10-20', '11-20', '12-18'].forEach((d, i) => exRows.push(row('2026-' + d, i < 3 ? 590000 : 600000, i < 3 ? 90712 : 92454, i < 3 ? 6320 : 6690)));
exRows.push(row('2026-06-10', 900000, 140940, 77500, 'bonus'), row('2026-12-25', 900000, 140940, 0, 'bonus'));
const ex = Y.computeYearEnd({
  year: 2026, rows: exRows, decl: {
    kou: true, spouse: { name: '架空 花', kana: 'カクウ ハナ', birth: '1985-05-05', income: 500000 },
    dependents: [
      { name: '架空 一', birth: '2009-05-01', income: 0 }, { name: '架空 二', birth: '2006-04-01', income: 0 },
      { name: '架空 三', birth: '1950-03-03', income: 0, relation: '父', live_together: true, disability: 'general' },
      { name: '架空 四', birth: '2005-07-07', income: 1000000 }, { name: '架空 五', birth: '2019-09-09', income: 0 }
    ],
    insurance: { life_new_general: 80000, life_old_general: 35000, life_new_care: 80000, life_new_pension: 30000, life_old_pension: 90000, quake: 42000, old_long_fire: 14800 },
    housing_loan: { amount: 76500, start_date: '2020-04-01', count: 1, kind: '住' }
  }
});
const staff = { staff_id: 'S-TEST-1', name: '架空 太郎', kana: 'カクウ タロウ', birth: '1983-01-10', post: '介護職' };
const co = { name: '架空の事業所', address: '架空県架空市1-1', tel: '000-0000-0000' };
const v = S.slipValues(ex, staff, co);

console.log('1. 年末調整をした人の欄');
eq('年末調整した', v.adjusted, true);
eq('表題', v.title, '令和8年分 給与所得の源泉徴収票');
eq('支払金額', v.pay, 8970000);
eq('給与所得控除後の金額（調整控除後）', v.kyuyo_after, 6973000);
eq('所得控除の額の合計額', v.deductions_total, 4826102 + 0);
eq('源泉徴収税額＝年調年税額', v.tax, 41400);
eq('控除対象配偶者 有', v.spouse_has, '有');
eq('配偶者（特別）控除の額', v.spouse_deduction, 380000);
eq('特定の数', v.dep_specific, 1);
eq('老人の数', v.dep_elderly, 1);
eq('老人のうち同居', v.dep_elderly_cohabit, 1);
eq('その他の数', v.dep_other, 1);
eq('特親の数', v.dep_tokutei, 1);
eq('16歳未満の数', v.under16, 1);
eq('障害者（その他）', v.disabled_other, 1);
eq('特定親族特別控除の額', v.tokutei_amount, 410000);
eq('社会保険料等の金額', v.si_amount, 1386102);
eq('生命保険料の控除額', v.life_amount, 120000);
eq('地震保険料の控除額', v.quake_amount, 50000);
eq('住宅借入金等特別控除の額', v.housing_amount, 76500);
eq('住宅の適用数', v.housing_count, 1);
eq('基礎控除の額', v.basic, 620000);
eq('所得金額調整控除額', v.income_adjust, 47000);
eq('配偶者の合計所得', v.spouse_income, 500000);
eq('新生命保険料の金額', v.life_new, 80000);
eq('旧個人年金保険料の金額', v.pension_old, 90000);
eq('旧長期損害保険料の金額', v.old_long, 14800);
eq('控除対象扶養親族の欄は4人まで', v.dependents.length, 4);
eq('16歳未満の欄', v.under16_names.length, 1);
t('摘要に生命保険料の特例（手引 p.11 の (4)）', v.tekiyo.indexOf('租税特別措置法第41条の15の5第1項適用') >= 0);
t('摘要に所得金額調整控除の（調整）（手引 p.11 の (3)）', v.tekiyo.indexOf('（調整）') >= 0);
eq('住所は空欄', v.address, '');
eq('生年月日の元号', v.birth_wareki.text, '昭和58年1月10日');
eq('支払者', v.payer_name, '架空の事業所');
t('マイナンバー・個人番号の鍵が無い', !Object.keys(v).some(k => /my_?number|kojin|個人番号|マイナンバー|corp_?number|法人番号/i.test(k)));

console.log('2. 年末調整をしない人の欄（乙欄）');
const otsu = Y.computeYearEnd({ year: 2026, rows: [row('2026-03-25', 200000, 0, 7000), row('2026-04-25', 200000, 0, 7000)], decl: { kou: false } });
const vo = S.slipValues(otsu, { name: '架空 乙' }, co);
eq('年末調整していない', vo.adjusted, false);
eq('支払金額＝支払った合計', vo.pay, 400000);
eq('源泉徴収税額＝徴収済みの合計', vo.tax, 14000);
eq('給与所得控除後の金額は空', vo.kyuyo_after, null);
eq('所得控除の合計は空', vo.deductions_total, null);
eq('基礎控除の額は空', vo.basic, null);
eq('乙欄の印は kou=false からは付けない（甲欄の中途退職者もあるため）', vo.otsu, false);
eq('乙欄の印は staffInfo.otsu で付ける', S.slipValues(otsu, { name: '架空 乙', otsu: true }, co).otsu, true);
eq('生年月日は birth_date の名でも受ける', S.slipValues(otsu, { birth_date: '1990-02-03' }, co).birth, '1990-02-03');
eq('扶養の数は 0', vo.dep_other, 0);

console.log('3. 中途就職・退職と前職');
const pj = Y.computeYearEnd({ year: 2026, rows: [row('2026-10-25', 300000, 40000, 5000), row('2026-11-25', 300000, 40000, 5000), row('2026-12-25', 300000, 40000, 5000)],
  prevJobs: [{ payer: '架空の前職', pay: 1200000, si: 160000, tax: 20000, left_on: '2026-08-31' }], decl: { kou: true } });
const vp = S.slipValues(pj, { name: '架空 中途', joined_on: '2026-10-01' }, co);
eq('支払金額は前職を含む', vp.pay, 2100000);
eq('自社の支払金額', vp.own_pay, 900000);
eq('就職の日', vp.joined_on, '2026-10-01');
eq('退職の日は空', vp.left_on, '');
t('摘要に前職の名・退職日・金額', vp.tekiyo.indexOf('架空の前職') >= 0 && vp.tekiyo.indexOf('2026-08-31') >= 0 && vp.tekiyo.indexOf('1,200,000') >= 0);
const vr = S.slipValues(otsu, { name: '架空 退職', left_on: '2026-04-30' }, co);
eq('年の中途の退職日', vr.left_on, '2026-04-30');
eq('12月31日の退職は中途退職にしない', S.slipValues(otsu, { left_on: '2026-12-31' }, co).left_on, '');
eq('別の年の就職日は書かない', S.slipValues(otsu, { joined_on: '2020-04-01' }, co).joined_on, '');

console.log('4. 印刷用 HTML');
const html = S.slipHtml([v, vo, vp]);
t('「様式の並びは未検証」を出す', html.indexOf('様式の並びは未検証') >= 0);
eq('A4 2人分で 3人なら2頁', (html.match(/class="wsl-page"/g) || []).length, 2);
eq('人の枠は3つ', (html.match(/class="wsl"/g) || []).length, 3);
t('マイナンバー・個人番号の欄が無い', !/マイナンバー|個人番号|法人番号/.test(html));
t('支払金額を3桁区切りで', html.indexOf('8,970,000') >= 0);
t('元号の生年月日', html.indexOf('昭和58年1月10日') >= 0);
const xss = S.slipHtml(S.slipValues(otsu, { name: '<img src=x onerror=alert(1)>' }, { name: '"&<>' }));
t('氏名をエスケープする', xss.indexOf('<img') < 0 && xss.indexOf('&lt;img') >= 0);
t('支払者をエスケープする', xss.indexOf('&quot;&amp;&lt;&gt;') >= 0);
t('1人でも出せる', S.slipHtml(v).indexOf('class="wsl"') >= 0);
t('用紙の大きさは SUPrint に任せる（@page を出さない）', html.indexOf('@page') < 0);
t('2人分の枠の高さが A4（余白10mm）に収まる 132mm×2＋3mm×2＜277mm', /height:132mm/.test(html) && /margin-bottom:3mm/.test(html));

console.log('5. 合計表（375）と総括表');
const small = S.slipValues(otsu, { name: '架空 小', left_on: '2026-04-30' }, co);   /* 年の中途退職・40万円 → 提出する */
const tiny = S.slipValues(Y.computeYearEnd({ year: 2026, rows: [row('2026-02-25', 300000, 0, 0)], decl: { kou: true } }), { name: '架空 極小', left_on: '2026-02-28' }, co);  /* 30万円ちょうど・中途退職 → 出さない */
const tiny2 = S.slipValues(Y.computeYearEnd({ year: 2026, rows: [row('2026-02-25', 300001, 0, 0)], decl: { kou: true } }), { name: '架空 極小2', left_on: '2026-02-28' }, co);  /* 30万円超 → 出す */
const stay = S.slipValues(Y.computeYearEnd({ year: 2026, rows: [row('2026-12-25', 200000, 0, 0)], decl: { kou: true } }), { name: '架空 在籍' }, co);  /* 在籍・20万 → 出す */
t('中途退職で30万円ちょうどは出さない', S.submitTarget(tiny) === false);
t('中途退職で30万円超は出す', S.submitTarget(tiny2) === true);
t('在籍の人は少額でも出す', S.submitTarget(stay) === true);
const sum = S.summaryValues([v, vp, small, tiny, tiny2, stay]);
eq('総額の人員', sum.total_people, 6);
eq('総額の支払金額は前職を含めない', sum.total_pay, 8970000 + 900000 + 400000 + 300000 + 300001 + 200000);
/* 中途就職の人の年税額: 2,100,000→1,360,000−280,000−1,040,000＝40,000→2,000→2,042→2,000。自社分は 2,000−20,000 で 0 */
eq('中途就職の人の年税額', pj.nenzei, 2000);
eq('中途就職の人の自社分の源泉徴収税額は 0（前職の税の方が多い）', vp.own_tax, 0);
eq('総額の源泉徴収税額（自社分）', sum.total_tax, 41400 + 0 + 14000 + 0 + 0 + 0);
eq('源泉徴収税額のない者（票の源泉徴収税額が0の人・手引 p.31）', sum.total_no_tax_people, 3);
eq('提出する人員（中途退職30万以下を除く）', sum.submit_people, 5);
eq('提出する支払金額は前職を含める', sum.submit_pay, 8970000 + 2100000 + 400000 + 300001 + 200000);
eq('提出する源泉徴収税額', sum.submit_tax, 41400 + 2000 + 14000 + 0 + 0);
eq('給与支払報告書の受給者総人員', sum.report_total_people, 6);
eq('給与支払報告書の報告人員', sum.report_people, 5);
t('みなし提出の注記', sum.notes.some(n => n.indexOf('みなされます') >= 0));
eq('空の一覧', S.summaryValues([]).total_people, 0);
eq('computeYearEnd の結果を渡しても数える（人員）', S.summaryValues([ex, pj]).total_people, 2);
eq('computeYearEnd の結果を渡しても数える（提出の支払金額）', S.summaryValues([ex, pj]).submit_pay, 8970000 + 2100000);
t('結果を渡した時は退職日が分からない旨の注記', S.summaryValues([ex]).notes.some(n => n.indexOf('退職日の分からない') >= 0));

console.log('6. CSV');
const csv = S.toCsv([v, vo], sum);
t('BOM つき', csv.charCodeAt(0) === 0xfeff);
const lines = csv.slice(1).split('\r\n');
t('見出しに支払金額', lines[0].split(',').indexOf('支払金額') >= 0);
eq('人の行は2行', lines.slice(1, 3).filter(l => l && !/^合計表/.test(l)).length, 2);
t('支払金額の列の値', lines[1].split(',')[lines[0].split(',').indexOf('支払金額')] === '8970000');
t('合計表の行', csv.indexOf('源泉徴収票を提出するもの') >= 0);
eq('{slips, summary} の形でも受ける', S.toCsv({ slips: [v, vo], summary: sum }), csv);
t('マイナンバーの列が無い', !/マイナンバー|個人番号/.test(lines[0]));
const inj = S.toCsv([S.slipValues(otsu, { name: '=HYPERLINK("x")' }, co)]);
t('式で始まる文字は頭に引用符', inj.indexOf("\"'=HYPERLINK(\"\"x\"\")\"") >= 0);
t('カンマを含む文字は囲む', S.toCsv([S.slipValues(otsu, { name: 'a,b' }, co)]).indexOf('"a,b"') >= 0);

/* 反証レビュー（2026-11-23 の2回目）: 乙欄の印を CSV の列にも出す（staffInfo.otsu で受ける） */
{
  const oc = S.toCsv([S.slipValues(otsu, { name: '見本 乙', otsu: true }, co), S.slipValues(otsu, { name: '見本 甲' }, co)]).slice(1).split('\r\n');
  const io = oc[0].split(',').indexOf('乙欄');
  t('CSV に乙欄の列（乙欄の人は 1・そうでない人は空）', io >= 0 && oc[1].split(',')[io] === '1' && oc[2].split(',')[io] === '');
}
console.log('7. 和暦');
eq('令和元年', S.wareki('2019-05-01').text, '令和元年5月1日');
eq('平成31年4月30日', S.wareki('2019-04-30').text, '平成31年4月30日');
eq('平成元年1月8日', S.wareki('1989-01-08').text, '平成元年1月8日');
eq('昭和64年1月7日', S.wareki('1989-01-07').text, '昭和64年1月7日');
eq('形違いは null', S.wareki('1989/01/07'), null);

console.log('8. 反証レビューの指摘の場面（2026-11-23）');
const gRes = Y.computeYearEnd({ year: 2026, rows: [row('2026-03-25', 200000, 0, 3000)], decl: { kou: false,
  spouse: { name: '架空 配', kana: 'カクウ ハイ', birth: '1980-01-01', income: 0 },
  dependents: [{ name: '架空 年少', birth: '2016-01-01', income: 0 }, { name: '架空 一般', birth: '2000-01-01', income: 0 }] } });
const gv = S.slipValues(gRes, { name: '架空 退職', left_on: '2026-03-31' }, co);
eq('中途退職者の票にも源泉控除対象配偶者 有', gv.spouse_has, '有');
eq('配偶者の氏名', gv.spouse_name, '架空 配');
eq('その他の控除対象扶養親族の数', gv.dep_other, 1);
eq('16歳未満の扶養親族の数', gv.under16, 1);
eq('16歳未満の扶養親族の氏名', gv.under16_names[0].name, '架空 年少');
eq('控除対象扶養親族の氏名', gv.dependents[0].name, '架空 一般');
eq('年末調整をしないので配偶者控除の額は空', gv.spouse_deduction, null);
t('印刷にも氏名が出る', S.slipHtml(gv).indexOf('架空 年少') >= 0 && S.slipHtml(gv).indexOf('架空 一般') >= 0);
const npv = S.slipValues(Y.computeYearEnd({ year: 2026, rows: [row('2026-12-25', 3000000)], decl: { kou: true, insurance: { national_pension: 200000 } } }), {}, co);
eq('国民年金保険料等の金額の欄', npv.national_pension, 200000);
t('国民年金保険料等を印刷に出す', S.slipHtml(npv).indexOf('国民年金保険料等 200,000') >= 0);
t('CSV に国民年金保険料等の列', S.toCsv([npv]).indexOf('国民年金保険料等の金額') >= 0);
const hv = S.slipValues(Y.computeYearEnd({ year: 2026, rows: [row('2026-12-25', 1000000)], decl: { kou: true, housing_loan: { amount: 50000, start_date: '2023-04-01', count: 1, kind: '住', income_limit: 20000000 } } }), {}, co);
eq('可能額があれば算出税額 0 でも適用数', hv.housing_count, 1);
eq('可能額', hv.housing_possible, 50000);
eq('居住開始年月日', hv.housing_start, '2023-04-01');
const bv = S.slipValues(otsu, { name: '架空 短期', joined_on: '2026-03-01', left_on: '2026-04-30' }, co);
eq('中途就職と中途退職の両方は就職の欄を空', bv.joined_on, '');
eq('退職の日は書く', bv.left_on, '2026-04-30');
t('摘要に「中途就」', bv.tekiyo.indexOf('中途就') >= 0);
const av = S.slipValues(Y.computeYearEnd({ year: 2026, rows: [row('2026-12-25', 900000)], prevJobs: [{ payer: '架空の前職', address: '架空県架空町2-2', pay: 1200000, si: 0, tax: 0, left_on: '2026-08-31' }], decl: { kou: true } }), {}, co);
t('摘要に前職の住所（手引 p.12 摘要(6)(イ)）', av.tekiyo.indexOf('架空県架空町2-2') >= 0);

console.log('\n' + (fail ? '✗' : '✓') + ' payroll_withholding_slip ' + pass + ' 件成功／' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
