/* payroll-zuiji.js — 社会保険の随時改定（月額変更届）の判定の純関数（2026-11-28 新設・定時決定 payroll-santei.js の上に積む）
 * ════════════════════════════════════════════════════════════════
 * ・DOM に触れない・通信しない。給与の計算（payroll-calc.js）は呼ばない・変えない。確定した明細と給与の設定の版を読むだけ
 * ・月ごとの報酬・支払基礎日数は定時決定と同じ作り（PayrollSantei.fromItems）で作る。判定だけをここに置く
 * ・決まり（日本年金機構「随時改定（月額変更届）」の案内・算定基礎届のガイドブック・厚労省の事例集で確かめた分）:
 *   1. 固定的賃金（基本給・時給・日給・役員報酬・通勤手当・固定の手当・回数の手当の単価・給与の形）が変わった
 *   2. 変わった固定的賃金を初めて支払った月（起算の月）から3か月とも支払基礎日数17日以上（特定適用事業所の短時間労働者は11日以上）
 *   3. 3か月の報酬の平均の等級が今の等級と2等級以上違う（固定的賃金が上がって等級が上がった時・下がって下がった時だけ）
 *   4. 起算の月から4か月目の分の保険料から改定する
 * ・自分で決めきれない場面（上がる物と下がる物が同時・給与の形が変わった・その月だけの支給の調整・等級表の端の1等級の差・
 *   間に標準報酬が変わった）は「要確認」にして、黙って外さない
 * ・入口: judge(src) … src は PayrollSantei.fromItems と同じ boots（月分ごとの payroll_bootstrap・古い順）と opts・overrides
 * ・個人情報: 名前・番号は渡された物を返すだけ。保存しない・console に出さない。試験は架空の職員だけ（check/unit/payroll_zuiji_test.js）
 */
(function (root) {
  'use strict';
  var isNode = typeof require !== 'undefined' && typeof window === 'undefined';
  var ST = isNode ? require('./payroll-santei.js') : root.PayrollSantei;
  var Rates = isNode ? require('./payroll-rates.js') : root.PayrollRates;
  var VERSION = 'zuiji-2026-11-28';
  var DAYS = { general: 17, short: 11 };

  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }
  function int(v) { var n = num(v); return n === null ? 0 : Math.round(n); }
  function ymAdd(ym, k) { return ST.ymAdd(ym, k); }

  /* ── 1. 月分ごとの固定的賃金の中身（比べる物だけ） ──
     確定した月分は、その時に払った明細の行（基本給・役員報酬・通勤・固定的賃金の印の手当）を正とし（後から版を直しても過去の判定が変わらない）、
     行に無い項目と下書きの月分は、その月分の期首の版（payroll_bootstrap の profiles）から読む。標準報酬そのものは比べない
     返り値: { type, items: { key: { label, kind:'amount'|'rate', v } } } */
  function defsOf(b) { var o = {}; arr(b && b.allowances).forEach(function (a) { if (a && a.code) o[a.code] = obj(a.def); }); return o; }
  /* 印の既定は給与の計算（payroll-calc.js の attrsOf）と同じ: fixed_wage は印が無ければ定額（calc が無い・fixed）の手当だけ真・social_ins は既定で真 */
  function attrs(def) { var a = obj(def && def.attrs), fx = !def || !def.calc || def.calc === 'fixed'; return { fixed_wage: typeof a.fixed_wage === 'boolean' ? a.fixed_wage : fx, social_ins: typeof a.social_ins === 'boolean' ? a.social_ins : true }; }
  function isPayDef(def) { return (def.sec || 'pay') === 'pay' && attrs(def).social_ins; }
  function isFixedDef(def) { return isPayDef(def) && attrs(def).fixed_wage; }
  function sigOf(b, sid, defs) {
    var st = b.run && b.run.status, conf = st === 'confirmed' || st === 'exported';
    var prof = arr(b.profiles).filter(function (p) { return p && p.staff_id === sid && !p.none; })[0], d = obj(prof && prof.data);
    var type = d.pay_type || '', items = {}, src = conf ? 'paid' : 'profile';
    function put(k, label, kind, v, unit) { if (v === null || v === undefined) return; items[k] = { label: label, kind: kind, v: v, unit: unit || '円' }; }
    var rateBase = type === 'hourly' || type === 'daily';
    var baseLabel = type === 'hourly' ? '時給' : type === 'daily' ? '日給' : '基本給';
    if (conf) {
      var it = arr(b.items).filter(function (x) { return x && x.staff_id === sid; })[0], lines = arr(obj(it && it.item).lines);
      lines.forEach(function (l) {
        if (!l || l.sec !== 'pay') return;
        var c = String(l.code || ''), u = num(l.unit);
        if (c === 'basic' && u !== null) put('basic', baseLabel, rateBase ? 'rate' : 'amount', u);
        else if (c === 'board' && u !== null) put('board', '役員報酬', 'amount', u);
        else if (c === 'commute' && u !== null) put('commute', '通勤手当', 'amount', u);
        else if (/^f/.test(c) && defs[c.slice(1)] && isPayDef(defs[c.slice(1)]) && u !== null) {
          var df = defs[c.slice(1)], fx = isFixedDef(df);
          /* 固定的賃金の手当は額（回数の手当は単価）・固定的賃金でない手当は「あるか」と単価（定額の手当の額は月ごとに変わるので比べない） */
          if (fx) put('f' + c.slice(1), df.name || c.slice(1), (df.calc || 'fixed') === 'fixed' ? 'amount' : 'rate', u);
          else put('n' + c.slice(1), df.name || c.slice(1), 'nf', (df.calc || 'fixed') === 'fixed' ? 1 : u, (df.calc || 'fixed') === 'fixed' ? 'あり' : '円');
        }
      });
    }
    /* 行に無い項目は版から（下書きの月分は全部版から） */
    if (prof) {
      if (!items.basic && type !== 'board' && num(d.base) !== null) put('basic', baseLabel, rateBase ? 'rate' : 'amount', int(d.base));
      /* 時給の人の契約の1日の時間が変わった時も固定的賃金の変動（厚労省の事例集 随時改定 問1-3） */
      if (type === 'hourly' && num(d.day_hours) !== null) put('day_hours', '1日の所定時間', 'rate', num(d.day_hours), '時間');
      if (!items.board && num(d.board_pay) !== null && int(d.board_pay) > 0) put('board', '役員報酬', 'amount', int(d.board_pay));
      if (!items.commute && d.commute && num(obj(d.commute).monthly) !== null && int(obj(d.commute).monthly) > 0) put('commute', '通勤手当', 'amount', int(obj(d.commute).monthly));
      arr(d.allowances).forEach(function (a) {
        if (!a || !a.code || items['f' + a.code] || items['n' + a.code]) return;
        var df = defs[a.code]; if (!df || !isPayDef(df)) return;
        if (isFixedDef(df)) put('f' + a.code, df.name || a.code, (df.calc || 'fixed') === 'fixed' ? 'amount' : 'rate', int(a.amount));
        else put('n' + a.code, df.name || a.code, 'nf', (df.calc || 'fixed') === 'fixed' ? 1 : int(a.amount), (df.calc || 'fixed') === 'fixed' ? 'あり' : '円');
      });
    }
    var hs = obj(obj(d.ins).health), ps = obj(obj(d.ins).pension);
    return { ym: b.ym, has: !!prof, type: type, items: items, src: src, conf: conf,
      std: { health: int(hs.std), pension: ps.on === true ? int(ps.std) : null, on: hs.on === true, pOn: ps.on === true } };
  }
  /* 二つの月分の固定的賃金の違い: { changed, dir: 'up'|'down'|'mixed'|'type'|'nf', list: [{label, from, to, unit}] }
     ・'nf' は固定的賃金の印の無い手当の新設・廃止・単価の変更だけ（事例集 問2・問3・問7-2 では随時改定のきっかけになることがある＝人が確かめる）
     ・1日の所定時間の「なし → 値」は入力の補いとみて数えない（値どうしの変更だけ） */
  var PT_JA = { monthly: '月給', hourly: '時給', daily: '日給', board: '役員報酬' };
  function diffSig(a, b) {
    var out = { changed: false, dir: null, list: [], nf: false };
    if (a.type && b.type && a.type !== b.type) { out.changed = true; out.dir = 'type'; out.list.push({ label: '給与の形', from: PT_JA[a.type] || '不明', to: PT_JA[b.type] || '不明', unit: '' }); return out; }
    var keys = {}, ups = 0, downs = 0, amtA = 0, amtB = 0, amtCh = false;
    Object.keys(a.items).concat(Object.keys(b.items)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) {
      var x = a.items[k], y = b.items[k], vx = x ? x.v : 0, vy = y ? y.v : 0;
      if (vx === vy) return;
      if (k === 'day_hours' && (!x || !y)) return;
      var kind = (y || x).kind;
      out.changed = true;
      out.list.push({ label: (y || x).label, from: x ? vx : null, to: y ? vy : null, unit: kind === 'nf' && (y || x).unit === 'あり' ? '' : (y || x).unit });
      if (kind === 'nf') { out.nf = true; return; }
      if (kind === 'amount') { amtA += vx; amtB += vy; amtCh = true; }
      else if (vy > vx) ups++; else downs++;
    });
    if (amtCh) { if (amtB > amtA) ups++; else if (amtB < amtA) downs++; }
    out.dir = ups && downs ? 'mixed' : ups ? 'up' : downs ? 'down' : null;
    if (out.changed && !out.dir) out.dir = out.nf && !amtCh ? 'nf' : 'mixed';   /* 固定的賃金でない手当だけ・月の額の合計は同じで中身だけ入れ替わった時 */
    return out;
  }

  /* 支給の月（確定の写しの支給日→下書きは run の支給日→月分の名前） */
  function payMonthRaw(b) {
    var st = b.run && b.run.status, conf = st === 'confirmed' || st === 'exported';
    var fz = conf ? arr(b.items).map(function (it) { return obj(it && it.frozen).pay_date; }).filter(isDate)[0] : null;
    var pd = fz || (b.run && isDate(b.run.pay_date) ? b.run.pay_date : null);
    return pd ? pd.slice(0, 7) : null;
  }
  function ymDiff(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
  /* 給与の回がまだ無い月分は、ほかの月分の「月分→支給の月」のずれ（翌月払いなら +1）で置く（無ければ月分の名前） */
  function payMonthOf(b, boots) {
    var raw = payMonthRaw(b); if (raw) return raw;
    var off = null;
    arr(boots).slice().reverse().some(function (x) { var r = payMonthRaw(x); if (r) { off = ymDiff(x.ym, r); return true; } return false; });
    return off === null ? b.ym : ymAdd(b.ym, off);
  }

  /* 等級表の端（健保 1・50 等級・厚年 1 等級と上限）か */
  function atEdge(kind, g, ym) {
    if (!g) return false;
    if (g.grade === 1) return true;
    var top = Rates.grade(99999999, ym);   /* 等級表の一番上（健保・厚年とも・厚年の上限は対象月で変わる） */
    var tg = top && top[kind];
    return !!(tg && g.grade === tg.grade);
  }

  /* ── 2. 判定 ── */
  function judge(src) {
    src = obj(src);
    var opts = obj(src.opts), special = opts.special === true, ov = obj(src.overrides);
    var boots = arr(src.boots).filter(function (b) { return b && b.ok !== false && isYm(b.ym); }).sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    var out = { version: VERSION, people: [], counts: { all: 0, hit: 0, wait: 0, no: 0, review: 0, done: 0 }, warns: [] };
    if (boots.length < 2) { out.warns.push({ code: 'no_data', msg: '比べる月分が足りません（2か月分以上の給与が要ります）' }); return out; }
    var last = boots[boots.length - 1], defs = defsOf(last);
    var sids = {};
    boots.forEach(function (b) { arr(b.profiles).forEach(function (p) { if (p && p.staff_id && !p.none) sids[p.staff_id] = p.name || sids[p.staff_id] || ''; }); });
    var from = isYm(src.fromYm) ? src.fromYm : null;
    var to = isYm(src.toYm) ? src.toYm : null;   /* 先の月分は従前の額・もう変えたかを見るためだけに読む（変動の行は出さない） */
    Object.keys(sids).sort().forEach(function (sid) {
      var sigs = boots.map(function (b) { return sigOf(b, sid, defs); });
      for (var i = 1; i < sigs.length; i++) {
        var a = sigs[i - 1], b = sigs[i];
        if (!a.has || !b.has) continue;
        if (from && b.ym < from) continue;
        if (to && b.ym > to) continue;
        var df = diffSig(a, b);
        if (!df.changed) continue;
        out.people.push(one(sid, sids[sid], boots, i, sigs, df, special, ov, opts.siMonth === 'current' ? 'current' : 'next'));
      }
    });
    out.people.forEach(function (r) { out.counts.all++; out.counts[r.status] = (out.counts[r.status] || 0) + 1; });
    return out;
  }
  function one(sid, nm, boots, i, sigs, df, special, ov, siMonth) {
    var b = boots[i], prevSig = sigs[i - 1];
    var start = payMonthOf(b, boots), months = [start, ymAdd(start, 1), ymAdd(start, 2)], applyYm = ymAdd(start, 3);
    /* 翌月徴収（既定）: 対象月 X の保険料は月分 X+1 で引く。改定の前の額＝対象月 applyYm−1 を引く月分の期首の版・新しい額を置くのは runYm */
    var needYm = siMonth === 'current' ? ymAdd(applyYm, -1) : applyYm, runYm = siMonth === 'current' ? applyYm : ymAdd(applyYm, 1);
    var r = { staff_id: sid, name: nm, code: '', changeYm: b.ym, changes: df.list, dir: df.dir, start: start, months: [], applyYm: applyYm, runYm: runYm,
      kind: 'general', rule: DAYS.general, avg: null, cur: { health: null, pension: null }, next: null, diffH: null, diffP: null,
      status: 'wait', reason: '', warns: [] };
    function w(code, msg) { if (!r.warns.some(function (y) { return y.code === code && y.msg === msg; })) r.warns.push({ code: code, msg: msg }); }
    /* 従前の額: needYm 以前で一番新しい読めた月分の版（定時決定・前の随時改定の後の額と比べる・事例集 問1）。読めていなければ一番新しい月分 */
    var curSig = prevSig;
    for (var k = i; k < sigs.length; k++) if (sigs[k].has && sigs[k].ym <= needYm) curSig = sigs[k];
    var curStd = curSig.std;
    if (curStd.health !== prevSig.std.health || curStd.pension !== prevSig.std.pension) w('std_after', '変わった後に標準報酬月額が変わったので（定時決定・前の随時改定）、その後の額と比べました');
    var po = obj(ov[sid]), so = {}; so[sid] = po;
    var fi = ST.fromItems({ payMonths: months, boots: boots, countCodes: { __none__: false }, opts: { special: special }, overrides: so, curYm: curSig.ym });
    var P = arr(fi.people).filter(function (x) { return x.staff_id === sid; })[0];
    if (P) { r.code = P.code; r.name = P.name || nm; }
    if (special && po.short === true) { r.kind = 'short'; r.rule = DAYS.short; }
    r.cur = { health: ST.gradeOfStd('health', curStd.health, applyYm), pension: curStd.pOn ? ST.gradeOfStd('pension', curStd.pension, applyYm) : null };
    var pm = P ? arr(P.months) : months.map(function (m) { return { ym: m, missing: true }; });
    var waitM = [], shortM = [], sum = 0, retro = 0;
    pm.forEach(function (m) {
      var row = { ym: m.ym, days: m.days === undefined ? null : m.days, pay: int(m.pay), retro: Math.max(0, int(m.retro)), why: '' };
      if (m.missing) { row.why = '支給なし'; waitM.push(m.ym); }
      else if (!m.confirmed) { row.why = '未確定'; waitM.push(m.ym); }
      else if (row.days === null) { row.why = '日数が分かりません'; w('days_missing', m.ym + ' の支払基礎日数が分かりません'); }
      else if (row.days < r.rule) { row.why = row.days + '日・' + r.rule + '日未満'; shortM.push(m.ym); }
      arr(m.warns).forEach(function (x) { if (x.code !== 'run_missing') w(x.code, x.msg); });
      sum += row.pay; retro += row.retro;
      r.months.push(row);
    });
    if (!curStd.on) { r.status = 'no'; r.reason = '健康保険に入っていない'; return r; }
    if (!r.cur.health) w('cur_bad', '今の健康保険の標準報酬月額が等級表にありません');
    if (df.dir === 'type') w('type_change', '給与の形が変わりました（月給と時給など・上がったか下がったかを人が確かめてください）');
    if (df.dir === 'mixed') w('mixed', '上がった物と下がった物があります（固定的賃金の全体で上がったか下がったかを人が確かめてください）');
    if (df.nf) w('nf', '固定的賃金の印の無い手当の新設・廃止・単価の変更があります（随時改定のきっかけになる場合があります・人が確かめてください）');
    if (shortM.length) {
      /* 起算の月が17日未満: 休職・産休中に変わった時は、復帰して通常の給与に戻った月から3か月で判定する（事例集 問8・問8-2） */
      if (shortM[0] === months[0]) { r.status = 'review'; r.reason = '起算の月の支払基礎日数が' + r.rule + '日未満です（休職・産休中に変わった時は、通常の給与に戻った月から3か月で判定します・人が確かめてください）'; return r; }
      r.status = 'no'; r.reason = '支払基礎日数が' + r.rule + '日未満の月があります（' + shortM.join('・') + '）'; return r;
    }
    if (waitM.length) { r.status = 'wait'; r.reason = '3か月の給与がまだそろっていません（' + waitM.join('・') + '）'; return r; }
    r.avg = Math.floor((sum - retro) / 3);
    var g = Rates.grade(Math.max(0, r.avg), applyYm);
    if (!g) { r.status = 'review'; r.reason = '等級を引けません'; return r; }
    r.next = { health: g.health, pension: curStd.pOn ? g.pension : null };
    r.diffH = r.cur.health ? g.health.grade - r.cur.health.grade : null;
    r.diffP = r.cur.pension && r.next.pension ? g.pension.grade - r.cur.pension.grade : null;
    var big = (r.diffH !== null && Math.abs(r.diffH) >= 2) || (r.diffP !== null && Math.abs(r.diffP) >= 2);
    var dirOk = df.dir === 'up' ? (r.diffH > 0 || r.diffP > 0) : df.dir === 'down' ? (r.diffH < 0 || r.diffP < 0) : null;
    /* 端の1等級（上限・下限で等級が1つしか動かない）は特例の条件があるので人が確かめる */
    var edge1 = !big && ((r.diffH !== null && Math.abs(r.diffH) === 1 && (atEdge('health', r.cur.health, applyYm) || atEdge('health', g.health, applyYm))) ||
      (r.diffP !== null && Math.abs(r.diffP) === 1 && (atEdge('pension', r.cur.pension, applyYm) || atEdge('pension', g.pension, applyYm))));
    if (edge1) w('edge1', '等級表の上限か下限での1等級の差です（特例で随時改定になる場合があります・決まりを確かめてください）');
    /* もう変えた: 新しい額を置く月分（runYm）の版が新しい額になっている */
    var runSig = sigs.filter(function (x) { return x.ym === runYm && x.has; })[0];
    if (runSig && (big || edge1) && runSig.std.health === g.health.std && (!curStd.pOn || runSig.std.pension === g.pension.std)) { r.status = 'done'; r.reason = mOf(runYm) + '分の版でもう変えました'; return r; }
    var rv = r.warns.filter(function (x) { return REVIEW[x.code]; });
    /* 要確認の印がある時・差を出せない時は、2等級の判定より先に要確認（黙って外さない） */
    if (rv.length || r.diffH === null) { r.status = 'review'; r.reason = (rv[0] || { msg: '今の等級と比べられません' }).msg; return r; }
    if (big && dirOk === false) { r.status = 'no'; r.reason = '固定的賃金の' + (df.dir === 'up' ? '上がり' : '下がり') + 'と等級の動きが逆です（随時改定にならない）'; return r; }
    if (!big) { r.status = 'no'; r.reason = '2等級以上の差がありません'; return r; }
    r.status = 'hit'; r.reason = mOf(applyYm) + '分の保険料から改定';
    var am = +applyYm.slice(5, 7);
    /* 年金機構「算定基礎届の提出対象者」: 7月改定は算定基礎届が要らない・8・9月改定の予定者は申し出れば省ける（備考に「月額変更予定」） */
    if (am === 7) w('teiji_skip', applyYm.slice(0, 4) + '年7月分から改定する人は、その年の算定基礎届が要りません');
    else if (am === 8 || am === 9) w('teiji_skip', applyYm.slice(0, 4) + '年' + am + '月分から改定する予定の人は、算定基礎届を省けます（報酬月額の欄を空け、備考に「月額変更予定」）');
    return r;
  }
  function mOf(ym) { return isYm(ym) ? +ym.slice(5, 7) + '月' : ''; }
  var REVIEW = { cur_bad: 1, type_change: 1, mixed: 1, nf: 1, days_missing: 1, retro_hint: 1, two_pays: 1, days_absent: 1, days_half: 1, days_imported: 1, def_missing: 1, edge1: 1, unconfirmed: 1 };
  var STATUS_JA = { hit: '随時改定', wait: '待ち', no: '対象外', review: '要確認', done: '変えた' };

  var api = { VERSION: VERSION, DAYS: DAYS, STATUS_JA: STATUS_JA, judge: judge, sigOf: sigOf, diffSig: diffSig, payMonthOf: payMonthOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollZuiji = api;
})(typeof window !== 'undefined' ? window : this);
