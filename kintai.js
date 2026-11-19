/* kintai.js — 勤怠管理の事務所画面（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1・2026-11-19 改善 v2 ROOT-v2-polish.md の C）
 * ════════════════════════════════════════════════════════════════
 * ・正本は共通のデータベース（kintai_* の表）。読み書きは関数（rpc）だけ。誰が何をできるかはデータベースが決める
 * ・事務所PCだけ。現場の端末（su_device_role=field）は何も取りに行かずに案内だけ出す（CLAUDE.md §2-5）
 * ・開く前に SUAppGate.run('kintai') でログインの役割を確かめる（§2-7）
 * ・開いた月はシフト（勤務表）を自動で取り込む（締めた月は取り込まない）
 * ・0101（2026-11-19 凍結仕様 ROOT-payroll.md「A.」）: 月は「○月分」＝締め日で切った期間（DB の kintai_month_get の period が正）。
 *   シフトは期間にかかる2つのカレンダー月を、その月ごとに取り込む（退職者もその月で決める・締めた日は DB が飛ばす）
 * ・生の打刻は変えない。直しは「事務所の打刻を足す」「打刻を取り消す（理由つき）」「早出・残業を認める（全部／この時刻から・まで）」
 *   「休憩を直す」「確認済み・欠勤の印」で、全部データベースの直しの履歴（kintai_edits）に残る
 * ・端末に残すのは UI の状態（開いていたタブ・月）だけ（原則11）。氏名・打刻・絞り込みは端末に残さない
 * ・遅れて届いた応答は世代（gen）で捨てる
 * ・要確認の色・件数は KintaiCalc.needsReview（確認済みの塊は数えない）にそろえる
 */
(function () {
  'use strict';
  var C = window.KintaiCalc;
  var TABS = ['day', 'review', 'grid', 'person', 'staff', 'close', 'settings'];
  var LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym';
  var gen = 0, view = 'boot', tab = 'day', ym = null, data = null, month = null, shiftInfo = null;
  var selDate = null, selStaff = null, onlyReview = false, role = null, busy = false, editsCache = null;
  /* v2: 日ごとの札の絞り込み（working / notin / review / absent）・事業所の絞り込み・全員分の印刷（どれも端末に残さない） */
  var dayFilter = null, officeFilter = '', printAll = false;
  var $ = function (id) { return document.getElementById(id); };

  function note(where, e) { try { if (window.SUErrors && window.SUErrors.note) window.SUErrors.note('勤怠管理', e, 'kintai:' + where); } catch (_) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sync(t) { $('g-sync').textContent = t || ''; }
  function isField() { try { return localStorage.getItem('su_device_role') === 'field'; } catch (_) { return false; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function todayYm() { return C.jstDate(Date.now()).slice(0, 7); }
  function hm(v) { return v == null ? '' : C.jstHM(typeof v === 'number' ? v : Date.parse(v)); }
  function ms(v) { if (v == null || v === '') return null; var t = typeof v === 'number' ? v : Date.parse(v); return isNaN(t) ? null : t; }
  function fm(m) { return C.fmtMin(m || 0, 'hmm'); }
  function md(date) { return date.slice(5).replace('-', '/'); }
  function officeName(code) {
    var d = C.OFFICE_DIV[code];
    if (!d) return '';
    try { return window.SUFacility ? (window.SUFacility.officeName(d) || d) : d; } catch (_) { return d; }
  }
  function corpName() { try { var f = window.SUFacility && window.SUFacility.get && window.SUFacility.get(); return (f && (f.corpName || f.facilityName)) || ''; } catch (_) { return ''; } }
  function isLocked() { return !!(data && data.month && data.month.locked_at); }
  function isAdmin() { return role === 'admin'; }
  /* 0101: その月分の期間（DB の period。読む前・形が違う時はその月の1日〜末日） */
  function per() { return C.periodOf(ym, data && data.period); }
  function inPer(d) { var p = per(); return d >= p.from && d <= p.to; }
  /* 期間の外の日 → 前か次の月分（期間はカレンダー月から大きくずれないので1つ隣） */
  function ymFor(d) { var p = per(); return d > p.to ? C.nextYm(ym) : d < p.from ? C.prevYm(ym) : ym; }
  function perLabel() { return C.periodLabel(ym, data && data.period); }
  /* 締められるのは日本時間の今日がその月分の期間の末日より後の月分だけ（期間の途中・先の月分は DB も notyet で断る） */
  function notYet() { return !!ym && C.jstDate(Date.now()) <= per().to; }
  var autoYm = false;   /* 前に開いた月分が無く「今月」で開いた時だけ、期間が今日を過ぎていれば次の月分へ移る */

  /* 短い知らせ（画面の下・自動で消える・aria-live） */
  var toastT = null;
  function toast(t) {
    var el = $('g-toast'); if (!el) return;
    el.textContent = t; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; el.textContent = ''; }, 4000);
  }
  /* 押したボタンを押せない状態にして文言を変える（戻す関数を返す） */
  function pressBusy(btn, text, scope) {
    var list = scope ? scope.querySelectorAll('button') : (btn ? [btn] : []), keep = [];
    for (var i = 0; i < list.length; i++) { keep.push([list[i], list[i].disabled]); list[i].disabled = true; }
    var label = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = text || '保存しています…'; }
    return function () {
      for (var j = 0; j < keep.length; j++) keep[j][0].disabled = keep[j][1];
      if (btn && label != null) { btn.textContent = label; if (!scope) btn.disabled = false; }
    };
  }
  /* 灰色の帯（読み込み中の骨組み）を el の中に足す */
  function skel(el) {
    if (!el) return;
    ['w8', 'w6', 'w8', 'w4', 'w6'].forEach(function (w) { var s = document.createElement('span'); s.className = 'skel ' + w; s.setAttribute('aria-hidden', 'true'); el.appendChild(s); });
  }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

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
    badtime: '時刻の形が違います。', baddate: '日付の形が違います。', badkey: '直せない項目が入っていました。',
    badvalue: '入れた値を受け付けられませんでした（休憩は 0〜600 分・メモは 400 字まで・認める時刻はその日の前日〜翌日の中）。',
    clientid: '同じ打刻がもう記録されています。', notyet: '月末を過ぎてから締められます。',
    badperiod: 'この月分の期間を決められませんでした。管理者に知らせてください。', overlap: 'ほかの締めた月分と期間が重なるため締められません。管理者に知らせてください。',
    closeday: '締めた月分と期間が重なるため、締め日を変えられません。' };
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
  /* 職員の取り込みで送る行（C-10・積み残し1の直し 2026-11-19）。
     active（休止か）は開いている月でなく「今月（日本時間）の表示の状態」＝staffVisible(st, 今月) で決める
     （過去の月を開いても休止の人が戻らない・先の月を開いても在籍の人が休止にならない）。
     今月のシフトが読めない・空・職員の一覧が空の時は active を送らない（DB の今の値のまま＝誤って休止にも在籍にもしない）。
     開いている月で表示外の人は、勤怠の名簿にいて今月の状態と違う時だけ送る（名簿に無い人は送らない＝番号を振らない）。名前以外の項目は送らない */
  function staffRows(shiftStaff, built, activeOk) {
    var cur = todayYm(), byId = {}, vis = {}, known = {}, out = [];
    (shiftStaff || []).forEach(function (st) { if (st && typeof st.id === 'string') byId[st.id] = st; });
    (data && data.staff || []).forEach(function (s) { known[s.staff_id] = s; });
    built.staff.forEach(function (r) {
      vis[r.staff_id] = 1;
      var row = {}, k;
      for (k in r) if (k !== 'active') row[k] = r[k];
      if (activeOk) row.active = C.staffVisible(byId[r.staff_id], cur);
      out.push(row);
    });
    if (!activeOk) return out;
    (shiftStaff || []).forEach(function (st) {
      var kn = st && known[st.id];
      if (!kn || vis[st.id]) return;
      var act = C.staffVisible(st, cur);
      if ((kn.active !== false) === act) return;
      out.push({ staff_id: st.id, name: String(kn.name || st.name || st.id).slice(0, 60), active: act });
    });
    return out;
  }
  /* 0101: 期間（例 11/16〜12/15）にかかるカレンダー月（11月・12月）ごとに、その月の ym でシフトから予定を作って入れ替える
     （退職者はその月の ym で決める＝12月退職の人の 12/16〜31 も落とさない）。職員の行は2か月の和集合。締めた範囲の日は DB が飛ばす */
  function importShift(my) {
    var ym0 = ym, p0 = per(), cms = [p0.from.slice(0, 7)];
    if (p0.to.slice(0, 7) !== cms[0]) cms.push(p0.to.slice(0, 7));
    var cur = todayYm(), keys = ['staff', 'symbols', 'settings'];
    cms.forEach(function (cm) { [cm, C.nextYm(cm)].forEach(function (k) { if (keys.indexOf('sched:' + k + ':plan') < 0) keys.push('sched:' + k + ':plan'); }); });
    if (keys.indexOf('sched:' + cur + ':plan') < 0) keys.push('sched:' + cur + ':plan');   /* 休止かを決める今月のシフト */
    return pullShift(keys).then(function (r) {
      if (my !== gen) return null;
      if (!r || r.ok !== true || !r.entries) {
        shiftInfo = { ok: false, why: r && r.error === 'google' ? 'シフトが新しい保存先に移っていないため、自動で取り込めません。' : (r && r.error === 'login' ? 'ログインが切れたためシフトを読めませんでした。' : 'シフトを読めませんでした。') };
        return null;
      }
      var E = r.entries, ent = function (k) { return E[k] && E[k].data; };
      var have = cms.filter(function (cm) { return !!ent('sched:' + cm + ':plan'); });
      /* 期間にかかる月のシフトが1つも無い時だけ「この月のシフトがまだありません」。片方だけある時はある月だけ取り込み、
         無い月は帯で知らせる（15日締めの12月分を11月中に開くと12月のシフトはまだ無いのが普通・締めは止めない＝仮置き） */
      if (!have.length) { shiftInfo = { ok: false, why: 'この月のシフトがまだありません。' }; return null; }
      var ss = ent('settings') || {}, builts = [], warnings = [], nrows = 0, confirmed = true, staffU = [], seen = {};
      have.forEach(function (cm) {
        var plan = ent('sched:' + cm + ':plan');
        var b = C.buildSchedule({ ym: cm, plan: plan, nextPlan: ent('sched:' + C.nextYm(cm) + ':plan') || {}, staff: ent('staff') || [], symbols: ent('symbols') || [], settings: ss });
        builts.push({ cm: cm, rows: b.rows });
        warnings = warnings.concat(b.warnings); nrows += b.rows.length;
        if (!(plan.meta && plan.meta.confirmedAt)) confirmed = false;
        b.staff.forEach(function (x) { if (!seen[x.staff_id]) { seen[x.staff_id] = 1; staffU.push(x); } });
      });
      var miss = cms.filter(function (cm) { return have.indexOf(cm) < 0; });
      shiftInfo = { ok: true, confirmed: confirmed, warnings: warnings, rows: nrows, missing: miss, skipped: 0,
        breaks: { breakThresholdH: ss.breakThresholdH, breakH: ss.breakH, nightBreakH: ss.nightBreakH } };
      var sl = ent('staff'), cp = ent('sched:' + cur + ':plan');
      var activeOk = Array.isArray(sl) && sl.length > 0 && !!(cp && cp.cells && Object.keys(cp.cells).length);
      var rows = staffRows(sl, { staff: staffU }, activeOk);
      return rpc('kintai_staff_sync', { p_rows: rows }).then(okOr).then(function () {
        var chain = Promise.resolve(true);
        builts.forEach(function (bt) {
          chain = chain.then(function (go) {
            if (!go || my !== gen) return false;   /* 待つ間に月を替えた時は、前の月の予定を送らない（指摘5） */
            return rpc('kintai_schedule_put', { p_ym: bt.cm, p_rows: bt.rows }).then(function (res) {
              if (res && res.ok === false && res.error === 'locked') return true;   /* そのカレンダー月は全部締めてある＝取り込まない */
              okOr(res);
              if (res.skipped && shiftInfo) shiftInfo.skipped += res.skipped;
              return true;
            });
          });
        });
        return chain.then(function (go) { return go && my === gen ? true : null; });
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
      if (autoYm) { autoYm = false; if (C.jstDate(Date.now()) > per().to) { busy = false; my = -1; setYm(C.nextYm(ym)); return; } }
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
      paintPer();
      editsCache = null;
      paint();
    })['catch'](function (e) {
      if (my !== gen) return;
      note('読み込み', e);
      busy = false; data = null; month = null; sync(''); $('g-main').removeAttribute('aria-busy');
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
    /* 今の時刻を渡す（勤務中・まだ出勤していないの印が時刻で変わる・v2） */
    month = C.computeMonth({ ym: ym, period: data.period, staff: data.staff || [], schedule: data.schedule || [], punches: data.punches || [], days: data.days || [], config: cfg, lockedAt: data.month && data.month.locked_at, now: Date.now() });
  }

  /* ── 描画 ── */
  function paintTabs() {
    var bs = document.querySelectorAll('.tabs button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-selected', bs[i].getAttribute('data-tab') === tab ? 'true' : 'false');
    var n = month && month.totals ? month.totals.reviewCount : 0, el = $('g-rv-n');
    if (el) {
      el.textContent = n ? String(n) : '';
      var tb = el.parentNode; if (tb) tb.setAttribute('aria-label', '要確認' + (month ? '（' + n + ' 件）' : ''));
    }
  }
  function bands() {
    var h = '';
    if (isLocked()) h += '<div class="band ok" role="status">この月は締めてあります（' + esc(new Date(data.month.locked_at).toLocaleString('ja-JP')) + '）。直しと承認はできません。タブレットの打刻は締めた後も記録され、「締めた後の打刻」の印が付きます。直す時は管理者が「締めと出力」で締めを解除します。</div>';
    if (shiftInfo && !shiftInfo.ok) h += '<div class="band warn" role="status">' + esc(shiftInfo.why) + '</div>';
    if (shiftInfo && shiftInfo.ok && !shiftInfo.confirmed) h += '<div class="band warn" role="status">この月のシフトはまだ「確定」していません。シフトが変わると予定も変わります（開くたびに取り込み直します）。</div>';
    if (shiftInfo && shiftInfo.ok && shiftInfo.missing && shiftInfo.missing.length) h += '<div class="band warn" role="status">' + esc(shiftInfo.missing.map(function (cm) { return (+cm.slice(5)) + '月'; }).join('・')) + 'のシフトがまだ無いため、その月の日の予定は取り込んでいません。</div>';
    if (shiftInfo && shiftInfo.ok && shiftInfo.skipped) h += '<div class="band" role="status">締めてある前の月分の日（' + esc(String(shiftInfo.skipped)) + ' 件の予定）は、シフトを取り込んでも変えていません。</div>';
    if (shiftInfo && shiftInfo.ok && shiftInfo.warnings.length) h += '<div class="band warn" role="status">シフトの記号で気になる所が ' + shiftInfo.warnings.length + ' 件あります（「職員と番号」の下に一覧）。</div>';
    return h;
  }
  function nowText() { return new Date().toLocaleString('ja-JP'); }
  /* 印刷の時だけの見出し（事業者・月・氏名または日付・印刷した日時）。日時は描く時と印刷の直前に入れる */
  function printHead(sub) {
    return '<div class="ph"><b>' + esc(corpName()) + '　勤怠 ' + esc(perLabel()) + '</b>　' + esc(sub) + '　<span>印刷した日時: <span class="ph-at">' + esc(nowText()) + '</span></span></div>';
  }
  function paint() {
    paintTabs();
    var m = $('g-main');
    if (busy && !month) { m.innerHTML = '<p class="empty">読み込んでいます…</p>'; skel(m); m.setAttribute('aria-busy', 'true'); return; }
    m.removeAttribute('aria-busy');
    if (!month) return;
    var f = { day: paintDay, review: paintReview, grid: paintGrid, person: paintPerson, staff: paintStaff, close: paintClose, settings: paintSettings }[tab];
    m.innerHTML = bands() + f();
  }
  var RED = { no_punch: 1, missing_in: 1, missing_out: 1 };
  /* 印の札。勤務中は青（赤にしない）・確認済みの塊の要確認の印は線で消して残す */
  function flagTags(flags, checked) {
    return flags.map(function (f) {
      var cls = 'tag';
      if (f === 'working') cls = 'tag wk';
      else if (f === 'checked') cls = 'tag ok';
      else if (C.REVIEW[f]) cls = checked ? 'tag done' : (RED[f] ? 'tag ng' : 'tag rv');
      return '<span class="' + cls + '">' + esc(C.FLAG_LABEL[f] || f) + '</span>';
    }).join('');
  }
  function rawPunches(b) {
    return b.punches.map(function (p) { return (p.kind === 'in' ? '出' : '退') + ' ' + hm(p.at) + (p.source === 'offline' ? '（控え）' : p.source === 'office' ? '（事務所）' : ''); }).join(' / ');
  }
  function schedText(b) { return b.sched ? esc(b.symbol) + ' ' + hm(b.schedStart) + '〜' + hm(b.schedEnd) : '<span class="raw">予定なし</span>'; }
  function countText(b) { return b.countStart != null ? hm(b.countStart) + '〜' + hm(b.countEnd) : ''; }
  function dateList() { var p = per(), out = []; for (var d = p.from; d <= p.to; d = C.addDays(d, 1)) out.push(d); return out; }
  /* 月の選びの横に期間（例「（11/16〜12/15）」）を出す（textContent・画面だけ） */
  function paintPer() { var el = $('g-period'); if (el) el.textContent = perLabel().replace(/^.*月分/, ''); }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function wd(date) { return WD[new Date(Date.parse(date + 'T12:00:00+09:00')).getUTCDay()]; }
  function officeSelect() {
    return '<label>事業所 <select id="g-office"><option value="">全部</option>' + ['facility', 'visit', 'day'].map(function (o) { return '<option value="' + o + '"' + (officeFilter === o ? ' selected' : '') + '>' + esc(officeName(o)) + '</option>'; }).join('') + '</select></label>';
  }
  /* 塊の種類（日ごとの札） */
  function kindsOf(b) { return { working: !!b.working, notin: b.flags.indexOf('not_in_yet') >= 0, review: C.needsReview(b), absent: !!b.absent }; }

  function paintDay() {
    var ds = dateList();
    if (!selDate || ds.indexOf(selDate) < 0) selDate = ds.indexOf(C.jstDate(Date.now())) >= 0 ? C.jstDate(Date.now()) : ds[0];
    var rows = [], cnt = { working: 0, notin: 0, review: 0, absent: 0 };
    month.people.forEach(function (p) {
      var d = p.days.filter(function (x) { return x.date === selDate; })[0];
      if (!d) return;
      if (!d.blocks.length && d.paidMin && !dayFilter && (!officeFilter || p.staff.office === officeFilter)) rows.push('<tr><td>' + esc(p.staff.name) + '</td><td>' + esc(officeName(p.staff.office)) + '</td><td>有休</td><td></td><td></td><td class="num"></td><td class="num">' + fm(0) + '</td><td></td><td></td></tr>');
      d.blocks.forEach(function (b, bi) {
        if (officeFilter && b.office !== officeFilter) return;
        var k = kindsOf(b);
        for (var key in cnt) if (k[key]) cnt[key]++;
        if (dayFilter && !k[dayFilter]) return;
        rows.push('<tr><td>' + esc(p.staff.name) + '</td><td>' + esc(officeName(b.office)) + '</td><td>' + schedText(b) + '</td><td class="raw">' + esc(rawPunches(b)) + '</td><td>' + countText(b) + '</td><td class="num">' + b.breakMin + '</td><td class="num">' + fm(b.workMin) + '</td><td>' + flagTags(b.flags, b.checked) + '</td>' +
          '<td class="no-print"><button type="button" class="btn sm" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + esc(selDate) + '" data-bi="' + bi + '">直す</button></td></tr>');
      });
    });
    var CH = [['working', '出勤中', 'wk'], ['notin', 'まだ出勤していない', ''], ['review', '要確認', 'rv'], ['absent', '欠勤', 'ng']];
    var chips = '<div class="chips no-print" role="group" aria-label="この日のまとめ（押すとその人だけに絞ります）">' + CH.map(function (c) {
      return '<button type="button" class="chip ' + c[2] + '" data-act="dayf" data-f="' + c[0] + '" aria-pressed="' + (dayFilter === c[0] ? 'true' : 'false') + '">' + c[1] + ' <b>' + cnt[c[0]] + '</b></button>';
    }).join('') + (dayFilter ? '<button type="button" class="btn sm" data-act="dayf" data-f="">絞り込みをやめる</button>' : '') + '</div>';
    var today = C.jstDate(Date.now());
    return printHead(md(selDate) + '（' + wd(selDate) + '）の勤怠') + '<div class="cd"><div class="row no-print">' +
      '<button type="button" class="btn sm" data-act="day-move" data-n="-1" aria-label="前の日">◀ 前の日</button>' +
      '<button type="button" class="btn sm" data-act="day-today"' + (selDate === today ? ' aria-pressed="true"' : '') + '>今日</button>' +
      '<button type="button" class="btn sm" data-act="day-move" data-n="1" aria-label="次の日">次の日 ▶</button>' +
      '<label>日付 <select id="g-date">' + ds.map(function (x) { return '<option value="' + x + '"' + (x === selDate ? ' selected' : '') + '>' + md(x) + '（' + wd(x) + '）</option>'; }).join('') + '</select></label>' +
      officeSelect() + '<button type="button" class="btn sm" data-act="print">この日を印刷</button></div>' + chips +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>事業所</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th>印</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">' + (dayFilter || officeFilter ? '絞り込みに当たる人はいません' : 'この日の予定・打刻はありません') + '</td></tr>') + '</tbody></table></div>' +
      '<p class="help">「数えた時刻」は予定に合わせて丸めた時刻です（予定より早い出勤は予定の開始、予定より遅い退勤は予定の終わり）。打刻はそのまま残っています。早出・残業を認める時は「直す」から。「出勤中」は退勤の時刻がまだ来ていない人で、要確認には数えません。この画面は1分ごとに数え直します。</p></div>';
  }

  /* 要確認の一覧（v2・C-2）: 月の要確認を日付順に1列 */
  function nameOf(sid) { var p = personOf(sid); return p ? p.staff.name : sid; }
  function paintReview() {
    var list = C.reviewList(month);
    if (!list.length) return printHead('要確認の一覧') + '<div class="cd"><div class="band ok" role="status">要確認はありません。締めに進めます。</div><div class="row no-print"><button type="button" class="btn" data-tab="close">締めと出力へ</button></div></div>';
    var rows = list.map(function (r, i) {
      var p = personOf(r.staffId), d = p && p.days.filter(function (x) { return x.date === r.date; })[0], b = d && d.blocks[r.blockIndex];
      return '<tr><td>' + md(r.date) + '（' + wd(r.date) + '）</td><td>' + esc(nameOf(r.staffId)) + '</td><td>' + (b ? schedText(b) : '') + '</td><td class="raw">' + (b ? esc(rawPunches(b)) : '') + '</td><td>' + flagTags(r.marks, false) + '</td>' +
        '<td class="no-print"><button type="button" class="btn sm" data-act="edit" data-sid="' + esc(r.staffId) + '" data-date="' + esc(r.date) + '" data-bi="' + r.blockIndex + '" data-rv="' + i + '">直す</button></td></tr>';
    }).join('');
    return printHead('要確認の一覧（' + list.length + ' 件）') + '<div class="cd"><div class="row no-print"><b>要確認 ' + list.length + ' 件</b><button type="button" class="btn sm" data-act="print">印刷</button></div>' +
      '<p class="help no-print">「直す」で開いた窓の「保存して次へ」を押すと、保存した後に次の行の窓がそのまま開きます。直す所が無い時は窓の中の「確認済みにする」を選んで保存します。</p>' +
      '<div class="tw"><table><thead><tr><th>日</th><th>職員</th><th>予定</th><th>打刻（そのまま）</th><th>印</th><th class="no-print"></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function personVisible(p) { return !officeFilter || p.staff.office === officeFilter || (p.sum.byOffice && p.sum.byOffice[officeFilter] > 0); }
  function paintGrid() {
    var ds = dateList();
    var head = '<tr><th class="nm">氏名</th>' + ds.map(function (x) { return '<th class="num">' + (+x.slice(8)) + '<br><span class="raw">' + wd(x) + '</span></th>'; }).join('') +
      '<th class="num sr sr3">出勤</th><th class="num sr sr2">総労働</th><th class="num">残業</th><th class="num">法定外</th><th class="num">深夜</th><th class="num">有休</th><th class="num sr sr1">要確認</th></tr>';
    var body = month.people.filter(function (p) { return (!onlyReview || p.sum.reviewCount > 0) && personVisible(p); }).map(function (p) {
      var by = {}; p.days.forEach(function (d) { by[d.date] = d; });
      return '<tr><td class="nm"><button type="button" class="btn sm" data-act="person" data-sid="' + esc(p.staff.staff_id) + '">' + esc(p.staff.name) + '</button></td>' + ds.map(function (x) {
        var d = by[x];
        if (!d) return '<td></td>';
        var rvb = d.blocks.filter(function (b) { return C.needsReview(b); });
        var rv = rvb.length > 0, np = rvb.some(function (b) { return b.flags.some(function (f) { return RED[f]; }); }), wk = d.blocks.some(function (b) { return b.working; });
        var txt = d.workMin ? fm(d.workMin) : (d.paidMin ? '有' : (d.absent ? '欠' : (np ? '✕' : (wk ? '勤' : ''))));
        return '<td class="' + (np ? 'np' : rv ? 'rv' : wk ? 'wk' : '') + '"><button type="button" class="btn sm" style="min-height:32px;padding:0 4px;border:0;background:none;color:inherit" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + x + '" aria-label="' + esc(p.staff.name + ' ' + x + ' を直す') + '">' + txt + '</button></td>';
      }).join('') + '<td class="num sr sr3">' + p.sum.workDays + '</td><td class="num sr sr2">' + fm(p.sum.workMin) + '</td><td class="num">' + fm(p.sum.overtimeMin) + '</td><td class="num">' + fm(p.sum.legalOverMin) + '</td><td class="num">' + fm(p.sum.nightMin) + '</td><td class="num">' + p.sum.paidDays + '</td><td class="num sr sr1">' + p.sum.reviewCount + '</td></tr>';
    }).join('');
    return printHead('月の一覧') + '<div class="cd"><div class="row no-print"><label><input type="checkbox" id="g-only"' + (onlyReview ? ' checked' : '') + '> 要確認がある人だけ</label>' + officeSelect() + '<button type="button" class="btn sm" data-act="print">印刷</button>' +
      '<span class="help">黄色＝要確認・赤＝打刻の漏れ／打刻なし・青＝出勤中。数字を押すとその日を直せます。事業所で絞った時も、数字はその人の月全体です。</span></div><div class="tw"><table class="grid"><thead>' + head + '</thead><tbody>' + (body || '<tr><td class="empty" colspan="40">該当する職員はいません</td></tr>') + '</tbody></table></div></div>';
  }

  function personOf(sid) { return month.people.filter(function (p) { return p.staff.staff_id === sid; })[0] || null; }
  function officeBreakdown(s) {
    var ks = Object.keys(s.byOffice || {}).filter(function (k) { return s.byOffice[k] > 0; });
    return ks.length ? ks.map(function (k) { return (officeName(k) || k) + ' ' + fm(s.byOffice[k]); }).join('・') : 'なし';
  }
  function personHtml(p) {
    var s = p.sum, rows = [];
    p.days.forEach(function (d) {
      var nt = d.note ? [d.note.early_ok ? '早出を認めた' : '', d.note.early_from ? '早出を ' + hm(d.note.early_from) + ' から認めた' : '', d.note.overtime_ok ? '残業を認めた' : '', d.note.ot_until ? '残業を ' + hm(d.note.ot_until) + ' まで認めた' : '', d.note.break_min != null ? '休憩を' + d.note.break_min + '分に' : '', d.note.note || ''].filter(Boolean).join('・') : '';
      var bl = d.blocks.length ? d.blocks : [null];
      bl.forEach(function (b, i) {
        rows.push('<tr><td>' + (i === 0 ? esc(md(d.date)) + '（' + wd(d.date) + '）' : '') + '</td><td>' + (b ? schedText(b) : (d.paidMin ? '有休' : '')) + '</td><td class="raw">' + (b ? esc(rawPunches(b)) : '') + '</td><td>' + (b ? countText(b) : '') + '</td><td class="num">' + (b ? b.breakMin : '') + '</td><td class="num">' + (b ? fm(b.workMin) : '') + '</td><td class="num">' + (b ? fm(b.nightMin) : '') + '</td><td>' + (b ? flagTags(b.flags, b.checked) : '') + (i === 0 && nt ? '<span class="tag">' + esc(nt) + '</span>' : '') + '</td>' +
          '<td class="no-print">' + (i === 0 ? '<button type="button" class="btn sm" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + d.date + '">直す</button>' : '') + '</td></tr>');
      });
    });
    return (s.warnings.length ? '<div class="band warn">' + s.warnings.map(esc).join('<br>') + '</div>' : '') +
      '<div class="kv"><span>出勤日数</span><b>' + s.workDays + ' 日（有休 ' + s.paidDays + ' 日・' + fm(s.paidMin) + '）</b><span>総労働</span><b>' + fm(s.workMin) + '（所定内 ' + fm(s.schedInMin) + '・残業 ' + fm(s.overtimeMin) + '・法定外 ' + fm(s.legalOverMin) + '・深夜 ' + fm(s.nightMin) + '）</b>' +
      '<span>休日労働</span><b>' + fm(s.holidayMin) + (month.config.legal_holiday == null ? '（法定休日を決めていないため数えていません）' : '') + '</b>' +
      '<span>事業所別の実働</span><b>' + esc(officeBreakdown(s)) + '</b>' +
      '<span>遅刻・早退</span><b>遅刻 ' + s.lateCount + ' 回 ' + fm(s.lateMin) + '・早退 ' + s.earlyLeaveCount + ' 回 ' + fm(s.earlyLeaveMin) + '</b><span>欠勤・打刻なし・要確認</span><b>欠勤 ' + s.absentDays + ' 日・打刻なし ' + s.noPunchDays + ' 日・要確認 ' + s.reviewCount + ' 件</b>' +
      '<span>数えなかった時間</span><b>' + fm(s.uncountedMin) + '（打刻のうち、予定に合わせた丸めで数えなかった分）</b></div>' +
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>日</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th class="num">深夜</th><th>印・直し</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">この月の予定・打刻はありません</td></tr>') + '</tbody></table></div>';
  }
  function paintPerson() {
    if (printAll) {
      /* 全員分の印刷（1人1ページ） */
      /* 休止中で記録の無い人は出さない */
      return month.people.filter(function (p) { return p.days.length || p.staff.active !== false; }).map(function (p) { return '<div class="pg">' + printHead(p.staff.name + ' さん') + '<div class="cd">' + personHtml(p) + '</div></div>'; }).join('');
    }
    if (!selStaff || !personOf(selStaff)) selStaff = month.people.length ? month.people[0].staff.staff_id : null;
    var sel = '<label>職員 <select id="g-staff">' + month.people.map(function (p) { return '<option value="' + esc(p.staff.staff_id) + '"' + (p.staff.staff_id === selStaff ? ' selected' : '') + '>' + esc(p.staff.name) + '</option>'; }).join('') + '</select></label>';
    var p = personOf(selStaff);
    if (!p) return '<div class="cd"><p class="empty">職員がいません。「職員と番号」でシフトから取り込んでください。</p></div>';
    return printHead(p.staff.name + ' さん') + '<div class="cd"><div class="row no-print">' + sel + '<button type="button" class="btn sm" data-act="addday">予定の無い日に打刻を足す</button><button type="button" class="btn sm" data-act="print">印刷</button><button type="button" class="btn sm" data-act="print-all">全員分を印刷（1人1ページ）</button></div>' +
      personHtml(p) + '</div>';
  }

  function paintStaff() {
    var list = (data.staff || []).slice().sort(function (a, b) { return (a.office || '') < (b.office || '') ? -1 : (a.office || '') > (b.office || '') ? 1 : (a.code < b.code ? -1 : 1); });
    var rows = list.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td>' + esc(officeName(s.office)) + '</td><td class="num"><b>' + esc(s.code) + '</b></td><td>' + esc(s.emp_code || '') + (s.emp_code ? '' : '<span class="tag rv">従業員コードなし</span>') + '</td><td>' + (s.active === false ? '<span class="tag">休止中</span>' : '') + '</td>' +
        '<td class="no-print"><button type="button" class="btn sm" data-act="recode" data-sid="' + esc(s.staff_id) + '"' + (isLocked() ? '' : '') + '>番号を振り直す</button></td></tr>';
    }).join('');
    var w = shiftInfo && shiftInfo.ok && shiftInfo.warnings.length ? '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">シフトの記号で気になる所</h2><div class="tw"><table><thead><tr><th>職員</th><th>日</th><th>内容</th></tr></thead><tbody>' +
      shiftInfo.warnings.map(function (x) { var s = (data.staff || []).filter(function (y) { return y.staff_id === x.staff_id; })[0]; return '<tr><td>' + esc(s ? s.name : x.staff_id) + '</td><td>' + esc(x.date) + '</td><td>' + esc(x.msg) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
    var printable = (data.staff || []).filter(function (s) { return s.active !== false; }).slice().sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    return printHead('打刻の番号') + '<div class="print-only"><h2>打刻の番号（本人にだけ伝えてください）</h2><table><thead><tr><th>番号</th><th>氏名</th></tr></thead><tbody>' +
      printable.map(function (s) { return '<tr><td>' + esc(s.code) + '</td><td>' + esc(s.name) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="cd no-print"><div class="row"><button type="button" class="btn sm" data-act="import">シフトから職員と予定を取り込む</button><button type="button" class="btn sm" data-act="print">番号の表を印刷（番号と名前だけ・休止中の人は出しません）</button></div>' +
      '<p class="help">打刻の番号は職員ごとに自動で振ります。タブレットではこの番号を入れて打刻します。番号は本人にだけ伝えてください。従業員コードはシフトアプリの職員の設定（freee の従業員コード）から取り込み、給与への出力に使います。シフトアプリで退職・休職・非表示にした人は「休止中」になり、タブレットで番号を入れても見つかりません。</p>' +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>主事業所</th><th class="num">打刻の番号</th><th>従業員コード</th><th>状態</th><th class="no-print"></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">まだ職員がいません。シフトから取り込んでください。</td></tr>') + '</tbody></table></div></div>' + (w ? '<div class="no-print">' + w + '</div>' : '');
  }

  /* ── 締めた時の控え（snapshot）と今の数字 ── */
  var SNAP_KEYS = ['workDays', 'paidDays', 'workMin', 'schedInMin', 'overtimeMin', 'legalOverMin', 'nightMin', 'lateCount', 'lateMin', 'earlyLeaveCount', 'earlyLeaveMin', 'noPunchDays', 'reviewCount', 'absentDays', 'paidMin', 'uncountedMin', 'holidayMin'];
  var SNAP_FILL = [['absentDays', '欠勤日数'], ['paidMin', '有休時間'], ['uncountedMin', '数えなかった時間'], ['holidayMin', '休日労働']];
  function snapRows() { return isLocked() && data.month.snapshot && Array.isArray(data.month.snapshot.rows) ? data.month.snapshot.rows : null; }
  function snapDiff() {
    var rows = snapRows(), out = [];
    if (!rows) return out;
    var byId = {}; rows.forEach(function (r) { byId[r.staff_id] = r; });
    month.people.forEach(function (p) {
      var r = byId[p.staff.staff_id];
      if (!r) { if (p.sum.workMin > 0 || p.sum.reviewCount > 0) out.push(p.staff.name); return; }
      if (SNAP_KEYS.some(function (k) { return typeof r[k] === 'number' && r[k] !== p.sum[k]; })) out.push(p.staff.name);
    });
    return out;
  }
  /* 控えから月の集計を作る（控えに無い列は今の計算で補う・控えに無い人は出さない） */
  function snapMonth() {
    var rows = snapRows(), byId = {}, people = [], miss = [], filled = {};
    rows.forEach(function (r) { byId[r.staff_id] = r; });
    month.people.forEach(function (p) {
      var r = byId[p.staff.staff_id];
      if (!r) { if (p.sum.workMin > 0) miss.push(p.staff.name); return; }
      var s = {}, st = {}, k;
      for (k in p.sum) s[k] = p.sum[k];
      for (k in r) if (k !== 'staff_id' && k !== 'emp_code' && r[k] != null) s[k] = r[k];
      SNAP_FILL.forEach(function (f) { if (r[f[0]] == null) filled[f[1]] = 1; });
      for (k in p.staff) st[k] = p.staff[k];
      if (r.emp_code) st.emp_code = r.emp_code;
      people.push({ staff: st, days: p.days, sum: s });
    });
    return { month: { ym: month.ym, config: month.config, people: people, totals: month.totals }, miss: miss, filled: Object.keys(filled) };
  }

  function paintClose() {
    var lk = isLocked(), afterLock = month.people.some(function (p) { return p.days.some(function (d) { return d.flags.indexOf('after_lock') >= 0; }); });
    var review = month.totals.reviewCount;
    var diff = lk ? snapDiff() : [];
    var nx = C.addDays(per().to, 1);
    var stop = !lk && notYet() ? '期間の末日を過ぎてから締められます（' + esc(perLabel()) + 'は ' + esc((+nx.slice(5, 7)) + '月' + (+nx.slice(8, 10)) + '日') + 'から締められます）。' :
      (!lk && shiftInfo && !shiftInfo.ok ? 'シフトを取り込めていないため、まだ締められません（' + esc(shiftInfo.why) + '）。上の「シフトを取り込み直す」を押してから締めてください。' : '');
    var h = printHead('締めと出力') + '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">月の締め</h2>' +
      (diff.length ? '<div class="band warn">締めた時の数字と今の数字が違う職員がいます（' + diff.map(esc).join('・') + '）。締めた後の打刻・計算の決まりの見直しなどが原因です。給与へ渡したのは締めた時の数字です（月の集計の CSV も締めた時の数字で出します）。</div>' : '') +
      (lk ? '<p>締めた日時: ' + esc(new Date(data.month.locked_at).toLocaleString('ja-JP')) + '</p>' + (afterLock ? '<div class="band warn">締めた後に足された打刻があります（印「締めた後の打刻」）。給与へ渡した後なら、来月の調整を検討してください。</div>' : '') +
        '<button type="button" class="btn ng" data-act="unlock"' + (isAdmin() ? '' : ' disabled') + '>締めを解除する（管理者）</button>' :
        (review ? '<div class="band warn">要確認が ' + review + ' 件残っています。締める前に「要確認」のタブで確かめてください（残ったままでも締められます）。</div>' : '<div class="band ok">要確認はありません。</div>') +
        (stop ? '<div class="band warn" role="status">' + stop + '</div>' : '') +
        '<button type="button" class="btn pri" data-act="lock"' + (stop ? ' disabled' : '') + '>この月を締める</button><p class="help">締める直前に月を読み直して数え直し、その数字を「締めた時の控え」としてデータベースに残します。締めると、この月の打刻の足し・取り消し・承認・休憩の直し・シフトの取り込みが止まります。タブレットの打刻は締めた後も記録され、「締めた後の打刻」の印が付きます。</p>') + '</div>';
    var hist = (data.month && Array.isArray(data.month.history)) ? data.month.history : [];
    if (hist.length) h += '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">締めと解除の記録</h2><div class="tw"><table><thead><tr><th>日時</th><th>した人</th><th>内容</th><th>理由</th></tr></thead><tbody>' +
      hist.slice().reverse().map(function (x) { return '<tr><td>' + esc(x && x.at ? new Date(x.at).toLocaleString('ja-JP') : '') + '</td><td>' + esc(x && x.by) + '</td><td>' + esc(x && x.action === 'unlock' ? '締めを解除した' : x && x.action === 'lock' ? '締めた' : (x && x.action) || '') + '</td><td>' + esc(x && x.reason) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    h += '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">給与計算への出力（CSV）</h2>' +
      '<div class="row"><label>文字コード <select id="g-enc"><option value="utf8">UTF-8（BOM 付き）</option><option value="sjis">Shift_JIS（Excel・古い給与ソフト）</option></select></label></div>' +
      '<div class="row"><button type="button" class="btn" data-act="csv-sum">月の集計（1人1行）</button><button type="button" class="btn" data-act="csv-day">日ごとの明細（1人1日1行）</button></div>' +
      '<p class="help">月の集計の列: ' + esc(C.SUMMARY_HEAD.concat(C.SUMMARY_EXTRA_HEAD).join('・')) + '・実働_（事業所ごと）。日ごとの明細の列: ' + esc(C.DAILY_HEAD.concat(C.DAILY_EXTRA_HEAD).join('・')) + '。前の版の列はそのままの順で、新しい列は後ろに足してあります。従業員コードの無い職員は出しません（出せなかった人は知らせます）。時間の書き方は「設定」で 8:30／8.50 を選べます。' +
      (lk ? '締めた月の「月の集計」は締めた時の控えから作ります（ファイル名に「締めた時の数字」と付きます）。日ごとの明細は今の数字です。' : '締める前の出力は下書きとして扱ってください（ファイル名に「締め前」と付きます）。') + '</p></div>';
    h += '<div class="cd pr-edits-cd"><div class="ph" style="display:none"></div><h2 style="font-size:16px;margin:0 0 8px">直しの履歴</h2><div class="row no-print"><button type="button" class="btn sm" data-act="print-edits">直しの履歴を印刷</button></div><div id="g-edits">' + (editsCache ? editsHtml(editsCache) : '<button type="button" class="btn sm" data-act="edits">この月の直しの履歴を見る</button>') + '</div></div>';
    return h;
  }
  var ACT_LABEL = { punch_add: '打刻を足した', punch_void: '打刻を取り消した', day_put: '承認・休憩・メモ・印', code_reset: '番号を振り直した', month_lock: '月を締めた', month_unlock: '締めを解除した', settings_put: '設定を変えた', schedule_put: 'シフトを取り込んだ' };
  function kindJa(k) { return k === 'in' ? '出勤' : k === 'out' ? '退勤' : '打刻'; }
  function brTxt(v) { return v == null ? '予定どおり' : String(v); }
  /* 直しの前後の値を「退勤 16:05 を足した」「休憩 60→45 分」「確認済みにした」のように言う（C-9） */
  function describe(e) {
    var a = e.after || {}, b = e.before || {}, parts = [];
    var when = function (v) { if (!v) return ''; var dd = C.jstDate(Date.parse(v)); return (e.work_date && dd !== e.work_date ? md(dd) + ' ' : '') + hm(v); };
    if (e.action === 'punch_add') return kindJa(a.kind) + ' ' + when(a.at) + ' を足した';
    if (e.action === 'punch_void') return kindJa(b.kind || a.kind) + ' ' + when(b.at || a.at) + ' を取り消した';
    if (e.action !== 'day_put') return ACT_LABEL[e.action] || e.action;
    if (!!b.early_ok !== !!a.early_ok) parts.push(a.early_ok ? '早出を全部認めた' : '早出の承認（全部）を外した');
    if (ms(b.early_from) !== ms(a.early_from)) parts.push(a.early_from ? '早出を ' + hm(a.early_from) + ' から認めた' : '早出の時刻（' + hm(b.early_from) + ' から）を外した');
    if (!!b.overtime_ok !== !!a.overtime_ok) parts.push(a.overtime_ok ? '残業を全部認めた' : '残業の承認（全部）を外した');
    if (ms(b.ot_until) !== ms(a.ot_until)) parts.push(a.ot_until ? '残業を ' + hm(a.ot_until) + ' まで認めた' : '残業の時刻（' + hm(b.ot_until) + ' まで）を外した');
    var bb = b.break_min == null ? null : b.break_min, ab = a.break_min == null ? null : a.break_min;
    if (bb !== ab) parts.push('休憩 ' + brTxt(bb) + '→' + brTxt(ab) + (ab == null ? '' : ' 分'));
    if ((b.note || '') !== (a.note || '')) parts.push(a.note ? 'メモ「' + a.note + '」' : 'メモを消した');
    var bm = b.day_mark || null, am = a.day_mark || null;
    if (bm !== am) parts.push(am === 'checked' ? '確認済みにした' : am === 'absent' ? '欠勤にした' : (bm === 'absent' ? '欠勤の印を外した' : '確認済みの印を外した'));
    return parts.join('・') || '変えた所なし';
  }
  function editsHtml(list) {
    if (!list.length) return '<p class="empty">この月の直しはありません。</p>';
    var nm = {}; (data.staff || []).forEach(function (s) { nm[s.staff_id] = s.name; });
    return '<div class="tw"><table class="hist"><thead><tr><th>日時</th><th>した人</th><th>職員</th><th>日</th><th>内容</th><th>理由</th></tr></thead><tbody>' + list.map(function (e) {
      return '<tr><td>' + esc(new Date(e.at).toLocaleString('ja-JP')) + '</td><td>' + esc(e.by) + '</td><td>' + esc(nm[e.staff_id] || e.staff_id || '') + '</td><td>' + esc(e.work_date || '') + '</td><td>' + esc(describe(e)) + '</td><td>' + esc(e.action === 'code_reset' ? '' : e.reason) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  var SET_FIELDS = [
    ['earlyAlertMin', '予定より早い出勤をこの分以上で要確認にする', '分'], ['overtimeAlertMin', '予定より遅い退勤をこの分以上で要確認にする', '分'],
    ['overtimeMonthWarnH', '月の法定外がこの時間以上で警告（36協定）', '時間'], ['weekStartDow', '週40時間を数える週の始まりの曜日（0＝日曜〜6＝土曜。下の「1か月単位の変形労働時間制」を使っていない時だけ使います）', '']
  ];
  function paintSettings() {
    var c = month.config;
    /* 締め日は今の設定から出す（締めた月分を開いている間の month.config は締めた時の控え。そのまま保存すると締め日が戻る） */
    var cdNow = C.fillConfig((data && data.settings && data.settings.config) || {}).close_day;
    var h = printHead('設定') + '<div class="cd"><p class="help">設定は事業者（法人）ごとに1つです。保存できるのは管理者（2段階認証まで済んだ人）だけです。' + (isAdmin() ? '' : '<b>いまのアカウントでは見るだけです。</b>') + '</p><form id="g-set" class="kv">';
    SET_FIELDS.forEach(function (f) { h += '<label for="s-' + f[0] + '">' + esc(f[1]) + '</label><span><input type="number" step="any" id="s-' + f[0] + '" value="' + esc(c[f[0]]) + '" style="width:7em"> ' + f[2] + '</span>'; });
    h += '<label for="s-closeDay">締め日（○月分の期間の終わり）</label><span><select id="s-closeDay"><option value="0"' + (cdNow ? '' : ' selected') + '>月末</option>' +
      Array.apply(null, Array(28)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (cdNow === i + 1 ? ' selected' : '') + '>' + (i + 1) + '日</option>'; }).join('') +
      '</select> 15日にすると「12月分」は 11/16〜12/15 です。締めた月分の期間は変わりません。変えると、次の締めていない月分は「前の月分の終わりの翌日〜新しい締め日」になります（切り替えの月分は短く・長くなります）。1か月単位の変形労働時間制の起算日は期間の初日です</span>';
    h += '<label for="s-variableMonth">1か月単位の変形労働時間制</label><span><input type="checkbox" id="s-variableMonth"' + (c.variableMonth ? ' checked' : '') + '> 使う（法定外＝その日の予定の実働と8時間の長い方を超えた分）</span>';
    h += '<label for="s-legal">法定休日（週に1日の休日）</label><span><select id="s-legal"><option value=""' + (c.legal_holiday == null ? ' selected' : '') + '>決めない（休日労働を数えない）</option>' +
      WD.map(function (w, i) { return '<option value="' + i + '"' + (c.legal_holiday === i ? ' selected' : '') + '>' + w + '曜日</option>'; }).join('') + '</select> この曜日に働いた時間を「休日労働」として分けて数え、法定外の残業には重ねません（就業規則で決めた曜日を選びます）</span>';
    h += '<label for="s-monthRound30">月の残業・深夜の合計の端数</label><span><input type="checkbox" id="s-monthRound30"' + (c.monthRound30 ? ' checked' : '') + '> 1時間未満を30分で四捨五入する（就業規則に定めがある時だけ）</span>';
    h += '<label for="s-csvTime">CSV の時間の書き方</label><span><select id="s-csvTime"><option value="hmm"' + (c.csvTime === 'hmm' ? ' selected' : '') + '>8:30</option><option value="dec"' + (c.csvTime === 'dec' ? ' selected' : '') + '>8.50</option></select></span>';
    h += '</form><div class="row"><button type="button" class="btn pri" data-act="save-set"' + (isAdmin() ? '' : ' disabled') + '>設定を保存する</button></div>' +
      '<p class="help">休憩の時間（日勤 ' + esc(c.breakH) + ' 時間・夜勤 ' + esc(c.nightBreakH) + ' 時間・拘束が ' + esc(c.breakThresholdH) + ' 時間を超えたら引く）はシフトアプリの設定を取り込んで使います（ここでは変えません）。丸めの決まり: 予定より早い出勤は予定の開始から、予定より遅い退勤は予定の終わりまで数えます。始業前・終業後に実際に働いた時は、その日を「直す」で早出・残業を認めてください（認めないまま切り捨てると賃金の未払いになります）。</p></div>';
    return h;
  }

  /* ── 窓（直す・日付を選ぶ・締めの確認・CSV の選び） ──
   * 中身と足もとは同じ1か所で入れる。noSave が真なら「閉じる」だけ。saveLabel・saveAct で主ボタンの文言と動きを替える */
  var dlgCtx = null;
  function openDlg(title, b, lk, saveLabel, saveAct) {
    $('g-dlg-h').textContent = title;
    $('g-dlg-b').innerHTML = b;
    $('g-dlg-f').innerHTML = '<button type="button" class="btn" data-act="dlg-close">閉じる</button>' + (lk ? '' : '<button type="button" class="btn pri" data-act="dlg-save">保存する</button>');
    var sv = $('g-dlg-f').querySelector('[data-act="dlg-save"]');
    if (sv && saveLabel) sv.textContent = saveLabel;
    if (sv && saveAct) sv.setAttribute('data-act', saveAct);
    var dl = $('g-dlg');
    if (!dl.open) { try { dl.showModal(); } catch (_) { dl.setAttribute('open', ''); } }
    var bd = $('g-dlg-b'); if (bd) bd.scrollTop = 0;
  }
  function addFootBtn(label, act, cls) {
    var x = mk('button', 'btn' + (cls ? ' ' + cls : ''), label); x.type = 'button'; x.setAttribute('data-act', act);
    $('g-dlg-f').appendChild(x); return x;
  }
  var REASONS = ['打刻忘れ・本人に確認', '業務の延長', '端末の不調', '欠勤の連絡あり', 'その他'];
  /* 漏れの種類に合わせて足す打刻を初めから選んでおく（予定の時刻を入れる） */
  function prefillOf(blk) {
    var out = [];
    if (!blk) return out;
    var at = function (k) { var v = k === 'in' ? blk.schedStart : blk.schedEnd; return v == null ? { kind: k, date: blk.work_date, time: '' } : { kind: k, date: C.jstDate(v), time: hm(v) }; };
    if (C.needsReview(blk) || !blk.checked) {
      if (blk.flags.indexOf('no_punch') >= 0) out.push(at('in'), at('out'));
      else if (blk.flags.indexOf('missing_out') >= 0) out.push(at('out'));
      else if (blk.flags.indexOf('missing_in') >= 0) out.push(at('in'));
    }
    return out;
  }
  function formState() {
    var bd = $('g-dlg-b'); if (!bd) return '';
    var v = [], els = bd.querySelectorAll('input,select');
    for (var i = 0; i < els.length; i++) { var e = els[i]; v.push(e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? '1' : '0') : e.value); }
    return v.join('\u0001');
  }
  function openEdit(sid, date, bi, rvIndex) {
    if (!month) return;
    var p = personOf(sid);
    var st = (data.staff || []).filter(function (s) { return s.staff_id === sid; })[0] || (p && p.staff) || { staff_id: sid, name: sid };
    var lo = C.jstMs(C.addDays(date, -1), 0), hi = C.jstMs(C.addDays(date, 2), 0);
    var ps = (data.punches || []).filter(function (x) { return x.staff_id === sid && Date.parse(x.at) >= lo && Date.parse(x.at) < hi; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); });
    var dn = (data.days || []).filter(function (x) { return x.staff_id === sid && x.work_date === date; })[0] || null;
    var d = p ? p.days.filter(function (x) { return x.date === date; })[0] : null;
    var blocks = d ? d.blocks : [];
    var blk = blocks[bi] || blocks.filter(function (x) { return C.needsReview(x); })[0] || blocks[0] || null;
    var firstB = blocks[0] || null, lastB = blocks.length ? blocks[blocks.length - 1] : null;
    var lk = isLocked();
    var counted = {}; blocks.forEach(function (x) { x.punches.forEach(function (q) { counted[q.id] = 1; }); });
    /* 早出の時刻はその日の最初の勤務の開始の日、残業の時刻は最後の勤務の終わりの日（夜勤は翌日）で読む */
    var earlyDate = dn && dn.early_from ? C.jstDate(Date.parse(dn.early_from)) : (firstB && firstB.schedStart != null ? C.jstDate(firstB.schedStart) : date);
    var otDate = dn && dn.ot_until ? C.jstDate(Date.parse(dn.ot_until)) : (lastB && lastB.schedEnd != null ? C.jstDate(lastB.schedEnd) : date);
    var firstIn = ps.filter(function (x) { return !x.voided_at && x.kind === 'in' && counted[x.id]; })[0];
    var lastOut = ps.filter(function (x) { return !x.voided_at && x.kind === 'out' && counted[x.id]; }).slice(-1)[0];
    var pre = lk ? [] : prefillOf(blk);
    var rv = rvIndex != null && rvIndex !== '' ? C.reviewList(month) : null;
    dlgCtx = { mode: 'edit', sid: sid, date: date, rev: dn ? dn.rev : 0, dn: dn, blk: blk, pre: pre, earlyDate: earlyDate, otDate: otDate, rv: rv ? { list: rv, i: +rvIndex } : null };
    var b = '';
    if (lk) b += '<div class="band ok">この月は締めてあるため直せません。</div>';
    if (blocks.length) b += '<p>' + blocks.map(function (x) { return schedText(x) + ' → 数えた ' + (countText(x) || '（なし）') + '・実働 ' + fm(x.workMin) + ' ' + flagTags(x.flags, x.checked); }).join('<br>') + '</p>';
    b += '<fieldset><legend>打刻（前日〜翌日・太字はこの日に数えた打刻）</legend>' + (ps.length ? '<div class="tw"><table class="plist"><tbody>' + ps.map(function (x) {
      var v = !!x.voided_at, pd = C.jstDate(Date.parse(x.at)), cls = counted[x.id] && !v ? 'p-cnt' : (pd !== date ? 'p-oth' : '');
      var side = pd < date ? '<span class="tag">前日</span>' : pd > date ? '<span class="tag">翌日</span>' : '';
      return '<tr class="' + cls + '"><td class="' + (v ? 'void' : '') + '">' + esc(md(pd)) + ' ' + hm(x.at) + ' ' + side + '</td><td class="' + (v ? 'void' : '') + '">' + (x.kind === 'in' ? '出勤' : '退勤') + '</td><td class="raw">' + (x.source === 'office' ? '事務所が足した' : x.source === 'offline' ? '控え（端末の時刻）' : 'タブレット') + (v ? '・取り消し: ' + esc(x.void_reason || '') : '') + '</td><td>' +
        (v || lk ? '' : '<label><input type="checkbox" data-void="' + esc(x.id) + '"> 取り消す</label>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="empty">打刻はありません</p>') + '</fieldset>';
    var addRow = function (n, sfx, p0) {
      var k = p0 ? p0.kind : '', dt = p0 ? p0.date : date, tm = p0 ? p0.time : '';
      return '<div class="row"><select id="e-kind' + sfx + '" aria-label="' + (n === 1 ? '足す打刻の種類' : '2つめの打刻') + '"><option value="">' + (n === 1 ? '足さない' : '2つめは足さない') + '</option><option value="in"' + (k === 'in' ? ' selected' : '') + '>出勤</option><option value="out"' + (k === 'out' ? ' selected' : '') + '>退勤</option></select>' +
        '<input type="date" id="e-date' + sfx + '" value="' + esc(dt) + '" aria-label="' + (n === 1 ? '日付' : '2つめの日付') + '"><input type="time" id="e-time' + sfx + '" value="' + esc(tm) + '" aria-label="' + (n === 1 ? '時刻' : '2つめの時刻') + '">' +
        '<button type="button" class="btn sm" data-act="sched-time" data-n="' + sfx + '"' + (blk && blk.sched ? '' : ' disabled') + '>予定の時刻を入れる</button></div>';
    };
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>打刻を足す</legend>' + (pre.length ? '<p class="help">漏れている打刻を、予定の時刻で入れてあります。本人に確かめた時刻に直してから保存してください。</p>' : '') +
      addRow(1, '', pre[0]) + addRow(2, '2', pre[1]) + '</fieldset>';
    var mark = dn && dn.day_mark || '';
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>この日の印</legend><div class="row" role="radiogroup" aria-label="この日の印">' +
      '<label><input type="radio" name="e-mark" value="checked"' + (mark === 'checked' ? ' checked' : '') + '> 確認済みにする（要確認から外す）</label>' +
      '<label><input type="radio" name="e-mark" value="absent"' + (mark === 'absent' ? ' checked' : '') + '> 欠勤にする（打刻なしを欠勤として数える）</label>' +
      '<label><input type="radio" name="e-mark" value=""' + (mark === '' ? ' checked' : '') + '> ' + (mark ? '印を外す' : '印なし') + '</label></div></fieldset>';
    var em = dn && dn.early_ok ? 'all' : (dn && dn.early_from ? 'from' : 'none'), om = dn && dn.overtime_ok ? 'all' : (dn && dn.ot_until ? 'until' : 'none');
    var eft = dn && dn.early_from ? hm(dn.early_from) : (firstIn ? hm(firstIn.at) : ''), out = dn && dn.ot_until ? hm(dn.ot_until) : (lastOut ? hm(lastOut.at) : '');
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>早出・残業の承認（この日）</legend>' +
      '<div class="row" role="radiogroup" aria-label="早出"><b>早出</b><label><input type="radio" name="e-em" value="none"' + (em === 'none' ? ' checked' : '') + '> 認めない（予定の開始から数える）</label>' +
      '<label><input type="radio" name="e-em" value="all"' + (em === 'all' ? ' checked' : '') + '> 全部認める（打刻どおり）</label>' +
      '<label><input type="radio" name="e-em" value="from"' + (em === 'from' ? ' checked' : '') + '> この時刻から認める</label><input type="time" id="e-early-from" value="' + esc(eft) + '" aria-label="早出を認める時刻（' + md(earlyDate) + '）"><span class="raw">（' + md(earlyDate) + '）</span></div>' +
      '<div class="row" role="radiogroup" aria-label="残業"><b>残業</b><label><input type="radio" name="e-om" value="none"' + (om === 'none' ? ' checked' : '') + '> 認めない（予定の終わりまで数える）</label>' +
      '<label><input type="radio" name="e-om" value="all"' + (om === 'all' ? ' checked' : '') + '> 全部認める（打刻どおり）</label>' +
      '<label><input type="radio" name="e-om" value="until"' + (om === 'until' ? ' checked' : '') + '> この時刻まで認める</label><input type="time" id="e-ot-until" value="' + esc(out) + '" aria-label="残業を認める時刻（' + md(otDate) + '）"><span class="raw">（' + md(otDate) + '）</span></div>' +
      '</fieldset>';
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>休憩・メモ（この日）</legend>' +
      '<div class="row"><label>休憩 <input type="number" id="e-break" min="0" max="600" style="width:6em" value="' + (dn && dn.break_min != null ? dn.break_min : '') + '"> 分（空＝予定どおり）</label></div>' +
      '<div class="row"><label style="flex:1">メモ <input type="text" id="e-note" maxlength="400" style="flex:1;min-width:16em" value="' + esc(dn && dn.note || '') + '"></label></div></fieldset>';
    b += '<div class="row"><label style="flex:1">理由（必ず）<input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:16em" placeholder="下のボタンで選ぶか、書いてください"' + (lk ? ' disabled' : '') + '></label></div>' +
      (lk ? '' : '<div class="presets" role="group" aria-label="よく使う理由">' + REASONS.map(function (r) { return '<button type="button" class="btn sm" data-act="reason" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>') +
      '<p class="help" id="e-msg" role="alert"></p>';
    b += '<fieldset><legend>この日の直しの履歴</legend><div id="e-hist"></div></fieldset>';
    openDlg(st.name + ' さん　' + md(date) + '（' + wd(date) + '）', b, lk);
    if (dlgCtx.rv && !lk) addFootBtn('保存して次へ', 'dlg-save-next', 'pri');
    dlgCtx.init = formState();
    fillHist(dlgCtx, ps);
  }
  /* 窓の下の、その日の直しの履歴（前後の値つき）。履歴は月ごとに1回読む */
  function fillHist(ctx, ps) {
    var box = $('e-hist'); if (!box) return;
    var ids = {}; ps.forEach(function (x) { ids[x.id] = 1; });
    var draw = function (list) {
      if (dlgCtx !== ctx || !$('e-hist')) return;
      box = $('e-hist'); box.textContent = '';
      var mine = list.filter(function (e) {
        if (e.staff_id !== ctx.sid) return false;
        if (e.action === 'punch_add' || e.action === 'punch_void') { var pr = e.after || e.before || {}; return !!ids[pr.id] || e.work_date === ctx.date; }
        return e.work_date === ctx.date;
      });
      if (!mine.length) { box.appendChild(mk('p', 'empty', 'この日の直しはまだありません。')); return; }
      var tb = mk('table', 'hist'), body = mk('tbody');
      mine.forEach(function (e) {
        var tr = mk('tr');
        tr.appendChild(mk('td', null, new Date(e.at).toLocaleString('ja-JP')));
        tr.appendChild(mk('td', null, describe(e)));
        tr.appendChild(mk('td', 'raw', (e.reason || '') + (e.by ? '（' + e.by + '）' : '')));
        body.appendChild(tr);
      });
      tb.appendChild(body); box.appendChild(tb);
    };
    if (editsCache) { draw(editsCache); return; }
    box.appendChild(mk('p', 'empty', '読み込んでいます…'));
    var my = gen;
    rpc('kintai_edits_get', { p_ym: ym }).then(okOr).then(function (r) { if (my !== gen) return; editsCache = r.edits || []; draw(editsCache); })['catch'](function (e) {
      note('直しの履歴', e); if (dlgCtx !== ctx || !$('e-hist')) return; var bx = $('e-hist'); bx.textContent = ''; bx.appendChild(mk('p', 'empty', '直しの履歴を読めませんでした: ' + msgOf(e)));
    });
  }
  function closeDlg() { dlgCtx = null; try { $('g-dlg').close(); } catch (_) { $('g-dlg').removeAttribute('open'); } }
  function dirty() {
    if (!dlgCtx || dlgCtx.mode !== 'edit' || dlgCtx.init == null) return false;
    return formState() !== dlgCtx.init;
  }
  function radioVal(name) { var e = document.querySelector('#g-dlg-b input[name="' + name + '"]:checked'); return e ? e.value : ''; }
  function isoAt(date, t) { return date + 'T' + t + ':00+09:00'; }
  function saveEdit(btn, goNext) {
    if (!dlgCtx || dlgCtx.mode !== 'edit' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg');
    var reason = ($('e-reason').value || '').trim();
    if (!reason) { msg.textContent = '理由を書いてください（下のボタンで選べます）。'; $('e-reason').focus(); return; }
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
    var nt = ($('e-note').value || '').trim();
    /* 早出・残業: 「全部認める」と「この時刻から／まで」は組で送る（両方が有効だと DB が断る） */
    var em = radioVal('e-em'), om = radioVal('e-om'), ef = null, ou = null;
    if (em === 'from') { var et = $('e-early-from').value; if (!/^\d{2}:\d{2}$/.test(et)) { msg.textContent = '早出を認める時刻を入れてください。'; return; } ef = isoAt(ctx.earlyDate, et); }
    if (om === 'until') { var ot2 = $('e-ot-until').value; if (!/^\d{2}:\d{2}$/.test(ot2)) { msg.textContent = '残業を認める時刻を入れてください。'; return; } ou = isoAt(ctx.otDate, ot2); }
    /* 時刻の鍵は、時刻を入れる時か今の時刻を外す時だけ送る（前後とも無い時は送らない＝0099 の前の DB でも「全部認める」は通る） */
    if ((em === 'all') !== !!dn.early_ok || ms(ef) !== ms(dn.early_from)) { patch.early_ok = em === 'all'; if (ef != null || dn.early_from != null) patch.early_from = ef; changed = true; }
    if ((om === 'all') !== !!dn.overtime_ok || ms(ou) !== ms(dn.ot_until)) { patch.overtime_ok = om === 'all'; if (ou != null || dn.ot_until != null) patch.ot_until = ou; changed = true; }
    if (br !== (dn.break_min == null ? null : dn.break_min)) { patch.break_min = br; changed = true; }
    if (nt !== (dn.note || '')) { patch.note = nt; changed = true; }
    var mark = radioVal('e-mark') || null;
    if (mark !== (dn.day_mark || null)) { patch.day_mark = mark; changed = true; }
    if (changed) ops.push({ f: 'kintai_day_put', a: { p_staff_id: ctx.sid, p_date: ctx.date, p_patch: patch, p_rev: ctx.rev, p_reason: reason } });
    if (!ops.length) { msg.textContent = '直す所がありません。'; return; }
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    var done = 0;
    var run = function () {
      if (done >= ops.length) return null;
      var o = ops[done];
      return rpc(o.f, o.a).then(okOr).then(function () { done++; return run(); });
    };
    run().then(function () {
      busy = false; closeDlg(); sync('保存しました'); toast('保存しました（' + nameOf(ctx.sid) + ' さん ' + md(ctx.date) + '）');
      return load(false).then(function () { if (goNext && ctx.rv) openNext(ctx); });
    })['catch'](function (e) {
      busy = false;
      note('直しの保存', e);
      if (done) {
        /* 一部だけ保存できた時は窓を閉じて読み直す（もう一度押して同じ打刻を足さない・版を新しくする・指摘8） */
        var m2 = msgOf(e) + '（' + ops.length + ' 件のうち ' + done + ' 件は保存しました。読み直したので、残りを直す時はもう一度開いてください）';
        closeDlg(); load(false); alert(m2);
      } else {
        restore();
        /* 窓が閉じていたら（保存中の Esc などで）画面の下の知らせで出す */
        if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = msgOf(e); else toast('保存できませんでした: ' + msgOf(e));
      }
    });
  }
  /* 「保存して次へ」: 保存の前の一覧で今の行より後ろにあった行のうち、読み直した後もまだ要確認の最初の行を開く */
  function openNext(ctx) {
    if (!month || dlgCtx) return;
    var now = C.reviewList(month), key = function (r) { return r.staffId + '|' + r.date; };
    var cur = ctx.sid + '|' + ctx.date, after = ctx.rv.list.slice(ctx.rv.i + 1).map(key);
    var idx = -1;
    for (var i = 0; i < after.length && idx < 0; i++) if (after[i] !== cur) for (var j = 0; j < now.length; j++) if (key(now[j]) === after[i]) { idx = j; break; }
    if (idx < 0) { toast(now.length ? '一覧の最後まで直しました（要確認は残り ' + now.length + ' 件）' : '要確認はありません。締めに進めます'); return; }
    openEdit(now[idx].staffId, now[idx].date, now[idx].blockIndex, idx);
  }
  /* 予定の無い日に打刻を足す（C-4: 窓の中の日付の入力欄） */
  function openAddDay() {
    var sid = selStaff; if (!sid || !month) return;
    var ds = dateList(), dv = selDate && ds.indexOf(selDate) >= 0 ? selDate : ds[0];
    dlgCtx = { mode: 'pick', sid: sid };
    openDlg(nameOf(sid) + ' さん　打刻を足す日', '<div class="row"><label>日付 <input type="date" id="e-pick" min="' + ds[0] + '" max="' + ds[ds.length - 1] + '" value="' + dv + '"></label></div><p class="help">予定の無い日でも打刻を足せます。日を選んで「この日を開く」を押すと、その日の直す窓が開きます。</p><p class="help" id="e-msg" role="alert"></p>', isLocked(), 'この日を開く', 'pick-open');
    try { $('e-pick').focus(); } catch (_) {}
  }
  function pickOpen() {
    if (!dlgCtx || dlgCtx.mode !== 'pick') return;
    var d = $('e-pick').value, sid = dlgCtx.sid;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !inPer(d)) { $('e-msg').textContent = 'この月分（' + perLabel() + '）の日を選んでください。'; return; }
    dlgCtx = null;
    openEdit(sid, d);
  }

  /* ── 職員・締め・出力・設定 ── */
  function recode(sid, btn) {
    if (busy) return;
    var s = (data.staff || []).filter(function (x) { return x.staff_id === sid; })[0];
    if (!s || !confirm(s.name + ' さんの打刻の番号を振り直します。今の番号 ' + s.code + ' はタブレットで使えなくなります。よろしいですか？')) return;
    busy = true; var restore = pressBusy(btn, '振り直しています…');
    rpc('kintai_staff_code_reset', { p_staff_id: sid }).then(okOr).then(function (r) {
      busy = false; alert('新しい番号は ' + r.code + ' です。本人にだけ伝えてください。'); return load(false);
    })['catch'](function (e) { busy = false; restore(); note('番号の振り直し', e); alert(msgOf(e)); });
  }
  /* 締める: 月を読み直して数え直し → 確認の窓（要確認の残り・人数・総労働）→ 「締める」でもう一度読み直して数え直し、
     窓に出した数字と同じ時だけ、その数字を控えにして締める（違えば締めずに窓を新しい数字で描き直す・C-8・審査の指摘2） */
  function lockFigures() {
    var t = month.totals;
    return { review: t.reviewCount, rvPeople: month.people.filter(function (p) { return p.sum.reviewCount > 0; }).length, people: month.people.length,
      worked: month.people.filter(function (p) { return p.sum.workMin > 0 || p.sum.paidMin > 0; }).length, workMin: t.workMin, absent: t.absentDays };
  }
  function sameFigures(a, b) { for (var k in a) if (a[k] !== b[k]) return false; return true; }
  function openLock(fig, changed) {
    dlgCtx = { mode: 'lock', fig: fig, ym: ym };
    openDlg(perLabel() + 'を締めます',
      (changed ? '<div class="band warn" role="alert">窓を開いた後に数字が変わったため、締めていません（' + esc(changed) + '）。新しい数字を確かめてから、もう一度「締める」を押してください。</div>' : '') +
      '<p>「締める」を押した時にもう一度読み直して数え直し、その数字を「締めた時の控え」にします。</p><div class="kv"><span>要確認の残り</span><b>' + fig.review + ' 件（' + fig.rvPeople + ' 人）</b><span>人数</span><b>' + fig.people + ' 人（働いた・有休のあった人 ' + fig.worked + ' 人）</b><span>総労働の合計</span><b>' + fm(fig.workMin) + '</b><span>欠勤の合計</span><b>' + fig.absent + ' 日</b></div>' +
      (fig.review ? '<div class="band warn" style="margin-top:10px">要確認が残っています。残ったまま締めると、その日はいまの数字（丸めた時刻）のまま給与へ渡ります。</div>' : '') +
      '<p class="help">締めた後は、この月の打刻の足し・取り消し・承認・休憩の直し・シフトの取り込みが止まります。解除できるのは管理者だけです。</p><p class="help" id="e-msg" role="alert"></p>', false, '締める', 'lock-go');
  }
  function lockMonth(btn) {
    if (busy || !month) return;
    if (notYet()) { toast(NG.notyet); return; }
    if (shiftInfo && !shiftInfo.ok) { toast('シフトを取り込めていないため、まだ締められません。'); return; }
    var my = ++gen; busy = true; sync('締める前に読み直しています…');
    var restore = pressBusy(btn, '読み直しています…');
    rpc('kintai_month_get', { p_ym: ym }).then(okOr).then(function (d) {
      if (my !== gen) return;
      busy = false; restore(); data = d; recompute(); sync('読み直しました（' + hm(Date.now()) + '）'); paint();
      if (isLocked()) { toast('この月はもう締めてあります。'); return; }
      openLock(lockFigures(), null);
    })['catch'](function (e) { if (my !== gen) return; busy = false; restore(); sync(''); note('締めの前の読み直し', e); alert(msgOf(e)); });
  }
  function lockGo(btn) {
    if (busy || !dlgCtx || dlgCtx.mode !== 'lock' || dlgCtx.ym !== ym) return;
    var shown = dlgCtx.fig, my = ++gen; busy = true;
    var restore = pressBusy(btn, '締めています…', $('g-dlg-f'));
    var fail = function (e, where) { busy = false; restore(); note(where, e); var m = $('e-msg'); if (m && $('g-dlg').open) m.textContent = msgOf(e); else toast(msgOf(e)); };
    rpc('kintai_month_get', { p_ym: ym }).then(okOr).then(function (d) {
      if (my !== gen) return;
      data = d; recompute(); paint();
      if (isLocked()) { busy = false; closeDlg(); toast('この月はもう締めてあります。'); return; }
      var now = lockFigures();
      if (!sameFigures(shown, now)) {
        busy = false;
        var diff = [];
        if (shown.review !== now.review || shown.rvPeople !== now.rvPeople) diff.push('要確認 ' + shown.review + '→' + now.review + ' 件');
        if (shown.people !== now.people || shown.worked !== now.worked) diff.push('人数 ' + shown.worked + '→' + now.worked + ' 人');
        if (shown.workMin !== now.workMin) diff.push('総労働 ' + fm(shown.workMin) + '→' + fm(now.workMin));
        if (shown.absent !== now.absent) diff.push('欠勤 ' + shown.absent + '→' + now.absent + ' 日');
        openLock(now, diff.join('・'));
        return;
      }
      return rpc('kintai_month_lock', { p_ym: ym, p_snapshot: C.snapshotOf(month) }).then(okOr).then(function () { busy = false; closeDlg(); toast('締めました'); return load(false); }, function (e) { fail(e, '締め'); });
    }, function (e) { if (my !== gen) return; fail(e, '締める時の読み直し'); });
  }
  function unlockMonth(btn) {
    if (busy) return;
    var r = prompt(perLabel() + ' の締めを解除します。理由を書いてください（直しの履歴に残ります）。');
    if (!r || !r.trim()) return;
    busy = true; var restore = pressBusy(btn, '解除しています…');
    rpc('kintai_month_unlock', { p_ym: ym, p_reason: r.trim() }).then(okOr).then(function () { busy = false; toast('締めを解除しました'); return load(true); })['catch'](function (e) { busy = false; restore(); note('締めの解除', e); alert(msgOf(e)); });
  }
  function nameOfOffice(d) { try { return window.SUFacility ? window.SUFacility.officeName(d) : d; } catch (_) { return d; } }
  function download(kind) {
    if (!month || busy) { alert('読み込みが終わってから書き出してください。'); return; }
    if (kind === 'sum' && snapRows()) {
      var diff = snapDiff();
      if (diff.length) {
        dlgCtx = { mode: 'csv' };
        openDlg('どちらの数字で出しますか', '<p>締めた時の数字と今の数字が違う職員がいます（' + diff.map(esc).join('・') + '）。</p><p>給与へ渡すのは、ふつうは<b>締めた時の数字</b>です。今の数字は、締めた後の打刻などを含んだ数字です。</p>', false, '締めた時の数字で出す', 'csv-snap');
        addFootBtn('今の数字で出す', 'csv-now');
        return;
      }
      writeCsv('sum', 'snap'); return;
    }
    writeCsv(kind, 'now');
  }
  function writeCsv(kind, from) {
    var src = month, extra = [], suffix;
    if (kind === 'sum' && from === 'snap') {
      var sm = snapMonth(); src = sm.month;
      if (sm.filled.length) extra.push('締めた時の控えに無い列（' + sm.filled.join('・') + '）は、今の計算で入れました。');
      if (sm.miss.length) extra.push('締めた時の控えに無い職員（' + sm.miss.join('・') + '）は出していません。');
      suffix = '_月の集計_締めた時の数字';
    } else suffix = kind === 'sum' ? '_月の集計' + (isLocked() ? '_今の数字' : '') : '_日ごと';
    var res = C.buildCsv(src, { nameOf: nameOfOffice, extraCols: true });
    var text = kind === 'sum' ? res.summary : res.daily, enc = ($('g-enc') || {}).value || 'utf8', blob, unknown = [];
    if (enc === 'sjis') {
      try { var sj = C.encodeSjis(text); blob = new Blob([sj.bytes], { type: 'text/csv' }); unknown = sj.unknown; }
      catch (e) { alert('この端末では Shift_JIS に変えられません。UTF-8 で書き出してください。'); return; }
    } else blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '勤怠_' + ym + suffix + (isLocked() ? '' : '_締め前') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    var w = res.warnings.slice().concat(extra);
    if (unknown.length) w.push('Shift_JIS に無い文字（' + unknown.join(' ') + '）は ? にしました。');
    if (w.length) alert('書き出しました。気をつける所:\n' + w.join('\n')); else toast('書き出しました（' + a.download + '）');
  }
  function loadEdits(then) {
    var my = gen;
    $('g-edits').innerHTML = '<p class="empty">読み込んでいます…</p>';
    skel($('g-edits'));
    rpc('kintai_edits_get', { p_ym: ym }).then(okOr).then(function (r) {
      if (my !== gen) return;
      editsCache = r.edits || [];
      if (tab === 'close' && $('g-edits')) $('g-edits').innerHTML = editsHtml(editsCache);
      if (then) then();
    })['catch'](function (e) { if (my !== gen) return; note('直しの履歴', e); var el = $('g-edits'); if (el) el.innerHTML = '<div class="band ng">' + esc(msgOf(e)) + '</div>'; });
  }
  function saveSettings(btn) {
    if (busy || !isAdmin()) return;
    var cfg = {}, bad = [];
    SET_FIELDS.forEach(function (f) { var v = $('s-' + f[0]).value; if (v === '') return; var n = +v; if (!isFinite(n)) bad.push(f[1]); else cfg[f[0]] = n; });
    if (bad.length) { alert('数で入れてください: ' + bad.join('、')); return; }
    cfg.close_day = +$('s-closeDay').value;
    cfg.variableMonth = $('s-variableMonth').checked; cfg.monthRound30 = $('s-monthRound30').checked; cfg.csvTime = $('s-csvTime').value;
    var lh = C.checkLegalHoliday($('s-legal').value);
    if (!lh.ok) { alert('法定休日の曜日を選び直してください。'); return; }
    cfg.legal_holiday = lh.value;
    var filled = C.fillConfig(cfg), dropped = [];
    for (var k in cfg) if (cfg[k] !== filled[k]) dropped.push(k);
    if (dropped.length) { alert('範囲の外の値があります。入れ直してください。'); return; }
    busy = true; var restore = pressBusy(btn, '保存しています…');
    rpc('kintai_settings_put', { p_config: cfg, p_rev: (data.settings && data.settings.rev) || 0 }).then(okOr).then(function () { busy = false; sync('設定を保存しました'); toast('設定を保存しました'); return load(false); })['catch'](function (e) { busy = false; restore(); note('設定の保存', e); alert(msgOf(e)); });
  }
  /* 印刷: 見出しの日時を入れ直してから印刷する。全員分・履歴だけの印刷は、印刷が終わったら（afterprint が来なくても）元の画面に戻す */
  function stampPrint() { var s = document.querySelectorAll('.ph-at'), t = nowText(); for (var i = 0; i < s.length; i++) s[i].textContent = t; }
  function doPrint() { stampPrint(); try { window.print(); } catch (e) { note('印刷', e); } }
  /* 画面を印刷の形に替えて刷り、終わったら戻す（全員分の印刷・直しの履歴の印刷・審査の指摘3）。
     戻すのは印刷が終わった知らせ（afterprint）で、print の直後には戻さない（print が待たずに返る端末＝Safari でも替えた形のまま刷られる）。
     afterprint が来ない時の保険として、印刷の窓を閉じた後の最初の操作（押す・キー）か、30秒後に戻す */
  var printUndo = null, paTimer = null;
  function paArm() { endPrint(); }
  function endPrint() {
    clearTimeout(paTimer); paTimer = null;
    document.removeEventListener('pointerdown', paArm, true); document.removeEventListener('keydown', paArm, true);
    var u = printUndo; printUndo = null;
    if (u) u();
  }
  function printThen(undo) {
    if (printUndo) endPrint();
    printUndo = undo;
    doPrint();
    if (printUndo !== undo) return;   /* print の間に afterprint が来て戻した */
    paTimer = setTimeout(endPrint, 30000);
    setTimeout(function () { if (printUndo !== undo) return; document.addEventListener('pointerdown', paArm, true); document.addEventListener('keydown', paArm, true); }, 0);
  }
  function printAllPeople() {
    if (!month || printAll) return;
    printAll = true; paint();
    printThen(function () { printAll = false; paint(); });
  }
  function printEdits() {
    var run = function () {
      var cd = document.querySelector('.pr-edits-cd'), ph = cd && cd.querySelector('.ph');
      if (ph) { ph.removeAttribute('style'); ph.textContent = ''; ph.appendChild(mk('b', null, corpName() + '　勤怠 ' + perLabel())); ph.appendChild(document.createTextNode('　直しの履歴　印刷した日時: ')); ph.appendChild(mk('span', 'ph-at', nowText())); }
      document.body.classList.add('pr-edits');
      printThen(function () { document.body.classList.remove('pr-edits'); if (ph) ph.setAttribute('style', 'display:none'); });
    };
    if (editsCache) run(); else loadEdits(run);
  }

  /* ── 操作 ── */
  function setTab(t) { if (TABS.indexOf(t) < 0) t = 'day'; tab = t; lsSet(LS_TAB, t); paint(); }
  function setYm(v) { if (!C.isYm(v) || v === ym) return; ym = v; lsSet(LS_YM, v); $('g-ym').value = v; shiftInfo = null; editsCache = null; data = null; month = null; paintPer(); load(true); }
  function moveDay(n) {
    var d = C.addDays(selDate || C.jstDate(Date.now()), n);
    selDate = d;
    if (!inPer(d)) setYm(ymFor(d)); else paint();
  }
  function bind() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var t = b.getAttribute('data-tab');
      if (t) { setTab(t); return; }
      var a = b.getAttribute('data-act');
      if (!a) return;
      if (a === 'edit') openEdit(b.getAttribute('data-sid'), b.getAttribute('data-date'), b.hasAttribute('data-bi') ? +b.getAttribute('data-bi') : null, b.getAttribute('data-rv'));
      else if (a === 'person') { selStaff = b.getAttribute('data-sid'); setTab('person'); }
      else if (a === 'dlg-close') { if (!dirty() || confirm('保存していない直しがあります。閉じますか？')) closeDlg(); }
      else if (a === 'dlg-save') saveEdit(b, false);
      else if (a === 'dlg-save-next') saveEdit(b, true);
      else if (a === 'pick-open') pickOpen();
      else if (a === 'lock-go') lockGo(b);
      else if (a === 'csv-snap' || a === 'csv-now') { closeDlg(); writeCsv('sum', a === 'csv-snap' ? 'snap' : 'now'); }
      else if (a === 'reason') {
        var r = b.getAttribute('data-r'), inp = $('e-reason');
        if (inp) { if (r !== 'その他') inp.value = r; else if (REASONS.indexOf(inp.value) >= 0) inp.value = ''; inp.focus(); }
      }
      else if (a === 'sched-time') {
        var sfx = b.getAttribute('data-n') || '', blk = dlgCtx && dlgCtx.blk;
        if (!blk || !blk.sched) return;
        var ks = $('e-kind' + sfx); if (!ks.value) ks.value = sfx ? 'out' : 'in';
        var v = ks.value === 'in' ? blk.schedStart : blk.schedEnd;
        $('e-date' + sfx).value = C.jstDate(v); $('e-time' + sfx).value = hm(v);
      }
      else if (a === 'addday') openAddDay();
      else if (a === 'recode') recode(b.getAttribute('data-sid'), b);
      else if (a === 'import') { if (isLocked()) alert('締めた月は取り込めません。'); else load(true); }
      else if (a === 'lock') lockMonth(b);
      else if (a === 'unlock') unlockMonth(b);
      else if (a === 'csv-sum') download('sum');
      else if (a === 'csv-day') download('day');
      else if (a === 'edits') loadEdits();
      else if (a === 'save-set') saveSettings(b);
      else if (a === 'print') doPrint();
      else if (a === 'print-all') printAllPeople();
      else if (a === 'print-edits') printEdits();
      else if (a === 'dayf') { var f = b.getAttribute('data-f') || null; dayFilter = dayFilter === f ? null : f; paint(); }
      else if (a === 'day-move') moveDay(+b.getAttribute('data-n'));
      else if (a === 'day-today') { var td = C.jstDate(Date.now()); selDate = td; if (!inPer(td)) setYm(ymFor(td)); else paint(); }
    });
    document.addEventListener('change', function (e) {
      var id = e.target && e.target.id;
      if (id === 'g-date') { selDate = e.target.value; paint(); }
      else if (id === 'g-staff') { selStaff = e.target.value; paint(); }
      else if (id === 'g-only') { onlyReview = e.target.checked; paint(); }
      else if (id === 'g-office') { officeFilter = e.target.value; paint(); }
      else if (id === 'g-ym') setYm(e.target.value);
      else if (e.target && e.target.name === 'e-mark' && dlgCtx && dlgCtx.mode === 'edit' && e.target.value) {
        /* 確認済み・欠勤を選んだら、初めから入れておいた打刻は足さない（手で直した所は残す） */
        [['', 0], ['2', 1]].forEach(function (x) {
          var p0 = dlgCtx.pre[x[1]], ks = $('e-kind' + x[0]);
          if (p0 && ks && ks.value === p0.kind && $('e-date' + x[0]).value === p0.date && $('e-time' + x[0]).value === p0.time) ks.value = '';
        });
      }
    });
    document.addEventListener('input', function (e) {
      var id = e.target && e.target.id, r;
      if (id === 'e-early-from') r = document.querySelector('#g-dlg-b input[name="e-em"][value="from"]');
      else if (id === 'e-ot-until') r = document.querySelector('#g-dlg-b input[name="e-om"][value="until"]');
      if (r) r.checked = true;
    });
    $('g-prev').addEventListener('click', function () { setYm(C.prevYm(ym)); });
    $('g-next').addEventListener('click', function () { setYm(C.nextYm(ym)); });
    $('g-import').addEventListener('click', function () { if (isLocked()) alert('締めた月は取り込めません。'); else load(true); });
    $('g-reload').addEventListener('click', function () { load(false); });
    /* 保存中（busy）は Esc でも閉じない（審査の指摘1） */
    $('g-dlg').addEventListener('cancel', function (e) { if (busy) { e.preventDefault(); return; } if (dirty() && !confirm('保存していない直しがあります。閉じますか？')) e.preventDefault(); else dlgCtx = null; });
    window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('storage', function (e) { if (e.key === 'su_device_role' && isField()) location.reload(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted && isField()) location.reload(); });
    window.addEventListener('beforeprint', stampPrint);
    window.addEventListener('afterprint', endPrint);
    /* 日ごと・要確認を開いている間は1分ごとに手元で数え直す（勤務中・まだ出勤していないは時刻で変わる。読み直しはしない） */
    setInterval(function () {
      if (view !== 'app' || busy || !month || dlgCtx || printAll || (tab !== 'day' && tab !== 'review')) return;
      if (document.visibilityState === 'hidden') return;
      var ae = document.activeElement;
      if (ae && ae.tagName === 'SELECT' && $('g-main').contains(ae)) return;
      recompute(); paint();
    }, 60000);
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
      autoYm = !C.isYm(y);
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
