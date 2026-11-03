/* 設備・修繕の記録の純関数（equip-calc.js）の試験（2026-11-03 新設・本人の決定 2026-11-03）
   実行: node check/unit/equip_calc_test.js
   守ること: 場所の鍵・次回予定日・期限の判定・基準日の代わり・日付の順の逆転・年度の境・費用の合計と取り消しの除外・
            増やした項目の値の確かめ（共通 DB と同じ規則）・CSV（BOM・CRLF・引用符・増やした項目の列）・エスケープ・UI 状態の復元
   ★データはすべて架空（業者「架空設備」・部屋 101 など）。出力に console を使わない。 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', '..', 'equip-calc.js'));

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

group('1. 場所の鍵');
t('居室の箱は room:部屋番号', C.placeKeyOf({ r: 1, c: 1, rs: 1, cs: 1, room: '101' }) === 'room:101');
t('名前の箱は area:名前', C.placeKeyOf({ r: 2, c: 1, t: '厨房' }) === 'area:厨房');
t('その他の場所は place:id', C.placeKeyOf({ id: 'p-1', name: '駐車場', kind: 'facility' }) === 'place:p-1');
t('作れない時は空', C.placeKeyOf({ r: 1, c: 1 }) === '' && C.placeKeyOf(null) === '');
t('場所の名前: 居室・名前の箱・その他の場所・見つからない場所', C.placeLabel('room:101') === '101' && C.placeLabel('area:厨房') === '厨房'
  && C.placeLabel('place:p-1', [{ id: 'p-1', name: '駐車場' }]) === '駐車場' && C.placeLabel('place:zz', []) === '（見つからない場所）');
t('事業所の種類: 居室と名前の箱は施設・その他の場所は場所の kind', C.placeKind('room:101') === 'facility' && C.placeKind('area:厨房') === 'facility' && C.placeKind('place:p-2', [{ id: 'p-2', kind: 'visit' }]) === 'visit');

group('2. 次回予定日');
t('次回予定日: 2026-04-15 + 6か月 = 2026-10-15', C.nextDueDate('2026-04-15', 6) === '2026-10-15');
t('次回予定日: 年をまたぐ（2026-11-30 + 3か月 = 2027-02-28・月末に丸める）', C.nextDueDate('2026-11-30', 3) === '2027-02-28', C.nextDueDate('2026-11-30', 3));
t('次回予定日: うるう年の月末（2027-08-31 + 6か月 = 2028-02-29）', C.nextDueDate('2027-08-31', 6) === '2028-02-29');
t('次回予定日: 12か月・24か月', C.nextDueDate('2026-01-10', 12) === '2027-01-10' && C.nextDueDate('2026-01-10', 24) === '2028-01-10');
t('次回予定日: 周期が 0・負・小数・空・日付が無い時は空', ['', 0, -1, 1.5, 'x'].every((m) => C.nextDueDate('2026-01-10', m) === '') && C.nextDueDate('', 6) === '' && C.nextDueDate('2026-02-30', 1) === '');

group('3. 期限の判定（期限切れ・30日以内・それ以外）');
const TODAY = '2026-11-03';
t('期限の判定（期限切れ・30日以内・それ以外）: 期限切れ（昨日）', C.dueStatus('2026-11-02', TODAY) === 'overdue');
t('期限の判定: 30日以内（今日・30日後）', C.dueStatus('2026-11-03', TODAY) === 'soon' && C.dueStatus('2026-12-03', TODAY) === 'soon');
t('期限の判定: それ以外（31日後）', C.dueStatus('2026-12-04', TODAY) === 'ok');
t('期限の判定: 日付が無い・形が違う時は空', C.dueStatus('', TODAY) === '' && C.dueStatus('2026/12/01', TODAY) === '');

group('4. 対応日なし時の代わり（done_on→found_on→全て無し）');
t('対応日なし時の代わり（done_on→found_on→全て無し）: 対応日がある時は対応日', C.effectiveDate({ found_on: '2026-04-01', handled_on: '2026-04-05', done_on: '2026-04-09' }) === '2026-04-05');
t('対応日なし時の代わり: 完了日（done_on）', C.effectiveDate({ found_on: '2026-04-01', done_on: '2026-04-09' }) === '2026-04-09');
t('対応日なし時の代わり: 完了日も無ければ故障日（found_on）', C.effectiveDate({ found_on: '2026-04-01', requested_on: '2026-04-02' }) === '2026-04-01');
t('対応日なし時の代わり: 全て無し（依頼日だけ）なら空', C.effectiveDate({ requested_on: '2026-04-02' }) === '' && C.effectiveDate({}) === '');

group('5. 日付の順の逆転の知らせ');
t('日付の順の逆転の知らせ: 順どおりなら知らせ無し', C.dateOrderWarnings({ found_on: '2026-04-01', requested_on: '2026-04-02', handled_on: '2026-04-05', done_on: '2026-04-05' }).length === 0);
const w1 = C.dateOrderWarnings({ found_on: '2026-04-10', done_on: '2026-04-01' });
t('日付の順の逆転の知らせ: 完了日が故障日より前', w1.length === 1 && /完了日/.test(w1[0]) && /故障日/.test(w1[0]), w1);
const w2 = C.dateOrderWarnings({ found_on: '2026-04-01', requested_on: '2026-04-09', handled_on: '2026-04-05' });
t('日付の順の逆転の知らせ: 対応日が依頼日より前（空の欄は比べない）', w2.length === 1 && /対応日/.test(w2[0]) && /依頼日/.test(w2[0]), w2);
t('日付の順の逆転の知らせ: 全部空なら知らせ無し', C.dateOrderWarnings({}).length === 0);

group('6. 年度の境（3月31日と4月1日）');
t('年度の境: 2027-03-31 は 2026年度', C.fiscalYearOf('2027-03-31') === 2026);
t('年度の境: 2027-04-01 は 2027年度', C.fiscalYearOf('2027-04-01') === 2027);
t('年度の境: 2026-04-01 は 2026年度・2026-03-31 は 2025年度', C.fiscalYearOf('2026-04-01') === 2026 && C.fiscalYearOf('2026-03-31') === 2025);
t('年度: 日付でなければ null', C.fiscalYearOf('') === null && C.fiscalYearOf('2026-13-01') === null);

group('7. 費用の合計・取り消しの除外');
const ASSETS = [{ id: 'a1', kind: 'facility', name: '架空エアコン', place_key: 'room:101' }, { id: 'a2', kind: 'daycare', name: '架空冷蔵庫', place_key: 'place:p-d' }];
const PLACES = [{ id: 'p-d', kind: 'daycare', name: 'デイの台所' }, { id: 'p-v', kind: 'visit', name: '訪問の車' }];
const EVS = [
  { id: 'e1', asset_id: 'a1', place_key: 'room:101', etype: 'repair', handled_on: '2026-04-01', amount: 11000, vendor_id: 'v1' },
  { id: 'e2', asset_id: 'a1', place_key: 'room:101', etype: 'cleaning', done_on: '2027-03-31', amount: 5500, vendor_id: 'v1' },
  { id: 'e3', asset_id: 'a2', place_key: 'place:p-d', etype: 'repair', found_on: '2026-05-01', amount: 3300, vendor_id: 'v2' },
  { id: 'e4', asset_id: null, place_key: 'place:p-v', etype: 'inspection', handled_on: '2026-06-01', amount: 2200, vendor_id: null },
  { id: 'e5', asset_id: 'a1', place_key: 'room:101', etype: 'repair', handled_on: '2026-07-01', amount: 99999, vendor_id: 'v1', cancelled_at: '2026-07-02T00:00:00Z' },
  { id: 'e6', asset_id: 'a1', place_key: 'room:101', etype: 'other', handled_on: '2026-03-31', amount: 700, vendor_id: 'v1' },
  { id: 'e7', asset_id: null, place_key: 'area:厨房', etype: 'repair', requested_on: '2026-05-05', amount: 800 },
  { id: 'e8', asset_id: null, place_key: 'area:厨房', etype: 'repair', amount: 1000, cancelled_at: '2026-05-06T00:00:00Z' }
];
const S = C.summarize(EVS, 2026, { assets: ASSETS, places: PLACES });
t('費用の合計: 2026年度は 4件・22000円（3月31日と4月1日の境・取り消し・日付なしを除く）', S.total.count === 4 && S.total.amount === 11000 + 5500 + 3300 + 2200, S.total);
t('費用の合計: 事業所ごと（施設・通所・訪問）', S.by_office.facility.amount === 16500 && S.by_office.daycare.amount === 3300 && S.by_office.visit.amount === 2200, S.by_office);
t('費用の合計: 種類ごと・業者ごと（業者なしは空の鍵）', S.by_kind.repair.amount === 14300 && S.by_kind.cleaning.amount === 5500 && S.by_vendor.v1.amount === 16500 && S.by_vendor[''].amount === 2200, { k: S.by_kind, v: S.by_vendor });
t('取り消しの除外: 取り消した記録（99999円）は合計に入らない', !Object.values(S.by_kind).some((x) => x.amount >= 99999) && S.total.amount < 99999);
t('日付なし: 基準日の無い記録は別に数える（取り消しは除く）', S.undated.count === 1 && S.undated.amount === 800, S.undated);
t('費用の合計: 2025年度には 3月31日の 700円だけ', C.summarize(EVS, 2025, { assets: ASSETS, places: PLACES }).total.amount === 700);
t('費用の合計: 金額が負・数でない値は 0 円として数える（DB は保存の時に断る）', C.summarize([{ handled_on: '2026-05-01', amount: -5 }, { handled_on: '2026-05-01', amount: 'x' }], 2026).total.amount === 0);

group('8. 予定（取り消しの除外を含む）');
const SA = [
  { id: 'a1', status: 'active', cycle_months: 6, bought_on: '2026-01-10', next_due: null },
  { id: 'a2', status: 'active', next_due: '2026-11-20' },
  { id: 'a3', status: 'retired', next_due: '2026-11-04' },
  { id: 'a4', status: 'repairing', cycle_months: 12 }
];
const SE = [
  { id: 'x1', asset_id: 'a2', handled_on: '2026-10-01', next_due: '2027-04-01' },
  { id: 'x2', asset_id: 'a2', handled_on: '2026-10-20', next_due: '2026-10-30', cancelled_at: '2026-10-21T00:00:00Z' },
  { id: 'x3', asset_id: null, place_key: 'area:厨房', handled_on: '2026-09-01', next_due: '2026-12-01' }
];
const SC = C.schedule(SA, SE, TODAY);
t('予定: 周期と購入日から出す（a1 は 2026-07-10＝期限切れ）', SC.some((x) => x.asset_id === 'a1' && x.due === '2026-07-10' && x.status === 'overdue'), SC);
t('取り消しの除外: 予定は取り消した記録の次回予定日を使わない（a2 は 2027-04-01）', SC.some((x) => x.asset_id === 'a2' && x.due === '2027-04-01' && x.status === 'ok'), SC);
t('予定: 廃棄の設備は出さない・日付を出せない設備は出さない', !SC.some((x) => x.asset_id === 'a3' || x.asset_id === 'a4'));
t('予定: 設備に付かない記録の次回予定日も出す（30日以内）', SC.some((x) => x.event_id === 'x3' && x.status === 'soon'));
t('予定: 日付の早い順', SC.map((x) => x.due).join() === SC.map((x) => x.due).slice().sort().join());

group('9. 時系列の並び');
const SO = C.sortEvents([{ id: 'n1', created_at: '2026-05-01T00:00:00Z' }, { id: 'd1', handled_on: '2026-04-01' }, { id: 'd2', found_on: '2026-06-01' }, { id: 'n2', created_at: '2026-06-01T00:00:00Z' }]);
t('時系列: 基準日の新しい順・日付なしは後ろで作った時刻の新しい順', SO.map((x) => x.id).join() === 'd2,d1,n2,n1', SO.map((x) => x.id));

group('10. 増やした項目の値の確かめ（date・number・select・text 500字・未知の鍵）');
const F = [
  { id: 'f-date', target: 'event', name: '見積受領日', ftype: 'date', sort: 1 },
  { id: 'f-num', target: 'event', name: '見積額', ftype: 'number', sort: 2 },
  { id: 'f-sel', target: 'event', name: '緊急度', ftype: 'select', options: ['高', '中', '低'], sort: 3 },
  { id: 'f-txt', target: 'event', name: '見積番号', ftype: 'text', sort: 4 },
  { id: 'f-off', target: 'event', name: '旧の印', ftype: 'text', sort: 5, disabled: true },
  { id: 'f-asset', target: 'asset', name: '資産番号', ftype: 'text', sort: 1 }
];
const ok1 = C.validateExtra({ 'f-date': '2026-04-03', 'f-num': '12000', 'f-sel': '高', 'f-txt': 'A-1' }, F, 'event', {});
t('増やした項目の値の確かめ（date・number・select・text 500字・未知の鍵）: 正しい値は通り、数は数にする', ok1.ok && ok1.value['f-num'] === 12000 && ok1.value['f-date'] === '2026-04-03', ok1);
t('増やした項目 date: YYYY-MM-DD でない・暦に無い日は断る', !C.validateExtra({ 'f-date': '2026/04/03' }, F, 'event', {}).ok && !C.validateExtra({ 'f-date': '2026-02-30' }, F, 'event', {}).ok);
t('増やした項目 number: 数でない・無限は断る', !C.validateExtra({ 'f-num': 'abc' }, F, 'event', {}).ok && !C.validateExtra({ 'f-num': Infinity }, F, 'event', {}).ok);
t('増やした項目 select: 選択肢に無い語は断る', !C.validateExtra({ 'f-sel': '最高' }, F, 'event', {}).ok);
t('増やした項目 text 500字: 500字は通り 501字は断る', C.validateExtra({ 'f-txt': 'あ'.repeat(500) }, F, 'event', {}).ok && !C.validateExtra({ 'f-txt': 'あ'.repeat(501) }, F, 'event', {}).ok);
const unk = C.validateExtra({ 'f-zzz': 'x' }, F, 'event', {});
t('増やした項目 未知の鍵: 定義に無い鍵は断り、鍵の名前を出す', !unk.ok && unk.errors[0].key === 'f-zzz' && /f-zzz/.test(unk.errors[0].msg), unk);
t('増やした項目: 付け先の違う項目（設備向けを記録に）は断る', !C.validateExtra({ 'f-asset': 'x' }, F, 'event', {}).ok);
t('増やした項目: 使わない項目への新しい値は断る', !C.validateExtra({ 'f-off': '新しい' }, F, 'event', {}).ok && !C.validateExtra({ 'f-off': '新しい' }, F, 'event', { 'f-off': '古い' }).ok);
const keep = C.validateExtra({ 'f-txt': 'B-2' }, F, 'event', { 'f-off': '古い', 'f-txt': 'A-1' });
t('増やした項目: 使わない項目の今の値は、鍵ごと省いても残す', keep.ok && keep.value['f-off'] === '古い' && keep.value['f-txt'] === 'B-2', keep);
t('増やした項目: 使わない項目に今と同じ値を送れば通る', C.validateExtra({ 'f-off': '古い' }, F, 'event', { 'f-off': '古い' }).ok);
t('増やした項目: 今の保存値と同じ値は確かめ直さない（選択肢から外した語のままでも保存し直せる・共通 DB と同じ）', C.validateExtra({ 'f-sel': '最高' }, F, 'event', { 'f-sel': '最高' }).ok);
t('増やした項目: 空の値は鍵ごと落とす', JSON.stringify(C.validateExtra({ 'f-txt': '  ', 'f-num': '' }, F, 'event', {}).value) === '{}');
t('項目の定義: 名前 1〜20字・同じ付け先で重ねない・選択肢 1〜30個', C.validateField({ target: 'event', name: '見積受領日', ftype: 'date' }, F).length === 1
  && C.validateField({ target: 'asset', name: '見積受領日', ftype: 'date' }, F).length === 0 && C.validateField({ target: 'event', name: 'あ'.repeat(21), ftype: 'text' }, []).length === 1
  && C.validateField({ target: 'event', name: '区分', ftype: 'select', options: [] }, []).length === 1 && C.validateField({ target: 'event', name: '区分', ftype: 'select', options: ['a'] }, []).length === 0);
t('金額: 0 以上の整数だけ（負・小数・文字は断る・全角とカンマは読む）', C.parseAmount('12,000').value === 12000 && C.parseAmount('１２０').value === 120 && !C.parseAmount('-1').ok && !C.parseAmount('1.5').ok && !C.parseAmount('abc').ok && C.parseAmount('').value === 0);

group('11. CSV（引用符と改行・増やした項目の列）');
const csv = C.buildCsv([
  { id: 'e1', asset_id: 'a1', place_key: 'room:101', etype: 'repair', found_on: '2026-04-01', requested_on: '2026-04-02', handled_on: '2026-04-05', done_on: '2026-04-06', amount: 11000, vendor_id: 'v1', body: '「室外機」の音, 大きい\n2行目 "引用"', extra: { 'f-date': '2026-04-03', 'f-off': '古い' } },
  { id: 'e2', asset_id: null, place_key: 'area:厨房', etype: 'cleaning', amount: 0, body: '', cancelled_at: '2026-05-01T00:00:00Z', extra: {} }
], { assets: ASSETS, vendors: [{ id: 'v1', name: '架空設備' }], places: PLACES, fields: F, officeName: (k) => ({ facility: '施設の名前', daycare: '通所の名前', visit: '訪問の名前' }[k] || '') });
t('CSV: 先頭に BOM', csv.charCodeAt(0) === 0xFEFF);
t('CSV: 行の区切りは CRLF（中身の改行は引用符の中に残る）', csv.split('\r\n').length === 4 && /2行目/.test(csv.split('\r\n')[1]), csv.split('\r\n').length);
const head = csv.slice(1).split('\r\n')[0].split(',');
t('CSV: 固定の列（基準日〜取り消し）が先に並ぶ', head.slice(0, 13).join() === C.CSV_FIXED.join(), head);
t('CSV に増やした項目の列が出る（使わない項目は値がある時だけ・値の無い項目も使う項目なら出す）', head.slice(13).join() === '見積受領日,見積額,緊急度,見積番号,旧の印', head.slice(13));
t('CSV の引用符と改行: カンマ・改行・" を含む値は "…" で囲み " を2つにする', csv.indexOf('"「室外機」の音, 大きい\n2行目 ""引用"""') > 0);
const r2 = csv.split('\r\n')[2].split(',');
t('CSV: 取り消した記録は「取り消し」の列に印・日付なしの基準日は空', r2[12] === '取り消し' && r2[0] === '', r2);
t('CSV: 事業所・場所・設備・種類・業者・金額の値', /^2026-04-05,2026-04-01,2026-04-02,2026-04-05,2026-04-06,施設の名前,101,架空エアコン,修理,架空設備,11000,/.test(csv.slice(1).split('\r\n')[1]), csv.slice(1).split('\r\n')[1]);

const inj = C.buildCsv([{ id: 'e9', place_key: 'room:101', etype: 'repair', handled_on: '2026-04-05', amount: 5000, vendor_id: 'v9', body: '=HYPERLINK("http://x")', extra: {} }],
  { assets: [], vendors: [{ id: 'v9', name: '+架空業者' }], places: [], fields: [], officeName: () => '' }).slice(1).split('\r\n')[1];
t('CSV の数式よけ: = + - @ で始まる文字は先頭に \' を付け、金額（数）はそのまま', /,'\+架空業者,5000,/.test(inj) && /"'=HYPERLINK\(""http:\/\/x""\)"/.test(inj), inj);

group('12. エスケープ');
const BAD = '<img src=x onerror=alert(1)>"\'&';
t('<img onerror> がエスケープされる', C.esc(BAD) === '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;' && !/[<>"']/.test(C.esc(BAD)));
t('エスケープ: null・数も文字にする', C.esc(null) === '' && C.esc(0) === '0');

group('13. UI 状態の復元のホワイトリスト（未知値は既定へ）');
const FL = { floors: ['f1', 'f2'] };
const r = C.restoreUiState({ tab: 'cost', floor: 'f2', filter: JSON.stringify({ etype: 'repair', kind: 'daycare', place: 'room:101', vendor: 'v-1', fy: '2026' }) }, FL);
t('UI 状態の復元: 既知の値はそのまま戻す', r.tab === 'cost' && r.floor === 'f2' && r.filter.etype === 'repair' && r.filter.kind === 'daycare' && r.filter.place === 'room:101' && r.filter.vendor === 'v-1' && r.filter.fy === '2026', r);
const bad = C.restoreUiState({ tab: '<script>', floor: 'f9', filter: JSON.stringify({ etype: 'x', kind: 'office', place: 'javascript:1', vendor: '<b>', fy: '1999' }) }, FL);
t('UI 状態の復元のホワイトリスト（未知値は既定へ）: タブ・階・絞り込み', bad.tab === 'map' && bad.floor === 'f1' && JSON.stringify(bad.filter) === JSON.stringify(C.FILTER_DEF), bad);
t('UI 状態の復元: 壊れた控え（JSON でない・空）でも既定で起動する', C.restoreUiState({ filter: '{壊れ' }, FL).tab === 'map' && C.restoreUiState(null, null).floor === '' && C.restoreUiState(undefined).filter.fy === '');

group('14. 固定の表');
t('設備の種類は 10 種（空調〜その他）', C.CATEGORIES.map((x) => x.label).join() === '空調,厨房,PC・通信,家具・寝具,水回り,電気・照明,消防・防災,建物,車両,その他');
t('対応の種類は 7 種（購入〜その他）', C.EVENT_TYPES.map((x) => x.label).join() === '購入,修理,清掃,点検,交換,廃棄,その他');
t('タブは 7 つ（図面・設備・対応の記録・予定・費用・業者・項目の設定）', C.TABS.join() === 'map,assets,events,sched,cost,vendors,fields');

group('15. 探す（上部の検索1つ・U2）');
{
  const ctx = {
    vendors: [{ id: 'v1', name: '架空設備' }],
    fields: [{ id: 'fa1', target: 'asset', name: '資産番号', ftype: 'text' }, { id: 'fa2', target: 'asset', name: '購入日2', ftype: 'date' },
      { id: 'fd2', target: 'event', name: '緊急度', ftype: 'select', options: ['高', '低'] }],
    assets: [{ id: 'a1', name: '架空エアコン', maker: 'カクウ電機', model: 'AC-100', serial: 'SN-77', vendor_id: 'v1', extra: { fa1: 'K-001', fa2: '2026-01-01' } }],
    events: [{ id: 'e1', asset_id: 'a1', body: '架空の部品交換', vendor_id: null, extra: { fd2: '高' } }, { id: 'e2', asset_id: null, body: '駐車場の線引き', extra: {} }]
  };
  const A = ctx.assets[0];
  t('空の検索語は全部に合う（空白だけも）', C.matchAsset(A, '', ctx) && C.matchAsset(A, '  　', ctx) && C.matchQuery([], null));
  t('設備: 名前・メーカー・型番・製造番号・業者名・増やした項目（文字）で合う', ['エアコン', 'カクウ', 'ac-100', 'SN-77', '架空設備', 'K-001'].every((q) => C.matchAsset(A, q, ctx)));
  t('設備: 合わない語・日付の項目の値では合わない', !C.matchAsset(A, '冷蔵庫', ctx) && !C.matchAsset(A, '2026-01-01', ctx));
  t('全角・半角と大文字・小文字をそろえる（ＡＣ－１００ → ac-100）', C.matchAsset(A, 'ＡＣ－１００', ctx) && C.matchAsset(A, 'sn-77', ctx));
  t('語どうしは AND（全角の空白でも区切る）', C.matchAsset(A, 'エアコン　K-001', ctx) && !C.matchAsset(A, 'エアコン 冷蔵庫', ctx));
  t('記録: 内容・選択肢の値・付いている設備の名前と型番で合う', C.matchEvent(ctx.events[0], '部品', ctx) && C.matchEvent(ctx.events[0], '高', ctx) && C.matchEvent(ctx.events[0], 'AC-100', ctx) && C.matchEvent(ctx.events[0], '架空エアコン', ctx));
  t('記録: 設備に付かない記録は設備の語では合わない', C.matchEvent(ctx.events[1], '駐車場', ctx) && !C.matchEvent(ctx.events[1], 'エアコン', ctx));
  t('予定の行: 設備の行は設備で、記録の行は記録で照らす・見つからない行は合わない', C.matchSchedule({ asset_id: 'a1' }, 'SN-77', ctx) && C.matchSchedule({ asset_id: null, event_id: 'e2' }, '線引き', ctx)
    && !C.matchSchedule({ asset_id: null, event_id: 'e2' }, 'SN-77', ctx) && !C.matchSchedule({ asset_id: 'zz' }, 'SN', ctx) && C.matchSchedule({ asset_id: 'zz' }, '', ctx));
  t('検索語は 10 語・1語 100 字まで', C.queryTerms('a b c d e f g h i j k l').length === 10 && C.queryTerms('x'.repeat(150))[0].length === 100);
}

group('16. 図面の印・階の名前（U3）');
{
  const assets = [
    { id: 'a1', place_key: 'room:101', status: 'active', next_due: '2026-10-01' },
    { id: 'a2', place_key: 'room:101', status: 'repairing' },
    { id: 'a3', place_key: 'room:102', status: 'retired', next_due: '2026-01-01' },
    { id: 'a4', place_key: 'room:103', status: 'active', next_due: '2026-12-31' }
  ];
  const ev = [{ id: 'e9', asset_id: null, place_key: 'area:厨房', next_due: '2026-10-30', handled_on: '2026-04-01' }];
  const m = C.placeMarks(assets, ev, '2026-11-03');
  t('101: 設備2・期限切れあり・修理中あり', m['room:101'] && m['room:101'].count === 2 && m['room:101'].overdue === true && m['room:101'].repairing === true, m['room:101']);
  t('102: 廃棄だけは数えず印も付けない（鍵ごと無い）', !('room:102' in m), m['room:102']);
  t('103: 期限が先なら期限切れの印なし', m['room:103'] && m['room:103'].count === 1 && m['room:103'].overdue === false && m['room:103'].repairing === false);
  t('設備に付かない記録の期限切れも場所に印を付ける（厨房・設備0）', m['area:厨房'] && m['area:厨房'].count === 0 && m['area:厨房'].overdue === true);
  t('階の名前: title から「N階」を抜く・全角の数字もそろえる', C.floorLabel('1階', 'f1') === '1階' && C.floorLabel('本館 2階（居室）', 'f2') === '2階' && C.floorLabel('３階', 'f3') === '3階');
  t('階の名前: 抜けなければ title のまま・title が無ければ鍵', C.floorLabel('別館', 'b1') === '別館' && C.floorLabel('', 'f9') === 'f9' && C.floorLabel(null, 'f9') === 'f9');
}

group('17. 設備のカルテ（U7）');
{
  t('あと何日: 先は正・今日は 0・過ぎたら負・年をまたぐ', C.daysUntil('2026-11-10', '2026-11-03') === 7 && C.daysUntil('2026-11-03', '2026-11-03') === 0 && C.daysUntil('2026-10-31', '2026-11-03') === -3 && C.daysUntil('2027-01-01', '2026-12-31') === 1);
  t('あと何日: 日付でなければ null', C.daysUntil('', '2026-11-03') === null && C.daysUntil('2026-02-30', '2026-11-03') === null && C.daysUntil(null) === null);
  const evs = [
    { id: 'e1', asset_id: 'a1', handled_on: '2026-05-03', amount: 11000 },
    { id: 'e2', asset_id: 'a1', handled_on: '2026-08-01', amount: 5000, cancelled_at: '2026-08-02T00:00:00Z' },
    { id: 'e3', asset_id: 'a1', handled_on: '2026-09-01', amount: 2200 },
    { id: 'e4', asset_id: 'a2', handled_on: '2026-09-02', amount: 99999 }
  ];
  const h = C.assetHistory({ id: 'a1' }, evs);
  t('その設備の記録だけを新しい順に（取り消しも印のために含む）', h.events.map((e) => e.id).join() === 'e3,e2,e1', h.events.map((e) => e.id));
  t('累計費用は取り消しを除く（11000 + 2200 = 13200・2件）', h.total.amount === 13200 && h.total.count === 2, h.total);
  t('設備が無い・記録が無い時は空', C.assetHistory(null, evs).events.length === 0 && C.assetHistory({ id: 'zz' }, null).total.amount === 0);
}

say('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
