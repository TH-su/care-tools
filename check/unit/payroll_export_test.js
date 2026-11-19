/* 給与の書き出し（payroll-export.js）の試験（2026-11-19 新設・給与 v1・rates-2026.md §6）
   実行: node check/unit/payroll_export_test.js
   守りたいこと:
     1. 全銀（総合振込21・給与振込11）は1行120バイト・ヘッダ/データ/トレーラ/エンドの順・桁の位置が決まりどおり
     2. Shift_JIS のバイト（半角カナは 0xA1〜0xDF）・CRLF の有無・合計件数と合計金額・差引の合計との照合
     3. 全角カナ・全角英数は半角へ直す（濁点は2バイト）。直せない文字は「?」にせず止める
     4. 0円以下・口座の無い人は外す。口座の分け方（最大3つ・残り）
     5. 仕訳の借方と貸方が合う・賃金台帳（労基則54条の項目）・明細一覧の列・CSV が式として読まれない
   ★銀行・口座・氏名はすべて架空。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const X = require(path.join(ROOT, 'payroll-export.js'));
const C = require(path.join(ROOT, 'payroll-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function eq(n, a, b) { t(n + '（' + JSON.stringify(b) + '）', a === b, a); }

const FROM = { consignor_code: '9000000001', consignor_kana: 'ｶ)ｼｹﾝ', bank_code: '9999', bank_name_kana: 'ｼｹﾝｷﾞﾝｺｳ', branch_code: '001', branch_name_kana: 'ﾎﾝﾃﾝ', type: '1', number: '1234567' };
const REC = [
  { bank_code: '9998', bank_name_kana: 'ﾃｽﾄｷﾞﾝｺｳ', branch_code: '010', branch_name_kana: 'ﾐﾅﾐ', type: '1', number: '7654321', name_kana: 'ｼｹﾝ ｺｳ', amount: 200360 },
  { bank_code: '9998', bank_name_kana: 'テストギンコウ', branch_code: '20', branch_name_kana: 'キタ', type: '1', number: '12', name_kana: 'シケン　ガブ', amount: 145113 },
  { bank_code: '', number: '', name_kana: 'ｹﾞﾝｷﾝ', amount: 50000 },
  { bank_code: '9998', branch_code: '010', type: '1', number: '1111111', name_kana: 'ｾﾞﾛ', amount: 0 }
];
const z = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: REC, crlf: true });
const asText = (u8) => Array.from(u8).map((b) => String.fromCharCode(b)).join('');

console.log('1. 全銀の形');
t('作れた', z.ok, z.errors);
eq('行の数（ヘッダ1＋データ2＋トレーラ＋エンド）', z.lines.length, 5);
t('全行が120バイト', z.lines.every((l) => X.sjisBytes(l).length === 120), z.lines.map((l) => X.sjisBytes(l).length));
eq('バイト数（(120＋CRLF2)×5）', z.bytes.length, 610);
t('各行の終わりが CRLF', [120, 242, 364, 486, 608].every((i) => z.bytes[i] === 0x0D && z.bytes[i + 1] === 0x0A));
eq('件数', z.count, 2);
eq('合計', z.total, 345473);
eq('外した人（現金払い・0円）', z.excluded.length, 2);
const H = z.lines[0], D1 = z.lines[1], D2 = z.lines[2], TR = z.lines[3], EN = z.lines[4];
eq('ヘッダ: 区分', H.slice(0, 1), '1');
eq('ヘッダ: 種別（総合振込）', H.slice(1, 3), '21');
eq('ヘッダ: コード区分', H.slice(3, 4), '0');
eq('ヘッダ: 依頼人コード', H.slice(4, 14), '9000000001');
eq('ヘッダ: 依頼人名（40桁・左詰め）', H.slice(14, 54), 'ｶ)ｼｹﾝ' + ' '.repeat(35));
eq('ヘッダ: 振込指定日 MMDD', H.slice(54, 58), '1225');
eq('ヘッダ: 仕向銀行番号', H.slice(58, 62), '9999');
eq('ヘッダ: 仕向支店番号', H.slice(77, 80), '001');
eq('ヘッダ: 預金種目', H.slice(95, 96), '1');
eq('ヘッダ: 口座番号', H.slice(96, 103), '1234567');
eq('データ: 区分', D1.slice(0, 1), '2');
eq('データ: 被仕向銀行番号', D1.slice(1, 5), '9998');
eq('データ: 支店番号', D1.slice(20, 23), '010');
eq('データ: 手形交換所（空き4）', D1.slice(38, 42), '    ');
eq('データ: 預金種目', D1.slice(42, 43), '1');
eq('データ: 口座番号', D1.slice(43, 50), '7654321');
eq('データ: 受取人名（30桁）', D1.slice(50, 80), 'ｼｹﾝ ｺｳ' + ' '.repeat(24));
eq('データ: 金額（10桁・右詰めゼロ埋め）', D1.slice(80, 90), '0000200360');
eq('データ: 新規コード', D1.slice(90, 91), '0');
eq('データ: 振込指定区分（テレ為替7）', D1.slice(111, 112), '7');
eq('データ2: 支店番号を3桁にゼロ埋め', D2.slice(20, 23), '020');
eq('データ2: 口座番号を7桁にゼロ埋め', D2.slice(43, 50), '0000012');
eq('データ2: 全角カナを半角へ（濁点は別の1字）', D2.slice(50, 80).trimEnd(), 'ｼｹﾝ ｶﾞﾌﾞ');
eq('データ2: 銀行名の全角カナを半角へ', D2.slice(5, 20).trimEnd(), 'ﾃｽﾄｷﾞﾝｺｳ');
eq('トレーラ: 区分', TR.slice(0, 1), '8');
eq('トレーラ: 件数（6桁）', TR.slice(1, 7), '000002');
eq('トレーラ: 金額（12桁）', TR.slice(7, 19), '000000345473');
eq('エンド', EN, '9' + ' '.repeat(119));
eq('依頼人名の3字目「ｼ」は 0xBC', z.bytes[16], 0xBC);
t('半角カナは1バイト（0xA1〜0xDF）', X.sjisBytes('ｱﾝﾞﾟ').join(',') === [0xB1, 0xDD, 0xDE, 0xDF].join(','));

console.log('2. 種別・改行・文字の検査');
{
  const z2 = X.zenginBuild({ kind: '11', payDate: '2026-12-25', from: FROM, records: REC.slice(0, 1), crlf: false });
  eq('給与振込の種別 11', z2.lines[0].slice(1, 3), '11');
  eq('改行なし: 120×4', z2.bytes.length, 480);
  eq('給与振込の振込指定区分は空白', z2.lines[1].slice(111, 112), ' ');
  const z3 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [Object.assign({}, REC[0], { name_kana: '試験 甲' })] });
  t('漢字は止める（? にしない）', !z3.ok && z3.bytes === null && z3.errors.some((e) => /試/.test(e.msg)), z3.errors);
  const z4 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [Object.assign({}, REC[0], { number: '12345678' })] });
  t('口座番号が8桁は止める', !z4.ok);
  const z5 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [Object.assign({}, REC[0], { name_kana: 'ｱ'.repeat(35) })] });
  t('名前が30桁を超えたら切って知らせる', z5.ok && z5.warnings.length === 1 && z5.lines[1].slice(50, 80) === 'ｱ'.repeat(30));
  const z6 = X.zenginBuild({ kind: '21', payDate: '12/25', from: FROM, records: [] });
  t('振込指定日の形が違えば止める', !z6.ok);
  const z7 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: Object.assign({}, FROM, { type: '4' }), records: [] });
  t('振込元の預金種目は普通か当座だけ', !z7.ok);
  const z8 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [Object.assign({}, REC[0], { type: '4' })] });
  t('受取人は貯蓄(4)も可', z8.ok);
  const z9 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [], eof: true });
  t('EOF を付ける設定', z9.bytes[z9.bytes.length - 1] === 0x1A);
  const z10 = X.zenginBuild({ kind: '21', payDate: '2026-12-25', from: FROM, records: [Object.assign({}, REC[0], { amount: 100.5 })] });
  t('整数でない金額は外す', z10.excluded.length === 1 && z10.count === 0);
}
eq('全角英数・小文字を半角の大文字へ', X.zenginText('ＡＢｃ１２').text, 'ABC12');
eq('小さいカナは大きいカナへ（仮置き）', X.zenginText('ショウ').text, 'ｼﾖｳ');
eq('長音は -（仮置き）', X.zenginText('ルーム').text, 'ﾙ-ﾑ');
eq('ヴは2字', X.zenginText('ヴ').text, 'ｳﾞ');
eq('全角空白は半角へ', X.zenginText('ア　イ').text, 'ｱ ｲ');
t('ひらがなは直せない', X.zenginText('あ').bad[0] === 'あ');
t('使える記号 ( ) - . / ,', X.zenginText('()-./,').bad.length === 0);

console.log('3. 口座の分け方・合計の照合');
{
  const s = X.splitAccounts(200000, [{ number: 'A', amount_or_rest: 30000 }, { number: 'B', amount_or_rest: 'rest' }]);
  t('定額の口座と残りの口座', s.parts.length === 2 && s.parts[0].amount === 30000 && s.parts[1].amount === 170000);
  const s2 = X.splitAccounts(20000, [{ number: 'A', amount_or_rest: 30000 }, { number: 'B', amount_or_rest: 'rest' }]);
  t('差引が定額より少なければ定額の口座に全部・残りは0', s2.parts.length === 1 && s2.parts[0].amount === 20000);
  const s3 = X.splitAccounts(100000, [{ number: 'A', amount_or_rest: 10000 }, { number: 'B', amount_or_rest: 20000 }]);
  t('残りの印が無ければ最後の口座が残りを受ける', s3.parts[1].amount === 90000 && s3.parts.length === 2);
  const s4 = X.splitAccounts(100000, [1, 2, 3, 4].map((n) => ({ number: String(n), amount_or_rest: 10 })));
  t('口座は最大3つ', s4.parts.length === 3);
  const s5 = X.splitAccounts(100000, []);
  t('口座が無ければ全額が残る（現金払い）', s5.parts.length === 0 && s5.rest === 100000);
}
{
  const ok = X.checkTotals([{ net: 200360 }, { net: 145113 }, { net: 50000, transferable: false }, { net: -100 }], z);
  t('差引の合計とファイルの合計が合う', ok.ok && ok.diff === 0, ok);
  const ng = X.checkTotals([{ net: 200360 }, { net: 145114 }], z);
  t('1円違えば合わない', !ng.ok && ng.diff === -1);
}

console.log('4. 仕訳・賃金台帳・明細一覧');
const PERIOD = { from: '2026-11-16', to: '2026-12-15' };
const L5 = (it, code) => { const l = it.lines.find((x) => x.code === code); return l ? l.amount : 0; };
function item(profile, att, extra) { return C.computeItem(Object.assign({ ym: '2026-12', period: PERIOD, payDate: '2026-12-25', settings: {}, profile, allowanceDefs: [], att: att === undefined ? {} : att }, extra || {})); }
const I1 = item({ pay_type: 'monthly', base: 220000, birth_date: '1980-04-10', ins: { health: { on: true, std: 220000 }, pension: { on: true, std: 220000 }, emp: { on: true } }, tax: { col: 'kou', dependents: 0 }, commute: { monthly: 8000 }, resident_tax: { '2026-12': 9000 } }, { workDays: 20, workMin: 9900, legalOverMin: 300, nightMin: 0, holidayMin: 0 });
const I2 = item({ pay_type: 'board', board_pay: 500000, birth_date: '1965-04-04', ins: { health: { on: true, std: 500000 }, pension: { on: true, std: 500000 } }, tax: { col: 'kou', dependents: 2 }, no_attendance: true }, null);
{
  const j = X.journalCsv([{ item: I1 }, { item: I2, board: true }], { date: '2026-12-25' });
  t('仕訳の借方と貸方が合う', j.balanced, [j.debit, j.credit]);
  eq('給与手当（通勤を除く）', j.sums.salary, I1.gross - 8000);
  eq('役員報酬', j.sums.board, 500000);
  eq('旅費交通費（通勤）', j.sums.commute, 8000);
  eq('普通預金＝差引の合計', j.sums.net, I1.net + I2.net);
  /* 会社負担（手で数える）: 職員 健保11088＋介護1782＋支援金253＋厚年20130＋拠出金792＋雇保(236000×0.0085＝2006)、
     役員 健保25200＋介護4050＋支援金575＋厚年45750＋拠出金1800 → 合計 113426 */
  eq('法定福利費（会社負担の和を円未満切捨て）', j.employer, 113426);
  t('仕訳の CSV の見出し', j.csv.split('\r\n')[0] === '取引日,借方勘定科目,借方金額,貸方勘定科目,貸方金額,摘要');
  const j2 = X.journalCsv([{ item: I1 }], { accounts: { bank: '未払金' } });
  t('科目を設定で替える', /未払金/.test(j2.csv) && !/普通預金/.test(j2.csv));
}
{
  const csv = X.wageLedgerCsv([{ emp_num: 'T01', name: '試験 甲', gender: 'female', period: PERIOD, item: I1 }, { emp_num: 'T02', name: '試験 乙', gender: 'male', period: PERIOD, item: I2 }]);
  const rows = csv.trimEnd().split('\r\n'), head = rows[0].split(',');
  ['氏名', '性別', '賃金計算期間', '労働日数', '労働時間数', '時間外労働時間数', '休日労働時間数', '深夜労働時間数', '総支給額', '控除合計', '差引支給額'].forEach((k) => t('台帳の列: ' + k, head.indexOf(k) >= 0));
  const r1 = rows[1].split(',');
  eq('台帳: 性別', r1[head.indexOf('性別')], '女');
  eq('台帳: 期間', r1[head.indexOf('賃金計算期間')], '2026-11-16〜2026-12-15');
  eq('台帳: 労働時間（9900分＝165:00）', r1[head.indexOf('労働時間数')], '165:00');
  eq('台帳: 時間外（5:00）', r1[head.indexOf('時間外労働時間数')], '5:00');
  eq('台帳: 基本給', r1[head.indexOf('基本給')], '220000');
  eq('台帳: 役員報酬の列（職員は0）', r1[head.indexOf('役員報酬')], '0');
  eq('台帳: 差引', r1[head.indexOf('差引支給額')], String(I1.net));
  eq('台帳: 役員の行の雇用保険料は0', rows[2].split(',')[head.indexOf('雇用保険料')], '0');
  t('台帳の行は CRLF', /\r\n$/.test(csv));
}
{
  const csv = X.payslipListCsv([{ emp_num: 'T01', name: '=試験', item: I1 }]);
  const rows = csv.trimEnd().split('\r\n');
  t('明細一覧の見出し', rows[0].startsWith('従業員番号,氏名,総支給額,課税支給額,社会保険料等,課税対象額,控除合計,差引支給額'));
  t('式として読まれない（先頭の = に \' を付ける）', rows[1].split(',')[1] === "'=試験");
  t('数のマイナスには \' を付けない', X.csvCell(-897) === '-897');
  t('文字のマイナス記号には \' を付ける', X.csvCell('-x') === "'-x");
  t('カンマを含む文字は引用', X.csvCell('a,b') === '"a,b"');
}

console.log('5. 反証レビューの直し（2026-11-19）');
{ /* 7 仕訳: 役員の非課税の精算・税の精算・マイナス */
  const B1 = item({ pay_type: 'board', board_pay: 500000, ins: {}, tax: { col: 'kou', dependents: 0 }, no_attendance: true }, null,
    { adjustments: [{ kind: 'pay_nontax', name: '立替の精算', amount: 3000 }, { kind: 'tax_adjust', name: '年調の精算', amount: -2000 }] });
  const j = X.journalCsv([{ item: B1, board: true }]);
  eq('役員報酬に非課税の精算を入れない', j.sums.board, 500000);
  eq('非課税の精算は別の科目（立替金）', j.sums.nontax, 3000);
  eq('税の精算は源泉の預り金に入る（所得税−2000）', j.sums.tax, L5(B1, 'income_tax') - 2000);
  eq('その他控除に税の精算を入れない', j.sums.other, 0);
  t('借方と貸方が合う', j.balanced, [j.debit, j.credit]);
  const B2 = item({ pay_type: 'monthly', base: 100000, ins: {}, tax: { col: 'none' } }, {}, { adjustments: [{ kind: 'tax_adjust', name: '年調の還付', amount: -10000 }] });
  const j2 = X.journalCsv([{ item: B2 }], { date: '2026-12-25' });
  t('マイナスの預り金（還付）は借方に正の額で書く', j2.csv.split('\r\n').some((r) => r === '2026-12-25,預り金,10000,,,給与 源泉所得税'), j2.csv);
  t('マイナスでも借方と貸方が合う', j2.balanced, [j2.debit, j2.credit]);
  t('マイナスの額を書かない', !/,-\d/.test(j2.csv));
}
{ /* 10 賃金台帳: 勤怠の無い人 */
  const csv = X.wageLedgerCsv([{ emp_num: 'T02', name: '試験 乙', gender: 'male', period: PERIOD, item: I2 }, { emp_num: 'T01', name: '試験 甲', gender: 'female', period: PERIOD, item: I1 }]);
  const rows = csv.trimEnd().split('\r\n'), head = rows[0].split(','), r = rows[1].split(','), r2 = rows[2].split(',');
  t('勤怠なしの人は労働日数・時間の欄が空欄', ['労働日数', '労働時間数', '時間外労働時間数', '法定内残業時間数', '休日労働時間数', '深夜労働時間数'].every((k) => r[head.indexOf(k)] === ''));
  eq('備考に「勤怠なし（固定給）」', r[head.indexOf('備考')], '勤怠なし（固定給）');
  eq('勤怠のある人の備考は空', r2[head.indexOf('備考')], '');
  eq('勤怠のある人の労働日数は数のまま', r2[head.indexOf('労働日数')], '20');
}

/* 画面向けの口（2026-11-19 結びの段）: 純関数を呼ぶだけ。口座を2つに分けた人は2件と数える */
{
  const settings = { bank_from: { consignor_code: '9000000001', consignor_kana: 'ｶ)ｼｹﾝ', bank_code: '9999', bank_kana: 'ｼｹﾝｷﾞﾝｺｳ', branch_code: '001', branch_kana: 'ﾎﾝﾃﾝ', type: '1', number: '1234567' }, zengin: { kind: '21' } };
  const L = (code, sec, amount) => ({ sec, code, name: code, qty: null, unit: null, amount, basis: '' });
  const items = [
    { staff_id: 'a', name: '架空 一', gross: 200000, deduct: 30000, net: 170000, lines: [L('basic', 'pay', 200000), L('income_tax', 'deduct', 30000)] },
    { staff_id: 'b', name: '架空 二', gross: 100000, deduct: 10000, net: 90000, lines: [L('basic', 'pay', 100000), L('income_tax', 'deduct', 10000)] },
    { staff_id: 'c', name: '架空 三', gross: 0, deduct: 0, net: 0, lines: [] },
  ];
  const acc = (no, amt) => ({ bank_code: '0001', branch_code: '002', type: '1', number: no, name_kana: 'ｶｸｳ', amount_or_rest: amt });
  const rows = [{ staff_id: 'a', net: 170000, accounts: [acc('1111111', 'rest'), acc('2222222', 50000)] }, { staff_id: 'b', net: 90000, accounts: [acc('3333333', 'rest')] }];
  const z = X.zengin({ ym: '2026-12', payDate: '2026-12-25', settings, items, rows });
  t('zengin: 口座を2つに分けた人は2件・合計は差引の和', z.ok && z.count === 3 && z.total === 260000, z);
  t('zengin: 名前は月分つき・バイト列を返す', z.name === 'payroll-zengin-2026-12.txt' && z.bytes instanceof Uint8Array && z.bytes.length === 6 * 122);
  const hdr = Buffer.from(z.bytes.slice(0, 120)).toString('latin1'), kanaB = Buffer.from(X.sjisBytes('ｼｹﾝｷﾞﾝｺｳ')).toString('latin1'), brB = Buffer.from(X.sjisBytes('ﾎﾝﾃﾝ')).toString('latin1');
  t('zengin: 振込元の銀行・支店のカナは設定の bank_kana・branch_kana から（ヘッダの決まった位置）', hdr.slice(62, 62 + kanaB.length) === kanaB && hdr.slice(80, 80 + brB.length) === brB, hdr);
  const zbad = X.zengin({ ym: '2026-12', payDate: '2026-12-25', settings, items, rows: [{ staff_id: 'a', net: 1, accounts: [acc('1111111', 'rest')] }] });
  t('zengin: 確定した差引と振込の額が違えば止める（バイト列なし）', !zbad.ok && zbad.bytes === null && zbad.errors.some((e) => /差引/.test(e.msg)));
  const j = X.journal({ ym: '2026-12', payDate: '2026-12-25', settings: {}, items, profiles: [] });
  t('journal: 借方と貸方が合う・CSV の文字', j.ok && j.balanced && /^取引日,/.test(j.text) && j.name === 'payroll-journal-2026-12.csv');
  const lg = X.ledger({ ym: '2026-12', period: { from: '2026-11-16', to: '2026-12-15' }, items, profiles: [{ staff_id: 'a', data: { freee_emp_num: 7, gender: 'F' } }] });
  t('ledger: 賃金台帳の CSV（従業員番号・性別・期間）', /^従業員番号,氏名,性別,賃金計算期間/.test(lg.text) && /7,架空 一,女,2026-11-16〜2026-12-15/.test(lg.text) && lg.name === 'payroll-ledger-2026-12.csv');
  const li = X.list({ ym: '2026-12', items, profiles: [] });
  t('list: 明細一覧の CSV は人数分の行', li.text.trim().split('\r\n').length === 4 && li.name === 'payroll-list-2026-12.csv');
}

console.log('\n' + (fail ? '✗' : '✓') + ' payroll_export ' + pass + ' 件成功／' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
