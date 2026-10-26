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
export const storage = {
  rmaster_cfg: JSON.stringify({ url: URL, token: 'check-dummy' }),
  su_device_role: 'office',
};

export const sheets = [
  { key: 'cm', view: 'cm', print: 'cm', ready: '#cmSheet table.cmtbl tbody tr' },   // 現入居者家族CM表（A4横）
  { key: 'lvl', view: 'lvl', print: 'lvl', ready: '#lvlSheet table.lvltbl' },       // 介護度別表（A4縦）
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
  };
});

const ROSTER_KEYS = ['id', 'name', 'kana', 'room', 'gender', 'careLevel', 'active', 'updatedAt', 'birthDate', 'height', 'dischargeDate'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/* 画面が送る要求（{action, token, ...}）に返す応答。帳票に要らない要求には「中身なし」を返す（失敗にはしない） */
export function respond(body) {
  const a = body && body.action;
  if (a === 'getRoster') return { ok: true, roster: residents.map((r) => pick(r, ROSTER_KEYS)), stateRev: 1 };
  if (a === 'getBulk') return { ok: true, rows: residents.map((r) => ({ ...r })) };
  if (a === 'stateRev') return { ok: true, rev: 1 };
  return { ok: true };
}
