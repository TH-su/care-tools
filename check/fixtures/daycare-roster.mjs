/* check/fixtures/daycare-roster.mjs — デイ利用表を架空データで開き、階の見出しが出る帳票の紙を撮るための材料（2026-11-02 新設・品質改善 第3期 便8）
 *
 * 使い方は check/fixtures/care-schedule.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（接続先を架空の住所にする・事務所PCとして開く・切り替えスイッチは全部切）
 *   match   … 横取りする通信の住所（ネットへは出ない）
 *   respond(body) … 横取りした要求（統合同期 GAS への POST 本文 {action, key, ...}）に返す応答。週間計画の共有データ（care_schedule_v2）を返す
 *   routes  … match 以外に横取りするもの（su-backend.json を「全部切」で返す）
 *   sheets  … 撮る帳票。デイ利用表は画面の切り替えが setView ではなく goto なので、prepare（ページの中で紙を組む関数）で撮る
 *
 * 規模: デイの利用者 15名（２階 7名・１階 6名・居室が未登録 2名）。月〜土に週1〜3回・入浴は一部。
 * 階は居室番号の先頭の数字で決まる（画面の roomToFloor）。施設情報は撮影の道具が見本（facility-profile.sample.json＝１階・２階）を配る。
 * 入居者マスタの接続先は入れない（入院・訪問診療・居室を重ねに行かない）。
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は記号的な漢字の見本（架空・見本・試験…＋甲・乙・丙…）。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
 */
import { URL, match, FLAGS_OFF, routes, createKv } from './care-schedule.mjs';

export { URL, match, routes };
export const storage = {
  su_sync_common: JSON.stringify({ endpoint: URL, token: 'check-dummy', updatedAt: 1 }),
  su_device_role: 'office',
  su_backend_flags: JSON.stringify(FLAGS_OFF),
};

/* ── 架空の利用者 15名 ──（居室・かな・デイの曜日 [0=月…5=土]・入浴の曜日・時間帯） */
const SEI = ['架空', '見本', '試験', '仮名', '模擬'];
const MEI = ['甲', '乙', '丙'];
const KANA = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ'];
const ROOMS = ['201', '202', '203', '205', '206', '207', '208', '101', '102', '103', '105', '106', '107', '', ''];
const DAYS = [[0, 2, 4], [1, 3], [0, 3, 5], [2], [1, 4], [0, 2], [3, 5], [0, 1, 4], [2, 5], [1, 3], [0], [4, 5], [2, 3], [0, 4], [1]];
const TIMES = [['09:30', '16:00'], ['09:30', '12:30']];
export const RESIDENT_N = 15;
export const residentName = (i) => `${SEI[i % SEI.length]} ${MEI[Math.floor(i / SEI.length) % MEI.length]}`;
export const residents = Array.from({ length: RESIDENT_N }, (_, i) => ({
  id: 'dc' + String(i + 1).padStart(3, '0'), name: residentName(i), kana: KANA[i] + 'みほん', room: ROOMS[i],
  careLevel: '要介護' + (1 + (i % 5)), copayRate: 1, welfareEquipUnits: 0, external: false,
  events: DAYS[i].map((dow, k) => ({
    id: `d${i}_${dow}`, dayOfWeek: dow, serviceType: 'daycare', category: '',
    startTime: TIMES[i % 4 === 3 ? 1 : 0][0], endTime: TIMES[i % 4 === 3 ? 1 : 0][1],
    detail: '入浴・機能訓練', notes: '', units: 0, bathing: k === 0 && i % 3 !== 2,
  })),
}));
export function careDb() { return { residents: JSON.parse(JSON.stringify(residents)) }; }

const shared = createKv({ care_schedule_v2: careDb() });
export const kv = shared.kv;
export const stats = shared.stats;
export function respond(body) { return shared.respond(body); }

/* 名簿を読み終えるのを待ち、タブを開いて、「🖨 印刷」と同じ印刷部品（SUPrint）で紙を準備する（印刷のダイアログは開かない）。保存はしない。
   ページの中で動く（snap.mjs が evaluate する）ので、外の変数を使わない */
const prepare = async (sc) => {
  for (let i = 0; i < 100 && !(typeof DB === 'object' && DB && Array.isArray(DB.residents) && DB.residents.length); i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof goto !== 'function' || !window.SUPrint || typeof DB !== 'object' || !DB || !DB.residents.length) return false;
  goto(sc);
  window.print = function () {};
  window.SUPrint.print(sc);
  return document.body.classList.contains('su-printing');
};
export const sheets = [
  { key: 'roster', arg: 'sc-roster', ready: '#roster tbody th.col-flr', prepare },      // 利用表（階の欄）
  { key: 'daylist', arg: 'sc-daylist', ready: '#tblDaylist th.c-sec', prepare },        // デイ利用者一覧表（区画の見出し・A3縦）
  { key: 'allweek', arg: 'sc-allweek', ready: '#tblAllweek th.sec-h', prepare },        // 全員リスト（区画の見出し）
];
