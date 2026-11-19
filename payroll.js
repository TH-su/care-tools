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
 */
(function () {
  'use strict';
  var TABS = ['run', 'slip', 'export', 'profile', 'settings'];
  var LS_TAB = 'payroll_tab';
  var IDLE_MS = 10 * 60 * 1000;
  var gen = 0, view = 'boot', tab = 'run', ym = null, bs = null, role = null, loadErr = null;
  var calc = null, adjEdits = {}, dirty = false, busy = false, masked = false, lastAct = Date.now();
  var openSid = null, slipSid = null, importRows = null, importErr = null, members = null, zcheck = null, notice = null;
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
  function C() { return window.PayrollCalc && typeof window.PayrollCalc.computeItem === 'function' ? window.PayrollCalc : null; }
  function X() { return window.PayrollExport || null; }
  function cfg() { return (bs && bs.settings && bs.settings.config) || {}; }
  function period() { return (bs && bs.kintai && bs.kintai.period) || null; }
  function status() { return (bs && bs.run && bs.run.status) || null; }
  function frozen() { var s = status(); return s === 'confirmed' || s === 'exported'; }
  function corpName() {
    var c = cfg().company_name;
    if (c) return String(c);
    try { var f = window.SUFacility && window.SUFacility.get && window.SUFacility.get(); return (f && (f.corpName || f.facilityName)) || ''; } catch (_) { return ''; }
  }
  function payDate() { var c = C(); try { return c && typeof c.payDate === 'function' ? c.payDate(ym, cfg()) : ''; } catch (e) { note('支給日', e); return ''; } }
  function periodText() { var p = period(); return p && isDate(p.from) && isDate(p.to) ? ymText(ym) + '（' + md(p.from) + '〜' + md(p.to) + '）' : ymText(ym); }

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
    toobig: '送る量が大きすぎます。'
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
  function normBoot(r) {
    r = obj(r);
    var st = obj(r.settings), k = obj(r.kintai);
    return {
      settings: { config: obj(st.config), rev: num(st.rev) },
      allowances: arr(r.allowances).filter(function (a) { return a && typeof a.code === 'string'; }),
      profiles: arr(r.profiles).filter(function (p) { return p && typeof p.staff_id === 'string'; }).map(function (p) {
        return { staff_id: p.staff_id, name: String(p.name || ''), rev: num(p.rev), effective_from: isDate(p.effective_from) ? p.effective_from : null,
          data: obj(p.data), bank_last4: p.bank_last4, history: arr(p.history) };
      }),
      kintai: { locked: k.locked === true, locked_at: k.locked_at || null, period: obj(k.period).from ? { from: k.period.from, to: k.period.to } : null, summary_by_staff: obj(k.summary_by_staff) },
      run: r.run && typeof r.run === 'object' ? { status: r.run.status, rev: num(r.run.rev), stale: r.run.stale === true, calc_at: r.run.calc_at || null,
        confirmed_at: r.run.confirmed_at || null, confirmed_by: r.run.confirmed_by || null, exported_at: r.run.exported_at || null } : null,
      items: arr(r.items).filter(function (it) { return it && typeof it.staff_id === 'string'; }),
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
  function fingerprint() {
    var revs = {}; (bs ? bs.profiles : []).forEach(function (p) { revs[p.staff_id] = p.rev; });
    var c = C(), first = calc && calc.items[0] && calc.items[0].fingerprint_inputs;
    return { kintai_locked_at: bs.kintai.locked_at, profile_revs: revs, settings_rev: bs.settings.rev,
      rates_ver: first ? first.rates_ver : null, calc_ver: c ? (c.VERSION || null) : null };
  }
  function computeAll() {
    var c = C(); if (!c || !bs) return null;
    var p0 = period(), pd = payDate(), out = [];
    bs.profiles.forEach(function (p) {
      if (p.data.exclude === true) return;
      var input = { ym: ym, period: p0, payDate: pd, settings: cfg(), profile: p.data, allowanceDefs: bs.allowances,
        att: p.data.no_attendance === true ? null : (bs.kintai.summary_by_staff[p.staff_id] || null), adjustments: adjOf(p.staff_id), prevItem: prevOf(p.staff_id),
        profileRev: p.rev, settingsRev: bs.settings.rev };
      var it;
      try { it = c.computeItem(input); } catch (e) { note('計算', e); it = { lines: [], gross: 0, deduct: 0, net: 0, warnings: [{ code: 'calcerr', msg: '計算できませんでした（設定の形を確かめてください）' }], error: true }; }
      it = Object.assign({}, it, { staff_id: p.staff_id, name: p.name, adjustments: adjOf(p.staff_id), bank_last4: p.bank_last4 });
      if (!bs.kintai.locked) it.warnings = arr(it.warnings).concat([{ code: 'unlocked', msg: '勤怠が未締めです' }]);
      out.push(it);
    });
    return out;
  }
  function doCompute() {
    if (frozen()) return;
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
  function toSave(it) {
    var o = {}, k;
    for (k in it) if (Object.prototype.hasOwnProperty.call(it, k) && k !== 'bank_last4') o[k] = it[k];
    return o;
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
      if (!keepCalc) { calc = null; adjEdits = {}; dirty = false; }
      sync(''); paint();
      return bs;
    }, function (e) {
      if (my !== gen) return null;
      sync('');
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
    if (!(e && e.payroll)) note(where, e);
    alert(msgOf(e));
    return null;
  }

  /* ── 下書き保存・確定・取り消し ── */
  function saveDraft(btn) {
    if (!calc || busy || frozen()) return;
    if (!bs.kintai.locked) { alert(NG.notlocked); return; }
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
  function openConfirm() {
    if (busy || !bs || status() !== 'draft' || dirty) return;
    var list = items(), t = totals(list), ch = changedList(), h = '';
    var warns = []; list.forEach(function (it) { arr(it.warnings).forEach(function (w) { warns.push(it.name + '：' + (w.msg || w.code)); }); });
    h += '<p>' + esc(periodText()) + 'の給与を確定します。確定すると、この月の明細と書き出しはこの数字で固まります。</p>';
    h += '<div class="kv"><span>人数</span><b>' + esc(t.n) + ' 人</b><span>総支給の合計</span><b>' + esc(yen(t.gross)) + ' 円</b><span>控除の合計</span><b>' + esc(yen(t.deduct)) + ' 円</b><span>差引の合計</span><b>' + esc(yen(t.net)) + ' 円</b><span>支給日</span><b>' + esc(jdate(payDate()) || '（未定）') + '</b></div>';
    h += '<h3>残っている警告（' + esc(warns.length) + ' 件）</h3>' + (warns.length ? '<ul>' + warns.map(function (w) { return '<li>⚠ ' + esc(w) + '</li>'; }).join('') + '</ul>' : '<p>ありません。</p>');
    h += '<h3>今月変わった設定と調整（' + esc(ch.length) + ' 件）</h3>' + (ch.length ? '<ul>' + ch.map(function (c) { return '<li>' + esc(c.name) + '：' + esc(c.what) + '</li>'; }).join('') + '</ul>' : '<p>ありません。</p>');
    if (warns.length) h += '<p><label><input type="checkbox" id="c-ack"> 警告を確かめました</label></p>';
    h += '<p class="help">「確定する」を押すと、もう一度データベースから読み直して数え直し、この窓の数字と同じ時だけ確定します。</p>';
    openDlg('給与を確定する', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="confirm-go">確定する</button>', { mode: 'confirm', shown: figures(list), warn: warns.length });
  }
  function confirmGo(btn) {
    if (busy || !dlgCtx || dlgCtx.mode !== 'confirm') return;
    if (dlgCtx.warn && !($('c-ack') && $('c-ack').checked)) { alert('警告を確かめたら「警告を確かめました」に印を入れてください。'); return; }
    var shown = dlgCtx.shown, done = hold(btn, '確かめています…'), my = gen;
    rpc('payroll_bootstrap', { p_ym: ym }).then(function (r) {
      if (my !== gen) { done(); return null; }
      if (r && r.ok === false) okOr(r);
      var fresh = normBoot(r), keep = bs;
      bs = fresh;
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
      return rpc('payroll_run_confirm', { p_ym: ym, p_rev: bs.run.rev }).then(okOr).then(function () {
        done(); closeDlg(); toast('確定しました。'); return load(false);
      });
    })['catch'](function (e) { done(); closeDlg(); return fail(e, '確定'); });
  }
  function openUnconfirm() {
    if (!isAdmin() || !frozen()) return;
    var ex = status() === 'exported';
    var h = (ex ? '<div class="band ng">⚠ この月はもう振込データを書き出しています。取り消して直しても、銀行へ渡した振込は変わりません。振込の後の直しは、原則として翌月の調整で行ってください。</div>' : '') +
      '<p>確定を取り消すと、下書きに戻り、計算し直せるようになります。取り消したことと理由は記録に残ります。</p><label for="u-reason">理由（必ず書く）</label><br><textarea id="u-reason" rows="3" style="width:100%" maxlength="400"></textarea>';
    openDlg('確定を取り消す（管理者）', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn ng" data-act="unconfirm-go">取り消す</button>', { mode: 'unconfirm' });
  }
  function unconfirmGo(btn) {
    var r = $('u-reason') ? $('u-reason').value.trim() : '';
    if (!r) { alert(NG.reason); return; }
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
    if (!name) { alert('名前を書いてください。'); return; }
    if (!/^-?\d{1,8}$/.test(amt)) { alert('金額は円の整数で書いてください（例 5000・-3000）。'); return; }
    if (!reason) { alert(NG.reason); return; }
    var list = adjOf(sid).slice(); list.push({ kind: kind, name: name, amount: parseInt(amt, 10), reason: reason });
    adjEdits[sid] = list; openSid = sid; closeDlg(); doCompute();
  }
  function adjDel(sid, i) {
    if (frozen()) return;
    var list = adjOf(sid).slice(); if (!list[i]) return;
    if (!confirm('「' + list[i].name + '」の調整を外して計算し直しますか？（下書き保存するまでデータベースは変わりません）')) return;
    list.splice(i, 1); adjEdits[sid] = list; openSid = sid; doCompute();
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
    if (s === 'draft') return '<span class="tag warn">下書き</span> 保存 ' + esc(at(r.calc_at));
    return '<span class="tag">まだ計算していません</span>';
  }
  function sumHtml(list) {
    var t = totals(list);
    return '<div class="sumbar"><div>人数<b>' + esc(t.n) + ' 人</b></div><div>総支給の合計<b>' + esc(yen(t.gross)) + ' 円</b></div><div>控除の合計<b>' + esc(yen(t.deduct)) + ' 円</b></div><div>差引の合計<b>' + esc(yen(t.net)) + ' 円</b></div><div>警告<b>' + esc(t.warn) + ' 件</b></div></div>';
  }
  function linesTable(list, title) {
    if (!list.length) return '<p class="help">' + esc(title) + 'はありません。</p>';
    return '<table><caption class="help" style="text-align:left">' + esc(title) + '</caption><thead><tr><th>項目</th><th class="num">数量</th><th class="num">金額（円）</th><th>根拠</th></tr></thead><tbody>' +
      list.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="num">' + esc(l.qty == null ? '' : l.qty + (l.unit || '')) + '</td><td class="num">' + esc(l.sec === 'att' ? '' : yen(l.amount)) + '</td><td>' + esc(l.basis || '') + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function bySec(it, sec) { return arr(it.lines).filter(function (l) { return l && l.sec === sec; }); }
  function runHtml() {
    var c = C(), h = '<div class="cd"><h2>' + esc(periodText()) + '</h2><div class="row">';
    h += bs.kintai.locked ? '<span class="tag ok">✓ 勤怠は締めてあります</span>' + esc(at(bs.kintai.locked_at)) : '<span class="tag ng">⚠ 勤怠が未締め</span><span class="help">勤怠管理で締めるまで、計算はできますが保存・確定はできません。</span><a class="btn" href="kintai.html">勤怠管理へ</a>';
    h += '</div><div class="row">状態: ' + statusText() + '</div>';
    if (bs.run && bs.run.stale && !frozen()) h += '<div class="band warn">⚠ 保存した後に勤怠・給与の設定が変わりました。「計算する」で計算し直してください。</div>';
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
      return '<table><thead><tr><th colspan="2">' + esc(cap) + '</th></tr></thead><tbody>' + (list.length ? list.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="num">' + esc(money ? yen(l.amount) : (l.qty == null ? '' : l.qty + (l.unit || ''))) + '</td></tr>'; }).join('') : '<tr><td colspan="2">—</td></tr>') + '</tbody></table>';
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
    rpc('payroll_export_log', { p_ym: ym, p_kind: 'print' }).then(okOr).then(function () {
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
  function hasBank(it) { var p = profOf(it.staff_id), b = it.bank_last4 != null ? it.bank_last4 : (p && p.bank_last4); return Array.isArray(b) ? b.length > 0 : !!b; }
  function exportHtml() {
    var list = items(), x = X(), h = '<div class="cd"><h2>振込と書き出し（' + esc(periodText()) + '）</h2>';
    if (!frozen()) return h + '<div class="band warn">確定した月だけ書き出せます。「今月の給与」で確定してから開いてください。</div></div>';
    if (!x) h += '<div class="band ng" role="alert">書き出しの部品を読み込めませんでした。ページを読み込み直してください。</div>';
    var t = totals(list), tr = 0, trn = 0, cash = [];
    list.forEach(function (it) { if (hasBank(it) && num(it.net) > 0) { tr += num(it.net); trn++; } else cash.push(it); });
    h += '<h3 style="font-size:16px">総額の照合</h3><div class="tw"><table><tbody>' +
      '<tr><th>差引の合計（' + esc(t.n) + '人）</th><td class="num">' + esc(yen(t.net)) + ' 円</td></tr>' +
      '<tr><th>振込する分（口座あり・差引が0より大きい ' + esc(trn) + '人）</th><td class="num">' + esc(yen(tr)) + ' 円</td></tr>' +
      '<tr><th>振込しない分（口座なし・差引0以下 ' + esc(cash.length) + '人）</th><td class="num">' + esc(yen(t.net - tr)) + ' 円' + (cash.length ? '<br><span class="help">' + esc(cash.map(function (c) { return c.name; }).join('、')) + '</span>' : '') + '</td></tr>';
    if (zcheck && zcheck.ym === ym) h += '<tr><th>全銀ファイルの合計（' + esc(zcheck.count) + '件）</th><td class="num">' + esc(yen(zcheck.total)) + ' 円 ' + (zcheck.total === tr && zcheck.count === trn ? '<span class="tag ok">✓ 振込する分と一致</span>' : '<span class="tag ng">⚠ 振込する分と合いません。ファイルを使わず管理者に知らせてください</span>') + '</td></tr>';
    h += '</tbody></table></div>';
    h += '<h3 style="font-size:16px">書き出す</h3><div class="row">';
    if (cfg().zengin_enabled === true) h += '<button type="button" class="btn pri" data-act="exp" data-k="zengin"' + (x ? '' : ' disabled') + '>振込データ（全銀形式）</button>';
    h += '<button type="button" class="btn" data-act="exp" data-k="journal"' + (x ? '' : ' disabled') + '>仕訳の CSV</button>' +
      '<button type="button" class="btn" data-act="exp" data-k="ledger"' + (x ? '' : ' disabled') + '>賃金台帳の CSV</button>' +
      '<button type="button" class="btn" data-act="exp" data-k="list"' + (x ? '' : ' disabled') + '>明細一覧の CSV</button></div>';
    if (cfg().zengin_enabled !== true) h += '<p class="help">振込データ（全銀形式）は、管理者が「設定」の「振込データの書き出しを使う」に印を入れるまで出しません。</p>';
    h += '<div class="band warn"><b>書き出したファイルの扱い</b><ul><li>ファイルはこのパソコンの「ダウンロード」フォルダに入ります。氏名と金額（振込データは口座の番号も）が入っています。</li>' +
      '<li>銀行・会計ソフトに取り込んだら、Finder の「ダウンロード」でそのファイルを選び、ごみ箱へ入れて「ごみ箱を空にする」まで行ってください。</li>' +
      '<li>メール・チャット・共有のフォルダには入れないでください。書き出したことは記録に残ります。</li></ul></div></div>';
    return h;
  }
  var EXP = { zengin: '振込データ', journal: '仕訳の CSV', ledger: '賃金台帳の CSV', list: '明細一覧の CSV' };
  function download(res) {
    var blob = res.bytes ? new Blob([res.bytes], { type: 'text/plain' }) : new Blob(['﻿' + String(res.text || '')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = String(res.name || 'payroll.csv').replace(/[^\w.-]/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
  }
  function exportGo(kind, btn) {
    var x = X();
    if (busy || !frozen() || !x || !EXP[kind] || typeof x[kind] !== 'function') return;
    if (kind === 'zengin' && cfg().zengin_enabled !== true) return;
    var done = hold(btn, '作っています…'), base = { ym: ym, period: period(), payDate: payDate(), settings: cfg(), items: items(), profiles: bs.profiles };
    rpc('payroll_export_log', { p_ym: ym, p_kind: kind }).then(okOr).then(function () {
      if (kind !== 'zengin') return x[kind](base);
      return rpc('payroll_bank_export', { p_ym: ym }).then(okOr).then(function (r) {
        var accounts = obj(r.accounts), res = x.zengin(Object.assign({}, base, { accounts: accounts }));
        accounts = null; r.accounts = null;
        zcheck = { ym: ym, count: num(res.count), total: num(res.total) };
        return res;
      });
    }).then(function (res) {
      done();
      if (!res) return;
      download(res);
      toast(EXP[kind] + 'を書き出しました。使い終わったら消してください。');
      return load(true);
    })['catch'](function (e) { done(); fail(e, '書き出し'); });
  }

  /* ── 職員の給与設定 ── */
  var PAY_TYPE = { monthly: '月給', hourly: '時給', daily: '日給', board: '役員報酬' };
  function missingOf(p) {
    var d = p.data, ins = obj(d.ins), m = [];
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
      h += '<tr><td class="nm">' + esc(p.name) + (d.exclude === true ? ' <span class="tag">計算から外す</span>' : '') + '</td><td>' + esc(PAY_TYPE[d.pay_type] || '—') + '</td><td class="num">' + esc(d.pay_type === 'board' ? yen(d.board_pay) : (d.base != null ? yen(d.base) : '—')) + '</td>' +
        '<td>' + esc((obj(ins.health).std ? yen(ins.health.std) : '—') + '／' + (obj(ins.pension).std ? yen(ins.pension.std) : '—')) + '</td><td>' + esc(tx.col === 'kou' ? '甲・扶養' + num(tx.dependents) : tx.col === 'otsu' ? '乙' : tx.col === 'none' ? 'なし' : '—') + (tx.dependents_checked === false ? ' <span class="tag warn">⚠ 扶養が未確認</span>' : '') + '</td>' +
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
    var h = '<p>' + esc(p.name) + ' さん（今の版: ' + esc(p.effective_from ? md(p.effective_from) + 'から' : '—') + '）</p>';
    h += '<fieldset><legend>いつから</legend><div class="kv">' + sel('f-from', '設定を変える日（期間の初日）', froms[0], froms.map(function (f, i) { return [f, jdate(f) + (i === 0 ? '（この月分から）' : '（次の月分から）')]; })) + '</div></fieldset>';
    h += '<fieldset><legend>給与</legend><div class="kv">' + sel('f-type', '給与形態', d.pay_type, [['', '（選ぶ）'], ['monthly', '月給'], ['hourly', '時給'], ['daily', '日給'], ['board', '役員報酬']]) +
      inp('f-base', '基本給・時給・日給（円）', d.base, NUMA) + inp('f-board', '役員報酬（円）', d.board_pay, NUMA) +
      inp('f-amh', '月平均所定労働時間', d.avg_month_hours, ' inputmode="decimal"') + inp('f-amd', '月平均所定労働日数', d.avg_month_days, ' inputmode="decimal"') + inp('f-dh', '1日の所定時間（日給）', d.day_hours, ' inputmode="decimal"') + '</div>';
    var pays = bs.allowances.filter(function (a) { return a.sec === 'pay' && !a.hidden; }), deds = bs.allowances.filter(function (a) { return a.sec === 'deduct' && !a.hidden; });
    function amtOf(list, code) { var x = arr(list).filter(function (a) { return a && a.code === code; })[0]; return x ? x.amount : ''; }
    if (pays.length) h += '<p class="help">手当（月の額・空欄は無し）</p><div class="kv">' + pays.map(function (a, i) { return inp('f-al' + i, a.name || a.code, amtOf(d.allowances, a.code), NUMA); }).join('') + '</div>';
    if (deds.length) h += '<p class="help">固定の控除（月の額・空欄は無し）</p><div class="kv">' + deds.map(function (a, i) { return inp('f-de' + i, a.name || a.code, amtOf(d.deductions, a.code), NUMA); }).join('') + '</div>';
    h += '<div class="kv">' + inp('f-cm', '通勤手当（月の額・円）', cm.monthly, NUMA) + sel('f-cmm', '通勤の手段', cm.means, [['', '（選ぶ）'], ['public', '公共交通'], ['car', '車・自転車'], ['mixed', '併用']]) + inp('f-cmd', '片道の距離（km）', cm.distance_km, ' inputmode="decimal"') + '</div></fieldset>';
    h += '<fieldset><legend>本人</legend><div class="kv">' + inp('f-birth', '生年月日', d.birth_date, ' type="date"') + sel('f-gender', '性別（賃金台帳）', d.gender, [['', '（選ぶ）'], ['male', '男'], ['female', '女']]) +
      inp('f-entry', '入社日', d.entry_date, ' type="date"') + inp('f-retire', '退職日', d.retire_date, ' type="date"') + '</div></fieldset>';
    h += '<fieldset><legend>社会保険・雇用保険</legend><div class="row">' + chk('f-h-on', '健康保険に入る', obj(ins.health).on) + chk('f-p-on', '厚生年金に入る', obj(ins.pension).on) + chk('f-e-on', '雇用保険に入る', obj(ins.emp).on) + chk('f-care-ex', '介護保険の対象外', ins.care_exempt === true) + '</div>' +
      '<div class="kv">' + inp('f-h-std', '健保の標準報酬月額（円）', obj(ins.health).std, NUMA) + inp('f-p-std', '厚年の標準報酬月額（円）', obj(ins.pension).std, NUMA) + '</div></fieldset>';
    h += '<fieldset><legend>税</legend><div class="kv">' + sel('f-col', '源泉の区分', tx.col, [['', '（選ぶ）'], ['kou', '甲欄'], ['otsu', '乙欄'], ['none', '対象外']]) + inp('f-deps', '扶養親族等の数', tx.dependents, NUMA) + '</div>' + chk('f-depok', '扶養の数を確かめた', tx.dependents_checked !== false) +
      '<p class="help">住民税（特別徴収・月の額）</p><div class="kv">' + fiscalMonths().map(function (m, i) { return inp('f-rt' + i, (+m.slice(5)) + '月（' + m.slice(0, 4) + '年）', rt[m], NUMA); }).join('') + '</div></fieldset>';
    h += '<fieldset><legend>そのほか</legend><div class="row">' + chk('f-noatt', '勤怠を使わない（役員・固定給）', d.no_attendance === true) + chk('f-excl', '計算から外す（休職・支給なし）', d.exclude === true) + '</div></fieldset>';
    h += '<div class="kv"><label for="f-reason">直す理由（必ず書く）</label><input id="f-reason" maxlength="200" autocomplete="off"></div>';
    var hist = p.history;
    h += '<h3 style="font-size:16px">履歴</h3>' + (hist.length ? '<div class="tw"><table><thead><tr><th>いつから</th><th>直した日時</th><th>直した人</th><th>理由</th></tr></thead><tbody>' + hist.map(function (x) { x = obj(x); return '<tr><td>' + esc(jdate(x.effective_from)) + '</td><td>' + esc(at(x.updated_at)) + '</td><td>' + esc(x.updated_by || '') + '</td><td>' + esc(x.reason || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="help">履歴はまだありません。</p>');
    openDlg('職員の給与設定を直す', h, '<button type="button" class="btn" data-act="dlg-close">やめる</button><button type="button" class="btn pri" data-act="prof-go">保存する</button>', { mode: 'prof', sid: sid, pays: pays, deds: deds, months: fiscalMonths(), dirtyCheck: true });
  }
  function v(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
  function on(id) { var e = $(id); return !!(e && e.checked); }
  function nOr(id, keep) { var s = v(id).replace(/[,，\s円]/g, ''); if (s === '') return keep === undefined ? null : keep; return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; }
  function profGo(btn) {
    var c = dlgCtx, p = c && profOf(c.sid); if (!p) return;
    var reason = v('f-reason'); if (!reason) { alert(NG.reason); return; }
    var bad = [];
    function n(id, label) { var x = nOr(id); if (x !== x) bad.push(label); return x; }
    /* 今の data を写してから上書きする（画面に無い項目・知らない項目を消さない） */
    var d = JSON.parse(JSON.stringify(p.data));
    d.pay_type = v('f-type') || null;
    d.base = n('f-base', '基本給'); d.board_pay = n('f-board', '役員報酬');
    d.avg_month_hours = n('f-amh', '月平均所定労働時間'); d.avg_month_days = n('f-amd', '月平均所定労働日数'); d.day_hours = n('f-dh', '1日の所定時間');
    var keepA = arr(d.allowances).filter(function (a) { return !c.pays.some(function (x) { return x.code === a.code; }); });
    c.pays.forEach(function (a, i) { var x = n('f-al' + i, a.name || a.code); if (x != null && x === x) { var old = arr(p.data.allowances).filter(function (o) { return o.code === a.code; })[0]; keepA.push(Object.assign({}, old || {}, { code: a.code, amount: x })); } });
    d.allowances = keepA;
    var keepD = arr(d.deductions).filter(function (a) { return !c.deds.some(function (x) { return x.code === a.code; }); });
    c.deds.forEach(function (a, i) { var x = n('f-de' + i, a.name || a.code); if (x != null && x === x) keepD.push({ code: a.code, amount: x }); });
    d.deductions = keepD;
    d.commute = Object.assign({}, obj(d.commute), { monthly: n('f-cm', '通勤手当'), means: v('f-cmm') || null, distance_km: n('f-cmd', '片道の距離') });
    ['birth_date:f-birth', 'entry_date:f-entry', 'retire_date:f-retire'].forEach(function (s) { var k = s.split(':'); var x = v(k[1]); if (x && !isDate(x)) bad.push('日付'); d[k[0]] = x || null; });
    d.gender = v('f-gender') || null;
    var ins = obj(d.ins);
    d.ins = Object.assign({}, ins, { health: Object.assign({}, obj(ins.health), { on: on('f-h-on'), std: n('f-h-std', '健保の標準報酬') }),
      pension: Object.assign({}, obj(ins.pension), { on: on('f-p-on'), std: n('f-p-std', '厚年の標準報酬') }), emp: Object.assign({}, obj(ins.emp), { on: on('f-e-on') }), care_exempt: on('f-care-ex') });
    d.tax = Object.assign({}, obj(d.tax), { col: v('f-col') || null, dependents: n('f-deps', '扶養親族等の数'), dependents_checked: on('f-depok') });
    var rt = Object.assign({}, obj(d.resident_tax));
    c.months.forEach(function (m, i) { var x = n('f-rt' + i, '住民税'); if (x == null) delete rt[m]; else rt[m] = x; });
    d.resident_tax = rt;
    d.no_attendance = on('f-noatt'); d.exclude = on('f-excl');
    if (bad.length) { alert('数の形が違う欄があります：' + bad.filter(function (x, i) { return bad.indexOf(x) === i; }).join('・') + '（半角の数字で書いてください）'); return; }
    var done = hold(btn, '保存しています…');
    rpc('payroll_profile_put', { p_staff_id: p.staff_id, p_effective_from: v('f-from'), p_data: d, p_rev: p.rev, p_reason: reason }).then(okOr).then(function () {
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
  function bankGo(btn) {
    var p = dlgCtx && profOf(dlgCtx.sid); if (!p) return;
    var reason = v('b-reason'); if (!reason) { alert(NG.reason); return; }
    var acc = [], bad = false;
    for (var i = 0; i < 3; i++) {
      var bk = v('b-bk' + i), br = v('b-br' + i), no = v('b-no' + i), kn = v('b-kn' + i);
      if (!bk && !br && !no && !kn) continue;
      if (!/^\d{4}$/.test(bk) || !/^\d{3}$/.test(br) || !/^\d{1,7}$/.test(no) || !kn) { bad = true; break; }
      var am = i ? v('b-am' + i).replace(/[,，\s円]/g, '') : 'rest';
      if (i && !/^\d{1,8}$/.test(am)) { bad = true; break; }
      acc.push({ bank_code: bk, branch_code: br, type: v('b-ty' + i), number: ('0000000' + no).slice(-7), name_kana: kn, amount_or_rest: i ? parseInt(am, 10) : 'rest' });
    }
    if (bad) { alert(NG.badbank + '（2つ目からは送る額も書きます）'); return; }
    if (!acc.length && !confirm('口座を全部消して「口座なし（振込しない）」にしますか？')) return;
    var done = hold(btn, '保存しています…');
    rpc('payroll_bank_put', { p_staff_id: p.staff_id, p_accounts: acc, p_reason: reason }).then(okOr).then(function () {
      acc = null; done(); closeDlg(); toast('口座を保存しました。'); return load(true);
    })['catch'](function (e) { acc = null; done(); fail(e, '口座の保存'); });
  }

  /* ── freee の書き出しを取り込む（管理者・ファイルは保存しない・列は仮置き） ── */
  var HEAD = { emp: '従業員番号', name: '氏名', pay_type: '給与形態', base: '基本給', hourly: '時給', daily: '日給', board: '役員報酬', birth: '生年月日', gender: '性別', entry: '入社日', retire: '退職日',
    hstd: '健康保険の標準報酬月額', pstd: '厚生年金保険の標準報酬月額', emp_ins: '雇用保険', tax_col: '税額表の区分', deps: '扶養親族等の数', commute: '通勤手当',
    bank: '銀行コード', branch: '支店コード', acct_type: '口座種別', acct_no: '口座番号', kana: '口座名義' };
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
  function toNum(s) { s = String(s || '').replace(/[,，\s円]/g, ''); return /^\d+$/.test(s) ? parseInt(s, 10) : null; }
  function buildImport(rows) {
    if (rows.length < 2) throw new Error('行がありません');
    var head = rows[0].map(function (h) { return String(h).trim(); }), col = {}, k;
    for (k in HEAD) col[k] = head.indexOf(HEAD[k]);
    if (col.name < 0 && col.emp < 0) throw new Error('見出しに「' + HEAD.emp + '」か「' + HEAD.name + '」がありません');
    var out = [];
    rows.slice(1).forEach(function (r) {
      function g(key) { return col[key] >= 0 ? String(r[col[key]] == null ? '' : r[col[key]]).trim() : ''; }
      var emp = g('emp'), nm = g('name'), p = null;
      bs.profiles.forEach(function (x) { if (emp && String(x.data.freee_emp_num || '') === emp) p = x; });
      if (!p && nm) { var hit = bs.profiles.filter(function (x) { return normName(x.name) === normName(nm); }); if (hit.length === 1) p = hit[0]; }
      var pt = { '月給': 'monthly', '時給': 'hourly', '日給': 'daily', '役員': 'board', '役員報酬': 'board' }[g('pay_type')] || null;
      var patch = {}, ch = [];
      function setv(key, val, label, show) {
        if (val == null || val === '') return;
        var old = p ? key.split('.').reduce(function (o, k2) { return o == null ? null : o[k2]; }, p.data) : null;
        if (String(old == null ? '' : old) === String(val)) return;
        patch[key] = val; ch.push(label + '：' + (show ? show(old) : (old == null || old === '' ? '（空）' : old)) + ' → ' + (show ? show(val) : val));
      }
      var money = function (x) { return x == null || x === '' ? '（空）' : yen(x) + '円'; };
      setv('freee_emp_num', emp || null, '従業員番号');
      setv('pay_type', pt, '給与形態', function (x) { return PAY_TYPE[x] || '（空）'; });
      setv('base', pt === 'hourly' ? toNum(g('hourly')) : pt === 'daily' ? toNum(g('daily')) : toNum(g('base')), '基本給・時給など', money);
      setv('board_pay', toNum(g('board')), '役員報酬', money);
      setv('birth_date', toDate(g('birth')), '生年月日');
      setv('gender', { '男': 'male', '男性': 'male', '女': 'female', '女性': 'female' }[g('gender')] || null, '性別');
      setv('entry_date', toDate(g('entry')), '入社日'); setv('retire_date', toDate(g('retire')), '退職日');
      setv('ins.health.std', toNum(g('hstd')), '健保の標準報酬', money); setv('ins.pension.std', toNum(g('pstd')), '厚年の標準報酬', money);
      setv('tax.col', { '甲': 'kou', '甲欄': 'kou', '乙': 'otsu', '乙欄': 'otsu' }[g('tax_col')] || null, '源泉の区分');
      setv('tax.dependents', toNum(g('deps')), '扶養親族等の数');
      setv('commute.monthly', toNum(g('commute')), '通勤手当', money);
      var bank = null;
      if (g('bank') || g('acct_no')) {
        var no = g('acct_no').replace(/\D/g, '');
        bank = { bank_code: g('bank').replace(/\D/g, ''), branch_code: g('branch').replace(/\D/g, ''), type: { '普通': '1', '当座': '2', '貯蓄': '4' }[g('acct_type')] || '1', number: ('0000000' + no).slice(-7), name_kana: g('kana'), amount_or_rest: 'rest' };
        if (!/^\d{4}$/.test(bank.bank_code) || !/^\d{3}$/.test(bank.branch_code) || !/^\d{1,7}$/.test(no)) { ch.push('⚠ 口座の形が違うので送りません'); bank = null; }
        else ch.push('口座：＊＊＊' + no.slice(-4));
      }
      out.push({ name: nm || emp, staff_id: p ? p.staff_id : null, pname: p ? p.name : '', patch: patch, bank: bank, changes: ch });
    });
    return out;
  }
  function importHtml() {
    var h = '<div class="cd"><h2>freee の書き出しを取り込む（管理者）</h2><p class="help">freee 人事労務から書き出した従業員の CSV を選ぶと、画面の中だけで読み、今の設定との違いを見せます。ファイルはどこにも保存しません。「送る」を押すまでデータベースは変わりません。</p>';
    h += '<div class="row"><label for="i-file">CSV のファイル</label><input type="file" id="i-file" accept=".csv,text/csv"></div>';
    if (importErr) h += '<div class="band ng" role="alert">' + esc(importErr) + '</div>';
    if (importRows) {
      var ok = importRows.filter(function (r) { return r.staff_id && (r.changes.length || r.bank); });
      h += '<div class="tw"><table><thead><tr><th>CSV の氏名</th><th>この画面の職員</th><th>違い</th></tr></thead><tbody>' + importRows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td>' + (r.staff_id ? esc(r.pname) : '<span class="tag ng">⚠ 見つかりません（送りません）</span>') + '</td><td>' + (r.changes.length ? esc(r.changes.join('／')) : '違いなし') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      h += '<div class="kv"><label for="i-reason">理由（必ず書く）</label><input id="i-reason" maxlength="200" autocomplete="off" value="freee からの取り込み"></div>' +
        '<div class="row"><button type="button" class="btn" data-act="imp-cancel">やめる</button><button type="button" class="btn pri" data-act="imp-go"' + (ok.length ? '' : ' disabled') + '>' + esc(ok.length) + '人分を送る</button></div>';
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
      try { importRows = buildImport(parseCsv(decode(buf))); } catch (e) { importErr = '読めませんでした：' + (e && e.message ? e.message : '形が違います') + '。freee の従業員の CSV を選んでください。'; }
      buf = null; paint();
    }, function (e) { note('取り込みの読み込み', e); importErr = 'ファイルを読めませんでした。'; paint(); });
  }
  function importGo(btn) {
    if (!importRows || !isAdmin()) return;
    var reason = v('i-reason'); if (!reason) { alert(NG.reason); return; }
    var rows = importRows.filter(function (r) { return r.staff_id && (r.changes.length || r.bank); }).map(function (r) { return { staff_id: r.staff_id, patch: r.patch, bank: r.bank }; });
    if (!rows.length) return;
    if (!confirm(rows.length + '人分の設定（口座を含む）を送ります。よろしいですか？')) return;
    var done = hold(btn, '送っています…');
    rpc('payroll_import_put', { p_rows: rows, p_reason: reason }).then(okOr).then(function () {
      rows = null; importRows = null; done(); toast('取り込みました。計算し直してください。'); return load(false);
    })['catch'](function (e) { rows = null; done(); fail(e, '取り込み'); });
  }

  /* ── 設定（管理者だけ） ── */
  function settingsHtml() {
    var c = cfg(), ot = obj(c.ot_rates), rd = obj(c.round), bf = obj(c.bank_from), zg = obj(c.zengin);
    var RND = [['ceil', '切り上げ'], ['floor', '切り捨て'], ['round', '四捨五入']];
    var h = '<div class="cd"><h2>給与の設定（管理者だけ）</h2><p class="help">締め日は勤怠管理の設定が正本です（ここでは変えません）。</p>';
    h += '<fieldset><legend>支給日・徴収</legend><div class="kv">' + inp('s-payday', '支給日（毎月 何日）', c.pay_day, NUMA) + sel('s-shift', '土日祝の時', c.pay_day_shift || 'before', [['before', '前の営業日'], ['after', '後の営業日']]) +
      sel('s-si', '社会保険の徴収', c.si_month || 'next', [['next', '翌月徴収'], ['current', '当月徴収']]) + sel('s-tax', '所得税の出し方', c.tax_method || 'table', [['table', '税額表'], ['computer', '電算機の特例']]) +
      sel('s-night', '深夜の割増', c.night_premium || 'included', [['included', '夜勤手当に含む（不足は警告）'], ['pay', '別に払う']]) + '</div></fieldset>';
    h += '<fieldset><legend>割増率・所定時間</legend><div class="kv">' + inp('s-ot-in', '法定内残業（倍）', ot['in'], ' inputmode="decimal"') + inp('s-ot-out', '時間外（倍）', ot.out, ' inputmode="decimal"') + inp('s-ot-60', '60時間超の上乗せ', ot.over60, ' inputmode="decimal"') +
      inp('s-ot-night', '深夜の上乗せ', ot.night, ' inputmode="decimal"') + inp('s-ot-hol', '法定休日（倍）', ot.holiday, ' inputmode="decimal"') +
      inp('s-amh', '月平均所定労働時間（既定）', c.avg_month_hours_default, ' inputmode="decimal"') + inp('s-amd', '月平均所定労働日数（既定）', c.avg_month_days_default, ' inputmode="decimal"') + '</div>' +
      '<div class="row">' + chk('s-abs', '欠勤控除をする', c.absence_deduct !== false) + chk('s-late', '遅刻・早退の控除をする', c.late_deduct !== false) + '</div></fieldset>';
    h += '<fieldset><legend>端数</legend><div class="kv">' + sel('s-r-hu', '1時間あたりの賃金', rd.hour_unit || 'ceil', RND) + sel('s-r-pr', '割増賃金', rd.premium || 'ceil', RND) + sel('s-r-ra', '日割り', rd.prorate || 'floor', RND) +
      sel('s-r-du', '控除の1時間あたり', rd.deduct_unit || 'floor', RND) + sel('s-r-de', '控除の額', rd.deduct || 'floor', RND) + '</div></fieldset>';
    h += '<fieldset><legend>振込元・全銀</legend><div class="kv">' + inp('s-bf-cc', '委託者コード（10桁）', bf.consignor_code, NUMA) + inp('s-bf-ck', '委託者名（カナ）', bf.consignor_kana) +
      inp('s-bf-bk', '振込元の銀行コード', bf.bank_code, NUMA) + inp('s-bf-br', '支店コード', bf.branch_code, NUMA) + sel('s-bf-ty', '種目', String(bf.type || '1'), [['1', '普通'], ['2', '当座']]) + inp('s-bf-no', '口座番号', bf.number, NUMA) +
      sel('s-zk', '振込の種別', zg.kind || '21', [['21', '総合振込'], ['11', '給与振込']]) + inp('s-co', '明細に刷る事業者名', c.company_name) + '</div>' +
      chk('s-zen', '振込データ（全銀形式）の書き出しを使う', c.zengin_enabled === true) + '</fieldset>';
    h += '<div class="kv"><label for="s-reason">直す理由（必ず書く）</label><input id="s-reason" maxlength="200" autocomplete="off"></div><div class="row"><button type="button" class="btn pri" data-act="set-go">設定を保存する</button></div></div>';
    h += '<div class="cd"><h2>給与の名簿（給与の画面を使える人）</h2><p class="help">管理者のほかに使える人のメールを入れます。名簿の人は事務所のアカウントで、二段階のログインを済ませている時だけ使えます（データベースが確かめます）。加えて「アプリの使える人」でその人に「給与」を許してください。</p>';
    if (members === null) h += '<button type="button" class="btn" data-act="mem-load">名簿を読む</button>';
    else {
      h += members.length ? '<ul>' + members.map(function (m, i) { return '<li>' + esc(m.email) + ' <button type="button" class="btn ng" data-act="mem-del" data-i="' + esc(i) + '">外す</button></li>'; }).join('') + '</ul>' : '<p class="help">名簿に人はいません（管理者だけが使えます）。</p>';
      h += '<div class="row"><label for="m-add">メール</label><input id="m-add" type="email" inputmode="email" autocomplete="off"><button type="button" class="btn" data-act="mem-add">名簿に足す</button></div>';
    }
    return h + '</div>';
  }
  function settingsGo(btn) {
    if (!isAdmin()) return;
    var reason = v('s-reason'); if (!reason) { alert(NG.reason); return; }
    var bad = [];
    function n(id, label) { var x = nOr(id); if (x !== x) bad.push(label); return x; }
    var c = JSON.parse(JSON.stringify(cfg()));
    c.pay_day = n('s-payday', '支給日'); c.pay_day_shift = v('s-shift'); c.si_month = v('s-si'); c.tax_method = v('s-tax'); c.night_premium = v('s-night');
    c.ot_rates = Object.assign({}, obj(c.ot_rates), { 'in': n('s-ot-in', '法定内残業'), out: n('s-ot-out', '時間外'), over60: n('s-ot-60', '60時間超'), night: n('s-ot-night', '深夜'), holiday: n('s-ot-hol', '法定休日') });
    c.avg_month_hours_default = n('s-amh', '月平均所定労働時間'); c.avg_month_days_default = n('s-amd', '月平均所定労働日数');
    c.absence_deduct = on('s-abs'); c.late_deduct = on('s-late');
    c.round = Object.assign({}, obj(c.round), { hour_unit: v('s-r-hu'), premium: v('s-r-pr'), prorate: v('s-r-ra'), deduct_unit: v('s-r-du'), deduct: v('s-r-de') });
    c.bank_from = Object.assign({}, obj(c.bank_from), { consignor_code: v('s-bf-cc'), consignor_kana: v('s-bf-ck'), bank_code: v('s-bf-bk'), branch_code: v('s-bf-br'), type: v('s-bf-ty'), number: v('s-bf-no') });
    c.zengin = Object.assign({}, obj(c.zengin), { kind: v('s-zk') });
    c.company_name = v('s-co'); c.zengin_enabled = on('s-zen');
    if (c.pay_day != null && !(c.pay_day >= 1 && c.pay_day <= 31)) bad.push('支給日');
    if (bad.length) { alert('数の形が違う欄があります：' + bad.join('・')); return; }
    var done = hold(btn, '保存しています…');
    rpc('payroll_settings_put', { p_config: c, p_rev: bs.settings.rev, p_reason: reason }).then(okOr).then(function () { done(); toast('設定を保存しました。'); return load(false); })['catch'](function (e) { done(); fail(e, '設定の保存'); });
  }
  function memLoad() {
    rpc('payroll_members_get', {}).then(okOr).then(function (r) { members = arr(r.members).filter(function (m) { return m && typeof m.email === 'string'; }); paint(); })['catch'](function (e) { fail(e, '名簿の読み込み'); });
  }
  function memPut(list, btn) {
    var done = hold(btn, '保存しています…');
    rpc('payroll_members_put', { p_emails: list }).then(okOr).then(function () { done(); toast('給与の名簿を保存しました。'); memLoad(); })['catch'](function (e) { done(); fail(e, '名簿の保存'); });
  }

  /* ── 10分操作が無ければ金額を消す ── */
  function mask() {
    if (masked || view !== 'app') return;
    masked = true; closeDlg(); importRows = null; printList = null; put($('p-print'), '');
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
      masked = false; lastAct = Date.now(); paint();
    }, function () { done(); toast('ログインを確かめられませんでした。通信を確かめてから、もう一度押してください。'); });
  }
  function idleCheck() { if (view === 'app' && !masked && Date.now() - lastAct > IDLE_MS) mask(); }

  /* ── 覆い ── */
  var GATE = {
    mfa: ['二段階のログインを済ませてください', '給与の画面は、二段階のログイン（認証アプリの6桁）を済ませた時だけ開けます。ログインの画面で6桁を入れてから開き直してください。'],
    denied: ['給与の画面は開けません', 'このアカウントは給与の名簿に入っていません。給与の金額を見られるのは、管理者と、管理者が給与の名簿に入れた人だけです。必要な時は管理者に伝えてください。'],
    nocalc: ['画面の部品を読み込めませんでした', 'ページを読み込み直してください。直らない時は管理者に知らせてください。'],
    error: ['ログインを確かめられませんでした', '電波・Wi-Fi を確かめてから、ページを読み込み直してください。']
  };
  function showGate(why) {
    view = 'gate'; masked = false; closeDlg(); bs = null; calc = null; importRows = null;
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
    if (isDirty() && !confirm('保存していない計算・調整があります。月分を変えると捨てます。よろしいですか？')) { $('p-ym').value = ym; return; }
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
      if (a === 'dlg-close') { if (busy) return; if (!dlgDirty() || confirm('入れた内容を捨てて閉じますか？')) closeDlg(); }
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
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { alert('メールの形が違います。'); return; }
        if (members.some(function (m) { return m.email === em; })) return;
        memPut(members.map(function (m) { return m.email; }).concat([em]), b);
      }
      else if (a === 'mem-del') {
        var m0 = members[+b.getAttribute('data-i')]; if (!m0) return;
        if (!confirm(m0.email + ' を給与の名簿から外しますか？')) return;
        memPut(members.filter(function (m) { return m !== m0; }).map(function (m) { return m.email; }), b);
      }
      else if (a === 'unmask') unmask(b);
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
    $('p-reload').addEventListener('click', function () { if (isDirty() && !confirm('保存していない計算・調整を捨てて読み直しますか？')) return; load(false); });
    $('p-dlg').addEventListener('cancel', function (e) { if (busy || (dlgDirty() && !confirm('入れた内容を捨てて閉じますか？'))) { e.preventDefault(); return; } closeDlg(); });
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(function (ev) { document.addEventListener(ev, function () { if (!masked) lastAct = Date.now(); }, { passive: true, capture: true }); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) idleCheck(); });
    window.addEventListener('focus', idleCheck);
    setInterval(idleCheck, 15000);
    window.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('storage', function (e) { if (e.key === 'su_device_role' && isField()) location.reload(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted && isField()) location.reload(); });
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
        view = 'app';
        $('p-app').hidden = false;
        var t = lsGet(LS_TAB); tab = TABS.indexOf(t) >= 0 && (t !== 'settings' || isAdmin()) ? t : 'run';
        ym = todayYm(); $('p-ym').value = ym;
        bind(); definePrint();
        try { if (window.SUPerf) window.SUPerf.ready(); } catch (_) {}
        return load(false);
      });
    })['catch'](function (e) { note('起動', e); showGate('error'); });
  }
  var go = function () { try { boot(); } catch (e) { note('起動', e); } };
  if (window.SUFacility && typeof window.SUFacility.onReady === 'function') window.SUFacility.onReady(go); else go();
  /* 試験だけが読む（画面の動きには使わない） */
  window.__payrollTest = { normBoot: normBoot, figures: figures, totals: totals, parseCsv: parseCsv, missingOf: missingOf, TABS: TABS, IDLE_MS: IDLE_MS };
})();
