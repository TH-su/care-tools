/* check/fixtures/care-schedule.mjs — 週間計画を、現場の規模に近い架空データで開くための材料（2026-10-27 新設）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs・tap-latency.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（接続先を架空の住所にする・事務所PCとして開く・切り替えスイッチは全部切）
 *   match   … 横取りする通信の住所（ネットへは出ない）
 *   respond(body) … 横取りした要求（統合同期 GAS への POST 本文 {action, key, ...}）に返す応答
 *   routes  … match 以外に横取りするもの（su-backend.json を「全部切」で返す＝Google の道だけで動かす）
 *   sheets  … 撮る帳票（今は無し＝snap.mjs は帳票を撮らない）
 *
 * 規模: 利用者 38名・1人あたり 1週間に 10〜25コマ（訪問が主・一部デイ）。
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は記号的な漢字の見本（架空・見本・試験…＋甲・乙・丙…）。
 * ★GAS との通信の形には触れない。画面が送る要求をそのまま受け、決まった応答を返すだけ。
 *   put は横取りした側のメモリにだけ残す（同じ道具の実行の間だけ・ファイルへは書かない）。
 */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY-SYNC/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY-SYNC/**';
export const FLAGS_OFF = { supabase: { care_schedule_v2: false, ws_weekly_master_v1: false, wsday: false, shift: false, patch_push: false, master_roster_read: false } };
export const storage = {
  su_sync_common: JSON.stringify({ endpoint: URL, token: 'check-dummy', updatedAt: 1 }),
  su_device_role: 'office',
  su_backend_flags: JSON.stringify(FLAGS_OFF),
};
export const routes = [
  { match: '**/su-backend.json*', body: FLAGS_OFF },
];
export const sheets = [];

/* ── 架空の利用者 38名 ── */
const SEI = ['架空', '見本', '試験', '仮名', '模擬', '例題', '仮置', '検証'];
const MEI = ['甲', '乙', '丙', '丁', '戊'];
const LEVELS = ['要介護1', '要介護2', '要介護3', '要介護4', '要介護5'];
export const RESIDENT_N = 38;
export const residentName = (i) => `${SEI[i % SEI.length]} ${MEI[Math.floor(i / SEI.length) % MEI.length]}`;

/* 決まった並びの擬似乱数（実行ごとに同じデータ） */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const SVC = [['身体０１', 19], ['身体１', 29], ['身体２', 59], ['身体１生活１', 89], ['生活２', 45], ['生活３', 60]];
const DETAIL = ['排泄介助', '更衣介助', '服薬確認', '整容', '移乗介助', '食事見守り', '居室清掃', '洗濯'];
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* 利用者ごとの1週間の予定（訪問・デイ）。訪問は同じ方で時間が重ならないように置く */
function buildResidents() {
  const r = rng(20261027);
  const out = [];
  for (let i = 0; i < RESIDENT_N; i++) {
    const nEv = 10 + Math.floor(r() * 16);   // 10〜25コマ
    const dayUser = i % 5 === 0;             // 5人に1人はデイも使う
    const events = [];
    const busy = Array.from({ length: 7 }, () => []);
    let k = 0, guard = 0;
    if (dayUser) for (const dow of [1, 3, 5]) { events.push({ id: `e${i}_d${dow}`, dayOfWeek: dow, serviceType: 'daycare', category: '', startTime: '09:30', endTime: '16:00', detail: '入浴・機能訓練', notes: '', units: 0, bathing: dow !== 3 }); busy[dow].push([9 * 60, 16 * 60 + 30]); k++; }
    while (k < nEv && guard++ < 500) {
      const dow = Math.floor(r() * 7);
      const [code, mins] = SVC[Math.floor(r() * SVC.length)];
      /* 6:00〜20:30 の15分刻み（2割は朝夕の起床・就寝の時間帯に寄せる） */
      const st = r() < 0.2 ? (r() < 0.5 ? 6 * 60 + 15 * Math.floor(r() * 6) : 19 * 60 + 15 * Math.floor(r() * 6)) : 7 * 60 + 15 * Math.floor(r() * 52);
      const en = st + mins + 1;
      if (en > 22 * 60) continue;
      if (busy[dow].some(([a, b]) => st < b + 30 && a < en + 30)) continue;   // 同じ方の訪問は30分空ける
      busy[dow].push([st, en]);
      const det = [DETAIL[Math.floor(r() * DETAIL.length)], DETAIL[Math.floor(r() * DETAIL.length)]].filter((v, j, a) => a.indexOf(v) === j).join('・');
      events.push({ id: `e${i}_${k}`, dayOfWeek: dow, serviceType: 'visit', category: code, startTime: hhmm(st), endTime: hhmm(en), detail: det, notes: '', units: 0, bathing: false });
      k++;
    }
    out.push({ id: 'cr' + String(i + 1).padStart(3, '0'), name: residentName(i), kana: '', events,
      careLevel: LEVELS[i % LEVELS.length], copayRate: 1, welfareEquipUnits: 0, external: false });
  }
  return out;
}
export const residents = buildResidents();
export function careDb() { return { residents: JSON.parse(JSON.stringify(residents)) }; }

/* ── 統合同期 GAS の見本（get / head / pull / put / ping / history）──
 * 応答の形は画面のコード（care-schedule の SYNC・work-schedule の gasCall）に合わせる:
 *   get  → { ok, data, rev }（無いキーは data:null・rev:0）
 *   head → key 1つなら { ok, rev }、keys なら { ok, revs:{key:rev} }
 *   pull → { ok, entries:{ key:{data, rev} } }（無いキーは入れない）
 *   put  → { ok, rev:新しい版 }（版の食い違いは見ない＝計測用）
 */
export function createKv(seed) {
  const kv = new Map();
  for (const [k, v] of Object.entries(seed || {})) kv.set(k, { data: v, rev: 1 });
  const stats = { get: 0, head: 0, pull: 0, put: 0, other: 0 };
  function respond(body) {
    const a = body && body.action;
    if (a === 'ping') return { ok: true, server: 'silverunix-sync' };
    if (a === 'get') { stats.get++; const e = kv.get(body.key); return { ok: true, data: e ? e.data : null, rev: e ? e.rev : 0 }; }
    if (a === 'head') {
      stats.head++;
      if (Array.isArray(body.keys)) { const revs = {}; for (const k of body.keys) revs[k] = kv.has(k) ? kv.get(k).rev : 0; return { ok: true, revs }; }
      const e = kv.get(body.key); return { ok: true, rev: e ? e.rev : 0 };
    }
    if (a === 'pull') {
      stats.pull++;
      const entries = {};
      for (const k of body.keys || []) if (kv.has(k)) entries[k] = { data: kv.get(k).data, rev: kv.get(k).rev };
      return { ok: true, entries };
    }
    if (a === 'put') {
      stats.put++;
      const e = kv.get(body.key); const rev = (e ? e.rev : 0) + 1;
      kv.set(body.key, { data: body.data, rev });
      return { ok: true, rev };
    }
    if (a === 'history') { stats.other++; return { ok: true, items: [] }; }
    stats.other++;
    return { ok: true };
  }
  return { kv, stats, respond };
}

const shared = createKv({ care_schedule_v2: careDb() });
export const kv = shared.kv;
export const stats = shared.stats;
export function respond(body) { return shared.respond(body); }
/* 道具ごとに新しい見本を作りたい時（1回の計測ごとに初期状態へ戻す等） */
export function freshKv() { return createKv({ care_schedule_v2: careDb() }); }
