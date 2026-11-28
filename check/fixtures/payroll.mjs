/* check/fixtures/payroll.mjs — 給与の画面（payroll.html）を、架空の職員10人と偽のデータベースで開くための材料（2026-11-19 新設・同日 本物の部品と結ぶ）
 *
 * snap.mjs の材料の形（URL・match・storage・routes・sheets・respond）と、check/payroll_e2e.mjs の通し試験が使う。
 *   storage … 事務所PCとして開き、架空の管理者のアカウントで二段階のログイン（aal2）まで済ませた端末にする。給与明細のタブから開く
 *   routes  … Supabase への通信を全部横取りし、ログインの確かめ・アプリの使える人・給与の口（payroll_*）に架空の応答を返す。
 *             ★偽の DB は care-backend の統合 0102（supabase/migrations/0102_payroll.sql）の写し:
 *               ・関数ごとの引数の名前の組が完全に同じでなければ PostgREST と同じく 404 PGRST202（関数が見つからない）
 *               ・明細・設定・職員の設定・手当の定義・口座の形の確かめ（payroll_item_err・_settings_ok・_profile_ok・_allowance_ok・_bank_ok）を写した
 *               ・bootstrap の応答の形・指紋（payroll_fp）・断りの名前（stale・conflict・badshape・norun …）も同じ
 *             保存・確定はメモリにだけ覚える
 *             計算と書き出しの部品は本物（payroll-calc.js・payroll-rates.js・payroll-tax-table.js・payroll-export.js）をそのまま配る
 *   sheets  … 給与明細の「全員分を印刷」（A4 縦・1人1ページ・SUPrint の 'slips'）
 * routesFor(opt): role（'admin'|'office'）・aal（'aal2'|'aal1'）・deny（bootstrap が 42501）・start（'none'|'confirmed'）・zengin（真なら全銀のスイッチを入れる）・
 *                 kintaiDrift（真なら締めの控えの s-02 の総労働を60分ずらす＝今の勤怠の記録と控えが食い違う場面）・
 *                 ym（確定済みにする月分・既定は撮影の道具の固定の日の月分 2026-01）
 * 勤怠は、生の行（予定・打刻）を作って本物の kintai-calc.js の computeMonth・snapshotOf で締めの控えを作る（画面が数え直して控えと比べるため）。
 *   kintai_month_get（統合 0098・0101）にも同じ生の行を返す
 * ★撮影の道具の固定の日（2026-01）の月分は、率表（令和8年3月分〜）の外なので、確定済みの明細を前もって作る時だけ、率表の引きを令和8年4月分の率へ寄せる
 *   （材料の中だけ・画面の計算は本物の率表のまま）。通し試験（payroll_e2e.mjs）は 2026-11 の月分で本物の率表のまま計算する
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は「見本」の記号的な名前、口座・金額は実在しない値。メールは example.invalid。本物の Supabase へは出ない。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const URL = 'https://jhbernqawjrzqwrmqrih.supabase.co';
export const match = URL + '/rest/v1/rpc/payroll_bootstrap_unused';
const SB = URL;
const require = createRequire(import.meta.url);
const ROOT = new globalThis.URL('../../', import.meta.url);
const PC = require(fileURLToPath(new globalThis.URL('payroll-calc.js', ROOT)));
const PR = require(fileURLToPath(new globalThis.URL('payroll-rates.js', ROOT)));
const KC = require(fileURLToPath(new globalThis.URL('kintai-calc.js', ROOT)));
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

/* ── 統合 0102 の形の確かめの写し ── */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const yenOk = (v, lo = -9999999999) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= 9999999999;
const numOk = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
const txtOk = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const reOk = (v, re) => typeof v === 'string' && re.test(v);
const dateOk = (v) => reOk(v, /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const nul = (v) => v === null;
const SID = /^(p:)?[A-Za-z0-9_-]{1,40}$/;
export function profileOk(d, sid) {
  if (!isObj(d) || !('pay_type' in d)) return false;
  for (const [k, v] of Object.entries(d)) {
    if (k === 'pay_type') { if (!['monthly', 'hourly', 'daily', 'board'].includes(v)) return false; }
    else if (k === 'base' || k === 'board_pay') { if (!(nul(v) || yenOk(v, 0))) return false; }
    else if (k === 'avg_month_hours') { if (!(nul(v) || numOk(v, 1, 400))) return false; }
    else if (k === 'avg_month_days') { if (!(nul(v) || numOk(v, 1, 31))) return false; }
    else if (k === 'day_hours') { if (!(nul(v) || numOk(v, 0.5, 24))) return false; }
    else if (k === 'allowances' || k === 'deductions') {
      if (!Array.isArray(v) || v.length > 60) return false;
      for (const e of v) {
        if (!isObj(e) || !reOk(e.code, /^[A-Za-z0-9_-]{1,40}$/)) return false;
        for (const [k2, v2] of Object.entries(e)) {
          if (k2 === 'code') continue;
          if (k2 === 'amount') { if (!(nul(v2) || yenOk(v2))) return false; }
          else if (k2 === 'name') { if (!txtOk(v2, 40)) return false; }
          else if (k2 === 'count_source' && k === 'allowances') { if (!(nul(v2) || txtOk(v2, 40))) return false; }
          else if (k2 === 'count' && k === 'allowances') { if (!(nul(v2) || numOk(v2, 0, 9999))) return false; }
          else return false;
        }
      }
    } else if (k === 'commute') {
      if (!isObj(v)) return false;
      for (const [k2, v2] of Object.entries(v)) {
        if (k2 === 'monthly') { if (!(nul(v2) || yenOk(v2, 0))) return false; }
        else if (k2 === 'means') { if (!(nul(v2) || txtOk(v2, 20))) return false; }
        else if (k2 === 'distance_km') { if (!(nul(v2) || numOk(v2, 0, 1000))) return false; }
        else if (k2 === 'parking_monthly') { if (!(nul(v2) || yenOk(v2, 0))) return false; }   /* 統合 0118 */
        else return false;
      }
    } else if (k === 'fixed_ot') {
      if (!nul(v)) { if (!isObj(v) || !reOk(v.allowance_code, /^[A-Za-z0-9_-]{1,40}$/) || !yenOk(v.covered_min, 0) || ('checked' in v && typeof v.checked !== 'boolean') || Object.keys(v).some((z) => !['allowance_code', 'covered_min', 'checked'].includes(z))) return false; }   /* checked は B の担当が足している */
    } else if (['birth_date', 'entry_date', 'retire_date'].includes(k)) { if (!(nul(v) || dateOk(v))) return false; }
    else if (k === 'gender') { if (!(nul(v) || ['M', 'F', ''].includes(v))) return false; }
    else if (k === 'ins') {
      if (!isObj(v)) return false;
      for (const [k2, v2] of Object.entries(v)) {
        if (k2 === 'care_exempt') { if (typeof v2 !== 'boolean') return false; }
        else if (['health', 'pension', 'emp'].includes(k2)) {
          if (!isObj(v2)) return false;
          for (const [k3, v3] of Object.entries(v2)) {
            if (k3 === 'on') { if (typeof v3 !== 'boolean') return false; }
            else if (k3 === 'from' || k3 === 'to') { if (!(nul(v3) || dateOk(v3))) return false; }
            else if (k3 === 'std' && k2 !== 'emp') { if (!(nul(v3) || yenOk(v3, 0))) return false; }
            else if (k3 === 'exempt') { if (!Array.isArray(v3) || v3.length > 20 || !v3.every((e) => isObj(e) && reOk(e.from_ym, /^\d{4}-(0[1-9]|1[0-2])$/) && (e.to_ym == null || reOk(e.to_ym, /^\d{4}-(0[1-9]|1[0-2])$/)) && Object.keys(e).every((z) => z === 'from_ym' || z === 'to_ym'))) return false; }
            else return false;
          }
        } else return false;
      }
    } else if (k === 'tax') {
      if (!isObj(v)) return false;
      for (const [k2, v2] of Object.entries(v)) {
        if (k2 === 'col') { if (!['kou', 'otsu', 'none'].includes(v2)) return false; }
        else if (k2 === 'dependents') { if (!(numOk(v2, 0, 30) && yenOk(v2, 0))) return false; }
        else if (k2 === 'dependents_checked') { if (typeof v2 !== 'boolean') return false; }
        else return false;
      }
    } else if (k === 'resident_tax') {
      if (!isObj(v) || Object.keys(v).length > 24) return false;
      for (const [k2, v2] of Object.entries(v)) if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k2) || !yenOk(v2, 0)) return false;
    } else if (k === 'resident_city') {   /* 統合 0143: 住民税の納め先 {name 1〜40字, code 6桁・任意}・空も可 */
      if (!nul(v)) {
        if (!isObj(v) || !('name' in v)) return false;
        for (const [k2, v2] of Object.entries(v)) {
          if (k2 === 'name') { if (!txtOk(v2, 40, 1)) return false; }
          else if (k2 === 'code') { if (!(nul(v2) || (typeof v2 === 'string' && /^[0-9]{6}$/.test(v2)))) return false; }
          else return false;
        }
      }
    } else if (k === 'no_attendance' || k === 'exclude') { if (typeof v !== 'boolean') return false; }
    else if (k === 'freee_emp_num') { if (!(nul(v) || txtOk(v, 20) || yenOk(v, 0))) return false; }
    else if (k === 'staff_id') { if (v !== sid) return false; }
    else if (k === 'name') { if (!txtOk(v, 60, 1)) return false; }
    else return false;
  }
  return true;
}
export function settingsOk(c) {
  if (!isObj(c) || !('pay_day' in c)) return false;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'pay_day') { if (!(numOk(v, 1, 31) && yenOk(v, 1))) return false; }
    else if (k === 'pay_day_shift') { if (!['before', 'after', 'none'].includes(v)) return false; }
    else if (k === 'si_month') { if (!['next', 'current'].includes(v)) return false; }
    else if (k === 'tax_method') { if (!['table', 'computer'].includes(v)) return false; }
    else if (k === 'night_premium') { if (!['pay', 'included'].includes(v)) return false; }
    else if (k === 'prefecture') { if (!reOk(v, /^(0[1-9]|[1-3]\d|4[0-7])$/)) return false; }
    else if (k === 'emp_ins_kind') { if (!txtOk(v, 20, 1)) return false; }
    else if (k === 'avg_month_hours_default') { if (!numOk(v, 1, 400)) return false; }
    else if (k === 'avg_month_days_default') { if (!numOk(v, 1, 31)) return false; }
    else if (k === 'ot_rates') { if (!isObj(v)) return false; for (const [k2, v2] of Object.entries(v)) if (!['in', 'out', 'over60', 'night', 'holiday'].includes(k2) || !numOk(v2, 0, 3)) return false; }
    else if (k === 'round') { if (!isObj(v)) return false; for (const [k2, v2] of Object.entries(v)) if (!/^[a-z_]{1,20}$/.test(k2) || !['ceil', 'floor', 'round', 'none'].includes(v2)) return false; }
    else if (k === 'absence_deduct' || k === 'late_deduct') { if (typeof v !== 'boolean') return false; }
    else if (k === 'holidays') { if (!Array.isArray(v) || v.length > 500 || !v.every(dateOk)) return false; }
    else if (k === 'bank_from') {
      if (!isObj(v)) return false;
      for (const [k2, v2] of Object.entries(v)) {
        const re = { consignor_code: /^\d{10}$/, bank_code: /^\d{4}$/, branch_code: /^\d{3}$/, type: /^[1-9]$/, number: /^\d{7}$/ }[k2];
        if (re) { if (!reOk(v2, re)) return false; }
        else if (['consignor_kana', 'bank_name', 'branch_name', 'bank_kana', 'branch_kana'].includes(k2)) { if (!txtOk(v2, 40)) return false; }
        else return false;
      }
    } else if (k === 'zengin') {
      if (!isObj(v)) return false;
      for (const [k2, v2] of Object.entries(v)) {
        if (k2 === 'kind') { if (!['21', '11'].includes(v2)) return false; }
        else if (k2 === 'charset') { if (v2 !== 'sjis') return false; }
        else if (k2 === 'crlf') { if (typeof v2 !== 'boolean') return false; }
        else return false;
      }
    } else if (k === 'company_name') { if (!txtOk(v, 100)) return false; }
    else if (k === 'journal') { if (!isObj(v)) return false; }
    else if (k === 'zengin_enabled') { if (typeof v !== 'boolean') return false; }   /* B の担当が足している（全銀の書き出しを使う印） */
    else return false;
  }
  return true;
}
export function allowanceOk(d) {
  if (!isObj(d) || !reOk(d.code, /^[A-Za-z0-9_-]{1,40}$/) || !txtOk(d.name, 40, 1) || !['pay', 'deduct'].includes(d.sec) || !['fixed', 'count', 'hour', 'day', 'night_shift'].includes(d.calc)) return false;
  const AT = ['income_tax', 'social_ins', 'labor_ins', 'emp_ins', 'overtime_base', 'attendance_base', 'fixed_wage', 'min_wage', 'prorate', 'includes_night_premium', 'si_as_deduct'];
  for (const [k, v] of Object.entries(d)) {
    if (['code', 'name', 'sec', 'calc'].includes(k)) continue;
    if (k === 'unit') { if (!(nul(v) || typeof v === 'number')) return false; }
    else if (k === 'attrs') { if (!isObj(v)) return false; for (const [k2, v2] of Object.entries(v)) if (!AT.includes(k2) || typeof v2 !== 'boolean') return false; }
    else if (k === 'round') { if (!(nul(v) || ['ceil', 'floor', 'round', 'none'].includes(v))) return false; }
    else if (k === 'order') { if (!yenOk(v, 0)) return false; }
    else if (k === 'hidden') { if (typeof v !== 'boolean') return false; }
    else if (k === 'freee_id') { if (!(nul(v) || txtOk(v, 40) || yenOk(v, 0))) return false; }
    else return false;
  }
  return true;
}
export function bankOk(a) {
  if (!Array.isArray(a) || a.length < 1 || a.length > 3) return false;
  let rest = 0;
  for (const e of a) {
    if (!isObj(e) || !reOk(e.bank_code, /^\d{4}$/) || !reOk(e.branch_code, /^\d{3}$/) || !reOk(e.type, /^[1-9]$/) || !reOk(e.number, /^\d{7}$/) || !txtOk(e.name_kana, 48, 1)) return false;
    if (!(e.amount_or_rest === 'rest' || yenOk(e.amount_or_rest, 0))) return false;
    if (e.amount_or_rest === 'rest') rest++;
    for (const [k, v] of Object.entries(e)) {
      if (['bank_code', 'branch_code', 'type', 'number', 'name_kana', 'amount_or_rest'].includes(k)) continue;
      if (k === 'bank_name' || k === 'branch_name') { if (!(nul(v) || txtOk(v, 40))) return false; }
      else return false;
    }
  }
  return rest <= 1;
}
/* 1人分の明細。合えば null、違えば 'badshape' か 'badsum' */
export function itemErr(x) {
  if (!isObj(x) || !reOk(x.staff_id, SID)) return 'badshape';
  if (Object.keys(x).some((k) => !['staff_id', 'item', 'adjustments'].includes(k))) return 'badshape';
  const it = x.item;
  if (!isObj(it) || !yenOk(it.gross) || !yenOk(it.deduct) || !yenOk(it.net)) return 'badshape';
  let sp = 0, sd = 0;
  for (const [k, v] of Object.entries(it)) {
    if (['gross', 'deduct', 'net'].includes(k)) continue;
    if (['taxable', 'si_total', 'emp_ins_base', 'tax_base'].includes(k)) { if (!(nul(v) || yenOk(v))) return 'badshape'; }
    else if (['buckets', 'fingerprint_inputs', 'att'].includes(k)) { if (!(nul(v) || isObj(v))) return 'badshape'; }
    else if (k === 'pay_date') { if (!(nul(v) || dateOk(v))) return 'badshape'; }
    else if (k === 'warnings') { if (!Array.isArray(v) || v.length > 100 || !v.every((w) => isObj(w) && txtOk(w.code, 40, 1) && (w.msg === undefined || txtOk(w.msg, 300)))) return 'badshape'; }
    else if (k === 'lines') {
      if (!Array.isArray(v) || v.length > 300) return 'badshape';
      for (const ln of v) {
        if (!isObj(ln) || !['pay', 'deduct', 'att', 'employer'].includes(ln.sec)) return 'badshape';
        for (const [k2, v2] of Object.entries(ln)) {
          if (k2 === 'sec') continue;
          if (k2 === 'code') { if (!txtOk(v2, 48)) return 'badshape'; }
          else if (k2 === 'name') { if (!txtOk(v2, 60)) return 'badshape'; }
          else if (k2 === 'qty' || k2 === 'unit') { if (!(nul(v2) || typeof v2 === 'number')) return 'badshape'; }
          else if (k2 === 'amount') { if (ln.sec === 'pay' || ln.sec === 'deduct' ? !yenOk(v2) : !(nul(v2) || typeof v2 === 'number')) return 'badshape'; }
          else if (k2 === 'basis') { if (!(nul(v2) || txtOk(v2, 300))) return 'badshape'; }
          else return 'badshape';
        }
        if (ln.sec === 'pay') sp += ln.amount; else if (ln.sec === 'deduct') sd += ln.amount;
      }
    } else return 'badshape';
  }
  if (x.adjustments != null) {
    if (!Array.isArray(x.adjustments) || x.adjustments.length > 50) return 'badshape';
    for (const e of x.adjustments) {
      if (!isObj(e) || !['pay', 'pay_nontax', 'deduct', 'deduct_si', 'tax_adjust'].includes(e.kind) || !txtOk(e.name, 40, 1) || !yenOk(e.amount) || !txtOk(e.reason, 200, 1)
        || Object.keys(e).some((z) => !['kind', 'name', 'amount', 'reason'].includes(z))) return 'badshape';
    }
  }
  if (it.gross !== sp || it.deduct !== sd || it.net !== it.gross - it.deduct) return 'badsum';
  return null;
}
/* 関数ごとの引数の名前の組（統合 0102 の関数の見出しと同じ・違えば PGRST202） */
const ARGS = {
  payroll_bootstrap: ['p_ym'], payroll_run_save: ['p_fingerprint', 'p_items', 'p_rev', 'p_ym'], payroll_run_confirm: ['p_rev', 'p_ym'], payroll_run_unconfirm: ['p_reason', 'p_ym'],
  payroll_profile_put: ['p_data', 'p_effective_from', 'p_rev', 'p_reason', 'p_staff_id'], payroll_bank_put: ['p_accounts', 'p_reason', 'p_staff_id'], payroll_bank_export: ['p_ym'],
  payroll_settings_put: ['p_config', 'p_rev'], payroll_allowance_put: ['p_def', 'p_rev'], payroll_members_get: [], payroll_members_put: ['p_email', 'p_on'],
  payroll_export_log: ['p_kind', 'p_ym'], payroll_audit_get: ['p_from', 'p_to'], payroll_import_put: ['p_payload'],
  /* 年末調整（統合 0122・2026-11-23）。引数の名前は凍結仕様 ROOT-yearend.md の A */
  payroll_ytd_get: ['p_year'], payroll_ytd_put: ['p_rows', 'p_year'], payroll_ytd_delete: ['p_kind', 'p_pay_date', 'p_reason', 'p_rev', 'p_staff_id', 'p_year'],
  payroll_yearend_put: ['p_basis', 'p_decl', 'p_result', 'p_rev', 'p_settle_ym', 'p_staff_id', 'p_year'], payroll_yearend_finalize: ['p_rev', 'p_staff_id', 'p_year'],
  payroll_yearend_unfinalize: ['p_reason', 'p_staff_id', 'p_year'], payroll_yearend_check: ['p_year'], payroll_yearend_log: ['p_count', 'p_kind', 'p_year'],
};
/* ── 統合 0121（賞与・care-backend の下書き PR #206 の supabase/migrations/0121_payroll_bonus.sql）の写し（2026-11-23） ──
   関数の引数の名前の組・1人分の明細の形の確かめ（private.payroll_bonus_item_err）・回の手入力の形（private.payroll_bonus_config_ok）。
   opt.bonus が真の時だけ賞与の関数を出す（偽なら PostgREST と同じく 404 PGRST202＝0121 の前の DB） */
export const BONUS_ARGS = {
  payroll_bonus_bootstrap: ['p_bonus_id'], payroll_bonus_create: ['p_pay_date', 'p_title'], payroll_bonus_config_put: ['p_bonus_id', 'p_config', 'p_rev'],
  payroll_bonus_save: ['p_bonus_id', 'p_items', 'p_fingerprint', 'p_rev'], payroll_bonus_confirm: ['p_bonus_id', 'p_rev'], payroll_bonus_unconfirm: ['p_bonus_id', 'p_reason'],
  payroll_bonus_delete: ['p_bonus_id', 'p_rev'], payroll_bonus_bank_export: ['p_bonus_id'], payroll_bonus_export_log: ['p_bonus_id', 'p_kind'],
};
const BONUS_ID = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])#[1-9]$/;
const isNull = (v) => v === null;
export function bonusConfigOk(c) {
  if (!isObj(c) || JSON.stringify(c).length > 65536) return false;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'fy_prior_std' || k === 'prior_count_12m') {
      if (!isObj(v) || Object.keys(v).length > 500) return false;
      for (const [k2, v2] of Object.entries(v)) {
        if (!SID.test(k2)) return false;
        if (k === 'fy_prior_std') { if (!yenOk(v2, 0) || v2 % 1000 !== 0) return false; }
        else if (!yenOk(v2, 0) || v2 > 12) return false;
      }
    } else if (k === 'bonus_period_months') { if (!yenOk(v, 1) || v > 12) return false; }
    else return false;
  }
  return true;
}
/* 1人分の明細（要素 {staff_id, item, prev_manual}）。合えば null、違えば 'badshape' か 'badsum'（0121 の payroll_bonus_item_err と同じ順で確かめる） */
export function bonusItemErr(x) {
  if (!isObj(x) || !reOk(x.staff_id, SID)) return 'badshape';
  if (Object.keys(x).some((k) => !['staff_id', 'item', 'prev_manual'].includes(k))) return 'badshape';
  const pm = x.prev_manual;
  if (pm !== undefined && pm !== null) {
    if (!isObj(pm)) return 'badshape';
    for (const [k, v] of Object.entries(pm)) {
      if (k === 'P') { if (!(isNull(v) || yenOk(v))) return 'badshape'; }
      else if (k === 'none') { if (typeof v !== 'boolean') return 'badshape'; }
      else if (k === 'source') { if (!(isNull(v) || txtOk(v, 20))) return 'badshape'; }
      else return 'badshape';
    }
    if (pm.none === true) { if (yenOk(pm.P)) return 'badshape'; } else if (!yenOk(pm.P)) return 'badshape';
  }
  const it = x.item;
  if (!isObj(it) || JSON.stringify(it).length > 262144) return 'badshape';
  if (!(yenOk(it.gross, 0) && yenOk(it.deduct, 0) && yenOk(it.net) && yenOk(it.social, 0) && yenOk(it.tax, 0) && Array.isArray(it.lines) && isObj(it.std) && isObj(it.ins) && Array.isArray(it.warns) && txtOk(it.ver, 40, 1))) return 'badshape';
  let sPay = 0, sDed = 0; const sCode = {};
  for (const [k, v] of Object.entries(it)) {
    if (['gross', 'deduct', 'net', 'social', 'tax', 'ver'].includes(k)) continue;
    if (['taxable', 'tax_base', 'P'].includes(k)) { if (!(isNull(v) || yenOk(v))) return 'badshape'; }
    else if (k === 'std') { if (Object.keys(v).some((z) => !['health', 'pension'].includes(z)) || !(yenOk(v.health, 0) && yenOk(v.pension, 0))) return 'badshape'; }
    else if (k === 'ins') { if (Object.keys(v).some((z) => !['health', 'care', 'support', 'pension', 'emp'].includes(z)) || !['health', 'care', 'support', 'pension', 'emp'].every((z) => yenOk(v[z], 0))) return 'badshape'; }
    else if (k === 'employer') { if (!isObj(v) || Object.keys(v).length > 30 || Object.entries(v).some(([k2, v2]) => !/^[A-Za-z_]{1,30}$/.test(k2) || !(isNull(v2) || numOk(v2, -9999999999, 9999999999)))) return 'badshape'; }
    else if (k === 'taxMethod') { if (!(isNull(v) || ['rate', 'monthly_none', 'monthly_10x'].includes(v))) return 'badshape'; }
    else if (k === 'rate') { if (!(isNull(v) || numOk(v, 0, 100))) return 'badshape'; }
    else if (k === 'prev_kind') { if (!(isNull(v) || ['none', 'ok', 'unconfirmed', 'manual'].includes(v))) return 'badshape'; }
    else if (k === 'warns') { if (v.length > 100 || !v.every((e) => isObj(e) && txtOk(e.code, 40, 1) && (e.msg === undefined || txtOk(e.msg, 300)))) return 'badshape'; }
    else if (k === 'lines') {
      if (v.length > 300) return 'badshape';
      for (const ln of v) {
        if (!isObj(ln) || typeof ln.sec !== 'string' || !['pay', 'deduct', 'employer'].includes(ln.sec)) return 'badshape';
        for (const [k2, v2] of Object.entries(ln)) {
          if (k2 === 'sec') continue;
          if (k2 === 'code') { if (!txtOk(v2, 48)) return 'badshape'; }
          else if (k2 === 'name') { if (!txtOk(v2, 60)) return 'badshape'; }
          else if (k2 === 'amount') { if (ln.sec === 'pay' || ln.sec === 'deduct' ? !yenOk(v2) : !(isNull(v2) || numOk(v2, -9999999999, 9999999999))) return 'badshape'; }
          else if (k2 === 'basis') { if (!(isNull(v2) || txtOk(v2, 300))) return 'badshape'; }
          else return 'badshape';
        }
        if (ln.sec === 'pay') sPay += ln.amount || 0;
        else if (ln.sec === 'deduct') { sDed += ln.amount || 0; const c = ln.code || ''; sCode[c] = (sCode[c] || 0) + (ln.amount || 0); }
      }
    } else return 'badshape';
  }
  if (it.social !== it.ins.health + it.ins.care + it.ins.support + it.ins.pension + it.ins.emp) return 'badshape';
  for (const c of ['health', 'care', 'support', 'pension', 'emp']) if ((sCode[c] || 0) !== it.ins[c]) return 'badshape';
  if ((sCode.income_tax || 0) !== it.tax) return 'badshape';
  const fl = Math.floor(it.gross / 1000) * 1000;
  if (it.std.health % 1000 !== 0 || it.std.pension % 1000 !== 0 || it.std.health > fl || it.std.pension > Math.min(fl, 1500000)) return 'badshape';
  if (it.gross !== sPay || it.deduct !== sDed || it.net !== it.gross - it.deduct) return 'badsum';
  return null;
}
/* DB の直し（止めの印を computeBonus の止めにそろえて10個）に合わせた（2026-11-23） */
export const BONUS_STOP = ['prev_missing', 'prev_unconfirmed', 'rate_missing', 'tax_table_missing', 'emp_rate_missing', 'std_missing', 'badinput', 'calc_error', 'leave_check', 'tax_col'];
const ADMIN_ONLY = ['payroll_bonus_unconfirm', 'payroll_run_unconfirm', 'payroll_settings_put', 'payroll_allowance_put', 'payroll_members_get', 'payroll_members_put', 'payroll_audit_get', 'payroll_import_put'];

/* ── 架空の材料 ── */
const ymAdd = (ym, n) => PC.ymAdd(ym, n);
/* 15日締め: その月分の期間は前の月の16日〜その月の15日 */
export function periodOf(ym) { return { from: ymAdd(ym, -1) + '-16', to: ym + '-15' }; }
const STAFF = [['s-01', '見本 一郎'], ['s-02', '見本 二子'], ['s-03', '見本 三郎'], ['s-04', '見本 四子'], ['s-05', '見本 五郎'], ['s-06', '見本 六子'], ['s-07', '見本 七郎'], ['s-08', '見本 八子'], ['s-09', '見本 九郎'], ['s-11', '見本 十一']];
/* 架空の職員10人（月給・時給・日給・中途入社・退職・40歳・70歳・乙欄・夜勤・60時間超の型を1人ずつ）＋役員（p:10）。s-11 は給与の設定がまだ無い人 */
function profileRows(ym) {
  const P0 = periodOf(ym);
  const base = (o) => Object.assign({ avg_month_hours: 172, allowances: [], deductions: [], commute: { monthly: 0 }, gender: 'F', entry_date: '2020-04-01', retire_date: null,
    ins: { health: { on: true, std: 260000 }, pension: { on: true, std: 260000 }, emp: { on: true }, care_exempt: false }, tax: { col: 'kou', dependents: 0, dependents_checked: true },
    resident_tax: { [ym]: 9000 }, no_attendance: false, exclude: false }, o);
  const inP = (d) => P0.from.slice(0, 8) + d;   /* 期間の初めの月の日 */
  const P = [
    ['s-01', base({ pay_type: 'monthly', base: 240000, birth_date: '1980-05-01', gender: 'M', allowances: [{ code: 'qual', amount: 10000 }], commute: { monthly: 8000, means: 'car', distance_km: 6 } })],
    ['s-02', base({ pay_type: 'hourly', base: 1100, birth_date: '1975-02-10', ins: { health: { on: true, std: 150000 }, pension: { on: true, std: 150000 }, emp: { on: true } } })],
    ['s-03', base({ pay_type: 'daily', base: 9000, day_hours: 8, birth_date: '1990-11-30', gender: 'M' })],
    ['s-04', base({ pay_type: 'monthly', base: 210000, birth_date: '1999-07-07', entry_date: inP('20') })],
    ['s-05', base({ pay_type: 'monthly', base: 230000, birth_date: '1985-01-20', gender: 'M', retire_date: ym + '-10' })],
    ['s-06', base({ pay_type: 'monthly', base: 250000, birth_date: '1986-01-15', tax: { col: 'kou', dependents: 2, dependents_checked: false } })],
    ['s-07', base({ pay_type: 'hourly', base: 1200, birth_date: '1956-01-12', gender: 'M', ins: { health: { on: true, std: 98000 }, pension: { on: false }, emp: { on: true } } })],
    ['s-08', base({ pay_type: 'hourly', base: 1050, birth_date: '1970-09-09', tax: { col: 'otsu', dependents: 0 }, ins: { health: { on: false }, pension: { on: false }, emp: { on: false } } })],
    ['s-09', base({ pay_type: 'monthly', base: 260000, birth_date: '1978-03-03', gender: 'M', allowances: [{ code: 'night', amount: 5000 }] })],
    ['p:10', base({ pay_type: 'board', board_pay: 400000, birth_date: '1965-12-01', no_attendance: true, name: '見本 十子', ins: { health: { on: true, std: 410000 }, pension: { on: true, std: 410000 }, emp: { on: false } } })],
  ];
  return P.map(([staff_id, data], i) => ({ staff_id, effective_from: i === 0 ? P0.from : '2025-04-16', data, rev: 1 }));
}
/* 勤怠の生の行（予定 9:00〜18:00・休憩60分・平日・休みの日を除く・打刻は予定どおり）と、本物の kintai-calc.js で作った締めの控え。
   s-02・s-07 は最初の日を有休にする。s-04 は入社日から・s-05 は退職日まで。月ごとに1回だけ作る。
   kintaiLeave（v4 2026-11-20）が真なら、s-03 の最初の日はシフトに予定を置かず、手で入れた有休の使用（leave_uses・1日）にする＝締めの控えにその有休が入る */
function kintaiOf(db, ym) {
  if (db.kraw[ym]) return db.kraw[ym];
  const per = periodOf(ym), hol = (db.settings.config.holidays || []);
  const staff = db.staff.map((x) => ({ staff_id: x.staff_id, name: x.name, office: x.office, emp_code: x.emp_code, active: x.active }));
  const schedule = [], punches = [], leave_uses = [];
  const at = (d, m) => new Date(KC.jstMs(d, m)).toISOString();
  staff.forEach((st) => {
    const pr = profileAt(db, st.staff_id, per.from), d0 = pr ? pr.data : {};
    let first = true;
    for (let d = per.from; d <= per.to; d = KC.addDays(d, 1)) {
      const w = new Date(d + 'T00:00:00Z').getUTCDay();
      if (w === 0 || w === 6 || hol.includes(d)) continue;
      if (d0.entry_date && d < d0.entry_date) continue;
      if (d0.retire_date && d > d0.retire_date) continue;
      if (first && db.leave && st.staff_id === 's-03') { first = false; leave_uses.push({ id: 'lu-' + st.staff_id + d, staff_id: st.staff_id, use_date: d, days: 1, note: '', voided_at: null }); continue; }
      if (first && (st.staff_id === 's-02' || st.staff_id === 's-07')) { first = false; schedule.push({ staff_id: st.staff_id, work_date: d, seq: 1, kind: 'paid', start_at: null, end_at: null, break_min: 0, paid_min: 480, office: 'facility', symbol: '有' }); continue; }
      first = false;
      schedule.push({ staff_id: st.staff_id, work_date: d, seq: 1, kind: 'work', start_at: at(d, 540), end_at: at(d, 1080), break_min: 60, paid_min: 0, office: 'facility', symbol: '日' });
      punches.push({ id: 'k-' + st.staff_id + d + 'i', staff_id: st.staff_id, kind: 'in', at: at(d, 540), source: 'tablet', created_at: at(d, 540) });
      punches.push({ id: 'k-' + st.staff_id + d + 'o', staff_id: st.staff_id, kind: 'out', at: at(d, 1080), source: 'tablet', created_at: at(d, 1080) });
    }
  });
  const lockedAt = db.kintai.locked_at;
  const month = KC.computeMonth({ ym, period: per, staff, schedule, punches, days: [], leave_uses, config: {}, lockedAt, now: Date.parse(lockedAt) });
  const snapshot = KC.snapshotOf(month);
  if (db.drift) snapshot.rows.forEach((r) => { if (r.staff_id === 's-02') { r.workMin += 60; r.schedInMin += 60; } });
  db.kraw[ym] = { raw: Object.assign({ period: per, staff, schedule, punches, days: [] }, db.leave ? { leave_uses } : {}), snapshot };
  return db.kraw[ym];
}
const attOfRow = (db, ym, sid) => (kintaiOf(db, ym).snapshot.rows.find((r) => r.staff_id === sid) || null);
/* 前もって明細を作る時だけ使う率表（令和8年3月分より前の対象月を令和8年4月分の率へ寄せる・材料の中だけ） */
const RATES_NEAR = Object.assign({}, PR, {
  health: (pref, ym) => PR.health(pref, ym) || PR.health(pref, '2026-04'),
  employment: (d, k) => PR.employment(d, k) || PR.employment('2026-04-01', k),
});
const iso = (d) => new Date(d).toISOString();
export function seed(opt = {}) {
  const ym0 = opt.ym || '2026-01';
  const lock0 = KC.addDays(periodOf(ym0).to, 1) + 'T09:00:00+09:00';   /* 期間の終わりの翌朝に締めた */
  const config = { pay_day: 27, pay_day_shift: 'before', si_month: 'next', tax_method: 'table', prefecture: '43', avg_month_hours_default: 172, avg_month_days_default: 21.75,
    ot_rates: { in: 1, out: 1.25, over60: 0.25, night: 0.25, holiday: 1.35 }, round: { hour_unit: 'ceil', premium: 'ceil', prorate: 'floor', deduct_unit: 'floor', deduct: 'floor' },
    absence_deduct: true, late_deduct: true, holidays: ['2026-01-01', '2026-01-12', '2026-11-03', '2026-11-23'], night_premium: 'included',
    bank_from: { consignor_code: '0000000001', consignor_kana: 'ﾐﾎﾝ', bank_code: '9999', bank_kana: 'ﾐﾎﾝｷﾞﾝｺｳ', branch_code: '001', branch_kana: 'ﾎﾝﾃﾝ', type: '1', number: '0000001' },
    zengin: { kind: '21' }, company_name: '見本の事業者', zengin_enabled: !!opt.zengin };
  const db = {
    settings: { config, rev: 3 },
    allowances: [
      { code: 'qual', def: { code: 'qual', name: '資格手当', sec: 'pay', calc: 'fixed', order: 1, attrs: {} }, rev: 1 },
      { code: 'night', def: { code: 'night', name: '夜勤手当', sec: 'pay', calc: 'night_shift', order: 2, attrs: { includes_night_premium: true, overtime_base: false } }, rev: 1 },
      { code: 'meal', def: { code: 'meal', name: '食事代', sec: 'deduct', calc: 'fixed', order: 3, attrs: {} }, rev: 1 },
    ],
    staff: STAFF.map(([staff_id, name]) => ({ staff_id, name, office: 'facility', emp_code: null, active: true })),
    profiles: opt.noProfiles ? [] : profileRows(ym0),   /* noProfiles（2026-11-26）: 給与の設定が誰にも無い月分（計算できる人が0人）の場面 */
    bank: {},
    kintai: { locked_at: opt.kintaiUnlocked ? null : lock0 },   /* kintaiUnlocked（2026-11-26）: 勤怠がまだ締めていない月分の場面 */
    kraw: {}, drift: !!opt.kintaiDrift, leave: !!opt.kintaiLeave,
    runs: {}, items: {}, prev: {}, audit: [], log: [],
    members: [{ email: 'check-clerk@example.invalid', added_by: 'check-admin@example.invalid', added_at: '2025-12-01T10:00:00+09:00' }],
    offices: ['check-clerk@example.invalid', 'check-office@example.invalid', 'check-new@example.invalid'],
  };
  db.profiles.forEach((p, i) => {
    if (i === 2) return;   /* s-03 は口座なし */
    const accounts = [{ bank_code: '9999', branch_code: '001', type: '1', number: '000' + String(1000 + i * 111).slice(-4), name_kana: 'ﾐﾎﾝ', bank_name: '見本銀行', amount_or_rest: 'rest' }];
    if (i === 0) accounts.push({ bank_code: '9998', branch_code: '002', type: '1', number: '0002222', name_kana: 'ﾐﾎﾝ', bank_name: '見本信金', amount_or_rest: 30000 });   /* s-01 は2つの口座に分ける */
    db.bank[p.staff_id] = { rev: 1, accounts };
  });
  db.prev[ymAdd(ym0, -1)] = db.profiles.map((p, i) => ({ staff_id: p.staff_id, gross: 250000 + i * 1000, net: 200000 + i * 1000 }));
  if (opt.start === 'confirmed') {
    const per = periodOf(ym0), items = [];
    db.profiles.forEach((p) => {
      if (p.data.exclude) return;
      const it = PC.computeItem({ ym: ym0, period: per, payDate: PC.payDate(ym0, config), settings: config, profile: p.data, allowanceDefs: db.allowances.map((a) => a.def),
        att: p.data.no_attendance ? null : attOfRow(db, ym0, p.staff_id), adjustments: [], prevItem: null, profile_rev: p.rev, settings_rev: db.settings.rev, rates: RATES_NEAR });
      it.pay_date = PC.payDate(ym0, config);
      items.push({ staff_id: p.staff_id, item: it, adjustments: [] });
    });
    db.items[ym0] = items.map((x) => frozenRow(db, ym0, x));
    db.items[ym0].forEach((x) => freezeConfirmed(db, ym0, x, PC.payDate(ym0, config)));
    db.runs[ym0] = { status: 'confirmed', rev: 2, pay_date: PC.payDate(ym0, config), fingerprint: Object.assign(fp(db, ym0), { rates_ver: PR.VERSION, calc_ver: PC.VERSION }), stale: false, totals: totalsOf(db, ym0),
      bank_fp: bankFp(db, ym0), saved_at: '2026-01-17T10:00:00+09:00', saved_by: 'check-admin@example.invalid', confirmed_at: '2026-01-18T10:00:00+09:00', confirmed_by: 'check-admin@example.invalid', exported_at: null, history: [] };
  }
  return db;
}
/* 確定の時の写し（統合 0102 の payroll_run_confirm と同じ: 期間・支給日・事業者名・口座の下4桁） */
function freezeConfirmed(db, ym, x, payDate) {
  x.frozen.confirmed = { period: periodOf(ym), pay_date: payDate || null, company_name: db.settings.config.company_name || null,
    bank_last4: db.bank[x.staff_id] ? summaryOf(db.bank[x.staff_id].accounts) : [], at: new Date().toISOString() };
}
function nameOf(db, sid) { const s = db.staff.find((x) => x.staff_id === sid); if (s) return s.name; const p = db.profiles.filter((x) => x.staff_id === sid).pop(); return p ? p.data.name || null : null; }
function profileAt(db, sid, day) { return db.profiles.filter((p) => p.staff_id === sid && p.effective_from <= day).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] || null; }
function frozenRow(db, ym, x) {
  const per = periodOf(ym), pp = profileAt(db, x.staff_id, per.from);
  return { staff_id: x.staff_id, item: x.item, adjustments: x.adjustments || [], gross: x.item.gross, deduct: x.item.deduct, net: x.item.net,
    frozen: { name: nameOf(db, x.staff_id), profile: pp ? { effective_from: pp.effective_from, rev: pp.rev, data: pp.data } : null, settings: JSON.parse(JSON.stringify(db.settings)), period: per } };
}
/* 統合 0102 の payroll_fp の写し（md5 の代わりに同じ並びの文字列を使う・画面はそのまま返すだけ） */
function fp(db, ym) {
  const f = periodOf(ym).from, profiles = {};
  [...new Set(db.profiles.map((p) => p.staff_id))].forEach((sid) => { const p = profileAt(db, sid, f); if (p) profiles[sid] = p.effective_from + ':' + p.rev; });
  return { kintai_locked_at: db.kintai.locked_at ? String(Date.parse(db.kintai.locked_at) / 1000) : null, settings_rev: db.settings ? db.settings.rev : 0,
    allowances: db.allowances.slice().sort((a, b) => (a.code < b.code ? -1 : 1)).map((a) => a.code + ':' + a.rev).join(','), profiles };
}
const fpCore = (f) => { const o = Object.assign({}, f); delete o.rates_ver; delete o.calc_ver; delete o.pay_date; return JSON.stringify(o, Object.keys(o).sort()) + JSON.stringify(o.profiles || {}, Object.keys(o.profiles || {}).sort()); };
function totalsOf(db, ym) { const it = db.items[ym] || []; return { count: it.length, gross: it.reduce((a, x) => a + x.gross, 0), deduct: it.reduce((a, x) => a + x.deduct, 0), net: it.reduce((a, x) => a + x.net, 0) }; }
function bankFp(db, ym) { const o = {}; (db.items[ym] || []).forEach((x) => { o[x.staff_id] = db.bank[x.staff_id] ? db.bank[x.staff_id].rev : null; }); return o; }
const summaryOf = (accounts) => accounts.map((e) => ({ bank_code: e.bank_code, bank_name: e.bank_name == null ? null : e.bank_name, last4: e.number.slice(-4), amount_or_rest: e.amount_or_rest }));
function bootstrap(db, ym) {
  const per = periodOf(ym), r = db.runs[ym];
  const sids = [...new Set(db.profiles.map((p) => p.staff_id))].sort();
  return {
    ok: true, ym, period: per,
    settings: db.settings ? { config: db.settings.config, rev: db.settings.rev } : { config: {}, rev: 0 },
    allowances: db.allowances.slice().sort((a, b) => (a.def.order || 0) - (b.def.order || 0) || (a.code < b.code ? -1 : 1)).map((a) => ({ code: a.code, def: a.def, rev: a.rev })),
    staff: db.staff.slice().sort((a, b) => (a.staff_id < b.staff_id ? -1 : 1)),
    profiles: sids.map((sid) => { const cur = profileAt(db, sid, per.from); if (!cur) return null;
      return { staff_id: sid, name: nameOf(db, sid), effective_from: cur.effective_from, rev: cur.rev, data: cur.data,
        versions: db.profiles.filter((q) => q.staff_id === sid).sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1)).map((q) => ({ effective_from: q.effective_from, rev: q.rev, updated_by: q.updated_by || null, updated_at: q.updated_at || null, reason: q.reason || null })),
        bank_last4: db.bank[sid] ? summaryOf(db.bank[sid].accounts) : [] }; }).filter(Boolean),
    kintai: { locked: !!db.kintai.locked_at, locked_at: db.kintai.locked_at, period: per,
      summary_by_staff: db.kintai.locked_at ? kintaiOf(db, ym).snapshot : null },
    run: r ? { status: r.status, rev: r.rev, fingerprint: r.fingerprint, totals: r.totals, stale: r.stale || (r.status === 'draft' && fpCore(r.fingerprint) !== fpCore(fp(db, ym))),
      pay_date: r.pay_date || null, saved_at: r.saved_at, saved_by: r.saved_by, confirmed_at: r.confirmed_at, confirmed_by: r.confirmed_by, exported_at: r.exported_at, history: r.history } : null,
    /* 確定の写し（統合 0102 の a54323a・8aa528f）: 確定した明細だけ frozen { period, pay_date, settings: { config }, bank_last4 }・下書きは null */
    items: (db.items[ym] || []).map((i) => ({ staff_id: i.staff_id, name: i.frozen.name, item: i.item, adjustments: i.adjustments, gross: i.gross, deduct: i.deduct, net: i.net,
      frozen: i.frozen.confirmed ? { period: i.frozen.confirmed.period, pay_date: i.frozen.confirmed.pay_date, settings: { config: (i.frozen.settings && i.frozen.settings.config) || {} }, bank_last4: i.frozen.confirmed.bank_last4 } : null })),
    prev_items: db.prev[ymAdd(ym, -1)] || (db.items[ymAdd(ym, -1)] || []).map((i) => ({ staff_id: i.staff_id, gross: i.gross, net: i.net })),
    fingerprint: fp(db, ym),
  };
}
const isPeriodStart = (d) => dateOk(d) && d.slice(8) === '16';
const ymOk = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/* 施設情報は公開リポジトリに無いので見本を返す */
const SAMPLE_PROFILE = new globalThis.URL('../../facility-profile.sample.json', import.meta.url);
const PROFILE_ROUTE = { match: '**/facility-profile.json', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(SAMPLE_PROFILE, 'utf8') }) };

export function routesFor(opt = {}) {
  const role = opt.role || 'admin', aal = opt.aal || 'aal2';
  const me = role === 'office' ? 'check-office@example.invalid' : 'check-admin@example.invalid';
  const db = seed(opt);
  /* 給与の設定があって退職済みの職員（opt.retiredStaff・賞与の空の止めの試験だけ・在籍でない＝active false・退職日は支給日より前） */
  if (opt.retiredStaff) {
    db.staff.push({ staff_id: 's-12', name: '見本 十二', office: 'facility', emp_code: null, active: false });
    db.profiles.push({ staff_id: 's-12', effective_from: '2025-04-16', rev: 1, data: Object.assign({}, db.profiles[0].data, { birth_date: '1982-02-02', retire_date: '2026-09-30', allowances: [], commute: { monthly: 0 } }) });
  }
  const calls = [];
  /* 監査の時刻は、画面の時計（試験が固定した日）にそろえる（opt.now）。本当の今の時刻だと、画面の「直近30日」の範囲から外れて記録が出ない（2026-11-21） */
  const t0 = Date.now();
  const nowIso = () => (opt.now ? new Date(new Date(opt.now).getTime() + (Date.now() - t0)) : new Date()).toISOString();
  const audit = (action, ym, staff_id, reason) => db.audit.push({ id: db.audit.length + 1, at: nowIso(), by: me, action, ym: ym || null, staff_id: staff_id || null, before: null, after: null, reason: reason || null });
  function rpc(name, p) {
    const ok = (o) => Object.assign({ ok: true }, o || {}), ng = (error, o) => Object.assign({ ok: false, error }, o || {});
    if (name === 'payroll_bootstrap') return ymOk(p.p_ym) ? bootstrap(db, p.p_ym) : ng('badym');
    if (name === 'payroll_run_save') {
      const ym = p.p_ym; if (!ymOk(ym)) return ng('badym');
      const items = p.p_items, f = p.p_fingerprint;
      if (!Array.isArray(items) || items.length < 1 || items.length > 500 || !isObj(f) || !txtOk(f.rates_ver, 40, 1) || !txtOk(f.calc_ver, 40, 1) || ('pay_date' in f && !dateOk(f.pay_date))) return ng('badshape');
      for (const x of items) { const e = itemErr(x); if (e) return ng(e, { staff_id: x && x.staff_id }); }
      if (new Set(items.map((x) => x.staff_id)).size !== items.length) return ng('badshape', { detail: 'dup' });
      if (!db.kintai.locked_at) return ng('notlocked');
      const cur = db.runs[ym];
      if (cur && cur.status !== 'draft') return ng('confirmed');
      if ((p.p_rev || 0) !== (cur ? cur.rev : 0)) return ng('conflict', { rev: cur ? cur.rev : 0 });
      if (fpCore(f) !== fpCore(fp(db, ym))) return ng('stale', { fingerprint: fp(db, ym) });
      for (const x of items) if (!profileAt(db, x.staff_id, periodOf(ym).from)) return ng('noprofile', { staff_id: x.staff_id });
      db.runs[ym] = Object.assign({}, cur || { status: 'draft', history: [], confirmed_at: null, confirmed_by: null, exported_at: null, bank_fp: {} },
        { fingerprint: f, stale: false, rev: (cur ? cur.rev : 0) + 1, pay_date: f.pay_date || null, saved_at: new Date().toISOString(), saved_by: me });
      db.items[ym] = items.map((x) => frozenRow(db, ym, x));
      db.runs[ym].totals = totalsOf(db, ym);
      audit('run_save', ym);
      return ok({ rev: db.runs[ym].rev, totals: db.runs[ym].totals });
    }
    if (name === 'payroll_run_confirm') {
      const ym = p.p_ym, cur = db.runs[ym]; if (!ymOk(ym)) return ng('badym');
      if (!cur) return ng('norun');
      if (cur.status !== 'draft') return ng('confirmed');
      if (p.p_rev !== cur.rev) return ng('conflict', { rev: cur.rev });
      if (!db.kintai.locked_at) return ng('notlocked');
      if (fpCore(cur.fingerprint) !== fpCore(fp(db, ym))) { cur.stale = true; audit('run_stale', ym); return ng('stale'); }
      for (const i of db.items[ym] || []) if (itemErr({ staff_id: i.staff_id, item: i.item, adjustments: i.adjustments })) return ng('badsum', { staff_id: i.staff_id });
      /* 統合 0118: 確定できない警告（4つ）の明細があれば断る */
      const BW = ['rate_missing', 'emp_rate_missing', 'tax_table_missing', 'std_missing'];
      const blk = (db.items[ym] || []).filter((i) => (Array.isArray(i.item.warnings) ? i.item.warnings : []).some((w) => w && BW.includes(w.code))).map((i) => i.staff_id).sort()[0];
      if (blk) return ng('blockwarn', { staff_id: blk });
      const t = totalsOf(db, ym);
      if (!t.count) return ng('empty');
      if (JSON.stringify(t) !== JSON.stringify(cur.totals)) return ng('badsum');
      (db.items[ym] || []).forEach((x) => freezeConfirmed(db, ym, x, cur.pay_date));
      Object.assign(cur, { status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: me, rev: cur.rev + 1, totals: t, stale: false, bank_fp: bankFp(db, ym) });
      audit('run_confirm', ym);
      return ok({ rev: cur.rev, totals: t });
    }
    if (name === 'payroll_run_unconfirm') {
      const ym = p.p_ym, cur = db.runs[ym], reason = String(p.p_reason || '').trim();
      if (!ymOk(ym)) return ng('badym');
      if (!reason || reason.length > 200) return ng('reason');
      if (!cur || cur.status === 'draft') return ng('notconfirmed');
      const was = cur.status; Object.assign(cur, { status: 'draft', rev: cur.rev + 1 });
      audit('run_unconfirm', ym, null, reason);
      return ok({ rev: cur.rev, was, warning: was === 'exported' ? 'exported' : null });
    }
    if (name === 'payroll_profile_put') {
      const sid = p.p_staff_id, from = p.p_effective_from, d = p.p_data, reason = String(p.p_reason || '').trim();
      if (!(typeof sid === 'string' && SID.test(sid) && (sid.startsWith('p:') || db.staff.some((s) => s.staff_id === sid)))) return ng('nostaff');
      if (!isPeriodStart(from)) return ng('badfrom');
      if (!isObj(d) || !Object.keys(d).length) return ng('empty');
      if (!profileOk(d, sid)) return ng('badshape');
      const cur = db.profiles.find((x) => x.staff_id === sid && x.effective_from === from);
      if (cur) { if (p.p_rev !== cur.rev) return ng('conflict', { rev: cur.rev }); if (!reason || reason.length > 200) return ng('reason'); Object.assign(cur, { data: d, rev: cur.rev + 1, reason, updated_by: me, updated_at: new Date().toISOString() }); audit('profile_put', null, sid, reason); return ok({ rev: cur.rev }); }
      if ((p.p_rev || 0) !== 0) return ng('conflict', { rev: 0 });
      db.profiles.push({ staff_id: sid, effective_from: from, data: d, rev: 1, reason: reason || null, updated_by: me, updated_at: new Date().toISOString() }); audit('profile_put', null, sid, reason || null);
      return ok({ rev: 1 });
    }
    if (name === 'payroll_bank_put') {
      const sid = p.p_staff_id, reason = String(p.p_reason || '').trim();
      if (!(typeof sid === 'string' && SID.test(sid) && (sid.startsWith('p:') || db.staff.some((s) => s.staff_id === sid)))) return ng('nostaff');
      if (p.p_accounts == null) return ng('empty');
      const gone = Array.isArray(p.p_accounts) && !p.p_accounts.length;
      if (!gone && !bankOk(p.p_accounts)) return ng('badshape');
      if (!reason || reason.length > 200) return ng('reason');
      const markStale = () => Object.values(db.runs).forEach((r) => { if (r.status === 'confirmed' && sid in (r.bank_fp || {}) && r.bank_fp[sid] !== (db.bank[sid] ? db.bank[sid].rev : null)) r.stale = true; });
      if (gone) { if (!db.bank[sid]) return ng('nobank'); delete db.bank[sid]; markStale(); audit('bank_remove', null, sid, reason); return ok({ accounts: [] }); }
      db.bank[sid] = { rev: db.bank[sid] ? db.bank[sid].rev + 1 : 1, accounts: p.p_accounts }; markStale(); audit('bank_put', null, sid, reason);
      return ok({ accounts: summaryOf(p.p_accounts) });
    }
    if (name === 'payroll_bank_export') {
      const ym = p.p_ym, cur = db.runs[ym]; if (!ymOk(ym)) return ng('badym');
      if (!cur || cur.status === 'draft') return ng('notconfirmed');
      if (!db.settings || db.settings.config.zengin_enabled !== true) return ng('zengin_off');   /* B の担当が足している印（全銀の書き出しを使う） */
      /* 統合 0118: 前に書き出した月（exported_at がある・取り消して確定し直した月も）は、直前の確かめの記録（zengin_again・この後まだ書き出していない）がある時だけ（偽の DB は同じ人・10分を見ない） */
      if (cur.exported_at) {
        const li = db.audit.map((x) => x.action).lastIndexOf('export_zengin_again'), lb = db.audit.map((x) => x.action).lastIndexOf('bank_export');
        if (!(li >= 0 && li > lb)) { audit('bank_export_again_ng', ym); return ng('exported', { exported_at: cur.exported_at }); }
      }
      const its = db.items[ym] || [], diff = its.filter((i) => (cur.bank_fp[i.staff_id] === undefined ? null : cur.bank_fp[i.staff_id]) !== (db.bank[i.staff_id] ? db.bank[i.staff_id].rev : null)).length;
      if (diff) { audit('bank_export_stale', ym); return ng('stale', { changed: diff }); }
      const rows = its.filter((i) => i.net > 0 && db.bank[i.staff_id]).map((i) => ({ staff_id: i.staff_id, name: i.frozen.name, net: i.net, accounts: db.bank[i.staff_id].accounts }));
      const missing = its.filter((i) => i.net > 0 && !db.bank[i.staff_id]).map((i) => i.staff_id);
      if (cur.status === 'confirmed') Object.assign(cur, { status: 'exported', exported_at: new Date().toISOString(), rev: cur.rev + 1 });
      audit('bank_export', ym);
      return ok({ ym, rows, missing });
    }
    if (name === 'payroll_settings_put') {
      const c = p.p_config;
      if (!isObj(c) || !Object.keys(c).length) return ng('empty');
      if (!settingsOk(c)) return ng('badshape');
      if (p.p_rev !== (db.settings ? db.settings.rev : 0)) return ng('conflict', { rev: db.settings ? db.settings.rev : 0 });
      db.settings = { config: c, rev: (db.settings ? db.settings.rev : 0) + 1 }; audit('settings_put');
      return ok({ rev: db.settings.rev });
    }
    if (name === 'payroll_allowance_put') {
      const d = p.p_def; if (!allowanceOk(d)) return ng('badshape');
      const cur = db.allowances.find((a) => a.code === d.code);
      if (p.p_rev !== (cur ? cur.rev : 0)) return ng('conflict', { rev: cur ? cur.rev : 0 });
      if (cur) { cur.def = d; cur.rev++; } else db.allowances.push({ code: d.code, def: d, rev: 1 });
      audit('allowance_put');
      return ok({ rev: cur ? cur.rev : 1 });
    }
    if (name === 'payroll_members_get') return ok({ members: db.members.map((m) => Object.assign({}, m, { role: db.offices.includes(m.email) ? 'office' : null, active: db.offices.includes(m.email) })) });
    if (name === 'payroll_members_put') {
      const em = String(p.p_email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || typeof p.p_on !== 'boolean') return ng('badshape');
      if (p.p_on) { if (!db.offices.includes(em)) return ng('notoffice'); if (!db.members.some((m) => m.email === em)) db.members.push({ email: em, added_by: me, added_at: new Date().toISOString() }); }
      else db.members = db.members.filter((m) => m.email !== em);
      audit(p.p_on ? 'member_add' : 'member_remove');
      return ok();
    }
    if (name === 'payroll_export_log') {
      const ym = p.p_ym; if (!ymOk(ym)) return ng('badym');
      if (!['zengin', 'zengin_again', 'journal', 'ledger', 'payslip', 'csv'].includes(p.p_kind)) return ng('badshape');
      const cur = db.runs[ym]; if (!cur && p.p_kind !== 'payslip') return ng('norun');   /* 明細の印刷は月が無くても記録する */
      if (p.p_kind === 'zengin' && cur.status === 'draft') return ng('notconfirmed');
      if (p.p_kind === 'zengin_again' && (cur.status === 'draft' || !cur.exported_at)) return ng('notexported');   /* 統合 0118 */
      db.log.push(p.p_kind); audit('export_' + p.p_kind, ym);
      return ok();
    }
    if (name === 'payroll_audit_get') {
      const a = Date.parse(p.p_from), b = Date.parse(p.p_to);
      if (!(a <= b) || b - a > 400 * 86400000) return ng('badrange');
      return ok({ rows: db.audit.filter((x) => Date.parse(x.at) >= a && Date.parse(x.at) < b).slice().reverse() });
    }
    /* 年末調整（統合 0122 の形の確かめを写した・架空の材料だけ） */
    if (name.startsWith('payroll_ytd_') || name.startsWith('payroll_yearend_')) {
      /* 賞与の場面（opt.ytd）の年末調整の記録も同じ累計として持つ（賞与の側は ytd_get の rows を読むだけ・2026-11-23 main の取り込みでそろえた） */
      db.ytd = db.ytd || (opt.ytd || []).map((r) => Object.assign({ source: 'freee', rev: 1, src_fp: '' }, r, { year: +String(r.pay_date).slice(0, 4) }));
      db.yearend = db.yearend || [];
      const Y = p.p_year;
      if (!Number.isInteger(Y)) return ng('badshape');
      const YK = ['gross', 'taxable', 'nontax', 'si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'si_other', 'income_tax', 'resident_tax'];
      const MYNUM = /my_?number|kojin_bango|個人番号|マイナンバー/i;
      const deepKeys = (v) => (isObj(v) ? Object.keys(v).concat(...Object.values(v).map(deepKeys)) : Array.isArray(v) ? [].concat(...v.map(deepKeys)) : []);
      const yeOf = (sid) => db.yearend.find((x) => x.year === Y && x.staff_id === sid);
      /* 累計の1行の指紋（DB が作る fp の作り物。中身・版・出どころが変われば変わる） */
      const fpOf = (x) => { const t = JSON.stringify([x.staff_id, x.pay_date, x.kind, x.source, x.rev, Object.keys(x.data || {}).sort().map((k) => k + ':' + x.data[k])]); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };
      const ytdKey = (list) => list.map((x) => x.pay_date + '|' + x.kind + '|' + x.rev + '|' + x.fp).sort().join();
      const nowYtd = (sid) => db.ytd.filter((x) => x.year === Y && x.staff_id === sid).map((x) => Object.assign({}, x, { fp: fpOf(x) }));
      /* 0122 の private.payroll_item_vals の写し: 保存した明細の gross・item.taxable・item.si_total・所得税の行の和（無ければ null） */
      const itemVals = (ym, sid) => {
        const it = (db.items[ym] || []).find((i) => i.staff_id === sid); if (!it || !db.runs[ym]) return null;
        const item = it.item || {};
        return { gross: it.gross, taxable: Number.isInteger(item.taxable) ? item.taxable : null, si: Number.isInteger(item.si_total) ? item.si_total : null,
          tax: (item.lines || []).filter((l) => l && l.sec === 'deduct' && l.code === 'income_tax' && Number.isInteger(l.amount)).reduce((t, l) => t + l.amount, 0) };
      };
      const itemsStale = (basis, sid) => (Array.isArray(basis && basis.items) ? basis.items : []).some((b) => {
        const v = itemVals(b.ym, sid);
        return !v || v.taxable === null || v.si === null || ![b.gross, b.taxable, b.si, b.tax].every(Number.isInteger) || v.gross !== b.gross || v.taxable !== b.taxable || v.si !== b.si || v.tax !== b.tax;
      });
      if (name === 'payroll_ytd_get') return ok({ rows: db.ytd.filter((x) => x.year === Y).map((x) => Object.assign({}, x, { fp: fpOf(x) })), yearend: db.yearend.filter((x) => x.year === Y).map((x) => Object.assign({}, x)) });
      if (name === 'payroll_ytd_put') {
        const R = p.p_rows;
        if (!Array.isArray(R) || !R.length || R.length > 500) return ng('badshape');
        for (const r of R) {
          if (!isObj(r) || Object.keys(r).some((k) => !['staff_id', 'pay_date', 'kind', 'source', 'data', 'src_fp', 'rev'].includes(k)) || !dateOk(r.pay_date) || !['salary', 'bonus'].includes(r.kind) || !['freee', 'app', 'manual'].includes(r.source)
            || !isObj(r.data) || Object.keys(r.data).some((k) => !YK.includes(k) || !Number.isInteger(r.data[k]) || r.data[k] < 0)) return ng('badshape', { staff_id: r && r.staff_id });
          if (!db.staff.some((s) => s.staff_id === r.staff_id)) return ng('nostaff', { staff_id: r.staff_id });
          if (+r.pay_date.slice(0, 4) !== Y) return ng('badyear', { staff_id: r.staff_id });
          const y = yeOf(r.staff_id); if (y && y.status === 'final') return ng('final', { staff_id: r.staff_id });
          const cur = db.ytd.find((x) => x.year === Y && x.staff_id === r.staff_id && x.pay_date === r.pay_date && x.kind === r.kind);
          if ((cur ? cur.rev : 0) !== r.rev) return ng('conflict', { staff_id: r.staff_id });
          /* 0124 の private.payroll_ytd_bonus_err の写し: 確定・書き出し済みの賞与の回で支給日が同じ回の明細を合算して照らす */
          if (r.source === 'app' && r.kind === 'bonus') {
            const BBx = db.bonus || { runs: {}, items: {} };
            const its = [].concat(...Object.values(BBx.runs).filter((b) => ['confirmed', 'exported'].includes(b.status) && b.pay_date === r.pay_date)
              .map((b) => (BBx.items[b.bonus_id] || []).filter((i) => i.staff_id === r.staff_id)));
            const sum = (f) => its.reduce((a, i) => a + f(i), 0), d = r.data, v = (k) => d[k] || 0;
            const g = sum((i) => i.gross), tx = sum((i) => (Number.isInteger(i.item && i.item.taxable) && i.item.taxable >= 0 ? i.item.taxable : i.gross));
            if (!its.length || g !== v('gross') || tx !== v('taxable') || g - tx !== v('nontax') || sum((i) => i.social) !== v('si_health') + v('si_care') + v('si_support') + v('si_pension') + v('si_emp') + v('si_other')
              || sum((i) => i.tax) !== v('income_tax') || v('resident_tax') !== 0) return ng('mismatch', { staff_id: r.staff_id, pay_date: r.pay_date });
          }
        }
        let added = 0, replaced = 0;
        R.forEach((r) => {
          const cur = db.ytd.find((x) => x.year === Y && x.staff_id === r.staff_id && x.pay_date === r.pay_date && x.kind === r.kind);
          if (cur) { Object.assign(cur, r, { year: Y, rev: cur.rev + 1 }); replaced++; } else { db.ytd.push(Object.assign({}, r, { year: Y, rev: 1 })); added++; }
        });
        /* 本物（0122）と同じ答えの形 {added, replaced}。count は前の試験のために残す */
        audit('ytd_put'); return ok({ count: R.length, added, replaced });
      }
      if (name === 'payroll_yearend_put') {
        if (!isObj(p.p_decl) || !isObj(p.p_result) || !isObj(p.p_basis) || deepKeys(p.p_decl).some((k) => MYNUM.test(k)) || !ymOk(p.p_settle_ym)) return ng('badshape', { staff_id: p.p_staff_id });
        if (!db.staff.some((s) => s.staff_id === p.p_staff_id)) return ng('nostaff');
        const y = yeOf(p.p_staff_id);
        if (y && y.status === 'final') return ng('final');
        if ((y ? y.rev : 0) !== p.p_rev) return ng('conflict');
        const row = { year: Y, staff_id: p.p_staff_id, decl: p.p_decl, result: p.p_result, basis: p.p_basis, status: 'draft', settle_ym: p.p_settle_ym, rev: (y ? y.rev : 0) + 1, finalized_at: null };
        if (y) Object.assign(y, row); else db.yearend.push(row);
        audit('yearend_put'); return ok({ rev: row.rev });
      }
      /* 0122 の payroll_yearend_finalize と同じ判定の順: notfound → final → conflict → notcalculated → 累計の (pay_date, kind, rev) → basis.items の明細の値4つ */
      if (name === 'payroll_yearend_finalize') {
        const y = yeOf(p.p_staff_id); if (!y) return ng('notfound');
        if (y.status === 'final') return ng('final');
        if (y.rev !== p.p_rev) return ng('conflict', { rev: y.rev });
        if (!isObj(y.result) || !isObj(y.basis) || !Array.isArray(y.basis.ytd) || !Array.isArray(y.basis.items)) return ng('notcalculated');
        if (y.basis.ytd.some((b) => !isObj(b) || typeof b.fp !== 'string' || !b.fp)) return ng('notcalculated');   /* fp は必須 */
        if (ytdKey(nowYtd(p.p_staff_id)) !== ytdKey(y.basis.ytd)) return ng('stale', { detail: 'ytd' });
        const bad = y.basis.items.find((b) => itemsStale({ items: [b] }, p.p_staff_id));
        if (bad) return ng('stale', { detail: 'items', ym: bad.ym });
        y.status = 'final'; y.rev++; y.finalized_at = nowIso(); audit('yearend_finalize'); return ok({ rev: y.rev });
      }
      if (name === 'payroll_yearend_unfinalize') {
        if (role !== 'admin') return ng('denied');
        if (!String(p.p_reason || '').trim()) return ng('reason');
        const y = yeOf(p.p_staff_id); if (!y || y.status !== 'final') return ng('notfinal');
        y.status = 'draft'; y.finalized_at = null; y.rev++; audit('yearend_unfinalize', null, p.p_staff_id, p.p_reason); return ok();
      }
      /* 0122 の payroll_yearend_check と同じ形と判定の順（noyearend → notfinal → stale → nobalance → norun → noitem → diff → ok）。
         精算の額は保存した明細の調整のうち kind='tax_adjust' かつ name='年末調整の精算' の行の和（反証レビュー 2026-11-23 で DB も同じ形に直す）。
         stale は確定の basis.items の月分ごとに、今の明細の値4つ（finalize と同じ取り方）が違う・明細が無い時 */
      if (name === 'payroll_yearend_check') {
        const settleAdj = (it) => (it ? (it.adjustments || []).filter((a) => a && a.kind === 'tax_adjust' && a.name === '年末調整の精算' && Number.isInteger(a.amount)).reduce((t, a) => t + a.amount, 0) : 0);
        const ye = db.yearend.filter((x) => x.year === Y);
        const months = new Set(ye.map((x) => x.settle_ym).concat([Y + '-12']));
        /* stale は basis.ytd（pay_date・kind・rev・fp）が今の累計と違う時と、basis.items の明細の値が違う時 */
        const people = ye.map((x) => ({ staff_id: x.staff_id, status: x.status, settle_ym: x.settle_ym, balance: Number.isInteger(x.result && x.result.balance_settle) ? x.result.balance_settle : null,
          stale: itemsStale(x.basis, x.staff_id) || ytdKey(nowYtd(x.staff_id)) !== ytdKey(Array.isArray(x.basis && x.basis.ytd) ? x.basis.ytd : []) }));
        months.forEach((ym) => (db.items[ym] || []).forEach((i) => {
          if (!ye.some((x) => x.staff_id === i.staff_id) && settleAdj(i) !== 0) people.push({ staff_id: i.staff_id, status: null, settle_ym: ym, balance: null, stale: false });
        }));
        const rows = people.map((z) => {
          const run = db.runs[z.settle_ym], it = (db.items[z.settle_ym] || []).find((i) => i.staff_id === z.staff_id), adj = settleAdj(it);
          const state = z.status === null ? 'noyearend' : z.status !== 'final' ? 'notfinal' : z.stale ? 'stale' : z.balance === null ? 'nobalance' : !run ? 'norun' : !it ? 'noitem' : adj !== z.balance ? 'diff' : 'ok';
          return { staff_id: z.staff_id, status: z.status, settle_ym: z.settle_ym, run_status: run ? run.status : null, run_rev: run ? run.rev : null, has_item: !!it, tax_adjust: adj, balance_settle: z.balance, state };
        }).sort((a, b) => (a.staff_id < b.staff_id ? -1 : 1));
        return ok({ year: Y, rows, n_ok: rows.filter((r) => r.state === 'ok').length, n_ng: rows.filter((r) => r.state !== 'ok').length });
      }
      /* 源泉徴収票の印刷・合計表の CSV の記録（反証レビュー 2026-11-23 で足す口・金額は持たない） */
      if (name === 'payroll_yearend_log') {
        if (!['withholding_slip', 'yearend_csv'].includes(p.p_kind) || !Number.isInteger(p.p_count) || p.p_count < 1 || p.p_count > 1000) return ng('badshape');
        db.log.push('yearend:' + p.p_kind); audit('yearend_' + p.p_kind); return ok();
      }
      /* 累計の取り込み違いを消す（理由必須・確定済みの人は断る・版の照合） */
      if (name === 'payroll_ytd_delete') {
        if (!String(p.p_reason || '').trim()) return ng('reason');
        const y = yeOf(p.p_staff_id); if (y && y.status === 'final') return ng('final');
        const i = db.ytd.findIndex((x) => x.year === Y && x.staff_id === p.p_staff_id && x.pay_date === p.p_pay_date && x.kind === p.p_kind);
        if (i < 0) return ng('notfound');
        if (db.ytd[i].rev !== p.p_rev) return ng('conflict', { rev: db.ytd[i].rev });
        db.ytd.splice(i, 1); audit('ytd_delete', null, p.p_staff_id, p.p_reason); return ok();
      }
      return null;
    }
    if (name === 'payroll_import_put') {
      const pl = p.p_payload;
      if (!isObj(pl) || !Object.keys(pl).length || Object.keys(pl).some((k) => !['allowances', 'profiles', 'banks'].includes(k))) return ng('badshape');
      const A = pl.allowances || [], P = pl.profiles || [], B = pl.banks || [];
      if (![A, P, B].every(Array.isArray)) return ng('badshape');
      for (let i = 0; i < A.length; i++) if (!allowanceOk(A[i])) return ng('badshape', { part: 'allowances', index: i });
      for (let i = 0; i < P.length; i++) {
        const e = P[i];
        if (!isObj(e) || Object.keys(e).some((k) => !['staff_id', 'effective_from', 'data'].includes(k)) || !(SID.test(e.staff_id || '') && (String(e.staff_id).startsWith('p:') || db.staff.some((s) => s.staff_id === e.staff_id)))
          || !dateOk(e.effective_from) || !isObj(e.data) || !Object.keys(e.data).length || !profileOk(e.data, e.staff_id)) return ng('badshape', { part: 'profiles', index: i });
        if (!isPeriodStart(e.effective_from)) return ng('badfrom', { part: 'profiles', index: i });
      }
      for (let i = 0; i < B.length; i++) { const e = B[i]; if (!isObj(e) || Object.keys(e).some((k) => !['staff_id', 'accounts'].includes(k)) || !SID.test(e.staff_id || '') || !bankOk(e.accounts)) return ng('badshape', { part: 'banks', index: i }); }
      const res = { allowances: { added: 0, skipped: 0 }, profiles: { added: 0, skipped: 0 }, banks: { added: 0, skipped: 0 } };
      A.forEach((d) => { if (db.allowances.some((a) => a.code === d.code)) res.allowances.skipped++; else { db.allowances.push({ code: d.code, def: d, rev: 1 }); res.allowances.added++; } });
      P.forEach((e) => { if (db.profiles.some((x) => x.staff_id === e.staff_id && x.effective_from === e.effective_from)) res.profiles.skipped++; else { db.profiles.push({ staff_id: e.staff_id, effective_from: e.effective_from, data: e.data, rev: 1 }); res.profiles.added++; } });
      B.forEach((e) => { if (db.bank[e.staff_id]) res.banks.skipped++; else { db.bank[e.staff_id] = { rev: 1, accounts: e.accounts }; res.banks.added++; } });
      audit('import');
      return ok(Object.assign(res, { added: res.allowances.added + res.profiles.added + res.banks.added, unchanged: res.allowances.skipped + res.profiles.skipped + res.banks.skipped }));
    }
    /* ── 賞与（統合 0121 の写し・opt.bonus の時だけ）── */
    if (name.startsWith('payroll_bonus_')) return bonusRpc(name, p, ok, ng);
    if (name === 'payroll_ytd_get') {
      /* 年末調整の記録（統合 0122 の設計 ROOT-yearend.md の形・opt.ytd の行をその年の分だけ返す） */
      if (!Number.isInteger(p.p_year)) return ng('badshape');
      return ok({ rows: (opt.ytd || []).filter((r) => +r.pay_date.slice(0, 4) === p.p_year), yearend: [] });
    }
    return null;
  }
  const BB = db.bonus = { runs: {}, items: {} };
  const bAudit = (action, id) => audit(action, id, null, null);
  const fyFrom = (d) => (+d.slice(5, 7) >= 4 ? d.slice(0, 4) : String(+d.slice(0, 4) - 1)) + '-04-01';
  const monthPay = (ym) => (db.runs[ym] && db.runs[ym].pay_date) || PC.payDate(ym, db.settings.config);
  function bPrev(pay) {
    const f = ymAdd(pay.slice(0, 7), -1) + '-01', t = KC.addDays(pay.slice(0, 7) + '-01', -1);
    const cands = [ymAdd(f.slice(0, 7), -1), f.slice(0, 7), pay.slice(0, 7)].filter((ym) => db.runs[ym]).map((ym) => ({ ym, r: db.runs[ym], pd: monthPay(ym) }))
      .filter((x) => x.pd >= f && x.pd <= t).sort((a, b) => (a.pd < b.pd ? 1 : -1));
    const x = cands[0];
    if (!x) return { state: 'none', from: f, to: t, items: {} };
    if (x.r.status === 'draft') return { state: 'draft', from: f, to: t, ym: x.ym, pay_date: x.pd, status: x.r.status, rev: x.r.rev, items: {} };
    const items = {};
    (db.items[x.ym] || []).forEach((i) => {
      const it = i.item, P = typeof it.tax_base === 'number' ? it.tax_base : (typeof it.taxable === 'number' && typeof it.si_total === 'number' ? it.taxable - it.si_total : null);
      items[i.staff_id] = { gross: i.gross, taxable: typeof it.taxable === 'number' ? it.taxable : null, social: typeof it.si_total === 'number' ? it.si_total : null, emp: null, P };
    });
    return { state: 'ok', from: f, to: t, ym: x.ym, pay_date: x.pd, status: x.r.status, rev: x.r.rev, items };
  }
  const before = (r, id, pay) => r.bonus_id !== id && (r.pay_date < pay || (r.pay_date === pay && r.bonus_id < id));
  function bCtx(id, pay) {
    const o = { fy_from: fyFrom(pay), fy_std: {}, month_std: {}, count_12m: {} }, from12 = (+pay.slice(0, 4) - 1) + pay.slice(4);
    Object.values(BB.runs).filter((r) => ['confirmed', 'exported'].includes(r.status) && before(r, id, pay)).forEach((r) => (BB.items[r.bonus_id] || []).forEach((i) => {
      if (r.pay_date >= o.fy_from) o.fy_std[i.staff_id] = (o.fy_std[i.staff_id] || 0) + (i.item.std.health || 0);
      if (r.pay_date.slice(0, 7) === pay.slice(0, 7)) o.month_std[i.staff_id] = (o.month_std[i.staff_id] || 0) + (i.item.std.pension || 0);
      if (r.pay_date > from12 && i.gross > 0) o.count_12m[i.staff_id] = (o.count_12m[i.staff_id] || 0) + 1;
    }));
    return o;
  }
  function bFp(id) {
    const r = BB.runs[id]; if (!r) return null;
    const pv = bPrev(r.pay_date), profiles = {};
    [...new Set(db.profiles.map((q) => q.staff_id))].forEach((sid) => { const q = profileAt(db, sid, r.pay_date); if (q) profiles[sid] = q.effective_from + ':' + q.rev; });
    const others = Object.values(BB.runs).filter((o) => ['confirmed', 'exported'].includes(o.status) && before(o, id, r.pay_date)).map((o) => o.bonus_id + ':' + o.confirmed_at).sort().join(',');
    return 'b1:' + JSON.stringify({ pay_date: r.pay_date, config: r.config, settings_rev: db.settings.rev, allowances: db.allowances.map((a) => a.code + ':' + a.rev).sort().join(','), profiles, prev: { state: pv.state, ym: pv.ym || null, rev: pv.rev || null }, others });
  }
  const bTotals = (id) => { const it = BB.items[id] || []; return { count: it.length, gross: it.reduce((a, x) => a + x.gross, 0), social: it.reduce((a, x) => a + x.social, 0), tax: it.reduce((a, x) => a + x.tax, 0), deduct: it.reduce((a, x) => a + x.deduct, 0), net: it.reduce((a, x) => a + x.net, 0) }; };
  const bStale = (r) => r.stale || (r.status === 'draft' && r.fingerprint != null && r.fingerprint !== bFp(r.bonus_id));
  function bonusRpc(name, p, ok, ng) {
    const id = p.p_bonus_id;
    if (name === 'payroll_bonus_bootstrap') {
      if (id !== null && !BONUS_ID.test(String(id))) return ng('badshape');
      const base = { ok: true, runs: Object.values(BB.runs).sort((a, b) => (a.pay_date < b.pay_date || (a.pay_date === b.pay_date && a.bonus_id < b.bonus_id) ? 1 : -1)).map((r) => ({ bonus_id: r.bonus_id, pay_date: r.pay_date, title: r.title, status: r.status, rev: r.rev, count: (r.totals || {}).count || 0, gross: (r.totals || {}).gross || 0, stale: bStale(r) })),
        settings: { config: db.settings.config, rev: db.settings.rev }, allowances: db.allowances.map((a) => ({ code: a.code, def: a.def, rev: a.rev })),
        staff: db.staff.map((x) => ({ staff_id: x.staff_id, name: x.name, office: x.office, emp_code: x.emp_code, active: x.active })) };
      if (id === null) return Object.assign(base, { run: null, profiles: null, items: [], prev: null, ctx: null, fingerprint: null });
      const r = BB.runs[id]; if (!r) return ng('norun');
      return Object.assign(base, {
        run: { bonus_id: r.bonus_id, pay_date: r.pay_date, title: r.title, status: r.status, rev: r.rev, config: r.config, totals: r.totals, stale: bStale(r), saved_at: r.saved_at, confirmed_at: r.confirmed_at, exported_at: r.exported_at, history: [] },
        profiles: [...new Set(db.profiles.map((q) => q.staff_id))].sort().map((sid) => { const q = profileAt(db, sid, r.pay_date); return q ? { staff_id: sid, name: nameOf(db, sid), effective_from: q.effective_from, rev: q.rev, data: q.data, bank_last4: db.bank[sid] ? summaryOf(db.bank[sid].accounts) : [] } : null; }).filter(Boolean),
        items: (BB.items[id] || []).map((i) => ({ staff_id: i.staff_id, name: i.frozen.name, item: i.item, prev_manual: i.frozen.prev_manual, gross: i.gross, social: i.social, tax: i.tax, deduct: i.deduct, net: i.net,
          frozen: i.frozen.confirmed ? { pay_date: i.frozen.confirmed.pay_date, company_name: i.frozen.confirmed.company_name, settings: { config: {} }, bank_last4: i.frozen.confirmed.bank_last4 } : null })),
        prev: bPrev(r.pay_date), ctx: bCtx(id, r.pay_date), fingerprint: bFp(id) });
    }
    if (name === 'payroll_bonus_create') {
      if (!dateOk(p.p_pay_date)) return ng('baddate');
      const t = String(p.p_title || '').trim(); if (t.length < 1 || t.length > 40 || /[\x00-\x1f\x7f]/.test(t)) return ng('badshape');   /* 0121 と同じく制御文字は断る */
      /* 0121 と同じく、同じ支給日の番号の最大＋1（消した回の番号を詰めない） */
      const n = Object.values(BB.runs).filter((r) => r.pay_date === p.p_pay_date).reduce((m, r) => Math.max(m, +r.bonus_id.slice(11)), 0) + 1; if (n > 9) return ng('full');
      const nid = p.p_pay_date + '#' + n;
      BB.runs[nid] = { bonus_id: nid, pay_date: p.p_pay_date, title: t, status: 'draft', config: {}, fingerprint: null, stale: false, bank_fp: {}, totals: {}, rev: 1, saved_at: null, confirmed_at: null, exported_at: null };
      bAudit('bonus_create', nid); return ok({ bonus_id: nid, rev: 1 });
    }
    if (!BONUS_ID.test(String(id))) return ng('badshape');
    const cur = BB.runs[id];
    if (name === 'payroll_bonus_config_put') {
      if (!bonusConfigOk(p.p_config)) return ng('badshape');
      if (!cur) return ng('norun'); if (cur.status !== 'draft') return ng('confirmed'); if (p.p_rev !== cur.rev) return ng('conflict', { rev: cur.rev });
      cur.config = p.p_config; cur.rev++; bAudit('bonus_config', id); return ok({ rev: cur.rev, fingerprint: bFp(id) });
    }
    if (name === 'payroll_bonus_save') {
      const items = p.p_items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 500 || typeof p.p_fingerprint !== 'string' || p.p_fingerprint.length < 1) return ng('badshape');
      for (const x of items) { const e = bonusItemErr(x); if (e) return ng(e, { staff_id: x && x.staff_id }); }
      if (new Set(items.map((x) => x.staff_id)).size !== items.length) return ng('badshape', { detail: 'dup' });
      if (!cur) return ng('norun'); if (cur.status !== 'draft') return ng('confirmed'); if (p.p_rev !== cur.rev) return ng('conflict', { rev: cur.rev });
      const f = bFp(id); if (p.p_fingerprint !== f) return ng('stale', { fingerprint: f });
      for (const x of items) { if (!db.staff.some((z) => z.staff_id === x.staff_id) && !x.staff_id.startsWith('p:')) return ng('nostaff', { staff_id: x.staff_id }); if (!profileAt(db, x.staff_id, cur.pay_date)) return ng('noprofile', { staff_id: x.staff_id }); }
      const pv = bPrev(cur.pay_date);
      BB.items[id] = items.map((x) => ({ staff_id: x.staff_id, item: x.item, gross: x.item.gross, social: x.item.social, tax: x.item.tax, deduct: x.item.deduct, net: x.item.net,
        frozen: { name: nameOf(db, x.staff_id), prev_manual: isObj(x.prev_manual) ? x.prev_manual : null,
          prev_db: { state: pv.state, kind: pv.state === 'draft' ? 'unconfirmed' : (pv.state === 'ok' && x.staff_id in pv.items ? 'ok' : 'missing'), item: pv.items[x.staff_id] || null } } }));
      cur.fingerprint = p.p_fingerprint; cur.stale = false; cur.rev++; cur.saved_at = nowIso(); cur.totals = bTotals(id);
      bAudit('bonus_save', id); return ok({ rev: cur.rev, totals: cur.totals });
    }
    if (name === 'payroll_bonus_confirm') {
      if (!cur) return ng('norun'); if (cur.status !== 'draft') return ng('confirmed'); if (p.p_rev !== cur.rev) return ng('conflict', { rev: cur.rev });
      if (cur.fingerprint == null) return ng('empty');
      if (cur.fingerprint !== bFp(id)) { cur.stale = true; return ng('stale'); }
      for (const i of BB.items[id] || []) if (bonusItemErr({ staff_id: i.staff_id, item: i.item })) return ng('badsum', { staff_id: i.staff_id });
      for (const i of (BB.items[id] || []).slice().sort((a, b) => (a.staff_id < b.staff_id ? -1 : 1))) {
        const w = i.item.warns.map((x) => x.code).filter((c) => BONUS_STOP.includes(c)).sort()[0];
        const pd = i.frozen.prev_db, dbBlk = pd.kind === 'unconfirmed' ? 'prev_unconfirmed' : ((pd.kind !== 'ok' || !pd.item || typeof pd.item.P !== 'number') && !isObj(i.frozen.prev_manual) ? 'prev_missing' : null);
        const code = [w, dbBlk].filter(Boolean).sort()[0];
        if (code) return ng('blockwarn', { staff_id: i.staff_id, code });
      }
      const tot = bTotals(id); if (!tot.count) return ng('empty');
      const later = Object.values(BB.runs).find((o) => ['confirmed', 'exported'].includes(o.status) && o.bonus_id !== id && before({ bonus_id: id, pay_date: cur.pay_date }, o.bonus_id, o.pay_date) && o.pay_date < (+fyFrom(cur.pay_date).slice(0, 4) + 1) + '-04-01');
      if (later) return ng('order', { bonus_id: later.bonus_id });
      (BB.items[id] || []).forEach((i) => { i.frozen.confirmed = { pay_date: cur.pay_date, company_name: db.settings.config.company_name || null, bank_last4: db.bank[i.staff_id] ? summaryOf(db.bank[i.staff_id].accounts) : [] }; });
      cur.bank_fp = {}; (BB.items[id] || []).forEach((i) => { cur.bank_fp[i.staff_id] = db.bank[i.staff_id] ? db.bank[i.staff_id].rev : null; });
      cur.status = 'confirmed'; cur.confirmed_at = nowIso(); cur.rev++; cur.totals = tot; cur.stale = false;
      bAudit('bonus_confirm', id); return ok({ rev: cur.rev, totals: tot });
    }
    if (name === 'payroll_bonus_unconfirm') {
      const reason = String(p.p_reason || '').trim(); if (!reason) return ng('reason');
      if (!cur || cur.status === 'draft') return ng('notconfirmed');
      const was = cur.status; cur.status = 'draft'; cur.rev++;   /* 0121 と同じく明細の確定の写し（frozen.confirmed）は消さない */
      bAudit('bonus_unconfirm', id); return ok({ rev: cur.rev, was, warning: was === 'exported' ? 'exported' : null });
    }
    if (name === 'payroll_bonus_delete') {
      if (!cur) return ng('norun'); if (cur.status !== 'draft') return ng('confirmed'); if (cur.exported_at) return ng('exported'); if (p.p_rev !== cur.rev) return ng('conflict', { rev: cur.rev });
      delete BB.items[id]; delete BB.runs[id]; bAudit('bonus_delete', id); return ok({});
    }
    if (name === 'payroll_bonus_bank_export') {
      if (!cur || cur.status === 'draft') return ng('notconfirmed');
      if (db.settings.config.zengin_enabled !== true) { bAudit('bonus_bank_export_off', id); return ng('zengin_off'); }
      if (cur.exported_at) {
        const acts = db.audit.filter((x) => x.ym === id).map((x) => x.action), li = acts.lastIndexOf('bonus_export_zengin_again'), lb = acts.lastIndexOf('bonus_bank_export');
        if (!(li >= 0 && li > lb)) { bAudit('bonus_bank_export_again_ng', id); return ng('exported', { exported_at: cur.exported_at }); }
      }
      const its = BB.items[id] || [];
      if (its.some((i) => (cur.bank_fp[i.staff_id] === undefined ? null : cur.bank_fp[i.staff_id]) !== (db.bank[i.staff_id] ? db.bank[i.staff_id].rev : null))) return ng('stale', { changed: 1 });
      const rows = its.filter((i) => i.net > 0 && db.bank[i.staff_id]).map((i) => ({ staff_id: i.staff_id, name: i.frozen.name, net: i.net, accounts: db.bank[i.staff_id].accounts }));
      const missing = its.filter((i) => i.net > 0 && !db.bank[i.staff_id]).map((i) => i.staff_id);
      if (cur.status === 'confirmed') { cur.status = 'exported'; cur.exported_at = nowIso(); cur.rev++; }
      bAudit('bonus_bank_export', id); db.log.push('bonus_zengin'); return ok({ bonus_id: id, pay_date: cur.pay_date, rows, missing });
    }
    if (name === 'payroll_bonus_export_log') {
      if (!['slip', 'ledger', 'zengin', 'zengin_again', 'shoyo_csv'].includes(p.p_kind)) return ng('badshape');
      if (!cur) return ng('norun');
      if (p.p_kind === 'zengin' && cur.status === 'draft') return ng('notconfirmed');
      if (p.p_kind === 'zengin_again' && (cur.status === 'draft' || !cur.exported_at)) return ng('notexported');
      bAudit('bonus_export_' + p.p_kind, id); db.log.push('bonus_' + p.p_kind); return ok({});
    }
    return null;
  }
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
      if (/\/rest\/v1\/rpc\/kintai_month_get/.test(u)) {
        let q = {}; try { q = JSON.parse(req.postData() || '{}'); } catch (e) { q = {}; }
        calls.push({ name: 'kintai_month_get', args: q });
        if (Object.keys(q).join() !== 'p_ym') return json({ code: 'PGRST202', message: 'Could not find the function public.kintai_month_get' }, 404);
        if (aal !== 'aal2' || opt.deny) return json({ code: '42501', message: '事務所・管理者だけが使えます' }, 403);
        if (!ymOk(q.p_ym)) return json({ ok: false, error: 'badym' });
        const k = kintaiOf(db, q.p_ym);
        return json(JSON.parse(JSON.stringify(Object.assign({ ok: true }, k.raw, { month: db.kintai.locked_at ? { ym: q.p_ym, locked_at: db.kintai.locked_at, snapshot: k.snapshot, history: [] } : null, settings: { config: {}, rev: 0 } }))));
      }
      /* 有給の入職順（loadHire）が読む勤怠の職員マスタの一覧。給与の試験では入職日を使わないので空の一覧（2026-11-21） */
      if (/\/rest\/v1\/rpc\/kintai_master_list/.test(u)) { calls.push({ name: 'kintai_master_list', args: {} }); return json({ ok: true, rows: [] }); }
      /* 不具合の報告先（su-report の Edge Function）。届いた報告は calls に残すだけ（2026-11-21） */
      if (/\/functions\/v1\/su-report/.test(u)) { calls.push({ name: 'su-report', args: {} }); return json({ ok: true }); }
      const m = /\/rest\/v1\/rpc\/(payroll_[a-z_]+)/.exec(u);
      if (!m) return json({ code: 'PGRST202', message: 'check fixture: not served' }, 404);
      let p = {};
      try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
      const name = m[1];
      calls.push({ name, args: p });
      /* 引数の名前の組が違えば、PostgREST と同じく関数が見つからない */
      const want = ARGS[name] || (opt.bonus ? BONUS_ARGS[name] : null) || (opt.ytd && name === 'payroll_ytd_get' ? ['p_year'] : null), got = Object.keys(p || {}).sort();
      if (!want || want.slice().sort().join() !== got.join()) return json({ code: 'PGRST202', message: 'Could not find the function public.' + name + '(' + got.join(', ') + ') in the schema cache' }, 404);
      if (opt.deny) return json({ code: '42501', message: '給与を扱える人だけが使えます' }, 403);
      if (aal !== 'aal2') return json({ code: '42501', message: '給与を扱える人だけが使えます' }, 403);
      if (role !== 'admin' && ADMIN_ONLY.includes(name)) return json({ code: '42501', message: '管理者（二段階認証）だけが使えます' }, 403);
      const r = rpc(name, p);
      /* 年末調整の記録の答えを遅らせる場面（opt.ytdDelay ミリ秒・答えが届くまで保存・確定を押せないことを見る） */
      if (opt.ytdDelay && name === 'payroll_ytd_get' && r) return new Promise((res) => setTimeout(res, opt.ytdDelay)).then(() => json(JSON.parse(JSON.stringify(r))));
      if (r === null) return json({ code: 'PGRST202', message: 'check fixture: not served' }, 404);
      return json(JSON.parse(JSON.stringify(r)));
    },
  }, PROFILE_ROUTE];
  out.db = db; out.calls = calls; out.opt = opt; out.rpcDirect = rpc;   /* rpcDirect: 単体試験が偽の DB の答えを直接見る（2026-11-23） */   /* 試験が途中で deny などを変えられるように */
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
