/* 受診連絡の画面（hospital-visit.html）の守りの試験（2026-11-28 新設・反証レビューの指摘）
   実行: node check/unit/hospital_visit_page_test.js
   守ること:
     1. 新しい受診の保存: 画面が作った番号（nid）を p_row.id に入れて送る（p_rev は null）。応答が途切れて押し直しても同じ番号を送る。
        番号を作れない端末では番号なしで今までどおり送る。保存済みの受診（draft.id あり）は今までどおり更新として送る
     2. 病院の台帳の「足す」: 送っている間は2回目を送らない（ボタンを止める）。答えの後は押せる
     3. 戻るボタンで戻った時（pageshow の persisted）に、端末の用途が「現場」なら読み込み直す
     4. 保存していない手紙を刷る前に確かめる（保存して刷る／保存せずに刷る／やめる）。保存済みで変更の無い手紙はそのまま刷る
     5. 手紙の紙の架空データの材料（check/fixtures/hospital-visit.mjs）があり、帳票の撮影に入る形
   ★データはすべて架空。出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const H = fs.readFileSync(path.join(ROOT, 'hospital-visit.html'), 'utf8');
const C = require(path.join(ROOT, 'hospital-visit-calc.js'));
let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }
/* 画面の関数の文を1つ取り出す（波括弧を数える。文字列の中に波括弧の無い関数だけに使う） */
function fnSrc(name) {
  const i = H.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, j = H.indexOf('{', i);
  for (; j < H.length; j++) { if (H[j] === '{') d++; else if (H[j] === '}') { d--; if (d === 0) return H.slice(i, j + 1); } }
  return '';
}
const tick = () => new Promise((r) => setImmediate(r));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/* 保存・印刷・病院の台帳の関数を、最小の偽物の中で動かす */
function harness(opt) {
  opt = opt || {};
  const calls = [];
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, value: '', disabled: false, hidden: false, textContent: '', innerHTML: '', className: '', classList: { contains: () => false } });
  const ctx = {
    C, calls, els, console: undefined,
    crypto: opt.noCrypto ? undefined : globalThis.crypto,
    $: (id) => el(id),
    document: { body: { classList: { contains: () => false } }, querySelector: (q) => (q.indexOf('hosp-save') >= 0 ? el('btn-hosp-save') : (q.indexOf('h-save') >= 0 ? el('h-save') : null)) },
    window: {},
    gen: 0, view: 'app', dbState: 'ok', loading: false, saving: false, printOn: false, dlgOpen: '',
    cur: { id: 'K001', name: '架空 花子', room: '101' }, visits: [], draft: null, base: null, prevId: '', rtab: 'letter',
    hospitals: [], hEdit: null, settings: C.normSettings(null),
    clearConflict_() {}, showConflict_() {}, readForm_() {}, lockDesk_(on) { el('h-save').disabled = !!on; },
    setMsg(id, txt) { calls.push({ msg: id, txt }); }, setSync() {}, toast(m) { calls.push({ toast: m }); }, note_() {},
    refreshRecent_() {}, paintAll_() {}, paintRight_() {}, hospDlg_() { calls.push({ redraw: 1 }); },
    friendly_: () => '通信できませんでした', ngText_: () => '保存できませんでした',
    confirm_(m) { calls.push({ confirm: m }); return Promise.resolve(opt.answers ? opt.answers.shift() : false); },
    rpc_(name, args) { calls.push({ rpc: name, args: JSON.parse(JSON.stringify(args)) }); return opt.rpc ? opt.rpc(name, args) : Promise.reject(new Error('net')); },
  };
  ctx.window = ctx;
  ctx.window.SUPrint = { print() { calls.push({ print: 1 }); }, facGate(go) { go(); } };
  vm.createContext(ctx);
  ['newId_', 'newVisit_', 'isDirty_', 'save_', 'hospSave_', 'print_', 'printGo_'].forEach((n) => { const s = fnSrc(n); if (s) vm.runInContext(s, ctx); });
  if (opt.hospSavingVar !== false) vm.runInContext('var hospSaving=false;', ctx);
  return ctx;
}

(async () => {
  group('1. 新しい受診の保存の番号');
  {
    const h = harness();
    t('画面に newVisit_・save_ がある', typeof h.newVisit_ === 'function' && typeof h.save_ === 'function');
    h.newVisit_();
    t('新しい受診は番号（nid）を持つ（draft.id は空のまま＝「まだ保存していません」）', UUID_RE.test(String(h.draft && h.draft.nid)) && h.draft.id == null, h.draft && h.draft.nid);
    h.draft.letter_body = '架空の手紙';
    await h.save_();
    const s1 = h.calls.filter((c) => c.rpc === 'hv_save_visit');
    t('1回目の保存は p_row.id に番号を入れ、p_rev は null', s1.length === 1 && UUID_RE.test(String(s1[0].args.p_row.id)) && s1[0].args.p_row.id === h.draft.nid && s1[0].args.p_rev === null, s1);
    await h.save_();
    const s2 = h.calls.filter((c) => c.rpc === 'hv_save_visit');
    t('応答が途切れて押し直しても同じ番号を送る', s2.length === 2 && UUID_RE.test(String(s2[1].args.p_row.id)) && s2[1].args.p_row.id === s2[0].args.p_row.id && s2[1].args.p_rev === null, s2.map((x) => x.args.p_row.id));
    t('保存に失敗しても draft.id は空のまま（取り消し・更新の扱いにならない）', h.draft.id == null);
  }
  {
    const h = harness({ rpc: (n, a) => Promise.resolve({ ok: true, row: Object.assign({}, a.p_row, { id: 'b0000000-0000-4000-8000-000000000999', rev: 1 }) }) });
    h.newVisit_(); h.draft.letter_body = '架空の手紙';
    await h.save_();
    t('保存できたら返ってきた番号を使う（古い共通 DB は送った番号と違う番号を返す）', h.draft.id === 'b0000000-0000-4000-8000-000000000999' && h.draft.rev === 1);
    await h.save_();
    const s = h.calls.filter((c) => c.rpc === 'hv_save_visit');
    t('2回目は更新として送る（id は返ってきた番号・p_rev は版）', s.length === 2 && s[1].args.p_row.id === 'b0000000-0000-4000-8000-000000000999' && s[1].args.p_rev === 1, s.map((x) => x.args));
  }
  {
    const h = harness({ noCrypto: true });
    h.newVisit_(); h.draft.letter_body = '架空の手紙';
    await h.save_();
    const s = h.calls.filter((c) => c.rpc === 'hv_save_visit');
    t('番号を作れない端末では番号なしで今までどおり送る（落ちない）', s.length === 1 && !('id' in s[0].args.p_row) && s[0].args.p_rev === null, s);
  }
  t('番号は SAVE_KEYS に入れない（保存していない変更の数えに入らない）', C.sameDraft({ resident_id: 'K001', nid: 'x' }, { resident_id: 'K001' }));

  group('2. 病院の台帳の「足す」');
  {
    let resolve;
    const h = harness({ rpc: () => new Promise((r) => { resolve = r; }) });
    h.els['d-name'] = { value: '架空 甲医院' };
    ['d-dept', 'd-doctor', 'd-fax', 'd-phone'].forEach((k) => { h.els[k] = { value: '' }; });
    h.hospSave_(); h.hospSave_();
    const s = h.calls.filter((c) => c.rpc === 'hv_save_hospital');
    t('送っている間に2回押しても1回だけ送る', s.length === 1, s.length);
    t('送っている間はボタンを止める', h.els['btn-hosp-save'] && h.els['btn-hosp-save'].disabled === true);
    resolve({ ok: false, error: 'x' }); await tick(); await tick();
    t('答えの後は押せる（断られた時も）', !!h.els['btn-hosp-save'] && h.els['btn-hosp-save'].disabled === false && h.hospSaving === false);
    h.hospSave_();
    t('答えの後はもう一度送れる', h.calls.filter((c) => c.rpc === 'hv_save_hospital').length === 2);
  }

  group('3. 戻るボタンで戻った時の端末の用途');
  t('pageshow の persisted で、現場なら読み込み直す', /addEventListener\('pageshow',function\(ev\)\{\s*if\(ev&&ev\.persisted&&isField\(\)&&view!=='field'\)\{\s*try\{\s*location\.reload\(\);/.test(H));

  group('4. 保存していない手紙を刷る前の確かめ');
  const draftOf = (o) => Object.assign(C.blankVisit({ id: 'K001', name: '架空 花子' }, '2026-11-28'), o || {});
  {
    const h = harness({ answers: [false, false] });
    h.draft = draftOf({ letter_body: '架空の手紙' }); h.base = C.fromRow(draftOf()); h.base.id = null;
    h.print_(); await tick(); await tick();
    const cf = h.calls.filter((c) => c.confirm);
    t('保存していない時は「保存していません。保存してから刷りますか」と聞く', cf.length >= 1 && /保存していません。保存してから刷りますか/.test(cf[0].confirm), cf);
    t('「やめる」（2回ともキャンセル）なら刷らない・保存しない', !h.calls.some((c) => c.print) && !h.calls.some((c) => c.rpc));
  }
  {
    const h = harness({ answers: [false, true] });
    h.draft = draftOf({ letter_body: '架空の手紙' }); h.base = C.fromRow(draftOf()); h.base.id = null;
    h.print_(); await tick(); await tick(); await tick();
    t('「保存せずに刷る」なら保存せずに刷る', h.calls.some((c) => c.print) && !h.calls.some((c) => c.rpc));
  }
  {
    const h = harness({ answers: [true] });
    h.draft = draftOf({ letter_body: '架空の手紙' }); h.base = C.fromRow(draftOf()); h.base.id = null;
    h.print_(); for (let i = 0; i < 6; i++) await tick();
    t('「保存して刷る」で保存に失敗したら刷らない', h.calls.some((c) => c.rpc === 'hv_save_visit') && !h.calls.some((c) => c.print));
  }
  {
    const h = harness({ answers: [true], rpc: (n, a) => Promise.resolve({ ok: true, row: Object.assign({}, a.p_row, { rev: 1 }) }) });
    h.draft = draftOf({ letter_body: '架空の手紙', nid: 'c0000000-0000-4000-8000-000000000001' }); h.base = C.fromRow(draftOf()); h.base.id = null;
    h.print_(); for (let i = 0; i < 6; i++) await tick();
    t('「保存して刷る」で保存できたら刷る', h.calls.some((c) => c.rpc === 'hv_save_visit') && h.calls.some((c) => c.print));
  }
  {
    const h = harness({ answers: [true] });
    h.draft = draftOf({ letter_body: '架空の手紙' }); h.base = C.fromRow(draftOf()); h.base.id = null;
    h.els['h-save'] = { disabled: true };
    h.print_(); for (let i = 0; i < 6; i++) await tick();
    t('保存のボタンが止まっている間は「保存して刷る」でも保存せず刷らない', !h.calls.some((c) => c.rpc) && !h.calls.some((c) => c.print));
  }
  {
    const h = harness();
    const row = draftOf({ id: 'a0000000-0000-4000-8000-000000000001', rev: 2, letter_body: '架空の手紙' });
    h.draft = C.fromRow(row); h.base = C.fromRow(row);
    h.print_(); await tick();
    t('保存済みで変更の無い手紙は聞かずに刷る', !h.calls.some((c) => c.confirm) && h.calls.some((c) => c.print));
  }

  group('5. 手紙の紙の材料');
  const FX = path.join(ROOT, 'check', 'fixtures', 'hospital-visit.mjs');
  t('check/fixtures/hospital-visit.mjs がある', fs.existsSync(FX));
  if (fs.existsSync(FX)) {
    const fx = await import(FX);
    t('帳票（sheets）に紙を組む prepare と目印 ready がある', Array.isArray(fx.sheets) && fx.sheets.length >= 1 && fx.sheets.every((s) => s.key && typeof s.prepare === 'function' && s.ready));
    t('routes と respond がある（撮影の間だけ通信を横取りする）', Array.isArray(fx.routes) && typeof fx.respond === 'function' && typeof fx.match === 'string');
    const src = fs.readFileSync(FX, 'utf8');
    t('氏名は記号的な架空の名前・電話は 000- の見本の番号だけ', /架空 /.test(src) && !/\b0[1-9]\d{0,3}-\d{1,4}-\d{4}\b/.test(src));
  }

  say('\n合計: ' + pass + ' 通過 / ' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
