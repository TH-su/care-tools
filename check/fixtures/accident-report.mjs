/* check/fixtures/accident-report.mjs — 事故報告書を、架空の入居者・架空の報告で開くための材料（2026-11-28 新設）
 *
 * snap.mjs の材料の形（URL・match・storage・routes・sheets・respond）。
 *   sheets … 事故報告書の紙（SUPrint の 'accident'・A4 縦）を、普通の文量（2ページ）と長い文量（2ページ＋別紙）の2通りで撮る
 * 手元の確かめ（ブラウザで開いて押す）でも同じ routes で通信を横取りする:
 *   storage … 事務所PCとして開き、架空の事務所のアカウントでログインしている端末にする
 *   routes  … 切り替えスイッチ（su-backend.json）は master_live だけ入（入居者マスタは新しい保存先から読む道）。
 *             Supabase への通信を全部横取りし、ログインの確かめ・アプリの使える人・入居者マスタの読み取り（res_mode_get・res_roster・res_get）・
 *             事故報告書の RPC（acc_list・acc_save・acc_cancel）に架空の応答を返す。
 *             acc_save は共通 DB の契約どおりに断る（知らない鍵 badkey・版違い conflict・入居者の変更 resident_change・取り消し済み cancelled・
 *             無い notfound・新規で入居者が空 noresident・data が object でない／長すぎる badshape・元の報告が無い noprev）。保存は横取りの間だけメモリに覚える
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は記号的な架空の名前、病院・電話は実在しない見本の語と 000- の番号。施設情報は見本（facility-profile.sample.json）。
 * ★鍵・メールアドレスは架空（example.invalid）。本物の Supabase へは出ない（match に当たる要求は全部ここで答える）。
 */
export const URL = 'https://jhbernqawjrzqwrmqrih.supabase.co';
export const match = URL + '/rest/v1/rpc/acc_list';
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

/* 架空の入居者（入居者マスタの getResident と同じ平らな形） */
export const RESIDENTS = [
  { id: 'K001', name: '架空 花子', kana: 'かくう はなこ', room: '101', gender: '女', careLevel: '要介護４', active: true, birthDate: '1938-07-20',
    admissionDate: '2023-04-01', insurer: '見本市', dementia: 'IIIa' },
  { id: 'K002', name: '見本 太郎', kana: 'みほん たろう', room: '102', gender: '男', careLevel: '要支援2', active: true, birthDate: '1941-02-13',
    admissionDate: '2024/10/15', insurer: '', dementia: '自立' },
  { id: 'K003', name: '架空 長い名前の見本さん', kana: 'かくう ながい', room: '201', gender: '女', careLevel: '事業対象者', active: true, birthDate: '',
    admissionDate: '', insurer: '見本町', dementia: '' },
];

const T = 'kakuu-tenant';
const LONG = (n, s) => Array.from({ length: n }, (_, i) => s + '（' + (i + 1) + '）').join('\n');
/* 架空の報告（acc_list の行の形） */
export function seed() {
  return [
    { id: 'a0000000-0000-4000-8000-000000000001', tenant_id: T, resident_id: 'K001', resident_name: '架空 花子', occurred_on: '2026-02-12', report_kind: 'first', report_no: null,
      submit_date: '2026-02-16', prev_id: null, rev: 1, created_at: '2026-02-16T10:00:00+09:00', updated_at: '2026-02-16T10:00:00+09:00', cancelled_at: null,
      data: { severity: ['admit'], offices: ['施設'], serviceKinds: ['in'], gender: 'f', careLevel: '要介護4', dementia: 'IIIa', addressKind: 'office',
        corpName: '見本福祉会', officeAddress: '見本県見本市見本町1-2-3', insurer: '見本市', name: '架空 花子', age: '87', serviceStart: '2023-04-01',
        occurDate: '2026-02-12', occurHour: '6', occurMin: '30', place: ['room1'], kind: ['fall'], consult: ['ambulance'],
        hospName: '見本総合病院', hospTel: '000-000-0000', diagName: '右大腿骨頸部骨折', diag: ['fracture'], familyRel: ['child'], familyDate: '2026-02-12',
        detail: '見本の文。朝の巡回の時に居室のベッドの横で座り込んでいるのを見つけた。\n右の脚の付け根の痛みを訴えた。',
        response: '見本の文。看護職員が状態を確かめ、救急車を呼んだ。', status: '見本の文。入院して手術の予定。', cause: '見本の文。', prevention: '見本の文。',
        officeNames: ['有料老人ホーム 見本ホーム', '訪問介護 見本ヘルパー', 'デイサービス 見本の里'] } },
    { id: 'a0000000-0000-4000-8000-000000000002', tenant_id: T, resident_id: 'K002', resident_name: '見本 太郎', occurred_on: '2026-03-02', report_kind: 'final', report_no: null,
      submit_date: '2026-03-20', prev_id: null, rev: 1, created_at: '2026-03-20T10:00:00+09:00', updated_at: '2026-03-20T10:00:00+09:00', cancelled_at: null,
      /* 括弧の中の欄に 6〜30 字の中身（長い時は縮め、最小でも入らなければ別紙）・事業所の正式名は全角30字×3（2行に折る・別紙） */
      data: { severity: ['outpatient', 'admit', 'death', 'other'], severityOther: '見本のその他の程度の長い説明文で三十字ほどの中身です', deathDate: '2026-03-05',
        offices: ['施設', '通所'], serviceKinds: ['in', 'day'], gender: 'm', careLevel: '要支援2',
        officeNames: ['見本の長い正式名の有料老人ホーム見本ホーム見本の第一号館です', '見本の長い正式名の訪問介護事業所見本ヘルパー見本の本店でした', '見本の長い正式名のデイサービスセンター見本の里見本の本館です'],
        addressKind: 'other', addressOther: '見本県見本市見本町九丁目九番九号見本の家', name: '見本 太郎', age: '85', occurDate: '2026-03-02', occurHour: '14', occurMin: '5',
        place: ['dining', 'other'], placeOther: '見本の中庭の小さな池の横の通路', kind: ['med', 'other'], kindOther: '見本の種別の説明', consult: ['doctor', 'other'], consultOther: '見本の方法（電話で相談）',
        diag: ['bruise', 'fracture', 'other'], fracturePart: '右の大腿骨の付け根', diagOther: '見本の内容の説明で長めに書いた二十字程度', familyRel: ['spouse', 'other'], familyOther: '見本の遠い親戚の方',
        agencies: ['city', 'police', 'other'],
        agencyCity: '見本町の高齢者支援の担当課', agencyPolice: '見本警察署の生活安全課', agencyOther: '見本の地域包括支援センター',
        detail: LONG(40, '長い見本の文。発生時の様子をできるだけ具体的に書いた行'), cause: LONG(30, '長い見本の文。原因の分析の行'),
        prevention: LONG(80, '長い見本の文。再発防止策の行で、とても長く書いた場合'), note: '見本の文。' } },
  ];
}

const EDIT_KEYS = ['id', 'resident_id', 'resident_name', 'occurred_on', 'report_kind', 'report_no', 'submit_date', 'prev_id', 'data'];
const SAMPLE_PROFILE = new globalThis.URL('../../facility-profile.sample.json', import.meta.url);
const PROFILE_ROUTE = {
  match: '**/facility-profile.json',
  async handle(route) {
    const fs = await import('node:fs');
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(SAMPLE_PROFILE, 'utf8') });
  },
};
const FLAGS_ROUTE = { match: '**/su-backend.json*', handle: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabase: { master_live: true } }) }) };

/* routes を作る。opt.log に配列を渡すと、横取りした RPC の名前と本文を覚える（通しの試しで送った中身を確かめる） */
export function routesFor(opt = {}) {
  const db = seed();
  const log = opt.log || null;
  let n = 0;
  const now = () => new Date().toISOString();
  const light = (r) => ({ id: r.id, resident_id: r.resident_id, resident_name: r.resident_name, occurred_on: r.occurred_on, report_kind: r.report_kind, report_no: r.report_no, submit_date: r.submit_date, updated_at: r.updated_at });
  const live = () => db.filter((r) => !r.cancelled_at);
  const order = (a, b) => (String(b.occurred_on || '') > String(a.occurred_on || '') ? 1 : String(b.occurred_on || '') < String(a.occurred_on || '') ? -1 : (String(b.updated_at) > String(a.updated_at) ? 1 : -1));
  const hospitals = () => {
    const out = [], seen = {};
    live().slice().sort((a, b) => (String(b.updated_at) > String(a.updated_at) ? 1 : -1)).forEach((r) => {
      const nm = String((r.data && r.data.hospName) || '').trim(); const tel = String((r.data && r.data.hospTel) || '');
      if (nm && !seen[nm + '|' + tel]) { seen[nm + '|' + tel] = 1; out.push({ name: nm, tel }); }
    });
    return out.slice(0, 100);
  };
  function list(p) {
    if (p.p_resident == null) return { ok: true, reports: live().sort(order).slice(0, 500).map(light), hospitals: hospitals() };
    return { ok: true, reports: live().filter((r) => r.resident_id === p.p_resident).sort(order), hospitals: hospitals() };
  }
  function save(p) {
    const row = p.p_row;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, error: 'badshape' };
    if (Object.keys(row).some((k) => EDIT_KEYS.indexOf(k) < 0)) return { ok: false, error: 'badkey' };
    if (row.data !== undefined && (typeof row.data !== 'object' || row.data === null || Array.isArray(row.data) || JSON.stringify(row.data).length > 60000)) return { ok: false, error: 'badshape' };
    if (row.report_kind !== undefined && ['first', 'nth', 'final'].indexOf(row.report_kind) < 0) return { ok: false, error: 'badshape' };
    if (row.report_no != null && !(Number.isInteger(row.report_no) && row.report_no >= 2 && row.report_no <= 99)) return { ok: false, error: 'badshape' };
    if (row.prev_id && !db.some((r) => r.id === row.prev_id)) return { ok: false, error: 'noprev' };
    for (const k of ['occurred_on', 'submit_date']) if (row[k] === '') row[k] = null;
    if (!row.id) {
      if (p.p_rev != null) return { ok: false, error: 'badshape' };
      if (String(row.resident_id || '') === '') return { ok: false, error: 'noresident' };
      if (!/^[0-9A-Za-z_-]{1,32}$/.test(String(row.resident_id))) return { ok: false, error: 'badshape' };
      const next = Object.assign({ tenant_id: T, report_no: null, submit_date: null, prev_id: null, occurred_on: null, data: {}, cancelled_at: null }, row,
        { id: 'a0000000-0000-4000-8000-1' + String(++n).padStart(11, '0'), rev: 1, created_at: now(), updated_at: now() });
      db.push(next);
      return { ok: true, row: next };
    }
    const cur = db.find((x) => x.id === row.id);
    if (!cur) return { ok: false, error: 'notfound' };
    if (cur.cancelled_at) return { ok: false, error: 'cancelled' };
    if (row.resident_id !== undefined && row.resident_id !== cur.resident_id) return { ok: false, error: 'resident_change' };
    if (cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    const next = Object.assign({}, cur, row, { rev: cur.rev + 1, updated_at: now() });
    db[db.indexOf(cur)] = next;
    return { ok: true, row: next };
  }
  function cancel(p) {
    const cur = db.find((x) => x.id === p.p_id);
    if (!cur) return { ok: false, error: 'notfound' };
    if (cur.cancelled_at) return { ok: false, error: 'cancelled' };
    if (cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    const next = Object.assign({}, cur, { cancelled_at: now(), cancelled_by: '00000000-0000-4000-8000-0000000c4eck', rev: cur.rev + 1, updated_at: now() });
    db[db.indexOf(cur)] = next;
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
      const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(u);
      if (!m) return missing();
      let p = {};
      try { p = JSON.parse(req.postData() || '{}'); } catch (e) { p = {}; }
      const name = m[1];
      if (log) log.push({ name, body: p });
      if (name === 'res_mode_get') return json({ mode: 'live', stateRev: 1, srev: 0 });
      if (name === 'res_roster') return json({ ok: true, rows: RESIDENTS.map((r) => ({ id: r.id, name: r.name, kana: r.kana, room: r.room, gender: r.gender, careLevel: r.careLevel, active: r.active })) });
      if (name === 'res_get') return json({ ok: true, rows: RESIDENTS.filter((r) => (p.p_ids || []).indexOf(r.id) >= 0) });
      if (name === 'acc_list') return json(list(p));
      if (name === 'acc_save') return json(save(p));
      if (name === 'acc_cancel') return json(cancel(p));
      return missing();
    },
  }, PROFILE_ROUTE, FLAGS_ROUTE];
}
export const routes = routesFor();

/* 紙（A4 縦）。ページの中で動く。報告を開き、押した時と同じ道（print_）で紙を組む（印刷のダイアログは開かない） */
function sheetPrep(arg) {
  return (async (a) => {
    const wait = async (fn) => { for (let i = 0; i < 150; i++) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    if (!(await wait(() => typeof pickResident_ === 'function' && window.SUPrint && typeof view !== 'undefined' && view === 'app' && typeof dbState !== 'undefined' && dbState === 'ok'))) return false;
    window.print = function () {};
    pickResident_(a.rid, a.aid);
    if (!(await wait(() => typeof draft !== 'undefined' && draft && String(draft.id) === a.aid && !loading))) return false;
    print_();
    return !!(await wait(() => document.body.classList.contains('su-printing')));
  })(arg);
}
export const sheets = [
  { key: 'report', arg: { rid: 'K001', aid: 'a0000000-0000-4000-8000-000000000001' }, ready: '#a-print .ar-page', prepare: sheetPrep },
  { key: 'long', arg: { rid: 'K002', aid: 'a0000000-0000-4000-8000-000000000002' }, ready: '#a-print .ar-sheet2', prepare: sheetPrep },
];

/* snap.mjs の形に合わせた応答（match に当たる要求＝acc_list に一覧を返す。routes の方が先に答えるので、通常は使われない） */
export function respond() { return { ok: true, reports: seed().map((r) => ({ id: r.id, resident_id: r.resident_id, resident_name: r.resident_name, occurred_on: r.occurred_on, report_kind: r.report_kind, report_no: r.report_no, submit_date: r.submit_date, updated_at: r.updated_at })), hospitals: [] }; }
