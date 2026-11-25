/* kintai-clock.js — タブレットの出勤・退勤の打刻（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1）
 * ════════════════════════════════════════════════════════════════
 * ・番号（4〜6桁）を入れる → 名前と「出勤」「退勤」→ 押すと4秒だけ結果を出して最初へ（押せばすぐ次へ）。30秒触らなければ最初へ
 * ・v2（2026-11-19・ROOT-v2-polish.md の D）: 最後の打刻が今日でない時は日付つきで出す／強調と逆（出勤中に出勤・
 *   退勤済みに退勤）は画面の中で1回だけ確かめる／完了は枠全体を色で塗り短い音を鳴らす／画面を消さない（Wake Lock）／
 *   番号の止め（busy）の時も控える／「消す」は画面に出した控えだけ／暗い表示。今日の予定は lookup が返さないので出さない
 * ・v3（2026-11-19・ROOT-v3-clock-flow.md）: 最初の画面（待受）は特大の「出勤」「退勤」→ 氏名を選ぶ → パスコード（＝打刻の番号）→ 完了。
 *   照合は kintai_clock_check（選んだ人と番号が合うか）。合えば v2 と同じ逆押しの確かめ・送信・控え・完了画面を通る。
 *   名簿（kintai_clock_roster）が読めない時は、待受のボタンから v2 の番号の流れ（番号→名前→出勤/退勤）へ。番号の流れはそのまま残す
 * ・時刻はデータベースの時計（端末の時計を信じない）。通信できない時は端末に控え、つながったら端末の時刻の印つきで送る
 * ・端末に残すのは「番号・出勤か退勤か・控えの番号・端末の時刻」だけ（名前・名簿は残さない＝CLAUDE.md §2-5）。
 *   ほかに残すのは、氏名の画面で選んだ事業所（UI の状態・kintai_clock_office）だけ。名簿・選んだ人・パスコードはメモリだけ
 * ・現場の端末でも開く（打刻のための画面）。ログインの役割は su-app-gate.js で確かめる（APPS の kintai-clock）
 * ・データベースが現場に許すのは kintai_clock_lookup（番号→名前）・kintai_clock_roster（名簿）・kintai_clock_check（氏名と番号の照合）・
 *   kintai_clock_punch（打刻）の4つだけ
 */
(function () {
  'use strict';
  var Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed', O_KEY = 'kintai_clock_office';
  var IDLE_MS = 30000, DONE_MS = 4000, FLUSH_MS = 30000, MAX_LEN = 6, TAP_GUARD_MS = 400;
  var SHIFT_MS = 16 * 3600000;   /* 出勤からこの時間までは勤務中とみなす（夜勤明けの退勤。超えたら退勤の押し忘れとして扱う） */
  var ROSTER_MS = 5 * 60000, ROSTER_STALE_MS = 60000, PASS_TRIES = 3, ROSTER_TIMEOUT_MS = 12000;   /* 名簿の読み込みも打ち切る（返事が来ないまま番号の流れにも入れない、を防ぐ） */
  var gen = 0, view = 'boot', code = '', who = null, idleT = null, doneT = null, flushing = false, busyPunch = false;
  var doneAt = 0, askAt = 0, shownFail = [];
  /* v3: 名前の流れの状態（すべてメモリだけ）。pick＝選んだ種類と人、paintAt＝画面が入れ替わった時刻（直後の重ね押しを無視する） */
  var roster = null, rosterTry = 0, rosterP = null, pickKind = null, pickSt = null, passFails = 0, paintAt = 0;
  var OFFICES = [['all', '全部'], ['facility', '施設'], ['visit', '訪問介護'], ['day', '通所介護']];
  var office = 'all';
  var $ = function (id) { return document.getElementById(id); };

  function note(where, e) { try { if (window.SUErrors && window.SUErrors.note) window.SUErrors.note('出勤・退勤の打刻', e, 'clock:' + where); } catch (_) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(t) { try { $('k-sr').textContent = t; } catch (_) {} }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hm(ms) { return KintaiCalc.jstHM(ms); }
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  /* 日本時間の日付の差（0＝今日・1＝きのう）と、その日付の言い方 */
  function jstDayNo(ms) { return Math.floor((ms + 9 * 3600000) / 86400000); }
  function dayWord(ms) {
    var n = jstDayNo(Date.now()) - jstDayNo(ms);
    if (n === 0) return 'きょう';
    if (n === 1) return 'きのう';
    var d = new Date(ms + 9 * 3600000);
    return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
  }

  /* ── 完了の音（Web Audio・外部ファイルなし・鳴らなくても何もしない）。
     iPad は押した瞬間に作らないと鳴らないため、出勤・退勤を押した時に armAudio で用意し、結果を出す時に鳴らす ── */
  var actx = null;
  function armAudio() {
    try {
      var A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      if (!actx) actx = new A();
      if (actx.state !== 'running') {   /* iPad は中断の後 'interrupted' になる */
        var r = actx.resume(); if (r && r['catch']) r['catch'](function () {}); }
    } catch (_) { actx = null; }
  }
  function chime(kind) {
    try {
      if (!actx || actx.state !== 'running') return;
      var f = kind === 'in' ? [660, 880] : [660, 440], t0 = actx.currentTime + 0.02;   /* 出勤＝上がる2音・退勤＝下がる2音 */
      f.forEach(function (hz, i) {
        var o = actx.createOscillator(), g = actx.createGain(), s = t0 + i * 0.16;
        o.type = 'sine'; o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.25, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.14);
        o.connect(g); g.connect(actx.destination); o.start(s); o.stop(s + 0.15);
      });
    } catch (_) {}
  }

  /* ── 画面を消さない（Wake Lock API・使えない端末では何もしない・画面が戻ったら取り直す） ── */
  var wake = null;
  function keepAwake() {
    try {
      if (wake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(function (l) {
        wake = l;
        try { l.addEventListener('release', function () { wake = null; }); } catch (_) {}
      }, function () {});
    } catch (_) {}
  }

  function deviceKey() { try { var k = localStorage.getItem('su_device_key'); return /^[0-9a-f]{8,64}$/.test(k || '') ? k : null; } catch (_) { return null; } }

  /* ── 端末の控え（読み書きの失敗でも画面は動かす・壊れた控えは捨てずに読み飛ばす） ── */
  function readList(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter(okItem) : []; } catch (_) { return []; }
  }
  function okItem(x) { return x && KintaiCalc.isCode(x.code) && (x.kind === 'in' || x.kind === 'out') && typeof x.id === 'string' && typeof x.at === 'number' && (x.sid == null || isSid(x.sid)); }
  function isSid(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v); }
  function writeList(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); return true; } catch (e) { note('控えの保存', e); return false; } }
  function enqueue(item) {
    var q = readList(Q_KEY); q.push(item);
    return writeList(Q_KEY, q);
  }
  /* 氏名の画面で選んだ事業所（UI の状態だけ・読み戻しは決まった4つのどれかの時だけ。ほかは「全部」） */
  function isOffice(v) { return OFFICES.some(function (o) { return o[0] === v; }); }
  function readOffice() { try { var v = localStorage.getItem(O_KEY); return isOffice(v) ? v : 'all'; } catch (_) { return 'all'; } }
  function saveOffice(v) { if (!isOffice(v)) return; try { localStorage.setItem(O_KEY, v); } catch (_) {} }

  /* ── データベースの窓口 ── */
  /* 端末の印は見出し x-su-device でも送る（DB 0128: 番号の打ち間違いの上限を端末ごとに数える。印が無い・送れない時は今までどおり） */
  function rpc(name, args) {
    return Promise.resolve().then(function () {
      var q = window.SUAuth.client().rpc(name, args), k = deviceKey();
      if (k && q && typeof q.setHeader === 'function') q = q.setHeader('x-su-device', k);
      return q;
    }).then(function (r) {
      if (r && r.error) throw r.error;
      return r ? r.data : null;
    });
  }
  /* 打刻の送信の打ち切り（電波の弱い所でタブレットが「記録しています…」のまま止まらないように・審査の指摘1）。
     打ち切ったら通信の失敗と同じく控える（client_id があるので、遅れて届いても二重にはならない） */
  var PUNCH_TIMEOUT_MS = 12000;
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, ng) { setTimeout(function () { ng(new Error('timeout')); }, ms); })]);
  }
  function isNet(e) {
    var m = String((e && e.message) || e || '');
    return !navigator.onLine || /failed to fetch|network|load failed|timeout|fetch/i.test(m);
  }
  function friendly(e) {
    var c = e && e.code;
    if (c === '42501') return 'このアカウントでは打刻できません。事務所に知らせてください。';
    if (c === 'PGRST202' || c === '42P01' || c === 'PGRST205') return '共通のデータベースに打刻の仕組みがまだありません。事務所に知らせてください。';
    return 'うまくいきませんでした。もう一度押してください。';
  }

  /* ── 時計（端末の時計・表示だけ） ── */
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function tick() {
    var now = Date.now(), d = new Date(now + 9 * 3600000);
    $('k-date').textContent = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日（' + WD[d.getUTCDay()] + '）';
    $('k-time').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }

  /* ── 画面 ── */
  /* 30秒触らなければ待受へ（待受そのものでは何もしない） */
  function armIdle() { clearTimeout(idleT); if (view !== 'home') idleT = setTimeout(reset, IDLE_MS); }
  function reset() {
    if (view === 'sending') return;   /* 送信中は戻さない（打刻を落とさない・反証レビュー指摘1） */
    gen++; clearTimeout(doneT); clearTimeout(idleT); code = ''; who = null; busyPunch = false; pickKind = null; pickSt = null; passFails = 0;
    paintHome('');
    if (Date.now() - rosterTry >= ROSTER_STALE_MS) loadRoster();   /* 待受へ戻った時、最後に読みに行ってから1分以上なら名簿を読み直す */
  }
  /* 知らせを出して待受へ（パスコード違い3回・止め・名前の流れで送れなかった時） */
  function homeWith(m) { reset(); if (view === 'home') paintHome(m); }
  /* 番号の流れの最初（番号のテンキー）へ。待受の「番号で打刻」・名簿が読めない時・「番号を入れ直す」 */
  function toCode(msg) {
    if (view === 'sending') return;
    gen++; clearTimeout(doneT); clearTimeout(idleT); code = ''; who = null; busyPunch = false; pickKind = null; pickSt = null; passFails = 0;
    paintCode(msg);
  }
  /* 枠の塗り（完了の時だけ出勤＝緑・退勤＝橙などで枠全体を塗る）。待受・氏名は幅を広く使う */
  function panelTone(t) { $('k-panel').className = 'panel' + (t ? ' tone-' + t : '') + (view === 'home' ? ' wide bare' : view === 'pick' ? ' wide' : view === 'pass' || view === 'code' ? ' pad' : ''); }
  /* 画面の種類を main の印にする（氏名の画面では時計を隠し、パスコードの画面では時計を小さくする） */
  function mark() { if ($('k-main').getAttribute('data-v') !== view) paintAt = Date.now(); $('k-main').setAttribute('data-v', view); paintKinds(); }
  /* v3.1: 出勤（青・左）・退勤（赤・右）のボタン。待受は同じ大きさ、氏名・パスコードの間は押した方を大きく（押された印）、
     もう片方は小さく残す。番号の流れ・確かめ・送信・完了の間は隠す。中身は HTML に固定（クラスと aria-pressed だけ替える） */
  function paintKinds() {
    var box = $('k-kinds'); if (!box) return;
    var sel = !!pickKind && (view === 'pick' || view === 'pass' || view === 'wait');
    box.hidden = !(view === 'home' || sel);
    box.classList.toggle('sel', sel);
    $('k-main').classList.toggle('sel', sel);   /* 氏名・パスコードの間は上の時計の帯と出勤/退勤を低くする（Safari の見える高さに氏名を収める） */
    var busy = busyView();
    ['in', 'out'].forEach(function (k) {
      var b = box.querySelector('[data-g="' + k + '"]'), on = sel && pickKind === k;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = busy; b.setAttribute('aria-disabled', busy ? 'true' : 'false');   /* 照合中・送信中は押せない見た目に（審査の指摘3） */
    });
    var fb = document.querySelector('#k-foot [data-k="failed"]');
    if (fb) { fb.disabled = busy; fb.setAttribute('aria-disabled', busy ? 'true' : 'false'); }   /* 送れなかった打刻の入口も同じ（指摘4） */
  }
  /* 照合中（wait）・送信中（sending）は、出勤/退勤と「送れなかった打刻」を押せなくする */
  function busyView() { return view === 'wait' || view === 'sending'; }
  /* 氏名・パスコードの間に出勤/退勤を押した時: 同じ方なら待受へ、もう片方なら切り替える（選んだ人と入れかけた番号はそのまま） */
  function switchKind(g) {
    if (g === pickKind) { reset(); return; }
    pickKind = g; paintKinds();
    if (view === 'pick') paintPick(); else if (view === 'pass') paintPass();
  }
  /* 画面が入れ替わった直後の重ね押し（待受→氏名→パスコードは同じ位置にボタンが来る）を無視する */
  function tooSoon() { return Date.now() - paintAt < TAP_GUARD_MS; }

  /* ── v3: 待受（特大の「出勤」「退勤」） ── */
  function paintHome(msg) {
    view = 'home'; mark();
    var p = $('k-panel'); p.hidden = false; panelTone('');
    p.innerHTML = (msg ? '<p class="msg warn" role="alert">' + esc(msg) + '</p>' : '') +
      '<button type="button" class="h-code" data-k="bycode">名前が出ない時は 番号で打刻</button>';
    if (msg) say(msg);
    paintFoot();
    armIdle();
    if (msg) idleT = setTimeout(reset, IDLE_MS);   /* 知らせは30秒で消す（次の人に前の人の知らせを見せ続けない） */
  }
  /* 待受の「出勤」「退勤」→ 名簿が使えれば氏名の画面、まだ読んでいる途中なら読み終わるまで待つ、読めなければ番号の流れへ */
  function startPick(kind) {
    if (kind !== 'in' && kind !== 'out') return;
    if (roster && roster.length) { pickKind = kind; passFails = 0; paintPick(); return; }
    if (rosterP) {
      var my = ++gen;
      pickKind = kind; view = 'wait'; mark(); panelTone('');
      $('k-panel').innerHTML = '<p class="lbl">名簿を読んでいます…</p>';
      armIdle();
      rosterP.then(function () { if (my === gen) startPick2(kind); });
      return;
    }
    startPick2(kind);
  }
  function startPick2(kind) {
    if (roster && roster.length) { pickKind = kind; passFails = 0; paintPick(); return; }
    var m = '名簿を読めません。番号で打刻してください。';
    toCode('<p class="msg warn" role="alert">' + esc(m) + '</p>'); say(m);
  }

  /* ── v3: 名簿（画面を開いた時・5分ごと・待受へ戻った時に読む。読めない時は前に読めた名簿をそのまま使う） ── */
  function loadRoster() {
    if (rosterP) return rosterP;
    rosterTry = Date.now();
    rosterP = withTimeout(rpc('kintai_clock_roster', {}), ROSTER_TIMEOUT_MS).then(function (r) {
      if (!r || r.ok !== true || !Array.isArray(r.staff)) return;
      var list = r.staff.filter(function (s) { return s && typeof s.id === 'string' && s.id && typeof s.name === 'string' && s.name; })
        .map(function (s) { return { id: s.id, name: s.name, office: isOffice(s.office) && s.office !== 'all' ? s.office : null }; });
      list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
      roster = list;
    })['catch'](function (e) {
      /* 関数がまだ無い（0100 の前）・通信できない は、番号の流れで打刻できるので記録しない */
      var c = e && e.code;
      if (!isNet(e) && c !== 'PGRST202' && c !== '42883') note('名簿', e);
    }).then(function () { rosterP = null; });
    return rosterP;
  }

  /* ── v3: 氏名を選ぶ ── */
  function paintPick() {
    view = 'pick'; mark(); panelTone('');
    var label = pickKind === 'in' ? '出勤' : '退勤';
    var list = (roster || []).filter(function (s) { return office === 'all' || s.office === office; });
    $('k-panel').innerHTML = '<div class="pk-top"><p class="pk-q ' + (pickKind === 'in' ? 'q-in' : 'q-out') + '" id="k-pkq">' + esc(label + 'する人を選んでください') + '</p>' +
      '<button type="button" class="pk-no" data-k="home">やめる</button></div>' +
      '<div class="offs" role="group" aria-label="事業所">' + OFFICES.map(function (o) {
        return '<button type="button" class="off' + (o[0] === office ? ' on' : '') + '" data-o="' + o[0] + '" aria-pressed="' + (o[0] === office ? 'true' : 'false') + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      (list.length ? '<div class="names" role="group" aria-labelledby="k-pkq">' + list.map(function (s) {
        return '<button type="button" class="nm" data-sid="' + esc(s.id) + '">' + esc(s.name) + '</button>';
      }).join('') + '</div>' : '<p class="state">この事業所の人は名簿にいません。「全部」を押してください。</p>');
    say(label + 'する人を選んでください');
    armIdle();
  }
  function pickStaff(id) {
    var st = (roster || []).filter(function (s) { return s.id === id; })[0];
    if (!st) { paintPick(); return; }   /* 読み直しで名簿から消えた人は選べない（描き直す） */
    pickSt = st; code = ''; passFails = 0;
    paintPass();
  }

  /* ── v3: パスコード（＝打刻の番号。●で隠す） ── */
  function paintPass(msg) {
    view = 'pass'; mark(); panelTone('');
    var label = pickKind === 'in' ? '出勤' : '退勤';
    $('k-panel').innerHTML = '<p class="who"><span class="' + (pickKind === 'in' ? 'q-in' : 'q-out') + '">' + label + '</span> ' + esc(pickSt.name) + ' さん</p>' +
      '<p class="lbl" id="k-lbl">パスコードを入れてください</p>' + (msg || '') +
      '<div class="code' + (code ? '' : ' ph') + '" id="k-code" aria-labelledby="k-lbl">' + (code ? code.replace(/./g, '●') : '4〜6桁の番号') + '</div>' +
      '<div class="keys" role="group" aria-label="番号のボタン">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button type="button" class="k-clr" data-k="clr">消す</button><button type="button" data-k="0">0</button>' +
      '<button type="button" class="k-ok" data-k="ok"' + (KintaiCalc.isCode(code) ? '' : ' disabled') + '>決定</button></div>' +
      '<button type="button" class="back" data-k="home">やめる</button>';
    armIdle();
  }

  /* 照合: 選んだ人と番号が合えば、v2 と同じ形の who を作って、逆押しの確かめ → 送信 へ */
  function check() {
    var my = ++gen, c = code, kind = pickKind, st = pickSt;
    view = 'wait'; mark(); panelTone('');
    $('k-panel').innerHTML = '<p class="lbl">確かめています…</p>';
    /* 照合も打ち切る（返事が来ない時は通信の失敗として、下の catch で控える・審査の指摘2） */
    withTimeout(rpc('kintai_clock_check', { p_staff_id: st.id, p_code: c }), PUNCH_TIMEOUT_MS).then(function (r) {
      if (my !== gen) return;
      /* 止め（busy）の時は控えない（選んだ人と番号が合うか確かめられないため） */
      if (r && r.error === 'busy') { homeWith('パスコードの間違いが続いたため、少しの間 確かめを止めています。しばらくしてから、もう一度お願いします。'); return; }
      if (r && r.ok === true && r.staff && typeof r.staff.name === 'string') {
        who = whoOf(c, r.staff); who.flow = 'name';
        view = 'who';
        if (needAsk(kind)) paintAsk(kind); else punch(kind);
        return;
      }
      passFails++; code = '';
      if (passFails >= PASS_TRIES) { homeWith('パスコードが' + PASS_TRIES + '回違いました。もう一度、名前から選んでください。'); return; }
      var m = 'パスコードが違います。もう一度入れてください（あと ' + (PASS_TRIES - passFails) + ' 回）。';
      paintPass('<p class="msg ng" role="alert">' + esc(m) + '</p>'); say(m);
    })['catch'](function (e) {
      if (my !== gen) return;
      /* 通信できない時は番号の流れと同じく控える（照合は送る時にサーバーが番号で行う）。名前は選んだ名前を出すだけ */
      if (isNet(e)) { who = { code: c, name: null, label: st.name, sid: st.id, state: null, why: 'net', flow: 'name' }; view = 'who'; punch(kind); return; }
      note('氏名と番号の確かめ', e);
      homeWith(friendly(e));
    });
  }
  /* lookup・check の返り値（staff）から画面の状態を作る（v2 の lookup と同じ決め方） */
  function whoOf(c, s) {
    var lastMs = s.last_at ? Date.parse(s.last_at) : NaN;
    var w = { code: c, name: s.name, state: s.state, last: s.last_at,
      today: !isNaN(lastMs) && jstDayNo(lastMs) === jstDayNo(Date.now()) };
    /* 勤務中: 今日の出勤、または日付が変わっても出勤から16時間以内（夜勤明け） */
    w.onShift = w.state === 'in' && (w.today || Date.now() - lastMs <= SHIFT_MS);
    return w;
  }

  function paintCode(msg) {
    view = 'code'; mark();
    var p = $('k-panel'); p.hidden = false; panelTone('');
    p.innerHTML = '<p class="lbl" id="k-lbl">打刻の番号を入れてください</p>' + (msg || '') +
      '<div class="code' + (code ? '' : ' ph') + '" id="k-code" aria-labelledby="k-lbl">' + (code ? esc(code.replace(/./g, '●').slice(0, -1) + code.slice(-1)) : '4〜6桁の番号') + '</div>' +
      '<div class="keys" role="group" aria-label="番号のボタン">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button type="button" class="k-clr" data-k="clr">消す</button><button type="button" data-k="0">0</button>' +
      '<button type="button" class="k-ok" data-k="ok"' + (KintaiCalc.isCode(code) ? '' : ' disabled') + '>決定</button></div>' +
      '<button type="button" class="back" data-k="home">最初の画面へ戻る</button>';
    paintFoot();
    armIdle();
  }
  function press(k) {
    if (view !== 'code' && view !== 'pass') return;
    if (k === 'clr') code = code.slice(0, -1);
    else if (k === 'ok') { if (KintaiCalc.isCode(code)) { if (view === 'pass') { armAudio(); check(); } else lookup(); } return; }
    else if (/^[0-9]$/.test(k) && code.length < MAX_LEN) code += k;
    updCode();
  }
  /* 数字・消すを押した時は、●の欄と「決定」の押せる/押せないだけを書き換える（テンキーごと描き直すと、
     速い連打で押した瞬間にボタンが入れ替わり1回分が数えられない）。番号の流れは最後の1桁だけ見せ、パスコードは全部●で隠す */
  function updCode() {
    var box = $('k-code'), ok = $('k-panel').querySelector('.k-ok');
    if (!box || !ok) { if (view === 'pass') paintPass(); else paintCode(); return; }
    box.className = 'code' + (code ? '' : ' ph');
    box.textContent = code ? (view === 'pass' ? code.replace(/./g, '●') : code.replace(/./g, '●').slice(0, -1) + code.slice(-1)) : '4〜6桁の番号';
    ok.disabled = !KintaiCalc.isCode(code);
    armIdle();
  }

  function lookup() {
    var my = ++gen, c = code;
    view = 'wait'; mark();
    $('k-panel').innerHTML = '<p class="lbl">確かめています…</p>';
    rpc('kintai_clock_lookup', { p_code: c }).then(function (r) {
      if (my !== gen) return;
      /* 番号の止め（busy）の時も打刻は控えて、止めが解けたら送る（名前は出せない＝通信できない時と同じ画面） */
      if (r && r.error === 'busy') { who = { code: c, name: null, state: null, why: 'busy' }; paintWho(true); return; }
      if (!r || r.ok !== true) {
        var m = 'その番号は見つかりませんでした。番号を確かめて入れ直してください。';
        code = ''; paintCode('<p class="msg ng" role="alert">' + esc(m) + '</p>'); say(m); return;
      }
      who = whoOf(c, r.staff);
      paintWho(false);
    })['catch'](function (e) {
      if (my !== gen) return;
      if (isNet(e)) { who = { code: c, name: null, state: null, why: 'net' }; paintWho(true); return; }
      note('番号の確かめ', e);
      code = ''; paintCode('<p class="msg ng" role="alert">' + esc(friendly(e)) + '</p>');
    });
  }

  function paintWho(offline) {
    view = 'who'; mark();
    panelTone('');
    /* 強調: 勤務中（今日の出勤・出勤から16時間以内）なら退勤、それ以外（未打刻・退勤済み・16時間を超えた出勤）は出勤 */
    var sug = who.onShift ? 'out' : 'in';
    var lastT = who.last ? hm(Date.parse(who.last)) : '', stTxt = '', stCls = 'state';
    if (!offline && who.state) {
      if (who.today) stTxt = who.state === 'in' ? '出勤中です（' + lastT + ' に出勤）' : '退勤済みです（' + lastT + ' に退勤）';
      else if (who.onShift) stTxt = dayWord(Date.parse(who.last)) + ' ' + lastT + ' に出勤（いま勤務中）';   /* 夜勤明け: 注意の色にしない */
      else {
        stTxt = dayWord(Date.parse(who.last)) + ' ' + lastT + ' に' + (who.state === 'in' ? '出勤（退勤が押されていません）' : '退勤');
        if (who.state === 'in') stCls = 'state warn';
      }
    }
    var offMsg = who.why === 'busy'
      ? '番号の間違いが続いたため、少しの間 番号の確かめを止めています。番号 ' + who.code + ' の打刻を端末に控え、あとで自動で送ります。'
      : '通信できません。番号 ' + who.code + ' で打刻を端末に控え、つながったら送ります。';
    $('k-panel').innerHTML =
      (offline ? '<p class="msg warn" role="alert">' + esc(offMsg) + '</p>' :
        '<p class="who">' + esc(who.name) + ' さん</p><p class="' + stCls + '">' + esc(stTxt || 'どちらかを押してください') + '</p>') +
      '<div class="acts"><button type="button" class="b-in' + (sug === 'in' ? ' sug' : '') + '" data-p="in">出勤</button>' +
      '<button type="button" class="b-out' + (sug === 'out' ? ' sug' : '') + '" data-p="out">退勤</button></div>' +
      '<button type="button" class="back" data-k="back">番号を入れ直す</button>';
    say(offline ? (who.why === 'busy' ? '少しの間 番号の確かめを止めています。' : '通信できません。') + '出勤か退勤を押すと控えます' : who.name + 'さん。' + (stTxt ? stTxt + '。' : '') + '出勤か退勤を押してください');
    armIdle();
    try { $('k-panel').querySelector(sug === 'in' ? '.b-in' : '.b-out').focus(); } catch (_) {}
  }

  /* 強調と逆を押した時（勤務中に出勤／今日すでに退勤済みに退勤）は、画面の中で1回だけ確かめる。
     16時間を超えた出勤のあと・前の日の退勤のあと・名前が出ていない時（通信なし・busy）は確かめない */
  function needAsk(kind) { return !!(who && who.name && who.state === kind && (kind === 'in' ? who.onShift : who.today)); }
  function paintAsk(kind) {
    view = 'confirm'; mark(); panelTone('');
    var label = kind === 'in' ? '出勤' : '退勤', lastT = (who.today ? '' : dayWord(Date.parse(who.last)) + ' ') + hm(Date.parse(who.last));
    var q = 'もう' + label + 'しています（' + lastT + ' に' + label + '）。もう一度' + label + 'を記録しますか？';
    $('k-panel').innerHTML = '<p class="who">' + esc(who.name) + ' さん</p><p class="msg warn ask" role="alert">' + esc(q) + '</p>' +
      '<div class="acts"><button type="button" class="' + (kind === 'in' ? 'b-in' : 'b-out') + '" data-p="' + kind + '" data-sure="1">はい</button>' +
      '<button type="button" class="b-no" data-k="no">やめる</button></div>';
    say(q);
    askAt = Date.now();
    armIdle();
    try { $('k-panel').querySelector('.b-no').focus(); } catch (_) {}
  }

  function punch(kind, sure) {
    if (kind !== 'in' && kind !== 'out') return; // 種類は出勤・退勤だけ（画面に書く値を決まった2つに限る）
    if ((view !== 'who' && view !== 'confirm') || busyPunch || !who) return;
    if (!sure && needAsk(kind)) { paintAsk(kind); return; }
    busyPunch = true;
    var my = ++gen, item = { code: who.code, kind: kind, id: uuid(), at: Date.now() }, name = who.name, why = who.why;
    /* 名前の流れで照合できなかった時だけ、選んだ人の staff_id を控えに足す（送る前にその人と番号が合うかを確かめるため・名前は控えに入れない・総点検 2026-11-20） */
    if (who.flow === 'name' && !who.name && isSid(who.sid)) item.sid = who.sid;
    var label = kind === 'in' ? '出勤' : '退勤', byName = who.flow === 'name', shown = who.label || who.name;
    /* 送れなかった時の戻り先: 名前の流れは待受へ（知らせを出す）、番号の流れは v2 と同じく番号の画面へ */
    var back = function (m) { busyPunch = false; code = ''; if (byName) homeWith(m); else paintCode('<p class="msg ng" role="alert">' + esc(m) + '</p>'); };
    var save = function (because) {
      var okQ = enqueue(item);   /* 控えは画面の世代に関わらず必ず書く（client_id で二重にはならない） */
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      if (!okQ) { showDone({ tone: 'ng', big: '控えられませんでした', sub: 'この端末に控えを残せませんでした。事務所に知らせてください。' }); return; }
      /* 名前の流れで照合ができなかった時（名前は確かめていない）: 名前を確定のように出さず、小さく「選んだ名前」と添えるだけ（審査の指摘1）。
         控えには選んだ人の staff_id（sid）を足し、送る時はまずその人と番号が合うかを確かめてから送る（合わなければ送らずに「送れなかった打刻」へ・総点検 2026-11-20） */
      if (byName && !name) {
        showDone({ tone: 'save', kind: kind, big: label + 'を控えました（端末の時刻 ' + hm(item.at) + '）',
          sub: '名前とパスコードは、通信が戻ってから確かめます。合わない時は記録されないので、事務所へ伝えてください。', small: shown ? '選んだ名前: ' + shown : '' });
        return;
      }
      /* 名前の流れはパスコードを画面に出さない（●で隠して入れたため）。照合が合った後に送れなかった時は、確かめた名前を出す */
      showDone({ tone: 'save', kind: kind, name: byName && shown ? shown + ' さん' : '', big: label + 'を控えました', time: hm(item.at), sub: (byName ? '' : '番号 ' + item.code + '・') + '端末の時刻。' + ((because || why) === 'busy' ? '止めが解けたら自動で送ります。' : 'つながったら自動で送ります。') });
    };
    if (!name) { save(); return; }
    view = 'sending'; mark(); clearTimeout(idleT);
    $('k-panel').innerHTML = '<p class="lbl">記録しています…</p>';
    withTimeout(rpc('kintai_clock_punch', { p_code: item.code, p_kind: kind, p_client_id: item.id, p_client_at: new Date(item.at).toISOString(), p_offline: false, p_device: deviceKey() }), PUNCH_TIMEOUT_MS).then(function (r) {
      if (r && r.error === 'busy') { save('busy'); return; }   /* 番号の止めの間も控えて後で送る（D-5） */
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      if (r && r.ok === true) {
        showDone({ tone: kind, kind: kind, name: (r.name || name) + ' さん', big: label, time: hm(Date.parse(r.at)),
          sub: r.dup ? '少し前に同じ打刻があったので、その時刻のままにしました。' : (kind === 'in' ? 'おはようございます。今日もよろしくお願いします。' : 'おつかれさまでした。') });
        return;
      }
      back(r && r.error === 'notfound' ? 'その番号は見つかりませんでした。' : 'うまくいきませんでした。もう一度押してください。');
    })['catch'](function (e) {
      if (isNet(e)) { save(); return; }
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      note('打刻', e);
      back(friendly(e));
    });
  }

  /* 完了: 枠全体を塗り、名前・種類・時刻を特大で出す。4秒で最初へ（押せばすぐ次へ）。残りの秒は細い帯で見せる */
  function showDone(o) {
    view = 'done'; mark();
    clearTimeout(idleT); clearTimeout(doneT);
    panelTone(o.tone);
    $('k-panel').innerHTML = '<div class="done" role="alert">' +
      (o.name ? '<p class="d-name">' + esc(o.name) + '</p>' : '') +
      '<p class="d-kind">' + esc(o.big) + '</p>' + (o.time ? '<p class="d-time">' + esc(o.time) + '</p>' : '') +
      '<p class="d-sub">' + esc(o.sub) + '</p>' + (o.small ? '<p class="d-small">' + esc(o.small) + '</p>' : '') + '<p class="d-tap">画面を押すと、すぐ次の人へ</p>' +
      '<div class="d-bar" aria-hidden="true"><i></i></div></div>';
    say([o.name, o.big, o.time, o.sub, o.small].filter(Boolean).join('。'));
    if (o.tone === 'in' || o.tone === 'out') { chime(o.tone); loadRecent(); }   /* 打刻が終わったら履歴を読み直す */
    paintFoot();
    doneAt = Date.now();
    doneT = setTimeout(reset, DONE_MS);
  }

  /* ── v3.1: 今日の打刻（右の履歴）。開いた時・30秒ごと・打刻が終わった時に読む。メモリにも持たず画面に出すだけ。
     読めない時は「履歴を読めません」と出し、前に出した一覧は残す（打刻はできる） ── */
  var RECENT_MS = 30000, recentP = null;
  function loadRecent() {
    if (recentP) return recentP;
    recentP = withTimeout(rpc('kintai_clock_recent', {}), ROSTER_TIMEOUT_MS).then(function (r) {
      if (!r || r.ok !== true || !Array.isArray(r.items)) throw new Error('bad recent');
      paintRecent(r.items.filter(function (x) { return x && (x.kind === 'in' || x.kind === 'out') && typeof x.name === 'string' && !isNaN(Date.parse(x.at)); }).slice(0, 50));
    })['catch'](function (e) {
      var c = e && e.code;
      if (!isNet(e) && c !== 'PGRST202' && c !== '42883' && !(e && e.message === 'bad recent')) note('今日の打刻', e);
      $('k-hist-msg').className = 'h-msg ng'; $('k-hist-msg').textContent = '履歴を読めません（打刻はできます）'; $('k-hist-msg').hidden = false;
    }).then(function () { recentP = null; });
    return recentP;
  }
  function paintRecent(items) {
    $('k-hist-msg').className = 'h-msg'; $('k-hist-msg').textContent = items.length ? '' : 'まだ打刻はありません';
    $('k-hist-msg').hidden = items.length > 0;
    $('k-hist').innerHTML = items.map(function (x) {
      var k = x.kind === 'in' ? 'in' : 'out';
      var ms0 = Date.parse(x.at), d0 = new Date(ms0 + 9 * 3600000);
      var day = jstDayNo(ms0) === jstDayNo(Date.now()) ? '' : (d0.getUTCMonth() + 1) + '/' + d0.getUTCDate() + ' ';   /* 今日でない打刻は日付を添える（総点検 2026-11-20） */
      return '<li class="h-' + k + '"><span class="t">' + day + hm(ms0) + '</span><span class="k">' + (k === 'in' ? '出勤' : '退勤') + '</span><span class="n">' + esc(x.name) + '</span></li>';
    }).join('');
  }

  /* ── 控えの件数と、送れなかった控え ── */
  function paintFoot() {
    var q = readList(Q_KEY).length, f = readList(F_KEY).length, h = '';
    if (q) h += '<span class="chip" role="status">送信待ちの打刻 ' + q + ' 件（つながったら送ります）</span>';
    if (f) h += '<button type="button" class="chip ng" data-k="failed"' + (busyView() ? ' disabled aria-disabled="true"' : '') + '>送れなかった打刻 ' + f + ' 件（事務所へ）</button>';
    $('k-foot').innerHTML = h;
  }
  function paintFailed() {
    clearTimeout(doneT);
    view = 'failed'; mark();
    panelTone('');
    var f = readList(F_KEY);
    shownFail = f.map(function (x) { return x.id; });   /* 「消す」で消すのは、ここに出した控えだけ（出した後に増えた分は残す） */
    $('k-panel').innerHTML = '<p class="lbl">送れなかった打刻</p><p class="msg warn">事務所の管理画面で、この人（番号）・時刻の打刻を足してください。足したら「消す」を押します。</p>' +
      '<table class="qlist"><tbody>' + f.map(function (x) {
        var d = new Date(x.at + 9 * 3600000);
        /* 名前で選んだ控え（sid あり）は、●で隠して入れたパスコードを出さず、選んだ名前（名簿から引く・控えには名前を入れない）を出す */
        var st = x.sid ? (roster || []).filter(function (s) { return s.id === x.sid; })[0] : null;
        var who1 = x.sid ? (st ? '選んだ名前 ' + esc(st.name) : '名前で選んだ打刻（番号 ' + esc(x.code) + '）') : '番号 ' + esc(x.code);   /* 名簿に居ない人（休止など）は誰の分か分かるように番号を出す */
        return '<tr><td>' + who1 + '</td><td>' + (x.kind === 'in' ? '出勤' : '退勤') + '</td><td>' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + hm(x.at) + '</td><td>' + esc(x.why || '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<button type="button" class="back" data-k="clearfail">事務所へ伝えたので消す</button><button type="button" class="back" data-k="back">戻る</button>';
    armIdle();
  }

  /* 名前で選んだ控えの照合が打ち切られた回数（メモリだけ・控えの id ごと）。3回で、この画面を開いている間はその控えの照合をやめて送信待ちに残す
     （打ち切られてもサーバーは照合を終えて、合わない時は失敗を数えるため。共有のアカウントの止めに届かせない・反証レビュー 2026-11-20） */
  var chkTO = {};
  function flush() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    var q = readList(Q_KEY);
    if (!q.length) return Promise.resolve();
    flushing = true;
    var i = 0, sent = 0;
    var step = function () {
      if (i >= q.length) return null;
      var it = q[i];
      /* 名前の流れで照合できずに控えた打刻（sid あり）は、送る前に選んだ人と番号が合うかを確かめる。
         合わない時は送らない（番号だけで送ると、打ち間違いがほかの人の番号に当たった時にその人の打刻になるため・総点検 2026-11-20） */
      if (it.sid && (chkTO[it.id] || 0) >= 3) { i++; return step(); }   /* 照合が3回打ち切られた控えは、この画面では飛ばす（送信待ちには残す） */
      var pre = it.sid ? withTimeout(rpc('kintai_clock_check', { p_staff_id: it.sid, p_code: it.code }), PUNCH_TIMEOUT_MS).then(function (c) {
        if (c && c.error === 'busy') return 'busy';
        return c && c.ok === true && c.staff ? 'ok' : 'mismatch';
      }, function (e) { if (e && e.message === 'timeout') chkTO[it.id] = (chkTO[it.id] || 0) + 1; throw e; }) : Promise.resolve('ok');
      return pre.then(function (pv) {
        if (pv === 'busy') return { ok: false, error: 'busy' };
        if (pv === 'mismatch') return { ok: false, error: 'mismatch' };
        return withTimeout(rpc('kintai_clock_punch', { p_code: it.code, p_kind: it.kind, p_client_id: it.id, p_client_at: new Date(it.at).toISOString(), p_offline: true, p_device: deviceKey() }), PUNCH_TIMEOUT_MS);
      }).then(function (r) {
        if (r && r.error === 'busy') return null;   /* 一時的な断り（番号の総当たりの止め）。送信待ちに残し、次の回に送り直す（指摘7） */
        var rest = readList(Q_KEY).filter(function (x) { return x.id !== it.id; });
        if (!(r && r.ok === true)) {
          var why = r && r.error === 'mismatch' ? 'パスコードが選んだ名前と合わない' : r && r.error === 'stale' ? '時刻が古すぎる' : (r && r.error === 'notfound' ? '番号が見つからない' : '受け付けられない');
          var fi = { code: it.code, kind: it.kind, id: it.id, at: it.at, why: why };
          if (it.sid) fi.sid = it.sid;
          var f = readList(F_KEY); f.push(fi);
          if (!writeList(F_KEY, f)) return null;   /* 送れなかった控えに書けない時は送信待ちから消さない（両方から消えないように・指摘10） */
        }
        writeList(Q_KEY, rest);
        i++; sent++;
        return step();
      });
    };
    return Promise.resolve().then(step)['catch'](function (e) { if (!isNet(e)) note('控えの送信', e); })
      .then(function () { flushing = false; paintFoot(); if (sent) loadRecent(); });
  }

  /* ── 操作 ── */
  function bind() {
    document.addEventListener('click', function (e) {
      keepAwake();
      var b = e.target.closest ? e.target.closest('button') : null;
      /* 完了の画面は枠のどこを押しても次の人へ（出した直後の重ね押しは無視する） */
      if (view === 'done' && e.target.closest && e.target.closest('#k-panel')) { if (Date.now() - doneAt >= TAP_GUARD_MS) reset(); return; }
      if (!b) return;
      armIdle();
      if (b.getAttribute('data-p')) {
        var sure = b.getAttribute('data-sure') === '1';
        if (sure && Date.now() - askAt < TAP_GUARD_MS) return;   /* 確かめを出した直後の重ね押しで「はい」にしない */
        armAudio(); punch(b.getAttribute('data-p'), sure); return;
      }
      /* v3: 待受の「出勤」「退勤」・事業所の切り替え・氏名 */
      var g = b.getAttribute('data-g'), o = b.getAttribute('data-o'), sid = b.getAttribute('data-sid');
      if (g) {
        if (tooSoon()) return;
        if (view === 'home') { armAudio(); startPick(g); } else if (view === 'pick' || view === 'pass') { armAudio(); switchKind(g); }
        return;
      }
      if (o) { if (view === 'pick' && isOffice(o)) { office = o; saveOffice(o); paintPick(); } return; }
      if (sid) { if (view === 'pick' && !tooSoon()) pickStaff(sid); return; }
      var k = b.getAttribute('data-k');
      if (!k) return;
      if (k === 'home') { reset(); return; }
      if (k === 'bycode') { if (!tooSoon()) toCode(); return; }
      if (k === 'back') { if (view === 'who') toCode(); else reset(); return; }   /* 「番号を入れ直す」は番号の画面へ・送れなかった打刻の「戻る」は待受へ */
      if (k === 'no') { if (view === 'confirm' && who) { if (who.flow === 'name') reset(); else paintWho(false); } return; }
      if (k === 'failed') { if (!busyView()) paintFailed(); return; }   /* 照合中・送信中は開かない（審査の指摘4） */
      if (k === 'clearfail') {
        var ids = shownFail.slice();
        if (ids.length && confirm('ここに出ている送れなかった打刻 ' + ids.length + ' 件を消します。事務所の管理画面で足し終えましたか？')) {
          if (writeList(F_KEY, readList(F_KEY).filter(function (x) { return ids.indexOf(x.id) < 0; }))) { shownFail = []; reset(); }
        }
        return;
      }
      if (view === 'pass' && tooSoon()) return;   /* 氏名を押した指がそのままテンキーに当たらないように */
      press(k);
    });
    document.addEventListener('keydown', function (e) {
      if (view === 'done' && (e.key === 'Enter' || e.key === ' ')) { if (Date.now() - doneAt >= TAP_GUARD_MS) reset(); e.preventDefault(); return; }
      if (view === 'code' || view === 'pass') {
        if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('clr'); e.preventDefault(); }
        else if (e.key === 'Enter') { press('ok'); e.preventDefault(); }
        else if (e.key === 'Escape') reset();
      } else if (e.key === 'Escape' && view !== 'boot' && view !== 'gate') reset();
    });
    window.addEventListener('online', function () { flush(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') keepAwake(); });
  }

  function boot() {
    tick(); setInterval(tick, 1000);
    if (!window.SUAppGate || !window.KintaiCalc) {
      $('k-gate').hidden = false; $('k-gate').textContent = '画面の部品を読み込めませんでした。ページを読み込み直してください。';
      return;
    }
    window.SUAppGate.run('kintai-clock', { dirty: function () { return view === 'who' || view === 'confirm'; } }).then(function (ok) {
      if (!ok) { view = 'gate'; return; }
      bind();
      $('k-body').hidden = false;
      office = readOffice();
      reset();   /* 待受を出し、名簿を読みに行く */
      flush();
      setInterval(flush, FLUSH_MS);
      setInterval(loadRoster, ROSTER_MS);
      loadRecent();
      setInterval(loadRecent, RECENT_MS);
      keepAwake();
      try { if (window.SUPerf) window.SUPerf.ready(); } catch (_) {}
    })['catch'](function (e) { note('起動', e); });
  }
  boot();
})();
