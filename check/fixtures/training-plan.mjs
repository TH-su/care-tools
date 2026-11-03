/* check/fixtures/training-plan.mjs — 個別機能訓練計画書の紙を、架空の利用者1名・架空の計画1期で撮るための材料（2026-11-03 案A）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（計画書と入居者マスタの接続先を架空の住所にする・事務所PCとして開く・架空の事務所のログイン）
 *   match   … 撮影の間だけ横取りする通信の住所（ネットへは出ない。計画書と入居者マスタは同じ架空の住所を使い、要求の種類で答え分ける）
 *   respond(body) … 横取りした要求に返す応答
 *   routes  … Supabase（ログインの確かめ）と切り替えスイッチ（su-backend.json）の横取り。スイッチは全部「切」で答える
 *             （計画書の読み込みが Google の道＝上の架空の住所へ来るように。本番のスイッチの値に撮影が左右されない）
 *   sheets  … 計画書の紙。一覧の「開く」を押して1名を開き、下の「印刷」タブへ移って印刷プレビューを組む（prepare）
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名・病名・職員名・文はすべて架空の見本の語。
 * ★日付は撮影の固定時刻（lib.FIXED_TIME＝2026-01-14）の前で決め打ち（期限・年齢が撮るたびに変わらない）。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
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
export const storage = {
  tp_cfg: JSON.stringify({ url: URL, token: 'check-dummy' }),
  rmaster_cfg: JSON.stringify({ url: URL, token: 'check-dummy' }),
  su_device_role: 'office',
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
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

/* 入居者マスタの架空の名簿（デイの判定は週間計画の接続先が無いので「全員」で出る） */
const roster = [
  { id: 'T01', name: '架空 一郎', kana: 'カクウ イチロウ', room: '101', gender: '男', careLevel: '要介護2', active: true, updatedAt: '2026-01-01T09:00:00+09:00', birthDate: '1938-04-05', height: '160', dischargeDate: '' },
  { id: 'T02', name: '見本 花子', kana: 'ミホン ハナコ', room: '201', gender: '女', careLevel: '要介護1', active: true, updatedAt: '2026-01-01T09:00:00+09:00', birthDate: '1942-09-12', height: '148', dischargeDate: '' },
];
/* 架空の計画1期（T01）。紙の主な欄に架空の文を入れる */
const prog = (c, f) => ({ content: c, caution: '架空の留意点（無理をしない）', frequency: f, duration: '20分', staff: '見本 職員' });
const PLAN = {
  planId: 'P-T01-1', seq: 1, planDate: '2025-12-01', prevPlanDate: '', firstPlanDate: '2025-12-01',
  period: { from: '2025-12-01', to: '2026-02-28' }, nextDue: '2026-03-01', visitDate: '2025-11-28', cmReportDate: '',
  explained: { date: '2025-12-02', explainer: '見本 職員' }, signature: { receivedOn: '', by: '' }, status: 'draft',
  basic: { name: '架空 一郎', kana: 'カクウ イチロウ', gender: '男', birthDate: '1938-04-05', careLevel: '要介護2', dementiaRank: 'Ⅰ', bedriddenRank: 'A1' },
  planner: '見本 職員', plannerJob: '機能訓練指導員', programPlanner: '見本 職員',
  hopeSelf: '架空の本人の希望（自分で歩いて買い物に行きたい）', hopeFamily: '架空の家族の希望（転ばずに過ごしてほしい）',
  socialParticipation: '架空の社会参加の状況', homeEnvironment: '架空の居宅の環境（段差あり）',
  health: { diagnosis: '架空の病名A', onsetDate: '2020-05-01', lastHospitalization: '' },
  treatmentCourse: '架空の経過', diseaseControl: '架空の合併症の管理', precautions: '架空の運動時の留意事項',
  shortGoalFunction: '架空の短期目標（立ち上がり）', shortGoalActivity: '架空の短期目標（屋内歩行）', shortGoalParticipation: '架空の短期目標（体操に参加）',
  longGoalFunction: '架空の長期目標（下肢筋力）', longGoalActivity: '架空の長期目標（屋外歩行）', longGoalParticipation: '架空の長期目標（買い物）',
  programs: [prog('架空の訓練（立ち上がり練習）', '週2回'), prog('架空の訓練（歩行練習）', '週2回'), prog('', ''), prog('', '')],
  homeExercise: '架空の自宅での体操', remarks: '架空の特記事項', changes: '', issues: '',
};

export const sheets = [
  { key: 'plan', arg: 'T01', ready: '#sheetHost .tp-sheet',
    /* ページの中で動く。名簿が出るのを待ち、その方の「開く」を押し、下の「印刷」タブで印刷プレビューを組む。保存はしない */
    prepare: async (id) => {
      const wait = async (fn) => { for (let i = 0; i < 150; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
      const btn = await wait(() => document.querySelector('button[data-id="' + id + '"]'));
      if (!btn) return false;
      btn.click();
      const opened = await wait(() => { const e = document.getElementById('scr-edit'); return e && e.classList.contains('on') && /架空 一郎/.test(e.textContent || '') ? e : null; });
      if (!opened) return false;
      const tab = document.querySelector('.bnav button[data-scr="scr-print"]');
      if (!tab) return false;
      tab.click();
      return !!(await wait(() => document.querySelector('#sheetHost .tp-sheet')));
    } },
];

/* 画面が送る要求に返す応答。紙に要らない要求には「中身なし」を返す（失敗にはしない） */
export function respond(body) {
  const a = body && body.action;
  if (a === 'getRoster') return { ok: true, roster: roster.map((r) => ({ ...r })), stateRev: 1 };
  if (a === 'getBulk') return { ok: true, rows: roster.map((r) => ({ ...r })) };
  if (a === 'getResident') { const r = roster.find((x) => String(x.id) === String(body.id)); return r ? { ok: true, record: { ...r } } : { ok: false, error: 'not found' }; }
  if (a === 'stateRev') return { ok: true, rev: 1 };
  if (a === 'ping') return { ok: true };
  if (a === 'get') {
    const k = String(body.key || '');
    if (k === 'training_plan:T01') return { ok: true, rev: 1, data: { v: 1, subject: { masterId: 'T01', nameNorm: '架空一郎', kana: 'カクウ イチロウ' }, plans: [JSON.parse(JSON.stringify(PLAN))], trash: [] } };
    if (k === 'training_plan:index') return { ok: true, rev: 1, data: { v: 1, rows: [{ masterId: 'T01', nextDue: PLAN.nextDue, lastPlanDate: PLAN.planDate, planCount: 1 }] } };
    return { ok: true, rev: 0, data: null };
  }
  return { ok: true };
}
