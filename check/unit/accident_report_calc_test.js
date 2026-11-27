/* 事故報告書の純関数（accident-report-calc.js）の試験（2026-11-28 新設・本人指示）
   実行: node check/unit/accident_report_calc_test.js
   守ること: 入居者マスタの値の読み方（性別・要介護度・自立度・日付）・年齢（発生日の時点・手で直した年齢は残す）・
            選択肢の押し方（複数・1つ・もう一度押すと外れる・外すと括弧の中を空に）・事業所の連動・入居者マスタから入れる欄・
            保存の形（決まった8つの鍵・空の日付は null・番号は数）・保存前の確かめ・続報の写し方・未記入の数・別紙の判定・
            紙の材料（欄・文言・丸・日付の別々の枠・赤字2か所・水色・エスケープ・固有名詞を持たない）
   ★データはすべて架空（入居者「架空 花子」・施設は見本の施設情報）。出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'accident-report-calc.js'));
const FAC = JSON.parse(fs.readFileSync(path.join(ROOT, 'facility-profile.sample.json'), 'utf8'));
let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

group('1. 入居者マスタの値の読み方');
t('性別（入居者マスタは 女・男）', C.normGender('女') === 'f' && C.normGender('男') === 'm' && C.normGender(' 男性 ') === 'm' && C.normGender('') === '' && C.normGender('不明') === '');
t('要介護度（全角の数字・空白も読む・当たらなければ空）', C.normCareLevel('要介護４') === '要介護4' && C.normCareLevel('要支援 2') === '要支援2' && C.normCareLevel('自立') === '自立'
  && C.normCareLevel('事業対象者') === '' && C.normCareLevel('要介護6') === '' && C.normCareLevel(null) === '');
t('自立度は入居者マスタと同じ読み方（IIIa→Ⅲa・ii b→Ⅱb・Ⅳ・M）', C.normDementia('IIIa') === 'IIIa' && C.normDementia('ii b') === 'IIb' && C.normDementia('Ⅳ') === 'IV' && C.normDementia('M') === 'M' && C.normDementia('I') === 'I');
t('自立度の「自立」・読めない値は空（推測で埋めない）', C.normDementia('自立') === '' && C.normDementia('III c') === '' && C.normDementia('軽度') === '' && C.normDementia('') === '');
t('bfNormRank は入居者マスタ（resident-master.js）の写しと同じ答え', (function () {
  const src = fs.readFileSync(path.join(ROOT, 'resident-master.js'), 'utf8');
  const m = /function bfNormRank\(s\)\{[\s\S]*?\n\}/.exec(src);
  if (!m) return false;
  const vm = require('vm'); const ctx = { BF_DEMENTIA_RANKS: ['', '自立', 'Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M'], BF_RANK_ALIAS: { 'I': 'Ⅰ', 'II': 'Ⅱ', 'III': 'Ⅲ', 'IV': 'Ⅳ', 'Ⅰ': 'Ⅰ', 'Ⅱ': 'Ⅱ', 'Ⅲ': 'Ⅲ', 'Ⅳ': 'Ⅳ' },
    bfStr: (v) => String(v == null ? '' : v).trim() };
  vm.createContext(ctx); vm.runInContext(m[0] + ';this.f=bfNormRank;', ctx);
  return ['', '自立', 'IIIa', 'iib', 'Ⅳ', 'M', 'IIa ', 'x', 'II c', 'Ⅲ b'].every((v) => ctx.f(v) === C.bfNormRank(v));
})());
t('日付（2026/2/3・時刻つき・全角・存在しない日）', C.normDate('2026/2/3') === '2026-02-03' && C.normDate('2023-04-01T00:00:00') === '2023-04-01'
  && C.normDate('２０２３-０４-０１') === '2023-04-01' && C.normDate('2026-02-30') === '' && C.normDate('') === '');

group('2. 年齢');
t('その日の満年齢（誕生日の前日・当日）', C.ageAt('1938-07-20', '2026-07-19') === '87' && C.ageAt('1938-07-20', '2026-07-20') === '88' && C.ageAt('', '2026-07-20') === '' && C.ageAt('2027-01-01', '2026-01-01') === '');
t('発生日を変えると自動の年齢は数え直す', C.ageAfterDateChange('88', '1938-07-20', '', '2026-07-01', '2026-11-28') === '87');
t('手で直した年齢は発生日を変えても残す', C.ageAfterDateChange('90', '1938-07-20', '2026-08-01', '2026-07-01', '2026-11-28') === '90');
t('空の年齢は数えて入れる・生年月日が無ければ空のまま', C.ageAfterDateChange('', '1938-07-20', '', '2026-07-01', '2026-11-28') === '87' && C.ageAfterDateChange('', '', '', '2026-07-01', '2026-11-28') === '');
t('日本時間の今日', C.todayJST(new Date('2026-11-27T15:30:00Z')) === '2026-11-28');

group('3. 選択肢');
let d = C.blankData();
d = C.toggle(d, 'place', 'toilet'); d = C.toggle(d, 'place', 'room1');
t('複数: 足すと並びは様式の順', d.place.join() === 'room1,toilet');
d = C.toggle(d, 'place', 'toilet');
t('複数: もう一度押すと外れる', d.place.join() === 'room1');
d = C.toggle(d, 'gender', 'm'); d = C.toggle(d, 'gender', 'f');
t('1つ: 別のを押すと入れ替わる', d.gender === 'f');
d = C.toggle(d, 'gender', 'f');
t('1つ: もう一度押すと外れる', d.gender === '');
d = C.toggle(d, 'kind', 'other'); d.kindOther = '見本の種別'; d = C.toggle(d, 'kind', 'other');
t('「その他」を外すと括弧の中を空にする', d.kindOther === '' && d.kind.length === 0);
d = C.toggle(d, 'diag', 'fracture'); d.fracturePart = '見本の部位'; d = C.toggle(d, 'diag', 'cut');
t('ほかを押しても選んでいる「骨折」の部位は残す', d.fracturePart === '見本の部位' && d.diag.join() === 'cut,fracture');
d = C.toggle(d, 'addressKind', 'other'); d.addressOther = '見本の住所'; d = C.toggle(d, 'addressKind', 'office');
t('1つの組で「その他」から別の物へ移ると括弧の中を空にする', d.addressKind === 'office' && d.addressOther === '');
t('知らない組・知らない選択肢は何もしない', JSON.stringify(C.toggle(d, 'nope', 'x')) === JSON.stringify(C.normData(d)) && JSON.stringify(C.toggle(d, 'place', 'nope')) === JSON.stringify(C.normData(d)));
d = C.toggle(C.blankData(), 'severity', 'death'); d.deathDate = '2026-02-12'; d = C.toggle(d, 'severity', 'death');
t('「死亡」を外すと死亡年月日を空にする', d.deathDate === '' && d.severity.length === 0);
t('引数を書き換えない', (function () { const a = C.blankData(); C.toggle(a, 'place', 'hall'); return a.place.length === 0; })());
t('様式の注記どおりの組（複数）と1つの組', ['severity', 'offices', 'serviceKinds', 'place', 'kind', 'consult', 'diag', 'familyRel', 'agencies'].every((g) => C.OPTS[g].multi === true)
  && ['gender', 'addressKind', 'careLevel', 'dementia'].every((g) => C.OPTS[g].multi === false));

group('4. 事業所の連動・入居者マスタから入れる');
const F = C.facOf(FAC);
let e = C.blankData();
let prev = e.offices.slice(); e = C.toggle(e, 'offices', '訪問'); e = C.linkOffices(e, prev, F);
t('訪問を選ぶ → サービス種別に訪問・事業所番号と所在地は訪問のもの', e.serviceKinds.join() === 'visit' && e.officeNo === FAC.offices[1].officeNo && e.officeNo !== '' && e.officeAddress === '見本県見本市見本町1-2-3');
prev = e.offices.slice(); e = C.toggle(e, 'offices', '通所'); e = C.linkOffices(e, prev, F);
t('通所も足す → 種別に通所・番号は2つ選ぶと空（1つの時だけ自動）', e.serviceKinds.join() === 'visit,day' && e.officeNo === '');
e.officeNo = '手で直した番号';
prev = e.offices.slice(); e = C.toggle(e, 'offices', '通所'); e = C.linkOffices(e, prev, F);
t('手で直した事業所番号は事業所を選び直しても残す・外した事業所の種別は外す', e.officeNo === '手で直した番号' && e.serviceKinds.join() === 'visit');
const REC = { id: 'K001', name: '架空 花子', gender: '女', birthDate: '1938-07-20', admissionDate: '2023/4/1', insurer: '', careLevel: '要介護４', dementia: 'IIIa' };
const r1 = C.fromResident(C.blankData(), REC, FAC, '2026-11-28');
t('3 対象者が入る（氏名・年齢・性別・開始日・保険者は空なら市区町村・住所・要介護度・自立度）', r1.data.name === '架空 花子' && r1.data.age === '88' && r1.data.gender === 'f'
  && r1.data.serviceStart === '2023-04-01' && r1.data.insurer === '見本市' && r1.data.addressKind === 'office' && r1.data.careLevel === '要介護4' && r1.data.dementia === 'IIIa', r1.data);
t('2 事業所が入る（施設・入所・所在地・法人名・施設の事業所番号）', r1.data.offices.join() === '施設' && r1.data.serviceKinds.join() === 'in' && r1.data.officeAddress === '見本県見本市見本町1-2-3' && r1.data.corpName === '見本福祉会' && r1.data.officeNo === '');
t('入れた欄の一覧: 入居者マスタから（「入居者マスタから」の印）と施設情報から（「施設情報から」の印）を分ける', ['name', 'age', 'gender', 'serviceStart', 'addressKind', 'careLevel', 'dementia'].every((k) => r1.auto.indexOf(k) >= 0)
  && ['insurer', 'offices', 'serviceKinds', 'corpName', 'officeAddress'].every((k) => r1.autoFac.indexOf(k) >= 0) && r1.auto.indexOf('corpName') < 0 && r1.autoFac.indexOf('name') < 0, [r1.auto, r1.autoFac]);
t('保険者が入居者マスタにある時は入居者マスタの印', (function () { const x = C.fromResident(C.blankData(), Object.assign({}, REC, { insurer: '見本町' }), FAC, '2026-11-28'); return x.data.insurer === '見本町' && x.auto.indexOf('insurer') >= 0 && x.autoFac.indexOf('insurer') < 0; })());
t('入れ直しで住所が事業所所在地に替わる時は「その他」の住所を空にする', (function () { const x = C.fromResident(Object.assign(C.blankData(), { addressKind: 'other', addressOther: '見本の住所' }), REC, FAC, '2026-11-28'); return x.data.addressKind === 'office' && x.data.addressOther === ''; })());
t('施設の事業所が無い事業者では入所に丸を付けない（事業所が2つ以上なら選ばない）', (function () {
  const fac2 = JSON.parse(JSON.stringify(FAC)); fac2.offices = fac2.offices.filter((o) => o.kind !== '施設');
  const x = C.fromResident(C.blankData(), REC, fac2, '2026-11-28');
  return x.data.offices.length === 0 && x.data.serviceKinds.length === 0;
})());
t('事業所が1つだけの事業者はその1つ（通所だけ → 通所・番号・所在地）', (function () {
  const fac3 = JSON.parse(JSON.stringify(FAC)); fac3.offices = fac3.offices.filter((o) => o.kind === '通所');
  const x = C.fromResident(C.blankData(), REC, fac3, '2026-11-28');
  return x.data.offices.join() === '通所' && x.data.serviceKinds.join() === 'day' && x.data.officeNo === fac3.offices[0].officeNo && x.data.officeAddress === fac3.offices[0].address;
})());
const r2 = C.fromResident(Object.assign(C.blankData(), { occurDate: '2026-07-01' }), REC, FAC, '2026-11-28');
t('発生日が入っていれば発生日の時点の年齢', r2.data.age === '87');
const r3 = C.fromResident(C.blankData(), { name: '架空 次郎', careLevel: '事業対象者', dementia: '自立' }, FAC, '2026-11-28');
t('入居者マスタに無い・当たらない値は入れない（空のまま・印も付けない）', r3.data.careLevel === '' && r3.data.dementia === '' && r3.data.gender === '' && r3.auto.indexOf('careLevel') < 0 && r3.auto.indexOf('dementia') < 0);

group('5. 保存の形・確かめ・続報');
const rep = C.blankReport({ id: 'K001', name: '架空 花子' }, '2026-11-28');
rep.data = r2.data;
const body = C.toSave(rep, FAC);
t('保存の本文は決まった8つの鍵（新規は id なし）', Object.keys(body).sort().join() === C.SAVE_KEYS.slice().sort().join(), Object.keys(body));
t('発生日を occurred_on へ・空の日付は null・第1報の番号は null', body.occurred_on === '2026-07-01' && body.prev_id === null && body.report_no === null && body.report_kind === 'first');
t('保存の時に事業所の正式名を写す（施設・訪問・通所の順）', body.data.officeNames.join('|') === '有料老人ホーム 見本ホーム|訪問介護 見本ヘルパー|デイサービス 見本の里');
t('data の鍵は KEYS だけ', Object.keys(body.data).every((k) => C.KEYS.indexOf(k) >= 0) && Object.keys(body.data).length === C.KEYS.length);
const nth = Object.assign({}, rep, { id: 'x', rev: 3, report_kind: 'nth', report_no: '3' });
const b2 = C.toSave(nth);
t('更新は id つき・第n報の番号は数', b2.id === 'x' && b2.report_no === 3 && b2.report_kind === 'nth');
t('確かめ: 入居者なし・番号の範囲・日付の形・時刻の範囲・年齢の形', C.checkReport(Object.assign({}, rep, { resident_id: '' })).length === 1
  && C.checkReport(Object.assign({}, rep, { report_kind: 'nth', report_no: '1' })).length === 1
  && C.checkReport(Object.assign({}, rep, { data: Object.assign({}, rep.data, { occurDate: '2026-13-01', occurHour: '24', occurMin: '60', age: 'x' }) })).length === 4
  && C.checkReport(rep).length === 0);
t('確かめ: 字数の上限・全体の大きさ（60000 字）', C.checkReport(Object.assign({}, rep, { data: Object.assign({}, rep.data, { name: 'x'.repeat(61) }) })).length === 1
  && C.checkReport(Object.assign({}, rep, { data: Object.assign({}, rep.data, { detail: 'x'.repeat(4000), response: 'x'.repeat(4000), status: 'x'.repeat(4000), cause: 'x'.repeat(6000), prevention: 'x'.repeat(6000),
    special: 'x'.repeat(2000), treatment: 'x'.repeat(2000), followup: 'x'.repeat(2000), note: 'x'.repeat(3000) }) })).length === 0);
t('保存されている data の知らない鍵・知らない選択肢・型の違う値は持たない', (function () {
  const n = C.normData({ zzz: 1, place: ['room1', 'nope'], gender: 'x', name: { a: 1 }, detail: 12 });
  return !('zzz' in n) && n.place.join() === 'room1' && n.gender === '' && n.name === '' && n.detail === '12';
})());
const row = { id: 'r1', rev: 2, resident_id: 'K001', resident_name: '架空 花子', report_kind: 'first', report_no: null, submit_date: '2026-02-16', prev_id: null, occurred_on: '2026-02-12', data: r1.data };
const f2 = C.followUp(row, 'nth', '2026-11-28');
t('写して第2報: 中身を写し、区分・番号・提出日・元の番号だけを変える', f2.id === null && f2.report_kind === 'nth' && f2.report_no === '2' && f2.prev_id === 'r1' && f2.submit_date === '2026-11-28' && f2.data.name === '架空 花子' && f2.data !== row.data);
t('第3報から写すと第4報・最終報告は番号なし', C.followUp(Object.assign({}, row, { report_kind: 'nth', report_no: 3 }), 'nth', '').report_no === '4' && C.followUp(row, 'final', '').report_no === '' && C.followUp(row, 'final', '').report_kind === 'final');
t('区分の名前', C.kindLabel('first') === '第1報' && C.kindLabel('nth', 3) === '第3報' && C.kindLabel('final') === '最終報告');
t('施設情報が読めない時（名前が1つも無い）は、保存済みの事業所の正式名の写しを残す', (function () {
  const kept = Object.assign({}, rep, { data: Object.assign({}, rep.data, { officeNames: ['旧い見本の施設', '', ''] }) });
  return C.toSave(kept, {}).data.officeNames[0] === '旧い見本の施設' && C.toSave(kept, null).data.officeNames[0] === '旧い見本の施設' && C.toSave(kept, FAC).data.officeNames[0] === '有料老人ホーム 見本ホーム';
})());
t('並び: 発生日の新しい順 → 更新の新しい順', C.sortReports([{ id: 'a', occurred_on: '2026-01-01', updated_at: '1' }, { id: 'b', occurred_on: '2026-02-01', updated_at: '1' }, { id: 'c', occurred_on: '2026-01-01', updated_at: '2' }]).map((x) => x.id).join() === 'b,c,a');
t('変更の有無は保存の形で比べる（写した正式名は比べない）', C.sameReport(rep, JSON.parse(JSON.stringify(rep))) && !C.sameReport(rep, Object.assign({}, rep, { submit_date: '' })));

group('6. 未記入の数');
const m0 = C.missing(C.blankData());
t('空の報告の未記入（1〜8・9 は数えない）', m0[1] === 1 && m0[2] === 5 && m0[3] === 8 && m0[4] === 5 && m0[5] === 2 && m0[6] === 4 && m0[7] === 1 && m0[8] === 1 && m0[9] === 0, m0);
const m1 = C.missing(Object.assign(C.blankData(), { severity: ['death', 'other'], consult: ['ambulance'], diag: ['fracture'] }));
t('死亡を選べば死亡年月日・その他なら括弧の中・救急搬送なら医療機関と診断名・骨折なら部位も数える', m1[1] === 2 && m1[5] === 1 + 2 + 1, m1);
t('入居者マスタから入れた後は 3 対象者の未記入が 0', C.missing(r1.data)[3] === 0);

group('7. 別紙');
t('別紙に出すのは最小でも収まらなかった欄（様式の順・空の欄は出さない）', (function () {
  const it = C.sheetItems(Object.assign(C.blankData(), { cause: '原因', detail: '詳細', note: '' }), ['cause', 'detail', 'note']);
  return it.map((x) => x.key).join() === 'detail,cause' && it[0].label === '発生時状況、事故内容の詳細' && it[0].text === '詳細';
})());
t('文字の大きさの段階（最小 2.0mm まで・最小より小さい基準はそのまま）', C.fitSteps(3).join() === '3,2.8,2.6,2.4,2.2,2' && C.fitSteps(1.9).join() === '1.9');

group('8. 紙の材料');
const pd = Object.assign(C.blankData(), r1.data, { place: ['room1'], kind: ['fall'], familyRel: ['child'], detail: '<b>見本</b>\n二行目', familyDate: '2026-02-12', occurDate: '2026-02-12', occurHour: '6', occurMin: '30' });
const html = C.paperHtml({ data: pd, kind: 'first', no: '', submit: '2026-02-16', fac: FAC, over: {} });
t('A4 縦の2ページ（別紙なし）', (html.match(/class="ar-page"/g) || []).length === 2 && html.indexOf('ar-sheet2') < 0);
t('題は施設情報の市区町村', html.indexOf('事故報告書　（事業者→見本市）') >= 0);
t('市区町村が空なら（事業者→　　）', C.paperHtml({ data: pd, fac: Object.assign({}, FAC, { municipality: '' }) }).indexOf('（事業者→　　）') >= 0);
t('赤字の注記2か所（文の中の「（電話での第一報を除く）」と報告区分の下）', (html.match(/class="ar-red"/g) || []).length === 2 && html.indexOf('<span class="ar-red">（電話での第一報を除く）</span>') >= 0 && html.indexOf('<span class="ar-red">※電話での第一報を除く</span>') >= 0);
const LABELS = ['事故状況の程度', '死亡に至った場合<br>死亡年月日', '法人名', '事業所（施設）名', '事業所番号', 'サービス種別', '所在地', '氏名・年齢・性別', 'サービス提供開始日', '保険者', '住所', '身体状況',
  '要介護度', '認知症高齢者<br>日常生活自立度', '発生日時', '分頃（24時間表記）', '発生場所', '事故の種別', '発生時状況、事故内容の詳細', 'その他<br>特記すべき事項', '発生時の対応', '受診方法', '受診先', '医療機関名',
  '連絡先（電話番号）', '診断名', '診断内容', '検査、処置等の概要', '利用者の状況', '家族等への報告', '報告した家族等の<br>続柄', '報告年月日', '連絡した関係機関<br>(連絡した場合のみ)',
  '本人、家族、関係先等<br>への追加対応予定', '7 事故の原因分析<br>（本人要因、職員要因、環境要因の分析）', '8 再発防止策<br>（手順変更、環境変更、その他の対応、<br>再発防止策の評価時期および結果等）', '9 その他<br>特記すべき事項', '（できるだけ具体的に記載すること）',
  '※選択肢については該当する項目をチェックし、該当する項目が複数ある場合は全て選択すること'];
const missLab = LABELS.filter((l) => html.indexOf(l) < 0);
t('様式の欄の名前と注記が全部ある', missLab.length === 0, missLab);
t('「（できるだけ具体的に記載すること）」は7と8の2か所', (html.match(/（できるだけ具体的に記載すること）/g) || []).length === 2);
const allOpts = C.GROUPS.filter((g) => g !== 'offices').every((g) => C.OPTS[g].opts.every((o) => html.indexOf('data-g="' + g + '" data-id="' + o.id + '"') >= 0));
t('選択肢は全部、紙の上で押せる印（data-g・data-id）を持つ', allOpts);
t('選んだ物だけに丸（性別 女性・転倒・子、・入所・要介護4・Ⅲa・第1報）', /class="ar-o ar-on" data-g="gender" data-id="f"/.test(html) && /class="ar-o" data-g="gender" data-id="m"/.test(html)
  && /class="ar-o ar-on" data-g="kind" data-id="fall"/.test(html) && /class="ar-o ar-on ar-tight" data-g="familyRel" data-id="child"/.test(html) && /class="ar-o ar-on" data-g="serviceKinds" data-id="in"/.test(html)
  && /class="ar-o ar-on ar-pill" data-g="careLevel" data-id="要介護4"/.test(html) && /class="ar-o ar-on" data-g="dementia" data-id="IIIa"/.test(html) && /class="ar-o ar-on" data-g="report" data-id="first"/.test(html));
t('紙の選択肢の文言は様式のまま（Ⅰ〜Ⅳ・子、・受診(外来･往診)、）', html.indexOf('>Ⅲa<') >= 0 && html.indexOf('>子、<') >= 0 && html.indexOf('受診(外来･往診)、<br>自施設で応急処置') >= 0 && html.indexOf('医療処置関連（チューブ抜去等）') >= 0);
t('日付は別々の枠（西暦・年・月・日と値）', (html.match(/>西暦</g) || []).length === 4 && html.indexOf('>2026<') >= 0 && html.indexOf('>12<') >= 0 && html.indexOf('>30<') >= 0);
t('提出日の行', html.indexOf('提出日：西暦 2026 年 2 月 16 日') >= 0);
t('事業所の正式名（1つ目の後は空き、2つ目以降は・）と、選んだ施設に丸', /見本ホーム<\/span><span class="ar-gap"><\/span><span class="ar-o" data-g="offices" data-id="訪問"[^>]*>訪問介護 見本ヘルパー<\/span><span class="ar-dot">・<\/span><span class="ar-o" data-g="offices" data-id="通所"/.test(html)
  && /class="ar-o ar-on" data-g="offices" data-id="施設"/.test(html));
t('保存した時の正式名があればそれを刷る（施設情報が変わっても過去の紙は変わらない）', C.paperHtml({ data: Object.assign({}, pd, { officeNames: ['旧い見本の施設', '', ''] }), fac: FAC }).indexOf('旧い見本の施設') >= 0);
t('値は全部エスケープ（< を文字のまま）・改行は文字のまま（紙は pre-wrap で保つ）', html.indexOf('&lt;b&gt;見本&lt;/b&gt;\n二行目') >= 0 && html.indexOf('<b>見本</b>') < 0);
t('水色の枠の印（bl）がある', (html.match(/class="ar-c ar-bl/g) || []).length > 30);
t('別紙へ回した欄は「別紙のとおり」・別紙のページに欄の名前と全文', (function () {
  const h2 = C.paperHtml({ data: Object.assign({}, pd, { cause: '長い見本の原因' }), kind: 'first', fac: FAC, over: { cause: true } });
  return h2.indexOf('別紙のとおり') >= 0 && h2.indexOf('ar-sheet2') >= 0 && h2.indexOf('<div class="ar-s-l">事故の原因分析</div><div class="ar-s-t">長い見本の原因</div>') >= 0 && h2.indexOf('対象者：架空 花子') >= 0;
})());
t('第n報の番号は下線の所に入る', C.paperHtml({ data: pd, kind: 'nth', no: '3', fac: FAC }).indexOf('第<span class="ar-u">3</span>報') >= 0);
t('紙の寸法: 表の幅 177mm・1ページ目は余白 10mm の A4（高さ 276mm）に収まる', C.COLS[C.COLS.length - 1] === 1770 && C.TABLE_TOP1 + C.ROWS1.reduce((a, b) => a + b, 0) <= C.PAGE_H && C.ROWS2.reduce((a, b) => a + b, 0) <= C.PAGE_H);
t('紙の型の名前は全部 ar- で始まる（入力画面の .row などの汎用の型が紙に当たらない）', (function () {
  const bad = []; for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => { if (!/^ar-/.test(c)) bad.push(c); });
  return bad.length === 0;
})(), [...new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c && !/^ar-/.test(c)))]);
t('括弧の中の欄は、紙の欄の名前（data-fit）を持ち、閉じ括弧が欄の後ろにある（別紙へ回せる）', ['severityOther', 'placeOther', 'kindOther', 'consultOther', 'fracturePart', 'diagOther', 'familyOther', 'addressOther', 'agencyCity', 'agencyPolice', 'agencyOther']
  .every((k) => new RegExp('data-fit="' + k + '"[^>]*>[^<]*</div><span class="ar-p ar-cl"').test(html)));
t('事業所（施設）名の行が入らない時は別紙へ（名前を並べ、選んだ物に（選択））', (function () {
  const h3 = C.paperHtml({ data: pd, kind: 'first', fac: FAC, over: { offices: true } });
  return h3.indexOf('<div class="ar-s-l">事業所（施設）名</div><div class="ar-s-t">有料老人ホーム 見本ホーム（選択）\n訪問介護 見本ヘルパー\nデイサービス 見本の里</div>') >= 0 && /data-fit="offices"[^>]*>別紙のとおり/.test(h3);
})());
t('丸の形: 罫線・隣が近い選択肢（要介護度・施設敷地内の建物外・子の配偶者）は角の丸い長円の印、「子、」は小さな丸の印', (function () {
  const h4 = C.paperHtml({ data: Object.assign({}, pd, { place: ['yard'], familyRel: ['child', 'childSpouse'] }), fac: FAC });
  return /class="ar-o ar-on ar-pill" data-g="place" data-id="yard"/.test(h4) && /class="ar-o ar-on ar-pill ar-near" data-g="familyRel" data-id="childSpouse"/.test(h4)
    && /class="ar-o ar-on ar-tight" data-g="familyRel" data-id="child"/.test(h4) && C.OPTS.careLevel.opts.every((o) => new RegExp('class="ar-o[^"]*ar-pill[^"]*" data-g="careLevel" data-id="' + o.id + '"').test(h4));
})());
t('紙に zoom・transform を書かない', !/zoom|transform/.test(html));
t('計算の部品に施設の固有名詞・電話の形を書かない（見本の施設情報から読む）', (function () {
  const src = fs.readFileSync(path.join(ROOT, 'accident-report-calc.js'), 'utf8');
  return !/\d{2,4}-\d{2,4}-\d{4}/.test(src) && !/株式会社|有限会社|社会福祉法人/.test(src);
})());

group('9. 画面の決まり');
t('検索（名前・ふりがな・居室）・退居の方は出さない', C.searchResidents([{ id: '1', name: '架空 花子', kana: 'かくう はなこ', room: '201' }, { id: '2', name: '見本 太郎', kana: 'みほん', room: '102' }, { id: '3', name: '退居 見本', room: '101', active: false }], '').map((x) => x.id).join() === '2,1'
  && C.searchResidents([{ id: '1', name: '架空 花子', kana: 'かくう はなこ', room: '201' }], 'ハナコ').length === 1);
t('医療機関の候補（名前の重なりは1つ）', C.hospitalChoices([{ name: '見本病院', tel: '000' }, { name: '見本病院', tel: '111' }, { name: '' }]).length === 1);
t('端末に残すのは決まった値だけ（入力／紙の見た目）', C.pickPane('paper') === 'paper' && C.pickPane('<x>') === 'form' && C.pickPane(null) === 'form');

group('10. 施設情報の事故報告書の表記（accidentReport・代表者の決定 2026-11-28）');
{
  const esc = C.esc;
  const withAr = (ar) => Object.assign(JSON.parse(JSON.stringify(FAC)), { accidentReport: ar });
  const N3 = { 施設: '見本ホーム事業所', 訪問: '見本ヘルパー事業所', 通所: '見本デイ事業所' };
  const A3 = { 施設: '見本町１－２－３', 訪問: '見本町４－５－６', 通所: '見本町７－８－９' };
  const base = C.facOf(FAC);
  t('塊なし＝今と同じ（formalName・address）', JSON.stringify(C.facOf(FAC, null)) === JSON.stringify(base) && JSON.stringify(C.facOf(FAC, undefined)) === JSON.stringify(base)
    && base.offices['施設'].name === FAC.offices[0].formalName && base.offices['施設'].address === FAC.offices[0].address);
  t('塊が object でない（文字・一覧・数）＝今と同じ', ['見本', [1, 2], 5, true].every((v) => JSON.stringify(C.facOf(FAC, v)) === JSON.stringify(base)));
  const f3 = C.facOf(FAC, { officeNames: N3, officeAddresses: A3 });
  t('3つとも指定 → 名前と所在地が様式の書き方になる', C.OFFICE_KINDS.every((k) => f3.offices[k].name === N3[k] && f3.offices[k].address === A3[k]), f3.offices);
  t('事業所番号・法人名・市区町村は変えない', C.OFFICE_KINDS.every((k) => f3.offices[k].officeNo === base.offices[k].officeNo) && f3.corpName === base.corpName && f3.municipality === base.municipality);
  t('施設情報そのものに accidentReport があれば読む（省いた時）', JSON.stringify(C.facOf(withAr({ officeNames: N3, officeAddresses: A3 }))) === JSON.stringify(f3));
  t('第2引数があれば施設情報の中の accidentReport より第2引数（section の写し）を使う', C.facOf(withAr({ officeNames: N3 }), null).offices['施設'].name === base.offices['施設'].name);
  const f1 = C.facOf(FAC, { officeNames: { 訪問: '  見本ヘルパー事業所 ' } });
  t('1つだけ指定 → その事業所の名前だけ（前後の空白は除く）・ほかと所在地は今のまま', f1.offices['訪問'].name === '見本ヘルパー事業所' && f1.offices['施設'].name === base.offices['施設'].name
    && f1.offices['通所'].name === base.offices['通所'].name && C.OFFICE_KINDS.every((k) => f1.offices[k].address === base.offices[k].address));
  const bad = { officeNames: { 施設: 'あ'.repeat(61), 訪問: '', 通所: '見本デイ事業所' }, officeAddresses: { 施設: '見本\n町', 訪問: 5, 通所: '見本<町' } };
  const fb = C.facOf(FAC, bad);
  t('崩れた鍵（長すぎ・空・改行・< ・文字でない）は捨ててほかは効く', fb.offices['通所'].name === '見本デイ事業所' && fb.offices['施設'].name === base.offices['施設'].name && fb.offices['訪問'].name === base.offices['訪問'].name
    && C.OFFICE_KINDS.every((k) => fb.offices[k].address === base.offices[k].address), fb.offices);
  t('60字・80字ちょうどは使う・61字・81字は捨てる', C.facOf(FAC, { officeNames: { 施設: 'あ'.repeat(60) } }).offices['施設'].name === 'あ'.repeat(60)
    && C.facOf(FAC, { officeAddresses: { 施設: 'い'.repeat(80) } }).offices['施設'].address === 'い'.repeat(80)
    && C.facOf(FAC, { officeAddresses: { 施設: 'い'.repeat(81) } }).offices['施設'].address === base.offices['施設'].address);
  t('{ } > と制御文字（タブ）も捨てる', ['見本{', '見本}', '見本>', '見本\t事業所'].every((v) => C.facOf(FAC, { officeNames: { 施設: v } }).offices['施設'].name === base.offices['施設'].name));
  t('officeNames・officeAddresses が object でない時はその塊だけ捨てる', C.facOf(FAC, { officeNames: '見本', officeAddresses: { 施設: '見本町１－２－３' } }).offices['施設'].address === '見本町１－２－３');
  const noDay = JSON.parse(JSON.stringify(FAC)); noDay.offices = noDay.offices.filter((o) => o.kind !== '通所');
  const fn = C.facOf(noDay, { officeNames: { 通所: '見本デイ事業所', 施設: '見本ホーム事業所', 居宅: '見本居宅' } });
  t('offices に無い kind・知らない kind は捨てる', fn.offices['通所'].name === '' && fn.offices['施設'].name === '見本ホーム事業所' && !('居宅' in fn.offices));
  const lb = C.accidentLabelsOf(bad, FAC.offices);
  t('捨てた理由は場所と理由だけ（値を持たない）', lb.bad.length === 5 && lb.bad.every((b) => /^accidentReport\.office(Names|Addresses)\.(施設|訪問|通所)$/.test(b.where) && b.why.indexOf('あああ') < 0 && b.why.indexOf('見本') < 0), lb.bad);
  t('名前の無い事業所（get() が空で埋めた種類）は無いのと同じ', C.facOf({ offices: [{ kind: '施設', formalName: '見本ホーム', address: '' }, { kind: '通所', name: '', formalName: '', address: '' }] }, { officeNames: { 通所: '見本デイ事業所' } }).offices['通所'].name === '');
  t('塊なしは理由も無い', C.accidentLabelsOf(undefined, FAC.offices).bad.length === 0 && C.accidentLabelsOf(null, FAC.offices).bad.length === 0);

  /* 事業所を選んだ時・入居者を選んだ時に入る所在地 */
  let d = C.blankData(), pv = d.offices.slice();
  d = C.toggle(d, 'offices', '訪問'); d = C.linkOffices(d, pv, f3);
  t('事業所を選んだ時の所在地は様式の書き方・事業所番号は offices のまま', d.officeAddress === A3['訪問'] && d.officeNo === FAC.offices[1].officeNo);
  const fr = C.fromResident(C.blankData(), REC, f3, '2026-11-28');
  t('入居者を選んだ時の所在地は様式の書き方（施設）・法人名は今のまま', fr.data.officeAddress === A3['施設'] && fr.data.corpName === base.corpName && fr.data.offices.join() === '施設');
  const frRaw = C.fromResident(C.blankData(), REC, withAr({ officeAddresses: { 施設: '見本町１－２－３' } }), '2026-11-28');
  t('施設情報そのものを渡しても所在地は様式の書き方', frRaw.data.officeAddress === '見本町１－２－３');

  /* 保存の写し */
  const rep = C.blankReport({ id: 'K001', name: '架空 花子' }, '2026-11-28');
  rep.data = fr.data;
  const sv = C.toSave(rep, f3);
  t('保存の時に写す officeNames は様式の書き方（施設・訪問・通所の順）', JSON.stringify(sv.data.officeNames) === JSON.stringify([N3['施設'], N3['訪問'], N3['通所']]), sv.data.officeNames);
  t('塊なしの保存の写しは今と同じ（formalName）', JSON.stringify(C.toSave(rep, FAC).data.officeNames) === JSON.stringify(FAC.offices.map((o) => o.formalName)));
  /* 保存済みの報告は写しのまま（後で施設情報を変えても追従しない） */
  const opened = C.fromRow({ id: 'r1', rev: 1, report_kind: 'first', data: C.toSave(rep, FAC).data });
  const ph = C.paperHtml({ data: opened.data, kind: 'first', no: '', submit: '', fac: f3, over: {} });
  t('保存済みの報告を開くと、紙は保存した時の名前・所在地のまま（今の施設情報の書き方に変えない）', ph.indexOf(esc(FAC.offices[0].formalName)) >= 0 && ph.indexOf(N3['施設']) < 0 && opened.data.officeAddress === A3['施設']);
  /* 紙の HTML */
  const nd = C.blankData(); nd.offices = ['訪問'];
  const p3 = C.paperHtml({ data: nd, kind: 'first', no: '', submit: '', fac: f3, over: {} });
  t('紙の事業所（施設）名の並びに指定した名前が出る（丸は選んだ事業所）', C.OFFICE_KINDS.every((k) => p3.indexOf('aria-label="事業所：' + N3[k] + '"') >= 0) && /ar-o ar-on" data-g="offices" data-id="訪問"/.test(p3));
  const pe = C.paperHtml({ data: C.blankData(), kind: 'first', no: '', submit: '', fac: C.facOf(FAC, { officeNames: { 施設: '見本&"ホーム\'' } }), over: {} });
  t('指定した名前は紙でエスケープされる', pe.indexOf('見本&amp;&quot;ホーム&#39;') >= 0 && pe.indexOf('見本&"ホーム') < 0);
  const sh = C.sheetItems(nd, ['offices'], f3);
  t('別紙に回した時の名前も指定した名前', sh.length === 1 && sh[0].text.indexOf(N3['訪問'] + '（選択）') >= 0);
}

say('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
if (fail) process.exitCode = 1;
