/* kintai-self-calc.js — 職員本人のスマホの勤怠の画面（kintai-self.html）の純関数（2026-11-20 新設・契約 ~/Claude/Work/勤怠管理アプリ/ROOT-v5-freee.md「段5」）
 * ════════════════════════════════════════════════════════════════
 * ・画面（kintai-self.js）とは通信も DOM も持たない。試験は check/unit/kintai_self_test.js
 * ・勤怠の数え方は管理画面と同じ部品（kintai-calc.js の computeMonth・kintai-leave.js の summary）を、引数で受け取って使う（写さない）
 * ・時刻は「1970年からのミリ秒」、日付は日本時間の 'YYYY-MM-DD'。申請で送る時刻は '+09:00' つきの ISO 文字列
 * ・氏名・番号などの個人情報をこのファイルに書かない（試験も架空の職員だけ）
 */
(function (root) {
  'use strict';
  var MIN = 60000, DAY = 86400000, JST = 9 * 3600000;
  /* 2分さわらないと暗証番号の画面へ戻る（仮置き・契約の段5） */
  var IDLE_MS = 2 * 60 * 1000;
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.getUTCFullYear() === +s.slice(0, 4) && d.getUTCMonth() === +s.slice(5, 7) - 1 && d.getUTCDate() === +s.slice(8, 10);
  }
  function isYm(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function todayOf(nowMs) { var d = new Date(nowMs + JST); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function ymOf(date) { return date.slice(0, 7); }
  function nextYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + pad(m); }
  function prevYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m < 1) { m = 12; y--; } return y + '-' + pad(m); }
  function addDays(date, n) {
    var d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * DAY);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function hm(ms) { if (ms == null || !isFinite(ms)) return ''; var d = new Date(ms + JST); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  /* 分 → 「8:05」（0 は「0:00」） */
  function minText(m) { m = Math.max(0, Math.round(+m || 0)); return Math.floor(m / 60) + ':' + pad(m % 60); }
  /* 'YYYY-MM-DD' → 「5/10（火）」 */
  function dayLabel(date) {
    var w = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
    return (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + '（' + WD[w] + '）';
  }
  function ymdJa(date) { return isDate(date) ? date.slice(0, 4) + '年' + (+date.slice(5, 7)) + '月' + (+date.slice(8, 10)) + '日' : ''; }
  function ymJa(ym) { return isYm(ym) ? ym.slice(0, 4) + '年' + (+ym.slice(5, 7)) + '月分' : ''; }

  /* ── 登録の番号 ──
     8文字の番号のそろえ方。enroll.js・login.js の shortOf と一字一句同じ（check/unit/kintai_self_test.js が確かめる） */
  // SHORTOF-BEGIN
  function shortOf(v) {
    var s = String(v == null ? '' : v);
    if (s.length > 32) return '';
    try { s = s.normalize('NFKC'); } catch (e) { /* 古い端末はそのまま */ }
    s = s.toUpperCase().replace(/[\s\-\u2010-\u2015\u2212\u30fc\uff70]/g, '');
    return /^[2-9A-HJKMNP-Z]{8}$/.test(s) ? s : '';
  }
  // SHORTOF-END
  /* 住所の # の後ろ（c=40字の16進＝QR、または c=8文字）から番号を取り出す。無い・形が違う時は '' */
  function codeFromHash(hash) {
    var m = /(?:^#|&)c=([^&]*)/.exec(String(hash || '').replace(/^#?/, '#'));
    var v = '';
    if (m) { try { v = decodeURIComponent(m[1]); } catch (e) { v = ''; } }
    if (/^[0-9a-f]{40}$/.test(v)) return v;
    return shortOf(v);
  }
  /* 暗証番号: 4桁の数字で、2回同じ（登録の時）。打刻の番号と同じかはサーバーが確かめる。返す: '' か断りの文 */
  function pinProblem(p1, p2) {
    var a = String(p1 == null ? '' : p1), b = String(p2 == null ? '' : p2);
    if (!/^[0-9]{4}$/.test(a)) return '暗証番号は4桁の数字で入れてください。';
    if (p2 !== undefined && a !== b) return '2回目の暗証番号が1回目と違います。';
    return '';
  }

  /* ── 月の表示 ──
     画面が最初に読む月分: 今日の暦の月で読み、その月分の期間が今日より前に終わっている（締め日が月末でない）時は次の月分 */
  function currentYm(today, ym0, period) {
    if (period && isDate(period.to) && today > period.to) return nextYm(ym0);
    if (period && isDate(period.from) && today < period.from) return prevYm(ym0);
    return ym0;
  }
  /* computeMonth の結果（自分1人）から、日ごとの行を作る。
     返す: [{ date, label, sched, punches, counted, work, workMin, paid, flags:[文], future }]（期間の日付の順・予定も打刻も無い日は出さない） */
  /* 休暇の種類（統合 0113・段4）の日の行の印。言い方は勤怠の管理画面（kintai.js の absTags）と同じ。
     a は computeMonth が日の行に付ける absences の1つ（{kind, minutes, paid, type_code, link_date}・振替は {kind:'swap', role:'off'|'work', link_date|date}）。
     types は特別休暇の種類の一覧（[{code, name}]・名前が無い時は印のまま） */
  function mdOf(date) { return typeof date === 'string' ? date.slice(5).replace('-', '/') : ''; }
  function absLabel(a, types) {
    if (!a || typeof a !== 'object') return '';
    if (a.kind === 'swap') return a.role === 'off' ? '振替休日（働く日 ' + mdOf(a.link_date) + '）' : '振替で働く日（休む日 ' + mdOf(a.date) + '）';
    if (a.kind === 'hourly_paid') return '時間単位の有休 ' + ((+a.minutes || 0) / 60) + '時間';
    if (a.kind === 'special') {
      var nm = String(a.type_code || '');
      (types || []).forEach(function (x) { if (x && x.code === a.type_code && x.name) nm = x.name; });
      return '特別休暇「' + nm + '」' + (a.minutes != null ? '半日' : '') + (a.paid ? '' : '（無給）');
    }
    if (a.kind === 'comp') return '代休' + (a.minutes != null ? ' 半日' : '') + (a.link_date ? '（' + mdOf(a.link_date) + ' の休日出勤）' : '');
    return '';
  }
  function dayRows(month, C, today) {
    var p = month && month.people && month.people[0];
    if (!p) return [];
    var FL = (C && C.FLAG_LABEL) || {};
    var types = [];
    try { types = C && typeof C.leaveTypesOf === 'function' ? C.leaveTypesOf(month.config) : []; } catch (e) { types = []; }
    return (p.days || []).map(function (d) {
      var sched = [], punches = [], counted = [], flags = [];
      (d.blocks || []).forEach(function (b) {
        if (b.schedStart != null && b.schedEnd != null) sched.push(hm(b.schedStart) + '〜' + hm(b.schedEnd));
        (b.punches || []).forEach(function (x) { punches.push((x.kind === 'in' ? '出 ' : '退 ') + hm(x.at)); });
        if (b.countStart != null && b.countEnd != null) counted.push(hm(b.countStart) + '〜' + hm(b.countEnd));
        (b.flags || []).forEach(function (f) {
          if (f === 'office') return;   /* 事務所が足した打刻は職員には印を出さない（承認した直しも含む） */
          var t = FL[f] || '';
          if (t && flags.indexOf(t) < 0) flags.push(t);
        });
      });
      if (d.paidDays > 0) sched.push(d.paidDays === 0.5 ? '有休（半日）' : '有休');
      var absences = (Array.isArray(d.absences) ? d.absences : []).map(function (a) { return absLabel(a, types); }).filter(Boolean);
      return { date: d.date, label: dayLabel(d.date), sched: sched.join('・'), punches: punches.join('　'), counted: counted.join('・'),
        work: d.workMin > 0 ? minText(d.workMin) : '', workMin: d.workMin || 0, paid: d.paidDays || 0, flags: flags, absences: absences, future: !!(today && d.date > today) };
    });
  }
  /* 月の合計（実働・出勤日数・有休の日数・残業） */
  function monthTotals(month) {
    var p = month && month.people && month.people[0], s = (p && p.sum) || {};
    return { workMin: s.workMin || 0, workDays: s.workDays || 0, paidDays: s.paidDays || 0, overtimeMin: s.overtimeMin || 0 };
  }
  /* 締めてあるか・期間の表示 */
  function monthHead(data, C, ym) {
    var per = C.periodOf(ym, data && data.period);
    return { label: C.periodLabel(ym, data && data.period), from: per.from, to: per.to, locked: !!(data && data.month && data.month.locked_at) };
  }
  /* 受け口の月の答え → computeMonth（管理画面と同じ渡し方） */
  function computeOf(data, ym, C, nowMs) {
    var cfg = {}, k, sc = (data.settings && data.settings.config) || {}, snap = data.month && data.month.locked_at && data.month.snapshot && data.month.snapshot.config;
    var src = snap || sc; for (k in src) cfg[k] = src[k];
    /* 休暇（統合 0113・自分の分だけ。受け口は職員の番号を付けないので、自分の番号を付けてから渡す）。段4 の computeMonth が日の行に印を付ける */
    var sid = data.staff && data.staff[0] && data.staff[0].staff_id;
    var absences = sid ? (Array.isArray(data.absences) ? data.absences : []).filter(function (a) { return a && typeof a === 'object'; })
      .map(function (a) { var o = { staff_id: sid }, kk; for (kk in a) if (kk !== 'staff_id') o[kk] = a[kk]; return o; }) : [];
    return C.computeMonth({ ym: ym, period: data.period, staff: data.staff || [], schedule: data.schedule || [], punches: data.punches || [], days: data.days || [],
      leave_uses: data.leave_uses, absences: absences, config: cfg, lockedAt: data.month && data.month.locked_at, now: nowMs });
  }

  /* ── 有給 ──
     受け口の有給の答え（設定・付与・手入力の使用・入職日・月分ごとの期間と予定）から、管理画面と同じ数え方でまとめる。
     月分ごとに computeMonth（予定と手入力の使用だけ）でシフトの有休の日を数え、usesFromMonth で手入力と合わせてから summary */
  function leaveOf(lv, C, L, today) {
    var sid = lv && lv.staff_id;
    if (!sid) return null;
    var sched = Array.isArray(lv.schedule) ? lv.schedule : [], manual = Array.isArray(lv.uses) ? lv.uses : [];
    var months = (Array.isArray(lv.months) ? lv.months : []).filter(function (m) { return m && isYm(m.ym) && isDate(m.from) && isDate(m.to); }).map(function (m) {
      var lo = addDays(m.from, -7), hi = addDays(m.to, 1);
      return C.computeMonth({ ym: m.ym, period: { from: m.from, to: m.to }, staff: [{ staff_id: sid, office: null, active: true }],
        schedule: sched.filter(function (r) { return r && r.work_date >= lo && r.work_date <= hi; }), punches: [], days: [],
        leave_uses: manual.filter(function (u) { return u && !u.voided_at && u.use_date >= m.from && u.use_date <= m.to; }),
        config: m.config || {}, now: Date.UTC(2000, 0, 1) });
    });
    var uses = L.usesFromMonth(months, manual).filter(function (u) { return u.staff_id === sid; });
    /* v6（統合 0125）: 有給の答えの absences（時間単位の有休の行）を、管理画面（kintai.js の loadLeave）と同じく hourlyUses で日数に直して残りから引く（v5 の積み残し (1)）。
       1日の時間は人ごと（有給の設定の週の所定時間÷日数・無い人は設定の dayHours）。absences の無い古い受け口の答えでは今までどおり引かない */
    if (Array.isArray(lv.absences) && L.hourlyUses) {
      var abs = lv.absences.filter(function (a) { return a && typeof a === 'object'; }).map(function (a) { var o = { staff_id: sid }, k; for (k in a) if (k !== 'staff_id') o[k] = a[k]; return o; });
      uses = uses.concat(L.hourlyUses(abs, dayMinOfLeave(lv, C, L)));
    }
    var grants = Array.isArray(lv.grants) ? lv.grants : [];
    return L.summary({ hireDate: lv.hire_date || null, profile: lv.profile || null, grants: grants, uses: uses, asOf: today });
  }
  /* 有給の答えのいちばん新しい月分の設定（無ければ {}）。時間単位の有休・特別休暇の種類・1日の時間はこれで決める（管理画面は今の設定で決める・受け口の月分の設定は今の設定） */
  function leaveCfgOf(lv) {
    var ms = (lv && Array.isArray(lv.months) ? lv.months : []).filter(function (m) { return m && isYm(m.ym) && m.config && typeof m.config === 'object'; });
    ms.sort(function (a, b) { return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0; });
    return ms.length ? ms[ms.length - 1].config : {};
  }
  /* 1日の所定の時間（分）。管理画面の staffDayMin と同じ（L.dayMinOf・設定の dayHours） */
  function dayMinOfLeave(lv, C, L) {
    var dh = 8;
    try { dh = C && C.fillConfig ? C.fillConfig(leaveCfgOf(lv)).dayHours : (+leaveCfgOf(lv).dayHours || 8); } catch (e) { dh = 8; }
    return L && L.dayMinOf ? L.dayMinOf(lv && lv.profile, dh) : dh * 60;
  }
  /* 時間単位の有休を使う施設か（有給の答えの月分のどれかの設定で hourlyPaidLeave が true）。受け口の有給の答えは休暇の行を返さないので、
     本人の画面の残りは時間単位で取った分を引けない。その施設でだけ、残りの近くに HOURLY_NOTE を出す（反証レビュー 2026-11-21・DB は変えない・文は仮置き） */
  function hourlyLeaveOn(lv) {
    return (lv && Array.isArray(lv.months) ? lv.months : []).some(function (m) { return !!(m && m.config && typeof m.config === 'object' && m.config.hourlyPaidLeave === true); });
  }
  var HOURLY_NOTE = '時間単位で取った分は、ここの残りに入っていません。正しい残りは事務所で確かめてください。';
  /* v6: 受け口が absences を返す（統合 0125 の後）なら残りに入っているので知らせを出さない。返さない古い受け口の間だけ出す */
  function hourlyNoteOn(lv) { return hourlyLeaveOn(lv) && !(lv && Array.isArray(lv.absences)); }
  /* 締めていない月分の実働は目安（本人の画面はシフトの休憩の設定を読めないため、管理画面とずれることがある）。締めた月分では出さない（文は仮置き） */
  var DRAFT_NOTE = '締める前の数字は目安です（締めた後に事務所の数字と同じになります）';
  function draftNote(head) { return head && !head.locked ? DRAFT_NOTE : ''; }
  /* 有給の表示の行: 残り・期限の近い残り・付与ごとの残りと期限・次の付与・年5日 */
  function leaveView(sm) {
    if (!sm) return null;
    var b = sm.balance || {}, ob = sm.obligation || {};
    var lots = (b.lots || []).filter(function (l) { return l.state === 'valid' && l.remain > 0; }).map(function (l) {
      return { granted: ymdJa(l.grant_date), days: l.days, remain: l.remain, expires: ymdJa(l.expires) };
    });
    var ob5 = ob.state === 'none' || !ob.state ? '' : ob.state === 'ok' ? '年5日の取得: 届いています（' + ob.used + '日）'
      : '年5日の取得: あと ' + ob.need + ' 日（' + ymdJa(ob.end) + ' まで）';
    return { remain: b.remain || 0, soon: b.soon ? { days: b.soon.days, expires: ymdJa(b.soon.expires) } : null, lots: lots,
      next: sm.next ? { date: ymdJa(sm.next.grant_date), days: sm.next.days } : null, ob5: ob5, ob5Warn: ob.state === 'red' || ob.state === 'yellow',
      hireUnknown: !sm.hire };
  }

  /* ── v6: 打刻漏れの知らせ（統合 0125・受け口の op notices）──
     知らせは決まった文だけ（自由な文を持たない・契約 ROOT-v6「2」）。種類は missing（打刻漏れ）・not_in（まだ出勤していない）の2つだけで、ほかは出さない。
     帯の文: 「{日付}の打刻が抜けています」「{日付}の出勤の打刻がまだありません」＋直し方（文は仮置き）。
     打刻漏れで、その日に出勤だけ／退勤だけがある時は、無い方を言う（「{日付}の退勤の打刻が抜けています」） */
  var NOTICE_KINDS = { missing: 1, not_in: 1 };
  var NOTICE_TAIL = '事務所に伝えるか、申請から打刻の直しを出してください。';
  function mdJa(date) { return isDate(date) ? (+date.slice(5, 7)) + '月' + (+date.slice(8, 10)) + '日' : ''; }
  /* その日の出勤・退勤の打刻（月の答えを computeOf で数えた結果の日の塊の punches・出勤は 'in'・退勤は 'out' の2つだけを見る）。
     返す: { known, hasIn, hasOut }（その日が結果に無い＝known:false） */
  function punchesOn(month, date) {
    var p = month && month.people && month.people[0], hasIn = false, hasOut = false, known = false;
    ((p && p.days) || []).forEach(function (d) {
      if (!d || d.date !== date) return;
      known = true;
      (d.blocks || []).forEach(function (b) { (b.punches || []).forEach(function (x) { if (x && x.kind === 'in') hasIn = true; else if (x && x.kind === 'out') hasOut = true; }); });
    });
    return { known: known, hasIn: hasIn, hasOut: hasOut };
  }
  /* 知らせの1件 → 帯の文（出さない時は ''）。n は受け口の行 {id, kind, work_date, created_at, seen_at}、pu は punchesOn の答え（読めない時は null）。
     直った時（打刻漏れ＝出勤と退勤がそろった・まだ出勤していない＝出勤がある）は出さない */
  function noticeText(n, pu) {
    if (!n || typeof n !== 'object' || !NOTICE_KINDS[n.kind] || !isDate(n.work_date)) return '';
    var d = mdJa(n.work_date), p = pu || { known: false, hasIn: false, hasOut: false };
    if (n.kind === 'not_in') return p.hasIn ? '' : d + 'の出勤の打刻がまだありません。' + NOTICE_TAIL;
    if (p.hasIn && p.hasOut) return '';
    var which = p.hasIn ? 'の退勤' : p.hasOut ? 'の出勤' : '';
    return d + which + 'の打刻が抜けています。' + NOTICE_TAIL;
  }
  /* 受け口の答えの行を、形の合う知らせだけ・日付の古い順・同じ日と種類は1つにする */
  function noticeRows(rows) {
    var seen = {};
    return (Array.isArray(rows) ? rows : []).filter(function (n) {
      if (!n || typeof n !== 'object' || !NOTICE_KINDS[n.kind] || !isDate(n.work_date)) return false;
      var k = n.kind + '|' + n.work_date; if (seen[k]) return false; seen[k] = 1; return true;
    }).sort(function (a, b) { return a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0; });
  }

  /* ── v6: 休暇の申請（統合 0125・kind 'leave'）──
     body = { type, half?, minutes?, type_code?, link_date? }（当てはまる鍵だけ）。type は下の6つ。
     時間単位（hourly）は設定 hourlyPaidLeave が true の時だけ・60分の倍数。特別休暇は設定 leaveTypes の種類（無い時は既定の3つ）。代休は休日に働いた日・振替は働く日が要る。
     細かい確かめ（同じ日の重ね・1日の時間・期間の先）は承認の時にデータベースの関数がする（契約 ROOT-v6「3」） */
  var LEAVE_TYPES = ['paid_day', 'paid_half', 'hourly', 'special', 'comp', 'swap'];
  var LEAVE_JA = { paid_day: '有休（1日）', paid_half: '有休（半日）', hourly: '有休（時間）', special: '特別休暇', comp: '代休', swap: '振替' };
  /* 選べる種類（時間単位は設定が true の時だけ）。返す: [[type, 名前]] */
  function leaveTypeOptions(hourlyOn) {
    return LEAVE_TYPES.filter(function (t) { return t !== 'hourly' || hourlyOn; }).map(function (t) { return [t, t === 'hourly' ? '有休（時間単位）' : LEAVE_JA[t]]; });
  }
  /* 特別休暇の種類の名前（types は [{code, name}]・無い時は印のまま） */
  function typeName(code, types) {
    var nm = String(code || '');
    (types || []).forEach(function (x) { if (x && x.code === code && x.name) nm = x.name; });
    return nm;
  }
  /* 休暇の申請の中身の文（本人の画面の一覧・管理画面の申請タブと同じ言い方）。
     有休（1日）／有休（半日）／有休（時間 n 時間）／特別休暇（種類名・半日）／代休（休日に働いた日 M/D）／振替（働く日 M/D） */
  function leaveText(b, types) {
    b = b && typeof b === 'object' ? b : {};
    var half = b.half === true ? '・半日' : '';
    if (b.type === 'paid_day') return '有休（1日）';
    if (b.type === 'paid_half') return '有休（半日）';
    if (b.type === 'hourly') return '有休（時間 ' + ((+b.minutes || 0) / 60) + ' 時間）';
    if (b.type === 'special') return '特別休暇（' + typeName(b.type_code, types) + half + '）';
    if (b.type === 'comp') return '代休（休日に働いた日 ' + (isDate(b.link_date) ? (+b.link_date.slice(5, 7)) + '/' + (+b.link_date.slice(8, 10)) : '') + half + '）';
    if (b.type === 'swap') return '振替（働く日 ' + (isDate(b.link_date) ? (+b.link_date.slice(5, 7)) + '/' + (+b.link_date.slice(8, 10)) : '') + '）';
    return '休暇';
  }

  /* ── 申請 ── */
  var KIND_JA = { punch: '打刻の直し', overtime: '残業・早出', month: '月の勤怠の確認', leave: '休暇' };
  var STATUS_JA = { pending: '承認待ち', approved: '承認済み', rejected: '差し戻し', withdrawn: '取り下げ' };
  function isoOf(date, time) { return date + 'T' + time + ':00+09:00'; }
  function timeOk(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  /* 入力 → 送る形。f: { kind, date, punchKind:'in'|'out', time, nextDay, earlyFrom, otUntil, otNextDay, ym, reason }
     返す: { ok:true, req:{kind, work_date, ym, body, reason} } か { ok:false, msg } */
  function buildRequest(f) {
    f = f || {};
    var reason = String(f.reason == null ? '' : f.reason).trim();
    if (f.kind === 'month') {
      if (!isYm(f.ym)) return { ok: false, msg: '月分を選んでください。' };
      return { ok: true, req: { kind: 'month', work_date: null, ym: f.ym, body: {}, reason: null } };
    }
    if (f.kind !== 'punch' && f.kind !== 'overtime' && f.kind !== 'leave') return { ok: false, msg: '申請の種類を選んでください。' };
    if (!isDate(f.date)) return { ok: false, msg: f.kind === 'leave' ? '休む日を選んでください。' : '日付を選んでください。' };
    if (!reason) return { ok: false, msg: '理由を書いてください。' };
    if (reason.length > 194) return { ok: false, msg: '理由は194字までにしてください。' };
    if (f.kind === 'leave') return leaveRequest(f, reason);
    if (f.kind === 'punch') {
      if (f.punchKind !== 'in' && f.punchKind !== 'out') return { ok: false, msg: '出勤か退勤かを選んでください。' };
      if (!timeOk(f.time)) return { ok: false, msg: '時刻を選んでください。' };
      return { ok: true, req: { kind: 'punch', work_date: f.date, ym: null, body: { kind: f.punchKind, at: isoOf(f.nextDay ? addDays(f.date, 1) : f.date, f.time) }, reason: reason } };
    }
    var body = {};
    if (f.earlyFrom) { if (!timeOk(f.earlyFrom)) return { ok: false, msg: '早出の時刻の形が違います。' }; body.early_from = isoOf(f.date, f.earlyFrom); }
    if (f.otUntil) { if (!timeOk(f.otUntil)) return { ok: false, msg: '残業の時刻の形が違います。' }; body.ot_until = isoOf(f.otNextDay ? addDays(f.date, 1) : f.date, f.otUntil); }
    if (!body.early_from && !body.ot_until) return { ok: false, msg: '早出の始まりか残業の終わりの時刻を入れてください。' };
    return { ok: true, req: { kind: 'overtime', work_date: f.date, ym: null, body: body, reason: reason } };
  }
  /* 休暇の申請の入力 → 送る形。f: { kind:'leave', date, leaveType, half, hours, typeCode, linkDate, hourlyOn, types:[{code}], maxDate } */
  function leaveRequest(f, reason) {
    var tp = f.leaveType, body = { type: tp };
    if (LEAVE_TYPES.indexOf(tp) < 0) return { ok: false, msg: '休暇の種類を選んでください。' };
    if (tp === 'hourly' && !f.hourlyOn) return { ok: false, msg: '時間単位の有休は、この事業所では使えません。' };
    if (isDate(f.maxDate) && f.date > f.maxDate) return { ok: false, msg: '休む日は ' + ymdJa(f.maxDate) + ' までで選んでください。' };
    if (tp === 'hourly') {
      var h = +f.hours;
      if (!(h >= 1 && h <= 23 && Math.floor(h) === h)) return { ok: false, msg: '時間を選んでください（1時間ずつ）。' };
      body.minutes = h * 60;
    }
    if (tp === 'special') {
      var types = Array.isArray(f.types) ? f.types : [];
      if (!f.typeCode || !types.some(function (x) { return x && x.code === f.typeCode; })) return { ok: false, msg: '特別休暇の種類を選んでください。' };
      body.type_code = String(f.typeCode);
    }
    if (tp === 'comp' || tp === 'swap') {
      if (!isDate(f.linkDate)) return { ok: false, msg: tp === 'comp' ? '休日に働いた日を選んでください。' : '入れ替えて働く日を選んでください。' };
      if (f.linkDate === f.date) return { ok: false, msg: tp === 'comp' ? '休日に働いた日は、休む日と別の日にしてください。' : '働く日は、休む日と別の日にしてください。' };
      body.link_date = f.linkDate;
    }
    if ((tp === 'special' || tp === 'comp') && f.half) body.half = true;
    return { ok: true, req: { kind: 'leave', work_date: f.date, ym: null, body: body, reason: reason } };
  }
  /* 申請の一覧の1行の文 */
  function requestRow(r, types) {
    var what = '';
    var b = (r && r.body) || {};
    var t = function (v) { var ms = Date.parse(v); return isNaN(ms) ? '' : hm(ms); };
    if (r.kind === 'punch') what = (b.kind === 'in' ? '出勤 ' : '退勤 ') + t(b.at);
    else if (r.kind === 'overtime') what = [b.early_from ? '早出 ' + t(b.early_from) + 'から' : '', b.ot_until ? '残業 ' + t(b.ot_until) + 'まで' : ''].filter(Boolean).join('・');
    else if (r.kind === 'month') what = '確かめました';
    else if (r.kind === 'leave') what = leaveText(b, types);
    return { id: r.id, rev: r.rev, kind: KIND_JA[r.kind] || '', when: r.kind === 'month' ? ymJa(r.ym) : (isDate(r.work_date) ? dayLabel(r.work_date) : ''),
      what: what, reason: r.reason || '', status: STATUS_JA[r.status] || '', statusKey: r.status, note: r.decide_note || '', canWithdraw: r.status === 'pending' };
  }
  /* 受け口・データベースの断りの語 → 職員に分かる文 */
  var ERR = {
    nokey: 'このスマホの登録が使えなくなっています（取り消し・長く使わなかった・退職のどれか）。管理者に新しい登録の番号を出してもらい、登録し直してください。',
    closed: 'しばらく操作が無かったため閉じました。暗証番号を入れ直してください。',
    wrong: '暗証番号が違います。',
    locked: '暗証番号を続けて間違えたため、しばらく開けません。時間をおいてから入れてください。',
    badpin: '暗証番号は4桁の数字で入れてください。',
    samecode: '打刻の番号と同じ数字は暗証番号に使えません。別の4桁にしてください。',
    invalid: 'この登録の番号は使えません（打ち間違い・使ったことのある番号・期限の10分を過ぎた番号・取り消した番号のどれかです）。番号を確かめるか、管理者にもう一度出してもらってください。',
    limited: '番号での登録が一時止まっています。15分ほど待ってから、管理者にもう一度番号を出してもらってください（QR を読めば登録できます）。',
    toomany: 'このスマホは登録できません（1人2台まで）。前のスマホの登録を管理者に取り消してもらってください。',
    exists: '同じ日の同じ申請が、もう承認待ちです。',
    reqlimit: '承認待ちの申請が多すぎます（20件まで）。承認を待ってから出してください。',
    reason: '理由を書いてください（194字まで）。',
    baddate: '日付が正しくありません。',
    badvalue: '入れた時刻が正しくありません（その日の前日0時〜翌々日0時の間で入れてください）。',
    badym: '月分が正しくありません。',
    badkind: '申請の種類が正しくありません。ページを読み込み直してください。',
    badperiod: 'この月分の期間を決められませんでした。事務所に伝えてください。',
    lockedday: 'この日は締めてあるため申請できません。直す時は事務所に伝えてください。',
    /* 統合 0114 を 0117 に合わせた（2026-11-21）: 締めた月分の前の7日・締めた月分の末日の翌日に当たる日は lead（lead_ym つき）で断る・文は仮置き */
    lead: 'この日は締めた月分に近いため申請できません。事務所に知らせてください。',
    conflict: 'この申請はもう承認・差し戻し・取り下げされています。一覧を読み直しました。',
    notfound: 'この申請は見つかりませんでした。一覧を読み直しました。',
    format: '画面の送り方が正しくありません。ページを読み込み直してください。',
    server: 'サーバーで止まりました。少し待ってからもう一度試してください。',
    net: '通信できませんでした。電波・Wi-Fi を確かめてからもう一度試してください。',
    origin: 'この住所からは使えません。決められた住所で開いてください。',
    /* 統合 0114 の直し（a4674ba）: 退職・休止（勤怠の名簿の active が false）の間は断るだけで、鍵は消さない（在籍に戻れば同じ鍵で開ける）・文は仮置き */
    inactive: '今は勤怠の名簿でお休み中になっているため、開けません。事務所に知らせてください。',
    /* 受け口（kintai-self）だけが返す語 */
    'too-large': '送る中身が大きすぎます。理由を短くしてからもう一度試してください。',
    method: '画面の送り方が正しくありません。ページを読み込み直してください。'
  };
  /* 断りの語と、どの操作の時か（申請の時の locked・toomany は別の文） */
  /* v6: 休暇の申請の時の断り（時刻の文の badvalue・同じ日の exists は休暇の言い方にする・文は仮置き） */
  var ERR_LEAVE = {
    badvalue: '休暇の中身が正しくありません（時間は1時間ずつ・特別休暇の種類・結ぶ日を確かめてください）。',
    exists: '同じ日の同じ休暇の申請が、もう承認待ちです。',
    baddate: '休む日が正しくないか、先すぎます（次の月分の終わりまで）。',
    badkind: '休暇の申請は、まだ受け付けられません（事務所の仕組みの更新待ち）。事務所に伝えてください。'
  };
  function errorText(code, where) {
    if (where === 'leave' && ERR_LEAVE[code]) return ERR_LEAVE[code];
    if (where === 'leave') where = 'request';
    if (where === 'request' && code === 'locked') return ERR.lockedday;
    if (where === 'request' && code === 'toomany') return ERR.reqlimit;
    return ERR[code] || ERR.server;
  }

  var api = {
    IDLE_MS: IDLE_MS, hourlyLeaveOn: hourlyLeaveOn, HOURLY_NOTE: HOURLY_NOTE, DRAFT_NOTE: DRAFT_NOTE, draftNote: draftNote, KIND_JA: KIND_JA, STATUS_JA: STATUS_JA, ERR: ERR,
    isDate: isDate, isYm: isYm, todayOf: todayOf, ymOf: ymOf, nextYm: nextYm, prevYm: prevYm, addDays: addDays, hm: hm, minText: minText,
    dayLabel: dayLabel, ymdJa: ymdJa, ymJa: ymJa, shortOf: shortOf, codeFromHash: codeFromHash, pinProblem: pinProblem,
    currentYm: currentYm, dayRows: dayRows, monthTotals: monthTotals, monthHead: monthHead, computeOf: computeOf,
    absLabel: absLabel, leaveOf: leaveOf, leaveView: leaveView, buildRequest: buildRequest, requestRow: requestRow, errorText: errorText,
    hourlyNoteOn: hourlyNoteOn, leaveCfgOf: leaveCfgOf, dayMinOfLeave: dayMinOfLeave,
    NOTICE_TAIL: NOTICE_TAIL, punchesOn: punchesOn, noticeText: noticeText, noticeRows: noticeRows,
    LEAVE_TYPES: LEAVE_TYPES, LEAVE_JA: LEAVE_JA, ERR_LEAVE: ERR_LEAVE, leaveTypeOptions: leaveTypeOptions, leaveText: leaveText, leaveRequest: leaveRequest
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.KintaiSelfCalc = api;
})(typeof window !== 'undefined' ? window : this);
