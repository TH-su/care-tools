/* 担当者会議の記録（care-meeting-calc.js）の純関数の試験（2026-10-23）
   実行: node check/unit/care_meeting_calc_test.js（環境変数 CARE_MEETING_CALC で別の版を当てられる）
   守りたいこと:
     1. 「◆欄名：」の印だけで欄を分ける。本文の中の【CM】【施設】などの小見出し・一語の呼び方では分けない
     2. 黙って捨てない（知らない印・もう出た欄の印は今の欄の本文に残して知らせる。印より前の文章・印が無い時も知らせる）
     3. 日付・時刻・回数・開催の理由は形を確かめ、読めない時は空にして知らせる
     4. 利用者名が開いている方と合わない・同じ名前の方が2人いる時は確定させない
     5. 上限を超える欄・出席者は切り詰めない（保存の前に止める）
     6. 期限の知らせは確定した会議だけを数える。認定の始まりは30日前から数える。退院・区分変更・入院中も知らせる
     8. 印の無い議事録は見出しから欄の候補を出すだけで、人が選んだ候補だけを欄へ入れる。どの行も捨てない（2026-11-13）
   ★文章・氏名はすべて架空。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.CARE_MEETING_CALC || path.join(ROOT, 'care-meeting-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const FULL = [
  '◆利用者名：架空 太郎 様',
  '◆開催の理由：認定の更新',
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
  t('利用者名（議事録の名前）・作成担当者を欄に入れる', r.fields.sourceName === '架空 太郎 様' && r.fields.author === '架空 花子', r.fields);
  t('開催の理由を入れる', r.fields.kind === '認定の更新', r.fields);
  t('日付を YYYY-MM-DD にそろえる（曜日のかっこは無視）', r.fields.createdDate === '2026-10-20' && r.fields.heldDate === '2026-10-16', r.fields);
  t('開催時間・開催回数をそろえる', r.fields.timeText === '14:00〜14:45' && r.fields.count === '3', r.fields);
  t('出席者を所属（職種）と氏名に分ける（3名）', r.attendees.length === 3 && r.attendees[2].role === '訪問介護 サービス提供責任者' && r.attendees[2].name === '架空 二郎', r.attendees);
  t('★本文の中の【CM】【施設】【家族】で欄を分けない（検討内容に3行とも入る）', r.fields.content.split('\n').length === 3 && /^【CM】/.test(r.fields.content) && /【家族】/.test(r.fields.content), r.fields.content);
  t('複数行の欄は行をそのまま残す', r.fields.items === '1. 夜間の排泄の支援\n2. 入浴の回数', r.fields.items);
  t('全欄が入れば知らせは無い', r.warns.length === 0 && r.missing.length === 0, r.warns.concat(r.missing));
  const nk = C.parse(FULL.replace('◆開催の理由：認定の更新\n', ''));
  t('開催の理由の行は無くてもよい（知らせない）', nk.warns.length === 0 && nk.missing.length === 0 && nk.fields.kind === undefined, nk.warns.concat(nk.missing));
}

console.log('\n— 2. 黙って捨てない —');
{
  const u = C.parse('◆開催日：2026/10/16\n◆検討内容：本文\n◆感想：とても良い会議だった\n◆結論：続ける');
  t('★知らない印は区切りにせず、今の欄の本文のまま残す', u.fields.content === '本文\n◆感想：とても良い会議だった' && !('感想' in u.fields), u.fields);
  t('★知らない印は、どの欄の中にあったかを添えて知らせる', u.unknown.length === 1 && u.unknown[0].label === '感想' && u.unknown[0].in === 'content' && u.warns.some(w => /「検討内容」の中に知らない印「感想」/.test(w)), u);
  t('知らない印の後ろの印は、普通に欄を分ける', u.fields.heldDate === '2026-10-16' && u.fields.conclusion === '続ける', u.fields);
  const d = C.parse('◆結論：一つ目\n◆残された課題：なし\n◆結論：二つ目');
  t('★もう出た欄の印は、今の欄の本文のまま残して知らせる（前の欄を書き換えない）', d.fields.conclusion === '一つ目' && d.fields.issues === 'なし\n◆結論：二つ目' && d.warns.some(w => /「残された課題」の中にもう一度「結論」/.test(w)), d);
  const p = C.parse('今日の会議のまとめです。\n◆結論：続ける');
  t('★最初の印より前の文章は、知らせと一緒に返す', p.preamble === '今日の会議のまとめです。' && p.warns.some(w => /より前に文章/.test(w)), p);
  const pu = C.parse('◆感想：はじめに\n◆結論：続ける');
  t('★最初の印が知らない印なら、印より前の文章として返す', pu.preamble === '◆感想：はじめに' && pu.fields.conclusion === '続ける' && pu.unknown[0].in === '', pu);
  const n = C.parse('会議のメモ。印はありません。');
  t('★印が1つも無い時は、知らせて何も入れない', Object.keys(n.fields).length === 0 && n.warns.some(w => /印が見つかりません/.test(w)), n);
  const m = C.parse('◆結論：続ける');
  t('入っていない欄を missing で返す', m.missing.indexOf('heldDate') >= 0 && m.missing.indexOf('attendees') >= 0 && m.missing.indexOf('conclusion') < 0, m.missing);
  const e = C.parse('◆結論：\n◆検討内容：本文\n◆開催日：来週');
  t('★印はあるが中身が空の欄・読めずに空にした欄も missing に入れる', e.missing.indexOf('conclusion') >= 0 && e.missing.indexOf('heldDate') >= 0 && e.missing.indexOf('content') < 0, e.missing);
  const a = C.parse('◆会議出席者：\n看護師／架空 三郎\n◆検討項目：入浴');
  t('別の呼び方（会議出席者・検討項目）も同じ欄に入れる', a.attendees.length === 1 && a.fields.items === '入浴', a);
  const one = C.parse('◆検討内容：本文\n◆場所：居室で\n◆時間：10分\n◆次回：様子を見る');
  t('★一語の呼び方（場所・時間・次回）では欄を分けない（本文に残す）', one.fields.content === '本文\n◆場所：居室で\n◆時間：10分\n◆次回：様子を見る' && one.fields.place === undefined && one.fields.nextText === undefined, one.fields);
  const h = C.parse('◆検討内容\n【CM】本文の1行目');
  t('コロンの無い印の行も欄名として読む', h.fields.content === '【CM】本文の1行目', h.fields);
  const w = C.parse('◇結論：続ける');
  t('◇ の印も読む', w.fields.conclusion === '続ける', w.fields);
  const md = C.parse('## ◆開催日：2026/10/16\n**◆結論：** 続ける\n- ◆残された課題：なし\n◆**検討内容**：本文\n> ◆開催場所：相談室');
  t('★Markdown の飾り（# ** - > と欄名の太字）が付いた印も読む', md.fields.heldDate === '2026-10-16' && md.fields.conclusion === '続ける' && md.fields.issues === 'なし' && md.fields.content === '本文' && md.fields.place === '相談室', md.fields);
  const star = C.parse('◆検討内容：本文\n' + '*'.repeat(5000) + 'x');
  t('★飾りの記号が長く続く行でも止まらずに読む', star.fields.content.length > 5000);
  const big = C.parse('◆結論：' + 'あ'.repeat(3001));
  t('上限を超える欄は知らせる（切り詰めない）', big.warns.some(x => /3000 字を超えています/.test(x)) && big.fields.conclusion.length === 3001, big.warns);
  const huge = C.parse('◆結論：' + 'あ'.repeat(30001));
  t('★貼り付けが3万字を超える時は振り分けずに知らせる', huge.tooLong === true && Object.keys(huge.fields).length === 0 && huge.warns.some(x => /30000 字を超えています/.test(x)), huge.warns);
}

console.log('\n— 3. 日付・時刻・回数・開催の理由の形 —');
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
  const kinds = [['新規', '新規'], ['認定の更新', '認定の更新'], ['更新認定に伴う会議', '認定の更新'], ['区分変更申請', '区分変更'], ['退院／退所', '退院・退所'],
    ['退院時カンファレンス', '退院・退所'], ['入居時', '新規'], ['ADLの低下', '状態の変化'], ['その他', 'その他']];
  kinds.forEach(([i, o]) => t('開催の理由「' + i + '」→「' + o + '」', C.normKind(i).kind === o, C.normKind(i)));
  t('★2つ以上に当てはまる理由は決めない（退院に伴う状態の変化）', C.normKind('退院に伴う状態の変化').kind === '' && C.normKind('退院に伴う状態の変化').hits.length === 2);
  t('「認定更新」「区分の変更」も読む', C.normKind('認定更新').kind === '認定の更新' && C.normKind('介護度の区分の変更').kind === '区分変更');
  t('★「要介護状態区分の変更」は区分変更と状態の変化の両方に当たるので決めない', C.normKind('要介護状態区分の変更').kind === '' && C.normKind('要介護状態区分の変更').hits.join() === '区分変更,状態の変化', C.normKind('要介護状態区分の変更'));
  t('★「認定」の語の無い「更新」（ケアプランの更新・目標の期間の更新）は認定の更新にしない', C.normKind('ケアプランの更新').kind === '' && C.normKind('短期目標の期間の更新').kind === '', [C.normKind('ケアプランの更新'), C.normKind('短期目標の期間の更新')]);
  const k1 = C.parse('◆開催の理由：退院に伴う状態の変化');
  t('★決められない理由は空にして、候補を添えて知らせる', k1.fields.kind === '' && k1.raw.kind === '退院に伴う状態の変化' && k1.warns.some(w => /2つ以上に当てはまります（退院・退所・状態の変化）/.test(w)), k1);
  const k2 = C.parse('◆開催の理由：定例');
  t('★当てはまらない理由は空にして知らせる', k2.fields.kind === '' && k2.warns.some(w => /当てはめられません/.test(w)), k2);
  t('別の呼び方（開催理由）も同じ欄に入れる', C.parse('◆開催理由：区分変更').fields.kind === '区分変更');
}

console.log('\n— 4. 出席者 —');
{
  const a = C.parseAttendees('1. 看護師／架空 一郎\n2）介護職員 / 架空 二郎\n● 家族：架空 三子\n\n架空 四郎');
  t('番号・記号を外し、／・/・：で分ける', a.list.length === 4 && a.list[0].role === '看護師' && a.list[1].name === '架空 二郎' && a.list[2].role === '家族', a.list);
  t('★所属（職種）の無い人は知らせる（氏名は残す）', a.list[3].name === '架空 四郎' && a.list[3].role === '' && a.warns.some(w => /所属（職種）がありません/.test(w)), a);
  const ten = C.parseAttendees(Array.from({ length: 10 }, (_, i) => '職種' + i + '／架空 ' + i).join('\n'));
  t('9名を超えると、印刷の表に入らないことを知らせる（保存はする）', ten.list.length === 10 && ten.warns.some(w => /印刷の表に入るのは 9 名まで/.test(w)), ten.warns);
  const many = C.parseAttendees(Array.from({ length: 22 }, (_, i) => '職種／架空 ' + i).join('\n'));
  t('★20名を超える時は切り詰めずに知らせる', many.list.length === 22 && many.warns.some(w => /20 名まで/.test(w)), many.warns);
  const long = C.parseAttendees('職種／' + 'あ'.repeat(41));
  t('★40字を超える氏名は切り詰めずに知らせる', long.list[0].name.length === 41 && long.warns.some(w => /40 字を超えています/.test(w)), long);
}

console.log('\n— 5. 利用者名の照らし合わせ —');
{
  t('空白・「様」の違いは同じとみなす', C.residentMatch('架空 太郎 様', { name: '架空太郎' }).ok === true);
  t('全角・半角の空白も同じとみなす', C.residentMatch('架空　太郎', { name: '架空 太郎' }).ok === true);
  t('★別の名前は一致にしない', C.residentMatch('架空 次郎', { name: '架空 太郎' }).reason === 'mismatch');
  t('★1字違い（前後に字が足りない）も一致にしない', C.residentMatch('架空 太', { name: '架空 太郎' }).ok === false);
  t('文章に利用者名が無い時は empty', C.residentMatch('', { name: '架空 太郎' }).reason === 'empty');
  const roster = [{ name: '架空 太郎' }, { name: '架空 次郎' }, { name: '架空　太郎' }];
  const dp = C.residentMatch('架空 太郎', { name: '架空 太郎' }, roster);
  t('★同じ名前の方が名簿に2人いる時は一致にしない（どちらの方か分からない）', dp.ok === false && dp.reason === 'dupe' && dp.dupes === 2, dp);
  t('名簿に1人だけなら一致にする', C.residentMatch('架空 次郎', { name: '架空 次郎' }, roster).ok === true);
}

console.log('\n— 6. 保存できるか・確定できるか —');
{
  const ok = { heldDate: '2026-10-16', attendees: [{ role: '看護師', name: '架空 一郎' }], items: '入浴', content: '本文', conclusion: '続ける', issues: 'なし', place: '相談室', createdDate: '2026-10-20', kind: '認定の更新' };
  const c0 = C.checkFinal(ok, { today: '2026-10-23', residentOk: true });
  t('全部そろえば確定できる', c0.stop === '' && c0.warns.length === 0, c0);
  const stopIf = (name, mut, ctx, re) => { const r = Object.assign({}, ok); mut(r); const c = C.checkFinal(r, Object.assign({ today: '2026-10-23', residentOk: true }, ctx || {})); t('★' + name, !!c.stop && re.test(c.stop), c.stop); };
  stopIf('利用者名が合わなければ確定しない', () => {}, { residentOk: false }, /利用者名/);
  stopIf('利用者名の確かめが無ければ確定しない', () => {}, { residentOk: undefined }, /利用者名/);
  stopIf('開催日が無ければ確定しない', r => { r.heldDate = ''; }, null, /開催日を入れて/);
  stopIf('開催日が今日より後なら確定しない', r => { r.heldDate = '2026-10-24'; }, null, /今日より後/);
  stopIf('今日の日付が読めなければ確定しない', () => {}, { today: '' }, /今日の日付/);
  stopIf('出席者がいなければ確定しない', r => { r.attendees = [{ role: '看護師', name: ' ' }]; }, null, /出席者/);
  stopIf('検討した項目が空なら確定しない', r => { r.items = ' '; }, null, /検討した項目/);
  stopIf('検討内容が空なら確定しない', r => { r.content = ''; }, null, /検討内容/);
  stopIf('結論が空なら確定しない', r => { r.conclusion = ''; }, null, /結論/);
  stopIf('上限を超える欄があれば確定しない', r => { r.content = 'あ'.repeat(5001); }, null, /5000 字/);
  stopIf('出席者の氏名が40字を超えれば確定しない', r => { r.attendees = [{ role: '看護師', name: 'あ'.repeat(41) }]; }, null, /40 字まで/);
  const w = C.checkFinal(Object.assign({}, ok, { issues: '', place: '', createdDate: '2026-10-01', kind: '' }), { today: '2026-10-23', residentOk: true });
  t('残された課題・開催場所・開催の理由が空・作成日が開催日より前は、止めずに知らせる', w.stop === '' && w.warns.length === 4, w.warns);
  t('下書きの保存は、中身が空でも止めない', C.checkSave({}).stop === '' && C.checkSave({ heldDate: '' }).stop === '');
  t('★保存の前に、上限を超える欄を止める（欄の名前を出す）', /「検討内容」が 5000 字/.test(C.checkSave({ content: 'あ'.repeat(5001) }).stop));
  t('★保存の前に、21名以上の出席者を止める', /20 名まで/.test(C.checkSave({ attendees: Array.from({ length: 21 }, () => ({ role: 'a', name: 'b' })) }).stop));
  t('★保存の前に、40字を超える出席者を止める', /40 字まで/.test(C.checkSave({ attendees: [{ role: 'あ'.repeat(41), name: 'b' }] }).stop));
  t('★保存の前に、表の形でない出席者を止める', /形が違います/.test(C.checkSave({ attendees: ['架空 一郎'] }).stop) && /形が違います/.test(C.checkSave({ attendees: '架空' }).stop) && /形が違います/.test(C.checkSave({ attendees: [['看護師', '架空 一郎']] }).stop));
  t('★保存の前に、決まりにない開催の理由を止める', /開催の理由/.test(C.checkSave({ kind: '定例' }).stop));
  t('★保存の前に、あり得ない日付を止める', /開催日の形/.test(C.checkSave({ heldDate: '2026-02-30' }).stop) && /作成年月日の形/.test(C.checkSave({ createdDate: '2026/10/20' }).stop));
}

console.log('\n— 7. 期限の知らせ —');
{
  const M = (d, s, del) => ({ heldDate: d, status: s || 'final', deleted: !!del });
  const kinds = a => a.map(x => x.kind).join(',');
  const T = '2026-10-23';
  t('記録が無ければ「記録がありません」', kinds(C.dueAlerts({ today: T, meetings: [] })) === 'none');
  const a1 = C.dueAlerts({ today: T, meetings: [M('2026-07-01')], careCertStart: '2026-09-01', careCertEnd: '2027-08-31' });
  t('★今の認定期間に向けた会議が無ければ知らせる（臨時の会議の理由は「認定の更新」）', kinds(a1) === 'certStart' && a1[0].level === 'high' && a1[0].reason === '認定の更新', a1);
  const a1b = C.dueAlerts({ today: T, meetings: [M('2026-08-05')], careCertStart: '2026-09-01', careCertEnd: '2027-08-31' });
  t('★認定の始まりの30日前より後の会議は、更新の会議として数える（代表者の決定）', kinds(a1b) === '', a1b);
  const a1c = C.dueAlerts({ today: T, meetings: [M('2026-08-01')], careCertStart: '2026-09-01', careCertEnd: '2027-08-31' });
  t('★始まりの31日前の会議は数えない（境目）', kinds(a1c) === 'certStart', a1c);
  const a1d = C.dueAlerts({ today: T, meetings: [M('2026-07-01')], careCertStart: '2026-11-10', careCertEnd: '2027-11-09' });
  t('★始まりが先の時は、30日前に入ってから「間もなく」で知らせる', kinds(a1d) === 'certStart' && a1d[0].level === 'mid', a1d);
  const a1e = C.dueAlerts({ today: T, meetings: [M('2026-07-01')], careCertStart: '2026-11-30', careCertEnd: '2027-11-29' });
  t('始まりの30日前より前なら、まだ知らせない', kinds(a1e) === '', a1e);
  const a2 = C.dueAlerts({ today: T, meetings: [M('2026-09-10')], careCertStart: '2026-09-01', careCertEnd: '2026-12-01' });
  t('★認定期間の終わりの60日前に入り、その間に会議が無ければ知らせる', kinds(a2) === 'certEnd' && /あと 39 日/.test(a2[0].text), a2);
  const a2b = C.dueAlerts({ today: T, meetings: [M('2026-09-10')], careCertStart: '2026-09-01', careCertEnd: '2026-12-22' });
  t('終わりのちょうど60日前から知らせる（境目）', kinds(a2b) === 'certEnd' && /あと 60 日/.test(a2b[0].text), a2b);
  const a3 = C.dueAlerts({ today: '2026-11-10', meetings: [M('2026-09-10'), M('2026-11-05')], careCertStart: '2026-09-01', careCertEnd: '2026-12-01' });
  t('次の認定の始まりの30日前より後に会議があれば、終わりの知らせは出さない', kinds(a3) === '', a3);
  const a3b = C.dueAlerts({ today: '2026-11-10', meetings: [M('2026-09-10'), M('2026-10-20')], careCertStart: '2026-09-01', careCertEnd: '2026-12-01' });
  t('★終わりの60日前に入っても、次の始まりの30日前より前の会議は更新の会議と数えない', kinds(a3b) === 'certEnd', a3b);
  const oldR = C.dueAlerts({ today: '2026-12-10', meetings: [M('2026-11-15')], careCertStart: '2026-01-01', careCertEnd: '2026-12-31' });
  const newR = C.dueAlerts({ today: '2026-12-10', meetings: [M('2026-11-15')], careCertStart: '2027-01-01', careCertEnd: '2027-12-31' });
  t('★名簿が前の認定のままでも、次の認定を入れた後でも、同じ会議の数え方で知らせる', kinds(oldR) === 'certEnd' && kinds(newR) === 'certStart', [oldR, newR]);
  const a4 = C.dueAlerts({ today: T, meetings: [M('2026-04-20')], careCertStart: '2026-04-01', careCertEnd: '2027-03-31' });
  t('★前回から6か月を過ぎたら知らせる', kinds(a4) === 'interval' && a4[0].level === 'high' && /過ぎています/.test(a4[0].text) && /2026-10-20/.test(a4[0].text), a4);
  const a4b = C.dueAlerts({ today: T, meetings: [M('2026-04-23')], careCertStart: '2026-04-01', careCertEnd: '2027-03-31' });
  t('★ちょうど6か月の日は「今日で6か月」と知らせる', kinds(a4b) === 'interval' && a4b[0].level === 'high' && /今日で 6 か月/.test(a4b[0].text), a4b);
  const a5 = C.dueAlerts({ today: T, meetings: [M('2026-05-10')], careCertStart: '2026-04-01', careCertEnd: '2027-03-31' });
  t('6か月まで30日を切ったら「間もなく」で知らせる', kinds(a5) === 'interval' && a5[0].level === 'mid' && /あと 18 日/.test(a5[0].text), a5);
  const a5b = C.dueAlerts({ today: T, meetings: [M('2026-05-23')], careCertStart: '2026-04-01', careCertEnd: '2027-03-31' });
  t('6か月まで31日あれば、まだ知らせない（境目）', kinds(a5b) === '', a5b);
  const a6 = C.dueAlerts({ today: T, meetings: [M('2026-10-01', 'draft'), M('2026-10-02', 'final', true)], careCertStart: '2026-09-01' });
  t('★下書きと取り消した会議は数えない', kinds(a6) === 'certStart,none', a6);
  const a7 = C.dueAlerts({ today: T, meetings: [M('2026-10-01', 'consented')], careCertStart: '2026-09-01', careCertEnd: '2026-10-01' });
  t('★確定のほかの状態（以前の「同意済み」など）は数えない', kinds(a7) === 'certStart,certEnded,none', a7);
  t('今日が読めなければ何も出さない（推測で出さない）', C.dueAlerts({ today: '', meetings: [] }).length === 0 && C.dueAlerts({ today: '2026-02-30', meetings: [] }).length === 0);
  const a8 = C.dueAlerts({ today: T, meetings: [M('2026-01-01')], careCertStart: '2026-09-01' });
  t('強い知らせ（high）を先に並べる', a8.length === 2 && a8[0].level === 'high' && a8[1].level === 'high', a8);
  t('月末の6か月後は、その月の末日にそろえる（うるう年も）', C.addMonths('2026-08-31', 6) === '2027-02-28' && C.addMonths('2026-03-31', 6) === '2026-09-30' && C.addMonths('2027-08-31', 6) === '2028-02-29');
  t('最終開催日は確定のいちばん新しい日', C.lastHeld([M('2026-03-01'), M('2026-09-01', 'draft'), M('2026-06-01')]) === '2026-06-01');
  /* 臨時の会議（区分変更・退院・入院中） */
  const LOG = (...xs) => xs.map(([ts, val]) => ({ ts, src: 'master', field: 'hospitalized', val }));
  const base = { today: T, careCertStart: '2026-04-01', careCertEnd: '2027-03-31' };
  const h1 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-06-01')], stateLog: LOG(['2026-10-10T01:00:00.000Z', false], ['2026-09-20T01:00:00.000Z', true]) }));
  t('★退院した後に会議が無ければ知らせる（臨時の会議の理由は「退院・退所」）', kinds(h1) === 'discharge' && h1[0].level === 'high' && h1[0].reason === '退院・退所' && /2026-10-10/.test(h1[0].text), h1);
  const h2 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-06-01'), M('2026-10-05')], stateLog: LOG(['2026-10-10T01:00:00.000Z', false], ['2026-09-20T01:00:00.000Z', true]) }));
  t('入院中に開いた会議（退院の前の会議）があれば、退院の知らせは出さない', kinds(h2) === '', h2);
  const h3 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-04-01')], stateLog: LOG(['2026-09-20T01:00:00.000Z', true]) }));
  t('★入院中は6か月の知らせを止めて「入院中です」と出す', kinds(h3) === 'inHospital' && h3[0].level === 'info', h3);
  const h4 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-04-01')], hospitalized: true }));
  t('入院の印（hospitalized）でも入院中とみなす', kinds(h4) === 'inHospital', h4);
  const h6 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-06-01')], stateLog: LOG(['2026-10-10T01:00:00.000Z', false]) }));
  t('★入院した日が分からない（記録が退院だけ）時は、退院の知らせを出さない', kinds(h6) === '', h6);
  const h5 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-06-01')], stateLog: [{ ts: '2026-10-10T01:00:00.000Z', field: 'hospitalized', val: false }, { ts: '2026-09-20T01:00:00.000Z', field: 'hospitalized', val: true }].reverse() }));
  t('入院の記録の並びが古い順でも、時刻で並べ直して読む', kinds(h5) === 'discharge', h5);
  t('退院の日は日本時間で数える（夜の9時より後の記録は翌日）', C.hospitalState(LOG(['2026-10-09T15:30:00.000Z', false])).discharged === '2026-10-10');
  const c1 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-06-01')], careLevelHistory: [{ value: '要介護2', changedAt: '2026-10-01', note: '区分変更（自動記録）' }, { value: '要介護1', changedAt: '2025-10-01', note: '更新認定（自動記録）' }] }));
  t('★区分変更の前後に会議が無ければ知らせる（臨時の会議の理由は「区分変更」）', kinds(c1) === 'careChange' && c1[0].reason === '区分変更' && /2026-10-01/.test(c1[0].text), c1);
  const c2 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-09-10')], careLevelHistory: [{ changedAt: '2026-10-01', note: '区分変更（自動記録）' }] }));
  t('区分変更の30日前より後の会議（変更の前の会議）があれば知らせない', kinds(c2) === '', c2);
  const c3 = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-06-01')], careLevelHistory: [{ changedAt: '2026-10-01', note: '更新認定（自動記録）' }] }));
  t('区分変更でない履歴（更新認定）では知らせない', kinds(c3) === '', c3);
  const any = C.dueAlerts(Object.assign({}, base, { meetings: [M('2026-04-01'), M('2026-10-12')], stateLog: LOG(['2026-10-10T01:00:00.000Z', false], ['2026-09-20T01:00:00.000Z', true]) }));
  t('★どの理由の会議でも6か月を数え直す（臨時の会議の後は6か月の知らせが消える）', kinds(any) === '', any);
  t('今日（日本時間）を数える', C.todayJST(Date.UTC(2026, 9, 22, 15, 0)) === '2026-10-23' && C.todayJST(Date.UTC(2026, 9, 22, 14, 59)) === '2026-10-22');
}

console.log('\n— 8. 印の無い議事録の見出しから欄の候補を出す（2026-11-13 代表者の指示） —');
{
  const keys = (g) => g.cands.map((c) => c.key).join(',');
  const nonEmpty = (s) => String(s).split('\n').map((l) => l.trim()).filter(Boolean);
  /* どの行も失わない（空でない行は、どれか1つの候補の元の文か、最初の見出しより前の文に1回だけ入る） */
  const keepsAll = (src, g) => {
    const got = nonEmpty([g.rest].concat(g.cands.map((c) => c.src)).join('\n'));
    const want = nonEmpty(src);
    return got.length === want.length && got.every((l, i) => l === want[i]);
  };
  /* (1) 見出しが【】の形 */
  const A = [
    '担当者会議の記録（架空）',
    '【利用者名】甲野 太郎 様',
    '【開催日】2026年10月16日（金）',
    '【開催場所】架空の相談室',
    '【出席者】',
    '介護支援専門員／乙野 花子',
    '介護職員／丙野 一郎',
    '【検討した項目】',
    '1. 夜間の排泄の支援',
    '2. 入浴の回数',
    '【検討内容】',
    '【CM】夜間の誘導の時間を見直したい。',
    '【施設】2時と5時の誘導で失敗が減った。',
    '【結論】',
    '夜間の誘導を2時と5時にする。',
    '【今後の課題】なし'
  ].join('\n');
  t('(1) 印の無い議事録は parse では何も入れない（今の振り分けのまま）', Object.keys(C.parse(A).fields).length === 0 && C.parse(A).found.length === 0);
  const ga = C.guess(A);
  t('★(1)【】の見出しを欄の候補にする（本文の【CM】【施設】は候補にしない）', keys(ga) === 'sourceName,heldDate,place,attendees,items,content,conclusion,issues', keys(ga));
  t('(1) 候補の本文は次の見出しの前まで（同じ行の後ろの文も入れる）', ga.cands[0].body === '甲野 太郎 様' && ga.cands[5].body === '【CM】夜間の誘導の時間を見直したい。\n【施設】2時と5時の誘導で失敗が減った。' &&
    ga.cands[7].head === '今後の課題' && ga.cands[7].body === 'なし', ga.cands);
  t('(1) 最初の見出しより前の文は「振り分けられなかった文」として返す', ga.rest === '担当者会議の記録（架空）', ga.rest);
  t('★(1) どの行も捨てない', keepsAll(A, ga));
  const none = C.guessApply(ga, []);
  t('★(1) 人が選ばない限り、どの欄にも入れない', none.chosen === 0 && Object.keys(none.fields).length === 0 && none.found.length === 0 && none.attendees.length === 0, none);
  t('(1) 選ばない時は全部の文を「振り分けられなかった文」に返す', keepsAll(A, { rest: none.rest, cands: [] }), none.rest);
  const ch = ga.cands.map((c) => (c.key === 'conclusion' || c.key === 'heldDate' || c.key === 'attendees' ? c.key : ''));
  const pa = C.guessApply(ga, ch);
  t('★(1) 選んだ見出しだけを欄へ入れる（日付・出席者は parse と同じ形の確かめを通る）', pa.chosen === 3 && pa.fields.conclusion === '夜間の誘導を2時と5時にする。' && pa.fields.heldDate === '2026-10-16' &&
    pa.attendees.length === 2 && pa.attendees[0].name === '乙野 花子' && !('content' in pa.fields) && !('sourceName' in pa.fields), pa);
  t('(1) 選ばなかった見出しは見出しの行ごと「振り分けられなかった文」に残す', /【検討内容】\n【CM】/.test(pa.rest) && /^担当者会議の記録（架空）/.test(pa.rest) && pa.rest.indexOf('夜間の誘導を2時と5時にする') < 0, pa.rest);
  const other = C.guessApply(ga, ga.cands.map((c) => (c.key === 'issues' ? 'conclusion' : '')));
  t('(1) 人が入れる欄を変えた時はその欄へ入れる（今後の課題 → 結論）', other.fields.conclusion === 'なし' && !('issues' in other.fields), other.fields);
  const bad = C.guessApply(ga, ga.cands.map(() => 'nosuchfield'));
  t('知らない欄の名前を渡しても、欄に入れない', bad.chosen === 0 && Object.keys(bad.fields).length === 0, bad);

  /* (2) 見出しが「〜：」の形 */
  const B = [
    '利用者：甲野 次郎',
    '開催日：令和8年10月20日',
    '開催時間：10時〜10時30分',
    '参加者：',
    '・介護支援専門員／乙野 花子',
    '検討事項：歩行の見守り',
    '協議内容：',
    '甲野：転ばないか心配です。',
    '乙野：結論としては見守りを続けたいと思います。',
    '決定事項：日中の見守りを続ける。',
    '課題：夜間の様子を見る。',
    '次回：6か月後'
  ].join('\n');
  const gb = C.guess(B);
  t('★(2)「語：」の見出しを欄の候補にする（「甲野：」「結論としては…」は候補にしない）', keys(gb) === 'sourceName,heldDate,timeText,attendees,items,content,conclusion,issues,nextText', keys(gb));
  t('(2) 話した人の行は検討内容の本文に残る', gb.cands[5].body === '甲野：転ばないか心配です。\n乙野：結論としては見守りを続けたいと思います。', gb.cands[5].body);
  t('★(2) どの行も捨てない', keepsAll(B, gb) && gb.rest === '');
  const pb = C.guessApply(gb, gb.cands.map((c) => c.key));
  t('(2) 全部選ぶと、和暦の日付・時刻も parse と同じに読む', pb.fields.heldDate === '2026-10-20' && pb.fields.timeText === '10:00〜10:30' && pb.fields.conclusion === '日中の見守りを続ける。' &&
    pb.fields.nextText === '6か月後' && pb.fields.sourceName === '甲野 次郎' && pb.rest === '', pb.fields);

  /* (3) 箇条書きの形（■・番号・見出しの語だけの行） */
  const C3 = [
    '架空の会議のメモ',
    '■検討内容',
    '・入浴の時間を夕方にしたい（丁野）',
    '1. 結論',
    '入浴は夕方にする。',
    '・残された課題',
    '・まとめの時に見守りの人数を決める',
    '# 次回の開催予定',
    '状態が変わった時',
    '★結論',
    '週2回を続ける。'
  ].join('\n');
  const gc = C.guess(C3);
  t('★(3) 箇条書きの見出し（■・番号・中黒・#）を欄の候補にする（文の中の語は候補にしない）', keys(gc) === 'content,conclusion,issues,nextText,conclusion', keys(gc));
  t('(3) 箇条書きの本文の中黒の行は本文に残す', gc.cands[2].body === '・まとめの時に見守りの人数を決める', gc.cands[2].body);
  t('★(3) どの行も捨てない', keepsAll(C3, gc) && gc.rest === '架空の会議のメモ');
  const pc = C.guessApply(gc, gc.cands.map((c) => c.key));
  t('(3) 同じ欄に2つ選んだ時は、見出しの順につないで知らせる', pc.fields.conclusion === '入浴は夕方にする。\n週2回を続ける。' && pc.warns.some((w) => /「結論」の欄に 2 つの見出しの文をつないで/.test(w)), pc);
  const pc1 = C.guessApply(gc, gc.cands.map((c, i) => (i === 0 ? c.key : '')));
  t('(3) 1つだけ選ぶと、その欄だけに入る', Object.keys(pc1.fields).join(',') === 'content' && pc1.fields.content === '・入浴の時間を夕方にしたい（丁野）', pc1.fields);

  /* 印のある議事録・長すぎる・飾りだけの長い行 */
  const gf = C.guess(FULL);
  t('★印のある議事録では候補を出さない（今の振り分けのまま）', gf.marked === true && gf.cands.length === 0);
  const gt = C.guess('a'.repeat(C.INPUT_MAX + 1));
  t('長すぎる文章では候補を出さない', gt.tooLong === true && gt.cands.length === 0);
  const t0 = Date.now(), gl = C.guess('*'.repeat(29000) + '結論');
  t('飾りだけの長い行でも時間がかからない（1秒未満）', Date.now() - t0 < 1000 && Array.isArray(gl.cands), Date.now() - t0);
  const gm = C.guess('【結論】◆開催日：2026/10/1');
  const pm = C.guessApply(gm, gm.cands.map((c) => c.key));
  t('★見出しの後ろが「◆欄名：」の形の行は見出しにしない（選んでいない欄に入らない）', gm.cands.length === 0 && pm.chosen === 0 && Object.keys(pm.fields).length === 0 && gm.rest === '【結論】◆開催日：2026/10/1', [gm, pm.fields]);
  /* 形を確かめる1行の欄（日付・時刻・回数・開催の理由）を選んだ時、続く行も読めなかった値も消さない（反証レビューの指摘 2026-11-13） */
  const lost = (src, res) => nonEmpty(src).filter((l) => !/^(?:開催日|開催時間|開催回数|開催の理由|結論)：/.test(l)).filter((l) => {
    const inFields = Object.keys(res.fields).some((k) => String(res.fields[k]).indexOf(l) >= 0);
    return !inFields && String(res.rest).indexOf(l) < 0;
  });
  [
    ['開催日', 'heldDate', '2026年11月1日', '2026-11-01'],
    ['開催時間', 'timeText', '14:00〜14:30', '14:00〜14:30'],
    ['開催回数', 'count', '3回目', '3'],
    ['開催の理由', 'kind', '認定の更新', '認定の更新']
  ].forEach(([lab, key, val, want]) => {
    const src = lab + '：' + val + '\n本日は架空の話し合いをした。\nご本人は架空の希望を話した。\n結論：現状維持';
    const g = C.guess(src), r = C.guessApply(g, g.cands.map((c) => c.key));
    t('★' + lab + 'を選ぶと、見出しの行の値だけを欄に入れ、続く行は「振り分けられなかった文」に残す', r.fields[key] === want && r.fields.conclusion === '現状維持' &&
      /本日は架空の話し合いをした。\nご本人は架空の希望を話した。/.test(r.rest) && lost(src, r).length === 0, [r.fields, r.rest]);
    const bad = lab + '：来週のどこか\n続きの架空の文。';
    const gb2 = C.guess(bad), rb = C.guessApply(gb2, gb2.cands.map((c) => c.key));
    t(lab + 'の値を読めない時は、欄を空にし、読めなかった値と続く行を「振り分けられなかった文」に残す', !rb.fields[key] && /来週のどこか/.test(rb.rest) && /続きの架空の文。/.test(rb.rest) && rb.warns.length > 0, [rb.fields, rb.rest]);
  });
  const sep = C.guess('【開催日】\n2026年11月2日\n補足の架空の文'), rs = C.guessApply(sep, ['heldDate']);
  t('見出しだけの行の時は、次の行を値として入れ、その後ろの行は残す', rs.fields.heldDate === '2026-11-02' && rs.rest === '補足の架空の文', [rs.fields, rs.rest]);
  const ch2 = C.guess('【結論】\n1行目\n2行目'), rc = C.guessApply(ch2, ['conclusion']);
  t('文の欄（結論など）は今までどおり続く行も全部入れる', rc.fields.conclusion === '1行目\n2行目' && rc.rest === '', rc);
  t('見出しの語の言い換えは parse の区切りにしない（「◆課題：」は今も知らない印）', C.parse('◆結論：続ける\n◆課題：なし').unknown.length === 1 && C.parse('◆結論：続ける\n◆課題：なし').fields.conclusion === '続ける\n◆課題：なし');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
