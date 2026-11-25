/* kintai-leave-kinds.js — 休暇の種類を増やした分・休業の期間・エラー勤務の残り3種・振替休日の知らせ（純関数・DOM に触れない・2026-11-25 新設・段B）
 *
 * ★勤怠の数え方（kintai-calc.js の computeMonth）と給与へ渡す値は一切変えない。
 *   computeMonth は今の4種類（時間単位の有休・特別休暇・代休・振替休日）だけを数え、ここで足した種類の行は読み飛ばす（今のまま）。
 *   そのため、ここで足した種類の休暇を入れても、勤務の予定がある日は今までどおり「打刻なし」の要確認に出て、
 *   事務所が「欠勤」にすれば欠勤として数える（給与の欠勤の差し引きも今のまま）。種類ごとに給与で分けて扱うのは給与の作業（この部品の外）。
 *
 * 1. 休暇の種類（DB の kintai_absences.kind・統合 0131 で足す。名前・単位は法の要件に合わせた・有給か無給かは就業規則の事柄で、ここでは全部無給＝仮置き）
 *    child_care  子の看護等休暇（育介法16条の2）… 1日か1時間単位。1年（既定 4/1〜3/31）に5日（子が2人以上は10日）
 *    family_care 介護休暇（育介法16条の5）       … 1日か1時間単位。1年に5日（対象の家族が2人以上は10日）
 *    maternity   産前産後休業（労基法65条）        … 1日単位
 *    childcare   育児休業                          … 1日単位
 *    papa        産後パパ育休（出生時育児休業）    … 1日単位
 *    care_leave  介護休業                          … 1日単位
 *    public_off  公休                              … 1日単位
 *    injury      労災による休業                    … 1日単位
 *    忌引は今ある特別休暇（設定の特別休暇の種類「慶弔」か、設定で足した種類）で入れる（種類を分けない・仮置き）。
 * 2. 休業の期間（DB の kintai_leave_terms・統合 0131）: 産前産後・育休・産後パパ育休・介護休業・労災の休業の開始日と終了日
 * 3. エラー勤務の残り3種（要確認として一覧に出す・締めは止めない＝仮置き・数えた時間は変えない）
 *    none_day   予定も実績も無い（この月分に、勤務の予定・打刻・有休・休暇・休業の期間のどれも無い在籍の職員）
 *    leave_short 休暇の残りが足りない（子の看護等休暇・介護休暇の1年の日数を超えた日・有給の「付与の無い使用」）
 *    term_work  休業中の勤務（休業の期間の中の日、1日の休暇（ここで足した種類）の日に、打刻か実働がある）
 * 4. 振替休日を取っていない（知らせ）
 *    no_swap    法定休日に働いた日に、振替休日・代休の記録が無い（法定休日の曜日を設定で決めている時だけ）
 *    swap_out   振替の働く日と休む日が別の月分（割増が要ることがある）
 * ★職員の名前は持たない（staff_id だけ）。
 */
(function (root) {
  'use strict';
  var KINDS = [
    { code: 'child_care', name: '子の看護等休暇', unit: 'hour', cap: 'childCareDays' },
    { code: 'family_care', name: '介護休暇', unit: 'hour', cap: 'familyCareDays' },
    { code: 'maternity', name: '産前産後休業', unit: 'day', term: true },
    { code: 'childcare', name: '育児休業', unit: 'day', term: true },
    { code: 'papa', name: '産後パパ育休', unit: 'day', term: true },
    { code: 'care_leave', name: '介護休業', unit: 'day', term: true },
    { code: 'public_off', name: '公休', unit: 'day' },
    { code: 'injury', name: '労災の休業', unit: 'day', term: true }
  ];
  var BY = {}; KINDS.forEach(function (k) { BY[k.code] = k; });
  var TERM_KINDS = KINDS.filter(function (k) { return k.term; }).map(function (k) { return k.code; });
  var CAP_DEFAULT = 5, CAP_OK = [5, 10];
  var TERM_MAX_DAYS = 3 * 366;   /* 1つの期間の長さの上限（育休の延長の最長2年＋余り・DB も同じ・仮置き） */

  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function toMs(v) { if (v == null || v === '') return null; var n = typeof v === 'number' ? v : Date.parse(v); return isFinite(n) ? n : null; }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }

  function isKind(c) { return typeof c === 'string' && Object.prototype.hasOwnProperty.call(BY, c); }
  function kindOf(c) { return isKind(c) ? BY[c] : null; }
  function nameOf(c) { return isKind(c) ? BY[c].name : ''; }

  /* 1年の日数の上限（設定 childCareDays・familyCareDays は 5 か 10。ほかの値・無い時は 5）。
     子・対象の家族が2人以上で10日の人は、設定 careLeave10 の {child_care:[staff_id…], family_care:[staff_id…]} に載せる（人ごと・反証レビュー 2026-11-25・画面の欄はまだ＝仮置き） */
  function capOf(cfg, code, sid) {
    var k = kindOf(code);
    if (!k || !k.cap) return null;
    var ten = cfg && cfg.careLeave10 && typeof cfg.careLeave10 === 'object' ? cfg.careLeave10[code] : null;
    if (sid && Array.isArray(ten) && ten.indexOf(sid) >= 0) return 10;
    var v = cfg && cfg[k.cap];
    return CAP_OK.indexOf(v) >= 0 ? v : CAP_DEFAULT;
  }
  /* 1年の初め（既定 4月1日・設定 careYearStart「MM-DD」で変えられる・崩れていれば 04-01） */
  function yearStartMd(cfg) {
    var v = cfg && cfg.careYearStart;
    if (typeof v === 'string' && /^\d{2}-\d{2}$/.test(v) && isDate('2001-' + v)) return v;
    return '04-01';
  }
  function yearOf(date, cfg) {
    var s = yearStartMd(cfg), y = +date.slice(0, 4), from = y + '-' + s;
    if (date < from) from = (y - 1) + '-' + s;
    var to = addDays((+from.slice(0, 4) + 1) + '-' + s, -1);
    return { from: from, to: to };
  }

  /* 画面で入れる時の形の確かめ（DB の kintai_absence_add も同じ決まりで断る）。
     返す: null（よい）か断る語（'badkind'・'badvalue'）。minutes は null（1日）か 60 の倍数で1日の時間まで（時間単位の種類だけ） */
  function checkAdd(a, dayMin) {
    if (!a || !isKind(a.kind)) return 'badkind';
    var k = BY[a.kind], m = a.minutes;
    if (a.paid === true || a.type_code != null || a.link_date != null) return 'badvalue';
    if (m == null) return null;
    if (k.unit !== 'hour') return 'badvalue';
    if (typeof m !== 'number' || m % 60 !== 0 || m < 60 || m > (dayMin || 480)) return 'badvalue';
    return null;
  }

  /* 取り消していない・形の合う行だけ（ここで足した種類だけ） */
  function liveAbs(list) {
    return (Array.isArray(list) ? list : []).filter(function (a) { return a && !a.voided_at && typeof a.staff_id === 'string' && isDate(a.date) && isKind(a.kind); });
  }
  /* 休業の期間の確かめ（取り消していない・種類と日付の形・終わりが始まり以降・長さの上限） */
  function liveTerms(list) {
    return (Array.isArray(list) ? list : []).filter(function (t) {
      return t && !t.voided_at && typeof t.staff_id === 'string' && TERM_KINDS.indexOf(t.kind) >= 0 && isDate(t.date_from) && isDate(t.date_to) &&
        t.date_from <= t.date_to && daysBetween(t.date_from, t.date_to) < TERM_MAX_DAYS;
    });
  }
  /* 締めた月分は、締めた時にあった期間だけを使う（締めた後に足した・取り消した期間で、締めた月分の要確認を変えない） */
  function termsAt(list, lockedAt) {
    var lm = toMs(lockedAt), src = Array.isArray(list) ? list : [];
    if (lm == null) return liveTerms(src);
    return liveTerms(src.map(function (t) {
      if (!t) return t;
      var c = toMs(t.created_at), v = toMs(t.voided_at);
      if (c != null && c > lm) return null;
      if (v != null && v > lm) { var o = {}; for (var k in t) o[k] = t[k]; o.voided_at = null; return o; }
      return t;
    }));
  }
  /* その日に効いている休業の期間（無ければ null） */
  function termOn(terms, sid, date) {
    for (var i = 0; i < terms.length; i++) { var t = terms[i]; if (t.staff_id === sid && t.date_from <= date && t.date_to >= date) return t; }
    return null;
  }

  /* 日の行の休暇の文（画面の印に使う・ここで足した種類だけ） */
  function absText(a) {
    if (!a || !isKind(a.kind)) return '';
    return BY[a.kind].name + (a.minutes != null ? ' ' + (a.minutes / 60) + '時間' : '');
  }
  /* その人・その日の、ここで足した種類の休暇（画面の日の印） */
  function dayAbs(absences, sid, date) {
    return liveAbs(absences).filter(function (a) { return a.staff_id === sid && a.date === date; });
  }
  /* 休暇の日数（1日＝1・時間単位は 分÷1日の時間＝その人の1日の所定の時間） */
  function daysOf(a, dayMin) { return a.minutes == null ? 1 : a.minutes / (dayMin > 0 ? dayMin : 480); }

  /* 月分の中の、ここで足した種類の日数（人ごと {kind: 日数}・時間単位は日数に直す） */
  function monthDays(absences, sid, period, dayMin) {
    var o = {};
    liveAbs(absences).forEach(function (a) {
      if (a.staff_id !== sid || a.date < period.from || a.date > period.to) return;
      o[a.kind] = Math.round(((o[a.kind] || 0) + daysOf(a, dayMin)) * 100) / 100;
    });
    return o;
  }

  /* 子の看護等休暇・介護休暇の1年の使用（その日までの合計・日数） */
  function yearUsed(yearAbs, sid, code, date, cfg, dayMin) {
    /* 分のまま足して最後に1回だけ日数に直す（1行ずつ丸めると1時間単位の積み重ねで5日ちょうどが超えて見える・反証レビュー 2026-11-25） */
    var y = yearOf(date, cfg), dm = dayMin > 0 ? dayMin : 480, m = 0;
    liveAbs(yearAbs).forEach(function (a) { if (a.staff_id === sid && a.kind === code && a.date >= y.from && a.date <= date) m += a.minutes == null ? dm : a.minutes; });
    return { from: y.from, to: y.to, usedMin: m, dayMin: dm, used: Math.round(m / dm * 100) / 100, cap: capOf(cfg, code, sid) };
  }

  /* エラー勤務の残り3種と振替の知らせ。
     opts: { month（computeMonth の結果）, absences（その月分の休暇の行・全部の種類）, yearAbs（1年の初めから月分の終わりまでの、ここで足した種類の行・省略可）,
             terms（休業の期間・省略可）, config, lockedAt, paidOver（{staff_id: 付与の無い有休の使用の日数}・省略可）, dayMin（{staff_id: 1日の分}・省略可） }
     返す: { review:[{staff_id, date, code, text}], notice:[{staff_id, date, code, text}], legalHoliday:真偽, yearOk:真偽 } */
  function checkMonth(opts) {
    var m = opts && opts.month, out = { review: [], notice: [], legalHoliday: false, yearOk: Array.isArray(opts && opts.yearAbs) };
    if (!m || !Array.isArray(m.people) || !m.period) return out;
    var per = m.period, cfg = opts.config || m.config || {}, allAbs = Array.isArray(opts.absences) ? opts.absences : [];
    var newAbs = liveAbs(allAbs), terms = termsAt(opts.terms, opts.lockedAt), dmBy = opts.dayMin || {};
    out.legalHoliday = cfg.legal_holiday != null;
    var rawLive = allAbs.filter(function (a) { return a && !a.voided_at && typeof a.staff_id === 'string' && isDate(a.date); });
    m.people.forEach(function (p) {
      var st = p.staff || {}, sid = st.staff_id, dm = dmBy[sid] > 0 ? dmBy[sid] : (cfg.dayHours > 0 ? cfg.dayHours * 60 : 480);
      if (typeof sid !== 'string') return;
      var days = Array.isArray(p.days) ? p.days : [];
      /* 1. 予定も実績も無い（在籍の人だけ・月分の全部が休業の期間の人は出さない） */
      if (st.active !== false) {
        var sm = p.sum || {};
        var any = !!sm.imported || sm.workMin > 0 || sm.paidDays > 0 || days.some(function (d) { return (d.blocks || []).some(function (b) { return b.sched || (b.punches || []).length; }) || d.paidMin > 0 || d.workMin > 0 || (d.absences || []).length; }) ||
          rawLive.some(function (a) { return a.staff_id === sid && ((a.date >= per.from && a.date <= per.to) || (a.link_date && a.link_date >= per.from && a.link_date <= per.to)); }) ||
          terms.some(function (t) { return t.staff_id === sid && t.date_from <= per.to && t.date_to >= per.from; });
        if (!any) out.review.push({ staff_id: sid, date: null, code: 'none_day', text: 'この月分に、勤務の予定も打刻も休暇もありません（シフトの取り込み漏れ・退職の手続きを確かめてください）' });
      }
      /* 3. 休業中の勤務（期間の中の日・1日の休暇の日に打刻か実働がある） */
      days.forEach(function (d) {
        if (d.date < per.from || d.date > per.to) return;
        var worked = d.workMin > 0 || (d.blocks || []).some(function (b) { return (b.punches || []).length > 0; });
        if (!worked) return;
        var t = termOn(terms, sid, d.date);
        if (t) { out.review.push({ staff_id: sid, date: d.date, code: 'term_work', text: nameOf(t.kind) + 'の期間（' + md(t.date_from) + '〜' + md(t.date_to) + '）の中の日に打刻があります' }); return; }
        var full = newAbs.filter(function (a) { return a.staff_id === sid && a.date === d.date && a.minutes == null; })[0];
        if (full) out.review.push({ staff_id: sid, date: d.date, code: 'term_work', text: nameOf(full.kind) + '（1日）の日に打刻があります' });
      });
      /* 2. 休暇の残りが足りない: 子の看護等休暇・介護休暇は1年の日数を超えた日（月分の中の日だけ）・有給は付与の無い使用 */
      if (out.yearOk) {
        ['child_care', 'family_care'].forEach(function (code) {
          var mine = liveAbs(opts.yearAbs).filter(function (a) { return a.staff_id === sid && a.kind === code; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
          var yr = null, usedMin = 0;
          mine.forEach(function (a) {
            var y = yearOf(a.date, cfg);
            if (!yr || yr.from !== y.from) { yr = y; usedMin = 0; }
            usedMin += a.minutes == null ? dm : a.minutes;   /* 分のまま足す（反証レビュー 2026-11-25） */
            var cap = capOf(cfg, code, sid);
            if (usedMin > cap * dm && a.date >= per.from && a.date <= per.to) out.review.push({ staff_id: sid, date: a.date, code: 'leave_short', text: nameOf(code) + 'が1年（' + md(y.from) + '〜' + md(y.to) + '）の ' + cap + ' 日を超えています（' + (Math.round(usedMin / dm * 100) / 100) + ' 日）' });
          });
        });
      }
      var po = opts.paidOver && opts.paidOver[sid];
      if (typeof po === 'number' && po > 0) out.review.push({ staff_id: sid, date: null, code: 'leave_short', text: '有給の残りが足りません（付与の無い使用 ' + po + ' 日）' });
      /* 4. 振替休日の知らせ */
      if (out.legalHoliday) {
        days.forEach(function (d) {
          if (d.date < per.from || d.date > per.to || !(d.holidayMin > 0)) return;
          var has = rawLive.some(function (a) { return a.staff_id === sid && (a.kind === 'swap' || a.kind === 'comp') && a.link_date === d.date; });
          if (!has) out.notice.push({ staff_id: sid, date: d.date, code: 'no_swap', text: '法定休日に働いた日に、振替休日・代休の記録がありません（休日労働として割増で数えています）' });
        });
      }
      rawLive.forEach(function (a) {
        if (a.staff_id !== sid || a.kind !== 'swap' || !isDate(a.link_date)) return;
        var wIn = a.link_date >= per.from && a.link_date <= per.to, oIn = a.date >= per.from && a.date <= per.to;
        if (wIn && !oIn) out.notice.push({ staff_id: sid, date: a.link_date, code: 'swap_out', text: '振替で働く日（' + md(a.link_date) + '）の休む日（' + md(a.date) + '）が別の月分です（週・月の時間外になることがあります）' });
      });
    });
    var ord = function (x, y) { var a = x.date || '', b = y.date || ''; return a < b ? -1 : a > b ? 1 : (x.staff_id < y.staff_id ? -1 : x.staff_id > y.staff_id ? 1 : 0); };
    out.review.sort(ord); out.notice.sort(ord);
    return out;
  }

  /* 休業の期間の一覧（人ごと・新しい順。今日の時点の状態 'now'（期間中）・'future'（これから）・'past'（終わった）を付ける） */
  function termList(list, today) {
    return liveTerms(list).map(function (t) {
      return { id: t.id || null, staff_id: t.staff_id, kind: t.kind, name: nameOf(t.kind), date_from: t.date_from, date_to: t.date_to, note: t.note || '',
        days: daysBetween(t.date_from, t.date_to) + 1, state: today && t.date_to < today ? 'past' : today && t.date_from > today ? 'future' : 'now' };
    }).sort(function (a, b) { return a.date_from < b.date_from ? 1 : a.date_from > b.date_from ? -1 : 0; });
  }
  /* 期間を入れる時の確かめ（DB の kintai_leave_term_add も同じ決まりで断る）。同じ人・同じ種類で重なる期間があれば 'overlap' */
  function checkTerm(t, existing) {
    if (!t || TERM_KINDS.indexOf(t.kind) < 0) return 'badkind';
    if (!isDate(t.date_from) || !isDate(t.date_to) || t.date_from > t.date_to) return 'baddate';
    if (daysBetween(t.date_from, t.date_to) >= TERM_MAX_DAYS) return 'baddate';
    if (typeof t.note === 'string' && t.note.length > 200) return 'badvalue';
    var ov = liveTerms(existing).some(function (x) { return x.staff_id === t.staff_id && x.kind === t.kind && x.date_from <= t.date_to && x.date_to >= t.date_from; });
    return ov ? 'overlap' : null;
  }

  var api = { KINDS: KINDS, TERM_KINDS: TERM_KINDS, CAP_DEFAULT: CAP_DEFAULT, TERM_MAX_DAYS: TERM_MAX_DAYS,
    isKind: isKind, kindOf: kindOf, nameOf: nameOf, capOf: capOf, yearOf: yearOf, checkAdd: checkAdd, liveAbs: liveAbs, liveTerms: liveTerms, termsAt: termsAt,
    termOn: termOn, absText: absText, dayAbs: dayAbs, daysOf: daysOf, monthDays: monthDays, yearUsed: yearUsed, checkMonth: checkMonth, termList: termList, checkTerm: checkTerm };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KintaiLeaveKinds = api;
})(typeof window !== 'undefined' ? window : this);
