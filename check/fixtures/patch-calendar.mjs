/* check/fixtures/patch-calendar.mjs — 貼り薬カレンダーの紙（1か月分）を、架空の方1名・開始日と貼る場所を入れた状態で撮るための材料（2026-11-03 案A）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（事務所PC）。接続先は入れない＝端末の控えだけで開く（通信は起きない）
 *   match   … 撮影の間だけ横取りする通信の住所（この撮影では外へ出ないが、形をそろえて置く）
 *   routes  … 切り替えスイッチ（su-backend.json）は全部「切」で答える（本番のスイッチの値に撮影が左右されない）
 *   sheets  … 画面の入力欄に、職員と同じ順で氏名・開始日・貼る場所を入れてから紙を撮る（prepare）。印刷のダイアログは開かない
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は架空の見本の語。
 * ★月は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の月。開始日はその月の中に決め打ち（撮るたびに変わらない）。
 */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/**';
export const routes = [
  { match: '**/su-backend.json*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: {} }) }) },
];
export const storage = { su_device_role: 'office' };

export const sheets = [
  { key: 'month', arg: { name: '架空 一郎', start: '2026-01-05', no: '3' }, ready: '#weeks .cell',
    /* ページの中で動く。氏名を入れ、開始日と貼る場所を選ぶ（画面の change の動きで紙が組み直る） */
    prepare: async (a) => {
      const nm = document.getElementById('nm'), st = document.getElementById('st'), no = document.getElementById('no');
      if (!nm || !st || !no) return false;
      nm.value = a.name; nm.dispatchEvent(new Event('input', { bubbles: true }));
      st.value = a.start; st.dispatchEvent(new Event('change', { bubbles: true }));
      if (Array.prototype.some.call(no.options, (o) => o.value === a.no)) { no.value = a.no; no.dispatchEvent(new Event('change', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 300));
      const pnm = document.getElementById('p-nm');
      return !!(pnm && pnm.textContent.indexOf(a.name) >= 0 && document.querySelector('#weeks .cell'));
    } },
];

export function respond() { return { ok: true }; }
