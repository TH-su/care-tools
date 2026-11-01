/* check/fixtures/supplies.mjs — 消耗品管理を、架空データで開くための材料（2026-11-01 新設）
 *
 * 失敗を起こして数える道具（check/fail-inject/observe.mjs の spl-gas）が読む。
 *   seed()  … 見本の消耗品管理 GAS（check/fail-inject/gas-script.mjs の createSuppliesBackend）に置く中身
 *             （形は supplies-api.gs の list と同じ。職員の合言葉＝role 'staff'。品目2つ・在庫0・価格なし）
 *   storage … 開く前に端末へ入れる設定（接続先 spl_cfg は道具が架空の住所に差し替える）
 * ★架空データだけ（CLAUDE.md §2-1）。品目名は記号的な見本（見本品A・見本品B）。名簿は使わない（入庫は提供先を持たない）。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
 */
export const storage = {
  su_device_role: 'office',
  su_facility_profile_v1: JSON.stringify({ setupDone: true, facilityName: '' }),
};

/* 単位の段: 箱（入れる単位）→ 枚（最小単位・1箱10枚）。請求は箱（billIdx 0）。 */
const UNITS = [{ name: '箱' }, { name: '枚', per: 10 }];
const item = (id, name) => ({ id, rev: 1, updatedAt: '', updatedBy: '', name, category: 'cat_fi', status: 'active',
  units: UNITS.map((u) => ({ ...u })), billIdx: 0, billType: 'unit', stockMode: 'full', roundMode: '', taxRate: 10, reorderPoint: 0, note: '' });

export function seed() {
  return {
    role: 'staff',
    items: [item('it_fi1', '見本品A'), item('it_fi2', '見本品B')],
    prices: {},
    profiles: [],
    categories: [{ id: 'cat_fi', name: '見本の種別', order: 1, hidden: false, mode: '', m1000: null }],
    defaults: { daysPerMonth: 30, mode: 'round', m1000: 200 },
    closedMonths: [],
    stock: { it_fi1: { qty: 0 }, it_fi2: { qty: 0 } },
    settingsAt: '',
  };
}
