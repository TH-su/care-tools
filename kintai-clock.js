/* kintai-clock.js — タブレットの出勤・退勤の打刻（2026-11-18 新設・凍結仕様 ~/Claude/Work/勤怠管理アプリ/ROOT.md v1）
 * ════════════════════════════════════════════════════════════════
 * ・番号（4〜6桁）を入れる → 名前と「出勤」「退勤」→ 押すと3秒だけ結果を出して最初へ。30秒触らなければ最初へ
 * ・時刻はデータベースの時計（端末の時計を信じない）。通信できない時は端末に控え、つながったら端末の時刻の印つきで送る
 * ・端末に残すのは「番号・出勤か退勤か・控えの番号・端末の時刻」だけ（名前・名簿は残さない＝CLAUDE.md §2-5）
 * ・現場の端末でも開く（打刻のための画面）。ログインの役割は su-app-gate.js で確かめる（APPS の kintai-clock）
 * ・データベースが現場に許すのは kintai_clock_lookup（番号→名前）と kintai_clock_punch（打刻）の2つだけ
 */
(function () {
  'use strict';
  var Q_KEY = 'kintai_clock_queue', F_KEY = 'kintai_clock_failed';
  var IDLE_MS = 30000, DONE_MS = 3000, FLUSH_MS = 30000, MAX_LEN = 6;
  var gen = 0, view = 'boot', code = '', who = null, idleT = null, doneT = null, flushing = false, busyPunch = false;
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

  function paintCode(msg) {
    view = 'code';
    var p = $('k-panel'); p.hidden = false;
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
      if (!r || r.ok !== true) {
        var m = r && r.error === 'busy' ? '番号の間違いが続いたため、少しの間打刻を止めています。10分ほど待ってから入れ直してください。' : 'その番号は見つかりませんでした。番号を確かめて入れ直してください。';
        code = ''; paintCode('<p class="msg ng" role="alert">' + esc(m) + '</p>'); say(m); return;
      }
      who = { code: c, name: r.staff.name, state: r.staff.state, last: r.staff.last_at };
      paintWho(false);
    })['catch'](function (e) {
      if (my !== gen) return;
      if (isNet(e)) { who = { code: c, name: null, state: null }; paintWho(true); return; }
      note('番号の確かめ', e);
      code = ''; paintCode('<p class="msg ng" role="alert">' + esc(friendly(e)) + '</p>');
    });
  }

  function paintWho(offline) {
    view = 'who';
    var sug = who.state === 'in' ? 'out' : 'in';
    var stTxt = offline ? '' : (who.state === 'in' ? '出勤中です（' + hm(Date.parse(who.last)) + ' に出勤）' : (who.state === 'out' ? '退勤済みです（' + hm(Date.parse(who.last)) + ' に退勤）' : ''));
    $('k-panel').innerHTML =
      (offline ? '<p class="msg warn" role="alert">通信できません。番号 ' + esc(who.code) + ' で打刻を端末に控え、つながったら送ります。</p>' :
        '<p class="who">' + esc(who.name) + ' さん</p><p class="state">' + esc(stTxt || 'どちらかを押してください') + '</p>') +
      '<div class="acts"><button type="button" class="b-in' + (sug === 'in' ? ' sug' : '') + '" data-p="in">出勤</button>' +
      '<button type="button" class="b-out' + (sug === 'out' ? ' sug' : '') + '" data-p="out">退勤</button></div>' +
      '<button type="button" class="back" data-k="back">番号を入れ直す</button>';
    say(offline ? '通信できません。出勤か退勤を押すと控えます' : who.name + 'さん。出勤か退勤を押してください');
    armIdle();
    try { $('k-panel').querySelector(sug === 'in' ? '.b-in' : '.b-out').focus(); } catch (_) {}
  }

  function punch(kind) {
    if (view !== 'who' || busyPunch || !who) return;
    busyPunch = true;
    var my = ++gen, item = { code: who.code, kind: kind, id: uuid(), at: Date.now() }, name = who.name;
    var label = kind === 'in' ? '出勤' : '退勤';
    var save = function () {
      var okQ = enqueue(item);   /* 控えは画面の世代に関わらず必ず書く（client_id で二重にはならない） */
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      if (!okQ) { showDone('ng', '控えられませんでした', 'この端末に控えを残せませんでした。事務所に知らせてください。'); return; }
      showDone('save', label + 'を控えました', '番号 ' + item.code + '・' + hm(item.at) + '（端末の時刻）。つながったら自動で送ります。');
    };
    if (!name) { save(); return; }
    view = 'sending'; clearTimeout(idleT);
    $('k-panel').innerHTML = '<p class="lbl">記録しています…</p>';
    rpc('kintai_clock_punch', { p_code: item.code, p_kind: kind, p_client_id: item.id, p_client_at: new Date(item.at).toISOString(), p_offline: false, p_device: deviceKey() }).then(function (r) {
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      if (r && r.ok === true) {
        var t = hm(Date.parse(r.at));
        showDone(kind === 'in' ? 'ok' : 'out', (r.name || name) + ' さん　' + label + ' ' + t, r.dup ? '少し前に同じ打刻があったので、その時刻のままにしました。' : (kind === 'in' ? 'おはようございます。今日もよろしくお願いします。' : 'おつかれさまでした。'));
        return;
      }
      var why = r && r.error === 'notfound' ? 'その番号は見つかりませんでした。' : (r && r.error === 'busy' ? '番号の間違いが続いたため、少しの間打刻を止めています。10分ほど待ってから打刻してください。' : 'うまくいきませんでした。もう一度押してください。');
      busyPunch = false; code = ''; paintCode('<p class="msg ng" role="alert">' + esc(why) + '</p>');
    })['catch'](function (e) {
      if (isNet(e)) { save(); return; }
      if (view === 'sending') view = 'who';
      if (my !== gen) return;
      note('打刻', e);
      busyPunch = false; code = ''; paintCode('<p class="msg ng" role="alert">' + esc(friendly(e)) + '</p>');
    });
  }

  function showDone(kind, big, sub) {
    view = 'done';
    clearTimeout(idleT);
    $('k-panel').innerHTML = '<div class="done ' + kind + '" role="alert"><p class="big-msg">' + esc(big) + '</p><p>' + esc(sub) + '</p></div>';
    say(big + '。' + sub);
    paintFoot();
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
    var f = readList(F_KEY);
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
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      armIdle();
      if (b.getAttribute('data-p')) { punch(b.getAttribute('data-p')); return; }
      var k = b.getAttribute('data-k');
      if (!k) return;
      if (k === 'back') { reset(); return; }
      if (k === 'failed') { paintFailed(); return; }
      if (k === 'clearfail') { if (confirm('送れなかった打刻を全部消します。事務所の管理画面で足し終えましたか？')) { writeList(F_KEY, []); reset(); } return; }
      press(k);
    });
    document.addEventListener('keydown', function (e) {
      if (view === 'code') {
        if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('clr'); e.preventDefault(); }
        else if (e.key === 'Enter') { press('ok'); e.preventDefault(); }
      } else if (e.key === 'Escape' && view !== 'boot' && view !== 'gate') reset();
    });
    window.addEventListener('online', function () { flush(); });
  }

  function boot() {
    tick(); setInterval(tick, 1000);
    if (!window.SUAppGate || !window.KintaiCalc) {
      $('k-gate').hidden = false; $('k-gate').textContent = '画面の部品を読み込めませんでした。ページを読み込み直してください。';
      return;
    }
    window.SUAppGate.run('kintai-clock', { dirty: function () { return view === 'who'; } }).then(function (ok) {
      if (!ok) { view = 'gate'; return; }
      bind();
      reset();
      flush();
      setInterval(flush, FLUSH_MS);
      try { if (window.SUPerf) window.SUPerf.ready(); } catch (_) {}
    })['catch'](function (e) { note('起動', e); });
  }
  boot();
})();
