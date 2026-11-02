/* check/fixtures/facesheet.mjs — フェイスシートの紙を、架空の入居者2名で撮るための材料（2026-11-02 新設・品質改善 第3期 便8）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（接続先を架空の住所にする・事務所PCとして開く）
 *   match   … 撮影の間だけ横取りする通信の住所（ネットへは出ない）
 *   respond(body) … 横取りした要求（入居者マスタ GAS への POST 本文）に返す応答
 *   routes  … match 以外に横取りするもの（Supabase への要求は全部「無い」と答える＝本物へ出ない）
 *   sheets  … 撮る帳票。フェイスシートの個票は印刷部品（SUPrint）を使わず、開いた方の画面をそのまま刷るので、
 *             prepare（ページの中で1名を開く関数）で撮る
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名・医療機関・居宅名は実在しない見本の語、電話は 000- で始まる架空の番号。
 * ★日付は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の前で決め打ち（年齢・入居日数が撮るたびに変わらない）。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
 * ★ログインの確かめ: フェイスシートは事務所向けのアプリを開く前の確かめ（su-app-gate.js）は通らないが、入居者の記録の読み取りは
 *   切り替えの口（su-res-read.js）を通り、スイッチ master_live が入の間はログインしていない端末では読めない（Google へ流さない）。
 *   そこで入居者マスタの材料と同じ形で、撮影の間だけ架空の事務所のアカウントでログインしている端末にし、Supabase への通信を全部横取りする。
 *   切り替えの印（res_mode_get）には「関数が無い」と答える＝写しの期間と同じ扱いで、名簿と個票は今までどおり上の架空の GAS から読む。
 * ★生活リズムは「起床・就寝だけ保存した方」と「朝食も保存した方」の2名にする＝食事の時刻の施設の既定（MEAL-TIMES）が紙に出る。
 */
/* 住所は画面の守り（CSP の connect-src）が通す Google の形にする。撮影の間は match に当たる要求を全部横取りするので、
   この住所へ実際に出て行くことはない */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY/**';
/* ★鍵・メールアドレスは架空（example.invalid）。本物の Supabase へは出ない（下の routes に当たる要求は全部ここで答える） */
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

const residents = [
  {
    id: 'F01', masterId: 'F01', name: '見本 一郎', kana: 'ミホン イチロウ', room: '101', gender: '男', careLevel: '要介護2', active: true,
    updatedAt: '2026-01-01T09:00:00+09:00', birthDate: '1938-04-05', admissionDate: '2023-06-01', dischargeDate: '',
    height: '160', weight: '55.0', bloodType: 'A',
    careOffice: 'みほん居宅介護支援センターA', careManager: '見本 ケア一', careOfficeTel: '000-0000-0101', careOfficeFax: '000-0000-0102',
    hospital: 'みほん内科医院', doctor: '見本 医師', hospitalTel: '000-0000-0301',
    disease: '架空の病名A', history: '架空の既往歴', medsRegular: '', allergy: 'なし',
    /* 起床・就寝だけ保存＝朝食・昼食・おやつ・夕食は施設の既定が出る */
    rhythm: { wake: '06:30', sleep: '21:00' },
    family: [{ name: '見本 花子', relation: '長女', phone: '000-0000-1001', address: '架空県見本市1-1', kp: true, emergency: true }],
  },
  {
    id: 'F02', masterId: 'F02', name: '架空 春子', kana: 'カクウ ハルコ', room: '201', gender: '女', careLevel: '要介護3', active: true,
    updatedAt: '2026-01-01T09:00:00+09:00', birthDate: '1941-11-20', admissionDate: '2024-02-15', dischargeDate: '',
    height: '148', weight: '43.5', bloodType: 'O',
    careOffice: 'かくう居宅支援事業所B', careManager: '架空 支援一', careOfficeTel: '000-0000-0201', careOfficeFax: '',
    hospital: 'かくう診療所', doctor: '架空 医師', hospitalTel: '000-0000-0302',
    disease: '架空の病名B', history: '', medsRegular: '', allergy: '',
    /* 朝食だけ保存した時刻（保存した方が勝つ）・ほかは施設の既定 */
    rhythm: { wake: '07:00', breakfast: '08:30', sleep: '20:30' },
    family: [{ name: '架空 次郎', relation: '長男', phone: '000-0000-2001', address: '架空県試験町2-2', kp: true, emergency: true }],
  },
];
const ROSTER_KEYS = ['id', 'masterId', 'name', 'kana', 'room', 'gender', 'careLevel', 'active', 'updatedAt', 'birthDate', 'height', 'dischargeDate'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

export const sheets = [
  { key: 'office', arg: 'F01', ready: '#viewBox .fpanel .rhythm',
    /* ページの中で動く（snap.mjs が evaluate する）。名簿を読み終えるのを待ち、1名を開いて事務所の表示が描けるのを待つ。
       印刷のダイアログは開かない（紙は @media print を当てて撮る）。保存はしない */
    prepare: async (id) => {
      if (typeof openResident !== 'function') return false;
      openResident(id);
      for (let i = 0; i < 100; i++) {
        /* 生活リズムの欄（同じ見た目の欄が同意・確認書・デイ利用日にもあるので、朝食の字のある欄を探す） */
        const els = document.querySelectorAll('#viewBox .fpanel .rhythm');
        if (Array.prototype.some.call(els, (el) => /朝食/.test(el.textContent || ''))) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    } },
];
/* 2人目（朝食を保存した方）も同じ組み方で撮る */
sheets.push({ ...sheets[0], key: 'office2', arg: 'F02' });

/* 画面が送る要求（{action, token, ...}）に返す応答。紙に要らない要求には「中身なし」を返す（失敗にはしない） */
export function respond(body) {
  const a = body && body.action;
  if (a === 'getRoster') return { ok: true, roster: residents.map((r) => pick(r, ROSTER_KEYS)), stateRev: 1 };
  if (a === 'getResident') {
    const r = residents.find((x) => String(x.id) === String(body.id));
    return r ? { ok: true, record: JSON.parse(JSON.stringify(r)) } : { ok: false, error: 'not found' };
  }
  if (a === 'stateRev') return { ok: true, rev: 1 };
  return { ok: true };
}
