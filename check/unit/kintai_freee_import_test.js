/* freee の月の集計の取り込み（kintai-freee-import.js・kintai-calc.js の取り込みの置き換え・給与への通し）の試験（2026-11-23 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT-freee-month-import.md）
   実行: node check/unit/kintai_freee_import_test.js（環境変数 KINTAI_CALC で別の版の kintai-calc.js を当てられる）
   守りたいこと:
     1. 読み口: 見出しの別名（日本語・API の名前）・「時:分」・見出しに「分」のある列の整数の分・全角・BOM・CRLF・引用符・表題の行・空の欄は 0・
        小数の時間・形の分からない値はその行の誤り・必要な列が無い／同じ意味の列が2つはファイルの誤り・API の月の集計（入れ子の日数と時間・複数時給）
     2. toImport: 従業員コードの照合（A901→0901）・法定外＝所定外−法定内残業・60時間超・4つの和が合わない行は取り込まない・
        当てはめ方の決まっていない欄（特別休暇・代休・振休・有休の時間・みなし・不足時間・所定内法定外・知らない欄）が 0 でない人は取り込まない・
        警告（休日・深夜・欠勤・遅刻早退・予定の働く日の数の違い）・同じ番号の行が2つ／同じ従業員コードの職員が2人は取り込まない・freee に無い職員・氏名は ok の行に入らない
     3. computeMonth の置き換え: 取り込んだ人の合計＝取り込みの値・要確認 0（要確認の一覧にも出ない）・勤務中／まだ出勤していないの印を外す・
        予定から数える鍵（所定日数・記号ごとの回数・夜勤の回数）・休暇の記録や手入力の有休を上乗せしない・勤怠なし（none）の人・形の違う取り込みは使わない・
        取り込みの無い人の結果は取り込みのある人がいてもいなくても1バイトも変わらない・別の月分の取り込みは使わない・月全体の合計・締めの控えの imported
     4. 給与との通し（受入条件1）: 架空の3人（時給・月給・夜勤のある月給）で、取り込み → 勤怠の画面の数え方で締めの控え → 控えと月の読み出しを JSON で1往復 →
        給与の画面（payroll.js）の verifyKintai と同じ数え直し（締めた時の設定・別の時刻・DB の並び）→ attFromKintai・attSame で控えと同じ・att が仕様の表どおり
   ★職員は架空（試験 甲〜戊・従業員コード 9901〜9905）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.KINTAI_CALC || path.join(ROOT, 'kintai-calc.js'));
const F = require(path.join(ROOT, 'kintai-freee-import.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const J = (x) => JSON.stringify(x);

console.log('\n— 1. 読み口（CSV・API） —');
{
  /* 払いに効く列（法定休日・深夜・欠勤・有休日数・遅刻早退）は必ず要る（チーフの決定 2026-11-23）。短い見本の CSV は末尾に PAY の5列を足す */
  const PAYH = ',法定休日労働時間,深夜労働時間,欠勤日数,有休日数,遅刻早退時間', PAYV = ',0:00,0:00,0,0,0:00';
  const csv = '﻿勤怠の月の集計（見本）\r\n従業員番号,氏名,勤務日数,総労働時間(分),所定内労働時間,所定外労働時間,法定内残業時間,深夜労働時間,有休日数,法定休日労働時間,欠勤日数,遅刻早退時間,特別休暇日数,備考\r\n' +
    'A901,"試験 甲",２０,"9600",１５０:００,10:00,2:00,0:00,1.5,0:00,0,0:00,,見本\r\n0902,試験 乙,10,4800,80:00,0:00,0:00,1:00,0,0:00,0,0:00,0,\r\n';
  const p = F.parseFreeeMonthCsv(csv);
  t('表題の行を飛ばし、従業員番号の見出しの行を見つける・誤り 0・2行', p.errors.length === 0 && p.rows.length === 2, p.errors);
  const r0 = p.rows[0];
  t('全角の数字・「時:分」・見出しに（分）のある列の整数・必須でない列（特別休暇）の空は 0・日数の 1.5', r0.code === '0901' && r0.src.work_days === 20 && r0.src.total_work_mins === 9600 && r0.src.total_normal_work_mins === 9000
    && r0.src.total_overtime_except_normal_work_mins === 600 && r0.src.total_overtime_within_statutory_work_mins === 120 && r0.src.total_latenight_work_mins === 0 && r0.src.num_paid_holidays === 1.5 && r0.src.num_special_holidays_used === 0 && !r0.err, r0);
  t('氏名は読むが src に入れない・使わなかった列は unknown', r0.name === '試験 甲' && !('name' in r0.src) && J(p.unknown) === J(['備考']), [r0, p.unknown]);
  const bad = F.parseFreeeMonthCsv('従業員番号,勤務日数,総労働時間,所定内労働時間,所定外労働時間,法定内残業時間' + PAYH + '\n9901,20,9600,150.5,0:00,0:00' + PAYV + '\n9902,20,160:00,160:00,0:00,0:00' + PAYV + '\n9903,0.3,0:00,0:00,0:00,0:00' + PAYV + '\n9904,20,1:2,0:00,0:00,0:00' + PAYV + '\n');
  t('分の書いていない見出しの整数（9600）・時間の小数（150.5）・日数の 0.3・「1:2」はその行の誤り（ほかの行は読める）',
    /総労働時間「9600」/.test(bad.rows[0].err) && /所定内労働時間「150.5」/.test(bad.rows[0].err) && !bad.rows[1].err && /勤務日数「0.3」/.test(bad.rows[2].err) && /総労働時間「1:2」/.test(bad.rows[3].err), bad.rows.map((x) => x.err || ''));
  const miss = F.parseFreeeMonthCsv('従業員コード,勤務日数,総労働時間\n9901,1,8:00\n');
  t('必要な列が無ければファイルの誤り（所定内・所定外・法定内残業と払いに効く5列＝8つ）', miss.errors.length === 8 && miss.rows.length === 0, miss.errors);
  const payMiss = F.parseFreeeMonthCsv('従業員番号,勤務日数,総労働時間,所定内労働時間,所定外労働時間,法定内残業時間,深夜労働時間,有休日数\n9901,1,8:00,8:00,0:00,0:00,0:00,0\n');
  t('払いに効く列（法定休日・欠勤・遅刻早退）が無ければファイルの誤りで、どの列が無いかを出す（取り込む行を作らない）',
    payMiss.rows.length === 0 && J(payMiss.errors) === J(['必要な列「法定休日労働時間」が見つかりません。', '必要な列「欠勤日数」が見つかりません。', '必要な列「遅刻早退時間」が見つかりません。']), payMiss.errors);
  t('休暇の種類などの列（特別休暇・代休・振休・有休の時間・みなし・不足時間・所定休日・所定内法定外）は無くても読めて、missing で知らせる（0 として扱う・仮置き）・API の名前の見出しの CSV は missing 0',
    p.errors.length === 0 && ['代休日数', '振休日数', '有休時間', '不足時間', 'みなし外の法定内残業時間', 'みなし外の時間外労働時間', '所定休日労働時間', '所定内法定外労働時間'].every((x) => p.missing.indexOf(x) >= 0)
    && ['欠勤日数', '法定休日労働時間', '深夜労働時間', '有休日数', '遅刻早退時間'].every((x) => p.missing.indexOf(x) < 0)
    && F.parseFreeeMonthCsv(F.toCanonicalCsv([{ code: '9901', src: {} }])).missing.length === 0, [p.missing, F.parseFreeeMonthCsv(F.toCanonicalCsv([{ code: '9901', src: {} }])).missing]);
  t('従業員番号の列が無い・空のファイルは誤り', F.parseFreeeMonthCsv('氏名,勤務日数\n試験,1\n').errors.length === 1 && F.parseFreeeMonthCsv('').errors.length === 1);
  const dupc = F.parseFreeeMonthCsv('従業員番号,総労働時間,総勤務時間,勤務日数,所定内労働時間,所定外労働時間,法定内残業時間' + PAYH + '\n9901,1:00,1:00,1,1:00,0:00,0:00' + PAYV + '\n');
  t('同じ意味の列が2つ（総労働時間・総勤務時間）は誤り', dupc.errors.some((e) => /同じ意味の列/.test(e)), dupc.errors);
  const lf = F.parseFreeeMonthCsv('従業員番号,勤務日数,総労働時間,所定内労働時間,所定外労働時間,法定内残業時間,特別休暇日数' + PAYH + '\n"99,01",1,8:00,8:00,0:00,0:00,1' + PAYV + '\n');
  /* ── 反証レビュー（2026-11-23）の4件 ── */
  const H10 = '従業員番号,氏名,勤務日数,総労働時間,所定内労働時間,所定外労働時間,法定内残業時間' + PAYH;
  const blankRows = F.parseFreeeMonthCsv(H10 + '\n0002,架空二\n0003,,,,,,,,,,,\n0004,架空四,1,8:00,8:00,0:00,0:00,-,0:00,0,0,0:00\n,,,,,,,,,,,,\n0005,架空五,1,8:00,8:00,0:00,0:00' + PAYV + '\n');
  const br = blankRows.rows;
  t('必須の列の値が欠けた行（「0002,架空二」だけ）・全部空の行・「-」の行はその行の誤りで、どの列かを出す（0 にしない）',
    br.length === 4 && /必要な列の値が空です（勤務日数・総労働時間・所定内労働時間・所定外労働時間・法定内残業時間・法定休日労働時間・深夜労働時間・欠勤日数・有休日数・遅刻早退時間）/.test(br[0].err)
    && /必要な列の値が空です（勤務日数/.test(br[1].err) && /必要な列の値が空です（法定休日労働時間）/.test(br[2].err) && !br[3].err, br.map((x) => x.code + ':' + (x.err || '')));
  const blankImp = F.toImport(br, [{ staff_id: 'sB2', emp_code: '0002' }, { staff_id: 'sB3', emp_code: '0003' }, { staff_id: 'sB4', emp_code: '0004' }, { staff_id: 'sB5', emp_code: '0005' }]);
  t('欠けた行は取り込まない（理由つき）・そろった行だけ取り込む・何も無い行は数えない', blankImp.ok.length === 1 && blankImp.ok[0].staff_id === 'sB5' && blankImp.refused.length === 3
    && blankImp.refused.every((x) => /必要な列の値が空です/.test(x.why)), blankImp);
  const kw = F.parseFreeeMonthCsv(H10 + ',特別休暇取得日数,代休取得日数,振替休日取得日数,謎の列,育児休暇日数\n0006,架空六,1,8:00,8:00,0:00,0:00' + PAYV + ',2,1,1,5,0\n0007,架空七,1,8:00,8:00,0:00,0:00' + PAYV + ',0,0,0,5,0\n0008,架空八,1,8:00,8:00,0:00,0:00' + PAYV + ',0,0,0,0,1\n');
  const kwImp = F.toImport(kw.rows, [{ staff_id: 'sK6', emp_code: '0006' }, { staff_id: 'sK7', emp_code: '0007' }, { staff_id: 'sK8', emp_code: '0008' }]);
  t('休暇の種類の別名（特別休暇取得日数・代休取得日数・振替休日取得日数）に 2・1・1 がある人は取り込まない', kw.errors.length === 0 && kw.rows[0].src.num_special_holidays_used === 2 && kw.rows[0].src.num_compensatory_holidays_used === 1 && kw.rows[0].src.num_substitute_holidays_used === 1
    && kwImp.refused.some((x) => x.staff_id === 'sK6' && /特別休暇の日数/.test(x.why) && /代休の日数/.test(x.why) && /振休の日数/.test(x.why)), kwImp.refused);
  t('知らない列「謎の列」は値があっても取り込みを止めない（使わなかった列に出す）', J(kw.unknown) === J(['謎の列']) && kwImp.ok.some((x) => x.staff_id === 'sK7'), [kw.unknown, kwImp.ok.map((x) => x.staff_id)]);
  t('名前に休暇などの語がある知らない列（育児休暇日数）は、値が 0 でない人を取り込まない（知らない列「…」に値があります）', J(kw.watch) === J(['育児休暇日数'])
    && kwImp.refused.some((x) => x.staff_id === 'sK8' && /知らない列「育児休暇日数」に値があります/.test(x.why)) && !kwImp.ok.some((x) => x.staff_id === 'sK8'), kwImp.refused);
  const PER0 = { from: '2026-11-16', to: '2026-12-15' };
  const pcsv = (a, b) => F.parseFreeeMonthCsv('従業員番号,開始日,締め日,勤務日数,総労働時間,所定内労働時間,所定外労働時間,法定内残業時間' + PAYH + '\n9901,' + a + ',' + b + ',1,8:00,8:00,0:00,0:00' + PAYV + '\n');
  const pOk = F.toImport(pcsv('2026/11/16', '2026年12月15日').rows, [{ staff_id: 'sP1', emp_code: '9901' }], { period: PER0 });
  const pNg = F.toImport(pcsv('2026-11-01', '2026-11-30').rows, [{ staff_id: 'sP1', emp_code: '9901' }], { period: PER0 });
  t('CSV の期間の列（開始日・締め日）がこの月分の期間と同じなら取り込む・違えばファイルの誤り（1人も取り込まない）',
    pOk.ok.length === 1 && !pOk.periodError && pNg.ok.length === 0 && /ファイルの期間（2026-11-01〜2026-11-30）が、この月分の期間（2026-11-16〜2026-12-15）と違います/.test(pNg.periodError), [pOk, pNg]);
  t('期間の列の日付が読めなければその行の誤り', /開始日「11月16日」/.test(pcsv('11月16日', '2026-12-15').rows[0].err || ''));
  const apiP = F.fromApiSummaries([{ num: '9901', summary: Object.assign({ start_date: '2026-11-01', end_date: '2026-11-30' }, { work_days: 1, total_work_mins: 480, total_normal_work_mins: 480, total_overtime_except_normal_work_mins: 0,
    total_overtime_within_statutory_work_mins: 0, total_holiday_work_mins: 0, total_latenight_work_mins: 0, num_absences: 0, num_paid_holidays: 0, total_lateness_and_early_leaving_mins: 0 }) }]);
  t('API の start_date・end_date がこの月分の期間と違えばファイルの誤り', /ファイルの期間/.test(F.toImport(apiP, [{ staff_id: 'sP1', emp_code: '9901' }], { period: PER0 }).periodError || '') && !apiP[0].err);
  t('API の行に必須の欄が無ければその行の誤り', /欄が無い: .*num_absences/.test(F.fromApiSummaries([{ num: '9901', summary: { work_days: 1 } }])[0].err || ''));
  const sc = F.srcClean(Object.assign({ ['x'.repeat(61)]: 1, Bad: 1, big: 2000000, ok_a: 1 }, ...Array.from({ length: 70 }, (_, i) => ({ ['k' + String(i).padStart(2, '0')]: i }))));
  t('srcClean: DB が受ける形だけ残す（60字以下・英小文字の名前・0〜1000000・60欄まで）・捨てた数を返す', Object.keys(sc.src).length === 60 && !('Bad' in sc.src) && !('big' in sc.src) && !(('x'.repeat(61)) in sc.src) && sc.dropped === 74 - 60, [Object.keys(sc.src).length, sc.dropped]);
  t('LF だけの改行・引用符の中のカンマ・特別休暇の列の別名', lf.rows.length === 1 && lf.rows[0].code === '99,01' && lf.rows[0].src.num_special_holidays_used === 1, lf.rows);
  /* API の名前の見出し（toCanonicalCsv）と行き来しても同じ */
  const api = F.fromApiSummaries([
    { num: 'A903', summary: { year: 2026, month: 12, start_date: '2026-11-16', end_date: '2026-12-15', work_days: 21, total_work_mins: 10200, total_normal_work_mins: 9600,
      total_overtime_except_normal_work_mins: 600, total_overtime_within_statutory_work_mins: 0, total_excess_statutory_work_mins: 600, total_holiday_work_mins: 0,
      total_latenight_work_mins: 0, num_absences: 0, num_paid_holidays: 0.5, num_paid_holidays_and_hours: { days: 0.5, hours: 0 }, num_paid_holidays_left: 9.5,
      num_paid_holidays_and_hours_left: { days: 9, hours: 4 }, num_special_holidays_and_hours_used: { days: 0, hours: 0 }, total_lateness_and_early_leaving_mins: 0,
      multi_hourly_wages: [], work_records: [{ date: '2026-11-16' }], total_shortage_work_mins: 0 } },
    { num: '9904', summary: { work_days: -1 } },
    { num: '9905', summary: null },
  ]);
  t('API: 入れ子の日数と時間は「親.子」・複数時給は行の数・日ごとの勤怠と日付は読まない', api[0].code === '0903' && api[0].src['num_paid_holidays_and_hours.hours'] === 0 && api[0].src['num_paid_holidays_and_hours_left.hours'] === 4
    && api[0].src['multi_hourly_wages.count'] === 0 && !('work_records' in api[0].src) && !('start_date' in api[0].src) && !('year' in api[0].src) && !api[0].err, api[0]);
  t('API: 負の数・集計の無い人はその行の誤り', /work_days/.test(api[1].err) && /月の集計がありません/.test(api[2].err), [api[1].err, api[2].err]);
  const canon = F.toCanonicalCsv([api[0]]);
  t('toCanonicalCsv: 見出しは num・期間（start_date・end_date）と API の名前・氏名は無い・CRLF', /^num,start_date,end_date,work_days,total_work_mins,/.test(canon) && /\r\n/.test(canon) && !/name/.test(canon.split('\r\n')[0]));
  const back = F.parseFreeeMonthCsv(canon);
  t('toCanonicalCsv → parseFreeeMonthCsv で同じ src（数の欄は全部）', back.errors.length === 0 && back.rows.length === 1 && back.rows[0].code === '0903'
    && Object.keys(api[0].src).every((k) => back.rows[0].src[k] === api[0].src[k]), [back.errors, back.rows[0] && back.rows[0].src]);
}

console.log('\n— 2. toImport（突き合わせ・取り込まない・警告） —');
const SRC = (o) => Object.assign({ work_days: 20, total_work_mins: 9600, total_normal_work_mins: 9000, total_overtime_except_normal_work_mins: 600, total_overtime_within_statutory_work_mins: 120 }, o || {});
{
  const staff = [{ staff_id: 'sF1', emp_code: '0901', schedDays: 20 }, { staff_id: 'sF2', emp_code: 'A902', schedDays: 19 }, { staff_id: 'sF3', emp_code: '9903', schedDays: 5 },
    { staff_id: 'sF4', emp_code: '9904', schedDays: 0 }, { staff_id: 'sF5', emp_code: '9905', schedDays: 3 }, { staff_id: 'sF6', emp_code: '9905', schedDays: 3 }];
  const rows = [
    { code: F.codeNorm('A901'), name: '試験 甲', src: SRC() },
    { code: '0902', src: SRC({ total_holiday_work_mins: 0, total_latenight_work_mins: 90, num_absences: 1, total_lateness_and_early_leaving_mins: 25 }) },
    { code: '9905', src: SRC() },
    { code: '9999', src: SRC() },
  ];
  const r = F.toImport(rows, staff);
  const o1 = r.ok.find((x) => x.staff_id === 'sF1');
  t('A901 と 0901 を同じ人として結ぶ・vals は仕様の表どおり（法定外＝所定外−法定内残業）', o1 && J(o1.vals) === J({ workDays: 20, workMin: 9600, schedInMin: 9000, legalInOverMin: 120, legalOverMin: 480, holidayMin: 0, nightMin: 0, over60Min: 0, absentDays: 0, lateMin: 0, paidDays: 0 }), o1);
  t('ok の行に氏名が入らない・src は数だけ', o1 && !J(o1).includes('試験') && Object.values(o1.src).every((v) => typeof v === 'number'));
  const o2 = r.ok.find((x) => x.staff_id === 'sF2');
  t('深夜・欠勤・遅刻早退は取り込んで警告（給与の払い方は未検証）・予定の働く日の数の違いも警告', o2 && o2.vals.nightMin === 90 && o2.vals.absentDays === 1 && o2.vals.lateMin === 25
    && r.warn.filter((w) => w.staff_id === 'sF2').length === 4 && r.warn.some((w) => w.staff_id === 'sF2' && /予定の働く日（19日）と freee の勤務日数（20日）/.test(w.why)), r.warn);
  t('勤怠の職員に同じ従業員コードの人が2人いれば取り込まない', r.refused.some((x) => x.code === '9905' && /2人以上/.test(x.why)), r.refused);
  t('勤怠の職員に無い番号は unmatched', J(r.unmatched) === J(['9999']));
  t('freee に無い職員＝予定のある人だけ（予定の無い sF4・同じコードで断った sF5・sF6 は入れない）', J(r.missingStaff) === J(['sF3']), r.missingStaff);
  const dup = F.toImport([{ code: '9903', src: SRC() }, { code: '9903', src: SRC() }], staff);
  t('同じ番号の行が2つは両方とも取り込まない', dup.ok.length === 0 && dup.refused.length === 2 && dup.refused.every((x) => /2つ以上/.test(x.why)) && dup.missingStaff.indexOf('sF3') < 0, dup);
  const ref = (o) => F.toImport([{ code: '9903', src: SRC(o) }], staff);
  const refuseKeys = ['num_special_holidays_used', 'num_compensatory_holidays_used', 'num_substitute_holidays_used', 'num_paid_holidays_and_hours.hours',
    'total_shortage_work_mins', 'total_deemed_paid_overtime_within_statutory_work_mins', 'total_deemed_paid_overtime_except_normal_work_mins', 'total_deemed_paid_excess_statutory_work_mins',
    'total_overtime_within_normal_work_mins', 'multi_hourly_wages.count', 'num_special_holidays_and_hours_used.hours'];
  t('特別休暇・代休・振休・有休の時間・不足時間・みなし・所定内法定外・複数時給が 0 でない人は取り込まない（理由つき）',
    refuseKeys.every((k) => { const x = ref({ [k]: 1 }); return x.ok.length === 0 && x.refused.length === 1 && x.refused[0].staff_id === 'sF3'; }),
    refuseKeys.filter((k) => ref({ [k]: 1 }).ok.length));
  t('同じ欄が 0 なら取り込む（当てはめないだけ）', refuseKeys.every((k) => ref({ [k]: 0 }).ok.length === 1));
  t('知らない API の欄が 0 でなければ取り込まない・0 なら取り込む', ref({ total_new_kind_mins: 30 }).refused.length === 1 && /total_new_kind_mins/.test(ref({ total_new_kind_mins: 30 }).refused[0].why) && ref({ total_new_kind_mins: 0 }).ok.length === 1);
  t('法定外の欄（excess_statutory）・有休の残りは使わない（0 でなくても取り込む）', ref({ total_excess_statutory_work_mins: 480, num_paid_holidays_left: 10 }).ok.length === 1);
  const mis = ref({ total_work_mins: 9500 });
  t('4つの和（所定内＋法定内残業＋法定外＋法定休日）が総労働と合わない行は取り込まない', mis.ok.length === 0 && /総労働/.test(mis.refused[0].why), mis.refused);
  const hol = ref({ total_work_mins: 10080, total_holiday_work_mins: 480 });
  t('法定休日の労働は holidayMin（4つの和に入る）・警告2つ（払い方・法定休日に働いた日の数）', hol.ok.length === 1 && hol.ok[0].vals.holidayMin === 480 && hol.warn.filter((w) => /法定休日/.test(w.why)).length === 2, hol);
  const big = ref({ total_work_mins: 9000 + 120 + 4000, total_overtime_except_normal_work_mins: 4120 });
  const half = ref({ work_days: 20.5 });
  t('勤務日数の半日（20.5）は取り込まない（給与の attFromKintai が整数に丸めて freee の値と違ってしまうため）', half.ok.length === 0 && /勤務日数が整数ではありません/.test(half.refused[0].why), half.refused);
  t('60時間超＝法定外−3600', big.ok.length === 1 && big.ok[0].vals.legalOverMin === 4000 && big.ok[0].vals.over60Min === 400, big.ok[0] && big.ok[0].vals);
  const neg = ref({ total_overtime_except_normal_work_mins: 0 });
  t('所定外が法定内残業より少ない（法定外が負）は 0 にして4つの和で断る', neg.ok.length === 0 && neg.refused.length === 1);
  const rng = F.toImport([{ code: '9903', src: SRC({ total_work_mins: 50000, total_normal_work_mins: 49400 }) }], staff);
  t('分が 31日×24時間を超える値は取り込まない', rng.ok.length === 0 && /範囲/.test(rng.refused[0].why), rng.refused);
  const er = F.toImport([{ code: '9903', src: {}, err: '読めない値があります（見本）' }, { code: '', src: {} }], staff);
  t('読めない値の行・番号が空の行は取り込まない', er.ok.length === 0 && er.refused.length === 2 && er.refused[0].why === '読めない値があります（見本）');
  t('zeroVals は全部 0 で valsWhy を通る・valsWhy は知らない鍵を断る', F.valsWhy(F.zeroVals()) === null && /知らない鍵/.test(F.valsWhy(Object.assign(F.zeroVals(), { paidMin: 0 }))));
  t('empNorm は kintai-calc.js と同じ規則（A001→0001・A12→0012・ほかはそのまま）', F.empNorm('A001') === '0001' && F.empNorm('A12') === '0012' && F.empNorm('9001') === '9001' && F.empNorm('B001') === 'B001' && F.empNorm('A00001') === 'A00001');
}

console.log('\n— 3. computeMonth の置き換え —');
const YM = '2026-12', PER = { from: '2026-11-16', to: '2026-12-15' };
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
const addD = (d, n) => C.addDays(d, n);
const dates = []; for (let d = PER.from; d <= PER.to; d = addD(d, 1)) dates.push(d);
const dow = (d) => new Date(d + 'T12:00:00+09:00').getUTCDay();
/* 架空の5人: 甲（時給・平日日勤）・乙（月給・平日日勤）・丙（月給・夜勤のある）・丁（取り込みなし・打刻あり）・戊（freee に無い＝勤怠なし） */
const STAFF = [
  { staff_id: 'sQ1', name: '試験 甲', code: '9901', office: 'facility', emp_code: '9901', active: true },
  { staff_id: 'sQ2', name: '試験 乙', code: '9902', office: 'visit', emp_code: '9902', active: true },
  { staff_id: 'sQ3', name: '試験 丙', code: '9903', office: 'facility', emp_code: '9903', active: true },
  { staff_id: 'sQ4', name: '試験 丁', code: '9904', office: 'day', emp_code: '9904', active: true },
  { staff_id: 'sQ5', name: '試験 戊', code: '9905', office: 'facility', emp_code: '9905', active: true },
];
const SCHED = [];
let pid = 0;
const PUN = [];
dates.concat([addD(PER.to, 1)]).forEach((d) => {
  const w = dow(d);
  if (w !== 0 && w !== 6) {
    ['sQ1', 'sQ2', 'sQ4', 'sQ5'].forEach((sid) => SCHED.push({ staff_id: sid, work_date: d, seq: 1, office: STAFF.find((s) => s.staff_id === sid).office, start_at: iso(d, '09:00'), end_at: iso(d, '18:00'), break_min: 60, kind: 'work', symbol: '日', paid_min: 0 }));
    if (d <= PER.to) { PUN.push({ id: 'p' + (++pid), staff_id: 'sQ4', kind: 'in', at: iso(d, '09:00'), source: 'tablet', created_at: iso(d, '09:00') }, { id: 'p' + (++pid), staff_id: 'sQ4', kind: 'out', at: iso(d, '18:00'), source: 'tablet', created_at: iso(d, '18:00') }); }
  }
  /* 丙: 月・木は夜勤（17時〜翌9時・休憩2時間）・火・水・金は日勤 */
  if (w === 1 || w === 4) SCHED.push({ staff_id: 'sQ3', work_date: d, seq: 1, office: 'facility', start_at: iso(d, '17:00'), end_at: iso(addD(d, 1), '09:00'), break_min: 120, kind: 'night', symbol: '夜', paid_min: 0 });
  else if (w === 2 || w === 3 || w === 5) SCHED.push({ staff_id: 'sQ3', work_date: d, seq: 1, office: 'facility', start_at: iso(d, '09:00'), end_at: iso(d, '18:00'), break_min: 60, kind: 'work', symbol: '日', paid_min: 0 });
});
/* 甲の有休の行（シフトの「有」）と、休暇の記録（時間単位の有休）・手入力の有休を1つずつ（取り込んだ人には上乗せしない） */
SCHED.push({ staff_id: 'sQ1', work_date: '2026-11-21', seq: 1, office: 'facility', start_at: null, end_at: null, break_min: 0, kind: 'paid', symbol: '有', paid_min: 480 });
const ABS = [{ id: 'ab1', staff_id: 'sQ1', date: '2026-11-18', kind: 'hourly_paid', minutes: 60, paid: true, type_code: null, link_date: null }];
const LEAVE = [{ id: 'lu1', staff_id: 'sQ2', use_date: '2026-11-19', days: 1 }];
const nWork = (sid) => new Set(SCHED.filter((r) => r.staff_id === sid && (r.kind === 'work' || r.kind === 'night') && r.work_date >= PER.from && r.work_date <= PER.to).map((r) => r.work_date)).size;
const nNight = SCHED.filter((r) => r.staff_id === 'sQ3' && r.kind === 'night' && r.work_date >= PER.from && r.work_date <= PER.to).length;
const VALS = {
  sQ1: { workDays: nWork('sQ1'), workMin: 9000 + 300 + 0, schedInMin: 9000, legalInOverMin: 300, legalOverMin: 0, holidayMin: 0, nightMin: 0, over60Min: 0, absentDays: 0, lateMin: 10, paidDays: 1 },
  sQ2: { workDays: nWork('sQ2'), workMin: 9600 + 0 + 600, schedInMin: 9600, legalInOverMin: 0, legalOverMin: 600, holidayMin: 0, nightMin: 0, over60Min: 0, absentDays: 0, lateMin: 0, paidDays: 0 },
  sQ3: { workDays: nWork('sQ3') + 1, workMin: 9000 + 120 + 240, schedInMin: 9000, legalInOverMin: 120, legalOverMin: 240, holidayMin: 0, nightMin: 2520, over60Min: 0, absentDays: 0, lateMin: 0, paidDays: 0 },
};
const MI = (sid, src, id) => ({ id: id || ('mi-' + sid), ym: YM, period: { from: PER.from, to: PER.to }, vals: VALS[sid], source: src || 'freee_csv', created_at: '2026-12-16T10:00:00+09:00' });
const staffWith = (imp) => STAFF.map((s) => imp[s.staff_id] ? Object.assign({}, s, { month_import: imp[s.staff_id] }) : Object.assign({}, s));
const NOW_LOCK = Date.parse('2026-12-16T10:00:00+09:00');
const CFG = { legal_holiday: 0, hourlyPaidLeave: true, breakThresholdH: 6, breakH: 1, nightBreakH: 2 };
const calc = (staff, extra) => C.computeMonth(Object.assign({ ym: YM, period: PER, staff, schedule: SCHED, punches: PUN, days: [], leave_uses: LEAVE, absences: ABS, config: CFG, now: NOW_LOCK }, extra || {}));
{
  const base = calc(staffWith({}));
  const m = calc(staffWith({ sQ1: MI('sQ1'), sQ2: MI('sQ2'), sQ3: MI('sQ3'), sQ5: { id: 'mi-sQ5', ym: YM, period: { from: PER.from, to: PER.to }, vals: F.zeroVals(), source: 'none', created_at: '2026-12-16T10:00:00+09:00' } }));
  const P = (mm, sid) => mm.people.find((p) => p.staff.staff_id === sid);
  t('前提: 取り込みの無い時は、打刻の無い甲・乙・丙・戊に要確認がある（締められない）', ['sQ1', 'sQ2', 'sQ3', 'sQ5'].every((s) => P(base, s).sum.reviewCount > 0) && P(base, 'sQ4').sum.reviewCount === 0);
  ['sQ1', 'sQ2', 'sQ3'].forEach((sid) => {
    const s = P(m, sid).sum;
    t(sid + ': 合計の表の鍵が取り込みの値と同じ・要確認 0・earlyLeaveMin 0・imported', Object.keys(VALS[sid]).every((k) => s[k] === VALS[sid][k]) && s.reviewCount === 0 && s.earlyLeaveMin === 0
      && J(s.imported) === J({ source: 'freee_csv', id: 'mi-' + sid }), Object.keys(VALS[sid]).filter((k) => s[k] !== VALS[sid][k]));
  });
  const s1 = P(m, 'sQ1').sum, s2 = P(m, 'sQ2').sum, s3 = P(m, 'sQ3').sum, s5 = P(m, 'sQ5').sum;
  t('休暇の記録・手入力の有休・シフトの有休の分を上乗せしない（paidMin・時間単位の有休・予定の無い日の有休は 0）', s1.paidMin === 0 && s1.hourlyPaidMin === 0 && s1.hourlyPaidEffMin === 0 && s1.paidNoSchedDays === 0 && s1.paidNoSchedMin === 0 && s1.paidOffDays === 0 && s2.paidMin === 0 && s2.paidDays === 0,
    [s1.paidMin, s1.hourlyPaidMin, s1.paidNoSchedDays, s2.paidMin, s2.paidDays]);
  t('予定から数える: 所定日数は今の数え方（予定の働く日＋有休の日）・記号ごとの回数は予定どおり働いた数＋有休の記号',
    s1.schedDays === P(base, 'sQ1').sum.schedDays && s1.counts['日'] === nWork('sQ1') && s1.counts['有'] === 1 && s2.counts['日'] === nWork('sQ2'), [s1.schedDays, s1.counts, s2.counts]);
  t('予定から数える: 夜勤の回数＝予定の夜勤の塊（打刻なしでも）・記号「夜」「日」の回数', s3.nightShiftCount === nNight && nNight > 0 && s3.counts['夜'] === nNight && s3.counts['日'] === nWork('sQ3') - nNight, [s3.nightShiftCount, nNight, s3.counts]);
  t('予定の働く日と freee の勤務日数が違えば警告（丙は1日多い）・同じなら警告なし', s3.warnings.some((w) => /予定の働く日（\d+日）と、freee から取り込んだ勤務日数/.test(w)) && !s1.warnings.some((w) => /予定の働く日/.test(w)), [s1.warnings, s3.warnings]);
  t('仮置きの鍵: overtimeMin＝法定内残業＋法定外・byOffice＝主事業所に総労働・36協定の丸めの前の値＝取り込みの値', s1.overtimeMin === 300 && s2.overtimeMin === 600 && J(s2.byOffice) === J({ visit: VALS.sQ2.workMin }) && s2.legalOverRawMin === 600 && s2.holidayRawMin === 0);
  t('勤怠なし（none）: 全部 0・要確認 0・記号の回数は有休だけ・夜勤 0・予定の働く日の警告', s5.workMin === 0 && s5.workDays === 0 && s5.reviewCount === 0 && J(s5.counts) === '{}' && s5.nightShiftCount === 0
    && s5.warnings.some((w) => /勤怠なし（0）として取り込みました。予定の働く日が \d+ 日あります/.test(w)) && J(s5.imported) === J({ source: 'none', id: 'mi-sQ5' }), s5);
  t('要確認の一覧に取り込んだ人が出ない（丁は打刻どおりで要確認なし）', C.reviewList(m).length === 0, C.reviewList(m).slice(0, 3));
  t('取り込んだ人の塊は確認済み・取り込みの印・日の一覧はそのまま（打刻は作らない）', P(m, 'sQ1').days.length === P(base, 'sQ1').days.length && P(m, 'sQ1').days.every((d) => d.blocks.every((b) => b.checked && b.imported && !b.working && b.punches.length === 0)));
  t('取り込みの無い人（丁）の結果は、ほかの人の取り込みがあっても1バイトも変わらない', J(P(m, 'sQ4')) === J(P(base, 'sQ4')));
  t('月全体の合計は置き換えた後の値（総労働・要確認）', m.totals.workMin === VALS.sQ1.workMin + VALS.sQ2.workMin + VALS.sQ3.workMin + P(base, 'sQ4').sum.workMin && m.totals.reviewCount === 0, m.totals);
  const other = calc(staffWith({ sQ1: Object.assign(MI('sQ1'), { ym: '2026-11' }) }));
  const core = (mm) => J({ people: mm.people.map((p) => ({ sid: p.staff.staff_id, days: p.days, sum: p.sum })), totals: mm.totals });   /* staff の行は渡した行のまま（month_import の鍵も見える）なので比べない */
  t('別の月分の取り込み（ym が違う）は使わない＝取り込みの無い時と日・合計・月の合計が1バイトも同じ', core(other) === core(base));
  const broken = calc(staffWith({ sQ1: Object.assign(MI('sQ1'), { vals: Object.assign({}, VALS.sQ1, { workMin: 1 }) }), sQ2: Object.assign(MI('sQ2'), { source: 'excel' }), sQ3: 'x' }));
  t('形の違う取り込み（4つの和が合わない・知らない source・オブジェクトでない）は使わず、警告を出して要確認を残す（締めない側）',
    ['sQ1', 'sQ2', 'sQ3'].every((s) => P(broken, s).sum.reviewCount === P(base, s).sum.reviewCount && !P(broken, s).sum.imported && P(broken, s).sum.warnings.some((w) => /形か期間が違うため使っていません/.test(w))));
  const perOff = calc(staffWith({ sQ1: Object.assign(MI('sQ1'), { period: { from: '2026-12-01', to: '2026-12-31' } }), sQ2: Object.assign(MI('sQ2'), { period: undefined }) }));
  t('取り込んだ時の期間が今の期間と違う（締め日を変えた）・期間が無い取り込みは使わない（要確認が残る・警告）',
    ['sQ1', 'sQ2'].every((s0) => !P(perOff, s0).sum.imported && P(perOff, s0).sum.reviewCount === P(base, s0).sum.reviewCount && P(perOff, s0).sum.warnings.some((w) => /形か期間が違うため使っていません/.test(w))));
  const halfDay = calc(staffWith({ sQ1: Object.assign(MI('sQ1'), { vals: Object.assign({}, VALS.sQ1, { workDays: 20.5 }) }) }));
  t('勤務日数が整数でない取り込みも使わない（給与が整数に丸めるため・DB と同じ決まり）', !P(halfDay, 'sQ1').sum.imported && P(halfDay, 'sQ1').sum.reviewCount > 0);
  const snap = C.snapshotOf(m);
  t('締めの控え: 取り込んだ人の行だけに imported（取り込みの無い丁の行は今の形のまま）', J(snap.rows.find((r) => r.staff_id === 'sQ1').imported) === J({ source: 'freee_csv', id: 'mi-sQ1' })
    && !('imported' in snap.rows.find((r) => r.staff_id === 'sQ4')) && J(snap.rows.find((r) => r.staff_id === 'sQ4')) === J(C.snapshotOf(base).rows.find((r) => r.staff_id === 'sQ4')));
  /* 期間の末日に夜勤の予定があり、翌朝（まだ終わっていない）に締めの窓を開いても、取り込んだ人の塊は「まだ出勤していない」にしない */
  const lastNight = SCHED.concat([{ staff_id: 'sQ3', work_date: PER.to, seq: 2, office: 'facility', start_at: iso(PER.to, '22:00'), end_at: iso(addD(PER.to, 1), '07:00'), break_min: 60, kind: 'night', symbol: '夜', paid_min: 0 }]);
  const early = C.computeMonth({ ym: YM, period: PER, staff: staffWith({ sQ3: MI('sQ3') }), schedule: lastNight, punches: [], days: [], config: CFG, now: Date.parse(addD(PER.to, 1) + 'T06:00:00+09:00') });
  t('末日の夜勤の翌朝: 取り込んだ人の塊に「勤務中」「まだ出勤していない」の印が残らない', P(early, 'sQ3').days.every((d) => d.blocks.every((b) => !b.working && b.flags.indexOf('not_in_yet') < 0 && b.flags.indexOf('working') < 0)));
}

console.log('\n— 4. 給与との通し（受入条件1） —');
{
  /* 給与の画面（payroll.js）を payroll_page_test.js と同じやり方で読む（DOM は偽物・通信なし） */
  const PJ = fs.readFileSync(path.join(ROOT, 'payroll.js'), 'utf8');
  const els = {};
  const el = () => ({ hidden: true, textContent: '', value: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {} });
  const doc = { getElementById: (id) => (els[id] = els[id] || el()), addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], body: { classList: { contains: () => false } } };
  const store = { su_device_role: 'field' };
  const win = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, addEventListener() {}, document: doc };
  win.window = win;
  vm.runInNewContext(PJ, Object.assign(win, { setInterval() {}, setTimeout() {}, clearTimeout() {}, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN, isFinite, parseInt }));
  const PT = win.__payrollTest;
  t('payroll.js の attFromKintai・attSame を読めた', !!(PT && PT.attFromKintai && PT.attSame));
  /* freee の CSV（API の名前の見出し）→ 読む → 突き合わせ（画面と同じ職員の一覧） */
  const srcOf = (v) => ({ work_days: v.workDays, total_work_mins: v.workMin, total_normal_work_mins: v.schedInMin, total_overtime_within_statutory_work_mins: v.legalInOverMin,
    total_overtime_except_normal_work_mins: v.legalInOverMin + v.legalOverMin, total_holiday_work_mins: v.holidayMin, total_latenight_work_mins: v.nightMin, num_absences: v.absentDays,
    total_lateness_and_early_leaving_mins: v.lateMin, num_paid_holidays: v.paidDays });
  const csv = F.toCanonicalCsv([{ code: '9901', src: srcOf(VALS.sQ1) }, { code: '9902', src: srcOf(VALS.sQ2) }, { code: '9903', src: srcOf(VALS.sQ3) }]);
  const before = calc(staffWith({}));
  const list = before.people.map((p) => ({ staff_id: p.staff.staff_id, emp_code: p.staff.emp_code, schedDays: p.days.filter((d) => d.schedWorkMin > 0).length }));
  const ti = F.toImport(F.parseFreeeMonthCsv(csv).rows, list);
  t('取り込む3人・取り込まない 0・freee に無い職員は丁と戊', ti.ok.length === 3 && ti.refused.length === 0 && J(ti.missingStaff.sort()) === J(['sQ4', 'sQ5']), ti);
  /* DB（0123）がする形: kintai_month_get の staff の行に month_import（{id, ym, vals, source, created_at}）・staff の並びは staff_id 順 */
  const dbStaff = STAFF.slice().sort((a, b) => (a.staff_id < b.staff_id ? -1 : 1)).map((s) => {
    const o = ti.ok.find((x) => x.staff_id === s.staff_id);
    if (o) return Object.assign({}, s, { month_import: { id: 'mi-' + s.staff_id, ym: YM, period: { from: PER.from, to: PER.to }, vals: o.vals, source: 'freee_csv', created_at: '2026-12-16T10:00:00+09:00' } });
    /* 戊は画面で「この月は勤怠なし（0）として取り込む」を選んだ人（丁は freee に無いが打刻があるので選ばない） */
    if (s.staff_id === 'sQ5') return Object.assign({}, s, { month_import: { id: 'mi-sQ5', ym: YM, period: { from: PER.from, to: PER.to }, vals: F.zeroVals(), source: 'none', created_at: '2026-12-16T10:00:00+09:00' } });
    return Object.assign({}, s);
  });
  const monthGet = JSON.parse(JSON.stringify({ ok: true, period: PER, staff: dbStaff, schedule: SCHED, punches: PUN, days: [], leave_uses: LEAVE, absences: ABS, settings: { config: { legal_holiday: 0, hourlyPaidLeave: true } } }));
  /* 締める側（kintai.js の recompute と同じ: 設定＋シフトの休憩の決まり・並びは画面の並び（ここでは逆順）・今の時刻は期間の翌日） */
  const lockCfg = Object.assign({}, monthGet.settings.config, { breakThresholdH: 6, breakH: 1, nightBreakH: 2 });
  const atLock = C.computeMonth({ ym: YM, period: monthGet.period, staff: monthGet.staff.slice().reverse(), schedule: monthGet.schedule, punches: monthGet.punches, days: monthGet.days, leave_uses: monthGet.leave_uses, config: lockCfg, absences: monthGet.absences, lockedAt: null, now: NOW_LOCK });
  t('締める時: 要確認 0（受入条件2）', atLock.totals.reviewCount === 0, atLock.people.filter((p) => p.sum.reviewCount).map((p) => p.staff.staff_id));
  const snapshot = JSON.parse(JSON.stringify(C.snapshotOf(atLock)));   /* kintai_month_lock に送って DB に残る控え（JSON の1往復） */
  t('控え: 要確認の残る行が無い（DB の 0120 の締めが断らない）', snapshot.rows.every((r) => r.reviewCount === 0));
  /* 給与の側（payroll.js の verifyKintai と同じ数え直し: 月の読み出しの staff の並び・締めた時の設定・締めた時刻・別の今の時刻） */
  const lockedAt = '2026-12-16T10:05:00+09:00';
  const fresh = C.computeMonth({ ym: YM, period: monthGet.period, staff: monthGet.staff, schedule: monthGet.schedule, punches: monthGet.punches, days: monthGet.days,
    leave_uses: monthGet.leave_uses, config: snapshot.config, absences: monthGet.absences, lockedAt: lockedAt, now: Date.parse('2026-12-24T15:00:00+09:00') });
  const fr = {}, sv = {};
  C.snapshotOf(fresh).rows.forEach((r) => { fr[r.staff_id] = PT.attFromKintai(r); });
  snapshot.rows.forEach((r) => { sv[r.staff_id] = PT.attFromKintai(r); });
  const same = STAFF.map((s) => s.staff_id).filter((sid) => fr[sid] && sv[sid] && PT.attSame(fr[sid], sv[sid]));
  t('verifyKintai の照合: 5人とも控えと数え直しが同じ（ok）', same.length === 5, STAFF.map((s) => s.staff_id).filter((sid) => same.indexOf(sid) < 0));
  /* 給与の下書きの保存の入力（attFromKintai）が freee の値と同じ（仕様の表） */
  ['sQ1', 'sQ2', 'sQ3'].forEach((sid) => {
    const a = sv[sid], v = VALS[sid];
    t(sid + ': att が仕様の表どおり（表の鍵＝freee の値・paidMin 0・earlyLeaveMin 0・reviewCount 0・欠けた鍵なし）', a.missing.length === 0 && Object.keys(v).every((k) => a[k] === v[k]) && a.paidMin === 0 && a.earlyLeaveMin === 0 && a.reviewCount === 0
      && a.hourlyPaidMin === 0 && a.specialPaidMin === 0 && a.holidayWorkDays === 0, Object.keys(v).filter((k) => a[k] !== v[k]).concat(a.missing));
  });
  t('丙: att の夜勤の回数と記号の回数は予定から（夜勤手当・回数の手当の入力）', sv.sQ3.nightShiftCount === nNight && sv.sQ3.counts['夜'] === nNight, [sv.sQ3.nightShiftCount, sv.sQ3.counts]);
  t('丁（取り込みなし）: att は打刻どおり（総労働＝平日×8時間）', sv.sQ4.workMin === nWork('sQ4') * 480 && sv.sQ4.reviewCount === 0, sv.sQ4.workMin);
  /* 取り込みを取り消した後（DB が month_import を返さない）は控えと食い違う＝給与の照合が止まる側 */
  const voided = JSON.parse(JSON.stringify(monthGet)); voided.staff.forEach((s) => { delete s.month_import; });
  const fr2 = C.computeMonth({ ym: YM, period: voided.period, staff: voided.staff, schedule: voided.schedule, punches: voided.punches, days: voided.days, leave_uses: voided.leave_uses, config: snapshot.config, absences: voided.absences, lockedAt: lockedAt, now: Date.now() });
  const ng = C.snapshotOf(fr2).rows.filter((r) => !PT.attSame(PT.attFromKintai(r), sv[r.staff_id])).map((r) => r.staff_id).sort();
  t('取り込みが無くなった月を数え直すと、取り込んだ4人（勤怠なしの戊も）が控えと食い違う（給与は止まる側）', J(ng) === J(['sQ1', 'sQ2', 'sQ3', 'sQ5']), ng);
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
