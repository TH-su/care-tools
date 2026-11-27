/* check/fixtures/hospital-visit.mjs — 受診連絡を、架空の入居者・架空の受診で開くための材料（2026-11-28 新設・反証レビューの指摘）
 *
 * snap.mjs の材料の形（URL・match・storage・routes・sheets・respond）。
 *   sheets … 病院あての手紙の紙（SUPrint の 'letter'・A4 縦）を、普通の文量（1枚）と長い文量（1枚に収まらず次のページへ続く）の2通りで撮る
 * 手元の確かめ（ブラウザで開いて押す）でも同じ routes で通信を横取りする:
 *   storage … 事務所PCとして開き、架空の事務所のアカウントでログインしている端末にする
 *   routes  … 切り替えスイッチ（su-backend.json）は master_live だけ入（入居者マスタは新しい保存先から読む道）。
 *             Supabase への通信を全部横取りし、ログインの確かめ・アプリの使える人・入居者マスタの読み取り（res_mode_get・res_roster・res_get）・
 *             受診連絡の RPC（hv_list・hv_save_visit・hv_cancel_visit・hv_save_hospital・hv_save_settings）に架空の応答を返す。
 *             hv_save_visit は新しい受診の p_row.id（画面が作った番号）に同じ番号の行があればその行を返す（統合 0142 の形）。保存は横取りの間だけメモリに覚える
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は記号的な架空の名前、病院・薬は実在しない見本の語、電話は 000- の番号。施設情報は見本（facility-profile.sample.json）。
 * ★鍵・メールアドレスは架空（example.invalid）。本物の Supabase へは出ない（match に当たる要求は全部ここで答える）。
 * ★紙を組む時に「保存していません」の確かめで止まらないよう、開く受診は保存済みで、入力欄を一往復しても同じ値になる形にする
 *   （受診種別・結果は設定の既定の選択肢の語・日付は YYYY-MM-DD・本文は改行で始めない）。
 */
export const URL = 'https://jhbernqawjrzqwrmqrih.supabase.co';
export const match = URL + '/rest/v1/rpc/hv_list';
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

/* 架空の入居者（入居者マスタの getResident と同じ平らな形・医療の欄は定期薬だけ見本の薬） */
export const RESIDENTS = [
  { id: 'K001', name: '架空 花子', kana: 'かくう はなこ', room: '101', gender: '女', careLevel: '要介護４', active: true,
    hospital: '見本内科医院', doctor: '見本 一郎', allergy: 'なし', currentDiseases: '見本の病名A', medsRegular: '架空薬A 5mg 1錠 朝食後\n架空薬B 10mg 2錠 朝夕食後', medsNotes: '' },
  { id: 'K002', name: '見本 太郎', kana: 'みほん たろう', room: '102', gender: '男', careLevel: '要支援2', active: true,
    hospital: '', doctor: '', allergy: '', currentDiseases: '', medsRegular: '架空薬C 1包 就寝前', medsNotes: '' },
];

const T = 'kakuu-tenant';
const H1 = 'd0000000-0000-4000-8000-000000000001';
const LONG = (n, s) => Array.from({ length: n }, (_, i) => s + '（' + (i + 1) + '）').join('\n');
export function hospitalsSeed() {
  return [{ id: H1, tenant_id: T, name: '見本総合病院', dept: '見本内科', doctor: '見本 二郎', phone: '000-000-0000', fax: '000-000-0001', note: '', sort: 0, disabled: false, rev: 1 }];
}
/* 架空の受診（hv_list の p_resident ありの行の形＝全項目） */
export function seed() {
  const base = { tenant_id: T, hospital_id: H1, hospital_name: '見本総合病院', dept: '見本内科', doctor: '見本 二郎', visit_kind: '定期受診', letter_title: '',
    result_body: '', result1: '', result2: '', added_med: null, added_med_note: '', result_note: '', next_date: null, cancelled_at: null, rev: 1 };
  return [
    Object.assign({}, base, { id: 'e0000000-0000-4000-8000-000000000001', resident_id: 'K001', resident_name: '架空 花子', letter_date: '2026-11-17', visit_date: '2026-11-18',
      letter_body: '見本の文。最近の様子をお知らせします。\n\n・食事は毎食八割ほど召し上がっています。\n・夜はよく眠れています。\n・11/10 から少し咳が出ています。\n\n【服薬中の薬】\n架空薬A 5mg 1錠 朝食後\n架空薬B 10mg 2錠 朝夕食後',
      created_at: '2026-11-17T10:00:00+09:00', updated_at: '2026-11-17T10:00:00+09:00' }),
    Object.assign({}, base, { id: 'e0000000-0000-4000-8000-000000000002', resident_id: 'K002', resident_name: '見本 太郎', letter_date: '2026-11-20', visit_date: '2026-11-21', visit_kind: '臨時受診',
      letter_body: LONG(70, '長い見本の文。受診の前の様子をできるだけ具体的に書いた行'),
      created_at: '2026-11-20T10:00:00+09:00', updated_at: '2026-11-20T10:00:00+09:00' }),
  ];
}

const EDIT_KEYS = ['resident_id', 'resident_name', 'letter_date', 'visit_date', 'visit_kind', 'hospital_id', 'hospital_name', 'dept', 'doctor', 'letter_title',
  'letter_body', 'result_body', 'result1', 'result2', 'added_med', 'added_med_note', 'result_note', 'next_date'];
const H_KEYS = ['name', 'dept', 'doctor', 'phone', 'fax', 'note', 'sort', 'disabled'];
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
  const hosp = hospitalsSeed();
  let settings = null;
  const log = opt.log || null;
  let n = 0;
  const now = () => new Date().toISOString();
  const has = (r) => !!(String(r.result1 || '').trim() || String(r.result_body || '').trim() || r.added_med);
  const light = (r) => ({ id: r.id, resident_id: r.resident_id, resident_name: r.resident_name, letter_date: r.letter_date, visit_date: r.visit_date, visit_kind: r.visit_kind,
    hospital_id: r.hospital_id, hospital_name: r.hospital_name, dept: r.dept, next_date: r.next_date, has_result: has(r), rev: r.rev, updated_at: r.updated_at });
  const live = () => db.filter((r) => !r.cancelled_at);
  const order = (a, b) => (String(b.visit_date || b.letter_date || '') > String(a.visit_date || a.letter_date || '') ? 1 : -1);
  function list(p) {
    const shared = { hospitals: hosp, settings };
    if (p.p_resident == null) return Object.assign({ ok: true, visits: live().sort(order).slice(0, 500).map(light) }, shared);
    return Object.assign({ ok: true, visits: live().filter((r) => r.resident_id === p.p_resident).sort(order) }, shared);
  }
  function save(p) {
    const row = p.p_row;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, error: 'badshape' };
    if (Object.keys(row).some((k) => k !== 'id' && EDIT_KEYS.indexOf(k) < 0)) return { ok: false, error: 'badkey' };
    const patch = {};
    Object.keys(row).forEach((k) => { if (k !== 'id') patch[k] = row[k] === '' ? null : row[k]; });
    if (patch.hospital_id && !hosp.some((h) => h.id === patch.hospital_id)) return { ok: false, error: 'nohospital' };
    if (p.p_rev == null) {
      /* 0142 の形: 画面の番号に同じ行があればその行を返す（書かない） */
      if (row.id) { const same = db.find((x) => x.id === row.id); if (same) return { ok: true, row: same }; }
      if (!patch.resident_id) return { ok: false, error: 'noresident' };
      const next = Object.assign({ tenant_id: T, cancelled_at: null }, patch, { id: row.id || ('e0000000-0000-4000-8000-1' + String(++n).padStart(11, '0')), rev: 1, created_at: now(), updated_at: now() });
      db.push(next);
      return { ok: true, row: next };
    }
    const cur = db.find((x) => x.id === row.id);
    if (!cur) return { ok: false, error: 'notfound' };
    if (cur.cancelled_at) return { ok: false, error: 'cancelled' };
    if (cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    if ('resident_id' in patch && patch.resident_id !== cur.resident_id) return { ok: false, error: 'resident_change' };
    const next = Object.assign({}, cur, patch, { rev: cur.rev + 1, updated_at: now() });
    db[db.indexOf(cur)] = next;
    return { ok: true, row: next };
  }
  function cancel(p) {
    const cur = db.find((x) => x.id === p.p_id);
    if (!cur) return { ok: false, error: 'notfound' };
    if (cur.cancelled_at) return { ok: false, error: 'cancelled' };
    if (cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    const next = Object.assign({}, cur, { cancelled_at: now(), rev: cur.rev + 1, updated_at: now() });
    db[db.indexOf(cur)] = next;
    return { ok: true, row: next };
  }
  function saveHosp(p) {
    const row = p.p_row || {};
    if (Object.keys(row).some((k) => k !== 'id' && H_KEYS.indexOf(k) < 0)) return { ok: false, error: 'badkey' };
    if (p.p_rev == null) { const h = Object.assign({ tenant_id: T, sort: 0, disabled: false }, row, { id: 'd0000000-0000-4000-8000-1' + String(++n).padStart(11, '0'), rev: 1 }); hosp.push(h); return { ok: true, row: h }; }
    const cur = hosp.find((x) => x.id === row.id);
    if (!cur) return { ok: false, error: 'notfound' };
    if (cur.rev !== p.p_rev) return { ok: false, conflict: true, row: cur };
    const next = Object.assign({}, cur, row, { rev: cur.rev + 1 }); hosp[hosp.indexOf(cur)] = next;
    return { ok: true, row: next };
  }
  function saveSettings(p) {
    if (!p.p_data || typeof p.p_data !== 'object') return { ok: false, error: 'badshape' };
    if ((settings ? settings.rev : null) !== (p.p_rev == null ? null : p.p_rev)) return { ok: false, conflict: true, row: settings };
    settings = { data: p.p_data, rev: (settings ? settings.rev : 0) + 1 };
    return { ok: true, row: settings };
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
      if (name === 'hv_list') return json(list(p));
      if (name === 'hv_save_visit') return json(save(p));
      if (name === 'hv_cancel_visit') return json(cancel(p));
      if (name === 'hv_save_hospital') return json(saveHosp(p));
      if (name === 'hv_save_settings') return json(saveSettings(p));
      return missing();
    },
  }, PROFILE_ROUTE, FLAGS_ROUTE];
}
export const routes = routesFor();

/* 紙（A4 縦）。ページの中で動く。受診を開き、押した時と同じ道（print_）で紙を組む（印刷のダイアログは開かない） */
function sheetPrep(arg) {
  return (async (a) => {
    const wait = async (fn) => { for (let i = 0; i < 150; i++) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    if (!(await wait(() => typeof pickResident_ === 'function' && window.SUPrint && typeof view !== 'undefined' && view === 'app' && typeof dbState !== 'undefined' && dbState === 'ok'))) return false;
    window.print = function () {};
    pickResident_(a.rid, a.vid);
    if (!(await wait(() => typeof draft !== 'undefined' && draft && String(draft.id) === a.vid && !loading))) return false;
    print_();
    return !!(await wait(() => document.body.classList.contains('su-printing')));
  })(arg);
}
export const sheets = [
  { key: 'letter', arg: { rid: 'K001', vid: 'e0000000-0000-4000-8000-000000000001' }, ready: '#h-print .hl-sheet', prepare: sheetPrep },
  { key: 'long', arg: { rid: 'K002', vid: 'e0000000-0000-4000-8000-000000000002' }, ready: '#h-print .hl-sheet', prepare: sheetPrep },
];

/* snap.mjs の形に合わせた応答（match に当たる要求＝hv_list に一覧を返す。routes の方が先に答えるので、通常は使われない） */
export function respond() { return { ok: true, visits: [], hospitals: hospitalsSeed(), settings: null }; }
