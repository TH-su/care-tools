/* check/fixtures/care-plan-gate.mjs — 共通 DB の週間計画の保存（kv_put）の門の偽物（2026-11-27・試験だけで使う）
 *
 * 共通 DB（care-backend 0136）と同じ決まりを JS で持つ。中身の確かめ（planstale）も 0136 の private.cs_plan_reject_stale と同じ決まり・同じ理由の印（gen・from・gone）:
 *   1. 版の印の門: 保存済みか送ってきた data に予約（nextPlans が空でない）か planGen 1 以上の利用者がいる時、最上位の csAppVer（2026112701 以上）が無い保存は
 *      { ok:false, error:'oldapp', rev }（強制保存でも・競合より先）
 *   2. 中身の確かめ: 保存済みの利用者と比べて (a) planGen が下がる (b) planGen が同じ（1以上）で planFrom が違う (c) 保存済みの planGone にある id の予約が
 *      nextPlans にある、のどれかなら { ok:false, error:'planstale', rev, rid, reason }（強制保存でも・印つきでも）
 *   3. 版の食い違いは { ok:false, conflict:true, rev }（強制保存なら通す）
 *   4. 保存の前に最上位の csAppVer を取り除く
 * データはすべて架空。画面のコードは変えない。 */
export const MIN_APP_VER = 2026112701;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const genOf = (r) => { const g = isObj(r) ? r.planGen : 0; return typeof g === 'number' && isFinite(g) && g >= 0 && Math.floor(g) === g ? g : 0; };
export function planInUse(d) {
  return !!(isObj(d) && Array.isArray(d.residents) && d.residents.some((r) => isObj(r) && ((typeof r.planGen === 'number' && r.planGen >= 1) || (Array.isArray(r.nextPlans) && r.nextPlans.length > 0))));
}
export function verOk(d) { return isObj(d) && /^[0-9]{1,15}$/.test(String(d.csAppVer)) && Number(d.csAppVer) >= MIN_APP_VER; }
export function staleOf(cur, next) {
  if (!isObj(cur) || !Array.isArray(cur.residents) || !isObj(next) || !Array.isArray(next.residents)) return null;
  const byId = {};
  cur.residents.forEach((r) => { if (isObj(r) && typeof r.id === 'string' && !byId[r.id]) byId[r.id] = r; });
  for (const n of next.residents) {
    if (!isObj(n) || typeof n.id !== 'string' || !byId[n.id]) continue;
    const c = byId[n.id], cg = genOf(c), ng = genOf(n);
    if (ng < cg) return { rid: n.id, reason: 'gen' };
    if (ng === cg && cg >= 1 && String(c.planFrom == null ? '' : c.planFrom) !== String(n.planFrom == null ? '' : n.planFrom)) return { rid: n.id, reason: 'from' };
    const gone = new Set((Array.isArray(c.planGone) ? c.planGone : []).filter(isObj).map((g) => g.id));
    if ((Array.isArray(n.nextPlans) ? n.nextPlans : []).some((p) => isObj(p) && gone.has(p.id))) return { rid: n.id, reason: 'gone' };
  }
  return null;
}
/* state = { data, rev, log:[] }。b は kv_put の本文（p_key・p_rev・p_data・p_force）。opts.forceOld … いつも oldapp を返す */
export function kvPut(state, b, opts = {}) {
  if (b.p_key !== 'care_schedule_v2') return { ok: true, rev: 1 };
  const d = b.p_data;
  const entry = { ver: isObj(d) ? (d.csAppVer === undefined ? null : d.csAppVer) : null, force: !!b.p_force, result: '' };
  (state.log = state.log || []).push(entry);
  if (opts.forceOld || ((planInUse(state.data) || planInUse(d)) && !verOk(d))) { entry.result = 'oldapp'; return { ok: false, error: 'oldapp', rev: state.rev }; }
  const st = staleOf(state.data, d);
  if (st) { entry.result = 'planstale:' + st.reason; return { ok: false, error: 'planstale', rev: state.rev, rid: st.rid, reason: st.reason }; }
  if (!b.p_force && Number(b.p_rev) !== state.rev) { entry.result = 'conflict'; return { ok: false, conflict: true, rev: state.rev }; }
  const stored = Object.assign({}, d); delete stored.csAppVer;
  state.data = stored; state.rev++;
  entry.result = 'ok';
  return { ok: true, rev: state.rev };
}
