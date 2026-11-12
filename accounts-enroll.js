/*
 * accounts-enroll.js — 使える人の管理（accounts.html）の「端末登録の QR」（2026-11-08 新設・代表者の決定 段4・care-backend 統合 0082）
 * ════════════════════════════════════════════════════════════════
 * 1. 管理者が現場のアカウント（同じ施設の有効な現場だけ。事務所・管理者は選べない）と、必要なら端末の用途・呼び名を選んで「QR を出す」
 * 2. データベースの device_enroll_issue が1回限り・10分の番号を作り（データベースに置くのはハッシュだけ）、番号を1回だけ返す
 * 3. 画面は「このサイトの enroll.html#c=番号」を QR の絵（su-qr.js・同じサイトの部品）にして出す。端末のカメラで読むと受け取りページが開く
 * 4. 出している間は数秒ごとに一覧を読み直し、使われたら QR を消して「登録できました」と出す。期限が来たら QR を消す
 * 5. 一覧の取り消していない行は「取り消す」（登録した端末はログインそのものが消える）。「このアカウントの端末を全部取り消す」もある
 * ★できる人の判定はデータベース（管理者＋2段階認証＝aal2 でなければ 42501）。この画面は見せ方を整えるだけ。
 * ★番号はメモリにだけ持つ（localStorage・sessionStorage・記録・送信のどれにも入れない）。QR を消したら変数も手放す。画面だけで印刷しない。
 * ★QR に入れるのは受け取りページの住所と番号だけ（合言葉・メール・鍵は入れない）。番号は URL の # の後ろ＝サーバーへは送られない。
 * ★データベースの関数がまだ無い時は「まだ使えません」と出すだけ（ほかの欄は今までどおり動く）。表示はすべて textContent。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ROLE = { field: '現場', office: '事務所' };
  var DEV = { field: '現場の端末', office: '事務所PC' };
  var STATE = { open: '使われるのを待っています', expired: '期限切れ', active: '登録した端末', lapsed: '180日使っていない端末', failed: '登録できませんでした', revoked: '取り消した端末', canceled: '取り消した QR' };
  var POLL_MS = 4000;
  var live = null;   // 出している QR { id, expiresAt, timer } ※番号そのものは持ち続けない

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function note(text, kind) {
    var m = $('en-msg');
    m.className = 'msg ' + (kind || 'ng');
    m.textContent = text || '';
  }
  function missing(err) {
    var c = err && err.code, m = String(err && err.message || '');
    return c === 'PGRST202' || c === '42883' || /could not find the function|does not exist/i.test(m);
  }
  function friendly(err) {
    var code = err && err.code;
    var m = String(err && err.message || err || '');
    if (code === '42501' || /permission denied/i.test(m)) return 'この操作をする権限がありません。管理者として2段階認証まで済んでいるか確かめてください。';
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return 'うまくいきませんでした。少し待ってからもう一度試してください。';
  }
  var REFUSE = {
    badaccount: 'このアカウントは選べません（選べるのは現場のアカウントだけです。止めた人・まだ一度も Google でログインしていない人も選べません）。',
    toomany: 'まだ使われていない QR が5つあります。使うか、下の一覧で取り消してから出してください。',
    badrole: '端末の用途を選び直してください。',
    badlabel: '端末の呼び名は20字までにしてください。'
  };
  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  async function rpc(name, args) {
    var r = await SUAuth.client().rpc(name, args || {});
    if (r.error) throw r.error;
    return r.data;
  }

  function fillAccounts(rows) {
    var sel = $('en-acct');
    var keep = sel.value;
    var opts = [el('option', null, '選んでください')];
    opts[0].value = '';
    rows.forEach(function (a) {
      var o = el('option', null, (a.label || '（名前なし）') + '（' + (ROLE[a.role] || a.role) + '）' + (a.ready ? '' : ' … まだログインしていない'));
      o.value = a.email;
      if (!a.ready) o.disabled = true;
      opts.push(o);
    });
    sel.replaceChildren.apply(sel, opts);
    if (keep) sel.value = keep;
  }

  function renderList(rows) {
    var ul = $('en-list');
    if (!rows.length) { ul.replaceChildren(el('li', 'muted', 'まだありません。')); return; }
    ul.replaceChildren.apply(ul, rows.map(function (r) {
      var li = el('li');
      var left = el('div');
      left.appendChild(el('div', 'nm', (r.deviceLabel ? r.deviceLabel + ' … ' : '') + (r.label || r.email)));
      left.appendChild(el('div', 'em', r.email));
      var tags = el('div', 'tags');
      tags.appendChild(el('span', 'tag st-' + r.state, STATE[r.state] || r.state));
      if (r.deviceRole) tags.appendChild(el('span', 'tag', DEV[r.deviceRole] || r.deviceRole));
      tags.appendChild(el('span', 'tag', '出した ' + fmt(r.createdAt)));
      if (r.boundAt) tags.appendChild(el('span', 'tag', '登録 ' + fmt(r.boundAt)));
      left.appendChild(tags);
      li.appendChild(left);
      var ops = el('div', 'ops');
      if (r.state === 'open' || r.state === 'active' || r.state === 'lapsed' || r.state === 'failed') {
        var dev = r.state === 'active' || r.state === 'lapsed';
        var b = el('button', 'btn sm ng', dev ? 'この端末を取り消す' : 'この QR を取り消す');
        b.type = 'button';
        b.addEventListener('click', function () { revoke(r, b); });
        ops.appendChild(b);
      }
      li.appendChild(ops);
      return li;
    }));
  }

  async function reload() {
    var c = await rpc('device_enroll_candidates');
    fillAccounts((c && c.rows) || []);
    var l = await rpc('device_enroll_list');
    var rows = (l && l.rows) || [];
    renderList(rows);
    return rows;
  }

  function hideQr() {
    if (live && live.timer) clearInterval(live.timer);
    live = null;
    $('en-qr-img').replaceChildren();
    $('en-qr').hidden = true;
    $('b-enroll').disabled = false;
  }

  function isLogin(st) { return st === 'active' || st === 'lapsed'; }
  async function revoke(r, btn, again) {
    var name = (r.deviceLabel ? r.deviceLabel + '（' : '') + (r.label || r.email) + (r.deviceLabel ? '）' : '');
    var q = isLogin(r.state)
      ? name + ' の端末のログインを取り消しますか？\n\nその端末はその場で何も見られなくなります。使い続けるには、もう一度 QR を読むか Google でログインします。'
      : name + ' 用に出した QR を取り消しますか？';
    if (!(await window.SUDialog.confirm(q))) return;
    /* 画面の中の窓は答えを待つ間も画面が動く。窓の間にその QR が端末で読まれると、聞いた文（QR を取り消す）と効き目（端末のログインを取り消す）がずれる。
       答えの後に今の一覧で確かめ直し、ログインかどうかが変わっていれば今の状態の文で聞き直す（1回だけ）。行が無くなっていれば何も送らない（2026-11-13 反証レビューの指摘・仮置き） */
    if (!again) {
      var now = null;
      try { var rows = await reload(); for (var i = 0; i < rows.length; i++) if (rows[i].id === r.id) now = rows[i]; } catch (e) { now = r; }
      if (!now) return;
      if (isLogin(now.state) !== isLogin(r.state)) return revoke(now, btn, true);
    }
    btn.disabled = true;
    try {
      await rpc('device_enroll_revoke', { p_id: r.id });
      if (live && live.id === r.id) hideQr();
      note('取り消しました。', 'ok');
      await reload();
    } catch (e) {
      btn.disabled = false;
      note(friendly(e));
    }
  }

  async function issue() {
    var email = $('en-acct').value;
    var role = $('en-role').value || null;
    var label = $('en-label').value.trim();
    if (!email) { note('ログインさせるアカウントを選んでください。'); $('en-acct').focus(); return; }
    if (label.length > 20) { note(REFUSE.badlabel); $('en-label').focus(); return; }
    note('');
    hideQr();
    $('b-enroll').disabled = true;
    var res;
    try {
      res = await rpc('device_enroll_issue', { p_email: email, p_device_role: role, p_label: label });
    } catch (e) {
      $('b-enroll').disabled = false;
      note(friendly(e));
      return;
    }
    if (!res || res.ok !== true || typeof res.code !== 'string' || !/^[0-9a-f]{40}$/.test(res.code)) {
      $('b-enroll').disabled = false;
      note(REFUSE[res && res.error] || 'QR を出せませんでした。');
      return;
    }
    var url = new URL('enroll.html', location.href);
    url.search = '';
    url.hash = 'c=' + res.code;
    var svg;
    try { svg = SUQr.svg(url.href, { px: 280, label: '端末登録の QR（端末のカメラで読んでください）' }); } catch (e) { svg = null; }
    res.code = '';   // 番号は絵にしたら手放す
    url = null;
    if (!svg) { $('b-enroll').disabled = false; note('QR を描けませんでした。'); return; }
    $('en-qr-img').replaceChildren(svg);
    var opt = $('en-acct').selectedOptions[0];
    $('en-qr-for').textContent = (opt ? opt.textContent.replace(/ … まだログインしていない$/, '') : email) + (role ? ' ・ ' + DEV[role] : '');
    $('en-qr').hidden = false;
    live = { id: res.id, expiresAt: new Date(res.expiresAt).getTime(), timer: null, last: 0 };
    tick();
    live.timer = setInterval(tick, 1000);
    reload().catch(function () {});
  }

  async function tick() {
    if (!live) return;
    var left = Math.max(0, Math.round((live.expiresAt - Date.now()) / 1000));
    if (left <= 0) { hideQr(); note('QR の期限（10分）が過ぎたので消しました。必要ならもう一度出してください。', 'warn'); reload().catch(function () {}); return; }
    $('en-qr-exp').textContent = 'あと ' + Math.floor(left / 60) + '分' + (left % 60 < 10 ? '0' : '') + (left % 60) + '秒 使えます（1回だけ）';
    if (Date.now() - live.last < POLL_MS || document.hidden) return;
    live.last = Date.now();
    var id = live.id;
    try {
      var l = await rpc('device_enroll_list');
      var rows = (l && l.rows) || [];
      var me = rows.filter(function (r) { return r.id === id; })[0];
      if (!live || live.id !== id) return;
      if (me && me.state !== 'open') {
        hideQr();
        if (me.state === 'active') note('端末の登録ができました。その端末はメニューへ移ります。', 'ok');
        else note('QR は使われましたが、登録できませんでした。もう一度出してください。');
      }
      renderList(rows);
    } catch (e) { /* 読み直せない時は次の回にもう一度 */ }
  }

  async function show() {
    var sec = $('sec-enroll');
    if (!sec || !window.SUQr) return;
    sec.hidden = false;
    try {
      await reload();
      $('en-form').hidden = false;
    } catch (e) {
      $('en-form').hidden = true;
      note(missing(e) ? 'まだ使えません（データベースの準備が済んでいません）。' : friendly(e), 'warn');
    }
  }

  async function revokeAll() {
    var email = $('en-acct').value;
    if (!email) { note('取り消すアカウントを選んでください。'); $('en-acct').focus(); return; }
    var opt = $('en-acct').selectedOptions[0];
    var name = opt ? opt.textContent.replace(/ … まだログインしていない$/, '') : email;
    if (!(await window.SUDialog.confirm(name + ' で登録した端末と、まだ使われていない QR を全部取り消しますか？\n\nその端末はその場で何も見られなくなります。'))) return;
    var btn = $('b-enroll-revoke-all');
    btn.disabled = true;
    try {
      var res = await rpc('device_enroll_revoke_account', { p_email: email });
      hideQr();
      var n = res && typeof res.revoked === 'number' ? res.revoked : 0;
      note(n ? n + '件を取り消しました。' : '取り消すものはありませんでした。', 'ok');
      await reload();
    } catch (e) {
      note(friendly(e));
    }
    btn.disabled = false;
  }

  $('b-enroll').addEventListener('click', issue);
  $('b-enroll-revoke-all').addEventListener('click', revokeAll);
  $('b-enroll-close').addEventListener('click', function () { hideQr(); note(''); });
  // 画面を離れる時は QR を消す（戻るボタンの控えに残さない）
  window.addEventListener('pagehide', hideQr);

  window.SUAccountsEnroll = { show: show };
})();
