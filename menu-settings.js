/*
 * menu-settings.js — メニューの設定（menu-settings.html）の動き（2026-10-23 代表者の決定）。
 * 書けるかどうかはデータベース（menu_put・管理者＋2段階認証だけ）が決める。この画面は見せ方を整えるだけ。
 * ボタンの一覧は index.html の中の定義（#menuDef）を読む。並べ替え・非表示の当て方は su-menu.js（メニューと同じ部品）。
 * 区分の作成・名前と絵文字の変更・削除・ボタンを別の区分へ移す（2026-10-26 本人指示）。保存には移行 0023 が要る。
 *   0023 の前でも、区分に触らない変更（並び・非表示）は今までどおり保存できる（sdef・gone・mv は空なら設定に書かない）。
 * メニューの毬の柄（施設の既定・2026-10-26 代表者の決定）。保存には移行 0025 が要る。
 *   画面の中では柄を持っておき（toModel で読む）、保存の時は麻の葉の時だけ ball:'asanoha' を書く（菊かがりは書かない＝無い時は菊かがり）。
 *   麻の葉にした後でほかの設定だけ直して保存しても、柄は消えない。0025 の前でも菊かがりのままなら今までどおり保存できる。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ROLES = [['admin', '管理者'], ['office', '事務所'], ['field', '現場']];
  var def = null;          // index.html の定義
  var model = null;        // { secs:[{id, mk, title, officeOnly, custom, tiles:[tile…]}], hide:{admin:{href:1}…}, ball:'kiku'|'asanoha' }
  var defSec = {};         // 最初からある区分 id → {mk, title, officeOnly}
  var homeOf = {};         // ボタンの鍵 → 既定の区分 id
  var editing = null;      // 名前を変えている区分の id
  var MAX_SECS = 30;
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
    badkey: 'ボタンのリンク先に使えない文字があります。', toolarge: '設定が大きすぎます。',
    badsdef: '区分の名前・絵文字の形が正しくありません（名前は1〜20字・絵文字は8字まで）。', badgone: '消した区分の形が正しくありません。',
    badmv: 'ボタンの移し先の形が正しくありません。',
    badball: 'メニューの毬の柄の形が正しくありません。「菊かがり」か「麻の葉」を選び直してから、もう一度保存してください。'
  };
  var NEED_0025 = 'メニューの毬の柄を「麻の葉」にして保存するには、データベースの更新（移行 0025）が必要です。毬の柄を「菊かがり」に戻すと、ほかの変更は保存できます。';
  var NEED_0023 = '区分の追加・名前の変更・削除・ボタンの移動を保存するには、データベースの更新（移行 0023）が必要です。区分を変えた設定が残っている間は、並び・表示の変更も保存できません。その時は区分の変更を元に戻すか、「既定に戻す」を押してください。';

  // ── 定義を読む（index.html の中の JSON。定義の正本は1つ）──
  async function loadDef() {
    var r = await fetch('index.html', { cache: 'no-store' });
    if (!r.ok) throw new Error('メニューの定義を読めませんでした（HTTP ' + r.status + '）。');
    var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    var j = JSON.parse(doc.getElementById('menuDef').textContent);
    if (!j || !Array.isArray(j.sections)) throw new Error('メニューの定義の形が違います。');
    defSec = {}; homeOf = {};
    j.sections.forEach(function (s) {
      if (!s || typeof s.id !== 'string' || !Array.isArray(s.tiles)) return;
      defSec[s.id] = { mk: s.mk || '', title: s.title || s.id, officeOnly: !!s.officeOnly };
      s.tiles.forEach(function (t) { if (t && typeof t.href === 'string' && !(t.href in homeOf)) homeOf[t.href] = s.id; });
    });
    return j;
  }

  // 定義＋保存済みの設定 → 画面で動かす形（配置は su-menu.js の layout と同じ規則＝メニューと同じ。非表示は役割ごとに持つ）
  function toModel(cfg) {
    var c = SUMenu.clean(cfg) || SUMenu.clean({ ver: 1 });
    var hide = {};
    ROLES.forEach(function (r) {
      hide[r[0]] = {};
      (c.hide[r[0]] || []).forEach(function (k) { if (!SUMenu.KEEP[k]) hide[r[0]][k] = 1; });
    });
    return {
      secs: SUMenu.layout(def, c).filter(function (s) { return s && typeof s.id === 'string' && Array.isArray(s.tiles); }).map(function (s) {
        return { id: s.id, mk: s.mk || '', title: s.title || s.id, officeOnly: !!s.officeOnly, custom: !defSec[s.id],
                 tiles: s.tiles.filter(function (t) { return t && typeof t.href === 'string' && t.href; }) };
      }),
      hide: hide,
      ball: c.ball === 'asanoha' ? 'asanoha' : 'kiku'
    };
  }
  // 画面の形 → 保存する設定（並びは全部書く。後から足したボタンは載らない＝メニューでは区分の末尾・全員に出る）
  // 区分の名前（sdef）・消した区分（gone）・移し先（mv）は、ある時だけ書く（移行 0023 の前でも並び・非表示を保存できるように）
  function toConfig() {
    var order = {}, hide = {}, sdef = {}, mv = {}, gone = [], here = {};
    model.secs.forEach(function (s) {
      here[s.id] = 1;
      order[s.id] = s.tiles.map(function (t) { return t.href; });
      var d = defSec[s.id];
      if (!d || d.mk !== s.mk || d.title !== s.title) sdef[s.id] = { mk: s.mk, title: s.title };
      s.tiles.forEach(function (t) { if (homeOf[t.href] && homeOf[t.href] !== s.id) mv[t.href] = s.id; });
    });
    Object.keys(defSec).forEach(function (id) { if (!here[id]) gone.push(id); });
    ROLES.forEach(function (r) {
      var list = [];
      model.secs.forEach(function (s) { s.tiles.forEach(function (t) { if (model.hide[r[0]][t.href]) list.push(t.href); }); });
      hide[r[0]] = list;
    });
    var cfg = { ver: 1, secs: model.secs.map(function (s) { return s.id; }), order: order, hide: hide };
    if (Object.keys(sdef).length) cfg.sdef = sdef;
    if (gone.length) cfg.gone = gone;
    if (Object.keys(mv).length) cfg.mv = mv;
    if (model.ball === 'asanoha') cfg.ball = 'asanoha';   // 菊かがりは書かない（無い＝菊かがり・0025 の前でも保存できる）
    return cfg;
  }
  function needs0023(cfg) { return !!(cfg && (cfg.sdef || cfg.gone || cfg.mv)); }
  // 区分の名前・絵文字の形（データベースの検査と同じ: 名前1〜20字・絵文字8字まで・制御文字なし。字数はコードポイントで数える）
  function textLen(t) { return Array.from(String(t)).length; }
  function badText(t) { return /[\u0000-\u001f\u007f-\u009f]/.test(t); }
  function newSecId() {
    var id;
    do { id = 'c-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
    while (model.secs.some(function (s) { return s.id === id; }) || defSec[id]);
    return id;
  }
  // この区分にボタンが残っている時は消せない（消すとボタンがメニューから消えるため。先に別の区分へ移す）
  function removeSec(si) {
    var s = model.secs[si];
    if (s.tiles.length) return;
    if (!confirm('区分「' + label(s.title) + '」を消しますか？\n\n「保存する」を押すまでは、各端末のメニューは変わりません。')) return;
    model.secs.splice(si, 1);
    if (editing === s.id) editing = null;
    var next = model.secs[Math.min(si, model.secs.length - 1)];
    render(next ? 'sec:' + next.id + ':edit' : 'add');
  }
  function moveTile(fromSi, ti, toId) {
    var from = model.secs[fromSi], to = null;
    model.secs.forEach(function (s) { if (s.id === toId) to = s; });
    if (!to || to === from) return;
    var t = from.tiles.splice(ti, 1)[0];
    to.tiles.push(t);
    render('move:' + t.href);   // 手元（キーボードの位置）は移した先の区分の欄へ付いていく＝画面もそこへ動く
  }
  // ボタンが現場端末で出ないか（ボタン自身・既定の区分・今の区分のどれかが事務所専用なら出ない＝メニューと同じ）
  function officeOnlyTile(t, s) {
    var home = defSec[homeOf[t.href]];
    return !!(t.officeOnly || (home && home.officeOnly) || s.officeOnly);
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
  // 名前の {{通所}} などを施設情報の事業所名に（メニューと同じ・読めない時は一般名）
  function label(t) {
    var s = String(t || '');
    try { if (window.SUFacility && SUFacility.fill) return SUFacility.fill(s); } catch (e) { /* 一般名のまま */ }
    return s.replace(/\{\{(施設名|施設|訪問|通所)\}\}/g, function (a, k) { return { '施設名': '施設', '施設': '施設', '訪問': '訪問介護', '通所': '通所介護' }[k]; });
  }
  function swap(arr, i, j) { var x = arr[i]; arr[i] = arr[j]; arr[j] = x; }

  // 区分の名前・絵文字を変える欄（「決める」で画面の中だけ変わる。各端末へは「保存する」で届く）
  function editForm(s) {
    var f = el('div', 'ms-edit');
    var d = defSec[s.id];
    var lt = el('label', 'ms-field');
    lt.appendChild(el('span', null, '名前（20字まで）'));
    var it = document.createElement('input');
    it.type = 'text'; it.value = label(s.title); it.maxLength = 40; it.autocomplete = 'off';
    it.setAttribute('data-focus', 'sec:' + s.id + ':title');
    lt.appendChild(it);
    var lm = el('label', 'ms-field mk');
    lm.appendChild(el('span', null, '絵文字（なくてもよい）'));
    var im = document.createElement('input');
    im.type = 'text'; im.value = s.mk || ''; im.maxLength = 16; im.autocomplete = 'off';
    lm.appendChild(im);
    var err = el('p', 'ms-err');
    err.setAttribute('role', 'alert');
    var acts = el('div', 'acts');
    var ok = el('button', 'btn pri sm', '決める');
    ok.type = 'button';
    ok.addEventListener('click', function () {
      var title = it.value.trim(), mk = im.value.trim();
      if (!title) { err.textContent = '名前を入れてください。'; it.focus(); return; }
      if (textLen(title) > 20 || badText(title)) { err.textContent = '名前は20字までにしてください（改行などは使えません）。'; it.focus(); return; }
      if (textLen(mk) > 8 || badText(mk)) { err.textContent = '絵文字は8字までにしてください。'; im.focus(); return; }
      // 名前を変えていない時は今の書き方（{{通所}} など）のまま。最初からある区分で既定と同じ名前を入れた時は既定の書き方に戻す＝上書きしない
      if (title !== label(s.title)) s.title = (d && title === label(d.title)) ? d.title : title;
      else if (textLen(s.title) > 20) s.title = title;
      s.mk = mk;
      editing = null;
      render('sec:' + s.id + ':edit');
    });
    var ng = el('button', 'btn sm', 'やめる');
    ng.type = 'button';
    ng.addEventListener('click', function () { editing = null; render('sec:' + s.id + ':edit'); });
    acts.appendChild(ok); acts.appendChild(ng);
    if (d && (d.title !== s.title || d.mk !== s.mk)) {
      var rb = el('button', 'btn sm', '最初の名前に戻す');
      rb.type = 'button';
      rb.addEventListener('click', function () { s.title = d.title; s.mk = d.mk; editing = null; render('sec:' + s.id + ':edit'); });
      acts.appendChild(rb);
    }
    [it, im].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok.click(); }
        if (e.key === 'Escape') { e.preventDefault(); ng.click(); }
      });
    });
    f.appendChild(lt); f.appendChild(lm); f.appendChild(err); f.appendChild(acts);
    return f;
  }

  function render(focusKey) {
    var box = $('secs');
    var frag = document.createDocumentFragment();
    model.secs.forEach(function (s, si) {
      var cd = el('section', 'cd ms-sec');
      var head = el('div', 'ms-head');
      var h2 = el('h2');
      var mk = el('span', 'mk', s.mk || ''); mk.setAttribute('aria-hidden', 'true');
      h2.appendChild(mk); h2.appendChild(document.createTextNode(label(s.title) || s.id));
      head.appendChild(h2);
      if (s.officeOnly) head.appendChild(el('span', 'tag', '区分ごと現場端末では出ません'));
      if (s.custom) head.appendChild(el('span', 'tag me', '追加した区分'));
      var ops = el('div', 'ms-ops');
      var nm = label(s.title);
      ops.appendChild(moveBtn('区分「' + nm + '」', -1, si === 0, function () { swap(model.secs, si, si - 1); render('sec:' + s.id + ':up'); }, 'sec:' + s.id));
      ops.appendChild(moveBtn('区分「' + nm + '」', 1, si === model.secs.length - 1, function () { swap(model.secs, si, si + 1); render('sec:' + s.id + ':down'); }, 'sec:' + s.id));
      var eb = el('button', 'btn sm', '名前を変える');
      eb.type = 'button';
      eb.setAttribute('aria-label', '区分「' + nm + '」の名前と絵文字を変える');
      eb.setAttribute('aria-expanded', editing === s.id ? 'true' : 'false');
      eb.setAttribute('data-focus', 'sec:' + s.id + ':edit');
      eb.disabled = busy;
      eb.addEventListener('click', function () { editing = editing === s.id ? null : s.id; render(editing ? 'sec:' + s.id + ':title' : 'sec:' + s.id + ':edit'); });
      ops.appendChild(eb);
      var db = el('button', 'btn sm ng', '消す');
      db.type = 'button';
      db.setAttribute('aria-label', '区分「' + nm + '」を消す');
      db.setAttribute('data-focus', 'sec:' + s.id + ':del');
      db.disabled = busy || s.tiles.length > 0 || model.secs.length <= 1;
      db.addEventListener('click', function () { removeSec(si); });
      ops.appendChild(db);
      head.appendChild(ops);
      cd.appendChild(head);
      if (!s.tiles.length) {
        cd.appendChild(el('p', 'muted ms-hint', 'ボタンが無い区分はメニューに出ません。ほかの区分のボタンの「区分」の欄でここを選ぶと移せます。'));
      }
      if (editing === s.id) cd.appendChild(editForm(s));

      var ul = el('ul', 'ms-list');
      s.tiles.forEach(function (t, ti) {
        var li = el('li');
        var nmBox = el('div', 'ms-nm');
        var ic = el('span', 'ic', t.ic || ''); ic.setAttribute('aria-hidden', 'true');
        nmBox.appendChild(ic);
        var txt = el('div');
        txt.appendChild(el('div', 'nm', label(t.nm) + (t.ext ? ' ↗' : '')));
        var tags = el('div', 'tags');
        if (officeOnlyTile(t, s)) tags.appendChild(el('span', 'tag', '現場端末では出ません'));
        if (homeOf[t.href] && homeOf[t.href] !== s.id) tags.appendChild(el('span', 'tag me', '移したボタン'));
        if (SUMenu.KEEP[t.href]) tags.appendChild(el('span', 'tag me', '全員に出ます'));
        if (tags.children.length) txt.appendChild(tags);
        nmBox.appendChild(txt);
        li.appendChild(nmBox);

        var chk = el('div', 'ms-roles');
        chk.setAttribute('role', 'group');
        chk.setAttribute('aria-label', label(t.nm) + ' を出す役割');
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

        var sel = el('label', 'ms-to');
        sel.appendChild(el('span', null, '区分'));
        var dd = document.createElement('select');
        dd.setAttribute('aria-label', label(t.nm) + ' を置く区分');
        dd.setAttribute('data-focus', 'move:' + t.href);
        dd.disabled = busy || model.secs.length <= 1;
        model.secs.forEach(function (o) {
          // 隠せないボタン（使い方・困った時）は事務所専用の区分へ移せない（現場端末から消えないように・メニューの側も移さない）
          if (SUMenu.KEEP[t.href] && o.officeOnly && o.id !== s.id) return;
          var op = el('option', null, label(o.title) || o.id);
          op.value = o.id;
          if (o.id === s.id) op.selected = true;
          dd.appendChild(op);
        });
        dd.addEventListener('change', function () { moveTile(si, ti, dd.value); });
        sel.appendChild(dd);
        li.appendChild(sel);

        var mv = el('div', 'ms-ops');
        var key = 'tile:' + s.id + ':' + t.href;
        mv.appendChild(moveBtn(label(t.nm), -1, ti === 0, function () { swap(s.tiles, ti, ti - 1); render(key + ':up'); }, key));
        mv.appendChild(moveBtn(label(t.nm), 1, ti === s.tiles.length - 1, function () { swap(s.tiles, ti, ti + 1); render(key + ':down'); }, key));
        li.appendChild(mv);
        ul.appendChild(li);
      });
      cd.appendChild(ul);
      frag.appendChild(cd);
    });
    var add = el('section', 'cd ms-add');
    var ab = el('button', 'btn', '＋ 区分を追加');
    ab.type = 'button';
    ab.setAttribute('data-focus', 'add');
    ab.disabled = busy || model.secs.length >= MAX_SECS;
    ab.addEventListener('click', function () {
      var id = newSecId();
      model.secs.push({ id: id, mk: '', title: '新しい区分', officeOnly: false, custom: true, tiles: [] });
      editing = id;
      render('sec:' + id + ':title');
    });
    add.appendChild(ab);
    if (model.secs.length >= MAX_SECS) add.appendChild(el('p', 'muted', '区分は' + MAX_SECS + 'までです。'));
    frag.appendChild(add);
    box.replaceChildren(frag);
    syncBall();
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
      if (!hit) hit = box.querySelector('[data-focus="' + (window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey) + '"]');
      var target = (hit && !hit.disabled) ? hit : alt;
      if (target) { target.focus(); if (target.select && target.tagName === 'INPUT') target.select(); }
    }
  }

  // メニューの毬の柄（施設の既定）。選択は画面の中の model.ball だけを変え、各端末へは「保存する」で届く
  function ballRadios() { return document.querySelectorAll('#ball-card input[name="ball"]'); }
  function syncBall() {
    var rs = ballRadios();
    for (var i = 0; i < rs.length; i++) { rs[i].checked = !!model && rs[i].value === model.ball; rs[i].disabled = busy; }
  }
  (function () {
    var rs = ballRadios();
    for (var i = 0; i < rs.length; i++) rs[i].addEventListener('change', function (e) {
      if (!model || !e.target.checked || (e.target.value !== 'kiku' && e.target.value !== 'asanoha')) return;
      model.ball = e.target.value;
      refreshState();
    });
  })();
  // 見本（完成した毬・メニューの見出しと同じ小さい描き方）。部品（su-itomari.js）が無い・描けない時は見本なしで選べる
  function drawBallPreviews() {
    try {
      if (!window.SUItomari || !def) return;
      var all = [];
      def.sections.forEach(function (s) {
        if (!s || typeof s.id !== 'string' || !Array.isArray(s.tiles) || s.id === 'sec-setup' || s.id === 'sec-help') return;
        s.tiles.forEach(function (t) { if (t && typeof t.href === 'string' && t.href && homeOf[t.href] === s.id && all.indexOf(t.href) < 0) all.push(t.href); });
      });
      var pv = document.querySelectorAll('#ball-card .ms-ball-pv');
      for (var i = 0; i < pv.length; i++) {
        var svg = SUItomari.render({ kind: pv[i].getAttribute('data-ball'), small: true, shown: all, all: all, px: 56 });
        if (svg) pv[i].replaceChildren(svg);
      }
    } catch (e) {
      try { if (window.SUErrors && SUErrors.note) SUErrors.note('メニューの毬', e, 'menu-settings.js'); } catch (e2) { /* 見本なしで選べる */ }
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
      // 0025 の前の menu_put は ball のキーを badshape で断る（0023 の区分のキーと同じ書き方）
      msg((d.error === 'badshape' && cfg && cfg.ball) ? NEED_0025
        : (d.error === 'badshape' && needs0023(cfg)) ? NEED_0023 : (ERR[d.error] || ('保存できませんでした（' + (d.error || '理由不明') + '）。')));
      if (d.error === 'conflict' && confirm(ERR.conflict + '\n\n今すぐ読み直しますか？（この画面の変更は消えます）')) {
        window.removeEventListener('beforeunload', guard);
        location.reload();
      }
      return;
    }
    updatedAt = d.updatedAt;
    editing = null;
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
    editing = null;
    model = toModel(JSON.parse(baseline));
    render(); msg('');
  });
  $('b-reset').addEventListener('click', function () {
    if (!confirm('メニューを既定の並びに戻し、すべての役割に全部のボタンを出しますか？\n\n保存されている並び・非表示・区分の名前・追加した区分・ボタンの移動・毬の柄（施設の既定）の設定は消えます。')) return;
    save(null, '既定に戻しました。各端末でメニューを開き直すと反映されます。');
  });

  function guard(e) { if (model && dirty()) { e.preventDefault(); e.returnValue = ''; } }
  window.addEventListener('beforeunload', guard);

  async function start() {
    view('loading');
    // ログインの部品（supabase-js・su-auth.js・su-menu.js）を読み込めなかった時も「確かめています…」で止めない
    if (!window.SUAuth || !window.SUMenu) {
      $('gate-why').textContent = '画面の部品を読み込めませんでした。電波・Wi-Fi を確かめてから、読み込み直してください。';
      view('gate');
      return;
    }
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
      drawBallPreviews();
      view('admin');
      // 施設情報が後から届いたら名前を差し替えて描き直す（入力中の変更は model に残っているので消えない）
      try { if (window.SUFacility && SUFacility.onReady) SUFacility.onReady(function () { if (model) render(); }); } catch (e) { /* 一般名のまま */ }
    } catch (e) {
      $('gate-why').textContent = friendly(e);
      view('gate');
    }
  }
  start().catch(function (e) {
    $('gate-why').textContent = friendly(e);
    view('gate');
  });
})();
