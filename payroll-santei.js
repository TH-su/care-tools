/* payroll-santei.js — 社会保険の定時決定（算定基礎届）と、その前の見込みの純関数（2026-11-26 新設・設計 ~/Claude/Work/勤怠管理アプリ/給与/ROOT-santei.md）
 * ════════════════════════════════════════════════════════════════
 * ・DOM に触れない・通信しない。給与の計算（payroll-calc.js）は呼ばない・変えない。確定した明細を読むだけ
 * ・決まりの出典: 日本年金機構「算定基礎届の記入・提出ガイドブック 令和8年度」（2026-11-26 に確かめた）
 *     https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.files/santei.guide.book.pdf
 *   - 4・5・6月に「支払った」報酬（支給日で選ぶ）で決め、9月分から翌8月分まで使う
 *   - 支払基礎日数: 月給＝暦日数（欠勤控除のある月は所定労働日数−欠勤日数）・時給と日給＝出勤日数（有休を含む）
 *   - 一般は17日以上の月だけで平均。パート（4分の3以上・短時間労働者でない）は17日以上が無ければ15日以上の月。
 *     短時間労働者（特定適用事業所）は11日以上の月。使える月が無ければ従前の標準報酬月額
 *   - 途中入社で1か月分が出ていない月は除く。6月1日以降の資格取得・7月1日より前の退職は届けない
 *   - 3月以前の分の遡及の支払いは、その額を除いて平均する（修正平均）。円未満は切り捨て
 * ・二つの入口:
 *     compute(input)   … 人ごとの中立な形（月ごとの報酬・日数）から結果を出す（freee の明細の検算もこの形に直して通す）
 *     fromItems(src)   … 給与の画面の確定した明細（payroll_bootstrap の items）から中立な形を作る
 *   csv(result)        … 算定基礎届の控え（CSV の文字）
 * ・個人情報: 名前・番号は渡された物を返すだけで、保存しない・console に出さない。試験は架空の職員だけ（check/unit/payroll_santei_test.js）
 */
(function (root) {
  'use strict';
  var isNode = typeof require !== 'undefined' && typeof window === 'undefined';
  var Rates = isNode ? require('./payroll-rates.js') : root.PayrollRates;
  var VERSION = 'santei-2026-11-26';

  /* 既定（画面で変えられる・保存しない＝仮置き） */
  var DEFAULTS = {
    special: false,                          /* 特定適用事業所か（入の時だけ短時間労働者の11日を使う） */
    nearK: 2,                                /* 「あと少し」: 手当なしの平均から次の境目まで ≤ 回数の手当の月平均×nearK */
    countCalcs: ['count', 'night_shift', 'hour']   /* 回数・時間で額が変わる手当の計算の種類（定義の calc） */
  };
  var DAYS = { general: 17, part: 15, short: 11 };
  var KIND_JA = { general: '一般', part: 'パート', short: '短時間労働者' };

  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }
  function int(v) { var n = num(v); return n === null ? 0 : Math.round(n); }
  function ymAdd(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12 + 1; return y + '-' + (m < 10 ? '0' : '') + m; }
  function daysBetween(from, to) {
    if (!isDate(from) || !isDate(to)) return null;
    var a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)), b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
    return b < a ? null : Math.round((b - a) / 86400000) + 1;
  }
  function floorDiv(a, n) { return Math.floor(a / n); }   /* 報酬は円の整数・n は 1〜3（浮動小数の誤差は出ない） */

  /* 標準報酬月額 → 等級（健保の表の std の一致で引く・厚年は対象月の上限まで）。無ければ null */
  function gradeOfStd(kind, std, ym) {
    var G = Rates && Rates.HEALTH_GRADES, s = int(std);
    if (!G || !s) return null;
    for (var i = 0; i < G.length; i++) {
      if (G[i][1] !== s) continue;
      if (kind === 'health') return { grade: G[i][0], std: s };
      if (Rates.isStd && !Rates.isStd('pension', s, ym)) return null;
      return { grade: G[i][0] - 3, std: s };
    }
    return null;
  }
  /* 健保の等級 g の次の等級の下限（無ければ null） */
  function nextLower(g) {
    var G = Rates && Rates.HEALTH_GRADES;
    if (!G || !g) return null;
    for (var i = 0; i < G.length; i++) if (G[i][0] === g + 1) return G[i][2];
    return null;
  }
  function gradeOf(avg, ym) { return Rates && typeof Rates.grade === 'function' ? Rates.grade(avg, ym) : null; }

  function fillOpts(o) {
    o = obj(o);
    var k = num(o.nearK);
    return {
      special: o.special === true,
      nearK: k !== null && k >= 0 && k <= 10 ? k : DEFAULTS.nearK,
      countCalcs: Array.isArray(o.countCalcs) ? o.countCalcs.filter(function (x) { return typeof x === 'string'; }) : DEFAULTS.countCalcs.slice()
    };
  }

  /* ── 1. 人ごとの計算 ──
     person = { staff_id, code, name, pay_type, short(短時間労働者の印), cur:{health, pension}（今の標準報酬）,
                ins:{on, from, to}, entry_date, retire_date,
                months:[{ ym（支給の月）, confirmed, missing（その月の明細が無い）, days（支払基礎日数）, daysNote, partial（途中入社）,
                          excluded（手で外した）, pay（報酬）, countPay（回数の手当）, retro（遡及の額）, warns:[] }] }
     opts = { mode:'teiji'|'forecast', year（teiji の年）, applyYm（新しい等級が効く対象月・既定 year-09）, special, nearK } */
  function person(p, opts) {
    var o = fillOpts(opts), mode = opts && opts.mode === 'forecast' ? 'forecast' : 'teiji';
    var year = int(opts && opts.year), applyYm = isYm(opts && opts.applyYm) ? opts.applyYm : (year ? year + '-09' : null);
    var ins = obj(p.ins), out = {
      staff_id: p.staff_id, code: p.code == null ? '' : String(p.code), name: p.name == null ? '' : String(p.name),
      pay_type: p.pay_type || '', kind: 'general', rule: DAYS.general, status: 'ok', reason: '',
      months: [], used: [], total: null, totalRetro: 0, avg: null, avgRaw: null, avgMod: null,
      cur: { health: gradeOfStd('health', p.cur && p.cur.health, applyYm), pension: gradeOfStd('pension', p.cur && p.cur.pension, applyYm) },
      next: null, diff: null, big: false, change: false,
      noCount: null, edge: null, warns: []
    };
    function w(code, msg) { out.warns.push({ code: code, msg: msg }); }
    if (p.cur && int(p.cur.health) && !out.cur.health) w('cur_bad', '今の健康保険の標準報酬月額が等級表にありません');
    if (p.cur && int(p.cur.pension) && !out.cur.pension) w('cur_bad', '今の厚生年金の標準報酬月額が等級表にありません');
    if (!p.cur || !int(p.cur.health)) w('cur_missing', '今の健康保険の標準報酬月額が空です（差を出せません）');

    /* 区分 */
    if (p.pay_type === 'hourly' || p.pay_type === 'daily') out.kind = o.special && p.short === true ? 'short' : 'part';
    else if (o.special && p.short === true) out.kind = 'short';
    out.rule = out.kind === 'short' ? DAYS.short : DAYS.general;   /* パートも先に17日・17日以上の月が無い時だけ15日 */

    /* 対象外（定時決定だけ・見込みは加入していない人だけ外す） */
    var acq = isDate(ins.from) ? ins.from : (isDate(p.entry_date) ? p.entry_date : null);
    var lost = [ins.to, p.retire_date].filter(isDate).sort()[0] || null;
    if (ins.on !== true) { out.status = 'out'; out.reason = '健康保険に入っていない'; }
    else if (mode === 'teiji' && year && acq && acq >= year + '-06-01') { out.status = 'out'; out.reason = '6月1日以降の資格取得（届けない）'; }
    else if (mode === 'teiji' && year && lost && lost <= year + '-06-30') { out.status = 'out'; out.reason = '7月1日より前に退職（届けない）'; }

    /* 月 */
    var ms = arr(p.months).slice().sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    ms.forEach(function (m) {
      var d = num(m.days), row = { ym: m.ym, days: d, daysNote: m.daysNote || '', pay: int(m.pay), countPay: int(m.countPay), retro: Math.max(0, int(m.retro)), use: false, why: '', warns: arr(m.warns).slice() };
      if (m.missing) row.why = '支給なし';
      else if (!m.confirmed) row.why = '未確定';
      else if (m.excluded) row.why = '手で外した';
      else if (m.partial) row.why = '途中入社の月';
      else if (d === null) row.why = '日数が分かりません';
      out.months.push(row);
    });
    if (out.status === 'out') return out;
    if (out.months.some(function (r) { return r.why === '未確定'; })) w('unconfirmed', '確定していない月があります（確定してから数え直してください）');
    if (out.months.some(function (r) { return r.why === '日数が分かりません'; })) w('days_missing', '支払基礎日数が分からない月があります');
    var cand = out.months.filter(function (r) { return !r.why; });
    function pick(min) { return cand.filter(function (r) { return r.days >= min; }); }
    var use = out.kind === 'short' ? pick(DAYS.short) : pick(DAYS.general);
    if (!use.length && out.kind === 'part') { use = pick(DAYS.part); if (use.length) out.rule = DAYS.part; }
    cand.forEach(function (r) { if (use.indexOf(r) < 0) r.why = r.days + '日・' + out.rule + '日未満'; });
    if (!use.length) {
      out.status = 'keep'; out.reason = '使える月なし（従前の額）';
      out.next = { health: out.cur.health, pension: out.cur.pension };
      return finish(out);
    }
    use.forEach(function (r) { r.use = true; out.used.push(r.ym); });
    var n = use.length, sum = 0, retro = 0, cnt = 0;
    use.forEach(function (r) { sum += r.pay; retro += r.retro; cnt += r.countPay; });
    out.total = sum; out.totalRetro = retro;
    out.avgRaw = floorDiv(sum, n);
    out.avgMod = retro ? floorDiv(sum - retro, n) : null;
    out.avg = retro ? out.avgMod : out.avgRaw;
    if (out.avg < 0) { out.status = 'review'; out.reason = '報酬の平均がマイナスです'; return finish(out); }
    var g = gradeOf(out.avg, applyYm);
    out.next = g ? { health: g.health, pension: g.pension } : null;
    if (!g) { out.status = 'review'; out.reason = '等級を引けません'; return finish(out); }

    /* 回数の手当が無かった時 */
    var ncAvg = floorDiv(sum - cnt - retro, n), ncG = gradeOf(Math.max(0, ncAvg), applyYm), cntAvg = floorDiv(cnt, n);
    out.noCount = { avg: ncAvg, countAvg: cntAvg, health: ncG ? ncG.health : null, pension: ncG ? ncG.pension : null,
      differs: !!(ncG && (ncG.health.grade !== g.health.grade)) };
    /* 境目 */
    var nl = nextLower(g.health.grade), ncl = ncG ? nextLower(ncG.health.grade) : null;
    out.edge = {
      nextLower: nl, toNext: nl === null ? null : nl - out.avg,
      ncNextLower: ncl, ncToNext: ncl === null ? null : ncl - ncAvg,
      near: false
    };
    if (!out.noCount.differs && cntAvg > 0 && out.edge.ncToNext !== null && out.edge.ncToNext <= o.nearK * cntAvg) out.edge.near = true;
    return finish(out);
  }
  function finish(out) {
    if (out.next && out.cur.health && out.next.health) {
      out.diff = out.next.health.grade - out.cur.health.grade;
      out.big = Math.abs(out.diff) >= 2;
    }
    out.change = !!(out.next && ((out.next.health && (!out.cur.health || out.next.health.std !== out.cur.health.std)) ||
      (out.next.pension && (!out.cur.pension || out.next.pension.std !== out.cur.pension.std))));
    if (out.status === 'keep') out.change = false;
    out.months.forEach(function (r) { r.warns.forEach(function (x) { if (!out.warns.some(function (y) { return y.code === x.code && y.msg === x.msg; })) out.warns.push(x); }); });
    if (out.status === 'ok' && out.warns.some(function (x) { return REVIEW[x.code]; })) { out.status = 'review'; out.reason = out.warns.filter(function (x) { return REVIEW[x.code]; })[0].msg; }
    return out;
  }
  /* この警告があれば「要確認」（計算はするが反映の前に人が見る） */
  var REVIEW = { unconfirmed: 1, days_missing: 1, def_missing: 1, days_absent: 1, retro_hint: 1, cur_bad: 1 };

  function compute(input) {
    input = obj(input);
    var people = arr(input.people).map(function (p) { return person(obj(p), input); });
    var c = { all: people.length, out: 0, ok: 0, keep: 0, review: 0, change: 0, up: 0, down: 0, big: 0, byCount: 0, near: 0 };
    people.forEach(function (r) {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.status === 'out') return;
      if (r.change) c.change++;
      if (r.diff > 0) c.up++; else if (r.diff < 0) c.down++;
      if (r.big) c.big++;
      if (r.noCount && r.noCount.differs) c.byCount++;
      if (r.edge && r.edge.near) c.near++;
    });
    return { version: VERSION, mode: input.mode === 'forecast' ? 'forecast' : 'teiji', year: int(input.year) || null,
      applyYm: isYm(input.applyYm) ? input.applyYm : (int(input.year) ? int(input.year) + '-09' : null), opts: fillOpts(input), people: people, counts: c };
  }

  /* ── 2. 確定した明細から中立な形を作る ──
     src = {
       payMonths: ['2027-04','2027-05','2027-06'],   // 平均の元にする支給の月
       boots: [ payroll_bootstrap(ym) の返り値（ok のもの）を古い順 ],
       countCodes: { '<手当の code>': true }（無ければ定義の calc で決める）, opts（DEFAULTS の形）,
       overrides: { '<staff_id>': { short:true, months: { '<支給の月>': { days, retro, excluded } } } }
     }
     返り値: { people: [person], warns: [] }
     ・支給の月は確定の写しの支給日（frozen.pay_date）。下書きは run の pay_date か月分の名前で置き「未確定」
     ・報酬＝支給の行（sec 'pay'）のうち社保の対象: 手当（'f'＋定義の code）は定義の attrs.social_ins が false なら外す・
       非課税の調整（adj_nontax:）は外す・ほか（基本給・残業代・通勤・欠勤控除のマイナス・課税の調整）は入れる
     ・支払基礎日数: 月給・役員＝期間の暦日数（欠勤の日があれば出勤＋有休＋有給の特休で数え「要確認」）・時給と日給＝出勤＋有休＋有給の特休
     ・今の標準報酬と加入・生年月日・入社日は、一番新しい bootstrap の profiles（その期首の版）から読む */
  function attOf(item, code) {
    var l = arr(item && item.lines).filter(function (x) { return x && x.sec === 'att' && x.code === code; })[0];
    return l ? num(l.qty) : null;
  }
  function fromItems(src) {
    src = obj(src);
    var o = fillOpts(src.opts), months = arr(src.payMonths).filter(isYm), want = {}, warns = [];
    months.forEach(function (m) { want[m] = 1; });
    var boots = arr(src.boots).filter(function (b) { return b && b.ok !== false && isYm(b.ym); }).sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    if (!boots.length) return { people: [], warns: [{ code: 'no_data', msg: '給与のデータを読めませんでした' }] };
    var last = boots[boots.length - 1];
    var defs = {};
    arr(last.allowances).forEach(function (a) { if (a && a.code) defs[a.code] = obj(a.def); });
    var cc = obj(src.countCodes), hasCC = Object.keys(cc).length > 0;
    function isCount(code) { var d = defs[code]; return hasCC ? cc[code] === true : !!(d && o.countCalcs.indexOf(d.calc) >= 0); }
    var staffCode = {};
    boots.forEach(function (b) { arr(b.staff).forEach(function (s) { if (s && s.staff_id) staffCode[s.staff_id] = s.emp_code || staffCode[s.staff_id] || ''; }); });
    var profs = {};
    boots.forEach(function (b) { arr(b.profiles).forEach(function (p) { if (p && p.staff_id && !p.none) profs[p.staff_id] = p; }); });
    var people = {}, ov = obj(src.overrides);
    function personOf(sid, nm) {
      if (people[sid]) return people[sid];
      var p = profs[sid] || {}, d = obj(p.data), ins = obj(d.ins), h = obj(ins.health), pe = obj(ins.pension), po = obj(ov[sid]);
      var fr = String(d.freee_emp_num == null ? '' : d.freee_emp_num);
      people[sid] = { staff_id: sid, code: staffCode[sid] || fr, name: p.name || nm || '', pay_type: d.pay_type || '',
        short: po.short === true, cur: { health: int(h.std), pension: int(pe.std) },
        ins: { on: h.on === true, from: h.from || null, to: h.to || null }, entry_date: d.entry_date || null, retire_date: d.retire_date || null,
        exclude: d.exclude === true, months: {} };
      return people[sid];
    }
    boots.forEach(function (b) {
      var st = b.run && b.run.status, conf = st === 'confirmed' || st === 'exported';
      arr(b.items).forEach(function (it) {
        if (!it || !it.staff_id) return;
        var fz = obj(it.frozen), pd = conf && isDate(fz.pay_date) ? fz.pay_date : (b.run && isDate(b.run.pay_date) ? b.run.pay_date : null);
        var pm = pd ? pd.slice(0, 7) : b.ym;
        if (!want[pm]) return;
        var P = personOf(it.staff_id, it.name), item = obj(it.item), mw = [];
        var period = conf && fz.period && isDate(fz.period.from) ? fz.period : (b.period || {});
        var pay = 0, cnt = 0, adjPay = false;
        arr(item.lines).forEach(function (l) {
          if (!l || l.sec !== 'pay') return;
          var code = String(l.code || ''), amt = int(l.amount);
          if (/^adj_nontax:/.test(code)) return;
          if (/^adj:/.test(code)) adjPay = true;
          if (/^f/.test(code) && !/^(adj|absence)/.test(code)) {
            var dc = code.slice(1), def = defs[dc];
            if (def) {
              if (obj(def.attrs).social_ins === false) return;
              if (isCount(dc)) cnt += amt;
            } else if (!/^(basic|board|commute|late|leave_unpaid|paid_leave|paid_leave_hour|holiday_gap|special_paid|ot_)/.test(code)) {
              mw.push({ code: 'def_missing', msg: '定義の無い手当の行があります（' + String(l.name || code) + '・社保の対象として数えました）' });
            }
          }
          pay += amt;
        });
        var pt = (profs[it.staff_id] && obj(profs[it.staff_id].data).pay_type) || P.pay_type;
        var wd = attOf(item, 'workDays'), pdays = attOf(item, 'paidDays') || 0, sp = attOf(item, 'specialPaidDays') || 0, ab = attOf(item, 'absentDays') || 0;
        var days = null, note = '';
        if (pt === 'hourly' || pt === 'daily') {
          if (wd !== null) { days = wd + pdays + sp; note = '出勤' + wd + '＋有休' + pdays + (sp ? '＋特休' + sp : ''); }
        } else {
          var cal = daysBetween(period.from, period.to);
          if (ab > 0 && wd !== null) {
            days = wd + pdays + sp; note = '欠勤' + ab + '日の月（出勤＋有休で数えた）';
            mw.push({ code: 'days_absent', msg: '欠勤のある月の日数は出勤＋有休で数えました（決まりは所定労働日数−欠勤日数・確かめてください）' });
          } else if (cal !== null) { days = cal; note = '暦日数'; }
        }
        if (adjPay) mw.push({ code: 'retro_hint', msg: pm + ' にその月だけの支給の調整があります（3月以前の分の遡及なら遡及の額に入れてください）' });
        var entry = isDate(P.ins.from) ? P.ins.from : P.entry_date;
        var partial = !!(isDate(entry) && isDate(period.from) && entry > period.from && (!isDate(period.to) || entry <= period.to));
        var mo = obj(obj(ov[it.staff_id]).months)[pm] || {};
        if (num(mo.days) !== null) { days = num(mo.days); note = '手で直した'; mw = mw.filter(function (x) { return x.code !== 'days_absent'; }); }
        if (num(mo.retro) !== null) mw = mw.filter(function (x) { return x.code !== 'retro_hint'; });
        if (mo.ackAdj === true) mw = mw.filter(function (x) { return x.code !== 'retro_hint'; });
        P.months[pm] = { ym: pm, confirmed: conf, days: days, daysNote: note, partial: partial, excluded: mo.excluded === true,
          pay: pay, countPay: cnt, retro: int(mo.retro), warns: mw };
      });
    });
    /* 一番新しい版で今の値を上書き（その人の明細が古い月にしか無くても今の標準報酬で比べる） */
    Object.keys(people).forEach(function (sid) {
      var P = people[sid], p = profs[sid];
      if (p) { var d = obj(p.data), ins = obj(d.ins); P.cur = { health: int(obj(ins.health).std), pension: int(obj(ins.pension).std) }; P.ins = { on: obj(ins.health).on === true, from: obj(ins.health).from || null, to: obj(ins.health).to || null }; P.pay_type = d.pay_type || P.pay_type; P.retire_date = d.retire_date || null; P.entry_date = d.entry_date || null; P.exclude = d.exclude === true; }
    });
    /* 加入していて明細が1か月も無い人（例: 4〜6月に休職）も入れる */
    Object.keys(profs).forEach(function (sid) {
      var d = obj(profs[sid].data);
      if (!people[sid] && obj(obj(d.ins).health).on === true && d.exclude !== true) personOf(sid, profs[sid].name);
    });
    var list = Object.keys(people).sort().map(function (sid) {
      var P = people[sid];
      P.months = months.map(function (m) { return P.months[m] || { ym: m, missing: true }; });
      return P;
    }).filter(function (P) { return !P.exclude; });
    return { people: list, warns: warns };
  }

  /* ── 3. 算定基礎届の控え（CSV） ── */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;   /* 表計算の式として読まれないように */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(res) {
    res = obj(res);
    var head = ['従業員番号', '氏名', '区分', '日数の決まり', '従前 健保の標準報酬', '従前 厚年の標準報酬'];
    var ms = [];
    arr(res.people).forEach(function (p) { arr(p.months).forEach(function (m) { if (ms.indexOf(m.ym) < 0) ms.push(m.ym); }); });
    ms.sort();
    ms.forEach(function (m) { var j = +m.slice(5, 7) + '月'; head.push(j + ' 支払基礎日数', j + ' 報酬', j + ' 遡及', j + ' 使った'); });
    head.push('総計', '平均額', '修正平均額', '健保 等級', '健保 標準報酬', '厚年 等級', '厚年 標準報酬', '等級の差', '2等級以上', '回数の手当なしの健保 等級', '状態', '備考');
    var lines = [head.map(csvCell).join(',')];
    arr(res.people).forEach(function (p) {
      var row = [p.code, p.name, KIND_JA[p.kind] || '', p.status === 'out' ? '' : p.rule + '日', p.cur.health ? p.cur.health.std : '', p.cur.pension ? p.cur.pension.std : ''];
      ms.forEach(function (m) {
        var r = arr(p.months).filter(function (x) { return x.ym === m; })[0];
        row.push(r && r.days !== null && r.days !== undefined ? r.days : '', r && !r.why ? r.pay : (r && r.why !== '支給なし' && r.pay ? r.pay : ''), r && r.retro ? r.retro : '', r ? (r.use ? '○' : r.why) : '');
      });
      var nx = p.next || {};
      row.push(p.total === null ? '' : p.total, p.avgRaw === null ? '' : p.avgRaw, p.avgMod === null ? '' : p.avgMod,
        nx.health ? nx.health.grade : '', nx.health ? nx.health.std : '', nx.pension ? nx.pension.grade : '', nx.pension ? nx.pension.std : '',
        p.diff === null ? '' : p.diff, p.big ? '○' : '', p.noCount && p.noCount.health ? p.noCount.health.grade : '',
        STATUS_JA[p.status] || p.status, [p.reason].concat(arr(p.warns).map(function (x) { return x.msg; })).filter(Boolean).join(' / '));
      lines.push(row.map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  var STATUS_JA = { ok: '算定', keep: '従前のまま', review: '要確認', out: '対象外' };

  /* ── 4. 窓の月 ──
     teiji: 年 year の 4・5・6月。forecast: 確定した支給の月の新しい方から3か月（latest は確定した中で一番新しい支給の月） */
  function teijiMonths(year) { return [year + '-04', year + '-05', year + '-06']; }
  function forecastMonths(latest) { return isYm(latest) ? [ymAdd(latest, -2), ymAdd(latest, -1), latest] : []; }
  /* 見込みの時の「新しい等級が効く対象月」: latest の次の 9月分（3月の見込み → その年の9月分・9月以降 → 翌年の9月分） */
  function forecastApplyYm(latest) {
    if (!isYm(latest)) return null;
    var y = +latest.slice(0, 4), m = +latest.slice(5, 7);
    return (m <= 6 ? y : y + 1) + '-09';
  }
  /* 9月分から効かせる時に版を置く月分（翌月徴収なら対象月の翌月の月分） */
  function applyRunYm(applyYm, siMonth) { return isYm(applyYm) ? (siMonth === 'current' ? applyYm : ymAdd(applyYm, 1)) : null; }

  var api = {
    VERSION: VERSION, DEFAULTS: DEFAULTS, DAYS: DAYS, KIND_JA: KIND_JA, STATUS_JA: STATUS_JA,
    compute: compute, person: person, fromItems: fromItems, csv: csv,
    teijiMonths: teijiMonths, forecastMonths: forecastMonths, forecastApplyYm: forecastApplyYm, applyRunYm: applyRunYm,
    gradeOfStd: gradeOfStd, nextLower: nextLower, ymAdd: ymAdd, daysBetween: daysBetween
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PayrollSantei = api;
})(typeof window !== 'undefined' ? window : this);
