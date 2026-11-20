/* check/fixtures/kintai.mjs — 勤怠管理を、架空の職員・予定・有給・休暇の種類で開くための材料（2026-11-20 新設・v5 段4）
 *
 * snap.mjs の材料の形（URL・match・storage・routes・sheets・respond）。
 *   sheets … 有給のタブの「管理簿を印刷（A4）」で組む年次有給休暇管理簿の紙（SUPrint の 'ledger'）を、架空の記録で撮る
 *   storage … 事務所PCとして開き、架空の管理者（二段階）でログインしている端末にする。開くタブは有給・月分は撮影の時計（2026-01-14）の月
 *   routes  … Supabase への通信を全部横取りし、ログインの確かめ・アプリの使える人・勤怠の RPC（kintai_*）に架空の応答を返す（書く口は受けるだけ）。
 *             シフトの読み口（Google）へは出さない（止める）
 * 時計は撮影の道具が 2026-01-14 09:00（日本時間）に止める（lib.mjs の FIXED_TIME）。有給は読む月分（来月分・今月分からさかのぼり）をこの日から決める。
 *
 * ★架空データだけ（CLAUDE.md §2-1）。職員の名前は「見本 …」の語。鍵・メールアドレスは架空（example.invalid）。本物の Supabase へは出ない。
 */
export const URL = 'https://jhbernqawjrzqwrmqrih.supabase.co';
export const match = URL + '/rest/v1/rpc/kintai_month_get';
const SB = URL;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const UID = '00000000-0000-4000-8000-0000000c4e11';
const FAKE_JWT = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: UID, email: 'check-admin@example.invalid', role: 'authenticated', aal: 'aal2', exp: 4102444800 }) + '.check';
const FAKE_SESSION = JSON.stringify({
  access_token: FAKE_JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
  user: { id: UID, email: 'check-admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
});
export const storage = {
  su_device_role: 'office',
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
  kintai_tab: 'leave',
  kintai_ym: '2026-01',
};
/* 年次有給休暇管理簿の紙（A4 縦）。ページの中で動く。有給の記録を読み終えるのを待ち、押した時と同じ道（「管理簿を印刷」のボタン）で紙を組む（印刷のダイアログは開かない） */
export const sheets = [
  { key: 'ledger', arg: null, ready: '#k-ledger .lg-t',
    prepare: async () => {
      const wait = async (fn) => { for (let i = 0; i < 200; i++) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
      const btn = await wait(() => { const b = document.querySelector('[data-act="lv-ledger"]'); return b && !/有給の記録を読んでいます/.test(document.getElementById('g-main').textContent) && window.SUPrint ? b : null; });
      if (!btn) return false;
      window.print = function () {};
      btn.click();
      return !!(await wait(() => document.body.classList.contains('su-printing')));
    } },
];

/* ── 架空の記録 ── */
const STAFF = [
  { staff_id: 'sK01', name: '見本 一郎', code: '0001', office: 'facility', emp_code: '9001', master_id: 'M01', active: true, source: 'shift', clock_visible: true },
  { staff_id: 'sK02', name: '見本 二美', code: '0002', office: 'visit', emp_code: '9002', master_id: 'M02', active: true, source: 'shift', clock_visible: true },
  { staff_id: 'sK03', name: '見本 三太', code: '0003', office: 'day', emp_code: '9003', master_id: 'M03', active: true, source: 'master', clock_visible: true },
];
const MASTER = [
  { master_id: 'M01', name: '見本 一郎', hire_date: '2019-04-01', employment_type: 'regular' },
  { master_id: 'M02', name: '見本 二美', hire_date: '2023-10-01', employment_type: 'regular' },
  { master_id: 'M03', name: '見本 三太', hire_date: '2025-06-01', employment_type: 'regular' },
];
const pad = (n) => (n < 10 ? '0' : '') + n;
const daysIn = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const iso = (d, hm) => d + 'T' + hm + ':00+09:00';
/* 予定のある月分（ほかの月分は空＝有給のさかのぼりは空の月分が3つ続いた所で止まる） */
const LIVE = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
/* シフトの有休の日（予定の「有」の行）・手で入れた有休の使用・休暇の種類（時間単位の有休・特別休暇・代休・振替休日） */
const SHIFT_PAID = { sK01: ['2025-11-14'], sK02: ['2025-12-26'] };
const USES = [
  { id: '00000000-0000-4000-8000-0000000c4e21', staff_id: 'sK01', use_date: '2025-12-05', days: 1, note: '見本', created_at: '2025-12-01T10:00:00+09:00', voided_at: null },
  { id: '00000000-0000-4000-8000-0000000c4e22', staff_id: 'sK02', use_date: '2025-10-20', days: 0.5, note: '', created_at: '2025-10-15T10:00:00+09:00', voided_at: null },
  { id: '00000000-0000-4000-8000-0000000c4e23', staff_id: 'sK03', use_date: '2026-01-09', days: 1, note: '', created_at: '2026-01-05T10:00:00+09:00', voided_at: null },
];
const ABSENCES = [
  { id: '00000000-0000-4000-8000-0000000c4e31', staff_id: 'sK01', date: '2025-12-10', kind: 'hourly_paid', minutes: 120, paid: true, type_code: null, link_date: null, note: '見本の通院', created_at: '2025-12-09T10:00:00+09:00' },
  { id: '00000000-0000-4000-8000-0000000c4e32', staff_id: 'sK01', date: '2026-01-08', kind: 'hourly_paid', minutes: 60, paid: true, type_code: null, link_date: null, note: '', created_at: '2026-01-07T10:00:00+09:00' },
  { id: '00000000-0000-4000-8000-0000000c4e33', staff_id: 'sK02', date: '2025-12-24', kind: 'special', minutes: null, paid: true, type_code: 'keicho', link_date: null, note: '', created_at: '2025-12-20T10:00:00+09:00' },
  { id: '00000000-0000-4000-8000-0000000c4e34', staff_id: 'sK03', date: '2026-01-07', kind: 'swap', minutes: null, paid: false, type_code: null, link_date: '2026-01-11', note: '', created_at: '2026-01-05T10:00:00+09:00' },
];
export function monthOf(ym) {
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''));
  if (!ok) return { ok: false, error: 'badym' };
  const nd = daysIn(ym), from = ym + '-01', to = ym + '-' + pad(nd);
  const schedule = [];
  if (LIVE.indexOf(ym) >= 0) {
    for (let d = 1; d <= nd; d++) {
      const date = ym + '-' + pad(d), w = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, d)).getUTCDay();
      if (w === 0 || w === 6) continue;
      STAFF.forEach((s, i) => {
        if ((SHIFT_PAID[s.staff_id] || []).indexOf(date) >= 0) { schedule.push({ staff_id: s.staff_id, work_date: date, seq: 1, office: s.office, start_at: null, end_at: null, break_min: 0, kind: 'paid', symbol: '有', paid_min: 480, imported_at: '2025-10-01T00:00:00Z' }); return; }
        if (i === 2 && w === 3) return;   /* 三太は水曜休み */
        schedule.push({ staff_id: s.staff_id, work_date: date, seq: 1, office: s.office, start_at: iso(date, '09:00'), end_at: iso(date, '18:00'), break_min: 60, kind: 'work', symbol: '日', paid_min: 0, imported_at: '2025-10-01T00:00:00Z' });
      });
    }
  }
  const inP = (d) => d && d >= from && d <= to;
  return {
    ok: true, period: { from, to, lead_from: null, close_day: 0 }, staff: STAFF, punches: [], schedule, days: [], month: null,
    settings: { config: { legal_holiday: 0, hourlyPaidLeave: true }, rev: 3 }, edits_count: 0,
    leave_uses: USES.filter((u) => inP(u.use_date)), sched_edits: [], sched_fixed_days: [], fixed: [],
    absences: ABSENCES.filter((a) => inP(a.date) || inP(a.link_date)),
  };
}
const LEAVE = {
  ok: true,
  profiles: [{ staff_id: 'sK01', hire_date: null, weekly_days: null, weekly_hours: null, opening_date: '2024-04-01', skip_grants: [], rev: 1 }],
  grants: [{ id: '00000000-0000-4000-8000-0000000c4e41', staff_id: 'sK01', grant_date: '2024-04-01', days: 15, kind: 'opening', note: '移行の残り（見本）', voided_at: null }],
  uses: USES,
};
/* 施設情報（facility-profile.json）は公開リポジトリに無い。撮影の道具と同じく、無い時は見本を返す */
const SAMPLE_PROFILE = new globalThis.URL('../../facility-profile.sample.json', import.meta.url);
const PROFILE_ROUTE = {
  match: '**/facility-profile.json',
  async handle(route) {
    const fs = await import('node:fs');
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(SAMPLE_PROFILE, 'utf8') });
  },
};
/* シフトの読み口（Google）へは出さない */
const GAS_ROUTE = { match: /https:\/\/script\.google(usercontent)?\.com\//, handle(route) { return route.abort(); } };
export const routes = [{
  match: SB + '/**',
  handle(route) {
    const req = route.request();
    const u = req.url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (v, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
    if (/\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role: 'admin', mfa: true });
    if (/\/rest\/v1\/allowed_accounts/.test(u)) return json({ role: 'admin', label: '' });
    if (/\/auth\/v1\/factors|\/auth\/v1\/user/.test(u)) return json({ id: UID, factors: [] });
    if (/\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role: 'admin', rules: null, mine: null, updatedAt: null });
    const m = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(u);
    let p = {};
    try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
    const name = m ? m[1] : '';
    if (name === 'kintai_month_get') return json(monthOf(p.p_ym));
    if (name === 'kintai_leave_get') return json(LEAVE);
    if (name === 'kintai_master_list') return json({ ok: true, rows: MASTER });
    if (name === 'kintai_managers_list') return json({ ok: true, rows: [] });
    if (name === 'kintai_edits_get') return json({ ok: true, edits: [] });
    if (/^kintai_(staff_sync|schedule_put|settings_put|absence_add|absence_void)$/.test(name)) return json({ ok: true, id: '00000000-0000-4000-8000-0000000c4e99' });
    return json({ code: 'PGRST202', message: 'check fixture: not served', details: null, hint: null }, 404);
  },
}, PROFILE_ROUTE, GAS_ROUTE];

/* snap.mjs の形に合わせた応答（match に当たる要求＝kintai_month_get に架空の月分を返す） */
export function respond(body) { return monthOf(body && body.p_ym); }
