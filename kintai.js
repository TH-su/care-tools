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
 * ・v4（2026-11-20 凍結した仕様書 ROOT-v4-master-leave.md）: 「職員と番号」に職員マスタとの突き合わせ（kintai_master_import・手で結ぶ・打刻画面に出す/出さない）、
 *   「勤務時間を手で入れる」窓（今の事務所の打刻 kintai_punch_add と休憩 kintai_day_put を順に呼ぶ・K6）、「有給」のタブ（計算は kintai-leave.js）。
 *   職員マスタ・有給の読み込みは、そのタブを開いた時に別に読む（読めなくても月の画面は止めない）。端末に残すのは今までどおりタブと月だけ
 */
(function () {
  'use strict';
  var C = window.KintaiCalc, L = window.KintaiLeave;
  var TABS = ['day', 'review', 'grid', 'person', 'staff', 'leave', 'close', 'settings'];
  var LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym';
  var gen = 0, view = 'boot', tab = 'day', ym = null, data = null, month = null, shiftInfo = null;
  var selDate = null, selStaff = null, onlyReview = false, role = null, busy = false, editsCache = null;
  /* v2: 日ごとの札の絞り込み（working / notin / review / absent）・事業所の絞り込み・全員分の印刷（どれも端末に残さない） */
  var dayFilter = null, officeFilter = '', printAll = false;
  /* v4: 職員マスタの一覧・突き合わせの結果・有給の記録（どれも画面の中だけ・端末に残さない） */
  var masterSt = null, masterBusy = false, importResult = null, leaveSt = null, leaveBusy = false, leaveGen = 0;
  /* v5 1-5: 勤怠の管理者の名簿（管理者の時だけ読む・画面の中だけ・端末に残さない） */
  var mgrSt = null, mgrBusy = false, mgrGen = 0;
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
  /* 「今日」で向けた月（'YYYY-MM'）。前に開いた月分が無く今月で開いた時と「今日」を押した時だけ入れ、その月を読んだ時だけ使う
     （期間が今日を過ぎていれば次の月分へ移る）。手で月を選んだら消す＝追い越された読み込み・失敗の後に、手で選んだ月から勝手に進まない（見直し2） */
  var autoYm = null;

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
    closeday: '締めた月分と期間が重なるため、締め日を変えられません。',
    periodchanged: 'この月分の期間が、画面を開いた後に変わりました（締め日の変更など）。読み直してから、もう一度締めてください。',
    toolong: '表示名は60字までです。',
    dup: 'その職員マスタの人は、もう別の職員と結んであります（同じ日の有休の使用も1つまでです）。読み直してから確かめてください。', baddays: '日数の形が違います（使用は 1日か半日・付与は 0.5〜40 日）。',
    nomaster: '職員マスタにその人が見つかりませんでした。職員マスタを読み直してください。', masterrow: '職員マスタから足した職員には、別の職員マスタの人を結べません。',
    master: '職員マスタから足した人には、別の職員マスタの人を結べません。', badnote: 'メモが長すぎます（200字まで）。',
    linked: 'その職員マスタの人は、もう勤怠の職員と結んであります。読み直してください。', exists: 'その職員マスタの人は、もう勤怠の職員として足してあります。読み直してください。',
    retired: '職員マスタで退職日を過ぎているため足せません。', retire_unknown: '職員マスタの退職日が読めないため足せません。職員マスタの退職日を確かめてください。',
    badid: '職員マスタの番号の形が勤怠に入りません。管理者に知らせてください。', badname: '職員マスタの氏名が空か長すぎるため足せません。職員マスタを確かめてください。',
    payrolllocked: 'この月分の給与が確定（または書き出し済み）のため、締めを解除できません。先に給与の画面で確定を取り消してください。' };   /* v5 1-2（文は仮置き） */
  /* 有給の窓では、打刻向けの言い方の断り（badkind・badvalue）を有給の言葉に替える */
  var NG_LEAVE = { badkind: '付与の種類が違います（移行の残りか、手で足すかを選んでください）。', badvalue: '入れた値を受け付けられませんでした（日数・週の所定日数・時間・メモの長さを確かめてください）。',
    locked: 'その日は締めた月分に入っているため、足すことも取り消すこともできません。直す時は管理者が締めを解除してください。',
    dup: 'その日の有休の使用はもう入っています（同じ人・同じ日は1つまで）。直す時は、今の使用を取り消してから足してください。' };
  function leaveMsg(e) { return e && e.kintai && NG_LEAVE[e.kintai] ? NG_LEAVE[e.kintai] : msgOf(e); }
  /* v5 1-5: 勤怠の管理者の名簿の窓では、名簿の言葉の断りに替える（exists・notfound・badvalue は NG に別の意味の文があるので分ける・文は仮置き） */
  var NG_MGR = { notallowed: 'このアカウントは足せません。足せるのは、許可リストにある使える状態の事務所のアカウントだけです（現場・止めたアカウント・写し返し専用・管理者の役割は足せません）。',
    exists: 'この人はもう勤怠の管理者に載っています。読み直してください。', notfound: 'この人は勤怠の管理者に載っていません。読み直してください。',
    payroll: 'この人は給与の名簿に載っているため外せません（給与の画面が勤怠を読めなくなります）。', badvalue: 'メールアドレスの形が違います。', reason: '理由を書いてください。' };
  function mgrMsg(e) { return e && e.kintai && NG_MGR[e.kintai] ? NG_MGR[e.kintai] : msgOf(e); }
  function friendly(e) {
    var code = e && e.code, m = String((e && e.message) || e || '');
    if (code === '42501' || /permission denied/i.test(m)) return 'この操作をする権限がありません（勤怠の管理は、管理者と許された事務所のアカウントだけが使えます。締めの解除と設定の保存は管理者だけです）。';
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
      if (autoYm && autoYm === ym) { autoYm = null; if (C.jstDate(Date.now()) > per().to) { busy = false; my = -1; setYm(C.nextYm(ym)); return; } }
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
      /* 職員の並び（入職順）に職員マスタの入職日を使うので、まだ読んでいなければ裏で読む（読めない時は番号の順のまま） */
      if (!masterSt && !masterBusy) loadMaster();
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
    /* 職員の並びは「職員と番号」の表と同じ入職順（staffSorted・2026-11-20 代表者の指示）。日ごと・要確認・月の一覧・個人の月の選択肢はこの並びになる */
    month = C.computeMonth({ ym: ym, period: data.period, staff: staffSorted(), schedule: data.schedule || [], punches: data.punches || [], days: data.days || [], leave_uses: data.leave_uses, config: cfg, lockedAt: data.month && data.month.locked_at, now: Date.now() });
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
    var f = { day: paintDay, review: paintReview, grid: paintGrid, person: paintPerson, staff: paintStaff, leave: paintLeave, close: paintClose, settings: paintSettings }[tab];
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
  function schedText(b) { return b.sched ? esc(b.symbol) + ' ' + hm(b.schedStart) + '〜' + hm(b.schedEnd) + srcTag(b.staff_id, b.work_date) : '<span class="raw">予定なし</span>' + ((schedEditOf(b.staff_id, b.work_date) || {}).off ? srcTag(b.staff_id, b.work_date) : ''); }
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
      if (!d.blocks.length && d.paidMin && !dayFilter && (!officeFilter || p.staff.office === officeFilter)) rows.push('<tr><td>' + esc(dispName(p.staff)) + '</td><td>' + esc(officeName(p.staff.office)) + '</td><td>有休</td><td></td><td></td><td class="num"></td><td class="num">' + fm(0) + '</td><td></td><td></td></tr>');
      d.blocks.forEach(function (b, bi) {
        if (officeFilter && b.office !== officeFilter) return;
        var k = kindsOf(b);
        for (var key in cnt) if (k[key]) cnt[key]++;
        if (dayFilter && !k[dayFilter]) return;
        rows.push('<tr><td>' + esc(dispName(p.staff)) + '</td><td>' + esc(officeName(b.office)) + '</td><td>' + schedText(b) + '</td><td class="raw">' + esc(rawPunches(b)) + '</td><td>' + countText(b) + '</td><td class="num">' + b.breakMin + '</td><td class="num">' + fm(b.workMin) + '</td><td>' + flagTags(b.flags, b.checked) + '</td>' +
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
      officeSelect() + '<button type="button" class="btn sm" data-act="print">この日を印刷</button><button type="button" class="btn sm" data-act="work-open">勤務時間を手で入れる</button><button type="button" class="btn sm" data-act="sched-open">出勤予定を直す・入れる</button></div>' + chips +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>事業所</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th>印</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">' + (dayFilter || officeFilter ? '絞り込みに当たる人はいません' : 'この日の予定・打刻はありません') + '</td></tr>') + '</tbody></table></div>' +
      '<p class="help">「数えた時刻」は予定に合わせて丸めた時刻です（予定より早い出勤は予定の開始、予定より遅い退勤は予定の終わり）。打刻はそのまま残っています。早出・残業を認める時は「直す」から。「出勤中」は退勤の時刻がまだ来ていない人で、要確認には数えません。この画面は1分ごとに数え直します。</p></div>';
  }

  /* 要確認の一覧（v2・C-2）: 月の要確認を日付順に1列 */
  function nameOf(sid) { var p = personOf(sid); return p ? dispName(p.staff) : sid; }
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
      return '<tr><td class="nm"><button type="button" class="btn sm" data-act="person" data-sid="' + esc(p.staff.staff_id) + '">' + esc(dispName(p.staff)) + '</button></td>' + ds.map(function (x) {
        var d = by[x];
        if (!d) return '<td></td>';
        var rvb = d.blocks.filter(function (b) { return C.needsReview(b); });
        var rv = rvb.length > 0, np = rvb.some(function (b) { return b.flags.some(function (f) { return RED[f]; }); }), wk = d.blocks.some(function (b) { return b.working; });
        var txt = d.workMin ? fm(d.workMin) : (d.paidMin ? '有' : (d.absent ? '欠' : (np ? '✕' : (wk ? '勤' : ''))));
        return '<td class="' + (np ? 'np' : rv ? 'rv' : wk ? 'wk' : '') + '"><button type="button" class="btn sm" style="min-height:32px;padding:0 4px;border:0;background:none;color:inherit" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + x + '" aria-label="' + esc(dispName(p.staff) + ' ' + x + ' を直す') + '">' + txt + '</button></td>';
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
      '<div class="kv"><span>出勤日数</span><b>' + s.workDays + ' 日（有休 ' + s.paidDays + ' 日・' + fm(s.paidMin) + '）</b><span>総労働</span><b>' + fm(s.workMin) + '（所定内（法定内） ' + fm(s.schedInMin) + '・残業 ' + fm(s.overtimeMin) + '・法定外 ' + fm(s.legalOverMin) + '・深夜 ' + fm(s.nightMin) + '）</b>' +
      '<span>休日労働</span><b>' + fm(s.holidayMin) + (month.config.legal_holiday == null ? '（法定休日を決めていないため数えていません）' : '') + '</b>' +
      '<span>事業所別の実働</span><b>' + esc(officeBreakdown(s)) + '</b>' +
      '<span>遅刻・早退</span><b>遅刻 ' + s.lateCount + ' 回 ' + fm(s.lateMin) + '・早退 ' + s.earlyLeaveCount + ' 回 ' + fm(s.earlyLeaveMin) + '</b><span>欠勤・打刻なし・要確認</span><b>欠勤 ' + s.absentDays + ' 日・打刻なし ' + s.noPunchDays + ' 日・要確認 ' + s.reviewCount + ' 件</b>' +
      '<span>数えなかった時間</span><b>' + fm(s.uncountedMin) + '（打刻のうち、予定に合わせた丸めで数えなかった分）</b></div>' +
      /* v5 1-1（2026-11-20・文は仮置き）: 画面の所定内（schedInMin）と CSV の「所定内」（総労働−残業）は中身が違うので、名前と注記で取り違えを無くす（画面だけ） */
      '<p class="help no-print">所定内（法定内）は、予定のうち法定の1日8時間・週40時間の中で働いた時間です（法定外・休日労働は含みません）。CSV の「所定内」は予定どおり働いた時間（総労働−残業）で、法定外になった分も含みます。</p>' +
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>日</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th class="num">深夜</th><th>印・直し</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">この月の予定・打刻はありません</td></tr>') + '</tbody></table></div>';
  }
  function paintPerson() {
    if (printAll) {
      /* 全員分の印刷（1人1ページ） */
      /* 休止中で記録の無い人は出さない */
      return month.people.filter(function (p) { return p.days.length || p.staff.active !== false; }).map(function (p) { return '<div class="pg">' + printHead(dispName(p.staff) + ' さん') + '<div class="cd">' + personHtml(p) + '</div></div>'; }).join('');
    }
    if (!selStaff || !personOf(selStaff)) selStaff = month.people.length ? month.people[0].staff.staff_id : null;
    var sel = '<label>職員 <select id="g-staff">' + month.people.map(function (p) { return '<option value="' + esc(p.staff.staff_id) + '"' + (p.staff.staff_id === selStaff ? ' selected' : '') + '>' + esc(dispName(p.staff)) + '</option>'; }).join('') + '</select></label>';
    var p = personOf(selStaff);
    if (!p) return '<div class="cd"><p class="empty">職員がいません。「職員と番号」でシフトから取り込んでください。</p></div>';
    return printHead(dispName(p.staff) + ' さん') + '<div class="cd"><div class="row no-print">' + sel + '<button type="button" class="btn sm" data-act="addday">予定の無い日に打刻を足す</button><button type="button" class="btn sm" data-act="work-open">勤務時間を手で入れる</button><button type="button" class="btn sm" data-act="sched-open">出勤予定を直す・入れる</button><button type="button" class="btn sm" data-act="fx-open" data-sid="' + esc(p.staff.staff_id) + '">前提の時間</button><button type="button" class="btn sm" data-act="print">印刷</button><button type="button" class="btn sm" data-act="print-all">全員分を印刷（1人1ページ）</button></div>' +
      personHtml(p) + '</div>';
  }

  /* 「職員と番号」の表だけは従業員コードの順（2026-11-20 代表者の指示）。従業員コードの無い人は後ろに、入職順（staffSorted）のまま */
  function staffByEmp() {
    return staffSorted().map(function (s, i) { return { s: s, i: i }; }).sort(function (x, y) {
      var a = x.s.emp_code || '', b = y.s.emp_code || '';
      if (!!a !== !!b) return a ? -1 : 1;
      if (a && b && a !== b) { var c = a.localeCompare(b, 'ja', { numeric: true }); if (c) return c; }
      return x.i - y.i;
    }).map(function (x) { return x.s; });
  }
  /* 職員マスタの職員No から決まった番号（統合 0108: 0＋職員No）。振り直しても変わらないのでボタンを出さない */
  function fixedCode(s) { return !!(s && s.master_id && /^0[0-9]{3,5}$/.test(String(s.code || ''))); }
  function paintStaff() {
    var list = staffByEmp();
    var rows = list.map(function (s) {
      return '<tr><td>' + esc(dispName(s)) + (s.display_name ? '<br><span class="raw">シフトの名前：' + esc(s.name) + '</span>' : '') + '</td><td>' + esc(officeName(s.office)) + '</td><td class="num"><b>' + esc(s.code) + '</b></td><td>' + esc(s.emp_code || '') + (s.emp_code ? '' : '<span class="tag rv">従業員コードなし</span>') + '</td><td>' + (s.active === false ? '<span class="tag">休止中</span>' : '') + '</td>' +
        staffMasterCells(s) +
        '<td class="no-print">' + (fixedCode(s) ? '' : '<button type="button" class="btn sm" data-act="recode" data-sid="' + esc(s.staff_id) + '">番号を振り直す</button>') + '<button type="button" class="btn sm" data-act="dname" data-sid="' + esc(s.staff_id) + '">表示名を変える</button><button type="button" class="btn sm" data-act="fx-open" data-sid="' + esc(s.staff_id) + '">前提の時間</button>' + staffMasterBtns(s) + '</td></tr>';
    }).join('');
    var w = shiftInfo && shiftInfo.ok && shiftInfo.warnings.length ? '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">シフトの記号で気になる所</h2><div class="tw"><table><thead><tr><th>職員</th><th>日</th><th>内容</th></tr></thead><tbody>' +
      shiftInfo.warnings.map(function (x) { var s = (data.staff || []).filter(function (y) { return y.staff_id === x.staff_id; })[0]; return '<tr><td>' + esc(s ? dispName(s) : x.staff_id) + '</td><td>' + esc(x.date) + '</td><td>' + esc(x.msg) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
    var printable = list.filter(function (s) { return s.active !== false; });   /* 表と同じ従業員コードの順（2026-11-20） */
    return printHead('打刻の番号') + '<div class="print-only"><h2>打刻の番号（本人にだけ伝えてください）</h2><table><thead><tr><th>番号</th><th>氏名</th></tr></thead><tbody>' +
      printable.map(function (s) { return '<tr><td>' + esc(s.code) + '</td><td>' + esc(dispName(s)) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      masterHtml() +
      '<div class="cd no-print"><div class="row"><button type="button" class="btn sm" data-act="import">シフトから職員と予定を取り込む</button><button type="button" class="btn sm" data-act="print">番号の表を印刷（番号と名前だけ・休止中の人は出しません）</button></div>' +
      '<p class="help">打刻の番号は、職員マスタと結んだ人は職員マスタの職員No の頭に 0 を付けた番号（職員No 001 なら 0001）です。結んでいない人・職員No の無い人には自動で番号を振ります。タブレットではこの番号を入れて打刻します。番号は本人にだけ伝えてください。従業員コードはシフトアプリの職員の設定（freee の従業員コード）から取り込み、頭の A を抜いた4桁（A001 なら 0001）にして給与への出力に使います。この表は従業員コードの順です。シフトアプリで退職・休職・非表示にした人は「休止中」になり、タブレットで番号を入れても見つかりません。</p>' +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>主事業所</th><th class="num">打刻の番号</th><th>従業員コード</th><th>状態</th><th>元</th><th>職員マスタ</th><th>打刻画面</th><th class="no-print"></th></tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="empty">まだ職員がいません。シフトから取り込んでください。</td></tr>') + '</tbody></table></div></div>' + (w ? '<div class="no-print">' + w + '</div>' : '');
  }

  /* ── v4: 職員マスタとの結び付け（K1〜K5）と有給のタブ（L1〜L9）──
   * 読むのはタブを開いた時だけ（kintai_master_list・kintai_leave_get）。失敗はその中だけで知らせ、月の画面は止めない */
  var NEED_DB = 'この機能は、共通のデータベースの更新（職員マスタと有給の仕組み）の後に使えます。管理者に知らせてください。';
  var masterP = null;
  function today() { return C.jstDate(Date.now()); }
  function ymdJa(d) { return d && L && L.isDate(d) ? (+d.slice(0, 4)) + '/' + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
  function dayTxt(n) { return n === 0.5 ? '半日' : String(n) + ' 日'; }
  function staffById(sid) { return (data && data.staff || []).filter(function (s) { return s.staff_id === sid; })[0] || null; }
  /* 0111: 出勤予定の手直し（sched_edits）・前提（fixed・sched_fixed_days）。古い DB では鍵が無い＝どれも空 */
  function schedEditOf(sid, date) { return (data && Array.isArray(data.sched_edits) ? data.sched_edits : []).filter(function (e) { return e.staff_id === sid && e.work_date === date; })[0] || null; }
  function isFixedDay(sid, date) { return (data && Array.isArray(data.sched_fixed_days) ? data.sched_fixed_days : []).some(function (x) { return x.staff_id === sid && x.work_date === date; }); }
  function srcTag(sid, date) {
    var e = schedEditOf(sid, date);
    if (e) return ' <span class="tag no-print">' + (e.off ? '手直し（休み）' : '手直し') + '</span>';
    return isFixedDay(sid, date) ? ' <span class="tag no-print">前提</span>' : '';
  }
  function fixedOf(sid) { return (data && Array.isArray(data.fixed) ? data.fixed : []).filter(function (f) { return f.staff_id === sid; }); }
  var WD_ORDER = [1, 2, 3, 4, 5, 6, 0];   /* 月〜日の順に並べる（鍵は 0＝日〜6＝土） */
  function weekTxt(w) {
    if (!w) return '前提なし';
    return WD_ORDER.map(function (i) { var x = w[String(i)]; return WD[i] + ' ' + (x && x.start ? x.start + '〜' + x.end + (x.break_min ? '（休憩' + x.break_min + '分）' : '') : '休み'); }).join('・');
  }
  function ymdSl(d) { return d ? String(d).replace(/-/g, '/') : ''; }
  /* 勤怠で出す名前（2026-11-20 代表者の指示・統合 0107）: 画面で直した表示名があればそれ、無ければシフトの名前。
     シフトの名前（name）は取り込みのたびに上書きされるので、直すのは表示名（display_name）だけ。取り込みに送り返す名前は name のまま */
  function dispName(s) { return s ? String(s.display_name || s.name || s.staff_id || '') : ''; }
  /* 職員の並び（2026-11-20 代表者の指示「事業所は無視して入職順に」）: 事業所に関係なく、結んだ職員マスタの入職日の古い順。
     有給の設定の入職日の上書きは並びに使わない（有給の記録を読んだかどうかで並びが変わらないように・反証レビュー）。
     入職日の分からない人（職員マスタと結んでいない派遣など・職員マスタをまだ読んでいない時）は最後に、打刻の番号の順で並べる */
  function hireDateOf(s) {
    var m = masterOf(s);
    return L ? L.hireOf(m && m.hire_date, null) : null;
  }
  function staffSorted() {
    return (data && data.staff || []).map(function (s) { return { s: s, h: hireDateOf(s) }; }).sort(function (x, y) {
      var a = x.s, b = y.s;
      if (x.h && y.h && x.h !== y.h) return x.h < y.h ? -1 : 1;
      if (!!x.h !== !!y.h) return x.h ? -1 : 1;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    }).map(function (x) { return x.s; });
  }
  function srcOf(s) { return s && s.source === 'master' ? 'master' : 'shift'; }
  /* 結んだ職員マスタの id（DB の master_id だけを見る。m_ の名前から読まない） */
  function masterIdOf(s) { return s && s.master_id ? String(s.master_id) : null; }   /* 外した m_ の行は master_id が空（休止）＝結んでいない */
  function masterOf(s) { var id = masterIdOf(s); return id && masterSt && masterSt.byId ? masterSt.byId[id] || null : null; }
  function inService(m) { return !!m && (!m.retire_date || m.retire_date >= today()); }
  var REORDER_TABS = { day: 1, review: 1, grid: 1, person: 1, staff: 1, leave: 1 };
  function loadMaster() {
    if (masterBusy && masterP) return masterP;
    masterBusy = true;
    masterP = rpc('kintai_master_list', {}).then(okOr).then(function (r) {
      var rows = Array.isArray(r.rows) ? r.rows.filter(function (m) { return m && typeof m.master_id === 'string'; }) : [], by = {};
      rows.forEach(function (m) { by[m.master_id] = m; });
      masterSt = { rows: rows, byId: by };
    })['catch'](function (e) {
      note('職員マスタの読み込み', e);
      masterSt = { rows: [], byId: {}, err: noDb(e) ? NEED_DB : msgOf(e) };
    }).then(function () {
      masterBusy = false; masterP = null;
      /* 入職日は職員マスタから読むので、読めたら月の並びを数え直す（どのタブでも・2026-11-20） */
      /* 描き直すのは職員の並びを出すタブだけ（締め・設定のタブでは入力中の値を描き直しで消さない・審査役の指摘 2026-11-20） */
      if (!busy && data && !(masterSt && masterSt.err)) recompute();
      if (view === 'app' && !busy && REORDER_TABS[tab]) paint();
    });
    return masterP;
  }
  function linkedMap() { var o = {}; (data && data.staff || []).forEach(function (s) { var id = masterIdOf(s); if (id) o[id] = s; }); return o; }
  function staffMasterCells(s) {
    var ok = masterSt && !masterSt.err, m = masterOf(s), id = masterIdOf(s);
    var mc = !ok ? '' : (m ? esc(m.name) + (inService(m) ? '' : '<span class="tag">退職</span>') : (id ? '<span class="tag">' + esc(id) + '</span>' : '<span class="tag rv">結んでいない</span>'));
    return '<td>' + (srcOf(s) === 'master' ? '職員マスタ' : 'シフト') + '</td><td>' + mc + '</td><td>' + (s.clock_visible === false ? '<span class="tag">出さない</span>' : '出す') + '</td>';
  }
  function staffMasterBtns(s) {
    if (!masterSt || masterSt.err) return '';
    return (srcOf(s) === 'master' ? '' : '<button type="button" class="btn sm" data-act="m-link" data-sid="' + esc(s.staff_id) + '">' + (s.master_id ? '結び直す' : '職員マスタと結ぶ') + '</button>') +
      '<button type="button" class="btn sm" data-act="m-vis" data-sid="' + esc(s.staff_id) + '">' + (s.clock_visible === false ? '打刻画面に出す' : '打刻画面に出さない') + '</button>';
  }
  function masterHtml() {
    var h = '<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 8px">職員マスタとの突き合わせ</h2>';
    if (!masterSt) { if (!masterBusy) loadMaster(); return h + '<p class="empty">職員マスタを読んでいます…</p></div>'; }
    if (masterSt.err) return h + '<div class="band warn" role="status">' + esc(masterSt.err) + '</div><div class="row"><button type="button" class="btn sm" data-act="m-reload">職員マスタを読み直す</button></div></div>';
    /* 雇用区分は職員マスタの既定の呼び名で出す（staff-master-calc.js の ENUMS.employmentType と同じ・知らない値はそのまま） */
    var EMP_JA = { regular: '正社員', contract: '契約社員', part: 'パート', officer: '役員兼使用人', temp: '臨時' };
    var lm = linkedMap();
    /* 打刻画面に出さない人（シフトに仮で入れた枠など・2026-11-20 代表者の指示）は、結べていない一覧に出さない（件数だけ下に添える） */
    var unS0 = staffSorted().filter(function (s) { return s.active !== false && srcOf(s) === 'shift' && !s.master_id; });
    var unS = unS0.filter(function (s) { return s.clock_visible !== false; }), unHid = unS0.length - unS.length;
    var unM = masterSt.rows.filter(function (m) { return inService(m) && !lm[m.master_id]; });
    h += '<div class="row"><button type="button" class="btn sm pri" data-act="m-import">職員マスタと突き合わせる</button><button type="button" class="btn sm" data-act="m-reload">職員マスタを読み直す</button></div>' +
      '<p class="help">「職員マスタと突き合わせる」を押すと、氏名（空白を除く）がシフトの職員と職員マスタで1人ずつだけ同じ人を結び、職員マスタで退職日を過ぎた人（職員マスタから足した人）を休止にします。同じ名前が2人以上いる人は取り違えないよう自動では結びません。結べなかった職員マスタの人は、下の表で1人ずつ「シフトの職員に結ぶ」か「新しい職員として足す」を選びます（退職日が空か今日より後の人・休職中も含む）。シフトから来た人の名前・事業所・休止はシフトの取り込みのまま変えません。</p>';
    if (importResult) h += '<div class="band ok" role="status">前回の突き合わせ: 結んだ ' + esc(importResult.linked || 0) + ' 人・休止にした ' + esc(importResult.deactivated || 0) + ' 人</div>';
    h += '<div class="tw"><table class="mt"><thead><tr><th>職員マスタと結べていないシフトの職員（' + unS.length + ' 人）</th><th></th></tr></thead><tbody>' +
      (unS.length ? unS.map(function (s) { return '<tr><td>' + esc(dispName(s)) + '</td><td><button type="button" class="btn sm" data-act="m-link" data-sid="' + esc(s.staff_id) + '">職員マスタと結ぶ</button></td></tr>'; }).join('') : '<tr><td colspan="2" class="empty">ありません</td></tr>') + '</tbody></table></div>' +
      (unHid ? '<p class="help">打刻画面に出さない ' + unHid + ' 人（シフトに仮で入れた枠など）は、この一覧に出していません。職員マスタと結ぶ時は、下の職員の表の「職員マスタと結ぶ」から結べます。</p>' : '') +
      '<div class="tw" style="margin-top:8px"><table class="mt"><thead><tr><th>勤怠と結べていない職員マスタの人（' + unM.length + ' 人）</th><th>入職日</th><th>雇用形態</th><th></th></tr></thead><tbody>' +
      (unM.length ? unM.map(function (m) { return '<tr><td>' + esc(m.name) + '</td><td data-l="入職日">' + esc(ymdJa(m.hire_date)) + '</td><td data-l="雇用形態">' + esc(EMP_JA[m.employment_type] || m.employment_type || '') + '</td>' +
        '<td><button type="button" class="btn sm" data-act="m-link-m" data-mid="' + esc(m.master_id) + '">シフトの職員に結ぶ</button><button type="button" class="btn sm" data-act="m-add" data-mid="' + esc(m.master_id) + '">新しい職員として足す</button></td></tr>'; }).join('') : '<tr><td colspan="4" class="empty">ありません</td></tr>') + '</tbody></table></div>' +
      (unM.length ? '<p class="help">シフトに同じ人がいれば「シフトの職員に結ぶ」、シフトに載らない人は「新しい職員として足す」を選びます。足した人は勤怠の職員になり、打刻画面の名簿にも出ます（出さない時は、足した後に「打刻画面に出さない」）。</p>' : '') + '</div>';
    return h;
  }

  /* 有給の記録: kintai_leave_get（設定・付与・手で入れた使用）と、シフトの有休の日（月分ごとに kintai_month_get を読んで computeMonth で数える）。
     シフトの日は「来月分・今月分・前の月分」から前へ、予定も手入力の使用も無い月分に当たるまで（最大24か月分）読む（仮置き: DB に通しで読む口が無いため） */
  function monthCfg(d) {
    var cfg = {}, k, sc = (d.settings && d.settings.config) || {}, snap = d.month && d.month.locked_at && d.month.snapshot && d.month.snapshot.config;
    var src = snap || sc; for (k in src) cfg[k] = src[k];
    return cfg;
  }
  function monthFor(y, d) {
    return C.computeMonth({ ym: y, period: d.period, staff: d.staff || [], schedule: d.schedule || [], punches: d.punches || [], days: d.days || [], leave_uses: d.leave_uses, config: monthCfg(d), lockedAt: d.month && d.month.locked_at, now: Date.now() });
  }
  /* さかのぼる下限の月: 職員のいちばん早い入職日の月（入職日が分からない人がいれば24か月前）。24か月より前へは行かない */
  function leaveFloorYm(lg) {
    var cur = todayYm(), floor = cur, i, prof = {};
    for (i = 0; i < 24; i++) floor = C.prevYm(floor);
    (Array.isArray(lg && lg.profiles) ? lg.profiles : []).forEach(function (p) { if (p && p.staff_id) prof[p.staff_id] = p; });
    var hires = (data && data.staff || []).filter(function (s) { return s.active !== false; }).map(function (s) { var m = masterOf(s); return L.hireOf(m && m.hire_date, prof[s.staff_id]); });
    if (!hires.length || hires.some(function (h) { return !h; })) return floor;
    var h0 = hires.sort()[0].slice(0, 7);
    return h0 > floor ? h0 : floor;
  }
  function loadLeaveMonths(my, lg) {
    var cur = todayYm(), out = [], floor = leaveFloorYm(lg);
    var get = function (y) { return rpc('kintai_month_get', { p_ym: y }).then(okOr); };
    /* 今月分と前の月分は必ず読み、その後は下限の月まで（最大24か月分）。予定も手入力の使用も無い月分が3つ続いたら止める（仮置き）。
       速さのため、来月分と前へさかのぼる月分を同時に読む（2026-11-20 総点検）。一度に読む数は「あと何か月分の空で止まるか」（3−続いた空の数）までにするので、
       読む月分・止まる所・結果は1本ずつ順に読んだ時とまったく同じ（空が3つ続く所の先は読まない）。止める決まり（上の2つ）は前と同じ順で当てる */
    var ys = [], y0 = cur, n0;
    for (n0 = 0; n0 <= 24; n0++) { ys.push(y0); var p0 = C.prevYm(y0); if (n0 >= 24 || p0 < floor) break; y0 = p0; }
    var nextP = get(C.nextYm(cur)).then(function (d) { return monthFor(C.nextYm(cur), d); });
    var past = [], stop = false, emptyRun = 0;
    var batch = function (i) {
      if (my !== leaveGen || stop || i >= ys.length) return Promise.resolve();
      var part = ys.slice(i, i + (3 - emptyRun));
      return Promise.all(part.map(get)).then(function (ds) {
        if (my !== leaveGen) return;
        for (var k = 0; k < ds.length && !stop; k++) {
          var n = i + k, d = ds[k];
          past.push(monthFor(part[k], d));
          emptyRun = !(d.schedule || []).length && !(d.leave_uses || []).length ? emptyRun + 1 : 0;
          if (!(n < 24 && n + 1 < ys.length && (n < 1 || emptyRun < 3))) stop = true;
        }
        return batch(i + part.length);
      });
    };
    return Promise.all([nextP, batch(0)]).then(function (r) { out.push(r[0]); past.forEach(function (m) { out.push(m); }); return out; });
  }
  function loadLeave(force) {
    var my = ++leaveGen, keep = leaveSt && !leaveSt.err && !force ? leaveSt.months : null;
    leaveBusy = true;
    var mp = masterSt && !masterSt.err ? Promise.resolve() : loadMaster();
    return rpc('kintai_leave_get', {}).then(okOr).then(function (lg) {
      /* さかのぼる下限に入職日を使うので、職員マスタを読み終えてから月分を読む */
      return (keep ? Promise.resolve(keep) : mp.then(function () { return loadLeaveMonths(my, lg); })).then(function (months) { return { lg: lg, months: months }; });
    }).then(function (x) {
      if (my !== leaveGen) return;
      var prof = {};
      (Array.isArray(x.lg.profiles) ? x.lg.profiles : []).forEach(function (p) { if (p && p.staff_id) prof[p.staff_id] = p; });
      var manual = Array.isArray(x.lg.uses) ? x.lg.uses : [];
      leaveSt = { profiles: prof, grants: Array.isArray(x.lg.grants) ? x.lg.grants : [], manual: manual, uses: L.usesFromMonth(x.months, manual), months: x.months };
    })['catch'](function (e) {
      if (my !== leaveGen) return;
      note('有給の読み込み', e);
      leaveSt = { err: noDb(e) ? NEED_DB : '有給の記録を読めませんでした: ' + msgOf(e) };
    }).then(function () { return mp; }).then(function () {
      if (my !== leaveGen) return;
      leaveBusy = false;
      if (view === 'app' && tab === 'leave' && !busy) paint();
      if (dlgCtx && dlgCtx.mode === 'leave' && $('g-dlg').open) openLeave(dlgCtx.sid);
    });
  }
  function leaveOf(s) {
    var prof = leaveSt.profiles[s.staff_id] || null, m = masterOf(s);
    var grants = leaveSt.grants.filter(function (g) { return g && g.staff_id === s.staff_id; });
    var uses = leaveSt.uses.filter(function (u) { return u.staff_id === s.staff_id; });
    return { s: s, m: m, prof: prof, grants: grants, uses: uses, sm: L.summary({ hireDate: m && m.hire_date, profile: prof, grants: grants, uses: uses, asOf: today() }), needWeekly: L.needsWeekly(m && m.employment_type, prof) };
  }
  function obTag(ob) {
    if (ob.state === 'none') return '<span class="raw">対象外</span>';
    if (ob.state === 'ok') return '<span class="tag ok">5日に届いた</span>';
    var t = ob.ended ? '5日に届かずに期間が終わりました（' + ymdJa(ob.end) + ' まで）' : 'あと ' + ob.need + ' 日（' + ymdJa(ob.end) + ' まで）';
    return '<span class="tag ' + (ob.state === 'red' ? 'ng' : 'rv') + '">' + esc(t) + '</span>';
  }
  function paintLeave() {
    var h = printHead('有給') + '<div class="cd">';
    if (!L) return h + '<div class="band ng" role="alert">有給の計算の部品を読み込めませんでした。ページを読み込み直してください。</div></div>';
    if (!leaveSt) { if (!leaveBusy) loadLeave(false); return h + '<p class="empty">有給の記録を読んでいます…（シフトの有休の日を月ごとに読むため、少し時間がかかります）</p></div>'; }
    if (leaveSt.err) return h + '<div class="band warn" role="status">' + esc(leaveSt.err) + '</div><div class="row no-print"><button type="button" class="btn sm" data-act="lv-reload">読み直す</button></div></div>';
    var list = staffSorted().filter(function (s) { return s.active !== false || leaveSt.profiles[s.staff_id] || leaveSt.grants.some(function (g) { return g && g.staff_id === s.staff_id && !g.voided_at; }); });
    var rows = list.map(function (s) {
      var x = leaveOf(s), sm = x.sm, b = sm.balance, p = x.prof || {};
      var hire = sm.hire ? esc(ymdJa(sm.hire)) + (p.hire_date ? '<span class="tag">設定で上書き</span>' : '') : '<span class="tag rv">入職日が分かりません</span>';
      var wk = p.weekly_days != null ? esc(String(+p.weekly_days)) + ' 日' + (p.weekly_hours != null ? '・' + esc(String(+p.weekly_hours)) + ' 時間' : '') : (x.needWeekly ? '<span class="tag rv">週の所定日数が未設定</span>' : '<span class="raw">—</span>');
      if (sm.proportional) wk += '<span class="tag">比例付与</span>';
      if (sm.openingMissing) hire += '<span class="tag rv">移行日が未設定</span>';
      var nx = sm.next ? esc(ymdJa(sm.next.grant_date)) + '　' + esc(String(sm.next.days)) + ' 日' + (sm.next.status === 'skip' ? '<span class="tag">付与しない</span>' : '') : '<span class="raw">—</span>';
      var rem = '<b>' + esc(String(b.remain)) + ' 日</b>' + (b.over ? '<span class="tag ng">付与の無い使用 ' + esc(String(b.over)) + ' 日</span>' : '') + (b.planned ? '<span class="raw">（この先の予定 ' + esc(String(b.planned)) + ' 日）</span>' : '');
      var soon = b.soon ? esc(String(b.soon.days)) + ' 日（' + esc(ymdJa(b.soon.expires)) + ' まで）' : '<span class="raw">—</span>';
      var ob = sm.obligation;
      return '<tr><td>' + esc(dispName(s)) + '</td><td>' + hire + '</td><td>' + wk + '</td><td>' + nx + '</td><td class="num">' + rem + '</td><td>' + soon + '</td><td class="num">' + (ob.state === 'none' ? '<span class="raw">—</span>' : esc(String(ob.used)) + ' 日') + '</td><td>' + obTag(ob) + '</td>' +
        '<td class="no-print"><button type="button" class="btn sm" data-act="lv-open" data-sid="' + esc(s.staff_id) + '">開く</button></td></tr>';
    }).join('');
    return h + '<div class="row no-print"><b>有給（' + esc(ymdJa(today())) + ' 時点）</b><button type="button" class="btn sm" data-act="lv-reload">読み直す</button><button type="button" class="btn sm" data-act="print">印刷</button></div>' +
      '<p class="help no-print">付与は入職日（職員マスタ。「開く」の設定で上書きできます）の6か月後に10日、その後1年ごとに 11・12・14・16・18・20日です。週の所定日数が4日以下で週30時間未満の人は、設定に両方を入れると比例付与で数えます。期限は付与日から2年で、使う時は古い付与から減らします。使用はシフトの有休の日と、手で入れた使用（同じ日に両方ある時は手入力の方）を数えます。年5日は、10日以上を付与した日から1年の間の使用で、届かずに期限まで60日を切ると赤、それより前は黄色です。出勤率（8割）の判定はしていません（満たさない年は設定で「付与しない」を選びます）。</p>' +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>入職日</th><th>週の所定</th><th>次の付与</th><th class="num">残り</th><th>期限の近い分</th><th class="num">今の付与からの使用</th><th>年5日</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9" class="empty">職員がいません。</td></tr>') + '</tbody></table></div></div>';
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
      if (!r) { if (p.sum.workMin > 0 || p.sum.reviewCount > 0) out.push(dispName(p.staff)); return; }
      if (SNAP_KEYS.some(function (k) { return typeof r[k] === 'number' && r[k] !== p.sum[k]; })) out.push(dispName(p.staff));
    });
    return out;
  }
  /* 控えから月の集計を作る（控えに無い列は今の計算で補う・控えに無い人は出さない） */
  function snapMonth() {
    var rows = snapRows(), byId = {}, people = [], miss = [], filled = {};
    rows.forEach(function (r) { byId[r.staff_id] = r; });
    month.people.forEach(function (p) {
      var r = byId[p.staff.staff_id];
      if (!r) { if (p.sum.workMin > 0) miss.push(dispName(p.staff)); return; }
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
  /* 直しの履歴（kintai_edits）の action の言い方。DB の勤怠の移行（0098〜0112）が書く action は全部ここに置く（内部の名前のまま出さない・v5 1-3・試験 kintai_edits_label_test） */
  var ACT_LABEL = { sched_set: '予定を直した', sched_off: '予定を休みにした', sched_clear: '予定の手直しを外した', fixed_put: '前提の時間を入れた', fixed_void: '前提の時間を取り消した', display_name: '表示名を変えた', punch_add: '打刻を足した', punch_void: '打刻を取り消した', day_put: '承認・休憩・メモ・印', code_reset: '番号を振り直した', code_fixed: '打刻の番号を職員No に合わせた', month_lock: '月を締めた', month_unlock: '締めを解除した', settings_put: '設定を変えた', schedule_put: 'シフトを取り込んだ',
    master_import: '職員マスタと突き合わせた', master_add: '職員マスタから職員を足した', staff_link: '職員マスタとの結び付けを直した', clock_visible: '打刻画面に出す・出さないを変えた',
    leave_profile: '有給の設定を変えた', leave_grant_add: '有給の付与を足した', leave_grant_void: '有給の付与を取り消した', leave_use_add: '有休の使用を足した', leave_use_void: '有休の使用を取り消した',
    managers_add: '勤怠の管理者に足した', managers_remove: '勤怠の管理者から外した' };
  function nOf(v) { var n = +v; return isFinite(n) ? n : null; }
  function daysJa(v) { var n = nOf(v); return n == null ? '' : n === 0.5 ? '半日' : String(n) + '日'; }
  function lenOf(v) { return Array.isArray(v) ? v.length : (nOf(v) || 0); }
  /* 空の値（null・undefined・''・[]・{}・'{}'）は全部「無し」とみなす（初めての設定の保存は前の値が null・後は既定の [] や null になるため・反証レビュー 2026-11-20） */
  function blankV(v) { return v == null || v === '' || v === '{}' || (Array.isArray(v) ? !v.length : (typeof v === 'object' && !Object.keys(v).length)); }
  function numOrNil(v) { if (blankV(v)) return null; var n = +v; return isFinite(n) ? n : null; }
  function valOrNil(v) { return blankV(v) ? null : v; }
  /* 有給の設定（leave_profile）の前後で変わった所だけを言う */
  function profTxt(b, a) {
    var parts = [], same = function (x, y) { return JSON.stringify(x) === JSON.stringify(y); };
    var bh = valOrNil(b.hire_date), ah = valOrNil(a.hire_date), bo = valOrNil(b.opening_date), ao = valOrNil(a.opening_date);
    var bd = numOrNil(b.weekly_days), ad = numOrNil(a.weekly_days), bw = numOrNil(b.weekly_hours), aw = numOrNil(a.weekly_hours);
    var bs = valOrNil(b.skip_grants), as = valOrNil(a.skip_grants);
    if (!same(bh, ah)) parts.push(ah ? '入職日の上書きを ' + ymdSl(ah) + ' にした' : '入職日の上書きを外した');
    if (bd !== ad) parts.push(ad != null ? '週の所定日数を ' + ad + '日にした' : '週の所定日数を外した');
    if (bw !== aw) parts.push(aw != null ? '週の所定時間を ' + aw + '時間にした' : '週の所定時間を外した');
    if (!same(bo, ao)) parts.push(ao ? '移行日を ' + ymdSl(ao) + ' にした' : '移行日を外した');
    if (!same(bs, as)) parts.push(as ? '付与しない日を ' + lenOf(as) + ' 件にした' : '付与しない日を外した');
    return parts.length ? '有給の設定: ' + parts.join('・') : ACT_LABEL.leave_profile;
  }
  /* 履歴の理由の列。理由の無い口が action の名前を理由に入れた行（番号の振り直し・メモの無い付与と使用）は空にする（一覧と日の窓で同じ判定） */
  function reasonText(e) { return !e || e.reason == null || e.reason === e.action ? '' : String(e.reason); }
  /* 日の「直す」窓の履歴の1行（日時・内容・理由（した人））の文字 */
  function histCells(e) { return [new Date(e.at).toLocaleString('ja-JP'), describe(e), reasonText(e) + (e.by ? '（' + e.by + '）' : '')]; }
  function kindJa(k) { return k === 'in' ? '出勤' : k === 'out' ? '退勤' : '打刻'; }
  function brTxt(v) { return v == null ? '予定どおり' : String(v); }
  /* 直しの前後の値を「退勤 16:05 を足した」「休憩 60→45 分」「確認済みにした」のように言う（C-9） */
  function describe(e) {
    var a = e.after || {}, b = e.before || {}, parts = [];
    var when = function (v) { if (!v) return ''; var dd = C.jstDate(Date.parse(v)); return (e.work_date && dd !== e.work_date ? md(dd) + ' ' : '') + hm(v); };
    if (e.action === 'punch_add') return kindJa(a.kind) + ' ' + when(a.at) + ' を足した';
    if (e.action === 'punch_void') return kindJa(b.kind || a.kind) + ' ' + when(b.at || a.at) + ' を取り消した';
    var sedTxt = function (x) { return x.off ? '休み' : when(x.start_at) + '〜' + when(x.end_at) + '・休憩 ' + (x.break_min || 0) + ' 分'; };
    if (e.action === 'sched_set' || e.action === 'sched_off') return '予定を「' + sedTxt(a) + '」にした' + (e.before ? '（前の手直し: ' + sedTxt(b) + '）' : '');
    if (e.action === 'sched_clear') return '予定の手直し（' + sedTxt(b) + '）を外した（シフト・前提の予定に戻した）';
    if (e.action === 'fixed_put') return '前提の時間を ' + ymdSl(a.valid_from) + ' から「' + weekTxt(a.week) + '」にした' + (e.before ? '（同じ効く日の前の版を置き換えた）' : '');
    if (e.action === 'fixed_void') return '前提の時間（' + ymdSl(b.valid_from) + ' から「' + weekTxt(b.week) + '」）を取り消した';
    /* v5 1-3: 職員マスタ・有給・管理者の名簿の直しは、前後の値が読める時は中身も言う（読めない時は ACT_LABEL の言い方） */
    if (e.action === 'master_import') return ACT_LABEL.master_import + '（結んだ ' + lenOf(a.linked) + ' 人・止めた ' + lenOf(a.deactivated) + ' 人）';
    if (e.action === 'master_add') return '職員マスタから ' + lenOf(a.added) + ' 人を足した' + (lenOf(a.skipped) ? '（足せなかった ' + lenOf(a.skipped) + ' 人）' : '');
    if (e.action === 'staff_link') {
      var lt = (a.master_id ? (b.master_id && b.master_id !== a.master_id ? '職員マスタの別の人と結び直した' : '職員マスタの人と結んだ') : '職員マスタとの結び付けを外した');
      return lt + (b.active !== a.active && a.active != null ? (a.active ? '（使う状態に戻した）' : '（休止にした）') : '');
    }
    if (e.action === 'clock_visible') return a.clock_visible === false ? '打刻画面に出さないようにした' : a.clock_visible === true ? '打刻画面に出すようにした' : ACT_LABEL.clock_visible;
    if (e.action === 'leave_profile') return profTxt(b, a);
    if (e.action === 'leave_grant_add') return a.days != null ? '有給の付与 ' + daysJa(a.days) + 'を足した（付与日 ' + ymdSl(a.grant_date) + (a.kind === 'opening' || a.kind === 'manual' ? '・' + KIND_JA[a.kind] : '') + '）' : ACT_LABEL.leave_grant_add;
    if (e.action === 'leave_grant_void') return b.days != null ? '有給の付与 ' + daysJa(b.days) + '（付与日 ' + ymdSl(b.grant_date) + '）を取り消した' : ACT_LABEL.leave_grant_void;
    if (e.action === 'leave_use_add') return a.days != null ? '有休の使用 ' + daysJa(a.days) + 'を足した' : ACT_LABEL.leave_use_add;
    if (e.action === 'leave_use_void') return b.days != null ? '有休の使用 ' + daysJa(b.days) + 'を取り消した' : ACT_LABEL.leave_use_void;
    if (e.action === 'managers_add') return ACT_LABEL.managers_add + (a.email ? '（' + a.email + '）' : '');
    if (e.action === 'managers_remove') return ACT_LABEL.managers_remove + (b.email ? '（' + b.email + '）' : '');
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
    var nm = {}; (data.staff || []).forEach(function (s) { nm[s.staff_id] = dispName(s); });
    return '<div class="tw"><table class="hist"><thead><tr><th>日時</th><th>した人</th><th>職員</th><th>日</th><th>内容</th><th>理由</th></tr></thead><tbody>' + list.map(function (e) {
      return '<tr><td>' + esc(new Date(e.at).toLocaleString('ja-JP')) + '</td><td>' + esc(e.by) + '</td><td>' + esc(nm[e.staff_id] || e.staff_id || '') + '</td><td>' + esc(e.work_date || '') + '</td><td>' + esc(describe(e)) + '</td><td>' + esc(reasonText(e)) + '</td></tr>';
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
    /* v5 1-5: 勤怠の管理者の名簿（管理者だけに出す・画面だけで印刷しない） */
    if (isAdmin()) {
      if (!mgrSt && !mgrBusy) loadMgr();
      h += '<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 8px">勤怠の管理者</h2><div id="g-mgr">' + mgrHtml() + '</div></div>';
    }
    return h;
  }

  /* ── v5 1-5: 勤怠の管理者の名簿（kintai_managers_list・kintai_managers_put（p_on で載せる・外す）。どれも二段階の管理者だけ＝DB が決める） ──
   * 読み終わっても画面全体は描き直さない（設定のタブの入力中の値を消さない）。自分の入れ物（#g-mgr）だけを差し替え、遅れた応答は世代で捨てる */
  var MGR_ROLE = { office: '事務所', admin: '管理者', field: '現場' };
  function loadMgr() {
    if (!isAdmin()) return Promise.resolve();
    var my = ++mgrGen;
    mgrBusy = true;
    return rpc('kintai_managers_list', {}).then(okOr).then(function (r) {
      if (my !== mgrGen) return;
      mgrSt = { rows: Array.isArray(r.rows) ? r.rows.filter(function (x) { return x && typeof x.email === 'string'; }) : [] };
    })['catch'](function (e) {
      if (my !== mgrGen) return;
      note('勤怠の管理者の読み込み', e);
      mgrSt = { rows: [], err: noDb(e) ? 'データベースの更新がまだです（勤怠の管理者の名簿を画面で直す仕組みが入るまで、ここは使えません）。' : msgOf(e) };
    }).then(function () {
      if (my !== mgrGen) return;
      mgrBusy = false;
      var el = $('g-mgr'); if (el && tab === 'settings') el.innerHTML = mgrHtml();
    });
  }
  function mgrHtml() {
    if (!mgrSt) return '<p class="empty">読み込んでいます…</p>';
    if (mgrSt.err) return '<div class="band warn" role="status">' + esc(mgrSt.err) + '</div><div class="row"><button type="button" class="btn sm" data-act="mgr-reload">読み直す</button></div>';
    var rows = mgrSt.rows.map(function (r) {
      var acct = r.in_allowlist ? esc(MGR_ROLE[r.role] || r.role || '') + (r.active ? '' : ' <span class="tag rv">止めてある</span>') : '<span class="tag rv">許可リストに無い</span>';
      return '<tr><td>' + esc(r.email) + '</td><td>' + acct + '</td><td>' + (r.in_payroll ? '載っている' : '') + '</td><td>' + esc(r.added_by || '') + '</td><td>' + esc(r.added_at ? new Date(r.added_at).toLocaleString('ja-JP') : '') + '</td>' +
        '<td>' + (r.in_payroll ? '<span class="help">給与の名簿に載っているため外せません（先に給与の画面で外します）</span>' : '<button type="button" class="btn sm" data-act="mgr-del-open" data-email="' + esc(r.email) + '">外す</button>') + '</td></tr>';
    }).join('');
    return '<p class="help">勤怠の管理画面を使える事務所のアカウントの名簿です。管理者（2段階認証まで済んだ人）は載せなくても使えます。足せるのは、許可リストにある使える状態の事務所のアカウントだけです。給与の名簿に載っている人は勤怠の名簿にも載せておきます（外す時は先に給与の画面で外します）。足す・外すは直しの履歴に残ります。</p>' +
      '<div class="row"><button type="button" class="btn sm pri" data-act="mgr-add-open">足す</button><button type="button" class="btn sm" data-act="mgr-reload">読み直す</button></div>' +
      '<div class="tw"><table><thead><tr><th>メール</th><th>許可リストの役割</th><th>給与の名簿</th><th>足した人</th><th>足した日時</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">まだ誰も載っていません</td></tr>') + '</tbody></table></div>';
  }
  function openMgrAdd() {
    dlgCtx = { mode: 'mgr' };
    openDlg('勤怠の管理者を足す', '<p>勤怠の管理画面を使えるようにする事務所のアカウントのメールアドレスを入れます。許可リストにある、使える状態の事務所のアカウントだけを足せます。</p>' +
      '<div class="row"><label style="flex:1">メールアドレス<input type="email" id="e-mgr-email" maxlength="254" autocomplete="off" style="flex:1;min-width:16em"></label></div>' +
      reasonRow('例: 勤怠の締めを担当するため'), false, '足す', 'mgr-add-go');
    dlgCtx.init = formState();
  }
  function openMgrDel(email) {
    if (!email) return;
    dlgCtx = { mode: 'mgr', email: email };
    openDlg('勤怠の管理者から外す', '<p>' + esc(email) + ' を勤怠の管理者の名簿から外します。外すと、このアカウントは勤怠の管理画面を開けなくなります（管理者の役割のアカウントを除く）。</p>' +
      reasonRow('例: 担当を外れたため'), false, '外す', 'mgr-del-go');
    dlgCtx.init = formState();
  }
  function saveMgr(btn, add) {
    if (!dlgCtx || dlgCtx.mode !== 'mgr' || busy || !isAdmin()) return;
    var ctx = dlgCtx, msg = $('e-msg'), email = add ? String(($('e-mgr-email') && $('e-mgr-email').value) || '').trim().toLowerCase() : ctx.email;
    if (add && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = NG_MGR.badvalue; $('e-mgr-email').focus(); return; }
    var reason = needReason(msg); if (!reason) return;
    busy = true; var restore = pressBusy(btn, add ? '足しています…' : '外しています…', $('g-dlg-f'));
    rpc('kintai_managers_put', { p_email: email, p_on: !!add, p_reason: reason }).then(okOr).then(function () {
      busy = false; closeDlg(); toast(add ? '勤怠の管理者に足しました（' + email + '）' : '勤怠の管理者から外しました（' + email + '）');
      editsCache = null;   /* 直しの履歴に1行増えた */
      return loadMgr();
    })['catch'](function (e) { busy = false; restore(); note(add ? '勤怠の管理者を足す' : '勤怠の管理者から外す', e); if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = mgrMsg(e); else toast(mgrMsg(e)); });
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
    /* 0111: この日の予定（シフト・手直し・前提）と、予定を直す窓への入口 */
    b += '<fieldset><legend>予定（この日）</legend><p>' + schedNow(sid, date) + '</p><div class="row"><button type="button" class="btn sm" data-act="sched-day" data-sid="' + esc(sid) + '" data-date="' + esc(date) + '"' + (lk ? ' disabled' : '') + '>この日の予定を直す</button></div></fieldset>';
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
    openDlg(dispName(st) + ' さん　' + md(date) + '（' + wd(date) + '）', b, lk);
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
        var tr = mk('tr'), cs = histCells(e);
        tr.appendChild(mk('td', null, cs[0]));
        tr.appendChild(mk('td', null, cs[1]));
        tr.appendChild(mk('td', 'raw', cs[2]));
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
  var DIRTY_MODES = { edit: 1, work: 1, leave: 1, link: 1, mimport: 1, clockvis: 1, madd: 1, dname: 1, sched: 1, fixed: 1 };   /* 0111 で予定の手直し・前提を足した */   /* 保存していない入力を確かめる窓（v4 で手入力・有給・結び付けを足した） */
  DIRTY_MODES.mgr = 1;   /* v5 1-5: 勤怠の管理者を足す・外す窓も確かめる */
  function closeDlg() { dlgCtx = null; try { $('g-dlg').close(); } catch (_) { $('g-dlg').removeAttribute('open'); } }
  function dirty() {
    if (!dlgCtx || !DIRTY_MODES[dlgCtx.mode] || dlgCtx.init == null) return false;
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

  /* ── v4: 勤務時間を手で入れる（K6）: 事務所の打刻（出勤・退勤）を2つ足し、休憩を入れた時はその日の休憩も入れる ── */
  function openWork() {
    if (!month || !data) return;
    var ds = dateList(), dv = selDate && ds.indexOf(selDate) >= 0 ? selDate : ds[0], lk = isLocked();
    var sid0 = tab === 'person' && selStaff ? selStaff : '';
    var opts = staffSorted().sort(function (a, b) { return dispName(a).localeCompare(dispName(b), 'ja'); }).map(function (s) {
      return '<option value="' + esc(s.staff_id) + '"' + (s.staff_id === sid0 ? ' selected' : '') + '>' + esc(dispName(s)) + (s.active === false ? '（休止中）' : '') + (srcOf(s) === 'master' ? '（職員マスタから）' : '') + '</option>';
    }).join('');
    dlgCtx = { mode: 'work' };
    var b = (lk ? '<div class="band ok">この月分は締めてあるため入れられません。直す時は管理者が締めを解除してください。</div>' : '') +
      '<fieldset' + (lk ? ' disabled' : '') + '><legend>勤務</legend>' +
      '<div class="row"><label>職員 <select id="w-sid"><option value="">選んでください</option>' + opts + '</select></label></div>' +
      '<div class="row"><label>日付 <input type="date" id="w-date" min="' + ds[0] + '" max="' + ds[ds.length - 1] + '" value="' + esc(dv) + '"></label></div>' +
      '<div class="row"><label>始業 <input type="time" id="w-start"></label><label>終業 <input type="time" id="w-end"></label></div>' +
      '<div class="row"><label>休憩 <input type="number" id="w-break" min="0" max="600" style="width:6em"> 分（空＝いつもの決まり）</label></div></fieldset>' +
      '<div class="row"><label style="flex:1">理由（必ず）<input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:16em" placeholder="例: シフトに載っていない日の勤務"' + (lk ? ' disabled' : '') + '></label></div>' +
      (lk ? '' : '<div class="presets" role="group" aria-label="よく使う理由">' + ['シフトに載っていない日の勤務', '打刻忘れ・本人に確認', '端末の不調', 'その他'].map(function (r) { return '<button type="button" class="btn sm" data-act="reason" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>') +
      '<p class="help">シフトに載っていない職員や日の勤務を入れます。始業と終業は「事務所が足した」出勤・退勤の打刻として入り、休憩はその日の休憩として入ります。どれも直しの履歴に理由と一緒に残り、後から「直す」で取り消せます。終業が始業より前（夜勤）の時は、翌日の終業として入れます。休憩を空にすると、いつもの決まり（6時間を超えたら休憩を引く）で数えます。締めた月分の日は断られます。</p>' +
      '<p class="help" id="e-msg" role="alert"></p>';
    openDlg('勤務時間を手で入れる（' + perLabel() + '）', b, lk, '入れる', 'work-save');
    dlgCtx.init = formState();
  }
  function saveWork(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'work' || busy) return;
    var msg = $('e-msg'), sid = $('w-sid').value, d = $('w-date').value, t0 = $('w-start').value, t1 = $('w-end').value, brV = $('w-break').value;
    var reason = ($('e-reason').value || '').trim();
    if (!sid || !staffById(sid)) { msg.textContent = '職員を選んでください。'; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !inPer(d)) { msg.textContent = 'この月分（' + perLabel() + '）の日を選んでください。'; return; }
    if (!/^\d{2}:\d{2}$/.test(t0) || !/^\d{2}:\d{2}$/.test(t1)) { msg.textContent = '始業と終業の時刻を入れてください。'; return; }
    if (t0 === t1) { msg.textContent = '始業と終業が同じ時刻です。'; return; }
    var br = brV === '' ? null : Math.round(+brV);
    if (br != null && !(br >= 0 && br <= 600)) { msg.textContent = '休憩は 0〜600 分で入れてください。'; return; }
    if (!reason) { msg.textContent = '理由を書いてください（下のボタンで選べます）。'; $('e-reason').focus(); return; }
    var d1 = t1 < t0 ? C.addDays(d, 1) : d;
    var inAt = isoAt(d, t0), outAt = isoAt(d1, t1);
    var span = (Date.parse(outAt) - Date.parse(inAt)) / 60000;
    if (br != null && br >= span) { msg.textContent = '休憩が勤務の長さ以上です。'; return; }
    var lo = C.jstMs(d, 0), hi = C.jstMs(C.addDays(d, 1), 0);
    var had = (data.punches || []).some(function (x) { return x.staff_id === sid && !x.voided_at && Date.parse(x.at) >= lo && Date.parse(x.at) < hi; });
    if (had && !confirm(nameOf(sid) + ' さんは ' + md(d) + ' にもう打刻があります。そのまま出勤・退勤を足しますか？（直す時は「直す」の窓を使います）')) return;
    var ops = [{ f: 'kintai_punch_add', a: { p_staff_id: sid, p_kind: 'in', p_at: inAt, p_reason: reason } }, { f: 'kintai_punch_add', a: { p_staff_id: sid, p_kind: 'out', p_at: outAt, p_reason: reason } }];
    var dn = (data.days || []).filter(function (x) { return x.staff_id === sid && x.work_date === d; })[0] || null;
    if (br != null && br !== (dn && dn.break_min != null ? dn.break_min : null)) ops.push({ f: 'kintai_day_put', a: { p_staff_id: sid, p_date: d, p_patch: { break_min: br }, p_rev: dn ? dn.rev : 0, p_reason: reason } });
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-f')), done = 0;
    var run = function () { if (done >= ops.length) return null; var o = ops[done]; return rpc(o.f, o.a).then(okOr).then(function () { done++; return run(); }); };
    run().then(function () {
      busy = false; closeDlg(); sync('保存しました'); toast('勤務時間を入れました（' + nameOf(sid) + ' さん ' + md(d) + '）');
      return load(false);
    })['catch'](function (e) {
      busy = false; note('勤務時間の手入力', e);
      if (done) { closeDlg(); load(false); alert(msgOf(e) + '（' + ops.length + ' 件のうち ' + done + ' 件は保存しました。読み直したので、残りは「直す」の窓で直してください）'); }
      else { restore(); if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = msgOf(e); else toast('保存できませんでした: ' + msgOf(e)); }
    });
  }

  /* ── 0111: 出勤予定を直す・入れる（シフトの日の手直し・シフトに載らない人の直接入力・休みにする・手直しを外す） ──
   * 手直しは日ごとに1つ。シフトを取り込み直しても消えず、外すとシフトか前提の予定に戻る。理由は直しの履歴に残る */
  var SCHED_REASONS = ['シフトの変更（本人と確認済み）', 'シフトに載らない職員の予定', '休みに変更', 'その他'], FX_REASONS = ['雇用契約の勤務時間', '勤務時間の変更', 'その他'];
  var NG_SCHED = { conflict: '別の人が先にこの日の予定を直しました。読み直してから、もう一度直してください。',
    badrow: '入れた予定の形が違います（始業はその日・終業は始業より後で24時間まで・休憩は勤務の長さより短く）。',
    badshape: '一度に入れられるのは62日までです。', notfound: 'その職員が見つかりませんでした。読み直してください。' };
  var NG_FIXED = { locked: '効く日か、それより後の日に締めた月分があるため、この効く日では入れられません（取り消しもできません）。締めた月分より後の日を効く日にしてください。',
    badweek: '曜日ごとの時間の形が違います（始業と終業は別の時刻・休憩は勤務の長さより短く）。', baddate: '効く日の形が違います。',
    conflict: '同じ効く日の版を別の人が先に直しました。読み直してから、もう一度保存してください。', notfound: '見つかりませんでした（もう取り消してあるかもしれません）。読み直してください。' };
  function schedMsg(e) {
    if (e && e.kintai === 'locked') return (e.date ? md(String(e.date)) + ' は' : 'その日は') + '締めた月分に入っているか、締めた月分の数えに使う日（締めた月分の初日の前の7日）のため直せません。直す時は管理者が締めを解除してください。';
    return e && e.kintai && NG_SCHED[e.kintai] ? NG_SCHED[e.kintai] : msgOf(e);
  }
  function fixedMsg(e) { return e && e.kintai && NG_FIXED[e.kintai] ? NG_FIXED[e.kintai] : msgOf(e); }
  /* 休憩が空の時の既定（シフトの取り込みと同じ決まり: 日をまたぐ勤務は夜勤の休憩・ほかは6時間を超える時だけいつもの休憩） */
  function defBreak(span, night) {
    var cf = (month && month.config) || C.fillConfig({});
    if (night) return Math.round((typeof cf.nightBreakH === 'number' ? cf.nightBreakH : 2) * 60);
    return span > cf.breakThresholdH * 60 ? Math.round(cf.breakH * 60) : 0;
  }
  function okOrD(r) { if (r && r.ok === true) return r; var err = new Error((r && r.error) || 'ng'); err.kintai = (r && r.error) || 'ng'; err.date = r && r.date; throw err; }
  /* その日の予定の時刻（手直しがあればそれ・無ければ予定の勤務の最初の始業と最後の終業）を窓に入れる値に */
  function schedPrefill(sid, date) {
    var se = sid ? schedEditOf(sid, date) : null;
    if (se && !se.off) return { start: hm(se.start_at), end: hm(se.end_at), br: se.break_min };
    var r = (data && data.schedule || []).filter(function (x) { return x.staff_id === sid && x.work_date === date && (x.kind === 'work' || x.kind === 'night') && x.start_at && x.end_at; })
      .sort(function (a, b) { return Date.parse(a.start_at) - Date.parse(b.start_at); });
    if (!r.length) return { start: '', end: '', br: null };
    return { start: hm(r[0].start_at), end: hm(r[r.length - 1].end_at), br: r.length === 1 ? r[0].break_min : null };
  }
  function schedNow(sid, date) {
    var se = schedEditOf(sid, date), rows = (data && data.schedule || []).filter(function (x) { return x.staff_id === sid && x.work_date === date; });
    var work = rows.filter(function (x) { return (x.kind === 'work' || x.kind === 'night') && x.start_at; }).map(function (x) { return (x.symbol ? esc(x.symbol) + ' ' : '') + hm(x.start_at) + '〜' + hm(x.end_at) + '（休憩 ' + esc(x.break_min || 0) + ' 分）'; });
    var paid = rows.some(function (x) { return x.kind === 'paid'; });
    var src = se ? (se.off ? '手直しで休みにしてあります' : '手直しの予定です') + '（理由: ' + esc(se.reason || '') + (se.updated_by ? '・' + esc(se.updated_by) : '') + '）' :
      isFixedDay(sid, date) ? '前提の時間から作った予定です' : (work.length || paid ? 'シフトの予定です' : '予定はありません');
    return (work.length ? work.join('<br>') + '<br>' : '') + (paid ? 'シフトの有休<br>' : '') + '<span class="raw">' + src + '</span>';
  }
  /* 窓の中で職員か始まりの日付を替えた時: 「今の予定」と、始業・終業・休憩・入れ方の初めの値をその人・その日に描き直す */
  function schedRefill() {
    if (!dlgCtx || dlgCtx.mode !== 'sched' || !$('sc-sid')) return;
    var sid = $('sc-sid').value, d = $('sc-from').value, d1 = $('sc-to').value, init = dlgCtx.init, rs = $('e-reason') ? $('e-reason').value : '', from0 = dlgCtx.from0;
    if (d1 === from0) d1 = d;   /* 1日だけの時（終わり＝前の始まり）は、終わりも一緒に動かす（知らないうちに何日分にもならない） */
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !inPer(d)) return;
    var dows = {}; document.querySelectorAll('#g-dlg-b input[name="sc-dow"]').forEach(function (c) { dows[c.value] = c.checked; });
    /* 描き直しは窓を開く時と同じ道（openDlg）で行い、理由・終わりの日付・曜日の選びは残す。開いた時の値（init）も引き継ぐ＝保存していない入力の確かめは前のまま */
    openSched(sid || null, d);
    if (d1 && d1 >= d && inPer(d1)) $('sc-to').value = d1;
    dlgCtx.from0 = d;
    document.querySelectorAll('#g-dlg-b input[name="sc-dow"]').forEach(function (c) { if (dows[c.value] != null) c.checked = dows[c.value]; });
    if ($('e-reason')) $('e-reason').value = rs;
    dlgCtx.init = init;
  }
  function openSched(sid, date) {
    if (!month || !data) return;
    var ds = dateList(), lk = isLocked();
    var dv = date && ds.indexOf(date) >= 0 ? date : (selDate && ds.indexOf(selDate) >= 0 ? selDate : ds[0]);
    var opts = staffSorted().sort(function (a, b) { return dispName(a).localeCompare(dispName(b), 'ja'); }).map(function (s) {
      return '<option value="' + esc(s.staff_id) + '"' + (s.staff_id === sid ? ' selected' : '') + '>' + esc(dispName(s)) + (s.active === false ? '（休止中）' : '') + (srcOf(s) === 'master' ? '（シフトに載らない）' : '') + '</option>';
    }).join('');
    var pre = sid ? schedPrefill(sid, dv) : { start: '', end: '', br: null };
    var se = sid ? schedEditOf(sid, dv) : null;
    var op0 = se && se.off ? 'off' : 'set';
    dlgCtx = { mode: 'sched', preBr: pre.br != null ? String(pre.br) : '', from0: dv };
    var b = (lk ? '<div class="band ok">この月分は締めてあるため直せません。直す時は管理者が締めを解除してください。</div>' : '') +
      (sid ? '<fieldset><legend>今の予定（' + md(dv) + '）</legend><p id="sc-now">' + schedNow(sid, dv) + '</p></fieldset>' : '') +
      '<fieldset' + (lk ? ' disabled' : '') + '><legend>入れる予定</legend>' +
      '<div class="row"><label>職員 <select id="sc-sid"><option value="">選んでください</option>' + opts + '</select></label></div>' +
      '<div class="row"><label>日付 <input type="date" id="sc-from" min="' + ds[0] + '" max="' + ds[ds.length - 1] + '" value="' + esc(dv) + '"></label><label>〜 <input type="date" id="sc-to" min="' + ds[0] + '" max="' + ds[ds.length - 1] + '" value="' + esc(dv) + '"></label></div>' +
      '<div class="row" role="group" aria-label="入れる曜日（何日分かをまとめて入れる時）"><span>曜日</span>' + WD_ORDER.map(function (i) { return '<label><input type="checkbox" name="sc-dow" value="' + i + '" checked> ' + WD[i] + '</label>'; }).join('') + '</div>' +
      '<div class="row" role="radiogroup" aria-label="入れ方">' +
      '<label><input type="radio" name="sc-op" value="set"' + (op0 === 'set' ? ' checked' : '') + '> この時刻にする</label>' +
      '<label><input type="radio" name="sc-op" value="off"' + (op0 === 'off' ? ' checked' : '') + '> 休みにする</label>' +
      '<label><input type="radio" name="sc-op" value="clear"> 手直しを外す（シフト・前提の予定に戻す）</label></div>' +
      '<fieldset id="sc-times"' + (op0 === 'set' ? '' : ' disabled') + ' style="border:0;padding:0;margin:0"><div class="row"><label>始業 <input type="time" id="sc-start" value="' + esc(pre.start) + '"></label><label>終業 <input type="time" id="sc-end" value="' + esc(pre.end) + '"></label>' +
      '<label>休憩 <input type="number" id="sc-break" min="0" max="600" style="width:6em" value="' + (pre.br != null ? esc(pre.br) : '') + '"> 分</label></div></fieldset></fieldset>' +
      '<div class="row"><label style="flex:1">理由（必ず）<input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:16em" placeholder="下のボタンで選ぶか、書いてください"' + (lk ? ' disabled' : '') + '></label></div>' +
      (lk ? '' : '<div class="presets" role="group" aria-label="よく使う理由">' + SCHED_REASONS.map(function (r) { return '<button type="button" class="btn sm" data-act="reason" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>') +
      '<p class="help">勤怠で数える「予定」を直します。シフトを取り込み直しても、ここで直した日はそのまま残ります（印「手直し」）。「手直しを外す」とシフトの予定（シフトに無い日は前提の時間）に戻ります。' +
      '日付を2日以上にすると、選んだ曜日の日にまとめて入れます（この月分の中・62日まで）。終業が始業より前の時は、翌日の終業（夜勤）として入れます。休憩を空にすると、シフトの取り込みと同じ決まり（日をまたぐ勤務は夜勤の休憩・ほかは6時間を超える時だけいつもの休憩）で入れます（始業・終業を変えると、今の予定から入れた休憩は空に戻ります）。締めた月分の日は断られます。打刻はここでは変わりません。</p>' +
      '<p class="help" id="e-msg" role="alert"></p>';
    openDlg('出勤予定を直す・入れる（' + perLabel() + '）', b, lk, '保存する', 'sched-save');
    dlgCtx.init = formState();
  }
  function saveSched(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'sched' || busy) return;
    var msg = $('e-msg'), sid = $('sc-sid').value, d0 = $('sc-from').value, d1 = $('sc-to').value || d0, op = radioVal('sc-op');
    var reason = ($('e-reason').value || '').trim();
    if (!sid || !staffById(sid)) { msg.textContent = '職員を選んでください。'; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d0) || !/^\d{4}-\d{2}-\d{2}$/.test(d1) || !inPer(d0) || !inPer(d1)) { msg.textContent = 'この月分（' + perLabel() + '）の日を選んでください。'; return; }
    if (d1 < d0) { msg.textContent = '終わりの日付が始まりの日付より前です。'; return; }
    var dows = {}, els = document.querySelectorAll('#g-dlg-b input[name="sc-dow"]:checked');
    for (var i = 0; i < els.length; i++) dows[els[i].value] = 1;
    var dates = [];
    for (var d = d0; d <= d1; d = C.addDays(d, 1)) if (d0 === d1 || dows[String(new Date(Date.parse(d + 'T12:00:00+09:00')).getUTCDay())]) dates.push(d);
    if (!dates.length) { msg.textContent = '選んだ曜日の日がありません。'; return; }
    if (dates.length > 62) { msg.textContent = NG_SCHED.badshape; return; }
    var rows = [];
    if (op === 'set') {
      var t0 = $('sc-start').value, t1 = $('sc-end').value, brV = $('sc-break').value;
      if (!/^\d{2}:\d{2}$/.test(t0) || !/^\d{2}:\d{2}$/.test(t1)) { msg.textContent = '始業と終業の時刻を入れてください。'; return; }
      if (t0 === t1) { msg.textContent = '始業と終業が同じ時刻です。'; return; }
      var br = brV === '' ? null : Math.round(+brV);
      if (br != null && !(br >= 0 && br <= 600)) { msg.textContent = '休憩は 0〜600 分で入れてください。'; return; }
      var span = ((+t1.slice(0, 2) * 60 + +t1.slice(3)) - (+t0.slice(0, 2) * 60 + +t0.slice(3)) + 1440) % 1440;
      if (br == null) br = defBreak(span, t1 <= t0);
      if (br >= span) { msg.textContent = '休憩が勤務の長さ以上です。'; return; }
      dates.forEach(function (x) { var se = schedEditOf(sid, x); rows.push({ work_date: x, op: 'set', start_at: isoAt(x, t0), end_at: isoAt(t1 <= t0 ? C.addDays(x, 1) : x, t1), break_min: br, rev: se ? se.rev : 0 }); });
    } else if (op === 'off') {
      dates.forEach(function (x) { var se = schedEditOf(sid, x); rows.push({ work_date: x, op: 'off', rev: se ? se.rev : 0 }); });
    } else if (op === 'clear') {
      dates.forEach(function (x) { var se = schedEditOf(sid, x); if (se) rows.push({ work_date: x, op: 'clear', rev: se.rev }); });
      if (!rows.length) { msg.textContent = '選んだ日に、外す手直しはありません。'; return; }
    } else { msg.textContent = '入れ方を選んでください。'; return; }
    if (!reason) { msg.textContent = '理由を書いてください（下のボタンで選べます）。'; $('e-reason').focus(); return; }
    var st = staffById(sid);
    if (rows.length > 1 && !confirm(dispName(st) + ' さんの ' + md(rows[0].work_date) + '〜' + md(rows[rows.length - 1].work_date) + ' の ' + rows.length + ' 日分を' + (op === 'set' ? '入れます' : op === 'off' ? '休みにします' : '手直しから外します') + '。よろしいですか？')) return;
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    rpc('kintai_sched_edit_put', { p_staff_id: sid, p_rows: rows, p_reason: reason }).then(okOrD).then(function (r) {
      busy = false; closeDlg(); sync('保存しました');
      toast((r.changed ? r.changed + ' 日分の予定を保存しました' : '変わった所はありませんでした') + '（' + dispName(st) + ' さん）');
      return load(false);
    })['catch'](function (e) {
      busy = false; restore(); note('出勤予定の手直し', e);
      if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = schedMsg(e); else toast('保存できませんでした: ' + schedMsg(e));
    });
  }

  /* ── 0111: 前提の時間（職員ごと・曜日ごとの始業・終業・休憩・休み。効く日つきの版で残す） ──
   * シフトの行も手直しも無い日だけ、この時間を予定として数える。直す時は新しい版を足し、前の版は消さない */
  var FX_DEFAULT = { '0': { off: true }, '1': { start: '09:00', end: '18:00', break_min: 60 }, '2': { start: '09:00', end: '18:00', break_min: 60 }, '3': { start: '09:00', end: '18:00', break_min: 60 },
    '4': { start: '09:00', end: '18:00', break_min: 60 }, '5': { start: '09:00', end: '18:00', break_min: 60 }, '6': { off: true } };
  function openFixed(sid) {
    var st = staffById(sid); if (!st || !data) return;
    var vs = fixedOf(sid).slice().sort(function (a, b) { return a.valid_from < b.valid_from ? 1 : a.valid_from > b.valid_from ? -1 : (String(a.created_at) < String(b.created_at) ? 1 : -1); });
    var td = today(), act = vs.filter(function (v) { return !v.voided_at; });
    var cur = act.filter(function (v) { return v.valid_from <= td; })[0] || act[0] || null;
    var wk = cur && cur.week ? cur.week : FX_DEFAULT;
    var onShift = srcOf(st) === 'shift' && (data.schedule || []).some(function (x) { return x.staff_id === sid && !isFixedDay(sid, x.work_date) && !schedEditOf(sid, x.work_date); });
    dlgCtx = { mode: 'fixed', sid: sid, vs: vs };
    var b = (st.active === false && act.some(function (v) { return !!v.week; }) ? '<div class="band warn" role="status">この人は休止中です。前提の版が残っている間は前提の予定が出続け、「打刻なし」になります。退職・休止の日から「この日から前提なし」の版を入れてください。</div>' : '') +
      (onShift ? '<div class="band warn" role="status">この人はシフトに載っています。前提の時間を入れると、シフトの空いた日（休み）にも前提の予定が入り、「打刻なし」になります。前提はシフトに載らない人・シフトを作らない人に使ってください。</div>' : '') +
      '<fieldset><legend>今までの版（新しい順）</legend>' + (vs.length ? '<div class="tw"><table class="hist"><thead><tr><th>効く日</th><th>時間</th><th>理由</th><th>入れた人</th><th></th></tr></thead><tbody>' + vs.map(function (v) {
        var vd = !!v.voided_at;
        return '<tr><td class="' + (vd ? 'void' : '') + '">' + esc(ymdSl(v.valid_from)) + ' から</td><td class="' + (vd ? 'void' : '') + '">' + esc(weekTxt(v.week)) + '</td><td>' + esc(v.reason || '') + (vd ? '<span class="raw">取り消し: ' + esc(v.void_reason || '') + '</span>' : '') + '</td>' +
          '<td class="raw">' + esc(v.created_by || '') + '<br>' + esc(v.created_at ? new Date(v.created_at).toLocaleString('ja-JP') : '') + '</td>' +
          '<td>' + (vd ? '<span class="tag">取り消し済み</span>' : '<button type="button" class="btn sm ng" data-act="fx-void" data-id="' + esc(v.id) + '">取り消す</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="empty">まだありません。</p>') + '</fieldset>' +
      '<fieldset><legend>新しい版</legend><div class="row"><label>効く日 <input type="date" id="fx-from" value="' + esc(td) + '"></label></div>' +
      '<div class="row" role="radiogroup" aria-label="入れ方"><label><input type="radio" name="fx-mode" value="week" checked> 曜日ごとの時間を入れる</label><label><input type="radio" name="fx-mode" value="none"> この日から前提なし</label></div>' +
      '<fieldset id="fx-week" style="border:0;padding:0;margin:0"><div class="tw"><table class="plist"><thead><tr><th>曜日</th><th>勤務</th><th>始業</th><th>終業</th><th>休憩（分）</th></tr></thead><tbody>' + WD_ORDER.map(function (i) {
        var x = wk[String(i)] || { off: true }, on = !!x.start;
        return '<tr><th scope="row">' + WD[i] + '</th><td><select id="fx-k-' + i + '" aria-label="' + WD[i] + '曜日"><option value="w"' + (on ? ' selected' : '') + '>勤務</option><option value="off"' + (on ? '' : ' selected') + '>休み</option></select></td>' +
          '<td><input type="time" id="fx-s-' + i + '" value="' + esc(on ? x.start : '') + '" aria-label="' + WD[i] + '曜日の始業"></td><td><input type="time" id="fx-e-' + i + '" value="' + esc(on ? x.end : '') + '" aria-label="' + WD[i] + '曜日の終業"></td>' +
          '<td><input type="number" id="fx-b-' + i + '" min="0" max="600" style="width:5em" value="' + esc(on ? x.break_min : '') + '" aria-label="' + WD[i] + '曜日の休憩（分）"></td></tr>';
      }).join('') + '</tbody></table></div><div class="row"><button type="button" class="btn sm" data-act="fx-copy">月曜の時間を火〜金に写す</button></div></fieldset></fieldset>' +
      '<div class="row"><label style="flex:1">理由（必ず）<input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:16em" placeholder="例: 雇用契約の勤務時間"></label></div>' +
      '<div class="presets" role="group" aria-label="よく使う理由">' + FX_REASONS.map(function (r) { return '<button type="button" class="btn sm" data-act="reason" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
      '<p class="help">シフトの予定も手直しも無い日だけ、ここの時間をその日の予定として数えます（遅刻・早退・残業の判定と、給与の所定・残業の計算に使います）。効く日から次の版の効く日の前の日まで効きます。' +
      '直す時は新しい版を足し、前の版は消さずに残ります（同じ効く日の版は置き換え、前の版には取り消しの印が付きます）。締めた月分に掛かる効く日では入れられません。終業が始業より前の曜日は、翌日の終業（夜勤）として数えます。休憩を空にすると、予定の窓と同じ決まりで入れます。祝日などの休みは「出勤予定を直す・入れる」で休みにしてください。取り消すボタンは、下の理由の欄に書いた理由で取り消します。</p>' +
      '<p class="help" id="e-msg" role="alert"></p>';
    openDlg(dispName(st) + ' さん　前提の時間', b, false, '新しい版を保存する', 'fx-save');
    dlgCtx.init = formState();
  }
  function fixedWeek(msg) {
    var w = {};
    for (var k = 0; k < WD_ORDER.length; k++) {
      var i = WD_ORDER[k];
      if ($('fx-k-' + i).value === 'off') { w[String(i)] = { off: true }; continue; }
      var s0 = $('fx-s-' + i).value, e0 = $('fx-e-' + i).value, bv = $('fx-b-' + i).value;
      if (!/^\d{2}:\d{2}$/.test(s0) || !/^\d{2}:\d{2}$/.test(e0)) { msg.textContent = WD[i] + '曜日の始業と終業を入れてください（休みの曜日は「休み」を選びます）。'; return null; }
      if (s0 === e0) { msg.textContent = WD[i] + '曜日の始業と終業が同じ時刻です。'; return null; }
      var sp = ((+e0.slice(0, 2) * 60 + +e0.slice(3)) - (+s0.slice(0, 2) * 60 + +s0.slice(3)) + 1440) % 1440, bm = bv === '' ? defBreak(sp, e0 <= s0) : Math.round(+bv);
      if (!(bm >= 0 && bm <= 600) || bm >= sp) { msg.textContent = WD[i] + '曜日の休憩は 0〜600 分で、勤務の長さより短くしてください。'; return null; }
      w[String(i)] = { start: s0, end: e0, break_min: bm };
    }
    return w;
  }
  function saveFixed(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'fixed' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), d = $('fx-from').value, mode = radioVal('fx-mode');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { msg.textContent = '効く日を入れてください。'; return; }
    var week = null;
    if (mode !== 'none') { week = fixedWeek(msg); if (!week) return; }
    var reason = ($('e-reason').value || '').trim();
    if (!reason) { msg.textContent = '理由を書いてください（下のボタンで選べます）。'; $('e-reason').focus(); return; }
    var same = ctx.vs.filter(function (v) { return !v.voided_at && v.valid_from === d; })[0] || null;
    if (same && !confirm(ymdSl(d) + ' から効く版がもうあります。置き換えますか？（前の版は取り消しの印を付けて残ります）')) return;
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    rpc('kintai_fixed_put', { p_staff_id: ctx.sid, p_valid_from: d, p_week: week, p_replace: same ? same.id : null, p_reason: reason }).then(okOr).then(function (r) {
      busy = false; closeDlg(); sync('保存しました');
      toast((r.changed ? '前提の時間を保存しました' : '変わった所はありませんでした') + '（' + nameOf(ctx.sid) + ' さん ' + ymdSl(d) + ' から）');
      return load(false);
    })['catch'](function (e) {
      busy = false; restore(); note('前提の時間の保存', e);
      if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = fixedMsg(e); else toast('保存できませんでした: ' + fixedMsg(e));
    });
  }
  function voidFixed(id, btn) {
    if (!dlgCtx || dlgCtx.mode !== 'fixed' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), v = ctx.vs.filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    var reason = ($('e-reason').value || '').trim();
    if (!reason) { msg.textContent = '取り消す理由を、下の理由の欄に書いてください。'; $('e-reason').focus(); return; }
    if (!confirm(ymdSl(v.valid_from) + ' からの版「' + weekTxt(v.week) + '」を取り消しますか？（記録は残ります）\n取り消す理由: ' + reason + '\n※ 下の「新しい版」に書きかけの入力は消えます。')) return;
    busy = true; msg.textContent = '取り消しています…';
    var restore = pressBusy(btn, '取り消しています…', $('g-dlg'));
    rpc('kintai_fixed_void', { p_id: id, p_reason: reason }).then(okOr).then(function () {
      busy = false; closeDlg(); toast('前提の時間の版を取り消しました（' + nameOf(ctx.sid) + ' さん）');
      return load(false).then(function () { if (!dlgCtx && staffById(ctx.sid)) openFixed(ctx.sid); });
    })['catch'](function (e) {
      busy = false; restore(); note('前提の時間の取り消し', e);
      if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = fixedMsg(e); else toast('取り消せませんでした: ' + fixedMsg(e));
    });
  }

  /* ── v4: 職員マスタの突き合わせ・手で結ぶ・打刻画面に出す/出さない（理由は直しの履歴に残る） ── */
  function reasonRow(ph) { return '<div class="row"><label style="flex:1">理由（必ず）<input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:16em" placeholder="' + esc(ph || '') + '"></label></div><p class="help" id="e-msg" role="alert"></p>'; }
  function needReason(msg) { var r = ($('e-reason') && $('e-reason').value || '').trim(); if (!r) { msg.textContent = '理由を書いてください。'; $('e-reason').focus(); } return r; }
  function openImport() {
    dlgCtx = { mode: 'mimport' };
    openDlg('職員マスタと突き合わせる', '<p>氏名（空白を除く）が1人ずつだけ同じ人を結び、職員マスタで退職した（職員マスタから足した）人を休止にします。職員マスタにしかいない人は、ここでは足しません（結果の後に、1人ずつ「新しい職員として足す」を選べます）。今までの打刻・予定・給与の設定の番号は変えません。</p>' + reasonRow('例: 職員マスタの人を勤怠に出すため'), false, '突き合わせる', 'm-import-go');
    dlgCtx.init = formState();
  }
  function runImport(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'mimport' || busy) return;
    var msg = $('e-msg'), reason = needReason(msg); if (!reason) return;
    busy = true; var restore = pressBusy(btn, '突き合わせています…', $('g-dlg-f'));
    rpc('kintai_master_import', { p_reason: reason }).then(okOr).then(function (r) {
      busy = false; importResult = r;
      var nm = function (sid) { var s = staffById(sid); return s ? dispName(s) : sid; };
      var mn = function (id) { var m = masterSt && masterSt.byId && masterSt.byId[id]; return m ? m.name : id; };
      var us = Array.isArray(r.unmatched_staff) ? r.unmatched_staff : [], um = Array.isArray(r.unmatched_master) ? r.unmatched_master : [];
      dlgCtx = { mode: 'mresult' };
      openDlg('突き合わせの結果', '<div class="band ok" role="status">結んだ ' + esc(r.linked || 0) + ' 人・休止にした ' + esc(r.deactivated || 0) + ' 人</div>' +
        '<p><b>結べなかったシフトの職員（' + us.length + ' 人）</b><br>' + (us.length ? us.map(function (x) { return esc(nm(x)); }).join('・') : 'ありません') + '</p>' +
        '<p><b>結べなかった職員マスタの人（' + um.length + ' 人）</b><br>' + (um.length ? um.map(function (x) { return esc(mn(x)); }).join('・') : 'ありません') + '</p>' +
        '<p class="help">結べなかった人は「職員と番号」の下の表で、シフトの職員に結ぶか、新しい職員として足すかを1人ずつ選んでください（同じ名前が2人以上いる人は自動で結びません）。</p>', true);
      masterSt = null; leaveSt = null; return load(false);
    })['catch'](function (e) { busy = false; restore(); note('職員マスタの突き合わせ', e); var m = $('e-msg'); if (m && $('g-dlg').open) m.textContent = msgOf(e); else toast(msgOf(e)); });
  }
  function normName(s) { return String(s || '').replace(/[\s　]/g, ''); }
  /* シフトの名前か表示名のどちらかが職員マスタの名前と同じ（空白を除く・2026-11-20） */
  function sameNm(s, m) { var k = normName(m && m.name); return !!k && (normName(s && s.name) === k || normName(dispName(s)) === k); }
  /* 手で結ぶ（K2）。候補の職員マスタの人＝まだ結べていない人と、職員マスタから足した（m_ の）人。
     m_ の人をシフトの職員に寄せる時は、m_ の行を外して（休止になる）から、シフトの職員に結ぶ（2つの操作を順に・0106 の決まり） */
  function linkCands(sid) {
    var lm = linkedMap(), s = sid ? staffById(sid) : null, cur = s && s.master_id || '';
    return masterSt.rows.filter(function (m) { var o = lm[m.master_id]; return m.master_id === cur || (inService(m) && (!o || (srcOf(o) === 'master' && o.staff_id !== sid))); });
  }
  function openLink(sid) {
    var s = staffById(sid); if (!s || !masterSt || masterSt.err) return;
    var lm = linkedMap(), cur = s.master_id || '';
    var cand = linkCands(sid);
    cand.sort(function (a, b) { var sa = sameNm(s, a) ? 0 : 1, sb = sameNm(s, b) ? 0 : 1; return sa - sb || String(a.kana || a.name).localeCompare(String(b.kana || b.name), 'ja'); });
    dlgCtx = { mode: 'link', sid: sid, cur: cur || null };
    openDlg(dispName(s) + ' さんを職員マスタと結ぶ', '<div class="row"><label>職員マスタの人 <select id="m-sel"><option value="">' + (cur ? '結ばない（外す）' : '選んでください') + '</option>' +
      cand.map(function (m) { var o = lm[m.master_id]; return '<option value="' + esc(m.master_id) + '"' + (m.master_id === cur ? ' selected' : '') + '>' + esc(m.name) + (m.hire_date ? '（入職 ' + esc(ymdJa(m.hire_date)) + '）' : '') + (sameNm(s, m) ? '・同じ名前' : '') + (o && o.staff_id !== sid ? '・今は職員マスタから足した職員' : '') + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="help">同じ職員マスタの人を2人の職員に結ぶことはできません。「今は職員マスタから足した職員」の人を選ぶと、その職員の行を外して休止にしてから、この人に結びます（その行の打刻・有給の記録は移りません）。結ぶと、有給の入職日にその人の入職日を使います。打刻・予定の記録はそのままです。</p>' + reasonRow('例: 同じ名前の人がいたため手で結んだ'), false, '保存する', 'm-link-go');
    dlgCtx.init = formState();
  }
  /* 職員マスタの人の側から: シフトの職員を選んで結ぶ */
  function openLinkM(mid) {
    var m = masterSt && masterSt.byId && masterSt.byId[mid]; if (!m) return;
    var list = (data.staff || []).filter(function (s) { return srcOf(s) === 'shift' && !s.master_id; });
    list.sort(function (a, b) { var sa = sameNm(a, m) ? 0 : 1, sb = sameNm(b, m) ? 0 : 1; return sa - sb || dispName(a).localeCompare(dispName(b), 'ja'); });
    dlgCtx = { mode: 'link', mid: mid, cur: null };
    openDlg(m.name + ' さん（職員マスタ）をシフトの職員に結ぶ', '<div class="row"><label>シフトの職員 <select id="m-sel"><option value="">選んでください</option>' +
      list.map(function (s) { return '<option value="' + esc(s.staff_id) + '">' + esc(dispName(s)) + (s.active === false ? '（休止中）' : '') + (sameNm(s, m) ? '・同じ名前' : '') + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="help">選べるのは、まだ職員マスタと結んでいないシフトの職員だけです。打刻・予定の記録はそのままです。</p>' + reasonRow('例: 同じ名前の人がいたため手で結んだ'), false, '結ぶ', 'm-link-go');
    dlgCtx.init = formState();
  }
  function saveLink(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'link' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), sel = $('m-sel').value || null;
    var sid = ctx.mid ? sel : ctx.sid, v = ctx.mid ? ctx.mid : sel;
    if (ctx.mid && !sid) { msg.textContent = 'シフトの職員を選んでください。'; return; }
    if (!ctx.mid && v === ctx.cur) { msg.textContent = '変えた所がありません。'; return; }
    var reason = needReason(msg); if (!reason) return;
    var o = v ? linkedMap()[v] : null, ops = [];
    if (o && o.staff_id !== sid && srcOf(o) === 'master' && o.master_id === v) ops.push({ p_staff_id: o.staff_id, p_master_id: null, p_reason: reason });   /* 先に m_ の行を外す（休止になる） */
    ops.push({ p_staff_id: sid, p_master_id: v, p_reason: reason });
    busy = true; var restore = pressBusy(btn, '保存しています…', $('g-dlg-f')), done = 0;
    var run = function () { if (done >= ops.length) return null; return rpc('kintai_staff_link', ops[done]).then(okOr).then(function () { done++; return run(); }); };
    run().then(function () {
      busy = false; closeDlg(); toast(v ? '職員マスタと結びました（' + nameOf(sid) + ' さん）' : '結び付けを外しました（' + nameOf(sid) + ' さん）'); leaveSt = null; return load(false);
    })['catch'](function (e) {
      busy = false; note('職員マスタと結ぶ', e);
      if (done) { closeDlg(); leaveSt = null; load(false); alert(msgOf(e) + '（職員マスタから足した職員の行は外しましたが、結ぶ所で断られました。読み直したので、もう一度結んでください）'); return; }
      restore(); if ($('g-dlg').open) msg.textContent = msgOf(e); else toast(msgOf(e));
    });
  }
  /* 職員マスタの人を新しい職員として足す（kintai_master_add・足した人は打刻画面の名簿に出る） */
  function openAdd(mid) {
    var m = masterSt && masterSt.byId && masterSt.byId[mid]; if (!m) return;
    dlgCtx = { mode: 'madd', mid: mid };
    openDlg(m.name + ' さんを新しい職員として足す', '<p>職員マスタの ' + esc(m.name) + ' さんを、勤怠の新しい職員として足します（シフトに載っていない人向けです。シフトに同じ人がいる時は「シフトの職員に結ぶ」を選んでください）。</p>' +
      '<div class="band warn" role="status">足した人は打刻画面の名簿に出ます。出さない時は、足した後に「職員と番号」の表で「打刻画面に出さない」を押してください。打刻の番号は自動で振ります。</div>' + reasonRow('例: シフトに載らない職員のため'), false, '足す', 'm-add-go');
    dlgCtx.init = formState();
  }
  function saveAdd(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'madd' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), reason = needReason(msg); if (!reason) return;
    busy = true; var restore = pressBusy(btn, '足しています…', $('g-dlg-f'));
    rpc('kintai_master_add', { p_master_ids: [ctx.mid], p_reason: reason }).then(okOr).then(function (r) {
      var sk = Array.isArray(r.skipped) ? r.skipped : [], ad = Array.isArray(r.added) ? r.added : [];
      if (!ad.length && sk.length) { var er = new Error('skip'); er.kintai = (sk[0] && sk[0].error) || 'ng'; throw er; }
      busy = false; closeDlg(); toast('新しい職員として足しました'); leaveSt = null; return load(false);
    })['catch'](function (e) { busy = false; restore(); note('職員マスタから足す', e); if ($('g-dlg').open) msg.textContent = msgOf(e); else toast(msgOf(e)); });
  }
  function openClockVis(sid) {
    var s = staffById(sid); if (!s) return;
    var show = s.clock_visible === false;
    dlgCtx = { mode: 'clockvis', sid: sid, to: show };
    openDlg(dispName(s) + ' さんを打刻画面に' + (show ? '出す' : '出さない'), '<p>' + (show ? '打刻画面の名簿に名前を出します（休止中の人は出ません）。' : '打刻画面の名簿に名前を出さなくなります。番号で打刻する時は今までどおり使えます。') + '</p>' + reasonRow(''), false, show ? '出す' : '出さない', 'm-vis-go');
    dlgCtx.init = formState();
  }
  function saveClockVis(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'clockvis' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), reason = needReason(msg); if (!reason) return;
    busy = true; var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    rpc('kintai_staff_clock_visible', { p_staff_id: ctx.sid, p_visible: ctx.to, p_reason: reason }).then(okOr).then(function () {
      busy = false; closeDlg(); toast('保存しました（' + nameOf(ctx.sid) + ' さん）'); return load(false);
    })['catch'](function (e) { busy = false; restore(); note('打刻画面に出す', e); if ($('g-dlg').open) msg.textContent = msgOf(e); else toast(msgOf(e)); });
  }

  /* 表示名を変える（統合 0107・2026-11-20 代表者の指示）。空にするとシフトの名前に戻る。理由は必ず */
  function openDispName(sid) {
    var s = staffById(sid); if (!s) return;
    dlgCtx = { mode: 'dname', sid: sid };
    openDlg(dispName(s) + ' さんの表示名を変える', '<p>勤怠の画面と打刻画面に出す名前を変えます。シフトの名前（' + esc(s.name) + '）は変わりません。空にするとシフトの名前に戻ります。</p>' +
      '<div class="row"><label style="flex:1">表示名<input type="text" id="e-dname" maxlength="60" style="flex:1;min-width:12em" value="' + esc(s.display_name || '') + '"></label></div>' +
      reasonRow(''), false, '保存', 'dname-go');
    dlgCtx.init = formState();
  }
  function saveDispName(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'dname' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), el = $('e-dname'), v = el ? String(el.value || '').trim() : '';
    if (v.length > 60) { msg.textContent = '表示名は60字までです。'; return; }
    var reason = needReason(msg); if (!reason) return;
    busy = true; var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    rpc('kintai_staff_display_name_put', { p_staff_id: ctx.sid, p_name: v, p_reason: reason }).then(okOr).then(function () {
      var s0 = staffById(ctx.sid);   /* 空にした時は読み直す前の古い表示名でなく、戻した先のシフトの名前を出す */
      busy = false; closeDlg(); toast(v ? '保存しました（' + v + ' さん）' : '表示名を消しました（シフトの名前「' + (s0 ? s0.name : ctx.sid) + '」に戻しました）'); return load(false);
    })['catch'](function (e) { busy = false; restore(); note('表示名を変える', e); if ($('g-dlg').open) msg.textContent = msgOf(e); else toast(msgOf(e)); });
  }

  /* ── v4: 有給の窓（1人分の付与・使用・設定。足す・取り消すは1つずつ保存し、保存したら記録を読み直して窓を描き直す） ── */
  var KIND_JA = { auto: '自動', opening: '移行の残り', manual: '手で足した' };
  var ST_JA = { ok: '数える', skip: '付与しない', opening: '移行日より前（数えない）' };
  function openLeave(sid) {
    var s = staffById(sid); if (!s || !leaveSt || leaveSt.err) return;
    var x = leaveOf(s), sm = x.sm, bal = sm.balance, p = x.prof || {}, td = today();
    var lotKey = function (l) { return l.kind + '|' + l.grant_date + '|' + (l.id || ''); }, lotBy = {};
    bal.lots.forEach(function (l) { lotBy[lotKey(l)] = l; });
    var gl = sm.auto.map(function (g) { return { g: g, auto: true, date: g.grant_date }; }).concat(x.grants.map(function (g) { return { g: g, auto: false, date: g.grant_date }; }));
    gl.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var grows = gl.map(function (it) {
      var g = it.g, kind = it.auto ? 'auto' : (g.kind === 'opening' ? 'opening' : 'manual'), v = !it.auto && !!g.voided_at;
      var lot = !v && (it.auto ? g.status === 'ok' : true) ? lotBy[lotKey({ kind: kind, grant_date: g.grant_date, id: it.auto ? null : g.id })] : null;
      var st = it.auto ? ST_JA[g.status] : (v ? '取り消し: ' + (g.void_reason || '') : '数える');
      if (lot) st = lot.state === 'expired' ? '期限切れ' : lot.state === 'future' ? 'これから' : '使える';
      return '<tr><td class="' + (v ? 'void' : '') + '">' + esc(ymdJa(g.grant_date)) + '</td><td class="num ' + (v ? 'void' : '') + '">' + esc(String(+g.days)) + '</td><td>' + esc(KIND_JA[kind]) + (it.auto && g.proportional ? '（比例）' : '') + '</td><td>' + esc(ymdJa(L.expiresOf(g.grant_date))) + '</td>' +
        '<td class="num">' + (lot ? esc(String(lot.used)) : '') + '</td><td class="num">' + (lot ? esc(String(lot.remain)) : '') + '</td><td>' + esc(st) + (!it.auto && g.note ? '<span class="raw">・' + esc(g.note) + '</span>' : '') + '</td>' +
        '<td>' + (!it.auto && !v ? '<button type="button" class="btn sm ng" data-act="lv-grant-void" data-id="' + esc(g.id) + '">取り消す</button>' : '') + '</td></tr>';
    }).join('');
    var voidU = leaveSt.manual.filter(function (u) { return u && u.staff_id === sid && u.voided_at; }).map(function (u) { return { use_date: u.use_date, days: +u.days, src: 'manual', id: u.id, note: u.note || '', voided: true, why: u.void_reason || '' }; });
    var ul = x.uses.concat(voidU).sort(function (a, b) { return a.use_date < b.use_date ? 1 : a.use_date > b.use_date ? -1 : 0; });
    var urows = ul.map(function (u) {
      var v = !!u.voided;
      return '<tr><td class="' + (v ? 'void' : '') + '">' + esc(ymdJa(u.use_date)) + (u.use_date > td ? '<span class="tag">予定</span>' : '') + '</td><td class="' + (v ? 'void' : '') + '">' + esc(dayTxt(u.days)) + '</td><td>' + (u.src === 'shift' ? 'シフトの有休' : '手で入れた' + (u.alsoShift ? '（シフトの有休もある日・こちらを数える）' : '')) + '</td>' +
        '<td>' + esc(u.note || '') + (v ? '<span class="raw">取り消し: ' + esc(u.why) + '</span>' : '') + '</td><td>' + (u.src === 'manual' && !v ? '<button type="button" class="btn sm ng" data-act="lv-use-void" data-id="' + esc(u.id) + '" data-date="' + esc(u.use_date) + '">取り消す</button>' : '') + '</td></tr>';
    }).join('');
    var ob = sm.obligation;
    dlgCtx = { mode: 'leave', sid: sid, rev: x.prof ? x.prof.rev || 0 : 0, prof: p };
    var b = '<div class="kv"><span>入職日</span><b>' + (sm.hire ? esc(ymdJa(sm.hire)) : '分かりません') + (x.m && x.m.hire_date ? '<span class="raw">（職員マスタ ' + esc(ymdJa(x.m.hire_date)) + '）</span>' : '') + '</b>' +
      '<span>残り</span><b>' + esc(String(bal.remain)) + ' 日' + (bal.soon ? '（期限の近い分 ' + esc(String(bal.soon.days)) + ' 日・' + esc(ymdJa(bal.soon.expires)) + ' まで）' : '') + (bal.over ? '<span class="tag ng">付与の無い使用 ' + esc(String(bal.over)) + ' 日</span>' : '') + '</b>' +
      '<span>次の付与</span><b>' + (sm.next ? esc(ymdJa(sm.next.grant_date)) + '　' + esc(String(sm.next.days)) + ' 日' : '—') + '</b>' +
      '<span>年5日</span><b>' + (ob.state === 'none' ? '対象外（10日以上の付与がまだありません）' : esc(ymdJa(ob.grant_date)) + '〜' + esc(ymdJa(ob.end)) + ' に ' + esc(String(ob.used)) + ' 日' + (ob.planned ? '（この先の予定 ' + esc(String(ob.planned)) + ' 日）' : '') + ' ' + obTag(ob) +
        (ob.beforeOpening ? '<br><span class="help">移行日（' + esc(ymdJa(ob.beforeOpening)) + '）より前の使用は記録に無いため数えていません。その分は本人の記録で確かめてください。</span>' : '')) + '</b></div>' +
      (sm.openingMissing ? '<div class="band warn" style="margin-top:8px">移行日が未設定です。移行の残りがあるので、今はその最も遅い付与日の翌日（' + esc(ymdJa(sm.opening)) + '）を移行日とみなして数えています（設定しないと、自動の付与と重なって残りが多く出ることがあります）。下の設定の「移行日」に、残りを数えた日を入れてください。</div>' : '') +
      (x.needWeekly ? '<div class="band warn" style="margin-top:8px">雇用形態がパート・臨時ですが、週の所定日数が入っていません。下の設定に入れると比例付与で数えます（入れないと通常の付与で数えます）。</div>' : '') +
      '<fieldset><legend>付与</legend><div class="tw"><table><thead><tr><th>付与日</th><th class="num">日数</th><th>種類</th><th>期限（この日まで）</th><th class="num">使った</th><th class="num">残り</th><th>状態</th><th></th></tr></thead><tbody>' + (grows || '<tr><td colspan="8" class="empty">付与はまだありません</td></tr>') + '</tbody></table></div>' +
      '<div class="row"><label>付与日 <input type="date" id="lv-g-date"></label><label>日数 <input type="number" id="lv-g-days" min="0.5" max="40" step="0.5" style="width:6em"></label>' +
      '<label>種類 <select id="lv-g-kind"><option value="opening">移行の残り</option><option value="manual">手で足す</option></select></label><label>メモ <input type="text" id="lv-g-note" maxlength="200"></label>' +
      (p.opening_date ? '' : '<label>移行日 <input type="date" id="lv-g-open" value="' + esc(td) + '"></label>') + '<button type="button" class="btn sm" data-act="lv-grant-add">付与を足す</button></div>' +
      (p.opening_date ? '' : '<p class="help">移行の残りを足す時は、移行日（残りを数えた日・既定は今日）も一緒に設定に入れます。移行日より前の自動の付与と使用は数えません。</p>') +
      '<p class="help">今の残りを移す時は「移行の残り」で、前の年の分と今年の分を別の行で入れます（期限は付与日から2年）。下の設定の「移行日」より前の自動の付与は数えません。</p></fieldset>' +
      '<fieldset><legend>使用</legend><div class="row"><label>日付 <input type="date" id="lv-u-date"></label><label>日数 <select id="lv-u-days"><option value="1">1日</option><option value="0.5">半日</option></select></label><label>メモ <input type="text" id="lv-u-note" maxlength="200"></label><button type="button" class="btn sm" data-act="lv-use-add">使用を足す</button></div>' +
      '<p class="help">シフトに有休の記号が無い日の有休を入れます。勤怠の月の計算でも有休の日として数えます（シフトに有休の記号がある日は、勤怠の計算はシフトの方を数えます）。締めた月分の日は足せません。</p>' +
      '<div class="tw"><table><thead><tr><th>日</th><th>日数</th><th>元</th><th>メモ</th><th></th></tr></thead><tbody>' + (urows || '<tr><td colspan="5" class="empty">使用はまだありません</td></tr>') + '</tbody></table></div></fieldset>' +
      '<fieldset><legend>設定</legend><div class="kv">' +
      '<label for="lv-p-hire">入職日の上書き</label><span><input type="date" id="lv-p-hire" value="' + esc(p.hire_date || '') + '"> 空＝職員マスタの入職日</span>' +
      '<label for="lv-p-wd">週の所定日数</label><span><input type="number" id="lv-p-wd" min="0.5" max="7" step="0.5" style="width:6em" value="' + esc(p.weekly_days != null ? String(+p.weekly_days) : '') + '"> 日（比例付与を使う人だけ）</span>' +
      '<label for="lv-p-wh">週の所定時間</label><span><input type="number" id="lv-p-wh" min="0.5" max="168" step="0.5" style="width:6em" value="' + esc(p.weekly_hours != null ? String(+p.weekly_hours) : '') + '"> 時間</span>' +
      '<label for="lv-p-open">移行日</label><span><input type="date" id="lv-p-open" value="' + esc(p.opening_date || '') + '"> この日より前の自動の付与は数えません</span>' +
      '<span>付与しない日</span><span>' + (sm.auto.length ? sm.auto.filter(function (g) { return g.status !== 'opening'; }).map(function (g) { return '<label style="display:inline-flex;gap:4px;margin-right:12px"><input type="checkbox" data-skip="' + esc(g.grant_date) + '"' + (g.status === 'skip' ? ' checked' : '') + '> ' + esc(ymdJa(g.grant_date)) + '（' + esc(String(g.days)) + ' 日）</label>'; }).join('') : '<span class="raw">自動の付与はまだありません</span>') + '<br><span class="help">出勤率が8割に届かなかった年など、付与しない付与日に印を付けます</span></span>' +
      '</div><div class="row"><button type="button" class="btn sm pri" data-act="lv-prof-save">設定を保存する</button></div></fieldset>' +
      '<div class="row"><label style="flex:1">理由（取り消す時と設定を保存する時は必ず）<input type="text" id="lv-reason" maxlength="200" style="flex:1;min-width:16em"></label></div><p class="help" id="e-msg" role="alert"></p>';
    openDlg(dispName(s) + ' さんの有給', b, true);
    dlgCtx.init = formState();
  }
  /* その日の実働（分）。開いている月分と、有給のために読んだ月分の計算から探す（無ければ 0） */
  function workedMin(sid, d) {
    var ms0 = (month ? [month] : []).concat(leaveSt && leaveSt.months || []), w = 0;
    ms0.some(function (m) {
      var p = (m.people || []).filter(function (x) { return x.staff.staff_id === sid; })[0];
      var dd = p && p.days.filter(function (x) { return x.date === d; })[0];
      if (dd) { w = dd.workMin || 0; return true; }
      return false;
    });
    return w;
  }
  function numOrNull(v) { return v === '' || v == null ? null : +v; }
  function leaveAct(act, btn) {
    if (!dlgCtx || dlgCtx.mode !== 'leave' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), reason = ($('lv-reason').value || '').trim(), call = null, at = null, then2 = null;
    var needR = function () { if (!reason) { msg.textContent = '理由を書いてください。'; $('lv-reason').focus(); return false; } return true; };
    if (act === 'lv-use-add') {
      var ud = $('lv-u-date').value, un = +$('lv-u-days').value;
      if (!L.isDate(ud)) { msg.textContent = '使用の日付を入れてください。'; return; }
      /* 打刻（実働）がある日は確かめる（止めはしない・反証レビュー 2026-11-20） */
      var wm = workedMin(ctx.sid, ud);
      if (wm > 0 && !confirm(nameOf(ctx.sid) + ' さんは ' + md(ud) + ' に打刻があります（実働 ' + fm(wm) + '）。この日を有休にしますか？')) return;
      call = ['kintai_leave_use_add', { p_staff_id: ctx.sid, p_use_date: ud, p_days: un === 0.5 ? 0.5 : 1, p_note: ($('lv-u-note').value || '').trim() }]; at = ud;
    } else if (act === 'lv-use-void') {
      if (!needR()) return;
      call = ['kintai_leave_use_void', { p_id: btn.getAttribute('data-id'), p_reason: reason }]; at = btn.getAttribute('data-date');
    } else if (act === 'lv-grant-add') {
      var gd = $('lv-g-date').value, gn = +$('lv-g-days').value;
      if (!L.isDate(gd)) { msg.textContent = '付与日を入れてください。'; return; }
      if (!(gn >= 0.5 && gn <= 40) || gn * 2 !== Math.round(gn * 2)) { msg.textContent = '日数は 0.5〜40 日（0.5 日きざみ）で入れてください。'; return; }
      call = ['kintai_leave_grant_add', { p_staff_id: ctx.sid, p_grant_date: gd, p_days: gn, p_kind: $('lv-g-kind').value === 'manual' ? 'manual' : 'opening', p_note: ($('lv-g-note').value || '').trim() }];
      /* 移行の残りを足す時に移行日が空なら、移行日も入れる（付与を先に保存し、続けて設定へ。設定で断られても計算は移行の残りの付与日からみなす） */
      if (call[1].p_kind === 'opening' && !(ctx.prof && ctx.prof.opening_date)) {
        var od = $('lv-g-open') ? $('lv-g-open').value : '';
        if (!L.isDate(od)) { msg.textContent = '移行日（残りを数えた日）を入れてください。'; return; }
        if (od < gd) { msg.textContent = '移行日は、移行の残りの付与日より後の日にしてください。'; return; }
        then2 = ['kintai_leave_profile_put', { p_staff_id: ctx.sid, p_patch: { opening_date: od }, p_rev: ctx.rev, p_reason: reason || '移行の残りを入れたため、移行日も入れた' }];
      }
    } else if (act === 'lv-grant-void') {
      if (!needR()) return;
      call = ['kintai_leave_grant_void', { p_id: btn.getAttribute('data-id'), p_reason: reason }];
    } else if (act === 'lv-prof-save') {
      var p = ctx.prof || {}, patch = {}, ch = false;
      var hv = $('lv-p-hire').value || null, ov = $('lv-p-open').value || null, wd = numOrNull($('lv-p-wd').value), wh = numOrNull($('lv-p-wh').value);
      if ((hv && !L.isDate(hv)) || (ov && !L.isDate(ov))) { msg.textContent = '日付の形が違います。'; return; }
      if (wd != null && !(wd >= 0.5 && wd <= 7 && wd * 2 === Math.round(wd * 2))) { msg.textContent = '週の所定日数は 0.5〜7 日（0.5 日きざみ）で入れてください。'; return; }
      if (wh != null && !(wh > 0 && wh <= 168 && wh * 10 === Math.round(wh * 10))) { msg.textContent = '週の所定時間は 0 より大きく 168 時間までで入れてください（小数は1けたまで）。'; return; }
      var sk = [], cbs = document.querySelectorAll('#g-dlg-b [data-skip]'), shown = {};
      for (var i = 0; i < cbs.length; i++) { shown[cbs[i].getAttribute('data-skip')] = 1; if (cbs[i].checked) sk.push(cbs[i].getAttribute('data-skip')); }
      /* 画面に出していない付与しない日（移行日より前の分など）は、そのまま残す（黙って消さない） */
      (Array.isArray(p.skip_grants) ? p.skip_grants : []).forEach(function (d0) { if (!shown[d0] && sk.indexOf(d0) < 0) sk.push(d0); });
      sk.sort();
      var oldSk = (Array.isArray(p.skip_grants) ? p.skip_grants : []).slice().sort();
      if (hv !== (p.hire_date || null)) { patch.hire_date = hv; ch = true; }
      if (ov !== (p.opening_date || null)) { patch.opening_date = ov; ch = true; }
      if (wd !== (p.weekly_days != null ? +p.weekly_days : null)) { patch.weekly_days = wd; ch = true; }
      if (wh !== (p.weekly_hours != null ? +p.weekly_hours : null)) { patch.weekly_hours = wh; ch = true; }
      if (sk.join() !== oldSk.join()) { patch.skip_grants = sk; ch = true; }
      if (!ch) { msg.textContent = '変えた所がありません。'; return; }
      if (!needR()) return;
      call = ['kintai_leave_profile_put', { p_staff_id: ctx.sid, p_patch: patch, p_rev: ctx.rev, p_reason: reason }];
    }
    if (!call) return;
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-b'));
    rpc(call[0], call[1]).then(okOr).then(function () { return then2 ? rpc(then2[0], then2[1]).then(okOr) : null; }).then(function () {
      busy = false; toast('保存しました（' + nameOf(ctx.sid) + ' さんの有給）');
      var p2 = loadLeave(false);
      if (at && inPer(at)) p2 = p2.then(function () { return load(false); });   /* 手入力の有休はこの月分の計算にも入る（L8） */
      return p2;
    })['catch'](function (e) { busy = false; restore(); note('有給の保存', e); if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = leaveMsg(e); else toast('保存できませんでした: ' + leaveMsg(e)); });
  }

  /* ── 職員・締め・出力・設定 ── */
  function recode(sid, btn) {
    if (busy) return;
    var s = (data.staff || []).filter(function (x) { return x.staff_id === sid; })[0];
    if (!s || !confirm(dispName(s) + ' さんの打刻の番号を振り直します。今の番号 ' + s.code + ' はタブレットで使えなくなります。よろしいですか？')) return;
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
    /* CSV の氏名の列と、書き出した後の注意の文も表示名にそろえる（写しの name だけ替える・計算と控えの数字は変えない・統合 0107） */
    src = Object.assign({}, src, { people: (src.people || []).map(function (p) { return Object.assign({}, p, { staff: Object.assign({}, p.staff, { name: dispName(p.staff) }) }); }) });
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
  function setTab(t) { if (TABS.indexOf(t) < 0) t = 'day'; tab = t; lsSet(LS_TAB, t); paint(); if (t === 'day' || t === 'review') quietReload(); }
  function setYm(v, keepAuto) { if (!C.isYm(v) || v === ym) return; if (!keepAuto) autoYm = null; ym = v; lsSet(LS_YM, v); $('g-ym').value = v; shiftInfo = null; editsCache = null; data = null; month = null; paintPer(); load(true); }
  /* 「今日」: 今日のカレンダー月へ移り、その月分の期間に今日が入っていなければ次の月分へ（読んだ後に autoYm と同じ形で決める）。
     ymFor は ±1日の移動向けなので使わない（2か月以上離れた月分から押しても今日の月分へ行く・反証レビューの指摘1） */
  function goToday() {
    var td = C.jstDate(Date.now()), ty = td.slice(0, 7);
    selDate = td;
    /* 読み込みに失敗した後など期間が分からない時は、今日の月を（今開いている月なら読み直して）読んでから決める */
    if (!data) { autoYm = ty; if (ty === ym) load(true); else setYm(ty, true); return; }
    if (inPer(td)) { paint(); return; }
    if (ty === ym) { setYm(C.nextYm(ym)); return; }   /* 今日の月で今日が期間の後＝次の月分 */
    autoYm = ty; setYm(ty, true);
  }
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
        if (inp) { if (r !== 'その他') inp.value = r; else if (REASONS.indexOf(inp.value) >= 0 || SCHED_REASONS.indexOf(inp.value) >= 0 || FX_REASONS.indexOf(inp.value) >= 0) inp.value = ''; inp.focus(); }
      }
      else if (a === 'sched-time') {
        var sfx = b.getAttribute('data-n') || '', blk = dlgCtx && dlgCtx.blk;
        if (!blk || !blk.sched) return;
        var ks = $('e-kind' + sfx); if (!ks.value) ks.value = sfx ? 'out' : 'in';
        var v = ks.value === 'in' ? blk.schedStart : blk.schedEnd;
        $('e-date' + sfx).value = C.jstDate(v); $('e-time' + sfx).value = hm(v);
      }
      else if (a === 'addday') openAddDay();
      else if (a === 'work-open') openWork();
      else if (a === 'work-save') saveWork(b);
      else if (a === 'sched-open') openSched(tab === 'person' ? selStaff : null, selDate);
      else if (a === 'sched-day') { var sd = b.getAttribute('data-sid'), dd2 = b.getAttribute('data-date'); if (!dirty() || confirm('保存していない直しがあります。閉じて予定の窓を開きますか？')) { closeDlg(); openSched(sd, dd2); } }
      else if (a === 'sched-save') saveSched(b);
      else if (a === 'fx-open') openFixed(b.getAttribute('data-sid') || selStaff);
      else if (a === 'fx-save') saveFixed(b);
      else if (a === 'fx-void') voidFixed(b.getAttribute('data-id'), b);
      else if (a === 'fx-copy') { var mS = $('fx-s-1'), mE = $('fx-e-1'), mB = $('fx-b-1'), mK = $('fx-k-1'); [2, 3, 4, 5].forEach(function (i) { $('fx-k-' + i).value = mK.value; $('fx-s-' + i).value = mS.value; $('fx-e-' + i).value = mE.value; $('fx-b-' + i).value = mB.value; }); }
      else if (a === 'm-import') openImport();
      else if (a === 'm-import-go') runImport(b);
      else if (a === 'm-reload') { masterSt = null; loadMaster(); paint(); }
      else if (a === 'm-link') openLink(b.getAttribute('data-sid'));
      else if (a === 'm-link-go') saveLink(b);
      else if (a === 'm-link-m') openLinkM(b.getAttribute('data-mid'));
      else if (a === 'm-add') openAdd(b.getAttribute('data-mid'));
      else if (a === 'm-add-go') saveAdd(b);
      else if (a === 'm-vis') openClockVis(b.getAttribute('data-sid'));
      else if (a === 'm-vis-go') saveClockVis(b);
      else if (a === 'dname') openDispName(b.getAttribute('data-sid'));
      else if (a === 'dname-go') saveDispName(b);
      else if (a === 'lv-open') openLeave(b.getAttribute('data-sid'));
      else if (a === 'lv-reload') { leaveSt = null; loadLeave(true); paint(); }
      else if (a === 'lv-use-add' || a === 'lv-use-void' || a === 'lv-grant-add' || a === 'lv-grant-void' || a === 'lv-prof-save') leaveAct(a, b);
      else if (a === 'recode') recode(b.getAttribute('data-sid'), b);
      else if (a === 'import') { if (isLocked()) alert('締めた月は取り込めません。'); else load(true); }
      else if (a === 'lock') lockMonth(b);
      else if (a === 'unlock') unlockMonth(b);
      else if (a === 'csv-sum') download('sum');
      else if (a === 'csv-day') download('day');
      else if (a === 'edits') loadEdits();
      else if (a === 'save-set') saveSettings(b);
      else if (a === 'mgr-reload') { mgrSt = null; var gm = $('g-mgr'); if (gm) gm.innerHTML = mgrHtml(); loadMgr(); }
      else if (a === 'mgr-add-open') openMgrAdd();
      else if (a === 'mgr-del-open') openMgrDel(b.getAttribute('data-email'));
      else if (a === 'mgr-add-go') saveMgr(b, true);
      else if (a === 'mgr-del-go') saveMgr(b, false);
      else if (a === 'print') doPrint();
      else if (a === 'print-all') printAllPeople();
      else if (a === 'print-edits') printEdits();
      else if (a === 'dayf') { var f = b.getAttribute('data-f') || null; dayFilter = dayFilter === f ? null : f; paint(); }
      else if (a === 'day-move') moveDay(+b.getAttribute('data-n'));
      else if (a === 'day-today') goToday();
    });
    document.addEventListener('change', function (e) {
      var id = e.target && e.target.id;
      if (id === 'g-date') { selDate = e.target.value; paint(); }
      else if (id === 'g-staff') { selStaff = e.target.value; paint(); }
      else if (id === 'g-only') { onlyReview = e.target.checked; paint(); }
      else if (id === 'g-office') { officeFilter = e.target.value; paint(); }
      else if (id === 'g-ym') setYm(e.target.value);
      else if (e.target && e.target.name === 'sc-op' && $('sc-times')) $('sc-times').disabled = e.target.value !== 'set';
      else if ((id === 'sc-sid' || id === 'sc-from') && dlgCtx && dlgCtx.mode === 'sched') schedRefill();
      else if (e.target && e.target.name === 'fx-mode' && $('fx-week')) $('fx-week').disabled = e.target.value === 'none';
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
      /* 0111: 予定の窓で始業・終業を変えたら、前の予定から入れた休憩は空に戻す（いつもの決まりで決め直す。手で入れた休憩は残す） */
      if ((id === 'sc-start' || id === 'sc-end') && dlgCtx && dlgCtx.mode === 'sched' && dlgCtx.preBr && $('sc-break') && $('sc-break').value === dlgCtx.preBr) { $('sc-break').value = ''; dlgCtx.preBr = ''; }
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
    /* 日ごと・要確認を開いている間は30秒ごとに打刻を読み直して数え直す（タブレットの打刻を再読み込みなしで出す・2026-11-20 代表者の指示）。
       画面が隠れている間は休み、見えた時・日ごと／要確認のタブへ移った時はすぐ読み直す */
    setInterval(function () { quietReload(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') quietReload(); });
  }

  /* 黙って読み直す（日ごと・要確認だけ）: 窓・保存中・印刷中・選ぶ欄の操作中・ほかの読み込み中は何もしない。
     読めない時は手元の時刻で数え直すだけ（帯は出さない・記録に残す）。届いた時に月やタブが変わっていれば捨てる */
  var quietBusy = 0, quietSeq = 0;
  function quietOk() {
    if (view !== 'app' || busy || !month || !data || dlgCtx || printAll || (tab !== 'day' && tab !== 'review')) return false;
    if (document.visibilityState === 'hidden') return false;
    var ae = document.activeElement;
    return !(ae && ae.tagName === 'SELECT' && $('g-main').contains(ae));
  }
  function quietReload() {
    if (!quietOk()) return;
    /* 前の読み直しの答えがまだ来ない間は、手元の時刻で数え直すだけ（勤務中・まだ出勤していないの印を止めない）。
       20秒で答えが来なければ諦めて次から読み直す（届いた古い答えは番号で捨てる） */
    if (quietBusy && Date.now() - quietBusy < 20000) { recompute(); paint(); return; }
    var my = gen, atYm = ym, seq = ++quietSeq; quietBusy = Date.now();
    rpc('kintai_month_get', { p_ym: ym }).then(okOr).then(function (d) {
      if (seq !== quietSeq) return;
      quietBusy = 0;
      if (my !== gen || atYm !== ym || !quietOk()) return;
      data = d;
      recompute(); paint();
      sync(isLocked() ? '締め済みの月です' : '読み込みました（' + hm(Date.now()) + '）');
    })['catch'](function (e) {
      if (seq !== quietSeq) return;
      quietBusy = 0;
      note('自動の読み直し', e);
      if (my === gen && atYm === ym && quietOk()) { recompute(); paint(); }
    });
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
      autoYm = C.isYm(y) ? null : ym;
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
