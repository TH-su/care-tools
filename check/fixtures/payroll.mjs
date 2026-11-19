/* check/fixtures/payroll.mjs — 給与の画面（payroll.html）を、架空の職員10人と偽のデータベースで開くための材料（2026-11-19 新設）
 *
 * snap.mjs の材料の形（URL・match・storage・routes・sheets・respond）と、check/payroll_e2e.mjs の通し試験が使う。
 *   storage … 事務所PCとして開き、架空の管理者のアカウントで二段階のログイン（aal2）まで済ませた端末にする。給与明細のタブから開く
 *   routes  … Supabase への通信を全部横取りし、ログインの確かめ・アプリの使える人・給与の口（payroll_*・契約 CONTRACT-payroll-v1.md §5）に
 *             架空の応答を返す。保存・確定はメモリにだけ覚える。確定の時は指紋（勤怠の締めの時刻・職員の設定の版・設定の版）を今の値と照合し、
 *             違えば {ok:false, error:'stale'} を返す（本物の DB の決まりの写し・形だけ）
 *             payroll-calc.js・payroll-export.js の要求には、契約の形の偽の部品（payroll-calc-stub.js）を返す（本物は別の担当が作っている）
 *   sheets  … 給与明細の「全員分を印刷」（A4 縦・1人1ページ・SUPrint の 'slips'）
 * routesFor(opt): role（'admin'|'office'）・aal（'aal2'|'aal1'）・deny（bootstrap が 42501）・start（'none'|'confirmed'）・zengin（真なら全銀のスイッチを入れる）
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は「見本」の記号的な名前、口座・金額は実在しない値。メールは example.invalid。本物の Supabase へは出ない。
 */
import fs from 'node:fs';
import vm from 'node:vm';

export const URL = 'https://jhbernqawjrzqwrmqrih.supabase.co';
export const match = URL + '/rest/v1/rpc/payroll_bootstrap_unused';
const SB = URL;
const STUB = fs.readFileSync(new globalThis.URL('./payroll-calc-stub.js', import.meta.url), 'utf8');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function session(aal, email) {
  const jwt = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: '00000000-0000-4000-8000-00000000a1a1', email, role: 'authenticated', aal, exp: 4102444800 }) + '.check';
  return JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
    user: { id: '00000000-0000-4000-8000-00000000a1a1', email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } } });
}
export function storageFor(opt = {}) {
  return { su_device_role: 'office', payroll_tab: opt.tab || 'slip', 'sb-jhbernqawjrzqwrmqrih-auth-token': session(opt.aal || 'aal2', opt.role === 'office' ? 'check-office@example.invalid' : 'check-admin@example.invalid') };
}
export const storage = storageFor();

/* 偽の部品で明細を前もって計算する（start: 'confirmed' の時の凍結した明細） */
function stubCalc() { const box = { window: {} }; vm.runInNewContext(STUB, box); return box.window.PayrollCalc; }

const YM = '2026-01';
const PERIOD = { from: '2025-12-16', to: '2026-01-15' };
/* 架空の職員10人（月給・時給・日給・中途入社・退職・40歳・70歳・乙欄・夜勤・60時間超の型を1人ずつ） */
function profiles() {
  const base = (o) => Object.assign({ avg_month_hours: 172, allowances: [], deductions: [], commute: { monthly: 0 }, gender: 'female', entry_date: '2020-04-01', retire_date: null,
    ins: { health: { on: true, std: 260000 }, pension: { on: true, std: 260000 }, emp: { on: true }, care_exempt: false }, tax: { col: 'kou', dependents: 0, dependents_checked: true },
    resident_tax: { '2026-01': 9000 }, no_attendance: false, exclude: false }, o);
  const P = [
    ['s-01', '見本 一郎', base({ pay_type: 'monthly', base: 240000, birth_date: '1980-05-01', gender: 'male', allowances: [{ code: 'qual', amount: 10000 }], commute: { monthly: 8000, means: 'car', distance_km: 6 } })],
    ['s-02', '見本 二子', base({ pay_type: 'hourly', base: 1100, birth_date: '1975-02-10', ins: { health: { on: true, std: 150000 }, pension: { on: true, std: 150000 }, emp: { on: true } } })],
    ['s-03', '見本 三郎', base({ pay_type: 'daily', base: 9000, day_hours: 8, birth_date: '1990-11-30', gender: 'male' })],
    ['s-04', '見本 四子', base({ pay_type: 'monthly', base: 210000, birth_date: '1999-07-07', entry_date: '2026-01-05' })],
    ['s-05', '見本 五郎', base({ pay_type: 'monthly', base: 230000, birth_date: '1985-01-20', gender: 'male', retire_date: '2026-01-10' })],
    ['s-06', '見本 六子', base({ pay_type: 'monthly', base: 250000, birth_date: '1986-01-15', tax: { col: 'kou', dependents: 2, dependents_checked: false } })],
    ['s-07', '見本 七郎', base({ pay_type: 'hourly', base: 1200, birth_date: '1956-01-12', gender: 'male', ins: { health: { on: true, std: 98000 }, pension: { on: false }, emp: { on: true } } })],
    ['s-08', '見本 八子', base({ pay_type: 'hourly', base: 1050, birth_date: '1970-09-09', tax: { col: 'otsu', dependents: 0 }, ins: { health: { on: false }, pension: { on: false }, emp: { on: false } } })],
    ['s-09', '見本 九郎', base({ pay_type: 'monthly', base: 260000, birth_date: '1978-03-03', gender: 'male', allowances: [{ code: 'night', amount: 30000 }] })],
    ['p:10', '見本 十子', base({ pay_type: 'board', board_pay: 400000, birth_date: '1965-12-01', no_attendance: true, ins: { health: { on: true, std: 410000 }, pension: { on: true, std: 410000 }, emp: { on: false } } })],
  ];
  return P.map(([staff_id, name, data], i) => ({ staff_id, name, rev: 1, effective_from: i === 0 ? PERIOD.from : '2025-04-16', data,
    bank_last4: i === 2 ? null : [{ bank_name: '見本銀行', last4: String(1000 + i * 111).slice(-4) }],
    history: [{ effective_from: '2025-04-16', updated_at: '2025-04-10T10:00:00+09:00', updated_by: 'check-admin@example.invalid', reason: '見本の年度の見直し' }] }));
}
function att(sid) {
  const n = +String(sid).replace(/\D/g, '') || 1;
  return { workDays: 18 + (n % 3), paidDays: n % 2, paidMin: (n % 2) * 480, workMin: 9000 + n * 60, schedInMin: 8400 + n * 30, legalInOverMin: 0, legalOverMin: n === 9 ? 3900 : n * 30,
    over60Min: n === 9 ? 300 : 0, nightMin: n === 9 ? 960 : 0, holidayMin: 0, absentDays: 0, lateMin: 0, earlyLeaveMin: 0, nightShiftCount: n === 9 ? 4 : 0, schedDays: 20, counts: {} };
}
export function seed(opt = {}) {
  const settings = { config: { pay_day: 27, pay_day_shift: 'before', si_month: 'next', tax_method: 'table', prefecture: '43', avg_month_hours_default: 172, avg_month_days_default: 21.75,
    ot_rates: { in: 1, out: 1.25, over60: 0.25, night: 0.25, holiday: 1.35 }, round: { hour_unit: 'ceil', premium: 'ceil', prorate: 'floor', deduct_unit: 'floor', deduct: 'floor' },
    absence_deduct: true, late_deduct: true, holidays: ['2026-01-01', '2026-01-12'], night_premium: 'included', bank_from: { consignor_code: '0000000001', consignor_kana: 'ミホン', bank_code: '9999', branch_code: '001', type: '1', number: '0000001' },
    zengin: { kind: '21' }, company_name: '見本の事業者', zengin_enabled: !!opt.zengin }, rev: 3 };
  const allowances = [
    { code: 'qual', name: '資格手当', sec: 'pay', calc: 'fixed', order: 1, attrs: {} },
    { code: 'night', name: '夜勤手当', sec: 'pay', calc: 'night_shift', order: 2, attrs: {} },
    { code: 'meal', name: '食事代', sec: 'deduct', calc: 'fixed', order: 3, attrs: {} },
  ];
  const ps = profiles();
  const summary = {}; ps.forEach((p) => { if (!p.data.no_attendance) summary[p.staff_id] = att(p.staff_id); });
  const db = { settings, allowances, profiles: ps, kintai: { locked: true, locked_at: '2026-01-16T09:00:00+09:00', period: PERIOD, summary_by_staff: summary },
    run: null, items: [], prev_items: ps.map((p, i) => ({ staff_id: p.staff_id, gross: 250000 + i * 1000, net: 200000 + i * 1000 })), fingerprint: null, log: [], members: [{ email: 'check-clerk@example.invalid', added_at: '2025-12-01T10:00:00+09:00' }] };
  if (opt.start === 'confirmed') {
    const C = stubCalc();
    db.items = ps.filter((p) => !p.data.exclude).map((p) => Object.assign(C.computeItem({ ym: YM, period: PERIOD, payDate: C.payDate(YM, settings.config), settings: settings.config, profile: p.data,
      allowanceDefs: allowances, att: p.data.no_attendance ? null : summary[p.staff_id], adjustments: [], prevItem: null, profileRev: p.rev, settingsRev: settings.rev }), { staff_id: p.staff_id, name: p.name, adjustments: [] }));
    db.run = { status: 'confirmed', rev: 2, stale: false, calc_at: '2026-01-17T10:00:00+09:00', confirmed_at: '2026-01-18T10:00:00+09:00', confirmed_by: 'check-admin@example.invalid' };
  }
  return db;
}
function fpNow(db) {
  const revs = {}; db.profiles.forEach((p) => { revs[p.staff_id] = p.rev; });
  return JSON.stringify({ k: db.kintai.locked_at, p: revs, s: db.settings.rev });
}
function fpOf(f) { return JSON.stringify({ k: f && f.kintai_locked_at, p: f && f.profile_revs, s: f && f.settings_rev }); }

/* 施設情報は公開リポジトリに無いので見本を返す */
const SAMPLE_PROFILE = new globalThis.URL('../../facility-profile.sample.json', import.meta.url);
const PROFILE_ROUTE = { match: '**/facility-profile.json', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(SAMPLE_PROFILE, 'utf8') }) };
const CALC_ROUTE = { match: '**/payroll-calc.js*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: STUB }) };
const EXPORT_ROUTE = { match: '**/payroll-export.js*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: '/* 偽の部品は payroll-calc.js の中に一緒にある（PayrollExport） */\n' }) };

export function routesFor(opt = {}) {
  const role = opt.role || 'admin', aal = opt.aal || 'aal2';
  const db = seed(opt);
  const calls = [];
  const out = [{
    match: SB + '/**',
    handle(route) {
      const req = route.request(), u = req.url();
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = (v, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
      if (/\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role, mfa: aal === 'aal2' });
      if (/\/rest\/v1\/allowed_accounts/.test(u)) return json({ role, label: '' });
      if (/\/auth\/v1\/factors|\/auth\/v1\/user/.test(u)) return json({ id: '00000000-0000-4000-8000-00000000a1a1', factors: [] });
      if (/\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role, rules: null, mine: role === 'office' ? { payroll: true } : null, updatedAt: null });
      const m = /\/rest\/v1\/rpc\/(payroll_[a-z_]+)/.exec(u);
      if (!m) return json({ code: 'PGRST202', message: 'check fixture: not served' }, 404);
      let p = {};
      try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
      const name = m[1];
      calls.push({ name, args: p });
      if (opt.deny) return json({ code: '42501', message: 'permission denied for function ' + name }, 403);
      if (aal !== 'aal2') return json({ code: '42501', message: 'payroll: aal2 required' }, 403);
      if (name === 'payroll_bootstrap') return json(Object.assign({ ok: true }, JSON.parse(JSON.stringify({ settings: db.settings, allowances: db.allowances, profiles: db.profiles, kintai: db.kintai, run: db.run, items: db.items, prev_items: db.prev_items }))));
      if (name === 'payroll_run_save') {
        if (db.run && db.run.status !== 'draft') return json({ ok: false, error: 'confirmed' });
        if ((db.run ? db.run.rev : 0) !== p.p_rev) return json({ ok: false, error: 'conflict' });
        if (fpOf(p.p_fingerprint) !== fpNow(db)) return json({ ok: false, error: 'stale' });
        db.items = p.p_items; db.fingerprint = p.p_fingerprint;
        db.run = { status: 'draft', rev: (db.run ? db.run.rev : 0) + 1, stale: false, calc_at: new Date().toISOString() };
        return json({ ok: true, rev: db.run.rev });
      }
      if (name === 'payroll_run_confirm') {
        if (!db.run || db.run.status !== 'draft') return json({ ok: false, error: 'notfound' });
        if (db.run.rev !== p.p_rev) return json({ ok: false, error: 'conflict' });
        if (fpOf(db.fingerprint) !== fpNow(db)) return json({ ok: false, error: 'stale' });
        db.run = Object.assign({}, db.run, { status: 'confirmed', rev: db.run.rev + 1, confirmed_at: new Date().toISOString(), confirmed_by: 'check-admin@example.invalid' });
        return json({ ok: true, rev: db.run.rev });
      }
      if (name === 'payroll_run_unconfirm') {
        if (role !== 'admin') return json({ code: '42501', message: 'permission denied' }, 403);
        if (!p.p_reason) return json({ ok: false, error: 'reason' });
        db.run = Object.assign({}, db.run, { status: 'draft', rev: db.run.rev + 1 });
        return json({ ok: true });
      }
      if (name === 'payroll_export_log') { db.log.push(p.p_kind); if (p.p_kind !== 'print' && db.run && db.run.status === 'confirmed') db.run.status = 'exported'; return json({ ok: true }); }
      if (name === 'payroll_bank_export') {
        const accounts = {};
        db.profiles.forEach((x, i) => { if (x.bank_last4) accounts[x.staff_id] = [{ bank_code: '9999', branch_code: '001', type: '1', number: '000' + String(1000 + i * 111).slice(-4), name_kana: 'ﾐﾎﾝ', amount_or_rest: 'rest' }]; });
        return json({ ok: true, accounts });
      }
      if (name === 'payroll_profile_put' || name === 'payroll_bank_put' || name === 'payroll_import_put' || name === 'payroll_settings_put' || name === 'payroll_members_put') {
        if (!p.p_reason && name !== 'payroll_members_put') return json({ ok: false, error: 'reason' });
        if (name === 'payroll_profile_put') { const x = db.profiles.find((q) => q.staff_id === p.p_staff_id); if (!x) return json({ ok: false, error: 'notfound' }); if (x.rev !== p.p_rev) return json({ ok: false, error: 'conflict' }); x.data = p.p_data; x.rev++; x.effective_from = p.p_effective_from; }
        if (name === 'payroll_settings_put') { if (db.settings.rev !== p.p_rev) return json({ ok: false, error: 'conflict' }); db.settings = { config: p.p_config, rev: db.settings.rev + 1 }; }
        if (name === 'payroll_members_put') db.members = (p.p_emails || []).map((email) => ({ email, added_at: new Date().toISOString() }));
        return json({ ok: true });
      }
      if (name === 'payroll_members_get') return json({ ok: true, members: db.members });
      return json({ code: 'PGRST202', message: 'check fixture: not served' }, 404);
    },
  }, PROFILE_ROUTE, CALC_ROUTE, EXPORT_ROUTE];
  out.db = db; out.calls = calls;
  return out;
}
export const routes = routesFor({ start: 'confirmed' });

/* 給与明細の「全員分を印刷」の紙。ページの中で動く（印刷のダイアログは開かない） */
export const sheets = [
  { key: 'slips', arg: null, ready: '#p-print .slip',
    prepare: async () => {
      const wait = async (fn) => { for (let i = 0; i < 150; i++) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
      const b = await wait(() => document.querySelector('[data-act="print-all"]'));
      if (!b) return false;
      window.print = function () {};
      b.click();
      return !!(await wait(() => document.body.classList.contains('su-printing')));
    } },
];
export function respond() { return {}; }
