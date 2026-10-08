/*
 * accounts.js — 使える人の管理（accounts.html）の動き。
 * 読み書きの可否はデータベース（許可リストの RLS・最後の管理者の保護）が決める。
 * この画面は「管理者でなければ何も出さない」「自分の行は触らせない」を重ねて見せ方を整えるだけ。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ROLE = SUAuth.ROLE_LABEL;
  var me = null;          // SUAuth.check() の結果
  var tenantId = null;    // 追加する行の事業者（自分の行から取る）

  function msg(text, kind) {
    var m = $('msg');
    m.className = 'msg ' + (kind || 'ng');
    m.textContent = text || '';
    if (text) m.scrollIntoView({ block: 'nearest' });
  }
  function view(name) {
    $('v-loading').hidden = name !== 'loading';
    $('v-gate').hidden = name !== 'gate';
    $('v-admin').hidden = name !== 'admin';
  }

  // データベースの断り文句を、画面で意味の通る言葉へ
  function friendly(err) {
    var code = err && err.code;
    var m = String(err && err.message || err || '');
    if (code === '23505') return 'このメールアドレスはすでに登録されています。';
    if (code === '23514' && /最後の管理者/.test(m)) return m;
    if (code === '23514') return 'この内容では登録できません（メールアドレスの形や役割を確かめてください）。';
    if (code === '42501' || /row-level security|permission denied/i.test(m)) {
      return 'この操作をする権限がありません。管理者として2段階認証まで済んでいるか確かめてください。';
    }
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return m || 'うまくいきませんでした。';
  }

  async function load() {
    var r = await SUAuth.client().from('allowed_accounts')
      .select('email,role,is_active,allow_password,label,tenant_id')
      .order('is_active', { ascending: false })
      .order('role', { ascending: true })
      .order('email', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function row(a) {
    var li = el('li', a.is_active ? '' : 'off');
    var isMe = a.email === me.email;
    var left = el('div');
    left.appendChild(el('div', 'nm', a.label || '（名前なし）'));
    left.appendChild(el('div', 'em', a.email));
    var tags = el('div', 'tags');
    tags.appendChild(el('span', 'pill ' + a.role, ROLE[a.role] || a.role));
    if (a.allow_password) tags.appendChild(el('span', 'tag shared', '施設共有・パスワード可'));
    if (isMe) tags.appendChild(el('span', 'tag me', '自分'));
    left.appendChild(tags);
    li.appendChild(left);

    var ops = el('div', 'ops');
    if (isMe) {
      ops.appendChild(el('span', 'muted', '自分の行はここでは変えられません'));
    } else if (a.is_active) {
      var sel = el('select', 'sel');
      sel.setAttribute('aria-label', (a.label || a.email) + ' の役割');
      ['field', 'office', 'admin'].forEach(function (k) {
        var o = el('option', null, ROLE[k]);
        o.value = k;
        if (k === a.role) o.selected = true;
        sel.appendChild(o);
      });
      // パスワード可の行（施設共有）は管理者にできない（データベースの約束）
      if (a.allow_password) sel.querySelector('option[value=admin]').disabled = true;
      sel.addEventListener('change', function () { changeRole(a, sel); });
      ops.appendChild(sel);
      var stop = el('button', 'btn sm ng', '停止');
      stop.type = 'button';
      stop.addEventListener('click', function () { setActive(a, false, stop); });
      ops.appendChild(stop);
    } else {
      var resume = el('button', 'btn sm', '再開');
      resume.type = 'button';
      resume.addEventListener('click', function () { setActive(a, true, resume); });
      ops.appendChild(resume);
    }
    li.appendChild(ops);
    return li;
  }

  function render(list) {
    var on = list.filter(function (a) { return a.is_active; });
    var off = list.filter(function (a) { return !a.is_active; });
    $('list-on').replaceChildren.apply($('list-on'), on.map(row));
    $('list-off').replaceChildren.apply($('list-off'), off.map(row));
    $('count-on').textContent = on.length + '人';
    $('count-off').textContent = off.length + '人';
    $('sec-off').hidden = off.length === 0;
  }

  async function reload() {
    render(await load());
  }

  async function changeRole(a, sel) {
    var to = sel.value;
    var name = a.label || a.email;
    var extra = to === 'admin' ? '\n\n管理者は、次のログインで2段階認証の登録が必要になります。' : '';
    if (!confirm(name + ' の役割を「' + ROLE[a.role] + '」から「' + ROLE[to] + '」に変えますか？' + extra)) {
      sel.value = a.role;
      return;
    }
    msg('');
    sel.disabled = true;
    var r = await SUAuth.client().from('allowed_accounts').update({ role: to }).eq('email', a.email).select('email');
    sel.disabled = false;
    if (r.error || !r.data || !r.data.length) {
      sel.value = a.role;
      msg(r.error ? friendly(r.error) : '変更できませんでした（権限が無いか、すでに消えています）。');
      return;
    }
    msg(name + ' の役割を「' + ROLE[to] + '」にしました。', 'ok');
    await reload();
  }

  async function setActive(a, on, btn) {
    var name = a.label || a.email;
    var q = on ? name + ' を再開しますか？（また使えるようになります）'
               : name + ' を停止しますか？\n\n停止すると、その人はその場で何も見られなくなります（あとで再開できます）。';
    if (!confirm(q)) return;
    msg('');
    btn.disabled = true;
    var r = await SUAuth.client().from('allowed_accounts').update({ is_active: on }).eq('email', a.email).select('email');
    btn.disabled = false;
    if (r.error || !r.data || !r.data.length) {
      msg(r.error ? friendly(r.error) : '変更できませんでした（権限が無いか、すでに消えています）。');
      return;
    }
    msg(name + (on ? ' を再開しました。' : ' を停止しました。'), 'ok');
    await reload();
  }

  var EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  $('b-add').addEventListener('click', async function () {
    var email = $('f-email').value.trim().toLowerCase();
    var label = $('f-label').value.trim();
    var role = $('f-role').value;
    if (!EMAIL_RE.test(email)) { msg('メールアドレスの形を確かめてください。'); $('f-email').focus(); return; }
    if (!label) { msg('名前（メモ）を入れてください。一覧で見分けるために使います。'); $('f-label').focus(); return; }
    var q = email + '（' + label + '）を「' + ROLE[role] + '」として追加しますか？';
    if (role === 'admin') q += '\n\n管理者はこの画面も使えるようになります。初めてのログインで2段階認証の登録が必要です。';
    if (!confirm(q)) return;
    msg('');
    var btn = this;
    btn.disabled = true;
    var r = await SUAuth.client().from('allowed_accounts')
      .insert({ email: email, label: label, role: role, tenant_id: tenantId })
      .select('email');
    btn.disabled = false;
    if (r.error) { msg(friendly(r.error)); return; }
    $('f-email').value = '';
    $('f-label').value = '';
    $('f-role').value = 'field';
    msg(email + ' を追加しました。本人に「ログイン」の画面（login.html）から Google で入るよう伝えてください。', 'ok');
    await reload();
  });

  async function start() {
    view('loading');
    try {
      me = await SUAuth.check();
    } catch (e) {
      me = { status: 'error', message: String(e && e.message || e) };
    }
    if (me.status !== SUAuth.STATUS.OK || me.role !== 'admin') {
      if (me.status === SUAuth.STATUS.MFA_VERIFY || me.status === SUAuth.STATUS.MFA_ENROLL) {
        $('gate-why').textContent = '管理者として使うには、ログインの画面で2段階認証（認証アプリの6桁）を済ませてください。';
      } else if (me.status === SUAuth.STATUS.SIGNED_OUT) {
        $('gate-why').textContent = 'ログインしていません。管理者のアカウントでログインしてください。';
      } else if (me.status === SUAuth.STATUS.ERROR) {
        $('gate-why').textContent = me.message || '確かめられませんでした。';
      }
      view('gate');
      return;
    }
    try {
      var list = await load();
      var mine = list.filter(function (a) { return a.email === me.email; })[0];
      tenantId = mine && mine.tenant_id;
      if (!tenantId) throw new Error('自分の行が見つかりません。');
      render(list);
      view('admin');
    } catch (e) {
      $('gate-why').textContent = friendly(e);
      view('gate');
    }
  }
  start();
})();
