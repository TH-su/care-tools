/* 受診連絡の純関数（hospital-visit-calc.js）の試験（2026-11-27 新設・本人指示）
   実行: node check/unit/hospital_visit_calc_test.js
   守ること: 設定の既定（見本の手紙の文のまま）・崩れた設定の捨て方・日付・結果の有無・前回の選び方（同じ病院を優先）・
            薬の塊（受診前／受診後）・手紙の書き始め・病院の候補・保存前の確かめ・保存の形・手紙の紙のエスケープ・画面の状態
   ★データはすべて架空（入居者「架空 花子」・薬「架空薬A」など）。出力に console を使わない。 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', '..', 'hospital-visit-calc.js'));
let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

group('1. 設定');
const d = C.normSettings(null);
t('既定の文は見本の手紙のまま', d.opening === '平素よりお世話になっております。' && d.openingTail === 'のご状況についてご報告させていただきます。'
  && d.closing === '以上、ご報告とさせて頂きます。今後ともどうぞ宜しくお願いいたします。' && d.honorific === '御机下' && d.titleTail === '身体状況のご報告');
t('署名は既定で空（施設情報と設定から入れる）', d.signOrg === '' && d.signName === '');
const s2 = C.normSettings({ closing: '', opening: 5, kinds: ['定期', '定期', ' ', 'x'.repeat(21), '臨時'], results1: 'a', signName: '架空 施設長' });
t('空・型違いの文は既定・選択肢は重なりと長すぎを落とす', s2.closing === d.closing && s2.opening === d.opening && s2.kinds.join() === '定期,臨時'
  && s2.results1.join() === d.results1.join() && s2.signName === '架空 施設長');
t('1行1つの入力を選択肢にする', C.linesToList('a\n\n b \na\n').join() === 'a,b');

group('2. 日付');
t('手紙の日付の形', C.jpDate('2026-11-17') === '2026年11月17日' && C.jpDate('2026-02-30') === '' && C.jpDate('') === '');
t('月/日（曜日）', C.mdw('2026-11-07') === '11/7（土）' && C.md('2026-10-21') === '10/21');
t('日本時間の今日', C.todayJST(new Date('2026-11-26T15:30:00Z')) === '2026-11-27');

group('3. 結果の有無・並び・前回');
t('結果の有無', !C.hasResult({ letter_body: 'x' }) && C.hasResult({ result1: '処方継続' }) && C.hasResult({ added_med: '無' }) && C.hasResult({ has_result: true }));
const vs = [
  { id: 'a', visit_date: '2026-09-01', hospital_name: '架空 甲医院' },
  { id: 'b', visit_date: '2026-10-21', hospital_name: '架空 乙病院' },
  { id: 'c', letter_date: '2026-11-17', hospital_name: '架空 甲医院' },
  { id: 'd', visit_date: '2026-08-01', hospital_name: '架空 乙病院' }];
t('新しい順（受診日→手紙の日付）', C.sortVisits(vs).map(x => x.id).join() === 'c,b,a,d');
t('前回は同じ病院のいちばん新しい受診', C.prevVisitFor(vs, { id: 'c', hospital_name: '架空 甲医院' }).id === 'a');
t('同じ病院が無ければ、いちばん新しい前の受診', C.prevVisitFor(vs, { id: 'c', hospital_name: '架空 丙クリニック' }).id === 'b');
t('新しい受診（id なし）は全部が前', C.prevVisitFor(vs, { hospital_name: '架空 乙病院' }).id === 'b' && C.prevVisitFor(vs, {}).id === 'c');
t('前が無ければ null', C.prevVisitFor(vs, { id: 'd' }) === null && C.prevVisitFor([], {}) === null);

group('4. 薬の塊と書き始め');
const meds = '架空薬A 5mg 1錠分1 朝食後\n\n 架空薬B 25mg 1錠分1 就寝前 \n';
t('1行1剤にする', C.medLines(meds).length === 2 && C.medLines(meds)[1] === '架空薬B 25mg 1錠分1 就寝前');
const rs = C.resultStarter(meds, '2026-10-21');
t('結果の書き始めは【受診前】と【10/21 受診後】', rs.indexOf('【受診前】\n架空薬A') === 0 && rs.indexOf('\n\n【10/21 受診後】\n架空薬A') > 0);
t('定期薬が空なら（定期薬の記載なし）', C.medsBlock('受診前', '') === '【受診前】\n（定期薬の記載なし）');
t('手紙の書き始めは前回の結果を写し【前回受診前】に直す', C.letterStarter({ result_body: rs }, meds).indexOf('\t【前回受診前】\n\t\t架空薬A') === 0
  && C.letterStarter({ result_body: rs }, meds).indexOf('【10/21 受診後】') > 0);
t('前回の結果が無ければ【現在の処方】', C.letterStarter(null, meds).indexOf('\t【現在の処方】\n\t\t架空薬A') === 0);
const sp = C.splitBeforeAfter('【受診前】\n架空薬A\n\n【10/21 受診後】\n架空薬A\n架空薬C\n');
const df = C.medDiff(sp.before, sp.after);
t('受診前と受診後の違い（足された薬）', df.added.join() === '架空薬C' && df.removed.length === 0);

t('手紙の薬の段は見本と同じく見出し1段・薬2段のタブで下げる', C.letterIndent('【前回受診前】\n架空薬A\n\n本文').split('\n').join('|') === '\t【前回受診前】|\t\t架空薬A||本文'
  && C.letterStarter(null, meds).indexOf('\t【現在の処方】\n\t\t架空薬A') === 0 && C.letterStarter({ result_body: rs }, meds).indexOf('\t【前回受診前】\n\t\t架空薬A') === 0);
t('字下げしても薬の比べ方は変わらない（行の頭のタブは落とす）', C.medLines(C.letterIndent(meds.replace(/^/, '【x】\n')))[1] === '架空薬A 5mg 1錠分1 朝食後');

group('5. 入居者の検索・病院の候補');
const roster = [{ id: 'T2', name: '架空 次郎', kana: 'かくう じろう', room: '205' }, { id: 'T1', name: '架空 花子', kana: 'カクウ ハナコ', room: '103' },
  { id: 'T3', name: '架空 退居', kana: 'かくう', room: '101', active: false }];
t('空は在籍者を居室の順', C.searchResidents(roster, '').map(x => x.id).join() === 'T1,T2');
t('ふりがな（カタカナでも）・居室・番号で探せる', C.searchResidents(roster, 'はなこ')[0].id === 'T1' && C.searchResidents(roster, '205')[0].id === 'T2' && C.searchResidents(roster, 't1')[0].id === 'T1');
const hc = C.hospitalChoices([{ id: 'h1', name: '架空 甲医院', dept: '内科', doctor: '架空 一郎' }, { id: 'h2', name: '架空 閉院', disabled: true }],
  { hospital: '架空 乙病院\n2行目', doctor: '架空 二郎', emergencyHospital: '架空 甲医院' }, [{ id: 'v1', hospital_name: '架空 丙クリニック', visit_date: '2026-01-01' }]);
t('台帳→マスタ→過去の順・重なりと使わない病院は出さない', hc.map(x => x.name).join() === '架空 甲医院,架空 乙病院,架空 丙クリニック'
  && hc[1].doctor === '架空 二郎' && hc[1].src === 'master' && hc[0].hospital_id === 'h1');

group('6. 保存の前の確かめ・保存の形');
t('入居者が無いと断る', C.checkVisit({}).length === 1);
t('日付の形・長さ・追加薬の値', C.checkVisit({ resident_id: 'T1', visit_date: '2026/11/1', letter_body: 'あ'.repeat(8001), added_med: '多分' }).length === 3);
t('正しい下書きは空', C.checkVisit(C.blankVisit({ id: 'T1', name: '架空 花子' }, '2026-11-27')).length === 0);
const sv = C.toSave(Object.assign(C.blankVisit({ id: 'T1', name: '架空 花子' }, '2026-11-27'), { id: 'x', rev: 3, extra: 'no' }));
t('保存の形は決まった項目と id だけ（版や余計な鍵を送らない）', sv.id === 'x' && !('rev' in sv) && !('extra' in sv) && sv.resident_id === 'T1' && sv.letter_date === '2026-11-27');
const a = C.blankVisit({ id: 'T1' }, '2026-11-27'), b = Object.assign({}, a, { result1: '処方継続' });
t('編集の有無', C.sameDraft(a, Object.assign({}, a)) && !C.sameDraft(a, b));
t('行から下書きへ（null は空・版は数）', (() => { const f = C.fromRow({ id: 'v', rev: 2, resident_id: 'T1', result1: null }); return f.rev === 2 && f.result1 === '' && f.id === 'v'; })());

group('7. 手紙の紙');
const h = C.letterHtml({ resident_name: '架空 花子', hospital_name: '架空 甲医院', doctor: '架空 一郎', letter_date: '2026-11-17',
  letter_body: '<script>x</script>\n本文' }, { signName: '施設長　架空' }, '架空ホーム');
t('氏名の空白は全角1つ・題・宛名・御机下', h.indexOf('架空　花子　様　身体状況のご報告') > 0 && h.indexOf('架空 一郎 先生　御机下') > 0);
t('本文はエスケープ（画面に入る外の値）', h.indexOf('<script>') < 0 && h.indexOf('&lt;script&gt;') > 0);
t('日付と署名（施設の呼び名と設定の名前）', h.indexOf('2026年11月17日') > 0 && h.indexOf('<p>架空ホーム</p>') > 0 && h.indexOf('施設長　架空') > 0);
t('医師名が無い時は文を足さない', C.letterHtml({ resident_name: 'x' }, {}, '').indexOf('<span class="hl-doc">御机下</span>') > 0);

group('8. 画面の状態');
t('タブは決まった値だけ', C.pickTab('meds', C.LEFT_TABS, 'prev') === 'meds' && C.pickTab('x', C.LEFT_TABS, 'prev') === 'prev' && C.pickTab('paper', C.RIGHT_TABS, 'letter') === 'paper');

say('\n合格 ' + pass + ' / 不合格 ' + fail);
process.exit(fail ? 1 : 0);
