/* check/compare-calc.mjs — 画素の見比べ（compare.mjs）の判定の純関数（2026-11-17 新設）
 *
 *   import { baseMissingKind, baseShotReason } from './compare-calc.mjs';
 *
 * ・純関数だけ。ファイル・ブラウザに触れない（入口は check/compare.mjs・試験は check/unit/compare_base_missing_test.js）
 *
 * 直した後には絵があるのに、直す前（base）に絵が無い時の分け方（baseMissingKind）:
 *   'new'    … 本当に新しく足した画面・帳票＝比べない（今までどおり失敗にしない）
 *   'unshot' … 直す前を撮れなかった（比べていない）＝pc・印刷・帳票では失敗にする（iPhone は報告だけ）
 * 見分けは、直す前の metrics.json（snap.mjs が撮った記録）にその画面・帳票があるかで決める。エラーの文では決めない
 * （印刷の撮影の失敗は pc の errors に入るなど、表示ごとのエラーと絵が1対1でないため）。
 *   画面: 直す前の pages に無い → 'new'。ある → 'unshot'（撮ろうとして絵が残らなかった）
 *   帳票: 直す前の sheets に無い → 'new'。ある時は inDir（撮った木の check/fixtures にその帳票の材料があったか・snap.mjs が残す）で分ける。
 *         run.mjs は直した後の snap.mjs で直す前も撮るので、同じ PR で足した帳票は直す前にも「撮ろうとして撮れなかった」記録が残る。
 *         そのため直す前の木に材料が無い（inDir が false）時だけ 'new'。true か記録が無い時は 'unshot'
 *   直す前の metrics.json が読めない（null）時は、新しいとは言えないので 'unshot'
 */
export const SHOT_FAIL_RE = /^(開けない|撮影|PDF|帳票): /;

export function baseMissingKind(name, sheet, mb) {
  if (!mb || typeof mb !== 'object' || !mb.pages || typeof mb.pages !== 'object') return 'unshot';
  if (sheet) {
    const s = mb.sheets && typeof mb.sheets === 'object' ? mb.sheets[name] : null;
    if (!s) return 'new';
    return s.inDir === false ? 'new' : 'unshot';
  }
  return mb.pages[`${name}.html`] ? 'unshot' : 'new';
}

/* 報告に添える理由（直す前の記録にある撮影の失敗の文の頭・無ければ「記録なし」）。表示（view）の分を先に、無ければ画面全体から */
export function baseShotReason(name, sheet, view, mb) {
  const cut = (e) => String(e).split('\n')[0].slice(0, 60);
  if (!mb || !mb.pages) return '直す前の記録が読めない';
  let list = [];
  if (sheet) {
    const s = mb.sheets ? mb.sheets[name] : null;
    list = s && Array.isArray(s.errors) ? s.errors : [];
  } else {
    const p = mb.pages[`${name}.html`];
    const errs = p && p.errors && typeof p.errors === 'object' ? p.errors : {};
    const own = Array.isArray(errs[view]) ? errs[view] : [];
    list = own.some((e) => SHOT_FAIL_RE.test(String(e))) ? own : Object.values(errs).flat();
  }
  const hit = list.find((e) => SHOT_FAIL_RE.test(String(e)));
  return hit ? cut(hit) : '撮影の失敗の記録なし';
}

/* 「変えてよい画面」（--allow）の見分け（2026-11-21 compare.mjs から移す・run.mjs の撮り直しと同じ見分けにするため）
 *   makeAllowed('a.html,b') → (name) => boolean。名前の .html は外して比べる。帳票（<画面>__<帳票>）は、その画面を許していれば許す */
export function makeAllowed(allowArg) {
  const allow = new Set((allowArg ? String(allowArg).split(',') : []).map((s) => s.trim().replace(/\.html$/, '')).filter(Boolean));
  return (name) => allow.has(String(name).replace(/\.html$/, '')) || allow.has(String(name).split('__')[0]);
}

/* 揺れの確かめ（run.mjs）で撮り直す画面（2026-11-21 新設）
 *   recheckPages(first, allowArg) → { targets: ['x.html', ...], skipped: ['y.html', ...] }
 *   first は1回目の compare.json（null なら両方とも空）。違い（違いあり・大きさが違う）の出た画面を、帳票・PDF のページの分も画面ごとに集める。
 *   許した画面は違いがあっても合否に数えない（compare.mjs）ので、撮り直さず skipped に回す（撮り直しても判定が変わらない）。
 *   許していない画面は今までどおり targets に残す */
export function recheckPages(first, allowArg) {
  if (!first || typeof first !== 'object') return { targets: [], skipped: [] };
  const rows = [...(Array.isArray(first.results) ? first.results : []), ...(Array.isArray(first.pageRows) ? first.pageRows : [])];
  const pages = [...new Set(rows.filter((r) => r && (r.status === '違いあり' || r.status === '大きさが違う')).map((r) => String(r.name).split('__')[0] + '.html'))];
  const allowed = makeAllowed(allowArg);
  return { targets: pages.filter((p) => !allowed(p)), skipped: pages.filter((p) => allowed(p)) };
}
