/* 入居調整（admission-flow.html）── ご家族の番号（id）と消した印の試験（2026-11-13 新設・代表者の決定 2026-11-13）
   実行: node check/unit/admission_family_id_test.js
   守ること:
     1. 電話を直しても、別の端末の直す前の控えとの統合で二重にならない
     2. 消した家族が、別の端末の古い控えとの統合で戻らない（統合の向きを問わない）
     3. 番号の無い古い記録を読んでも消えない・二重にならない（2台が別々に読んでも同じ番号になる）
     4. 2台で別々の家族を足すと両方残る
     5. 表示・入居者マスタへの転載の数え方では消した家族を出さない／取り消しで電話の直しと消した行が戻る
   ★氏名・電話は全て架空。 */
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
function box() {
  const b = { window: {}, Date, String, Math, Array, Object, JSON, Number };
  vm.createContext(b);
  vm.runInContext([line(/var DB_V = [^\n]*/), line(/var STAGES = \[[\s\S]*?\];/), line(/var STAGE_MIGRATE = [^\n]*/),
    line(/var CLEAR_META = \{[\s\S]*?\};/), line(/var CLEAR_MARK_RE = [^\n]*/), line(/var UNDO_ARRAY_KEYS = [^\n]*/),
    ...['newId', 'nowIso', 'isObj', 'asObj', 'asArr', 'asStr', 'stageIdx', 'isBlankVal', 'clearHash', 'parseClearMark', 'pickClearMark', 'reviveMark',
        'applyCleared', 'famLegacyKey_', 'famLegacyId_', 'famEnsureIds_', 'famLive_', 'normalizeCand', 'normalizeDb',
        'mergeById', 'mergeShallowPreferFilled', 'mergeAssess', 'mergeCand', 'mergeDb', 'undoKeyOf', 'afCanon_', 'undoApply'].map(cutF)].join('\n'), b);
  return b;
}
const T0 = '2026-11-13T01:00:00.000Z', T1 = '2026-11-13T02:00:00.000Z', T2 = '2026-11-13T03:00:00.000Z';
const clone = o => JSON.parse(JSON.stringify(o));
/* 番号の無い古い記録（この直しより前の形）。架空の家族2人 */
const legacy = () => ({ id: 'c1', name: '架空 太郎', stage: 'inquiry', stageDates: {}, contacts: [], tasks: [], log: [], nudges: [], assess: {},
  deleted: false, updatedAt: T0,
  family: [{ name: '架空 花子', relation: '長女', phone: '000-0000-0001', emergency: true },
           { name: '架空 次郎', relation: '長男', phone: '000-0000-0002', emergency: false }] });
const db = c => ({ v: 2, updatedAt: c.updatedAt, candidates: [c] });
const fam = (d) => d.candidates[0].family;
const live = (b, d) => b.famLive_(fam(d));

console.log('\n— 3. 番号の無い古い記録を読む —');
{
  const b1 = box(), b2 = box();
  const A = b1.normalizeDb(clone(db(legacy())));
  const B = b2.normalizeDb(clone(db(legacy())));
  t('古い記録を読んでも2人のまま（消えない）', fam(A).length === 2 && fam(A)[0].name === '架空 花子', fam(A));
  t('全員に番号が付く', fam(A).every(f => typeof f.id === 'string' && f.id.length > 4), fam(A).map(f => f.id));
  t('2台が別々に読んでも同じ番号になる', fam(A).map(f => f.id).join() === fam(B).map(f => f.id).join(), [fam(A).map(f => f.id), fam(B).map(f => f.id)]);
  t('番号は案件の中で重ならない', new Set(fam(A).map(f => f.id)).size === 2, '');
  const M = b1.mergeDb(A, B);
  t('別々に読んだ2台の統合で二重にならない', fam(M).length === 2, fam(M));
  const M2 = b1.mergeDb(A, b1.normalizeDb(clone(db(legacy()))));
  t('片方が今読んだ古い記録でも二重にならない', fam(M2).length === 2, fam(M2));
  /* 同じ人が2行ある古い記録（そのまま2行として残す） */
  const dup = legacy(); dup.family.push(clone(dup.family[0]));
  const D = b1.normalizeDb(clone(db(dup)));
  t('同じ内容の2行は別の番号で2行のまま', fam(D).length === 3 && new Set(fam(D).map(f => f.id)).size === 3, fam(D).map(f => f.id));
  t('同じ内容の2行も2台で同じ番号', fam(D).map(f => f.id).join() === fam(b2.normalizeDb(clone(db(dup)))).map(f => f.id).join(), '');
  const other = legacy(); other.id = 'c2';
  const O = b1.normalizeDb(clone(db(other)));
  t('別の案件の同じ内容の行とは番号が重ならない（台帳の中で番号が一意）', fam(O).every(f => !fam(A).some(g => g.id === f.id)), '');
  t('番号は id を持つ行には付け直さない', b1.normalizeDb(clone(A)).candidates[0].family.map(f => f.id).join() === fam(A).map(f => f.id).join(), '');
  t('消した印の項目は生きている行に足さない（保存の形は id が増えるだけ）',
    fam(A).every(f => !('deleted' in f) && !('deletedAt' in f) && !('updatedAt' in f)), fam(A));
}

console.log('\n— 1. 電話を直しても二重にならない —');
{
  const b = box();
  const base = b.normalizeDb(clone(db(legacy())));
  const A = clone(base); fam(A)[0].phone = '000-0000-0099'; A.candidates[0].updatedAt = T1;      /* 端末A で電話を直した */
  const Bold = b.normalizeDb(clone(db(legacy())));                                                /* 端末B の直す前の控え（番号無しの古い形） */
  [['A→B', b.mergeDb(A, Bold)], ['B→A', b.mergeDb(Bold, A)]].forEach(([nm, M]) => {
    t('統合 ' + nm + ': 2人のまま', fam(M).length === 2, fam(M));
    const h = fam(M).find(f => f.name === '架空 花子');
    t('統合 ' + nm + ': 直した電話が残る', h && h.phone === '000-0000-0099', h);
  });
  /* 番号付きの控えどうしでも同じ */
  const Bnew = clone(base);
  t('番号付きの控えとの統合でも2人のまま', fam(b.mergeDb(A, Bnew)).length === 2 && fam(b.mergeDb(Bnew, A)).length === 2, '');
  t('統合の向きで結果が変わらない', JSON.stringify(fam(b.mergeDb(A, Bnew))) === JSON.stringify(fam(b.mergeDb(Bnew, A))), '');
}

console.log('\n— 2. 消した家族が古い控えとの統合で戻らない —');
{
  const b = box();
  const base = b.normalizeDb(clone(db(legacy())));
  const A = clone(base);
  fam(A)[1].deleted = true; fam(A)[1].deletedAt = T1; A.candidates[0].updatedAt = T1;
  const Bold = b.normalizeDb(clone(db(legacy())));
  [['A→B', b.mergeDb(A, Bold)], ['B→A', b.mergeDb(Bold, A)]].forEach(([nm, M]) => {
    t('統合 ' + nm + ': 行は墓標として残る（記録を消さない）', fam(M).length === 2, fam(M));
    t('統合 ' + nm + ': 消した家族は戻らない', live(b, M).length === 1 && live(b, M)[0].name === '架空 花子', live(b, M));
  });
  /* 古い控えの方が後に別の欄を保存した（案件の時刻が新しい）時も戻らない */
  const Blater = clone(Bold); Blater.candidates[0].note = '別の欄の直し'; Blater.candidates[0].updatedAt = T2;
  const M3 = b.mergeDb(A, Blater);
  t('古い控えが後から別の欄を保存しても消した家族は戻らない', live(b, M3).length === 1, live(b, M3));
  t('その時も別の欄の直しは残る', M3.candidates[0].note === '別の欄の直し', M3.candidates[0].note);
  t('墓標は deleted と deletedAt を持つ', fam(M3).some(f => f.deleted === true && f.deletedAt === T1), fam(M3));
}

console.log('\n— 4. 2台で別々の家族を足すと両方残る —');
{
  const b = box();
  const base = b.normalizeDb(clone(db(legacy())));
  const A = clone(base); fam(A).push({ id: b.newId('f'), name: '架空 三郎', relation: '孫', phone: '', emergency: false }); A.candidates[0].updatedAt = T1;
  const B = clone(base); fam(B).push({ id: b.newId('f'), name: '架空 四子', relation: '姪', phone: '', emergency: false }); B.candidates[0].updatedAt = T2;
  const M = b.mergeDb(A, B);
  t('両方の家族が残る（4人）', fam(M).length === 4, fam(M).map(f => f.name));
  t('足した2人が入っている', ['架空 三郎', '架空 四子'].every(n => fam(M).some(f => f.name === n)), '');
  /* 同じ内容の行を2台で別々に足しても、番号が違うので両方残る（人が見て消せる・消えるよりよい） */
  const C = clone(base); fam(C).push({ id: b.newId('f'), name: '', relation: '', phone: '', emergency: false });
  const E = clone(base); fam(E).push({ id: b.newId('f'), name: '', relation: '', phone: '', emergency: false });
  t('空の行を2台で足しても両方残る', fam(b.mergeDb(C, E)).length === 4, '');
}

console.log('\n— 5. 画面・転載・取り消し —');
{
  t('表示の4か所と転載は消した行を除く famLive_ を通す',
    /v\.push\('ご家族' \+ famLive_\(c\.family\)\.length/.test(SRC) &&
    /famLive_\(c\.family\)\.map\(function \(f\) \{\s*return esc\(f\.name/.test(SRC) &&
    /rec\.family = famLive_\(c\.family\)\.map/.test(SRC) &&
    /row\('ご家族', famLive_\(c\.family\)\.map/.test(SRC), '');
  t('編集画面は消した行を出さない（配列の位置はそのまま）', /r\.family\.forEach\(function \(f, i\) \{\s*\/\*[^*]*\*\/\s*if \(f && f\.deleted\) return;/.test(SRC), '');
  t('新しく足す行は newId(\'f\') の番号を持つ', /editing\.family\.push\(\{ id: newId\('f'\)/.test(SRC), '');
  t('保存済みの行の ✕ は墓標にする', /if \(saved\) \{ fr\.deleted = true; fr\.deletedAt = nowIso\(\); \}/.test(SRC), '');
  t('normalizeCand が番号を付ける', /famEnsureIds_\(c\.family, c\.id\);/.test(cutF('normalizeCand')), '');

  const b = box();
  const pre = b.normalizeCand(clone(legacy()));
  /* 電話の直しを取り消す */
  const post = clone(pre); post.family[0].phone = '000-0000-0099';
  const cur = clone(post);
  b.undoApply(cur, clone(pre), clone(post));
  t('取り消しで電話の直しが戻る', cur.family.length === 2 && cur.family[0].phone === '000-0000-0001', cur.family);
  /* 消したのを取り消す: 墓標は残し、新しい番号で入れ直す */
  const post2 = clone(pre); post2.family[1].deleted = true; post2.family[1].deletedAt = T1;
  const cur2 = clone(post2);
  b.undoApply(cur2, clone(pre), clone(post2));
  t('取り消しで消した家族が見えるようになる', b.famLive_(cur2.family).length === 2 && b.famLive_(cur2.family).some(f => f.name === '架空 次郎'), cur2.family);
  t('墓標は残る（他の端末の墓標との統合で消えない）', cur2.family.some(f => f.deleted && f.id === pre.family[1].id), cur2.family);
  const other = clone(post2); other.updatedAt = T0;
  const after = clone(cur2); after.updatedAt = T2;
  const M = b.mergeCand(after, other);
  t('取り消した後に墓標を持つ端末と統合しても戻した家族は残る', b.famLive_(M.family).some(f => f.name === '架空 次郎'), M.family);
  /* 他の端末が後から直した行は取り消しで触らない */
  const cur3 = clone(post); cur3.family[0].phone = '000-0000-0077';
  b.undoApply(cur3, clone(pre), clone(post));
  t('他の端末が後から直した行は取り消しで戻さない', cur3.family[0].phone === '000-0000-0077', cur3.family);
  /* 新しい保存先は項目の並びを変えて返す。並びが違っても同じ姿なら戻す */
  const cur4 = clone(post); cur4.family = cur4.family.map(f => { const o = {}; Object.keys(f).reverse().forEach(k => { o[k] = f[k]; }); return o; });
  b.undoApply(cur4, clone(pre), clone(post));
  t('項目の並びが違う今の姿でも電話の直しが戻る', cur4.family[0].phone === '000-0000-0001', cur4.family);
  /* 編集の保存は操作の直後の姿（post）を残さない。その時も戻る */
  const cur5 = clone(post);
  b.undoApply(cur5, clone(pre), null);
  t('直後の姿が無い時（編集の保存）も電話の直しが戻る・二重にならない', cur5.family.length === 2 && cur5.family[0].phone === '000-0000-0001', cur5.family);
  const cur6 = clone(post2);
  b.undoApply(cur6, clone(pre), null);
  t('直後の姿が無い時も消した家族が見えるようになる（墓標は残す）',
    b.famLive_(cur6.family).length === 2 && cur6.family.some(f => f.deleted && f.id === pre.family[1].id), cur6.family);
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
