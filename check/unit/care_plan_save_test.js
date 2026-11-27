/* 週間計画（care-schedule.html）── 予約の保存（SIM.savePlan）が、端末に書けなかった時に「保存しました」と出さない試験（2026-11-28 新設・保存の穴の直し）
   実行: node check/unit/care_plan_save_test.js（環境変数 CS_HTML で別の版を当てられる）
   守りたいこと:
     1. 端末への保存（csPlanCommit_）が失敗した時は「…からの計画（予約）を保存しました」を出さない
     2. 失敗した時も、作った予約は画面のメモリ（DB）に残る（「💾 保存」で書き直せる・編集が消えない）。描き直しはする。
        砂場の控えは閉じた時に消えるので、メモリだけの未送信の印（SYNC._dirty）を立てて裏の取得が上書きしないようにする
     3. 保存できた時は今までどおり「保存しました」を出す
   やり方: HTML から savePlan の本文だけを切り出し、周りの関数を偽物にして vm で動かす（データは架空・氏名なし）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const A = SRC.indexOf('  async savePlan() {'), B = SRC.indexOf('  /* 予約の編集の中で、開始日・介護度・メモを変える */', A);
if (A < 0 || B < 0) throw new Error('savePlan が見つかりません');
const BODY = SRC.slice(A, B).replace(/,\s*$/, '');

function run(commitOk) {
  const toasts = [], log = [];
  const resv = { id: 'r1', careLevel: '要介護1', events: [{ id: 'e1' }], nextPlans: [] };
  const ctx = {
    JSON, Promise, Date, String, Array, Object, Math,
    SIM_ON: true, LS_KEY: 'cs_db',
    DB: { residents: [{ id: 'r1', careLevel: '要介護2', events: [{ id: 'e9' }] }] },
    localStorage: { getItem: () => JSON.stringify({ residents: [JSON.parse(JSON.stringify(resv))] }) },
    csPlanCalc_: () => ({ NOTE_MAX: 200, sortPlans: (l) => l }),
    suGetDeviceRole: () => 'office',
    csNote_: (w, e) => log.push('note:' + w),
    csPlanSaveBlock_: () => '',
    SUDialog: { alert: (m) => { log.push('alert:' + m); return Promise.resolve(); } },
    csPlanServerRes_: () => Promise.resolve({ ok: false }),
    SYNC: { _dirty: false, hasTarget: () => false, pull: () => Promise.resolve(), markDirty() { log.push('markDirty'); } },
    csWho_: () => 'x',
    csPlanNewId_: () => 'p1',
    csPlanCommit_: (what) => { log.push('commit:' + what); return commitOk; },
    csSetSelection_: () => log.push('select'),
    populateResidentSelect: () => log.push('render'), renderResidentList() {}, renderAll() {},
    showToast: (m) => toasts.push(m),
    csPlanYmdJa_: (d) => d
  };
  vm.createContext(ctx);
  vm.runInContext('var O = {\n' + BODY + '\n};', ctx);
  const self = {
    kind: 'plan', plan: { resId: 'r1', isNew: true, from: '2026-12-01', note: '' },
    exit() { log.push('exit'); ctx.DB = { residents: [JSON.parse(JSON.stringify(resv))] }; return Promise.resolve(); }
  };
  return ctx.O.savePlan.call(self).then(() => ({ toasts, log, db: ctx.DB, dirty: ctx.SYNC._dirty }));
}

(async () => {
  console.log('\n— 予約の保存の知らせ —');
  {
    const r = await run(false);
    t('端末に書けなかった時は「…からの計画（予約）を保存しました」を出さない', !r.toasts.some((m) => /保存しました/.test(m)), r.toasts);
    const p = r.db.residents[0].nextPlans;
    t('… 作った予約は画面のメモリに残る（「💾 保存」で書き直せる・編集が消えない）', p.length === 1 && p[0].from === '2026-12-01' && p[0].events[0].id === 'e9', p);
    t('… 描き直しはする（画面のメモリの予約を見せる）', r.log.indexOf('render') > r.log.indexOf('commit:予約を保存'), r.log);
    t('… メモリだけの未送信の印を立てる（砂場の控えは消えているので、裏の取得が古い姿でメモリの予約を上書きしないように・端末に残る印 markDirty は使わない）', r.dirty === true && r.log.indexOf('markDirty') < 0, r.log);
  }
  {
    const r = await run(true);
    t('保存できた時は今までどおり「2026-12-01からの計画（予約）を保存しました」を出す（未送信の印はここでは立てない＝送る道は今までどおり）', r.toasts.length === 1 && r.toasts[0] === '2026-12-01からの計画（予約）を保存しました。その日から今の計画になります' && r.dirty === false, r.toasts);
  }
  console.log(`\n${pass} 件合格 / ${fail} 件不合格`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験が途中で止まりました: ' + (e && e.stack || e)); process.exit(1); });
