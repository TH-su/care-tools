/* kintai-shaho.js — 勤怠の「社会保険の加入の知らせ」の純関数（2026-11-25 新設・ROOT-v7-plus-parity.md の段B・C の1つ）
 *
 * ・DOM に触れない・通信しない。勤怠の計算（kintai-calc.js）と給与の計算（payroll-calc.js）は変えない・呼ばない（月の結果を読むだけ）
 * ・知らせだけ。加入の手続き・給与の社保の計算・数えた時間は何も変えない
 * ・設定は勤怠の設定（kintai_settings.config）の鍵 shaho（既定は切）:
 *     { on, mode:'quarter'|'special', weekH, wageMin, months, baseWeekH, baseMonthDays, exempt:[staff_id] }
 *     quarter＝4分の3基準（通常の労働者の1週の所定労働時間と1月の所定労働日数の、どちらも4分の3以上）
 *     special＝短時間労働者の要件（特定適用事業所・週の所定労働時間が weekH 以上。月額は wageMin（0＝見ない）以上）
 * ・月の時間は年金機構の換算で週へ直す（月の時間×12÷52）。実績は月の集計の workMin（freee から取り込んだ月分も含む）、予定は日の schedWorkMin の合計
 * ・「要対応」は実績が months（既定2）か月続けて基準以上（年金機構の案内: 実際の労働時間が2か月続けて基準以上で、引き続き見込まれる時は3か月目から加入）
 *   「注意」は実績が1か月以上か、今の月分・次の月分の予定が基準以上
 * ・対象外: 設定の exempt に入れた人（加入済み・役員・学生など、管理者が画面で決める）と、給与の設定から読めた時の加入済み（健保と厚年がどちらも加入）・役員
 * ・月額の見込みは給与の設定を読めた時だけ（読めない時は「月額は未判定」）。金額は返す物に入れるが、画面には「以上／未満」だけを出す
 * ★職員の名前は月の結果の staff から読むだけで、保存しない。試験は架空の職員だけ（check/unit/kintai_shaho_test.js）
 */
(function (root) {
  'use strict';
  var DEFAULTS = { on: false, mode: 'quarter', weekH: 20, wageMin: 0, months: 2, baseWeekH: 40, baseMonthDays: 21, exempt: [] };
  var RANGES = { weekH: [1, 40], wageMin: [0, 1000000], months: [1, 6], baseWeekH: [1, 60], baseMonthDays: [1, 31] };
  var INT_KEYS = { wageMin: 1, months: 1 };
  var EXEMPT_MAX = 300, SID_MAX = 64, EPS = 1e-9;
  var LEVEL_RANK = { ok: 0, warn: 1, alert: 2 };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function prevYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m < 1) { m = 12; y--; } return y + '-' + (m < 10 ? '0' : '') + m; }
  function nextYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + (m < 10 ? '0' : '') + m; }
  function ymJa(ym) { return +ym.slice(5, 7) + '月分'; }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function okNum(k, v) {
    if (!fin(v)) return false;
    var r = RANGES[k]; if (v < r[0] || v > r[1]) return false;
    return !INT_KEYS[k] || Math.floor(v) === v;
  }
  function dispName(s) { return s ? String(s.display_name || s.name || s.staff_id || '') : ''; }

  /* 設定の掃除: 形の違う値は既定（読み飛ばす）。on は true の時だけ入（既定は切） */
  function fillConfig(rawCfg) {
    var s = rawCfg && typeof rawCfg === 'object' && rawCfg.shaho && typeof rawCfg.shaho === 'object' && !Array.isArray(rawCfg.shaho) ? rawCfg.shaho : {};
    var o = { on: s.on === true, mode: s.mode === 'special' ? 'special' : 'quarter' };
    ['weekH', 'wageMin', 'months', 'baseWeekH', 'baseMonthDays'].forEach(function (k) { o[k] = okNum(k, s[k]) ? s[k] : DEFAULTS[k]; });
    var ex = [], seen = Object.create(null);
    (Array.isArray(s.exempt) ? s.exempt : []).forEach(function (x) {
      if (typeof x !== 'string' || !x || x.length > SID_MAX || seen[x] || ex.length >= EXEMPT_MAX) return;
      seen[x] = 1; ex.push(x);
    });
    o.exempt = ex;
    return o;
  }
  /* 設定の画面の入力の確かめ（文字のまま受ける）。返す: { vals, bad:[欄の名前] }。vals は保存する shaho の中身（exempt は今のまま渡す） */
  var LABEL = { weekH: '週の所定労働時間の基準', wageMin: '月額の基準', months: '続けて超えた月数', baseWeekH: '通常の労働者の1週の所定労働時間', baseMonthDays: '通常の労働者の1月の所定労働日数' };
  function readForm(f, exempt) {
    var vals = { on: f.on === true, mode: f.mode === 'special' ? 'special' : 'quarter' }, bad = [];
    ['weekH', 'wageMin', 'months', 'baseWeekH', 'baseMonthDays'].forEach(function (k) {
      var raw = f[k] == null ? '' : String(f[k]).trim();
      if (raw === '') { vals[k] = DEFAULTS[k]; return; }
      var n = Number(raw);
      if (!okNum(k, n)) { bad.push(LABEL[k]); return; }
      vals[k] = n;
    });
    vals.exempt = fillConfig({ shaho: { exempt: exempt } }).exempt;
    return { vals: bad.length ? null : vals, bad: bad };
  }

  /* 月の時間（分）を週の時間（分）へ。暦の1か月（28〜31日）の月分は年金機構の換算（月×12÷52）、
     締め日を変えた月分など期間が28日未満・31日より長い時は期間の日数で割る（×7÷日数・反証レビュー 2026-11-25） */
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function daysOf(per) {
    if (!per || !isDate(per.from) || !isDate(per.to)) return null;
    var a = Date.UTC(+per.from.slice(0, 4), +per.from.slice(5, 7) - 1, +per.from.slice(8, 10)), b = Date.UTC(+per.to.slice(0, 4), +per.to.slice(5, 7) - 1, +per.to.slice(8, 10));
    var n = Math.round((b - a) / 86400000) + 1;
    return n > 0 ? n : null;
  }
  function weekMin(monthMin, per) {
    if (!fin(monthMin)) return 0;
    var n = daysOf(per);
    return n && (n < 28 || n > 31) ? monthMin * 7 / n : monthMin * 12 / 52;
  }
  /* 基準の言い方（画面の説明） */
  function fmtH(n) { return String(Math.round(n * 100) / 100); }
  function describe(cfg) {
    if (cfg.mode === 'special') return '短時間労働者の要件（週の所定労働時間が ' + fmtH(cfg.weekH) + ' 時間以上' + (cfg.wageMin > 0 ? '・月額 ' + cfg.wageMin.toLocaleString('ja-JP') + ' 円以上' : '・月額は見ない') + '）';
    return '4分の3基準（週 ' + fmtH(cfg.baseWeekH * 0.75) + ' 時間以上 かつ 月 ' + fmtH(cfg.baseMonthDays * 0.75) + ' 日以上）';
  }
  /* 1か月の時間・日数が基準以上か。wage は月額の見込み（null＝未判定） */
  function hitOf(cfg, min, days, wage, per) {
    var w = weekMin(min, per);
    if (cfg.mode === 'special') {
      if (w + EPS < cfg.weekH * 60) return false;
      if (cfg.wageMin > 0 && fin(wage) && wage < cfg.wageMin) return false;
      return true;
    }
    /* 月の所定日数の4分の3も、期間が暦の1か月でない月分は期間の長さに合わせる（日数×期間÷(365÷12)・反証レビュー 2026-11-25） */
    var n = daysOf(per), dayEq = cfg.baseMonthDays * 0.75 * (n && (n < 28 || n > 31) ? n * 12 / 365 : 1);
    return w + EPS >= cfg.baseWeekH * 0.75 * 60 && (fin(days) ? days : 0) + EPS >= dayEq;
  }
  /* 月の結果から1人の実績と予定（無い人は null） */
  function factsOf(month, sid) {
    var ps = (month && month.people) || [], p = null;
    for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].staff && ps[i].staff.staff_id === sid) { p = ps[i]; break; }
    if (!p) return null;
    var sum = p.sum || {}, days = Array.isArray(p.days) ? p.days : [];
    var actMin = fin(sum.workMin) ? sum.workMin : 0;
    var actDays = fin(sum.workDays) ? sum.workDays : days.filter(function (d) { return d && d.workMin > 0; }).length;
    /* 締めた月分は締めた時の控え（給与へ渡した値）の実働と勤務日数を使う（締めた後に届いた打刻で数字を変えない・36協定と同じ・反証レビュー 2026-11-25） */
    var k = month.k36, snap = false;
    if (k && k.locked && Array.isArray(k.rows)) {
      for (var j = 0; j < k.rows.length; j++) {
        var r = k.rows[j];
        if (r && r.staff_id === sid && fin(r.workMin)) { actMin = r.workMin; if (fin(r.workDays)) actDays = r.workDays; snap = true; break; }
      }
    }
    var planMin = 0, planDays = 0;
    days.forEach(function (d) { if (d && fin(d.schedWorkMin) && d.schedWorkMin > 0) { planMin += d.schedWorkMin; planDays++; } });
    return { actMin: actMin, actDays: actDays, planMin: planMin, planDays: planDays, staff: p.staff, snap: snap };
  }

  /* 給与の設定（payroll_bootstrap の答え）から、1人ずつ「加入済みか・役員か・月額の見込み」だけを取り出す（ほかは捨てる）。
   * 月額の見込み＝基本給（月給）・時給×予定の時間・日給×予定の日数 ＋ 定額の手当のうち最低賃金に入る手当（通勤・精皆勤・家族手当など、所定内賃金に入らない物は
   * 手当の定義で min_wage を外しておく前提・payroll-calc.js の attrsOf と同じ既定）。形の違う人は null（未判定）。
   * plan: { staff_id: { min, days } }（予定の月の時間と日数・時給と日給の人の見込みに使う。予定が0の人は未判定）。
   * today: 'YYYY-MM-DD'（加入しているかを、資格の始まり・終わり（喪失日）・退職日で今日に当てて見る。70歳以上は厚生年金・75歳以上は健康保険を見ない） */
  function covered(x, d, today) {
    if (!x || x.on !== true) return false;
    if (!isDate(today)) return true;
    var from = isDate(x.from) ? x.from : (isDate(d.entry_date) ? d.entry_date : null);
    var loss = isDate(x.to) ? x.to : null;
    if (from && from > today) return false;
    if (loss && loss <= today) return false;
    if (isDate(d.retire_date) && d.retire_date < today) return false;
    return true;
  }
  function ageAtLeast(d, today, n) {
    if (!isDate(d.birth_date) || !isDate(today)) return false;
    var y = +d.birth_date.slice(0, 4) + n, bd = y + d.birth_date.slice(4);
    return bd <= today;   /* n歳の誕生日（法の到達日はその前日・1日の差は知らせに効かない） */
  }
  function payDigest(boot, plan, today) {
    var out = Object.create(null);
    if (!boot || typeof boot !== 'object' || !Array.isArray(boot.profiles)) return null;
    var defs = Object.create(null);
    (Array.isArray(boot.allowances) ? boot.allowances : []).forEach(function (a) {
      if (!a || typeof a.code !== 'string') return;
      var d = a.def && typeof a.def === 'object' ? a.def : a;
      defs[a.code] = d;
    });
    function minWageFixed(def) {
      if (!def || (def.sec && def.sec !== 'pay')) return false;
      if (def.calc && def.calc !== 'fixed') return false;
      var at = def.attrs && typeof def.attrs === 'object' ? def.attrs : {};
      return typeof at.min_wage === 'boolean' ? at.min_wage : true;
    }
    boot.profiles.forEach(function (p) {
      if (!p || typeof p.staff_id !== 'string') return;
      var d = p.data && typeof p.data === 'object' ? p.data : {}, ins = d.ins && typeof d.ins === 'object' ? d.ins : {};
      /* 70歳以上は厚生年金、75歳以上は健康保険（後期高齢者医療へ移る）を見ない */
      var enrolled = (covered(ins.health, d, today) || ageAtLeast(d, today, 75)) && (covered(ins.pension, d, today) || ageAtLeast(d, today, 70));
      var type = d.pay_type, base = Number(d.base), wage = null;
      var fixed = 0;
      (Array.isArray(d.allowances) ? d.allowances : []).forEach(function (a) {
        if (!a || typeof a.code !== 'string' || !own(defs, a.code)) return;
        var amt = Number(a.amount);
        if (minWageFixed(defs[a.code]) && isFinite(amt) && amt > 0) fixed += Math.floor(amt);
      });
      var pl = plan && own(plan, p.staff_id) ? plan[p.staff_id] : null;
      if (isFinite(base) && base >= 0 && d.base !== '' && d.base != null) {
        if (type === 'monthly') wage = Math.floor(base) + fixed;
        else if (type === 'hourly' && pl && fin(pl.min) && pl.min > 0) wage = Math.floor(base * pl.min / 60) + fixed;   /* 予定が0の人は見込めない＝未判定（0円で外さない・反証レビュー） */
        else if (type === 'daily' && pl && fin(pl.days) && pl.days > 0) wage = Math.floor(base * pl.days) + fixed;
      }
      out[p.staff_id] = { enrolled: enrolled, board: type === 'board', wage: wage };
    });
    return out;
  }

  /* 判定。input:
   *   cfg（fillConfig の答え）・curYm（表示中の月分）・today（'YYYY-MM-DD'・本当の今日。期間が今日を含む月分は途中、今日より後に始まる月分は先の月分として実績を数えない）・
   *   curOpen（today が無い時だけ: 表示中の月分がまだ途中）・
   *   months: { ym: computeMonth の答え }（読めた月分だけ・次の月分があれば予定だけ使う）・pay: payDigest の答え（読めない時は null）
   * 返す: { yms（古い順・今の月分まで）, people:[…], counts, payKnown } */
  function judge(input) {
    var cfg = input.cfg || fillConfig({}), cur = input.curYm, by = input.months || {}, pay = input.pay || null;
    var back = Math.max(cfg.months + 1, 3), yms = [], y = cur, i;
    if (!isYm(cur)) return { yms: [], people: [], counts: { alert: 0, warn: 0, ok: 0, exempt: 0, enrolled: 0 }, payKnown: !!pay };
    for (i = 0; i < back; i++) { yms.unshift(y); y = prevYm(y); }
    var nx = nextYm(cur), ex = Object.create(null);
    cfg.exempt.forEach(function (s) { ex[s] = 1; });
    /* 職員: 今の月分の名簿（在籍）を軸に、前の月分にだけいる人は出さない（辞めた人を知らせない） */
    var curM = by[cur], staff = [];
    /* 打刻の画面に出さない仮の枠（clock_visible が false）も出さない（職員マスタとの突き合わせと同じ・反証レビュー） */
    ((curM && curM.people) || []).forEach(function (p) { if (p && p.staff && p.staff.active !== false && p.staff.clock_visible !== false) staff.push(p.staff); });
    var today = isDate(input.today) ? input.today : null;
    function stateOf(m) {
      var per = by[m] && by[m].period;
      if (today && per && isDate(per.from) && isDate(per.to)) return per.from > today ? 'future' : per.to >= today ? 'open' : 'done';
      return !today && input.curOpen && m === cur ? 'open' : 'done';
    }
    var counts = { alert: 0, warn: 0, ok: 0, exempt: 0, enrolled: 0 }, people = [];
    staff.forEach(function (st) {
      var sid = st.staff_id, pd = pay && own(pay, sid) ? pay[sid] : null;
      var wage = pd && fin(pd.wage) ? pd.wage : null;
      var row = { staff_id: sid, name: dispName(st), months: [], level: 'ok', streak: 0, short: false, why: '', wage: wage,
        wageState: cfg.mode === 'special' && cfg.wageMin > 0 ? (wage == null ? 'unknown' : wage >= cfg.wageMin ? 'over' : 'under') : 'off' };
      if (ex[sid]) { row.level = 'exempt'; row.why = '対象外にしています'; counts.exempt++; people.push(row); return; }
      if (pd && pd.enrolled) { row.level = 'enrolled'; row.why = '給与の設定で加入しています'; counts.enrolled++; people.push(row); return; }
      if (pd && pd.board) { row.level = 'exempt'; row.why = '役員です'; counts.exempt++; people.push(row); return; }
      function monthRow(m) {
        var f = by[m] ? factsOf(by[m], sid) : null;
        var per = by[m] && by[m].period, st0 = stateOf(m);
        return f ? { ym: m, have: true, state: st0, snap: f.snap, actMin: f.actMin, actDays: f.actDays, planMin: f.planMin, planDays: f.planDays,
          actWeek: weekMin(f.actMin, per), planWeek: weekMin(f.planMin, per),
          actHit: st0 !== 'future' && hitOf(cfg, f.actMin, f.actDays, wage, per), planHit: f.planMin > 0 && hitOf(cfg, f.planMin, f.planDays, wage, per) }
          : { ym: m, have: !!by[m], state: st0, actMin: 0, actDays: 0, planMin: 0, planDays: 0, actWeek: 0, planWeek: 0, actHit: false, planHit: false, none: !!by[m] };
      }
      yms.forEach(function (m) { row.months.push(monthRow(m)); });
      var nf = by[nx] ? factsOf(by[nx], sid) : null, nper = by[nx] && by[nx].period;
      row.next = nf ? { ym: nx, planMin: nf.planMin, planDays: nf.planDays, planWeek: weekMin(nf.planMin, nper), planHit: nf.planMin > 0 && hitOf(cfg, nf.planMin, nf.planDays, wage, nper) } : null;
      /* 続けて超えた月数: 表示中の月分から前へ。先の月分（今日より後に始まる）は飛ばし、途中の月分（今日を含む）はまだ超えていなければ飛ばす
         （先の月分を開いても、本当の今の月分の途中の実績を「済んだ月」として数えない・反証レビュー 2026-11-25） */
      /* 数えるのは表に出す月分に限らず、読めた月分を前へ（先の月分を開いた時に、表の左端で切れないように・最大24か月） */
      var last = row.months[row.months.length - 1], ym0 = cur, guard = 0, mm = monthRow(ym0);
      while (guard++ < 24 && (mm.state === 'future' || (mm.state === 'open' && !mm.actHit))) { ym0 = prevYm(ym0); mm = monthRow(ym0); }
      var streak = 0, counted = 0;
      for (; guard++ < 48; ym0 = prevYm(ym0), mm = monthRow(ym0)) {
        if (!mm.have || mm.none) break;   /* 読めていない月分・その月分の名簿にいない（入職前など）月分で止める＝足りない */
        counted++;
        if (!mm.actHit) break;
        streak++;
      }
      row.streak = streak;
      row.short = streak < cfg.months && counted === streak;   /* 届かない月に当たらないまま、読めた月分（名簿にいた月分）が尽きた＝判定できる月分が足りない */
      var planNow = last && last.planHit, planNext = row.next && row.next.planHit;
      if (streak >= cfg.months) { row.level = 'alert'; row.why = '実績が ' + streak + ' か月続けて基準以上（加入の手続きが要るか確かめてください）'; }
      else if (streak >= 1 || planNow || planNext) {
        row.level = 'warn';
        var w = [];
        if (streak >= 1) w.push('実績が ' + streak + ' か月基準以上');
        if (planNow) w.push(ymJa(cur) + 'の予定が基準以上');
        if (planNext) w.push(ymJa(nx) + 'の予定が基準以上');
        row.why = w.join('・') + (cfg.mode === 'special' ? '（所定労働時間で判定するため、雇用契約の時間を確かめてください）' : '');
      } else row.why = row.short ? '判定できる月分が足りません' : '基準に届いていません';
      if (row.wageState === 'unknown' && row.level !== 'ok') row.why += '・月額は未判定';
      counts[row.level]++;
      people.push(row);
    });
    var rank = { alert: 0, warn: 1, ok: 2, enrolled: 3, exempt: 4 };
    people.sort(function (a, b) { return rank[a.level] - rank[b.level]; });   /* 同じ段の中は今の月分の名簿の並び（入職順）のまま＝安定ソート */
    return { yms: yms, next: nx, people: people, counts: counts, payKnown: !!pay, cfg: cfg };
  }

  /* ホームの箱（kintai-monitor.js の箱と同じ形） */
  function box(res) {
    var rows = res.people.filter(function (p) { return p.level === 'alert' || p.level === 'warn'; }).map(function (p) {
      return { staff_id: p.staff_id, name: p.name, text: (p.level === 'alert' ? '要対応: ' : '注意: ') + p.why };
    });
    var level = res.counts.alert ? 'alert' : res.counts.warn ? 'warn' : 'ok';
    var short = res.people.some(function (p) { return p.short; });
    return { key: 'shaho', title: '社会保険の加入', count: rows.length, level: level, tab: 'shaho', rows: rows,
      note: (short ? '読めた月分が足りない人がいます（月分がたまると判定します）' : '') + (res.payKnown ? '' : (short ? '。' : '') + '給与の設定を読めないため、加入済みの人も並ぶことがあります') };
  }

  var api = { DEFAULTS: DEFAULTS, RANGES: RANGES, fillConfig: fillConfig, readForm: readForm, weekMin: weekMin, describe: describe, hitOf: hitOf,
    factsOf: factsOf, payDigest: payDigest, judge: judge, box: box, prevYm: prevYm, nextYm: nextYm, LEVEL_RANK: LEVEL_RANK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KintaiShaho = api;
})(typeof window !== 'undefined' ? window : this);
