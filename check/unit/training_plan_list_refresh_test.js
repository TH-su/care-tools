/* training_plan_list_refresh_test.js — 個別機能訓練計画書（training-plan.html）で、一覧へ移った時と
   保存が索引に届いた時に一覧が描き直されることを確かめる（2026-10-15 本人承認）。
   下の「一覧」タブは画面を切り替えるだけで描き直さず、編集画面で変えた内容（止める指定など）が
   左上の「一覧へ戻る」か「最新を読み込む」を押すまで一覧に出なかった。
   画面の関数を切り出して Node の vm で【実際に動かす】（字面だけで確かめない）。
   対象HTMLは環境変数 TP_HTML で差し替えられる。
     TP_HTML=/path/to/training-plan.html node check/unit/training_plan_list_refresh_test.js
   ★データはすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.TP_HTML || path.join(__dirname, '..', '..', 'training-plan.html');
const S = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
}
const grab = (re) => (S.match(re) || [])[0] || '';

/* 画面の部品を偽物にした箱。shown＝いま出ている画面、busy＝一括作成中か */
function box(shown, busy) {
  const log = { render: 0, show: [], chip: 0, toast: [] };
  const els = {};
  const el = (id) => els[id] || (els[id] = { classList: { contains: (c) => c === 'on' && id === shown() } });
  const sb = {
    log: log, IDX_PENDING: {}, CFG: { url: 'https://example.invalid/exec' }, BULK: null,
    $: el, batchBusy: () => busy(), renderList: () => { log.render++; }, renderIndexChip: () => { log.chip++; },
    toast: (m) => { log.toast.push(m); }, errText: (e) => String(e), indexRowOf: () => ({ count: 1 }),
    saveIndex: (fn) => { const idx = { rows: {} }; fn(idx); return Promise.resolve(idx); },
    showScreen: (id) => { log.show.push(id); }
  };
  vm.createContext(sb);
  return sb;
}

console.log('\n【1】下のタブで一覧へ移った時に描き直す');
{
  const NAV = grab(/  var nav = document\.querySelectorAll\('\.bnav button'\);\n  for \(var i = 0; i < nav\.length; i\+\+\) \{[\s\S]*?\n  \}\n/);
  t('下のタブの処理を切り出せた', NAV.length > 100, NAV.length);
  let busy = false;
  const sb = box(() => '', () => busy);
  const btns = ['scr-list', 'scr-edit', 'scr-print', 'scr-settings'].map(function (id) {
    return { id: id, h: null, getAttribute: () => id, addEventListener: function (ev, f) { if (ev === 'click') this.h = f; } };
  });
  sb.document = { querySelectorAll: () => btns };
  try { vm.runInContext(NAV, sb); } catch (e) { t('下のタブの処理が動く', false, String(e)); }
  const click = (id) => { const b = btns.find((x) => x.id === id); if (b && b.h) b.h.call(b); };
  click('scr-edit');
  t('編集タブ: 画面を移り、一覧は描かない', sb.log.show.join() === 'scr-edit' && sb.log.render === 0, sb.log);
  click('scr-print'); click('scr-settings');
  t('印刷・設定タブでも一覧は描かない', sb.log.render === 0, sb.log);
  click('scr-list');
  t('★一覧タブ: 画面を移ってから一覧を描き直す', sb.log.show[sb.log.show.length - 1] === 'scr-list' && sb.log.render === 1, sb.log);
  busy = true;
  click('scr-list');
  t('一括作成中は移らず・描かず、知らせだけ出す（従来どおり）', sb.log.render === 1 && sb.log.show.length === 4 && sb.log.toast.length === 1, sb.log);
}

console.log('\n【2】保存が索引に届いた時、一覧が出ていれば描き直す');
{
  const FN = grab(/function updateIndexFor\(masterId, doc\) \{[\s\S]*?\n\}/);
  t('updateIndexFor を切り出せた', FN.length > 100, FN.length);
  async function run(shownId, busy, failSave, tweak) {
    const sb = box(() => shownId, () => busy);
    if (failSave) sb.saveIndex = () => Promise.reject(new Error('net'));
    if (tweak) tweak(sb);
    vm.runInContext(FN, sb);
    const r = await vm.runInContext('updateIndexFor("tp0001", { plans: [] })', sb);
    return { r: r, log: sb.log };
  }
  (async function () {
    const a = await run('scr-list', false, false);
    t('★一覧が出ている時は描き直す', a.r === true && a.log.render === 1 && a.log.chip === 1, a);
    const b = await run('scr-edit', false, false);
    t('編集画面にいる時は描き直さない', b.r === true && b.log.render === 0 && b.log.chip === 1, b);
    const c = await run('scr-list', true, false);
    t('一括作成中は描き直さない（最後にまとめて描く）', c.r === true && c.log.render === 0, c);
    const d = await run('scr-list', false, true);
    t('索引の保存に失敗した時は今までどおり知らせて描き直さない', d.r === false && d.log.render === 0 && d.log.toast.length === 1, d);
    const e = await run('scr-list', false, false, (sb) => { sb.BULK = { running: true }; });
    t('まとめて取込の間は描き直さない（最後にまとめて描く）', e.r === true && e.log.render === 0, e);
    const f = await run('scr-list', false, false, (sb) => { sb.BULK = { running: false }; });
    t('まとめて取込が終わった後は描き直す', f.r === true && f.log.render === 1, f);
    let pend = null;
    const g = await run('scr-list', false, false, (sb) => { sb.renderList = () => { throw new Error('描画の失敗'); }; pend = sb.IDX_PENDING; });
    t('★描き直しで例外が出ても「索引の保存に失敗」扱いにしない', g.r === true && g.log.toast.length === 0 && !pend.tp0001, { g: g, pend: pend });

    console.log('\n【3】ほかの経路は今までどおり');
    t('「一覧へ戻る」は描き直しを続ける', /if \(to === 'scr-list'\) renderList\(\);\n  \}\);\n  \$\('listSort'\)/.test(S));
    const BK = grab(/function bkRunAll\([\s\S]*?\n\}/);
    t('まとめて取込の終わりの描き直しは残っている', /'完了：成功 '[\s\S]*renderList\(\);/.test(BK), BK.length);
    t('担当者の一括修正の終わりの描き直しは残っている', /if \(write\) \{ renderList\(\); toast\('担当者の一括修正が終わりました'\); \}/.test(S));

    console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
    process.exit(fail ? 1 : 0);
  })().catch(function (e) { console.log('  ✗ 例外: ' + e); process.exit(1); });
}
