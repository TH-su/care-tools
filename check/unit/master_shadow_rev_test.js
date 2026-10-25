/* 入居者マスタの写し（su-master-shadow.js）が、写しの記録に正本の版数（stateRev・srev）を残す試験
   （移行 0019・2026-10-22・反証レビューの指摘・改善プロンプト第4弾の6）
   守りたいこと:
     1 記録（master_sync_runs）に、一覧と一緒に届いた版数を state_rev（数）・srev（文字）として残す。版数が無ければ null
     2 列の無い古いデータベース（0019 未適用）では、版数を外して今までどおりの記録を残し直す（写しは止めない）
     3 同じ内容を10分以内にもう一度写す時、版数が同じなら今までどおり何もしない・版数が進んでいれば記録を残し直す
     4 入居者マスタ（refreshRoster）は、その一覧の応答の stateRev と srev（srevPickMeta）を写しに渡す
   ★部品の本物を vm で動かす。偽物にするのは、ログインの状態・データベースの応答だけ。
   実行: node check/unit/master_shadow_rev_test.js
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-master-shadow.js'), 'utf8');
const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const ROSTER = [{ id: 'R001', name: '架空 一郎', kana: '', room: '101', gender: '男', careLevel: '要介護1', active: true, updatedAt: '', birthDate: '', height: '', dischargeDate: '' }];

function sandbox(cfg) {
  cfg = cfg || {};
  const ls = {}, inserts = [];
  const have = cfg.have || [];
  const from = table => ({
    select() { return Promise.resolve({ data: table === 'master_residents' ? have : [] }); },
    upsert() { return Promise.resolve({}); },
    insert(row) {
      inserts.push(row);
      if (cfg.noRevColumn && ('state_rev' in row || 'srev' in row)) return Promise.resolve({ error: { code: 'PGRST204', message: "Could not find the 'srev' column of 'master_sync_runs'" } });
      return Promise.resolve({ error: null });
    }
  });
  const win = {
    SUAuth: { STATUS: { OK: 'ok' }, check: () => Promise.resolve({ status: 'ok', role: 'office' }), client: () => ({ from }) },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
    document: { head: { appendChild() {} }, createElement: () => ({}) },
    Promise, Date, JSON
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'su-master-shadow.js' });
  return { M: win.SUMasterShadow, inserts, ls };
}

(async () => {
  {
    const s = sandbox();
    const r = await s.M.push(ROSTER, { stateRev: 41, srev: 1761100000000 });
    const run = s.inserts[0] || {};
    t('1 記録に版数を残す（state_rev は数・srev は文字）', r.status === 'ok' && s.inserts.length === 1 && run.state_rev === 41 && run.srev === '1761100000000', s.inserts);
    t('1 記録の件数の列は今までどおり', run.source_count === 1 && run.inserted === 1 && run.failed === 0);
    t('1 端末の控えには指紋・時刻・版数だけ（氏名を入れない）', !/架空/.test(s.ls.su_shadow_last) && /"rev":41/.test(s.ls.su_shadow_last), s.ls.su_shadow_last);
  }
  for (const [label, opts] of [['版数を渡さない（古い呼び方）', undefined], ['版数が数でない', { stateRev: '41', srev: 'x' }], ['版数が負・小数', { stateRev: -1, srev: -5 }], ['rev だけ', { stateRev: 7 }]]) {
    const s = sandbox();
    await s.M.push(ROSTER, opts);
    const run = s.inserts[0] || {};
    const wantRev = label === 'rev だけ' ? 7 : null;
    t('1 ' + label + ': 数でない版数は null で残す', run.state_rev === wantRev && run.srev === null, run);
  }
  {
    const s = sandbox({ noRevColumn: true });
    const r = await s.M.push(ROSTER, { stateRev: 41, srev: 1761100000000 });
    t('2 列の無い古いデータベースでは、版数を外して記録を残し直す', r.status === 'ok' && s.inserts.length === 2 && !('state_rev' in s.inserts[1]) && !('srev' in s.inserts[1]) && s.inserts[1].source_count === 1, s.inserts);
  }
  {
    const s = sandbox();
    await s.M.push(ROSTER, { stateRev: 41, srev: 1 });
    const r2 = await s.M.push(ROSTER, { stateRev: 41, srev: 1 });
    t('3 同じ内容・同じ版数を10分以内に写す時は今までどおり何もしない', r2.status === 'skipped' && r2.reason === 'same' && s.inserts.length === 1);
    const r3 = await s.M.push(ROSTER, { stateRev: 42, srev: 1 });
    t('3 同じ内容でも版数が進んでいれば記録を残し直す', r3.status === 'ok' && s.inserts.length === 2 && s.inserts[1].state_rev === 42);
    const r4 = await s.M.push(ROSTER, { stateRev: 42, srev: 2 });
    t('3 srev だけ進んだ時も記録を残し直す', r4.status === 'ok' && s.inserts.length === 3 && s.inserts[2].srev === '2');
  }
  {
    const s = sandbox();
    s.ls.su_shadow_last = JSON.stringify({ fp: '1:x', at: Date.now() });   // 版数を持たない古い控え
    const r = await s.M.push(ROSTER, { stateRev: 41, srev: 1 });
    t('3 版数を持たない古い控えの端末でも、版数つきの記録を残す', r.status === 'ok' && s.inserts.length === 1 && s.inserts[0].state_rev === 41);
  }
  t('4 入居者マスタは一覧の応答の stateRev と srev を写しに渡す',
    RM.indexOf("SUMasterShadow.push(roster,{stateRev:d&&d.stateRev,srev:srevPickMeta(d)})") >= 0);
  t('4 入居者マスタと写しの見比べは新しい版の部品を読む',
    /<script src="su-master-shadow\.js\?v=2026-10-24"><\/script>/.test(RM) && /<script src="su-master-shadow\.js\?v=2026-10-24"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'shadow-check.html'), 'utf8')));
  t('部品は console.log を使わない', !/console\.log/.test(SRC));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });
