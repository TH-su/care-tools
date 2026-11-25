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
 * ・v5 段2・3（2026-11-20・仕様書 ROOT-v5-freee.md）: 先頭のタブ「ホーム」（箱は kintai-monitor.js・勤務の決まりは kintai-rules.js）と36協定の判定（kintai-36.js）。
 *   36協定の月の列は有給のタブと同じ読み込み（loadLeaveMonths）の月分を使い回す（往復を増やさない）。どれも画面の中だけで、端末に残さない
 * ・v5 段5（2026-11-21・仕様書 ROOT-v5-freee.md「段5」「段5 の設計の改め」・care-backend 統合 0114）: タブ「申請」（kintai_requests_list・kintai_requests_decide）・
 *   ホームの箱「申請の承認待ち」・締めの画面の承認待ちと「確かめた人 n／m」・「職員と番号」の「スマホを登録」（管理者だけ・kintai_self_enroll_issue）と
 *   「スマホの一覧」（kintai_self_devices・kintai_self_device_revoke）。読み込みは月の読み込みの鎖に入れず、自分の世代で捨てる。
 *   登録の番号（QR の40字と8文字）は窓の中の絵と文字にだけ持ち、窓を閉じた時・期限の時に消す（端末に残さない・印刷しない）。
 *   関数がまだ無い（0114 の前）時は、それぞれの欄に「データベースの更新がまだです」と出し、聞き直さない（自動の報告にも回さない）
 * ・段A1（2026-11-25・仕様書 ROOT-v7-plus-parity.md「段A1 の凍結した仕様」・care-backend 統合 0127）: 日ごとの補助項目（移動距離・健診など手で入れる項目）。
 *   定義は設定の鍵 extraItems（設定のタブの「補助項目」）・日の行は kintai_extras_get／kintai_extra_put／kintai_extra_void・純関数は kintai-extras.js。
 *   個人の月で入れる・直す・取り消す。月の集計と日ごとの CSV の末尾に列を足す（今の列の並びは変えない）。関数がまだ無い時は補助項目の欄をどこにも出さない
 */
(function () {
  'use strict';
  var C = window.KintaiCalc, L = window.KintaiLeave, K36 = window.Kintai36, MON = window.KintaiMonitor, RUL = window.KintaiRules, EX = window.KintaiExtras;
  var TABS = ['home', 'day', 'review', 'requests', 'grid', 'person', 'staff', 'leave', 'close', 'settings'];
  var LS_TAB = 'kintai_tab', LS_YM = 'kintai_ym';
  var gen = 0, view = 'boot', tab = 'home', ym = null, data = null, month = null, shiftInfo = null;
  var selDate = null, selStaff = null, onlyReview = false, role = null, busy = false, editsCache = null;
  /* v2: 日ごとの札の絞り込み（working / notin / review / absent）・事業所の絞り込み・全員分の印刷（どれも端末に残さない） */
  var dayFilter = null, officeFilter = '', printAll = false;
  /* v4: 職員マスタの一覧・突き合わせの結果・有給の記録（どれも画面の中だけ・端末に残さない） */
  var masterSt = null, masterBusy = false, importResult = null, leaveSt = null, leaveBusy = false, leaveGen = 0;
  /* v5 1-5: 勤怠の管理者の名簿（管理者の時だけ読む・画面の中だけ・端末に残さない） */
  var mgrSt = null, mgrBusy = false, mgrGen = 0;
  /* v5 段5: 申請の一覧（タブの絞り込みごと）・承認待ちの数と月の確認の数（ホームと締めの画面）・スマホの登録の窓（どれも画面の中だけ・端末に残さない）。
     reqF.ym は '' ＝すべての月分・'cur' ＝表示中の月分（仮置き: 既定は承認待ち・すべての月分＝ホームの箱の数と一覧の行がそろう） */
  var reqSt = null, reqBusy = false, reqGen = 0, reqF = { status: 'pending', ym: '' };
  var reqSum = null, reqSumBusy = false, reqSumGen = 0, reqNoDb = false, enrollSt = null;
  /* v5 段3: この画面で開いた月分の計算（36協定の月の列に使う・画面の中だけ）。v5 C4: 設定タブを描いた時の入力の値（保存していない変更を確かめる） */
  var monthCache = {}, setInit = null;
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
  var NG = { locked: 'この月は締めてあるため直せません。直す時は管理者が締めを解除してください。', lead: 'この日は、次の締めた月分の週40時間の数えに使う日（締めた月分の前の7日）のため直せません。直す時は管理者が次の月分の締めも解除してください。', conflict: '別の人が先に直しました。読み直してから、もう一度直してください。',
    reason: '理由を書いてください。', notfound: '見つかりませんでした。読み直してください。', already: 'もう取り消してあります。', badrow: 'シフトの行の形が違いました。',
    toobig: '設定が大きすぎます。', stale: '時刻が古すぎます。', notlocked: 'この月はもう締めが解除されています。読み直してください。',
    badym: '月の形が違います。', badshape: '送った値の形が違いました。読み直してください。', badkind: '出勤か退勤を選んでください。',
    badtime: '時刻の形が違います。', baddate: '日付の形が違います。', badkey: '直せない項目が入っていました。',
    badvalue: '入れた値を受け付けられませんでした（休憩は 0〜600 分・メモは 400 字まで・認める時刻はその日の前日〜翌日の中）。',
    clientid: '同じ打刻がもう記録されています。', notyet: '月末を過ぎてから締められます。',
    a2_noextras: '補助項目が読めません。締めていません（給与へ渡す記号の組・通勤回数・社内会議の数が控えに入らないため）。通信（Wi-Fi）を確かめて、もう一度「締める」を押してください。', a2_noparts: '補助項目の部品を読み込めませんでした。締めていません。ページを読み込み直してください。', a2_meetunset: '社内会議を時間外に足すかを、設定のタブで保存してから締めてください',   /* 段A2（文は仮置き） */
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
    review: '要確認が残っているため締められません（前の版の画面から締めようとした時など）。読み直して、要確認を1件ずつ「認める／認めない」で決めてから締めてください。',   /* 0120 */
    payrolllocked: 'この月分の給与が確定（または書き出し済み）のため、締めを解除できません。先に給与の画面で確定を取り消してください。' };   /* v5 1-2（文は仮置き） */
  /* 有給の窓では、打刻向けの言い方の断り（badkind・badvalue）を有給の言葉に替える */
  var NG_LEAVE = { badkind: '付与の種類が違います（移行の残りか、手で足すかを選んでください）。', badvalue: '入れた値を受け付けられませんでした（日数・週の所定日数・時間・メモの長さを確かめてください）。',
    locked: 'その日は締めた月分に入っているため、足すことも取り消すこともできません。直す時は管理者が締めを解除してください。',
    dup: 'その日の有休の使用はもう入っています（同じ人・同じ日は1つまで）。または、その日の時間単位の有休・有給の特別休暇と合わせると1日の時間を超えます。直す時は、今の使用か休みを取り消してから足してください。' };   /* 反証レビュー（2026-11-20）: DB が重ねでも dup で断るので文を足した（仮置き） */
  function leaveMsg(e) { return e && e.kintai && NG_LEAVE[e.kintai] ? NG_LEAVE[e.kintai] : msgOf(e); }
  /* v5 段4: 有給の窓の「休暇」（時間単位の有休・特別休暇・代休・振替休日・統合 0113）の断りの文（文は仮置き） */
  var NG_ABS = { locked: 'その日（代休の元の日・振替の働く日を含む）は締めた月分に入っているため、入れることも取り消すこともできません。直す時は管理者が締めを解除してください。',
    dup: 'その日のこの種類の休暇はもう入っているか、その日の有給の休み（手入力の有休・時間単位の有休・有給の特別休暇）を合わせると1日の時間を超えます。直す時は、今の行を取り消してから入れてください。',
    badkind: '休暇の種類が違います。時間単位の有休は、設定で「時間単位の有休を使う」にした時だけ入れられます。',
    badvalue: '入れた値を受け付けられませんでした（時間単位は1時間きざみで1日の所定の時間まで・特別休暇は種類を選ぶ・代休の元の日と振替の働く日は休む日と別の日・メモは200字まで）。',
    baddate: '日付の形が違うか、受け付けられる範囲の外です。休暇は来月分までの日付で入れてください。',
    notfound: '見つかりませんでした（勤怠の職員にいないか、もう無い行です）。読み直してください。',
    already: 'もう取り消してあります。読み直してください。', reason: '理由を書いてください。' };
  function absMsg(e) { return e && e.kintai && NG_ABS[e.kintai] ? NG_ABS[e.kintai] : msgOf(e); }
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
  /* 不具合の自動報告に回さない失敗の見分け（2026-11-20・夜間修復の要情報 reports#14・#15 の原因）。
     supabase-js は通信そのものの失敗（Wi-Fi の切り替え・スリープ明けなど）を投げずに、素のオブジェクト
     { message: 'TypeError: Failed to fetch', code: '' } で返し、rpc() がそれを投げる。権限の断り（42501）も素のオブジェクトで来る。
     画面のコードの例外（recompute・paint の TypeError など）は Error の形で来るので、ここでは拾わない＝本物の不具合は今までどおり報告される */
  function isNetErr(e) {
    if (!e || typeof e !== 'object' || e instanceof Error) return false;
    return /failed to fetch|networkerror|network error|load failed/i.test(String(e.message || ''));
  }
  /* 断りは「勤怠の DB 関数が自分で投げた文」の時だけ（kintai_can() が偽）。関数の実行権の付け外しの誤り（permission denied for function …）や
     ログインが切れて anon で届いた時の 42501 は文が違うので拾わない＝今までどおり報告される（反証レビュー 2026-11-20 の指摘3） */
  var DENIED_MSG = '勤怠の管理を許された事務所・管理者だけが使えます';
  function isDenied(e) { return !!e && typeof e === 'object' && !(e instanceof Error) && e.code === '42501' && e.message === DENIED_MSG; }
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
              /* 段A2: 同行の印（companion）を受けない DB（統合 0129 の前）は知らない鍵を badrow で断る。印のある行がある時だけ、印を外して1回だけ送り直す
                 （2回目も断られたら今と同じ失敗・取り込みの順に関係なく止めない） */
              if (res && res.ok === false && res.error === 'badrow' && bt.rows.some(function (x) { return x && 'companion' in x; })) {
                note('予定の取り込み', new Error('同行の印を外して送り直した'));
                var plain = bt.rows.map(function (x) { var y = {}; for (var k in x) if (k !== 'companion') y[k] = x[k]; return y; });
                return rpc('kintai_schedule_put', { p_ym: bt.cm, p_rows: plain });
              }
              return res;
            }).then(function (res) {
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
      busy = false; quietNetFails = 0; sync(isLocked() ? '締め済みの月です' : '読み込みました（' + hm(Date.now()) + '）');   /* 読めたので、読み直しの「続けての通信の失敗」を数え直す（指摘4） */
      paintPer();
      editsCache = null;
      paint();
      loadExtras(true);   /* 段A1: 補助項目の日の行（月の読み込みの鎖の外・失敗しても月の画面は止めない） */
      /* 職員の並び（入職順）に職員マスタの入職日を使うので、まだ読んでいなければ裏で読む（読めない時は番号の順のまま） */
      if (!masterSt && !masterBusy) loadMaster();
    })['catch'](function (e) {
      if (my !== gen) return;
      /* 事務所のアカウントが勤怠の DB 関数に断られた時（「勤怠の管理者」に載っていない・アカウントが止まっている等）は、
         画面の帯で知らせて管理者に確かめてもらうだけにし、不具合の自動報告に回さない（reports#14 は載っていない事務所のアカウントの断りだった）。
         管理者の断り・通信の失敗・そのほかは今までどおり報告する（読み込みの通信の失敗は黙らせない＝反証レビュー 2026-11-20 の指摘2） */
      var denied = isDenied(e) && role !== 'admin';
      if (!denied) note('読み込み', e);
      busy = false; data = null; month = null; sync(''); $('g-main').removeAttribute('aria-busy');
      var bandMsg = denied ? 'このアカウントには勤怠管理を使う許可がありません（「勤怠の管理者」に載っていない、アカウントが止まっている など）。使う必要がある時は、管理者に確かめてもらってください（管理者は勤怠管理の「設定」タブの「勤怠の管理者」で追加できます）。' : msgOf(e);
      $('g-main').innerHTML = '<div class="band ng" role="alert">' + esc(bandMsg) + '</div>';
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
    month = C.computeMonth({ ym: ym, period: data.period, staff: staffSorted(), schedule: data.schedule || [], punches: data.punches || [], days: data.days || [], leave_uses: data.leave_uses, config: cfg, absences: data.absences, lockedAt: data.month && data.month.locked_at, now: Date.now() });
    month.k36 = k36Info(data);
    monthCache[ym] = month;
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
    /* v5 段5: 申請のタブの札（事業者の全部の月分の承認待ちの数・読めた時だけ） */
    var rn = reqSum && !reqSum.err ? reqSum.pending : 0, rel = $('g-rq-n');
    if (rel) {
      rel.textContent = rn ? String(rn) : '';
      if (rel.parentNode) rel.parentNode.setAttribute('aria-label', '申請' + (reqSum && !reqSum.err ? '（承認待ち ' + rn + ' 件）' : ''));
    }
  }
  function bands() {
    var h = '';
    if (isLocked()) h += '<div class="band ok" role="status">この月は締めてあります（' + esc(new Date(data.month.locked_at).toLocaleString('ja-JP')) + '）。直しと承認はできません。タブレットの打刻は締めた後も記録され、「締めた後の打刻」の印が付きます。直す時は管理者が「締めと出力」で締めを解除します。</div>';
    if (shiftInfo && !shiftInfo.ok) h += '<div class="band warn" role="status">' + esc(shiftInfo.why) + '</div>';
    if (shiftInfo && shiftInfo.ok && !shiftInfo.confirmed) h += '<div class="band warn" role="status">この月のシフトはまだ「確定」していません。シフトが変わると予定も変わります（開くたびに取り込み直します）。</div>';
    if (shiftInfo && shiftInfo.ok && shiftInfo.missing && shiftInfo.missing.length) h += '<div class="band warn" role="status">' + esc(shiftInfo.missing.map(function (cm) { return (+cm.slice(5)) + '月'; }).join('・')) + 'のシフトがまだ無いため、その月の日の予定は取り込んでいません。</div>';
    if (shiftInfo && shiftInfo.ok && shiftInfo.skipped) h += '<div class="band" role="status">締めてある月分の日と、その前後の日（' + esc(String(shiftInfo.skipped)) + ' 件の予定）は、シフトを取り込んでも変えていません。直す時は予定の手直しを使ってください。</div>';
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
    if (!reqSumFresh()) loadReqSum(false);   /* v5 段5: 申請の承認待ちの数（タブの札・ホームの箱・締めの画面）。1分より古い時だけ・関数が無い時は聞かない */
    var f = { home: paintHome, day: paintDay, review: paintReview, requests: paintRequests, grid: paintGrid, person: paintPerson, staff: paintStaff, leave: paintLeave, close: paintClose, settings: paintSettings }[tab];
    m.innerHTML = bands() + f();
    setInit = tab === 'settings' && $('g-set') ? settingsState() : null;   /* v5 C4: 描いた時の設定の入力（保存していない変更を確かめる） */
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
      '<p class="help">「数えた時刻」は予定に合わせて丸めた時刻です（予定より早い出勤は予定の開始、予定より遅い退勤は予定の終わり）。打刻はそのまま残っています。早出・残業を認める時は「直す」から。「出勤中」は退勤の時刻がまだ来ていない人で、要確認には数えません。この画面は30秒ごとに読み直して数え直します。</p></div>';
  }

  /* ── v5 段2・3: ホーム（勤怠モニター）と36協定（2026-11-20・仕様書 ROOT-v5-freee.md）──
   * 箱は KintaiMonitor.boxes で作る（今日・要確認・36協定・有給・締め・勤務の決まり。申請の箱は段5の後まで出さない＝requests: null）。
   * 有給・36協定・締めの箱は、有給のタブと同じ読み込み（loadLeave → loadLeaveMonths）を最初の描画の後に裏で読み、読めてから出す（読む間は「読み込み中」）。
   * 読めなかった時は箱に知らせを出し、30秒ごとの読み直しで試し直さない（「読み直す」で試す）。画面だけで印刷しない */
  /* 今の設定（kintai_settings.config）。締めた月分を開いていても、36協定の上限と決まりの見張りは今の設定で見る */
  /* v5（反証レビュー 2026-11-20）: 「読み直す」・シフトの取り込みでは、前に開いた月分の控え（monthCache）と、さかのぼりの月分の控え（有給の記録）を捨てて読み直す
     （ほかの端末で締めた月分などを古い計算のまま出さない）。読み込み中の有給の答えは世代で捨てる。開いている月分は recompute が新しい結果で置き換える */
  function dropMonthCaches() { monthCache = {}; leaveSt = null; leaveBusy = false; leaveGen++; if (typeof a2Ex36Reset === 'function') a2Ex36Reset(); }   /* 段A2: 36協定に使うほかの月分の補助項目も捨てる */
  function rawCfg() { return (data && data.settings && data.settings.config) || {}; }
  /* 月分の締めの様子（36協定の月の列は、締めた月分は控えの値・締めていない月分は数えた値を使う） */
  function k36Info(d) {
    var lk = !!(d && d.month && d.month.locked_at), snap = lk ? d.month.snapshot : null;
    return { locked: lk, rows: snap && Array.isArray(snap.rows) ? snap.rows : null, snapCfg: snap && snap.config && typeof snap.config === 'object' ? snap.config : null,
      ext: snap && EX && EX.isExt && EX.isExt(snap.ext) ? snap.ext : null };   /* 段A2: 締めた時の会議の足し分（36協定の見張りに足す） */
  }
  /* 読んだ月分（有給の読み込みの月分と、この画面で開いた月分。開いている月分は今の計算） */
  function monthsBy() {
    var by = {}, k;
    (leaveSt && !leaveSt.err && Array.isArray(leaveSt.months) ? leaveSt.months : []).forEach(function (m) { if (m && m.ym) by[m.ym] = m; });
    for (k in monthCache) by[k] = monthCache[k];
    if (month) by[ym] = month;
    return by;
  }
  function hireOfStaff(s) { var m = masterOf(s), prof = leaveSt && leaveSt.profiles ? leaveSt.profiles[s.staff_id] : null; return L ? L.hireOf(m && m.hire_date, prof) : null; }
  /* 1人分の月の行（Kintai36.judge の months の1行）。締めた月分は控えの丸める前の値（無い古い控えは丸めた値・raw36 に印）、締めていない月分は数えた値 */
  function row36(mm, sid, ymx, old, mmiss) {
    var k = mm.k36 || {}, cfg0 = k.locked && k.snapCfg ? k.snapCfg : (mm.config || {});
    var known = C.checkLegalHoliday(cfg0.legal_holiday).value != null, legal = 0, hol = 0;
    if (k.locked && k.rows) {
      var r = k.rows.filter(function (x) { return x && x.staff_id === sid; })[0];
      if (r) {
        legal = typeof r.legalOverRawMin === 'number' ? r.legalOverRawMin : (+r.legalOverMin || 0);
        hol = typeof r.holidayRawMin === 'number' ? r.holidayRawMin : (+r.holidayMin || 0);
        if (typeof r.legalOverRawMin !== 'number' && cfg0.monthRound30 === true) old.push(ymx);
        /* 段A2（反証レビュー1回の5）: 締めた月は控えの会議の足し分（丸める前・休日分は adj.holidayMin−行の holidayMin）を足す（知らせだけ・判定の式は変えない） */
        var er = k.ext && k.ext.rows ? k.ext.rows[sid] : null, mt = er && EX.meeting36 ? EX.meeting36(er.adj, r) : null;
        if (mt) { legal += mt.non; hol += mt.hol; }
      }
    } else {
      var p = (mm.people || []).filter(function (x) { return x.staff && x.staff.staff_id === sid; })[0];
      if (!p) return null;
      legal = typeof p.sum.legalOverRawMin === 'number' ? p.sum.legalOverRawMin : p.sum.legalOverMin;
      hol = typeof p.sum.holidayRawMin === 'number' ? p.sum.holidayRawMin : p.sum.holidayMin;
      /* 段A2: 締めていない月は読んだ補助項目の時間の行から（今開いている月分だけ。ほかの締めていない月分は読んでいないので足さない・仮置き） */
      if (typeof exReady === 'function' && exReady() && ymx === ym && EX.meetingSplitOf) { var ms0 = EX.meetingSplitOf(mm, exSt.rows, rawCfg(), sid); legal += ms0.non; hol += ms0.hol; }
      /* ほかの締めていない月分は、その月分の補助項目を読んで足す（反証レビュー1回の5）。読めない月分は足さずに知らせる（知らせだけ）。読んでいる途中は足さない（読み終わったら描き直す） */
      else if (typeof a2Ex36Of === 'function') {
        var xe = a2Ex36Of(ymx);
        if (xe && xe.rows) { var ms1 = EX.meetingSplitOf(mm, xe.rows, rawCfg(), sid); legal += ms1.non; hol += ms1.hol; }
        else if (xe && xe.err && mmiss && mmiss.indexOf(ymx) < 0) mmiss.push(ymx);
      }
    }
    return { ym: ymx, legalOverMin: legal, holidayMin: hol, locked: !!k.locked, holidayKnown: known };
  }
  /* その月分の36協定の判定（職員ごと）。返す: { staff_id → { staff_id, name, items, holidayUnknown, agreement, old:[丸めた値で読んだ月分] } }（部品・月分が無ければ null）。
     入職日より前の月は記録0の月として渡す（入職したばかりの人に「記録が無い」を出し続けない・仮置き） */
  function a36Map(ymx) {
    /* 月の列は有給の読み込みの月分が要る（読めるまでは判定しない＝帯は今の計算の警告のまま・箱は「読み込み中」） */
    if (!K36 || !month || !leaveSt || leaveSt.err || !Array.isArray(leaveSt.months)) return null;
    var by = monthsBy(), cur = by[ymx];
    if (!cur) return null;
    /* 読み込みが止まった所（予定も有休も無い月分が3つ続いた先・入職日の下限・24か月前）より前の月は、記録0の月として渡す（仮置き）。
       見ている月分が読んだ範囲の中にある時だけ（それより古い月分を見ている時は、読んでいない月を0にしない） */
    var lds = leaveSt.months.map(function (m) { return m && m.ym; }).filter(C.isYm).sort(), oldest = lds.length ? lds[0] : null, zeroBelow = !!oldest && ymx >= oldest;
    var cfg = rawCfg(), td = today(), out = {}, per0 = cur.period || C.periodOf(ymx, null);
    var partial = !(cur.k36 && cur.k36.locked) && td >= per0.from && td <= per0.to;
    var opts = partial ? { elapsedDays: C.periodDays({ from: per0.from, to: td }), periodDays: C.periodDays(per0) } : {};
    (cur.people || []).forEach(function (p) {
      var s = p.staff, sid = s.staff_id, hire = hireOfStaff(s), list = [], old = [], mmiss = [], y = ymx;
      for (var i = 0; i < 12; i++) {
        var mm = by[y], r = mm ? row36(mm, sid, y, old, mmiss) : null;
        if (!r && ((hire && y < hire.slice(0, 7)) || (zeroBelow && y < oldest))) r = { ym: y, legalOverMin: 0, holidayMin: 0, locked: true, holidayKnown: true };
        if (r) { if (y === ymx) r.partial = partial; list.push(r); }
        y = C.prevYm(y);
      }
      var j = K36.judge(list, ymx, cfg, opts);
      if (j) out[sid] = { staff_id: sid, name: dispName(s), items: j.items, holidayUnknown: j.holidayUnknown, agreement: j.agreement, old: old, mmiss: mmiss };
    });
    return out;
  }
  function oldNote(yms) { return yms.length ? '締めた時の控えに丸める前の時間が無い月分（' + yms.map(function (y) { return (+y.slice(5, 7)) + '月分'; }).join('・') + '）は、30分で丸めた時間で見ています' : ''; }
  /* 個人の月の警告の帯: 計算の警告（月の法定外が目安以上）は、36協定の月の目安が同じ値の時は今の文のまま出し、判定の同じ文（month_warn）を重ねない。
     目安を36協定の設定で変えた時は計算の文を出さず、判定の文を出す */
  function warnLines(p, a36) {
    var w = p.sum.warnings.slice(), j = a36 && a36[p.staff.staff_id];
    if (!j) return w;
    var th = month.config.overtimeMonthWarnH, same = j.agreement.monthWarnH === th;
    var calcWarn = '法定外の時間が月' + th + '時間以上です（36協定の確認）';
    if (!same) w = w.filter(function (x) { return x !== calcWarn; });
    j.items.forEach(function (it) { if (!(same && it.code === 'month_warn')) w.push('36協定: ' + it.text); });
    if (j.old.length) w.push(oldNote(j.old));
    if (j.mmiss && j.mmiss.length) w.push(a2MissNote(j.mmiss));   /* 段A2: 会議の時間を足せていない月分（知らせだけ） */
    return w;
  }
  /* 締めていない過去の月分（期間が今日より前で、締めておらず、記録のある月分・仮置き: 記録の無い月分は数えない） */
  function unlockedPast(by) {
    var td = today(), out = [];
    for (var y in by) {
      var mm = by[y], pr = mm.period;
      if (!pr || pr.to >= td || (mm.k36 && mm.k36.locked)) continue;
      if ((mm.people || []).some(function (p) { return p.days && p.days.length; })) out.push(y);
    }
    return out.sort();
  }
  /* 有給の箱の行（年5日と、期限まで90日以内の残り・仮置き） */
  function leaveRows() {
    var td = today();
    return staffSorted().filter(function (s) { return s.active !== false; }).map(function (s) {
      var x = leaveOf(s), soon = x.sm.balance.soon, near = soon && L.diffDays(td, soon.expires) <= 90;
      return { staff_id: s.staff_id, name: dispName(s), ob: x.sm.obligation, expiringDays: near ? soon.days : 0, expiringText: near ? dTxt(soon.days, s.staff_id) : '', expires: near ? soon.expires : null };   /* v5 段4: 有給の画面と同じ書き方の日数の文（半日きざみは「12.5 日」・時間単位の端数は「12 日 5 時間」） */
    });
  }
  var BOX_UNIT = { today: '人', review: '件', a36: '人', leave: '人', close: '月分', rules: '人' };
  var LV_JA = { ok: 'なし', warn: '注意', alert: '要対応' };
  function boxHtml(b, attrs, body) {
    var rows = (b.rows || []).slice(0, 5).map(function (r) { return '<span class="hl">' + (r.name ? '<b>' + esc(r.name) + '</b> ' : '') + esc(r.text) + '</span>'; }).join('');
    var more = (b.rows || []).length > 5 ? '<span class="hl">ほか ' + ((b.rows || []).length - 5) + ' 件（押すと一覧を開きます）</span>' : '';
    return '<button type="button" class="hbox ' + esc(b.level) + '" ' + attrs + '><span class="ht"><span>' + esc(b.title) + '</span><span class="hn">' + b.count + ' <small>' + (BOX_UNIT[b.key] || '件') + '</small></span></span>' +
      '<span class="hv">' + LV_JA[b.level] + '</span>' + (body || '') + rows + more + (b.note ? '<span class="hnote">' + esc(b.note) + '</span>' : '') + '</button>';
  }
  function waitBox(title, txt, err) {
    return '<div class="hbox wait"><span class="ht"><span>' + esc(title) + '</span></span><span class="hl">' + esc(txt) + '</span>' + (err ? '<span class="hl"><button type="button" class="btn" data-act="lv-reload">読み直す</button></span>' : '') + '</div>';
  }
  function paintHome() {
    var h = '<div class="cd no-print">';
    if (!MON) return h + '<div class="band ng" role="alert">ホームの部品を読み込めませんでした。ページを読み込み直してください。</div></div>';
    if (L && !leaveSt && !leaveBusy) loadLeave(false);   /* 重い読み込み（有給と36協定の月分）は最初の描画の後に裏で（読めたら描き直す） */
    var td = today(), inP = inPer(td), lv = leaveSt && !leaveSt.err ? 'ok' : leaveSt && leaveSt.err ? 'err' : 'wait';
    var input = { today: td, month: month, reviewList: C.reviewList(month), requests: reqSum && !reqSum.err && reqSum.ym === ym ? reqSum.pending : null };
    ntLoad(false); devLoad();   /* v6: 打刻漏れの知らせとスマホの登録（読めたら描き直す） */
    if (RUL) input.rules = RUL.checkMonth(month, rawCfg());
    var a36 = null;
    if (lv === 'ok') {
      a36 = a36Map(ym);
      input.leaveRows = leaveRows();
      input.unlockedPast = unlockedPast(monthsBy());
      if (a36) input.a36Rows = Object.keys(a36).map(function (k) { return a36[k]; });
    }
    var bx = MON.boxes(input), out = [];
    bx.forEach(function (b) {
      if (b.key === 'today') {
        if (!inP) { out.push(boxHtml({ key: 'today', title: '今日', count: 0, level: 'ok', rows: [] }, 'data-act="day-today"', '<span class="hl">今日（' + esc(md(td)) + '）はこの月分に入っていません。押すと今日の月分を開きます。</span>')); return; }
        var c = b.counts;
        out.push(ntWrap(boxHtml(b, 'data-tab="day" data-date="' + esc(td) + '"', '<span class="hl">出勤予定 ' + c.scheduled + '・出勤済み ' + c.clockedIn + '・勤務中 ' + c.working + '・まだ出勤していない ' + c.notInYet + '</span>'), noticeHtml('not_in')));
        return;
      }
      if (b.key === 'a36') {
        var olds = []; for (var k in a36) a36[k].old.forEach(function (y) { if (olds.indexOf(y) < 0) olds.push(y); });
        if (olds.length) b.note = (b.note ? b.note + '。' : '') + oldNote(olds.sort());
        var mms = []; for (var k2 in a36) (a36[k2].mmiss || []).forEach(function (y) { if (mms.indexOf(y) < 0) mms.push(y); });
        if (mms.length) b.note = (b.note ? b.note + '。' : '') + a2MissNote(mms.sort());   /* 段A2: 会議の時間を足せていない月分 */
      }
      var bh = boxHtml(b, 'data-tab="' + esc(b.tab) + '"' + (b.key === 'requests' ? ' data-rq="pending"' : ''));
      out.push(b.key === 'review' ? ntWrap(bh, noticeHtml('missing')) : bh);   /* v6: 打刻漏れの行に「知らせる」 */
      if (b.key === 'review' && lv !== 'ok') {
        /* 36協定・有給・締めの箱は読めるまで「読み込み中」（読めなかった時は知らせと「読み直す」） */
        var t0 = lv === 'err' ? '読み込めませんでした（' + leaveSt.err + '）' : '読み込み中…（月分をさかのぼって読むため、少し時間がかかります）';
        out.push(waitBox('36協定', t0, lv === 'err'), waitBox('有給（年5日・期限の近い残り）', t0, lv === 'err'), waitBox('締めていない月分', t0, lv === 'err'));
      }
      if (b.key === 'review' && lv === 'ok' && !a36) out.push(waitBox('36協定', K36 ? 'この月分の記録を読めていないため、判定できません。' : '36協定の部品を読み込めませんでした。ページを読み込み直してください。', false));
    });
    if (!reqSum || reqSum.ym !== ym) out.push(waitBox('申請の承認待ち', '読み込み中…', false));
    else if (reqSum.err) out.push(waitBox('申請の承認待ち', reqSum.err, false));
    return h + '<h2 style="font-size:16px;margin:0 0 4px">' + esc(perLabel()) + 'のようす</h2><p class="help">箱を押すと、その一覧の画面へ移ります。今日・要確認・勤務の決まりは30秒ごとに読み直します。勤務の決まり（休憩・勤務の間・続けて働いた日）は知らせだけで、数えた時間は変えません。</p>' +
      '<div class="hgrid">' + out.join('') + '</div></div>';
  }

  /* 要確認の一覧（v2・C-2）: 月の要確認を日付順に1列 */
  function nameOf(sid) { var p = personOf(sid); return p ? dispName(p.staff) : sid; }
  function paintReview() {
    var list = C.reviewList(month);
    if (!list.length) return printHead('要確認の一覧') + '<div class="cd"><div class="band ok" role="status">要確認はありません。締めに進めます。</div>' + a2OverBand() + '<div class="row no-print"><button type="button" class="btn" data-tab="close">締めと出力へ</button></div></div>';
    var rows = list.map(function (r, i) {
      var p = personOf(r.staffId), d = p && p.days.filter(function (x) { return x.date === r.date; })[0], b = d && d.blocks[r.blockIndex];
      return '<tr><td>' + md(r.date) + '（' + wd(r.date) + '）</td><td>' + esc(nameOf(r.staffId)) + '</td><td>' + (b ? schedText(b) : '') + '</td><td class="raw">' + (b ? esc(rawPunches(b)) : '') + '</td><td>' + flagTags(r.marks, false) + '</td>' +
        '<td class="no-print"><button type="button" class="btn sm" data-act="edit" data-sid="' + esc(r.staffId) + '" data-date="' + esc(r.date) + '" data-bi="' + r.blockIndex + '" data-rv="' + i + '">直す</button></td></tr>';
    }).join('');
    return printHead('要確認の一覧（' + list.length + ' 件）') + '<div class="cd"><div class="row no-print"><b>要確認 ' + list.length + ' 件</b><button type="button" class="btn sm pri" data-act="rvd-start">1件目から決める</button><button type="button" class="btn sm" data-act="print">印刷</button></div>' +
      a2OverBand() + '<p class="help no-print">要確認が残っている月分は締められません。「1件目から決める」を押すと、1件ずつ「認める／認めない（理由）」を決める窓が開きます（決めると次の1件が開きます）。打刻の漏れは「直す」で打刻を足すか欠勤にします。「直す」で開いた窓の「保存して次へ」を押すと、保存した後に次の行の窓がそのまま開きます。直す所が無い時は窓の中の「確認済みにする」を選んで保存します。</p>' +
      '<div class="tw"><table><thead><tr><th>日</th><th>職員</th><th>予定</th><th>打刻（そのまま）</th><th>印</th><th class="no-print"></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function personVisible(p) { return !officeFilter || p.staff.office === officeFilter || (p.sum.byOffice && p.sum.byOffice[officeFilter] > 0); }
  function paintGrid() {
    var ds = dateList(), a36 = a36Map(ym);
    if (L && !leaveSt && !leaveBusy) loadLeave(false);   /* v5 段3: 36協定の印に使う月分を裏で読む（有給のタブと同じ読み込み） */
    /* 36協定の印（画面だけ・印刷しない）。超過は赤・警告は黄。中身は個人の月の帯に出す */
    var mark36 = function (sid) {
      var j = a36 && a36[sid];
      if (!j || !j.items.length) return '';
      var over = j.items.some(function (it) { return it.level === 'over'; });
      return ' <span class="tag ' + (over ? 'ng' : 'rv') + ' no-print" title="' + esc(j.items.map(function (it) { return it.text; }).join('／')) + '">36協定' + (over ? '超過' : '注意') + '</span>';
    };
    var head = '<tr><th class="nm">氏名</th>' + ds.map(function (x) { return '<th class="num">' + (+x.slice(8)) + '<br><span class="raw">' + wd(x) + '</span></th>'; }).join('') +
      '<th class="num sr sr3">出勤</th><th class="num sr sr2">総労働</th><th class="num">残業</th><th class="num">法定外</th><th class="num">深夜</th><th class="num">有休</th><th class="num sr sr1">要確認</th></tr>';
    var body = month.people.filter(function (p) { return (!onlyReview || p.sum.reviewCount > 0) && personVisible(p); }).map(function (p) {
      var by = {}; p.days.forEach(function (d) { by[d.date] = d; });
      return '<tr><td class="nm"><button type="button" class="btn sm" data-act="person" data-sid="' + esc(p.staff.staff_id) + '">' + esc(dispName(p.staff)) + '</button>' + mark36(p.staff.staff_id) + '</td>' + ds.map(function (x) {
        var d = by[x];
        if (!d) return '<td></td>';
        var rvb = d.blocks.filter(function (b) { return C.needsReview(b); });
        var rv = rvb.length > 0, np = rvb.some(function (b) { return b.flags.some(function (f) { return RED[f]; }); }), wk = d.blocks.some(function (b) { return b.working; });
        var txt = d.workMin ? fm(d.workMin) : (d.paidMin ? '有' : (d.absent ? '欠' : (np ? '✕' : (wk ? '勤' : ''))));
        return '<td class="' + (np ? 'np' : rv ? 'rv' : wk ? 'wk' : '') + '"><button type="button" class="btn sm" style="min-height:32px;padding:0 4px;border:0;background:none;color:inherit" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + x + '" aria-label="' + esc(dispName(p.staff) + ' ' + x + ' を直す') + '">' + txt + '</button></td>';
      }).join('') + '<td class="num sr sr3">' + p.sum.workDays + '</td><td class="num sr sr2">' + fm(p.sum.workMin) + '</td><td class="num">' + fm(p.sum.overtimeMin) + '</td><td class="num">' + fm(p.sum.legalOverMin) + '</td><td class="num">' + fm(p.sum.nightMin) + '</td><td class="num">' + p.sum.paidDays + '</td><td class="num sr sr1">' + p.sum.reviewCount + '</td></tr>';
    }).join('');
    return printHead('月の一覧') + '<div class="cd"><div class="row no-print"><label><input type="checkbox" id="g-only"' + (onlyReview ? ' checked' : '') + '> 要確認がある人だけ</label>' + officeSelect() + '<button type="button" class="btn sm" data-act="print">印刷</button>' +
      '<span class="help">黄色＝要確認・赤＝打刻の漏れ／打刻なし・青＝出勤中。数字を押すとその日を直せます。事業所で絞った時も、数字はその人の月全体です。名前の横の「36協定」は、名前を押した個人の月の上に中身が出ます。</span></div><div class="tw"><table class="grid"><thead>' + head + '</thead><tbody>' + (body || '<tr><td class="empty" colspan="40">該当する職員はいません</td></tr>') + '</tbody></table></div></div>';
  }

  function personOf(sid) { return month.people.filter(function (p) { return p.staff.staff_id === sid; })[0] || null; }
  function officeBreakdown(s) {
    var ks = Object.keys(s.byOffice || {}).filter(function (k) { return s.byOffice[k] > 0; });
    return ks.length ? ks.map(function (k) { return (officeName(k) || k) + ' ' + fm(s.byOffice[k]); }).join('・') : 'なし';
  }
  /* v5 段4: 日の行の休暇の印（時間単位の有休・特別休暇・代休・振替休日） */
  function absTags(d) {
    return (d.absences || []).map(function (a) {
      var t;
      if (a.kind === 'swap') t = a.role === 'off' ? '振替休日（働く日 ' + md(a.link_date) + '）' : '振替で働く日（休む日 ' + md(a.date) + '）';
      else if (a.kind === 'hourly_paid') t = '時間単位の有休 ' + (a.minutes / 60) + '時間';
      else if (a.kind === 'special') t = '特別休暇「' + ltName(a.type_code) + '」' + (a.minutes != null ? '半日' : '') + (a.paid ? '' : '（無給）');
      else t = '代休' + (a.minutes != null ? ' 半日' : '') + (a.link_date ? '（' + md(a.link_date) + ' の休日出勤）' : '');
      return '<span class="tag">' + esc(t) + '</span>';
    }).join('');
  }
  /* v5 段4: 月の休暇の種類の合計（どれも 0 の時は出さない＝今までの画面のまま） */
  function absSumTxt(s) {
    var parts = [];
    if (s.hourlyPaidMin > 0) parts.push('時間単位の有休 ' + fm(s.hourlyPaidMin) + '（有休の時間に含む・日数には数えない）');
    if (s.specialPaidDays > 0) parts.push('特別休暇（有給） ' + s.specialPaidDays + ' 日・' + fm(s.specialPaidMin));
    if (s.specialUnpaidDays > 0) parts.push('特別休暇（無給） ' + s.specialUnpaidDays + ' 日');
    if (s.compDays > 0) parts.push('代休 ' + s.compDays + ' 日');
    return parts.join('・');
  }
  function personHtml(p, a36) {
    var s = p.sum, rows = [], warns = warnLines(p, a36), abSum = absSumTxt(s);
    p.days.forEach(function (d) {
      var nt = d.note ? [d.note.early_ok ? '早出を認めた' : '', d.note.early_from ? '早出を ' + hm(d.note.early_from) + ' から認めた' : '', d.note.overtime_ok ? '残業を認めた' : '', d.note.ot_until ? '残業を ' + hm(d.note.ot_until) + ' まで認めた' : '', d.note.break_min != null ? '休憩を' + d.note.break_min + '分に' : '', d.note.note || ''].filter(Boolean).join('・') : '';
      var bl = d.blocks.length ? d.blocks : [null];
      bl.forEach(function (b, i) {
        rows.push('<tr><td>' + (i === 0 ? esc(md(d.date)) + '（' + wd(d.date) + '）' : '') + '</td><td>' + (b ? schedText(b) : (d.paidMin ? '有休' : '')) + '</td><td class="raw">' + (b ? esc(rawPunches(b)) : '') + '</td><td>' + (b ? countText(b) : '') + '</td><td class="num">' + (b ? b.breakMin : '') + '</td><td class="num">' + (b ? fm(b.workMin) : '') + '</td><td class="num">' + (b ? fm(b.nightMin) : '') + '</td><td>' + (b ? flagTags(b.flags, b.checked) : '') + (i === 0 && nt ? '<span class="tag">' + esc(nt) + '</span>' : '') + (i === 0 ? absTags(d) + exDayTags(p.staff.staff_id, d.date) : '') + '</td>' +
          '<td class="no-print">' + (i === 0 ? '<button type="button" class="btn sm" data-act="edit" data-sid="' + esc(p.staff.staff_id) + '" data-date="' + d.date + '">直す</button>' + exDayBtn(p.staff.staff_id, d.date) : '') + '</td></tr>');
      });
    });
    return (warns.length ? '<div class="band warn">' + warns.map(esc).join('<br>') + '</div>' : '') +
      '<div class="kv"><span>出勤日数</span><b>' + s.workDays + ' 日（有休 ' + s.paidDays + ' 日・' + fm(s.paidMin) + '）</b><span>総労働</span><b>' + fm(s.workMin) + '（所定内（法定内） ' + fm(s.schedInMin) + '・残業 ' + fm(s.overtimeMin) + '・法定外 ' + fm(s.legalOverMin) + '・深夜 ' + fm(s.nightMin) + '）</b>' +
      '<span>休日労働</span><b>' + fm(s.holidayMin) + (month.config.legal_holiday == null ? '（法定休日を決めていないため数えていません）' : '') + '</b>' +
      (abSum ? '<span>休暇</span><b>' + esc(abSum) + '</b>' : '') +
      '<span>事業所別の実働</span><b>' + esc(officeBreakdown(s)) + '</b>' +
      '<span>遅刻・早退</span><b>遅刻 ' + s.lateCount + ' 回 ' + fm(s.lateMin) + '・早退 ' + s.earlyLeaveCount + ' 回 ' + fm(s.earlyLeaveMin) + '</b><span>欠勤・打刻なし・要確認</span><b>欠勤 ' + s.absentDays + ' 日・打刻なし ' + s.noPunchDays + ' 日・要確認 ' + s.reviewCount + ' 件</b>' +
      '<span>数えなかった時間</span><b>' + fm(s.uncountedMin) + '（打刻のうち、予定に合わせた丸めで数えなかった分）</b></div>' +
      /* v5 1-1（2026-11-20・文は仮置き）: 画面の所定内（schedInMin）と CSV の「所定内」（総労働−残業）は中身が違うので、名前と注記で取り違えを無くす（画面だけ） */
      '<p class="help no-print">所定内（法定内）は、予定のうち法定の1日8時間・週40時間の中で働いた時間です（法定外・休日労働は含みません）。CSV の「所定内」は予定どおり働いた時間（総労働−残業）で、法定外になった分も含みます。</p>' +
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>日</th><th>予定</th><th>打刻（そのまま）</th><th>数えた時刻</th><th class="num">休憩</th><th class="num">実働</th><th class="num">深夜</th><th>印・直し</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="9" class="empty">この月の予定・打刻はありません</td></tr>') + '</tbody></table></div>';
  }
  function paintPerson() {
    var a36 = a36Map(ym);
    if (L && !leaveSt && !leaveBusy) loadLeave(false);   /* v5 段3: 36協定の帯に使う月分を裏で読む */
    if (printAll) {
      /* 全員分の印刷（1人1ページ） */
      /* 休止中で記録の無い人は出さない */
      return month.people.filter(function (p) { return p.days.length || p.staff.active !== false; }).map(function (p) { return '<div class="pg">' + printHead(dispName(p.staff) + ' さん') + '<div class="cd">' + personHtml(p, a36) + '</div></div>'; }).join('');
    }
    if (!selStaff || !personOf(selStaff)) selStaff = month.people.length ? month.people[0].staff.staff_id : null;
    var sel = '<label>職員 <select id="g-staff">' + month.people.map(function (p) { return '<option value="' + esc(p.staff.staff_id) + '"' + (p.staff.staff_id === selStaff ? ' selected' : '') + '>' + esc(dispName(p.staff)) + '</option>'; }).join('') + '</select></label>';
    var p = personOf(selStaff);
    if (!p) return '<div class="cd"><p class="empty">職員がいません。「職員と番号」でシフトから取り込んでください。</p></div>';
    return printHead(dispName(p.staff) + ' さん') + '<div class="cd"><div class="row no-print">' + sel + '<button type="button" class="btn sm" data-act="addday">予定の無い日に打刻を足す</button><button type="button" class="btn sm" data-act="work-open">勤務時間を手で入れる</button><button type="button" class="btn sm" data-act="sched-open">出勤予定を直す・入れる</button><button type="button" class="btn sm" data-act="fx-open" data-sid="' + esc(p.staff.staff_id) + '">前提の時間</button><button type="button" class="btn sm" data-act="print">印刷</button><button type="button" class="btn sm" data-act="print-all">全員分を印刷（1人1ページ）</button></div>' +
      personHtml(p, a36) + '</div>' + exPersonHtml(p);   /* 段A1: 補助項目（日ごと）の欄（画面だけ） */
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
        '<td class="no-print">' + (fixedCode(s) ? '' : '<button type="button" class="btn sm" data-act="recode" data-sid="' + esc(s.staff_id) + '">番号を振り直す</button>') + '<button type="button" class="btn sm" data-act="dname" data-sid="' + esc(s.staff_id) + '">表示名を変える</button><button type="button" class="btn sm" data-act="fx-open" data-sid="' + esc(s.staff_id) + '">前提の時間</button>' + staffMasterBtns(s) + selfBtns(s) + '</td></tr>';
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
  var REORDER_TABS = { home: 1, day: 1, review: 1, grid: 1, person: 1, staff: 1, leave: 1 };
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
    var m = C.computeMonth({ ym: y, period: d.period, staff: d.staff || [], schedule: d.schedule || [], punches: d.punches || [], days: d.days || [], leave_uses: d.leave_uses, absences: d.absences, config: monthCfg(d), lockedAt: d.month && d.month.locked_at, now: Date.now() });
    m.k36 = k36Info(d);   /* v5 段3: 締めたか・締めた時の控え（36協定の月の列に使う） */
    m.absences = Array.isArray(d.absences) ? d.absences : [];   /* v5 段4: 休暇の種類の行（有給の窓の一覧と、時間単位の有休の残りに使う） */
    return m;
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
      /* v5 段4: 時間単位の有休は、さかのぼって読んだ月分の休暇の種類の行から作り、使用に足す（1日＝設定の1日の所定の時間） */
      var dh0 = lvCfg().dayHours, abs = absOfMonths(x.months), hourly = L.hourlyUses ? L.hourlyUses(abs, function (sid0) { return L.dayMinOf ? L.dayMinOf(prof[sid0], dh0) : dh0 * 60; }) : [];   /* 1日の時間は人ごと（反証レビュー） */
      leaveSt = { profiles: prof, grants: Array.isArray(x.lg.grants) ? x.lg.grants : [], manual: manual, uses: L.usesFromMonth(x.months, manual).concat(hourly), months: x.months, absences: abs };
      if (x.months !== keep) monthCache = {};   /* v5（反証レビュー）: さかのぼりの月分を新しく読んだ時は、前に開いた月分の控えを捨てる（古い計算を上に重ねない） */
    })['catch'](function (e) {
      if (my !== leaveGen) return;
      note('有給の読み込み', e);
      leaveSt = { err: noDb(e) ? NEED_DB : '有給の記録を読めませんでした: ' + msgOf(e) };
    }).then(function () { return mp; }).then(function () {
      if (my !== leaveGen) return;
      leaveBusy = false;
      /* v5 段2・3: ホーム・月の一覧・個人の月も、有給と36協定の箱・印をこの読み込みから出す */
      if (view === 'app' && (tab === 'leave' || tab === 'home' || tab === 'grid' || tab === 'person') && !busy && !printAll) paint();
      /* v5 C3: 開き直した窓に、保存していない入力（今の保存で使った欄を除く）を戻す（読み直しで黙って消さない） */
      if (dlgCtx && dlgCtx.mode === 'leave' && $('g-dlg').open) { var kp = dlgCtx.keep || null; openLeave(dlgCtx.sid); if (kp) dlgPut(kp); absKindShow(); }   /* v5 段4: 戻した休暇の種類に合う欄を出す */
    });
  }
  /* v5 段4: 読んだ月分の休暇の種類の行（同じ行は1つ・取り消していない行だけ＝月の読み出しが返す行） */
  function absOfMonths(months) {
    var seen = {}, out = [];
    (months || []).forEach(function (m) { (m && Array.isArray(m.absences) ? m.absences : []).forEach(function (a) { var k = a && (a.id || a.staff_id + '|' + a.date + '|' + a.kind); if (!a || seen[k]) return; seen[k] = 1; out.push(a); }); });
    return out;
  }
  function lvCfg() { return C.fillConfig(rawCfg()); }
  function lvDayMin() { return lvCfg().dayHours * 60; }
  /* 日数の文字（半日きざみは今までどおり「9.5 日」・時間単位の端数がある時は「9 日 6 時間」） */
  function dTxt(v, sid) { return L && L.daysHm ? L.daysHm(v, sid ? staffDayMin(sid) : lvDayMin()) : String(v) + ' 日'; }
  /* 反証レビュー（2026-11-20）: 1日の時間は人ごと（有給の設定の週の所定時間÷週の所定日数・時間に切り上げ／無い人は設定の dayHours・DB の private.kintai_day_min と同じ・仮置き） */
  function staffDayMin(sid) { return L && L.dayMinOf ? L.dayMinOf(leaveSt && leaveSt.profiles ? leaveSt.profiles[sid] : null, lvCfg().dayHours) : lvDayMin(); }
  /* 休暇を入れられる最後の日＝今日（日本時間）の暦の月の次の月分の期間の終わり。有給の窓が読む月分（loadLeaveMonths の todayYm の次の月分）にそろえる
     （締め日の期間で決めない・DB の private.kintai_abs_max_date と同じ線・読んでいない時は締め日から数える・反証レビュー 2026-11-20・仮置き） */
  function absMaxDate() {
    var td = today(), ms0 = (month ? [month] : []).concat(leaveSt && leaveSt.months || []), i;
    var cd = lvCfg().close_day || 0;
    var ny = C.nextYm(td.slice(0, 7));
    for (i = 0; i < ms0.length; i++) if (ms0[i] && ms0[i].ym === ny && ms0[i].period) return ms0[i].period.to;
    return ny + '-' + (cd ? (cd < 10 ? '0' : '') + cd : String(C.daysIn(ny)));
  }
  /* その人のその日の有給の休み（分）: 手入力の有休の日数×1日の時間＋時間単位の有休＋有給の特別休暇（1日＝1日の時間）。DB の private.kintai_paid_min と同じ数え方 */
  function paidMinOn(sid, d, dm) {
    var n = 0;
    (leaveSt && leaveSt.manual || []).forEach(function (u) { if (u && !u.voided_at && u.staff_id === sid && u.use_date === d) n += Math.round(+u.days * dm); });
    (leaveSt && leaveSt.absences || []).forEach(function (a) { if (a && !a.voided_at && a.staff_id === sid && a.date === d && (a.kind === 'hourly_paid' || (a.kind === 'special' && a.paid))) n += a.kind === 'hourly_paid' ? +a.minutes : (a.minutes != null ? +a.minutes : dm); });
    return n;
  }
  var ABS_OVER = 'その日の有給の休み（手入力の有休・時間単位の有休・有給の特別休暇）を合わせると1日の時間を超えます。今の休みを取り消してから入れてください。';
  var ABS_LATE = '休暇は来月分までの日付で入れてください。';
  /* 単位なしの日数（付与の表の「使った」「残り」の列） */
  function nTxt(v, sid) { var n = +v; return n * 2 === Math.round(n * 2) ? String(n) : dTxt(n, sid).replace(/ 日 /, '日 '); }
  /* その人のその日に勤務の予定があるか（開いている月分と有給のために読んだ月分の計算から）。true＝ある／false＝無い／null＝その日の月分を読んでいない */
  function schedOnDay(sid, d) {
    var ms0 = (month ? [month] : []).concat(leaveSt && leaveSt.months || []);
    for (var i = 0; i < ms0.length; i++) {
      var m = ms0[i];
      if (!m || !m.period || d < m.period.from || d > m.period.to) continue;
      var p = (m.people || []).filter(function (x) { return x.staff.staff_id === sid; })[0];
      var dd = p && p.days.filter(function (x) { return x.date === d; })[0];
      return !!(dd && dd.blocks.some(function (b) { return b.sched; }));
    }
    return null;
  }
  /* 休暇の行を入れた・取り消した後に、その日（代休の元の日・振替の働く日を含む）の月分だけを読み直して、有給の読み込みの月分に入れ替える */
  function refreshAbsMonths(dates) {
    if (!leaveSt || !Array.isArray(leaveSt.months)) return Promise.resolve();
    var ms0 = leaveSt.months, gen = leaveGen, idx = [];
    ms0.forEach(function (m, i) { if (m && m.period && dates.some(function (d) { return d && d >= m.period.from && d <= m.period.to; })) idx.push(i); });
    if (!idx.length) return Promise.resolve();
    return Promise.all(idx.map(function (i) { return rpc('kintai_month_get', { p_ym: ms0[i].ym }).then(okOr).then(function (d) { return { i: i, m: monthFor(ms0[i].ym, d) }; }); })).then(function (rs) {
      if (gen !== leaveGen || !leaveSt || leaveSt.months !== ms0) return;
      var nm = ms0.slice(); rs.forEach(function (r) { nm[r.i] = r.m; });
      leaveSt.months = nm; monthCache = {};
    })['catch'](function (e) { note('休暇の月の読み直し', e); });
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
      var rem = '<b>' + esc(dTxt(b.remain, s.staff_id)) + '</b>' + (b.over ? '<span class="tag ng">付与の無い使用 ' + esc(dTxt(b.over, s.staff_id)) + '</span>' : '') + (b.planned ? '<span class="raw">（この先の予定 ' + esc(dTxt(b.planned, s.staff_id)) + '）</span>' : '');
      var soon = b.soon ? esc(dTxt(b.soon.days, s.staff_id)) + '（' + esc(ymdJa(b.soon.expires)) + ' まで）' : '<span class="raw">—</span>';
      var ob = sm.obligation;
      return '<tr><td>' + esc(dispName(s)) + '</td><td>' + hire + '</td><td>' + wk + '</td><td>' + nx + '</td><td class="num">' + rem + '</td><td>' + soon + '</td><td class="num">' + (ob.state === 'none' ? '<span class="raw">—</span>' : esc(String(ob.used)) + ' 日') + '</td><td>' + obTag(ob) + '</td>' +
        '<td class="no-print"><button type="button" class="btn sm" data-act="lv-open" data-sid="' + esc(s.staff_id) + '">開く</button></td></tr>';
    }).join('');
    return h + '<div class="row no-print"><b>有給（' + esc(ymdJa(today())) + ' 時点）</b><button type="button" class="btn sm" data-act="lv-reload">読み直す</button><button type="button" class="btn sm" data-act="print">印刷</button><button type="button" class="btn sm" data-act="lv-ledger">管理簿を印刷（A4）</button></div>' +
      '<p class="help no-print">付与は入職日（職員マスタ。「開く」の設定で上書きできます）の6か月後に10日、その後1年ごとに 11・12・14・16・18・20日です。週の所定日数が4日以下で週30時間未満の人は、設定に両方を入れると比例付与で数えます。期限は付与日から2年で、使う時は古い付与から減らします。使用はシフトの有休の日と、手で入れた使用（同じ日に両方ある時は手入力の方）を数えます。年5日は、10日以上を付与した日から1年の間の使用で、届かずに期限まで60日を切ると赤、それより前は黄色です。出勤率（8割）の判定はしていません（満たさない年は設定で「付与しない」を選びます）。</p>' +
      '<div class="tw"><table><thead><tr><th>氏名</th><th>入職日</th><th>週の所定</th><th>次の付与</th><th class="num">残り</th><th>期限の近い分</th><th class="num">今の付与からの使用</th><th>年5日</th><th class="no-print"></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9" class="empty">職員がいません。</td></tr>') + '</tbody></table></div></div>';
  }

  /* ── 締めた時の控え（snapshot）と今の数字 ── */
  /* v5（2026-11-20）: 給与が比べている legalInOverMin・over60Min・nightShiftCount・schedDays と記号ごとの回数（counts）も比べる。控えに無い鍵（古い控え）は比べない。
     丸める前の値（legalOverRawMin・holidayRawMin）は36協定の判定だけに使うので比べない */
  var SNAP_KEYS = ['workDays', 'paidDays', 'workMin', 'schedInMin', 'overtimeMin', 'legalOverMin', 'nightMin', 'lateCount', 'lateMin', 'earlyLeaveCount', 'earlyLeaveMin', 'noPunchDays', 'reviewCount', 'absentDays', 'paidMin', 'uncountedMin', 'holidayMin',
    'legalInOverMin', 'over60Min', 'nightShiftCount', 'schedDays',
    /* v5 段4: 休暇の種類（控えに入れた鍵）。段4 より前の控えには無いので比べない（上の typeof の確かめ） */
    'hourlyPaidMin', 'specialPaidMin', 'specialPaidDays', 'specialUnpaidDays', 'compDays', 'hourlyPaidEffMin', 'hourlyPaidOffMin', 'specialPaidOffDays', 'absentPartMin',
    /* 給与の額の直し（2026-11-20）: 予定の無い勤務の実働・法定休日に働いた日の数（この版より前の控えには無いので比べない） */
    'noSchedWorkMin', 'holidayWorkDays', 'paidNoSchedDays', 'paidNoSchedMin', 'paidOffDays'];   /* 反証レビュー（2026-11-21）の鍵も（日ごとの休日の実働 holidayDaysMin は数の並びなので比べない＝holidayMin・holidayWorkDays で見る） */
  /* 記号ごとの回数を比べる（0 より大きい回数だけ・給与の画面の attSame と同じ見方） */
  function countsOf(c) { var o = {}; if (c && typeof c === 'object' && !Array.isArray(c)) for (var k in c) { var n = Number(c[k]); if (isFinite(n) && n > 0) o[k] = Math.round(n); } return o; }
  function sameCounts(a, b) {
    var x = countsOf(a), y = countsOf(b), kx = Object.keys(x).sort(), ky = Object.keys(y).sort();
    if (kx.join('\u0001') !== ky.join('\u0001')) return false;
    for (var i = 0; i < kx.length; i++) if (x[kx[i]] !== y[kx[i]]) return false;
    return true;
  }
  var SNAP_FILL = [['absentDays', '欠勤日数'], ['paidMin', '有休時間'], ['uncountedMin', '数えなかった時間'], ['holidayMin', '休日労働']];
  function snapRows() { return isLocked() && data.month.snapshot && Array.isArray(data.month.snapshot.rows) ? data.month.snapshot.rows : null; }
  function snapDiff() {
    var rows = snapRows(), out = [];
    if (!rows) return out;
    var byId = {}; rows.forEach(function (r) { byId[r.staff_id] = r; });
    month.people.forEach(function (p) {
      var r = byId[p.staff.staff_id];
      if (!r) { if (p.sum.workMin > 0 || p.sum.reviewCount > 0) out.push(dispName(p.staff)); return; }
      if (SNAP_KEYS.some(function (k) { return typeof r[k] === 'number' && r[k] !== p.sum[k]; }) || (r.counts && typeof r.counts === 'object' && !sameCounts(r.counts, p.sum.counts))) out.push(dispName(p.staff));
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

  /* ── freee の月の集計の取り込み（2026-11-23・凍結仕様 ROOT-freee-month-import.md・DB 統合 0123・計算は kintai-freee-import.js と kintai-calc.js） ──
     ファイルはメモリだけで読む（端末に残さない・読んだらファイルの選びを空にする）。突き合わせの結果（fiSt）は画面の中だけで、月を変えたら使わない。
     使えるのは締めていない月分の管理者（二段階認証）だけ（DB も has_role('admin') と締めの判定で断る） */
  var fiSt = null, fiGen = 0, fiSel = {};   /* fiSel: 取り消す人の選び（画面の中だけ・描き直しで消さない） */
  var FI_NG = { reason: '理由を書いてください（200字まで）。', locked: 'この月は締めてあるため、取り込み・取り消しはできません。', notfound: '勤怠の職員にいない人か、取り消す取り込みが無い人が入っていました。読み直してください。',
    dup: '同じ職員が2行入っていました。ファイルを確かめてください。', badvalue: '取り込む値の形が違いました（4つの時間の和が総労働と合わない など）。ファイルを確かめてください。',
    badshape: '送った値の形が違いました。読み直してください。', toomany: '一度に取り込めるのは500人までです。', badsource: '取り込みの種類が違いました。読み直してください。', badsha: 'ファイルの指紋の形が違いました。読み直してください。',
    badsrc: 'freee の元の欄の記録の形が違いました（欄の名前・数）。読み直して、直らない時は管理者に知らせてください。',
    periodchanged: 'この月分の期間が、画面を開いた後に変わりました（締め日の変更など）。「読み直す」を押してから、もう一度ファイルを選んでください。' };   /* 反証レビュー 2026-11-23 */
  function fiMsg(e) { return e && e.kintai && FI_NG[e.kintai] ? FI_NG[e.kintai] : msgOf(e); }
  function fiCan() { return isAdmin() && !isLocked() && !!window.KintaiFreeeImport; }
  function fiImported() { return month ? month.people.filter(function (p) { return p.sum && p.sum.imported; }) : []; }
  function fiStaffList() {
    return month.people.filter(function (p) { return !p.staff.missingStaff; }).map(function (p) {
      return { staff_id: p.staff.staff_id, emp_code: p.staff.emp_code || '', schedDays: p.days.filter(function (d) { return d.schedWorkMin > 0; }).length };
    });
  }
  function fiDecode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (_) { return new TextDecoder('shift_jis').decode(buf); }   /* payroll.js の decode と同じ（UTF-8 で読めなければ Shift_JIS） */
  }
  function fiSha(buf) {
    try {
      if (!window.crypto || !window.crypto.subtle) return Promise.resolve(null);
      return window.crypto.subtle.digest('SHA-256', buf).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }, function () { return null; });
    } catch (_) { return Promise.resolve(null); }
  }
  function fiRead(input) {
    var f = input.files && input.files[0];
    input.value = '';   /* 同じファイルを選び直せるように・端末に残さない */
    if (!f || !fiCan() || !month) return;
    if (f.size > 2 * 1024 * 1024) { toast('ファイルが大きすぎます（2MB まで）。'); return; }
    var my = ++fiGen, y0 = ym;
    f.arrayBuffer().then(function (buf) {
      return fiSha(buf).then(function (sha) { return { text: fiDecode(buf), sha: sha }; });
    }).then(function (r) {
      if (my !== fiGen || y0 !== ym || !month) return;
      var FI = window.KintaiFreeeImport, p = FI.parseFreeeMonthCsv(r.text);
      var pr0 = per();
      fiSt = { ym: ym, period: { from: pr0.from, to: pr0.to }, sha: r.sha, parsed: p, res: p.errors.length ? null : FI.toImport(p.rows, fiStaffList(), { period: pr0 }), none: {} };
      paint();
    })['catch'](function (e) { if (my !== fiGen) return; note('freee の取り込みの読み込み', e); toast('ファイルを読めませんでした。'); });
  }
  function fiRow(sid) { return month.people.filter(function (p) { return p.staff.staff_id === sid; })[0] || null; }
  function fiHtml() {
    var h = '<div class="cd no-print" id="g-fi"><h2 style="font-size:16px;margin:0 0 8px">freee の月の集計を取り込む</h2>' +
      '<p class="help">freee人事労務の勤怠の「月の集計」（CSV）を職員ごとに取り込み、その人のこの月分の合計（総労働・所定内・法定内残業・法定外・勤務日数など）を freee の値にします。打刻は作りません。取り込んだ人は要確認から外れ、普通の締めで締められます。予定から数える項目（所定日数・記号ごとの回数・夜勤の回数）は今の予定から数えます。使えるのは締めていない月分の管理者（二段階認証）だけです。ファイルは画面の中だけで読み、端末には残しません。</p>';
    var imp = fiImported();
    if (isLocked()) h += '<div class="band" role="status">この月は締めてあるため、取り込み・取り消しはできません。</div>';
    else if (!isAdmin()) h += '<div class="band" role="status">取り込み・取り消しは管理者（二段階認証）だけができます。</div>';
    else if (!window.KintaiFreeeImport) h += '<div class="band warn" role="status">取り込みの部品を読み込めませんでした。読み直してください。</div>';
    else {
      /* 反証レビュー 2026-11-23: 取り込みはこの月分の期間に結び付く。期間を大きく出し、締め日が既定（月末）のままなら知らせる */
      var pp = per(), md0 = function (d) { return (+d.slice(5, 7)) + '月' + (+d.slice(8, 10)) + '日'; };
      h += '<p style="font-size:18px;font-weight:700;margin:8px 0">この取り込みは ' + esc(md0(pp.from)) + '〜' + esc(md0(pp.to)) + ' の分として入ります</p>';
      if (!(data && data.period && +data.period.close_day > 0)) h += '<div class="band warn" role="status">締め日が月末のままです。freee の期間（15日締め）と合わない時は、先に設定で締め日を変えてください。</div>';
      h += '<div class="row"><label for="fi-file">CSV のファイルを選ぶ</label><input type="file" id="fi-file" accept=".csv,text/csv" aria-label="freee の勤怠の月の集計の CSV を選ぶ"></div>';
    }
    if (fiCan() && fiSt && fiSt.ym === ym && fiSt.period.from === per().from && fiSt.period.to === per().to) h += fiTableHtml();
    if (imp.length) {
      h += '<h3 style="font-size:15px;margin:12px 0 6px">この月分に取り込んである人（' + imp.length + ' 人）</h3><div class="tw"><table><thead><tr>' + (fiCan() ? '<th>選ぶ</th>' : '') + '<th>従業員コード</th><th>職員</th><th class="num">勤務日数</th><th class="num">総労働</th><th class="num">所定内</th><th class="num">法定内残業</th><th class="num">法定外</th><th class="num">有休日数</th><th>どこから</th><th>気になる所</th></tr></thead><tbody>' +
        imp.map(function (p) {
          var s = p.sum, src = s.imported.source === 'none' ? '勤怠なし（0）' : s.imported.source === 'freee_api' ? 'freee（API）' : 'freee（CSV）';
          return '<tr>' + (fiCan() ? '<td><label style="display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px"><input type="checkbox" name="fi-v" value="' + esc(p.staff.staff_id) + '"' + (fiSel[p.staff.staff_id] ? ' checked' : '') + ' aria-label="' + esc(dispName(p.staff)) + ' の取り込みを選ぶ"></label></td>' : '') +
            '<td>' + esc(p.staff.emp_code || '') + '</td><td>' + esc(dispName(p.staff)) + '</td><td class="num">' + esc(s.workDays) + '</td><td class="num">' + fm(s.workMin) + '</td><td class="num">' + fm(s.schedInMin) + '</td><td class="num">' + fm(s.legalInOverMin) + '</td><td class="num">' + fm(s.legalOverMin) + '</td><td class="num">' + esc(s.paidDays) + '</td><td>' + esc(src) + '</td><td>' + esc(s.warnings.join('・')) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (fiCan() ? '<div class="row"><button type="button" class="btn ng" data-act="fi-void">選んだ人の取り込みを取り消す</button></div><p class="help">取り消すと、その人はふだんの打刻からの数え方に戻ります（取り込みの記録は取り消しの印を付けて残ります）。</p>' : '');
    }
    return h + '</div>';
  }
  function fiTableHtml() {
    var p = fiSt.parsed, r = fiSt.res, h = '';
    if (p.errors.length) return '<div class="band ng" role="alert">このファイルは取り込めません。' + p.errors.map(esc).join('') + '</div>';
    if (r.periodError) return '<div class="band ng" role="alert">このファイルは取り込めません。' + esc(r.periodError) + '</div>';
    var nOk = r.ok.length, nNone = Object.keys(fiSt.none).filter(function (k) { return fiSt.none[k]; }).length;
    var wBy = {}; r.warn.forEach(function (w) { (wBy[w.staff_id] = wBy[w.staff_id] || []).push(w.why); });
    var nameOfCode = {}; p.rows.forEach(function (x) { if (x.code && x.name) nameOfCode[x.code] = x.name; });
    h += '<div class="band" role="status">読んだ行 ' + p.rows.length + ' 件：取り込む ' + nOk + ' 人・取り込まない ' + r.refused.length + ' 件・勤怠の職員に無い番号 ' + r.unmatched.length + ' 件・freee に無い職員 ' + r.missingStaff.length + ' 人</div>';
    if (p.missing.length) h += '<div class="band warn" role="status">CSV に無い列は 0 として扱っています（' + esc(p.missing.join('・')) + '）。freee の勤怠の CSV にこの列が本当に無いか（0 でない人がいないか）を確かめてから取り込んでください。</div>';
    if (p.watch.length) h += '<p class="help">名前に休暇・労働などの語がある知らない列（' + esc(p.watch.join('・')) + '）は、値が 0 でない人を取り込みません。</p>';
    if (p.unknown.length) h += '<p class="help">使わなかった列: ' + esc(p.unknown.join('・')) + '</p>';
    var drop = r.ok.reduce(function (n, o) { return n + window.KintaiFreeeImport.srcClean(o.src).dropped; }, 0);
    if (drop) h += '<div class="band warn" role="status">freee の元の欄のうち ' + drop + ' 欄は、名前が長い・欄が多いなどのため記録に残しません（取り込む値には使いません）。</div>';
    var row = function (code, name, s, cells, state, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + esc(code) + '</td><td>' + esc(name) + '</td>' + cells + '<td>' + state + '</td></tr>';
    };
    var blank = '<td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td>';
    h += '<div class="tw"><table><thead><tr><th>従業員コード</th><th>職員</th><th class="num">勤務日数</th><th class="num">総労働</th><th class="num">所定内</th><th class="num">法定内残業</th><th class="num">法定外</th><th>取り込み</th></tr></thead><tbody>';
    r.ok.forEach(function (o) {
      var pr = fiRow(o.staff_id), v = o.vals, again = pr && pr.sum.imported ? '<br><span class="help">取り込み直します（前の取り込みは取り消しの印を付けて残します）</span>' : '';
      h += row(pr ? pr.staff.emp_code || o.emp_code : o.emp_code, pr ? dispName(pr.staff) : o.staff_id, null,
        '<td class="num">' + esc(v.workDays) + '</td><td class="num">' + fm(v.workMin) + '</td><td class="num">' + fm(v.schedInMin) + '</td><td class="num">' + fm(v.legalInOverMin) + '</td><td class="num">' + fm(v.legalOverMin) + '</td>',
        '取り込む' + ((wBy[o.staff_id] || []).length ? '<br><span class="tag rv">気になる所</span> ' + esc(wBy[o.staff_id].join('・')) : '') + again, (wBy[o.staff_id] || []).length ? 'fi-warn' : '');
    });
    r.refused.forEach(function (x) { var pr = x.staff_id ? fiRow(x.staff_id) : null; h += row(x.code, pr ? dispName(pr.staff) : (nameOfCode[x.code] || ''), null, blank, '<span class="tag ng">取り込まない</span> ' + esc(x.why), 'fi-ng'); });
    r.unmatched.forEach(function (c) { h += row(c, nameOfCode[c] || '', null, blank, '<span class="tag ng">取り込まない</span> 勤怠の職員に、この従業員コードの人がいません（「職員と番号」の従業員コードを確かめてください）', 'fi-ng'); });
    r.missingStaff.forEach(function (sid) {
      var pr = fiRow(sid), on = !!fiSt.none[sid];
      h += row(pr ? pr.staff.emp_code || '' : '', pr ? dispName(pr.staff) : sid, null, blank,
        'freee に無い職員です（この月分に予定があります）<br><label style="display:inline-flex;align-items:center;gap:6px;min-height:44px"><input type="checkbox" name="fi-none" value="' + esc(sid) + '"' + (on ? ' checked' : '') + '> この月は勤怠なし（0）として取り込む</label>', '');
    });
    h += '</tbody></table></div>';
    if (!nOk && !nNone) return h + '<p class="help">取り込める人がいません。</p>';
    h += '<div class="row"><label>理由（直しの履歴に残ります） <input type="text" id="fi-reason" maxlength="200" style="min-width:16em" value="' + esc(fiSt.reason || '') + '"></label>' +
      '<button type="button" class="btn pri" data-act="fi-go">' + esc((nOk + nNone) + ' 人を取り込む') + '</button><button type="button" class="btn" data-act="fi-clear">やめる</button></div>' +
      '<p class="help" id="fi-msg" role="alert"></p>';
    return h;
  }
  function fiGo(btn) {
    if (busy || !fiCan() || !fiSt || fiSt.ym !== ym || !fiSt.res) return;
    var reason = ($('fi-reason') && $('fi-reason').value || '').trim(), msg = $('fi-msg');
    if (!reason) { if (msg) msg.textContent = '理由を書いてください。'; if ($('fi-reason')) $('fi-reason').focus(); return; }
    var FI = window.KintaiFreeeImport, rows = fiSt.res.ok.map(function (o) { return { staff_id: o.staff_id, vals: o.vals, src: FI.srcClean(o.src).src }; });
    Object.keys(fiSt.none).forEach(function (sid) { if (fiSt.none[sid] && fiSt.res.missingStaff.indexOf(sid) >= 0) rows.push({ staff_id: sid, vals: FI.zeroVals(), source: 'none' }); });
    if (!rows.length) return;
    busy = true; var restore = pressBusy(btn, '取り込んでいます…', $('g-fi')), y0 = ym;
    rpc('kintai_month_import_put', { p_ym: y0, p_rows: rows, p_source: 'freee_csv', p_file_sha: fiSt.sha, p_reason: reason, p_period_from: fiSt.period.from, p_period_to: fiSt.period.to }).then(okOr).then(function (r) {
      busy = false; fiSt = null; toast((r.count || 0) + ' 人を取り込みました');
      if (y0 === ym) { dropMonthCaches(); return load(false); }
    })['catch'](function (e) { busy = false; restore(); note('freee の取り込み', e); var m = $('fi-msg'); if (m) m.textContent = fiMsg(e); else toast(fiMsg(e)); });
  }
  function fiVoid(btn) {
    if (busy || !fiCan()) return;
    var ids = Array.prototype.map.call(document.querySelectorAll('#g-fi input[name="fi-v"]:checked'), function (x) { return x.value; });
    if (!ids.length) { toast('取り消す人を選んでください。'); return; }
    var r = prompt(ids.length + ' 人の freee の取り込みを取り消します。理由を書いてください（直しの履歴に残ります）。');
    if (!r || !r.trim()) return;
    busy = true; var restore = pressBusy(btn, '取り消しています…'), y0 = ym;
    rpc('kintai_month_import_void', { p_ym: y0, p_staff_ids: ids, p_reason: r.trim() }).then(okOr).then(function (x) {
      busy = false; fiSel = {}; toast((x.count || 0) + ' 人の取り込みを取り消しました');
      if (y0 === ym) { dropMonthCaches(); return load(false); }
    })['catch'](function (e) { busy = false; restore(); note('freee の取り込みの取り消し', e); alert(fiMsg(e)); });
  }
  function paintClose() {
    var lk = isLocked(), afterLock = month.people.some(function (p) { return p.days.some(function (d) { return d.flags.indexOf('after_lock') >= 0; }); });
    var review = month.totals.reviewCount;
    var diff = lk ? snapDiff() : [];
    var nx = C.addDays(per().to, 1);
    var stop = !lk && notYet() ? '期間の末日を過ぎてから締められます（' + esc(perLabel()) + 'は ' + esc((+nx.slice(5, 7)) + '月' + (+nx.slice(8, 10)) + '日') + 'から締められます）。' :
      (!lk && shiftInfo && !shiftInfo.ok ? 'シフトを取り込めていないため、まだ締められません（' + esc(shiftInfo.why) + '）。上の「シフトを取り込み直す」を押してから締めてください。' : '');
    var h = printHead('締めと出力') + fiHtml() + '<div class="cd"><h2 style="font-size:16px;margin:0 0 8px">月の締め</h2>' +
      (diff.length ? '<div class="band warn">締めた時の数字と今の数字が違う職員がいます（' + diff.map(esc).join('・') + '）。締めた後の打刻・計算の決まりの見直しなどが原因です。給与へ渡したのは締めた時の数字です（月の集計の CSV も締めた時の数字で出します）。</div>' : '') +
      (lk ? '<p>締めた日時: ' + esc(new Date(data.month.locked_at).toLocaleString('ja-JP')) + '</p>' + (afterLock ? '<div class="band warn">締めた後に足された打刻があります（印「締めた後の打刻」）。給与へ渡した後なら、来月の調整を検討してください。</div>' : '') +
        '<button type="button" class="btn ng" data-act="unlock"' + (isAdmin() ? '' : ' disabled') + '>締めを解除する（管理者）</button>' :
        (review ? '<div class="band warn">要確認が ' + review + ' 件残っているため、まだ締められません。1件ずつ「認める／認めない」を決めてください（認めない時は理由を残します）。</div><div class="row no-print"><button type="button" class="btn" data-act="rvd-start">要確認を1件目から決める</button></div>' : '<div class="band ok">要確認はありません。</div>') +
        (stop ? '<div class="band warn" role="status">' + stop + '</div>' : '') +
        '<button type="button" class="btn pri" data-act="lock"' + (stop ? ' disabled' : '') + '>この月を締める</button><p class="help">締める直前に月を読み直して数え直し、その数字を「締めた時の控え」としてデータベースに残します。締めると、この月の打刻の足し・取り消し・承認・休憩の直し・シフトの取り込みが止まります。タブレットの打刻は締めた後も記録され、「締めた後の打刻」の印が付きます。</p>') + '</div>';
    h += reqCloseHtml();   /* v5 段5: 承認待ちの申請と月の確認の数（締めは止めない・画面だけ） */
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
  var ACT_LABEL = { notice_add: '打刻漏れを本人に知らせた', notice_void: '打刻漏れの知らせを取り消した', sched_set: '予定を直した', sched_off: '予定を休みにした', sched_clear: '予定の手直しを外した', fixed_put: '前提の時間を入れた', fixed_void: '前提の時間を取り消した', display_name: '表示名を変えた', punch_add: '打刻を足した', punch_void: '打刻を取り消した', extra_put: '補助項目を入れた', extra_void: '補助項目を取り消した', day_put: '承認・休憩・メモ・印', code_reset: '番号を振り直した', code_fixed: '打刻の番号を職員No に合わせた', month_lock: '月を締めた', month_unlock: '締めを解除した', settings_put: '設定を変えた', schedule_put: 'シフトを取り込んだ', staff_sync: 'シフトから職員を取り込んだ',
    master_import: '職員マスタと突き合わせた', master_add: '職員マスタから職員を足した', staff_link: '職員マスタとの結び付けを直した', clock_visible: '打刻画面に出す・出さないを変えた',
    leave_profile: '有給の設定を変えた', leave_grant_add: '有給の付与を足した', leave_grant_void: '有給の付与を取り消した', leave_use_add: '有休の使用を足した', leave_use_void: '有休の使用を取り消した',
    managers_add: '勤怠の管理者に足した', managers_remove: '勤怠の管理者から外した',
    absence_add: '休暇を入れた', absence_void: '休暇を取り消した',   /* v5 段4（統合 0113） */
    month_import: 'freee の月の集計を取り込んだ', month_import_void: 'freee の取り込みを取り消した' };   /* 統合 0123（2026-11-23） */
  /* v5 段4: 休暇の種類の言い方（直しの履歴・有給の窓の一覧・個人の月の印） */
  var ABS_JA = { hourly_paid: '時間単位の有休', special: '特別休暇', comp: '代休', swap: '振替休日' };
  function ltName(code) { try { var l = C.leaveTypesOf(C.fillConfig(rawCfg())).filter(function (x) { return x.code === code; })[0]; return l ? l.name : String(code || ''); } catch (_) { return String(code || ''); } }
  function absTxt(a) {
    var k = ABS_JA[a.kind] || '休暇', dt = a.date ? ymdSl(a.date) : '';
    if (a.kind === 'hourly_paid') return k + ' ' + (nOf(a.minutes) / 60) + '時間（' + dt + '）';
    if (a.kind === 'special') return k + '「' + ltName(a.type_code) + '」' + (a.paid ? '有給' : '無給') + '・' + (a.minutes != null ? '半日' : '1日') + '（' + dt + '）';
    if (a.kind === 'comp') return k + (a.minutes != null ? ' 半日' : ' 1日') + '（' + dt + '・休日に働いた日 ' + ymdSl(a.link_date) + '）';
    if (a.kind === 'swap') return k + '（休む日 ' + dt + '・働く日 ' + ymdSl(a.link_date) + '）';
    return k;
  }
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
    if (e.action === 'absence_add') return ABS_JA[a.kind] ? absTxt(a) + 'を入れた' : ACT_LABEL.absence_add;
    if (e.action === 'absence_void') return ABS_JA[b.kind] ? absTxt(b) + 'を取り消した' : ACT_LABEL.absence_void;
    var ymT = function (y) { return typeof y === 'string' && /^\d{4}-\d{2}$/.test(y) ? (+y.slice(0, 4)) + '年' + (+y.slice(5, 7)) + '月分・' : ''; };
    if (e.action === 'month_import') return a.count != null ? ACT_LABEL.month_import + '（' + ymT(a.ym) + a.count + ' 人' + (a.replaced ? '・うち取り込み直し ' + a.replaced + ' 人' : '') + '）' : ACT_LABEL.month_import;   /* 統合 0123 */
    if (e.action === 'month_import_void') return a.count != null ? ACT_LABEL.month_import_void + '（' + ymT(a.ym) + a.count + ' 人）' : ACT_LABEL.month_import_void;
    if (e.action !== 'day_put') return ACT_LABEL[e.action] || e.action;
    if (!!b.early_ok !== !!a.early_ok) parts.push(a.early_ok ? '早出を全部認めた' : '早出の承認（全部）を外した');
    if (ms(b.early_from) !== ms(a.early_from)) parts.push(a.early_from ? '早出を ' + hm(a.early_from) + ' から認めた' : '早出の時刻（' + hm(b.early_from) + ' から）を外した');
    if (!!b.overtime_ok !== !!a.overtime_ok) parts.push(a.overtime_ok ? '残業を全部認めた' : '残業の承認（全部）を外した');
    if (ms(b.ot_until) !== ms(a.ot_until)) parts.push(a.ot_until ? '残業を ' + hm(a.ot_until) + ' まで認めた' : '残業の時刻（' + hm(b.ot_until) + ' まで）を外した');
    if ((b.early_ng || null) !== (a.early_ng || null)) parts.push(a.early_ng ? '早出を認めなかった（「' + a.early_ng + '」）' : '早出の「認めない」を外した');   /* 0120 */
    if ((b.ot_ng || null) !== (a.ot_ng || null)) parts.push(a.ot_ng ? '残業を認めなかった（「' + a.ot_ng + '」）' : '残業の「認めない」を外した');
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
  /* ── v5 段4: 休暇と丸めの設定（設定の鍵 roundUnitMin・hourlyPaidLeave・dayHours・leaveTypes。DB は変えない）──
   * 欄は今の設定（rawCfg）から出す（締めた月分を開いている間の month.config は締めた時の控えなので、そのまま保存すると古い値に戻る）。
   * 特別休暇の種類は、今の行＋空の1行（足す時）。名前を空にした行は外す。保存は「設定を保存する」（管理者だけ）。
   * 欄は設定の欄（#g-set）の中に置く（保存していない変更の確かめ settingsState が同じ道で数える） */
  var LV_SET_KEYS = ['roundUnitMin', 'hourlyPaidLeave', 'dayHours', 'leaveTypes'];
  function lvSetHtml() {
    var c = C.fillConfig(rawCfg()), lts = C.leaveTypesOf(c), extra = 1, i;
    var row = function (i, l) {
      return '<tr><td><input type="text" id="lt-code-' + i + '" maxlength="20" value="' + esc(l ? l.code : '') + '" aria-label="印（英数字）' + (i + 1) + '" style="width:8em"></td>' +
        '<td><input type="text" id="lt-name-' + i + '" maxlength="20" value="' + esc(l ? l.name : '') + '" aria-label="名前 ' + (i + 1) + '" style="width:10em"></td>' +
        '<td><label><input type="checkbox" id="lt-paid-' + i + '"' + (l && l.paid ? ' checked' : '') + '> 有給</label></td></tr>';
    };
    var rows = lts.map(function (l, k) { return row(k, l); });
    for (i = 0; i < extra && lts.length + i < C.LEAVE_TYPES_MAX; i++) rows.push(row(lts.length + i, null));
    return '<div style="grid-column:1/-1"><h2 style="font-size:16px;margin:14px 0 8px">休暇と丸め</h2><div class="kv">' +
      '<label for="l-roundUnitMin">丸めの単位</label><span><select id="l-roundUnitMin">' + C.ROUND_UNITS.map(function (u) { return '<option value="' + u + '"' + (c.roundUnitMin === u ? ' selected' : '') + '>' + (u === 1 ? '1分（丸めない）' : u + '分') + '</option>'; }).join('') + '</select> ' +
        '働いた人に不利な向きには丸めません（遅刻した出勤は単位で切り捨て・早退した退勤と、認めた残業の終わりは単位で切り上げ）。予定の無い勤務と、1日の働いた時間を短くする向きには丸めません</span>' +
      '<label for="l-hourly">時間単位の有休</label><span><input type="checkbox" id="l-hourly"' + (c.hourlyPaidLeave ? ' checked' : '') + '> 使う（労使協定で決めた時だけ・1年に5日分まで・年5日の取得義務には数えません）</span>' +
      '<label for="l-dayHours">1日の所定の時間</label><span><input type="number" id="l-dayHours" min="1" max="24" step="1" value="' + esc(c.dayHours) + '" style="width:6em"> 時間（時間単位の有休の1日の換算・特別休暇の1日の時間。1時間に満たない端数は切り上げて入れます）</span>' +
      '<span>特別休暇の種類</span><span><span class="tw" style="display:block"><table><thead><tr><th>印（英数字）</th><th>名前</th><th>有給か</th></tr></thead><tbody id="lt-rows">' + rows.join('') + '</tbody></table></span>' +
        '<button type="button" class="btn sm" data-act="lt-add">行を足す</button> 名前を空にした行は外します。印は入れた休暇の行が使うので、入れた後は変えないでください（変えると、前の行の名前が印のまま出ます）</span></div></div>';
  }
  /* 特別休暇の種類の空の行を1つ足す（画面全体は描き直さない＝入れている途中の値を消さない） */
  function ltAddRow() {
    var tb = $('lt-rows'); if (!tb) return;
    var i = 0; while ($('lt-code-' + i)) i++;
    if (i >= C.LEAVE_TYPES_MAX) { toast('特別休暇の種類は' + C.LEAVE_TYPES_MAX + '種類までです'); return; }
    var tr = document.createElement('tr'), td1 = document.createElement('td'), td2 = document.createElement('td'), td3 = document.createElement('td');
    var a = document.createElement('input'); a.type = 'text'; a.id = 'lt-code-' + i; a.maxLength = 20; a.style.width = '8em'; a.setAttribute('aria-label', '印（英数字）' + (i + 1));
    var b = document.createElement('input'); b.type = 'text'; b.id = 'lt-name-' + i; b.maxLength = 20; b.style.width = '10em'; b.setAttribute('aria-label', '名前 ' + (i + 1));
    var lb = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'lt-paid-' + i;
    lb.appendChild(cb); lb.appendChild(document.createTextNode(' 有給'));
    td1.appendChild(a); td2.appendChild(b); td3.appendChild(lb); tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tb.appendChild(tr);
    a.focus();
  }
  /* 入れた値を設定の鍵にする。{ vals, bad }（欄が無い時は null＝今の設定のまま）。今の設定に無い鍵は、既定のままなら作らない（保存する中身を増やさない） */
  function readLvSet() {
    if (!$('l-roundUnitMin')) return null;
    var cur = rawCfg(), d = C.DEFAULTS, vals = {}, bad = [];
    var ru = +$('l-roundUnitMin').value, dh = $('l-dayHours').value, hp = !!$('l-hourly').checked;
    if (C.ROUND_UNITS.indexOf(ru) < 0) bad.push('丸めの単位');
    var dhn = +dh; if (dh === '' || !(dhn >= 1 && dhn <= 24) || Math.floor(dhn) !== dhn) bad.push('1日の所定の時間（1〜24 の整数）');
    var lts = [], i, codes = {};
    for (i = 0; $('lt-code-' + i); i++) {
      var cd = String($('lt-code-' + i).value || '').trim(), nm = String($('lt-name-' + i).value || '').trim();
      if (!nm && !cd) continue;
      if (!nm) continue;   /* 名前を空にした行は外す */
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(cd) || codes[cd] || nm.length > 20) { bad.push('特別休暇の種類 ' + (i + 1) + ' 行目（印は英数字・_・- の20字まで・重ならない／名前は20字まで）'); continue; }
      codes[cd] = 1;
      lts.push({ code: cd, name: nm, paid: !!$('lt-paid-' + i).checked });
    }
    if (lts.length > C.LEAVE_TYPES_MAX) bad.push('特別休暇の種類（' + C.LEAVE_TYPES_MAX + '種類まで）');
    if (bad.length) return { vals: null, bad: bad };
    var put = function (k, v, dflt) { if (k in cur || JSON.stringify(v) !== JSON.stringify(dflt)) vals[k] = v; };
    put('roundUnitMin', ru, d.roundUnitMin); put('hourlyPaidLeave', hp, d.hourlyPaidLeave); put('dayHours', dhn, d.dayHours);
    put('leaveTypes', lts, C.LEAVE_TYPES_DEFAULT);
    return { vals: vals, bad: bad };
  }
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
    h += lvSetHtml();   /* v5 段4: 休暇と丸め（設定の欄の続き） */
    h += exSetHtml();   /* 段A1: 補助項目（関数が無い時は出さない） */
    h += a2SetHtml();   /* 段A2: 記号の組・通勤回数・社内会議を時間外に足す（補助項目の欄と同じく、関数が無い時は出さない） */
    h += '</form>' + a36Form() + '<div class="row"><button type="button" class="btn pri" data-act="save-set"' + (isAdmin() ? '' : ' disabled') + '>設定を保存する</button></div>' +
      '<p class="help">休憩の時間（日勤 ' + esc(c.breakH) + ' 時間・夜勤 ' + esc(c.nightBreakH) + ' 時間・拘束が ' + esc(c.breakThresholdH) + ' 時間を超えたら引く）はシフトアプリの設定を取り込んで使います（ここでは変えません）。丸めの決まり: 予定より早い出勤は予定の開始から、予定より遅い退勤は予定の終わりまで数えます。始業前・終業後に実際に働いた時は、その日を「直す」で早出・残業を認めてください（認めないまま切り捨てると賃金の未払いになります）。</p></div>';
    /* v5 1-5: 勤怠の管理者の名簿（管理者だけに出す・画面だけで印刷しない） */
    if (isAdmin()) {
      if (!mgrSt && !mgrBusy) loadMgr();
      h += '<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 8px">勤怠の管理者</h2><div id="g-mgr">' + mgrHtml() + '</div></div>';
    }
    return h;
  }

  /* ── v5 段3: 36協定の上限の入力（設定の鍵 agreement36・無い時は既定＝freee の初期値・仮置き）──
   * 月の目安は今の欄（overtimeMonthWarnH・月の法定外がこの時間以上で警告）をそのまま使い、ここに別の欄を作らない（2つの値が食い違わないように・仮置き）。
   * 保存は上の「設定を保存する」（管理者だけ）。欄は今の設定から出す（締めた月分の控えから出さない） */
  var A36_FIELDS = [
    ['monthLimitH', '月の上限（法定外）', '時間（45 まで）'], ['yearLimitH', '年の上限（法定外）', '時間（360 まで）'], ['yearWarnH', '年の目安（この時間以上で知らせる）', '時間（0＝知らせない）'],
    ['specialMonthMaxH', '特別条項: 月の上限（休日労働を含む）', '時間（100 まで）'], ['specialAvgH', '特別条項: 2〜6か月の平均の上限（休日労働を含む）', '時間（80 まで）'],
    ['specialYearH', '特別条項: 年の上限（法定外）', '時間（720 まで）'], ['specialCountMax', '特別条項: 月の上限を超えてよい回数', '回（6 まで）']
  ];
  function a36Form() {
    if (!K36) return '<div class="band warn" role="status">36協定の部品を読み込めませんでした。ページを読み込み直してください。</div>';
    var a = K36.fillAgreement(rawCfg());
    var h = '<h2 style="font-size:16px;margin:14px 0 8px">36協定（時間外・休日労働の協定）</h2><form id="g-a36" class="kv">' +
      '<label for="a-startMonth">起算月（協定の年度の始まり）</label><span><select id="a-startMonth">' + Array.apply(null, Array(12)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (a.startMonth === i + 1 ? ' selected' : '') + '>' + (i + 1) + '月</option>'; }).join('') + '</select></span>';
    A36_FIELDS.slice(0, 3).forEach(function (f) { h += '<label for="a-' + f[0] + '">' + esc(f[1]) + '</label><span><input type="number" step="any" id="a-' + f[0] + '" value="' + esc(a[f[0]]) + '" style="width:7em"> ' + esc(f[2]) + '</span>'; });
    h += '<label for="a-special">特別条項</label><span><input type="checkbox" id="a-special"' + (a.special ? ' checked' : '') + '> 結んでいる（下の4つを使う）</span>';
    A36_FIELDS.slice(3).forEach(function (f) { h += '<label for="a-' + f[0] + '">' + esc(f[1]) + '</label><span><input type="number" step="any" id="a-' + f[0] + '" value="' + esc(a[f[0]]) + '" style="width:7em"> ' + esc(f[2]) + '</span>'; });
    return h + '</form><p class="help">月の目安は、上の「月の法定外がこの時間以上で警告（36協定）」を使います。法定外＋休日労働の月100時間未満と2〜6か月の平均80時間以下（労基法36条6項）は、この設定にかかわらず見ます。法定休日を決めていない時は休日労働を数えられないため、休日労働を含む上限は少なく出ます。月の30分の四捨五入を使う時も、丸める前の時間で見ます。</p>';
  }
  /* 入れた値を agreement36 にする。範囲の外・形の違う値は bad に欄の名前を入れる（保存しない）。今の設定の agreement36 にほかの鍵があれば残す */
  function readA36() {
    var cur = rawCfg().agreement36, out = {}, bad = [], k;
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) for (k in cur) out[k] = cur[k];
    if (!$('g-a36')) return { obj: null, bad: bad };
    out.startMonth = +$('a-startMonth').value;
    out.special = $('a-special').checked;
    A36_FIELDS.forEach(function (f) { var v = $('a-' + f[0]).value; if (v === '' || !isFinite(+v)) bad.push(f[1]); else out[f[0]] = +v; });
    if (!bad.length) {
      var filled = K36.fillAgreement({ agreement36: out });
      ['startMonth', 'special'].concat(A36_FIELDS.map(function (f) { return f[0]; })).forEach(function (f) { if (filled[f] !== out[f]) bad.push(f === 'startMonth' ? '起算月' : f === 'special' ? '特別条項' : A36_FIELDS.filter(function (x) { return x[0] === f; })[0][1]); });
    }
    /* 今の設定に agreement36 が無く、入れた値が全部既定のままなら鍵を作らない（無い時と同じ動き・保存する中身を増やさない） */
    if (!bad.length && !(cur && typeof cur === 'object')) {
      var dflt = K36.DEFAULTS, same = ['startMonth', 'special'].concat(A36_FIELDS.map(function (f) { return f[0]; })).every(function (f) { return out[f] === dflt[f]; });
      if (same) return { obj: null, bad: bad };
    }
    return { obj: out, bad: bad };
  }
  /* v5 C4: 設定タブの入力（勤怠の管理者の欄は除く）。描いた時の値と違えば、保存していない変更あり */
  function settingsState() {
    var v = [], els = document.querySelectorAll('#g-set input,#g-set select,#g-a36 input,#g-a36 select');
    for (var i = 0; i < els.length; i++) { var e = els[i]; v.push(e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? '1' : '0') : e.value); }
    return v.join('\u0001');
  }
  function settingsDirty() { return view === 'app' && tab === 'settings' && setInit != null && !!$('g-set') && settingsState() !== setInit; }
  /* タブ・月の切り替え・読み直しの前に、保存していない設定の変更を確かめる（窓の確かめ dirty とは別に持つ） */
  function settingsLeaveOk() { return !settingsDirty() || confirm('保存していない設定の変更があります。変更を捨てて移りますか？'); }

  /* ── 段A1（2026-11-25・凍結仕様 ROOT-v7-plus-parity.md「段A1」・統合 0127）: 日ごとの補助項目（移動距離・健診・社内会議など手で入れる項目）──
   * 項目の定義は設定の鍵 extraItems（設定のタブの「補助項目」で足す・名前と形を直す・止める。コードは変えない・消さない。保存は「設定を保存する」）。
   * 日の行は月分ごとに kintai_extras_get で読む（月の読み込みの鎖に入れず、自分の世代で捨てる・画面の中だけ・端末に残さない）。
   * 関数がまだ無い（0127 の前）時は、補助項目の欄をどこにも出さず、聞き直さない（自動の報告にも回さない・CSV も今のまま）。
   * 入れる・直す（kintai_extra_put＝同じ人・日・項目の前の行に取り消しの印を付けて足す）・取り消す（kintai_extra_void・理由が要る）は個人の月から。
   * 締めた月分は入れる欄を出さない（DB も locked で断る）。個人の月の紙（印刷）には出さない＝紙は今のまま */
  var exSt = null, exGen = 0, exNoDb = false;
  var exTouched = false, exStaleT = 0;   /* 設定の「補助項目」の欄を触ったか（触った時だけ extraItems を送る＝ほかの設定の保存で初めの案が決まらない・反証レビュー 2026-11-25 M3） */
  function exOn() { return !!EX && !exNoDb; }
  function exItems() { return EX ? EX.itemsOf(rawCfg()) : null; }
  function exActive() { return EX ? EX.activeItems(rawCfg()) : []; }
  function exItem(code) { return (exItems() || []).filter(function (x) { return x.code === code; })[0] || null; }
  function exReady() { return exOn() && !!exSt && exSt.ym === ym && !exSt.err; }
  function exCanInput() { return exReady() && !isLocked() && exActive().length > 0; }
  var NG_EX = { baddate: 'その日には入れられません（来月分の期間の終わりより先の日です）。日付を確かめてください。',
    badcode: 'この項目は使えません（設定のタブの「補助項目」をまだ保存していないか、項目を止めてあります）。保存は管理者（2段階認証まで済んだ人）が行います。読み直してから入れてください。',
    badvalue: '入れた値を受け付けられませんでした（回数・数値は 0〜99999.99 で設定の小数の桁まで・時間は1分〜24時間・メモは200字まで）。',
    notfound: '見つかりませんでした（勤怠の職員にいないか、もう取り消された行です）。読み直してください。',
    locked: 'その日は締めた月分に入っているため、入れることも取り消すこともできません。直す時は管理者が締めを解除してください。',
    reason: '取り消す理由を書いてください。', already: 'もう取り消してあります。読み直してください。' };
  function exMsg(e) { return e && e.kintai && NG_EX[e.kintai] ? NG_EX[e.kintai] : msgOf(e); }
  /* retry: 関数が無いと分かった後でも、設定に extraItems が保存されていれば（別の端末で 0127 の後に保存した）聞き直す（月を開いた時・CSV の前だけ。30秒ごとの読み直しでは聞き直さない・反証レビュー 2026-11-25 M1） */
  function loadExtras(retry) {
    if (retry && EX && exNoDb && Array.isArray(rawCfg().extraItems)) exNoDb = false;
    if (!exOn() || !ym) return Promise.resolve();
    var my = ++exGen, atYm = ym, before = exSt && exSt.ym === atYm && !exSt.err ? JSON.stringify(exSt.rows) : null, same = false;
    return rpc('kintai_extras_get', { p_ym: atYm }).then(okOr).then(function (r) {
      if (my !== exGen) return;
      exSt = { ym: atYm, from: r.from, to: r.to, at: Date.now(), rows: (Array.isArray(r.rows) ? r.rows : []).filter(function (x) { return x && !x.voided_at && typeof x.staff_id === 'string' && typeof x.code === 'string' && C.isDate(x.date); }) };
      same = before != null && before === JSON.stringify(exSt.rows);   /* 変わっていなければ描き直さない（30秒ごとの読み直しで画面をちらつかせない） */
    })['catch'](function (e) {
      if (my !== exGen) return;
      if (noDb(e)) { exNoDb = true; exSt = null; return; }
      if (!isNetErr(e) && !isDenied(e)) note('補助項目の読み込み', e);
      exSt = { ym: atYm, rows: [], err: '補助項目を読めませんでした: ' + exMsg(e) };
    }).then(function () {
      if (my !== exGen) return;
      /* 読み終わったら、補助項目を出すタブだけ描き直す（設定のタブは保存していない変更が無い時だけ＝入れている途中の値を消さない） */
      if (view !== 'app' || busy || printAll || !month || same) return;
      if (tab === 'person' || (tab === 'settings' && !settingsDirty())) paint();
    });
  }
  /* 30秒ごと・画面に戻った時の補助項目の読み直し（個人の月を開いている時だけ。窓を開いている・選ぶ欄を触っている間はしない・反証レビュー 2026-11-25 S1）。
     ほかのタブ（ホーム・日ごと・要確認）は月の読み直し（quietReload）の後に読む */
  function exQuiet() {
    if (!exOn() || view !== 'app' || busy || dlgCtx || printAll || !month || tab !== 'person') return;
    if (document.visibilityState === 'hidden') return;
    var ae = document.activeElement;
    if (ae && ae.tagName === 'SELECT' && $('g-main').contains(ae)) return;
    loadExtras(false);
  }
  /* CSV を書き出す直前に補助項目を読み直し、済んでから組み立てる（別の端末で入れた分を落とさない・反証レビュー 2026-11-25 S1） */
  function exFresh(then) {
    if (!EX || (!exOn() && !Array.isArray(rawCfg().extraItems)) || !(exItems() || []).length) { then(); return; }
    sync('補助項目を読み直しています…');
    loadExtras(true).then(function () { sync(isLocked() ? '締め済みの月です' : '読み込みました（' + hm(Date.now()) + '）'); then(); });
  }
  function exVal(r, it) { return it && it.kind === 'time' ? r.minutes : r.qty; }
  function exRowsOf(sid, date) { return exReady() ? exSt.rows.filter(function (r) { return r.staff_id === sid && (date == null || r.date === date); }) : []; }
  /* 個人の月の日の行の札（画面だけ・紙に出さない） */
  function exDayTags(sid, date) {
    var rs = exRowsOf(sid, date);
    if (!rs.length) return '';
    return '<span class="no-print">' + rs.map(function (r) { var it = exItem(r.code); return '<span class="tag">' + esc(it ? EX.label(it, exVal(r, it)) : r.code) + '</span>'; }).join('') +
      (typeof a2OverOn === 'function' && a2OverOn(sid, date) ? '<span class="tag rv">' + esc(EX.MEETING_OVER_TEXT) + '</span>' : '') + '</span>';   /* 段A2: 会議の時間がこの日の数えなかった時間より多い日の知らせ（知らせだけ・仮置き） */
  }
  function exDayBtn(sid, date) { return exCanInput() ? '<button type="button" class="btn sm" data-act="ex-open" data-sid="' + esc(sid) + '" data-date="' + esc(date) + '">補助項目</button>' : ''; }
  /* 個人の月の下の「補助項目（日ごと）」の欄（画面だけ・紙に出さない）。勤務の無い日（健診だけの日など）もここから入れる */
  function exPersonHtml(p) {
    if (!exOn()) return '';
    var sid = p.staff.staff_id, h = '<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 8px">補助項目（日ごと）</h2>';
    /* 読んでから30秒より古ければ、描いた後に裏で読み直す（タブを移った時・職員を選び直した時も新しくする・変わっていなければ描き直さない） */
    if (exSt && exSt.ym === ym && !exSt.err && Date.now() - (exSt.at || 0) > 30000 && !exStaleT) { exStaleT = setTimeout(function () { exStaleT = 0; exQuiet(); }, 0); }
    if (!exSt || exSt.ym !== ym) return h + '<p class="empty">読み込んでいます…</p></div>';
    if (exSt.err) return h + '<div class="band warn" role="status">' + esc(exSt.err) + '</div><div class="row"><button type="button" class="btn sm k5" data-act="ex-reload">読み直す</button></div></div>';
    var items = exItems();
    /* DB は設定に extraItems を保存するまで、どの項目も断る（初期の7つは案で、DB は持たない・統合 0127） */
    if (!items) return h + '<p class="help">初めの7つ（' + esc(EX.EXTRA_ITEMS_DEFAULT.map(function (x) { return x.name; }).join('・')) + '）は案です。設定のタブの「補助項目」で保存すると、ここで日ごとに入れられるようになります。' +
      (isAdmin() ? '設定のタブで中身を確かめて「設定を保存する」を押してください。' : '保存できるのは管理者（2段階認証まで済んだ人）だけです。管理者に保存を頼んでください。') + '</p></div>';
    var act = exActive(), rs = exRowsOf(sid, null).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1; });
    var lk = isLocked(), S0 = EX.sumExtras(rs, items), sums = S0.byStaff[sid] || Object.create(null), mm = EX.mismatchText(S0.mismatch, items);
    var tot = EX.csvItems(items, rs).map(function (it) { return EX.label(it, sums[it.code] || 0); }).join('・');   /* 使う項目と、止めた項目でもこの月分に行がある項目（CSV の列と同じ） */
    h += '<div class="row">' + (lk ? '<span class="help">締めた月分のため、入れることも取り消すこともできません。</span>' : (act.length ? '<button type="button" class="btn sm k5" data-act="ex-open" data-sid="' + esc(sid) + '">補助項目を入れる</button>' : '<span class="help">使う項目がありません（設定のタブの「補助項目」で「使う」にします）。</span>')) + '</div>';
    if (tot) h += '<p><b>この月分の合計:</b> ' + esc(tot) + '</p>';
    if (mm) h += '<div class="band warn" role="status">' + esc(mm) + '</div>';   /* 形を変えた項目の前の形の行（数えない・反証レビュー 2026-11-25） */
    var body = rs.map(function (r) {
      var it = exItem(r.code), on = !!(it && it.active);
      return '<tr><td>' + esc(md(r.date)) + '（' + wd(r.date) + '）</td><td>' + esc(it ? EX.nameOf(it) : r.code) + (on ? '' : ' <span class="tag">' + (it ? '止めた項目' : '設定に無い項目') + '</span>') + '</td><td class="num">' + esc(!it ? '' : exVal(r, it) == null ? '形が違う（数えていません）' : EX.fmtValue(it, exVal(r, it), 'hmm', true)) + '</td><td style="white-space:normal">' + esc(r.note || '') + '</td>' +
        '<td>' + (lk ? '' : (on ? '<button type="button" class="btn sm k5" data-act="ex-open" data-sid="' + esc(sid) + '" data-date="' + esc(r.date) + '" data-code="' + esc(r.code) + '">直す</button>' : '') + '<button type="button" class="btn sm k5 ng" data-act="ex-void" data-id="' + esc(r.id) + '">取り消す</button>') + '</td></tr>';
    }).join('');
    h += '<div class="tw"><table><thead><tr><th>日</th><th>項目</th><th class="num">値</th><th>メモ</th><th></th></tr></thead><tbody>' + (body || '<tr><td colspan="5" class="empty">この月分の補助項目はまだありません</td></tr>') + '</tbody></table></div>' +
      '<p class="help">直すと前の値には取り消しの印が付き、直しの履歴に残ります（消しません）。月の集計の CSV（給与向け）の末尾に、使う項目ごとの月の合計が出ます。</p>';
    return h + '</div>';
  }
  /* 入れる・直す窓。date・code があればその日・その項目（直す時は日と項目を変えない＝別の行になるため） */
  function openExtra(sid, date, code) {
    if (!exCanInput() || !sid) return;
    var act = exActive(), pp = per(), cur = code ? exRowsOf(sid, date).filter(function (r) { return r.code === code; })[0] || null : null;
    var it0 = (code && act.filter(function (x) { return x.code === code; })[0]) || act[0];
    var edit = !!(code && cur);
    var b = '<p>' + esc(nameOf(sid)) + ' さん（' + esc(perLabel()) + '）</p>' +
      '<div class="row"><label>日 <input type="date" class="k5" id="ex-date" min="' + esc(pp.from) + '" max="' + esc(pp.to) + '" value="' + esc(date && inPer(date) ? date : '') + '"' + (edit ? ' disabled' : '') + '></label>' +
      '<label>項目 <select class="k5" id="ex-code"' + (edit ? ' disabled' : '') + '>' + act.map(function (x) { return '<option value="' + esc(x.code) + '"' + (x.code === it0.code ? ' selected' : '') + '>' + esc(EX.nameOf(x)) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="row"><label id="ex-qty-l">値 <input type="text" class="k5" id="ex-qty" inputmode="decimal" autocomplete="off" style="width:8em" value="' + esc(cur && it0.kind !== 'time' && cur.qty != null ? EX.fmtValue(it0, cur.qty, 'hmm', false) : '') + '"> <span id="ex-unit"></span></label>' +
      '<label id="ex-time-l">時間 <input type="number" class="k5" id="ex-h" min="0" max="24" step="1" style="width:5em" value="' + esc(cur && it0.kind === 'time' && cur.minutes != null ? Math.floor(cur.minutes / 60) : '') + '"> 時間 <input type="number" class="k5" id="ex-m" min="0" max="59" step="1" style="width:5em" value="' + esc(cur && it0.kind === 'time' && cur.minutes != null ? cur.minutes % 60 : '') + '"> 分</label></div>' +
      '<div class="row"><label style="flex:1">メモ（なくてよい）<input type="text" class="k5" id="ex-note" maxlength="200" style="flex:1;min-width:14em" value="' + esc(cur && cur.note || '') + '"></label></div>' +
      '<p class="help" id="ex-meet-help" hidden>' + esc(EX.MEETING_INPUT_HELP || '') + '</p>' +
      '<p class="help">同じ日・同じ項目にもう値がある時は、入れ直しになります（前の値には取り消しの印が付き、直しの履歴に残ります）。</p><p class="help" id="e-msg" role="alert"></p>';
    openDlg(edit ? '補助項目を直す' : '補助項目を入れる', b, false, '保存する', 'ex-save');
    dlgCtx = { mode: 'extra', sid: sid, edit: edit, date: edit ? date : null, code: edit ? code : null };
    exKindShow();
    dlgCtx.init = formState();
  }
  /* 選んだ項目の形に合う欄だけを出す（回数・数値＝値・時間＝時間と分） */
  function exKindShow() {
    var sel = $('ex-code'); if (!sel) return;
    var it = exItem(sel.value), tm = !!(it && it.kind === 'time');
    $('ex-qty-l').hidden = tm; $('ex-time-l').hidden = !tm;
    $('ex-unit').textContent = it ? (it.kind === 'count' ? '回' : it.unit || '') : '';
    $('ex-qty').setAttribute('inputmode', it && it.kind === 'count' ? 'numeric' : 'decimal');
    /* 段A2: 社内会議（時間外に足す項目）を選んだ時だけ案内を出す（文は仮置き） */
    var mo = EX.meetingOtOf ? EX.meetingOtOf(rawCfg()) : null, hp = $('ex-meet-help');
    if (hp) hp.hidden = !(mo && mo.on && it && it.code === mo.code && tm);
  }
  var EX_WHY = { empty: '値を入れてください。', neg: '0 以上で入れてください。', int: '時間は分まで（整数）で入れてください。' };
  function saveExtra(btn) {
    var ctx = dlgCtx;
    if (!ctx || ctx.mode !== 'extra' || busy) return;
    var msg = $('e-msg'), date = ctx.edit ? ctx.date : $('ex-date').value, code = ctx.edit ? ctx.code : $('ex-code').value, it = exItem(code);
    if (!C.isDate(date) || !inPer(date)) { msg.textContent = 'この月分（' + perLabel() + '）の日を選んでください。'; return; }
    if (!it || !it.active) { msg.textContent = '項目を選んでください。'; return; }
    var pv;
    if (it.kind === 'time') {
      var mm = EX.minutesOf($('ex-h').value, $('ex-m').value);
      pv = mm == null ? { ok: false, why: 'empty' } : EX.parseValue(it, isNaN(mm) ? 'x' : mm);
    } else pv = EX.parseValue(it, $('ex-qty').value);
    if (!pv.ok) {
      msg.textContent = EX_WHY[pv.why] || (it.kind === 'time' ? '時間は1分〜24時間で入れてください（分は 0〜59）。' : pv.why === 'decimals' ? (it.kind === 'count' ? '回数は整数で入れてください。' : '小数は ' + it.decimals + ' 桁までです（設定の「補助項目」で決めた桁）。') : '0〜99999.99 の数で入れてください。');
      return;
    }
    var nt = String($('ex-note').value || '').trim();
    if (nt.length > 200) { msg.textContent = 'メモは200字までです。'; return; }
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    rpc('kintai_extra_put', { p_staff: ctx.sid, p_date: date, p_code: code, p_qty: pv.qty, p_minutes: pv.minutes, p_note: nt || null }).then(okOr).then(function () {
      busy = false; closeDlg(); editsCache = null;
      toast('補助項目を保存しました（' + nameOf(ctx.sid) + ' さん ' + md(date) + ' ' + EX.label(it, it.kind === 'time' ? pv.minutes : pv.qty) + '）');
      return loadExtras();
    })['catch'](function (e) { busy = false; restore(); if (!isNetErr(e) && !(e && e.kintai)) note('補助項目を入れる', e); if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = exMsg(e); else toast(exMsg(e)); });
  }
  function openExtraVoid(id) {
    if (!exReady() || isLocked()) return;
    var r = exSt.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) { toast(NG_EX.notfound); return; }
    var it = exItem(r.code);
    openDlg('補助項目を取り消す', '<p>' + esc(nameOf(r.staff_id)) + ' さん ' + esc(md(r.date)) + '（' + wd(r.date) + '）の「' + esc(it ? EX.label(it, exVal(r, it)) : r.code) + '」を取り消します。行は消さずに取り消しの印を付け、直しの履歴に残ります。</p>' +
      reasonRow('例: 入れる日を間違えたため'), false, '取り消す', 'ex-void-go');
    dlgCtx = { mode: 'extra', id: id, sid: r.staff_id };
    dlgCtx.init = formState();
  }
  function voidExtra(btn) {
    var ctx = dlgCtx;
    if (!ctx || ctx.mode !== 'extra' || !ctx.id || busy) return;
    var msg = $('e-msg'), reason = needReason(msg); if (!reason) return;
    busy = true; var restore = pressBusy(btn, '取り消しています…', $('g-dlg-f'));
    rpc('kintai_extra_void', { p_id: ctx.id, p_reason: reason }).then(okOr).then(function () {
      busy = false; closeDlg(); editsCache = null; toast('補助項目を取り消しました（' + nameOf(ctx.sid) + ' さん）');
      return loadExtras();
    })['catch'](function (e) { busy = false; restore(); if (!isNetErr(e) && !(e && e.kintai)) note('補助項目を取り消す', e); if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = exMsg(e); else toast(exMsg(e)); });
  }
  /* 設定のタブの「補助項目」の欄（設定の欄 #g-set の中＝保存していない変更の確かめが同じ道で数える）。保存済みのコードは変えられない・行は消さない */
  function exSetRow(i, it, saved) {
    var k = it ? it.kind : 'count', n = i + 1;
    var opt = function (v, t, cur) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + t + '</option>'; };
    var dec = String(it ? it.decimals : 0);
    return '<tr><td><input type="text" class="k5" id="ex-s-code-' + i + '" maxlength="20" value="' + esc(it ? it.code : '') + '"' + (saved ? ' readonly' : '') + ' aria-label="補助項目のコード ' + n + '" style="width:9em"></td>' +
      '<td><input type="text" class="k5" id="ex-s-name-' + i + '" maxlength="20" value="' + esc(it ? it.name : '') + '" aria-label="補助項目の名前 ' + n + '" style="width:11em"></td>' +
      '<td><select class="k5" id="ex-s-kind-' + i + '" aria-label="補助項目の形 ' + n + '"' + (saved && exHasRows(it.code) ? ' disabled title="この月分に入れた行があるため形は変えられません（止めて、新しいコードで足します）"' : '') + '>' + opt('count', '回数', k) + opt('number', '数値＋単位', k) + opt('time', '時間', k) + '</select></td>' +
      '<td><input type="text" class="k5" id="ex-s-unit-' + i + '" maxlength="10" value="' + esc(it ? it.unit : '') + '" aria-label="補助項目の単位 ' + n + '" style="width:6em"></td>' +
      '<td><select class="k5" id="ex-s-dec-' + i + '" aria-label="補助項目の小数の桁 ' + n + '">' + opt('0', '整数', dec) + opt('1', '1桁', dec) + opt('2', '2桁', dec) + '</select></td>' +
      '<td><label><input type="checkbox" id="ex-s-act-' + i + '"' + (!it || it.active ? ' checked' : '') + '> 使う</label></td></tr>';
  }
  /* 読み込んだ月分にその項目の行があるか（あれば設定で形を変えさせない＝前の形の行が合計から消えないように・反証レビュー 2026-11-25） */
  function exHasRows(code) { return !!exSt && !exSt.err && exSt.rows.some(function (r) { return r.code === code; }); }
  function exSetHtml() {
    if (!exOn() || !exSt) return '';   /* 関数がまだ無い・まだ確かめていない時は出さない（確かめ終わったら描き直す） */
    exTouched = false;   /* 描き直したら触っていない状態から */
    var saved = exItems(), list = saved || EX.copyDefault();
    return '<div style="grid-column:1/-1" class="no-print"><h2 style="font-size:16px;margin:14px 0 8px">補助項目（日ごとに手で入れる項目）</h2>' +
      '<p class="help">個人の月で、日ごとに入れる項目です（移動距離・健診など）。月の集計の CSV（給与向け）の末尾に、使う項目ごとの月の合計の列が出ます。項目は消せません。使わなくなった項目は「使う」を外して止めます。コードは入れた行が使うので、保存した後は変えられません。単位と小数の桁は「数値＋単位」の時だけ使います（時間は時間と分で入れます）。' +
      (saved ? 'この月分に入れた行がある項目は、形を変えられません（変える時は止めて、新しいコードで足します）。' : '<b>まだ決めていません。下は初めの案です。案のまま使う時は下の「この案で補助項目を使い始める」を、直す時は欄を直して「設定を保存する」を押します（ほかの設定だけを保存しても、補助項目は決まりません）。</b>') + '</p>' +
      '<span class="tw" style="display:block"><table><thead><tr><th>コード（英数字）</th><th>名前</th><th>形</th><th>単位</th><th>小数の桁</th><th>使う</th></tr></thead><tbody id="ex-s-rows">' +
      list.map(function (it, i) { return exSetRow(i, it, !!saved); }).join('') + '</tbody></table></span>' +
      '<button type="button" class="btn sm k5" data-act="ex-add-row">行を足す</button>' + (saved ? '' : ' <button type="button" class="btn sm k5 pri" data-act="ex-adopt"' + (isAdmin() ? '' : ' disabled') + '>この案で補助項目を使い始める</button>') + ' <span class="help">' + EX.MAX_ITEMS + '個まで。コードと名前を空にした新しい行は保存しません。</span></div>';
  }
  /* 空の行を1つ足す（画面全体は描き直さない＝入れている途中の値を消さない） */
  function exAddRow() {
    var tb = $('ex-s-rows'); if (!tb) return;
    exTouched = true;
    var i = 0; while ($('ex-s-code-' + i)) i++;
    if (i >= EX.MAX_ITEMS) { toast('補助項目は' + EX.MAX_ITEMS + '個までです'); return; }
    tb.insertAdjacentHTML('beforeend', exSetRow(i, null, false));
    $('ex-s-code-' + i).focus();
  }
  var EX_BAD = { code: 'コードは英数字・_・- の20字まで', dup: 'コードがほかの行と重なっています', name: '名前は1〜20字（止める時は名前を消さずに「使う」を外します）', kind: '形を選んでください', unit: '単位は10字まで', decimals: '小数の桁は 0〜2', active: '「使う」の印が読めません', max: EX ? EX.MAX_ITEMS + '個まで' : '', shape: '形が違います' };
  /* 入れた値を extraItems にする。{ items, bad }（欄が無い時は null＝今の設定のまま送る）。保存済みの項目は必ず残す（消さない） */
  function readExSet() {
    if (!$('ex-s-rows') || !EX || !exTouched) return null;   /* 触っていない時は今の extraItems（無ければ無し）をそのまま残す */
    var raw = [], rowNo = [], bad = [], i;
    for (i = 0; $('ex-s-code-' + i); i++) {
      var ce = $('ex-s-code-' + i), code = String(ce.value || '').trim(), name = String($('ex-s-name-' + i).value || '').trim(), kind = $('ex-s-kind-' + i).value;
      if (!ce.readOnly && !code && !name) continue;   /* 足したが使わなかった空の行 */
      var num = kind === 'number', unit = num ? String($('ex-s-unit-' + i).value || '').trim() : '';
      if (!name || name.length > EX.NAME_MAX) { bad.push('補助項目 ' + (i + 1) + ' 行目（' + EX_BAD.name + '）'); continue; }
      if (unit.length > EX.UNIT_MAX) { bad.push('補助項目 ' + (i + 1) + ' 行目（' + EX_BAD.unit + '）'); continue; }
      /* 単位と小数の桁は「数値＋単位」の時だけ送る（回数・時間は単位なし・桁 0） */
      raw.push({ code: code, name: name, kind: kind, unit: unit, decimals: num ? +$('ex-s-dec-' + i).value : 0, active: !!$('ex-s-act-' + i).checked });
      rowNo.push(i + 1);
    }
    var cl = EX.cleanExtraItems(raw);
    cl.bad.forEach(function (b) { bad.push('補助項目 ' + (rowNo[b.row - 1] || b.row) + ' 行目（' + (EX_BAD[b.why] || '形が違います') + '）'); });
    (exItems() || []).forEach(function (x) { if (!bad.length && !cl.items.some(function (y) { return y.code === x.code; })) bad.push('保存済みの補助項目「' + EX.nameOf(x) + '」が見つかりません。読み直してください'); });
    return { items: cl.items, bad: bad };
  }
  function exKindChanged(items) {
    var old = exItems() || [];
    return items.filter(function (x) { var o = old.filter(function (y) { return y.code === x.code; })[0]; return o && o.kind !== x.kind; }).map(function (x) { return EX.nameOf(x); });
  }
  /* 月の集計・日ごとの CSV の末尾の列（列にする項目が無い・関数が無い時は null＝今の CSV のまま。項目があるのに読めていない時は false＝書き出さない） */
  function exCsv(kind, src, text) {
    if (!exOn()) {
      /* 関数が無いと分かった後なのに設定に項目がある（別の端末で 0127 の後に保存した）時は、列なしで黙って出さない（反証レビュー 2026-11-25 M1） */
      if (EX && exNoDb && (EX.itemsOf(rawCfg()) || []).length) { alert('補助項目の仕組みを読み込めていないため、書き出せません（補助項目の列が抜けた CSV を出さないため）。ページを読み直して（再読み込みして）から、もう一度書き出してください。直らない時は管理者に知らせてください。'); return false; }
      return null;
    }
    if (!(exItems() || []).length) return null;   /* 項目をまだ保存していない＝行も無い（DB が断る） */
    if (!exReady()) { alert('補助項目を読み込めていないため、書き出せません（補助項目の列が 0 のまま出るのを防ぐため）。上の「読み直す」を押すか、通信（Wi-Fi）がつながっているかを確かめてから、もう一度書き出してください。' + (exSt && exSt.err ? '\n（' + exSt.err + '）' : '')); return false; }
    /* 列は使う項目と、止めた項目でもこの月分に行がある項目（入れた数が CSV から消えないように・統合 0127 の確定） */
    var items = EX.csvItems(exItems() || [], exSt.rows);
    if (!items.length) return null;
    var sums = EX.sumExtras(exSt.rows, exItems() || []);
    /* 結ぶ人は CSV に行を出す人だけ（buildCsv と同じ条件・従業員コードの重なりで別の人の行に付けない・反証レビュー 2026-11-25 M2） */
    var out = EX.appendCsv(text, kind, { people: EX.csvPeople(src.people), items: items, sums: sums, mode: src.config && src.config.csvTime });
    if (out.dup && out.dup.length) out.warn0 = '従業員コードが同じ職員がいるため（' + out.dup.map(function (p) { return p.name + '（' + p.emp_code + '）'; }).join('・') + '）、その人たちの補助項目は CSV に付けていません（欄は空）。「職員と番号」で従業員コードを直してから書き出してください。';
    out.warn = EX.mismatchText(sums.mismatch, exItems() || []);   /* 形を変えた項目の前の形の行は数えていない（書き出しの後の注意に出す） */
    /* 設定から消えた項目の行（コードが今の定義に無い）は列にできないので数を知らせる（ふつうは起きない＝画面で項目を消せない） */
    var known = {}; (exItems() || []).forEach(function (x) { known['k' + x.code] = 1; });
    var lost = exSt.rows.filter(function (r) { return !known['k' + r.code]; }).length;
    if (lost) out.warn = (out.warn ? out.warn + '\n' : '') + '設定に無い補助項目の行が ' + lost + ' 件あります（CSV に出していません）。設定のタブの「補助項目」を確かめてください。';
    return out;
  }

  /* ── 段A2（2026-11-25・凍結仕様 ROOT-v7-plus-parity.md「段A2」「反証レビュー1回」）: 記号の組（早遅）・通勤回数・社内会議を時間外に足す ──
   * 設定の鍵 symbolGroups・commuteCount・meetingOt（設定のタブの3つの欄・保存は「設定を保存する」・欄を触った時だけ送る＝ほかの設定の保存で初めの案が決まらない）。
   * 締める時に補助項目を読み直し、kintai-extras.js の buildExt で数えた値を控えの最上段（ext）に入れる（給与が手当の回数の元と時間外に使う）。
   * 勤怠の画面の時間外の数え方・CSV の今の列は変えない（月の集計の CSV の末尾に列を足すだけ）。会議の知らせ・36協定の見張りへの足し分は知らせだけ */
  var a2Touched = { g: false, c: false, m: false };
  function a2On() { return !!EX && typeof EX.buildExt === 'function' && exOn() && !!exSt; }
  /* 記号の組の1行（コードは保存した後は変えない・行は消さない＝止める） */
  function a2GroupRow(i, g, saved) {
    var n = i + 1;
    return '<tr><td><input type="text" class="k5" id="a2g-code-' + i + '" maxlength="20" value="' + esc(g ? g.code : '') + '"' + (saved ? ' readonly' : '') + ' aria-label="記号の組のコード ' + n + '" style="width:9em"></td>' +
      '<td><input type="text" class="k5" id="a2g-name-' + i + '" maxlength="20" value="' + esc(g ? g.name : '') + '" aria-label="記号の組の名前 ' + n + '" style="width:9em"></td>' +
      '<td><input type="text" class="k5" id="a2g-syms-' + i + '" maxlength="400" value="' + esc(g ? g.symbols.join('、') : '') + '" aria-label="記号の組の記号 ' + n + '" style="width:16em"></td>' +
      '<td><label><input type="checkbox" id="a2g-act-' + i + '"' + (!g || g.active ? ' checked' : '') + '> 使う</label></td></tr>';
  }
  function a2SetHtml() {
    if (!a2On()) return '';
    a2Touched = { g: false, c: false, m: false };   /* 描き直したら触っていない状態から */
    var gs = EX.groupsOf(rawCfg()), gl = gs || EX.copyJson(EX.SYMBOL_GROUPS_DEFAULT), cm = EX.commuteOf(rawCfg()), cmSaved = rawCfg().commuteCount !== undefined;
    var mo = EX.meetingOtOf(rawCfg()), moSaved = rawCfg().meetingOt !== undefined;
    var items = exItems() || EX.copyDefault(), cnt = items.filter(function (x) { return x.kind === 'count'; }), tms = items.filter(function (x) { return x.kind === 'time'; });
    var cmV = cmSaved ? cm : EX.copyJson(EX.COMMUTE_DEFAULT), moV = moSaved ? mo : EX.copyJson(EX.MEETING_OT_DEFAULT);
    var h = '<div style="grid-column:1/-1" class="no-print"><h2 style="font-size:16px;margin:14px 0 8px">記号の組（早遅など・給与の手当の回数）</h2>' +
      '<p class="help">シフトの記号の組ごとに、その記号の日に働いた日の数を締めの控えに入れます（給与の手当の「回数の元」で選べます）。同行（記号の後ろに「/同」）の日は数えません。記号は「、」か空白で区切り、時刻で書いたマス（例 12-21）も入れられます。1組20個まで・' + EX.GROUPS_MAX + '組まで。コードは保存した後は変えられません。使わなくなった組は「使う」を外して止めます。' +
      (gs ? '' : '<b>記号の組はまだ保存していません。下は初めの案です（シフトアプリの freee の書き出しで早遅手当になる記号）。案のまま使う時は下の「この案で使い始める」を、直す時は欄を直して「設定を保存する」を押します。</b>') + '</p>' +
      '<span class="tw" style="display:block"><table><thead><tr><th>コード（英数字）</th><th>名前</th><th>記号</th><th>使う</th></tr></thead><tbody id="a2g-rows">' + gl.map(function (g, i) { return a2GroupRow(i, g, !!gs); }).join('') + '</tbody></table></span>' +
      '<button type="button" class="btn sm k5" data-act="a2-add-group">行を足す</button></div>';
    h += '<div style="grid-column:1/-1" class="no-print"><h2 style="font-size:16px;margin:14px 0 8px">通勤回数（給与の手当の回数）</h2>' +
      '<p class="help">働いた日のうち、下で選んだ補助項目（回数）が入っている日を除いた日の数を、締めの控えに入れます（健診で通勤手当を出さない日など）。夜勤は入りの日の1回です。' + (cmSaved ? '' : '<b>通勤回数はまだ保存していません。下は初めの案です。</b>') + '</p>' +
      '<div class="row"><label><input type="checkbox" id="a2c-on"' + (cmV ? ' checked' : '') + '> 通勤回数を数える</label></div>' +
      '<div class="row">' + (cnt.length ? cnt.map(function (x, i) { return '<label><input type="checkbox" id="a2c-m-' + i + '" data-code="' + esc(x.code) + '"' + (cmV && cmV.minus.indexOf(x.code) >= 0 ? ' checked' : '') + '> ' + esc(EX.nameOf(x)) + ' の日を除く</label>'; }).join('') : '<span class="help">回数の補助項目がありません。</span>') + '</div></div>';
    h += '<div style="grid-column:1/-1" class="no-print"><h2 style="font-size:16px;margin:14px 0 8px">社内会議を時間外に足す（給与）</h2>' +
      '<p class="help">選んだ時間の補助項目（社内会議）の時間を、締めの控えで時間外（法定休日の日は休日労働）に足します。給与はこの足した後の時間で払い、60時間超も足した後で数え直します。打刻した会議の時間は残業として認めず、補助項目に入れます（二重に払わないため）。勤怠の画面の時間外と CSV の今の列は変えず、月の集計の CSV の末尾に「時間外（社内会議を含む）」を足します。' + (moSaved ? '' : '<b>社内会議はまだ保存していません。下は初めの案です。</b>') + '</p>' +
      '<div class="row"><label><input type="checkbox" id="a2m-on"' + (moV && moV.on ? ' checked' : '') + '> 時間外に足す</label><label>項目 <select class="k5" id="a2m-code">' +
      (tms.length ? tms.map(function (x) { return '<option value="' + esc(x.code) + '"' + (moV && moV.code === x.code ? ' selected' : '') + '>' + esc(EX.nameOf(x)) + '</option>'; }).join('') : '<option value="">（時間の補助項目がありません）</option>') + '</select></label></div>' +
      (gs && cmSaved && moSaved ? '' : '<div class="row"><button type="button" class="btn sm k5 pri" data-act="a2-adopt"' + (isAdmin() ? '' : ' disabled') + '>この案で使い始める（記号の組・通勤回数・社内会議）</button></div>') + '</div>';
    return h;
  }
  function a2AddGroup() {
    var tb = $('a2g-rows'); if (!tb) return;
    a2Touched.g = true;
    var i = 0; while ($('a2g-code-' + i)) i++;
    if (i >= EX.GROUPS_MAX) { toast('記号の組は' + EX.GROUPS_MAX + '組までです'); return; }
    tb.insertAdjacentHTML('beforeend', a2GroupRow(i, null, false));
    $('a2g-code-' + i).focus();
  }
  var A2_BAD = { code: 'コードは英数字・_・- の20字まで', name: '名前は1〜20字', symbols: '記号は1〜20個（1つ40字まで）', active: '「使う」の印が読めません', dup: 'コードがほかの行と重なっています', max: EX ? EX.GROUPS_MAX + '組まで' : '', shape: '形が違います' };
  /* 触った欄だけを { vals: { 鍵: 値 }, bad: [] } にする（触っていない欄は今の設定のまま＝送らない） */
  function readA2Set() {
    var vals = {}, bad = [], i;
    if (!EX || !$('a2g-rows')) return { vals: vals, bad: bad };
    if (a2Touched.g) {
      var raw = [], rowNo = [];
      for (i = 0; $('a2g-code-' + i); i++) {
        var ce = $('a2g-code-' + i), code = String(ce.value || '').trim(), name = String($('a2g-name-' + i).value || '').trim(), sy = String($('a2g-syms-' + i).value || '').split(/[、,，\s　]+/).filter(Boolean);
        if (!ce.readOnly && !code && !name && !sy.length) continue;   /* 足したが使わなかった空の行 */
        raw.push({ code: code, name: name, symbols: sy, active: !!$('a2g-act-' + i).checked }); rowNo.push(i + 1);
      }
      var cl = EX.cleanSymbolGroups(raw);
      cl.bad.forEach(function (b) { bad.push('記号の組 ' + (rowNo[b.row - 1] || b.row) + ' 行目（' + (A2_BAD[b.why] || '形が違います') + '）'); });
      (EX.groupsOf(rawCfg()) || []).forEach(function (x) { if (!bad.length && !cl.groups.some(function (y) { return y.code === x.code; })) bad.push('保存済みの記号の組「' + x.name + '」が見つかりません。読み直してください'); });
      vals.symbolGroups = cl.groups;
    }
    if (a2Touched.c) {
      var minus = [];
      for (i = 0; $('a2c-m-' + i); i++) if ($('a2c-m-' + i).checked) minus.push($('a2c-m-' + i).getAttribute('data-code'));
      vals.commuteCount = $('a2c-on').checked ? EX.cleanCommute({ minus: minus }) : null;
    }
    if (a2Touched.m) {
      var mc = $('a2m-code').value;
      if (!mc) { if ($('a2m-on').checked) bad.push('社内会議を時間外に足す（時間の補助項目を先に足してください）'); else vals.meetingOt = null; }
      else vals.meetingOt = { code: mc, on: !!$('a2m-on').checked };
    }
    return { vals: vals, bad: bad };
  }
  /* 会議の時間が、その日の数えなかった時間より多い日（知らせだけ・締めは止めない）。補助項目を読めていない時は空 */
  function a2OverList() { return a2On() && exReady() && month ? EX.meetingOverUncounted(month, exSt.rows, rawCfg()) : []; }
  function a2OverOn(sid, date) { return a2OverList().some(function (x) { return x.staff_id === sid && x.date === date; }); }
  function a2OverBand() {
    var ls = a2OverList();
    if (!ls.length) return '';
    return '<div class="band warn no-print" role="status">' + esc(EX.MEETING_OVER_TEXT) + '（' + ls.map(function (x) { return esc(nameOf(x.staff_id)) + ' ' + esc(md(x.date)) + '・会議 ' + esc(fm(x.meetingMin)) + '・数えなかった時間 ' + esc(fm(x.uncountedMin)); }).join('、') + '）。締めは止めません。</div>';
  }
  /* 月の集計の CSV の末尾の段A2 の列（締めた時の数字は控えの ext・今の数字は今の設定で数える）。返す: { text, warn } か null（列が無い）か false（読めていない＝書き出さない） */
  function a2Csv(src, text, from) {
    if (!EX || typeof EX.appendExtCsv !== 'function') return null;
    var snapExt = from === 'snap' && isLocked() && data.month.snapshot && EX.isExt(data.month.snapshot.ext) ? data.month.snapshot.ext : null, warn = '';
    var ext = snapExt;
    if (!ext) {
      var d0 = EX.defOf(rawCfg());
      if (!d0.groups.some(function (g) { return g.active; }) && !d0.commute && !(d0.meetingOt && d0.meetingOt.on)) return null;
      if (exOn() && !exReady()) { alert('補助項目を読み込めていないため、書き出せません（記号の組・通勤回数・社内会議の列が 0 のまま出るのを防ぐため）。上の「読み直す」を押すか、通信（Wi-Fi）がつながっているかを確かめてから、もう一度書き出してください。'); return false; }
      ext = EX.buildExt(src, exReady() ? exSt.rows : [], (data && data.schedule) || [], rawCfg());
      if (from === 'snap') warn = '締めた時の控えに記号の組・通勤回数・社内会議の数が無いため、その列は今の設定と今の記録で数えました。';
    }
    var base = {}, imp = {};
    (src.people || []).forEach(function (p) { base[p.staff.staff_id] = p.sum.legalOverMin; if (p.sum.imported) imp[p.staff.staff_id] = 1; });
    var out = EX.appendExtCsv(text, { people: EX.csvPeople(src.people), ext: ext, base: base, imported: imp, mode: src.config && src.config.csvTime });
    if (!out.cols) return null;
    return { text: out.text, warn: warn + (Object.keys(imp).length ? (warn ? '\n' : '') + 'freee の月の集計を取り込んだ職員の記号の組・通勤回数は数えていません（欄は空）。' : '') };
  }
  /* 締める時の控え: 補助項目を読み直して ext を作る（読めない時は締めない）。返す: Promise<ext> */
  var a2LockRows = [];
  function a2ExtForLock(d) {
    if (!EX || typeof EX.buildExt !== 'function') return Promise.reject(Object.assign(new Error('extras'), { kintai: 'a2_noparts' }));
    var cfg = (d && d.settings && d.settings.config) || {};
    a2LockRows = [];
    return rpc('kintai_extras_get', { p_ym: ym }).then(okOr).then(function (r) {
      a2LockRows = Array.isArray(r.rows) ? r.rows : [];
      return EX.buildExt(month, a2LockRows, d.schedule || [], cfg);
    }, function (e) {
      /* 補助項目の関数がまだ無い DB（統合 0127 の前）で、補助項目を保存していない時だけ、補助項目なしで数える（記号の組・通勤回数は数える） */
      if (noDb(e) && !Array.isArray(cfg.extraItems)) return EX.buildExt(month, [], d.schedule || [], cfg);
      throw Object.assign(new Error('extras'), { kintai: 'a2_noextras' });
    }).then(function (ext) {
      /* 反証レビュー（2026-11-25・medium）: 社内会議を時間外に足すかを保存しないまま、会議の時間の行がある月分は締めない */
      if (EX.meetingUnsaved && EX.meetingUnsaved(cfg, a2LockRows)) throw Object.assign(new Error('meetunset'), { kintai: 'a2_meetunset' });
      return ext;
    });
  }
  /* 締めの窓で、読んである補助項目から「会議の設定を保存していない」かを見る（読めていない時は締める時に読み直して止める） */
  function a2MeetUnsetNow() { return !!(EX && EX.meetingUnsaved && exReady() && EX.meetingUnsaved(rawCfg(), exSt.rows)); }

  /* 段A2（反証レビュー1回の5）: 36協定の見張りに使う、開いている月分のほかの締めていない月分の補助項目（画面の中だけ・端末に残さない）。
     月ごとに kintai_extras_get を読む（同時に読むのは3本まで）。読み終わったら36協定を出すタブを描き直す。読めない月分は { err } のまま（足さずに知らせる） */
  var a2Ex36 = {}, a2Ex36Gen = 0, a2Ex36Q = [], a2Ex36Run = 0;
  function a2Ex36Reset() { a2Ex36 = {}; a2Ex36Gen++; a2Ex36Q = []; }
  function a2Ex36Of(y) {
    if (!EX || typeof EX.meetingSplitOf !== 'function' || !exOn()) return null;
    var mo = EX.meetingOtOf(rawCfg());
    if (!mo || !mo.on) return null;
    if (!a2Ex36[y]) { a2Ex36[y] = { pending: true }; a2Ex36Q.push(y); a2Ex36Pump(); }
    return a2Ex36[y];
  }
  function a2Ex36Pump() {
    while (a2Ex36Run < 3 && a2Ex36Q.length) {
      var y = a2Ex36Q.shift(), my = a2Ex36Gen;
      a2Ex36Run++;
      rpc('kintai_extras_get', { p_ym: y }).then(okOr).then(function (r) { return { rows: Array.isArray(r.rows) ? r.rows : [] }; }, function (e) {
        if (!isNetErr(e) && !isDenied(e) && !noDb(e)) note('36協定の補助項目の読み込み', e);
        return { err: true };
      }).then(function (yy) { return function (res) {
        a2Ex36Run--;
        if (my === a2Ex36Gen) a2Ex36[yy] = res;
        a2Ex36Pump();
        if (my !== a2Ex36Gen || a2Ex36Run || a2Ex36Q.length) return;
        if (view === 'app' && !busy && !printAll && month && !dlgCtx && (tab === 'home' || tab === 'grid' || tab === 'person')) paint();
      }; }(y));
    }
  }
  function a2MissNote(yms) { return '会議の時間を足せていない月があります（' + yms.map(function (y) { return (+y.slice(5, 7)) + '月分'; }).join('・') + '・36協定の見張りだけ・読み直すと足します）'; }

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
    wipeEnroll();   /* v5 段5: 前の窓がスマホの登録なら、QR と番号を先に消す */
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
    var em = dn && dn.early_ok ? 'all' : (dn && dn.early_from ? 'from' : (dn && dn.early_ng ? 'ng' : 'none')), om = dn && dn.overtime_ok ? 'all' : (dn && dn.ot_until ? 'until' : (dn && dn.ot_ng ? 'ng' : 'none'));   /* 0120: 認めないと決めた日は ng */
    var eft = dn && dn.early_from ? hm(dn.early_from) : (firstIn ? hm(firstIn.at) : ''), out = dn && dn.ot_until ? hm(dn.ot_until) : (lastOut ? hm(lastOut.at) : '');
    b += '<fieldset' + (lk ? ' disabled' : '') + '><legend>早出・残業の承認（この日）</legend>' +
      '<div class="row" role="radiogroup" aria-label="早出"><b>早出</b><label><input type="radio" name="e-em" value="none"' + (em === 'none' ? ' checked' : '') + '> まだ決めない（予定の開始から数える・要確認に残る）</label>' +
      '<label><input type="radio" name="e-em" value="ng"' + (em === 'ng' ? ' checked' : '') + '> 認めない（予定の開始から数える・理由を残す）</label>' +
      '<label><input type="radio" name="e-em" value="all"' + (em === 'all' ? ' checked' : '') + '> 全部認める（打刻どおり）</label>' +
      '<label><input type="radio" name="e-em" value="from"' + (em === 'from' ? ' checked' : '') + '> この時刻から認める</label><input type="time" id="e-early-from" value="' + esc(eft) + '" aria-label="早出を認める時刻（' + md(earlyDate) + '）"><span class="raw">（' + md(earlyDate) + '）</span></div>' +
      '<div class="row" role="radiogroup" aria-label="残業"><b>残業</b><label><input type="radio" name="e-om" value="none"' + (om === 'none' ? ' checked' : '') + '> まだ決めない（予定の終わりまで数える・要確認に残る）</label>' +
      '<label><input type="radio" name="e-om" value="ng"' + (om === 'ng' ? ' checked' : '') + '> 認めない（予定の終わりまで数える・理由を残す）</label>' +
      '<label><input type="radio" name="e-om" value="all"' + (om === 'all' ? ' checked' : '') + '> 全部認める（打刻どおり）</label>' +
      '<label><input type="radio" name="e-om" value="until"' + (om === 'until' ? ' checked' : '') + '> この時刻まで認める</label><input type="time" id="e-ot-until" value="' + esc(out) + '" aria-label="残業を認める時刻（' + md(otDate) + '）"><span class="raw">（' + md(otDate) + '）</span></div>' +
      (dn && (dn.early_ng || dn.ot_ng) ? '<p class="help">認めなかった理由: ' + [dn.early_ng ? '早出「' + esc(dn.early_ng) + '」' : '', dn.ot_ng ? '残業「' + esc(dn.ot_ng) + '」' : ''].filter(Boolean).join('・') + '</p>' : '<p class="help">「認めない」を選んで保存すると、下の理由が認めなかった理由として残ります（CSV の日ごとの明細にも出ます）。</p>') +
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
  var DIRTY_MODES = { edit: 1, work: 1, leave: 1, link: 1, mimport: 1, clockvis: 1, madd: 1, dname: 1, rq: 1, sprv: 1, sched: 1, fixed: 1 };   /* v5 段5: 差し戻し・承認のメモ（rq）と、スマホの取り消しの理由（sprv）を足した（反証レビュー 2026-11-21） */   /* 0111 で予定の手直し・前提を足した */   /* 保存していない入力を確かめる窓（v4 で手入力・有給・結び付けを足した） */
  DIRTY_MODES.mgr = 1;
  DIRTY_MODES.rvd = 1; DIRTY_MODES.extra = 1;   /* 0120: 締めの前の要確認を決める窓 */   /* v5 1-5: 勤怠の管理者を足す・外す窓も確かめる */
  function closeDlg() { wipeEnroll(); dlgCtx = null; try { $('g-dlg').close(); } catch (_) { $('g-dlg').removeAttribute('open'); } }
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
    /* 0120: 「認めない」に替えた時だけ理由を認めない理由として送る（もう認めないの日は前の理由のまま）。ほかへ替えた時は外す */
    if (em === 'ng' && !dn.early_ng) { patch.early_ng = reason; changed = true; } else if ((em === 'none' || em === 'all') && dn.early_ng) { patch.early_ng = null; changed = true; }
    if (om === 'ng' && !dn.ot_ng) { patch.ot_ng = reason; changed = true; } else if ((om === 'none' || om === 'all') && dn.ot_ng) { patch.ot_ng = null; changed = true; }
    if (br !== (dn.break_min == null ? null : dn.break_min)) { patch.break_min = br; changed = true; }
    if (nt !== (dn.note || '')) { patch.note = nt; changed = true; }
    var mark = radioVal('e-mark') || null;
    /* 0120（反証レビュー 2026-11-21）: 早出・残業の要確認が残る日を、決めずに「確認済み」にしない（理由の無いまま締められる抜け道を閉じる） */
    if (mark === 'checked' && dn.day_mark !== 'checked') {
      var undec = [], bl0 = ((personOf(ctx.sid) || { days: [] }).days.filter(function (x) { return x.date === ctx.date; })[0] || { blocks: [] }).blocks;
      if (em === 'none' && bl0.some(function (x) { return x.flags.indexOf('early') >= 0; })) undec.push('早出');
      if (om === 'none' && bl0.some(function (x) { return x.flags.indexOf('overtime') >= 0; })) undec.push('残業');
      if (undec.length) { msg.textContent = undec.join('・') + 'が「まだ決めない」のままでは確認済みにできません。' + undec.join('・') + 'を「認める」か「認めない（理由を残す）」に決めてから保存してください。'; return; }
    }
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
  /* ── 0120: 締めの前の要確認を1件ずつ決める窓（本人指示 2026-11-21・文と位置は仮置き）──
   * 要確認の一覧（C.reviewList）の i 件目の日を開く。早出・残業は「認める（打刻どおり数える）／認めない（予定の時刻で数える・理由を残す）」を選ぶ（初めはどちらも選ばない）。
   * 早出・残業でない印（控えの打刻・予定の無い勤務・締めた後の打刻）は「認める（このまま数える＝確認済み）」を選べる。打刻の漏れ・打刻なしはここでは決めず、
   * 「打刻・欠勤を直す」で打刻を足すか欠勤にする。数える時間は変えない（認めないは今の数え方＝予定の時刻で切る）。
   * 認めない理由は日の行の early_ng・ot_ng と直しの履歴に残す（統合 0120）。決めると読み直して次の1件を開く */
  var DECIDE_REASONS = ['指示・申請が無い', '業務の必要が無い', '私用', 'その他'];   /* 早出・残業の両方に入るので、どちらにも合う言い方（反証レビュー 2026-11-21・文は仮置き） */
  var MISS = { missing_in: 1, missing_out: 1, no_punch: 1 };
  function rvKey(r) { return r.staffId + '|' + r.date; }
  function openDecide(i, list) {
    if (!month || busy) return;
    if (isLocked()) { toast('この月は締めてあるため直せません。'); return; }
    list = list || C.reviewList(month);
    if (!list.length) { toast('要確認はありません。締めに進めます'); return; }
    if (!(i >= 0 && i < list.length)) i = 0;
    var r = list[i], p = personOf(r.staffId), d = p ? p.days.filter(function (x) { return x.date === r.date; })[0] : null;
    if (!d) return;
    var dn = (data.days || []).filter(function (x) { return x.staff_id === r.staffId && x.work_date === r.date; })[0] || null;
    var rvb = d.blocks.filter(function (b) { return C.needsReview(b); });
    var withF = function (f) { return rvb.filter(function (b) { return b.flags.indexOf(f) >= 0; }); };
    var eb = withF('early'), ob = withF('overtime'), other = [];
    rvb.forEach(function (b) { b.flags.forEach(function (f) { if (C.REVIEW[f] && f !== 'early' && f !== 'overtime' && other.indexOf(f) < 0) other.push(f); }); });
    var miss = other.some(function (f) { return MISS[f]; }), canCk = other.length > 0 && !miss;
    var firstIn = function (b) { var x = b.punches.filter(function (q) { return q.kind === 'in'; }); return x.length ? x[0].at : null; };
    var lastOut = function (b) { var x = b.punches.filter(function (q) { return q.kind === 'out'; }); return x.length ? x[x.length - 1].at : null; };
    var gapTxt = function (a0, a1) { return a0 != null && a1 != null && a1 > a0 ? '（' + fm(Math.round((a1 - a0) / 60000)) + '）' : ''; };
    var b = '<p><b>要確認 ' + (i + 1) + ' ／ ' + list.length + ' 件目</b></p>' +
      '<p>' + d.blocks.map(function (x) { return schedText(x) + ' → 数えた ' + (countText(x) || '（なし）') + '・実働 ' + fm(x.workMin) + ' ' + flagTags(x.flags, x.checked); }).join('<br>') + '</p>' +
      '<p class="raw">打刻（そのまま）: ' + esc(d.blocks.map(rawPunches).filter(Boolean).join(' / ') || 'なし') + '</p>';
    if (eb.length) {
      var e0 = eb[0], ei = firstIn(e0), efx = !!(dn && dn.early_from);
      b += '<fieldset><legend>早出（始業前の打刻）</legend><p>出勤の打刻 ' + hm(ei) + '・予定の開始 ' + hm(e0.schedStart) + gapTxt(ei, e0.schedStart) + '</p>' +
        (efx ? '<p class="help">この日はほかの勤務の早出を「' + hm(dn.early_from) + ' から」と時刻を区切って認めてあります。認める時は「打刻・欠勤を直す」で直してください（ここで認めると、区切った承認が日全体に広がるため）。</p>' : '') +
        '<div class="row" role="radiogroup" aria-label="早出">' + (efx ? '' : '<label><input type="radio" name="d-em" value="ok"> 認める（打刻どおり数える）</label>') +
        '<label><input type="radio" name="d-em" value="ng"> 認めない（予定の開始から数える・理由を残す）</label></div></fieldset>';
    }
    if (ob.length) {
      var o0 = ob[ob.length - 1], oo = lastOut(o0), ofx = !!(dn && dn.ot_until);
      b += '<fieldset><legend>残業（終業後の打刻）</legend><p>退勤の打刻 ' + hm(oo) + '・予定の終わり ' + hm(o0.schedEnd) + gapTxt(o0.schedEnd, oo) + '</p>' +
        (ofx ? '<p class="help">この日はほかの勤務の残業を「' + hm(dn.ot_until) + ' まで」と時刻を区切って認めてあります。認める時は「打刻・欠勤を直す」で直してください（ここで認めると、区切った承認が日全体に広がるため）。</p>' : '') +
        '<div class="row" role="radiogroup" aria-label="残業">' + (ofx ? '' : '<label><input type="radio" name="d-om" value="ok"> 認める（打刻どおり数える）</label>') +
        '<label><input type="radio" name="d-om" value="ng"> 認めない（予定の終わりまで数える・理由を残す）</label></div></fieldset>';
    }
    if (other.length) {
      b += '<fieldset><legend>ほかの要確認</legend><p>' + flagTags(other, false) + '</p>' + (miss ?
        '<p class="help">打刻が欠けているため、ここでは決められません。「打刻・欠勤を直す」で打刻を足すか、欠勤の印を付けてください。</p>' :
        '<div class="row" role="radiogroup" aria-label="ほかの要確認"><label><input type="radio" name="d-ck" value="ok"> 認める（このまま数える・確認済みにする）</label></div>' +
        '<p class="help">数え方を変える時は「打刻・欠勤を直す」で打刻を直してください。</p>') + '</fieldset>';
    }
    var canSave = eb.length > 0 || ob.length > 0 || canCk;
    /* 理由の欄は見出しの下に1行で置く（iPhone の幅で欄が細くならないように） */
    b += '<div class="row"><label for="e-reason">理由（認めない時は必ず・200字まで）</label></div><div class="row"><input type="text" id="e-reason" maxlength="200" style="flex:1;min-width:0;width:100%" placeholder="下のボタンで選ぶか、書いてください" autocomplete="off"></div>' +
      '<div class="presets" role="group" aria-label="よく使う理由">' + DECIDE_REASONS.map(function (x) { return '<button type="button" class="btn sm" data-act="reason" data-r="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
      '<p class="help">認めないと決めた時間は数えず、理由と一緒に CSV の日ごとの明細の「数えなかった時間」「数えなかった理由」に出ます。</p><p class="help" id="e-msg" role="alert"></p>';
    dlgCtx = { mode: 'rvd', sid: r.staffId, date: r.date, bi: r.blockIndex, rvIndex: i, list: list, rev: dn ? dn.rev : 0, dn: dn, early: eb.length > 0, ot: ob.length > 0, ck: canCk };
    openDlg(nameOf(r.staffId) + ' さん　' + md(r.date) + '（' + wd(r.date) + '）の要確認を決める', b, !canSave, '決めて次へ', 'rvd-save');
    addFootBtn('打刻・欠勤を直す', 'rvd-edit');
    if (i + 1 < list.length) addFootBtn('決めずに次へ', 'rvd-skip');
    dlgCtx.init = formState();
  }
  function saveDecide(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'rvd' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), dn = ctx.dn || {};
    var em = radioVal('d-em'), om = radioVal('d-om'), ck = radioVal('d-ck');
    if (ctx.early && !em) { msg.textContent = '早出を「認める」か「認めない」かを選んでください。'; return; }
    if (ctx.ot && !om) { msg.textContent = '残業を「認める」か「認めない」かを選んでください。'; return; }
    if (ctx.ck && !ck) { msg.textContent = (ctx.early || ctx.ot ? 'ほかの要確認も' : '') + '「認める」を選ぶか、「打刻・欠勤を直す」で直してください。'; return; }
    if (!ctx.early && !ctx.ot && !ctx.ck) { msg.textContent = '「打刻・欠勤を直す」で直してください。'; return; }
    var why = ($('e-reason').value || '').trim();
    if ((em === 'ng' || om === 'ng') && !why) { msg.textContent = '認めない理由を書いてください（下のボタンで選べます）。'; $('e-reason').focus(); return; }
    var patch = {};
    /* 「全部認める」と「この時刻から／まで」と「認めない」は同じ日に並ばない（DB が断る）ので、選んだ方の外は外して送る */
    /* 認める＝その日の早出（残業）を全部認める（時刻を区切って認めてある日は窓に出さない）。認めない＝理由だけを送る
       （区切って認めた時刻は消さない＝ほかの勤務の数えを変えない。全部認めた日は早出の要確認が出ないので、ここへは来ない・反証レビュー 2026-11-21） */
    if (em === 'ok') { patch.early_ok = true; if (dn.early_ng) patch.early_ng = null; }
    else if (em === 'ng') { if (dn.early_ok) patch.early_ok = false; patch.early_ng = why; }
    if (om === 'ok') { patch.overtime_ok = true; if (dn.ot_ng) patch.ot_ng = null; }
    else if (om === 'ng') { if (dn.overtime_ok) patch.overtime_ok = false; patch.ot_ng = why; }
    if (ck === 'ok') patch.day_mark = 'checked';
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-f'));
    rpc('kintai_day_put', { p_staff_id: ctx.sid, p_date: ctx.date, p_patch: patch, p_rev: ctx.rev, p_reason: why || '締めの前の確かめで認めた' }).then(okOr).then(function () {
      busy = false; closeDlg(); sync('保存しました'); toast('決めました（' + nameOf(ctx.sid) + ' さん ' + md(ctx.date) + '）');
      editsCache = null;
      return load(false).then(function () { nextDecide(ctx); });
    })['catch'](function (e) {
      busy = false; restore(); note('要確認を決める', e);
      if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = msgOf(e); else toast('保存できませんでした: ' + msgOf(e));
    });
  }
  /* 決めた後・決めずに次へ: 前の一覧で今の1件より後にあった日のうち、まだ要確認に残る最初の日を開く（openNext と同じ選び方） */
  function nextDecide(ctx, skip) {
    if (!month || dlgCtx) return;
    var now = skip ? ctx.list : C.reviewList(month), cur = ctx.sid + '|' + ctx.date, after = ctx.list.slice(ctx.rvIndex + 1).map(rvKey), idx = -1;
    for (var i = 0; i < after.length && idx < 0; i++) if (after[i] !== cur) for (var j = 0; j < now.length; j++) if (rvKey(now[j]) === after[i]) { idx = j; break; }
    if (idx < 0) { toast(now.length ? '一覧の最後まで見ました（要確認は残り ' + now.length + ' 件・打刻の漏れは「直す」で直してください）' : '要確認はすべて決めました。「締めと出力」で締められます'); return; }
    openDecide(idx, now);
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
        '<td class="num">' + (lot ? esc(nTxt(lot.used, sid)) : '') + '</td><td class="num">' + (lot ? esc(nTxt(lot.remain, sid)) : '') + '</td><td>' + esc(st) + (!it.auto && g.note ? '<span class="raw">・' + esc(g.note) + '</span>' : '') + '</td>' +
        '<td>' + (!it.auto && !v ? '<button type="button" class="btn sm ng" data-act="lv-grant-void" data-id="' + esc(g.id) + '">取り消す</button>' : '') + '</td></tr>';
    }).join('');
    var voidU = leaveSt.manual.filter(function (u) { return u && u.staff_id === sid && u.voided_at; }).map(function (u) { return { use_date: u.use_date, days: +u.days, src: 'manual', id: u.id, note: u.note || '', voided: true, why: u.void_reason || '' }; });
    /* 時間単位の有休（v5 段4）は下の「休暇」の一覧に出す（取り消しもそこで） */
    var ul = x.uses.filter(function (u) { return u.src !== 'hourly'; }).concat(voidU).sort(function (a, b) { return a.use_date < b.use_date ? 1 : a.use_date > b.use_date ? -1 : 0; });
    var urows = ul.map(function (u) {
      var v = !!u.voided;
      return '<tr><td class="' + (v ? 'void' : '') + '">' + esc(ymdJa(u.use_date)) + (u.use_date > td ? '<span class="tag">予定</span>' : '') + '</td><td class="' + (v ? 'void' : '') + '">' + esc(dayTxt(u.days)) + '</td><td>' + (u.src === 'shift' ? 'シフトの有休' : '手で入れた' + (u.alsoShift ? '（シフトの有休もある日・こちらを数える）' : '')) + '</td>' +
        '<td>' + esc(u.note || '') + (v ? '<span class="raw">取り消し: ' + esc(u.why) + '</span>' : '') + '</td><td>' + (u.src === 'manual' && !v ? '<button type="button" class="btn sm ng" data-act="lv-use-void" data-id="' + esc(u.id) + '" data-date="' + esc(u.use_date) + '">取り消す</button>' : '') + '</td></tr>';
    }).join('');
    var ob = sm.obligation;
    dlgCtx = { mode: 'leave', sid: sid, rev: x.prof ? x.prof.rev || 0 : 0, prof: p };
    var b = '<div class="kv"><span>入職日</span><b>' + (sm.hire ? esc(ymdJa(sm.hire)) : '分かりません') + (x.m && x.m.hire_date ? '<span class="raw">（職員マスタ ' + esc(ymdJa(x.m.hire_date)) + '）</span>' : '') + '</b>' +
      '<span>残り</span><b>' + esc(dTxt(bal.remain, sid)) + (bal.soon ? '（期限の近い分 ' + esc(dTxt(bal.soon.days, sid)) + '・' + esc(ymdJa(bal.soon.expires)) + ' まで）' : '') + (bal.over ? '<span class="tag ng">付与の無い使用 ' + esc(dTxt(bal.over, sid)) + '</span>' : '') + '</b>' +
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
      '<p class="help">シフトに有休の記号が無い日の有休を入れます。勤怠の月の計算でも有休の日として数えます（シフトに有休の記号がある日に入れた時も、勤怠の計算と残りは、こちらの日数（1日・半日）で数えます）。締めた月分の日は足せません。</p>' +
      '<div class="tw"><table><thead><tr><th>日</th><th>日数</th><th>元</th><th>メモ</th><th></th></tr></thead><tbody>' + (urows || '<tr><td colspan="5" class="empty">使用はまだありません</td></tr>') + '</tbody></table></div></fieldset>' +
      absFieldset(sid, x) +
      '<fieldset><legend>設定</legend><div class="kv">' +
      '<label for="lv-p-hire">入職日の上書き</label><span><input type="date" id="lv-p-hire" value="' + esc(p.hire_date || '') + '"> 空＝職員マスタの入職日</span>' +
      '<label for="lv-p-wd">週の所定日数</label><span><input type="number" id="lv-p-wd" min="0.5" max="7" step="0.5" style="width:6em" value="' + esc(p.weekly_days != null ? String(+p.weekly_days) : '') + '"> 日（比例付与を使う人だけ）</span>' +
      '<label for="lv-p-wh">週の所定時間</label><span><input type="number" id="lv-p-wh" min="0.5" max="168" step="0.5" style="width:6em" value="' + esc(p.weekly_hours != null ? String(+p.weekly_hours) : '') + '"> 時間</span>' +
      '<label for="lv-p-open">移行日</label><span><input type="date" id="lv-p-open" value="' + esc(p.opening_date || '') + '"> この日より前の自動の付与は数えません</span>' +
      '<span>付与しない日</span><span>' + (sm.auto.length ? sm.auto.filter(function (g) { return g.status !== 'opening'; }).map(function (g) { return '<label style="display:inline-flex;gap:4px;margin-right:12px"><input type="checkbox" data-skip="' + esc(g.grant_date) + '"' + (g.status === 'skip' ? ' checked' : '') + '> ' + esc(ymdJa(g.grant_date)) + '（' + esc(String(g.days)) + ' 日）</label>'; }).join('') : '<span class="raw">自動の付与はまだありません</span>') + '<br><span class="help">出勤率が8割に届かなかった年など、付与しない付与日に印を付けます</span></span>' +
      '</div><div class="row"><button type="button" class="btn sm pri" data-act="lv-prof-save">設定を保存する</button></div></fieldset>' +
      '<div class="row"><label style="flex:1">理由（取り消す時と設定を保存する時は必ず）<input type="text" id="lv-reason" maxlength="200" style="flex:1;min-width:16em"></label></div><p class="help" id="e-msg" role="alert"></p>';
    openDlg(dispName(s) + ' さんの有給', b, true);
    absKindShow();
    dlgCtx.init = formState(); dlgCtx.initMap = dlgMap();
  }
  /* v5 段4: 有給の窓の「休暇」（時間単位の有休・特別休暇・代休・振替休日）を入れる欄と、読んだ月分の一覧（取り消しは理由が必ず）。
     種類に合わない欄は隠す（data-ak に使う種類を並べる・absKindShow）。時間単位の有休は設定で使うにした時だけ選べる */
  function absFieldset(sid, x) {
    var cfgL = lvCfg(), dh = staffDayMin(sid) / 60, lts = C.leaveTypesOf(cfgL), td = today();   /* 1日の時間は人ごと（反証レビュー） */
    var kinds = (cfgL.hourlyPaidLeave ? [['hourly_paid', '時間単位の有休']] : []).concat([['special', '特別休暇'], ['comp', '代休'], ['swap', '振替休日']]);
    var hrs = []; for (var hh = 1; hh <= dh; hh++) hrs.push('<option value="' + hh + '">' + hh + '時間</option>');
    var list = (leaveSt.absences || []).filter(function (a) { return a && a.staff_id === sid; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var rows = list.map(function (a) {
      var what = a.kind === 'hourly_paid' ? (a.minutes / 60) + '時間' : a.kind === 'special' ? '「' + ltName(a.type_code) + '」' + (a.paid ? '有給' : '無給') + '・' + (a.minutes != null ? '半日' : '1日')
        : a.kind === 'comp' ? (a.minutes != null ? '半日' : '1日') + '・休日に働いた日 ' + ymdJa(a.link_date) : '働く日 ' + ymdJa(a.link_date);
      return '<tr><td>' + esc(ymdJa(a.date)) + (a.date > td ? '<span class="tag">予定</span>' : '') + '</td><td>' + esc(ABS_JA[a.kind] || a.kind) + '</td><td>' + esc(what) + '</td><td>' + esc(a.note || '') + '</td>' +
        '<td><button type="button" class="btn sm ng" data-act="lv-abs-void" data-id="' + esc(a.id) + '" data-date="' + esc(a.date) + '" data-link="' + esc(a.link_date || '') + '">取り消す</button></td></tr>';
    }).join('');
    var yr = cfgL.hourlyPaidLeave ? L.hourlyYear(x.sm.lots, x.uses, td, dh * 60) : null;
    return '<fieldset><legend>休暇（時間単位の有休・特別休暇・代休・振替休日）</legend><div class="row">' +
      '<label>種類 <select id="lv-a-kind">' + kinds.map(function (k) { return '<option value="' + k[0] + '">' + esc(k[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>日付（休む日） <input type="date" id="lv-a-date"></label>' +
      '<label data-ak="hourly_paid">時間 <select id="lv-a-hours">' + hrs.join('') + '</select></label>' +
      '<label data-ak="special">特別休暇の種類 <select id="lv-a-type">' + lts.map(function (l) { return '<option value="' + esc(l.code) + '">' + esc(l.name) + (l.paid ? '（有給）' : '（無給）') + '</option>'; }).join('') + '</select></label>' +
      '<label data-ak="special comp">長さ <select id="lv-a-len"><option value="1">1日</option><option value="0.5">半日</option></select></label>' +
      '<label data-ak="comp">代休の元の日（休日に働いた日） <input type="date" id="lv-a-comp"></label>' +
      '<label data-ak="swap">振替で働く日 <input type="date" id="lv-a-swap"></label>' +
      '<label>メモ <input type="text" id="lv-a-note" maxlength="200"></label><button type="button" class="btn sm" data-act="lv-abs-add">休暇を入れる</button></div>' +
      '<p class="help">' + esc('休暇は来月分（' + ymdJa(absMaxDate()) + ' まで）の日付で入れられます。') + '特別休暇の種類と有給か無給かは「設定」で決めます。代休は無給で数えます。振替休日は、休む日の勤務の予定を数えず（欠勤・打刻なしにしません）、働く日が法定休日の曜日なら、休む日を法定休日として数えます。' +
      (cfgL.hourlyPaidLeave ? '夜勤の日は勤務を始めた日で入れてください。時間単位の有休は1日＝' + dh + '時間で日数に直して有給の残りから引き、1年（付与日から）に5日分（' + (dh * 5) + '時間）までです（年5日の取得義務には数えません）。' + (yr && yr.from ? '今の1年（' + ymdJa(yr.from) + '〜' + ymdJa(yr.to) + '）は ' + (yr.usedMin / 60) + '時間使っています。' : '') : '') +
      '締めた月分の日は入れられません。一覧は有給のために読んだ月分の行です。</p>' +
      '<div class="tw"><table><thead><tr><th>日</th><th>種類</th><th>中身</th><th>メモ</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">休暇はまだありません</td></tr>') + '</tbody></table></div></fieldset>';
  }
  /* 選んだ種類に合わない欄を隠す（窓を開いた時と、種類を選び直した時） */
  function absKindShow() {
    var k = $('lv-a-kind') ? $('lv-a-kind').value : '', els = document.querySelectorAll('#g-dlg-b [data-ak]');
    for (var i = 0; i < els.length; i++) els[i].hidden = String(els[i].getAttribute('data-ak')).split(' ').indexOf(k) < 0;
  }
  /* v5 C3: 窓の入力の値（id ごと・付与しない日は data-skip ごと）。保存の後の読み直しで開き直す時に、保存していない入力を戻すのに使う */
  function dlgMap() {
    var o = {}, els = document.querySelectorAll('#g-dlg-b input,#g-dlg-b select');
    for (var i = 0; i < els.length; i++) {
      var e = els[i], k = e.id || (e.hasAttribute('data-skip') ? 'skip:' + e.getAttribute('data-skip') : '');
      if (k) o[k] = e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? '1' : '0') : e.value;
    }
    return o;
  }
  function dlgPut(o) {
    for (var k in o) {
      var e = k.indexOf('skip:') === 0 ? document.querySelector('#g-dlg-b [data-skip="' + k.slice(5).replace(/[^0-9-]/g, '') + '"]') : $(k);
      if (!e || !$('g-dlg-b').contains(e)) continue;
      if (e.type === 'checkbox' || e.type === 'radio') e.checked = o[k] === '1'; else e.value = o[k];
    }
  }
  /* 保存に使った欄（戻さない）。ほかの欄で、開いた時から変えた所だけを残す */
  var LV_USED = { 'lv-use-add': /^lv-u-/, 'lv-use-void': /^lv-reason$/, 'lv-grant-add': /^(lv-g-|lv-reason$)/, 'lv-grant-void': /^lv-reason$/, 'lv-prof-save': /^(lv-p-|skip:|lv-reason$)/,
    'lv-abs-add': /^lv-a-/, 'lv-abs-void': /^lv-reason$/ };   /* v5 段4: 休暇の欄 */
  function keepOf(ctx, act) {
    var now = dlgMap(), init = ctx.initMap || {}, out = {}, used = LV_USED[act], n = 0;
    for (var k in now) if (now[k] !== init[k] && !(used && used.test(k))) { out[k] = now[k]; n++; }
    return n ? out : null;
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
    var ctx = dlgCtx, msg = $('e-msg'), reason = ($('lv-reason').value || '').trim(), call = null, at = null, at2 = null, then2 = null, isAbs = false, warnAfter = '';
    var needR = function () { if (!reason) { msg.textContent = '理由を書いてください。'; $('lv-reason').focus(); return false; } return true; };
    if (act === 'lv-use-add') {
      var ud = $('lv-u-date').value, un = +$('lv-u-days').value;
      if (!L.isDate(ud)) { msg.textContent = '使用の日付を入れてください。'; return; }
      /* 打刻（実働）がある日は確かめる（止めはしない・反証レビュー 2026-11-20） */
      /* 同じ日の時間単位の有休・有給の特別休暇と合わせて1日の時間を超える使用は止める（DB も dup で断る・反証レビュー） */
      var dmU = staffDayMin(ctx.sid);
      var hasU = (leaveSt.manual || []).some(function (u) { return u && !u.voided_at && u.staff_id === ctx.sid && u.use_date === ud; });   /* 同じ日の使用がもうある時は DB の dup の文に任せる */
      if (!hasU && paidMinOn(ctx.sid, ud, dmU) + Math.round((un === 0.5 ? 0.5 : 1) * dmU) > dmU) { msg.textContent = ABS_OVER; return; }
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
    } else if (act === 'lv-abs-add') {
      /* v5 段4: 休暇を入れる（形の確かめは DB も同じ決まりで断る） */
      var ak = $('lv-a-kind').value, ad = $('lv-a-date').value, cfgL = lvCfg(), dmin = staffDayMin(ctx.sid), dhP = dmin / 60;   /* 1日の時間は人ごと（反証レビュー） */
      var args = { p_staff_id: ctx.sid, p_date: ad, p_kind: ak, p_minutes: null, p_paid: null, p_type_code: null, p_link_date: null, p_note: ($('lv-a-note').value || '').trim() };
      if (!L.isDate(ad)) { msg.textContent = '休暇の日付（休む日）を入れてください。'; return; }
      var amax = absMaxDate();
      if (ad > amax) { msg.textContent = ABS_LATE; return; }
      if (ak === 'hourly_paid') {
        var hh = +$('lv-a-hours').value;
        if (!(hh >= 1 && hh <= dhP && Math.floor(hh) === hh)) { msg.textContent = '時間は1時間きざみで、1日の所定の時間（' + dhP + '時間）までで入れてください。'; return; }
        args.p_minutes = hh * 60; args.p_paid = true;
        /* 年の上限（5日分）は画面で確かめる（付与日は画面が数えるため・仮置き） */
        var sx = staffById(ctx.sid), lx = sx ? leaveOf(sx) : null, yr = lx ? L.hourlyYear(lx.sm.lots, lx.uses, ad, dmin) : null;
        if (yr && yr.usedMin + args.p_minutes > yr.capMin) { msg.textContent = '時間単位の有休は1年に5日分（' + (yr.capMin / 60) + '時間）までです。' + ymdJa(yr.from) + '〜' + ymdJa(yr.to) + ' はもう ' + (yr.usedMin / 60) + '時間使っています（あと ' + Math.max(0, (yr.capMin - yr.usedMin) / 60) + '時間）。'; return; }
      } else if (ak === 'special') {
        var tc = $('lv-a-type').value, tdef = C.leaveTypesOf(cfgL).filter(function (l) { return l.code === tc; })[0];
        if (!tdef) { msg.textContent = '特別休暇の種類を選んでください（種類は「設定」で足せます）。'; return; }
        args.p_type_code = tc; args.p_paid = tdef.paid;
        if ($('lv-a-len').value === '0.5') args.p_minutes = dmin / 2;
      } else if (ak === 'comp') {
        var cl = $('lv-a-comp').value;
        if (!L.isDate(cl) || cl === ad) { msg.textContent = '代休の元の日（休日に働いた日）を、休む日と別の日で入れてください。'; return; }
        args.p_link_date = cl;
        if ($('lv-a-len').value === '0.5') args.p_minutes = dmin / 2;
      } else if (ak === 'swap') {
        var sl = $('lv-a-swap').value;
        if (!L.isDate(sl) || sl === ad) { msg.textContent = '振替で働く日を、休む日と別の日で入れてください。'; return; }
        if (sl > amax) { msg.textContent = ABS_LATE; return; }
        args.p_link_date = sl;
        /* 働く日にその人の予定が無い時は注意だけを出す（止めない・予定は「予定を直す」で手で入れる＝A・仮置き） */
        /* 働く日にその人の予定が無い時は送らない（反証レビュー 2026-11-20・5・文は仮置き。前は注意だけで止めなかった） */
        if (schedOnDay(ctx.sid, sl) === false) { msg.textContent = '振替の働く日に出勤予定がありません。先に『予定を直す』で働く日の予定を入れてください。'; return; }
      } else { msg.textContent = '休暇の種類を選んでください。'; return; }
      /* 同じ日の有給の休みが1日の時間を超える足しは止める（DB も dup で断る・反証レビュー） */
      if ((ak === 'hourly_paid' || (ak === 'special' && args.p_paid)) && paidMinOn(ctx.sid, ad, dmin) + (args.p_minutes != null ? args.p_minutes : dmin) > dmin) { msg.textContent = ABS_OVER; return; }
      call = ['kintai_absence_add', args]; at = ad; at2 = args.p_link_date; isAbs = true;
    } else if (act === 'lv-abs-void') {
      if (!needR()) return;
      call = ['kintai_absence_void', { p_id: btn.getAttribute('data-id'), p_reason: reason }]; at = btn.getAttribute('data-date'); at2 = btn.getAttribute('data-link') || null; isAbs = true;
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
    ctx.keep = keepOf(ctx, act);
    busy = true; msg.textContent = '保存しています…';
    var restore = pressBusy(btn, '保存しています…', $('g-dlg-b'));
    rpc(call[0], call[1]).then(okOr).then(function () { return then2 ? rpc(then2[0], then2[1]).then(okOr) : null; }).then(function () {
      busy = false; toast('保存しました（' + nameOf(ctx.sid) + ' さんの有給）' + (warnAfter ? '。' + warnAfter : ''));
      /* v5 段4: 休暇の行は月の読み出しにだけ入るので、その日の月分を読み直してから有給を数え直す */
      var p2 = isAbs ? refreshAbsMonths([at, at2]).then(function () { return loadLeave(false); }) : loadLeave(false);
      if ((at && inPer(at)) || (at2 && inPer(at2))) p2 = p2.then(function () { return load(false); });   /* 手入力の有休・休暇はこの月分の計算にも入る（L8・v5 段4） */
      /* 開き直した窓にも注意を残す（知らせは消えるため） */
      if (warnAfter) p2 = p2.then(function () { if ($('g-dlg').open && dlgCtx && dlgCtx.mode === 'leave' && $('e-msg')) $('e-msg').textContent = warnAfter; });
      return p2;
    })['catch'](function (e) { busy = false; restore(); note('有給の保存', e); var em = isAbs ? absMsg(e) : leaveMsg(e); if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = em; else toast('保存できませんでした: ' + em); });
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
  /* v5（反証A2・C2 2026-11-20）: 勤務中・まだ出勤していない塊がある間は締めない（期間の翌朝・夜勤の途中に締めると、その勤務が0分のまま控えに入り、
     後で数え直した給与の照合と合わなくなるため・仮置き）。返す: [{ name, date, kind }] */
  function lockBlockers() {
    var out = [];
    (month ? month.people : []).forEach(function (p) {
      p.days.forEach(function (d) {
        d.blocks.forEach(function (b) {
          if (b.working) out.push({ name: dispName(p.staff), date: d.date, kind: '勤務中' });
          else if (b.flags.indexOf('not_in_yet') >= 0) out.push({ name: dispName(p.staff), date: d.date, kind: 'まだ出勤していない' });
        });
      });
    });
    return out;
  }
  function openLock(fig, changed, blockers) {
    dlgCtx = { mode: 'lock', fig: fig, ym: ym };
    var bl = blockers || [], mu = typeof a2MeetUnsetNow === 'function' && a2MeetUnsetNow();   /* 段A2: 会議の設定を保存していない（反証レビュー 2026-11-25） */
    openDlg(perLabel() + 'を締めます',
      (mu ? '<div class="band ng" role="alert">' + esc(EX.MEETING_UNSAVED_TEXT) + '（この月分に社内会議の時間が入っています）</div>' : '') +
      (bl.length ? '<div class="band ng" role="alert">勤務中か、まだ出勤していない人がいるため、締められません（' + bl.map(function (x) { return esc(x.name) + ' ' + esc(md(x.date)) + '・' + esc(x.kind); }).join('、') + '）。今締めると、その勤務が0分のまま控えに入ります。退勤の打刻が入るか予定の終わりを過ぎてから、もう一度締めてください。休んだ人は、その日を「直す」で欠勤の印を付けると締められます。</div>' : '') +
      (fig.review ? '<div class="band ng" role="alert">要確認が ' + fig.review + ' 件（' + fig.rvPeople + ' 人）残っているため、締められません。1件ずつ「認める／認めない」を決めてから締めてください（認めない時は理由を残します）。</div>' +
        '<div class="row"><button type="button" class="btn pri" data-act="rvd-start">要確認を1件目から決める</button></div>' : '') +
      (changed ? '<div class="band warn" role="alert">窓を開いた後に数字が変わったため、締めていません（' + esc(changed) + '）。新しい数字を確かめてから、もう一度「締める」を押してください。</div>' : '') +
      '<p>「締める」を押した時にもう一度読み直して数え直し、その数字を「締めた時の控え」にします。</p><div class="kv"><span>要確認の残り</span><b>' + fig.review + ' 件（' + fig.rvPeople + ' 人）</b><span>人数</span><b>' + fig.people + ' 人（働いた・有休のあった人 ' + fig.worked + ' 人）</b><span>総労働の合計</span><b>' + fm(fig.workMin) + '</b><span>欠勤の合計</span><b>' + fig.absent + ' 日</b></div>' +
      '<p class="help">締めた後は、この月の打刻の足し・取り消し・承認・休憩の直し・シフトの取り込みが止まります。解除できるのは管理者だけです。</p><p class="help" id="e-msg" role="alert"></p>', bl.length > 0 || fig.review > 0, '締める', 'lock-go');   /* 0120: 要確認が残る間は締めるボタンを出さない */
    if (mu) { var lgo = $('g-dlg-f').querySelector('[data-act="lock-go"]'); if (lgo) lgo.remove(); }   /* 段A2: 会議の設定を保存していない月分は「締める」を出さない（押した時も止める） */
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
      openLock(lockFigures(), null, lockBlockers());
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
      var now = lockFigures(), blk = lockBlockers();
      if (blk.length) { busy = false; openLock(now, null, blk); return; }   /* 窓を開いた後に勤務中・まだ出勤していない塊が出た時も締めない（A2） */
      if (now.review > 0) { busy = false; openLock(now, null, blk); return; }   /* 0120: 窓を開いた後に要確認が出た時も締めない */
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
      /* 段A2（2026-11-25）: 補助項目を読み直し、記号の組・通勤回数・会議の足し分を控えの最上段（ext）に入れる（行 rows は snapshotOf のまま）。読めない時は締めない */
      return a2ExtForLock(d).then(function (ext) {
        if (my !== gen) return;
        var snap = C.snapshotOf(month);
        snap.ext = ext;
        return rpc('kintai_month_lock', { p_ym: ym, p_snapshot: snap }).then(okOr).then(function () { busy = false; closeDlg(); toast('締めました'); return load(false); }, function (e) { fail(e, '締め'); });
      }, function (e) { if (my !== gen) return; fail(e, '締める時の補助項目の読み込み'); });
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
    /* 段A1: 末尾に補助項目の列（今の列の並びは変えない・行は足さない） */
    var exr = exCsv(kind, src, text);
    if (exr === false) return;
    if (exr) {
      text = exr.text;
      if (exr.warn0) extra.push(exr.warn0);
      if (exr.warn) extra.push(exr.warn);
      if (exr.dropped) extra.push(kind === 'sum' ? '補助項目を入れてあっても月の集計に行が無い職員（勤務・打刻の無い人・従業員コードの無い人）' + exr.dropped + ' 人の補助項目は出していません。' : '補助項目を入れてあっても日ごとの明細に行が無い日（勤務・打刻の無い日など）' + exr.dropped + ' 日分は出していません（月の集計の合計には入っています）。');
    }
    /* 段A2: 月の集計の末尾に記号の組・通勤回数・時間外（社内会議を含む）の列（補助項目の列の後ろ・今の列の並びは変えない） */
    if (kind === 'sum') {
      var a2r = a2Csv(src, text, from);
      if (a2r === false) return;
      if (a2r) { text = a2r.text; if (a2r.warn) extra.push(a2r.warn); }
    }
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
    /* v5 段3: 36協定の欄（範囲の外は保存しない） */
    var a36 = readA36();
    if (a36.bad.length) { alert('36協定の欄に範囲の外の値があります。入れ直してください: ' + a36.bad.join('、')); return; }
    /* v5 段4: 休暇と丸めの欄（欄が無い画面では今の設定のまま） */
    var lvs = typeof readLvSet === 'function' ? readLvSet() : null;
    if (lvs && lvs.bad.length) { alert('休暇と丸めの欄を入れ直してください: ' + lvs.bad.join('、')); return; }
    /* 段A1: 補助項目の欄（欄が無い画面では今の設定のまま・形の違う行があれば保存しない） */
    var exs = typeof readExSet === 'function' ? readExSet() : null;
    if (exs && exs.bad.length) { alert('補助項目の欄を入れ直してください: ' + exs.bad.join('、')); return; }
    /* 保存済みの項目の形を変える時は、ほかの月分の前の形の行が合計と CSV に数えられなくなることを確かめる（反証レビュー 2026-11-25） */
    /* 段A2: 記号の組・通勤回数・社内会議の欄（触った欄だけ送る・形の違う行があれば保存しない） */
    var a2s = typeof readA2Set === 'function' ? readA2Set() : { vals: {}, bad: [] };
    if (a2s.bad.length) { alert('記号の組・通勤回数・社内会議の欄を入れ直してください: ' + a2s.bad.join('、')); return; }
    var kc = exs ? exKindChanged(exs.items) : [];
    if (kc.length && !confirm('補助項目の形を変えます（' + kc.join('・') + '）。ほかの月分に前の形で入れた行があると、その行は合計と CSV に数えられなくなります（画面と書き出しで知らせます）。変えてよいですか？\n（安全なのは、今の項目を止めて、新しいコードで足すことです）')) return;
    /* この画面の欄が持たない今の設定の鍵（agreement36 など）は、そのまま残して送る（DB の kintai_settings_put は送った中身で丸ごと置き換えるため・v5 段3）。
       欄が持つ鍵は今までどおり欄の値だけ（空にした欄は送らず既定に戻す） */
    var outCfg = {}, cur = rawCfg(), formKeys = SET_FIELDS.map(function (f) { return f[0]; }).concat(['close_day', 'variableMonth', 'monthRound30', 'csvTime', 'legal_holiday']).concat(lvs ? LV_SET_KEYS : []).concat(exs ? ['extraItems'] : []).concat(Object.keys(a2s.vals));
    for (k in cur) if (formKeys.indexOf(k) < 0) outCfg[k] = cur[k];
    for (k in cfg) outCfg[k] = cfg[k];
    if (a36.obj) outCfg.agreement36 = a36.obj;
    if (lvs) for (k in lvs.vals) outCfg[k] = lvs.vals[k];
    if (exs) outCfg.extraItems = exs.items;
    for (k in a2s.vals) outCfg[k] = a2s.vals[k];   /* 段A2: 切った欄は null で送る（決めた上で数えない＝次に開いても初めの案に戻さない） */
    busy = true; var restore = pressBusy(btn, '保存しています…');
    rpc('kintai_settings_put', { p_config: outCfg, p_rev: (data.settings && data.settings.rev) || 0 }).then(okOr).then(function () { busy = false; sync('設定を保存しました'); toast('設定を保存しました'); return load(false); })['catch'](function (e) { busy = false; restore(); note('設定の保存', e); alert(msgOf(e)); });
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

  /* ── v5 段4: 年次有給休暇管理簿の印刷（A4 縦・職員ごと・労基則24条の7 の基準日・日数・時季）──
   * 行は kintai-ledger.js の ledgerOf（残りは有給のタブと同じ balance）。紙は「管理簿を印刷」を押した時だけ #k-ledger に組み、印刷の後に空にする。
   * 印刷は su-print.js（SUPrint）: 文字の大きさで収める（zoom・transform は使わない）・見出しに施設名と印刷日（data-su-print-head）・
   * ボタンからは施設情報を最大3秒待ち、読めなければ刷らない（facGate）。Cmd/Ctrl+P では準備しない（when）。1人の表はページで分けない（仮置き） */
  var ledgerOn = false;
  function ledgerStaff() { return staffSorted().filter(function (s) { return s.active !== false || leaveSt.profiles[s.staff_id] || leaveSt.grants.some(function (g) { return g && g.staff_id === s.staff_id && !g.voided_at; }); }); }
  function ledgerHtml() {
    var G = window.KintaiLedger, td = today();
    var takenTxt = function (u) { return ymdJa(u.date) + (u.hourly ? '（' + (u.minutes / 60) + '時間）' : u.days === 0.5 ? '（半日）' : ''); };
    var people = ledgerStaff().map(function (s) {
      var x = leaveOf(s), sm = x.sm, led = G.ledgerOf({ lots: sm.lots, uses: x.uses, asOf: td, openingDate: sm.opening });
      var rows = led.rows.map(function (r) {
        var hourTxt = r.takenHourMin ? fm(r.takenHourMin) : '';
        return '<tr><td>' + esc(ymdJa(r.base)) + (r.kind === 'opening' ? '<br>（移行の残り）' : '') + '</td><td class="num">' + esc(nTxt(r.days, s.staff_id)) + '</td><td>' + esc(ymdJa(r.base)) + '〜' + esc(ymdJa(r.until)) + '</td>' +
          '<td class="lg-dates">' + (r.taken.length ? esc(r.taken.map(takenTxt).join('、')) : '—') + (r.planned.length ? '<br>予定: ' + esc(r.planned.map(takenTxt).join('、')) : '') + '</td>' +
          '<td class="num">' + esc(nTxt(r.takenDays, s.staff_id)) + '</td><td class="num">' + esc(hourTxt) + '</td><td class="num">' + esc(nTxt(r.remain, s.staff_id)) + '</td></tr>';
      }).join('');
      return '<section class="lg-p"><h3 class="lg-n">' + esc(dispName(s)) + ' さん</h3><p class="lg-m">入職日 ' + esc(sm.hire ? ymdJa(sm.hire) : '分かりません') + (sm.opening ? '・移行日 ' + esc(ymdJa(sm.opening)) + '（この日より前の取得は記録にありません）' : '') + '・今の残り ' + esc(dTxt(sm.balance.remain, s.staff_id)) + '</p>' +
        '<table class="lg-t"><thead><tr><th>基準日</th><th class="num">付与日数</th><th>期間</th><th>取得した日（時季）</th><th class="num">取得日数</th><th class="num">時間単位</th><th class="num">残り</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="7">付与はまだありません</td></tr>') + '</tbody></table></section>';
    }).join('');
    return '<div class="lg"><div class="lg-h su-print-head-host"><span class="lg-title">年次有給休暇管理簿</span><span class="su-print-head su-print-head-abs" data-su-print-head="name date"></span></div>' +
      '<p class="lg-c">' + esc(ymdJa(td)) + ' 時点。残りは期間の終わり（今の年は今日）の時点・取得日数は1日と半日の合計（時間単位は別の列）。</p>' + (people || '<p>職員がいません。</p>') + '</div>';
  }
  function defineLedgerPrint() {
    if (!window.SUPrint || defineLedgerPrint.done) return;
    defineLedgerPrint.done = true;
    window.SUPrint.define('ledger', { label: '年次有給休暇管理簿', paper: 'A4 portrait', margin: 10, root: '#k-ledger',
      fit: { mode: 'height', cssVar: '--lg-fs', base: 11, min: 8, step: 0.25, minFallback: 'base' },
      when: function () { return ledgerOn && view === 'app'; },
      before: function () { var r = $('k-ledger'); if (r) r.innerHTML = ledgerHtml(); },
      after: function () { var r = $('k-ledger'); if (r) r.textContent = ''; ledgerOn = false; } });
  }
  function printLedger() {
    if (view !== 'app') return;
    if (!leaveSt || leaveSt.err || leaveBusy) { toast('有給の記録を読み終えてから、もう一度押してください'); return; }
    if (!window.SUPrint || !window.KintaiLedger) { toast('印刷の部品を読み込めていません。ページを読み込み直してください'); return; }
    defineLedgerPrint();
    var run0 = function () {
      if (view !== 'app' || !leaveSt || leaveSt.err) return;
      ledgerOn = true;
      try { window.SUPrint.print('ledger'); } catch (e) { note('管理簿の印刷', e); }
      /* 準備できなかった時（例外・中止）は印を残さない（後の Cmd/Ctrl+P で紙が化けないように） */
      if (!document.body.classList.contains('su-printing')) ledgerOn = false;
    };
    if (!window.SUPrint.facGate) { run0(); return; }
    window.SUPrint.facGate(run0, function (msg) { toast(msg); });
  }

  /* ── v5 段5: 職員の申請と承認・職員のスマホの登録（care-backend 統合 0114）──
   * 読むのは kintai_requests_list（申請の一覧・承認待ちの数・月の確認の数）と kintai_self_devices（スマホの一覧）。書くのは kintai_requests_decide（承認・差し戻し）・
   * kintai_self_enroll_issue（登録の番号・管理者だけ）・kintai_self_device_revoke（取り消し）。誰が何をできるかはデータベースが決める（画面は見せ方だけ）。
   * 申請の中身・理由・氏名は本人のスマホから来た値なので、画面に入れる時は全部 esc を通す。関数が無い（0114 の前）時は聞き直さず、欄に NODB_REQ を出す */
  var NODB_REQ = 'データベースの更新がまだです（職員のスマホの画面と申請の仕組みが入るまで、ここは使えません）。';
  /* 申請・スマホの断りの文（NG と意味の違う語だけ。ほかの語＝承認で中から呼ぶ打刻・日の行の断りは NG の文のまま・文は仮置き） */
  var NG_REQ = { conflict: 'この申請は、ほかの人が先に承認・差し戻ししたか、本人が取り下げたか、その日の勤怠が先に直されました。一覧を読み直してから、もう一度確かめてください。',
    notfound: '申請か職員が見つかりませんでした。一覧を読み直してください。', reason: '差し戻しの理由を書いてください。',
    badvalue: '受け付けられませんでした（メモ・理由は200字まで・認める時刻はその日の前日〜翌日の中）。', badym: '月の形が違います。読み直してください。',
    locked: 'この申請の日は締めた月分に入っているため承認できません。差し戻すか、管理者が締めを解除してから承認してください。' };
  /* 承認で lead（統合 0114 を 0117 に合わせた・締めた月分の前の7日／末日の翌日・lead_ym つき）が返った時は、NG の lead の文（f3c8869）をそのまま出す（NG_REQ に置かない） */
  var NG_SELF = { toomany: 'この人はもうスマホを2台登録しています。使わないスマホを「スマホの一覧」で取り消してから登録してください。',
    busy: '使われていない登録の番号が多すぎます（事業者で5つまで）。出した番号が使われるか、10分の期限が過ぎるのを待ってから、もう一度出してください。',
    inactive: 'この人は勤怠の名簿でお休み中（退職・休止）のため登録できません。',
    notfound: 'この人（またはこのスマホ）が見つかりませんでした。読み直してください。', reason: '取り消す理由を書いてください。' };
  var SELF_ADMIN_MSG = '職員のスマホの登録の番号を出せるのは管理者（二段階認証）だけです';
  function reqKnown(e) { return !!(e && e.kintai) || isDenied(e) || (!!e && e.code === '42501' && e.message === SELF_ADMIN_MSG); }
  function reqMsg(e) { if (e && e.kintai && NG_REQ[e.kintai]) return NG_REQ[e.kintai]; return noDb(e) ? NODB_REQ : msgOf(e); }
  function selfMsg(e) {
    if (e && e.kintai && NG_SELF[e.kintai]) return NG_SELF[e.kintai];
    if (e && e.code === '42501' && e.message === SELF_ADMIN_MSG) return '登録の番号を出せるのは、管理者（2段階認証まで済んだ人）だけです。';
    return noDb(e) ? NODB_REQ : msgOf(e);
  }
  var RQ_KIND = { punch: '打刻の直し', overtime: '残業・早出', month: '月の勤怠の確認', leave: '休暇' };
  var RQ_ST = { pending: ['承認待ち', 'rv'], approved: ['承認済み', 'ok'], rejected: ['差し戻し', 'ng'], withdrawn: ['取り下げ', ''] };
  var RQ_ST_OPT = [['pending', '承認待ち'], ['approved', '承認済み'], ['rejected', '差し戻し'], ['withdrawn', '取り下げ'], ['', 'すべての状態']];
  function dtTxt(v) { var t = ms(v); return t == null ? '' : new Date(t).toLocaleString('ja-JP'); }
  function ymJa(y) { return C.isYm(y) ? (+y.slice(0, 4)) + '年' + (+y.slice(5, 7)) + '月分' : ''; }
  /* 申請の日（打刻の直し・残業と早出＝その日・月の確認＝月分）。esc の前の素の文 */
  function rqDate(r) { return r.kind === 'month' ? ymJa(r.ym) : C.isDate(r.work_date) ? md(r.work_date) + '（' + wd(r.work_date) + '）' : ''; }
  /* その日と違う日付の時刻（夜勤の翌日の退勤など）は日付を添える */
  function rqAt(v, date) { var t = ms(v); if (t == null) return ''; var d = C.jstDate(t); return (C.isDate(date) && d !== date ? md(d) + ' ' : '') + hm(t); }
  /* 申請の中身（打刻の直し＝出勤か退勤と時刻・残業と早出＝何時から／何時まで・月の確認）。esc の前の素の文 */
  function rqBody(r) {
    var b = r && r.body && typeof r.body === 'object' ? r.body : {};
    if (r.kind === 'punch') { var at = rqAt(b.at, r.work_date); return (b.kind === 'in' ? '出勤' : b.kind === 'out' ? '退勤' : '打刻') + (at ? ' ' + at : ''); }
    if (r.kind === 'overtime') {
      var p = [], ef = rqAt(b.early_from, r.work_date), ou = rqAt(b.ot_until, r.work_date);
      if (ef) p.push('早出 ' + ef + ' から');
      if (ou) p.push('残業 ' + ou + ' まで');
      return p.join('・') || '残業・早出';
    }
    if (r.kind === 'month') return (ymJa(r.ym) || 'その月分') + 'の勤怠を確かめました';
    if (r.kind === 'leave') return '休暇: ' + rqLeave(b);
    return '';
  }
  /* v6（統合 0125）: 休暇の申請の中身。言い方は本人の画面（kintai-self-calc.js の leaveText）と同じ（check/unit/kintai_requests_test.js が見比べる）。
     特別休暇の名前は今の設定の種類（C.leaveTypesOf）で引き、無い時は印のまま */
  function rqLeave(b) {
    b = b && typeof b === 'object' ? b : {};
    var half = b.half === true ? '・半日' : '', mdn = function (d) { return C.isDate(d) ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; };
    if (b.type === 'paid_day') return '有休（1日）';
    if (b.type === 'paid_half') return '有休（半日）';
    if (b.type === 'hourly') return '有休（時間 ' + ((+b.minutes || 0) / 60) + ' 時間）';
    if (b.type === 'special') {
      var nm = String(b.type_code || '');
      try { C.leaveTypesOf(rawCfg()).forEach(function (x) { if (x && x.code === b.type_code && x.name) nm = x.name; }); } catch (e) { /* 印のまま */ }
      return '特別休暇（' + nm + half + '）';
    }
    if (b.type === 'comp') return '代休（休日に働いた日 ' + mdn(b.link_date) + half + '）';
    if (b.type === 'swap') return '振替（働く日 ' + mdn(b.link_date) + '）';
    return '休暇';
  }
  /* v6: 休暇の申請を承認した時の断り。中から呼ぶ kintai_leave_use_add（有休の1日・半日）・kintai_absence_add（ほか）の語は、有給の窓と同じ文にする（申請の語 conflict 等は申請の文） */
  function rqLeaveMsg(e, body) {
    var k = e && e.kintai;
    /* 申請そのものの断り（先に決められた・無い・理由）だけ申請の文。badvalue・locked などは休暇の文（反証 2026-11-24 の 2: 時刻の文が出ていた） */
    if (k && (k === 'conflict' || k === 'notfound' || k === 'reason') && NG_REQ[k]) return NG_REQ[k];
    if (k === 'badvalue' && body && body.type === 'special') return '特別休暇の種類が設定から無くなったか、中身が合いません。設定の特別休暇の種類を確かめるか、理由を書いて差し戻してください。';
    var paid = body && (body.type === 'paid_day' || body.type === 'paid_half');
    if (k && paid && NG_LEAVE[k]) return NG_LEAVE[k];
    if (k && !paid && NG_ABS[k]) return NG_ABS[k];
    return reqMsg(e);
  }
  function rqWho(r) { return String((r && (r.name || r.staff_id)) || ''); }
  function rqRow(id) { return (reqSt && Array.isArray(reqSt.rows) ? reqSt.rows : []).filter(function (r) { return r && String(r.id) === String(id); })[0] || null; }
  function reqKey() { return (reqF.status || 'all') + '|' + (reqF.ym ? ym : 'all'); }
  function reqSumFresh() { return !!reqSum && reqSum.ym === ym && (reqNoDb || Date.now() - reqSum.at < 60000); }
  /* 承認待ちの数（事業者の全部の月分）・この月分の承認待ち・月の確認を出した在籍の人の数と在籍の人の数（ホームの箱・タブの札・締めの画面） */
  /* 申請の一覧・数を捨てて読み直す印。世代を進めて、読み込み中の古い答えで上書きしない（反証レビュー 2026-11-21） */
  function reqReset() { reqSt = null; reqBusy = false; reqGen++; }
  function reqSumReset() { reqSum = null; reqSumBusy = false; reqSumGen++; }
  /* v6: 休暇の申請は来月分の日付が多い。ホームの承認待ちの数（pending）は統合 0114 の kintai_requests_list が月を問わず数える（p_ym は rows と月の確認の数だけを絞る）ので、
     来月分の休暇の申請も数に入る。申請のタブの承認待ちの一覧は既定で「すべての月分」（p_ym: null）。月の確認の数（month_confirmed）に p_ym が要るので、ここは月つきのまま */
  function loadReqSum(force) {
    if (reqSumBusy || view !== 'app' || !ym) return;
    if (!force && reqSumFresh()) return;
    var atYm = ym;
    if (reqNoDb) { reqSum = { ym: atYm, at: Date.now(), err: NODB_REQ }; return; }
    var my = ++reqSumGen; reqSumBusy = true;
    rpc('kintai_requests_list', { p_ym: atYm, p_status: 'pending' }).then(okOr).then(function (r) {
      if (my !== reqSumGen) return;
      var num = function (v) { var n = +v; return isFinite(n) && n >= 0 ? Math.floor(n) : null; };
      reqSum = { ym: atYm, at: Date.now(), pending: num(r.pending) || 0, monthPending: Array.isArray(r.rows) ? r.rows.length : 0, confirmed: num(r.month_confirmed), active: num(r.active_staff) };
    })['catch'](function (e) {
      if (my !== reqSumGen) return;
      if (noDb(e)) reqNoDb = true;
      else if (!isNetErr(e) && !reqKnown(e)) note('申請の数の読み込み', e);
      reqSum = { ym: atYm, at: Date.now(), err: noDb(e) ? NODB_REQ : '申請を読めませんでした: ' + reqMsg(e) };
    }).then(function () {
      if (my !== reqSumGen) return;
      reqSumBusy = false;
      if (atYm !== ym) { loadReqSum(false); return; }   /* 待つ間に月を替えた時は、今の月分を読み直す（前の月分の数では描かない） */
      paintTabs();
      if (view === 'app' && !busy && !printAll && (tab === 'home' || tab === 'close')) paint();
    });
  }
  function loadReqs() {
    var key = reqKey(), my = ++reqGen;
    if (reqNoDb) { reqSt = { key: key, rows: [], err: NODB_REQ }; return; }
    reqBusy = true;
    rpc('kintai_requests_list', { p_ym: reqF.ym ? ym : null, p_status: reqF.status || null }).then(okOr).then(function (r) {
      if (my !== reqGen) return;
      reqSt = { key: key, rows: Array.isArray(r.rows) ? r.rows.filter(function (x) { return x && typeof x === 'object'; }) : [] };
      var n = +r.pending;
      if (reqSum && !reqSum.err && isFinite(n) && n >= 0) { reqSum.pending = Math.floor(n); paintTabs(); }
    })['catch'](function (e) {
      if (my !== reqGen) return;
      if (noDb(e)) reqNoDb = true;
      else if (!isNetErr(e) && !reqKnown(e)) note('申請の読み込み', e);
      reqSt = { key: key, rows: [], err: noDb(e) ? NODB_REQ : '申請を読めませんでした: ' + reqMsg(e) };
    }).then(function () {
      if (my !== reqGen) return;
      reqBusy = false;
      if (view === 'app' && !busy && !printAll && tab === 'requests') paint();
    });
  }
  function paintRequests() {
    if ((!reqSt || reqSt.key !== reqKey()) && !reqBusy) loadReqs();
    var opt = function (list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
    var h = '<div class="cd rq no-print"><div class="row"><label>状態 <select id="g-rq-st" class="k5">' + opt(RQ_ST_OPT, reqF.status) + '</select></label>' +
      '<label>月分 <select id="g-rq-ym" class="k5">' + opt([['', 'すべての月分'], ['cur', '表示中の月分（' + perLabel() + '）']], reqF.ym) + '</select></label>' +
      '<button type="button" class="btn sm k5" data-act="rq-reload">読み直す</button></div>' +
      '<p class="help">職員が自分のスマホの「自分の勤怠」の画面から出した申請です。勤怠の管理者ならだれでも承認・差し戻しできます（差し戻しは理由が必ず）。承認すると、打刻の直しは事務所の打刻として足し、残業・早出は認める時刻を入れ、休暇は有給の画面で入れた時と同じ形（有休の使用・休暇の行）で入れます（直しの履歴に「申請から: 」と本人の理由が残ります）。締めた月分の日の申請は承認できません。月の勤怠の確認は承認が要りません（「締めと出力」に確かめた人の数が出ます）。</p>';
    var st = reqSt && reqSt.key === reqKey() ? reqSt : null;
    if (!st) return h + '<p class="empty">読み込んでいます…</p></div>';
    if (st.err) return h + '<div class="band warn" role="status">' + esc(st.err) + '</div></div>';
    var rows = st.rows.map(function (r) {
      var s0 = RQ_ST[r.status] || [String(r.status || ''), ''];
      var dec = r.status === 'approved' || r.status === 'rejected' ? '<br><span class="raw">' + esc(dtTxt(r.decided_at)) + (r.decided_by ? '（' + esc(r.decided_by) + '）' : '') + '</span>' +
        (r.decide_note ? '<br><span class="raw">' + (r.status === 'rejected' ? '差し戻しの理由: ' : 'メモ: ') + esc(r.decide_note) + '</span>' : '') +
        (r.applied && r.applied.noop ? '<br><span class="raw">もう認めてあったため、勤怠は変えていません</span>' : '') : '';
      var act = r.status === 'pending' && r.kind !== 'month' ? '<button type="button" class="btn sm pri k5" data-act="rq-ok" data-id="' + esc(r.id) + '">承認</button> <button type="button" class="btn sm ng k5" data-act="rq-ng" data-id="' + esc(r.id) + '">差し戻し</button>' : '';
      /* 見出しの名前（data-l）は iPhone の幅で行を縦に積む時だけ出す（PC は今の表のまま・反証レビュー 2026-11-21） */
      return '<tr><td class="rq-nm">' + esc(rqWho(r)) + (r.staff_active === false ? ' <span class="tag">休止中</span>' : '') + '</td><td data-l="種類">' + esc(RQ_KIND[r.kind] || r.kind || '') + '</td><td data-l="日付">' + esc(rqDate(r)) + '</td><td data-l="中身">' + esc(rqBody(r)) + '</td>' +
        '<td data-l="本人の理由">' + esc(r.reason || '') + '</td><td data-l="出した時刻">' + esc(dtTxt(r.created_at)) + '</td><td data-l="状態"><span class="tag ' + esc(s0[1]) + '">' + esc(s0[0]) + '</span>' + dec + '</td><td class="rq-btns">' + act + '</td></tr>';
    }).join('');
    return h + '<div class="tw"><table class="rq-t"><thead><tr><th>職員</th><th>種類</th><th>日付</th><th>中身</th><th>本人の理由</th><th>出した時刻</th><th>状態</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="empty">この条件の申請はありません</td></tr>') + '</tbody></table></div>' +
      (st.rows.length >= 500 ? '<p class="help">新しい順に500件までを出しています。月分で絞ってください。</p>' : '') + '</div>';
  }
  function openReqDecide(id, approve) {
    var r = rqRow(id);
    if (!r || r.status !== 'pending' || busy) return;
    dlgCtx = { mode: 'rq', id: String(r.id), rev: +r.rev, approve: !!approve, ym: r.ym, kind: r.kind, body: r.body && typeof r.body === 'object' ? r.body : {} };
    var b = '<div class="kv"><span>職員</span><span>' + esc(rqWho(r)) + '</span><span>種類</span><span>' + esc(RQ_KIND[r.kind] || r.kind || '') + '</span><span>日付</span><span>' + esc(rqDate(r)) + '</span>' +
      '<span>中身</span><span>' + esc(rqBody(r)) + '</span><span>本人の理由</span><span>' + esc(r.reason || '') + '</span></div>' +
      (approve ? '<p>' + (r.kind === 'leave' ? '承認すると、この休暇を有給の画面で入れた時と同じ形で入れます' : '承認すると、この中身で勤怠を直します') + '（直しの履歴に「申請から: 」と本人の理由が残ります）。承認した後は月を読み直します。</p>' : '<p>差し戻すと、本人のスマホの申請の一覧に「差し戻し」と理由が出ます。勤怠は変えません。</p>') +
      '<div class="row"><label style="flex:1">' + (approve ? 'メモ（任意・200字まで）' : '差し戻しの理由（必ず・200字まで）') + '<input type="text" id="e-rq-note" class="k5" maxlength="200" style="flex:1;min-width:14em" autocomplete="off"></label></div><p class="help" id="e-msg" role="alert"></p>';
    openDlg(approve ? '申請を承認する' : '申請を差し戻す', b, false, approve ? '承認する' : '差し戻す', 'rq-go');
    dlgCtx.init = formState();
  }
  function saveReqDecide(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'rq' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), inp = $('e-rq-note'), nt = String((inp && inp.value) || '').trim();
    if (!ctx.approve && !nt) { msg.textContent = NG_REQ.reason; if (inp) inp.focus(); return; }
    busy = true; var restore = pressBusy(btn, ctx.approve ? '承認しています…' : '差し戻しています…', $('g-dlg-f'));
    rpc('kintai_requests_decide', { p_id: ctx.id, p_rev: ctx.rev, p_approve: ctx.approve, p_note: nt || null }).then(okOr).then(function (r) {
      busy = false; closeDlg();
      toast(ctx.approve ? '承認しました' + (r.applied && r.applied.noop ? '（もう認めてあったため、勤怠は変えていません）' : '') : '差し戻しました');
      reqReset(); reqSumReset(); editsCache = null;   /* 決める前に出した読み込みの答えは捨てる */
      if (ctx.approve) { dropMonthCaches(); return load(false); }   /* 承認は打刻・日の行を直したので月を読み直す（描き直しで申請の一覧も読み直す） */
      paint();
    })['catch'](function (e) {
      busy = false; restore();
      if (!isNetErr(e) && !reqKnown(e)) note(ctx.approve ? '申請の承認' : '申請の差し戻し', e);
      if (e && (e.kintai === 'conflict' || e.kintai === 'notfound')) { reqReset(); reqSumReset(); if (tab === 'requests') paint(); }   /* 一覧を裏で読み直す */
      var em = ctx.kind === 'leave' ? rqLeaveMsg(e, ctx.body) : reqMsg(e);   /* v6: 休暇は有給の窓と同じ断りの文 */
      if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = em; else toast(em);
    });
  }
  /* 締めの画面: 承認待ちの申請と、月の勤怠を確かめた人の数（締めは止めない・仮置き）。印刷には出さない */
  function reqCloseHtml() {
    var h = '<div class="cd no-print"><h2 style="font-size:16px;margin:0 0 8px">職員の申請と月の確認</h2>';
    if (!reqSum || reqSum.ym !== ym) return h + '<p class="empty">読み込んでいます…</p></div>';
    if (reqSum.err) return h + '<div class="band warn" role="status">' + esc(reqSum.err) + '</div></div>';
    var cf = reqSum.confirmed == null ? '—' : String(reqSum.confirmed), ac = reqSum.active == null ? '—' : String(reqSum.active);
    return h + '<p>この月分の承認待ちの申請: <b>' + esc(String(reqSum.monthPending)) + ' 件</b>（すべての月分で ' + esc(String(reqSum.pending)) + ' 件）</p>' +
      '<p>月の勤怠を確かめた人: <b>確かめた人 ' + esc(cf) + '／' + esc(ac) + '</b>（職員が自分のスマホで「確かめました」を出した人の数。右は勤怠の名簿で在籍の人の数）</p>' +
      '<div class="row"><button type="button" class="btn sm k5" data-tab="requests" data-rq="pending">承認待ちの申請を見る</button></div>' +
      '<p class="help">承認待ちの申請や、確かめていない人がいても締められます。締めた月分の日の申請は承認できなくなるので、締める前に確かめてください。</p></div>';
  }
  /* 「職員と番号」の行のボタン。登録の番号を出すのは管理者（二段階）だけ・お休み中の人には出さない（仮置き）。一覧と取り消しは勤怠の管理者ならだれでも */
  function selfBtns(s) {
    return (isAdmin() && s.active !== false ? '<button type="button" class="btn sm k5" data-act="sp-enroll" data-sid="' + esc(s.staff_id) + '">スマホを登録</button>' : '') +
      '<button type="button" class="btn sm k5" data-act="sp-list" data-sid="' + esc(s.staff_id) + '">スマホの一覧</button>';
  }
  var SHORT_RE = /^[2-9A-HJKMNP-Z]{8}$/;   /* 登録の番号（0095 と同じ31字の8字） */
  var ENROLL_BODY = '<div class="kq no-print"><p>本人のスマホのカメラでこの QR を読むと「自分の勤怠」の画面が開き、登録が始まります。本人はそこで4桁の暗証番号を決めます（打刻の番号とは別の番号）。</p>' +
    '<div class="kq-img" id="e-sp-qr"></div>' +
    '<div id="e-sp-sbox" hidden><p>QR を読めない時は、本人のスマホで「自分の勤怠」の画面（<span class="kq-url" id="e-sp-url"></span>）を開き、この登録の番号を入れます。</p><p class="kq-short" id="e-sp-short"></p></div>' +
    '<p class="help" id="e-sp-snone" hidden>今は8文字の登録の番号を出せません（合わない番号が続いたため）。QR を使ってください。</p>' +
    '<p class="kq-exp" id="e-sp-exp" role="status"></p>' +
    '<p class="help">QR と番号は1回だけ・10分だけ使えます。口で伝えるか画面を見せて伝え、チャット・メールでは送らないでください。この窓を閉じると QR と番号は消えます（必要ならもう一度出します）。1人に登録できるスマホは2台までです。</p></div>';
  /* QR の絵と8文字の番号を消す（窓を閉じた・Esc・別の窓・期限・使われた時）。msg があれば窓に残して知らせる */
  function wipeEnroll(msg, kind) {
    var had = !!enrollSt;
    if (enrollSt && enrollSt.timer) clearInterval(enrollSt.timer);
    enrollSt = null;
    var q = $('e-sp-qr'); if (q) q.replaceChildren();
    var sh = $('e-sp-short'); if (sh) sh.textContent = '';
    if (had && msg) { var box = document.querySelector('#g-dlg-b .kq'); if (box) box.replaceChildren(mk('div', 'band ' + (kind || 'warn'), msg)); }
  }
  function openEnroll(sid, btn) {
    var s = staffById(sid);
    if (!s || busy || !isAdmin()) return;
    if (!window.SUQr || !window.SUQr.svg) { toast('QR の部品を読み込めていません。ページを読み込み直してください'); return; }
    busy = true; var restore = pressBusy(btn, '番号を出しています…');
    rpc('kintai_self_enroll_issue', { p_staff_id: sid }).then(okOr).then(function (r) {
      busy = false; restore();
      if (typeof r.code !== 'string' || !/^[0-9a-f]{40}$/.test(r.code)) { toast('登録の番号を出せませんでした。もう一度押してください'); return; }
      var url = new URL('kintai-self.html', location.href); url.search = ''; url.hash = 'c=' + r.code;
      var pg = new URL('kintai-self.html', location.href); pg.search = ''; pg.hash = '';
      var svg = null;
      try { svg = window.SUQr.svg(url.href, { px: 240, label: 'スマホの登録の QR（本人のスマホのカメラで読んでください）' }); } catch (e) { svg = null; note('スマホの登録の QR', e); }
      r.code = ''; url = null;   /* 番号は絵にしたら手放す */
      var sc = typeof r.short === 'string' && SHORT_RE.test(r.short) ? r.short.slice(0, 4) + '-' + r.short.slice(4) : '';
      var hasShort = Object.prototype.hasOwnProperty.call(r, 'short');
      r.short = '';
      if (!svg) { toast('QR を描けませんでした。ページを読み込み直してください'); return; }
      openDlg('スマホを登録（' + dispName(s) + ' さん）', ENROLL_BODY, true);
      dlgCtx = { mode: 'enroll', sid: sid };
      $('e-sp-qr').appendChild(svg);
      $('e-sp-short').textContent = sc;
      $('e-sp-url').textContent = pg.href;
      $('e-sp-sbox').hidden = !sc;
      $('e-sp-snone').hidden = !!sc || !hasShort;
      sc = '';
      var exp = ms(r.expiresAt);
      enrollSt = { id: r.id, sid: sid, exp: exp != null ? exp : Date.now() + 600000, last: Date.now(), timer: null };
      enrollSt.timer = setInterval(enrollTick, 1000);
      enrollTick();
    })['catch'](function (e) {
      busy = false; restore();
      if (!isNetErr(e) && !reqKnown(e) && !noDb(e)) note('スマホの登録の番号', e);
      toast(selfMsg(e));
    });
  }
  /* 1秒ごとに残りの時間を出し、5秒ごとに出した番号が使われたかを確かめる（使われた・期限が来たら QR と番号を消す） */
  function enrollTick() {
    var st = enrollSt;
    if (!st) return;
    var left = Math.max(0, Math.round((st.exp - Date.now()) / 1000));
    if (left <= 0) { wipeEnroll('QR と番号の期限（10分）が過ぎたので消しました。必要ならもう一度「スマホを登録」を押してください。', 'warn'); return; }
    var ex = $('e-sp-exp'); if (ex) ex.textContent = 'あと ' + Math.floor(left / 60) + '分' + (left % 60 < 10 ? '0' : '') + (left % 60) + '秒 使えます（1回だけ）';
    if (Date.now() - st.last < 5000 || document.visibilityState === 'hidden' || st.polling) return;
    st.last = Date.now(); st.polling = true;
    rpc('kintai_self_devices', { p_staff_id: st.sid }).then(okOr).then(function (r) {
      st.polling = false;
      if (enrollSt !== st) return;
      var c = (Array.isArray(r.codes) ? r.codes : []).filter(function (x) { return x && String(x.id) === String(st.id); })[0];
      if (!c || c.state === 'open') return;
      if (c.state === 'used') wipeEnroll('スマホの登録ができました。本人のスマホに「自分の勤怠」が出ます（開くたびに本人が決めた暗証番号を入れます）。', 'ok');
      else wipeEnroll('この QR と番号は使えなくなりました。必要ならもう一度「スマホを登録」を押してください。', 'warn');
    }, function () { st.polling = false; /* 読めない時は次の回にもう一度 */ });
  }
  var DEV_ST = { active: '使えます', retired: '使えません（勤怠の名簿でお休み中）', lapsed: '180日使っていないため切れました', revoked: '取り消しました' };
  function openDevices(sid) {
    var s = staffById(sid);
    if (!s || busy) return;
    var title = 'スマホの一覧（' + dispName(s) + ' さん）', ctx = { mode: 'sp', sid: sid };
    openDlg(title, '<p class="empty">読み込んでいます…</p>', true);
    dlgCtx = ctx;
    if (reqNoDb) { openDlg(title, '<div class="band warn" role="status">' + esc(NODB_REQ) + '</div>', true); dlgCtx = ctx; return; }
    rpc('kintai_self_devices', { p_staff_id: sid }).then(okOr).then(function (r) {
      if (dlgCtx !== ctx) return;
      var devs = (Array.isArray(r.devices) ? r.devices : []).filter(function (d) { return d && d.staff_id === sid; });
      var open = (Array.isArray(r.codes) ? r.codes : []).filter(function (c) { return c && c.staff_id === sid && c.state === 'open'; }).length;
      var rows = devs.map(function (d) {
        var stt = DEV_ST[d.state] || String(d.state || '');
        return '<tr><td>' + esc(dtTxt(d.created_at)) + '</td><td>' + esc(dtTxt(d.last_used_at)) + '</td><td>' + esc(stt) + (d.state === 'revoked' && d.revoked_at ? '（' + esc(dtTxt(d.revoked_at)) + '）' : '') + '</td>' +
          '<td>' + (d.revoked_at ? '' : '<button type="button" class="btn sm ng k5" data-act="sp-revoke" data-id="' + esc(d.id) + '">取り消す</button>') + '</td></tr>';
      }).join('');
      openDlg(title, '<p class="help">この人が「自分の勤怠」を登録したスマホです（取り消してから90日を過ぎた行は出しません）。暗証番号を忘れた時・スマホを替えた時は、取り消してから管理者が「スマホを登録」で登録し直します。</p>' +
        '<div class="tw"><table><thead><tr><th>登録した日時</th><th>最後に使った日</th><th>状態</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="empty">まだスマホを登録していません</td></tr>') + '</tbody></table></div>' +
        (open ? '<p class="help">使われていない登録の番号が ' + esc(String(open)) + ' つあります（出してから10分で使えなくなります）。</p>' : ''), true);
      dlgCtx = ctx;
    })['catch'](function (e) {
      if (noDb(e)) reqNoDb = true;
      else if (!isNetErr(e) && !reqKnown(e)) note('スマホの一覧', e);
      if (dlgCtx !== ctx) return;
      openDlg(title, '<div class="band warn" role="status">' + esc(noDb(e) ? NODB_REQ : selfMsg(e)) + '</div>', true);
      dlgCtx = ctx;
    });
  }
  function openRevoke(id) {
    var sid = dlgCtx && dlgCtx.mode === 'sp' ? dlgCtx.sid : null;
    if (!sid || !/^[0-9]{1,18}$/.test(String(id || '')) || busy) return;
    var s = staffById(sid);
    openDlg('スマホの登録を取り消す', '<p>' + esc(s ? dispName(s) : '') + ' さんのスマホの登録を1台取り消します。取り消すと、そのスマホでは「自分の勤怠」を開けなくなります（もう一度使う時は登録し直します）。</p>' + reasonRow('例: スマホを替えたため・暗証番号を忘れたため'), false, '取り消す', 'sp-revoke-go');
    dlgCtx = { mode: 'sprv', id: String(id), sid: sid };
    dlgCtx.init = formState();
  }
  function saveRevoke(btn) {
    if (!dlgCtx || dlgCtx.mode !== 'sprv' || busy) return;
    var ctx = dlgCtx, msg = $('e-msg'), reason = needReason(msg);
    if (!reason) return;
    busy = true; var restore = pressBusy(btn, '取り消しています…', $('g-dlg-f'));
    rpc('kintai_self_device_revoke', { p_id: Number(ctx.id), p_reason: reason }).then(okOr).then(function () {
      busy = false; toast('スマホの登録を取り消しました');
      openDevices(ctx.sid);
    })['catch'](function (e) {
      busy = false; restore();
      if (!isNetErr(e) && !reqKnown(e) && !noDb(e)) note('スマホの登録の取り消し', e);
      if ($('g-dlg').open && $('e-msg') === msg) msg.textContent = selfMsg(e); else toast(selfMsg(e));
    });
  }

  /* ── v6: 打刻漏れの督促（契約 ROOT-v6「2」・care-backend 統合 0125）──
   * ホームの「今日」の箱の「まだ出勤していない」人（not_in）と、「打刻漏れ・要確認」のうち出勤か退勤の打刻が無い塊（missing_in・missing_out だけ・ほかの要確認には付けない）に、
   * 箱の下の並び（画面だけ・印刷しない）で「知らせる」を出す。押すと確かめの窓（SUDialog）→ kintai_notice_add。本人が「自分の勤怠」を開いた時に決まった文が出る（メール・通知は送らない）。
   * 送った後は「知らせ済み 時刻」「見た 時刻」（kintai_notices_list）・取り消し（kintai_notice_void・理由つき）。スマホを登録していない人（kintai_self_devices の使える状態の
   * スマホが0台）にはボタンを出さず「スマホ未登録」。スマホの一覧を読めない時は押せる形のまま（仮置き）。本人が見られるのは14日以内の知らせなので、打刻漏れは14日以内の日だけ */
  var NODB_NT = 'データベースの更新がまだです（打刻漏れの知らせの仕組みが入るまで、知らせは送れません）。';
  var NG_NT = { locked: 'この日は締めた月分に入っているため、知らせられません。',
    notfound: 'この人は勤怠の名簿にいないか、お休み中（退職・休止）のため知らせられません。読み直してください。',
    toomany: 'この人のこの日の知らせは、もう2件出しています（1人1日2件まで）。', reason: '取り消す理由を書いてください。',
    already: 'この知らせはもう取り消してあります。読み直してください。', badkind: '知らせの種類が違います。ページを読み込み直してください。',
    badvalue: '知らせの形が違います。ページを読み込み直してください。', baddate: '日付が正しくありません。読み直してください。' };
  function ntMsg(e) { if (e && e.kintai && NG_NT[e.kintai]) return NG_NT[e.kintai]; return noDb(e) ? NODB_NT : msgOf(e); }
  /* 本人の画面に出る文（決まった文・本人の画面 kintai-self-calc.js の noticeText と同じ頭の文・仮置き） */
  var NT_TEXT = { missing: 'の打刻が抜けています', not_in: 'の出勤の打刻がまだありません' };
  var NT_DAYS = 14, NT_MAX = 10;
  function ntSentence(kind, date) { return (+date.slice(5, 7)) + '月' + (+date.slice(8, 10)) + '日' + NT_TEXT[kind]; }
  function ntBack(d, n) { var x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - n * 86400000); return x.getUTCFullYear() + '-' + (x.getUTCMonth() < 9 ? '0' : '') + (x.getUTCMonth() + 1) + '-' + (x.getUTCDate() < 10 ? '0' : '') + x.getUTCDate(); }
  var ntSt = null, ntBusy = false, ntGen = 0, ntNoDb = false;   /* 知らせの一覧 { ym, at, rows, err }（表示中の月分・30秒で古い） */
  var devSt = null, devBusy = false, devGen = 0;                /* スマホを登録している人 { at, has:{staff_id:true}|null }（5分で古い） */
  function ntReset() { ntSt = null; ntBusy = false; ntGen++; }
  function ntLoad(force) {
    if (ntBusy || view !== 'app' || !ym) return;
    if (ntNoDb) { if (!ntSt || ntSt.ym !== ym) ntSt = { ym: ym, at: Date.now(), rows: [], err: NODB_NT }; return; }
    if (!force && ntSt && ntSt.ym === ym && Date.now() - ntSt.at < 30000) return;
    var atYm = ym, my = ++ntGen; ntBusy = true;
    rpc('kintai_notices_list', { p_ym: atYm }).then(okOr).then(function (r) {
      if (my !== ntGen) return;
      ntSt = { ym: atYm, at: Date.now(), rows: (Array.isArray(r.rows) ? r.rows : []).filter(function (x) { return x && typeof x === 'object' && !x.voided_at && NT_TEXT[x.kind] && C.isDate(x.work_date); }) };
    })['catch'](function (e) {
      if (my !== ntGen) return;
      if (noDb(e)) ntNoDb = true;
      else if (!isNetErr(e) && !reqKnown(e)) note('知らせの読み込み', e);
      ntSt = { ym: atYm, at: Date.now(), rows: [], err: noDb(e) ? NODB_NT : '知らせを読めませんでした: ' + ntMsg(e) };
    }).then(function () {
      if (my !== ntGen) return;
      ntBusy = false;
      if (view === 'app' && !busy && !printAll && tab === 'home') paint();
    });
  }
  function devLoad() {
    if (devBusy || view !== 'app' || reqNoDb || ntNoDb) return;
    if (devSt && Date.now() - devSt.at < 300000) return;
    var my = ++devGen; devBusy = true;
    rpc('kintai_self_devices', { p_staff_id: null }).then(okOr).then(function (r) {
      if (my !== devGen) return;
      var has = {};
      (Array.isArray(r.devices) ? r.devices : []).forEach(function (d) { if (d && d.state === 'active' && !d.revoked_at && typeof d.staff_id === 'string') has[d.staff_id] = true; });
      devSt = { at: Date.now(), has: has };
    })['catch'](function (e) {
      if (my !== devGen) return;
      if (!isNetErr(e) && !reqKnown(e) && !noDb(e)) note('スマホの一覧（知らせ）', e);
      devSt = { at: Date.now(), has: null };   /* 読めない時は押せる形のまま（仮置き） */
    }).then(function () {
      if (my !== devGen) return;
      devBusy = false;
      if (view === 'app' && !busy && !printAll && tab === 'home') paint();
    });
  }
  /* 知らせる相手の行。kind 'not_in'＝今日の塊に not_in_yet の印がある人（ホームの「今日」の箱と同じ）・'missing'＝要確認の一覧の missing_in／missing_out の塊（14日以内の日・新しい日から）。
     返す: [{ sid, name, date, what }]（同じ人・同じ日は1行） */
  function ntTargets(kind) {
    if (!month) return [];
    var names = {}, td = today(), out = [], seen = {};
    (month.people || []).forEach(function (p) { if (p.staff) names[p.staff.staff_id] = dispName(p.staff); });
    var push = function (sid, date, what) { var k = sid + '|' + date; if (seen[k]) return; seen[k] = 1; out.push({ sid: sid, name: names[sid] != null ? names[sid] : String(sid), date: date, what: what }); };
    if (kind === 'not_in') {
      (month.people || []).forEach(function (p) {
        (p.days || []).forEach(function (d) {
          if (d.date !== td) return;
          (d.blocks || []).forEach(function (b) { if ((b.flags || []).indexOf('not_in_yet') >= 0) push(p.staff.staff_id, td, 'まだ出勤していません'); });
        });
      });
      return out;
    }
    var lo = ntBack(td, NT_DAYS - 1);
    C.reviewList(month).slice().reverse().forEach(function (r) {
      if (r.date > td || r.date < lo) return;
      var mi = r.marks.indexOf('missing_in') >= 0, mo = r.marks.indexOf('missing_out') >= 0;
      if (mi || mo) push(r.staffId, r.date, mi && mo ? '出勤・退勤の打刻がありません' : mi ? '出勤の打刻がありません' : '退勤の打刻がありません');
    });
    return out;
  }
  /* その人・その日・その種類の取り消していない知らせ（いちばん新しい1件） */
  function ntOf(sid, date, kind) {
    var rows = ntSt && !ntSt.err ? ntSt.rows : [], best = null;
    rows.forEach(function (n) { if (n.staff_id === sid && n.work_date === date && n.kind === kind && (!best || String(n.created_at) > String(best.created_at))) best = n; });
    return best;
  }
  /* 時刻の文（今日なら時:分・ほかの日は月/日を添える） */
  function ntMd(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }   /* ホームの箱の行と同じ「1/13」の形 */
  function ntAt(v) { var t = ms(v); if (t == null) return ''; var d = C.jstDate(t); return (d !== today() ? ntMd(d) + ' ' : '') + hm(t); }
  /* 箱の下の並び（無い時は ''）。印刷しない（no-print） */
  function noticeHtml(kind) {
    var list = ntTargets(kind);
    if (!list.length) return '';
    var h = '<div class="hnt no-print" data-nt="' + kind + '"><p class="hnt-h">本人のスマホに知らせる（「自分の勤怠」を開いた時に出ます）</p>';
    if (ntNoDb) return h + '<p class="hnt-s">' + esc(NODB_NT) + '</p></div>';
    if (ntSt && ntSt.err && ntSt.ym === ym) h += '<p class="hnt-s">' + esc(ntSt.err) + '</p>';
    var loaded = !!ntSt && ntSt.ym === ym && !ntSt.err;
    var rows = list.slice(0, NT_MAX).map(function (x) {
      var n = loaded ? ntOf(x.sid, x.date, kind) : null, st = '', btn = '';
      if (n) {
        st = '知らせ済み ' + ntAt(n.created_at) + '・' + (n.seen_at ? '見た ' + ntAt(n.seen_at) : 'まだ見ていません');
        btn = '<button type="button" class="btn sm k5" data-act="nt-void" data-id="' + esc(n.id) + '" data-sid="' + esc(x.sid) + '">取り消す</button>';
      } else if (devSt && devSt.has && !devSt.has[x.sid]) {
        st = 'スマホ未登録';
      } else if (!ntSt || ntSt.ym !== ym) {
        st = '読み込み中…';
      } else {
        btn = '<button type="button" class="btn sm k5" data-act="nt-add" data-sid="' + esc(x.sid) + '" data-date="' + esc(x.date) + '" data-kind="' + kind + '">知らせる</button>';
      }
      return '<li><span class="ntn"><b>' + esc(x.name) + '</b> ' + esc(ntMd(x.date)) + ' ' + esc(x.what) + '</span>' + (st ? '<span class="nts">' + esc(st) + '</span>' : '') + btn + '</li>';
    }).join('');
    var more = list.length > NT_MAX ? '<p class="hnt-s">ほか ' + (list.length - NT_MAX) + ' 件（上の ' + NT_MAX + ' 件の後に出します）</p>' : '';
    return h + '<ul>' + rows + '</ul>' + more + '</div>';
  }
  /* 箱と並びを1つの升に入れる（並びが無い時は箱だけ＝今の形のまま） */
  function ntWrap(boxH, ntH) { return ntH ? '<div class="hcell">' + boxH + ntH + '</div>' : boxH; }
  function ntAsk(q) { try { if (window.SUDialog && window.SUDialog.confirm) return window.SUDialog.confirm(q); } catch (e) { /* ブラウザの窓に落とす */ } return Promise.resolve(confirm(q)); }
  function ntPrompt(q, def) { try { if (window.SUDialog && window.SUDialog.prompt) return window.SUDialog.prompt(q, def); } catch (e) { /* ブラウザの窓に落とす */ } return Promise.resolve(window.prompt ? window.prompt(q, def) : null); }
  function ntName(sid) { var s = staffById(sid); return s ? dispName(s) : String(sid || ''); }
  function ntAdd(sid, date, kind, btn) {
    if (busy || !NT_TEXT[kind] || !C.isDate(date) || !sid) return;
    var q = ntName(sid) + ' さんの本人の画面に「' + ntSentence(kind, date) + '」と出します。よろしいですか？\n（本人が「自分の勤怠」を開いた時に出ます。メール・通知は送りません）';
    ntAsk(q).then(function (yes) {
      if (!yes || busy) return;
      busy = true; var restore = pressBusy(btn, '送っています…');
      rpc('kintai_notice_add', { p_staff_id: sid, p_work_date: date, p_kind: kind }).then(okOr).then(function (r) {
        busy = false;
        toast(r.dup ? 'もう知らせてあります（同じ日の同じ知らせ）' : '知らせました（本人が「自分の勤怠」を開いた時に出ます）');
        ntReset(); paint();
      })['catch'](function (e) {
        busy = false; restore();
        if (noDb(e)) ntNoDb = true;
        else if (!isNetErr(e) && !reqKnown(e)) note('打刻漏れの知らせ', e);
        toast(ntMsg(e));
        if (e && e.kintai === 'notfound') { ntReset(); paint(); }
      });
    });
  }
  function ntVoid(id, sid, btn) {
    if (busy || !/^[0-9a-f-]{36}$/i.test(String(id || ''))) return;
    ntPrompt(ntName(sid) + ' さんへの知らせを取り消します（本人の画面から消えます）。取り消す理由を書いてください。', '押し間違い').then(function (reason) {
      if (reason == null || busy) return;
      reason = String(reason).trim();
      if (!reason) { toast(NG_NT.reason); return; }
      busy = true; var restore = pressBusy(btn, '取り消しています…');
      rpc('kintai_notice_void', { p_id: String(id), p_reason: reason.slice(0, 200) }).then(okOr).then(function () {
        busy = false; toast('知らせを取り消しました'); ntReset(); paint();
      })['catch'](function (e) {
        busy = false; restore();
        if (!isNetErr(e) && !reqKnown(e) && !noDb(e)) note('知らせの取り消し', e);
        toast(ntMsg(e));
        if (e && (e.kintai === 'already' || e.kintai === 'notfound')) { ntReset(); paint(); }
      });
    });
  }

  /* ── 操作 ── */
  /* v5 段5: 申請のタブに入る時は一覧を捨てて読み直す（読み込み中の古い答えは世代で捨てる・反証レビュー 2026-11-21）。タブの移りの本体の文は変えない */
  function setTab(t) { if (t === 'requests') reqReset(); if (TABS.indexOf(t) < 0) t = 'home'; if (!settingsLeaveOk()) return; tab = t; lsSet(LS_TAB, t); paint(); if (t === 'home' || t === 'day' || t === 'review') quietReload(); }
  function setYm(v, keepAuto) { if (!C.isYm(v) || v === ym) return; if (!keepAuto) autoYm = null; ym = v; lsSet(LS_YM, v); $('g-ym').value = v; shiftInfo = null; editsCache = null; data = null; month = null; fiSt = null; fiSel = {}; paintPer(); load(true); }
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
      if (t) { var td0 = b.getAttribute('data-date'); if (td0 && C.isDate(td0)) selDate = td0; if (b.getAttribute('data-rq') === 'pending') reqF = { status: 'pending', ym: '' }; setTab(t); return; }   /* v5 段5: 申請の箱・締めの画面からは承認待ち・すべての月分で開く */   /* ホームの「今日」の箱は今日の日ごとへ */
      var a = b.getAttribute('data-act');
      if (!a) return;
      if (a === 'nt-add') { ntAdd(b.getAttribute('data-sid'), b.getAttribute('data-date'), b.getAttribute('data-kind'), b); return; }   /* v6: 打刻漏れの知らせ */
      if (a === 'nt-void') { ntVoid(b.getAttribute('data-id'), b.getAttribute('data-sid'), b); return; }
      if (a === 'edit') openEdit(b.getAttribute('data-sid'), b.getAttribute('data-date'), b.hasAttribute('data-bi') ? +b.getAttribute('data-bi') : null, b.getAttribute('data-rv'));
      else if (a === 'person') { selStaff = b.getAttribute('data-sid'); setTab('person'); }
      else if (a === 'dlg-close') { if (!dirty() || confirm('保存していない直しがあります。閉じますか？')) closeDlg(); }
      else if (a === 'dlg-save') saveEdit(b, false);
      else if (a === 'dlg-save-next') saveEdit(b, true);
      else if (a === 'pick-open') pickOpen();
      else if (a === 'lock-go') lockGo(b);
      else if (a === 'rvd-start') { if (dlgCtx && dlgCtx.mode === 'lock') closeDlg(); openDecide(0); }   /* 0120 */
      else if (a === 'rvd-save') saveDecide(b);
      else if (a === 'rvd-skip') { var dk = dlgCtx; if (dk && dk.mode === 'rvd' && (!dirty() || confirm('選んだ「認める／認めない」を保存せずに、次の1件へ進みますか？'))) { closeDlg(); nextDecide(dk, true); } }
      else if (a === 'rvd-edit') { var dc = dlgCtx; if (dc && dc.mode === 'rvd' && (!dirty() || confirm('選んだ「認める／認めない」を保存せずに、直す窓を開きますか？'))) { closeDlg(); openEdit(dc.sid, dc.date, dc.bi, dc.rvIndex); } }
      else if (a === 'csv-snap' || a === 'csv-now') { closeDlg(); exFresh(function () { writeCsv('sum', a === 'csv-snap' ? 'snap' : 'now'); }); }   /* 段A1: 書き出す直前に補助項目を読み直す */
      else if (a === 'reason') {
        var r = b.getAttribute('data-r'), inp = $('e-reason');
        if (inp) { if (r !== 'その他') inp.value = r; else if (REASONS.indexOf(inp.value) >= 0 || DECIDE_REASONS.indexOf(inp.value) >= 0 || SCHED_REASONS.indexOf(inp.value) >= 0 || FX_REASONS.indexOf(inp.value) >= 0) inp.value = ''; inp.focus(); }
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
      else if (a === 'lv-use-add' || a === 'lv-use-void' || a === 'lv-grant-add' || a === 'lv-grant-void' || a === 'lv-prof-save' || a === 'lv-abs-add' || a === 'lv-abs-void') leaveAct(a, b);
      else if (a === 'lv-ledger') printLedger();
      else if (a === 'lt-add') ltAddRow();
      else if (a === 'ex-add-row') exAddRow();   /* 段A1: 補助項目 */
      else if (a === 'ex-open') openExtra(b.getAttribute('data-sid'), b.getAttribute('data-date'), b.getAttribute('data-code'));
      else if (a === 'ex-save') saveExtra(b);
      else if (a === 'ex-void') openExtraVoid(b.getAttribute('data-id'));
      else if (a === 'ex-void-go') voidExtra(b);
      else if (a === 'ex-reload') { exSt = null; paint(); loadExtras(true); }
      else if (a === 'a2-add-group') a2AddGroup();   /* 段A2: 記号の組 */
      else if (a === 'a2-adopt') { a2Touched = { g: true, c: true, m: true }; saveSettings(b); }   /* 段A2: 案のままで使い始める */
      else if (a === 'ex-adopt') { exTouched = true; saveSettings(b); }   /* 段A1: 案のままで補助項目を使い始める（反証レビュー 2026-11-25 M3） */
      else if (a === 'recode') recode(b.getAttribute('data-sid'), b);
      else if (a === 'import') { if (isLocked()) alert('締めた月は取り込めません。'); else if (settingsLeaveOk()) { dropMonthCaches(); load(true); } }
      else if (a === 'lock') lockMonth(b);
      else if (a === 'fi-go') fiGo(b);   /* 2026-11-23: freee の月の集計の取り込み */
      else if (a === 'fi-clear') { fiSt = null; paint(); }
      else if (a === 'fi-void') fiVoid(b);
      else if (a === 'unlock') unlockMonth(b);
      else if (a === 'csv-sum') exFresh(function () { download('sum'); });   /* 段A1: 書き出す直前に補助項目を読み直す（別の端末で入れた分を落とさない） */
      else if (a === 'csv-day') exFresh(function () { download('day'); });
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
      else if (a === 'rq-reload') { reqReset(); reqSumReset(); paint(); }
      else if (a === 'rq-ok' || a === 'rq-ng') openReqDecide(b.getAttribute('data-id'), a === 'rq-ok');
      else if (a === 'rq-go') saveReqDecide(b);
      else if (a === 'sp-enroll') openEnroll(b.getAttribute('data-sid'), b);
      else if (a === 'sp-list') openDevices(b.getAttribute('data-sid'));
      else if (a === 'sp-revoke') openRevoke(b.getAttribute('data-id'));
      else if (a === 'sp-revoke-go') saveRevoke(b);
    });
    document.addEventListener('change', function (e) {
      var id = e.target && e.target.id;
      if (id === 'g-date') { selDate = e.target.value; paint(); }
      else if (id === 'g-staff') { selStaff = e.target.value; paint(); }
      else if (id === 'g-only') { onlyReview = e.target.checked; paint(); }
      else if (id === 'g-office') { officeFilter = e.target.value; paint(); }
      else if (id === 'g-rq-st' || id === 'g-rq-ym') { reqF = { status: $('g-rq-st').value, ym: $('g-rq-ym').value === 'cur' ? 'cur' : '' }; reqReset(); paint(); }   /* v5 段5: 絞り込みは画面の中だけ */
      else if (id === 'fi-file') fiRead(e.target);   /* 2026-11-23: freee の月の集計の CSV（メモリだけで読む） */
      else if (e.target && e.target.name === 'fi-none' && fiSt) { fiSt.none[e.target.value] = !!e.target.checked; paint(); }
      else if (e.target && e.target.name === 'fi-v') fiSel[e.target.value] = !!e.target.checked;
      else if (id === 'lv-a-kind') absKindShow();
      else if (id === 'ex-code') exKindShow();   /* 段A1: 補助項目の形に合う欄だけを出す */
      else if (id && /^a2[gcm]-/.test(id)) a2Touched[id.charAt(2)] = true;   /* 段A2: 設定の3つの欄を触った */
      else if (id && id.indexOf('ex-s-') === 0) exTouched = true;   /* 段A1: 設定の「補助項目」の欄を触った */   /* v5 段4: 休暇の種類に合う欄だけを出す */
      else if (id === 'g-ym') { if (settingsLeaveOk()) setYm(e.target.value); else e.target.value = ym; }   /* v5 C4: 保存していない設定の変更を確かめる（やめたら月の欄を戻す） */
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
      if (id === 'fi-reason' && fiSt) fiSt.reason = e.target.value;   /* 描き直しで書いた理由を消さない（画面の中だけ） */
      if (id && /^a2[gcm]-/.test(id)) a2Touched[id.charAt(2)] = true;   /* 段A2: 設定の3つの欄に書いた */
      if (id && id.indexOf('ex-s-') === 0) exTouched = true;   /* 段A1: 設定の「補助項目」の欄に書いた（反証レビュー 2026-11-25 M3） */
      /* 0111: 予定の窓で始業・終業を変えたら、前の予定から入れた休憩は空に戻す（いつもの決まりで決め直す。手で入れた休憩は残す） */
      if ((id === 'sc-start' || id === 'sc-end') && dlgCtx && dlgCtx.mode === 'sched' && dlgCtx.preBr && $('sc-break') && $('sc-break').value === dlgCtx.preBr) { $('sc-break').value = ''; dlgCtx.preBr = ''; }
      if (id === 'e-early-from') r = document.querySelector('#g-dlg-b input[name="e-em"][value="from"]');
      else if (id === 'e-ot-until') r = document.querySelector('#g-dlg-b input[name="e-om"][value="until"]');
      if (r) r.checked = true;
    });
    $('g-prev').addEventListener('click', function () { if (settingsLeaveOk()) setYm(C.prevYm(ym)); });
    $('g-next').addEventListener('click', function () { if (settingsLeaveOk()) setYm(C.nextYm(ym)); });
    $('g-import').addEventListener('click', function () { if (isLocked()) alert('締めた月は取り込めません。'); else if (settingsLeaveOk()) { dropMonthCaches(); load(true); } });
    /* v5 段5: 上の「読み直す」は申請の一覧と数も捨てて読み直す（反証レビュー 2026-11-21）。月を読み直す受けより先に足し、読み込みの最初の描き直しで新しく読むようにする */
    $('g-reload').addEventListener('click', function () { reqReset(); reqSumReset(); });
    $('g-reload').addEventListener('click', function () { if (settingsLeaveOk()) { dropMonthCaches(); load(false); } });
    /* 保存中（busy）は Esc でも閉じない（審査の指摘1） */
    $('g-dlg').addEventListener('cancel', function (e) { if (busy) { e.preventDefault(); return; } if (dirty() && !confirm('保存していない直しがあります。閉じますか？')) e.preventDefault(); else { dlgCtx = null; wipeEnroll(); } });   /* v5 段5: Esc の時はその場で QR と番号を消す（close の知らせは後から届くため） */
    $('g-dlg').addEventListener('close', function () { wipeEnroll(); });   /* v5 段5: Esc・閉じるのどれで閉じても QR と番号を消す */
    window.addEventListener('beforeunload', function (e) { if (dirty() || settingsDirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('storage', function (e) { if (e.key === 'su_device_role' && isField()) location.reload(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted && isField()) location.reload(); });
    window.addEventListener('beforeprint', stampPrint);
    window.addEventListener('afterprint', endPrint);
    /* ホーム・日ごと・要確認を開いている間は30秒ごとに打刻を読み直して数え直す（タブレットの打刻を再読み込みなしで出す・2026-11-20 代表者の指示・ホームは v5 段2）。
       画面が隠れている間は休み、見えた時・日ごと／要確認のタブへ移った時はすぐ読み直す */
    setInterval(function () { quietReload(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') quietReload(); });
    /* 段A1: 個人の月を開いている間は、補助項目も30秒ごと・画面に戻った時に読み直す（別の端末で入れた分を届ける・月の読み直しとは別の時計・反証レビュー 2026-11-25 S1） */
    setInterval(function () { exQuiet(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') exQuiet(); });
  }

  /* 黙って読み直す（ホーム・日ごと・要確認だけ）: 窓・保存中・印刷中・選ぶ欄の操作中・ほかの読み込み中は何もしない。
     読めない時は手元の時刻で数え直すだけ（帯は出さない・記録に残す）。届いた時に月やタブが変わっていれば捨てる */
  var quietBusy = 0, quietSeq = 0;
  var quietNetFails = 0;   /* 読み直しで続けて通信できなかった回数（読めたら0に戻す・reports#15 の直し） */
  var quietRev = null, quietRevNo = false;   /* 最後に黙って読んだ時の月の変わりの印（どの月・どの読み込みの世代か）・印の関数がまだ無いか（総点検 2026-11-21） */
  function quietOk() {
    if (view !== 'app' || busy || !month || !data || dlgCtx || printAll || (tab !== 'home' && tab !== 'day' && tab !== 'review')) return false;
    if (document.visibilityState === 'hidden') return false;
    var ae = document.activeElement;
    return !(ae && ae.tagName === 'SELECT' && $('g-main').contains(ae));
  }
  function quietReload() {
    if (!quietOk()) return;
    if (tab === 'home') loadReqSum(false);   /* v5 段5: 申請の承認待ちの数は1分ごと（関数が無い時は聞かない） */
    /* 前の読み直しの答えがまだ来ない間は、手元の時刻で数え直すだけ（勤務中・まだ出勤していないの印を止めない）。
       20秒で答えが来なければ諦めて次から読み直す（届いた古い答えは番号で捨てる） */
    if (quietBusy && Date.now() - quietBusy < 20000) { recompute(); paint(); return; }
    var my = gen, atYm = ym, seq = ++quietSeq; quietBusy = Date.now();
    /* 総点検（2026-11-21・代表者の決定）: まず月の変わりの印（統合 0117 の kintai_month_rev・32文字）だけを聞き、前に読んだ時と同じなら
       kintai_month_get（1回 数百KB〜2MB）を読まずに手元の時刻で数え直すだけにする。印は読み込む前に聞く（読み込みの間に変わっても次の30秒で読み直す）。
       印が空・関数がまだ無い（0117 の前）・断られた時は今までどおり丸ごと読む（関数が無いと分かった後はこの画面では印を聞かない） */
    var revP = quietRevNo ? Promise.resolve(null) : rpc('kintai_month_rev', { p_ym: ym })['catch'](function (e) { if (noDb(e)) quietRevNo = true; return null; });
    var revNow = null;
    revP.then(function (rv) {
      revNow = typeof rv === 'string' && rv ? rv : null;
      if (revNow && quietRev && quietRev.rev === revNow && quietRev.ym === atYm && quietRev.gen === my) return 'same';
      return rpc('kintai_month_get', { p_ym: atYm }).then(okOr);
    }).then(function (d) {
      if (seq !== quietSeq) return;
      quietBusy = 0; quietNetFails = 0;
      if (my !== gen || atYm !== ym || !quietOk()) return;
      if (d !== 'same') { data = d; quietRev = revNow ? { rev: revNow, ym: atYm, gen: my } : null; }
      recompute(); paint();
      sync(isLocked() ? '締め済みの月です' : '読み込みました（' + hm(Date.now()) + '）');
    })['catch'](function (e) {
      if (seq !== quietSeq) return;
      quietBusy = 0;
      /* 1回きりの通信の失敗（Wi-Fi の切り替え・スリープ明け）は次の30秒で読み直せるので報告しない（reports#15 はこれだった）。
         3回続けて通信できない時だけ1回報告する。通信以外（画面のコードの例外・DB の断り）は今までどおり毎回報告する */
      if (!isNetErr(e)) note('自動の読み直し', e);
      else if (++quietNetFails === 3) note('自動の読み直し（通信が3回続けて失敗）', e);
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
    window.SUAppGate.run('kintai', { dirty: function () { return dirty() || settingsDirty(); } }).then(function (ok) {
      if (!ok) { view = 'gate'; return; }
      view = 'app';
      $('g-app').hidden = false;
      var t = lsGet(LS_TAB); tab = TABS.indexOf(t) >= 0 ? t : 'home';   /* v5 段2: 既定のタブはホーム（仮置き） */
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
