/* 入居者マスタ（resident-master.html）── 最後に直した人の試験（2026-10-10 新設・監査10月版 第2版 入居者マスタ 第2手）
   実行: node check/unit/master_updated_by_test.js
   守ること:
     ①保存（saveResident）で updatedBy（誰が）と updatedByAt（その保存の updatedAt）を記録に載せる
     ②詳細画面に「入居者マスタで最後に直した人：誰（日時）」を出し、updatedAt とずれていたら「別の経路で更新」と添える。紙には出さない
     ③誰が＝ログイン中ならアカウント、未ログイン・ログアウトは端末の役割名、確かめられない時は前の値のまま
   ★氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.RM_HTML || path.join(ROOT, 'resident-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(name) {
  const h = SRC.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = SRC.indexOf('{', h), d = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(h, i + 1); } }
}
function box(role, extra) {
  const store = Object.assign({ su_device_role: role || 'office' }, extra || {});
  const b = { localStorage: { getItem: k => (k in store ? store[k] : null), key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
    window: {}, Promise, Date, String, Math, isFinite, setTimeout, Array, Object, DEVICE_KEY: 'su_device_role' };
  vm.createContext(b);
  vm.runInContext([cutF('getDeviceRole'), cutF('esc'), cutF('mcHasLogin_'), 'var rmWhoAcct_=\'\', rmWhoGen_=0;',
    cutF('rmWho_'), cutF('rmWhoLabel_'), cutF('rmResolveWho_'), cutF('rmEditedFmt_'), cutF('rmEditedHtml_')].join('\n'), b);
  return b;
}

console.log('\n— 1. 保存で記録に載せる —');
{
  const sv = cutF('saveResident');
  t('updatedAt を決めた直後に updatedBy と updatedByAt（＝同じ updatedAt）を載せる', /rec\.updatedAt=new Date\(\)\.toISOString\(\);\s*if\(typeof rmWho_==='function'\)\{ rec\.updatedBy=rmWho_\(\); rec\.updatedByAt=rec\.updatedAt; \}/.test(sv), '');
  t('載せるのは送る record の中（GAS が dataJson に丸ごと残す）', sv.indexOf("var body={action:'saveResident',record:rec};") > sv.indexOf('rec.updatedBy='), '');
}

console.log('\n— 2. 詳細画面の表示 —');
{
  const b = box();
  const at = new Date(2026, 9, 10, 9, 5).toISOString();
  const h1 = b.rmEditedHtml_({ updatedAt: at, updatedBy: 'staff-a', updatedByAt: at });
  t('「詳細画面の『保存』で最後に直した人：誰（年/月/日 時:分）」と、含まないものの注記', h1.indexOf('<p class="rm-edited">詳細画面の「保存」で最後に直した人：staff-a（2026/10/10 09:05）') === 0 && /一括編集・食形態一覧・訪問診療からの定期薬の更新は含みません/.test(h1), h1);
  const earlier = new Date(2026, 9, 10, 8, 0).toISOString();
  t('updatedAt の方が古い（updatedAt を進めない経路）時は「その後…」を付けない', b.rmEditedHtml_({ updatedAt: earlier, updatedBy: 'staff-a', updatedByAt: at }).indexOf('その後') < 0, '');
  const later = new Date(2026, 9, 10, 11, 30).toISOString();
  const h2 = b.rmEditedHtml_({ updatedAt: later, updatedBy: 'staff-a', updatedByAt: at });
  t('updatedAt とずれていたら「その後 …に別の経路で更新」と添える', /staff-a（2026\/10\/10 09:05）。その後 2026\/10\/10 11:30 に、薬の変更候補の反映など別の経路で更新されています/.test(h2), h2);
  const h3 = b.rmEditedHtml_({ updatedAt: new Date(new Date(at).getTime() + 500).toISOString(), updatedBy: 'staff-a', updatedByAt: at });
  t('1秒未満のずれ（シートの日付変換）は同じ保存とみなす', h3.indexOf('別の経路') < 0, h3);
  const h4 = b.rmEditedHtml_({ updatedAt: at });
  t('直した人の記録が無い古い保存は「詳細画面の最後の保存：日時（記録はありません）」', h4 === '<p class="rm-edited">詳細画面の最後の保存：2026/10/10 09:05（誰が直したかの記録はありません）</p>', h4);
  t('日時が無ければ何も出さない', b.rmEditedHtml_({}) === '' && b.rmEditedHtml_(null) === '', '');
  const h5 = b.rmEditedHtml_({ updatedAt: at, updatedBy: '<b>x</b>', updatedByAt: at });
  t('名前は HTML として扱わない（エスケープ）', h5.indexOf('<b>') < 0 && h5.indexOf('&lt;b&gt;') >= 0, h5);
  const rv = cutF('renderView');
  t('詳細画面（renderView）で、各アプリへのリンクの下に出す', /h\+=perResidentLinksHtml\(r\);\s*h\+=rmEditedHtml_\(r\);/.test(rv), '');
  t('紙には出さない（@media print で隠す）', /@media print\{\.rm-edited\{display:none !important\}\}/.test(SRC), '');
}

console.log('\n— 3. 誰が —');
(async () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function run(role, session, check, pre) {
    const b = box(role, session ? { 'sb-abc123-auth-token': 'x' } : {});
    b.window.SUAuth = { check: () => Promise.resolve(check) };
    b.msAuthLoad_ = () => Promise.resolve();
    if (pre) b.rmWhoAcct_ = pre;
    b.rmResolveWho_();
    for (let i = 0; i < 5; i++) await tick();
    return b;
  }
  let b = await run('office', true, { status: 'ok', email: 'staff-a@example.test', label: '' });
  t('ログイン中はアカウント（@ より前）', b.rmWho_() === 'staff-a', b.rmWho_());
  b = await run('office', true, { status: 'ok', email: 'staff-a@example.test', label: '架空 管理' });
  t('表示名があれば「表示名（アカウント）」', b.rmWho_() === '架空 管理（staff-a）', b.rmWho_());
  b = await run('office', false, null, 'staff-a');
  t('ログアウト（控えが無い）は役割名「事務所PC」へ戻す', b.rmWho_() === '事務所PC', b.rmWho_());
  b = await run('field', false, null);
  t('現場の端末の役割名は「現場端末」', b.rmWho_() === '現場端末', b.rmWho_());
  b = await run('office', true, { status: 'error' }, 'staff-a');
  t('確かめられない時は前の名前のまま', b.rmWho_() === 'staff-a', b.rmWho_());
  b = await run('office', true, { status: 'denied', email: 'x@example.test' }, 'staff-a');
  t('許可リスト外は役割名', b.rmWho_() === '事務所PC', b.rmWho_());
  t('起動時・別タブのログイン/ログアウト・画面に戻った時に取り直す',
    /addEventListener\('DOMContentLoaded',function\(\)\{ try\{ rmResolveWho_\(\); \}/.test(SRC) && /addEventListener\('storage',function\(e\)\{ if\(e\.key===null \|\| \/\^sb-\[a-z0-9\]\+-auth-token\$\/\.test\(e\.key\|\|''\)\)\{ try\{ rmResolveWho_\(\);/.test(SRC) && /visibilitychange',function\(\)\{ if\(!document\.hidden\)\{ try\{ rmResolveWho_\(\);/.test(SRC), '');
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
