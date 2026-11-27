/*
 * kintai-self.js — 自分の勤怠（職員本人のスマホの画面・kintai-self.html）の動き（2026-11-20 新設・契約 ROOT-v5-freee.md「段5」・care-backend 統合 0114）
 * 1. 住所の # の後ろの番号（c=40字の16進＝QR か 8文字）を読んだらすぐ住所から消す。番号はメモリだけに持つ
 * 2. 登録: 受け口 kintai-self へ {op:'redeem', code, pin} を送り、返った鍵だけを端末に置く（localStorage の kintai_self_key）。続けて同じ暗証番号で開く
 * 3. 開くたびに暗証番号 → 受け口が返した「開いている印」はメモリだけ。2分さわらない・「閉じる」で印・表示名・勤怠・有給・申請を捨て、画面からも消す
 * 4. 勤怠は kintai-calc.js の computeMonth、有給は kintai-leave.js で数える（管理画面と同じ部品）。申請は受け口へ出し、一覧を読み直す
 * 5. v6（統合 0125）: 開いた時に事務所からの打刻漏れの知らせ（op notices）を1回読み、上に帯を出す（決まった文だけ・その日の打刻がそろったら出さない・帯から打刻の直しを開ける）。
 *    申請に「休暇」（有休の1日・半日・時間単位・特別休暇・代休・振替）を足した。有給の残りは時間単位で取った分も引く（受け口が absences を返す時）
 * ★端末に置くのは鍵とタブの印（kintai_self_tab）だけ。表示はすべて textContent と createElement（HTML の代入は使わない）。console は使わない。
 */
(function () {
  'use strict';
  var ENDPOINT = 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/kintai-self';
  var PUBLISHABLE = 'sb_publishable_D8mWQenb7E8q7q6On45HaQ_GKxAE_zI';   // su-auth.js と同じ公開用の鍵（これだけでは何も読めない）
  var KEY_LS = 'kintai_self_key', TAB_LS = 'kintai_self_tab';
  var TABS = ['days', 'leave', 'req'];
  var S = window.KintaiSelfCalc, C = window.KintaiCalc, L = window.KintaiLeave;
  var $ = function (id) { return document.getElementById(id); };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 消せない端末は次の登録で上書き */ } }

  var VIEWS = ['loading', 'broken', 'enroll', 'pin', 'app'];
  function show(name) { VIEWS.forEach(function (v) { $('v-' + v).hidden = v !== name; }); $('b-close').hidden = name !== 'app'; $('who').hidden = name !== 'app'; }
  function msg(id, text, kind) { var el = $(id); el.textContent = text || ''; el.hidden = !text; if (kind) el.className = 'msg ' + kind; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  if (!S || !C || !L) { show('broken'); return; }

  // ① 番号を読んで、すぐ住所から消す
  var code = S.codeFromHash(location.hash);
  if (location.hash) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* 古い端末では消せないこともある（番号は1回限り） */ } }

  // 状態（メモリだけ）
  var key = lsGet(KEY_LS);
  if (key && !/^[0-9a-f]{64}$/.test(key)) { lsDel(KEY_LS); key = null; }
  var open = null, months = {}, curYm = null, viewYm = null, leaveData = null, reqRows = null, gen = 0, busy = false;
  var notices = null;   /* v6: 知らせ（受け口の行・メモリだけ） */
  var tab = TABS.indexOf(lsGet(TAB_LS)) >= 0 ? lsGet(TAB_LS) : 'days';
  var lastReq = null;   // 送り直しの印（同じ中身の送り直しは同じ client_id）

  async function call(op, payload) {
    var body = { op: op }, k;
    for (k in payload) body[k] = payload[k];
    var res, j = null;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE }, body: JSON.stringify(body) });
    } catch (e) { return { ok: false, error: 'net' }; }
    try { j = await res.json(); } catch (e) { j = null; }
    if (!j || typeof j !== 'object') return { ok: false, error: res.ok ? 'server' : 'net' };
    if (j.ok !== true && typeof j.error !== 'string') j.error = 'server';
    return j;
  }
  // 鍵が使えない・閉じた時は、どの画面からでも同じ所へ戻す
  function handleAuth(r) {
    if (r && r.error === 'nokey') { forgetLocal(); lock(''); msg('enroll-msg', S.errorText('nokey'), 'ng'); return true; }   // 先に中身を捨ててから知らせる
    if (r && r.error === 'closed') { lock(S.errorText('closed')); return true; }
    if (r && r.error === 'inactive') { lock(S.errorText('inactive')); return true; }   // 鍵は消さず、中身を捨てて暗証番号の画面のまま止める
    return false;
  }

  // ── 閉じる（印と中身をメモリと画面から捨てる）──
  var idleTimer = null;
  function lock(text) {
    gen++;
    open = null; months = {}; curYm = null; viewYm = null; leaveData = null; reqRows = null; lastReq = null; notices = null; monthWait = {};
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    ['days-head', 'days-list', 'leave-box', 'req-list', 'nt-box'].forEach(function (id) { clear($(id)); });
    clear($('need-box')); $('need-box').hidden = true;   /* 確かめが要る日の帯も捨てる（2026-11-27） */
    $('nt-box').hidden = true; $('rq-lv-remain').textContent = '';
    $('who').textContent = '';
    $('f-req').reset(); msg('rq-msg', ''); msg('app-msg', '');
    $('in-pin').value = '';
    if (window.KintaiSelfBoard) window.KintaiSelfBoard.reset();   /* 段B（統合 0130）: お知らせと補助項目の申請の中身も捨てる */
    msg('pin-msg', text || '', text ? 'warn' : null);
    if (key) show('pin'); else showEnroll();
  }
  function touch() {
    if (!open) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { lock('2分間さわらなかったため閉じました。暗証番号を入れ直してください。'); }, S.IDLE_MS);
  }
  ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true, capture: true }); });
  // 隠れている間に2分を過ぎていたら、戻った時に閉じる（タイマーが止まる端末がある）
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (open && hiddenAt && Date.now() - hiddenAt >= S.IDLE_MS) lock('しばらく開いていなかったため閉じました。暗証番号を入れ直してください。');
    hiddenAt = 0;
  });
  function forgetLocal() { key = null; lsDel(KEY_LS); open = null; }

  // ── 登録 ──
  function showEnroll() {
    $('fld-code').hidden = !!code && /^[0-9a-f]{40}$/.test(code);
    $('code-from-qr').hidden = !(code && /^[0-9a-f]{40}$/.test(code));
    if (code && !/^[0-9a-f]{40}$/.test(code)) $('in-code').value = code;
    show('enroll');
  }
  $('f-enroll').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (busy) return;
    var c = code && /^[0-9a-f]{40}$/.test(code) ? code : S.shortOf($('in-code').value);
    if (!c) { msg('enroll-msg', '登録の番号（8文字）を確かめてください。', 'ng'); return; }
    var p1 = $('in-pin1').value, p2 = $('in-pin2').value, bad = S.pinProblem(p1, p2);
    if (bad) { msg('enroll-msg', bad, 'ng'); return; }
    busy = true; $('b-enroll').disabled = true; msg('enroll-msg', '');
    var r = await call('redeem', { code: c, pin: p1 });
    busy = false; $('b-enroll').disabled = false;
    if (r.ok !== true || typeof r.key !== 'string' || !/^[0-9a-f]{64}$/.test(r.key)) {
      if (r.error === 'invalid' || r.error === 'limited') { code = ''; $('fld-code').hidden = false; $('code-from-qr').hidden = true; }
      msg('enroll-msg', S.errorText(r.ok === true ? 'server' : r.error), 'ng'); return;
    }
    code = '';
    var old = key;
    key = r.key;
    // 前の登録（このスマホで前に使っていた鍵）は外す（同じスマホを2台に数えない）
    if (old && old !== key) call('forget', { key: old });
    if (!lsSet(KEY_LS, key)) msg('enroll-msg', 'このスマホに登録を残せませんでした（プライベートブラウズでは残りません）。開いている間だけ使えます。', 'warn');
    $('in-pin1').value = ''; $('in-pin2').value = ''; $('in-code').value = '';
    await unlock(p1);
  });

  // ── 暗証番号 ──
  async function unlock(pin) {
    busy = true; $('b-pin').disabled = true;
    var r = await call('pin', { key: key, pin: pin });
    busy = false; $('b-pin').disabled = false;
    $('in-pin').value = '';
    if (r.ok !== true) {
      if (r.error === 'nokey') { handleAuth(r); return; }
      var t = S.errorText(r.error);
      if (r.error === 'wrong' && typeof r.left === 'number') t += 'あと ' + r.left + ' 回間違えると、しばらく開けなくなります。';
      if (r.error === 'locked' && r.until) { var u = Date.parse(r.until); if (!isNaN(u)) t += '（' + S.hm(u) + ' ごろから入れられます）'; }
      msg('pin-msg', t, 'ng'); show('pin'); return;
    }
    if (typeof r.open !== 'string' || !/^[0-9a-f]{64}$/.test(r.open)) { msg('pin-msg', S.errorText('server'), 'ng'); show('pin'); return; }
    open = r.open;
    var nm = typeof r.name === 'string' ? r.name : '';
    $('who').textContent = nm ? nm + (/(さん|様)$/.test(nm) ? '' : ' さん') + 'の勤怠' : '';
    msg('pin-msg', '');
    show('app');
    touch();
    setTab(tab);
    loadNotices();
    /* 段B（統合 0130・kintai-self-board.js）: お知らせと補助項目の申請。鍵と開いている印はここで足して渡す（部品には持たせない） */
    if (window.KintaiSelfBoard) window.KintaiSelfBoard.start(function (op, p) { var b = { key: key, open: open }, k; for (k in p) b[k] = p[k]; return call(op, b); }, handleAuth);
  }
  $('f-pin').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var p = $('in-pin').value;
    if (!/^[0-9]{4}$/.test(p)) { msg('pin-msg', S.errorText('badpin'), 'ng'); return; }
    unlock(p);
  });
  $('b-close').addEventListener('click', function () { lock(''); });

  // ── 登録を外す ──
  async function forget() {
    if (!window.confirm('このスマホの登録を外しますか？外すと、もう一度使う時は管理者に登録の番号を出してもらいます。')) return;
    var k = key;
    forgetLocal();
    lock('');
    if (k) await call('forget', { key: k });
    msg('enroll-msg', 'このスマホの登録を外しました。', 'ok');
    showEnroll();
  }
  $('b-forget').addEventListener('click', forget);
  $('b-forget-pin').addEventListener('click', forget);

  // ── タブ ──
  function setTab(t) {
    if (TABS.indexOf(t) < 0) t = 'days';
    tab = t; lsSet(TAB_LS, t);
    TABS.forEach(function (x) {
      var b = $('t-' + x); b.setAttribute('aria-selected', x === t ? 'true' : 'false');
      $('p-' + x).hidden = x !== t;
    });
    msg('app-msg', '');
    if (t === 'days') loadDays(viewYm);
    else if (t === 'leave') loadLeave();
    else loadReqs();
  }
  TABS.forEach(function (x) { $('t-' + x).addEventListener('click', function () { setTab(x); }); });

  // ── 勤怠 ──
  var monthWait = {};   /* 読んでいる最中の月分（勤怠のタブと知らせが同じ月分を2回読まない・閉じた時に捨てる） */
  async function getMonth(ym, my) {
    if (months[ym]) return months[ym];
    if (!monthWait[ym]) { var w = monthWait[ym] = call('month', { key: key, open: open, ym: ym }); w.then(function () { if (monthWait[ym] === w) delete monthWait[ym]; }); }
    var r = await monthWait[ym];
    if (my !== gen) return null;
    if (r.ok !== true) { if (!handleAuth(r)) msg('app-msg', S.errorText(r.error), 'ng'); return null; }
    months[ym] = r;
    return r;
  }
  /* 今月分（締め日で決める）を決めて読む。読めない・閉じた時は false */
  async function ensureCur(my, today) {
    if (curYm) return true;
    var y0 = S.ymOf(today), d0 = await getMonth(y0, my);
    if (!d0 || my !== gen) return false;
    var c = S.currentYm(today, y0, d0.period);
    if (c !== y0 && !(await getMonth(c, my))) return false;
    if (my !== gen) return false;
    curYm = c;
    return true;
  }
  async function loadDays(ym) {
    var my = gen, today = S.todayOf(Date.now());
    if (!(await ensureCur(my, today))) return;
    viewYm = ym || curYm;
    $('b-cur').setAttribute('aria-pressed', viewYm === curYm ? 'true' : 'false');
    $('b-prev').setAttribute('aria-pressed', viewYm !== curYm ? 'true' : 'false');
    var d = await getMonth(viewYm, my);
    if (!d || my !== gen) return;
    paintDays(d, viewYm, today);
  }
  /* 確かめが要る日（2026-11-27）: 日の札（S.dayRows の flags）のうち、計算の部品の要確認（C.REVIEW）の札がある日。確認済みの札がある日は数えない。
     札の名前は計算の部品の FLAG_LABEL をそのまま使う（判定を2つに分けない）。返す: [{ date, label }] */
  function needDays(rows) {
    var rv = (C && C.REVIEW) || {}, fl = (C && C.FLAG_LABEL) || {}, labels = {};
    Object.keys(rv).forEach(function (k) { if (fl[k]) labels[fl[k]] = 1; });
    var chk = fl.checked;
    return rows.filter(function (r) { return !r.future && r.flags.some(function (f) { return labels[f]; }) && r.flags.indexOf(chk) < 0; });
  }
  function md(date) { return (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)); }
  function paintNeed(need) {
    var box = $('need-box');
    clear(box);
    box.hidden = !need.length;
    if (!need.length) return;
    var shown = need.slice(0, 3).map(function (r) { return md(r.date); }).join('・') + (need.length > 3 ? ' ほか ' + (need.length - 3) + ' 日' : '');
    var b = el('button', 'need', '確かめが要る日が ' + need.length + ' 日あります（' + shown + '）');
    b.type = 'button';
    b.addEventListener('click', function () { var t = document.querySelector('#days-list .day[data-date="' + need[0].date + '"]'); if (t) { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); try { t.focus({ preventScroll: true }); } catch (e) { /* 焦点を移せない時は送るだけ */ } } });
    box.appendChild(b);
  }
  function paintDays(d, ym, today) {
    var head = $('days-head'), list = $('days-list');
    clear(head); clear(list); paintNeed([]);
    var m;
    try { m = S.computeOf(d, ym, C, Date.now()); } catch (e) { msg('app-msg', '勤怠を数えられませんでした。ページを読み込み直してください。', 'ng'); return; }
    var h = S.monthHead(d, C, ym), tot = S.monthTotals(m);
    head.appendChild(el('h2', null, h.label));
    if (h.locked) head.appendChild(el('p', 'msg ok', 'この月分は締めてあります。直しが要る時は事務所に伝えてください。'));
    var rows = S.dayRows(m, C, today);
    if (!rows.length) { head.appendChild(el('p', 'muted empty', 'この月分の予定と打刻はまだありません。')); return; }   /* 予定も打刻も無い月は、0 の並ぶ合計を出さずに空の箱だけ（2026-11-27） */
    if (S.draftNote(h)) head.appendChild(el('p', 'help draft-note', S.draftNote(h)));   /* 締めていない月分の数字は目安（反証レビュー 2026-11-21）。目立たせない注記にした（2026-11-27） */
    paintNeed(needDays(rows));
    var t = el('div', 'tot');
    [['実働の合計', S.minText(tot.workMin)], ['出勤の日数', tot.workDays + ' 日'], ['有休', tot.paidDays + ' 日'], ['予定を超えた時間', S.minText(tot.overtimeMin)]].forEach(function (x) {
      var row = el('div'); row.appendChild(el('span', null, x[0])); row.appendChild(el('b', null, x[1])); t.appendChild(row);
    });
    head.appendChild(t);
    head.appendChild(el('p', 'help', '「数えた時刻」は勤怠として数える時刻です（早出・残業は事務所が認めた分だけ数えます）。違っていたら「申請」から直しを出してください。'));
    rows.forEach(function (r) {
      var c = el('div', 'day'), top = el('div', 'd');
      c.setAttribute('data-date', r.date); c.tabIndex = -1;   /* 確かめが要る日の帯から送る先（画面の中だけの印） */
      top.appendChild(el('span', null, r.label)); top.appendChild(el('span', 'w', r.work ? '実働 ' + r.work : ''));
      c.appendChild(top);
      var dl = el('dl');
      [['予定', r.sched || 'なし'], ['打刻', r.punches || 'なし'], ['数えた時刻', r.counted || '—']].forEach(function (x) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, x[1])); });
      c.appendChild(dl);
      r.absences.forEach(function (x) { c.appendChild(el('span', 'tag', x)); });   /* 休暇の種類の印（管理画面と同じ言い方） */
      if (!r.future) r.flags.forEach(function (f) { c.appendChild(el('span', 'flag', f)); });
      list.appendChild(c);
    });
  }
  $('b-cur').addEventListener('click', function () { if (curYm) loadDays(curYm); });
  $('b-prev').addEventListener('click', function () { if (curYm) loadDays(S.prevYm(curYm)); });

  // ── 有給 ──
  /* 日数の文字（半日きざみは「9.5 日」・時間単位の端数は「9 日 6 時間」・管理画面の dTxt と同じ L.daysHm） */
  function dTxt(n) { return L.daysHm ? L.daysHm(n, S.dayMinOfLeave(leaveData, C, L)) : n + ' 日'; }
  async function getLeave(my) {
    if (leaveData) return leaveData;
    var r = await call('leave', { key: key, open: open });
    if (my !== gen) return null;
    if (r.ok !== true) { if (!handleAuth(r)) msg('app-msg', S.errorText(r.error), 'ng'); return null; }
    leaveData = r;
    return r;
  }
  async function loadLeave() {
    var my = gen, box = $('leave-box');
    if (!leaveData) {
      clear(box); box.appendChild(el('p', 'muted', '有給の記録を読んでいます…'));
      if (!(await getLeave(my))) { if (my === gen) clear(box); return; }
    }
    var v;
    try { v = S.leaveView(S.leaveOf(leaveData, C, L, S.todayOf(Date.now()))); } catch (e) { v = null; }
    clear(box);
    if (!v) { box.appendChild(el('p', 'msg ng', '有給を数えられませんでした。ページを読み込み直してください。')); return; }
    box.appendChild(el('h2', null, '有給の残り'));
    box.appendChild(el('p', 'big', dTxt(v.remain)));
    /* 時間単位の有休を使う施設で、受け口がまだ休暇の行（absences）を返さない間だけ（反証レビュー 2026-11-21・v6 で返す後は残りから引いてあるので出さない） */
    if (S.hourlyNoteOn(leaveData)) box.appendChild(el('p', 'help', S.HOURLY_NOTE));   /* 説明は箱なしの注記（黄で残すのは期限が近くて消える残りだけ・2026-11-27） */
    if (v.soon) box.appendChild(el('p', 'msg warn', 'いちばん早く消える残り: ' + v.soon.days + ' 日（' + v.soon.expires + ' まで）'));
    if (v.ob5) box.appendChild(el('p', v.ob5Warn ? 'help em' : 'muted', v.ob5));
    if (v.lots.length) {
      box.appendChild(el('h2', 'sh', '付与ごとの残りと期限'));
      var ul = el('ul', 'rows');
      /* 1行目に付与日（左）と残り（右）、2行目に期限（日付は折らない・2026-11-27） */
      v.lots.forEach(function (l) { var li = el('li', 'lot'); li.appendChild(el('span', 'lot-g', l.granted + ' の付与（' + l.days + ' 日）')); li.appendChild(el('b', 'lot-r', '残り ' + dTxt(l.remain))); var e = el('span', 'lot-e', '期限 '); e.appendChild(el('span', 'nw', l.expires)); e.appendChild(document.createTextNode(' まで')); li.appendChild(e); ul.appendChild(li); });
      box.appendChild(ul);
    }
    if (v.next) box.appendChild(el('p', 'muted', '次の付与: ' + v.next.date + '（' + v.next.days + ' 日）'));
    if (v.hireUnknown) box.appendChild(el('p', 'help', '入職日が分からないため、自動の付与を数えていません。事務所に確かめてください。'));
    box.appendChild(el('p', 'help', '数え方は事務所の勤怠の画面と同じです。違っていると思う時は事務所に伝えてください。'));
  }

  // ── 申請 ──
  function kindChanged() {
    var k = $('rq-kind').value;
    $('g-date').hidden = k === 'month'; $('g-punch').hidden = k !== 'punch'; $('g-ot').hidden = k !== 'overtime';
    $('g-ym').hidden = k !== 'month'; $('g-reason').hidden = k === 'month';
    $('g-lvtype').hidden = k !== 'leave'; $('g-leave').hidden = k !== 'leave';
    $('rq-date-l').textContent = k === 'leave' ? '休む日' : '勤務の日';
    $('rq-reason-l').textContent = k === 'leave' ? '理由（任意・194字まで）' : '理由（194字まで）';   /* 休暇の理由は無くてよい */
    if (k === 'leave') leaveTypeChanged();
  }
  $('rq-kind').addEventListener('change', kindChanged);
  /* v6: 休暇の種類ごとに出す欄（時間＝時間単位・特別休暇の種類＝特別休暇・半日＝特別休暇と代休・結ぶ日＝代休と振替） */
  function leaveTypeChanged() {
    var t = $('rq-lt').value;
    $('g-lv-hours').hidden = t !== 'hourly'; $('g-lv-code').hidden = t !== 'special';
    $('g-lv-half').hidden = !(t === 'special' || t === 'comp'); $('g-lv-link').hidden = !(t === 'comp' || t === 'swap');
    $('rq-ll-l').textContent = t === 'swap' ? '入れ替えて働く日' : '休日に働いた日';
  }
  $('rq-lt').addEventListener('change', leaveTypeChanged);
  function lvCfg() { return S.leaveCfgOf(leaveData); }
  function lvTypes() { try { return C.leaveTypesOf(lvCfg()); } catch (e) { return []; } }
  function hourlyOn() { return !!leaveData && lvCfg().hourlyPaidLeave === true; }
  function fillSel(sel, opts) {
    var cur = sel.value; clear(sel);
    opts.forEach(function (o) { var x = el('option', null, o[1]); x.value = o[0]; sel.appendChild(x); });
    if (opts.some(function (o) { return o[0] === cur; })) sel.value = cur;
  }
  /* 休暇の欄の選び肢（設定で決まる）と有休の残り。有給の記録が読めない時は時間単位を出さず、特別休暇は既定の種類 */
  function fillLeave() {
    fillSel($('rq-lt'), S.leaveTypeOptions(hourlyOn()));
    var hmax = Math.max(1, Math.round(S.dayMinOfLeave(leaveData, C, L) / 60) - 1), hs = [];
    for (var h = 1; h <= hmax; h++) hs.push([String(h), h + ' 時間']);
    fillSel($('rq-lh'), hs);
    fillSel($('rq-lc'), lvTypes().map(function (x) { return [x.code, x.name + (x.paid ? '' : '（無給）')]; }));
    var v = null;
    if (leaveData) { try { v = S.leaveView(S.leaveOf(leaveData, C, L, S.todayOf(Date.now()))); } catch (e) { v = null; } }
    $('rq-lv-remain').textContent = v ? '有休の残り: ' + dTxt(v.remain) + '（承認待ちの申請の分は、まだ引いていません）' : '';
    leaveTypeChanged();
  }
  function fillYm() {
    var sel = $('rq-ym'); clear(sel);
    var cy = curYm || S.ymOf(S.todayOf(Date.now()));
    [cy, S.prevYm(cy)].forEach(function (y) { var o = el('option', null, S.ymJa(y)); o.value = y; sel.appendChild(o); });
  }
  async function loadReqs() {
    var my = gen;
    fillYm(); fillLeave(); kindChanged();
    if (!$('rq-date').value) $('rq-date').value = S.todayOf(Date.now());
    var r = await call('requests', { key: key, open: open });
    if (my !== gen) return;
    if (r.ok !== true) { if (!handleAuth(r)) msg('app-msg', S.errorText(r.error), 'ng'); return; }
    reqRows = Array.isArray(r.rows) ? r.rows : [];
    paintReqs();
    /* v6: 休暇の欄（時間単位・特別休暇の種類）と有休の残りは有給の記録で決める。まだ読んでいなければ一覧の後に読む */
    if (!leaveData && (await getLeave(my)) && my === gen) { fillLeave(); paintReqs(); }
  }
  function paintReqs() {
    var list = $('req-list'); clear(list);
    if (!reqRows || !reqRows.length) { list.appendChild(el('p', 'muted', 'まだ申請はありません。')); return; }
    reqRows.forEach(function (raw) {
      var r = S.requestRow(raw, lvTypes()), c = el('div', 'day'), top = el('div', 'd');
      top.appendChild(el('span', null, r.kind + '　' + r.when)); top.appendChild(el('span', 'pill st-' + r.statusKey, r.status));
      c.appendChild(top);
      if (r.what) c.appendChild(el('p', null, r.what));
      if (r.reason) c.appendChild(el('p', 'muted', '理由: ' + r.reason));
      if (r.note) c.appendChild(el('p', r.statusKey === 'rejected' ? 'msg ng' : 'muted', (r.statusKey === 'rejected' ? '差し戻しの理由: ' : '事務所から: ') + r.note));
      if (r.canWithdraw) {
        var b = el('button', 'btn sm', '取り下げる'); b.type = 'button';
        b.addEventListener('click', function () { withdraw(r.id, r.rev, b); });
        var a = el('div', 'acts'); a.appendChild(b); c.appendChild(a);
      }
      list.appendChild(c);
    });
  }
  async function withdraw(id, rev, btn) {
    if (!window.confirm('この申請を取り下げますか？')) return;
    btn.disabled = true;
    var my = gen, r = await call('withdraw', { key: key, open: open, id: id, rev: rev });
    if (my !== gen) return;
    if (r.ok !== true && handleAuth(r)) return;
    msg('rq-msg', r.ok === true ? '取り下げました。' : S.errorText(r.error), r.ok === true ? 'ok' : 'ng');
    loadReqs();
  }
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 古い端末は下で作る */ }
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  $('f-req').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (busy) return;
    var b = S.buildRequest({ kind: $('rq-kind').value, date: $('rq-date').value, punchKind: $('rq-pk').value, time: $('rq-time').value, nextDay: $('rq-next').checked,
      earlyFrom: $('rq-ef').value, otUntil: $('rq-ou').value, otNextDay: $('rq-ou-next').checked, ym: $('rq-ym').value, reason: $('rq-reason').value,
      leaveType: $('rq-lt').value, half: $('rq-lhalf').checked, hours: $('rq-lh').value, typeCode: $('rq-lc').value, linkDate: $('rq-ll').value, hourlyOn: hourlyOn(), types: lvTypes() });
    if (!b.ok) { msg('rq-msg', b.msg, 'ng'); return; }
    var j = JSON.stringify(b.req);
    if (!lastReq || lastReq.json !== j) lastReq = { json: j, cid: newId() };
    busy = true; $('b-req').disabled = true; msg('rq-msg', '送っています…', 'warn');
    var my = gen, q = b.req;
    var r = await call('request_add', { key: key, open: open, kind: q.kind, work_date: q.work_date, ym: q.ym, body: q.body, reason: q.reason, client_id: lastReq.cid });
    busy = false; $('b-req').disabled = false;
    if (my !== gen) return;
    if (r.ok !== true) {
      if (handleAuth(r)) return;
      msg('rq-msg', S.errorText(r.error, q.kind === 'leave' ? 'leave' : 'request', q.body && q.body.type), 'ng');
      if (r.error !== 'net' && r.error !== 'server') lastReq = null;
      return;
    }
    lastReq = null;
    $('rq-reason').value = ''; $('rq-time').value = ''; $('rq-ef').value = ''; $('rq-ou').value = ''; $('rq-next').checked = false; $('rq-ou-next').checked = false;
    $('rq-lhalf').checked = false; $('rq-ll').value = '';
    msg('rq-msg', q.kind === 'month' ? '確かめたことを伝えました。' : '申請しました。事務所が承認するまで「承認待ち」と出ます。', 'ok');
    loadReqs();
  });

  // ── v6: 事務所からの打刻漏れの知らせ（統合 0125）──
  /* 開いた時に1回だけ読む（読むと事務所に「見た」が付く）。読めない時（古い受け口＝format など）は帯を出さないだけ（勤怠・申請は今のまま使える）。
     その日の打刻は月の答えを数えた結果で見る（出勤と退勤がそろった・まだ出勤していないの知らせは出勤があれば出さない） */
  async function loadNotices() {
    var my = gen;
    var r = await call('notices', { key: key, open: open });
    if (my !== gen) return;
    if (r.ok !== true) { handleAuth(r); return; }
    var rows = S.noticeRows(r.rows);
    if (!rows.length) { notices = []; paintNotices([]); return; }
    var today = S.todayOf(Date.now()), out = [];
    if (!(await ensureCur(my, today))) return;
    for (var i = 0; i < rows.length; i++) {
      var n = rows[i], ymx = curYm, d = months[curYm];
      /* 今月分の期間より前の日は前の月分を読む（知らせは14日以内なので2つの月分で足りる） */
      if (d && d.period && S.isDate(d.period.from) && n.work_date < d.period.from) { ymx = S.prevYm(curYm); d = await getMonth(ymx, my); if (my !== gen) return; }
      var pu = null;
      if (d) { try { pu = S.punchesOn(S.computeOf(d, ymx, C, Date.now()), n.work_date); } catch (e) { pu = null; } }
      var tx = S.noticeText(n, pu);
      if (tx) out.push({ n: n, text: tx, pk: n.kind === 'missing' && pu && pu.hasIn && !pu.hasOut ? 'out' : 'in' });
    }
    notices = out;
    paintNotices(out);
  }
  function paintNotices(list) {
    var box = $('nt-box'); clear(box);
    box.hidden = !list.length;
    if (!list.length) return;
    box.appendChild(el('h2', null, '事務所からの知らせ'));
    list.forEach(function (x) {
      box.appendChild(el('p', 'nt', x.text));
      var b = el('button', 'btn sm', '打刻の直しを出す（' + S.dayLabel(x.n.work_date) + '）'); b.type = 'button';
      b.addEventListener('click', function () { openPunchFix(x.n.work_date, x.pk); });
      var a = el('div', 'acts'); a.appendChild(b); box.appendChild(a);
    });
  }
  /* 帯から: 申請のタブを開き、打刻の直しをその日付で出せる形にする */
  function openPunchFix(date, pk) {
    if (!open) return;
    setTab('req');
    $('rq-kind').value = 'punch'; kindChanged();
    $('rq-date').value = date; $('rq-pk').value = pk === 'out' ? 'out' : 'in';
    msg('rq-msg', '');
    try { $('f-req').scrollIntoView({ block: 'start' }); } catch (e) { /* 古い端末はそのまま */ }
    try { $('rq-time').focus(); } catch (e) { /* 何もしない */ }
  }

  // ── 始め ──
  if (code) showEnroll();       // 番号を持って開いた時は登録の画面（前の鍵は、登録できた時に外す）
  else if (key) { show('pin'); $('in-pin').focus(); }
  else showEnroll();
})();
