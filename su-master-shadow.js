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
 * ★失敗しても入居者マスタには影響させない（例外は外へ出さない）。
 * ★supabase-js と su-auth.js は、使う時になって初めて読み込む（入居者マスタの起動を重くしない）。
 */
(function () {
  'use strict';

  var LIMITS = { source_id: 40, name: 80, kana: 80, room: 20, gender: 10, care_level: 20, birth_date: 20, height: 10, source_updated_at: 40 };
  var FIELDS = ['name', 'kana', 'room', 'gender', 'care_level', 'active', 'hospitalized', 'discharge_date', 'birth_date', 'height', 'target_apps', 'source_updated_at'];
  var LAST_KEY = 'su_shadow_last';          // この端末で最後に写した内容の指紋と時刻（氏名は入れない）
  var MIN_GAP_MS = 10 * 60 * 1000;          // 同じ内容なら10分は写し直さない
  var busy = false;

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
    return p.then(function () { return window.SUAuth ? null : loadScript('su-auth.js?v=2026-09-26'); });
  }

  /**
   * 写しを作る。戻り値は {status, ...件数}。status:
   *   'skipped'（ログインなし・現場・同じ内容を直前に写した・空の一覧）／'ok'／'error'
   * 例外は投げない。
   */
  function push(roster, opts) {
    opts = opts || {};
    if (busy) return Promise.resolve({ status: 'skipped', reason: 'busy' });
    if (!Array.isArray(roster) || !roster.length) return Promise.resolve({ status: 'skipped', reason: 'empty' });
    busy = true;
    var rows = roster.map(toRow);
    var fp = fingerprint(rows);
    var last = readLast();
    if (!opts.force && last && last.fp === fp && Date.now() - (last.at || 0) < MIN_GAP_MS) {
      busy = false;
      return Promise.resolve({ status: 'skipped', reason: 'same' });
    }
    var sb, result = { status: 'ok', source_count: rows.length, inserted: 0, updated: 0, unchanged: 0, missing: 0, failed: 0 };

    return ensureAuth()
      .then(function () { return window.SUAuth.check(); })
      .then(function (st) {
        if (st.status !== window.SUAuth.STATUS.OK || (st.role !== 'office' && st.role !== 'admin')) {
          throw { skip: st.status === window.SUAuth.STATUS.OK ? 'role' : 'signed_out' };
        }
        sb = window.SUAuth.client();
        return sb.from('master_residents').select('source_id,' + FIELDS.join(','));
      })
      .then(function (r) {
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
      .then(function () {
        var label = '';
        try { label = (localStorage.getItem('su_device_label') || '').slice(0, 40); } catch (e) { /* 何もしない */ }
        return sb.from('master_sync_runs').insert({
          device_label: label, source_count: result.source_count, inserted: result.inserted,
          updated: result.updated, unchanged: result.unchanged, missing: result.missing, failed: result.failed
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
        return { status: 'error', message: String(e && e.message || e) };
      });
  }

  window.SUMasterShadow = { push: push, toRow: toRow, FIELDS: FIELDS };
})();
