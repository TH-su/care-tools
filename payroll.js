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
  var TABS = ['run', 'slip', 'export', 'profile', 'settings'];
  var LS_TAB = 'payroll_tab';
  var IDLE_MS = 10 * 60 * 1000;
  var gen = 0, view = 'boot', tab = 'run', ym = null, bs = null, role = null, loadErr = null;
  var calc = null, adjEdits = {}, dirty = false, busy = false, masked = false, lastAct = Date.now();
  var openSid = null, slipSid = null, importRows = null, importErr = null, members = null, zcheck = null, notice = null, audit = null;
  var printList = null, dlgCtx = null;
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
      return { state: names.length ? 'ng' : 'ok', names: names };
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
    var out = {};
    arr(obj(snap).rows).forEach(function (r) { if (r && typeof r.staff_id === 'string') out[r.staff_id] = attFromKintai(r, locked); });
    return out;
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
      kintai: { locked: locked, locked_at: k.locked_at || null, period: per, summary_by_staff: attMap(k.summary_by_staff, locked) },
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
  var hireRank = null, hireBusy = false;
  function isYmd(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x); }
  function loadHire() {
    if (hireBusy || !ym) return;
    hireBusy = true;
    Promise.all([rpc('kintai_month_get', { p_ym: ym }), rpc('kintai_master_list')]).then(function (rs) {
      var staff = arr(rs[0] && rs[0].staff), mrows = arr(rs[1] && rs[1].rows), hire = {};
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
    return list.map(function (x, i) { return { x: x, i: i, r: hireRank[get(x)] }; }).sort(function (a, b) {
      var ra = a.r == null ? Infinity : a.r, rb = b.r == null ? Infinity : b.r;
      return ra !== rb ? (ra < rb ? -1 : 1) : a.i - b.i;
    }).map(function (o) { return o.x; });
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
    var shown = dlgCtx.shown, done = hold(btn, '確かめています…'), my = gen;
    rpc('payroll_bootstrap', { p_ym: ym }).then(function (r) {
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
    if (!bs) h = loadErr ? '<div class="band ng" role="alert">' + esc(loadErr) + '</div><button type="button" class="btn" data-act="reload">もう一度読む</button>' : '<div class="cd" aria-busy="true"><span class="skel w8"></span><span class="skel w6"></span><span class="skel w8"></span><span class="skel w4"></span></div>';
    else if (tab === 'run') h = runHtml();
    else if (tab === 'slip') h = slipTabHtml();
    else if (tab === 'export') h = exportHtml();
    else if (tab === 'profile') h = profileHtml();
    else h = isAdmin() ? settingsHtml() : '';
    put($('p-main'), bandsHtml() + h);
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
    window.SUPrint.setActive(null);
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
    if (pays.length) h += '<p class="help">手当（月の額・空欄は無し）</p><div class="kv">' + pays.map(function (a, i) { return inp('f-al' + i, a.name || a.code, amtOf(d.allowances, a.code), NUMA); }).join('') + '</div>';
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
      inp('f-entry', '入社日', d.entry_date, ' type="date"') + inp('f-retire', '退職日', d.retire_date, ' type="date"') + '</div></fieldset>';
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
  function on(id) { var e = $(id); return !!(e && e.checked); }
  function nOr(id, keep) { var s = v(id).replace(/[,，\s円]/g, ''); if (s === '') return keep === undefined ? null : keep; return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; }
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
    c.pays.forEach(function (a, i) { var x = n('f-al' + i, a.name || a.code); if (x != null && x === x) { var old = arr(p.data.allowances).filter(function (o) { return o.code === a.code; })[0]; keepA.push(Object.assign({}, old || {}, { code: a.code, amount: x })); } });
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
    if (p.staff_id.indexOf('p:') === 0 && !d.name) d.name = p.name;
    if (bad.length) { say('数の形が違う欄があります：' + bad.filter(function (x, i) { return bad.indexOf(x) === i; }).join('・') + '（半角の数字で書いてください）'); return; }
    var done = hold(btn, '保存しています…');
    /* 同じ日付の版があれば今の版で上書き、無ければ新しい版（rev 0）で足す（統合 0102 の payroll_profile_put） */
    var from = v('f-from'), same = p.versions.filter(function (x) { return x.effective_from === from; })[0];
    rpc('payroll_profile_put', { p_staff_id: p.staff_id, p_effective_from: from, p_data: d, p_rev: same ? same.rev : 0, p_reason: reason }).then(okOr).then(function () {
      done(); closeDlg(); toast('給与の設定を保存しました。計算し直してください。'); return load(false);
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
    h += '<fieldset><legend>支給日・徴収</legend><div class="kv">' + inp('s-payday', '支給日（毎月 何日）', c.pay_day, NUMA) + sel('s-shift', '土日・休みの日の時', c.pay_day_shift || 'before', [['before', '前の営業日'], ['after', '後の営業日'], ['none', '寄せない']]) +
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
    var pd = n('s-payday', '支給日');
    if (pd == null || pd !== pd || pd % 1 || pd < 1 || pd > 31) bad.push('支給日（1〜31）'); else c.pay_day = pd;
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
    });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var vis = TABS.filter(function (t) { return t !== 'settings' || isAdmin(); }), i = vis.indexOf(tab);
      setTab(vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]); e.preventDefault();
    });
    $('p-prev').addEventListener('click', function () { setYm(shiftYm(ym, -1)); });
    $('p-next').addEventListener('click', function () { setYm(shiftYm(ym, 1)); });
    $('p-reload').addEventListener('click', function () { if (!isDirty()) { load(false); return; } ask('保存していない計算・調整を捨てて読み直しますか？').then(function (ok) { if (ok) load(false); }); });
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
    window.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('storage', function (e) { if (e.key === 'su_device_role' && isField()) location.reload(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted && isField()) location.reload(); else if (e && e.persisted && pinOn && view === 'app') pinLockNow('expired'); });   /* 戻るボタンで戻った時は鍵の画面から */
    if (pinCh) pinCh.onmessage = function (e) { if (e && e.data === 'lock' && pinOn && view === 'app') pinLockNow('manual-other'); };
  }

  function boot() {
    if (isField()) { showField(); return; }
    if (!window.SUAppGate) { showGate('nocalc'); return; }
    window.SUAppGate.run('payroll', { dirty: isDirty }).then(function (ok) {
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
  window.__payrollTest = { attSame: attSame, normBoot: normBoot, figures: figures, totals: totals, parseCsv: parseCsv, decode: decode, importCols: importCols, buildImport: buildImport, missingOf: missingOf, attFromKintai: attFromKintai, toSave: toSave, qtyText: qtyText, TABS: TABS, IDLE_MS: IDLE_MS };
})();
