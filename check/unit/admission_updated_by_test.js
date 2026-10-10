/* 入居調整（admission-flow.html）── 直した人と、端末どうしの統合の衝突の試験（2026-10-10 新設・監査10月版 第2版 入居調整 第2手）
   実行: node check/unit/admission_updated_by_test.js
   守ること:
     ①案件・タスク・アセスメントは updatedAt を進める所で updatedBy と updatedByAt（＝その時の updatedAt）を組で載せる。連絡記録は by
     ②表示は組がそろう時だけ（この機能を持たない古い端末の更新を、別の人の名前で取り違えない）
     ③統合（mergeDb）: 直した人は新しい方（土台）の組をそのまま使い、相手の名前を混ぜない。
       タスクは新しい方を1件ずつ採り、その直した人も一緒に運ぶ。連絡記録は両方残し、記録した人も残る
     ④統合の衝突の基本（2台が同じ案件の別の欄・別のタスク・別の連絡記録を触った時に、どれも消えない）
   ★氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.AF_HTML || path.join(ROOT, 'admission-flow.html'), 'utf8');
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
const line = re => { const m = re.exec(SRC); if (!m) throw new Error('行が見つかりません: ' + re); return m[0]; };
function box(extra) {
  const store = Object.assign({}, extra || {});
  const b = { localStorage: { getItem: k => (k in store ? store[k] : null), key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } },
    window: {}, Promise, Date, String, Math, Array, Object, JSON, setTimeout };
  vm.createContext(b);
  vm.runInContext([line(/var DB_V = [^\n]*/), line(/var CLEAR_META = \{[\s\S]*?\};/), line(/var CLEAR_MARK_RE = [^\n]*/),
    line(/var AF_SESSION_RE = [^\n]*/), "var afWhoAcct_ = '', afWhoGen_ = 0;",
    ...['nowIso', 'isObj', 'asObj', 'asArr', 'asStr', 'isBlankVal', 'clearHash', 'parseClearMark', 'pickClearMark', 'reviveMark', 'applyCleared',
        'mergeById', 'mergeShallowPreferFilled', 'mergeAssess', 'afPairFrom_', 'mergeCand', 'mergeDb',
        'afWho_', 'afWhoLabel_', 'afHasLogin_', 'afResolveWho_', 'afStamp_', 'afEditedBy_'].map(cutF)].join('\n'), b);
  return b;
}
const T0 = '2026-10-10T01:00:00.000Z', T1 = '2026-10-10T02:00:00.000Z', T2 = '2026-10-10T03:00:00.000Z';
const cand = (o) => Object.assign({ id: 'c1', name: '架空 一郎', stage: 'inquiry', stageDates: {}, family: [], contacts: [], tasks: [], log: [], nudges: [], assess: {}, deleted: false }, o);

console.log('\n— 1. 組で載せる・組がそろう時だけ出す —');
{
  const b = box();
  b.afWhoAcct_ = 'staff-a';
  const o = b.afStamp_({ updatedAt: T0 });
  t('afStamp_ は updatedBy と updatedByAt（＝updatedAt）を組で載せる', o.updatedBy === 'staff-a' && o.updatedByAt === T0, o);
  t('組がそろえば名前を返す', b.afEditedBy_(o) === 'staff-a', '');
  t('その後に古い端末が updatedAt だけ進めた（組がずれた）時は出さない', b.afEditedBy_({ updatedAt: T1, updatedBy: 'staff-a', updatedByAt: T0 }) === '', '');
  t('記録が無ければ出さない', b.afEditedBy_({ updatedAt: T0 }) === '' && b.afEditedBy_(null) === '', '');
  b.afWhoAcct_ = '';
  t('ログインしていなければ「事務所PC」', b.afWho_() === '事務所PC', b.afWho_());
}

console.log('\n— 2. 統合：直した人は新しい方の組（相手の名前を混ぜない）—');
{
  const b = box();
  const A = cand({ updatedAt: T2, updatedBy: 'staff-a', updatedByAt: T2, note: 'Aのメモ' });
  const B = cand({ updatedAt: T1, updatedBy: 'staff-b', updatedByAt: T1, room: '201' });
  const m = b.mergeDb({ candidates: [A] }, { candidates: [B] }).candidates[0];
  t('新しい方（A）の直した人が残る', m.updatedBy === 'staff-a' && m.updatedByAt === T2 && b.afEditedBy_(m) === 'staff-a', m);
  t('★衝突の基本：A のメモと B の居室が両方残る', m.note === 'Aのメモ' && m.room === '201', [m.note, m.room]);
  const Old = cand({ updatedAt: T2, note: '古い端末の編集' });   // この機能を持たない古い端末（組なし）が新しい
  const m2 = b.mergeDb({ candidates: [Old] }, { candidates: [B] }).candidates[0];
  t('★新しい方に組が無ければ、古い方の名前を持ち込まない（取り違えない）', !m2.updatedBy && !m2.updatedByAt && b.afEditedBy_(m2) === '', [m2.updatedBy, m2.updatedByAt]);
  const m3 = b.mergeDb({ candidates: [B] }, { candidates: [A] }).candidates[0];
  t('どちらを手元・サーバーにしても同じ結果', m3.updatedBy === 'staff-a' && m3.note === 'Aのメモ' && m3.room === '201', m3);
}

console.log('\n— 3. 統合：タスク・連絡記録・アセスメント —');
{
  const b = box();
  const tA = { id: 't1', title: '診療情報提供書', st: 'done', updatedAt: T2, updatedBy: 'staff-a', updatedByAt: T2 };
  const tB = { id: 't1', title: '診療情報提供書', st: 'todo', updatedAt: T1, updatedBy: 'staff-b', updatedByAt: T1 };
  const tC = { id: 't2', title: '面談の日程', st: 'todo', updatedAt: T1, updatedBy: 'staff-b', updatedByAt: T1 };
  const lA = { id: 'l1', at: T1, summary: 'Aの電話', by: 'staff-a' }, lB = { id: 'l2', at: T2, summary: 'Bの電話', by: 'staff-b' };
  const A = cand({ updatedAt: T2, tasks: [tA], log: [lA], assess: { adl: '一部介助', updatedAt: T1, updatedBy: 'staff-a', updatedByAt: T1 } });
  const B = cand({ updatedAt: T1, tasks: [tB, tC], log: [lB], assess: { dementia: '軽度', updatedAt: T2, updatedBy: 'staff-b', updatedByAt: T2 } });
  const m = b.mergeDb({ candidates: [A] }, { candidates: [B] }).candidates[0];
  const t1 = m.tasks.find(x => x.id === 't1'), t2 = m.tasks.find(x => x.id === 't2');
  t('★同じタスクは新しい方（完了）を採り、その直した人も一緒に運ぶ', t1.st === 'done' && t1.updatedBy === 'staff-a', t1);
  t('★片方にしかないタスクも残る（直した人つき）', !!t2 && t2.updatedBy === 'staff-b', t2);
  t('★連絡記録は両方残り、記録した人も残る', m.log.length === 2 && m.log.find(x => x.id === 'l1').by === 'staff-a' && m.log.find(x => x.id === 'l2').by === 'staff-b', m.log);
  t('★アセスメントは項目ごとに両方残り、直した人は新しい方の組', m.assess.adl === '一部介助' && m.assess.dementia === '軽度' && m.assess.updatedBy === 'staff-b' && m.assess.updatedByAt === T2, m.assess);
  /* 古い端末がタスクの時刻だけ進めた後の統合：組がずれて表示が消える（別の人の名前を出さない） */
  const tOld = { id: 't1', title: '診療情報提供書', st: 'wait', updatedAt: '2026-10-10T04:00:00.000Z', updatedBy: 'staff-a', updatedByAt: T2 };
  const m4 = b.mergeDb({ candidates: [cand({ updatedAt: T2, tasks: [tA] })] }, { candidates: [cand({ updatedAt: T1, tasks: [tOld] })] }).candidates[0];
  const t4 = m4.tasks.find(x => x.id === 't1');
  t('古い端末がタスクの時刻だけ進めた後は、そのタスクの直した人を出さない（組がずれる）', t4.st === 'wait' && b.afEditedBy_(t4) === '', t4);
  /* 時刻が等しい時も、どちらか一方の組をそのまま使う（混ぜない） */
  const E1 = cand({ updatedAt: T1, updatedBy: 'staff-a', updatedByAt: T1 }), E2 = cand({ updatedAt: T1, updatedBy: 'staff-b', updatedByAt: T1 });
  const m5 = b.mergeDb({ candidates: [E1] }, { candidates: [E2] }).candidates[0];
  t('時刻が等しい時も、どちらか一方の組がそろって残る', (m5.updatedBy === 'staff-a' || m5.updatedBy === 'staff-b') && m5.updatedByAt === T1, m5);
  t('「直した人」の項目に消した印を付けない（管理用の欄）', /updatedBy: 1, updatedByAt: 1/.test(line(/var CLEAR_META = \{[\s\S]*?\};/)), '');
}

console.log('\n— 4. 書き込む所で組を載せる —');
{
  t('案件（touch）', /function touch\(c\) \{ c\.updatedAt = nowIso\(\); afStamp_\(c\);/.test(SRC), '');
  t('タスクの状態の切り替え', /t\.updatedAt = nowIso\(\); afStamp_\(t\);/.test(SRC), '');
  t('タスクの追加（手入力・標準タスク）', (SRC.match(/c\.tasks\.push\(afStamp_\(\{/g) || []).length === 2, (SRC.match(/c\.tasks\.push\(afStamp_\(\{/g) || []).length);
  t('連絡記録の追加（2か所）に記録した人', (SRC.match(/summary: sum, by: afWho_\(\)/g) || []).length === 2, (SRC.match(/summary: sum, by: afWho_\(\)/g) || []).length);
  t('編集画面の保存（新規・既存・アセスメント）', /editing\.updatedAt = nowIso\(\); afStamp_\(editing\);/.test(SRC) && /target\.updatedAt = nowIso\(\); afStamp_\(target\);/.test(SRC) && /target\.assess\.updatedAt = nowIso\(\); afStamp_\(target\.assess\);/.test(SRC), '');
  t('元に戻す', /cur\.updatedAt = nowIso\(\); afStamp_\(cur\);/.test(SRC), '');
  t('ご相談シートからアセスメントを直す経路（shSet）', /c\.assess\[key\] = v; c\.assess\.updatedAt = nowIso\(\); afStamp_\(c\.assess\);/.test(cutF('shSet')), '');
  t('編集画面の入力の取り込み（collectEditInputs）のアセスメント', /a\.updatedAt = nowIso\(\); afStamp_\(a\);/.test(cutF('collectEditInputs')), '');
}

console.log('\n— 5. 表示 —');
{
  const rv = cutF('renderView');
  t('基本情報に「最後に直した人」（組がそろう時だけ・エスケープ）', /\(afEditedBy_\(c\) \? '<dt>最後に直した人<\/dt><dd>' \+ esc\(afEditedBy_\(c\)\)/.test(rv), '');
  t('タスクに「直した人」', /\(afEditedBy_\(t\) \? '<span>直した人 ' \+ esc\(afEditedBy_\(t\)\)/.test(rv), '');
  t('連絡記録に「記録 …」', /\(l\.by \? '<span class="mth">記録 ' \+ esc\(String\(l\.by\)\.slice\(0, 60\)\)/.test(rv), '');
}

console.log('\n— 6. 誰が（ログイン・ログアウト・確かめられない時）—');
(async () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function run(session, check, pre) {
    const b = box(session ? { 'sb-abc123-auth-token': 'x' } : {});
    b.window.SUAuth = { check: () => Promise.resolve(check) };
    b.afAuthLoad_ = () => Promise.resolve();
    if (pre) b.afWhoAcct_ = pre;
    b.afResolveWho_();
    for (let i = 0; i < 5; i++) await tick();
    return b;
  }
  let b = await run(true, { status: 'ok', email: 'staff-a@example.test', label: '' });
  t('ログイン中はアカウント（@ より前）', b.afWho_() === 'staff-a', b.afWho_());
  b = await run(false, null, 'staff-a');
  t('ログアウト（控えが無い）は「事務所PC」へ戻す', b.afWho_() === '事務所PC', b.afWho_());
  b = await run(true, { status: 'error' }, 'staff-a');
  t('確かめられない時は前の名前のまま', b.afWho_() === 'staff-a', b.afWho_());
  {
    const resolvers = [];
    const bb = box({ 'sb-abc123-auth-token': 'x' });
    bb.window.SUAuth = { check: () => new Promise(r => resolvers.push(r)) };
    bb.afAuthLoad_ = () => Promise.resolve();
    bb.afResolveWho_(); bb.afResolveWho_();
    for (let i = 0; i < 5; i++) await tick();
    resolvers[0]({ status: 'ok', email: 'old@example.test' });
    for (let i = 0; i < 5; i++) await tick();
    const afterOld = bb.afWho_();
    resolvers[1]({ status: 'ok', email: 'staff-new@example.test' });
    for (let i = 0; i < 5; i++) await tick();
    t('遅れて届いた古い確認の結果は捨て、新しい結果を採る（世代番号）', resolvers.length === 2 && afterOld === '事務所PC' && bb.afWho_() === 'staff-new', [resolvers.length, afterOld, bb.afWho_()]);
  }
  t('起動時・別タブのログイン/ログアウト・画面に戻った時に取り直す',
    /try \{ afResolveWho_\(\); \} catch \(e\)/.test(SRC) && /addEventListener\('storage', function \(e\) \{ if \(e\.key === null \|\| AF_SESSION_RE\.test\(e\.key \|\| ''\)\)/.test(SRC) && /visibilitychange', function \(\) \{ if \(!document\.hidden\) \{ try \{ afResolveWho_\(\);/.test(SRC), '');
  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
