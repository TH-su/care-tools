/* 入居調整（admission-flow.html）── ご家族の番号（id）と消した印の試験（2026-11-13 新設・代表者の決定 2026-11-13）
   実行: node check/unit/admission_family_id_test.js
   守ること:
     1. 電話を直しても、別の端末の直す前の控えとの統合で二重にならない
     2. 消した家族が、別の端末の古い控えとの統合で戻らない（統合の向きを問わない）
     3. 番号の無い古い記録を読んでも消えない・二重にならない（2台が別々に読んでも同じ番号になる）
     4. 2台で別々の家族を足すと両方残る
     5. 表示・入居者マスタへの転載の数え方では消した家族を出さない／取り消しで電話の直しと消した行が戻る
     6. 行ごとの時刻（updatedAt）: 古い控えの端末が後から別の欄を保存しても、直した電話・空にした電話が戻らない
     7. 番号は1つの案件の中で重ならない（PR #550 の反証レビュー）／編集の保存は家族を番号で突き合わせる・編集中は取り直さない
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
        'applyCleared', 'famLegacyKey_', 'famLegacyId_', 'famEnsureIds_', 'famStamp_', 'famSaveMerge_', 'famLive_', 'normalizeCand', 'normalizeDb',
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
  t('読んだだけでは id 以外の項目を足さない（消した印・時刻は付けない）',
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

console.log('\n— 6. 行ごとの時刻 —');
{
  const b = box();
  const base = b.normalizeDb(clone(db(legacy())));
  /* A が電話を直して保存（行に時刻）。B は古い控えのまま別の欄を保存し、案件は B の方が新しい */
  const mk = (phone) => {
    const A = clone(base); const before = clone(fam(A));
    fam(A)[0].phone = phone; b.famStamp_(before, fam(A), T1); A.candidates[0].updatedAt = T1;
    const B = b.normalizeDb(clone(db(legacy()))); B.candidates[0].note = 'Bの直し'; B.candidates[0].updatedAt = T2;
    return [A, B];
  };
  const [A, B] = mk('000-0000-0099');
  t('直した行にだけ時刻が入る', fam(A)[0].updatedAt === T1 && !('updatedAt' in fam(A)[1]), fam(A));
  [['A→B', b.mergeDb(A, B)], ['B→A', b.mergeDb(B, A)]].forEach(([nm, M]) => {
    const h = fam(M).find(f => f.name === '架空 花子');
    t('統合 ' + nm + ': 古い控えの B が後から保存しても A の電話が残る', h && h.phone === '000-0000-0099' && fam(M).length === 2, fam(M));
    t('統合 ' + nm + ': B の別の欄の直しも残る', M.candidates[0].note === 'Bの直し', M.candidates[0].note);
  });
  const [A2, B2] = mk('');
  [['A→B', b.mergeDb(A2, B2)], ['B→A', b.mergeDb(B2, A2)]].forEach(([nm, M]) => {
    const h = fam(M).find(f => f.name === '架空 花子');
    t('統合 ' + nm + ': 空にした電話が古い控えの値で埋まらない', h && h.phone === '', h);
  });
  /* 両方に時刻があれば新しい方 */
  const C = clone(base); fam(C)[0].phone = '000-0000-0011'; fam(C)[0].updatedAt = T2; C.candidates[0].updatedAt = T0;
  const D = clone(base); fam(D)[0].phone = '000-0000-0022'; fam(D)[0].updatedAt = T1; D.candidates[0].updatedAt = T2;
  t('両方に時刻があれば行の時刻の新しい方（案件の新しさは問わない）',
    fam(b.mergeDb(C, D))[0].phone === '000-0000-0011' && fam(b.mergeDb(D, C))[0].phone === '000-0000-0011', fam(b.mergeDb(C, D)));
  /* 時刻の無い古い行どうしは今までどおり新しい案件の側 */
  const E = clone(base); fam(E)[0].phone = '000-0000-0033'; E.candidates[0].updatedAt = T2;
  const F = clone(base); F.candidates[0].updatedAt = T1;
  t('時刻の無い古い行どうしは新しい案件の側', fam(b.mergeDb(E, F))[0].phone === '000-0000-0033' && fam(b.mergeDb(F, E))[0].phone === '000-0000-0033', '');
  /* 消した印は時刻に関わらず残す */
  const G = clone(base); fam(G)[1].deleted = true; fam(G)[1].deletedAt = T1; fam(G)[1].updatedAt = T1; G.candidates[0].updatedAt = T1;
  const H = clone(base); fam(H)[1].phone = '000-0000-0044'; fam(H)[1].updatedAt = T2; H.candidates[0].updatedAt = T2;
  [['G→H', b.mergeDb(G, H)], ['H→G', b.mergeDb(H, G)]].forEach(([nm, M]) => {
    t('統合 ' + nm + ': 消した後に別の端末が直した行でも消したまま', live(b, M).length === 1 && fam(M).some(f => f.deleted && f.deletedAt === T1), fam(M));
  });
  /* famStamp_: 足した行・消した行に時刻、変わっていない行には入れない（項目の並びは問わない） */
  const before = clone(fam(base));
  const list = clone(fam(base)).map(f => { const o = {}; Object.keys(f).reverse().forEach(k => { o[k] = f[k]; }); return o; });
  list[1].deleted = true; list[1].deletedAt = T2; list.push({ id: 'fnew', name: '架空 三郎', relation: '孫', phone: '', emergency: false });
  b.famStamp_(before, list, T2);
  t('famStamp_: 消した行と足した行に時刻・変わらない行には入れない', !('updatedAt' in list[0]) && list[1].updatedAt === T2 && list[2].updatedAt === T2, list);
  t('編集の保存は famStamp_ を通す', /var famAt = nowIso\(\);\s*famStamp_\(asObj\(editBase\)\.family, editing\.family, famAt\);/.test(cutF('saveEdit')), '');
  /* 取り消しで戻した行は今の時刻になり、直した後の姿を持つ端末との統合でも戻したまま */
  const pre = b.normalizeCand(clone(legacy()));
  const post = clone(pre); post.family[0].phone = '000-0000-0099'; post.family[0].updatedAt = T1; post.updatedAt = T1;
  const cur = clone(post);
  b.undoApply(cur, clone(pre), clone(post)); cur.updatedAt = T2;
  t('取り消しで戻した行に時刻が入る', cur.family[0].phone === '000-0000-0001' && cur.family[0].updatedAt > T1, cur.family[0]);
  const M = b.mergeCand(clone(post), cur);
  t('戻した後に直した姿を持つ端末と統合しても戻したまま', M.family[0].phone === '000-0000-0001', M.family[0]);
}

console.log('\n— 7. 番号の重なり・編集の保存 —');
{
  const b = box();
  /* 番号ありの行（電話を直した後）と、古い版のタブが残した同じ鍵の番号なしの行 */
  const A = b.normalizeCand(clone(legacy()));
  A.family[0].phone = '000-0000-0099'; A.family[0].updatedAt = T1; A.updatedAt = T1;
  const oldTab = clone(A); oldTab.family.push(clone(legacy().family[0])); oldTab.updatedAt = T2;
  const N = b.normalizeCand(clone(oldTab));
  t('番号ありの行と同じ鍵の番号なしの行に別の番号', new Set(N.family.map(f => f.id)).size === 3, N.family.map(f => f.id));
  t('2台で読んでも同じ番号', N.family.map(f => f.id).join() === b.normalizeCand(clone(oldTab)).family.map(f => f.id).join(), '');
  const before = clone(N.family); N.family[2].deleted = true; N.family[2].deletedAt = T2; b.famStamp_(before, N.family, T2); N.updatedAt = T2;
  const M = b.mergeCand(N, b.normalizeCand(clone(oldTab)));
  t('古い行を消しても、直した花子は消えない', b.famLive_(M.family).some(f => f.name === '架空 花子' && f.phone === '000-0000-0099') && b.famLive_(M.family).length === 2, M.family);
  /* 同じ番号が2行 */
  const D = clone(A); D.family.push(Object.assign(clone(A.family[1]), { phone: '000-0000-0055' }));
  const ND = b.normalizeCand(clone(D));
  t('同じ番号が2行あれば後の行に付け直す（前の行の番号はそのまま）',
    new Set(ND.family.map(f => f.id)).size === 3 && ND.family[1].id === A.family[1].id && ND.family[2].id !== A.family[1].id, ND.family.map(f => f.id));
  t('付け直す番号も2台で同じ', ND.family.map(f => f.id).join() === b.normalizeCand(clone(D)).family.map(f => f.id).join(), '');
  const bd = clone(ND.family); ND.family[2].deleted = true; ND.family[2].deletedAt = T2; b.famStamp_(bd, ND.family, T2); ND.updatedAt = T2;
  const MD = b.mergeCand(ND, b.normalizeCand(clone(D)));
  t('付け直した行を消しても前の行は残る', b.famLive_(MD.family).length === 2 && b.famLive_(MD.family).some(f => f.id === A.family[1].id), MD.family);

  /* 編集の保存: 編集の間に他の端末が1行目を消し・孫を足し・2行目の電話を直した。編集では新しい行を足しただけ */
  const base = b.normalizeCand(clone(legacy())).family;
  const cur = clone(base);
  cur[0].deleted = true; cur[0].deletedAt = T1; cur[0].updatedAt = T1;
  cur.push({ id: 'fother', name: '架空 三郎', relation: '孫', phone: '', emergency: false, updatedAt: T1 });
  cur[1].phone = '000-0000-0066'; cur[1].updatedAt = T1;
  const ed = clone(base); ed.push({ id: 'fmine', name: '架空 四子', relation: '姪', phone: '', emergency: false });
  b.famStamp_(base, ed, T2);
  const out = b.famSaveMerge_(cur, base, ed, T2);
  t('保存: 他の端末の消した印が残る', out.some(f => f.id === base[0].id && f.deleted), out);
  t('保存: 他の端末が足した家族が残る', out.some(f => f.id === 'fother'), out);
  t('保存: 編集で変えていない行は他の端末の直しのまま', out.find(f => f.id === base[1].id).phone === '000-0000-0066', out);
  t('保存: 編集で足した行が入る', out.some(f => f.id === 'fmine' && f.updatedAt === T2), out);
  /* 編集で直した行は時刻の新しい方。消した行を編集で直しても消したまま */
  const ed2 = clone(base); ed2[1].phone = '000-0000-0077'; ed2[0].phone = '000-0000-0088';
  b.famStamp_(base, ed2, T2);
  const out2 = b.famSaveMerge_(cur, base, ed2, T2);
  t('保存: 編集で直した行は新しい方（編集の行）', out2.find(f => f.id === base[1].id).phone === '000-0000-0077', out2);
  t('保存: 他の端末が消した行は、編集で直しても消したまま', out2.find(f => f.id === base[0].id).deleted === true, out2);
  const cur3 = clone(cur); cur3[1].updatedAt = '2026-11-13T09:00:00.000Z';
  const out3 = b.famSaveMerge_(cur3, base, ed2, T2);
  t('保存: 今の行の方が新しい時は今の行', out3.find(f => f.id === base[1].id).phone === '000-0000-0066', out3);
  /* 時計の進んだ端末が前に直した行（今の行の時刻が1時間先）でも、編集の間に触られていなければ編集が残る */
  const FUT = '2026-11-13T04:00:00.000Z';
  const base4 = b.normalizeCand(clone(legacy())).family; base4[0].phone = '000-0000-0010'; base4[0].updatedAt = FUT;
  const cur4 = clone(base4);
  const ed4 = clone(base4); ed4[0].phone = '000-0000-0020';
  b.famStamp_(base4, ed4, T2);
  const out4 = b.famSaveMerge_(cur4, base4, ed4, T2);
  t('保存: 今の行の時刻が1時間先でも、編集の間に触られていなければ編集が残る', out4[0].phone === '000-0000-0020' && out4[0].updatedAt === T2, out4[0]);
  /* 編集の間に今の行も変わっていた時は時刻の新しい方 */
  const cur5 = clone(base4); cur5[0].phone = '000-0000-0030'; cur5[0].updatedAt = '2026-11-13T05:00:00.000Z';
  t('保存: 編集の間に今の行も変わっていれば時刻の新しい方', b.famSaveMerge_(cur5, base4, ed4, T2)[0].phone === '000-0000-0030', '');
  t('saveEdit は家族を famSaveMerge_ で突き合わせる', /target\.family = famSaveMerge_\(target\.family, asObj\(editBase\)\.family, editing\.family, famAt\);/.test(cutF('saveEdit')), '');
  /* 2026-11-13 PR #566 の反証: つながった時の取り直しは afOnlinePull_ へ分けた（窓の間は窓の後へ回す）。編集中に取り直さない確かめは同じ */
  t('online の出来事は編集中に取り直さない', /addEventListener\('online'[\s\S]{0,400}afOnlinePull_\(\);/.test(SRC)
    && /function afOnlinePull_\(\) \{[\s\S]{0,300}if \(!busyEditing\(\) && Date\.now\(\) - lastPullAt > 60000\) pull\(false\);/.test(SRC), '');
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
