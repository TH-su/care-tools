/* 体重管理（weight-record.html）の「低栄養リスク」「測り直しの促し」「グラフの縦軸」の試験（2026-10-17・使いやすさの改善 第1・2弾）。
   守りたいこと:
     A グラフの縦軸は 0kg 起点にせず、その方の範囲に合わせる（幅は最低6kg・目安の線も範囲に入れる）
     B 低栄養リスクは厚労省の区切り（介護保険最新情報 Vol.1217）で出す。高＝1か月5%・3か月7.5%・6か月10%以上の減少、
       中＝どれかで3%以上の減少か BMI 18.5 未満。6か月で3〜5%減っても3kgに届かない人（今の注意・警告では出ない）を中として拾う
     C 測り直しは、前回の測定から 5%以上か 2.5kg以上 変わった時だけ促す。比べる相手は測定日より前の最新の記録（直している記録は除く）
     D 保存の3か所（1人ずつ・まとめて入力の1行・まとめて保存）、アラート（高リスクだけ）、一覧の絞り込みにつながっている
     E アラートの「確認した」：月と向きごとに残す。新しい月・注意から警告に上がったら確認済みにしない。壊れた値でも止まらない。
       タブの数字は未確認だけ。グラフに食事形態の変わり目の印をつなぐ
   実行: node check/unit/weight_risk_recheck_test.js（WEIGHT_HTML で別のファイルを当てられる）
   架空データのみ（氏名は使わない）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.WEIGHT_HTML || path.join(ROOT, 'weight-record.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h), q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(h, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
/* const 名前 = ... の宣言を、対応する括弧の終わりまで切り出す（複数行の矢印関数・オブジェクト用） */
function cutConst(src, name) {
  const h = src.indexOf('const ' + name + ' =');
  if (h < 0) throw new Error('宣言なし ' + name);
  let i = h, d = 0, started = false, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{' || c === '(') { d++; started = true; }
    else if (c === '}' || c === ')') { d--; }
    else if (c === ';' && started && d === 0) break;
    else if (c === '\n' && started && d === 0) break;
  }
  return 'var ' + src.slice(h + 6, i) + ';';
}
const box = { JSON, Math, Date, Number, String, Array, Object, Map, Set, console, isFinite, DB: { residents: [], records: [] } };
vm.createContext(box);
vm.runInContext([cutConst(SRC, 'ymPrev'), cutConst(SRC, 'ymFmt'), cutConst(SRC, 'DEFAULT_THR'), 'var THR = DEFAULT_THR;',
  'function residentById(id){ return DB.residents.find(r => r.id === id); }',
  /^const WR_RECHECK_PCT = .*$/m.exec(SRC)[0].replace('const ', 'var '),
  ...['bmiOf', 'wrWeightOk', 'wrYmOk', 'recDateKey', 'getRecord', 'getRecordsOf', 'wrCmpNote', 'wrCmpLabel', 'analyze',
    'computeYRange', 'wrRefLinesFor', 'wrNutritionRisk', 'wrPrevWeightRec', 'wrRecheckInfo', 'wrRecheckDesc', 'wrAckMap', 'wrAckOf', 'wrAckText'].map(n => cut(SRC, n))].join('\n'),
  box, { filename: 'weight-record(切り出し)' });

const rec = (ym, w, d) => ({ id: 'r-' + ym + (d || ''), residentId: 'p1', yearMonth: ym, measuredOn: ym + '-' + (d || '10'), weight: w, createdAt: 'c' });
const series = (pairs, heightCm) => { box.DB.residents = [{ id: 'p1', heightCm: heightCm == null ? 155 : heightCm }]; box.DB.records = pairs.map(([ym, w]) => rec(ym, w)); };
const M6 = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

console.log('\n— A. グラフの縦軸 —');
{
  const r = box.computeYRange([59.5, 58.2, 56.1, 54.1]);
  t('★0kg 起点にしない（その方の範囲）', r.min > 40 && r.max < 70 && r.min <= 54.1 && r.max >= 59.5, r);
  const s = box.computeYRange([50.0, 50.2, 50.1]);
  t('幅は最低 6kg（小さな揺れを大げさに見せない）', s.max - s.min >= 6, s);
  const u = box.computeYRange([50, 51], [45]);
  t('目安の線（45kg）も範囲に入れる', u.min <= 45, u);
  t('記録が無ければ null', box.computeYRange([]) === null);
  series(M6.map((m, i) => [m, 50 - i * 0.3]));
  const lines = box.wrRefLinesFor('p1');
  t('目安の線は 6か月前の体重・−3%・−10%', lines.length === 3 && lines[0].y === 50 && lines[1].y === 48.5 && lines[2].y === 45, lines.map(l => l.y));
}

console.log('\n— B. 低栄養リスク（厚労省の区切り） —');
{
  series(M6.map((m, i) => [m, [50, 49.7, 49.3, 49.0, 48.7, 48.3, 48.0][i]]));
  let r = box.wrNutritionRisk('p1', '2026-10');
  t('★6か月で4%減（50→48kg・2kg）は中リスク（今の注意・警告では出ない帯）', r.level === 'mid', r);
  t('  今の判定は「なし」のまま（注意・警告の基準は変えていない）', box.analyze('p1', '2026-10').level === 'none');
  series(M6.map((m, i) => [m, [50, 50, 50, 50, 50, 50, 49.0][i]]));
  r = box.wrNutritionRisk('p1', '2026-10');
  t('どの期間も3%未満なら低リスク', r.level === 'low', r);
  series([['2026-09', 50], ['2026-10', 47.4]]);
  r = box.wrNutritionRisk('p1', '2026-10');
  t('★1か月で5%以上（5.2%）は高リスク', r.level === 'high', r);
  series([['2026-07', 50], ['2026-08', 49], ['2026-09', 48], ['2026-10', 46.2]]);
  r = box.wrNutritionRisk('p1', '2026-10');
  t('3か月で7.5%以上（7.6%）は高リスク', r.level === 'high' && r.reasons.some(x => /3か月/.test(x)), r);
  series(M6.map((m, i) => [m, [50, 49.2, 48.4, 47.6, 46.8, 46.0, 45.0][i]]));
  r = box.wrNutritionRisk('p1', '2026-10');
  t('6か月で10%以上は高リスク', r.level === 'high', r);
  series([['2026-09', 40], ['2026-10', 40]], 155);
  r = box.wrNutritionRisk('p1', '2026-10');
  t('★BMI 18.5 未満（40kg・155cm＝16.6）は中リスク', r.level === 'mid' && r.reasons.some(x => /BMI/.test(x)), r);
  series([['2026-10', 50]], 0);   // 身長なし（0）
  r = box.wrNutritionRisk('p1', '2026-10');
  t('比べる記録も身長も無ければ判定できない（低と言わない）', r.level === null, r);
  series([['2026-04', 50], ['2026-10', 48.3]]);
  r = box.wrNutritionRisk('p1', '2026-10');
  t('比べる相手は暦の月（6か月前の4月と比べて3.4%減＝中）', r.level === 'mid' && r.reasons.some(x => /6か月/.test(x)), r);
  series([['2026-09', 50], ['2026-10', 53]]);
  r = box.wrNutritionRisk('p1', '2026-10');
  t('増えた時はリスクにしない', r.level === 'low', r);
}

console.log('\n— C. 測り直しの促し —');
{
  box.DB.records = [rec('2026-09', 50.0, '12'), rec('2026-08', 51.0, '10')];
  t('★2.5kg 以上（−2.6kg）で促す', !!box.wrRecheckInfo('p1', '2026-10-10', '2026-10', 47.4, null));
  t('2.4kg・4.8% では促さない', box.wrRecheckInfo('p1', '2026-10-10', '2026-10', 47.6, null) === null);
  box.DB.records = [rec('2026-09', 40.0, '12')];
  t('★5% 以上（40→38kg＝−5%・2kg）で促す（kg が小さくても）', !!box.wrRecheckInfo('p1', '2026-10-10', '2026-10', 38.0, null));
  t('増えた時も促す（+2.5kg）', !!box.wrRecheckInfo('p1', '2026-10-10', '2026-10', 42.5, null));
  box.DB.records = [rec('2026-09', 50.0, '12'), Object.assign(rec('2026-10', 45.0, '05'), { id: 'editing' })];
  const info = box.wrRecheckInfo('p1', '2026-10-20', '2026-10', 45.2, 'editing');
  t('★直している記録は比べる相手にしない（前回は 9/12 の 50.0kg）', info && info.prev.weight === 50.0, info && info.prev);
  t('測定日より後の記録とは比べない', box.wrRecheckInfo('p1', '2026-09-01', '2026-09', 45, null) === null);
  t('前回が無ければ促さない（初めての測定）', (box.DB.records = [], box.wrRecheckInfo('p1', '2026-10-10', '2026-10', 45, null) === null));
  box.DB.records = [rec('2026-09', 50.0, '12')];
  t('説明の文は「前回（9/12・50.0kg）から −3.0kg（−6.0%）」', box.wrRecheckDesc(box.wrRecheckInfo('p1', '2026-10-10', '2026-10', 47.0, null)) === '前回（9/12・50.0kg）から -3.0kg（-6.0%）');
}

console.log('\n— D. つなぎ込み —');
{
  const body = (name) => cut(SRC, name);
  const inSave = SRC.slice(SRC.indexOf("$('#inSave').addEventListener('click'"), SRC.indexOf("$('#inSave').addEventListener('click'") + 6000);
  t('1人ずつの保存で確かめ、印を残す', /wrRecheckInfo\(rid, d, ym/.test(inSave) && /savedRec\.recheck = 'confirmed'/.test(inSave));
  t('まとめて入力の1行保存で確かめ、印を残す', /wrRecheckInfo\(rid, date, ym, weight/.test(body('saveSingleBulkRow')) && /rec\.recheck = 'confirmed'/.test(body('saveSingleBulkRow')));
  t('まとめて保存は大きく変わった行をまとめて1回だけ確かめる（キャンセルなら何も保存しない）', /if\(rcLines\.length && !wrRecheckConfirm\(rcLines\)\) return;/.test(body('bulkSave')) && /recheckRows\.has\(row\)/.test(body('bulkSave')));
  t('★アラートに上げるのは高リスクだけ（中は上げない）', /rk\.level === 'high'/.test(body('collectAlerts')) && !/rk\.level === 'mid'/.test(body('collectAlerts')));
  t('注意・警告の基準を変えていても高リスクは拾う', /a\.level==='none' && !\(rkAl && rkAl\.level === 'high'\)/.test(body('collectAlerts')));
  t('一覧に「低栄養リスク」の絞り込みがある', /data-f="risk"/.test(SRC) && /listFilter==='risk'/.test(SRC));
  t('履歴に「測り直し済み」の印を出す', /r\.recheck === 'confirmed'/.test(body('drawHist')));
}

console.log('\n— E. アラートの確認・食事形態の印 —');
{
  const r = { alertAck: JSON.stringify({ '2026-10|dn': { lv: 'w', by: 'staff-a', at: '2026-10-17T01:00:00Z', act: '医師・看護師へ連絡', note: '' } }) };
  t('★同じ月・同じ向き・注意のまま → 確認済み', !!box.wrAckOf(r, '2026-10', 'dn', 'w'));
  t('★注意で確認した後に警告へ上がった → 確認済みにしない', box.wrAckOf(r, '2026-10', 'dn', 'ng') === null);
  t('新しい月 → 確認済みにしない', box.wrAckOf(r, '2026-11', 'dn', 'w') === null);
  t('逆の向き（増加）→ 確認済みにしない', box.wrAckOf(r, '2026-10', 'up', 'w') === null);
  t('壊れた値・空でも止まらない', box.wrAckOf({ alertAck: '{壊れ' }, '2026-10', 'dn', 'w') === null && box.wrAckOf({}, '2026-10', 'dn', 'w') === null);
  t('確認の文に誰が・何をしたかが出る', /staff-a：医師・看護師へ連絡/.test(box.wrAckText(box.wrAckOf(r, '2026-10', 'dn', 'w'))));
  t('タブの数字は未確認だけを数える', /filter\(x=> !wrAckOf\(/.test(cut(SRC, 'updateAlertBadge')));
  t('確認は alertAck だけを部分送信する', /pushResidentFields_\(r, \['alertAck'\]\)/.test(cut(SRC, 'wrSetAck')));
  t('グラフに食事形態の変わり目の印をつなぐ', /plugins:\[wrRefLinePlugin, wrMealMarkPlugin\]/.test(SRC) && /wrMealMarks: mealMarks/.test(SRC));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
