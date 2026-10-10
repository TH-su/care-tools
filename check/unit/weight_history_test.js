/* 体重管理（weight-record.html）の「直した記録の変更前の値」と「記録した人の取り直し」の試験（2026-10-10・監査10月版 第2版 7）。
   守りたいこと:
     A 直すたびに、いつ・誰が・どの項目を何から何へ、をその記録の history（JSON の文字）に新しい順で5件まで残す。変わっていなければ残さない
     B 記録を直す6か所（まとめ入力・個別入力・編集・車椅子の重さの再計算・入居者の統合2か所）のすべてで残す
     C 個別画面の一覧に、記録した人・直した人・変更の履歴を出す（文字はすべてエスケープ）。壊れた履歴でも止まらない
     D 記録した人は、ログイン・ログアウト・画面に戻った時に取り直す。ログアウトしたら役割の名前へ戻す。確かめられない時は前の値のまま
     E デイ利用表の「誰が」も同じく取り直す
   実行: node check/unit/weight_history_test.js（WEIGHT_HTML・DCR_HTML で別のファイルを当てられる）
   架空データのみ。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.WEIGHT_HTML || path.join(ROOT, 'weight-record.html'), 'utf8');
const DCR = fs.readFileSync(process.env.DCR_HTML || path.join(ROOT, 'daycare-roster.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h), q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(h, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const decl = (src, name) => { const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*(.+)$', 'm').exec(src); if (!m) throw new Error('宣言なし ' + name); return 'var ' + name + ' = ' + m[1]; };
const tick = () => new Promise(r => setImmediate(r));

const box = { JSON, Math, Date, Number, String, Array, Object, console, isFinite, WHO: '事務所PC' };
vm.createContext(box);
vm.runInContext([decl(SRC, 'WR_HIST_MAX'), decl(SRC, 'WR_HIST_KEYS'),
  SRC.slice(SRC.indexOf('var WR_HIST_LABEL'), SRC.indexOf('};', SRC.indexOf('var WR_HIST_LABEL')) + 2),
  'function wrWho_(){ return WHO; }', /^function escapeHtml\(s\)\{.*\}$/m.exec(SRC)[0], cut(SRC, 'wrHistOf_'), cut(SRC, 'wrSnap_'), cut(SRC, 'wrPushHist_'),
  cut(SRC, 'wrHistVal_'), cut(SRC, 'wrHistHtml_')].join('\n'), box, { filename: 'weight-record(切り出し)' });

console.log('\n— A. 変更前の値を残す —');
{
  const r = { id: 'x1', residentId: 'r1', yearMonth: '2026-10', measuredOn: '2026-10-01', weight: 50.2, measureMode: 'stand', note: '' };
  let b = box.wrSnap_(r);
  r.weight = 49.8; box.wrPushHist_(r, b, '2026-10-02T01:00:00Z');
  let h = box.wrHistOf_(r);
  t('★体重を直すと1件残る（いつ・誰が・何を何から何へ）', h.length === 1 && h[0].by === '事務所PC' && h[0].at === '2026-10-02T01:00:00Z' &&
    h[0].ch.length === 1 && h[0].ch[0].k === 'weight' && h[0].ch[0].f === 50.2 && h[0].ch[0].t === 49.8, h);
  t('★履歴は JSON の文字で持つ（GAS のシートのセルに入る形）', typeof r.history === 'string');
  b = box.wrSnap_(r); box.wrPushHist_(r, b);
  t('★何も変わっていなければ残さない', box.wrHistOf_(r).length === 1);
  for (let i = 0; i < 6; i++) { b = box.wrSnap_(r); box.WHO = 'staff' + i; r.weight = 40 + i; box.wrPushHist_(r, b, '2026-10-1' + i + 'T00:00:00Z'); }
  h = box.wrHistOf_(r);
  t('★5件までで、新しい順（古い方を落とす）', h.length === 5 && h[0].by === 'staff5' && h[4].by === 'staff1', h.map(x => x.by));
  const r2 = { id: 'x2', weight: 50, measuredOn: null };
  b = box.wrSnap_(r2); r2.measuredOn = '2026-10-03'; r2.note = 'メモ'; box.wrPushHist_(r2, b);
  t('空から値を入れた項目も残す（2項目）', box.wrHistOf_(r2)[0].ch.map(c => c.k).join(',') === 'measuredOn,note', box.wrHistOf_(r2)[0].ch);
  t('壊れた履歴の文字は空として扱う（止まらない）', box.wrHistOf_({ history: '{壊れ' }).length === 0 && box.wrHistOf_({ history: 12 }).length === 0);
  const r3 = { id: 'x3', weight: 50, history: '{壊れ' }; b = box.wrSnap_(r3); r3.weight = 51; box.wrPushHist_(r3, b);
  t('壊れた履歴があっても、新しい変更は残せる', box.wrHistOf_(r3).length === 1);
}

console.log('\n— B. 直す6か所の結線 —');
{
  const snaps = (SRC.match(/const _hb = wrSnap_\(/g) || []).length;
  const pushes = (SRC.match(/wrPushHist_\((existing|editing|x|rec), _hb/g) || []).length;
  t('★変更前の値を取る所が6か所', snaps === 6, snaps);
  t('★変更前の値を残す所が6か所（取った値と組になっている）', pushes === 6, pushes);
  t('記録者（updatedBy）を書く所はすべて、変更前の値も残す', (SRC.match(/updatedBy\s*=\s*wrWho_\(\)/g) || []).length === (SRC.match(/wrPushHist_\(/g) || []).length - 1,
    [(SRC.match(/updatedBy\s*=\s*wrWho_\(\)/g) || []).length, (SRC.match(/wrPushHist_\(/g) || []).length]);
}

console.log('\n— C. 個別画面の表示 —');
{
  const r = { id: 'x1', weight: 49.8, note: '<b>x</b>' };
  const b = box.wrSnap_(r); box.WHO = '<img src=x onerror=alert(1)>'; r.note = '<script>alert(1)</script>'; r.weight = 48.1; box.wrPushHist_(r, b, '2026-10-05T03:04:00Z');
  const html = box.wrHistHtml_(r);
  t('★履歴の文字はすべてエスケープする（記録者名・メモ）', !/<script>|<img/.test(html) && /&lt;script&gt;/.test(html) && /&lt;img/.test(html), html);
  t('体重は kg で、何から何へ', /体重 49\.8kg→48\.1kg/.test(html), html);
  t('件数つきの畳める形', /<details class="wr-hist"><summary>変更の履歴 1件<\/summary>/.test(html));
  t('履歴が無ければ何も出さない', box.wrHistHtml_({ id: 'y' }) === '');
  const mv = { id: 'm', residentId: 'r1' }; const bm = box.wrSnap_(mv); mv.residentId = 'r2'; box.WHO = '事務所PC'; box.wrPushHist_(mv, bm);
  t('入居者の付け替えは、中の番号を出さずに「入居者の付け替え」とだけ出す', /入居者の付け替え/.test(box.wrHistHtml_(mv)) && !/r1|r2/.test(box.wrHistHtml_(mv)));
  const hist = cut(SRC, 'drawHist');
  t('★一覧に記録した人・直した人を出す（エスケープ）', /r\.recordedBy \? \('記録 ' \+ r\.recordedBy\)/.test(hist) && /escapeHtml\(whoTxt\)/.test(hist) && /wrHistHtml_\(r\)/.test(hist));
  t('印刷の手書きの「記録者」欄は変えない', /<span>記録者：　　　　　　　　　　　<\/span>/.test(SRC));
}

console.log('\n— D. 記録した人の取り直し（体重）—');
(async () => {
  {
    const ls = new Map();
    let reply = { status: 'ok', email: 'staff-a@example.jp', label: '' };
    const wb = { JSON, Promise, console, WR_SESSION_KEY: 'sb-jhbernqawjrzqwrmqrih-auth-token',
      localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null) },
      wrAuthLoad_: () => Promise.resolve(), wrIsField: () => false, window: {} };
    wb.SUAuth = { check: () => Promise.resolve(reply) }; wb.window.SUAuth = wb.SUAuth;
    vm.createContext(wb);
    vm.runInContext(['var wrWhoAcct_ = "";', 'var wrWhoGen_ = 0;', cut(SRC, 'wrWho_'), cut(SRC, 'wrWhoLabel_'), cut(SRC, 'wrResolveWho_')].join('\n'), wb);
    wb.wrResolveWho_(); await tick(); await tick();
    t('ログインの控えが無ければ役割の名前', wb.wrWho_() === '事務所PC');
    ls.set(wb.WR_SESSION_KEY, '{}'); wb.wrResolveWho_(); await tick(); await tick();
    t('ログインするとアカウントの名前', wb.wrWho_() === 'staff-a', wb.wrWho_());
    reply = { status: 'ok', email: 'staff-b@example.jp', label: '' }; wb.wrResolveWho_(); await tick(); await tick();
    t('★人が替わったら取り直す', wb.wrWho_() === 'staff-b', wb.wrWho_());
    ls.delete(wb.WR_SESSION_KEY); wb.wrResolveWho_(); await tick(); await tick();
    t('★ログインの控えが消えたら（別のタブでログアウト）、アカウントの名前を捨てて役割の名前', wb.wrWho_() === '事務所PC', wb.wrWho_());
    ls.set(wb.WR_SESSION_KEY, '{}'); wb.wrResolveWho_(); await tick(); await tick();
    reply = { status: 'error' }; wb.wrResolveWho_(); await tick(); await tick();
    t('★確かめられない時（通信など）は前の値のまま', wb.wrWho_() === 'staff-b', wb.wrWho_());
    reply = { status: 'signed_out' }; wb.wrResolveWho_(); await tick(); await tick();
    t('★ログアウトしたら役割の名前へ戻す', wb.wrWho_() === '事務所PC', wb.wrWho_());
    /* 遅れて届いた古い結果を捨てる */
    ls.set(wb.WR_SESSION_KEY, '{}');
    let release; wb.SUAuth.check = () => new Promise(r => { release = r; });
    wb.wrResolveWho_(); await tick(); await tick(); const oldRelease = release;
    wb.SUAuth.check = () => Promise.resolve({ status: 'ok', email: 'new-user@example.jp' });
    wb.wrResolveWho_(); await tick(); await tick();
    oldRelease({ status: 'ok', email: 'old-user@example.jp' }); await tick(); await tick();
    t('★遅れて届いた古い確認の結果で上書きしない', wb.wrWho_() === 'new-user', wb.wrWho_());
    t('★別のタブでのログイン・ログアウトと、画面に戻った時に取り直す（結線）',
      /addEventListener\('storage', function\(e\)\{ if\(e\.key === WR_SESSION_KEY \|\| e\.key === null\)\{ try\{ wrResolveWho_\(\);/.test(SRC) &&
      /addEventListener\('visibilitychange', function\(\)\{ if\(!document\.hidden\)\{ try\{ wrResolveWho_\(\);/.test(SRC));
  }

  console.log('\n— E. デイ利用表の「誰が」の取り直し —');
  {
    const ls = new Map();
    let reply = { status: 'ok', email: 'staff-a@example.jp' };
    const db = { JSON, Promise, console, localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null) },
      dcrAuthLoad_: () => Promise.resolve(), dcrIsField_: () => false, window: {} };
    db.SUAuth = { check: () => Promise.resolve(reply) }; db.window.SUAuth = db.SUAuth;
    vm.createContext(db);
    vm.runInContext([decl(DCR, 'DCR_SESSION_KEY'), 'var dcrWhoAcct_ = "", dcrWhoGen_ = 0;', cut(DCR, 'dcrWho_'), cut(DCR, 'dcrResolveWho_')].join('\n'), db);
    ls.set(db.DCR_SESSION_KEY, '{}'); db.dcrResolveWho_(); await tick(); await tick();
    t('ログインするとアカウントの名前', db.dcrWho_() === 'staff-a', db.dcrWho_());
    reply = { status: 'error' }; db.dcrResolveWho_(); await tick(); await tick();
    t('確かめられない時は前の値のまま', db.dcrWho_() === 'staff-a');
    reply = { status: 'signed_out' }; db.dcrResolveWho_(); await tick(); await tick();
    t('★ログアウトしたら「事務所PC」へ戻す', db.dcrWho_() === '事務所PC', db.dcrWho_());
    t('★別のタブでのログイン・ログアウトと、画面に戻った時に取り直す（結線）',
      /addEventListener\('storage', function \(e\) \{ if \(e\.key === DCR_SESSION_KEY/.test(DCR) && /try \{ dcrResolveWho_\(\); \} catch \(e3\) \{\}/.test(DCR));
  }

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
