/* 訪問俯瞰（visit-overview.html）・全支援俯瞰（support-overview.html）：総合事業の略称を週間計画の報酬マスタから作る（品質改善 第3期 便10・代表者の決定 2026-11-02）
   実行: node check/unit/sogo_label_test.js
   守ること:
     1. 2画面の印の区間（SOGO-LABEL-BEGIN〜END）が一字一句同じ
     2. この施設の報酬マスタ（care-schedule.html の RATE_MASTER_DEFAULT.sogoVisit）では今と同じ略称になる
     3. 架空の報酬マスタで差し替わる（知っている4コードだけ・マスタにだけあるコードは足さない・無いコードはそのコードだけ既定）
     4. 崩れた報酬マスタ（型・空・長さ・前後の空白・制御文字・配列・行が物でない）は表ごと既定
     5. 報酬マスタが無い時は今と一字一句同じ表
     6. 共有データを読む所で当てる（訪問俯瞰は描画の頭・全支援俯瞰は雲・端末の控え・どちらも無い時の3経路）
     7. 略称を画面に出す所は textContent・title・aria-label だけ
   ★略称・コード以外の値はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutBraces(src, head) {
  const h = src.indexOf(head);
  if (h < 0) return null;
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  return null;
}
function cutF(src, name) {
  const r = cutBraces(src, 'function ' + name + '(');
  if (!r) throw new Error('関数が見つかりません: ' + name);
  return r;
}
function region(src) {
  const a = src.indexOf('/* SOGO-LABEL-BEGIN'), b = src.indexOf('/* SOGO-LABEL-END */');
  if (a < 0 || b < 0 || b < a) return null;
  return src.slice(a, b + '/* SOGO-LABEL-END */'.length);
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const OLD = { 'A21121': '【A11】', 'A21221': '【A12】', 'A2111': '【A21】', 'A21211': '【A22】' };   // 直す前の表（今と同じ文字）

/* この施設の報酬マスタ（週間計画の既定）を care-schedule.html から切り出す */
const CS = fs.readFileSync(path.join(ROOT, 'care-schedule.html'), 'utf8');
const rmHead = CS.indexOf('const RATE_MASTER_DEFAULT');
const svSrc = rmHead >= 0 ? cutBraces(CS.slice(rmHead), 'sogoVisit:') : null;
const HOUSE_SV = svSrc ? vm.runInNewContext('(' + svSrc.slice('sogoVisit:'.length) + ')') : null;
t('週間計画の報酬マスタ（sogoVisit）を切り出せる', !!HOUSE_SV && typeof HOUSE_SV === 'object', svSrc && svSrc.slice(0, 40));

const SRCS = {};
for (const file of ['visit-overview.html', 'support-overview.html']) SRCS[file] = fs.readFileSync(path.join(ROOT, file), 'utf8');
const R1 = region(SRCS['visit-overview.html']), R2 = region(SRCS['support-overview.html']);
t('2画面に印の区間がある', !!R1 && !!R2, { visit: !!R1, support: !!R2 });
t('2画面の印の区間が一字一句同じ', !!R1 && R1 === R2, '');

for (const file of ['visit-overview.html', 'support-overview.html']) {
  const SRC = SRCS[file];
  console.log('\n— ' + file + ' —');
  const reg = region(SRC);
  if (!reg) { t('印の区間がある', false, file); continue; }
  const b = { Object, Array, JSON, String, Number };
  vm.createContext(b);
  vm.runInContext(cutBraces(SRC, 'const SVC_CLS = {') + ';\n' + reg + '\n' + cutF(SRC, 'codeClass') + '\n' + cutF(SRC, 'codeLabel')
    + '\nthis.__now = () => SOGO_LABEL_NOW; this.__def = () => SOGO_LABEL;', b);
  const lab = rm => { b.sogoLabelApply_(rm); return JSON.parse(JSON.stringify(b.__now())); };

  t('既定の表は直す前と一字一句同じ', same(b.__def(), OLD), b.__def());
  t('報酬マスタが無い時は今と同じ表', same(lab(undefined), OLD) && same(lab(null), OLD) && b.codeLabel('A21121') === '【A11】', lab(null));
  t('古い保存（rateMaster はあるが sogoVisit が無い）は今と同じ表', same(lab({ rev: 3 }), OLD), '');
  if (HOUSE_SV) {
    t('この施設の報酬マスタで今と同じ略称', same(lab({ sogoVisit: HOUSE_SV }), OLD), lab({ sogoVisit: HOUSE_SV }));
    t('この施設の報酬マスタで盤面の文字も今と同じ', Object.keys(OLD).every(c => b.codeLabel(c) === OLD[c]) && b.codeLabel('身体１') === '身体１' && b.codeLabel('') === '—', '');
  }

  /* 架空の報酬マスタ */
  const FAKE = { sogoVisit: {
    'A21121': { name: '見本の名称1', label: '【X1】', units: 1, mins: 45, step: 5 },
    'A21221': { name: '見本の名称2', label: '週2回型', units: 2, mins: 60, step: 5 },
    'A2111':  { name: '見本の名称3', label: '【独自３】', units: 3, mins: 45, step: 5 },
    'Z9999':  { name: '見本の名称9', label: '【Z9】', units: 9, mins: 45, step: 5 },   // 知らないコード
  } };
  const got = lab(FAKE);
  t('架空の報酬マスタで差し替わる', got.A21121 === '【X1】' && got.A21221 === '週2回型' && got.A2111 === '【独自３】', got);
  t('マスタに無いコードはそのコードだけ既定', got.A21211 === '【A22】', got);
  t('マスタにだけあるコードは足さない（略称も色も変えない）', !('Z9999' in got) && b.codeLabel('Z9999') === 'Z9999' && b.codeClass('Z9999') === 'oth', got);
  t('差し替えても色の分類は既定の4コードのまま', Object.keys(OLD).every(c => b.codeClass(c) === 'sogo'), '');
  t('盤面の文字が差し替わる', b.codeLabel('A21121') === '【X1】' && b.codeLabel('A21211') === '【A22】', '');
  t('ちょうど8字は使う・1字も使う', lab({ sogoVisit: { 'A21121': { label: '一二三四五六七八' }, 'A2111': { label: '甲' } } }).A21121 === '一二三四五六七八'
    && b.__now().A2111 === '甲', b.__now());
  t('タグに見える文字も文字のまま持つ（画面へは textContent で出す）', lab({ sogoVisit: { 'A21121': { label: '<b>x</b>' } } }).A21121 === '<b>x</b>', '');
  lab(FAKE);
  t('差し替えた後に報酬マスタが無くなれば既定に戻る（前の値を残さない）', same(lab(null), OLD), b.__now());

  /* 崩れた報酬マスタ（どれも他の行は正しい。1つの崩れで表ごと既定） */
  const ok2 = { label: '【良】' };
  const BROKEN = [
    ['rateMaster が配列', []],
    ['rateMaster が文字', 'x'],
    ['sogoVisit が配列', { sogoVisit: [ok2] }],
    ['sogoVisit が文字', { sogoVisit: '【A11】' }],
    ['行が null', { sogoVisit: { 'A21221': ok2, 'A21121': null } }],
    ['行が配列', { sogoVisit: { 'A21221': ok2, 'A21121': ['【A】'] } }],
    ['行が文字', { sogoVisit: { 'A21221': ok2, 'A21121': '【A】' } }],
    ['rateMaster が配列（中身は正しい形）', Object.assign([], { sogoVisit: { 'A21121': { label: '【配】' } } })],
    ['sogoVisit が配列（中身は正しい形）', { sogoVisit: Object.assign([], { 'A21121': { label: '【配】' } }) }],
    ['行が配列（略称は正しい形）', { sogoVisit: { 'A21221': ok2, 'A21121': Object.assign(['x'], { label: '【配】' }) } }],
    ['略称が無い', { sogoVisit: { 'A21221': ok2, 'A21121': { name: 'x' } } }],
    ['略称が数', { sogoVisit: { 'A21221': ok2, 'A21121': { label: 11 } } }],
    ['略称が空', { sogoVisit: { 'A21221': ok2, 'A21121': { label: '' } } }],
    ['略称が9字', { sogoVisit: { 'A21221': ok2, 'A21121': { label: '一二三四五六七八九' } } }],
    ['略称の前に空白', { sogoVisit: { 'A21221': ok2, 'A21121': { label: ' 【A】' } } }],
    ['略称の後ろに全角空白', { sogoVisit: { 'A21221': ok2, 'A21121': { label: '【A】　' } } }],
    ['略称に改行', { sogoVisit: { 'A21221': ok2, 'A21121': { label: '【A\n1】' } } }],
    ['略称に制御文字', { sogoVisit: { 'A21221': ok2, 'A21121': { label: '【A\u0007】' } } }],
  ];
  for (const [name, rm] of BROKEN) {
    lab(FAKE);   // 直前に差し替えた状態から崩れを当てる
    t('崩れ（' + name + '）は表ごと既定', same(lab(rm), OLD), b.__now());
  }
}

/* 共有データを読む所で当てる */
console.log('\n— 当てる所 —');
{
  const SRC = SRCS['visit-overview.html'];
  const r = cutBraces(SRC, 'function render(db) {') || '';
  const iApply = r.indexOf('sogoLabelApply_(db && db.rateMaster)'), iCollect = r.indexOf('collectVisits(');
  t('訪問俯瞰：描画の頭（盤面を組む前）で共有データの報酬マスタを当てる', iApply > 0 && iCollect > iApply, { iApply, iCollect });
  t('訪問俯瞰：codeLabel は今使う表を読む', /return SOGO_LABEL_NOW\[cat\]/.test(cutF(SRC, 'codeLabel')), '');
}
{
  const SRC = SRCS['support-overview.html'];
  t('全支援俯瞰：codeLabel は今使う表を読む', /return SOGO_LABEL_NOW\[code\]/.test(cutF(SRC, 'codeLabel')), '');
  const reg = region(SRC);
  if (reg) {
    function box(store, gas) {
      const b = { Object, Array, JSON, String, Number,
        localStorage: { getItem: k => (k in store ? store[k] : null) },
        CARE_KEY: 'care_schedule_v2', TARGET: { token: 'x' },
        maskFrom: () => ({ hosp: {}, moved: {}, ext: {}, cuts: {} }),
        gasCall: async () => { if (gas instanceof Error) throw gas; return gas; } };
      vm.createContext(b);
      vm.runInContext(reg + '\n' + cutF(SRC, 'codeLabel') + '\n' + cutF(SRC, 'loadMasksLocal') + '\n'
        + cutBraces(SRC, 'async function loadMasks()') + '\nthis.__now = () => SOGO_LABEL_NOW;', b);
      return b;
    }
    const rmA = { sogoVisit: { 'A21121': { label: '【雲】' } } };
    const rmB = { sogoVisit: { 'A21121': { label: '【控】' } } };
    const local = { care_schedule_v2: JSON.stringify({ residents: [], rateMaster: rmB }) };
    (async () => {
      let b = box(local, { ok: true, data: { residents: [], rateMaster: rmA } });
      await b.loadMasks();
      t('全支援俯瞰：雲から読めた時はその応答の報酬マスタ', b.codeLabel('A21121') === '【雲】', b.__now());
      b = box(local, new Error('通信の失敗（架空）'));
      await b.loadMasks();
      t('全支援俯瞰：雲が失敗した時は端末の控えの報酬マスタ', b.codeLabel('A21121') === '【控】', b.__now());
      b = box({}, new Error('通信の失敗（架空）'));
      b.sogoLabelApply_(rmA);
      await b.loadMasks();
      t('全支援俯瞰：どちらも無い時は既定に戻す', b.codeLabel('A21121') === '【A11】', b.__now());
      b = box({ care_schedule_v2: JSON.stringify({ residents: [] }) }, { ok: true, data: { residents: [] } });
      await b.loadMasks();
      t('全支援俯瞰：報酬マスタの無い古い保存は既定', same(JSON.parse(JSON.stringify(b.__now())), OLD), b.__now());
      sinks();
    })().catch(e => { t('全支援俯瞰の当てる所を動かせる', false, String(e)); sinks(); });
  } else { t('全支援俯瞰：印の区間がある', false, ''); sinks(); }
}

function sinks() {
  console.log('\n— 画面へ出す所 —');
  for (const file of ['visit-overview.html', 'support-overview.html']) {
    const lines = SRCS[file].split('\n').filter(l => /codeLabel\(/.test(l) && !/function codeLabel\(/.test(l));
    const okLine = l => /\.textContent = codeLabel\(/.test(l) || /\.title = /.test(l) || /const lbl = /.test(l);
    t(file + '：略称を出す所は textContent・title・aria-label だけ', lines.length > 0 && lines.every(okLine), lines);
    if (file === 'support-overview.html') {
      const s = SRCS[file];
      const i = s.indexOf("const lbl = ovLabel(b.name) + '　' + codeLabel(b.code)");
      const tail = i >= 0 ? s.slice(i, i + 600) : '';
      t(file + '：lbl は title と aria-label にだけ入る', /card\.title = lbl;/.test(tail) && /setAttribute\('aria-label', lbl\)/.test(tail) && !/innerHTML/.test(tail), '');
    }
  }
  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
}
