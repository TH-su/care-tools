/*
 * su-app-gate.js — 事務所向けのアプリを開く前に、ログインの役割で「開けるか」を確かめる共通部品（2026-10-29 代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * 決まり（代表者の決定 2026-10-29「推奨どおり」）:
 *   ・アプリの中身（端末の控え・通信）を読む前に確かめる。開けない時は何も読まず、覆いの画面だけを出す
 *   ・ログインしていない端末・使える人に無いアカウント・確かめられない時（通信できない等）も開かない
 *   ・管理者はいつでも開ける（締め出し防止）。2段階認証の6桁をまだ入れていない管理者は事務所として扱う
 *   ・どの役割・どのアカウントが開けるかは、管理者が「アプリの使える人」（app-access.html）で決める（care-backend 0033）。
 *     0033 がまだ無い時は、下の APPS の既定（管理者・事務所は開ける・現場は開けない）で決める
 *   ・端末の用途が「現場」の端末は、各アプリが今までどおり先に止める（この設定では外せない）
 * ★この部品は「読み込めなくても動く」部品ではない（CLAUDE.md §2-6 の逆）。各アプリは window.SUAppGate が無い時は開かない。
 * ★判定はブラウザの中なので、これは「この端末で画面を開かせない」守り。データそのものの守りは、データベース（RLS）と
 *   GAS の合言葉が受け持つ（GAS が読み取りの時に役割を確かめる直しは別の作業）。
 * ★開いた後にログインが変わった（別のタブでログアウト・アカウントを替えた）時、画面に戻った時（1分に1回まで）も確かめ直す。
 *   開けなくなったら、保存していない入力が無ければ読み込み直す（起動の時の確かめに任せる）。入力がある時は覆いだけを出す。
 *   確かめ直しで通信できなかった時は今のまま（開いた後の一時的な通信の失敗で作業を止めない）。遅れて届いた答えは世代で捨てる。
 * ★端末に何も書かない。覚えるのは su-auth.js の同じタブの控え（5分）だけ。
 */
(function () {
  'use strict';
  if (window.SUAppGate) return;

  /* アプリの一覧（正本）。key はデータベースの設定の鍵、def は 0033 の設定が無い時の既定 */
  var APPS = [
    { key: 'resident-master', href: 'resident-master.html', ic: '🗂️', nm: '入居者マスタ', def: { office: true, field: false } },
    { key: 'staff-master', href: 'staff-master.html', ic: '🪪', nm: '職員マスタ', def: { office: true, field: false } },
    { key: 'admission-flow', href: 'admission-flow.html', ic: '🚪', nm: '入居調整', def: { office: true, field: false } },
    { key: 'care-meeting', href: 'care-meeting.html', ic: '🤝', nm: '担当者会議の記録', def: { office: true, field: false } },
    { key: 'training-plan', href: 'training-plan.html', ic: '🏃', nm: '個別機能訓練計画書', def: { office: true, field: false } },
    { key: 'connection-settings', href: 'connection-settings.html', ic: '🔌', nm: '接続設定', def: { office: true, field: false } }
  ];
  /* 管理者＋2段階認証に固定のもの（設定では変えない・図に鍵の印で出すだけ） */
  var FIXED = [
    { key: 'ats', href: 'ats.html', ic: '🙋', nm: '採用管理' },
    { key: 'accounts', href: 'accounts.html', ic: '👥', nm: '使える人の管理' },
    { key: 'menu-settings', href: 'menu-settings.html', ic: '🧭', nm: 'メニューの設定' },
    { key: 'app-access', href: 'app-access.html', ic: '🔐', nm: 'アプリの使える人' }
  ];
  var ROLE_LABEL = { admin: '管理者', office: '事務所', field: '現場' };
  var SESSION_RE = /^sb-[a-z0-9]+-auth-token$/;
  var V_AUTH = 'su-auth.js?v=2026-10-28';
  var V_SB = 'supabase-js-2.112.4.js';
  var V_CSS = 'su-app-gate.css?v=2026-10-29';

  function appOf(key) { for (var i = 0; i < APPS.length; i++) if (APPS[i].key === key) return APPS[i]; return null; }
  function isBool(v) { return v === true || v === false; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /* その役割・その人の決まりで開けるか（純関数・アプリの使える人の画面も同じものを使う）
     rules = 設定の role（{アプリ:{office,field}}）、acct = その人の分（{アプリ:真偽}）。どちらも無くてよい。
     返す src: admin（管理者は常に開ける）／acct（その人だけの決まり）／role（役割の決まり）／default（既定）／unknown（一覧に無いアプリ＝開けない） */
  function effective(key, role, rules, acct) {
    var a = appOf(key);
    if (!a) return { allow: false, src: 'unknown' };
    if (role === 'admin') return { allow: true, src: 'admin' };
    if (role !== 'office' && role !== 'field') return { allow: false, src: 'unknown' };
    if (isObj(acct) && isBool(acct[key])) return { allow: acct[key], src: 'acct' };
    if (isObj(rules) && isObj(rules[key]) && isBool(rules[key][role])) return { allow: rules[key][role], src: 'role' };
    return { allow: !!a.def[role], src: 'default' };
  }

  /* 確かめた材料から結論を出す（純関数）。
     hasSession: 端末にログインの印があるか／st: SUAuth.check() の答え（無い・例外は null）
     mine: app_access_mine の答え {role, rules, mine}・関数がまだ無い時は {missing:true}・失敗は {error:true}・呼んでいない時は null
     返す why: ok／signedout／denied／error／role（役割・決まりで開けない）／unknown */
  function decide(key, hasSession, st, mine) {
    if (!appOf(key)) return { allow: false, why: 'unknown' };
    if (!hasSession) return { allow: false, why: 'signedout' };
    if (!st || !st.status) return { allow: false, why: 'error' };
    if (st.status === 'signed_out') return { allow: false, why: 'signedout' };
    if (st.status === 'denied') return { allow: false, why: 'denied' };
    if (st.status === 'error') return { allow: false, why: 'error' };
    var role;
    var mfaPending = st.status === 'mfa_verify' || st.status === 'mfa_enroll';
    if (mfaPending) role = 'office';   // 6桁の前の管理者は事務所（データベースの my_role と同じ）
    else if (st.status === 'ok') role = st.role;
    else return { allow: false, why: 'error' };
    if (role !== 'admin' && role !== 'office' && role !== 'field') return { allow: false, why: 'denied' };
    if (role === 'admin') return { allow: true, why: 'ok', role: role, src: 'admin' };
    if (!mine || mine.error) return { allow: false, why: 'error', role: role };
    var rules = null, acct = null;
    if (!mine.missing) {
      /* データベースの答えの役割が正（画面の控えより新しい）。無い・知らない役割は使える人に無い扱い */
      if (mine.role !== 'admin' && mine.role !== 'office' && mine.role !== 'field') return { allow: false, why: 'denied' };
      role = mine.role;
      if (role === 'admin') return { allow: true, why: 'ok', role: role, src: 'admin' };
      rules = mine.rules; acct = mine.mine;
    }
    var e = effective(key, role, rules, acct);
    return { allow: e.allow, why: e.allow ? 'ok' : (mfaPending ? 'mfa' : 'role'), role: role, src: e.src };
  }

  function hasSession() {
    try { for (var i = 0; i < localStorage.length; i++) if (SESSION_RE.test(localStorage.key(i) || '')) return true; } catch (e) { /* 読めない端末はログインなし */ }
    return false;
  }
  function authLoad() {
    if (window.SUAuth) return Promise.resolve();
    function has(re) { return Array.prototype.some.call(document.scripts, function (s) { return re.test(s.getAttribute('src') || ''); }); }
    function load(src) {
      return new Promise(function (ok, ng) {
        var s = document.createElement('script'); s.src = src; s.async = true;
        s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
        document.head.appendChild(s);
      });
    }
    function wait(ready) {
      return new Promise(function (ok, ng) { var n = 0; (function tick() { if (ready()) return ok(); if (++n > 100) return ng(new Error('timeout')); setTimeout(tick, 100); })(); });
    }
    var p = window.supabase ? Promise.resolve() : (has(/^supabase-js-/) ? wait(function () { return !!window.supabase; }) : load(V_SB));
    return p.then(function () {
      if (window.SUAuth) return null;
      return has(/^su-auth\.js/) ? wait(function () { return !!window.SUAuth; }) : load(V_AUTH);
    });
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (ok, ng) { setTimeout(function () { ng(new Error('timeout')); }, ms); })]);
  }
  function note(where, e) { try { if (window.SUErrors && typeof SUErrors.note === 'function') SUErrors.note('アプリの使える人: ' + where, e); } catch (x) { /* 記録できなくても止めない */ } }

  /* 確かめる（一度だけ）。結論 {allow, why, role, src} を返す。例外は外に出さない */
  function probe(key, fresh) {
    if (!appOf(key)) return Promise.resolve(decide(key, true, null, null));
    if (!hasSession()) return Promise.resolve(decide(key, false, null, null));
    var st = null;
    return withTimeout(authLoad().then(function () { return window.SUAuth.check(fresh ? { fresh: true } : undefined); }), 15000)
      .then(function (s) {
        st = s;
        /* 端末にログインの印が残っているのに「ログインしていない」と答えた時は、期限切れの更新が通信の失敗で通らなかった場合がある
           （supabase-js は通信の失敗では印を消さない）。確かめられない扱いにして「もう一度確かめる」を出す（反証レビューの指摘） */
        if (st && st.status === 'signed_out' && hasSession()) st = { status: 'error' };
        /* データベースに聞くまでもない結論（ログインなし・使える人に無い・確かめられない・管理者）はここで決める */
        var pre = decide(key, true, st, { missing: true });
        if (pre.why === 'signedout' || pre.why === 'denied' || pre.why === 'error' || pre.why === 'unknown' || pre.src === 'admin') return { pre: pre };
        return withTimeout(window.SUAuth.client().rpc('app_access_mine'), 15000).then(function (r) {
          if (r && r.error) {
            var c = r.error.code, m = String(r.error.message || '');
            if (c === 'PGRST202' || /app_access_mine/.test(m) && /could not find|not find the function/i.test(m)) return { mine: { missing: true } };
            if (c === '42501') return { mine: { role: null } };   // 使える人に無い・止められた
            note('本人の分を読めない', r.error);
            return { mine: { error: true } };
          }
          var d0 = r && r.data;
          if (!isObj(d0) || d0.ok !== true) return { mine: { error: true } };
          return { mine: { role: d0.role, rules: isObj(d0.rules) ? d0.rules : null, mine: isObj(d0.mine) ? d0.mine : null } };
        });
      })
      .then(function (x) { return x.pre || decide(key, true, st, x.mine); })
      .catch(function (e) { note('確かめられない', e); return decide(key, true, st && st.status === 'ok' ? st : null, { error: true }); });
  }

  // ─── 覆いの画面 ───
  var MSG = {
    field: 'このページは事務所・管理者のアカウントでだけ開けます。いまのアカウント（現場）では開けません。事務所・管理者の Google アカウントでログインし直してください。',
    role: 'このページは、いまのアカウント（{r}）では開けません。開ける人は、管理者が「アプリの使える人」の画面で決めています。開く必要がある時は、管理者に伝えてください。',
    signedout: 'このページはログインしてから開きます。事務所・管理者の Google アカウントでログインしてください。',
    denied: 'このアカウントは、介護ツールを使える人に入っていないか、止められています。管理者に確かめてください。',
    error: 'ログインを確かめられませんでした。電波・Wi-Fi を確かめてから「もう一度確かめる」を押してください。',
    mfa: '管理者のアカウントは、ログインの画面で2段階認証（認証アプリの6桁）を済ませると開けます。',
    unknown: 'このページの決まりを読めませんでした。ページを読み込み直してください。'
  };
  var box = null, mo = null;
  function inertOne(c) {
    if (c !== box && c.setAttribute && !c.hasAttribute('inert')) { c.setAttribute('inert', ''); c.setAttribute('data-sug-inert', ''); }
  }
  function ensureCss() {
    try {
      if (document.querySelector('link[data-su-app-gate]')) return;
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = V_CSS; l.setAttribute('data-su-app-gate', '');
      (document.head || document.documentElement).appendChild(l);
    } catch (e) { /* 見た目が付かなくても、文字とボタンは出る */ }
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function nextName() { var m = /([a-z0-9][a-z0-9-]*\.html)$/.exec(location.pathname || ''); return m ? m[1] : ''; }
  function show(d, name) {
    ensureCss();
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { show(d, name); }); return; }
    if (!box) {
      box = el('div', 'sug');
      box.id = 'su-app-gate';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'sug-h');
      document.body.appendChild(box);
    }
    document.documentElement.classList.add('sug-on');
    /* 覆いの下の画面は押せない・Tab で入れない・読み上げない（inert）。覆いの下のボタンで通信を起こさせない（反証レビューの指摘）。
       開いている窓（showModal）は覆いより上に出て覆いのボタンを押せなくするので閉じる。後から足された部品（不具合を報告のボタン等）にも付ける */
    try { Array.prototype.forEach.call(document.querySelectorAll('dialog[open]') || [], function (dl) { try { dl.close(); } catch (e) { dl.removeAttribute('open'); } }); } catch (e) { /* 何もしない */ }
    Array.prototype.forEach.call(document.body.children || [], inertOne);
    try {
      if (!mo && typeof MutationObserver === 'function') {
        mo = new MutationObserver(function (list) {
          if (!box) return;
          list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes || [], function (n) { if (n.nodeType === 1 && n.parentNode === document.body) inertOne(n); }); });
        });
        mo.observe(document.body, { childList: true });
      }
    } catch (e) { /* 見張れなくても、出した時の子には付いている */ }
    box.textContent = '';
    var cd = el('div', 'sug-cd');
    if (!d) {
      var sp = el('p', 'sug-spin', 'ログインを確かめています…');
      sp.id = 'sug-h';
      cd.appendChild(sp);
      box.appendChild(cd);
      return;
    }
    var h = el('h2', 'sug-h', d.why === 'error' ? '確かめられませんでした' : (d.why === 'signedout' ? 'ログインしてください' : (d.why === 'mfa' ? '2段階認証を済ませてください' : 'このページは開けません')));
    h.id = 'sug-h';
    cd.appendChild(el('p', 'sug-app', name || ''));
    cd.appendChild(h);
    var t = d.why === 'role' ? ((d.role === 'field' && d.src === 'default') ? MSG.field : MSG.role.replace('{r}', ROLE_LABEL[d.role] || '')) : (MSG[d.why] || MSG.unknown);
    cd.appendChild(el('p', 'sug-msg', t));
    if (d.dirty) cd.appendChild(el('p', 'sug-warn', '保存していない入力があるため、画面は読み込み直さずに残しています。別のタブで開けるアカウントにログインし直すと、この覆いが消え、続きを保存できます。'));
    var acts = el('div', 'sug-acts');
    if (d.why === 'error' || d.why === 'unknown') {
      var b = el('button', 'sug-btn pri', d.why === 'error' ? 'もう一度確かめる' : '読み込み直す');
      b.type = 'button';
      b.addEventListener('click', function () { location.reload(); });
      acts.appendChild(b);
    }
    if (d.why !== 'unknown') {
      var nx = nextName();
      var a = el('a', 'sug-btn' + (d.why === 'error' ? '' : ' pri'), 'ログインの画面へ');
      a.href = 'login.html' + (nx ? '?next=' + encodeURIComponent(nx) : '');
      acts.appendChild(a);
    }
    var m = el('a', 'sug-btn', 'メニューへ'); m.href = 'index.html';
    acts.appendChild(m);
    cd.appendChild(acts);
    box.appendChild(cd);
    try { var f0 = acts.firstChild; if (f0) f0.focus(); } catch (e) { /* 何もしない */ }   // 読み上げは窓の名前（見出し）から始まる
  }
  function hide() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    try { if (mo) { mo.disconnect(); mo = null; } } catch (e) { /* 何もしない */ }
    try {
      Array.prototype.forEach.call(document.querySelectorAll('[data-sug-inert]') || [], function (c) { c.removeAttribute('inert'); c.removeAttribute('data-sug-inert'); });
    } catch (e) { /* 何もしない */ }
    document.documentElement.classList.remove('sug-on');
  }

  /* 画面の入口から呼ぶ。開けるなら true、開けないなら覆いを出して false で終わる。
     opts.dirty: 保存していない入力があるかを返す関数（開いた後に開けなくなった時、読み込み直してよいかに使う） */
  var gen = 0, watching = null, lastAt = 0;
  function run(key, opts) {
    opts = opts || {};
    var a = appOf(key);
    var name = a ? a.nm : '';
    var my = ++gen;
    show(null, name);
    return probe(key, false).then(function (d) {
      if (my !== gen) return false;
      if (!d.allow) { show(d, name); return false; }
      hide();
      lastAt = Date.now();
      watch(key, name, opts);
      return true;
    });
  }
  function recheck(key, name, opts, fresh) {
    var my = ++gen;
    lastAt = Date.now();
    return probe(key, fresh).then(function (d) {
      if (my !== gen) return;
      if (d.allow) { if (box) hide(); return; }   // 開けるアカウントに戻った（入力があって覆いだけ出していた時は覆いを外す）
      if (d.why === 'error') return;               // 開いた後の一時的な通信の失敗では止めない
      var dirty = false;
      try { dirty = !!(opts.dirty && opts.dirty()); } catch (e) { dirty = true; }   // 判断できない＝入力ありとして扱う（黙って捨てない）
      d.dirty = dirty;
      show(d, name);                                // 先に覆う（読み込み直しを「留まる」で取りやめても、画面は覆われたまま）
      if (!dirty) location.reload();
    });
  }
  function watch(key, name, opts) {
    if (watching) return;
    watching = key;
    window.addEventListener('storage', function (e) {
      try { if (e && (e.key === null || SESSION_RE.test(e.key || ''))) recheck(key, name, opts, true); } catch (x) { note('確かめ直し', x); }
    });
    window.addEventListener('pageshow', function (e) {
      try { if (e && e.persisted) recheck(key, name, opts, true); } catch (x) { note('確かめ直し', x); }
    });
    document.addEventListener('visibilitychange', function () {
      try { if (!document.hidden && Date.now() - lastAt > 60000) recheck(key, name, opts, false); } catch (x) { note('確かめ直し', x); }
    });
  }

  window.SUAppGate = { APPS: APPS, FIXED: FIXED, ROLE_LABEL: ROLE_LABEL, effective: effective, decide: decide, run: run };
})();
