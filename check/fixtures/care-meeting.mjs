/* check/fixtures/care-meeting.mjs — 担当者会議の要点の紙（A4横1枚）を、架空の入居者1名・確定した架空の会議1件で撮るための材料（2026-11-03 案A）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（入居者マスタの接続先を架空の住所にする・事務所PC・架空の事務所のログイン・架空の共有名簿）
 *   match   … 撮影の間だけ横取りする通信の住所（ネットへは出ない）
 *   respond(body) … 横取りした要求（入居者マスタ GAS の getResident と、担当者会議の受け口 action:'meeting'）に返す応答
 *   routes  … Supabase（ログインの確かめ）と切り替えスイッチ（su-backend.json・全部「切」）の横取り
 *   sheets  … 確定した会議を開き、印刷部品（SUPrint）の 'meeting' で紙を組む（prepare）。文字は 7〜16px の間で1枚に収まる大きさに決まる
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名・職種・所属・文はすべて架空の見本の語。
 * ★日付は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の前で決め打ち。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。保存はしない。
 */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/**';
const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_JWT = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: '00000000-0000-4000-8000-0000000c4eck', email: 'check-office@example.invalid', role: 'authenticated', aal: 'aal1', exp: 4102444800 }) + '.check';
const FAKE_SESSION = JSON.stringify({
  access_token: FAKE_JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
  user: { id: '00000000-0000-4000-8000-0000000c4eck', email: 'check-office@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
});
const ROSTER = [
  { masterId: 'C01', name: '架空 一郎', room: '101', active: true },
  { masterId: 'C02', name: '見本 花子', room: '201', active: true },
];
export const storage = {
  rmaster_cfg: JSON.stringify({ url: URL, token: 'check-dummy' }),
  su_device_role: 'office',
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
  su_residents_common: JSON.stringify({ v: 1, updatedAt: '2026-01-10T09:00:00+09:00', residents: ROSTER }),
};
export const routes = [
  { match: '**/su-backend.json*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: {} }) }) },
  { match: SB + '/**', handle(route) {
    const u = route.request().url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
    if (/\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role: 'office', mfa: false });
    if (/\/rest\/v1\/allowed_accounts/.test(u)) return json({ role: 'office', label: '' });
    if (/\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role: 'office', rules: null, mine: null, updatedAt: null });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST202', message: 'check fixture: not served' }) });
  } },
];

/* 確定した架空の会議1件（本文の4欄は複数行にして、余った高さを配る動きも紙に出す） */
const MEETING = {
  meetingId: 'M-C01-1', rev: 3, status: 'final', deleted: false,
  sourceName: '架空 一郎', kind: '認定の更新', author: '見本 ケア一', createdDate: '2026-01-08', heldDate: '2026-01-07',
  place: '架空の施設 相談室', timeText: '14:00〜14:40', count: '2回目',
  attendees: [
    { role: '本人', name: '架空 一郎' }, { role: '長女', name: '架空 花子' },
    { role: 'みほん居宅介護支援センターA 介護支援専門員', name: '見本 ケア一' },
    { role: '架空訪問介護 サービス提供責任者', name: '試験 一郎' }, { role: '架空デイ 機能訓練指導員', name: '仮名 二郎' },
  ],
  items: '架空の検討項目1（日中の過ごし方）\n架空の検討項目2（入浴の回数）',
  content: '架空の検討内容（本人から、日中は体操に参加したいとの話があった）\n架空の検討内容（家族から、転倒が心配との話があった）\n架空の検討内容（入浴は週2回のまま続ける）',
  conclusion: '架空の結論（今のサービスを続け、歩行の練習を足す）',
  issues: '架空の残された課題（夜間のトイレの付き添いを次回までに確かめる）',
  nextText: '架空の次回の時期（6か月後）', nameChecked: true,
};

export const sheets = [
  { key: 'meeting', arg: { id: 'C01', mid: 'M-C01-1' }, ready: '#cm-print *',
    /* ページの中で動く。方を開き、確定した会議を開いて、印刷部品で紙を組む（印刷のダイアログは開かない） */
    prepare: async (a) => {
      const wait = async (fn) => { for (let i = 0; i < 150; i++) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
      if (!(await wait(() => typeof openPerson_ === 'function' && window.SUPrint))) return false;
      await openPerson_(a.id);
      if (!(await wait(() => typeof cur !== 'undefined' && cur && listState === 'ok'))) return false;
      const ok = await openMeeting_(a.mid, true);
      if (!ok) return false;
      window.print = function () {};
      window.SUPrint.print('meeting');
      return document.body.classList.contains('su-printing');
    } },
];

/* 画面が送る要求に返す応答。紙に要らない要求には「中身なし」を返す（失敗にはしない） */
export function respond(body) {
  const a = body && body.action;
  if (a === 'getResident') {
    if (String(body.id) !== 'C01') return { ok: false, error: 'not found' };
    return { ok: true, record: { id: 'C01', name: '架空 一郎', room: '101', careLevel: '要介護2', careCertStart: '2025-02-01', careCertEnd: '2026-01-31' } };
  }
  if (a === 'meeting') {
    if (body.op === 'list') return { ok: true, rows: String(body.id) === 'C01' ? [JSON.parse(JSON.stringify(MEETING))] : [] };
    if (body.op === 'summary') return { ok: true, residents: { C01: { lastHeld: MEETING.heldDate } } };
    return { ok: true };
  }
  if (a === 'stateRev') return { ok: true, rev: 1 };
  return { ok: true };
}
