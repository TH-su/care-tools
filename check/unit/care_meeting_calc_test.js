/* 担当者会議の記録（care-meeting-calc.js）の純関数の試験（2026-10-23）
   実行: node check/unit/care_meeting_calc_test.js（環境変数 CARE_MEETING_CALC で別の版を当てられる）
   守りたいこと:
     1. 「◆欄名：」の印だけで欄を分ける。本文の中の【CM】【施設】などの小見出しでは分けない
     2. 黙って捨てない（知らない欄・重なり・印より前の文章・印が無い時は知らせる）
     3. 日付・時刻・回数は形を確かめ、読めない時は空にして知らせる
     4. 利用者名が開いている方と合わなければ確定させない
     5. 期限の知らせは、確定・同意済みの会議だけを数える
   ★文章・氏名はすべて架空。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.CARE_MEETING_CALC || path.join(ROOT, 'care-meeting-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const FULL = [
  '◆利用者名：架空 太郎 様',
  '◆作成担当者：架空 花子',
  '◆作成年月日：2026/10/20',
  '◆開催日：2026年10月16日（金）',
  '◆開催場所：架空ホーム 相談室',
  '◆開催時間：14:00〜14:45',
  '◆開催回数：3回目',
  '◆出席者：',
  '・介護支援専門員／架空 花子',
  '・施設 介護職員／架空 一郎',
  '・訪問介護 サービス提供責任者／架空 二郎',
  '◆検討した項目：',
  '1. 夜間の排泄の支援',
  '2. 入浴の回数',
  '◆検討内容：',
  '【CM】夜間のトイレ誘導の時間を見直したい。',
  '【施設】2時と5時の誘導で失敗が減った。',
  '【家族】週2回の入浴を続けてほしい。',
  '◆結論：',
  '夜間の誘導を2時と5時にする。入浴は週2回を続ける。',
  '◆残された課題：',
  '日中の水分量の記録の付け方',
  '◆次回の開催時期：2027年4月ごろ（認定更新時）'
].join('\n');

console.log('\n— 1. 振り分けの基本 —');
{
  const r = C.parse(FULL);
  t('利用者名・作成担当者を欄に入れる', r.fields.residentName === '架空 太郎 様' && r.fields.author === '架空 花子', r.fields);
  t('日付を YYYY-MM-DD にそろえる（曜日のかっこは無視）', r.fields.createdDate === '2026-10-20' && r.fields.heldDate === '2026-10-16', r.fields);
  t('開催時間・開催回数をそろえる', r.fields.timeText === '14:00〜14:45' && r.fields.count === '3', r.fields);
  t('出席者を所属（職種）と氏名に分ける（3名）', r.attendees.length === 3 && r.attendees[2].role === '訪問介護 サービス提供責任者' && r.attendees[2].name === '架空 二郎', r.attendees);
  t('★本文の中の【CM】【施設】【家族】で欄を分けない（検討内容に3行とも入る）', r.fields.content.split('\n').length === 3 && /^【CM】/.test(r.fields.content) && /【家族】/.test(r.fields.content), r.fields.content);
  t('複数行の欄は行をそのまま残す', r.fields.items === '1. 夜間の排泄の支援\n2. 入浴の回数', r.fields.items);
  t('全欄が入れば知らせは無い', r.warns.length === 0 && r.missing.length === 0, r.warns.concat(r.missing));
}

console.log('\n— 2. 黙って捨てない —');
{
  const u = C.parse('◆開催日：2026/10/16\n◆感想：とても良い会議だった\n◆結論：続ける');
  t('★知らない欄はどの欄にも入れず、知らせと一緒に返す', !('感想' in u.fields) && u.unknown.length === 1 && u.unknown[0].text === 'とても良い会議だった' && u.warns.some(w => /知らない欄「感想」/.test(w)), u);
  t('知らない欄の後ろの本文を、前の欄へ混ぜない', u.fields.heldDate === '2026-10-16' && u.fields.conclusion === '続ける', u.fields);
  const d = C.parse('◆結論：一つ目\n◆結論：二つ目');
  t('★同じ欄が2回ある時は、つなげて入れて知らせる', d.fields.conclusion === '一つ目\n二つ目' && d.warns.some(w => /2回あります/.test(w)), d);
  const p = C.parse('今日の会議のまとめです。\n◆結論：続ける');
  t('★最初の印より前の文章は、知らせと一緒に返す', p.preamble === '今日の会議のまとめです。' && p.warns.some(w => /より前に文章/.test(w)), p);
  const n = C.parse('会議のメモ。印はありません。');
  t('★印が1つも無い時は、知らせて何も入れない', Object.keys(n.fields).length === 0 && n.warns.some(w => /印が見つかりません/.test(w)), n);
  const m = C.parse('◆結論：続ける');
  t('入っていない欄を missing で返す', m.missing.indexOf('heldDate') >= 0 && m.missing.indexOf('attendees') >= 0 && m.missing.indexOf('conclusion') < 0, m.missing);
  const a = C.parse('◆会議出席者：\n看護師／架空 三郎\n◆検討項目：入浴');
  t('別の呼び方（会議出席者・検討項目）も同じ欄に入れる', a.attendees.length === 1 && a.fields.items === '入浴', a);
  const h = C.parse('◆検討内容\n【CM】本文の1行目');
  t('コロンの無い印の行も欄名として読む', h.fields.content === '【CM】本文の1行目', h.fields);
  const w = C.parse('◇結論：続ける');
  t('◇ の印も読む', w.fields.conclusion === '続ける', w.fields);
  const big = C.parse('◆結論：' + 'あ'.repeat(3001));
  t('上限を超える欄は知らせる', big.warns.some(x => /3000 字を超えています/.test(x)), big.warns);
}

console.log('\n— 3. 日付・時刻・回数の形 —');
{
  const cases = [['2026/10/23', '2026-10-23'], ['2026-10-23', '2026-10-23'], ['2026年10月3日', '2026-10-03'], ['令和8年10月23日', '2026-10-23'],
    ['R8.10.23', '2026-10-23'], ['令和元年5月1日', '2019-05-01'], ['２０２６／１０／２３', '2026-10-23'], ['2026/02/30', ''], ['2026/13/01', ''], ['10月23日', ''], ['', '']];
  cases.forEach(([i, o]) => t('日付「' + i + '」→「' + o + '」', C.normDate(i) === o, C.normDate(i)));
  const tm = C.normTime('14時〜15時30分');
  t('時刻「14時〜15時30分」→ 14:00〜15:30', tm && tm.text === '14:00〜15:30', tm);
  t('時刻「9:05-10:00」→ 09:05〜10:00', (C.normTime('9:05-10:00') || {}).text === '09:05〜10:00');
  t('時刻が1つだけでも読む', (C.normTime('14:00') || {}).text === '14:00');
  t('★終わりが始まりより前の時刻は読まない', C.normTime('15:00〜14:00') === null);
  t('★あり得ない時刻は読まない', C.normTime('25:00〜26:00') === null && C.normTime('14:75') === null);
  t('回数「3回目」「第3回」「3」→ 3', C.normCount('3回目') === '3' && C.normCount('第3回') === '3' && C.normCount('３') === '3');
  t('回数が読めない時は空', C.normCount('毎月') === '' && C.normCount('0') === '');
  const r = C.parse('◆開催日：来週の金曜\n◆開催時間：午後\n◆開催回数：たぶん3回');
  t('★読めない日付・時刻・回数は空にして知らせ、元の文字は raw に残す', r.fields.heldDate === '' && r.fields.timeText === '' && r.fields.count === '' && r.warns.length === 3 && r.raw.heldDate === '来週の金曜', r);
}

console.log('\n— 4. 出席者 —');
{
  const a = C.parseAttendees('1. 看護師／架空 一郎\n2）介護職員 / 架空 二郎\n● 家族：架空 三子\n\n架空 四郎');
  t('番号・記号を外し、／・/・：で分ける', a.list.length === 4 && a.list[0].role === '看護師' && a.list[1].name === '架空 二郎' && a.list[2].role === '家族', a.list);
  t('★所属（職種）の無い人は知らせる（氏名は残す）', a.list[3].name === '架空 四郎' && a.list[3].role === '' && a.warns.some(w => /所属（職種）がありません/.test(w)), a);
  const ten = C.parseAttendees(Array.from({ length: 10 }, (_, i) => '職種' + i + '／架空 ' + i).join('\n'));
  t('9名を超えると、印刷の表に入らないことを知らせる（保存はする）', ten.list.length === 10 && ten.warns.some(w => /印刷の表に入るのは 9 名まで/.test(w)), ten.warns);
  const many = C.parseAttendees(Array.from({ length: 22 }, (_, i) => '職種／架空 ' + i).join('\n'));
  t('★20名を超える分は保存しないことを知らせる', many.list.length === 20 && many.warns.some(w => /20 名まで/.test(w)), many.warns);
}

console.log('\n— 5. 利用者名の照らし合わせ —');
{
  t('空白・「様」の違いは同じとみなす', C.residentMatch('架空 太郎 様', { name: '架空太郎' }).ok === true);
  t('全角・半角の空白も同じとみなす', C.residentMatch('架空　太郎', { name: '架空 太郎' }).ok === true);
  t('★別の名前は一致にしない', C.residentMatch('架空 次郎', { name: '架空 太郎' }).reason === 'mismatch');
  t('★1字違い（前後に字が足りない）も一致にしない', C.residentMatch('架空 太', { name: '架空 太郎' }).ok === false);
  t('文章に利用者名が無い時は empty', C.residentMatch('', { name: '架空 太郎' }).reason === 'empty');
}

console.log('\n— 6. 確定できるか —');
{
  const ok = { heldDate: '2026-10-16', attendees: [{ role: '看護師', name: '架空 一郎' }], items: '入浴', content: '本文', conclusion: '続ける', issues: 'なし', place: '相談室', createdDate: '2026-10-20' };
  const c0 = C.checkFinal(ok, { today: '2026-10-23', residentOk: true });
  t('全部そろえば確定できる', c0.stop === '' && c0.warns.length === 0, c0);
  const stopIf = (name, mut, ctx, re) => { const r = Object.assign({}, ok); mut(r); const c = C.checkFinal(r, Object.assign({ today: '2026-10-23', residentOk: true }, ctx || {})); t('★' + name, !!c.stop && re.test(c.stop), c.stop); };
  stopIf('利用者名が合わなければ確定しない', () => {}, { residentOk: false }, /利用者名/);
  stopIf('利用者名の確かめが無ければ確定しない', () => {}, { residentOk: undefined }, /利用者名/);
  stopIf('開催日が無ければ確定しない', r => { r.heldDate = ''; }, null, /開催日を入れて/);
  stopIf('開催日が今日より後なら確定しない', r => { r.heldDate = '2026-10-24'; }, null, /今日より後/);
  stopIf('出席者がいなければ確定しない', r => { r.attendees = [{ role: '看護師', name: ' ' }]; }, null, /出席者/);
  stopIf('検討した項目が空なら確定しない', r => { r.items = ' '; }, null, /検討した項目/);
  stopIf('検討内容が空なら確定しない', r => { r.content = ''; }, null, /検討内容/);
  stopIf('結論が空なら確定しない', r => { r.conclusion = ''; }, null, /結論/);
  stopIf('上限を超える欄があれば確定しない', r => { r.content = 'あ'.repeat(5001); }, null, /5000 字/);
  const w = C.checkFinal(Object.assign({}, ok, { issues: '', place: '', createdDate: '2026-10-01' }), { today: '2026-10-23', residentOk: true });
  t('残された課題・開催場所が空・作成日が開催日より前は、止めずに知らせる', w.stop === '' && w.warns.length === 3, w.warns);
}

console.log('\n— 7. 期限の知らせ —');
{
  const M = (d, s, del) => ({ heldDate: d, status: s || 'final', deleted: !!del });
  const kinds = a => a.map(x => x.kind).join(',');
  t('記録が無ければ「記録がありません」', kinds(C.dueAlerts({ today: '2026-10-23', meetings: [] })) === 'none');
  const a1 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-07-01')], careCertStart: '2026-09-01', careCertEnd: '2027-08-31' });
  t('★今の認定期間になってから会議が無ければ知らせる', kinds(a1) === 'certStart' && a1[0].level === 'high', a1);
  const a2 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-09-10')], careCertStart: '2026-09-01', careCertEnd: '2026-12-01' });
  t('★認定期間の終わりの60日前に入り、その間に会議が無ければ知らせる', kinds(a2) === 'certEnd' && /あと 39 日/.test(a2[0].text), a2);
  const a3 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-09-10'), M('2026-10-20')], careCertStart: '2026-09-01', careCertEnd: '2026-12-01' });
  t('その期間に会議があれば、終わりの知らせは出さない', kinds(a3) === '', a3);
  const a4 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-04-20')], careCertStart: '2026-04-01', careCertEnd: '2027-03-31' });
  t('★前回から6か月を過ぎたら知らせる', kinds(a4) === 'interval' && a4[0].level === 'high' && /2026-10-20/.test(a4[0].text), a4);
  const a5 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-05-10')], careCertStart: '2026-04-01', careCertEnd: '2027-03-31' });
  t('6か月まで30日を切ったら「間もなく」で知らせる', kinds(a5) === 'interval' && a5[0].level === 'mid' && /あと 18 日/.test(a5[0].text), a5);
  const a6 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-10-01', 'draft'), M('2026-10-02', 'final', true)], careCertStart: '2026-09-01' });
  t('★下書きと取り消した会議は数えない', kinds(a6) === 'certStart,none', a6);
  const a7 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-10-01', 'consented')], careCertStart: '2026-09-01', careCertEnd: '2026-10-01' });
  t('同意済みは数える・認定期間が終わっていれば知らせる', kinds(a7) === 'certEnded', a7);
  t('今日が読めなければ何も出さない（推測で出さない）', C.dueAlerts({ today: '', meetings: [] }).length === 0);
  const a8 = C.dueAlerts({ today: '2026-10-23', meetings: [M('2026-01-01')], careCertStart: '2026-09-01' });
  t('強い知らせ（high）を先に並べる', a8.length === 2 && a8[0].level === 'high' && a8[1].level === 'high', a8);
  t('月末の6か月後は、その月の末日にそろえる', C.addMonths('2026-08-31', 6) === '2027-02-28' && C.addMonths('2026-03-31', 6) === '2026-09-30');
  t('最終開催日は確定・同意済みのいちばん新しい日', C.lastHeld([M('2026-03-01'), M('2026-09-01', 'draft'), M('2026-06-01', 'consented')]) === '2026-06-01');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
