/* 給与の画面の「freee の書き出しを取り込む」の見出しの読み取りの試験（2026-11-20 新設）
   実行: node check/unit/payroll_import_test.js
   見出しの名前は freee 公式ヘルプ（従業員情報の出力の項目名・一括登録テンプレートの見出し）で確かめたもの。値はすべて架空。
   守りたいこと:
     1. 書き出しの形（姓・名・給与方式・健康保険標準報酬月額・〜に加入しているか・所得税納税者区分・所得税法上の扶養親族等の数・通勤費の金額・振込先口座1列）が読める
     2. 一括登録テンプレートの形（社員番号・給与形態・健康保険・標準報酬月額・振込先口座1：… の分かれた列）が読める。見出しの空白・全角半角のコロンの違いは同じ
     3. 前の仮置きの形（従業員番号・氏名・時給・銀行コード など）が今までどおり読める
     4. 丙欄・性別の未選択・口座1列・2つ目以降の口座は取り込まずに知らせる
     5. Shift_JIS のバイト列を読める
     6. 読めた項目の数と読めなかった主な項目は自前の名前だけ（CSV の値・口座番号をエラー文・違いの表・画面の1行に出さない） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const J = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* payroll_page_test.js と同じ作りの最小の画面（現場端末として起動＝何も読まない）に TextDecoder を足す */
const el = () => ({ hidden: true, textContent: '', value: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {} });
const els = {};
const doc = { getElementById: (id) => (els[id] = els[id] || el()), addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], body: { classList: { contains: () => false } } };
const store = { su_device_role: 'field' };
const win = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, addEventListener() {}, document: doc };
win.window = win;
vm.runInNewContext(J, Object.assign(win, { setInterval() {}, setTimeout() {}, clearTimeout() {}, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN, isFinite, parseInt, TextDecoder }));
const P = win.__payrollTest;
t('試験の口（importCols・buildImport・decode）がある', !!P && typeof P.importCols === 'function' && typeof P.buildImport === 'function' && typeof P.decode === 'function');

/* 架空の職員（今の給与の設定） */
const profs = () => [
  { staff_id: 's-1', name: '見本 一郎', data: { pay_type: 'monthly', base: 240000, freee_emp_num: 'F-1' }, versions: [], bank_last4: [] },
  { staff_id: 's-2', name: '見本 二子', data: {}, versions: [{ effective_from: '2026-10-16', rev: 1 }], bank_last4: [{ last4: '1111' }] },
  { staff_id: 's-3', name: '見本 三太', data: { tax: { col: 'kou' }, gender: 'M' }, versions: [], bank_last4: [] },
  { staff_id: 's-7', name: '見本 七', data: {}, versions: [], bank_last4: [] }
];
const build = (csv) => P.buildImport(P.parseCsv(csv), profs(), '2026-10-16');
const row = (out, sid) => out.filter((r) => r.staff_id === sid)[0];
const chs = (r) => (r ? r.changes.join('／') : '');

console.log('\n— 1. 書き出し（従業員情報の出力）の形 —');
const EXP = [
  '従業員番号,姓,名,姓カナ,名カナ,freee人事労務での表示名,給与方式,基本給,役員報酬,生年月日,入社日,退職日,性別,健康保険標準報酬月額,厚生年金保険標準報酬月額,雇用保険に加入しているか,健康保険に加入しているか,厚生年金保険に加入しているか,所得税納税者区分,所得税法上の扶養親族等の数,通勤費の金額,振込先口座',
  'F-1,見本,一郎,ミホン,イチロウ,見本一郎,月給,"245,000",,1980/04/01,2020/04/01,,男性,240000,240000,○,○,○,甲欄,1,12000,見本銀行 本店 普通 7654321',
  ',見本,二子,ミホン,フタコ,,時給,1050,,1990/1/2,,,女性,,,○,×,×,乙欄,0,,',
  ',見本,三太,ミホン,サンタ,,日給,9000,,,,,未選択,,,,,,丙欄,0,,'
].join('\r\n') + '\r\n';
const e1 = build(EXP);
const r1 = row(e1, 's-1');
t('従業員番号で s-1 に当たる・氏名は「姓」＋「名」', !!r1 && r1.name === '見本 一郎', r1 && r1.name);
t('基本給・生年月日・入社日・性別（男性）', r1.patch.base === 245000 && r1.patch.birth_date === '1980-04-01' && r1.patch.entry_date === '2020-04-01' && r1.patch.gender === 'M', r1.patch);
t('健康保険標準報酬月額・厚生年金保険標準報酬月額', r1.patch['ins.health.std'] === 240000 && r1.patch['ins.pension.std'] === 240000, r1.patch);
t('「〜に加入しているか」が ○ なら加入（雇用・健保・厚年）', r1.patch['ins.emp.on'] === true && r1.patch['ins.health.on'] === true && r1.patch['ins.pension.on'] === true, r1.patch);
t('所得税納税者区分＝甲欄・所得税法上の扶養親族等の数＝1・通勤費の金額', r1.patch['tax.col'] === 'kou' && r1.patch['tax.dependents'] === 1 && r1.patch['commute.monthly'] === 12000 && !('tax.dependents_checked' in r1.patch), r1.patch);
t('給与方式が今と同じ月給なら違いに出さない', !('pay_type' in r1.patch) && !!r1.data && r1.data.pay_type === 'monthly');
t('振込先口座の1列は推測して分けない（口座は送らず知らせる）・違いの表に口座番号を出さない', r1.bank === null && /⚠ 口座は1列の形なので取り込みません（口座の画面で入れてください）/.test(chs(r1)) && !/7654321|見本銀行/.test(chs(r1)), chs(r1));
const r2 = row(e1, 's-2');
t('従業員番号が空なら氏名（姓＋名）で当てる', !!r2);
t('時給の人で時給の列が無ければ基本給の列を時給として読む', r2.patch.pay_type === 'hourly' && r2.patch.base === 1050, r2.patch);
t('× は加入しない・乙欄・生年月日の月日が1桁でも読む・女性', r2.patch['ins.health.on'] === false && r2.patch['ins.pension.on'] === false && r2.patch['ins.emp.on'] === true && r2.patch['tax.col'] === 'otsu' && r2.patch.birth_date === '1990-01-02' && r2.patch.gender === 'F', r2.patch);
t('この月分の版がもうある人は hasNow（from を渡した時）・口座がある人は hasBank', r2.hasNow === true && r2.hasBank === true);
t('口座1列の見出しがあっても空の行は知らせない', !/口座は1列/.test(chs(r2)), chs(r2));
const r3 = row(e1, 's-3');
t('丙欄は設定しない（今の甲のまま）で知らせる', !('tax.col' in r3.patch) && /⚠ 丙欄は取り込みません/.test(chs(r3)), { patch: r3.patch, ch: chs(r3) });
t('性別の「未選択」は空と同じ（今の値を変えない）', !('gender' in r3.patch), r3.patch);
t('日給の人も基本給の列を日給として読む', r3.patch.pay_type === 'daily' && r3.patch.base === 9000, r3.patch);
t('読めた項目の数と読めなかった主な項目（書き出しの形は17項目・口座だけが読めない＝振込先口座の1列は数えない）', e1.cols && e1.cols.missing.join() === '口座' && e1.cols.found === 17, e1.cols);

console.log('\n— 2. 一括登録テンプレートの形 —');
const TPL = [
  ' 社員番号 ,姓,名,給与形態,基本給,健康保険・標準報酬月額　,厚生年金保険・標準報酬月額,雇用保険加入,健康保険加入,厚生年金保険加入,納税者区分,扶養親族等の数,通勤手当の金額・単価,振込先口座1：金融機関コード,振込先口座1:支店コード,振込先口座1：預金種類,振込先口座1 ： 口座番号,振込先口座１：口座名義（カナ）,振込先口座2：金融機関コード,振込先口座2：口座番号',
  'F-7,見本,七,日給制,9500,200000,200000,○,○,○,甲欄,2,5000,9999,001,当座預金,1234567,ﾐﾎﾝ ﾅﾅ,,',
  'F-1,見本,一郎,日給月給,240000,,,,,,,,,9999,002,貯蓄預金,7654321,ﾐﾎﾝ ｲﾁﾛｳ,9998,2222222'
].join('\n');
const e2 = build(TPL);
const r7 = row(e2, 's-7');
t('社員番号（前後の空白つき）で当たらなくても氏名で当てる・給与形態＝日給制は日給', !!r7 && r7.patch.pay_type === 'daily' && r7.patch.base === 9500 && r7.patch.freee_emp_num === 'F-7', r7 && r7.patch);
t('健康保険・標準報酬月額（後ろに全角の空白）・〜加入・納税者区分・扶養親族等の数・通勤手当の金額・単価', r7.patch['ins.health.std'] === 200000 && r7.patch['ins.pension.std'] === 200000 && r7.patch['ins.emp.on'] === true && r7.patch['tax.col'] === 'kou' && r7.patch['tax.dependents'] === 2 && r7.patch['commute.monthly'] === 5000, r7.patch);
t('振込先口座1：… の分かれた列（全角・半角のコロン・空白・全角数字の違いは同じ）・当座預金は種目2', !!r7.bank && r7.bank.bank_code === '9999' && r7.bank.branch_code === '001' && r7.bank.type === '2' && r7.bank.number === '1234567' && r7.bank.name_kana === 'ﾐﾎﾝ ﾅﾅ' && r7.bank.amount_or_rest === 'rest', r7.bank);
t('違いの表の口座は下4桁だけ・2つ目の口座の列が空なら知らせない', /口座：＊＊＊4567/.test(chs(r7)) && !/1234567/.test(chs(r7)) && !/2つ目/.test(chs(r7)), chs(r7));
const r1b = row(e2, 's-1');
t('日給月給は月給（今と同じなので違いに出さない）', !!r1b && !('pay_type' in r1b.patch) && r1b.data.pay_type === 'monthly', r1b && r1b.patch);
t('貯蓄預金は種目4・2つ目以降の口座は取り込まずに知らせる（1つ目は読む）', r1b.bank && r1b.bank.type === '4' && r1b.bank.number === '7654321' && /⚠ 2つ目以降の口座は取り込みません/.test(chs(r1b)) && !/2222222|9998/.test(chs(r1b)), chs(r1b));
t('テンプレートの形は主な項目がすべて読める', e2.cols.missing.length === 0, e2.cols);

console.log('\n— 3. 前の仮置きの形（今まで読めた形） —');
const OLD = '従業員番号,氏名,給与形態,基本給,時給,口座種別,銀行コード,支店コード,口座番号,口座名義\r\nF-1,見本 一郎,月給,245000,,普通,9999,001,7654321,ﾐﾎﾝ ｲﾁﾛｳ\r\nF-9,見本 不明,時給,,1000,,,,,\r\n,見本 二子,,,,普通,9999,001,1111111,\r\n';
const e3 = build(OLD);
const o1 = row(e3, 's-1'), o2 = row(e3, 's-2'), o9 = e3.filter((r) => r.name === '見本 不明')[0];
t('氏名の1列・基本給・口座の列（銀行コード・支店コード・口座種別・口座番号・口座名義）', o1.patch.base === 245000 && o1.bank && o1.bank.number === '7654321' && o1.bank.type === '1' && /口座：＊＊＊4321/.test(chs(o1)));
t('名簿に無い人は staff_id なし・時給の列はそのまま時給', !!o9 && o9.staff_id === null && o9.patch.base === 1000 && o9.patch.pay_type === 'hourly', o9);
t('口座名義が空なら口座を送らない', o2.bank === null && /⚠ 口座名義が無いので送りません/.test(chs(o2)));
t('甲乙・扶養の列が無い行は「未確認」', o2.patch['tax.dependents_checked'] === false);
const OLD2 = '従業員番号,氏名,給与形態,基本給,健康保険の標準報酬月額,厚生年金保険の標準報酬月額,雇用保険,健康保険,厚生年金,税額表の区分,扶養親族等の数,通勤手当\nF-3,見本 三太,月給,200000,200000,200000,加入,加入,未加入,乙,0,3000\n';
const o3 = row(build(OLD2), 's-3');
t('前の仮置きの見出し（〜の標準報酬月額・雇用保険・健康保険・厚生年金・税額表の区分・通勤手当）', !!o3 && o3.patch['ins.health.std'] === 200000 && o3.patch['ins.pension.std'] === 200000 && o3.patch['ins.emp.on'] === true && o3.patch['ins.health.on'] === true && o3.patch['ins.pension.on'] === false && o3.patch['tax.col'] === 'otsu' && o3.patch['tax.dependents'] === 0 && o3.patch['commute.monthly'] === 3000, o3 && o3.patch);

console.log('\n— 4. 見出しの対応（importCols） —');
const c1 = P.importCols(['﻿社員番号', '姓', '名']);
t('先頭の BOM は除いて比べる・姓と名で氏名あり', c1.col.emp === 0 && c1.nameOk === true);
const c2 = P.importCols(['freee人事労務での表示名', '給与方式']);
t('freee人事労務での表示名だけでも氏名あり', c2.nameOk === true && c2.col.pay_type === 1);
const c3 = P.importCols(['従業員番号', '社員番号']);
t('候補は前から順（書き出しの名前が先）', c3.col.emp === 0);
const c4 = P.importCols(['姓']);
t('姓だけでは氏名なし・読めなかった主な項目は9つの名前の中から', c4.nameOk === false && c4.missing.indexOf('氏名') >= 0 && c4.missing.every((x) => ['従業員番号', '氏名', '給与方式', '基本給', '標準報酬', '加入', '納税者区分', '扶養', '口座'].indexOf(x) >= 0), c4);
t('「表示名」だけの列で氏名を読む（姓・名が空の行）', P.buildImport(P.parseCsv('姓,名,freee人事労務での表示名\n,,見本 七\n'), profs(), null)[0].staff_id === 's-7');
let msg = '';
try { P.buildImport(P.parseCsv('9999,7654321\n9999,1234567\n'), profs(), null); } catch (e) { msg = String(e && e.message); }
t('見出しの無いファイルはエラーで止め、文に値（口座番号など）を出さない', /従業員番号/.test(msg) && !/7654321|9999/.test(msg), msg);
let msg2 = '';
try { P.buildImport(P.parseCsv('従業員番号\n'), profs(), null); } catch (e) { msg2 = String(e && e.message); }
t('見出しだけのファイルは「行がありません」', msg2 === '行がありません', msg2);

console.log('\n— 5. Shift_JIS —');
/* 「社員番号,姓,名,給与形態,基本給,納税者区分\r\nF-7,見本,七,時給制,1100,乙欄\r\n」を Shift_JIS にしたバイト列（iconv で作った） */
const SJ = new Uint8Array([142, 208, 136, 245, 148, 212, 141, 134, 44, 144, 169, 44, 150, 188, 44, 139, 139, 151, 94, 140, 96, 145, 212, 44, 138, 238, 150, 123, 139, 139, 44, 148, 91, 144, 197, 142, 210, 139, 230, 149, 170, 13, 10, 70, 45, 55, 44, 140, 169, 150, 123, 44, 142, 181, 44, 142, 158, 139, 139, 144, 167, 44, 49, 49, 48, 48, 44, 137, 179, 151, 147, 13, 10]);
const sj = P.decode(SJ);
t('UTF-8 で読めなければ Shift_JIS で読む', /^社員番号,姓,名,給与形態/.test(sj), sj.slice(0, 20));
const s7 = row(P.buildImport(P.parseCsv(sj), profs(), null), 's-7');
t('Shift_JIS の CSV から 時給制・基本給・乙欄 を読む', !!s7 && s7.patch.pay_type === 'hourly' && s7.patch.base === 1100 && s7.patch['tax.col'] === 'otsu', s7 && s7.patch);
t('UTF-8 の BOM は除く', P.decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0xE5, 0xA7, 0x93])) === '姓');

console.log('\n— 6. 画面と値の扱い —');
t('取り込みの画面の上に「読めた項目の数」と「読めなかった主な項目」の1行（自前の名前だけ）', /見出しから読めた項目：' \+ esc\(ic\.found\) \+ '個' \+ \(ic\.missing\.length \? '（読めなかった主な項目：' \+ esc\(ic\.missing\.join\('・'\)\)/.test(J));
t('読めた数は importRows に載せて一緒に捨てる（新しい変数を作らない）', /out\.cols = \{ found: cm\.found, missing: cm\.missing \};/.test(J) && /ic = importRows\.cols;/.test(J));
t('画面からは今の職員と月分の始まりを渡す', /buildImport\(parseCsv\(decode\(buf\)\), bs \? bs\.profiles : \[\], p1 \? p1\.from : null\)/.test(J));
t('console に出さない', !/console\./.test(J));
t('payroll.html の payroll.js の版を上げた（この直しの前の 2026-11-19 ではない）', /<script src="payroll\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'payroll.html'), 'utf8')) && !/payroll\.js\?v=2026-11-19"/.test(fs.readFileSync(path.join(ROOT, 'payroll.html'), 'utf8')));

console.log('\n— 7. 反証レビュー（2026-11-20）の直し —');
/* 1. 当て方: 番号が先・氏名で当たった人の番号が違えば当てない・同じ職員に2行は全部送らない */
const m1 = build('従業員番号,氏名,給与形態,基本給\nF-1,見本 七,月給,250000\n');
t('従業員番号の一致する職員（s-1）と氏名の一致する職員（s-7）が別人の行は番号が先', m1[0].staff_id === 's-1', m1[0].staff_id);
const m2 = build('従業員番号,氏名,給与形態,基本給\nF-1,見本 一郎,月給,245000\nF-99,見本 一郎,時給,1200\n');
t('同名の2行（F-1 と F-99）: 2行目は番号が違うので s-1 に当てない', m2[0].staff_id === 's-1' && m2[1].staff_id === null && /⚠ 従業員番号が違うので当てません/.test(chs(m2[1])), m2.map((r) => [r.staff_id, chs(r)]));
t('同名の2行: 1行目はそのまま送れる（番号・給与形態・基本給を上書きされない）', !!m2[0].data && m2[0].data.base === 245000 && m2[0].data.freee_emp_num === 'F-1' && !/2行当たった/.test(chs(m2[0])));
const m3 = build('氏名,給与形態,基本給,口座種別,銀行コード,支店コード,口座番号,口座名義\n見本 七,月給,200000,普通,9999,001,1234567,ﾐﾎﾝ ﾅﾅ\n見本　七,時給,1000,,,,,\n');
t('同じ職員に2行当たったら、その全部の行を送らない（設定も口座も）', m3.length === 2 && m3.every((r) => r.staff_id === 's-7' && r.data === null && r.bank === null && /⚠ 同じ職員に2行当たったので送りません/.test(chs(r))), m3.map((r) => [r.staff_id, !!r.data, !!r.bank, chs(r)]));
t('番号の無い職員は CSV の番号に関わらず氏名で当てる（今のとおり）', build('従業員番号,氏名\nF-7,見本 七\n')[0].staff_id === 's-7');
const twins = [{ staff_id: 's-a', name: '見本 双', data: {}, versions: [], bank_last4: [] }, { staff_id: 's-b', name: '見本　双', data: {}, versions: [], bank_last4: [] }];
t('同名の職員が2人いればどちらにも当てない', P.buildImport(P.parseCsv('氏名,給与形態\n見本 双,月給\n'), twins, null)[0].staff_id === null);
const m4 = build('氏名,姓,名,給与形態\n見本 七,見本,一郎,月給\n');
t('「氏名」と「姓＋名」の中身が違えば「氏名」が先', m4[0].staff_id === 's-7' && m4[0].name === '見本 七', m4[0].name);
const m5 = build('従業員番号,氏名,振込先口座,振込先口座1：金融機関コード,振込先口座1：支店コード,振込先口座1：預金種類,振込先口座1：口座番号,振込先口座1：口座名義（カナ）\nF-1,見本 一郎,見本銀行 本店 普通 7654321,9999,001,普通預金,7654321,ﾐﾎﾝ ｲﾁﾛｳ\n');
t('分かれた口座の列と「振込先口座」1列が両方ある時は分かれた列を使い、1列の知らせは出さない', !!m5[0].bank && m5[0].bank.number === '7654321' && m5[0].bank.type === '1' && !/1列の形/.test(chs(m5[0])) && !/7654321|見本銀行/.test(chs(m5[0])), chs(m5[0]));
/* 2. 預金種類が分からない */
const b1 = build('従業員番号,氏名,口座種別,銀行コード,支店コード,口座番号,口座名義\nF-1,見本 一郎,外貨預金,9999,001,7654321,ﾐﾎﾝ ｲﾁﾛｳ\n');
t('預金種類の値が分からなければ口座を送らない（黙って普通にしない）', b1[0].bank === null && /⚠ 預金種類が分からないので送りません/.test(chs(b1[0])) && !/7654321/.test(chs(b1[0])), chs(b1[0]));
const b2 = build('従業員番号,氏名,口座種別,銀行コード,支店コード,口座番号,口座名義\nF-1,見本 一郎,,9999,001,7654321,ﾐﾎﾝ ｲﾁﾛｳ\n');
const b3 = build('従業員番号,氏名,銀行コード,支店コード,口座番号,口座名義\nF-1,見本 一郎,9999,001,7654321,ﾐﾎﾝ ｲﾁﾛｳ\n');
t('預金種類が空・列が無い時は今のとおり普通（1）', !!b2[0].bank && b2[0].bank.type === '1' && !!b3[0].bank && b3[0].bank.type === '1');
/* 3. 納税者区分が読めない */
const x1 = build('従業員番号,氏名,納税者区分,扶養親族等の数\nF-1,見本 一郎,乙種,1\n');
t('納税者区分が甲・乙・丙のどれでもなければ知らせ、甲乙・扶養は「未確認」（区分は変えない）', /⚠ 納税者区分が読めません/.test(chs(x1[0])) && x1[0].patch['tax.dependents_checked'] === false && !('tax.col' in x1[0].patch) && (chs(x1[0]).match(/甲乙・扶養の確かめ/g) || []).length === 1, { patch: x1[0].patch, ch: chs(x1[0]) });
const x2 = build('従業員番号,氏名,納税者区分\nF-1,見本 一郎,不明\n');
t('読めない納税者区分で扶養の数が空でも「未確認」は1回だけ', x2[0].patch['tax.dependents_checked'] === false && (chs(x2[0]).match(/甲乙・扶養の確かめ/g) || []).length === 1 && /納税者区分が読めません/.test(chs(x2[0])), chs(x2[0]));
const x3 = build('従業員番号,氏名,納税者区分,扶養親族等の数\nF-1,見本 一郎,丙欄,0\n');
t('丙欄は「読めません」とは言わない（丙欄の知らせだけ）', /丙欄は取り込みません/.test(chs(x3[0])) && !/読めません/.test(chs(x3[0])));
const x4 = build('従業員番号,氏名,納税者区分,扶養親族等の数\nF-1,見本 一郎,甲欄,0\n');
t('甲欄・扶養の数が読めた行は「未確認」にしない（今のとおり）', !('tax.dependents_checked' in x4[0].patch) && x4[0].patch['tax.col'] === 'kou');

/* 統合 0107（2026-11-20）: 名前は勤怠の表示名・照合はシフトの名前（shift_name）でも当てる */
{
  const ps = [{ staff_id: 's-9', name: '見本 九', shift_name: '予定 見本 九', data: {}, versions: [], bank_last4: [] },
              { staff_id: 's-8', name: '見本 八', shift_name: '', data: {}, versions: [], bank_last4: [] }];
  const b9 = (nm) => P.buildImport(P.parseCsv('氏名,時給\n' + nm + ',1100\n'), ps, '2026-10-16')[0];
  t('表示名で当たる', b9('見本 九').staff_id === 's-9');
  t('シフトの名前（表示名を付ける前の名前）でも当たる', b9('予定 見本 九').staff_id === 's-9');
  t('シフトの名前が空の人は空の氏名に当てない', !b9('').staff_id);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
