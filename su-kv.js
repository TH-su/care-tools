/*
 * su-kv.js — 同期データの保存先の切り替え（統合 0005・切り替え本番用・2026-09-26）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-09-26）: 週間計画は塊ごと移す。写しで確かめてから、全端末一斉に切り替える。
 *   ワークスケジュール（週の型 ws_weekly_master_v1・日ごと wsday_YYYY-MM-DD）も、週間計画と同じ夜に一緒に切り替える（統合 0007）。
 *   勤務表（シフト系）は別の入口 SUKv.handlesShift / SUKv.callShift で扱う（統合 0009・2026-09-27 代表者の決定 B）。
 *   通信の形（pull / push / 編集権 lock* / shiftStatus）と編集できる端末を1台に絞る仕組みがワークスケジュールと違うため。
 *   スイッチは su-backend.json の "shift"（切り替えは週間計画・ワークスケジュールとは別の夜に、別に決める）。
 *
 * 仕組み:
 *   ・切り替えのスイッチは公開ファイル su-backend.json（{"supabase": {"care_schedule_v2": true, "ws_weekly_master_v1": true, "wsday": true}}）。
 *     wsday は日ごとのキー（wsday_YYYY-MM-DD）すべてをまとめた1つのスイッチ。
 *     全端末が起動時と1分ごとに読む＝ PR を1つ取り込むだけで全端末が一斉に切り替わる／戻る。
 *   ・各アプリの通信関数の入口で SUKv.handles(payload) が真なら SUKv.call(payload, rawGas) に任せる。
 *     スイッチが入っていないキーは rawGas（これまでの Google）へそのまま流す＝切り替え前は何も変わらない。
 *   ・スイッチが入ったキーは Supabase の関数（kv_get / kv_head / kv_put / kv_history_*）で読み書きし、
 *     Google と同じ形の応答を返す（conflict・unchanged・bathwipe・visitwipe 等も同じ名前）＝アプリ側の処理は変えない。
 *   ・Supabase に保存できたら、少し待って最新版を Google へも写し返す（force・mirror の印つき）。まだ Google を読んでいる画面
 *     （週間計画俯瞰・支援俯瞰・入居者マスタのデイ利用日・フェイスシート・訓練計画）が古いままにならないように。
 *     ★mirror の印（2026-10-17 改善プロンプト第2弾の8・代表者の決定）: 統合 GAS はスクリプトプロパティ KV_SWITCHED_FAMILIES に
 *       書いた種類について、印の無い書き込み（スイッチを読めていない古い端末）を断る。写し返しだけが通る。
 *     ★勤務表は写し返さない（2026-10-17 同）。Google は厳格モードで写し返しを断っていた。戻す時は写しの見比べの
 *       「勤務表を Google へ写し返す」で明示的に写す。
 *   ・Supabase へ書けるのは事務所・管理者として Google でログインしている時だけ（最終判定はデータベース）。
 *     ★例外（0010・2026-10-11 代表者の決定 A）: 現場のアカウントは、ワークスケジュールの日データ（wsday_*）の
 *       「実施チェック（done・checks）」と「コメント」だけを kv_put_marks で書ける（盤面・職員・時刻は書けない）。
 *     ログインしていなければ、画面下に「ログインしてください」の帯を出し、通信は失敗として返す（入力は端末に残る）。
 *
 * ★スイッチが読めない時（圏外など）は、最後に読めた値を使う（localStorage su_backend_flags）。
 *   一度も読めていない端末は Google のまま＝切り替え前と同じ。
 * ★切り替え当日の順番（割れないように）: ①写しの見比べ画面の「切り替え前の点検」が全部そろっていることを確かめる
 *   ②スイッチを入れる PR を取り込む（この間の保存は 'shadow' で断られ、入力は端末に残る）
 *   ③管理者が写しの見比べ画面で「切り替える」（kv_set_family_mode live・週間計画とワークスケジュールをまとめて）。
 *   戻す時は逆順: ①スイッチを切る PR ②「戻す」（shadow）。
 *   ★スイッチを切→入にする時は、裏に回したタブを一度表に出すか閉じてから（裏の間はスイッチを読み直さないため。2026-10-24）。
 *   ★戻す前に、統合 GAS のスクリプトプロパティ KV_SWITCHED_FAMILIES からその種類を外す（外さないと、Google へ戻した後の
 *     全端末の保存が断られる）。
 */
(function () {
  'use strict';
  // このファイルが扱えるキーと、そのスイッチの名前（増やす時は 0005/0007 のキーの範囲内で）。
  // 勤務表のキーは 'shift'（0007 の private.kv_family と同じ範囲）。勤務表は handlesShift / callShift だけが扱う
  var SHIFT_KEY_RE = /^(staff|symbols|settings|freee|sched:\d{4}-\d{2}:[A-Za-z0-9_.:-]{1,80}|req:\d{4}-\d{2}|drafts:\d{4}-\d{2})$/;
  function flagOf(key) {
    if (key === 'care_schedule_v2' || key === 'ws_weekly_master_v1') return key;
    if (typeof key === 'string' && /^wsday_\d{4}-\d{2}-\d{2}$/.test(key)) return 'wsday';
    if (typeof key === 'string' && SHIFT_KEY_RE.test(key)) return 'shift';
    return '';
  }
  // 週間計画・ワークスケジュールの入口（handles / call / readRouted）が扱うキー（勤務表は混ぜない）
  function kvFlagOf(key) { var f = flagOf(key); return f === 'shift' ? '' : f; }
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var ROUTED_ACTIONS = { get: 1, put: 1, head: 1, history: 1 };
  var MIRROR_WAIT_MS = 20000;

  var flags = null, flagsTriedAt = 0, flagsPromise = null;
  try { flags = JSON.parse(localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { flags = null; }

  function fetchFlags() {
    if (flagsPromise) return flagsPromise;
    flagsTriedAt = Date.now();
    flagsPromise = fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.supabase && typeof j.supabase === 'object') {
          flags = { supabase: j.supabase };
          try { localStorage.setItem(FLAGS_LS, JSON.stringify(flags)); } catch (e) { /* 何もしない */ }
        }
      })
      .catch(function () { /* 読めない時は最後に読めた値のまま */ })
      .then(function () { flagsPromise = null; });
    return flagsPromise;
  }
  function ensureFlags() {
    // 1分以内に読みに行っていれば、その結果（圏外なら最後に読めた値）を使う
    if (flagsTriedAt && Date.now() - flagsTriedAt < 60000 && !flagsPromise) return Promise.resolve();
    // 3秒で見切る（圏外で起動が止まらないように。見切った時は最後に読めた値）
    return Promise.race([fetchFlags(), new Promise(function (ok) { setTimeout(ok, 3000); })]);
  }
  function routed(key) { var f = flagOf(key); return !!(f && flags && flags.supabase && flags.supabase[f] === true); }
  function kvRouted(key) { return !!kvFlagOf(key) && routed(key); }

  // ── ログイン（supabase-js と su-auth.js は使う時にだけ読み込む）──
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  /* 画面やほかの部品（su-report.js）がすでに同じ部品の札（<script src>）を入れている時は、2本目を入れずに読み終わるのを待つ
   * （2026-10-16: 2本目を入れていて、ログインの窓口が2つできていた。su-report.js の loadAuth と同じ考え方） */
  function hasTag(name) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) if (String(ss[i].getAttribute('src') || '').split('?')[0].split('/').pop() === name) return true;
    return false;
  }
  function waitFor(test, ms) {
    return new Promise(function (ok, ng) {
      var t0 = Date.now();
      (function poll() { if (test()) ok(); else if (Date.now() - t0 > ms) ng(new Error('load')); else setTimeout(poll, 100); })();
    });
  }
  function ensureAuth() {
    if (window.SUAuth) return Promise.resolve();
    if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
    var p = window.supabase ? Promise.resolve()
      : (hasTag('supabase-js-2.112.4.js') ? waitFor(function () { return !!window.supabase; }, 8000) : loadScript('supabase-js-2.112.4.js'));
    return p.then(function () {
      if (window.SUAuth) return null;
      if (hasTag('su-auth.js')) return waitFor(function () { return !!window.SUAuth; }, 8000);
      return loadScript('su-auth.js?v=2026-10-28');
    });
  }
  // ログインの状態は毎回 SUAuth.check に聞く（2026-10-24）。同じアカウントの「使える」は su-auth.js が同じタブの中で5分控えるので、
  // データベースへの往復は増えない（増えるのは端末の中のログインと控えの読み取りだけ）。ここでも5分持つと su-auth.js の控えと重なり、
  // 役割が最大約10分古くなっていた。authCache は最後に確かめた結果で、marksOnlyFor が同期で答えるためだけに持つ（使い回さない）
  var authCache = null;
  function authState() {
    return ensureAuth().then(function () { return window.SUAuth.check(); }).then(function (st) {
      authCache = st;
      return st;
    });
  }

  var bannerShown = false;
  function showLoginBanner() {
    if (bannerShown || !document.body) return;
    bannerShown = true;
    var page = (location.pathname.split('/').pop() || 'index.html');
    if (!/^[a-z0-9][a-z0-9-]*\.html$/.test(page)) page = 'index.html';
    var bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#b3261e;color:#fff;' +
      'padding:12px 16px;font:700 15px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;' +
      'display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
    var t = document.createElement('span');
    t.textContent = '保存先が新しくなりました。保存・読み込みには Google でのログインが必要です（入力した内容は端末に残っています）。';
    var a = document.createElement('a');
    a.href = 'login.html?next=' + page;
    a.textContent = 'ログインする';
    a.style.cssText = 'background:#fff;color:#b3261e;border-radius:8px;padding:8px 14px;text-decoration:none;min-height:40px;display:inline-flex;align-items:center';
    bar.appendChild(t); bar.appendChild(a);
    document.body.appendChild(bar);
  }

  // ── Google への写し返し（読むだけの画面のため）──
  // 2026-10-16 改: 20秒の待ちの間に画面を閉じると写し返しが届かず、Google が古いまま残っていた
  //   （写しの見比べの「本番の中身の見比べ」で、週の型1件・日ごと2件）。そこで:
  //   1 写し返しの予定を端末に控える（su_kv_mirror_pending・キーと時刻だけ。中身は持たない）。
  //     Google が受け取った（ok）と分かった時だけ、その時より前の控えを消す（観測してから完了・多端末同期規約6）
  //   2 画面を隠した時（別のアプリ・タブへ移る・閉じる）は、20秒を待たずにその場で写し返す
  //   3 同じ端末で次に週間計画・ワースケ・デイ利用表が Supabase へ保存できた時、控えに残っている他のキーも写し返す（7日より古い控えは捨てる）。
  //     保存の時の Google への送り方（rawGas）だけを使う＝読むだけの画面（俯瞰・フェイスシート等）の送り方で Google へ書かない
  //   写すのは毎回 Supabase の最新（kv_get）を force で＝何度写しても同じ（冪等）。勤務表は写し返さない（2026-10-17 に外した）
  var MIRROR_LS = 'su_kv_mirror_pending', MIRROR_KEEP_MS = 7 * 24 * 3600 * 1000, MIRROR_RESUME_MS = 5000, MIRROR_RETRY_MS = 5000;
  function mirrorPending() {
    try { var o = JSON.parse(localStorage.getItem(MIRROR_LS) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  function mirrorPendingSave(o) {
    try { if (Object.keys(o).length) localStorage.setItem(MIRROR_LS, JSON.stringify(o)); else localStorage.removeItem(MIRROR_LS); } catch (e) { /* 控えを残せなくても写し返しは行う */ }
  }
  function mirrorMark(key) { var o = mirrorPending(); o[key] = Date.now(); mirrorPendingSave(o); }
  // started より後に予定し直された控えは消さない（写している間に新しく保存された分は、まだ届いていない）
  function mirrorDone(key, started) { var o = mirrorPending(); if (o[key] && Number(o[key]) <= started) { delete o[key]; mirrorPendingSave(o); } }
  function mirrorDrop(key, started) { mirrorDone(key, started); }   // 写さずに控えだけ消す（本番でなくなった種類）
  var mirrorTimers = {}, mirrorRaw = {}, mirrorBusy = {};
  function runMirror(key) {
    clearTimeout(mirrorTimers[key]); delete mirrorTimers[key];
    var rawGas = mirrorRaw[key];
    if (!rawGas) return;
    if (mirrorBusy[key]) { mirrorTimers[key] = setTimeout(function () { runMirror(key); }, MIRROR_RETRY_MS); return; }
    var sb = window.SUAuth && window.SUAuth.client();
    if (!sb) return;
    var started = Date.now();
    mirrorBusy[key] = true;
    sb.rpc('kv_get', { p_key: key }).then(function (r) {
      if (r.error || !r.data) return;
      // 本番（スイッチが入っていて、データベースの mode が live）の時だけ写す。写しの期間・Google へ戻した後に写すと、
      // Google の新しい中身を Supabase の止まった中身で上書きする（force は版を見ない）＝控えを捨てる（反証レビュー 2026-10-16 高）
      if (!kvRouted(key) || r.data.mode !== 'live') { mirrorDrop(key, started); return; }
      var d = r.data.data;
      if (d == null || typeof d !== 'object') return;   // 受け取った中身が壊れていれば写さない（多端末同期規約10）
      // 最新版で上書き（force）。版番号は Google 側で独自に進む＝読む側は「変わった」ことだけ分かればよい
      // mirror の印＝写し返しであることを統合 GAS に知らせる（切り替え済みの種類でも、写し返しだけは断らない・2026-10-17）
      return Promise.resolve(rawGas({ action: 'put', key: key, rev: 0, data: d, force: true, mirror: true })).then(function (g) {
        if (g && g.ok) mirrorDone(key, started);
      });
    }).catch(function () { /* 写し返しの失敗は本番に影響させない（控えが残る＝次の機会にまた写す） */ })
      .then(function () { mirrorBusy[key] = false; });
  }
  function scheduleMirror(key, rawGas) {
    resumeMirrors(rawGas, key);
    mirrorRaw[key] = rawGas;
    mirrorMark(key);
    clearTimeout(mirrorTimers[key]);
    mirrorTimers[key] = setTimeout(function () { runMirror(key); }, MIRROR_WAIT_MS);
  }
  function flushMirrors() { Object.keys(mirrorTimers).forEach(runMirror); }
  var mirrorResumed = false;
  // savedKey＝いま保存できたキー。週間計画（care_schedule_v2）の残りは、週間計画を保存した時だけ写す。
  //   週間計画の画面だけがログインの証明を添えて送るため、ほかの画面の送り方で写すと Google 側の「最後に直した人」が
  //   「未確認」に変わる（反証レビュー 2026-10-16 低）。ワースケのキーは同じ統合 GAS へ同じ形で送るので、どの保存でも写す
  function resumeMirrors(rawGas, savedKey) {
    if (mirrorResumed || !rawGas) return;
    mirrorResumed = true;
    var o = mirrorPending(), now = Date.now(), changed = false;
    Object.keys(o).forEach(function (k) {
      if (!kvRouted(k) || !(now - Number(o[k]) < MIRROR_KEEP_MS)) { delete o[k]; changed = true; return; }
      if (k === 'care_schedule_v2' && savedKey !== 'care_schedule_v2') { mirrorResumed = false; return; }
      if (mirrorTimers[k]) return;
      mirrorRaw[k] = rawGas;
      mirrorTimers[k] = setTimeout(function () { runMirror(k); }, MIRROR_RESUME_MS);
    });
    if (changed) mirrorPendingSave(o);
  }
  try {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushMirrors(); });
    window.addEventListener('pagehide', flushMirrors);
  } catch (e) { /* 聞けない環境では従来どおり20秒後だけ */ }

  /* ── 現場のアカウントの日データの保存（0010・2026-10-11）──
   * 送ってきた盤面から、札ごとの done・checks・comment だけを抜き出して kv_put_marks へ送る。
   * checks は「何番目か」でなく内容の文言で送る（c:<文言>＝真偽を全部・内容の後ろの欄は x:<位置>）。サーバーは端末が
   *   そろえた版（rev）と比べて、端末が変えた所だけを今の版へ差し込む＝2台が同じ札に印を付けても両方残る。
   * ★応答: 端末がそろえた版が今の版だった時は、書いた版（変わらなければ今の版）をそのまま返す。
   *   ただし端末の盤面（印以外）がサーバーと違う時（現場の端末で札を動かした等。サーバーには書けない）は1つ前の版を返し、
   *   端末に次の取得でサーバーの盤面を取り込ませる（そうしないと、違う配置のまま「同期済み」になり続ける）。
   *   端末がそろえた版より後に他の端末が書いていた時は、書けても conflict を返す＝端末は今の版を取り直し、
   *   印を欄ごとに混ぜる統合（ワークスケジュールの rebaseDay・2026-10-11）を通してからそろえる。
   *   （書いた版の1つ前を返す前の作りは、次の送信で自分の古い印を「変えた所」として書き戻し、他の端末の直しを消していた）
   * 確定の解除・強制の保存（lockOverride・force）は現場には許さない。まだ無い日・形の違う印は、待っても直らない
   * ので 'forbidden' として返す（ワークスケジュールは送り直しを止めて知らせる）。 */
  var WSDAY_RE = /^wsday_\d{4}-\d{2}-\d{2}$/;
  var CHECK_KEY_RE = /^\d{1,4}$/;
  var COMMENT_KEYS = ['text', 'size', 'bold', 'pinned', 'dx', 'dy', 'w', 'h'];
  function marksOf(data) {
    var out = { tasks: {} }, tasks = data && Array.isArray(data.tasks) ? data.tasks : [];
    tasks.forEach(function (t) {
      if (!t || typeof t.id !== 'string' || !t.id || Object.prototype.hasOwnProperty.call(out.tasks, t.id)) return;
      var m = { done: !!t.done };
      var cs = Array.isArray(t.contents) ? t.contents : [], ch = (t.checks && typeof t.checks === 'object' && !Array.isArray(t.checks)) ? t.checks : {};
      var ck = {};
      cs.forEach(function (txt, i) {
        if (typeof txt !== 'string') return;
        ck['c:' + txt] = !!(ck['c:' + txt] || ch[i] === true || ch[String(i)] === true);   // 同じ文言が2つあれば、どちらかで true
      });
      Object.keys(ch).forEach(function (k) {
        if (!CHECK_KEY_RE.test(k) || ch[k] !== true) return;
        var i = parseInt(k, 10);
        if (i >= cs.length && i - cs.length < 1000) ck['x:' + (i - cs.length)] = true;   // 内容の後ろの欄（メモ等）
      });
      m.checks = ck;
      if (t.comment && typeof t.comment === 'object' && typeof t.comment.text === 'string') {
        var c = {};
        COMMENT_KEYS.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(t.comment, k)) c[k] = t.comment[k]; });
        m.comment = c;
      } else if (Object.prototype.hasOwnProperty.call(t, 'comment')) m.comment = null;
      out.tasks[t.id] = m;
    });
    return out;
  }
  /* 盤面（印以外）の比べ方。staff・columns・印を除いた札・rev を除いた meta を、キーの順に依らない文字列にして比べる */
  function stable(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort()
      .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  // 盤面の比べ方: meta.rev（そろえた版）と meta.updatedAt（端末が保存した時刻）は盤面の中身ではないので外す（2026-10-12）。
  // updatedAt を残すと、現場で印を付けるたびに端末の時刻だけで「違う」となり、1つ前の版を返して毎回取り直させていた。
  // データベースの「今と同じなら保存しない」（care-backend 0011）と同じ範囲にそろえる
  function boardOf(d) {
    d = d || {};
    var meta = {}, k;
    for (k in (d.meta || {})) if (Object.prototype.hasOwnProperty.call(d.meta, k) && k !== 'rev' && k !== 'updatedAt') meta[k] = d.meta[k];
    var tasks = (Array.isArray(d.tasks) ? d.tasks : []).map(function (t) {
      var c = {}, kk;
      for (kk in (t || {})) if (Object.prototype.hasOwnProperty.call(t, kk) && kk !== 'done' && kk !== 'checks' && kk !== 'comment') c[kk] = t[kk];
      return c;
    });
    return stable({ meta: meta, staff: d.staff || null, columns: d.columns === undefined ? null : d.columns, tasks: tasks });
  }
  /* 印を付けた札が事務所で作り直されていた（id が変わった）時の知らせ。待っても直らないので画面の下に出す（1日につき1回）。
   * 数えるのは印が付いていた札だけ（care-backend 0012）。開き直しても古い札には付かないので、作り直された札に付け直してもらう（2026-10-12） */
  var missingShown = {};
  function noteMissing(key, n) {
    if (missingShown[key] || !document.body) return;
    missingShown[key] = true;
    var bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#7a4b00;color:#fff;' +
      'padding:12px 16px;font:700 15px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;' +
      'display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
    var t = document.createElement('span');
    t.textContent = '事務所で札が作り直されていたため、' + String(key).slice(6) + ' の印 ' + n + '件を保存できませんでした。作り直された札に、もう一度付けてください。';
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = '閉じる';
    b.style.cssText = 'min-height:44px;padding:0 16px;border-radius:8px;border:2px solid #fff;background:transparent;color:#fff;font:inherit;cursor:pointer';
    b.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
    bar.appendChild(t); bar.appendChild(b);
    document.body.appendChild(bar);
  }
  function putMarks(payload, rawGas) {
    if (payload.force || payload.lockOverride) return Promise.resolve({ ok: false, error: 'forbidden' });
    var key = payload.key;
    return rpc('kv_put_marks', { p_key: key, p_rev: Number(payload.rev) || 0, p_marks: marksOf(payload.data) }).then(function (r) {
      if (r.error) return fail(r);
      var d = r.data || { ok: false, error: '通信失敗' };
      if (d.ok && d.marksOnly) {
        var sent = Number(payload.rev) || 0, now = Number(d.rev) || 0;
        if (!d.unchanged && rawGas) scheduleMirror(key, rawGas);
        var base = d.unchanged ? now : (Number(d.baseRev) || 0);
        // 他の端末が先に書いていた＝取り直して統合。知らせはまだ出さない（取り込みで作り直された札へ印を移せることがある。
        // 移せなかった印は画面の側が知らせる）。先に出すと、案内どおり押し直した時に移った印を外してしまう（反証レビュー 2026-10-12）
        if (sent !== base) return { ok: false, conflict: true, rev: now, marksOnly: true };
        if (Number(d.missing) > 0) { try { noteMissing(key, Number(d.missing)); } catch (e) { /* 知らせを出せなくても保存の結果は返す */ } }
        // 書けた時だけ: 端末の盤面がサーバーと違えば、1つ前の版を返して取り込ませる（確かめられない時は今の版のまま）。
        // 変わらなかった時は比べない＝取り込みの後の自動の手直しで盤面が違っても「取り込み→送信→取り込み」を繰り返さない
        if (d.unchanged) return { ok: true, rev: now, marksOnly: true };
        return rpc('kv_get', { p_key: key }).then(function (g) {
          var srv = g && !g.error && g.data ? g.data.data : null;
          var same = !srv || boardOf(srv) === boardOf(payload.data);
          return { ok: true, rev: same ? now : Math.max(0, now - 1), marksOnly: true };
        }, function () { return { ok: true, rev: now, marksOnly: true }; });
      }
      if (d.error === 'noday' || d.error === 'badmarks' || d.error === 'badkey') return { ok: false, error: 'forbidden', why: d.error };
      // conflict（そろえた版が履歴に無い）・locked・shadow はそのまま（端末の今までの扱い）。
      // conflict には印だけの保存の目印を付ける＝画面が現場の取り込み（盤面の形はサーバーの版）を使う
      return d && d.conflict ? Object.assign({}, d, { marksOnly: true }) : d;
    });
  }

  function rpc(name, args) {
    var sb = window.SUAuth.client();
    var once = function () { return sb.rpc(name, args); };
    return once().then(function (r) {
      // 通信の失敗だけ1回やり直す（断り＝データベースの判定はやり直さない）
      if (r.error && /fetch|network|load failed/i.test(String(r.error.message || ''))) return once();
      return r;
    });
  }
  function fail(r) {
    var m = String((r && r.error && (r.error.code || r.error.message)) || '');
    if (m === '42501' || /not allowed/i.test(m)) return { ok: false, error: 'forbidden' };
    return { ok: false, error: '通信失敗' };
  }

  /** この通信を SUKv が受け持つか（同期で答える）。キーが候補に入っている時だけ真＝それ以外は今までどおり */
  function handles(payload) {
    if (!payload || !ROUTED_ACTIONS[payload.action]) return false;
    if (payload.key && kvFlagOf(payload.key)) return true;
    if (Array.isArray(payload.keys)) return payload.keys.some(function (k) { return !!kvFlagOf(k); });
    return false;
  }

  /**
   * 受け持った通信を処理する。rawGas(p) は「これまでの Google への送信」（Promise を返す）。
   * スイッチが入っていなければ rawGas へそのまま流す。
   */
  function call(payload, rawGas) {
    return ensureFlags().then(function () {
      var action = payload.action;
      // 複数キーの版の問い合わせ（ワークスケジュール・週間計画の巡回）: 切り替えたキーだけ Supabase、残りは Google
      if (action === 'head' && Array.isArray(payload.keys)) {
        var mine = payload.keys.filter(kvRouted), rest = payload.keys.filter(function (k) { return !kvRouted(k); });
        if (!mine.length) return rawGas(payload);
        var restP = rest.length ? rawGas(Object.assign({}, payload, { keys: rest })) : Promise.resolve({ ok: true, revs: {} });
        return Promise.all([viaSupabase({ action: 'head', keys: mine }, rawGas), restP]).then(function (both) {
          var a = both[0], b = both[1];
          if (!a || !a.ok) return a;
          if (!b || !b.ok) return b;
          return { ok: true, revs: Object.assign({}, b.revs || {}, a.revs || {}) };
        });
      }
      if (!kvRouted(payload.key)) return rawGas(payload);
      return viaSupabase(payload, rawGas);
    });
  }

  function viaSupabase(payload, rawGas) {
    return authState().then(function (st) {
      var S = window.SUAuth.STATUS;
      if (st.status !== S.OK) {
        if (st.status === S.SIGNED_OUT || st.status === S.DENIED || st.status === S.MFA_VERIFY || st.status === S.MFA_ENROLL) {
          showLoginBanner();
          return { ok: false, error: 'login' };
        }
        return { ok: false, error: '通信失敗' };
      }
      var key = payload.key;
      switch (payload.action) {
        case 'get':
          return rpc('kv_get', { p_key: key }).then(function (r) {
            if (r.error) return fail(r);
            var d = r.data || {};
            return { ok: true, rev: d.rev || 0, data: d.data == null ? null : d.data, updatedAt: d.updatedAt || '' };
          });
        case 'head': {
          var keys = Array.isArray(payload.keys) ? payload.keys : [key];
          return rpc('kv_head', { p_keys: keys }).then(function (r) {
            if (r.error) return fail(r);
            var revs = (r.data && r.data.revs) || {};
            if (Array.isArray(payload.keys)) return { ok: true, revs: revs };
            return { ok: true, rev: revs[key] || 0 };
          });
        }
        case 'put':
          if (st.role === 'field' && WSDAY_RE.test(String(key || ''))) return putMarks(payload, rawGas);   // 現場は印だけ（0010）
          if (st.role !== 'office' && st.role !== 'admin') return { ok: false, error: 'forbidden' };
          return rpc('kv_put', {
            p_key: key, p_rev: Number(payload.rev) || 0, p_data: payload.data,
            p_force: !!payload.force, p_lock_override: !!payload.lockOverride
          }).then(function (r) {
            if (r.error) return fail(r);
            var d = r.data || { ok: false, error: '通信失敗' };
            if (d.ok && !d.unchanged && rawGas) scheduleMirror(key, rawGas);
            return d;
          });
        case 'history':
          if (payload.day != null) return { ok: false, error: 'no such generation' };   // 日次の世代は版番号の一覧に含まれる
          if (payload.rev != null) {
            return rpc('kv_history_get', { p_key: key, p_rev: Number(payload.rev) || 0 }).then(function (r) {
              return r.error ? fail(r) : r.data;
            });
          }
          return rpc('kv_history_list', { p_key: key }).then(function (r) { return r.error ? fail(r) : r.data; });
        default:
          return rawGas(payload);
      }
    }).catch(function () { return { ok: false, error: '通信失敗' }; });
  }

  /* ── 見るだけの画面の読み取り（2026-09-27 代表者の決定 A）──
   * 週間計画俯瞰・支援俯瞰・入居者マスタ／フェイスシートの「デイ利用日」は、書かずに読むだけ。
   * スイッチが入ったキーは Supabase から読む（速い）。ただし次の時は null を返し、呼び手は今までどおり Google を読む
   * （切り替え後も Supabase から Google へ写し返しているので、Google の中身も最新に追いつく）:
   *   スイッチが切・ログインの控えが無い（現場のタブレット等）・ログインが確かめられない・通信の失敗。
   * ★帯（ログインしてください）は出さない＝見るだけの画面の使い勝手を変えない。
   * payload: {action:'get', key} → {ok, rev, data, updatedAt}／{action:'pull', keys:[…]} → {ok, entries:{key:{key,rev,data,updatedAt}}}
   *   pull はキーが全部スイッチ入りの時だけ受け持つ（混ざっていれば null＝全部 Google）。 */
  var SESSION_LS = 'sb-jhbernqawjrzqwrmqrih-auth-token';
  function hasSession() { try { return !!localStorage.getItem(SESSION_LS); } catch (e) { return false; } }
  function readRouted(payload) {
    return ensureFlags().then(function () {
      if (!payload || !hasSession()) return null;
      var keys = payload.action === 'get' ? [payload.key] : payload.action === 'pull' && Array.isArray(payload.keys) ? payload.keys : null;
      if (!keys || !keys.length || !keys.every(kvRouted)) return null;
      return authState().then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK) return null;
        var sb = window.SUAuth.client();
        if (payload.action === 'get') {
          return rpc('kv_get', { p_key: payload.key }).then(function (r) {
            if (r.error || !r.data || r.data.ok !== true) return null;
            return { ok: true, rev: r.data.rev || 0, data: r.data.data == null ? null : r.data.data, updatedAt: r.data.updatedAt || '' };
          });
        }
        return sb.from('kv_entries').select('key,rev,data,updated_at').in('key', keys).then(function (r) {
          if (r.error || !Array.isArray(r.data)) return null;
          var entries = {};
          r.data.forEach(function (e) { if (e && e.data != null) entries[e.key] = { key: e.key, rev: e.rev, data: e.data, updatedAt: e.updated_at }; });
          return { ok: true, entries: entries };
        });
      });
    }).catch(function () { return null; });
  }

  /* ── 勤務表（シフト）の保存先の切り替え（統合 0009・2026-09-27 代表者の決定 B）──
   * 勤務表アプリの通信関数 Store.api の入口で SUKv.handlesShift(payload) が真なら SUKv.callShift(payload, rawGas) に任せる。
   * スイッチ "shift" が切なら rawGas（これまでの Google）へそのまま流す＝切り替え前は何も変わらない。
   * スイッチが入ったら Supabase の関数（shift_pull / shift_push / shift_lock_* / shift_status）で読み書きし、
   * Google と同じ形の応答を返す（conflict・serverRev・editlock・schedwipe 等も同じ名前）＝勤務表アプリの処理は変えない。
   *   ・編集できる端末を1台に絞る仕組み（編集権・券・epoch・厳格モード）もデータベースが同じ約束で受け持つ。
   *   ・現場のアカウントは読むだけ（pull の応答に role:'ro'＝勤務表アプリは閲覧モード）。書けるのは事務所・管理者。
   *   ・Google へは写し返さない（2026-10-17 に外した。Google は厳格モードで写し返しを断っていた）。
   *     ワークスケジュールが Supabase を読めずに Google の勤務表を読んだ時は、画面に「写しから表示中」と出る。
   *   ・合言葉（Google の token）と券の控えは Supabase へは送らない（送るのは関数の引数だけ）。 */
  var SHIFT_ACTIONS = { pull: 1, push: 1, head: 1, lockStatus: 1, lockAcquire: 1, lockRenew: 1, lockRelease: 1, shiftStatus: 1 };
  function isShiftKey(k) { return flagOf(k) === 'shift'; }
  function shiftOn() { return !!(flags && flags.supabase && flags.supabase.shift === true); }

  /** 勤務表アプリの通信のうち、SUKv が受け持てる形か（同期で答える）。受け持っても、スイッチが切なら Google へ流す */
  function handlesShift(payload) {
    if (!payload || !SHIFT_ACTIONS[payload.action]) return false;
    var a = payload.action;
    if (a === 'push') return isShiftKey(payload.key);
    if (a === 'head') return Array.isArray(payload.keys) && payload.keys.length > 0 && payload.keys.every(isShiftKey);
    if (a === 'pull') return !Array.isArray(payload.keys) || !payload.keys.length || payload.keys.every(isShiftKey);
    return true;   // 編集権・版の確かめ（キーを持たない）
  }

  function callShift(payload, rawGas) {
    return ensureFlags().then(function () {
      if (!shiftOn()) return rawGas(payload);
      return viaSupabaseShift(payload, rawGas);
    });
  }

  // 勤務表の Google への写し返し（scheduleShiftMirror）は 2026-10-17 に外した（改善プロンプト第2弾の8・代表者の決定）。
  // Google の統合 GAS は厳格モードで、編集の権利の無い写し返しを毎回断っていた（効いていなかった）。

  function str(v, max) { var s = v == null ? '' : String(v); return s.length > max ? s.substring(0, max) : s; }

  function viaSupabaseShift(payload, rawGas) {
    return authState().then(function (st) {
      var S = window.SUAuth.STATUS;
      if (st.status !== S.OK) {
        if (st.status === S.SIGNED_OUT || st.status === S.DENIED || st.status === S.MFA_VERIFY || st.status === S.MFA_ENROLL) {
          showLoginBanner();
          return { ok: false, error: 'login' };
        }
        return { ok: false, error: '通信失敗' };
      }
      var writer = st.role === 'office' || st.role === 'admin';
      var keys = Array.isArray(payload.keys) ? payload.keys.filter(isShiftKey) : null;
      var pass = function (r) { return r.error ? fail(r) : (r.data || { ok: false, error: '通信失敗' }); };
      switch (payload.action) {
        case 'pull':
          return rpc('shift_pull', { p_keys: keys && keys.length ? keys : null }).then(pass);
        case 'shiftStatus':
        case 'head':
          return rpc('shift_status', { p_keys: keys || [] }).then(function (r) {
            var d = pass(r);
            return payload.action === 'head' && d.ok ? { ok: true, revs: d.revs || {} } : d;
          });
        case 'lockStatus':
          return rpc('shift_lock_status', {}).then(pass);
        case 'push':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_push', {
            p_key: payload.key,
            p_base_rev: (typeof payload.baseRev === 'number' && isFinite(payload.baseRev)) ? payload.baseRev : 0,
            p_data: payload.data === undefined ? null : payload.data,
            p_force: payload.force === true,
            p_edit_token: payload.editToken ? String(payload.editToken) : null,
            p_defaults_init: payload.defaultsInit === true,
            p_restore_backup: payload.restoreFromBackup === true
          }).then(pass);
        case 'lockAcquire':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_lock_acquire', { p_device: str(payload.deviceId, 64), p_name: str(payload.name, 40), p_takeover: payload.takeover === true }).then(pass);
        case 'lockRenew':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_lock_renew', { p_device: str(payload.deviceId, 64), p_token: str(payload.editToken, 64) }).then(pass);
        case 'lockRelease':
          if (!writer) return { ok: false, error: 'forbidden' };
          return rpc('shift_lock_release', { p_device: str(payload.deviceId, 64), p_token: str(payload.editToken, 64) }).then(pass);
        default:
          return rawGas(payload);
      }
    }).catch(function () { return { ok: false, error: '通信失敗' }; });
  }

  /* ── 勤務表の「最終更新：誰・いつ」（care-backend 0029・2026-10-27 本人指示・代表者の決定）──
   * 渡したキー（勤務表のキーだけ・最大20）ごとの、いちばん新しい保存の時刻と保存した人の表示名を返す:
   *   { "<key>": { at: '…', by: '表示名'（無ければ ''） } }（記録が無いキーは入らない）。
   * 次の時は null（呼び手は何も出さない）: スイッチ shift が切・ログインの控えが無い・ログインが確かめられない・
   *   関数がまだ無い（PGRST202）・断り・通信の失敗。★帯（ログインしてください）は出さない＝見るだけの飾りで画面の動きを変えない。
   * Google への通信（rawGas）は使わない・変えない。例外は外に出さない。
   * by にメールらしい値（@ を含む）が来ても返さない（データベースも返さない約束。二重の守り）。 */
  var LAST_UPDATE_MAX = 20;
  function shiftLastUpdate(keys) {
    return ensureFlags().then(function () {
      if (!shiftOn() || !hasSession()) return null;
      var ks = (Array.isArray(keys) ? keys : []).filter(isShiftKey).slice(0, LAST_UPDATE_MAX);
      if (!ks.length) return null;
      return authState().then(function (st) {
        if (!st || st.status !== window.SUAuth.STATUS.OK) return null;
        return rpc('shift_last_update', { p_keys: ks }).then(function (r) {
          if (!r || r.error || !r.data || r.data.ok !== true || !r.data.items || typeof r.data.items !== 'object') return null;
          var out = {};
          ks.forEach(function (k) {
            var it = Object.prototype.hasOwnProperty.call(r.data.items, k) ? r.data.items[k] : null;
            if (!it || typeof it.at !== 'string' || !it.at) return;
            var by = typeof it.by === 'string' && it.by.indexOf('@') < 0 ? it.by : '';
            out[k] = { at: it.at, by: by };
          });
          return out;
        });
      });
    }).catch(function () { return null; });
  }

  // 起動時に一度スイッチを読み、以後1分ごとに読み直す（開いたままの画面も一斉に切り替わる）
  // ★裏のタブ（隠れている間）は1分ごとの読み直しを休み、見えた時に前回から1分を過ぎていれば1回読む
  //   （2026-10-24・アプリ間連携の見直し 段1）。読む URL の ?t= は外さない（外すと GitHub Pages の控えを挟み、
  //   スイッチを戻した時の効きが最大10分遅れる）。保存・写し返しの入口（ensureFlags）は隠れていても今までどおり読む
  fetchFlags();
  setInterval(function () { if (document.visibilityState !== 'hidden') fetchFlags(); }, 60000);
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !(flagsTriedAt && Date.now() - flagsTriedAt < 60000)) fetchFlags();
    });
  } catch (e) { /* 聞けない環境では1分ごとの読み直しだけ */ }

  /** このキーの保存が「印だけ」（現場のアカウント・kv_put_marks）になるか。最後に確かめたアカウントで同期で答える。
   *  true / false、まだアカウントを確かめていなければ null（画面は別の手がかりを使う）。画面が取り込み方を選ぶのに使う（2026-10-12） */
  function marksOnlyFor(key) {
    if (!WSDAY_RE.test(String(key || '')) || !kvRouted(key)) return false;
    if (!authCache) return null;
    return authCache.role === 'field';
  }
  window.SUKv = { handles: handles, call: call, routed: routed, flagOf: flagOf, readRouted: readRouted, marksOnlyFor: marksOnlyFor,
                  handlesShift: handlesShift, callShift: callShift, shiftLastUpdate: shiftLastUpdate, _flags: function () { return flags; } };
})();
