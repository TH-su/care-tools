/*
 * su-master-shadow.js — 入居者マスタの「写し」を Supabase に作る（統合 0004・段階移行の①・2026-09-26）
 * ════════════════════════════════════════════════════════════════
 * 決定（代表者 2026-09-26）: 入居者の正本は入居者マスタ（GAS・シート）のまま。段階的に移す。
 *   ① この部品で、入居者マスタが一覧を読み込むたびに基本項目の写しを Supabase の master_residents へ書く
 *   ② master-shadow.html で写しと正本が一致し続けるかを見比べる
 *   ③ 一致を確かめてから保存先を切り替える（別の作業）
 *
 * ★写すのは基本項目だけ（氏名・かな・居室・性別・介護度・在籍・入院中・退居日・生年月日・身長・対象アプリ）。
 *   病名・処方・家族連絡先・支援経過はここでは扱わない（後の段階）。
 * ★書けるのは「事務所・管理者として Google でログインしている」時だけ。判定はデータベース（RLS）が最終。
 *   ログインしていない・現場の端末では何もしない（黙って終わる）＝入居者マスタの動きは一切変えない。
 * ★新しい秘密の鍵は使わない。書き込みはその人自身のログインで行う。
 * ★変わった行だけを書く（全員分を毎回書かない＝操作記録を無駄に増やさない）。消す口は無い：
 *   写しにあって正本に無い人は「数える」だけ。
 * ★写しの結果（件数だけ）を master_sync_runs に残す。氏名・値は残さない。
 * ★写しの記録には、その一覧と一緒に正本が返した版数（stateRev・srev）も残す（移行 0019・2026-10-22・反証レビューの指摘）。
 *   名簿を写しから読む入口（su-roster.js）は、Google の今の版数と記録の版数が同じ時だけ写しを使う。
 *   列の無い古いデータベースでは版数を外して書き直す（記録が残せなくても写しは止めない）。
 * ★失敗しても入居者マスタには影響させない（例外は外へ出さない）。
 * ★supabase-js と su-auth.js は、使う時になって初めて読み込む（入居者マスタの起動を重くしない）。
 * ★訪問診療の曜日（訪問日 visitDay）とかかりつけ病院（hospital）は、別の表 master_residents_care へ書く
 *   （移行 0022・代表者の決定 2026-10-24 の決定4・アプリ間連携と軽量化 段2b）。現場のアカウントは読めない表。
 *   ・画面は push(roster, { care: 正規化する前の getRoster の名簿 }) で渡す。この部品は利用者No と2項目
 *     （と、その人の正本の更新時刻）だけを拾って送る。氏名は送らない。入居者マスタの一覧・共有名簿には2項目を入れない
 *   ・基本項目の写しと同じ時に・同じ10分の間引きで書く（指紋に2項目も含める）。変わった行だけを書く
 *   ・「持たない」と「空にせよ」を分ける: 正本の行に2項目のキーがある時だけ書き、値が '' なら '' を書く（正本で空になった）。
 *     キーが無い人（古い GAS など）は書かない（今の値を消さない）。その人に写しの行が既にある時は、古いまま残るので失敗に数える
 *   ・2項目の失敗（長すぎ・利用者No の重複・データベースの断り・上の古いまま残る人）は、写しの記録の care_failed（移行 0022）に数える。
 *     基本項目の failed には足さない＝2項目を読まない画面（訪問・全支援の週間俯瞰）は今までどおり写しを使える（差分審査 中2・2026-10-24）。
 *     名簿を写しから読む入口（su-roster.js）は、2項目を求める時だけ care_failed が 0 の記録の写しを使う＝古い☆を「新しい」と扱わない。
 *     データベースの断りの時は次に一覧を読んだ時に写し直す（長すぎ・重複・キーが無いは写し直しても同じなので、10分の間引きのまま）
 *   ・2項目を書いていない写し（care を渡さない古い画面・表が無い）は care_failed を送らない＝記録は null のまま（読む側は Google）
 *   ・表が無い（0022 を流す前の古いデータベース）時は書かず、基本項目の写しはそのまま続ける。
 *     su-errors.js の note（「保存・同期の失敗」・場所 shadow:care.absent）に1画面1回だけ残す（画面は止めない）。
 *     記録に care_failed の列が無い時は、その列を外して記録を残し直す（版数は残す）
 */
(function () {
  'use strict';

  var LIMITS = { source_id: 40, name: 80, kana: 80, room: 20, gender: 10, care_level: 20, birth_date: 20, height: 10, source_updated_at: 40 };
  var FIELDS = ['name', 'kana', 'room', 'gender', 'care_level', 'active', 'hospitalized', 'discharge_date', 'birth_date', 'height', 'target_apps', 'source_updated_at'];
  var LAST_KEY = 'su_shadow_last';          // この端末で最後に写した内容の指紋と時刻（氏名は入れない）
  var MIN_GAP_MS = 10 * 60 * 1000;          // 同じ内容なら10分は写し直さない
  var CARE_TABLE = 'master_residents_care';  // 訪問日・かかりつけ病院の写し（移行 0022・事務所・管理者だけが読める）
  var CARE_FIELDS = ['visit_day', 'hospital'];
  var CARE_LIMITS = { source_id: 40, visit_day: 40, hospital: 200, source_updated_at: 40 };
  var NOTE_KIND = '保存・同期の失敗';         // su-report.js の NOTE_KIND と同じ（場所ごとに1件・合計3件の扱い）
  var busy = false;
  var noted = {};

  function ymd(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)) ? String(v) : null; }
  function str(v) { return v == null ? '' : String(v); }

  /* 入居者マスタの一覧の1行（normRosterRow の形）→ 写しの1行 */
  function toRow(r) {
    var o = {
      source_id: str(r.id).trim(),
      name: str(r.name), kana: str(r.kana), room: str(r.room), gender: str(r.gender),
      care_level: str(r.careLevel),
      active: r.active !== false,
      // 入院中は正本が配っている時だけ真偽にする（無い時に false を作らない＝multi-device-sync 原則7）
      hospitalized: Object.prototype.hasOwnProperty.call(r, 'hospitalized') ? !!r.hospitalized : null,
      discharge_date: r.active === false ? ymd(r.dischargeDate) : null,
      birth_date: str(r.birthDate), height: str(r.height),
      target_apps: Array.isArray(r.targetApps) ? r.targetApps.map(str) : null,
      source_updated_at: str(r.updatedAt)
    };
    return o;
  }
  function fits(o) {
    if (!o.source_id) return false;
    for (var k in LIMITS) if (str(o[k]).length > LIMITS[k]) return false;
    return true;
  }

  /* 正本の名簿（getRoster の正規化する前の1行）→ 訪問日・かかりつけ病院の写しの1行。
     2項目のキーが無い・文字でない時は null（＝この人の分は持たない。書かない）。氏名は拾わない */
  function toCareRow(r) {
    if (!r || typeof r !== 'object') return null;
    var has = Object.prototype.hasOwnProperty;
    if (!has.call(r, 'visitDay') || !has.call(r, 'hospital')) return null;
    if (typeof r.visitDay !== 'string' || typeof r.hospital !== 'string') return null;
    return { source_id: str(r.id).trim(), visit_day: r.visitDay, hospital: r.hospital, source_updated_at: str(r.updatedAt) };
  }
  function careFits(o) {
    if (!o.source_id) return false;
    for (var k in CARE_LIMITS) if (str(o[k]).length > CARE_LIMITS[k]) return false;
    return true;
  }
  function careSame(a, b) {
    for (var i = 0; i < CARE_FIELDS.length; i++) if (str(a[CARE_FIELDS[i]]) !== str(b[CARE_FIELDS[i]])) return false;
    return true;
  }
  /* 写しの記録に care_failed の列が無い（0022 を流す前・戻した後）の断り。文に care_failed が出る時だけ（版数の列の断りと分ける） */
  function noCareFailedColumn(err) {
    var c = String(err && err.code || ''), m = String(err && err.message || '');
    return /care_failed/.test(m) && (c === '42703' || c === 'PGRST204' || /does not exist|could not find/i.test(m));
  }
  /* 表が無い（0022 を流す前）の断り。PostgREST の「表が見つからない」（PGRST205・PGRST202）と PostgreSQL の 42P01 だけ */
  function noCareTable(err) {
    var c = String(err && err.code || ''), m = String(err && err.message || '');
    return c === 'PGRST205' || c === 'PGRST202' || c === '42P01' || (/master_residents_care/.test(m) && /does not exist|could not find/i.test(m));
  }
  function note(reason) {
    if (noted[reason]) return;
    noted[reason] = true;
    try {
      var e = new Error(reason); e.name = 'DataError';
      if (window.SUErrors && typeof window.SUErrors.note === 'function') window.SUErrors.note(NOTE_KIND, e, 'shadow:care.' + reason);
    } catch (x) { /* 記録できなくても動きは止めない */ }
  }
  function same(a, b) {
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i];
      var x = a[k], y = b[k];
      if (Array.isArray(x) || Array.isArray(y)) {
        if (JSON.stringify(x || null) !== JSON.stringify(y || null)) return false;
      } else if ((x == null ? null : x) !== (y == null ? null : y)) {
        return false;
      }
    }
    return true;
  }
  function fingerprint(rows) {
    // 氏名を端末に残さないため、内容そのものではなく短い指紋だけを持つ
    var s = JSON.stringify(rows), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return rows.length + ':' + (h >>> 0).toString(36);
  }
  function readLast() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { return null; } }
  function writeLast(v) { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch (e) { /* 何もしない */ } }

  /* supabase-js と su-auth.js を必要な時だけ読み込む */
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { ng(new Error('読み込めませんでした: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureAuth() {
    if (window.SUAuth) return Promise.resolve();
    var p = window.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return window.SUAuth ? null : loadScript('su-auth.js?v=2026-10-24'); });
  }

  /* 正本が一覧と一緒に返した版数（数でなければ null＝版数なし。読む側は版数なしの記録を使わない） */
  function revOf(opts) {
    var r = opts && opts.stateRev, v = opts && opts.srev;
    return {
      state_rev: (typeof r === 'number' && isFinite(r) && r >= 0 && Math.floor(r) === r) ? r : null,
      srev: (typeof v === 'number' && isFinite(v) && v >= 0) ? String(v) : null
    };
  }
  /* 版数の列が無い古いデータベース（0019 未適用）の断り。列が見つからない（42703・PGRST204）の時だけ */
  function noRevColumn(err) {
    var c = String(err && err.code || ''), m = String(err && err.message || '');
    return c === '42703' || c === 'PGRST204' || /state_rev|srev/.test(m);
  }

  /**
   * 写しを作る。opts.stateRev・opts.srev は、その一覧と一緒に getRoster が返した版数（無ければ省く）。
   * opts.care は正規化する前の getRoster の名簿（訪問日・かかりつけ病院を写す時だけ。無ければ写さない＝今までどおり）。
   * 戻り値は {status, ...件数}。status:
   *   'skipped'（ログインなし・現場・同じ内容を直前に写した・空の一覧）／'ok'／'error'
   * 例外は投げない。
   */
  function push(roster, opts) {
    opts = opts || {};
    if (busy) return Promise.resolve({ status: 'skipped', reason: 'busy' });
    if (!Array.isArray(roster) || !roster.length) return Promise.resolve({ status: 'skipped', reason: 'empty' });
    busy = true;
    var rows = roster.map(toRow);
    // 訪問日・かかりつけ病院（opts.care がある時だけ）。2項目を持たない人は書かず、利用者No だけ控える（写しの行が既にあれば失敗に数える）
    var care = null;
    if (Array.isArray(opts.care)) {
      care = { rows: [], lack: [] };
      opts.care.forEach(function (r) {
        var c = toCareRow(r);
        if (c) care.rows.push(c);
        else if (r && typeof r === 'object' && str(r.id).trim()) care.lack.push(str(r.id).trim());
      });
    }
    var fp = fingerprint(rows) + (care ? '|c' + fingerprint(care.rows) : '');
    var rev = revOf(opts);
    var last = readLast();
    // 同じ内容でも、版数が進んでいれば写しの記録を残し直す（版数だけ進んだ時に、読む側が古い記録を見続けないように）
    if (!opts.force && last && last.fp === fp && Date.now() - (last.at || 0) < MIN_GAP_MS &&
        (last.rev === undefined ? null : last.rev) === rev.state_rev && (last.srev === undefined ? null : last.srev) === rev.srev) {
      busy = false;
      return Promise.resolve({ status: 'skipped', reason: 'same' });
    }
    var sb, careHave = null, result = { status: 'ok', source_count: rows.length, inserted: 0, updated: 0, unchanged: 0, missing: 0, failed: 0, care_failed: null };

    /* 訪問日・かかりつけ病院を書く（基本項目の写しの後・写しの記録の前）。失敗は result.care_failed に数える（記録の care_failed に残る＝
       2項目を求める読み手だけが写しを使わない。基本項目の failed には足さない）。表が無い時は書かず、care_failed も null のまま（note だけ）。
       retry はデータベースの断り＝次に一覧を読んだ時に写し直す。result.care に件数を残す（試験・見比べ用。値は入れない） */
    function careFail(n, msg, retry) {
      if (!n) return;
      result.care_failed += n; result.care.failed += n;
      if (retry) result.status = 'error';
      if (msg && !result.message) result.message = msg;
    }
    function pushCare() {
      if (!care) return null;
      result.care = { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
      var h = careHave || { error: { message: 'care' } };
      if (h.error && noCareTable(h.error)) { result.care.absent = true; note('absent'); return null; }
      result.care_failed = 0;
      if (h.error) {
        careFail(care.rows.length + care.lack.length, String(h.error.message || 'care'), true);
        return null;
      }
      var have = {};
      (h.data || []).forEach(function (x) { if (x && typeof x.source_id === 'string') have[x.source_id] = x; });
      var seen = {}, write = [];
      care.rows.forEach(function (o) {
        if (!careFits(o) || seen[o.source_id]) { careFail(1); return; }   // 長すぎ・利用者Noの重複は写さない
        seen[o.source_id] = true;
        var cur = have[o.source_id];
        if (!cur) { result.care.inserted++; write.push(o); }
        else if (!careSame(o, cur)) { result.care.updated++; write.push(o); }
        else result.care.unchanged++;
      });
      // 2項目を持たない人: 書かない。写しの行が既にあれば古いまま残るので失敗に数える（読む側が古い値を使わないように）
      care.lack.forEach(function (id) { if (have[id] && !seen[id]) careFail(1); });
      if (!write.length) return null;
      return Promise.resolve(sb.from(CARE_TABLE).upsert(write, { onConflict: 'tenant_id,source_id' })).then(function (w) {
        if (w && w.error) {
          if (noCareTable(w.error)) { result.care.absent = true; note('absent'); result.care.inserted = 0; result.care.updated = 0; result.care_failed = null; return; }
          result.care.inserted = 0; result.care.updated = 0;
          careFail(write.length, String(w.error.message || 'care'), true);
        }
      }, function (e) {
        result.care.inserted = 0; result.care.updated = 0;
        careFail(write.length, String(e && e.message || 'care'), true);
      });
    }

    return ensureAuth()
      .then(function () { return window.SUAuth.check(); })
      .then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
          throw { skip: st.status === window.SUAuth.STATUS.OK ? 'role' : 'signed_out' };
        }
        sb = window.SUAuth.client();
        // 訪問日・かかりつけ病院の写しの今の中身も同時に読む（変わった行だけを書くため）
        var careP = care ? Promise.resolve(sb.from(CARE_TABLE).select('source_id,' + CARE_FIELDS.join(',')))
          .then(null, function (e) { return { error: e || { message: 'care' } }; }) : null;
        return Promise.all([sb.from('master_residents').select('source_id,' + FIELDS.join(',')), careP]);
      })
      .then(function (both) {
        var r = both[0];
        careHave = both[1];
        if (r.error) throw r.error;
        var have = {};
        (r.data || []).forEach(function (x) { have[x.source_id] = x; });
        var seen = {}, write = [];
        rows.forEach(function (o) {
          if (!fits(o) || seen[o.source_id]) { result.failed++; return; }   // 長すぎ・利用者Noの重複は写さない
          seen[o.source_id] = true;
          var cur = have[o.source_id];
          if (!cur) { result.inserted++; write.push(o); }
          else if (!same(o, cur)) { result.updated++; write.push(o); }
          else result.unchanged++;
        });
        Object.keys(have).forEach(function (id) { if (!seen[id]) result.missing++; });
        if (!write.length) return null;
        return sb.from('master_residents').upsert(write, { onConflict: 'tenant_id,source_id' }).then(function (w) {
          if (w.error) {
            result.failed += write.length; result.inserted = 0; result.updated = 0;
            result.status = 'error';
            result.message = w.error.message;
          }
        });
      })
      .then(function () { return pushCare(); })
      .then(function () {
        var label = '';
        try { label = (localStorage.getItem('su_device_label') || '').slice(0, 40); } catch (e) { /* 何もしない */ }
        var runRow = {
          device_label: label, source_count: result.source_count, inserted: result.inserted,
          updated: result.updated, unchanged: result.unchanged, missing: result.missing, failed: result.failed
        };
        var withRev = {}, withCare = {};
        for (var k in runRow) withRev[k] = runRow[k];
        withRev.state_rev = rev.state_rev; withRev.srev = rev.srev;
        for (var k2 in withRev) withCare[k2] = withRev[k2];
        // 2項目を書いた（書こうとした）写しだけ care_failed を送る。書いていない写しは送らない＝記録は null
        var sendCare = typeof result.care_failed === 'number';
        if (sendCare) withCare.care_failed = result.care_failed;
        function revFallback(w) {
          // 版数の列が無い古いデータベースでは、版数を外して今までどおりの記録を残す
          if (w && w.error && noRevColumn(w.error)) return sb.from('master_sync_runs').insert(runRow);
          return w;
        }
        return sb.from('master_sync_runs').insert(withCare).then(function (w) {
          // care_failed の列が無い（0022 を戻した等）時は、その列だけ外して残し直す（版数は残す）
          if (sendCare && w && w.error && noCareFailedColumn(w.error)) return sb.from('master_sync_runs').insert(withRev).then(revFallback);
          return revFallback(w);
        });
      })
      .then(function () {
        if (result.status === 'ok') writeLast({ fp: fp, at: Date.now(), rev: rev.state_rev, srev: rev.srev });
        busy = false;
        return result;
      })
      .catch(function (e) {
        busy = false;
        if (e && e.skip) return { status: 'skipped', reason: e.skip };
        return { status: 'error', message: String(e && e.message || e) };
      });
  }

  window.SUMasterShadow = { push: push, toRow: toRow, toCareRow: toCareRow, FIELDS: FIELDS, CARE_FIELDS: CARE_FIELDS, CARE_LIMITS: CARE_LIMITS };
})();
