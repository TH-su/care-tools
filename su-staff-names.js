/*
 * su-staff-names.js — 職員の氏名の写しを Supabase に作る（不具合報告の伏せ字の名簿・2026-10-14 代表者の依頼）
 * ════════════════════════════════════════════════════════════════
 * なぜ: 不具合報告の受け口（Supabase の Edge Function su-report）は、届いた本文を名簿と照合して伏せる。
 *   職員の正本は職員マスタ（GAS・シート）で Supabase に無いため、職員マスタが一覧を読み込むたびに
 *   「職員ID・氏名・フリガナ・在籍」だけを staff_names へ写す（care-backend の 0015）。ほかの項目（生年月日・連絡先・資格など）は写さない。
 * ★書けるのは「事務所・管理者として Google でログインしている」時だけ。判定はデータベース（RLS）が最終。
 *   ログインしていない・現場の端末では何もしない（黙って終わる）＝職員マスタの動きは一切変えない。
 * ★変わった行だけを書く。消す口は無い（退職した人も名前を伏せる名簿に残す＝在籍を false にするだけ）。
 * ★端末に残すのは内容の短い指紋と時刻だけ（氏名は残さない）。同じ内容なら10分は写し直さない。
 * ★失敗しても職員マスタには影響させない（例外は外へ出さない）。supabase-js と su-auth.js は使う時に初めて読み込む。
 * 形は入居者マスタの写し（su-master-shadow.js）にそろえた。
 */
(function () {
  'use strict';

  var LIMITS = { source_id: 40, name: 80, kana: 80 };
  var LAST_KEY = 'su_staff_names_last';
  var MIN_GAP_MS = 10 * 60 * 1000;
  var busy = false;

  function str(v) { return v == null ? '' : String(v); }
  /* 職員マスタの1行（{id, name, kana, active}）→ 写しの1行 */
  function toRow(r) {
    return { source_id: str(r && r.id).trim(), name: str(r && r.name), kana: str(r && r.kana), active: !(r && r.active === false) };
  }
  function fits(o) {
    if (!o.source_id) return false;
    for (var k in LIMITS) if (str(o[k]).length > LIMITS[k]) return false;
    return true;
  }
  function same(a, b) { return a.name === str(b.name) && a.kana === str(b.kana) && a.active === (b.active !== false); }
  function fingerprint(rows) {
    var s = JSON.stringify(rows), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return rows.length + ':' + (h >>> 0).toString(36);
  }
  function readLast() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { return null; } }
  function writeLast(v) { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch (e) { /* 何もしない */ } }

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
    return p.then(function () { return window.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); });
  }

  /**
   * 写しを作る。戻り値は {status, inserted, updated, unchanged, failed}。status: 'skipped'／'ok'／'error'。例外は投げない。
   */
  function push(list, opts) {
    opts = opts || {};
    if (busy) return Promise.resolve({ status: 'skipped', reason: 'busy' });
    if (!Array.isArray(list) || !list.length) return Promise.resolve({ status: 'skipped', reason: 'empty' });
    try { if (localStorage.getItem('su_device_role') === 'field') return Promise.resolve({ status: 'skipped', reason: 'field' }); } catch (e) { /* 読めなければ続ける（判定はデータベース） */ }
    busy = true;
    var rows = list.map(toRow);
    var fp = fingerprint(rows);
    var last = readLast();
    if (!opts.force && last && last.fp === fp && Date.now() - (last.at || 0) < MIN_GAP_MS) {
      busy = false;
      return Promise.resolve({ status: 'skipped', reason: 'same' });
    }
    var sb, result = { status: 'ok', inserted: 0, updated: 0, unchanged: 0, failed: 0 };
    return ensureAuth()
      .then(function () { return window.SUAuth.check(); })
      .then(function (st) {
        if (!st || st.status !== window.SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
          throw { skip: st && st.status === window.SUAuth.STATUS.OK ? 'role' : 'signed_out' };
        }
        sb = window.SUAuth.client();
        return sb.from('staff_names').select('source_id,name,kana,active');
      })
      .then(function (r) {
        if (r.error) throw r.error;
        var have = {};
        (r.data || []).forEach(function (x) { have[x.source_id] = x; });
        var seen = {}, write = [];
        rows.forEach(function (o) {
          if (!fits(o) || seen[o.source_id]) { result.failed++; return; }
          seen[o.source_id] = true;
          var cur = have[o.source_id];
          if (!cur) { result.inserted++; write.push(o); }
          else if (!same(o, cur)) { result.updated++; write.push(o); }
          else result.unchanged++;
        });
        if (!write.length) return null;
        return sb.from('staff_names').upsert(write, { onConflict: 'tenant_id,source_id' }).then(function (w) {
          if (w.error) { result.failed += write.length; result.inserted = 0; result.updated = 0; result.status = 'error'; }
        });
      })
      .then(function () {
        if (result.status === 'ok') writeLast({ fp: fp, at: Date.now() });
        busy = false;
        return result;
      })
      .catch(function (e) {
        busy = false;
        if (e && e.skip) return { status: 'skipped', reason: e.skip };
        return { status: 'error' };   // 中身（氏名を含みうる）は返さない
      });
  }

  window.SUStaffNames = { push: push, toRow: toRow };
})();
