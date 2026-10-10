/* 全支援俯瞰（support-overview.html）・週間計画俯瞰（visit-overview.html）：現場の端末では氏名を姓だけで出す（2026-10-10 新設・監査10月版 第2版）
   実行: node check/unit/overview_field_surname_test.js
   守ること:
     ①事務所の端末（su_device_role が field 以外）はフルネームのまま
     ②現場の端末は姓だけ。姓の切れ目は「空白」か「週間計画の nameCut（文字数が合う時だけ）」。推測しない
     ③切れ目が分からない氏名は先頭2文字＋「…」（フルネームを出さない）
     ④同じ姓が2人以上なら「姓＋名の1文字目」、まだ重なれば2文字目まで（代表者の決定 A）
     ⑤カードの氏名・吹き出し（title）・読み上げ（aria-label）がすべて同じ表記
   ★氏名は全て架空。 */
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
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
}
const FNS = ['ovIsField_', 'ovSplitName_', 'ovNameLabeler_', 'ovCutsFrom_'];

for (const file of ['support-overview.html', 'visit-overview.html']) {
  const SRC = fs.readFileSync(path.join(ROOT, file), 'utf8');
  console.log('\n— ' + file + ' —');
  function box(role) {
    const store = role ? { su_device_role: role } : {};
    const b = { localStorage: { getItem: k => (k in store ? store[k] : null) }, String, Array, Set, Object, Math, Number };
    vm.createContext(b);
    vm.runInContext(FNS.map(n => cutF(SRC, n)).join('\n'), b);
    return b;
  }
  const residents = [
    { name: '架空一郎', nameCut: 2, nameCutLen: 4 },
    { name: '見本花子', nameCut: 2, nameCutLen: 4 },
    { name: '見本次郎', nameCut: 2, nameCutLen: 4 },
    { name: '試験一子', nameCut: 2, nameCutLen: 4 },
    { name: '試験一美', nameCut: 2, nameCutLen: 4 },
    { name: '仮名太郎', nameCut: 2, nameCutLen: 5 },      // 文字数が合わない（改名後の古い値）
    { name: '長谷部三郎' }                                 // 切れ目なし
  ];
  const names = residents.map(r => r.name).concat(['空白 有子']);
  {
    const b = box('office');
    const L = b.ovNameLabeler_(names, b.ovCutsFrom_(residents));
    t('事務所の端末はフルネームのまま', names.every(n => L(n) === n), names.map(L));
    const b2 = box(null);
    t('端末の役割が未設定でもフルネームのまま（現場と分かった時だけ姓）', b2.ovNameLabeler_(names, {})('架空一郎') === '架空一郎', '');
  }
  {
    const b = box('field');
    const L = b.ovNameLabeler_(names, b.ovCutsFrom_(residents));
    t('現場：切れ目（nameCut）で姓だけ', L('架空一郎') === '架空', L('架空一郎'));
    t('現場：氏名に空白があればその前が姓', L('空白 有子') === '空白', L('空白 有子'));
    t('現場：同じ姓が2人なら「姓＋名の1文字目」', L('見本花子') === '見本 花' && L('見本次郎') === '見本 次', [L('見本花子'), L('見本次郎')]);
    t('現場：名の1文字目まで同じなら2文字目まで', L('試験一子') === '試験 一子' && L('試験一美') === '試験 一美', [L('試験一子'), L('試験一美')]);
    t('現場：文字数が合わない切れ目は使わず、先頭2文字＋「…」', L('仮名太郎') === '仮名…', L('仮名太郎'));
    t('現場：切れ目が無い氏名も先頭2文字＋「…」（フルネームを出さない）', L('長谷部三郎') === '長谷…', L('長谷部三郎'));
    t('現場：どの表記もフルネームと同じにならない（4文字以上の氏名）', names.filter(n => n.replace(/\s/g, '').length >= 4).every(n => L(n) !== n && L(n) !== n.replace(/\s/g, '')), names.map(L));
    t('現場：画面に無い氏名を渡されても姓（または先頭2文字…）で返す', L('架空五郎') === '架空…' || L('架空五郎') === '架空', L('架空五郎'));
  }
  {
    const b = box('field');
    const m = b.ovCutsFrom_([{ name: '架空 一郎', nameCut: 2, nameCutLen: 4, room: '203', kana: 'カクウ' }, { name: '見本花子' }]);
    const vals = Object.keys(m).map(k => m[k]);
    t('切れ目の対応は数値2つだけを持ち、切れ目の無い人は持たない', Object.keys(m).length === 1 && Object.keys(m)[0] === '架空一郎' && vals.every(v => Object.keys(v).join() === 'cut,len' && Number.isInteger(v.cut) && Number.isInteger(v.len)), m);
  }
}

console.log('\n— 描画の出口 —');
{
  const SO = fs.readFileSync(path.join(ROOT, 'support-overview.html'), 'utf8');
  const VO = fs.readFileSync(path.join(ROOT, 'visit-overview.html'), 'utf8');
  t('全支援俯瞰：カードの氏名と吹き出し・読み上げ（lbl）が ovLabel を通る', /nm\.textContent = ovLabel\(b\.name\);/.test(SO) && /const lbl = ovLabel\(b\.name\) \+/.test(SO) && !/nm\.textContent = b\.name;/.test(SO), '');
  t('全支援俯瞰：入院・退去・外部の名寄せは元の氏名のまま（表示だけ変える）', /masks\.moved\[name\]/.test(SO) && /masks\.hosp\[b\.name\]/.test(SO), '');
  t('週間計画俯瞰：カードの氏名と吹き出しが ovLabel を通る', /nm\.textContent = ovLabel\(ev\.name\);/.test(VO) && /card\.title = ovLabel\(ev\.name\) \+/.test(VO) && !/nm\.textContent = ev\.name;/.test(VO), '');
  const a = FNS.map(n => cutF(SO, n)).join('\n'), b = FNS.map(n => cutF(VO, n)).join('\n');
  t('2画面の部品は一字一句同じ', a === b, '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
