/*
 * su-auth.js — 共通ログイン（統合 Phase 1・2026-09-26 新設）
 * ════════════════════════════════════════════════════════════════
 * 目的: care-tools と care-log を「1回のログイン」でつなぐ。ログインは Google。
 *       管理者（admin）は Google に加えて2段階認証（認証アプリの6桁）を通した時だけ管理者として扱われる。
 *
 * ★誰が何をできるかはこのファイルでは決めない。決めるのはデータベース側（許可リスト allowed_accounts と
 *   RLS・my_account()）で、毎回その場の許可リストを見る。ここは「ログインする・状態を読む」だけの部品。
 *   ブラウザ側の判定を書き換えられても、データベースは許可リストに無い人・方法には何も返さない。
 * ★下の KEY は「公開用の鍵（anon）」。ブラウザに配る前提の鍵で、これだけでは何も読めない
 *   （anon の権限は 0001 で外してある）。秘密の鍵（service_role / sb_secret_）はここへ絶対に書かない。
 * ★ログイン状態は端末の localStorage（sb-<ref>-auth-token）に入る。care-log と同じ場所・同じ版の部品なので、
 *   同じ端末ならどちらか一方でログインすれば両方で使える。
 * ★ログアウトは「この端末だけ」（scope: 'local'）。既定の global にすると、同じアカウントを使う
 *   他のタブレットまで全部ログアウトされるため。
 *
 * 使い方: <script src="supabase-js-2.112.4.js"></script><script src="su-auth.js"></script>
 *   SUAuth.check()           → 今の状態 {status, email, role, ...}（status は下の STATUS）
 *   SUAuth.signInGoogle()    → Google の画面へ移る（戻り先はこのページ）
 *   SUAuth.signOut()         → この端末だけログアウト
 *   SUAuth.enrollTotp() / SUAuth.verifyTotp(factorId, code) → 管理者の2段階認証
 */
(function () {
  'use strict';

  var URL_ = 'https://jhbernqawjrzqwrmqrih.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpoYmVybnFhd2pyenF3cm1xcmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjU5NjksImV4cCI6MjEwMzQ0MTk2OX0.gJaPf6S-WuovoOajqMOodmNiqNp48tXRT-LW6h9W3N4';

  var STATUS = {
    SIGNED_OUT: 'signed_out',   // ログインしていない
    DENIED: 'denied',           // ログインはしたが、許可リストに無い・止められている・その方法では使えない
    MFA_ENROLL: 'mfa_enroll',   // 管理者で、2段階認証をまだ登録していない
    MFA_VERIFY: 'mfa_verify',   // 管理者で、今回まだ6桁を入れていない
    OK: 'ok',                   // 使える（role が付く）
    ERROR: 'error'              // 通信などで確かめられなかった
  };
  var ROLE_LABEL = { admin: '管理者', office: '事務所', field: '現場' };

  var client = null;
  var initError = null;
  function sb() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) throw new Error('supabase-js が読み込まれていません');
    client = window.supabase.createClient(URL_, KEY, {
      auth: {
        flowType: 'pkce',          // Google から戻る時、鍵そのものではなく一度きりの引換券を URL に載せる方式
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  // ─── Google から戻った直後の URL を読む（エラーの取り出しと、URL の掃除） ───
  // 引換券（?code=）は supabase-js が1回だけ使う。使い終わったら履歴から消して、
  // 画面の共有・ブックマーク・戻るボタンで残らないようにする。
  var landing = (function () {
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var err = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error') || '';
    return { hasAuthParams: q.has('code') || q.has('error') || h.has('error') || h.has('access_token'), error: err };
  })();
  function cleanUrl() {
    if (!landing.hasAuthParams) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 古い端末では何もしない */ }
  }

  function jwtPayload(token) {
    try {
      var p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return {}; }
  }
  function methodsOf(session) {
    var amr = jwtPayload(session.access_token).amr;
    if (!Array.isArray(amr)) return [];
    return amr.map(function (a) { return typeof a === 'string' ? a : (a && a.method) || ''; }).filter(Boolean);
  }

  // Supabase から返る英語のエラーを、現場で意味の通る言葉へ
  function friendly(msg) {
    var m = String(msg || '');
    if (/signups? not allowed|not allowed|not_allowed|user not found|access_denied|登録/i.test(m)) {
      return 'この Google アカウントは登録されていません。使う場合は管理者に登録を頼んでください。';
    }
    if (/invalid (totp|code)|invalid mfa|expired/i.test(m)) return '6桁の数字が違うか、時間切れです。認証アプリの今の数字を入れ直してください。';
    if (/failed to fetch|network|load failed/i.test(m)) return '通信できませんでした。電波・Wi-Fi を確かめてから、もう一度試してください。';
    return m || '確かめられませんでした。';
  }

  async function check() {
    var c;
    try { c = sb(); } catch (e) { initError = e; return { status: STATUS.ERROR, message: e.message }; }
    var got = await c.auth.getSession();       // Google から戻った直後なら、ここで引換券が使われる
    cleanUrl();
    var session = got.data && got.data.session;
    if (!session) {
      var e1 = landing.error || (got.error && got.error.message) || '';
      landing.error = '';                        // 同じエラーを2度出さない
      return { status: STATUS.SIGNED_OUT, message: e1 ? friendly(e1) : '' };
    }
    var base = {
      email: (session.user && session.user.email || '').toLowerCase(),
      methods: methodsOf(session),
      aal: jwtPayload(session.access_token).aal || 'aal1'
    };

    // 許可リストの判定はデータベースに聞く（ここで決めない）
    var acc = await c.rpc('my_account');
    if (acc.error) return Object.assign(base, { status: STATUS.ERROR, message: friendly(acc.error.message) });

    // 管理者かどうか（6桁を通すまでは my_account が「事務所」として返すので、本人の行を見る）
    var row = await c.from('allowed_accounts').select('role,label').eq('email', base.email).maybeSingle();
    var isAdminRow = !row.error && row.data && row.data.role === 'admin';

    if (isAdminRow && !(acc.data && acc.data.mfa)) {
      var f = await c.auth.mfa.listFactors();
      if (f.error) return Object.assign(base, { status: STATUS.ERROR, message: friendly(f.error.message) });
      var verified = (f.data.totp || []).filter(function (x) { return x.status === 'verified'; });
      return Object.assign(base, {
        status: verified.length ? STATUS.MFA_VERIFY : STATUS.MFA_ENROLL,
        factorId: verified.length ? verified[0].id : null,
        label: row.data.label || ''
      });
    }
    if (!acc.data) return Object.assign(base, { status: STATUS.DENIED });
    return Object.assign(base, {
      status: STATUS.OK,
      role: acc.data.role,
      roleLabel: ROLE_LABEL[acc.data.role] || acc.data.role,
      mfa: !!acc.data.mfa,
      label: (row.data && row.data.label) || ''
    });
  }

  async function signInGoogle() {
    var r = await sb().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + location.pathname,
        // 共用タブレットで前の人の Google アカウントのまま入らないよう、毎回アカウントを選ばせる
        queryParams: { prompt: 'select_account' }
      }
    });
    if (r.error) throw new Error(friendly(r.error.message));
  }

  async function signOut() {
    await sb().auth.signOut({ scope: 'local' });
  }

  // 2段階認証の登録。途中でやめた「未確認の登録」が残っていると新しく作れないので、先に片付ける
  async function enrollTotp() {
    var c = sb();
    var f = await c.auth.mfa.listFactors();
    if (f.error) throw new Error(friendly(f.error.message));
    var stale = (f.data.all || []).filter(function (x) { return x.factor_type === 'totp' && x.status !== 'verified'; });
    for (var i = 0; i < stale.length; i++) await c.auth.mfa.unenroll({ factorId: stale[i].id });
    var r = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'care-tools ' + new Date().toISOString().slice(0, 10) });
    if (r.error) throw new Error(friendly(r.error.message));
    return { factorId: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret };
  }

  async function verifyTotp(factorId, code) {
    var r = await sb().auth.mfa.challengeAndVerify({ factorId: factorId, code: String(code).replace(/\D/g, '') });
    if (r.error) throw new Error(friendly(r.error.message));
  }

  window.SUAuth = {
    STATUS: STATUS,
    ROLE_LABEL: ROLE_LABEL,
    check: check,
    signInGoogle: signInGoogle,
    signOut: signOut,
    enrollTotp: enrollTotp,
    verifyTotp: verifyTotp,
    client: sb
  };
})();
