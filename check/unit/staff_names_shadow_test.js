/* 職員の氏名の写し（su-staff-names.js）── 不具合報告の伏せ字の名簿（2026-10-14 新設・代表者の依頼）
   実行: node check/unit/staff_names_shadow_test.js

   守ること:
     1 事務所・管理者でログインしている時だけ書く。現場の端末・現場の役割・未ログインでは何もしない
     2 写すのは 職員ID・氏名・フリガナ・在籍 の4つだけ（生年月日・連絡先などは送らない）。変わった行だけを書く
     3 端末に残すのは指紋と時刻だけ（氏名を残さない）。同じ内容は10分写し直さない。失敗は中身を返さない
     4 職員マスタは一覧を読み込んだ後に写す（退職済みは在籍 false）。写しの失敗で一覧を止めない
   ★氏名は架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-staff-names.js'), 'utf8');
const SM = fs.readFileSync(path.join(ROOT, 'staff-master.html'), 'utf8');

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  → ' + JSON.stringify(detail)); }
}

function mk(o) {
  o = o || {};
  const store = Object.assign({}, o.store || {});
  const calls = { select: 0, upsert: [] };
  const have = o.have || [];
  const box = {
    JSON, Object, String, Array, Promise, Date, Error,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { head: { appendChild() { throw new Error('読み込まない'); } }, createElement: () => ({}) },
    window: {}
  };
  box.window.SUAuth = {
    STATUS: { OK: 'ok' },
    check: () => Promise.resolve({ status: o.status || 'ok', role: o.role || 'office' }),
    client: () => ({
      from: () => ({
        select: () => { calls.select++; return Promise.resolve({ data: have, error: null }); },
        upsert: (rows, opt) => { calls.upsert.push([rows, opt]); return Promise.resolve({ error: o.upsertErr ? { message: '見本 太郎 を含む失敗' } : null }); }
      })
    })
  };
  vm.createContext(box);
  vm.runInContext(SRC, box);
  return { api: box.window.SUStaffNames, calls, store };
}
const LIST = [
  { id: 's1', name: '架空 一郎', kana: 'カクウ イチロウ', active: true, birthDate: '1980-01-01', phone: '000' },
  { id: 's2', name: '架空 花子', kana: 'カクウ ハナコ', active: false },
];

(async () => {
  console.log('\n— 1. 書く人・書かない人 —');
  {
    const a = mk();
    const r = await a.api.push(LIST);
    t('事務所: 2人とも新しく書く', r.status === 'ok' && r.inserted === 2 && a.calls.upsert.length === 1, r);
    for (const [label, opts] of [['現場の役割', { role: 'field' }], ['未ログイン', { status: 'signed_out' }], ['現場の端末', { store: { su_device_role: 'field' } }]]) {
      const b = mk(opts);
      const rb = await b.api.push(LIST);
      t(label + ': 何も書かない（読みもしない）', rb.status === 'skipped' && b.calls.upsert.length === 0 && b.calls.select === 0, rb);
    }
    const c = mk({ role: 'admin' });
    t('管理者: 書く', (await c.api.push(LIST)).status === 'ok' && c.calls.upsert.length === 1);
  }

  console.log('\n— 2. 写す中身 —');
  {
    const a = mk();
    await a.api.push(LIST);
    const rows = a.calls.upsert[0][0];
    t('写すのは 職員ID・氏名・フリガナ・在籍 だけ', rows.every(r => Object.keys(r).sort().join() === 'active,kana,name,source_id'), rows);
    t('退職は在籍 false', rows[1].active === false && rows[0].active === true, rows);
    t('同じ事業者・職員IDで上書きする（消さない）', a.calls.upsert[0][1].onConflict === 'tenant_id,source_id');
    const b = mk({ have: [{ source_id: 's1', name: '架空 一郎', kana: 'カクウ イチロウ', active: true }, { source_id: 's2', name: '架空 花子', kana: 'カクウ ハナコ', active: true }] });
    const rb = await b.api.push(LIST);
    t('変わった行だけを書く（s2 の在籍だけ）', rb.unchanged === 1 && rb.updated === 1 && b.calls.upsert[0][0].length === 1 && b.calls.upsert[0][0][0].source_id === 's2', [rb, b.calls.upsert]);
    const c = mk();
    const rc = await c.api.push([{ id: '', name: 'x' }, { id: 's9', name: 'あ'.repeat(81) }, { id: 's1', name: 'a' }, { id: 's1', name: 'b' }]);
    t('職員ID が無い・長すぎ・重複は写さない', rc.failed === 3 && c.calls.upsert[0][0].length === 1, rc);
  }

  console.log('\n— 3. 端末に残すもの・同じ内容・失敗 —');
  {
    const a = mk();
    await a.api.push(LIST);
    const kept = JSON.stringify(a.store);
    t('端末に氏名を残さない（指紋と時刻だけ）', kept.indexOf('架空') < 0 && /su_staff_names_last/.test(kept), kept);
    const again = await a.api.push(LIST);
    t('同じ内容は10分写し直さない', again.status === 'skipped' && again.reason === 'same' && a.calls.select === 1, again);
    const e = mk({ upsertErr: true });
    const re = await e.api.push(LIST);
    t('失敗は error を返し、中身（氏名を含みうる）は返さない', re.status === 'error' && JSON.stringify(re).indexOf('見本') < 0, re);
    t('失敗した時は指紋を残さない（次にもう一度写す）', JSON.stringify(e.store).indexOf('su_staff_names_last') < 0, e.store);
    t('空の一覧は写さない', (await mk().api.push([])).reason === 'empty');
  }

  console.log('\n— 4. 職員マスタの結線 —');
  t('部品を読み込む', /<script src="su-staff-names\.js\?v=2026-10-14"><\/script>/.test(SM));
  t('一覧を読み込んだ後に、退職済みを在籍 false にして写す・失敗で一覧を止めない',
    /renderList\(\);\n[^\n]*\n    try \{\n      if \(window\.SUStaffNames\) SUStaffNames\.push\(ST\.rows\.map\(function \(r\) \{\n        return \{ id: r\.id, name: r\.name, kana: r\.kana, active: statusInfo\(r\)\.k !== 'retired' \};\n      \}\)\);\n    \} catch \(e\) \{/.test(SM));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
