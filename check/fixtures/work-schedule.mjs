/* check/fixtures/work-schedule.mjs — ワークスケジュールを、現場の規模に近い架空データで開くための材料（2026-10-27 新設）
 *
 * 使い方は check/fixtures/resident-master.mjs と同じ形（snap.mjs・tap-latency.mjs が読む）。
 *   storage・match・respond・routes・sheets の意味は check/fixtures/care-schedule.mjs の冒頭を参照。
 *
 * サーバー（統合同期 GAS の見本）に置くもの:
 *   care_schedule_v2       … 週間計画（利用者 38名・care-schedule.mjs と同じ架空データ）
 *   ws_weekly_master_v1    … 週の型（週間計画の訪問を、曜日ごと・列（slot）ごとに重ならないよう並べたもの）
 *   staff / symbols / sched:YYYY-MM:plan … 勤務表（職員 30名・今月と前後の月。1日に15〜20名が出勤）
 * 日ごとの盤面（wsday_YYYY-MM-DD）は置かない。画面が週の型と勤務表から盤面を作り、put で送ってきたものを
 * 見本のメモリに残す（同じ実行の中で、次に開いた時はサーバーの盤面として返る）。
 * ★架空データだけ（CLAUDE.md §2-1）。職員名も記号的な漢字の見本。
 * ★日付は実行した日を基準に作る（今日の盤面が出るように）。時計は止めない（計測の道具のため）。
 */
import { URL, match, FLAGS_OFF, routes, residents, careDb, createKv } from './care-schedule.mjs';
export { URL, match, routes };

export const storage = {
  su_sync_common: JSON.stringify({ endpoint: URL, token: 'check-dummy', updatedAt: 1 }),
  ws_settings: JSON.stringify({ endpoint: URL, token: 'check-dummy', shiftAuto: true }),
  su_device_role: 'office',
  su_backend_flags: JSON.stringify(FLAGS_OFF),
  /* 施設情報の初期設定の窓を出さない（名前は空のまま・設定済みの印だけ） */
  su_facility_profile_v1: JSON.stringify({ setupDone: true, facilityName: '' }),
};
export const sheets = [];

const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/* 週の型: 週間計画の訪問（dayOfWeek 0=日..6=土）を、型の曜日（0=月..6=日）へ移して列に詰める */
function buildMaster() {
  const weekdays = {}; for (const k of DOW_KEYS) weekdays[k] = [];
  const lanes = {}; for (const k of DOW_KEYS) lanes[k] = [];
  const all = [];
  for (const r of residents) for (const e of r.events) if (e.serviceType === 'visit') all.push({ r, e });
  all.sort((a, b) => toMin(a.e.startTime) - toMin(b.e.startTime));
  for (const { r, e } of all) {
    const key = DOW_KEYS[(e.dayOfWeek + 6) % 7];
    const st = toMin(e.startTime), en = toMin(e.endTime);
    const ln = lanes[key];
    let slot = ln.findIndex((endAt) => endAt <= st);
    if (slot < 0) { slot = ln.length; ln.push(0); }
    ln[slot] = en;
    weekdays[key].push({ residentName: r.name, svcCode: e.category, start: st, end: en,
      contents: String(e.detail || '').split('・').filter(Boolean), zone: 'visit', slot: slot + 1, tentative: false });
  }
  const d = new Date();
  return { source: 'CARE' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0'), weekdays };
}

/* 勤務表: 職員 30名（訪問 18・施設 9・通所 3）。1日に 15〜20名が出勤するように回す */
const SEI = ['見本', '試験', '架空', '仮名', '模擬', '例題'];
const MEI = ['甲', '乙', '丙', '丁', '戊'];
const STAFF_N = 30;
function buildStaff() {
  const out = [];
  for (let i = 0; i < STAFF_N; i++) {
    const div = i < 18 ? '訪問' : (i < 27 ? '施設' : '通所');
    out.push({ id: 'st' + String(i + 1).padStart(2, '0'), name: `${SEI[i % SEI.length]} ${MEI[Math.floor(i / SEI.length) % MEI.length]}`,
      group: div === '訪問' ? 'visit' : 'day', mainDivision: div, active: true, status: '在職' });
  }
  return out;
}
const DAY_CODES = ['早', '日1', '日2', '日3', '遅'];
function buildPlan(year, month0, staff) {
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells = {};
  staff.forEach((s, i) => {
    const c = {};
    for (let d = 1; d <= days; d++) {
      /* 7日のうち2日休み（職員ごとにずらす）。施設の2名は夜勤の入り・明け */
      const off = ((d + i) % 7 === 0) || ((d + i * 3) % 7 === 3);
      if (off) { c[String(d)] = '休'; continue; }
      if (s.mainDivision === '施設' && i % 9 === 0) { c[String(d)] = d % 2 ? '(21' : '7)'; continue; }
      c[String(d)] = DAY_CODES[(d + i) % DAY_CODES.length];
    }
    cells[s.id] = c;
  });
  return { cells, meta: {} };
}

function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
export function seed() {
  const staff = buildStaff();
  const master = buildMaster();
  const care = careDb();
  const out = { care_schedule_v2: care, ws_weekly_master_v1: master, staff };
  const now = new Date();
  for (const off of [-1, 0, 1]) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    out['sched:' + ym(d) + ':plan'] = buildPlan(d.getFullYear(), d.getMonth(), staff);
  }
  return out;
}

const shared = createKv(seed());
export const kv = shared.kv;
export const stats = shared.stats;
export function respond(body) { return shared.respond(body); }
/* 道具ごとに新しい見本を作りたい時（1回の計測ごとに初期状態へ戻す等） */
export function freshKv() { return createKv(seed()); }
