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
const GENO_IMG = 'data:image/jpeg;base64,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AFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABWB46/5FC+/wC2f/oxa36wPHX/ACKF9/2z/wDRi0AX/D//ACL2mf8AXpF/6AKKPD//ACL2mf8AXpF/6AKKANCuQ+Gf/IvXH/X23/oCV19ch8M/+ReuP+vtv/QEoA6+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKwPHX/ACKF9/2z/wDRi1v1geOv+RQvv+2f/oxaAL/h/wD5F7TP+vSL/wBAFFHh/wD5F7TP+vSL/wBAFFAGhXIfDP8A5F64/wCvtv8A0BK6+uQ+Gf8AyL1x/wBfbf8AoCUAdfRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFYHjr/kUL7/tn/6MWt+sDx1/yKF9/wBs/wD0YtAF/wAP/wDIvaZ/16Rf+gCijw//AMi9pn/XpF/6AKKANCuQ+Gf/ACL1x/19t/6AldfXIfDP/kXrj/r7b/0BKAOvooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACsDx1/yKF9/wBs/wD0Ytb9YHjr/kUL7/tn/wCjFoAv+H/+Re0z/r0i/wDQBRR4f/5F7TP+vSL/ANAFFAGhXIfDP/kXrj/r7b/0BK6+uQ+Gf/IvXH/X23/oCUAdfRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRR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';
export const storage = {
  rmaster_cfg: JSON.stringify({ url: URL, token: 'check-dummy' }),
  su_device_role: 'office',
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
  /* 1人目（F01）には、家族構成図アプリが端末に控えた形の架空の絵（形だけ・文字なし・600×400）を置く。
     PC と紙で絵を今の面積の約6分の1にした（2026-11-03）大きさを、紙の見比べで守るため。2人目（F02）は絵の無い枠のまま */
  su_genograms: JSON.stringify({ F01: { image: GENO_IMG, name: '見本 一郎', updatedAt: '2026-01-01T09:00:00+09:00' } }),
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
/* 「🖨️ 全体を印刷」の紙（2026-11-14 追加）。ボタンの道（fsPrintAll）と同じく body に印 fs-all-on を付け、全体タブ1枚だけを刷る形にする。
   ボタンは印を付けた後に window.print を呼び、印刷が終わると印を外すが、撮影では印刷のダイアログを開かず印を付けたまま撮る。
   見比べるのは全体タブの紙の中身・見た目と印刷のページ数。撮る絵は改ページの無い1枚の絵なので、改ページの位置は比べない
   （家族情報と事業所・家族構成図の包み .fam-biz を改ページで分けない決まり＝代表者の決定 2026-11-14 は、この材料では見えない。
   今の2名ではページの境目が家族情報の行に掛からず、PDF をページごとに絵にしても直しの有無で同じ・2026-11-14 実測）。
   絵のある1人目（F01）と絵の無い2人目（F02）の両方を撮る */
const prepareAll = async (id) => {
  if (typeof openResident !== 'function') return false;
  openResident(id);
  for (let i = 0; i < 100; i++) {
    const all = document.querySelector('#viewBox .fpanel[data-panel="all"]');
    const ok = all && all.querySelector('.fam-biz') && Array.prototype.some.call(all.querySelectorAll('.rhythm'), (el) => /朝食/.test(el.textContent || ''));
    if (ok) { document.body.classList.add('fs-all-on'); return true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
sheets.push({ key: 'all', arg: 'F01', ready: 'body.fs-all-on #viewBox .fpanel[data-panel="all"] .fam-biz', prepare: prepareAll });
sheets.push({ key: 'all2', arg: 'F02', ready: 'body.fs-all-on #viewBox .fpanel[data-panel="all"] .fam-biz', prepare: prepareAll });

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
