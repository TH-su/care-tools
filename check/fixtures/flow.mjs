/* check/fixtures/flow.mjs — 業務の流れを通す試験（check/flow_e2e.mjs）の材料（2026-11-02 新設）
 *
 * 画面ごとの撮影の材料（resident-master.mjs など）と違い、ここでは「保存した値を覚える」偽物の通信を作る。
 *   createMaster() … 入居者マスタ GAS の偽物。記録（getResident と同じ形）を覚え、読み取りの応答は
 *                    su-res-read.js に写してある GAS の読み取り関数（_answer・本物の master.gs と一字一句同じ写し）で組む＝応答の形を二重に書かない。
 *                    saveResident は送られた記録で置き換え、入院の3項目（hospitalized・hospitalizedAt・stateLog）は残す（GAS の SAVE_PRESERVE と同じ）。
 *   createKv()    … 統合同期 GAS の偽物（get/head/pull/put を覚える。check/fixtures/care-schedule.mjs のものをそのまま使う）。
 *   supabase(state) … ログインの確かめ（su-app-gate）を事務所のアカウントで通す Supabase の偽物（resident-master.mjs と同じ答え）。
 *   FLAGS_OFF     … 切り替えスイッチ su-backend.json を全部切で返す（Google の道だけで動かす）。
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は見本の語、電話は 000- の架空の番号、メールは example.invalid。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった形の応答を返すだけ。
 * ★snap.mjs は check/fixtures/<画面名>.mjs だけを読む。flow.html という画面は無いので、この材料は撮影の道具には読まれない。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createKv } from './care-schedule.mjs';
export { createKv };

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ── 接続先（画面の守り CSP の connect-src が通す Google の形。全部横取りするので外へは出ない） ── */
export const MASTER_URL = 'https://script.google.com/macros/s/CHECK-FLOW-MASTER/exec';
export const SYNC_URL = 'https://script.google.com/macros/s/CHECK-FLOW-SYNC/exec';
export const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';

/* su-backend.json の全部のスイッチを切（今の本番の su-backend.json にあるキーを全部切にする） */
export const FLAGS_OFF = { supabase: {
  care_schedule_v2: false, ws_weekly_master_v1: false, wsday: false, shift: false, patch_push: false,
  master_roster_read: false, patch_read: false, admission: false, master_live: false, training: false,
  training_ai: false, master_ai: false,
} };

/* ── ログインの偽物（架空の事務所のアカウント。resident-master.mjs と同じ作り） ── */
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const USER_ID = '00000000-0000-4000-8000-0000000f10a0';
const EMAIL = 'check-flow-office@example.invalid';
const FAKE_JWT = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: USER_ID, email: EMAIL, role: 'authenticated', aal: 'aal1', exp: 4102444800 }) + '.check';
export const FAKE_SESSION = JSON.stringify({
  access_token: FAKE_JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
  user: { id: USER_ID, email: EMAIL, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
});

/* 端末に入れる設定。device は 'office'（事務所PC）か 'field'（現場） */
export function storage(device = 'office') {
  return {
    rmaster_cfg: JSON.stringify({ url: MASTER_URL, token: 'check-flow' }),
    su_sync_common: JSON.stringify({ endpoint: SYNC_URL, token: 'check-flow', updatedAt: 1 }),
    ws_settings: JSON.stringify({ endpoint: SYNC_URL, token: 'check-flow', shiftAuto: true }),
    su_device_role: device,
    su_backend_flags: JSON.stringify(FLAGS_OFF),
    su_facility_profile_v1: JSON.stringify({ setupDone: true, facilityName: '' }),
    'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
  };
}

/* Supabase の偽物。ログインの確かめと「アプリの使える人」だけ答え、ほかは「無い」（＝画面は Google の道で読む）。
   受けた要求は state.sb に残す（試験が「何を読みに行ったか」を見る） */
export function supabase(state, role = 'office') {
  return (route) => {
    const req = route.request();
    const u = req.url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = new URL(u).pathname;
    if (state) state.sb.push(req.method() + ' ' + p);
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
    if (/\/rest\/v1\/rpc\/my_account$/.test(p)) return json({ role, mfa: false });
    if (/\/rest\/v1\/allowed_accounts$/.test(p)) return json({ role, label: '' });
    if (/\/rest\/v1\/rpc\/app_access_mine$/.test(p)) return json({ ok: true, role, rules: null, mine: null, updatedAt: null });
    if (/\/auth\/v1\/user$/.test(p)) return json({ id: USER_ID, email: EMAIL, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST202', message: 'check fixture: not served' }) });
  };
}

/* ── 架空の入居者（入居者マスタの記録・getResident と同じ形） ── */
const SEI = [['架空', 'カクウ'], ['見本', 'ミホン'], ['試験', 'シケン'], ['仮名', 'カメイ']];
const MEI = [['一郎', 'イチロウ'], ['花子', 'ハナコ'], ['二郎', 'ジロウ'], ['春子', 'ハルコ']];
const LEVELS = ['要介護1', '要介護2', '要介護3', '要介護4', '要介護5', '要介護3', '要介護2', '要介護4',
  '要介護1', '要介護5', '要介護3', '要介護2', '要介護4', '要支援2', '要介護3', '要介護1'];
const pad = (n) => String(n).padStart(2, '0');
export const RESIDENT_N = 12;
export function masterRecords() {
  return Array.from({ length: RESIDENT_N }, (_, i) => {
    const [sei, seiK] = SEI[i % 4], [mei, meiK] = MEI[Math.floor(i / 4)];
    return {
      id: 1001 + i,
      name: `${sei} ${mei}`,
      kana: `${seiK} ${meiK}`,
      room: String(i < 6 ? 101 + i : 201 + (i - 6)),
      gender: i % 2 ? '女' : '男',
      careLevel: LEVELS[i],
      active: true,
      updatedAt: '2026-01-01T09:00:00.000Z',
      birthDate: `19${30 + (i % 15)}-${pad(1 + (i % 12))}-${pad(1 + ((i * 7) % 28))}`,
      height: String(145 + i),
      admissionDate: `20${20 + (i % 6)}-${pad(1 + ((i * 5) % 12))}-${pad(1 + ((i * 3) % 28))}`,
      careOffice: 'みほん居宅介護支援センター', careManager: '見本 ケア一', careOfficeTel: '000-0000-0101',
      hospital: 'かくう内科', doctor: '架空 医一', hospitalTel: '000-0000-0201',
      allergy: '', medsRegular: '見本薬A 1錠 朝', family: [{ name: '見本 家族', relation: '長男', phone: '000-0000-0301', address: '', emergency: true, kp: true }],
      targetApps: ['facesheet', 'schedule', 'weight'],
    };
  });
}

/* su-res-read.js にある GAS の読み取り関数の写し（_answer）を Node の中で使う（ブラウザの部品は変えない・読むだけ） */
let RES_READ = null;
function resRead() {
  if (RES_READ) return RES_READ;
  const src = fs.readFileSync(path.join(repoDir, 'su-res-read.js'), 'utf8');
  const sandbox = {};
  vm.runInNewContext(src, sandbox, { filename: 'su-res-read.js' });
  RES_READ = sandbox.SUResRead;
  if (!RES_READ || typeof RES_READ._answer !== 'function') throw new Error('su-res-read.js の読み取り関数の写し（_answer）が見つかりません');
  return RES_READ;
}

/* 入居者マスタ GAS の偽物（保存した値を覚える）。log に受けた要求（action と主な引数）を残す */
export function createMaster(seed) {
  const recs = new Map();
  for (const r of seed || masterRecords()) recs.set(String(r.id), JSON.parse(JSON.stringify(r)));
  let rev = 1;
  const log = [];
  const all = () => Array.from(recs.values());
  const PRESERVE = ['hospitalized', 'hospitalizedAt', 'stateLog'];
  function respond(body) {
    const a = body && body.action;
    log.push({ action: a, id: body && body.id, section: body && body.section, hasToken: !!(body && body.token) });
    if (a === 'stateRev') return { ok: true, rev, srev: 0 };
    if (a === 'ping') return { ok: true };
    if (['getRoster', 'getResident', 'getSection', 'getBulk', 'getListFull', 'getMedsBulk', 'getMealList'].includes(a)) {
      const o = resRead()._answer(a, body, all());
      if (a === 'getRoster') o.stateRev = rev;
      return Object.assign({ ok: true }, o);
    }
    if (a === 'saveResident') {
      const rec = body.record || {};
      let id = rec.id;
      if (id == null || id === '') { id = 1001 + recs.size; }
      const old = recs.get(String(id)) || {};
      if (body.baseUpdatedAt && old.updatedAt && Math.abs(Date.parse(old.updatedAt) - Date.parse(body.baseUpdatedAt)) >= 1000) {
        return { ok: false, error: 'conflict' };
      }
      const next = JSON.parse(JSON.stringify(rec));
      next.id = typeof old.id === 'number' ? old.id : id;
      for (const k of PRESERVE) if (!(k in next) && k in old) next[k] = old[k];
      recs.set(String(id), next);
      rev++;
      return { ok: true, record: JSON.parse(JSON.stringify(next)) };
    }
    if (a === 'setState') {
      const r = recs.get(String(body.id));
      if (r) { r.hospitalized = !!body.hospitalized; rev++; }
      return { ok: true, record: r ? JSON.parse(JSON.stringify(r)) : null };
    }
    if (a === 'getMedDict') return { ok: true, dict: {} };
    return { ok: true };
  }
  return { recs, log, respond, get: (id) => recs.get(String(id)) };
}

/* ── 週間計画（care_schedule_v2）の架空データ。入居者マスタの名簿と masterId でつながる ── */
export function careDb(records) {
  const rs = (records || masterRecords()).map((m, i) => ({
    id: 'fl' + pad(i + 1), name: m.name, kana: m.kana, room: m.room, masterId: m.id,
    careLevel: m.careLevel, copayRate: 1, welfareEquipUnits: 0, external: false, targetSchedule: true,
    events: i < 4 ? [
      /* 4名はデイ（月・木）と訪問（火）を1コマずつ。ほかの方は予定なし。dayOfWeek は 0=月..6=日（週間計画の DAYS_JA と同じ） */
      { id: `fl${i}_d1`, dayOfWeek: 0, serviceType: 'daycare', category: '', startTime: '09:30', endTime: '16:00', detail: '入浴・機能訓練', notes: '', units: 0, bathing: true },
      { id: `fl${i}_d4`, dayOfWeek: 3, serviceType: 'daycare', category: '', startTime: '09:30', endTime: '16:00', detail: '機能訓練', notes: '', units: 0, bathing: false },
      { id: `fl${i}_v2`, dayOfWeek: 1, serviceType: 'visit', category: '身体１', startTime: `${pad(8 + i)}:00`, endTime: `${pad(8 + i)}:30`, detail: '排泄介助', notes: '', units: 0, bathing: false },
    ].concat(i === 2 ? Array.from({ length: 7 }, (_, d) =>
      /* 1名は毎日の朝の訪問（ワークスケジュールが週の型から列型の盤面を作るには、その曜日の型に1件以上要る） */
      ({ id: `fl${i}_m${d}`, dayOfWeek: d, serviceType: 'visit', category: '身体０１', startTime: '07:00', endTime: '07:19', detail: '起床介助', notes: '', units: 0, bathing: false })) : []) : [],
  }));
  return { residents: rs };
}

/* ── ワークスケジュールの週の型（ws_weekly_master_v1）。週間計画の訪問を曜日ごと・列（slot）ごとに並べる ──
   型があると、ワークスケジュールは日ごとの盤面を「列（slot）型」で作る（型が無いと勤務表を反映できない）。
   形は check/fixtures/work-schedule.mjs の buildMaster と同じ。曜日は週間計画の dayOfWeek（0=月..6=日）をそのまま使う */
const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export function wsMaster(db, now = new Date()) {
  const weekdays = {}; for (const k of DOW_KEYS) weekdays[k] = [];
  const lanes = {}; for (const k of DOW_KEYS) lanes[k] = [];
  const all = [];
  for (const r of db.residents) for (const e of r.events) if (e.serviceType === 'visit') all.push({ r, e });
  all.sort((a, b) => toMin(a.e.startTime) - toMin(b.e.startTime));
  for (const { r, e } of all) {
    const key = DOW_KEYS[e.dayOfWeek];
    const st = toMin(e.startTime), en = toMin(e.endTime);
    const ln = lanes[key];
    let slot = ln.findIndex((endAt) => endAt <= st);
    if (slot < 0) { slot = ln.length; ln.push(0); }
    ln[slot] = en;
    weekdays[key].push({ residentName: r.name, svcCode: e.category, start: st, end: en,
      contents: String(e.detail || '').split('・').filter(Boolean), zone: 'visit', slot: slot + 1, tentative: false });
  }
  return { source: 'CARE' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0'), weekdays };
}
