/*
 * app-access.js — アプリの使える人（app-access.html）の動き（2026-10-29 本人指示・代表者の決定）。
 * 書けるかどうかはデータベース（app_access_put・管理者＋2段階認証だけ）が決める。この画面は見せ方を整えるだけ。
 * アプリの一覧・既定・開けるかの計算は su-app-gate.js（各アプリが開く時に使うのと同じ部品）。
 * 設定の形（0033）: {ver:1, role:{アプリ:{office:真偽, field:真偽}}, acct:{メールアドレス:{アプリ:真偽}}}
 * 0033 がまだ無い時は、既定の決まりで表を出し、変える・保存するボタンは止める（何が要るかを帯で出す）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var G = window.SUAppGate;
  var ROLE = G.ROLE_LABEL;
  var EDIT_ROLES = ['office', 'field'];
  var FILTER_KEY = 'aac_filter';
  var FILTERS = ['all', 'admin', 'office', 'field'];

  var me = null;
  var accounts = [];        // [{email, label, role, is_active}]
  var cfg = null;           // 画面で動かしている設定 {role:{}, acct:{}}
  var baseline = '';        // 読んだ時（保存した時）の設定の JSON
  var baseCfg = null;       // 読んだ時の設定（未保存の印を付けるため）
  var updatedAt = null;
  var menuHide = {};        // {role: {href: true}}（メニューの設定で隠しているボタン）
  var canWrite = false;     // 0033 があり、全部を読めた時だけ
  var busy = false;
  var filter = 'all';
  var picking = null;       // 開いている選びの窓の対象 {kind:'role'|'acct', key, role?, email?}

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
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isBool(v) { return v === true || v === false; }
  function friendly(err) {
    var code = err && err.code;
    var m = String(err && err.message || err || '');
    if (code === '42501' || /permission denied/i.test(m)) return 'この操作をする権限がありません。管理者として2段階認証まで済んでいるか確かめてください。';
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return m || 'うまくいきませんでした。';
  }
  function missingFn(err) {
    var m = String(err && err.message || '');
    return !!err && (err.code === 'PGRST202' || /could not find the function/i.test(m));
  }
  var ERR = {
    conflict: 'ほかの画面で先に保存されていました。ページを読み込み直してから、もう一度変えてください（いまの変更は消えます）。',
    badshape: '設定の形が正しくありません。', badver: '設定の形が正しくありません。',
    badrole: '役割の決まりの形が正しくありません。', badacct: '人ごとの決まりの形が正しくありません。',
    noacct: '使える人の一覧に無いアカウントの決まりが入っています。画面を読み直してから、もう一度変えてください。',
    toolarge: '決まりが多すぎて保存できません。'
  };

  // ── 設定の掃除（形の違う所は捨てる・一覧に無いアプリ・人は捨てる）──
  function cleanCfg(c) {
    var out = { role: {}, acct: {} };
    if (!isObj(c) || c.ver !== 1) return out;
    var known = {}; G.APPS.forEach(function (a) { known[a.key] = 1; });
    /* 管理者の人の決まりは持たない（表で変えられない＝見えないまま効かせない。2段階認証の前は事務所として扱われるため・反証レビューの指摘） */
    var emails = {}; accounts.forEach(function (a) { if (a.role !== 'admin') emails[a.email] = 1; });
    if (isObj(c.role)) Object.keys(c.role).forEach(function (k) {
      if (!known[k] || !isObj(c.role[k])) return;
      EDIT_ROLES.forEach(function (r) { if (isBool(c.role[k][r])) { out.role[k] = out.role[k] || {}; out.role[k][r] = c.role[k][r]; } });
    });
    if (isObj(c.acct)) Object.keys(c.acct).forEach(function (e) {
      if (!emails[e] || !isObj(c.acct[e])) return;
      Object.keys(c.acct[e]).forEach(function (k) {
        if (known[k] && isBool(c.acct[e][k])) { out.acct[e] = out.acct[e] || {}; out.acct[e][k] = c.acct[e][k]; }
      });
    });
    return out;
  }
  function toSave(c) {
    var o = { ver: 1 };
    if (Object.keys(c.role).length) o.role = c.role;
    var acct = {};
    Object.keys(c.acct).forEach(function (e) { if (Object.keys(c.acct[e]).length) acct[e] = c.acct[e]; });
    if (Object.keys(acct).length) o.acct = acct;
    return o;
  }
  function stable(o) {
    if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
    if (isObj(o)) return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }
  function dirty() { return !!cfg && stable(toSave(cfg)) !== baseline; }
  function roleRule(c, key, role) { return c && isObj(c.role[key]) && isBool(c.role[key][role]) ? c.role[key][role] : null; }
  function acctRule(c, email, key) { return c && isObj(c.acct[email]) && isBool(c.acct[email][key]) ? c.acct[email][key] : null; }
  function cellChanged(kind, key, who) {
    if (!baseCfg) return false;
    return kind === 'role' ? roleRule(cfg, key, who) !== roleRule(baseCfg, key, who) : acctRule(cfg, who, key) !== acctRule(baseCfg, who, key);
  }

  // ── 読む ──
  async function load() {
    var ra = await SUAuth.client().from('allowed_accounts').select('email,role,is_active,label')
      .order('role', { ascending: true }).order('email', { ascending: true });
    if (ra.error) throw ra.error;
    accounts = (ra.data || []).filter(function (a) { return a && typeof a.email === 'string' && ROLE[a.role]; });

    var c = null; canWrite = true; updatedAt = null;
    var rg = await SUAuth.client().rpc('app_access_get');
    if (rg.error) {
      if (!missingFn(rg.error)) throw rg.error;
      canWrite = false;
      msg('データベースに「アプリの使える人」の仕組みがまだありません（移行 0033 の適用が必要です）。表は既定の決まりで出しています。変える・保存するのは、適用の後にできます。', 'warn');
    } else if (!rg.data || rg.data.ok !== true) {
      throw new Error('決まりを読めませんでした。');
    } else {
      c = rg.data.config; updatedAt = rg.data.updatedAt || null;
    }
    cfg = cleanCfg(c);
    baseCfg = JSON.parse(JSON.stringify(cfg));
    baseline = stable(toSave(cfg));

    menuHide = {};
    try {
      var rm = await SUAuth.client().rpc('menu_get');
      var mc = !rm.error && rm.data && rm.data.ok ? SUMenu.clean(rm.data.config) : null;
      if (mc && mc.hide) Object.keys(mc.hide).forEach(function (r) {
        menuHide[r] = {}; mc.hide[r].forEach(function (h) { menuHide[r][h] = true; });
      });
    } catch (e) { /* メニューの印が出せないだけ（表は出す） */ }
  }

  // ── 表 ──
  function stateOf(kind, key, who) {
    // who: 役割の行なら役割、人の行ならアカウント
    if (kind === 'role') return G.effective(key, who, cfg.role, null);
    var a = who;
    var acct = cfg.acct[a.email] || null;
    return G.effective(key, a.role, cfg.role, acct);
  }
  function countAllowed(key) {
    var n = 0, all = 0;
    accounts.forEach(function (a) {
      if (!a.is_active) return;
      all++;
      if (stateOf('acct', key, a).allow) n++;
    });
    return { n: n, all: all };
  }
  function cellBtn(kind, app, who) {
    var st, locked = false, label, changed;
    if (kind === 'role') { st = stateOf('role', app.key, who); locked = who === 'admin'; changed = !locked && cellChanged('role', app.key, who); }
    else { st = stateOf('acct', app.key, who); locked = who.role === 'admin'; changed = !locked && cellChanged('acct', app.key, who.email); }
    var b = el('button', 'cell ' + (st.allow ? 'ok' : 'ng') + (locked ? ' lock' : '') + (changed ? ' chg' : '') + (st.src === 'acct' ? ' own' : ''));
    b.type = 'button';
    b.appendChild(el('span', 'mk', locked ? '🔒' : (st.allow ? '✓' : '✕')));
    b.appendChild(el('span', 't', st.allow ? '開ける' : '開けない'));
    var tags = [];
    if (st.src === 'acct') tags.push(['own', 'この人だけ']);
    if (kind === 'role' && st.src === 'default' && !locked) tags.push(['dflt', '既定']);
    if (kind === 'role' && menuHide[who] && menuHide[who][app.href]) tags.push(['menu', 'メニューに出ない']);
    if (changed) tags.push(['chg', '未保存']);
    tags.forEach(function (t) { b.appendChild(el('span', 'bdg ' + t[0], t[1])); });
    var whoName = kind === 'role' ? ROLE[who] + 'の決まり' : (who.label || who.email) + '（' + ROLE[who.role] + '）';
    label = whoName + '・' + app.nm + '：' + (st.allow ? '開ける' : '開けない') +
      (locked ? '（管理者は常に開ける・変えられない）' : (st.src === 'acct' ? '（この人だけの決まり）' : (st.src === 'default' ? '（既定）' : (kind === 'role' ? '' : '（役割の決まりどおり）')))) +
      (changed ? '・未保存' : '');
    b.setAttribute('aria-label', label);
    if (locked || !canWrite) { b.disabled = true; if (!locked) b.title = '移行 0033 の適用の後に変えられます'; }
    else b.addEventListener('click', function () { openPick(kind, app, who); });
    return b;
  }
  function render() {
    var t = $('mx');
    t.textContent = '';
    var thead = el('thead'), hr = el('tr');
    var corner = el('th', 'whoc', '人 ＼ アプリ'); corner.scope = 'col';
    hr.appendChild(corner);
    G.APPS.forEach(function (a) {
      var th = el('th', 'app'); th.scope = 'col';
      th.appendChild(el('span', 'ic', a.ic));
      th.appendChild(el('span', 'nm', a.nm));
      var c = countAllowed(a.key);
      var cnt = el('span', 'cnt', '開ける ' + c.n + '／' + c.all + '人');
      cnt.setAttribute('aria-label', '使える人 ' + c.all + '人のうち ' + c.n + '人が開ける');
      th.appendChild(cnt);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);

    // 役割の決まり
    var tb = el('tbody', 'grp-role');
    tb.appendChild(groupRow('役割の決まり（その役割の人の基本）', 'g-role'));
    ['admin', 'office', 'field'].forEach(function (r) {
      if (filter !== 'all' && filter !== r) return;
      var tr = el('tr', 'r-role');
      var th = el('th', 'whoc'); th.scope = 'row';
      th.appendChild(el('span', 'pill ' + r, ROLE[r]));
      th.appendChild(el('span', 'sub', r === 'admin' ? '2段階認証を済ませると常に開ける' : 'の人の基本'));
      tr.appendChild(th);
      G.APPS.forEach(function (a) { var td = el('td'); td.appendChild(cellBtn('role', a, r)); tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);

    // 人（役割ごと）
    ['admin', 'office', 'field'].forEach(function (r) {
      if (filter !== 'all' && filter !== r) return;
      var list = accounts.filter(function (a) { return a.is_active && a.role === r; });
      var b = el('tbody', 'grp-acct');
      b.appendChild(groupRow(ROLE[r] + '　' + list.length + '人', 'g-' + r));
      if (!list.length) {
        var er = el('tr', 'r-empty'); var td0 = el('td', 'muted', 'この役割の人はいません。'); td0.colSpan = G.APPS.length + 1; er.appendChild(td0); b.appendChild(er);
      }
      list.forEach(function (a) { b.appendChild(personRow(a)); });
      t.appendChild(b);
    });

    // 止めた人
    var off = accounts.filter(function (a) { return !a.is_active && (filter === 'all' || filter === a.role); });
    if (off.length) {
      var bo = el('tbody', 'grp-off');
      bo.appendChild(groupRow('停止中　' + off.length + '人（ログインしても何も開けません）', 'g-off'));
      off.forEach(function (a) {
        var tr = el('tr', 'r-off');
        tr.appendChild(whoCell(a));
        G.APPS.forEach(function () { var td = el('td'); td.appendChild(el('span', 'cell off', '停止中')); tr.appendChild(td); });
        bo.appendChild(tr);
      });
      t.appendChild(bo);
    }
    paintState();
  }
  function groupRow(text, cls) {
    var tr = el('tr', 'gh ' + cls);
    var th = el('th', null, text); th.scope = 'colgroup'; th.colSpan = G.APPS.length + 1;
    tr.appendChild(th);
    return tr;
  }
  function whoCell(a) {
    var th = el('th', 'whoc'); th.scope = 'row';
    th.appendChild(el('span', 'nm', a.label || '（名前なし）'));
    th.appendChild(el('span', 'em', a.email));
    if (me && a.email === me.email) th.appendChild(el('span', 'tag me', '自分'));
    return th;
  }
  function personRow(a) {
    var tr = el('tr', 'r-acct');
    tr.appendChild(whoCell(a));
    G.APPS.forEach(function (app) { var td = el('td'); td.appendChild(cellBtn('acct', app, a)); tr.appendChild(td); });
    return tr;
  }
  function renderFixed() {
    var ul = $('fixed'); ul.textContent = '';
    G.FIXED.forEach(function (f) {
      var li = el('li');
      li.appendChild(el('span', 'ic', f.ic));
      li.appendChild(el('span', 'nm', f.nm));
      li.appendChild(el('span', 'tag', '🔒 管理者＋2段階認証だけ'));
      ul.appendChild(li);
    });
  }
  function paintState() {
    var d = dirty();
    var n = 0;
    if (d && baseCfg) {
      G.APPS.forEach(function (a) {
        EDIT_ROLES.forEach(function (r) { if (cellChanged('role', a.key, r)) n++; });
        accounts.forEach(function (x) { if (x.role !== 'admin' && cellChanged('acct', a.key, x.email)) n++; });
      });
    }
    $('state').textContent = !canWrite ? '移行 0033 の適用の後に、変える・保存するができます。'
      : (d ? '保存していない変更が ' + n + ' か所あります。「保存する」を押すまで、各アプリには効きません。' : 'まだ保存していない変更はありません。');
    $('b-save').disabled = busy || !canWrite || !d;
    $('b-undo').disabled = busy || !d;
    $('b-reset').disabled = busy || !canWrite;
  }

  // ── 選びの窓 ──
  function opt(text, sub, on, fn) {
    var b = el('button', 'btn opt' + (on ? ' cur' : ''));
    b.type = 'button';
    b.appendChild(el('span', 'o-t', text));
    if (sub) b.appendChild(el('span', 'o-s', sub));
    if (on) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', function () { fn(); closePick(); render(); });
    return b;
  }
  function openPick(kind, app, who) {
    picking = { kind: kind, key: app.key };
    var box = $('pick-opts'); box.textContent = '';
    $('pick-app').textContent = app.ic + ' ' + app.nm;
    if (kind === 'role') {
      var rr = roleRule(cfg, app.key, who), def = G.effective(app.key, who, null, null).allow;
      $('pick-h').textContent = ROLE[who] + 'の人の基本';
      $('pick-now').textContent = 'いまは「' + (G.effective(app.key, who, cfg.role, null).allow ? '開ける' : '開けない') + '」' + (rr === null ? '（既定）' : '') + 'です。この人だけの決まりがある人は、そちらが優先されます。';
      box.appendChild(opt('✓ 開ける', ROLE[who] + 'の人は開ける', rr === true, function () { setRole(app.key, who, true); }));
      box.appendChild(opt('✕ 開けない', ROLE[who] + 'の人は開けない', rr === false, function () { setRole(app.key, who, false); }));
      box.appendChild(opt('既定に戻す', '既定は「' + (def ? '開ける' : '開けない') + '」', rr === null, function () { setRole(app.key, who, null); }));
    } else {
      var ar = acctRule(cfg, who.email, app.key);
      var base = G.effective(app.key, who.role, cfg.role, null).allow;
      $('pick-h').textContent = (who.label || who.email) + '（' + ROLE[who.role] + '）';
      $('pick-now').textContent = 'いまは「' + (G.effective(app.key, who.role, cfg.role, cfg.acct[who.email] || null).allow ? '開ける' : '開けない') + '」' + (ar === null ? '（' + ROLE[who.role] + 'の決まりどおり）' : '（この人だけの決まり）') + 'です。';
      box.appendChild(opt(ROLE[who.role] + 'の決まりどおり', 'いまの' + ROLE[who.role] + 'の決まりは「' + (base ? '開ける' : '開けない') + '」', ar === null, function () { setAcct(who.email, app.key, null); }));
      box.appendChild(opt('✓ この人は開ける', '役割の決まりより優先', ar === true, function () { setAcct(who.email, app.key, true); }));
      box.appendChild(opt('✕ この人は開けない', '役割の決まりより優先', ar === false, function () { setAcct(who.email, app.key, false); }));
    }
    var d = $('pick');
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    var cur = box.querySelector('.cur') || box.firstChild;
    try { cur.focus(); } catch (e) { /* 何もしない */ }
  }
  function closePick() {
    var d = $('pick');
    if (d.open) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
    picking = null;
  }
  function setRole(key, role, v) {
    if (v === null) { if (cfg.role[key]) { delete cfg.role[key][role]; if (!Object.keys(cfg.role[key]).length) delete cfg.role[key]; } return; }
    cfg.role[key] = cfg.role[key] || {}; cfg.role[key][role] = v;
  }
  function setAcct(email, key, v) {
    if (v === null) { if (cfg.acct[email]) { delete cfg.acct[email][key]; if (!Object.keys(cfg.acct[email]).length) delete cfg.acct[email]; } return; }
    cfg.acct[email] = cfg.acct[email] || {}; cfg.acct[email][key] = v;
  }

  // ── 保存 ──
  async function save(reset) {
    if (busy || !canWrite) return;
    if (reset && !window.confirm('役割の決まりと、人ごとの決まりを全部消して、既定（管理者・事務所は開ける・現場は開けない）に戻します。よろしいですか？')) return;
    busy = true; paintState(); msg('');
    try {
      var r = await SUAuth.client().rpc('app_access_put', { p_config: reset ? null : toSave(cfg), p_prev: updatedAt });
      if (r.error) throw r.error;
      if (!r.data || r.data.ok !== true) { msg(ERR[r.data && r.data.error] || '保存できませんでした。', 'ng'); return; }
      updatedAt = r.data.updatedAt || null;
      if (reset) cfg = cleanCfg(null);
      baseCfg = JSON.parse(JSON.stringify(cfg));
      baseline = stable(toSave(cfg));
      msg(reset ? '既定に戻しました。各アプリを次に開いた時から効きます。' : '保存しました。各アプリを次に開いた時から効きます。', 'ok');
    } catch (e) {
      msg(friendly(e), 'ng');
    } finally {
      busy = false; render();
    }
  }

  function setFilter(f) {
    filter = FILTERS.indexOf(f) >= 0 ? f : 'all';
    try { localStorage.setItem(FILTER_KEY, filter); } catch (e) { /* 覚えられない端末は毎回「全員」 */ }
    Array.prototype.forEach.call(document.querySelectorAll('.seg-b'), function (b) {
      var on = b.getAttribute('data-f') === filter;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('on', on);
    });
  }

  async function start() {
    view('loading');
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
    try { await load(); } catch (e) { view('admin'); msg(friendly(e), 'ng'); return; }
    var f0 = 'all'; try { f0 = localStorage.getItem(FILTER_KEY) || 'all'; } catch (e) { /* 既定 */ }
    setFilter(f0);
    renderFixed();
    render();
    view('admin');
  }

  Array.prototype.forEach.call(document.querySelectorAll('.seg-b'), function (b) {
    b.addEventListener('click', function () { setFilter(b.getAttribute('data-f')); render(); });
  });
  $('b-save').addEventListener('click', function () { save(false); });
  $('b-reset').addEventListener('click', function () { save(true); });
  $('b-undo').addEventListener('click', function () {
    if (!baseCfg) return;
    cfg = JSON.parse(JSON.stringify(baseCfg)); msg(''); render();
  });
  $('pick').addEventListener('close', function () { picking = null; });
  $('pick').addEventListener('click', function (e) { if (e.target === $('pick')) closePick(); });   // 窓の外を押したら閉じる
  window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; return ''; } });
  start();
})();
