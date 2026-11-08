/*
 * enroll.js — 端末の登録（enroll.html）の動き（2026-11-08 新設・代表者の決定 段4・care-backend 統合 0082）
 * 1. 住所の # の後ろの番号（c=40字の16進）を読み、すぐ住所から消す（履歴・ブックマーク・画面の共有に残さない）
 * 2. 受け口 device-enroll へ {code} だけを送る（ログインは要らない・決まった住所からだけ受ける受け口）
 * 3. 受け取ったログインの鍵を共通ログインの部品（SUAuth.client().auth.setSession）に入れ、データベースに役割を確かめる
 * 4. QR に端末の用途があればこの端末の用途にし、メニューへ移る（読み込み直すので、用途の止めは起動時のガードに任せる）
 * ★番号はメモリにだけ持つ（localStorage・sessionStorage・記録に入れない）。断りの理由は受け口が分けない（使えない QR はどれも同じ文）。
 * ★表示はすべて textContent。console は使わない。
 */
(function () {
  'use strict';
  var ENDPOINT = 'https://jhbernqawjrzqwrmqrih.supabase.co/functions/v1/device-enroll';
  var PUBLISHABLE = 'sb_publishable_D8mWQenb7E8q7q6On45HaQ_GKxAE_zI';   // su-auth.js と同じ公開用の鍵（これだけでは何も読めない）
  var DEVICE_KEY = 'su_device_role';
  var GO_MS = 1500;
  var $ = function (id) { return document.getElementById(id); };

  // ① 番号を読んで、すぐ住所から消す
  var code = '';
  try {
    var h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    code = String(h.get('c') || '');
  } catch (e) { code = ''; }
  if (location.hash) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 古い端末では消せないこともある（番号は1回限り） */ }
  }

  function show(name) {
    ['loading', 'ok', 'ng', 'none'].forEach(function (v) { $('v-' + v).hidden = v !== name; });
  }
  function fail(text, canRetry) {
    $('ng-msg').textContent = text;
    $('b-retry').hidden = !canRetry;
    show('ng');
  }
  var MSG = {
    invalid: 'この QR は使えません（使ったことのある QR・期限の10分を過ぎた QR・取り消した QR のどれかです）。管理者にもう一度 QR を出してもらってください。',
    limited: '試した回数が多いため、しばらく登録できません。15分ほど待ってから、管理者に新しい QR を出してもらってください。',
    net: '通信できませんでした。電波・Wi-Fi を確かめてから「もう一度試す」を押してください。',
    server: '登録できませんでした。管理者にもう一度 QR を出してもらってください。',
    denied: 'ログインはできましたが、このアカウントは今は使えません。管理者に確かめてください。'
  };

  async function run() {
    if (!/^[0-9a-f]{40}$/.test(code)) { show('none'); return; }
    show('loading');
    var res, j = null;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE },
        body: JSON.stringify({ code: code })
      });
    } catch (e) { fail(MSG.net, true); return; }
    try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok || !j || j.ok !== true) {
      var c = j && j.code;
      code = '';   // 受け口に届いた番号は使い終わり（もう一度は送らない）
      fail(c === 'invalid' ? MSG.invalid : c === 'limited' ? MSG.limited : MSG.server, false);
      return;
    }
    code = '';
    var s = j.session || {};
    if (typeof s.access_token !== 'string' || typeof s.refresh_token !== 'string') { fail(MSG.server, false); return; }
    try {
      // 前のログインがあれば、先にこの端末だけログアウトする（前の人の控えを残さない）
      var cur = await SUAuth.client().auth.getSession();
      if (cur && cur.data && cur.data.session) await SUAuth.signOut();
      var set = await SUAuth.client().auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      if (set.error) throw set.error;
    } catch (e) { fail(MSG.server, false); return; }
    var st;
    try { st = await SUAuth.check({ fresh: true }); } catch (e) { st = null; }
    if (!st || st.status !== SUAuth.STATUS.OK) { fail(MSG.denied, false); return; }
    if (j.deviceRole === 'field' || j.deviceRole === 'office') {
      try { localStorage.setItem(DEVICE_KEY, j.deviceRole); } catch (e) { /* 書けない端末は今の用途のまま */ }
    }
    var pill = $('ok-role');
    pill.textContent = st.roleLabel || '';
    pill.className = 'pill ' + (st.role || '');
    show('ok');
    setTimeout(function () { location.replace('index.html'); }, GO_MS);
  }

  $('b-retry').addEventListener('click', function () { run(); });
  run();
})();
