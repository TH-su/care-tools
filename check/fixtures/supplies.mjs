/* check/fixtures/supplies.mjs — 消耗品管理の紙（ご利用明細・料金表）を、架空の品目2つ・架空の方2名の出庫で撮るための材料（2026-11-13 第6段 SP-03）
 *
 * 使い方は check/fixtures/patch-calendar.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（事務所PC）。接続先は入れない＝通信は起きない（明細の中身は prepare が画面のメモリへ入れる）
 *   match   … 撮影の間だけ横取りする通信の住所（この撮影では外へ出ないが、形をそろえて置く）
 *   routes  … 切り替えスイッチ（su-backend.json）は全部「切」で答える
 *   sheets  … 画面のメモリに架空の品目・出庫・名簿を入れ、職員が押すのと同じ関数（renderBill・buildPriceSheet）で紙を組んでから撮る。印刷のダイアログは開かない
 *
 * ★架空データだけ（CLAUDE.md §2-1）。品目・氏名・金額は架空の見本の語と値。
 * ★発行者の欄（施設名・住所・TEL・登録番号）は、撮影の時に配る施設情報（本番の facility-profile.json が無い時は見本）から出る。
 * ★月は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の月。
 */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/**';
export const routes = [
  { match: '**/su-backend.json*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: {} }) }) },
];
export const storage = { su_device_role: 'office' };

export const sheets = [
  { key: 'bill', arg: null, ready: '#billBody tr',
    prepare: async () => {
      /* 施設情報が読めるまで待ち、画面のメモリへ架空の材料を入れる（prepare はページへ文字として渡るので、外の関数は呼べない） */
      for (let i = 0; i < 50 && !(window.SUFacility && window.SUFacility.ready()); i++) await new Promise((r) => setTimeout(r, 100));
      if (!(window.SUFacility && window.SUFacility.ready())) return false;
      ST.role = 'admin';
      ST.items = [
        { id: 'it_1', name: '架空の手袋', units: [{ name: '箱' }, { name: 'パック', per: 4 }, { name: '枚', per: 30 }], billIdx: 1, billType: 'unit', taxRate: 10 },
        { id: 'it_2', name: '架空のパッド', units: [{ name: '袋' }, { name: '枚', per: 20 }], billIdx: 1, billType: 'unit', taxRate: 10 }
      ].map(normItem);
      ST.byId = {}; ST.items.forEach((it) => { ST.byId[it.id] = it; });
      ST.prices = {};
      ST.roster = [{ masterId: '901', name: '架空 一郎', active: true }, { masterId: '902', name: '架空 花子', active: true }];
      ST.rosterOk = true;
      ST.billMoves = [
        { id: 'mv_1', type: 'out', date: '2026-01-05', itemId: 'it_1', residentId: '901', qtyBill: 2, qty: -60, amount: 3000 },
        { id: 'mv_2', type: 'out', date: '2026-01-08', itemId: 'it_2', residentId: '902', qtyBill: 3, qty: -60, amount: 240 },
        { id: 'mv_3', type: 'out', date: '2026-01-12', itemId: 'it_1', residentId: '902', qtyBill: 1, qty: -30, amount: 1500 }
      ];
      ST.billNotes = []; ST.billNotesCap = true; ST.billNotesOk = true; ST.billMonth = '2026-01';
      showScreen('bill', true);
      renderBill();
      await new Promise((r) => setTimeout(r, 300));
      return !!document.querySelector('#billBody tr') && document.body.getAttribute('data-print') === 'bill';
    } },
  { key: 'sheet', arg: null, ready: '#sheetBody table',
    prepare: async () => {
      for (let i = 0; i < 50 && !(window.SUFacility && window.SUFacility.ready()); i++) await new Promise((r) => setTimeout(r, 100));
      if (!(window.SUFacility && window.SUFacility.ready())) return false;
      ST.items = [
        { id: 'it_1', name: '架空の手袋', units: [{ name: '箱' }, { name: 'パック', per: 4 }, { name: '枚', per: 30 }], billIdx: 1, billType: 'unit', taxRate: 10 },
        { id: 'it_2', name: '架空のパッド', units: [{ name: '袋' }, { name: '枚', per: 20 }], billIdx: 1, billType: 'unit', taxRate: 10 }
      ].map(normItem);
      ST.byId = {}; ST.items.forEach((it) => { ST.byId[it.id] = it; });
      ST.prices = {};
      ST.cats = []; ST.profiles = [];
      showScreen('list', true);
      buildPriceSheet();
      await new Promise((r) => setTimeout(r, 300));
      return !!document.querySelector('#sheetBody table') && document.body.getAttribute('data-print') === 'sheet';
    } },
];

export function respond() { return { ok: true }; }
