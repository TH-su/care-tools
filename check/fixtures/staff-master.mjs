/* check/fixtures/staff-master.mjs — 職員マスタの委員会タブの紙を、架空の職員3名で撮るための材料（2026-11-06 新設）
 *
 * 使い方は check/fixtures/care-schedule.mjs と同じ形（snap.mjs・tap-latency.mjs が読む）。
 *   storage … 開く前に端末へ入れる設定（接続先を架空の住所にする・事務所PCとして開く・切り替えスイッチは切）
 *   match   … 横取りする通信の住所（ネットへは出ない）
 *   respond(body) … 横取りした要求（職員マスタ GAS への POST 本文 {action, token, ...}）に返す応答
 *   routes  … match 以外に横取りするもの（su-backend.json を「切」で返す＝Google の道だけで動かす・
 *             ログインの確かめ su-app-gate.js に架空の事務所のアカウントで答える・
 *             施設情報は見本 facility-profile.sample.json・氏名の写し staff_names は空の一覧で答える）
 *   sheets  … 撮る帳票。委員会の紙は印刷部品（SUPrint）を使わないので、prepare（ページの中で紙を組む関数）で撮る
 *
 * ★架空データだけ（CLAUDE.md §2-1）。氏名は記号的な漢字の見本（見本 甲・架空 乙・試験 丙）。電話・住所は空。
 * ★GAS との通信の形には触れない。応答の形は gas/bound/staff-api/staff-api.gs の pingBody_・handleList_・
 *   handleGetCommittees_・handleGetEnums_・handleGetCorp_ を写しただけ。保存の要求には {ok:true} だけを返す。
 * ★委員会マスタは「古いサーバーの見え方」＝計算部品の既定の先頭9件で答える。画面は計算部品の既定で末尾を補って
 *   一覧を14件にし、「新しい係をサーバーに登録する（5件）」の経路も見える。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const calc = require('../../staff-master-calc.js');

/* 住所は画面の守り（CSP の connect-src）が通す Google の形にする。撮影の間は match に当たる要求を全部横取りする */
export const URL = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY-STAFF/exec';
export const match = 'https://script.google.com/macros/s/CHECK-FIXTURE-DUMMY-STAFF/**';
export const FLAGS_OFF = { supabase: { staff: false } };

/* ログインの確かめ（su-app-gate.js）: 職員マスタもログインして役割を確かめてから一覧を読む。
   resident-master.mjs と同じ架空の事務所のアカウント（example.invalid・本物の Supabase へは出ない） */
const SB = 'https://jhbernqawjrzqwrmqrih.supabase.co';
/* 架空の利用者 ID（resident-master.mjs と同じ値）。電話番号の形の検出（check の受入 A10）に当たらないよう区切りごとに書いて繋ぐ */
const CHECK_UID = ['00000000', '0000', '4000', '8000', '0000000c4eck'].join('-');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_JWT = b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u({ sub: CHECK_UID, email: 'check-office@example.invalid', role: 'authenticated', aal: 'aal1', exp: 4102444800 }) + '.check';
const FAKE_SESSION = JSON.stringify({
  access_token: FAKE_JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'check-refresh',
  user: { id: CHECK_UID, email: 'check-office@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
});

export const storage = {
  stfm_cfg: JSON.stringify({ url: URL, token: 'check-dummy', by: '検証PC' }),
  su_device_role: 'office',
  su_backend_flags: JSON.stringify(FLAGS_OFF),
  'sb-jhbernqawjrzqwrmqrih-auth-token': FAKE_SESSION,
};

/* 施設情報（facility-profile.json）は公開リポジトリに無い。equip-log.mjs と同じく見本を返す
   （手元の簡易サーバーで開いた時に 404＝コンソールのエラーを出さない） */
const SAMPLE_PROFILE = new globalThis.URL('../../facility-profile.sample.json', import.meta.url);
const PROFILE_ROUTE = {
  match: '**/facility-profile.json',
  async handle(route) {
    const fs = await import('node:fs');
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: fs.readFileSync(SAMPLE_PROFILE, 'utf8') });
  },
};

export const routes = [
  /* body は tap-latency.mjs が読む（先頭の1件を su-backend.json の応答に使う）。handle は snap.mjs が使う */
  { match: '**/su-backend.json*', body: FLAGS_OFF,
    handle: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FLAGS_OFF) }) },
  { match: SB + '/**',
    handle(route) {
      const u = route.request().url();
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(v) });
      if (/\/rest\/v1\/rpc\/my_account/.test(u)) return json({ role: 'office', mfa: false });
      if (/\/rest\/v1\/allowed_accounts/.test(u)) return json({ role: 'office', label: '' });
      if (/\/rest\/v1\/rpc\/app_access_mine/.test(u)) return json({ ok: true, role: 'office', rules: null, mine: null, updatedAt: null });
      /* 氏名の写し（su-staff-names.js）: 読みは空の一覧、書き込み（upsert）は受けたことにするだけ（どこにも残さない） */
      if (/\/rest\/v1\/staff_names/.test(u)) {
        if (route.request().method() === 'GET') return json([]);
        return route.fulfill({ status: 201, headers: cors, body: '' });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'PGRST202', message: 'check fixture: not served' }) });
    } },
  PROFILE_ROUTE,
];

/* ページの中で動く（snap.mjs が evaluate する）。一覧と委員会マスタを読み終えるのを待ち、委員会タブを開いて
   「🖨 印刷」と同じ printCmt で紙を組む（印刷のダイアログは開かない）。保存はしない。
   ★ページの中で動くので、この関数の外の変数は使えない（what は関数ごとに書く） */
export const sheets = [
  { key: 'cmt_both', ready: '#cmtPrintAll .cmt-pblk',
    prepare: async () => {
      for (let i = 0; i < 100 && !(typeof ST === 'object' && ST && ST.loaded && ST.cmtLoaded); i++) await new Promise((r) => setTimeout(r, 100));
      if (!(typeof ST === 'object' && ST && ST.loaded && ST.cmtLoaded) || typeof printCmt !== 'function') return false;
      showScreen('cmt');
      $('cmtPrintWhat').value = 'both';
      window.print = function () {};
      printCmt();
      return document.body.classList.contains('cmt-print');
    } },
  { key: 'cmt_docs', ready: '#cmtPrintDocs',
    prepare: async () => {
      for (let i = 0; i < 100 && !(typeof ST === 'object' && ST && ST.loaded && ST.cmtLoaded); i++) await new Promise((r) => setTimeout(r, 100));
      if (!(typeof ST === 'object' && ST && ST.loaded && ST.cmtLoaded) || typeof printCmt !== 'function') return false;
      showScreen('cmt');
      $('cmtPrintWhat').value = 'docs';
      window.print = function () {};
      printCmt();
      return document.body.classList.contains('cmt-print') && document.body.classList.contains('cmt-p-docs');
    } },
];

/* ── 架空の職員 3名（staff-api.gs の COL_STAFF の列から empInsNo を除いた形・withFiles_ を通した形） ── */
function staffRow(id, name, kana, jobTitle, committees) {
  return {
    id, rev: 1, updatedAt: '2026-01-05T09:00:00+09:00', updatedBy: '検証PC',
    legacyNo: '', name, kana, birthDate: '', gender: '', phone: '', address: '', emergencyJson: [],
    employmentType: 'regular', jobTitle, position: '',
    siteFacility: true, siteVisit: true, siteDay: true, siteCm: false, primarySite: 'facility', workStyle: '',
    hireDate: '2020-04-01', retireDate: '', onLeave: false, careStartDate: '',
    qualsJson: [], note: '',
    filesJson: [], siteRatiosJson: {},
    committeesJson: committees,
  };
}
export const STAFF = [
  staffRow('S0001', '見本 甲', 'ミホン コウ', '管理者', [{ code: 'abuse', role: 'chair' }, { code: 'infection', role: 'officer' }]),
  staffRow('S0002', '架空 乙', 'カクウ オツ', '介護職員', [{ code: 'abuse', role: 'officer' }, { code: 'accident', role: 'member' }]),
  staffRow('S0003', '試験 丙', 'シケン ヘイ', '看護職員', [{ code: 'abuse', role: 'member' }]),
];

/* 選択肢の既定（staff-api.gs の ENUM_DEFAULT_LABELS を defaultEnums_ の形にしたもの） */
const ENUM_DEFAULT_LABELS = {
  employmentType: [
    ['regular', '正社員'], ['contract', '契約社員'], ['part', 'パート'],
    ['officer', '役員兼使用人'], ['temp', '臨時'],
  ],
  qualCodes: [
    ['cw', '介護福祉士'], ['jitsumu', '実務者研修'], ['shonin', '初任者研修'],
    ['helper2', 'ヘルパー2級'], ['helper1', 'ヘルパー1級'], ['kiso', '基礎研修'],
    ['cm', '介護支援専門員'], ['nurse', '看護師'], ['anurse', '准看護師'],
    ['pt', '理学療法士'], ['ot', '作業療法士'], ['sw', '社会福祉士'],
    ['swshuji', '社会福祉主事'], ['pharm', '薬剤師'], ['dietitian', '管理栄養士'],
    ['cook', '調理師'], ['none', '無資格'], ['other', 'その他'],
  ],
};
const defaultEnums = () => {
  const out = {};
  for (const k of Object.keys(ENUM_DEFAULT_LABELS)) out[k] = ENUM_DEFAULT_LABELS[k].map(([code, label]) => ({ code, label }));
  return out;
};
/* 法人設定の既定（staff-api.gs の defaultCorp_） */
const defaultCorp = () => ({ activeSites: ['facility', 'visit', 'day'], kitchenSites: { facility: 50, day: 50 } });

const SCHEMA_VER = 1;   // staff-api.gs の SCHEMA_VER と同じ値
const VER = 1;

export function respond(body) {
  /* 疎通確認（apiPing）は GET ?action=ping で、本文が無いので snap.mjs からは {} で届く＝action が無ければ ping として答える */
  const a = (body && body.action) || 'ping';
  if (a === 'ping') {
    return { ok: true, ver: VER,
      caps: ['bulkSave', 'rev', 'lock', 'auth', 'dryRun', 'secure', 'import', 'files', 'enums', 'reqId', 'corp', 'editorverify', 'siteRatio', 'committee'],
      authRequired: true, schemaVer: SCHEMA_VER, build: 'check-fixture' };
  }
  if (a === 'list') return { ok: true, ver: VER, rows: JSON.parse(JSON.stringify(STAFF)) };
  if (a === 'getCommittees') {
    return { ok: true, ver: VER, committeesAt: '',
      committees: JSON.parse(JSON.stringify(calc.COMMITTEE_DEFAULTS.slice(0, 9))),
      externals: {}, usage: {} };
  }
  if (a === 'getEnums') return { ok: true, ver: VER, enums: defaultEnums(), usage: {}, enumsAt: '' };
  if (a === 'getCorp') return { ok: true, ver: VER, corp: defaultCorp(), isDefault: true, corpAt: '', corpBy: '' };
  return { ok: true, ver: VER };
}
