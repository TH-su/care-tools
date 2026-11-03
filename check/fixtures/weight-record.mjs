/* check/fixtures/weight-record.mjs — 体重管理の「🖨️ 用紙作成」（体重測定記録用紙・A4縦）を、架空の入居者12名で撮るための材料（2026-11-03 案A）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（体重管理の控え wtmgr_v1 に架空の入居者と前月の体重を入れる・事務所PC）
 *             体重の GAS の接続先は入れない＝端末の控えだけで開く（通信は起きない）
 *   match   … 撮影の間だけ横取りする通信の住所（体重管理はこの撮影では外へ出ないが、形をそろえて置く）
 *   routes  … 切り替えスイッチ（su-backend.json）は全部「切」で答える（本番のスイッチの値に撮影が左右されない）
 *   sheets  … 「用紙作成」と同じ関数（openPrintSheet）で用紙を組む（prepare）。印刷のダイアログは開かない
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名はすべて架空の見本の語。
 * ★対象月は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の月。前月（2025-12）の体重を紙に出す。
 *   車椅子で測る方（車椅子の重さあり）と、前月の記録が無い方も混ぜる。
 */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/**';
export const routes = [
  { match: '**/su-backend.json*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: {} }) }) },
];

const SEI = ['架空', '見本', '試験', '仮名'];
const MEI = ['一郎', '花子', '二郎'];
const pad = (n) => String(n).padStart(2, '0');
const residents = Array.from({ length: 12 }, (_, i) => ({
  id: 'w' + pad(i + 1),
  name: `${SEI[i % 4]} ${MEI[Math.floor(i / 4)]}`,
  room: String(i < 6 ? 101 + i : 201 + (i - 6)),
  heightCm: 145 + (i % 15),
  wheelchairKg: i % 4 === 3 ? 15 : null,
  dischargedAt: '',
}));
/* 前月（2025-12）の体重。12番目の方は前月の記録なし（紙は「－」） */
const records = residents.slice(0, 11).map((r, i) => {
  const net = 40 + i * 1.5;
  const chair = r.wheelchairKg != null;
  return {
    id: 'rec' + pad(i + 1), residentId: r.id, yearMonth: '2025-12', measuredOn: `2025-12-${pad(5 + (i % 10))}`,
    weight: net, measureMode: chair ? 'chair' : 'stand', rawWeight: chair ? net + r.wheelchairKg : null, wheelchairKg: chair ? r.wheelchairKg : null,
  };
});
export const storage = {
  su_device_role: 'office',
  wtmgr_v1: JSON.stringify({ residents, records }),
};

export const sheets = [
  { key: 'sheet', ready: '#printOverlay.on .ps-page',
    /* ページの中で動く。「用紙作成」と同じ関数で用紙を組む */
    prepare: async () => {
      for (let i = 0; i < 100; i++) {
        if (typeof openPrintSheet === 'function' && typeof DB !== 'undefined' && DB && Array.isArray(DB.residents) && DB.residents.length) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (typeof openPrintSheet !== 'function') return false;
      openPrintSheet();
      return !!document.querySelector('#printOverlay.on .ps-page');
    } },
];

/* 体重管理はこの撮影では通信しないが、来た時は「中身なし」で答える（失敗にはしない） */
export function respond() { return { ok: true }; }
