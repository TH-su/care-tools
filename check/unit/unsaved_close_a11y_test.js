/* 週間計画・消耗品管理・入居調整・体重管理・入居者マスタ ── 保存していない変更の確かめと読み上げの名前の試験（2026-11-12 新設）
   実行: node check/unit/unsaved_close_a11y_test.js
   守ること:
     1. 週間計画の予定の窓・事業所情報の窓は、Esc・枠の外・✕ で閉じる時だけ、開いた時の入力の値と比べ、違う時だけ確かめる。
        「いいえ」なら閉じない（窓・編集中の印・自動同期はそのまま）。保存・削除・キャンセルは確かめずに閉じる（今までどおり）
        読み取り専用の単位数（自動計算）は比べない。事業所情報は「保存」が書く13項目だけを比べる
     2. 週間計画の加算の選択欄12個の見出しは選択欄と結び付いている。開け閉めの見出しはキーボードで押せて、開いているかを読み上げに伝える
     3. 消耗品管理の「新しい品目」は、Esc で閉じる時に入力が変わっていれば確かめる。登録中は閉じない（今までどおり）。
        「価格の付け直し」の失敗は alert でなく失敗の見た目の toast で出す（文は変えない）
     4. 入居調整のご家族・連携先の欄の見出しは入力欄と結び付いている
     5. 体重管理の「サンプル投入」は、名簿が空でも必ず確かめ、断ったら何も入れない。空の時の案内に「サンプル投入」を出さない
     6. 入居者マスタの検索欄2つに読み上げ用の名前がある
   ★画面の本物の関数を切り出し、偽物の DOM の上で動かす。データは使わない（入力の値は架空の短い文字だけ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const PENDING = [];   // 答えを待つ試験（最後にそろってから合計を出す）
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const key = 'function ' + name + '(';
  let h = src.indexOf(key);
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  /* 2026-11-12: 画面の中の窓（su-dialog.js）の答えを待つ関数は async になった。頭の async も一緒に切り出す（await が構文の誤りにならないように） */
  if (src.slice(h - 6, h) === 'async ') h -= 6;
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('閉じていません: ' + name);
}
function cutStmt(src, start, end) {
  const h = src.indexOf(start);
  if (h < 0) throw new Error('見つかりません: ' + start);
  return src.slice(h, src.indexOf(end, h) + end.length);
}
function el(id, type, value, checked) {
  return { id, type: type || 'text', value: value == null ? '' : value, checked: !!checked };
}
function cls(open) {
  const set = new Set(open ? ['open'] : []);
  return { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c) => { if (set.has(c)) { set.delete(c); return false; } set.add(c); return true; } };
}

/* ═══════════ 1. 週間計画 ═══════════ */
const CS = read('care-schedule.html');
console.log('\n— 1. 週間計画：予定の窓・事業所情報の窓の確かめ —');
function csPage(answers) {
  const log = { confirms: [], closedEv: 0, closedOi: 0 };
  const evFields = [el('f-dow', 'select-one', '1'), el('st-v', 'radio', 'visit', true), el('st-d', 'radio', 'daycare', false),
    el('f-detail', 'textarea', ''), el('f-bathing', 'checkbox', '', false), el('f-units', 'number', '120'), el('f-dup-dow', 'select-one', '')];
  const OI = ['oi-unit-price', 'oi-v-tokuteijigyo', 'oi-v-svc-strength', 'oi-v-chiiki', 'oi-v-nursing', 'oi-v-douitsu',
    'oi-dc-bathing', 'oi-dc-heavy', 'oi-dc-dementia', 'oi-dc-training', 'oi-dc-svc-strength', 'oi-dc-nursing', 'oi-dc-douitsu'];
  const oi = {}; OI.forEach((id) => { oi[id] = el(id, id === 'oi-unit-price' ? 'number' : 'select-one', id === 'oi-unit-price' ? '10.0' : '0'); });
  const rmField = el('rm-municipality', 'text', '架空市');
  const mkEvent = { classList: cls(true), querySelectorAll: () => evFields };
  const mkOffice = { classList: cls(true), querySelectorAll: () => Object.values(oi).concat([rmField]) };
  const map = { '#mk-event': mkEvent, '#mk-office-info': mkOffice };
  Object.keys(oi).forEach((id) => { map['#' + id] = oi[id]; });
  const ans = (answers || []).slice();
  const ctx = {
    $: (s) => map[s] || null, Array, JSON, String,
    /* 2026-11-12: 確かめは画面の中の窓（su-dialog.js）になり、答えを約束（Promise）で返す。記録と答え方は今までどおり */
    SUDialog: { confirm: (m) => { log.confirms.push(m); return Promise.resolve(ans.length ? ans.shift() : false); } },
    closeEventModal: () => { log.closedEv++; mkEvent.classList.remove('open'); ctx._csEventSnap = null; },
    closeOfficeInfoModal: () => { log.closedOi++; mkOffice.classList.remove('open'); ctx._csOfficeSnap = null; },
  };
  vm.createContext(ctx);
  const code = [cutStmt(CS, "const CS_UNSAVED_MSG", ';'), cutStmt(CS, 'const CS_OFFICE_FIELDS', '];'),
    cutF(CS, 'csFieldsSnap_'), cutF(CS, 'csEventSnap_'), cutF(CS, 'csOfficeSnap_'), cutF(CS, 'askCloseEventModal'), cutF(CS, 'askCloseOfficeInfoModal'),
    'var _csEventSnap = csEventSnap_(); var _csOfficeSnap = csOfficeSnap_();'].join('\n')
    .replace(/^const /gm, 'var ');
  vm.runInContext(code, ctx);
  /* 偽の closeXxx が控えを消せるよう、vm の変数を ctx から見えるようにする（var は ctx の上に乗る） */
  return { ctx, log, evFields, oi, rmField, mkEvent, mkOffice };
}
PENDING.push((async () => {
  const p = csPage();
  await vm.runInContext('askCloseEventModal()', p.ctx);
  t('1-1 予定の窓：変えていなければ確かめずに閉じる', p.log.confirms.length === 0 && p.log.closedEv === 1, p.log);
})());
PENDING.push((async () => {
  const p = csPage();
  p.evFields[5].value = '999';   // 読み取り専用の単位数（自動計算）
  await vm.runInContext('askCloseEventModal()', p.ctx);
  t('1-2 予定の窓：単位数（自動計算）だけ変わっても確かめない', p.log.confirms.length === 0 && p.log.closedEv === 1, p.log);
})());
PENDING.push((async () => {
  const p = csPage([false]);
  p.evFields[3].value = '架空の支援';
  await vm.runInContext('askCloseEventModal()', p.ctx);
  t('1-3 予定の窓：書きかけがあれば確かめ、「いいえ」なら閉じない', p.log.confirms.length === 1 && p.log.closedEv === 0 && p.mkEvent.classList.contains('open'), p.log);
  t('1-4 確かめの文', p.log.confirms[0] === '保存していない変更があります。閉じてもよろしいですか？', p.log.confirms[0]);
})());
PENDING.push((async () => {
  const p = csPage([true]);
  p.evFields[1].checked = false; p.evFields[2].checked = true;   // 訪問→通所
  await vm.runInContext('askCloseEventModal()', p.ctx);
  t('1-5 予定の窓：ラジオを変えても確かめ、「はい」なら閉じる', p.log.confirms.length === 1 && p.log.closedEv === 1, p.log);
})());
PENDING.push((async () => {
  const p = csPage();
  p.mkEvent.classList.remove('open');
  await vm.runInContext('askCloseEventModal()', p.ctx);
  t('1-6 窓が閉じている時は何もしない', p.log.confirms.length === 0 && p.log.closedEv === 0, p.log);
})());
PENDING.push((async () => {
  const p = csPage();
  p.rmField.value = '別の架空市';   // 報酬マスタの欄は別の道
  await vm.runInContext('askCloseOfficeInfoModal()', p.ctx);
  t('1-7 事業所情報：報酬マスタの欄だけ変えても確かめない', p.log.confirms.length === 0 && p.log.closedOi === 1, p.log);
})());
PENDING.push((async () => {
  const p = csPage([false]);
  p.oi['oi-dc-heavy'].value = '45';
  await vm.runInContext('askCloseOfficeInfoModal()', p.ctx);
  t('1-8 事業所情報：加算を変えたら確かめ、「いいえ」なら閉じない（自動同期の再開も呼ばない）', p.log.confirms.length === 1 && p.log.closedOi === 0, p.log);
})());
PENDING.push((async () => {
  const p = csPage([true]);
  p.oi['oi-unit-price'].value = '10.9';
  await vm.runInContext('askCloseOfficeInfoModal()', p.ctx);
  t('1-9 事業所情報：単位単価を変えて「はい」なら閉じる', p.log.confirms.length === 1 && p.log.closedOi === 1, p.log);
})());
{
  const ids = vm.runInContext(cutStmt(CS, 'const CS_OFFICE_FIELDS', '];').replace(/^const /, 'var ') + '; CS_OFFICE_FIELDS', vm.createContext({}));
  const saveSrc = cutF(CS, 'saveOfficeInfo');
  const written = [...saveSrc.matchAll(/\$\('#(oi-[\w-]+)'\)/g)].map((m) => m[1]);
  t('1-10 比べる13項目＝「保存」が書く項目', ids.length === 13 && written.length === 13 && written.every((x) => ids.includes(x)), { ids, written });
}
console.log('\n— 1b. 週間計画：閉じる道のつなぎ方 —');
{
  const esc = cutStmt(CS, "document.addEventListener('keydown', e => {\n  if (e.key === 'Escape') {", "    if ($('#mk-bulk').classList.contains('open'))");
  t('1-11 Esc は予定の窓で確かめ付きの道を通る', /mk-event'\)\.classList\.contains\('open'\)\)\s*\{ askCloseEventModal\(\); return; \}/.test(esc), esc.slice(0, 200));
  t('1-12 枠の外（予定・事業所情報）は確かめ付きの道', /e\.target === \$\('#mk-event'\)\)\s*askCloseEventModal\(\)/.test(CS) && /e\.target === \$\('#mk-office-info'\)\) askCloseOfficeInfoModal\(\)/.test(CS));
  t('1-13 ✕（予定・事業所情報）は確かめ付きの道', /data-on-click="askCloseEventModal" aria-label="予定の入力を閉じる"/.test(CS) && /data-on-click="askCloseOfficeInfoModal" aria-label="事業所情報を閉じる"/.test(CS));
  t('1-14 キャンセルのボタンは今までどおり（確かめない）', /<button class="btn btn-sec" data-on-click="closeEventModal">キャンセル<\/button>/.test(CS) && /<button class="btn btn-sec" data-on-click="closeOfficeInfoModal">キャンセル<\/button>/.test(CS));
  t('1-15 保存は確かめずに閉じる', /saveDB\(\); closeOfficeInfoModal\(\); renderAll\(\);/.test(CS) && (CS.match(/saveDB\(\); closeEventModal\(\); renderAll\(\);/g) || []).length >= 2);
  t('1-16 閉じる関数そのものは確かめない', !/confirm/.test(cutF(CS, 'closeEventModal')) && !/confirm/.test(cutF(CS, 'closeOfficeInfoModal')));
  t('1-17 開いた時に控える（追加・編集・事業所情報）', /classList\.add\('open'\);\n  _csEventSnap = csEventSnap_\(\);/.test(cutF(CS, 'openAddModal')) && /_csEventSnap = csEventSnap_\(\);/.test(cutF(CS, 'openEditModal')) && /_csOfficeSnap = csOfficeSnap_\(\);/.test(cutF(CS, 'openOfficeInfoModal')));
  t('1-18 受け口の表に確かめ付きの2つがある', /'askCloseEventModal': \(a\) => askCloseEventModal\(\.\.\.a\),/.test(CS) && /'askCloseOfficeInfoModal': \(a\) => askCloseOfficeInfoModal\(\.\.\.a\),/.test(CS));
}
console.log('\n— 1c. 週間計画：反証レビューの指摘（報酬マスタの適用・戻す／複製の曜日）—');
PENDING.push((async () => {
  const p = csPage();
  p.evFields[6].value = '3';   // 「他の曜日に複製」の曜日（保存しない欄）
  await vm.runInContext('askCloseEventModal()', p.ctx);
  t('1-19 複製の曜日を選んだだけでは確かめない', p.log.confirms.length === 0 && p.log.closedEv === 1, p.log);
})());
PENDING.push((async () => {
  /* 偽の select: 選択肢を作り直すと、ブラウザと同じく先頭の選択肢へ戻る */
  function fakeSel(id, value) {
    const s = { id, type: 'select-one', _opts: ['0', '1', '2'], _v: value, parentElement: { querySelector: () => ({ textContent: '' }) } };
    Object.defineProperty(s, 'innerHTML', { set(h) { s._opts = [...String(h).matchAll(/value="([^"]*)"/g)].map((m) => m[1]); s._v = s._opts[0] || ''; } });
    Object.defineProperty(s, 'value', { get() { return s._v; }, set(v) { s._v = s._opts.includes(String(v)) ? String(v) : ''; } });
    return s;
  }
  function addonCtx(opts) {
    const sels = { 'oi-v-tokuteijigyo': fakeSel('oi-v-tokuteijigyo', '2'), 'oi-dc-heavy': fakeSel('oi-dc-heavy', '1') };
    const DB = { rateMaster: { addonOptions: {
      visit: { tokuteijigyo: { selId: 'oi-v-tokuteijigyo', label: '特定事業所加算', opts: opts.visit } },
      daycare: { heavyCare: { selId: 'oi-dc-heavy', label: '中重度者ケア体制加算', opts: opts.daycare } } } } };
    const ctx = vm.createContext({ DB, RATE_MASTER_DEFAULT: DB.rateMaster, $: (s) => sels[s.slice(1)] || null, escHtml: (x) => String(x), String });
    vm.runInContext(cutF(CS, 'renderAddonOptions_'), ctx);
    return { ctx, sels };
  }
  const vals = (c) => JSON.stringify([c.sels['oi-v-tokuteijigyo'].value, c.sels['oi-dc-heavy'].value]);
  const same = addonCtx({ visit: [[0, 'なし'], [1, 'I'], [2, 'II']], daycare: [[0, 'なし'], [1, 'あり']] });
  /* 窓を開いた時 → 報酬マスタの適用・戻す（refreshRateMasterUI_ → renderAddonOptions_）を2回 */
  const before = vals(same);
  vm.runInContext('renderAddonOptions_()', same.ctx);
  const after1 = vals(same);
  vm.runInContext('renderAddonOptions_()', same.ctx);
  const after2 = vals(same);
  t('1-20 報酬マスタの適用・戻した後も加算の選択が残る（先頭の「なし」に戻らない）', before === '["2","1"]' && after1 === before && after2 === before, { before, after1, after2 });
  const gone = addonCtx({ visit: [[0, 'なし'], [1, 'I']], daycare: [[0, 'なし'], [1, 'あり']] });
  vm.runInContext('renderAddonOptions_()', gone.ctx);
  t('1-21 選択肢が無くなった値は戻さない（今までどおり先頭）', vals(gone) === '["0","1"]', vals(gone));
  /* 窓の確かめとつなげる: 控え → 作り直し → ✕ で確かめが出ない */
  const p = csPage();
  const orig = p.ctx.$;
  const sel2 = addonCtx({ visit: [[0, 'なし'], [1, 'I'], [2, 'II']], daycare: [[0, 'なし'], [1, 'あり']] });
  p.ctx.$ = (s) => sel2.sels[s.slice(1)] || orig(s);
  vm.runInContext('_csOfficeSnap = csOfficeSnap_();', p.ctx);
  vm.runInContext('renderAddonOptions_()', sel2.ctx);
  await vm.runInContext('askCloseOfficeInfoModal()', p.ctx);
  t('1-22 報酬マスタの適用の後に閉じても確かめが出ず、値が残る', p.log.confirms.length === 0 && p.log.closedOi === 1 && vals(sel2) === '["2","1"]', [p.log, vals(sel2)]);
})());
console.log('\n— 2. 週間計画：加算の見出しと開け閉めの見出し —');
{
  const IDS = ['oi-v-tokuteijigyo', 'oi-v-svc-strength', 'oi-v-chiiki', 'oi-v-nursing', 'oi-v-douitsu', 'oi-dc-bathing', 'oi-dc-heavy', 'oi-dc-dementia', 'oi-dc-training', 'oi-dc-svc-strength', 'oi-dc-nursing', 'oi-dc-douitsu'];
  const bad = IDS.filter((id) => !new RegExp('<label for="' + id + '">[^<]+</label>\\s*<select id="' + id + '"></select>').test(CS));
  t('2-1 加算の選択欄12個の見出しに for', bad.length === 0, bad);
  const hds = [...CS.matchAll(/<div class="ci-section-hd"[^>]*>/g)].map((m) => m[0]);
  t('2-2 開け閉めの見出し3つ', hds.length === 3, hds.length);
  t('2-3 見出しは role="button"・tabindex="0"・aria-expanded="false"・aria-controls', hds.every((h) => /role="button"/.test(h) && /tabindex="0"/.test(h) && /aria-expanded="false"/.test(h) && /aria-controls="oi-[\w-]+-body"/.test(h)), hds);
  /* toggleCiSection を動かす */
  const hd = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => ({ textContent: '▸ 訪問介護 加算設定' }) };
  const body = { classList: cls(false), previousElementSibling: hd };
  const arrow = { textContent: '▸ 訪問介護 加算設定' };
  hd.querySelector = () => arrow;
  const ctx = vm.createContext({ $: () => body });
  vm.runInContext(cutF(CS, 'toggleCiSection'), ctx);
  vm.runInContext("toggleCiSection('oi-visit-body')", ctx);
  t('2-4 開くと aria-expanded="true"・矢印は ▾', hd.attrs['aria-expanded'] === 'true' && arrow.textContent.startsWith('▾'), [hd.attrs, arrow.textContent]);
  vm.runInContext("toggleCiSection('oi-visit-body')", ctx);
  t('2-5 閉じると aria-expanded="false"・矢印は ▸', hd.attrs['aria-expanded'] === 'false' && arrow.textContent.startsWith('▸'), [hd.attrs, arrow.textContent]);
  /* キー操作：Enter・スペースで押す。ほかのキー・ほかの要素では何もしない */
  const kd = cutStmt(CS, "document.addEventListener('keydown', e => {\n  const hd = e.target;", '\n});');
  let handler = null;
  vm.runInContext(kd, vm.createContext({ document: { addEventListener: (ty, fn) => { if (ty === 'keydown') handler = fn; } } }));
  function press(key, isHd) {
    const r = { clicks: 0, prevented: 0 };
    const target = { classList: { contains: (c) => isHd && c === 'ci-section-hd' }, click: () => { r.clicks++; } };
    handler({ key, target, preventDefault: () => { r.prevented++; } });
    return r;
  }
  const a = press('Enter', true), b = press(' ', true), c = press('a', true), d = press('Enter', false);
  t('2-6 見出しで Enter・スペースを押すと開け閉め（既定の動きは止める）', a.clicks === 1 && a.prevented === 1 && b.clicks === 1 && b.prevented === 1, [a, b]);
  t('2-7 ほかのキー・ほかの要素では何もしない', c.clicks === 0 && c.prevented === 0 && d.clicks === 0 && d.prevented === 0, [c, d]);
}

/* ═══════════ 3. 消耗品管理 ═══════════ */
const SP = read('supplies.html');
console.log('\n— 3. 消耗品管理：「新しい品目」の確かめと付け直しの失敗 —');
function spPage(answers) {
  const log = { confirms: [] };
  const fields = [el('ndName', 'text', ''), el('ndCat', 'select-one', 'c1'), el('nd_s3', 'radio', '3', true), el('nd_s1', 'radio', '1', false), el('ndNote', 'text', '')];
  const save = { disabled: false };
  const dlg = { querySelectorAll: () => fields };
  const ans = (answers || []).slice();
  const ctx = {
    $: (id) => (id === 'newDlg' ? dlg : id === 'ndSave' ? save : null), Array, JSON, String,
    window: { confirm: (m) => { log.confirms.push(m); return ans.length ? ans.shift() : false; } },
    txt: (v) => (v === null || v === undefined) ? '' : String(v),
  };
  vm.createContext(ctx);
  vm.runInContext([cutStmt(SP, 'var ND_UNSAVED_MSG', ';'), cutF(SP, 'newDlgSnap'), cutF(SP, 'newDlgMayCancel'), 'var ND_SNAP = newDlgSnap();'].join('\n'), ctx);
  return { ctx, log, fields, save };
}
{
  const p = spPage();
  t('3-1 変えていなければ Esc で確かめずに閉じる', vm.runInContext('newDlgMayCancel()', p.ctx) === true && p.log.confirms.length === 0, p.log);
}
{
  const p = spPage([false]);
  p.fields[0].value = '架空の手袋';
  t('3-2 書きかけで Esc → 確かめ、「いいえ」なら閉じない', vm.runInContext('newDlgMayCancel()', p.ctx) === false && p.log.confirms.length === 1, p.log);
  t('3-3 確かめの文', p.log.confirms[0] === '保存していない変更があります。閉じてもよろしいですか？', p.log.confirms[0]);
}
{
  const p = spPage([true]);
  p.fields[2].checked = false; p.fields[3].checked = true;
  t('3-4 段の数を変えて「はい」なら閉じる', vm.runInContext('newDlgMayCancel()', p.ctx) === true && p.log.confirms.length === 1, p.log);
}
{
  const p = spPage();
  p.save.disabled = true; p.fields[0].value = '架空';
  t('3-5 登録中は確かめずに閉じない（今までどおり）', vm.runInContext('newDlgMayCancel()', p.ctx) === false && p.log.confirms.length === 0, p.log);
}
{
  t('3-6 Esc（cancel）は newDlgMayCancel を通る', /\$\('newDlg'\)\.addEventListener\('cancel', function \(ev\) \{\n    if \(!newDlgMayCancel\(\)\) \{ ND_SAID_NO = true; ev\.preventDefault\(\); return; \}/.test(SP));
  t('3-7 開いた時に控え、閉じた時に消す', /syncNewDlg\(\);\n  ND_SNAP = newDlgSnap\(\);/.test(cutF(SP, 'openNew')) && /ND_SNAP = null;/.test(cutF(SP, 'closeNew')));
  const rp = cutF(SP, 'offerReprice');
  t('3-8 付け直しの失敗は alert を使わない', !/alert\(/.test(rp), rp);
  t('3-9 付け直しの失敗は失敗の見た目の toast（文は「付け直せませんでした: 」のまま）', /toast\('付け直せませんでした: ' \+ errText\(e\) \+ ' ' \+ errHint\(e\), 'err'\);/.test(rp));
  t('3-10 失敗の見た目の色がある', /#toast\.err\{background:var\(--c-danger-bg\);color:var\(--c-danger\)/.test(SP));
  /* toast を動かす */
  const timers = [];
  const box = { textContent: '', cl: new Set(), classList: null };
  box.classList = { add: (c) => box.cl.add(c), remove: (c) => box.cl.delete(c), toggle: (c, on) => { if (on) box.cl.add(c); else box.cl.delete(c); } };
  const ctx = vm.createContext({ $: () => box, txt: (v) => String(v), setTimeout: (fn, ms) => { timers.push(ms); return 1; }, clearTimeout: () => {} });
  vm.runInContext(cutF(SP, 'toast'), ctx);
  vm.runInContext("toast('架空の失敗', 'err')", ctx);
  const errOn = box.cl.has('err') && box.cl.has('on') && timers[0] === 6000;
  vm.runInContext("toast('保存しました')", ctx);
  t('3-11 失敗の toast は赤系・6秒、ふつうの toast は今までどおり（赤系を外す・2.6秒）', errOn && !box.cl.has('err') && timers[1] === 2600, { errOn, cl: [...box.cl], timers });
}

console.log('\n— 3b. 消耗品管理：反証レビューの指摘（「閉じる」・Esc の続け押し）—');
{
  t('3-12 見出しの「閉じる」も確かめを通る', /\$\('ndClose'\)\.addEventListener\('click', function \(\) \{ if \(newDlgMayCancel\(\)\) closeNew\(\); \}\);/.test(SP));
  t('3-13 閉じる道を通らずに閉じた時（close）は守り直す', /\$\('newDlg'\)\.addEventListener\('close', function \(\) \{\n    if \(!newDlgKeepOnClose\(\)\) return;/.test(SP));
  function kp(answers) {
    const p = spPage(answers);
    vm.runInContext('var ND_SAID_NO = false;\n' + cutF(SP, 'newDlgKeepOnClose'), p.ctx);
    return p;
  }
  let p = kp([]); p.fields[0].value = '架空';
  vm.runInContext('ND_SAID_NO = true', p.ctx);
  t('3-14 「いいえ」と答えた後に Chrome が閉じたら、聞き直さず開き直す', vm.runInContext('newDlgKeepOnClose()', p.ctx) === true && p.log.confirms.length === 0 && vm.runInContext('ND_SAID_NO', p.ctx) === false, p.log);
  p = kp([false]); p.fields[0].value = '架空';
  t('3-15 確かめずに閉じた時は確かめ、「いいえ」なら開き直す', vm.runInContext('newDlgKeepOnClose()', p.ctx) === true && p.log.confirms.length === 1, p.log);
  p = kp([true]); p.fields[0].value = '架空';
  t('3-16 「はい」なら閉じたまま（控えを消す）', vm.runInContext('newDlgKeepOnClose()', p.ctx) === false && vm.runInContext('ND_SNAP', p.ctx) === null, p.log);
  p = kp([]);
  t('3-17 変えていなければ閉じたまま', vm.runInContext('newDlgKeepOnClose()', p.ctx) === false && p.log.confirms.length === 0);
  p = kp([]); p.save.disabled = true;
  t('3-18 登録中に閉じたら開き直す', vm.runInContext('newDlgKeepOnClose()', p.ctx) === true);
  p = kp([]); p.fields[0].value = '架空'; vm.runInContext('ND_SNAP = null', p.ctx);
  t('3-19 閉じる道（登録の後・「閉じる」・「はい」）を通った後は何もしない', vm.runInContext('newDlgKeepOnClose()', p.ctx) === false && p.log.confirms.length === 0);
  t('3-20 closeNew は控えと「いいえ」の印を消す・cancel で「いいえ」の印を付ける', /ND_SNAP = null;\n  ND_SAID_NO = false;/.test(cutF(SP, 'closeNew')) && /ND_SAID_NO = true; ev\.preventDefault\(\);/.test(SP));
}

/* ═══════════ 4. 入居調整 ═══════════ */
const AD = read('admission-flow.html');
console.log('\n— 4. 入居調整：ご家族・連携先の欄の見出し —');
{
  const seg = cutStmt(AD, "  h += '<div class=\"cd\"><h3>ご家族</h3>", "id=\"ctAdd\"");
  const labels = [...seg.matchAll(/<label( for="([\w-]+)' \+ i \+ '")?>/g)];
  const noFor = labels.filter((m) => !m[1]);
  t('4-1 ご家族3欄・連携先6欄の見出しに for（9個）', labels.length === 9 && noFor.length === 0, { n: labels.length, noFor: noFor.length });
  const fors = labels.map((m) => m[2]);
  const idsOk = fors.every((f) => seg.indexOf(' id="' + f + "' + i + '\"") >= 0);
  t('4-2 for と同じ id の入力欄がある', idsOk, fors);
  t('4-3 緊急連絡先のチェックは今までどおり見出しで包む', /<label class="chk"><input type="checkbox" data-famk="emergency"/.test(seg));
  /* 組み立てを動かして、行ごとに id が重ならないことを確かめる */
  const ctx = vm.createContext({ esc: (s) => String(s), CATS: [['cm', 'ケアマネージャー']], facFill: (s) => s });
  const body = seg.replace(/id="ctAdd"$/, '');
  const code = 'var h = ""; var r = { family: [{ name: "架空 一", relation: "子" }, { name: "架空 二" }], contacts: [{ cat: "cm", org: "架空事業所" }] };\n' + body.slice(0, body.lastIndexOf("h += '</div><div class=\"frow\">")) + '\nh';
  const html = vm.runInContext(code, ctx);
  const ids = [...html.matchAll(/ id="([\w-]+)"/g)].map((m) => m[1]).filter((x) => /^(fam|ct)-/.test(x));
  t('4-4 2人と1件で id 12個（3欄×2人＋6欄×1件）・重なりなし', ids.length === 12 && new Set(ids).size === 12, ids);
}

/* ═══════════ 5. 体重管理 ═══════════ */
const WR = read('weight-record.html');
console.log('\n— 5. 体重管理：サンプル投入の確かめ・見出し —');
{
  const h0 = WR.indexOf("$('#cfgSample').addEventListener('click'");
  const handler = WR.slice(h0, WR.indexOf("toast('サンプルを投入しました');", h0));
  /* 2026-11-12: 確かめは画面の中の窓（su-dialog.js）になり、答えを待つ形（await）で呼ぶ。確かめる順番・場所は今までどおり */
  const iConf = handler.indexOf('if(!(await wrSampleConfirm())) return;');
  t('5-1 現場の止め・同期中の止めの後、名簿に入れる前に必ず確かめる', iConf > handler.indexOf('wrSyncDeny()') && handler.indexOf('wrFieldDeny()') < iConf && iConf < handler.indexOf('DB.residents.push'), iConf);
  t('5-2 名簿の人数で確かめを飛ばさない（古い条件付きの確かめは無い）', !/DB\.residents\.length\s*>\s*0\s*&&\s*!confirm/.test(handler));
  const asked = [];
  /* 画面の中の窓は答えを約束（Promise）で返す。答えを待ってから、そのまま返しているかを確かめる */
  PENDING.push((async () => {
    for (const ans of [false, true]) {
      const ctx = vm.createContext({ SUDialog: { confirm: (m) => { asked.push(m); return Promise.resolve(ans); } } });
      vm.runInContext(cutStmt(WR, 'const WR_SAMPLE_MSG', ';').replace(/^const /, 'var ') + '\n' + cutF(WR, 'wrSampleConfirm'), ctx);
      t('5-3 答え ' + ans + ' をそのまま返す', (await vm.runInContext('wrSampleConfirm()', ctx)) === ans);
    }
    t('5-4 確かめの文', asked[0] === '架空の6名と12か月分の体重を、この名簿に入れて保存します。本番の名簿では使わないでください。入れますか？', asked[0]);
  })());
  t('5-5 ボタンは残す', /<button class="bn bs" id="cfgSample">サンプル投入<\/button>/.test(WR));
  t('5-6 空の時の案内に「サンプル投入」を出さない', /入居者が登録されていません。<br>「＋ 追加」から開始してください。/.test(WR) && !/または「サンプル投入」/.test(WR));
  const L = { inResident: '入居者', inMonth: '対象月', inDate: '測定日', inWeight: '体重', inRaw: '実測値（車椅子込み）', inChair: '車椅子重量', inNote: 'メモ（任意）' };
  const bad = Object.keys(L).filter((id) => WR.indexOf('<label class="fl" for="' + id + '">' + L[id]) < 0 || WR.indexOf('id="' + id + '"') < 0);
  t('5-7 入力画面の見出し7つに for', bad.length === 0, bad);
  t('5-8 個別推移の入居者の選択欄に読み上げの名前', /<select id="ivResident" aria-label="[^"]+"><\/select>/.test(WR));
}

/* ═══════════ 6. 入居者マスタ ═══════════ */
const RM = read('resident-master.html');
console.log('\n— 6. 入居者マスタ：検索欄の読み上げの名前 —');
t('6-1 一覧の検索欄', /<input type="search" id="q" [^>]*aria-label="[^"]+"/.test(RM));
t('6-2 一括編集の絞り込み欄', /<input type="search" id="bulkQ" [^>]*aria-label="[^"]+"/.test(RM));

Promise.all(PENDING).catch((e) => { fail++; console.log('  ✗ 答えを待つ試験で例外 ' + (e && e.message)); }).then(() => {
  console.log('\n' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
});
