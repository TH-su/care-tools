/* payroll.js — 給与の画面（2026-11-19 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/給与/ROOT-payroll.md の D と v2 改訂・契約 CONTRACT-payroll-v1.md §5）
 * ════════════════════════════════════════════════════════════════
 * ・正本は共通のデータベース（payroll_* の表）。読み書きは関数（rpc）だけ。誰が使えるか（管理者＋給与の名簿の人・二段階のログイン）は
 *   データベースの関数が決める。画面は SUAppGate.run('payroll') の後に payroll_bootstrap を呼び、42501 なら覆いの画面を出す
 * ・計算は payroll-calc.js（PayrollCalc.computeItem・純関数）、書き出しは payroll-export.js（PayrollExport）。画面は呼ぶだけ
 * ・確定は「押した時に読み直して数え直し、窓の数字と同じ時だけ確定」（review 9 の案3）。DB が指紋を照合して stale と言えば、
 *   自動で読み直して計算し直すが、確定し直しはしない（人がもう一度確かめる）
 * ・端末に残すのは開いていたタブだけ（payroll_tab・原則11）。月分・金額・氏名・口座は残さない。console に出さない
 * ・10分操作が無ければ金額を画面から消す（隠すのではなく描いた物を捨てる）。窓と紙の用意も捨てる
 * ・口座の全桁は全銀のボタンを押した時だけ payroll_bank_export で受け取り、ファイルを作ったらすぐ捨てる
 * ・遅れて届いた応答は世代（gen）で捨てる
 * ・データベースの口の形は care-backend の統合 0102（payroll_*）が正。指紋は bootstrap が返す値に率と計算の版（rates_ver・calc_ver）を足すだけで、
 *   画面で作らない。明細は {staff_id, item, adjustments} の形で送る（item に氏名・口座を入れない）
 * ・勤怠は締めた時の控え（kintai_months.snapshot の rows）を attFromKintai で計算の入力（契約 §2 の att）にする
 * ・全銀の書き出しは給与の設定 zengin_enabled が true の時だけ出す（既定は使わない・管理者が「設定」で変える・DB も payroll_bank_export で同じ印を見て zengin_off で断る）
 * ・止めて知らせる窓は画面の中の窓（su-dialog.js の SUDialog）。窓が出ている間も10分で金額を隠し、隠した後の答えは「やめる」にする
 * ・勤怠は締めの控えをそのまま正にせず、kintai_month_get の生の行を kintai-calc.js の computeMonth で数え直して控えと比べる（食い違えば止める）
 */
(function () {
  'use strict';
  var TABS = ['run', 'slip', 'export', 'bonus', 'profile', 'yearend', 'settings'];   /* 'bonus' は賞与（2026-11-23 足した・統合 0121）・'yearend' は年末調整（2026-11-23・中身は payroll-yearend-ui.js） */
  var LS_TAB = 'payroll_tab';
  var IDLE_MS = 10 * 60 * 1000;
  var gen = 0, view = 'boot', tab = 'run', ym = null, bs = null, role = null, loadErr = null;
  var calc = null, adjEdits = {}, dirty = false, busy = false, masked = false, lastAct = Date.now();
  var openSid = null, slipSid = null, importRows = null, importErr = null, members = null, zcheck = null, notice = null, audit = null;
  var printList = null, dlgCtx = null, yePrint = null;
  var $ = function (id) { return document.getElementById(id); };

  function note(where, e) { try { if (window.SUErrors && window.SUErrors.note) window.SUErrors.note('給与', e, 'payroll:' + where); } catch (_) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* HTML を入れる所はここだけ（値は全部 esc を通してから組む） */
  function put(el, html) { if (el) el.innerHTML = html; }
  function sync(t) { $('p-sync').textContent = t || ''; }
  function isField() { try { return localStorage.getItem('su_device_role') === 'field'; } catch (_) { return false; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function isYm(v) { return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }
  function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function shiftYm(v, n) { var y = +v.slice(0, 4), m = +v.slice(5) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function todayYm() { var d = new Date(Date.now() + 9 * 3600000); return d.toISOString().slice(0, 7); }
  function addDay(d, n) { var t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function md(d) { return isDate(d) ? (+d.slice(5, 7)) + '/' + (+d.slice(8)) : ''; }
  function jdate(d) { return isDate(d) ? d.slice(0, 4) + '年' + (+d.slice(5, 7)) + '月' + (+d.slice(8)) + '日' : ''; }
  function ymText(v) { return isYm(v) ? v.slice(0, 4) + '年' + (+v.slice(5)) + '月分' : ''; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function yen(n) { n = Math.round(num(n)); return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP'); }
  function at(v) { if (!v) return ''; var t = Date.parse(v); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000).toISOString(); return d.slice(0, 10).replace(/-/g, '/') + ' ' + d.slice(11, 16); }
  function isAdmin() { return role === 'admin'; }
  function C() { return window.PayrollCalc && typeof window.PayrollCalc.computeItem === 'function' && window.PayrollRates ? window.PayrollCalc : null; }
  function calcVer() { var c = window.PayrollCalc; return String((c && (c.VERSION || c.CALC_VER)) || 'unknown').slice(0, 40); }
  function ratesVer() { var r = window.PayrollRates; return String((r && r.VERSION) || 'unknown').slice(0, 40); }
  function X() { return window.PayrollExport || null; }
  function cfg() { return (bs && bs.settings && bs.settings.config) || {}; }
  /* 全銀の書き出しを使うか（給与の設定 zengin_enabled・既定は使わない・管理者だけが変える。DB も payroll_bank_export で同じ印を見て断る） */
  function zenginOn() { return cfg().zengin_enabled === true; }
  /* 確定した月は、DB が明細に写した期間・設定（frozen）があればそれを使い、今の値から取らない（無い DB の版では今の値） */
  function frozenOf(k) { if (!frozen()) return null; var it = arr(bs.items).filter(function (x) { return x && x[k]; })[0]; return it ? it[k] : null; }
  function period() { return frozenOf('frozen_period') || (bs && (bs.period || (bs.kintai && bs.kintai.period))) || null; }
  function paperCfg() { return frozenOf('frozen_cfg') || cfg(); }
  function status() { return (bs && bs.run && bs.run.status) || null; }
  function frozen() { var s = status(); return s === 'confirmed' || s === 'exported'; }
  function corpName() {
    var c = paperCfg().company_name;
    if (c) return String(c);
    try { var f = window.SUFacility && window.SUFacility.get && window.SUFacility.get(); return (f && (f.corpName || f.facilityName)) || ''; } catch (_) { return ''; }
  }
  /* 支給日: 確定した月は明細に写した支給日（pay_date）を使い、今の設定から取り直さない */
  function payDate() {
    if (frozen()) { var f = arr(bs.items).filter(function (it) { return isDate(it.pay_date); })[0]; if (f) return f.pay_date; }
    var c = window.PayrollCalc; try { return c && typeof c.payDate === 'function' ? (c.payDate(ym, cfg()) || '') : ''; } catch (e) { note('支給日', e); return ''; }
  }
  function periodText() { var p = period(); return p && isDate(p.from) && isDate(p.to) ? ymText(ym) + '（' + md(p.from) + '〜' + md(p.to) + '）' : ymText(ym); }

  /* 止めて知らせる窓は画面の中の窓（su-dialog.js）。ブラウザの窓と違って画面の動きを止めないので、窓が出ている間も10分で金額を隠す処理が動く。
     答えが来た時に金額を隠していた・覆いに変わっていた時は「やめる」として扱う（maskGen） */
  var maskGen = 0;
  function say(msg) { try { return window.SUDialog ? window.SUDialog.alert(msg) : Promise.resolve(window.alert(msg)); } catch (e) { note('知らせの窓', e); return Promise.resolve(); } }
  function ask(msg) {
    var mg = maskGen;
    var pr; try { pr = window.SUDialog ? window.SUDialog.confirm(msg) : Promise.resolve(window.confirm(msg)); } catch (e) { note('確かめの窓', e); pr = Promise.resolve(false); }
    return pr.then(function (ok) { return !!ok && mg === maskGen && !masked && view === 'app'; });
  }
  var toastT = null;
  function toast(t) {
    var el = $('p-toast'); if (!el) return;
    el.textContent = t; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; el.textContent = ''; }, 4500);
  }
  function hold(btn, text) {
    var label = btn ? btn.textContent : null; busy = true;
    if (btn) { btn.disabled = true; btn.textContent = text || '送っています…'; }
    return function () { busy = false; if (btn && label != null) { btn.disabled = false; btn.textContent = label; } };
  }

  /* ── データベースの窓口 ── */
  function rpc(name, args) {
    return Promise.resolve().then(function () { return window.SUAuth.client().rpc(name, args || {}); }).then(function (r) {
      if (r && r.error) throw r.error;
      return r ? r.data : null;
    });
  }
  function noDb(e) { var c = e && e.code; return c === '42P01' || c === 'PGRST205' || c === 'PGRST202'; }
  function isAal(e) { return !!e && (e.payroll === 'aal2' || /aal2|mfa/i.test(String(e.message || ''))); }
  var NG = {
    stale: '勤怠・職員の給与設定・給与の設定のどれかが、計算した後に変わりました。読み直して計算し直したので、数字を確かめてからもう一度保存・確定してください。',
    conflict: '別の人が先に保存しました。読み直してから、もう一度行ってください。',
    confirmed: 'この月はもう確定しています。直す時は、管理者が確定を取り消してください。',
    notlocked: 'この月分の勤怠がまだ締められていません。勤怠管理で締めてから保存してください。',
    notconfirmed: 'この月はまだ確定していません。確定してから書き出してください。',
    reason: '理由を書いてください。', badshape: '送った値の形が違いました。読み直してください。', badym: '月分の形が違います。',
    baddate: '日付の形が違います（設定を変える日は、月分の期間の初日だけ選べます）。', badbank: '口座の番号の形が違います（銀行4桁・支店3桁・口座7桁まで）。',
    notfound: '見つかりませんでした。読み直してください。', aal2: '二段階のログイン（認証アプリの6桁）を済ませてから使ってください。',
    toobig: '送る量が大きすぎます。',
    /* 統合 0102 の断りの名前（文は仮置き 2026-11-19） */
    norun: 'この月分はまだ下書き保存していません。「今月の給与」で計算して下書き保存してから行ってください。',
    badsum: '保存した明細の合計が合いません。「計算する」で計算し直して、下書き保存からやり直してください。',
    empty: '中身が空のため保存しませんでした。',
    noprofile: '給与の設定が無い職員が入っています。「職員の給与設定」で設定してから、計算し直してください。',
    nostaff: 'シフトの職員に見つからない人です。読み直してください。',
    badfrom: '設定を変える日は、月分の期間の初日だけ選べます。',
    notoffice: '給与の名簿に載せられるのは、同じ事業者の事務所のアカウントだけです（「使える人の管理」で役割を確かめてください）。',
    badrange: '期間の形が違います（400日まで）。',
    zengin_off: '振込データ（全銀形式）の書き出しは、管理者が「設定」で使うようにするまで使えません。',
    /* 統合 0118 の断りの名前（文は仮置き 2026-11-21） */
    blockwarn: '確定できない警告（率表・税額表・標準報酬が無い月）が残っているので、確定できません。設定を直してから計算し直してください。',
    exported: 'この月の振込データはもう書き出していました。読み直したので、もう一度作る時は「振込データ」をもう一度押し、出てくる確かめの窓で「OK」を押してください（確かめてから10分以内）。',
    notexported: 'この月の振込データはまだ書き出していません。読み直してください。',
    bankstale: '確定した後に振込先の口座が直されました。振込データは作りません。管理者が確定を取り消して、確かめ直してから確定し直してください。'
  };
  function friendly(e) {
    var code = e && e.code, m = String((e && e.message) || e || '');
    if (code === '42501' || /permission denied/i.test(m)) return 'この操作をする権限がありません（確定の取り消し・設定・取り込みは管理者だけです）。';
    if (noDb(e)) return '共通のデータベースに給与の仕組みがまだありません（データベースの更新が必要です）。管理者に知らせてください。';
    if (/failed to fetch|network|load failed|timeout/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return 'うまくいきませんでした。少し待ってから、もう一度試してください。';
  }
  function okOr(r) { if (r && r.ok === true) return r; var err = new Error((r && r.error) || 'ng'); err.payroll = (r && r.error) || 'ng'; throw err; }
  function msgOf(e) { return e && e.payroll ? (NG[e.payroll] || 'うまくいきませんでした（' + e.payroll + '）。') : friendly(e); }

  /* 受け取った形を確かめる（壊れた値で画面を止めない・原則10） */
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  /* 勤怠の月の結果から計算の入力（契約 §2 の att）を作る。受けるのは kintai-calc.js の computeMonth の1人ごとの集計（people[i].sum）か、
     締めた時の控え（snapshotOf の rows の1行）。鍵の名前は段A（統合 0101）の kintai-calc.js がもう出している名前のまま写す。
     0101 より前に締めた控えには鍵が欠けるので、欠けた鍵は 0 にして missing に名前を残す（computeAll が警告にする・0 を黙って信じない） */
  var ATT_KEYS = ['workDays', 'paidDays', 'paidMin', 'workMin', 'schedInMin', 'legalInOverMin', 'legalOverMin', 'over60Min', 'nightMin', 'holidayMin',
    'absentDays', 'lateMin', 'earlyLeaveMin', 'nightShiftCount', 'schedDays', 'reviewCount'];
  /* 勤怠 v5 段4（休暇の種類・統合 0113）の鍵。段4 より前の控えには無いのが正しい（休暇の種類が無かった）ので、無い時は 0 で missing に入れない。
     日数は半日きざみのまま持つ（丸めると半日の特別休暇・代休が1日になる）。hourlyPaidMin は paidMin の内数 */
  var ATT_LEAVE_KEYS = ['hourlyPaidMin', 'specialPaidMin', 'specialPaidDays', 'specialUnpaidDays', 'compDays',
    'hourlyPaidEffMin', 'hourlyPaidOffMin', 'specialPaidOffDays', 'absentPartMin'];   /* absentPartMin: 欠勤の印の日の休暇で埋まらない残り（分・再確認の反証 2026-11-20） */   /* 反証レビュー（2026-11-20）: 時間単位の有休の効く分・働いていない日の分（日給はこれで払う） */
  var ATT_OPT_KEYS = ['holidayWorkDays', 'noSchedWorkMin', 'paidNoSchedDays', 'paidNoSchedMin', 'paidOffDays', 'holidayDaysMin'];
  function attFromKintai(sum, locked) {
    sum = obj(sum);
    var a = { counts: {}, missing: [] };
    /* 欠勤の日数は半日きざみのまま持つ（欠勤の印の日に半日の休暇があると 0.5 日・再確認の反証 2026-11-20。整数の日は今までと同じ） */
    ATT_KEYS.forEach(function (k) { var n = Number(sum[k]); if (sum[k] == null || !isFinite(n)) { a[k] = 0; a.missing.push(k); } else a[k] = Math.max(0, k === 'absentDays' || k === 'paidDays' ? Math.round(n * 2) / 2 : Math.round(n)); });   /* 有休日数も半日きざみのまま（時給の有休を1日の所定時間で払う・2026-11-20。日給の額・勤怠の行の表示は整数に丸めて今と同じ） */
    var c = obj(sum.counts); Object.keys(c).forEach(function (k) { var n = Number(c[k]); if (isFinite(n) && n > 0) a.counts[k] = Math.round(n); });
    ATT_LEAVE_KEYS.forEach(function (k) { var n = Number(sum[k]); a[k] = sum[k] == null || !isFinite(n) ? 0 : Math.max(0, /Days$/.test(k) ? Math.round(n * 2) / 2 : Math.round(n)); });
    if (sum.holidayWorkDays != null && isFinite(Number(sum.holidayWorkDays))) a.holidayWorkDays = Math.max(0, Math.round(Number(sum.holidayWorkDays)));
    if (sum.noSchedWorkMin != null && isFinite(Number(sum.noSchedWorkMin))) a.noSchedWorkMin = Math.max(0, Math.round(Number(sum.noSchedWorkMin)));
    /* 反証レビュー（2026-11-21）: 予定の無い日の有休の日数・分、働いていない日の有休の日数（半日きざみ）、全部が法定休日の日ごとの実働。この版より前の控えには無い＝給与は今までどおりに払う */
    if (sum.paidNoSchedMin != null && isFinite(Number(sum.paidNoSchedMin))) a.paidNoSchedMin = Math.max(0, Math.round(Number(sum.paidNoSchedMin)));
    ['paidNoSchedDays', 'paidOffDays'].forEach(function (k) { if (sum[k] != null && isFinite(Number(sum[k]))) a[k] = Math.max(0, Math.round(Number(sum[k]) * 2) / 2); });
    if (Array.isArray(sum.holidayDaysMin)) a.holidayDaysMin = sum.holidayDaysMin.slice(0, 31).map(function (n) { n = Number(n); return isFinite(n) ? Math.max(0, Math.round(n)) : 0; });   /* 予定の無い勤務の実働（月給の警告・この版より前の控えには無い＝警告を出さない） */
    if (locked === false) a.locked = false;
    return a;
  }
  /* 締めの控えの確かめ（review 9 の最後の段）: 控え（snapshot）をそのまま正にせず、勤怠の生の行（kintai_month_get）を kintai-calc.js の computeMonth で
     締めた時の設定のまま数え直し、計算する人（給与の設定があり、外さず、勤怠を使う人）で控えと食い違う人がいれば計算・保存・確定を止める。
     返す形: { state: 'ok'|'ng'|'err'|'skip', names: [食い違う人の氏名] }。読めない・部品が無い時は 'err'（止める側に倒す） */
  function attSame(a, b) {
    for (var i = 0; i < ATT_KEYS.length; i++) if (a[ATT_KEYS[i]] !== b[ATT_KEYS[i]]) return false;
    for (i = 0; i < ATT_LEAVE_KEYS.length; i++) if ((a[ATT_LEAVE_KEYS[i]] || 0) !== (b[ATT_LEAVE_KEYS[i]] || 0)) return false;   /* 段4: 休暇の種類（無い控えは 0 と同じ） */
    /* 法定休日に働いた日の数・予定の無い勤務の実働（2026-11-20 に足した鍵）は、両方にある時だけ比べる（この版より前の控えには無い） */
    for (i = 0; i < ATT_OPT_KEYS.length; i++) { var ko = ATT_OPT_KEYS[i]; if (a[ko] != null && b[ko] != null && JSON.stringify(a[ko]) !== JSON.stringify(b[ko])) return false; }
    var ka = Object.keys(a.counts).sort(), kb = Object.keys(b.counts).sort();
    if (ka.join('\u0001') !== kb.join('\u0001')) return false;
    for (i = 0; i < ka.length; i++) if (a.counts[ka[i]] !== b.counts[ka[i]]) return false;
    return true;
  }
  function verifyKintai(ymx, boot) {
    var K = window.KintaiCalc;
    if (!boot || !boot.kintai.locked) return Promise.resolve({ state: 'skip', names: [] });
    if (!K || typeof K.computeMonth !== 'function' || typeof K.snapshotOf !== 'function') return Promise.resolve({ state: 'err', names: [] });
    return rpc('kintai_month_get', { p_ym: ymx }).then(function (d) {
      if (!d || d.ok === false) throw new Error('kintai_month_get: ' + ((d && d.error) || 'ng'));
      var m = obj(d.month), snap = obj(m.snapshot);
      if (!m.locked_at) return { state: 'ng', names: [], unlocked: true };
      var month = K.computeMonth({ ym: ymx, period: d.period, staff: arr(d.staff), schedule: arr(d.schedule), punches: arr(d.punches), days: arr(d.days),
        leave_uses: arr(d.leave_uses), config: obj(snap.config), absences: arr(d.absences), lockedAt: m.locked_at, now: Date.now() });   /* 勤怠 v5 段4: 休暇の種類（統合 0113）も渡す（渡さないと休暇を入れた月が控えと食い違って止まる） */
      var fresh = {}, saved = {};
      arr(K.snapshotOf(month).rows).forEach(function (r) { if (r && typeof r.staff_id === 'string') fresh[r.staff_id] = attFromKintai(r); });
      arr(snap.rows).forEach(function (r) { if (r && typeof r.staff_id === 'string') saved[r.staff_id] = attFromKintai(r); });
      var names = [];
      boot.profiles.forEach(function (p) {
        if (p.none || p.data.exclude === true || p.data.no_attendance === true) return;
        var a = fresh[p.staff_id], b = saved[p.staff_id];
        if (!a && !b) return;
        if (!a || !b || !attSame(a, b)) names.push(p.name || p.staff_id);
      });
      /* 段A2（2026-11-25）: 勤怠の設定（kintai_month_get の settings.config）を持っておく（手当の回数の元の選び・控えに補助項目が無い月分の止め） */
      var kcfg = obj(obj(d.settings).config), res = { state: names.length ? 'ng' : 'ok', names: names, kcfg: kcfg };
      var mo = obj(kcfg.meetingOt), per0 = obj(d.period);
      if (!snap.ext && mo.on === true && typeof per0.from === 'string' && per0.from >= '2026-12-16') res.extMissing = true;
      /* 控えに ext がある月分だけ、補助項目（kintai_extras_get）を読み、控えの ext.def（締めた時の定義）で数え直して比べる（ext の無い月分は今までどおり） */
      if (!snap.ext) return res;
      var EXm = window.KintaiExtras;
      if (!EXm || typeof EXm.buildExtDef !== 'function' || !EXm.isExt(snap.ext)) return { state: 'err', names: [] };
      return rpc('kintai_extras_get', { p_ym: ymx }).then(function (xr) {
        if (!xr || xr.ok === false) throw new Error('kintai_extras_get: ' + ((xr && xr.error) || 'ng'));
        var fx = EXm.buildExtDef(month, arr(xr.rows), arr(d.schedule), snap.ext.def), one = function (e, sid) { return { v: 1, def: e.def, rows: e.rows[sid] ? { s: e.rows[sid] } : {} }; };
        if (!EXm.sameExt({ v: 1, def: fx.def, rows: {} }, { v: 1, def: snap.ext.def, rows: {} })) return { state: 'ng', names: ['補助項目の定義'], kcfg: kcfg };
        boot.profiles.forEach(function (p) {
          if (p.none || p.data.exclude === true || p.data.no_attendance === true) return;
          if (!EXm.sameExt(one(fx, p.staff_id), one(snap.ext, p.staff_id)) && names.indexOf(p.name || p.staff_id) < 0) names.push(p.name || p.staff_id);
        });
        res.state = names.length ? 'ng' : 'ok';
        return res;
      });
    })['catch'](function (e) { note('勤怠の確かめ', e); return { state: 'err', names: [] }; });
  }
  function kintaiBlock() {
    var k = bs && bs.kcheck;
    if (!bs || !bs.kintai.locked) return null;
    if (!k || k.state === 'checking') return '締めた勤怠を確かめています。少し待ってから、もう一度押してください。';
    if (k.state === 'ng') return k.unlocked ? NG.notlocked : '締めた時の勤怠の控えと、今の勤怠の記録が合わない人がいます（' + k.names.join('、') + '）。勤怠管理で確かめて、締め直してから計算してください。';
    if (k.state === 'err') return '締めた勤怠を確かめられませんでした（通信か勤怠の部品）。読み直してください。直らない時は管理者に知らせてください。';
    return null;
  }
  /* 締めた時の控え（snapshot）→ staff_id ごとの att */
  function attMap(snap, locked) {
    var out = {}, ext = obj(snap).ext;
    arr(obj(snap).rows).forEach(function (r) { if (r && typeof r.staff_id === 'string') out[r.staff_id] = attExt(attFromKintai(r, locked), r, ext); });
    return out;
  }
  /* 段A2（2026-11-25）: 締めの控えの ext（kintai-extras.js の buildExt）を計算の入力に当てる。
     a.ext＝手当の回数の元（x:・t:・g:・k:）。控えの定義にある元は、0 で鍵を省いた分を 0 で埋める（毎月「控えにありません」を出さない）。
     freee の月の集計を取り込んだ人（行の imported）の記号の組・通勤回数は数えていないので埋めない（給与が「控えにありません」と知らせる）。
     会議の足し分（adj）がある人は、時間外・60時間超・休日労働を足した後の値で置き換え、明細の勤怠の欄に出す分（meetingMin）を持つ。ext の無い控えは何もしない */
  function attExt(a, r, ext) {
    if (!a || !ext || typeof ext !== 'object' || ext.v !== 1 || !ext.def || typeof ext.def !== 'object') return a;
    var d = ext.def, rows = obj(ext.rows), er = obj(rows[r.staff_id]), e = {}, imp = !!r.imported;
    arr(d.items).forEach(function (it) { if (it && typeof it.code === 'string') e[(it.kind === 'time' ? 't:' : 'x:') + it.code] = 0; });
    if (!imp) {
      arr(d.groups).forEach(function (g) { if (g && typeof g.code === 'string' && g.active !== false) e['g:' + g.code] = 0; });
      if (d.commute && typeof d.commute === 'object') e['k:commute'] = 0;
    }
    Object.keys(er).forEach(function (k) { if (/^[xtgk]:/.test(k)) { var n = Number(er[k]); if (isFinite(n) && n > 0) e[k] = n; } });
    a.ext = e;
    var adj = obj(er.adj);
    if (!imp && isFinite(Number(adj.legalOverMin)) && isFinite(Number(adj.holidayMin)) && isFinite(Number(adj.over60Min)) && Number(adj.meetingMin) > 0) {
      a.legalOverMin = Math.max(0, Math.round(Number(adj.legalOverMin))); a.over60Min = Math.max(0, Math.round(Number(adj.over60Min))); a.holidayMin = Math.max(0, Math.round(Number(adj.holidayMin)));
      a.meetingMin = Math.round(Number(adj.meetingMin));
    }
    return a;
  }
  /* 明細の行（DB の {staff_id, name, item, adjustments, gross, deduct, net}）を画面の形（item の中身＋staff_id・name・adjustments）にする */
  function flatItem(x) {
    x = obj(x);
    var it = Object.assign({}, obj(x.item));
    it.staff_id = x.staff_id; it.name = String(x.name || ''); it.adjustments = arr(x.adjustments);
    it.lines = arr(it.lines); it.warnings = arr(it.warnings);
    /* DB が保存の時に写した期間・設定（返す版の DB だけ） */
    var fr = obj(x.frozen), fp = obj(fr.period || x.period), fc = obj(obj(fr.settings).config);
    if (isDate(fp.from) && isDate(fp.to)) it.frozen_period = { from: fp.from, to: fp.to };
    if (Object.keys(fc).length) it.frozen_cfg = fc;
    if (isDate(fr.pay_date)) it.pay_date = fr.pay_date;
    if (Array.isArray(fr.bank_last4)) it.bank_last4 = fr.bank_last4.filter(function (b) { return b && typeof b === 'object'; });   /* 確定の時の口座（紙と振込の件数はこれ） */
    ['gross', 'deduct', 'net'].forEach(function (k) { if (x[k] != null) it[k] = num(x[k]); });
    return it;
  }
  /* 受け取った形を確かめる（壊れた値で画面を止めない・原則10）。形は統合 0102 の payroll_bootstrap */
  function normBoot(r) {
    r = obj(r);
    var st = obj(r.settings), k = obj(r.kintai), rp = obj(r.period), kp = obj(k.period);
    var per = isDate(rp.from) && isDate(rp.to) ? { from: rp.from, to: rp.to } : (isDate(kp.from) && isDate(kp.to) ? { from: kp.from, to: kp.to } : null);
    var locked = k.locked === true;
    var profiles = arr(r.profiles).filter(function (p) { return p && typeof p.staff_id === 'string'; }).map(function (p) {
      return { staff_id: p.staff_id, name: String(p.name || ''), rev: num(p.rev), effective_from: isDate(p.effective_from) ? p.effective_from : null,
        data: obj(p.data), bank_last4: arr(p.bank_last4).filter(function (b) { return b && typeof b === 'object'; }),
        versions: arr(p.versions).filter(function (v) { return v && isDate(v.effective_from); }).map(function (v) { return { effective_from: v.effective_from, rev: num(v.rev), updated_at: v.updated_at || null, updated_by: v.updated_by || null, reason: v.reason || null }; }),
        none: false };
    });
    /* 給与の設定がまだ無いシフトの職員（在籍の人だけ）も並べる。計算・保存には入れない（DB が noprofile で断るため） */
    /* 統合 0107: 名前は勤怠の表示名（無ければシフトの名前）。freee の取り込みの照合のため、シフトの名前（shift_name）も持たせる */
    var shiftNm = {}; arr(r.staff).forEach(function (x) { if (x && typeof x.staff_id === 'string' && typeof x.shift_name === 'string') shiftNm[x.staff_id] = x.shift_name; });
    profiles.forEach(function (p) { p.shift_name = shiftNm[p.staff_id] || ''; });
    var have = {}; profiles.forEach(function (p) { have[p.staff_id] = 1; });
    arr(r.staff).forEach(function (x) {
      if (!x || typeof x.staff_id !== 'string' || have[x.staff_id] || x.active === false) return;
      profiles.push({ staff_id: x.staff_id, name: String(x.name || ''), shift_name: shiftNm[x.staff_id] || '', rev: 0, effective_from: null, data: {}, bank_last4: [], versions: [], none: true });
    });
    return {
      period: per,
      fingerprint: obj(r.fingerprint),
      settings: { config: obj(st.config), rev: num(st.rev) },
      allowances: arr(r.allowances).filter(function (a) { return a && typeof a.code === 'string'; }).map(function (a) {
        return Object.assign({}, obj(a.def), { code: a.code, rev: num(a.rev) });
      }),
      profiles: profiles,
      kintai: { locked: locked, locked_at: k.locked_at || null, period: per, summary_by_staff: attMap(k.summary_by_staff, locked),
        ext_def: obj(obj(k.summary_by_staff).ext).def && typeof obj(k.summary_by_staff).ext.def === 'object' ? obj(k.summary_by_staff).ext.def : null },   /* 段A2: 締めた時の補助項目・記号の組の定義（回数の元の選びの名前） */
      run: r.run && typeof r.run === 'object' ? { status: r.run.status, rev: num(r.run.rev), stale: r.run.stale === true, saved_at: r.run.saved_at || null, saved_by: r.run.saved_by || null,
        confirmed_at: r.run.confirmed_at || null, confirmed_by: r.run.confirmed_by || null, exported_at: r.run.exported_at || null, totals: obj(r.run.totals) } : null,
      items: arr(r.items).filter(function (it) { return it && typeof it.staff_id === 'string'; }).map(flatItem),
      prev_items: arr(r.prev_items).filter(function (it) { return it && typeof it.staff_id === 'string'; })
    };
  }
  function profOf(sid) { var ps = bs ? bs.profiles : []; for (var i = 0; i < ps.length; i++) if (ps[i].staff_id === sid) return ps[i]; return null; }
  function prevOf(sid) { var ps = bs ? bs.prev_items : []; for (var i = 0; i < ps.length; i++) if (ps[i].staff_id === sid) return { gross: num(ps[i].gross), net: num(ps[i].net) }; return null; }
  function savedOf(sid) { var ps = bs ? bs.items : []; for (var i = 0; i < ps.length; i++) if (ps[i].staff_id === sid) return ps[i]; return null; }
  function adjOf(sid) { if (adjEdits[sid]) return adjEdits[sid]; var s = savedOf(sid); return s ? arr(s.adjustments).slice() : []; }
  /* 今見せる行: 確定済みは保存した（凍結した）行、計算した後は計算した行、それ以外は保存した下書き */
  function items() { if (frozen()) return bs.items; if (calc) return calc.items; return bs ? bs.items : []; }
  function bankText(v) {
    if (Array.isArray(v)) return v.map(function (b) { return (b && b.bank_name ? b.bank_name + ' ' : '') + (b && b.last4 ? '＊＊＊' + String(b.last4).replace(/\D/g, '').slice(-4) : ''); }).filter(Boolean).join('／');
    if (v && typeof v === 'object') return bankText([v]);
    return v ? '＊＊＊' + String(v).replace(/\D/g, '').slice(-4) : '';
  }

  /* ── 計算 ── */
  /* 指紋: DB が bootstrap で返した今の値（payroll_fp）に、率と計算の版だけを足す。DB は rates_ver・calc_ver を除いて今の値と比べる */
  function fingerprint() {
    var f = Object.assign({}, bs ? bs.fingerprint : {}, { rates_ver: ratesVer(), calc_ver: calcVer() }), pd = payDate();
    if (isDate(pd)) f.pay_date = pd;   /* 支給日（DB は照合から外して月に控える・統合 0102） */
    return f;
  }
  function computeAll() {
    var c = C(); if (!c || !bs) return null;
    var p0 = period(), pd = payDate(), out = [];
    bs.profiles.forEach(function (p) {
      if (p.none || p.data.exclude === true) return;
      var a = p.data.no_attendance === true ? null : (bs.kintai.summary_by_staff[p.staff_id] || null);
      var input = { ym: ym, period: p0, payDate: pd, settings: cfg(), profile: p.data, allowanceDefs: bs.allowances,
        att: a, adjustments: adjOf(p.staff_id), prevItem: prevOf(p.staff_id),
        profile_rev: p.rev, settings_rev: bs.settings.rev };
      var it;
      try { it = c.computeItem(input); } catch (e) { note('計算', e); it = { lines: [], gross: 0, deduct: 0, net: 0, warnings: [{ code: 'calcerr', msg: '計算できませんでした（設定の形を確かめてください）' }] }; }
      it = Object.assign({}, it, { staff_id: p.staff_id, name: p.name, adjustments: adjOf(p.staff_id), bank_last4: p.bank_last4, pay_date: isDate(pd) ? pd : null });
      if (!bs.kintai.locked) it.warnings = arr(it.warnings).concat([{ code: 'unlocked', msg: '勤怠が未締めです' }]);
      if (a && a.missing.length) it.warnings = arr(it.warnings).concat([{ code: 'att_old', msg: '締めた時の勤怠の控えに無い数字がありました（0として数えています・勤怠を締め直すと入ります）' }]);
      /* 段A2: 明細の勤怠の欄に「うち社内会議」（時間外・休日労働に足した会議の分・表示だけで額は変えない） */
      if (a && a.meetingMin > 0 && arr(it.lines).some(function (l) { return l && l.sec === 'att'; })) it.lines = arr(it.lines).concat([{ sec: 'att', code: 'meetingMin', name: 'うち社内会議（分）', qty: a.meetingMin, unit: null, amount: 0, basis: '時間外・法定休日に足した分' }]);
      /* 段A2（反証レビュー1回の3）: 勤怠の設定で社内会議を時間外に足すのに、控えに補助項目（ext）が無い月分（期間の初日が 2026-12-16 以降） */
      if (a && bs.kcheck && bs.kcheck.extMissing) it.warnings = arr(it.warnings).concat([{ code: 'ext_missing', msg: 'この月分の勤怠の控えに補助項目がありません。勤怠の締めを外して締め直してください' }]);
      out.push(it);
    });
    return out;
  }
  function doCompute() {
    if (frozen()) return;
    var kb = kintaiBlock(); if (kb) { say(kb); return; }
    if (!C()) { toast('計算の部品を読み込めませんでした。ページを読み込み直してください。'); return; }
    var list = computeAll();
    calc = { items: list || [], at: Date.now() };
    calc.fp = fingerprint();
    dirty = true; notice = null;
    paint();
    toast(calc.items.length + '人分を計算しました。確かめてから「下書き保存」を押してください。');
  }
  function figures(list) { return arr(list).map(function (it) { return it.staff_id + ':' + num(it.gross) + ':' + num(it.deduct) + ':' + num(it.net); }).sort().join('|'); }
  function totals(list) {
    var t = { n: 0, gross: 0, deduct: 0, net: 0, warn: 0 };
    arr(list).forEach(function (it) { t.n++; t.gross += num(it.gross); t.deduct += num(it.deduct); t.net += num(it.net); t.warn += arr(it.warnings).length; });
    return t;
  }
  /* 保存する形（統合 0102 の payroll_item_err）: {staff_id, item, adjustments}。item に入れてよい鍵だけを写す（氏名・口座は入れない） */
  var ITEM_KEYS = ['lines', 'gross', 'taxable', 'si_total', 'emp_ins_base', 'tax_base', 'deduct', 'net', 'buckets', 'warnings', 'fingerprint_inputs', 'pay_date'];
  function toSave(it) {
    var o = {};
    ITEM_KEYS.forEach(function (k) { if (it[k] !== undefined) o[k] = it[k]; });
    o.warnings = arr(o.warnings).slice(0, 100).map(function (w) { return { code: String((w && w.code) || 'warn').slice(0, 40), msg: String((w && w.msg) || '').slice(0, 300) }; });
    return { staff_id: it.staff_id, item: o, adjustments: arr(it.adjustments) };
  }

  /* ── 職員の並び（勤怠と同じ入職順・2026-11-20 代表者の指示）──
     勤怠の staffSorted と同じ決まり: 事業所に関係なく、結んだ職員マスタの入職日の古い順。入職日の分からない人は最後に打刻の番号の順。
     有給の設定の入職日の上書きは使わない。入職日は勤怠の職員（kintai_month_get の master_id・code）と職員マスタ（kintai_master_list）から読む。
     読めない時は今の並び（職員ID の順）のまま（画面は止めない）。読んだ並びはメモリにだけ持つ */
  var hireRank = null, hireBusy = false, kintaiCfg0 = null;   /* kintaiCfg0: 段A2・勤怠の設定（手当の回数の元の選びに使う・画面の中だけ） */
  function isYmd(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x); }
  function loadHire() {
    if (hireBusy || !ym) return;
    hireBusy = true;
    Promise.all([rpc('kintai_month_get', { p_ym: ym }), rpc('kintai_master_list')]).then(function (rs) {
      var staff = arr(rs[0] && rs[0].staff), mrows = arr(rs[1] && rs[1].rows), hire = {};
      var s0 = rs[0] && rs[0].settings; kintaiCfg0 = s0 && s0.config && typeof s0.config === 'object' && !Array.isArray(s0.config) ? s0.config : null;   /* 段A2 */
      mrows.forEach(function (m) { if (m && typeof m.master_id === 'string' && isYmd(m.hire_date)) hire[m.master_id] = m.hire_date.slice(0, 10); });
      var list = staff.filter(function (x) { return x && typeof x.staff_id === 'string'; }).map(function (x) { return { sid: x.staff_id, h: x.master_id ? hire[x.master_id] || null : null, code: String(x.code || '') }; });
      list.sort(function (a, b) {
        if (a.h && b.h && a.h !== b.h) return a.h < b.h ? -1 : 1;
        if (!!a.h !== !!b.h) return a.h ? -1 : 1;
        return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
      });
      var rk = {}; list.forEach(function (x, i) { rk[x.sid] = i; });
      hireRank = rk; hireBusy = false;
      if (bs) { orderBs(); if (view === 'app' && !masked) paint(); }
    }, function (e) { hireBusy = false; note('職員の並び', e); });
  }
  /* 勤怠の職員の並びにそろえる（勤怠にいない人は後ろに、元の並びのまま） */
  function orderStaff(list, sidOf) {
    if (!hireRank || !Array.isArray(list)) return list;
    var get = sidOf || function (x) { return x && x.staff_id; };
    var out = list.map(function (x, i) { return { x: x, i: i, r: hireRank[get(x)] }; }).sort(function (a, b) {
      var ra = a.r == null ? Infinity : a.r, rb = b.r == null ? Infinity : b.r;
      return ra !== rb ? (ra < rb ? -1 : 1) : a.i - b.i;
    }).map(function (o) { return o.x; });
    /* 取り込みの表の「見出しから読めた項目」（cols）は並べ直しても残す（入職順を読めた後に消えていた・2026-11-21） */
    if (list.cols) out.cols = list.cols;
    return out;
  }
  function orderBs() {
    if (!bs) return;
    bs.profiles = orderStaff(bs.profiles); bs.items = orderStaff(bs.items);
    if (calc && Array.isArray(calc.items)) calc.items = orderStaff(calc.items);
    if (importRows && Array.isArray(importRows)) importRows = orderStaff(importRows);
  }

  /* ── 読み込み ── */
  function load(keepCalc) {
    var my = ++gen;
    sync('読み込んでいます…');
    if (!bs) paint();
    return rpc('payroll_bootstrap', { p_ym: ym }).then(function (r) {
      if (my !== gen) return null;
      if (r && r.ok === false) { var e = new Error(r.error || 'ng'); e.payroll = r.error; throw e; }
      bs = normBoot(r); loadErr = null;
      orderBs(); if (!hireRank) loadHire();   /* 職員の並びは勤怠と同じ入職順（読めるまでは職員ID の順） */
      bs.kcheck = { state: bs.kintai.locked ? 'checking' : 'skip', names: [] };
      if (!keepCalc) { calc = null; adjEdits = {}; dirty = false; }
      sync(''); paint();
      var b0 = bs;
      return verifyKintai(ym, b0).then(function (k) { if (my === gen && bs === b0) { bs.kcheck = k; paint(); } return bs; });
    }, function (e) {
      if (my !== gen) return null;
      sync('');
      if (e && e.code === '42501' && !isAal(e) && pinRecheck()) return null;   /* 鍵がかかった（0110）か、名簿から外されたかを確かめ直す */
      if ((e && e.code === '42501') || (e && e.payroll === 'denied')) { showGate(isAal(e) ? 'mfa' : 'denied'); return null; }
      if (isAal(e)) { showGate('mfa'); return null; }
      note('読み込み', e);
      loadErr = msgOf(e); bs = null; paint();
      return null;
    });
  }
  function handleStale() {
    notice = { cls: 'warn', text: NG.stale };
    return load(true).then(function (b) {
      if (!b) return;
      if (!frozen() && C()) { calc = { items: computeAll() || [], at: Date.now() }; calc.fp = fingerprint(); dirty = true; }
      paint();
    });
  }
  function fail(e, where) {
    if (e && e.payroll === 'stale') return handleStale();
    if (e && (e.code === '42501') && isAal(e)) { showGate('mfa'); return null; }
    /* 名簿から外された・役割が変わった（42501）: 描いた物を消して覆いに倒す。管理者だけの操作を名簿の人が押した時は知らせだけ */
    if (e && e.code === '42501' && pinRecheck()) return null;   /* 鍵がかかった（0110）か、名簿から外されたかを確かめ直す */
    if (e && e.code === '42501') {
      if (isAdmin() || !/管理者/.test(String(e.message || ''))) { showGate('denied'); return null; }
    }
    if (!(e && e.payroll)) note(where, e);
    say(msgOf(e));
    return null;
  }

  /* ── 下書き保存・確定・取り消し ── */
  function saveDraft(btn) {
    if (!calc || busy || frozen()) return;
    if (!bs.kintai.locked) { say(NG.notlocked); return; }
    if (!calc.items.length) { say('計算した人がいません。「職員の給与設定」を確かめてください。'); return; }
    var kb = kintaiBlock(); if (kb) { say(kb); return; }
    var done = hold(btn, '保存しています…');
    rpc('payroll_run_save', { p_ym: ym, p_items: calc.items.map(toSave), p_fingerprint: calc.fp, p_rev: bs.run ? bs.run.rev : 0 }).then(okOr).then(function () {
      done(); toast('下書きを保存しました。'); return load(false);
    })['catch'](function (e) { done(); return fail(e, '下書き保存'); });
  }
  function changedList() {
    var p0 = period(), out = [];
    bs.profiles.forEach(function (p) { if (p0 && p.effective_from === p0.from) out.push({ name: p.name, what: '給与の設定（' + md(p.effective_from) + 'から）' }); });
    items().forEach(function (it) { arr(it.adjustments).forEach(function (a) { out.push({ name: it.name, what: 'その月だけ：' + (a.name || '') + ' ' + yen(a.amount) + '円（' + (a.reason || '') + '）' }); }); });
    return out;
  }
  /* 確定できない警告（2026-11-21）: 率表・税額表・標準報酬が無い月は保険料・所得税を0円などで数えているので確定させない（最低賃金の未設定のような毎月の警告とは分ける） */
  var BLOCK_WARN = { rate_missing: 1, emp_rate_missing: 1, tax_table_missing: 1, std_missing: 1 };
  function blockWarns(list) { var out = []; list.forEach(function (it) { arr(it.warnings).forEach(function (w) { if (w && BLOCK_WARN[w.code]) out.push(it.name + '：' + (w.msg || w.code)); }); }); return out; }
  function openConfirm() {
    if (busy || !bs || status() !== 'draft' || dirty) return;
    var list = items(), t = totals(list), ch = changedList(), h = '';
    var blk = blockWarns(list);
    var warns = []; list.forEach(function (it) { arr(it.warnings).forEach(function (w) { if (!(w && BLOCK_WARN[w.code])) warns.push(it.name + '：' + (w.msg || w.code)); }); });
    h += '<p>' + esc(periodText()) + 'の給与を確定します。確定すると、この月の明細と書き出しはこの数字で固まります。</p>';
    h += '<div class="kv"><span>人数</span><b>' + esc(t.n) + ' 人</b><span>総支給の合計</span><b>' + esc(yen(t.gross)) + ' 円</b><span>控除の合計</span><b>' + esc(yen(t.deduct)) + ' 円</b><span>差引の合計</span><b>' + esc(yen(t.net)) + ' 円</b><span>支給日</span><b>' + esc(jdate(payDate()) || '（未定）') + '</b></div>';
    if (blk.length) h += '<div class="band ng" role="alert"><b>確定できない警告（' + esc(blk.length) + ' 件）</b><ul>' + blk.map(function (w) { return '<li>⛔ ' + esc(w) + '</li>'; }).join('') +
      '</ul>率表・税額表・標準報酬が足りないので、保険料や所得税を正しく数えられていません。管理者が設定（率表・職員の給与設定）を直してから、計算し直してください。</div>';
    h += '<h3>残っている警告（' + esc(warns.length) + ' 件）</h3>' + (warns.length ? '<ul>' + warns.map(function (w) { return '<li>⚠ ' + esc(w) + '</li>'; }).join('') + '</ul>' : '<p>ありません。</p>');
    h += '<h3>今月変わった設定と調整（' + esc(ch.length) + ' 件）</h3>' + (ch.length ? '<ul>' + ch.map(function (c) { return '<li>' + esc(c.name) + '：' + esc(c.what) + '</li>'; }).join('') + '</ul>' : '<p>ありません。</p>');
    if (warns.length && !blk.length) h += '<p><label><input type="checkbox" id="c-ack"> 警告を確かめました</label></p>';
    h += '<p class="help">「確定する」を押すと、もう一度データベースから読み直して数え直し、この窓の数字と同じ時だけ確定します。</p>';
    openDlg('給与を確定する', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="confirm-go"' + (blk.length ? ' disabled' : '') + '>確定する</button>', { mode: 'confirm', shown: figures(list), warn: warns.length, block: blk.length });
  }
  function confirmGo(btn) {
    if (busy || !dlgCtx || dlgCtx.mode !== 'confirm') return;
    if (dlgCtx.block || blockWarns(items()).length) { say('確定できない警告（率表・税額表・標準報酬が無い月）が残っているので、確定できません。設定を直してから計算し直してください。'); return; }
    if (dlgCtx.warn && !($('c-ack') && $('c-ack').checked)) { say('警告を確かめたら「警告を確かめました」に印を入れてください。'); return; }
    var shown = dlgCtx.shown, done = hold(btn, '確かめています…'), my = gen, yStop = false;
    /* 年末調整の精算を payroll_yearend_check で確かめ、この月分を精算する月分にした確定済みの人に stale・diff があれば確定しない
       （2026-11-23・月分に関係なく毎回・DB の確定の関数は置き換えない）。読み直し → 勤怠の数え直し → 確定 の並びはこの後のまま */
    (YEU() ? YEU().beforeConfirm(yeCtx()) : Promise.resolve(null)).then(function (yng) {
      if (my !== gen) { yStop = true; done(); return null; }
      if (yng) { yStop = true; done(); closeDlg(); notice = { cls: 'ng', text: '確定していません。' + yng }; paint(); return null; }
      return rpc('payroll_bootstrap', { p_ym: ym });
    }).then(function (r) {
      if (yStop) return null;
      if (my !== gen) { done(); return null; }
      if (r && r.ok === false) okOr(r);
      var fresh = normBoot(r), keep = bs;
      return verifyKintai(ym, fresh).then(function (k) {
      if (my !== gen) { done(); return null; }
      fresh.kcheck = k;
      bs = fresh;
      var kb = kintaiBlock();
      if (kb) { done(); closeDlg(); calc = null; dirty = false; notice = { cls: 'ng', text: '確定していません。' + kb }; paint(); return null; }
      var now = C() ? computeAll() : null;
      if (!bs.run || bs.run.status !== 'draft') {
        /* 窓を開いている間に別の人が確定・取り消し・下書きの入れ替えをした。読み直した状態を見せるだけ */
        done(); closeDlg(); if (!bs.run && !keep.run) bs = keep;
        calc = null; adjEdits = {}; dirty = false;
        notice = { cls: 'warn', text: '別の人が先にこの月の給与を確定したか、下書きを変えました。読み直したので、今の状態を確かめてください。' };
        paint(); return null;
      }
      if (!now || figures(now) !== shown || figures(bs.items) !== shown) {
        done(); closeDlg();
        if (now) { calc = { items: now, at: Date.now() }; calc.fp = fingerprint(); dirty = true; }
        notice = { cls: 'warn', text: '読み直したら数字が変わっていました。確定していません。数字を確かめて、下書き保存してからもう一度確定してください。' };
        paint(); return null;
      }
      if (blockWarns(now).length) { done(); closeDlg(); notice = { cls: 'ng', text: '確定していません。確定できない警告（率表・税額表・標準報酬が無い月）が残っています。設定を直してから計算し直してください。' }; paint(); return null; }
      return rpc('payroll_run_confirm', { p_ym: ym, p_rev: bs.run.rev }).then(okOr).then(function () {
        done(); closeDlg(); toast('確定しました。'); return load(false);
      });
      });
    })['catch'](function (e) { done(); closeDlg(); return fail(e, '確定'); });
  }
  function openUnconfirm() {
    if (!isAdmin() || !frozen()) return;
    var ex = status() === 'exported';
    var h = (ex ? '<div class="band ng">⚠ この月はもう振込データを書き出しています。取り消して直しても、銀行へ渡した振込は変わりません。振込の後の直しは、原則として翌月の調整で行ってください。</div>' : '') +
      '<p>確定を取り消すと、下書きに戻り、計算し直せるようになります。取り消したことと理由は記録に残ります。</p><label for="u-reason">理由（必ず書く）</label><br><textarea id="u-reason" rows="3" style="width:100%" maxlength="200"></textarea>';
    openDlg('確定を取り消す（管理者）', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn ng" data-act="unconfirm-go">取り消す</button>', { mode: 'unconfirm' });
  }
  function unconfirmGo(btn) {
    var r = $('u-reason') ? $('u-reason').value.trim() : '';
    if (!r) { say(NG.reason); return; }
    var done = hold(btn, '取り消しています…');
    rpc('payroll_run_unconfirm', { p_ym: ym, p_reason: r }).then(okOr).then(function () { done(); closeDlg(); toast('確定を取り消しました。'); return load(false); })['catch'](function (e) { done(); closeDlg(); return fail(e, '確定の取り消し'); });
  }

  /* ── その月だけの調整 ── */
  var ADJ = [['pay', '支給（課税）'], ['pay_nontax', '支給（非課税）'], ['deduct', '控除'], ['deduct_si', '社会保険料として扱う控除'], ['tax_adjust', '所得税の精算']];
  function adjName(k) { for (var i = 0; i < ADJ.length; i++) if (ADJ[i][0] === k) return ADJ[i][1]; return k; }
  function openAdj(sid) {
    if (frozen()) return;
    var p = profOf(sid); if (!p) return;
    var h = '<p>' + esc(p.name) + ' さんの ' + esc(ymText(ym)) + ' だけの調整を足します（翌月には持ち越しません）。</p>' +
      '<div class="kv"><label for="a-kind">種類</label><select id="a-kind">' + ADJ.map(function (a) { return '<option value="' + esc(a[0]) + '">' + esc(a[1]) + '</option>'; }).join('') + '</select>' +
      '<label for="a-name">名前</label><input id="a-name" maxlength="40" autocomplete="off">' +
      '<label for="a-amt">金額（円・マイナスも可）</label><input id="a-amt" inputmode="numeric" autocomplete="off">' +
      '<label for="a-reason">理由（必ず書く）</label><input id="a-reason" maxlength="200" autocomplete="off"></div>';
    openDlg('その月だけの調整を足す', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="adj-go">足して計算し直す</button>', { mode: 'adj', sid: sid, dirtyCheck: true });
  }
  function adjGo() {
    var sid = dlgCtx && dlgCtx.sid; if (!sid) return;
    var kind = $('a-kind').value, name = $('a-name').value.trim(), amt = $('a-amt').value.replace(/[,，\s円]/g, '').replace(/[−ー－]/g, '-'), reason = $('a-reason').value.trim();
    if (!name) { say('名前を書いてください。'); return; }
    if (!/^-?\d{1,8}$/.test(amt)) { say('金額は円の整数で書いてください（例 5000・-3000）。'); return; }
    if (!reason) { say(NG.reason); return; }
    var list = adjOf(sid).slice(); list.push({ kind: kind, name: name, amount: parseInt(amt, 10), reason: reason });
    adjEdits[sid] = list; openSid = sid; closeDlg(); doCompute();
  }
  function adjDel(sid, i) {
    if (frozen()) return;
    var list = adjOf(sid).slice(); if (!list[i]) return;
    ask('「' + list[i].name + '」の調整を外して計算し直しますか？（下書き保存するまでデータベースは変わりません）').then(function (ok) {
      if (!ok || frozen()) return;
      list.splice(i, 1); adjEdits[sid] = list; openSid = sid; doCompute();
    });
  }

  /* ── 窓 ── */
  function openDlg(title, body, foot, ctx) {
    var d = $('p-dlg');
    $('p-dlg-h').textContent = title; put($('p-dlg-b'), body); put($('p-dlg-f'), foot);
    dlgCtx = ctx || {};
    try { if (!d.open) d.showModal(); } catch (_) { d.setAttribute('open', ''); }
    var f = $('p-dlg-b').querySelector('input,select,textarea'); if (f) f.focus();
    dlgCtx.init = formState();
  }
  function formState() { var s = []; Array.prototype.forEach.call($('p-dlg-b').querySelectorAll('input,select,textarea'), function (e) { s.push(e.type === 'checkbox' ? e.checked : e.value); }); return JSON.stringify(s); }
  function dlgDirty() { return !!(dlgCtx && dlgCtx.dirtyCheck && $('p-dlg').open && formState() !== dlgCtx.init); }
  function closeDlg() { var d = $('p-dlg'); try { d.close(); } catch (_) { d.removeAttribute('open'); } put($('p-dlg-b'), ''); put($('p-dlg-f'), ''); dlgCtx = null; }
  function isDirty() { return dirty || dlgDirty() || !!importRows; }

  /* ── 描く ── */
  function bandsHtml() {
    var h = '';
    if (notice) h += '<div class="band ' + esc(notice.cls) + '" role="status">' + esc(notice.text) + '</div>';
    return h;
  }
  function paint() {
    if (view !== 'app') return;
    var tb = document.querySelectorAll('.tabs [data-tab]');
    for (var i = 0; i < tb.length; i++) {
      var t = tb[i].getAttribute('data-tab');
      if (t === 'settings') tb[i].hidden = !isAdmin();
      tb[i].setAttribute('aria-selected', t === tab ? 'true' : 'false');
      tb[i].tabIndex = t === tab ? 0 : -1;
    }
    $('p-period').textContent = bs ? periodText() : '';
    if (masked) { paintMasked(); return; }
    var h;
    if (tab === 'bonus') h = bonusHtml();   /* 賞与は月の給与の読み込み（bs）と別に読む */
    else if (!bs) h = loadErr ? '<div class="band ng" role="alert">' + esc(loadErr) + '</div><button type="button" class="btn" data-act="reload">もう一度読む</button>' : '<div class="cd" aria-busy="true"><span class="skel w8"></span><span class="skel w6"></span><span class="skel w8"></span><span class="skel w4"></span></div>';
    else if (tab === 'run') h = runHtml();
    else if (tab === 'slip') h = slipTabHtml();
    else if (tab === 'export') h = exportHtml();
    else if (tab === 'profile') h = profileHtml();
    else if (tab === 'yearend') h = YEU() ? YEU().html(yeCtx()) : '<div class="band ng" role="alert">計算の部品が読み込めていません。ページを読み込み直してください。</div>';
    else h = isAdmin() ? settingsHtml() : '';
    put($('p-main'), (tab === 'bonus' ? '' : bandsHtml()) + h);
  }

  function statusText() {
    var s = status(), r = bs.run;
    if (s === 'confirmed') return '<span class="tag ok">✓ 確定済み</span> ' + esc(at(r.confirmed_at));
    if (s === 'exported') return '<span class="tag ok">✓ 確定済み・書き出し済み</span> ' + esc(at(r.exported_at || r.confirmed_at));
    if (s === 'draft') return '<span class="tag warn">下書き</span> 保存 ' + esc(at(r.saved_at));
    return '<span class="tag">まだ計算していません</span>';
  }
  function sumHtml(list) {
    var t = totals(list);
    return '<div class="sumbar"><div>人数<b>' + esc(t.n) + ' 人</b></div><div>総支給の合計<b>' + esc(yen(t.gross)) + ' 円</b></div><div>控除の合計<b>' + esc(yen(t.deduct)) + ' 円</b></div><div>差引の合計<b>' + esc(yen(t.net)) + ' 円</b></div><div>警告<b>' + esc(t.warn) + ' 件</b></div></div>';
  }
  function linesTable(list, title) {
    if (!list.length) return '<p class="help">' + esc(title) + 'はありません。</p>';
    return '<table><caption class="help" style="text-align:left">' + esc(title) + '</caption><thead><tr><th>項目</th><th class="num">数量</th><th class="num">金額（円）</th><th>根拠</th></tr></thead><tbody>' +
      list.map(function (l) { return '<tr><td>' + esc(lineName(l)) + '</td><td class="num">' + esc(qtyText(l)) + '</td><td class="num">' + esc(l.sec === 'att' ? '' : yen(l.amount)) + '</td><td>' + esc(l.basis || '') + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  /* 数量の見せ方: 計算の部品の qty は、勤怠の行と「分÷60」の行は分、それ以外は日数・回数（unit は単価の数なので並べて書かない・単価は根拠に出る） */
  function hm(min) { min = Math.max(0, Math.round(num(min))); var m = min % 60; return Math.floor(min / 60) + ':' + (m < 10 ? '0' : '') + m; }
  function qtyText(l) {
    if (!l || l.qty == null || l.qty === '') return '';
    var c = String(l.code || '');
    if (l.sec === 'att') return /Min$/.test(c) ? hm(l.qty) : String(num(l.qty)) + (/Count$/.test(c) ? '回' : '日');
    if (/分÷60|労働時間×単価/.test(String(l.basis || ''))) return hm(l.qty);
    return String(num(l.qty));
  }
  /* 勤怠の行の名前の「（分）」は、数量を時:分で出すので見せない（保存した名前は変えない） */
  function lineName(l) { return l && l.sec === 'att' && /Min$/.test(String(l.code || '')) ? String(l.name || '').replace('（分）', '') : String((l && l.name) || ''); }
  function bySec(it, sec) { return arr(it.lines).filter(function (l) { return l && l.sec === sec; }); }
  function runHtml() {
    var c = C(), h = '<div class="cd"><h2>' + esc(periodText()) + '</h2><div class="row">';
    h += bs.kintai.locked ? '<span class="tag ok">✓ 勤怠は締めてあります</span>' + esc(at(bs.kintai.locked_at)) : '<span class="tag ng">⚠ 勤怠が未締め</span><span class="help">勤怠管理で締めるまで、計算はできますが保存・確定はできません。</span><a class="btn" href="kintai.html">勤怠管理へ</a>';
    h += '</div><div class="row">状態: ' + statusText() + '</div>';
    if (bs.run && bs.run.stale && !frozen()) h += '<div class="band warn">⚠ 保存した後に勤怠・給与の設定が変わりました。「計算する」で計算し直してください。</div>';
    var kb0 = !frozen() && bs.kcheck && bs.kcheck.state !== 'checking' ? kintaiBlock() : null;
    if (kb0) h += '<div class="band ng" role="alert">⚠ ' + esc(kb0) + '</div>';
    if (!c) h += '<div class="band ng" role="alert">計算の部品を読み込めませんでした。ページを読み込み直してください。</div>';
    if (YEU()) h += YEU().runBand(yeCtx());   /* 年末調整の精算を入れる（精算する月分だけ・2026-11-23） */
    if (dirty && calc) h += '<div class="band warn">計算した結果はまだ保存していません。「下書き保存」を押すまで、ほかの人には見えません。</div>';
    h += '<div class="row">';
    if (!frozen()) {
      h += '<button type="button" class="btn pri" data-act="compute"' + (c ? '' : ' disabled') + '>計算する</button>';
      h += '<button type="button" class="btn" data-act="save"' + (calc && dirty && bs.kintai.locked ? '' : ' disabled') + '>下書き保存</button>';
      h += '<button type="button" class="btn" data-act="confirm"' + (status() === 'draft' && !dirty ? '' : ' disabled') + '>確定する</button>';
    } else if (isAdmin()) h += '<button type="button" class="btn ng" data-act="unconfirm">確定を取り消す（管理者）</button>';
    h += '</div></div>';
    var list = items();
    if (!list.length) return h + '<div class="cd empty">' + (frozen() ? '確定した明細がありません。' : 'まだ計算していません。「計算する」を押してください。') + '</div>';
    h += '<div class="cd">' + sumHtml(list) + '<div class="ihd" aria-hidden="true"><span>氏名</span><span>総支給</span><span>控除</span><span>差引</span><span>前月差</span><span>警告</span></div>';
    list.forEach(function (it) {
      var pv = prevOf(it.staff_id), diff = pv ? num(it.net) - pv.net : null, w = arr(it.warnings);
      h += '<details class="it" data-sid="' + esc(it.staff_id) + '"' + (openSid === it.staff_id ? ' open' : '') + '><summary><span class="nm">' + esc(it.name) + '</span>' +
        '<span class="num" aria-label="総支給" data-l="総支給">' + esc(yen(it.gross)) + '</span><span class="num" aria-label="控除" data-l="控除">' + esc(yen(it.deduct)) + '</span><span class="num" aria-label="差引" data-l="差引"><b>' + esc(yen(it.net)) + '</b></span>' +
        '<span class="num" aria-label="前月差" data-l="前月差">' + esc(diff == null ? '—' : (diff > 0 ? '+' : '') + yen(diff)) + '</span>' +
        (w.length ? '<span class="tag warn">⚠ 警告 ' + esc(w.length) + '</span>' : '<span class="tag ok">✓</span>') + '</summary>';
      if (openSid === it.staff_id) h += itemBody(it);
      h += '</details>';
    });
    return h + '</div>';
  }
  function itemBody(it) {
    var w = arr(it.warnings), a = arr(it.adjustments), h = '<div style="padding:8px 4px">';
    if (w.length) h += '<div class="band warn"><b>警告</b><ul>' + w.map(function (x) { return '<li>⚠ ' + esc(x.msg || x.code) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="split"><div class="tw">' + linesTable(bySec(it, 'pay'), '支給') + '</div><div class="tw">' + linesTable(bySec(it, 'deduct'), '控除') + '</div></div>';
    h += '<div class="tw">' + linesTable(bySec(it, 'att'), '勤怠の根拠') + '</div>';
    h += '<h3 style="font-size:16px">その月だけの調整</h3>';
    h += a.length ? '<ul>' + a.map(function (x, i) { return '<li>' + esc(adjName(x.kind)) + '：' + esc(x.name) + ' ' + esc(yen(x.amount)) + ' 円（理由: ' + esc(x.reason) + '）' + (frozen() ? '' : ' <button type="button" class="btn" data-act="adj-del" data-sid="' + esc(it.staff_id) + '" data-i="' + esc(i) + '">外す</button>') + '</li>'; }).join('') + '</ul>' : '<p class="help">ありません。</p>';
    if (!frozen()) h += '<button type="button" class="btn" data-act="adj" data-sid="' + esc(it.staff_id) + '">＋ その月だけの調整を足す</button>';
    return h + '</div>';
  }

  /* ── 給与明細 ── */
  function slipHtml(it, paper) {
    var p = profOf(it.staff_id), draft = !frozen();
    var att = bySec(it, 'att'), pay = bySec(it, 'pay'), ded = bySec(it, 'deduct');
    function tbl(list, cap, money) {
      return '<table><thead><tr><th colspan="2">' + esc(cap) + '</th></tr></thead><tbody>' + (list.length ? list.map(function (l) { return '<tr><td>' + esc(lineName(l)) + '</td><td class="num">' + esc(money ? yen(l.amount) : qtyText(l)) + '</td></tr>'; }).join('') : '<tr><td colspan="2">—</td></tr>') + '</tbody></table>';
    }
    var bank = bankText(it.bank_last4 != null ? it.bank_last4 : (p && p.bank_last4));
    return '<section class="slip"' + (paper ? '' : ' aria-label="給与明細の見本"') + '><div class="su-print-head-host"><h3>給与明細　' + esc(ymText(ym)) + (draft ? '<span class="sl-draft">下書き（確定前）</span>' : '') + '</h3>' +
      '<span class="su-print-head su-print-head-abs" data-su-print-head="name date"></span></div>' +
      '<p class="sl-meta">' + esc(corpName()) + '　期間 ' + esc(period() ? md(period().from) + '〜' + md(period().to) : '') + '　支給日 ' + esc(jdate(payDate())) + '</p>' +
      '<p class="sl-meta"><b style="font-size:1.2em">' + esc(it.name) + '</b> 様</p>' +
      '<div class="sl-grid"><div>' + tbl(att, '勤怠', false) + '</div><div>' + tbl(pay, '支給', true) + '</div><div>' + tbl(ded, '控除', true) + '</div><div><table class="sl-tot"><tbody>' +
      '<tr><td>総支給額</td><td class="num">' + esc(yen(it.gross)) + '</td></tr><tr><td>控除の合計</td><td class="num">' + esc(yen(it.deduct)) + '</td></tr><tr><td>差引支給額</td><td class="num">' + esc(yen(it.net)) + '</td></tr>' +
      '<tr><td>振込先</td><td>' + esc(bank || '（口座なし）') + '</td></tr></tbody></table></div></div></section>';
  }
  function slipTabHtml() {
    var list = items();
    if (!list.length) return '<div class="cd empty">この月分の明細はまだありません。「今月の給与」で計算してください。</div>';
    if (!slipSid || !list.some(function (it) { return it.staff_id === slipSid; })) slipSid = list[0].staff_id;
    var cur = list.filter(function (it) { return it.staff_id === slipSid; })[0];
    var h = '<div class="cd"><h2>給与明細（' + esc(periodText()) + '）</h2>';
    if (!frozen()) h += '<div class="band warn">⚠ まだ確定していません。紙にも「下書き（確定前）」と出ます。</div>';
    h += '<div class="row"><label for="s-who">職員</label><select id="s-who">' + list.map(function (it) { return '<option value="' + esc(it.staff_id) + '"' + (it.staff_id === slipSid ? ' selected' : '') + '>' + esc(it.name) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn" data-act="print-one">この人の明細を印刷</button><button type="button" class="btn pri" data-act="print-all">全員分を印刷（' + esc(list.length) + '枚）</button></div>' +
      '<p class="help">A4 縦・1人1枚。口座は下4桁だけを刷ります。印刷したことは記録に残ります。</p></div>';
    return h + slipHtml(cur, false);
  }
  function doPrint(list) {
    if (!list || !list.length) return;
    if (!window.SUPrint) { toast('印刷の部品を読み込めていません。ページを読み込み直してください。'); return; }
    var go = function () {
      printList = list;
      try { window.SUPrint.print('slips'); } catch (e) { note('明細の印刷', e); }
      if (!document.body.classList.contains('su-printing')) printList = null;
    };
    rpc('payroll_export_log', { p_ym: ym, p_kind: 'payslip' }).then(okOr).then(function () {
      if (!window.SUPrint.facGate) { go(); return; }
      window.SUPrint.facGate(go, function (msg) { toast(msg); });
    })['catch'](function (e) { fail(e, '印刷の記録'); });
  }
  function definePrint() {
    if (!window.SUPrint || definePrint.done) return;
    definePrint.done = true;
    window.SUPrint.define('slips', { label: '給与明細', paper: 'A4 portrait', margin: 12, root: '#p-print', allowUser: [],
      when: function () { return !!printList && view === 'app' && !masked; },
      pagesOf: function () { return printList ? printList.length : 1; },
      before: function () { put($('p-print'), (printList || []).map(function (it) { return slipHtml(it, true); }).join('')); },
      after: function () { put($('p-print'), ''); printList = null; } });
    /* 源泉徴収票（年末調整のタブ・A4 に2人分。紙の中身は PayrollWithholdingSlip.slipHtml） */
    window.SUPrint.define('ye-slips', { label: '源泉徴収票', paper: 'A4 portrait', margin: 10, root: '#p-print', allowUser: [],
      when: function () { return !!yePrint && view === 'app' && !masked; },
      pagesOf: function () { return yePrint ? yePrint.pages : 1; },
      before: function () { put($('p-print'), yePrint ? yePrint.html : ''); },
      after: function () { put($('p-print'), ''); yePrint = null; } });
    window.SUPrint.setActive(null);
  }

  function printYe(html, pages) {
    if (!html) return;
    if (!window.SUPrint) { toast('印刷の部品を読み込めていません。ページを読み込み直してください。'); return; }
    var go = function () {
      yePrint = { html: html, pages: Math.max(1, pages || 1) };
      try { window.SUPrint.print('ye-slips'); } catch (e) { note('源泉徴収票の印刷', e); }
      if (!document.body.classList.contains('su-printing')) yePrint = null;
    };
    if (!window.SUPrint.facGate) { go(); return; }
    window.SUPrint.facGate(go, function (msg) { toast(msg); });
  }

  /* ── 年末調整のタブ（payroll-yearend-ui.js）への受け渡し（2026-11-23）。ここは今ある関数を渡すだけで、計算・保存の流れは変えない ── */
  function YEU() { var u = window.PayrollYearEndUI; return u && typeof u.html === 'function' ? u : null; }
  function yeReset() { try { if (YEU()) YEU().reset(); } catch (e) { note('年末調整を捨てる', e); } }
  function yeCtx() {
    return { rpc: rpc, esc: esc, yen: yen, bs: bs, calc: calc, items: bs ? items() : [], ym: ym, paint: paint, toast: toast, openDlg: openDlg, closeDlg: closeDlg, isAdmin: isAdmin, note: note,
      parseCsv: parseCsv, decode: decode, put: put, say: say, ask: ask, fail: fail, noDb: noDb, download: download,
      frozen: !!bs && frozen(), runRev: bs && bs.run ? bs.run.rev : 0, payDate: bs ? payDate() : '', corpName: corpName(),
      adjOf: adjOf, setAdj: function (sid, list) { if (!frozen()) adjEdits[sid] = list; }, compute: doCompute, printSlips: printYe };
  }

  /* ── 振込と書き出し ── */
  function bankOf(it) { var p = profOf(it.staff_id), b = it.bank_last4 != null ? it.bank_last4 : (p && p.bank_last4); return arr(b); }
  function hasBank(it) { return bankOf(it).length > 0; }
  /* 振込の件数は全銀のデータの件数（口座を分けた人は口座ごとに1件）。要約の amount_or_rest に書き出しと同じ分け方（PayrollExport.splitAccounts）を当てる */
  function transferParts(it) {
    var x = X(), b = bankOf(it);
    if (!b.length || !(num(it.net) > 0)) return 0;
    try { return x && typeof x.splitAccounts === 'function' ? x.splitAccounts(num(it.net), b).parts.length : 1; } catch (e) { note('振込の件数', e); return 1; }
  }
  var zcheck0 = { count: 0, total: 0 };
  /* 画面の振込する分（差引が0より大きく口座がある人の差引の和と、口座ごとの件数） */
  function transferWant() { var w = { total: 0, parts: 0 }; items().forEach(function (it) { var n = transferParts(it); if (n > 0) { w.total += num(it.net); w.parts += n; } }); return w; }
  function exportHtml() {
    var list = items(), x = X(), h = '<div class="cd"><h2>振込と書き出し（' + esc(periodText()) + '）</h2>';
    if (!frozen()) return h + '<div class="band warn">確定した月だけ書き出せます。「今月の給与」で確定してから開いてください。</div></div>';
    if (!x) h += '<div class="band ng" role="alert">書き出しの部品を読み込めませんでした。ページを読み込み直してください。</div>';
    var t = totals(list), tr = 0, trn = 0, trp = 0, cash = [];
    list.forEach(function (it) { var n = transferParts(it); if (n > 0) { tr += num(it.net); trn++; trp += n; } else cash.push(it); });
    h += '<h3 style="font-size:16px">総額の照合</h3><div class="tw"><table><tbody>' +
      '<tr><th>差引の合計（' + esc(t.n) + '人）</th><td class="num">' + esc(yen(t.net)) + ' 円</td></tr>' +
      '<tr><th>振込する分（口座あり・差引が0より大きい ' + esc(trn) + '人・振込 ' + esc(trp) + '件）</th><td class="num">' + esc(yen(tr)) + ' 円</td></tr>' +
      '<tr><th>振込しない分（口座なし・差引0以下 ' + esc(cash.length) + '人）</th><td class="num">' + esc(yen(t.net - tr)) + ' 円' + (cash.length ? '<br><span class="help">' + esc(cash.map(function (c) { return c.name; }).join('、')) + '</span>' : '') + '</td></tr>';
    if (zcheck && zcheck.ym === ym) h += '<tr><th>全銀ファイルの合計（' + esc(zcheck.count) + '件）</th><td class="num">' + esc(yen(zcheck.total)) + ' 円 ' + (zcheck.total === tr && zcheck.count === trp ? '<span class="tag ok">✓ 振込する分と一致</span>' : '<span class="tag ng">⚠ 振込する分と合いません。ファイルを使わず管理者に知らせてください</span>') + '</td></tr>';
    h += '</tbody></table></div>';
    h += '<h3 style="font-size:16px">書き出す</h3><div class="row">';
    if (zenginOn()) h += '<button type="button" class="btn pri" data-act="exp" data-k="zengin"' + (x ? '' : ' disabled') + '>振込データ（全銀形式）</button>';
    if (YEU()) h += YEU().exportBadge(yeCtx());   /* この月分を freee と比べて差があった時の印（止めない・2026-11-23） */
    h += '<button type="button" class="btn" data-act="exp" data-k="journal"' + (x ? '' : ' disabled') + '>仕訳の CSV</button>' +
      '<button type="button" class="btn" data-act="exp" data-k="ledger"' + (x ? '' : ' disabled') + '>賃金台帳の CSV</button>' +
      '<button type="button" class="btn" data-act="exp" data-k="list"' + (x ? '' : ' disabled') + '>明細一覧の CSV</button></div>';
    if (!zenginOn()) h += '<p class="help">振込データ（全銀形式）は、管理者が「設定」の「振込データ（全銀形式）の書き出しを使う」に印を入れるまで出しません。</p>';
    h += '<div class="band warn"><b>書き出したファイルの扱い</b><ul><li>ファイルはこのパソコンの「ダウンロード」フォルダに入ります。氏名と金額（振込データは口座の番号も）が入っています。</li>' +
      '<li>銀行・会計ソフトに取り込んだら、Finder の「ダウンロード」でそのファイルを選び、ごみ箱へ入れて「ごみ箱を空にする」まで行ってください。</li>' +
      '<li>メール・チャット・共有のフォルダには入れないでください。書き出したことは記録に残ります。</li></ul></div></div>';
    return h;
  }
  var EXP = { zengin: '振込データ', journal: '仕訳の CSV', ledger: '賃金台帳の CSV', list: '明細一覧の CSV' };
  /* 記録（payroll_export_log）の種類の名前は統合 0102 の決まり（zengin・journal・ledger・payslip・csv） */
  var EXP_LOG = { zengin: 'zengin', journal: 'journal', ledger: 'ledger', list: 'csv' };
  function download(res) {
    var blob = res.bytes ? new Blob([res.bytes], { type: 'text/plain' }) : new Blob(['﻿' + String(res.text || '')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = String(res.name || 'payroll.csv').replace(/[^\w.-]/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
  }
  /* 書き出しの知らせの1行（どの職員か＝明細の表示名を添える・2026-11-21） */
  var EXP_WHERE = { name: '口座の名義', bank_name: '銀行名', branch_name: '支店名', number: '口座番号', bank_code: '銀行コード', branch_code: '支店コード', type: '預金種目' };
  function expMsg(e) {
    if (!e || !e.msg) return '';
    var f = /^record\d+\.(\w+)$/.exec(String(e.where || '')), w = f && EXP_WHERE[f[1]] ? EXP_WHERE[f[1]] + '：' : '';
    return (e.who ? e.who + ' さん：' : '') + w + e.msg;
  }
  function exportGo(kind, btn) {
    var x = X();
    if (busy || !frozen() || !x || !EXP[kind] || typeof x[kind] !== 'function') return;
    if (kind === 'zengin' && !zenginOn()) return;
    /* 書き出しの設定: 振込元（bank_from）・全銀の種別と文字コード（zengin）・仕訳の科目（journal）は今の設定（賃金の中身ではないため）。
       明細の金額・期間・支給日・事業者名は確定の写しのまま（period()・payDate()・paperCfg()） */
    var base = { ym: ym, period: period(), payDate: payDate(), settings: Object.assign({}, cfg(), { company_name: paperCfg().company_name }), items: items(), profiles: bs.profiles };
    /* 振込元の設定の不備は、口座の全桁を受け取る前（月が書き出し済みになる前）に止める */
    if (kind === 'zengin') {
      var pre = x.zengin(Object.assign({}, base, { rows: [] }));
      if (!pre || pre.ok === false) {
        var w0 = arr(pre && pre.errors).slice(0, 5).map(function (e) { return (e && e.msg) || ''; }).filter(Boolean);
        say('振込元の設定に足りない所があるので、振込データを作りません。' + (w0.length ? '\n' + w0.join('\n') : '') + '\n管理者が「設定」の振込元を直してください。');
        return;
      }
    }
    /* 書き出し済みの月の振込データをもう一度作る時は、二重に振り込まないよう確かめ、確かめたことを記録してから受け取る（統合 0118・文は仮置き 2026-11-21） */
    /* 前に書き出した月（確定を取り消して確定し直した月も・exported_at が残る）は確かめる（反証レビュー 2026-11-21） */
    var again = kind === 'zengin' && (status() === 'exported' || !!(bs.run && bs.run.exported_at));
    if (again) busy = true;   /* 確かめの窓の間に2回押されない */
    (again ? ask('この月の振込データは ' + at(bs.run && bs.run.exported_at) + ' にもう書き出しています。\n銀行へもう渡していれば、もう一度渡すと二重に振り込まれます。\n前のファイルを作れなかった・なくした時だけ、もう一度作ってください。\nもう一度書き出しますか？') : Promise.resolve(true)).then(function (go) {
    busy = false;
    if (!go) return;
    var done = hold(btn, '作っています…');
    rpc('payroll_export_log', { p_ym: ym, p_kind: again ? 'zengin_again' : EXP_LOG[kind] }).then(okOr).then(function () {
      if (kind !== 'zengin') return x[kind](base);
      return rpc('payroll_bank_export', { p_ym: ym }).then(function (r) {
        /* 確定の後に口座が直された（stale）は、計算し直しの stale と別の知らせにする */
        if (r && r.ok === false && r.error === 'stale') { var e = new Error('bankstale'); e.payroll = 'bankstale'; throw e; }
        if (r && r.ok === false && r.error === 'zengin_off') { var e2 = new Error('zengin_off'); e2.payroll = 'zengin_off'; throw e2; }
        /* 画面が古い（別のタブ・別の人が先に書き出した・前の応答が届かなかった）: 読み直して、次に押すと確かめの窓が出るようにする（反証レビュー 2026-11-21） */
        if (r && r.ok === false && r.error === 'exported') { done(); say(NG.exported); return load(true).then(function () { return null; }); }
        return okOr(r);
      }).then(function (r) {
        if (!r) return null;   /* exported で断って読み直した（知らせは出した） */
        var res = x.zengin(Object.assign({}, base, { rows: arr(r.rows) }));
        r.rows = null; r = null;
        zcheck = res.ok ? { ym: ym, count: num(res.count), total: num(res.total) } : null;
        zcheck0 = { count: num(res.count), total: num(res.total) };
        return res;
      });
    }).then(function (res) {
      done();
      if (!res) return;
      var ws = arr(res.warnings).map(expMsg).filter(Boolean);   /* 書き出しの知らせ（下で出す） */
      if (res.ok !== false && kind === 'zengin') {
        var want = transferWant();
        if (num(res.total) !== want.total || num(res.count) !== want.parts) {
          res = null; zcheck = null;
          say('振込データの合計（' + yen(zcheck0.total) + '円・' + zcheck0.count + '件）が、画面の振込する分（' + yen(want.total) + '円・' + want.parts + '件）と合いません。ファイルは作っていません。管理者に知らせてください。');
          return load(true);
        }
      }
      if (res.ok === false) {
        var why = arr(res.errors).slice(0, 5).map(expMsg).filter(Boolean);
        res = null;
        say(EXP[kind] + 'を作れませんでした（ファイルは作っていません）。' + (why.length ? '\n' + why.join('\n') : '') + '\n設定（振込元・仕訳の科目）と口座を確かめてください。');
        return load(true);
      }
      download(res); res = null;
      toast(EXP[kind] + 'を書き出しました。使い終わったら消してください。');
      /* 書き出しの知らせ（名義などを桁で切った所）。ファイルは作ったので、確かめてもらう所だけを出す（2026-11-21） */
      if (ws.length) say(EXP[kind] + 'を書き出しました。次の所を確かめてください（' + ws.length + ' 件）。\n' + ws.slice(0, 10).join('\n') + (ws.length > 10 ? '\nほか ' + (ws.length - 10) + ' 件' : ''));
      return load(true);
    })['catch'](function (e) { done(); fail(e, '書き出し'); });
    });
  }

  /* ── 賞与（2026-11-23 足した・賞与の計算 v1 §4・統合 0121・文言と位置は仮置き）──
     ・回の一覧 →「新しい賞与」→ 回を開く: 1人ずつの賞与額・前月の給与・計算の結果・警告 → 下書き保存 → 確定 → 明細の印刷・振込データ（全銀 種別12）・賞与支払届に写す値の CSV
     ・月の給与の状態（bs・calc・ym）とは別に持ち、月の給与の関数（items・frozen・payDate・slipHtml・fail の stale）は呼ばない
     ・計算は PayrollCalc.computeBonus。保存は 0121 の payroll_bonus_item_err が許す鍵だけに写す（bonusToSave）
     ・前月の給与は DB の自社の確定した明細（bootstrap の prev）＞ 年末調整の記録（payroll_ytd_get・無い DB では黙って飛ばす）＞ 手入力。
       DB の確定は「自社の明細の P が無いのに prev_manual が無い」を自分で止めるので、記録から取った P も prev_manual に入れて送る
     ・関数の無い DB（0121 の前）では「賞与はまだ使えません（データベースの準備中）」と出して何もしない
     ・端末に残すのはタブ（payroll_tab の 'bonus'）だけ。金額・氏名は残さない */
  var bb = null, bErr = null, bNoDb = false, bSel = null, bIn = {}, bCfgIn = null, bCalc = null, bDirty = false, bCfgDirty = false, bGen = 0, bLoading = false;
  var bYtd = null, bNotice = null, bPrint = null, bSlipSid = null, bCfgOpen = false;
  /* freee と比べた結果（bCmp）と、確定した明細を年末調整の累計へ入れた結果（bYtdPut）。どちらも画面のメモリの中だけ（端末にもファイルにも残さない・2026-11-23） */
  var bCmp = null, bYtdPut = null, bYtdPending = null, BONUS_CMP_MAX = 2 * 1024 * 1024;   /* bYtdPending: 確定の直後に累計へ入れている回（その間は開いた時の確かめをしない） */
  /* 年末調整の記録の答え（届いた・失敗・無い）が決まるまで「下書き保存」「確定」を押させない（記録が届く前に保存すると、その人が前月の給与なしで数えられるため） */
  var bYtdWait = false, BONUS_YTD_MS = 10000;   /* 記録の答えを待つのは10秒まで（過ぎたら読めなかった扱いで解く・仮置き） */
  var bCfgBase = null, bCfgConflict = false;   /* 回の設定の欄を作った時の DB の値（読み直しで、ほかの人の変更と人の直しがぶつかったかを見る） */
  /* 関数の無い DB: PostgREST の「関数が見つからない」（PGRST202）・Postgres の 42883、表の無い DB（42P01・PGRST205） */
  function bonusNoDb(e) { var c = e && e.code; return c === '42883' || c === 'PGRST202' || c === '42P01' || c === 'PGRST205'; }
  var BNG = {
    stale: '計算した後に給与の設定・手当・前月の給与・ほかの賞与の回のどれかが変わりました。読み直したので「計算する」で計算し直し、下書き保存からやり直してください。',
    conflict: '別の人が先に保存しました。読み直してから、もう一度行ってください。',
    confirmed: 'この賞与はもう確定しています。直す時は、管理者が確定を取り消してください。',
    notconfirmed: 'この賞与はまだ確定していません。確定してから書き出してください。',
    norun: 'この賞与の回が見つかりません。読み直してください。',
    badshape: '送った値の形が違いました。読み直してください。',
    baddate: '支給日の形が違います。',
    badsum: '保存した明細の合計が合いません。「計算する」で計算し直して、下書き保存からやり直してください。',
    empty: '明細がありません。賞与額を入れて計算し、下書き保存してから確定してください。',
    toobig: '送る量が大きすぎます。',
    noprofile: '給与の設定が無い職員が入っています。「職員の給与設定」で設定してから、計算し直してください。',
    nostaff: 'シフトの職員に見つからない人です。読み直してください。',
    full: '同じ支給日の賞与の回は9回までです。',
    order: '同じ年度に、この回より後の支給日の賞与がもう確定しています。先に後の回の確定を取り消してください。',
    cfgconflict: '回の設定がほかの人に変えられました。読み直してください（入れかけの回の設定は捨てます）。',
    blockwarn: '確定できない警告（前月の給与・率表・税額表・雇用保険の率・給与の設定）が残っているので、確定できません。直してから計算し直してください。',
    reason: '理由を書いてください。',
    exported: 'この賞与の振込データはもう書き出していました。読み直したので、もう一度作る時は「振込データ」をもう一度押し、出てくる確かめの窓で「OK」を押してください（確かめてから10分以内）。',
    notexported: 'この賞与の振込データはまだ書き出していません。読み直してください。',
    zengin_off: '振込データ（全銀形式）の書き出しは、管理者が「設定」で使うようにするまで使えません。',
    bankstale: '確定した後に振込先の口座が直されました。振込データは作りません。管理者が確定を取り消して、確かめ直してから確定し直してください。'
  };
  var BONUS_STATUS = { draft: '下書き', confirmed: '確定済み', exported: '確定済み・書き出し済み' };
  function bonusMsg(e) { return e && e.payroll ? (BNG[e.payroll] || 'うまくいきませんでした（' + e.payroll + '）。') : friendly(e); }
  /* 賞与の断りは先にここで受け、権限（42501）と二段階のログインだけを月の給与と同じ fail に渡す（fail の stale は月の給与を読み直すため渡さない） */
  function bonusFail(e, where) {
    if (e && e.payroll === 'stale') { bNotice = { cls: 'warn', text: BNG.stale }; return bonusLoad(true); }
    if (e && e.code === '42501') return fail(e, where);
    if (isAal(e)) return fail(e, where);
    if (bonusNoDb(e)) { bNoDb = true; bb = null; paint(); return null; }
    if (!(e && e.payroll)) note(where, e);
    say(bonusMsg(e));
    return null;
  }
  function bonusDirty() { return bDirty || bCfgDirty; }
  function bonusClear() { bb = null; bCalc = null; bIn = {}; bCfgIn = null; bDirty = false; bCfgDirty = false; bPrint = null; bYtd = null; bNotice = null; bSlipSid = null; bYtdWait = false; bCfgBase = null; bCfgConflict = false; bCmp = null; bYtdPut = null; bYtdPending = null; }
  /* 受け取った形を確かめる（壊れた値で画面を止めない）。形は統合 0121 の payroll_bonus_bootstrap */
  function bonusNorm(r) {
    r = obj(r);
    var st = obj(r.settings), run = r.run && typeof r.run === 'object' ? r.run : null, pv = obj(r.prev), ctx = obj(r.ctx);
    var nmap = {}, act = [], inact = []; arr(r.staff).forEach(function (x) { if (x && typeof x.staff_id === 'string') { nmap[x.staff_id] = String(x.name || ''); if (x.active !== false) act.push(x.staff_id); else inact.push(x.staff_id); } });
    var idOk = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}#[1-9]$/.test(v); };
    var numMap = function (m) { var o = {}; m = obj(m); Object.keys(m).forEach(function (k) { var n = Number(m[k]); if (isFinite(n)) o[k] = n; }); return o; };
    var pitems = {}; obj(pv.items) && Object.keys(obj(pv.items)).forEach(function (k) { var x = obj(pv.items[k]); pitems[k] = { gross: typeof x.gross === 'number' ? x.gross : null, P: typeof x.P === 'number' && isFinite(x.P) ? x.P : null }; });
    var out = {
      runs: arr(r.runs).filter(function (x) { return x && idOk(x.bonus_id); }).map(function (x) {
        return { bonus_id: x.bonus_id, pay_date: isDate(x.pay_date) ? x.pay_date : x.bonus_id.slice(0, 10), title: String(x.title || ''), status: BONUS_STATUS[x.status] ? x.status : 'draft',
          rev: num(x.rev), count: num(x.count), gross: num(x.gross), stale: x.stale === true };
      }),
      settings: { config: obj(st.config), rev: num(st.rev) },
      allowances: arr(r.allowances).filter(function (a) { return a && typeof a.code === 'string'; }).map(function (a) { return Object.assign({}, obj(a.def), { code: a.code, rev: num(a.rev) }); }),
      names: nmap, active: act, inactive: inact,
      run: run && idOk(run.bonus_id) ? { bonus_id: run.bonus_id, pay_date: isDate(run.pay_date) ? run.pay_date : run.bonus_id.slice(0, 10), title: String(run.title || ''),
        status: BONUS_STATUS[run.status] ? run.status : 'draft', rev: num(run.rev), config: obj(run.config), totals: obj(run.totals), stale: run.stale === true,
        saved_at: run.saved_at || null, confirmed_at: run.confirmed_at || null, exported_at: run.exported_at || null } : null,
      profiles: arr(r.profiles).filter(function (p) { return p && typeof p.staff_id === 'string'; }).map(function (p) {
        return { staff_id: p.staff_id, name: String(p.name || nmap[p.staff_id] || ''), rev: num(p.rev), data: obj(p.data), bank_last4: arr(p.bank_last4).filter(function (b) { return b && typeof b === 'object'; }) };
      }),
      items: arr(r.items).filter(function (x) { return x && typeof x.staff_id === 'string' && x.item && typeof x.item === 'object'; }).map(function (x) {
        var it = Object.assign({}, x.item), fr = obj(x.frozen);
        it.staff_id = x.staff_id; it.name = String(x.name || nmap[x.staff_id] || ''); it.lines = arr(it.lines); it.warns = arr(it.warns);
        it.std = obj(it.std); it.ins = obj(it.ins);
        it.prev_manual = x.prev_manual && typeof x.prev_manual === 'object' ? x.prev_manual : null;
        ['gross', 'deduct', 'net', 'social', 'tax'].forEach(function (k) { if (x[k] != null) it[k] = num(x[k]); });
        if (Array.isArray(fr.bank_last4)) it.bank_last4 = fr.bank_last4.filter(function (b) { return b && typeof b === 'object'; });
        if (fr.company_name) it.company_name = String(fr.company_name);
        return it;
      }),
      prev: { state: pv.state === 'ok' || pv.state === 'draft' ? pv.state : 'none', ym: isYm(pv.ym) ? pv.ym : null, items: pitems },
      ctx: { fy_std: numMap(ctx.fy_std), month_std: numMap(ctx.month_std), count_12m: numMap(ctx.count_12m) },
      fingerprint: typeof r.fingerprint === 'string' ? r.fingerprint : null
    };
    /* 確定を取り消した下書きにも DB は確定の時の写し（口座の下4桁・事業者名）を返す（0121 は写しを消さない）。下書きの間は今の値を使う */
    if (!out.run || (out.run.status !== 'confirmed' && out.run.status !== 'exported')) out.items.forEach(function (it) { delete it.bank_last4; delete it.company_name; });
    return out;
  }
  /* 年末調整の記録（payroll_ytd_get・統合 0122 の設計 ROOT-yearend.md A の形・実物はまだ無い＝形は防御的に確かめる）から、
     前月の給与の P・この年度に他所で払った標準賞与額・過去12か月の他所の回の数を人ごとに作る（純関数）
       P: 支給日の前の暦月に払った kind 'salary' の行（いちばん遅い1行）の taxable −（si_health＋si_care＋si_support＋si_pension＋si_emp＋si_other）。
          taxable が数でない行は使わない（0 として「前月なし」に落とさない）。社保の鍵が無ければ 0（設計の「無い鍵は 0 扱い」）
       fy: 同じ年度（4/1〜）で支給日より前の kind 'bonus'・source が app でない行の gross の千円未満切り捨ての和
       cnt: 支給日の12か月前の日より後〜支給日より前の、kind 'bonus'・source が app でない・gross が1円以上の行の数（仮置き） */
  function bonusYtd(rows, payDate) {
    var out = { P: {}, fy: {}, cnt: {} };
    if (!isDate(payDate)) return out;
    var pm = shiftYm(payDate.slice(0, 7), -1), y = +payDate.slice(0, 4), m = +payDate.slice(5, 7);
    var fyFrom = (m >= 4 ? y : y - 1) + '-04-01', from12 = (y - 1) + payDate.slice(4);
    var latest = {};
    var yen0 = function (v) { return typeof v === 'number' && isFinite(v) ? v : (v == null ? 0 : NaN); };
    arr(rows).forEach(function (r) {
      if (!r || typeof r.staff_id !== 'string' || !isDate(r.pay_date)) return;
      var d = obj(r.data), sid = r.staff_id;
      if (r.kind === 'salary' && r.pay_date.slice(0, 7) === pm) {
        if (typeof d.taxable !== 'number' || !isFinite(d.taxable)) return;
        var si = ['si_health', 'si_care', 'si_support', 'si_pension', 'si_emp', 'si_other'].reduce(function (a, k) { return a + yen0(d[k]); }, 0);
        if (!isFinite(si)) return;
        if (!latest[sid] || r.pay_date > latest[sid]) { latest[sid] = r.pay_date; out.P[sid] = Math.floor(d.taxable - si); }
      } else if (r.kind === 'bonus' && r.source !== 'app' && typeof d.gross === 'number' && isFinite(d.gross) && r.pay_date < payDate) {
        if (r.pay_date >= fyFrom) out.fy[sid] = (out.fy[sid] || 0) + Math.max(0, Math.floor(d.gross / 1000) * 1000);
        if (r.pay_date > from12 && d.gross > 0) out.cnt[sid] = (out.cnt[sid] || 0) + 1;
      }
    });
    return out;
  }
  /* 前月の給与の決め方（設計 §2-8・追記）: 自社の確定した明細（db）＞ 年末調整の記録（ytd）＞ 手入力（manual・「前月なし」は none）。純関数。
     返す: { kind（computeBonus の prev.kind）, P, manualP, send（保存する prev_manual・無ければ null）, prev_kind（保存する item の prev_kind・0121 の集合）, src, dbBlock（DB が確定で止める印） }
     manual: { none:true, source } か { P:数, source } か null（入っていない・形が違う） */
  function bonusPrevOf(prev, sid, manual, ytdP) {
    prev = obj(prev);
    var m = manual && typeof manual === 'object' ? manual : null, mP = m && !m.none && typeof m.P === 'number' && isFinite(m.P) ? Math.floor(m.P) : null;
    var src = m && m.source ? String(m.source).slice(0, 20) : null;
    var mSend = m ? (m.none ? { P: null, none: true, source: src } : (mP !== null ? { P: mP, none: false, source: src } : null)) : null;
    if (prev.state === 'draft') return { kind: 'unconfirmed', P: null, manualP: mP, send: mSend, prev_kind: 'unconfirmed', src: 'unconfirmed', dbBlock: 'prev_unconfirmed' };
    var di = prev.state === 'ok' ? obj(obj(prev.items)[sid]) : {};
    if (typeof di.P === 'number' && isFinite(di.P)) return { kind: 'db', P: di.P, manualP: mP, send: mSend, prev_kind: 'ok', src: 'db', dbBlock: null };
    if (typeof ytdP === 'number' && isFinite(ytdP)) return { kind: 'ytd', P: ytdP, manualP: mP, send: { P: Math.floor(ytdP), none: false, source: 'ytd' }, prev_kind: 'manual', src: 'ytd', dbBlock: null };
    if (m && m.none) return { kind: 'none', P: null, manualP: null, send: mSend, prev_kind: 'none', src: 'manual', dbBlock: null };
    if (mP !== null) return { kind: 'manual', P: mP, manualP: mP, send: mSend, prev_kind: 'manual', src: 'manual', dbBlock: null };
    return { kind: 'missing', P: null, manualP: null, send: null, prev_kind: null, src: 'missing', dbBlock: 'prev_missing' };
  }
  /* 保存する形（統合 0121 の payroll_bonus_item_err）: {staff_id, item, prev_manual}。computeBonus の出力をそのまま送らず、許された鍵だけを写す。
     T → tax_base、std は health・pension だけ（raw は落とす）、warns は code・msg だけ（stop は落とす） */
  var BONUS_LINE_KEYS = ['sec', 'code', 'name', 'amount', 'basis'];
  function bonusToSave(out, sid, pv) {
    out = obj(out); pv = obj(pv);
    var yenI = function (v) { var n = Number(v); return isFinite(n) ? Math.round(n) : 0; };
    var ins = obj(out.ins), std = obj(out.std), er = {};
    Object.keys(obj(out.employer)).forEach(function (k) { if (/^[A-Za-z_]{1,30}$/.test(k)) { var n = Number(out.employer[k]); er[k] = isFinite(n) ? n : null; } });
    var item = {
      gross: yenI(out.gross), deduct: yenI(out.deduct), net: yenI(out.net), social: yenI(out.social), tax: yenI(out.tax),
      lines: arr(out.lines).slice(0, 300).map(function (l) {
        var o = {}; BONUS_LINE_KEYS.forEach(function (k) { if (l && l[k] !== undefined) o[k] = l[k]; });
        o.code = String(o.code == null ? '' : o.code).slice(0, 48); o.name = String(o.name == null ? '' : o.name).slice(0, 60); o.basis = String(o.basis == null ? '' : o.basis).slice(0, 300);
        if (o.sec === 'pay' || o.sec === 'deduct') o.amount = yenI(o.amount);
        return o;
      }),
      std: { health: yenI(std.health), pension: yenI(std.pension) },
      ins: { health: yenI(ins.health), care: yenI(ins.care), support: yenI(ins.support), pension: yenI(ins.pension), emp: yenI(ins.emp) },
      warns: arr(out.warns).slice(0, 100).map(function (w) { return { code: String((w && w.code) || 'warn').slice(0, 40), msg: String((w && w.msg) || '').slice(0, 300) }; }),
      ver: String(out.ver || 'unknown').slice(0, 40),
      taxable: out.taxable == null ? null : yenI(out.taxable),
      tax_base: out.T == null ? null : yenI(out.T),
      P: typeof out.P === 'number' && isFinite(out.P) ? Math.round(out.P) : null,
      employer: er,
      taxMethod: out.taxMethod === 'rate' || out.taxMethod === 'monthly_none' || out.taxMethod === 'monthly_10x' ? out.taxMethod : null,
      rate: typeof out.rate === 'number' && isFinite(out.rate) && out.rate >= 0 && out.rate <= 100 ? out.rate : null,
      prev_kind: ['none', 'ok', 'unconfirmed', 'manual'].indexOf(pv.prev_kind) >= 0 ? pv.prev_kind : null
    };
    return { staff_id: sid, item: item, prev_manual: pv.send && typeof pv.send === 'object' ? pv.send : null };
  }
  /* 確定できない警告（画面の止め）: 明細の警告のうち computeBonus の止め（BONUS_BLOCK）と、DB が確定で自分で確かめる前月の給与の止め（源泉の区分に依らない）。
     読み直した明細には stop の印が無いので、code で引き直す。返すのは「氏名：文」の一覧（純関数） */
  var BONUS_DB_MSG = { prev_missing: '前月の給与（社会保険料等を引いた後）が入っていません（無い時は「前月の給与なし」を選んでください）', prev_unconfirmed: '前月の給与がまだ確定していません' };
  /* 賞与額が空の人（代表者の答え 2026-11-23「定額であっても全員に払う前提・誰も外さない」）: その回の対象（支給日に給与の設定がある職員）のうち明細が無い人。
     いれば確定させない（払わない人は 0 を入れて明細にする）。返すのは知らせの文の一覧（0件か1件・純関数） */
  function bonusBlankMsg(profiles, items) {
    var have = {}; arr(items).forEach(function (it) { if (it && it.staff_id) have[it.staff_id] = 1; });
    var nm = arr(profiles).filter(function (p) { return p && p.staff_id && !have[p.staff_id]; }).map(function (p) { return p.name || p.staff_id; });
    return nm.length ? ['賞与額が空の人がいます（' + nm.length + '人）：' + nm.join('、') + '。払わない人は 0 を入れてください'] : [];
  }
  /* 空の止めの対象（反証レビュー 2026-11-23）: 回の一覧の人のうち、職員の一覧で在籍でない人（active が false）と、給与の設定の退職日が支給日より前の人は外す。
     外した人も一覧には出し、額を入れれば計算する（求めないだけ）。給与の側の仮の ID（p:）で職員の一覧にいない人は在籍として数える（純関数） */
  function bonusBlankTargets(b) {
    b = obj(b); var pd = b.run && b.run.pay_date, off = {};
    arr(b.inactive).forEach(function (sid) { off[sid] = 1; });
    return arr(b.profiles).filter(function (p) { var rd = obj(p && p.data).retire_date; return p && !off[p.staff_id] && !(isDate(rd) && isDate(pd) && rd < pd); });
  }
  /* 職員の一覧にいて在籍なのに、支給日に給与の設定が無い人（賞与の一覧に出ない）。知らせだけ（仮置き・純関数） */
  function bonusNoProfile(b) {
    b = obj(b); var have = {}; arr(b.profiles).forEach(function (p) { if (p && p.staff_id) have[p.staff_id] = 1; });
    return arr(b.active).filter(function (sid) { return !have[sid]; }).map(function (sid) { return obj(b.names)[sid] || sid; });
  }
  function bonusBlocks(list, prev, block) {
    var B = block || (window.PayrollCalc && window.PayrollCalc.BONUS_BLOCK) || {}, out = [];
    arr(list).forEach(function (it) {
      var seen = {};
      arr(it.warns).forEach(function (w) { if (w && B[w.code] && !seen[w.code]) { seen[w.code] = 1; out.push((it.name || it.staff_id) + '：' + (w.msg || w.code)); } });
      var dbHasP = obj(prev).state === 'ok' && typeof obj(obj(obj(prev).items)[it.staff_id]).P === 'number';
      var code = obj(prev).state === 'draft' ? 'prev_unconfirmed' : (!dbHasP && !(it.prev_manual && typeof it.prev_manual === 'object') ? 'prev_missing' : null);
      if (code && !seen[code]) out.push((it.name || it.staff_id) + '：' + BONUS_DB_MSG[code]);
    });
    return out;
  }
  function bonusProf(sid) { var ps = bb ? bb.profiles : []; for (var i = 0; i < ps.length; i++) if (ps[i].staff_id === sid) return ps[i]; return null; }
  function bonusFrozen() { var s = bb && bb.run && bb.run.status; return s === 'confirmed' || s === 'exported'; }
  function bonusItems() { if (bonusFrozen()) return bb.items; if (bCalc) return bCalc.items; return bb ? bb.items : []; }
  function bonusCfgOf() { return (bb && bb.settings && bb.settings.config) || {}; }
  function bonusYtdP(sid) { return bYtd && bb && bb.run && bYtd.pay_date === bb.run.pay_date && Object.prototype.hasOwnProperty.call(bYtd.v.P, sid) ? bYtd.v.P[sid] : null; }
  /* 入力（メモリだけ）: bIn[sid] = { amt: 文字, pm: ''|'P'|'none', pP: 文字, psrc: 'freee'|'paper'|'other' }。保存した明細から初めの値を作る */
  function bonusInitIn() {
    bIn = {};
    arr(bb && bb.items).forEach(function (it) {
      var a = arr(it.lines).filter(function (l) { return l && l.sec === 'pay'; }).reduce(function (s, l) { return s + num(l.amount); }, 0);
      var m = it.prev_manual, src = m && m.source && m.source !== 'ytd' ? String(m.source) : 'freee';
      bIn[it.staff_id] = { amt: String(a),   /* 0 を入れて保存した人は 0 のまま見せる */ pm: m && m.source !== 'ytd' ? (m.none ? 'none' : (typeof m.P === 'number' ? 'P' : '')) : '', pP: m && m.source !== 'ytd' && typeof m.P === 'number' ? String(m.P) : '', psrc: src };
    });
    bonusInitCfg();
  }
  /* 回の設定の欄を DB の値で作る */
  function bonusInitCfg() {
    var c = obj(bb && bb.run && bb.run.config);
    bCfgBase = JSON.stringify(c); bCfgConflict = false;
    bCfgIn = { fy: {}, cnt: {}, months: num(c.bonus_period_months) > 6 ? '12' : '6' };
    Object.keys(obj(c.fy_prior_std)).forEach(function (k) { bCfgIn.fy[k] = String(c.fy_prior_std[k]); });
    Object.keys(obj(c.prior_count_12m)).forEach(function (k) { bCfgIn.cnt[k] = String(c.prior_count_12m[k]); });
  }
  function bonusAmt(s) { s = String(s == null ? '' : s).replace(/[,，\s円]/g, '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); if (s === '') return null; return /^\d{1,9}$/.test(s) ? parseInt(s, 10) : NaN; }
  function bonusManual(sid) {
    var x = bIn[sid]; if (!x) return null;
    if (x.pm === 'none') return { none: true, source: x.psrc || null };
    if (x.pm === 'P') { var s = String(x.pP || '').replace(/[,，\s円]/g, ''); return /^-?\d{1,9}$/.test(s) ? { P: parseInt(s, 10), none: false, source: x.psrc || null } : null; }
    return null;
  }
  function bonusLoad(keepIn) {
    var my = ++bGen;
    bLoading = true; bErr = null;
    sync('読み込んでいます…');
    paint();
    return rpc('payroll_bonus_bootstrap', { p_bonus_id: bSel || null }).then(function (r) {
      if (my !== bGen) return null;
      bLoading = false; sync('');
      if (r && r.ok === false && r.error === 'norun' && bSel) { bSel = null; return bonusLoad(false); }
      if (r && r.ok === false) { var e = new Error(r.error || 'ng'); e.payroll = r.error; throw e; }
      bNoDb = false;
      bb = bonusNorm(r);
      bb.profiles = orderStaff(bb.profiles); bb.items = orderStaff(bb.items);
      if (!keepIn || !bonusDirty()) { bonusInitIn(); bDirty = false; bCfgDirty = false; bCalc = null; }
      else {
        bCalc = null;
        /* 入力を残す読み直し: 回の設定の欄は、人が直していなければ DB の新しい値で作り直す。直していて DB の値が変わっていれば、保存を止めて知らせる（仮置き） */
        if (!bCfgDirty) bonusInitCfg();
        else if (bCfgBase !== JSON.stringify(obj(bb.run && bb.run.config))) bCfgConflict = true;
      }
      paint();
      /* 確定した回を開いた時は、年末調整の累計に入っているかを読んで確かめる（確定の直後に入れ損ねても、ここで知らせる・送らない） */
      if (bb.run && bonusFrozen() && bYtdPending !== bb.run.bonus_id) bonusYtdPut(null, 'check');
      bYtdWait = !!(bb.run && !bonusFrozen() && isDate(bb.run.pay_date));
      if (bYtdWait) { paint(); bonusLoadYtd(bb.run.pay_date, my); }
      return bb;
    }, function (e) {
      if (my !== bGen) return null;
      bLoading = false; sync('');
      if (bonusNoDb(e)) { bNoDb = true; bb = null; paint(); return null; }
      if (e && e.code === '42501') { bb = null; return fail(e, '賞与の読み込み'); }
      if (isAal(e)) return fail(e, '賞与の読み込み');
      note('賞与の読み込み', e);
      bErr = bonusMsg(e); bb = null; paint();
      return null;
    });
  }
  /* 年末調整の記録を読む（0122 の前の DB・断られた時は黙って飛ばす＝手入力で進める）。読んだ値はメモリだけ */
  function bonusLoadYtd(pd, my) {
    if (!isDate(pd)) return;
    var y = +pd.slice(0, 4), rows = [], any = false, settled = false;
    var one = function (yr) {
      return rpc('payroll_ytd_get', { p_year: yr }).then(function (r) { if (settled) return; if (r && r.ok !== false) { any = true; rows = rows.concat(arr(r.rows)); } }, function (e) { if (!bonusNoDb(e) && !(e && e.code === '42501')) note('年末調整の記録', e); });
    };
    var finish = function (timedOut) {
      if (settled) return; settled = true;
      if (my !== bGen || !bb || !bb.run || bb.run.pay_date !== pd) return;
      if (timedOut) { any = false; note('年末調整の記録', new Error('timeout')); }
      bYtd = any ? { pay_date: pd, v: bonusYtd(rows, pd) } : null;
      rows = null; bYtdWait = false;
      if (any) {
        bCalc = null;
        /* 記録が届いて前月の給与の欄が札に変わる人は、入れかけの選びを外す（見えない欄の形の違いで止め続けない） */
        Object.keys(bYtd.v.P).forEach(function (sid) { var x = bIn[sid]; if (x && x.pm && bonusPrevOf(bb.prev, sid, null, bYtd.v.P[sid]).kind === 'ytd') { x.pm = ''; x.pP = ''; } });
      }
      paint();
    };
    setTimeout(function () { finish(true); }, BONUS_YTD_MS);
    Promise.all([one(y - 1), one(y)]).then(function () { finish(false); });
  }
  function bonusOpen(id) {
    if (bonusDirty()) { ask('保存していない賞与の入力があります。捨ててほかの回を開きますか？').then(function (ok) { if (ok) { bDirty = false; bCfgDirty = false; bSel = id; bonusLoad(false); } }); return; }
    bSel = id; bYtd = null; bNotice = null; bSlipSid = null; bCmp = null; bYtdPut = null; bonusLoad(false);
  }
  /* 1人分の計算の入力を作り、computeBonus を呼ぶ（入力は今の画面の値・config は保存した回の値） */
  function bonusComputeOne(p, amount, manual) {
    var c = window.PayrollCalc, run = bb.run, rc = obj(run.config), sid = p.staff_id;
    var pv = bonusPrevOf(bb.prev, sid, manual, bonusYtdP(sid));
    var fy = obj(rc.fy_prior_std), cnt = obj(rc.prior_count_12m);
    var input = { bonus: { pay_date: run.pay_date, lines: [{ code: 'bonus', amount: amount }] },
      settings: Object.assign({}, bonusCfgOf(), { bonus_period_months: num(rc.bonus_period_months) || 6 }), profile: p.data, allowanceDefs: bb.allowances,
      prev: { kind: pv.kind, P: pv.P, manualP: pv.manualP }, fyStdSum: num(bb.ctx.fy_std[sid]), fyPriorStd: Object.prototype.hasOwnProperty.call(fy, sid) ? num(fy[sid]) : null,
      monthStdSum: num(bb.ctx.month_std[sid]), count12: num(bb.ctx.count_12m[sid]), count12Other: num(cnt[sid]) };
    var out;
    try { out = c.computeBonus(input); } catch (e) { note('賞与の計算', e); out = { gross: 0, deduct: 0, net: 0, lines: [], warns: [{ code: 'calc_error', msg: '計算できませんでした' }] }; }
    /* DB が確定で止める前月の給与（源泉の区分に依らない）を画面でも警告にする。computeBonus が同じ code を出していれば重ねない */
    if (pv.dbBlock && !arr(out.warns).some(function (w) { return w && w.code === pv.dbBlock; })) out.warns = arr(out.warns).concat([{ code: pv.dbBlock, msg: BONUS_DB_MSG[pv.dbBlock], stop: true }]);
    return { out: out, pv: pv };
  }
  function bonusCompute(silent) {
    if (!bb || !bb.run || bonusFrozen()) return null;
    if (!window.PayrollCalc || typeof window.PayrollCalc.computeBonus !== 'function') { toast('計算の部品を読み込めませんでした。ページを読み込み直してください。'); return null; }
    if (bCfgDirty) { say('回の設定（他所で払った標準賞与額・回の数・算定期間）を先に保存してください。'); return null; }
    var bad = [], list = [];
    bb.profiles.forEach(function (p) {
      var x = bIn[p.staff_id], a = x ? bonusAmt(x.amt) : null;
      if (a !== a) { bad.push(p.name); return; }
      if (a === null) return;   /* 空は計算しない（確定は止める）。0 は総支給0の明細にする */
      var k0 = bonusPrevOf(bb.prev, p.staff_id, null, bonusYtdP(p.staff_id)).kind;
      if (x.pm === 'P' && k0 !== 'db' && k0 !== 'ytd' && !bonusManual(p.staff_id)) { bad.push(p.name + '（前月の給与）'); return; }
      var r = bonusComputeOne(p, a, bonusManual(p.staff_id));
      list.push(Object.assign({}, r.out, { staff_id: p.staff_id, name: p.name, prev_kind: r.pv.prev_kind, prev_src: r.pv.src, prev_P: r.pv.P, prev_manual: r.pv.send, _pv: r.pv, bank_last4: p.bank_last4 }));
    });
    if (bad.length) { say('数の形が違う欄があります：' + bad.join('・') + '（半角の数字で書いてください）'); return null; }
    bCalc = { items: list, fp: bb.fingerprint, rev: bb.run.rev };
    bDirty = true; bNotice = null;
    paint();
    if (!silent) toast(list.length + '人分を計算しました。確かめてから「下書き保存」を押してください。');
    return bCalc;
  }
  function bonusSave(btn) {
    if (busy || !bb || !bb.run || bonusFrozen() || bYtdWait) return;
    var c = bonusCompute(true); if (!c) return;
    if (!c.items.length) { say('賞与額を入れた人がいません。'); return; }
    var payload = c.items.map(function (it) { return bonusToSave(it, it.staff_id, it._pv); });
    var done = hold(btn, '保存しています…');
    rpc('payroll_bonus_save', { p_bonus_id: bb.run.bonus_id, p_items: payload, p_fingerprint: c.fp, p_rev: c.rev }).then(okOr).then(function () {
      payload = null; done(); bDirty = false; toast('下書き保存しました。'); return bonusLoad(false);
    })['catch'](function (e) { payload = null; done(); return bonusFail(e, '賞与の下書き保存'); });
  }
  function bonusCfgSave(btn) {
    if (busy || !bb || !bb.run || bonusFrozen() || !bCfgIn) return;
    if (bCfgConflict) { say(BNG.cfgconflict); return; }
    var bad = [], cfgO = { fy_prior_std: {}, prior_count_12m: {}, bonus_period_months: bCfgIn.months === '12' ? 12 : 6 };
    bb.profiles.forEach(function (p) {
      var f = bonusAmt(bCfgIn.fy[p.staff_id]), n = bonusAmt(bCfgIn.cnt[p.staff_id]);
      if (f !== f || (f != null && f % 1000 !== 0)) bad.push(p.name + '（標準賞与額は千円の倍数）');
      else if (f != null) cfgO.fy_prior_std[p.staff_id] = f;
      if (n !== n || (n != null && n > 12)) bad.push(p.name + '（回の数は0〜12）');
      else if (n != null) cfgO.prior_count_12m[p.staff_id] = n;
    });
    if (bad.length) { say('形の違う欄があります：' + bad.join('・')); return; }
    var done = hold(btn, '保存しています…');
    rpc('payroll_bonus_config_put', { p_bonus_id: bb.run.bonus_id, p_config: cfgO, p_rev: bb.run.rev }).then(okOr).then(function () {
      done(); bCfgDirty = false; toast('回の設定を保存しました。「計算する」で計算し直してください。'); return bonusLoad(true);
    })['catch'](function (e) { done(); return bonusFail(e, '賞与の回の設定'); });
  }
  /* 年末調整の記録から、他所で払った標準賞与額・回の数を入力欄に埋める（保存は「回の設定を保存」） */
  function bonusCfgFill() {
    if (!bYtd || !bCfgIn || bonusFrozen()) return;
    var n = 0;
    bb.profiles.forEach(function (p) {
      var sid = p.staff_id;
      if (bYtd.v.fy[sid] != null) { bCfgIn.fy[sid] = String(bYtd.v.fy[sid]); n++; }
      if (bYtd.v.cnt[sid] != null) bCfgIn.cnt[sid] = String(Math.min(12, bYtd.v.cnt[sid]));
    });
    bCfgDirty = true; paint();
    toast(n ? n + '人分を年末調整の記録から埋めました。確かめてから「回の設定を保存」を押してください。' : '年末調整の記録に、この年度に他所で払った賞与はありませんでした。');
  }
  function bonusNew() {
    var d0 = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    openDlg('新しい賞与', '<div class="kv"><label for="bn-date">支給日</label><input id="bn-date" type="date" value="' + esc(d0) + '">' +
      '<label for="bn-title">題（40字まで）</label><input id="bn-title" maxlength="40" value="' + esc(d0.slice(0, 4) + '年' + (+d0.slice(5, 7)) + '月 賞与') + '" autocomplete="off"></div>' +
      '<p class="help">同じ支給日に2回目を作る時も、ここから作ります。</p>',
      '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="b-new-go">作る</button>', { mode: 'bonus-new', dirtyCheck: true });
  }
  function bonusNewGo(btn) {
    if (busy) return;
    var d = v('bn-date'), t = v('bn-title');
    if (!isDate(d)) { say(BNG.baddate); return; }
    if (!t || t.length > 40) { say('題を1〜40字で書いてください。'); return; }
    var done = hold(btn, '作っています…');
    rpc('payroll_bonus_create', { p_pay_date: d, p_title: t }).then(okOr).then(function (r) {
      done(); closeDlg(); toast('賞与の回を作りました。'); bSel = r.bonus_id; bonusClear(); return bonusLoad(false);
    })['catch'](function (e) { done(); return bonusFail(e, '賞与の回の作成'); });
  }
  function bonusDelete(btn) {
    if (busy || !bb || !bb.run || bonusFrozen()) return;
    if (bb.run.exported_at) { say('一度振込データを書き出した回は消せません。'); return; }
    ask('この賞与の回（' + bb.run.title + '・下書き）を消しますか？　入れた賞与額と下書きの明細も消えます。').then(function (ok) {
      if (!ok) return;
      var done = hold(btn, '消しています…');
      rpc('payroll_bonus_delete', { p_bonus_id: bb.run.bonus_id, p_rev: bb.run.rev }).then(okOr).then(function () {
        done(); toast('賞与の回を消しました。'); bSel = null; bonusClear(); return bonusLoad(false);
      })['catch'](function (e) { done(); return bonusFail(e, '賞与の回の削除'); });
    });
  }
  function bonusFigures(list) { return arr(list).map(function (it) { return it.staff_id + ':' + num(it.gross) + ':' + num(it.deduct) + ':' + num(it.net); }).sort().join('|'); }
  function bonusTotals(list) { var t = { n: 0, gross: 0, deduct: 0, net: 0, warn: 0 }; arr(list).forEach(function (it) { t.n++; t.gross += num(it.gross); t.deduct += num(it.deduct); t.net += num(it.net); t.warn += arr(it.warns).length; }); return t; }
  function bonusOpenConfirm() {
    if (busy || !bb || !bb.run || bb.run.status !== 'draft' || bonusDirty() || bYtdWait) return;
    var list = bb.items, t = bonusTotals(list), blk = bonusBlocks(list, bb.prev);
    blk = bonusBlankMsg(bonusBlankTargets(bb), list).concat(blk);
    var B = (window.PayrollCalc && window.PayrollCalc.BONUS_BLOCK) || {};
    var warns = []; list.forEach(function (it) { arr(it.warns).forEach(function (w) { if (w && !B[w.code]) warns.push(it.name + '：' + (w.msg || w.code)); }); });
    var h = '<div class="sumbar"><div>人数<b>' + esc(t.n) + ' 人</b></div><div>総支給の合計<b>' + esc(yen(t.gross)) + ' 円</b></div><div>控除の合計<b>' + esc(yen(t.deduct)) + ' 円</b></div><div>差引の合計<b>' + esc(yen(t.net)) + ' 円</b></div></div>' +
      '<p>支給日 ' + esc(jdate(bb.run.pay_date)) + '　' + esc(bb.run.title) + '</p>';
    if (blk.length) h += '<div class="band ng" role="alert"><b>確定できない警告（' + esc(blk.length) + ' 件）</b><ul>' + blk.map(function (w) { return '<li>⛔ ' + esc(w) + '</li>'; }).join('') + '</ul>直してから計算し直し、下書き保存してください。</div>';
    h += '<h3>残っている警告（' + esc(warns.length) + ' 件）</h3>' + (warns.length ? '<ul>' + warns.map(function (w) { return '<li>⚠ ' + esc(w) + '</li>'; }).join('') + '</ul><label><input type="checkbox" id="bc-ack"> 警告を確かめました</label>' : '<p>ありません。</p>');
    openDlg('賞与を確定しますか？', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="b-confirm-go"' + (blk.length ? ' disabled' : '') + '>確定する</button>',
      { mode: 'bonus-confirm', warn: warns.length > 0, shown: bonusFigures(list), id: bb.run.bonus_id });
  }
  /* 「確定する」: 読み直して、保存した入力で数え直し、窓の数字と同じ時だけ確定（月の給与と同じ・自動で保存し直さない） */
  function bonusConfirmGo(btn) {
    var ctx = dlgCtx;
    if (busy || !ctx || ctx.mode !== 'bonus-confirm') return;
    if (ctx.warn && !($('bc-ack') && $('bc-ack').checked)) { say('警告を確かめたら「警告を確かめました」に印を入れてください。'); return; }
    var done = hold(btn, '確かめています…'), my = ++bGen;
    rpc('payroll_bonus_bootstrap', { p_bonus_id: ctx.id }).then(function (r) {
      if (my !== bGen) { done(); return null; }
      if (r && r.ok === false) { var e0 = new Error(r.error || 'ng'); e0.payroll = r.error; throw e0; }
      var fresh = bonusNorm(r);
      if (!fresh.run || fresh.run.status !== 'draft') { var e1 = new Error('confirmed'); e1.payroll = 'confirmed'; throw e1; }
      var prevBb = bb; bb = fresh;
      var now = [];
      fresh.items.forEach(function (it) {
        var p = bonusProf(it.staff_id), a = arr(it.lines).filter(function (l) { return l && l.sec === 'pay'; }).reduce(function (s, l) { return s + num(l.amount); }, 0);
        if (!p) { now.push({ staff_id: it.staff_id, gross: -1, deduct: 0, net: 0 }); return; }
        /* 保存した前月の給与（年末調整の記録から送った P も手入力として）で数え直す。DB に自社の確定した明細が増えていればそちらが先＝数字が変われば確定しない */
        var x = bonusComputeOne(p, a, it.prev_manual);
        now.push({ staff_id: it.staff_id, gross: x.out.gross, deduct: x.out.deduct, net: x.out.net });
      });
      var blk = bonusBlocks(fresh.items, fresh.prev);
      blk = bonusBlankMsg(bonusBlankTargets(fresh), fresh.items).concat(blk);
      if (fresh.run.stale || bonusFigures(now) !== ctx.shown || bonusFigures(fresh.items) !== ctx.shown || blk.length) {
        done(); closeDlg(); bb = prevBb;
        bNotice = { cls: 'warn', text: blk.length ? '確定できない警告が残っています。確定していません。' : '読み直したら数字が変わっていました。確定していません。「計算する」で計算し直し、下書き保存してから確定し直してください。' };
        return bonusLoad(false);
      }
      return rpc('payroll_bonus_confirm', { p_bonus_id: fresh.run.bonus_id, p_rev: fresh.run.rev }).then(okOr).then(function () {
        done(); closeDlg(); toast('賞与を確定しました。');
        /* 確定した明細を年末調整の累計（source='app'・kind='bonus'）へ入れる。確定は済んでいるので、ここが断られても確定は戻さない（画面に出してやり直せる） */
        var pbid = fresh.run.bonus_id, shown = null; bYtdPending = pbid;
        /* 送っている途中に読み直された時は送った結果が捨てられるので、終わった後に帯が出ていなければ確かめ直す（送らない） */
        var after = function () {
          if (bYtdPending !== pbid) return;
          bYtdPending = null;
          if (bb && bb.run && bb.run.bonus_id === pbid && bonusFrozen() && bYtdPut === shown) bonusYtdPut(null, 'check');
        };
        return Promise.resolve(bonusLoad(false)).then(function () { shown = bYtdPut; return bonusYtdPut(null); })
          .then(function (x) { after(); return x; }, function (e) { after(); throw e; });
      });
    })['catch'](function (e) { done(); closeDlg(); return bonusFail(e, '賞与の確定'); });
  }
  function bonusOpenUnconfirm() {
    if (!isAdmin() || !bonusFrozen()) return;
    var ex = bb.run.status === 'exported' || !!bb.run.exported_at;
    openDlg('賞与の確定を取り消す（管理者）', (ex ? '<div class="band ng" role="alert">⚠ この賞与はもう振込データを書き出しています。銀行へ渡した後なら、取り消して作り直すと二重に振り込まれる恐れがあります。</div>' : '') +
      '<label for="bu-reason">取り消す理由（必ず書く）</label><textarea id="bu-reason" rows="3" maxlength="200" style="width:100%"></textarea>',
      '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn ng" data-act="b-unconfirm-go">確定を取り消す</button>', { mode: 'bonus-unconfirm', dirtyCheck: true });
  }
  function bonusUnconfirmGo(btn) {
    if (busy || !dlgCtx || dlgCtx.mode !== 'bonus-unconfirm' || !bb || !bb.run) return;
    var r = v('bu-reason'); if (!r) { say(BNG.reason); return; }
    var done = hold(btn, '取り消しています…');
    rpc('payroll_bonus_unconfirm', { p_bonus_id: bb.run.bonus_id, p_reason: r }).then(okOr).then(function () { done(); closeDlg(); toast('賞与の確定を取り消しました。'); return bonusLoad(false); })['catch'](function (e) { done(); closeDlg(); return bonusFail(e, '賞与の確定の取り消し'); });
  }

  /* 賞与の明細（画面の見本と紙）。今の月の明細と同じ型（.slip）に「賞与明細」の見出し。紙は A4 縦・1人1ページ（SUPrint の 'bonus-slips'・root #p-print） */
  function bonusCorp(it) {
    var c = (it && it.company_name) || bonusCfgOf().company_name;
    if (c) return String(c);
    try { var f = window.SUFacility && window.SUFacility.get && window.SUFacility.get(); return (f && (f.corpName || f.facilityName)) || ''; } catch (_) { return ''; }
  }
  function bonusSlipHtml(it, paper) {
    var run = bb.run, draft = !bonusFrozen(), p = bonusProf(it.staff_id), std = obj(it.std);
    var pay = arr(it.lines).filter(function (l) { return l && l.sec === 'pay'; }), ded = arr(it.lines).filter(function (l) { return l && l.sec === 'deduct'; });
    function tbl(list, cap) { return '<table><thead><tr><th colspan="2">' + esc(cap) + '</th></tr></thead><tbody>' + (list.length ? list.map(function (l) { return '<tr><td>' + esc(l.name || '') + '</td><td class="num">' + esc(yen(l.amount)) + '</td></tr>'; }).join('') : '<tr><td colspan="2">—</td></tr>') + '</tbody></table>'; }
    var basis = [['標準賞与額（健康保険）', yen(std.health)], ['標準賞与額（厚生年金）', yen(std.pension)], ['課税対象額', it.tax_base == null && it.T == null ? '—' : yen(it.tax_base != null ? it.tax_base : it.T)],
      ['所得税の率', it.rate == null ? (it.taxMethod ? '月額表の方法' : '—') : it.rate + '%']];
    var bank = bankText(it.bank_last4 != null ? it.bank_last4 : (p && p.bank_last4));
    return '<section class="slip"' + (paper ? '' : ' aria-label="賞与明細の見本"') + '><div class="su-print-head-host"><h3>賞与明細　' + esc(run.title) + (draft ? '<span class="sl-draft">下書き（確定前）</span>' : '') + '</h3>' +
      '<span class="su-print-head su-print-head-abs" data-su-print-head="name date"></span></div>' +
      '<p class="sl-meta">' + esc(bonusCorp(it)) + '　支給日 ' + esc(jdate(run.pay_date)) + '</p>' +
      '<p class="sl-meta"><b style="font-size:1.2em">' + esc(it.name) + '</b> 様</p>' +
      '<div class="sl-grid"><div><table><thead><tr><th colspan="2">計算の根拠</th></tr></thead><tbody>' + basis.map(function (b) { return '<tr><td>' + esc(b[0]) + '</td><td class="num">' + esc(b[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div>' + tbl(pay, '支給') + '</div><div>' + tbl(ded, '控除') + '</div><div><table class="sl-tot"><tbody>' +
      '<tr><td>総支給額</td><td class="num">' + esc(yen(it.gross)) + '</td></tr><tr><td>控除の合計</td><td class="num">' + esc(yen(it.deduct)) + '</td></tr><tr><td>差引支給額</td><td class="num">' + esc(yen(it.net)) + '</td></tr>' +
      '<tr><td>振込先</td><td>' + esc(bank || '（口座なし）') + '</td></tr></tbody></table></div></div></section>';
  }
  function bonusPrint(list) {
    if (!list || !list.length || !bb || !bb.run) return;
    if (!window.SUPrint) { toast('印刷の部品を読み込めていません。ページを読み込み直してください。'); return; }
    bonusDefinePrint();
    var go = function () {
      bPrint = list;
      try { window.SUPrint.print('bonus-slips'); } catch (e) { note('賞与明細の印刷', e); }
      if (!document.body.classList.contains('su-printing')) bPrint = null;
    };
    rpc('payroll_bonus_export_log', { p_bonus_id: bb.run.bonus_id, p_kind: 'slip' }).then(okOr).then(function () {
      if (!window.SUPrint.facGate) { go(); return; }
      window.SUPrint.facGate(go, function (msg) { toast(msg); });
    })['catch'](function (e) { bonusFail(e, '賞与明細の印刷の記録'); });
  }
  function bonusDefinePrint() {
    if (!window.SUPrint || bonusDefinePrint.done) return;
    bonusDefinePrint.done = true;
    window.SUPrint.define('bonus-slips', { label: '賞与明細', paper: 'A4 portrait', margin: 12, root: '#p-print', allowUser: [],
      when: function () { return !!bPrint && view === 'app' && !masked; },
      pagesOf: function () { return bPrint ? bPrint.length : 1; },
      before: function () { put($('p-print'), (bPrint || []).map(function (it) { return bonusSlipHtml(it, true); }).join('')); },
      after: function () { put($('p-print'), ''); bPrint = null; } });
    window.SUPrint.setActive(null);
  }
  /* 振込データ（全銀 種別12・振込指定日＝支給日）。種別は設定の写しで 12 に上書きし、月の給与の設定は変えない */
  function bonusTransferWant(list) { var x = X(), w = { total: 0, parts: 0 }; arr(list).forEach(function (it) { var b = arr(it.bank_last4); if (!b.length || !(num(it.net) > 0)) return; var n = 1; try { n = x && typeof x.splitAccounts === 'function' ? x.splitAccounts(num(it.net), b).parts.length : 1; } catch (e) { note('振込の件数', e); } w.total += num(it.net); w.parts += n; }); return w; }
  function bonusZenginBase() {
    var c = bonusCfgOf(), list = bb.items, co = list.filter(function (it) { return it.company_name; })[0];
    return { ym: bb.run.pay_date.slice(0, 7), period: null, payDate: bb.run.pay_date,
      settings: Object.assign({}, c, { zengin: Object.assign({}, obj(c.zengin), { kind: '12' }), company_name: co ? co.company_name : c.company_name }),
      items: list, profiles: bb.profiles.map(function (p) { return { staff_id: p.staff_id, data: p.data }; }) };
  }
  function bonusZengin(btn) {
    var x = X();
    if (busy || !bb || !bb.run || !bonusFrozen() || !x || typeof x.zengin !== 'function' || bonusCfgOf().zengin_enabled !== true) return;
    var base = bonusZenginBase(), id = bb.run.bonus_id;
    var pre = x.zengin(Object.assign({}, base, { rows: [] }));
    if (!pre || pre.ok === false) {
      var w0 = arr(pre && pre.errors).slice(0, 5).map(function (e) { return (e && e.msg) || ''; }).filter(Boolean);
      say('振込元の設定に足りない所があるので、振込データを作りません。' + (w0.length ? '\n' + w0.join('\n') : '') + '\n管理者が「設定」の振込元を直してください。');
      return;
    }
    var again = bb.run.status === 'exported' || !!bb.run.exported_at;
    if (again) busy = true;
    (again ? ask('この賞与の振込データは ' + at(bb.run.exported_at) + ' にもう書き出しています。\n銀行へもう渡していれば、もう一度渡すと二重に振り込まれます。\n前のファイルを作れなかった・なくした時だけ、もう一度作ってください。\nもう一度書き出しますか？') : Promise.resolve(true)).then(function (go) {
      busy = false;
      if (!go) return;
      var done = hold(btn, '作っています…');
      rpc('payroll_bonus_export_log', { p_bonus_id: id, p_kind: again ? 'zengin_again' : 'zengin' }).then(okOr).then(function () {
        return rpc('payroll_bonus_bank_export', { p_bonus_id: id });
      }).then(function (r) {
        if (r && r.ok === false && r.error === 'stale') { var e = new Error('bankstale'); e.payroll = 'bankstale'; throw e; }
        if (r && r.ok === false && r.error === 'exported') { done(); say(BNG.exported); return bonusLoad(true).then(function () { return null; }); }
        return okOr(r);
      }).then(function (r) {
        if (!r) return null;
        var res = x.zengin(Object.assign({}, base, { rows: arr(r.rows) }));
        r.rows = null; r = null;
        done();
        var want = bonusTransferWant(base.items);
        if (res.ok !== false && (num(res.total) !== want.total || num(res.count) !== want.parts)) {
          var got = { total: num(res.total), count: num(res.count) }; res = null;
          say('振込データの合計（' + yen(got.total) + '円・' + got.count + '件）が、画面の振込する分（' + yen(want.total) + '円・' + want.parts + '件）と合いません。ファイルは作っていません。管理者に知らせてください。');
          return bonusLoad(true);
        }
        if (res.ok === false) {
          var why = arr(res.errors).slice(0, 5).map(expMsg).filter(Boolean); res = null;
          say('振込データを作れませんでした（ファイルは作っていません）。' + (why.length ? '\n' + why.join('\n') : '') + '\n設定（振込元）と口座を確かめてください。');
          return bonusLoad(true);
        }
        var ws = arr(res.warnings).map(expMsg).filter(Boolean);
        res.name = 'payroll-zengin-bonus-' + base.payDate + '.txt';
        download(res); res = null;
        toast('賞与の振込データを書き出しました。使い終わったら消してください。');
        if (ws.length) say('振込データを書き出しました。次の所を確かめてください（' + ws.length + ' 件）。\n' + ws.slice(0, 10).join('\n') + (ws.length > 10 ? '\nほか ' + (ws.length - 10) + ' 件' : ''));
        return bonusLoad(true);
      })['catch'](function (e) { done(); bonusFail(e, '賞与の振込データ'); });
    });
  }
  /* 賞与支払届に写す値の CSV（設計 §4: 氏名・生年月日・支給日・賞与額・千円未満切り捨ての額・70歳以上の印・同じ月の合算の印。個人番号・基礎年金番号は出さない）。純関数。
     載せるのは、その回で賞与を払った人の全員（届は支払った人の全員のため・標準賞与額が0の人も・仮置き）。
     千円未満切り捨ての額は、上限（年度・同じ月）をかける前の額＝総支給の千円未満切り捨て（std は上限の後のため使わない・仮置き）。
     70歳以上の印は、支給日に70歳に達している（誕生日の前日を過ぎた）人。
     同じ月の合算の印は、同じ年月に支給日のある別の回（下書きを除く・先の回も後の回も）がある時に付ける。回の一覧には人ごとの明細が無いので、その時は全員に付ける（仮置き） */
  function bonusShoyoCsv(list, profiles, payDate, runs, bonusId) {
    var x = X(), cell = x && typeof x.csvCell === 'function' ? x.csvCell : function (v) { return String(v == null ? '' : v); };
    var pm = {}; arr(profiles).forEach(function (p) { if (p && p.staff_id) pm[p.staff_id] = obj(p.data); });
    var reach = window.PayrollCalc && window.PayrollCalc.reachDate;
    var same = isDate(payDate) && arr(runs).some(function (r) { return r && r.bonus_id !== bonusId && r.status !== 'draft' && isDate(r.pay_date) && r.pay_date.slice(0, 7) === payDate.slice(0, 7); });
    var rows = [['氏名', '生年月日', '支給日', '賞与額', '千円未満切り捨ての額', '70歳以上の印', '同じ月の合算の印']];
    arr(list).filter(function (it) { return it && num(it.gross) > 0; }).forEach(function (it) {   /* 総支給0の人は載せない（仮置き） */
      var d = pm[it.staff_id] || {}, b = isDate(d.birth_date) ? d.birth_date : '';
      var r70 = b && typeof reach === 'function' ? reach(b, 70) : null;
      rows.push([it.name || '', b, payDate, num(it.gross), Math.max(0, Math.floor(num(it.gross) / 1000) * 1000), r70 && r70 <= payDate ? '1' : '', same ? '1' : '']);
    });
    return rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n';
  }
  function bonusShoyo(btn) {
    if (busy || !bb || !bb.run || !bonusFrozen()) return;
    var done = hold(btn, '作っています…'), run = bb.run;
    rpc('payroll_bonus_export_log', { p_bonus_id: run.bonus_id, p_kind: 'shoyo_csv' }).then(okOr).then(function () {
      done();
      var text = bonusShoyoCsv(bb.items, bb.profiles, run.pay_date, bb.runs, run.bonus_id);
      download({ name: 'payroll-shoyo-' + run.pay_date + '.csv', text: text }); text = null;
      toast('賞与支払届に写す値の CSV を書き出しました。使い終わったら消してください。');
    })['catch'](function (e) { done(); bonusFail(e, '賞与支払届の CSV'); });
  }

  /* ── 賞与のタブを描く ── */
  /* ── freee と比べる（年末調整の画面の compareHtml・compareFile と同じ形・2026-11-23）──
     比べる自社の明細は今の画面の物（確定した回は確定の明細・下書きは保存した明細か、保存前の計算）。金額は画面のメモリの中だけ */
  function FS() { var f = window.PayrollFreeeSlips; return f && typeof f.compareSlips === 'function' && typeof f.pickByDate === 'function' ? f : null; }
  function bonusCmpFp() { return (bb && bb.run ? bb.run.bonus_id : '') + '|' + bonusFigures(bonusItems()); }
  function bonusCmpWhat() { return bonusFrozen() ? '確定した明細' : (bCalc && bDirty ? '保存前の計算' : '下書き保存した明細'); }
  function bonusCmpFile(f) {
    bCmp = null;
    if (!f || !bb || !bb.run) { paint(); return; }
    var bid = bb.run.bonus_id, pd = bb.run.pay_date, my = bGen;
    if (f.size > BONUS_CMP_MAX) { bCmp = { bid: bid, err: 'ファイルが大きすぎます（2MB まで）。' }; paint(); return; }
    var F = FS();
    if (!F) { bCmp = { bid: bid, err: '比べる部品を読み込めませんでした。ページを読み込み直してください。' }; paint(); return; }
    f.arrayBuffer().then(function (buf) {
      if (my !== bGen || !bb || !bb.run || bb.run.bonus_id !== bid) return;
      var p = F.parse(decode(buf), { kind: 'bonus' }); buf = null;
      if (p.refused) { bCmp = { bid: bid, err: '読めなかった見出し: ' + arr(p.cols.required).join('・') + '。freee の賞与の明細の CSV を選んでください（見出しの候補は payroll-freee-slips.js の表にあり、足せば読めます）。' }; paint(); return; }
      var staff = bb.profiles.map(function (q) { return { staff_id: q.staff_id, name: q.name, emp_num: obj(q.data).freee_emp_num }; });
      var m = F.match(p.rows, staff);
      var pk = F.pickByDate(m.matched.concat(m.unmatched.map(function (u) { return u.row; })), pd);
      if (pk.off) { bCmp = { bid: bid, err: pk.why === 'baddate' ? '支給日の読めない行が ' + pk.baddate + ' 行あります（どの回の賞与か分からないので比べません）。freee の賞与の明細の CSV を選び直してください。' : 'この CSV の支給日（' + pk.dates.join('・') + '）に、この回の支給日（' + pd + '）がありません。この回の賞与の明細の CSV を選んでください（夏と冬を取り違えないため、比べません）。' }; paint(); return; }
      /* 賞与額0円の人も明細になる（#660）。freee に行の無い0円の人は比べる対象から外し、人数だけ出す（freee に0円の行があれば比べる） */
      var inF = {}; pk.rows.forEach(function (r) { if (r.staff_id) inF[r.staff_id] = 1; });
      var zero = 0;
      var ours = bonusItems().filter(function (it) { if (num(it.gross) === 0 && !inF[it.staff_id]) { zero++; return false; } return true; })
        .map(function (it) { var q = bonusProf(it.staff_id); return Object.assign({}, it, { emp_num: q ? obj(q.data).freee_emp_num : null }); });
      if (!ours.length && !zero) { bCmp = { bid: bid, err: 'この回の計算がまだありません。賞与額を入れて「計算する」を押してから比べてください。' }; paint(); return; }
      bCmp = { bid: bid, fp: bonusCmpFp(), what: bonusCmpWhat(), missing: p.cols.missing.slice(), nodate: pk.nodate, zero: zero, res: F.compareSlips(ours, pk.rows, 'bonus') };
      paint();
    })['catch'](function (e) { note('賞与を freee と比べる', e); bCmp = { bid: bid, err: '読めませんでした。freee の賞与の明細の CSV を選んでください。' }; paint(); });
  }
  function bonusCmpHtml() {
    var F = FS(), UI = window.PayrollYearEndUI;
    var h = '<div class="cd"><h2>freee と比べる</h2><p class="help">freee から書き出したこの回（支給日 ' + esc(jdate(bb.run.pay_date)) + '）の賞与の明細の CSV を選ぶと、この画面の明細と人×項目で比べます。ファイルは画面の中だけで読み、どこにも保存しません。' +
      '従業員番号が ' + esc(F ? F.EXCLUDE_PREFIX : 'A9') + ' で始まる人は freee に登録が無いので比べません（差の数に入れず、人数だけ出します）。★賞与の CSV の見出しは、事務担当が書き出した実物でまだ確かめていません（未検証）。</p>' +
      '<div class="row"><label for="b-cmpfile">この回の CSV</label><input type="file" id="b-cmpfile" accept=".csv,text/csv" style="max-width:100%"></div>';
    var c = bCmp;
    if (!c || c.bid !== bb.run.bonus_id) return h + '</div>';
    if (c.err) return h + '<div class="band ng" role="alert">' + esc(c.err) + '</div></div>';
    if (c.fp !== bonusCmpFp()) return h + '<div class="band warn" role="status">比べた後にこの回の明細が変わりました。もう一度 CSV を選んで比べ直してください。</div><div class="row"><button type="button" class="btn" data-act="b-cmp-clear">比べた結果を消す</button></div></div>';
    var r = c.res;
    h += '<p class="help">比べたのは' + esc(c.what) + 'です。' + (c.what === '確定した明細' ? '' : '振込の前に、確定してからもう一度比べてください。') + (c.nodate ? '⚠ 支給日の列の無い行 ' + esc(c.nodate) + ' 行は、この回の分として比べました（この回の CSV かどうかは人が確かめてください）。' : '') + (c.zero ? '賞与額0円で freee に行の無い ' + esc(c.zero) + ' 人は比べていません。' : '') + '</p>';
    if (c.missing.length) h += '<p class="help">読めなかった見出し（0円として比べます）: ' + esc(c.missing.join('・')) + '</p>';
    h += UI && typeof UI.cmpBand === 'function' ? UI.cmpBand(esc, r) : '<div class="band warn" role="status">判定の部品を読み込めませんでした。ページを読み込み直してください。</div>';
    h += '<div class="tw"><table><caption class="help" style="text-align:left">項目ごとの合計</caption><thead><tr><th>項目</th><th class="num">自社</th><th class="num">freee</th><th class="num">差</th><th class="num">一致の人数</th><th class="num">差ありの人数</th></tr></thead><tbody>' +
      F.ITEMS.filter(function (x) { return r.totals[x[0]]; }).map(function (x) {
        var tt = r.totals[x[0]], k = r.counts[x[0]];
        return '<tr><td>' + esc(x[1]) + '</td><td class="num">' + esc(yen(tt.app)) + '</td><td class="num">' + esc(yen(tt.freee)) + '</td><td class="num"' + (tt.diff ? ' style="color:var(--ng);font-weight:700"' : '') + '>' + esc((tt.diff ? '⚠ ' : '') + yen(tt.diff)) + '</td><td class="num">' + esc(k.same) + '</td><td class="num">' + esc(k.diff) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var nm = function (sid, fb) { var q = sid ? bonusProf(sid) : null; return q ? q.name : (sid && bb.names[sid]) || fb || ''; };
    if (r.unmatched.length) h += '<div class="band warn"><b>片方だけにいる人・照合できない行</b><ul>' + r.unmatched.map(function (u) {
      return '<li>' + esc(u.excluded ? '自社だけ（freee に登録の無い人・比べる対象外）：' + nm(u.staff_id, u.name_short) : u.side === 'ours' ? '自社だけ：' + nm(u.staff_id, u.name_short) : u.staff_id ? 'freee だけ：' + nm(u.staff_id, u.name_short) : '照合できません（職員に結べない freee の行）：' + u.name_short) + '</li>'; }).join('') +
      '</ul>職員に結べない行は、従業員番号（「職員の給与設定」の取り込みで入ります）か、同じ氏名がちょうど1人の時だけ結びます。</div>';
    var rows = r.rows.filter(function (x) { return x.diff !== 0; });
    h += rows.length ? '<div class="tw"><table><thead><tr><th>氏名</th><th>項目</th><th class="num">自社</th><th class="num">freee</th><th class="num">差</th></tr></thead><tbody>' + rows.map(function (x) {
      return '<tr><td class="nm">' + esc(nm(x.staff_id, x.name_short)) + '</td><td>' + esc(x.item) + '</td><td class="num">' + esc(yen(x.ours)) + '</td><td class="num">' + esc(x.bad ? '⚠ 読めない値' : yen(x.freee)) + '</td><td class="num" style="color:var(--ng);font-weight:700">' + esc(x.bad ? '⚠ 読めない値' : '⚠ ' + yen(x.diff)) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="help">差のある行はありません。</p>';
    return h + '<div class="row"><button type="button" class="btn" data-act="b-cmp-clear">比べた結果を消す</button></div></div>';
  }
  /* ── 確定した明細を年末調整の累計へ入れる（統合 0124・source='app'・kind='bonus'）──
     同じ支給日の確定した回が他にもあれば、その明細も読んで人ごとに合算する（DB も合算と照らす）。年末調整を確定した人・同じ値が入っている人は送らない */
  var BYTD_NG = {
    mismatch: '確定した賞与の明細と合いませんでした。「読み直す」を押してから、もう一度「年末調整の累計に入れる」を押してください。',
    final: 'その人の年末調整はもう確定しているので、累計を変えられません。年末調整の確定を管理者が取り消してから入れてください。',
    conflict: 'ほかの人が先に累計を直しました。もう一度「年末調整の累計に入れる」を押してください。',
    badshape: 'データベースがまだ賞与を累計に入れる形になっていません（準備中）。年末調整のタブの「累計に1回分を手で足す」で入れてください。',
    nostaff: 'シフトにも給与の設定にも見つからない人がいます。読み直してください。',
    badyear: '支給日の年が違います。'
  };
  function bonusYtdPut(btn, mode) {
    var F = FS(), check = mode === 'check';
    if (!bb || !bb.run || !bonusFrozen() || !F || typeof F.planBonusYtd !== 'function') return null;
    if (btn && busy) return null;
    var run = bb.run, bid = run.bonus_id, pd = run.pay_date, yr = +String(pd).slice(0, 4), my = bGen, items = bb.items.slice();
    var nm = function (sid) { var q = bonusProf(sid); return q ? q.name : (bb && bb.names[sid]) || sid; };
    var others = bb.runs.filter(function (r) { return r.bonus_id !== bid && r.pay_date === pd && (r.status === 'confirmed' || r.status === 'exported'); });
    var done = btn ? hold(btn, '入れています…') : function () {};
    var set = function (cls, text, extra) { if (my !== bGen || !bb || !bb.run || bb.run.bonus_id !== bid) return; bYtdPut = Object.assign({ bid: bid, cls: cls, text: text }, extra || {}); paint(); };
    return Promise.all(others.map(function (r) {
      return rpc('payroll_bonus_bootstrap', { p_bonus_id: r.bonus_id }).then(function (x) {
        if (x && x.ok === false) { var e = new Error(x.error || 'ng'); e.payroll = x.error; throw e; }
        var n = bonusNorm(x);
        return n.run && (n.run.status === 'confirmed' || n.run.status === 'exported') && n.run.pay_date === pd ? n.items : [];
      });
    })).then(function (lists) {
      lists.forEach(function (l) { items = items.concat(l); });
      return rpc('payroll_ytd_get', { p_year: yr });
    }).then(function (g) {
      if (!g || g.ok === false) { var e = new Error((g && g.error) || 'ng'); e.payroll = (g && g.error) || 'ng'; throw e; }
      var plan = F.planBonusYtd(items, pd, g); items = null;
      var fin = plan.final.length ? '年末調整を確定しているので入れなかった人: ' + plan.final.map(nm).join('、') + '。' : '';
      /* 今の明細では支給が無いのに、累計に前の確定の行が残っている人（送り直しでは直らない） */
      var stale = plan.stale.length ? '⚠ この賞与の支給が無いのに、年末調整の累計に前の確定の行が残っている人: ' + plan.stale.map(nm).join('、') + '。下の「累計の残っている行を消す」で消してください。' : '';
      /* 消す時に要る版（rev）。画面のメモリだけ */
      var staleRows = arr(g.rows).filter(function (r) { return r && r.kind === 'bonus' && r.pay_date === pd && r.source === 'app' && plan.stale.indexOf(r.staff_id) >= 0; })
        .map(function (r) { return { staff_id: r.staff_id, rev: num(r.rev) }; });
      var sx = staleRows.length ? { staleRows: staleRows, year: yr, pay_date: pd } : {};
      if (check) {
        done();
        if (plan.rows.length) set('ng', '⚠ 年末調整の累計に、この賞与がまだ入っていない人（値の違う人を含む）が ' + plan.rows.length + ' 人います。下の「年末調整の累計に入れる」を押してください。' + stale + fin, Object.assign({ retry: true }, sx));
        else if (stale) set('ng', stale + fin, Object.assign({ retry: true }, sx));
        else set(plan.final.length ? 'warn' : 'ok', '✓ 年末調整の累計には、この賞与が入っています（' + plan.same.length + ' 人）。' + fin);
        return null;
      }
      if (!plan.rows.length) { done(); set(stale ? 'ng' : plan.final.length ? 'warn' : 'ok', (plan.same.length ? '✓ 年末調整の累計には、この賞与がもう入っています（' + plan.same.length + ' 人）。' : '累計に入れる人がいません。') + stale + fin, stale ? Object.assign({ retry: true }, sx) : null); return null; }
      var rows = plan.rows;
      return rpc('payroll_ytd_put', { p_year: yr, p_rows: rows }).then(function (r) {
        done(); rows = null;
        if (r && r.ok === true) {
          set(stale ? 'ng' : plan.final.length ? 'warn' : 'ok', '✓ 年末調整の累計に入れました（足した ' + num(r.added) + ' 人・置き換えた ' + num(r.replaced) + ' 人' + (plan.same.length ? '・もう入っていた ' + plan.same.length + ' 人' : '') + '）。' +
            (plan.replace.length ? '手で足した行・freee の行を置き換えた人: ' + plan.replace.map(function (x) { return nm(x.staff_id); }).join('、') + '。' : '') + stale + fin, stale ? Object.assign({ retry: true }, sx) : null);
          return null;
        }
        var code = (r && r.error) || 'ng';
        set('ng', '⚠ 確定はできましたが、年末調整の累計には入っていません：' + (BYTD_NG[code] || 'うまくいきませんでした（' + code + '）。') + (r && r.staff_id ? '（' + nm(r.staff_id) + '）' : '') + stale, { retry: true });
        return null;
      });
    })['catch'](function (e) {
      done(); items = null;
      if (check) { if (!(e && e.payroll) && !bonusNoDb(e)) note('賞与の年末調整の累計の確かめ', e); set('ng', '⚠ 年末調整の累計に入っているかを確かめられませんでした（' + (bonusNoDb(e) ? 'データベースの準備中' : e && e.payroll ? (BYTD_NG[e.payroll] || e.payroll) : '通信') + '）。「年末調整の累計に入れる」を押すか、読み直してください。', { retry: true }); return null; }
      if (e && (e.code === '42501' || isAal(e))) { set('ng', '⚠ 確定はできましたが、年末調整の累計には入っていません（給与の権限・二段階のログインを確かめてください）。', { retry: true }); return fail(e, '賞与を年末調整の累計へ'); }
      if (bonusNoDb(e)) { set('ng', '⚠ 確定はできましたが、年末調整の累計には入っていません：' + BYTD_NG.badshape, { retry: true }); return null; }
      if (!(e && e.payroll)) note('賞与を年末調整の累計へ', e);
      set('ng', '⚠ 確定はできましたが、年末調整の累計には入っていません：' + (e && e.payroll ? (BYTD_NG[e.payroll] || bonusMsg(e)) : friendly(e)), { retry: true });
      return null;
    });
  }
  /* 累計に残った前の確定の賞与の行（今の明細では支給が無い人）を消す（payroll_ytd_delete・理由つき・消したことは記録に残る） */
  function bonusYtdDel(btn) {
    var y = bYtdPut, bid = bb && bb.run && bb.run.bonus_id;
    if (busy || !y || y.bid !== bid || !arr(y.staleRows).length) return;
    var list = y.staleRows.slice(), nm = function (sid) { var q = bonusProf(sid); return q ? q.name : (bb && bb.names[sid]) || sid; };
    ask(y.pay_date + ' の賞与の累計の行を消しますか？（' + list.map(function (r) { return nm(r.staff_id); }).join('、') + '・この回の明細では支給がありません。消したことと理由は記録に残ります）').then(function (ok) {
      if (!ok) return null;
      var done = hold(btn, '消しています…'), ng = [];
      return list.reduce(function (pr, r) {
        return pr.then(function () {
          return rpc('payroll_ytd_delete', { p_year: y.year, p_staff_id: r.staff_id, p_pay_date: y.pay_date, p_kind: 'bonus', p_rev: r.rev, p_reason: '賞与の確定し直しで支給が無くなった（賞与のタブ）' })
            .then(function (x) { if (!x || x.ok !== true) ng.push(nm(r.staff_id) + '（' + ((x && x.error) || 'ng') + '）'); });
        });
      }, Promise.resolve()).then(function () {
        done();
        if (ng.length) say('消せなかった行があります：' + ng.join('、') + '。読み直してからもう一度押してください。');
        else toast('累計の残っていた行を消しました。');
        return bonusYtdPut(null, 'check');
      });
    })['catch'](function (e) { busy = false; if (e && (e.code === '42501' || isAal(e))) return fail(e, '賞与の累計の行を消す'); note('賞与の累計の行を消す', e); say(friendly(e)); return null; });
  }
  function bonusYtdHtml() {
    var y = bYtdPut && bYtdPut.bid === bb.run.bonus_id ? bYtdPut : null;
    return '<div class="cd"><h2>年末調整の累計</h2><p class="help">確定した賞与は、年末調整の累計（その年に払った給与・賞与）に自動で入ります（同じ支給日の確定した回は人ごとに合算）。入らなかった時や、確定を取り消して確定し直した時は、下のボタンを押してください（何度押しても同じ値なら変わりません）。</p>' +
      (y ? '<div class="band ' + esc(y.cls) + '" role="status">' + esc(y.text) + '</div>' : '') +
      '<div class="row"><button type="button" class="btn' + (y && y.retry ? ' pri' : '') + '" data-act="b-ytd-put">年末調整の累計に入れる</button>' +
      (y && arr(y.staleRows).length ? '<button type="button" class="btn ng" data-act="b-ytd-del">累計の残っている行を消す（' + esc(y.staleRows.length) + ' 人）</button>' : '') + '</div></div>';
  }
  function bonusHtml() {
    if (bNoDb) return '<div class="cd"><h2>賞与</h2><div class="band warn" role="status">賞与はまだ使えません（データベースの準備中）。</div></div>';
    if (!bb) {
      if (!bLoading && !bErr && view === 'app' && !masked) Promise.resolve().then(function () { if (!bb && !bLoading && tab === 'bonus' && view === 'app') bonusLoad(true); });
      return bErr ? '<div class="band ng" role="alert">' + esc(bErr) + '</div><button type="button" class="btn" data-act="b-reload">もう一度読む</button>' : '<div class="cd" aria-busy="true"><span class="skel w8"></span><span class="skel w6"></span><span class="skel w4"></span></div>';
    }
    var h = bNotice ? '<div class="band ' + esc(bNotice.cls) + '" role="status">' + esc(bNotice.text) + '</div>' : '';
    if (!bb.run) return h + bonusListHtml();
    return h + bonusRunHtml();
  }
  function bonusListHtml() {
    var h = '<div class="cd"><h2>賞与の回</h2><p class="help">賞与は月分の選びと関係なく、回ごとに作ります。上の月分は月の給与のタブだけに使います。</p><div class="row"><button type="button" class="btn pri" data-act="b-new">＋ 新しい賞与</button></div>';
    if (!bb.runs.length) return h + '<p class="empty">賞与の回はまだありません。</p></div>';
    h += '<div class="tw"><table><thead><tr><th>支給日</th><th>題</th><th>状態</th><th class="num">人数</th><th class="num">総支給の合計（円）</th><th>開く</th></tr></thead><tbody>';
    bb.runs.forEach(function (r) {
      h += '<tr><td class="nm">' + esc(jdate(r.pay_date)) + '</td><td>' + esc(r.title) + '</td><td>' + esc(BONUS_STATUS[r.status]) + (r.stale ? ' <span class="tag warn">⚠ 計算し直しが要る</span>' : '') + '</td>' +
        '<td class="num">' + esc(r.count) + '</td><td class="num">' + esc(yen(r.gross)) + '</td><td><button type="button" class="btn" data-act="b-open" data-bid="' + esc(r.bonus_id) + '">開く</button></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }
  var PSRC = [['freee', 'freee の明細'], ['paper', '紙の明細'], ['other', 'そのほか']];
  function bonusPrevCell(p, i, fz) {
    var sid = p.staff_id, x = bIn[sid] || {};
    if (fz) {
      var it = bb.items.filter(function (y) { return y.staff_id === sid; })[0], k = it && it.prev_kind, m = it && it.prev_manual;
      if (!it) return '—';
      if (k === 'ok') return '給与の記録（確定）';
      if (m && m.source === 'ytd') return '年末調整の記録 ' + esc(yen(m.P)) + ' 円';
      if (m && m.none) return '前月の給与なし';
      return m && typeof m.P === 'number' ? '手入力 ' + esc(yen(m.P)) + ' 円' : '—';
    }
    var pv = bonusPrevOf(bb.prev, sid, bonusManual(sid), bonusYtdP(sid));
    if (pv.kind === 'unconfirmed') return '<span class="tag ng">⛔ 前月（' + esc(ymText(bb.prev.ym)) + '）の給与がまだ確定していません</span>';
    if (pv.kind === 'db') return '<span class="tag ok">給与の記録</span> ' + esc(yen(pv.P)) + ' 円';
    if (pv.kind === 'ytd') return '<span class="tag ok">年末調整の記録</span> ' + esc(yen(pv.P)) + ' 円';
    var o = function (val, lab) { return '<option value="' + val + '"' + ((x.pm || '') === val ? ' selected' : '') + '>' + lab + '</option>'; };
    return '<div class="row"><label for="b-pm-' + i + '" class="help">前月の給与</label><select id="b-pm-' + i + '" data-bsid="' + esc(sid) + '" data-bk="pm">' + o('', '（まだ入れていない）') + o('P', '金額を入れる') + o('none', '前月の給与なし') + '</select>' +
      (x.pm === 'P' ? '<input id="b-pp-' + i + '" data-bsid="' + esc(sid) + '" data-bk="pP" inputmode="numeric" aria-label="' + esc(p.name) + ' さんの前月の給与（社会保険料等を引いた後・円）" value="' + esc(x.pP || '') + '" style="max-width:9em" autocomplete="off">' : '') +
      (x.pm ? '<select id="b-ps-' + i + '" data-bsid="' + esc(sid) + '" data-bk="psrc" aria-label="' + esc(p.name) + ' さんの前月の給与の出どころ">' + PSRC.map(function (s) { return '<option value="' + s[0] + '"' + ((x.psrc || 'freee') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' : '') + '</div>';
  }
  function bonusRunHtml() {
    var run = bb.run, fz = bonusFrozen(), c = window.PayrollCalc && typeof window.PayrollCalc.computeBonus === 'function';
    var h = '<div class="cd"><div class="row"><button type="button" class="btn" data-act="b-list">← 賞与の回の一覧</button></div>' +
      '<h2>' + esc(run.title) + '（支給日 ' + esc(jdate(run.pay_date)) + '）</h2><div class="row">状態: <span class="tag ' + (fz ? 'ok' : 'warn') + '">' + (fz ? '✓ ' : '') + esc(BONUS_STATUS[run.status]) + '</span> ' +
      esc(at(fz ? (run.exported_at || run.confirmed_at) : run.saved_at)) + '</div>';
    var np = bonusNoProfile(bb);
    if (np.length && !fz) h += '<div class="band warn" role="status">給与の設定が無いので賞与の一覧に出ていない職員: ' + esc(np.join('、')) + '（賞与の対象なら職員の給与の設定を先に入れてください）</div>';
    if (run.stale && !fz) h += '<div class="band warn">⚠ 保存した後に給与の設定・前月の給与・ほかの回が変わりました。「計算する」で計算し直してください。</div>';
    if (!c) h += '<div class="band ng" role="alert">計算の部品を読み込めませんでした。ページを読み込み直してください。</div>';
    if (bDirty && bCalc) h += '<div class="band warn">計算した結果はまだ保存していません。「下書き保存」を押すまで、ほかの人には見えません。</div>';
    if (bYtdWait && !fz) h += '<div class="band warn" role="status">年末調整の記録を確かめています。終わるまで「下書き保存」と「確定する」は押せません。</div>';
    if (bCfgConflict && !fz) h += '<div class="band ng" role="alert">' + esc(BNG.cfgconflict) + '</div>';
    if (bCfgDirty) h += '<div class="band warn">回の設定を変えました。「回の設定を保存」を押してから計算してください。</div>';
    h += '<div class="row">';
    if (!fz) {
      h += '<button type="button" class="btn pri" data-act="b-compute"' + (c && !bCfgDirty ? '' : ' disabled') + '>計算する</button>';
      h += '<button type="button" class="btn" data-act="b-save"' + (c && !bCfgDirty && !bYtdWait ? '' : ' disabled') + '>下書き保存</button>';
      var blk = bonusBlocks(bb.items, bb.prev);
      blk = bonusBlankMsg(bonusBlankTargets(bb), bb.items).concat(blk);
      h += '<button type="button" class="btn" data-act="b-confirm"' + (bb.items.length && !bonusDirty() && !run.stale && !blk.length && !bYtdWait ? '' : ' disabled') + '>確定する</button>';
      if (!run.exported_at) h += '<button type="button" class="btn ng" data-act="b-delete">この回を消す（下書き）</button>';
      if (!bonusDirty() && blk.length) h += '</div><div class="band ng" role="alert"><b>確定できない警告（' + esc(blk.length) + ' 件）</b><ul>' + blk.map(function (w) { return '<li>⛔ ' + esc(w) + '</li>'; }).join('') + '</ul></div><div class="row">';
    } else if (isAdmin()) h += '<button type="button" class="btn ng" data-act="b-unconfirm">確定を取り消す（管理者）</button>';
    h += '</div></div>';
    /* 入れる表（下書きの時だけ入力欄） */
    h += '<div class="cd"><h2>1人ずつの賞与額と前月の給与</h2>' + (fz ? '' : '<p class="help">賞与額を入れた人だけを計算・保存します。前月の給与は、給与の記録（確定した明細）・年末調整の記録が無い人だけ入れてください（社会保険料等を引いた後の額）。</p>') +
      '<div class="tw"><table><thead><tr><th>氏名</th><th class="num">賞与額（円）</th><th>前月の給与</th></tr></thead><tbody>';
    bb.profiles.forEach(function (p, i) {
      var x = bIn[p.staff_id] || {}, it = fz ? bb.items.filter(function (y) { return y.staff_id === p.staff_id; })[0] : null;
      if (fz && !it) return;
      h += '<tr><td class="nm">' + esc(p.name) + '</td><td class="num">' + (fz ? esc(yen(it.gross)) : '<input id="b-amt-' + i + '" data-bsid="' + esc(p.staff_id) + '" data-bk="amt" inputmode="numeric" aria-label="' + esc(p.name) + ' さんの賞与額（円）" value="' + esc(x.amt || '') + '" style="max-width:10em;text-align:right" autocomplete="off">') + '</td>' +
        '<td>' + bonusPrevCell(p, i, fz) + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    /* 回の設定（他所で払った標準賞与額・回の数・算定期間） */
    h += '<details class="cd" id="b-cfg"' + (bCfgOpen || bCfgDirty ? ' open' : '') + '><summary><b>回の設定（他所で払った標準賞与額・過去12か月の他所の回の数・算定期間）</b></summary>' +
      '<p class="help">この年度（4月から）に freee など他所で払った賞与の標準賞与額（健康保険・千円の倍数）と、過去12か月に他所で払った賞与の回の数を人ごとに入れます。入れていない人は 0 として数え、知らせを出します。</p>';
    if (!fz) h += '<div class="row">' + (bYtd ? '<button type="button" class="btn" data-act="b-cfg-fill">年末調整の記録から埋める</button>' : '<span class="help">年末調整の記録が無いので、手で入れてください。</span>') +
      '<label for="b-months">算定期間</label><select id="b-months" data-bk="months">' + [['6', '6か月以内'], ['12', '6か月を超える']].map(function (o) { return '<option value="' + o[0] + '"' + (bCfgIn && bCfgIn.months === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn pri" data-act="b-cfg-save"' + (bCfgDirty && !bCfgConflict ? '' : ' disabled') + '>回の設定を保存</button></div>';
    h += '<div class="tw"><table><thead><tr><th>氏名</th><th class="num">他所で払った標準賞与額（この年度・円）</th><th class="num">過去12か月の他所の回の数</th></tr></thead><tbody>';
    bb.profiles.forEach(function (p, i) {
      var f = bCfgIn ? bCfgIn.fy[p.staff_id] : '', n = bCfgIn ? bCfgIn.cnt[p.staff_id] : '';
      h += '<tr><td class="nm">' + esc(p.name) + '</td>' + (fz ? '<td class="num">' + esc(f == null || f === '' ? '—' : yen(f)) + '</td><td class="num">' + esc(n == null || n === '' ? '—' : n) + '</td>' :
        '<td class="num"><input id="b-fy-' + i + '" data-bsid="' + esc(p.staff_id) + '" data-bk="fy" inputmode="numeric" aria-label="' + esc(p.name) + ' さんの他所で払った標準賞与額" value="' + esc(f == null ? '' : f) + '" style="max-width:10em;text-align:right" autocomplete="off"></td>' +
        '<td class="num"><input id="b-cn-' + i + '" data-bsid="' + esc(p.staff_id) + '" data-bk="cnt" inputmode="numeric" aria-label="' + esc(p.name) + ' さんの過去12か月の他所の回の数" value="' + esc(n == null ? '' : n) + '" style="max-width:5em;text-align:right" autocomplete="off"></td>') + '</tr>';
    });
    h += '</tbody></table></div></details>';
    /* 計算の結果 */
    var list = bonusItems();
    if (!list.length) return h + '<div class="cd empty">' + (fz ? '確定した明細がありません。' : 'まだ計算していません。賞与額を入れて「計算する」を押してください。') + '</div>';
    var t = bonusTotals(list);
    h += '<div class="cd"><h2>計算の結果' + (bCalc && !fz ? '（まだ保存していません）' : '') + '</h2><div class="sumbar"><div>人数<b>' + esc(t.n) + ' 人</b></div><div>総支給の合計<b>' + esc(yen(t.gross)) + ' 円</b></div><div>控除の合計<b>' + esc(yen(t.deduct)) + ' 円</b></div><div>差引の合計<b>' + esc(yen(t.net)) + ' 円</b></div><div>警告<b>' + esc(t.warn) + ' 件</b></div></div>';
    var B = (window.PayrollCalc && window.PayrollCalc.BONUS_BLOCK) || {};
    list.forEach(function (it) {
      var w = arr(it.warns), stop = w.some(function (x) { return x && B[x.code]; });
      h += '<details class="bit"><summary class="row"><span class="nm"><b>' + esc(it.name) + '</b></span><span class="num">総支給 ' + esc(yen(it.gross)) + '</span><span class="num">控除 ' + esc(yen(it.deduct)) + '</span><span class="num">差引 <b>' + esc(yen(it.net)) + '</b></span>' +
        (stop ? '<span class="tag ng">⛔ 確定できない警告</span>' : (w.length ? '<span class="tag warn">⚠ 警告 ' + esc(w.length) + '</span>' : '<span class="tag ok">✓</span>')) + '</summary>';
      if (w.length) h += '<div class="band ' + (stop ? 'ng' : 'warn') + '"><ul>' + w.map(function (x) { return '<li>' + (B[x.code] ? '⛔ ' : '⚠ ') + esc(x.msg || x.code) + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="split"><div class="tw">' + linesTable(arr(it.lines).filter(function (l) { return l && l.sec === 'pay'; }), '支給') + '</div><div class="tw">' + linesTable(arr(it.lines).filter(function (l) { return l && l.sec === 'deduct'; }), '控除') + '</div></div>' +
        '<p class="help">標準賞与額 健康保険 ' + esc(yen(obj(it.std).health)) + ' 円・厚生年金 ' + esc(yen(obj(it.std).pension)) + ' 円／課税対象額 ' + esc(it.tax_base != null ? yen(it.tax_base) : (it.T != null ? yen(it.T) : '—')) + ' 円' +
        (it.rate != null ? '／率 ' + esc(it.rate) + '%' : (it.taxMethod ? '／月額表の方法' : '')) + '</p></details>';
    });
    h += '</div>';
    h += bonusCmpHtml();
    if (fz) h += bonusYtdHtml();
    /* 明細・振込・CSV（確定した回だけ。明細の見本と印刷は下書きでも出す＝紙に「下書き（確定前）」） */
    var saved = (fz ? bb.items : (bDirty ? [] : bb.items)).filter(function (it) { return num(it.gross) > 0; });   /* 総支給0の人は明細・振込・CSV に出さない（仮置き） */
    if (saved.length) {
      if (!bSlipSid || !saved.some(function (it) { return it.staff_id === bSlipSid; })) bSlipSid = saved[0].staff_id;
      var cur = saved.filter(function (it) { return it.staff_id === bSlipSid; })[0];
      h += '<div class="cd"><h2>賞与明細・振込・書き出し</h2>' + (fz ? '' : '<div class="band warn">⚠ まだ確定していません。紙にも「下書き（確定前）」と出ます。振込データと CSV は確定してから出せます。</div>') +
        '<div class="row"><label for="b-who">職員</label><select id="b-who">' + saved.map(function (it) { return '<option value="' + esc(it.staff_id) + '"' + (it.staff_id === bSlipSid ? ' selected' : '') + '>' + esc(it.name) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn" data-act="b-print-one">この人の明細を印刷</button><button type="button" class="btn pri" data-act="b-print-all">全員分を印刷（' + esc(saved.length) + '枚）</button></div>';
      if (fz) {
        h += '<div class="row">' + (bonusCfgOf().zengin_enabled === true ? '<button type="button" class="btn pri" data-act="b-zengin"' + (X() ? '' : ' disabled') + '>振込データ（全銀形式・賞与）</button>' : '') +
          '<button type="button" class="btn" data-act="b-shoyo">賞与支払届に写す値の CSV</button></div>';
        if (bonusCfgOf().zengin_enabled !== true) h += '<p class="help">振込データ（全銀形式）は、管理者が「設定」の「振込データ（全銀形式）の書き出しを使う」に印を入れるまで出しません。</p>';
        var w2 = bonusTransferWant(saved);
        h += '<p class="help">振込する分（口座あり・差引が0より大きい人）: ' + esc(yen(w2.total)) + ' 円・' + esc(w2.parts) + ' 件。振込指定日は支給日（' + esc(jdate(run.pay_date)) + '）です。CSV には個人番号・基礎年金番号は入れません。</p>' +
          '<div class="band warn"><b>書き出したファイルの扱い</b><ul><li>ファイルはこのパソコンの「ダウンロード」フォルダに入ります。氏名と金額（振込データは口座の番号も）が入っています。</li><li>使い終わったら、Finder の「ダウンロード」でそのファイルを選び、ごみ箱へ入れて「ごみ箱を空にする」まで行ってください。</li><li>メール・チャット・共有のフォルダには入れないでください。書き出したことは記録に残ります。</li></ul></div>';
      }
      h += '</div>' + bonusSlipHtml(cur, false);
    }
    return h;
  }
  /* 賞与の画面の操作（bind の click から呼ぶ） */
  function bonusAct(a, b) {
    if (a === 'b-reload') { if (bonusDirty()) { ask('保存していない賞与の入力があります。捨てて読み直しますか？').then(function (ok) { if (ok) { bErr = null; bonusLoad(false); } }); return; } bErr = null; bonusLoad(false); }
    else if (a === 'b-new') bonusNew();
    else if (a === 'b-new-go') bonusNewGo(b);
    else if (a === 'b-open') bonusOpen(b.getAttribute('data-bid'));
    else if (a === 'b-list') { if (bonusDirty()) { ask('保存していない賞与の入力があります。捨てて一覧へ戻りますか？').then(function (ok) { if (ok) { bSel = null; bonusClear(); bonusLoad(false); } }); return; } bSel = null; bonusClear(); bonusLoad(false); }
    else if (a === 'b-compute') bonusCompute(false);
    else if (a === 'b-save') bonusSave(b);
    else if (a === 'b-confirm') bonusOpenConfirm();
    else if (a === 'b-confirm-go') bonusConfirmGo(b);
    else if (a === 'b-unconfirm') bonusOpenUnconfirm();
    else if (a === 'b-unconfirm-go') bonusUnconfirmGo(b);
    else if (a === 'b-delete') bonusDelete(b);
    else if (a === 'b-cfg-save') bonusCfgSave(b);
    else if (a === 'b-cfg-fill') bonusCfgFill();
    else if (a === 'b-print-one') bonusPrint(bb.items.filter(function (it) { return it.staff_id === bSlipSid && num(it.gross) > 0; }));
    else if (a === 'b-print-all') bonusPrint(bb.items.filter(function (it) { return num(it.gross) > 0; }));
    else if (a === 'b-zengin') bonusZengin(b);
    else if (a === 'b-shoyo') bonusShoyo(b);
    else if (a === 'b-cmp-clear') { bCmp = null; paint(); }
    else if (a === 'b-ytd-put') bonusYtdPut(b);
    else if (a === 'b-ytd-del') bonusYtdDel(b);
  }
  /* 入力欄はメモリ（bIn・bCfgIn）にだけ写す。描き直さない（打っている欄の手元を失わない）。前月の給与の選びを変えた時だけ描き直す */
  function bonusBind() {
    /* 回の設定の開け閉めを覚える（描き直しで閉じない） */
    document.addEventListener('toggle', function (e) { if (e.target && e.target.id === 'b-cfg') bCfgOpen = !!e.target.open; }, true);
    document.addEventListener('input', function (e) {
      var el = e.target, k = el && el.getAttribute && el.getAttribute('data-bk'), sid = el && el.getAttribute('data-bsid');
      if (!k || !bb || tab !== 'bonus') return;
      if (k === 'amt' || k === 'pP') { bIn[sid] = bIn[sid] || { amt: '', pm: '', pP: '', psrc: 'freee' }; bIn[sid][k] = String(el.value || ''); bDirty = true; }
      else if ((k === 'fy' || k === 'cnt') && bCfgIn) { bCfgIn[k][sid] = String(el.value || ''); if (!bCfgDirty) { bCfgDirty = true; var sb = document.querySelector('[data-act="b-cfg-save"]'); if (sb) sb.disabled = false; } }
    }, true);
    document.addEventListener('change', function (e) {
      var el = e.target, k = el && el.getAttribute && el.getAttribute('data-bk'), sid = el && el.getAttribute('data-bsid');
      if (el && el.id === 'b-who') { bSlipSid = el.value; paint(); return; }
      if (el && el.id === 'b-cmpfile') { if (tab === 'bonus') bonusCmpFile(el.files && el.files[0]); el.value = ''; return; }
      if (!k || !bb || tab !== 'bonus') return;
      if (k === 'pm' || k === 'psrc') { bIn[sid] = bIn[sid] || { amt: '', pm: '', pP: '', psrc: 'freee' }; bIn[sid][k] = String(el.value || ''); bDirty = true; if (k === 'pm') { paint(); var f = $(el.id.replace('b-pm-', 'b-pp-')) || $(el.id); if (f) f.focus(); } }
      else if (k === 'months' && bCfgIn) { bCfgIn.months = el.value === '12' ? '12' : '6'; bCfgDirty = true; paint(); }
    }, true);
  }

  /* ── 職員の給与設定 ── */
  var PAY_TYPE = { monthly: '月給', hourly: '時給', daily: '日給', board: '役員報酬' };
  function missingOf(p) {
    var d = p.data, ins = obj(d.ins), m = [];
    if (p.none) return ['給与の設定'];
    if (d.exclude === true) return m;
    if (!PAY_TYPE[d.pay_type]) m.push('給与形態');
    else if (d.pay_type === 'board' ? !num(d.board_pay) : !num(d.base)) m.push(d.pay_type === 'hourly' ? '時給' : d.pay_type === 'daily' ? '日給' : d.pay_type === 'board' ? '役員報酬' : '基本給');
    if (!isDate(d.birth_date)) m.push('生年月日');
    if (obj(ins.health).on && !num(obj(ins.health).std)) m.push('健保の標準報酬');
    if (obj(ins.pension).on && !num(obj(ins.pension).std)) m.push('厚年の標準報酬');
    if (!obj(d.tax).col) m.push('源泉の区分');
    if (!bankText(p.bank_last4)) m.push('口座');
    return m;
  }
  function profileHtml() {
    var h = '';
    if (isAdmin()) h += importHtml();
    h += '<div class="cd"><h2>職員の給与設定</h2><p class="help">設定の変更は、月分の期間の初日から効きます（期間の途中の昇給などは、その月だけの調整で払います）。口座は下4桁だけを出します。</p>';
    if (!bs.profiles.length) return h + '<p class="empty">職員がいません。給与の名簿・シフトの職員を確かめてください。</p></div>';
    h += '<div class="tw"><table><thead><tr><th>氏名</th><th>形態</th><th class="num">基本給・時給など</th><th>標準報酬（健保／厚年）</th><th>源泉</th><th>口座</th><th>抜け</th><th>操作</th></tr></thead><tbody>';
    bs.profiles.forEach(function (p) {
      var d = p.data, ins = obj(d.ins), tx = obj(d.tax), miss = missingOf(p);
      h += '<tr><td class="nm">' + esc(p.name) + (d.exclude === true ? ' <span class="tag">計算から外す</span>' : '') + (p.none ? ' <span class="tag warn">給与の設定なし</span>' : '') + '</td><td>' + esc(PAY_TYPE[d.pay_type] || '—') + '</td><td class="num">' + esc(d.pay_type === 'board' ? yen(d.board_pay) : (d.base != null ? yen(d.base) : '—')) + '</td>' +
        '<td>' + esc((obj(ins.health).std ? yen(ins.health.std) : '—') + '／' + (obj(ins.pension).std ? yen(ins.pension.std) : '—')) + '</td><td>' + esc(tx.col === 'kou' ? '甲・扶養' + num(tx.dependents) : tx.col === 'otsu' ? '乙' : tx.col === 'none' ? 'なし' : '—') + ((tx.col === 'kou' || tx.col === 'otsu') && tx.dependents_checked !== true ? ' <span class="tag warn">⚠ 扶養が未確認</span>' : '') + (d.fixed_ot && typeof d.fixed_ot === 'object' && d.fixed_ot.checked !== true ? ' <span class="tag warn">⚠ 固定残業の時間が未確認</span>' : '') + '</td>' +
        '<td>' + esc(bankText(p.bank_last4) || '—') + '</td><td>' + (miss.length ? '<span class="tag ng">⚠ 抜け：' + esc(miss.join('・')) + '</span>' : '<span class="tag ok">✓ なし</span>') + '</td>' +
        '<td class="nm"><button type="button" class="btn" data-act="prof" data-sid="' + esc(p.staff_id) + '">直す</button> <button type="button" class="btn" data-act="bank" data-sid="' + esc(p.staff_id) + '">口座</button></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }
  function fiscalMonths() {
    var pd = payDate() || (ym + '-01'), y = +pd.slice(0, 4), m = +pd.slice(5, 7), s = m >= 6 ? y : y - 1, out = [];
    for (var i = 0; i < 12; i++) out.push(shiftYm(s + '-06', i));
    return out;
  }
  function inp(id, label, val, attrs) { return '<label for="' + esc(id) + '">' + esc(label) + '</label><input id="' + esc(id) + '" value="' + esc(val == null ? '' : val) + '" autocomplete="off"' + (attrs || '') + '>'; }
  function chk(id, label, on) { return '<label><input type="checkbox" id="' + esc(id) + '"' + (on ? ' checked' : '') + '> ' + esc(label) + '</label>'; }
  function sel(id, label, val, opts) { return '<label for="' + esc(id) + '">' + esc(label) + '</label><select id="' + esc(id) + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val == null ? '' : val) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  var NUMA = ' inputmode="numeric"';
  /* 段A2: 手当の回数の元の選び。元は勤怠の設定（kintai_month_get の settings.config）と締めた時の控えの定義・控えの記号の回数（counts）と今の値 */
  function srcOpts(cur) {
    var EXm = window.KintaiExtras, kc = kintaiCfg0 || obj(bs && bs.kcheck && bs.kcheck.kcfg), out = [['manual', '手で入れる（下の回数）']], seen = { manual: 1 };
    var add = function (v, t) { if (!seen[v]) { seen[v] = 1; out.push([v, t]); } };
    var syms = {}; Object.keys(obj(bs && bs.kintai.summary_by_staff)).forEach(function (sid) { Object.keys(obj(bs.kintai.summary_by_staff[sid].counts)).forEach(function (k) { syms[k] = 1; }); });
    Object.keys(syms).sort().forEach(function (k) { if (!(EXm && EXm.SRC_RE.test(k))) add(k, 'シフトの記号：' + k); });
    if (EXm && typeof EXm.defOf === 'function') {
      var defs = [EXm.defOf(kc), bs && bs.kintai.ext_def ? EXm.cleanDef(bs.kintai.ext_def) : null].filter(Boolean);
      defs.forEach(function (df) {
        df.items.forEach(function (it) { add((it.kind === 'time' ? 't:' : 'x:') + it.code, EXm.srcLabel((it.kind === 'time' ? 't:' : 'x:') + it.code, df)); });
        df.groups.forEach(function (g) { add('g:' + g.code, EXm.srcLabel('g:' + g.code, df)); });
        if (df.commute) add('k:commute', '通勤回数');
      });
    }
    if (cur && typeof cur === 'string' && !seen[cur]) add(cur, '今の値：' + (EXm && EXm.SRC_RE.test(cur) ? EXm.srcLabel(cur, null) : 'シフトの記号：' + cur));
    return out;
  }
  function openProfile(sid) {
    var p = profOf(sid); if (!p) return;
    var d = p.data, ins = obj(d.ins), tx = obj(d.tax), cm = obj(d.commute), rt = obj(d.resident_tax), p0 = period();
    var froms = p0 ? [p0.from, addDay(p0.to, 1)] : [];
    var h = '<p>' + esc(p.name) + ' さん（今の版: ' + esc(p.effective_from ? md(p.effective_from) + 'から' : 'まだありません') + '）</p>';
    h += '<fieldset><legend>いつから</legend><div class="kv">' + sel('f-from', '設定を変える日（期間の初日）', froms[0], froms.map(function (f, i) { return [f, jdate(f) + (i === 0 ? '（この月分から）' : '（次の月分から）')]; })) + '</div></fieldset>';
    h += '<fieldset><legend>給与</legend><div class="kv">' + sel('f-type', '給与形態', d.pay_type, [['', '（選ぶ）'], ['monthly', '月給'], ['hourly', '時給'], ['daily', '日給'], ['board', '役員報酬']]) +
      inp('f-base', '基本給・時給・日給（円）', d.base, NUMA) + inp('f-board', '役員報酬（円）', d.board_pay, NUMA) +
      inp('f-amh', '月平均所定労働時間', d.avg_month_hours, ' inputmode="decimal"') + inp('f-amd', '月平均所定労働日数', d.avg_month_days, ' inputmode="decimal"') + inp('f-dh', '1日の所定時間（日給）', d.day_hours, ' inputmode="decimal"') + '</div>';
    var pays = bs.allowances.filter(function (a) { return a.sec === 'pay' && !a.hidden; }), deds = bs.allowances.filter(function (a) { return a.sec === 'deduct' && !a.hidden; });
    function amtOf(list, code) { var x = arr(list).filter(function (a) { return a && a.code === code; })[0]; return x ? x.amount : ''; }
    function alOf(code) { return arr(d.allowances).filter(function (x) { return x && x.code === code; })[0] || {}; }
    /* 段A2: 回数×単価の手当は「回数の元」を選ぶ（手で入れる＋回数／シフトの記号／補助項目／記号の組／通勤回数・今の値は引き継ぐ） */
    if (pays.length) h += '<p class="help">手当（月の額・空欄は無し）</p><div class="kv">' + pays.map(function (a, i) {
      var x = inp('f-al' + i, a.name || a.code, amtOf(d.allowances, a.code), NUMA);
      if (a.calc === 'count') { var cur = alOf(a.code); x += sel('f-als' + i, (a.name || a.code) + ' の回数の元', cur.count_source || 'manual', srcOpts(cur.count_source)) + inp('f-alc' + i, (a.name || a.code) + ' の回数（手で入れる時）', cur.count, ' inputmode="decimal"'); }
      return x;
    }).join('') + '</div>' + (pays.some(function (a) { return a.calc === 'count'; }) ? '<p class="help">回数の元は、締めた勤怠の控えから月ごとに数えます（補助項目・記号の組・通勤回数は勤怠の設定のタブで決めます）。回数で払う通勤手当は、通勤手当の非課税の限度を確かめていません。</p>' : '');
    if (deds.length) h += '<p class="help">固定の控除（月の額・空欄は無し）</p><div class="kv">' + deds.map(function (a, i) { return inp('f-de' + i, a.name || a.code, amtOf(d.deductions, a.code), NUMA); }).join('') + '</div>';
    h += '<div class="kv">' + inp('f-cm', '通勤手当（月の額・円）', cm.monthly, NUMA) + sel('f-cmm', '通勤の手段', cm.means, [['', '（選ぶ）'], ['public', '公共交通'], ['car', '車・自転車'], ['mixed', '併用']]) + inp('f-cmd', '片道の距離（km）', cm.distance_km, ' inputmode="decimal"') +
      inp('f-cmp', '駐車場の料金（本人が負担・月・円）', cm.parking_monthly, NUMA) + '</div>' +
      '<p class="help">駐車場の料金は、車・自転車で片道2km以上の人だけ、令和8年4月1日以後に払う分の非課税の上限に月5,000円まで足します（空欄は無し）。</p>';
    /* 固定残業代（手当・含む時間（分）・確かめた）。手当を選ばなければ固定残業代なし（代表者の決定 2026-11-19・欄の位置は仮置き） */
    var fo = obj(d.fixed_ot);
    h += '<p class="help">固定残業代（手当に含む時間外の分。含む分を時間外から先に引き、超えた分だけを残業代として払います）</p><div class="kv">' +
      sel('f-fot', '固定残業代の手当', fo.allowance_code || '', [['', '（なし）']].concat(pays.map(function (a) { return [a.code, a.name || a.code]; }))) +
      inp('f-fotmin', '含む時間（分）', fo.covered_min, NUMA) + '</div>' + chk('f-fotok', '含む時間を確かめた（freee の画面か雇用契約書で）', fo.checked === true) + '</fieldset>';
    h += '<fieldset><legend>本人</legend><div class="kv">' + inp('f-birth', '生年月日', d.birth_date, ' type="date"') + sel('f-gender', '性別（賃金台帳）', d.gender === 'male' ? 'M' : d.gender === 'female' ? 'F' : d.gender, [['', '（選ぶ）'], ['M', '男'], ['F', '女']]) +
      inp('f-entry', '入社日', d.entry_date, ' type="date"') + inp('f-retire', '退職日', d.retire_date, ' type="date"') +
      inp('f-emp', '従業員番号（freee の番号）', d.freee_emp_num, ' maxlength="20" spellcheck="false" autocapitalize="characters"') + '</div>' +
      '<p class="help">従業員番号は freee の明細と比べる時の結び付けに使います。freee に登録の無い人（契約社員など）は ' + esc(EXC()) + ' で始まる番号（例 ' + esc(EXC()) + '01）を入れてください。freee に登録の無い人として、比べる対象から外して人数だけ数えます。</p></fieldset>';
    h += '<fieldset><legend>社会保険・雇用保険</legend><div class="row">' + chk('f-h-on', '健康保険に入る', obj(ins.health).on) + chk('f-p-on', '厚生年金に入る', obj(ins.pension).on) + chk('f-e-on', '雇用保険に入る', obj(ins.emp).on) + chk('f-care-ex', '介護保険の対象外', ins.care_exempt === true) + '</div>' +
      '<div class="kv">' + inp('f-h-std', '健保の標準報酬月額（円）', obj(ins.health).std, NUMA) + inp('f-p-std', '厚年の標準報酬月額（円）', obj(ins.pension).std, NUMA) + '</div></fieldset>';
    h += '<fieldset><legend>税</legend><div class="kv">' + sel('f-col', '源泉の区分', tx.col, [['', '（選ぶ）'], ['kou', '甲欄'], ['otsu', '乙欄'], ['none', '対象外']]) + inp('f-deps', '扶養親族等の数', tx.dependents, NUMA) + '</div>' + chk('f-depok', '甲乙・扶養の数を確かめた（freee の画面か本人の申告書で）', tx.dependents_checked === true) +
      '<p class="help">住民税（特別徴収・月の額）</p><div class="kv">' + fiscalMonths().map(function (m, i) { return inp('f-rt' + i, (+m.slice(5)) + '月（' + m.slice(0, 4) + '年）', rt[m], NUMA); }).join('') + '</div></fieldset>';
    h += '<fieldset><legend>そのほか</legend><div class="row">' + chk('f-noatt', '勤怠を使わない（役員・固定給）', d.no_attendance === true) + chk('f-excl', '計算から外す（休職・支給なし）', d.exclude === true) + '</div></fieldset>';
    h += '<div class="kv"><label for="f-reason">直す理由（必ず書く）</label><input id="f-reason" maxlength="200" autocomplete="off"></div>';
    var hist = p.versions;
    h += '<h3 style="font-size:16px">履歴（設定の版）</h3>' + (hist.length ? '<div class="tw"><table><thead><tr><th>いつから</th><th class="num">直した回数</th><th>最後に直した日時</th><th>直した人</th><th>理由</th></tr></thead><tbody>' + hist.map(function (x) { return '<tr><td>' + esc(jdate(x.effective_from)) + '</td><td class="num">' + esc(x.rev) + '</td><td>' + esc(at(x.updated_at)) + '</td><td>' + esc(x.updated_by || '') + '</td><td>' + esc(x.reason || '') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="help">だれがいつ・なぜ直したかは、管理者が「設定」のタブの「操作の記録」で見られます。</p>' : '<p class="help">履歴はまだありません。</p>');
    openDlg('職員の給与設定を直す', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="prof-go">保存する</button>', { mode: 'prof', sid: sid, pays: pays, deds: deds, months: fiscalMonths(), dirtyCheck: true });
  }
  function v(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
  /* freee に登録の無い人の従業員番号の頭（payroll-freee-slips.js の EXCLUDE_PREFIX・部品が無ければ 'A9'） */
  function EXC() { var f = window.PayrollFreeeSlips; return f && typeof f.EXCLUDE_PREFIX === 'string' ? f.EXCLUDE_PREFIX : 'A9'; }
  function on(id) { var e = $(id); return !!(e && e.checked); }
  /* 全角の数字・小数点を半角へ（「２７」「２．５」も受ける・2026-11-24） */
  function han(x) { return String(x == null ? '' : x).replace(/[０-９．]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); }); }
  function nOr(id, keep) { var s = han(v(id)).replace(/[,，\s円]/g, ''); if (s === '') return keep === undefined ? null : keep; return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; }
  function profGo(btn) {
    var c = dlgCtx, p = c && profOf(c.sid); if (!p) return;
    var reason = v('f-reason'); if (!reason) { say(NG.reason); return; }
    var bad = [];
    function n(id, label) { var x = nOr(id); if (x !== x) bad.push(label); return x; }
    /* 今の data を写してから上書きする（画面に無い項目・知らない項目を消さない） */
    var d = JSON.parse(JSON.stringify(p.data));
    d.pay_type = v('f-type');
    if (!d.pay_type) { say('給与形態を選んでください。'); return; }
    d.base = n('f-base', '基本給'); d.board_pay = n('f-board', '役員報酬');
    d.avg_month_hours = n('f-amh', '月平均所定労働時間'); d.avg_month_days = n('f-amd', '月平均所定労働日数'); d.day_hours = n('f-dh', '1日の所定時間');
    var keepA = arr(d.allowances).filter(function (a) { return !c.pays.some(function (x) { return x.code === a.code; }); });
    c.pays.forEach(function (a, i) {
      var x = n('f-al' + i, a.name || a.code); if (x != null && x === x) {
        var old = arr(p.data.allowances).filter(function (o) { return o.code === a.code; })[0], ent = Object.assign({}, old || {}, { code: a.code, amount: x });
        /* 段A2: 回数の元（選びがある時だけ・手で入れる時は回数も。回数は 0〜9999） */
        if ($('f-als' + i)) {
          var src = v('f-als' + i) || 'manual', cn = nOr('f-alc' + i);
          ent.count_source = src;
          if (src === 'manual') { if (cn !== cn || (cn != null && (cn < 0 || cn > 9999))) bad.push((a.name || a.code) + ' の回数（0〜9999）'); else ent.count = cn; }
        }
        keepA.push(ent);
      }
    });
    d.allowances = keepA;
    var keepD = arr(d.deductions).filter(function (a) { return !c.deds.some(function (x) { return x.code === a.code; }); });
    c.deds.forEach(function (a, i) { var x = n('f-de' + i, a.name || a.code); if (x != null && x === x) keepD.push({ code: a.code, amount: x }); });
    d.deductions = keepD;
    d.commute = Object.assign({}, obj(d.commute), { monthly: n('f-cm', '通勤手当'), means: v('f-cmm') || null, distance_km: n('f-cmd', '片道の距離') });
    /* 駐車場の料金は、入れた時と前に値があった時だけ送る（空の人に鍵を足さない・統合 0118 より前の DB は知らない鍵を断るため） */
    var pkv = n('f-cmp', '駐車場の料金');
    if (pkv != null || 'parking_monthly' in obj(p.data.commute)) d.commute.parking_monthly = pkv;
    if (d.commute.parking_monthly != null && d.commute.parking_monthly === d.commute.parking_monthly && d.commute.parking_monthly % 1) bad.push('駐車場の料金（円・整数）');
    var fot = v('f-fot'), fotMin = n('f-fotmin', '含む時間（分）');
    if (!fot) delete d.fixed_ot;
    else if (fotMin == null || fotMin !== fotMin || fotMin % 1 || fotMin < 0) bad.push('含む時間（分・0以上の整数）');
    else d.fixed_ot = { allowance_code: fot, covered_min: fotMin, checked: on('f-fotok') };
    ['birth_date:f-birth', 'entry_date:f-entry', 'retire_date:f-retire'].forEach(function (s) { var k = s.split(':'); var x = v(k[1]); if (x && !isDate(x)) bad.push('日付'); d[k[0]] = x || null; });
    d.gender = v('f-gender') || null;   /* 'M'・'F'（統合 0102） */
    var ins = obj(d.ins);
    var empKeep = {}; ['from', 'to'].forEach(function (k) { if (obj(ins.emp)[k] !== undefined) empKeep[k] = ins.emp[k]; });   /* 雇保は on・from・to だけ（std は持たない） */
    d.ins = Object.assign({}, ins, { health: Object.assign({}, obj(ins.health), { on: on('f-h-on'), std: n('f-h-std', '健保の標準報酬') }),
      pension: Object.assign({}, obj(ins.pension), { on: on('f-p-on'), std: n('f-p-std', '厚年の標準報酬') }), emp: Object.assign(empKeep, { on: on('f-e-on') }), care_exempt: on('f-care-ex') });
    var tax = Object.assign({}, obj(d.tax), { dependents_checked: on('f-depok') }), deps = n('f-deps', '扶養親族等の数');
    if (v('f-col')) tax.col = v('f-col'); else delete tax.col;   /* 区分・扶養の数は空を送れない（統合 0102）ので、空の時は鍵ごと外す */
    if (deps == null) delete tax.dependents; else if (deps !== deps || deps % 1 || deps > 30) bad.push('扶養親族等の数'); else tax.dependents = deps;
    d.tax = tax;
    var rt = Object.assign({}, obj(d.resident_tax));
    c.months.forEach(function (m, i) { var x = n('f-rt' + i, '住民税'); if (x == null) delete rt[m]; else rt[m] = x; });
    /* 今の年度（6月〜翌5月）と前の年度だけを残す（DB は24か月まで・古い月の鍵を外す） */
    var rtMin = shiftYm(c.months[0], -12), rtMax = c.months[c.months.length - 1];
    Object.keys(rt).forEach(function (m) { if (!isYm(m) || m < rtMin || m > rtMax) delete rt[m]; });
    d.resident_tax = rt;
    d.no_attendance = on('f-noatt'); d.exclude = on('f-excl');
    /* 従業員番号（freee の番号・20字まで）。空なら、前に値があった時だけ空に戻す（空の人に鍵を足さない） */
    var empIn = v('f-emp');
    if (empIn.length > 20) bad.push('従業員番号（20字まで）');
    else if (empIn) d.freee_emp_num = empIn;
    else if ('freee_emp_num' in obj(p.data)) d.freee_emp_num = null;
    var empEx = !!(empIn && window.PayrollFreeeSlips && typeof window.PayrollFreeeSlips.excluded === 'function' && window.PayrollFreeeSlips.excluded(empIn));
    if (p.staff_id.indexOf('p:') === 0 && !d.name) d.name = p.name;
    if (bad.length) { say('数の形が違う欄があります：' + bad.filter(function (x, i) { return bad.indexOf(x) === i; }).join('・') + '（半角の数字で書いてください）'); return; }
    var done = hold(btn, '保存しています…');
    /* 同じ日付の版があれば今の版で上書き、無ければ新しい版（rev 0）で足す（統合 0102 の payroll_profile_put） */
    var from = v('f-from'), same = p.versions.filter(function (x) { return x.effective_from === from; })[0];
    rpc('payroll_profile_put', { p_staff_id: p.staff_id, p_effective_from: from, p_data: d, p_rev: same ? same.rev : 0, p_reason: reason }).then(okOr).then(function () {
      done(); closeDlg(); toast('給与の設定を保存しました。計算し直してください。' + (empEx ? '従業員番号が ' + EXC() + ' で始まるので、freee に登録の無い人として比べる対象から外します。' : '')); return load(false);
    })['catch'](function (e) { done(); fail(e, '給与の設定の保存'); });
  }
  function openBank(sid) {
    var p = profOf(sid); if (!p) return;
    var h = '<p>' + esc(p.name) + ' さんの振込先（今: ' + esc(bankText(p.bank_last4) || 'なし') + '）。入れた番号は画面に残しません。保存すると前の振込先と置き換わります。</p>';
    for (var i = 0; i < 3; i++) {
      h += '<fieldset><legend>口座 ' + (i + 1) + (i ? '（使う時だけ）' : '') + '</legend><div class="kv">' + inp('b-bk' + i, '銀行コード（4桁）', '', NUMA + ' maxlength="4"') + inp('b-br' + i, '支店コード（3桁）', '', NUMA + ' maxlength="3"') +
        sel('b-ty' + i, '種目', '1', [['1', '普通'], ['2', '当座'], ['4', '貯蓄']]) + inp('b-no' + i, '口座番号（7桁まで）', '', NUMA + ' maxlength="7"') + inp('b-kn' + i, '名義（カナ）', '', ' maxlength="30"') +
        (i ? inp('b-am' + i, 'この口座へ送る額（円）', '', NUMA) : '<span>この口座へ送る額</span><span>残り全部</span>') + '</div></fieldset>';
    }
    h += '<div class="kv"><label for="b-reason">理由（必ず書く）</label><input id="b-reason" maxlength="200" autocomplete="off"></div>';
    openDlg('口座を入れる（下4桁だけ表示）', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="bank-go">保存する</button>', { mode: 'bank', sid: sid, dirtyCheck: true });
  }
  /* 口座の名義（カナ）を、振込データと同じ字の直し（PayrollExport.zenginText）で確かめる。使えない字がある・半角にして30字を超える時は文を返す（保存しない・2026-11-21）。
     保存するのは入れたままの名義（書き出しの時に同じ直しを通す） */
  function kanaCheck(kn) {
    var x = X();
    if (!x || typeof x.zenginText !== 'function') return '名義（カナ）を確かめられませんでした（部品が読めません）。読み直してください。';
    var z = x.zenginText(kn);
    if (z.bad.length) return '名義（カナ）に振込で使えない字があります（' + z.bad.join(' ') + '）。カタカナ・英数字と ( ) - . / , で書いてください。';
    if (z.text.length > 30) return '名義（カナ）が長すぎます（半角にして ' + z.text.length + ' 字・30字まで）。通帳の名義のとおりに、30字に収まる形で書いてください。';
    return '';
  }
  function bankGo(btn) {
    var p = dlgCtx && profOf(dlgCtx.sid); if (!p) return;
    var reason = v('b-reason'); if (!reason) { say(NG.reason); return; }
    var acc = [], bad = false;
    for (var i = 0; i < 3; i++) {
      var bk = v('b-bk' + i), br = v('b-br' + i), no = v('b-no' + i), kn = v('b-kn' + i);
      if (!bk && !br && !no && !kn) continue;
      if (!/^\d{4}$/.test(bk) || !/^\d{3}$/.test(br) || !/^\d{1,7}$/.test(no) || !kn) { bad = true; break; }
      var am = i ? v('b-am' + i).replace(/[,，\s円]/g, '') : 'rest';
      if (i && !/^\d{1,8}$/.test(am)) { bad = true; break; }
      acc.push({ bank_code: bk, branch_code: br, type: v('b-ty' + i), number: ('0000000' + no).slice(-7), name_kana: kn, amount_or_rest: i ? parseInt(am, 10) : 'rest' });
    }
    if (bad) { say(NG.badbank + '（2つ目からは送る額も書きます）'); return; }
    for (i = 0; i < acc.length; i++) { var kq = kanaCheck(acc[i].name_kana); if (kq) { say('口座 ' + (i + 1) + ' の' + kq); return; } }
    if (!acc.length && !bankOf({ staff_id: p.staff_id }).length) { say('口座を1つ以上入れてください。'); return; }
    var go = function () {
    var done = hold(btn, '保存しています…');
    rpc('payroll_bank_put', { p_staff_id: p.staff_id, p_accounts: acc, p_reason: reason }).then(okOr).then(function () {
      var gone = !acc.length; acc = null; done(); closeDlg(); toast(gone ? '口座を消しました（振込しない人になりました）。' : '口座を保存しました。'); return load(true);
    })['catch'](function (e) { acc = null; done(); fail(e, '口座の保存'); });
    };
    if (acc.length) go();
    else ask(p.name + ' さんの口座を全部消して「口座なし（振込しない）」にしますか？').then(function (ok) { if (ok && dlgCtx && dlgCtx.mode === 'bank') go(); });
  }

  /* ── freee の書き出しを取り込む（管理者・ファイルは保存しない） ──
     見出しは候補の並びで探す（前から順に・最初に当たった列）。freee 公式ヘルプ（2026-11-20 確認）の
     「従業員情報の出力」の項目名 → 「一括登録テンプレート」の見出し → 前の仮置きの名前 の順。
     見出しは空白（全角・半角）を除き、コロン・括弧・数字の全角半角をそろえて比べる（normHead） */
  var HEAD = {
    emp: ['従業員番号', '社員番号'],
    name: ['氏名'], sei: ['姓'], mei: ['名'], disp: ['freee人事労務での表示名'],
    pay_type: ['給与方式', '給与形態'],
    base: ['基本給'], hourly: ['時給'], daily: ['日給'], board: ['役員報酬'],
    birth: ['生年月日'], gender: ['性別'], entry: ['入社日'], retire: ['退職日'],
    hstd: ['健康保険標準報酬月額', '健康保険・標準報酬月額', '健康保険の標準報酬月額'],
    pstd: ['厚生年金保険標準報酬月額', '厚生年金保険・標準報酬月額', '厚生年金保険の標準報酬月額'],
    emp_ins: ['雇用保険に加入しているか', '雇用保険加入', '雇用保険'],
    hins: ['健康保険に加入しているか', '健康保険加入', '健康保険'],
    pins: ['厚生年金保険に加入しているか', '厚生年金保険加入', '厚生年金保険', '厚生年金'],
    tax_col: ['所得税納税者区分', '納税者区分', '税額表の区分'],
    deps: ['所得税法上の扶養親族等の数', '扶養親族等の数'],
    commute: ['通勤費の金額', '通勤手当の金額・単価', '通勤手当'],
    bank: ['振込先口座1：金融機関コード', '銀行コード'], branch: ['振込先口座1：支店コード', '支店コード'],
    acct_type: ['振込先口座1：預金種類', '口座種別'], acct_no: ['振込先口座1：口座番号', '口座番号'],
    kana: ['振込先口座1：口座名義（カナ）', '口座名義'],
    bank_one: ['振込先口座']
  };
  /* 取り込みの画面の上の1行で「読めなかった」と知らせる主な項目（自前の名前だけ・CSV の見出しの文字も値も出さない） */
  var HEAD_MAIN = [['従業員番号', ['emp']], ['氏名', ['name']], ['給与方式', ['pay_type']], ['基本給', ['base']], ['標準報酬', ['hstd', 'pstd']],
    ['加入', ['emp_ins', 'hins', 'pins']], ['納税者区分', ['tax_col']], ['扶養', ['deps']], ['口座', ['bank', 'branch', 'acct_no', 'kana']]];
  function normHead(s) {
    return String(s == null ? '' : s).replace(/^﻿/, '').replace(/[\s　]/g, '').replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }
  /* 見出しの行 → 項目ごとの列の番号（無ければ -1）・読めた項目の数・読めなかった主な項目・2つ目以降の口座の列（DOM にも bs にも依らない） */
  function importCols(headRow) {
    var head = (headRow || []).map(normHead), col = {}, k, i;
    for (k in HEAD) {
      col[k] = -1;
      for (i = 0; i < HEAD[k].length && col[k] < 0; i++) col[k] = head.indexOf(normHead(HEAD[k][i]));
    }
    var nameOk = col.name >= 0 || (col.sei >= 0 && col.mei >= 0) || col.disp >= 0;
    var found = Object.keys(HEAD).filter(function (x) { return col[x] >= 0 && ['name', 'sei', 'mei', 'disp', 'bank_one'].indexOf(x) < 0; }).length + (nameOk ? 1 : 0);
    var missing = HEAD_MAIN.filter(function (m) { return m[0] === '氏名' ? !nameOk : m[1].some(function (x) { return col[x] < 0; }); }).map(function (m) { return m[0]; });
    var more = [];
    head.forEach(function (h, j) { if (/^振込先口座([2-9]|\d{2,}):/.test(h)) more.push(j); });
    return { col: col, nameOk: nameOk, found: found, missing: missing, more: more };
  }
  function parseCsv(text) {
    var rows = [], row = [], f = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (_) { return new TextDecoder('shift_jis').decode(buf); }
  }
  function normName(s) { return String(s || '').replace(/[\s　]/g, ''); }
  function toDate(s) { s = String(s || '').trim().replace(/\//g, '-'); var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : null; }
  /* 加入の列（加入・あり・○ など／未加入・なし・× など）。分からない値は null */
  function yesNo(s) {
    s = String(s == null ? '' : s).trim();
    if (/^(加入|加入する|加入している|あり|有|有り|対象|○|〇|◯|はい|する|1|true)$/i.test(s)) return true;
    if (/^(未加入|加入しない|加入していない|なし|無|無し|対象外|×|✕|いいえ|しない|0|false)$/i.test(s)) return false;
    return null;
  }
  function toNum(s) { s = String(s || '').replace(/[,，\s円]/g, ''); return /^\d+$/.test(s) ? parseInt(s, 10) : null; }
  /* 給与方式の値（freee の 月給・時給・日給、「〜制」、日給月給は月給、前の仮置きの 役員） */
  var PAY_IN = { '月給': 'monthly', '月給制': 'monthly', '日給月給': 'monthly', '時給': 'hourly', '時給制': 'hourly', '日給': 'daily', '日給制': 'daily', '役員': 'board', '役員報酬': 'board' };
  /* 預金種類（全銀の種目: 普通1・当座2・貯蓄4） */
  /* 納税者区分（甲欄・乙欄。丙欄は対象外） */
  var TAX_IN = { '甲': 'kou', '甲欄': 'kou', '乙': 'otsu', '乙欄': 'otsu' };
  var ACCT_IN = { '普通': '1', '普通預金': '1', '当座': '2', '当座預金': '2', '貯蓄': '4', '貯蓄預金': '4' };
  /* 読んだ行 → 違いの表の行。profs は今の職員の設定（bs.profiles）、from は今の月分の始まり（DOM にも bs にも依らない・試験から呼ぶ） */
  function buildImport(rows, profs, from) {
    if (rows.length < 2) throw new Error('行がありません');
    var cm = importCols(rows[0]), col = cm.col;
    if (!cm.nameOk && col.emp < 0) throw new Error('見出しに「従業員番号」（社員番号）か「氏名」（姓・名）がありません');
    profs = profs || [];
    var out = [];
    rows.slice(1).forEach(function (r) {
      function cell(key) { return col[key] >= 0 ? String(r[col[key]] == null ? '' : r[col[key]]).trim() : ''; }
      /* 氏名は「氏名」→「姓」＋「名」→ freee人事労務での表示名 の順（照合は normName で空白を除いて比べる） */
      function g(key) {
        if (key !== 'name') return cell(key);
        var sm = [cell('sei'), cell('mei')].filter(function (x) { return x; }).join(' ');
        return cell('name') || sm || cell('disp');
      }
      var emp = g('emp'), nm = g('name'), p = null;
      profs.forEach(function (x) { if (emp && String(x.data.freee_emp_num || '') === emp) p = x; });
      if (!p && nm) { var hit = profs.filter(function (x) { return normName(x.name) === normName(nm) || (!!x.shift_name && normName(x.shift_name) === normName(nm)); });   /* 表示名かシフトの名前のどちらかで当たる（統合 0107） */ if (hit.length === 1) p = hit[0]; }
      /* 氏名で当たった人に別の従業員番号があり、CSV の番号と違えば当てない（同名の別人に上書きしない） */
      var empNg = !!(p && emp && String(p.data.freee_emp_num || '') !== '' && String(p.data.freee_emp_num) !== emp);
      if (empNg) p = null;
      var pt = PAY_IN[g('pay_type')] || null;
      /* 時給・日給の人は専用の列（前の仮置き）に値があればそれ、無ければ基本給の列（freee の書き出しには専用の列が無い） */
      var wage = function (k2) { var x = toNum(g(k2)); return x != null ? x : toNum(g('base')); };
      var patch = {}, ch = [];
      if (empNg) ch.push('⚠ 従業員番号が違うので当てません');
      function setv(key, val, label, show) {
        if (val == null || val === '') return;
        var old = p ? key.split('.').reduce(function (o, k2) { return o == null ? null : o[k2]; }, p.data) : null;
        if (String(old == null ? '' : old) === String(val)) return;
        patch[key] = val; ch.push(label + '：' + (show ? show(old) : (old == null || old === '' ? '（空）' : old)) + ' → ' + (show ? show(val) : val));
      }
      var money = function (x) { return x == null || x === '' ? '（空）' : yen(x) + '円'; };
      setv('freee_emp_num', emp || null, '従業員番号');
      setv('pay_type', pt, '給与形態', function (x) { return PAY_TYPE[x] || '（空）'; });
      setv('base', pt === 'hourly' ? wage('hourly') : pt === 'daily' ? wage('daily') : toNum(g('base')), '基本給・時給など', money);
      setv('board_pay', toNum(g('board')), '役員報酬', money);
      setv('birth_date', toDate(g('birth')), '生年月日');
      /* 性別の「未選択」（freee の取込の値）は空と同じ（変えない） */
      setv('gender', { '男': 'M', '男性': 'M', '女': 'F', '女性': 'F' }[g('gender')] || null, '性別');
      setv('entry_date', toDate(g('entry')), '入社日'); setv('retire_date', toDate(g('retire')), '退職日');
      setv('ins.health.std', toNum(g('hstd')), '健保の標準報酬', money); setv('ins.pension.std', toNum(g('pstd')), '厚年の標準報酬', money);
      /* 加入の印（ins.*.on）: 加入の列があればそれ、無ければ標準報酬が入っていれば加入（仮置き 2026-11-19）。どちらも無ければ決めない（計算の部品が ins_unset で知らせる） */
      var onTxt = function (x) { return x === true ? '加入' : x === false ? '加入しない' : '（空）'; };
      var hon = yesNo(g('hins')), pon = yesNo(g('pins')), eon = yesNo(g('emp_ins'));
      if (hon === null && toNum(g('hstd')) > 0) hon = true;
      if (pon === null && toNum(g('pstd')) > 0) pon = true;
      setv('ins.health.on', hon, '健康保険の加入', onTxt); setv('ins.pension.on', pon, '厚生年金の加入', onTxt); setv('ins.emp.on', eon, '雇用保険の加入', onTxt);
      setv('tax.col', TAX_IN[g('tax_col')] || null, '源泉の区分');
      /* 丙欄（日雇い）は今の甲乙の計算の対象外なので設定しない（今の値のまま） */
      if (/^丙/.test(g('tax_col'))) ch.push('⚠ 丙欄は取り込みません');
      /* 甲・乙・丙のどれでもない値は読めないと知らせ、甲乙・扶養は「未確認」にする（扶養の数が空の行は次の行で入る） */
      var taxNg = !!g('tax_col') && !TAX_IN[g('tax_col')] && !/^丙/.test(g('tax_col'));
      if (taxNg) ch.push('⚠ 納税者区分が読めません');
      if (taxNg && toNum(g('deps')) != null) setv('tax.dependents_checked', false, '甲乙・扶養の確かめ', function (x) { return x === true ? '確かめた' : x === false ? '未確認' : '（空）'; });
      setv('tax.dependents', toNum(g('deps')), '扶養親族等の数');
      /* 扶養・甲乙の列が無い（空の）行は「未確認」で入れる（列から読めた時は今の印のまま・代表者の決定 2026-11-19） */
      if (!g('tax_col') || toNum(g('deps')) == null) setv('tax.dependents_checked', false, '甲乙・扶養の確かめ', function (x) { return x === true ? '確かめた' : x === false ? '未確認' : '（空）'; });
      setv('commute.monthly', toNum(g('commute')), '通勤手当', money);
      var bank = null;
      if (g('bank') || g('acct_no')) {
        var no = g('acct_no').replace(/\D/g, '');
        bank = { bank_code: g('bank').replace(/\D/g, ''), branch_code: g('branch').replace(/\D/g, ''), type: ACCT_IN[g('acct_type')] || '1', number: ('0000000' + no).slice(-7), name_kana: g('kana'), amount_or_rest: 'rest' };
        if (!/^\d{4}$/.test(bank.bank_code) || !/^\d{3}$/.test(bank.branch_code) || !/^\d{1,7}$/.test(no)) { ch.push('⚠ 口座の形が違うので送りません'); bank = null; }
        else if (!bank.name_kana) { ch.push('⚠ 口座名義が無いので送りません'); bank = null; }
        /* 名義は振込データと同じ字の直しで確かめる（使えない字・半角で30字を超える時は送らない・2026-11-21） */
        else if (kanaCheck(bank.name_kana)) { ch.push('⚠ 口座名義に振込で使えない字があるか、半角にして30字を超えるので、口座は送りません（口座の画面で入れてください）'); bank = null; }
        /* 預金種類の値があって分からない時は送らない（空・列なしは今のとおり普通） */
        else if (g('acct_type') && !ACCT_IN[g('acct_type')]) { ch.push('⚠ 預金種類が分からないので送りません'); bank = null; }
        else ch.push('口座：＊＊＊' + no.slice(-4));
      }
      /* 口座は分かれた列（振込先口座1：…）だけ使う。書き出しの「振込先口座」1列は中の形が分からないので推測して分けない */
      else if (col.bank < 0 && col.acct_no < 0 && g('bank_one')) ch.push('⚠ 口座は1列の形なので取り込みません（口座の画面で入れてください）');
      if (cm.more.some(function (j) { return String(r[j] == null ? '' : r[j]).trim() !== ''; })) ch.push('⚠ 2つ目以降の口座は取り込みません');
      var data = p ? applyPatch(p, patch) : null;
      if (p && !data.pay_type) ch.push('⚠ 給与形態が無いので設定は送りません');
      out.push({ name: nm || emp, staff_id: p ? p.staff_id : null, pname: p ? p.name : '', patch: patch, data: data && data.pay_type ? data : null, bank: bank, changes: ch,
        hasNow: !!(p && from && p.versions.some(function (x) { return x.effective_from === from; })), hasBank: !!(p && p.bank_last4.length) });
    });
    /* 同じ職員に2行以上当たったら、その全部の行を送らない（後の行が前の行を黙って上書きしない） */
    var seen = {};
    out.forEach(function (r) { if (r.staff_id) seen[r.staff_id] = (seen[r.staff_id] || 0) + 1; });
    out.forEach(function (r) { if (r.staff_id && seen[r.staff_id] > 1) { r.data = null; r.bank = null; r.changes.push('⚠ 同じ職員に2行当たったので送りません'); } });
    /* 画面の上の1行に出す数（項目の名前だけ・値は持たない）。importRows と一緒に捨てる */
    out.cols = { found: cm.found, missing: cm.missing };
    return out;
  }
  /* 今の設定に違いを当てた全体（取り込みは足すだけなので、送るのは全体） */
  function applyPatch(p, patch) {
    var d = JSON.parse(JSON.stringify(p.data || {}));
    Object.keys(patch).forEach(function (k) {
      var path = k.split('.'), o = d;
      for (var i = 0; i < path.length - 1; i++) { if (!o[path[i]] || typeof o[path[i]] !== 'object') o[path[i]] = {}; o = o[path[i]]; }
      o[path[path.length - 1]] = patch[k];
    });
    if (p.staff_id.indexOf('p:') === 0 && !d.name) d.name = p.name;
    return d;
  }
  function importHtml() {
    var h = '<div class="cd"><h2>freee の書き出しを取り込む（管理者）</h2><p class="help">freee 人事労務から書き出した従業員の CSV を選ぶと、画面の中だけで読み、今の設定との違いを見せます。ファイルはどこにも保存しません。「送る」を押すまでデータベースは変わりません。取り込みは足すだけで、この月分の版がもうある人の設定と、口座がもうある人の口座は書き換えません（直す時は「直す」「口座」から）。</p>';
    h += '<div class="row"><label for="i-file">CSV のファイル</label><input type="file" id="i-file" accept=".csv,text/csv"></div>';
    if (importErr) h += '<div class="band ng" role="alert">' + esc(importErr) + '</div>';
    if (importRows) {
      var ok = importRows.filter(importable), ic = importRows.cols;
      if (ic) h += '<p class="help">見出しから読めた項目：' + esc(ic.found) + '個' + (ic.missing.length ? '（読めなかった主な項目：' + esc(ic.missing.join('・')) + '）' : '（主な項目はすべて読めました）') + '</p>';
      h += '<div class="tw"><table><thead><tr><th>CSV の氏名</th><th>この画面の職員</th><th>違い</th></tr></thead><tbody>' + importRows.map(function (r) {
        var keep = [];
        if (r.staff_id && r.data && r.hasNow) keep.push('この月分の版がもうあるので設定は書き換えません');
        if (r.staff_id && r.bank && r.hasBank) keep.push('口座がもうあるので口座は書き換えません');
        return '<tr><td>' + esc(r.name) + '</td><td>' + (r.staff_id ? esc(r.pname) : '<span class="tag ng">⚠ 見つかりません（送りません）</span>') + '</td><td>' + (r.changes.length ? esc(r.changes.join('／')) : '違いなし') + (keep.length ? ' <span class="tag warn">' + esc(keep.join('・')) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      h += '<div class="row"><button type="button" class="btn" data-act="imp-cancel">やめる</button><button type="button" class="btn pri" data-act="imp-go"' + (ok.length ? '' : ' disabled') + '>' + esc(ok.length) + '人分を送る</button></div>';
    }
    return h + '</div>';
  }
  function importFile(file) {
    importRows = null; importErr = null;
    if (!file) { paint(); return; }
    if (file.size > 2 * 1024 * 1024) { importErr = 'ファイルが大きすぎます（2MB まで）。'; paint(); return; }
    var my = gen;
    file.arrayBuffer().then(function (buf) {
      if (my !== gen) return;
      try { var p1 = period(); importRows = orderStaff(buildImport(parseCsv(decode(buf)), bs ? bs.profiles : [], p1 ? p1.from : null)); } catch (e) { importErr = '読めませんでした：' + (e && e.message ? e.message : '形が違います') + '。freee の従業員の CSV を選んでください。'; }
      buf = null; paint();
    }, function (e) { note('取り込みの読み込み', e); importErr = 'ファイルを読めませんでした。'; paint(); });
  }
  function importable(r) { return !!r.staff_id && ((r.data && Object.keys(r.patch).length > 0) || !!r.bank); }
  function importGo(btn) {
    if (!importRows || !isAdmin()) return;
    var p0 = period(); if (!p0) { say('月分の期間が分かりません。読み直してください。'); return; }
    var rows = importRows.filter(importable);
    if (!rows.length) return;
    var payload = { profiles: [], banks: [] };
    rows.forEach(function (r) {
      if (r.data && Object.keys(r.patch).length) payload.profiles.push({ staff_id: r.staff_id, effective_from: p0.from, data: r.data });
      if (r.bank) payload.banks.push({ staff_id: r.staff_id, accounts: [r.bank] });
    });
    if (!payload.profiles.length) delete payload.profiles;
    if (!payload.banks.length) delete payload.banks;
    ask(rows.length + '人分の設定（口座を含む）を送ります。よろしいですか？').then(function (ok) {
    if (!ok || !importRows) { payload = null; return; }
    var done = hold(btn, '送っています…');
    rpc('payroll_import_put', { p_payload: payload }).then(okOr).then(function (r) {
      payload = null; rows = null; importRows = null; done();
      var pr = obj(r.profiles), bk = obj(r.banks);
      toast('取り込みました（設定 ' + num(pr.added) + '人・口座 ' + num(bk.added) + '人を足しました。もうあったので書き換えなかったのは 設定 ' + num(pr.skipped) + '人・口座 ' + num(bk.skipped) + '人）。計算し直してください。');
      return load(false);
    })['catch'](function (e) { payload = null; rows = null; done(); fail(e, '取り込み'); });
    });
  }

  /* ── 設定（管理者だけ） ──
     形は統合 0102 の payroll_settings_ok（知らない鍵・空の文字・null の数は断られる）。空の欄は鍵ごと外して送る（計算の部品の既定で動く） */
  function settingsHtml() {
    var c = cfg(), ot = obj(c.ot_rates), rd = obj(c.round), bf = obj(c.bank_from), zg = obj(c.zengin);
    var RND = [['ceil', '切り上げ'], ['floor', '切り捨て'], ['round', '四捨五入']];
    var h = '<div class="cd"><h2>給与の設定（管理者だけ）</h2><p class="help">締め日は勤怠管理の設定が正本です（ここでは変えません）。空の欄は既定の値で計算します。</p>';
    h += '<fieldset><legend>支給日・徴収</legend><div class="kv">' + inp('s-payday', '支給日（毎月 何日）', c.pay_day != null ? c.pay_day : 27, NUMA) + sel('s-shift', '土日・休みの日の時', c.pay_day_shift || 'before', [['before', '前の営業日'], ['after', '後の営業日'], ['none', '寄せない']]) +
      sel('s-si', '社会保険の徴収', c.si_month || 'next', [['next', '翌月徴収'], ['current', '当月徴収']]) + sel('s-tax', '所得税の出し方', c.tax_method || 'table', [['table', '税額表'], ['computer', '電算機の特例']]) +
      sel('s-night', '深夜の割増', c.night_premium || 'included', [['included', '夜勤手当に含む（不足は警告）'], ['pay', '別に払う']]) + '</div>' +
      '<label for="s-hol">支給日を寄せる休みの日（祝日など・1行に1日・例 2026-11-23）</label><br><textarea id="s-hol" rows="3" style="width:100%" autocomplete="off">' + esc(arr(c.holidays).join('\n')) + '</textarea></fieldset>';
    h += '<fieldset><legend>割増率・所定時間</legend><div class="kv">' + inp('s-ot-in', '法定内残業（倍）', ot['in'], ' inputmode="decimal"') + inp('s-ot-out', '時間外（倍）', ot.out, ' inputmode="decimal"') + inp('s-ot-60', '60時間超の上乗せ', ot.over60, ' inputmode="decimal"') +
      inp('s-ot-night', '深夜の上乗せ', ot.night, ' inputmode="decimal"') + inp('s-ot-hol', '法定休日（倍）', ot.holiday, ' inputmode="decimal"') +
      inp('s-amh', '月平均所定労働時間（既定）', c.avg_month_hours_default, ' inputmode="decimal"') + inp('s-amd', '月平均所定労働日数（既定）', c.avg_month_days_default, ' inputmode="decimal"') + '</div>' +
      '<div class="row">' + chk('s-abs', '欠勤控除をする', c.absence_deduct !== false) + chk('s-late', '遅刻・早退の控除をする', c.late_deduct !== false) + '</div></fieldset>';
    h += '<fieldset><legend>端数</legend><div class="kv">' + sel('s-r-hu', '1時間あたりの賃金', rd.hour_unit || 'ceil', RND) + sel('s-r-pr', '割増賃金', rd.premium || 'ceil', RND) + sel('s-r-ra', '日割り', rd.prorate || 'floor', RND) +
      sel('s-r-du', '控除の1時間あたり', rd.deduct_unit || 'floor', RND) + sel('s-r-de', '控除の額', rd.deduct || 'floor', RND) + '</div></fieldset>';
    h += '<fieldset><legend>振込元・全銀</legend><div class="kv">' + inp('s-bf-cc', '委託者コード（10桁）', bf.consignor_code, NUMA) + inp('s-bf-ck', '委託者名（カナ）', bf.consignor_kana) +
      inp('s-bf-bk', '振込元の銀行コード（4桁）', bf.bank_code, NUMA) + inp('s-bf-bkk', '振込元の銀行名（カナ）', bf.bank_kana) + inp('s-bf-br', '支店コード（3桁）', bf.branch_code, NUMA) + inp('s-bf-brk', '支店名（カナ）', bf.branch_kana) +
      sel('s-bf-ty', '種目', String(bf.type || '1'), [['1', '普通'], ['2', '当座']]) + inp('s-bf-no', '口座番号（7桁まで）', bf.number, NUMA) +
      sel('s-zk', '振込の種別', zg.kind || '21', [['21', '総合振込'], ['11', '給与振込']]) + inp('s-co', '明細に刷る事業者名', c.company_name) + '</div>' +
      chk('s-zen', '振込データ（全銀形式）の書き出しを使う', c.zengin_enabled === true) + '</fieldset>';
    h += '<div class="row"><button type="button" class="btn pri" data-act="set-go">設定を保存する</button></div></div>';
    h += allowancesHtml();
    h += '<div class="cd"><h2>給与の名簿（給与の画面を使える人）</h2><p class="help">管理者のほかに使える人のメールを入れます。名簿の人は事務所のアカウントで、二段階のログインを済ませている時だけ使えます（データベースが確かめます）。加えて「アプリの使える人」でその人に「給与」を許してください。</p>';
    if (members === null) h += '<button type="button" class="btn" data-act="mem-load">名簿を読む</button>';
    else {
      h += members.length ? '<ul>' + members.map(function (m, i) { return '<li>' + esc(m.email) + (m.active === false || (m.role && m.role !== 'office') ? ' <span class="tag warn">⚠ 事務所の有効なアカウントではありません（使えません）</span>' : '') + ' <button type="button" class="btn ng" data-act="mem-del" data-i="' + esc(i) + '">外す</button>' + (pinOn ? ' <button type="button" class="btn" data-act="pin-reset" data-i="' + esc(i) + '">暗証番号を消す（忘れた人用）</button>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="help">名簿に人はいません（管理者だけが使えます）。</p>';
      h += '<div class="row"><label for="m-add">メール</label><input id="m-add" type="email" inputmode="email" autocomplete="off"><button type="button" class="btn" data-act="mem-add">名簿に足す</button></div>';
    }
    h += '</div>';
    return h + auditHtml();
  }
  function settingsGo(btn) {
    if (!isAdmin()) return;
    var bad = [];
    function n(id, label) { var x = nOr(id); if (x !== x) bad.push(label); return x; }
    function setNum(o, k, x) { if (x == null || x !== x) delete o[k]; else o[k] = x; }
    function setTxt(o, k, x) { if (x) o[k] = x; else delete o[k]; }
    var c = JSON.parse(JSON.stringify(cfg()));
    c.zengin_enabled = on('s-zen');   /* 真偽・既定は使わない（DB の payroll_settings_ok が受ける） */
    /* 支給日: 空と形の違いを分けて言い、欄へ移って赤枠にする（「27日」「２７」も 27 と読む・2026-11-24） */
    var pdEl = $('s-payday'), pdRaw = han(v('s-payday')).replace(/[\s日]/g, ''), pd = /^\d+$/.test(pdRaw) ? Number(pdRaw) : NaN;
    if (pdEl) pdEl.removeAttribute('aria-invalid');
    if (!(pd >= 1 && pd <= 31)) {
      if (pdEl) { pdEl.setAttribute('aria-invalid', 'true'); try { pdEl.focus(); } catch (_) {} }
      say(pdRaw === '' ? '支給日が空です。毎月の支給日を 1〜31 の数で入れてください（例: 27）。' : '支給日は 1〜31 の数で入れてください（例: 27）。今の値:「' + v('s-payday') + '」');
      return;
    }
    c.pay_day = pd;
    c.pay_day_shift = v('s-shift'); c.si_month = v('s-si'); c.tax_method = v('s-tax'); c.night_premium = v('s-night');
    var hol = v('s-hol').split(/[\s,、]+/).filter(Boolean);
    if (hol.some(function (d) { return !isDate(d) || isNaN(Date.parse(d + 'T00:00:00Z')) || new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d; })) bad.push('休みの日（YYYY-MM-DD）');
    c.holidays = hol.filter(function (d, i) { return hol.indexOf(d) === i; }).sort();
    var ot = Object.assign({}, obj(c.ot_rates));
    [['in', 's-ot-in', '法定内残業'], ['out', 's-ot-out', '時間外'], ['over60', 's-ot-60', '60時間超'], ['night', 's-ot-night', '深夜'], ['holiday', 's-ot-hol', '法定休日']].forEach(function (x) {
      var r = n(x[1], x[2]); if (r != null && r === r && r > 3) bad.push(x[2] + '（3倍まで）'); setNum(ot, x[0], r);
    });
    c.ot_rates = ot;
    setNum(c, 'avg_month_hours_default', n('s-amh', '月平均所定労働時間')); setNum(c, 'avg_month_days_default', n('s-amd', '月平均所定労働日数'));
    c.absence_deduct = on('s-abs'); c.late_deduct = on('s-late');
    c.round = Object.assign({}, obj(c.round), { hour_unit: v('s-r-hu'), premium: v('s-r-pr'), prorate: v('s-r-ra'), deduct_unit: v('s-r-du'), deduct: v('s-r-de') });
    var bf = Object.assign({}, obj(c.bank_from));
    [['consignor_code', 's-bf-cc', /^\d{10}$/, '委託者コード（10桁）'], ['bank_code', 's-bf-bk', /^\d{4}$/, '振込元の銀行コード（4桁）'], ['branch_code', 's-bf-br', /^\d{3}$/, '支店コード（3桁）'],
      ['number', 's-bf-no', /^\d{1,7}$/, '口座番号（7桁まで）']].forEach(function (x) {
      var val = v(x[1]).replace(/\s/g, '');
      if (val && !x[2].test(val)) bad.push(x[3]);
      if (x[0] === 'number' && val) val = ('0000000' + val).slice(-7);
      setTxt(bf, x[0], val);
    });
    setTxt(bf, 'consignor_kana', v('s-bf-ck')); setTxt(bf, 'bank_kana', v('s-bf-bkk')); setTxt(bf, 'branch_kana', v('s-bf-brk')); bf.type = v('s-bf-ty');
    c.bank_from = bf;
    c.zengin = Object.assign({}, obj(c.zengin), { kind: v('s-zk') });
    setTxt(c, 'company_name', v('s-co'));
    if (bad.length) { say('形の違う欄があります：' + bad.filter(function (x, i) { return bad.indexOf(x) === i; }).join('・')); return; }
    var done = hold(btn, '保存しています…');
    rpc('payroll_settings_put', { p_config: c, p_rev: bs.settings.rev }).then(okOr).then(function () { done(); toast('設定を保存しました。'); return load(false); })['catch'](function (e) { done(); fail(e, '設定の保存'); });
  }

  /* 手当・控除の定義（管理者だけ・統合 0102 の payroll_allowance_put。消さずに「隠す」） */
  var CALC_KIND = [['fixed', '定額（月）'], ['count', '回数×単価'], ['night_shift', '夜勤の回数×単価'], ['day', '出勤日数×単価'], ['hour', '労働時間×単価']];
  var ATTRS = [['income_tax', '所得税の対象'], ['social_ins', '社会保険の対象（控除は「社会保険料として扱う」）'], ['labor_ins', '労働保険の対象'], ['overtime_base', '割増の基礎に入れる'],
    ['attendance_base', '欠勤・遅刻の控除の基礎に入れる'], ['fixed_wage', '固定的賃金'], ['min_wage', '最低賃金の判定に入れる'], ['prorate', '入社・退社の月は日割り'], ['includes_night_premium', '深夜の割増を含む（夜勤手当）']];
  function kindName(list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return list[i][1]; return k || '—'; }
  function allowancesHtml() {
    var list = bs.allowances.slice().sort(function (a, b) { return num(a.order) - num(b.order) || (a.code < b.code ? -1 : 1); });
    var h = '<div class="cd"><h2>手当・控除の定義（管理者だけ）</h2><p class="help">職員の給与設定で金額を入れる手当・控除の種類です。消さずに「隠す」で使わないようにします。直した時は、その月の給与を計算し直してください。</p>';
    h += list.length ? '<div class="tw"><table><thead><tr><th>コード</th><th>名前</th><th>区分</th><th>数え方</th><th class="num">並び</th><th>操作</th></tr></thead><tbody>' + list.map(function (a) {
      return '<tr><td>' + esc(a.code) + '</td><td class="nm">' + esc(a.name || '') + (a.hidden ? ' <span class="tag">隠す</span>' : '') + '</td><td>' + esc(a.sec === 'deduct' ? '控除' : '支給') + '</td><td>' + esc(kindName(CALC_KIND, a.calc)) + '</td><td class="num">' + esc(num(a.order)) + '</td>' +
        '<td><button type="button" class="btn" data-act="alw" data-code="' + esc(a.code) + '">直す</button></td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="help">まだありません。</p>';
    return h + '<div class="row"><button type="button" class="btn" data-act="alw">＋ 手当・控除を足す</button></div></div>';
  }
  function alwOf(code) { for (var i = 0; i < bs.allowances.length; i++) if (bs.allowances[i].code === code) return bs.allowances[i]; return null; }
  function openAlw(code) {
    if (!isAdmin()) return;
    var a = code ? alwOf(code) : null, at = obj(a && a.attrs), C0 = window.PayrollCalc, def = C0 && C0.attrsOf ? C0.attrsOf(a || {}) : {};
    var h = '<div class="kv">' + (a ? '<span>コード</span><b>' + esc(a.code) + '</b>' : inp('w-code', 'コード（英数字・「_」「-」・40字まで）', '', ' maxlength="40"')) +
      inp('w-name', '名前', a ? a.name : '', ' maxlength="40"') + sel('w-sec', '区分', a ? a.sec : 'pay', [['pay', '支給'], ['deduct', '控除']]) + sel('w-calc', '数え方', a ? a.calc : 'fixed', CALC_KIND) +
      inp('w-order', '並び（小さい順）', a ? num(a.order) : '', NUMA) + sel('w-round', '回数・時間で数える時の端数', a && a.round ? a.round : 'ceil', [['ceil', '切り上げ'], ['floor', '切り捨て'], ['round', '四捨五入']]) + '</div>';
    h += '<fieldset><legend>扱い（印の無い所は計算の既定）</legend><div class="row">' + ATTRS.map(function (x) { return chk('w-a-' + x[0], x[1], typeof at[x[0]] === 'boolean' ? at[x[0]] : !!def[x[0]]); }).join('') + '</div></fieldset>';
    h += '<div class="row">' + chk('w-hidden', '隠す（職員の給与設定に出さない）', !!(a && a.hidden)) + '</div>';
    openDlg(a ? '手当・控除を直す' : '手当・控除を足す', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="alw-go">保存する</button>', { mode: 'alw', code: code || null, dirtyCheck: true });
  }
  function alwGo(btn) {
    if (!isAdmin() || !dlgCtx || dlgCtx.mode !== 'alw') return;
    var a = dlgCtx.code ? alwOf(dlgCtx.code) : null, code = a ? a.code : v('w-code'), name = v('w-name');
    if (!a && !/^[A-Za-z0-9_-]{1,40}$/.test(code)) { say('コードは英数字と「_」「-」で40字までにしてください。'); return; }
    if (!a && alwOf(code)) { say('同じコードがもうあります。'); return; }
    if (!name) { say('名前を書いてください。'); return; }
    var ord = nOr('w-order'); if (ord !== ord || (ord != null && ord % 1)) { say('並びは整数で書いてください。'); return; }
    /* 今の定義を写してから上書きする（画面に無い鍵 unit・freee_id などを消さない） */
    var d = a ? JSON.parse(JSON.stringify(a)) : {};
    delete d.rev;
    d.code = code; d.name = name; d.sec = v('w-sec'); d.calc = v('w-calc'); d.order = ord == null ? 0 : ord; d.round = v('w-round'); d.hidden = on('w-hidden');
    var at = Object.assign({}, obj(d.attrs)); ATTRS.forEach(function (x) { at[x[0]] = on('w-a-' + x[0]); }); d.attrs = at;
    var done = hold(btn, '保存しています…');
    rpc('payroll_allowance_put', { p_def: d, p_rev: a ? a.rev : 0 }).then(okOr).then(function () { done(); closeDlg(); toast('手当・控除の定義を保存しました。計算し直してください。'); return load(true); })['catch'](function (e) { done(); fail(e, '手当の定義の保存'); });
  }

  /* 操作の記録（管理者だけ・統合 0102 の payroll_audit_get・直近30日）。前と後の中身は出さず、何を・いつ・だれが・理由だけ */
  var ACT_NAME = { run_save: '下書き保存', run_confirm: '確定', run_unconfirm: '確定の取り消し', run_stale: '確定の断り（入力が変わった）', profile_put: '職員の給与設定', bank_put: '口座', bank_export: '振込データの口座の受け取り',
    bank_export_stale: '振込データの断り（口座が直された）', settings_put: '給与の設定', allowance_put: '手当・控除の定義', member_add: '名簿に足す', member_remove: '名簿から外す', member_auto_remove: '名簿から自動で外す', import: 'freee からの取り込み',
    export_zengin: '振込データの書き出し', export_journal: '仕訳の書き出し', export_ledger: '賃金台帳の書き出し', export_payslip: '明細の印刷', export_csv: '明細一覧の書き出し',
    export_zengin_again: '振込データをもう一度書き出す確かめ', bank_export_again_ng: '振込データの断り（もう一度の書き出しの確かめが無い）' };
  function auditHtml() {
    var h = '<div class="cd"><h2>操作の記録（直近30日・管理者だけ）</h2><p class="help">確定・取り消し・設定や口座の変更・書き出しの記録です。口座は記録にも下4桁しか残りません。</p>';
    if (audit === null) return h + '<button type="button" class="btn" data-act="aud-load">記録を読む</button></div>';
    if (!audit.length) return h + '<p class="help">この30日の記録はありません。</p><button type="button" class="btn" data-act="aud-load">読み直す</button></div>';
    var nameOf = {}; bs.profiles.forEach(function (p) { nameOf[p.staff_id] = p.name; });
    return h + '<div class="tw"><table><thead><tr><th>日時</th><th>操作</th><th>月分</th><th>職員</th><th>した人</th><th>理由</th></tr></thead><tbody>' + audit.map(function (r) {
      return '<tr><td>' + esc(at(r.at)) + '</td><td>' + esc(ACT_NAME[r.action] || r.action) + '</td><td>' + esc(isYm(r.ym) ? ymText(r.ym) : '') + '</td><td>' + esc(r.staff_id ? (nameOf[r.staff_id] || '（今の名簿にいない人）') : '') + '</td><td>' + esc(r.by || '') + '</td><td>' + esc(r.reason || '') + '</td></tr>';
    }).join('') + '</tbody></table></div><button type="button" class="btn" data-act="aud-load">読み直す</button></div>';
  }
  function audLoad(btn) {
    if (!isAdmin()) return;
    var done = hold(btn, '読んでいます…'), to = new Date(Date.now() + 60000), from = new Date(to.getTime() - 30 * 86400000), my = gen;
    rpc('payroll_audit_get', { p_from: from.toISOString(), p_to: to.toISOString() }).then(okOr).then(function (r) {
      done(); if (my !== gen || view !== 'app') return;
      audit = arr(r.rows).filter(function (x) { return x && typeof x.action === 'string'; }).map(function (x) { return { at: x.at, action: x.action, ym: x.ym, staff_id: x.staff_id, by: x.by, reason: x.reason }; });
      paint();
    })['catch'](function (e) { done(); fail(e, '記録の読み込み'); });
  }

  function memLoad() {
    rpc('payroll_members_get', {}).then(okOr).then(function (r) {
      members = arr(r.members).filter(function (m) { return m && typeof m.email === 'string'; }).map(function (m) { return { email: m.email, role: m.role || null, active: m.active !== false }; });
      paint();
    })['catch'](function (e) { fail(e, '名簿の読み込み'); });
  }
  /* 1人ずつ足す・外す（統合 0102 の payroll_members_put(p_email, p_on)） */
  function memPut(email, onv, btn) {
    var done = hold(btn, '保存しています…');
    rpc('payroll_members_put', { p_email: email, p_on: onv }).then(okOr).then(function () { done(); toast('給与の名簿を保存しました。'); memLoad(); })['catch'](function (e) { done(); fail(e, '名簿の保存'); });
  }

  /* ── 10分操作が無ければ金額を消す ── */
  function mask() {
    if (masked || view !== 'app') return;
    masked = true; maskGen++; closeDlg(); importRows = null; printList = null; audit = null; put($('p-print'), '');
    bPrint = null;   /* 賞与の紙の用意も捨てる（2026-11-23） */
    yePrint = null; yeReset();   /* 年末調整の申告・累計・取り込み・紙も捨てる（2026-11-23） */
    paint();
  }
  function paintMasked() {
    put($('p-main'), '<div class="cd masked" role="status"><h2>金額を隠しました</h2><p>10分のあいだ操作が無かったため、給与の金額を画面から消しました（席を離れた時の覗き見を防ぐため）。保存していない計算は残っています。</p><button type="button" class="btn pri" data-act="unmask">金額を表示する</button></div>');
  }
  function unmask(btn) {
    var done = hold(btn, '確かめています…');
    Promise.resolve().then(function () { return window.SUAuth.check({ fresh: true }); }).then(function (st) {
      done();
      if (!st || st.status !== window.SUAuth.STATUS.OK || st.role !== role || st.aal !== 'aal2') { location.reload(); return; }
      masked = false; lastAct = Date.now();
      /* 隠している間に名簿から外された・権限が変わったかを DB に確かめ直す（42501 なら覆いに倒れる）。計算した物は読み直しで捨てない */
      return load(true);
    }, function () { done(); toast('ログインを確かめられませんでした。通信を確かめてから、もう一度押してください。'); });
  }
  function idleCheck() { if (view === 'app' && !masked && Date.now() - lastAct > IDLE_MS) { if (pinOn) pinLockNow('idle'); else mask(); } }

  /* ── 給与専用の暗証番号（統合 0110・2026-11-20 代表者の指示）──
     開いた時・10分さわらない時・「鍵をかける」で鍵の画面を出し、番号が合った時だけ中身を読む。鍵の行の期限はデータベースが決め（10分）、
     画面はさわった時に1分ごとに延ばす。番号は画面の入力欄にだけあり、端末にも記録にも残さない。
     データベースに暗証番号の関数がまだ無い時（0110 の前）は、今までどおり開く（pinOn=false） */
  var pinOn = false, pinSt = null, pinMsg = '', lastTouch = 0, pinGen = 0, PIN_RE = /^[0-9]{4,6}$/;
  /* 同じブラウザのタブどうしで「鍵をかけた」を知らせ合う（同じログインは開いた時刻を分け合うため。番号・中身は送らない） */
  var pinCh = null; try { if (window.BroadcastChannel) pinCh = new window.BroadcastChannel('su-payroll-pin'); } catch (_) { pinCh = null; }
  var PIN_NG = {
    badpin: '暗証番号は4〜6桁の数字で入れてください。',
    wrong: '暗証番号が違います。',
    oldpin: '今の暗証番号が違います。',
    notset: '暗証番号がまだ決まっていません。',
    nosession: 'ログインを確かめられませんでした。ログインの画面からログインし直してください。',
    reason: '理由を書いてください（200字まで）。',
    badshape: 'メールの形が違います。',
    self: '自分の暗証番号はここでは消せません。ほかの管理者に消してもらってください。'
  };
  function pinHm(t) { var d = new Date(t); return isNaN(d.getTime()) ? '' : d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function pinErr(r) {
    var e = r && r.error;
    if (e === 'locked') return '暗証番号を5回続けて間違えたため、' + (r.until ? pinHm(r.until) + ' まで' : 'しばらく') + '止めています。時間をおいてから入れてください。';
    if ((e === 'wrong' || e === 'oldpin') && r.left != null) return PIN_NG[e] + '（あと ' + r.left + ' 回間違えると15分止めます）';
    return PIN_NG[e] || 'うまくいきませんでした（' + String(e || '') + '）。';
  }
  /* 起動の時: 状態を読み、開いていても一度鍵をかけてから鍵の画面を出す（読み込み直しのたびに番号を入れる） */
  function pinStart() {
    return rpc('payroll_pin_status').then(function (r) {
      /* 開いたままのログインでも、開くたびに番号を入れる（鍵はこの画面だけにかけ、データベースの鍵はかけない＝ほかのタブを巻き込まない） */
      pinOn = true; pinSt = r; showLock(''); return null;
    }, function (e) {
      if (noDb(e)) { pinOn = false; view = 'app'; $('p-app').hidden = false; return load(false); }   /* 0110 の前の DB: 今までどおり */
      if (e && e.code === '42501') { showGate(isAal(e) ? 'mfa' : 'denied'); return null; }
      note('暗証番号の状態', e); showGate('error'); return null;
    });
  }
  function pinStatusThen(msg) {
    var my = pinGen;   /* 答えの前に開いた・別の鍵の画面に変わった時は捨てる */
    return rpc('payroll_pin_status').then(function (r) { if (my !== pinGen) return null; pinSt = r; showLock(msg || ''); return null; }, function (e) {
      if (my !== pinGen) return null;
      if (e && e.code === '42501') { showGate(isAal(e) ? 'mfa' : 'denied'); return null; }
      note('暗証番号の状態', e);
      /* 通信の失敗では覆いに倒さない（保存していない計算を消さない）。鍵の画面のまま知らせる */
      if (pinSt) { showLock(msg || ''); pinSay('通信できませんでした。電波・Wi-Fi を確かめて、もう一度入れてください。'); return null; }
      showGate('error'); return null;
    });
  }
  /* 鍵の画面。保存していない計算は画面のメモリに残す（番号が合えば続きから使える）。金額・明細・窓・印刷は消す */
  function showLock(msg) {
    view = 'lock'; pinGen++; masked = false; maskGen++; closeDlg(); bs = null; importRows = null; printList = null; audit = null; members = null;
    bb = null; bGen++; bLoading = false; bPrint = null;   /* 賞与の読んだ物も捨てる（入れた賞与額はメモリに残す・2026-11-23） */
    yePrint = null; yeReset();   /* 年末調整の物も捨てる（2026-11-23） */
    pinMsg = msg || '';
    $('p-app').hidden = true; put($('p-main'), ''); put($('p-print'), '');
    var st = pinSt || {}, g = $('p-gate'); g.hidden = false;
    var pinIn = function (id, label) {
      /* パスワードの欄にしない（共有の PC のブラウザに番号を覚えさせない）。文字は ● で隠す */
      return '<div class="row"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" class="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore aria-describedby="p-pin-msg"></div>';
    };
    var h;
    if (!st.set) {
      h = '<h2>給与の暗証番号を決めてください</h2><p>給与の画面は、開くたびにあなただけが知る暗証番号（4〜6桁の数字）を入れて使います。事務所の PC を使ったほかの職員が、給与を開いてしまわないためです。</p>' +
        pinIn('p-pin1', '暗証番号（4〜6桁）') + pinIn('p-pin2', 'もう一度') +
        '<div class="row"><button type="button" class="btn pri" data-act="pin-set">決めて開く</button></div>';
    } else {
      h = '<h2>給与の暗証番号を入れてください</h2><p>' + (msg === 'idle' ? '10分のあいだ操作が無かったため、鍵をかけました。' : msg === 'manual' ? '鍵をかけました。' : msg === 'manual-other' ? 'ほかのタブで鍵をかけました。' : msg === 'expired' ? '鍵がかかっています。' : '') +
        '給与の画面を開くには、あなたの暗証番号を入れてください。</p>' + pinIn('p-pin', '暗証番号') +
        '<div class="row"><button type="button" class="btn pri" data-act="pin-open">開く</button></div>' +
        (st.admin ? '<p class="help">番号を忘れた時は、ほかの管理者に「設定」のタブで消してもらってください（管理者が1人の時は、代表者の手順で消します）。</p>' :
          '<p class="help">番号を忘れた時は、管理者に「設定」のタブで暗証番号を消してもらってください。</p>');
      if (st.locked_until) msg = 'locked';
    }
    h += '<p id="p-pin-msg" class="help" role="alert">' + (st.locked_until ? esc(pinErr({ error: 'locked', until: st.locked_until })) : (msg && !/^(idle|manual|manual-other|expired)$/.test(msg) ? esc(msg) : '')) + '</p>' +
      '<p><a class="btn" href="index.html">メニューへ戻る</a></p>';
    put(g, h);
    var f = $('p-pin1') || $('p-pin'); if (f) try { f.focus(); } catch (_) {}
  }
  function pinVal(id) { var el = $(id); var x = el ? String(el.value || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).trim() : ''; if (el) el.value = ''; return x; }
  function pinSay(t) { var el = $('p-pin-msg'); if (el) el.textContent = t; }
  function pinOpened() {
    view = 'app'; pinGen++; $('p-gate').hidden = true; put($('p-gate'), ''); $('p-app').hidden = false;
    lastAct = Date.now(); lastTouch = Date.now(); paintLockBtn();
    return load(true);
  }
  function pinSetGo(btn) {
    var a = pinVal('p-pin1'), b2 = pinVal('p-pin2');
    if (!PIN_RE.test(a)) { pinSay(PIN_NG.badpin); return; }
    if (a !== b2) { pinSay('2回入れた番号が違います。もう一度入れてください。'); return; }
    var done = hold(btn, '決めています…');
    rpc('payroll_pin_set', { p_pin: a, p_old: null }).then(function (r) {
      done();
      if (!r || r.ok !== true) { pinSay(pinErr(r)); return null; }
      toast('暗証番号を決めました。次からは開くたびにこの番号を入れてください。');
      return r.unlocked ? pinOpened() : pinStatusThen();
    }, function (e) { done(); pinFail(e); });
  }
  function pinOpenGo(btn) {
    var a = pinVal('p-pin');
    if (!PIN_RE.test(a)) { pinSay(PIN_NG.badpin); return; }
    var done = hold(btn, '確かめています…');
    rpc('payroll_pin_unlock', { p_pin: a }).then(function (r) {
      done();
      if (!r || r.ok !== true) { pinSay(pinErr(r)); return null; }
      return pinOpened();
    }, function (e) { done(); pinFail(e); });
  }
  function pinFail(e) {
    if (e && e.code === '42501') { showGate(isAal(e) ? 'mfa' : 'denied'); return; }
    note('暗証番号', e); pinSay('通信できませんでした。電波・Wi-Fi を確かめて、もう一度押してください。');
  }
  /* 設定のタブ（管理者）: 名簿の人の番号を消す */
  function pinReset(email, btn) {
    var reason = '';
    var p = window.SUDialog && window.SUDialog.prompt ? window.SUDialog.prompt(email + ' の暗証番号を消します。消した人は、次に給与を開く時に番号を決め直します。理由を書いてください。', '')
      : Promise.resolve(window.prompt(email + ' の暗証番号を消します。理由を書いてください。', ''));
    var mg = maskGen;
    p.then(function (x) {
      if (x == null || mg !== maskGen || view !== 'app') return null;   /* 窓の間に鍵がかかった・金額を隠した時は送らない */
      reason = String(x).trim(); if (!reason) { say('理由を書いてください。'); return null; }
      var done = hold(btn, '消しています…');
      return rpc('payroll_pin_reset', { p_email: email, p_reason: reason }).then(function (r) {
        done();
        if (r && r.ok === true) { toast(email + ' の暗証番号を消しました。'); return null; }
        say(r && r.error === 'notset' ? 'この人はまだ暗証番号を決めていません。' : pinErr(r));
        return null;
      }, function (e) { done(); fail(e, '暗証番号を消す'); });
    });
  }
  /* 鍵をかける（ボタン・10分さわらない時）。保存していない計算は残す */
  function pinLockNow(why) {
    if (!pinOn || view !== 'app') return;
    var w = why || 'manual';
    /* 「鍵をかける」はデータベースの鍵もかけ、同じブラウザのほかのタブにも知らせる。10分さわらない・ほかのタブの知らせは、この画面だけ鍵の画面にする */
    if (w === 'manual') {
      rpc('payroll_pin_lock').then(function () { return null; }, function (e) { note('鍵をかける', e); });
      try { if (pinCh) pinCh.postMessage('lock'); } catch (_) {}
    }
    pinSt = pinSt || { set: true }; pinSt.set = true; pinSt.locked_until = null;
    showLock(w);
  }
  /* さわった時に1分ごとに延ばす。延ばせなかった（期限が切れた）時は鍵の画面へ */
  function pinTouch() {
    if (!pinOn || view !== 'app' || Date.now() - lastTouch < 60000) return;
    lastTouch = Date.now();
    rpc('payroll_pin_touch').then(function (r) {
      if (view === 'app' && r && r.unlocked === false) pinRecheck();
    }, function (e) { if (e && e.code === '42501') pinRecheck(); else note('鍵の延長', e); });
  }
  /* 断られた（42501）時: 鍵がかかっただけなら鍵の画面、名簿から外されたなら覆い */
  function pinRecheck() { if (!pinOn) return false; if (view === 'lock') return true; pinStatusThen('expired'); return true; }   /* 鍵の画面の間に届いた断りでは描き直さない */
  function paintLockBtn() { var b = $('p-lock'); if (b) b.hidden = !pinOn; }

  /* ── 覆い ── */
  var GATE = {
    mfa: ['二段階のログインを済ませてください', '給与の画面は、二段階のログイン（認証アプリの6桁）を済ませた時だけ開けます。ログインの画面で6桁を入れてから開き直してください。'],
    denied: ['給与の画面は開けません', 'このアカウントは給与の名簿に入っていません。給与の金額を見られるのは、管理者と、管理者が給与の名簿に入れた人だけです。必要な時は管理者に伝えてください。'],
    nocalc: ['画面の部品を読み込めませんでした', 'ページを読み込み直してください。直らない時は管理者に知らせてください。'],
    error: ['ログインを確かめられませんでした', '電波・Wi-Fi を確かめてから、ページを読み込み直してください。']
  };
  function showGate(why) {
    view = 'gate'; masked = false; closeDlg(); bs = null; calc = null; importRows = null; audit = null; members = null;
    bGen++; bLoading = false; bonusClear();   /* 賞与も捨てる（2026-11-23） */
    yePrint = null; yeReset();   /* 年末調整も捨てる（2026-11-23） */
    $('p-app').hidden = true; put($('p-main'), ''); put($('p-print'), '');
    var g = GATE[why] || GATE.denied, gt = $('p-gate'); gt.hidden = false;
    put(gt, '<h2>' + esc(g[0]) + '</h2><p>' + esc(g[1]) + '</p><p><a class="btn pri" href="login.html?next=payroll.html">ログインの画面へ</a> <a class="btn" href="index.html">メニューへ戻る</a></p>');
  }
  function showField() {
    view = 'field';
    var g = $('p-gate'); g.hidden = false;
    put(g, '<h2>この画面は事務所のパソコンで使います</h2><p>この端末は「現場」として設定されているため、給与の画面は開きません。</p><p><a class="btn" href="index.html">メニューへ戻る</a></p>');
  }

  /* ── 操作 ── */
  function setTab(t) {
    if (TABS.indexOf(t) < 0 || (t === 'settings' && !isAdmin())) t = 'run';
    tab = t; lsSet(LS_TAB, t); paint();
    var b = document.querySelector('.tabs [data-tab="' + t + '"]'); if (b && document.activeElement && document.activeElement.closest && document.activeElement.closest('.tabs')) b.focus();
  }
  function setYm(nv) {
    if (!isYm(nv) || nv === ym) { $('p-ym').value = ym; return; }
    if (isDirty()) {
      $('p-ym').value = ym;
      ask('保存していない計算・調整があります。月分を変えると捨てます。よろしいですか？').then(function (ok) { if (ok) { dirty = false; adjEdits = {}; importRows = null; calc = null; setYm(nv); } });
      return;
    }
    ym = nv; $('p-ym').value = nv; bs = null; calc = null; adjEdits = {}; dirty = false; openSid = null; slipSid = null; importRows = null; zcheck = null; notice = null; loadErr = null;
    load(false);
  }
  function bind() {
    bonusBind();
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      var t = b.getAttribute('data-tab');
      if (t) { setTab(t); return; }
      var a = b.getAttribute('data-act'), sid = b.getAttribute('data-sid');
      if (!a) return;
      if (a === 'dlg-close') { if (busy) return; if (!dlgDirty()) closeDlg(); else { var c0 = dlgCtx; ask('入れた内容を捨てて閉じますか？').then(function (ok) { if (ok && dlgCtx === c0) closeDlg(); }); } }
      else if (a === 'reload') load(false);
      else if (a === 'compute') doCompute();
      else if (a === 'save') saveDraft(b);
      else if (a === 'confirm') openConfirm();
      else if (a === 'confirm-go') confirmGo(b);
      else if (a === 'unconfirm') openUnconfirm();
      else if (a === 'unconfirm-go') unconfirmGo(b);
      else if (a === 'adj') openAdj(sid);
      else if (a === 'adj-go') adjGo();
      else if (a === 'adj-del') adjDel(sid, +b.getAttribute('data-i'));
      else if (a === 'print-one') doPrint(items().filter(function (it) { return it.staff_id === slipSid; }));
      else if (a === 'print-all') doPrint(items().slice());
      else if (a === 'exp') exportGo(b.getAttribute('data-k'), b);
      else if (a === 'prof') openProfile(sid);
      else if (a === 'prof-go') profGo(b);
      else if (a === 'bank') openBank(sid);
      else if (a === 'bank-go') bankGo(b);
      else if (a === 'imp-cancel') { importRows = null; importErr = null; paint(); }
      else if (a === 'imp-go') importGo(b);
      else if (a === 'set-go') settingsGo(b);
      else if (a === 'mem-load') memLoad();
      else if (a === 'mem-add') {
        var em = v('m-add').toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { say('メールの形が違います。'); return; }
        if (members.some(function (m) { return m.email === em; })) return;
        memPut(em, true, b);
      }
      else if (a === 'mem-del') {
        var m0 = members[+b.getAttribute('data-i')]; if (!m0) return;
        ask(m0.email + ' を給与の名簿から外しますか？').then(function (ok) { if (ok) memPut(m0.email, false, b); });
      }
      else if (a === 'alw') openAlw(b.getAttribute('data-code'));
      else if (a === 'alw-go') alwGo(b);
      else if (a === 'aud-load') audLoad(b);
      else if (a === 'unmask') unmask(b);
      else if (a === 'pin-set') pinSetGo(b);
      else if (a === 'pin-open') pinOpenGo(b);
      else if (a === 'pin-lock') pinLockNow('manual');
      else if (a === 'pin-reset') { var m1 = members && members[+b.getAttribute('data-i')]; if (m1) pinReset(m1.email, b); }
      else if (/^ye-/.test(a) && YEU() && view === 'app' && !masked) YEU().onClick(yeCtx(), a, b);
      else if (a.indexOf('b-') === 0) bonusAct(a, b);   /* 賞与（2026-11-23） */
    });
    document.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d || !d.classList || !d.classList.contains('it')) return;
      var sid = d.getAttribute('data-sid');
      var ch = false;
      if (d.open && openSid !== sid) { openSid = sid; ch = true; }
      else if (!d.open && openSid === sid) { openSid = null; ch = true; }
      if (!ch) return;
      paint();
      /* 描き直した後も、押した行の見出しに手元（フォーカス）を戻す（キーボード・読み上げで迷わない） */
      var all = document.querySelectorAll('details.it');
      for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-sid') === sid) { var sm = all[i].querySelector('summary'); if (sm) sm.focus(); break; }
    }, true);
    document.addEventListener('change', function (e) {
      var id = e.target && e.target.id;
      if (id === 'p-ym') setYm(e.target.value);
      else if (id === 's-who') { slipSid = e.target.value; paint(); }
      else if (id === 'i-file') { var f = e.target.files && e.target.files[0]; importFile(f); e.target.value = ''; }
      else if (YEU() && view === 'app' && !masked && (/^ye-/.test(id || '') || (e.target.getAttribute && e.target.getAttribute('data-ye-pick')))) YEU().onChange(yeCtx(), e.target);
    });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var vis = TABS.filter(function (t) { return t !== 'settings' || isAdmin(); }), i = vis.indexOf(tab);
      setTab(vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]); e.preventDefault();
    });
    $('p-prev').addEventListener('click', function () { setYm(shiftYm(ym, -1)); });
    $('p-next').addEventListener('click', function () { setYm(shiftYm(ym, 1)); });
    $('p-reload').addEventListener('click', function () {
      if (tab === 'bonus') { if (!bonusDirty()) { bonusLoad(false); return; } ask('保存していない賞与の入力を捨てて読み直しますか？').then(function (ok) { if (ok) bonusLoad(false); }); return; }   /* 賞与のタブは賞与だけ読み直す */
      if (!isDirty()) { load(false); return; } ask('保存していない計算・調整を捨てて読み直しますか？').then(function (ok) { if (ok) load(false); });
    });
    $('p-dlg').addEventListener('cancel', function (e) {
      if (busy) { e.preventDefault(); return; }
      if (!dlgDirty()) { closeDlg(); return; }
      e.preventDefault();
      var c0 = dlgCtx; ask('入れた内容を捨てて閉じますか？').then(function (ok) { if (ok && dlgCtx === c0) closeDlg(); });
    });
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(function (ev) { document.addEventListener(ev, function () { if (!masked && view === 'app') { lastAct = Date.now(); pinTouch(); } }, { passive: true, capture: true }); });
    /* 鍵の画面の欄で Enter を押したら、決める・開くを押したのと同じにする（かな漢字の変換中は除く） */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || view !== 'lock' || !e.target || !e.target.classList || !e.target.classList.contains('pin')) return;
      if (e.target.id === 'p-pin1' && $('p-pin2')) { e.preventDefault(); $('p-pin2').focus(); return; }   /* 1つ目の欄の Enter は次の欄へ */
      var b = document.querySelector('#p-gate [data-act="pin-set"], #p-gate [data-act="pin-open"]');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) idleCheck(); });
    window.addEventListener('focus', idleCheck);
    setInterval(idleCheck, 15000);
    window.addEventListener('beforeunload', function (e) { if (isDirty() || bonusDirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('storage', function (e) { if (e.key === 'su_device_role' && isField()) location.reload(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted && isField()) location.reload(); else if (e && e.persisted && pinOn && view === 'app') pinLockNow('expired'); });   /* 戻るボタンで戻った時は鍵の画面から */
    if (pinCh) pinCh.onmessage = function (e) { if (e && e.data === 'lock' && pinOn && view === 'app') pinLockNow('manual-other'); };
  }

  function boot() {
    if (isField()) { showField(); return; }
    if (!window.SUAppGate) { showGate('nocalc'); return; }
    window.SUAppGate.run('payroll', { dirty: function () { return isDirty() || bonusDirty(); } }).then(function (ok) {
      if (!ok) { view = 'gate'; return null; }
      return window.SUAuth.check().then(function (st) {
        var S = window.SUAuth.STATUS;
        if (!st || st.status === S.ERROR) { showGate('error'); return null; }
        if (st.status !== S.OK) { showGate('denied'); return null; }
        if (st.aal !== 'aal2') { showGate('mfa'); return null; }
        role = st.role;
        /* 鍵（暗証番号）が決まるまで中身の帯を出さない・押させない（0110 の前の DB では pinStart が出す） */
        view = 'boot';
        $('p-app').hidden = true;
        var t = lsGet(LS_TAB); tab = TABS.indexOf(t) >= 0 && (t !== 'settings' || isAdmin()) ? t : 'run';
        ym = todayYm(); $('p-ym').value = ym;
        bind(); definePrint();
        try { if (window.SUPerf) window.SUPerf.ready(); } catch (_) {}
        return pinStart();
      });
    })['catch'](function (e) { note('起動', e); showGate('error'); });
  }
  var go = function () { try { boot(); } catch (e) { note('起動', e); } };
  if (window.SUFacility && typeof window.SUFacility.onReady === 'function') window.SUFacility.onReady(go); else go();
  /* 試験だけが読む（画面の動きには使わない） */
  window.__payrollTest = { attSame: attSame, normBoot: normBoot, figures: figures, totals: totals, parseCsv: parseCsv, decode: decode, importCols: importCols, buildImport: buildImport, missingOf: missingOf, attFromKintai: attFromKintai, toSave: toSave, qtyText: qtyText, TABS: TABS, IDLE_MS: IDLE_MS,
    bonusNorm: bonusNorm, bonusYtd: bonusYtd, bonusPrevOf: bonusPrevOf, bonusToSave: bonusToSave, bonusBlocks: bonusBlocks, bonusShoyoCsv: bonusShoyoCsv, bonusNoDb: bonusNoDb, bonusBlankMsg: bonusBlankMsg, bonusNoProfile: bonusNoProfile, bonusBlankTargets: bonusBlankTargets };
})();
