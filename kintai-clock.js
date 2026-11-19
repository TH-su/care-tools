/* kintai-clock.js — タブレットの出勤・退勤の打刻（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1）
 * ════════════════════════════════════════════════════════════════
 * ・番号（4〜6桁）を入れる → 名前と「出勤」「退勤」→ 押すと4秒だけ結果を出して最初へ（押せばすぐ次へ）。30秒触らなければ最初へ
 * ・v2（2026-11-19・ROOT-v2-polish.md の D）: 最後の打刻が今日でない時は日付つきで出す／強調と逆（出勤中に出勤・
 *   退勤済みに退勤）は画面の中で1回だけ確かめる／完了は枠全体を色で塗り短い音を鳴らす／画面を消さない（Wake Lock）／
 *   番号の止め（busy）の時も控える／「消す」は画面に出した控えだけ／暗い表示。今日の予定は lookup が返さないので出さない
 * ・時刻はデータベースの時計（端末の時計を信じない）。通信できない時は端末に控え、つながったら端末の時刻の印つきで送る
 * ・端末に残すのは「番号・出勤か退勤か・控えの番号・端末の時刻」だけ（名前・名簿は残さない＝CLAUDE.md §2-5）
 * ・現場の端末でも開く（打刻のための画面）。ログインの役割は su-app-gate.js で確かめる（APPS の kintai-clock）
 * ・データベースが現場に許すのは kintai_clock_lookup（番号→名前）と kintai_clock_punch（打刻）の2つだけ
 */
(function () {
  'use strict';
  var Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed';
  var IDLE_MS = 30000, DONE_MS = 4000, FLUSH_MS = 30000, MAX_LEN = 6, TAP_GUARD_MS = 400;
  var SHIFT_MS = 16 * 3600000;   /* 出勤からこの時間までは勤務中とみなす（夜勤明けの退勤。超えたら退勤の押し忘れとして扱う） */
  var gen = 0, view = 'boot', code = '', who = null, idleT = null, doneT = null, flushing = false, busyPunch = false;
  var doneAt = 0, askAt = 0, shownFail = [];
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
  function okItem(x) { return x && KintaiCalc.isCode(x.code) && (x.kind === 'in' || x.kind === 'out') && typeof x.id === 'string' && typeof x.at === 'number'; }
  function writeList(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); return true; } catch (e) { note('控えの保存', e); return false; } }
  function enqueue(item) {
    var q = readList(Q_KEY); q.push(item);
    return writeList(Q_KEY, q);
  }

  /* ── データベースの窓口 ── */
  function rpc(name, args) {
    return Promise.resolve().then(function () { return window.SUAuth.client().rpc(name, args); }).then(function (r) {
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
  function armIdle() { clearTimeout(idleT); if (view !== 'code' || code) idleT = setTimeout(reset, IDLE_MS); }
  function reset() {
    if (view === 'sending') return;   /* 送信中は戻さない（打刻を落とさない・反証レビュー指摘1） */
    gen++; clearTimeout(doneT); clearTimeout(idleT); code = ''; who = null; busyPunch = false; paintCode();
  }
  /* 枠の塗り（完了の時だけ出勤＝緑・退勤＝橙などで枠全体を塗る） */
  function panelTone(t) { $('k-panel').className = 'panel' + (t ? ' tone-' + t : ''); }

  function paintCode(msg) {
    view = 'code';
    var p = $('k-panel'); p.hidden = false; panelTone('');
    p.innerHTML = '<p class="lbl" id="k-lbl">打刻の番号を入れてください</p>' + (msg || '') +
      '<div class="code' + (code ? '' : ' ph') + '" id="k-code" aria-labelledby="k-lbl">' + (code ? esc(code.replace(/./g, '●').slice(0, -1) + code.slice(-1)) : '4〜6桁の番号') + '</div>' +
      '<div class="keys" role="group" aria-label="番号のボタン">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button type="button" class="k-clr" data-k="clr">消す</button><button type="button" data-k="0">0</button>' +
      '<button type="button" class="k-ok" data-k="ok"' + (KintaiCalc.isCode(code) ? '' : ' disabled') + '>決定</button></div>';
    paintFoot();
    armIdle();
  }
  function press(k) {
    if (view !== 'code') return;
    if (k === 'clr') code = code.slice(0, -1);
    else if (k === 'ok') { if (KintaiCalc.isCode(code)) lookup(); return; }
    else if (/^[0-9]$/.test(k) && code.length < MAX_LEN) code += k;
    paintCode();
  }

  function lookup() {
    var my = ++gen, c = code;
    view = 'wait';
    $('k-panel').innerHTML = '<p class="lbl">確かめています…</p>';
    rpc('kintai_clock_lookup', { p_code: c }).then(function (r) {
      if (my !== gen) return;
      /* 番号の止め（busy）の時も打刻は控えて、止めが解けたら送る（名前は出せない＝通信できない時と同じ画面） */
      if (r && r.error === 'busy') { who = { code: c, name: null, state: null, why: 'busy' }; paintWho(true); return; }
      if (!r || r.ok !== true) {
        var m = 'その番号は見つかりませんでした。番号を確かめて入れ直してください。';
        code = ''; paintCode('<p class="msg ng" role="alert">' + esc(m) + '</p>'); say(m); return;
      }
      var lastMs = r.staff.last_at ? Date.parse(r.staff.last_at) : NaN;
      who = { code: c, name: r.staff.name, state: r.staff.state, last: r.staff.last_at,
        today: !isNaN(lastMs) && jstDayNo(lastMs) === jstDayNo(Date.now()) };
      /* 勤務中: 今日の出勤、または日付が変わっても出勤から16時間以内（夜勤明け） */
      who.onShift = who.state === 'in' && (who.today || Date.now() - lastMs <= SHIFT_MS);
      paintWho(false);
    })['catch'](function (e) {
      if (my !== gen) return;
      if (isNet(e)) { who = { code: c, name: null, state: null, why: 'net' }; paintWho(true); return; }
      note('番号の確かめ', e);
      code = ''; paintCode('<p class="msg ng" role="alert">' + esc(friendly(e)) + '</p>');
    });
  }

  function paintWho(offline) {
    view = 'who';
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
    view = 'confirm';
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
    var label = kind === 'in' ? '出勤' : '退勤';
    var save = function (because) {
      var okQ = enqueue(item);   /* 控えは画面の世代に関わらず必ず書く（client_id で二重にはならない） */
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      if (!okQ) { showDone({ tone: 'ng', big: '控えられませんでした', sub: 'この端末に控えを残せませんでした。事務所に知らせてください。' }); return; }
      showDone({ tone: 'save', kind: kind, big: label + 'を控えました', time: hm(item.at), sub: '番号 ' + item.code + '・端末の時刻。' + ((because || why) === 'busy' ? '止めが解けたら自動で送ります。' : 'つながったら自動で送ります。') });
    };
    if (!name) { save(); return; }
    view = 'sending'; clearTimeout(idleT);
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
      var whyTxt = r && r.error === 'notfound' ? 'その番号は見つかりませんでした。' : 'うまくいきませんでした。もう一度押してください。';
      busyPunch = false; code = ''; paintCode('<p class="msg ng" role="alert">' + esc(whyTxt) + '</p>');
    })['catch'](function (e) {
      if (isNet(e)) { save(); return; }
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      note('打刻', e);
      busyPunch = false; code = ''; paintCode('<p class="msg ng" role="alert">' + esc(friendly(e)) + '</p>');
    });
  }

  /* 完了: 枠全体を塗り、名前・種類・時刻を特大で出す。4秒で最初へ（押せばすぐ次へ）。残りの秒は細い帯で見せる */
  function showDone(o) {
    view = 'done';
    clearTimeout(idleT); clearTimeout(doneT);
    panelTone(o.tone);
    $('k-panel').innerHTML = '<div class="done" role="alert">' +
      (o.name ? '<p class="d-name">' + esc(o.name) + '</p>' : '') +
      '<p class="d-kind">' + esc(o.big) + '</p>' + (o.time ? '<p class="d-time">' + esc(o.time) + '</p>' : '') +
      '<p class="d-sub">' + esc(o.sub) + '</p><p class="d-tap">画面を押すと、すぐ次の人へ</p>' +
      '<div class="d-bar" aria-hidden="true"><i></i></div></div>';
    say([o.name, o.big, o.time, o.sub].filter(Boolean).join('。'));
    if (o.tone === 'in' || o.tone === 'out') chime(o.tone);
    paintFoot();
    doneAt = Date.now();
    doneT = setTimeout(reset, DONE_MS);
  }

  /* ── 控えの件数と、送れなかった控え ── */
  function paintFoot() {
    var q = readList(Q_KEY).length, f = readList(F_KEY).length, h = '';
    if (q) h += '<span class="chip" role="status">送信待ちの打刻 ' + q + ' 件（つながったら送ります）</span>';
    if (f) h += '<button type="button" class="chip ng" data-k="failed">送れなかった打刻 ' + f + ' 件（事務所へ）</button>';
    $('k-foot').innerHTML = h;
  }
  function paintFailed() {
    clearTimeout(doneT);
    view = 'failed';
    panelTone('');
    var f = readList(F_KEY);
    shownFail = f.map(function (x) { return x.id; });   /* 「消す」で消すのは、ここに出した控えだけ（出した後に増えた分は残す） */
    $('k-panel').innerHTML = '<p class="lbl">送れなかった打刻</p><p class="msg warn">事務所の管理画面で、この番号・時刻の打刻を足してください。足したら「消す」を押します。</p>' +
      '<table class="qlist"><tbody>' + f.map(function (x) {
        var d = new Date(x.at + 9 * 3600000);
        return '<tr><td>番号 ' + esc(x.code) + '</td><td>' + (x.kind === 'in' ? '出勤' : '退勤') + '</td><td>' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + hm(x.at) + '</td><td>' + esc(x.why || '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<button type="button" class="back" data-k="clearfail">事務所へ伝えたので消す</button><button type="button" class="back" data-k="back">戻る</button>';
    armIdle();
  }

  function flush() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    var q = readList(Q_KEY);
    if (!q.length) return Promise.resolve();
    flushing = true;
    var i = 0;
    var step = function () {
      if (i >= q.length) return null;
      var it = q[i];
      return rpc('kintai_clock_punch', { p_code: it.code, p_kind: it.kind, p_client_id: it.id, p_client_at: new Date(it.at).toISOString(), p_offline: true, p_device: deviceKey() }).then(function (r) {
        if (r && r.error === 'busy') return null;   /* 一時的な断り（番号の総当たりの止め）。送信待ちに残し、次の回に送り直す（指摘7） */
        var rest = readList(Q_KEY).filter(function (x) { return x.id !== it.id; });
        if (!(r && r.ok === true)) {
          var why = r && r.error === 'stale' ? '時刻が古すぎる' : (r && r.error === 'notfound' ? '番号が見つからない' : '受け付けられない');
          var f = readList(F_KEY); f.push({ code: it.code, kind: it.kind, id: it.id, at: it.at, why: why });
          if (!writeList(F_KEY, f)) return null;   /* 送れなかった控えに書けない時は送信待ちから消さない（両方から消えないように・指摘10） */
        }
        writeList(Q_KEY, rest);
        i++;
        return step();
      });
    };
    return Promise.resolve().then(step)['catch'](function (e) { if (!isNet(e)) note('控えの送信', e); })
      .then(function () { flushing = false; if (view === 'code' || view === 'done') paintFoot(); });
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
      var k = b.getAttribute('data-k');
      if (!k) return;
      if (k === 'back') { reset(); return; }
      if (k === 'no') { if (view === 'confirm' && who) paintWho(false); return; }
      if (k === 'failed') { paintFailed(); return; }
      if (k === 'clearfail') {
        var ids = shownFail.slice();
        if (ids.length && confirm('ここに出ている送れなかった打刻 ' + ids.length + ' 件を消します。事務所の管理画面で足し終えましたか？')) {
          if (writeList(F_KEY, readList(F_KEY).filter(function (x) { return ids.indexOf(x.id) < 0; }))) { shownFail = []; reset(); }
        }
        return;
      }
      press(k);
    });
    document.addEventListener('keydown', function (e) {
      if (view === 'done' && (e.key === 'Enter' || e.key === ' ')) { if (Date.now() - doneAt >= TAP_GUARD_MS) reset(); e.preventDefault(); return; }
      if (view === 'code') {
        if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('clr'); e.preventDefault(); }
        else if (e.key === 'Enter') { press('ok'); e.preventDefault(); }
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
      reset();
      flush();
      setInterval(flush, FLUSH_MS);
      keepAwake();
      try { if (window.SUPerf) window.SUPerf.ready(); } catch (_) {}
    })['catch'](function (e) { note('起動', e); });
  }
  boot();
})();
