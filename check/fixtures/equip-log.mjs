/* check/fixtures/equip-log.mjs — 設備・修繕の記録を、架空の設備・記録で開くための材料（2026-11-03 新設）
 *
 * snap.mjs の材料の形（URL・match・storage・routes・sheets・respond）。
 *   sheets … 「対応の記録」の「一覧を印刷（A4 横）」で組む点検・修繕の記録の紙（SUPrint の 'evlist'・2026-11-14 代表者の決定）を、架空の記録で撮る
 * 手元の確かめ（ブラウザで開いて押す）では storage を端末に入れ、routes で通信を横取りする:
 *   storage … 事務所PCとして開き、架空の事務所のアカウントでログインしている端末にする
 *   routes  … Supabase への通信を全部横取りし、ログインの確かめ・アプリの使える人・設備・修繕の記録の RPC（eq_*）に架空の応答を返す。
 *             保存（eq_save_*・取り消し・廃棄）は横取りの間だけメモリに覚え、版（rev）が違えば {conflict:true} を返す
 *   準備中  … 環境変数 EQ_FIXTURE_PREP=1 の時、または routesFor({prep:true}) で作った routes は、eq_* に PGRST202（関数が無い）を返す
 *
 * ★架空データだけ（CLAUDE.md §2-1）。業者・設備の名前は実在しない見本の語、電話は 000- で始まる架空の番号。入居者の氏名は持たない。
 * ★鍵・メールアドレスは架空（example.invalid）。本物の Supabase へは出ない（match に当たる要求は全部ここで答える）。
 */
export const URL = 'https://jhbernqawjrzqwrmqrih.supabase.co';
export const match = URL + '/rest/v1/rpc/eq_list';
const SB = URL;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_JWT = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: '00000000-0000-4000-8000-0000000c4eck', email: 'check-office@example.invalid', role: 'authenticated', aal: 'aal1', exp: 4102444800 }) + '.check';
const FAKE_SESSION = JSON.stringify({
  access_token: FAKE_JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
  user: { id: '00000000-0000-4000-8000-0000000c4eck', email: 'check-office@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
});
export const storage = {
  su_device_role: 'office',
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
};
/* 点検・修繕の記録の紙（A4 横）。ページの中で動く。記録を読み終えるのを待ち、押した時と同じ道（evPrint_）で紙を組む（印刷のダイアログは開かない） */
export const sheets = [
  { key: 'evlist', arg: null, ready: '#e-print .ep-t',
    prepare: async () => {
      const wait = async (fn) => { for (let i = 0; i < 150; i++) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
      if (!(await wait(() => typeof evPrint_ === 'function' && window.SUPrint && typeof view !== 'undefined' && view === 'app' && typeof dbState !== 'undefined' && dbState === 'ok'))) return false;
      window.print = function () {};
      evPrint_();
      return !!(await wait(() => document.body.classList.contains('su-printing')));
    } },
];

const T = 'kakuu-tenant';
/* 架空の一覧（eq_list の答え）。見本の間取り（facility-profile.sample.json の 101〜104・201〜204）に合わせる */
export function seed() {
  return {
    ok: true,
    assets: [
      { id: 'a-1', tenant_id: T, kind: 'facility', place_key: 'room:101', place_name: '101', category: 'aircon', name: '見本エアコン', maker: '見本電機', model: 'MH-100', serial: 'S-0001',
        bought_on: '2025-06-01', price: 88000, vendor_id: 'v-1', warranty_until: '2027-05-31', cycle_months: 6, next_due: null, status: 'active', note: '', extra: {}, rev: 1 },
      { id: 'a-2', tenant_id: T, kind: 'facility', place_key: 'room:201', place_name: '201', category: 'furniture', name: '見本ベッド', status: 'active', cycle_months: null, extra: {}, rev: 1 },
      { id: 'a-3', tenant_id: T, kind: 'visit', place_key: 'place:p-1', place_name: '見本の車', category: 'vehicle', name: '見本の軽自動車', status: 'active', cycle_months: 12, bought_on: '2025-01-15', extra: {}, rev: 1 },
    ],
    events: [
      { id: 'e-1', tenant_id: T, asset_id: 'a-1', place_key: 'room:101', etype: 'cleaning', found_on: null, requested_on: '2025-11-20', handled_on: '2025-12-01', done_on: '2025-12-01',
        amount: 5500, vendor_id: 'v-1', staff_name: '', body: '見本のフィルター清掃', next_due: null, cancelled_at: null, extra: {}, rev: 1, created_at: '2025-12-01T10:00:00+09:00' },
      { id: 'e-2', tenant_id: T, asset_id: 'a-3', place_key: 'place:p-1', etype: 'inspection', handled_on: '2025-10-10', amount: 22000, vendor_id: 'v-2', body: '見本の法定点検', next_due: '2026-10-10', cancelled_at: null, extra: {}, rev: 1, created_at: '2025-10-10T10:00:00+09:00' },
      /* 紙（点検・修繕の記録）の材料として足した架空の記録（2026-11-14）。同じ設備の2件目・場所だけの記録・取り消した記録（紙には載せない）・増やした項目の値 */
      { id: 'e-3', tenant_id: T, asset_id: 'a-1', place_key: 'room:101', etype: 'repair', found_on: '2025-08-02', requested_on: '2025-08-03', handled_on: '2025-08-05', done_on: '2025-08-05',
        amount: 16500, vendor_id: 'v-1', body: '見本の修理（冷えない）\n見本の部品を交換した', next_due: null, cancelled_at: null, extra: { 'f-1': 'MT-0001' }, rev: 1, created_at: '2025-08-05T10:00:00+09:00' },
      { id: 'e-4', tenant_id: T, asset_id: 'a-2', place_key: 'room:201', etype: 'repair', found_on: '2025-09-12', handled_on: '2025-09-15', amount: 0, vendor_id: null, body: '見本の手すりのゆるみを締めた', next_due: null, cancelled_at: null, extra: {}, rev: 1, created_at: '2025-09-15T10:00:00+09:00' },
      { id: 'e-5', tenant_id: T, asset_id: null, place_key: 'room:102', etype: 'cleaning', handled_on: '2025-11-05', amount: 3300, vendor_id: 'v-1', body: '見本の換気扇の清掃', next_due: null, cancelled_at: null, extra: {}, rev: 1, created_at: '2025-11-05T10:00:00+09:00' },
      { id: 'e-6', tenant_id: T, asset_id: 'a-1', place_key: 'room:101', etype: 'inspection', handled_on: '2025-07-01', amount: 2200, vendor_id: 'v-1', body: '見本の取り消した点検', next_due: null, cancelled_at: '2025-07-02T10:00:00+09:00', extra: {}, rev: 1, created_at: '2025-07-01T10:00:00+09:00' },
    ],
    vendors: [
      { id: 'v-1', tenant_id: T, name: '見本設備サービス', field: '空調', phone: '000-0000-0001', contact: '見本 担当', note: '', disabled: false, rev: 1 },
      { id: 'v-2', tenant_id: T, name: '見本自動車', field: '車両', phone: '000-0000-0002', contact: '', note: '', disabled: false, rev: 1 },
    ],
    places: [{ id: 'p-1', tenant_id: T, kind: 'visit', name: '見本の車', sort: 10, rev: 1 }],
    fields: [{ id: 'f-1', tenant_id: T, target: 'event', name: '見積番号', ftype: 'text', options: null, sort: 10, disabled: false, rev: 1 }],
    files: [],
  };
}

const LIST = { eq_save_asset: 'assets', eq_save_event: 'events', eq_save_vendor: 'vendors', eq_save_place: 'places', eq_save_field: 'fields' };
/* 施設情報（facility-profile.json）は公開リポジトリに無い。撮影の道具（lib.mjs の startServer）と同じく、無い時は見本を返す。
   手元の簡易サーバーで開いた時に 404（コンソールのエラー）が出ないようにし、図面も見本の間取りで描かれるようにする */
const SAMPLE_PROFILE = new globalThis.URL('../../facility-profile.sample.json', import.meta.url);
const PROFILE_ROUTE = {
  match: '**/facility-profile.json',
  async handle(route) {
    const fs = await import('node:fs');
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(SAMPLE_PROFILE, 'utf8') });
  },
};
/* routes を作る（prep: 真なら eq_* は全部「関数が無い」＝準備中） */
export function routesFor(opt = {}) {
  const prep = !!opt.prep;
  const db = seed();
  let n = 0;
  const now = () => new Date().toISOString();
  function save(list, p) {
    const row = p.p_row || {};
    const arr = db[list];
    const cur = row.id != null ? arr.find((x) => x.id === row.id) : null;
    if (cur && cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    const next = Object.assign({}, cur || { tenant_id: T, created_at: now() }, row, { id: row.id != null ? row.id : list + '-new-' + (++n), rev: (cur ? cur.rev : 0) + 1, updated_at: now() });
    if (cur) arr[arr.indexOf(cur)] = next; else arr.push(next);
    return { ok: true, row: next };
  }
  function state(list, p, patch) {
    const arr = db[list];
    const cur = arr.find((x) => x.id === p.p_id);
    if (!cur) return { ok: false, error: 'notfound' };
    if (cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    const next = Object.assign({}, cur, patch, { rev: cur.rev + 1, updated_at: now() });
    arr[arr.indexOf(cur)] = next;
    return { ok: true, row: next };
  }
  return [{
    match: SB + '/**',
    handle(route) {
      const req = route.request();
      const u = req.url();
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = (v, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
      const missing = () => json({ code: 'PGRST202', message: 'check fixture: not served', details: null, hint: null }, 404);
      if (/\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role: 'office', mfa: false });
      if (/\/rest\/v1\/allowed_accounts/.test(u)) return json({ role: 'office', label: '' });
      if (/\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role: 'office', rules: null, mine: null, updatedAt: null });
      if (/\/rest\/v1\/eq_files/.test(u)) return (prep || process.env.EQ_FIXTURE_PREP === '1') ? json({ code: '42P01', message: 'check fixture: no table' }, 404) : json([]);
      const m = /\/rest\/v1\/rpc\/(eq_[a-z_]+)/.exec(u);
      if (!m) return missing();
      if (prep || process.env.EQ_FIXTURE_PREP === '1') return missing();
      let p = {};
      try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
      const name = m[1];
      if (name === 'eq_list') return json(Object.assign({}, db, { ok: true }));
      if (LIST[name]) return json(save(LIST[name], p));
      if (name === 'eq_cancel_event') return json(state('events', p, { cancelled_at: now(), cancelled_by: '00000000-0000-4000-8000-0000000c4eck' }));
      if (name === 'eq_retire_asset') return json(state('assets', p, { status: 'retired' }));
      return missing();
    },
  }, PROFILE_ROUTE];
}
export const routes = routesFor();

/* snap.mjs の形に合わせた応答（match に当たる要求＝eq_list に架空の一覧を返す） */
export function respond() { return seed(); }
