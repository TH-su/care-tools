/* check/fixtures/resident-master.mjs — 入居者マスタの帳票を、架空の入居者16名で撮るための材料（2026-10-26 新設）
 *
 * snap.mjs が画面ごとに check/fixtures/<画面名>.mjs を探し、あれば「帳票の紙」も撮る（画面のコードは1行も変えない）。
 *   storage … 開く前に端末へ入れる設定（接続先を架空の住所にする・事務所PCとして開く）
 *   match   … 撮影の間だけ横取りする通信の住所（ネットへは出ない）
 *   respond(body) … 横取りした要求（入居者マスタ GAS への POST 本文）に返す応答
 *   sheets  … 撮る帳票。view＝画面の表示の切り替え（setView）、print＝印刷部品（SUPrint）のビュー名、ready＝描き終わりの目印
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名・居宅名・ケアマネ名は実在しない見本の語、電話は 000- で始まる架空の番号。
 * ★日付は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の前で決め打ち（年齢・入居日数が撮るたびに変わらない）。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
 */
/* 住所は画面の守り（CSP の connect-src）が通す Google の形にする（check.invalid のような住所は画面が断る）。
   撮影の間は match に当たる要求を全部横取りするので、この住所へ実際に出て行くことはない */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/**';
/* ログインの確かめ（su-app-gate.js・2026-10-29 代表者の決定）: 入居者マスタはログインして役割を確かめてから名簿を読む。
   撮影の間だけ、架空の事務所のアカウントでログインしている端末にし、Supabase への通信を全部横取りして決まった応答を返す。
   ★鍵・メールアドレスは架空（example.invalid）。本物の Supabase へは出ない（match に当たる要求は全部ここで答える）。
   ★ログインの確かめと「アプリの使える人」の答えだけを返し、ほかの要求（名簿の写しなど）は「無い」と答える＝今までどおり Google（上の架空の GAS）から読む */
const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_JWT = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: '00000000-0000-4000-8000-0000000c4eck', email: 'check-office@example.invalid', role: 'authenticated', aal: 'aal1', exp: 4102444800 }) + '.check';
const FAKE_SESSION = JSON.stringify({
  access_token: FAKE_JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
  user: { id: '00000000-0000-4000-8000-0000000c4eck', email: 'check-office@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
});
export const storage = {
  rmaster_cfg: JSON.stringify({ url: URL, token: 'check-dummy' }),
  su_device_role: 'office',
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
};
export const routes = [{
  match: SB + '/**',
  handle(route) {
    const u = route.request().url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
    if (/\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role: 'office', mfa: false });
    if (/\/rest\/v1\/allowed_accounts/.test(u)) return json({ role: 'office', label: '' });
    if (/\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role: 'office', rules: null, mine: null, updatedAt: null });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST202', message: 'check fixture: not served' }) });
  },
}];

export const sheets = [
  { key: 'cm', view: 'cm', print: 'cm', ready: '#cmSheet table.cmtbl tbody tr' },   // 現入居者家族CM表（A4横）
  { key: 'lvl', view: 'lvl', print: 'lvl', ready: '#lvlSheet table.lvltbl' },       // 介護度別表（A4縦）
  /* 2026-11-03 案A で足した帳票（架空の16名に、家族・病名・既往歴・定期薬・認定期間・食形態の架空の値を持たせて撮る） */
  { key: 'room', view: 'room', print: 'room', ready: '.rp-sheet' },                          // 入居者居室一覧（A4横・1階と2階の2枚）
  { key: 'fam', view: 'fam', print: 'fam', ready: '#famSheet table tbody tr' },              // 家族情報一覧（A3縦）
  { key: 'hist', view: 'hist', print: 'hist', ready: '#histSheet table tbody tr' },          // 病歴・内服薬一覧（A3縦）
  /* 薬効辞書（md）は撮らない: 辞書が先に届くと、処方のまとめ読みが終わっても表が描き直されず「取得しています…」のまま残る（画面の不具合・別に直す） */
  { key: 'cert', view: 'cert', print: 'cert', ready: '#certSheet table tbody tr' },          // 認定期限の一覧（A4縦）
  { key: 'mf', view: 'mf', print: 'mf', ready: '#mfSheet .mf-page' },                  // 食形態一覧（配布用・A4縦）
];

const SEI = [['架空', 'カクウ'], ['見本', 'ミホン'], ['試験', 'シケン'], ['仮名', 'カメイ']];
const MEI = [['一郎', 'イチロウ'], ['花子', 'ハナコ'], ['二郎', 'ジロウ'], ['春子', 'ハルコ']];
const LEVELS = ['要介護1', '要介護2', '要介護3', '要介護4', '要介護5', '要介護3', '要介護2', '要介護4',
  '要介護1', '要介護5', '要介護3', '要介護2', '要介護4', '要支援2', '要介護3', '要介護1'];
const OFFICES = [
  ['みほん居宅介護支援センターA', '見本 ケア一', '000-0000-0101', '000-0000-0102'],
  ['みほん居宅介護支援センターA', '見本 ケア二', '000-0000-0101', '000-0000-0102'],
  ['かくう居宅支援事業所B', '架空 支援一', '000-0000-0201', '000-0000-0202'],
  ['しけんケアプランC', '試験 計画一', '000-0000-0301', ''],
  ['', '', '', ''],   // 居宅の登録なし（未登録の方の扱いも紙に出す）
];
const pad = (n) => String(n).padStart(2, '0');

const residents = Array.from({ length: 16 }, (_, i) => {
  const [sei, seiK] = SEI[i % 4], [mei, meiK] = MEI[Math.floor(i / 4)];
  const off = OFFICES[i % OFFICES.length];
  return {
    id: 'R' + pad(i + 1),
    name: `${sei} ${mei}`,
    kana: `${seiK} ${meiK}`,
    room: String(i < 8 ? 101 + i : 201 + (i - 8)),
    gender: i % 2 ? '女' : '男',
    careLevel: LEVELS[i],
    active: true,
    updatedAt: '2026-01-01T09:00:00+09:00',
    birthDate: `19${30 + (i % 15)}-${pad(1 + (i % 12))}-${pad(1 + ((i * 7) % 28))}`,
    height: String(145 + (i % 20)),
    dischargeDate: '',
    admissionDate: `20${20 + (i % 6)}-${pad(1 + ((i * 5) % 12))}-${pad(1 + ((i * 3) % 28))}`,
    careOffice: off[0], careManager: off[1], careOfficeTel: off[2], careOfficeFax: off[3],
    /* 認定期間・負担割合（認定期限の一覧・家族情報一覧の負担割合）。終わりの日は撮影の固定時刻（2026-01-14）の前後に散らす */
    careCertStart: `2025-${pad(1 + (i % 12))}-01`, careCertEnd: `2026-${pad(1 + (i % 12))}-${pad(28 - (i % 3))}`,
    copayRate: ['1割', '2割', '3割', '1割'][i % 4],
    /* 家族（家族情報一覧）。架空の氏名・架空の電話（000-）・架空の住所。緊急連絡先の印は1人目だけ */
    family: (i % 5 === 4) ? [] : [
      { name: `${sei} 長${i % 2 ? '女' : '男'}`, relation: i % 2 ? '長女' : '長男', phone: `000-1000-${pad(i + 1)}01`, address: `架空県見本市${i + 1}-1`, kp: true, emergency: true },
      ...(i % 3 === 0 ? [{ name: `${sei} 次${i % 2 ? '男' : '女'}`, relation: i % 2 ? '次男' : '次女', phone: '', address: `架空県試験町${i + 1}-2`, kp: false, emergency: false }] : []),
    ],
    /* 病名・既往歴・定期薬（病歴・内服薬一覧と薬効辞書）。病名・薬はすべて架空の語（実在の薬の名前は使わない） */
    diseases: [{ name: `架空の病名${'ABCD'[i % 4]}`, onset: `20${10 + (i % 10)}年`, hospital: 'みほん内科医院' }],
    pastHistory: i % 2 ? '架空の既往歴（試験）' : '',
    medsRegular: [`架空錠${'ABC'[i % 3]} 5mg 1錠 朝食後`, ...(i % 2 ? [`見本カプセル${'XY'[i % 2]} 1カプセル 夕食後`] : [])].join('\n'),
    /* 食形態（食形態一覧）。主食・副食・備考・アレルギーは架空の値 */
    mealStaple: ['常食', '軟飯', '全粥', 'ミキサー'][i % 4], mealSide: ['常食', '一口大', 'きざみ', 'ミキサー'][i % 4],
    mealNote: i % 3 ? '' : '架空の備考（とろみ付け）', allergy: i % 5 === 0 ? '架空のアレルゲン' : 'なし', sideEffects: '',
  };
});
/* 薬効辞書（getMedDict）の架空の行。1つは薬剤師の確かめ済み（ok）、ほかは未確認（＊が付く） */
const MED_DICT = [
  { name: '架空錠A', effect: '架空の効能（降圧の見本）', ok: true },
  { name: '架空錠B', effect: '架空の効能（整腸の見本）', ok: false },
  { name: '見本カプセルY', effect: '架空の効能（睡眠の見本）', ok: false },
];

const ROSTER_KEYS = ['id', 'name', 'kana', 'room', 'gender', 'careLevel', 'active', 'updatedAt', 'birthDate', 'height', 'dischargeDate'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/* 画面が送る要求（{action, token, ...}）に返す応答。帳票に要らない要求には「中身なし」を返す（失敗にはしない） */
export function respond(body) {
  const a = body && body.action;
  if (a === 'getRoster') return { ok: true, roster: residents.map((r) => pick(r, ROSTER_KEYS)), stateRev: 1 };
  if (a === 'getBulk') return { ok: true, rows: residents.map((r) => ({ ...r })) };
  /* 家族情報一覧・病歴薬一覧のまとめ読み（在籍者の5項目） */
  if (a === 'getListFull') return { ok: true, rows: residents.map((r) => ({ id: r.id, family: r.family, diseases: r.diseases, currentDiseases: '', pastHistory: r.pastHistory, medsRegular: r.medsRegular })) };
  if (a === 'getResident') { const r = residents.find((x) => String(x.id) === String(body.id)); return r ? { ok: true, record: JSON.parse(JSON.stringify(r)) } : { ok: false, error: 'not found' }; }
  if (a === 'getMedDict') return { ok: true, rows: MED_DICT.map((x) => ({ ...x })) };
  if (a === 'getMealList') return { ok: true, rows: residents.map((r) => ({ id: r.id, name: r.name, kana: r.kana, room: r.room, careLevel: r.careLevel, copayRate: r.copayRate, birthDate: r.birthDate, mealStaple: r.mealStaple, mealSide: r.mealSide, mealNote: r.mealNote, allergy: r.allergy, sideEffects: r.sideEffects })) };
  if (a === 'stateRev') return { ok: true, rev: 1 };
  return { ok: true };
}
