/* check/fixtures/weight-record.mjs — 体重管理を、架空データで開くための材料（2026-11-01 新設）
 *
 * 失敗を起こして数える道具（check/fail-inject/observe.mjs の wt-gas）が読む。
 *   seed()  … 見本の体重管理 GAS（check/fail-inject/gas-script.mjs の createWeightBackend）に置く中身
 *             （入居者3名・記録なし・しきい値なし。形は weight-api.gs の getAll と同じ residents・records・thresholds）
 *   FLAGS   … su-backend.json を「全部切」（weight も切＝Google の道だけで動かす）で返す旗
 *   storage … 開く前に端末へ入れる設定（接続先は道具が架空の住所に差し替える・事務所PCとして開く）
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は記号的な見本（架空A・架空B・架空C）。居室も架空。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
 */
import { FLAGS_OFF } from './care-schedule.mjs';

export const FLAGS = { supabase: Object.assign({}, FLAGS_OFF.supabase, { weight: false }) };

export const storage = {
  su_device_role: 'office',
  su_backend_flags: JSON.stringify(FLAGS),
  su_facility_profile_v1: JSON.stringify({ setupDone: true, facilityName: '' }),
};

/* 入居者3名（場面ごとに別の方へ記録して、同じ方・同じ日の上書き（編集）にならないようにする） */
export const RESIDENTS = [
  { id: 'fi-r1', name: '架空A', room: '901', heightCm: 155 },
  { id: 'fi-r2', name: '架空B', room: '902', heightCm: 160 },
  { id: 'fi-r3', name: '架空C', room: '903', heightCm: 150 },
];

export function seed() {
  return { residents: RESIDENTS.map((r) => ({ ...r })), records: [], thresholds: null };
}
