/*
 * login.js — ログイン画面（login.html）の動き。部品は su-auth.js。
 * 画面に直書きのスクリプトを置かない（CSP で script-src 'self' に絞るため）ので、ここに分けている。
 */
(function () {
  'use strict';
  var S = SUAuth.STATUS;
  var VIEWS = ['loading', 'signedout', 'denied', 'enroll', 'verify', 'ok', 'error'];
  var $ = function (id) { return document.getElementById(id); };

  // 戻り先: このサイト内の「英数字.html」だけ受け付ける（よそのサイトへ飛ばす罠リンクに使わせない）
  var NEXT_KEY = 'su_auth_next';
  (function () {
    var n = new URLSearchParams(location.search).get('next');
    try {
      if (n && /^[a-z0-9][a-z0-9-]*\.html$/.test(n)) sessionStorage.setItem(NEXT_KEY, n);
    } catch (e) { /* sessionStorage が使えない端末では戻り先を覚えない */ }
  })();
  function nextPage() {
    try {
      var n = sessionStorage.getItem(NEXT_KEY);
      return n && /^[a-z0-9][a-z0-9-]*\.html$/.test(n) ? n : '';
    } catch (e) { return ''; }
  }

  function msg(text, kind) {
    var m = $('msg');
    m.className = 'msg ' + (kind || 'ng');
    m.textContent = text || '';
  }
  function fill(view, st) {
    var root = $('v-' + view);
    root.querySelectorAll('[data-f]').forEach(function (el) {
      var k = el.getAttribute('data-f');
      if (k === 'email') el.textContent = st.email || '';
      if (k === 'message') el.textContent = st.message || '';
      if (k === 'role') { el.textContent = st.roleLabel || ''; el.className = 'pill ' + (st.role || ''); }
      if (k === 'how') el.textContent = howText(st);
    });
  }
  function howText(st) {
    var m = st.methods || [];
    var parts = [];
    if (m.indexOf('oauth') >= 0) parts.push('Google');
    if (m.indexOf('password') >= 0) parts.push('ID とパスワード');
    if (m.indexOf('totp') >= 0 || st.aal === 'aal2') parts.push('2段階認証');
    return parts.join(' ＋ ') || '—';
  }
  function show(view, st) {
    VIEWS.forEach(function (v) { $('v-' + v).hidden = v !== view; });
    $('v-signout').hidden = !(st && st.email);
    if (st) fill(view, st);
    var h = $('v-' + view).querySelector('h2');
    if (h && view !== 'loading') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  var current = null;
  async function refresh() {
    show('loading');
    var st;
    try { st = await SUAuth.check(); }
    catch (e) { st = { status: S.ERROR, message: String(e && e.message || e) }; }
    current = st;
    switch (st.status) {
      case S.SIGNED_OUT: show('signedout', st); if (st.message) msg(st.message); break;
      case S.DENIED: show('denied', st); break;
      case S.MFA_ENROLL:
        $('enroll-start').hidden = false; $('enroll-qr').hidden = true;
        show('enroll', st); break;
      case S.MFA_VERIFY: show('verify', st); $('code-verify').value = ''; $('code-verify').focus(); break;
      case S.OK: showOk(st); break;
      default: show('error', st);
    }
  }
  function showOk(st) {
    show('ok', st);
    $('b-accounts').hidden = st.role !== 'admin';
    var n = nextPage();
    var b = $('b-next');
    if (n) {
      b.textContent = '元の画面へ戻る';
      b.setAttribute('href', n);
      try { sessionStorage.removeItem(NEXT_KEY); } catch (e) { /* 何もしない */ }
    }
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = '確かめています…'; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }

  $('b-google').addEventListener('click', async function () {
    msg('');
    busy(this, true);
    try { await SUAuth.signInGoogle(); }   // 成功すると Google の画面へ移る
    catch (e) { busy(this, false); msg(e.message); }
  });

  document.addEventListener('click', async function (ev) {
    var a = ev.target.closest('[data-act]');
    if (!a) return;
    var act = a.getAttribute('data-act');
    if (act === 'signout' || act === 'switch') {
      msg('');
      busy(a, true);
      try { await SUAuth.signOut(); } catch (e) { /* 通信できなくても端末の記録は消える */ }
      busy(a, false);
      await refresh();
      if (act === 'signout') msg('この端末からログアウトしました。', 'ok');
    }
    if (act === 'skip' && current) {
      msg('');
      showOk(Object.assign({}, current, { role: 'office', roleLabel: SUAuth.ROLE_LABEL.office + '（2段階認証なし）' }));
    }
  });

  $('b-enroll').addEventListener('click', async function () {
    msg('');
    busy(this, true);
    try {
      var r = await SUAuth.enrollTotp();
      $('qr').src = r.qr;
      $('secret').textContent = r.secret;
      $('enroll-qr').dataset.factor = r.factorId;
      $('enroll-start').hidden = true;
      $('enroll-qr').hidden = false;
      $('code-enroll').focus();
    } catch (e) { msg(e.message); }
    busy(this, false);
  });

  async function verify(btn, input, factorId) {
    var code = input.value.replace(/\D/g, '');
    if (code.length !== 6) { msg('6桁の数字を入れてください。'); input.focus(); return; }
    msg('');
    busy(btn, true);
    try {
      await SUAuth.verifyTotp(factorId, code);
      // QR と手入力用の文字は、確認が済んだら画面から消す
      $('qr').removeAttribute('src');
      $('secret').textContent = '';
      await refresh();
      msg('2段階認証を確認しました。', 'ok');
    } catch (e) {
      msg(e.message);
      input.select();
    }
    busy(btn, false);
  }
  $('b-enroll-verify').addEventListener('click', function () {
    verify(this, $('code-enroll'), $('enroll-qr').dataset.factor);
  });
  $('b-verify').addEventListener('click', function () {
    verify(this, $('code-verify'), current && current.factorId);
  });
  // 6桁が揃ったら Enter でも確認できる
  [['code-enroll', 'b-enroll-verify'], ['code-verify', 'b-verify']].forEach(function (p) {
    $(p[0]).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $(p[1]).click(); });
  });
  $('b-retry').addEventListener('click', refresh);

  refresh();
})();
