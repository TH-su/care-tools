/* check/fixtures/facility-profile.alt.mjs — 2つ目の架空の施設情報（2026-11-02・施設の差し替えの試験 facility-swap.mjs）
 *
 * 見本（facility-profile.sample.json）と、法人名・施設名・事業所名・正式名・電話・市区町村・住所・階の見出し・医療機関の名前が
 * 全部違う架空の施設。facility-profile.json をこれに差し替えて配り、全画面が見本の名前を出さずに動くかを確かめる。
 * ・形は見本と同じ（事業所の kind は 施設/訪問/通所 の3つで固定）。facility-secret-check.mjs の判定も通る形にしてある
 * ・電話は最初の組が 0 だけ・事業所番号は 000000 で始まる・住所は「架空」の語入り（公開の守りの試験 facility_names_zero が見本として通す形）
 * ・apps・scheduleColors・corpSettings.committeeDefaults は書かない（書かなければ既定で動くことも一緒に確かめる）
 * ★この名前は見本の名前と1文字列も共有しない（check/unit/facility_swap_test.js が確かめる）
 */
export default {
  version: 1,
  _note: '施設の差し替えの試験に使う2つ目の架空の施設。本番の値ではない',
  corpName: '架空ゆめ会',
  facilityName: '架空ゆめの家',
  municipality: '架空郷町',
  corpSettings: { homeGuidelineName: '', homeGuidelineUrl: '' },
  support: {
    contactName: '架空ゆめの家 受付',
    contactTel: '000-111-2222',
    hours: '平日 8:30〜17:30',
    emergency: '架空ゆめの家 受付 000-111-2222（時間外は当直の職員へ）',
    replyTarget: '受け付けてから5営業日以内',
  },
  offices: [
    { kind: '施設', type: '住宅型有料老人ホーム', name: '架空ゆめの家', formalName: '住宅型有料老人ホーム 架空ゆめの家', officeNo: '', address: '架空県架空郷町4-5-6', tel: '000-111-2222', aliases: [] },
    { kind: '訪問', type: '訪問介護', name: '架空ゆめ訪問', formalName: '訪問介護事業所 架空ゆめ訪問', officeNo: '0000000011', address: '架空県架空郷町4-5-6', tel: '000-111-2223', aliases: [] },
    { kind: '通所', type: '地域密着型通所介護', name: '架空ゆめデイ', formalName: '通所介護 架空ゆめデイ', officeNo: '0000000012', address: '架空県架空郷町4-5-6', tel: '000-111-2224', aliases: [] },
  ],
  floors: [{ no: 1, label: '一の階' }, { no: 2, label: '二の階' }],
  visitingClinics: [{ name: '架空ゆめ診療所', aliases: ['架空ゆめ診'] }],
  roomPlan: {
    f1: { title: '居室の割り当て（一の階）', align: 'left', ar: [800, 400], cols: [40, 180, 180, 180, 180, 40], rows: [40, 200, 160],
      cells: [{ r: 1, rs: 1, c: 1, room: '101' }, { r: 1, rs: 1, c: 2, room: '102' }, { r: 1, rs: 1, c: 3, room: '103' }, { r: 1, rs: 1, c: 4, room: '105' }] },
    f2: { title: '居室の割り当て（二の階）', align: 'left', ar: [800, 400], cols: [40, 180, 180, 180, 180, 40], rows: [40, 200, 160],
      cells: [{ r: 1, rs: 1, c: 1, room: '201' }, { r: 1, rs: 1, c: 2, room: '202' }, { r: 1, rs: 1, c: 3, room: '203' }, { r: 1, rs: 1, c: 4, room: '205' }] },
  },
};
