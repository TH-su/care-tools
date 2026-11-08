/*
 * app-access-devices.js — アプリの使える人（app-access.html）の「端末の用途」の欄（2026-11-08・代表者の決定 段3 案A・統合 0081）。
 * 最近メニューを開いた端末（意味のない乱数の印）の一覧を出し、管理者が1台ずつ用途（決めない・事務所・現場）と呼び名を決める。
 * 決めた用途は、その端末がメニューを開いた時に su-device-role.js が受け取り、違えば書き換えて読み込み直す。
 * ★読める・書けるかはデータベース（device_role_list・device_role_set・管理者＋2段階認証だけ）が決める。この画面は見せ方を整えるだけ。
 * ★画面に出す印は頭の8文字だけ（その端末の「使い方・困った時」にも同じ番号が出る）。表示はすべて textContent。
 * ★端末には何も残さない。上の「アプリ × 人」の表とは別に、1台ずつ保存する。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ROLE_NAME = { office: '事務所', field: '現場' };
  var LABEL_MAX = 30;
  var rows = [];
  var edits = {};       // {key: {role, label}}（保存していない変更）
  var busy = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function msg(text, kind) {
    var m = $('dv-msg');
    m.className = 'msg ' + (kind || 'ng');
    m.textContent = text || '';
  }
  function note(where, e) {
    try { if (window.SUErrors && typeof SUErrors.note === 'function') SUErrors.note('端末の用途の一覧: ' + where, e && e.message || e); } catch (x) { /* 記録できなくても止めない */ }
  }
  function missingFn(err) {
    var m = String(err && err.message || '');
    return !!err && (err.code === 'PGRST202' || /could not find the function/i.test(m));
  }
  function friendly(err) {
    var m = String(err && err.message || err || '');
    if ((err && err.code === '42501') || /permission denied|not allowed/i.test(m)) return 'この操作をする権限がありません。管理者として2段階認証まで済んでいるか確かめてください。';
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return 'うまくいきませんでした。もう一度試してください。';
  }
  var ERR = {
    conflict: 'ほかの画面で先に保存されていました。一覧を読み直したので、もう一度決めてください。',
    nokey: 'この端末は一覧にありません。一覧を読み直してください。',
    badlabel: '呼び名は30字までで、改行は入れられません。',
    badrole: '用途の選び方が正しくありません。', format: '端末の番号の形が正しくありません。'
  };
  function shortNo(k) { return String(k || '').slice(0, 4) + '-' + String(k || '').slice(4, 8); }
  function isStr(v) { return typeof v === 'string'; }
  function cleanRow(r) {
    if (!r || !isStr(r.key) || !/^[0-9a-f]{32}$/.test(r.key)) return null;
    return {
      key: r.key,
      seenRole: r.seenRole === 'field' || r.seenRole === 'office' ? r.seenRole : null,
      login: r.login === true || r.login === false ? r.login : null,
      lastDay: isStr(r.lastDay) && /^\d{4}-\d{2}-\d{2}$/.test(r.lastDay) ? r.lastDay : '',
      role: r.role === 'field' || r.role === 'office' ? r.role : null,
      label: isStr(r.label) ? r.label.slice(0, LABEL_MAX) : '',
      updatedAt: isStr(r.updatedAt) ? r.updatedAt : null
    };
  }
  function cur(r) { return edits[r.key] || { role: r.role, label: r.label }; }
  function changed(r) { var c = cur(r); return c.role !== r.role || c.label !== r.label; }

  function render() {
    var ul = $('dv-list'); ul.textContent = '';
    if (!rows.length) { ul.appendChild(el('li', 'muted', 'まだ端末の記録がありません。各端末がメニューを開くと、ここに出ます。')); return; }
    rows.forEach(function (r) {
      var c = cur(r), li = el('li', 'dv-row' + (changed(r) ? ' chg' : ''));
      var head = el('div', 'dv-head');
      head.appendChild(el('span', 'dv-no', '番号 ' + shortNo(r.key)));
      head.appendChild(el('span', 'dv-meta', r.lastDay ? '最後に開いた日 ' + r.lastDay : '最近は開いていません'));
      head.appendChild(el('span', 'dv-meta', r.login === true ? 'ログインしている' : r.login === false ? 'ログインしていない' : 'ログインは分からない'));
      head.appendChild(el('span', 'dv-meta', '端末の今の用途 ' + (r.seenRole ? ROLE_NAME[r.seenRole] : '分からない')));
      li.appendChild(head);

      var form = el('div', 'dv-form');
      var lr = el('label', '', '用途');
      var sel = el('select');
      [['', '決めない（端末のまま）'], ['office', '事務所'], ['field', '現場']].forEach(function (o) {
        var op = el('option', '', o[1]); op.value = o[0]; if ((c.role || '') === o[0]) op.selected = true; sel.appendChild(op);
      });
      sel.addEventListener('change', function () { edit(r, { role: sel.value || null, label: cur(r).label }); });
      lr.appendChild(sel); form.appendChild(lr);
      var ll = el('label', '', '呼び名（置き場所だけ）');
      var inp = el('input'); inp.type = 'text'; inp.maxLength = LABEL_MAX; inp.value = c.label; inp.placeholder = '例：2階の詰所のタブレット';
      inp.addEventListener('input', function () { edit(r, { role: cur(r).role, label: inp.value }, true); });
      ll.appendChild(inp); form.appendChild(ll);
      var b = el('button', 'btn pri', '保存する'); b.type = 'button'; b.disabled = busy || !changed(r);
      b.addEventListener('click', function () { save(r); });
      form.appendChild(b);
      li.appendChild(form);
      if (r.role && r.seenRole && r.role !== r.seenRole) li.appendChild(el('p', 'dv-wait', 'この端末が次にメニューを開いた時に「' + ROLE_NAME[r.role] + '」に変わります。'));
      ul.appendChild(li);
    });
  }
  function edit(r, v, keepFocus) {
    var lbl = String(v.label || '');
    if (v.role === r.role && lbl === r.label) delete edits[r.key]; else edits[r.key] = { role: v.role, label: lbl };
    if (keepFocus) {   // 打っている間は描き直さず、保存のボタンと印だけ合わせる（打った文字と位置を失わない）
      var li = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.dv-row') : null;
      if (li) { li.classList.toggle('chg', changed(r)); var b = li.querySelector('button'); if (b) b.disabled = busy || !changed(r); return; }
    }
    render();
  }

  async function load() {
    var r = await SUAuth.client().rpc('device_role_list');
    if (r.error) {
      if (missingFn(r.error)) { msg('データベースに「端末の用途」の仕組みがまだありません（移行 0081 の適用が必要です）。', 'warn'); rows = []; return false; }
      throw r.error;
    }
    if (!r.data || r.data.ok !== true || !Array.isArray(r.data.rows)) throw new Error('一覧の形が違います');
    rows = r.data.rows.map(cleanRow).filter(Boolean);
    return true;
  }
  async function save(r) {
    if (busy || !changed(r)) return;
    var c = cur(r), label = String(c.label || '').trim();
    if (label.length > LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) { msg(ERR.badlabel, 'ng'); return; }
    if (!c.role && r.role && !window.confirm('番号 ' + shortNo(r.key) + ' の端末の用途の決まりを外します（端末は今の用途のまま）。よろしいですか？')) return;
    busy = true; render(); msg('');
    try {
      var q = await SUAuth.client().rpc('device_role_set', { p_key: r.key, p_role: c.role || null, p_label: label, p_prev: r.updatedAt });
      if (q.error) throw q.error;
      if (!q.data || q.data.ok !== true) {
        var code = q.data && q.data.error;
        msg(ERR[code] || '保存できませんでした。', 'ng');
        if (code === 'conflict' || code === 'nokey') { delete edits[r.key]; await load(); }
        return;
      }
      delete edits[r.key];
      await load();
      msg('保存しました。番号 ' + shortNo(r.key) + ' の端末が次にメニューを開いた時から効きます。', 'ok');
    } catch (e) {
      note('保存', e); msg(friendly(e), 'ng');
    } finally {
      busy = false; render();
    }
  }
  function flagNote() {
    return fetch('su-backend.json', { cache: 'no-cache' }).then(function (x) { return x.ok ? x.json() : null; })
      .then(function (j) { return !!(j && j.supabase && j.supabase.device_role === true); }).catch(function () { return null; });
  }

  async function start() {
    if (!window.SUAuth) return;
    var me;
    try { me = await SUAuth.check(); } catch (e) { return; }
    if (!me || me.status !== SUAuth.STATUS.OK || me.role !== 'admin') return;   // 管理者（2段階認証まで）でなければ欄を出さない
    $('v-devices').hidden = false;
    try {
      var ok = await load();
      render();
      if (ok && (await flagNote()) === false) msg('いまは端末へ届ける仕組みのスイッチが切です。決めた用途は、スイッチが入った後に各端末がメニューを開いた時に届きます。', 'warn');
    } catch (e) { note('読み込み', e); msg(friendly(e), 'ng'); }
  }
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(edits).length) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
  try { start(); } catch (e) { note('起動', e); }
})();
