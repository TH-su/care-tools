/*
 * su-health.js — 新しい保存先への保存の失敗を、種類と理由だけ数えて共通 DB へ送る（統合 0088・2026-11-14 代表者の依頼「本番の健康」）
 * ════════════════════════════════════════════════════════════════
 * 保存の入口の部品（su-res-read.js・su-data-supabase.js・su-stf.js・su-sup.js・su-sa.js・su-geno.js・su-doc-live.js・su-weight-live.js）が、
 * 新しい保存先へ送った保存に失敗した時に1回だけ呼ぶ:
 *   SUHealth.fail(種類, 失敗の様子)   種類: res・tp・adm・stf・sup・sa・geno・doc_stf・doc_adm・weight
 *                                    失敗の様子: { code, status, pg, timeout, network }（どれか。文や中身は渡さない）
 *   SUHealth.reasonOf(失敗の様子)     … 理由（login・perm・timeout・other）。失敗に数えないもの（切り替える前・競合など）は null。純関数
 * ★端末に控えるのは [種類, 理由, 時刻] だけ（su_health_q・100件まで・古い方から捨てる）。氏名・中身・文・端末の印は控えない・送らない。
 *   ログインが切れて失敗した分も控え、次にこの端末でログインできた時に送る（ログインしないまま捨てた端末の分は数えられない）。
 * ★送るのは、この画面がもうログインの部品（SUAuth）を読み込んでいてログインしている時だけ（この部品はログインの部品を読み込まない）。
 *   同じ端末の別のタブと同時に送らないよう、送っている間は印（su_health_lock・時刻だけ）を30秒立てる。
 * ★読み込むだけで効く・読み込めなくても保存は動く・例外を外に出さない・保存の動きと答えには一切触れない。
 */
(function (root) {
  'use strict';

  var KINDS = ['res', 'tp', 'adm', 'stf', 'sup', 'sa', 'geno', 'doc_stf', 'doc_adm', 'weight'];
  /* REASON_BEGIN 理由の振り分け（純関数・check/unit/su_health_test.js）。
     受け口（*-write）の断りの code: login＝ログイン・role＝権限・shadow／files_google／missing＝切り替える前や Google へ回す印（失敗にしない）。
     データベースの断り: 42501＝権限・PGRST301 や JWT の切れ＝ログイン。競合（stale・conflict・unchanged・busy の印のない conflict）は失敗にしない */
  var NOT_FAIL = { shadow: 1, files_google: 1, missing: 1, stale: 1, conflict: 1, unchanged: 1, noop: 1, live: 1, pending: 1 };
  function reasonOf(x) {
    if (!x || typeof x !== 'object') return 'other';
    if (x.timeout === true || x.network === true) return 'timeout';
    var code = typeof x.code === 'string' ? x.code : '';
    var pg = typeof x.pg === 'string' ? x.pg : '';
    if (code && NOT_FAIL[code]) return null;
    if (code === 'login' || code === 'signed_out' || x.status === 401 || pg === 'PGRST301' || pg === 'PGRST303') return 'login';
    if (code === 'role' || code === 'denied' || x.status === 403 || pg === '42501') return 'perm';
    return 'other';
  }
  /* REASON_END */

  var api = { KINDS: KINDS, reasonOf: reasonOf, fail: function () {}, flush: function () {} };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  if (root.SUHealth) return;
  root.SUHealth = api;

  var QKEY = 'su_health_q', LKEY = 'su_health_lock', MAX = 100, LOCK_MS = 30000;
  /* 同じ種類・理由の失敗は60秒に1回だけ数える（未送信の送り直しが、1回の保存の失敗を何度も数えないため・反証レビュー指摘1）。
     控えの最後の同じ組の時刻で見るので、ページを開き直しても続けて数えない */
  var SAME_MS = 60000;
  function readQ() {
    try {
      var a = JSON.parse(root.localStorage.getItem(QKEY) || '[]');
      if (!Array.isArray(a)) return [];
      return a.filter(function (e) {
        return Array.isArray(e) && e.length === 3 && KINDS.indexOf(e[0]) >= 0 && ['login', 'perm', 'timeout', 'other'].indexOf(e[1]) >= 0
          && typeof e[2] === 'number' && isFinite(e[2]);
      }).slice(-MAX);
    } catch (e) { return []; }
  }
  function writeQ(a) {
    try {
      if (a.length) root.localStorage.setItem(QKEY, JSON.stringify(a.slice(-MAX)));
      else root.localStorage.removeItem(QKEY);
    } catch (e) { /* 控えられなくても保存は動く */ }
  }
  function note(e) { try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('su-health', e); } catch (x) { /* 何もしない */ } }

  var sending = false, timer = null, sentAt = {};
  function flush() {
    try {
      if (sending) return;
      var A = root.SUAuth;
      if (!A || typeof A.client !== 'function') return;
      var q = readQ();
      if (!q.length) return;
      var lk = Number(root.localStorage.getItem(LKEY) || 0);
      if (lk && Date.now() - lk < LOCK_MS) return;
      root.localStorage.setItem(LKEY, String(Date.now()));
      sending = true;
      var batch = q.slice(0, 50);
      var c = A.client();
      Promise.resolve(c.auth.getSession()).then(function (s) {
        if (!(s && s.data && s.data.session)) return null;   // ログインしていない＝控えたまま
        return Promise.resolve(c.rpc('save_fail_note', { p_items: batch.map(function (e) { return { k: e[0], r: e[1], t: e[2] }; }) }));
      }).then(function (r) {
        if (!r) return;
        if (r.error) { if (!/PGRST202|42883/.test(String(r.error.code || ''))) note(new Error('save_fail_note ' + String(r.error.code || '').slice(0, 20))); return; }
        if (!r.data || r.data.ok !== true) return;
        // 送った分（先頭の batch.length 件）だけを消す。送っている間に足した分は残す
        var now = readQ(), sent = batch.map(function (e) { return e.join('|'); }), i = 0;
        while (i < now.length && i < sent.length && now[i].join('|') === sent[i]) i++;
        writeQ(now.slice(i));
        if (now.length - i > 0) setTimeout(flush, 1000);
      }).catch(note).then(function () {
        sending = false;
        try { root.localStorage.removeItem(LKEY); } catch (e) { /* 何もしない */ }
      });
    } catch (e) { sending = false; note(e); }
  }
  function soon(ms) { try { clearTimeout(timer); timer = setTimeout(flush, ms); } catch (e) { /* 何もしない */ } }

  api.flush = flush;
  api.fail = function (kind, info) {
    try {
      if (KINDS.indexOf(kind) < 0) return;
      var r = reasonOf(info);
      if (!r) return;
      var q = readQ(), now = Date.now();
      for (var i = q.length - 1; i >= 0; i--) {
        if (q[i][0] === kind && q[i][1] === r) { if (now - q[i][2] >= 0 && now - q[i][2] < SAME_MS) return; break; }
      }
      if (sentAt[kind + '|' + r] && now - sentAt[kind + '|' + r] < SAME_MS) return;
      sentAt[kind + '|' + r] = now;
      q.push([kind, r, now]);
      writeQ(q);
      soon(2000);
    } catch (e) { note(e); }
  };
  // 前に控えた分は、画面の読み込みから少し後に送る（ログインの部品の読み込みを待つ）
  try {
    if (root.document && root.document.readyState === 'complete') soon(5000);
    else root.addEventListener('load', function () { soon(5000); });
  } catch (e) { /* 何もしない */ }
})(typeof window !== 'undefined' ? window : this);
