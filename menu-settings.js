/*
 * menu-settings.js — メニューの設定（menu-settings.html）の動き（2026-10-23 代表者の決定）。
 * 書けるかどうかはデータベース（menu_put・管理者＋2段階認証だけ）が決める。この画面は見せ方を整えるだけ。
 * ボタンの一覧は index.html の中の定義（#menuDef）を読む。並べ替え・非表示の当て方は su-menu.js（メニューと同じ部品）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ROLES = [['admin', '管理者'], ['office', '事務所'], ['field', '現場']];
  var def = null;          // index.html の定義
  var model = null;        // { secs:[{id, mk, title, officeOnly, tiles:[tile…]}], hide:{admin:{href:1}…} }
  var baseline = '';       // 読んだ時（保存した時）の設定の JSON。変更の有無を見る
  var updatedAt = null;    // 読んだ時の保存日時（menu_put に返す＝他の画面の保存を消さない）
  var busy = false;

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
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function friendly(err) {
    var code = err && err.code;
    var m = String(err && err.message || err || '');
    if (code === '42501' || /permission denied/i.test(m)) return 'この操作をする権限がありません。管理者として2段階認証まで済んでいるか確かめてください。';
    if (code === 'PGRST202' || /menu_(get|put)/.test(m)) return 'データベースにメニューの設定の仕組みがまだありません（移行 0020 の適用が必要です）。';
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return m || 'うまくいきませんでした。';
  }
  var ERR = {
    conflict: 'ほかの画面で先に保存されていました。画面を読み直してから、もう一度変えてください。',
    badshape: '設定の形が正しくありません。', badver: '設定の形が正しくありません。', badorder: '並びの形が正しくありません。',
    badhide: '表示の設定の形が正しくありません。', badsecs: '区分の並びの形が正しくありません。',
    badkey: 'ボタンのリンク先に使えない文字があります。', toolarge: '設定が大きすぎます。'
  };

  // ── 定義を読む（index.html の中の JSON。定義の正本は1つ）──
  async function loadDef() {
    var r = await fetch('index.html', { cache: 'no-store' });
    if (!r.ok) throw new Error('メニューの定義を読めませんでした（HTTP ' + r.status + '）。');
    var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    var j = JSON.parse(doc.getElementById('menuDef').textContent);
    if (!j || !Array.isArray(j.sections)) throw new Error('メニューの定義の形が違います。');
    return j;
  }

  // 定義＋保存済みの設定 → 画面で動かす形（並びは su-menu.js の arrange と同じ規則。非表示は役割ごとに持つ）
  function toModel(cfg) {
    var c = SUMenu.clean(cfg);
    var ordered = SUMenu.arrange(def, c ? { ver: 1, order: c.order, secs: c.secs } : null, null);
    var hide = {};
    ROLES.forEach(function (r) {
      hide[r[0]] = {};
      ((c && c.hide[r[0]]) || []).forEach(function (k) { if (!SUMenu.KEEP[k]) hide[r[0]][k] = 1; });
    });
    return {
      secs: ordered.sections.filter(function (s) { return s && Array.isArray(s.tiles); }).map(function (s) {
        return { id: s.id, mk: s.mk, title: s.title, officeOnly: !!s.officeOnly,
                 tiles: s.tiles.filter(function (t) { return t && typeof t.href === 'string' && t.href; }) };
      }),
      hide: hide
    };
  }
  // 画面の形 → 保存する設定（並びは全部書く。後から足したボタンは載らない＝メニューでは区分の末尾・全員に出る）
  function toConfig() {
    var order = {}, hide = {};
    model.secs.forEach(function (s) { order[s.id] = s.tiles.map(function (t) { return t.href; }); });
    ROLES.forEach(function (r) {
      var list = [];
      model.secs.forEach(function (s) { s.tiles.forEach(function (t) { if (model.hide[r[0]][t.href]) list.push(t.href); }); });
      hide[r[0]] = list;
    });
    return { ver: 1, secs: model.secs.map(function (s) { return s.id; }), order: order, hide: hide };
  }
  function dirty() { return JSON.stringify(toConfig()) !== baseline; }
  function refreshState() {
    var d = dirty();
    $('b-save').disabled = busy || !d;
    $('b-undo').disabled = busy || !d;
    $('b-reset').disabled = busy;
    $('state').textContent = d ? '保存していない変更があります。「保存する」を押すと各端末のメニューに反映されます。'
                               : 'まだ保存していない変更はありません。';
  }

  function moveBtn(label, dir, disabled, onClick, focusKey) {
    var b = el('button', 'btn sm mv', dir < 0 ? '↑' : '↓');
    b.type = 'button';
    b.setAttribute('aria-label', label + ' を' + (dir < 0 ? '上' : '下') + 'へ');
    b.setAttribute('data-focus', focusKey + (dir < 0 ? ':up' : ':down'));
    b.disabled = disabled || busy;
    b.addEventListener('click', onClick);
    return b;
  }
  function swap(arr, i, j) { var x = arr[i]; arr[i] = arr[j]; arr[j] = x; }

  function render(focusKey) {
    var box = $('secs');
    var frag = document.createDocumentFragment();
    model.secs.forEach(function (s, si) {
      var cd = el('section', 'cd ms-sec');
      var head = el('div', 'ms-head');
      var h2 = el('h2');
      var mk = el('span', 'mk', s.mk || ''); mk.setAttribute('aria-hidden', 'true');
      h2.appendChild(mk); h2.appendChild(document.createTextNode(s.title || s.id));
      head.appendChild(h2);
      if (s.officeOnly) head.appendChild(el('span', 'tag', '区分ごと現場端末では出ません'));
      var ops = el('div', 'ms-ops');
      ops.appendChild(moveBtn('区分「' + s.title + '」', -1, si === 0, function () { swap(model.secs, si, si - 1); render('sec:' + s.id + ':up'); }, 'sec:' + s.id));
      ops.appendChild(moveBtn('区分「' + s.title + '」', 1, si === model.secs.length - 1, function () { swap(model.secs, si, si + 1); render('sec:' + s.id + ':down'); }, 'sec:' + s.id));
      head.appendChild(ops);
      cd.appendChild(head);

      var ul = el('ul', 'ms-list');
      s.tiles.forEach(function (t, ti) {
        var li = el('li');
        var nmBox = el('div', 'ms-nm');
        var ic = el('span', 'ic', t.ic || ''); ic.setAttribute('aria-hidden', 'true');
        nmBox.appendChild(ic);
        var txt = el('div');
        txt.appendChild(el('div', 'nm', t.nm + (t.ext ? ' ↗' : '')));
        var tags = el('div', 'tags');
        if (t.officeOnly || s.officeOnly) tags.appendChild(el('span', 'tag', '現場端末では出ません'));
        if (SUMenu.KEEP[t.href]) tags.appendChild(el('span', 'tag me', '全員に出ます'));
        if (tags.children.length) txt.appendChild(tags);
        nmBox.appendChild(txt);
        li.appendChild(nmBox);

        var chk = el('div', 'ms-roles');
        chk.setAttribute('role', 'group');
        chk.setAttribute('aria-label', t.nm + ' を出す役割');
        ROLES.forEach(function (r) {
          var lb = el('label', 'ms-chk');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !model.hide[r[0]][t.href];
          cb.disabled = busy || !!SUMenu.KEEP[t.href];
          cb.addEventListener('change', function () {
            if (cb.checked) delete model.hide[r[0]][t.href]; else model.hide[r[0]][t.href] = 1;
            refreshState();
          });
          lb.appendChild(cb);
          lb.appendChild(document.createTextNode(r[1]));
          chk.appendChild(lb);
        });
        li.appendChild(chk);

        var mv = el('div', 'ms-ops');
        var key = 'tile:' + s.id + ':' + t.href;
        mv.appendChild(moveBtn(t.nm, -1, ti === 0, function () { swap(s.tiles, ti, ti - 1); render(key + ':up'); }, key));
        mv.appendChild(moveBtn(t.nm, 1, ti === s.tiles.length - 1, function () { swap(s.tiles, ti, ti + 1); render(key + ':down'); }, key));
        li.appendChild(mv);
        ul.appendChild(li);
      });
      cd.appendChild(ul);
      frag.appendChild(cd);
    });
    box.replaceChildren(frag);
    refreshState();
    if (focusKey) {
      // 動かしたボタンへ手元を戻す（端まで行って押せなくなった時は、反対向きのボタンへ）
      var all = box.querySelectorAll('button[data-focus]');
      var hit = null, alt = null, other = focusKey.replace(/:(up|down)$/, function (m, d) { return d === 'up' ? ':down' : ':up'; });
      for (var i = 0; i < all.length; i++) {
        var f = all[i].getAttribute('data-focus');
        if (f === focusKey) hit = all[i];
        if (f === other) alt = all[i];
      }
      var target = (hit && !hit.disabled) ? hit : alt;
      if (target) target.focus();
    }
  }

  async function save(cfg, label) {
    busy = true; render(); msg('');
    var r;
    try {
      r = await SUAuth.client().rpc('menu_put', { p_config: cfg, p_prev: updatedAt });
    } catch (e) { r = { error: e }; }
    busy = false;
    if (r.error) { render(); msg(friendly(r.error)); return; }
    var d = r.data || {};
    if (d.ok !== true) {
      render();
      msg(ERR[d.error] || ('保存できませんでした（' + (d.error || '理由不明') + '）。'));
      if (d.error === 'conflict' && confirm(ERR.conflict + '\n\n今すぐ読み直しますか？（この画面の変更は消えます）')) {
        window.removeEventListener('beforeunload', guard);
        location.reload();
      }
      return;
    }
    updatedAt = d.updatedAt;
    model = toModel(cfg);
    baseline = JSON.stringify(toConfig());
    render();
    msg(label, 'ok');
  }

  $('b-save').addEventListener('click', function () {
    if (!dirty()) return;
    save(toConfig(), '保存しました。各端末でメニューを開き直すと反映されます。');
  });
  $('b-undo').addEventListener('click', function () {
    if (!confirm('保存していない変更を取り消して、保存されている設定に戻しますか？')) return;
    model = toModel(JSON.parse(baseline));
    render(); msg('');
  });
  $('b-reset').addEventListener('click', function () {
    if (!confirm('メニューを既定の並びに戻し、すべての役割に全部のボタンを出しますか？\n\n保存されている並び・非表示の設定は消えます。')) return;
    save(null, '既定に戻しました。各端末でメニューを開き直すと反映されます。');
  });

  function guard(e) { if (model && dirty()) { e.preventDefault(); e.returnValue = ''; } }
  window.addEventListener('beforeunload', guard);

  async function start() {
    view('loading');
    var me;
    try { me = await SUAuth.check(); } catch (e) { me = { status: 'error', message: String(e && e.message || e) }; }
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
      def = await loadDef();
      var r = await SUAuth.client().rpc('menu_get');
      if (r.error) throw r.error;
      if (!r.data || r.data.ok !== true) throw new Error('メニューの設定を読めませんでした。');
      updatedAt = r.data.updatedAt || null;
      model = toModel(r.data.config);
      baseline = JSON.stringify(toConfig());
      render();
      view('admin');
    } catch (e) {
      $('gate-why').textContent = friendly(e);
      view('gate');
    }
  }
  start();
})();
