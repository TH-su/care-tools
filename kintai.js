/* kintai.js — 勤怠管理の事務所画面（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1）
 * ════════════════════════════════════════════════════════════════
 * ・正本は共通のデータベース（kintai_* の表）。読み書きは関数（rpc）だけ。誰が何をできるかはデータベースが決める
 * ・事務所PCだけ。現場の端末（su_device_role=field）は何も取りに行かずに案内だけ出す（CLAUDE.md §2-5）
 * ・開く前に SUAppGate.run('kintai') でログインの役割を確かめる（§2-7）
 * ・開いた月はシフト（勤務表）を自動で取り込む（締めた月は取り込まない）
 * ・生の打刻は変えない。直しは「事務所の打刻を足す」「打刻を取り消す（理由つき）」「早出・残業を認める」「休憩を直す」で、
 *   全部データベースの直しの履歴（kintai_edits）に残る
 * ・端末に残すのは UI の状態（開いていたタブ・月）だけ（原則11）。氏名・打刻は端末に残さない
 * ・遅れて届いた応答は世代（gen）で捨てる
 */
(function () {
  'use strict';
  var C = window.KintaiCalc;
  var TABS = ['day', 'grid', 'person', 'staff', 'close', 'settings'];
  var LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym';
  var gen = 0, view = 'boot', tab = 'day', ym = null, data = null, month = null, shiftInfo = null;
  var selDate = null, selStaff = null, onlyReview = false, role = null, busy = false, editsCache = null;
  var $ = function (id) { return document.getElementById(id); };

  function note(where, e) { try { if (window.SUErrors && window.SUErrors.note) window.SUErrors.note('勤怠管理', e, 'kintai:' + where); } catch (_) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sync(t) { $('g-sync').textContent = t || ''; }
  function isField() { try { return localStorage.getItem('su_device_role') === 'field'; } catch (_) { return false; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function todayYm() { return C.jstDate(Date.now()).slice(0, 7); }
  function hm(v) { return v == null ? '' : C.jstHM(typeof v === 'number' ? v : Date.parse(v)); }
  function fm(m) { return C.fmtMin(m || 0, 'hmm'); }
  function officeName(code) {
    var d = C.OFFICE_DIV[code];
    if (!d) return '';
    try { return window.SUFacility ? (window.SUFacility.officeName(d) || d) : d; } catch (_) { return d; }
  }
  function isLocked() { return !!(data && data.month && data.month.locked_at); }
  function isAdmin() { return role === 'admin'; }

  /* ── データベースの窓口 ── */
  function rpc(name, args) {
    return Promise.resolve().then(function () { return window.SUAuth.client().rpc(name, args || {}); }).then(function (r) {
      if (r && r.error) throw r.error;
      return r ? r.data : null;
    });
  }
  function noDb(e) { var c = e && e.code; return c === '42P01' || c === 'PGRST205' || c === 'PGRST202'; }
  var NG = { locked: 'この月は締めてあるため直せません。直す時は管理者が締めを解除してください。', conflict: '別の人が先に直しました。読み直してから、もう一度直してください。',
    reason: '理由を書いてください。', notfound: '見つかりませんでした。読み直してください。', already: 'もう取り消してあります。', badrow: 'シフトの行の形が違いました。',
    toobig: '設定が大きすぎます。', stale: '時刻が古すぎます。', notlocked: 'この月はもう締めが解除されています。読み直してください。',
    badym: '月の形が違います。', badshape: '送った値の形が違いました。読み直してください。', badkind: '出勤か退勤を選んでください。',
    badtime: '時刻の形が違います。', baddate: '日付の形が違います。', badkey: '直せない項目が入っていました。', badvalue: '入れた値を受け付けられませんでした（休憩は 0〜600 分・メモは 400 字まで）。',
    clientid: '同じ打刻がもう記録されています。' };
  function friendly(e) {
    var code = e && e.code, m = String((e && e.message) || e || '');
    if (code === '42501' || /permission denied/i.test(m)) return 'この操作をする権限がありません（事務所・管理者のアカウントが要ります。締めの解除と設定の保存は管理者だけです）。';
    if (noDb(e)) return '共通のデータベースに勤怠の仕組みがまだありません（データベースの更新が必要です）。管理者に知らせてください。';
    if (/failed to fetch|network|load failed|timeout/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return 'うまくいきませんでした。少し待ってから、もう一度試してください。';
  }
  function okOr(r) { if (r && r.ok === true) return r; var err = new Error((r && r.error) || 'ng'); err.kintai = (r && r.error) || 'ng'; throw err; }
  function msgOf(e) { return e && e.kintai ? (NG[e.kintai] || 'うまくいきませんでした（' + e.kintai + '）。') : friendly(e); }

  /* ── シフトの取り込み ── */
  function pullShift(keys) {
    if (!window.SUKv || !window.SUKv.callShift) return Promise.resolve({ ok: false, error: 'nokv' });
    return window.SUKv.callShift({ action: 'pull', keys: keys }, function () { return Promise.resolve({ ok: false, error: 'google' }); });
  }
  function importShift(my) {
    var ym0 = ym, nx = C.nextYm(ym0);
    var keys = ['staff', 'symbols', 'settings', 'sched:' + ym + ':plan', 'sched:' + nx + ':plan'];
    return pullShift(keys).then(function (r) {
      if (my !== gen) return null;
      if (!r || r.ok !== true || !r.entries) {
        shiftInfo = { ok: false, why: r && r.error === 'google' ? 'シフトが新しい保存先に移っていないため、自動で取り込めません。' : (r && r.error === 'login' ? 'ログインが切れたためシフトを読めませんでした。' : 'シフトを読めませんでした。') };
        return null;
      }
      var E = r.entries, ent = function (k) { return E[k] && E[k].data; };
      var plan = ent('sched:' + ym0 + ':plan');
      if (!plan) { shiftInfo = { ok: false, why: 'この月のシフトがまだありません。' }; return null; }
      var built = C.buildSchedule({ ym: ym0, plan: plan, nextPlan: ent('sched:' + nx + ':plan') || {}, staff: ent('staff') || [], symbols: ent('symbols') || [], settings: ent('settings') || {} });
      var ss = ent('settings') || {};
      shiftInfo = { ok: true, confirmed: !!(plan.meta && plan.meta.confirmedAt), warnings: built.warnings, rows: built.rows.length,
        breaks: { breakThresholdH: ss.breakThresholdH, breakH: ss.breakH, nightBreakH: ss.nightBreakH } };
      return rpc('kintai_staff_sync', { p_rows: built.staff }).then(okOr).then(function () {
        if (my !== gen) return null;   /* 待つ間に月を替えた時は、前の月の予定を送らない（指摘5） */
        return rpc('kintai_schedule_put', { p_ym: ym0, p_rows: built.rows }).then(okOr);
      });
    });
  }

  /* ── 読み込みと計算 ── */
  function load(withImport) {
    var my = ++gen;
    busy = true; sync('読み込んでいます…');
    paint();
    return rpc('kintai_month_get', { p_ym: ym }).then(okOr).then(function (d) {
      if (my !== gen) return;
      data = d;
      if (withImport && !isLocked()) {
        sync('シフトを取り込んでいます…');
        return importShift(my)['catch'](function (e) {
          if (my !== gen) return;
          note('シフトの取り込み', e);
          shiftInfo = { ok: false, why: 'シフトを取り込めませんでした: ' + msgOf(e) };
        }).then(function (done) {
          if (my !== gen || !done) return;
          return rpc('kintai_month_get', { p_ym: ym }).then(okOr).then(function (d2) { if (my === gen) data = d2; });
        });
      }
    }).then(function () {
      if (my !== gen) return;
      recompute();
      busy = false; sync(isLocked() ? '締め済みの月です' : '読み込みました（' + hm(Date.now()) + '）');
      editsCache = null;
      paint();
    })['catch'](function (e) {
      if (my !== gen) return;
      note('読み込み', e);
      busy = false; data = null; month = null; sync('');
      $('g-main').innerHTML = '<div class="band ng" role="alert">' + esc(msgOf(e)) + '</div>';
    });
  }
  function recompute() {
    if (!data) { month = null; return; }
    var cfg = {}, k, sc = (data.settings && data.settings.config) || {};
    var br = (shiftInfo && shiftInfo.breaks) || {};
    var snap = isLocked() && data.month.snapshot && data.month.snapshot.config;
    if (snap) {
      /* 締めた月は締めた時の設定（休憩の決まりを含む）で数える＝開き直しても・設定を変えても数字が変わらない（指摘2） */
      for (k in snap) cfg[k] = snap[k];
    } else {
      for (k in sc) cfg[k] = sc[k];
      /* 休憩の決まりはシフトアプリの設定を優先する（勤怠の設定に保存しない・指摘3） */
      for (k in br) if (typeof br[k] === 'number') cfg[k] = br[k];
    }
    month = C.computeMonth({ ym: ym, staff: data.staff || [], schedule: data.schedule || [], punches: data.punches || [], days: data.days || [], config: cfg, lockedAt: data.month && data.month.locked_at });
  }

  /* ── 描画 ── */
  function paintTabs() {
    var bs = document.querySelectorAll('.tabs button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-selected', bs[i].getAttribute('data-tab') === tab ? 'true' : 'false');
  }
  function bands() {
    var h = '';
    if (isLocked()) h += '<div class="band ok" role="status">この月は締めてあります（' + esc(new Date(data.month.locked_at).toLocaleString('ja-JP')) + '）。直す時は管理者が「締めと出力」で解除します。</div>';
    if (shiftInfo && !shiftInfo.ok) h += '<div class="band warn" role="status">' + esc(shiftInfo.why) + '</div>';
    if (shiftInfo && shiftInfo.ok && !shiftInfo.confirmed) h += '<div class="band warn" role="status">この月のシフトはまだ「確定」していません。シフトが変わると予定も変わります（開くたびに取り込み直します）。</div>';
    if (shiftInfo && shiftInfo.ok && shiftInfo.warnings.length) h += '<div class="band warn" role="status">シフトの記号で気になる所が ' + shiftInfo.warnings.length + ' 件あります（「職員と番号」の下に一覧）。</div>';
    return h;
  }
  function paint() {
    paintTabs();
    var m = $('g-main');
    if (busy && !month) { m.innerHTML = '<p class="empty">読み込んでいます…</p>'; return; }
    if (!month) return;
    var f = { day: paintDay, grid: paintGrid, person: paintPerson, staff: paintStaff, close: paintClose, settings: paintSettings }[tab];
    m.innerHTML = bands() + f();
  }
  function flagTags(flags) {
    return flags.filter(function (f) { return f !== 'late' && f !== 'early_leave' || true; }).map(function (f) {
      var cls = C.REVIEW[f] ? (f === 'no_punch' || f === 'missing_in' || f === 'missing_out' ? 'tag ng' : 'tag rv') : 'tag';
      return '<span class="' + cls + '">' + esc(C.FLAG_LABEL[f] || f) + '</span>';
    }).join('');
  }
  function rawPunches(b) {
    return b.punches.map(function (p) { return (p.kind === 'in' ? '出' : '退') + ' ' + hm(p.at) + (p.source === 'offline' ? '（控え）' : p.source === 'office' ? '（事務所）' : ''); }).join(' / ');
  }
  function schedText(b) { return b.sched ? esc(b.symbol) + ' ' + hm(b.schedStart) + '〜' + hm(b.schedEnd) : '<span class="raw">予定なし</span>'; }
  function countText(b) { return b.countStart != null ? hm(b.countStart) + '〜' + hm(b.countEnd) : ''; }
  function dateList() { var n = C.daysIn(ym), out = []; for (var d = 1; d <= n; d++) out.push(ym + '-' + (d < 10 ? '0' + d : d)); return out; }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function wd(date) { return WD[new Date(Date.parse(date + 'T12:00:00+09:00')).getUTCDay()]; }

  function paintDay() {
    var ds = dateList();
    if (!selDate || ds.indexOf(selDate) < 0) selDate = ds.indexOf(C.jstDate(Date.now())) >= 0 ? C.jstDate(Date.now()) : ds[0];
    var rows = [];
    month.people.forEach(function (p) {
      var d = p.days.filter(function (x) { return x.date === selDate; })[0];
      if (!d) return;
      if (!d.blocks.length && d.paidMin) rows.push('<tr><td>' + esc(p.staff.name) + '</td><td>' + esc(officeName(p.staff.office)) + '</td><td>有休</td><td></td><td></td><td class="num"></td><td class="num">' + fm(0) + '</td><td></td><td></td></tr>');
      d.blocks.forEach(function (b) {
        rows.push('<tr><td>' + esc(p.staff.name) + '</td><td>' + esc(officeName(b.office)) + '</td><td>' + schedText(b) + '</td><td class="raw">' + esc(rawPunches(b)) + '</td><td>' + countText(b) + '</td><td class="num">' + b.breakMin + '</td><td class="num">' + fm(b.workMin) + '</td><td>' + flagTags(b.flags) + '</td>' +
          '<td class="no-print"><button type="button" class="btn sm" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + esc(selDate) + '">直す</button></td></tr>');
      });
    });
    return '<div class="cd"><div class="row no-print"><label>日付 <select id="g-date">' + ds.map(function (x) { return '<option value="' + x + '"' + (x === selDate ? ' selected' : '') + '>' + x.slice(5).replace('-', '/') + '（' + wd(x) + '）</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="btn sm" data-act="print">この日を印刷</button></div>' +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>事業所</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th>印</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">この日の予定・打刻はありません</td></tr>') + '</tbody></table></div>' +
      '<p class="help">「数えた時刻」は予定に合わせて丸めた時刻です（予定より早い出勤は予定の開始、予定より遅い退勤は予定の終わり）。打刻はそのまま残っています。早出・残業を認める時は「直す」から。</p></div>';
  }

  function paintGrid() {
    var ds = dateList();
    var head = '<tr><th class="nm">氏名</th>' + ds.map(function (x) { return '<th class="num">' + (+x.slice(8)) + '<br><span class="raw">' + wd(x) + '</span></th>'; }).join('') +
      '<th class="num">出勤</th><th class="num">総労働</th><th class="num">残業</th><th class="num">法定外</th><th class="num">深夜</th><th class="num">有休</th><th class="num">要確認</th></tr>';
    var body = month.people.filter(function (p) { return !onlyReview || p.sum.reviewCount > 0; }).map(function (p) {
      var by = {}; p.days.forEach(function (d) { by[d.date] = d; });
      return '<tr><td class="nm"><button type="button" class="btn sm" data-act="person" data-sid="' + esc(p.staff.staff_id) + '">' + esc(p.staff.name) + '</button></td>' + ds.map(function (x) {
        var d = by[x];
        if (!d) return '<td></td>';
        var rv = d.flags.some(function (f) { return C.REVIEW[f]; }), np = d.flags.indexOf('no_punch') >= 0 || d.flags.indexOf('missing_out') >= 0 || d.flags.indexOf('missing_in') >= 0;
        var txt = d.workMin ? fm(d.workMin) : (d.paidMin ? '有' : (np ? '✕' : ''));
        return '<td class="' + (np ? 'np' : rv ? 'rv' : '') + '"><button type="button" class="btn sm" style="min-height:32px;padding:0 4px;border:0;background:none" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + x + '" aria-label="' + esc(p.staff.name + ' ' + x + ' を直す') + '">' + txt + '</button></td>';
      }).join('') + '<td class="num">' + p.sum.workDays + '</td><td class="num">' + fm(p.sum.workMin) + '</td><td class="num">' + fm(p.sum.overtimeMin) + '</td><td class="num">' + fm(p.sum.legalOverMin) + '</td><td class="num">' + fm(p.sum.nightMin) + '</td><td class="num">' + p.sum.paidDays + '</td><td class="num">' + p.sum.reviewCount + '</td></tr>';
    }).join('');
    return '<div class="cd"><div class="row no-print"><label><input type="checkbox" id="g-only"' + (onlyReview ? ' checked' : '') + '> 要確認がある人だけ</label><button type="button" class="btn sm" data-act="print">印刷</button>' +
      '<span class="help">黄色＝要確認・赤＝打刻の漏れ／打刻なし。数字を押すとその日を直せます。</span></div><div class="tw"><table class="grid"><thead>' + head + '</thead><tbody>' + (body || '<tr><td class="empty" colspan="40">該当する職員はいません</td></tr>') + '</tbody></table></div></div>';
  }

  function personOf(sid) { return month.people.filter(function (p) { return p.staff.staff_id === sid; })[0] || null; }
  function paintPerson() {
    if (!selStaff || !personOf(selStaff)) selStaff = month.people.length ? month.people[0].staff.staff_id : null;
    var sel = '<label>職員 <select id="g-staff">' + month.people.map(function (p) { return '<option value="' + esc(p.staff.staff_id) + '"' + (p.staff.staff_id === selStaff ? ' selected' : '') + '>' + esc(p.staff.name) + '</option>'; }).join('') + '</select></label>';
    var p = personOf(selStaff);
    if (!p) return '<div class="cd"><p class="empty">職員がいません。「職員と番号」でシフトから取り込んでください。</p></div>';
    var s = p.sum, rows = [];
    p.days.forEach(function (d) {
      var nt = d.note ? [d.note.early_ok ? '早出を認めた' : '', d.note.overtime_ok ? '残業を認めた' : '', d.note.break_min != null ? '休憩を' + d.note.break_min + '分に' : '', d.note.note || ''].filter(Boolean).join('・') : '';
      var bl = d.blocks.length ? d.blocks : [null];
      bl.forEach(function (b, i) {
        rows.push('<tr><td>' + (i === 0 ? esc(d.date.slice(5).replace('-', '/')) + '（' + wd(d.date) + '）' : '') + '</td><td>' + (b ? schedText(b) : (d.paidMin ? '有休' : '')) + '</td><td class="raw">' + (b ? esc(rawPunches(b)) : '') + '</td><td>' + (b ? countText(b) : '') + '</td><td class="num">' + (b ? b.breakMin : '') + '</td><td class="num">' + (b ? fm(b.workMin) : '') + '</td><td class="num">' + (b ? fm(b.nightMin) : '') + '</td><td>' + (b ? flagTags(b.flags) : '') + (i === 0 && nt ? '<span class="tag">' + esc(nt) + '</span>' : '') + '</td>' +
          '<td class="no-print">' + (i === 0 ? '<button type="button" class="btn sm" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + d.date + '">直す</button>' : '') + '</td></tr>');
      });
    });
    return '<div class="cd"><div class="row no-print">' + sel + '<button type="button" class="btn sm" data-act="addday">予定の無い日に打刻を足す</button><button type="button" class="btn sm" data-act="print">印刷</button></div>' +
      (s.warnings.length ? '<div class="band warn">' + s.warnings.map(esc).join('<br>') + '</div>' : '') +
      '<div class="kv"><span>出勤日数</span><b>' + s.workDays + ' 日（有休 ' + s.paidDays + ' 日）</b><span>総労働</span><b>' + fm(s.workMin) + '（所定内 ' + fm(s.schedInMin) + '・残業 ' + fm(s.overtimeMin) + '・法定外 ' + fm(s.legalOverMin) + '・深夜 ' + fm(s.nightMin) + '）</b>' +
      '<span>遅刻・早退</span><b>遅刻 ' + s.lateCount + ' 回 ' + fm(s.lateMin) + '・早退 ' + s.earlyLeaveCount + ' 回 ' + fm(s.earlyLeaveMin) + '</b><span>打刻なし・要確認</span><b>' + s.noPunchDays + ' 日・' + s.reviewCount + ' 件</b></div></div>' +
      '<div class="cd"><div class="tw"><table><thead><tr><th>日</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th class="num">深夜</th><th>印・直し</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">この月の予定・打刻はありません</td></tr>') + '</tbody></table></div></div>';
  }

  function paintStaff() {
    var list = (data.staff || []).slice().sort(function (a, b) { return (a.office || '') < (b.office || '') ? -1 : (a.office || '') > (b.office || '') ? 1 : (a.code < b.code ? -1 : 1); });
    var rows = list.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td>' + esc(officeName(s.office)) + '</td><td class="num"><b>' + esc(s.code) + '</b></td><td>' + esc(s.emp_code || '') + (s.emp_code ? '' : '<span class="tag rv">従業員コードなし</span>') + '</td><td>' + (s.active === false ? '休止' : '') + '</td>' +
        '<td class="no-print"><button type="button" class="btn sm" data-act="recode" data-sid="' + esc(s.staff_id) + '"' + (isLocked() ? '' : '') + '>番号を振り直す</button></td></tr>';
    }).join('');
    var w = shiftInfo && shiftInfo.ok && shiftInfo.warnings.length ? '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">シフトの記号で気になる所</h2><div class="tw"><table><thead><tr><th>職員</th><th>日</th><th>内容</th></tr></thead><tbody>' +
      shiftInfo.warnings.map(function (x) { var s = (data.staff || []).filter(function (y) { return y.staff_id === x.staff_id; })[0]; return '<tr><td>' + esc(s ? s.name : x.staff_id) + '</td><td>' + esc(x.date) + '</td><td>' + esc(x.msg) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
    var printable = (data.staff || []).filter(function (s) { return s.active !== false; }).slice().sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    return '<div class="print-only"><h2>打刻の番号（本人にだけ伝えてください）</h2><table><thead><tr><th>番号</th><th>氏名</th></tr></thead><tbody>' +
      printable.map(function (s) { return '<tr><td>' + esc(s.code) + '</td><td>' + esc(s.name) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="cd no-print"><div class="row"><button type="button" class="btn sm" data-act="import">シフトから職員と予定を取り込む</button><button type="button" class="btn sm" data-act="print">番号の表を印刷（番号と名前だけ）</button></div>' +
      '<p class="help">打刻の番号は職員ごとに自動で振ります。タブレットではこの番号を入れて打刻します。番号は本人にだけ伝えてください。従業員コードはシフトアプリの職員の設定（freee の従業員コード）から取り込み、給与への出力に使います。</p>' +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>主事業所</th><th class="num">打刻の番号</th><th>従業員コード</th><th></th><th class="no-print"></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">まだ職員がいません。シフトから取り込んでください。</td></tr>') + '</tbody></table></div></div>' + (w ? '<div class="no-print">' + w + '</div>' : '');
  }

  function paintClose() {
    var lk = isLocked(), afterLock = month.people.some(function (p) { return p.days.some(function (d) { return d.flags.indexOf('after_lock') >= 0; }); });
    var review = month.people.reduce(function (a, p) { return a + p.sum.reviewCount; }, 0);
    var diff = [];
    if (lk && data.month.snapshot && data.month.snapshot.rows) {
      var byId = {}; data.month.snapshot.rows.forEach(function (r) { byId[r.staff_id] = r; });
      month.people.forEach(function (p) { var r = byId[p.staff.staff_id]; if (r && (r.workMin !== p.sum.workMin || r.overtimeMin !== p.sum.overtimeMin || r.nightMin !== p.sum.nightMin)) diff.push(p.staff.name); });
    }
    var h = '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">月の締め</h2>' +
      (diff.length ? '<div class="band warn">締めた時の集計と、今の数字が違う職員がいます（' + diff.map(esc).join('・') + '）。締めた後の打刻が原因です。給与へ渡した数字は締めた時のものです。</div>' : '') +
      (lk ? '<p>締めた日時: ' + esc(new Date(data.month.locked_at).toLocaleString('ja-JP')) + '</p>' + (afterLock ? '<div class="band warn">締めた後に足された打刻があります（印「締めた後の打刻」）。給与へ渡した後なら、来月の調整を検討してください。</div>' : '') +
        '<button type="button" class="btn ng" data-act="unlock"' + (isAdmin() ? '' : ' disabled') + '>締めを解除する（管理者）</button>' :
        (review ? '<div class="band warn">要確認が ' + review + ' 件残っています。締める前に確かめてください（締めることはできます）。</div>' : '<div class="band ok">要確認はありません。</div>') +
        '<button type="button" class="btn pri" data-act="lock">この月を締める</button><p class="help">締めると、この月の打刻の追加・取り消し・承認・シフトの取り込みが止まり、集計がデータベースに凍結されます。</p>') + '</div>';
    var hist = (data.month && Array.isArray(data.month.history)) ? data.month.history : [];
    if (hist.length) h += '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">締めと解除の記録</h2><div class="tw"><table><thead><tr><th>日時</th><th>した人</th><th>内容</th><th>理由</th></tr></thead><tbody>' +
      hist.slice().reverse().map(function (x) { return '<tr><td>' + esc(x && x.at ? new Date(x.at).toLocaleString('ja-JP') : '') + '</td><td>' + esc(x && x.by) + '</td><td>' + esc(x && x.action === 'unlock' ? '締めを解除した' : x && x.action === 'lock' ? '締めた' : (x && x.action) || '') + '</td><td>' + esc(x && x.reason) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    h += '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">給与計算への出力（CSV）</h2>' +
      '<div class="row"><label>文字コード <select id="g-enc"><option value="utf8">UTF-8（BOM 付き）</option><option value="sjis">Shift_JIS（Excel・古い給与ソフト）</option></select></label></div>' +
      '<div class="row"><button type="button" class="btn" data-act="csv-sum">月の集計（1人1行）</button><button type="button" class="btn" data-act="csv-day">日ごとの明細（1人1日1行）</button></div>' +
      '<p class="help">列: ' + esc(C.SUMMARY_HEAD.join('・')) + '。従業員コードの無い職員は出しません（出せなかった人は知らせます）。時間の書き方は「設定」で 8:30／8.50 を選べます。' + (lk ? '' : '締める前の出力は下書きとして扱ってください。') + '</p></div>';
    h += '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">直しの履歴</h2><div id="g-edits">' + (editsCache ? editsHtml(editsCache) : '<button type="button" class="btn sm" data-act="edits">この月の直しの履歴を見る</button>') + '</div></div>';
    return h;
  }
  var ACT_LABEL = { punch_add: '打刻を足した', punch_void: '打刻を取り消した', day_put: '承認・休憩・メモ', code_reset: '番号を振り直した', month_lock: '月を締めた', month_unlock: '締めを解除した', settings_put: '設定を変えた', schedule_put: 'シフトを取り込んだ' };
  function editsHtml(list) {
    if (!list.length) return '<p class="empty">この月の直しはありません。</p>';
    var nm = {}; (data.staff || []).forEach(function (s) { nm[s.staff_id] = s.name; });
    return '<div class="tw"><table><thead><tr><th>日時</th><th>した人</th><th>職員</th><th>日</th><th>内容</th><th>理由</th></tr></thead><tbody>' + list.map(function (e) {
      return '<tr><td>' + esc(new Date(e.at).toLocaleString('ja-JP')) + '</td><td>' + esc(e.by) + '</td><td>' + esc(nm[e.staff_id] || e.staff_id || '') + '</td><td>' + esc(e.work_date || '') + '</td><td>' + esc(ACT_LABEL[e.action] || e.action) + '</td><td>' + esc(e.reason) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  var SET_FIELDS = [
    ['earlyAlertMin', '予定より早い出勤をこの分以上で要確認にする', '分'], ['overtimeAlertMin', '予定より遅い退勤をこの分以上で要確認にする', '分'],
    ['overtimeMonthWarnH', '月の法定外がこの時間以上で警告（36協定）', '時間'], ['weekStartDow', '週40時間を数える週の始まり（0＝日曜〜6＝土曜・変形を使わない時）', '']
  ];
  function paintSettings() {
    var c = month.config;
    var h = '<div class="cd"><p class="help">設定は事業者（法人）ごとに1つです。保存できるのは管理者（2段階認証まで済んだ人）だけです。' + (isAdmin() ? '' : '<b>いまのアカウントでは見るだけです。</b>') + '</p><form id="g-set" class="kv">';
    SET_FIELDS.forEach(function (f) { h += '<label for="s-' + f[0] + '">' + esc(f[1]) + '</label><span><input type="number" step="any" id="s-' + f[0] + '" value="' + esc(c[f[0]]) + '" style="width:7em"> ' + f[2] + '</span>'; });
    h += '<label for="s-variableMonth">1か月単位の変形労働時間制</label><span><input type="checkbox" id="s-variableMonth"' + (c.variableMonth ? ' checked' : '') + '> 使う（法定外＝その日の予定の実働と8時間の長い方を超えた分）</span>';
    h += '<label for="s-monthRound30">月の残業・深夜の合計の端数</label><span><input type="checkbox" id="s-monthRound30"' + (c.monthRound30 ? ' checked' : '') + '> 1時間未満を30分で四捨五入する（就業規則に定めがある時だけ）</span>';
    h += '<label for="s-csvTime">CSV の時間の書き方</label><span><select id="s-csvTime"><option value="hmm"' + (c.csvTime === 'hmm' ? ' selected' : '') + '>8:30</option><option value="dec"' + (c.csvTime === 'dec' ? ' selected' : '') + '>8.50</option></select></span>';
    h += '</form><div class="row"><button type="button" class="btn pri" data-act="save-set"' + (isAdmin() ? '' : ' disabled') + '>設定を保存する</button></div>' +
      '<p class="help">休憩の時間（日勤 ' + esc(c.breakH) + ' 時間・夜勤 ' + esc(c.nightBreakH) + ' 時間・拘束が ' + esc(c.breakThresholdH) + ' 時間を超えたら引く）はシフトアプリの設定を取り込んで使います（ここでは変えません）。丸めの決まり: 予定より早い出勤は予定の開始から、予定より遅い退勤は予定の終わりまで数えます。始業前・終業後に実際に働いた時は、その日を「直す」で早出・残業を認めてください（認めないまま切り捨てると賃金の未払いになります）。</p></div>';
    return h;
  }

  /* ── 直す（1人・1日） ── */
  var dlgCtx = null;
  function openEdit(sid, date) {
    if (!month) return;
    var p = personOf(sid);
    var st = (data.staff || []).filter(function (s) { return s.staff_id === sid; })[0] || (p && p.staff) || { staff_id: sid, name: sid };
    var lo = C.jstMs(C.addDays(date, -1), 0), hi = C.jstMs(C.addDays(date, 2), 0);
    var ps = (data.punches || []).filter(function (x) { return x.staff_id === sid && Date.parse(x.at) >= lo && Date.parse(x.at) < hi; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); });
    var dn = (data.days || []).filter(function (x) { return x.staff_id === sid && x.work_date === date; })[0] || null;
    var d = p ? p.days.filter(function (x) { return x.date === date; })[0] : null;
    dlgCtx = { sid: sid, date: date, rev: dn ? dn.rev : 0, dn: dn };
    var lk = isLocked();
    $('g-dlg-h').textContent = st.name + ' さん　' + date.slice(5).replace('-', '/') + '（' + wd(date) + '）';
    var b = '';
    if (lk) b += '<div class="band ok">この月は締めてあるため直せません。</div>';
    if (d && d.blocks.length) b += '<p>' + d.blocks.map(function (x) { return schedText(x) + ' → 数えた ' + (countText(x) || '（なし）') + '・実働 ' + fm(x.workMin) + ' ' + flagTags(x.flags); }).join('<br>') + '</p>';
    b += '<fieldset><legend>打刻（前日〜翌日）</legend>' + (ps.length ? '<table><tbody>' + ps.map(function (x) {
      var v = !!x.voided_at;
      return '<tr><td class="' + (v ? 'void' : '') + '">' + esc(C.jstDate(Date.parse(x.at)).slice(5).replace('-', '/')) + ' ' + hm(x.at) + '</td><td class="' + (v ? 'void' : '') + '">' + (x.kind === 'in' ? '出勤' : '退勤') + '</td><td class="raw">' + (x.source === 'office' ? '事務所が足した' : x.source === 'offline' ? '控え（端末の時刻）' : 'タブレット') + (v ? '・取り消し: ' + esc(x.void_reason || '') : '') + '</td><td>' +
        (v || lk ? '' : '<label><input type="checkbox" data-void="' + esc(x.id) + '"> 取り消す</label>') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty">打刻はありません</p>') + '</fieldset>';
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>打刻を足す</legend><div class="row"><select id="e-kind" aria-label="出勤か退勤"><option value="">足さない</option><option value="in">出勤</option><option value="out">退勤</option></select>' +
      '<input type="date" id="e-date" value="' + date + '" aria-label="日付"><input type="time" id="e-time" aria-label="時刻"></div>' +
      '<div class="row"><select id="e-kind2" aria-label="2つめの打刻"><option value="">2つめは足さない</option><option value="in">出勤</option><option value="out">退勤</option></select><input type="date" id="e-date2" value="' + date + '" aria-label="2つめの日付"><input type="time" id="e-time2" aria-label="2つめの時刻"></div></fieldset>';
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>承認・休憩・メモ（この日）</legend>' +
      '<div class="row"><label><input type="checkbox" id="e-early"' + (dn && dn.early_ok ? ' checked' : '') + '> 早出を認める（予定より早い出勤を打刻どおりに数える）</label></div>' +
      '<div class="row"><label><input type="checkbox" id="e-ot"' + (dn && dn.overtime_ok ? ' checked' : '') + '> 残業を認める（予定より遅い退勤を打刻どおりに数える）</label></div>' +
      '<div class="row"><label>休憩 <input type="number" id="e-break" min="0" max="600" style="width:6em" value="' + (dn && dn.break_min != null ? dn.break_min : '') + '"> 分（空＝予定どおり）</label></div>' +
      '<div class="row"><label style="flex:1">メモ <input type="text" id="e-note" maxlength="400" style="flex:1;min-width:16em" value="' + esc(dn && dn.note || '') + '"></label></div></fieldset>';
    b += '<div class="row"><label style="flex:1">理由（必ず）<input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:16em" placeholder="例: 退勤の打刻忘れ（本人に確認）"' + (lk ? ' disabled' : '') + '></label></div><p class="help" id="e-msg" role="alert"></p>';
    $('g-dlg-b').innerHTML = b;
    $('g-dlg-f').innerHTML = '<button type="button" class="btn" data-act="dlg-close">閉じる</button>' + (lk ? '' : '<button type="button" class="btn pri" data-act="dlg-save">保存する</button>');
    try { $('g-dlg').showModal(); } catch (_) { $('g-dlg').setAttribute('open', ''); }
  }
  function closeDlg() { dlgCtx = null; try { $('g-dlg').close(); } catch (_) { $('g-dlg').removeAttribute('open'); } }
  function dirty() {
    if (!dlgCtx) return false;
    var q = function (id) { var e = $(id); return e ? e.value : ''; };
    var dn = dlgCtx.dn || {}, ck = function (id) { var e = $(id); return !!(e && e.checked); };
    var brv = q('e-break'), brOld = dn.break_min == null ? '' : String(dn.break_min);
    return !!(q('e-kind') || q('e-kind2') || q('e-reason') || document.querySelector('[data-void]:checked') ||
      ck('e-early') !== !!dn.early_ok || ck('e-ot') !== !!dn.overtime_ok || brv !== brOld || (q('e-note') || '').trim() !== (dn.note || ''));
  }
  function saveEdit() {
    if (!dlgCtx || busy) return;
    var ctx = dlgCtx, msg = $('e-msg');
    var reason = ($('e-reason').value || '').trim();
    if (!reason) { msg.textContent = '理由を書いてください。'; $('e-reason').focus(); return; }
    var ops = [];
    var voids = document.querySelectorAll('[data-void]:checked');
    for (var i = 0; i < voids.length; i++) ops.push({ f: 'kintai_punch_void', a: { p_id: voids[i].getAttribute('data-void'), p_reason: reason } });
    var adds = [['e-kind', 'e-date', 'e-time'], ['e-kind2', 'e-date2', 'e-time2']];
    for (i = 0; i < adds.length; i++) {
      var k = $(adds[i][0]).value, dt = $(adds[i][1]).value, tm = $(adds[i][2]).value;
      if (!k) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || !/^\d{2}:\d{2}$/.test(tm)) { msg.textContent = '足す打刻の日付と時刻を入れてください。'; return; }
      ops.push({ f: 'kintai_punch_add', a: { p_staff_id: ctx.sid, p_kind: k, p_at: dt + 'T' + tm + ':00+09:00', p_reason: reason } });
    }
    var dn = ctx.dn || {}, brV = $('e-break').value, br = brV === '' ? null : Math.round(+brV);
    if (br != null && !(br >= 0 && br <= 600)) { msg.textContent = '休憩は 0〜600 分で入れてください。'; return; }
    var patch = {}, changed = false;
    var early = $('e-early').checked, ot = $('e-ot').checked, nt = ($('e-note').value || '').trim();
    if (early !== !!dn.early_ok) { patch.early_ok = early; changed = true; }
    if (ot !== !!dn.overtime_ok) { patch.overtime_ok = ot; changed = true; }
    if (br !== (dn.break_min == null ? null : dn.break_min)) { patch.break_min = br; changed = true; }
    if (nt !== (dn.note || '')) { patch.note = nt; changed = true; }
    if (changed) ops.push({ f: 'kintai_day_put', a: { p_staff_id: ctx.sid, p_date: ctx.date, p_patch: patch, p_rev: ctx.rev, p_reason: reason } });
    if (!ops.length) { msg.textContent = '直す所がありません。'; return; }
    busy = true; msg.textContent = '保存しています…';
    var done = 0;
    var run = function () {
      if (done >= ops.length) return null;
      var o = ops[done];
      return rpc(o.f, o.a).then(okOr).then(function () { done++; return run(); });
    };
    run().then(function () {
      busy = false; closeDlg(); sync('保存しました');
      return load(false);
    })['catch'](function (e) {
      busy = false;
      note('直しの保存', e);
      if (done) {
        /* 一部だけ保存できた時は窓を閉じて読み直す（もう一度押して同じ打刻を足さない・版を新しくする・指摘8） */
        var m2 = msgOf(e) + '（' + ops.length + ' 件のうち ' + done + ' 件は保存しました。読み直したので、残りを直す時はもう一度開いてください）';
        closeDlg(); load(false); alert(m2);
      } else msg.textContent = msgOf(e);
    });
  }
  function openAddDay() {
    var sid = selStaff; if (!sid) return;
    var d = prompt('打刻を足す日（例 ' + ym + '-05）', ym + '-01');
    if (!d) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d.slice(0, 7) !== ym) { alert('この月の日付を「' + ym + '-05」の形で入れてください。'); return; }
    openEdit(sid, d);
  }

  /* ── 職員・締め・出力・設定 ── */
  function recode(sid) {
    if (busy) return;
    var s = (data.staff || []).filter(function (x) { return x.staff_id === sid; })[0];
    if (!s || !confirm(s.name + ' さんの打刻の番号を振り直します。今の番号 ' + s.code + ' はタブレットで使えなくなります。よろしいですか？')) return;
    busy = true;
    rpc('kintai_staff_code_reset', { p_staff_id: sid }).then(okOr).then(function (r) {
      busy = false; alert('新しい番号は ' + r.code + ' です。本人にだけ伝えてください。'); return load(false);
    })['catch'](function (e) { busy = false; note('番号の振り直し', e); alert(msgOf(e)); });
  }
  function lockMonth() {
    if (busy || !month) return;
    if (!confirm(ym + ' を締めます。締めた後は打刻の直し・承認・シフトの取り込みができなくなります。よろしいですか？')) return;
    busy = true;
    rpc('kintai_month_lock', { p_ym: ym, p_snapshot: C.snapshotOf(month) }).then(okOr).then(function () { busy = false; return load(false); })['catch'](function (e) { busy = false; note('締め', e); alert(msgOf(e)); });
  }
  function unlockMonth() {
    if (busy) return;
    var r = prompt(ym + ' の締めを解除します。理由を書いてください（直しの履歴に残ります）。');
    if (!r || !r.trim()) return;
    busy = true;
    rpc('kintai_month_unlock', { p_ym: ym, p_reason: r.trim() }).then(okOr).then(function () { busy = false; return load(true); })['catch'](function (e) { busy = false; note('締めの解除', e); alert(msgOf(e)); });
  }
  function download(kind) {
    if (!month || busy) { alert('読み込みが終わってから書き出してください。'); return; }
    var res = C.buildCsv(month, { nameOf: function (d) { try { return window.SUFacility ? window.SUFacility.officeName(d) : d; } catch (_) { return d; } } });
    var text = kind === 'sum' ? res.summary : res.daily, enc = ($('g-enc') || {}).value || 'utf8', blob, unknown = [];
    if (enc === 'sjis') {
      try { var sj = C.encodeSjis(text); blob = new Blob([sj.bytes], { type: 'text/csv' }); unknown = sj.unknown; }
      catch (e) { alert('この端末では Shift_JIS に変えられません。UTF-8 で書き出してください。'); return; }
    } else blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '勤怠_' + ym + (kind === 'sum' ? '_月の集計' : '_日ごと') + (isLocked() ? '' : '_締め前') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    var w = res.warnings.slice();
    if (unknown.length) w.push('Shift_JIS に無い文字（' + unknown.join(' ') + '）は ? にしました。');
    if (w.length) alert('書き出しました。気をつける所:\n' + w.join('\n'));
  }
  function loadEdits() {
    var my = gen;
    $('g-edits').innerHTML = '<p class="empty">読み込んでいます…</p>';
    rpc('kintai_edits_get', { p_ym: ym }).then(okOr).then(function (r) {
      if (my !== gen) return;
      editsCache = r.edits || [];
      if (tab === 'close' && $('g-edits')) $('g-edits').innerHTML = editsHtml(editsCache);
    })['catch'](function (e) { if (my !== gen) return; note('直しの履歴', e); var el = $('g-edits'); if (el) el.innerHTML = '<div class="band ng">' + esc(msgOf(e)) + '</div>'; });
  }
  function saveSettings() {
    if (busy || !isAdmin()) return;
    var cfg = {}, bad = [];
    SET_FIELDS.forEach(function (f) { var v = $('s-' + f[0]).value; if (v === '') return; var n = +v; if (!isFinite(n)) bad.push(f[1]); else cfg[f[0]] = n; });
    if (bad.length) { alert('数で入れてください: ' + bad.join('、')); return; }
    cfg.variableMonth = $('s-variableMonth').checked; cfg.monthRound30 = $('s-monthRound30').checked; cfg.csvTime = $('s-csvTime').value;
    var filled = C.fillConfig(cfg), dropped = [];
    for (var k in cfg) if (cfg[k] !== filled[k]) dropped.push(k);
    if (dropped.length) { alert('範囲の外の値があります。入れ直してください。'); return; }
    busy = true;
    rpc('kintai_settings_put', { p_config: cfg, p_rev: (data.settings && data.settings.rev) || 0 }).then(okOr).then(function () { busy = false; sync('設定を保存しました'); return load(false); })['catch'](function (e) { busy = false; note('設定の保存', e); alert(msgOf(e)); });
  }

  /* ── 操作 ── */
  function setTab(t) { if (TABS.indexOf(t) < 0) t = 'day'; tab = t; lsSet(LS_TAB, t); paint(); }
  function setYm(v) { if (!C.isYm(v) || v === ym) return; ym = v; lsSet(LS_YM, v); $('g-ym').value = v; shiftInfo = null; editsCache = null; data = null; month = null; load(true); }
  function bind() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var t = b.getAttribute('data-tab');
      if (t) { setTab(t); return; }
      var a = b.getAttribute('data-act');
      if (!a) return;
      if (a === 'edit') openEdit(b.getAttribute('data-sid'), b.getAttribute('data-date'));
      else if (a === 'person') { selStaff = b.getAttribute('data-sid'); setTab('person'); }
      else if (a === 'dlg-close') { if (!dirty() || confirm('保存していない直しがあります。閉じますか？')) closeDlg(); }
      else if (a === 'dlg-save') saveEdit();
      else if (a === 'addday') openAddDay();
      else if (a === 'recode') recode(b.getAttribute('data-sid'));
      else if (a === 'import') { if (isLocked()) alert('締めた月は取り込めません。'); else load(true); }
      else if (a === 'lock') lockMonth();
      else if (a === 'unlock') unlockMonth();
      else if (a === 'csv-sum') download('sum');
      else if (a === 'csv-day') download('day');
      else if (a === 'edits') loadEdits();
      else if (a === 'save-set') saveSettings();
      else if (a === 'print') window.print();
    });
    document.addEventListener('change', function (e) {
      var id = e.target && e.target.id;
      if (id === 'g-date') { selDate = e.target.value; paint(); }
      else if (id === 'g-staff') { selStaff = e.target.value; paint(); }
      else if (id === 'g-only') { onlyReview = e.target.checked; paint(); }
      else if (id === 'g-ym') setYm(e.target.value);
    });
    $('g-prev').addEventListener('click', function () { setYm(C.prevYm(ym)); });
    $('g-next').addEventListener('click', function () { setYm(C.nextYm(ym)); });
    $('g-import').addEventListener('click', function () { if (isLocked()) alert('締めた月は取り込めません。'); else load(true); });
    $('g-reload').addEventListener('click', function () { load(false); });
    $('g-dlg').addEventListener('cancel', function (e) { if (dirty() && !confirm('保存していない直しがあります。閉じますか？')) e.preventDefault(); else dlgCtx = null; });
    window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('storage', function (e) { if (e.key === 'su_device_role' && isField()) location.reload(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted && isField()) location.reload(); });
  }

  function showField() {
    view = 'field';
    var g = $('g-gate'); g.hidden = false;
    g.innerHTML = '<h2>この画面は事務所のパソコンで使います</h2><p>この端末は「現場」として設定されているため、勤怠管理は開きません。出勤・退勤の打刻は「出勤・退勤の打刻」の画面から行います。</p><p><a class="btn" href="kintai-clock.html">打刻の画面へ</a> <a class="btn" href="index.html">メニューへ戻る</a></p>';
  }
  function boot() {
    if (isField()) { showField(); return; }
    if (!window.SUAppGate || !C) { document.body.textContent = ''; var p = document.createElement('p'); p.textContent = '画面の部品を読み込めませんでした。ページを読み込み直してください。'; document.body.appendChild(p); return; }
    window.SUAppGate.run('kintai', { dirty: dirty }).then(function (ok) {
      if (!ok) { view = 'gate'; return; }
      view = 'app';
      $('g-app').hidden = false;
      var t = lsGet(LS_TAB); tab = TABS.indexOf(t) >= 0 ? t : 'day';
      var y = lsGet(LS_YM); ym = C.isYm(y) ? y : todayYm();
      $('g-ym').value = ym;
      bind();
      try { if (window.SUPerf) window.SUPerf.ready(); } catch (_) {}
      return window.SUAuth.check().then(function (st) { role = st && st.status === window.SUAuth.STATUS.OK ? st.role : null; }, function () { role = null; })
        .then(function () { return load(true); });
    })['catch'](function (e) { note('起動', e); });
  }
  var go = function () { try { boot(); } catch (e) { note('起動', e); } };
  if (window.SUFacility && typeof window.SUFacility.onReady === 'function') window.SUFacility.onReady(go); else go();
})();
