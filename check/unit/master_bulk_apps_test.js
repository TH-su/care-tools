/* 入居者マスタ（resident-master.html）の一括編集「対象アプリ」の列（2026-11-11）の試験。
   守りたいこと:
     1 列の定義: 対象アプリの列グループがあり、3つのチェック（排泄記録・体重記録・週間計画）が APP_TARGETS の順に並ぶ
     2 表示: 未設定（targetApps が無い）の方は3つともチェック済み。設定済みの方は配列のとおり
     3 送る形: チェック（tgt_*）はそのまま送らず、targetApps の配列1つ（APP_TARGETS の順）に組み直す。
       触っていない方・開いた時と同じ組み合わせに戻した方は送らない（既定を書き込まない）
     4 3つ全部外した方は、確認の前に止めて氏名で知らせ、送らない
     5 確認文に「チェックを外したアプリには、その方が表示されなくなります（記録は消えません）」を出す
     6 保存の実物確認（verifyAppliedRows_）は並びをそろえて中身で比べ、サーバーに無い時は未保存に残す
     7 送る直前の取り直し（bulkFamGuard_・反証レビューの指摘）: 対象アプリを送る方は、開いてから他の端末で対象アプリが
       変わっていたら（未設定⇔設定済みも違いとみなす）1文字も送らずに止め、表の控えを新しい値に直して知らせる。
       変わっていなければ送る。家族の取り直しと1回の getBulk にまとめる
   実データは1件も含まない（氏名・居室はすべて架空）。
   実行: node check/unit/master_bulk_apps_test.js（読む HTML は環境変数 MASTER_HTML で差し替えられる） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');

/* 関数を名前で切り出す（master_confirm_test.js と同じ作法） */
function grabFn(name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for(let i = start; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
/* var NAME=… を、行頭から最初の「;」で終わる所まで切り出す（かっこの中の ; は数えない） */
function grabVar(name){
  const m = new RegExp('\\nvar ' + name + '=').exec(src);
  if(!m) throw new Error('定義が見つかりません: ' + name);
  let depth = 0, q = null;
  for(let i = m.index + 1; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '(' || c === '[' || c === '{') depth++;
    else if(c === ')' || c === ']' || c === '}') depth--;
    else if(c === ';' && depth === 0) return src.slice(m.index + 1, i + 1);
  }
  throw new Error('定義の終わりが見つかりません: ' + name);
}

let ok = 0, ng = 0;
function eq(label, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if(g === w) ok++;
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function t(label, cond, detail){
  if(cond) ok++;
  else { ng++; process.stdout.write('  ✗ ' + label + (detail !== undefined ? ('\n    実際: ' + JSON.stringify(detail)) : '') + '\n'); }
}
function group(name){ process.stdout.write('\n■ ' + name + '\n'); }

/* ── 切り出した定義を1つの箱で動かす。画面の部品（alert・confirm 等）は記録するだけの偽物 ── */
function makeBox(){
  const box = { calls: { alert: [], confirm: [], toast: [], go: [] }, confirmAnswer: true };
  box.alert = (m) => box.calls.alert.push(String(m));
  box.confirm = (m) => { box.calls.confirm.push(String(m)); return box.confirmAnswer; };
  box.toast = (m) => box.calls.toast.push(String(m));
  box.paintBulkDirty = () => {};
  box.renderBulk = () => {};
  box.openNameWarn_ = (nmv, fn) => fn();
  box.saveBulkGo_ = (changes) => box.calls.go.push(JSON.parse(JSON.stringify(changes)));
  vm.createContext(box);
  const code = [
    grabVar('APP_TARGETS'), grabFn('defaultTargetApps'),
    grabVar('BULK_LEVELS'), grabVar('BULK_FAM_SLOTS'), grabVar('BULK_FAM_ITEMS'), grabVar('BULK_FAM_COLS'), grabFn('bulkFamKey'),
    grabVar('BULK_APP_COLS'), grabFn('bulkAppKey'), grabFn('bulkAppsOrig_'), grabFn('bulkAppsBuild'),
    grabVar('BULK_GROUPS'), grabVar('BULK_DOWNSTREAM'),
    grabFn('bulkTruthy'), grabFn('bulkCellCount'), grabFn('bulkOrig_'), grabFn('bulkVal'), grabFn('bulkFamBuild'),
    grabFn('bulkWho'), grabFn('bulkNormName'), grabFn('bulkNameReview'),
    grabFn('famCmp_'), grabFn('appsCmp_'), grabFn('verifyAppliedRows_'), grabFn('saveBulk'),
    'var bulkRows=null, bulkDirty={};'
  ].join('\n');
  vm.runInContext(code, box);
  return box;
}

/* 架空の3名。甲＝未設定（全部に表示）・乙＝排泄記録だけ・丙＝体重記録と週間計画 */
function rows(){
  return [
    { id: 901, name: '見本 甲', room: '101', active: true, family: [] },
    { id: 902, name: '見本 乙', room: '102', active: true, family: [], targetApps: ['excretion'] },
    { id: 903, name: '見本 丙', room: '103', active: true, family: [], targetApps: ['schedule', 'weight'] }
  ];
}

/* ═══ 1. 列の定義 ═══ */
group('列の定義');
{
  const b = makeBox();
  const g = b.BULK_GROUPS.filter((x) => x[0] === 'apps')[0];
  t('対象アプリの列グループがある', !!g && g[1] === '対象アプリ');
  eq('3つのチェックが APP_TARGETS の順', g && g[2], [['tgt_excretion', '排泄記録', 'check'], ['tgt_weight', '体重記録', 'check'], ['tgt_schedule', '週間計画', 'check']]);
  eq('家族の列グループはそのまま（最後の1つ前）', b.BULK_GROUPS.map((x) => x[0]), ['basic', 'system', 'office', 'medical', 'meds', 'family', 'apps']);
  eq('キー判定: 知らない名前・家族の枠は null', [b.bulkAppKey('tgt_weight'), b.bulkAppKey('tgt_zzz'), b.bulkAppKey('fam0_name'), b.bulkAppKey('weight')], ['weight', null, null, null]);
  t('BULK_DOWNSTREAM には入れない（値が置き換わる項目の一覧なので）', !('targetApps' in b.BULK_DOWNSTREAM));
}

/* ═══ 2. 表示 ═══ */
group('表示（取得時の値）');
{
  const b = makeBox();
  const [a, o, c] = rows();
  eq('未設定の方は3つともチェック済み', ['tgt_excretion', 'tgt_weight', 'tgt_schedule'].map((k) => b.bulkOrig_(a, k)), [true, true, true]);
  eq('排泄記録だけの方', ['tgt_excretion', 'tgt_weight', 'tgt_schedule'].map((k) => b.bulkOrig_(o, k)), [true, false, false]);
  eq('並びが違っても配列のとおり', ['tgt_excretion', 'tgt_weight', 'tgt_schedule'].map((k) => b.bulkOrig_(c, k)), [false, true, true]);
  eq('ほかの列の取り方は変えていない', [b.bulkOrig_(a, 'room'), b.bulkOrig_(a, 'kana')], ['101', '']);
}

/* ═══ 3. 送る形 ═══ */
group('送る形（saveBulk）');
{
  const b = makeBox();
  b.bulkRows = rows();
  b.bulkDirty = { 901: { tgt_weight: false }, 902: { tgt_schedule: true, room: '112' } };
  b.saveBulk();
  t('確認を1回出して送った', b.calls.confirm.length === 1 && b.calls.go.length === 1, b.calls);
  const ch = b.calls.go[0] || [];
  const byId = {}; ch.forEach((c) => { byId[c.id] = c; });
  eq('未設定の方から体重記録を外す → 排泄記録・週間計画', byId[901] && byId[901].fields, { targetApps: ['excretion', 'schedule'] });
  eq('週間計画を足す（ほかの項目と一緒）→ APP_TARGETS の順', byId[902] && byId[902].fields, { room: '112', targetApps: ['excretion', 'schedule'] });
  t('チェックのキー（tgt_*）は送らない', !JSON.stringify(ch).includes('tgt_'));
  t('照合用の氏名を添える', byId[901] && byId[901].name === '見本 甲');
  t('触っていない方は送らない', !byId[903]);
  t('確認文に対象アプリの注意を出す', /チェックを外したアプリには、その方が表示されなくなります（記録は消えません）/.test(b.calls.confirm[0] || ''));
}
{
  /* 開いた時と同じ組み合わせに戻した（2つ外して1つ戻す等ではなく、元と同じになった）方は送らない */
  const b = makeBox();
  b.bulkRows = rows();
  /* 未設定の方の3つを全部 true にした印だけが残っていても（通常は onBulkInput が消す）、既定を書き込まない */
  b.bulkDirty = { 901: { tgt_excretion: true, tgt_weight: true, tgt_schedule: true }, 903: { room: '113' } };
  b.saveBulk();
  const ch = b.calls.go[0] || [];
  t('未設定の方に既定（3つ全部）を書き込まない', !ch.some((c) => c.id === 901), ch);
  t('ほかの方の変更は送る', ch.length === 1 && ch[0].id === 903 && !('targetApps' in ch[0].fields), ch);
  t('対象アプリを送らない時は確認文に注意を出さない', !/チェックを外したアプリ/.test(b.calls.confirm[0] || ''));
}

/* ═══ 4. 3つ全部外した方は止める ═══ */
group('3つ全部は外せない');
{
  const b = makeBox();
  b.bulkRows = rows();
  b.bulkDirty = { 902: { tgt_excretion: false }, 903: { room: '113' } };
  b.saveBulk();
  t('確認を出さない・送らない', b.calls.confirm.length === 0 && b.calls.go.length === 0, b.calls);
  t('氏名（居室）で知らせる', b.calls.alert.length === 1 && /見本 乙（102）/.test(b.calls.alert[0]) && /チェックを1つ以上入れてください/.test(b.calls.alert[0]), b.calls.alert);
  t('未保存の変更は残す', JSON.stringify(b.bulkDirty[902]) === JSON.stringify({ tgt_excretion: false }) && b.bulkDirty[903].room === '113');
}
{
  const b = makeBox();
  b.bulkRows = rows();
  b.bulkDirty = { 901: { tgt_excretion: false, tgt_weight: false, tgt_schedule: false } };
  b.saveBulk();
  t('未設定の方の3つを全部外しても止める', b.calls.go.length === 0 && b.calls.alert.length === 1 && /見本 甲/.test(b.calls.alert[0]));
}
{
  const b = makeBox();
  b.bulkRows = rows(); b.confirmAnswer = false;
  b.bulkDirty = { 903: { tgt_excretion: true } };
  b.saveBulk();
  t('確認で「キャンセル」なら送らない', b.calls.confirm.length === 1 && b.calls.go.length === 0);
}

/* ═══ 5. 保存の実物確認 ═══ */
group('保存の実物確認（verifyAppliedRows_）');
{
  const b = makeBox();
  const v = b.verifyAppliedRows_;
  eq('並びが違っても中身が同じなら保存済み',
    v([{ id: 1, fields: { targetApps: ['excretion', 'schedule'] } }], [{ id: 1, targetApps: ['schedule', 'excretion'] }]), { applied: ['1'], kept: [] });
  eq('中身が違えば未保存',
    v([{ id: 1, fields: { targetApps: ['excretion', 'schedule'] } }], [{ id: 1, targetApps: ['excretion'] }]), { applied: [], kept: ['1'] });
  eq('サーバーに無い（未設定）時は「3つ全部」とみなさず未保存',
    v([{ id: 1, fields: { targetApps: ['excretion', 'weight', 'schedule'] } }], [{ id: 1 }]), { applied: [], kept: ['1'] });
  eq('ほかの項目と一緒でも両方確かめる',
    v([{ id: 1, fields: { room: '101', targetApps: ['weight'] } }], [{ id: 1, room: '101', targetApps: ['weight'] }]), { applied: ['1'], kept: [] });
  eq('ほかの項目が違えば未保存',
    v([{ id: 1, fields: { room: '101', targetApps: ['weight'] } }], [{ id: 1, room: '102', targetApps: ['weight'] }]), { applied: [], kept: ['1'] });
  eq('文字で返ってきた値は配列とみなさない',
    v([{ id: 1, fields: { targetApps: ['weight'] } }], [{ id: 1, targetApps: 'weight' }]), { applied: [], kept: ['1'] });
}

/* ═══ 7. 送る直前の取り直し（saveBulkGo_ と bulkFamGuard_ を偽物の通信で動かす） ═══ */
function makeGoBox(serverRows){
  const box = { calls: { alert: [], getBulk: 0, post: [] }, bulkGen: 0 };
  const el = () => ({ disabled: false, textContent: '', className: '' });
  const els = { bulkSave: el(), bulkClose: el(), syncStatus: el() };
  box.$ = (id) => els[id] || null;
  box.alert = (m) => box.calls.alert.push(String(m));
  box.setSync = () => {};
  box.renderBulk = () => {};
  box.paintBulkDirty = () => {};
  box.refreshRoster = () => {};
  box.bkMarkStale_ = () => {};
  box.toast = () => {};
  box.apiGet = (p) => { if(p && p.action === 'getBulk') box.calls.getBulk++; return Promise.resolve({ rows: JSON.parse(JSON.stringify(serverRows)) }); };
  box.apiPostRaw = (body) => { box.calls.post.push(JSON.parse(JSON.stringify(body))); return Promise.resolve({ ok: true, saved: (body.changes || []).length, warn: [], warnIds: [] }); };
  vm.createContext(box);
  vm.runInContext([
    grabVar('APP_TARGETS'), grabFn('famCmp_'), grabFn('appsCmp_'), grabFn('bulkTruthy'), grabFn('bulkWho'),
    grabFn('bulkAppsSame_'), grabFn('bulkFamGuard_'), grabFn('saveBulkGo_'),
    'var bulkRows=null, bulkDirty={}, RM_SRV_OLD="";'
  ].join('\n'), box);
  return box;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  group('送る直前の取り直し（他の端末の変更を戻さない）');
  const nmv = { spaceOnly: [], keyChanged: [] };
  {
    /* 開いた時: 乙＝排泄記録だけ。その後、他の端末で乙に週間計画が足された。こちらは体重記録を足して送ろうとする */
    const server = rows().map((r) => r.id === 902 ? Object.assign({}, r, { targetApps: ['excretion', 'schedule'] }) : r);
    const b = makeGoBox(server);
    b.bulkRows = rows(); b.bulkDirty = { 902: { tgt_weight: true } };
    b.saveBulkGo_([{ id: 902, name: '見本 乙', fields: { targetApps: ['excretion', 'weight'] } }], nmv);
    await settle(); await settle();
    t('他の端末で変わっていたら送らない', b.calls.post.length === 0, b.calls.post);
    t('取り直しは1回', b.calls.getBulk === 1, b.calls.getBulk);
    t('職員に分かる言葉で知らせる', b.calls.alert.length === 1 && /1文字も書いていません/.test(b.calls.alert[0]) && /他の端末で対象アプリが変わった方がいます（1名）/.test(b.calls.alert[0]), b.calls.alert);
    t('家族の文は出さない（家族は変わっていない）', !/家族情報が変わった/.test(b.calls.alert[0] || ''));
    eq('表の控えを新しい値に直す', b.bulkRows.filter((r) => r.id === 902)[0].targetApps, ['excretion', 'schedule']);
    t('未保存の変更は残す', b.bulkDirty[902] && b.bulkDirty[902].tgt_weight === true);
    t('ボタンを戻す', !b.$('bulkSave').disabled && !b.$('bulkClose').disabled);
  }
  {
    /* 開いた時は未設定（全部に表示）。他の端末で「排泄記録・体重記録・週間計画」と3つ全部が明示で入った＝中身は同じでも別のもの */
    const server = rows().map((r) => r.id === 901 ? Object.assign({}, r, { targetApps: ['excretion', 'weight', 'schedule'] }) : r);
    const b = makeGoBox(server);
    b.bulkRows = rows();
    b.saveBulkGo_([{ id: 901, name: '見本 甲', fields: { targetApps: ['excretion'] } }], nmv);
    await settle(); await settle();
    t('未設定と設定済みは別のものとして止める', b.calls.post.length === 0 && b.calls.alert.length === 1);
    eq('控えに設定済みの値が入る', b.bulkRows.filter((r) => r.id === 901)[0].targetApps, ['excretion', 'weight', 'schedule']);
  }
  {
    /* 逆: 開いた時は設定済み、他の端末で未設定に戻った（J 列が空） */
    const server = rows().map((r) => { const o = Object.assign({}, r); if(o.id === 903) delete o.targetApps; return o; });
    const b = makeGoBox(server);
    b.bulkRows = rows();
    b.saveBulkGo_([{ id: 903, name: '見本 丙', fields: { targetApps: ['weight'] } }], nmv);
    await settle(); await settle();
    t('設定済み→未設定も止める', b.calls.post.length === 0 && b.calls.alert.length === 1);
    t('控えから消す（全部に表示として見せる）', !('targetApps' in b.bulkRows.filter((r) => r.id === 903)[0]));
  }
  {
    /* 変わっていない（並びだけ違う）なら送る */
    const server = rows().map((r) => r.id === 903 ? Object.assign({}, r, { targetApps: ['weight', 'schedule'] }) : r);
    const b = makeGoBox(server);
    b.bulkRows = rows();
    b.saveBulkGo_([{ id: 903, name: '見本 丙', fields: { targetApps: ['weight'] } }], nmv);
    await settle(); await settle();
    t('変わっていなければ送る', b.calls.post.length === 1 && b.calls.alert.length === 0, b.calls);
    eq('送る中身', b.calls.post[0] && b.calls.post[0].changes, [{ id: 903, name: '見本 丙', fields: { targetApps: ['weight'] } }]);
  }
  {
    /* 対象アプリを送らない方は、他の端末で対象アプリが変わっていても取り直さない（往復を増やさない） */
    const server = rows().map((r) => r.id === 902 ? Object.assign({}, r, { targetApps: ['weight'] }) : r);
    const b = makeGoBox(server);
    b.bulkRows = rows();
    b.saveBulkGo_([{ id: 902, name: '見本 乙', fields: { room: '112' } }], nmv);
    await settle(); await settle();
    t('対象アプリも家族も送らない時は取り直さずに送る', b.calls.getBulk === 0 && b.calls.post.length === 1);
  }
  {
    /* 家族と対象アプリの両方を送る時も getBulk は1回。両方の文を出す */
    const server = rows().map((r) => r.id === 902 ? Object.assign({}, r, { targetApps: ['weight'], family: [{ name: '見本 子', relation: '長男', phone: '000', address: '', emergency: false, kp: false, role: '' }] }) : r);
    const b = makeGoBox(server);
    b.bulkRows = rows();
    b.saveBulkGo_([{ id: 902, name: '見本 乙', fields: { family: [], targetApps: ['schedule'] } }], nmv);
    await settle(); await settle();
    t('家族と一緒でも取り直しは1回・送らない', b.calls.getBulk === 1 && b.calls.post.length === 0);
    t('家族と対象アプリの両方の文', /家族情報が変わった方がいます（1名）/.test(b.calls.alert[0] || '') && /対象アプリが変わった方がいます（1名）/.test(b.calls.alert[0] || ''), b.calls.alert);
  }
  process.stdout.write('\n合格 ' + ok + ' / 不合格 ' + ng + '\n');
  process.exit(ng ? 1 : 0);
})();
