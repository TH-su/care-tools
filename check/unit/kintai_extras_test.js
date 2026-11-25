/* 勤怠の「日ごとの補助項目」の純関数（kintai-extras.js）と画面の組み込み（kintai.js・kintai.html）の試験（2026-11-25 新設・凍結仕様 ROOT-v7-plus-parity.md「段A1」）
   実行: node check/unit/kintai_extras_test.js
   守りたいこと:
     1. 掃除（cleanExtraItems）: コードの形・重なり・名前・形・単位・小数の桁・20個まで。初期値は勤怠管理Plus の7つ（2026-11-25 チーフの追加）
     2. 値の確かめ（parseValue）: DB の badvalue と同じ線（qty 0〜99999.99・小数は設定の桁まで・時間は 1〜1440 分）
     3. 合計（sumExtras）: 職員×項目と職員×日。取り消した行・定義に無い code・形に合わない行は数えない。小数の足し算の誤差を出さない
     4. 表示（fmtValue・label・colHead）: 時間は CSV の時間の書き方（8:30／8.50）にそろえる
     5. CSV の末尾（appendCsv）: 今の列は1バイトも変えず末尾にだけ足す・項目が無い時は文がそのまま・引用符の中の改行とカンマで行を取り違えない・
        行の無い人や日は足さずに数を返す。本物の buildCsv の出力に当てて確かめる
     6. 画面の組み込み: kintai.html が kintai-extras.js を kintai.js の前に読む・呼ぶ3つの関数と引数の名前・関数が無い時は欄を出さない・
        締めた月分は入れる欄を出さない・直しの履歴の名前
   ★架空データだけ（職員は sX… の番号と従業員コード 9xxx）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const C = require(path.join(ROOT, 'kintai-calc.js'));
const EX = require(path.join(ROOT, 'kintai-extras.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

console.log('\n— 1. 掃除と初期値 —');
t('初期値は7つ（dist・sunday・sunday_time・newyear・checkup・checkup_nocommute・meeting）',
  JSON.stringify(EX.EXTRA_ITEMS_DEFAULT.map((x) => [x.code, x.name, x.kind])) === JSON.stringify([['dist', '移動距離', 'number'], ['sunday', '日曜出勤', 'count'], ['sunday_time', '日曜出勤（時間）', 'time'], ['newyear', '年末年始出勤', 'count'], ['checkup', '健診/有休', 'count'], ['checkup_nocommute', '健診通勤手当なし', 'count'], ['meeting', '社内会議', 'time']]));
t('移動距離は km・小数1桁', EX.EXTRA_ITEMS_DEFAULT[0].unit === 'km' && EX.EXTRA_ITEMS_DEFAULT[0].decimals === 1);
t('初期値は掃除しても同じ（そのまま保存できる形）', JSON.stringify(EX.cleanExtraItems(EX.EXTRA_ITEMS_DEFAULT).items) === JSON.stringify(EX.EXTRA_ITEMS_DEFAULT) && EX.cleanExtraItems(EX.EXTRA_ITEMS_DEFAULT).bad.length === 0);
const cp = EX.copyDefault(); cp[0].name = 'x';
t('copyDefault は写し（元の初期値を変えない）', EX.EXTRA_ITEMS_DEFAULT[0].name === '移動距離');
/* DB（統合 0127）と同じ決まり: オブジェクト・code の形・kind・decimals（無い＝0 か 0/1/2）・active（無い＝使う か真偽）。違う要素は読み飛ばす・同じ code は先勝ち・先頭20個 */
const cl = EX.cleanExtraItems([
  { code: 'ok1', name: '回数', kind: 'count' },
  { code: 'bad code', name: 'x', kind: 'count' },
  { code: 'ok1', name: '重なり', kind: 'number' },
  { code: 'n2', kind: 'time' },
  { code: 'k4', name: '形違い', kind: 'yen' },
  { code: 'd6', name: '桁', kind: 'number', unit: 'km', decimals: 3 },
  { code: 'd7', name: '桁の文字', kind: 'number', decimals: '1' },
  { code: 'a8', name: '印の文字', kind: 'count', active: 'false' },
  { code: 'num', name: ' 距離 ', kind: 'number', unit: ' km ', decimals: 2, active: false },
  null,
  ['code'],
  { code: 'num', name: '後の同じ code', kind: 'number', active: true },
]);
t('通った要素だけ残る（name・unit は見ないで切るだけ・decimals 無し＝0・active 無し＝使う・false は止める）', JSON.stringify(cl.items) === JSON.stringify([
  { code: 'ok1', name: '回数', kind: 'count', unit: '', decimals: 0, active: true },
  { code: 'n2', name: '', kind: 'time', unit: '', decimals: 0, active: true },
  { code: 'num', name: '距離', kind: 'number', unit: 'km', decimals: 2, active: false }]), cl.items);
t('読み飛ばした要素は行の番号と理由（同じ code は先勝ち＝先が止めた項目でも後は dup）', JSON.stringify(cl.bad) === JSON.stringify([{ row: 2, why: 'code' }, { row: 3, why: 'dup' }, { row: 5, why: 'kind' }, { row: 6, why: 'decimals' }, { row: 7, why: 'decimals' }, { row: 8, why: 'active' }, { row: 10, why: 'shape' }, { row: 11, why: 'shape' }, { row: 12, why: 'dup' }]), cl.bad);
t('名前の無い項目は code で出す（nameOf・label・colHead）', EX.nameOf(cl.items[1]) === 'n2' && EX.label(cl.items[1], 30) === 'n2 0:30' && EX.colHead(cl.items[1]) === 'n2（時間）');
const many = [{ code: 'x', kind: 'bad' }].concat(Array.from({ length: 21 }, (_, i) => ({ code: 'c' + i, name: '項目' + i, kind: 'count' })));
const cm = EX.cleanExtraItems(many);
t('通った要素の先頭20個まで（読み飛ばした要素は数えない・21個目は max）', cm.items.length === 20 && cm.items[0].code === 'c0' && cm.items[19].code === 'c19' && cm.bad.length === 2 && cm.bad[1].why === 'max' && cm.bad[1].row === 22, cm.bad);
t('checkForm（画面だけの決まり）: 名前は1〜20字・単位は10字まで', JSON.stringify(EX.checkForm([{ name: 'A' }, { name: '' }, { name: 'あ'.repeat(21) }, { name: 'B', unit: 'x'.repeat(11) }])) === JSON.stringify([{ row: 2, why: 'name' }, { row: 3, why: 'name' }, { row: 4, why: 'unit' }]));
t('配列でない時は空', EX.cleanExtraItems(null).items.length === 0 && EX.cleanExtraItems({}).items.length === 0);
t('itemsOf: 鍵が無い時は null（初期値の案を出す）・ある時は掃除した配列', EX.itemsOf({}) === null && EX.itemsOf(null) === null && EX.itemsOf({ extraItems: [] }).length === 0 && EX.itemsOf({ extraItems: [{ code: 'a', name: 'A', kind: 'time' }] })[0].kind === 'time');
t('activeItems: 止めた項目は入れない', JSON.stringify(EX.activeItems({ extraItems: [{ code: 'a', name: 'A', kind: 'count' }, { code: 'b', name: 'B', kind: 'count', active: false }] }).map((x) => x.code)) === '["a"]');

console.log('\n— 2. 値の確かめ —');
const IT = { cnt: { code: 'c', name: '健診', kind: 'count', unit: '', decimals: 0, active: true }, km: { code: 'd', name: '移動距離', kind: 'number', unit: 'km', decimals: 1, active: true }, tm: { code: 'm', name: '社内会議', kind: 'time', unit: '', decimals: 0, active: true } };
const pv = (it, v) => EX.parseValue(it, v);
t('回数: 1 は qty 1・minutes null', JSON.stringify(pv(IT.cnt, '1')) === JSON.stringify({ ok: true, qty: 1, minutes: null }));
t('回数: 0 は受ける（DB も 0〜）', pv(IT.cnt, '0').ok === true);
t('回数: 小数は decimals', pv(IT.cnt, '1.5').why === 'decimals' && pv(IT.cnt, '2.0').ok === true);
t('回数: 0〜99999 の整数（99999 は通る・100000 は range）・数値は 99999.99 まで', pv(IT.cnt, '99999').ok && pv(IT.cnt, '100000').why === 'range' && pv(IT.km, '99999.9').ok);
t('数値: 小数1桁まで（12.3 は通る・12.34 は decimals）', pv(IT.km, '12.3').qty === 12.3 && pv(IT.km, '12.34').why === 'decimals');
t('数値: 負は neg・上限 99999.99 を超えると range・空は empty・文字は range', pv(IT.km, '-1').why === 'neg' && pv(IT.km, '100000').why === 'range' && pv(IT.km, '').why === 'empty' && pv(IT.km, '1e3').why === 'range' && pv(IT.km, 'abc').why === 'range');
t('時間: 90 分は minutes 90・qty null', JSON.stringify(pv(IT.tm, 90)) === JSON.stringify({ ok: true, qty: null, minutes: 90 }));
t('時間: 0 分と 1441 分は range・1440 は通る・小数は int', pv(IT.tm, 0).why === 'range' && pv(IT.tm, 1441).why === 'range' && pv(IT.tm, 1440).ok && pv(IT.tm, '1.5').why === 'int');
t('minutesOf: 1時間30分＝90・空は null・分が 60 以上や文字は NaN', EX.minutesOf('1', '30') === 90 && EX.minutesOf('', '') === null && EX.minutesOf('', '45') === 45 && isNaN(EX.minutesOf('1', '60')) && isNaN(EX.minutesOf('a', '')));

console.log('\n— 3. 合計 —');
const ITEMS = [IT.cnt, IT.km, IT.tm, { code: 'off', name: '止めた', kind: 'count', unit: '', decimals: 0, active: false }];
const rows = [
  { id: '1', staff_id: 'sX1', date: '2025-12-01', code: 'd', qty: 12.3, minutes: null },
  { id: '2', staff_id: 'sX1', date: '2025-12-02', code: 'd', qty: '4.1', minutes: null },
  { id: '3', staff_id: 'sX1', date: '2025-12-02', code: 'm', qty: null, minutes: 90 },
  { id: '4', staff_id: 'sX1', date: '2025-12-03', code: 'm', qty: null, minutes: 45 },
  { id: '5', staff_id: 'sX2', date: '2025-12-01', code: 'c', qty: 1, minutes: null },
  { id: '6', staff_id: 'sX2', date: '2025-12-01', code: 'c', qty: 1, minutes: null, voided_at: '2025-12-02T00:00:00Z' },   /* 取り消した行 */
  { id: '7', staff_id: 'sX2', date: '2025-12-01', code: 'zz', qty: 3, minutes: null },                                   /* 定義に無い */
  { id: '8', staff_id: 'sX2', date: '2025-12-01', code: 'm', qty: 2, minutes: null },                                    /* 時間なのに minutes が無い（形を変えた前の行） */
  { id: '9', staff_id: 'sX2', date: '2025-12-04', code: 'off', qty: 2, minutes: null },
  null,
];
const S = EX.sumExtras(rows, ITEMS);
t('職員×項目: 12.3＋4.1＝16.4（誤差なし）・90＋45＝135 分', S.byStaff.sX1.d === 16.4 && S.byStaff.sX1.m === 135, S.byStaff.sX1);
t('取り消した行・定義に無い code・形に合わない行は数えない（sX2 の健診は 1）', S.byStaff.sX2.c === 1 && !('zz' in S.byStaff.sX2) && !('m' in S.byStaff.sX2), S.byStaff.sX2);
t('止めた項目も定義にあれば合計は持つ（CSV の列にするかは呼ぶ側が決める）', S.byStaff.sX2.off === 2);
t('職員×日', S.byDay['sX1|2025-12-02'].d === 4.1 && S.byDay['sX1|2025-12-02'].m === 90 && S.byDay['sX2|2025-12-01'].c === 1);
t('数えた行の数は 6', S.rows === 6, S.rows);
t('行が配列でない・定義が空でも落ちない', EX.sumExtras(null, ITEMS).rows === 0 && EX.sumExtras(rows, []).rows === 0);
let acc = 0; for (let i = 0; i < 10; i++) acc += 0.1;
const tenth = EX.sumExtras(Array.from({ length: 10 }, (_, i) => ({ staff_id: 's', date: '2025-12-0' + (i % 9 + 1), code: 'd', qty: 0.1 })), [IT.km]);
t('0.1 を10回足すと 1（素の足し算は ' + acc + '）', tenth.byStaff.s.d === 1);

t('CSV の列にする項目（csvItems）: 使う項目と、止めた項目でも行がある項目（取り消した行は数えない）',
  JSON.stringify(EX.csvItems(ITEMS, rows).map((x) => x.code)) === '["c","d","m","off"]' && JSON.stringify(EX.csvItems(ITEMS, [{ code: 'off', voided_at: 'x' }]).map((x) => x.code)) === '["c","d","m"]');

/* 反証レビュー（2026-11-25）の1: code・staff_id が constructor・toString・__proto__ でも継承の値と取り違えない（DB は受ける） */
const proto = EX.cleanExtraItems([{ code: 'constructor', name: 'A', kind: 'count' }, { code: '__proto__', name: 'B', kind: 'count' }, { code: 'toString', name: 'C', kind: 'time' }, { code: 'constructor', name: '重なり', kind: 'count' }]);
t('掃除: constructor・__proto__・toString の code も通る（同じ code の2つ目は dup）', JSON.stringify(proto.items.map((x) => x.code)) === '["constructor","__proto__","toString"]' && proto.bad.length === 1 && proto.bad[0].why === 'dup', [proto.items, proto.bad]);
t('掃除: kind が hasOwnProperty などの名前でも通さない', EX.cleanExtraItems([{ code: 'a', kind: 'hasOwnProperty' }, { code: 'b', kind: 'constructor' }, { code: 'c', kind: '__proto__' }]).items.length === 0);
const pS = EX.sumExtras([{ staff_id: 'constructor', date: '2025-12-01', code: 'constructor', qty: 2 }, { staff_id: '__proto__', date: '2025-12-01', code: '__proto__', qty: 3 }, { staff_id: 'toString', date: '2025-12-02', code: 'toString', minutes: 30 }, { staff_id: 'x', date: '2025-12-01', code: 'hasOwnProperty', qty: 9 }], proto.items);
t('合計: 鍵が constructor・__proto__・toString でも数える・定義に無い hasOwnProperty は数えない', pS.byStaff.constructor.constructor === 2 && pS.byStaff['__proto__']['__proto__'] === 3 && pS.byStaff.toString.toString === 30 && pS.rows === 3 && !Object.keys(pS.byStaff).includes('x'), pS.rows);
const pC = EX.splitCsv(EX.appendCsv('h\r\nE1\r\n', 'sum', { people: [{ staff_id: 'constructor', emp_code: 'E1' }], items: proto.items, sums: pS, mode: 'hmm' }).text);
t('CSV: 鍵が constructor でも値を取り違えない（2・0・0:00）', JSON.stringify(pC[1].cells.slice(1)) === '["2","0","0:00"]', pC[1].cells);
const pD = EX.appendCsv('h\r\nE9\r\n', 'sum', { people: [{ staff_id: 'y', emp_code: 'E9' }], items: [{ code: 'constructor', name: 'A', kind: 'count', active: true }], sums: EX.sumExtras([], []), mode: 'hmm' });
t('CSV: 合計が無い人の constructor の列は 0（継承の関数を出さない）', EX.splitCsv(pD.text)[1].cells[1] === '0', pD.text);
/* 反証レビュー（2026-11-25）の2: 形を変えた項目の前の形の行は数えずに mismatch で知らせる */
const mmS = EX.sumExtras([{ staff_id: 's', date: '2025-12-01', code: 'm', qty: 2, minutes: null }, { staff_id: 's', date: '2025-12-02', code: 'm', qty: 1 }, { staff_id: 's', date: '2025-12-02', code: 'd', qty: null, minutes: 30 }, { staff_id: 's', date: '2025-12-03', code: 'm', minutes: 60 }], [IT.tm, IT.km]);
t('形が合わない行は数えず mismatch に件数（社内会議 2・移動距離 1）', mmS.byStaff.s.m === 60 && !('d' in mmS.byStaff.s) && mmS.mismatch.m === 2 && mmS.mismatch.d === 1, mmS.mismatch);
t('mismatchText: 名前と件数で知らせる・無い時は空', /社内会議 2 件・移動距離 1 件/.test(EX.mismatchText(mmS.mismatch, [IT.tm, IT.km])) && EX.mismatchText(tenth.mismatch, [IT.km]) === '' && EX.mismatchText({}, []) === '');
t('前の rows の「時間なのに qty だけ」の行（id 8）も mismatch に入る', S.mismatch.m === 1, S.mismatch);

console.log('\n— 4. 表示 —');
t('数値は設定の桁（16.4 km）・回数は整数（1 回）・時間は 8:30', EX.label(IT.km, 16.4) === '移動距離 16.4 km' && EX.label(IT.cnt, 1) === '健診 1 回' && EX.label(IT.tm, 510) === '社内会議 8:30');
t('CSV の書き方: 時間は hmm＝2:15・dec＝2.25（kintai-calc の fmtMin と同じ）', EX.fmtValue(IT.tm, 135, 'hmm') === C.fmtMin(135, 'hmm') && EX.fmtValue(IT.tm, 135, 'dec') === C.fmtMin(135, 'dec') && EX.fmtValue(IT.tm, 135, 'dec') === '2.25');
t('数値の 0 は 0.0・回数の 0 は 0', EX.fmtValue(IT.km, 0, 'hmm') === '0.0' && EX.fmtValue(IT.cnt, 0, 'hmm') === '0');
t('桁を後から減らしても丸めない（整数の設定でも 12.3 は 12.3・12.30 は 12.3・回数に 12.3 が来ても 12.3）', EX.fmtValue(Object.assign({}, IT.km, { decimals: 0 }), 12.3, 'hmm') === '12.3' && EX.fmtValue(IT.km, 12.30, 'hmm') === '12.3' && EX.fmtValue(IT.cnt, 12.3, 'hmm') === '12.3' && EX.fmtValue(Object.assign({}, IT.km, { decimals: 2 }), 5, 'hmm') === '5.00' && EX.fmtValue(IT.km, 0.05, 'hmm') === '0.05');
t('見出し: 名前が「…（時間）」の時間の項目は重ねない（日曜出勤（時間））', EX.colHead({ name: '日曜出勤（時間）', kind: 'time' }) === '日曜出勤（時間）');
t('見出し: 移動距離（km）・健診（回）・社内会議（時間）・単位の無い数値は名前だけ', EX.colHead(IT.km) === '移動距離（km）' && EX.colHead(IT.cnt) === '健診（回）' && EX.colHead(IT.tm) === '社内会議（時間）' && EX.colHead({ name: '点', kind: 'number', unit: '' }) === '点');

console.log('\n— 5. CSV の末尾 —');
const sp = EX.splitCsv('a,b\r\n9001,"x, ""y""\r\nz",3\r\n9002,,\r\n');
t('splitCsv: 引用符の中の改行・カンマ・"" を欄の中に読む', sp.length === 3 && sp[1].cells[0] === '9001' && sp[1].cells[1] === 'x, "y"\r\nz' && sp[1].cells[2] === '3' && sp[2].cells.length === 3, sp.map((r) => r.cells));
t('splitCsv: raw は行の文そのまま（改行なし）', sp[1].raw === '9001,"x, ""y""\r\nz",3');
/* 本物の computeMonth と buildCsv（架空の3人・12月分）に当てる */
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
const staff = [
  { staff_id: 'sX1', name: '試験 甲', code: '0001', office: 'facility', emp_code: '9001', active: true },
  { staff_id: 'sX2', name: '試験 乙', code: '0002', office: 'visit', emp_code: '9002', active: true },
  { staff_id: 'sX3', name: '試験 丙', code: '0003', office: 'day', emp_code: '9003', active: true },
];
const schedule = [], punches = [];
let pid = 0;
['2025-12-01', '2025-12-02', '2025-12-03'].forEach((d) => {
  ['sX1', 'sX2'].forEach((sid) => {
    schedule.push({ staff_id: sid, work_date: d, seq: 1, office: sid === 'sX1' ? 'facility' : 'visit', start_at: iso(d, '09:00'), end_at: iso(d, '18:00'), break_min: 60, kind: 'work', symbol: '日', paid_min: 0 });
    punches.push({ id: 'p' + (++pid), staff_id: sid, kind: 'in', at: iso(d, sid === 'sX1' && d === '2025-12-02' ? '08:30' : '09:00'), source: 'tablet' }, { id: 'p' + (++pid), staff_id: sid, kind: 'out', at: iso(d, '18:00'), source: 'tablet' });
  });
});
/* 12/2 の甲は 8:30 出勤（早出）。認めない理由にカンマ・改行・引用符を入れる（日ごとの明細の「数えなかった理由」が引用符で囲まれた欄になる） */
const days = [{ staff_id: 'sX1', work_date: '2025-12-02', early_ng: '理由, "引用"\n改行', rev: 1 }];
const mon = C.computeMonth({ ym: '2025-12', period: { from: '2025-12-01', to: '2025-12-31' }, staff, schedule, punches, days, config: { csvTime: 'hmm' }, now: Date.parse('2026-01-14T09:00:00+09:00') });
const res = C.buildCsv(mon, { extraCols: true });
const people = mon.people.map((p) => ({ staff_id: p.staff.staff_id, emp_code: p.staff.emp_code }));
const ACT = [IT.km, IT.cnt, IT.tm];
const xrows = [
  { staff_id: 'sX1', date: '2025-12-01', code: 'd', qty: 12.3 }, { staff_id: 'sX1', date: '2025-12-02', code: 'd', qty: 4.1 }, { staff_id: 'sX1', date: '2025-12-02', code: 'm', minutes: 90 },
  { staff_id: 'sX2', date: '2025-12-03', code: 'c', qty: 1 },
  { staff_id: 'sX2', date: '2025-12-20', code: 'c', qty: 1 },    /* 勤務の無い日（日ごとの明細に行が無い） */
  { staff_id: 'sX3', date: '2025-12-05', code: 'c', qty: 1 },    /* 勤務の無い人（月の集計に行が無い） */
];
const sums = EX.sumExtras(xrows, ACT);
const sum = EX.appendCsv(res.summary, 'sum', { people, items: ACT, sums, mode: 'hmm' });
const dly = EX.appendCsv(res.daily, 'day', { people, items: ACT, sums, mode: 'hmm' });
const so = EX.splitCsv(res.summary), sn = EX.splitCsv(sum.text), dn0 = EX.splitCsv(res.daily), dn = EX.splitCsv(dly.text);
t('月の集計: 行の数は同じ・各行は今の行＋末尾の3列（今の列は1バイトも変えない）', so.length === sn.length && sn.every((r, i) => r.raw.indexOf(so[i].raw + ',') === 0 && r.cells.length === so[i].cells.length + 3), [so.length, sn.length]);
t('月の集計: 見出しの末尾は 移動距離（km）・健診（回）・社内会議（時間）', JSON.stringify(sn[0].cells.slice(-3)) === JSON.stringify(['移動距離（km）', '健診（回）', '社内会議（時間）']));
t('月の集計の見出しの先頭は今のまま（SUMMARY_HEAD から）', JSON.stringify(sn[0].cells.slice(0, C.SUMMARY_HEAD.length)) === JSON.stringify(C.SUMMARY_HEAD));
const r9001 = sn.find((r) => r.cells[0] === '9001'), r9002 = sn.find((r) => r.cells[0] === '9002');
t('9001: 16.4・0・1:30／9002: 0.0・2・0:00（合計の無い項目は 0・月の合計は日ごとの明細に行の無い日の分も入る）', JSON.stringify(r9001.cells.slice(-3)) === '["16.4","0","1:30"]' && JSON.stringify(r9002.cells.slice(-3)) === '["0.0","2","0:00"]', [r9001.cells.slice(-3), r9002.cells.slice(-3)]);
t('月の集計に行の無い人（勤務の無い 9003）は行を足さず dropped 1', !sn.some((r) => r.cells[0] === '9003') && sum.dropped === 1, sum.dropped);
t('日ごと: 行の数は同じ・各行は今の行＋末尾の3列', dn0.length === dn.length && dn.every((r, i) => r.raw.indexOf(dn0[i].raw + ',') === 0 && r.cells.length === dn0[i].cells.length + 3));
const d2 = dn.find((r) => r.cells[0] === '9001' && r.cells[1] === '2025-12-02'), d1b = dn.find((r) => r.cells[0] === '9002' && r.cells[1] === '2025-12-01'), d3b = dn.find((r) => r.cells[0] === '9002' && r.cells[1] === '2025-12-03');
t('日ごと: 9001 の 12/2 は 4.1・空・1:30（値の無い項目は空）', d2 && JSON.stringify(d2.cells.slice(-3)) === '["4.1","","1:30"]', d2 && d2.cells.slice(-3));
t('日ごと: 引用符・カンマ・改行の入った理由の行も取り違えない（9001 の 12/2 の「数えなかった理由」がそのまま・その後ろに3列）', !!d2 && d2.cells[d2.cells.length - 4] === '早出：' + days[0].early_ng && /"/.test(d2.raw), d2 && d2.cells);
t('日ごと: 値の無い日は3つとも空・9002 の 12/3 は健診 1', d1b && JSON.stringify(d1b.cells.slice(-3)) === '["","",""]' && d3b && JSON.stringify(d3b.cells.slice(-3)) === '["","1",""]');
t('日ごと: 行の無い日（9002 の 12/20・9003 の 12/5）は足さず dropped 2', dly.dropped === 2 && !dn.some((r) => r.cells[1] === '2025-12-20'), dly.dropped);
t('CRLF で終わる（今の CSV と同じ）', /\r\n$/.test(sum.text) && /\r\n$/.test(dly.text) && !/\r\n\r\n$/.test(sum.text));
t('使う項目が無い時は文がそのまま（同じ文字列）', EX.appendCsv(res.summary, 'sum', { people, items: [], sums, mode: 'hmm' }).text === res.summary && EX.appendCsv(res.daily, 'day', { people, items: [], sums }).text === res.daily);
const dec = EX.appendCsv(res.summary, 'sum', { people, items: [IT.tm], sums, mode: 'dec' });
t('時間の書き方が 8.50 の時は 1.50', EX.splitCsv(dec.text).find((r) => r.cells[0] === '9001').cells.slice(-1)[0] === '1.50');
const evil = [{ code: 'e', name: '=1+2,"x"', kind: 'count', unit: '', decimals: 0 }];
const ev = EX.splitCsv(EX.appendCsv(res.summary, 'sum', { people, items: evil, sums: { byStaff: {}, byDay: {} } }).text)[0].cells.slice(-1)[0];
t('項目の名前が式やカンマでも、見出しは csvCell と同じ守り（先頭に \' ・引用符で囲む）', ev === "'=1+2,\"x\"（回）", ev);
/* 反証レビュー（2026-11-25）M2: 同じ従業員コードの人が2人以上いる時は、どの人の行か決められないので付けない（欄は空）・dup で知らせる */
const twin = [{ staff_id: 'a', emp_code: '1', name: '試験 甲' }, { staff_id: 'b', emp_code: '1', name: '試験 乙' }, { staff_id: 'c', emp_code: '2', name: '試験 丙' }];
const twR = EX.appendCsv('h\r\n1\r\n1\r\n2\r\n', 'sum', { people: twin, items: [IT.cnt], sums: EX.sumExtras([{ staff_id: 'a', date: '2025-12-01', code: 'c', qty: 1 }, { staff_id: 'b', date: '2025-12-01', code: 'c', qty: 2 }, { staff_id: 'c', date: '2025-12-01', code: 'c', qty: 3 }], [IT.cnt]) });
const tw = EX.splitCsv(twR.text);
t('月の集計: 同じ従業員コードの2行は空・ほかの人（2）は 3・dup に2人・dropped に数えない', tw[1].cells[1] === '' && tw[2].cells[1] === '' && tw[3].cells[1] === '3' && JSON.stringify(twR.dup.map((p) => p.staff_id)) === '["a","b"]' && twR.dropped === 0, [tw.map((r) => r.cells), twR.dup, twR.dropped]);
const twdR = EX.appendCsv('h,d\r\n1,2025-12-01\r\n1,2025-12-02\r\n2,2025-12-01\r\n', 'day', { people: twin, items: [IT.cnt], sums: EX.sumExtras([{ staff_id: 'a', date: '2025-12-01', code: 'c', qty: 1 }, { staff_id: 'c', date: '2025-12-01', code: 'c', qty: 3 }], [IT.cnt]) });
const twd = EX.splitCsv(twdR.text);
t('日ごと: 同じ従業員コードの行は空・ほかの人は値・dup に2人', twd[1].cells[2] === '' && twd[2].cells[2] === '' && twd[3].cells[2] === '3' && twdR.dup.length === 2 && twdR.dropped === 0, [twd.map((r) => r.cells), twdR.dropped]);
/* 反証の再現（t1）: 行を出さない人（勤務の無い A）と同じコードの B。csvPeople で絞れば B に正しく付く */
const pA = { staff: { staff_id: 'A', emp_code: '0001', name: 'A' }, sum: { workMin: 0, paidMin: 0, noPunchDays: 0, reviewCount: 0, absentDays: 0 } };
const pB = { staff: { staff_id: 'B', emp_code: '0001', name: 'B' }, sum: { workMin: 480, paidMin: 0, noPunchDays: 0, reviewCount: 0, absentDays: 0 } };
const pN = { staff: { staff_id: 'N', emp_code: '', name: 'N' }, sum: { workMin: 480 } };
t('csvPeople: 行を出さない人・従業員コードの無い人を外す', JSON.stringify(EX.csvPeople([pA, pB, pN]).map((p) => p.staff_id)) === '["B"]');
const t1 = EX.appendCsv('h\r\n0001\r\n', 'sum', { people: EX.csvPeople([pA, pB]), items: [IT.km], sums: EX.sumExtras([{ staff_id: 'B', date: '2025-12-01', code: 'd', qty: 12.3 }], [IT.km]) });
t('勤務の無い A と同じコードの B: B の行に B の値（12.3）・dup なし', EX.splitCsv(t1.text)[1].cells[1] === '12.3' && t1.dup.length === 0, t1);
t('csvPeople は本物の buildCsv が月の集計に出す行と同じ人・同じ並び', JSON.stringify(EX.csvPeople(mon.people).map((p) => p.emp_code)) === JSON.stringify(EX.splitCsv(res.summary).slice(1).map((r) => r.cells[0])), [EX.csvPeople(mon.people).map((p) => p.emp_code), EX.splitCsv(res.summary).slice(1).map((r) => r.cells[0])]);

console.log('\n— 6. 画面の組み込み —');
const H = read('kintai.html'), K = read('kintai.js');
t('kintai.html は kintai-extras.js を kintai-calc.js の後・kintai.js の前に読む（?v= の日付つき）', /<script src="kintai-extras\.js\?v=\d{4}-\d{2}-\d{2}(\.\d+)?"><\/script>/.test(H) && H.indexOf('kintai-extras.js?v=') > H.indexOf('kintai-calc.js?v=') && H.indexOf('kintai-extras.js?v=') < H.indexOf('kintai.js?v='));
t('.gitignore で公開する（!/kintai-extras.js）', /^!\/kintai-extras\.js$/m.test(read('.gitignore')));
t('呼ぶ関数と引数: kintai_extras_get(p_ym)', /rpc\('kintai_extras_get', \{ p_ym: atYm \}\)/.test(K));
t('呼ぶ関数と引数: kintai_extra_put の6つ（p_staff・p_date・p_code・p_qty・p_minutes・p_note）', /rpc\('kintai_extra_put', \{ p_staff: ctx\.sid, p_date: date, p_code: code, p_qty: pv\.qty, p_minutes: pv\.minutes, p_note: nt \|\| null \}\)/.test(K));
t('呼ぶ関数と引数: kintai_extra_void(p_id, p_reason)・理由が要る', /rpc\('kintai_extra_void', \{ p_id: ctx\.id, p_reason: reason \}\)/.test(K) && /var msg = \$\('e-msg'\), reason = needReason\(msg\); if \(!reason\) return;/.test(K));
const loadEx = K.slice(K.indexOf('function loadExtras(retry)'), K.indexOf('function exVal('));
t('関数が無い（noDb）時は exNoDb にして聞き直さず・報告にも回さない', /if \(noDb\(e\)\) \{ exNoDb = true; exSt = null; return; \}/.test(loadEx) && loadEx.indexOf('exNoDb = true') < loadEx.indexOf("note('補助項目の読み込み'"));
t('関数が無い時は、設定・個人の月・CSV のどこにも欄を出さない（exOn が偽なら空・null）', /function exOn\(\) \{ return !!EX && !exNoDb; \}/.test(K) && /function exSetHtml\(\) \{\s*if \(!exOn\(\) \|\| !exSt\) return '';/.test(K) && /function exPersonHtml\(p\) \{\s*if \(!exOn\(\)\) return '';/.test(K) && /function exCsv\(kind, src, text\) \{\s*if \(!exOn\(\)\) \{/.test(K));
t('反証 S1: CSV は書き出す直前に補助項目を読み直してから組み立てる（月の集計・日ごと・締めた時の数字／今の数字の窓）', /else if \(a === 'csv-sum'\) exFresh\(function \(\) \{ download\('sum'\); \}\);/.test(K) && /else if \(a === 'csv-day'\) exFresh\(function \(\) \{ download\('day'\); \}\);/.test(K) && /exFresh\(function \(\) \{ writeCsv\('sum', a === 'csv-snap' \? 'snap' : 'now'\); \}\)/.test(K) && /loadExtras\(true\)\.then\(function \(\) \{[^}]*then\(\); \}\);/.test(K));
t('反証 S1: 個人の月を開いている間は30秒ごと・画面に戻った時に補助項目を読み直す（変わっていなければ描き直さない）', /setInterval\(function \(\) \{ exQuiet\(\); \}, 30000\);/.test(K) && /if \(document\.visibilityState === 'visible'\) exQuiet\(\);/.test(K) && /same = before != null && before === JSON\.stringify\(exSt\.rows\);/.test(K));
t('反証 M1: 設定に extraItems があれば関数が無い印を倒して聞き直す・関数が無いのに項目がある時は CSV を止める', /if \(retry && EX && exNoDb && Array\.isArray\(rawCfg\(\)\.extraItems\)\) exNoDb = false;/.test(K) && /if \(EX && exNoDb && \(EX\.itemsOf\(rawCfg\(\)\) \|\| \[\]\)\.length\) \{ alert\('[^']*ページを読み直して/.test(K));
t('反証 M2: 結ぶ人は csvPeople（CSV に行を出す人）・重なりは名前つきで知らせる', /people: EX\.csvPeople\(src\.people\)/.test(K) && /if \(out\.dup && out\.dup\.length\) out\.warn0 = '従業員コードが同じ職員がいるため/.test(K) && /if \(exr\.warn0\) extra\.push\(exr\.warn0\);/.test(K));
t('反証 M3: 補助項目の欄を触った時だけ extraItems を送る・案のまま決めるボタン', /if \(!\$\('ex-s-rows'\) \|\| !EX \|\| !exTouched\) return null;/.test(K) && /data-act="ex-adopt"/.test(K) && /else if \(a === 'ex-adopt'\) \{ exTouched = true; saveSettings\(b\); \}/.test(K) && /if \(id && id\.indexOf\('ex-s-'\) === 0\) exTouched = true;/.test(K));
t('CSV の列は使う項目＋行がある止めた項目（csvItems）', /var items = EX\.csvItems\(exItems\(\) \|\| \[\], exSt\.rows\);/.test(K));
t('設定をまだ保存していない時は個人の月に「初めの7つは案」・管理者以外には「管理者に保存を頼んで」', /）は案です。設定のタブの「補助項目」で保存すると/.test(K) && /管理者に保存を頼んでください/.test(K));
t('取り消すのボタンは止めた項目・設定に無い項目の行にも出す（直すは使う項目だけ）', /\(on \? '<button type="button" class="btn sm k5" data-act="ex-open"[^\n]*: ''\) \+ '<button type="button" class="btn sm k5 ng" data-act="ex-void"/.test(K));
t('読めていない時は CSV を書き出さない（0 のまま出さない）', /if \(!exReady\(\)\) \{ alert\('補助項目を読み込めていないため、書き出せません/.test(K) && /var exr = exCsv\(kind, src, text\);\s*if \(exr === false\) return;/.test(K));
t('締めた月分は入れる欄を出さない（exCanInput に !isLocked）', /function exCanInput\(\) \{ return exReady\(\) && !isLocked\(\) && exActive\(\)\.length > 0; \}/.test(K) && /function openExtra\(sid, date, code\) \{\s*if \(!exCanInput\(\) \|\| !sid\) return;/.test(K));
t('個人の月の欄と日の札は紙に出さない（no-print）', /<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 8px">補助項目（日ごと）<\/h2>/.test(K) && /return '<span class="no-print">' \+ rs\.map/.test(K));
t('全員分の印刷（printAll）の紙には欄を足さない', (() => { const pp = K.slice(K.indexOf('function paintPerson()'), K.indexOf('function staffByEmp()')); const pa = pp.slice(pp.indexOf('if (printAll)'), pp.indexOf('if (!selStaff')); return pa.indexOf('exPersonHtml') < 0 && /personHtml\(p, a36\) \+ '<\/div>' \+ exPersonHtml\(p\);/.test(pp); })());
t('設定の欄は #g-set の中（保存していない変更の確かめに入る）・保存は extraItems を formKeys に足す', /h \+= lvSetHtml\(\);[^\n]*\n\s*h \+= exSetHtml\(\);/.test(K) && /\.concat\(exs \? \['extraItems'\] : \[\]\)/.test(K) && /if \(exs\) outCfg\.extraItems = exs\.items;/.test(K));
t('保存済みのコードは変えられない（readonly）', /' readonly' : ''/.test(K.slice(K.indexOf('function exSetRow('), K.indexOf('function exSetHtml('))));
t('直しの履歴の名前: extra_put「補助項目を入れた」・extra_void「補助項目を取り消した」', /extra_put: '補助項目を入れた', extra_void: '補助項目を取り消した'/.test(K));
t('断る語はすべて職員の言葉（baddate・badcode・badvalue・notfound・locked・reason・already）', ['baddate', 'badcode', 'badvalue', 'notfound', 'locked', 'reason', 'already'].every((w) => new RegExp('\\b' + w + ": '[^']*[ぁ-ん]").test(K.slice(K.indexOf('var NG_EX = {'), K.indexOf('function exMsg(')))));
t('形を変えた項目の前の形の行: 個人の月の帯・CSV の注意・設定の保存の確かめ・行がある項目の形は変えさせない',
  /if \(mm\) h \+= '<div class="band warn" role="status">' \+ esc\(mm\)/.test(K) && /out\.warn = EX\.mismatchText\(sums\.mismatch, exItems\(\) \|\| \[\]\);/.test(K) && /if \(exr\.warn\) extra\.push\(exr\.warn\);/.test(K)
  && /var kc = exs \? exKindChanged\(exs\.items\) : \[\];\s*if \(kc\.length && !confirm\(/.test(K) && /\(saved && exHasRows\(it\.code\) \? ' disabled/.test(K));
t('入れる窓は保存していない入力を確かめる（DIRTY_MODES.extra）', /DIRTY_MODES\.extra = 1;/.test(K));
/* ★年別・事業所別・休日のタブ（2026-11-25・kintai-views.js）で TABS に3つ足した。補助項目が足していないこと（端末に残す鍵）は同じに確かめる */
t('補助項目は新しいタブ・端末に残す鍵を足していない（TABS は年別などの3つと社保の知らせの shaho と資格の期限の cert を足しただけ・localStorage の鍵は今のまま）', /var TABS = \['home', 'day', 'review', 'requests', 'grid', 'person', 'staff', 'leave', 'close', 'settings', 'year', 'site', 'holiday', 'shaho', 'cert'\];/.test(K) && /var LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym';/.test(K) && !/localStorage\.setItem\([^)]*ex/.test(K));
console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
