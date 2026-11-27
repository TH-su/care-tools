/* care-plan-calc.js — 週間計画の「計画の版」（履歴・予約・版ごとの介護度）の純関数（2026-11-27 新設・代表者の依頼）
 *
 * 週間計画の利用者（共有データ care_schedule_v2 の1人分）に足す項目 planFrom・planGen・planLevel・planNote・nextPlans・planGone を
 * 読む・入れ替える・統合するための決まりだけを持つ。画面（週間計画）と試験（check/unit/care_plan_calc_test.js）が使う。
 * DOM・localStorage・通信には触れない。引数は書き換えず、変える時は新しい写しを返す（呼び出し側が差し替える）。
 *
 * 約束:
 *   1. 予約の無い利用者では、どの関数も何も変えない（events・careLevel を1バイトも変えず、項目も足さない）
 *   2. 「その日に効く予約」の選び方は1つ（normPlans → effectivePlans_）。eventsFor・levelFor・applyDue・resolveLevel・planSummary は effectivePlans_ を、
 *      validatePlanInput は normPlans を通る
 *   3. applyDue は同じ入力なら必ず同じ出力（id を作らない・時刻は引数だけ・nowIso は res に書かない・配列の並びで答えが変わらない）。
 *      予定の id は予約に入っていたまま
 *   9. 切替で使った予約（入れ替えた・同じ開始日で負けた）は planGone に {id, at: その予約の from} で載る（applyDue）
 *   4. 統合（mergePlans）は planGen の大きい側を正にする。小さい側の未送信の予定の編集で、切り替えた後の計画を上書きしない
 *   5. 介護度は今の週間計画の値（'要支援1'…'要介護5'・未設定の ''）をそのまま文字として比べる（trim・全角半角の変換はしない。
 *      undefined・null は '' とみなす）。事業対象者は未設定（''）のまま登録する運用なので、'' も正規の値
 *   6. 形の崩れた入力（null・配列でない nextPlans・from が日付でない予約・events が配列でない等）で例外を出さない。
 *      崩れた予約は効かない物として扱い、保存データからは消さない
 *   7. 「今日」は日本時間の暦の日付（toISOString を使わない）
 *   8. 文は画面が作る。ここは材料（notice・diffEvents の1行の要約だけは例外）を返す
 *
 * 仮置き（2026-11-27・段1）:
 *   - applyDue の steps[].to は「前の計画の最後の日（予約の from の前日）」
 *   - resolveLevel の mismatch の notice.from は、引数 planFrom があればその値、無ければ ''
 *   - from が同じ予約が2つある時は updatedAt の新しい方（同じなら id の大きい方）だけを効く物とし、applyDue で切り替えた時は負けた方も nextPlans から外す
 */
(function (root) {
  'use strict';

  var VERSION = '2026-11-27';
  var NOTE_MAX = 80;
  var GONE_MAX = 20;
  /* diffEvents と mergePlans の droppedMine が比べる項目（units と著者印は比べない） */
  var EV_FIELDS = ['dayOfWeek', 'serviceType', 'startTime', 'endTime', 'category', 'bathing', 'detail', 'notes'];
  var EV_LABELS = { dayOfWeek: '曜日', serviceType: '種類', startTime: '開始', endTime: '終了', category: '区分', bathing: '入浴', detail: '支援内容', notes: 'メモ' };

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function str(x) { return x === undefined || x === null ? '' : String(x); }
  function gen(res) { var g = isObj(res) ? res.planGen : 0; return typeof g === 'number' && isFinite(g) && g >= 0 && Math.floor(g) === g ? g : 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ms(s) { var t = Date.parse(str(s)); return isNaN(t) ? -Infinity : t; }
  /* 予約の介護度・メモは文字の時だけ使う（文字でない値は空とみなす・2026-11-27 反証レビュー）。メモの80字は文字の数（コードポイント）で切る */
  function planLv(p) { return isObj(p) && typeof p.careLevel === 'string' ? p.careLevel : ''; }
  function planNoteOf(p) { return isObj(p) && typeof p.note === 'string' ? Array.from(p.note).slice(0, NOTE_MAX).join('') : ''; }

  /* ── 日付 ── */
  function todayJst(nowMs) {
    var t = nowMs === undefined ? Date.now() : nowMs;
    if (typeof t !== 'number' || !isFinite(t)) return '';
    var d = new Date(t + 9 * 3600000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function isYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (m < 1 || m > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function prevDay(ymd) {
    if (!isYmd(ymd)) return '';
    var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /* ── 予約の並び・形 ── */
  function validPlan(p) { return isObj(p) && typeof p.id === 'string' && p.id !== '' && isYmd(p.from) && Array.isArray(p.events); }
  /* 並びの決まり: from の昇順 → updatedAt の新しい順 → id の大きい順（2台で並びが違っても同じ答え） */
  function cmpPlan(a, b) {
    var fa = str(a && a.from), fb = str(b && b.from);
    if (fa !== fb) return fa < fb ? -1 : 1;
    var ua = ms(a && a.updatedAt), ub = ms(b && b.updatedAt);
    if (ua !== ub) return ua > ub ? -1 : 1;
    var ia = str(a && a.id), ib = str(b && b.id);
    return ia === ib ? 0 : (ia > ib ? -1 : 1);
  }
  function sortPlans(list) { return Array.isArray(list) ? list.slice().sort(cmpPlan) : []; }
  function goneIds(res) {
    var s = {};
    (isObj(res) && Array.isArray(res.planGone) ? res.planGone : []).forEach(function (g) { if (isObj(g) && typeof g.id === 'string') s[g.id] = 1; });
    return s;
  }
  /* 表示用の写し（保存データは書き換えない）。効く予約だけを from の昇順で返し、落とした数を数える */
  function normPlans(res) {
    var raw = isObj(res) && Array.isArray(res.nextPlans) ? res.nextPlans : [];
    var gone = goneIds(res), seenId = {}, seenFrom = {}, plans = [], dropped = 0;
    if (isObj(res) && res.nextPlans !== undefined && !Array.isArray(res.nextPlans)) dropped++;
    sortPlans(raw).forEach(function (p) {
      if (!validPlan(p) || gone[p.id] || seenId[p.id] || seenFrom[p.from]) { dropped++; return; }
      seenId[p.id] = 1; seenFrom[p.from] = 1; plans.push(p);
    });
    return { plans: plans, dropped: dropped };
  }
  /* その日（ymd）までに from が来た予約（昇順）と、まだ来ていない予約（昇順）に分ける */
  function effectivePlans_(res, ymd) {
    var plans = normPlans(res).plans, due = [], later = [];
    plans.forEach(function (p) { if (isYmd(ymd) && p.from <= ymd) due.push(p); else later.push(p); });
    return { due: due, later: later };
  }

  /* ── その日に効く予定・介護度 ── */
  function curEvents(res) { return isObj(res) && Array.isArray(res.events) ? res.events : []; }
  function eventsFor(res, ymd) {
    var due = effectivePlans_(res, ymd).due;
    return due.length ? due[due.length - 1].events : curEvents(res);
  }
  function levelFor(res, ymd) {
    var lv = str(isObj(res) ? res.careLevel : '');
    effectivePlans_(res, ymd).due.forEach(function (p) { if (planLv(p) !== '') lv = planLv(p); });
    return lv;
  }

  /* ── 切替（from <= today の予約を昇順に1つずつ現行へ） ── */
  function applyDue(res, today, nowIso) {
    if (!isObj(res)) return { changed: false, res: res, steps: [] };
    var due = effectivePlans_(res, today).due;
    if (!due.length) return { changed: false, res: clone(res), steps: [] };
    var out = clone(res), steps = [], drop = {};
    var dueFrom = {};
    due.forEach(function (p) { dueFrom[p.from] = 1; });
    /* 同じ from の負けた予約も外す（次回また「期日を過ぎた予約」として残らないように） */
    (Array.isArray(out.nextPlans) ? out.nextPlans : []).forEach(function (p) {
      if (validPlan(p) && dueFrom[p.from] && !goneIds(out)[p.id]) drop[p.id] = 1;
    });
    due.forEach(function (p0) {
      var p = clone(p0), lv = planLv(p);
      steps.push({ from: p.from, to: prevDay(p.from), prevFrom: str(out.planFrom), prevLevel: str(out.careLevel),
        prevEvents: clone(curEvents(out)), level: lv !== '' ? lv : str(out.careLevel), planId: p.id });
      out.events = p.events;
      if (lv !== '') out.careLevel = lv;
      out.planFrom = p.from;
      out.planLevel = lv;
      out.planNote = planNoteOf(p);
      out.planGen = gen(out) + 1;
    });
    /* 使った予約（入れ替えた予約・同じ開始日で負けて外した予約）は planGone に載せる（at はその予約の開始日＝時計を使わず2台で同じ答え）。
       統合で、ほかの端末に残っていた同じ予約を生き返らせないため（2026-11-27 反証レビュー A1） */
    var used = [];
    out.nextPlans.forEach(function (p) { if (isObj(p) && typeof p.id === 'string' && drop[p.id]) used.push({ id: p.id, at: p.from }); });
    out.planGone = mergeGone(out.planGone, used);
    out.nextPlans = sortPlans(out.nextPlans.filter(function (p) { return !(isObj(p) && typeof p.id === 'string' && drop[p.id]); }));
    void nowIso; /* 時刻は res に書かない（2台の結果を一字一句同じにするため） */
    return { changed: true, res: out, steps: steps };
  }

  /* ── 介護度の決まり（ROOT.md の表のとおり） ── */
  function resolveLevel(o) {
    o = isObj(o) ? o : {};
    var cur = str(o.cur);
    var master = str(o.master);   /* つながっていない（undefined）と空（''・null）は同じ答え（cur・知らせなし）なので1行にまとめる（2026-11-27 A6） */
    if (master === '') return { level: cur, hold: false, notice: null };
    /* 次の予約 N＝まだ切り替わっていない予約のうち from が最小の物（今日より後かを問わない＝切替日を過ぎたが未切替の間も保つ。
       切替が済めば予約が消えるので hold は終わる・2026-11-27 反証レビュー A3）。today は使わない */
    var N = normPlans({ nextPlans: Array.isArray(o.next) ? o.next : (isObj(o.next) ? [o.next] : []) }).plans[0] || null;
    if (N && planLv(N) !== '' && master === planLv(N) && planLv(N) !== str(N.baseLevel) && cur === str(N.baseLevel)) {
      return { level: cur, hold: true, notice: { kind: 'hold', master: master, planned: planLv(N), from: N.from } };
    }
    var pl = str(o.planLevel);
    if (pl !== '' && pl !== master) return { level: master, hold: false, notice: { kind: 'mismatch', master: master, planned: pl, from: str(o.planFrom) } };
    return { level: master, hold: false, notice: null };
  }

  /* ── 予定の比べ方（diffEvents と droppedMine で同じもの） ── */
  function evVal(ev, k) { var v = isObj(ev) ? ev[k] : undefined; return k === 'bathing' ? !!v : str(v); }
  function evChangedFields(a, b) { return EV_FIELDS.filter(function (k) { return evVal(a, k) !== evVal(b, k); }); }
  function evSig(ev) { return EV_FIELDS.map(function (k) { return JSON.stringify(evVal(ev, k)); }).join('|'); }
  function evIndex(list) {
    var m = {}, order = [], cnt = {};
    (Array.isArray(list) ? list : []).forEach(function (ev) {
      if (!isObj(ev)) return;
      var k = typeof ev.id === 'string' && ev.id !== '' ? 'id:' + ev.id : 'sig:' + evSig(ev);
      cnt[k] = (cnt[k] || 0) + 1;
      if (cnt[k] > 1) k += '#' + cnt[k];
      m[k] = ev; order.push(k);
    });
    return { m: m, order: order };
  }
  function diffEvents(before, after) {
    var A = evIndex(before), B = evIndex(after), added = [], changed = [], removed = [], same = 0;
    A.order.forEach(function (k) {
      if (!has(B.m, k)) { removed.push(A.m[k]); return; }
      var f = evChangedFields(A.m[k], B.m[k]);
      if (f.length) changed.push({ before: A.m[k], after: B.m[k], fields: f }); else same++;
    });
    B.order.forEach(function (k) { if (!has(A.m, k)) added.push(B.m[k]); });
    var parts = [];
    if (added.length) parts.push('追加 ' + added.length + '件');
    if (changed.length) parts.push('変更 ' + changed.length + '件');
    if (removed.length) parts.push('削除 ' + removed.length + '件');
    return { added: added, changed: changed, removed: removed, same: same, text: parts.length ? parts.join('・') : '変更なし' };
  }

  /* ── 統合 ── */
  function mergeGone(a, b) {
    var by = {};
    [a, b].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (g) {
        if (!isObj(g) || typeof g.id !== 'string' || g.id === '') return;
        if (!has(by, g.id) || ms(g.at) > ms(by[g.id].at)) by[g.id] = { id: g.id, at: str(g.at) };
      });
    });
    var all = Object.keys(by).map(function (k) { return by[k]; });
    all.sort(function (x, y) { var d = ms(y.at) - ms(x.at); if (d) return d > 0 ? 1 : -1; return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
    return all.slice(0, GONE_MAX).sort(function (x, y) { var d = ms(x.at) - ms(y.at); if (d) return d > 0 ? 1 : -1; return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
  }
  /* planGone の id を消し、from が重なった予約は updatedAt の新しい方だけ残す（崩れた予約・id の無い物はそのまま残す） */
  function tidyPlans(list, goneList) {
    var gone = {};
    goneList.forEach(function (g) { gone[g.id] = 1; });
    var keep = [], bestByFrom = {};
    list.forEach(function (p) {
      if (isObj(p) && typeof p.id === 'string' && gone[p.id]) return;
      keep.push(p);
      if (validPlan(p)) { var c = bestByFrom[p.from]; if (!c || cmpPlan(p, c) < 0) bestByFrom[p.from] = p; }
    });
    keep = keep.filter(function (p) { return !validPlan(p) || bestByFrom[p.from] === p; });
    return sortPlans(keep);
  }
  function mergePlans(serverRes, mineRes) {
    var sOk = isObj(serverRes), mOk = isObj(mineRes);
    if (!sOk && !mOk) return { res: serverRes === undefined ? null : clone(serverRes), tookGen: 'same', droppedMine: 0 };
    if (!sOk) return { res: clone(mineRes), tookGen: 'mine', droppedMine: 0 };
    if (!mOk) return { res: clone(serverRes), tookGen: 'server', droppedMine: 0 };
    var gs = gen(serverRes), gm = gen(mineRes);
    var out = clone(serverRes), tookGen = gs > gm ? 'server' : (gm > gs ? 'mine' : 'same'), dropped = 0;
    /* 世代が同じで現行の開始日（planFrom）が違う時は、別の計画どうし。予定を id で混ぜず、いつもサーバーを丸ごと採る
       （2026-11-27 反証 F2: 共通 DB の門 planstale は「同じ世代（1以上）で開始日が違う」保存を必ず断るので、自分を採ると
       その端末の保存が二度と通らない。載せなかった自分の予定は droppedMine で数えて知らせる。世代が違う時の「大きい方」は変えない） */
    if (tookGen === 'same') {
      /* 開始日の読み方は門と同じ（文字の時だけその値・それ以外は空） */
      var pfS = typeof serverRes.planFrom === 'string' ? serverRes.planFrom : '', pfM = typeof mineRes.planFrom === 'string' ? mineRes.planFrom : '';
      if (pfS !== pfM) tookGen = 'server';
    }
    var sPlans = Array.isArray(serverRes.nextPlans) ? serverRes.nextPlans : [];
    var mPlans = Array.isArray(mineRes.nextPlans) ? mineRes.nextPlans : [];
    var hadPlans = Array.isArray(serverRes.nextPlans) || Array.isArray(mineRes.nextPlans);
    var hadGone = Array.isArray(serverRes.planGone) || Array.isArray(mineRes.planGone);
    var gone = mergeGone(serverRes.planGone, mineRes.planGone);
    if (tookGen === 'server') {
      var S = evIndex(serverRes.events), M = evIndex(mineRes.events);
      M.order.forEach(function (k) { if (!has(S.m, k) || evChangedFields(S.m[k], M.m[k]).length) dropped++; });
    } else if (tookGen === 'mine') {
      ['events', 'planFrom', 'planLevel', 'planNote', 'planGen', 'careLevel'].forEach(function (k) {
        if (has(mineRes, k)) out[k] = clone(mineRes[k]); else delete out[k];
      });
    }
    /* 予約はどの場合も「両方の id の和 − 両方の planGone の和」（2026-11-27 反証レビュー A2）。切替で使った予約は applyDue が planGone に
       載せるので生き返らない。負けた側で新しく作った・直した予約は残る。同じ id は updatedAt の新しい方（同じならサーバー） */
    var byId = {}, extra = [];
    sPlans.forEach(function (p) { if (isObj(p) && typeof p.id === 'string' && p.id !== '') { if (!has(byId, p.id)) byId[p.id] = p; } else extra.push(p); });
    mPlans.forEach(function (p) {
      if (!(isObj(p) && typeof p.id === 'string' && p.id !== '')) return; /* id の無い物はサーバー側のものだけ残す */
      if (!has(byId, p.id) || ms(p.updatedAt) > ms(byId[p.id].updatedAt)) byId[p.id] = p;
    });
    var base = clone(Object.keys(byId).map(function (k) { return byId[k]; }).concat(extra));
    var plans = tidyPlans(base, gone);
    if (hadPlans || plans.length) out.nextPlans = plans;
    if (hadGone || gone.length) out.planGone = gone;
    return { res: out, tookGen: tookGen, droppedMine: dropped };
  }

  /* ── 年表の材料 ── */
  function planSummary(res, today) {
    var n = normPlans(res), ep = effectivePlans_(res, today);
    var r = isObj(res) ? res : {};
    var rows = n.plans.map(function (p) {
      return { kind: 'next', id: p.id, from: p.from, careLevel: planLv(p), baseLevel: str(p.baseLevel), count: p.events.length,
        note: planNoteOf(p), due: isYmd(today) && p.from <= today, createdAt: str(p.createdAt), createdBy: str(p.createdBy), updatedAt: str(p.updatedAt), updatedBy: str(p.updatedBy) };
    });
    return {
      current: { kind: 'current', from: str(r.planFrom), careLevel: str(r.careLevel), planLevel: str(r.planLevel), note: str(r.planNote), gen: gen(r), count: curEvents(r).length },
      next: rows,
      dueCount: ep.due.length,
      nextFrom: ep.later.length ? ep.later[0].from : '',
      dropped: n.dropped
    };
  }

  /* ── 予約の入力の確かめ（input.id があれば、その予約自身とは重なりを見ない） ── */
  function validatePlanInput(input, res, today) {
    var i = isObj(input) ? input : {}, errors = [];
    var from = i.from;
    if (!isYmd(from)) errors.push({ code: 'from_bad', msg: '開始日が正しい日付ではありません' });
    else if (!isYmd(today)) errors.push({ code: 'today_bad', msg: '今日の日付が読めません' });
    else if (from <= today) errors.push({ code: 'from_past', msg: '開始日は明日以降にしてください' });
    if (i.careLevel !== undefined && i.careLevel !== null && typeof i.careLevel !== 'string') errors.push({ code: 'level_bad', msg: '介護度が読めません' });
    if (isYmd(from)) {
      var selfId = typeof i.id === 'string' ? i.id : '';
      var dup = normPlans(res).plans.some(function (p) { return p.from === from && p.id !== selfId; });
      if (dup) errors.push({ code: 'from_dup', msg: '同じ開始日の予約がほかにあります' });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  var api = { VERSION: VERSION, NOTE_MAX: NOTE_MAX, GONE_MAX: GONE_MAX, EV_FIELDS: EV_FIELDS, EV_LABELS: EV_LABELS,
    todayJst: todayJst, isYmd: isYmd, sortPlans: sortPlans, normPlans: normPlans, eventsFor: eventsFor, levelFor: levelFor,
    applyDue: applyDue, resolveLevel: resolveLevel, mergePlans: mergePlans, diffEvents: diffEvents, planSummary: planSummary,
    validatePlanInput: validatePlanInput };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CarePlanCalc = api;
})(typeof window !== 'undefined' ? window : this);
